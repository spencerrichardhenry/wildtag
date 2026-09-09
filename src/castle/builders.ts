import { refineArt } from '../art/library.ts';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CASTLE, CASTLE_COLORS, CRYSTAL, SPIRES, WARD, WARD_COLORS, WORLD_SEED } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';
import { mulberry32 } from '../core/rng.ts';
import { castleLayout, type CastleLayout } from './layout.ts';
import { wardLayout, nonRingRuns, extendedWallSpan, type WardLayout, type WallRun } from './ward.ts';

// ---------------------------------------------------------------------------
// Procedural cursed/purified castle meshes (Task 9). Follows the village
// builder convention (`src/village/buildings.ts`): flat-shaded Lambert boxes/
// cylinders/cones built once from the pure layout, then collapsed into a
// handful of vertex-coloured merged meshes (`mergeCastle`, a local copy of
// `mergeVillage`'s technique — it's private to the village module) so the
// whole castle costs only a few draw calls regardless of dressing.
//
// Two dressings share identical geometry, differing only in palette + trim:
//   cursed   — dark stonework, ember-emissive window slits on towers/keep.
//   purified — warm limestone, ivy strips on walls, banners on towers, a
//              handful of warm point lights at the gate + keep.
//
// Everything sits on `y = CASTLE.padHeight` (the flattened hilltop pad); the
// gate is wherever `castleLayout().gate` says it is (the EAST wall for this
// site) — nothing here hardcodes a compass side.
// ---------------------------------------------------------------------------

type Colors = (typeof CASTLE_COLORS)['cursed' | 'purified'];

type MatOpts = { emissive?: number; emissiveIntensity?: number };

function mat(color: number, opts: MatOpts = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return m;
}

function box(w: number, h: number, d: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

function cylinder(rTop: number, rBottom: number, h: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 12), mat(color));
}

function cone(r: number, h: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), mat(color, opts));
  return mesh;
}

/** A double-sided, slightly folded cloth pennant. Castle meshes are merged
 * into a front-sided material, so both windings are authored explicitly. */
function clothPennant(w: number, h: number, color: number, torn: boolean): THREE.Mesh {
  const bottom = torn
    ? [
        [-w / 2, -h * 0.34, 0],
        [-w * 0.2, -h / 2, 0.035],
        [0.02, -h * 0.31, -0.025],
        [w * 0.25, -h * 0.47, 0.025],
        [w / 2, -h * 0.29, 0],
      ]
    : [
        [-w / 2, -h * 0.4, 0],
        [0, -h / 2, 0.04],
        [w / 2, -h * 0.4, 0],
      ];
  const polygon = [
    [-w / 2, h / 2, 0],
    [w / 2, h / 2, 0],
    ...bottom.slice().reverse(),
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 1; i < polygon.length - 1; i++) {
    const tri = [polygon[0]!, polygon[i]!, polygon[i + 1]!];
    for (const p of tri) {
      positions.push(p[0]!, p[1]!, p[2]!);
      uvs.push(p[0]! / w + 0.5, p[1]! / h + 0.5);
    }
    for (const p of tri.slice().reverse()) {
      positions.push(p[0]!, p[1]!, p[2]!);
      uvs.push(p[0]! / w + 0.5, p[1]! / h + 0.5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, mat(color));
}

interface StoneRunOpts {
  /** Chunky horizontal courses; 2 is enough for low ward walls, 4+ for keeps. */
  courses?: number;
  /** Alternating corner blocks at each end of the run. */
  quoins?: boolean;
}

/** Storybook masonry over an unchanged wall footprint: stacked two-tone
 * courses, shallow shadow joints, a foundation/cap course and optional
 * endpoint quoins. All pieces still collapse into the castle's static bucket. */
function addStoneRun(
  root: THREE.Group,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  thickness: number,
  height: number,
  baseY: number,
  colors: Colors,
  opts: StoneRunOpts = {},
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len <= 0.01) return;
  const ux = dx / len;
  const uz = dz / len;
  const angle = Math.atan2(dx, dz);
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const courseCount = opts.courses ?? Math.max(3, Math.round(height / 1.8));
  const courseH = height / courseCount;

  for (let i = 0; i < courseCount; i++) {
    const color = i % 2 === 0 ? colors.stone : colors.stoneLight;
    const course = box(thickness, courseH + 0.025, len, color);
    course.position.set(cx, baseY + courseH * (i + 0.5), cz);
    course.rotation.y = angle;
    root.add(course);
  }

  // Thin recessed-looking joints make the courses survive the broad daylight
  // fill light without turning the wall into a stripy barcode.
  const jointH = Math.min(0.14, courseH * 0.1);
  for (let i = 1; i < courseCount; i++) {
    const joint = box(thickness * 1.025, jointH, len + 0.025, colors.stoneDark);
    joint.position.set(cx, baseY + courseH * i, cz);
    joint.rotation.y = angle;
    root.add(joint);
  }

  const foundation = box(thickness * 1.1, Math.min(0.42, courseH * 0.32), len + 0.08, colors.stoneDark);
  foundation.position.set(cx, baseY + Math.min(0.42, courseH * 0.32) / 2, cz);
  foundation.rotation.y = angle;
  root.add(foundation);
  const cap = box(thickness * 1.12, 0.24, len + 0.1, colors.stoneLight);
  cap.position.set(cx, baseY + height - 0.12, cz);
  cap.rotation.y = angle;
  root.add(cap);

  if (!opts.quoins) return;
  const quoinH = Math.min(0.78, courseH * 0.62);
  const quoinW = Math.min(1.15, Math.max(0.72, thickness * 0.42));
  for (const end of [0, len] as const) {
    for (let i = 0; i < courseCount; i++) {
      const inward = end === 0 ? quoinW * 0.46 : -quoinW * 0.46;
      const q = box(thickness * 1.2, quoinH, quoinW, i % 2 === 0 ? colors.stoneLight : colors.stoneDark);
      q.position.set(
        x1 + ux * (end + inward),
        baseY + courseH * (i + 0.5),
        z1 + uz * (end + inward),
      );
      q.rotation.y = angle;
      root.add(q);
    }
  }
}

/** The wall whose midpoint matches the gate (i.e. the gated wall). */
function findGateWall(l: CastleLayout) {
  return l.walls.find(
    (w) => Math.hypot((w.x1 + w.x2) / 2 - l.gate.x, (w.z1 + w.z2) / 2 - l.gate.z) < 1e-6,
  )!;
}

/**
 * Arc-length windows [start, end] (from the wall's first endpoint) that carry
 * actual masonry on this wall run: the whole length, or — on the gate wall —
 * the two flanks either side of the real gate gap (so the mesh matches the
 * collider's opening, not just a decorative arch painted over solid stone).
 */
function wallRunSegments(
  w: { x1: number; z1: number; x2: number; z2: number },
  gate: { x: number; z: number; w: number },
): [number, number][] {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const midx = (w.x1 + w.x2) / 2;
  const midz = (w.z1 + w.z2) / 2;
  const isGateWall = Math.hypot(midx - gate.x, midz - gate.z) < 1e-6;
  if (!isGateWall) return [[0, len]];
  const gateHalf = gate.w / 2;
  return [
    [0, len / 2 - gateHalf],
    [len / 2 + gateHalf, len],
  ];
}

/** Chunky merlons: broad enough to read from the highlands approach. */
const TOOTH_SPACING = 4.5;
const TOOTH_W = 2.55;
const TOOTH_H = 1.25;

function addCrenellations(
  root: THREE.Group,
  x1: number,
  z1: number,
  angle: number,
  ux: number,
  uz: number,
  a: number,
  b: number,
  topY: number,
  thickness: number,
  color: number,
): void {
  const segLen = b - a;
  if (segLen <= 0.01) return;
  const count = Math.max(1, Math.floor(segLen / TOOTH_SPACING));
  const step = segLen / count;
  for (let i = 0; i < count; i++) {
    const arc = a + step * (i + 0.5);
    const tx = x1 + ux * arc;
    const tz = z1 + uz * arc;
    const tooth = box(thickness * 1.12, TOOTH_H, Math.min(TOOTH_W, step * 0.7), color);
    tooth.position.set(tx, topY + TOOTH_H / 2, tz);
    tooth.rotation.y = angle;
    root.add(tooth);
  }
}

/** One curtain-wall run: masonry (gate-aware) + crenellation teeth + purified ivy. */
function buildWall(
  root: THREE.Group,
  w: CastleLayout['walls'][number],
  gate: CastleLayout['gate'],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const angle = Math.atan2(dx, dz);
  const topY = baseY + w.h;

  for (const [a, b] of wallRunSegments(w, gate)) {
    const segLen = b - a;
    if (segLen <= 0.01) continue;

    addStoneRun(
      root,
      w.x1 + ux * a,
      w.z1 + uz * a,
      w.x1 + ux * b,
      w.z1 + uz * b,
      w.t,
      w.h,
      baseY,
      colors,
      { courses: 4, quoins: true },
    );

    addCrenellations(root, w.x1, w.z1, angle, ux, uz, a, b, topY, w.t, colors.stoneDark);

    if (purified) {
      // A couple of thin ivy strips climbing the outward wall face.
      for (let s = segLen * 0.3; s < segLen; s += segLen * 0.4) {
        const ix = w.x1 + ux * (a + s);
        const iz = w.z1 + uz * (a + s);
        const ivy = box(w.t * 1.08, w.h * 0.75, 0.6, (colors as typeof CASTLE_COLORS.purified).ivy);
        ivy.position.set(ix, baseY + w.h * 0.4, iz);
        ivy.rotation.y = angle;
        root.add(ivy);
      }
    }
  }
}

/** A corner tower: banded drum, crown merlons, overhung cone roof, finial,
 * lantern slits and a cloth pennant in both dressings. */
function buildTower(
  root: THREE.Group,
  t: CastleLayout['towers'][number],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const courseCount = 6;
  const courseH = t.h / courseCount;
  for (let i = 0; i < courseCount; i++) {
    const body = cylinder(t.r, t.r * (1.035 + (courseCount - i) * 0.004), courseH + 0.03, i % 2 === 0 ? colors.stone : colors.stoneLight);
    body.position.set(t.x, baseY + courseH * (i + 0.5), t.z);
    root.add(body);
    if (i > 0) {
      const courseBand = cylinder(t.r * 1.035, t.r * 1.035, 0.16, colors.stoneDark);
      courseBand.position.set(t.x, baseY + courseH * i, t.z);
      root.add(courseBand);
    }
  }
  const baseRing = cylinder(t.r * 1.1, t.r * 1.13, 0.5, colors.stoneDark);
  baseRing.position.set(t.x, baseY + 0.25, t.z);
  root.add(baseRing);
  const crownBand = cylinder(t.r * 1.08, t.r * 1.06, 0.42, colors.stoneLight);
  crownBand.position.set(t.x, baseY + t.h - 0.16, t.z);
  root.add(crownBand);

  const merlonCount = 12;
  for (let i = 0; i < merlonCount; i++) {
    const ang = (i / merlonCount) * Math.PI * 2;
    const merlon = box(1.05, 1.15, 0.9, i % 2 === 0 ? colors.stoneDark : colors.stone);
    merlon.position.set(
      t.x + Math.sin(ang) * t.r * 0.96,
      baseY + t.h + 0.48,
      t.z + Math.cos(ang) * t.r * 0.96,
    );
    merlon.rotation.y = ang;
    root.add(merlon);
  }

  const roofH = t.r * 1.62;
  const eave = cylinder(t.r * 1.2, t.r * 1.2, 0.42, colors.stoneDark);
  eave.position.set(t.x, baseY + t.h + 0.54, t.z);
  root.add(eave);
  const roofMesh = cone(t.r * 1.18, roofH, colors.roof);
  roofMesh.position.set(t.x, baseY + t.h + 0.55 + roofH / 2, t.z);
  root.add(roofMesh);

  const roofTopY = baseY + t.h + 0.55 + roofH;
  const finialBall = sphere(0.3, colors.stoneLight);
  finialBall.position.set(t.x, roofTopY + 0.17, t.z);
  root.add(finialBall);
  const finial = cone(0.18, 0.8, colors.stoneDark);
  finial.position.set(t.x, roofTopY + 0.7, t.z);
  root.add(finial);

  if (!purified) {
    const c = colors as typeof CASTLE_COLORS.cursed;
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const sx = t.x + Math.sin(ang) * t.r * 0.98;
      const sz = t.z + Math.cos(ang) * t.r * 0.98;
      const slit = box(0.4, 1.6, 0.4, colors.stoneDark, {
        emissive: c.ember,
        emissiveIntensity: 1.4,
      });
      slit.position.set(sx, baseY + t.h * 0.55, sz);
      root.add(slit);
    }
  }

  const outAng = Math.atan2(t.x - CASTLE.center.x, t.z - CASTLE.center.z);
  const bx = t.x + Math.sin(outAng) * (t.r + 0.12);
  const bz = t.z + Math.cos(outAng) * (t.r + 0.12);
  const crossbar = box(2.05, 0.12, 0.12, colors.stoneDark);
  crossbar.position.set(bx, baseY + t.h * 0.72 + 1.25, bz);
  crossbar.rotation.y = outAng;
  root.add(crossbar);
  const banner = clothPennant(1.65, 2.75, colors.banner, !purified);
  banner.position.set(bx, baseY + t.h * 0.72, bz);
  banner.rotation.y = outAng;
  root.add(banner);
}

