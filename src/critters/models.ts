import * as THREE from 'three';
import { CRITTER_VARIATION } from '../core/constants.ts';

// Procedural blocky critter models. Each species is assembled from a handful of
// Box/Cone/Sphere/Cylinder primitives with flat-shaded MeshLambertMaterial, in
// the mobademo `buildBlockEnemy` spirit: cheap (≤ ~150 tris), readable
// silhouettes with personality. Eyes (tiny dark spheres) are the charm payoff.
//
// Convention: models face +Z ("forward"), stand on y=0, roughly centred on the
// x axis. `buildCritterModel` returns the group plus a `CritterParts` handle of
// animatable Object3Ds (leg / wing / tail groups pivot at the joint so a single
// rotation swings the whole limb; see animation.ts).

/** Animatable handles into a built model. Limbs pivot at their joint. */
export interface CritterParts {
  legs: THREE.Object3D[];
  wings?: THREE.Object3D[];
  head: THREE.Object3D;
  body: THREE.Object3D;
  tail?: THREE.Object3D;
}

type MatOpts = { emissive?: number; emissiveIntensity?: number };

function mat(color: number, opts: MatOpts = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return m;
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  opts: MatOpts = {},
): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

function sphere(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat(color, opts));
}

/** Cheap low-poly sphere for eyes / tips (many per model — keep the tri budget). */
function blob(r: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 4, 3), mat(color, opts));
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

/**
 * A limb group pivoting at (x,y,z): the mesh is dropped so its top edge sits at
 * the pivot, so rotating the returned group about X swings the leg from the hip.
 */
function legGroup(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  color: number,
  splay = 0,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = box(w, h, w, color);
  m.position.y = -h / 2;
  m.rotation.z = splay; // outward lean, kept off the animated group's rotation
  g.add(m);
  return g;
}

/** Quadruped foot layout: [signX, signZ] for the four legs. */
const QUAD: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

/** A pair of dark eyes on the +Z face of a head, spaced by `sep`. */
function eyes(sep: number, y: number, z: number, r: number): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const e = blob(r, 0x141014);
    e.position.set(sx * sep, y, z);
    out.push(e);
  }
  return out;
}

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
// are jittered per-individual so a herd never looks cloned.

function buildPuffle(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const fur = jitterColor(0xe8d9a0, rng, 0.06);
  const body = sphere(0.42, fur);
  body.scale.set(1, 0.92, 1);
  body.position.y = 0.42;
  g.add(body);
  // Tuft on top — parented to the group root, NOT the body: the body's 0.92
  // Y-squash would scale the tuft's offset and leave it floating. Squashed body
  // top sits at 0.42 + 0.42*0.92 ≈ 0.81, so centre the tuft just below that to
  // keep it embedded in the fluff.
  const tuft = sphere(0.16, fur);
  tuft.position.set(0, 0.84, 0.02);
  g.add(tuft);
  // head fused into the fluff — big eyes + tiny nose on the front
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.28);
  for (const e of eyes(0.16, 0.06, 0.12, 0.075)) head.add(e);
  const nose = box(0.09, 0.07, 0.06, 0xb87a5a);
  nose.position.set(0, -0.05, 0.16);
  head.add(nose);
  g.add(head);
  // stubby legs
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.18, 0.16, sz * 0.14, 0.11, 0.16, 0xc7b483);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

function buildSkitterling(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const shell = jitterColor(0x8a6d4a, rng, 0.05);
  const body = box(0.34, 0.2, 0.6, shell);
  body.position.y = 0.24;
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.26, 0.34);
  const hb = box(0.24, 0.2, 0.2, shell);
  head.add(hb);
  for (const e of eyes(0.1, 0.04, 0.11, 0.05)) head.add(e);
  // antennae
  for (const sx of [-1, 1]) {
    const a = cyl(0.008, 0.02, 0.28, 0x3a2f22, 4);
    a.position.set(sx * 0.07, 0.22, 0.06);
    a.rotation.set(-0.5, 0, sx * 0.35);
    head.add(a);
  }
  g.add(head);
  // 6 low legs, splayed
  const legs: THREE.Object3D[] = [];
  for (const sz of [0.2, 0, -0.2]) {
    for (const sx of [-1, 1]) {
      const l = legGroup(sx * 0.2, 0.16, sz, 0.05, 0.18, 0x5a4630, sx * 0.5); // splay outward
      legs.push(l);
      g.add(l);
    }
  }
  return { group: g, parts: { legs, head, body } };
}

