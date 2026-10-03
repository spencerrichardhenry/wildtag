// tests/tiny-tide-core/ai-tick.test.ts — T16a: the AI tick of the combat world (spec §11.2) and its wiring carries (T8/T11/T14 reviews):
// the full start context, the token retry, line of sight, the ambush engagement, the faint give-up, heal, untargetable, roar, the emerge snap,
// provocation, lunge motion, and the survivor bonus through simFrame.
import { describe, expect, it, vi } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { lungeSpeed } from '../../src/tiny-tide/action-engine';
import { BEHAVIOURS, SPECIES_ATTACKS } from '../../src/tiny-tide/bestiary';
import { newAiState, ROAR_SECONDS } from '../../src/tiny-tide/combat-ai';
import { CombatWorld, type AiTickContext } from '../../src/tiny-tide/combat-world';
import type { ActionState } from '../../src/tiny-tide/combat-types';
import type { Ecosystem, Entity } from '../../src/tiny-tide/ecosystem';
import { OFF_SCREEN_WINDUP } from '../../src/tiny-tide/director';
import { RELEASED } from '../../src/tiny-tide/input';
import { speciesCombatPose } from '../../src/tiny-tide/mount';
import { playerActorCached, playerBody, simBegin, simFrame, type SimEvent, type SimState, type SimWorld } from '../../src/tiny-tide/sim';
import { species, type Species } from '../../src/tiny-tide/species';
import { stageBounds } from '../../src/tiny-tide/world-queries';
import { AT_PLAYER, entity, FLAT, speck, tick } from './combat-fixture-world';

const DT = 1 / 60;
/** A tier-1 entity's origin `d` ahead of the Speck, its hull centre level with the Speck (crab hull: radius 1.4, L 5.6). */
const ahead = (d: number) => ({ x: 0, y: 1 - .35 * SIZES[1]!, z: d });
const CRAB = species(1, 'crab');
const EEL: Species = { ...CRAB, key: '1:fx_eel', label: 'Fixture eel', behaviourId: 'eel', attackIds: ['eel-ambush', 'eel-bite', 'eel-wrap'] };
const MOTHER: Species = { ...CRAB, key: '1:fx_mother', label: 'Fixture mother', hunts: [], behaviourId: 'clawmother', alpha: { size: 0, rewardPartId: 'claw_pincer', rewardDna: 40 },
  attackIds: ['mother-pinch', 'mother-pinch-2', 'mother-lunge', 'mother-emerge', 'mother-sweep', 'mother-pinch-rage'] };
/** A Speck (a herbivore with the nibbler, or a carnivore) with the shipped behaviours. */
function fighter(mouth = 'mouth_snapper'): SimState { const s = speck([], mouth); s.combat = new CombatWorld(); return s; }
function ctx(s: SimState, entities: Entity[], now: number, over: Partial<AiTickContext> = {}): AiTickContext {
  return { now, dt: DT, stage: s.run.stage, runSeed: 1, entities, player: playerBody(s, playerActorCached(s)), playing: true, stealthFactor: 1, hitBy: new Set(),
    isOnScreen: () => true, lineOfSight: () => true, givingUp: false, ...over };
}
/** Combat ticks and AI ticks for `seconds` from `from`; returns the end time. */
function run(s: SimState, entities: Entity[], from: number, seconds: number, over: Partial<AiTickContext> = {}, each?: (r: ReturnType<CombatWorld['aiTick']>, now: number) => void): number {
  let now = from;
  for (let i = 0; i < Math.round(seconds / DT); i++, now += DT) { tick(s, entities, now); const r = s.combat.aiTick(ctx(s, entities, now, over)); each?.(r, now); }
  return now;
}
const recordStarts = (s: SimState) => {
  const calls: { result: ActionState | string; opts: Parameters<CombatWorld['startSpecies']>[6] }[] = [], real = s.combat.startSpecies.bind(s.combat);
  vi.spyOn(s.combat, 'startSpecies').mockImplementation((...args) => { const result = real(...args); calls.push({ result, opts: args[6] }); return result; });
  return calls;
};

