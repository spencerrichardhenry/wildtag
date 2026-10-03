// tests/tiny-tide-core/seabed.test.ts — owner playtest P3: the drawn seabed agrees with the collision ground (seabedHeight).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// Final review I8: heavy geometry tests; 1–5 s alone, much longer beside a browser check (the default 5 s timed out under load).
vi.setConfig({ testTimeout: 30_000 });
import { PLAYER_HALF, SIZES, seabedHeight } from '../../src/tiny-tide/biomes';
import { starterFor } from '../../src/tiny-tide/genome';
import { bodyLengthOf } from '../../src/tiny-tide/mount';
import { PLANS } from '../../src/tiny-tide/plans';
import { SEABED_COARSE_RING, SEABED_INNER_HALF, SEABED_INNER_SEGMENTS, SEABED_RINGS, SEABED_VISIBLE, seabedCoarseGeometry, seabedCoarseVisible, seabedRingGeometry, seabedRingVisible } from '../../src/tiny-tide/seabed-mesh';

interface Mesh { positions: ArrayLike<number>; index: ArrayLike<number> }
/** POSITION and indices of every primitive of a GLB (no node transforms: the seabed GLBs have none). */
function readGlb(path: string): Mesh[] {
  const data = readFileSync(path), dv = new DataView(data.buffer, data.byteOffset, data.byteLength), jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength))), bin = 28 + jsonLength, out: Mesh[] = [];
  const view = (i: number) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3 }[a.type as 'SCALAR' | 'VEC3'];
    const o = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), arr: number[] = [];
    for (let k = 0; k < a.count * n!; k++) arr.push(a.componentType === 5126 ? dv.getFloat32(o + 4 * k, true) : a.componentType === 5125 ? dv.getUint32(o + 4 * k, true) : dv.getUint16(o + 2 * k, true));
    return arr;
  };
  for (const m of json.meshes) for (const p of m.primitives) out.push({ positions: view(p.attributes.POSITION), index: view(p.indices) });
  return out;
}

/** The largest |drawn height − seabedHeight| at 15 points per triangle, inside the Chebyshev radius `reach`. */
function maxError(meshes: readonly Mesh[], reach: number): number {
  let worst = 0;
  for (const { positions: p, index } of meshes) for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t]!, b = 3 * index[t + 1]!, c = 3 * index[t + 2]!;
    if (Math.min(Math.max(Math.abs(p[a]!), Math.abs(p[a + 2]!)), Math.max(Math.abs(p[b]!), Math.abs(p[b + 2]!)), Math.max(Math.abs(p[c]!), Math.abs(p[c + 2]!))) > reach) continue;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) {
      const u = i / 4, v = j / 4, w = 1 - u - v;
      const x = p[a]! * u + p[b]! * v + p[c]! * w, z = p[a + 2]! * u + p[b + 2]! * v + p[c + 2]! * w;
      if (Math.max(Math.abs(x), Math.abs(z)) > reach) continue;
      worst = Math.max(worst, Math.abs(p[a + 1]! * u + p[b + 1]! * v + p[c + 1]! * w - seabedHeight(x, z)));
    }
  }
  return worst;
}

