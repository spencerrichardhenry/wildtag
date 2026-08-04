import { describe, expect, it } from 'vitest';
import {
  applyStartingLoadout,
  decodeSave,
  encodeSave,
  snapToGround,
  type SaveV3,
} from '../src/core/save.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { PLAYER_START } from '../src/core/constants.ts';

function sampleSave(over: Partial<SaveV3> = {}): SaveV3 {
  const inventory = createInventory();
  inventory.fiber = 12;
  inventory.resin = 3;
  inventory.shard = 5;
  inventory.spark = 2;
  inventory.rp = 44;
  inventory.darts = 7;
  inventory.kits = { zipline: 2, beacon: 0, drone: 1 };

  return {
    v: 3,
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
    roster: [],
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

  it('round-trips the nickname cursor when present', () => {
    const state = sampleSave({ nameCursor: 7 });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.nameCursor).toBe(7);
  });

  it('migrates an absent nickname cursor to undefined (defaults to 0 at the call site)', () => {
    const state = sampleSave();
    expect(state.nameCursor).toBeUndefined();
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.nameCursor).toBeUndefined();
    expect(decoded?.nameCursor ?? 0).toBe(0);
  });

  it('rejects a non-finite nickname cursor', () => {
    const raw = { ...sampleSave(), nameCursor: 'nope' };
    expect(decodeSave(JSON.stringify(raw))).toBeNull();
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

  it('round-trips a negative critterPersist key (Cursed Castle fixed-slot gargoyle ids)', () => {
    // CritterManager.addFixedSlots (castle perches) and debugSpawn both hand
    // out ids from a reserved negative range (-1, -2, ...), distinct from the
    // >= 0 ids the per-cell spawn table uses. JSON object keys are always
    // strings ("-3"), and CritterManager.importRegistry recovers the numeric
    // id via `Number(key)` — this guards that whole path end-to-end through a
    // real encode/decode round-trip, not just the manager's own parsing.
    const state = sampleSave({
      critterPersist: {
        ...sampleSave().critterPersist,
        '-3': { tagged: true, linked: true, trackProgress: 5, species: 'gargoyle' },
      },
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.critterPersist).toEqual(state.critterPersist);
    const entry = decoded?.critterPersist[-3];
    expect(entry).toEqual({ tagged: true, linked: true, trackProgress: 5, species: 'gargoyle' });
    // Round-trip the exact recovery step importRegistry performs.
    expect(Number.isFinite(Number('-3'))).toBe(true);
    expect(Number('-3')).toBe(-3);
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

  it('rejects a wrong version number (neither 1, 2, nor 3)', () => {
    expect(decodeSave(JSON.stringify({ ...sampleSave(), v: 4 }))).toBeNull();
    expect(decodeSave(JSON.stringify({ ...sampleSave(), v: 0 }))).toBeNull();
    expect(decodeSave(JSON.stringify({ ...sampleSave(), v: '2' }))).toBeNull();
  });

  // --- Haven V7: v1 → v2 migration matrix ------------------------------------

  it('migrates a pure-v1 save (no Haven/castle fields) losslessly into the v3 shape', () => {
    // A genuine pre-Haven v1 blob: v:1, NONE of the Haven or castle keys present.
    const v1blob = {
      v: 1,
      inventory: { fiber: 5, resin: 2, shard: 1, spark: 0, rp: 20, darts: 3 },
      unlocks: ['grapple'],
      critterPersist: { 4: { tagged: true, linked: true, trackProgress: 8, species: 'puffle' } },
      structures: { ziplines: [], drones: [] },
      player: { pos: { x: 1, y: 2, z: 3 }, yaw: 0.5 },
      hints: ['boot'],
    };
    const decoded = decodeSave(JSON.stringify(v1blob));
    expect(decoded).not.toBeNull();
    // Normalized to the current version.
    expect(decoded!.v).toBe(3);
    // Every v1 field survives untouched.
    expect(decoded!.unlocks).toEqual(['grapple']);
    expect(decoded!.player).toEqual(v1blob.player);
    expect(decoded!.critterPersist).toEqual(v1blob.critterPersist);
    // Haven defaults: charms 0, kits zeroed, roster [], no phantom V4 keys.
    expect(decoded!.inventory.charms).toBe(0);
    expect(decoded!.inventory.kits).toEqual({ zipline: 0, beacon: 0, drone: 0 });
    expect(decoded!.roster).toEqual([]);
    expect('barter' in decoded!).toBe(false);
    expect('rewards' in decoded!).toBe(false);
    expect(decoded!.farm).toBeUndefined();
    expect('mount' in decoded!).toBe(false);
    // No phantom castle keys either.
    expect('daylightT' in decoded!).toBe(false);
    expect('elves' in decoded!).toBe(false);
    expect('castlePurified' in decoded!).toBe(false);
  });

  it('accepts a v3 save natively and round-trips it', () => {
    const state = sampleSave({
      roster: [{ id: 1, speciesId: 'puffle', nickname: 'Beans', status: { kind: 'idle' } }],
      rewards: ['saddle'],
      barter: [{ npcId: 'juno', seq: 1, fulfilled: 1 }],
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded).toEqual(state);
    expect(decoded!.v).toBe(3);
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

  it('rejects a tampered inventory whose resource counts are missing (inventory: {})', () => {
    const bad = { ...sampleSave(), inventory: {} };
    expect(decodeSave(JSON.stringify(bad))).toBeNull();
  });

  it('rejects an inventory with a negative or non-finite resource count', () => {
    const negative = sampleSave();
    negative.inventory.shard = -5;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, fiber: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  it('defaults a missing kits object to zeros (forward-compat) rather than rejecting', () => {
    const state = sampleSave();
    const { kits, ...invNoKits } = state.inventory;
    void kits;
    const raw = { ...state, inventory: invNoKits };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.kits).toEqual({ zipline: 0, beacon: 0, drone: 0 });
    // Every other inventory field survives untouched.
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a kits object with a tampered (negative) kit count', () => {
    const state = sampleSave();
    state.inventory.kits = { zipline: -1, beacon: 0, drone: 0 };
    expect(decodeSave(JSON.stringify(state))).toBeNull();
  });

  // --- Haven V2: charms (inventory) + roster ---------------------------------

  it('round-trips a non-zero charms count', () => {
    const state = sampleSave();
    state.inventory.charms = 5;
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.inventory.charms).toBe(5);
  });

  it('defaults a missing charms field to 0 (v1 forward-compat) rather than rejecting', () => {
    const state = sampleSave();
    const { charms, ...invNoCharms } = state.inventory;
    void charms;
    const raw = { ...state, inventory: invNoCharms };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.charms).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite charms count', () => {
    const negative = sampleSave();
    negative.inventory.charms = -3;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, charms: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  // --- Cursed Castle: mushroom (inventory) ------------------------------------

  it('mushroom count round-trips', () => {
    const state = sampleSave();
    state.inventory.mushroom = 7;
    expect(decodeSave(encodeSave(state))?.inventory.mushroom).toBe(7);
  });

  it('v2 save without mushroom field loads with mushroom 0', () => {
    const state = sampleSave();
    const { mushroom, ...invNoMushroom } = state.inventory;
    void mushroom;
    const raw = { ...state, inventory: invNoMushroom };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.mushroom).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite mushroom count', () => {
    const negative = sampleSave();
    negative.inventory.mushroom = -3;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, mushroom: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  // --- Inventory + Building Task 1: wood/stone (farm-only, inventory) --------

  it('wood count round-trips', () => {
    const state = sampleSave();
    state.inventory.wood = 9;
    expect(decodeSave(encodeSave(state))?.inventory.wood).toBe(9);
  });

  it('pre-Task-1 save without a wood field loads with wood 0', () => {
    const state = sampleSave();
    const { wood, ...invNoWood } = state.inventory;
    void wood;
    const raw = { ...state, inventory: invNoWood };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.wood).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite wood count', () => {
    const negative = sampleSave();
    negative.inventory.wood = -3;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, wood: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  it('stone count round-trips', () => {
    const state = sampleSave();
    state.inventory.stone = 6;
    expect(decodeSave(encodeSave(state))?.inventory.stone).toBe(6);
  });

  it('pre-Task-1 save without a stone field loads with stone 0', () => {
    const state = sampleSave();
    const { stone, ...invNoStone } = state.inventory;
    void stone;
    const raw = { ...state, inventory: invNoStone };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.stone).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite stone count', () => {
    const negative = sampleSave();
    negative.inventory.stone = -3;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, stone: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  // --- Inventory + Building Task 5: walls/ramps counters + builds -----------

  it('walls/ramps counts round-trip', () => {
    const state = sampleSave();
    state.inventory.walls = 4;
    state.inventory.ramps = 2;
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.inventory.walls).toBe(4);
    expect(decoded?.inventory.ramps).toBe(2);
  });

  it('pre-Task-5 save without walls/ramps fields loads with both 0', () => {
    const state = sampleSave();
    const { walls, ramps, ...invNoWallsRamps } = state.inventory;
    void walls;
    void ramps;
    const raw = { ...state, inventory: invNoWallsRamps };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.walls).toBe(0);
    expect(decoded?.inventory.ramps).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite walls or ramps count', () => {
    const negWalls = sampleSave();
    negWalls.inventory.walls = -1;
    expect(decodeSave(JSON.stringify(negWalls))).toBeNull();

    const negRamps = sampleSave();
    negRamps.inventory.ramps = -1;
    expect(decodeSave(JSON.stringify(negRamps))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, walls: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  it('round-trips placed pieces (builds)', () => {
    const state = sampleSave({
      builds: [
        { k: 'w', x: 1, y: 2, z: 3, yaw: 0 },
        { k: 'r', x: -4, y: 0, z: 8, yaw: 1.57 },
      ],
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.builds).toEqual(state.builds);
  });

  it('decodes a save without a builds key to exactly its old shape (no phantom key)', () => {
    const state = sampleSave(); // no builds field — a legacy (pre-Task-5) save
    const decoded = decodeSave(encodeSave(state));
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(state);
    expect(decoded && 'builds' in decoded).toBe(false);
  });

  it('drops a malformed build element while its valid sibling survives', () => {
    const state = sampleSave();
    const good = { k: 'w', x: 1, y: 2, z: 3, yaw: 0 };
    const raw = {
      ...state,
      builds: [
        {}, // empty
        good,
        { k: 'x', x: 0, y: 0, z: 0, yaw: 0 }, // bad kind
        { k: 'r', x: 'nope', y: 0, z: 0, yaw: 0 }, // x not finite
      ],
    };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.builds).toEqual([good]);
    // The rest of the save is untouched.
    expect(decoded?.inventory).toEqual(state.inventory);
  });

  it('rejects a builds field that is present but not an array', () => {
    const raw = { ...sampleSave(), builds: 'nope' };
    expect(decodeSave(JSON.stringify(raw))).toBeNull();
  });

  // --- Cursed Castle: purifiers (inventory) -----------------------------------

  it('purifiers count round-trips', () => {
    const state = sampleSave();
    state.inventory.purifiers = 5;
    expect(decodeSave(encodeSave(state))?.inventory.purifiers).toBe(5);
  });

  it('v2 save without purifiers field loads with purifiers 0', () => {
    const state = sampleSave();
    const { purifiers, ...invNoPurifiers } = state.inventory;
    void purifiers;
    const raw = { ...state, inventory: invNoPurifiers };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.inventory.purifiers).toBe(0);
    expect(decoded?.inventory.fiber).toBe(state.inventory.fiber);
  });

  it('rejects a negative / non-finite purifiers count', () => {
    const negative = sampleSave();
    negative.inventory.purifiers = -3;
    expect(decodeSave(JSON.stringify(negative))).toBeNull();

    const nan = { ...sampleSave(), inventory: { ...sampleSave().inventory, purifiers: 'lots' } };
    expect(decodeSave(JSON.stringify(nan))).toBeNull();
  });

  it('round-trips the bonded roster', () => {
    const state = sampleSave({
      roster: [
        { id: 12, speciesId: 'puffle', nickname: 'Beans', status: { kind: 'idle' } },
        { id: -4, speciesId: 'prismhorse', nickname: 'Doodle', status: { kind: 'mount' } },
        { id: 7, speciesId: 'craghorn', nickname: 'Pip', status: { kind: 'farm', plotId: 2 } },
      ],
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.roster).toEqual(state.roster);
  });

  it('defaults a missing roster to [] (v1 migration) rather than rejecting', () => {
    const state = sampleSave();
    const { roster, ...noRoster } = state;
    void roster;
    const decoded = decodeSave(JSON.stringify(noRoster));
    expect(decoded).not.toBeNull();
    expect(decoded?.roster).toEqual([]);
    expect(decoded?.player).toEqual(state.player);
  });

  it('rejects a roster that is present but not an array', () => {
    const raw = { ...sampleSave(), roster: 'nope' };
    expect(decodeSave(JSON.stringify(raw))).toBeNull();
  });

  it('drops malformed roster entries while valid siblings survive', () => {
    const good = { id: 3, speciesId: 'puffle', nickname: 'Beans', status: { kind: 'idle' } };
    const raw = {
      ...sampleSave(),
      roster: [
        {}, // empty
        good,
        { id: 4, speciesId: 'puffle', nickname: 'X', status: { kind: 'farm' } }, // farm w/o plotId
        { id: 'five', speciesId: 'puffle', nickname: 'Y', status: { kind: 'idle' } }, // id not finite
        { id: 6, speciesId: 'puffle', nickname: 'Z' }, // no status
      ],
    };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.roster).toEqual([good]);
  });

  // --- Haven V6: active-mount persistence ------------------------------------

  it('round-trips a present mount field exactly', () => {
    const state = sampleSave({ mount: { entryId: -4, x: 12.5, z: -33.25 } });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.mount).toEqual({ entryId: -4, x: 12.5, z: -33.25 });
  });

  it('decodes a pre-V6 save without a mount key to exactly its old shape', () => {
    const state = sampleSave(); // no mount field
    const decoded = decodeSave(encodeSave(state));
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(state);
    expect(decoded && 'mount' in decoded).toBe(false); // no phantom key
  });

  it('rejects a present-but-malformed mount field (fresh start)', () => {
    // Non-finite coordinates / entryId, or a non-object value, all reject.
    for (const mount of [
      { entryId: 'four', x: 0, z: 0 },
      { entryId: 1, x: 'east', z: 0 },
      { entryId: 1, x: 0 }, // missing z
      {},
      'saddle up',
    ]) {
      const raw = { ...sampleSave(), mount };
      expect(decodeSave(JSON.stringify(raw))).toBeNull();
    }
  });

  it('treats mount: null as absent rather than rejecting', () => {
    const raw = { ...sampleSave(), mount: null };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.mount).toBeUndefined();
  });

  // --- Haven V7: concrete barter request persistence -------------------------

  it('round-trips a concrete persisted barter request', () => {
    const state = sampleSave({
      barter: [
        { npcId: 'juno', seq: 3, fulfilled: 3, request: { kind: 'critters', speciesId: 'puffle', n: 2 } },
        { npcId: 'bram', seq: 1, fulfilled: 1, request: { kind: 'resources', resource: 'fiber', n: 30 } },
      ],
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.barter).toEqual(state.barter);
  });

  it('drops a malformed request but keeps the barter entry (regen fallback)', () => {
    const raw = {
      ...sampleSave(),
      barter: [
        { npcId: 'juno', seq: 2, fulfilled: 2, request: { kind: 'nonsense' } },
        { npcId: 'odd', seq: 0, fulfilled: 0, request: { kind: 'critters', n: 2 } }, // missing speciesId
      ],
    };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.barter).toEqual([
      { npcId: 'juno', seq: 2, fulfilled: 2 },
      { npcId: 'odd', seq: 0, fulfilled: 0 },
    ]);
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

  // --- Cursed Castle: v3 fields (daylightT / elves / castlePurified) --------

  it('v2 saves load as v3 with castle fields defaulted', () => {
    // A literal v:2 JSON fixture — hand-built (not via encodeSave, which now
    // emits v:3) so this genuinely exercises the v2 → v3 migration path.
    const v2json = JSON.stringify({
      v: 2,
      inventory: { fiber: 12, resin: 3, shard: 5, spark: 2, rp: 44, darts: 7 },
      unlocks: ['grapple', 'boots'],
      critterPersist: {
        3: { tagged: true, linked: false, trackProgress: 4.5, species: 'puffle' },
      },
      structures: { ziplines: [], drones: [] },
      player: { pos: { x: 12.5, y: 3.2, z: -7.1 }, yaw: 1.23 },
      hints: ['boot', 'lock'],
      roster: [],
    });
    const s = decodeSave(v2json)!;
    expect(s).not.toBeNull();
    expect(s.v).toBe(3);
    expect(s.daylightT ?? 0).toBe(0);
    expect(s.castlePurified ?? false).toBe(false);
    expect(s.elves ?? 0).toBe(0);
    expect('daylightT' in s).toBe(false);
    expect('elves' in s).toBe(false);
    expect('castlePurified' in s).toBe(false);
  });

  it('v3 castle fields round-trip', () => {
    const st = { ...sampleSave(), daylightT: 123.5, elves: 4, castlePurified: true };
    const s = decodeSave(encodeSave(st))!;
    expect(s.daylightT).toBe(123.5);
    expect(s.elves).toBe(4);
    expect(s.castlePurified).toBe(true);
  });

  it('rejects garbage castle fields', () => {
    const j = JSON.parse(encodeSave(sampleSave()));
    j.elves = 'many';
    j.daylightT = null;
    j.castlePurified = 1;
    const s = decodeSave(JSON.stringify(j))!;
    expect(s.elves ?? 0).toBe(0);
    expect(s.daylightT ?? 0).toBe(0);
    expect(s.castlePurified ?? false).toBe(false);
  });

  it('drops (rather than rejects) a non-finite daylightT / elves or non-boolean castlePurified, keeping the rest of the save', () => {
    const raw = { ...sampleSave(), daylightT: 'noon', elves: 'lots', castlePurified: 'yes' };
    const s = decodeSave(JSON.stringify(raw));
    expect(s).not.toBeNull();
    expect('daylightT' in s!).toBe(false);
    expect('elves' in s!).toBe(false);
    expect('castlePurified' in s!).toBe(false);
    expect(s!.inventory).toEqual(sampleSave().inventory);
  });

  // --- Inventory + Building Task 2: hotbar persistence ------------------------

  it('round-trips a present hotbar exactly', () => {
    const state = sampleSave({
      hotbar: { slots: ['darts', 'kit:zipline', null, 'charms', null, 'wall'], selected: 3 },
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.hotbar).toEqual({
      slots: ['darts', 'kit:zipline', null, 'charms', null, 'wall'],
      selected: 3,
    });
  });

  it('decodes a save without a hotbar key to exactly its old shape (no phantom key)', () => {
    const state = sampleSave(); // no hotbar field — a legacy (pre-Task-2) save
    const decoded = decodeSave(encodeSave(state));
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(state);
    expect(decoded && 'hotbar' in decoded).toBe(false);
  });

  it('nulls out an unrecognized item string in a slot rather than rejecting the save', () => {
    const raw = {
      ...sampleSave(),
      hotbar: { slots: ['darts', 'nonsense-item', null, null, null, null], selected: 0 },
    };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.hotbar?.slots).toEqual(['darts', null, null, null, null, null]);
  });

  it('clamps an out-of-range selected index to 0..5', () => {
    const high = { ...sampleSave(), hotbar: { slots: [null, null, null, null, null, null], selected: 99 } };
    expect(decodeSave(JSON.stringify(high))?.hotbar?.selected).toBe(5);

    const low = { ...sampleSave(), hotbar: { slots: [null, null, null, null, null, null], selected: -7 } };
    expect(decodeSave(JSON.stringify(low))?.hotbar?.selected).toBe(0);
  });

  it('drops (rather than rejects) a structurally malformed hotbar block, keeping the rest of the save', () => {
    const raw = { ...sampleSave(), hotbar: { selected: 0 } }; // missing slots array
    const s = decodeSave(JSON.stringify(raw));
    expect(s).not.toBeNull();
    expect('hotbar' in s!).toBe(false);
    expect(s!.inventory).toEqual(sampleSave().inventory);

    const raw2 = { ...sampleSave(), hotbar: 'not an object' };
    const s2 = decodeSave(JSON.stringify(raw2));
    expect(s2).not.toBeNull();
    expect('hotbar' in s2!).toBe(false);
  });

  it('treats hotbar: null as absent rather than rejecting', () => {
    const raw = { ...sampleSave(), hotbar: null };
    const decoded = decodeSave(JSON.stringify(raw));
    expect(decoded).not.toBeNull();
    expect(decoded?.hotbar).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// snapToGround — restore a saved position against the live terrain, clamping
// it back onto the ground if the terrain has reshaped underneath it.
// ---------------------------------------------------------------------------

describe('snapToGround', () => {
  it('leaves the position unchanged when within tolerance of groundY', () => {
    const pos = { x: 5, y: 10, z: -2 };
    const snapped = snapToGround(pos, 8); // |10 - 8| = 2, within default tolerance 3
    expect(snapped).toEqual({ x: 5, y: 10, z: -2 });
  });

  it('snaps to groundY + 0.5 when outside tolerance', () => {
    const pos = { x: 5, y: 40, z: -2 };
    const snapped = snapToGround(pos, 8); // |40 - 8| = 32, outside tolerance
    expect(snapped).toEqual({ x: 5, y: 8.5, z: -2 });
  });

  it('respects a custom tolerance', () => {
    const pos = { x: 0, y: 10, z: 0 };
    expect(snapToGround(pos, 8, 1)).toEqual({ x: 0, y: 8.5, z: 0 }); // |10-8|=2 > 1
    expect(snapToGround(pos, 8, 5)).toEqual({ x: 0, y: 10, z: 0 }); // |10-8|=2 <= 5
  });

  it('returns a new object, never the same reference', () => {
    const pos = { x: 1, y: 2, z: 3 };
    const snapped = snapToGround(pos, 2);
    expect(snapped).not.toBe(pos);
    const snappedFar = snapToGround(pos, 100);
    expect(snappedFar).not.toBe(pos);
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
