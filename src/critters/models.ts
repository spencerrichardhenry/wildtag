import * as THREE from 'three';
import { CRITTER_VARIATION } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';

// Procedural critter models — "Neopets released a Valheim competitor". Each
// species is SCULPTED from low-segment organic primitives (squashed spheres,
// capsules, tapered cones/cylinders, octahedron crystals) with flatShading kept
// ON for the faceted low-poly Valheim read. The charm is in the proportions:
// rounded chunky bodies, oversized heads and expressive eyes (white sclera +
// coloured iris + a tiny highlight dot), soft cheeks, stubby limbs and plume
// tails. Palette is muted-but-rich; darker underbellies come from a separate
// tinted belly part. Per-individual rng jitters colour/scale AND rolls small
// weathering accents (a horn chip, an ear notch) so no two look cloned.
//
// BoxGeometry is BANNED as a primary body/head form — only small accents
// (hooves, teeth, noses, smile segments) may still be little boxes.
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
};

// Quality-gated (P3): MeshStandardMaterial (roughness 0.8) on medium+, the
// identical-look flat-shaded MeshLambertMaterial on low. Emissive glow +
// translucency (prismhorse crystal) pass through both paths unchanged.
function mat(color: number, opts: MatOpts = {}): THREE.Material {
  return makeSurfaceMaterial({
    color,
    flatShading: true,
    roughness: ROUGHNESS.critter,
    ...(opts.emissive !== undefined
      ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 }
      : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
  });
}

// --- primitive helpers (all flat-shaded, low-segment = faceted Valheim look) --

/** A faceted sphere — the workhorse for rounded chunky bodies/heads. Kept at a
 *  low segment count for the faceted Valheim read (and the tri budget). */
function sphere(r: number, color: number, opts: MatOpts = {}, ws = 6, hs = 4): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat(color, opts));
}

/** Cheap low-poly sphere for tips / speckles / small bits. */
function blob(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 4, 3), mat(color, opts));
}

/** A rounded capsule (axis = Y). Chunky limbs, sleek bodies. */
function capsule(
  r: number,
  len: number,
  color: number,
  opts: MatOpts = {},
  cap = 2,
  rad = 6,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, cap, rad), mat(color, opts));
}

function cone(r: number, h: number, color: number, seg = 5, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, opts));
}

function cyl(
  rt: number,
  rb: number,
  h: number,
  color: number,
  seg = 6,
  opts: MatOpts = {},
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
}

/** Small accent box (hooves / teeth / noses / smile segments only). */
function box(w: number, h: number, d: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

/** An octahedron primitive (crystal prism look), flat-shaded. */
function crystal(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), mat(color, opts));
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
 * One eye as a small group facing +Z: a white sclera sphere, a coloured iris
 * disc on the front, and a tiny white highlight dot (the single detail that
 * does most of the charm work). Caller positions/rotates the returned group.
 */
function eye(r: number, o: EyeOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const scleraOpts: MatOpts =
    o.scleraEmissive !== undefined
      ? { emissive: o.scleraEmissive, emissiveIntensity: o.scleraEmissiveIntensity ?? 1.4 }
      : {};
  const sc = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat(o.sclera ?? 0xf4efe2, scleraOpts));
  g.add(sc);
  const ir = new THREE.Mesh(
    new THREE.SphereGeometry(r * (o.irisR ?? 0.62), 5, 3),
    mat(o.iris ?? 0x2b211a),
  );
  ir.position.z = r * 0.52;
  ir.scale.z = 0.5;
  g.add(ir);
  const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 4, 2), mat(0xffffff));
  hi.position.set(-r * 0.24, r * 0.28, r * 0.6);
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
  const m = cyl(rTop, rBot, h, color, 5);
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
 * Puffle — a marquee face. A round cream fluffball: an oversized head fused
 * into a squashed body, huge friendly eyes, soft cheeks, a tiny nose, a curly
 * plume tuft and stubby feet. Charm-first.
 */
