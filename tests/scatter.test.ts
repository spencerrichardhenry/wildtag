import { describe, expect, it } from 'vitest';
import { scatterForChunk, placementObstacle } from '../src/world/scatter.ts';
import { biomeAt } from '../src/world/terrain.ts';
import { SCATTER } from '../src/core/constants.ts';

// Empirically solid single-biome chunks (see task-6 probe):
const FOREST = { cx: -5, cz: -13 };
const MEADOW = { cx: 0, cz: 0 };
const CRAGS = { cx: -14, cz: -1 };
const WATER = { cx: 20, cz: 0 };

describe('scatterForChunk determinism', () => {
  it('produces byte-identical placements when called twice', () => {
    const a = scatterForChunk(FOREST.cx, FOREST.cz);
    const b = scatterForChunk(FOREST.cx, FOREST.cz);
    expect(a).toEqual(b);
    // Same for a meadow chunk.
    expect(scatterForChunk(MEADOW.cx, MEADOW.cz)).toEqual(
      scatterForChunk(MEADOW.cx, MEADOW.cz),
    );
  });

  it('differs between distinct chunks', () => {
    const a = scatterForChunk(MEADOW.cx, MEADOW.cz);
    const b = scatterForChunk(FOREST.cx, FOREST.cz);
    expect(a).not.toEqual(b);
  });
});

describe('biome density sanity', () => {
  it('a solid forest chunk has at least 8 trees', () => {
    const trees = scatterForChunk(FOREST.cx, FOREST.cz).filter((p) => p.kind === 'tree');
    expect(trees.length).toBeGreaterThanOrEqual(8);
  });

  it('a meadow chunk contains fiber nodes', () => {
    const fiber = scatterForChunk(MEADOW.cx, MEADOW.cz).filter((p) => p.kind === 'fiber');
    expect(fiber.length).toBeGreaterThan(0);
  });

  it('a crags chunk contains shard nodes', () => {
    const shard = scatterForChunk(CRAGS.cx, CRAGS.cz).filter((p) => p.kind === 'shard');
    expect(shard.length).toBeGreaterThan(0);
  });

  it('some forest trees carry a resin node', () => {
    const resin = scatterForChunk(FOREST.cx, FOREST.cz).filter((p) => p.kind === 'resin');
    expect(resin.length).toBeGreaterThan(0);
  });
});

describe('placement constraints', () => {
  it('places nothing in a fully-underwater chunk', () => {
    expect(scatterForChunk(WATER.cx, WATER.cz)).toHaveLength(0);
  });

  it('never places on water biome or below minPlacementY across many chunks', () => {
    for (let cx = -4; cx <= 4; cx++) {
      for (let cz = -16; cz <= 4; cz++) {
        for (const p of scatterForChunk(cx, cz)) {
          expect(p.y).toBeGreaterThanOrEqual(SCATTER.minPlacementY);
          expect(biomeAt(p.x, p.z)).not.toBe('water');
        }
      }
    }
  });

  it('keeps every placement inside its chunk footprint', () => {
    const cx = -5;
    const cz = -13;
    const ox = cx * 64;
    const oz = cz * 64;
    for (const p of scatterForChunk(cx, cz)) {
      expect(p.x).toBeGreaterThanOrEqual(ox - 2);
      expect(p.x).toBeLessThanOrEqual(ox + 64 + 2);
      expect(p.z).toBeGreaterThanOrEqual(oz - 2);
      expect(p.z).toBeLessThanOrEqual(oz + 64 + 2);
    }
  });
});

describe('obstacle emission', () => {
  it('emits a cylinder for trees and rocks, scaled by placement scale', () => {
    const tree = { kind: 'tree' as const, x: 1, z: 2, y: 5, scale: 2, rot: 0 };
    const ob = placementObstacle(tree);
    expect(ob).not.toBeNull();
    expect(ob).toEqual({ x: 1, z: 2, r: SCATTER.obstacleRadius.tree * 2 });

    const rock = { kind: 'rock' as const, x: 3, z: 4, y: 5, scale: 1, rot: 0 };
    expect(placementObstacle(rock)).toEqual({ x: 3, z: 4, r: SCATTER.obstacleRadius.rock });
  });

  it('does not emit obstacles for flowers or harvestable nodes', () => {
    for (const kind of ['flower', 'fiber', 'crystal', 'shard', 'resin', 'spark'] as const) {
      expect(placementObstacle({ kind, x: 0, z: 0, y: 5, scale: 1, rot: 0 })).toBeNull();
    }
  });
});
