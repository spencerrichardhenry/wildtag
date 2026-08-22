import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CRITTER_VARIATION } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';

// Procedural critter models — "Neopets released a Valheim competitor", round 3.
// Round 3 keeps round 2's smooth plush construction, then pushes the character
// design: candy two-tone palettes, face-front eye masks, and one enormous
// silhouette signature per species. Flat faceting survives ONLY where it is
// material identity — prismhorse/shardwing crystal, craghorn horn ridges,
// gloomgobbler shadow-smoke, pebbleshrew stones and gargoyle masonry.
//
// Proportions are squashed cuter: heads up to ~45-50% of visual mass on the
// small critters, plump bottom-heavy bellies, stubby limbs, rounded plump
// ears/tails (never spikes). Faces carry the charm: big sclera+iris+highlight
// eyes set close on a defined face-front, a tiny smiling mouth (torus arc) or
// beak, and soft warm cheek-blush pads on the marquee cuties (puffle,
// emberpup, snickerdoodle). Palette is round-1's muted-but-rich; per-individual
// rng jitters colour/scale AND rolls small weathering accents (a horn chip, an
// ear notch) so no two look cloned.
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
  /**
   * Flat-shaded facets. Round 2 default is SMOOTH (soft-toy read); pass true
   * only where faceting is material identity (crystal, horn ridge, shadow-ball).
   */
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
// cache never mixes. The key INCLUDES the flat/smooth shading flag: round 2
// mixes smooth organic surfaces with identity-faceted ones, and the same
// colour must never alias across the two shading modes.
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
  const flat = opts.flat ?? false;
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

// --- primitive helpers (smooth-shaded organic volumes; flat only by opt-in) --

/** A smooth sphere — the workhorse for plump bodies/heads. Segment counts are
 *  chosen per-part against the tri budget (≤1200 typical / ≤1800 prismhorse). */
function sphere(r: number, color: number, opts: MatOpts = {}, ws = 10, hs = 8): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat(color, opts));
}

/** Cheap little sphere for tips / speckles / small bits (still smooth). */
function blob(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat(color, opts));
}

/** A rounded capsule (axis = Y). Plump limbs, sleek bodies. */
function capsule(
  r: number,
  len: number,
  color: number,
  opts: MatOpts = {},
  cap = 3,
  rad = 9,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, cap, rad), mat(color, opts));
}

function cone(r: number, h: number, color: number, seg = 8, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, opts));
}

function cyl(
  rt: number,
  rb: number,
  h: number,
  color: number,
  seg = 8,
  opts: MatOpts = {},
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
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
 * A bottom-heavy egg/pear body via LatheGeometry — THE Neopets silhouette.
 * Profile runs y 0→`h`, bulging below the midline (`bulge` 0..~0.45 pushes the
 * fattest ring downward). Smooth-shaded; base rests near y=0.
 */
function egg(r: number, h: number, color: number, opts: MatOpts = {}, bulge = 0.3, seg = 15): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = Math.sin(Math.PI * Math.pow(t, 1 - bulge)) * r;
    pts.push(new THREE.Vector2(Math.max(x, 0.001), t * h));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat(color, opts));
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

/** A soft cheek-blush pad: a squashed warm-tinted sphere sitting on the cheek. */
function blush(r: number, color: number): THREE.Mesh {
  const m = sphere(r, color, {}, 5, 3);
  m.scale.set(1, 0.72, 0.35);
  return m;
}

// --- the charm payoff: an expressive eye ------------------------------------

interface EyeOpts {
  /** Sclera (eyeball white) colour. */
  sclera?: number;
  /** Iris colour. */
  iris?: number;
  /** Make the sclera glow (gloomgobbler lantern eyes). */
  scleraEmissive?: number;
  scleraEmissiveIntensity?: number;
  /** Iris radius as a fraction of the eye radius (bigger = cuter/dopier). */
  irisR?: number;
  /** Horizontal highlight direction in eye-local space (−1 left, +1 right). */
  highlightSide?: number;
}

/**
 * One eye as a small group facing +Z: a smooth white sclera dome, a big
 * coloured iris on the front, and a tiny white highlight dot (the single
 * detail that does most of the charm work). Caller positions/rotates it.
 */
function eye(r: number, o: EyeOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const scleraOpts: MatOpts =
    o.scleraEmissive !== undefined
      ? { emissive: o.scleraEmissive, emissiveIntensity: o.scleraEmissiveIntensity ?? 1.4 }
      : {};
  // Sclera: a slightly flattened dome so the eye reads as set INTO the face,
  // not a protruding ping-pong ball.
  const sc = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(o.sclera ?? 0xf4efe2, scleraOpts));
  sc.scale.set(1, 1.05, 0.72);
  g.add(sc);
  // Big glossy iris (Neopets read) sitting on the front of the dome.
  const ir = new THREE.Mesh(
    new THREE.SphereGeometry(r * (o.irisR ?? 0.7), 6, 4),
    mat(o.iris ?? 0x241b14),
  );
  ir.position.z = r * 0.5;
  ir.scale.z = 0.42;
  g.add(ir);
  const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 4, 3), mat(0xffffff));
  hi.position.set((o.highlightSide ?? -1) * r * 0.24, r * 0.28, r * 0.57);
  g.add(hi);
  return g;
}

/** A symmetric pair of eyes on the +Z face of a head, spaced by `sep`, with a
 *  slight outward toe so they read as looking at you rather than cross-eyed. */
