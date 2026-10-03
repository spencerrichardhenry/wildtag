// tests/tiny-tide-core/reef.test.ts — owner playtest P4: seeded reef placement and the rock and arch colliders.
import { describe, expect, it } from 'vitest';
import { PLAYER_HALF, random, seabedHeight, SIZES } from '../../src/tiny-tide/biomes';
import { starterFor } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { PLANS } from '../../src/tiny-tide/plans';
import { ARCH_CAPSULES, archFootRing, footprintClear, layerCollides, PLANT_FOOTPRINT, placeReef, REEF_LAYERS, REEF_MESHES, reefLayerVisible, ROCK_CENTER_Y, ROCK_FIT, ROCK_RADII, TRINKET_FOOTPRINT } from '../../src/tiny-tide/reef';
import { meshShape, newContact, pointInSolid, sphereShape, type Solid, type SolidShape } from '../../src/tiny-tide/solids';
import colliders from '../../src/tiny-tide/reef-colliders.json';
import { meshDistance, meshOf, readGlb, REEF_SEEDS, type V3 } from './glb';


const model = (name: string) => readGlb(`public/tiny-tide/models/${name}.glb`);

/** How far p lies outside the shapes (0 inside). */
function outside(shapes: readonly SolidShape[], p: V3): number {
  let best = Infinity;
  for (const s of shapes) { const c = newContact(); sphereShape(s, p[0], p[1], p[2], 100, c); best = Math.min(best, Math.max(0, 100 - c.depth)); }
  return best;
}
/** Points of the solid's footprint on a grid of spacing h (for overlap tests between footprints). */
function footprintPoints(s: Solid, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = s.minX; x <= s.maxX; x += h) for (let z = s.minZ; z <= s.maxZ; z += h) if (!footprintClear(s, x, z, 0)) out.push([x, z]);
  return out;
}

describe('reef placement (owner playtest P4)', () => {
  it('is deterministic per layer and seed, and differs between seeds', () => {
    expect(placeReef(1, 4242)).toEqual(placeReef(1, 4242));
    expect(placeReef(1, 4242).rocks.map(r => r.x)).not.toEqual(placeReef(1, 4243).rocks.map(r => r.x));
  });
  for (const seed of REEF_SEEDS) for (let layer = 0; layer < REEF_LAYERS.length; layer++) {
    it(`seed ${seed}, layer ${layer}: plants on the seabed and clear of every solid, arches seated, solids apart`, () => {
      const reef = placeReef(layer, seed), size = REEF_LAYERS[layer]!;
      expect(reef.plants.length).toBeGreaterThan(10);
      expect(reef.rocks.length).toBeGreaterThan(10);
      for (const p of reef.plants) {
        expect(p.y).toBe(seabedHeight(p.x, p.z));
        // No rock under or around a plant: the plant's whole footprint is clear of every solid's footprint.
        for (const s of reef.solids) expect(footprintClear(s, p.x, p.z, p.footprint), `${p.asset} at ${p.x.toFixed(1)},${p.z.toFixed(1)} vs ${s.id}`).toBe(true);
        // And so no solid contains a point of its base disc.
        for (let k = 0; k < 16; k++) for (const f of [0, .5, 1]) {
          const x = p.x + Math.cos(k * Math.PI / 8) * p.footprint * f, z = p.z + Math.sin(k * Math.PI / 8) * p.footprint * f;
          for (const s of reef.solids) expect(pointInSolid(s, x, seabedHeight(x, z), z)).toBe(false);
        }
      }
      for (const a of reef.arches) {
        // Both feet stand in the seabed, and no foot is inside a rock.
        for (const [x, y, z] of archFootRing(a.x, a.y, a.z, a.scale, a.yaw)) {
          expect(y).toBeLessThanOrEqual(seabedHeight(x, z) + 1e-9);
          for (const r of reef.rocks) expect(pointInSolid(r.solid, x, y, z)).toBe(false);
        }
      }
      // Solid footprints do not overlap (sampled at 1/8 of the layer size).
      const pts = reef.solids.map(s => footprintPoints(s, size / 8));
      reef.solids.forEach((s, i) => reef.solids.forEach((o, j) => { if (j > i) for (const [x, z] of pts[i]!) expect(footprintClear(o, x, z, 0), `${s.id} overlaps ${o.id}`).toBe(true); }));
      for (const t of reef.trinkets) for (const s of reef.solids) expect(footprintClear(s, t.x, t.z, TRINKET_FOOTPRINT * size)).toBe(true);
    }, 60_000);   // 1–4 s alone; the full suite runs files in parallel, and beside a browser check it took over 20 s (final review I8)
  }
});

