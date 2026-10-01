import { describe, expect, it } from 'vitest';
import { applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, mealDna, PLANET_COUNT, prepareEvolution, STAGES, validateRun, type Run } from '../../src/tiny-tide/state';
import { adaptToPlan, nextUid, type Genome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';
import { species } from '../../src/tiny-tide/species';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';

const build = { coast: false };
const ready = (seed = 1) => { const r = freshRun(seed); r.stageDna = STAGES[0]!.goal; return r; };
const design = (g: Genome, id: string, diet?: 'carnivore') => { const a = adaptToPlan(g, plan(id)!, { unlocked: [], diet }, 50); if (!a.ok) throw new Error(a.reasons.join(' ')); return a.genome; };
const evolveTo = (r: Run, id: string, g: Genome, name = r.name) => { const p = prepareEvolution(r, id, g, name, build, r.nextPartSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p); };
describe('run v4', () => {
  it('starts on Speck with 20 banked DNA, a herbivore diet, an empty two-slot loadout and serial 5', () => {
    const r = freshRun(1);
    expect(r).toMatchObject({ version: 4, plans: ['speck'], diet: 'herbivore', nextPartSerial: 5, pendingRespawn: false, archive: [], notices: [], mechanics: {} });
    expect(dnaOf(r)).toBe(20); expect(r.loadout.active).toEqual([null, null]); expect(validateRun(r, build)).toEqual([]);
  });
  it('earns at risk, with the plan foraging bonus for matching food', () => {
    const r = ready(); evolveTo(r, 'crawler', r.genome);
    const before = dnaOf(r); eat(r, species(1, 'seagrape'), 0);
    expect(dnaOf(r) - before).toBe(15); expect(r.economy.wallet.atRisk).toBe(15);   // round(12 × 1.25)
  });
  it('prepares without mutating, then commits atomically, banking DNA and setting the diet', () => {
    const r = ready(), snapshot = JSON.stringify(r);
    expect('reason' in prepareEvolution(r, 'darter', r.genome, r.name, build, r.nextPartSerial)).toBe(true);
    expect(prepareEvolution(r, 'swimmer', r.genome, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: "Swimmers can't use little leg." });
    const g = design(r.genome, 'swimmer', 'carnivore'), p = prepareEvolution(r, 'swimmer', g, 'Fin', build, r.nextPartSerial);
    expect(JSON.stringify(r)).toBe(snapshot);
    if (!('planId' in p)) throw new Error('prepare'); commitEvolution(r, p);
    expect(r.plans).toEqual(['speck', 'swimmer']); expect(r.diet).toBe('carnivore'); expect(r.economy.wallet.atRisk).toBe(0); expect(validateRun(r, build)).toEqual([]);
  });
  it('rejects an evolution whose body has no start anchor, without changing the run', () => {
    const r = ready(), snapshot = JSON.stringify(r), g = design(r.genome, 'crawler');
    expect(prepareEvolution(r, 'crawler', g, r.name, { coast: false, anchorCheck: () => false }, r.nextPartSerial)).toMatchObject({ ok: false, reason: "This body can't fit anywhere at this size." });
    expect(JSON.stringify(r)).toBe(snapshot);
  });
  it('keeps the diet fixed in a normal edit', () => {
    const r = freshRun(2), g = { ...r.genome, parts: r.genome.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, id: 'mouth_snapper' } : p) };
    expect(applyDesign(r, g, r.name, build, r.nextPartSerial)).toEqual({ ok: false, reason: 'Diet is set until your next evolution.' });
  });
  it('charges edits through the ledger and reports the shortfall', () => {
    const r = freshRun(3), fins = { ...r.genome, parts: [...r.genome.parts, { uid: nextUid(5), id: 'fin_side', t: .5, angle: 1.8, scale: 1, mirror: true, roll: 0 }] };
    expect(applyDesign(r, fins, r.name, build, 6)).toEqual({ ok: true, clearedBindings: [] }); expect(dnaOf(r)).toBe(0); expect(r.nextPartSerial).toBe(6);
    const bigger = { ...fins, parts: fins.parts.map(p => p.uid === 'p5' ? { ...p, scale: 1.4 } : p) };   // round(10 × 2 × 1.2) = 24: buy 4, still 2 slots
    expect(applyDesign(r, bigger, r.name, build, 6)).toEqual({ ok: false, reason: 'Not enough DNA.', shortfall: 4 });
    const spike = { ...fins, parts: [...fins.parts, { uid: nextUid(6), id: 'spike', t: .3, angle: 0, scale: 1, mirror: false, roll: 0 }] };
    expect(applyDesign(r, spike, r.name, build, 7)).toEqual({ ok: false, reason: 'Too complex: 9 / 8 slots.' });   // structure is checked before money
    expect(dnaOf(r)).toBe(0); expect(r.genome).toEqual(fins);
  });
  it('faints once with the legacy rule and marks a pending respawn', () => {
    const r = freshRun(4); eat(r, species(0, 'plant'), 0); expect(faint(r)).toBe(true);
    expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 });   // floor(20 × .7), floor(8 × .7)
    expect(r.pendingRespawn).toBe(true); expect(r.deaths).toBe(1);
    expect(faint(r)).toBe(false); expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 }); expect(r.deaths).toBe(1);
  });
  it('computes meal DNA with one rounding', () => {
    expect(mealDna(plan('burrower')!, 'omnivore', species(2, 'plant'))).toBe(16);   // round(16 × .7 × 1.4) = round(15.68)
    expect(mealDna(plan('crawler')!, 'carnivore', species(1, 'snail'))).toBe(16);  // round(13 × 1.25) = round(16.25)
    expect(mealDna(plan('crawler')!, 'herbivore', species(1, 'snail'))).toBe(0);
  });
  it('rejects designs the v4 reader would reject, atomically', () => {
    for (const bad of [(g: Genome) => { g.paint.base = 'not-a-color'; }, (g: Genome) => { g.spine[0]!.radius = 1.2000005; }]) {
      const r = freshRun(7), g = structuredClone(r.genome); bad(g); const snapshot = JSON.stringify(r);
      expect(applyDesign(r, g, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: 'Internal check failed: genome shape' }); expect(JSON.stringify(r)).toBe(snapshot);
    }
  });
  it('rejects a run whose current ledger is invalid, without refunding it', () => {
    const r = freshRun(5); r.economy.parts.p2 = { basis: 18, credit: { banked: 9999, atRisk: 0 } };
    const snapshot = JSON.stringify(r), noEyes = { ...r.genome, parts: r.genome.parts.filter(p => p.uid !== 'p2') };
    expect(applyDesign(r, noEyes, r.name, build, r.nextPartSerial)).toMatchObject({ ok: false, reason: 'Internal check failed: ledger credit p2' }); expect(JSON.stringify(r)).toBe(snapshot);
  });
  it('keeps the serial high-water mark from the editor', () => {
    const r = freshRun(6), g = { ...r.genome, parts: [...r.genome.parts, { uid: 'p7', id: 'spike', t: .5, angle: 0, scale: 1, mirror: false, roll: 0 }] };   // p5 and p6 were reserved then removed
    expect(applyDesign(r, g, r.name, build, 9)).toMatchObject({ ok: true }); expect(r.nextPartSerial).toBe(9);
  });
  it('validates every run field', () => {
    const r = ready(); evolveTo(r, 'crawler', r.genome);
    const bad: unknown[] = [
      { ...r, plans: ['speck', 'swimmer'] }, { ...r, plans: ['speck', 'darter'] }, { ...r, diet: 'carnivore' },
      { ...r, nextPartSerial: 2 }, { ...r, loadout: { active: [null, null, null] } }, { ...r, loadout: { active: [0, null] } },
      { ...r, pendingRespawn: 'yes' }, { ...r, economy: { ...r.economy, wallet: { banked: -1, atRisk: 0 } } },
      { ...r, genome: { ...r.genome, parts: [...r.genome.parts, { ...r.genome.parts[0]! }] } },
    ];
    for (const b of bad) expect(validateRun(b as Run, build).length, JSON.stringify(b).slice(0, 60)).toBeGreaterThan(0);
    const coastRun = { ...ready(), stage: 2, plans: ['speck', 'shore_walker', 'mudskipper'] } as Run;
    expect(validateRun(coastRun, build).filter(x => x === 'needs coast')).toEqual(['needs coast']);
  });
  it('reads the current plan from the path', () => { const r = ready(); evolveTo(r, 'crawler', r.genome); expect(currentPlan(r).id).toBe('crawler'); });
});
describe('planets', () => {
  it('wins only after all 12 distinct planets', () => {
    const run = { ...freshRun(2), stage: 4 }, planet = species(4, 'planet');
    for (let i = 0; i < PLANET_COUNT - 1; i++) expect(eat(run, planet, i).win).toBe(false);
    expect(eat(run, planet, 3).dna).toBe(0);
    expect(eat(run, planet, 11).win).toBe(true); expect(run.completed).toBe(true);
  });
});

