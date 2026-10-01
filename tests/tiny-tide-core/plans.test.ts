// tests/tiny-tide-core/plans.test.ts
import { describe, expect, it } from 'vitest';
import { cardSummary, closedLinesOf, commitmentsOf, compareCapabilities, eligibleChildren, leadsTo, plan, PLANS, regionOf, ROOT_PLAN, segmentRule, violates, type BodyPlan } from '../../src/tiny-tide/plans';

const noCoast = { coast: false }, coast = { coast: true };
const completePaths = (build: { coast: boolean }, plans?: readonly BodyPlan[]) => {
  const out: string[][] = []; const walk = (path: string[]) => { const kids = eligibleChildren(path, build, plans); if (!kids.length) out.push(path); for (const k of kids) walk([...path, k.id]); };
  walk([ROOT_PLAN]); return out;
};
const texts = (a: string, b: string, good: boolean) => compareCapabilities(plan(a)!, plan(b)!).filter(c => c.good === good).map(c => c.text);

describe('body plans', () => {
  it('has unique ids, one root, and parents exactly one size lower', () => {
    expect(new Set(PLANS.map(p => p.id)).size).toBe(PLANS.length);
    expect(PLANS.filter(p => !p.parents.length).map(p => p.id)).toEqual([ROOT_PLAN]);
    for (const p of PLANS) for (const parent of p.parents) expect(plan(parent)!.size).toBe(p.size - 1);
  });
  it('makes every complete path reach size 4, with and without the coast', () => {
    for (const build of [noCoast, coast]) for (const path of completePaths(build)) expect(plan(path.at(-1)!)!.size, path.join('>')).toBe(4);
    expect(completePaths(noCoast)).toHaveLength(4);   // swimmer→darter|bulk, crawler→shellback|burrower
    expect(completePaths(coast)).toHaveLength(6);     // + shore_walker→strider→dune_giant, →mudskipper→shore_giant
  });
  it('gives both visible size-1 lines two size-2 choices', () => {
    expect(eligibleChildren([ROOT_PLAN], noCoast).map(p => p.id)).toEqual(['swimmer', 'crawler']);
    for (const id of ['swimmer', 'crawler']) expect(eligibleChildren([ROOT_PLAN, id], noCoast)).toHaveLength(2);
  });
  it('gives every size-1 line a lasting commitment that holds on every path', () => {
    for (const id of ['swimmer', 'crawler', 'shore_walker']) expect(plan(id)!.commits.length, id).toBeGreaterThan(0);
    for (const path of completePaths(coast)) for (let i = 1; i < path.length; i++)
      for (const c of commitmentsOf(path.slice(0, i))) expect(violates(plan(path[i]!)!, c), `${path.join('>')} ${c}`).toBe(false);
    expect(eligibleChildren([ROOT_PLAN, 'shore_walker', 'strider'], coast).map(p => p.id)).toEqual(['dune_giant']);
  });
  it('defines what each commitment forbids', () => {
    expect(violates(plan('sky_drifter')!, 'seabed-bound')).toBe(true); expect(violates(plan('colossus')!, 'seabed-bound')).toBe(false);
    expect(violates(plan('star_crawler')!, 'seabed-bound')).toBe(false); expect(violates(plan('mudskipper')!, 'no-swim')).toBe(true);
    expect(violates(plan('crawler')!, 'no-legs')).toBe(true); expect(violates(plan('star_swimmer')!, 'no-legs')).toBe(false);
    expect(violates(plan('sky_drifter')!, 'no-flight')).toBe(true); expect(violates(plan('dune_giant')!, 'no-flight')).toBe(false);
  });
  it('lets a keystone close a line, on eligibility', () => {
    // A probe child of Darter on the crawler line, with no legs and no commitment conflict: eligible until a keystone closes its line.
    const path = [ROOT_PLAN, 'swimmer', 'darter'], probe: BodyPlan = { ...plan('sky_drifter')!, id: 'probe', name: 'Probe', line: 'crawler' };
    const open: BodyPlan[] = [...PLANS, probe];
    expect(eligibleChildren(path, noCoast, open).map(p => p.id)).toEqual(['sky_drifter', 'probe']);
    const closed: BodyPlan[] = open.map(p => p.id === 'darter' ? { ...p, keystone: { closesLines: ['crawler'], note: 'test' } } : p);
    expect(closedLinesOf(path, closed)).toEqual(['crawler']); expect(eligibleChildren(path, noCoast, closed).map(p => p.id)).toEqual(['sky_drifter']);
  });
  it('maps t to regions with no mouth special case', () => {
    expect([0, .249, .25, .75, .751].map(regionOf)).toEqual(['head', 'head', 'middle', 'middle', 'tail']);
  });
  it('uses the head rule for the first segment and the tail rule for the last', () => {
    const s = plan('shellback')!; expect(segmentRule(s, 0, 5)).toBe(s.spine.head); expect(segmentRule(s, 4, 5)).toBe(s.spine.tail); expect(segmentRule(s, 2, 5)).toBe(s.spine.middle);
  });
});

