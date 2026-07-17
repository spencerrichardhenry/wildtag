import * as THREE from 'three';
import { MOUNT, WORLD_SEED } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { mulberry32 } from '../core/rng.ts';
import { buildCritterModel, type CritterParts } from '../critters/models.ts';
import { animateCritter } from '../critters/animation.ts';
import type { PlayerController } from './controller.ts';
import type { Input } from './input.ts';
import type { MountPersist } from '../core/save.ts';
import type { Roster } from '../critters/roster.ts';

// ---------------------------------------------------------------------------
// Prismhorse mount actor + ride orchestration (Haven V6, three.js layer). The
// pure kinematics live in `mount.ts`; this owns the ONE active-mount actor (a
// persistent buildCritterModel prismhorse, saddle mesh added when the Saddle
// reward is owned) and the ride state machine.
//
// Idle: the actor loosely follows the player — a pathless teleport-lag trail
// that keeps a small standoff and never lingers beyond MOUNT.followRange.
// Riding: the controller drives player kinematics (mode 'mount'); this pins the
// actor under the camera, faces it along the camera yaw, skitters its 16 legs
// at ride speed, and dismounts on a held Space (KeyV dismount is driven by main).
// ---------------------------------------------------------------------------

interface Actor {
  group: THREE.Group;
  parts: CritterParts;
  entryId: number;
  speciesId: string;
  nickname: string;
  /** Smoothed visual yaw of the model (lerps toward the movement/camera yaw). */
  yaw: number;
  /** Per-mesh material handles for the camera-proximity ride fade. */
  fades: FadeEntry[];
}

/** One mesh's material + authored opacity, for the camera-proximity fade. */
interface FadeEntry {
  mesh: THREE.Mesh;
  mat: THREE.Material & { opacity: number; transparent: boolean };
  baseOpacity: number;
  baseTransparent: boolean;
}

export class MountSystem {
  private readonly scene: THREE.Scene;
  private readonly ground: GroundQuery;
  private readonly camera: THREE.Camera;
  private actor: Actor | null = null;
  private riding = false;
  /** Seconds Space has been held while riding (hold ≥ dismountHold to get off). */
  private spaceHeldFor = 0;
  /** Absolute animation clock (s). */
  private t = 0;
  /** Scratch world-position vector for the fade distance test (no per-frame alloc). */
  private readonly _wp = new THREE.Vector3();

  constructor(scene: THREE.Scene, ground: GroundQuery, camera: THREE.Camera) {
    this.scene = scene;
    this.ground = ground;
    this.camera = camera;
  }

