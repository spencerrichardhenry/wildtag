// Seabed decoration (owner playtest P4): pure, seeded placement of each reef layer's coral, kelp, grass, rocks, arches, shells and
// starfish, and the rock and arch solids each stage collides with. world.ts draws exactly what `placeReef` returns.
// Placement rules: a plant's whole footprint (its widest horizontal reach) is clear of every solid's footprint, so no rock sits
// under or around a plant; solid footprints never overlap each other; a rock sits beside its plant and an arch frames it from the
// other side, with its opening facing the plant; both feet of an arch stand in the seabed.
import { biomeAt, makeBiomes, random, seabedHeight, SIZES } from './biomes';
import { colliderMesh, meshShape, solidOf, SolidIndex, sphereShape, newContact, type CapsuleShape, type ColliderMesh, type Solid, type SolidShape } from './solids';
import colliders from './reef-colliders.json';

/** The physical size of each reef layer. Layer i uses the biomes of tier i. Several layers are drawn together at every stage. */
export const REEF_LAYERS = [1, 5, 20] as const;
/** How many placements each layer tries (as before P4). */
export const REEF_TRIES = 70;
/** Layer radii: (REEF_INNER + rand × REEF_SPAN) × size from the centre. */
export const REEF_INNER = 7, REEF_SPAN = 47;

// ---- the art (asset units; build_assets.py) ----

/** The colliders are the visible meshes themselves (final review I2): the stone (Tide_rock) and the moss (Tide_leaf) of each GLB,
 *  exported to reef-colliders.json by scripts/tiny-tide/reef-colliders.mjs (reef.test.ts checks it against the GLBs). Each closed
 *  piece (the stone, each moss patch) is its own mesh, so the inside test of each stays exact where pieces overlap. The arch's thin
 *  crown coral has no collision, like all coral. */
type MeshData = { positions: readonly number[]; index: readonly number[] };
function pieces(data: MeshData, cell: number): ColliderMesh[] {
  const parent = Array.from({ length: data.positions.length / 3 }, (_, i) => i), find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!));
  for (let t = 0; t < data.index.length; t += 3) { const a = find(data.index[t]!); parent[find(data.index[t + 1]!)] = a; parent[find(data.index[t + 2]!)] = a; }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < data.index.length; t += 3) { const g = find(data.index[t]!), list = groups.get(g) ?? []; list.push(data.index[t]!, data.index[t + 1]!, data.index[t + 2]!); groups.set(g, list); }
  return [...groups.values()].map(index => colliderMesh(data.positions, index, cell));
}
const meshesOf = (data: { stone: MeshData; moss: MeshData }) => [...pieces(data.stone, .2), ...pieces(data.moss, .1)];
export const REEF_MESHES: Readonly<Record<'reef_rock_0' | 'reef_rock_1' | 'reef_arch', readonly ColliderMesh[]>> = {
  reef_rock_0: meshesOf(colliders.reef_rock_0), reef_rock_1: meshesOf(colliders.reef_rock_1), reef_arch: meshesOf(colliders.reef_arch),
};
/** The rock's placement footprint in asset units: the ellipsoid of make_rock (centre (0, .15, 0), radii (1, .66, .83), ±9.5 % radial
 *  noise) grown by ROCK_FIT. Every stone vertex is within .04 of it (reef.test.ts). Placement keeps footprints apart; collision uses
 *  the mesh. */
export const ROCK_CENTER_Y = .15, ROCK_RADII = [1, .66, .83] as const, ROCK_FIT = 1.05;
/** The arch tube (make_arch): Catmull-Rom points, radii, 5 steps per span, and the vertex jitter (x ± .04, y ± .065). */
const ARCH_POINTS: readonly (readonly [number, number, number])[] = [[-1.65, -.2, 0], [-1.5, .78, 0], [-1.1, 1.9, .03], [-.31, 2.53, .04], [.62, 2.31, .04], [1.36, 1.40, 0], [1.58, -.2, 0]];
const ARCH_RADII = [.6, .51, .44, .48, .49, .51, .64] as const, ARCH_STEPS = 5;
/** The arch's foot centres (the tube's end points) in asset units. */
export const ARCH_FEET = [ARCH_POINTS[0]!, ARCH_POINTS[ARCH_POINTS.length - 1]!] as const;
/** The arch scale is ARCH_SCALE × the layer size (as before). */
export const ARCH_SCALE = .7;
/** The widest horizontal reach of each plant from its origin, in asset units (reef.test.ts checks them against the GLBs). */
export const PLANT_FOOTPRINT: Readonly<Record<string, number>> = { reef_coral_0: .76, reef_coral_1: .76, reef_coral_2: .62, reef_coral_3: .77, reef_kelp: 1.05, reef_grass: .77 };
/** The widest reach of a shell or starfish, in asset units. */
export const TRINKET_FOOTPRINT = .6;

