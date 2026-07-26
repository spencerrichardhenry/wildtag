import * as THREE from 'three';
import { PURIFIER } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import { spawnDart, stepDart, type DartState } from '../tracking/darts.ts';
import { blip } from '../ui/audio.ts';

// ---------------------------------------------------------------------------
// Purifying darts (Cursed Castle Task 13): hotbar slot 5's fire path. Reuses
// the tracker dart's pure ballistic core (`spawnDart`/`stepDart` from
// tracking/darts.ts — same speed/gravity/maxLife, just re-skinned in
// PURIFIER.color) so a purifying dart flies identically to a tracker dart.
// The three.js owner (`PurifierSystem`) mirrors `DartSystem`'s LiveDart
// mesh/trail pattern (tracking/darts.ts:122-244) almost verbatim; the only
// new behaviour is the hit resolution: goblins first, then the (Task 14)
// crystal, each landing a sparkle burst + a distinct hit blip instead of
// tagging a critter.
// ---------------------------------------------------------------------------

/** Squared distance from point `p` to the segment `a`→`b` (mirrors
 *  tracking/darts.ts's private helper of the same shape — not exported
 *  there, so re-derived here rather than reaching into that module). */
function segPointDist2(a: Vec3, b: Vec3, p: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The id of the target (goblin, or the crystal caller-supplied id) whose
 * sphere (radius `r`) the dart's last travel segment (`prev`→`pos`) passed
 * through this step, or null. Swept test — mirrors `dartHitCritter`
 * (tracking/darts.ts) exactly, just against `{ id, pos, r }` targets instead
 * of critter views. Of the spheres swept, the one nearest the dart's current
 * position wins.
 */
export function dartHitTarget(
  d: DartState,
  targets: { id: number; pos: Vec3; r: number }[],
): number | null {
  let bestId: number | null = null;
  let bestD2 = Infinity;
  for (const t of targets) {
    if (segPointDist2(d.prev, d.pos, t.pos) > t.r * t.r) continue;
    const dx = t.pos.x - d.pos.x;
    const dy = t.pos.y - d.pos.y;
    const dz = t.pos.z - d.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestId = t.id;
    }
  }
  return bestId;
}

// ---------------------------------------------------------------------------
// three.js dart owner (mirrors DartSystem's LiveDart shape).
// ---------------------------------------------------------------------------

interface LiveDart {
  state: DartState;
  mesh: THREE.Mesh;
  trail: THREE.Line;
  positions: Vec3[];
}

/** A short-lived expanding sparkle-burst shell, played on a purify hit. */
interface LiveBurst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  /** Unit-sphere directions (one per point) the shell expands along. */
  dirs: Float32Array;
  origin: Vec3;
  age: number;
}

const TRAIL_LENGTH = 10;
const BURST_COUNT = 40;

export interface PurifierOpts {
  /** Live goblin id/pos/hit-radius, tested before critters/the crystal (Task 11). */
  goblinTargets: () => { id: number; pos: Vec3; r: number }[];
  /** Called with the purified goblin's id on a hit. */
  onPurifyGoblin: (id: number) => void;
  /**
   * Live critter id/pos/radius (spec §5, final-review fix): tested after
   * goblins, before the crystal — a purifying dart landing on an ordinary
   * critter (e.g. a gargoyle) is a harmless sparkle, never a goblin-style
   * purify or a tracker-style tag. A goblin standing in front of a critter
   * still gets purified first (goblins win the priority tie).
   */
  critterTargets: () => { id: number; pos: Vec3; r: number }[];
  /** The corruption crystal's live target, or null before it exists
   *  (Task 14 fills this in — this task only wires the callback shape). */
  crystalTarget: () => { pos: Vec3; r: number; active: boolean } | null;
  /** Called on a landed crystal hit (Task 14 gives it an effect). */
  onPurifyCrystal: () => void;
}

