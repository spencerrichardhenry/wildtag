import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bond,
  byId,
  count,
  nickForIndex,
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
    const result = bond([], { id: 1, speciesId: 'puffle', linked: false }, 0);
    expect(result).toBeNull();
  });

  it('appends a new idle entry for a Linked critter without mutating the input roster', () => {
    const roster: Roster = [];
    const result = bond(roster, { id: 42, speciesId: 'puffle', linked: true }, 0);
    expect(result).not.toBeNull();
    expect(result!.roster).toHaveLength(1);
    expect(result!.entry.id).toBe(42);
    expect(result!.entry.speciesId).toBe('puffle');
    expect(result!.entry.status).toEqual({ kind: 'idle' });
    expect(NAME_POOL).toContain(result!.entry.nickname);
    expect(roster).toHaveLength(0); // pure — input untouched
  });

  it('names deterministically from the shuffled pool via nameIndex', () => {
    // Same index → same name across calls (deterministic shuffle).
    expect(nickForIndex(3)).toBe(nickForIndex(3));
    const a = bond([], { id: 1, speciesId: 'puffle', linked: true }, 5)!;
    expect(a.entry.nickname).toBe(nickForIndex(5));
  });

  it('hands out distinct names for a sequential cursor until the pool is exhausted', () => {
    const names = new Set<string>();
    for (let i = 0; i < NAME_POOL.length; i++) names.add(nickForIndex(i));
    expect(names.size).toBe(NAME_POOL.length); // no dupe within one pass
    // Only after exhausting the pool does a name repeat.
    expect(nickForIndex(NAME_POOL.length)).toBe(nickForIndex(0));
  });
});

describe('release', () => {
  it('removes the entry by id, leaving the rest, without mutating the input', () => {
    const r0 = bond([], { id: 1, speciesId: 'puffle', linked: true }, 0)!.roster;
    const r1 = bond(r0, { id: 2, speciesId: 'craghorn', linked: true }, 1)!.roster;
    const after = release(r1, 1);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(2);
    expect(r1).toHaveLength(2); // pure — input untouched
  });

  it('is a no-op copy when the id is absent', () => {
    const r0 = bond([], { id: 1, speciesId: 'puffle', linked: true }, 0)!.roster;
    expect(release(r0, 999)).toHaveLength(1);
  });
});

describe('byId + count', () => {
  it('byId finds an entry or returns undefined', () => {
    const r = bond([], { id: 7, speciesId: 'puffle', linked: true }, 0)!.roster;
    expect(byId(r, 7)?.id).toBe(7);
    expect(byId(r, 8)).toBeUndefined();
  });

  it('count tallies bonded critters per species', () => {
    let r: Roster = [];
    r = bond(r, { id: 1, speciesId: 'puffle', linked: true }, 0)!.roster;
    r = bond(r, { id: 2, speciesId: 'puffle', linked: true }, 1)!.roster;
    r = bond(r, { id: 3, speciesId: 'craghorn', linked: true }, 2)!.roster;
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

describe('CritterManager.releaseSlot', () => {
  it('un-consumes a bonded slot so it persists and streams back at its home', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    const slot = findSlot();

    mgr.update(0.016, slot.home);
    mgr.setLinked(slot.id, true); // bonding requires a Linked critter
    mgr.consumeSlot(slot.id);
    expect(mgr.exportRegistry()[slot.id]?.consumed).toBe(true);

    // Release: the slot is re-opened (kept Linked) and no longer consumed.
    expect(mgr.releaseSlot(slot.id)).toBe(true);
    const entry = mgr.exportRegistry()[slot.id];
    expect(entry?.consumed).toBe(false);
    expect(entry?.linked).toBe(true);

    // It streams back in at its home on the next in-range update.
    mgr.update(0.016, slot.home);
    expect(mgr.byId(slot.id)?.linked).toBe(true);
  });

  it('survives a save/reload round-trip as a live (un-consumed) critter', () => {
    const scene = new THREE.Scene();
    const mgr = new CritterManager(scene);
    const slot = findSlot();
    mgr.update(0.016, slot.home);
    mgr.setLinked(slot.id, true);
    mgr.consumeSlot(slot.id);
    mgr.releaseSlot(slot.id);

    const mgr2 = new CritterManager(new THREE.Scene());
    mgr2.importRegistry(mgr.exportRegistry());
    mgr2.update(0.016, slot.home);
    // Not consumed → the released critter exists again after reload.
    expect(mgr2.byId(slot.id)).toBeDefined();
  });

  it('returns false for an unknown or not-consumed slot', () => {
    const mgr = new CritterManager(new THREE.Scene());
    expect(mgr.releaseSlot(-42)).toBe(false);
    expect(mgr.releaseSlot(123456)).toBe(false);
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
