import * as THREE from 'three';
import { VILLAGE } from '../core/constants.ts';
import { mulberry32 } from '../core/rng.ts';
import { heightAt } from '../world/terrain.ts';
import { buildCritterModel, type CritterParts } from '../critters/models.ts';
import { animateCritter } from '../critters/animation.ts';
import { npcAnchors } from './npcs.ts';
import { villageCenter } from './layout.ts';
import type { PenPersistEntry } from '../core/save.ts';

// ---------------------------------------------------------------------------
// Pen system (Haven V4). Critters traded away to an NPC live on, visibly, in a
// small pen beside that NPC's spot — a standing reminder of every trade. Each
// pen is a rectangle just OUTWARD (away from the plaza) of the NPC's anchor;
// the delivered critters render as calm mini critters (buildCritterModel at
// 0.8 scale, idle animation) that puppet a tiny wander inside the pen bounds.
// Keyed by npcId. State is plain data (`serialize()` → save `pens` field).
// ---------------------------------------------------------------------------

/** Mini-critter scale + gentle in-pen wander tuning. */
const PEN = {
  scale: 0.8,
  /** Inset (m) from the pen edge the critter keeps (so it never clips a post). */
  inset: 0.45,
  /** Wander speed (m/s) — a slow calm putter. */
  speed: 0.5,
  /** Seconds between picking a new wander point (uniform [min,max]). */
  pauseMin: 2,
  pauseMax: 5,
  postHeight: 0.7,
  penColor: 0x6b5236,
} as const;

interface PenBounds {
  x: number;
  z: number;
  w: number;
  d: number;
}

interface PenOccupant {
  npcId: string;
  speciesId: string;
  nickname: string;
  group: THREE.Group;
  parts: CritterParts;
  bounds: PenBounds;
  pos: { x: number; z: number };
  target: { x: number; z: number };
  yaw: number;
  timer: number;
  rng: () => number;
}

/** Bounds of `npcId`'s pen: a VILLAGE.pen rect pushed outward from the plaza. */
function penBounds(npcId: string): PenBounds | null {
  const anchor = npcAnchors()[npcId];
  if (!anchor) return null;
  const c = villageCenter();
  let ox = anchor.x - c.x;
  let oz = anchor.z - c.z;
  const len = Math.hypot(ox, oz) || 1;
  ox /= len;
  oz /= len;
  const dist = VILLAGE.pen.gap + VILLAGE.pen.d / 2 + 1.5;
  return {
    x: anchor.x + ox * dist,
    z: anchor.z + oz * dist,
    w: VILLAGE.pen.w,
    d: VILLAGE.pen.d,
  };
}

function post(x: number, z: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.12, PEN.postHeight, 0.12);
  const mat = new THREE.MeshLambertMaterial({ color: PEN.penColor, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, heightAt(x, z) + PEN.postHeight / 2, z);
  return m;
}

export class PenSystem {
  private readonly occupants: PenOccupant[] = [];
  private readonly fenced = new Set<string>();
  private readonly modelRng = mulberry32(0x9e3f ^ 0x515);

  constructor(private readonly scene: THREE.Scene) {}

  /** Add a delivered critter to `npcId`'s pen (renders + starts wandering). */
  add(npcId: string, speciesId: string, nickname: string): void {
    const bounds = penBounds(npcId);
    if (!bounds) return;
    this.ensureFence(npcId, bounds);

    let group: THREE.Group;
    let parts: CritterParts;
    try {
      ({ group, parts } = buildCritterModel(speciesId, this.modelRng));
    } catch {
      return; // unknown species id — skip rather than crash
    }
    group.scale.multiplyScalar(PEN.scale);

    // Spread arrivals around the pen so a herd doesn't stack on one point.
    const rng = mulberry32((this.occupants.length * 2654435761) >>> 0);
    const start = this.randomPoint(bounds, rng);
    const occ: PenOccupant = {
      npcId,
      speciesId,
      nickname,
      group,
      parts,
      bounds,
      pos: start,
      target: this.randomPoint(bounds, rng),
      yaw: rng() * Math.PI * 2,
      timer: PEN.pauseMin + rng() * (PEN.pauseMax - PEN.pauseMin),
      rng,
    };
    group.position.set(start.x, heightAt(start.x, start.z), start.z);
    this.scene.add(group);
    this.occupants.push(occ);
  }

  /** How many critters live in `npcId`'s pen. */
  countFor(npcId: string): number {
    return this.occupants.reduce((n, o) => (o.npcId === npcId ? n + 1 : n), 0);
  }

  private ensureFence(npcId: string, b: PenBounds): void {
    if (this.fenced.has(npcId)) return;
    this.fenced.add(npcId);
    const hw = b.w / 2;
    const hd = b.d / 2;
    for (const [dx, dz] of [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as const) {
      this.scene.add(post(b.x + dx, b.z + dz));
    }
  }

  private randomPoint(b: PenBounds, rng: () => number): { x: number; z: number } {
    const hw = Math.max(0, b.w / 2 - PEN.inset);
    const hd = Math.max(0, b.d / 2 - PEN.inset);
    return { x: b.x + (rng() * 2 - 1) * hw, z: b.z + (rng() * 2 - 1) * hd };
  }

  /** Step the calm in-pen wander + idle animation. Call each sim tick. */
  update(dt: number, worldTime: number): void {
    for (const o of this.occupants) {
      const dx = o.target.x - o.pos.x;
      const dz = o.target.z - o.pos.z;
      const dist = Math.hypot(dx, dz);
      let speed = 0;
      if (dist < 0.15) {
        o.timer -= dt;
        if (o.timer <= 0) {
          o.target = this.randomPoint(o.bounds, o.rng);
          o.timer = PEN.pauseMin + o.rng() * (PEN.pauseMax - PEN.pauseMin);
        }
      } else {
        o.yaw = Math.atan2(dx, dz);
        const step = Math.min(PEN.speed * dt, dist);
        o.pos.x += (dx / dist) * step;
        o.pos.z += (dz / dist) * step;
        speed = PEN.speed;
      }
      const y = heightAt(o.pos.x, o.pos.z);
      o.group.position.set(o.pos.x, y, o.pos.z);
      o.group.rotation.y = o.yaw;
      animateCritter(o.parts, speed, worldTime, dt, o.speciesId);
    }
  }

  /** Restore pens from a save's `pens` field (rebuilds the models). */
  load(entries: readonly PenPersistEntry[]): void {
    for (const e of entries) this.add(e.npcId, e.speciesId, e.nickname);
  }

  /** Plain-data snapshot for the save `pens` field. */
  serialize(): PenPersistEntry[] {
    return this.occupants.map((o) => ({
      npcId: o.npcId,
      speciesId: o.speciesId,
      nickname: o.nickname,
    }));
  }
}
