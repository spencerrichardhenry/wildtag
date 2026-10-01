// tests/tiny-tide-core/genome.test.ts
import { describe, expect, it } from 'vitest';
import { derive, effectiveStats, genomeCost, instanceCount, nextUid, partCost, partStats, problems, repairLegacyGenome, sanitizeGenome, slotWeight, starterGenome, uidSerial, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';

let serial = 100;
const P = (id: string, t: number, angle = 0, extra: Partial<PlacedPart> = {}): PlacedPart => ({ uid: nextUid(serial++), id, t, angle, scale: 1, mirror: false, roll: 0, ...extra });
const codes = (g: Genome, id: string, ctx: object = {}) => problems(g, plan(id)!, { unlocked: [], ...ctx }).map(p => p.code);
const ctx = { unlocked: [] as string[] };
describe('part identity, cost and slots', () => {
  it('numbers starter parts p1..p4 and parses serials', () => {
    expect(starterGenome().parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3', 'p4']); expect(uidSerial('p12')).toBe(12); expect(uidSerial('x1')).toBeNaN(); expect(nextUid(7)).toBe('p7');
  });
  it('prices and slots parts by size', () => {
    expect(slotWeight(1.4)).toBe(1); expect(slotWeight(1.41)).toBe(2);
    expect(partCost(P('fin_side', .5, 1.8, { scale: .4 }))).toBe(7);          // round(10 × 1 × .7)
    expect(partCost(P('fin_side', .5, 1.8, { scale: 1.8 }))).toBe(14);        // round(10 × 1 × 1.4)
    expect(partCost(P('fin_side', .5, 1.8, { mirror: true }))).toBe(20);      // round(10 × 2 × 1)
    expect(instanceCount({ ...starterGenome(), parts: [P('fin_side', .5, 1.8, { mirror: true, scale: 1.6 })] })).toBe(4);  // 2 copies × weight 2
    expect(genomeCost(starterGenome())).toBe(41);                              // 0 + round(17.5)=18 + 9 + round(13.6)=14
  });
});
describe('effective stats', () => {
  it('adds plan bonuses for gameplay but checks capabilities on parts only', () => {
    const g = starterGenome();
    expect(effectiveStats(g, plan('shellback')!).armor).toBe(partStats(g).armor + 2);
    expect(codes(g, 'shellback')).toContain('capability');
  });
  it('makes negative health a real cost and positive health a real gain', () => {
    const g = starterGenome();
    expect(derive(effectiveStats(g, plan('burrower')!)).maxHealth).toBe(5);   // max(3, 6 + (0 − 1))
    expect(derive(effectiveStats(g, plan('bulk')!)).maxHealth).toBe(8);       // 6 + 2
    expect(derive({ ...partStats(g), health: -9 }).maxHealth).toBe(3);
  });
});
describe('problems', () => {
  it('accepts the starter for Speck and Crawler, rejects legs on a Swimmer', () => {
    const g = starterGenome(); expect(codes(g, 'speck')).toEqual([]); expect(codes(g, 'crawler')).toEqual([]); expect(codes(g, 'swimmer')).toContain('banned');
  });
  it('reports unknown parts, bad or duplicate uids, mouths outside the head, pole and tip mirrors, and diet', () => {
    const g = starterGenome();
    expect(codes({ ...g, parts: [...g.parts, P('laser', .5)] }, 'speck')).toContain('unknown');
    expect(codes({ ...g, parts: [...g.parts, { ...P('spike', .5), uid: 'p2' }] }, 'speck')).toContain('uid');
    expect(codes({ ...g, parts: [...g.parts, { ...P('spike', .5), uid: 'spike' }] }, 'speck')).toContain('uid');
    expect(codes({ ...g, parts: g.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, t: .9 } : p) }, 'speck')).toContain('region');
    expect(codes({ ...g, parts: [...g.parts, P('fin_side', .5, .1, { mirror: true })] }, 'speck')).toContain('mirror');
    expect(codes({ ...g, parts: [...g.parts, P('antenna', .02, 1.6, { mirror: true })] }, 'speck')).toContain('mirror');
    expect(codes(g, 'speck', { diet: 'carnivore' })).toContain('diet');
  });
  it('reports which uid overflows a full region', () => {
    const g = starterGenome(), extra = [P('spike', .3), P('spike', .4), P('spike', .5)];   // middle: legs 2 + 3 spikes = 5 > 4
    const overflow = problems({ ...g, parts: [...g.parts, ...extra] }, plan('speck')!, ctx).filter(p => p.code === 'region').map(p => p.uid);
    expect(overflow).toEqual([extra[2]!.uid]);
  });
  it('asks the injected anchor check, and reports a body that cannot fit', () => {
    expect(codes(starterGenome(), 'speck', { anchorCheck: () => false })).toContain('anchor');
    expect(codes(starterGenome(), 'speck', { anchorCheck: () => true })).toEqual([]);
  });
});
describe('strict placement and sanitizing', () => {
  it('rejects non-finite or out-of-range placements and catalog-forbidden mirrors as problems', () => {
    const g = starterGenome();
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 1.6, { mirror: true })] }, 'speck')).toContain('mirror');   // spikes can't mirror
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 0, { roll: Number.NaN })] }, 'speck')).toContain('placement');
    expect(codes({ ...g, parts: [...g.parts, P('spike', .5, 0, { scale: 2 })] }, 'speck')).toContain('placement');
    expect(codes({ ...g, parts: [...g.parts, P('spike', 1.2, 0)] }, 'speck')).toContain('placement');
    expect(codes({ ...g, spine: [{ ...g.spine[0]!, lift: Number.POSITIVE_INFINITY }, ...g.spine.slice(1)] }, 'speck')).toContain('segment');
  });
  it('reads v4 genomes strictly and repairs legacy genomes explicitly', () => {
    const g = starterGenome();
    expect(sanitizeGenome(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(sanitizeGenome({ ...g, parts: [g.parts[0], { ...g.parts[1], uid: 'p1' }] })).toBeNull();
    expect(sanitizeGenome({ ...g, parts: [{ ...g.parts[0]!, scale: 9 }] })).toBeNull();          // strict: no clamping
    const legacy = { ...g, parts: g.parts.map(({ uid: _uid, ...rest }) => rest) };
    expect(sanitizeGenome(legacy)).toBeNull();
    const repaired = repairLegacyGenome({ ...legacy, parts: [...legacy.parts, { id: 'spike', t: .5, angle: 1.6, scale: 9, mirror: true, roll: 0 }] })!;
    expect(repaired.parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']); expect(repaired.parts[4]).toMatchObject({ scale: 1.8, mirror: false });
  });
});