describe('the AI tick (spec §11.2)', () => {
  it('a live crab in range attacks the player (carry 7) with the full start context (carry 1)', () => {
    const s = fighter(), crab = entity(1, CRAB, ahead(3.5)); crab.mode = 'hunt';
    const calls = recordStarts(s), events: string[] = [];
    let now = 0;
    for (let i = 0; i < 4 * 60; i++, now += DT) { const { r } = tick(s, [crab], now); events.push(...r.events.filter(e => e.attackerId === 'e1' && e.targetId === 'player').map(e => e.outcome)); s.combat.aiTick(ctx(s, [crab], now)); }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(c => typeof c.result === 'string').map(c => c.result)).not.toContain('no-context');
    expect(calls.filter(c => typeof c.result === 'string').map(c => c.result)).not.toContain('no-target');
    const started = calls.filter(c => typeof c.result !== 'string');
    expect(started.length).toBeGreaterThan(0);
    for (const c of started) {
      expect((c.result as ActionState).targetId).toBe('player');
      expect(c.opts).toMatchObject({ onScreen: true, playerHeld: false, playing: true, tick: DT });
      expect(c.opts!.targetAt).toEqual(playerBody(s, playerActorCached(s)).centre);   // the player's hurtbox centre (the still Speck)
    }
    expect(events).toContain('hit');
  });
  it('an off-screen wind-up is lengthened by the director (isOnScreen reaches the token request)', () => {
    const s = fighter(), crab = entity(1, CRAB, ahead(3.5)); crab.mode = 'hunt';
    const calls = recordStarts(s), seen = vi.fn(() => false);
    run(s, [crab], 0, 3, { isOnScreen: seen });
    const started = calls.map(c => c.result).filter((r): r is ActionState => typeof r !== 'string');
    expect(started.length).toBeGreaterThan(0); expect(seen).toHaveBeenCalled();
    for (const a of started) expect(a.windupExtension).toBeGreaterThanOrEqual(Math.max(0, OFF_SCREEN_WINDUP - a.resolved.attack!.windupSeconds) - 1e-9);
    expect(started.some(a => a.windupExtension > 0)).toBe(true);
  });
  it('a refused token waits for the director\'s tokenRetryAt, never re-asking every tick (carry 2)', () => {
    const s = fighter(), crab = entity(1, CRAB, ahead(3.5)); crab.mode = 'hunt'; s.rt.heldBy = 'e99';   // the director refuses every wind-up at a held player
    const calls = recordStarts(s), c = s.combat.stateOf(crab)!;
    let now = 0;
    for (let i = 0; i < 60; i++, now += DT) {
      s.combat.aiTick(ctx(s, [crab], now));
      if (calls.length && c.ai) expect(c.ai.retryAt).toBeGreaterThanOrEqual(c.tokenRetryAt - 1e-9);
    }
    expect(calls.length).toBeGreaterThan(0); expect(calls.every(x => x.result === 'token')).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(6);   // about one ask per RETRY_SECONDS (.2 s) after the .35 s notice, not 60
  });
  it('the eel den strikes only with a line of sight (review I9), and the ambush engages the pursuit (carry 4)', () => {
    const s = fighter(), eel = entity(1, EEL, ahead(3.5));
    run(s, [eel], 0, 1, { lineOfSight: () => false });
    const c = s.combat.stateOf(eel)!; expect(c.ai!.name).toBe('den'); expect(c.rt.actions).toEqual([]);
    const names = new Set<string>();
    run(s, [eel], 1, 2.5, {}, () => names.add(c.ai!.name));
    expect(names.has('ambush')).toBe(true); expect(eel.mode).toBe('hunt');
    expect(names.has('retreat')).toBe(false); expect([...names].some(n => n === 'approach' || n === 'attack' || n === 'reposition')).toBe(true);
  });
  it('D27: inside the give-up window an alpha is not hostile and a hunter gets the give-up pursuit (carry 5)', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), crab = entity(2, CRAB, { ...ahead(3.5), x: 4 }); crab.mode = 'hunt';
    const calls = recordStarts(s), markers: Entity[] = [];
    let now = run(s, [mother, crab], 0, 2, { givingUp: true }, r => markers.push(...r.markers));
    expect(markers).toEqual([]); expect(calls).toEqual([]); expect(s.combat.stateOf(mother)!.ai!.name).toBe('idle');
    run(s, [mother, crab], now, 1, {}, r => markers.push(...r.markers));
    expect(markers).toContain(mother); expect(markers).toContain(crab);
  });
  it('D27 (review ruling): inside the give-up window no species is hostile, a prey fighter included', () => {
    const s = fighter(), snail = entity(1, species(0, 'spiny_snail'), { x: 0, y: .65, z: 2 }), calls = recordStarts(s);
    const now = run(s, [snail], 0, 2.5, { givingUp: true });
    expect(calls).toEqual([]);
    run(s, [snail], now, 2.5);
    expect(calls.some(c => typeof c.result !== 'string')).toBe(true);   // the cornered snail pokes once the window is over
  });
  it('an alpha\'s mode mirrors its AI (no ecosystem pursuit): engaged is angry, idle or reset is calm', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), c = s.combat.stateOf(mother)!, centre = speciesCombatPose(mother, 0).hull[0]!.start;
    c.ai = newAiState(1, mother.id, 0); c.ai.home = { ...centre };
    s.combat.aiTick(ctx(s, [mother], 0)); expect(c.ai.name).toBe('notice'); expect(mother.mode).toBe('angry');   // the player is inside the lair
    c.ai.name = 'reset'; mother.hp = .5 * c.maxHp; c.ai.home = { x: 100, y: 1, z: 100 };
    s.combat.aiTick(ctx(s, [mother], DT)); expect(mother.mode).toBe('calm');
    mother.mode = 'angry'; s.combat.aiTick(ctx(s, [mother], 2 * DT, { hitBy: new Set([mother.id]) })); expect(mother.mode).toBe('calm');   // a hit does not override the AI
  });
  it('heals an alpha per second while it resets (carry 6)', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), c = s.combat.stateOf(mother)!;
    c.ai = newAiState(1, mother.id, 0); c.ai.name = 'reset'; c.ai.home = { x: 100, y: 1, z: 100 }; mother.hp = .5 * c.maxHp;
    let now = 0;
    for (let i = 0; i < 60; i++, now += DT) s.combat.aiTick(ctx(s, [mother], now));
    expect(mother.hp).toBeCloseTo(.5 * c.maxHp + BEHAVIOURS.clawmother!.lair!.healPerSecond * c.maxHp * 60 * DT, 6);
  });
  it('an alpha under the sand is untargetable, and an untargetable body has no hurtboxes for the player (carry 6)', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), c = s.combat.stateOf(mother)!, centre = speciesCombatPose(mother, 0).hull[0]!.start;
    c.ai = newAiState(1, mother.id, 0); c.ai.name = 'sink'; c.ai.since = 0; c.ai.phase = 1; c.ai.home = { ...centre }; mother.hp = .5 * c.maxHp;
    s.combat.aiTick(ctx(s, [mother], 0)); expect(c.rt.targetable).toBe(false);
    const bitten = (targetable: boolean) => {
      // The Bite starts at a targetable crab; it turns untargetable during the wind-up (sinking): the hit test must skip it.
      const t = fighter(), crab = entity(1, CRAB, ahead(3.5)), hits: string[] = [];
      for (let i = 0; i < 40; i++) {
        const { r } = tick(t, [crab], i * DT, i === 0 ? { basicPressed: true, basicHeld: true } : {});
        if (i === 0) { expect(r.started).toEqual(['bite']); t.combat.stateOf(crab)!.rt.targetable = targetable; }
        hits.push(...r.events.filter(e => e.targetId === 'e1').map(e => e.outcome));
      }
      return hits;
    };
    expect(bitten(true)).not.toEqual([]); expect(bitten(false)).toEqual([]);
  });
  it('a phase roar cancels the busy action, returns its token, is reported and blocks stagger for ROAR_SECONDS (carry 6)', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), c = s.combat.stateOf(mother)!, centre = speciesCombatPose(mother, 0).hull[0]!.start;
    c.ai = newAiState(1, mother.id, 0); c.ai.name = 'approach'; c.ai.home = { ...centre };
    const body = playerBody(s, playerActorCached(s)), a = s.combat.startSpecies(c, 'mother-pinch', SPECIES_ATTACKS['mother-pinch']!, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: body.centre });
    expect(typeof a).toBe('object'); expect(s.combat.director.tokens).toHaveLength(1);
    mother.hp = .5 * c.maxHp;
    const r = s.combat.aiTick(ctx(s, [mother], .1));
    expect(r.roars).toEqual([mother]); expect((a as ActionState).phase).toBe('interrupted'); expect(s.combat.director.tokens).toEqual([]);
    expect(c.immuneUntil).toBeCloseTo(.1 + ROAR_SECONDS, 9);
  });
  it('a target-origin emerge snaps the body to the emerge point at the wind-up start (review R4)', () => {
    const s = fighter(), mother = entity(1, MOTHER, ahead(3.5)), c = s.combat.stateOf(mother)!, centre = speciesCombatPose(mother, 0).hull[0]!.start;
    c.ai = newAiState(1, mother.id, 0); c.ai.name = 'burrowed'; c.ai.since = -1.3; c.ai.phase = 1; c.ai.home = { ...centre }; mother.hp = .5 * c.maxHp;
    const seen = vi.fn((_p: { x: number; y: number; z: number }) => true);
    s.combat.aiTick(ctx(s, [mother], 0, { isOnScreen: seen }));
    const a = c.rt.actions.find(x => x.definitionId === 'mother-emerge');
    // The director's on-screen test looks at the shape's centroid: for a target-origin ball, the target (the player's hurtbox centre).
    const target = playerBody(s, playerActorCached(s)).centre;
    expect(seen).toHaveBeenCalledTimes(1); const at = seen.mock.calls[0]![0];
    expect(Math.hypot(at.x - target.x, at.y - target.y, at.z - target.z)).toBeLessThan(1e-9);
    expect(a?.originPoint).toBeTruthy(); expect(mother.combat?.snap).toEqual(a!.originPoint);
    s.combat.aiTick(ctx(s, [mother], DT)); expect(mother.combat?.snap ?? null).toBeNull();   // once, at the wind-up start
  });
  it('the player\'s damage provokes a fighter (hitBy → angry)', () => {
    const s = fighter(), snail = entity(1, species(0, 'spiny_snail'), { x: 0, y: .65, z: 2 });
    s.combat.aiTick(ctx(s, [snail], 0)); expect(snail.mode).toBe('calm');
    s.combat.aiTick(ctx(s, [snail], DT, { hitBy: new Set([1]) })); expect(snail.mode).toBe('angry'); expect(snail.lastKnown).toBeTruthy();
  });
  it('a lunge in active moves the body by its lunge speed; afterMotion counts the body lengths it really moved', () => {
    const s = fighter(), crab = entity(1, CRAB, ahead(8)), c = s.combat.stateOf(crab)!, L = speciesCombatPose(crab, 0).bodyLength;
    const body = playerBody(s, playerActorCached(s)), a = s.combat.startSpecies(c, 'crab-lunge', SPECIES_ATTACKS['crab-lunge']!, { x: 0, y: 0, z: -1 }, 'player', 0, { ...AT_PLAYER, targetAt: body.centre }) as ActionState;
    let now = 0;
    for (; a.phase !== 'active' && now < 2; now += DT) tick(s, [crab], now);
    s.combat.aiTick(ctx(s, [crab], now));
    const speed = lungeSpeed(a, L), lunge = crab.combat!.lunge!;
    expect(Math.hypot(lunge.x, lunge.y, lunge.z)).toBeCloseTo(speed, 6); expect(lunge.z).toBeLessThan(0);
    crab.combat!.moved = .5 * L; s.combat.afterMotion([crab]); expect(a.lungeDone).toBeCloseTo(.5, 9);
  });
});

