import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CRITTER_VARIATION } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';
import { hash2 } from '../core/rng.ts';

// Procedural critter models — round 4's faceted figurine register.
//
// The terrain/prop language now carries through the whole roster: broad planar
// facets, deliberately low segment counts, and sculpted silhouette pieces in
// place of round-3 plush sphere stacking. Every authored surface uses the flat
// material class except sclera/iris/highlight eyes, which stay glossy and
// smooth. Palettes, animation pivots, per-individual jitter, weathering rolls,
// translucent crystal, and emissive identities remain unchanged.
//
// BoxGeometry is BANNED as a primary body/head form — only small accents
// (hooves, teeth) may still be little boxes.
//
// Convention: models face +Z ("forward"), stand on y=0, roughly centred on the
// x axis. `buildCritterModel` returns the group plus a `CritterParts` handle of
// animatable Object3Ds (leg / wing / tail / head groups pivot at the joint so a
// single rotation swings the whole limb; see animation.ts).

/** Animatable handles into a built model. Limbs pivot at their joint. */
export interface CritterParts {
  legs: THREE.Object3D[];
  wings?: THREE.Object3D[];
  head: THREE.Object3D;
  body: THREE.Object3D;
  tail?: THREE.Object3D;
  /** Long springy antennae (prismhorse): lag/spring behind movement. */
  antennae?: THREE.Object3D[];
}

type MatOpts = {
  emissive?: number;
  emissiveIntensity?: number;
  /** Translucency (prismhorse crystal): sets transparent + opacity. */
  opacity?: number;
  /** Flat-shaded facets. Round 4 defaults true; glossy eyes pass false. */
  flat?: boolean;
};

// Quality-gated (P3): MeshStandardMaterial (roughness 0.8) on medium+, the
// identical-look MeshLambertMaterial on low. Emissive glow + translucency
// (prismhorse crystal) pass through both paths unchanged.
// ---------------------------------------------------------------------------
// Shared material cache. Every distinct (color, emissive, intensity, opacity,
// shading) combination maps to ONE material instance shared across all
// critters — the always-white eye highlight is a single material game-wide,
// L/R eye pairs share, and un-jittered part colors share across every
// individual of a species. Per-individual hue-jittered parts get their own
// entries (expected; the jitter palette is finite per species so the cache
// stays bounded). Quality (Lambert vs Standard) is fixed per boot, so the
// cache never mixes. The key INCLUDES the flat/smooth shading flag: round 4
// keeps glossy eyes smooth against flat sculpture, and the same colour must
// never alias across those two authored classes.
//
// CONTRACT for consumers: cached materials are SHARED —
//   1. never mutate one per-instance (clone first; see mount-system's ride
//      fade, which clones the actor's materials before fading), and
//   2. never dispose one when tearing down a single critter (check
//      isSharedCritterMaterial in disposeGroup-style helpers; geometries are
//      per-build and must still be disposed).
// ---------------------------------------------------------------------------
const materialCache = new Map<string, THREE.Material>();
const sharedMaterials = new WeakSet<THREE.Material>();

/** True when `m` came from the shared critter-material cache (skip disposal). */
export function isSharedCritterMaterial(m: THREE.Material): boolean {
  return sharedMaterials.has(m);
}

