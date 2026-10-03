// tests/tiny-tide-core/contract.test.ts
import { describe, expect, it } from 'vitest';
import { newRuntime } from '../../src/tiny-tide/combat-types';
import { validateContract, type Catalogs } from '../../src/tiny-tide/registries';
import { hostileSizes, minWindup } from '../../src/tiny-tide/bestiary';
import { damageText, hitStopFor } from '../../src/tiny-tide/combat-profiles';
import { breachPermit, habitat, HABITATS, movementCapabilities, MOVEMENTS, PURSUITS } from '../../src/tiny-tide/profiles';
import { designDelta, emittersOf } from '../../src/tiny-tide/design-delta';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { SPECIES } from '../../src/tiny-tide/species';
import { HABITAT_FACTS, plan, PLANS } from '../../src/tiny-tide/plans';
import { starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { fixtureCatalogs } from './combat-fixture';
import { forwardReach } from '../../src/tiny-tide/combat-shapes';

const synthetic = (): Catalogs => fixtureCatalogs();
const mutate = (f: (c: Catalogs) => void) => { const c = structuredClone(synthetic()); f(c); return validateContract(c); };
const claw = (c: Catalogs) => c.parts.find(p => p.id === 'claw_pincer') as { -readonly [K in keyof PartSpec]: PartSpec[K] };

describe('combat contract', () => {
  it('validates the shipped catalogs and a synthetic non-empty attack and ability catalog', () => { expect(validateContract()).toEqual([]); expect(validateContract(synthetic())).toEqual([]); });
  it('rejects each broken rule with its exact message', () => {
    const cases: [(c: Catalogs) => void, string][] = [
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, id: 'other' }; }, 'habitat seabed: id'],
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, media: [] }; }, 'habitat seabed: media'],
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, maxFloorGapBodyLengths: -1 }; }, 'habitat seabed: maxFloorGapBodyLengths'],
      [c => { c.habitats.land = { ...c.habitats.land!, maxLandSlopeRadians: 2 }; }, 'habitat land: maxLandSlopeRadians'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, acceleration: -24 }; }, 'movement swimmer: acceleration'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, mode: 'teleport' as never }; }, 'movement swimmer: mode'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, facing: 'sideways' as never }; }, 'movement swimmer: facing'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, evasionProfileId: 'nope' }; }, 'movement swimmer: evasion nope'],
      [c => { c.pursuits.hunter = { ...c.pursuits.hunter!, memorySeconds: -2 }; }, 'pursuit hunter: memorySeconds'],
      [c => { c.hulls.sphere = { id: 'ball' }; }, 'hull sphere: id'],
      [c => { c.hazards['crab-pinch'] = { ...c.hazards['crab-pinch']!, cadenceSeconds: 0 }; }, 'hazard crab-pinch: cadenceSeconds'],
      [c => { c.attacks.pinch!.windupSeconds = -1; }, 'attack pinch: windupSeconds'],
      [c => { c.attacks.pinch!.aimLockAtSeconds = 1; }, 'attack pinch: aimLockAtSeconds'],
      [c => { c.attacks.pinch!.maxTargets = 1.5; }, 'attack pinch: maxTargets'],
      [c => { c.attacks.pinch!.shape = { kind: 'cone', range: 0, halfAngle: .5 }; }, 'attack pinch: shape'],
      [c => { c.attacks.pinch!.poseProfileId = 'nope'; }, 'attack pinch: pose nope'],
      [c => { c.attacks.pinch!.telegraphProfileId = 'nope'; }, 'attack pinch: telegraph nope'],
      [c => { c.abilities.dash!.effectProfileId = 'nope'; }, 'ability dash: effect nope'],
      [c => { c.abilities.dash!.allowedMotionModes = ['warp' as never]; }, 'ability dash: mode warp'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, forward: { x: Number.NaN, y: 0, z: 1 } }]; }, 'part claw_pincer: socket pinch forward'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, forward: { x: 0, y: 0, z: 2 } }]; }, 'part claw_pincer: socket pinch forward'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, pivot: { kind: 'seg', index: 9 } }]; }, 'part claw_pincer: socket pinch pivot'],
      [c => { claw(c).sockets = [claw(c).sockets[0]!, claw(c).sockets[0]!]; }, 'part claw_pincer: duplicate socket pinch'],
      [c => { claw(c).traits = ['laser' as never]; }, 'part claw_pincer: trait laser'],
      [c => { claw(c).basicAttacks = [{ id: 'a', attackId: 'pinch', socketIds: ['nope'] }]; }, 'part claw_pincer: grant a socket nope'],
      [c => { claw(c).basicAttacks = [{ id: 'a', attackId: 'nope', socketIds: ['pinch'] }]; }, 'part claw_pincer: attack nope'],
      [c => { claw(c).activeGrants = [{ id: 'g', abilityId: 'dash', socketIds: [], mirrorPolicy: 'shared-cast' }, { id: 'g', abilityId: 'dash', socketIds: [], mirrorPolicy: 'shared-cast' }]; }, 'part claw_pincer: duplicate grant g'],
      [c => { c.species[0] = { ...c.species[0]!, habitatProfileId: 'nope' }; }, 'species 0:plant: habitat nope'],
      [c => { c.species = c.species.map(s => s.key === '2:ray' ? { ...s, pursuitId: 'none' } : s); }, 'species 2:ray: fights without pursuit'],
      [c => { c.species = c.species.map(s => s.key === '1:jellyfish' ? { ...s, contactHazardId: undefined } : s); }, 'species 1:jellyfish: hazard missing'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, physics: { massPerBodyLength: 0, knockbackResistance: .2 } } : p); }, 'plan swimmer: mass'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, physics: { massPerBodyLength: 1, knockbackResistance: 1.5 } } : p); }, 'plan swimmer: resistance'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, hullProfile: 'blob' as never } : p); }, 'plan swimmer: hull blob'],
      [c => { c.rig.tail_paddle!['seg:1'] = { ...c.rig.tail_paddle!['seg:1']!, parent: 'seg:9' }; }, 'rig tail_paddle seg:1: parent'],
      [c => { c.rig.tail_paddle!['seg:0'] = { ...c.rig.tail_paddle!['seg:0']!, parent: 'seg:3' }; }, 'rig tail_paddle seg:0: cycle'],
      [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, pre: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: pre'],
      [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, q: [0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: q'],
      // V1
      [c => { c.telegraphs['amber-rear'] = { ...c.telegraphs['amber-rear']!, id: 'x' }; }, 'telegraph amber-rear: id'],
      [c => { c.effects.hit = { ...c.effects.hit!, id: 'x' }; }, 'effect hit: id'],
      [c => { c.evasions['fx-dash'] = { ...c.evasions['fx-dash']!, id: 'x' }; }, 'evasion fx-dash: id'],
      [c => { c.guards['fx-brace'] = { ...c.guards['fx-brace']!, id: 'x' }; }, 'guard fx-brace: id'],
      [c => { c.behaviours['fx-hunter'] = { ...c.behaviours['fx-hunter']!, id: 'x' }; }, 'behaviour fx-hunter: id'],
      // V2
      [c => { c.attacks.poke!.damageUnit = 'hearts' as never; }, 'attack poke: damageUnit'],
      [c => { c.attacks.poke!.aimMode = 'psychic' as never; }, 'attack poke: aimMode'],
      [c => { c.attacks.poke!.origin = 'target'; }, 'attack poke: origin'],   // review R4: a target origin needs fixed-at-start
      [c => { c.attacks.poke!.origin = 'beside' as never; c.attacks.poke!.aimMode = 'fixed-at-start'; c.attacks.poke!.aimLockAtSeconds = 0; }, 'attack poke: origin'],
      [c => { c.attacks.poke!.moveSpeedFactor = 1.2; }, 'attack poke: moveSpeedFactor'],
      [c => { c.attacks.poke!.poiseDamageMultiplier = -1; }, 'attack poke: poiseDamageMultiplier'],
      // V3
      [c => { c.attacks.poke!.lunge = { distanceBodyLengths: 0 }; }, 'attack poke: lunge'],
      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, seconds: 0 }; }, 'attack wrap: hold'],
      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, sizeFactor: -1 }; }, 'attack wrap: hold'],
      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, squeezeEverySeconds: 0 }; }, 'attack wrap: hold'],
      // V4
      [c => { c.attacks.poke!.statusEffectId = 'hit'; }, 'attack poke: status hit'],
      [c => { c.attacks.poke!.statusEffectId = 'nope'; }, 'attack poke: status nope'],
      // V5
      [c => { c.attacks.pinch!.scaling = { reach: .5 }; }, 'attack pinch: scaling key reach'],
      [c => { c.attacks.pinch!.scaling = { 'shape.range': Number.NaN }; }, 'attack pinch: scaling value shape.range'],
      [c => { c.attacks.pinch!.pair = { multiply: { damage: .9 }, add: {} }; }, 'attack pinch: pair multiplier damage'],
      [c => { c.attacks.pinch!.scaling = { 'hold.seconds': .3 }; }, 'attack pinch: scaling key hold.seconds'],
      // V6
      [c => { c.attacks.wrap!.telegraphProfileId = 'amber-coil'; }, 'attack wrap: telegraph colour'],
      [c => { c.attacks.poke!.telegraphProfileId = 'red-coil'; }, 'attack poke: telegraph colour'],
      [c => { c.attacks.pinch!.telegraphProfileId = 'amber-rear'; }, 'attack pinch: telegraph colour'],
      // V7
      [c => { c.attacks.poke!.aimLockAtSeconds = .31; }, 'attack poke: lock before active'],
      [c => { c.attacks.poke!.aimMode = 'centre'; }, 'attack poke: lock before active'],
      // V8
      [c => { c.attacks.poke!.windupSeconds = .44; c.attacks.poke!.aimLockAtSeconds = .2; }, 'attack poke: windup below 0.45 at size 0 (1:fx_hunter)'],
      [c => { c.attacks.smash!.windupSeconds = .5; c.attacks.smash!.aimLockAtSeconds = .3; }, 'attack smash: windup below 0.55 at size 0 (1:fx_alpha)'],
      // V9
      [c => { c.abilities.dash!.kind = 'teleport' as never; }, 'ability dash: kind'],
      [c => { c.abilities.dash!.input = 'hold'; }, 'ability dash: input'],
      [c => { c.abilities.brace!.input = 'press'; }, 'ability brace: input'],
      [c => { c.abilities.grab!.attackId = 'nope'; }, 'ability grab: attack nope'],
      [c => { c.abilities.counter!.guardProfileId = 'fx-brace'; }, 'ability counter: guard fx-brace'],
      [c => { c.abilities.dash!.evasionProfileId = undefined; }, 'ability dash: evasion undefined'],
      [c => { c.abilities.dash!.attackId = 'pinch'; }, 'ability dash: attack pinch'],
      // V10
      [c => { c.abilities.dash!.scaling = { 'guard.blockFraction': .2 }; }, 'ability dash: scaling key guard.blockFraction'],
      [c => { c.abilities.grab!.scaling = { 'attack.nope': .2 }; }, 'ability grab: scaling key attack.nope'],
      [c => { c.abilities.grab!.pair = { multiply: { 'attack.damage': .5 }, add: {} }; }, 'ability grab: pair multiplier attack.damage'],
      [c => { c.abilities.dash!.scaling = { cooldownSeconds: Infinity }; }, 'ability dash: scaling value cooldownSeconds'],
      [c => { c.abilities.dash!.pair = { multiply: { cooldownSeconds: 1.2 }, add: {} }; }, 'ability dash: pair multiplier cooldownSeconds'],
      // V11
      [c => { c.guards['fx-brace']!.blockFraction = 1.2; }, 'guard fx-brace: blockFraction'],
      [c => { c.guards['fx-brace']!.frontHalfAngle = 0; }, 'guard fx-brace: frontHalfAngle'],
      [c => { c.guards['fx-brace']!.windowSeconds = .2; }, 'guard fx-brace: windowSeconds'],
      [c => { c.guards['fx-counter']!.breakHalfHearts = 3; }, 'guard fx-counter: breakHalfHearts'],
      [c => { c.guards['fx-counter']!.startupSeconds = -1; }, 'guard fx-counter: startupSeconds'],
      // V12
      [c => { c.evasions['fx-dash']!.travelSeconds = 0; }, 'evasion fx-dash: travelSeconds'],
      [c => { c.evasions['fx-dash']!.distanceBodyLengths = 0; }, 'evasion fx-dash: distanceBodyLengths'],
      [c => { c.evasions['fx-dash']!.endSpeedCarry = 2; }, 'evasion fx-dash: endSpeedCarry'],
      // V13
      [c => { c.telegraphs['amber-rear']!.poseCue = 'dance' as never; }, 'telegraph amber-rear: enum'],
      [c => { c.telegraphs['amber-rear']!.flashLeadSeconds = .5; }, 'telegraph amber-rear: flashLeadSeconds'],
      [c => { c.effects.ink!.status = { id: 'inked', seconds: 0, speedFactor: .7 }; }, 'effect ink: status'],
      [c => { c.effects.hit!.sound = 'boom' as never; }, 'effect hit: enum'],
      // V14
      [c => { c.behaviours['fx-hunter']!.type = 'boss' as never; }, 'behaviour fx-hunter: type'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'nope', band: [0, 1], weight: 1 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: attack nope missing'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'pinch', band: [0, 1], weight: 1 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: attack pinch unit'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }]; }, 'behaviour fx-hunter: 1:fx_hunter attack wrap unused'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1, chainNextId: 'smash' }]; }, 'behaviour fx-hunter: smash not in 1:fx_hunter attackIds'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [1, 1], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: band poke'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 0 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: weight poke'],
      [c => { c.behaviours['fx-hunter']!.gapSeconds = -1; }, 'behaviour fx-hunter: durations'],
      [c => { c.behaviours['fx-hunter']!.repositionSeconds = [1.2, .6]; }, 'behaviour fx-hunter: repositionSeconds'],
      // V15
      [c => { c.behaviours['fx-fleer']!.flee = undefined; }, 'behaviour fx-fleer: flee'],
      [c => { c.behaviours['fx-fleer']!.school = { radiusBodyLengths: 6, groupSize: 4 }; }, 'behaviour fx-fleer: school'],
      [c => { c.behaviours['fx-hunter']!.den = { triggerBodyLengths: .9, outSeconds: 4, attackId: 'poke' }; }, 'behaviour fx-hunter: den'],
      [c => { c.behaviours['fx-hunter']!.lair = { radiusBodyLengths: 2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 }; }, 'behaviour fx-hunter: lair'],
      [c => { c.behaviours['fx-alpha']!.phases = [...c.behaviours['fx-alpha']!.phases!].reverse(); }, 'behaviour fx-alpha: phase order'],
      [c => { c.behaviours['fx-alpha']!.phases = c.behaviours['fx-alpha']!.phases!.map(p => ({ ...p, pattern: 'burrow' as const })); }, 'behaviour fx-alpha: phase 0 pattern'],
      // V16
      [c => { claw(c).activeGrants = []; }, 'part claw_pincer: grants'],
      [c => { claw(c).activeGrants = [{ id: 'grab', abilityId: 'counter-spike', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' }]; }, 'part claw_pincer: move kind'],
      [c => { c.parts = c.parts.map(p => p.id === 'mouth_snapper' ? { ...p, basicAttacks: [] } : p); }, 'part mouth_snapper: basic'],
      [c => { claw(c).basicAttacks = [{ id: 'bite', attackId: 'bite-snapper', socketIds: ['pinch'] }]; }, 'part claw_pincer: basic'],
      [c => { c.parts = c.parts.map(p => p.id === 'eye_bead' ? { ...p, activeGrants: [{ id: 'dash', abilityId: 'dash-side-fin', socketIds: [], mirrorPolicy: 'shared-cast' as const }] } : p); }, 'part eye_bead: grants'],
      // V17
      [c => { c.species = c.species.filter(s => s.key !== '1:fx_alpha'); }, 'part fx_rare: rare without one alpha'],
      [c => { c.parts = c.parts.map(p => p.id === 'fx_rare' ? { ...p, model: 'fx_rare' } : p); }, 'part fx_rare: model fx_rare'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, rewardPartId: 'claw_pincer' } } : s); }, 'species 1:fx_alpha: reward claw_pincer'],
      // V18
      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, contactHazardId: 'crab-pinch' } : s); }, 'species 1:fx_hunter: behaviour and hazard'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'fx-fleer' } : s); }, 'species 1:fx_hunter: hazard missing'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'nope' } : s); }, 'species 1:fx_hunter: behaviour nope'],
      // V19
      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, bodyScale: 3.5 } : s); }, 'species 1:fx_alpha: bodyScale'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, size: 5 } } : s); }, 'species 1:fx_alpha: alpha'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, rewardDna: 1.5 } } : s); }, 'species 1:fx_alpha: alpha'],
      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, count: 2 } : s); }, 'species 1:fx_alpha: alpha count or behaviour'],
      // V21 (review R2): a band reaches no farther than the shape from the hull front.
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.3], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: reach poke'],
      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [0, .81], weight: 1 }]; }, 'behaviour fx-hunter: reach wrap'],
      [c => { c.behaviours['fx-alpha']!.phases = c.behaviours['fx-alpha']!.phases!.map(p => ({ ...p, attacks: [{ attackId: 'smash', band: [0, 1.01], weight: 1 }] })); }, 'behaviour fx-alpha: reach smash'],
      // V20
      [c => { c.species = c.species.map(s => s.key === '0:fx_fleer' ? { ...s, model: 'eel' as never } : s); }, 'species 0:fx_fleer: model eel'],
    ];
    for (const [f, message] of cases) expect(mutate(f), message).toContain(message);
  });
  it('V21 measures the forward reach of a shape: cone range, capsule far end + radius, the full lunge capsule', () => {
    expect(forwardReach({ kind: 'cone', range: 1.2, halfAngle: .5 })).toBe(1.2);
    expect(forwardReach({ kind: 'capsule', start: { x: 0, y: 0, z: .1 }, end: { x: 0, y: 0, z: .75 }, radius: .12 })).toBeCloseTo(.87, 9);
    expect(forwardReach({ kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 1.6 })).toBe(1.6);
    const lunge = (band: number) => mutate(c => { c.attacks.wrap = { ...c.attacks.wrap!, lunge: { distanceBodyLengths: .5 } };
      c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [.2, band], weight: 1 }]; });
    expect(lunge(.8)).toEqual([]); expect(lunge(.81)).toContain('behaviour fx-hunter: reach wrap');   // a lunge reaches its full committed capsule
  });
  it('names the hostile sizes and their minimum wind-ups (spec §11.1)', () => {
    expect(hostileSizes(SPECIES.find(s => s.key === '1:crab')!)).toEqual([0, 1]);   // hunts 0; fights at its own tier 1
    expect(hostileSizes(SPECIES.find(s => s.key === '2:squid')!)).toEqual([1, 2]);
    expect(hostileSizes({ hunts: [0], fights: true, tier: 1, alpha: { size: 0, rewardPartId: 'x', rewardDna: 1 } })).toEqual([0]);
    expect([minWindup(0, false), minWindup(1, false), minWindup(2, false), minWindup(0, true), minWindup(1, true)]).toEqual([.45, .40, .40, .55, .55]);
  });
  it('gives the hit-stop of every outcome and the damage text (spec §5.9, §9.2)', () => {
    expect(hitStopFor('hit', { targetIsPlayer: true, amount: 1 })).toBeCloseTo(.06); expect(hitStopFor('hit', { targetIsPlayer: true, amount: 3 })).toBeCloseTo(.08);
    expect(hitStopFor('hit', { targetIsPlayer: true, amount: 9 })).toBeCloseTo(.09);
    expect(hitStopFor('hit', { targetIsPlayer: false, amount: 4 })).toBeCloseTo(.075);   // 60 + round(30 × .5) = 75 ms
    expect(hitStopFor('hit', { targetIsPlayer: false, amount: 20 })).toBeCloseTo(.09);
    expect([hitStopFor('countered', { targetIsPlayer: false, amount: 0 }), hitStopFor('blocked', { targetIsPlayer: true, amount: 0 }), hitStopFor('guard-broken', { targetIsPlayer: true, amount: 2 }),
      hitStopFor('grabbed', { targetIsPlayer: true, amount: 1 }), hitStopFor('evaded', { targetIsPlayer: true, amount: 2 }), hitStopFor('immune', { targetIsPlayer: true, amount: 2 })]).toEqual([.09, .06, .06, .07, 0, 0]);
    expect([damageText('hit', 'hp', 4), damageText('hit', 'half-heart', 1), damageText('hit', 'half-heart', 2), damageText('hit', 'half-heart', 3), damageText('blocked', 'half-heart', 1), damageText('countered', 'hp', 0), damageText('evaded', 'half-heart', 2)])
      .toEqual(['−4', '−½ ♥', '−1 ♥', '−1½ ♥', 'BLOCK', 'COUNTER!', 'DODGE']);
  });
  it('gives parts combat fields with unit sockets bound to real pivots', () => {
    for (const p of PARTS) for (const s of p.sockets) expect(Math.hypot(s.forward.x, s.forward.y, s.forward.z)).toBeCloseTo(1);
    expect(PARTS.find(p => p.id === 'claw_pincer')!.sockets[0]!.pivot).toEqual({ kind: 'swing', index: 0 });
    expect(PARTS.find(p => p.id === 'horn')!.traits).not.toContain('protection');
  });
  it('gives every species and plan resolvable profiles, with the balloon in the air', () => {
    for (const s of SPECIES) { expect(HABITATS[s.habitatProfileId]).toBeTruthy(); expect(MOVEMENTS[s.movementProfileId]).toBeTruthy(); expect(PURSUITS[s.pursuitId]).toBeTruthy(); }
    for (const p of PLANS) { expect(HABITATS[p.habitat]).toBeTruthy(); expect(MOVEMENTS[p.movement]).toBeTruthy(); }
    expect(SPECIES.find(s => s.key === '3:balloon')).toMatchObject({ habitatProfileId: 'sp-air', movementProfileId: 'sp-fly' });
    expect(SPECIES.find(s => s.key === '2:ray')!.pursuitId).toBe('retaliate');
    expect(habitat('sp-surface').surfaceBandBodyLengths).toBe(.6); expect(habitat('shallow-shore').wadingSupportBodyLengths).toBe(1.1); expect(habitat('sp-prop').isStaticProp).toBe(true);
    expect(HABITAT_FACTS.seabed).toEqual({ media: ['water'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null });
  });
  it('derives movement capabilities and the Breach permit', () => {
    expect(movementCapabilities(plan('crawler')!)).toEqual({ ground: true, rise: false, dive: false, breach: false, pitch: false });
    expect(movementCapabilities(plan('darter')!)).toMatchObject({ rise: true, breach: true, pitch: true });
    expect(movementCapabilities(plan('shellback')!).breach).toBe(false);
    expect(breachPermit(10)).toEqual({ id: 'breach', startsAt: 10, expiresAt: 11.9, media: ['air'], landingRequired: true });
  });
  it('makes a fresh runtime with no shared state', () => {
    const a = newRuntime(), b = newRuntime({ yaw: 1, pitch: 0 });
    expect(a).toMatchObject({ targetable: true, perceivable: true, damageable: true, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null, permit: null, arc: null, breachReadyAt: 0, groundOffset: 0, actions: [] });
    expect(a.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(a.controlledVelocity).not.toBe(b.controlledVelocity);
    expect(a.cooldowns).not.toBe(b.cooldowns); expect(b.orientation).toEqual({ yaw: 1, pitch: 0 });
  });
});

