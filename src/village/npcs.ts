import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';
import { mulberry32 } from '../core/rng.ts';
import { heightAt } from '../world/terrain.ts';
import { villageLayout, type Point2 } from './layout.ts';
import { makeSurfaceMaterial } from '../core/materials.ts';

// ---------------------------------------------------------------------------
// Haven Village NPCs — 5 procedural blocky villagers with distinct silhouettes
// (hat / apron / pack / cane / small), distinct colours + eyes, and floating DOM
// name labels (reusing the critter-preview label pattern). Idle AI: each wanders
// short loops within ~10m of home, pauses 2–5s, and turns to face the player
// when within 6m. No pathfinding — the village pocket is flat and open.
// `nearestNpc(pos, maxDist)` backs the F-to-talk interact chain in main.ts.
// ---------------------------------------------------------------------------

export type Silhouette = 'hat' | 'apron' | 'pack' | 'cane' | 'small';

export interface NpcDef {
  id: string;
  name: string;
  silhouette: Silhouette;
  /** Base body colour (hex). */
  color: number;
  /** Accent colour (hat/apron/pack/etc). */
  accent: number;
}

export const NPCS: NpcDef[] = [
  { id: 'fenn', name: 'Mayor Fenn', silhouette: 'hat', color: 0x3c4c8a, accent: 0xd8b24a },
  { id: 'odd', name: 'Farmer Odd', silhouette: 'apron', color: 0x6a7c3a, accent: 0xcbb487 },
  { id: 'juno', name: 'Trader Juno', silhouette: 'pack', color: 0x2f8c86, accent: 0xd05a3a },
  { id: 'bram', name: 'Old Bram', silhouette: 'cane', color: 0x8a8580, accent: 0x5a4636 },
  { id: 'kit', name: 'Kit the Kid', silhouette: 'small', color: 0xe0b02a, accent: 0xe0602a },
];

const AI = {
  walkSpeed: 1.2,
  turnRate: 2.4,
  wanderRadius: 9,
  arriveDist: 0.6,
  pauseMin: 2,
  pauseMax: 5,
  /** Face (and freeze) the player within this distance (m). */
  faceDist: 6,
};

/** Beyond this camera distance (m) a name label is culled (declutters the map). */
const LABEL_MAX_DIST = 40;

type MatOpts = { emissive?: number; emissiveIntensity?: number };
function mat(color: number, opts: MatOpts = {}): THREE.Material {
  // Quality-gated (Standard on medium+, Lambert on low) so villagers read the
  // same material model as the props/critters/village around them.
  const m = makeSurfaceMaterial({ color, roughness: 0.85 });
  if (opts.emissive !== undefined && 'emissive' in m) {
    (m as THREE.MeshStandardMaterial).emissive = new THREE.Color(opts.emissive);
    (m as THREE.MeshStandardMaterial).emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return m;
}
function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
}
function blob(r: number, color: number, ws = 8, hs = 6): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat(color));
}
function capsule(r: number, len: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat(color));
}

const SKIN = 0xe8b985;

/** Big round-3 face: sclera + iris + highlight eyes set forward on +Z, a
 *  little nose, and optional cheek-blush pads (the same charm language as the
 *  whimsical critters). */
function addFace(
  g: THREE.Group,
  headY: number,
  headR: number,
  s: number,
  opts: { blush?: boolean; irisColor?: number } = {},
): void {
  for (const sx of [-1, 1]) {
    const sclera = blob(0.075 * s, 0xf6f2ea);
    sclera.position.set(sx * 0.085 * s, headY + 0.03 * s, headR * 0.78);
    sclera.scale.z = 0.55;
    g.add(sclera);
    const iris = blob(0.042 * s, opts.irisColor ?? 0x2c2126, 6, 5);
    iris.position.set(sx * 0.085 * s, headY + 0.028 * s, headR * 0.78 + 0.045 * s);
    g.add(iris);
    const glint = blob(0.014 * s, 0xffffff, 5, 4);
    glint.position.set(sx * 0.085 * s + 0.015 * s, headY + 0.05 * s, headR * 0.78 + 0.07 * s);
    g.add(glint);
    if (opts.blush) {
      const cheek = blob(0.035 * s, 0xe89b93, 6, 5);
      cheek.position.set(sx * 0.13 * s, headY - 0.05 * s, headR * 0.7);
      cheek.scale.z = 0.4;
      g.add(cheek);
    }
  }
  const nose = blob(0.028 * s, 0xd9a06c, 6, 5);
  nose.position.set(0, headY - 0.02 * s, headR * 0.95);
  g.add(nose);
}