function mat(color: number, opts: MatOpts = {}): THREE.Material {
  const flat = opts.flat ?? true;
  const key = `${color}:${opts.emissive ?? -1}:${opts.emissiveIntensity ?? 1}:${opts.opacity ?? -1}:${flat ? 'f' : 's'}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const m = makeSurfaceMaterial({
    color,
    flatShading: flat,
    roughness: ROUGHNESS.critter,
    ...(opts.emissive !== undefined
      ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 }
      : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
  });
  materialCache.set(key, m);
  sharedMaterials.add(m);
  return m;
}

// --- round-4 primitive helpers: low-poly, flat, broad-faced ------------------

/** Scaled faceted mass used for skulls, torsos, haunches, and mantles. */
function chunk(
  r: number,
  color: number,
  scale: readonly [number, number, number] = [1, 1, 1],
  detail: 0 | 1 = 1,
  opts: MatOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color, opts));
  m.scale.set(...scale);
  return m;
}

/** Coarse 20-triangle chunk for tips, spots, joints, and weathering accents. */
function blob(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(color, opts));
}

function cone(r: number, h: number, color: number, seg = 8, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, Math.min(seg, 6)), mat(color, opts));
}

function cyl(
  rt: number,
  rb: number,
  h: number,
  color: number,
  seg = 8,
  opts: MatOpts = {},
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, Math.min(seg, 6)), mat(color, opts));
}

/** Small accent box (hooves / teeth only). */
function box(w: number, h: number, d: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

/** An octahedron primitive (crystal prism look) — ALWAYS flat: identity. */
function crystal(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), mat(color, { ...opts, flat: true }));
}

/**
 * A tiny smiling mouth: a thin torus arc facing +Z, arc centred at the bottom
 * of the circle so the corners curl UP. Caller positions it on the face-front.
 */
function smile(r: number, tube: number, color = 0x2b211a, arc = 1.7): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 4, 8, arc), mat(color));
  m.rotation.z = -Math.PI / 2 - arc / 2;
  return m;
}

/** A small flat hexagonal cheek disc sitting proud of the face plane. */
function blush(r: number, color: number): THREE.Mesh {
  const m = cyl(r, r, 0.018, color, 6);
  m.rotation.x = Math.PI / 2;
  m.scale.set(1.15, 1, 0.72);
  return m;
}

/**
 * A thin closed, convex polygon panel in local XY. Keeping a little depth
 * makes fins and membranes readable from either side (especially against the
 * sky) without paying for a soft double-sided material class.
 */
function facetedPanel(
  points: ReadonlyArray<readonly [number, number]>,
  color: number,
  depth = 0.035,
): THREE.Mesh {
  const ordered = points.map(([x, y]) => [x, y] as [number, number]);
  let signedArea = 0;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[(i + 1) % ordered.length]!;
    signedArea += a[0] * b[1] - b[0] * a[1];
  }
  if (signedArea < 0) ordered.reverse();

  const n = ordered.length;
  const positions: number[] = [];
  for (const z of [depth / 2, -depth / 2]) {
    for (const [x, y] of ordered) positions.push(x, y, z);
  }
  const indices: number[] = [];
  for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
  for (let i = 1; i < n - 1; i++) indices.push(n, n + i + 1, n + i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, mat(color));
}

// --- the charm payoff: an expressive eye ------------------------------------

interface EyeOpts {
  /** Legacy socket colour; used as the lens base for emissive socket eyes. */
  sclera?: number;
  /** Iris colour. */
  iris?: number;
  /** Make the sclera glow (gloomgobbler lantern eyes). */
  scleraEmissive?: number;
  scleraEmissiveIntensity?: number;
  /** Optional glowing iris (yellow lantern pupil inside a dark eye). */
  irisEmissive?: number;
  irisEmissiveIntensity?: number;
  /** Iris radius as a fraction of the eye radius (bigger = cuter/dopier). */
  irisR?: number;
  /** Horizontal highlight direction in eye-local space (−1 left, +1 right). */
  highlightSide?: number;
  /** Optional hairline sclera/socket rim around the inset lens. */
  rim?: number;
}

/**
 * One eye as an INSET lens facing +Z. The group's origin is the surrounding
 * face plane: the lens volume lives almost entirely behind z=0 and only its
 * glossy face reaches the skull surface. A flat highlight chip is laid inside
 * that surface instead of adding another protruding ball. Emissive species may
 * retain a flat inner pupil, and selected mammal looks can request a hairline
 * socket rim, but there is never a sclera sphere outside the head.
 */
function eye(r: number, o: EyeOpts = {}): THREE.Group {
  const g = new THREE.Group();
  if (o.rim !== undefined) {
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.91, r * 1.035, 12),
      mat(o.rim, { flat: false }),
    );
    rim.scale.y = 1.05;
    rim.position.z = -r * 0.012;
    g.add(rim);
  }

  const socketGlow = o.scleraEmissive !== undefined;
  const lensColor = socketGlow || o.irisEmissive !== undefined
    ? (o.sclera ?? 0x17131b)
    : (o.iris ?? 0x241b14);
  const lensOpts: MatOpts = socketGlow
    ? { flat: false, emissive: o.scleraEmissive, emissiveIntensity: o.scleraEmissiveIntensity ?? 1.4 }
    : { flat: false };
  const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat(lensColor, lensOpts));
  lens.scale.set(1, 1.05, 0.25);
  lens.position.z = -r * 0.24;
  g.add(lens);

  // Lantern eyes retain their small glowing/dark centre as a flat in-lens
  // chip. Ordinary eyes use the single dark lens without a layered iris dome.
  if (o.irisEmissive !== undefined || socketGlow) {
    const pupilR = r * (o.irisR ?? 0.5);
    const pupil = new THREE.Mesh(
      new THREE.CircleGeometry(pupilR, 10),
      mat(
        o.iris ?? 0x241b14,
        o.irisEmissive !== undefined
          ? { flat: false, emissive: o.irisEmissive, emissiveIntensity: o.irisEmissiveIntensity ?? 1.4 }
          : { flat: false },
      ),
    );
    pupil.scale.y = 1.04;
    pupil.position.z = r * 0.014;
    g.add(pupil);
  }

  const hi = new THREE.Mesh(new THREE.CircleGeometry(r * 0.2, 6), mat(0xffffff, { flat: false }));
  hi.position.set((o.highlightSide ?? -1) * r * 0.3, r * 0.34, r * 0.022);
  hi.scale.y = 0.88;
  g.add(hi);
  return g;
}

/** A symmetric pair of eyes on the +Z face of a head, spaced by `sep`, with a
 *  slight outward toe so they read as looking at you rather than cross-eyed. */
function eyePair(sep: number, y: number, z: number, r: number, o: EyeOpts = {}, toe = 0.12): THREE.Group[] {
  const out: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    // Highlights sit up-and-OUTWARD on the pair like painted figurine eyes.
    const e = eye(r, { ...o, highlightSide: sx });
    e.position.set(sx * sep, y, z);
    e.rotation.y = sx * toe;
    out.push(e);
  }
  return out;
}

/**
 * A limb group pivoting at (x,y,z): a stubby tapered leg (cylinder) is dropped
 * so its top sits at the pivot, so rotating the returned group about X swings
 * the whole leg from the hip. Optional splay lean and a little hoof/paw.
 */
function legGroup(
  x: number,
  y: number,
  z: number,
  rTop: number,
  rBot: number,
  h: number,
  color: number,
  splay = 0,
  foot?: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = cyl(rTop, rBot, h, color, 6);
  m.position.y = -h / 2;
  m.rotation.z = splay; // outward lean, kept off the animated group's rotation
  g.add(m);
  if (foot !== undefined) {
    const hoof = box(rBot * 2.1, rBot * 1.2, rBot * 2.4, foot);
    hoof.position.y = -h / 2 - h / 2 + rBot * 0.2; // at the sole
    m.add(hoof);
  }
  return g;
}

/**
 * A curved horn/antler as tapered cylinder segments chained end-to-end through
 * `pts` (local space), so the curl reads as one continuous connected form
 * (r0 at the base → r1 at the tip). Returned as a group the caller positions.
 * Round 4 horns are flat by default; `opts` carries glow/translucency classes.
 */
function segmentedHorn(
  pts: ReadonlyArray<readonly [number, number, number]>,
  r0: number,
  r1: number,
  color: number,
  opts: MatOpts = {},
  seg = 6,
): THREE.Group {
  const g = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const vs = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  for (let i = 0; i < vs.length - 1; i++) {
    const a = vs[i]!;
    const b = vs[i + 1]!;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1e-3;
    const rBot = THREE.MathUtils.lerp(r0, r1, i / (vs.length - 1));
    const rTop = THREE.MathUtils.lerp(r0, r1, (i + 1) / (vs.length - 1));
    const s = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg), mat(color, opts));
    s.position.copy(a).add(b).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(s);
  }
  return g;
}

/** Quadruped foot layout: [signX, signZ] for the four legs. */
const QUAD: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

// --- per-individual variation -------------------------------------------------

/** Jitter a hex colour's hue/lightness slightly for per-individual variety. */
function jitterColor(
  hex: number,
  rng: () => number,
  hueAmt: number = CRITTER_VARIATION.hueJitter,
  litAmt: number = CRITTER_VARIATION.lightnessJitter,
): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + (rng() - 0.5) * hueAmt + 1) % 1,
    hsl.s,
    THREE.MathUtils.clamp(hsl.l + (rng() - 0.5) * litAmt, 0.05, 0.95),
  );
  return c.getHex();
}

/**
 * Bake one subtly different lightness onto every triangle. Because source
 * geometry is non-indexed by the time this runs, each face owns exactly three
 * colour entries; all three receive the same value, so facets stay planar
 * instead of becoming rainbow gradients. The integer hash makes the pattern
 * stable for a build seed without consuming more RNG per vertex.
 */
function setFaceTintColors(
  geometry: THREE.BufferGeometry,
  base: THREE.Color,
  buildSeed: number,
  meshIndex: number,
): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const hsl = { h: 0, s: 0, l: 0 };
  const tinted = new THREE.Color();
  base.getHSL(hsl);
  for (let face = 0; face < Math.ceil(count / 3); face++) {
    const offset = (hash2(buildSeed, face, meshIndex) * 2 - 1) * CRITTER_VARIATION.facetLightnessJitter;
    tinted.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + offset, 0.03, 0.97));
    const end = Math.min(count, face * 3 + 3);
    for (let vertex = face * 3; vertex < end; vertex++) {
      colors[vertex * 3] = tinted.r;
      colors[vertex * 3 + 1] = tinted.g;
      colors[vertex * 3 + 2] = tinted.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// --- species builders ---------------------------------------------------------
// Each returns the assembled group (root at feet, y=0) and its parts. Colours
// are jittered per-individual and a small weathering accent is rolled (always
// via an unconditional rng() draw — determinism convention) so a herd never
// looks cloned. Palette is muted-but-rich; a separate tinted belly part gives
// the darker/lighter underside.

/** Puffle — sandy faceted rabbit figurine with billboard teardrop ears. */
function buildPuffle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0xe2bd77, rng, 0.06);
  const cream = jitterColor(0xffe3ad, rng, 0.04);
  const furDark = jitterColor(0xc68e51, rng, 0.05);
  const pink = jitterColor(0xf39ab5, rng, 0.04);
  const noseC = jitterColor(0xb96870, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.42;
  const shell = chunk(0.42, fur, [0.9, 1.16, 0.86]);
  shell.rotation.x = -0.08;
  body.add(shell);
  // A planar chest plate and little hanging forepaws sculpt the pear mass.
  const bib = chunk(0.25, cream, [0.78, 1.05, 0.32], 0);
  bib.position.set(0, -0.03, 0.36);
  body.add(bib);
  for (const sx of [-1, 1]) {
    const arm = cyl(0.045, 0.07, 0.22, furDark, 5);
    arm.position.set(sx * 0.16, 0.0, 0.34);
    arm.rotation.z = sx * 0.24;
    body.add(arm);
    const haunch = chunk(0.22, furDark, [1.05, 0.72, 1.05], 0);
    haunch.position.set(sx * 0.27, -0.24, -0.08);
    body.add(haunch);
  }
  g.add(body);

  // Large cream skull, faceted cheek planes, and a small squared muzzle.
  const head = new THREE.Group();
  head.position.set(0, 0.88, 0.13);
  const skull = chunk(0.34, cream, [1.08, 0.94, 0.9]);
  head.add(skull);
  const muzzle = cyl(0.1, 0.14, 0.13, cream, 4);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.35, 1, 0.6);
  muzzle.position.set(0, -0.13, 0.31);
  head.add(muzzle);
  for (const e of eyePair(0.16, 0.06, 0.27, 0.145, { iris: 0x4d342c, irisR: 0.72 }, 0.055)) {
    head.add(e);
  }
  const nose = chunk(0.047, noseC, [1.15, 0.72, 0.72], 0);
  nose.position.set(0, -0.1, 0.41);
  head.add(nose);
  const mouth = smile(0.06, 0.012);
  mouth.position.set(0, -0.19, 0.4);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const b = blush(0.065, pink);
    b.position.set(sx * 0.27, -0.1, 0.3);
    b.rotation.y = sx * 0.4;
    head.add(b);
  }

  // Giant coarse icosahedra stretch into diamond-teardrop ears. Their pink
  // inset slabs sit forward, preserving the concept's dominant silhouette.
  const notchRoll = rng();
  for (const sx of [-1, 1]) {
    const short = notchRoll < 0.28 && sx === -1;
    const ear = chunk(0.22, fur, [0.78, short ? 1.55 : 1.9, 0.48], 0);
    ear.position.set(sx * 0.23, short ? 0.42 : 0.5, -0.02);
    ear.rotation.z = sx * -0.2;
    head.add(ear);
    const inner = chunk(0.15, pink, [0.62, short ? 1.45 : 1.78, 0.2], 0);
    inner.position.set(sx * 0.23, short ? 0.42 : 0.5, 0.105);
    inner.rotation.z = sx * -0.2;
    head.add(inner);
  }
  g.add(head);

  // Four animation handles stay intact; haunch-like rear feet sell the sit.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.2, 0.19, sz * 0.15, 0.07, sz > 0 ? 0.1 : 0.115, 0.19, furDark);
    legs.push(l);
    g.add(l);
  }

  if (rng() < 0.4) {
    const freckle = blob(0.04, furDark);
    freckle.position.set(0.27, 0.02, 0.38);
    body.add(freckle);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Skitterling — upright jewel beetle with unmistakable paddle antennae. */
function buildSkitterling(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shell = jitterColor(0x6658c9, rng, 0.07);
  const shellDark = jitterColor(0x33266f, rng, 0.05);
  const shellLight = jitterColor(0x9b8df0, rng, 0.06);
  const paddleC = jitterColor(0xf18bb9, rng, 0.05);
  const cream = jitterColor(0xffe5c4, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.42;
  const carapace = chunk(0.34, shell, [0.92, 1.25, 0.82]);
  body.add(carapace);
  const dome = chunk(0.25, shellLight, [0.9, 0.72, 0.78], 0);
  dome.position.set(0, 0.09, -0.24);
  body.add(dome);
  // A hard central keel splits the beetle wing-cases.
  const seam = cyl(0.015, 0.025, 0.42, cream, 4);
  seam.rotation.x = Math.PI / 2;
  seam.position.set(0, 0.11, -0.2);
  body.add(seam);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.82, 0.14);
  const hb = chunk(0.32, shell, [1.08, 0.92, 0.9]);
  head.add(hb);
  const muzzle = cyl(0.07, 0.1, 0.1, shellLight, 4);
  muzzle.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  muzzle.scale.set(1.4, 1, 0.5);
  muzzle.position.set(0, -0.14, 0.29);
  head.add(muzzle);
  for (const e of eyePair(0.165, 0.025, 0.27, 0.15, { sclera: 0x171326, iris: 0x06050c, irisR: 0.76 }, 0.045)) {
    head.add(e);
  }
  const mouth = smile(0.045, 0.009, 0x24173b);
  mouth.position.set(0, -0.19, 0.35);
  head.add(mouth);

  // Enormous springy stems terminate in flattened candy paddles. They remain
  // inside `head` (not a new animation handle) to preserve the parts contract.
  for (const sx of [-1, 1]) {
    head.add(segmentedHorn([
      [sx * 0.08, 0.2, 0.0],
      [sx * 0.14, 0.38, 0.02],
      [sx * 0.24, 0.55, 0.08],
    ], 0.025, 0.014, shellDark, {}, 5));
    const pad = chunk(0.12, paddleC, [0.62, 1.28, 0.32], 0);
    pad.position.set(sx * 0.27, 0.61, 0.1);
    pad.rotation.z = sx * -0.32;
    head.add(pad);
    const dot = blob(0.045, cream);
    dot.position.set(sx * 0.31, 0.72, 0.12);
    head.add(dot);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const sz of [0.2, 0, -0.2]) {
    for (const sx of [-1, 1]) {
      const l = legGroup(sx * 0.24, 0.25, sz, 0.025, 0.04, 0.27, shellDark, sx * 0.58);
      const claw = cone(0.035, 0.09, shellDark, 4);
      claw.rotation.x = Math.PI / 2;
      claw.position.set(sx * 0.015, -0.26, 0.045);
      l.add(claw);
      legs.push(l);
      g.add(l);
    }
  }

  if (rng() < 0.35) {
    const spot = blob(0.045, paddleC);
    spot.position.set(0.18, 0.17, -0.24);
    body.add(spot);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Bellowbuck — long-legged elk figurine crowned by broad mossy antlers. */
function buildBellowbuck(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const hide = jitterColor(0x8a5b37, rng, 0.04);
  const hideLight = jitterColor(0xf0cf91, rng, 0.04);
  const hideDark = jitterColor(0x5c3a27, rng, 0.03);
  const antlerC = jitterColor(0x71864d, rng, 0.05, 0.05);

  const body = new THREE.Group();
  body.position.y = 1.12;
  const barrel = chunk(0.47, hide, [0.68, 0.64, 1.46]);
  body.add(barrel);
  const belly = chunk(0.29, hideLight, [0.76, 0.42, 1.25], 0);
  belly.position.set(0, -0.29, 0.1);
  body.add(belly);
  const hump = chunk(0.29, hideDark, [1.0, 0.88, 0.8], 0);
  hump.position.set(0, 0.2, 0.38);
  body.add(hump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.38, 0.64);
  const neck = cyl(0.14, 0.2, 0.7, hideDark, 5);
  neck.rotation.x = -0.28;
  neck.position.set(0, 0.04, -0.05);
  head.add(neck);
  const skull = chunk(0.3, hide, [0.94, 0.96, 1.02]);
  skull.position.set(0, 0.35, 0.29);
  head.add(skull);
  const muzzle = cyl(0.12, 0.18, 0.22, hideLight, 4);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.25, 1, 0.62);
  muzzle.position.set(0, 0.22, 0.52);
  head.add(muzzle);
  for (const e of eyePair(0.15, 0.41, 0.56, 0.115, { iris: 0x3d6142, irisR: 0.66, rim: hideLight }, 0.075)) {
    e.scale.y = 0.92;
    head.add(e);
  }
  const nose = chunk(0.06, hideDark, [1.25, 0.62, 0.58], 0);
  nose.position.set(0, 0.21, 0.69);
  head.add(nose);
  const mouth = smile(0.07, 0.012, hideDark);
  mouth.position.set(0, 0.1, 0.66);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const ear = chunk(0.12, hideLight, [1.25, 0.56, 0.38], 0);
    ear.position.set(sx * 0.28, 0.48, 0.19);
    ear.rotation.z = sx * -0.18;
    head.add(ear);
  }

  // Broad low-segment beams and upright tines replace the old plush palms.
  const chipRoll = rng();
  for (const sx of [-1, 1] as const) {
    head.add(segmentedHorn([
      [sx * 0.12, 0.52, 0.17],
      [sx * 0.3, 0.7, 0.1],
      [sx * 0.55, 0.78, 0.04],
      [sx * 0.82, 0.73, -0.02],
    ], 0.075, 0.035, antlerC, {}, 5));
    const fingers = chipRoll < 0.28 && sx === -1 ? 2 : 3;
    for (let i = 0; i < fingers; i++) {
      const bx = 0.34 + i * 0.2;
      head.add(segmentedHorn([
        [sx * bx, 0.72 + i * 0.03, 0.06],
        [sx * (bx + 0.02), 0.94 + i * 0.04, 0.03],
      ], 0.045, 0.025, antlerC, {}, 5));
    }
    const tip = cone(0.04, 0.2, antlerC, 5);
    tip.position.set(sx * 0.84, 0.82, -0.02);
    tip.rotation.z = sx * -0.48;
    head.add(tip);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.86, sz * 0.43, 0.065, 0.085, 0.86, hide, 0, 0x36251c);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.23, -0.66);
  const tm = chunk(0.1, hideLight, [0.8, 1, 1.3], 0);
  tm.position.z = -0.08;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/** Mirefin — upright axolotl figurine with a six-petal pink head frill. */
function buildMirefin(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const skin = jitterColor(0x169bb3, rng, 0.07);
  const skinDark = jitterColor(0x087083, rng, 0.05);
  const belly = jitterColor(0xa8f0e2, rng, 0.04);
  const frillC = jitterColor(0xf27daf, rng, 0.05);
  const frillLight = jitterColor(0xffb4cf, rng, 0.04);

  const body = new THREE.Group();
  body.position.y = 0.34;
  body.rotation.x = -0.08;
  const torso = chunk(0.34, skin, [0.84, 0.92, 0.9]);
  body.add(torso);
  const bel = chunk(0.22, belly, [0.72, 1.0, 0.32], 0);
  bel.position.set(0, -0.04, 0.29);
  body.add(bel);
  for (const sx of [-1, 1]) {
    const haunch = chunk(0.2, skinDark, [1.08, 0.72, 1.0], 0);
    haunch.position.set(sx * 0.27, -0.16, -0.06);
    body.add(haunch);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.75, 0.16);
  head.rotation.x = -0.06;
  const hb = chunk(0.37, skin, [1.12, 0.87, 0.9]);
  head.add(hb);
  const snout = cyl(0.1, 0.15, 0.13, belly, 4);
  snout.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  snout.scale.set(1.5, 1, 0.52);
  snout.position.set(0, -0.16, 0.33);
  head.add(snout);
  for (const e of eyePair(0.185, 0.035, 0.31, 0.145, { iris: 0x144d65, irisR: 0.7 }, 0.055)) {
    head.add(e);
  }
  const mouth = smile(0.095, 0.012, skinDark, 1.95);
  mouth.position.set(0, -0.21, 0.42);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const cheek = blush(0.052, frillLight);
    cheek.position.set(sx * 0.3, -0.11, 0.29);
    head.add(cheek);
  }

  // Three angular leaves on each cheek make the concept's six-point halo.
  for (const sx of [-1, 1] as const) {
    for (const [i, yy, tilt] of [
      [0, 0.2, 0.72],
      [1, 0.0, 0.12],
      [2, -0.19, -0.62],
    ] as const) {
      const frill = chunk(0.135 - i * 0.008, frillC, [0.48, 1.25, 0.28], 0);
      frill.position.set(sx * (0.38 + i * 0.025), yy, 0.0);
      frill.rotation.z = sx * -tilt;
      head.add(frill);
      const dot = blob(0.03, frillLight);
      dot.position.set(sx * (0.4 + i * 0.025), yy + 0.015, 0.055);
      head.add(dot);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const front = sz > 0;
    const l = legGroup(
      sx * (front ? 0.28 : 0.2),
      front ? 0.48 : 0.18,
      front ? 0.18 : -0.06,
      0.04,
      front ? 0.055 : 0.075,
      front ? 0.27 : 0.18,
      skinDark,
      sx * (front ? 0.38 : 0.18),
    );
    for (const tx of [-0.025, 0.025]) {
      const toe = cone(0.018, 0.055, belly, 4);
      toe.rotation.x = Math.PI / 2;
      toe.position.set(tx, -(front ? 0.27 : 0.18), 0.04);
      l.add(toe);
    }
    legs.push(l);
    g.add(l);
  }

  // A thick curved tail ends in three staggered pink fan shards.
  const tail = new THREE.Group();
  tail.position.set(0, 0.34, -0.25);
  tail.add(segmentedHorn([
    [0, 0, 0],
    [0.06, -0.02, -0.24],
    [0.13, 0.06, -0.46],
    [0.12, 0.2, -0.61],
  ], 0.12, 0.06, skinDark, {}, 6));
  for (const [sx, yy, rz] of [[-1, 0.16, -0.55], [0, 0.25, 0], [1, 0.16, 0.55]] as const) {
    const fan = chunk(0.13, frillC, [0.52, 1.22, 0.28], 0);
    fan.position.set(0.12 + sx * 0.08, yy, -0.64);
    fan.rotation.z = rz;
    tail.add(fan);
  }
  g.add(tail);

  if (rng() < 0.35) {
    const tailSpot = blob(0.045, frillLight);
    tailSpot.position.set(0.13, 0.32, -0.66);
    tail.add(tailSpot);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

/** Shark — round, cheeky pack hunter with four swimming-fin pivots. */
function buildShark(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const slate = jitterColor(0x657986, rng, 0.035, 0.05);
  const slateLight = jitterColor(0x7f929b, rng, 0.03, 0.04);
  const slateDark = jitterColor(0x425866, rng, 0.025, 0.045);
  const cream = jitterColor(0xf0dfb9, rng, 0.025, 0.035);
  const ink = 0x101820;

  // A broad pear-shaped barrel and a low cream inset give the concept its
  // toy-like pot belly while keeping the silhouette horizontal in the water.
  const body = new THREE.Group();
  body.position.y = 0.72;
  const barrel = chunk(0.5, slate, [0.9, 0.72, 1.18]);
  barrel.rotation.x = 0.035;
  body.add(barrel);
  const underside = chunk(0.38, cream, [0.72, 0.45, 1.03]);
  underside.position.set(0, -0.24, 0.08);
  underside.rotation.x = 0.04;
  body.add(underside);

  // The large swept dorsal is a true triangular slab rather than a flattened
  // cone, so its identity survives both side profiles and distant water fog.
  const dorsal = facetedPanel([[-0.3, 0], [0.28, 0], [-0.03, 0.52]], slateDark, 0.1);
  dorsal.rotation.y = Math.PI / 2;
  dorsal.position.set(0, 0.27, -0.08);
  body.add(dorsal);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.73, 0.42);
  const skull = chunk(0.46, slate, [1.04, 0.82, 0.94]);
  head.add(skull);
  const brow = chunk(0.27, slateLight, [1.25, 0.52, 0.72], 0);
  brow.position.set(0, 0.16, 0.08);
  head.add(brow);
  const jaw = chunk(0.34, cream, [1.14, 0.58, 0.78]);
  jaw.position.set(0, -0.16, 0.18);
  head.add(jaw);

  // Wrap the lenses onto the broad cheek facets: front view keeps the huge
  // paired expression, while profile sees a flush round eye instead of the
  // edge of a lens authored only on the nose plane.
  for (const e of eyePair(0.34, 0.12, 0.29, 0.18, { iris: 0x06080a, rim: cream }, 0.78)) {
    head.add(e);
  }
  const grin = smile(0.145, 0.011, ink, 1.82);
  grin.position.set(0, -0.16, 0.445);
  head.add(grin);
  for (const sx of [-1, 1]) {
    const nostril = blob(0.019, ink);
    nostril.scale.set(1.0, 0.7, 0.42);
    nostril.position.set(sx * 0.1, -0.015, 0.45);
    head.add(nostril);
  }

  // Two deep slash-gills on each cheek (occasionally three) carry the simple
  // graphic marks from the approved figurine into the profile view.
  const gillRoll = rng();
  const gillCount = gillRoll < 0.32 ? 3 : 2;
  for (const sx of [-1, 1] as const) {
    for (let i = 0; i < gillCount; i++) {
      const gill = cyl(0.011, 0.011, 0.13 - i * 0.012, ink, 4);
      gill.position.set(sx * 0.475, -0.02 - i * 0.005, 0.07 - i * 0.055);
      gill.rotation.z = sx * (0.16 + i * 0.03);
      head.add(gill);
    }
  }
  g.add(head);

  // Four planar fin handles mirror Mirefin's swimming-part topology. Front
  // fins are the big concept paddles; the rear pair is deliberately smaller.
  const legs: THREE.Object3D[] = [];
  for (const [sx, front] of [[-1, true], [1, true], [-1, false], [1, false]] as const) {
    const fin = new THREE.Group();
    fin.position.set(sx * (front ? 0.33 : 0.3), 0.64, front ? 0.22 : -0.3);
    const reach = front ? 0.47 : 0.28;
    const sweep = front ? 0.3 : 0.19;
    const blade = facetedPanel(
      [[0, 0], [sx * reach, -0.07], [sx * reach * 0.44, -sweep]],
      front ? slateDark : slate,
      front ? 0.075 : 0.055,
    );
    blade.rotation.x = Math.PI / 2;
    fin.add(blade);
    legs.push(fin);
    g.add(fin);
  }

  // A thick peduncle carries two separate triangular caudal lobes. Keeping it
  // under one tail pivot preserves the generic swim sway.
  const tail = new THREE.Group();
  tail.position.set(0, 0.72, -0.48);
  tail.add(segmentedHorn([
    [0, 0, 0],
    [0, 0.01, -0.18],
    [0.015, 0.035, -0.38],
  ], 0.22, 0.095, slateDark, {}, 6));
  for (const points of [
    [[0, 0], [0.25, 0.36], [0.3, 0.05]],
    [[0, 0], [0.3, -0.05], [0.25, -0.36]],
  ] as const) {
    const lobe = facetedPanel(points, slateDark, 0.09);
    lobe.rotation.y = Math.PI / 2;
    lobe.position.set(0.015, 0.035, -0.38);
    tail.add(lobe);
  }
  g.add(tail);

  return { group: g, parts: { legs, head, body, tail } };
}

/** Craghorn — shag-mantled ibex with long swept, ridged faceted horns. */
function buildCraghorn(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  // Fidelity-3 wave 3 (Spencer's mountain-vision image): the craghorn became
  // an ibex-style mountain goat — shaggy two-tone brown mantle, long ridged
  // horns swept back over the body, cream muzzle, dark hooves.
  const wool = jitterColor(0x8f5f36, rng, 0.03, 0.06);
  const woolDark = jitterColor(0x6b4527, rng, 0.03, 0.05);
  const muzzleC = jitterColor(0xecd9b4, rng, 0.03);
  const hornC = jitterColor(0xa87e4e, rng, 0.04, 0.05);

  const body = new THREE.Group();
  body.position.y = 0.7;
  const barrel = chunk(0.45, wool, [0.82, 0.8, 1.23]);
  body.add(barrel);
  const rump = chunk(0.32, wool, [1, 0.92, 0.96], 0);
  rump.position.set(0, 0.03, -0.43);
  body.add(rump);
  // Shoulder mantle: broad dark mass plus staggered downward pelt shards.
  const mantle = chunk(0.39, woolDark, [1.03, 1.02, 0.88]);
  mantle.position.set(0, 0.08, 0.3);
  body.add(mantle);
  for (const [sx, ly, lz, sc] of [
    [-1, -0.22, 0.45, 1], [0, -0.27, 0.5, 1.15], [1, -0.22, 0.45, 1],
    [-0.5, -0.18, 0.25, 0.9], [0.5, -0.18, 0.25, 0.9],
  ] as const) {
    const shag = cone(0.1 * sc, 0.3 * sc, woolDark, 4);
    shag.position.set(sx * 0.25, ly, lz);
    shag.rotation.z = sx * -0.1;
    body.add(shag);
  }
  const bib = chunk(0.2, muzzleC, [0.86, 1.05, 0.36], 0);
  bib.position.set(0, -0.07, 0.59);
  body.add(bib);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.94, 0.53);
  const skull = chunk(0.27, woolDark, [1.04, 1.02, 1.06]);
  head.add(skull);
  const forehead = chunk(0.18, wool, [1.15, 0.72, 0.48], 0);
  forehead.position.set(0, 0.14, 0.17);
  head.add(forehead);
  const muzzle = cyl(0.09, 0.14, 0.16, muzzleC, 4);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.25, 1, 0.68);
  muzzle.position.set(0, -0.09, 0.26);
  head.add(muzzle);
  for (const [i, e] of eyePair(0.13, 0.055, 0.252, 0.095, { iris: 0x30353d, irisR: 0.58 }, 0.08).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.72;
    e.rotation.z = sx * -0.09;
    head.add(e);
    const brow = cyl(0.014, 0.022, 0.13, hornC, 5);
    brow.rotation.z = sx * -1.43;
    brow.position.set(sx * 0.13, 0.15, 0.29);
    head.add(brow);
  }
  const nose = blob(0.045, 0x343139);
  nose.position.set(0, -0.06, 0.34);
  head.add(nose);
  const beard = chunk(0.1, woolDark, [0.78, 1.45, 0.66], 0);
  beard.position.set(0, -0.22, 0.13);
  head.add(beard);
  for (const sx of [-1, 1]) {
    const ear = chunk(0.1, muzzleC, [1.22, 0.52, 0.32], 0);
    ear.position.set(sx * 0.25, 0.09, 0.02);
    ear.rotation.z = sx * -0.08;
    head.add(ear);
  }

  // Ibex horns: long ridged arcs rising from the forehead and sweeping BACK
  // over the mantle with a slight outward flare (the vision image's signature
  // silhouette). Ridge segmentation keeps the craghorn's faceted-horn
  // identity; an rng roll chips one tip on some individuals.
  const chipRoll = rng();
  for (const sx of [-1, 1] as const) {
    const chipped = chipRoll < 0.35 && sx === 1;
    const pts: ReadonlyArray<readonly [number, number, number]> = [
      [sx * 0.1, 0.16, 0.06],
      [sx * 0.18, 0.37, -0.03],
      [sx * 0.34, 0.53, -0.13],
      [sx * 0.53, 0.56, -0.25],
      [sx * 0.68, 0.46, -0.34],
      [sx * 0.72, 0.28, -0.38],
      [sx * 0.66, 0.08, -0.32],
    ];
    head.add(segmentedHorn(chipped ? pts.slice(0, 5) : pts, 0.105, 0.028, hornC, { flat: true }, 6));
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.23, 0.48, sz * 0.33, 0.075, 0.1, 0.48, wool, 0, 0x323039);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Zephyrfinch — one-piece faceted egg chick with three crown quills. */
function buildZephyrfinch(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const feather = jitterColor(0x65b8e8, rng, 0.06);
  const featherDark = jitterColor(0x337eb6, rng, 0.05);
  const cream = jitterColor(0xffe6af, rng, 0.04);
  const beakC = jitterColor(0xf3a848, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.52;
  const torso = chunk(0.4, feather, [0.72, 1.38, 0.72]);
  body.add(torso);
  const chest = chunk(0.27, cream, [0.82, 0.98, 0.3], 0);
  chest.position.set(0, 0.02, 0.34);
  body.add(chest);
  // Three angular bib points make the pale/blue boundary deliberately jagged.
  for (const [sx, yy] of [[-0.11, 0.19], [0, 0.15], [0.11, 0.19]] as const) {
    const tuft = chunk(0.09, cream, [0.78, 1.15, 0.3], 0);
    tuft.position.set(sx, yy, 0.4);
    body.add(tuft);
  }
  const tail = new THREE.Group();
  tail.position.set(0, -0.08, -0.33);
  for (const [sx, rz] of [
    [-1, 0.3],
    [0, 0],
    [1, -0.3],
  ] as const) {
    const f = cone(0.07, 0.3, featherDark, 4);
    f.rotation.x = Math.PI / 2 + 0.35;
    f.rotation.z = rz;
    f.position.set(sx * 0.07, 0, -0.14);
    tail.add(f);
  }
  body.add(tail);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.1);
  const hb = chunk(0.28, feather, [1.02, 0.94, 0.9]);
  head.add(hb);
  for (const e of eyePair(0.136, 0.035, 0.245, 0.112, { iris: 0x244764, irisR: 0.7 }, 0.065)) {
    head.add(e);
  }
  const beak = cone(0.07, 0.16, beakC, 4);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.06, 0.37);
  head.add(beak);

  // Three hard triangular quills sweep backward like the concept crown.
  const plumeRoll = rng();
  const plumeCount = plumeRoll < 0.22 ? 2 : 3;
  for (let i = 0; i < plumeCount; i++) {
    const quill = cone(0.045, 0.24 + i * 0.02, i === 1 ? cream : featherDark, 4);
    quill.position.set((i - 1) * 0.07, 0.29 + i * 0.02, -0.04 - i * 0.025);
    quill.rotation.x = -0.55 - i * 0.1;
    quill.rotation.z = (i - 1) * -0.24;
    head.add(quill);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.27, 0.58, 0.03);
    const wm = chunk(0.16, featherDark, [0.5, 1.25, 0.3], 0);
    wm.rotation.z = sx * -0.18;
    wm.position.set(sx * 0.05, -0.03, -0.02);
    w.add(wm);
    wings.push(w);
    g.add(w);
  }

  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.1, 0.2, 0.0, 0.022, 0.032, 0.2, beakC);
    for (const tx of [-0.035, 0, 0.035]) {
      const toe = cone(0.014, 0.1, beakC, 4);
      toe.rotation.x = Math.PI / 2;
      toe.position.set(tx, -0.2, 0.055);
      l.add(toe);
    }
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/**
 * Skivern — a long, winding Chinese-dragon silhouette built as overlapping
 * low-poly capsule segments. Its pale shields and wing membranes sit on the
 * physical underside, not merely the front, so a player looking up can still
 * identify it against a bright sky.
 */
function buildSkyWyvern(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const sky = jitterColor(0xb9dce7, rng, 0.035, 0.045);
  const skyShade = jitterColor(0x91c3d5, rng, 0.035, 0.045);
  const cloud = jitterColor(0xeaf3ef, rng, 0.018, 0.03);
  const cream = jitterColor(0xf2e5c5, rng, 0.018, 0.03);
  const copper = jitterColor(0xb87948, rng, 0.025, 0.04);
  const ink = 0x253a45;

  type RibbonPoint = readonly [number, number, number];
  const addCapsuleChain = (
    root: THREE.Group,
    points: ReadonlyArray<RibbonPoint>,
    radii: ReadonlyArray<number>,
    bellyThrough: number,
  ): void => {
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i]!;
      const prev = points[Math.max(0, i - 1)]!;
      const next = points[Math.min(points.length - 1, i + 1)]!;
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const angle = Math.atan2(-dx, dy);
      const r = radii[i]!;
      const before = i > 0
        ? Math.hypot(x - prev[0], y - prev[1], z - prev[2])
        : 0;
      const after = i < points.length - 1
        ? Math.hypot(next[0] - x, next[1] - y, next[2] - z)
        : 0;
      const span = Math.max(before, after);
      const axialScale = Math.max(1.18, (span * 1.08 + r * 0.85) / (2 * r));
      const capsule = chunk(r, i % 3 === 1 ? skyShade : sky, [0.82, axialScale, 0.8], 0);
      capsule.position.set(x, y, z);
      capsule.rotation.z = angle;
      root.add(capsule);

      if (i < bellyThrough) {
        const shield = chunk(r * 0.72, i % 2 === 0 ? cream : cloud, [0.7, 0.42, 0.72], 0);
        shield.position.set(x, y - r * 0.69, z + r * 0.16);
        shield.rotation.z = angle;
        root.add(shield);
      }
    }
  };

  // The torso drops from the high neck, rolls through a deep U, then rises
  // into the tail. The alternating capsule facets keep it a ribbon rather
  // than the single fat sausage silhouette rejected in the first concept.
  const body = new THREE.Group();
  body.position.y = 1.18;
  const bodyPath: ReadonlyArray<RibbonPoint> = [
    [-0.28, 0.5, 0.02],
    [-0.36, 0.3, 0.05],
    [-0.36, 0.08, 0.06],
    [-0.27, -0.12, 0.05],
    [-0.08, -0.25, 0.01],
    [0.14, -0.23, -0.05],
    [0.32, -0.08, -0.1],
    [0.39, 0.12, -0.13],
  ];
  addCapsuleChain(body, bodyPath, [0.18, 0.19, 0.2, 0.21, 0.22, 0.21, 0.19, 0.175], 7);
  for (const i of [1, 5]) {
    const [x, y, z] = bodyPath[i]!;
    const ridge = cone(0.042, 0.14, cloud, 4);
    ridge.position.set(x, y + 0.16, z - 0.08);
    ridge.rotation.x = -0.28;
    body.add(ridge);
  }
  g.add(body);

  // Head pivot begins at the neck-body join. Three small capsules taper up to
  // an elegant skull; inset eyes dominate without swelling the whole head.
  const head = new THREE.Group();
  head.position.set(-0.28, 1.62, 0.03);
  const neckPath: ReadonlyArray<RibbonPoint> = [
    [0, 0, 0],
    [0.015, 0.18, 0.035],
    [-0.045, 0.34, 0.095],
  ];
  addCapsuleChain(head, neckPath, [0.17, 0.155, 0.135], 3);

  const skull = chunk(0.24, cloud, [1.0, 0.78, 1.08]);
  skull.position.set(-0.075, 0.48, 0.17);
  head.add(skull);
  const muzzle = chunk(0.14, skyShade, [1.18, 0.58, 1.25], 0);
  muzzle.position.set(-0.075, 0.36, 0.39);
  head.add(muzzle);
  for (const e of eyePair(0.17, 0.5, 0.34, 0.105, { iris: 0x15242b, rim: cloud }, 0.7)) {
    e.position.x -= 0.075;
    head.add(e);
  }
  for (const sx of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.CircleGeometry(0.016, 4), mat(ink));
    nostril.scale.y = 0.62;
    nostril.position.set(-0.075 + sx * 0.07, 0.38, 0.56);
    head.add(nostril);
  }

  // One long whisker on either side and compact copper antlers supply the
  // Chinese-dragon read without overpowering the deliberately small head.
  for (const sx of [-1, 1] as const) {
    head.add(segmentedHorn([
      [-0.075 + sx * 0.07, 0.36, 0.5],
      [-0.075 + sx * 0.27, 0.34, 0.56],
      [-0.075 + sx * 0.47, 0.27, 0.57],
    ], 0.014, 0.004, cream, {}, 4));
  }

  const antlerWear = rng();
  for (const sx of [-1, 1] as const) {
    const antler = cone(0.038, 0.3, copper, 5);
    antler.position.set(-0.075 + sx * 0.14, 0.76, 0.01);
    antler.rotation.z = sx * -0.27;
    antler.rotation.x = -0.22;
    head.add(antler);
    if (!(antlerWear < 0.3 && sx === 1)) {
      const nub = cone(0.02, 0.13, copper, 5);
      nub.position.set(-0.075 + sx * 0.22, 0.8, -0.02);
      nub.rotation.z = sx * -1.08;
      nub.rotation.x = -0.18;
      head.add(nub);
    }
    for (const [yy, tilt] of [[0.5, 1.1], [0.6, 0.88]] as const) {
      const frill = cone(0.038, 0.14, yy > 0.55 ? cloud : skyShade, 4);
      frill.position.set(-0.075 + sx * 0.22, yy, 0.06);
      frill.rotation.z = sx * tilt;
      frill.rotation.x = -0.18;
      head.add(frill);
    }
  }
  g.add(head);

  // Vestigial wings stay small beside the long ribbon body. Cream closed
  // panels remain visible from below; sky-blue leading spars clarify the pair
  // and give the generic wing animator sturdy pivots to flap.
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(0.18 + sx * 0.1, 1.35, -0.08);
    wing.rotation.y = sx * -0.12;
    const panel = facetedPanel([
      [0, 0],
      [sx * 0.13, 0.18],
      [sx * 0.38, 0.11],
      [sx * 0.23, -0.055],
    ], cream, 0.04);
    panel.rotation.x = -0.16;
    wing.add(panel);
    wing.add(segmentedHorn([
      [0, 0, 0.015],
      [sx * 0.14, 0.18, 0.015],
      [sx * 0.38, 0.11, 0.015],
    ], 0.032, 0.011, skyShade, {}, 5));
    wings.push(wing);
    g.add(wing);
  }

  // Only the concept's visible foreclaws are modelled. They hang clear of the
  // belly shields, read cleanly from below, and keep the baked model at seven
  // meshes rather than spending four animation roots on vestigial feet.
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const leg = new THREE.Group();
    leg.position.set(-0.25 + sx * 0.13, 1.16, 0.1);
    leg.add(segmentedHorn([
      [0, 0, 0],
      [sx * 0.025, -0.14, 0.055],
      [sx * 0.085, -0.23, 0.13],
    ], 0.046, 0.023, skyShade, {}, 5));
    const paw = blob(0.055, cloud);
    paw.scale.set(0.9, 0.56, 1.12);
    paw.position.set(sx * 0.085, -0.245, 0.145);
    leg.add(paw);
    for (const tx of [-0.025, 0.025]) {
      const claw = cone(0.011, 0.055, cream, 4);
      claw.rotation.x = Math.PI / 2 - 0.15;
      claw.position.set(sx * 0.085 + tx, -0.26, 0.195);
      leg.add(claw);
    }
    legs.push(leg);
    g.add(leg);
  }

  // The independent tail continues the body's rising stroke into a broad C
  // and then tapers far downward. This is the main long-and-lanky payoff.
  const tail = new THREE.Group();
  tail.position.set(0.39, 1.3, -0.13);
  const tailPath: ReadonlyArray<RibbonPoint> = [
    [0, 0, 0],
    [0.13, 0.18, -0.05],
    [0.3, 0.29, -0.12],
    [0.48, 0.28, -0.2],
    [0.62, 0.15, -0.29],
    [0.68, -0.05, -0.38],
    [0.63, -0.28, -0.46],
    [0.51, -0.48, -0.55],
    [0.38, -0.66, -0.64],
  ];
  addCapsuleChain(tail, tailPath, [0.17, 0.16, 0.145, 0.13, 0.115, 0.095, 0.077, 0.06, 0.043], 6);
  for (const i of [2, 5]) {
    const [x, y, z] = tailPath[i]!;
    const ridge = cone(0.034 - i * 0.002, 0.12, cloud, 4);
    ridge.position.set(x, y + 0.13, z - 0.045);
    ridge.rotation.z = -0.25 - i * 0.06;
    tail.add(ridge);
  }
  const tip = tailPath[tailPath.length - 1]!;
  for (const sx of [-1, 1]) {
    const streamer = cone(0.034, 0.14, cream, 4);
    streamer.position.set(tip[0] + sx * 0.035, tip[1] - 0.04, tip[2]);
    streamer.rotation.z = sx * 0.65;
    streamer.rotation.x = -0.25;
    tail.add(streamer);
  }
  g.add(tail);

  return { group: g, parts: { legs, wings, head, body, tail } };
}

/** Shardwing — faceted moth figurine carrying two pairs of crystal wings. */
function buildShardwing(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0x7652b8, rng, 0.08);
  const furDark = jitterColor(0x392a72, rng, 0.06);
  const cream = jitterColor(0xf5d7f0, rng, 0.04);
  const foreC = jitterColor(0x68e2ed, rng, 0.09);
  const hindC = jitterColor(0xd98cf2, rng, 0.09);
  const glow = jitterColor(0xf4ffb8, rng, 0.03);

  const body = new THREE.Group();
  body.position.set(0, 0.43, -0.04);
  const thorax = chunk(0.31, fur, [0.82, 1.15, 0.78]);
  body.add(thorax);
  const belly = chunk(0.22, cream, [0.76, 1.05, 0.32], 0);
  belly.position.set(0, -0.02, 0.26);
  body.add(belly);
  // Three coarse ruff shards bridge the head and thorax.
  for (const sx of [-1, 0, 1]) {
    const ruff = blob(0.085, cream);
    ruff.position.set(sx * 0.09, 0.27 - Math.abs(sx) * 0.025, 0.05);
    body.add(ruff);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.82, 0.18);
  const skull = chunk(0.28, furDark, [1.08, 0.92, 0.9]);
  head.add(skull);
  for (const e of eyePair(0.14, 0.035, 0.24, 0.132, { iris: 0x17131f, irisR: 0.72 }, 0.065)) {
    head.add(e);
  }
  const smileM = smile(0.045, 0.01, 0x281c40);
  smileM.position.set(0, -0.12, 0.32);
  head.add(smileM);
  // Hooked feelers curl back toward their own stems.
  for (const sx of [-1, 1] as const) {
    head.add(
      segmentedHorn(
        [
          [sx * 0.05, 0.2, 0.01],
          [sx * 0.12, 0.36, 0.06],
          [sx * 0.25, 0.43, 0.13],
          [sx * 0.31, 0.34, 0.2],
          [sx * 0.22, 0.27, 0.23],
        ],
        0.022,
        0.012,
        furDark,
        {},
        5,
      ),
    );
    const tip = blob(0.035, glow, { emissive: glow, emissiveIntensity: 0.5 });
    tip.position.set(sx * 0.215, 0.265, 0.24);
    head.add(tip);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  const spotRoll = rng();
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.08, 0.62, -0.06);

    const fore = crystal(0.43, foreC, { opacity: 0.7, emissive: foreC, emissiveIntensity: 0.28 });
    fore.scale.set(0.82, 1.35, 0.14);
    fore.position.set(sx * 0.38, 0.2, 0.02);
    fore.rotation.z = sx * -0.28;
    wing.add(fore);

    const hind = crystal(0.37, hindC, { opacity: 0.7, emissive: hindC, emissiveIntensity: 0.24 });
    hind.scale.set(0.88, 0.95, 0.15);
    hind.position.set(sx * 0.36, -0.24, -0.1);
    hind.rotation.z = sx * 0.3;
    wing.add(hind);
    const knot = crystal(0.075, glow, { emissive: glow, emissiveIntensity: 0.7 });
    knot.position.set(sx * 0.3, 0.02, 0.03);
    wing.add(knot);
    if (spotRoll < 0.42 && sx === -1) {
      const tiny = crystal(0.042, 0xffffff, { emissive: glow, emissiveIntensity: 0.35 });
      tiny.position.set(sx * 0.52, 0.24, 0.04);
      wing.add(tiny);
    }
    wings.push(wing);
    g.add(wing);
  }

  // Six static thread-feet remain loose details; `parts.legs` intentionally
  // stays empty, matching the existing flight-animation contract.
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const z = 0.16 - i * 0.16;
    for (const sx of [-1, 1] as const) {
      const l = legGroup(sx * 0.08, 0.2, z, 0.012, 0.011, 0.2, furDark, sx * 0.48);
      g.add(l);
    }
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/** Nectar Wisp — upright striped bumble figurine with a heart nose. */
function buildNectarWisp(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const amber = jitterColor(0xf5b82e, rng, 0.05);
  const amberLight = jitterColor(0xffdf65, rng, 0.04);
  const dark = jitterColor(0x4c354d, rng, 0.03);
  const wingC = jitterColor(0xbdeeff, rng, 0.04);
  const cream = jitterColor(0xffedc8, rng, 0.025);
  const heartC = jitterColor(0xe96f91, rng, 0.04);

  const body = new THREE.Group();
  body.position.set(0, 0.42, -0.03);
  const abdomen = chunk(0.34, amber, [0.88, 1.12, 0.82]);
  body.add(abdomen);
  for (const y of [-0.12, 0.12]) {
    const band = chunk(0.29, dark, [0.98, 0.3, 0.92], 0);
    band.position.y = y;
    body.add(band);
  }
  const lantern = blob(0.075, amberLight, { emissive: amber, emissiveIntensity: 0.65 });
  lantern.position.set(0, -0.35, -0.02);
  body.add(lantern);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.83, 0.13);
  const skull = chunk(0.31, amberLight, [1.06, 0.94, 0.92]);
  head.add(skull);
  const mask = cyl(0.08, 0.13, 0.12, cream, 4);
  mask.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  mask.scale.set(1.5, 1, 0.55);
  mask.position.set(0, -0.13, 0.29);
  head.add(mask);
  for (const e of eyePair(0.15, 0.045, 0.27, 0.13, { sclera: 0x17131b, iris: 0x09070a, irisR: 0.74 }, 0.055)) {
    head.add(e);
  }
  // Two lobes plus a tiny downward point make a readable heart-shaped nose.
  for (const sx of [-1, 1]) {
    const lobe = blob(0.04, heartC);
    lobe.position.set(sx * 0.032, -0.1, 0.38);
    head.add(lobe);
  }
  const heartTip = cone(0.045, 0.075, heartC, 7);
  heartTip.rotation.z = Math.PI;
  heartTip.position.set(0, -0.145, 0.38);
  head.add(heartTip);
  const mouth = smile(0.05, 0.011, dark, 1.65);
  mouth.position.set(0, -0.21, 0.4);
  head.add(mouth);
  for (const sx of [-1, 1] as const) {
    head.add(
      segmentedHorn(
        [
          [sx * 0.065, 0.2, 0.01],
          [sx * 0.12, 0.35, 0.04],
          [sx * 0.2, 0.45, 0.1],
        ],
        0.022,
        0.012,
        dark,
        {},
        5,
      ),
    );
    const bobble = blob(0.04, heartC);
    bobble.position.set(sx * 0.2, 0.45, 0.11);
    head.add(bobble);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.24, 0.55, -0.08);
    const stub = chunk(0.19, wingC, [0.68, 1.12, 0.18], 0, { opacity: 0.62 });
    stub.position.set(sx * 0.12, 0.03, -0.04);
    stub.rotation.z = sx * -0.55;
    wing.add(stub);
    wings.push(wing);
    g.add(wing);
  }

  // Static thread legs keep the established empty `parts.legs` flight shape.
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const z = 0.14 - i * 0.14;
    for (const sx of [-1, 1] as const) {
      const l = legGroup(sx * 0.13, 0.18, z, 0.022, 0.017, 0.18, dark, sx * 0.42);
      g.add(l);
    }
  }
  const pollenRoll = rng();
  if (pollenRoll < 0.38) {
    const mote = blob(0.045, cream, { emissive: amber, emissiveIntensity: 0.4 });
    mote.position.set(0.27, 0.3, 0.2);
    g.add(mote);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/** Emberpup — huge-eared fox figurine with glowing tips and a flame tail. */
function buildEmberpup(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe15f32, rng, 0.045);
  const coatDark = jitterColor(0x9d3829, rng, 0.04);
  const cream = jitterColor(0xffdaa0, rng, 0.04);
  const blushC = jitterColor(0xf18b86, rng, 0.03);
  const ember = 0xff7a2a;

  const body = new THREE.Group();
  body.position.y = 0.39;
  const torso = chunk(0.32, coat, [0.74, 0.96, 0.9]);
  body.add(torso);
  const chest = chunk(0.2, cream, [0.74, 1.22, 0.32], 0);
  chest.position.set(0, -0.01, 0.29);
  body.add(chest);
  for (const sx of [-1, 1]) {
    const haunch = chunk(0.2, coatDark, [1.12, 0.78, 1.04], 0);
    haunch.position.set(sx * 0.22, -0.18, -0.08);
    body.add(haunch);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.79, 0.19);
  const skull = chunk(0.34, coat, [1.04, 0.94, 0.9]);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const cheek = chunk(0.13, cream, [1.0, 0.82, 0.65], 0);
    cheek.position.set(sx * 0.17, -0.11, 0.24);
    head.add(cheek);
    const b = blush(0.065, blushC);
    b.position.set(sx * 0.25, -0.05, 0.29);
    b.rotation.y = sx * 0.5;
    head.add(b);
  }
  const snout = cyl(0.08, 0.12, 0.14, cream, 4);
  snout.rotation.set(Math.PI / 2 - 0.06, Math.PI / 4, 0);
  snout.scale.set(1.15, 1, 0.62);
  snout.position.set(0, -0.12, 0.33);
  head.add(snout);
  const nose = blob(0.042, 0x2a1c14);
  nose.position.set(0, -0.07, 0.44);
  head.add(nose);
  const mouth = smile(0.04, 0.01);
  mouth.position.set(0, -0.17, 0.43);
  head.add(mouth);
  for (const [i, e] of eyePair(0.16, 0.075, 0.29, 0.14, { iris: 0x235747, irisR: 0.7 }, 0.055).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.86;
    e.rotation.z = sx * -0.08;
    head.add(e);
    const brow = cyl(0.012, 0.02, 0.12, coatDark, 5);
    brow.rotation.z = sx * -1.38;
    brow.position.set(sx * 0.16, 0.2, 0.37);
    head.add(brow);
  }

  // Four-sided outer cones and inset coarse shards form the tall fox ears.
  const notchRoll = rng();
  for (const sx of [-1, 1] as const) {
    const short = notchRoll < 0.3 && sx === -1;
    const ear = cone(0.17, short ? 0.42 : 0.55, coat, 4);
    ear.scale.z = 0.55;
    ear.position.set(sx * 0.23, short ? 0.31 : 0.38, -0.015);
    ear.rotation.z = sx * -0.26;
    head.add(ear);
    const inner = chunk(0.11, blushC, [0.58, short ? 1.25 : 1.58, 0.2], 0);
    inner.position.set(sx * 0.23, short ? 0.31 : 0.38, 0.07);
    inner.rotation.z = sx * -0.26;
    head.add(inner);
    const tip = blob(0.04, 0xffb060, { emissive: ember, emissiveIntensity: 1.0 });
    tip.position.set(sx * (short ? 0.28 : 0.31), short ? 0.49 : 0.64, -0.02);
    head.add(tip);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const front = sz > 0;
    const l = legGroup(
      sx * (front ? 0.17 : 0.2),
      front ? 0.3 : 0.2,
      front ? 0.17 : -0.08,
      front ? 0.055 : 0.08,
      front ? 0.075 : 0.1,
      front ? 0.3 : 0.2,
      coatDark,
      sx * (front ? 0.08 : 0.18),
    );
    legs.push(l);
    g.add(l);
  }

  // A forked low-poly flame plume, both tips sharing one emissive class.
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.27);
  const plume = cone(0.17, 0.48, coat, 5);
  plume.rotation.x = -0.72;
  plume.position.set(0, 0.1, -0.18);
  tail.add(plume);
  for (const sx of [-1, 1]) {
    const lick = cone(0.075, 0.26, cream, 4);
    lick.rotation.set(-0.65, 0, sx * -0.38);
    lick.position.set(sx * 0.065, 0.24, -0.33);
    tail.add(lick);
    const ttip = blob(0.065, 0xffb060, { emissive: ember, emissiveIntensity: 0.82 });
    ttip.position.set(sx * 0.09, 0.34, -0.43);
    tail.add(ttip);
  }
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/** Lumenstag — slim pearl stag figurine with luminous branch antlers. */
function buildLumenstag(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe9e7ff, rng, 0.025, 0.05);
  const shade = jitterColor(0xaeb9dc, rng, 0.035, 0.04);
  const cream = jitterColor(0xfff0d2, rng, 0.025);
  const glow = 0x9be8ff;

  const body = new THREE.Group();
  body.position.y = 1.22;
  const barrel = chunk(0.39, coat, [0.6, 0.68, 1.46]);
  body.add(barrel);
  const bel = chunk(0.25, cream, [0.64, 0.4, 1.32], 0);
  bel.position.set(0, -0.25, 0.08);
  body.add(bel);
  const chest = chunk(0.24, shade, [0.82, 1.12, 0.72], 0);
  chest.position.set(0, 0.13, 0.43);
  body.add(chest);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.49, 0.59);
  const neck = cyl(0.09, 0.14, 0.68, coat, 5);
  neck.rotation.x = -0.38;
  neck.position.set(0, 0.04, -0.03);
  head.add(neck);
  const skull = chunk(0.27, shade, [0.98, 1.02, 1.08]);
  skull.position.set(0, 0.42, 0.31);
  head.add(skull);
  const muzzle = cyl(0.07, 0.11, 0.14, cream, 4);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.05, 1, 0.64);
  muzzle.position.set(0, 0.3, 0.54);
  head.add(muzzle);
  for (const [i, e] of eyePair(0.14, 0.47, 0.555, 0.12, { iris: 0x45647c, irisR: 0.66 }, 0.065).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.64;
    e.rotation.z = sx * 0.045;
    head.add(e);
  }
  const nose = blob(0.037, 0x566078);
  nose.position.set(0, 0.3, 0.66);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const ear = chunk(0.1, cream, [1.15, 0.56, 0.32], 0);
    ear.position.set(sx * 0.2, 0.58, 0.18);
    ear.rotation.z = sx * -0.1;
    head.add(ear);
  }

  const glowOpts: MatOpts = { emissive: glow, emissiveIntensity: 1.4 };
  for (const sx of [-1, 1] as const) {
    head.add(segmentedHorn([
      [sx * 0.1, 0.55, 0.18],
      [sx * 0.16, 0.79, 0.15],
      [sx * 0.24, 1.02, 0.12],
      [sx * 0.35, 1.2, 0.08],
    ], 0.045, 0.02, glow, glowOpts, 6));
    for (const [x, y, rot] of [
      [0.18, 0.81, 0.9],
      [0.25, 1.03, 1.05],
      [0.34, 1.19, 1.2],
    ] as const) {
      const tine = cyl(0.016, 0.025, 0.22, glow, 5, glowOpts);
      tine.position.set(sx * x, y, 0.13);
      tine.rotation.z = sx * rot;
      head.add(tine);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const legLen = 1.02;
    const l = legGroup(sx * 0.16, legLen, sz * 0.43, 0.042, 0.058, legLen, shade);
    // Keep each animated leg to one baked draw: the slim leg and brighter hoof
    // share the same low cyan emissive class, with vertex colour separating them.
    const hoofGlow: MatOpts = { emissive: glow, emissiveIntensity: 1.05 };
    (l.children[0] as THREE.Mesh).material = mat(shade, hoofGlow);
    const hoof = chunk(0.085, glow, [0.78, 0.58, 1.05], 0, hoofGlow);
    hoof.position.set(0, -legLen + 0.035, 0.025);
    l.add(hoof);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.32, -0.62);
  const tm = cyl(0.045, 0.075, 0.28, cream, 5);
  tm.rotation.x = Math.PI / 2 - 0.3;
  tm.position.z = -0.13;
  tail.add(tm);
  g.add(tail);

  const wRoll = rng();
  if (wRoll < 0.3) {
    const mote = blob(0.03, 0xdff6ff, { emissive: glow, emissiveIntensity: 1.6 });
    mote.position.set(0.4, 2.45, 0.55);
    g.add(mote);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

// --- Haven Village whimsy pass (+4) ------------------------------------------

/**
 * Prismhorse — the 16-legged translucent crystal mount, rebuilt as a broad-
 * faceted horse figurine. All ride and spring handles stay exact.
 */
function buildPrismhorse(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const tint = jitterColor(0xcfe8ff, rng, 0.05, 0.04);
  const deep = jitterColor(0x9b9ff5, rng, 0.06, 0.04);
  const maneC = jitterColor(0xd99df4, rng, 0.07, 0.04);
  const ice = jitterColor(0xe5f6ff, rng, 0.04, 0.03);
  const glow = 0xb6d8ff;
  const crys: MatOpts = { opacity: 0.84, emissive: glow, emissiveIntensity: 0.42 };
  const legCrys: MatOpts = { opacity: 0.8, emissive: glow, emissiveIntensity: 0.7, flat: true };

  const bodyY = 1.35;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const core = chunk(0.62, tint, [0.78, 0.68, 1.42], 1, crys);
  body.add(core);
  const chest = chunk(0.47, deep, [0.72, 0.8, 0.78], 0, crys);
  chest.position.set(0, 0.02, 0.56);
  body.add(chest);
  const rump = chunk(0.47, deep, [0.72, 0.8, 0.78], 0, crys);
  rump.position.set(0, 0.02, -0.58);
  body.add(rump);
  for (const [sx, z] of [[-1, 0.42], [1, 0.42], [-1, -0.46], [1, -0.46]] as const) {
    const mass = chunk(0.3, deep, [0.82, 0.9, 0.72], 0, crys);
    mass.position.set(sx * 0.31, -0.05, z);
    body.add(mass);
  }
  // A short saddle-safe dorsal crest leads the eye toward the real neck mane.
  for (const [sz, len] of [[0.34, 0.28], [0.1, 0.34], [-0.16, 0.29]] as const) {
    const sh = crystal(len, maneC, crys);
    sh.scale.set(0.28, 1, 0.24);
    sh.position.set((rng() - 0.5) * 0.06, 0.33 + len * 0.35, sz);
    sh.rotation.z = (rng() - 0.5) * 0.18;
    body.add(sh);
  }
  g.add(body);

  // Defined head: long planar neck, large skull, chamfered muzzle, prism ears.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.05, 0.82);
  const neck = chunk(0.39, deep, [0.5, 1.35, 0.58], 0, crys);
  neck.rotation.x = -0.36;
  neck.position.set(0, 0.18, 0.02);
  head.add(neck);
  const skull = chunk(0.37, tint, [0.98, 0.9, 1.04], 1, crys);
  skull.position.set(0, 0.56, 0.4);
  head.add(skull);
  const muzzle = cyl(0.13, 0.2, 0.25, deep, 4, crys);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.08, 1, 0.65);
  muzzle.position.set(0, 0.43, 0.72);
  head.add(muzzle);
  for (const e of eyePair(0.15, 0.6, 0.75, 0.115, { sclera: 0xf7fbff, iris: 0x315b88, irisR: 0.64 }, 0.06)) {
    e.scale.y = 0.9;
    head.add(e);
  }
  const smileM = smile(0.07, 0.013, 0x385076);
  smileM.position.set(0, 0.35, 0.91);
  head.add(smileM);
  for (const sx of [-1, 1] as const) {
    const ear = cone(0.14, 0.38, maneC, 4, crys);
    ear.scale.z = 0.55;
    ear.position.set(sx * 0.19, 0.86, 0.31);
    ear.rotation.z = sx * -0.25;
    head.add(ear);
  }
  // Crystal mane spikes step down the back of the neck, not over the saddle.
  for (const [yy, zz, size] of [
    [0.78, 0.16, 0.22],
    [0.58, 0.02, 0.25],
    [0.36, -0.09, 0.22],
    [0.16, -0.15, 0.18],
  ] as const) {
    const mane = crystal(size, maneC, crys);
    mane.scale.set(0.3, 1, 0.32);
    mane.position.set(0, yy, zz);
    mane.rotation.x = -0.18;
    head.add(mane);
  }

  // Two long legacy spring handles remain, now styled as crystal feelers.
  const antennae: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const a = new THREE.Group();
    a.position.set(sx * 0.12, 0.77, 0.42);
    const stalk = cyl(0.016, 0.027, 0.36, deep, 5, legCrys);
    stalk.position.y = 0.18;
    a.add(stalk);
    const bob = crystal(0.075, ice, legCrys);
    bob.position.y = 0.39;
    a.add(bob);
    a.rotation.x = -0.72;
    a.rotation.z = sx * -0.28;
    head.add(a);
    antennae.push(a);
  }
  g.add(head);

  // Sixteen handles stay in [left×8, right×8] order for the travelling wave.
  const legs: THREE.Object3D[] = [];
  const legLen = bodyY - 0.05;
  const zs = [0.66, 0.47, 0.28, 0.09, -0.1, -0.29, -0.48, -0.67];
  for (const sx of [-1, 1]) {
    for (const z of zs) {
      const l = legGroup(sx * 0.36, legLen, z, 0.03, 0.05, legLen, ice, sx * 0.22);
      const m = l.children[0] as THREE.Mesh;
      m.material = mat(ice, legCrys);
      legs.push(l);
      g.add(l);
    }
  }

  const tail = new THREE.Group();
  tail.position.set(0, bodyY, -0.78);
  for (const sx of [-1, 1]) {
    const tm = chunk(0.3, sx < 0 ? tint : maneC, [0.34, 0.42, 1.25], 0, crys);
    tm.position.set(sx * 0.09, sx * 0.05, -0.23);
    tm.rotation.z = sx * 0.22;
    tail.add(tm);
  }
  g.add(tail);

  return { group: g, parts: { legs, head, body, tail, antennae } };
}

/** Bumblewhale — faceted sky-blue whale blimp with fins and cloud blowhole. */
function buildBumblewhale(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const top = jitterColor(0x67b8e8, rng, 0.05);
  const topDark = jitterColor(0x397cae, rng, 0.04);
  const belly = jitterColor(0xe9f4e8, rng, 0.03);
  const blushC = jitterColor(0xf4a4b5, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 1.0;
  const hull = chunk(0.94, top, [0.88, 0.73, 1.25]);
  body.add(hull);
  const under = chunk(0.86, belly, [0.78, 0.4, 1.17], 1);
  under.position.set(0, -0.38, 0.08);
  body.add(under);
  // Two inset belly planes preserve the old banded identity without wrapping
  // the figurine in smooth torus hoops.
  for (const [y, z, scale] of [[-0.25, 0.48, 1], [-0.42, 0.72, 0.78]] as const) {
    const band = chunk(0.48, belly, [scale, 0.2, 0.32], 0);
    band.position.set(0, y, z);
    body.add(band);
  }
  for (const sx of [-1, 1]) {
    const fluke = chunk(0.32, topDark, [1.25, 0.34, 0.75], 0);
    fluke.position.set(sx * 0.35, 0.08, -1.28);
    fluke.rotation.y = sx * -0.4;
    body.add(fluke);
  }
  // Blowhole and a three-blob cloud puff are permanently visible from above.
  const hole = chunk(0.09, topDark, [1.35, 0.28, 0.75], 0);
  hole.position.set(0, 0.72, 0.3);
  body.add(hole);
  for (const [x, y, r] of [[0, 0.85, 0.13], [-0.11, 0.97, 0.1], [0.11, 0.99, 0.105]] as const) {
    const puff = chunk(r, belly, [1, 1, 1], 0);
    puff.position.set(x, y, 0.3);
    body.add(puff);
  }
  if (rng() < 0.35) {
    const puff = blob(0.07, belly);
    puff.position.set(0.2, 1.08, 0.31);
    body.add(puff);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.02, 1.08);
  for (const e of eyePair(0.27, 0.18, 0.34, 0.23, { iris: 0x1d4f78, irisR: 0.66 }, 0.04)) {
    head.add(e);
  }
  const mouth = smile(0.27, 0.038, 0x23485e, 1.75);
  mouth.position.set(0, -0.12, 0.42);
  head.add(mouth);
  const snout = cyl(0.12, 0.19, 0.18, top, 4);
  snout.rotation.set(Math.PI / 2 - 0.05, Math.PI / 4, 0);
  snout.scale.set(1.3, 1, 0.58);
  snout.position.set(0, -0.03, 0.35);
  head.add(snout);
  for (const sx of [-1, 1]) {
    const cheek = blush(0.11, blushC);
    cheek.position.set(sx * 0.5, -0.07, 0.25);
    cheek.rotation.y = sx * 0.45;
    head.add(cheek);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.76, 0.98, 0.15);
    const fin = chunk(0.22, topDark, [1.2, 0.34, 0.78], 0);
    fin.position.x = sx * 0.16;
    fin.rotation.y = sx * -0.3;
    w.add(fin);
    wings.push(w);
    g.add(w);
  }

  return { group: g, parts: { legs: [], wings, head, body } };
}

/**
 * Snickerdoodle — faceted cookie-dough pancake flopper with puppy face,
 * floppy spaniel ears, chocolate chips, and tongue.
 */
function buildSnickerdoodle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const dough = jitterColor(0xdca76a, rng, 0.05);
  const doughDark = jitterColor(0xaa6b3e, rng, 0.04);
  const cream = jitterColor(0xffdfad, rng, 0.035);
  const speck = jitterColor(0x65351f, rng, 0.05);
  const tongueC = jitterColor(0xf58da8, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.18;
  const disc = chunk(0.5, dough, [1.5, 0.34, 1.08]);
  body.add(disc);
  const spots: ReadonlyArray<readonly [number, number]> = [
    [-0.3, 0.16], [0.28, -0.1], [0.05, 0.2], [-0.12, -0.2], [0.36, 0.14], [-0.36, -0.08],
  ];
  for (const [sx, sz] of spots) {
    const sp = blob(0.05, speck);
    sp.scale.set(1.1, 0.55, 1);
    sp.position.set(sx, 0.165, sz);
    body.add(sp);
  }

  // Huge floppy dog ears hang off the front corners, giving the flat body a
  // puppy silhouette from above and from the turntable's three-quarter view.
  for (const sx of [-1, 1]) {
    const ear = chunk(0.18, doughDark, [0.85, 1.35, 0.36], 0);
    ear.position.set(sx * 0.5, 0.02, 0.3);
    ear.rotation.z = sx * -0.72;
    ear.rotation.x = -0.25;
    body.add(ear);
    const inner = chunk(0.11, cream, [0.7, 1.25, 0.22], 0);
    inner.position.set(sx * 0.5, 0.045, 0.36);
    inner.rotation.z = sx * -0.72;
    body.add(inner);
  }
  const tail = cyl(0.035, 0.07, 0.34, doughDark, 5);
  tail.rotation.x = Math.PI / 2 - 0.4;
  tail.position.set(0.25, 0.05, -0.5);
  tail.rotation.z = -0.5;
  body.add(tail);

  // Face sits proud of the 0.54-deep pancake edge.
  for (const e of eyePair(0.16, 0.075, 0.53, 0.105, { iris: 0x4b2d22, irisR: 0.68 }, 0.06)) {
    body.add(e);
  }
  for (const sx of [-1, 1]) {
    const muzzle = chunk(0.11, cream, [1.05, 0.65, 0.5], 0);
    muzzle.position.set(sx * 0.07, -0.02, 0.58);
    body.add(muzzle);
  }
  const nose = chunk(0.048, speck, [1.25, 0.72, 0.55], 0);
  nose.position.set(0, 0.0, 0.66);
  body.add(nose);
  const mouth = smile(0.055, 0.011, speck);
  mouth.position.set(0, -0.07, 0.64);
  body.add(mouth);
  const tongue = cyl(0.035, 0.042, 0.09, tongueC, 5);
  tongue.position.set(0, -0.125, 0.66);
  body.add(tongue);
  g.add(body);

  if (rng() < 0.4) {
    const bite = blob(0.05, speck);
    bite.position.set(0.51, 0.15, -0.18);
    body.add(bite);
  }

  // Preserve the exact legacy alias: the bespoke flopper anim rotates `body`.
  return { group: g, parts: { legs: [], head: body, body } };
}

/** Gloomgobbler — near-spherical shadow figurine with lantern eyes and wisps. */
function buildGloomgobbler(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shadow = jitterColor(0x2d2349, rng, 0.04, 0.05);
  const shadowLight = jitterColor(0x49376d, rng, 0.04, 0.05);
  const legc = jitterColor(0x1b1529, rng, 0.02, 0.04);
  const lantern = 0xffd24a;

  const bodyY = 0.52;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const ball = chunk(0.52, shadow, [1.06, 1, 1], 1);
  body.add(ball);
  for (const sx of [-1, 1]) {
    const lobe = chunk(0.2, shadowLight, [0.82, 0.7, 0.9], 0);
    lobe.position.set(sx * 0.41, -0.16, -0.08);
    body.add(lobe);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.02, 0.39);
  for (const e of eyePair(0.205, 0.07, 0.08, 0.2, {
    sclera: 0x100c18,
    iris: lantern,
    irisEmissive: lantern,
    irisEmissiveIntensity: 1.8,
    irisR: 0.36,
  }, 0.03)) {
    head.add(e);
  }
  const mouth = smile(0.07, 0.014, 0x110d19, 1.7);
  mouth.position.set(0, -0.18, 0.17);
  head.add(mouth);
  g.add(head);

  // Keep the two animated handles, but turn the old stilts into tiny nubs.
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.18, 0.16, 0.02, 0.07, 0.1, 0.16, legc);
    legs.push(l);
    g.add(l);
  }

  // A hooked question-mark cowlick and side wisp match the concept silhouette.
  const cowlick = segmentedHorn([
    [0, 0, 0], [0.02, 0.16, 0], [0.13, 0.25, 0], [0.2, 0.19, 0], [0.14, 0.1, 0],
  ], 0.055, 0.025, shadowLight, {}, 5);
  cowlick.position.set(-0.04, 0.98, -0.04);
  g.add(cowlick);
  const sideWisp = segmentedHorn([
    [0, 0, 0], [-0.13, 0.02, 0], [-0.2, 0.1, 0],
  ], 0.04, 0.018, shadowLight, {}, 5);
  sideWisp.position.set(-0.43, 0.45, -0.06);
  g.add(sideWisp);
  if (rng() < 0.35) {
    const curl = blob(0.055, shadowLight, { flat: true });
    curl.position.set(0.18, 1.09, -0.02);
    g.add(curl);
  }

  return { group: g, parts: { legs, head, body } };
}

/** Timberchomp — upright faceted beaver with billboard teeth and paddle tail. */
function buildTimberchomp(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0x936036, rng, 0.04);
  const coatDark = jitterColor(0x57341f, rng, 0.04);
  const cream = jitterColor(0xf0cc91, rng, 0.04);
  const toothC = 0xfff1cf;

  const body = new THREE.Group();
  body.position.y = 0.45;
  const torso = chunk(0.37, coat, [0.9, 1.12, 0.86]);
  body.add(torso);
  const belly = chunk(0.24, cream, [0.8, 1.1, 0.34], 0);
  belly.position.set(0, -0.02, 0.31);
  body.add(belly);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.83, 0.19);
  const skull = chunk(0.34, coat, [1.06, 0.94, 0.9]);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const muzzle = chunk(0.13, cream, [1, 0.76, 0.72], 0);
    muzzle.position.set(sx * 0.085, -0.1, 0.27);
    head.add(muzzle);
  }
  for (const e of eyePair(0.165, 0.075, 0.3, 0.14, { iris: 0x453022, irisR: 0.7 }, 0.055)) {
    head.add(e);
  }
  const nose = blob(0.05, coatDark);
  nose.position.set(0, -0.04, 0.43);
  head.add(nose);
  const mouth = smile(0.055, 0.011, coatDark);
  mouth.position.set(0, -0.15, 0.42);
  head.add(mouth);
  // The incisors are intentionally absurd: visible even before the face is.
  for (const sx of [-1, 1]) {
    const tooth = box(0.055, 0.135, 0.035, toothC);
    tooth.position.set(sx * 0.045, -0.22, 0.44);
    tooth.rotation.z = sx * 0.04;
    head.add(tooth);
  }
  for (const sx of [-1, 1]) {
    const ear = chunk(0.09, coatDark, [1, 1, 0.5], 0);
    ear.position.set(sx * 0.27, 0.19, -0.01);
    head.add(ear);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const front = sz > 0;
    const l = legGroup(
      sx * (front ? 0.29 : 0.2),
      front ? 0.62 : 0.22,
      front ? 0.16 : -0.06,
      front ? 0.05 : 0.08,
      front ? 0.07 : 0.105,
      front ? 0.25 : 0.22,
      coatDark,
      sx * (front ? 0.32 : 0.1),
    );
    legs.push(l);
    g.add(l);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.32, -0.35);
  const paddle = chunk(0.31, coatDark, [0.3, 1.08, 1.32], 0);
  paddle.rotation.z = Math.PI / 2;
  paddle.rotation.x = 0.08;
  paddle.position.z = -0.2;
  tail.add(paddle);
  g.add(tail);

  if (rng() < 0.35) {
    const notch = blob(0.055, cream);
    notch.position.set(0.32, 0.03, -0.15);
    tail.add(notch);
  }

  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Pebbleshrew — a compact sandy rock-orb digger of the crags/highlands. Its
 * faceted shell carries irregular stone plates, tiny eyes, and digging claws.
 */
function buildPebbleshrew(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const sandy = jitterColor(0xc9a876, rng, 0.04);
  const sandyDark = jitterColor(0x8f7248, rng, 0.04);
  const clawC = jitterColor(0x5a4530, rng, 0.03);

  // Body: the concept's near-spherical armored mass.
  const body = new THREE.Group();
  body.position.y = 0.44;
  const torso = chunk(0.45, sandy, [1.1, 1, 1.02]);
  body.add(torso);
  // Irregular rock nubs wrap the crown and sides rather than forming a mohawk.
  const plateSpots: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0.45, 0.02, 0.11],
    [-0.25, 0.36, -0.06, 0.1], [0.25, 0.36, -0.06, 0.1],
    [-0.4, 0.12, -0.05, 0.085], [0.4, 0.12, -0.05, 0.085],
    [-0.39, -0.12, -0.08, 0.075], [0.39, -0.12, -0.08, 0.075],
    [0, 0.25, -0.39, 0.09], [0, -0.08, -0.44, 0.075],
  ];
  for (const [px, py, pz, pr] of plateSpots) {
    const plate = chunk(pr, sandyDark, [1, 0.86, 0.82], 0);
    plate.position.set(px, py, pz);
    body.add(plate);
  }
  g.add(body);

  // Face pieces sit directly on the orb; the head group remains the animation
  // pivot contract even though there is no separate plush skull volume.
  const head = new THREE.Group();
  head.position.set(0, 0.52, 0.4);
  for (const e of eyePair(0.14, 0.04, 0.05, 0.075, { sclera: 0x182033, iris: 0x111725, irisR: 0.7 }, 0.08)) {
    head.add(e);
  }
  const muzzle = cyl(0.07, 0.11, 0.11, sandy, 4);
  muzzle.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  muzzle.scale.set(1.25, 1, 0.55);
  muzzle.position.set(0, -0.06, 0.12);
  head.add(muzzle);
  const nose = blob(0.05, sandyDark);
  nose.position.set(0, -0.04, 0.2);
  head.add(nose);
  // Tiny stone-chip ears.
  for (const sx of [-1, 1]) {
    const ear = chunk(0.065, sandy, [1, 0.9, 0.5], 0);
    ear.position.set(sx * 0.3, 0.17, -0.08);
    head.add(ear);
  }
  g.add(head);

  // Stubby legs with digging-claw feet.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.27, 0.19, sz * 0.2, 0.06, 0.085, 0.19, sandyDark, sx * 0.18, clawC);
    legs.push(l);
    g.add(l);
  }

  const wRoll = rng();
  if (wRoll < 0.3) {
    // A weathered chipped back plate on some individuals.
    const chip = blob(0.035, sandyDark);
    chip.position.set(0.25, 0.82, -0.05);
    g.add(chip);
  }

  return { group: g, parts: { legs, head, body } };
}

// --- draw-call baking ---------------------------------------------------------
// Builders author critters as dozens of tiny primitive meshes (clear authoring,
// per-part cached materials). Rendering them that way costs a draw call per
// primitive (~20-30 per critter), which blew the e2e draw-call ceiling. So
// after building, `bakeCritterGroup` MERGES the static geometry inside every
// animatable part (each leg/wing/antenna group, head, body, tail, plus any
// loose root accents) into ONE mesh per material class, baking each source
// mesh's material colour into a vertex-colour attribute. Material classes are
// keyed by (shading-mode, emissive, intensity, opacity) — so the eyes merge
// into the head mesh (sclera/iris/highlight colours ride the vertex colours),
// while emissive glows (ember tips, lantern eyes, crystal) and translucency
// keep their own merged mesh per class ("emissives separate"). The merged
// meshes use a handful of cached vertexColors materials (one per class,
// game-wide) so the shared-material contract and disposal guards hold
// unchanged. Animation is untouched: it rotates the part GROUPS, and each
// group now contains 1-2 merged meshes instead of many primitives.

/** Cached vertexColors material for a bake class (colour rides the geometry). */
function bakedMat(flat: boolean, emissive: number, emissiveIntensity: number, opacity: number): THREE.Material {
  const key = `vc:${flat ? 'f' : 's'}:${emissive}:${emissiveIntensity}:${opacity}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const m = makeSurfaceMaterial({
    vertexColors: true,
    flatShading: flat,
    roughness: ROUGHNESS.critter,
    ...(emissive >= 0 ? { emissive, emissiveIntensity } : {}),
    ...(opacity >= 0 ? { opacity } : {}),
  });
  materialCache.set(key, m);
  sharedMaterials.add(m);
  return m;
}

