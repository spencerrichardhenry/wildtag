import { describe, expect, it } from 'vitest';
import { advanceClock, newPoise, startAction, tickAction } from '../../src/tiny-tide/action-engine';
import { addBreakProgress, armCounters, compareRequests, isFlick, ledgerKey, releaseHold, resolveAll, resolveHit, squeezesDue, targetsHit, type Fighter, type HitRequestIn } from '../../src/tiny-tide/hit-resolver';
import { newRuntime, type ActionState, type AttackSpec, type CombatRuntime, type ResolvedMove } from '../../src/tiny-tide/combat-types';
import { resolveMove, speciesMove } from '../../src/tiny-tide/moves';
import { POKE, WRAP } from './combat-fixture';

const DEG = Math.PI / 180;
const player = (over: Partial<Fighter> = {}): Fighter => ({ id: 'player', isPlayer: true, rt: newRuntime(), centre: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, L: 2, mass: 2, knockbackResistance: 0,
  armor: 0, ground: false, grabbable: true, poise: null, poiseMax: 0, staggerResist: 0, health: 6, ...over });
const crab = (over: Partial<Fighter> = {}): Fighter => ({ id: 'e7', isPlayer: false, rt: newRuntime(), centre: { x: 0, y: 0, z: 3 }, forward: { x: 0, y: 0, z: -1 }, L: 5.6, mass: 5.6, knockbackResistance: .2,
  armor: 0, ground: true, grabbable: true, poise: newPoise(), poiseMax: 6, staggerResist: 0, health: 20, ...over });
let n = 0;
const act = (rt: CombatRuntime, resolved: ResolvedMove, startedAt = 0): ActionState => startAction(rt, { instanceId: `a${++n}`, definitionId: resolved.attack?.id ?? 'm', grantId: 'g', source: { kind: 'actor', actorId: 'x', mountId: 'root', socketId: 'centre' },
  resolved, aim: { x: 0, y: 0, z: -1 }, targetId: null, cooldownKey: `k${n}`, worldNow: startedAt });
/** Puts an action into its active phase at once. */
const activeNow = (a: ActionState) => { a.phase = 'active'; return a; };
const req = (attacker: Fighter, target: Fighter, attack: AttackSpec, over: Partial<HitRequestIn> = {}): HitRequestIn => {
  const action = over.action ?? activeNow(act(attacker.rt, speciesMove(attack)));
  return { attacker, target, action, attack, hitGroupId: 'g', origin: { x: 0, y: 0, z: 2 }, point: { x: 0, y: 0, z: .5 }, geometryOk: true, ...over };
};
const guard = (rt: CombatRuntime, id: string) => activeNow(act(rt, resolveMove({ abilityId: id }, 1)));

