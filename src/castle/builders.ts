import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CASTLE, CASTLE_COLORS, CRYSTAL } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';
import { castleLayout, type CastleLayout } from './layout.ts';

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

function cone(r: number, h: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), mat(color));
  return mesh;
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

/** Small crenellation teeth spaced ~3 m apart along a straight run. */
const TOOTH_SPACING = 3;
const TOOTH_W = 1.5;
const TOOTH_H = 0.9;

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
  for (let s = TOOTH_SPACING / 2; s < segLen; s += TOOTH_SPACING) {
    const arc = a + s;
    const tx = x1 + ux * arc;
    const tz = z1 + uz * arc;
    const tooth = box(thickness * 1.05, TOOTH_H, Math.min(TOOTH_W, segLen), color);
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
    const midS = (a + b) / 2;
    const cx = w.x1 + ux * midS;
    const cz = w.z1 + uz * midS;

    const run = box(w.t, w.h, segLen, colors.stone);
    run.position.set(cx, baseY + w.h / 2, cz);
    run.rotation.y = angle;
    root.add(run);

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

/** A corner tower: cylinder body + cone roof, ember slits or a banner. */
function buildTower(
  root: THREE.Group,
  t: CastleLayout['towers'][number],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const body = cylinder(t.r, t.r * 1.05, t.h, colors.stone);
  body.position.set(t.x, baseY + t.h / 2, t.z);
  root.add(body);

  const roofH = t.r * 1.7;
  const roofMesh = cone(t.r * 1.15, roofH, colors.roof);
  roofMesh.position.set(t.x, baseY + t.h + roofH / 2 - 0.1, t.z);
  root.add(roofMesh);

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
  } else {
    const outAng = Math.atan2(t.x - CASTLE.center.x, t.z - CASTLE.center.z);
    const bx = t.x + Math.sin(outAng) * (t.r + 0.05);
    const bz = t.z + Math.cos(outAng) * (t.r + 0.05);
    const banner = box(1.4, 2.6, 0.08, (colors as typeof CASTLE_COLORS.purified).banner);
    banner.position.set(bx, baseY + t.h * 0.58, bz);
    banner.rotation.y = outAng;
    root.add(banner);
  }
}

/** The keep: a larger crenellated box, open top (no roof — room for the crystal). */
function buildKeep(
  root: THREE.Group,
  keep: CastleLayout['keep'],
  colors: Colors,
  purified: boolean,
  baseY: number,
): void {
  const size = keep.half * 2;
  const body = box(size, keep.h, size, colors.stone);
  body.position.set(keep.x, baseY + keep.h / 2, keep.z);
  root.add(body);

  const half = keep.half;
  const sides: { x1: number; z1: number; x2: number; z2: number }[] = [
    { x1: keep.x - half, z1: keep.z - half, x2: keep.x + half, z2: keep.z - half }, // north
    { x1: keep.x + half, z1: keep.z - half, x2: keep.x + half, z2: keep.z + half }, // east
    { x1: keep.x + half, z1: keep.z + half, x2: keep.x - half, z2: keep.z + half }, // south
    { x1: keep.x - half, z1: keep.z + half, x2: keep.x - half, z2: keep.z - half }, // west
  ];
  const topY = baseY + keep.h;
  const thickness = CASTLE.wallT;
  for (const s of sides) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const angle = Math.atan2(dx, dz);
    addCrenellations(root, s.x1, s.z1, angle, ux, uz, 0, len, topY, thickness, colors.stoneDark);

    if (!purified) {
      const c = colors as typeof CASTLE_COLORS.cursed;
      const midx = (s.x1 + s.x2) / 2;
      const midz = (s.z1 + s.z2) / 2;
      const slit = box(0.5, 2.2, 0.5, colors.stoneDark, { emissive: c.ember, emissiveIntensity: 1.4 });
      slit.position.set(midx, baseY + keep.h * 0.5, midz);
      root.add(slit);
    }
  }
}