function eyePair(sep: number, y: number, z: number, r: number, o: EyeOpts = {}, toe = 0.12): THREE.Group[] {
  const out: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    // Highlights sit up-and-OUTWARD on the pair, like painted plush eyes.
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
 * Smooth by default (organic antler); pass `opts.flat` for a ridged ram horn.
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

/** A plump rounded ear: a squashed smooth sphere (never a spike). */
function plumpEar(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  const e = sphere(r, color, opts, 6, 5);
  e.scale.set(0.72, 1.35, 0.45);
  return e;
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

// --- species builders ---------------------------------------------------------
// Each returns the assembled group (root at feet, y=0) and its parts. Colours
// are jittered per-individual and a small weathering accent is rolled (always
// via an unconditional rng() draw — determinism convention) so a herd never
// looks cloned. Palette is muted-but-rich; a separate tinted belly part gives
// the darker/lighter underside.

/** Puffle — sandy pear plush with billboard-sized rabbit ears. */
function buildPuffle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0xe2bd77, rng, 0.06);
  const cream = jitterColor(0xffe3ad, rng, 0.04);
  const furDark = jitterColor(0xc68e51, rng, 0.05);
  const pink = jitterColor(0xf39ab5, rng, 0.04);
  const noseC = jitterColor(0xb96870, rng, 0.03);

  const body = new THREE.Group();
  const shell = egg(0.45, 0.9, fur, {}, 0.38, 14);
  body.add(shell);
  // Cream bib and tiny toy arms break up the pear without changing its mass.
  const bib = sphere(0.25, cream, {}, 8, 6);
  bib.scale.set(0.9, 1.05, 0.42);
  bib.position.set(0, 0.27, 0.36);
  body.add(bib);
  for (const sx of [-1, 1]) {
    const arm = capsule(0.055, 0.12, furDark, {}, 2, 6);
    arm.position.set(sx * 0.4, 0.38, 0.15);
    arm.rotation.z = sx * -0.95;
    body.add(arm);
  }
  g.add(body);

  // The face is a plush applique proud of the pear front. The eyes occupy
  // nearly the full face height and remain visible from the roster camera.
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0.16);
  const mask = sphere(0.26, cream, {}, 9, 7);
  mask.scale.set(1.25, 0.9, 0.46);
  mask.position.set(0, -0.02, 0.17);
  head.add(mask);
  for (const e of eyePair(0.15, 0.08, 0.28, 0.15, { iris: 0x4d342c, irisR: 0.72 }, 0.06)) {
    head.add(e);
  }
  const nose = blob(0.052, noseC);
  nose.scale.set(1.05, 0.75, 0.7);
  nose.position.set(0, -0.08, 0.42);
  head.add(nose);
  const mouth = smile(0.06, 0.012);
  mouth.position.set(0, -0.16, 0.41);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const b = blush(0.078, pink);
    b.position.set(sx * 0.27, -0.08, 0.32);
    b.rotation.y = sx * 0.4;
    head.add(b);
  }

  // Giant teardrop rabbit ears: the puffle's read-at-30m feature. Inner pink
  // inserts sit forward so they survive both front and three-quarter views.
  const notchRoll = rng();
  for (const sx of [-1, 1]) {
    const short = notchRoll < 0.28 && sx === -1;
    const ear = sphere(0.17, fur, {}, 8, 6);
    ear.scale.set(0.78, short ? 1.72 : 2.12, 0.58);
    ear.position.set(sx * 0.2, short ? 0.43 : 0.5, -0.02);
    ear.rotation.z = sx * -0.16;
    head.add(ear);
    const inner = sphere(0.105, pink, {}, 7, 5);
    inner.scale.set(0.68, short ? 1.58 : 1.95, 0.32);
    inner.position.set(sx * 0.2, short ? 0.43 : 0.5, 0.09);
    inner.rotation.z = sx * -0.16;
    head.add(inner);
  }
  g.add(head);

  // Four animation handles stay intact; visually they are tiny plush paws.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.19, 0.14, sz * 0.15, 0.075, 0.095, 0.14, furDark);
    legs.push(l);
    g.add(l);
  }

  if (rng() < 0.4) {
    const freckle = blob(0.045, furDark);
    freckle.position.set(0.27, 0.34, 0.39);
    body.add(freckle);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Skitterling — jewel beetle with unmistakable Aisha-like paddle antennae. */
function buildSkitterling(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shell = jitterColor(0x6658c9, rng, 0.07);
  const shellDark = jitterColor(0x33266f, rng, 0.05);
  const shellLight = jitterColor(0x9b8df0, rng, 0.06);
  const paddleC = jitterColor(0xf18bb9, rng, 0.05);
  const cream = jitterColor(0xffe5c4, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.28;
  const carapace = sphere(0.32, shell, {}, 11, 8);
  carapace.scale.set(1.08, 0.82, 1.38);
  body.add(carapace);
  const dome = sphere(0.22, shellLight, {}, 8, 6);
  dome.scale.set(0.94, 0.62, 1.25);
  dome.position.set(0, 0.17, -0.07);
  body.add(dome);
  // Plush seam down the wing-cases.
  const seam = capsule(0.018, 0.46, cream, {}, 1, 5);
  seam.rotation.x = Math.PI / 2;
  seam.position.set(0, 0.25, -0.06);
  body.add(seam);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.42);
  const hb = sphere(0.23, shellDark, {}, 10, 7);
  hb.scale.set(1.04, 0.94, 0.96);
  head.add(hb);
  const muzzle = sphere(0.12, cream, {}, 7, 5);
  muzzle.scale.set(1.15, 0.7, 0.58);
  muzzle.position.set(0, -0.08, 0.18);
  head.add(muzzle);
  for (const e of eyePair(0.12, 0.045, 0.19, 0.115, { iris: 0x20265e, irisR: 0.7 }, 0.08)) {
    head.add(e);
  }
  const mouth = smile(0.045, 0.01, 0x24173b);
  mouth.position.set(0, -0.13, 0.29);
  head.add(mouth);

  // Enormous springy stems terminate in flattened candy paddles. They remain
  // inside `head` (not a new animation handle) to preserve the parts contract.
  for (const sx of [-1, 1]) {
    head.add(segmentedHorn([
      [sx * 0.07, 0.13, 0.0],
      [sx * 0.12, 0.29, 0.03],
      [sx * 0.22, 0.43, 0.1],
    ], 0.026, 0.017, shellDark, {}, 6));
    const pad = sphere(0.105, paddleC, {}, 7, 5);
    pad.scale.set(0.78, 1.28, 0.5);
    pad.position.set(sx * 0.25, 0.48, 0.12);
    pad.rotation.z = sx * -0.26;
    head.add(pad);
    const dot = blob(0.035, cream);
    dot.position.set(sx * 0.26, 0.52, 0.175);
    head.add(dot);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const sz of [0.2, 0, -0.2]) {
    for (const sx of [-1, 1]) {
      const l = legGroup(sx * 0.22, 0.16, sz, 0.035, 0.05, 0.16, shellDark, sx * 0.62);
      legs.push(l);
      g.add(l);
    }
  }

  if (rng() < 0.35) {
    const spot = blob(0.05, paddleC);
    spot.position.set(0.18, 0.46, -0.12);
    body.add(spot);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Bellowbuck — gentle plush elk crowned by broad mossy palmate antlers. */
function buildBellowbuck(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const hide = jitterColor(0x8a5b37, rng, 0.04);
  const hideLight = jitterColor(0xf0cf91, rng, 0.04);
  const hideDark = jitterColor(0x5c3a27, rng, 0.03);
  const antlerC = jitterColor(0x71864d, rng, 0.05, 0.05);

  const body = new THREE.Group();
  body.position.y = 1.08;
  const barrel = capsule(0.43, 0.62, hide, {}, 2, 8);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  const belly = capsule(0.3, 0.45, hideLight, {}, 2, 6);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, -0.2, 0.1);
  body.add(belly);
  const hump = sphere(0.32, hideDark, {}, 7, 5);
  hump.scale.set(1, 0.9, 0.85);
  hump.position.set(0, 0.2, 0.3);
  body.add(hump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.28, 0.56);
  const neck = capsule(0.2, 0.42, hideDark, {}, 2, 6);
  neck.rotation.x = -0.42;
  neck.position.set(0, 0.05, -0.06);
  head.add(neck);
  // A wide, low, heavy head conveys the species' unflappable temperament.
  const skull = sphere(0.29, hide, {}, 10, 7);
  skull.scale.set(1.12, 0.9, 1.05);
  skull.position.set(0, 0.31, 0.28);
  head.add(skull);
  const muzzle = sphere(0.19, hideLight, {}, 8, 5);
  muzzle.scale.set(1.12, 0.75, 1.0);
  muzzle.position.set(0, 0.21, 0.5);
  head.add(muzzle);
  for (const e of eyePair(0.155, 0.39, 0.49, 0.11, { iris: 0x4b3b25, irisR: 0.64 }, 0.08)) {
    e.scale.y = 0.92;
    head.add(e);
  }
  const nose = sphere(0.07, hideDark, {}, 6, 4);
  nose.scale.set(1.25, 0.65, 0.55);
  nose.position.set(0, 0.2, 0.69);
  head.add(nose);
  const mouth = smile(0.07, 0.012, hideDark);
  mouth.position.set(0, 0.1, 0.66);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const ear = plumpEar(0.105, hideLight);
    ear.position.set(sx * 0.26, 0.48, 0.19);
    ear.rotation.z = sx * 0.95;
    head.add(ear);
  }

  // Mossy palmate crowns: broad flattened palms dominate the silhouette, with
  // three rounded fingers instead of sharp deer spikes.
  const chipRoll = rng();
  for (const sx of [-1, 1] as const) {
    head.add(segmentedHorn([
      [sx * 0.13, 0.5, 0.18],
      [sx * 0.22, 0.67, 0.12],
      [sx * 0.34, 0.76, 0.08],
    ], 0.065, 0.045, antlerC, {}, 6));
    const palm = sphere(0.23, antlerC, {}, 8, 6);
    palm.scale.set(1.05, 1.22, 0.3);
    palm.position.set(sx * 0.43, 0.82, 0.08);
    palm.rotation.z = sx * -0.18;
    head.add(palm);
    const fingers = chipRoll < 0.28 && sx === -1 ? 2 : 3;
    for (let i = 0; i < fingers; i++) {
      const finger = capsule(0.042, 0.17 + i * 0.025, antlerC, {}, 1, 5);
      finger.position.set(sx * (0.31 + i * 0.12), 1.03 + i * 0.025, 0.07);
      finger.rotation.z = sx * (-0.42 + i * 0.34);
      head.add(finger);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.25, 0.82, sz * 0.38, 0.1, 0.13, 0.82, hideDark, 0, 0x36251c);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.15, -0.62);
  const tm = sphere(0.1, hideLight, {}, 6, 4);
  tm.scale.set(0.8, 1.0, 1.3);
  tm.position.z = -0.08;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/** Mirefin — saturated axolotl-dolphin with a six-petal pink head frill. */
function buildMirefin(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const skin = jitterColor(0x169bb3, rng, 0.07);
  const skinDark = jitterColor(0x087083, rng, 0.05);
  const belly = jitterColor(0xa8f0e2, rng, 0.04);
  const frillC = jitterColor(0xf27daf, rng, 0.05);
  const frillLight = jitterColor(0xffb4cf, rng, 0.04);

  const body = new THREE.Group();
  body.position.y = 0.32;
  const torso = capsule(0.31, 0.52, skin, {}, 3, 9);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const bel = capsule(0.2, 0.42, belly, {}, 2, 7);
  bel.rotation.x = Math.PI / 2;
  bel.position.set(0, -0.16, 0.06);
  body.add(bel);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.43, 0.46);
  const hb = sphere(0.28, skin, {}, 10, 7);
  hb.scale.set(1.1, 0.88, 0.96);
  head.add(hb);
  const snout = sphere(0.16, belly, {}, 7, 5);
  snout.scale.set(1.25, 0.68, 0.8);
  snout.position.set(0, -0.08, 0.22);
  head.add(snout);
  for (const e of eyePair(0.145, 0.07, 0.23, 0.12, { iris: 0x144d65, irisR: 0.67 }, 0.07)) {
    head.add(e);
  }
  const mouth = smile(0.09, 0.015, skinDark, 1.95);
  mouth.position.set(0, -0.1, 0.36);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const cheek = blush(0.06, frillLight);
    cheek.position.set(sx * 0.24, -0.07, 0.27);
    head.add(cheek);
  }

  // Three soft frill paddles on each cheek make a six-point axolotl halo.
  for (const sx of [-1, 1] as const) {
    for (const [i, yy, tilt] of [
      [0, 0.18, 0.78],
      [1, 0.02, 0.2],
      [2, -0.14, -0.55],
    ] as const) {
      const frill = sphere(0.115 - i * 0.008, frillC, {}, 7, 5);
      frill.scale.set(0.48, 1.24, 0.34);
      frill.position.set(sx * (0.29 + i * 0.035), yy, 0.01);
      frill.rotation.z = sx * -tilt;
      head.add(frill);
      const dot = blob(0.035, frillLight);
      dot.position.set(sx * (0.31 + i * 0.035), yy + 0.02, 0.055);
      head.add(dot);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.23, 0.15, sz * 0.27, 0.045, 0.075, 0.15, skinDark, sx * 0.52);
    legs.push(l);
    g.add(l);
  }

  // A huge vertical tail fan, attached at the joint for the existing sway.
  const tail = new THREE.Group();
  tail.position.set(0, 0.34, -0.5);
  const base = capsule(0.11, 0.25, skinDark, {}, 2, 6);
  base.rotation.x = Math.PI / 2;
  base.position.z = -0.12;
  tail.add(base);
  const paddle = sphere(0.27, frillC, {}, 9, 6);
  paddle.scale.set(0.28, 1.25, 1.35);
  paddle.position.set(0, 0.05, -0.34);
  tail.add(paddle);
  g.add(tail);

  if (rng() < 0.35) {
    const tailSpot = blob(0.055, frillLight);
    tailSpot.position.set(0.04, 0.5, -0.78);
    tail.add(tailSpot);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

/** Craghorn — woolly tank with fat, fully curling faceted ram horns. */
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
  body.position.y = 0.68;
  const barrel = capsule(0.4, 0.5, wool, {}, 3, 9);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  // Shaggy shoulder mantle: overlapping squashed lobes draping the front half,
  // darker than the barrel so the coat reads layered like the vision goat.
  for (const [ly, lz, r, sxs] of [
    [0.16, 0.18, 0.34, 1.12],
    [0.1, -0.06, 0.31, 1.18],
    [0.02, 0.36, 0.26, 1.0],
  ] as const) {
    const shag = sphere(r, woolDark, {}, 8, 6);
    shag.scale.set(sxs, 0.72, 0.95);
    shag.position.set(0, ly, lz);
    body.add(shag);
  }
  // Cream chest bib + rump patch.
  const bib = sphere(0.2, muzzleC, {}, 7, 5);
  bib.scale.set(0.95, 0.9, 0.6);
  bib.position.set(0, -0.08, 0.42);
  body.add(bib);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.87, 0.47);
  const skull = sphere(0.25, woolDark, {}, 9, 7);
  skull.scale.set(1.08, 0.98, 1.08);
  head.add(skull);
  const forehead = sphere(0.16, wool, {}, 7, 5);
  forehead.scale.set(1.15, 0.75, 0.55);
  forehead.position.set(0, 0.12, 0.16);
  head.add(forehead);
  const muzzle = sphere(0.14, muzzleC, {}, 7, 5);
  muzzle.scale.set(1.08, 0.75, 1.0);
  muzzle.position.set(0, -0.08, 0.21);
  head.add(muzzle);
  for (const [i, e] of eyePair(0.13, 0.055, 0.22, 0.095, { iris: 0x30353d, irisR: 0.58 }, 0.08).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.72;
    e.rotation.z = sx * -0.09;
    head.add(e);
    const brow = capsule(0.018, 0.12, hornC, {}, 1, 5);
    brow.rotation.z = sx * -1.43;
    brow.position.set(sx * 0.13, 0.15, 0.29);
    head.add(brow);
  }
  const nose = blob(0.045, 0x343139);
  nose.position.set(0, -0.06, 0.34);
  head.add(nose);
  const beard = sphere(0.09, woolDark, {}, 6, 4);
  beard.scale.set(0.82, 1.45, 0.72);
  beard.position.set(0, -0.22, 0.13);
  head.add(beard);

  // Ibex horns: long ridged arcs rising from the forehead and sweeping BACK
  // over the mantle with a slight outward flare (the vision image's signature
  // silhouette). Ridge segmentation keeps the craghorn's faceted-horn
  // identity; an rng roll chips one tip on some individuals.
  const chipRoll = rng();
  for (const sx of [-1, 1] as const) {
    const chipped = chipRoll < 0.35 && sx === 1;
    const pts: ReadonlyArray<readonly [number, number, number]> = [
      [sx * 0.1, 0.16, 0.06],
      [sx * 0.15, 0.36, -0.06],
      [sx * 0.19, 0.5, -0.24],
      [sx * 0.22, 0.55, -0.46],
      [sx * 0.24, 0.5, -0.68],
      [sx * 0.25, 0.38, -0.86],
      [sx * 0.25, 0.24, -0.98],
    ];
    head.add(segmentedHorn(chipped ? pts.slice(0, 5) : pts, 0.105, 0.028, hornC, { flat: true }, 6));
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.23, 0.5, sz * 0.3, 0.1, 0.13, 0.5, woolDark, 0, 0x323039);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

/** Zephyrfinch — round sky-blue chick with three swept crown quills. */
function buildZephyrfinch(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const feather = jitterColor(0x65b8e8, rng, 0.06);
  const featherDark = jitterColor(0x337eb6, rng, 0.05);
  const cream = jitterColor(0xffe6af, rng, 0.04);
  const beakC = jitterColor(0xf3a848, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.16;
  const torso = egg(0.28, 0.52, feather, {}, 0.38, 13);
  body.add(torso);
  const chest = sphere(0.2, cream, {}, 8, 6);
  chest.scale.set(0.9, 1.08, 0.58);
  chest.position.set(0, 0.22, 0.22);
  body.add(chest);
  // Three small cream beads form a feathery chest bib.
  for (const [sx, yy] of [[-0.06, 0.29], [0.06, 0.29], [0, 0.2]] as const) {
    const tuft = blob(0.07, cream);
    tuft.scale.set(0.85, 1.2, 0.55);
    tuft.position.set(sx, yy, 0.34);
    body.add(tuft);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.2, -0.18);
  for (const [sx, rz] of [
    [-1, 0.3],
    [0, 0],
    [1, -0.3],
  ] as const) {
    const f = capsule(0.055, 0.2, featherDark, {}, 2, 5);
    f.rotation.x = Math.PI / 2 + 0.45;
    f.rotation.z = rz;
    f.position.set(sx * 0.06, 0.0, -0.15);
    f.scale.set(1, 1, 0.5);
    tail.add(f);
  }
  body.add(tail);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.65, 0.14);
  const hb = sphere(0.24, feather, {}, 10, 7);
  hb.scale.set(1.04, 0.98, 0.96);
  head.add(hb);
  for (const e of eyePair(0.12, 0.045, 0.2, 0.105, { iris: 0x244764, irisR: 0.68 }, 0.08)) {
    head.add(e);
  }
  const beak = cone(0.055, 0.14, beakC, 8);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.055, 0.31);
  head.add(beak);

  // Three plush quills sweep backward like a cartoon pompadour.
  const plumeRoll = rng();
  const plumeCount = plumeRoll < 0.22 ? 2 : 3;
  for (let i = 0; i < plumeCount; i++) {
    const quill = capsule(0.04, 0.18 + i * 0.025, i === 1 ? cream : featherDark, {}, 1, 5);
    quill.position.set((i - 1) * 0.07, 0.25 + i * 0.025, -0.04 - i * 0.025);
    quill.rotation.x = -0.7 - i * 0.1;
    quill.rotation.z = (i - 1) * -0.24;
    head.add(quill);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.21, 0.43, 0.02);
    const wm = capsule(0.085, 0.22, featherDark, {}, 2, 7);
    wm.rotation.z = Math.PI / 2;
    wm.rotation.y = sx * -0.35;
    wm.scale.set(1, 1, 0.5);
    wm.position.set(sx * 0.13, 0, -0.03);
    w.add(wm);
    wings.push(w);
    g.add(w);
  }

  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.09, 0.16, -0.01, 0.025, 0.035, 0.16, beakC);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/** Shardwing — plump moth plush carrying two pairs of true crystal wings. */