/**
 * Build a plush round-3 villager for `def` (fidelity-3: same whimsical
 * character language as the critters — big sclera+iris+highlight eyes, plump
 * bottom-heavy bodies, stubby limbs). Model faces +Z, feet at y=0; each
 * silhouette keeps its distinguishing accessory. Returns the group and its
 * head height (for label projection).
 */
function buildNpcModel(def: NpcDef): { group: THREE.Group; headY: number } {
  const g = new THREE.Group();
  const small = def.silhouette === 'small';
  const s = small ? 0.72 : 1;
  const legH = 0.34 * s;
  const torsoH = (def.silhouette === 'cane' ? 0.5 : 0.6) * s; // Bram hunches

  for (const sx of [-1, 1]) {
    const leg = capsule(0.08 * s, legH * 0.55, def.accent);
    leg.position.set(sx * 0.11 * s, legH / 2, 0);
    g.add(leg);
  }
  // Plump bottom-heavy tunic body: a squashed sphere, wider at the hips.
  const torsoY = legH + torsoH / 2;
  const torso = blob(0.3 * s, def.color, 9, 7);
  torso.scale.set(1, torsoH / (0.3 * s) / 2 + 0.35, 0.82);
  torso.position.set(0, torsoY, 0);
  g.add(torso);
  for (const sx of [-1, 1]) {
    const arm = capsule(0.06 * s, torsoH * 0.5, def.color);
    arm.position.set(sx * 0.32 * s, torsoY + 0.04 * s, 0.02);
    arm.rotation.z = sx * 0.35;
    g.add(arm);
    const hand = blob(0.055 * s, SKIN, 6, 5);
    hand.position.set(sx * 0.38 * s, torsoY - torsoH * 0.32, 0.04);
    g.add(hand);
  }
  // Big plush head (~45% of the visual mass, like the critters).
  const headR = 0.24 * s;
  const headY = legH + torsoH + headR * 0.9;
  const head = blob(headR, SKIN, 10, 8);
  head.scale.y = 0.92;
  head.position.set(0, headY, 0);
  g.add(head);
  addFace(g, headY, headR, s, {
    blush: def.silhouette === 'small' || def.silhouette === 'apron',
  });
  for (const sx of [-1, 1]) {
    const ear = blob(0.045 * s, SKIN, 6, 5);
    ear.position.set(sx * headR * 0.95, headY, 0);
    g.add(ear);
  }

  // Silhouette accessories (kept per-NPC identity, rounded up).
  if (def.silhouette === 'hat') {
    // Mayor: grand round-brim hat with a band.
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * s, 0.32 * s, 0.04 * s, 10), mat(def.accent));
    brim.position.set(0, headY + headR * 0.82, 0);
    g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.16 * s, 0.2 * s, 8), mat(def.accent));
    crown.position.set(0, headY + headR * 0.82 + 0.12 * s, 0);
    g.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165 * s, 0.165 * s, 0.05 * s, 8), mat(def.color));
    band.position.set(0, headY + headR * 0.82 + 0.05 * s, 0);
    g.add(band);
  } else if (def.silhouette === 'apron') {
    const apron = box(0.4 * s, torsoH * 0.75, 0.05, def.accent);
    apron.position.set(0, torsoY - 0.03 * s, 0.24 * s);
    g.add(apron);
    // Straw sun hat: wide disc + soft dome.
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * s, 0.36 * s, 0.035 * s, 10), mat(0xcbb056));
    brim.position.set(0, headY + headR * 0.8, 0);
    g.add(brim);
    const dome = blob(0.15 * s, 0xcbb056, 8, 5);
    dome.scale.y = 0.6;
    dome.position.set(0, headY + headR * 0.86, 0);
    g.add(dome);
  } else if (def.silhouette === 'pack') {
    const pack = blob(0.2 * s, def.accent, 7, 6);
    pack.scale.set(0.9, 1.15, 0.7);
    pack.position.set(0, torsoY + 0.08 * s, -0.28 * s);
    g.add(pack);
    const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.34 * s, 7), mat(def.color));
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.set(0, torsoY + 0.28 * s, -0.26 * s);
    g.add(bedroll);
    const cap = blob(0.16 * s, def.accent, 8, 5);
    cap.scale.y = 0.5;
    cap.position.set(0, headY + headR * 0.85, 0);
    g.add(cap);
  } else if (def.silhouette === 'cane') {
    const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, legH + torsoH + 0.1, 6), mat(def.accent));
    cane.position.set(0.36 * s, (legH + torsoH) / 2, 0.16);
    g.add(cane);
    const knob = blob(0.045, 0xd8b24a, 6, 5);
    knob.position.set(0.36 * s, legH + torsoH + 0.08, 0.16);
    g.add(knob);
    // Grey hair wreath + bushy brows.
    const hair = blob(headR * 0.95, 0xe8e4dd, 8, 5);
    hair.scale.set(1.05, 0.45, 1.05);
    hair.position.set(0, headY + headR * 0.62, -0.02);
    g.add(hair);
    for (const sx of [-1, 1]) {
      const brow = box(0.09 * s, 0.028 * s, 0.03 * s, 0xe8e4dd);
      brow.position.set(sx * 0.085 * s, headY + 0.11 * s, headR * 0.85);
      g.add(brow);
    }
  } else {
    // Kit: a bouncy double cowlick + freckle band.
    for (const [dx, h] of [
      [-0.03, 0.16],
      [0.045, 0.12],
    ] as const) {
      const tuft = capsule(0.03 * s, h * s * 0.5, def.accent);
      tuft.position.set(dx * s, headY + headR * 0.95, 0);
      tuft.rotation.z = dx * 6;
      g.add(tuft);
    }
  }

  return { group: g, headY: headY + headR };
}