/**
 * The keep (Task 14 review follow-up): a HOLLOW crenellated room — 4
 * perimeter walls (thin, `CASTLE.keepWallT`) + a stone floor slab + open top
 * (no roof) — NOT a solid block. The dark crystal (built separately by
 * `CastleSystem`) sits on the floor at the centre, visible from above the
 * walls and through the entrance opening. The entrance sits on the same
 * compass side as the main gate (`layout.ts` picks it via the same
 * `gateWallIndex`), so it's a straight walk-in from the courtyard — flanked
 * by a lintel so it reads as a doorway, not a construction gap.
 *
 * Mirrors `buildWall`'s gate-aware segment pattern almost exactly, just
 * against `layout.keepWalls` + `layout.keep.entrance` instead of the curtain
 * wall's `walls` + `gate`.
 */
function buildKeep(
  root: THREE.Group,
  layout: CastleLayout,
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const keep = layout.keep;
  const size = keep.half * 2;

  // Thin stone floor — the crystal's plinth sits on/into this.
  const floor = box(size, 0.3, size, colors.stone);
  floor.position.set(keep.x, baseY + 0.15, keep.z);
  root.add(floor);

  const topY = baseY + keep.h;

  for (const w of layout.keepWalls) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const angle = Math.atan2(dx, dz);
    const midx = (w.x1 + w.x2) / 2;
    const midz = (w.z1 + w.z2) / 2;
    const isEntranceWall = Math.hypot(midx - keep.entrance.x, midz - keep.entrance.z) < 1e-6;

    for (const [a, b] of wallRunSegments(w, keep.entrance)) {
      const segLen = b - a;
      if (segLen <= 0.01) continue;

      addStoneRun(
        root,
        w.x1 + ux * a,
        w.z1 + uz * a,
        w.x1 + ux * b,
        w.z1 + uz * b,
        w.t,
        w.h,
        baseY,
        colors,
        { courses: 8, quoins: true },
      );

      addCrenellations(root, w.x1, w.z1, angle, ux, uz, a, b, topY, w.t, colors.stoneDark);
    }

    // Ember slit (cursed only, matching the original keep dressing) — skipped
    // on the entrance wall, where the mid-wall point sits in the open doorway.
    if (!isEntranceWall && !purified) {
      const c = colors as typeof CASTLE_COLORS.cursed;
      const slit = box(0.5, 2.2, 0.5, colors.stoneDark, { emissive: c.ember, emissiveIntensity: 1.4 });
      slit.position.set(midx, baseY + keep.h * 0.5, midz);
      root.add(slit);
    }
  }

  // Lintel bridging the entrance opening, so it reads as a doorway.
  const entranceWall = layout.keepWalls.find(
    (w) => Math.hypot((w.x1 + w.x2) / 2 - keep.entrance.x, (w.z1 + w.z2) / 2 - keep.entrance.z) < 1e-6,
  )!;
  const entAngle = Math.atan2(entranceWall.x2 - entranceWall.x1, entranceWall.z2 - entranceWall.z1);
  const lintelH = Math.max(0.4, keep.h - keep.entrance.h);
  const lintel = box(entranceWall.t, lintelH, keep.entrance.w + entranceWall.t, colors.stoneDark);
  lintel.position.set(keep.entrance.x, baseY + keep.entrance.h + lintelH / 2, keep.entrance.z);
  lintel.rotation.y = entAngle;
  root.add(lintel);
}