/** The arch tube's centre line (as make_arch builds it) and the radius at each ring. */
function archRings(): { p: [number, number, number]; r: number }[] {
  const out: { p: [number, number, number]; r: number }[] = [], P = ARCH_POINTS, n = P.length;
  for (let i = 0; i < n - 1; i++) {
    const a = P[Math.max(0, i - 1)]!, b = P[i]!, d = P[i + 1]!, e = P[Math.min(n - 1, i + 2)]!;
    for (let j = 0; j < ARCH_STEPS; j++) {
      const t = j / ARCH_STEPS, c = (k: number) => .5 * (2 * b[k]! + (-a[k]! + d[k]!) * t + (2 * a[k]! - 5 * b[k]! + 4 * d[k]! - e[k]!) * t * t + (-a[k]! + 3 * b[k]! - 3 * d[k]! + e[k]!) * t * t * t);
      out.push({ p: [c(0), c(1), c(2)], r: ARCH_RADII[i]! * (1 - t) + ARCH_RADII[i + 1]! * t });
    }
  }
  out.push({ p: [...P[n - 1]!] as [number, number, number], r: ARCH_RADII[n - 1]! });
  return out;
}
/** Rings per arch capsule, and the jitter allowance (the largest vertex jitter of make_arch). */
const ARCH_RUN = 2, ARCH_JITTER = Math.hypot(.04, .065);
/** The arch's placement footprint in asset units: 15 capsules along the tube (the legs and the top span), each holding its ARCH_RUN + 1
 *  rings with their jitter. The tube body lies inside it. Collision uses the mesh (REEF_MESHES.reef_arch). */
export const ARCH_CAPSULES: readonly CapsuleShape[] = (() => {
  const rings = archRings(), out: CapsuleShape[] = [];
  for (let i = 0; i + ARCH_RUN < rings.length; i += ARCH_RUN) {
    const a = rings[i]!.p, b = rings[i + ARCH_RUN]!.p;
    let radius = 0;
    for (let j = i; j <= i + ARCH_RUN; j++) {
      const q = rings[j]!, abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], len2 = abx * abx + aby * aby + abz * abz;
      const f = Math.max(0, Math.min(1, ((q.p[0] - a[0]) * abx + (q.p[1] - a[1]) * aby + (q.p[2] - a[2]) * abz) / len2));
      radius = Math.max(radius, Math.hypot(q.p[0] - a[0] - abx * f, q.p[1] - a[1] - aby * f, q.p[2] - a[2] - abz * f) + q.r + ARCH_JITTER);
    }
    out.push({ kind: 'capsule', x0: a[0], y0: a[1], z0: a[2], x1: b[0], y1: b[1], z1: b[2], radius });
  }
  return out;
})();

// ---- placements ----

export interface Plant { asset: string; x: number; y: number; z: number; scale: number; footprint: number }
export interface Rock { asset: 'reef_rock_0' | 'reef_rock_1'; x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; solid: Solid }
export interface Arch { x: number; y: number; z: number; scale: number; yaw: number; solid: Solid }
export interface Trinket { asset: 'reef_starfish' | 'reef_shell'; x: number; y: number; z: number; yaw: number }
export interface ReefLayer { layer: number; size: number; plants: Plant[]; rocks: Rock[]; arches: Arch[]; trinkets: Trinket[]; solids: Solid[] }

/** The world ellipsoid of a rock placed at (x, y, z) with scale (sx, sy, sz) and yaw. */
export function rockShape(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): SolidShape {
  return { kind: 'ellipsoid', x, y: y + ROCK_CENTER_Y * sy, z, a: ROCK_RADII[0] * ROCK_FIT * sx, b: ROCK_RADII[1] * ROCK_FIT * sy, c: ROCK_RADII[2] * ROCK_FIT * sz, yaw };
}
/** Asset point (u, v, w) of an object at (x, y, z) with uniform scale s and yaw, in world units (three.js: scale, rotation.y, position). */
function placePoint(u: number, v: number, w: number, x: number, y: number, z: number, s: number, yaw: number): [number, number, number] {
  const co = Math.cos(yaw), si = Math.sin(yaw);
  return [x + (u * co + w * si) * s, y + v * s, z + (-u * si + w * co) * s];
}
export function archShapes(x: number, y: number, z: number, s: number, yaw: number): CapsuleShape[] {
  return ARCH_CAPSULES.map(c => {
    const a = placePoint(c.x0, c.y0, c.z0, x, y, z, s, yaw), b = placePoint(c.x1, c.y1, c.z1, x, y, z, s, yaw);
    return { kind: 'capsule', x0: a[0], y0: a[1], z0: a[2], x1: b[0], y1: b[1], z1: b[2], radius: c.radius * s };
  });
}

