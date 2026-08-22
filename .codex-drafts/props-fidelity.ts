import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Standalone fidelity-pass prop builders. Every part is converted to non-indexed
// geometry before merging so each returned mesh carries baked per-vertex colour.

const TAU = Math.PI * 2;

/** Bake a uniform vertex colour onto a geometry and drop its index (flat). */
function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Concatenate coloured non-indexed parts into one BufferGeometry. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) {
    throw new Error('Unable to merge prop geometry');
  }
  for (const part of parts) part.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Coloured cylinder centred so its mid-height sits at `y`. */
function cyl(
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  hex: number,
  y: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, y, 0);
  return colored(g, hex);
}

/** Coloured cone with its base at `y`. */
function cone(
  r: number,
  h: number,
  seg: number,
  hex: number,
  y: number,
): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, y + h / 2, 0);
  return colored(g, hex);
}

/** Coloured low-poly blob (icosahedron), optional non-uniform scale, at (x,y,z). */
function blob(
  r: number,
  hex: number,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, hex);
}

/** A denser faceted blob used only where a detail-1 crown silhouette is wanted. */
function blob1(
  r: number,
  hex: number,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, hex);
}

/** Coloured box centred at (x,y,z) with an optional Y rotation. */
function box(
  w: number,
  h: number,
  d: number,
  hex: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colored(g, hex);
}

/** An octahedron shard, non-uniformly scaled, at (x,y,z). */
function oct(
  r: number,
  hex: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, hex);
}

/** Lift a geometry just enough for its lowest vertex to touch y=0. */
function ground(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  if (g.boundingBox) g.translate(0, -g.boundingBox.min.y, 0);
  return g;
}

/** Horizontal faceted cylinder whose long axis follows X. */
function logCylinder(
  radius: number,
  length: number,
  segments: number,
  hex: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return colored(g, hex);
}

/** Thin horizontal cylinder used as an inset cut-wood end disc. */
function logEnd(
  radius: number,
  thickness: number,
  segments: number,
  hex: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  return logCylinder(radius, thickness, segments, hex, x, y, z);
}

/** Deciduous tree, ~5.1m tall, ~344 tris. */
export function buildBroadleaf2(): THREE.BufferGeometry {
  return merge([
    cyl(0.23, 0.36, 2.75, 6, 0x6f4d2f, 1.375),
    blob1(1.08, 0x4e8c3a, -0.62, 3.62, 0.18, 1.08, 0.88, 1.02),
    blob1(1.02, 0x4e8c3a, 0.58, 3.68, -0.12, 1.08, 0.92, 1.08),
    blob1(0.96, 0x4e8c3a, -0.02, 3.58, -0.68, 1.06, 0.9, 1.02),
    blob1(1.08, 0x669b45, 0.04, 4.18, 0.1, 1.08, 0.96, 1.04),
  ]);
}

/** Broad, squat oak, ~4.6m tall, ~384 tris; instance scaling supports giants. */
export function buildOak2(): THREE.BufferGeometry {
  return merge([
    cyl(0.32, 0.5, 2.35, 6, 0x6f4d2f, 1.175),
    blob1(1.28, 0x4e8c3a, -0.92, 3.02, 0.18, 1.15, 0.78, 1.08),
    blob1(1.25, 0x4e8c3a, 0.9, 3.0, -0.18, 1.16, 0.8, 1.08),
    blob1(1.2, 0x4e8c3a, 0.02, 3.1, 0.82, 1.1, 0.8, 1.12),
    blob1(1.24, 0x4e8c3a, -0.02, 3.22, -0.72, 1.12, 0.82, 1.1),
    blob(1.02, 0x669b45, -0.42, 3.78, -0.04, 1.12, 0.86, 1.05),
    blob(0.98, 0x669b45, 0.48, 3.72, 0.1, 1.12, 0.86, 1.08),
  ]);
}

/** Four-tier conifer with visible trunk gaps, ~5.5m tall, ~108 tris. */
export function buildPine2(): THREE.BufferGeometry {
  return merge([
    cyl(0.1, 0.25, 4.75, 6, 0x6f4d2f, 2.375),
    cone(1.34, 1.25, 7, 0x2e6b45, 0.9),
    cone(1.08, 1.15, 7, 0x2e6b45, 2.25),
    cone(0.79, 1.0, 7, 0x2e6b45, 3.5),
    cone(0.52, 0.92, 7, 0x43815a, 4.6),
  ]);
}

interface FlowerSpec {
  x: number;
  z: number;
  height: number;
  yaw: number;
}

function flowerLeaf(x: number, y: number, z: number, yaw: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.15, 0.035, 0.075);
  g.rotateZ(0.42);
  g.rotateY(yaw);
  g.translate(x + Math.cos(yaw) * 0.07, y, z - Math.sin(yaw) * 0.07);
  return colored(g, 0x3f7a35);
}