/** The bake class of a source material: [key, flat, emissive, intensity, opacity]. */
function bakeClass(m: THREE.Material): { flat: boolean; emissive: number; emissiveIntensity: number; opacity: number } {
  const std = m as THREE.MeshStandardMaterial; // Lambert exposes the same fields we read
  const flat = std.flatShading === true;
  const emissiveHex = std.emissive ? std.emissive.getHex() : 0;
  const emissive = emissiveHex !== 0 ? emissiveHex : -1;
  const emissiveIntensity = emissive >= 0 ? std.emissiveIntensity : 1;
  const opacity = m.transparent ? m.opacity : -1;
  return { flat, emissive, emissiveIntensity, opacity };
}

/**
 * Merge every static mesh inside `root` (skipping subtrees rooted in `skip` —
 * other animatable parts) into one mesh per bake class, colours baked as
 * vertex colours. Source geometries are disposed; empty groups pruned.
 */
function bakeSubtree(
  root: THREE.Object3D,
  skip: ReadonlySet<THREE.Object3D>,
  buildSeed: number,
  jitterFlatFaces: boolean,
): void {
  const meshes: THREE.Mesh[] = [];
  (function walk(o: THREE.Object3D): void {
    for (const c of o.children) {
      if (skip.has(c)) continue;
      if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
      walk(c);
    }
  })(root);
  if (meshes.length === 0) return;

  // A face part contains both authored flat sculpture and glossy eyes. Keep it
  // to one opaque draw by carrying the sculpture's hard per-face normals into
  // a smooth material bucket; the eye sphere normals remain smooth. Parts
  // without eyes retain their explicit flat material class.
  const hasGlossyOpaque = meshes.some((mesh) => {
    const cls = bakeClass(mesh.material as THREE.Material);
    return !cls.flat && cls.emissive < 0 && cls.opacity < 0;
  });

  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { geos: THREE.BufferGeometry[]; cls: ReturnType<typeof bakeClass> }>();
  const color = new THREE.Color();
  for (const [meshIndex, mesh] of meshes.entries()) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const authoredCls = bakeClass(material);
    const cls = hasGlossyOpaque && authoredCls.emissive < 0 && authoredCls.opacity < 0
      ? { ...authoredCls, flat: false }
      : authoredCls;
    const key = `${cls.flat}:${cls.emissive}:${cls.emissiveIntensity}:${cls.opacity}`;
    // Non-indexed so mixed primitives (indexed spheres, non-indexed octahedra)
    // merge cleanly; drop uvs (untextured) so attribute sets always match.
    const src = mesh.geometry as THREE.BufferGeometry;
    const geo = src.index ? src.toNonIndexed() : src.clone();
    if (authoredCls.flat) geo.computeVertexNormals();
    geo.deleteAttribute('uv');
    const rel = new THREE.Matrix4().copy(rootInv).multiply(mesh.matrixWorld);
    geo.applyMatrix4(rel);
    // Bake the material colour into vertex colours (material goes white base).
    color.copy(material.color);
    const n = geo.getAttribute('position').count;
    if (jitterFlatFaces && authoredCls.flat && authoredCls.emissive < 0 && authoredCls.opacity < 0) {
      setFaceTintColors(geo, color, buildSeed, meshIndex);
    } else {
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { geos: [], cls }));
    bucket.geos.push(geo);
  }

  // Tear out the source meshes (their geometries are per-build: dispose).
  for (const mesh of meshes) {
    (mesh.geometry as THREE.BufferGeometry).dispose();
    mesh.removeFromParent();
  }
  // Prune now-empty container groups (eye groups, tuft groups, ...).
  (function prune(o: THREE.Object3D): void {
    for (const c of [...o.children]) {
      if (skip.has(c)) continue;
      prune(c);
      if (c.children.length === 0 && !(c as THREE.Mesh).isMesh) c.removeFromParent();
    }
  })(root);

  for (const { geos, cls } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    for (const geoSrc of geos) geoSrc.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bakedMat(cls.flat, cls.emissive, cls.emissiveIntensity, cls.opacity));
    root.add(mesh);
  }
}