/** Public NPC anchor positions (Haven V4: the PenSystem places each NPC's
 *  traded-away critters just outward of their anchor). Memoised via layout. */
export function npcAnchors(): Record<string, Point2> {
  return npcHomes();
}

/** Metres Farmer Odd's anchor sits to the side of the plot grid centre, so his
 *  talk-F prompt (within 3 m) stops competing with the plot collect-F prompt. */
const FARMER_PLOT_CLEARANCE = 6;

/** Anchor each NPC to a sensible spot near their building. */
function npcHomes(): Record<string, Point2> {
  const L = villageLayout();
  const at = (id: string): Point2 => {
    const b = L.buildings.find((x) => x.id === id)!;
    return { x: b.door.x, z: b.door.z };
  };
  // Farmer Odd stands just to the SIDE of the plot grid (perpendicular to the
  // farmhouse→plots axis) rather than dead-centre on it, so standing at a plot
  // to collect (F) doesn't also land inside his 3 m talk radius.
  const fh = L.buildings.find((b) => b.kind === 'farmhouse')!;
  const plotAxis = Math.atan2(L.farm.origin.z - fh.z, L.farm.origin.x - fh.x);
  const side = plotAxis + Math.PI / 2;
  const oddAnchor: Point2 = {
    x: L.farm.origin.x + Math.cos(side) * FARMER_PLOT_CLEARANCE,
    z: L.farm.origin.z + Math.sin(side) * FARMER_PLOT_CLEARANCE,
  };
  return {
    fenn: { x: L.plaza.x + 2, z: L.plaza.z + 1 }, // mayor works the plaza
    odd: oddAnchor, // farmer beside his plots (clear of the collect-F prompt)
    juno: at('barter'), // trader at the stand
    bram: at('home1'), // old bram by his door
    kit: { x: L.plaza.x - 2, z: L.plaza.z - 2 }, // kid darts around the plaza
  };
}

interface NpcRuntime {
  def: NpcDef;
  group: THREE.Group;
  headY: number;
  home: Point2;
  pos: Vec3;
  yaw: number;
  targetYaw: number;
  target: Point2;
  state: 'wander' | 'pause';
  timer: number;
  rng: () => number;
  label: HTMLDivElement;
}

/** Public view of an NPC for the interact chain. */
export interface NpcHandle {
  def: NpcDef;
  pos: Vec3;
}

