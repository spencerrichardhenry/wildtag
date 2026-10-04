// tests/tiny-tide-core/combat-world.test.ts — the combat tick with the fixture catalog: starts, hits, kills, holds and the player's motion,
// and the plan-review rulings R2 (hull-front origin), R3 (pitch-clamped species aim), R4 (target origin), R5 (armed Counters),
// R17 (herbivore dispatch), R18 (one pose per entity per tick) and the T5 carry (reconcileHolds frees the other side).
import { describe, expect, it } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { activeStartedAt, stagger } from '../../src/tiny-tide/action-engine';
import { resetRuntime } from '../../src/tiny-tide/lifecycle';
import { AIM_PITCH_LIMIT, clampAimPitch, CombatWorld } from '../../src/tiny-tide/combat-world';
import type { AttackSpec, CombatInput, Vec3, WorldShape } from '../../src/tiny-tide/combat-types';
import type { Entity } from '../../src/tiny-tide/ecosystem';
import { RELEASED } from '../../src/tiny-tide/input';
import { playerActorCached, playerBody, playerMoves } from '../../src/tiny-tide/sim';
import { POKE, WRAP, SMASH, FX_BEHAVIOURS, FX_HUNTER, FX_FLEER } from './combat-fixture';
import { AT_PLAYER, entity, speck, tick } from './combat-fixture-world';
import { BEHAVIOURS, SPECIES_ATTACKS } from '../../src/tiny-tide/bestiary';
import { forwardReach, sphereHitsShape } from '../../src/tiny-tide/combat-shapes';
import { speciesCombatPose } from '../../src/tiny-tide/mount';
import { SPECIES, type Species } from '../../src/tiny-tide/species';
import { WINDUP_FLASH } from '../../src/tiny-tide/combat-world';
import { FLASH_LEAD_SECONDS } from '../../src/tiny-tide/combat-profiles';
import { outlineGeometry, telegraphMatrix, unitGeometry } from '../../src/tiny-tide/telegraph-view';
import { EdgeArrowMemory } from '../../src/tiny-tide/combat-hud';
import * as T from 'three';

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
  // Final review I2: the Bite cone starts at the hull centre and its range adds the centre-to-mouth distance, so a creature pressed against
  // the player (under or beside the mouth) is still Bitten; before, a gap of 0–.1 L dispatched a chomp.
  it('a Bite reaches a combat species touching the player, straight ahead and 30° off', () => {
    for (const [gapL, deg] of [[0, 0], [.1, 0], [0, 30], [.1, 30]] as const) {
      // A size-1 Speck (stage 1) and a size-1 crab (its hull radius .14 of the Speck's L): the review's case.
      const s = speck(); s.run.stage = 1; s.actorCache = null; s.combat = new CombatWorld();   // the real behaviours (the crab is a combat species)
      const actor = playerActorCached(s), body = playerBody(s, actor), L = body.L, pr = Math.max(...actor.hull.map(h => h.radius)), c = body.centre;
      const spec = SPECIES.find(x => x.key === '1:crab')!, r = speciesCombatPose(entity(9, spec, c), 0).hull[0]!.radius;
      const a = deg * Math.PI / 180, d = pr + r + gapL * L, crab = entity(9, spec, { x: c.x + Math.sin(a) * d, y: c.y - r, z: c.z + Math.cos(a) * d });
      const hc = speciesCombatPose(crab, 0).hull[0]!.start, n = Math.hypot(hc.x - c.x, hc.y - c.y, hc.z - c.z), aim = { x: (hc.x - c.x) / n, y: (hc.y - c.y) / n, z: (hc.z - c.z) / n };
      const first = tick(s, [crab], 0, { basicPressed: true, basicHeld: true, aim });
      expect(first.r.started, `gap ${gapL} L, ${deg}°`).toEqual(['bite']); expect(first.r.chomp).toBe(false);
      let now = 0, hit = null;
      for (let i = 0; i < 40 && !hit; i++) { now += 1 / 60; hit = tick(s, [crab], now, { aim }).r.events[0] ?? null; }
      expect(hit, `gap ${gapL} L, ${deg}°`).toMatchObject({ outcome: 'hit', targetId: 'e9' });
    }
  });
  // Fix round 3 (re-review Important 1): the centre apex reached 1.07 L past the rear of the hull, so a Bite hit a crab touching the body from
  // behind with no turn. The hit cone starts at the hull centre only when the aim is within the half angle (+ 10°) of the body's yaw; else it
  // starts at the mouth. A rear Bite still starts (the body turns toward it) but hits nothing while the body faces away.
  it('a Bite at a crab touching the player from behind does not hit while the body faces away (Grab too); a front contact still hits', () => {
    const setup = (deg: number, extra: Parameters<typeof speck>[0] = []) => {
      const s = speck(extra); s.run.stage = 1; s.actorCache = null; s.combat = new CombatWorld();
      const actor = playerActorCached(s), body = playerBody(s, actor), L = body.L, pr = Math.max(...actor.hull.map(h => h.radius)), c = body.centre;
      const spec = SPECIES.find(x => x.key === '1:crab')!, r = speciesCombatPose(entity(9, spec, c), 0).hull[0]!.radius;
      const a = deg * Math.PI / 180, d = pr + r + .05 * L, crab = entity(9, spec, { x: c.x + Math.sin(a) * d, y: c.y - r, z: c.z + Math.cos(a) * d });
      const hc = speciesCombatPose(crab, 0).hull[0]!.start, n = Math.hypot(hc.x - c.x, hc.y - c.y, hc.z - c.z);
      return { s, crab, aim: { x: (hc.x - c.x) / n, y: (hc.y - c.y) / n, z: (hc.z - c.z) / n } };
    };
    const hits = (deg: number, press: Partial<CombatInput>, extra: Parameters<typeof speck>[0] = []) => {
      const { s, crab, aim } = setup(deg, extra); let now = 0, hit = false;
      for (let i = 0; i < 40; i++) { const r = tick(s, [crab], now, i === 0 ? { ...press, aim } : { aim }).r; if (r.events.some(e => e.targetId === 'e9' && e.outcome === 'hit')) hit = true; now += 1 / 60; }
      return hit;   // the tick never turns the body (the player step does): the body faces +z throughout
    };
    for (const deg of [180, 145, 110]) expect(hits(deg, { basicPressed: true, basicHeld: true }), `Bite at ${deg}°`).toBe(false);
    for (const deg of [0, 30]) expect(hits(deg, { basicPressed: true, basicHeld: true }), `Bite at ${deg}°`).toBe(true);
    // Grab (the pincer's pinch cone): the same rule.
    const pincer = [{ id: 'claw_pincer', t: .5, scale: 2 }] as Parameters<typeof speck>[0];
    const grabSlot = (() => { const { s } = setup(0, pincer); return playerMoves(s).slots.slots.indexOf('grab'); })();
    expect(grabSlot).toBeGreaterThanOrEqual(0);
    const pressGrab = { activePressed: [0, 1, 2, 3].map(k => k === grabSlot) as CombatInput['activePressed'] };
    expect(hits(180, pressGrab, pincer), 'Grab at 180°').toBe(false);
  });
  // Final review I1 (controller ruling): the player's Bite deals half poise damage, so a size-1 Snapper (6 HP, 3 poise per Bite) no longer
  // staggers a size-1 hunter (poise 6) with every Bite; the third or fourth quick Bite does (poise decays 4/s).
  it('two quick size-1 Bites do not stagger a size-1 crab; it staggers only after more', () => {
    const s = speck(); s.run.stage = 1; s.run.genome.parts.find(x => x.id === 'mouth_snapper')!.scale = 2; s.actorCache = null; s.moves = null; s.combat = new CombatWorld();   // a size-1 Snapper: 6 HP per Bite
    const actor = playerActorCached(s), body = playerBody(s, actor), pr = Math.max(...actor.hull.map(h => h.radius)), c = body.centre;
    const spec = SPECIES.find(x => x.key === '1:crab')!, r = speciesCombatPose(entity(9, spec, c), 0).hull[0]!.radius;
    const crab = entity(9, spec, { x: c.x, y: c.y - r, z: c.z + pr + r + .1 * body.L }), cc = s.combat.stateOf(crab)!, aim = { x: 0, y: 0, z: 1 };
    let now = 0; const staggeredAfter: boolean[] = [];
    for (let bite = 0; bite < 4 && crab.hp > 0; bite++) {
      let hit = null;
      for (let i = 0; i < 90 && !hit; i++) { hit = tick(s, [crab], now, i === 0 ? { basicPressed: true, basicHeld: true, aim } : { aim }).r.events.find(e => e.targetId === 'e9') ?? null; now += 1 / 60; }
      expect(hit, `bite ${bite + 1} lands`).toMatchObject({ outcome: 'hit', amount: 6 });
      staggeredAfter.push(cc.rt.staggerUntil > cc.rt.actionClock);
      for (let i = 0; i < 30; i++) { tick(s, [crab], now, { aim }); now += 1 / 60; }   // recovery: the next Bite is about .44 s after the last
    }
    expect(staggeredAfter.slice(0, 2)).toEqual([false, false]);
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
  it('a pin-only change (no genome revision) rebuilds the slots (T20 carry)', () => {
    const s = speck(), revision = s.genomeRevision; expect(playerMoves(s).slots.slots).toEqual(['dash', null, null, null]);
    s.run.loadout = { slots: [null, null, 'dash', null] };
    expect(s.genomeRevision).toBe(revision); expect(playerMoves(s).slots.slots).toEqual([null, null, 'dash', null]);
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

describe('telegraphs (spec §9.1)', () => {
  it('fill over windup + extension; live before the lock, the locked shapes after; amber solid or red stripes', () => {
    const s = speck(), crab = entity(20, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!, onScreen = () => true, ground = () => 0;
    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT }); if (typeof a === 'string') throw new Error(a);
    let now = 0; for (let i = 0; i < 6; i++) { now += 1 / 60; tick(s, [crab], now); }   // .1 s
    const early = s.combat.telegraphs(now, onScreen, ground)[0]!;
    expect(early.locked).toBe(false); expect(early.fill).toBeCloseTo(.1 / .5); expect(early.color).toBe('amber'); expect(early.pattern).toBe('solid');
    expect(early.activeIn).toBeCloseTo(.4); expect(early).toMatchObject({ attackId: 'poke', attackerId: 'e20', entityId: 20, phase: 'windup', cue: 'rear' });
    for (let i = 0; i < 18; i++) { now += 1 / 60; tick(s, [crab], now); }   // .4 s: locked at .3
    const locked = s.combat.telegraphs(now, onScreen, ground)[0]!;
    expect(locked.locked).toBe(true); expect(locked.shapes).toBe(a.lockedShapes);
    const w = s.combat.startSpecies(s.combat.stateOf(entity(21, FX_HUNTER, ahead(5)))!, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, null, now); if (typeof w === 'string') throw new Error(w);
    expect(s.combat.telegraphs(now, onScreen, ground).find(t => t.attackId === 'wrap')).toMatchObject({ color: 'red', pattern: 'stripes', cue: 'coil', targetsPlayer: false });
    expect(locked.targetsPlayer).toBe(true);
  });
  it('the fill and the time to active include the director\'s extension (review I2)', () => {
    const s = speck(), crab = entity(23, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!;
    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT }); if (typeof a === 'string') throw new Error(a);
    a.windupExtension = .2;   // as a later director extension sets it
    let now = 0; for (let i = 0; i < 21; i++) { now += 1 / 60; tick(s, [crab], now); }   // .35 s of a .5 + .2 s windup
    expect(a.windupExtension).toBeCloseTo(.2, 9);
    const v = s.combat.telegraphs(now, () => true, () => 0)[0]!;
    expect(v.phase).toBe('windup'); expect(v.fill).toBeCloseTo(.35 / .7, 6); expect(v.activeIn).toBeCloseTo(.35, 6);
    expect(v.flash).toBe(false);   // .35 s before active: outside the flash lead
  });
  it('reading telegraphs samples no pose through the tick cache (review M1)', () => {
    const s = speck(), crab = entity(24, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    const before = s.combat.poseSamples;
    for (let i = 0; i < 5; i++) s.combat.telegraphs(0, () => true, () => 0);
    expect(s.combat.poseSamples).toBe(before);
  });
  it('the edge arrow (main.ts memory) shows from going off-screen to the end of active; the attacker flashes at windup start and before active', () => {
    const s = speck(), crab = entity(22, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let screen = true; const memory = new EdgeArrowMemory();
    const at = (now: number) => { const views = s.combat.telegraphs(now, () => screen, () => 0), shown = memory.update(views); return views[0] && { ...views[0], arrow: shown.has(views[0].actionId) }; };
    expect(at(0)).toMatchObject({ arrow: false, flash: true, onScreen: true, edgeArrow: true });   // windup start
    expect(WINDUP_FLASH).toBe(.1);
    let now = 0; for (let i = 0; i < 12; i++) { now += 1 / 60; tick(s, [crab], now); }
    expect(at(now)).toMatchObject({ arrow: false, flash: false });
    screen = false; expect(at(now)).toMatchObject({ arrow: true, onScreen: false }); screen = true; expect(at(now)!.arrow).toBe(true);   // stays on
    for (let i = 0; i < 16; i++) { now += 1 / 60; tick(s, [crab], now); }   // .47 s: inside the .12 s flash lead before active at .5
    expect(.5 - now).toBeLessThanOrEqual(FLASH_LEAD_SECONDS); expect(at(now)!.flash).toBe(true);
    for (let i = 0; i < 20; i++) { now += 1 / 60; tick(s, [crab], now); }   // past active
    expect(at(now)).toBeUndefined();
    expect(memory.update([])).toEqual(new Set());
  });
});

/** Plan review R11 (binding): the telegraph drawn at the aim lock is the locked hit shape (numbers checked independently of the combat
 *  world's shape code), and at every active tick each sampled boundary point of the hit volume lies inside the telegraph volume. Runs over
 *  every registered species attack (SPECIES_ATTACKS) and the fixture attacks, with moving attackers and a lunge that advances. */
describe('telegraph = hit volume for every species attack (plan review R11)', () => {
  /** T13 set this to true when it registered the species attacks: the test then fails if none are registered. */
  const REQUIRE_REGISTERED = true;
  const LUNGE: AttackSpec = { ...POKE, id: 'fx-lunge', shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1.4 }, radius: .22 }, lunge: { distanceBodyLengths: 1.2 },
    windupSeconds: .6, aimLockAtSeconds: .35, activeSeconds: .3, interruptible: false };
  const WIDE: AttackSpec = { ...POKE, id: 'fx-wide', shape: { kind: 'cone', range: .9, halfAngle: 100 * Math.PI / 180 }, telegraphProfileId: 'amber-spin' };
  const BURST: AttackSpec = { ...POKE, id: 'fx-burst', aimMode: 'centre', aimLockAtSeconds: 0, telegraphProfileId: 'amber-inflate', shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 1.6 } };
  const EMERGE: AttackSpec = { ...POKE, id: 'fx-emerge', aimMode: 'fixed-at-start', aimLockAtSeconds: 0, origin: 'target', blockable: false, telegraphProfileId: 'red-burrow',
    shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: .35 } };
  const SIDE: AttackSpec = { ...POKE, id: 'fx-side', aimMode: 'fixed-at-start', aimLockAtSeconds: 0, shape: { kind: 'capsule', start: { x: .3, y: .1, z: 0 }, end: { x: .3, y: .1, z: .8 }, radius: .15 } };
  const registered = Object.values(SPECIES_ATTACKS), fixtures = [POKE, WRAP, SMASH, LUNGE, WIDE, BURST, EMERGE, SIDE];
  const bands = [...Object.values(BEHAVIOURS), ...Object.values(FX_BEHAVIOURS)].flatMap(b => [...b.attacks, ...(b.phases ?? []).flatMap(p => p.attacks)]);
  const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z), mul = (a: Vec3, k: number) => v3(a.x * k, a.y * k, a.z * k), sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z), norm = (a: Vec3) => mul(a, 1 / len(a));
  const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  /** Two unit vectors perpendicular to `d` and to each other. */
  const perp = (d: Vec3): [Vec3, Vec3] => { const a = norm(cross(d, Math.abs(d.y) < .9 ? v3(0, 1, 0) : v3(1, 0, 0))); return [a, cross(d, a)]; };
  /** Points on the boundary of a shape (and its apex or axis ends). */
  function boundary(s: WorldShape): Vec3[] {
    const out: Vec3[] = [];
    if (s.kind === 'cone') {
      const [u, w] = perp(s.axis), h = Math.min(Math.PI, s.halfAngle);
      out.push(s.apex, add(s.apex, mul(s.axis, s.range)));
      for (let k = 0; k < 16; k++) {
        const t = k / 16 * 2 * Math.PI, side = add(mul(u, Math.cos(t)), mul(w, Math.sin(t)));
        for (const angle of [h, h / 2]) { const dir = add(mul(s.axis, Math.cos(angle)), mul(side, Math.sin(angle))); for (const f of [.25, .5, 1]) out.push(add(s.apex, mul(dir, s.range * f))); }
      }
      return out;
    }
    const axis = sub(s.end, s.start), d = len(axis) > 1e-12 ? norm(axis) : v3(0, 0, 1), [u, w] = perp(d);
    out.push(sub(s.start, mul(d, s.radius)), add(s.end, mul(d, s.radius)));
    for (const f of [0, .25, .5, .75, 1]) for (let k = 0; k < 12; k++) {
      const t = k / 12 * 2 * Math.PI, side = add(mul(u, Math.cos(t)), mul(w, Math.sin(t)));
      out.push(add(add(s.start, mul(axis, f)), mul(side, s.radius)));
      if (f === 0) out.push(add(s.start, mul(norm(sub(side, d)), s.radius)));
      if (f === 1) out.push(add(s.end, mul(norm(add(side, d)), s.radius)));
    }
    return out;
  }
  /** The expected locked shape, from the attack numbers, the species pose and the aim only (spec §5.10, review R2/R4). */
  function expected(attack: AttackSpec, e: Entity, aim: Vec3, targetAt: Vec3, now: number): WorldShape {
    const pose = speciesCombatPose(e, now), hull = pose.hull[0]!, L = pose.bodyLength, z = norm(aim);
    const origin = attack.origin === 'target' ? targetAt : attack.aimMode === 'centre' ? hull.start : add(hull.start, mul(z, hull.radius));
    const ref = Math.abs(z.y) > .98 ? pose.forward : v3(0, 1, 0), y = norm(sub(ref, mul(z, ref.x * z.x + ref.y * z.y + ref.z * z.z))), x = cross(y, z);
    if (attack.shape.kind === 'cone') return { kind: 'cone', apex: origin, axis: z, range: attack.shape.range * L, halfAngle: attack.shape.halfAngle };
    const at = (p: Vec3) => add(origin, mul(add(add(mul(x, p.x), mul(y, p.y)), mul(z, p.z)), L));
    return { kind: 'capsule', start: at(attack.shape.start), end: at(attack.shape.end), radius: attack.shape.radius * L };
  }
  const close = (a: Vec3, b: Vec3, tol: number) => { expect(a.x).toBeCloseTo(b.x, tol); expect(a.y).toBeCloseTo(b.y, tol); expect(a.z).toBeCloseTo(b.z, tol); };
  function sameShape(got: WorldShape, want: WorldShape) {
    expect(got.kind).toBe(want.kind);
    if (got.kind === 'cone' && want.kind === 'cone') { close(got.apex, want.apex, 9); close(got.axis, want.axis, 9); expect(got.range).toBeCloseTo(want.range, 9); expect(got.halfAngle).toBeCloseTo(want.halfAngle, 12); }
    if (got.kind === 'capsule' && want.kind === 'capsule') { close(got.start, want.start, 9); close(got.end, want.end, 9); expect(got.radius).toBeCloseTo(want.radius, 9); }
  }
  /** The distance from q to the segment ab. */
  const toSegment = (q: Vec3, a: Vec3, b: Vec3) => { const ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z, d = sub(q, a);
    const t = l2 > 0 ? Math.max(0, Math.min(1, (d.x * ab.x + d.y * ab.y + d.z * ab.z) / l2)) : 0; return len(sub(q, add(a, mul(ab, t)))); };
  /** The drawn mesh (review I1), checked separately for the volume and for the outline: every vertex lies on the shape's boundary (a cone's
   *  apex, cap or side; a capsule's surface), and each geometry reaches the shape's far point and its rim (cone) or radius (capsule). */
  function drawnMatches(s: WorldShape) {
    // Vertices are float32: a relative tolerance of 1e-5 of the shape's size.
    const m = telegraphMatrix(s, 1, new T.Matrix4()), size = s.kind === 'cone' ? s.range : s.radius + len(sub(s.end, s.start)), tol = 1e-5 * size;
    const origin = s.kind === 'cone' ? s.apex : s.start, axis = s.kind === 'cone' ? s.axis : len(sub(s.end, s.start)) > 1e-12 ? norm(sub(s.end, s.start)) : null;
    const h = s.kind === 'cone' ? Math.min(Math.PI, s.halfAngle) : 0;
    for (const [name, g] of [['volume', unitGeometry(s)], ['outline', outlineGeometry(s)]] as const) {
      const p = g.getAttribute('position'), v = new T.Vector3();
      let far = -Infinity, rim = 0, radial = 0;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m); const q = v3(v.x, v.y, v.z), d = sub(q, origin), at = `${s.kind} ${name} vertex ${i}`;
        expect(sphereHitsShape(q, tol, s), at).toBe(true);
        if (s.kind === 'cone') {
          const dist = len(d), angle = dist > tol ? Math.acos(Math.max(-1, Math.min(1, (d.x * s.axis.x + d.y * s.axis.y + d.z * s.axis.z) / dist))) : 0;
          expect(dist < tol || Math.abs(dist - s.range) < tol || Math.abs(angle - h) < 1e-4, `${at} on the boundary`).toBe(true);
          far = Math.max(far, d.x * s.axis.x + d.y * s.axis.y + d.z * s.axis.z); if (dist > tol) rim = Math.max(rim, angle);
        } else {
          const r = toSegment(q, s.start, s.end); radial = Math.max(radial, r);
          expect(Math.abs(r - s.radius), `${at} on the surface`).toBeLessThan(tol);
          if (axis) far = Math.max(far, d.x * axis.x + d.y * axis.y + d.z * axis.z);
        }
      }
      if (s.kind === 'cone') { expect(Math.abs(far - s.range), `${name} reach`).toBeLessThan(tol); expect(Math.abs(rim - h), `${name} rim`).toBeLessThan(1e-4); }
      else { expect(Math.abs(radial - s.radius), `${name} radius`).toBeLessThan(tol); if (axis) expect(Math.abs(far - (len(sub(s.end, s.start)) + s.radius)), `${name} reach`).toBeLessThan(tol); }
    }
  }
  /** Review M2: the aim the attack locked, from the test's numbers only: from the hull centre toward the target, pitch clamped to ±.6 rad. */
  function expectedAim(e: Entity, target: Vec3, now: number): Vec3 {
    const c = speciesCombatPose(e, now).hull[0]!.start, d = sub(target, c), flat = Math.hypot(d.x, d.z), pitch = Math.atan2(d.y, flat), limit = .6;
    if (Math.abs(pitch) <= limit) return norm(d);
    const p = Math.sign(pitch) * limit; return v3(d.x / flat * Math.cos(p), Math.sin(p), d.z / flat * Math.cos(p));
  }
  function check(attack: AttackSpec) {
    const real = SPECIES.find(sp => sp.attackIds.includes(attack.id)), spec: Species = real ? { ...real, behaviourId: 'fx-hunter' } : FX_HUNTER;
    const s = speck(), e = entity(90, spec, v3(0, 0, 0)), c = s.combat.stateOf(e)!, target = playerBody(s, playerActorCached(s)).centre;
    // The hull centre level with the player's centre, the hull front at the middle of the attack's band (else half its reach) from it.
    const pose = speciesCombatPose(e, 0), hull = pose.hull[0]!, L = pose.bodyLength, band = bands.find(b => b.attackId === attack.id)?.band;
    const gap = (band ? (band[0] + band[1]) / 2 : forwardReach(attack.shape) / 2) * L, offset = sub(hull.start, v3(e.x, e.y, e.z));
    e.x = target.x - offset.x; e.y = target.y - offset.y; e.z = target.z + hull.radius + gap - offset.z;
    const a = s.combat.startSpecies(c, attack.id, attack, v3(0, 0, -1), 'player', 0, { ...AT_PLAYER, targetAt: target });
    if (typeof a === 'string') throw new Error(`${attack.id}: ${a}`);
    const startAim = expectedAim(e, target, 0);
    close(a.aim, startAim, 9);
    let now = 0, lockChecked = false, activeTicks = 0;
    const lockCheck = () => {
      const view = s.combat.telegraphs(now, () => true, () => 0).find(v => v.actionId === a.instanceId)!;
      expect(view, attack.id).toBeDefined(); expect(view.locked).toBe(true); expect(view.shapes).toHaveLength(1);
      // The aim: toward the target from the hull centre — at the start for an aim fixed at start, at the lock for a tracking aim.
      close(a.aim, attack.aimMode === 'input' ? expectedAim(e, target, now) : startAim, 6);
      sameShape(view.shapes[0]!, expected(attack, e, a.aim, target, now)); sameShape(a.lockedShapes![0]!, view.shapes[0]!);
      drawnMatches(view.shapes[0]!); lockChecked = true;
    };
    if (a.aimLocked) lockCheck();
    for (let i = 1; i <= 240 && (activeTicks === 0 || a.phase === 'active'); i++) {
      now = i / 60;
      e.x += .004 * L; e.heading += .01;   // a moving, turning attacker
      if (a.phase === 'active' && attack.lunge) {   // the ecosystem moves a lunge along the aim and records how far it came
        const step = Math.min(attack.lunge.distanceBodyLengths - a.lungeDone, attack.lunge.distanceBodyLengths / attack.activeSeconds / 60);
        a.lungeDone += step; e.x += a.aim.x * step * L; e.y += a.aim.y * step * L; e.z += a.aim.z * step * L;
      }
      tick(s, [e], now);
      if (!lockChecked && a.aimLocked) lockCheck();
      if (a.phase !== 'active') continue;
      activeTicks++;
      const view = s.combat.telegraphs(now, () => true, () => 0).find(v => v.actionId === a.instanceId)!;
      expect(view, `${attack.id} active tick ${activeTicks}`).toBeDefined(); expect(view.shapes).toBe(a.lockedShapes);
      for (const hit of s.combat.speciesHitShapes(c, a, now)) for (const q of boundary(hit))
        expect(view.shapes.some(t => sphereHitsShape(q, 1e-6 * L, t)), `${attack.id} active tick ${activeTicks}`).toBe(true);
    }
    expect(lockChecked, attack.id).toBe(true); expect(activeTicks, attack.id).toBeGreaterThan(0);
    if (attack.lunge) expect(a.lungeDone).toBeGreaterThan(0);
  }
  it('registered attacks are checked once T13 registers them', () => {
    expect(registered.length).toBeGreaterThan(REQUIRE_REGISTERED ? 0 : -1);
  });
  for (const attack of [...registered, ...fixtures]) it(`${attack.id}: drawn at the lock as the locked hit shape; every active hit volume inside it`, () => check(attack));
});