/** Gatehouse over the real gate gap: masonry shoulders and arch stones, two
 * opened timber doors, a raised portcullis and readable torch flames. */
function buildGatehouse(
  root: THREE.Group,
  gateWall: CastleLayout['walls'][number],
  gate: CastleLayout['gate'],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const dx = gateWall.x2 - gateWall.x1;
  const dz = gateWall.z2 - gateWall.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const angle = Math.atan2(dx, dz);
  const gateHalf = gate.w / 2;
  const pillarSize = CASTLE.wallT * 1.3;

  for (const side of [-1, 1] as const) {
    const px = gate.x + ux * gateHalf * side;
    const pz = gate.z + uz * gateHalf * side;
    const pillar = box(pillarSize, CASTLE.gateH, pillarSize, colors.stoneDark);
    pillar.position.set(px, baseY + CASTLE.gateH / 2, pz);
    pillar.rotation.y = angle;
    root.add(pillar);

    for (let i = 0; i < 4; i++) {
      const quoin = box(pillarSize * 1.12, 0.78, pillarSize * 1.12, i % 2 === 0 ? colors.stoneLight : colors.stone);
      quoin.position.set(px, baseY + 0.9 + i * 1.65, pz);
      quoin.rotation.y = angle;
      root.add(quoin);
    }
  }

  const lintelH = Math.max(0.4, CASTLE.wallH - CASTLE.gateH);
  const lintel = box(CASTLE.wallT, lintelH, gate.w + pillarSize, colors.stone);
  lintel.position.set(gate.x, baseY + CASTLE.gateH + lintelH / 2, gate.z);
  lintel.rotation.y = angle;
  root.add(lintel);

  const portal = new THREE.Group();
  portal.position.set(gate.x, baseY, gate.z);
  portal.rotation.y = angle;

  // A shallow semicircle of chunky voussoirs leaves the physical gate gap
  // unchanged while making the opening read as an arch from either side.
  const archR = gate.w * 0.36;
  const springY = CASTLE.gateH - archR + 0.18;
  const archBlocks = 9;
  for (let i = 0; i < archBlocks; i++) {
    const theta = (i / (archBlocks - 1)) * Math.PI;
    const voussoir = box(CASTLE.wallT * 1.34, 0.84, 1.15, i % 2 === 0 ? colors.stoneLight : colors.stoneDark);
    voussoir.position.set(0, springY + Math.sin(theta) * archR, Math.cos(theta) * archR);
    voussoir.rotation.x = theta - Math.PI / 2;
    portal.add(voussoir);
  }

  // The two leaves are visibly open against the returns: presence without a
  // fake visual barrier across a collision opening the player can traverse.
  const doorH = springY + 0.18;
  const doorW = gate.w * 0.41;
  for (const side of [-1, 1] as const) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, side * gateHalf);
    hinge.rotation.y = side * 0.98;
    const door = box(0.2, doorH, doorW, colors.wood);
    door.position.set(0, doorH / 2, -side * doorW / 2);
    hinge.add(door);
    for (const y of [doorH * 0.27, doorH * 0.72]) {
      const strap = box(0.25, 0.13, doorW * 0.9, colors.stoneDark);
      strap.position.set(0.12, y, -side * doorW / 2);
      hinge.add(strap);
    }
    portal.add(hinge);
  }

  // Raised bars and dangling teeth make the portcullis readable but retain
  // more than five metres of clear traversal space beneath it.
  const portcullisH = 1.35;
  for (let i = 0; i < 7; i++) {
    const z = THREE.MathUtils.lerp(-gateHalf * 0.76, gateHalf * 0.76, i / 6);
    const bar = cylinder(0.07, 0.08, portcullisH, colors.stoneDark);
    bar.position.set(-0.18, CASTLE.gateH - portcullisH / 2, z);
    portal.add(bar);
    const tooth = cone(0.12, 0.34, colors.stoneDark);
    tooth.rotation.x = Math.PI;
    tooth.position.set(-0.18, CASTLE.gateH - portcullisH - 0.17, z);
    portal.add(tooth);
  }
  const portcullisRail = box(0.16, 0.16, gate.w * 0.82, colors.stoneDark);
  portcullisRail.position.set(-0.18, CASTLE.gateH - 0.35, 0);
  portal.add(portcullisRail);

  // Existing hall-flame emissive signature is deliberately reused, so the
  // gate adds no new castle material bucket/draw call.
  for (const side of [-1, 1] as const) {
    const z = side * (gateHalf + pillarSize * 0.72);
    const bracket = box(0.58, 0.16, 0.16, colors.stoneDark);
    bracket.position.set(CASTLE.wallT * 0.66, CASTLE.gateH * 0.57, z);
    portal.add(bracket);
    const flame = cone(0.22, 0.58, WARD_COLORS.torchFlame, {
      emissive: WARD_COLORS.torchFlame,
      emissiveIntensity: 1.6,
    });
    flame.position.set(CASTLE.wallT * 0.84, CASTLE.gateH * 0.57 + 0.42, z);
    portal.add(flame);
  }

  // A bright purified keystone is a tiny readable state-change cue; cursed
  // keeps the same silhouette in the darker shadow stone.
  const keystone = box(CASTLE.wallT * 1.42, 1.08, 1.0, purified ? colors.stoneLight : colors.stoneDark);
  keystone.position.set(0, springY + archR + 0.02, 0);
  portal.add(keystone);
  root.add(portal);
}

/** Warm point lights at the gate + keep (purified only), ≤6 total (village-lamp style). */
function addPurifiedLights(root: THREE.Group, layout: CastleLayout, baseY: number): void {
  const colors = CASTLE_COLORS.purified;
  const gateWall = findGateWall(layout);
  const dx = gateWall.x2 - gateWall.x1;
  const dz = gateWall.z2 - gateWall.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const gateHalf = layout.gate.w / 2;

  for (const side of [-1, 1] as const) {
    const light = new THREE.PointLight(colors.lamp, 8, 18, 1.8);
    light.position.set(
      layout.gate.x + ux * gateHalf * side * 0.85,
      baseY + CASTLE.gateH + 0.6,
      layout.gate.z + uz * gateHalf * side * 0.85,
    );
    root.add(light);
  }

  const keep = layout.keep;
  for (const [sx, sz] of [
    [1, 1],
    [-1, -1],
  ] as const) {
    const light = new THREE.PointLight(colors.lamp, 8, 22, 1.8);
    light.position.set(keep.x + sx * keep.half * 0.9, baseY + keep.h * 0.65, keep.z + sz * keep.half * 0.9);
    root.add(light);
  }
}

// --- static-geometry merge (mirrors village/buildings.ts `mergeVillage`,
// copied locally since that helper is private to the village module) -------