/** Bake a built critter: one merge per animatable part + one for root accents. */
function bakeCritterGroup(group: THREE.Group, parts: CritterParts, buildSeed: number): void {
  group.updateMatrixWorld(true);
  const roots = new Set<THREE.Object3D>();
  roots.add(parts.body);
  roots.add(parts.head);
  if (parts.tail) roots.add(parts.tail);
  for (const l of parts.legs) roots.add(l);
  for (const w of parts.wings ?? []) roots.add(w);
  for (const a of parts.antennae ?? []) roots.add(a);
  for (const r of roots) {
    const skip = new Set(roots);
    skip.delete(r);
    bakeSubtree(r, skip, buildSeed, r === parts.body || r === parts.head);
  }
  // Loose root-level accents (tuft, cowlick, wisp, mote, ...) merge together.
  bakeSubtree(group, roots, buildSeed, false);
}

// --- Cursed Castle (+1) -------------------------------------------------------

/**
 * Gargoyle — a crouched stone statue that comes alive: perches
 * motionless on the castle towers (bold — sits stock-still until tagged),
 * then glides on folded bat wings. Stone-gray body + pointed brow-ear horns,
 * glowing amber lantern eyes, and arm-and-triangle bat membranes flap through
 * the generic `parts.wings` animation handles whenever it moves.
 */