describe('reef placement footprints against the Blender meshes (owner playtest P4; the colliders are the meshes, I2)', () => {
  it('plant footprints hold every plant vertex', () => {
    for (const [name, footprint] of Object.entries(PLANT_FOOTPRINT)) {
      const { verts } = meshOf(model(name));
      expect(Math.max(...verts.map(v => Math.hypot(v[0], v[2]))), name).toBeLessThanOrEqual(footprint);
    }
    for (const name of ['reef_shell', 'reef_starfish']) expect(Math.max(...meshOf(model(name)).verts.map(v => Math.hypot(v[0], v[2])))).toBeLessThanOrEqual(TRINKET_FOOTPRINT);
  });
  for (const name of ['reef_rock_0', 'reef_rock_1']) it(`${name}: the mesh is within .04 of the footprint ellipsoid, which is within .14 of the mesh above the centre`, () => {
    const { verts, tris } = meshOf(model(name));
    const e: SolidShape = { kind: 'ellipsoid', x: 0, y: ROCK_CENTER_Y, z: 0, a: ROCK_RADII[0] * ROCK_FIT, b: ROCK_RADII[1] * ROCK_FIT, c: ROCK_RADII[2] * ROCK_FIT, yaw: 0 };
    expect(Math.max(...verts.map(v => outside([e], v)))).toBeLessThanOrEqual(.04);
    let gap = 0;
    for (let i = 0; i <= 24; i++) for (let j = 0; j < 48; j++) {
      const ph = Math.PI * i / 48, th = 2 * Math.PI * j / 48;
      gap = Math.max(gap, meshDistance([e.a * Math.sin(ph) * Math.cos(th), e.y + e.b * Math.cos(ph), e.c * Math.sin(ph) * Math.sin(th)], tris));
    }
    expect(gap).toBeLessThanOrEqual(.14);
  });
  it('reef_arch: the tube is inside the footprint capsules (moss within .04, crown coral within .06), which are within .2 of the mesh', () => {
    const prims = model('reef_arch'), part = (m: string) => meshOf(prims.filter(p => p.material === m)).verts;
    expect(Math.max(...part('Tide_rock').map(v => outside(ARCH_CAPSULES, v)))).toBeLessThanOrEqual(1e-9);
    expect(Math.max(...part('Tide_leaf').map(v => outside(ARCH_CAPSULES, v)))).toBeLessThanOrEqual(.04);
    expect(Math.max(...part('Tide_soft').map(v => outside(ARCH_CAPSULES, v)))).toBeLessThanOrEqual(.06);
    const { tris } = meshOf(prims.filter(p => p.material !== 'Tide_soft'));
    let gap = 0;
    // Points on each capsule's side that are on the union's surface, above the arch's base (y ≥ 0).
    for (const c of ARCH_CAPSULES) for (let i = 0; i <= 12; i++) for (let j = 0; j < 24; j++) {
      const f = i / 12, th = j / 24 * Math.PI * 2, dx = c.x1 - c.x0, dy = c.y1 - c.y0, l = Math.hypot(dx, dy);
      const p: V3 = [c.x0 + dx * f - dy / l * c.radius * Math.cos(th), c.y0 + dy * f + dx / l * c.radius * Math.cos(th), c.z0 + (c.z1 - c.z0) * f + c.radius * Math.sin(th)];
      if (p[1] < 0 || ARCH_CAPSULES.some(o => o !== c && outside([o], p) === 0 && (() => { const k = newContact(); k.depth = 1e-9; return sphereShape(o, p[0], p[1], p[2], 0, k); })())) continue;
      gap = Math.max(gap, meshDistance(p, tris));
    }
    expect(gap).toBeLessThanOrEqual(.2);
  });
  it('the arch opening is open: a ball of .5 asset units passes under the top span', () => {
    const top = Math.max(...ARCH_CAPSULES.map(c => Math.max(c.y0, c.y1)));
    expect(top).toBeGreaterThan(2);
    expect(outside(ARCH_CAPSULES, [0, 1.2, 0])).toBeGreaterThan(.5);
  });
});

