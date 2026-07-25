import { describe, expect, it } from 'vitest';
import {
  assign,
  collect,
  createFarm,
  firstFreePlot,
  setDeeds,
  tick,
  unassign,
  unassignEntry,
  unlockedPlots,
  type FarmState,
} from '../src/farm/farm.ts';
import { speciesById } from '../src/critters/species.ts';
import type { RosterEntry } from '../src/critters/roster.ts';
import { FARM } from '../src/core/constants.ts';
import { decodeSave, encodeSave, type SaveV3 } from '../src/core/save.ts';
import { createInventory } from '../src/craft/inventory.ts';

// ---------------------------------------------------------------------------
// Farm core (pure): deed math, assignment rules, production/aura/hopper math,
// collection, determinism, and the optional save round-trip.
// ---------------------------------------------------------------------------

/** Build a roster entry assigned to a farm plot (only speciesId/id matter here). */
function entry(id: number, speciesId: string): RosterEntry {
  return { id, speciesId, nickname: `n${id}`, status: { kind: 'farm', plotId: 0 } };
}

describe('unlockedPlots', () => {
  it('is 2 at baseline, +2 per deed, capped at 6', () => {
    expect(unlockedPlots(0)).toBe(2);
    expect(unlockedPlots(1)).toBe(4);
    expect(unlockedPlots(2)).toBe(6);
    expect(unlockedPlots(3)).toBe(6); // capped
    expect(unlockedPlots(-5)).toBe(2); // negatives floor to baseline
  });
});

