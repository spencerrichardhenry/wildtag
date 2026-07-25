import * as THREE from 'three';
import { GOBLIN } from '../core/constants.ts';
import type { DaylightSample } from '../core/daylight.ts';
import { mulberry32 } from '../core/rng.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { buildGoblin } from './builders.ts';
import {
  goblinSpawnPoints,
  makeGoblin,
  shouldSpawnGoblins,
  stepGoblin,
  type GoblinState,
} from './goblins.ts';

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
   * would misread that as "haven't spawned yet" and respawn a fresh 8 mid-
   * night. This flag only flips back to false on the presence's OWN falling
   * edge (`want` going false), so a fully-purified night stays clear until
   * the next dusk.
   */
  private spawnedThisPresence = false;
  private nextId = 0;
  private nightIndex = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: GroundQuery,
    private readonly opts: {
      onPlayerHit: (damage: number, fromPos: Vec3) => void;
      purified: () => boolean;
    },
  ) {}

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
      const step = stepGoblin(g, { playerPos, ground: this.ground, rand }, dt);
      this.goblins[i] = step.g;
      if (step.hitPlayer) this.opts.onPlayerHit(GOBLIN.damage, step.g.pos);
      this.syncMesh(step.g);
    }
  }

  /** Live goblin id/pos/radius, for purifying-dart hit tests (Task 12). */
  goblinTargets(): { id: number; pos: Vec3; r: number }[] {
    return this.goblins.map((g) => ({ id: g.id, pos: { ...g.pos }, r: GOBLIN.hitRadius }));
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
  }

  // -------------------------------------------------------------------------

  private spawnNight(): void {
    const points = goblinSpawnPoints(this.nightIndex, GOBLIN.count);
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
