// tests/tiny-tide-core/eel-fight.test.ts — T18 review I2: an aimed, biting size-1 player kills a Moray eel within the P5 target (≤ 30 s) through
// the real simFrame (ecosystem, AI, combat world). Before the fix the eel's Bite knockback pushed it past its leash, it gave up, went calm and
// healed to full (D37) on every outing.
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { const g = globalThis as Record<string, unknown>; g.window ??= globalThis; g.document ??= { body: { dataset: {} } }; });
import { makeFixture } from '../../tests-browser/fixtures';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';
import { RELEASED } from '../../src/tiny-tide/input';
import { activeStartsIn } from '../../src/tiny-tide/action-engine';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
import { EDGE_SOFT_START } from '../../src/tiny-tide/edge';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';

const DT = 1 / 60, P5_SECONDS = 30;
function world(seed: number): SimWorld {
  const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
  return { eco: new Ecosystem(seed), startGrace: 2, isOnScreen: () => true, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
}
/** The bot: aims at the eel's hull centre (a pointer aim), swims to it, bites every .1 s in reach, and Dashes across the attack axis when a
 *  wind-up at it becomes active within .15 s. Returns the kill time (or null) and the faints. */
export function eelFight(seed: number, line: 'swimmer' | 'crawler', seconds = 60) {
  const run = makeFixture({ stage: 1, seed, line }).run!, w = world(seed), s = newSimState(run), S = SIZES[1]!;
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  const anchor = { ...s.physical };
  const eel = w.eco.entities.filter(e => e.spec.key === '2:eel' && !e.eaten && Math.max(Math.abs(e.x), Math.abs(e.z)) < 38 * S)
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))[0];
  if (!eel) return null;
  simBegin(s, w, run, { x: (eel.x + 3 * SIZES[2]!) / S, y: eel.y / S, z: eel.z / S });
  const dash = s.moves?.slots.slots.indexOf('dash') ?? -1, L = SIZES[2]! * 1.4, t0 = s.time;
  for (let f = 0; f < seconds * 60; f++) {
    const p = s.physical, c = s.combat.stateOf(eel), t = { x: eel.x, y: eel.y + .35 * SIZES[2]!, z: eel.z };
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz) || 1, aim: Vec3 = { x: dx / d, y: dy / d, z: dz / d };
    const threat = c?.rt.actions.find(a => a.targetId === 'player' && a.phase === 'windup' && activeStartsIn(a, c.rt.actionClock) <= .15);
    const press = !threat && d < .5 * L + 3 * S && f % 6 === 0;
    const activePressed = [0, 1, 2, 3].map(k => !!threat && k === dash) as CombatInput['activePressed'];
    const wish: Vec3 = threat ? { x: -aim.z, y: 0, z: aim.x } : d > .4 * L + 2 * S ? { x: aim.x, y: 0, z: aim.z } : { x: 0, y: 0, z: 0 };
    const intent: CombatInput = { ...RELEASED, move: wish, aim, aimSource: 'pointer', basicPressed: press, basicHeld: press, activePressed, activeHeld: activePressed,
      traversal: line === 'swimmer' ? dy > 2 ? 'rise' : dy < -2 ? 'dive' : 'none' : 'none' };
    simFrame(s, w, { dt: DT, intent, wish, held: false });
    if (eel.eaten) return { killedAt: s.time - t0, faints: run.deaths };
  }
  return { killedAt: null, faints: run.deaths, hpLeft: eel.hp };
}

describe('the Moray eel can be killed (T18 review I2)', () => {
  it(`an aimed biting swimmer kills an eel within ${P5_SECONDS} s on 3 seeds`, () => {
    const results: string[] = []; let fights = 0;
    for (let seed = 1; seed <= 12 && fights < 3; seed++) {
      const r = eelFight(seed, 'swimmer'); if (!r) continue;
      fights++; results.push(`seed ${seed}: ${JSON.stringify(r)}`);
      expect(r.killedAt, results.join('; ')).not.toBeNull(); expect(r.killedAt!, results.join('; ')).toBeLessThanOrEqual(P5_SECONDS);
    }
    expect(fights).toBe(3);
  }, 120_000);
});

/** Final review I4: the player walks to the den, takes the ambush and then stays where the knock left it (no Bites, no moves) for `seconds`.
 *  Returns the eel's attack starts by id, or null with no eel near the start. */
export function eelStay(seed: number, seconds = 90) {
  const run = makeFixture({ stage: 1, seed, line: 'swimmer', mouth: { 1: 'mouth_snapper' }, add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }] } }).run!;
  const w = world(seed), s = newSimState(run), S = SIZES[1]!;
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  const anchor = { ...s.physical };
  const eel = w.eco.entities.filter(e => e.spec.key === '2:eel' && !e.eaten && Math.max(Math.abs(e.x), Math.abs(e.z)) < 38 * S)
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))[0];
  if (!eel) return null;
  simBegin(s, w, run, { x: (eel.x + 3 * SIZES[2]!) / S, y: eel.y / S, z: eel.z / S });
  const L = SIZES[2]! * 1.4, starts: Record<string, number> = {}, seen = new Set<string>(); let hits = 0;
  // Past the soft edge every hunter gives up by design (ecosystem pastSoftEdge): such a start (seed 3's den) does not test the eel.
  if (Math.max(Math.abs(s.physical.x), Math.abs(s.physical.z)) > EDGE_SOFT_START * PLAYER_HALF * S - 2 * L) return null;
  for (let f = 0; f < seconds * 60; f++) {
    const p = s.physical, c = s.combat.stateOf(eel), t = { x: eel.x, y: eel.y + .35 * SIZES[2]!, z: eel.z };
    for (const a of c?.rt.actions ?? []) if (!seen.has(a.instanceId)) { seen.add(a.instanceId); starts[a.definitionId] = (starts[a.definitionId] ?? 0) + 1; }
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz) || 1, aim: Vec3 = { x: dx / d, y: dy / d, z: dz / d };
    const home = c?.ai?.home ?? t, hx = home.x - p.x, hz = home.z - p.z, hd = Math.hypot(hx, hz) || 1;
    const wish: Vec3 = hits > 0 || hd <= .6 * L ? { x: 0, y: 0, z: 0 } : { x: hx / hd, y: 0, z: hz / hd };
    const intent: CombatInput = { ...RELEASED, move: wish, aim, aimSource: 'pointer', traversal: dy > 2 ? 'rise' : dy < -2 ? 'dive' : 'none' };
    for (const e of simFrame(s, w, { dt: DT, intent, wish, held: false })) if (e.type === 'combat') for (const x of e.tick.events) if (x.targetId === 'player') hits++;
    if (eel.eaten || run.deaths > 0) break;
  }
  return starts;
}
describe('the Moray eel fights after its ambush (final review I4)', () => {
  it('a player who stays where the ambush knocked it sees eel Bites or Wraps within 90 s on each of 3 seeds', () => {
    const results: string[] = []; let fights = 0;
    for (let seed = 1; seed <= 12 && fights < 3; seed++) {
      const r = eelStay(seed); if (!r) continue;
      fights++; results.push(`seed ${seed}: ${JSON.stringify(r)}`);
    }
    expect(fights).toBe(3);
    if (process.env.TIDE_DEBUG) console.log("EELSTAY", results.join("; "));
    for (const r of results) expect(/"eel-(bite|wrap)"/.test(r), results.join('; ')).toBe(true);
  }, 240_000);
});
