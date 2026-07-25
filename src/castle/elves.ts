import * as THREE from 'three';
import { CASTLE, ELF, WORLD_SEED } from '../core/constants.ts';
import { mulberry32 } from '../core/rng.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { buildElf } from './builders.ts';

// ---------------------------------------------------------------------------
// Elves (Cursed Castle Task 12): persistent happy residents that wander/dance
// around the castle grounds. Purified goblins become elves — the wiring
// (CastleSystem.purifyGoblin's return position → `ElfSystem.addAt`) lives in
// the NEXT task; this file only builds `elfHomePosition` (pure placement) and
// `ElfSystem` (the three.js wander/dance manager).
//
// The wander/pause FSM shape is copied from `src/village/npcs.ts`'s
// NpcManager (not imported — elves are ambient: no labels, no dialog, no
// face-player freeze). "Dance" is a pause variant, rolled at `ELF.danceChance`
// on every pause entry, that spins the model and bobs it on a sine while the
// dwell counts down.
// ---------------------------------------------------------------------------

/** Golden angle (rad): consecutive spiral points never fall on a repeating
 *  ray, so a linear radius ramp still spreads points evenly (sunflower-seed
 *  packing) instead of stacking along a few spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Innermost spiral radius (m): the keep is a SQUARE footprint of half-extent
 * `CASTLE.keepHalf`, so its farthest extent from centre (a corner) is
 * `keepHalf * √2` — a radius at or below that can still land inside the keep
 * depending on angle. `+3` clears every angle with a small margin, so no elf
 * home ever spawns embedded in (or wedged against) the keep's solid mesh/
 * collider.
 */
const HOME_RADIUS_MIN = CASTLE.keepHalf * Math.SQRT2 + 3;

/** Radius is clamped a few metres shy of the curtain wall itself. */
const HOME_RADIUS_MAX = CASTLE.half - 4;

/**
 * Spiral radius growth (m) per index, chosen so the radius reaches
 * `HOME_RADIUS_MAX` around index 24 — homes settle inside/near the courtyard
 * (never out at `CASTLE.regionR`, which is for goblins).
 */
const HOME_RADIUS_GROWTH = (HOME_RADIUS_MAX - HOME_RADIUS_MIN) / 24;

/**
 * Deterministic home position for elf `index`: a golden-angle spiral around
 * `CASTLE.center`, radius growing from just past the keep's footprint up
 * toward (but staying inside) `CASTLE.half`. Pure — no `three` import, safe
 * to unit-test directly. `y` is the flattened pad-height placeholder (mirrors
 * `goblinSpawnPoints`); `ElfSystem` resolves the real ground height via
 * `GroundQuery.heightAt` when it actually places a mesh there.
 */
export function elfHomePosition(index: number): Vec3 {
  const angle = index * GOLDEN_ANGLE;
  const r = Math.min(HOME_RADIUS_MIN + index * HOME_RADIUS_GROWTH, HOME_RADIUS_MAX);
  return {
    x: CASTLE.center.x + Math.cos(angle) * r,
    y: CASTLE.padHeight,
    z: CASTLE.center.z + Math.sin(angle) * r,
  };
}

interface ElfRuntime {
  group: THREE.Group;
  home: Vec3;
  pos: Vec3;
  yaw: number;
  targetYaw: number;
  target: { x: number; z: number };
  state: 'wander' | 'pause';
  /** Rolled true at `ELF.danceChance` on every pause entry. */
  dancing: boolean;
  /** Seconds remaining in the current pause dwell. */
  timer: number;
  /** Seconds elapsed in the current state — drives the dance bob phase. */
  phaseT: number;
  rng: () => number;
}

