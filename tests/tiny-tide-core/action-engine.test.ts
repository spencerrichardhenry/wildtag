// tests/tiny-tide-core/action-engine.test.ts — clocks in seconds; every expected time is the sum of the phase lengths named beside it.
import { describe, expect, it } from 'vitest';
import { addPoise, advanceClock, applyHitStop, bufferedPress, bufferPress, canStart, clearBuffer, dashSpeed, lungeSpeed, endHold, interruptible, newPoise, phaseRemaining, stagger, startAction, sweepEnded, tickAction, type ActionInput, type StartCheck } from '../../src/tiny-tide/action-engine';
import { newRuntime, type ActionState, type CombatRuntime, type ResolvedMove } from '../../src/tiny-tide/combat-types';
import { resolveMove, speciesMove } from '../../src/tiny-tide/moves';
import { POKE, WRAP } from './combat-fixture';

const Z = { x: 0, y: 0, z: 1 }, X = { x: 1, y: 0, z: 0 };
const idle: ActionInput = { wantedAim: null, held: false, bodyForward: Z };
const DT = 1 / 100;
/** Runs the clock and one action for `seconds` in steps of DT; returns the phase after each step with its clock time. */
function run(rt: CombatRuntime, a: ActionState, seconds: number, input: Partial<ActionInput> = {}, now = { t: 0 }) {
  const log: { tau: number; phase: string }[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; tickAction(rt, a, d, { ...idle, ...input }); log.push({ tau: rt.actionClock, phase: a.phase }); }
  return log;
}
const start = (rt: CombatRuntime, resolved: ResolvedMove, over: { key?: string; aim?: { x: number; y: number; z: number } } = {}) =>
  startAction(rt, { instanceId: 'x1', definitionId: resolved.attack?.id ?? resolved.abilityId ?? 'm', grantId: 'g', source: { kind: 'actor', actorId: 'e1', mountId: 'root', socketId: 'centre' }, resolved,
    aim: over.aim ?? Z, targetId: null, cooldownKey: over.key ?? 'e1:root:m', worldNow: 0 });
const firstTau = (log: { tau: number; phase: string }[], phase: string) => log.find(l => l.phase === phase)?.tau;
const check = (over: Partial<StartCheck> = {}): StartCheck => ({ playing: true, isPlayer: true, kind: 'bite', cooldownKey: 'k', mode: 'swim', allowedModes: ['swim', 'ground'], inBreachArc: false, token: true, worldNow: 0, ...over });
const poke = speciesMove(POKE);   // windup .5, active .12, recovery .8, cooldown 2.5
const bite = resolveMove({ attackId: 'bite-snapper' }, 1);   // windup .16, active .08, recovery .22, lock .10, tracking 10
const brace = resolveMove({ abilityId: 'brace-shell' }, 1);   // startup .10, min active .25, recovery .15, cooldown .4
const dash = resolveMove({ abilityId: 'dash-side-fin' }, 1);  // startup .03, travel .18, recovery .12, cooldown 1.1
const counter = resolveMove({ abilityId: 'counter-spike' }, 1);   // startup .04, window .22, whiff .40, success cooldown .3

