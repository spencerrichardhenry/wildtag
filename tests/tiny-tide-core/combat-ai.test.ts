// tests/tiny-tide-core/combat-ai.test.ts — spec §11.2 with seeded fixtures: the shipped behaviours, a scripted player, and an attack that keeps
// the entity busy for its windup + active + recovery once the AI's request is started.
import { describe, expect, it } from 'vitest';
import { aiLandedHit, aiRefused, BAND_MARGIN, aiStarted, aiStep, alphaPhase, chooseAttack, clampToDisc, newAiState, schoolFlee, ROAR_SECONDS, type AiInput, type AiOutput, type AiState } from '../../src/tiny-tide/combat-ai';
import { BEHAVIOURS, hostileSizes, LAPS, SPECIES_ATTACKS, type SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
import { SPECIES } from '../../src/tiny-tide/species';
import type { Vec3 } from '../../src/tiny-tide/combat-types';
import { Ecosystem, lairOf, speciesActor } from '../../src/tiny-tide/ecosystem';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
import { PLANS } from '../../src/tiny-tide/plans';
import { starterFor } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { startAnchor } from '../../src/tiny-tide/motion';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';

const DT = 1 / 30;
const base = (over: Partial<AiInput> = {}): AiInput => ({ now: 0, self: { position: { x: 0, y: 0, z: 0 }, L: 1.4, forward: { x: 0, y: 0, z: 1 }, hp: 10, maxHp: 10, staggered: false, held: false, busy: false, speed: 3 },
  player: { position: { x: 0, y: 0, z: 10 }, d: 6, visible: true, targetable: true }, hostile: true, pursuit: 'calm', hit: false, fleeDistance: 7, ready: () => true, ...over });
/** Runs `seconds` of AI ticks; `input(t, s)` gives each tick's input. A requested attack is started (or refused by `refuse`) and keeps the
 *  entity busy for its timeline. Returns the states, outputs and attack ids by tick. */
function drive(b: SpeciesBehaviour, s: AiState, seconds: number, input: (t: number, s: AiState) => Partial<AiInput>, refuse: (t: number, attackId: string) => boolean = () => false, t0 = 0) {
  const log: { t: number; state: string; out: AiOutput }[] = [];
  let busyUntil = -1;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = t0 + k * DT, i = base({ now: t, ...input(t, s) }), o = aiStep(b, s, { ...i, self: { ...i.self, busy: t < busyUntil } });
    if (o.attack) {
      if (refuse(t, o.attack.attackId)) aiRefused(s, t);
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
    const mk = (id: number, x: number, z: number) => ({ state: newAiState(1, id), position: at(x, z), L: 1 }), school = [mk(1, 0, 0), mk(2, 1, 1.5), mk(3, 2, -1), mk(4, 30, 0)];
    const player = at(-3, 0);
    // Only the first member is near the player; it flees after its reaction; the others within 6 L join on the same tick.
    let t = 0;
    for (; t < 1 && school[0]!.state.name !== 'flee'; t += DT) {
      for (const m of school) aiStep(BEHAVIOURS.sardine!, m.state, base({ now: t, self: { ...base().self, position: m.position }, player: { position: player, d: 1, visible: true, targetable: true }, fleeDistance: m === school[0] ? 7 : 1 }));
      schoolFlee(school, player, 6, t);
    }
    expect(school.slice(0, 3).map(m => m.state.name)).toEqual(['flee', 'flee', 'flee']); expect(school[3]!.state.name).toBe('idle');
    const dirs = school.slice(0, 3).map(m => m.state.fleeDir!);
    expect(dirs[1]).toEqual(dirs[0]); expect(dirs[2]).toEqual(dirs[0]);
    // Away from the player, from the centroid (1, 1/6) of the three: not from the starter (that gives (1, 0)).
    expect(dirs[0]!.x).toBeCloseTo(4 / Math.hypot(4, 1 / 6), 6); expect(dirs[0]!.z).toBeCloseTo((1 / 6) / Math.hypot(4, 1 / 6), 6);
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
  it('the puffer backs off horizontally from a ground mover (T18 review M2: it must not rise out of a crawler\'s reach)', () => {
    for (const ground of [true, false]) {
      const s = newAiState(1, 5), below = at(0, 1, -3), log = drive(BEHAVIOURS.puffer!, s, 2.5, t => ({ hit: t < DT, player: { position: below, d: 1, visible: true, targetable: true, ground } }));
      const back = log.filter(l => l.state === 'back-off').map(l => l.out.intent);
      expect(back.length).toBeGreaterThan(0);
      for (const it of back) {
        expect(it.kind).toBe('away');
        if (it.kind === 'away') { if (ground) expect(it.point.y).toBeCloseTo(0, 9); else expect(it.point.y).toBe(-3); }   // level with the puffer (self y 0)
      }
    }
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
  // Controller binding: a token refusal or a pending tokenRetryAt makes the hunter strafe (its reposition data) and ask only at or after 1.0.
  const crabAt = (over: Partial<AiInput> = {}) => ({ pursuit: 'hunt' as const, player: { position: at(0, 1), d: .3, visible: true, targetable: true }, ...over });
  const firstAsk = (s: AiState) => { for (const t of [0, .4]) aiStep(BEHAVIOURS.crab!, s, base({ now: t, ...crabAt() })); const o = aiStep(BEHAVIOURS.crab!, s, base({ now: .5, ...crabAt() })); expect(o.attack).not.toBeNull(); };
  const expectStrafeUntil = (log: { t: number; state: string; out: AiOutput }[], retry: number) => {
    const before = log.filter(l => l.t < retry - 1e-9);
    expect(before.length).toBeGreaterThan(5);
    expect(before.every(l => !l.out.attack && l.state === 'reposition')).toBe(true);
    for (const l of before) { expect(l.out.intent).toMatchObject({ kind: 'toward', speedFactor: BEHAVIOURS.crab!.repositionSpeedFactor }); expect(l.out.intent).not.toMatchObject({ point: at(0, 1) }); }
    expect(log.find(l => l.out.attack)!.t).toBeGreaterThanOrEqual(retry - 1e-9);
  };
  it('a token refusal with the director retry time repositions until then (aiRefused 3rd argument, no tokenRetryAt input)', () => {
    const s = newAiState(1, 13); firstAsk(s); aiRefused(s, .5, 1.0); expect(s.name).toBe('reposition');
    // Even with the player out of every band (it backed off), the refused crab strafes instead of chasing.
    expect(aiStep(BEHAVIOURS.crab!, s, base({ now: .5 + DT / 2, ...crabAt({ player: { position: at(0, 3), d: 1.6, visible: true, targetable: true } }) })).intent).toMatchObject({ kind: 'toward', speedFactor: BEHAVIOURS.crab!.repositionSpeedFactor });
    expectStrafeUntil(drive(BEHAVIOURS.crab!, s, 1, () => crabAt(), () => false, .5 + DT), 1.0);
  });
  it('a pending tokenRetryAt in the input repositions until then (aiRefused without the 3rd argument)', () => {
    const s = newAiState(1, 13); firstAsk(s); aiRefused(s, .5);
    expectStrafeUntil(drive(BEHAVIOURS.crab!, s, 1, () => crabAt({ tokenRetryAt: 1.0 }), () => false, .5 + DT), 1.0);
  });
  it('the gap after an action', () => {
    // No reposition time, so only the 1 s gap holds the next ask back.
    const crab = { ...BEHAVIOURS.crab!, repositionSeconds: [0, 0] as const }, s = newAiState(1, 6), log = drive(crab, s, 6, () => crabAt());
    const asks = log.filter(l => l.out.attack), a = SPECIES_ATTACKS[asks[0]!.out.attack!.attackId]!, end = asks[0]!.t + a.windupSeconds + a.activeSeconds + a.recoverySeconds;
    expect(asks[1]!.t).toBeGreaterThanOrEqual(end + crab.gapSeconds - 1e-6); expect(asks[1]!.t).toBeLessThan(end + crab.gapSeconds + 2 * DT);
  });
  it('held and staggered: hold, no attack', () => {
    for (const k of ['held', 'staggered'] as const) {
      const s = newAiState(1, 14); for (const t of [0, .4]) aiStep(BEHAVIOURS.crab!, s, base({ now: t, ...crabAt() }));
      const o = aiStep(BEHAVIOURS.crab!, s, base({ now: .5, ...crabAt(), self: { ...base().self, [k]: true } }));
      expect(o.intent).toEqual({ kind: 'hold' }); expect(o.attack).toBeNull();
      if (k === 'held') expect(s.name).toBe('held');
    }
  });
  it('same seed and entity: same choices; another entity id: other choices', () => {
    const run = (seed: number, id: number) => drive(BEHAVIOURS.crab!, newAiState(seed, id), 30, () => crabAt()).filter(l => l.out.attack).map(l => `${l.t.toFixed(3)} ${l.out.attack!.attackId}`);
    expect(run(1, 6)).toEqual(run(1, 6)); expect(run(1, 7)).not.toEqual(run(1, 6)); expect(run(2, 6)).not.toEqual(run(1, 6));
  });
  it('a crab at d = 0 attacks and does not strafe out (T18 review M1: a band from 0 needs no back-off)', () => {
    const s = newAiState(1, 8), log = drive(BEHAVIOURS.crab!, s, 2, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: 0, visible: true, targetable: true } }));
    expect(log.some(l => l.out.attack)).toBe(true);
    expect(log.filter(l => l.state === 'approach' && !l.out.attack).every(l => l.out.intent.kind === 'toward' && Math.hypot(l.out.intent.point.x, l.out.intent.point.z - 1) < 1e-9)).toBe(true);   // chases the player
  });
  it('a hunter whose bands all start above 0 (the squid) backs out of a player inside its smallest band, then attacks (T18 live look)', () => {
    // Live look: a squid on top of a still Speck (d = 0) chased into it for minutes without an attack (every squid band starts at .2 L or more).
    const s = newAiState(1, 7), L = 22.4, me = at(0, 0), p = at(0, 2), d = (q: Vec3) => Math.max(0, Math.hypot(q.x - p.x, q.z - p.z) - .3 * L) / L;
    const one = (pos: Vec3, t: number) => aiStep(BEHAVIOURS.squid!, s, base({ now: t, pursuit: 'hunt', self: { ...base().self, position: pos, L }, player: { position: p, d: d(pos), visible: true, targetable: true } }));
    one(me, 0); one(me, .5);   // notice, then approach
    const o = one(me, .6);
    expect(o.attack).toBeFalsy();
    expect(o.intent.kind).toBe('toward');
    // Away from the player, to the nearest band's lower bound (squid-grab .2 L) + BAND_MARGIN: the gap there is (.2 + .1) L.
    if (o.intent.kind === 'toward') expect(Math.hypot(o.intent.point.x - p.x, o.intent.point.z - p.z)).toBeCloseTo(Math.hypot(me.x - p.x, me.z - p.z) + (.2 + BAND_MARGIN) * L, 6);
    // In the band again it attacks.
    const far = at(0, 2 - (.3 + .5) * L);
    let attacked = false; for (let t = .7; t < 3 && !attacked; t += DT) attacked = !!one(far, t).attack;
    expect(attacked).toBe(true);
  });
  it('chooseAttack refuses a choice below its band', () => {
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, .47, false, () => true, () => .01)!.attackId).toBe('crab-sweep');   // the lunge starts at .5
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, .3, false, id => id !== 'crab-pinch', () => .01)!.attackId).toBe('crab-sweep');   // not ready
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