/** Shortest signed angular delta a → b, wrapped to [−π, π]. */
function angDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class NpcManager {
  private readonly npcs: NpcRuntime[] = [];
  private readonly _project = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const overlay = document.createElement('div');
    overlay.className = 'wt-npc-labels';
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9;';
    document.body.appendChild(overlay);

    const homes = npcHomes();
    for (const def of NPCS) {
      const { group, headY } = buildNpcModel(def);
      const home = homes[def.id]!;
      const y = heightAt(home.x, home.z);
      group.position.set(home.x, y, home.z);
      scene.add(group);

      const label = document.createElement('div');
      label.className = 'wt-npc-label';
      label.textContent = def.name;
      label.style.cssText =
        'position:absolute;transform:translate(-50%,-100%);font:600 13px system-ui,sans-serif;' +
        'color:#fdf6e3;background:rgba(30,22,14,0.72);padding:2px 8px;border-radius:6px;' +
        'white-space:nowrap;text-shadow:0 1px 2px #000;display:none;';
      overlay.appendChild(label);

      const rng = mulberry32(
        (def.id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) ^ 0x1234) >>> 0,
      );
      this.npcs.push({
        def,
        group,
        headY,
        home,
        pos: { x: home.x, y, z: home.z },
        yaw: rng() * Math.PI * 2,
        targetYaw: 0,
        target: { ...home },
        state: 'pause',
        timer: AI.pauseMin + rng() * (AI.pauseMax - AI.pauseMin),
        rng,
        label,
      });
    }
  }

  private pickTarget(n: NpcRuntime): void {
    const a = n.rng() * Math.PI * 2;
    const r = n.rng() * AI.wanderRadius;
    n.target = { x: n.home.x + Math.cos(a) * r, z: n.home.z + Math.sin(a) * r };
  }

  /** Step idle AI + move models. Call `updateLabels(camera)` from render(). */
  update(dt: number, playerPos: Vec3): void {
    for (const n of this.npcs) {
      const toPlayerX = playerPos.x - n.pos.x;
      const toPlayerZ = playerPos.z - n.pos.z;
      const distPlayer = Math.hypot(toPlayerX, toPlayerZ);

      if (distPlayer < AI.faceDist) {
        // Freeze and turn to face the player (the "someone's here" beat).
        n.targetYaw = Math.atan2(toPlayerX, toPlayerZ);
      } else if (n.state === 'pause') {
        n.timer -= dt;
        if (n.timer <= 0) {
          this.pickTarget(n);
          n.state = 'wander';
        }
      } else {
        const dx = n.target.x - n.pos.x;
        const dz = n.target.z - n.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < AI.arriveDist) {
          n.state = 'pause';
          n.timer = AI.pauseMin + n.rng() * (AI.pauseMax - AI.pauseMin);
        } else {
          n.targetYaw = Math.atan2(dx, dz);
          // Only stride forward once roughly facing the target.
          if (Math.abs(angDelta(n.yaw, n.targetYaw)) < 0.5) {
            const step = Math.min(AI.walkSpeed * dt, dist);
            n.pos.x += Math.sin(n.yaw) * step;
            n.pos.z += Math.cos(n.yaw) * step;
          }
        }
      }

      // Rotate toward target yaw, clamped by turn rate.
      const d = angDelta(n.yaw, n.targetYaw);
      const maxTurn = AI.turnRate * dt;
      n.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));

      n.pos.y = heightAt(n.pos.x, n.pos.z);
      n.group.position.set(n.pos.x, n.pos.y, n.pos.z);
      n.group.rotation.y = n.yaw;
    }
  }

  /**
   * Project + place the floating name labels. Hidden when behind the camera or
   * beyond `LABEL_MAX_DIST` (so labels don't render clear across the map). A
   * single de-collision pass nudges any label whose screen rect overlaps an
   * already-placed one upward by its own height (cosmetic — labels use
   * transform translate(-50%,-100%), so the rect is [x±w/2] × [top−h, top]).
   */
  updateLabels(camera: THREE.PerspectiveCamera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const n of this.npcs) {
      // Distance cull: skip labels for NPCs too far from the camera.
      const dx = n.pos.x - camera.position.x;
      const dy = n.pos.y - camera.position.y;
      const dz = n.pos.z - camera.position.z;
      if (Math.hypot(dx, dy, dz) > LABEL_MAX_DIST) {
        n.label.style.display = 'none';
        continue;
      }
      this._project.set(n.pos.x, n.pos.y + n.headY + 0.5, n.pos.z).project(camera);
      if (this._project.z > 1 || this._project.z < -1) {
        n.label.style.display = 'none';
        continue;
      }
      const x = (this._project.x * 0.5 + 0.5) * w;
      let y = (-this._project.y * 0.5 + 0.5) * h;
      n.label.style.display = 'block';

      // De-collision: offset upward by one label height if this rect overlaps
      // any already-placed label (single pass — good enough for a small plaza).
      const lw = n.label.offsetWidth;
      const lh = n.label.offsetHeight;
      const rect = () => ({ l: x - lw / 2, r: x + lw / 2, t: y - lh, b: y });
      for (const p of placed) {
        const q = rect();
        if (q.l < p.r && q.r > p.l && q.t < p.b && q.b > p.t) {
          y -= lh;
          break;
        }
      }
      placed.push(rect());
      n.label.style.left = `${x}px`;
      n.label.style.top = `${y}px`;
    }
  }

  /** Nearest NPC within `maxDist` (XZ) of `pos`, else null — for F-to-talk. */
  nearestNpc(pos: Vec3, maxDist: number): NpcHandle | null {
    let best: NpcHandle | null = null;
    let bestD = maxDist;
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d <= bestD) {
        bestD = d;
        best = { def: n.def, pos: { ...n.pos } };
      }
    }
    return best;
  }
}