describe('action engine', () => {
  it('windup → active → recovery → done at exact times', () => {
    const rt = newRuntime(), a = start(rt, poke), log = run(rt, a, 1.5);
    expect(firstTau(log, 'active')).toBeCloseTo(.5); expect(firstTau(log, 'recovery')).toBeCloseTo(.62); expect(firstTau(log, 'interrupted')).toBeCloseTo(1.42);   // .5 + .12 + .8
  });
  it('cooldown starts at end of recovery', () => {
    const rt = newRuntime(), a = start(rt, poke); run(rt, a, 1.5);
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(3.92);   // 1.42 + 2.5
    expect(sweepEnded(rt)).toEqual([a]); expect(rt.actions).toEqual([]);
    expect(canStart(rt, check({ cooldownKey: 'e1:root:m' }))).toEqual({ ok: false, reason: 'cooldown' });
  });
  it('interrupted cooldown starts at the interrupt', () => {
    const rt = newRuntime(), a = start(rt, poke); run(rt, a, .3);
    const r = stagger(rt, .4); expect(r.interrupted).toEqual([a]); expect(a.phase).toBe('interrupted');
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(2.8);   // .3 + 2.5
  });
  it('aim turns at most maxTracking × Δτ', () => {
    const rt = newRuntime(), a = start(rt, bite);
    run(rt, a, .05, { wantedAim: X });
    expect(Math.acos(a.aim.z)).toBeCloseTo(.5, 5);   // 10 rad/s × .05 s
  });
  it('aim locks at aimLockAt and the shape is frozen', () => {
    const rt = newRuntime(), a = start(rt, bite), now = { t: 0 };
    const locks: number[] = [];
    for (let i = 0; i < 20; i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; if (tickAction(rt, a, d, { ...idle, wantedAim: X }).locked) locks.push(rt.actionClock); }
    expect(locks).toHaveLength(1); expect(locks[0]).toBeCloseTo(.10);
    expect(Math.acos(a.aim.z)).toBeCloseTo(1, 5);   // 10 rad/s × .1 s = 1 rad toward the wanted 90°, then frozen
  });
  it('brace holds while held, min active, then recovery', () => {
    const rt = newRuntime(), a = start(rt, brace, { key: 'player:p9:brace' });
    const log = run(rt, a, 1, { held: true });
    expect(firstTau(log, 'active')).toBeCloseTo(.10); expect(a.phase).toBe('active');   // held for 1 s: still active
    const after = run(rt, a, .5, { held: false }, { t: 1 });
    expect(firstTau(after, 'recovery')).toBeCloseTo(1.01); expect(firstTau(after, 'interrupted')).toBeCloseTo(1.16);   // released at 1.01 (active ≥ .25 already): recovery .15
    expect(rt.cooldowns.get('player:p9:brace')).toBeCloseTo(1.56);   // 1.16 + .4
  });
  it('release in windup still gives min active', () => {
    const rt = newRuntime(), a = start(rt, brace), log = run(rt, a, 1, { held: false });
    expect(firstTau(log, 'active')).toBeCloseTo(.10); expect(firstTau(log, 'recovery')).toBeCloseTo(.35); expect(firstTau(log, 'interrupted')).toBeCloseTo(.50);   // .10 + .25 + .15
  });
  it('held basic repeats bite', () => {
    // The engine refuses a second Bite while one runs; the next request after it ends starts at once (no cooldown).
    const rt = newRuntime(), a = start(rt, bite, { key: 'player:p1:bite' });
    expect(canStart(rt, check({ cooldownKey: 'player:p1:bite' }))).toEqual({ ok: false, reason: 'busy' });
    run(rt, a, .47); sweepEnded(rt);   // .16 + .08 + .22 = .46
    expect(canStart(rt, check({ cooldownKey: 'player:p1:bite' }))).toEqual({ ok: true, replaces: null });
  });
  it('buffer keeps a press in the last .12 s of recovery and in hit-stop only', () => {
    const rt = newRuntime(), a = start(rt, bite); run(rt, a, .30);   // recovery from .24 to .46: .16 left
    expect(bufferPress(rt, 2, .30)).toBe(false); expect(rt.buffered).toBeNull();
    run(rt, a, .05, {}, { t: .30 });   // .11 left
    expect(bufferPress(rt, 2, .35)).toBe(true); expect(rt.buffered).toEqual({ input: 2, at: rt.actionClock });
    expect(bufferPress(rt, 'basic', .35)).toBe(true); expect(rt.buffered!.input).toBe('basic');   // a newer press replaces it
    const idleRt = newRuntime(); expect(bufferPress(idleRt, 1, 0)).toBe(false);
    applyHitStop(idleRt, 0, .07); expect(bufferPress(idleRt, 1, .02)).toBe(true);
  });
  it('buffer expires after .12 s', () => {
    const rt = newRuntime(); applyHitStop(rt, 0, .07); bufferPress(rt, 1, 0);
    advanceClock(rt, 0, .1); expect(bufferedPress(rt)).toBe(1);   // the clock is stopped in the hit-stop: only .03 s passed
    advanceClock(rt, .1, .1); expect(bufferedPress(rt)).toBeNull();   // .13 s of action clock
    expect(rt.buffered).toBeNull();
  });
  it('clearBuffer drops a buffered press (pause)', () => {
    const rt = newRuntime(); applyHitStop(rt, 0, .07); bufferPress(rt, 1, 0); expect(rt.buffered).not.toBeNull();
    clearBuffer(rt); expect(rt.buffered).toBeNull(); expect(bufferedPress(rt)).toBeNull();
  });
  it('dash cancels bite and sweep recovery only', () => {
    for (const [move, cancels] of [[bite, true], [resolveMove({ abilityId: 'sweep-fan-tail' }, 1), true], [resolveMove({ abilityId: 'grab-pincer' }, 1), false], [counter, false]] as const) {
      const rt = newRuntime(), a = start(rt, move); run(rt, a, (move.attack?.windupSeconds ?? .04) + (move.attack?.activeSeconds ?? .22) + .02);
      expect(a.phase, move.label).toBe('recovery');
      const d = canStart(rt, check({ kind: 'dash' }));
      expect(d.ok, move.label).toBe(cancels); if (d.ok) expect(d.replaces).toBe(a);
    }
    const rt = newRuntime(); start(rt, bite); expect(canStart(rt, check({ kind: 'dash' })).ok).toBe(false);   // in windup: no cancel
    const sp = newRuntime(), s = start(sp, poke); run(sp, s, .7); expect(canStart(sp, check({ kind: 'dash', isPlayer: false })).ok).toBe(false);   // species never cancel
  });
  it('stagger interrupts interruptible windup/active only', () => {
    const lunge = speciesMove({ ...POKE, lunge: { distanceBodyLengths: 1.2 } });
    for (const [move, at, expected] of [[poke, .2, true], [poke, .55, true], [poke, .9, false], [lunge, .2, true], [lunge, .55, false], [brace, .2, false], [dash, .05, false], [counter, .1, false],
      [speciesMove({ ...POKE, interruptible: false }), .2, false]] as const) {
      const rt = newRuntime(), a = start(rt, move); run(rt, a, at, { held: true });
      expect(interruptible(a), `${move.label} at ${at}`).toBe(expected);
      stagger(rt, .3); expect(a.phase === 'interrupted', `${move.label} at ${at}`).toBe(expected);
    }
    const rt = newRuntime(), a = start(rt, brace); run(rt, a, .2, { held: true }); stagger(rt, .3, true); expect(a.phase).toBe('interrupted');   // a counter's stagger forces it
  });
  it('poise meter, decay 4/s, stagger at poise', () => {
    const m = newPoise();
    expect(addPoise(m, 4, 0, 6)).toBe(false); expect(addPoise(m, 1, .5, 6)).toBe(false);   // 4 − 2 + 1 = 3
    expect(m.value).toBeCloseTo(3); expect(addPoise(m, 3, .5, 6)).toBe(true); expect(m.value).toBe(0);
    const n = newPoise(); addPoise(n, 5, 0, 6); expect(addPoise(n, 2, 2, 6)).toBe(false);   // fully decayed: 0 + 2
  });
  it("hit-stop pauses the two actors' clocks only", () => {
    const a = newRuntime(), b = newRuntime(), c = newRuntime();
    applyHitStop(a, 1, .07); applyHitStop(b, 1, .07);
    for (const rt of [a, b, c]) rt.actionClock = 1;
    expect(advanceClock(a, 1, .05)).toBe(0); expect(advanceClock(b, 1, .05)).toBe(0); expect(advanceClock(c, 1, .05)).toBeCloseTo(.05);
    expect(advanceClock(a, 1.05, .05)).toBeCloseTo(.03);   // the stop ends at 1.07
  });
  it('overlapping hit-stops use the max', () => {
    const rt = newRuntime(); applyHitStop(rt, 1, .09); applyHitStop(rt, 1.02, .06); expect(rt.hitStopUntil).toBeCloseTo(1.09);
    applyHitStop(rt, 1.05, .06); expect(rt.hitStopUntil).toBeCloseTo(1.11);
  });
  it('start rules: staggered, held, cooldown, breach arc', () => {
    expect(canStart(newRuntime(), check({ playing: false }))).toEqual({ ok: false, reason: 'not-playing' });
    const st = newRuntime(); stagger(st, .5); expect(canStart(st, check())).toEqual({ ok: false, reason: 'staggered' });
    const held = newRuntime(); held.heldBy = 'e4';
    expect(canStart(held, check({ kind: 'dash' }))).toEqual({ ok: false, reason: 'held' }); expect(canStart(held, check({ kind: 'bite' })).ok).toBe(true);   // a held player may Bite
    expect(canStart(held, check({ kind: 'bite', isPlayer: false }))).toEqual({ ok: false, reason: 'held' });
    const cd = newRuntime(); cd.cooldowns.set('k', .5); expect(canStart(cd, check())).toEqual({ ok: false, reason: 'cooldown' });
    expect(canStart(newRuntime(), check({ kind: 'dash', inBreachArc: true }))).toEqual({ ok: false, reason: 'mode' });
    expect(canStart(newRuntime(), check({ mode: 'fly' }))).toEqual({ ok: false, reason: 'mode' });
    expect(canStart(newRuntime(), check({ token: false }))).toEqual({ ok: false, reason: 'token' });
    const hs = newRuntime(); applyHitStop(hs, 0, .07); expect(canStart(hs, check({ worldNow: .03 }))).toEqual({ ok: false, reason: 'hit-stop' });
  });
  it('a grab in its hold lets the grabber Bite; another move ends the hold; the hold ends at hold.seconds', () => {
    const grab = speciesMove(WRAP), rt = newRuntime(), a = start(rt, grab); run(rt, a, .65);   // windup .6: active
    a.heldTarget = 'player'; a.connected = true;
    const log = run(rt, a, .1, {}, { t: .65 }); expect(firstTau(log, 'hold')).toBeCloseTo(.72);   // .6 + .12
    expect(canStart(rt, check({ kind: 'bite', isPlayer: false }))).toEqual({ ok: true, replaces: null });
    expect(canStart(rt, check({ kind: 'species', isPlayer: false }))).toEqual({ ok: true, replaces: a });
    let released: string | null = null; const now = { t: .75 };
    for (let i = 0; i < 130 && !released; i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; released = tickAction(rt, a, d, idle).releasedTarget; }
    expect(released).toBe('player'); expect(rt.actionClock).toBeCloseTo(1.92);   // hold 1.2 s from .72
    expect(phaseRemaining(a, rt.actionClock)).toBeCloseTo(.8);   // recovery
    const b = newRuntime(), g = start(b, grab); run(b, g, .65); g.heldTarget = 'player'; run(b, g, .1, {}, { t: .65 });
    expect(endHold(b, g)).toBe('player'); expect(g.phase).toBe('recovery');
  });
  it('a grab that caught nothing recovers for whiffRecoverySeconds; a counter that succeeds ends at once', () => {
    const rt = newRuntime(), g = start(rt, resolveMove({ abilityId: 'grab-pincer' }, 1)), log = run(rt, g, 1);
    expect(firstTau(log, 'recovery')).toBeCloseTo(.28); expect(firstTau(log, 'interrupted')).toBeCloseTo(.73);   // .18 + .10, then whiff .45
    const c = newRuntime(), k = start(c, counter, { key: 'player:p3:counter' }); run(c, k, .1); k.countered = true; run(c, k, .01, {}, { t: .1 });
    expect(k.phase).toBe('interrupted'); expect(c.cooldowns.get('player:p3:counter')).toBeCloseTo(.41);   // ended at .11, success cooldown .3
  });

  it('D11: during a Bite recovery only Dash starts; grab, brace and bite are busy', () => {
    const rt = newRuntime(), a = start(rt, bite); run(rt, a, .30); expect(a.phase).toBe('recovery');
    for (const kind of ['grab', 'brace', 'bite', 'counter', 'sweep'] as const) expect(canStart(rt, check({ kind })), kind).toEqual({ ok: false, reason: 'busy' });
    expect(canStart(rt, check({ kind: 'dash' })).ok).toBe(true);
  });
  it('§5.5: brace released at .20 (active since .10) recovers at .35 and ends at .50', () => {
    const rt = newRuntime(), a = start(rt, brace), now = { t: 0 };
    const first = run(rt, a, .20, { held: true }, now), after = run(rt, a, .5, { held: false }, now);
    expect(first.at(-1)!.phase).toBe('active');
    expect(firstTau(after, 'recovery')).toBeCloseTo(.35); expect(firstTau(after, 'interrupted')).toBeCloseTo(.50);
  });
  it('phase changes land at exact times whatever the step', () => {
    for (const dt of [1 / 60, .07]) {
    const rt = newRuntime(), a = start(rt, poke); let tau = 0, rec: number | null = null;
    for (let i = 0; i < 100 && a.phase !== 'interrupted'; i++) {
      advanceClock(rt, i * dt, dt); tickAction(rt, a, dt, idle); tau = rt.actionClock;
      if (a.phase === 'recovery' && rec === null) rec = a.phaseStartedAt;
    }
    expect(rec).toBeCloseTo(.62, 9); expect(a.phaseStartedAt).toBeCloseTo(1.42, 9); expect(tau).toBeGreaterThanOrEqual(1.42);
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(1.42 + 2.5, 9);
    }
  });
  it('one large step crosses several phases with exact cooldown', () => {
    const rt = newRuntime(), a = start(rt, poke); rt.actionClock = 2;
    const r = tickAction(rt, a, 2, idle);
    expect(r.enteredActive && r.enteredRecovery && r.ended).toBe(true); expect(a.phase).toBe('interrupted');
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(1.42 + 2.5, 9);
  });
  it('stagger releases a grab hold (and a forced one ends it)', () => {
    for (const force of [false, true]) {
      const rt = newRuntime(), g = start(rt, speciesMove(WRAP)); run(rt, g, .65); g.heldTarget = 'player'; run(rt, g, .1, {}, { t: .65 });
      expect(g.phase).toBe('hold');
      const r = stagger(rt, .3, force); expect(r.releasedTargets).toEqual(['player']);
      expect(g.phase).toBe(force ? 'interrupted' : 'recovery'); expect(g.heldTarget).toBeNull(); expect(r.interrupted).toEqual(force ? [g] : []);
    }
  });
  it('§5.4 fixed-at-start locks at start and never turns', () => {
    const rt = newRuntime(), a = start(rt, speciesMove({ ...POKE, aimMode: 'fixed-at-start' }));
    expect(a.aimLocked).toBe(true);
    const r = run(rt, a, .3, { wantedAim: X }); expect(a.aim).toEqual(Z); expect(r.length).toBe(30);
  });
  it('§5.4 body-back turns toward the reverse of bodyForward and ignores wantedAim', () => {
    const rt = newRuntime(), a = start(rt, speciesMove({ ...POKE, aimMode: 'body-back', maxTrackingRadiansPerSecond: 100, aimLockAtSeconds: .3 }));
    run(rt, a, .3, { wantedAim: X, bodyForward: { x: 0, y: 0, z: 1 } }); expect(a.aim.z).toBeCloseTo(-1, 5); expect(Math.abs(a.aim.x)).toBeLessThan(1e-6);
  });
  it('TickResult flags and brace guard state', () => {
    const rt = newRuntime(), a = start(rt, brace), now = { t: 0 }; expect(rt.guardProfileId).toBeNull();
    let entered = 0, wasActiveAtEntry = false;
    for (let i = 0; i < 12; i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; const r = tickAction(rt, a, d, { ...idle, held: true }); if (r.enteredActive) { entered++; wasActiveAtEntry = r.wasActive; } }
    expect(entered).toBe(1); expect(wasActiveAtEntry).toBe(true); expect(rt.guardProfileId).toBe(brace.guard!.id);
    run(rt, a, .5, { held: false }, now); expect(rt.guardProfileId).toBeNull();
    const rt2 = newRuntime(), b = start(rt2, brace); run(rt2, b, .36, { held: true }); tickAction(rt2, b, 0, { ...idle, held: false }); expect(b.phase).toBe('recovery'); expect(rt2.guardProfileId).toBeNull();
  });
  it('dash and lunge speeds are distance × L / seconds', () => {
    expect(dashSpeed(start(newRuntime(), dash), 2)).toBeCloseTo(dash.evasion!.distanceBodyLengths * 2 / dash.evasion!.travelSeconds);
    const lunge = speciesMove({ ...POKE, lunge: { distanceBodyLengths: 1.2 } });
    expect(lungeSpeed(start(newRuntime(), lunge), 3)).toBeCloseTo(1.2 * 3 / .12); expect(lungeSpeed(start(newRuntime(), poke), 3)).toBe(0); expect(dashSpeed(start(newRuntime(), poke), 3)).toBe(0);
  });
  it('a short stagger after a long one keeps the longer end', () => {
    const rt = newRuntime(); stagger(rt, 1); stagger(rt, .2); expect(rt.staggerUntil).toBeCloseTo(1);
  });
  it('aim lock with a coarse step turns exactly up to aimLockAtSeconds', () => {
    const rt = newRuntime(), a = start(rt, bite), now = { t: 0 }; let locks = 0;
    for (let i = 0; i < 7; i++) { const d = advanceClock(rt, now.t, .03); now.t += .03; if (tickAction(rt, a, d, { ...idle, wantedAim: X }).locked) locks++; }
    expect(locks).toBe(1); expect(Math.acos(a.aim.z)).toBeCloseTo(1, 5);
  });
});