// ---- final review I2 / I3: the colliders follow the visible meshes at every stage ----

/** The smallest starter body length of a stage (the body that meets the smallest gap in body lengths). */
const minL = (stage: number) => Math.min(...PLANS.filter(p => p.size === stage && !p.needs).map(p => playerActor(p, starterFor(p), stage, 1).bodyLength));
/** The world triangles of a placed asset (three.js: scale, rotation.y, position). */
function placed(tris: readonly (readonly [V3, V3, V3])[], x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): [V3, V3, V3][] {
  const co = Math.cos(yaw), si = Math.sin(yaw), at = (v: V3): V3 => { const u = v[0] * sx, w = v[2] * sz; return [x + u * co + w * si, y + v[1] * sy, z - u * si + w * co]; };
  return tris.map(t => [at(t[0]), at(t[1]), at(t[2])]);
}
/** Is p inside the closed mesh? (ray parity along a slightly tilted +y) */
function insideMesh(p: V3, tris: readonly (readonly [V3, V3, V3])[]): boolean {
  const d: V3 = [1e-3, 1, 2e-3]; let n = 0;
  for (const [a, b, c] of tris) {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-15) continue;
    const s: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) continue;
    const q: V3 = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!], v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det > 0) n++;
  }
  return n % 2 === 1;
}
/** How far p lies outside the solid (0 inside), from one sphere test with a radius past the solid. */
function outsideSolid(solid: Solid, p: V3): number {
  const R = 4 * Math.max(solid.maxX - solid.minX, solid.maxY - solid.minY, solid.maxZ - solid.minZ), c = newContact();
  for (const s of solid.shapes) sphereShape(s, p[0], p[1], p[2], R, c);
  return Math.max(0, R - c.depth);
}
const touchesSolid = (solid: Solid, p: V3, r: number) => { const c = newContact(); c.depth = 0; return solid.shapes.some(s => sphereShape(s, p[0], p[1], p[2], r, c)); };
/** Fibonacci directions on the sphere. */
const DIRS: V3[] = Array.from({ length: 160 }, (_, i) => { const y = 1 - 2 * (i + .5) / 160, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5)); return [Math.cos(a) * r, y, Math.sin(a) * r]; });
/** A probe sphere of radius r moves from far outside toward `centre` along each direction until the collider first stops it. At that
 *  point, `gap` is its distance to the visible stone and moss less r (> 0: water between the probe and the rock), for every probe
 *  that is above the seabed (the rock's lower half too). `clip`: how far the stone, moss and coral vertices stand outside the collider.
 *  All in physical units. */
