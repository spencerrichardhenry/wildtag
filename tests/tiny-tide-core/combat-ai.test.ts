// tests/tiny-tide-core/combat-ai.test.ts — spec §11.2 with seeded fixtures: the shipped behaviours, a scripted player, and an attack that keeps
// the entity busy for its windup + active + recovery once the AI's request is started.
import { describe, expect, it } from 'vitest';
import { aiRefused, aiStarted, aiStep, alphaPhase, chooseAttack, clampToDisc, newAiState, schoolFlee, ROAR_SECONDS, type AiInput, type AiOutput, type AiState } from '../../src/tiny-tide/combat-ai';
import { BEHAVIOURS, SPECIES_ATTACKS, type SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
import type { Vec3 } from '../../src/tiny-tide/combat-types';

const DT = 1 / 30;
const base = (over: Partial<AiInput> = {}): AiInput => ({ now: 0, self: { position: { x: 0, y: 0, z: 0 }, L: 1.4, forward: { x: 0, y: 0, z: 1 }, hp: 10, maxHp: 10, staggered: false, held: false, busy: false, speed: 3 },
  player: { position: { x: 0, y: 0, z: 10 }, d: 6, visible: true, targetable: true }, hostile: true, pursuit: 'calm', hit: false, fleeDistance: 7, ready: () => true, ...over });
/** Runs `seconds` of AI ticks; `input(t, s)` gives each tick's input. A requested attack is started (or refused by `refuse`) and keeps the
 *  entity busy for its timeline. Returns the states, outputs and attack ids by tick. */
function drive(b: SpeciesBehaviour, s: AiState, seconds: number, input: (t: number, s: AiState) => Partial<AiInput>, refuse: (t: number) => boolean = () => false, t0 = 0) {
  const log: { t: number; state: string; out: AiOutput }[] = [];
  let busyUntil = -1;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = t0 + k * DT, i = base({ now: t, ...input(t, s) }), o = aiStep(b, s, { ...i, self: { ...i.self, busy: t < busyUntil } });
    if (o.attack) {
      if (refuse(t)) aiRefused(s, t);
      else { aiStarted(s, t); const a = SPECIES_ATTACKS[o.attack.attackId]!; busyUntil = t + a.windupSeconds + a.activeSeconds + a.recoverySeconds; }
    }
    log.push({ t, state: s.name, out: o });
  }
  return log;
}
const firstT = (log: { t: number; state: string }[], state: string) => log.find(l => l.state === state)?.t;
const at = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