function buildBellowbuck(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const hide = jitterColor(0x6b5236, rng, 0.04);
  // barrel body, high off the ground
  const body = box(0.7, 0.62, 1.25, hide);
  body.position.y = 1.35;
  g.add(body);
  // long neck + head
  const head = new THREE.Group();
  head.position.set(0, 1.75, 0.7);
  const neck = box(0.28, 0.55, 0.28, hide);
  neck.position.set(0, 0.0, 0.02);
  neck.rotation.x = -0.5;
  head.add(neck);
  const skull = box(0.3, 0.3, 0.5, jitterColor(0x7a6040, rng, 0.03));
  skull.position.set(0, 0.32, 0.28);
  head.add(skull);
  for (const e of eyes(0.14, 0.36, 0.44, 0.055)) head.add(e);
  // antlers
  for (const sx of [-1, 1]) {
    const a = box(0.05, 0.5, 0.05, 0xd8cdb0);
    a.position.set(sx * 0.14, 0.6, 0.2);
    a.rotation.z = sx * 0.4;
    head.add(a);
    const tine = box(0.05, 0.22, 0.05, 0xd8cdb0);
    tine.position.set(sx * 0.28, 0.72, 0.2);
    tine.rotation.z = sx * 0.9;
    head.add(tine);
  }
  g.add(head);
  // long strider legs
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.26, 1.06, sz * 0.48, 0.13, 1.06, 0x4f3c26);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.4, -0.62);
  const tm = box(0.08, 0.08, 0.4, hide);
  tm.position.z = -0.2;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

function buildMirefin(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const skin = jitterColor(0x4a6a6b, rng, 0.05);
  const belly = jitterColor(0x9fb0a0, rng, 0.03);
  // sleek elongated body, low to the ground
  const body = box(0.34, 0.32, 0.95, skin);
  body.position.y = 0.3;
  g.add(body);
  const bel = box(0.3, 0.14, 0.8, belly);
  bel.position.set(0, -0.12, 0);
  body.add(bel);
  // dorsal fin ridge
  for (const z of [0.2, 0, -0.2]) {
    const f = cone(0.08, 0.22, skin, 4);
    f.position.set(0, 0.28, z);
    body.add(f);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.5);
  const hb = box(0.3, 0.26, 0.34, skin);
  head.add(hb);
  for (const e of eyes(0.13, 0.08, 0.12, 0.05)) head.add(e);
  const snout = box(0.16, 0.12, 0.16, belly);
  snout.position.set(0, -0.04, 0.22);
  head.add(snout);
  g.add(head);
  // fin-feet (short)
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.2, 0.16, sz * 0.28, 0.06, 0.16, skin, sx * 0.4);
    legs.push(l);
    g.add(l);
  }
  // broad tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.3, -0.5);
  const tm = box(0.28, 0.06, 0.36, skin);
  tm.position.z = -0.2;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

function buildCraghorn(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const grey = jitterColor(0x8b8a86, rng, 0.02, 0.06);
  const dark = jitterColor(0x5c5a56, rng, 0.02, 0.05);
  // stocky body
  const body = box(0.58, 0.5, 0.9, grey);
  body.position.y = 0.78;
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0.5);
  const skull = box(0.34, 0.34, 0.42, grey);
  head.add(skull);
  for (const e of eyes(0.15, 0.04, 0.19, 0.05)) head.add(e);
  const beard = box(0.14, 0.2, 0.08, dark);
  beard.position.set(0, -0.24, 0.14);
  head.add(beard);
  // curled horns (stacked boxes bending back and down)
  for (const sx of [-1, 1]) {
    const angles = [0.2, 0.7, 1.2, 1.7];
    let px = sx * 0.16;
    let py = 0.22;
    let pz = 0.02;
    for (const a of angles) {
      const seg = box(0.09, 0.12, 0.09, dark);
      seg.position.set(px, py, pz);
      seg.rotation.x = a;
      head.add(seg);
      px += sx * 0.02;
      py += 0.06 * Math.cos(a);
      pz -= 0.09 * Math.sin(a) + 0.02;
    }
  }
  g.add(head);
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 0.56, sz * 0.32, 0.13, 0.56, dark);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, head, body } };
}

function buildZephyrfinch(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const feather = jitterColor(0x4a7fc0, rng, 0.06);
  const belly = jitterColor(0xe9b84a, rng, 0.05);
  const body = new THREE.Group();
  body.position.y = 0.6;
  const torso = box(0.24, 0.28, 0.42, feather);
  body.add(torso);
  const chest = box(0.2, 0.18, 0.2, belly);
  chest.position.set(0, -0.04, 0.16);
  body.add(chest);
  // tail feathers
  const tailFan = box(0.22, 0.04, 0.24, feather);
  tailFan.position.set(0, 0.02, -0.28);
  tailFan.rotation.x = 0.3;
  body.add(tailFan);
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.2);
  const hb = box(0.2, 0.2, 0.2, feather);
  head.add(hb);
  for (const e of eyes(0.1, 0.02, 0.1, 0.045)) head.add(e);
  const beak = cone(0.05, 0.16, 0xf0a020, 4);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.02, 0.16);
  head.add(beak);
  g.add(head);
  // swept wings (pivot at shoulder, flap about Z)
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.11, 0.64, 0);
    const wm = box(0.42, 0.04, 0.26, feather);
    wm.position.set(sx * 0.21, 0, -0.04);
    wm.rotation.y = sx * -0.35; // swept back
    w.add(wm);
    wings.push(w);
    g.add(w);
  }
  // tiny perch legs
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const l = legGroup(sx * 0.08, 0.46, -0.02, 0.04, 0.16, 0xf0a020);
    legs.push(l);
    g.add(l);
  }
  return { group: g, parts: { legs, wings, head, body } };
}