describe('combat AI: ambusher rules', () => {
  const eelOut = (s: AiState) => { s.home = at(0, 0); aiStep(BEHAVIOURS.eel!, s, base({ now: 0, pursuit: 'hunt', player: { position: at(0, 1), d: .3, visible: true, targetable: true } })); aiStarted(s, 0); aiStep(BEHAVIOURS.eel!, s, base({ now: 1, pursuit: 'hunt', self: { ...base().self, position: at(0, 3) } })); expect(s.name).toBe('out'); };
  it('the eel out of its den follows the pursuit policy (return or calm: retreat)', () => {
    for (const pursuit of ['return', 'calm'] as const) {
      const s = newAiState(1, 20); eelOut(s);
      const o = aiStep(BEHAVIOURS.eel!, s, base({ now: 1.5, pursuit, self: { ...base().self, position: at(0, 3) }, player: { position: at(0, 4), d: .3, visible: true, targetable: true } }));
      expect(s.name).toBe('retreat'); expect(o.attack).toBeNull(); expect(o.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
    }
  });
  it('the den does not trigger on a player it cannot see', () => {
    const s = newAiState(1, 21), log = drive(BEHAVIOURS.eel!, s, 2, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: .3, visible: false, targetable: true } }));
    expect(log.every(l => !l.out.attack && l.state === 'den')).toBe(true);
  });
  it('a landed hit keeps the eel out longer', () => {
    const s = newAiState(1, 22); eelOut(s); expect(s.outUntil).toBeCloseTo(5);
    aiLandedHit(BEHAVIOURS.eel!, s, 3); expect(s.outUntil).toBeCloseTo(7);
    aiLandedHit(BEHAVIOURS.eel!, s, 1); expect(s.outUntil).toBeCloseTo(7);   // never shortens
    const far = { pursuit: 'hunt' as const, self: { ...base().self, position: at(0, 3) }, player: { position: at(0, 40), d: 30, visible: true, targetable: true } };
    aiStep(BEHAVIOURS.eel!, s, base({ now: 6, ...far })); expect(s.name).not.toBe('retreat');
    aiStep(BEHAVIOURS.eel!, s, base({ now: 7.1, ...far })); expect(s.name).toBe('retreat');
    const crab = newAiState(1, 23); aiLandedHit(BEHAVIOURS.crab!, crab, 3); expect(crab.outUntil).toBe(0);
  });
});

