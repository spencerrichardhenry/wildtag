// tests/tiny-tide-core/combat-world.test.ts — the combat tick with the fixture catalog: starts, hits, kills, holds and the player's motion,
// and the plan-review rulings R2 (hull-front origin), R3 (pitch-clamped species aim), R4 (target origin), R5 (armed Counters),
// R17 (herbivore dispatch), R18 (one pose per entity per tick) and the T5 carry (reconcileHolds frees the other side).
import { describe, expect, it } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { activeStartedAt, stagger } from '../../src/tiny-tide/action-engine';
import { resetRuntime } from '../../src/tiny-tide/lifecycle';
import { AIM_PITCH_LIMIT, clampAimPitch } from '../../src/tiny-tide/combat-world';
import type { AttackSpec, Vec3, WorldShape } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { playerActorCached, playerBody, playerMoves } from '../../src/tiny-tide/sim';
import { POKE, WRAP, FX_HUNTER, FX_FLEER } from './combat-fixture';
import { AT_PLAYER, entity, speck, tick } from './combat-fixture-world';

const ahead = (d: number) => ({ x: 0, y: 1 - .35 * SIZES[1]!, z: d });   // a tier-1 entity's origin so that its hull centre is level with the Speck
const R1 = .35 * SIZES[1]!;   // a tier-1 hull radius
/** The target point for species attacks on the Speck: level with an `ahead` entity's hull centre, so the start aim is (0, 0, −1). */
const AT = { x: 0, y: 1, z: 0 };
const pitchOf = (v: Vec3) => Math.asin(v.y / Math.hypot(v.x, v.y, v.z));
describe('combat world', () => {
  it('a Bite on a combat species in front: windup, hit at active, HP down, hit-stop on both', () => {
    const s = speck(), crab = entity(1, FX_HUNTER, ahead(2.5));
    let now = 0, hit = null;
    const first = tick(s, [crab], now, { basicPressed: true, basicHeld: true, aim: { x: 0, y: 0, z: 1 } });
    expect(first.r.started).toEqual(['bite']); expect(first.r.chomp).toBe(false);
    for (let i = 0; i < 30 && !hit; i++) { now += 1 / 60; hit = tick(s, [crab], now).r.events[0] ?? null; }
    expect(hit).toMatchObject({ outcome: 'hit', targetId: 'e1', unit: 'hp', amount: 4 });   // Snapper at scale 1
    expect(crab.hp).toBe(16); expect(s.rt.hitStopUntil).toBeGreaterThan(now); expect(s.combat.stateOf(crab)!.rt.hitStopUntil).toBe(s.rt.hitStopUntil);
  });
  it('kills once and reports the kill', () => {
    const s = speck(), prey = entity(2, { ...FX_FLEER, hp: 3 }, { x: 0, y: .65, z: 2.1 });   // in front of the bite socket (z 1.61)
    tick(s, [prey], 0, { basicPressed: true, basicHeld: true });
    const kills: string[] = []; let now = 0;
    for (let i = 0; i < 40; i++) { now += 1 / 60; kills.push(...tick(s, [prey], now).r.killed.map(e => e.spec.key)); }
    expect(prey.hp).toBeLessThanOrEqual(0); expect(kills).toEqual(['0:fx_fleer']);
  });
  it('a species grab holds the player, squeezes on its clock, and a break-free releases it', () => {
    const s = speck(), squid = entity(3, FX_HUNTER, ahead(1.2)), c = s.combat.stateOf(squid)!;
    const a = s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    expect(typeof a).not.toBe('string');
    let now = 0; const before = s.run.health;
    for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.rt.heldBy).toBe('e3'); expect(s.run.health).toBe(before - .5);   // the catch: 1 half-heart
    const motion = s.combat.playerMotion(playerBody(s, playerActorCached(s)), RELEASED, now);
    expect(motion.forcedDisplacement).not.toBeNull(); expect(motion.speedFactor).toBe(1);
    for (let i = 0; i < 40; i++) { now += 1 / 60; tick(s, [squid], now); }   // active ends .12 s (+ .07 s hit-stop) after the catch; one squeeze at .4 s of hold
    expect(s.run.health).toBe(before - 1);
    for (let i = 0; i < 4; i++) { now += 1 / 60; tick(s, [squid], now, { basicPressed: true, basicHeld: true }); tick(s, [squid], now + .001); }
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.invulnerableUntil).toBeGreaterThan(now);   // 4 basic presses: 4 × .25
  });
  it('blocked grab motion ends the hold', () => {
    const s = speck(), squid = entity(4, FX_HUNTER, ahead(1.2)), c = s.combat.stateOf(squid)!;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0; for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.combat.onPlayerStep(s.rt, { status: 'blocked', progress: .6 }, now)).toBe(false); expect(s.rt.heldBy).toBe('e4');
    expect(s.combat.onPlayerStep(s.rt, { status: 'blocked', progress: .4 }, now)).toBe(true); expect(s.rt.heldBy).toBeNull();
    expect(c.rt.actions[0]!.phase).toBe('recovery');   // a catch released in its active phase recovers at once
  });
  it('a dash replaces the controlled velocity, keeps .3 of it at the end, and evades a strike', () => {
    const s = speck(), crab = entity(5, FX_HUNTER, ahead(2.2)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0, outcome = '';
    for (let i = 0; i < 60 && !outcome; i++) {
      now += 1 / 60;
      const r = tick(s, [crab], now, i === 25 ? { activePressed: [true, false, false, false] } : {}).r;   // slot 1 is Dash (the Paddle tail)
      if (i === 28) expect(s.combat.playerMotion(playerBody(s, playerActorCached(s)), RELEASED, now).dashVelocity).not.toBeNull();
      outcome = r.events[0]?.outcome ?? '';
    }
    expect(outcome).toBe('evaded');
  });
  it('speed factors multiply: a bite windup, a stagger and ink', () => {
    const s = speck(), body = () => playerBody(s, playerActorCached(s));
    s.rt.status = { id: 'inked', until: 10, speedFactor: .7 }; s.rt.staggerUntil = 5;
    expect(s.combat.playerMotion(body(), RELEASED, 0).speedFactor).toBeCloseTo(.35);   // .7 × .5
    expect(s.combat.playerMotion(body(), RELEASED, 11).speedFactor).toBeCloseTo(.5);
  });
});