function fit(solid: Solid, art: { stone: [V3, V3, V3][]; moss: [V3, V3, V3][]; coral: [V3, V3, V3][] }, centre: V3, reach: number, r: number) {
  const surface = [...art.stone, ...art.moss];
  let gap = 0, probes = 0;
  for (const d of DIRS) {
    const at = (t: number): V3 => [centre[0] + d[0] * t, centre[1] + d[1] * t, centre[2] + d[2] * t];
    let lo = reach + 2 * r, hi = -1;
    for (let t = lo; t > 0; t -= reach / 200) { if (touchesSolid(solid, at(t), r)) { hi = t; break; } lo = t; }
    if (hi < 0) continue;   // through the arch opening
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (touchesSolid(solid, at(m), r)) hi = m; else lo = m; }
    const p = at(lo);
    if (p[1] - r < seabedHeight(p[0], p[2])) continue;
    probes++;
    if (!insideMesh(p, art.stone)) gap = Math.max(gap, meshDistance(p, surface) - r);
  }
  const clip = (tris: [V3, V3, V3][]) => Math.max(0, ...tris.flatMap(t => t).map(v => outsideSolid(solid, v)));
  return { gap, probes, clipStone: clip(art.stone), clipMoss: clip(art.moss), clipCoral: clip(art.coral) };
}
const ROCK_MESH = { reef_rock_0: model('reef_rock_0'), reef_rock_1: model('reef_rock_1') }, ARCH_MESH = model('reef_arch');
/** The stone (Tide_rock), the moss (Tide_leaf) or the crown coral (Tide_soft) of an asset. */
const part = (prims: ReturnType<typeof model>, which: 'stone' | 'moss' | 'coral') => meshOf(prims.filter(p => p.material === { stone: 'Tide_rock', moss: 'Tide_leaf', coral: 'Tide_soft' }[which])).tris;
/** The colliding layers of each stage (I3): every layer whose rocks are drawn and reach .05 L or more above the seabed. */
const COLLIDING = [[0, 1, 2], [0, 1, 2], [1, 2], [2], []] as const;

describe('colliders follow the visible rocks and arches at every stage (final review I2)', () => {
  for (let stage = 0; stage < 4; stage++) for (const layer of COLLIDING[stage]!) it(`stage ${stage}, layer ${layer}: gap ≤ .06 L; stone and moss inside the collider; coral clip stated`, () => {
    const L = minL(stage), half = PLAYER_HALF * SIZES[stage]!, r = .1 * L;
    let worst = { gap: 0, clipStone: 0, clipMoss: 0, clipCoral: 0, probes: 0 }, solids = 0;
    for (const seed of REEF_SEEDS.slice(0, 2)) {
      const reef = placeReef(layer, seed), inBounds = (s: Solid) => s.minX > -half && s.maxX < half && s.minZ > -half && s.maxZ < half;
      const rocks = reef.rocks.filter(k => inBounds(k.solid)).sort((a, b) => b.sx - a.sx).slice(0, 3), arches = reef.arches.filter(a => inBounds(a.solid)).slice(0, 2);
      const art = (prims: ReturnType<typeof model>, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number) =>
        ({ stone: placed(part(prims, 'stone'), x, y, z, sx, sy, sz, yaw), moss: placed(part(prims, 'moss'), x, y, z, sx, sy, sz, yaw), coral: placed(part(prims, 'coral'), x, y, z, sx, sy, sz, yaw) });
      const runs = [
        ...rocks.map(k => fit(k.solid, art(ROCK_MESH[k.asset], k.x, k.y, k.z, k.sx, k.sy, k.sz, k.yaw), [k.x, k.y + .15 * k.sy, k.z], 1.2 * Math.max(k.sx, k.sy, k.sz), r)),
        ...arches.map(a => fit(a.solid, art(ARCH_MESH, a.x, a.y, a.z, a.scale, a.scale, a.scale, a.yaw), [a.x, a.y + 1.2 * a.scale, a.z], 3.6 * a.scale, r)),
      ];
      solids += runs.length;
      for (const f of runs) worst = { gap: Math.max(worst.gap, f.gap), clipStone: Math.max(worst.clipStone, f.clipStone), clipMoss: Math.max(worst.clipMoss, f.clipMoss), clipCoral: Math.max(worst.clipCoral, f.clipCoral), probes: worst.probes + f.probes };
    }
    // Layer 2 starts 140 units out, past the stage 0 bound (50): no stage 0 body reaches it.
    if (solids === 0) { expect([stage, layer]).toEqual([0, 2]); return; }
    console.log(`stage ${stage} layer ${layer}: gap ${(worst.gap / L).toFixed(4)} L, stone clip ${(worst.clipStone / L).toFixed(4)} L, moss clip ${(worst.clipMoss / L).toFixed(4)} L, crown coral clip ${(worst.clipCoral / L).toFixed(3)} L (${worst.probes} probes)`);
    expect(worst.probes).toBeGreaterThan(100);
    expect(worst.gap / L).toBeLessThanOrEqual(.06);
    expect(worst.clipStone / L).toBeLessThanOrEqual(.001);
    expect(worst.clipMoss / L).toBeLessThanOrEqual(.001);
    // The arch's crown coral has no collision, like all coral. The stated clip: its tips stand at most .25 L outside the collider
    // (measured .233 L, a layer 1 arch at stage 0, the largest arch for its stage).
    expect(worst.clipCoral / L).toBeLessThanOrEqual(.25);
  });
});

