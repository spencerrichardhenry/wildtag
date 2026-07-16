import * as THREE from 'three';
import { MOVE, STRUCTURES } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { toast } from '../ui/toasts.ts';
import type { Input } from '../player/input.ts';
import type { PlayerController } from '../player/controller.ts';

// ---------------------------------------------------------------------------
// Ziplines (Task 13). Split, like the grapple, into a THREE-free pure core
// (`validateZipline` / `zipRide` / `zipPoint` + the `stepHold` tap-vs-recall
// timer) and a thin three.js owner (`ZiplineSystem`: posts + sagging cable
// meshes, placement/recall bookkeeping and the ride state machine).
//
// The cable follows a quadratic sag curve dipping `STRUCTURES.sag` metres below
// the straight chord at its midpoint — used for BOTH the rendered tube and the
// ride path, so validation, visuals and kinematics agree. Riding advances a
// parameter t∈[0,1] at a slope-assisted speed; the controller is fed pos/vel
// each step (it skips its normal movement pipeline while `mode==='zipline'`).
// ---------------------------------------------------------------------------

export interface ZipValidation {
  ok: boolean;
  reason?: 'length' | 'los';
}

/**
 * A point on the cable at parameter `t`∈[0,1]: linear interpolation of the two
 * endpoints minus a quadratic dip peaking at `STRUCTURES.sag` at the midpoint.
 * Pure.
 */