describe('species shape origin and aim (review R2, R3, R4)', () => {
  it('R2: an input or fixed-at-start shape starts at the hull front; a centre shape at the hull centre; the claw point uses the same origin', () => {
    const s = speck(), crab = entity(10, FX_HUNTER, ahead(6)), c = s.combat.stateOf(crab)!;
    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string') throw new Error(a);
    const [cone] = s.combat.speciesShapes(c, a, 0);
    expect(cone).toMatchObject({ kind: 'cone', apex: { x: 0, y: expect.closeTo(1, 9), z: expect.closeTo(6 - R1, 9) } });
    const fixed = { ...POKE, id: 'poke-fixed', aimMode: 'fixed-at-start' as const, aimLockAtSeconds: 0 }, f = s.combat.startSpecies(s.combat.stateOf(entity(11, FX_HUNTER, ahead(6)))!, 'poke-fixed', fixed, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof f === 'string') throw new Error(f);
    expect(f.lockedShapes![0]).toMatchObject({ kind: 'cone', apex: { z: expect.closeTo(6 - R1, 9) } });
    s.combat.director.releaseAll();   // two wind-ups at the player hold both tokens (spec §9.4): free them for a third
    const burst: AttackSpec = { ...POKE, id: 'burst', aimMode: 'centre', aimLockAtSeconds: 0, shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 1.6 } };
    const b = s.combat.startSpecies(s.combat.stateOf(entity(12, FX_HUNTER, ahead(6)))!, 'burst', burst, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof b === 'string') throw new Error(b);
    expect(b.lockedShapes![0]).toMatchObject({ kind: 'capsule', start: { z: expect.closeTo(6, 9) } });
    expect(s.combat.clawPoint(c, a, 2, 0).z).toBeCloseTo(6 - R1 - .5 * 2, 9);   // front − CLAW_REACH × L_t
  });
  it('R3: the aim at start points at the target with the pitch clamped to ±.6 rad, ground species included', () => {
    const s = speck(), crab = entity(13, FX_HUNTER, ahead(6)), c = s.combat.stateOf(crab)!;   // FX_HUNTER moves on the ground
    expect(c.entity.spec.movementProfileId).toBe('sp-ground');
    const centre = { x: 0, y: 1, z: 6 };
    const low = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: { x: 0, y: 1 - 2, z: 6 - 4 } });
    if (typeof low === 'string') throw new Error(low);
    expect(pitchOf(low.aim)).toBeCloseTo(-Math.atan2(2, 4), 6);
    const steep = s.combat.startSpecies(s.combat.stateOf(entity(14, FX_HUNTER, ahead(6)))!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: { x: 0, y: centre.y - 10, z: 5 } });
    if (typeof steep === 'string') throw new Error(steep);
    expect(pitchOf(steep.aim)).toBeCloseTo(-AIM_PITCH_LIMIT, 9);
    expect(pitchOf(clampAimPitch({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }))).toBeCloseTo(AIM_PITCH_LIMIT, 9);
  });
  it('R3: a ground attacker on a ledge tracks down and its narrow cone reaches a player lower on the seabed', () => {
    // The hull centre is 2.5 above and 4.5 ahead of the Speck: the direction pitches down by .51 rad. A level cone of 8° misses.
    const narrow: AttackSpec = { ...POKE, id: 'narrow', shape: { kind: 'cone', range: 1.2, halfAngle: 8 * Math.PI / 180 }, maxTrackingRadiansPerSecond: 2.5 };
    const run = (track: boolean) => {
      const s = speck(), crab = entity(15, FX_HUNTER, { x: 0, y: 1 + 2.5 - R1, z: 4.5 + 1 }), c = s.combat.stateOf(crab)!;
      s.combat.startSpecies(c, 'narrow', narrow, { x: 0, y: 0, z: -1 }, track ? 'player' : null, 0, { ...AT_PLAYER, targetAt: { x: 0, y: 1 + 2.5, z: 0 } });   // a level target point: the start aim is level, the tracking turns it down
      let now = 0, outcome = '';
      for (let i = 0; i < 50 && !outcome; i++) { now += 1 / 60; outcome = tick(s, [crab], now).r.events[0]?.outcome ?? ''; }
      return outcome;
    };
    expect(run(true)).toBe('hit');
    expect(run(false)).toBe('');   // the same cone kept level (no target to track) misses
  });
  it('R4: a target-origin attack is centred on the target point at wind-up start and stays there', () => {
    const s = speck(), mother = entity(16, FX_HUNTER, ahead(9)), c = s.combat.stateOf(mother)!;
    const emerge: AttackSpec = { ...POKE, id: 'emerge', aimMode: 'fixed-at-start', aimLockAtSeconds: 0, origin: 'target', blockable: false, telegraphProfileId: 'red-coil',
      shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: .35 } };
    const at = { x: .4, y: 1, z: .3 }, a = s.combat.startSpecies(c, 'emerge', emerge, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: at });
    if (typeof a === 'string') throw new Error(a);
    expect(a.lockedShapes![0]).toMatchObject({ kind: 'capsule', start: at, end: at });
    mother.z = 20;   // the attacker moves away: the shape stays at the target point
    expect(s.combat.speciesShapes(c, a, 0)[0]).toMatchObject({ start: at });
    let now = 0, outcome = '';
    for (let i = 0; i < 60 && !outcome; i++) { now += 1 / 60; outcome = tick(s, [mother], now).r.events[0]?.outcome ?? ''; }
    expect(outcome).toBe('hit');
  });
});