function buildShardwing(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0x7652b8, rng, 0.08);
  const furDark = jitterColor(0x392a72, rng, 0.06);
  const cream = jitterColor(0xf5d7f0, rng, 0.04);
  const foreC = jitterColor(0x68e2ed, rng, 0.09);
  const hindC = jitterColor(0xd98cf2, rng, 0.09);
  const glow = jitterColor(0xf4ffb8, rng, 0.03);

  const body = new THREE.Group();
  body.position.set(0, 0.18, -0.04);
  const thorax = egg(0.23, 0.52, fur, {}, 0.38, 11);
  body.add(thorax);
  const belly = sphere(0.16, cream, {}, 7, 5);
  belly.scale.set(0.82, 1.05, 0.52);
  belly.position.set(0, 0.19, 0.19);
  body.add(belly);
  // Furry neck ruff, deliberately lumpy against the faceted wings.
  for (const sx of [-1, 0, 1]) {
    const ruff = blob(0.085, cream);
    ruff.position.set(sx * 0.09, 0.46 - Math.abs(sx) * 0.025, 0.04);
    body.add(ruff);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.53, 0.23);
  const skull = sphere(0.21, furDark, {}, 9, 7);
  skull.scale.set(1.05, 0.96, 0.94);
  head.add(skull);
  for (const e of eyePair(0.105, 0.035, 0.17, 0.095, { iris: 0x38235f, irisR: 0.72 }, 0.08)) {
    head.add(e);
  }
  const smileM = smile(0.045, 0.01, 0x281c40);
  smileM.position.set(0, -0.08, 0.23);
  head.add(smileM);
  // Hooked feelers curl back toward their own stems.
  for (const sx of [-1, 1] as const) {
    head.add(
      segmentedHorn(
        [
          [sx * 0.05, 0.11, 0.01],
          [sx * 0.12, 0.25, 0.07],
          [sx * 0.24, 0.32, 0.15],
          [sx * 0.3, 0.24, 0.22],
          [sx * 0.22, 0.17, 0.25],
        ],
        0.022,
        0.012,
        furDark,
        {},
        5,
      ),
    );
    const tip = blob(0.035, glow, { emissive: glow, emissiveIntensity: 0.5 });
    tip.position.set(sx * 0.215, 0.165, 0.26);
    head.add(tip);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  const spotRoll = rng();
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.08, 0.48, -0.04);

    const fore = crystal(0.43, foreC, { opacity: 0.7, emissive: foreC, emissiveIntensity: 0.28 });
    fore.scale.set(0.72, 1.22, 0.16);
    fore.position.set(sx * 0.34, 0.2, 0.04);
    fore.rotation.z = sx * -0.2;
    wing.add(fore);

    const hind = crystal(0.37, hindC, { opacity: 0.7, emissive: hindC, emissiveIntensity: 0.24 });
    hind.scale.set(0.8, 1.05, 0.17);
    hind.position.set(sx * 0.32, -0.22, -0.08);
    hind.rotation.z = sx * 0.22;
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
      const l = legGroup(sx * 0.08, 0.18, z, 0.014, 0.012, 0.18, furDark, sx * 0.48);
      g.add(l);
    }
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/** Nectar Wisp — chubby striped bumble with a heart nose and toy wings. */
function buildNectarWisp(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const amber = jitterColor(0xf5b82e, rng, 0.05);
  const amberLight = jitterColor(0xffdf65, rng, 0.04);
  const dark = jitterColor(0x4c354d, rng, 0.03);
  const wingC = jitterColor(0xbdeeff, rng, 0.04);
  const cream = jitterColor(0xffedc8, rng, 0.025);
  const heartC = jitterColor(0xe96f91, rng, 0.04);

  const body = new THREE.Group();
  body.position.set(0, 0.35, -0.03);
  const abdomen = sphere(0.31, amber, {}, 10, 7);
  abdomen.scale.set(1.02, 0.9, 1.2);
  body.add(abdomen);
  for (const z of [-0.16, 0.1]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.05, 5, 10), mat(dark));
    band.position.z = z;
    band.scale.y = 0.9;
    body.add(band);
  }
  const lantern = sphere(0.085, amberLight, { emissive: amber, emissiveIntensity: 0.65 }, 6, 4);
  lantern.position.set(0, -0.27, -0.04);
  body.add(lantern);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.43, 0.36);
  const skull = sphere(0.24, amberLight, {}, 9, 7);
  skull.scale.set(1.04, 0.96, 0.92);
  head.add(skull);
  const mask = sphere(0.14, cream, {}, 7, 5);
  mask.scale.set(1.22, 0.7, 0.52);
  mask.position.set(0, -0.06, 0.17);
  head.add(mask);
  for (const e of eyePair(0.12, 0.055, 0.19, 0.105, { iris: 0x38253a, irisR: 0.7 }, 0.08)) {
    head.add(e);
  }
  // Two lobes plus a tiny downward point make a readable heart-shaped nose.
  for (const sx of [-1, 1]) {
    const lobe = blob(0.04, heartC);
    lobe.position.set(sx * 0.032, -0.045, 0.29);
    head.add(lobe);
  }
  const heartTip = cone(0.045, 0.075, heartC, 7);
  heartTip.rotation.z = Math.PI;
  heartTip.position.set(0, -0.09, 0.29);
  head.add(heartTip);
  const mouth = smile(0.05, 0.011, dark, 1.65);
  mouth.position.set(0, -0.14, 0.29);
  head.add(mouth);
  for (const sx of [-1, 1] as const) {
    head.add(
      segmentedHorn(
        [
          [sx * 0.065, 0.13, 0.01],
          [sx * 0.12, 0.24, 0.04],
          [sx * 0.18, 0.28, 0.11],
        ],
        0.022,
        0.012,
        dark,
        {},
        5,
      ),
    );
    const bobble = blob(0.04, heartC);
    bobble.position.set(sx * 0.18, 0.28, 0.12);
    head.add(bobble);
  }
  g.add(head);

  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.23, 0.5, -0.08);
    const stub = sphere(0.18, wingC, { opacity: 0.62 }, 7, 5);
    stub.scale.set(0.72, 1.0, 0.2);
    stub.position.set(sx * 0.12, 0.03, -0.03);
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

