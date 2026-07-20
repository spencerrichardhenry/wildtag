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
function blob(r: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), mat(color));
}

/**
 * Build a blocky villager for `def`. Model faces +Z, feet at y=0. Base is a
 * two-legged humanoid; the silhouette adds a distinguishing accessory. Returns
 * the group and its head height (for label projection).
 */
function buildNpcModel(def: NpcDef): { group: THREE.Group; headY: number } {
  const g = new THREE.Group();
  const small = def.silhouette === 'small';
  const s = small ? 0.72 : 1;
  const legH = 0.42 * s;
  const torsoH = (def.silhouette === 'cane' ? 0.56 : 0.68) * s; // Bram hunches
  const torsoW = 0.42 * s;
  const torsoD = 0.26 * s;

  for (const sx of [-1, 1]) {
    const leg = box(0.15 * s, legH, 0.16 * s, def.accent);
    leg.position.set(sx * 0.11 * s, legH / 2, 0);
    g.add(leg);
  }
  const torsoY = legH + torsoH / 2;
  const torso = box(torsoW, torsoH, torsoD, def.color);
  torso.position.set(0, torsoY, 0);
  g.add(torso);
  for (const sx of [-1, 1]) {
    const arm = box(0.12 * s, torsoH * 0.9, 0.14 * s, def.color);
    arm.position.set(sx * (torsoW / 2 + 0.07 * s), torsoY + 0.02, 0);
    g.add(arm);
  }
  const headR = 0.19 * s;
  const headY = legH + torsoH + headR;
  const head = box(headR * 2, headR * 2, headR * 2, 0xd9b98f);
  head.position.set(0, headY, 0);
  g.add(head);
  for (const sx of [-1, 1]) {
    const eye = blob(0.035 * s, 0x161018);
    eye.position.set(sx * 0.07 * s, headY + 0.02, headR);
    g.add(eye);
  }

  // Silhouette accessories.
  if (def.silhouette === 'hat') {
    const brim = box(0.5 * s, 0.05 * s, 0.5 * s, def.accent);
    brim.position.set(0, headY + headR, 0);
    g.add(brim);
    const crown = box(0.28 * s, 0.26 * s, 0.28 * s, def.accent);
    crown.position.set(0, headY + headR + 0.16 * s, 0);
    g.add(crown);
  } else if (def.silhouette === 'apron') {
    const apron = box(torsoW * 0.9, torsoH * 0.8, 0.05, def.accent);
    apron.position.set(0, torsoY - 0.02, torsoD / 2 + 0.02);
    g.add(apron);
    // straw hat
    const brim = box(0.46 * s, 0.04 * s, 0.46 * s, 0xcbb056);
    brim.position.set(0, headY + headR, 0);
    g.add(brim);
  } else if (def.silhouette === 'pack') {
    const pack = box(torsoW * 0.8, torsoH * 0.85, 0.2, def.accent);
    pack.position.set(0, torsoY + 0.05, -torsoD / 2 - 0.12);
    g.add(pack);
    const cap = box(0.34 * s, 0.12 * s, 0.34 * s, def.accent);
    cap.position.set(0, headY + headR + 0.02, 0);
    g.add(cap);
  } else if (def.silhouette === 'cane') {
    const cane = box(0.05, legH + torsoH + 0.1, 0.05, def.accent);
    cane.position.set(torsoW / 2 + 0.16, (legH + torsoH) / 2, 0.16);
    g.add(cane);
    // grey tuft of hair
    const hair = box(headR * 2.1, 0.08, headR * 2.1, 0xe8e4dd);
    hair.position.set(0, headY + headR, 0);
    g.add(hair);
  } else {
    // small kid: a little cowlick
    const tuft = box(0.08, 0.14, 0.08, def.accent);
    tuft.position.set(0, headY + headR + 0.05, 0);
    g.add(tuft);
  }

  return { group: g, headY };
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