describe('armed Counters (review R5)', () => {
  it('a Counter open at a lunge\'s active start counters the lunge\'s contact .2 s later, after the window closed', () => {
    const lunge: AttackSpec = { ...POKE, id: 'lunge', shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1.4 }, radius: .22 }, lunge: { distanceBodyLengths: 1.2 },
      windupSeconds: .6, aimLockAtSeconds: .35, activeSeconds: .3, interruptible: false };
    const s = speck([{ id: 'spike', t: .5, angle: 0, scale: 1, mirror: false }]), crab = entity(20, FX_HUNTER, ahead(8)), c = s.combat.stateOf(crab)!;
    const a = s.combat.startSpecies(c, 'lunge', lunge, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string') throw new Error(a);
    let now = 0; const events: string[] = [];
    for (let i = 1; i <= 60; i++) {
      now = i / 60;
      const press = i === 30 ? { activePressed: [true, false, false, false] as [boolean, boolean, boolean, boolean] } : {};   // slot 1 is Counter (the Spike); window .54–.76 s
      if (i === 48) a.lungeDone = 1.2;   // the ecosystem moved the crab the whole lunge: the contact comes at .8 s
      events.push(...tick(s, [crab], now, press).r.events.map(e => `${i}:${e.outcome}`));
      if (i === 40) expect(a.phase).toBe('active');
    }
    expect(events).toEqual(['48:countered']);
  });
});

