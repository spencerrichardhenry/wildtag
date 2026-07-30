import * as THREE from 'three';
import { CRYSTAL, GOBLIN, PURIFIER } from '../core/constants.ts';
import type { DaylightSample } from '../core/daylight.ts';
import { mulberry32 } from '../core/rng.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { toast } from '../ui/toasts.ts';
import { buildCastle, buildCrystal, buildGoblin, removeCastle, removeCrystal, type CrystalMesh } from './builders.ts';
import {
  goblinSpawnPoints,
  makeGoblin,
  shouldSpawnGoblins,
  stepGoblin,
  type GoblinState,
} from './goblins.ts';
import { castleLayout, castleObstacles, spireObstacles } from './layout.ts';
import { wardLayout, wardObstaclesNear } from './ward.ts';
import { purifySequenceSteps } from './state.ts';

// ---------------------------------------------------------------------------
// CastleSystem (Cursed Castle Task 11): the three.js presentation + spawning
// layer over the pure goblin FSM. Owns the live GoblinState[] and one mesh
// Group per goblin, spawns a fresh ring at dusk (skipped once purified),
// despawns everything at dawn, and reports lunge hits to `opts.onPlayerHit`.
//
// Presence, not just a dusk-edge trigger: `update()` re-derives "should there
// be goblins right now" every call via `shouldSpawnGoblins` (dusk or night,
// not purified) so a save loaded mid-night, or a debug `setTimeOfDay('night')`
// jump straight past dusk, still spawns the night's goblins on the very next
// frame. `nightIndex` (seeding `goblinSpawnPoints`) increments once per actual
// spawn event, so each night's ring is reproducible and distinct.
//
// Task 14 (the finale): this class also owns the dark/purified crystal mesh
// (pulsing every frame) and `purifyCastle()` — the one-shot, idempotent
// sequence a landed purifying-dart hit on the crystal triggers: every live
// goblin becomes a happy elf, the castle rebuilds in its bright dressing, the
// crystal swaps look, and `opts.onPurified()` flips the flag `main.ts` owns.
// ---------------------------------------------------------------------------

export class CastleSystem {
  private readonly goblins: GoblinState[] = [];
  private readonly meshes = new Map<number, THREE.Group>();
  /** One persistent PRNG per live goblin id (advances across steps, unlike a
   *  fresh mulberry32(seed) which would replay the same draw every call). */
  private readonly rngs = new Map<number, () => number>();
  /**
   * Ids spawned by the automatic dusk/night cycle (`spawnNight`) — the ONLY
   * ones the automatic dawn/day despawn touches. A `spawnOne` debug goblin
   * (forced "regardless of phase") must survive a day/night flip that isn't
   * its own; without this split, the very next `update()` after a debug spawn
   * would see `!want` (still day) and wipe it out again within one frame.
   */
  private readonly nightManaged = new Set<number>();
  /**
   * True once the current dusk/night presence has already spawned its ring.
   * Deliberately NOT inferred from `nightManaged.size` — once Task 12 wires
   * `purifyGoblin`, purifying every remaining night goblin before dawn would
   * empty `nightManaged` while `want` is still true, and a size-based check
   * would misread that as "haven't spawned yet" and respawn a fresh ring mid-
   * night. This flag only flips back to false on the presence's OWN falling
   * edge (`want` going false), so a fully-purified night stays clear until
   * the next dusk.
   */
  private spawnedThisPresence = false;
  private nextId = 0;
  private nightIndex = -1;

