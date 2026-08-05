import * as THREE from 'three';
import { STRUCTURES } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { toast } from '../ui/toasts.ts';
import type { AnchorRegistry } from './anchors.ts';
import { initialHold, stepHold, type HoldState } from './ziplines.ts';
import type { Input } from '../player/input.ts';

// ---------------------------------------------------------------------------
// Drones (Task 13): a deployable quad-rotor that ascends to a fixed altitude
// above where it was placed and station-holds with a gentle cosmetic bob. Once
// at altitude it registers a grapple anchor sphere with the AnchorRegistry —
// so a drone becomes an instant, movable grapple point overhead. Recall by
// standing beneath it and holding F; the kit is refunded and the anchor freed.
//
// The drone never winches the player up: the anchor is a static-height sphere
// the grapple reels toward under normal stamina rules; it does not lift.
// ---------------------------------------------------------------------------

/** Station-keeping altitude for a drone placed over ground at height `groundY`. */
export function hoverAltitude(groundY: number): number {
  return groundY + STRUCTURES.droneHover;
}

export interface DroneData {
  id: string;
  x: number;
  z: number;
}

interface Drone {
  id: string;
  x: number;
  z: number;
  groundY: number;
  targetY: number;
  /** Current altitude (feeds the live anchor getPos). */
  y: number;
  age: number;
  atAltitude: boolean;
  registered: boolean;
  anchorId: string;
  group: THREE.Group;
  rotors: THREE.Mesh[];
}

const BODY_COLOR = 0x2b3038;
const ROTOR_COLOR = 0x9aa4ad;
const LIGHT_COLOR = 0x66ddff;

export class DroneSystem {
  private readonly scene: THREE.Scene;
  private readonly ground: GroundQuery;
  private readonly anchors: AnchorRegistry;
  private readonly inventory: { kits: { drone: number } };
  private readonly drones = new Map<string, Drone>();
  private nextId = 0;

  /** F-hold timer + toast debounce for proximity recall. */
  private recallHold: HoldState = { ...initialHold };
  private recallToasted = false;

  constructor(
    scene: THREE.Scene,
    ground: GroundQuery,
    anchors: AnchorRegistry,
    inventory: { kits: { drone: number } },
  ) {
    this.scene = scene;
    this.ground = ground;
    this.anchors = anchors;
    this.inventory = inventory;
  }

  get count(): number {
    return this.drones.size;
  }

  /**
   * Deploy a drone over `point`. Consumes a drone kit on success. `instant`
   * (debug) spawns it already at altitude. Rejected at the cap ('max') or with
   * no kit ('nokit').
   */
  place(point: Vec3, opts?: { instant?: boolean }): { ok: boolean; reason?: 'max' | 'nokit'; id?: string } {
    if (this.drones.size >= STRUCTURES.maxDrones) return { ok: false, reason: 'max' };
    if (this.inventory.kits.drone <= 0) return { ok: false, reason: 'nokit' };
    this.inventory.kits.drone -= 1;

    const groundY = this.ground.heightAt(point.x, point.z);
    const targetY = hoverAltitude(groundY);
    const id = `drone${this.nextId++}`;
    const instant = !!opts?.instant;
    const y0 = instant ? targetY : groundY + 1;

    const { group, rotors } = buildDroneMesh();
    group.position.set(point.x, y0, point.z);
    this.scene.add(group);

    this.drones.set(id, {
      id,
      x: point.x,
      z: point.z,
      groundY,
      targetY,
      y: y0,
      age: 0,
      atAltitude: instant,
      registered: false,
      anchorId: `${id}-anchor`,
      group,
      rotors,
    });
    return { ok: true, id };
  }

  /** Remove a drone, free its anchor and refund its kit. */
  recall(id: string): boolean {
    const d = this.drones.get(id);
    if (!d) return false;
    if (d.registered) this.anchors.unregisterAnchor(d.anchorId);
    this.scene.remove(d.group);
    disposeGroup(d.group);
    this.drones.delete(id);
    this.inventory.kits.drone += 1;
    return true;
  }

  /** Live position of a drone (for tests / debug). */
  dronePos(id: string): Vec3 | null {
    const d = this.drones.get(id);
    return d ? { x: d.x, y: d.y, z: d.z } : null;
  }

  /** Advance ascent + station-keeping bob + rotor spin for every drone. */
  update(dt: number): void {
    for (const d of this.drones.values()) {
      d.age += dt;
      if (!d.atAltitude) {
        d.y += STRUCTURES.droneAscent * dt;
        if (d.y >= d.targetY) {
          d.y = d.targetY;
          d.atAltitude = true;
        }
      }
      if (d.atAltitude) {
        if (!d.registered) {
          // getPos closes over the drone so the bobbing altitude stays live.
          this.anchors.registerAnchor(d.anchorId, () => ({ x: d.x, y: d.y, z: d.z }), STRUCTURES.droneAnchorRadius);
          d.registered = true;
        }
        d.y = d.targetY + Math.sin(d.age * STRUCTURES.droneBobRate) * STRUCTURES.droneBob;
      }
      d.group.position.set(d.x, d.y, d.z);
      for (const rotor of d.rotors) rotor.rotation.y += STRUCTURES.droneRotorRate * dt;
    }
  }