function buildGargoyle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const stone = jitterColor(0x8a8894, rng, 0.02, 0.05);
  const stoneDark = jitterColor(0x5e5a66, rng, 0.02, 0.05);
  const clawC = jitterColor(0x3a3640, rng, 0.02, 0.04);
  const amber = 0xffab3c;

  const bodyY = 0.46;
  const body = new THREE.Group();
  body.position.y = bodyY;
  // Chiselled torso, chest plate, and separated crouched haunches.
  const torso = chunk(0.34, stone, [0.84, 1.0, 0.82]);
  body.add(torso);
  const chest = chunk(0.2, stoneDark, [0.75, 1.02, 0.34], 0);
  chest.position.set(0, -0.02, 0.28);
  body.add(chest);
  for (const sx of [-1, 1]) {
    const haunch = chunk(0.21, stoneDark, [1.0, 0.78, 0.95], 0);
    haunch.position.set(sx * 0.22, -0.2, -0.08);
    body.add(haunch);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.43, 0.18);
  head.rotation.x = -0.08;
  const skull = chunk(0.31, stone, [1.08, 0.94, 1.0]);
  head.add(skull);
  const brow = cyl(0.13, 0.18, 0.08, stoneDark, 5);
  brow.rotation.set(0.35, Math.PI / 5, 0);
  brow.scale.set(1.35, 1, 0.62);
  brow.position.set(0, 0.13, 0.19);
  head.add(brow);
  const muzzle = cyl(0.08, 0.13, 0.14, stone, 4);
  muzzle.rotation.set(Math.PI / 2 - 0.08, Math.PI / 4, 0);
  muzzle.scale.set(1.0, 1, 0.62);
  muzzle.position.set(0, -0.11, 0.3);
  head.add(muzzle);
  for (const e of eyePair(
    0.145,
    0.05,
    0.28,
    0.115,
    { sclera: 0xffd79a, scleraEmissive: amber, scleraEmissiveIntensity: 1.5, iris: 0x2a1608, irisR: 0.5 },
    0.14,
  )) {
    head.add(e);
  }
  const mouth = smile(0.06, 0.016, 0x241c22, 1.6);
  mouth.position.set(0, -0.21, 0.39);
  head.add(mouth);
  // Broad pointed brow horns double as the concept's bat-like ears.
  for (const sx of [-1, 1] as const) {
    const horn = cone(0.13, 0.42, stoneDark, 4);
    horn.scale.z = 0.55;
    horn.position.set(sx * 0.24, 0.27, -0.03);
    horn.rotation.z = sx * -0.5;
    horn.rotation.x = -0.2;
    head.add(horn);
  }
  g.add(head);

  // Arm strut plus two staggered triangular membranes per side: true bat wings
  // that remain folded enough for the castle-perch silhouette.
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const w = new THREE.Group();
    w.position.set(sx * 0.26, bodyY + 0.23, -0.05);
    w.rotation.z = sx * 0.12;
    const arm = cyl(0.025, 0.04, 0.42, stoneDark, 5);
    arm.rotation.z = sx * 1.92;
    arm.position.set(sx * 0.2, 0.1, 0);
    w.add(arm);
    const membrane = cone(0.3, 0.55, stoneDark, 3);
    membrane.scale.z = 0.12;
    membrane.rotation.z = sx * 1.95;
    membrane.position.set(sx * 0.38, 0.02, -0.02);
    w.add(membrane);
    const scallop = cone(0.2, 0.38, stoneDark, 3);
    scallop.scale.z = 0.12;
    scallop.rotation.z = sx * 2.4;
    scallop.position.set(sx * 0.39, -0.18, -0.03);
    w.add(scallop);
    wings.push(w);
    g.add(w);
  }

  // Two stout crouched legs with clawed feet (the perched squat).
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const l = legGroup(sx * 0.22, bodyY - 0.16, 0.12, 0.14, 0.17, 0.3, stoneDark, sx * 0.2, clawC);
    legs.push(l);
    g.add(l);
  }

  const wRoll = rng();
  if (wRoll < 0.3) {
    // A weathered chipped-stone accent on some individuals.
    const chip = blob(0.045, stoneDark);
    chip.position.set(0.22, bodyY + 0.1, 0.3);
    g.add(chip);
  }

  return { group: g, parts: { legs, wings, head, body } };
}