describe('typed capability comparison', () => {
  const has = (a: string, b: string, text: string) => compareCapabilities(plan(a)!, plan(b)!).some(c => c.text === text);
  const fields = (a: BodyPlan, b: BodyPlan) => compareCapabilities(a, b).map(c => c.field);
  it('reports free swimming as a gain, never a lost seabed, and the legs commitment', () => {
    expect(texts('speck', 'swimmer', true)).toContain('Swims freely in open water');
    expect(texts('speck', 'swimmer', false).join(' ')).not.toMatch(/seabed/);
    expect(texts('speck', 'swimmer', false)).toContain('Can never grow legs again');
  });
  it('reports foraging, hearts with the base value, and per-region kinds', () => {
    expect(has('crawler', 'burrower', 'Seabed food ×1.4 (was ×1.25)')).toBe(true);
    expect(has('crawler', 'burrower', 'Hearts −1 (5 base)')).toBe(true);
    expect(has('crawler', 'burrower', 'No fins in the middle')).toBe(true);
  });
  it('reports speed, turning and braking separately', () => {
    expect(has('shellback', 'colossus', 'Faster (×0.85, was ×0.8)')).toBe(true); expect(has('shellback', 'colossus', 'Turns slower')).toBe(true); expect(has('shellback', 'colossus', 'Stops slower')).toBe(true);
  });
  it('reports forced body ranges per segment', () => {
    expect(has('swimmer', 'bulk', 'Middle at least 0.6 wide')).toBe(true); expect(has('swimmer', 'bulk', 'Middle at least 0.6 tall')).toBe(true);
    expect(has('swimmer', 'darter', 'Head at most 0.7 wide')).toBe(true); expect(has('swimmer', 'darter', 'Tail at most 0.6 wide')).toBe(true);
  });
  it('detects every field when it is the only change (single-field mutations)', () => {
    const base = plan('crawler')!;
    const cases: [Partial<BodyPlan>, string][] = [
      [{ movement: 'shellback' }, 'braking'], [{ movement: 'swimmer' }, 'pitch'], [{ habitat: 'shallow-shore' }, 'depthLimit'], [{ habitat: 'open-water' }, 'wading'],
      [{ regions: { ...base.regions, head: { ...base.regions.head, kinds: base.regions.head.kinds.filter(k => k !== 'armor') } } }, 'kind'],
      [{ regions: { ...base.regions, middle: { kinds: base.regions.middle.kinds.filter(k => k !== 'arm'), slots: 6 }, tail: { kinds: [...base.regions.tail.kinds, 'arm'], slots: 2 } } }, 'kind'],
      [{ spine: { ...base.spine, head: { radius: [.25, 1.2], height: [.4, 1.2] } } }, 'range'], [{ spine: { ...base.spine, middle: { radius: [.25, 1.2], height: [.4, .5] } } }, 'range'],
      [{ spine: { ...base.spine, middle: { ...base.spine.middle, locked: true } } }, 'locked'], [{ spine: { ...base.spine, min: 4 } }, 'segments'],
      [{ requiresKinds: [] }, 'requiresKind'], [{ requiresCapabilities: [{ stat: 'armor', min: 1, label: 'armor 1' }] }, 'requiresCapability'],
    ];
    for (const [patch, field] of cases) expect(fields(base, { ...base, ...patch }), JSON.stringify(patch).slice(0, 60)).toContain(field);
  });
  it('gives every plan at least one gain and one loss against its first parent', () => {
    for (const p of PLANS.filter(p => p.size > 0)) { const c = compareCapabilities(plan(p.parents[0]!)!, p); expect(c.some(x => x.good), `${p.id} gain`).toBe(true); expect(c.some(x => !x.good), `${p.id} loss`).toBe(true); }
  });
  it('builds card lines with this form\'s cost and the lasting sacrifice', () => {
    const b = cardSummary(plan('crawler')!, plan('burrower')!, [ROOT_PLAN, 'crawler']);
    expect(b.playstyle).toMatch(/Seabed food ×1.4/); expect(b.cost).toBe('Hearts −1 (5 base); No fins');
    expect(b.sacrifice).toBe('None new — still: never swims freely or flies');
    expect(cardSummary(plan('speck')!, plan('crawler')!, [ROOT_PLAN]).sacrifice).toBe('Never swims freely or flies');
  });
  it('lists where a choice leads', () => { expect(leadsTo(plan('crawler')!, [ROOT_PLAN], noCoast)).toEqual(['Shellback', 'Burrower']); });
});