/** World-baked, vertex-coloured copy of a mesh's geometry (see mergeVillage doc). */
function bakeMeshGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  const count = g.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  const c = (mesh.material as THREE.MeshLambertMaterial).color;
  for (let i = 0; i < count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

/**
 * Collapse a fully-built castle group into a handful of merged meshes: one
 * vertex-coloured static mesh, plus one small merged mesh per distinct
 * emissive signature (ember slits keep their glow). Point lights are
 * re-parented at their world positions. The originals are disposed.
 */
function mergeCastle(built: THREE.Group): THREE.Group {
  built.updateMatrixWorld(true);

  interface Bucket {
    geos: THREE.BufferGeometry[];
    emissive: THREE.Color | null;
    emissiveIntensity: number;
  }
  const buckets = new Map<string, Bucket>();
  const lights: { light: THREE.PointLight; pos: THREE.Vector3 }[] = [];

  built.traverse((o) => {
    if (o instanceof THREE.PointLight) {
      lights.push({ light: o, pos: o.getWorldPosition(new THREE.Vector3()) });
      return;
    }
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshLambertMaterial;
    const glowing = m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0;
    const key = glowing ? `e:${m.emissive.getHex()}:${m.emissiveIntensity}` : 'static';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        geos: [],
        emissive: glowing ? m.emissive.clone() : null,
        emissiveIntensity: glowing ? m.emissiveIntensity : 0,
      };
      buckets.set(key, bucket);
    }
    bucket.geos.push(bakeMeshGeometry(o));
    o.geometry.dispose();
    m.dispose();
  });

  const root = new THREE.Group();
  root.name = 'castle';
  for (const [key, bucket] of buckets) {
    const merged = mergeGeometries(bucket.geos);
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue; // defensive: mergeGeometries returns null on mismatch
    merged.computeBoundingSphere();
    const material = makeSurfaceMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: ROUGHNESS.castle,
      ...(bucket.emissive
        ? { emissive: bucket.emissive.getHex(), emissiveIntensity: bucket.emissiveIntensity }
        : {}),
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `castle-merged ${key}`;
    root.add(mesh);
  }
  for (const { light, pos } of lights) {
    light.removeFromParent();
    light.position.copy(pos);
    root.add(light);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Castle Ward (Castle Ward Task 4): maze walls, plaza dressing (banner
// poles), and two torchlit roofed halls, both dressings. Consumes
// `wardLayout()` (Task 1) plus `nonRingRuns`/`extendedWallSpan` (the Task 3
// collision-mesh binding, `ward.ts`) so every meshed wall run sits on
// EXACTLY the same span its collider does — diverging here would reopen the
// walk-through-wall / invisible-wall bugs Task 3 closed.
//
// Hall walls are ordinary `#` wall runs (Task 1's hand map draws each hall's
// perimeter as plain wall cells with 2 doorway gaps) and are meshed at the
// SAME `WARD.wallH` as the rest of the maze, so ward collision stays one
// uniform band (`padHeight + wallH`) everywhere. The spec's "walls to
// hallH" is realised visually instead by a shallow pyramid ROOF sitting on
// top of the wallH walls (apex at `hallH + hallRoofRise` above the wall
// top) rather than literally raising the hall's own walls — a taller wall
// would raise its collider too, opening a glide-height band a player would
// visually clip through with no matching collider. The roofline still reads
// taller (~7–8.6 m) than the maze around it.
// ---------------------------------------------------------------------------

/** Crenellations only on runs at least this many cells long (triangle-count guard). */
const WARD_TOOTH_MIN_CELLS = 4;
/** Roof overhang (m) beyond the hall walls' outer face. */
const HALL_ROOF_OVERHANG = 0.6;

/**
 * One maze/hall wall run: a straight box over the run's EXTENDED span
 * (`extendedWallSpan` — matches the collision circles exactly), or — for an
 * isolated single-cell pillar (a lone `#` with no wall neighbor) — a small
 * square post matching its single collision circle's diameter, NOT a full
 * 5 m block.
 */
function buildWardWallRun(root: THREE.Group, run: WallRun, colors: Colors, baseY: number): void {
  const span = extendedWallSpan(run);

  if (span.isPillar) {
    const courseH = WARD.wallH / 3;
    for (let i = 0; i < 3; i++) {
      const post = box(
        WARD.wallT * 2,
        courseH + 0.02,
        WARD.wallT * 2,
        i % 2 === 0 ? colors.stone : colors.stoneLight,
      );
      post.position.set(span.x1, baseY + courseH * (i + 0.5), span.z1);
      root.add(post);
    }
    const cap = box(WARD.wallT * 2.25, 0.24, WARD.wallT * 2.25, colors.stoneDark);
    cap.position.set(span.x1, baseY + WARD.wallH - 0.12, span.z1);
    root.add(cap);
    return;
  }

  const dx = span.x2 - span.x1;
  const dz = span.z2 - span.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const angle = Math.atan2(dx, dz);
  addStoneRun(root, span.x1, span.z1, span.x2, span.z2, WARD.wallT, WARD.wallH, baseY, colors, {
    courses: 3,
  });

  // A run's RAW (unextended) length is (cellCount - 1) * cellSize, since its
  // x1/z1..x2/z2 endpoints are the first/last member CELL CENTERS.
  const rawLen = Math.hypot(run.x2 - run.x1, run.z2 - run.z1);
  const cellCount = Math.round(rawLen / WARD.cellSize) + 1;
  if (cellCount >= WARD_TOOTH_MIN_CELLS) {
    addCrenellations(root, span.x1, span.z1, angle, ux, uz, 0, len, baseY + WARD.wallH, WARD.wallT, colors.stoneDark);
  }
}

/** Every non-ring ward wall run — maze corridors AND hall perimeters alike
 *  (the outer ring is the curtain wall's own job; see `nonRingRuns`). */
function buildWardWalls(root: THREE.Group, colors: Colors, baseY: number): void {
  for (const run of nonRingRuns()) buildWardWallRun(root, run, colors, baseY);
}

/** Cell-bound rectangle of a region's cells (world coords, extended to each cell's outer edge). */
function cellBounds(cells: { x: number; z: number }[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const half = WARD.cellSize / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x - half);
    maxX = Math.max(maxX, c.x + half);
    minZ = Math.min(minZ, c.z - half);
    maxZ = Math.max(maxZ, c.z + half);
  }
  return { minX, maxX, minZ, maxZ };
}

/** 4 banner poles at a plaza's cell-bound corners; purified adds up to 2 lamps. */
function buildPlaza(
  root: THREE.Group,
  plaza: WardLayout['plazas'][number],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const b = cellBounds(plaza.cells);
  const corners: [number, number][] = [
    [b.minX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
  ];
  const poleH = 3.4;
  const bannerH = 1.4;

  for (const [x, z] of corners) {
    const pole = cylinder(0.12, 0.16, poleH, colors.stoneDark);
    pole.position.set(x, baseY + poleH / 2, z);
    root.add(pole);

    // Banner faces toward the plaza's center so it reads while walking in.
    const angle = Math.atan2(plaza.center.x - x, plaza.center.z - z);
    const banner = clothPennant(0.95, bannerH, colors.banner, !purified);
    banner.position.set(x, baseY + poleH - bannerH / 2 - 0.15, z);
    banner.rotation.y = angle;
    root.add(banner);
  }

  if (purified) {
    // <= 2 warm lamps per plaza (village-lamp style, matching addPurifiedLights).
    const lampColor = CASTLE_COLORS.purified.lamp;
    for (const [x, z] of [corners[0]!, corners[3]!]) {
      const light = new THREE.PointLight(lampColor, 8, 16, 1.8);
      light.position.set(x, baseY + poleH + 0.3, z);
      root.add(light);
    }
  }
}

/** Two opposite-wall torch positions inset into a hall's interior rectangle,
 *  picked along whichever axis is longer so they sit on genuinely opposite walls. */
function hallTorchPositions(b: { minX: number; maxX: number; minZ: number; maxZ: number }): [number, number][] {
  const inset = 0.5;
  const dx = b.maxX - b.minX;
  const dz = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return dx >= dz
    ? [
        [b.minX + inset, cz],
        [b.maxX - inset, cz],
      ]
    : [
        [cx, b.minZ + inset],
        [cx, b.maxZ - inset],
      ];
}

/**
 * Shallow pyramid roof over a hall's footprint + overhang, apex
 * `WARD.hallRoofRise` above the wall top. Each of the 4 side faces is built
 * in BOTH winding orders so the roof renders correctly seen from outside
 * (above) and inside (below) without needing the merged static material
 * itself to be double-sided (`mergeCastle` buckets everything non-emissive
 * into one shared material).
 */
function buildHallRoof(
  root: THREE.Group,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  colors: Colors,
  baseY: number,
): void {
  const wallOuterOffset = WARD.cellSize / 2 + WARD.wallT / 2;
  const pad = wallOuterOffset + HALL_ROOF_OVERHANG;
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minZ = b.minZ - pad;
  const maxZ = b.maxZ + pad;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const baseYWorld = baseY + WARD.wallH;
  const apexY = WARD.hallRoofRise;

  const corners: [number, number][] = [
    [minX - cx, minZ - cz],
    [maxX - cx, minZ - cz],
    [maxX - cx, maxZ - cz],
    [minX - cx, maxZ - cz],
  ];

  const positions: number[] = [];
  const uvs: number[] = [];
  const pushSideFace = (p: [number, number], q: [number, number]) => {
    // Both winding orders of the same base-edge -> apex triangle.
    positions.push(p[0], 0, p[1], q[0], 0, q[1], 0, apexY, 0);
    positions.push(0, apexY, 0, q[0], 0, q[1], p[0], 0, p[1]);
    for (let i = 0; i < 6; i++) uvs.push(0, 0);
  };
  for (let i = 0; i < 4; i++) pushSideFace(corners[i]!, corners[(i + 1) % 4]!);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat(colors.roof));
  mesh.position.set(cx, baseYWorld, cz);
  root.add(mesh);

  const eaveX = box(maxX - minX + 0.18, 0.2, 0.28, colors.stoneDark);
  eaveX.position.set(cx, baseYWorld + 0.02, minZ);
  root.add(eaveX);
  const eaveX2 = eaveX.clone();
  eaveX2.material = mat(colors.stoneDark);
  eaveX2.position.z = maxZ;
  root.add(eaveX2);
  const eaveZ = box(0.28, 0.2, maxZ - minZ + 0.18, colors.stoneDark);
  eaveZ.position.set(minX, baseYWorld + 0.02, cz);
  root.add(eaveZ);
  const eaveZ2 = eaveZ.clone();
  eaveZ2.material = mat(colors.stoneDark);
  eaveZ2.position.x = maxX;
  root.add(eaveZ2);
}

/**
 * 2 torch sconces (bracket + emissive flame) inside a hall on opposite
 * walls, plus exactly 1 warm PointLight (0xffd9a0) for the whole hall
 * interior — same fixed torchlight color in both dressings.
 */
function buildHallTorches(
  root: THREE.Group,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  colors: Colors,
  baseY: number,
): void {
  const wallY = baseY + WARD.wallH * 0.55;
  for (const [x, z] of hallTorchPositions(b)) {
    const bracket = box(0.3, 0.35, 0.3, colors.stoneDark);
    bracket.position.set(x, wallY, z);
    root.add(bracket);

    const flame = cone(0.16, 0.42, WARD_COLORS.torchFlame, {
      emissive: WARD_COLORS.torchFlame,
      emissiveIntensity: 1.6,
    });
    flame.position.set(x, wallY + 0.35, z);
    root.add(flame);
  }

  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  // Intensity tuned up from the brief's illustrative "~1.2" (Visual
  // verification, screenshot inspection): this scene's ACES tone-mapping +
  // exposure pipeline needs roughly the same intensity scale as the existing
  // purified gate/keep lamps (8, see `addPurifiedLights`) for a point light to
  // read as visible at all — 1.2 rendered indistinguishable from unlit.
  const light = new THREE.PointLight(CASTLE_COLORS.purified.lamp, 7, 16, 1.8);
  light.position.set(cx, baseY + WARD.wallH * 0.7, cz);
  root.add(light);
}

/** Build the whole ward (maze walls, plazas, torchlit halls) into `root`. */
function buildWard(root: THREE.Group, purified: boolean): void {
  const colors: Colors = purified ? CASTLE_COLORS.purified : CASTLE_COLORS.cursed;
  const baseY = CASTLE.padHeight;
  const layout = wardLayout();

  buildWardWalls(root, colors, baseY);
  for (const plaza of layout.plazas) buildPlaza(root, plaza, colors, purified, baseY);
  for (const hall of layout.halls) {
    const b = cellBounds(hall.cells);
    buildHallRoof(root, b, colors, baseY);
    buildHallTorches(root, b, colors, baseY);
  }
}

// ---------------------------------------------------------------------------
// Gargoyle-hunting spires (daze-eject-spires design spec §2): 5 slender
// pinnacles from the `SPIRES` constant (constants.ts), built here so they
// fold into the same `mergeCastle` pass as everything else. Each is 3-4
// tapered stacked cones (the crag-spire silhouette from `src/world/props.ts`'s
// `buildMesa` — adapted freehand here, not imported: that helper returns a
// raw scatter-prop BufferGeometry, not a merge-ready Lambert Mesh in this
// file's convention) narrowing to a sharp tip cone, nudged by a per-spire
// seeded rng (lateral jitter + a slight overall lean) so the 5 don't read as
// identical stamped copies. Cursed dressing gets a glowing ember band near
// the top (the tower/keep ember-slit convention); purified gets a small
// banner flag instead (the tower banner convention).
// ---------------------------------------------------------------------------

/** Fraction of a spire's total height spent on its tapered body segments —
 *  the remainder is the sharp tip cone, so body + tip always sum to exactly
 *  `h` (the same height `spireObstacles`/`spireGrappleColliders` collide to). */
const SPIRE_BODY_FRACTION = 0.85;

/** One gargoyle-hunting spire: tapered stacked cones + a sharp tip + dressing. */
function buildSpire(
  root: THREE.Group,
  spire: { x: number; z: number; h: number },
  colors: Colors,
  purified: boolean,
  baseY: number,
  rng: () => number,
): void {
  const segCount = rng() < 0.5 ? 3 : 4;
  const bodyH = spire.h * SPIRE_BODY_FRACTION;
  const segH = bodyH / segCount;
  const tipH = spire.h - bodyH;
  // A slight overall lean, applied incrementally per segment (radians-ish
  // metres of drift per segment index) — subtle enough to read as a weathered
  // lean, not a toppled tower.
  const leanX = (rng() - 0.5) * 0.5;
  const leanZ = (rng() - 0.5) * 0.5;

  let y = baseY;
  let r: number = SPIRES.baseR;
  for (let i = 0; i < segCount; i++) {
    const nextR = r * (0.62 + rng() * 0.08); // ~35-45% taper per segment
    const jitterX = (rng() - 0.5) * 0.35;
    const jitterZ = (rng() - 0.5) * 0.35;
    const seg = cylinder(nextR, r, segH, i % 2 === 0 ? colors.stone : colors.stoneLight);
    seg.position.set(spire.x + leanX * i + jitterX, y + segH / 2, spire.z + leanZ * i + jitterZ);
    root.add(seg);
    if (i > 0) {
      const collar = cylinder(r * 1.08, r * 1.08, 0.18, colors.stoneDark);
      collar.position.set(spire.x + leanX * i, y, spire.z + leanZ * i);
      root.add(collar);
    }
    y += segH;
    r = nextR;
  }

  const tip = cone(Math.max(0.3, r * 0.9), tipH, colors.stoneDark);
  tip.position.set(spire.x + leanX * segCount, y + tipH / 2, spire.z + leanZ * segCount);
  root.add(tip);

  if (!purified) {
    const c = colors as typeof CASTLE_COLORS.cursed;
    const slit = box(0.35, 1.2, 0.35, colors.stoneDark, { emissive: c.ember, emissiveIntensity: 1.4 });
    slit.position.set(spire.x, baseY + spire.h * 0.72, spire.z);
    root.add(slit);
  } else {
    const bannerColor = (colors as typeof CASTLE_COLORS.purified).banner;
    const banner = clothPennant(1.05, 1.85, bannerColor, false);
    const outAng = rng() * Math.PI * 2;
    banner.position.set(
      spire.x + Math.sin(outAng) * (SPIRES.baseR * 0.4 + 0.2),
      baseY + spire.h * 0.78,
      spire.z + Math.cos(outAng) * (SPIRES.baseR * 0.4 + 0.2),
    );
    banner.rotation.y = outAng;
    root.add(banner);
  }
}

/** All 5 gargoyle-hunting spires (`SPIRES.list`), each with its own seeded rng
 *  (`WORLD_SEED` ^ a spire salt ^ index) so the jitter/lean is deterministic
 *  and stable across sessions. */
function buildSpires(root: THREE.Group, purified: boolean): void {
  const colors: Colors = purified ? CASTLE_COLORS.purified : CASTLE_COLORS.cursed;
  const baseY = CASTLE.padHeight;
  SPIRES.list.forEach((s, i) => {
    const rng = mulberry32((WORLD_SEED ^ 0x59125 ^ i) >>> 0);
    const spire = { x: CASTLE.center.x + s.dx, z: CASTLE.center.z + s.dz, h: s.h };
    buildSpire(root, spire, colors, purified, baseY, rng);
  });
}

/**
 * Build the entire castle (curtain wall, 4 towers, keep, gatehouse, ward
 * maze, gargoyle-hunting spires) as one group and add it to `scene`.
 * `purified` picks the dressing (colors + trim); geometry is otherwise
 * identical. Call `removeCastle` first if swapping an already-built dressing
 * for another.
 */
export function buildCastle(scene: THREE.Scene, purified: boolean): THREE.Group {
  const layout = castleLayout();
  const colors: Colors = purified ? CASTLE_COLORS.purified : CASTLE_COLORS.cursed;
  const baseY = CASTLE.padHeight;
  const gateWall = findGateWall(layout);

  const built = new THREE.Group();
  for (const w of layout.walls) buildWall(built, w, layout.gate, colors, purified, baseY);
  for (const t of layout.towers) buildTower(built, t, colors, purified, baseY);
  buildKeep(built, layout, colors, purified, baseY);
  buildGatehouse(built, gateWall, layout.gate, colors, purified, baseY);
  if (purified) addPurifiedLights(built, layout, baseY);
  buildWard(built, purified);
  buildSpires(built, purified);

  const merged = mergeCastle(built);
  refineArt(merged, purified ? 'castle_purified' : 'castle_cursed');
  scene.add(merged);
  return merged;
}

/** Dispose the castle group's geometries/materials and remove it from `scene`. */
export function removeCastle(scene: THREE.Scene): void {
  const g = scene.getObjectByName('castle');
  if (!g) return;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
    else m.dispose();
  });
  scene.remove(g);
}