describe('combat AI: prey', () => {
  it('drifter flees, tires, rests', () => {
    const s = newAiState(1, 1), log = drive(BEHAVIOURS.drifter!, s, 5, t => ({ player: { position: at(0, t < 3 ? 5 : 50), d: 3, visible: true, targetable: true } }));
    expect(firstT(log, 'flee')).toBeCloseTo(.2, 1);   // reaction .2 s
    expect(firstT(log, 'rest')).toBeCloseTo(2.2, 1);   // flee 2.0 s
    expect(log.find(l => l.state === 'flee')!.out.intent).toMatchObject({ kind: 'away', speedFactor: 1.3 });
    expect(log.find(l => l.state === 'rest')!.out.intent).toEqual({ kind: 'ambient', speedFactor: .35 });
    expect(log.filter(l => l.t > 2.2 && l.t < 3.4).every(l => l.state === 'rest')).toBe(true);   // tired: no flee while resting 1.2 s
    expect(log.at(-1)!.state).toBe('idle');
  });
  it('sardine school flees together in one direction', () => {
    const mk = (id: number, x: number) => ({ state: newAiState(1, id), position: at(x, 0), L: 1 }), school = [mk(1, 0), mk(2, 2), mk(3, 4), mk(4, 30)];
    const player = at(-3, 0);
    // Only the first member is near the player; it flees after its reaction; the others within 6 L join on the same tick.
    let t = 0;
    for (; t < 1 && school[0]!.state.name !== 'flee'; t += DT) {
      for (const m of school) aiStep(BEHAVIOURS.sardine!, m.state, base({ now: t, self: { ...base().self, position: m.position }, player: { position: player, d: 1, visible: true, targetable: true }, fleeDistance: m === school[0] ? 7 : 1 }));
      schoolFlee(school, player, 6, t);
    }
    expect(school.slice(0, 3).map(m => m.state.name)).toEqual(['flee', 'flee', 'flee']); expect(school[3]!.state.name).toBe('idle');
    const dirs = school.slice(0, 3).map(m => m.state.fleeDir!);
    expect(dirs[1]).toEqual(dirs[0]); expect(dirs[2]).toEqual(dirs[0]); expect(dirs[0]!.x).toBeCloseTo(1);   // away from the player, from the centroid
  });
  it('snail retaliates when hit and when cornered', () => {
    const hit = newAiState(1, 2), logHit = drive(BEHAVIOURS['spiny-snail']!, hit, 3, t => ({ hit: t < DT, player: { position: at(0, 1), d: .8, visible: true, targetable: true } }));
    expect(logHit[0]!.state).toBe('face'); expect(logHit.find(l => l.out.attack)!.t).toBeCloseTo(.2, 1);   // faces .2 s, then pokes
    expect(firstT(logHit, 'back-off')).toBeGreaterThan(.5 + .12 + .8 - .05);   // after the poke's windup + active + recovery
    const cornered = newAiState(1, 3), logC = drive(BEHAVIOURS['spiny-snail']!, cornered, 2, () => ({ player: { position: at(0, 1), d: 1.1, visible: true, targetable: true } }));
    expect(firstT(logC, 'face')).toBeCloseTo(1, 1);   // within 1.2 L for 1.0 s
    const far = newAiState(1, 4); drive(BEHAVIOURS['spiny-snail']!, far, 2, () => ({ player: { position: at(0, 5), d: 3, visible: true, targetable: true } }));
    expect(far.name).toBe('idle');
  });
  it('puffer bursts then backs off', () => {
    const s = newAiState(1, 5), log = drive(BEHAVIOURS.puffer!, s, 2.5, t => ({ hit: t < DT, player: { position: at(0, 1), d: 1, visible: true, targetable: true } }));
    const burst = log.find(l => l.out.attack)!; expect(burst.out.attack!.attackId).toBe('puffer-burst');
    const back = log.find(l => l.state === 'back-off')!; expect(back.out.intent).toMatchObject({ kind: 'away', speedFactor: .5 });
    expect(back.t).toBeCloseTo(burst.t + .55 + .15 + 1.2, 1);
    // It stays within .5 L of where the fight started.
    const leashed = aiStep(BEHAVIOURS.puffer!, s, base({ now: back.t + .1, self: { ...base().self, position: at(0, -1) }, player: { position: at(0, 1), d: 1, visible: true, targetable: true } }));
    expect(leashed.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
  });
});

describe('combat AI: hunters', () => {
  it('crab notice delay, approach, band choice, flank weight, gap, reposition', () => {
    const s = newAiState(1, 6), log = drive(BEHAVIOURS.crab!, s, 6, t => ({ pursuit: 'hunt', player: { position: at(0, 1), d: t < 1 ? 2 : .3, visible: true, targetable: true } }));
    expect(log[0]!.out.marker).toBe(true); expect(firstT(log, 'approach')).toBeCloseTo(.35, 1);   // reaction .35 s
    const first = log.find(l => l.out.attack)!;
    expect(first.t).toBeGreaterThanOrEqual(1 - 1e-9);   // d 2 fits no band; at d .3 the pinch or the sweep fits
    expect(['crab-pinch', 'crab-sweep']).toContain(first.out.attack!.attackId);
    const firstEnd = first.t + .5 + .1 + .55 + (first.out.attack!.attackId === 'crab-sweep' ? .05 + .04 + .15 : 0);
    const repo = log.find(l => l.state === 'reposition' && l.t > first.t)!; expect(repo.t).toBeGreaterThan(firstEnd - .2);
    expect(repo.out.intent).toMatchObject({ kind: 'toward', speedFactor: .6 });
    const second = log.find(l => l.out.attack && l.t > first.t)!;
    expect(second.t - repo.t).toBeGreaterThanOrEqual(.6 - 1e-6);   // reposition .6–1.2 s and the 1 s gap
    // Band and flank weights at d .3 (the lunge's band starts at .5): in front pinch 3 : sweep 1; flanked, the sweep's flankWeight 3 replaces its 1.
    const rng = (() => { let k = 0; return () => (k++ % 10) / 10 + .05; })();
    const front = Array.from({ length: 10 }, () => chooseAttack(BEHAVIOURS.crab!.attacks, .3, false, () => true, rng)!.attackId), back = Array.from({ length: 10 }, () => chooseAttack(BEHAVIOURS.crab!.attacks, .3, true, () => true, rng)!.attackId);
    expect(front.filter(a => a === 'crab-pinch').length).toBeGreaterThan(front.filter(a => a === 'crab-sweep').length);
    expect(back.filter(a => a === 'crab-sweep').length).toBeGreaterThan(front.filter(a => a === 'crab-sweep').length);   // 5 of 10 against 3 of 10
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, 1, false, () => true, () => .5)!.attackId).toBe('crab-lunge');
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, 2, false, () => true, () => .5)).toBeNull();
  });
  it('a refused token retries after .2 s', () => {
    const s = newAiState(1, 7), log = drive(BEHAVIOURS.crab!, s, 2, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: .3, visible: true, targetable: true } }), t => t < 1);
    const asks = log.filter(l => l.out.attack).map(l => l.t);
    expect(asks[1]! - asks[0]!).toBeCloseTo(.2, 1);
  });
  it('a token refusal repositions and waits for the director retry time (controller binding)', () => {
    // The director answered 'token' with tokenRetryAt 1.0: the crab strafes (its reposition data) and asks again only at or after 1.0.
    const s = newAiState(1, 13), i = base({ now: 0, pursuit: 'hunt', player: { position: at(0, 1), d: .3, visible: true, targetable: true } });
    aiStep(BEHAVIOURS.crab!, s, i); aiStep(BEHAVIOURS.crab!, s, { ...i, now: .4 });
    const o = aiStep(BEHAVIOURS.crab!, s, { ...i, now: .5 }); expect(o.attack).not.toBeNull();
    aiRefused(s, .5, 1.0);
    const log = drive(BEHAVIOURS.crab!, s, 1, () => ({ pursuit: 'hunt', tokenRetryAt: 1.0, player: { position: at(0, 1), d: .3, visible: true, targetable: true } }), () => false, .5 + DT);
    const before = log.filter(l => l.t < 1 - 1e-9);
    expect(before.every(l => !l.out.attack)).toBe(true);
    expect(before.every(l => l.state === 'reposition')).toBe(true);
    expect(before[0]!.out.intent).toMatchObject({ kind: 'toward', speedFactor: BEHAVIOURS.crab!.repositionSpeedFactor });
    expect(before[0]!.out.intent).not.toMatchObject({ point: at(0, 1) });
    expect(log.find(l => l.out.attack)!.t).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('crab gives up by pursuit rules and heals', () => {
    // The pursuit mode is the ecosystem's (memory, leash, give-up); the AI follows it and reports the engagement (the caller heals at calm).
    const s = newAiState(1, 8);
    drive(BEHAVIOURS.crab!, s, 1, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: 3, visible: true, targetable: true } }));
    const o = aiStep(BEHAVIOURS.crab!, s, base({ now: 5, pursuit: 'return' }));
    expect(s.name).toBe('return'); expect(o.engagementEnded).toMatchObject({ windups: 0 }); expect(o.engagementEnded!.seconds).toBeCloseTo(5);
    aiStep(BEHAVIOURS.crab!, s, base({ now: 6, pursuit: 'calm' })); expect(s.name).toBe('idle');
  });
  it('eel waits in den, ambushes, retreats', () => {
    const s = newAiState(1, 9);
    const log = drive(BEHAVIOURS.eel!, s, 12, t => ({ self: { ...base().self, position: t < 7 ? at(0, 0) : at(0, 5) }, pursuit: 'hunt',
      player: { position: t < 1 ? at(0, 10) : t < 6 ? at(0, 1) : at(0, 40), d: t < 1 ? 7 : t < 6 ? .3 : 30, visible: true, targetable: true } }));
    expect(log[0]!.state).toBe('den'); expect(log.filter(l => l.t < 1).every(l => !l.out.attack)).toBe(true);
    const ambush = log.find(l => l.out.attack)!; expect(ambush.out.attack!.attackId).toBe('eel-ambush'); expect(ambush.t).toBeCloseTo(1, 1);   // reaction 0 in the den
    expect(log.find(l => l.state === 'retreat')).toBeTruthy();
    expect(log.find(l => l.state === 'retreat')!.out.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
  });
});