/** Emberpup — huge-eared fox pup with a mischievous mask and forked flame tail. */
function buildEmberpup(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe15f32, rng, 0.045);
  const coatDark = jitterColor(0x9d3829, rng, 0.04);
  const cream = jitterColor(0xffdaa0, rng, 0.04);
  const blushC = jitterColor(0xf18b86, rng, 0.03);
  const ember = 0xff7a2a;

  const body = new THREE.Group();
  body.position.y = 0.4;
  const torso = capsule(0.24, 0.32, coat, {}, 2, 7);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const chest = sphere(0.17, cream, {}, 7, 5);
  chest.scale.set(0.78, 1.25, 0.52);
  chest.position.set(0, 0.02, 0.24);
  body.add(chest);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.6, 0.32);
  const skull = sphere(0.3, coat, {}, 11, 8);
  skull.scale.set(1.02, 0.95, 0.9);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const cheek = sphere(0.125, cream, {}, 7, 5);
    cheek.position.set(sx * 0.17, -0.09, 0.17);
    head.add(cheek);
    const b = blush(0.065, blushC);
    b.position.set(sx * 0.21, -0.035, 0.24);
    b.rotation.y = sx * 0.5;
    head.add(b);
  }
  const snout = sphere(0.115, cream, {}, 7, 5);
  snout.scale.set(0.95, 0.75, 1.1);
  snout.position.set(0, -0.1, 0.25);
  head.add(snout);
  const nose = blob(0.042, 0x2a1c14);
  nose.position.set(0, -0.05, 0.38);
  head.add(nose);
  const mouth = smile(0.04, 0.01);
  mouth.position.set(0, -0.13, 0.36);
  head.add(mouth);
  for (const [i, e] of eyePair(0.14, 0.075, 0.22, 0.13, { iris: 0x4c2830, irisR: 0.68 }, 0.06).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.86;
    e.rotation.z = sx * -0.08;
    head.add(e);
    const brow = capsule(0.017, 0.115, coatDark, {}, 1, 5);
    brow.rotation.z = sx * -1.38;
    brow.position.set(sx * 0.145, 0.19, 0.31);
    head.add(brow);
  }

  // Huge satellite-dish ears — the silhouette now reads fox before colour.
  const notchRoll = rng();
  for (const sx of [-1, 1] as const) {
    const short = notchRoll < 0.3 && sx === -1;
    const ear = sphere(0.16, coat, {}, 8, 6);
    ear.scale.set(0.8, short ? 1.35 : 1.75, 0.48);
    ear.position.set(sx * 0.23, short ? 0.26 : 0.34, -0.015);
    ear.rotation.z = sx * -0.34;
    head.add(ear);
    const inner = sphere(0.095, blushC, {}, 6, 4);
    inner.scale.set(0.62, short ? 1.26 : 1.62, 0.27);
    inner.position.set(sx * 0.23, short ? 0.26 : 0.34, 0.075);
    inner.rotation.z = sx * -0.34;
    head.add(inner);
    const tip = sphere(0.04, 0xffb060, { emissive: ember, emissiveIntensity: 1.0 }, 6, 4);
    tip.position.set(sx * (short ? 0.27 : 0.31), short ? 0.43 : 0.58, -0.02);
    head.add(tip);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.15, 0.3, sz * 0.18, 0.065, 0.09, 0.3, coatDark);
    legs.push(l);
    g.add(l);
  }

  // A forked two-tuft flame plume, both soft tips sharing one emissive class.
  const tail = new THREE.Group();
  tail.position.set(0, 0.48, -0.26);
  const plume = capsule(0.12, 0.22, coat, {}, 2, 6);
  plume.rotation.x = -0.65;
  plume.position.set(0, 0.08, -0.16);
  tail.add(plume);
  for (const sx of [-1, 1]) {
    const lick = capsule(0.065, 0.13, cream, {}, 1, 5);
    lick.rotation.set(-0.65, 0, sx * -0.38);
    lick.position.set(sx * 0.055, 0.19, -0.29);
    tail.add(lick);
    const ttip = sphere(0.067, 0xffb060, { emissive: ember, emissiveIntensity: 0.82 }, 6, 4);
    ttip.position.set(sx * 0.085, 0.28, -0.38);
    tail.add(ttip);
  }
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/** Lumenstag — slim pearl stag with serene almond eyes and light-shod hooves. */
function buildLumenstag(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe9e7ff, rng, 0.025, 0.05);
  const shade = jitterColor(0xaeb9dc, rng, 0.035, 0.04);
  const cream = jitterColor(0xfff0d2, rng, 0.025);
  const glow = 0x9be8ff;

  const body = new THREE.Group();
  body.position.y = 1.18;
  const barrel = capsule(0.29, 0.72, coat, {}, 2, 8);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  const bel = capsule(0.22, 0.52, cream, {}, 2, 6);
  bel.rotation.x = Math.PI / 2;
  bel.position.set(0, -0.13, 0.08);
  body.add(bel);
  const chest = sphere(0.22, shade, {}, 7, 5);
  chest.scale.set(0.9, 1.15, 0.75);
  chest.position.set(0, 0.15, 0.37);
  body.add(chest);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.46, 0.58);
  const neck = capsule(0.12, 0.58, coat, {}, 2, 6);
  neck.rotation.x = -0.38;
  neck.position.set(0, 0.04, -0.03);
  head.add(neck);
  const skull = sphere(0.21, shade, {}, 10, 7);
  skull.scale.set(0.95, 1.0, 1.2);
  skull.position.set(0, 0.41, 0.29);
  head.add(skull);
  const muzzle = sphere(0.115, cream, {}, 7, 5);
  muzzle.scale.set(0.9, 0.72, 1.15);
  muzzle.position.set(0, 0.31, 0.48);
  head.add(muzzle);
  for (const [i, e] of eyePair(0.115, 0.46, 0.43, 0.09, { iris: 0x45647c, irisR: 0.62 }, 0.08).entries()) {
    const sx = i === 0 ? -1 : 1;
    e.scale.y = 0.64;
    e.rotation.z = sx * 0.045;
    head.add(e);
  }
  const nose = blob(0.037, 0x566078);
  nose.position.set(0, 0.3, 0.62);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const ear = plumpEar(0.085, cream);
    ear.position.set(sx * 0.17, 0.54, 0.19);
    ear.rotation.z = sx * 0.74;
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
      const tine = capsule(0.024, 0.2, glow, glowOpts, 1, 5);
      tine.position.set(sx * x, y, 0.13);
      tine.rotation.z = sx * rot;
      head.add(tine);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const legLen = 0.94;
    const l = legGroup(sx * 0.18, legLen, sz * 0.41, 0.048, 0.065, legLen, shade);
    // Keep each animated leg to one baked draw: the slim leg and brighter hoof
    // share the same low cyan emissive class, with vertex colour separating them.
    const hoofGlow: MatOpts = { emissive: glow, emissiveIntensity: 1.05 };
    (l.children[0] as THREE.Mesh).material = mat(shade, hoofGlow);
    const hoof = sphere(0.085, glow, hoofGlow, 6, 4);
    hoof.scale.set(0.78, 0.58, 1.05);
    hoof.position.set(0, -legLen + 0.035, 0.025);
    l.add(hoof);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.24, -0.58);
  const tm = capsule(0.07, 0.23, cream, {}, 2, 6);
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
 * Prismhorse — the 16-legged crystal mount, now with a true horse-like face,
 * crystal ears and a bold neck mane. All existing ride handles stay exact.
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
  const core = crystal(0.64, tint, crys);
  core.scale.set(0.78, 0.72, 1.42);
  body.add(core);
  const chest = crystal(0.52, deep, crys);
  chest.scale.set(0.7, 0.78, 0.75);
  chest.position.set(0, 0.02, 0.56);
  body.add(chest);
  const rump = crystal(0.5, deep, crys);
  rump.scale.set(0.72, 0.76, 0.75);
  rump.position.set(0, 0.02, -0.58);
  body.add(rump);
  // A short saddle-safe dorsal crest leads the eye toward the real neck mane.
  for (const [sz, len] of [[0.34, 0.28], [0.1, 0.34], [-0.16, 0.29]] as const) {
    const sh = crystal(len, maneC, crys);
    sh.scale.set(0.28, 1, 0.24);
    sh.position.set((rng() - 0.5) * 0.06, 0.33 + len * 0.35, sz);
    sh.rotation.z = (rng() - 0.5) * 0.18;
    body.add(sh);
  }
  g.add(body);

  // Defined head: a long neck, large skull, separate muzzle and ears. The eye
  // mask is deliberately smooth against the crystalline planes.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.05, 0.82);
  const neck = crystal(0.38, deep, crys);
  neck.scale.set(0.5, 1.35, 0.58);
  neck.rotation.x = -0.36;
  neck.position.set(0, 0.18, 0.02);
  head.add(neck);
  const skull = crystal(0.39, tint, crys);
  skull.scale.set(0.96, 0.88, 1.08);
  skull.position.set(0, 0.56, 0.4);
  head.add(skull);
  const muzzle = crystal(0.27, deep, crys);
  muzzle.scale.set(0.92, 0.55, 1.2);
  muzzle.position.set(0, 0.43, 0.72);
  head.add(muzzle);
  for (const e of eyePair(0.17, 0.6, 0.71, 0.13, { sclera: 0xf7fbff, iris: 0x315b88, irisR: 0.64 }, 0.06)) {
    e.scale.y = 0.9;
    head.add(e);
  }
  const smileM = smile(0.07, 0.013, 0x385076);
  smileM.position.set(0, 0.35, 0.91);
  head.add(smileM);
  for (const sx of [-1, 1] as const) {
    const ear = crystal(0.18, maneC, crys);
    ear.scale.set(0.46, 1.05, 0.38);
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
    const stalk = cyl(0.018, 0.03, 0.62, deep, 5, legCrys);
    stalk.position.y = 0.31;
    a.add(stalk);
    const bob = crystal(0.105, ice, legCrys);
    bob.position.y = 0.65;
    a.add(bob);
    a.rotation.x = -0.3;
    a.rotation.z = sx * -0.12;
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
    const tm = crystal(0.3, sx < 0 ? tint : maneC, crys);
    tm.scale.set(0.34, 0.42, 1.25);
    tm.position.set(sx * 0.09, sx * 0.05, -0.23);
    tm.rotation.z = sx * 0.22;
    tail.add(tm);
  }
  g.add(tail);

  return { group: g, parts: { legs, head, body, tail, antennae } };
}

