import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CRITTER_VARIATION } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';

// Procedural critter models — "Neopets released a Valheim competitor", round 2.
// Round 1 read as faceted polyhedra ("still too boxy"); round 2's ingredient is
// SMOOTHNESS and PLUMPNESS. Bodies/heads/limbs are now SMOOTH-SHADED organic
// volumes at 8-16 segments (soft-toy read): squashed spheres, capsules and
// bottom-heavy egg/pear LatheGeometry profiles. Flat faceting survives ONLY
// where it is material identity — prismhorse crystal, craghorn horn ridges,
// the gloomgobbler's softly-faceted shadow-ball.
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
  const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 4, 3), mat(0xffffff));
  hi.position.set(-r * 0.22, r * 0.26, r * 0.56);
  g.add(hi);
  return g;
}

/** A symmetric pair of eyes on the +Z face of a head, spaced by `sep`, with a
 *  slight outward toe so they read as looking at you rather than cross-eyed. */
function eyePair(sep: number, y: number, z: number, r: number, o: EyeOpts = {}, toe = 0.12): THREE.Group[] {
  const out: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const e = eye(r, o);
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

/**
 * Puffle — a marquee face. A bottom-heavy cream egg-fluffball: the whole
 * critter is basically head. Huge close-set friendly eyes, a tiny nose over a
 * little smile, soft cheek-blush pads, a plump two-lobe tuft and stubby feet.
 */
function buildPuffle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0xdcc99a, rng, 0.06);
  const furDark = jitterColor(0xc4ad7d, rng, 0.05);
  const noseC = jitterColor(0xb87a5a, rng, 0.04);
  const blushC = jitterColor(0xdfa183, rng, 0.03);

  // Body: one plump bottom-heavy egg — pure Neopets silhouette.
  const body = new THREE.Group();
  const shell = egg(0.44, 0.92, fur, {}, 0.32);
  body.add(shell);
  // Soft jowl cheeks low on the sides of the face, tucked into the egg.
  for (const sx of [-1, 1]) {
    const cheek = sphere(0.115, fur, {}, 7, 5);
    cheek.position.set(sx * 0.26, 0.35, 0.21);
    body.add(cheek);
  }
  g.add(body);

  // Head handle — big close-set eyes on the upper-front face, nose + smile +
  // blush below. Parented to root so body bob never distorts the features.
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0.2);
  for (const e of eyePair(0.145, 0.04, 0.15, 0.14, { irisR: 0.74 }, 0.08)) head.add(e);
  const nose = blob(0.045, noseC);
  nose.position.set(0, -0.1, 0.26);
  head.add(nose);
  const mouth = smile(0.05, 0.011);
  mouth.position.set(0, -0.16, 0.25);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const b = blush(0.075, blushC);
    b.position.set(sx * 0.27, -0.1, 0.17);
    b.rotation.y = sx * 0.55;
    head.add(b);
  }
  g.add(head);

  // Plump two-lobe tuft on top.
  const tuft = new THREE.Group();
  tuft.position.set(0, 0.9, 0.0);
  const t1 = sphere(0.12, furDark, {}, 8, 6);
  t1.scale.set(1, 0.85, 1);
  tuft.add(t1);
  const t2 = sphere(0.08, fur, {}, 7, 5);
  t2.position.set(0.02, 0.1, 0.01);
  tuft.add(t2);
  g.add(tuft);

  // Stubby rounded feet peeking out under the egg rim.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.18, 0.14, sz * 0.14, 0.08, 0.09, 0.14, furDark);
    legs.push(l);
    g.add(l);
  }

  // Weathering: an off-centre extra fluff-cowlick on some individuals.
  const wRoll = rng();
  if (wRoll < 0.4) {
    const cow = sphere(0.06, furDark, {}, 6, 4);
    cow.position.set(0.14, 0.84, -0.05);
    g.add(cow);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Skitterling — a plump rounded beetle-bug. Smooth domed two-tone shell, a
 * round head with big eyes, a tiny smile and springy bobble antennae, six
 * stubby splayed legs.
 */
function buildSkitterling(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shell = jitterColor(0x8a6d4a, rng, 0.05);
  const shellDark = jitterColor(0x5f4a30, rng, 0.04);

  const body = new THREE.Group();
  body.position.y = 0.22;
  // Smooth plump carapace: a squashed dome, elongated along Z.
  const carapace = sphere(0.3, shell, {}, 12, 8);
  carapace.scale.set(1.08, 0.78, 1.5);
  body.add(carapace);
  // Darker smooth dome ridge on top.
  const dome = sphere(0.22, shellDark, {}, 11, 8);
  dome.scale.set(0.92, 0.7, 1.1);
  dome.position.set(0, 0.09, -0.04);
  body.add(dome);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.26, 0.4);
  const hb = sphere(0.17, shellDark, {}, 9, 7);
  hb.scale.set(1, 0.92, 0.92);
  head.add(hb);
  for (const e of eyePair(0.085, 0.04, 0.12, 0.07, { irisR: 0.62 }, 0.16)) head.add(e);
  const mouth = smile(0.03, 0.008, 0x241b12);
  mouth.position.set(0, -0.05, 0.155);
  head.add(mouth);
  // Curved antennae (thin tapered cyls) with plump bobble tips.
  for (const sx of [-1, 1]) {
    const a = cyl(0.008, 0.02, 0.26, shellDark, 4);
    a.position.set(sx * 0.07, 0.16, 0.04);
    a.rotation.set(-0.6, 0, sx * 0.4);
    head.add(a);
    const tip = blob(0.035, shell);
    tip.position.set(sx * 0.13, 0.32, 0.14);
    head.add(tip);
  }
  g.add(head);

  // Six low stubby legs, splayed outward.
  const legs: THREE.Object3D[] = [];
  for (const sz of [0.2, 0, -0.2]) {
    for (const sx of [-1, 1]) {
      const l = legGroup(sx * 0.2, 0.16, sz, 0.03, 0.045, 0.17, shellDark, sx * 0.55);
      legs.push(l);
      g.add(l);
    }
  }

  const wRoll = rng();
  if (wRoll < 0.35) {
    // Chipped shell edge — a small notch dome pushed in.
    const notch = sphere(0.06, shellDark, {}, 5, 4);
    notch.position.set(0.16, 0.28, -0.18);
    g.add(notch);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Bellowbuck — a big plump elk/moose strider. Smooth rounded barrel with a
 * lighter belly, a thick neck, a big-cheeked soft head with plump ears, chunky
 * ORGANIC antlers (smooth tapered branches), strider legs and a flick tail.
 */
function buildBellowbuck(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const hide = jitterColor(0x6b5236, rng, 0.04);
  const hideLight = jitterColor(0x8a6d47, rng, 0.03);
  const antlerC = jitterColor(0xcabf9a, rng, 0.02, 0.05);

  const body = new THREE.Group();
  body.position.y = 1.35;
  const barrel = capsule(0.44, 0.66, hide, {}, 2, 8);
  barrel.rotation.x = Math.PI / 2; // lie along Z
  body.add(barrel);
  // Lighter plump underbelly, slightly bottom-heavy.
  const belly = capsule(0.36, 0.5, hideLight, {}, 2, 6);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = -0.17;
  body.add(belly);
  // Soft shoulder hump for a moose-y silhouette.
  const hump = sphere(0.3, hide, {}, 6, 4);
  hump.scale.set(0.95, 0.88, 0.85);
  hump.position.set(0, 0.24, 0.34);
  body.add(hump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.62, 0.62);
  const neck = capsule(0.18, 0.4, hide, {}, 2, 6);
  neck.rotation.x = -0.6;
  head.add(neck);
  const skull = sphere(0.23, hideLight, {}, 10, 7);
  skull.scale.set(1, 0.95, 1.15);
  skull.position.set(0, 0.34, 0.28);
  head.add(skull);
  // Big soft plump muzzle.
  const muzzle = sphere(0.15, hide, {}, 6, 4);
  muzzle.scale.set(0.95, 0.85, 1.1);
  muzzle.position.set(0, 0.26, 0.48);
  head.add(muzzle);
  for (const e of eyePair(0.14, 0.44, 0.42, 0.085, { irisR: 0.6 }, 0.16)) head.add(e);
  // Plump rounded ears.
  for (const sx of [-1, 1]) {
    const ear = plumpEar(0.09, hide);
    ear.position.set(sx * 0.19, 0.5, 0.2);
    ear.rotation.z = sx * 0.7;
    head.add(ear);
  }
  // Chunky ORGANIC antlers: a smooth connected beam curling up-and-out, plus a
  // couple of rounded tines per side (soft, not spiky).
  const chipRoll = rng();
  for (const sx of [-1, 1]) {
    // Some bucks have a snapped-short left antler.
    const chipped = chipRoll < 0.3 && sx === -1;
    const beamPts: ReadonlyArray<readonly [number, number, number]> = [
      [sx * 0.13, 0.42, 0.18],
      [sx * 0.24, 0.62, 0.16],
      [sx * 0.34, 0.82, 0.12],
      [sx * 0.4, 1.0, 0.06],
    ];
    head.add(segmentedHorn(chipped ? beamPts.slice(0, 3) : beamPts, 0.06, 0.025, antlerC, {}, 5));
    if (!chipped) {
      for (const [ty, tzr, ta] of [
        [0.66, 0.2, 0.9],
        [0.84, 0.16, 1.1],
      ] as const) {
        const tine = capsule(0.028, 0.15, antlerC, {}, 1, 5);
        tine.position.set(sx * (0.26 + (ty - 0.66) * 0.55), ty, tzr);
        tine.rotation.z = sx * ta;
        head.add(tine);
      }
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.25, 1.02, sz * 0.4, 0.1, 0.12, 1.02, hide, 0, 0x33251a);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.45, -0.6);
  const tm = capsule(0.06, 0.24, hide, {}, 2, 5);
  tm.position.z = -0.16;
  tm.rotation.x = Math.PI / 2 - 0.3;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Mirefin — a plump amphibious newt/tadpole. Fat smooth body with a pale
 * belly, big high-set froggy eyes over a wide happy smile, soft rounded dorsal
 * lobes (not spikes), stubby fin-feet and a broad rounded tail paddle.
 */
function buildMirefin(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const skin = jitterColor(0x496a6a, rng, 0.05);
  const belly = jitterColor(0x9db09f, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.3;
  const torso = capsule(0.3, 0.5, skin, {}, 3, 9);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const bel = capsule(0.22, 0.38, belly, {}, 2, 7);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.14;
  body.add(bel);
  // Soft rounded dorsal lobes (plump, not fin-spikes).
  for (const [z, s] of [
    [0.2, 0.8],
    [-0.02, 1.0],
    [-0.24, 0.8],
  ] as const) {
    const f = sphere(0.09 * s, skin, {}, 6, 4);
    f.scale.set(0.45, 1.25, 0.9);
    f.position.set(0, 0.28, z);
    body.add(f);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.36, 0.44);
  const hb = sphere(0.24, skin, {}, 9, 7);
  hb.scale.set(1.08, 0.85, 0.95);
  head.add(hb);
  // Bulging froggy eyes set high and close.
  for (const e of eyePair(0.14, 0.15, 0.12, 0.095, { irisR: 0.6 }, 0.2)) head.add(e);
  const snout = sphere(0.13, belly, {}, 7, 5);
  snout.scale.set(1.15, 0.75, 1.0);
  snout.position.set(0, -0.06, 0.16);
  head.add(snout);
  // Wide happy frog smile.
  const mouth = smile(0.085, 0.013, 0x22312e, 2.0);
  mouth.position.set(0, 0.0, 0.26);
  head.add(mouth);
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.15, sz * 0.26, 0.045, 0.07, 0.15, skin, sx * 0.5);
    legs.push(l);
    g.add(l);
  }
  // Broad rounded tail paddle.
  const tail = new THREE.Group();
  tail.position.set(0, 0.3, -0.46);
  const paddle = sphere(0.22, skin, {}, 8, 6);
  paddle.scale.set(1.25, 1.0, 0.3);
  paddle.position.z = -0.2;
  tail.add(paddle);
  g.add(tail);

  const wRoll = rng();
  if (wRoll < 0.35) {
    // A nicked tail fin — a small notch of belly colour.
    const nick = blob(0.05, belly);
    nick.position.set(0.16, 0.4, -0.6);
    g.add(nick);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Craghorn — a stocky mountain ram. Plump woolly body, a broad soft head with
 * a rounded beard, big curled ram horns — the horn keeps its RIDGED FACETING
 * (material identity), everything else is smooth — and chunky legs.
 */
function buildCraghorn(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const wool = jitterColor(0x8b8a86, rng, 0.02, 0.06);
  const woolDark = jitterColor(0x5f5d59, rng, 0.02, 0.05);
  const hornC = jitterColor(0x6a5a44, rng, 0.03, 0.05);

  const body = new THREE.Group();
  body.position.y = 0.72;
  const barrel = capsule(0.36, 0.46, wool, {}, 3, 9);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  // Plump woolly shoulder lump.
  const woolLump = sphere(0.31, wool, {}, 9, 7);
  woolLump.scale.set(1.05, 0.95, 0.85);
  woolLump.position.set(0, 0.1, 0.24);
  body.add(woolLump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.9, 0.46);
  const skull = sphere(0.21, woolDark, {}, 9, 7);
  skull.scale.set(1, 1, 1.12);
  head.add(skull);
  const muzzle = sphere(0.12, wool, {}, 7, 5);
  muzzle.scale.set(1, 0.88, 1.05);
  muzzle.position.set(0, -0.05, 0.18);
  head.add(muzzle);
  for (const e of eyePair(0.13, 0.07, 0.16, 0.08, { irisR: 0.58 }, 0.14)) head.add(e);
  // Soft rounded beard (a plump teardrop, not a spike).
  const beard = sphere(0.08, woolDark, {}, 6, 4);
  beard.scale.set(0.8, 1.5, 0.7);
  beard.position.set(0, -0.19, 0.12);
  head.add(beard);
  // Big bighorn-ram curl: connected tapered segments sweeping OUT/back off the
  // brow, then curling down and forward under the ear. Kept RIDGED (flat).
  const chipRoll = rng();
  for (const sx of [-1, 1]) {
    // Some rams have a snapped-short horn on the right — drop the last point.
    const chipped = chipRoll < 0.35 && sx === 1;
    const pts: ReadonlyArray<readonly [number, number, number]> = [
      [sx * 0.14, 0.14, 0.02],
      [sx * 0.28, 0.26, -0.02],
      [sx * 0.4, 0.2, -0.18],
      [sx * 0.42, 0.03, -0.26],
      [sx * 0.34, -0.08, -0.16],
    ];
    head.add(segmentedHorn(chipped ? pts.slice(0, 4) : pts, 0.09, 0.03, hornC, { flat: true }, 5));
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.54, sz * 0.28, 0.09, 0.11, 0.54, woolDark, 0, 0x2f2b24);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Zephyrfinch — a plump round songbird. Bottom-heavy egg body with a warm
 * chest, an oversized round head with big close eyes and a little beak, soft
 * rounded tail plumes and plump folded wings.
 */
function buildZephyrfinch(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const feather = jitterColor(0x466f9f, rng, 0.06);
  const belly = jitterColor(0xd6ab52, rng, 0.05);
  const beakC = jitterColor(0xe6a030, rng, 0.03);
  const legC = jitterColor(0xe6a030, rng, 0.02);

  const body = new THREE.Group();
  body.position.y = 0.34;
  // Plump bottom-heavy egg torso.
  const torso = egg(0.22, 0.46, feather, {}, 0.3, 12);
  body.add(torso);
  const chest = sphere(0.16, belly, {}, 8, 6);
  chest.scale.set(0.95, 1.05, 0.75);
  chest.position.set(0, 0.18, 0.12);
  body.add(chest);
  // Soft rounded tail plumes (flattened capsules, not cone spikes).
  const tail = new THREE.Group();
  tail.position.set(0, 0.16, -0.14);
  for (const [sx, rz] of [
    [-1, 0.3],
    [0, 0],
    [1, -0.3],
  ] as const) {
    const f = capsule(0.05, 0.22, feather, {}, 2, 5);
    f.rotation.x = Math.PI / 2 + 0.45;
    f.rotation.z = rz;
    f.position.set(sx * 0.06, 0.0, -0.15);
    f.scale.set(1, 1, 0.5);
    tail.add(f);
  }
  body.add(tail);
  g.add(body);

  // Oversized round head — near half the bird.
  const head = new THREE.Group();
  head.position.set(0, 0.82, 0.1);
  const hb = sphere(0.19, feather, {}, 10, 7);
  head.add(hb);
  for (const e of eyePair(0.095, 0.035, 0.13, 0.075, { irisR: 0.66 }, 0.18)) head.add(e);
  const beak = cone(0.05, 0.13, beakC, 8);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.03, 0.22);
  head.add(beak);
  // Plump little crest bobble.
  const crest = blob(0.055, belly);
  crest.position.set(0, 0.19, 0.02);
  head.add(crest);
  g.add(head);

  // Plump folded wings (pivot at shoulder, flap about Z).
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.16, 0.56, 0);
    const wm = capsule(0.07, 0.24, feather, {}, 2, 7);
    wm.rotation.z = Math.PI / 2;
    wm.rotation.y = sx * -0.35;
    wm.scale.set(1, 1, 0.55);
    wm.position.set(sx * 0.16, 0, -0.03);
    w.add(wm);
    wings.push(w);
    g.add(w);
  }

  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.08, 0.36, -0.02, 0.02, 0.028, 0.12, legC);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/**
 * Emberpup — THE marquee cutie. A plump fox-pup where the head is nearly half
 * the pup: HUGE close eyes, cream cheeks with warm blush pads, a tiny smile
 * under the button nose, plump rounded ears with glowing ember tips, stubby
 * paws and a fat plume tail with a glowing tip.
 */
function buildEmberpup(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xcc6430, rng, 0.04);
  const cream = jitterColor(0xe8c48a, rng, 0.04);
  const blushC = jitterColor(0xe08a5a, rng, 0.03);
  const ember = 0xff7a2a;

  const body = new THREE.Group();
  body.position.y = 0.42;
  const torso = capsule(0.23, 0.3, coat, {}, 2, 7);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const bel = capsule(0.17, 0.24, cream, {}, 2, 4);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.1;
  body.add(bel);
  g.add(body);

  // Oversized head — the charm centre, nearly half the visual mass.
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.32);
  const skull = sphere(0.27, coat, {}, 12, 9);
  skull.scale.set(1.02, 0.95, 0.9);
  head.add(skull);
  // Cream cheeks + warm blush pads.
  for (const sx of [-1, 1]) {
    const cheek = sphere(0.11, cream, {}, 6, 4);
    cheek.position.set(sx * 0.16, -0.08, 0.14);
    head.add(cheek);
    const b = blush(0.06, blushC);
    b.position.set(sx * 0.18, -0.02, 0.19);
    b.rotation.y = sx * 0.5;
    head.add(b);
  }
  // Soft snout, button nose, tiny smile.
  const snout = sphere(0.1, cream, {}, 6, 4);
  snout.scale.set(0.95, 0.75, 1.1);
  snout.position.set(0, -0.08, 0.22);
  head.add(snout);
  const nose = blob(0.042, 0x2a1c14);
  nose.position.set(0, -0.04, 0.33);
  head.add(nose);
  const mouth = smile(0.04, 0.01);
  mouth.position.set(0, -0.1, 0.31);
  head.add(mouth);
  // HUGE close-set eyes.
  for (const e of eyePair(0.125, 0.07, 0.19, 0.12, { irisR: 0.7 }, 0.1)) head.add(e);
  // Plump rounded ears with glowing ember tips (never spikes).
  const notchRoll = rng();
  for (const sx of [-1, 1]) {
    // Weathering: a notched (short) left ear on some pups; keep the glow tip
    // draw unconditional either way.
    const short = notchRoll < 0.3 && sx === -1;
    const ear = plumpEar(0.1, coat);
    // Stubbier, rounder pup ears (plush read; the squash keeps them un-spiky).
    ear.scale.set(0.8, short ? 0.9 : 1.15, 0.52);
    ear.position.set(sx * 0.15, short ? 0.22 : 0.25, -0.01);
    ear.rotation.z = sx * -0.2;
    head.add(ear);
    const inner = sphere(0.05, cream, {}, 4, 3);
    inner.scale.set(0.6, 1.1, 0.4);
    inner.position.set(sx * 0.14, short ? 0.22 : 0.25, 0.035);
    head.add(inner);
    const tip = sphere(0.035, 0xffb060, { emissive: ember, emissiveIntensity: 1.0 }, 6, 4);
    tip.position.set(sx * 0.145, short ? 0.3 : 0.38, -0.02);
    head.add(tip);
  }
  g.add(head);

  // Soft rounded pup paws (no hooves) — tapered stubby legs.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.14, 0.3, sz * 0.17, 0.06, 0.085, 0.3, coat);
    legs.push(l);
    g.add(l);
  }
  // Fat plume tail with a glowing ember tip.
  const tail = new THREE.Group();
  tail.position.set(0, 0.48, -0.26);
  const plume = capsule(0.11, 0.2, coat, {}, 2, 5);
  plume.rotation.x = -0.5;
  plume.position.set(0, 0.06, -0.15);
  tail.add(plume);
  const ttip = sphere(0.085, 0xffb060, { emissive: ember, emissiveIntensity: 0.8 }, 6, 4);
  ttip.position.set(0, 0.19, -0.3);
  tail.add(ttip);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Lumenstag — a marquee ethereal deer. Smooth graceful body with a plump
 * chest, a gentle big-eyed head on a slender neck, GLOWING branched antlers
 * (pale cyan emissive, smooth), plump ears and a soft plume tail.
 */
