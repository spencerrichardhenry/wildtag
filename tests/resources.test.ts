import { describe, expect, it } from 'vitest';
import {
  harvest,
  isAvailable,
  makeNode,
  withinHarvestCone,
  type NodeState,
} from '../src/world/resources.ts';
import { SCATTER } from '../src/core/constants.ts';
import { createInventory, addResource, spend } from '../src/craft/inventory.ts';
import { scatterForChunk } from '../src/world/scatter.ts';
import { RESOURCE_KINDS } from '../src/world/props.ts';

function fiberNode(id: number): NodeState {
  return makeNode(id, 'fiber', 10, 0, 20);
}

describe('harvest', () => {
  it('yields the node kind and depletes it until now + respawnS', () => {
    const nodes = [fiberNode(1)];
    const now = 100;
    const res = harvest(nodes, 1, now);
    expect(res.gained).toBe('fiber');
    const node = res.nodes.find((n) => n.id === 1)!;
    expect(node.depletedUntil).toBe(now + SCATTER.respawnS);
    expect(node.depletedUntil).toBe(280); // now(100) + 180, exactly
    expect(isAvailable(node, now)).toBe(false);
  });

  it('is pure — the input array/node is not mutated', () => {
    const nodes = [fiberNode(1)];
    harvest(nodes, 1, 100);
    expect(nodes[0]!.depletedUntil).toBe(0);
  });

  it('fails a second harvest while depleted', () => {
    const first = harvest([fiberNode(1)], 1, 100);
    const second = harvest(first.nodes, 1, 150); // still within cooldown
    expect(second.gained).toBeNull();
    expect(second.nodes.find((n) => n.id === 1)!.depletedUntil).toBe(280);
  });

  it('respawns exactly at now + respawnS and can be harvested again', () => {
    const first = harvest([fiberNode(1)], 1, 100);
    const node = first.nodes.find((n) => n.id === 1)!;
    expect(isAvailable(node, 279.999)).toBe(false);
    expect(isAvailable(node, 280)).toBe(true); // exactly at respawn time
    const again = harvest(first.nodes, 1, 280);
    expect(again.gained).toBe('fiber');
    expect(again.nodes.find((n) => n.id === 1)!.depletedUntil).toBe(460);
  });

  it('returns null for an unknown id', () => {
    const res = harvest([fiberNode(1)], 99, 100);
    expect(res.gained).toBeNull();
  });

  it('mushroom nodes harvest and respawn like other resources', () => {
    const nodes = [makeNode(1, 'mushroom', 5, 5, 1)];
    const { nodes: after, gained } = harvest(nodes, 1, 100);
    expect(gained).toBe('mushroom');
    expect(isAvailable(after[0]!, 100)).toBe(false);
    expect(isAvailable(after[0]!, 100 + SCATTER.respawnS)).toBe(true);
  });
});

describe('withinHarvestCone', () => {
  const origin = { x: 0, y: 1.6, z: 0 };

  it('accepts a node dead ahead within range', () => {
    const look = { x: 0, y: 0, z: -1 };
    const node = makeNode(1, 'fiber', 0, -2, 0);
    expect(withinHarvestCone(origin, look, node)).toBe(true);
  });

  it('rejects a node beyond harvestRange', () => {
    const look = { x: 0, y: 0, z: -1 };
    const node = makeNode(1, 'fiber', 0, -(SCATTER.harvestRange + 1), 0);
    expect(withinHarvestCone(origin, look, node)).toBe(false);
  });

  it('rejects a node outside the look cone', () => {
    const look = { x: 0, y: 0, z: -1 }; // looking -Z
    const node = makeNode(1, 'fiber', 2, 0, 0); // directly to +X (90° off)
    expect(withinHarvestCone(origin, look, node)).toBe(false);
  });
});

describe('inventory', () => {
  it('creates a zeroed inventory with the full key set (Task 7 expands: + kits)', () => {
    expect(createInventory()).toEqual({
      fiber: 0,
      resin: 0,
      shard: 0,
      spark: 0,
      mushroom: 0,
      wood: 0,
      stone: 0,
      rp: 0,
      darts: 0,
      charms: 0,
      purifiers: 0,
      kits: { zipline: 0, beacon: 0, drone: 0 },
    });
  });

  it('adds resources by kind', () => {
    const inv = createInventory();
    addResource(inv, 'fiber', 2);
    addResource(inv, 'shard', 1);
    addResource(inv, 'fiber', 3);
    expect(inv.fiber).toBe(5);
    expect(inv.shard).toBe(1);
    expect(inv.resin).toBe(0);
  });

  it('inventory tracks mushrooms', () => {
    const inv = createInventory();
    expect(inv.mushroom).toBe(0);
    addResource(inv, 'mushroom', 3);
    expect(inv.mushroom).toBe(3);
    expect(spend(inv, { mushroom: 2 })!.mushroom).toBe(1);
    expect(spend(inv, { mushroom: 9 })).toBeNull();
  });

  // --- Inventory + Building Task 1: farm-only wood/stone ---------------------

  it('inventory tracks wood (timberchomp produce)', () => {
    const inv = createInventory();
    expect(inv.wood).toBe(0);
    addResource(inv, 'wood', 4);
    expect(inv.wood).toBe(4);
    expect(spend(inv, { wood: 3 })!.wood).toBe(1);
    expect(spend(inv, { wood: 99 })).toBeNull();
  });

  it('inventory tracks stone (pebbleshrew produce)', () => {
    const inv = createInventory();
    expect(inv.stone).toBe(0);
    addResource(inv, 'stone', 5);
    expect(inv.stone).toBe(5);
    expect(spend(inv, { stone: 2 })!.stone).toBe(3);
    expect(spend(inv, { stone: 99 })).toBeNull();
  });
});

describe('farm-only resources never scatter (Task 1)', () => {
  it('scatterForChunk never emits a wood or stone prop over a wide chunk sample', () => {
    for (let cx = -20; cx <= 20; cx += 2) {
      for (let cz = -20; cz <= 20; cz += 2) {
        for (const p of scatterForChunk(cx, cz)) {
          expect(p.kind).not.toBe('wood');
          expect(p.kind).not.toBe('stone');
        }
      }
    }
  });

  it("props' RESOURCE_KINDS (scattered/harvestable node kinds) excludes wood and stone", () => {
    expect(RESOURCE_KINDS.has('wood' as never)).toBe(false);
    expect(RESOURCE_KINDS.has('stone' as never)).toBe(false);
    // Sanity: the set is non-empty and still contains the real harvestables.
    expect(RESOURCE_KINDS.has('fiber')).toBe(true);
    expect(RESOURCE_KINDS.has('mushroom')).toBe(true);
  });
});