// ---------------------------------------------------------------------------
// The dark crystal (Task 14): the keep-centre corruption core, owned and
// positioned directly by `CastleSystem` (NOT merged into the `buildCastle`
// group above) so it can keep pulsing every frame independent of the
// castle's static merged mesh. Built from two cones stacked apex-to-apex — a
// hand-built octahedron/bipyramid "gem" in this file's flat-shaded Lambert
// style — on a small stone plinth. The gem's shared base (the octahedron's
// widest equator) sits at the group's local origin, so positioning the group
// at `castleLayout().crystalPos` puts that origin exactly at the crystal's
// hit-test centre; the plinth hangs below it down to the floor.
// ---------------------------------------------------------------------------

export interface CrystalMesh {
  group: THREE.Group;
  /** The gem's shared material (both cones) — `CastleSystem` drives its
   *  `emissiveIntensity` every frame for the cursed/purified pulse. */
  material: THREE.MeshLambertMaterial;
}

/** Build the crystal (cursed or purified dressing) — NOT added to any scene. */
export function buildCrystal(purified: boolean): CrystalMesh {
  const group = new THREE.Group();
  group.name = 'castle-crystal';

  const plinthColor = purified ? CASTLE_COLORS.purified.stoneDark : CASTLE_COLORS.cursed.stoneDark;
  const plinth = cylinder(CRYSTAL.plinthR * 1.1, CRYSTAL.plinthR, CRYSTAL.plinthH, plinthColor);
  plinth.position.y = -CRYSTAL.plinthH / 2;
  group.add(plinth);

  const gemColor = purified ? CASTLE_COLORS.purified.roof : CASTLE_COLORS.cursed.crystal;
  const material = mat(gemColor, {
    emissive: gemColor,
    emissiveIntensity: purified ? CRYSTAL.purifiedPulseBase : CRYSTAL.cursedPulseBase,
  });

  const top = new THREE.Mesh(new THREE.ConeGeometry(CRYSTAL.gemR, CRYSTAL.gemH, 6), material);
  top.position.y = CRYSTAL.gemH / 2;
  group.add(top);

  const bottom = new THREE.Mesh(new THREE.ConeGeometry(CRYSTAL.gemR, CRYSTAL.gemH, 6), material);
  bottom.rotation.x = Math.PI; // flip so its apex points down — the bipyramid's other half
  bottom.position.y = -CRYSTAL.gemH / 2;
  group.add(bottom);

  refineArt(group, 'ward_crystal');
  return { group, material };
}

