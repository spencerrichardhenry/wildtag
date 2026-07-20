import { describe, expect, it } from 'vitest';
import {
  scatterForChunk,
  placementObstacle,
  placementGrappleCollider,
} from '../src/world/scatter.ts';
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

  it('never places non-lilypad props on water or below minPlacementY', () => {
    for (let cx = -4; cx <= 4; cx++) {
      for (let cz = -16; cz <= 4; cz++) {
        for (const p of scatterForChunk(cx, cz)) {
          if (p.kind === 'lilypad') continue; // lily pads intentionally float on lakes
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

  it('emits obstacles for mesas and boulders (grappleable set dressing)', () => {
    for (const kind of ['mesa', 'boulder'] as const) {
      const ob = placementObstacle({ kind, x: 2, z: 3, y: 5, scale: 1, rot: 0 });
      expect(ob).not.toBeNull();
      expect(ob!.r).toBe(SCATTER.obstacleRadius[kind]);
    }
  });

  it('does NOT emit obstacles for scree, reeds, grass tufts, lily pads or mushrooms', () => {
    for (const kind of ['scree', 'reed', 'grasstuft', 'lilypad', 'mushroom'] as const) {
      expect(placementObstacle({ kind, x: 0, z: 0, y: 5, scale: 1, rot: 0 })).toBeNull();
    }
  });
});

// --- Permanent meadow grass tufts -----------------------------------------

describe('meadow grass tufts', () => {
  it('scatters grass tufts deterministically into a meadow chunk', () => {
    const a = scatterForChunk(MEADOW.cx, MEADOW.cz).filter((p) => p.kind === 'grasstuft');
    const b = scatterForChunk(MEADOW.cx, MEADOW.cz).filter((p) => p.kind === 'grasstuft');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('emits grass tufts ONLY on meadow sub-cells', () => {
    for (const c of [MEADOW, FOREST, CRAGS, { cx: 20, cz: 0 }]) {
      for (const p of scatterForChunk(c.cx, c.cz)) {
        if (p.kind === 'grasstuft') expect(biomeAt(p.x, p.z)).toBe('meadow');
      }
    }
  });

  it('never emits grass tufts in a forest or crags chunk', () => {
    for (const c of [FOREST, CRAGS]) {
      const tufts = scatterForChunk(c.cx, c.cz).filter((p) => p.kind === 'grasstuft');
      expect(tufts.length).toBe(0);
    }
  });

  it('yields ~1 tuft per meadow sub-cell (per-chunk count in the 45-64 band)', () => {
    const tufts = scatterForChunk(MEADOW.cx, MEADOW.cz).filter((p) => p.kind === 'grasstuft');
    expect(tufts.length).toBeGreaterThanOrEqual(45);
    expect(tufts.length).toBeLessThanOrEqual(64); // grid² sub-cells is the hard cap
  });

  it('grass tufts are neither obstacles nor grapple anchors nor above minPlacementY-violating', () => {
    const tufts = scatterForChunk(MEADOW.cx, MEADOW.cz).filter((p) => p.kind === 'grasstuft');
    for (const p of tufts) {
      expect(placementObstacle(p)).toBeNull();
      expect(placementGrappleCollider(p)).toBeNull();
      expect(p.y).toBeGreaterThanOrEqual(SCATTER.minPlacementY);
    }
  });
});

// --- F2 scenery-variety extensions ---------------------------------------

describe('tree/crystal variant determinism', () => {
  it('assigns identical variants when a chunk is scattered twice', () => {
    for (const c of [FOREST, MEADOW, CRAGS]) {
      const a = scatterForChunk(c.cx, c.cz).map((p) => p.variant ?? '');
      const b = scatterForChunk(c.cx, c.cz).map((p) => p.variant ?? '');
      expect(a).toEqual(b);
    }
  });

  it('gives every scattered tree a geometry variant', () => {
    for (const c of [FOREST, MEADOW]) {
      for (const p of scatterForChunk(c.cx, c.cz)) {
        if (p.kind === 'tree') expect(typeof p.variant).toBe('string');
      }
    }
  });
});

describe('per-biome variant sets', () => {
  it('a 4-chunk forest sample contains at least 2 distinct tree variants', () => {
    const variants = new Set<string>();
    for (let dx = 0; dx < 2; dx++) {
      for (let dz = 0; dz < 2; dz++) {
        for (const p of scatterForChunk(FOREST.cx + dx, FOREST.cz + dz)) {
          if (p.kind === 'tree' && p.variant) variants.add(p.variant);
        }
      }
    }
    expect(variants.size).toBeGreaterThanOrEqual(2);
    // At least two of the forest tree variants are represented (border cells may
    // also bleed in a neighbouring biome's variant, which is fine).
    const forestKinds = ['pine', 'broadleaf', 'snag'].filter((v) => variants.has(v));
    expect(forestKinds.length).toBeGreaterThanOrEqual(2);
  });

  it('crags crystals use the size/colour variant range', () => {
    const variants = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const p of scatterForChunk(CRAGS.cx + dx, CRAGS.cz + dz)) {
          if (p.kind === 'crystal' && p.variant) variants.add(p.variant);
        }
      }
    }
    expect(variants.size).toBeGreaterThan(0);
    for (const v of variants) expect(['crystalA', 'crystalB', 'crystalC']).toContain(v);
  });
});

describe('lily pads', () => {
  it('appear on wetland lakes and only ever sit on water', () => {
    let found = 0;
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = 4; cz <= 12; cz++) {
        for (const p of scatterForChunk(cx, cz)) {
          if (p.kind !== 'lilypad') continue;
          found++;
          expect(biomeAt(p.x, p.z)).toBe('water');
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('per-chunk instance caps', () => {
  it('never exceeds SCATTER.caps[kind] for any biome sample chunk', () => {
    const caps = SCATTER.caps as Record<string, number>;
    for (const c of [FOREST, MEADOW, CRAGS, { cx: 0, cz: 6 }, { cx: -5, cz: -5 }]) {
      const counts: Record<string, number> = {};
      for (const p of scatterForChunk(c.cx, c.cz)) {
        counts[p.kind] = (counts[p.kind] ?? 0) + 1;
      }
      for (const [kind, n] of Object.entries(counts)) {
        if (caps[kind] !== undefined) expect(n).toBeLessThanOrEqual(caps[kind]);
      }
    }
  });
});
