import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCritterModel, isSharedCritterMaterial } from '../src/critters/models.ts';
import { SPECIES } from '../src/critters/species.ts';
import { mulberry32 } from '../src/core/rng.ts';

// Round-2 model budget + material-cache contract tests. Triangle budgets are
// the fidelity-2 round-2 numbers: smooth-shaded organic forms at ≤1200 tris
// per typical critter, ≤1800 for the 16-legged prismhorse.

const TRI_BUDGET_DEFAULT = 1200;
const TRI_BUDGET_PRISMHORSE = 1800;

function triCount(group: THREE.Object3D): number {
  let tris = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    tris += (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
  });
  return tris;
}

describe('critter model tri budgets (round 2)', () => {
  for (const sp of SPECIES) {
    const budget = sp.id === 'prismhorse' ? TRI_BUDGET_PRISMHORSE : TRI_BUDGET_DEFAULT;
    it(`${sp.id} stays under ${budget} tris (worst-case weathering)`, () => {
      // Sample several seeds so conditional weathering accents (extra tuft /
      // notch / mote meshes) are exercised — the budget must hold worst-case.
      let max = 0;
      for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
        const { group } = buildCritterModel(sp.id, mulberry32(seed));
        max = Math.max(max, triCount(group));
      }
      // eslint-disable-next-line no-console
      console.log(`tris ${sp.id}: worst-case ${max} (budget ${budget})`);
      expect(max).toBeLessThanOrEqual(budget);
      expect(max).toBeGreaterThan(0);
    });
  }
});

describe('critter draw-call baking', () => {
  function meshCount(group: THREE.Object3D): number {
    let n = 0;
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }

  it('merges each critter into a handful of meshes (draw-call budget)', () => {
    for (const sp of SPECIES) {
      const cap = sp.id === 'prismhorse' ? 24 : 10; // 16 identity legs float prismhorse
      let worst = 0;
      for (const seed of [1, 2, 3, 5, 8]) {
        const { group } = buildCritterModel(sp.id, mulberry32(seed));
        worst = Math.max(worst, meshCount(group));
      }
      // eslint-disable-next-line no-console
      console.log(`meshes ${sp.id}: worst-case ${worst} (cap ${cap})`);
      expect(worst, sp.id).toBeLessThanOrEqual(cap);
      expect(worst, sp.id).toBeGreaterThan(0);
    }
  });

  it('bakes the eyes into the head mesh (single non-emissive head draw)', () => {
    const { parts } = buildCritterModel('puffle', mulberry32(9));
    expect(meshCount(parts.head)).toBe(1);
    const mesh = parts.head.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    // Vertex colours carry the per-part tints on a shared white-base material.
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('color')).toBeTruthy();
    const m = mesh.material as THREE.MeshStandardMaterial;
    expect(m.vertexColors).toBe(true);
    expect(isSharedCritterMaterial(m)).toBe(true);
  });

  it('keeps emissive glows in their own merged mesh (emissives separate)', () => {
    const { parts } = buildCritterModel('emberpup', mulberry32(11));
    const mats: THREE.MeshStandardMaterial[] = [];
    parts.head.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mats.push(mesh.material as THREE.MeshStandardMaterial);
    });
    expect(mats).toHaveLength(2); // base + ember-tip glow
    const emissiveCount = mats.filter((m) => m.emissive.getHex() !== 0).length;
    expect(emissiveCount).toBe(1);
  });
});

describe('critter material cache', () => {
  it('every mesh material is shared (cache-owned) and deduped across parts', () => {
    const materials = new Set<THREE.Material>();
    let meshCount = 0;
    for (const sp of SPECIES) {
      const { group } = buildCritterModel(sp.id, mulberry32(0xc0ffee));
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        meshCount++;
        const m = mesh.material as THREE.Material;
        expect(Array.isArray(m)).toBe(false);
        expect(isSharedCritterMaterial(m)).toBe(true);
        materials.add(m);
      });
    }
    // The cache must dedupe hard: far fewer distinct materials than meshes
    // (one vertexColors material per bake class, shared game-wide).
    // eslint-disable-next-line no-console
    console.log(`materials: ${materials.size} distinct across ${meshCount} meshes (one of each species)`);
    expect(materials.size).toBeLessThan(meshCount / 3);
  });

  it('smooth and flat materials never alias in the cache (same colour, both shadings)', () => {
    // Craghorn mixes smooth wool with flat-shaded horn ridges; prismhorse is
    // all-flat crystal; puffle is all-smooth. Collect flatShading per material.
    const flags = new Map<THREE.Material, boolean>();
    for (const id of ['craghorn', 'prismhorse', 'puffle']) {
      const { group } = buildCritterModel(id, mulberry32(7));
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        const prev = flags.get(m);
        // One shared material instance must never be observed with two
        // different flatShading values (a cache-key aliasing bug).
        if (prev !== undefined) expect(prev).toBe(m.flatShading);
        flags.set(m, m.flatShading);
      });
    }
    const shadings = new Set([...flags.values()]);
    expect(shadings.has(true)).toBe(true); // crystal/horn faceting survives
    expect(shadings.has(false)).toBe(true); // smooth organic round-2 default
  });

  it('prismhorse keeps its 16 legs and snickerdoodle its flat pancake identity', () => {
    const prism = buildCritterModel('prismhorse', mulberry32(3));
    expect(prism.parts.legs).toHaveLength(16);
    expect(prism.parts.antennae).toHaveLength(2);

    const snick = buildCritterModel('snickerdoodle', mulberry32(3));
    expect(snick.parts.legs).toHaveLength(0);
    expect(snick.parts.head).toBe(snick.parts.body);
    // Pancake: bounding box much wider than tall.
    const bb = new THREE.Box3().setFromObject(snick.group);
    const size = bb.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.y * 2);
  });

  it('per-individual rng variation is deterministic per seed', () => {
    const a = buildCritterModel('emberpup', mulberry32(42));
    const b = buildCritterModel('emberpup', mulberry32(42));
    expect(a.group.scale.x).toBe(b.group.scale.x);
    expect(triCount(a.group)).toBe(triCount(b.group));
  });
});