/** Gatehouse arch over the real gate gap: two pillars + a lintel bridging above. */
function buildGatehouse(
  root: THREE.Group,
  gateWall: CastleLayout['walls'][number],
  gate: CastleLayout['gate'],
  colors: Colors,
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
  }

  const lintelH = Math.max(0.4, CASTLE.wallH - CASTLE.gateH);
  const lintel = box(CASTLE.wallT, lintelH, gate.w + pillarSize, colors.stone);
  lintel.position.set(gate.x, baseY + CASTLE.gateH + lintelH / 2, gate.z);
  lintel.rotation.y = angle;
  root.add(lintel);
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

/**
 * Build the entire castle (curtain wall, 4 towers, keep, gatehouse) as one
 * group and add it to `scene`. `purified` picks the dressing (colors + trim);
 * geometry is otherwise identical. Call `removeCastle` first if swapping an
 * already-built dressing for another.
 */
export function buildCastle(scene: THREE.Scene, purified: boolean): THREE.Group {
  const layout = castleLayout();
  const colors: Colors = purified ? CASTLE_COLORS.purified : CASTLE_COLORS.cursed;
  const baseY = CASTLE.padHeight;
  const gateWall = findGateWall(layout);

  const built = new THREE.Group();
  for (const w of layout.walls) buildWall(built, w, layout.gate, colors, purified, baseY);
  for (const t of layout.towers) buildTower(built, t, colors, purified, baseY);
  buildKeep(built, layout.keep, colors, purified, baseY);
  buildGatehouse(built, gateWall, layout.gate, colors, baseY);
  if (purified) addPurifiedLights(built, layout, baseY);

  const merged = mergeCastle(built);
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
  skin: 0x4f7a3d,
  skinDark: 0x3d5f2e,
  hood: 0x5a4a3a,
  hoodDark: 0x463824,
  eye: 0xe8d84a,
} as const;

function sphere(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(color, opts));
}

/** One flared ear: a squashed sphere angled outward from the head. */
function goblinEar(r: number, color: number, side: -1 | 1): THREE.Group {
  const g = new THREE.Group();
  const e = sphere(r, color);
  e.scale.set(0.55, 1.5, 0.4);
  g.add(e);
  g.rotation.z = side * 0.55;
  g.rotation.y = side * 0.3;
  return g;
}

/** Ragged flap teeth around the hood's rim — a handful of tiny cones. */
function hoodTatters(rimR: number, y: number, color: number, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rng() * 0.3;
    const len = 0.08 + rng() * 0.08;
    const flap = cone(0.05, len, color);
    flap.position.set(Math.sin(ang) * rimR, y - len / 2, Math.cos(ang) * rimR);
    flap.rotation.x = Math.PI; // apex points down — a hanging tatter
    g.add(flap);
  }
  return g;
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
  const scale = 0.85 + rng() * 0.3;
  const skinJitter = rng() > 0.5 ? GOBLIN_COLORS.skin : GOBLIN_COLORS.skinDark;

  const inner = new THREE.Group();

  // Chunky egg body (a squashed, slightly bottom-heavy sphere).
  const bodyR = 0.32;
  const body = sphere(bodyR, skinJitter);
  body.scale.set(1, 1.25, 0.92);
  body.position.y = bodyR * 1.15;
  inner.add(body);

  // Big flared ears, set on the upper body/head area.
  const earY = bodyR * 1.85;
  for (const side of [-1, 1] as const) {
    const ear = goblinEar(0.16, GOBLIN_COLORS.skinDark, side);
    ear.position.set(side * bodyR * 0.75, earY, -bodyR * 0.1);
    inner.add(ear);
  }

  // Tattered hood: a cone over the head + a ring of small hanging tatters.
  const hoodY = bodyR * 1.55;
  const hood = cone(bodyR * 0.85, bodyR * 1.1, GOBLIN_COLORS.hood);
  hood.position.y = hoodY + (bodyR * 1.1) / 2 - 0.02;
  inner.add(hood);
  const tatters = hoodTatters(bodyR * 0.62, hoodY + 0.05, GOBLIN_COLORS.hoodDark, rng);
  inner.add(tatters);

  // Glowing yellow eyes, low on the face under the hood's brim.
  const eyeY = bodyR * 1.05;
  for (const side of [-1, 1] as const) {
    const eye = sphere(0.045, GOBLIN_COLORS.eye, {
      emissive: GOBLIN_COLORS.eye,
      emissiveIntensity: 1.6,
    });
    eye.position.set(side * 0.09, eyeY, bodyR * 0.92);
    inner.add(eye);
  }

  inner.scale.setScalar(scale);
  const root = new THREE.Group();
  root.add(inner);
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
  tunic: 0x2f8f4a,
  tunicDark: 0x24703a,
  skin: 0xf3dab3,
  hat: 0xc23f4a,
  hatDark: 0x9c2f3a,
  ear: 0xe8c79a,
  eye: 0x2a2018,
  grin: 0x7a2f2f,
  shoe: 0x5a3b26,
} as const;

