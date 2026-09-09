import { refineArt } from '../art/library.ts';
import { mergeStaticMeshes } from '../art/merge-static.ts';
import * as THREE from 'three';
import { UNDERWATER, WORLD_SEED } from '../core/constants.ts';
import { makeSurfaceMaterial } from '../core/materials.ts';
import { mulberry32 } from '../core/rng.ts';

// ---------------------------------------------------------------------------
// Code-native low-poly Atlantis, enemies, and turtle transformation. Shapes
// are deliberately chunky and readable through underwater fog from a first-
// person camera; no external art assets or hidden loading step.
// ---------------------------------------------------------------------------

function material(
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number; metalness?: number; transparent?: boolean; opacity?: number } = {},
): THREE.MeshStandardMaterial {
  const mat = makeSurfaceMaterial({
    color,
    flatShading: true,
    roughness: 0.78,
    metalness: opts.metalness ?? 0,
    ...(opts.emissive !== undefined
      ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 0.35 }
      : {}),
  }) as THREE.MeshStandardMaterial;
  if (opts.transparent) {
    mat.transparent = true;
    mat.opacity = opts.opacity ?? 0.5;
    mat.depthWrite = false;
  }
  return mat;
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function addBox(
  parent: THREE.Object3D,
  mat: THREE.Material,
  size: [number, number, number],
  pos: [number, number, number],
  yaw = 0,
): THREE.Mesh {
  const m = mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos);
  m.rotation.y = yaw;
  parent.add(m);
  return m;
}

function addColumn(
  parent: THREE.Object3D,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  h: number,
  broken = false,
): void {
  const shaft = mesh(new THREE.CylinderGeometry(0.72, 0.9, h, 7), mat);
  shaft.position.set(x, y + h / 2, z);
  if (broken) shaft.rotation.z = 0.08;
  parent.add(shaft);
  addBox(parent, mat, [2.05, 0.45, 2.05], [x, y + 0.22, z]);
  if (!broken) addBox(parent, mat, [1.8, 0.38, 1.8], [x, y + h - 0.2, z]);
}

function addArch(
  parent: THREE.Object3D,
  stone: THREE.Material,
  x: number,
  y: number,
  z: number,
  yaw: number,
  width = 7,
  height = 7,
): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  addBox(g, stone, [1.3, height, 1.45], [-width / 2, height / 2, 0]);
  addBox(g, stone, [1.3, height * 0.72, 1.45], [width / 2, height * 0.36, 0]);
  const arc = mesh(new THREE.TorusGeometry(width / 2, 0.72, 6, 12, Math.PI), stone);
  arc.position.y = height;
  arc.rotation.z = Math.PI;
  g.add(arc);
  parent.add(g);
}

function addCoral(
  parent: THREE.Object3D,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  scale: number,
  seed: number,
): void {
  const rand = mulberry32(seed >>> 0);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) {
    const h = scale * (0.8 + rand() * 1.1);
    const branch = mesh(new THREE.CylinderGeometry(scale * 0.12, scale * 0.2, h, 5), mat);
    const a = rand() * Math.PI * 2;
    branch.position.set(Math.cos(a) * scale * 0.42, h / 2, Math.sin(a) * scale * 0.42);
    branch.rotation.z = (rand() - 0.5) * 0.5;
    branch.rotation.y = a;
    g.add(branch);
    const tip = mesh(new THREE.IcosahedronGeometry(scale * 0.22, 0), mat);
    tip.position.set(branch.position.x, h, branch.position.z);
    g.add(tip);
  }
  parent.add(g);
}

function addSeaweed(parent: THREE.Object3D, x: number, y: number, z: number, h: number): void {
  const mat = material(0x2aa879, { emissive: 0x0b503d, emissiveIntensity: 0.18 });
  for (let i = 0; i < 3; i++) {
    const blade = mesh(new THREE.ConeGeometry(0.28, h * (0.7 + i * 0.13), 5), mat);
    blade.position.set(x + (i - 1) * 0.38, y + h * 0.4, z + (i % 2) * 0.25);
    blade.rotation.z = (i - 1) * 0.13;
    blade.userData.seaweedPhase = i * 1.7 + x * 0.1;
    parent.add(blade);
  }
}