/** Dispose a crystal built by `buildCrystal` and remove it from `scene`. */
export function removeCrystal(scene: THREE.Scene, crystal: CrystalMesh): void {
  crystal.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  crystal.material.dispose();
  scene.remove(crystal.group);
}

// ---------------------------------------------------------------------------
// Night goblin model (Task 11). Deliberately NOT built from the critters
// module (`buildCritterModel`'s helpers like `plumpEar` are private to
// critters) — a small, self-contained builder here, in the same flat-shaded
// Lambert style as the rest of this file. Per-goblin Groups are cheap (≤8
// concurrently live) so no merge/bake pass is needed.
//
// Silhouette: a knee-high chunky egg-shaped body, two big flared ears, a
// tattered hood cone (a few ragged flap teeth around its rim), and a pair of
// small glowing yellow eyes low on the face. Faces +Z, feet at y=0.
// ---------------------------------------------------------------------------

const GOBLIN_COLORS = {
  skin: 0x6e9a48,
  skinDark: 0x426832,
  belly: 0x8caf5d,
  hood: 0x513653,
  hoodDark: 0x35263f,
  eye: 0xffdf62,
  iris: 0x6c1744,
  mouth: 0x35232e,
  tooth: 0xffedc7,
} as const;

function softMat(color: number, opts: MatOpts = {}): THREE.Material {
  return makeSurfaceMaterial({
    color,
    flatShading: false,
    roughness: ROUGHNESS.critter,
    ...(opts.emissive !== undefined
      ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 }
      : {}),
  });
}

function sphere(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), softMat(color, opts));
}

function blob(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), softMat(color, opts));
}

function capsule(r: number, length: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, length, 3, 8), softMat(color));
}

function softCone(r: number, h: number, color: number, segments = 9): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, segments), softMat(color));
}

/** Bottom-heavy pear silhouette matching the round-3 critter language. */
function egg(r: number, h: number, color: number, bulge = 0.34): THREE.Mesh {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = Math.sin(Math.PI * Math.pow(t, 1 - bulge)) * r;
    points.push(new THREE.Vector2(Math.max(0.001, x), t * h));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(points, 14), softMat(color));
}

function smileArc(r: number, tube: number, color: number, arc = 1.75): THREE.Mesh {
  const smile = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 5, 10, arc), softMat(color));
  smile.rotation.z = -Math.PI / 2 - arc / 2;
  return smile;
}

interface CharacterEyeOpts {
  sclera: number;
  iris: number;
  glow?: number;
  glowIntensity?: number;
}

/** Glossy plush eye: sclera dome, oversized iris and a white catchlight. */
function characterEye(r: number, side: -1 | 1, opts: CharacterEyeOpts): THREE.Group {
  const g = new THREE.Group();
  const sclera = sphere(
    r,
    opts.sclera,
    opts.glow !== undefined ? { emissive: opts.glow, emissiveIntensity: opts.glowIntensity ?? 1.2 } : {},
  );
  sclera.scale.set(1, 1.08, 0.66);
  g.add(sclera);
  const iris = sphere(r * 0.68, opts.iris);
  iris.scale.z = 0.38;
  iris.position.z = r * 0.53;
  g.add(iris);
  const highlight = blob(r * 0.24, 0xffffff);
  highlight.position.set(side * r * 0.24, r * 0.28, r * 0.61);
  g.add(highlight);
  return g;
}