describe('holds end on both sides (T5 carry: reconcileHolds)', () => {
  const claw = { id: 'claw_pincer', t: .2, angle: Math.PI / 2 + .5, scale: 1, mirror: true };
  /** A Speck with a Pincer that holds a fixture prey in front of it. */
  function playerHolds() {
    const s = speck([claw]), prey = entity(30, { ...FX_FLEER, hp: 99 }, { x: 0, y: .65, z: 2 }), c = s.combat.stateOf(prey)!;
    let now = 0;
    for (let i = 0; i < 40 && c.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [prey], now, i === 0 ? { activePressed: [false, true, false, false] } : {}); }   // slot 2 is Grab
    expect(c.rt.heldBy).toBe('player');
    return { s, prey, c, now };
  }
  function speciesHolds(hp = 20) {
    const s = speck(), squid = entity(31, { ...FX_HUNTER, hp }, ahead(1.2)), c = s.combat.stateOf(squid)!;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0; for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.rt.heldBy).toBe('e31');
    s.rt.breakProgress = .5;
    return { s, squid, c, now };
  }
  it('a stagger by a third fighter ends the player\'s hold: the held species is free', () => {
    const { s, prey, c, now } = playerHolds();
    c.rt.breakProgress = .4;
    stagger(s.rt, .5);   // a hit by another fighter, outside this request
    tick(s, [prey], now + 1 / 60);
    expect(c.rt.heldBy).toBeNull(); expect(c.rt.breakProgress).toBe(0);
  });
  it('a grabber that despawns frees the player', () => {
    const { s, now } = speciesHolds();
    tick(s, [], now + 1 / 60);
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0);
  });
  it('a grabber that dies frees the player', () => {
    const { s, squid, now } = speciesHolds(1);
    let t = now;
    while (t < s.rt.hitStopUntil) tick(s, [squid], t += 1 / 60);   // the catch's hit-stop ends first
    expect(tick(s, [squid], t += 1 / 60, { basicPressed: true, basicHeld: true }).r.started).toEqual(['bite']);   // a held player may Bite
    for (let i = 0; i < 30 && squid.hp > 0; i++) tick(s, [squid], t += 1 / 60);
    expect(squid.hp).toBeLessThanOrEqual(0); expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0);
  });
  it('a Bite pressed in the catch\'s hit-stop is buffered and starts when the hit-stop ends, while still held', () => {
    const { s, squid, now } = speciesHolds();
    expect(now).toBeLessThan(s.rt.hitStopUntil);
    let t = now;
    expect(tick(s, [squid], t += 1 / 60, { basicPressed: true, basicHeld: true }).r.started).toEqual([]);
    expect(s.rt.buffered).toMatchObject({ input: 'basic' });
    const started: string[] = [];
    while (t < s.rt.hitStopUntil + 1 / 30) started.push(...tick(s, [squid], t += 1 / 60).r.started);
    expect(started).toEqual(['bite']); expect(s.rt.heldBy).toBe('e31');
  });
  it('a hold that runs out frees the player', () => {
    const { s, squid, c, now } = speciesHolds();
    let t = now;
    for (let i = 0; i < 120 && c.rt.actions[0]?.phase !== 'recovery'; i++) tick(s, [squid], t += 1 / 60);
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0);
  });
  it('a player reset while held (a faint) ends the species hold: the grabber recovers', () => {
    const { s, squid, c, now } = speciesHolds();
    resetRuntime(s.rt);
    tick(s, [squid], now + 1 / 60);
    expect(c.rt.actions[0]!.heldTarget).toBeNull(); expect(c.rt.actions[0]!.phase).toBe('recovery');
  });
  it('a held prey that despawns ends the player\'s grab', () => {
    const { s, now } = playerHolds();
    tick(s, [], now + 1 / 60);
    expect(s.rt.actions.find(a => a.heldTarget !== null)).toBeUndefined();
  });
  it('a grabber staggered outside a request (a reset of its runtime) frees the player', () => {
    const { s, squid, c, now } = speciesHolds();
    stagger(c.rt, 1, true);
    tick(s, [squid], now + 1 / 60);
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.breakProgress).toBe(0);
  });
});

