// tests/tiny-tide-core/adapt.test.ts
import { describe, expect, it } from 'vitest';
import { adaptToPlan, nextUid, partStats, problems, starterFor, starterGenome, STARTER_NEXT_SERIAL, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { plan, PLANS } from '../../src/tiny-tide/plans';

let s = 50;
const P = (id: string, t: number, angle = 0, extra: Partial<PlacedPart> = {}): PlacedPart => ({ uid: nextUid(s++), id, t, angle, scale: 1, mirror: false, roll: 0, ...extra });
const ctx = { unlocked: [] as string[] };
const adapt = (g: Genome, id: string, c = ctx) => adaptToPlan(g, plan(id)!, c, 900);
const ok = (g: Genome, id: string) => { const a = adapt(g, id); if (!a.ok) throw new Error(`${id}: ${a.reasons.join(' ')}`); return a; };
const valid = (g: Genome, id: string) => expect(problems(g, plan(id)!, ctx).filter(p => p.code !== 'dna')).toEqual([]);

describe('adaptToPlan', () => {
  it('turns the starter into a Swimmer by removing the legs only', () => {
    const a = ok(starterGenome(), 'swimmer'); valid(a.genome, 'swimmer');
    expect(a.changes).toEqual(['Little leg removed: Swimmers can\'t use it.']); expect(a.genome.parts.map(p => p.uid)).toEqual(['p1', 'p2', 'p3']);
  });
  it('adds Shellback armor to the middle and keeps the eyes', () => {
    const a = ok(starterGenome(), 'shellback'); valid(a.genome, 'shellback');
    expect(a.genome.parts.some(p => p.id === 'eye_stalk')).toBe(true);
    expect(partStats(a.genome).armor).toBeGreaterThanOrEqual(2);
    for (const p of a.genome.parts.filter(p => p.id === 'spike')) expect(p.t).toBeGreaterThanOrEqual(.25);
  });
  it('satisfies a capability with a protective part, never with a horn', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('horn', .5), P('leg_little', .45, 2.47, { mirror: true })] };
    const a = ok(g, 'shellback'); expect(partStats(a.genome).armor).toBeGreaterThanOrEqual(2);
  });
  it('moves a part to the nearest region that allows it before removing anything', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('fin_side', .9, 1.6), P('tail_paddle', 1), P('leg_little', .45, 2.47, { mirror: true })] };
    const a = ok(g, 'crawler'); const fin = a.genome.parts.find(p => p.id === 'fin_side')!;
    expect(fin.t).toBe(.5); expect(a.changes).toContain('Side fin moved to the middle.');
  });
  it('fills a full head with a mouth by removing the cheapest optional part', () => {
    // head 4/4 with no mouth: bead-eye pair (cost round(5×2×1)=10) and antenna pair (round(6×2×1)=12); both give sense, so the cheaper bead pair goes.
    const g = { ...starterGenome(), parts: [P('eye_bead', .1, .6, { mirror: true }), P('antenna', .1, .5, { mirror: true }), P('tail_paddle', 1)] };
    const a = ok(g, 'speck'); valid(a.genome, 'speck');
    expect(a.genome.parts.some(p => p.id === 'mouth_nibbler')).toBe(true); expect(a.genome.parts.some(p => p.id === 'antenna')).toBe(true);
    expect(a.changes).toContain('Bead eye removed: the head is full.');
  });
  it('removes a part that fits nowhere with room, even when no region is over its limit', () => {
    // Crawler: middle full with three leg pairs (6/6); a fin in the tail (not allowed there) has nowhere to go: the head forbids fins.
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('leg_little', .3, 2.47, { mirror: true }), P('leg_little', .45, 2.47, { mirror: true }), P('leg_little', .6, 2.47, { mirror: true }), P('fin_side', .9, 1.6)] };
    const a = ok(g, 'crawler'); valid(a.genome, 'crawler'); expect(a.changes).toContain('Side fin removed: no room for it on a Crawler.');
  });
  it('replaces a full tail of fins with a required tail', () => {
    const g = { ...starterGenome(), parts: [P('mouth_nibbler', 0), P('eye_stalk', .16, .5, { mirror: true }), P('fin_side', .95, 1.6), P('fin_side', .9, 1.6)] };
    const a = ok(g, 'swimmer'); valid(a.genome, 'swimmer'); expect(a.genome.parts.some(p => p.id === 'tail_paddle')).toBe(true);
  });
  it('replaces a mouth of the wrong diet when a diet is given', () => {
    const a = adaptToPlan(starterGenome(), plan('swimmer')!, { unlocked: [], diet: 'carnivore' }, 900);
    expect(a.ok && a.genome.parts.find(p => p.id.startsWith('mouth_'))!.id).toBe('mouth_snapper');
    expect(a.ok && a.changes).toContain('Nibbler removed: your diet is now carnivore.');
  });
  it('is immutable and idempotent, and gives new parts fresh uids from nextSerial', () => {
    const g = starterGenome(), before = JSON.stringify(g), a = ok(g, 'shellback');
    expect(JSON.stringify(g)).toBe(before);
    const again = adapt(a.genome, 'shellback'); expect(again.ok && again.changes).toEqual([]);
    expect(a.genome.parts.filter(p => !['p1', 'p2', 'p3', 'p4'].includes(p.uid)).every(p => Number(p.uid.slice(1)) >= 900)).toBe(true);
  });
  it('reports failure honestly when the anchor check says no', () => {
    const a = adaptToPlan(starterGenome(), plan('speck')!, { unlocked: [], anchorCheck: () => false }, 900);
    expect(a).toEqual({ ok: false, reasons: ["This body can't fit anywhere at this size."] });
  });
  it('has a valid starter for every plan', () => { for (const p of PLANS) valid(starterFor(p), p.id); expect(STARTER_NEXT_SERIAL).toBe(5); });
});
