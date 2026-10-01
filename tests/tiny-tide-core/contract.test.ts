// tests/tiny-tide-core/contract.test.ts
import { describe, expect, it } from 'vitest';
import { newRuntime } from '../../src/tiny-tide/combat-types';
import { defaultCatalogs, validateContract, type Catalogs } from '../../src/tiny-tide/registries';
import { breachPermit, habitat, HABITATS, movementCapabilities, MOVEMENTS, PURSUITS } from '../../src/tiny-tide/profiles';
import { designDelta, emittersOf } from '../../src/tiny-tide/design-delta';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { SPECIES } from '../../src/tiny-tide/species';
import { HABITAT_FACTS, plan, PLANS } from '../../src/tiny-tide/plans';
import { starterGenome, type Genome } from '../../src/tiny-tide/genome';

const attack = { id: 'pinch', shape: { kind: 'cone' as const, range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
  aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
  hitGroup: 'shared-grant' as const, maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium' as const, obstruction: 'terrain-and-cover' as const, telegraphProfileId: 'basic' };
const synthetic = (): Catalogs => { const c = defaultCatalogs(); return { ...c, attacks: { pinch: attack }, abilities: { dash: { id: 'dash', cooldownSeconds: 3, allowedMotionModes: ['swim'], effectProfileId: 'dash' } } }; };
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
    ];
    for (const [f, message] of cases) expect(mutate(f), message).toContain(message);
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