/** Bumblewhale — sky-blue whale blimp with toy wings and a cloud blowhole. */
function buildBumblewhale(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const top = jitterColor(0x67b8e8, rng, 0.05);
  const topDark = jitterColor(0x397cae, rng, 0.04);
  const belly = jitterColor(0xe9f4e8, rng, 0.03);
  const blushC = jitterColor(0xf4a4b5, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 1.0;
  const hull = sphere(1.0, top, {}, 14, 10);
  hull.scale.set(0.86, 0.72, 1.28);
  body.add(hull);
  const under = sphere(0.94, belly, {}, 12, 8);
  under.scale.set(0.78, 0.42, 1.18);
  under.position.set(0, -0.38, 0.08);
  body.add(under);
  // Two plush belly bands wrap the front half of the blimp.
  for (const z of [0.28, 0.68]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.07, 5, 12), mat(belly));
    band.scale.y = 0.82;
    band.position.z = z;
    body.add(band);
  }
  for (const sx of [-1, 1]) {
    const fluke = sphere(0.32, topDark, {}, 8, 6);
    fluke.scale.set(1.25, 0.34, 0.75);
    fluke.position.set(sx * 0.35, 0.08, -1.28);
    fluke.rotation.y = sx * -0.4;
    body.add(fluke);
  }
  // Blowhole and a three-blob cloud puff are permanently visible from above.
  const hole = sphere(0.09, topDark, {}, 6, 4);
  hole.scale.set(1.35, 0.28, 0.75);
  hole.position.set(0, 0.72, 0.3);
  body.add(hole);
  for (const [x, y, r] of [[0, 0.85, 0.13], [-0.11, 0.97, 0.1], [0.11, 0.99, 0.105]] as const) {
    const puff = sphere(r, belly, {}, 6, 4);
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
    const fin = sphere(0.22, topDark, {}, 8, 6);
    fin.scale.set(1.2, 0.34, 0.78);
    fin.position.x = sx * 0.16;
    fin.rotation.y = sx * -0.3;
    w.add(fin);
    wings.push(w);
    g.add(w);
  }

  return { group: g, parts: { legs: [], wings, head, body } };
}