/** Shortest signed angular delta a → b, wrapped to [−π, π]. */
function angDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class ElfSystem {
  private readonly elves: ElfRuntime[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: GroundQuery,
  ) {}

  /** Current live elf count. */
  get count(): number {
    return this.elves.length;
  }

  /**
   * Reconcile the live elf count to `n` (load restore, or a future purify
   * count): spawns missing indices at their deterministic home, removes
   * extras from the top (disposing their mesh). Idempotent.
   */
  setCount(n: number): void {
    const target = Math.max(0, Math.floor(n));
    while (this.elves.length < target) {
      const index = this.elves.length;
      const home = elfHomePosition(index);
      this.spawnAt(index, home, home);
    }
    while (this.elves.length > target) {
      const e = this.elves.pop()!;
      this.disposeMesh(e.group);
    }
  }

  /**
   * Purify burst (Task 13 wiring): spawn the next-index elf AT `pos` (where a
   * purified goblin last stood) — it immediately wanders home-ward via the
   * normal wander FSM (its `home` stays the deterministic spiral slot).
   */
  addAt(pos: Vec3): void {
    const index = this.elves.length;
    const home = elfHomePosition(index);
    this.spawnAt(index, pos, home);
  }

  /** Wander/pause/dance FSM step + mesh sync for every live elf. */
  update(dt: number, _playerPos: Vec3): void {
    for (const e of this.elves) {
      e.phaseT += dt;

      if (e.state === 'pause') {
        e.timer -= dt;
        if (e.dancing) e.yaw += dt * ELF.danceSpinRate;
        if (e.timer <= 0) {
          this.pickTarget(e);
          e.state = 'wander';
          e.phaseT = 0;
        }
      } else {
        const dx = e.target.x - e.pos.x;
        const dz = e.target.z - e.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ELF.arriveDist) {
          e.state = 'pause';
          e.phaseT = 0;
          e.dancing = e.rng() < ELF.danceChance;
          e.timer = ELF.pauseMin + e.rng() * (ELF.pauseMax - ELF.pauseMin);
        } else {
          e.targetYaw = Math.atan2(dx, dz);
          // Only stride forward once roughly facing the target (mirrors NPCs).
          if (Math.abs(angDelta(e.yaw, e.targetYaw)) < 0.5) {
            const step = Math.min(ELF.walkSpeed * dt, dist);
            e.pos.x += Math.sin(e.yaw) * step;
            e.pos.z += Math.cos(e.yaw) * step;
          }
          const d = angDelta(e.yaw, e.targetYaw);
          const maxTurn = ELF.turnRate * dt;
          e.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
        }
      }

      e.pos.y = this.ground.heightAt(e.pos.x, e.pos.z);
      e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      if (e.state === 'pause' && e.dancing) {
        e.group.position.y +=
          Math.sin((e.phaseT / ELF.dancePeriod) * Math.PI * 2) * ELF.danceBobAmp;
      }
      e.group.rotation.y = e.yaw;
    }
  }

  /** Tear down every live elf's mesh and clear the roster. */
  dispose(): void {
    while (this.elves.length) {
      const e = this.elves.pop()!;
      this.disposeMesh(e.group);
    }
  }

  // -------------------------------------------------------------------------

  private pickTarget(e: ElfRuntime): void {
    const a = e.rng() * Math.PI * 2;
    const r = e.rng() * ELF.wanderR;
    e.target = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
  }

  private spawnAt(index: number, pos: Vec3, home: Vec3): void {
    const rng = mulberry32((WORLD_SEED ^ 0xe1f ^ index) >>> 0);
    const group = buildElf(rng);
    const y = this.ground.heightAt(pos.x, pos.z);
    group.position.set(pos.x, y, pos.z);
    this.scene.add(group);

    // A spawn AT home (load restore) starts idle; a purify-burst spawn (pos
    // differs from home) starts already wandering toward it.
    const atHome = Math.hypot(pos.x - home.x, pos.z - home.z) < 1e-6;
    this.elves.push({
      group,
      home: { ...home },
      pos: { x: pos.x, y, z: pos.z },
      yaw: rng() * Math.PI * 2,
      targetYaw: 0,
      target: { x: home.x, z: home.z },
      state: atHome ? 'pause' : 'wander',
      dancing: false,
      timer: ELF.pauseMin + rng() * (ELF.pauseMax - ELF.pauseMin),
      phaseT: 0,
      rng,
    });
  }

  private disposeMesh(group: THREE.Group): void {
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    });
    this.scene.remove(group);
  }
}