function buildPuffle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0xdcc99a, rng, 0.06);
  const furDark = jitterColor(0xc4ad7d, rng, 0.05);

  // Body: a plump squashed sphere sitting low. Head is fused as a big front lobe.
  const body = new THREE.Group();
  body.position.y = 0.42;
  const belly = sphere(0.4, fur, {}, 6, 5);
  belly.scale.set(1.05, 0.9, 1.0);
  body.add(belly);
  // Soft cheek lobes for that chubby read.
  for (const sx of [-1, 1]) {
    const cheek = sphere(0.17, fur, {}, 5, 4);
    cheek.position.set(sx * 0.24, 0.02, 0.2);
    body.add(cheek);
  }
  g.add(body);

  // Head handle — big eyes + nose on the front upper face. Parented to root so
  // the body squash never distorts the features.
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.24);
  for (const e of eyePair(0.16, 0.07, 0.18, 0.12, { irisR: 0.66 }, 0.14)) head.add(e);
  // Little rounded brows/tufts above the eyes.
  const nose = cone(0.055, 0.09, jitterColor(0xb87a5a, rng, 0.04), 6);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 0.28);
  head.add(nose);
  g.add(head);

  // Curly plume tuft on top (root-parented so it isn't squashed).
  const tuft = new THREE.Group();
  tuft.position.set(0, 0.78, 0.02);
  const t1 = sphere(0.12, furDark, {}, 6, 4);
  tuft.add(t1);
  const t2 = sphere(0.08, fur, {}, 5, 4);
  t2.position.set(0.02, 0.11, 0.01);
  tuft.add(t2);
  g.add(tuft);

  // Stubby rounded feet.
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.17, 0.15, sz * 0.13, 0.08, 0.09, 0.15, furDark);
    legs.push(l);
    g.add(l);
  }

  // Weathering: an off-centre extra fluff-cowlick on some individuals.
  const wRoll = rng();
  if (wRoll < 0.4) {
    const cow = sphere(0.06, furDark, {}, 5, 3);
    cow.position.set(0.13, 0.72, -0.06);
    g.add(cow);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Skitterling — a rounded chunky beetle-bug. Domed two-tone shell, a small
 * round head with big eyes and springy antennae, six stubby splayed legs.
 */
function buildSkitterling(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shell = jitterColor(0x8a6d4a, rng, 0.05);
  const shellDark = jitterColor(0x5f4a30, rng, 0.04);

  const body = new THREE.Group();
  body.position.y = 0.22;
  // Rounded carapace: a squashed dome, elongated along Z.
  const carapace = sphere(0.3, shell, {}, 8, 5);
  carapace.scale.set(1.05, 0.72, 1.55);
  body.add(carapace);
  // Darker dome ridge on top + a centre seam of two lobes.
  const dome = sphere(0.22, shellDark, {}, 6, 4);
  dome.scale.set(0.95, 0.7, 1.15);
  dome.position.set(0, 0.06, -0.02);
  body.add(dome);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.24, 0.4);
  const hb = sphere(0.16, shellDark, {}, 6, 4);
  hb.scale.set(1, 0.9, 0.9);
  head.add(hb);
  for (const e of eyePair(0.09, 0.03, 0.11, 0.06, { irisR: 0.5 }, 0.2)) head.add(e);
  // Curved antennae (thin tapered cyls) with tiny bobble tips.
  for (const sx of [-1, 1]) {
    const a = cyl(0.008, 0.02, 0.26, shellDark, 4);
    a.position.set(sx * 0.07, 0.16, 0.04);
    a.rotation.set(-0.6, 0, sx * 0.4);
    head.add(a);
    const tip = blob(0.03, shell);
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
    const notch = sphere(0.06, shellDark, {}, 4, 3);
    notch.position.set(0.16, 0.26, -0.18);
    g.add(notch);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Bellowbuck — a big chunky elk/moose strider. Rounded barrel body with a
 * lighter belly, a thick neck and a big-cheeked friendly head, chunky organic
 * antlers (tapered branches), long strider legs with hooves and a flick tail.
 */
function buildBellowbuck(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const hide = jitterColor(0x6b5236, rng, 0.04);
  const hideLight = jitterColor(0x8a6d47, rng, 0.03);
  const antlerC = jitterColor(0xcabf9a, rng, 0.02, 0.05);

  const body = new THREE.Group();
  body.position.y = 1.35;
  const barrel = capsule(0.42, 0.7, hide, {}, 3, 5);
  barrel.rotation.x = Math.PI / 2; // lie along Z
  body.add(barrel);
  // Lighter underbelly.
  const belly = capsule(0.34, 0.55, hideLight, {}, 2, 5);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = -0.16;
  body.add(belly);
  // Shoulder hump for a moose-y silhouette.
  const hump = sphere(0.3, hide, {}, 6, 4);
  hump.scale.set(0.9, 0.85, 0.8);
  hump.position.set(0, 0.22, 0.34);
  body.add(hump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.62, 0.62);
  const neck = capsule(0.17, 0.42, hide, {}, 3, 5);
  neck.rotation.x = -0.6;
  neck.position.set(0, 0.0, 0.0);
  head.add(neck);
  const skull = sphere(0.2, hideLight, {}, 6, 4);
  skull.scale.set(1, 0.95, 1.25);
  skull.position.set(0, 0.34, 0.28);
  head.add(skull);
  // Big soft muzzle.
  const muzzle = sphere(0.13, hide, {}, 5, 4);
  muzzle.scale.set(0.9, 0.85, 1.1);
  muzzle.position.set(0, 0.24, 0.5);
  head.add(muzzle);
  for (const e of eyePair(0.15, 0.42, 0.42, 0.075, { irisR: 0.55 }, 0.18)) head.add(e);
  // Soft ears.
  for (const sx of [-1, 1]) {
    const ear = cone(0.07, 0.16, hide, 5);
    ear.position.set(sx * 0.18, 0.5, 0.22);
    ear.rotation.z = sx * 0.7;
    head.add(ear);
  }
  // Chunky organic antlers: a swept beam + a couple of tines, per side.
  const chipRoll = rng();
  for (const sx of [-1, 1]) {
    const beam = cyl(0.02, 0.055, 0.5, antlerC, 5);
    beam.position.set(sx * 0.15, 0.62, 0.16);
    beam.rotation.z = sx * 0.5;
    beam.rotation.x = -0.2;
    head.add(beam);
    for (const [ty, tzr, ta] of [
      [0.66, 0.2, 0.9],
      [0.82, 0.16, 1.15],
    ] as const) {
      const tine = cone(0.035, 0.24, antlerC, 5);
      tine.position.set(sx * (0.26 + (ty - 0.66) * 0.5), ty, tzr);
      tine.rotation.z = sx * ta;
      head.add(tine);
    }
    // Weathering: one antler tip snapped off on some bucks (left side).
    if (!(chipRoll < 0.3 && sx === -1)) {
      const cap = blob(0.04, antlerC);
      cap.position.set(sx * 0.32, 0.86, 0.14);
      head.add(cap);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.25, 1.02, sz * 0.42, 0.09, 0.12, 1.02, hide, 0, 0x33251a);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.45, -0.6);
  const tm = capsule(0.06, 0.28, hide, {}, 2, 5);
  tm.position.z = -0.16;
  tm.rotation.x = Math.PI / 2 - 0.3;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Mirefin — a rounded amphibious newt/fish. Sleek tapered body with a pale
 * belly, big eyes, a soft dorsal ridge of rounded fins, webbed fin-feet and a
 * broad rounded tail fin.
 */
function buildMirefin(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const skin = jitterColor(0x496a6a, rng, 0.05);
  const belly = jitterColor(0x9db09f, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 0.3;
  const torso = capsule(0.28, 0.55, skin, {}, 3, 5);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const bel = capsule(0.2, 0.42, belly, {}, 2, 5);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.14;
  body.add(bel);
  // Soft rounded dorsal fin ridge (cones, rounded via low seg).
  for (const [z, h] of [
    [0.22, 0.18],
    [0.0, 0.24],
    [-0.22, 0.18],
  ] as const) {
    const f = cone(0.07, h, skin, 5);
    f.position.set(0, 0.26, z);
    body.add(f);
  }
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.46);
  const hb = sphere(0.22, skin, {}, 6, 4);
  hb.scale.set(1.1, 0.85, 1.0);
  head.add(hb);
  // Bulging froggy eyes set high.
  for (const e of eyePair(0.15, 0.12, 0.1, 0.08, { irisR: 0.5 }, 0.25)) head.add(e);
  const snout = sphere(0.12, belly, {}, 5, 4);
  snout.scale.set(1.1, 0.8, 1.0);
  snout.position.set(0, -0.03, 0.18);
  head.add(snout);
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.15, sz * 0.26, 0.04, 0.07, 0.15, skin, sx * 0.5);
    legs.push(l);
    g.add(l);
  }
  // Broad rounded tail fin (a flattened cone + squashed sphere paddle).
  const tail = new THREE.Group();
  tail.position.set(0, 0.3, -0.48);
  const paddle = sphere(0.22, skin, {}, 5, 4);
  paddle.scale.set(1.3, 1.0, 0.28);
  paddle.position.z = -0.2;
  tail.add(paddle);
  g.add(tail);

  const wRoll = rng();
  if (wRoll < 0.35) {
    // A nicked tail fin — a small notch of belly colour.
    const nick = blob(0.05, belly);
    nick.position.set(0.16, 0.42, -0.62);
    g.add(nick);
  }
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Craghorn — a stocky mountain ram. Rounded woolly body, a broad head with a
 * shaggy beard, big curled ram horns (tapered segmented curl) and chunky legs.
 */
function buildCraghorn(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const wool = jitterColor(0x8b8a86, rng, 0.02, 0.06);
  const woolDark = jitterColor(0x5f5d59, rng, 0.02, 0.05);
  const hornC = jitterColor(0x6a5a44, rng, 0.03, 0.05);

  const body = new THREE.Group();
  body.position.y = 0.72;
  const barrel = capsule(0.34, 0.5, wool, {}, 3, 5);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  // Woolly shoulder lump.
  const woolLump = sphere(0.3, wool, {}, 6, 4);
  woolLump.scale.set(1.05, 0.95, 0.85);
  woolLump.position.set(0, 0.08, 0.24);
  body.add(woolLump);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.88, 0.46);
  const skull = sphere(0.2, woolDark, {}, 6, 4);
  skull.scale.set(1, 1, 1.15);
  head.add(skull);
  const muzzle = sphere(0.11, wool, {}, 5, 4);
  muzzle.position.set(0, -0.05, 0.2);
  head.add(muzzle);
  for (const e of eyePair(0.14, 0.05, 0.16, 0.065, { irisR: 0.5 }, 0.16)) head.add(e);
  // Shaggy beard.
  const beard = cone(0.09, 0.22, woolDark, 5);
  beard.rotation.x = Math.PI;
  beard.position.set(0, -0.2, 0.12);
  head.add(beard);
  // Big curled ram horns: tapered segments spiralling back and down.
  const chipRoll = rng();
  for (const sx of [-1, 1]) {
    const steps: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.16, 0.2, 0.02, 0.3],
      [0.22, 0.16, -0.08, 0.85],
      [0.26, 0.06, -0.12, 1.5],
      [0.24, -0.04, -0.06, 2.2],
    ];
    steps.forEach(([px, py, pz, ang], i) => {
      const seg = cyl(0.05 - i * 0.008, 0.07 - i * 0.008, 0.12, hornC, 5);
      seg.position.set(sx * px, py, pz);
      seg.rotation.x = ang;
      head.add(seg);
    });
    // Weathering: a chipped horn tip on the right side of some rams.
    if (!(chipRoll < 0.35 && sx === 1)) {
      const tip = blob(0.045, hornC);
      tip.position.set(sx * 0.24, -0.06, -0.02);
      head.add(tip);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.54, sz * 0.3, 0.09, 0.11, 0.54, woolDark, 0, 0x2f2b24);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

/**
 * Zephyrfinch — a plump round songbird. Round two-tone body, a big round head
 * with big eyes and a cone beak, swept wings and a fanned plume tail.
 */
function buildZephyrfinch(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const feather = jitterColor(0x466f9f, rng, 0.06);
  const belly = jitterColor(0xd6ab52, rng, 0.05);

  const body = new THREE.Group();
  body.position.y = 0.56;
  const torso = sphere(0.2, feather, {}, 6, 4);
  torso.scale.set(1, 1.15, 1.05);
  body.add(torso);
  const chest = sphere(0.15, belly, {}, 5, 4);
  chest.scale.set(1, 1.05, 0.8);
  chest.position.set(0, -0.02, 0.14);
  body.add(chest);
  // Fanned plume tail feathers (three flat cones splayed).
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -0.16);
  for (const [sx, rz] of [
    [-1, 0.35],
    [0, 0],
    [1, -0.35],
  ] as const) {
    const f = cone(0.06, 0.34, feather, 4);
    f.rotation.x = Math.PI / 2 + 0.4;
    f.rotation.z = rz;
    f.position.set(sx * 0.06, 0.0, -0.16);
    f.scale.set(1, 1, 0.4);
    tail.add(f);
  }
  body.add(tail);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.16);
  const hb = sphere(0.17, feather, {}, 6, 4);
  head.add(hb);
  for (const e of eyePair(0.1, 0.03, 0.11, 0.06, { irisR: 0.55 }, 0.25)) head.add(e);
  const beak = cone(0.05, 0.15, jitterColor(0xe6a030, rng, 0.03), 5);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.02, 0.18);
  head.add(beak);
  // Little crest tuft.
  const crest = cone(0.04, 0.1, feather, 4);
  crest.position.set(0, 0.18, 0.0);
  head.add(crest);
  g.add(head);

  // Swept wings (pivot at shoulder, flap about Z). Rounded via a squashed
  // capsule so they read as folded wings, not planks.
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.14, 0.62, 0);
    const wm = capsule(0.06, 0.3, feather, {}, 2, 5);
    wm.rotation.z = Math.PI / 2;
    wm.rotation.y = sx * -0.35;
    wm.scale.set(1, 1, 0.55);
    wm.position.set(sx * 0.2, 0, -0.03);
    w.add(wm);
    wings.push(w);
    g.add(w);
  }

  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.08, 0.42, -0.02, 0.02, 0.028, 0.14, jitterColor(0xe6a030, rng, 0.02));
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

