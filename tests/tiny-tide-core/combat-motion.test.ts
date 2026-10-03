// tests/tiny-tide-core/combat-motion.test.ts — spec §5.12: combat motion goes through resolveMotion and never installs a refused pose.
import { describe, expect, it } from 'vitest';
import { random, SIZES, WORLD_HALF } from '../../src/tiny-tide/biomes';
import { Ecosystem, speciesActor } from '../../src/tiny-tide/ecosystem';
import { newRuntime, type Vec3 } from '../../src/tiny-tide/combat-types';
import { starterFor } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { findRecoveryPose } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { plan } from '../../src/tiny-tide/plans';
import { NO_COMBAT_MOTION, stepPlayer, type CombatMotion } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { stageSolids } from '../../src/tiny-tide/reef';
import { STAGES } from '../../src/tiny-tide/state';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';

const DT = 1 / 30;
/** A player of `planId` at size 1 next to the reef solids of a seed: `cases` seeded starts, each stepped 12 times under random combat motion. */
function sweep(planId: string, seed: number, cases: number, motion: (r: () => number, L: number) => CombatMotion, kick?: (r: () => number, L: number) => Vec3) {
  const p = plan(planId)!, stage = p.size, actor = playerActor(p, starterFor(p), stage, 1), q = stageWorldQueries(stage, seed), bounds = stageBounds(stage), L = actor.bodyLength;
  const solids = stageSolids(stage, seed).solids.filter(s => Math.max(Math.abs(s.minX), Math.abs(s.maxX), Math.abs(s.minZ), Math.abs(s.maxZ)) < 35 * SIZES[stage]!);
  const rand = random(seed * 101 + 7), ctx = { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed };
  let installed = 0, refused = 0;
  for (let c = 0; c < cases; c++) {
    const s = solids[Math.floor(rand() * solids.length)]!, a = rand() * 2 * Math.PI, cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2, r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + .6 * L;
    const near = { x: cx + Math.sin(a) * r, y: (s.minY + s.maxY) / 2, z: cz + Math.cos(a) * r }, o = { yaw: a + Math.PI, pitch: 0 };
    const start = findRecoveryPose(actor, near, { queries: q, bounds, orientation: o, time: 0 }, { maxDistance: 3 * L }); if (!start.ok) continue;
    const rt = newRuntime(start.orientation); let pos = start.position;
    if (kick) { const k = kick(rand, L); rt.externalVelocity.x = k.x; rt.externalVelocity.y = k.y; rt.externalVelocity.z = k.z; }
    for (let i = 0; i < 12; i++) {
      const res = stepPlayer(pos, rt, RELEASED, { ...ctx, now: i * DT, dt: DT, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, combat: motion(rand, L) });
      if (res.needsRecovery) { refused++; break; }
      expect(q.overlapHull(actor, res.position, rt.orientation, { time: (i + 1) * DT, permit: rt.permit, bounds }).ok, `${planId} seed ${seed} case ${c} step ${i}`).toBe(true);
      pos = res.position; installed++;
    }
  }
  return { installed, refused };
}
const dir = (r: () => number, flat: boolean): Vec3 => { const a = r() * 2 * Math.PI, e = flat ? 0 : (r() - .5) * 1.2; return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) }; };
const scaled = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

