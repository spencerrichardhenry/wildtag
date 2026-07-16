import { describe, expect, it } from 'vitest';
import {
  applyStartingLoadout,
  decodeSave,
  encodeSave,
  type SaveV1,
} from '../src/core/save.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { PLAYER_START } from '../src/core/constants.ts';

function sampleSave(over: Partial<SaveV1> = {}): SaveV1 {
  const inventory = createInventory();
  inventory.fiber = 12;
  inventory.resin = 3;
  inventory.shard = 5;
  inventory.spark = 2;
  inventory.rp = 44;
  inventory.darts = 7;
  inventory.kits = { zipline: 2, beacon: 0, drone: 1 };

  return {
    v: 1,
    inventory,
    unlocks: ['grapple', 'boots'],
    critterPersist: {
      3: { tagged: true, linked: false, trackProgress: 4.5, species: 'puffle' },
      17: { tagged: true, linked: true, trackProgress: 8, species: 'skitterling' },
    },
    structures: {
      ziplines: [{ id: 'zip0', a: { x: 0, y: 4, z: 0 }, b: { x: 40, y: 4, z: 0 } }],
      drones: [{ id: 'drone0', x: 10, z: 10 }],
    },
    player: { pos: { x: 12.5, y: 3.2, z: -7.1 }, yaw: 1.23 },
    hints: ['boot', 'lock'],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// encodeSave / decodeSave — round-trip + version guard
// ---------------------------------------------------------------------------

describe('encodeSave / decodeSave', () => {
  it('round-trips every field exactly', () => {
    const state = sampleSave();
    const decoded = decodeSave(encodeSave(state));
    expect(decoded).toEqual(state);
  });

  it('round-trips hints', () => {
    const state = sampleSave({ hints: ['boot', 'lock', 'dart', 'tag'] });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.hints).toEqual(['boot', 'lock', 'dart', 'tag']);
  });

  it('round-trips an empty hints array', () => {
    const state = sampleSave({ hints: [] });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.hints).toEqual([]);
  });

  it('passes structures (ziplines/drones) through unchanged', () => {
    const state = sampleSave();
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.structures).toEqual(state.structures);
  });

  it('round-trips the critter persistence registry, including entries without a species', () => {
    const state = sampleSave({
      critterPersist: { 5: { tagged: true, linked: false, trackProgress: 1 } },
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.critterPersist).toEqual(state.critterPersist);
  });

  it('rejects garbage JSON', () => {
    expect(decodeSave('not json at all {{{')).toBeNull();
  });

  it('rejects null and non-object JSON values', () => {
    expect(decodeSave('null')).toBeNull();
    expect(decodeSave('42')).toBeNull();
    expect(decodeSave('"a string"')).toBeNull();
    expect(decodeSave('[]')).toBeNull();
  });

  it('rejects a missing version field', () => {
    const { v, ...rest } = sampleSave();
    void v;
    expect(decodeSave(JSON.stringify(rest))).toBeNull();
  });

  it('rejects a wrong version number', () => {
    const state = { ...sampleSave(), v: 2 };
    expect(decodeSave(JSON.stringify(state))).toBeNull();
  });

  it('rejects a structurally unsound shape (missing player.pos)', () => {
    const state = sampleSave();
    const bad = { ...state, player: { yaw: 0 } };
    expect(decodeSave(JSON.stringify(bad))).toBeNull();
  });

  it('rejects when unlocks is not an array', () => {
    const state = { ...sampleSave(), unlocks: 'grapple' };
    expect(decodeSave(JSON.stringify(state))).toBeNull();
  });

  it('drops a malformed zipline element while its valid sibling (and the rest of the save) survives', () => {
    const state = sampleSave();
    const good = { id: 'zip1', a: { x: 1, y: 5, z: 2 }, b: { x: 30, y: 5, z: 2 } };
    const bad = [
      {}, // empty object — the review case: would throw in buildMesh(z.a, z.b)
      { id: 'zip2', a: { x: 0, y: 4 }, b: { x: 40, y: 4, z: 0 } }, // a.z missing
      { id: 3, a: { x: 0, y: 4, z: 0 }, b: { x: 40, y: 4, z: 0 } }, // id not a string
      { id: 'zip4', a: null, b: { x: 40, y: 4, z: 0 } }, // a not an object
    ];
    const raw = { ...state, structures: { ...state.structures, ziplines: [bad[0], good, ...bad.slice(1)] } };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.structures.ziplines).toEqual([good]);
    // The rest of the save is untouched.
    expect(decoded?.inventory).toEqual(state.inventory);
    expect(decoded?.structures.drones).toEqual(state.structures.drones);
    expect(decoded?.player).toEqual(state.player);
  });

  it('drops a malformed drone element while its valid sibling survives', () => {
    const state = sampleSave();
    const good = { id: 'drone1', x: -5, z: 22 };
    const raw = {
      ...state,
      structures: {
        ...state.structures,
        drones: [{}, good, { id: 'drone2', x: 'ten', z: 0 }, { id: 'drone3', x: 1 }],
      },
    };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.structures.drones).toEqual([good]);
    expect(decoded?.structures.ziplines).toEqual(state.structures.ziplines);
  });
});

// ---------------------------------------------------------------------------
// applyStartingLoadout — fresh boot grants starting darts; a loaded save's
// own count always wins untouched.
// ---------------------------------------------------------------------------

describe('applyStartingLoadout', () => {
  it('grants PLAYER_START.startingDarts on a fresh boot (no save)', () => {
    const base = createInventory();
    const result = applyStartingLoadout(base, null);
    expect(result.darts).toBe(PLAYER_START.startingDarts);
  });

  it("does not mutate the base inventory passed in", () => {
    const base = createInventory();
    applyStartingLoadout(base, null);
    expect(base.darts).toBe(0);
  });

  it("a decoded save's own dart count wins over the starting loadout", () => {
    const base = createInventory();
    const state = sampleSave();
    state.inventory.darts = 1; // deliberately lower than the starting grant
    const result = applyStartingLoadout(base, state);
    expect(result.darts).toBe(1);
  });

  it('carries every other loaded inventory field through untouched', () => {
    const base = createInventory();
    const state = sampleSave();
    const result = applyStartingLoadout(base, state);
    expect(result.fiber).toBe(state.inventory.fiber);
    expect(result.rp).toBe(state.inventory.rp);
    expect(result.kits).toEqual(state.inventory.kits);
  });
});