function addEyePair(
  root: THREE.Group,
  sep: number,
  y: number,
  z: number,
  r: number,
  opts: CharacterEyeOpts,
): void {
  for (const side of [-1, 1] as const) {
    const eye = characterEye(r, side, opts);
    eye.position.set(side * sep, y, z);
    eye.rotation.y = side * 0.08;
    root.add(eye);
  }
}

/** A soft base plus a short conical point: readable pointy ear without a
 * knife-like silhouette. Inner-ear applique sits proud on the +Z face. */
function characterEar(
  size: number,
  skin: number,
  inner: number,
  side: -1 | 1,
  goblin: boolean,
): THREE.Group {
  const g = new THREE.Group();
  const base = sphere(size, skin);
  base.scale.set(goblin ? 1.25 : 1.02, goblin ? 0.78 : 0.72, 0.42);
  base.position.x = side * size * 0.25;
  g.add(base);
  const point = softCone(size * (goblin ? 0.82 : 0.72), size * (goblin ? 2.25 : 1.8), skin, 8);
  point.rotation.z = side * -Math.PI / 2;
  point.position.x = side * size * (goblin ? 1.27 : 1.05);
  g.add(point);
  const inset = sphere(size * 0.66, inner);
  inset.scale.set(goblin ? 1.25 : 1.0, 0.58, 0.2);
  inset.position.set(side * size * 0.3, 0, size * 0.42);
  g.add(inset);
  return g;
}

/** Hue/lightness jitter copied in spirit from the critter builders. */
function jitterColor(hex: number, rng: () => number, hue = 0.045, lightness = 0.05): number {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(
    (hsl.h + (rng() - 0.5) * hue + 1) % 1,
    hsl.s,
    THREE.MathUtils.clamp(hsl.l + (rng() - 0.5) * lightness, 0.05, 0.95),
  );
  return color.getHex();
}

/** Merge a richer character puppet back down to one static draw plus one
 * optional glow draw. Geometry remains in the caller's inner scale group. */
function mergeCharacter(built: THREE.Group): THREE.Group {
  built.updateMatrixWorld(true);
  interface Bucket {
    geometries: THREE.BufferGeometry[];
    emissive: THREE.Color | null;
    emissiveIntensity: number;
  }
  const buckets = new Map<string, Bucket>();
  built.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
    const glowing = material.emissive && material.emissiveIntensity > 0 && material.emissive.getHex() !== 0;
    const key = glowing ? `glow:${material.emissive.getHex()}:${material.emissiveIntensity}` : 'static';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        geometries: [],
        emissive: glowing ? material.emissive.clone() : null,
        emissiveIntensity: glowing ? material.emissiveIntensity : 0,
      };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(bakeMeshGeometry(o));
    o.geometry.dispose();
    material.dispose();
  });

  const mergedRoot = new THREE.Group();
  for (const [key, bucket] of buckets) {
    const geometry = mergeGeometries(bucket.geometries);
    for (const source of bucket.geometries) source.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const material = makeSurfaceMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: ROUGHNESS.critter,
      ...(bucket.emissive
        ? { emissive: bucket.emissive.getHex(), emissiveIntensity: bucket.emissiveIntensity }
        : {}),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `character-merged ${key}`;
    mergedRoot.add(mesh);
  }
  return mergedRoot;
}

/**
 * Build one goblin model from a seeded per-individual `rng` (scale + slight
 * colour jitter so a pack of 8 never looks cloned). ~knee-high (~0.55-0.65 m).
 *
 * The per-individual size jitter lives on an INNER group (`root.children[0]`),
 * not on the returned root itself — `CastleSystem.syncMesh` drives per-frame
 * squash-stretch/bob via the root's own `.scale`/`.position`, which would
 * otherwise clobber this jitter every frame if they shared one transform.
 */
export function buildGoblin(rng: () => number): THREE.Group {
  // Fixed-count upfront rolls keep model variation deterministic even when a
  // cosmetic branch (hood / loincloth / tooth side) changes.
  const scale = 0.9 + rng() * 0.2;
  const skin = jitterColor(GOBLIN_COLORS.skin, rng, 0.06, 0.06);
  const skinDark = jitterColor(GOBLIN_COLORS.skinDark, rng, 0.05, 0.04);
  const belly = jitterColor(GOBLIN_COLORS.belly, rng, 0.04, 0.05);
  const hoodColor = jitterColor(GOBLIN_COLORS.hood, rng, 0.05, 0.04);
  const hoodRoll = rng();
  const loinRoll = rng();
  const toothSide = rng() < 0.5 ? -1 : 1;
  const hoodLean = (rng() - 0.5) * 0.34;

  const puppet = new THREE.Group();

  // Stubby legs and broad plush feet ground the silhouette before the pear
  // body is layered over them.
  for (const side of [-1, 1] as const) {
    const leg = capsule(0.075, 0.055, skinDark);
    leg.position.set(side * 0.15, 0.15, -0.015);
    puppet.add(leg);
    const foot = sphere(0.085, skinDark);
    foot.scale.set(1.02, 0.62, 1.28);
    foot.position.set(side * 0.15, 0.06, 0.075);
    puppet.add(foot);
  }

  const body = egg(0.32, 0.53, skin, 0.4);
  body.position.set(0, 0.105, -0.045);
  puppet.add(body);
  const bellyPatch = sphere(0.245, belly);
  bellyPatch.scale.set(0.88, 0.96, 0.34);
  bellyPatch.position.set(0, 0.37, 0.235);
  puppet.add(bellyPatch);

  // Hunched shoulders and little forward-reaching mitts add minion energy.
  for (const side of [-1, 1] as const) {
    const arm = capsule(0.06, 0.12, skinDark);
    arm.position.set(side * 0.31, 0.38, 0.035);
    arm.rotation.z = side * 0.55;
    arm.rotation.x = -0.28;
    puppet.add(arm);
    const hand = sphere(0.072, skin);
    hand.position.set(side * 0.36, 0.28, 0.11);
    puppet.add(hand);
  }

  const head = sphere(0.275, skin);
  head.scale.set(1.05, 0.94, 0.96);
  head.position.set(0, 0.64, 0.105);
  puppet.add(head);
  const faceMask = sphere(0.235, belly);
  faceMask.scale.set(1.02, 0.8, 0.38);
  faceMask.position.set(0, 0.615, 0.305);
  puppet.add(faceMask);

  for (const side of [-1, 1] as const) {
    const ear = characterEar(0.16, skin, skinDark, side, true);
    ear.position.set(side * 0.245, 0.69, 0.085);
    ear.rotation.z = side * 0.16;
    puppet.add(ear);
  }

  addEyePair(puppet, 0.11, 0.69, 0.405, 0.105, {
    sclera: GOBLIN_COLORS.eye,
    iris: GOBLIN_COLORS.iris,
    glow: GOBLIN_COLORS.eye,
    glowIntensity: 1.22,
  });
  const nose = blob(0.047, skinDark);
  nose.scale.set(1.08, 0.76, 0.7);
  nose.position.set(0, 0.59, 0.525);
  puppet.add(nose);

  // A round underbite keeps the fang funny rather than frightening.
  const jaw = sphere(0.15, skinDark);
  jaw.scale.set(1.08, 0.46, 0.63);
  jaw.position.set(0, 0.51, 0.405);
  puppet.add(jaw);
  const mouth = smileArc(0.075, 0.014, GOBLIN_COLORS.mouth, 1.55);
  mouth.position.set(0, 0.5, 0.51);
  puppet.add(mouth);
  const tooth = softCone(0.035, 0.105, GOBLIN_COLORS.tooth, 7);
  tooth.position.set(toothSide * 0.073, 0.555, 0.525);
  tooth.rotation.z = toothSide * 0.08;
  puppet.add(tooth);

  if (loinRoll < 0.68) {
    const loincloth = clothPennant(0.34, 0.27, hoodColor, true);
    loincloth.position.set(0, 0.265, 0.323);
    puppet.add(loincloth);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.035, 5, 12), softMat(GOBLIN_COLORS.hoodDark));
    belt.rotation.x = Math.PI / 2;
    belt.scale.z = 0.86;
    belt.position.set(0, 0.335, -0.01);
    puppet.add(belt);
  }

  if (hoodRoll < 0.62) {
    const cowl = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.058, 6, 14), softMat(GOBLIN_COLORS.hoodDark));
    cowl.rotation.x = Math.PI / 2;
    cowl.scale.z = 0.9;
    cowl.position.set(0, 0.765, 0.055);
    puppet.add(cowl);
    const hood = softCone(0.275, 0.34, hoodColor, 10);
    hood.position.set(0, 0.91, 0.045);
    hood.rotation.z = hoodLean;
    puppet.add(hood);
    for (const x of [-0.14, 0, 0.14]) {
      const tatter = clothPennant(0.12, 0.17, GOBLIN_COLORS.hoodDark, true);
      tatter.position.set(x, 0.75 - Math.abs(x) * 0.18, 0.285);
      puppet.add(tatter);
    }
  }

  const inner = new THREE.Group();
  inner.add(mergeCharacter(puppet));
  inner.scale.setScalar(scale);
  const root = new THREE.Group();
  root.add(inner);
  refineArt(root, 'goblin');
  return root;
}

