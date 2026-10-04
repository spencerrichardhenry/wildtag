// tests/tiny-tide-core/bestiary.test.ts — spec §11.4–§11.6: every species attack row and behaviour as the tables give them.
import { describe, expect, it } from 'vitest';
import { BEHAVIOURS, BURROW, LAPS, MIN_WINDUP, minWindup, SPECIES_ATTACKS } from '../../src/tiny-tide/bestiary';
import { bandReach } from '../../src/tiny-tide/combat-shapes';
import { TELEGRAPHS } from '../../src/tiny-tide/combat-profiles';

// [id, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, interruptible]
const ROWS: [string, number, number, number, number, number, number, number, number, number, boolean, boolean, boolean][] = [
  ['snail-poke', .50, .30, 2.5, .12, .80, 2.5, 2, 4, .30, true, true, true], ['crab-pinch', .50, .28, 2.5, .10, .55, 1.6, 2, 3, .30, true, true, true],
  ['crab-lunge', .60, .35, 2.0, .22, .75, 3.5, 3, 6, .35, true, true, true], ['crab-sweep', .55, .30, 2.5, .14, .70, 4.0, 2, 8, .30, true, true, true],
  ['mother-pinch', .55, .30, 1.5, .10, .45, 1.4, 3, 4, .35, true, true, false], ['mother-pinch-2', .55, .30, 1.5, .10, .90, 1.4, 3, 4, .35, true, true, false],
  ['mother-lunge', .65, .40, 1.5, .22, .80, 4.0, 4, 8, .40, true, true, false], ['mother-emerge', .70, 0, 0, .15, 1.10, 2.0, 4, 10, .40, false, true, false],
  ['mother-sweep', .60, .35, 1.5, .14, .40, 3.0, 3, 9, .35, true, true, false], ['mother-pinch-rage', .55, .30, 1.5, .10, .80, 1.4, 3, 4, .35, true, true, false],
  ['puffer-burst', .55, 0, 0, .15, 1.20, 3.0, 3, 7, .35, true, true, false], ['squid-ink', .48, .25, 2.0, .30, .60, 6.0, 1, 0, 0, true, false, true],
  ['squid-grab', .55, .30, 1.8, .12, .70, 4.5, 2, 0, 0, false, true, true], ['squid-lunge', .45, .25, 1.8, .22, .80, 3.5, 3, 6, .35, true, true, true],
  ['eel-ambush', .45, .25, 2.0, .20, .70, 5.0, 3, 3, .35, true, true, true], ['eel-bite', .48, .20, 2.2, .10, .50, 1.5, 2, 3, .30, true, true, true],
  ['eel-wrap', .60, .35, 2.0, .12, .80, 6.0, 1, 0, 0, false, true, true], ['tyrant-bite', .60, .35, 1.5, .10, .60, 1.5, 3, 4, .35, true, true, false],
  ['tyrant-den-lunge', .70, .45, 1.5, .25, .90, 4.0, 4, 8, .40, true, true, false], ['tyrant-charge', .65, 0, 0, .30, .50, 2.0, 4, 10, .40, true, true, false],
  ['tyrant-whirl', .80, 0, 0, .60, 1.20, 5.0, 3, 8, .35, false, false, false],
];
/** Spec §11.1: the hostiles of each size and the attacks they use (the alphas use the alpha floor). */
const ROSTER: { size: number; alpha: boolean; behaviours: string[] }[] = [
  { size: 0, alpha: false, behaviours: ['spiny-snail', 'crab'] }, { size: 0, alpha: true, behaviours: ['clawmother'] },
  { size: 1, alpha: false, behaviours: ['crab', 'puffer', 'squid', 'eel'] }, { size: 1, alpha: true, behaviours: ['reef-tyrant'] },
];
const attacksOf = (id: string) => { const b = BEHAVIOURS[id]!; return [...b.attacks, ...(b.phases ?? []).flatMap(p => p.attacks)].flatMap(c => [c.attackId, ...(c.chainNextId ? [c.chainNextId] : [])])
  .concat(b.den ? [b.den.attackId] : [], (b.phases ?? []).flatMap(p => p.patternAttackId ? [p.patternAttackId] : [])); };