function flowerHead(
  color: number,
  centerColor: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = yaw + (i / 5) * TAU;
    parts.push(box(
      0.18,
      0.045,
      0.085,
      color,
      x + Math.cos(a) * 0.095,
      y,
      z + Math.sin(a) * 0.095,
      -a,
    ));
  }
  parts.push(blob(0.07, centerColor, x, y + 0.035, z, 1, 0.72, 1));
  return parts;
}

/** Three-flower patch, ~0.46m tall, ~324 tris. */
export function buildFlowerPatch(color: number): THREE.BufferGeometry {
  const specs: FlowerSpec[] = [
    { x: -0.12, z: 0.04, height: 0.39, yaw: 0.18 },
    { x: 0.13, z: 0.07, height: 0.43, yaw: 1.05 },
    { x: 0.02, z: -0.13, height: 0.36, yaw: 2.2 },
  ];
  const centerColor = color === 0xf2c744 ? 0xe7842f : 0xf2c744;
  const parts: THREE.BufferGeometry[] = [];
  for (const flower of specs) {
    parts.push(
      cyl(0.014, 0.024, flower.height, 4, 0x3f7a35, flower.height / 2),
      flowerLeaf(flower.x, flower.height * 0.5, flower.z, flower.yaw + 0.35),
    );
    const stem = parts[parts.length - 2];
    if (stem) stem.translate(flower.x, 0, flower.z);
    parts.push(...flowerHead(
      color,
      centerColor,
      flower.x,
      flower.height + 0.01,
      flower.z,
      flower.yaw,
    ));
  }
  return merge(parts);
}

function mushroomCap(capColor: number): THREE.BufferGeometry {
  const stem = cyl(0.085, 0.125, 0.31, 6, 0xefe5d0, 0.155);

  const dome = new THREE.SphereGeometry(1, 7, 3, 0, TAU, 0, Math.PI / 2);
  dome.scale(0.33, 0.19, 0.33);
  dome.translate(0, 0.32, 0);

  const rim = new THREE.CylinderGeometry(0.27, 0.31, 0.055, 7);
  rim.translate(0, 0.3075, 0);

  return merge([
    stem,
    colored(rim, 0xd5c6aa),
    colored(dome, capColor),
  ]);
}

/** Chunky red toadstool, ~0.51m tall, ~87 tris. */
export function buildMushroomRed(): THREE.BufferGeometry {
  return mushroomCap(0xd95f4c);
}

/** Chunky yellow toadstool, ~0.51m tall, ~87 tris. */
export function buildMushroomYellow(): THREE.BufferGeometry {
  return mushroomCap(0xe8a83c);
}

function bushLobes(): THREE.BufferGeometry[] {
  return [
    ground(blob(0.7, 0x4e8c3a, -0.2, 0, 0.02, 1.08, 0.76, 1.02)),
    ground(blob(0.62, 0x4e8c3a, 0.42, 0, 0.08, 1, 0.82, 1.04)),
    ground(blob(0.56, 0x5a9640, 0.06, 0, -0.4, 1.06, 0.88, 1)),
  ];
}

/** Fat three-lobe ground bush, ~1.0m tall, ~60 tris. */
export function buildBush(): THREE.BufferGeometry {
  return merge(bushLobes());
}

/** Berry-dotted ground bush, ~1.1m tall, ~180 tris. */
export function buildBushBerry(): THREE.BufferGeometry {
  return merge([
    ...bushLobes(),
    blob(0.075, 0xd95f4c, -0.55, 0.67, 0.28),
    blob(0.07, 0xd95f4c, -0.12, 0.91, 0.4),
    blob(0.075, 0xd95f4c, 0.38, 0.77, 0.43),
    blob(0.065, 0xd95f4c, 0.69, 0.55, 0.05),
    blob(0.07, 0xd95f4c, 0.21, 0.93, -0.28),
    blob(0.065, 0xd95f4c, -0.42, 0.72, -0.36),
  ]);
}

/** Fallen two-log cluster, ~0.9m tall and 2.2m long, ~176 tris. */
export function buildLog(): THREE.BufferGeometry {
  const stub = new THREE.CylinderGeometry(0.065, 0.11, 0.48, 5);
  stub.rotateZ(-0.48);
  stub.rotateX(0.18);
  stub.translate(0.23, 0.54, -0.03);

  return merge([
    logCylinder(0.3, 2.2, 7, 0x795635, 0, 0.3, 0),
    logEnd(0.25, 0.026, 7, 0xc9a876, -1.106, 0.3, 0),
    logEnd(0.25, 0.026, 7, 0xc9a876, 1.106, 0.3, 0),
    colored(stub, 0x795635),
    logCylinder(0.17, 1.24, 6, 0x795635, 0.18, 0.11, 0.52),
    logEnd(0.135, 0.022, 6, 0xc9a876, -0.451, 0.11, 0.52),
    logEnd(0.135, 0.022, 6, 0xc9a876, 0.811, 0.11, 0.52),
  ]);
}