function buildLumenstag(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe2e6ec, rng, 0.02, 0.05);
  const shade = jitterColor(0xc0c8d4, rng, 0.02, 0.04);
  const glow = 0x9be8ff;

  const body = new THREE.Group();
  body.position.y = 1.3;
  const barrel = capsule(0.35, 0.68, coat, {}, 2, 8);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  const bel = capsule(0.28, 0.5, shade, {}, 2, 6);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.14;
  body.add(bel);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.66, 0.6);
  const neck = capsule(0.13, 0.5, coat, {}, 2, 6);
  neck.rotation.x = -0.5;
  head.add(neck);
  const skull = sphere(0.18, shade, {}, 11, 8);
  skull.scale.set(1, 0.95, 1.2);
  skull.position.set(0, 0.36, 0.26);
  head.add(skull);
  const muzzle = sphere(0.1, coat, {}, 6, 4);
  muzzle.scale.set(0.9, 0.8, 1.1);
  muzzle.position.set(0, 0.28, 0.42);
  head.add(muzzle);
  for (const e of eyePair(0.115, 0.44, 0.38, 0.08, { irisR: 0.62 }, 0.16)) head.add(e);
  // Plump soft ears.
  for (const sx of [-1, 1]) {
    const ear = plumpEar(0.075, coat);
    ear.position.set(sx * 0.15, 0.5, 0.18);
    ear.rotation.z = sx * 0.6;
    head.add(ear);
  }
  // GLOWING branched antlers — smooth organic tapered beams + rounded tines.
  for (const sx of [-1, 1]) {
    const beam = cyl(0.02, 0.045, 0.66, glow, 6, { emissive: glow, emissiveIntensity: 1.4 });
    beam.position.set(sx * 0.12, 0.76, 0.16);
    beam.rotation.z = sx * 0.3;
    head.add(beam);
    for (const [ty, tz, ta] of [
      [0.68, 0.18, 0.9],
      [0.92, 0.18, 1.1],
      [1.14, 0.16, 1.3],
    ] as const) {
      const tine = capsule(0.022, 0.2, glow, { emissive: glow, emissiveIntensity: 1.4 }, 1, 4);
      tine.position.set(sx * (0.2 + (ty - 0.68) * 0.4), ty, tz);
      tine.rotation.z = sx * ta;
      head.add(tine);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 1.02, sz * 0.4, 0.055, 0.075, 1.02, shade, 0, 0xaeb8c6);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.4, -0.56);
  const tm = capsule(0.06, 0.2, coat, {}, 2, 6);
  tm.rotation.x = Math.PI / 2 - 0.3;
  tm.position.z = -0.13;
  tail.add(tm);
  g.add(tail);

  const wRoll = rng();
  if (wRoll < 0.3) {
    // A faint extra glow-mote drifting near an antler on some stags.
    const mote = blob(0.03, 0xdff6ff, { emissive: glow, emissiveIntensity: 1.6 });
    mote.position.set(0.34, 2.4, 0.5);
    g.add(mote);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

// --- Haven Village whimsy pass (+4) ------------------------------------------

/**
 * Prismhorse — THE mount. Horse-scaled beast of clustered translucent crystal
 * prisms (faceting KEPT — crystal is its material identity), SIXTEEN thin
 * crystalline stilt legs in two rows of eight (phase-offset skitter wave, see
 * animation.ts), two long antennae tipped with glowing bobbles that lag/spring,
 * and a small big-eyed head. Faces +Z; the leg rows run along Z so the wave
 * travels head→tail. Body envelope preserved for the mount camera
 * (MOUNT.rideForwardOffset).
 */
function buildPrismhorse(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const tint = jitterColor(0xcdeaff, rng, 0.05, 0.04); // pale iridescent
  const deep = jitterColor(0x9fc8ff, rng, 0.05, 0.04);
  const ice = jitterColor(0xdff2ff, rng, 0.04, 0.03); // bright icy legs
  const glow = 0xaad4ff;
  const crys: MatOpts = { opacity: 0.82, emissive: glow, emissiveIntensity: 0.4 };
  const legCrys: MatOpts = { opacity: 0.8, emissive: glow, emissiveIntensity: 0.7, flat: true };

  // Body: a clustered crystal core at horse height with faceted shoulders/rump
  // and a jagged dorsal ridge of upward-jutting prisms. Envelope kept ~1.7 long,
  // radius ~0.5, ridge at z −0.15..−0.62 to clear the rider camera.
  const bodyY = 1.35;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const core = crystal(0.62, tint, crys);
  core.scale.set(0.85, 0.8, 1.5);
  body.add(core);
  const chest = crystal(0.5, deep, crys); // faceted shoulders
  chest.scale.set(0.72, 0.82, 0.72);
  chest.position.set(0, 0.05, 0.55);
  body.add(chest);
  const rump = crystal(0.5, deep, crys);
  rump.scale.set(0.72, 0.82, 0.72);
  rump.position.set(0, 0.05, -0.6);
  body.add(rump);
  const ridge: ReadonlyArray<readonly [number, number]> = [
    [0.6, 0.34], [0.35, 0.5], [0.1, 0.62], [-0.15, 0.56], [-0.4, 0.42], [-0.62, 0.28],
  ];
  for (const [sz, len] of ridge) {
    const sh = crystal(len, tint, crys);
    sh.scale.set(0.3, 1, 0.3);
    sh.position.set((rng() - 0.5) * 0.12, 0.32 + len * 0.4, sz);
    sh.rotation.z = (rng() - 0.5) * 0.3;
    body.add(sh);
  }
  g.add(body);

  // Head: small faceted crystal skull on a short neck, big charming eyes.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.18, 0.86);
  const neck = crystal(0.26, deep, crys);
  neck.scale.set(0.55, 1.2, 0.55);
  neck.rotation.x = -0.5;
  neck.position.set(0, 0.06, 0.04);
  head.add(neck);
  const skull = crystal(0.3, tint, crys);
  skull.scale.set(0.95, 0.85, 1.15);
  skull.position.set(0, 0.36, 0.36);
  head.add(skull);
  for (const e of eyePair(0.13, 0.36, 0.55, 0.095, { sclera: 0xeaf6ff, iris: 0x24506e, irisR: 0.62 }, 0.1)) head.add(e);

  // Two long antennae with glowing bobbles (animated: lag/spring).
  const antennae: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(sx * 0.12, 0.5, 0.36);
    const stalk = cyl(0.02, 0.03, 0.7, deep, 5, { emissive: glow, emissiveIntensity: 0.4, flat: true });
    stalk.position.y = 0.35;
    a.add(stalk);
    const bob = sphere(0.1, 0xdff0ff, { emissive: glow, emissiveIntensity: 1.6 }, 8, 6);
    bob.position.y = 0.72;
    a.add(bob);
    a.rotation.x = -0.25;
    head.add(a);
    antennae.push(a);
  }
  g.add(head);

  // Sixteen thin crystalline stilt legs: two rows (left/right) of eight along Z.
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

  // Slender crystal tail.
  const tail = new THREE.Group();
  tail.position.set(0, bodyY, -0.78);
  const tm = crystal(0.32, tint, crys);
  tm.scale.set(0.4, 0.4, 1.3);
  tm.position.z = -0.22;
  tail.add(tm);
  g.add(tail);

  return { group: g, parts: { legs, head, body, tail, antennae } };
}