function buildEmberpup(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xd9662a, rng, 0.04);
  const light = jitterColor(0xf0b060, rng, 0.04);
  const body = box(0.36, 0.34, 0.7, coat);
  body.position.y = 0.5;
  g.add(body);
  const bel = box(0.3, 0.14, 0.55, light);
  bel.position.set(0, -0.14, 0.02);
  body.add(bel);
  const head = new THREE.Group();
  head.position.set(0, 0.6, 0.42);
  const skull = box(0.3, 0.28, 0.3, coat);
  head.add(skull);
  // pointed snout
  const snout = box(0.14, 0.12, 0.2, light);
  snout.position.set(0, -0.05, 0.22);
  head.add(snout);
  for (const e of eyes(0.12, 0.05, 0.15, 0.05)) head.add(e);
  // pointed ears with a slight ember glow tip
  for (const sx of [-1, 1]) {
    const ear = cone(0.08, 0.2, coat, 4);
    ear.position.set(sx * 0.11, 0.2, -0.02);
    head.add(ear);
    const tip = sphere(0.035, 0xff8030, { emissive: 0xff5a10, emissiveIntensity: 0.9 });
    tip.position.set(sx * 0.11, 0.3, -0.02);
    head.add(tip);
  }
  g.add(head);
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.15, 0.34, sz * 0.24, 0.09, 0.34, coat);
    legs.push(l);
    g.add(l);
  }
  // bushy tail (pivot at rear, sways) with a glowing tip
  const tail = new THREE.Group();
  tail.position.set(0, 0.52, -0.34);
  const tm = box(0.16, 0.16, 0.42, coat);
  tm.position.set(0, 0.04, -0.22);
  tm.rotation.x = -0.4;
  tail.add(tm);
  const ttip = sphere(0.1, 0xffb060, { emissive: 0xff6a20, emissiveIntensity: 0.7 });
  ttip.position.set(0, 0.2, -0.42);
  tail.add(ttip);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
}

function buildLumenstag(rng: () => number): { group: THREE.Group; parts: CritterParts } {
  const g = new THREE.Group();
  const coat = jitterColor(0xdfe3ea, rng, 0.02, 0.05);
  const shade = jitterColor(0xb9c2d0, rng, 0.02, 0.04);
  const glow = 0x9be8ff;
  // elegant elongated body, high stance
  const body = box(0.56, 0.5, 1.2, coat);
  body.position.y = 1.3;
  g.add(body);
  // long neck + refined head
  const head = new THREE.Group();
  head.position.set(0, 1.7, 0.62);
  const neck = box(0.24, 0.6, 0.24, coat);
  neck.rotation.x = -0.45;
  head.add(neck);
  const skull = box(0.26, 0.26, 0.46, shade);
  skull.position.set(0, 0.36, 0.26);
  head.add(skull);
  for (const e of eyes(0.12, 0.4, 0.42, 0.05)) head.add(e);
  // GLOWING branched antlers (pale cyan emissive)
  for (const sx of [-1, 1]) {
    const beam = box(0.05, 0.7, 0.05, glow, { emissive: glow, emissiveIntensity: 1.4 });
    beam.position.set(sx * 0.13, 0.78, 0.16);
    beam.rotation.z = sx * 0.3;
    head.add(beam);
    for (const [ty, tz, ta] of [
      [0.7, 0.18, 0.9],
      [0.95, 0.18, 1.1],
      [1.18, 0.16, 1.3],
    ] as const) {
      const tine = box(0.045, 0.32, 0.045, glow, { emissive: glow, emissiveIntensity: 1.4 });
      tine.position.set(sx * (0.22 + (ty - 0.7) * 0.35), ty, tz);
      tine.rotation.z = sx * ta;
      head.add(tine);
    }
  }
  g.add(head);
  // long slender legs
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of QUAD) {
    const l = legGroup(sx * 0.22, 1.04, sz * 0.46, 0.1, 1.04, shade);
    legs.push(l);
    g.add(l);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.34, -0.6);
  const tm = box(0.1, 0.1, 0.34, coat);
  tm.position.z = -0.17;
  tail.add(tm);
  g.add(tail);
  return { group: g, parts: { legs, head, body, tail } };
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
};

/**
 * Build a critter model for `speciesId`, using `rng` for per-individual variety
 * (slight uniform scale ±10% and per-part hue/lightness jitter). Throws for an
 * unknown species id — model gaps must not silently render an empty group.
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
