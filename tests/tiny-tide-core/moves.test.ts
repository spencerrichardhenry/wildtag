// tests/tiny-tide-core/moves.test.ts — every expected number is the spec §7.4 table value (computed there with the §7.3 formula).
import { describe, expect, it } from 'vitest';
import { assignSlots, clearMissingPins, movesOf, NO_PINS, nonMouthBite, placeKinds, resolveMove } from '../../src/tiny-tide/moves';
import { starterGenome, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { PARTS } from '../../src/tiny-tide/parts';
import type { MoveKind } from '../../src/tiny-tide/combat-types';

const S = [.4, 1, 1.8] as const;
const DEG = Math.PI / 180;
const at = <T>(f: (s: number) => T) => S.map(f);
const ability = (id: string, mirrored = false) => (s: number) => resolveMove({ abilityId: id }, s, { mirrored });
const bite = (id: string) => (s: number) => resolveMove({ attackId: id }, s);
const genome = (...parts: Omit<PlacedPart, 'roll' | 't' | 'angle'>[]): Genome => ({ ...starterGenome(), parts: parts.map(p => ({ t: .5, angle: 2, roll: 0, ...p })) });

describe('moves', () => {
  it('resolveMove matches the tables at .4, 1, 1.8', () => {
    const bites: [string, number[], number[], number, number[], number[], number[]][] = [
      ['bite-nibbler', [1, 2, 3], [.47, .55, .66], 40, [.09, .10, .12], [.12, .14, .17], [.05, .06, .07]],
      ['bite-snapper', [3, 4, 6], [.51, .60, .72], 30, [.14, .16, .19], [.19, .22, .26], [.09, .10, .12]],
      ['bite-beak', [2, 3, 4], [.51, .60, .72], 35, [.11, .13, .16], [.15, .18, .22], [.07, .08, .10]],
      ['bite-tyrant', [4, 6, 8], [.60, .70, .84], 30, [.17, .20, .24], [.22, .26, .31], [.10, .12, .14]],
    ];
    for (const [id, damage, range, half, windup, recovery, lock] of bites) {
      const r = at(bite(id)).map(m => m.attack!);
      expect(r.map(a => a.damage), id).toEqual(damage); expect(r.map(a => a.shape.kind === 'cone' && a.shape.range), id).toEqual(range);
      expect(r.map(a => a.windupSeconds), id).toEqual(windup); expect(r.map(a => a.recoverySeconds), id).toEqual(recovery); expect(r.map(a => a.aimLockAtSeconds), id).toEqual(lock);
      for (const a of r) { expect(a.activeSeconds).toBe(.08); expect(a.shape.kind === 'cone' && a.shape.halfAngle).toBeCloseTo(half * DEG); }
    }
    const sweeps: [string, number[], number[], number[], number[], number[], number[]][] = [
      ['sweep-fan-tail', [2, 3, 4], [.74, .90, 1.12], [6.3, 9, 12.6], [.19, .22, .26], [.26, .30, .35], [1.87, 2.2, 2.64]],
      ['sweep-fluke', [3, 4, 6], [.82, 1.0, 1.24], [7, 10, 14], [.21, .24, .28], [.28, .32, .37], [2.04, 2.4, 2.88]],
    ];
    for (const [id, damage, range, impulse, windup, recovery, cooldown] of sweeps) {
      const r = at(ability(id));
      expect(r.map(m => m.attack!.damage), id).toEqual(damage); expect(r.map(m => m.attack!.shape.kind === 'cone' && m.attack!.shape.range), id).toEqual(range);
      expect(r.map(m => m.attack!.impulse), id).toEqual(impulse); expect(r.map(m => m.attack!.windupSeconds), id).toEqual(windup);
      expect(r.map(m => m.attack!.recoverySeconds), id).toEqual(recovery); expect(r.map(m => m.cooldownSeconds), id).toEqual(cooldown);
    }
    const grabs: [string, boolean, number[], number[], number[], number[]][] = [
      ['grab-pincer', false, [1, 2, 3], [.45, .55, .68], [.79, 1.0, 1.28], [.79, 1.0, 1.28]], ['grab-pincer', true, [2, 3, 4], [.45, .55, .68], [1.03, 1.3, 1.66], [1.04, 1.25, 1.53]],
      ['grab-clawmother', false, [2, 3, 4], [.53, .65, .81], [1.03, 1.3, 1.66], [1.19, 1.5, 1.92]], ['grab-clawmother', true, [3, 5, 6], [.53, .65, .81], [1.34, 1.69, 2.16], [1.44, 1.75, 2.17]],
    ];
    for (const [id, pair, damage, range, hold, size] of grabs) {
      const r = at(ability(id, pair)), tag = `${id}${pair ? ' pair' : ''}`;
      expect(r.map(m => m.attack!.damage), tag).toEqual(damage); expect(r.map(m => m.attack!.shape.kind === 'cone' && m.attack!.shape.range), tag).toEqual(range);
      expect(r.map(m => m.attack!.hold!.seconds), tag).toEqual(hold); expect(r.map(m => m.attack!.hold!.sizeFactor), tag).toEqual(size);
      expect(r.map(m => m.attack!.windupSeconds), tag).toEqual([.16, .18, .21]); expect(r.map(m => m.cooldownSeconds), tag).toEqual([2.64, 3.0, 3.48]);
    }
    const counter = at(ability('counter-spike'));
    expect(counter.map(m => m.guard!.windowSeconds)).toEqual([.18, .22, .27]); expect(counter.map(m => m.guard!.reflectDamage)).toEqual([2, 3, 4]);
    expect(counter.map(m => m.guard!.attackerStaggerSeconds)).toEqual([.82, 1.0, 1.24]); expect(counter.map(m => m.guard!.whiffRecoverySeconds)).toEqual([.33, .40, .50]);
    expect(counter.map(m => m.cooldownSeconds)).toEqual([1.02, 1.2, 1.44]); expect(counter.map(m => m.guard!.startupSeconds)).toEqual([.04, .04, .04]);
    const brace = at(ability('brace-shell'));
    expect(brace.map(m => m.guard!.blockFraction)).toEqual([.66, .75, .87]); expect(brace.map(m => m.guard!.breakHalfHearts)).toEqual([3, 4, 6]);
    expect(brace.map(m => m.guard!.moveSpeedFactor)).toEqual([.52, .45, .36]); expect(brace.map(m => m.guard!.startupSeconds)).toEqual([.08, .10, .12]);
    expect(brace.map(m => m.cooldownSeconds)).toEqual([.4, .4, .4]); expect(brace[0]!.input).toBe('hold');
    const dashes: [string, string, number[], number[], number[], number[], number[] | null, number[] | null][] = [
      ['dash-side-fin', 'free', [1.31, 1.6, 1.98], [.16, .18, .21], [.10, .12, .15], [.90, 1.1, 1.36], [1.57, 1.92, 2.38], [.77, .94, 1.16]],
      ['dash-dorsal-fin', 'free', [1.15, 1.4, 1.74], [.16, .18, .21], [.10, .12, .15], [.82, 1.0, 1.24], null, null],
      ['dash-frill-fin', 'free', [1.23, 1.5, 1.86], [.16, .18, .21], [.10, .12, .15], [.90, 1.1, 1.36], [1.48, 1.8, 2.23], [.77, .94, 1.16]],
      ['dash-paddle-tail', 'free', [1.48, 1.8, 2.23], [.18, .20, .23], [.11, .14, .17], [1.07, 1.3, 1.61], null, null],
      ['scuttle-little-leg', 'horizontal', [1.07, 1.3, 1.61], [.14, .16, .19], [.08, .10, .12], [.74, .90, 1.12], [1.28, 1.56, 1.93], [.63, .77, .95]],
      ['scuttle-crab-leg', 'horizontal', [1.15, 1.4, 1.74], [.16, .18, .21], [.08, .10, .12], [.82, 1.0, 1.24], [1.38, 1.68, 2.08], [.70, .85, 1.05]],
    ];
    for (const [id, plane, distance, travel, recovery, cooldown, pairDistance, pairCooldown] of dashes) {
      const r = at(ability(id));
      expect(r.map(m => m.evasion!.distanceBodyLengths), id).toEqual(distance); expect(r.map(m => m.evasion!.travelSeconds), id).toEqual(travel);
      expect(r.map(m => m.evasion!.recoverySeconds), id).toEqual(recovery); expect(r.map(m => m.cooldownSeconds), id).toEqual(cooldown); expect(r[0]!.evasion!.plane).toBe(plane);
      if (pairDistance) { const p = at(ability(id, true)); expect(p.map(m => m.evasion!.distanceBodyLengths), id).toEqual(pairDistance); expect(p.map(m => m.cooldownSeconds), id).toEqual(pairCooldown); }
    }
  });
  it('pair bonus only on mirrored dash and grab parts, one rounding', () => {
    // Side fin pair at scale .45: 1.6 × (1 + .3 × −.55) = 1.336; × 1.2 = 1.6032 → 1.6 (rounding first would give 1.34 × 1.2 = 1.608 → 1.61).
    expect(resolveMove({ abilityId: 'dash-side-fin' }, .45, { mirrored: true }).evasion!.distanceBodyLengths).toBe(1.6);
    expect(resolveMove({ abilityId: 'dash-side-fin' }, 1, { mirrored: false }).evasion!.distanceBodyLengths).toBe(1.6);
    // Abilities without a pair ignore `mirrored`.
    expect(resolveMove({ abilityId: 'counter-spike' }, 1, { mirrored: true }).guard!.windowSeconds).toBe(.22);
    expect(resolveMove({ abilityId: 'brace-shell' }, 1, { mirrored: true }).guard!.blockFraction).toBe(.75);
    // Only the representative part's own mirror counts: a mirrored pincer pair holds 1.3 s, a single one 1 s.
    const pair = movesOf(genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: 1, mirror: true }));
    expect(pair.byKind.grab!.resolved.attack!.hold!.seconds).toBe(1.3);
    // Only Dash and Grab parts can mirror (the catalog).
    for (const p of PARTS.filter(x => x.mirror && x.activeGrants.length)) expect(['grab', 'dash']).toContain(p.activeGrants[0]!.id);
  });
  it('bite adds floor of non-mouth bite', () => {
    const g = genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: 1, mirror: false });
    expect(nonMouthBite(g)).toBe(1); expect(movesOf(g).basic!.resolved.attack!.damage).toBe(5);   // Snapper 4 + floor(1)
    const pair = genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: .4, mirror: true });
    expect(nonMouthBite(pair)).toBeCloseTo(1.7); expect(movesOf(pair).basic!.resolved.attack!.damage).toBe(5);   // 1 × 2 × (.75 + .1) = 1.7 → +1
    expect(movesOf(starterGenome()).basic!.resolved.attack!.damage).toBe(2);   // Nibbler at .8: 2 × .9 = 1.8 → 2; no bite stat elsewhere
  });
  it('representative part per kind', () => {
    // Two fins: the larger distance wins (Side fin 1.6 > Dorsal fin 1.4); the Paddle tail's 1.8 beats both.
    const g = genome({ uid: 'p1', id: 'mouth_nibbler', scale: 1, mirror: false }, { uid: 'p2', id: 'fin_dorsal', scale: 1, mirror: false }, { uid: 'p3', id: 'fin_side', scale: 1, mirror: false });
    expect(movesOf(g).byKind.dash!.partUid).toBe('p3');
    expect(movesOf({ ...g, parts: [...g.parts, { uid: 'p4', id: 'tail_paddle', t: 1, angle: 0, scale: 1, mirror: false, roll: 0 }] }).byKind.dash!.partUid).toBe('p4');
    // Equal numbers: the larger scale, then the mirrored part, then the lower uid.
    const tie = genome({ uid: 'p1', id: 'mouth_nibbler', scale: 1, mirror: false }, { uid: 'p7', id: 'spike', scale: 1, mirror: false }, { uid: 'p3', id: 'spike', scale: 1, mirror: false });
    expect(movesOf(tie).byKind.counter!.partUid).toBe('p3');
    expect(movesOf(tie).candidates.counter!.map(m => m.partUid)).toEqual(['p3', 'p7']);
  });
  it('assignSlots priority order', () => {
    expect(placeKinds(['sweep', 'grab', 'dash', 'counter'], NO_PINS)).toEqual({ slots: ['counter', 'dash', 'grab', 'sweep'], inactive: [] });
    expect(placeKinds(['dash'], NO_PINS)).toEqual({ slots: ['dash', null, null, null], inactive: [] });
    expect(assignSlots(starterGenome(), NO_PINS)).toEqual({ slots: ['dash', null, null, null], inactive: [] });   // the Speck starter keeps a dodge (§7.1)
  });
  it('pins win, then priority fills', () => {
    expect(placeKinds(['brace', 'dash', 'sweep'], ['sweep', null, null, 'brace'])).toEqual({ slots: ['sweep', 'dash', null, 'brace'], inactive: [] });
    // A pin for an ungranted kind is ignored; a granted kind stays in its pinned slot, so slot 1 is empty (and hidden).
    expect(placeKinds(['dash'], ['grab', null, 'dash', null])).toEqual({ slots: [null, null, 'dash', null], inactive: [] });
    expect(placeKinds(['dash', 'brace'], ['dash', 'dash', null, null])).toEqual({ slots: ['dash', 'brace', null, null], inactive: [] });   // a kind pinned twice keeps its first pin
  });
  it('fifth kind is inactive', () => {
    const all: MoveKind[] = ['grab', 'counter', 'brace', 'dash', 'sweep'];
    expect(placeKinds(all, NO_PINS)).toEqual({ slots: ['brace', 'counter', 'dash', 'grab'], inactive: ['sweep'] });
    expect(placeKinds(all, [null, null, null, 'sweep'])).toEqual({ slots: ['brace', 'counter', 'dash', 'sweep'], inactive: ['grab'] });
  });
  it('pins for missing kinds are cleared at commit', () => {
    expect(clearMissingPins(['sweep', null, 'dash', null], ['dash'])).toEqual({ pins: [null, null, 'dash', null], cleared: ['sweep'] });
    expect(clearMissingPins(NO_PINS, [])).toEqual({ pins: [null, null, null, null], cleared: [] });
  });
});