/**
 * Snickerdoodle — cookie-dough puppy who is still a rounded pancake flopper;
 * floppy spaniel ears, chocolate chips and a tongue replace the old cat read.
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
  const disc = sphere(0.5, dough, {}, 16, 10);
  disc.scale.set(1.5, 0.34, 1.08);
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
    const ear = sphere(0.18, doughDark, {}, 8, 6);
    ear.scale.set(0.85, 1.35, 0.36);
    ear.position.set(sx * 0.5, 0.02, 0.3);
    ear.rotation.z = sx * -0.72;
    ear.rotation.x = -0.25;
    body.add(ear);
    const inner = sphere(0.11, cream, {}, 6, 4);
    inner.scale.set(0.7, 1.25, 0.22);
    inner.position.set(sx * 0.5, 0.045, 0.36);
    inner.rotation.z = sx * -0.72;
    body.add(inner);
  }
  const tail = capsule(0.065, 0.28, doughDark, {}, 2, 6);
  tail.rotation.x = Math.PI / 2 - 0.4;
  tail.position.set(0.25, 0.05, -0.5);
  tail.rotation.z = -0.5;
  body.add(tail);

  // Face sits proud of the 0.54-deep pancake edge.
  for (const e of eyePair(0.16, 0.075, 0.53, 0.105, { iris: 0x4b2d22, irisR: 0.68 }, 0.06)) {
    body.add(e);
  }
  for (const sx of [-1, 1]) {
    const muzzle = sphere(0.11, cream, {}, 6, 4);
    muzzle.scale.set(1.05, 0.65, 0.5);
    muzzle.position.set(sx * 0.07, -0.02, 0.58);
    body.add(muzzle);
  }
  const nose = sphere(0.048, speck, {}, 6, 4);
  nose.scale.set(1.25, 0.72, 0.55);
  nose.position.set(0, 0.0, 0.66);
  body.add(nose);
  const mouth = smile(0.055, 0.011, speck);
  mouth.position.set(0, -0.07, 0.64);
  body.add(mouth);
  const tongue = capsule(0.04, 0.055, tongueC, {}, 2, 6);
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

/** Gloomgobbler — softly faceted shadow puff with lantern eyes and nub feet. */
function buildGloomgobbler(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shadow = jitterColor(0x2d2349, rng, 0.04, 0.05);
  const shadowLight = jitterColor(0x49376d, rng, 0.04, 0.05);
  const legc = jitterColor(0x1b1529, rng, 0.02, 0.04);
  const lantern = 0xffd24a;

  const bodyY = 0.52;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const ball = sphere(0.5, shadow, { flat: true }, 10, 8);
  ball.scale.set(1.06, 1.0, 1.0);
  body.add(ball);
  for (const sx of [-1, 1]) {
    const lobe = sphere(0.23, shadowLight, { flat: true }, 7, 5);
    lobe.position.set(sx * 0.4, -0.13, -0.06);
    body.add(lobe);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.02, 0.39);
  for (const e of eyePair(0.205, 0.07, 0.08, 0.2, {
    sclera: 0xfff0b0,
    scleraEmissive: lantern,
    scleraEmissiveIntensity: 1.8,
    iris: 0x211608,
    irisR: 0.46,
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

  // A permanent three-bead cowlick makes the spooky ball read as a pet.
  for (const [x, y, s, rz] of [[-0.03, 1.0, 1, -0.25], [0.07, 1.08, 0.82, -0.55]] as const) {
    const wisp = sphere(0.1 * s, shadowLight, { flat: true }, 7, 5);
    wisp.scale.set(0.62, 1.35, 0.6);
    wisp.position.set(x, y, -0.03);
    wisp.rotation.z = rz;
    g.add(wisp);
  }
  if (rng() < 0.35) {
    const curl = blob(0.055, shadowLight, { flat: true });
    curl.position.set(0.18, 1.09, -0.02);
    g.add(curl);
  }

  return { group: g, parts: { legs, head, body } };
}

/** Timberchomp — acorn-brown beaver plush with billboard teeth and paddle. */
function buildTimberchomp(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0x936036, rng, 0.04);
  const coatDark = jitterColor(0x57341f, rng, 0.04);
  const cream = jitterColor(0xf0cc91, rng, 0.04);
  const toothC = 0xfff1cf;

  const body = new THREE.Group();
  body.position.y = 0.2;
  const torso = egg(0.36, 0.64, coat, {}, 0.4, 12);
  body.add(torso);
  const belly = sphere(0.23, cream, {}, 8, 6);
  belly.scale.set(0.84, 1.05, 0.54);
  belly.position.set(0, 0.2, 0.28);
  body.add(belly);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.61, 0.27);
  const skull = sphere(0.28, coat, {}, 10, 7);
  skull.scale.set(1.04, 0.96, 0.94);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const muzzle = sphere(0.13, cream, {}, 7, 5);
    muzzle.scale.set(1.0, 0.78, 0.82);
    muzzle.position.set(sx * 0.085, -0.08, 0.21);
    head.add(muzzle);
  }
  for (const e of eyePair(0.14, 0.075, 0.23, 0.115, { iris: 0x453022, irisR: 0.68 }, 0.07)) {
    head.add(e);
  }
  const nose = blob(0.05, coatDark);
  nose.position.set(0, -0.02, 0.36);
  head.add(nose);
  const mouth = smile(0.055, 0.011, coatDark);
  mouth.position.set(0, -0.12, 0.35);
  head.add(mouth);
  // The incisors are intentionally absurd: visible even before the face is.
  for (const sx of [-1, 1]) {
    const tooth = box(0.055, 0.135, 0.035, toothC);
    tooth.position.set(sx * 0.045, -0.18, 0.37);
    tooth.rotation.z = sx * 0.04;
    head.add(tooth);
  }
  for (const sx of [-1, 1]) {
    const ear = sphere(0.09, coatDark, {}, 6, 4);
    ear.scale.set(1, 1, 0.5);
    ear.position.set(sx * 0.22, 0.17, -0.01);
    head.add(ear);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.19, 0.2, sz * 0.18, 0.08, 0.105, 0.2, coatDark);
    legs.push(l);
    g.add(l);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.15, -0.39);
  const paddle = capsule(0.29, 0.27, coatDark, {}, 2, 8);
  paddle.scale.set(0.28, 1.08, 1.28);
  paddle.rotation.z = Math.PI / 2;
  paddle.rotation.x = 0.08;
  paddle.position.z = -0.14;
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
 * Pebbleshrew — a compact sandy sand-shrew-like digger of the crags/highlands
 * (Inventory + Building Task 1, produces stone). Small egg body with a ridge
 * of stacked plates down the back, stubby digging claws, and tiny eyes.
 */