/** Is the disc (x, z, R) clear of the solid's footprint (its vertical projection)? Exact for both shape kinds: an ellipsoid's projection
 *  is its equator (the closest point to a point at the centre height lies on it), and a capsule's is a 2D stadium. */
export function footprintClear(solid: Solid, x: number, z: number, R: number): boolean {
  if (x + R < solid.minX || x - R > solid.maxX || z + R < solid.minZ || z - R > solid.maxZ) return true;
  for (const s of solid.footprint ?? solid.shapes) {
    if (s.kind === 'mesh') throw new Error(`footprintClear: ${solid.id} has a mesh and no footprint`);
    if (s.kind === 'ellipsoid') {
      const c = newContact(); c.depth = 0;
      if (sphereShape(s, x, s.y, z, R, c)) return false;
    } else {
      const abx = s.x1 - s.x0, abz = s.z1 - s.z0, len2 = abx * abx + abz * abz;
      const f = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.x0) * abx + (z - s.z0) * abz) / len2)) : 0;
      if (Math.hypot(x - s.x0 - abx * f, z - s.z0 - abz * f) < R + s.radius) return false;
    }
  }
  return true;
}
/** Discs that cover a solid's footprint: an ellipsoid's bounding circle, and along each capsule discs every radius/2 that hold it. */
function coverDiscs(solid: Solid): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const s of solid.footprint ?? solid.shapes) {
    if (s.kind === 'mesh') throw new Error(`coverDiscs: ${solid.id} has a mesh and no footprint`);
    if (s.kind === 'ellipsoid') { out.push([s.x, s.z, Math.max(s.a, s.c)]); continue; }
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), n = Math.max(1, Math.ceil(len / (s.radius / 2))), step = len / n;
    for (let k = 0; k <= n; k++) out.push([s.x0 + (s.x1 - s.x0) * k / n, s.z0 + (s.z1 - s.z0) * k / n, s.radius + step / 2]);
  }
  return out;
}

/** The layer's placements for a world seed. Deterministic per (layer, seed); world.ts draws exactly these. */
export function placeReef(layer: number, seed: number): ReefLayer {
  const size = REEF_LAYERS[layer], out: ReefLayer = { layer, size: size ?? 0, plants: [], rocks: [], arches: [], trinkets: [], solids: [] };
  if (size === undefined) return out;
  const rand = random((seed ^ 0x2f6b) + layer * 0x9e37), biomes = makeBiomes(seed, layer), tierSize = SIZES[layer]!, gap = .15 * size;
  const plantClear = (x: number, z: number, R: number) => out.solids.every(s => footprintClear(s, x, z, R));
  // A new solid's cover discs must clear every earlier solid and every plant's footprint.
  const solidClear = (solid: Solid) => coverDiscs(solid).every(([x, z, R]) => plantClear(x, z, R + gap) && out.plants.every(p => Math.hypot(p.x - x, p.z - z) >= p.footprint + R + gap));
  for (let i = 0; i < REEF_TRIES; i++) {
    const a = rand() * Math.PI * 2, r = (REEF_INNER + rand() * REEF_SPAN) * size, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const decor = biomeAt(biomes, x / tierSize, z / tierSize).decor;
    if (decor === 'sand' && rand() < .65) continue;
    const asset = decor === 'coral' || (decor !== 'kelp' && i % 3 === 0) ? `reef_coral_${i % 4}` : i % 3 === 0 ? 'reef_grass' : 'reef_kelp';
    const scale = size * (.8 + rand()), footprint = PLANT_FOOTPRINT[asset]! * scale;
    const heavy = decor === 'rock' ? 1.7 : 1, sx = size * (.8 + rand()) * heavy, sy = size * (.7 + rand() * .4) * heavy, sz = size * (1 + rand()) * heavy;
    // The rock goes beside the plant, the arch (if any) on the other side.
    const side = rand() * Math.PI * 2;
    if (plantClear(x, z, footprint + gap)) out.plants.push({ asset, x, y: seabedHeight(x, z), z, scale, footprint });
    const reach = Math.max(sx * ROCK_RADII[0], sz * ROCK_RADII[2]) * ROCK_FIT, d = footprint + reach + 2 * gap;
    const rx = x + Math.cos(side) * d, rz = z + Math.sin(side) * d, ry = seabedHeight(rx, rz) - .2 * size;
    const rockAsset = `reef_rock_${i % 2}` as Rock['asset'];
    const rock = solidOf(`rock:${layer}:${i}`, 'rock', REEF_MESHES[rockAsset].map(m => meshShape(m, rx, ry, rz, sx, sy, sz, a)), [rockShape(rx, ry, rz, sx, sy, sz, a)]);
    if (solidClear(rock)) { out.rocks.push({ asset: rockAsset, x: rx, y: ry, z: rz, sx, sy, sz, yaw: a, solid: rock }); out.solids.push(rock); }
    if (i % 7 === 0 || (decor === 'rock' && i % 3 === 0)) {
      // The arch's span (asset x) is across the line to the plant, so the plant shows through its opening.
      const s = size * ARCH_SCALE, phi = side + Math.PI, yaw = Math.PI / 2 - phi, depth = .7 * s, ad = footprint + depth + 2 * gap;
      const ax = x + Math.cos(phi) * ad, az = z + Math.sin(phi) * ad;
      const ay = archBase(ax, az, s, yaw), arch = solidOf(`arch:${layer}:${i}`, 'arch', REEF_MESHES.reef_arch.map(m => meshShape(m, ax, ay, az, s, s, s, yaw)), archShapes(ax, ay, az, s, yaw));
      if (solidClear(arch)) { out.arches.push({ x: ax, y: ay, z: az, scale: s, yaw, solid: arch }); out.solids.push(arch); }
    }
  }
  if (layer === 0) for (let i = 0; i < 42; i++) {
    const x = (rand() - .5) * 85, z = (rand() - .5) * 85, yaw = rand() * Math.PI * 2;
    if (plantClear(x, z, TRINKET_FOOTPRINT * size)) out.trinkets.push({ asset: i % 3 === 0 ? 'reef_starfish' : 'reef_shell', x, y: seabedHeight(x, z) + .03, z, yaw });
  }
  return out;
}