  /** Nearest at-altitude drone within `droneRecallRange` horizontally, or null. */
  private nearestRecallable(pos: Vec3): string | null {
    let best: string | null = null;
    let bestD: number = STRUCTURES.droneRecallRange;
    for (const d of this.drones.values()) {
      if (!d.atAltitude) continue;
      const dist = Math.hypot(pos.x - d.x, pos.z - d.z);
      if (dist <= bestD) {
        bestD = dist;
        best = d.id;
      }
    }
    return best;
  }

  /** True when the player is under a recallable drone (main gates harvest on this). */
  nearRecall(pos: Vec3): boolean {
    return this.nearestRecallable(pos) !== null;
  }

  /**
   * The id of the nearest recallable drone within `droneRecallRange`
   * horizontally of `pos`, or null (playtest Task 9 — destruction mode's
   * drone reclaim). A thin public wrapper over the same private proximity
   * test `nearRecall` already uses, just returning the id instead of a
   * boolean so the caller (main.ts's demolish LMB handler) can act on a
   * specific drone. Drones deliberately reclaim by PROXIMITY rather than by
   * aiming a ray at them — see `structures/demolish.ts`'s file header for why
   * (they station-keep at `STRUCTURES.droneHover`, far past any reasonable
   * click-aim range).
   */
  recallableIdNear(pos: Vec3): string | null {
    return this.nearestRecallable(pos);
  }

  /**
   * Per-step proximity-recall handler: while standing beneath a drone, a held F
   * for `recallHold` seconds recalls it. Returns true when owning the F input.
   */
  updateRecall(dt: number, playerPos: Vec3, input: Input): boolean {
    const targetId = this.nearestRecallable(playerPos);
    if (!targetId) {
      this.recallHold = { ...initialHold };
      this.recallToasted = false;
      return false;
    }
    const held = input.interactHeld;
    const res = stepHold(this.recallHold, held, dt);
    this.recallHold = res.next;

    if (
      res.next.phase === 'holding' &&
      res.next.elapsed >= STRUCTURES.recallTap &&
      !this.recallToasted
    ) {
      this.recallToasted = true;
      toast('Recalling drone…');
    }
    if (res.next.phase === 'idle') this.recallToasted = false;

    if (res.action === 'recall') {
      this.recall(targetId);
      toast('Drone recalled');
      return true;
    }
    return held || this.recallHold.phase !== 'idle';
  }

  /** Plain-data snapshot (Task 14 save/load): placement points + ids. */
  serialize(): DroneData[] {
    return [...this.drones.values()].map((d) => ({ id: d.id, x: d.x, z: d.z }));
  }

  /** Rebuild drones from plain data (clears current ones first). */
  deserialize(data: DroneData[]): void {
    for (const id of [...this.drones.keys()]) this.recallSilent(id);
    for (const d of data) {
      const res = this.forcePlace({ x: d.x, y: 0, z: d.z }, d.id);
      void res;
      const n = Number(d.id.replace('drone', ''));
      if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
    }
  }

  /** Recall without refunding (deserialize teardown). */
  private recallSilent(id: string): void {
    const d = this.drones.get(id);
    if (!d) return;
    if (d.registered) this.anchors.unregisterAnchor(d.anchorId);
    this.scene.remove(d.group);
    disposeGroup(d.group);
    this.drones.delete(id);
  }

  /** Deserialize helper: place with an explicit id, no kit accounting. */
  private forcePlace(point: Vec3, id: string): void {
    const groundY = this.ground.heightAt(point.x, point.z);
    const targetY = hoverAltitude(groundY);
    const { group, rotors } = buildDroneMesh();
    group.position.set(point.x, groundY + 1, point.z);
    this.scene.add(group);
    this.drones.set(id, {
      id,
      x: point.x,
      z: point.z,
      groundY,
      targetY,
      y: groundY + 1,
      age: 0,
      atAltitude: false,
      registered: false,
      anchorId: `${id}-anchor`,
      group,
      rotors,
    });
  }
}

/** Small quad-rotor: body, four arms + spinning rotor discs, and a status light. */
function buildDroneMesh(): { group: THREE.Group; rotors: THREE.Mesh[] } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.5, metalness: 0.4 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: ROTOR_COLOR, roughness: 0.4, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), bodyMat);
  group.add(body);

  const rotors: THREE.Mesh[] = [];
  const arm = 0.55;
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), bodyMat);
    boom.position.set(sx * arm, 0.02, sz * arm);
    group.add(boom);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.06), rotorMat);
    rotor.position.set(sx * arm, 0.14, sz * arm);
    group.add(rotor);
    rotors.push(rotor);
  }

  // Cosmetic status light: an emissive sphere slung under the body.
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshBasicMaterial({ color: LIGHT_COLOR }),
  );
  light.position.set(0, -0.18, 0);
  group.add(light);

  return { group, rotors };
}

/** Dispose every geometry + material under a group. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