/** Cragdrake — the roster's hero model, reconstructed from Spencer's front
 * concept and side/back turnarounds. The high path-2 budget is spent on a
 * connected neck/skull silhouette, articulated bat-wing structure, sitting
 * haunch anatomy, a curved segmented tail, and individually modelled claws.
 * It remains fully procedural and preserves the legacy dive-animation parts. */
function buildCragdrake(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const F = { flat: true } as const;
  const scale = jitterColor(0x5f82a3, rng, 0.04, 0.05);
  const scaleLight = jitterColor(0x7399b6, rng, 0.035, 0.04);
  const scaleDark = jitterColor(0x3e5a76, rng, 0.03, 0.04);
  const belly = jitterColor(0xeadcae, rng, 0.03);
  const bellyShade = jitterColor(0xd7c28d, rng, 0.025, 0.035);
  const wingC = jitterColor(0x7456a2, rng, 0.04, 0.05);
  const wingLight = jitterColor(0x8d6cba, rng, 0.04, 0.05);
  const wingDark = jitterColor(0x49366f, rng, 0.03, 0.04);
  const tipC = 0xf2efe6;

  const mass = (
    r: number,
    color: number,
    scaleXYZ: readonly [number, number, number],
    detail: 0 | 1 | 2 = 1,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color, F));
    m.scale.set(...scaleXYZ);
    return m;
  };

  /** A thin closed polygon panel: visible from front/back, with a crisp rim. */
  const membranePanel = (
    points: ReadonlyArray<readonly [number, number]>,
    color: number,
    depth = 0.026,
  ): THREE.Mesh => {
    const ordered = points.map(([x, y]) => [x, y] as [number, number]);
    let signedArea = 0;
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i]!;
      const b = ordered[(i + 1) % ordered.length]!;
      signedArea += a[0] * b[1] - b[0] * a[1];
    }
    if (signedArea < 0) ordered.reverse();
    const n = ordered.length;
    const positions: number[] = [];
    for (const z of [depth / 2, -depth / 2]) {
      for (const [x, y] of ordered) positions.push(x, y, z);
    }
    const indices: number[] = [];
    for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
    for (let i = 1; i < n - 1; i++) indices.push(n, n + i + 1, n + i);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, n + j, i, n + j, n + i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, mat(color, F));
  };

  // Upright pear torso, broad seated haunches, shoulder planes, and three
  // overlapping belly shields reproduce the front concept's toy sculpture.
  const body = new THREE.Group();
  body.position.y = 0.62;
  body.rotation.x = -0.08;
  const torso = mass(0.43, scale, [0.88, 1.08, 0.9], 2);
  body.add(torso);
  const chest = mass(0.3, scaleLight, [1.0, 1.05, 0.72], 1);
  chest.position.set(0, 0.2, 0.16);
  body.add(chest);
  for (const sx of [-1, 1] as const) {
    const haunch = mass(0.27, scale, [1.05, 0.94, 1.1], 1);
    haunch.position.set(sx * 0.3, -0.25, -0.08);
    body.add(haunch);
    const shoulder = mass(0.19, scaleDark, [0.9, 1.05, 0.78], 1);
    shoulder.position.set(sx * 0.27, 0.15, 0.08);
    shoulder.rotation.z = sx * -0.18;
    body.add(shoulder);
  }
  for (const [py, pz, pr, ps, color] of [
    [0.2, 0.35, 0.23, 0.82, belly],
    [-0.03, 0.39, 0.25, 0.9, belly],
    [-0.27, 0.34, 0.2, 0.82, bellyShade],
  ] as const) {
    const plate = mass(pr, color, [ps, 0.72, 0.32], 1);
    plate.position.set(0, py, pz);
    body.add(plate);
  }
  for (const [sy, sz, r] of [
    [0.4, -0.27, 0.075],
    [0.2, -0.39, 0.09],
    [-0.02, -0.45, 0.085],
    [-0.22, -0.42, 0.07],
  ] as const) {
    const spike = crystal(r, wingC);
    spike.scale.set(0.68, 1.55, 0.66);
    spike.rotation.x = -0.42;
    spike.position.set(0, sy, sz);
    body.add(spike);
  }
  g.add(body);

  // The head pivot starts at the neck root. Two offset neck masses and cream
  // throat shields make a connected S-curve up to the wide planar skull.
  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.12);
  head.rotation.x = -0.035;
  const neckBase = mass(0.23, scaleDark, [0.78, 1.15, 0.74], 1);
  neckBase.position.set(0, 0.06, -0.01);
  neckBase.rotation.x = -0.12;
  head.add(neckBase);
  const neckTop = mass(0.22, scale, [0.76, 1.05, 0.76], 1);
  neckTop.position.set(0, 0.31, 0.04);
  neckTop.rotation.x = -0.16;
  head.add(neckTop);
  for (const [yy, zz, rr] of [[0.04, 0.18, 0.12], [0.24, 0.22, 0.13], [0.41, 0.27, 0.12]] as const) {
    const throat = mass(rr, yy > 0.3 ? belly : bellyShade, [0.76, 0.72, 0.28], 1);
    throat.position.set(0, yy, zz);
    head.add(throat);
  }

  const skull = mass(0.36, scale, [1.07, 0.92, 1.02], 2);
  skull.position.set(0, 0.57, 0.1);
  head.add(skull);
  const crownPlane = mass(0.23, scaleLight, [1.2, 0.45, 0.62], 1);
  crownPlane.position.set(0, 0.77, 0.08);
  head.add(crownPlane);
  for (const sx of [-1, 1] as const) {
    const cheek = mass(0.18, scaleDark, [0.9, 0.72, 0.72], 1);
    cheek.position.set(sx * 0.22, 0.39, 0.29);
    cheek.rotation.z = sx * 0.12;
    head.add(cheek);
  }
  const muzzle = mass(0.22, scaleDark, [1.35, 0.58, 0.78], 1);
  muzzle.position.set(0, 0.36, 0.39);
  muzzle.rotation.x = 0.04;
  head.add(muzzle);
  const jaw = mass(0.17, scaleDark, [1.32, 0.48, 0.72], 1);
  jaw.position.set(0, 0.25, 0.38);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    const nostril = crystal(0.025, 0x26394d);
    nostril.scale.set(1.2, 0.55, 0.42);
    nostril.position.set(sx * 0.105, 0.43, 0.57);
    head.add(nostril);
  }
  for (const e of eyePair(0.19, 0.59, 0.425, 0.155, { iris: 0x24183d, irisR: 0.64 }, 0.22)) {
    e.scale.y = 1.04;
    head.add(e);
  }

  const mouth = smile(0.09, 0.008, 0x26394d, 1.72);
  mouth.position.set(0, 0.28, 0.57);
  head.add(mouth);

  // Four-piece backswept horns follow the turnaround rather than standing as
  // straight cones. Separate white terminal segments make the tips structural.
  for (const sx of [-1, 1] as const) {
    head.add(segmentedHorn([
      [sx * 0.14, 0.79, -0.03],
      [sx * 0.18, 0.98, -0.08],
      [sx * 0.27, 1.12, -0.15],
      [sx * 0.34, 1.22, -0.22],
    ], 0.085, 0.045, wingC, F, 8));
    head.add(segmentedHorn([
      [sx * 0.34, 1.22, -0.22],
      [sx * 0.38, 1.33, -0.29],
    ], 0.047, 0.008, tipC, F, 8));
    const ear = cone(0.055, 0.17, scaleDark, 6, F);
    ear.position.set(sx * 0.34, 0.59, -0.02);
    ear.rotation.z = sx * -1.34;
    ear.rotation.x = -0.18;
    head.add(ear);
  }
  const crownSpike = cone(0.06, 0.2, wingC, 6, F);
  crownSpike.position.set(0, 0.9, -0.13);
  crownSpike.rotation.x = -0.35;
  head.add(crownSpike);
  g.add(head);

  // Wings: shoulder/leading arm, three radiating fingers, and separate closed
  // membrane panels. Their stepped lower points form the concept's scallops.
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.3, 0.94, -0.16);
    wing.rotation.x = -0.08;
    wing.rotation.y = sx * -0.24;
    const mirror = (points: ReadonlyArray<readonly [number, number, number]>) =>
      points.map(([x, y, z]) => [sx * x, y, z] as const);
    wing.add(segmentedHorn(mirror([
      [0, 0, 0],
      [0.23, 0.2, 0],
      [0.48, 0.24, -0.005],
      [0.76, 0.15, -0.01],
    ]), 0.045, 0.023, wingDark, F, 8));
    wing.add(segmentedHorn(mirror([[0.48, 0.24, 0], [0.59, -0.11, 0.012]]), 0.026, 0.016, wingDark, F, 7));
    wing.add(segmentedHorn(mirror([[0.43, 0.19, 0], [0.39, -0.31, 0.014]]), 0.025, 0.015, wingDark, F, 7));
    wing.add(segmentedHorn(mirror([[0.22, 0.14, 0], [0.15, -0.37, 0.016]]), 0.024, 0.014, wingDark, F, 7));
    const panel = (points: ReadonlyArray<readonly [number, number]>, color: number) =>
      membranePanel(points.map(([x, y]) => [sx * x, y] as const), color);
    wing.add(panel([[0.06, 0.0], [0.23, 0.2], [0.48, 0.24], [0.39, -0.31], [0.24, -0.2]], wingC));
    wing.add(panel([[0.39, -0.31], [0.48, 0.24], [0.76, 0.15], [0.59, -0.11], [0.49, -0.04]], wingLight));
    wing.add(panel([[0.06, 0.0], [0.24, -0.2], [0.39, -0.31], [0.28, -0.2], [0.15, -0.37]], wingC));
    const claw = cone(0.025, 0.06, tipC, 4, F);
    claw.rotation.z = sx * 1.9;
    claw.position.set(sx * 0.49, 0.27, 0);
    wing.add(claw);
    wings.push(wing);
    g.add(wing);
  }

  // Six connected frustums sweep back and curl visibly to the model's right.
  // Dorsal shards follow that curve into a broad little arrow tip.
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.34);
  tail.add(segmentedHorn([
    [0, 0, 0],
    [0.07, -0.04, -0.22],
    [0.18, -0.05, -0.43],
    [0.31, 0.01, -0.6],
    [0.42, 0.14, -0.7],
    [0.46, 0.29, -0.74],
  ], 0.15, 0.038, scale, F, 8));
  for (const [tx, ty, tz, r, rz] of [
    [0.1, 0.08, -0.27, 0.055, -0.18],
    [0.2, 0.1, -0.46, 0.05, -0.3],
    [0.32, 0.17, -0.61, 0.045, -0.46],
    [0.41, 0.28, -0.7, 0.04, -0.62],
  ] as const) {
    const spike = cone(r, r * 2.5, wingC, 5, F);
    spike.scale.z = 0.72;
    spike.rotation.z = rz;
    spike.rotation.x = -0.18;
    spike.position.set(tx, ty, tz);
    tail.add(spike);
  }
  for (const sx of [-1, 1] as const) {
    const fin = cone(0.075, 0.19, wingC, 4, F);
    fin.position.set(0.46 + sx * 0.045, 0.35, -0.74);
    fin.rotation.z = sx * 0.68;
    fin.rotation.x = -0.2;
    tail.add(fin);
  }
  g.add(tail);

  // Forearms hang from the chest and terminate in little grasping paws. Hind
  // leg handles carry large faceted thighs and forward-planted three-toe feet.
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const l = new THREE.Group();
    l.position.set(sx * 0.29, 0.8, 0.23);
    l.rotation.z = sx * 0.08;
    l.add(segmentedHorn([
      [0, 0, 0],
      [sx * -0.025, -0.18, 0.035],
      [sx * -0.075, -0.34, 0.09],
    ], 0.075, 0.052, scaleDark, F, 7));
    const paw = mass(0.095, scale, [0.86, 0.58, 1.08], 1);
    paw.position.set(sx * -0.075, -0.39, 0.11);
    l.add(paw);
    for (const tx of [-0.045, 0, 0.045]) {
      const toe = cone(0.022, 0.065, tipC, 5, F);
      toe.rotation.x = Math.PI / 2 - 0.2;
      toe.position.set(sx * -0.075 + tx, -0.42, 0.18);
      l.add(toe);
    }
    legs.push(l);
    g.add(l);
  }
  for (const sx of [-1, 1] as const) {
    const l = new THREE.Group();
    l.position.set(sx * 0.31, 0.42, -0.04);
    const thigh = mass(0.22, scaleDark, [1.02, 0.98, 1.02], 1);
    thigh.position.set(sx * 0.025, -0.06, -0.02);
    l.add(thigh);
    l.add(segmentedHorn([
      [sx * 0.03, -0.08, 0.02],
      [sx * 0.055, -0.26, 0.1],
      [sx * 0.06, -0.31, 0.15],
    ], 0.1, 0.075, scale, F, 7));
    const foot = mass(0.14, scale, [1.15, 0.55, 1.22], 1);
    foot.position.set(sx * 0.06, -0.33, 0.18);
    l.add(foot);
    for (const tx of [-0.075, 0, 0.075]) {
      const toe = cone(0.03, 0.085, tipC, 5, F);
      toe.rotation.x = Math.PI / 2 - 0.18;
      toe.position.set(sx * 0.06 + tx, -0.37, 0.3);
      l.add(toe);
    }
    legs.push(l);
    g.add(l);
  }
  if (rng() < 0.35) {
    const chip = crystal(0.026, tipC);
    chip.position.set(0.34, 1.17, -0.19);
    head.add(chip);
  }

  return { group: g, parts: { legs, wings, head, body, tail } };
}

