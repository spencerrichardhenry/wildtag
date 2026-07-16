import * as THREE from 'three';
import { DART } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import type { CritterManager } from '../critters/manager.ts';
import type { Inventory } from '../craft/inventory.ts';
import { speciesById } from '../critters/species.ts';
import { blip } from '../ui/audio.ts';

// ---------------------------------------------------------------------------
// Tracker darts (Task 10). The pure core (`stepDart` / `dartHitCritter`) is
// three-free ballistic math: a dart launches at DART.speed along the throw
// direction, integrates under DART.gravity, and dies on ground contact or
// after DART.maxLife seconds. A dart tags the first critter whose
// (species.size) sphere it enters. `DartSystem` is the thin three.js owner:
// it reads camera pos/dir on throw, spends an inventory dart, renders a small
// elongated mesh + fading trail per live dart, and on a critter hit calls
// `manager.setTagged` (which lights the tracking beacon on the critter).
// ---------------------------------------------------------------------------

/** Pure ballistic state of one dart in flight. */
export interface DartState {
  pos: Vec3;
  vel: Vec3;
  /** Seconds alive. */
  age: number;
  /** Set once the dart has hit ground or expired — the renderer removes it. */
  dead: boolean;
}

/** A dart just thrown from `origin` travelling `dir` (need not be unit). */
export function spawnDart(origin: Vec3, dir: Vec3): DartState {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const s = DART.speed / len;
  return {
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: { x: dir.x * s, y: dir.y * s, z: dir.z * s },
    age: 0,
    dead: false,
  };
}

/**
 * Advance a dart by `dt` (semi-implicit Euler). Applies gravity, integrates
 * position, and marks the dart dead on ground contact or once it has lived
 * past DART.maxLife. Pure: returns a new DartState, never mutates the input.
 */
export function stepDart(d: DartState, dt: number, g: GroundQuery): DartState {
  if (d.dead) return d;
  const vy = d.vel.y + DART.gravity * dt;
  const pos: Vec3 = {
    x: d.pos.x + d.vel.x * dt,
    y: d.pos.y + vy * dt,
    z: d.pos.z + d.vel.z * dt,
  };
  const age = d.age + dt;
  const groundY = g.heightAt(pos.x, pos.z);
  const dead = pos.y <= groundY || age >= DART.maxLife;
  return { pos, vel: { x: d.vel.x, y: vy, z: d.vel.z }, age, dead };
}

/**
 * The id of the nearest critter whose sphere (radius = its species.size) the
 * dart currently overlaps, or null. `size` is passed per critter so callers
 * can supply the live view list directly.
 */
export function dartHitCritter(
  d: DartState,
  critters: { id: number; pos: Vec3; size: number }[],
): number | null {
  let bestId: number | null = null;
  let bestD2 = Infinity;
  for (const c of critters) {
    const dx = c.pos.x - d.pos.x;
    const dy = c.pos.y - d.pos.y;
    const dz = c.pos.z - d.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= c.size * c.size && d2 < bestD2) {
      bestD2 = d2;
      bestId = c.id;
    }
  }
  return bestId;
}

// ---------------------------------------------------------------------------
// three.js dart owner.
// ---------------------------------------------------------------------------

interface LiveDart {
  state: DartState;
  mesh: THREE.Mesh;
  trail: THREE.Line;
  positions: Vec3[];
}

const DART_COLOR = 0xffd24a;

export class DartSystem {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly manager: CritterManager;
  private readonly inventory: Inventory;
  private readonly ground: GroundQuery;
  private readonly live: LiveDart[] = [];
  private readonly _dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    manager: CritterManager,
    inventory: Inventory,
    ground: GroundQuery,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.manager = manager;
    this.inventory = inventory;
    this.ground = ground;
  }

  /**
   * Throw a dart from the camera along its look direction, spending one
   * inventory dart. No-op (returns false) when the player is out of darts.
   */
  tryThrow(): boolean {
    if (this.inventory.darts <= 0) return false;
    this.inventory.darts -= 1;
    const cp = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    const state = spawnDart(
      { x: cp.x, y: cp.y, z: cp.z },
      { x: this._dir.x, y: this._dir.y, z: this._dir.z },
    );

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
      new THREE.MeshBasicMaterial({ color: DART_COLOR }),
    );
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(DART.trailLength * 3), 3),
    );
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: DART_COLOR, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(mesh);
    this.scene.add(trail);
    this.live.push({ state, mesh, trail, positions: [{ ...state.pos }] });
    blip(660, 0.05);
    return true;
  }

  /** Advance every live dart, render it, and resolve critter/ground hits. */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const dart = this.live[i]!;
      dart.state = stepDart(dart.state, dt, this.ground);
      const p = dart.state.pos;

      // Critter hit test against the live view list (sphere = species.size).
      const targets = this.manager.list().map((c) => ({
        id: c.id,
        pos: c.pos,
        size: speciesById(c.species)?.size ?? 0.5,
      }));
      const hitId = dartHitCritter(dart.state, targets);
      if (hitId !== null) {
        this.manager.setTagged(hitId);
        blip(880, 0.06);
        this.removeAt(i);
        continue;
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
      if (dart.positions.length > DART.trailLength) dart.positions.shift();
      const attr = dart.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < DART.trailLength; j++) {
        const src = dart.positions[Math.min(j, dart.positions.length - 1)]!;
        arr[j * 3] = src.x;
        arr[j * 3 + 1] = src.y;
        arr[j * 3 + 2] = src.z;
      }
      attr.needsUpdate = true;

      if (dart.state.dead) this.removeAt(i);
    }
  }

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

  /** Dispose every live dart (teardown). */
  dispose(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.removeAt(i);
  }
}