/** Palace ruins + coral, positioned at local floor y=0. */
export function buildAtlantis(mergeStatic = true): THREE.Group {
  const root = new THREE.Group();
  root.name = 'atlantis';
  const stone = material(UNDERWATER.castleStone, { metalness: 0.08 });
  const darkStone = material(0x376c70);
  const trim = material(UNDERWATER.castleTrim, { emissive: 0x5a4b1a, emissiveIntensity: 0.12 });
  const windowMat = material(0x4de3dd, { emissive: 0x36c9d0, emissiveIntensity: 0.85 });

  // Broad stepped acropolis makes the palace silhouette legible before the
  // player can see individual columns through the fog.
  addBox(root, darkStone, [72, 2, 62], [0, 1, 4]);
  addBox(root, stone, [55, 2.2, 45], [0, 3.1, 5]);
  addBox(root, darkStone, [34, 2.2, 30], [0, 5.3, 8]);

  // Central throne hall and a cracked turquoise dome.
  addBox(root, stone, [24, 11, 18], [0, 11.7, 10]);
  for (const x of [-9, -3, 3, 9]) addColumn(root, trim, x, 5.4, -3, 9, x === 9);
  const dome = mesh(new THREE.SphereGeometry(9.5, 12, 7, 0, Math.PI * 1.72, 0, Math.PI / 2), stone);
  dome.scale.y = 0.65;
  dome.position.set(0, 17.3, 10);
  dome.rotation.y = 0.35;
  root.add(dome);
  const crown = mesh(new THREE.OctahedronGeometry(1.3, 0), windowMat);
  crown.position.set(0, 23.5, 10);
  root.add(crown);

  // Four weathered watch towers with bright old crystal windows.
  for (const [x, z, broken] of [
    [-29, -17, false],
    [29, -17, true],
    [-29, 28, true],
    [29, 28, false],
  ] as const) {
    const tower = mesh(new THREE.CylinderGeometry(4.2, 5.3, broken ? 11 : 16, 8), stone);
    tower.position.set(x, (broken ? 11 : 16) / 2 + 3.5, z);
    tower.rotation.z = broken ? 0.07 * Math.sign(x) : 0;
    root.add(tower);
    const cap = mesh(new THREE.ConeGeometry(5, 4.5, 8), trim);
    cap.position.set(x, (broken ? 11 : 16) + 5.5, z);
    root.add(cap);
    const glow = mesh(new THREE.OctahedronGeometry(0.8, 0), windowMat);
    glow.position.set(x, (broken ? 11 : 16) + 2.4, z - 3.6);
    root.add(glow);
  }

  // Broken curtain fragments and gateways: enough structure to read castle,
  // wide enough gaps that swimming never becomes a collision maze.
  addArch(root, trim, 0, 4.2, -27, 0, 10, 9);
  addArch(root, stone, -36, 1.8, 5, Math.PI / 2, 7, 7);
  addArch(root, stone, 36, 1.8, 10, -Math.PI / 2, 7, 7);
  addBox(root, stone, [18, 5, 2], [-22, 6.7, -27]);
  addBox(root, stone, [15, 3.5, 2], [23, 5.95, -27], 0.08);
  addBox(root, stone, [2, 4.5, 18], [-38, 4.05, 22]);
  addBox(root, stone, [2, 5.5, 15], [38, 4.55, -3], -0.04);

  // A processional road of pale slabs points from the island-facing approach
  // straight to the arched palace gate.
  for (let i = 0; i < 8; i++) {
    addBox(root, trim, [7.2, 0.25, 5.2], [0, 0.2, -42 - i * 5.7], (i % 2 ? 1 : -1) * 0.025);
  }

  const coralMats = [
    material(UNDERWATER.coralPink, { emissive: 0x5a172c, emissiveIntensity: 0.18 }),
    material(UNDERWATER.coralOrange, { emissive: 0x652a0f, emissiveIntensity: 0.18 }),
    material(UNDERWATER.coralPurple, { emissive: 0x32124d, emissiveIntensity: 0.2 }),
    material(UNDERWATER.coralYellow, { emissive: 0x5e5012, emissiveIntensity: 0.16 }),
  ];
  const rand = mulberry32(WORLD_SEED ^ 0xa71a);
  for (let i = 0; i < 38; i++) {
    const a = rand() * Math.PI * 2;
    const r = 18 + rand() * 72;
    addCoral(
      root,
      coralMats[i % coralMats.length]!,
      Math.cos(a) * r,
      0.15,
      Math.sin(a) * r + 7,
      0.8 + rand() * 1.4,
      WORLD_SEED ^ (i * 7919),
    );
  }
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r = 45 + rand() * 70;
    addSeaweed(root, Math.cos(a) * r, 0, Math.sin(a) * r, 2.2 + rand() * 2.8);
  }

  refineArt(root, 'atlantis');
  // Columns, coral and walls need no independent draw call. Seaweed keeps its
  // animation pivots and remains independently animated by UnderwaterSystem.
  if (mergeStatic) mergeStaticMeshes(root, m => typeof m.userData.seaweedPhase !== 'number');
  return root;
}