describe('bestiary', () => {
  it('gives every species attack the §11.5 row', () => {
    expect(Object.keys(SPECIES_ATTACKS).sort()).toEqual(ROWS.map(r => r[0]).sort());
    for (const [id, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, int] of ROWS) {
      expect(SPECIES_ATTACKS[id], id).toMatchObject({ windupSeconds: windup, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: track, activeSeconds: active, recoverySeconds: recovery,
        cooldownSeconds: cooldown, damage, impulse, staggerSeconds: stagger, blockable: block, parryable: parry, interruptible: int, damageUnit: 'half-heart', maxTargets: 1, crossing: 'same-medium' });
      const t = TELEGRAPHS[SPECIES_ATTACKS[id]!.telegraphProfileId]!;
      expect(t.color, id).toBe(block ? 'amber' : 'red');
    }
    expect(SPECIES_ATTACKS['squid-grab']!.hold).toEqual({ seconds: 1.0, sizeFactor: 1.2, startHalfHearts: 2, squeezeHalfHearts: 1, squeezeEverySeconds: .5 });
    expect(SPECIES_ATTACKS['eel-wrap']!.hold).toEqual({ seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 });
    expect(SPECIES_ATTACKS['tyrant-whirl']).toMatchObject({ aimMode: 'centre', maxHitsPerTarget: 2, repeatHitSeconds: .3 });
    expect(SPECIES_ATTACKS['squid-ink']!.statusEffectId).toBe('ink');
    expect(SPECIES_ATTACKS['crab-lunge']!.lunge).toEqual({ distanceBodyLengths: 1.2 });
  });
  it('MIN_WINDUP holds for every hostile attack', () => {
    for (const r of ROSTER) for (const b of r.behaviours) for (const id of attacksOf(b))
      expect(SPECIES_ATTACKS[id]!.windupSeconds, `${id} at size ${r.size}`).toBeGreaterThanOrEqual(minWindup(r.size, r.alpha));
  });
  it('V21: every band ends within the forward reach of its attack; the emerge is placed at the target', () => {
    for (const b of Object.values(BEHAVIOURS)) for (const c of [...b.attacks, ...(b.phases ?? []).flatMap(p => p.attacks)])
      expect(c.band[1], c.attackId).toBeLessThanOrEqual(bandReach(SPECIES_ATTACKS[c.attackId]!) + 1e-9);
    expect(SPECIES_ATTACKS['mother-emerge']!.origin).toBe('target');
  });
  it('gives the behaviours the §11.4 and §11.6 numbers', () => {
    expect(BEHAVIOURS.drifter).toMatchObject({ type: 'prey-flee', reactionSeconds: .2, flee: { seconds: 2, restSeconds: 1.2, speedFactor: 1.3 } });
    expect(BEHAVIOURS.sardine).toMatchObject({ type: 'prey-school', school: { radiusBodyLengths: 6, groupSize: 4 }, flee: { seconds: 2.5, restSeconds: 1.5 } });
    expect(BEHAVIOURS['spiny-snail']).toMatchObject({ type: 'prey-fighter', gapSeconds: 2.5, trigger: { radiusBodyLengths: 1.2, seconds: 1 } });
    expect(BEHAVIOURS.crab!.attacks.map(a => [a.attackId, a.band, a.weight, a.flankWeight])).toEqual([['crab-pinch', [0, .45], 3, undefined], ['crab-lunge', [.5, 1.4], 2, undefined], ['crab-sweep', [0, .6], 1, 3]]);
    expect(BEHAVIOURS.eel).toMatchObject({ type: 'hunter-ambush', den: { triggerBodyLengths: .9, outSeconds: 4, attackId: 'eel-ambush' }, repositionSeconds: [.5, 1] });
    expect(BEHAVIOURS.clawmother!.phases!.map(p => [p.aboveHpFraction, p.pattern, p.speedFactor, p.gapSeconds])).toEqual([[.6, 'normal', 1, 1], [.3, 'burrow', 1, .8], [0, 'normal', 1.3, .7]]);
    expect(BEHAVIOURS['reef-tyrant']!.phases!.map(p => [p.aboveHpFraction, p.pattern, p.speedFactor, p.gapSeconds, p.lairFraction])).toEqual([[.66, 'normal', 1, 1, .6], [.33, 'laps', 1.4, .6, undefined], [0, 'normal', 1.2, .8, undefined]]);
    expect(BEHAVIOURS['reef-tyrant']!.phases![2]!.attacks[0]!.band).toEqual([0, .3]);   // T23 (V21 for centre attacks): the ball (.55) reaches .3 past the hull surface
    expect(BEHAVIOURS.clawmother!.lair).toEqual({ radiusBodyLengths: 1.2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 });
  });
});

