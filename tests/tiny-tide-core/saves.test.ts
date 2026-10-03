import { describe, expect, it } from 'vitest';
import { commitEvolution, dnaOf, freshRun, maxHealthOf, parseSave, parseSaveWithNotes, prepareEvolution, STAGES, validateRun } from '../../src/tiny-tide/state';
import { adaptToPlan, starterGenome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';
import { resolveRespawn } from '../../src/tiny-tide/lifecycle';
import { newRuntime } from '../../src/tiny-tide/combat-types';

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
  it('v4 save with loadout.active loads as four empty pins', () => {
    const r = freshRun(1), old = { ...r, loadout: { active: [null, null] } };
    expect(parseSave(JSON.stringify(old), build)!.loadout).toEqual({ slots: [null, null, null, null] });
    expect(parseSave(JSON.stringify({ ...r, loadout: { active: 'x' } }), build)).toBeNull();
  });
  it('new loadout round-trips', () => {
    const r = freshRun(1); r.loadout = { slots: [null, 'dash', null, null] };   // the Speck starter grants Dash
    expect(parseSave(JSON.stringify(r), build)!.loadout).toEqual({ slots: [null, 'dash', null, null] });
  });
  it('repairs bad pins on load instead of rejecting the save (T20 carry)', () => {
    const r = freshRun(1), load = (slots: unknown) => parseSave(JSON.stringify({ ...r, loadout: { slots } }), build)?.loadout;
    expect(load(['sweep', null, 'dash', null])).toEqual({ slots: [null, null, 'dash', null] });   // a kind the design does not grant
    expect(load([7, 'zap', null, 'dash'])).toEqual({ slots: [null, null, null, 'dash'] });       // not a kind
    expect(load(['dash', 'dash', null, null])).toEqual({ slots: ['dash', null, null, null] });   // a kind twice keeps its first pin
    expect(load(['dash'])).toEqual({ slots: ['dash', null, null, null] });                       // a short list is padded
    expect(load([null, null, null, null, 'dash'])).toEqual({ slots: [null, null, null, null] }); // a long list is cut to four
    const repaired = parseSave(JSON.stringify({ ...r, loadout: { slots: ['sweep', null, null, null] } }), build)!;
    expect(validateRun(repaired, build)).toEqual([]);
    // Only the pins change: the design, the name and the ledger survive the repair.
    expect(repaired.genome).toEqual(r.genome); expect(repaired.name).toBe(r.name); expect(repaired.economy).toEqual(r.economy); expect(repaired.nextPartSerial).toBe(r.nextPartSerial);
  });
  it('loads a pre-3a v4 save (T15-era format) as a valid run with four empty pins, and never writes the old key back', () => {
    // A save as the build before slot pins wrote it: a crawler with half-heart health and the two-slot `loadout.active`.
    const r = freshRun(9); r.stageDna = STAGES[0]!.goal;
    const g = adaptToPlan(r.genome, plan('crawler')!, { unlocked: [] }, r.nextPartSerial); if (!g.ok) throw new Error('adapt');
    const p = prepareEvolution(r, 'crawler', g.genome, r.name, build, g.nextSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p);
    const { loadout: _l, ...rest } = r, old = JSON.parse(JSON.stringify({ ...rest, health: maxHealthOf(r) - .5, loadout: { active: [null, null] } }));
    expect(Object.keys(old.loadout)).toEqual(['active']);
    const run = parseSave(JSON.stringify(old), build)!;
    expect(run.loadout).toEqual({ slots: [null, null, null, null] }); expect(run.health).toBe(maxHealthOf(r) - .5); expect(run.plans).toEqual(['speck', 'crawler']);
    expect(validateRun(run, build)).toEqual([]);
    const written = JSON.stringify(run); expect(written).not.toContain('"active"'); expect(parseSave(written, build)).toEqual(run);
  });
  it('a run with a rare unlock and slot pins survives save and load', () => {
    const r = freshRun(1); r.unlocked = ['claw_mother'];
    r.genome.parts.push({ uid: 'p5', id: 'claw_mother', t: .45, angle: 2, scale: 1, mirror: true, roll: 0 }); r.nextPartSerial = 6;
    r.economy.parts.p5 = { basis: 36, credit: { banked: 36, atRisk: 0 } };   // Clawmother pair: round(18 × 2 × 1) = 36
    r.loadout = { slots: ['grab', null, 'dash', null] };
    expect(validateRun(r, build)).toEqual([]);
    const run = parseSave(JSON.stringify(r), build)!;
    expect(run).toEqual(r); expect(run.unlocked).toEqual(['claw_mother']); expect(run.loadout).toEqual({ slots: ['grab', null, 'dash', null] });
  });
  it('half-heart health loads', () => {
    const r = freshRun(1), max = maxHealthOf(r);
    expect(parseSave(JSON.stringify({ ...r, health: 2.5 }), build)!.health).toBe(2.5);
    expect(parseSave(JSON.stringify({ ...r, health: .4 }), build)!.health).toBe(.5);   // between the steps: the nearest half heart, at least .5
    expect(parseSave(JSON.stringify({ ...r, health: 2.3 }), build)!.health).toBe(2.5);
    expect(validateRun({ ...r, health: 2.25 }, build)).toContain('health'); expect(validateRun({ ...r, health: max - .5 }, build)).toEqual([]);
  });
  it('pending respawn from the legacy rule takes no second loss', () => {
    // An older build applied its faint (keep 70 %) and saved during the faint: the respawn resolves and nothing more is taken.
    const r = freshRun(1); r.economy = { ...r.economy, wallet: { banked: 14, atRisk: 5 } }; r.pendingRespawn = true; r.deaths = 1;
    const run = parseSave(JSON.stringify(r), build)!, rt = newRuntime();
    expect(resolveRespawn(run, rt, 0, { ok: true, position: { x: 0, y: 1, z: 0 }, orientation: { yaw: 0, pitch: 0 } })).toBe(true);
    expect(run.economy.wallet).toEqual({ banked: 14, atRisk: 5 }); expect(run.deaths).toBe(1); expect(run.pendingRespawn).toBe(false);
  });
  it('loads a v4 save with zero or negative health at the maximum', () => {
    const r = freshRun(1), max = maxHealthOf(r);
    for (const health of [0, -3]) { const run = parseSave(JSON.stringify({ ...r, health }), build); expect(run?.health).toBe(max); }
  });
});
describe('v4 saves keep only the run fields (final review M18)', () => {
  it('drops unknown top-level keys when it loads a run, so they are never written back', () => {
    const r = freshRun(42), loaded = parseSave(JSON.stringify({ ...r, junk: { big: 'x'.repeat(10) }, __proto__x: 1 }), build)!;
    expect(loaded).toEqual(r);
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(r).sort());
    expect(JSON.stringify(loaded)).not.toContain('junk');
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