describe('hit resolver', () => {
  it('counter beats block and staggers the attacker', () => {
    const p = player(), c = crab(); guard(p.rt, 'brace-shell'); const k = guard(p.rt, 'counter-spike');
    const e = resolveHit(req(c, p, POKE), 1)!;
    expect(e.outcome).toBe('countered'); expect(e.reflect).toBe(3); expect(p.health).toBe(6); expect(c.health).toBe(17);
    expect(c.rt.staggerUntil).toBeCloseTo(1); expect(c.rt.actions[0]!.phase).toBe('interrupted');   // even an uninterruptible attack ends
    expect(k.countered).toBe(true); expect(k.phase).toBe('interrupted'); expect(p.rt.cooldowns.get(k.cooldownKey)).toBeCloseTo(.3);
    expect(e.hitStop).toBeCloseTo(.09); expect(p.rt.hitStopUntil).toBeCloseTo(1.09); expect(c.rt.hitStopUntil).toBeCloseTo(1.09);
  });
  it('counter fails against unparryable', () => {
    const p = player(), c = crab(); guard(p.rt, 'counter-spike');
    const e = resolveHit(req(c, p, { ...POKE, parryable: false }), 1)!;
    expect(e.outcome).toBe('hit'); expect(p.health).toBe(5);   // 2 half-hearts
  });
  it('brace blocks in front only', () => {
    const front = player(); guard(front.rt, 'brace-shell');
    expect(resolveHit(req(crab(), front, POKE), 1)!.outcome).toBe('blocked');
    const behind = player({ forward: { x: 0, y: 0, z: -1 } }); guard(behind.rt, 'brace-shell');
    expect(resolveHit(req(crab(), behind, POKE), 1)!.outcome).toBe('hit');
    // 69° off the forward is in front (70°); 71° is not.
    for (const [deg, outcome] of [[69, 'blocked'], [71, 'hit']] as const) {
      const p = player(); guard(p.rt, 'brace-shell');
      expect(resolveHit(req(crab(), p, POKE, { origin: { x: Math.sin(deg * DEG), y: 0, z: Math.cos(deg * DEG) } }), 1)!.outcome, `${deg}°`).toBe(outcome);
    }
    const starting = player(); act(starting.rt, resolveMove({ abilityId: 'brace-shell' }, 1));   // still in its startup
    expect(resolveHit(req(crab(), starting, POKE), 1)!.outcome).toBe('hit');
  });
  it('heavy hit breaks the guard', () => {
    const p = player(), b = guard(p.rt, 'brace-shell');   // breaks at 4 half-hearts
    const e = resolveHit(req(crab(), p, { ...POKE, damage: 4 }), 1)!;
    expect(e.outcome).toBe('guard-broken'); expect(b.phase).toBe('interrupted'); expect(p.rt.cooldowns.get(b.cooldownKey)).toBeCloseTo(2);
    expect(p.rt.staggerUntil).toBeCloseTo(.5); expect(e.amount).toBe(2);   // floor(4 × (1 − .75 / 2)) = floor(2.5)
    const armored = player({ armor: 2 }); guard(armored.rt, 'brace-shell');
    expect(resolveHit(req(crab(), armored, { ...POKE, damage: 4 }), 1)!.outcome).toBe('blocked');   // 4 − 1 = 3 < 4
  });
  it('brace damage uses floor after armor', () => {
    const p = player(); guard(p.rt, 'brace-shell');
    const e = resolveHit(req(crab(), p, { ...POKE, damage: 3 }), 1)!;
    expect(e.amount).toBe(0); expect(p.health).toBe(6); expect(p.rt.invulnerableUntil).toBe(0);   // floor(3 × .25) = 0: no post-hit invulnerability
    const q = player({ armor: 0 }); guard(q.rt, 'brace-shell'); q.rt.actions[0]!.resolved = resolveMove({ abilityId: 'brace-shell' }, .4);   // block .66, breaks at 3
    expect(resolveHit(req(crab(), q, { ...POKE, damage: 2 }), 1)!.amount).toBe(0);   // floor(2 × .34)
  });
  it('dash invulnerability evades and records the ledger', () => {
    const p = player(); activeNow(act(p.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1)));
    const r = req(crab(), p, POKE), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('evaded'); expect(p.health).toBe(6); expect(e.hitStop).toBe(0);
    p.rt.actions = [];   // the dash is over: the same attack instance cannot hit again (D12)
    expect(resolveHit(r, 1.05)).toBeNull();
    const starting = player(); act(starting.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1));   // startup .03 is not invulnerable
    expect(resolveHit(req(crab(), starting, POKE), 1)!.outcome).toBe('hit');
  });
  it('grace invulnerability is immune', () => {
    const p = player(); p.rt.invulnerableUntil = 3;
    expect(resolveHit(req(crab(), p, POKE), 1)!.outcome).toBe('immune');
    const off = player(); off.rt.damageable = false; expect(resolveHit(req(crab(), off, POKE), 1)!.outcome).toBe('immune');
    const hidden = player(); hidden.rt.targetable = false; expect(resolveHit(req(crab(), hidden, POKE), 1)).toBeNull();
  });
  it('post-hit invulnerability .4 s', () => {
    const p = player(), c = crab(), a = activeNow(act(c.rt, speciesMove(POKE))), b = activeNow(act(c.rt, speciesMove(POKE)));
    expect(resolveHit(req(c, p, POKE, { action: a }), 1)!.outcome).toBe('hit'); expect(p.rt.invulnerableUntil).toBeCloseTo(1.4); expect(p.rt.lastDamageAt).toBe(1);
    expect(resolveHit(req(c, p, POKE, { action: b }), 1.39)!.outcome).toBe('immune');
    expect(resolveHit(req(c, p, POKE, { action: activeNow(act(c.rt, speciesMove(POKE))) }), 1.4)!.outcome).toBe('hit');
  });
  it('damage in half-hearts with armor', () => {
    const p = player({ armor: 3 }); const e = resolveHit(req(crab(), p, { ...POKE, damage: 3 }), 1)!;
    expect(e.amount).toBe(2); expect(e.unit).toBe('half-heart'); expect(p.health).toBe(5);   // 3 − floor(3 / 2) = 2 half-hearts
    const q = player({ armor: 4 }); expect(resolveHit(req(crab(), q, { ...POKE, damage: 1 }), 1)!.amount).toBe(1);   // at least 1
    const c = crab(); const s = resolveHit(req(player(), c, { ...POKE, damageUnit: 'hp', damage: 4 }), 1)!;
    expect(s.unit).toBe('hp'); expect(c.health).toBe(16); expect(s.hitStop).toBeCloseTo(.075);   // 60 + round(30 × 4 / 8) ms
  });
  it('impulse formula, resistance, blocked × .3', () => {
    // Crab (L 5.6, mass 5.6) hits a player (mass 2, L 6: cap 54): J = 4 × 5.6 × min(5.6, 4) = 89.6; Δv = 89.6 / 2 = 44.8 along origin → point (−z).
    const big = { L: 6 };
    const p = player(big), e = resolveHit(req(crab(), p, POKE), 1)!;
    expect(e.impulse.z).toBeCloseTo(-44.8); expect(e.impulse.x).toBe(0); expect(p.rt.externalVelocity.z).toBeCloseTo(-44.8);
    const r = player({ ...big, knockbackResistance: .5 }); resolveHit(req(crab(), r, POKE), 1); expect(r.rt.externalVelocity.z).toBeCloseTo(-22.4);
    const b = player(big); guard(b.rt, 'brace-shell'); resolveHit(req(crab(), b, POKE), 1); expect(b.rt.externalVelocity.z).toBeCloseTo(-44.8 * .3);
    const k = player(big), kb = guard(k.rt, 'brace-shell'); kb.resolved = { ...kb.resolved, guard: { ...kb.resolved.guard!, breakHalfHearts: 2 } };
    expect(resolveHit(req(crab(), k, POKE), 1)!.outcome).toBe('guard-broken'); expect(k.rt.externalVelocity.z).toBeCloseTo(-44.8 * .6);
    // min(m_a, 2 m_t): a light attacker uses its own mass. Mass 1, L 5.6: J = 4 × 5.6 × 1 = 22.4; Δv = 11.2.
    const light = player(big); resolveHit(req(crab({ mass: 1 }), light, POKE), 1); expect(light.rt.externalVelocity.z).toBeCloseTo(-11.2);
    // A heavy attacker is limited to 2 m_t: mass 50 gives the same as mass 4.
    const heavy = player(big); resolveHit(req(crab({ mass: 50 }), heavy, POKE), 1); expect(heavy.rt.externalVelocity.z).toBeCloseTo(-44.8);
    // A ground target is pushed horizontally: an origin above it gives no vertical push.
    const g = player({ ...big, ground: true }); resolveHit(req(crab(), g, POKE, { origin: { x: 0, y: 3, z: 2 } }), 1);
    expect(g.rt.externalVelocity.y).toBe(0); expect(g.rt.externalVelocity.z).toBeCloseTo(-44.8);
    const f = player(big); resolveHit(req(crab(), f, POKE, { origin: { x: 0, y: 3, z: 2 }, point: { x: 0, y: -1, z: -1 } }), 1);   // a swimmer keeps the vertical part
    expect(f.rt.externalVelocity.y).toBeCloseTo(-44.8 * 4 / 5); expect(f.rt.externalVelocity.z).toBeCloseTo(-44.8 * 3 / 5);
  });
  it('knockback is capped at 9 target body lengths a second (R8)', () => {
    // The plain crab on the size-0 player (L 2): uncapped 44.8, capped 9 × 2 = 18.
    const p = player(), e = resolveHit(req(crab(), p, POKE), 1)!;
    expect(e.impulse.z).toBeCloseTo(-18); expect(p.rt.externalVelocity.z).toBeCloseTo(-18);
    // A Clawmother-class impulse (L 10.08, mass 10.08) on a Speck (L 2, mass 2): uncapped 4 × 10.08 × 4 / 2 = 80.64; capped 18.
    const speck = player(), mother = crab({ id: 'e9', L: 10.08, mass: 10.08 });
    expect(resolveHit(req(mother, speck, POKE), 1)!.impulse.z).toBeCloseTo(-18);
    // The cap is on the knock after resistance; the guard multiplies the capped knock (blocked 18 × .3).
    const resist = player({ knockbackResistance: .5 }); resolveHit(req(mother, resist, POKE), 1); expect(resist.rt.externalVelocity.z).toBeCloseTo(-18);
    const braced = player(); guard(braced.rt, 'brace-shell'); resolveHit(req(mother, braced, POKE), 1); expect(braced.rt.externalVelocity.z).toBeCloseTo(-18 * .3);
    // A knock below the cap is unchanged: 9 × 5 = 45 > 44.8.
    const under = player({ L: 5 }); resolveHit(req(crab(), under, POKE), 1); expect(under.rt.externalVelocity.z).toBeCloseTo(-44.8);
    // The size of the knock is capped, not one axis: a diagonal knock has length 18.
    const diag = player(); resolveHit(req(crab(), diag, POKE, { origin: { x: 1, y: 0, z: 1 }, point: { x: 0, y: 0, z: 0 } }), 1);
    expect(Math.hypot(diag.rt.externalVelocity.x, diag.rt.externalVelocity.y, diag.rt.externalVelocity.z)).toBeCloseTo(18);
  });
  it('a counter open at a lunge\'s active start counters its later contact (R5)', () => {
    const lunge: AttackSpec = { ...POKE, id: 'lunge', activeSeconds: .3, lunge: { distanceBodyLengths: 1.4 } };
    const still = { wantedAim: null, held: false, bodyForward: { x: 0, y: 0, z: 1 } };
    const setup = (arm: boolean) => {
      const p = player(), c = crab(), a = act(c.rt, speciesMove(lunge));
      p.rt.actionClock = .3; const k = act(p.rt, resolveMove({ abilityId: 'counter-spike' }, 1));   // startup .04: the window is open .34 → .56
      p.rt.actionClock = .5; tickAction(p.rt, k, .2, still); expect(k.phase).toBe('active');
      c.rt.actionClock = .5; const t = tickAction(c.rt, a, .5, still); expect(t.enteredActive).toBe(true);   // the lunge becomes active at .5
      if (arm) armCounters(a, p.rt);
      p.rt.actionClock = .7; tickAction(p.rt, k, .2, still); expect(k.phase).toBe('recovery');   // the window closed at .56 (whiff recovery)
      return { p, c, a, k };
    };
    // The contact lands .2 s after the active start: the window is closed, but the Counter was armed against this action.
    const { p, c, a, k } = setup(true), e = resolveHit(req(c, p, lunge, { action: a }), .7)!;
    expect(e.outcome).toBe('countered'); expect(e.reflect).toBe(3); expect(p.health).toBe(6); expect(c.health).toBe(17);
    expect(k.countered).toBe(true); expect(k.phase).toBe('interrupted'); expect(p.rt.cooldowns.get(k.cooldownKey)).toBeCloseTo(.7 + .3);
    expect(a.phase).toBe('interrupted'); expect(c.rt.staggerUntil).toBeCloseTo(.5 + 1);
    // Not armed (the Counter was not open at the active start): the late contact hits.
    const u = setup(false); expect(resolveHit(req(u.c, u.p, lunge, { action: u.a }), .7)!.outcome).toBe('hit');
    // Armed against one action only: another action's contact after the window hits.
    const o = setup(true), other = activeNow(act(o.c.rt, speciesMove(lunge)));
    expect(resolveHit(req(o.c, o.p, lunge, { action: other }), .7)!.outcome).toBe('hit'); expect(o.k.countered).toBe(false);
    // An unparryable action does not arm a Counter.
    const hard: AttackSpec = { ...lunge, parryable: false }, hp = player(), hk = guard(hp.rt, 'counter-spike'), hc = crab(), ha = activeNow(act(hc.rt, speciesMove(hard)));
    armCounters(ha, hp.rt); hk.phase = 'recovery';
    expect(resolveHit(req(hc, hp, hard, { action: ha }), .7)!.outcome).toBe('hit');
    // A Counter still in its startup is not open: it does not arm.
    const sp = player(), sk = act(sp.rt, resolveMove({ abilityId: 'counter-spike' }, 1)), sc = crab(), sa = activeNow(act(sc.rt, speciesMove(lunge)));
    armCounters(sa, sp.rt); sk.phase = 'recovery';
    expect(resolveHit(req(sc, sp, lunge, { action: sa }), .7)!.outcome).toBe('hit');
  });
  it('a Brace in its windup does not block; it blocks once active', () => {
    const p = player(), b = act(p.rt, resolveMove({ abilityId: 'brace-shell' }, 1)), held = { wantedAim: null, held: true, bodyForward: { x: 0, y: 0, z: 1 } };
    p.rt.actionClock = .05; tickAction(p.rt, b, .05, held); expect(b.phase).toBe('windup');
    expect(resolveHit(req(crab(), p, POKE), 1)!.outcome).toBe('hit');
    const q = player(), qb = act(q.rt, resolveMove({ abilityId: 'brace-shell' }, 1));
    q.rt.actionClock = .1; tickAction(q.rt, qb, .1, held); expect(qb.phase).toBe('active'); expect(q.rt.guardProfileId).toBe('brace-shell');
    expect(resolveHit(req(crab(), q, POKE), 1)!.outcome).toBe('blocked');
    // A Brace in recovery does not block either.
    const r = player(), rb = guard(r.rt, 'brace-shell'); rb.phase = 'recovery';
    expect(resolveHit(req(crab(), r, POKE), 1)!.outcome).toBe('hit');
  });
  it('hit ledger: a second contact of the same action on the same target does nothing', () => {
    const p = player({ L: 6 }), c = crab(), r = req(c, p, POKE);
    expect(resolveHit(r, 1)!.outcome).toBe('hit'); expect(r.action.hitCounts.get(ledgerKey(r.action, 'g', 'player'))).toBe(1);
    p.rt.invulnerableUntil = 0; p.rt.hitStopUntil = 0; c.rt.hitStopUntil = 0;
    const health = p.health, v = p.rt.externalVelocity.z;
    expect(resolveHit(r, 5)).toBeNull();
    expect(p.health).toBe(health); expect(p.rt.externalVelocity.z).toBe(v); expect(p.rt.hitStopUntil).toBe(0); expect(c.rt.hitStopUntil).toBe(0);
    expect(r.action.hitCounts.get(ledgerKey(r.action, 'g', 'player'))).toBe(1);
    // Another hit group of the same action has its own entry.
    expect(resolveHit({ ...r, hitGroupId: 'h' }, 5)!.outcome).toBe('hit');
    expect([...targetsHit(r.action)]).toEqual(['player']);
  });
  it('D12: a hit dodged by Dash i-frames is in the ledger and cannot hit later in the same action', () => {
    const p = player(), c = crab(), dash = activeNow(act(p.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1))), r = req(c, p, POKE);
    const e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('evaded'); expect(e.amount).toBe(0); expect(p.rt.externalVelocity.z).toBe(0); expect(r.action.connected).toBe(false);
    expect(r.action.hitCounts.get(ledgerKey(r.action, 'g', 'player'))).toBe(1); expect(r.action.lastHitAt.get(ledgerKey(r.action, 'g', 'player'))).toBe(1);
    dash.phase = 'recovery';   // the i-frames are over, the attack is still active
    expect(resolveHit(r, 2)).toBeNull(); expect(p.health).toBe(6);   // 2: past repeatHitSeconds, so only the ledger count stops it
    // An immune hit (grace) is in the ledger too.
    const g = player(); g.rt.invulnerableUntil = 1.05; const gr = req(c, g, POKE);
    expect(resolveHit(gr, 1)!.outcome).toBe('immune'); expect(resolveHit(gr, 2)).toBeNull(); expect(g.health).toBe(6);
  });
  it('one hit per target per action, repeat for whirl', () => {
    const p = player(), c = crab(), r = req(c, p, POKE);
    expect(resolveHit(r, 1)).not.toBeNull(); p.rt.invulnerableUntil = 0;
    expect(resolveHit(r, 2)).toBeNull();   // maxHitsPerTarget 1
    const whirl: AttackSpec = { ...POKE, maxHitsPerTarget: 2, repeatHitSeconds: .3 }, q = player(), w = req(c, q, whirl, { action: activeNow(act(c.rt, speciesMove(whirl))) });
    expect(resolveHit(w, 1)).not.toBeNull(); q.rt.invulnerableUntil = 0;
    expect(resolveHit(w, 1.2)).toBeNull(); expect(resolveHit(w, 1.3)!.outcome).toBe('hit'); q.rt.invulnerableUntil = 0;
    expect(resolveHit(w, 2)).toBeNull();
    // maxTargets: a second target is dropped once the action hit its one target.
    const s = req(c, player({ id: 'p2' }), POKE, { action: r.action }); expect(resolveHit(s, 3)).toBeNull();
  });
  it('processing order is deterministic', () => {
    const p = player(), a = crab({ id: 'e2' }), b = crab({ id: 'e1' });
    const first = req(a, p, POKE, { action: activeNow(act(a.rt, speciesMove(POKE), 1)) }), second = req(b, p, POKE, { action: activeNow(act(b.rt, speciesMove(POKE), 1)) });
    expect([first, second].sort(compareRequests).map(r => r.attacker.id)).toEqual(['e1', 'e2']);   // same start: by attacker id
    const events = resolveAll([first, second], 2);
    expect(events.map(e => [e.attackerId, e.outcome])).toEqual([['e1', 'hit'], ['e2', 'immune']]);   // the first hit's .4 s makes the second immune
  });
  it('grab ignores brace', () => {
    const p = player(); guard(p.rt, 'brace-shell');
    const e = resolveHit(req(crab(), p, WRAP), 1)!;
    expect(e.outcome).toBe('grabbed'); expect(p.rt.heldBy).toBe('e7');
  });
  it('grab size rule holds or breaks free', () => {
    // WRAP: size factor 1.2. A crab (L 5.6) holds a player of L ≤ 6.72.
    const small = player({ L: 6.72 }), c = crab(), r = req(c, small, WRAP), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('grabbed'); expect(e.held).toBe(true); expect(e.caught).toBe(true); expect(r.action.heldTarget).toBe('player'); expect(small.rt.heldBy).toBe('e7');
    expect(e.amount).toBe(1); expect(small.health).toBe(5.5); expect(e.hitStop).toBeCloseTo(.07);   // startHalfHearts 1
    const big = player({ L: 6.8 }), f = resolveHit(req(crab(), big, WRAP), 1)!;
    expect(f.outcome).toBe('hit'); expect(f.held).toBe(false); expect(big.rt.heldBy).toBeNull(); expect(big.rt.staggerUntil).toBeCloseTo(.3);
    const alpha = player({ grabbable: false }); expect(resolveHit(req(crab(), alpha, WRAP), 1)!.held).toBe(false);
    // A player's grab on a species: HP damage; the species' interruptible action ends.
    const prey = crab({ L: 1 }), own = activeNow(act(prey.rt, speciesMove(POKE))); own.phase = 'windup';
    const pinch = resolveMove({ abilityId: 'grab-pincer' }, 1).attack!, g = resolveHit(req(player(), prey, pinch, { action: activeNow(act(newRuntime(), resolveMove({ abilityId: 'grab-pincer' }, 1))) }), 1)!;
    expect(g.outcome).toBe('grabbed'); expect(prey.health).toBe(18); expect(own.phase).toBe('interrupted');
  });
  it('held player breaks free by presses and flicks', () => {
    const rt = newRuntime(); rt.heldBy = 'e7';
    expect(addBreakProgress(rt, { basicPressed: true, dashPressed: false, flick: false })).toBe(false);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: true, flick: false })).toBe(false);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: false, flick: true })).toBe(false); expect(rt.breakProgress).toBeCloseTo(.8);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: false, flick: true })).toBe(true);   // .25 + .35 + .2 + .2
    expect(isFlick({ x: .7, y: 0, z: 0 }, { x: -.7, y: 0, z: .1 })).toBe(true); expect(isFlick({ x: .7, y: 0, z: 0 }, { x: 0, y: 0, z: .7 })).toBe(false);   // 90° exactly is not more
    expect(isFlick({ x: .5, y: 0, z: 0 }, { x: -.7, y: 0, z: 0 })).toBe(false);
    const c = crab(), g = activeNow(act(c.rt, speciesMove(WRAP))); g.phase = 'hold'; g.heldTarget = 'player';
    releaseHold(c.rt, g, rt, 4, true);
    expect(g.phase).toBe('recovery'); expect(rt.heldBy).toBeNull(); expect(rt.breakProgress).toBe(0); expect(rt.invulnerableUntil).toBeCloseTo(4.5);
  });
  it('squeeze ticks on the grabber clock', () => {
    const c = crab(), g = activeNow(act(c.rt, speciesMove(WRAP)));
    g.phase = 'hold'; g.phaseStartedAt = 1; c.rt.actionClock = 1.39;
    expect(squeezesDue(g, c.rt.actionClock)).toBe(0); c.rt.actionClock = 1.4; expect(squeezesDue(g, c.rt.actionClock)).toBe(1);   // every .4 s
    expect(squeezesDue(g, c.rt.actionClock)).toBe(0); c.rt.actionClock = 2.15; expect(squeezesDue(g, c.rt.actionClock)).toBe(1);   // the second at 1.8
    // A hit-stop on the grabber delays the squeeze: its clock does not advance.
    c.rt.hitStopUntil = 3; advanceClock(c.rt, 2.15, .5); expect(c.rt.actionClock).toBeCloseTo(2.15); expect(squeezesDue(g, c.rt.actionClock)).toBe(0);
  });
  it('hold ends when the grabber is staggered', () => {
    const p = player(), c = crab(), r = req(c, p, WRAP); resolveHit(r, 1);
    c.rt.actionClock = .2; tickAction(c.rt, r.action, .2, { wantedAim: null, held: false, bodyForward: { x: 0, y: 0, z: 1 } });   // active (.12 s) → hold
    expect(r.action.phase).toBe('hold');
    const q = player(), hit = resolveHit(req(q, c, { ...POKE, damageUnit: 'hp', damage: 6, poiseDamageMultiplier: 1 }), 2)!;   // poise 6: staggered
    expect(hit.outcome).toBe('hit'); expect(r.action.phase).toBe('recovery'); expect(r.action.heldTarget).toBeNull();
  });
  // ---- fix round 1 ----
  it('a Counter still counters while the target is invulnerable', () => {
    const p = player(), c = crab(); guard(p.rt, 'counter-spike'); p.rt.invulnerableUntil = 3;
    const e = resolveHit(req(c, p, POKE), 1)!;
    expect(e.outcome).toBe('countered'); expect(c.health).toBe(17);
    const off = player(); guard(off.rt, 'counter-spike'); off.rt.damageable = false;
    expect(resolveHit(req(crab(), off, POKE), 1)!.outcome).toBe('countered');
  });
  it('immunity comes before the Brace: no block, no guard break, no stagger, no damage', () => {
    const p = player(), b = guard(p.rt, 'brace-shell'); p.rt.invulnerableUntil = 3;
    const r = req(crab(), p, { ...POKE, damage: 6 }), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('immune'); expect(e.amount).toBe(0); expect(p.health).toBe(6);
    expect(b.phase).toBe('active'); expect(p.rt.staggerUntil).toBe(0); expect(p.rt.cooldowns.has(b.cooldownKey)).toBe(false);
    expect(p.rt.externalVelocity.z).toBe(0); expect(r.action.hitCounts.get(ledgerKey(r.action, 'g', 'player'))).toBe(1);
    const d = player(), db = guard(d.rt, 'brace-shell'); activeNow(act(d.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1)));
    expect(resolveHit(req(crab(), d, { ...POKE, damage: 6 }), 1)!.outcome).toBe('evaded'); expect(db.phase).toBe('active'); expect(d.rt.staggerUntil).toBe(0);
    const n = player(), nb = guard(n.rt, 'brace-shell'); n.rt.damageable = false;
    expect(resolveHit(req(crab(), n, { ...POKE, damage: 6 }), 1)!.outcome).toBe('immune'); expect(nb.phase).toBe('active');
  });
  it('a grab on a target that is already held does not hold it', () => {
    const p = player(); p.rt.heldBy = 'e8';
    const c = crab(), r = req(c, p, WRAP), e = resolveHit(r, 1)!;
    expect(e.held).toBe(false); expect(e.outcome).toBe('hit'); expect(p.rt.heldBy).toBe('e8'); expect(r.action.heldTarget).toBeNull();
  });
  it('a catch gives no impulse and no poise', () => {
    const p = player(), e = resolveHit(req(crab(), p, { ...WRAP, impulse: 4 }), 1)!;
    expect(e.outcome).toBe('grabbed'); expect(e.impulse).toEqual({ x: 0, y: 0, z: 0 }); expect(p.rt.externalVelocity).toEqual({ x: 0, y: 0, z: 0 });
    const prey = crab({ L: 1 }), pinch = resolveMove({ abilityId: 'grab-pincer' }, 1).attack!;
    resolveHit(req(player(), prey, { ...pinch, poiseDamageMultiplier: 1 }, { action: activeNow(act(newRuntime(), resolveMove({ abilityId: 'grab-pincer' }, 1))) }), 1);
    expect(prey.poise!.value).toBe(0); expect(prey.rt.staggerUntil).toBe(0);
  });
  it('player stagger: an unblocked hit staggers staggerSeconds; a blocked hit does not', () => {
    const p = player(); resolveHit(req(crab(), p, POKE), 1); expect(p.rt.staggerUntil).toBeCloseTo(.3);
    const b = player(); guard(b.rt, 'brace-shell'); expect(resolveHit(req(crab(), b, POKE), 1)!.outcome).toBe('blocked'); expect(b.rt.staggerUntil).toBe(0);
  });
  it('species stagger resistance .5 halves the stagger', () => {
    const c = crab({ staggerResist: .5 }), hit = { ...POKE, damageUnit: 'hp' as const, damage: 6, poiseDamageMultiplier: 1, staggerSeconds: .3 };
    resolveHit(req(player(), c, hit), 1); expect(c.rt.staggerUntil).toBeCloseTo(.15);
    const d = crab(); resolveHit(req(player(), d, hit), 1); expect(d.rt.staggerUntil).toBeCloseTo(.3);
  });
  it('killed: on a target kill and on a reflect kill', () => {
    const c = crab({ health: 4 }), e = resolveHit(req(player(), c, { ...POKE, damageUnit: 'hp', damage: 4 }), 1)!;
    expect(e.killed).toBe('e7');
    const alive = crab({ health: 5 }); expect(resolveHit(req(player(), alive, { ...POKE, damageUnit: 'hp', damage: 4 }), 1)!.killed).toBeNull();
    const p = player(); guard(p.rt, 'counter-spike'); const k = crab({ health: 3 });
    expect(resolveHit(req(k, p, POKE), 1)!.killed).toBe('e7');
    const q = player(); guard(q.rt, 'counter-spike'); expect(resolveHit(req(crab({ health: 4 }), q, POKE), 1)!.killed).toBeNull();
    const faint = player({ health: 1 }); expect(resolveHit(req(crab(), faint, POKE), 1)!.killed).toBeNull();   // a player faints; it is never `killed`
  });
  it('ink status is applied on a hit, not when blocked', () => {
    const inky = { ...POKE, statusEffectId: 'ink' }, statusOf = (id: string) => id === 'ink' ? { seconds: 2, speedFactor: .5 } : null;
    const p = player(), e = resolveHit(req(crab(), p, inky), 1, statusOf)!;
    expect(e.status).toBe('inked'); expect(p.rt.status).toEqual({ id: 'inked', until: 3, speedFactor: .5 });
    const b = player(); guard(b.rt, 'brace-shell'); const f = resolveHit(req(crab(), b, inky), 1, statusOf)!;
    expect(f.outcome).toBe('blocked'); expect(f.status).toBeNull(); expect(b.rt.status).toBeNull();
  });
  it('same attacker and start: requests are sorted by target id', () => {
    const c = crab(), a = activeNow(act(c.rt, speciesMove({ ...POKE, maxTargets: 2 }), 1));
    const x = req(c, player({ id: 'p2' }), POKE, { action: a }), y = req(c, player({ id: 'p1' }), POKE, { action: a });
    expect([x, y].sort(compareRequests).map(r => r.target.id)).toEqual(['p1', 'p2']);
    expect(compareRequests(x, x)).toBe(0);
  });
  it('hit-stop: a strike stops the attacker too; a blocked hit gives 60 ms', () => {
    const p = player(), c = crab(), e = resolveHit(req(c, p, POKE), 1)!;
    expect(e.hitStop).toBeCloseTo(.07); expect(c.rt.hitStopUntil).toBeCloseTo(1.07); expect(p.rt.hitStopUntil).toBeCloseTo(1.07);   // 2 half-hearts: 60 + 10 ms
    const b = player(), bc = crab(); guard(b.rt, 'brace-shell'); const f = resolveHit(req(bc, b, POKE), 1)!;
    expect(f.hitStop).toBeCloseTo(.06); expect(bc.rt.hitStopUntil).toBeCloseTo(1.06); expect(b.rt.hitStopUntil).toBeCloseTo(1.06);
    // A blocked hit that still deals 3 half-hearts is 60 ms, not the 80 ms of a 3-half-heart hit.
    const w = player(), wb = guard(w.rt, 'brace-shell'); wb.resolved = { ...wb.resolved, guard: { ...wb.resolved.guard!, blockFraction: .25, breakHalfHearts: 99 } };
    const h = resolveHit(req(crab(), w, { ...POKE, damage: 4 }), 1)!;
    expect(h.outcome).toBe('blocked'); expect(h.amount).toBe(3); expect(h.hitStop).toBeCloseTo(.06);
  });
  it('D14: Counter beats grab and Dash beats grab', () => {
    const p = player(), c = crab(); guard(p.rt, 'counter-spike'); const r = req(c, p, WRAP), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('countered'); expect(p.rt.heldBy).toBeNull(); expect(r.action.heldTarget).toBeNull(); expect(p.health).toBe(6);
    const d = player(); activeNow(act(d.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1)));
    const f = resolveHit(req(crab(), d, WRAP), 1)!;
    expect(f.outcome).toBe('evaded'); expect(d.rt.heldBy).toBeNull(); expect(d.health).toBe(6);
  });
  it('grace never shortens', () => {
    const p = player(); expect(resolveHit(req(crab(), p, POKE), 1)!.outcome).toBe('hit'); expect(p.rt.invulnerableUntil).toBeCloseTo(1.4);
    const rt = newRuntime(); rt.heldBy = 'e7'; rt.invulnerableUntil = 10;
    const c = crab(), g = activeNow(act(c.rt, speciesMove(WRAP))); g.phase = 'hold'; g.heldTarget = 'player';
    releaseHold(c.rt, g, rt, 4, true); expect(rt.invulnerableUntil).toBe(10);
  });
  it('a hold ended by the held fighter frees it in the resolver', () => {
    // The held player bites the grabber: poise 6 reached, the grabber is staggered, its hold ends, and the player is free.
    const p = player(), c = crab(), r = req(c, p, WRAP); resolveHit(r, 1); r.action.phase = 'hold';
    p.rt.breakProgress = .5;
    const bite = resolveHit(req(p, c, { ...POKE, damageUnit: 'hp', damage: 6, poiseDamageMultiplier: 1 }), 2)!;
    expect(bite.outcome).toBe('hit'); expect(r.action.phase).toBe('recovery'); expect(p.rt.heldBy).toBeNull(); expect(p.rt.breakProgress).toBe(0);
    // The held fighter counters a strike of its grabber: the counter staggers the grabber and frees the held fighter.
    const q = player(), k = crab(), w = req(k, q, WRAP); resolveHit(w, 1); w.action.phase = 'hold'; q.rt.breakProgress = .25;
    guard(q.rt, 'counter-spike'); q.rt.invulnerableUntil = 0;
    expect(resolveHit(req(k, q, POKE), 3)!.outcome).toBe('countered');
    expect(w.action.phase).toBe('interrupted'); expect(q.rt.heldBy).toBeNull(); expect(q.rt.breakProgress).toBe(0);
    // A third fighter's hit on the grabber ends the hold, but the resolver has no runtime of the held fighter: it stays for reconcileHolds.
    const h = player(), g = crab(), x = req(g, h, WRAP); resolveHit(x, 1); x.action.phase = 'hold';
    resolveHit(req(player({ id: 'p9' }), g, { ...POKE, damageUnit: 'hp', damage: 6, poiseDamageMultiplier: 1 }), 2);
    expect(x.action.phase).toBe('recovery'); expect(h.rt.heldBy).toBe('e7');
  });
});
