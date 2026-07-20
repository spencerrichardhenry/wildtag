import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkManager, LOD_FAR, LOD_NEAR, selectChunkLod, vertsForLod } from '../src/world/chunks.ts';
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

describe('selectChunkLod (near-LOD hysteresis)', () => {
  it('keeps everything far when nearLod is disabled (low preset)', () => {
    expect(selectChunkLod(0, LOD_FAR, false)).toBe(LOD_FAR);
    expect(selectChunkLod(0, LOD_NEAR, false)).toBe(LOD_FAR);
    expect(selectChunkLod(1000, LOD_NEAR, false)).toBe(LOD_FAR);
  });

  it('promotes a far chunk to near only inside lodPromote', () => {
    expect(selectChunkLod(CHUNKS.lodPromote - 1, LOD_FAR, true)).toBe(LOD_NEAR);
    // Between promote and demote, a currently-far chunk stays far (hysteresis).
    expect(selectChunkLod(CHUNKS.lodPromote + 1, LOD_FAR, true)).toBe(LOD_FAR);
    expect(selectChunkLod((CHUNKS.lodPromote + CHUNKS.lodDemote) / 2, LOD_FAR, true)).toBe(LOD_FAR);
  });

  it('demotes a near chunk to far only past lodDemote', () => {
    expect(selectChunkLod(CHUNKS.lodDemote + 1, LOD_NEAR, true)).toBe(LOD_FAR);
    // Between promote and demote, a currently-near chunk stays near (hysteresis).
    expect(selectChunkLod(CHUNKS.lodDemote - 1, LOD_NEAR, true)).toBe(LOD_NEAR);
    expect(selectChunkLod((CHUNKS.lodPromote + CHUNKS.lodDemote) / 2, LOD_NEAR, true)).toBe(LOD_NEAR);
  });

  it('does not thrash across a single boundary crossing (promote < demote)', () => {
    // A chunk oscillating in the hysteresis band holds whatever LOD it had.
    let lod = LOD_FAR;
    const band = (CHUNKS.lodPromote + CHUNKS.lodDemote) / 2;
    lod = selectChunkLod(band, lod, true);
    expect(lod).toBe(LOD_FAR); // never promoted (never dipped below lodPromote)
    lod = selectChunkLod(CHUNKS.lodPromote - 5, lod, true); // approach → promote
    expect(lod).toBe(LOD_NEAR);
    lod = selectChunkLod(band, lod, true); // drift back into the band → stays near
    expect(lod).toBe(LOD_NEAR);
  });

  it('maps LOD levels to the 1 m / 2 m grids', () => {
    expect(vertsForLod(LOD_NEAR)).toBe(CHUNKS.nearVerts);
    expect(vertsForLod(LOD_FAR)).toBe(CHUNKS.verts);
  });
});

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
