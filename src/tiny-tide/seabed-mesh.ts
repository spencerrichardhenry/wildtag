// The far seabed (owner playtest P3). Around the Blender reef mesh (seabed_0: 100 × 100 quads over ±65 physical units) the
// seabed is drawn as nested square rings sampled from seabedHeight, the collision ground. A linear triangle misses the curved
// ground by about .0035 × spacing² (seabedHeight's curvature), so each ring's spacing keeps that under half of .02 L for the
// smallest stage whose player can reach it (L = 2.43 × size for every starter): stage 1 reaches 200 (spacing 5, ≈ .09 of .19),
// stage 2 reaches 800 (10, ≈ .35 of .78) and stage 3 reaches 3200 (24, ≈ 2.0 of 3.1). Past the stage-3 reach the ground is only
// seen up to the edge fade, so it is coarser. Each ring starts on the loop where the one inside it ends (the reef's own boundary
// for the first), so there are no cracks. The geometry is built once; a ring is drawn only at scales where it can be seen.
import * as T from 'three';
import { PLAYER_HALF, seabedHeight } from './biomes';
import { EDGE_FADE_END } from './edge';

export interface SeabedRing { from: number; to: number; spacing: number }
/** seabed_0 (Blender): the reef mesh's half size and its quads per side. */
export const SEABED_INNER_HALF = 65, SEABED_INNER_SEGMENTS = 100;
/** The edge fade ends here (tier-local units); nothing past it is seen at any stage. */
export const SEABED_VISIBLE = PLAYER_HALF * EDGE_FADE_END;
/** Chebyshev radii and spacings, in physical units. */
export const SEABED_RINGS: readonly SeabedRing[] = [
  { from: SEABED_INNER_HALF, to: 4 * SEABED_VISIBLE, spacing: 4 },
  { from: 4 * SEABED_VISIBLE, to: 16 * SEABED_VISIBLE, spacing: 8 },
  { from: 16 * SEABED_VISIBLE, to: 64 * PLAYER_HALF, spacing: 24 },
  { from: 64 * PLAYER_HALF, to: 64 * SEABED_VISIBLE, spacing: 48 },
];

/** A ring is drawn when its inside can be seen at this world scale (physical units per render unit). */
export const seabedRingVisible = (r: SeabedRing, scale: number): boolean => r.from < SEABED_VISIBLE * scale;

/** The loops of ring `index`: Chebyshev radius and segments per side. Its first loop has the segments of the loop inside it. */
function loops(index: number): { radius: number; segments: number }[] {
  let first = SEABED_INNER_SEGMENTS;
  for (let i = 0; i < index; i++) first = loops(i).at(-1)!.segments;
  const r = SEABED_RINGS[index]!, steps = Math.ceil((r.to - r.from) / r.spacing), out = [{ radius: r.from, segments: first }];
  for (let j = 1; j <= steps; j++) { const radius = r.from + (r.to - r.from) * j / steps; out.push({ radius, segments: Math.ceil(2 * radius / r.spacing) }); }
  return out;
}

const LIGHT = new T.Color('#d6d2ad'), DEEP = new T.Color('#65a1a2'), scratch = new T.Color();
/** The vertex colour of the Blender seabed (build_assets.py make_terrain), in linear space. */
function seabedColor(x: number, z: number, out: T.Color): T.Color {
  const t = Math.max(0, Math.min(1, (Math.abs(x) + Math.abs(z)) / 650 + Math.sin(x * .08) * .09)), ripple = .96 + .04 * Math.sin(x * 3.7 + Math.sin(z * .7));
  return out.copy(LIGHT).lerp(DEEP, t).multiplyScalar(ripple);
}

/** The geometry of ring `index`: positions on seabedHeight, its normals and colours, and triangles that face up. */
export function seabedRingGeometry(index: number): T.BufferGeometry {
  const ls = loops(index), count = ls.reduce((n, l) => n + 4 * l.segments, 0);
  const position = new Float32Array(3 * count), normal = new Float32Array(3 * count), color = new Float32Array(3 * count), starts: number[] = [];
  let v = 0;
  for (const { radius: r, segments: n } of ls) {
    starts.push(v);
    for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
      // The same expression as the Blender mesh ((u − .5) × 2r), so the first loop repeats the reef's boundary points.
      const a = (i / n - .5) * 2 * r, x = [a, r, -a, -r][side]!, z = [-r, a, r, -a][side]!, y = seabedHeight(x, z);
      const gx = (seabedHeight(x + .5, z) - seabedHeight(x - .5, z)), gz = (seabedHeight(x, z + .5) - seabedHeight(x, z - .5)), k = 1 / Math.hypot(gx, 1, gz);
      seabedColor(x, z, scratch);
      position[3 * v] = x; position[3 * v + 1] = y; position[3 * v + 2] = z;
      normal[3 * v] = -gx * k; normal[3 * v + 1] = k; normal[3 * v + 2] = -gz * k;
      color[3 * v] = scratch.r; color[3 * v + 1] = scratch.g; color[3 * v + 2] = scratch.b;
      v++;
    }
  }
  const index3: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    const ux = position[3 * b]! - position[3 * a]!, uz = position[3 * b + 2]! - position[3 * a + 2]!, vx = position[3 * c]! - position[3 * a]!, vz = position[3 * c + 2]! - position[3 * a + 2]!;
    if (uz * vx - ux * vz > 0) index3.push(a, b, c); else index3.push(a, c, b);
  };
  for (let j = 0; j + 1 < ls.length; j++) {
    const A = ls[j]!, B = ls[j + 1]!, a0 = starts[j]!, b0 = starts[j + 1]!;
    const at = (start: number, n: number, side: number, i: number) => start + (side * n + i) % (4 * n);
    for (let side = 0; side < 4; side++) {
      // Zip the two loops along this side by their positions along it.
      let i = 0, k = 0;
      while (i < A.segments || k < B.segments) {
        if (k >= B.segments || (i < A.segments && (i + 1) / A.segments <= (k + 1) / B.segments)) {
          tri(at(a0, A.segments, side, i), at(b0, B.segments, side, k), at(a0, A.segments, side, i + 1)); i++;
        } else { tri(at(a0, A.segments, side, i), at(b0, B.segments, side, k), at(b0, B.segments, side, k + 1)); k++; }
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(position, 3)); g.setAttribute('normal', new T.BufferAttribute(normal, 3)); g.setAttribute('color', new T.BufferAttribute(color, 3));
  g.setIndex(new T.BufferAttribute(new Uint32Array(index3), 1)); g.computeBoundingSphere();
  return g;
}