describe('combat AI: alphas', () => {
  const mother = BEHAVIOURS.clawmother!, L = 10.08;
  it('the burrow loop stops at a player that can not be attacked (no emerge at a fainted player), as the idle branch does', () => {
    for (const over of [{ hostile: false }, { player: { position: at(0, 5), d: .3, visible: true, targetable: false } }]) {
      const s = newAiState(1, 40); s.home = at(0, 0); s.phase = 1; s.name = 'burrowed'; s.since = 0;
      const log = drive(mother, s, 4, () => ({ ...alphaInput(40), ...over }));
      expect(log.filter(l => l.out.attack)).toEqual([]);
      expect(log.some(l => l.state === 'sink')).toBe(false);   // no new sink either
    }
    const s = newAiState(1, 41); s.home = at(0, 0); s.phase = 1; s.name = 'burrowed'; s.since = 0;
    expect(drive(mother, s, 4, () => alphaInput(40)).some(l => l.out.attack?.attackId === 'mother-emerge')).toBe(true);   // control
  });
  it('alpha absent when its part is unlocked or at another size', () => {
    const eco = new Ecosystem(3), mother = eco.entities.find(e => e.spec.key === '1:clawmother')!, far = { x: 0, y: 900, z: 0 };
    const step = (stage: number, now: number, unlocked: string[] = []) => eco.step({ stage, dt: DT, now, player: far, playerHull: [], perceivable: false, stealthFactor: 1, unlocked });
    const lair = lairOf(3, mother);
    step(0, 0); expect(mother.eaten).toBe(false); expect(Math.hypot(mother.x - lair.x, mother.z - lair.z)).toBeLessThanOrEqual(4 * L);   // installed within 4 L
    step(1, .1); expect(mother.eaten).toBe(true); expect(mother.active).toBe(false);   // only at its own size
    step(0, .2); expect(mother.eaten).toBe(false); expect(mother.hp).toBe(80);
    step(0, .3, ['claw_mother']); expect(mother.eaten).toBe(true);   // defeated earlier: gone for the run
    step(0, 60, ['claw_mother']); expect(mother.eaten).toBe(true);
    eco.consume(mother); expect(mother.respawn).toBe(-1);   // never respawns
  });
  it('an alpha has no ecosystem pursuit: no acquisition, no give-up heal (its lair is its leash)', () => {
    const eco = new Ecosystem(4), mother = eco.entities.find(e => e.spec.key === '1:clawmother')!;
    const near = { x: mother.x + 8, y: mother.y, z: mother.z }, step = (now: number, player: Vec3) => eco.step({ stage: 0, dt: DT, now, player, playerHull: [], perceivable: true, stealthFactor: 1, unlocked: [] });
    for (let k = 0; k < 10; k++) step(k * DT, near);
    expect(mother.mode).toBe('calm');   // a crab would hunt this player
    mother.mode = 'angry'; mother.hp = 30; mother.x = mother.hx + 200; mother.combat = null;
    for (let k = 0; k < 10; k++) step(1 + k * DT, { x: 0, y: 900, z: 0 });
    expect(mother.mode).toBe('angry'); expect(mother.hp).toBe(30);   // no leash give-up, no return, no full heal
  });
  it('the lair (review R15): radius at most .25 x the play half-size, the start anchor outside 1.5 x the lair radius + 5 player body lengths', () => {
    const size = SIZES[0], plans = PLANS.filter(p => p.size === 0);
    for (let seed = 1; seed <= 20; seed++) {
      const eco = new Ecosystem(seed), e = eco.entities.find(x => x.spec.key === '1:clawmother')!, lair = lairOf(seed, e);
      const radius = mother.lair!.radiusBodyLengths * speciesActor(e).bodyLength;
      expect(radius).toBeLessThanOrEqual(.25 * PLAYER_HALF * size);
      expect(Math.max(Math.abs(lair.x), Math.abs(lair.z)) + radius).toBeLessThanOrEqual(.8 * PLAYER_HALF * size);   // the lair is inside the spawn square
      for (const p of plans) for (const growth of [1, 1.38]) {
        const actor = playerActor(p, starterFor(p), 0, growth), anchor = startAnchor(actor, 0, { queries: stageWorldQueries(0, seed), bounds: stageBounds(0) });
        if (!anchor.ok) throw new Error(`seed ${seed} ${p.id}: no start anchor`);
        expect(Math.hypot(anchor.position.x - lair.x, anchor.position.z - lair.z), `seed ${seed} ${p.id} growth ${growth}`).toBeGreaterThan(1.5 * radius + 5 * actor.bodyLength);
      }
      const installed = { x: e.x, z: e.z }; expect(Math.hypot(installed.x - lair.x, installed.z - lair.z)).toBeLessThanOrEqual(4 * speciesActor(e).bodyLength);
    }
  });

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
  it('the roar holds still; the caller cancels a busy action', () => {
    const s = newAiState(1, 30); s.home = at(0, 0); drive(mother, s, 1, () => alphaInput(80));
    const o = aiStep(mother, s, base({ now: 2, ...alphaInput(40) })); expect(o.intent).toEqual({ kind: 'hold' }); expect(o.attack).toBeNull();
  });
  it('the Clawmother (phase 1) at d = 0 attacks and does not strafe out (T18 review M1)', () => {
    const s = newAiState(1, 32); s.home = at(0, 0);
    const log = drive(mother, s, 3, () => alphaInput(80, { player: { position: at(0, 1), d: 0, visible: true, targetable: true } }));
    expect(s.phase).toBe(0); expect(log.some(l => l.out.attack)).toBe(true);
    expect(log.filter(l => l.state === 'approach' && !l.out.attack).every(l => l.out.intent.kind === 'toward' && Math.hypot(l.out.intent.point.x, l.out.intent.point.z - 1) < 1e-9)).toBe(true);
  });
  it('the alpha does not notice a player outside its lair', () => {
    const s = newAiState(1, 31); s.home = at(0, 0);
    const log = drive(mother, s, 2, () => alphaInput(80, { inLair: false }));
    expect(log.every(l => l.state === 'idle' && !l.out.marker && !l.out.attack)).toBe(true);
    expect(log[0]!.out.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
  });
  it('the pinch combo chains with its gap', () => {
    const s = newAiState(1, 32); s.home = at(0, 0);
    const asks = drive(mother, s, 4, () => alphaInput(80)).filter(l => l.out.attack);
    expect(asks.slice(0, 2).map(l => l.out.attack!.attackId)).toEqual(['mother-pinch', 'mother-pinch-2']);
    const a = SPECIES_ATTACKS['mother-pinch']!, end = asks[0]!.t + a.windupSeconds + a.activeSeconds + a.recoverySeconds;
    expect(asks[1]!.t - end).toBeGreaterThanOrEqual(.2 - 1e-6); expect(asks[1]!.t - end).toBeLessThan(.2 + 2 * DT);
  });
  it('a refused chain is dropped after 1 s', () => {
    const s = newAiState(1, 33); s.home = at(0, 0);
    const log = drive(mother, s, 5, () => alphaInput(80), (_t, id) => id === 'mother-pinch-2');
    const asks = log.filter(l => l.out.attack), firstChain = asks.find(l => l.out.attack!.attackId === 'mother-pinch-2')!;
    expect(asks.filter(l => l.out.attack!.attackId === 'mother-pinch-2' && l.t > firstChain.t + 1 + 1e-6 && l.t < firstChain.t + 1.5)).toEqual([]);
    expect(log.find(l => l.t > firstChain.t + 1 + 1e-6)!.state).toBe('reposition');
  });
  it('the burrow: two emerges, then the pinch combo', () => {
    const s = newAiState(1, 34); s.home = at(0, 0);
    const asks = drive(mother, s, 14, () => alphaInput(40)).filter(l => l.out.attack).map(l => l.out.attack!.attackId);
    expect(asks.slice(0, 4)).toEqual(['mother-emerge', 'mother-emerge', 'mother-pinch', 'mother-pinch-2']);
  });
  it('a refused combo pinch in the burrow phase is asked again, not dropped', () => {
    const s = newAiState(1, 35); s.home = at(0, 0); let refused = false;
    const asks = drive(mother, s, 14, () => alphaInput(40), (_t, id) => { if (!refused && id === 'mother-pinch') { refused = true; return true; } return false; }).filter(l => l.out.attack).map(l => l.out.attack!.attackId);
    expect(refused).toBe(true);
    expect(asks.slice(0, 4)).toEqual(['mother-emerge', 'mother-emerge', 'mother-pinch', 'mother-pinch']);
  });
  it('a refused emerge does not stay under the sand', () => {
    const s = newAiState(1, 36); s.home = at(0, 0);
    const log = drive(mother, s, 6, () => alphaInput(40), () => true);
    const ask = log.find(l => l.out.attack)!;
    expect(log.filter(l => l.t > ask.t + 1 + DT && l.t < ask.t + 1.2).some(l => !l.out.untargetable)).toBe(true);
  });
  const tyrant = BEHAVIOURS['reef-tyrant']!, TL = 10;
  const tyrantInput = (hp: number, over: Partial<AiInput> = {}) => ({ self: { ...base().self, L: TL, hp, maxHp: 80, speed: 30, position: at(0, 17.6) }, inLair: true, pursuit: 'hunt' as const, player: { position: at(0, 5), d: .3, visible: true, targetable: true }, ...over });
  it('the Tyrant phase 1 keeps within lairFraction of its lair', () => {
    const s = newAiState(1, 37); s.home = at(0, 0);
    const log = drive(tyrant, s, 2.5, () => tyrantInput(80, { player: { position: at(0, 40), d: 4, visible: true, targetable: true } }));
    const r = .6 * tyrant.lair!.radiusBodyLengths * TL, pts = log.flatMap(l => l.out.intent.kind === 'toward' ? [Math.hypot(l.out.intent.point.x, l.out.intent.point.z)] : []);
    expect(pts.length).toBeGreaterThan(0); for (const h of pts) expect(h).toBeLessThanOrEqual(r + 1e-6);
    expect(Math.max(...pts)).toBeCloseTo(r, 3);
  });
  it('the Tyrant laps: a charge every half lap, two charges, then a 1.5 s rest', () => {
    const s = newAiState(1, 38); s.home = at(0, 0);
    const log = drive(tyrant, s, 12, () => tyrantInput(40));
    const r = .8 * tyrant.lair!.radiusBodyLengths * TL, half = Math.PI * r / (30 * 1.4), a = SPECIES_ATTACKS['tyrant-charge']!, busy = a.windupSeconds + a.activeSeconds + a.recoverySeconds;
    const asks = log.filter(l => l.out.attack); expect(asks.every(l => l.out.attack!.attackId === 'tyrant-charge')).toBe(true);
    expect(asks[0]!.t - ROAR_SECONDS).toBeCloseTo(half, 1);
    expect(asks[1]!.t - (asks[0]!.t + busy)).toBeCloseTo(half, 1);
    const restAt = firstT(log, 'lap-rest')!; expect(restAt).toBeCloseTo(asks[1]!.t + busy, 1);
    expect(log.filter(l => l.t >= restAt && l.t < restAt + LAPS.restSeconds - DT).every(l => l.state === 'lap-rest' && !l.out.attack)).toBe(true);
    expect(asks[2]!.t - restAt).toBeCloseTo(LAPS.restSeconds + half, 1);
    for (const l of log) if (l.state === 'lap') expect(l.out.intent).toMatchObject({ kind: 'toward', speedFactor: 1.4 });
  });

  // T19: the Reef Tyrant species row (spec §11.3, §11.6), with its real body length and speed.
  const TYRANT = SPECIES.find(x => x.key === '2:reef_tyrant');
  const tyrantL = () => speciesActor({ id: 0, spec: TYRANT! }).bodyLength;
  it('the Reef Tyrant row: tier 2, hunts [1], the size-1 alpha with the Tyrant jaw and 60 DNA; hostile to size 1 only, in every phase (plan defect 14)', () => {
    expect(TYRANT).toMatchObject({ tier: 2, hp: 110, speed: 1.5, model: 'worm', bodyScale: 1.6, behaviourId: 'reef-tyrant', hunts: [1], fights: true, pursuitId: 'hunter',
      alpha: { size: 1, rewardPartId: 'mouth_tyrant', rewardDna: 60 } });
    expect(TYRANT!.attackIds).toEqual(['tyrant-bite', 'tyrant-den-lunge', 'tyrant-charge', 'tyrant-whirl']);
    expect(tyrantL()).toBeCloseTo(35.84, 2);
    expect(hostileSizes(TYRANT!)).toEqual([1]);   // the phase does not change the hostile set: phase 2 (laps) keeps the phase-1 targets
  });
  it('reef tyrant laps: a charge every half lap, two charges, then a 1.5 s rest', () => {
    const L = tyrantL(), speed = TYRANT!.speed * SIZES[TYRANT!.tier]!, s = newAiState(1, 13); s.home = at(0, 0);
    const input = () => ({ self: { ...base().self, L, hp: 50, maxHp: TYRANT!.hp, speed }, inLair: true, pursuit: 'hunt' as const, player: { position: at(0, 10), d: 1, visible: true, targetable: true } });
    drive(tyrant, s, 1, input);   // phase 2 (50 / 110 = .45: above .33): the roar, then laps
    expect(s.phase).toBe(1);
    const log = drive(tyrant, s, 30, input, () => false, 1);
    const charges = log.filter(l => l.out.attack).map(l => l.t), a = SPECIES_ATTACKS['tyrant-charge']!, busy = a.windupSeconds + a.activeSeconds + a.recoverySeconds;
    const half = Math.PI * LAPS.radiusFraction * tyrant.lair!.radiusBodyLengths * L / (speed * 1.4);   // π × lap radius / (speed × 1.4)
    expect(charges.length).toBeGreaterThanOrEqual(3);
    expect(log.filter(l => l.out.attack).every(l => l.out.attack!.attackId === 'tyrant-charge')).toBe(true);
    expect(charges[1]! - charges[0]!).toBeGreaterThanOrEqual(half - 1e-6);
    expect(charges[2]! - charges[1]!).toBeGreaterThanOrEqual(LAPS.restSeconds + busy + half - .1);   // the rest after two charges (and the charge itself)
    expect(log.some(l => l.state === 'lap-rest')).toBe(true);
    const off = log.filter(l => l.state === 'lap' && l.out.intent.kind === 'toward').map(l => l.out.intent.kind === 'toward' ? Math.hypot(l.out.intent.point.x, l.out.intent.point.z) : 0);
    expect(Math.max(...off)).toBeLessThanOrEqual(tyrant.lair!.radiusBodyLengths * L + 1e-6);   // the lap stays inside the lair
  });
  it('the laps keep the lair height: the lap point is at the lair centre\'s height, not the body\'s (T19 live look: a swimming Tyrant climbed out of a crawler\'s reach)', () => {
    const s = newAiState(1, 14); s.home = at(0, 0, 5);
    const input = (y: number) => () => tyrantInput(40, { self: { ...tyrantInput(40).self, position: at(0, 17.6, y) } });
    drive(tyrant, s, 1, input(5));   // the roar, then laps
    for (const [k, y] of [5, 30, -20].entries()) {
      const laps = drive(tyrant, s, .5, input(y), () => false, 1 + .5 * k).filter(l => l.state === 'lap' && l.out.intent.kind === 'toward');
      expect(laps.length).toBeGreaterThan(0);
      for (const l of laps) expect(l.out.intent.kind === 'toward' && l.out.intent.point.y).toBe(5);
    }
  });
  it('the Tyrant lair (review R15): radius at most .25 x the play half-size at size 1, the size-1 start anchor outside 1.5 x the lair radius + 5 player body lengths', () => {
    const size = SIZES[1], plans = PLANS.filter(p => p.size === 1 && !p.needs);   // coast plans have no start anchor in open sea (anchors.test.ts)
    expect(plans.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 20; seed++) {
      const eco = new Ecosystem(seed), e = eco.entities.find(x => x.spec.key === '2:reef_tyrant')!, lair = lairOf(seed, e);
      const radius = tyrant.lair!.radiusBodyLengths * speciesActor(e).bodyLength;
      expect(radius).toBeLessThanOrEqual(.25 * PLAYER_HALF * size);
      expect(Math.max(Math.abs(lair.x), Math.abs(lair.z)) + radius).toBeLessThanOrEqual(.8 * PLAYER_HALF * size);   // the lair is inside the spawn square
      for (const p of plans) for (const growth of [1, 1.38]) {
        const actor = playerActor(p, starterFor(p), 1, growth), anchor = startAnchor(actor, 1, { queries: stageWorldQueries(1, seed), bounds: stageBounds(1) });
        if (!anchor.ok) throw new Error(`seed ${seed} ${p.id}: no start anchor`);
        expect(Math.hypot(anchor.position.x - lair.x, anchor.position.z - lair.z), `seed ${seed} ${p.id} growth ${growth}`).toBeGreaterThan(1.5 * radius + 5 * actor.bodyLength);
      }
      expect(Math.hypot(e.x - lair.x, e.z - lair.z)).toBeLessThanOrEqual(4 * speciesActor(e).bodyLength);   // installed near its lair
    }
  });
  it('the Tyrant is present only at size 1 and only while the Tyrant jaw is locked; it never respawns', () => {
    const eco = new Ecosystem(3), t = eco.entities.find(e => e.spec.key === '2:reef_tyrant')!, far = { x: 0, y: 9000, z: 0 };
    const step = (stage: number, now: number, unlocked: string[] = []) => eco.step({ stage, dt: DT, now, player: far, playerHull: [], perceivable: false, stealthFactor: 1, unlocked });
    step(1, 0); expect(t.eaten).toBe(false); expect(t.hp).toBe(110);
    step(0, .1); expect(t.eaten).toBe(true);   // not at size 0
    step(2, .2); expect(t.eaten).toBe(true);   // not at size 2
    step(1, .3); expect(t.eaten).toBe(false);
    step(1, .4, ['claw_mother']); expect(t.eaten).toBe(false);   // the other alpha's part does not matter
    step(1, .5, ['mouth_tyrant']); expect(t.eaten).toBe(true);
    step(1, 90, ['mouth_tyrant']); expect(t.eaten).toBe(true);
    eco.consume(t); expect(t.respawn).toBe(-1);
  });
});