const DEG = Math.PI / 180;
type ShapeRow = { cone: [number, number] } | { cap: [number, number, number] };
/** Spec §11.5 Shape column, lunge distance and aim mode (cap: z start, z end, radius; a sphere has start = end). */
const SHAPES: Record<string, ShapeRow & { lunge?: number; aim?: string }> = {
  'snail-poke': { cone: [1.2, 50] }, 'crab-pinch': { cone: [.45, 35] }, 'crab-lunge': { cap: [0, 1.4, .22], lunge: 1.2 }, 'crab-sweep': { cone: [.65, 70] },
  'mother-pinch': { cone: [.40, 35] }, 'mother-pinch-2': { cone: [.40, 35] }, 'mother-lunge': { cap: [0, 1.0, .20], lunge: .9 }, 'mother-emerge': { cap: [0, 0, .35], aim: 'fixed-at-start' },
  'mother-sweep': { cone: [.60, 75] }, 'mother-pinch-rage': { cone: [.40, 35] }, 'puffer-burst': { cap: [0, 0, 1.6], aim: 'centre' }, 'squid-ink': { cone: [.90, 30] },
  'squid-grab': { cap: [.1, .75, .12] }, 'squid-lunge': { cap: [0, 1.1, .18], lunge: 1.0 }, 'eel-ambush': { cap: [0, 1.3, .15], lunge: 1.2 }, 'eel-bite': { cone: [.45, 35] },
  'eel-wrap': { cap: [0, .6, .20] }, 'tyrant-bite': { cone: [.40, 35] }, 'tyrant-den-lunge': { cap: [0, 1.2, .14], lunge: 1.1 },
  'tyrant-charge': { cap: [0, 1.6, .16], lunge: 1.5, aim: 'fixed-at-start' }, 'tyrant-whirl': { cap: [0, 0, .55], aim: 'centre' },
};
// [id, poise, staggerResist, knockbackResistance, grabbable, reaction, gap, reposition] (spec §11.3 and §11.4)
const BEH: [string, number, number, number, boolean, number, number, [number, number]][] = [
  ['drifter', 99, 0, 0, true, .2, 0, [0, 0]], ['sardine', 99, 0, 0, true, .2, 0, [0, 0]], ['spiny-snail', 4, 0, 0, true, .1, 2.5, [0, 0]], ['puffer', 6, 0, .2, true, .1, 3.0, [0, 0]],
  ['crab', 6, 0, .2, true, .35, 1.0, [.6, 1.2]], ['squid', 7, 0, .3, true, .35, .8, [.6, 1.2]], ['eel', 6, 0, .3, false, .35, .8, [.5, 1.0]],
  ['clawmother', 14, .5, .6, false, .35, 1.0, [.6, 1.0]], ['reef-tyrant', 16, .5, .6, false, .35, 1.0, [.6, 1.0]],
];
const list = (l: readonly { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }[]) =>
  l.map(c => [c.attackId, [...c.band], c.weight, c.flankWeight, c.chainNextId, c.chainGapSeconds]);