/**
 * Emberpup — THE marquee cutie. A rounded chunky fox-pup: soft round body,
 * an oversized head with HUGE eyes, a lighter belly and cheeks, big pointed
 * ears with glowing ember tips, a little snout, stubby paws and a fat plume
 * tail with a glowing tip.
 */
function buildEmberpup(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xcc6430, rng, 0.04);
  const cream = jitterColor(0xe8c48a, rng, 0.04);
  const ember = 0xff7a2a;

  const body = new THREE.Group();
  body.position.y = 0.44;
  const torso = capsule(0.24, 0.34, coat, {}, 3, 5);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const bel = capsule(0.17, 0.28, cream, {}, 2, 5);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.11;
  body.add(bel);
  g.add(body);

  // Oversized head — the charm centre.
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0.34);
  const skull = sphere(0.24, coat, {}, 6, 5);
  skull.scale.set(1.05, 0.95, 0.95);
  head.add(skull);
  // Cream cheeks.
  for (const sx of [-1, 1]) {
    const cheek = sphere(0.11, cream, {}, 5, 4);
    cheek.position.set(sx * 0.15, -0.06, 0.14);
    head.add(cheek);
  }
  // Pointed snout + nose.
  const snout = sphere(0.1, cream, {}, 5, 4);
  snout.scale.set(0.9, 0.8, 1.2);
  snout.position.set(0, -0.05, 0.22);
  head.add(snout);
  const nose = blob(0.045, 0x2a1c14);
  nose.position.set(0, -0.02, 0.34);
  head.add(nose);
  // HUGE eyes.
  for (const e of eyePair(0.13, 0.06, 0.17, 0.11, { irisR: 0.66 }, 0.14)) head.add(e);
  // Big pointed ears with glowing ember tips.
  const notchRoll = rng();
  for (const sx of [-1, 1]) {
    const ear = cone(0.09, 0.24, coat, 5);
    ear.position.set(sx * 0.13, 0.24, -0.01);
    ear.rotation.z = sx * -0.12;
    head.add(ear);
    const inner = cone(0.05, 0.16, cream, 5);
    inner.position.set(sx * 0.13, 0.24, 0.03);
    inner.rotation.z = sx * -0.12;
    head.add(inner);
    // Weathering: a notched (short) left ear on some pups; keep the glow tip
    // draw unconditional either way.
    const short = notchRoll < 0.3 && sx === -1;
    const tip = sphere(0.035, 0xffb060, { emissive: ember, emissiveIntensity: 1.0 });
    tip.position.set(sx * 0.13, short ? 0.3 : 0.37, -0.01);
    head.add(tip);
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.14, 0.32, sz * 0.18, 0.06, 0.075, 0.32, coat, 0, 0x2a1c14);
    legs.push(l);
    g.add(l);
  }
  // Fat plume tail with a glowing ember tip.
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.28);
  const plume = capsule(0.1, 0.24, coat, {}, 3, 5);
  plume.rotation.x = -0.5;
  plume.position.set(0, 0.06, -0.16);
  tail.add(plume);
  const ttip = sphere(0.09, 0xffb060, { emissive: ember, emissiveIntensity: 0.8 });
  ttip.position.set(0, 0.2, -0.34);
  tail.add(ttip);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

