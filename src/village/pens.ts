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
  /**
   * Max critter models rendered per pen (Haven V7 polish 2b). Trades beyond this
   * still count and persist — they're just represented by a floating "+N" marker
   * instead of an ever-growing mob of models (a perf + readability guard).
   */
  maxVisible: 8,
  /** Height (m) above the pen centre the "+N" overflow marker floats. */
  markerFloat: 2.2,
} as const;

interface PenMarker {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  count: number;
}

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
  /** Data-only trades beyond `PEN.maxVisible` per pen (persisted, not rendered). */
  private readonly overflow: PenPersistEntry[] = [];
  private readonly markers = new Map<string, PenMarker>();
  private readonly fenced = new Set<string>();
  private readonly modelRng = mulberry32(0x9e3f ^ 0x515);

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Add a delivered critter to `npcId`'s pen. The first `PEN.maxVisible` per pen
   * render as wandering models; beyond that the trade is kept as data only and
   * surfaced via a floating "+N" marker (Haven V7 polish 2b).
   */
  add(npcId: string, speciesId: string, nickname: string): void {
    const bounds = penBounds(npcId);
    if (!bounds) return;
    this.ensureFence(npcId, bounds);

    // Cap rendered occupants per pen; overflow trades still count + persist.
    if (this.renderedFor(npcId) >= PEN.maxVisible) {
      this.overflow.push({ npcId, speciesId, nickname });
      this.updateMarker(npcId, bounds);
      return;
    }

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

  /** How many critters (rendered + overflow) live in `npcId`'s pen. */
  countFor(npcId: string): number {
    return this.renderedFor(npcId) + this.overflow.reduce((n, o) => (o.npcId === npcId ? n + 1 : n), 0);
  }

  /** How many critter MODELS are currently rendered for `npcId`'s pen. */
  private renderedFor(npcId: string): number {
    return this.occupants.reduce((n, o) => (o.npcId === npcId ? n + 1 : n), 0);
  }

  /** Create/redraw the floating "+N" overflow marker over `npcId`'s pen. */
  private updateMarker(npcId: string, b: PenBounds): void {
    const n = this.overflow.reduce((c, o) => (o.npcId === npcId ? c + 1 : c), 0);
    let m = this.markers.get(npcId);
    if (!m) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
      sprite.scale.set(1.4, 0.7, 1);
      sprite.position.set(b.x, heightAt(b.x, b.z) + PEN.markerFloat, b.z);
      this.scene.add(sprite);
      m = { sprite, canvas, texture, count: 0 };
      this.markers.set(npcId, m);
    }
    if (m.count === n) return;
    m.count = n;
    const ctx = m.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
    ctx.fillStyle = 'rgba(20,16,10,0.72)';
    ctx.fillRect(0, 0, m.canvas.width, m.canvas.height);
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#f3e3b0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${n}`, m.canvas.width / 2, m.canvas.height / 2);
    m.texture.needsUpdate = true;
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

  /** Plain-data snapshot for the save `pens` field (rendered + overflow trades). */
  serialize(): PenPersistEntry[] {
    return [
      ...this.occupants.map((o) => ({
        npcId: o.npcId,
        speciesId: o.speciesId,
        nickname: o.nickname,
      })),
      ...this.overflow.map((o) => ({ ...o })),
    ];
  }
}
