import { describe, expect, it } from 'vitest';
import {
  harvest,
  isAvailable,
  makeNode,
  withinHarvestCone,
  type NodeState,
} from '../src/world/resources.ts';
import { SCATTER } from '../src/core/constants.ts';
import { createInventory, addResource } from '../src/craft/inventory.ts';

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
      rp: 0,
      darts: 0,
      charms: 0,
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
});