/**
 * Lumenstag — a marquee ethereal deer. Graceful rounded body, a gentle
 * big-eyed head on a slender neck, GLOWING branched antlers (pale cyan
 * emissive), long slender legs and a soft plume tail. Pale luminous coat.
 */
function buildLumenstag(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xe2e6ec, rng, 0.02, 0.05);
  const shade = jitterColor(0xc0c8d4, rng, 0.02, 0.04);
  const glow = 0x9be8ff;

  const body = new THREE.Group();
  body.position.y = 1.3;
  const barrel = capsule(0.34, 0.72, coat, {}, 3, 5);
  barrel.rotation.x = Math.PI / 2;
  body.add(barrel);
  const bel = capsule(0.27, 0.55, shade, {}, 2, 5);
  bel.rotation.x = Math.PI / 2;
  bel.position.y = -0.14;
  body.add(bel);
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.66, 0.6);
  const neck = capsule(0.13, 0.5, coat, {}, 3, 5);
  neck.rotation.x = -0.5;
  head.add(neck);
  const skull = sphere(0.17, shade, {}, 6, 4);
  skull.scale.set(1, 0.95, 1.25);
  skull.position.set(0, 0.36, 0.26);
  head.add(skull);
  const muzzle = sphere(0.1, coat, {}, 5, 4);
  muzzle.scale.set(0.9, 0.8, 1.1);
  muzzle.position.set(0, 0.28, 0.44);
  head.add(muzzle);
  for (const e of eyePair(0.12, 0.42, 0.4, 0.07, { irisR: 0.58 }, 0.18)) head.add(e);
  // Soft ears.
  for (const sx of [-1, 1]) {
    const ear = cone(0.055, 0.16, coat, 5);
    ear.position.set(sx * 0.14, 0.5, 0.2);
    ear.rotation.z = sx * 0.6;
    head.add(ear);
  }
  // GLOWING branched antlers — organic tapered beams + tines.
  for (const sx of [-1, 1]) {
    const beam = cyl(0.02, 0.045, 0.66, glow, 5, { emissive: glow, emissiveIntensity: 1.4 });
    beam.position.set(sx * 0.12, 0.76, 0.16);
    beam.rotation.z = sx * 0.3;
    head.add(beam);
    for (const [ty, tz, ta] of [
      [0.68, 0.18, 0.9],
      [0.92, 0.18, 1.1],
      [1.14, 0.16, 1.3],
    ] as const) {
      const tine = cone(0.03, 0.3, glow, 5, { emissive: glow, emissiveIntensity: 1.4 });
      tine.position.set(sx * (0.2 + (ty - 0.68) * 0.4), ty, tz);
      tine.rotation.z = sx * ta;
      head.add(tine);
    }
  }
  g.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 1.02, sz * 0.42, 0.05, 0.075, 1.02, shade, 0, 0xaeb8c6);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.4, -0.58);
  const tm = capsule(0.06, 0.22, coat, {}, 2, 5);
  tm.rotation.x = Math.PI / 2 - 0.3;
  tm.position.z = -0.14;
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
 * prisms, SIXTEEN thin crystalline stilt legs in two rows of eight (they
 * skitter as a phase-offset wave, see animation.ts), two long antennae tipped
 * with glowing bobbles that lag/spring, and a small big-eyed head. Crystal
 * facets are already organic (octahedra); this refines proportions + charm.
 * Faces +Z; the leg rows run along Z so the wave travels head→tail. Body
 * envelope preserved for the mount camera (MOUNT.rideForwardOffset).
 */