describe('the basic dispatch by diet (review R17)', () => {
  const inCone = (id: number) => entity(id, FX_HUNTER, ahead(3));
  it('a carnivore Bites any combat species in the cone', () => {
    expect(tick(speck(), [inCone(40)], 0, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: ['bite'], chomp: false });
  });
  it('a herbivore chomps unless the species is engaged with it', () => {
    const calm = inCone(41);
    expect(tick(speck([], 'mouth_nibbler'), [calm], 0, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: [], chomp: true });
    const hunting = { ...inCone(42), mode: 'hunt' as const };
    expect(tick(speck([], 'mouth_nibbler'), [hunting], 0, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: ['bite'], chomp: false });
    const s = speck([], 'mouth_nibbler'), winding = inCone(43);
    s.combat.startSpecies(s.combat.stateOf(winding)!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });   // an action that targets the player
    expect(tick(s, [winding], 0, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: ['bite'], chomp: false });
  });
  it('a herbivore Bites a species that hit it in the last few seconds, and chomps again after', () => {
    const s = speck([], 'mouth_nibbler'), crab = inCone(44), c = s.combat.stateOf(crab)!;
    c.lastAttackedPlayerAt = 10;
    expect(tick(s, [crab], 11, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: ['bite'], chomp: false });
    const t = speck([], 'mouth_nibbler'), later = inCone(45); t.combat.stateOf(later)!.lastAttackedPlayerAt = 10;
    expect(tick(t, [later], 20, { basicPressed: true, basicHeld: true }).r).toMatchObject({ started: [], chomp: true });
  });
  it('a species that hits the player is marked as engaged', () => {
    const s = speck([], 'mouth_nibbler'), crab = entity(46, FX_HUNTER, ahead(2.2)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0; for (let i = 0; i < 40 && c.lastAttackedPlayerAt < 0; i++) { now += 1 / 60; tick(s, [crab], now); }
    expect(c.lastAttackedPlayerAt).toBeCloseTo(now, 9);
  });
});

describe('engagement counts every contact (review R17, T8a review Minor 1)', () => {
  it('a blocked contact marks the species as engaged', () => {
    const s = speck([{ id: 'shell_plate', t: .55, angle: 0, scale: 1, mirror: false }], 'mouth_nibbler'), crab = entity(47, FX_HUNTER, ahead(2.2)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    const brace = { activeHeld: [true, false, false, false] as [boolean, boolean, boolean, boolean] };   // slot 1 is Brace (the Shell plate)
    let now = 0, outcome = '';
    for (let i = 0; i < 40 && !outcome; i++) { now += 1 / 60; outcome = tick(s, [crab], now, i === 0 ? { ...brace, activePressed: [true, false, false, false] } : brace).r.events[0]?.outcome ?? ''; }
    expect(outcome).toBe('blocked'); expect(c.lastAttackedPlayerAt).toBeCloseTo(now, 9);
    c.rt.actions.length = 0;   // the attack is over: only the recent contact engages it
    expect(s.combat.engaged(c, now + 2)).toBe(true); expect(s.combat.engaged(c, now + 4)).toBe(false);
  });
});

describe('species starts need a target point (T8a review Minors 3 and 4)', () => {
  it('refuses an attack on the player or a target-origin attack without the target point', () => {
    const s = speck(), c = s.combat.stateOf(entity(60, FX_HUNTER, ahead(6)))!;
    expect(s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0)).toBe('no-target');
    const emerge: AttackSpec = { ...POKE, id: 'emerge', aimMode: 'fixed-at-start', aimLockAtSeconds: 0, origin: 'target' };
    expect(s.combat.startSpecies(c, 'emerge', emerge, { x: 0, y: 0, z: -1 }, null, 0)).toBe('no-target');
    expect(c.rt.actions).toEqual([]);
    expect(typeof s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, null, 0)).toBe('object');   // no target: the given aim
  });
});

describe('poses per tick (review R18)', () => {
  it('a pose read outside a tick is fresh after the entity moved', () => {
    const s = speck(), crab = entity(52, FX_HUNTER, ahead(6)), c = s.combat.stateOf(crab)!;
    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string') throw new Error(a);
    tick(s, [crab], 1 / 60);
    const z0 = (s.combat.speciesShapes(c, a, 0)[0] as Extract<WorldShape, { kind: 'cone' }>).apex.z;
    crab.z += 3;
    expect((s.combat.speciesShapes(c, a, 0)[0] as Extract<WorldShape, { kind: 'cone' }>).apex.z).toBeCloseTo(z0 + 3, 9);
  });
  it('samples each live combat entity\'s pose once per tick, however many users ask', () => {
    const s = speck(), a = entity(50, FX_HUNTER, ahead(2.5)), b = entity(51, FX_HUNTER, { ...ahead(3), x: 1 }), c = s.combat.stateOf(b)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0;
    for (let i = 0; i < 30; i++) {
      now += 1 / 60;
      const before = s.combat.poseSamples;
      tick(s, [a, b], now, i === 0 ? { basicPressed: true, basicHeld: true } : {});
      expect(s.combat.poseSamples - before, `tick ${i}`).toBeLessThanOrEqual(2);
    }
  });
});