describe('bestiary data pinned to spec §11', () => {
  it('every attack shape, lunge and aim mode', () => {
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(SPECIES_ATTACKS).sort());
    for (const [id, r] of Object.entries(SHAPES)) {
      const a = SPECIES_ATTACKS[id]!;
      if ('cone' in r) expect(a.shape, id).toEqual({ kind: 'cone', range: r.cone[0], halfAngle: r.cone[1] * DEG });
      else expect(a.shape, id).toEqual({ kind: 'capsule', start: { x: 0, y: 0, z: r.cap[0] }, end: { x: 0, y: 0, z: r.cap[1] }, radius: r.cap[2] });
      expect(a.lunge?.distanceBodyLengths, id).toBe(r.lunge);
      expect(a.aimMode, id).toBe(r.aim ?? 'input');
    }
  });
  it('MIN_WINDUP, BURROW and LAPS', () => {
    expect(MIN_WINDUP).toEqual([{ fighter: .45, alpha: .55 }, { fighter: .40, alpha: .55 }]);
    expect(BURROW).toEqual({ sinkSeconds: .4, travelSeconds: 1.2, speedFactor: 1.6, emerges: 2 });
    expect(LAPS).toEqual({ radiusFraction: .8, charges: 2, restSeconds: 1.5 });
  });
  it('poise, resists, grabbable, reaction, gap, reposition per behaviour', () => {
    expect(Object.keys(BEHAVIOURS).sort()).toEqual(BEH.map(r => r[0]).sort());
    for (const [id, poise, sr, kr, grab, reaction, gap, repo] of BEH)
      expect(BEHAVIOURS[id], id).toMatchObject({ poise, staggerResist: sr, knockbackResistance: kr, grabbable: grab, reactionSeconds: reaction, gapSeconds: gap, repositionSeconds: repo });
    expect(BEHAVIOURS.eel!.den).toEqual({ triggerBodyLengths: .9, outSeconds: 4, attackId: 'eel-ambush' });
    expect(BEHAVIOURS['spiny-snail']!.trigger).toEqual({ radiusBodyLengths: 1.2, seconds: 1.0 });
    expect(BEHAVIOURS.puffer!.trigger).toEqual({ radiusBodyLengths: 1.1, seconds: .8 });
    expect(BEHAVIOURS.clawmother!.lair).toEqual({ radiusBodyLengths: 1.2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 });
    expect(BEHAVIOURS['reef-tyrant']!.lair).toEqual({ radiusBodyLengths: 1.39, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 });
  });
  it('attack lists: bands, weights, flank weights, chains', () => {
    const U = undefined;
    expect(list(BEHAVIOURS['spiny-snail']!.attacks)).toEqual([['snail-poke', [0, 1.2], 1, U, U, U]]);
    expect(list(BEHAVIOURS.puffer!.attacks)).toEqual([['puffer-burst', [0, 1.35], 1, U, U, U]]);
    expect(list(BEHAVIOURS.crab!.attacks)).toEqual([['crab-pinch', [0, .45], 3, U, U, U], ['crab-lunge', [.5, 1.4], 2, U, U, U], ['crab-sweep', [0, .6], 1, 3, U, U]]);
    expect(list(BEHAVIOURS.squid!.attacks)).toEqual([['squid-ink', [.3, .9], 1, U, U, U], ['squid-grab', [.2, .75], 2, U, U, U], ['squid-lunge', [.6, 1.2], 2, U, U, U]]);
    expect(list(BEHAVIOURS.eel!.attacks)).toEqual([['eel-bite', [0, .45], 3, U, U, U], ['eel-wrap', [0, .6], 1, U, U, U]]);
    const combo = ['mother-pinch', [0, .4], 3, U, 'mother-pinch-2', .55];   // T23, R13: chain gap .2 → .55 s
    const cm = BEHAVIOURS.clawmother!.phases!, rt = BEHAVIOURS['reef-tyrant']!.phases!;
    expect(list(cm[0]!.attacks)).toEqual([combo, ['mother-lunge', [.4, 1.0], 1, U, U, U]]);
    expect(list(cm[1]!.attacks)).toEqual([combo]);
    expect(list(cm[2]!.attacks)).toEqual([['mother-sweep', [0, .6], 2, U, 'mother-pinch-rage', .55], ['mother-pinch', [0, .4], 1, U, 'mother-pinch-2', .55]]);
    expect(cm.map(p => p.patternAttackId)).toEqual([undefined, 'mother-emerge', undefined]);
    expect(list(rt[0]!.attacks)).toEqual([['tyrant-bite', [0, .4], 3, U, U, U], ['tyrant-den-lunge', [.4, 1.2], 2, U, U, U]]);
    expect(list(rt[1]!.attacks)).toEqual([]);
    expect(list(rt[2]!.attacks)).toEqual([['tyrant-whirl', [0, .3], 2, U, U, U], ['tyrant-bite', [0, .4], 2, U, U, U]]);
    expect(rt.map(p => p.patternAttackId)).toEqual([undefined, 'tyrant-charge', undefined]);
  });
});