describe('combat AI: alphas', () => {
  const mother = BEHAVIOURS.clawmother!, L = 10.08;
  const alphaInput = (hp: number, over: Partial<AiInput> = {}) => ({ self: { ...base().self, L, hp, maxHp: 80 }, inLair: true, pursuit: 'hunt' as const, player: { position: at(0, 5), d: .3, visible: true, targetable: true }, ...over });
  it('alpha phases switch at thresholds with a roar', () => {
    expect([80, 49, 48.1, 48, 25, 24, 1].map(hp => alphaPhase(mother.phases!, hp, 80))).toEqual([0, 0, 0, 1, 1, 2, 2]);   // above 60 %, above 30 %
    const s = newAiState(1, 10); s.home = at(0, 0);
    drive(mother, s, 1, () => alphaInput(80));
    const o = aiStep(mother, s, base({ now: 2, ...alphaInput(40) }));
    expect(o.roar).toBe(true); expect(s.name).toBe('roar'); expect(s.phase).toBe(1);
    expect(aiStep(mother, s, base({ now: 2 + ROAR_SECONDS - .05, ...alphaInput(40) })).attack).toBeNull();   // no action while roaring
    const burrow = drive(mother, s, 3, () => alphaInput(40), () => false, 2 + ROAR_SECONDS);
    expect(burrow.some(l => l.out.untargetable)).toBe(true);
    expect(burrow.find(l => l.out.attack)!.out.attack!.attackId).toBe('mother-emerge');
    expect(burrow.find(l => l.out.attack)!.t - (2 + ROAR_SECONDS)).toBeGreaterThanOrEqual(.4 + 1.2 - .05);   // sink .4 s, travel 1.2 s
  });
  it('alpha stays in the lair disc', () => {
    const s = newAiState(1, 11); s.home = at(0, 0);
    const log = drive(mother, s, 3, () => alphaInput(80, { player: { position: at(0, 60), d: 4, visible: true, targetable: true } }));
    for (const l of log) if (l.out.intent.kind === 'toward') expect(Math.hypot(l.out.intent.point.x, l.out.intent.point.z)).toBeLessThanOrEqual(2.5 * L + 1e-6);
    expect(clampToDisc(at(30, 40), at(0, 0), 10)).toEqual({ x: 6, y: 0, z: 8 });
  });
  it('alpha resets slowly outside 1.5 × lair', () => {
    const s = newAiState(1, 12); s.home = at(0, 0); const far = { position: at(0, 1.6 * 2.5 * L), d: 30, visible: true, targetable: true };
    drive(mother, s, 1, () => alphaInput(80));
    const log = drive(mother, s, 4, () => alphaInput(50, { player: far, inLair: false }), () => false, 1);
    expect(firstT(log, 'reset')).toBeCloseTo(4, 1);   // 3 s outside
    expect(log.find(l => l.state === 'reset')!.out).toMatchObject({ heal: .04, intent: { kind: 'toward', point: { x: 0, y: 0, z: 0 } } });
    aiStep(mother, s, base({ now: 9, ...alphaInput(80, { player: far, inLair: false }) })); expect(s.name).toBe('idle'); expect(s.phase).toBe(0);   // full HP: phase 1
  });
});
