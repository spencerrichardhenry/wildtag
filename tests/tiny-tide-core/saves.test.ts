import { describe, expect, it } from 'vitest';
import { commitEvolution, dnaOf, freshRun, maxHealthOf, parseSave, parseSaveWithNotes, prepareEvolution, STAGES, validateRun } from '../../src/tiny-tide/state';
import { adaptToPlan, starterGenome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';

const build = { coast: false };
const legacyParts = (parts = starterGenome().parts) => parts.map(({ uid: _u, ...p }) => p);
const v2 = (extra: object) => JSON.stringify({ version: 2, seed: 5, name: 'Old', stage: 1, dna: 30, stageDna: 10, totalDna: 40, bites: 3, elapsed: 50, deaths: 0, health: 6,
  genome: { spine: starterGenome().spine, parts: legacyParts(), paint: starterGenome().paint }, unlocked: [], eatenPlanets: [], completed: false, ...extra });
describe('v4 saves', () => {
  it('round-trips a v4 run', () => {
    const r = freshRun(1); r.stageDna = STAGES[0]!.goal;
    const g = adaptToPlan(r.genome, plan('crawler')!, { unlocked: [] }, r.nextPartSerial); if (!g.ok) throw new Error('adapt');
    const p = prepareEvolution(r, 'crawler', g.genome, r.name, build, g.nextSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p);
    expect(parseSave(JSON.stringify(r), build)).toEqual(r);
  });
  it('keeps an exactly fitting long creature unchanged instead of cutting segments', () => {
    const seven = Array.from({ length: 7 }, () => ({ radius: .6, height: .6, lift: 0 })), parts = legacyParts(starterGenome().parts.filter(p => p.id !== 'leg_little'));
    const run = parseSave(v2({ stage: 2, genome: { spine: seven, parts, paint: starterGenome().paint } }), build)!;
    expect(run.plans).toEqual(['speck', 'swimmer', 'bulk']); expect(run.genome.spine).toEqual(seven); expect(run.genome.parts.map(p => p.id)).toEqual(parts.map(p => p.id));
  });
  it('keeps a coast save, however many coast plans its path has', () => {
    const r = { ...freshRun(1), stage: 2, plans: ['speck', 'shore_walker', 'mudskipper'] };
    expect(parseSaveWithNotes(JSON.stringify(r), build)).toEqual({ status: 'kept', message: 'This creature lives on the coast. The coast is not in this version yet; your save is kept.' });
  });
  it('rejects corrupt v4 data', () => {
    const r = freshRun(1);
    for (const bad of [{ ...r, version: 5 }, { ...r, plans: 'speck' }, { ...r, economy: null }, { ...r, genome: { ...r.genome, parts: 'x' } }]) expect(parseSaveWithNotes(JSON.stringify(bad), build)).toBeNull();
  });
  it('clamps health above the current maximum on load instead of rejecting the save', () => {
    const r = freshRun(1), max = maxHealthOf(r);
    const run = parseSave(JSON.stringify({ ...r, health: max + 5 }), build)!;
    expect(run.health).toBe(max); expect(validateRun(run, build)).toEqual([]);
  });
});
describe('v2 migration', () => {
  it('sends a starter with legs and a tail to the Swimmer line, archives it, and keeps its value (30 + 14 = 44)', () => {
    const loaded = parseSaveWithNotes(v2({}), build); if (loaded?.status !== 'ok') throw new Error('load');
    const r = loaded.run;
    expect(r.plans).toEqual(['speck', 'swimmer']); expect(r.archive).toHaveLength(1); expect(r.archive[0]!.name).toBe('Old');
    expect(dnaOf(r)).toBe(44); expect(validateRun(r, build)).toEqual([]);
    expect(loaded.notes[0]).toBe('Old became a Swimmer.'); expect(loaded.notes).toContain("Little leg removed: Swimmers can't use it.");
  });
  it('sends legs without a tail to the Crawler line', () => {
    const parts = legacyParts(starterGenome().parts.filter(p => p.id !== 'tail_paddle'));
    const loaded = parseSaveWithNotes(v2({ genome: { spine: starterGenome().spine, parts, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans).toEqual(['speck', 'crawler']);
  });
  it('chooses the size-2 descendant that keeps the most parts', () => {
    const wide = { spine: starterGenome().spine.map(s => ({ ...s, radius: 1, height: .9 })), parts: legacyParts(), paint: starterGenome().paint };
    const loaded = parseSaveWithNotes(v2({ stage: 2, genome: wide }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans).toEqual(['speck', 'swimmer', 'bulk']);   // same parts kept either way; Darter shrinks the spine, Bulk does not → smaller spine change wins
    expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('covers a shortfall for required parts and says so', () => {
    const noTail = legacyParts(starterGenome().parts.filter(p => p.id !== 'tail_paddle' && p.id !== 'leg_little'));   // mouth + eyes: Swimmer line, needs a tail
    const loaded = parseSaveWithNotes(v2({ dna: 0, genome: { spine: starterGenome().spine, parts: noTail, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.notes).toContain('We covered 10 DNA for required parts.');   // Paddle tail at scale 1: round(10 × 1 × 1)
    expect(dnaOf(loaded.run)).toBe(0); expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('keeps a legal late-game design whole: Maw, wing pair and the omnivore diet', () => {
    const parts = [{ id: 'mouth_maw', t: 0, angle: 0, scale: 1, mirror: false, roll: 0 }, { id: 'eye_stalk', t: .16, angle: .5, scale: .75, mirror: true, roll: 0 },
      { id: 'tail_paddle', t: 1, angle: 0, scale: .8, mirror: false, roll: 0 }, { id: 'wing_feather', t: .4, angle: 1.2, scale: 1, mirror: true, roll: 0 }];
    const loaded = parseSaveWithNotes(v2({ stage: 3, genome: { spine: starterGenome().spine, parts, paint: starterGenome().paint } }), build); if (loaded?.status !== 'ok') throw new Error('load');
    expect(loaded.run.plans.at(-1)).toBe('sky_drifter'); expect(loaded.run.diet).toBe('omnivore');
    expect(loaded.run.genome.parts.map(p => p.id).sort()).toEqual(['eye_stalk', 'mouth_maw', 'tail_paddle', 'wing_feather']);
    expect(validateRun(loaded.run, build)).toEqual([]);
  });
  it('migrates v1 through v2', () => {
    const r = parseSave(JSON.stringify({ stage: 2, bites: 7, total: 29, elapsed: 312, eatenPlanets: [], completed: false }), build)!;
    expect(r.version).toBe(4); expect(r.plans).toHaveLength(3); expect(r.elapsed).toBe(312); expect(validateRun(r, build)).toEqual([]);
  });
  it('clamps old health into 1..max, or sets the max when it is zero', () => {
    const max = maxHealthOf(parseSave(v2({}), build)!);
    expect(parseSave(v2({ health: 999 }), build)!.health).toBe(max);
    expect(parseSave(v2({ health: 0 }), build)!.health).toBe(max);
    expect(parseSave(v2({ health: .4 }), build)!.health).toBe(1);
  });
  it('floors fractional legacy counters to whole numbers', () => {
    const r = parseSave(v2({ stageDna: 10.9, totalDna: 40.5, dna: 30.7 }), build)!;
    expect([r.stageDna, r.totalDna]).toEqual([10, 40]); expect(dnaOf(r)).toBe(44);   // 30.7 floors to 30; + 14 refund
    expect(validateRun(r, build)).toEqual([]);
  });
  it('ignores extra paint keys in legacy saves', () => {
    const paint = { ...starterGenome().paint, glow: 1 };
    const loaded = parseSaveWithNotes(v2({ genome: { spine: starterGenome().spine, parts: legacyParts(), paint } }), build);
    expect(loaded?.status).toBe('ok');
    if (loaded?.status === 'ok') expect(loaded.run.genome.paint).toEqual(starterGenome().paint);
  });
});
