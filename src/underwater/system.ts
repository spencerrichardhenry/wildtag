import * as THREE from 'three';
import { DAYLIGHT, ENV, UNDERWATER, WORLD_SEED } from '../core/constants.ts';
import { lerpColorHex } from '../core/daylight.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import type { DartKind } from '../tracking/darts.ts';
import { mulberry32 } from '../core/rng.ts';
import { clamSpawns, crocSpawns } from './layout.ts';
import {
  buildAtlantis,
  buildClamGuard,
  buildCrocodile,
  buildDiveMarker,
  buildTurtle,
  disposeUnderwaterTree,
  type ClamVisual,
  type CrocVisual,
  type TurtleVisual,
} from './builders.ts';

export type UnderwaterEnemyKind = 'clam' | 'croc';

export interface UnderwaterTarget {
  id: number;
  pos: Vec3;
  size: number;
}

export interface UnderwaterSystemOpts {
  purifiedClams?: Iterable<number>;
  onPurifiedClam?: (id: number, pos: Vec3) => void;
  /** Wave E croc tracking hooks (toasts/sfx live in main). */
  onCrocTagged?: (id: number) => void;
  onCrocLinked?: (id: number, pos: Vec3) => void;
  /** Previously-befriended crocodiles to restore as linked. */
  linkedCrocs?: number[];
  onDrop: (kind: 'shell' | 'scale', amount: number, pos: Vec3) => void;
  onPlayerHit: (damage: number, from: Vec3) => void;
}

type EnemyPhase = 'idle' | 'windup' | 'chomp' | 'recover';

interface EnemyRuntime {
  id: number;
  kind: UnderwaterEnemyKind;
  home: Vec3;
  pos: Vec3;
  yaw: number;
  /** Wave E: crocs are TRACKED, not damaged. */
  tagged: boolean;
  trackProgress: number;
  linked: boolean;
  shedFor: number;
  active: boolean;
  purified: boolean;
  phase: EnemyPhase;
  timer: number;
  cooldown: number;
  clam: ClamVisual | null;
  croc: CrocVisual | null;
}

interface TurtleRuntime {
  id: number;
  home: Vec3;
  visual: TurtleVisual;
  phase: number;
}

/** Wave E: crocs are tracked like surface critters; a persisted linked list
 *  restores friendships across reloads (mirrors sanitizePurifiedClamIds). */
export function sanitizeLinkedCrocIds(ids: Iterable<number>): number[] {
  const valid = new Set(crocSpawns().map((s) => s.id));
  return [...new Set(ids)].filter((id) => valid.has(id)).sort((a, b) => a - b);
}

/** Clamp an arbitrary persisted list to real clam ids only. */
export function sanitizePurifiedClamIds(ids: Iterable<number>): number[] {
  const valid = new Set(clamSpawns().map((s) => s.id));
  return [...new Set(ids)].filter((id) => valid.has(id)).sort((a, b) => a - b);
}