describe('createFarm / setDeeds', () => {
  it('always emits maxPlots plots with the first unlockedPlots(deeds) open', () => {
    const f = createFarm(0);
    expect(f.plots).toHaveLength(FARM.maxPlots);
    expect(f.plots.filter((p) => p.unlocked)).toHaveLength(2);
    expect(f.plots.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('setDeeds re-derives unlock flags while preserving assignments/hoppers', () => {
    let f = createFarm(0);
    f = assign(f, 0, 100);
    const g = setDeeds(f, 2);
    expect(g.plots.filter((p) => p.unlocked)).toHaveLength(6);
    expect(g.plots[0]!.assigned).toBe(100);
  });
});

describe('assign / unassign', () => {
  it('assigns a critter to an unlocked, empty plot', () => {
    const f = assign(createFarm(0), 1, 42);
    expect(f.plots[1]!.assigned).toBe(42);
  });

  it('refuses a locked plot (no-op)', () => {
    const f = createFarm(0); // plots 2..5 locked
    expect(assign(f, 3, 42)).toBe(f);
    expect(assign(f, 3, 42).plots[3]!.assigned).toBeNull();
  });

  it('refuses an already-occupied plot (no-op)', () => {
    const f = assign(createFarm(0), 0, 42);
    expect(assign(f, 0, 99)).toBe(f);
    expect(f.plots[0]!.assigned).toBe(42);
  });

  it('moves a critter off its previous plot when reassigned', () => {
    let f = assign(createFarm(1), 0, 42);
    f = assign(f, 1, 42);
    expect(f.plots[0]!.assigned).toBeNull();
    expect(f.plots[1]!.assigned).toBe(42);
  });

  it('unassign clears a plot; unassignEntry clears by roster id', () => {
    let f = assign(createFarm(0), 1, 42);
    expect(unassign(f, 1).plots[1]!.assigned).toBeNull();
    f = unassignEntry(f, 42);
    expect(f.plots[1]!.assigned).toBeNull();
  });

  it('release-while-assigned invariant: unassignEntry on a released id frees its plot', () => {
    // main.ts releaseFromRoster calls unassignEntry(farm, id) — the farm-side
    // invariant is that no plot keeps pointing at a roster id that left.
    let f = assign(createFarm(1), 2, 77);
    f = tick(f, [entry(77, 'puffle')], speciesById, FARM.producePeriod); // hopper has goods
    f = unassignEntry(f, 77);
    expect(f.plots.every((p) => p.assigned !== 77)).toBe(true);
    expect(f.plots[2]!.assigned).toBeNull();
    expect(f.plots[2]!.progress).toBe(0);
    expect(f.plots[2]!.hopper.fiber).toBe(2); // goods survive for collection
  });

  it('firstFreePlot finds the first unlocked empty plot', () => {
    let f = createFarm(0);
    expect(firstFreePlot(f)).toBe(0);
    f = assign(f, 0, 1);
    expect(firstFreePlot(f)).toBe(1);
    f = assign(f, 1, 2);
    expect(firstFreePlot(f)).toBeNull(); // plots 2..5 locked
  });
});

describe('tick — production', () => {
  it('drops the species amount into the hopper at the period boundary', () => {
    let f = assign(createFarm(0), 0, 1); // puffle: fiber x2
    const roster = [entry(1, 'puffle')];
    f = tick(f, roster, speciesById, FARM.producePeriod - 0.01);
    expect(f.plots[0]!.hopper.fiber ?? 0).toBe(0); // not yet
    f = tick(f, roster, speciesById, 0.02);
    expect(f.plots[0]!.hopper.fiber).toBe(2);
    expect(f.plots[0]!.progress).toBeCloseTo(0.01, 5);
  });

  it('aura critters produce nothing themselves', () => {
    let f = assign(createFarm(0), 0, 1); // mirefin: aura
    f = tick(f, [entry(1, 'mirefin')], speciesById, FARM.producePeriod);
    expect(f.plots[0]!.hopper).toEqual({});
  });
});

describe('tick — speed auras', () => {
  it('stacks two adjacent auras to +50% (cap), so 60s of dt completes a 90s cycle', () => {
    // puffle on plot 1, mirefin on plot 0, emberpup on plot 2 → both adjacent.
    let f = createFarm(1); // plots 0..3 unlocked
    f = assign(f, 1, 1);
    f = assign(f, 0, 2);
    f = assign(f, 2, 3);
    const roster = [entry(1, 'puffle'), entry(2, 'mirefin'), entry(3, 'emberpup')];
    const dt = FARM.producePeriod / 1.5; // 60s × 1.5 = 90s
    f = tick(f, roster, speciesById, dt);
    expect(f.plots[1]!.hopper.fiber).toBe(2);
  });

  it('a single adjacent aura (+25%) is not enough to finish in 60s', () => {
    let f = createFarm(1);
    f = assign(f, 1, 1);
    f = assign(f, 0, 2);
    const roster = [entry(1, 'puffle'), entry(2, 'mirefin')];
    f = tick(f, roster, speciesById, FARM.producePeriod / 1.5); // 60s × 1.25 = 75s
    expect(f.plots[1]!.hopper.fiber ?? 0).toBe(0);
  });
});

describe('tick — 2D grid adjacency (3×2 row-major)', () => {
  // Plot ids map onto the village farm grid row-major (cols=3):
  //   row 0: 0 1 2
  //   row 1: 3 4 5
  // so 2↔3 are opposite corners (row-wrap, NOT adjacent) and 0↔3 / 1↔4 / 2↔5
  // are vertical neighbours (adjacent).

  it('row-wrap pair 2↔3 is NOT adjacent: no aura across the corner', () => {
    let f = createFarm(2); // all 6 unlocked
    f = assign(f, 2, 1); // puffle producer at row 0, col 2
    f = assign(f, 3, 2); // mirefin aura at row 1, col 0 — opposite corner
    const roster = [entry(1, 'puffle'), entry(2, 'mirefin')];
    // 90s at 1.0× exactly completes a cycle; any aura would have finished early
    // — instead assert the un-boosted boundary behaves exactly like no aura.
    f = tick(f, roster, speciesById, FARM.producePeriod / 1.25); // 72s ×1.0 = 72s
    expect(f.plots[2]!.hopper.fiber ?? 0).toBe(0); // aura absent → not done yet
  });

  it('row-wrap pair 2↔3 is NOT adjacent: no snickerdoodle double', () => {
    let f = createFarm(2);
    f = assign(f, 2, 1);
    f = assign(f, 3, 2);
    const roster = [entry(1, 'snickerdoodle'), entry(2, 'snickerdoodle')];
    f = tick(f, roster, speciesById, FARM.producePeriod);
    expect(f.plots[2]!.hopper.fiber).toBe(1); // base amount, no double
  });

  it('vertical neighbours 1↔4 ARE adjacent: aura applies across rows', () => {
    let f = createFarm(2);
    f = assign(f, 1, 1); // puffle at row 0, col 1
    f = assign(f, 4, 2); // mirefin at row 1, col 1 — directly behind
    const roster = [entry(1, 'puffle'), entry(2, 'mirefin')];
    f = tick(f, roster, speciesById, FARM.producePeriod / 1.25); // 72s ×1.25 = 90s
    expect(f.plots[1]!.hopper.fiber).toBe(2);
  });

  it('vertical neighbours 0↔3 ARE adjacent: snickerdoodles knead across rows', () => {
    let f = createFarm(2);
    f = assign(f, 0, 1);
    f = assign(f, 3, 2);
    const roster = [entry(1, 'snickerdoodle'), entry(2, 'snickerdoodle')];
    f = tick(f, roster, speciesById, FARM.producePeriod);
    expect(f.plots[0]!.hopper.fiber).toBe(2); // doubled
  });

  it('plots 3-5 (back row) produce and stack auras like the front row', () => {
    let f = createFarm(2);
    f = assign(f, 4, 1); // puffle at row 1, col 1
    f = assign(f, 3, 2); // mirefin left
    f = assign(f, 5, 3); // emberpup right
    const roster = [entry(1, 'puffle'), entry(2, 'mirefin'), entry(3, 'emberpup')];
    f = tick(f, roster, speciesById, FARM.producePeriod / 1.5); // 60s ×1.5 = 90s
    expect(f.plots[4]!.hopper.fiber).toBe(2);
  });
});

describe('tick — snickerdoodle adjacency double', () => {
  it('doubles output when another snickerdoodle is on an adjacent plot', () => {
    let f = createFarm(0);
    f = assign(f, 0, 1);
    f = assign(f, 1, 2);
    const roster = [entry(1, 'snickerdoodle'), entry(2, 'snickerdoodle')];
    f = tick(f, roster, speciesById, FARM.producePeriod);
    expect(f.plots[0]!.hopper.fiber).toBe(2); // base 1 × 2
  });

  it('produces the base amount with no adjacent snickerdoodle', () => {
    let f = assign(createFarm(0), 0, 1);
    f = tick(f, [entry(1, 'snickerdoodle')], speciesById, FARM.producePeriod);
    expect(f.plots[0]!.hopper.fiber).toBe(1);
  });
});

describe('tick — hopper cap', () => {
  it('caps the hopper total at hopperCap', () => {
    let f = assign(createFarm(0), 0, 1); // puffle fiber x2
    const roster = [entry(1, 'puffle')];
    // Run many cycles' worth of dt in one tick.
    f = tick(f, roster, speciesById, FARM.producePeriod * 20);
    expect(f.plots[0]!.hopper.fiber).toBe(FARM.hopperCap); // 10
  });

  it('an adjacent bumblewhale raises the cap by +1', () => {
    let f = createFarm(0);
    f = assign(f, 0, 1); // puffle
    f = assign(f, 1, 2); // bumblewhale (hopperCap aura)
    const roster = [entry(1, 'puffle'), entry(2, 'bumblewhale')];
    f = tick(f, roster, speciesById, FARM.producePeriod * 20);
    expect(f.plots[0]!.hopper.fiber).toBe(FARM.hopperCap + FARM.bumblewhaleHopperBonus); // 11
  });
});

describe('tick — full-hopper banked cycle (documented semantics)', () => {
  it('holds exactly one finished cycle while full; it ships on the first tick after collect', () => {
    let f = assign(createFarm(0), 0, 1); // puffle fiber x2
    const roster = [entry(1, 'puffle')];
    f = tick(f, roster, speciesById, FARM.producePeriod * 50); // way past cap
    expect(f.plots[0]!.hopper.fiber).toBe(FARM.hopperCap);
    expect(f.plots[0]!.progress).toBe(FARM.producePeriod); // one cycle banked, no more
    f = collect(f, 0).farm;
    f = tick(f, roster, speciesById, 0.001); // instant: the banked batch ships
    expect(f.plots[0]!.hopper.fiber).toBe(2);
  });
});

describe('collect', () => {
  it('returns the hopper contents and empties the plot', () => {
    let f = assign(createFarm(0), 0, 1);
    f = tick(f, [entry(1, 'craghorn')], speciesById, FARM.producePeriod); // shard x2
    const { farm: g, gained } = collect(f, 0);
    expect(gained).toEqual([{ resource: 'shard', n: 2 }]);
    expect(g.plots[0]!.hopper).toEqual({});
  });

  it('an empty hopper yields nothing and the same farm', () => {
    const f = createFarm(0);
    const { farm: g, gained } = collect(f, 0);
    expect(gained).toEqual([]);
    expect(g).toBe(f);
  });
});

describe('tick — purity / determinism', () => {
  it('does not mutate its inputs and yields identical output for identical inputs', () => {
    const base = assign(createFarm(0), 0, 1);
    const roster = [entry(1, 'puffle')];
    const snapshot = JSON.parse(JSON.stringify(base)) as FarmState;
    const a = tick(base, roster, speciesById, FARM.producePeriod);
    const b = tick(base, roster, speciesById, FARM.producePeriod);
    expect(base).toEqual(snapshot); // input untouched
    expect(a).toEqual(b); // pure
    expect(a).not.toBe(base); // new object
  });
});

describe('save round-trip', () => {
  function baseSave(farm: FarmState | undefined): SaveV3 {
    return {
      v: 3,
      inventory: createInventory(),
      unlocks: [],
      critterPersist: {},
      structures: { ziplines: [], drones: [] },
      player: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      hints: [],
      farm,
    };
  }

  it('round-trips a farm field through encode/decode', () => {
    let f = assign(createFarm(1), 0, 7);
    f = tick(f, [entry(7, 'puffle')], speciesById, FARM.producePeriod);
    const decoded = decodeSave(encodeSave(baseSave(f)));
    expect(decoded).not.toBeNull();
    expect(decoded!.farm).toEqual(f);
  });

  it('a save without a farm field decodes with farm undefined (lossless)', () => {
    const decoded = decodeSave(encodeSave(baseSave(undefined)));
    expect(decoded).not.toBeNull();
    expect(decoded!.farm).toBeUndefined();
  });

  it('drops a malformed farm without rejecting the whole save', () => {
    const s = baseSave(undefined) as unknown as Record<string, unknown>;
    s.farm = { plots: [{ id: 'bad' }] };
    const decoded = decodeSave(JSON.stringify(s));
    expect(decoded).not.toBeNull();
    expect(decoded!.farm).toBeUndefined();
  });
});
