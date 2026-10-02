// GLB reading and mesh distances for the collider fit tests (owner playtest P4). The reef GLBs have no node transforms.
import { readFileSync } from 'node:fs';

export interface Primitive { material: string; positions: number[]; index: number[] }
/** POSITION and indices of every primitive of a GLB, with its material name. */
export function readGlb(path: string): Primitive[] {
  const data = readFileSync(path), dv = new DataView(data.buffer, data.byteOffset, data.byteLength), jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength))), bin = 28 + jsonLength, out: Primitive[] = [];
  const view = (i: number) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3 }[a.type as 'SCALAR' | 'VEC3']!;
    const o = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), arr: number[] = [];
    for (let k = 0; k < a.count * n; k++) arr.push(a.componentType === 5126 ? dv.getFloat32(o + 4 * k, true) : a.componentType === 5125 ? dv.getUint32(o + 4 * k, true) : dv.getUint16(o + 2 * k, true));
    return arr;
  };
  for (const m of json.meshes) for (const p of m.primitives) out.push({ material: json.materials?.[p.material]?.name ?? '', positions: view(p.attributes.POSITION), index: view(p.indices) });
  return out;
}

export type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Distance from p to the triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangle(p: V3, a: V3, b: V3, c: V3): number {
  const at = (x: V3) => Math.hypot(p[0] - x[0], p[1] - x[1], p[2] - x[2]);
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return at([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}
/** The vertices and triangles of the primitives. */
export function meshOf(prims: readonly Primitive[]): { verts: V3[]; tris: [V3, V3, V3][] } {
  const verts: V3[] = [], tris: [V3, V3, V3][] = [];
  for (const { positions: p, index } of prims) {
    const at = (k: number): V3 => [p[3 * k]!, p[3 * k + 1]!, p[3 * k + 2]!];
    for (let k = 0; k < p.length / 3; k++) verts.push(at(k));
    for (let t = 0; t < index.length; t += 3) tris.push([at(index[t]!), at(index[t + 1]!), at(index[t + 2]!)]);
  }
  return { verts, tris };
}
/** Distance from p to the nearest triangle. */
export const meshDistance = (p: V3, tris: readonly (readonly [V3, V3, V3])[]) => { let best = Infinity; for (const t of tris) best = Math.min(best, pointTriangle(p, t[0], t[1], t[2])); return best; };

/** The world seeds of the reef tests (the five of the playtest investigation, and 7). */
export const REEF_SEEDS = [99, 1501, 4242, 71829, 123456, 7] as const;
