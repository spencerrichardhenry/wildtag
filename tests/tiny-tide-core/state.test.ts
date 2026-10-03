import { describe, expect, it } from 'vitest';
import { alphaReward, applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, hurt, killReward, mealDna, parseSave, PLANET_COUNT, prepareEvolution, STAGES, survivorBonusDue, survivorReward, unlock, validateRun, type Run } from '../../src/tiny-tide/state';
import { availableParts, isUnlocked, problems } from '../../src/tiny-tide/genome';
import { SPECIES } from '../../src/tiny-tide/species';
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
  it('faint resets stageDna and is applied once', () => {
    const r = freshRun(4); eat(r, species(0, 'plant'), 0); expect(r.stageDna).toBe(8); expect(faint(r)).toBe(true);
    expect(r.economy.wallet).toEqual({ banked: 20, atRisk: 0 }); expect(r.stageDna).toBe(0);   // the 8 DNA found at this size is gone
    expect(r.pendingRespawn).toBe(true); expect(r.deaths).toBe(1);
    eat(r, species(0, 'plant'), 1); expect(faint(r)).toBe(false); expect(r.economy.wallet).toEqual({ banked: 20, atRisk: 8 }); expect(r.deaths).toBe(1);
  });
  it('killReward by diet and growth rule', () => {
    const meat = freshRun(5); meat.diet = 'carnivore';
    const crab = { ...species(1, 'crab'), hunts: [0] }, snail = species(1, 'snail');
    expect(killReward(meat, crab)).toEqual({ dna: 24, counts: true }); expect(meat.stageDna).toBe(24); expect(meat.bites).toBe(1);   // hunts size 0: counts
    expect(killReward(meat, snail)).toEqual({ dna: 13, counts: false }); expect(meat.stageDna).toBe(24);   // tier 1, does not hunt size 0
    const omni = freshRun(5); omni.diet = 'omnivore'; expect(killReward(omni, crab).dna).toBe(17);   // round(24 × .7) = round(16.8)
    const plants = freshRun(5); expect(killReward(plants, crab)).toEqual({ dna: 0, counts: false }); expect(plants.bites).toBe(0);
    const zero = freshRun(5); zero.diet = 'carnivore'; expect(killReward(zero, { ...crab, dna: 0 })).toEqual({ dna: 0, counts: false }); expect(zero.bites).toBe(0);   // nothing paid: no bite
  });
  it('survivor bonus conditions', () => {
    const r = freshRun(6), squid = species(2, 'squid');
    expect(survivorBonusDue(r, 'hunter', { seconds: 4, windups: 1 })).toBe(true);
    expect(survivorBonusDue(r, 'hunter', { seconds: 3.9, windups: 3 })).toBe(false); expect(survivorBonusDue(r, 'hunter', { seconds: 9, windups: 0 })).toBe(false);
    expect(survivorBonusDue(r, 'prey-fighter', { seconds: 9, windups: 2 })).toBe(false); expect(survivorBonusDue(r, 'hunter-ambush', { seconds: 9, windups: 2 })).toBe(true);
    r.pendingRespawn = true; expect(survivorBonusDue(r, 'hunter', { seconds: 9, windups: 2 })).toBe(false);
    const m = freshRun(6); m.diet = 'carnivore'; expect(survivorBonusDue(m, 'hunter', { seconds: 9, windups: 2 })).toBe(false);
    const h = freshRun(6); expect(survivorReward(h, squid)).toBe(11); expect(h.stageDna).toBe(11);   // round(.35 × 30) = round(10.5)
  });
  it('unlock accepts rare parts at any stage', () => {
    const r = freshRun(8); expect(unlock(r, 'claw_mother')).toBe(true); expect(r.unlocked).toEqual(['claw_mother']);   // stage 0, the part's own stage
    expect(unlock(r, 'claw_mother')).toBe(false); expect(unlock(r, 'claw_pincer')).toBe(false);   // a common stage-0 part needs no unlock
    r.stage = 3; expect(isUnlocked('claw_mother', 3, r.unlocked)).toBe(true);
  });
  it('rare part without unlock is locked', () => {
    const r = freshRun(9), g = { ...r.genome, parts: [...r.genome.parts, { uid: 'p50', id: 'claw_mother', t: .2, angle: 2, scale: 1, mirror: false, roll: 0 }] };
    expect(problems(g, currentPlan(r), { unlocked: [] }).map(x => x.code)).toContain('locked');
    expect(problems(g, currentPlan(r), { unlocked: ['claw_mother'] }).map(x => x.code)).not.toContain('locked');
    for (const stage of [0, 2, 4]) { expect(isUnlocked('claw_mother', stage, [])).toBe(false); expect(availableParts(stage, []).some(p => p.rare)).toBe(false); }
  });
  it('alphaReward once, part unlocked', () => {
    const r = freshRun(10), mother = SPECIES.find(x => x.key === '1:clawmother')!;
    expect(alphaReward(r, mother)).toEqual({ dna: 40, part: 'claw_mother' }); expect(r.unlocked).toContain('claw_mother'); expect(r.stageDna).toBe(40);
    expect(alphaReward(r, mother)).toEqual({ dna: 0, part: null }); expect(r.stageDna).toBe(40);
    expect(alphaReward(r, species(1, 'crab'))).toEqual({ dna: 0, part: null });   // not an alpha
  });
  it('alphaReward once across a save and load (D23: the unlocked part records the defeat)', () => {
    const r = freshRun(11), mother = SPECIES.find(x => x.key === '1:clawmother')!;
    alphaReward(r, mother); const total = r.totalDna;
    const loaded = parseSave(JSON.stringify(r), build)!; expect(loaded).not.toBeNull(); expect(loaded.unlocked).toEqual(['claw_mother']);
    expect(alphaReward(loaded, mother)).toEqual({ dna: 0, part: null }); expect(loaded.stageDna).toBe(40); expect(loaded.totalDna).toBe(total);
  });
  it('hurts in half-hearts after armor', () => {
    const r = freshRun(7); r.health = 3; expect(hurt(r, 3, 2)).toBe(false); expect(r.health).toBe(2);   // 3 − floor(2 / 2) = 2 half-hearts
    expect(hurt(r, 1, 0)).toBe(false); expect(r.health).toBe(1.5); expect(hurt(r, 9, 0)).toBe(true); expect(r.health).toBe(0);
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