describe('a slot press next to a same-tick basic press (T7 carry)', () => {
  const crab = (id: number) => entity(id, FX_HUNTER, ahead(2.5));
  const both = (slot: 0 | 1 | 2 | 3) => { const p: [boolean, boolean, boolean, boolean] = [false, false, false, false]; p[slot] = true; return { basicPressed: true, basicHeld: true, activePressed: p }; };
  it('an empty slot press does not swallow the Bite', () => {
    const s = speck(); expect(playerMoves(s).slots.slots[3]).toBeNull();
    expect(tick(s, [crab(60)], 0, both(3)).r).toMatchObject({ started: ['bite'], chomp: false });
  });
  it('a slot press on cooldown does not swallow the Bite', () => {
    const s = speck(), dash = playerMoves(s).set.byKind.dash!; expect(playerMoves(s).slots.slots[0]).toBe('dash');
    s.rt.cooldowns.set(`player:${dash.partUid}:${dash.grantId}`, 99);
    expect(tick(s, [crab(61)], 0, both(0)).r).toMatchObject({ started: ['bite'], chomp: false });
  });
  it('an empty slot press does not swallow the chomp fallback', () => {
    expect(tick(speck(), [], 0, both(2)).r).toMatchObject({ started: [], chomp: true });
  });
  it('a slot move that starts suppresses the basic input for that tick only', () => {
    const s = speck();
    expect(tick(s, [crab(62)], 0, both(0)).r).toMatchObject({ started: ['dash'], chomp: false });
    expect(s.rt.buffered).toBeNull();   // the Bite is not buffered behind the Dash either
  });
});

describe('a bracing phone player turns toward the move stick (review R16, T10)', () => {
  it('with aim source none the Brace faces the move wish at the guard yaw rate; a real aim still wins; no wish keeps the aim', () => {
    const s = speck([{ id: 'shell_plate', t: .55, angle: 0, scale: 1, mirror: false }]), held = [true, false, false, false] as [boolean, boolean, boolean, boolean];
    tick(s, [], 0, { activeHeld: held, activePressed: held });
    expect(s.rt.actions.some(a => a.resolved.guard?.kind === 'brace')).toBe(true);
    const body = playerBody(s, playerActorCached(s)), facing = { x: 0, y: 0, z: 1 }, right = { x: 1, y: 0, z: 0 };
    const none = s.combat.playerMotion(body, { ...RELEASED, aim: facing, aimSource: 'none', activeHeld: held }, 1 / 60, right).face!;
    expect(none.dir).toEqual(right); expect(none.yawRateFactor).toBeLessThan(1);
    const pointer = s.combat.playerMotion(body, { ...RELEASED, aim: facing, aimSource: 'pointer', activeHeld: held }, 1 / 60, right).face!;
    expect(pointer.dir).toEqual(facing);
    const auto = s.combat.playerMotion(body, { ...RELEASED, aim: { x: -1, y: 0, z: 0 }, aimSource: 'auto', activeHeld: held }, 1 / 60, right).face!;
    expect(auto.dir).toEqual({ x: -1, y: 0, z: 0 });   // an auto-aim candidate (a wind-up attacker) wins over the stick
    const still = s.combat.playerMotion(body, { ...RELEASED, aim: facing, aimSource: 'none', activeHeld: held }, 1 / 60, { x: 0, y: 0, z: 0 }).face!;
    expect(still.dir).toEqual(facing);
  });
});