function buildPebbleshrew(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const sandy = jitterColor(0xc9a876, rng, 0.04);
  const sandyDark = jitterColor(0x8f7248, rng, 0.04);
  const clawC = jitterColor(0x5a4530, rng, 0.03);

  // Body: small bottom-heavy sandy egg.
  const body = new THREE.Group();
  body.position.y = 0.2;
  const torso = egg(0.24, 0.4, sandy, {}, 0.3, 12);
  body.add(torso);
  // Ridge of stacked plates down the back — 4 small nub cones sitting close
  // to the shell surface, shrinking toward the tail, kept RIDGED (flat) like
  // the craghorn's horns. (Each plate is a small accent, not a body-scale
  // spike: height caps well under the torso radius.)
  const plateSpots: ReadonlyArray<readonly [number, number, number]> = [
    [0.075, 0.35, 0.13],
    [0.065, 0.33, 0.03],
    [0.055, 0.3, -0.06],
    [0.042, 0.26, -0.14],
  ];
  for (const [ph, py, pz] of plateSpots) {
    const plate = cone(ph * 0.55, ph, sandyDark, 6, { flat: true });
    plate.position.set(0, py, pz);
    body.add(plate);
  }
  g.add(body);

  // Head: small skull, tiny close eyes, tiny nose — no smile, this one reads
  // alert/twitchy rather than cute-goofy.
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.18);
  const skull = sphere(0.14, sandy, {}, 8, 6);
  skull.scale.set(1, 0.92, 1);
  head.add(skull);
  for (const e of eyePair(0.075, 0.02, 0.11, 0.045, { irisR: 0.62 }, 0.14)) head.add(e);
  const nose = blob(0.026, sandyDark);
  nose.position.set(0, -0.05, 0.2);
  head.add(nose);
  // Tiny round ears.
  for (const sx of [-1, 1]) {
    const ear = sphere(0.045, sandy, {}, 5, 4);
    ear.scale.set(1, 1, 0.5);
    ear.position.set(sx * 0.12, 0.1, -0.02);
    head.add(ear);
  }
  g.add(head);

  // Stubby legs with digging-claw feet.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.13, 0.12, sz * 0.14, 0.05, 0.062, 0.12, sandyDark, 0, clawC);
    legs.push(l);
    g.add(l);
  }

  const wRoll = rng();
  if (wRoll < 0.3) {
    // A weathered chipped back plate on some individuals.
    const chip = blob(0.035, sandyDark);
    chip.position.set(0.16, 0.42, -0.02);
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
function bakeSubtree(root: THREE.Object3D, skip: ReadonlySet<THREE.Object3D>): void {
  const meshes: THREE.Mesh[] = [];
  (function walk(o: THREE.Object3D): void {
    for (const c of o.children) {
      if (skip.has(c)) continue;
      if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
      walk(c);
    }
  })(root);
  if (meshes.length === 0) return;

  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { geos: THREE.BufferGeometry[]; cls: ReturnType<typeof bakeClass> }>();
  const color = new THREE.Color();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const cls = bakeClass(material);
    const key = `${cls.flat}:${cls.emissive}:${cls.emissiveIntensity}:${cls.opacity}`;
    // Non-indexed so mixed primitives (indexed spheres, non-indexed octahedra)
    // merge cleanly; drop uvs (untextured) so attribute sets always match.
    const src = mesh.geometry as THREE.BufferGeometry;
    const geo = src.index ? src.toNonIndexed() : src.clone();
    geo.deleteAttribute('uv');
    const rel = new THREE.Matrix4().copy(rootInv).multiply(mesh.matrixWorld);
    geo.applyMatrix4(rel);
    // Bake the material colour into vertex colours (material goes white base).
    color.copy(material.color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
function bakeCritterGroup(group: THREE.Group, parts: CritterParts): void {
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
    bakeSubtree(r, skip);
  }
  // Loose root-level accents (tuft, cowlick, wisp, mote, ...) merge together.
  bakeSubtree(group, roots);
}

// --- Cursed Castle (+1) -------------------------------------------------------

/**
 * Gargoyle — a crouched, plump stone statue that comes alive: perches
 * motionless on the castle towers (bold — sits stock-still until tagged),
 * then glides on folded bat wings. Stone-gray body + segmented brow horns,
 * glowing amber lantern eyes, and two-rib folded bat-wing membranes angled
 * back over the shoulders (they flap via the generic `parts.wings` handling
 * in animation.ts whenever it moves).
 */
function buildGargoyle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const stone = jitterColor(0x8a8894, rng, 0.02, 0.05);
  const stoneDark = jitterColor(0x5e5a66, rng, 0.02, 0.05);
  const clawC = jitterColor(0x3a3640, rng, 0.02, 0.04);
  const amber = 0xffab3c;

  const bodyY = 0.5;
  const body = new THREE.Group();
  body.position.y = bodyY;
  // Crouched plump egg torso, hunched low over its haunches.
  const torso = egg(0.32, 0.56, stone, {}, 0.38, 9);
  body.add(torso);
  const haunch = sphere(0.26, stoneDark, {}, 7, 5);
  haunch.scale.set(1.05, 0.8, 0.95);
  haunch.position.set(0, -0.14, -0.06);
  body.add(haunch);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.5, 0.16);
  const skull = sphere(0.24, stone, {}, 8, 6);
  skull.scale.set(1, 0.92, 1.05);
  head.add(skull);
  const brow = sphere(0.16, stoneDark, {}, 6, 4);
  brow.scale.set(1.3, 0.5, 0.7);
  brow.position.set(0, 0.12, 0.14);
  head.add(brow);
  const muzzle = sphere(0.12, stone, {}, 6, 4);
  muzzle.scale.set(0.85, 0.7, 0.9);
  muzzle.position.set(0, -0.1, 0.18);
  head.add(muzzle);
  for (const e of eyePair(
    0.11,
    0.05,
    0.2,
    0.08,
    { sclera: 0xffd79a, scleraEmissive: amber, scleraEmissiveIntensity: 1.5, iris: 0x2a1608, irisR: 0.5 },
    0.14,
  )) {
    head.add(e);
  }
  const mouth = smile(0.06, 0.016, 0x241c22, 1.6);
  mouth.position.set(0, -0.19, 0.22);
  head.add(mouth);
  // Segmented brow horns, curving back over the skull. Kept RIDGED (flat) —
  // faceting reads as chiselled stone rather than soft organic antler.
  for (const sx of [-1, 1] as const) {
    const pts: ReadonlyArray<readonly [number, number, number]> = [
      [sx * 0.13, 0.2, 0.1],
      [sx * 0.2, 0.34, 0.0],
      [sx * 0.22, 0.42, -0.16],
    ];
    head.add(segmentedHorn(pts, 0.055, 0.018, stoneDark, { flat: true }, 5));
  }
  g.add(head);

  // Folded bat wings: two flattened-capsule "ribs" per side, chained
  // shoulder→elbow→tip and angled back over the haunches (resting/folded
  // shape) — animateCritter flaps the whole wing GROUP about its local Z axis
  // (rotation.z) whenever the gargoyle is moving, swinging the folded unit
  // like a real folded-wing flap.
  const up = new THREE.Vector3(0, 1, 0);
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const w = new THREE.Group();
    w.position.set(sx * 0.26, bodyY + 0.32, 0.02);
    // Shoulder → elbow: back and slightly up/out.
    const dir1 = new THREE.Vector3(sx * 0.35, 0.12, -0.93).normalize();
    const upper = capsule(0.09, 0.34, stoneDark, {}, 2, 5);
    upper.scale.set(1, 1, 0.42); // flatten into a membrane-like rib
    upper.quaternion.setFromUnitVectors(up, dir1);
    upper.position.copy(dir1).multiplyScalar(0.17);
    w.add(upper);
    // Elbow → tip: folds further back and down, tucked against the haunch.
    const elbow = dir1.clone().multiplyScalar(0.34);
    const dir2 = new THREE.Vector3(sx * 0.55, -0.3, -0.75).normalize();
    const fold = capsule(0.075, 0.28, stoneDark, {}, 2, 5);
    fold.scale.set(1, 1, 0.42);
    fold.quaternion.setFromUnitVectors(up, dir2);
    fold.position.copy(elbow).add(dir2.clone().multiplyScalar(0.14));
    w.add(fold);
    wings.push(w);
    g.add(w);
  }

  // Two stout crouched legs with clawed feet (the perched squat).
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const l = legGroup(sx * 0.2, bodyY - 0.14, 0.08, 0.13, 0.16, 0.3, stoneDark, sx * 0.12, clawC);
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