/**
 * Bumblewhale — a rotund 2m whale-blimp that drifts. Fat smooth two-tone body,
 * tiny useless flippers (animated as slow "wings"), blunt rounded tail flukes,
 * and a dopey friendly face: huge close eyes and a wide upturned smile arc.
 */
function buildBumblewhale(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const top = jitterColor(0x678aa8, rng, 0.04);
  const belly = jitterColor(0xc6d8de, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 1.15;
  const hull = sphere(1.0, top, {}, 14, 10);
  hull.scale.set(1.35, 0.92, 1.0); // fat blimp
  body.add(hull);
  // Soft lighter belly underside, sunk low so the two-tone boundary reads as a
  // clean waterline (not a jagged intersection).
  const under = sphere(0.96, belly, {}, 14, 9);
  under.scale.set(1.24, 0.5, 0.9);
  under.position.y = -0.42;
  body.add(under);
  // Blunt rounded tail flukes.
  for (const sx of [-1, 1]) {
    const fluke = sphere(0.3, top, {}, 8, 6);
    fluke.scale.set(1.2, 0.3, 0.72);
    fluke.position.set(sx * 0.34, 0.12, -1.28);
    fluke.rotation.y = sx * -0.4;
    body.add(fluke);
  }
  g.add(body);

  // Dopey face: big close eyes + a wide upturned smile arc.
  const head = new THREE.Group();
  head.position.set(0, 1.25, 0.9);
  for (const e of eyePair(0.32, 0.22, 0.42, 0.17, { irisR: 0.6 }, 0.08)) head.add(e);
  const mouth = smile(0.28, 0.038, 0x243038, 1.6);
  mouth.position.set(0, -0.08, 0.44);
  head.add(mouth);
  g.add(head);

  // Tiny useless flippers (flap slowly — reuse the wing channel).
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 1.2, 1.05, 0.1);
    const fin = sphere(0.26, top, {}, 8, 6);
    fin.scale.set(1.4, 0.32, 0.9);
    fin.position.x = sx * 0.22;
    fin.rotation.y = sx * -0.3;
    w.add(fin);
    wings.push(w);
    g.add(w);
  }

  return { group: g, parts: { legs: [], wings, head, body } };
}