/** Points of each foot's end cap (the ring of the tube's end radius, asset units), used to seat the arch. The end tangent leans up
 *  to 9° from vertical, so a cap point is up to r sin 9° < .11 above the cap centre: the ring is taken .11 higher. */
export function archFootRing(x: number, y: number, z: number, s: number, yaw: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  ARCH_FEET.forEach((f, k) => {
    const r = k === 0 ? ARCH_RADII[0] : ARCH_RADII[ARCH_RADII.length - 1]!;
    out.push(placePoint(f[0], f[1], f[2], x, y, z, s, yaw));
    for (let j = 0; j < 12; j++) { const t = j / 12 * Math.PI * 2; out.push(placePoint(f[0] + Math.cos(t) * r, f[1] + .11, f[2] + Math.sin(t) * r, x, y, z, s, yaw)); }
  });
  return out;
}
/** The arch height: every point of both feet's end caps at or below the seabed (the lowest ground under the caps, less the cap height). */
function archBase(x: number, z: number, s: number, yaw: number): number {
  let lowest = Infinity;
  for (const [px, py, pz] of archFootRing(x, 0, z, s, yaw)) lowest = Math.min(lowest, seabedHeight(px, pz) - py);
  return lowest;
}

// ---- stage solids ----

/** A layer is drawn while the world scale (physical units per render unit, SIZES[stage] at rest) is under 18 × its size (world.ts). */
export const reefLayerVisible = (layer: number, scale: number) => scale / REEF_LAYERS[layer]! < 18;
/** A reef layer collides with a stage's bodies when its rocks are tall enough to meet them: 4 × its size at least the stage's size
 *  (final review I3). Its tallest rocks then stand .14–.18 body lengths over the seabed; a layer under that is drawn only as pebbles
 *  under .05 L, or not at all. Stage 0: layers 0–2; stage 1: 0–2; stage 2: 1 and 2; stage 3: 2; stage 4 (space): none. */
export const layerCollides = (layer: number, stage: number) => stage < 4 && REEF_LAYERS[layer]! * 4 >= SIZES[stage]!;
const layers = new Map<string, ReefLayer>(), indices = new Map<string, SolidIndex>();
const CACHE = 48;
function remember<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (v === undefined) { v = make(); map.set(key, v); if (map.size > CACHE) map.delete(map.keys().next().value!); }
  return v;
}
/** placeReef, cached. */
export const reefLayer = (layer: number, seed: number): ReefLayer => remember(layers, `${seed}:${layer}`, () => placeReef(layer, seed));
/** The solids a stage's bodies collide with (every colliding layer), in a grid of cell 4 × the stage size. */
export function stageSolids(stage: number, seed: number): SolidIndex {
  return remember(indices, `${seed}:${stage}`, () => {
    const solids = REEF_LAYERS.flatMap((_, layer) => layerCollides(layer, stage) ? reefLayer(layer, seed).solids : []);
    return new SolidIndex(solids, 4 * SIZES[Math.min(stage, 3)]!);
  });
}
