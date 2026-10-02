// tests/tiny-tide-core/reef.test.ts — owner playtest P4: seeded reef placement and the rock and arch colliders.
import { describe, expect, it } from 'vitest';
import { seabedHeight } from '../../src/tiny-tide/biomes';
import { ARCH_CAPSULES, archFootRing, footprintClear, PLANT_FOOTPRINT, placeReef, REEF_LAYERS, ROCK_CENTER_Y, ROCK_FIT, ROCK_RADII, TRINKET_FOOTPRINT } from '../../src/tiny-tide/reef';
import { newContact, pointInSolid, sphereShape, type Solid, type SolidShape } from '../../src/tiny-tide/solids';
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
    });
  }
});

describe('reef colliders against the Blender meshes (owner playtest P4)', () => {
  it('plant footprints hold every plant vertex', () => {
    for (const [name, footprint] of Object.entries(PLANT_FOOTPRINT)) {
      const { verts } = meshOf(model(name));
      expect(Math.max(...verts.map(v => Math.hypot(v[0], v[2]))), name).toBeLessThanOrEqual(footprint);
    }
    for (const name of ['reef_shell', 'reef_starfish']) expect(Math.max(...meshOf(model(name)).verts.map(v => Math.hypot(v[0], v[2])))).toBeLessThanOrEqual(TRINKET_FOOTPRINT);
  });
  for (const name of ['reef_rock_0', 'reef_rock_1']) it(`${name}: the mesh is within .04 of the ellipsoid, which is within .14 of the mesh above the centre`, () => {
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
  it('reef_arch: the tube is inside the capsules (moss within .04, crown coral within .06), which are within .2 of the mesh', () => {
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
