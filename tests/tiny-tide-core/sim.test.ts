// tests/tiny-tide-core/sim.test.ts — spec D29 and §14.1: sim.ts keeps the former main.ts tick order. Two scripted stage 0 runs (dt 1/60)
// are pinned by sim-golden.json, recorded first with the main.ts frame (legacy-frame.ts) and then compared with sim.ts:
// - `journey` (seed 7, 20 s from the start anchor): swims, chomps, eats three times (three growth rescales of the hull), touches the reef;
// - `rescue` (seed 358833899, 10 s from a forced spawn): one held push into the pocket between rock:0:0 and arch:0:0, which the trap
//   watch rescues twice (search in slices under the frame's admission budget, then the glide).
// TIDE_SIM_RECORD=legacy rewrites the golden from legacy-frame.ts; TIDE_SIM_RECORD=sim from sim.ts (a later task that changes stage 0 on purpose).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';
import { freshRun } from '../../src/tiny-tide/state';
import { readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';

const GOLDEN = 'tests/tiny-tide-core/sim-golden.json', DT = 1 / 60;
/** `rescues`: trap rescues found so far (each starts a glide). */
export interface Sample { t: number; x: number; y: number; z: number; health: number; stageDna: number; dna: number; bites: number; mode: string; rescues: number }
export type Script = (t: number, previous: CombatInput) => { intent: CombatInput; wish: Vec3 };
/** A scripted run: the world seed (also the run's), an optional forced spawn (stage-local units), its length and the sample interval. */
export interface Scenario { seed: number; forced: Vec3 | null; frames: number; every: number; script: Script }
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
const PUSH = 2.59, pushWish: Vec3 = { x: -Math.sin(PUSH), y: 0, z: -Math.cos(PUSH) };
export const SCENARIOS: Record<'journey' | 'rescue', Scenario> = {
  journey: { seed: 7, forced: null, frames: 20 * 60, every: 60, script },
  rescue: { seed: 358833899, forced: { x: 7.21, y: 2.99, z: 14.24 }, frames: 10 * 60, every: 10, script: (_t, previous) => ({ intent: intentOf(new Set(), previous), wish: pushWish }) },
};
export const round = (v: number) => Math.round(v * 1e6) / 1e6;
export function world(seed: number): SimWorld {
  const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
  return { eco: new Ecosystem(seed), startGrace: 2, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
}
function runSim(c: Scenario): Sample[] {
  const run = freshRun(c.seed), w = world(c.seed), s = newSimState(run), out: Sample[] = [];
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, c.forced);
  let previous = RELEASED;
  for (let f = 1; f <= c.frames; f++) {
    const { intent, wish } = c.script(s.time, previous); previous = intent;
    simFrame(s, w, { dt: DT, intent, wish, held: false });
    if (f % c.every === 0) out.push({ t: round(s.time), x: round(s.physical.x), y: round(s.physical.y), z: round(s.physical.z), health: s.run.health, stageDna: s.run.stageDna, dna: s.run.economy.wallet.atRisk + s.run.economy.wallet.banked, bites: s.run.bites, mode: s.mode, rescues: s.trapRescues });
  }
  return out;
}
const runAll = (runner: (c: Scenario) => Sample[]) => ({ journey: runner(SCENARIOS.journey), rescue: runner(SCENARIOS.rescue) });
describe('sim', () => {
  it('sim.ts keeps the former main.ts tick order', async () => {
    const record = process.env.TIDE_SIM_RECORD;
    if (record === 'legacy') { const { runLegacy } = await import('./legacy-frame'); writeFileSync(GOLDEN, JSON.stringify(runAll(runLegacy), null, 1)); }
    if (record === 'sim') writeFileSync(GOLDEN, JSON.stringify(runAll(runSim), null, 1));
    expect(existsSync(GOLDEN), 'record the golden first: TIDE_SIM_RECORD=legacy').toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { journey: Sample[]; rescue: Sample[] };
    // The scenarios still cover what they claim: three meals in the journey, at least one rescue in the push.
    expect(golden.journey.at(-1)!.bites).toBe(3);
    expect(golden.rescue.at(-1)!.rescues).toBeGreaterThan(0);
    expect(runAll(runSim)).toEqual(golden);
  }, 60_000);
});