// Final review I7 (controller ruling): eel-bite and squid-ink had a Brace reaction cliff (threshold .33 s: 100 % blocked at .25 s, 0 % at .35 s).
// Their wind-ups go .45 → .48 s; the aim lock stays at least .2 s before the active phase.
describe('Brace room on the .45 s hunter attacks (final review I7)', () => {
  it('eel-bite and squid-ink wind up for .48 s with the lock at least .2 s before active', () => {
    for (const id of ['eel-bite', 'squid-ink']) {
      const a = SPECIES_ATTACKS[id]!;
      expect(a.windupSeconds, id).toBeCloseTo(.48, 9);
      expect(a.windupSeconds - a.aimLockAtSeconds, id).toBeGreaterThanOrEqual(.2 - 1e-9);
    }
  });
});

// Owner 2026-10-03 (combat 3a follow-up F2, spec §11.8): each size-0/1 hunter and alpha has one strength and one weakness, with a hint.
describe('species traits (spec §11.8)', () => {
  const DEG = Math.PI / 180;
  it('gives the crab, squid, eel, puffer and both alphas their trait rows', () => {
    expect(BEHAVIOURS.crab!.traits).toMatchObject({ frontShell: { halfAngle: 60 * DEG, factor: .5 } }); expect(BEHAVIOURS.crab!.traits!).not.toHaveProperty('grabStagger');
    expect(BEHAVIOURS.squid!.traits).toMatchObject({ grabEscape: 'dash-or-counter', sweepPoise: 2, sweepStagger: 3, staggeredBiteFactor: 2.5 }); expect(BEHAVIOURS.squid!.traits!.braceBounce).toBeUndefined();
    expect(BEHAVIOURS.eel!.traits).toMatchObject({ slippery: true, counterStun: { attackIds: ['eel-ambush'], seconds: 2.5 } });
    expect(BEHAVIOURS.eel!.grabbable).toBe(false);
    expect(BEHAVIOURS.puffer!.traits).toMatchObject({ braceBounce: { attackIds: ['puffer-burst'], seconds: 1, fullBlock: true } });
    expect(BEHAVIOURS.clawmother!.traits).toMatchObject({ counterStun: { attackIds: ['mother-emerge'], seconds: 2.5 } });
    expect(BEHAVIOURS['reef-tyrant']!.traits).toMatchObject({ braceBounce: { attackIds: ['tyrant-charge'], seconds: 1.5, noBreak: true } });
    for (const id of ['spiny-snail', 'drifter', 'sardine']) expect(BEHAVIOURS[id]!.traits, id).toBeUndefined();
  });
  it('names real attacks of the species, and a weakness is on a blockable (Brace) or parryable (Counter) attack', () => {
    for (const [id, b] of Object.entries(BEHAVIOURS)) {
      const t = b.traits; if (!t) continue;
      for (const a of t.braceBounce?.attackIds ?? []) { expect(attacksOf(id), `${id} ${a}`).toContain(a); expect(SPECIES_ATTACKS[a]!.blockable, a).toBe(true); }
      for (const a of t.counterStun?.attackIds ?? []) { expect(attacksOf(id), `${id} ${a}`).toContain(a); expect(SPECIES_ATTACKS[a]!.parryable, a).toBe(true); }
      expect(t.hint.length, id).toBeGreaterThan(20); expect(t.hint.length, id).toBeLessThanOrEqual(110); expect(t.hint, id).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
