import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkManager } from '../src/world/chunks.ts';
import { CHUNKS } from '../src/core/constants.ts';

// The ChunkManager streams terrain meshes around the player, capped at
// CHUNKS.buildsPerUpdate per call, and early-returns once the field is fully
// built and the player hasn't crossed a chunk boundary.

function chunkCount(scene: THREE.Scene): number {
  return scene.children.filter((c) => c.name.startsWith('chunk ')).length;
}

/** Pump update() at a fixed position until the field stops growing. */
function buildToSteady(m: ChunkManager, scene: THREE.Scene, x: number, z: number): number {
  let prev = -1;
  for (let i = 0; i < 400; i++) {
    m.update(x, z);
    const n = chunkCount(scene);
    if (n === prev) return n;
    prev = n;
  }
  return prev;
}

describe('ChunkManager streaming + early-return', () => {
  it('builds at most buildsPerUpdate chunks per call', () => {
    const scene = new THREE.Scene();
    const m = new ChunkManager(scene);
    m.update(0, 0);
    expect(chunkCount(scene)).toBe(CHUNKS.buildsPerUpdate);
  });

  it('fills the full keep-radius field over successive calls, then stays stable', () => {
    const scene = new THREE.Scene();
    const m = new ChunkManager(scene);
    const full = buildToSteady(m, scene, 0, 0);
    const span = 2 * CHUNKS.radius + 1;
    expect(full).toBe(span * span);
    // Steady state: another same-chunk update changes nothing.
    m.update(0, 0);
    expect(chunkCount(scene)).toBe(full);
    // A sub-chunk nudge (still the same chunk) also changes nothing.
    m.update(1, 1);
    expect(chunkCount(scene)).toBe(full);
  });

  it('rebuilds around a far jump (new chunk) — disposes stale, streams fresh', () => {
    const scene = new THREE.Scene();
    const m = new ChunkManager(scene);
    buildToSteady(m, scene, 0, 0);
    const far = CHUNKS.size * 1000;
    m.update(far, far); // wholly disjoint region
    // The single capped pass disposed the out-of-range originals and started a
    // fresh field, so the count is back down to the per-call build cap.
    expect(chunkCount(scene)).toBe(CHUNKS.buildsPerUpdate);
  });
});