describe('the mesh colliders (final review I2)', () => {
  it('reef-colliders.json holds the stone and moss primitives of each GLB; each closed piece is one collider mesh', () => {
    for (const name of ['reef_rock_0', 'reef_rock_1', 'reef_arch'] as const) for (const [key, material] of [['stone', 'Tide_rock'], ['moss', 'Tide_leaf']] as const) {
      const glb = model(name).find(p => p.material === material)!, json = colliders[name][key];
      expect(json.index, name).toEqual(glb.index);
      expect(json.positions.length).toBe(glb.positions.length);
      expect(Math.max(...json.positions.map((v, i) => Math.abs(v - glb.positions[i]!))), `${name} is stale: run node scripts/tiny-tide/reef-colliders.mjs`).toBeLessThanOrEqual(1e-6);
    }
    expect(REEF_MESHES.reef_rock_0.length).toBe(6); expect(REEF_MESHES.reef_rock_1.length).toBe(6); expect(REEF_MESHES.reef_arch.length).toBe(9);   // stone + 5 / 8 moss patches
  });
  it('every collider piece is closed, consistently wound and outward (positive volume) (re-review m4)', () => {
    for (const [name, pieces] of Object.entries(REEF_MESHES)) pieces.forEach((m, i) => {
      const key = (t: number, k: number) => `${m.tri[9 * t + 3 * k]!.toFixed(6)},${m.tri[9 * t + 3 * k + 1]!.toFixed(6)},${m.tri[9 * t + 3 * k + 2]!.toFixed(6)}`;
      const directed = new Map<string, number>();
      let volume = 0;
      for (let t = 0; t < m.count; t++) {
        for (let k = 0; k < 3; k++) { const e = `${key(t, k)}>${key(t, (k + 1) % 3)}`; directed.set(e, (directed.get(e) ?? 0) + 1); }
        const T = (k: number, a: number) => m.tri[9 * t + 3 * k + a]!;
        volume += (T(0, 0) * (T(1, 1) * T(2, 2) - T(1, 2) * T(2, 1)) - T(0, 1) * (T(1, 0) * T(2, 2) - T(1, 2) * T(2, 0)) + T(0, 2) * (T(1, 0) * T(2, 1) - T(1, 1) * T(2, 0))) / 6;
      }
      for (const [e, n] of directed) {
        const [a, b] = e.split('>');
        expect(n, `${name} piece ${i}: edge ${e} used once in its direction`).toBe(1);
        expect(directed.get(`${b}>${a}`), `${name} piece ${i}: edge ${e} has its twin`).toBe(1);
      }
      expect(volume, `${name} piece ${i} volume`).toBeGreaterThan(0);
    });
  });
  it('a sphere test against a placed moss piece gives the exact depth (brute force)', () => {
    const rand = random(23), m = REEF_MESHES.reef_rock_0[1]!, tris: [V3, V3, V3][] = [];
    for (let t = 0; t < m.count; t++) tris.push([0, 1, 2].map(k => [m.tri[9 * t + 3 * k]!, m.tri[9 * t + 3 * k + 1]!, m.tri[9 * t + 3 * k + 2]!] as V3) as [V3, V3, V3]);
    for (let n = 0; n < 60; n++) {
      const sx = .5 + rand() * 9, sy = .5 + rand() * 6, sz = .5 + rand() * 9, yaw = rand() * 7, x = rand() * 10, y = rand() * 3, z = rand() * 10;
      const shape = meshShape(m, x, y, z, sx, sy, sz, yaw), world = placed(tris, x, y, z, sx, sy, sz, yaw), cx = (m.lo[0] + m.hi[0]) / 2, cy = (m.lo[1] + m.hi[1]) / 2, cz = (m.lo[2] + m.hi[2]) / 2;
      const c0 = placed([[[cx, cy, cz], [cx, cy, cz], [cx, cy, cz]]], x, y, z, sx, sy, sz, yaw)[0]![0], p: V3 = [c0[0] + (rand() - .5) * .8 * sx, c0[1] + (rand() - .5) * .3 * sy, c0[2] + (rand() - .5) * .8 * sz], r = .02 + rand() * .3;
      const d = meshDistance(p, world), inside = insideMesh(p, world), c = newContact(); c.depth = 0;
      const hit = sphereShape(shape, p[0], p[1], p[2], r, c);
      if (!inside && d >= r) { expect(hit).toBe(false); continue; }
      expect(hit).toBe(true);
      if (inside && d >= r) { expect(c.depth).toBeGreaterThanOrEqual(2 * r - 1e-9); continue; }
      expect(c.depth).toBeCloseTo(inside ? r + d : r - d, 4);
    }
  });
  it('a sphere test against a placed mesh gives the exact depth, point and outward normal', () => {
    const rand = random(17);
    for (const name of ['reef_rock_0', 'reef_rock_1', 'reef_arch'] as const) {
      const tris = part(name === 'reef_arch' ? ARCH_MESH : ROCK_MESH[name], 'stone');
      for (let n = 0; n < 60; n++) {
        const sx = .5 + rand() * 9, sy = .5 + rand() * 6, sz = .5 + rand() * 9, yaw = rand() * 7, x = rand() * 10, y = rand() * 3, z = rand() * 10;
        const shape = meshShape(REEF_MESHES[name][0]!, x, y, z, sx, sy, sz, yaw), world = placed(tris, x, y, z, sx, sy, sz, yaw);
        const p: V3 = [x + (rand() - .5) * 3 * sx, y + (rand() - .2) * 3 * sy, z + (rand() - .5) * 3 * sz], r = .05 + rand() * 2;
        const d = meshDistance(p, world), inside = insideMesh(p, world), want = inside ? r + d : r - d, c = newContact(); c.depth = 0;
        const hit = sphereShape(shape, p[0], p[1], p[2], r, c);
        if (!inside && d >= r) { expect(hit).toBe(false); continue; }
        expect(hit).toBe(true);
        if (inside && d >= r) { expect(c.depth).toBeGreaterThanOrEqual(2 * r - 1e-9); continue; }   // deep inside: a lower bound
        expect(c.depth).toBeCloseTo(want, 4);   // the JSON keeps 6 decimals of the GLB's float32 positions
        expect(meshDistance([c.px, c.py, c.pz], world)).toBeLessThan(1e-4);
        // The normal points out of the solid: from the surface point toward p when p is outside, away from p when inside.
        const dot = c.nx * (p[0] - c.px) + c.ny * (p[1] - c.py) + c.nz * (p[2] - c.pz);
        if (d > 1e-6) expect(inside ? dot < 0 : dot > 0).toBe(true);
      }
    }
  });
});

describe('every drawn rock that is tall enough to meet a body collides (final review I3)', () => {
  it('a layer collides at a stage exactly when its rocks are drawn there and reach .05 L above the seabed', () => {
    for (let stage = 0; stage < 5; stage++) for (let layer = 0; layer < REEF_LAYERS.length; layer++) {
      const drawn = reefLayerVisible(layer, SIZES[stage]!), tall = stage < 4 && Math.max(...REEF_SEEDS.slice(0, 2).flatMap(seed => placeReef(layer, seed).rocks.map(k => k.solid.maxY - seabedHeight(k.x, k.z)))) >= .05 * minL(stage);
      expect(layerCollides(layer, stage), `stage ${stage}, layer ${layer}`).toBe(drawn && tall);
      expect(COLLIDING[stage]!.includes(layer as never), `stage ${stage}, layer ${layer} in the fit table`).toBe(drawn && tall);
    }
  });
});