describe('director tokens (spec §9.4, plan review R6)', () => {
  const at = (i: number) => ({ ...ahead(5), x: 1.5 * i });   // out of reach of the Speck: no contact
  /** Ticks (length `dt`) to `until` and returns each action's active start in game time (fix round 1: the spacing rule is defined in
   *  game time, read from the action clock; a frame-based observer may see up to one tick less). */
  function run(s: ReturnType<typeof speck>, ents: ReturnType<typeof entity>[], from: number, until: number, each?: (now: number, i: number) => void, dt = 1 / 60) {
    const entered = new Map<string, number>(); let now = from, i = 0;
    while (now < until - 1e-9) {
      now += dt; i++; tick(s, ents, now, {}, dt);
      for (const e of ents) { const rt = s.combat.stateOf(e)!.rt; for (const a of rt.actions) if (a.phase === 'active' && !entered.has(a.instanceId)) entered.set(a.instanceId, activeStartedAt(rt, a, now)!); }
      each?.(now, i);
    }
    return entered;
  }
  it('wind-ups at the player take director tokens: two at most, active starts .25 s apart, returned at the end of active', () => {
    const s = speck(), ents = [1, 2, 3].map(i => entity(10 + i, FX_HUNTER, ahead(4 + i))), cs = ents.map(e => s.combat.stateOf(e)!);
    const a = s.combat.startSpecies(cs[0]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT }), b = s.combat.startSpecies(cs[1]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    expect(typeof a).not.toBe('string'); expect(typeof b).not.toBe('string');
    if (typeof b === 'string') return;
    expect(b.windupExtension).toBeCloseTo(.25);   // both would be active at .5
    expect(s.combat.startSpecies(cs[2]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT })).toBe('token');
    expect(cs[2]!.rt.actions).toEqual([]); expect(cs[2]!.tokenRetryAt).toBeCloseTo(.2, 9);
    let now = 0; for (let i = 0; i < 45; i++) { now += 1 / 60; tick(s, ents, now); }   // .75 s: the first is past its active (.5–.62)
    expect(s.combat.director.tokens).toHaveLength(1); expect(s.rt.lastThreatAt).toBeGreaterThan(0);
    s.combat.cancelAttacksOnPlayer(s.rt); expect(s.combat.director.tokens).toEqual([]);
    expect(cs[1]!.rt.actions.every(x => x.phase === 'interrupted')).toBe(true);
    expect(cs[1]!.rt.cooldowns.get('e12:root:poke')!).toBeLessThanOrEqual(cs[1]!.rt.actionClock + 1e-9);   // a faint or evolve spends no cooldown
  });
  it('active starts are .25 s apart in game time at a 30 Hz and a 20 Hz tick (fix round 1)', () => {
    for (const dt of [1 / 30, .05]) {
      const s = speck(), ents = [entity(80, FX_HUNTER, at(0)), entity(81, FX_HUNTER, at(1))], [ca, cb] = ents.map(e => s.combat.stateOf(e)!);
      const a = s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT, tick: dt });
      const b = s.combat.startSpecies(cb!, 'poke', { ...POKE, windupSeconds: .53 }, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT, tick: dt });
      if (typeof a === 'string' || typeof b === 'string') throw new Error('refused');
      const entered = run(s, ents, 0, 1.5, undefined, dt);
      expect(entered.get(b.instanceId)! - entered.get(a.instanceId)!, `dt ${dt}`).toBeGreaterThanOrEqual(.25 - 1e-9);
    }
  });
  it('a start at the player without its context (onScreen, playerHeld, tick) is refused', () => {
    const s = speck(), c = s.combat.stateOf(entity(82, FX_HUNTER, at(0)))!;
    expect(s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { targetAt: AT })).toBe('no-context');
    expect(s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { targetAt: AT, onScreen: true, playerHeld: false })).toBe('no-context');
    expect(c.rt.actions).toEqual([]); expect(s.combat.director.tokens).toEqual([]);
    expect(typeof s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, null, 0)).toBe('object');   // not at the player: no context needed
  });
  it('reset returns every token', () => {
    const s = speck(), c = s.combat.stateOf(entity(83, FX_HUNTER, at(0)))!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    expect(s.combat.director.tokens).toHaveLength(1);
    s.combat.reset(); expect(s.combat.director.tokens).toEqual([]);
  });
  it('an attacker eaten in its wind-up: the action ends and its token returns; after the respawn it has no running action (fix round 1)', () => {
    const s = speck(), crab = entity(84, FX_HUNTER, at(0)), c = s.combat.stateOf(crab)!;
    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string') throw new Error(a);
    tick(s, [crab], 1 / 60);
    crab.eaten = true;   // eco.consume on some path that does not forget the combat state
    tick(s, [crab], 2 / 60);
    expect(a.phase).toBe('interrupted'); expect(s.combat.director.tokens).toEqual([]);
    expect(c.rt.cooldowns.get('e84:root:poke')!).toBeLessThanOrEqual(c.rt.actionClock + 1e-9);
    crab.eaten = false;   // the respawn reuses the same Entity object
    let now = 2 / 60; for (let i = 0; i < 40; i++) tick(s, [crab], now += 1 / 60);
    expect(s.combat.stateOf(crab)!.rt.actions.filter(x => x.phase !== 'interrupted')).toEqual([]);
    expect(s.combat.director.tokens).toEqual([]);
  });
  it('R6: the grant estimate adds one tick (the action starts on the next combat tick); an attacker\'s hit-stop moves its estimate', () => {
    const s = speck(), ents = [entity(70, FX_HUNTER, at(0)), entity(71, FX_HUNTER, at(1))], [ca, cb] = ents.map(e => s.combat.stateOf(e)!);
    const a = s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT }), b = s.combat.startSpecies(cb!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string' || typeof b === 'string') throw new Error('refused');
    expect(s.combat.director.tokens.map(t => t.activeStart)).toEqual([expect.closeTo(.5 + 1 / 60, 9), expect.closeTo(.75 + 1 / 60, 9)]);
    // A hit on the first attacker after the tick at .2 s freezes its clock for .1 s: its active start moves to .6, the second wind-up grows
    // by .1 (the budget allows it) so that the active starts stay .25 s apart.
    const entered = run(s, ents, 0, 1.2, (now, i) => {
      if (i === 12) ca!.rt.hitStopUntil = now + .1 + 1 / 60;
      if (i === 13) expect(s.combat.director.tokens.map(t => t.activeStart)).toEqual([expect.closeTo(.6 + 1 / 60, 9), expect.closeTo(.85 + 1 / 60, 9)]);
    });
    expect(b.windupExtension).toBeCloseTo(.35, 9);
    expect(entered.get(b.instanceId)! - entered.get(a.instanceId)!).toBeGreaterThanOrEqual(.25 - 1e-9);
    expect(entered.get(b.instanceId)! - entered.get(a.instanceId)!).toBeCloseTo(.25, 9);   // in game time, exactly the gap
  });
  it('R6 (probe P8): when the spacing needs more than the .5 s extension, the later wind-up ends; its token returns and its cooldown is not spent', () => {
    const QUICK: AttackSpec = { ...POKE, id: 'quick', windupSeconds: .25, aimLockAtSeconds: .1 };
    const s = speck(), ents = [entity(72, FX_HUNTER, at(0)), entity(73, FX_HUNTER, at(1))], [ca, cb] = ents.map(e => s.combat.stateOf(e)!);
    const a = s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    // Off-screen: .6 s at least (ext .35); then .25 s after the first (ext .5): the whole extension budget is spent.
    const b = s.combat.startSpecies(cb!, 'quick', QUICK, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT, onScreen: false });
    if (typeof a === 'string' || typeof b === 'string') throw new Error('refused');
    expect(b.windupExtension).toBeCloseTo(.5, 9);
    let cancelledAt = -1;
    const entered = run(s, ents, 0, 1.2, (now, i) => {
      if (i === 12) ca!.rt.hitStopUntil = now + .05 + 1 / 60;   // the first moves to .55: the two would be active .2 s apart
      if (cancelledAt < 0 && !cb!.rt.actions.length) cancelledAt = now;
    });
    expect(cancelledAt).toBeCloseTo(13 / 60, 9);
    expect(entered.has(b.instanceId)).toBe(false); expect(entered.has(a.instanceId)).toBe(true);
    expect(s.combat.director.holds(b.instanceId)).toBe(false);
    expect(cb!.rt.cooldowns.get('e73:root:quick')!).toBeLessThanOrEqual(13 / 60 + 1e-9);   // no cooldown: the AI may ask again
    expect(cb!.tokenRetryAt).toBeCloseTo(13 / 60 + .2, 9);
  });
  it('a retry waits .2 s; off-screen wind-ups last .6 s at least; no token while the player is held', () => {
    const s = speck(), ents = [entity(74, FX_HUNTER, at(0)), entity(75, FX_HUNTER, at(1))], [ca, cb] = ents.map(e => s.combat.stateOf(e)!);
    expect(s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT, playerHeld: true })).toBe('token');
    expect(s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', .1, { ...AT_PLAYER, targetAt: AT })).toBe('token');   // before .2
    const off = s.combat.startSpecies(ca!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', .2, { ...AT_PLAYER, targetAt: AT, onScreen: false });
    if (typeof off === 'string') throw new Error(off);
    expect(off.windupExtension).toBeCloseTo(.1, 9);
    expect(typeof s.combat.startSpecies(cb!, 'poke', POKE, { x: 0, y: 0, z: -1 }, null, .2)).toBe('object');   // no player target: no token
    expect(s.combat.director.tokens).toHaveLength(1);
  });
  it('a grab holds its token through the hold and returns it at recovery', () => {
    const s = speck(), squid = entity(76, FX_HUNTER, ahead(1.2)), c = s.combat.stateOf(squid)!;
    const a = s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    if (typeof a === 'string') throw new Error(a);
    const phases: string[] = []; let now = 0;
    for (let i = 0; i < 150 && a.phase !== 'interrupted'; i++) {
      now += 1 / 60; tick(s, [squid], now);
      if (a.phase === 'hold') expect(s.combat.director.holds(a.instanceId)).toBe(true);
      if (a.phase === 'recovery') expect(s.combat.director.holds(a.instanceId)).toBe(false);
      if (phases.at(-1) !== a.phase) phases.push(a.phase);
    }
    expect(phases).toContain('hold'); expect(phases).toContain('recovery');
  });
});