/** One small pointy ear, angled outward from the head. */
function elfEar(r: number, color: number, side: -1 | 1): THREE.Group {
  const g = new THREE.Group();
  const e = cone(r, r * 2.2, color);
  e.rotation.x = -Math.PI / 2.4;
  g.add(e);
  g.rotation.z = side * 0.7;
  g.rotation.y = side * 0.5;
  return g;
}

/** A thin upward-curving arc mesh — the permanent happy grin. */
function elfGrin(r: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.22, 4, 10, Math.PI * 0.8), mat(color));
  mesh.rotation.z = Math.PI + (Math.PI - Math.PI * 0.8) / 2; // open edge faces up → a smile
  return mesh;
}

/**
 * Build one elf model from a seeded per-individual `rng` (scale + slight
 * tunic colour jitter, same convention as `buildGoblin`). ~0.9 m tall.
 *
 * Per-individual size jitter lives on an inner group (`root.children[0]`),
 * matching `buildGoblin`'s convention so a future per-frame bob/squash on the
 * root's own transform never clobbers it.
 */
export function buildElf(rng: () => number): THREE.Group {
  const scale = 0.8 + rng() * 0.3;
  const tunicJitter = rng() > 0.5 ? ELF_COLORS.tunic : ELF_COLORS.tunicDark;

  const inner = new THREE.Group();

  // Plump egg-shaped tunic body.
  const bodyR = 0.22;
  const body = sphere(bodyR, tunicJitter);
  body.scale.set(1, 1.3, 0.92);
  const bodyY = bodyR * 1.3;
  body.position.y = bodyY;
  inner.add(body);

  // Tiny feet peeking out from under the tunic hem.
  for (const side of [-1, 1] as const) {
    const foot = box(0.1, 0.08, 0.14, ELF_COLORS.shoe);
    foot.position.set(side * 0.08, 0.04, 0.03);
    inner.add(foot);
  }

  // Cream head.
  const headR = 0.14;
  const headY = bodyY + bodyR * 1.3 + headR * 0.9;
  const head = sphere(headR, ELF_COLORS.skin);
  head.position.y = headY;
  inner.add(head);

  // Small pointy ears, flared out to the sides of the head.
  for (const side of [-1, 1] as const) {
    const ear = elfEar(0.045, ELF_COLORS.ear, side);
    ear.position.set(side * headR * 0.85, headY + 0.01, -headR * 0.1);
    inner.add(ear);
  }

  // Dark friendly eyes.
  for (const side of [-1, 1] as const) {
    const eye = sphere(0.022, ELF_COLORS.eye);
    eye.position.set(side * 0.055, headY + 0.01, headR * 0.92);
    inner.add(eye);
  }

  // Permanent happy grin.
  const grin = elfGrin(0.055, ELF_COLORS.grin);
  grin.position.set(0, headY - 0.05, headR * 0.88);
  inner.add(grin);

  // Jaunty pointy hat, tipped slightly.
  const hatColor = rng() > 0.5 ? ELF_COLORS.hat : ELF_COLORS.hatDark;
  const hat = cone(headR * 0.95, headR * 1.7, hatColor);
  hat.position.y = headY + headR * 0.75 + (headR * 1.7) / 2;
  hat.rotation.z = (rng() - 0.5) * 0.3;
  inner.add(hat);

  inner.scale.setScalar(scale);
  const root = new THREE.Group();
  root.add(inner);
  return root;
}