export function zipPoint(t: number, a: Vec3, b: Vec3): Vec3 {
  const dip = STRUCTURES.sag * 4 * t * (1 - t); // 0 at ends, sag at t=0.5
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t - dip,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Validate a candidate zipline A→B against the terrain. Pure — `heightAtFn` is
 * injected. Rejects a span longer than `ziplineMaxLen` ('length') or one whose
 * sagging cable dips within `losClearance` of the ground at any interior sample
 * ('los'). The two endpoints are allowed to sit on the terrain (only interior
 * samples are checked), so a post planted on a hillside is fine.
 */
export function validateZipline(
  a: Vec3,
  b: Vec3,
  heightAtFn: (x: number, z: number) => number,
): ZipValidation {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (len > STRUCTURES.ziplineMaxLen) return { ok: false, reason: 'length' };
  const n = STRUCTURES.losSamples;
  for (let i = 1; i < n; i++) {
    const p = zipPoint(i / n, a, b);
    if (p.y - heightAtFn(p.x, p.z) < STRUCTURES.losClearance) {
      return { ok: false, reason: 'los' };
    }
  }
  return { ok: true };
}

export interface ZipRideResult {
  /** Advanced parameter, clamped to 1. */
  t: number;
  /** Cable point at the advanced parameter (rider hangs below this). */
  pos: Vec3;
  /** Velocity along the chord at the current ride speed. */
  vel: Vec3;
  /** True once the far end is reached (t clamped to 1). */
  done: boolean;
}

/**
 * Advance a ride one step. Speed is `ziplineSpeed` biased by slope: a downhill
 * run (b below a) gains up to `slopeAssist`, an uphill loses up to it, clamped
 * to `minSpeed`. `t` moves at speed/length. The returned velocity points along
 * the A→B chord at that speed — the "exit velocity" preserved on dismount. Pure.
 */
export function zipRide(t: number, a: Vec3, b: Vec3, dt: number): ZipRideResult {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const slope = (a.y - b.y) / len; // +1 straight down, -1 straight up
  const speed = Math.max(STRUCTURES.minSpeed, STRUCTURES.ziplineSpeed + STRUCTURES.slopeAssist * slope);
  let nt = t + (speed / len) * dt;
  const done = nt >= 1;
  if (nt > 1) nt = 1;
  return {
    t: nt,
    pos: zipPoint(nt, a, b),
    vel: { x: (dx / len) * speed, y: (dy / len) * speed, z: (dz / len) * speed },
    done,
  };
}

// ---------------------------------------------------------------------------
// Mount-vs-recall hold timer (pure). Near a post, a quick tap of F mounts; a
// sustained hold arms and then fires a one-shot recall. A mid-length hold
// (released after the tap window but before the recall threshold) does nothing,
// so the two gestures never collide.
// ---------------------------------------------------------------------------

export type HoldPhase = 'idle' | 'holding' | 'recalled';
export interface HoldState {
  phase: HoldPhase;
  elapsed: number;
}
export const initialHold: HoldState = { phase: 'idle', elapsed: 0 };

export interface HoldResult {
  next: HoldState;
  action: 'mount' | 'recall' | null;
}

/** Step the hold timer for one sim step given whether F is currently held. */
export function stepHold(s: HoldState, held: boolean, dt: number): HoldResult {
  if (held) {
    if (s.phase === 'idle') return { next: { phase: 'holding', elapsed: dt }, action: null };
    if (s.phase === 'holding') {
      const elapsed = s.elapsed + dt;
      if (elapsed >= STRUCTURES.recallHold) {
        return { next: { phase: 'recalled', elapsed }, action: 'recall' };
      }
      return { next: { phase: 'holding', elapsed }, action: null };
    }
    // Already recalled while still held — no repeat.
    return { next: { phase: 'recalled', elapsed: s.elapsed + dt }, action: null };
  }
  // Released.
  if (s.phase === 'holding' && s.elapsed < STRUCTURES.recallTap) {
    return { next: { ...initialHold }, action: 'mount' };
  }
  return { next: { ...initialHold }, action: null };
}

// ---------------------------------------------------------------------------
// three.js zipline owner.
// ---------------------------------------------------------------------------

export interface PlacedZipline {
  id: string;
  a: Vec3;
  b: Vec3;
}

interface ZipMesh extends PlacedZipline {
  group: THREE.Group;
}

/** A post/cable mount the player is standing near, for the ride prompt. */
export interface MountHit {
  id: string;
  end: 'a' | 'b';
  post: Vec3;
}

const CABLE_SEGMENTS = 24;
const POST_COLOR = 0x6b5030;
const CABLE_COLOR = 0x2a2a2e;

export class ZiplineSystem {
  private readonly scene: THREE.Scene;
  private readonly ground: GroundQuery;
  private readonly inventory: { kits: { zipline: number } };
  private readonly lines = new Map<string, ZipMesh>();
  private nextId = 0;

  /** Active ride, or null when the player is not on a cable. */
  private ride: { id: string; from: Vec3; to: Vec3; t: number } | null = null;
  /** Mount/recall hold timer while standing near a post (not riding). */
  private hold: HoldState = { ...initialHold };
  /** Debounce the "Recalling…" toast so it fires once per hold. */
  private recallToasted = false;

  constructor(
    scene: THREE.Scene,
    ground: GroundQuery,
    inventory: { kits: { zipline: number } },
  ) {
    this.scene = scene;
    this.ground = ground;
    this.inventory = inventory;
  }

  get count(): number {
    return this.lines.size;
  }

  /** True while the player is on a cable (main suppresses darts then). */
  get riding(): boolean {
    return this.ride !== null;
  }

  /**
   * Place a cable from A to B. Consumes a zipline kit on success. Rejected when
   * the cap is hit ('max'), no kit is held ('nokit'), or validation fails.
   */
  place(a: Vec3, b: Vec3): { ok: boolean; reason?: 'max' | 'nokit' | 'length' | 'los'; id?: string } {
    if (this.lines.size >= STRUCTURES.maxZiplines) return { ok: false, reason: 'max' };
    const v = validateZipline(a, b, this.ground.heightAt);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (this.inventory.kits.zipline <= 0) return { ok: false, reason: 'nokit' };
    this.inventory.kits.zipline -= 1;
    const id = `zip${this.nextId++}`;
    const group = this.buildMesh(a, b);
    this.scene.add(group);
    this.lines.set(id, { id, a: { ...a }, b: { ...b }, group });
    return { ok: true, id };
  }

  /** Remove a cable and refund its kit. Returns false if the id is unknown. */
  recall(id: string): boolean {
    const line = this.lines.get(id);
    if (!line) return false;
    this.scene.remove(line.group);
    disposeGroup(line.group);
    this.lines.delete(id);
    this.inventory.kits.zipline += 1;
    if (this.ride?.id === id) this.ride = null;
    return true;
  }

  /** Endpoints of a placed cable (ride target lookup). */
  lineById(id: string): PlacedZipline | null {
    const l = this.lines.get(id);
    return l ? { id: l.id, a: { ...l.a }, b: { ...l.b } } : null;
  }

  /** Nearest mountable post within `mountRange` of `pos` (horizontal), or null. */
  nearestMount(pos: Vec3): MountHit | null {
    let best: MountHit | null = null;
    let bestD: number = STRUCTURES.mountRange;
    for (const line of this.lines.values()) {
      for (const end of ['a', 'b'] as const) {
        const p = end === 'a' ? line.a : line.b;
        const d = Math.hypot(pos.x - p.x, pos.z - p.z);
        if (d <= bestD) {
          bestD = d;
          best = { id: line.id, end, post: { ...p } };
        }
      }
    }
    return best;
  }

  /** True if a mountable post is within range (main gates harvest on this). */
  nearMount(pos: Vec3): boolean {
    return this.nearestMount(pos) !== null;
  }

  /**
   * Per-step ride / mount / recall handler, driven from main while play is
   * active. Reads held F (mount tap / recall hold) and held Space (jump-off)
   * from `input`, and drives the controller's ride hooks. Returns true when it
   * "owns" the player this step so main can suppress harvest/dart input.
   */
  updateRide(dt: number, controller: PlayerController, playerPos: Vec3, input: Input): boolean {
    // --- Riding: advance along the cable ---------------------------------
    if (this.ride) {
      const r = zipRide(this.ride.t, this.ride.from, this.ride.to, dt);
      this.ride.t = r.t;
      // Hang below the cable, but never let the feet punch through terrain on
      // the sag dip — clamp to just above the ground beneath the ride point.
      const groundY = this.ground.heightAt(r.pos.x, r.pos.z);
      const feetY = Math.max(r.pos.y - STRUCTURES.ziplineHang, groundY + 0.1);
      controller.rideStep({ x: r.pos.x, y: feetY, z: r.pos.z }, r.vel);

      // Space jumps off: exit velocity = ride velocity + an upward hop.
      if (input.spaceHeld) {
        controller.rideEnd({ x: r.vel.x, y: r.vel.y + MOVE.jumpVel, z: r.vel.z });
        input.clearEdges(); // don't let the jump keydown re-fire in normal mode
        this.ride = null;
        return true;
      }
      // Auto-dismount at the far end with the ride velocity preserved.
      if (r.done) {
        controller.rideEnd(r.vel);
        input.clearEdges();
        this.ride = null;
      }
      return true;
    }

    // --- Not riding: mount / recall from a nearby post -------------------
    const mount = this.nearestMount(playerPos);
    if (!mount) {
      this.hold = { ...initialHold };
      this.recallToasted = false;
      return false;
    }
    const held = input.interactHeld;
    const prev = this.hold;
    const res = stepHold(prev, held, dt);
    this.hold = res.next;

    // "Recalling…" feedback once the hold passes the tap window.
    if (
      res.next.phase === 'holding' &&
      res.next.elapsed >= STRUCTURES.recallTap &&
      !this.recallToasted
    ) {
      this.recallToasted = true;
      toast('Recalling…');
    }
    if (res.next.phase === 'idle') this.recallToasted = false;

    if (res.action === 'recall') {
      this.recall(mount.id);
      toast('Zipline recalled');
      return true;
    }
    if (res.action === 'mount') {
      this.mount(controller, mount);
      input.clearEdges();
      return true;
    }
    // Own the F input while a hold is in progress so harvest doesn't fire.
    return held || this.hold.phase !== 'idle';
  }

  private mount(controller: PlayerController, mount: MountHit): void {
    const line = this.lines.get(mount.id);
    if (!line) return;
    // Ride away from the mounted post toward the far end.
    const from = mount.end === 'a' ? line.a : line.b;
    const to = mount.end === 'a' ? line.b : line.a;
    this.ride = { id: mount.id, from: { ...from }, to: { ...to }, t: 0 };
    this.hold = { ...initialHold };
    controller.rideStart();
    toast('Riding zipline');
  }

  /** Live snapshot of placed cables (persistence / debug). */
  list(): PlacedZipline[] {
    return [...this.lines.values()].map((l) => ({ id: l.id, a: { ...l.a }, b: { ...l.b } }));
  }

  /** Plain-data snapshot for Task 14 save/load. */
  serialize(): PlacedZipline[] {
    return this.list();
  }

  /** Rebuild cables from plain data (clears any current lines first). */
  deserialize(data: PlacedZipline[]): void {
    for (const id of [...this.lines.keys()]) {
      const line = this.lines.get(id)!;
      this.scene.remove(line.group);
      disposeGroup(line.group);
    }
    this.lines.clear();
    this.ride = null;
    for (const z of data) {
      const group = this.buildMesh(z.a, z.b);
      this.scene.add(group);
      this.lines.set(z.id, { id: z.id, a: { ...z.a }, b: { ...z.b }, group });
      const n = Number(z.id.replace('zip', ''));
      if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
    }
  }

  /** Posts at both endpoints + a sagging cable tube between them. */
  private buildMesh(a: Vec3, b: Vec3): THREE.Group {
    const group = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.85, metalness: 0.05 });
    for (const end of [a, b]) {
      const groundY = this.ground.heightAt(end.x, end.z);
      const h = Math.max(0.5, end.y - groundY);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 8), postMat);
      post.position.set(end.x, groundY + h / 2, end.z);
      group.add(post);
    }
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= CABLE_SEGMENTS; i++) {
      const p = zipPoint(i / CABLE_SEGMENTS, a, b);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, CABLE_SEGMENTS, 0.04, 5, false),
      new THREE.MeshStandardMaterial({ color: CABLE_COLOR, roughness: 0.6, metalness: 0.4 }),
    );
    tube.frustumCulled = false;
    group.add(tube);
    return group;
  }
}

/** Dispose every geometry + material under a group (mesh teardown). */
function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