const grantParts: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
const clawRun = () => { const r = freshRun(1); r.genome.parts.push({ uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0 }); r.nextPartSerial = 6;
  r.economy.parts.p5 = { basis: 24, credit: { banked: 24, atRisk: 0 } }; r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, null]; return r; };   // claw pair: round(12 × 2 × 1) = 24
it('validates a binding against the catalog it is given', () => {
  expect(validateRun(clawRun(), build, grantParts)).toEqual([]);
  expect(validateRun(clawRun(), build)).toContain('loadout 0: grant snap');
});
it('rejects the same binding in both slots, and extra keys', () => {
  const r = clawRun(); r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, { partUid: 'p5', grantId: 'snap' }]; expect(validateRun(r, build, grantParts)).toContain('loadout: duplicate binding');
  const s = clawRun(); (s.loadout.active as unknown[])[0] = { partUid: 'p5', grantId: 'snap', extra: 1 }; expect(validateRun(s, build, grantParts)).toContain('loadout 0: shape');
});
it('clears a binding when its part is removed', () => {
  const r = clawRun(), g = structuredClone(r.genome); g.parts = g.parts.filter(p => p.uid !== 'p5');
  expect(applyDesign(r, g, r.name, build, r.nextPartSerial, grantParts)).toEqual({ ok: true, clearedBindings: [0] }); expect(r.loadout.active).toEqual([null, null]);
});