// ---------------------------------------------------------------------------
// Elf model (Task 12). Persistent, happy castle residents — the opposite
// silhouette of the goblin: a plump green-tunic body, cream face, a jaunty
// pointy hat, small pointy ears, dark friendly eyes and a permanent curved
// grin (a thin torus arc). ~0.9 m tall at scale 1. Faces +Z, feet at y=0.
// Per-elf Groups are cheap (a handful concurrently live) so no merge pass.
// ---------------------------------------------------------------------------

const ELF_COLORS = {
  tunic: 0x3fae73,
  tunicLight: 0x8bd89a,
  tunicDark: 0x247555,
  skin: 0xf4d4a9,
  ear: 0xeebc9b,
  iris: 0x704331,
  grin: 0x8d4050,
  blush: 0xee93a0,
  shoe: 0x6a4130,
  leaf: 0x68a94b,
  leafDark: 0x397b42,
  acorn: 0x9a663b,
  acornDark: 0x65432e,
  hair: 0xe7a846,
} as const;

/**
 * Build one elf model from a seeded per-individual `rng` (scale + slight
 * tunic colour jitter, same convention as `buildGoblin`). ~0.9 m tall.
 *
 * Per-individual size jitter lives on an inner group (`root.children[0]`),
 * matching `buildGoblin`'s convention so a future per-frame bob/squash on the
 * root's own transform never clobbers it.
 */
export function buildElf(rng: () => number): THREE.Group {
  const scale = 0.92 + rng() * 0.16;
  const tunic = jitterColor(ELF_COLORS.tunic, rng, 0.05, 0.05);
  const tunicLight = jitterColor(ELF_COLORS.tunicLight, rng, 0.04, 0.04);
  const skin = jitterColor(ELF_COLORS.skin, rng, 0.025, 0.035);
  const capRoll = rng();
  const iris = rng() < 0.45 ? ELF_COLORS.iris : ELF_COLORS.leafDark;
  const capLean = (rng() - 0.5) * 0.3;

  const puppet = new THREE.Group();
  for (const side of [-1, 1] as const) {
    const foot = sphere(0.078, ELF_COLORS.shoe);
    foot.scale.set(1.08, 0.62, 1.32);
    foot.position.set(side * 0.105, 0.055, 0.07);
    puppet.add(foot);
  }

  const body = egg(0.245, 0.45, tunic, 0.38);
  body.position.set(0, 0.095, -0.025);
  puppet.add(body);
  const bib = sphere(0.19, tunicLight);
  bib.scale.set(0.86, 1.02, 0.34);
  bib.position.set(0, 0.34, 0.19);
  puppet.add(bib);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.035, 5, 13), softMat(ELF_COLORS.tunicDark));
  hem.rotation.x = Math.PI / 2;
  hem.scale.z = 0.88;
  hem.position.set(0, 0.18, -0.005);
  puppet.add(hem);

  for (const side of [-1, 1] as const) {
    const arm = capsule(0.045, 0.12, tunic);
    arm.position.set(side * 0.235, 0.35, 0.035);
    arm.rotation.z = side * 0.63;
    puppet.add(arm);
    const hand = sphere(0.052, skin);
    hand.position.set(side * 0.275, 0.25, 0.085);
    puppet.add(hand);
  }

  const head = sphere(0.205, skin);
  head.scale.set(1.02, 0.98, 0.96);
  head.position.set(0, 0.625, 0.055);
  puppet.add(head);
  for (const side of [-1, 1] as const) {
    const ear = characterEar(0.105, skin, ELF_COLORS.ear, side, false);
    ear.position.set(side * 0.18, 0.63, 0.055);
    ear.rotation.z = side * 0.08;
    puppet.add(ear);
  }
  addEyePair(puppet, 0.082, 0.655, 0.25, 0.073, {
    sclera: 0xfff5df,
    iris,
  });
  const nose = blob(0.027, ELF_COLORS.ear);
  nose.position.set(0, 0.59, 0.282);
  puppet.add(nose);
  const grin = smileArc(0.057, 0.011, ELF_COLORS.grin, 1.7);
  grin.position.set(0, 0.545, 0.267);
  puppet.add(grin);
  for (const side of [-1, 1] as const) {
    const cheek = sphere(0.042, ELF_COLORS.blush);
    cheek.scale.set(1, 0.62, 0.24);
    cheek.position.set(side * 0.145, 0.57, 0.245);
    puppet.add(cheek);
  }

  if (capRoll < 0.38) {
    // Leaf cap: a soft green skull-cap with two jaunty leaves.
    const cap = sphere(0.205, ELF_COLORS.leafDark);
    cap.scale.set(1.04, 0.38, 1.0);
    cap.position.set(0, 0.79, 0.025);
    puppet.add(cap);
    for (const side of [-1, 1] as const) {
      const leaf = sphere(0.09, side < 0 ? ELF_COLORS.leaf : tunicLight);
      leaf.scale.set(0.55, 1.42, 0.3);
      leaf.position.set(side * 0.07, 0.9, 0.03);
      leaf.rotation.z = side * (0.55 + capLean);
      puppet.add(leaf);
    }
  } else if (capRoll < 0.72) {
    // Acorn cap: warm woodland brown, squashed broad with a tiny stem.
    const cap = sphere(0.215, ELF_COLORS.acorn);
    cap.scale.set(1.06, 0.38, 1.02);
    cap.position.set(0, 0.795, 0.018);
    puppet.add(cap);
    const capBand = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.03, 5, 12), softMat(ELF_COLORS.acornDark));
    capBand.rotation.x = Math.PI / 2;
    capBand.position.set(0, 0.755, 0.015);
    puppet.add(capBand);
    const stem = capsule(0.025, 0.075, ELF_COLORS.acornDark);
    stem.position.set(capLean * 0.08, 0.9, 0);
    stem.rotation.z = capLean;
    puppet.add(stem);
  } else {
    // Three soft golden spikes read as a toy-like hair tuft, not a helmet.
    for (const [x, lean] of [
      [-0.075, -0.45],
      [0, capLean],
      [0.075, 0.45],
    ] as const) {
      const tuft = softCone(0.065, 0.19, ELF_COLORS.hair, 8);
      tuft.position.set(x, 0.86 + (x === 0 ? 0.03 : 0), 0.015);
      tuft.rotation.z = lean;
      puppet.add(tuft);
    }
  }

  const inner = new THREE.Group();
  inner.add(mergeCharacter(puppet));
  inner.scale.setScalar(scale);
  const root = new THREE.Group();
  root.add(inner);
  refineArt(root, 'elf');
  return root;
}