/** A flat stage-0 world whose ecosystem only holds `entities` (it never moves them). */
function flatWorld(entities: Entity[]): SimWorld {
  const eco = { entities, consume: (e: Entity) => { e.eaten = true; }, planetIndex: () => 0, step: () => [], giveUpAll: () => undefined, givingUp: () => false, lineOfSight: () => true } as unknown as Ecosystem;
  return { eco, startGrace: 0, isOnScreen: () => true, legality: stage => ({ queries: FLAT, bounds: stageBounds(stage) }) };
}
describe('the AI tick in simFrame', () => {
  it('a plant-eater that outlasts a hunter gets the survivor bonus once per engagement (D22: ≥ 4 s, ≥ 1 wind-up)', () => {
    const outcome = (seconds: number, windups: number) => {
      const s = speck([], 'mouth_nibbler'), crab = entity(1, CRAB, ahead(30)), w = flatWorld([crab]);
      simBegin(s, w, s.run, null); s.combat = new CombatWorld(); expect(s.run.diet).toBe('herbivore');
      const c = s.combat.stateOf(crab)!; c.ai = newAiState(1, crab.id, s.time); c.ai.name = 'approach'; c.ai.engagedSince = s.time - seconds; c.ai.windups = windups; crab.mode = 'return';
      const events: SimEvent[] = [];
      for (let i = 0; i < 10; i++) events.push(...simFrame(s, w, { dt: DT, intent: RELEASED, wish: { x: 0, y: 0, z: 0 }, held: false }));
      return events.filter(e => e.type === 'survived');
    };
    expect(outcome(5, 1)).toEqual([{ type: 'survived', entity: expect.objectContaining({ id: 1 }), dna: Math.round(.35 * CRAB.dna) }]);
    expect(outcome(3, 1)).toEqual([]); expect(outcome(5, 0)).toEqual([]);
  });
  it('a plant-eater that kills an engaged hunter gets the survivor bonus once, with the kill (sim.ts kill path)', () => {
    const s = speck([], 'mouth_nibbler'), crab = entity(1, CRAB, ahead(3.2)), w = flatWorld([crab]);
    simBegin(s, w, s.run, null); s.combat = new CombatWorld(); s.physical = { x: 0, y: 1, z: 0 }; s.rt.orientation = { yaw: 0, pitch: 0 };
    crab.hp = 1; crab.mode = 'angry';   // engaged: a herbivore Bites it (review R17)
    const c = s.combat.stateOf(crab)!; c.ai = newAiState(1, crab.id, s.time); c.ai.name = 'approach'; c.ai.engagedSince = s.time - 5; c.ai.windups = 1;
    const events: SimEvent[] = [...simFrame(s, w, { dt: DT, intent: { ...RELEASED, basicPressed: true, basicHeld: true }, wish: { x: 0, y: 0, z: 0 }, held: false })];
    for (let i = 0; i < 60; i++) events.push(...simFrame(s, w, { dt: DT, intent: RELEASED, wish: { x: 0, y: 0, z: 0 }, held: false }));
    expect(events.filter(e => e.type === 'killed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'survived')).toEqual([{ type: 'survived', entity: crab, dna: Math.round(.35 * CRAB.dna) }]);
  });
});