const withClaw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .2, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
const grantCatalog: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
describe('design delta', () => {
  it('lists emitters per copy', () => { expect(emittersOf(withClaw()).filter(e => e.partUid === 'p5')).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }, { kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); });
  it('removes copy 1 and changes copy 0 when a mirror is unpaired', () => {
    const d = designDelta(withClaw(), withClaw({ mirror: false }), { active: [null, null] });
    expect(d.removedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); expect(d.changedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }]);
  });
  it('treats a same-uid catalog replacement as removal of sockets it no longer has, and clears a lost grant', () => {
    const loadout = { active: [{ partUid: 'p5', grantId: 'snap' }, null] as [{ partUid: string; grantId: string }, null] };
    const d = designDelta(withClaw(), withClaw({ id: 'spike', mirror: false }), loadout, grantCatalog);
    expect(d.removedEmitters.map(e => `${e.copy}:${e.socketId}`)).toEqual(['0:pinch', '1:pinch']);
    expect(d.clearedBindings).toEqual([{ slot: 0, binding: { partUid: 'p5', grantId: 'snap' }, reason: 'grant missing' }]);
  });
  it('reports nothing for an unchanged or repainted design, and a move or a reshape as a change', () => {
    expect(designDelta(withClaw(), withClaw(), { active: [null, null] })).toEqual({ removedEmitters: [], changedEmitters: [], clearedBindings: [] });
    expect(designDelta(withClaw(), { ...withClaw(), paint: { ...withClaw().paint, base: '#000000' } }, { active: [null, null] }).changedEmitters).toEqual([]);
    expect(designDelta(withClaw(), withClaw({ t: .25 }), { active: [null, null] }).changedEmitters).toHaveLength(2);
    const reshaped = { ...withClaw(), spine: withClaw().spine.map((s, i) => i === 1 ? { ...s, radius: s.radius + .1 } : s) };
    expect(designDelta(withClaw(), reshaped, { active: [null, null] }).changedEmitters).toHaveLength(emittersOf(withClaw()).length);
  });
});