function tuftBlade(
  radius: number,
  height: number,
  azimuth: number,
  lean: number,
  x: number,
  z: number,
): THREE.BufferGeometry {
  const raw = new THREE.ConeGeometry(radius, height, 4, 2);
  raw.translate(0, height / 2, 0);
  const g = colored(raw, 0x4f8d37);
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const tip = new THREE.Color(0x73b84f);

  // Non-indexed triangles get one colour per face: a dark lower band and a
  // lighter upper band remain crisp instead of interpolating into a gradient.
  for (let i = 0; i < pos.count; i += 3) {
    const meanY = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (meanY <= height * 0.5) continue;
    for (let j = 0; j < 3; j++) {
      col.setXYZ(i + j, tip.r, tip.g, tip.b);
    }
  }

  g.rotateZ(lean);
  g.rotateY(azimuth);
  ground(g);
  g.translate(x, 0, z);
  return g;
}

/** Eight-cone fountain grass tuft, ~0.5m tall, ~160 tris. */
export function buildTuft2(): THREE.BufferGeometry {
  const cfg: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [0.06, 0.5, 0, 0.08, 0, 0],
    [0.057, 0.43, 0.78, 0.25, 0.01, 0.015],
    [0.052, 0.38, 1.56, 0.31, -0.01, 0],
    [0.055, 0.46, 2.34, 0.22, 0, -0.015],
    [0.06, 0.4, 3.12, 0.3, 0.015, 0],
    [0.05, 0.34, 3.9, 0.35, -0.01, 0.01],
    [0.055, 0.44, 4.68, 0.23, 0, 0],
    [0.048, 0.29, 5.46, 0.38, 0.01, -0.01],
  ];
  return merge(cfg.map(([radius, height, azimuth, lean, x, z]) => (
    tuftBlade(radius, height, azimuth, lean, x, z)
  )));
}

/** Four-piece faceted pebble cluster, ~0.3m tall, ~68 tris. */
export function buildPebbleCluster(): THREE.BufferGeometry {
  return merge([
    ground(blob(0.2, 0x7b828c, -0.18, 0, 0.02, 1.25, 0.62, 1.05)),
    ground(blob(0.15, 0x7b828c, 0.18, 0, 0.09, 1.1, 0.72, 0.95)),
    ground(blob(0.12, 0x7b828c, 0.04, 0, -0.2, 1.28, 0.65, 1.0)),
    ground(oct(0.12, 0x7b828c, 0.31, 0, -0.13, 1.05, 0.7, 0.9)),
  ]);
}

function axisZCylinder(
  radius: number,
  depth: number,
  segments: number,
  hex: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, depth, segments);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return colored(g, hex);
}

function radialBladeBox(
  width: number,
  length: number,
  depth: number,
  hex: number,
  radius: number,
  bladeAngle: number,
  braceAngle = 0,
  z = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, length, depth);
  if (braceAngle) g.rotateZ(braceAngle);
  g.translate(0, radius, z);
  if (bladeAngle) g.rotateZ(bladeAngle);
  return colored(g, hex);
}

export interface WindmillGeometry {
  tower: THREE.BufferGeometry;
  blades: THREE.BufferGeometry;
}

/** Village windmill, ~8.9m tall; tower ~150 tris, blade assembly ~168 tris. */
export function buildWindmill(): WindmillGeometry {
  const tower = merge([
    cyl(1.08, 1.65, 6.65, 6, 0xe8dcc8, 3.325),
    cyl(1.7, 1.72, 0.24, 6, 0x6f4d2f, 0.12),
    cyl(1.13, 1.18, 0.22, 6, 0x6f4d2f, 6.54),
    cone(1.56, 2.22, 6, 0x8a4a3a, 6.65),
    box(0.72, 1.38, 0.1, 0x6f4d2f, 0, 0.69, 1.55),
    box(0.52, 0.62, 0.09, 0x6f4d2f, -0.55, 3.4, 1.43),
    box(0.52, 0.62, 0.09, 0x6f4d2f, 0.55, 4.62, 1.31),
    axisZCylinder(0.29, 0.26, 8, 0x6f4d2f, 0, 6.3, 1.25),
  ]);

  const bladeParts: THREE.BufferGeometry[] = [
    axisZCylinder(0.34, 0.34, 8, 0x6f4d2f, 0, 0, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    bladeParts.push(
      radialBladeBox(0.46, 2.08, 0.095, 0xc9a876, 1.48, a),
      radialBladeBox(0.065, 1.95, 0.05, 0x6f4d2f, 1.48, a, 0.13, 0.073),
      radialBladeBox(0.065, 1.95, 0.05, 0x6f4d2f, 1.48, a, -0.13, 0.073),
    );
  }
  const blades = merge(bladeParts);

  // Blades are centred on local (0,0,0). Place that origin at the tower-local
  // hub (0, 6.30, 1.43), then spin the assembly around its local Z axis.
  return { tower, blades };
}