/** Turquoise surface disc, reef beacons, bubbles, and a literal dive sign. */
export function buildDiveMarker(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'atlantisDiveMarker';
  const lagoonMat = new THREE.MeshBasicMaterial({
    color: UNDERWATER.lagoonColor,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(UNDERWATER.diveRadius, 72), lagoonMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = UNDERWATER.surfaceY + 0.025;
  disc.renderOrder = 1;
  root.add(disc);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(UNDERWATER.diveRadius, 1.2, 6, 72),
    new THREE.MeshBasicMaterial({ color: 0x5ffff1, transparent: true, opacity: 0.72 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = UNDERWATER.surfaceY + 0.18;
  root.add(ring);

  const reefMat = material(0xf0a45d);
  const glowMat = material(0x74fff2, { emissive: 0x35e8e2, emissiveIntensity: 0.9 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = UNDERWATER.diveRadius - 3;
    const buoy = new THREE.Group();
    buoy.position.set(Math.cos(a) * r, UNDERWATER.surfaceY + 0.6, Math.sin(a) * r);
    buoy.add(mesh(new THREE.ConeGeometry(1.05, 2.6, 6), reefMat));
    const gem = mesh(new THREE.OctahedronGeometry(0.55, 0), glowMat);
    gem.position.y = 1.8;
    buoy.add(gem);
    root.add(buoy);
  }

  // Island-facing marker sign. Canvas text is used as UI-like wayfinding,
  // while all world art remains procedural Three geometry.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(8, 42, 61, 0.86)';
      ctx.roundRect(8, 8, 1008, 240, 42);
      ctx.fill();
      ctx.strokeStyle = '#72fff0';
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.fillStyle = '#ecfffb';
      ctx.textAlign = 'center';
      ctx.font = 'bold 78px system-ui, sans-serif';
      ctx.fillText('ATLANTIS DIVE ZONE', 512, 112);
      ctx.font = 'bold 42px system-ui, sans-serif';
      ctx.fillStyle = '#9ffff4';
      ctx.fillText('CTRL DIVE  •  SPACE RISE', 512, 188);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
      );
      const len = Math.hypot(UNDERWATER.center.x, UNDERWATER.center.z) || 1;
      sprite.position.set(
        (-UNDERWATER.center.x / len) * (UNDERWATER.diveRadius - 14),
        12,
        (-UNDERWATER.center.z / len) * (UNDERWATER.diveRadius - 14),
      );
      sprite.scale.set(36, 9, 1);
      root.add(sprite);
    }
  }
  refineArt(root, 'dive_marker');
  return root;
}

export interface ClamVisual {
  root: THREE.Group;
  upper: THREE.Group;
  lower: THREE.Group;
  pearl: THREE.Mesh;
}

export function buildClamGuard(seed: number): ClamVisual {
  const rand = mulberry32(seed >>> 0);
  const root = new THREE.Group();
  const lower = new THREE.Group();
  const upper = new THREE.Group();
  root.add(lower, upper);
  const shellColor = new THREE.Color(0x744e9f).offsetHSL((rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.08).getHex();
  const shellMat = material(shellColor);
  const lipMat = material(0xe69bb5);
  const pearlMat = material(0xdffcff, { emissive: 0x8fefff, emissiveIntensity: 0.7 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x151728 });
  const toothMat = material(0xfff0c9);

  const lowShell = mesh(new THREE.SphereGeometry(1, 9, 6), shellMat);
  lowShell.scale.set(1.35, 0.38, 1.02);
  lower.add(lowShell);
  const lip = mesh(new THREE.TorusGeometry(0.82, 0.17, 5, 10, Math.PI), lipMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.set(0, 0.26, -0.1);
  lower.add(lip);

  const topShell = mesh(new THREE.SphereGeometry(1, 9, 6), shellMat);
  topShell.scale.set(1.35, 0.4, 1.02);
  topShell.position.y = 0.45;
  upper.add(topShell);
  for (const x of [-0.48, 0.48]) {
    const eye = mesh(new THREE.SphereGeometry(0.16, 7, 5), eyeMat);
    eye.position.set(x, 0.68, -0.72);
    upper.add(eye);
  }
  for (const x of [-0.72, -0.24, 0.24, 0.72]) {
    const tooth = mesh(new THREE.ConeGeometry(0.12, 0.34, 5), toothMat);
    tooth.position.set(x, 0.2, -0.82);
    tooth.rotation.x = Math.PI;
    upper.add(tooth);
  }
  const pearl = mesh(new THREE.SphereGeometry(0.31, 9, 7), pearlMat);
  pearl.position.set(0, 0.4, -0.16);
  root.add(pearl);
  root.scale.setScalar(1.05);
  refineArt(root, 'clam');
  return { root, upper, lower, pearl };
}

export interface CrocVisual {
  root: THREE.Group;
  jaw: THREE.Group;
  tail: THREE.Group;
}

export function buildCrocodile(seed: number): CrocVisual {
  const rand = mulberry32(seed >>> 0);
  const root = new THREE.Group();
  const green = material(new THREE.Color(0x487e49).offsetHSL((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.08).getHex());
  const belly = material(0x9aa76a);
  const dark = new THREE.MeshBasicMaterial({ color: 0x111818 });
  const teeth = material(0xffefc6);

  const body = mesh(new THREE.IcosahedronGeometry(1.2, 1), green);
  body.scale.set(1.05, 0.55, 2.25);
  root.add(body);
  const back = mesh(new THREE.BoxGeometry(1.45, 0.22, 2.7), green);
  back.position.set(0, 0.56, -0.1);
  root.add(back);

  const head = mesh(new THREE.BoxGeometry(1.55, 0.72, 1.55), green);
  head.position.set(0, 0.08, -2.25);
  root.add(head);
  for (const x of [-0.52, 0.52]) {
    const eye = mesh(new THREE.SphereGeometry(0.13, 7, 5), dark);
    eye.position.set(x, 0.55, -2.62);
    root.add(eye);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.2, -2.82);
  const snout = mesh(new THREE.BoxGeometry(1.48, 0.3, 1.35), belly);
  snout.position.z = -0.2;
  jaw.add(snout);
  for (const x of [-0.52, -0.18, 0.18, 0.52]) {
    const tooth = mesh(new THREE.ConeGeometry(0.08, 0.25, 5), teeth);
    tooth.position.set(x, 0.22, -0.58);
    jaw.add(tooth);
  }
  root.add(jaw);

  const tail = new THREE.Group();
  tail.position.z = 2.15;
  const tailMesh = mesh(new THREE.ConeGeometry(0.82, 3.5, 7), green);
  tailMesh.rotation.x = Math.PI / 2;
  tailMesh.position.z = 1.45;
  tail.add(tailMesh);
  root.add(tail);
  for (const [x, z] of [[-0.85, -0.5], [0.85, -0.5], [-0.8, 1], [0.8, 1]] as const) {
    const foot = mesh(new THREE.BoxGeometry(0.8, 0.18, 0.42), green);
    foot.position.set(x, -0.45, z);
    root.add(foot);
  }
  root.scale.setScalar(0.82);
  refineArt(root, 'crocodile');
  return { root, jaw, tail };
}

export interface TurtleVisual {
  root: THREE.Group;
  flippers: THREE.Group[];
}

/** Cute, harmless permanent result of purifying a clam guard. */
export function buildTurtle(seed: number): TurtleVisual {
  const rand = mulberry32(seed >>> 0);
  const root = new THREE.Group();
  const shell = material(new THREE.Color(0x52b38d).offsetHSL((rand() - 0.5) * 0.08, 0, 0).getHex());
  const skin = material(0x83d3a2);
  const plate = material(0x2c7c67);
  const eye = new THREE.MeshBasicMaterial({ color: 0x15242a });
  const shellMesh = mesh(new THREE.SphereGeometry(1, 9, 6), shell);
  shellMesh.scale.set(1.15, 0.48, 1.35);
  root.add(shellMesh);
  for (let a = 0; a < 6; a++) {
    const p = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.12, 6), plate);
    const ang = (a / 6) * Math.PI * 2;
    p.position.set(Math.cos(ang) * 0.58, 0.45, Math.sin(ang) * 0.7);
    root.add(p);
  }
  const head = mesh(new THREE.SphereGeometry(0.42, 8, 6), skin);
  head.position.set(0, 0.04, -1.45);
  root.add(head);
  for (const x of [-0.16, 0.16]) {
    const e = mesh(new THREE.SphereGeometry(0.055, 6, 4), eye);
    e.position.set(x, 0.17, -1.8);
    root.add(e);
  }
  const flippers: THREE.Group[] = [];
  for (const [x, z, yaw] of [
    [-1.15, -0.6, -0.6],
    [1.15, -0.6, 0.6],
    [-0.95, 0.8, -2.4],
    [0.95, 0.8, 2.4],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.05, z);
    pivot.rotation.y = yaw;
    const fin = mesh(new THREE.SphereGeometry(0.5, 7, 5), skin);
    fin.scale.set(1.3, 0.18, 0.55);
    pivot.add(fin);
    root.add(pivot);
    flippers.push(pivot);
  }
  root.scale.setScalar(0.72);
  refineArt(root, 'turtle');
  return { root, flippers };
}

/** Dispose geometries/materials/textures owned beneath a runtime root. */
export function disposeUnderwaterTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const candidate = o as THREE.Mesh;
    if (candidate.geometry) geometries.add(candidate.geometry);
    const m = candidate.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((entry) => materials.add(entry));
    else if (m) materials.add(m);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    const map = (m as THREE.MeshBasicMaterial).map;
    map?.dispose();
    m.dispose();
  });
}