// Owner 2026-10-03 (combat 3a follow-up F2, spec §11.8): a grabber with the squid's escape rule ignores Chomp mashing; a Dash press frees the
// player at once.
describe('the squid escape rule in the tick (spec §11.8)', () => {
  const FIN = { id: 'fin_side', t: .45, angle: Math.PI / 2 + .2, scale: 1, mirror: true };
  function held(escape: boolean) {
    const s = speck([FIN]);
    const fx = FX_BEHAVIOURS['fx-hunter']!;
    s.combat = new CombatWorld({ ...FX_BEHAVIOURS, 'fx-hunter': { ...fx, traits: escape ? { hint: 'fixture squid', grabEscape: 'dash-or-counter' } : undefined } });
    const squid = entity(41, { ...FX_HUNTER, hp: 50 }, ahead(1.2)), c = s.combat.stateOf(squid)!;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: AT });
    let now = 0; for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.rt.heldBy).toBe('e41');
    while (now < s.rt.hitStopUntil) tick(s, [squid], now += 1 / 60);
    return { s, squid, now, dash: playerMoves(s).slots.slots.indexOf('dash') };
  }
  it('Chomp presses do not free the player; a Dash press does, at once', () => {
    const { s, squid, now, dash } = held(true);
    expect(dash).toBeGreaterThanOrEqual(0);
    let t = now;
    for (let i = 0; i < 6; i++) { tick(s, [squid], t += 1 / 60, { basicPressed: true, basicHeld: true }); tick(s, [squid], t += 1 / 60); }
    expect(s.rt.heldBy).toBe('e41'); expect(s.rt.breakProgress).toBe(0);
    const press: CombatInput['activePressed'] = [false, false, false, false]; press[dash] = true;
    expect(tick(s, [squid], t += 1 / 60, { activePressed: press }).r.brokeFree).toBe(true);
    expect(s.rt.heldBy).toBeNull();
  });
  it('without the rule, Chomp mashing still frees the player (four presses)', () => {
    const { s, squid, now } = held(false);
    let t = now;
    for (let i = 0; i < 4; i++) { tick(s, [squid], t += 1 / 60, { basicPressed: true, basicHeld: true }); tick(s, [squid], t += 1 / 60); }
    expect(s.rt.heldBy).toBeNull();
  });
});