function buildPrismhorse(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const tint = jitterColor(0xcdeaff, rng, 0.05, 0.04); // pale iridescent
  const deep = jitterColor(0x9fc8ff, rng, 0.05, 0.04);
  const ice = jitterColor(0xdff2ff, rng, 0.04, 0.03); // bright icy legs
  const glow = 0xaad4ff;
  const crys: MatOpts = { opacity: 0.82, emissive: glow, emissiveIntensity: 0.4 };
  const legCrys: MatOpts = { opacity: 0.8, emissive: glow, emissiveIntensity: 0.7 };

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
  for (const e of eyePair(0.15, 0.36, 0.54, 0.09, { irisR: 0.5 }, 0.12)) head.add(e);

  // Two long antennae with glowing bobbles (animated: lag/spring).
  const antennae: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(sx * 0.12, 0.5, 0.36);
    const stalk = cyl(0.02, 0.03, 0.7, deep, 4, { emissive: glow, emissiveIntensity: 0.4 });
    stalk.position.y = 0.35;
    a.add(stalk);
    const bob = sphere(0.1, 0xdff0ff, { emissive: glow, emissiveIntensity: 1.6 }, 5, 4);
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
 * Bumblewhale — a rotund 2m whale-blimp that drifts. Fat two-tone rounded body,
 * tiny useless flippers (animated as slow "wings"), blunt tail flukes, and a
 * dopey friendly face: huge eyes with highlights and a wide upturned smile.
 */
function buildBumblewhale(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const top = jitterColor(0x678aa8, rng, 0.04);
  const belly = jitterColor(0xc6d8de, rng, 0.03);

  const body = new THREE.Group();
  body.position.y = 1.15;
  const hull = sphere(1.0, top, {}, 7, 5);
  hull.scale.set(1.35, 0.9, 1.0); // fat blimp
  body.add(hull);
  // Soft lighter belly underside.
  const under = sphere(0.96, belly, {}, 6, 5);
  under.scale.set(1.3, 0.55, 0.96);
  under.position.y = -0.3;
  body.add(under);
  // Blunt rounded tail flukes.
  for (const sx of [-1, 1]) {
    const fluke = sphere(0.3, top, {}, 6, 4);
    fluke.scale.set(1.2, 0.28, 0.7);
    fluke.position.set(sx * 0.34, 0.12, -1.28);
    fluke.rotation.y = sx * -0.4;
    body.add(fluke);
  }
  g.add(body);

  // Dopey face: big eyes + a wide upturned smile.
  const head = new THREE.Group();
  head.position.set(0, 1.25, 0.9);
  for (const e of eyePair(0.36, 0.2, 0.42, 0.16, { irisR: 0.55 }, 0.1)) head.add(e);
  // Smile: three short rounded segments arcing upward at the corners.
  for (const [sx, sy, rot] of [
    [-0.26, -0.16, 0.5],
    [0, -0.24, 0],
    [0.26, -0.16, -0.5],
  ] as const) {
    const seg = capsule(0.035, 0.16, 0x243038, {}, 2, 5);
    seg.rotation.z = Math.PI / 2 + rot;
    seg.position.set(sx, sy, 0.5);
    head.add(seg);
  }
  g.add(head);

  // Tiny useless flippers (flap slowly — reuse the wing channel).
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 1.2, 1.05, 0.1);
    const fin = sphere(0.26, top, {}, 5, 4);
    fin.scale.set(1.4, 0.3, 0.9);
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
 * the edges are ROUNDED (a squashed sphere disc, not a slab) and it has a real
 * little face. Ears + tail flip with it.
 */
function buildSnickerdoodle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const dough = jitterColor(0xd4a86c, rng, 0.05);
  const speck = jitterColor(0x7a4a26, rng, 0.05);

  // Everything lives under `body` so the flip rotates the whole critter.
  const body = new THREE.Group();
  body.position.y = 0.17; // pivot just above ground so the flop clears
  // Rounded pancake: a squashed sphere — wide, thin, with soft rounded edges.
  const disc = sphere(0.5, dough, {}, 9, 5);
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
  // Rounded ears at the front, plume tail at the back.
  for (const sx of [-1, 1]) {
    const ear = cone(0.09, 0.16, dough, 5);
    ear.position.set(sx * 0.28, 0.14, 0.32);
    ear.rotation.x = -0.3;
    body.add(ear);
  }
  const tail = capsule(0.05, 0.26, dough, {}, 2, 5);
  tail.rotation.x = Math.PI / 2 - 0.4;
  tail.position.set(0, 0.06, -0.5);
  body.add(tail);
  // A real little face on the front edge: eyes + nose.
  for (const e of eyePair(0.17, 0.05, 0.5, 0.07, { irisR: 0.6 }, 0.18)) body.add(e);
  const nose = cone(0.04, 0.06, speck, 5);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.02, 0.58);
  body.add(nose);
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
 * enormous glowing lantern eyes, tiny fangs and a wide mouth line. Legs take
 * exaggerated slow strides (animation.ts). Faces +Z.
 */