/** Cragdrake — chibi mountain dragon (Spencer's fal.ai concept, 2026-08-22):
 *  slate-blue faceted body, cream belly plate, purple swept horns with white
 *  tips, stubby purple bat wings, spine spikes, thick spiked tail. Lives in
 *  the crags; flees by diving the crag faces in circles (fleeStyle 'dive'). */
function buildCragdrake(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const scale = jitterColor(0x5f7fa4, rng, 0.04, 0.05);
  const scaleDark = jitterColor(0x47617f, rng, 0.03, 0.04);
  const belly = jitterColor(0xeadcae, rng, 0.03);
  const wingC = jitterColor(0x7a5fa8, rng, 0.04, 0.05);
  const tipC = 0xf2efe6;

  const body = new THREE.Group();
  body.position.y = 0.52;
  // Plump bottom-heavy torso, upright-leaning like the concept.
  const torso = sphere(0.4, scale, {}, 10, 8);
  torso.scale.set(0.95, 1.05, 0.9);
  body.add(torso);
  const hips = sphere(0.32, scale, {}, 8, 6);
  hips.scale.set(1.05, 0.8, 1.0);
  hips.position.set(0, -0.22, -0.06);
  body.add(hips);
  // Cream belly plate with a faint segment bulge.
  const plate = sphere(0.3, belly, {}, 8, 6);
  plate.scale.set(0.82, 0.98, 0.5);
  plate.position.set(0, -0.06, 0.24);
  body.add(plate);
  const plate2 = sphere(0.2, belly, {}, 7, 5);
  plate2.scale.set(0.75, 0.6, 0.45);
  plate2.position.set(0, -0.3, 0.22);
  body.add(plate2);
  // Spine spike row (purple; smooth-shaded so it bakes into the body bucket
  // — the faceted identity lives on the WINGS, see the bake-class budget).
  for (const [sy, sz, r] of [
    [0.34, -0.2, 0.075],
    [0.16, -0.33, 0.09],
    [-0.06, -0.38, 0.08],
  ] as const) {
    const spike = cone(r, r * 2.6, wingC, 5);
    spike.rotation.x = -0.5;
    spike.position.set(0, sy, sz);
    body.add(spike);
  }
  g.add(body);

  // Head — big, with the concept's heavy squared muzzle.
  const head = new THREE.Group();
  head.position.set(0, 1.06, 0.16);
  const skull = sphere(0.28, scale, {}, 10, 8);
  skull.scale.set(1.0, 0.94, 0.98);
  head.add(skull);
  const muzzle = sphere(0.17, scaleDark, {}, 8, 6);
  muzzle.scale.set(1.05, 0.72, 0.95);
  muzzle.position.set(0, -0.1, 0.22);
  head.add(muzzle);
  for (const sx of [-1, 1]) {
    const nostril = blob(0.02, 0x2c3644);
    nostril.position.set(sx * 0.06, -0.06, 0.38);
    head.add(nostril);
  }
  for (const e of eyePair(0.14, 0.06, 0.21, 0.105, { iris: 0x4a2f8c, irisR: 0.62 }, 0.085)) {
    head.add(e);
  }
  // Two swept-back horns with white tips + two small nubs.
  for (const sx of [-1, 1] as const) {
    const horn = cone(0.075, 0.3, wingC, 6);
    horn.rotation.x = -1.0;
    horn.position.set(sx * 0.13, 0.22, -0.08);
    head.add(horn);
    const tip = blob(0.045, tipC);
    tip.position.set(sx * 0.13, 0.3, -0.16);
    head.add(tip);
    const nub = cone(0.04, 0.1, wingC, 5);
    nub.rotation.x = -0.9;
    nub.position.set(sx * 0.05, 0.27, 0.05);
    head.add(nub);
  }
  g.add(head);

  // Stubby bat wings — kite membranes on little arm struts; animatable pair.
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Group();
    wing.position.set(sx * 0.34, 0.78, -0.12); // shoulder pivot
    const strut = capsule(0.035, 0.16, scaleDark, { flat: true }, 2, 6);
    strut.rotation.z = sx * 1.25;
    strut.position.set(sx * 0.1, 0.05, 0);
    wing.add(strut);
    const membrane = cone(0.24, 0.44, wingC, 4, { flat: true });
    membrane.scale.z = 0.14;
    membrane.rotation.z = sx * 1.9;
    membrane.position.set(sx * 0.3, 0.06, -0.02);
    wing.add(membrane);
    const membrane2 = cone(0.16, 0.3, wingC, 4, { flat: true });
    membrane2.scale.z = 0.14;
    membrane2.rotation.z = sx * 2.3;
    membrane2.position.set(sx * 0.34, -0.08, -0.02);
    wing.add(membrane2);
    wings.push(wing);
    g.add(wing);
  }

  // Thick tapering tail with a purple spike pair; animatable.
  const tail = new THREE.Group();
  tail.position.set(0, 0.38, -0.34);
  const tail1 = capsule(0.13, 0.26, scale, {}, 2, 8);
  tail1.rotation.x = Math.PI / 2 - 0.35;
  tail1.position.set(0, -0.02, -0.16);
  tail.add(tail1);
  const tail2 = capsule(0.08, 0.2, scale, {}, 2, 7);
  tail2.rotation.x = Math.PI / 2 - 0.2;
  tail2.position.set(0, -0.1, -0.42);
  tail.add(tail2);
  for (const [tz, r] of [
    [-0.3, 0.06],
    [-0.5, 0.05],
  ] as const) {
    const spike = cone(r, r * 2.4, wingC, 5);
    spike.rotation.x = -0.7;
    spike.position.set(0, 0.02, tz);
    tail.add(spike);
  }
  const tailTip = cone(0.05, 0.14, wingC, 5);
  tailTip.rotation.x = Math.PI / 2 + 0.25;
  tailTip.position.set(0, -0.16, -0.58);
  tail.add(tailTip);
  g.add(tail);

  // Four stubby legs with white claw toes.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.2, 0.34, sz * 0.16, 0.085, 0.105, 0.34, scale, 0, tipC);
    legs.push(l);
    g.add(l);
  }
  if (rng() < 0.35) {
    // Some individuals carry a chipped white fleck on one horn (weathering
    // roll) — parented to the HEAD so it bakes into the head bucket.
    const chip = blob(0.028, tipC);
    chip.position.set(0.2, 0.26, -0.24);
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
  // Consolidate the authored primitives into 1-2 merged meshes per animatable
  // part (vertex-coloured; see the draw-call baking block above).
  bakeCritterGroup(out.group, out.parts);
  // Per-individual uniform scale (±10% by default; see CRITTER_VARIATION).
  const s = CRITTER_VARIATION.scaleMin + rng() * CRITTER_VARIATION.scaleRange;
  out.group.scale.setScalar(s);
  return out;
}