  /** The dark/purified crystal (Task 14) — owned here, not merged into the
   *  `buildCastle` group, so its emissive pulse can update every frame. */
  private crystal: CrystalMesh;
  /** Elapsed seconds, driving the crystal's emissive pulse. */
  private time = 0;
  /** The purify moment's expanding sparkle ring, while one is playing. */
  private ring: {
    points: THREE.Points;
    material: THREE.PointsMaterial;
    /** Unit XZ directions (2 floats per point) the ring expands along. */
    dirs: Float32Array;
    origin: Vec3;
    age: number;
  } | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: GroundQuery,
    private readonly opts: {
      onPlayerHit: (damage: number, fromPos: Vec3) => void;
      purified: () => boolean;
      /** Called once, the moment `purifyCastle()` actually runs (main.ts
       *  flips its own `castlePurified` flag here — this system never holds
       *  that flag itself, only reads it back via `opts.purified()`). */
      onPurified: () => void;
      /** Spawn a happy elf at `pos` (Task 12's `ElfSystem.addAt`, injected as
       *  a plain callback so this system stays testable without a real
       *  `ElfSystem`/scene chain). */
      addElf: (pos: Vec3) => void;
      /** One-shot full-screen white flash (HUD hook) for the purify moment. */
      flashPurify: () => void;
    },
  ) {
    this.crystal = buildCrystal(opts.purified());
    const cp = castleLayout().crystalPos;
    this.crystal.group.position.set(cp.x, cp.y, cp.z);
    this.scene.add(this.crystal.group);
  }

  /** Spawn/despawn per the live daylight sample, step FSMs, sync meshes. */
  update(dt: number, playerPos: Vec3, sample: DaylightSample): void {
    const want = shouldSpawnGoblins(this.opts.purified(), sample.phase);
    if (want && !this.spawnedThisPresence) {
      this.nightIndex++;
      this.spawnNight();
      this.spawnedThisPresence = true;
    } else if (!want && this.spawnedThisPresence) {
      this.despawnAll();
      this.spawnedThisPresence = false;
    }

    for (let i = 0; i < this.goblins.length; i++) {
      const g = this.goblins[i]!;
      const rand = this.rngs.get(g.id)!;
      const step = stepGoblin(
        g,
        {
          playerPos,
          ground: this.ground,
          rand,
          // Spire added daze-eject-spires review round: chase (unlike the
          // short-clamped patrol loop) can carry a goblin across the whole
          // ward, including through a spire's footprint, without this.
          obstacles: castleObstacles()
            .concat(wardObstaclesNear(g.pos.x, g.pos.z))
            .concat(spireObstacles()),
        },
        dt,
      );
      this.goblins[i] = step.g;
      if (step.hitPlayer) this.opts.onPlayerHit(GOBLIN.damage, step.g.pos);
      this.syncMesh(step.g);
    }

    this.time += dt;
    const purified = this.opts.purified();
    const base = purified ? CRYSTAL.purifiedPulseBase : CRYSTAL.cursedPulseBase;
    const amp = purified ? CRYSTAL.purifiedPulseAmp : CRYSTAL.cursedPulseAmp;
    const freq = purified ? CRYSTAL.purifiedPulseFreq : CRYSTAL.cursedPulseFreq;
    this.crystal.material.emissiveIntensity = base + amp * Math.sin(freq * this.time);
    this.updateRing(dt);
  }

  /** Live goblin id/pos/radius, for purifying-dart hit tests (Task 12). */
  goblinTargets(): { id: number; pos: Vec3; r: number }[] {
    return this.goblins.map((g) => ({ id: g.id, pos: { ...g.pos }, r: GOBLIN.hitRadius }));
  }

  /**
   * The crystal's live purifying-dart target (Task 14 fills in the `null`
   * stub `main.ts` passed in Task 13): `active` flips false the moment the
   * castle is purified, so `PurifierSystem` stops hit-testing it entirely —
   * belt-and-braces alongside `purifyCastle()`'s own idempotency guard.
   */
  crystalTarget(): { pos: Vec3; r: number; active: boolean } {
    return { pos: { ...castleLayout().crystalPos }, r: CRYSTAL.hitR, active: !this.opts.purified() };
  }

  /**
   * The full purify sequence, run once a purifying dart lands on the
   * crystal: idempotent — a second call while already purified is a no-op
   * (no double elves, no second flash/toast/rebuild). Every currently-live
   * goblin (nightManaged or debug-spawned alike) becomes a happy elf at its
   * last position, the castle mesh rebuilds bright, the crystal swaps to its
   * purified dressing, and `opts.onPurified()` flips the flag `main.ts` owns.
   */
  purifyCastle(): void {
    if (this.opts.purified()) return;

    const positions = this.clearAllGoblins();
    const { elfSpawns } = purifySequenceSteps(positions);
    for (const pos of elfSpawns) this.opts.addElf(pos);

    this.opts.flashPurify();
    this.spawnRing(castleLayout().crystalPos);

    removeCastle(this.scene);
    buildCastle(this.scene, true);

    removeCrystal(this.scene, this.crystal);
    this.crystal = buildCrystal(true);
    const cp = castleLayout().crystalPos;
    this.crystal.group.position.set(cp.x, cp.y, cp.z);
    this.scene.add(this.crystal.group);

    this.opts.onPurified();
    toast('The castle is purified! ✨');
  }

  /** Remove goblin `id` (e.g. purified by a dart). Returns its last position, or null if unknown. */
  purifyGoblin(id: number): Vec3 | null {
    const idx = this.goblins.findIndex((g) => g.id === id);
    if (idx < 0) return null;
    const pos = { ...this.goblins[idx]!.pos };
    this.removeGoblin(id);
    this.nightManaged.delete(id);
    this.goblins.splice(idx, 1);
    return pos;
  }

  goblinCount(): number {
    return this.goblins.length;
  }

  /**
   * Debug-only (Task 11 `debug.spawnGoblin`): force-spawn a single goblin at
   * `pos`, regardless of the current phase/purified state. Returns its id.
   */
  spawnOne(pos: Vec3): number {
    const home = { x: pos.x, y: this.ground.heightAt(pos.x, pos.z), z: pos.z };
    return this.spawnGoblinAt(home);
  }

  dispose(): void {
    for (const id of [...this.meshes.keys()]) this.removeGoblin(id);
    this.goblins.length = 0;
    this.nightManaged.clear();
    this.spawnedThisPresence = false;
    removeCrystal(this.scene, this.crystal);
    this.removeRing();
  }

  // -------------------------------------------------------------------------

  /**
   * Remove EVERY live goblin's mesh/rng/state — unlike `despawnAll` (which
   * only touches `nightManaged`), the purify moment converts every last
   * goblin standing, including a debug-spawned one. Returns their last
   * positions (purify order preserved).
   */
  private clearAllGoblins(): Vec3[] {
    const positions = this.goblins.map((g) => ({ ...g.pos }));
    for (const g of this.goblins) this.removeGoblin(g.id);
    this.goblins.length = 0;
    this.nightManaged.clear();
    return positions;
  }

  /** A short-lived expanding ring of sparkle points, in the XZ plane, at `origin`. */
  private spawnRing(origin: Vec3): void {
    const n = CRYSTAL.ringPointCount;
    const dirs = new Float32Array(n * 2);
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      dirs[i * 2] = Math.sin(ang);
      dirs[i * 2 + 1] = Math.cos(ang);
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: PURIFIER.color,
      size: 0.5,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, material);
    this.scene.add(points);
    this.ring = { points, material, dirs, origin: { ...origin }, age: 0 };
  }

  private updateRing(dt: number): void {
    if (!this.ring) return;
    this.ring.age += dt;
    if (this.ring.age >= CRYSTAL.ringS) {
      this.removeRing();
      return;
    }
    const t = this.ring.age / CRYSTAL.ringS;
    const radius = t * CRYSTAL.ringMaxR;
    const attr = this.ring.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = CRYSTAL.ringPointCount;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.ring.origin.x + this.ring.dirs[i * 2]! * radius;
      arr[i * 3 + 1] = this.ring.origin.y;
      arr[i * 3 + 2] = this.ring.origin.z + this.ring.dirs[i * 2 + 1]! * radius;
    }
    attr.needsUpdate = true;
    this.ring.material.opacity = 1 - t;
  }

  private removeRing(): void {
    if (!this.ring) return;
    this.scene.remove(this.ring.points);
    this.ring.points.geometry.dispose();
    this.ring.material.dispose();
    this.ring = null;
  }

  private spawnNight(): void {
    const points = goblinSpawnPoints(this.nightIndex, GOBLIN.count, wardLayout().zones);
    for (const p of points) {
      const home = { x: p.x, y: this.ground.heightAt(p.x, p.z), z: p.z };
      this.nightManaged.add(this.spawnGoblinAt(home));
    }
  }

  private spawnGoblinAt(home: Vec3): number {
    const id = this.nextId++;
    const g = makeGoblin(id, home);
    this.goblins.push(g);
    this.rngs.set(id, mulberry32((id * 2654435761) >>> 0));
    this.buildMesh(g);
    return id;
  }

  /** Remove only the goblins the automatic night cycle itself spawned. */
  private despawnAll(): void {
    for (const id of this.nightManaged) {
      const idx = this.goblins.findIndex((g) => g.id === id);
      if (idx >= 0) this.goblins.splice(idx, 1);
      this.removeGoblin(id);
    }
    this.nightManaged.clear();
  }

  /** Tear down one goblin's mesh + rng entry (does not touch `this.goblins`). */
  private removeGoblin(id: number): void {
    this.removeMesh(id);
    this.rngs.delete(id);
  }

  private buildMesh(g: GoblinState): void {
    const rng = mulberry32((g.id * 2654435761) >>> 0);
    const group = buildGoblin(rng);
    group.position.set(g.pos.x, g.pos.y, g.pos.z);
    group.rotation.y = g.yaw;
    this.scene.add(group);
    this.meshes.set(g.id, group);
  }

  private removeMesh(id: number): void {
    const m = this.meshes.get(id);
    if (!m) return;
    m.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat.dispose();
    });
    this.scene.remove(m);
    this.meshes.delete(id);
  }

  /** Place/orient the mesh + a simple bob (moving) / squash-stretch (lunge). */
  private syncMesh(g: GoblinState): void {
    const mesh = this.meshes.get(g.id);
    if (!mesh) return;
    mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    mesh.rotation.y = g.yaw;

    if (g.phase === 'lunge') {
      const s = 1 + Math.sin((g.phaseT / GOBLIN.lungeS) * Math.PI) * 0.22;
      mesh.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    } else if (g.phase === 'patrol' || g.phase === 'chase') {
      const bobFreq = g.phase === 'chase' ? 9 : 5;
      const bob = Math.abs(Math.sin(g.phaseT * bobFreq)) * 0.08;
      mesh.position.y += bob;
      mesh.scale.set(1, 1, 1);
    } else {
      mesh.scale.set(1, 1, 1);
    }
  }
}