/**
 * Snickerdoodle — a pancake-flat meadow cat: very wide, very thin, cookie
 * coloured with darker speckles. It moves by FLIPPING over itself (animation.ts
 * flops the whole body 180° each ~0.5s while moving). Flatness is its identity;
 * the edges are ROUNDED (a smooth squashed sphere, never a slab) and it has a
 * real little face: big eyes, a smile and blush pads. Ears + tail flip with it.
 */
function buildSnickerdoodle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const dough = jitterColor(0xd4a86c, rng, 0.05);
  const speck = jitterColor(0x7a4a26, rng, 0.05);
  const blushC = jitterColor(0xdd9670, rng, 0.03);

  // Everything lives under `body` so the flip rotates the whole critter.
  const body = new THREE.Group();
  body.position.y = 0.17; // pivot just above ground so the flop clears
  // Rounded pancake: a smooth squashed sphere — wide, thin, soft rounded edges.
  const disc = sphere(0.5, dough, {}, 16, 10);
  disc.scale.set(1.7, 0.32, 1.15);
  body.add(disc);
  // Cookie speckles scattered on the top face.
  const spots: ReadonlyArray<readonly [number, number]> = [
    [-0.3, 0.16], [0.28, -0.1], [0.05, 0.2], [-0.12, -0.2], [0.36, 0.14], [-0.36, -0.08],
  ];
  for (const [sx, sz] of spots) {
    const sp = blob(0.045, speck);
    sp.position.set(sx, 0.15, sz);
    body.add(sp);
  }
  // Plump rounded ears poking up from the front edge, plume tail at the back.
  for (const sx of [-1, 1]) {
    const ear = plumpEar(0.085, dough);
    ear.position.set(sx * 0.3, 0.19, 0.3);
    ear.rotation.x = -0.35;
    body.add(ear);
  }
  const tail = capsule(0.05, 0.24, dough, {}, 2, 6);
  tail.rotation.x = Math.PI / 2 - 0.4;
  tail.position.set(0, 0.06, -0.5);
  body.add(tail);
  // A real little face PROUD of the front edge (the disc is 0.575 deep — the
  // features must poke past it or they vanish inside): eyes + nose + smile +
  // blush pads.
  for (const e of eyePair(0.15, 0.07, 0.55, 0.085, { irisR: 0.66 }, 0.12)) body.add(e);
  const nose = blob(0.032, speck);
  nose.position.set(0, 0.01, 0.59);
  body.add(nose);
  const mouth = smile(0.035, 0.009);
  mouth.position.set(0, -0.045, 0.575);
  body.add(mouth);
  for (const sx of [-1, 1]) {
    const b = blush(0.055, blushC);
    b.position.set(sx * 0.33, 0.03, 0.52);
    b.rotation.y = sx * 0.55;
    body.add(b);
  }
  g.add(body);

  const wRoll = rng();
  if (wRoll < 0.4) {
    // An extra bite-mark speckle cluster on some individuals.
    const bite = blob(0.05, speck);
    bite.position.set(0.5, 0.14, -0.2);
    body.add(bite);
  }

  // head handle points at the body too (no separate head anim for the flopper).
  return { group: g, parts: { legs: [], head: body, body } };
}