const BUILDERS: Record<string, (rng: () => number) => { group: THREE.Group; parts: CritterParts }> = {
  puffle: buildPuffle,
  skitterling: buildSkitterling,
  bellowbuck: buildBellowbuck,
  mirefin: buildMirefin,
  craghorn: buildCraghorn,
  cragdrake: buildCragdrake,
  shark: buildShark,
  skywyvern: buildSkyWyvern,
  zephyrfinch: buildZephyrfinch,
  shardwing: buildShardwing,
  nectarwisp: buildNectarWisp,
  emberpup: buildEmberpup,
  lumenstag: buildLumenstag,
  prismhorse: buildPrismhorse,
  bumblewhale: buildBumblewhale,
  snickerdoodle: buildSnickerdoodle,
  gloomgobbler: buildGloomgobbler,
  gargoyle: buildGargoyle,
  timberchomp: buildTimberchomp,
  pebbleshrew: buildPebbleshrew,
};

/**
 * Build a critter model for `speciesId`, using `rng` for per-individual variety
 * (slight uniform scale ±10% and per-part hue/lightness jitter + a weathering
 * accent). Throws for an unknown species id — model gaps must not silently
 * render an empty group.
 */
export function buildCritterModel(
  speciesId: string,
  rng: () => number,
): { group: THREE.Group; parts: CritterParts } {
  const build = BUILDERS[speciesId];
  if (!build) throw new Error(`buildCritterModel: unknown species '${speciesId}'`);
  const out = build(rng);
  const facetSeed = Math.floor(rng() * 0x100000000) >>> 0;
  // Consolidate the authored primitives into 1-2 merged meshes per animatable
  // part (vertex-coloured; see the draw-call baking block above).
  bakeCritterGroup(out.group, out.parts, facetSeed);
  // Per-individual uniform scale (±10% by default; see CRITTER_VARIATION).
  const s = CRITTER_VARIATION.scaleMin + rng() * CRITTER_VARIATION.scaleRange;
  out.group.scale.setScalar(s);
  return out;
}