export class PurifierSystem {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly inventory: Inventory;
  private readonly ground: GroundQuery;
  private readonly opts: PurifierOpts;
  private readonly live: LiveDart[] = [];
  private readonly bursts: LiveBurst[] = [];
  private readonly _dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    inventory: Inventory,
    ground: GroundQuery,
    opts: PurifierOpts,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.inventory = inventory;
    this.ground = ground;
    this.opts = opts;
  }

  /**
   * Throw a purifying dart from the camera along its look direction,
   * spending one from inventory. No-op (returns false) when out of
   * purifiers.
   */
  tryThrow(): boolean {
    if (this.inventory.purifiers <= 0) return false;
    this.inventory.purifiers -= 1;
    const cp = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    const state = spawnDart(
      { x: cp.x, y: cp.y, z: cp.z },
      { x: this._dir.x, y: this._dir.y, z: this._dir.z },
    );

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
      new THREE.MeshBasicMaterial({ color: PURIFIER.color }),
    );
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3),
    );
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: PURIFIER.color, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(mesh);
    this.scene.add(trail);
    this.live.push({ state, mesh, trail, positions: [{ ...state.pos }] });
    blip(660, 0.05);
    return true;
  }

  /**
   * Advance every live dart, render it, and resolve hits in priority order:
   * goblins first (purified), then critters (spec §5 — harmless sparkle,
   * nothing tagged/tracked/transformed), then the crystal (only when
   * `crystalTarget()` is non-null and `.active`). Also ages/removes sparkle
   * bursts.
   */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const dart = this.live[i]!;
      dart.state = stepDart(dart.state, dt, this.ground);
      const p = dart.state.pos;

      const goblins = this.opts.goblinTargets();
      const hitGoblin = dartHitTarget(dart.state, goblins);
      if (hitGoblin !== null) {
        const target = goblins.find((g) => g.id === hitGoblin)!;
        this.opts.onPurifyGoblin(hitGoblin);
        this.spawnBurst(target.pos);
        blip(1200, 0.08);
        this.removeAt(i);
        continue;
      }

      // Spec §5: a purifying dart landing on an ordinary critter is a
      // harmless sparkle — the dart is simply consumed, nothing is tagged,
      // tracked, or transformed. Tested here so a critter can legitimately
      // shield the goblins/crystal behind it, exactly like a goblin does.
      const critters = this.opts.critterTargets();
      const hitCritter = dartHitTarget(dart.state, critters);
      if (hitCritter !== null) {
        const target = critters.find((c) => c.id === hitCritter)!;
        this.spawnBurst(target.pos);
        blip(1200, 0.08);
        this.removeAt(i);
        continue;
      }

      const crystal = this.opts.crystalTarget();
      if (crystal && crystal.active) {
        const hitCrystal = dartHitTarget(dart.state, [{ id: 0, pos: crystal.pos, r: crystal.r }]);
        if (hitCrystal !== null) {
          this.opts.onPurifyCrystal();
          this.spawnBurst(crystal.pos);
          blip(1200, 0.08);
          this.removeAt(i);
          continue;
        }
      }

      // Orient the dart body along its velocity and place it.
      dart.mesh.position.set(p.x, p.y, p.z);
      const v = dart.state.vel;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 1e-4) {
        this._dir.set(v.x / speed, v.y / speed, v.z / speed);
        dart.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._dir);
      }

      // Fading trail: push the newest position, keep the last N, rewrite verts.
      dart.positions.push({ x: p.x, y: p.y, z: p.z });
      if (dart.positions.length > TRAIL_LENGTH) dart.positions.shift();
      const attr = dart.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < TRAIL_LENGTH; j++) {
        const src = dart.positions[Math.min(j, dart.positions.length - 1)]!;
        arr[j * 3] = src.x;
        arr[j * 3 + 1] = src.y;
        arr[j * 3 + 2] = src.z;
      }
      attr.needsUpdate = true;

      if (dart.state.dead) this.removeAt(i);
    }

    this.updateBursts(dt);
  }

  /** Dispose every live dart + sparkle burst (teardown). */
  dispose(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.removeAt(i);
    for (let i = this.bursts.length - 1; i >= 0; i--) this.removeBurst(i);
  }

  // -------------------------------------------------------------------------

  private removeAt(i: number): void {
    const dart = this.live[i]!;
    this.scene.remove(dart.mesh);
    this.scene.remove(dart.trail);
    dart.mesh.geometry.dispose();
    (dart.mesh.material as THREE.Material).dispose();
    dart.trail.geometry.dispose();
    (dart.trail.material as THREE.Material).dispose();
    this.live.splice(i, 1);
  }

  /** A short-lived expanding shell of ~40 points, additive + fading, at `origin`. */
  private spawnBurst(origin: Vec3): void {
    const dirs = new Float32Array(BURST_COUNT * 3);
    const positions = new Float32Array(BURST_COUNT * 3);
    for (let i = 0; i < BURST_COUNT; i++) {
      // Uniform-on-sphere via the classic z/azimuth parametrisation.
      const z = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      dirs[i * 3] = Math.cos(theta) * r;
      dirs[i * 3 + 1] = Math.sin(theta) * r;
      dirs[i * 3 + 2] = z;
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: PURIFIER.color,
      size: 0.16,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, material);
    this.scene.add(points);
    this.bursts.push({ points, material, dirs, origin: { ...origin }, age: 0 });
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      if (b.age >= PURIFIER.burstS) {
        this.removeBurst(i);
        continue;
      }
      const t = b.age / PURIFIER.burstS;
      const radius = t * PURIFIER.burstR;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < BURST_COUNT; j++) {
        arr[j * 3] = b.origin.x + b.dirs[j * 3]! * radius;
        arr[j * 3 + 1] = b.origin.y + b.dirs[j * 3 + 1]! * radius;
        arr[j * 3 + 2] = b.origin.z + b.dirs[j * 3 + 2]! * radius;
      }
      attr.needsUpdate = true;
      b.material.opacity = 1 - t;
    }
  }

  private removeBurst(i: number): void {
    const b = this.bursts[i]!;
    this.scene.remove(b.points);
    b.points.geometry.dispose();
    b.material.dispose();
    this.bursts.splice(i, 1);
  }
}