/**
 * Gloomgobbler — a round forest shadow-ball on two long stilt legs, with
 * enormous glowing lantern eyes, tiny fangs and a wide mouth line. The
 * shadow-ball stays SOFTLY FACETED (its billowing-smoke identity); legs are
 * smooth. Legs take exaggerated slow strides (animation.ts). Faces +Z.
 */
function buildGloomgobbler(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shadow = jitterColor(0x241f30, rng, 0.03, 0.05);
  const legc = jitterColor(0x15121c, rng, 0.02, 0.04);
  const lantern = 0xffd24a;

  const bodyY = 1.0;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const ball = sphere(0.52, shadow, { flat: true }, 9, 7);
  ball.scale.set(1.05, 1.12, 1.0);
  body.add(ball);
  // A couple of soft shadow lobes so the ball reads as billowing, not a globe.
  for (const sx of [-1, 1]) {
    const lobe = sphere(0.25, shadow, { flat: true }, 7, 5);
    lobe.position.set(sx * 0.4, -0.12, -0.1);
    body.add(lobe);
  }
  g.add(body);

  // Head handle = face cluster on the front of the ball.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.06, 0.38);
  // Enormous glowing lantern eyes (glowing sclera + dark pupil + highlight).
  for (const e of eyePair(0.19, 0.08, 0.08, 0.18, {
    sclera: 0xfff0b0,
    scleraEmissive: lantern,
    scleraEmissiveIntensity: 1.7,
    iris: 0x140f04,
    irisR: 0.44,
  }, 0.05)) head.add(e);
  // Wide mouth line + tiny fangs.
  const mouth = capsule(0.03, 0.3, 0x0c0a12, {}, 2, 6);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.2, 0.16);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const fang = cone(0.025, 0.07, 0xf4ecd4, 5);
    fang.rotation.x = Math.PI;
    fang.position.set(sx * 0.1, -0.16, 0.18);
    head.add(fang);
  }
  g.add(head);

  // Two long stilt legs.
  const legs: THREE.Object3D[] = [];
  const legLen = bodyY - 0.42;
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.18, bodyY - 0.42, 0, 0.045, 0.06, legLen, legc, 0, 0x0c0a12);
    legs.push(l);
    g.add(l);
  }

  const wRoll = rng();
  if (wRoll < 0.35) {
    // A stray wisp curl on top of some gobblers.
    const wisp = cone(0.06, 0.2, shadow, 7);
    wisp.position.set(0.1, bodyY + 0.55, -0.05);
    wisp.rotation.z = 0.4;
    g.add(wisp);
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

const BUILDERS: Record<string, (rng: () => number) => { group: THREE.Group; parts: CritterParts }> = {
  puffle: buildPuffle,
  skitterling: buildSkitterling,
  bellowbuck: buildBellowbuck,
  mirefin: buildMirefin,
  craghorn: buildCraghorn,
  zephyrfinch: buildZephyrfinch,
  emberpup: buildEmberpup,
  lumenstag: buildLumenstag,
  prismhorse: buildPrismhorse,
  bumblewhale: buildBumblewhale,
  snickerdoodle: buildSnickerdoodle,
  gloomgobbler: buildGloomgobbler,
  gargoyle: buildGargoyle,
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