export class UnderwaterSystem {
  private readonly root = new THREE.Group();
  /** Heavy submerged art is distance-gated; the lightweight surface marker
   * stays visible from the island so players can discover the lagoon. */
  private readonly deep = new THREE.Group();
  private readonly marker: THREE.Group;
  private readonly palace: THREE.Group;
  private readonly enemies: EnemyRuntime[] = [];
  private readonly turtles: TurtleRuntime[] = [];
  private readonly purified = new Set<number>();
  private readonly bubbles: THREE.Points;
  private readonly bubbleBase: Float32Array;
  private t = 0;
  /** Croc ids restored as linked from the save (applied at spawn). */
  private restoreLinked = new Set<number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: GroundQuery,
    private readonly opts: UnderwaterSystemOpts,
  ) {
    this.root.name = 'underwaterBiome';
    this.scene.add(this.root);
    this.deep.name = 'atlantisDeepContent';
    this.deep.visible = false;
    this.root.add(this.deep);

    this.palace = buildAtlantis();
    this.palace.position.set(UNDERWATER.center.x, UNDERWATER.floorY, UNDERWATER.center.z);
    this.deep.add(this.palace);

    this.marker = buildDiveMarker();
    this.marker.position.set(UNDERWATER.center.x, 0, UNDERWATER.center.z);
    this.root.add(this.marker);

    const bubble = this.buildBubbles();
    this.bubbles = bubble.points;
    this.bubbleBase = bubble.base;
    this.deep.add(this.bubbles);

    for (const id of sanitizePurifiedClamIds(opts.purifiedClams ?? [])) this.purified.add(id);
    const linkedRestore = new Set(sanitizeLinkedCrocIds(opts.linkedCrocs ?? []));
    this.restoreLinked = linkedRestore;

    for (const s of clamSpawns()) {
      const y = this.ground.heightAt(s.x, s.z) + s.lift;
      if (this.purified.has(s.id)) {
        this.spawnTurtle(s.id, { x: s.x, y, z: s.z });
        continue;
      }
      this.enemies.push(this.makeEnemy('clam', s.id, { x: s.x, y, z: s.z }, s.yaw));
    }
    for (const s of crocSpawns()) {
      const y = this.ground.heightAt(s.x, s.z) + s.lift;
      const croc = this.makeEnemy('croc', s.id, { x: s.x, y, z: s.z }, s.yaw);
      if (this.restoreLinked.has(s.id)) croc.linked = true;
      this.enemies.push(croc);
    }

    // Ancient cyan lamps guide the player through the otherwise deep fog.
    for (const [x, y, z] of [[0, 15, 10], [-29, 12, -17], [29, 12, 28]] as const) {
      const light = new THREE.PointLight(0x54e5db, 18, 62, 2);
      light.position.set(UNDERWATER.center.x + x, UNDERWATER.floorY + y, UNDERWATER.center.z + z);
      this.deep.add(light);
    }
  }

  /** Live enemy spheres, hit-tested before ordinary wildlife by DartSystem. */
  dartTargets(): UnderwaterTarget[] {
    return this.enemies.filter((e) => e.active).flatMap((e) => {
      if (e.kind === 'clam') {
        return [{ id: e.id, pos: { x: e.pos.x, y: e.pos.y + 0.45, z: e.pos.z }, size: 1.55 }];
      }
      // Crocs are long (head-to-tail ~7 m), so three overlapping spheres
      // make the visible snout/body/tail all honestly hittable instead of
      // accepting darts only through an invisible ball at the belly.
      const fx = -Math.sin(e.yaw);
      const fz = -Math.cos(e.yaw);
      return [
        { id: e.id, pos: { x: e.pos.x + fx * 2.15, y: e.pos.y, z: e.pos.z + fz * 2.15 }, size: 1.35 },
        { id: e.id, pos: { ...e.pos }, size: 1.55 },
        { id: e.id, pos: { x: e.pos.x - fx * 2.0, y: e.pos.y, z: e.pos.z - fz * 2.0 }, size: 1.25 },
      ];
    });
  }

  /** Only living clams accept purifier darts; crocodiles are unaffected. */
  purifierTargets(): { id: number; pos: Vec3; r: number }[] {
    return this.enemies
      .filter((e) => e.active && e.kind === 'clam')
      .map((e) => ({ id: e.id, pos: { x: e.pos.x, y: e.pos.y + 0.45, z: e.pos.z }, r: 1.55 }));
  }

  purifiedClamIds(): number[] {
    return [...this.purified].sort((a, b) => a - b);
  }

  /**
   * Resolve a tracker/slow/tide dart against one underwater enemy. Wave E
   * (Spencer): darts never damage or kill anything down here — this is a
   * non-violent game. A dart TAGS a crocodile (starting its tracking clock,
   * exactly like surface critters); clams simply shrug darts off (they are
   * PURIFIED with purifying darts instead — see purifyClam).
   */
  hitEnemy(id: number, dartKind: DartKind): boolean {
    void dartKind;
    const enemy = this.enemies.find((e) => e.id === id && e.active);
    if (!enemy) return false;
    if (enemy.kind === 'croc' && !enemy.linked && !enemy.tagged) {
      enemy.tagged = true;
      this.opts.onCrocTagged?.(enemy.id);
    }
    return true;
  }

  /** Linked (befriended) crocodile ids, for the save. */
  linkedCrocIds(): number[] {
    return this.enemies
      .filter((e) => e.kind === 'croc' && e.linked)
      .map((e) => e.id)
      .sort((a, b) => a - b);
  }

  /** Permanently turn an individual living clam into a harmless cute turtle. */
  purifyClam(id: number): boolean {
    const enemy = this.enemies.find((e) => e.id === id && e.kind === 'clam' && e.active);
    if (!enemy || this.purified.has(id)) return false;
    enemy.active = false;
    enemy.purified = true;
    this.purified.add(id);
    const pos = { ...enemy.pos };
    this.removeEnemyVisual(enemy);
    this.spawnTurtle(id, pos);
    // Wave E: shell fragments come from PURIFYING a clam (it sheds its old
    // armor as it transforms), never from breaking one.
    this.opts.onDrop('shell', UNDERWATER.shellDrop, pos);
    this.opts.onPurifiedClam?.(id, pos);
    return true;
  }

  /** Enemy AI, chomp/bite animation, turtles, coral sway, and bubbles. */
  update(dt: number, playerPos: Vec3, playerUnderwater: boolean): void {
    this.t += dt;
    const near = Math.hypot(
      playerPos.x - UNDERWATER.center.x,
      playerPos.z - UNDERWATER.center.z,
    ) <= UNDERWATER.diveRadius + 260;
    this.deep.visible = near;
    if (!near) return;
    for (const enemy of this.enemies) {
      // Wave E: nothing dies down here anymore — the only way an enemy goes
      // inactive is clam purification, which is permanent.
      if (!enemy.active) continue;
      if (enemy.kind === 'clam') this.updateClam(enemy, dt, playerPos, playerUnderwater);
      else this.updateCroc(enemy, dt, playerPos, playerUnderwater);
      // Wave E croc tracking: accrue while the player stays close (progress
      // never decays — crocs are patient), Link at the threshold: drop croc
      // hide, turn permanently friendly. Linked crocs shed another hide every
      // crocShedS while the player is around to collect it.
      if (enemy.kind === 'croc') {
        const pdist = Math.hypot(
          playerPos.x - enemy.pos.x,
          playerPos.y - enemy.pos.y,
          playerPos.z - enemy.pos.z,
        );
        if (enemy.tagged && !enemy.linked) {
          if (pdist <= UNDERWATER.crocTrackRadius) enemy.trackProgress += dt;
          if (enemy.trackProgress >= UNDERWATER.crocTrackTime) {
            enemy.linked = true;
            enemy.tagged = false;
            this.opts.onDrop('scale', UNDERWATER.scaleDrop, enemy.pos);
            this.opts.onCrocLinked?.(enemy.id, { ...enemy.pos });
          }
        } else if (enemy.linked) {
          enemy.shedFor -= dt;
          if (enemy.shedFor <= 0 && pdist <= 40) {
            enemy.shedFor = UNDERWATER.crocShedS;
            this.opts.onDrop('scale', 1, enemy.pos);
          }
        }
      }
      this.syncEnemy(enemy);
    }

    for (const turtle of this.turtles) {
      const orbit = this.t * 0.25 + turtle.phase;
      turtle.visual.root.position.set(
        turtle.home.x + Math.cos(orbit) * 2.8,
        turtle.home.y + 1.2 + Math.sin(this.t * 1.4 + turtle.phase) * 0.45,
        turtle.home.z + Math.sin(orbit) * 2.8,
      );
      turtle.visual.root.rotation.y = -orbit + Math.PI / 2;
      turtle.visual.flippers.forEach((f, i) => {
        f.rotation.z = Math.sin(this.t * 4 + turtle.phase + i * Math.PI) * 0.32;
      });
    }

    this.updateBubbles();
    this.palace.traverse((o) => {
      const phase = o.userData.seaweedPhase;
      if (typeof phase === 'number') o.rotation.z = Math.sin(this.t * 0.8 + phase) * 0.12;
    });
  }

  /**
   * Apply underwater atmosphere after the daylight rig. The daylight rig may
   * early-out on an unchanged sun phase, so this method also restores the
   * exact day/night fog every non-underwater frame instead of relying on a
   * transition write that might never happen.
   */
  applyView(active: boolean, darkness: number): void {
    const sky = this.scene.getObjectByName('skyDome');
    if (sky) sky.visible = !active;
    const k = Math.max(0, Math.min(1, darkness));
    const color = active
      ? UNDERWATER.fogColor
      : lerpColorHex(ENV.fogColor, DAYLIGHT.night.fogColor, k);
    const near = active
      ? UNDERWATER.fogNear
      : THREE.MathUtils.lerp(ENV.fogNear, DAYLIGHT.night.fogNear, k);
    const far = active
      ? UNDERWATER.fogFar
      : THREE.MathUtils.lerp(ENV.fogFar, DAYLIGHT.night.fogFar, k);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(color);
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    }
    if (this.scene.background instanceof THREE.Color) this.scene.background.setHex(color);
    else this.scene.background = new THREE.Color(color);
  }

  dispose(): void {
    this.scene.remove(this.root);
    disposeUnderwaterTree(this.root);
    this.enemies.length = 0;
    this.turtles.length = 0;
  }

  // -------------------------------------------------------------------------

  private makeEnemy(kind: UnderwaterEnemyKind, id: number, home: Vec3, yaw: number): EnemyRuntime {
    const runtime: EnemyRuntime = {
      id,
      kind,
      home: { ...home },
      pos: { ...home },
      yaw,
      tagged: false,
      trackProgress: 0,
      linked: false,
      shedFor: UNDERWATER.crocShedS,
      active: true,
      purified: false,
      phase: 'idle',
      timer: 0,
      cooldown: 0,
      clam: null,
      croc: null,
    };
    this.spawnEnemyVisual(runtime);
    return runtime;
  }

  /** Convenient optional root shared by the two visual variants. */
  private enemyRoot(enemy: EnemyRuntime): THREE.Group | null {
    return enemy.clam?.root ?? enemy.croc?.root ?? null;
  }

  private spawnEnemyVisual(enemy: EnemyRuntime): void {
    if (enemy.kind === 'clam') {
      enemy.clam = buildClamGuard(WORLD_SEED ^ enemy.id);
      this.deep.add(enemy.clam.root);
    } else {
      enemy.croc = buildCrocodile(WORLD_SEED ^ enemy.id);
      this.deep.add(enemy.croc.root);
    }
    this.syncEnemy(enemy);
  }

  private removeEnemyVisual(enemy: EnemyRuntime): void {
    const root = this.enemyRoot(enemy);
    if (root) {
      this.deep.remove(root);
      disposeUnderwaterTree(root);
    }
    enemy.clam = null;
    enemy.croc = null;
  }

  private spawnTurtle(id: number, home: Vec3): void {
    const visual = buildTurtle(WORLD_SEED ^ id ^ 0x7a71e);
    visual.root.name = 'purifiedTurtle';
    visual.root.userData.clamId = id;
    visual.root.position.set(home.x, home.y + 1.2, home.z);
    this.deep.add(visual.root);
    this.turtles.push({ id, home: { ...home }, visual, phase: id * 0.71 });
  }

  private updateClam(enemy: EnemyRuntime, dt: number, p: Vec3, submerged: boolean): void {
    const dx = p.x - enemy.pos.x;
    const dy = p.y + 0.7 - enemy.pos.y;
    const dz = p.z - enemy.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    enemy.yaw = Math.atan2(-dx, -dz);

    if (!submerged || dist > UNDERWATER.clamNoticeR) {
      enemy.phase = 'idle';
      enemy.timer = 0;
    } else if (enemy.phase === 'idle') {
      enemy.phase = 'windup';
      enemy.timer = UNDERWATER.clamWindupS;
    } else {
      enemy.timer -= dt;
      if (enemy.timer <= 0) {
        if (enemy.phase === 'windup') {
          enemy.phase = 'chomp';
          enemy.timer = UNDERWATER.clamChompS;
          if (dist <= UNDERWATER.clamHitR) this.opts.onPlayerHit(UNDERWATER.clamDamage, enemy.pos);
        } else if (enemy.phase === 'chomp') {
          enemy.phase = 'recover';
          enemy.timer = UNDERWATER.clamRecoverS;
        } else {
          enemy.phase = dist <= UNDERWATER.clamNoticeR ? 'windup' : 'idle';
          enemy.timer = enemy.phase === 'windup' ? UNDERWATER.clamWindupS : 0;
        }
      }
    }

    const v = enemy.clam;
    if (!v) return;
    let open = 0.08;
    if (enemy.phase === 'windup') open = 0.82 * (1 - enemy.timer / UNDERWATER.clamWindupS) + 0.1;
    else if (enemy.phase === 'chomp') open = 0.82 * (enemy.timer / UNDERWATER.clamChompS);
    else if (enemy.phase === 'recover') open = 0.08;
    v.upper.rotation.x = -open;
    v.lower.rotation.x = open * 0.22;
    v.pearl.scale.setScalar(1 + Math.sin(this.t * 5 + enemy.id) * 0.08);
  }

  private updateCroc(enemy: EnemyRuntime, dt: number, p: Vec3, submerged: boolean): void {
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    const dx = p.x - enemy.pos.x;
    const dy = p.y + 0.7 - enemy.pos.y;
    const dz = p.z - enemy.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    // Linked (befriended) crocs never chase or bite — they lazily patrol.
    const chasing = !enemy.linked && submerged && dist <= UNDERWATER.crocNoticeR;

    let tx: number;
    let ty: number;
    let tz: number;
    let speed: number;
    if (chasing) {
      tx = p.x;
      ty = p.y + 0.6;
      tz = p.z;
      speed = UNDERWATER.crocChaseSpeed;
      if (dist <= UNDERWATER.crocBiteR && enemy.cooldown <= 0) {
        enemy.cooldown = UNDERWATER.crocBiteCooldownS;
        this.opts.onPlayerHit(UNDERWATER.crocDamage, enemy.pos);
      }
    } else {
      const orbit = this.t * 0.18 + enemy.id * 0.93;
      tx = enemy.home.x + Math.cos(orbit) * 13;
      ty = enemy.home.y + Math.sin(orbit * 1.7) * 1.5;
      tz = enemy.home.z + Math.sin(orbit) * 13;
      speed = UNDERWATER.crocPatrolSpeed;
    }

    const mx = tx - enemy.pos.x;
    const my = ty - enemy.pos.y;
    const mz = tz - enemy.pos.z;
    const len = Math.hypot(mx, my, mz) || 1;
    const step = Math.min(speed * dt, len);
    enemy.pos.x += (mx / len) * step;
    enemy.pos.y += (my / len) * step;
    enemy.pos.z += (mz / len) * step;
    const floor = this.ground.heightAt(enemy.pos.x, enemy.pos.z) + 1.1;
    enemy.pos.y = Math.max(floor, Math.min(-2, enemy.pos.y));
    enemy.yaw = Math.atan2(-mx, -mz);

    if (enemy.croc) {
      const bitePhase = enemy.cooldown > UNDERWATER.crocBiteCooldownS - 0.35
        ? Math.sin(((UNDERWATER.crocBiteCooldownS - enemy.cooldown) / 0.35) * Math.PI)
        : 0;
      enemy.croc.jaw.rotation.x = bitePhase * 0.55;
      enemy.croc.tail.rotation.y = Math.sin(this.t * 5 + enemy.id) * 0.34;
      enemy.croc.root.rotation.z = Math.sin(this.t * 2.2 + enemy.id) * 0.035;
    }
  }

  private syncEnemy(enemy: EnemyRuntime): void {
    const root = this.enemyRoot(enemy);
    if (!root) return;
    root.position.set(enemy.pos.x, enemy.pos.y, enemy.pos.z);
    root.rotation.y = enemy.yaw;
  }

  private buildBubbles(): { points: THREE.Points; base: Float32Array } {
    const count = 150;
    const positions = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const rand = mulberry32(WORLD_SEED ^ 0xbabb1e);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (UNDERWATER.diveRadius - 12);
      const x = UNDERWATER.center.x + Math.cos(a) * r;
      const y = UNDERWATER.floorY + rand() * -UNDERWATER.floorY;
      const z = UNDERWATER.center.z + Math.sin(a) * r;
      positions.set([x, y, z], i * 3);
      base.set([x, y, z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xb9fff8,
        size: 0.38,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    points.name = 'atlantisBubbles';
    return { points, base };
  }

  private updateBubbles(): void {
    const attr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const span = -UNDERWATER.floorY + 2;
    for (let i = 0; i < arr.length / 3; i++) {
      const baseY = this.bubbleBase[i * 3 + 1]!;
      arr[i * 3 + 1] = UNDERWATER.floorY + ((baseY - UNDERWATER.floorY + this.t * (0.55 + (i % 7) * 0.08)) % span);
      arr[i * 3] = this.bubbleBase[i * 3]! + Math.sin(this.t * 0.7 + i) * 0.22;
    }
    attr.needsUpdate = true;
  }
}