function buildGloomgobbler(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shadow = jitterColor(0x241f30, rng, 0.03, 0.05);
  const legc = jitterColor(0x15121c, rng, 0.02, 0.04);
  const lantern = 0xffd24a;

  const bodyY = 1.0;
  const body = new THREE.Group();
  body.position.y = bodyY;
  const ball = sphere(0.52, shadow, {}, 7, 5);
  ball.scale.set(1.05, 1.12, 1.0);
  body.add(ball);
  // A couple of soft shadow lobes so the ball reads as billowing, not a globe.
  for (const sx of [-1, 1]) {
    const lobe = sphere(0.24, shadow, {}, 5, 4);
    lobe.position.set(sx * 0.4, -0.12, -0.1);
    body.add(lobe);
  }
  g.add(body);

  // Head handle = face cluster on the front of the ball.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.06, 0.38);
  // Enormous glowing lantern eyes (glowing sclera + dark pupil + highlight).
  for (const e of eyePair(0.2, 0.08, 0.08, 0.17, {
    sclera: 0xfff0b0,
    scleraEmissive: lantern,
    scleraEmissiveIntensity: 1.7,
    iris: 0x140f04,
    irisR: 0.42,
  }, 0.05)) head.add(e);
  // Wide mouth line + tiny fangs.
  const mouth = capsule(0.03, 0.3, 0x0c0a12, {}, 2, 5);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.2, 0.16);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const fang = cone(0.025, 0.07, 0xf4ecd4, 4);
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
    const wisp = cone(0.06, 0.2, shadow, 5);
    wisp.position.set(0.1, bodyY + 0.5, -0.05);
    wisp.rotation.z = 0.4;
    g.add(wisp);
  }

  return { group: g, parts: { legs, head, body } };
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
  // Per-individual uniform scale (±10% by default; see CRITTER_VARIATION).
  const s = CRITTER_VARIATION.scaleMin + rng() * CRITTER_VARIATION.scaleRange;
  out.group.scale.setScalar(s);
  return out;
}