describe('combat motion', () => {
  it('knockback, lunge, dash and grab motion never install a refused pose (player: dash, knockback, grab)', () => {
    let steps = 0;
    for (const [planId, flat] of [['swimmer', false], ['crawler', true]] as const) for (const seed of [1, 2]) {
      // Dash: 1.6 L in .18 s; knockback: up to 45 L/s (the largest 3a impulse); grab: up to .5 L a tick toward the claw point. 500 starts in all.
      steps += sweep(planId, seed, 42, (r, L) => ({ ...NO_COMBAT_MOTION, dashVelocity: scaled(dir(r, flat), 1.6 * L / .18) })).installed;
      steps += sweep(planId, seed, 42, () => NO_COMBAT_MOTION, (r, L) => scaled(dir(r, flat), 45 * L * r())).installed;
      steps += sweep(planId, seed, 41, (r, L) => ({ ...NO_COMBAT_MOTION, forcedDisplacement: scaled(dir(r, false), .5 * L * r()) })).installed;
    }
    expect(steps).toBeGreaterThan(2000);
  }, 120_000);
  it('a forced grab displacement into the seabed is blocked with progress below .5', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = stageWorldQueries(1, 1), bounds = stageBounds(1), L = actor.bodyLength;
    const ground = q.terrain.groundAt(0, 0), start = findRecoveryPose(actor, { x: 0, y: ground + 1.2 * L, z: 0 }, { queries: q, bounds, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 3 * L });
    expect(start.ok).toBe(true); if (!start.ok) return;
    const rt = newRuntime(start.orientation), into = { x: 0, y: -4 * L, z: 0 };   // far below the seabed
    const res = stepPlayer(start.position, rt, RELEASED, { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: 4, topSpeedLocal: STAGES[1]!.speed,
      now: 0, dt: DT, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, combat: { ...NO_COMBAT_MOTION, forcedDisplacement: into } });
    expect(res.status).toBe('blocked'); expect(res.progress).toBeLessThan(.5); expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(q.overlapHull(actor, res.position, rt.orientation, { time: DT, bounds }).ok).toBe(true);
  });
  it('a hit-stop freezes displacement and keeps both velocities; a dash replaces the controlled velocity', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = stageWorldQueries(1, 1), bounds = stageBounds(1), at = { x: 0, y: 40, z: 0 };
    const ctx = { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: 4, topSpeedLocal: STAGES[1]!.speed, now: 0, dt: DT, wish: { x: 0, y: 0, z: 1 }, aim: null, actionLock: false };
    const rt = newRuntime(); rt.controlledVelocity.z = 5; rt.externalVelocity.x = 3;
    const frozen = stepPlayer(at, rt, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, frozen: true } });
    expect(frozen.position).toEqual(at); expect(rt.controlledVelocity.z).toBe(5); expect(rt.externalVelocity.x).toBe(3);
    const d = newRuntime(), dash = stepPlayer(at, d, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, dashVelocity: { x: 30, y: 0, z: 0 } } });
    expect(dash.position.x).toBeCloseTo(1); expect(d.controlledVelocity.x).toBeCloseTo(30);   // 30 × 1/30
    const slow = newRuntime(); slow.controlledVelocity.z = 100;
    stepPlayer(at, slow, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, speedFactor: .5 } });
    expect(slow.controlledVelocity.z).toBeLessThan(100);   // it brakes toward half the top speed
  });
});
describe('combat motion of species', () => {
  it('knockback, lunge, dash and grab motion never install a refused pose (species: lunge, knockback, held)', () => {
    // Crabs (tier 1, ground) and fixture swimmers next to reef rocks and arches, pushed by random lunges, knockbacks and claw pulls.
    let steps = 0;
    for (const seed of [1, 2, 3]) {
      const eco = new Ecosystem(seed), rand = random(seed * 13 + 1), q = stageWorldQueries(1, seed), bounds = { half: WORLD_HALF * SIZES[1]! };
      const solids = stageSolids(1, seed).solids.filter(s => Math.max(Math.abs(s.minX), Math.abs(s.maxX), Math.abs(s.minZ), Math.abs(s.maxZ)) < 35 * SIZES[1]!);
      const crabs = eco.entities.filter(e => e.spec.key === '1:crab');
      eco.step({ stage: 1, dt: DT, now: 0, player: { x: 0, y: 900, z: 0 }, playerHull: [], perceivable: false, stealthFactor: 1, unlocked: [] });
      for (let c = 0; c < 56; c++) {
        const e = crabs[c % crabs.length]!, s = solids[Math.floor(rand() * solids.length)]!, a = rand() * 2 * Math.PI, L = speciesActor(e).bodyLength, r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + .6 * L;
        const start = findRecoveryPose(speciesActor(e), { x: (s.minX + s.maxX) / 2 + Math.sin(a) * r, y: s.minY, z: (s.minZ + s.maxZ) / 2 + Math.cos(a) * r }, { queries: q, bounds, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 3 * L });
        if (!start.ok) continue;
        e.x = e.hx = start.position.x; e.y = e.hy = start.position.y; e.z = e.hz = start.position.z;
        const kind = c % 3, push = scaled(dir(rand, true), kind === 2 ? .5 * L * rand() : (kind === 0 ? 1.2 * L / .22 : 45 * L * rand()));
        e.combat = { intent: { kind: 'hold' }, face: null, lunge: kind === 0 ? push : null, external: kind === 1 ? { ...push } : { x: 0, y: 0, z: 0 }, frozen: false, held: kind === 2 ? push : null, moved: 0 };
        for (let i = 0; i < 8; i++) {
          eco.step({ stage: 1, dt: DT, now: (i + 1) * DT, player: { x: 0, y: 900, z: 0 }, playerHull: [], perceivable: false, stealthFactor: 1, unlocked: [] });
          if (e.eaten) break;
          expect(q.overlapHull(speciesActor(e), { x: e.x, y: e.y, z: e.z }, { yaw: 0, pitch: 0 }, { time: (i + 1) * DT, bounds }).ok, `seed ${seed} case ${c} step ${i}`).toBe(true); steps++;
        }
        e.combat = null;
      }
    }
    expect(steps).toBeGreaterThan(1000);
  }, 120_000);
});

// Final review I3: the separation pre-check never skips a push that the full overlap test would make.
import { deepestOverlap as _deepestOverlap, SEPARATION_SLOP as _SLOP, sphereOverlapsHull as _sphereOverlapsHull } from '../../src/tiny-tide/separation';
describe('separation pre-check (final review I3)', () => {
  it('is true whenever the full test finds an overlap past the slop', () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const hull = [{ start: { x: 0, y: 1, z: -.4 }, end: { x: 0, y: 1, z: .4 }, radius: .3 }, { start: { x: 0, y: 1, z: .4 }, end: { x: 0, y: 1.1, z: .9 }, radius: .2 }];
    let overlaps = 0;
    for (let i = 0; i < 5000; i++) {
      const x = (rnd() - .5) * 3, y = 1 + (rnd() - .5) * 3, z = (rnd() - .5) * 4, r = .05 + rnd() * 1.2, slop = _SLOP * 1.6;
      const full = _deepestOverlap(hull, [{ start: { x, y, z }, end: { x, y, z }, radius: r }]).depth > slop;
      if (full) { overlaps++; expect(_sphereOverlapsHull(hull, x, y, z, r, slop)).toBe(true); }
      if (!_sphereOverlapsHull(hull, x, y, z, r, slop)) expect(full).toBe(false);
    }
    expect(overlaps).toBeGreaterThan(100);
  });
});