describe('the drawn seabed (owner playtest P3)', () => {
  const inner = readGlb('public/tiny-tide/models/seabed_0.glb');
  const rings = SEABED_RINGS.map((r, i) => { const g = seabedRingGeometry(i); return { ring: r, mesh: { positions: g.getAttribute('position').array, index: g.getIndex()!.array } }; });
  const coarseGeometry = seabedCoarseGeometry(), coarse = { positions: coarseGeometry.getAttribute('position').array, index: coarseGeometry.getIndex()!.array };
  /** The meshes drawn at a world scale: the reef, the visible rings and the coarse ring when it shows. */
  const shownAt = (scale: number) => [inner[0]!, ...rings.filter(r => seabedRingVisible(r.ring, scale)).map(r => r.mesh), ...(seabedCoarseVisible(scale) ? [coarse] : [])];
  for (let stage = 0; stage < 4; stage++) {
    // The smallest starter body length of the stage's plans, at growth 1 (the strictest L).
    const L = Math.min(...PLANS.filter(p => p.size === stage).map(p => bodyLengthOf(starterFor(p)))) * SIZES[stage]!, reach = PLAYER_HALF * SIZES[stage]!;
    it(`matches seabedHeight within .02 L everywhere a stage ${stage} player can reach`, () => {
      const shown = shownAt(SIZES[stage]!);
      const err = maxError(shown, reach);
      expect(err / L, `max error ${err.toFixed(3)} physical`).toBeLessThanOrEqual(.02);
    });
  }
  it('covers every stage out to its edge fade without gaps, each ring on the boundary of the one inside it', () => {
    expect(SEABED_RINGS[0]!.from).toBe(SEABED_INNER_HALF);
    for (let i = 1; i < SEABED_RINGS.length; i++) expect(SEABED_RINGS[i]!.from).toBe(SEABED_RINGS[i - 1]!.to);
    for (let stage = 0; stage < 4; stage++) {
      const scale = SIZES[stage]!, shown = [...SEABED_RINGS.filter(r => seabedRingVisible(r, scale)), ...(seabedCoarseVisible(scale) ? [SEABED_COARSE_RING] : [])];
      const far = Math.max(SEABED_INNER_HALF, ...shown.map(r => r.to));
      expect(far, `stage ${stage}`).toBeGreaterThanOrEqual(SEABED_VISIBLE * scale);
      // Each visible ring's inside is visible too (no hole between the reef and a far ring), and no two drawn rings overlap.
      for (const r of shown) if (r.from > SEABED_INNER_HALF) expect(shown.some(q => q.to === r.from)).toBe(true);
      for (const r of shown) for (const q of shown) if (r !== q) expect(r.to <= q.from || q.to <= r.from, `stage ${stage}: ${r.from}–${r.to} and ${q.from}–${q.to}`).toBe(true);
    }
    // The first loop of the first ring is seabed_0's boundary (100 quads per side over ±65): the same vertices, no crack.
    const p = rings[0]!.mesh.positions, g = inner[0]!.positions, boundary = new Set<string>();
    for (let k = 0; k < g.length; k += 3) if (Math.max(Math.abs(g[k]!), Math.abs(g[k + 2]!)) > SEABED_INNER_HALF - 1e-3) boundary.add(`${g[k]!.toFixed(3)},${g[k + 1]!.toFixed(3)},${g[k + 2]!.toFixed(3)}`);
    let onBoundary = 0;
    for (let k = 0; k < p.length; k += 3) if (Math.max(Math.abs(p[k]!), Math.abs(p[k + 2]!)) < SEABED_INNER_HALF + 1e-3) { onBoundary++; expect(boundary.has(`${p[k]!.toFixed(3)},${p[k + 1]!.toFixed(3)},${p[k + 2]!.toFixed(3)}`)).toBe(true); }
    expect(onBoundary).toBe(4 * SEABED_INNER_SEGMENTS);
  });
  it('draws no ring finer than 1/4 local unit per quad at the Big scale, and fewer seabed triangles there (final review M1)', () => {
    const tris = (scale: number) => shownAt(scale).reduce((n, m) => n + m.index.length / 3, 0), scale = SIZES[3]!;
    for (const r of SEABED_RINGS) if (seabedRingVisible(r, scale)) expect(r.spacing / scale, `ring from ${r.from}`).toBeGreaterThanOrEqual(.25);
    if (seabedCoarseVisible(scale)) expect(SEABED_COARSE_RING.spacing / scale).toBeGreaterThanOrEqual(.25);
    const all = [inner[0]!, ...rings.filter(r => r.ring.from < SEABED_VISIBLE * scale).map(r => r.mesh)].reduce((n, m) => n + m.index.length / 3, 0);
    console.log(`stage 3 seabed triangles: ${all} with the fine rings, ${tris(scale)} now`);
    expect(tris(scale)).toBeLessThan(.65 * all);   // 291 580 → 178 052: ring 2 (the stage-3 reach, spacing 24) stays
    // Stages 0–2 draw exactly what they drew before.
    for (let stage = 0; stage < 3; stage++) expect(seabedCoarseVisible(SIZES[stage]!), `stage ${stage}`).toBe(false);
  });
  it('joins the coarse ring to the reef boundary and to ring 2 with the same vertices (no crack)', () => {
    const key = (p: ArrayLike<number>, k: number) => `${p[k]!.toFixed(3)},${p[k + 1]!.toFixed(3)},${p[k + 2]!.toFixed(3)}`;
    const loopAt = (p: ArrayLike<number>, radius: number) => { const out = new Set<string>(); for (let k = 0; k < p.length; k += 3) if (Math.abs(Math.max(Math.abs(p[k]!), Math.abs(p[k + 2]!)) - radius) < 1e-3) out.add(key(p, k)); return out; };
    const outer = SEABED_COARSE_RING.to, ring2 = loopAt(rings[2]!.mesh.positions, outer), mine = loopAt(coarse.positions, outer);
    expect(mine.size).toBeGreaterThan(100); expect([...mine].sort()).toEqual([...ring2].sort());
    const reef = new Set<string>(), g = inner[0]!.positions;
    for (let k = 0; k < g.length; k += 3) if (Math.max(Math.abs(g[k]!), Math.abs(g[k + 2]!)) > SEABED_INNER_HALF - 1e-3) reef.add(key(g, k));
    const first = loopAt(coarse.positions, SEABED_INNER_HALF);
    expect(first.size).toBe(4 * SEABED_INNER_SEGMENTS); for (const v of first) expect(reef.has(v)).toBe(true);
  });
  it('faces every triangle up', () => {
    for (const { positions: p, index } of [...rings.map(r => r.mesh), coarse]) for (let t = 0; t < index.length; t += 3) {
      const a = 3 * index[t]!, b = 3 * index[t + 1]!, c = 3 * index[t + 2]!;
      const ux = p[b]! - p[a]!, uz = p[b + 2]! - p[a + 2]!, vx = p[c]! - p[a]!, vz = p[c + 2]! - p[a + 2]!;
      expect(uz * vx - ux * vz).toBeGreaterThan(0);   // the y part of (b − a) × (c − a)
    }
  });
});