  /** True while an active-mount actor exists in the world. */
  active(): boolean {
    return this.actor !== null;
  }
  /** True while the player is currently riding. */
  get isRiding(): boolean {
    return this.riding;
  }
  /** The active-mount roster-entry id, or null. */
  activeEntryId(): number | null {
    return this.actor?.entryId ?? null;
  }
  /** The active mount's nickname, or null. */
  nickname(): string | null {
    return this.actor?.nickname ?? null;
  }
  /** The active-mount actor's world position, or null. */
  actorPos(): Vec3 | null {
    if (!this.actor) return null;
    const p = this.actor.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /**
   * Make `entry` the active mount: (re)build its actor at `pos`. Replaces any
   * previous actor (single active mount). A saddle mesh is added when `saddle`.
   */
  setActive(
    entry: { id: number; speciesId: string; nickname: string },
    pos: Vec3,
    saddle: boolean,
  ): void {
    this.clearActive();
    // Deterministic per-individual variety keyed off the entry id.
    const rng = mulberry32((WORLD_SEED ^ 0x0f01 ^ (entry.id >>> 0)) >>> 0);
    const built = buildCritterModel(entry.speciesId, rng);
    if (saddle) built.group.add(buildSaddle());
    const y = this.ground.heightAt(pos.x, pos.z);
    built.group.position.set(pos.x, y, pos.z);
    this.scene.add(built.group);
    // Collect per-mesh material handles for the camera-proximity ride fade.
    // Model materials are per-part instances (jittered colours), so mutating
    // opacity here never bleeds into wild critters.
    const fades: FadeEntry[] = [];
    built.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const mat = mesh.material as FadeEntry['mat'];
      fades.push({ mesh, mat, baseOpacity: mat.opacity, baseTransparent: mat.transparent });
    });
    this.actor = {
      group: built.group,
      parts: built.parts,
      entryId: entry.id,
      speciesId: entry.speciesId,
      nickname: entry.nickname,
      yaw: 0,
      fades,
    };
  }

  /** Remove the active-mount actor (roster changed / mount unset). */
  clearActive(): void {
    if (!this.actor) return;
    this.scene.remove(this.actor.group);
    disposeGroup(this.actor.group);
    this.actor = null;
    this.riding = false;
    this.spaceHeldFor = 0;
  }

  /**
   * Begin riding: seat the player atop the actor and flip the controller to
   * mount mode. Returns false if there is no active mount.
   */
  startRide(controller: PlayerController): boolean {
    if (!this.actor) return false;
    const p = this.actor.group.position;
    controller.mountStart({ x: p.x, y: this.ground.heightAt(p.x, p.z), z: p.z });
    this.riding = true;
    this.spaceHeldFor = 0;
    return true;
  }

  /**
   * Camera-proximity fade net (riding only): any mesh whose origin sits within
   * MOUNT.fadeFar of the eye fades toward transparent (fully gone by fadeNear),
   * so a crystal swinging through the camera never blocks the view. Linear
   * opacity lerp per mesh; originals restored by `restoreFade` on dismount.
   */
  private applyRideFade(): void {
    if (!this.actor) return;
    const eye = this.camera.position;
    for (const f of this.actor.fades) {
      const d = f.mesh.getWorldPosition(this._wp).distanceTo(eye);
      const k = Math.min(1, Math.max(0, (d - MOUNT.fadeNear) / (MOUNT.fadeFar - MOUNT.fadeNear)));
      f.mat.opacity = f.baseOpacity * k;
      f.mat.transparent = k < 1 ? true : f.baseTransparent;
    }
  }

  /** Restore every material's authored opacity/transparency (dismount/teardown). */
  private restoreFade(): void {
    if (!this.actor) return;
    for (const f of this.actor.fades) {
      f.mat.opacity = f.baseOpacity;
      f.mat.transparent = f.baseTransparent;
    }
  }

  /** Dismount: park the actor where you rode and step the player beside it. */
  dismount(controller: PlayerController): void {
    if (!this.riding || !this.actor) return;
    this.riding = false;
    this.spaceHeldFor = 0;
    this.restoreFade();
    const p = controller.pos;
    const y = this.ground.heightAt(p.x, p.z);
    this.actor.group.position.set(p.x, y, p.z);
    // Step off to the side (offset in world +x, clamped onto the ground there).
    const ox = p.x + 1.6;
    controller.mountEnd({ x: ox, y: this.ground.heightAt(ox, p.z), z: p.z });
  }

  /** Summon the idle actor to the player's side (Whistle). No-op while riding. */
  summon(playerPos: Vec3): void {
    if (!this.actor || this.riding) return;
    const x = playerPos.x + 1.5;
    const z = playerPos.z + 1.5;
    this.actor.group.position.set(x, this.ground.heightAt(x, z), z);
  }

  /**
   * Per-step actor upkeep. While riding: pin under the camera, face the camera
   * yaw, animate legs at ride speed, and dismount on a held Space. While idle:
   * loosely follow the player.
   */
  update(dt: number, controller: PlayerController, input: Input): void {
    this.t += dt;
    if (!this.actor) return;

    if (this.riding) {
      // Hold Space to dismount (KeyV dismount is handled by main's action loop).
      if (input.spaceHeld) {
        this.spaceHeldFor += dt;
        if (this.spaceHeldFor >= MOUNT.dismountHold) {
          this.dismount(controller);
          return;
        }
      } else {
        this.spaceHeldFor = 0;
      }
      // Pin the model under/ahead of the camera, facing the camera yaw: the
      // rider sits on the rear, the body + 16 skittering legs extend forward.
      const p = controller.pos;
      const fx = -Math.sin(input.yaw);
      const fz = -Math.cos(input.yaw);
      const mx = p.x + fx * MOUNT.rideForwardOffset;
      const mz = p.z + fz * MOUNT.rideForwardOffset;
      this.actor.group.position.set(mx, this.ground.heightAt(mx, mz), mz);
      this.faceYaw(input.yaw, dt);
      const v = controller.vel;
      const speed = Math.hypot(v.x, v.z);
      animateCritter(this.actor.parts, speed, this.t, dt, this.actor.speciesId);
      // After posing: fade any mesh that ended up hugging the camera.
      this.actor.group.updateMatrixWorld();
      this.applyRideFade();
      return;
    }

    // --- Idle follow: pathless teleport-lag trail toward the player ---------
    const a = this.actor.group.position;
    const target = controller.pos;
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const dist = Math.hypot(dx, dz);
    let followSpeed = 0;
    if (dist > MOUNT.followRange) {
      // Fallen too far behind — teleport-lag it back onto the standoff ring.
      const nx = target.x - (dx / dist) * MOUNT.followStandoff;
      const nz = target.z - (dz / dist) * MOUNT.followStandoff;
      a.set(nx, this.ground.heightAt(nx, nz), nz);
      this.faceYaw(Math.atan2(-dx, -dz), dt);
    } else if (dist > MOUNT.followStandoff) {
      const step = Math.min(dist - MOUNT.followStandoff, MOUNT.followSpeed * dt);
      const nx = a.x + (dx / dist) * step;
      const nz = a.z + (dz / dist) * step;
      a.set(nx, this.ground.heightAt(nx, nz), nz);
      followSpeed = step / dt;
      this.faceYaw(Math.atan2(-dx, -dz), dt);
    }
    animateCritter(this.actor.parts, followSpeed, this.t, dt, this.actor.speciesId);
  }

  /** Smoothly rotate the model toward `targetYaw` at MOUNT.turnRate. */
  private faceYaw(targetYaw: number, dt: number): void {
    if (!this.actor) return;
    // The critter models face +Z; the yaw convention faces -Z, so the model's
    // rotation.y = yaw + PI to point the head along the heading.
    const desired = targetYaw + Math.PI;
    let delta = desired - this.actor.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // wrap to [-PI, PI]
    const maxStep = MOUNT.turnRate * dt;
    this.actor.yaw += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
    this.actor.group.rotation.y = this.actor.yaw;
  }

  /** Plain-data snapshot for save (Haven V6), or null when no mount is active. */
  saveState(): MountPersist | null {
    if (!this.actor) return null;
    const p = this.actor.group.position;
    return { entryId: this.actor.entryId, x: p.x, z: p.z };
  }

  /**
   * Restore the active-mount actor on load: spawn it for whichever roster entry
   * still carries the 'mount' status, at the saved position when the id matches
   * (else near the player). No-op when no entry is on mount duty.
   */
  load(saved: MountPersist | null, roster: Roster, playerPos: Vec3, saddle: boolean): void {
    const entry = roster.find((e) => e.status.kind === 'mount');
    if (!entry) return;
    const pos =
      saved && saved.entryId === entry.id
        ? { x: saved.x, y: 0, z: saved.z }
        : { x: playerPos.x + 2, y: 0, z: playerPos.z };
    this.setActive(entry, pos, saddle);
  }
}

/** A small leather saddle mesh seated on the mount's back (scales with group). */
function buildSaddle(): THREE.Object3D {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.8, metalness: 0.05 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.7), leather);
  seat.position.set(0, 1.72, 0);
  g.add(seat);
  const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.14), leather);
  pommel.position.set(0, 1.86, 0.32);
  g.add(pommel);
  return g;
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
