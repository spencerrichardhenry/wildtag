import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng.ts';
import {
  bond,
  byId,
  count,
  release,
  NAME_POOL,
  type Roster,
} from '../src/critters/roster.ts';
import { CritterManager, spawnSlotsForCell, type SpawnSlot } from '../src/critters/manager.ts';

// ---------------------------------------------------------------------------
// Roster core (pure) + manager consumeSlot integration.
// ---------------------------------------------------------------------------

describe('bond', () => {
  it('requires a Linked view — an unlinked critter returns null', () => {
    const result = bond([], { id: 1, speciesId: 'puffle', linked: false }, mulberry32(1));
    expect(result).toBeNull();
  });

  it('appends a new idle entry for a Linked critter without mutating the input roster', () => {
    const roster: Roster = [];
    const result = bond(roster, { id: 42, speciesId: 'puffle', linked: true }, mulberry32(1));
    expect(result).not.toBeNull();
    expect(result!.roster).toHaveLength(1);
    expect(result!.entry.id).toBe(42);
    expect(result!.entry.speciesId).toBe('puffle');
    expect(result!.entry.status).toEqual({ kind: 'idle' });
    expect(NAME_POOL).toContain(result!.entry.nickname);
    expect(roster).toHaveLength(0); // pure — input untouched
  });

  it('picks nicknames deterministically from a seeded rng', () => {
    const a = bond([], { id: 1, speciesId: 'puffle', linked: true }, mulberry32(12345));
    const b = bond([], { id: 2, speciesId: 'puffle', linked: true }, mulberry32(12345));
    expect(a!.entry.nickname).toBe(b!.entry.nickname);

    // A single rng advanced across bonds reproduces a fixed name sequence.
    const rng = mulberry32(999);
    const first = bond([], { id: 1, speciesId: 'puffle', linked: true }, rng)!;
    const second = bond(first.roster, { id: 2, speciesId: 'puffle', linked: true }, rng)!;
    const rng2 = mulberry32(999);
    const first2 = bond([], { id: 1, speciesId: 'puffle', linked: true }, rng2)!;
    const second2 = bond(first2.roster, { id: 2, speciesId: 'puffle', linked: true }, rng2)!;
    expect(first.entry.nickname).toBe(first2.entry.nickname);
    expect(second.entry.nickname).toBe(second2.entry.nickname);
  });
});

describe('release', () => {
  it('removes the entry by id, leaving the rest, without mutating the input', () => {
    const r0 = bond([], { id: 1, speciesId: 'puffle', linked: true }, mulberry32(1))!.roster;
    const r1 = bond(r0, { id: 2, speciesId: 'craghorn', linked: true }, mulberry32(2))!.roster;
    const after = release(r1, 1);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(2);
    expect(r1).toHaveLength(2); // pure — input untouched
  });

  it('is a no-op copy when the id is absent', () => {
    const r0 = bond([], { id: 1, speciesId: 'puffle', linked: true }, mulberry32(1))!.roster;
    expect(release(r0, 999)).toHaveLength(1);
  });
});

describe('byId + count', () => {
  it('byId finds an entry or returns undefined', () => {
    const r = bond([], { id: 7, speciesId: 'puffle', linked: true }, mulberry32(1))!.roster;
    expect(byId(r, 7)?.id).toBe(7);
    expect(byId(r, 8)).toBeUndefined();
  });

  it('count tallies bonded critters per species', () => {
    let r: Roster = [];
    r = bond(r, { id: 1, speciesId: 'puffle', linked: true }, mulberry32(1))!.roster;
    r = bond(r, { id: 2, speciesId: 'puffle', linked: true }, mulberry32(2))!.roster;
    r = bond(r, { id: 3, speciesId: 'craghorn', linked: true }, mulberry32(3))!.roster;
    expect(count(r, 'puffle')).toBe(2);
    expect(count(r, 'craghorn')).toBe(1);
    expect(count(r, 'lumenstag')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Manager: consumeSlot permanently removes a bonded critter from the wild.
// ---------------------------------------------------------------------------

/** First deterministic spawn slot in a small band of cells around origin. */
function findSlot(): SpawnSlot {
  for (let cz = -6; cz <= 6; cz++) {
    for (let cx = -6; cx <= 6; cx++) {
      const slots = spawnSlotsForCell(cx, cz);
      if (slots.length > 0) return slots[0]!;
    }
  }
  throw new Error('no spawn slot found near origin');
}

describe('CritterManager.consumeSlot', () => {
  it('deactivates the bonded critter and its slot never re-activates by streaming', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    const slot = findSlot();

    // Stand on the slot's home so it streams in (nearest → activated first).
    mgr.update(0.016, slot.home);
    expect(mgr.byId(slot.id)).toBeDefined();

    mgr.consumeSlot(slot.id);
    expect(mgr.byId(slot.id)).toBeUndefined();

    // Repeated updates at the same position must never bring it back.
    for (let i = 0; i < 5; i++) mgr.update(0.016, slot.home);
    expect(mgr.byId(slot.id)).toBeUndefined();
  });

  it('the consumed flag survives a registry export/import round-trip', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    const slot = findSlot();
    mgr.update(0.016, slot.home);
    mgr.consumeSlot(slot.id);

    const exported = mgr.exportRegistry();
    expect(exported[slot.id]?.consumed).toBe(true);

    const mgr2 = new CritterManager(new THREE.Scene());
    mgr2.importRegistry(exported);
    mgr2.update(0.016, slot.home);
    expect(mgr2.byId(slot.id)).toBeUndefined(); // still consumed → never streams in
  });
});

describe('CritterManager.debugBond', () => {
  it('force-Links a spawned critter and returns its linked view', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    const id = mgr.debugSpawn('puffle', { x: 0, y: 0, z: 0 });
    expect(id).not.toBeNull();
    const view = mgr.debugBond(id!);
    expect(view?.linked).toBe(true);
  });
});
