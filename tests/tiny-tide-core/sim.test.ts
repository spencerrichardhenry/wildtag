// tests/tiny-tide-core/sim.test.ts — spec D29 and §14.1: sim.ts keeps the former main.ts tick order. Two scripted stage 0 runs (dt 1/60)
// are pinned by sim-golden.json, recorded with the main.ts frame before the extraction (T6a, a line-for-line port of it) and matched by sim.ts:
// - `journey` (seed 7, 20 s from the start anchor): swims, chomps, eats three times (three growth rescales of the hull), touches the reef;
// - `rescue` (seed 358833899, 10 s from a forced spawn): one held push into the pocket between rock:0:0 and arch:0:0, which the trap
//   watch rescues twice (search in slices under the frame's admission budget, then the glide);
// - `faint` (seed 3, 70 s, a slow circle until 54.3 s, then still): the Peach crab e95 (a combat hunter since T16) lands five telegraphed
//   attacks on the still Speck (lunge 54.2 s, pinch 56.6 s, sweep 58.9 s, lunge 61.5 s, pinch 64.0 s: 12 half-hearts), the faint at 64.0 s
//   and the respawn at 65.8 s, then nothing to the end (the D27 give-up);
// - `regen` (seed 3, 80 s, from 3 of 6 hearts): the `faint` circle until 54.3 s, then +x. With no damage and no wind-up yet, the hearts
//   come back half a heart every 2 s (spec §10.2) from 2 s to 4.5 at 6 s; a Spiny snail's poke wind-up at 7.2 s (it misses) holds the regen
//   until 15.7 s, then +.5 every 2 s to full at 19.7 s; the crab's lunge (54.2 s) and pinch (56.6 s) hit, the Speck runs on +x, the crab
//   gives up and the herbivore Speck gets the survivor bonus (+8 DNA at 57.3 s, D22); regen to full again from 64.6 s.
//   (T15 re-records: before T15 one hit at 64.4 s and regen every 2.5 s after 5 s; T15 itself, with the give-up counted from the faint,
//   fainted the player again at 64.1 s and 72.4 s; fix round 1 counts it from the respawn. T16 re-records `faint` and `regen`: the crab
//   lost its contact hazard and attacks with telegraphs, so a circling Speck takes one hit, not a faint; `faint` now stands still after
//   54.3 s so that the faint path is still covered.)
//   (T19 fix round 1 re-records `faint` and `regen`: swimming species now move their root to the AI's hull-centre points, so from 29.4 s
//   the circling Speck's route differs by .02–.05 units at first. In `faint` the circling Speck is no longer hit at 49.5 s: the hits come
//   after it stops (54.5–64.5 s), the faint at 64.5 s and the respawn at 66 s. In `regen` the crab no longer lands a hit, so the hearts are
//   full from 19.7 s to the end, with no survivor bonus; ai-tick.test covers the bonus through simFrame.)
// Not covered: the stuck retry, held frames, a win, and the modes other than playing and fainted.
// A task that changes stage 0 on purpose re-records it from sim.ts with TIDE_SIM_RECORD=sim and says why in its commit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';
import { freshRun, type Run } from '../../src/tiny-tide/state';
import { readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';

const GOLDEN = 'tests/tiny-tide-core/sim-golden.json', DT = 1 / 60;
/** `rescues`: trap rescues found so far (each starts a glide). */
export interface Sample { t: number; x: number; y: number; z: number; health: number; stageDna: number; dna: number; bites: number; mode: string; rescues: number; deaths: number }
/** `run`: the run so far (a script may react to a faint). */
export type Script = (t: number, previous: CombatInput, run: Run) => { intent: CombatInput; wish: Vec3 };
/** A scripted run: the world seed (also the run's), an optional forced spawn (stage-local units), its length and the sample interval;
 *  `health`: the starting hearts (default: full). */
export interface Scenario { seed: number; forced: Vec3 | null; frames: number; every: number; script: Script; health?: number }
const intentOf = (keys: Set<string>, previous: CombatInput): CombatInput => {
  const src: InputSources = { stickX: 0, stickZ: 0, keys, chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false };
  return readIntent(src, previous, { breachOnRiseTap: false });
};
/** The journey script: forward 0–5 s, right 5–8 s, back-left 8–14 s, still after; Space held 3–12 s, tapped every second after 14 s. */
export function script(t: number, previous: CombatInput): { intent: CombatInput; wish: Vec3 } {
  const keys = new Set<string>();
  if (t >= 3 && t < 12) keys.add('Space');
  if (t >= 14 && Math.floor(t) !== Math.floor(t - DT)) keys.add('Space');
  const wish = t < 5 ? { x: 0, y: 0, z: 1 } : t < 8 ? { x: 1, y: 0, z: 0 } : t < 14 ? { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } : { x: 0, y: 0, z: 0 };
  return { intent: intentOf(keys, previous), wish };
}
const circle = (t: number): Vec3 => ({ x: Math.sin(.3 * t), y: 0, z: Math.cos(.3 * t) });
const PUSH = 2.59, pushWish: Vec3 = { x: -Math.sin(PUSH), y: 0, z: -Math.cos(PUSH) };
export type ScenarioName = 'journey' | 'rescue' | 'faint' | 'regen';
export const SCENARIOS: Record<ScenarioName, Scenario> = {
  journey: { seed: 7, forced: null, frames: 20 * 60, every: 60, script },
  rescue: { seed: 358833899, forced: { x: 7.21, y: 2.99, z: 14.24 }, frames: 10 * 60, every: 10, script: (_t, previous) => ({ intent: intentOf(new Set(), previous), wish: pushWish }) },
  faint: { seed: 3, forced: null, frames: 70 * 60, every: 30, script: (t, previous) => ({ intent: intentOf(new Set(), previous), wish: t < 54.3 ? circle(t) : { x: 0, y: 0, z: 0 } }) },
  regen: { seed: 3, forced: null, frames: 80 * 60, every: 6, health: 3, script: (t, previous) => ({ intent: intentOf(new Set(), previous), wish: t < 54.3 ? circle(t) : { x: 1, y: 0, z: 0 } }) },
};
export const round = (v: number) => Math.round(v * 1e6) / 1e6;
export function world(seed: number): SimWorld {
  const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
  return { eco: new Ecosystem(seed), startGrace: 2, isOnScreen: () => true, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
}
function runSim(c: Scenario): Sample[] {
  const run = freshRun(c.seed), w = world(c.seed), s = newSimState(run), out: Sample[] = [];
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, c.forced); if (c.health !== undefined) run.health = c.health;
  let previous = RELEASED;
  for (let f = 1; f <= c.frames; f++) {
    const { intent, wish } = c.script(s.time, previous, s.run); previous = intent;
    simFrame(s, w, { dt: DT, intent, wish, held: false });
    if (f % c.every === 0) out.push({ t: round(s.time), x: round(s.physical.x), y: round(s.physical.y), z: round(s.physical.z), health: s.run.health, stageDna: s.run.stageDna, dna: s.run.economy.wallet.atRisk + s.run.economy.wallet.banked, bites: s.run.bites, mode: s.mode, rescues: s.trapRescues, deaths: s.run.deaths });
  }
  return out;
}
type Golden = Record<ScenarioName, Sample[]>;
const runAll = (runner: (c: Scenario) => Sample[]): Golden => ({ journey: runner(SCENARIOS.journey), rescue: runner(SCENARIOS.rescue), faint: runner(SCENARIOS.faint), regen: runner(SCENARIOS.regen) });
/** Health rises between two playing samples of one life (no faint and no respawn between them): a regen. */
const regens = (samples: readonly Sample[]) => samples.filter((x, i) => i > 0 && x.mode === 'playing' && samples[i - 1]!.mode === 'playing' && x.deaths === samples[i - 1]!.deaths && x.health > samples[i - 1]!.health).length;
describe('sim', () => {
  it('sim.ts keeps the former main.ts tick order', () => {
    const record = process.env.TIDE_SIM_RECORD;
    if (record === 'sim') {
      // Plan review R10(3): a re-record keeps the first 5 s of every scenario (nothing reaches the player that early).
      const fresh = runAll(runSim), old = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden : null;
      if (old) for (const k of Object.keys(fresh) as ScenarioName[]) expect(fresh[k].filter(x => x.t <= 5), `${k}: the first 5 s changed`).toEqual(old[k].filter(x => x.t <= 5));
      writeFileSync(GOLDEN, JSON.stringify(fresh, null, 1));
    }
    expect(existsSync(GOLDEN), 'the golden is missing').toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    // The scenarios still cover what they claim: three meals in the journey, at least one rescue in the push, a faint (0 hearts) and the
    // respawn, and regen in half hearts from a low start (T15).
    expect(golden.journey.at(-1)!.bites).toBe(3);
    expect(golden.rescue.at(-1)!.rescues).toBeGreaterThan(0);
    expect(golden.faint.some(x => x.mode === 'fainted' && x.health === 0), 'a faint').toBe(true);
    expect({ deaths: golden.faint.at(-1)!.deaths, mode: golden.faint.at(-1)!.mode }).toEqual({ deaths: 1, mode: 'playing' });
    expect(regens(golden.regen), 'regen from 3 hearts').toBeGreaterThanOrEqual(6);
    expect(runAll(runSim)).toEqual(golden);
  }, 60_000);
});
describe('the faint give-up (D27, T15 fix round 1)', () => {
  it('the regen script over 120 s faints once: hunters give up for 6 s after the respawn grace, not 6 s after the faint', () => {
    // T16: the `faint` stand until the faint (the crab's telegraphed attacks are dodged by a moving Speck), then the regen script's +x.
    const script: Script = (t, previous, run) => ({ intent: intentOf(new Set(), previous), wish: t < 54.3 ? circle(t) : run.deaths === 0 ? { x: 0, y: 0, z: 0 } : { x: 1, y: 0, z: 0 } });
    const samples = runSim({ ...SCENARIOS.regen, health: undefined, frames: 120 * 60, every: 60, script });
    expect(samples.at(-1)!.deaths).toBe(1);
  }, 60_000);
});
describe('regeneration', () => {
  it('gives half a heart every 2 s once 6 s have passed since the last damage and the last wind-up at the player', () => {
    const run = freshRun(7), w = world(7), s = newSimState(run);
    w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
    s.run.health = 4; s.rt.lastDamageAt = s.time; s.rt.lastThreatAt = s.time + 1;   // a wind-up 1 s later: regen waits for 7 s
    const samples: number[] = [];
    for (let f = 1; f <= 12 * 60; f++) { simFrame(s, w, { dt: DT, intent: RELEASED, wish: { x: 0, y: 0, z: 0 }, held: false }); if (f % 60 === 0) samples.push(s.run.health); }
    expect(samples).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4.5, 4.5, 5, 5]);   // 7 s quiet, then +.5 at 9 s and 11 s
  });
});
