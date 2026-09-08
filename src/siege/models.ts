import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAUNCH, randomFrom, type ProjectileKind, type StoneSpec, type Vector3 } from './layout';
import { MATERIALS } from './materials';

const materials = new Map<string | number, THREE.MeshStandardMaterial>();
export function material(color: string | number) {
  let value = materials.get(color);
  if (!value) { value = new THREE.MeshStandardMaterial({ color, roughness: .85, flatShading: true }); materials.set(color, value); }
  return value;
}
const cube = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.IcosahedronGeometry(1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const cone = new THREE.ConeGeometry(1, 1, 8);
const roofGeometry = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
const melonStripeGeometry = new THREE.TorusGeometry(.585, .038, 5, 24);
const bowlingStripeGeometry = new THREE.TorusGeometry(.89, .025, 4, 24);
const flagShape = new THREE.Shape();
flagShape.moveTo(0, 0); flagShape.lineTo(1.22, -.12); flagShape.lineTo(.99, -.45); flagShape.lineTo(1.21, -.74); flagShape.lineTo(0, -.64); flagShape.closePath();
const flagGeometry = new THREE.ShapeGeometry(flagShape);
const flagMaterial = new THREE.MeshStandardMaterial({ color: '#387f86', side: THREE.DoubleSide, roughness: .9 });
const glassMaterial = new THREE.MeshStandardMaterial({ color: '#9fd9cf', roughness: .18, metalness: .12, transparent: true, opacity: .62, flatShading: true });

// Static scenery shares draw calls. Dynamic buildings retain individual bodies/meshes.
function batchScenery(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; shadow: boolean; receive: boolean; pieces: THREE.BufferGeometry[]; originals: THREE.Mesh[] }>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const key = `${object.material.uuid}-${object.castShadow}-${object.receiveShadow}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { material: object.material, shadow: object.castShadow, receive: object.receiveShadow, pieces: [], originals: [] }; buckets.set(key, bucket); }
    bucket.pieces.push((object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld));
    bucket.originals.push(object);
  });
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.pieces);
    if (geometry) {
      bucket.originals.forEach(object => object.removeFromParent());
      const merged = new THREE.Mesh(geometry, bucket.material); merged.castShadow = bucket.shadow; merged.receiveShadow = bucket.receive; group.add(merged);
    }
    bucket.pieces.forEach(geometry => geometry.dispose());
  }
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: string | number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = new THREE.Mesh(geometry, material(color));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true; parent.add(m);
  return m;
}
export const box = (p: THREE.Object3D, color: string | number, x: number, y: number, z: number, w: number, h: number, d: number) => mesh(p, cube, color, x, y, z, w, h, d);
export const sphere = (p: THREE.Object3D, color: string | number, x: number, y: number, z: number, w: number, h = w, d = w) => mesh(p, ball, color, x, y, z, w, h, d);

function beam(p: THREE.Object3D, color: string, a: THREE.Vector3, b: THREE.Vector3, width: number) {
  const m = box(p, color, 0, 0, 0, width, a.distanceTo(b), width);
  m.position.copy(a).add(b).multiplyScalar(.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function catapultModel() {
  const group = new THREE.Group();
  const dark = '#69442e', wood = '#b7834c', edge = '#dfb77a', metal = '#3b494b';
  box(group, wood, 0, .38, 0, 2.7, .3, 1.6);
  for (const z of [-.7, .7]) {
    box(group, dark, 0, .55, z, 3.2, .2, .22);
    for (const x of [-1.05, 1.05]) {
      const wheel = mesh(group, cylinder, dark, x, .45, z * 1.3, .5, .2, .5);
      wheel.rotation.x = Math.PI / 2;
      const hub = mesh(group, cylinder, edge, x, .45, z * 1.46, .17, .23, .17);
      hub.rotation.x = Math.PI / 2;
    }
    beam(group, wood, new THREE.Vector3(-.85, .6, z), new THREE.Vector3(.05, 1.85, z), .24);
    beam(group, wood, new THREE.Vector3(1.0, .6, z), new THREE.Vector3(.05, 1.85, z), .24);
  }
  box(group, metal, .05, 1.65, 0, .2, .2, 2.0);
  const arm = new THREE.Group(); arm.name = 'arm'; arm.position.set(.05, 1.65, 0);
  box(arm, edge, -.2, 0, 0, 3.25, .2, .25);
  box(arm, dark, 1.12, -.3, 0, .5, .65, .7);
  box(arm, dark, -1.68, .12, 0, .72, .16, .9);
  for (const z of [-.42, .42]) box(arm, wood, -1.68, .26, z, .72, .22, .1);
  box(arm, wood, -1.98, .26, 0, .12, .22, .9);
  arm.rotation.z = -.5; group.add(arm);
  return group;
}

export function slingshotModel() {
  const group = new THREE.Group(); group.position.z = LAUNCH.z;
  mesh(group, cylinder, '#8b714b', 0, .08, 0, 1.6, .16, 1.25);
  beam(group, '#85542f', new THREE.Vector3(0, .1, 0), new THREE.Vector3(0, 2.15, 0), .52);
  beam(group, '#b27d46', new THREE.Vector3(.12, .3, .18), new THREE.Vector3(.12, 2.1, .18), .17);
  for (const side of [-1, 1]) {
    beam(group, '#a16b3c', new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(side * 1.65, 4.1, 0), .42);
    beam(group, '#c49a60', new THREE.Vector3(side * .3, 2.35, .21), new THREE.Vector3(side * 1.65, 4.1, .21), .13);
    for (let i = 0; i < 4; i++) box(group, '#e0c388', side * 1.65, 3.98 + i * .1, 0, .48, .055, .47);
  }
  for (let i = 0; i < 5; i++) box(group, '#c9a16a', 0, .7 + i * .16, .02, .58, .065, .57);
  const pouch = sphere(group, '#70492f', 0, LAUNCH.y - .53, .1, .86, .18, .51);
  const anchors = [-1, 1].map(side => new THREE.Vector3(side * 1.65, 4.1, .06));
  const bands = anchors.map(a => beam(group, '#c38c48', a, new THREE.Vector3(0, LAUNCH.y - .48, .1), .15));
  return {
    group,
    update(position: Vector3) {
      const p = new THREE.Vector3(position.x, position.y - .5, position.z - LAUNCH.z + .1);
      pouch.position.copy(p);
      bands.forEach((band, i) => {
        const a = anchors[i]!;
        band.position.copy(a).add(p).multiplyScalar(.5);
        band.scale.y = a.distanceTo(p);
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(a).normalize());
      });
    },
  };
}

export function ammoModel(kind: ProjectileKind) {
  const g = new THREE.Group();
  if (kind === 'cow') {
    const cream = '#fff9e8', black = '#343b3a';
    box(g, cream, -.1, .05, 0, 1.8, .85, .85);
    box(g, black, -.55, .08, .44, .58, .56, .04).rotation.z = .2;
    box(g, black, .22, .28, .44, .4, .36, .04).rotation.z = -.18;
    box(g, black, -.1, .49, 0, .55, .035, .82);
    for (const x of [-.65, .47]) for (const z of [-.29, .29]) {
      box(g, cream, x, -.63, z, .22, .55, .22);
      box(g, black, x + .025, -.87, z, .26, .18, .26);
    }
    box(g, cream, .91, .36, 0, .67, .8, .75);
    box(g, '#eeae9e', 1.23, .15, 0, .3, .35, .79);
    for (const z of [-.4, .4]) {
      box(g, black, 1.02, .54, z, .1, .12, .025);
      box(g, '#c37e74', 1.393, .2, z * .5, .012, .06, .08);
      box(g, cream, .82, .76, z * 1.4, .42, .14, .25).rotation.x = z;
      mesh(g, cone, '#bc9b62', .79, .97, z * .7, .12, .36, .12).rotation.z = -.15;
    }
    const tail = box(g, cream, -1.12, -.06, 0, .12, .67, .12); tail.rotation.z = -.5;
    sphere(g, black, -1.27, -.38, 0, .16);
  } else if (kind === 'rocket') {
    const body = mesh(g, cylinder, '#fff5df', 0, 0, 0, .48, 1.8, .48); body.rotation.z = -Math.PI / 2;
    const nose = mesh(g, cone, '#df684b', 1.18, 0, 0, .49, .65, .49); nose.rotation.z = -Math.PI / 2;
    const nozzle = mesh(g, cylinder, '#415556', -.98, 0, 0, .33, .26, .33); nozzle.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      box(g, '#df684b', -.62, side * .46, 0, .63, .5, .13).rotation.z = side * -.5;
      box(g, '#df684b', -.62, 0, side * .46, .63, .13, .5).rotation.y = side * .5;
    }
    const rim = mesh(g, cylinder, '#435f63', .27, .04, .47, .25, .12, .25); rim.rotation.x = Math.PI / 2;
    const glass = mesh(g, cylinder, '#9cdce1', .27, .04, .55, .18, .05, .18); glass.rotation.x = Math.PI / 2;
    box(g, '#e1cda5', -.3, 0, 0, .17, .99, .99);
  } else if (kind === 'bomb') {
    sphere(g, '#303c42', 0, -.06, 0, .85);
    mesh(g, cylinder, '#596061', 0, .74, 0, .25, .3, .25);
    const fuse = mesh(g, cylinder, '#c8ad76', .16, 1.03, 0, .055, .5, .055); fuse.rotation.z = -.65;
    sphere(g, '#ffbc50', .33, 1.23, 0, .18);
    sphere(g, '#ef7447', .33, 1.24, 0, .1);
    sphere(g, '#69767a', -.27, .27, .67, .16, .19, .035);
  } else if (kind === 'catapult') {
    const catapult = catapultModel(); catapult.scale.setScalar(.62); catapult.position.y = -.7; g.add(catapult);
    const melon = ammoModel('watermelon'); melon.scale.setScalar(.53); melon.position.set(-1, .69, 0); melon.name = 'melon'; g.add(melon);
  } else if (kind === 'watermelon') {
    sphere(g, '#689443', 0, 0, 0, .7, .61, .61);
    for (const angle of [-.65, 0, .65]) {
      const stripe = new THREE.Mesh(melonStripeGeometry, material('#335e3d'));
      stripe.rotation.y = Math.PI / 2; stripe.position.x = angle * .7;
      stripe.scale.setScalar(Math.sqrt(1 - angle * angle)); g.add(stripe);
    }
  } else {
    sphere(g, '#696188', 0, 0, 0, .9);
    for (const [x, y] of [[-.2, .23], [.12, .34], [.2, .02]]) sphere(g, '#342e4d', x!, y!, .83, .115, .115, .035);
    const stripe = new THREE.Mesh(bowlingStripeGeometry, material('#aa9bbe'));
    stripe.rotation.x = .7; g.add(stripe);
  }
  return g;
}

const stoneColors = ['#e9dab7', '#d7c7a3', '#e2d1ad', '#cdbd99', '#f0e1bf'];
export function stoneModel(s: StoneSpec) {
  const g = new THREE.Group();
  if (s.style === 'barrel') {
    mesh(g, cylinder, '#b35e3f', 0, 0, 0, s.w / 2, s.h - .04, s.d / 2);
    for (const y of [-.4, .4]) mesh(g, cylinder, '#535c54', 0, y, 0, s.w / 2 + .03, .12, s.d / 2 + .03);
    box(g, '#ffe1a3', 0, 0, s.d / 2, .37, .37, .025).rotation.z = Math.PI / 4;
    box(g, '#9e4e35', 0, .025, s.d / 2 + .03, .06, .22, .025);
    sphere(g, '#ffce73', .08, s.h / 2 + .09, 0, .08);
  } else if (s.style === 'treasure') {
    box(g, '#976b39', 0, 0, 0, s.w, s.h, s.d);
    for (const x of [-.5, .5]) box(g, '#e0b34c', x, .05, 0, .15, s.h + .05, s.d + .035);
    box(g, '#f3cb5f', 0, 0, s.d / 2 + .06, .26, .32, .1);
    box(g, '#efd379', 0, s.h / 2 + .03, 0, s.w, .09, s.d);
  } else if (s.style === 'roof') {
    const roof = mesh(g, roofGeometry, s.roofColor ?? '#bb5e47', 0, 0, 0, s.w / Math.SQRT2, s.h, s.d / Math.SQRT2);
    if (s.material === 'glass') roof.material = glassMaterial;
    // The roof's warm eaves make the keep readable from the fixed game camera.
    box(g, s.material === 'glass' ? '#607d6b' : s.material === 'iron' ? '#45585b' : '#843f33', 0, -s.h / 2 + .08, 0, s.w, .18, s.d);
  } else {
    const color = s.material === 'stone' ? s.style === 'trim' ? '#bbab86' : stoneColors[s.tone]! : s.material === 'timber' ? ['#b38350', '#c39965', '#996c42', '#bd925e', '#a5784b'][s.tone]! : MATERIALS[s.material].color;
    const body = box(g, color, 0, 0, 0, s.w - .042, s.h - .032, s.d - .035);
    if (s.material === 'glass') {
      body.material = glassMaterial;
      for (const side of [-1, 1]) box(g, '#6b8b70', side * (s.w / 2 - .05), 0, s.d / 2, .065, s.h, .05);
      box(g, '#6b8b70', 0, s.h / 2 - .04, s.d / 2, s.w, .065, .05);
    } else if (s.material === 'timber') {
      box(g, '#87613f', 0, -.1, s.d / 2, s.w - .07, .025, .025);
    } else if (s.material === 'iron') {
      for (const side of [-1, 1]) sphere(g, '#b1b5a7', side * s.w * .34, .15, s.d / 2 + .025, .055, .055, .035);
    }
    if (s.window) {
      box(g, '#ad9a76', 0, .05, s.d / 2 + .02, .53, .66, .12);
      box(g, '#435758', 0, .08, s.d / 2 + .09, .28, .53, .035);
      box(g, '#d2bc90', 0, -.24, s.d / 2 + .13, .66, .09, .23);
    }
  }
  if (s.style === 'mill') {
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 0, s.d / 2 + .22);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Group(); blade.rotation.z = i * Math.PI / 2;
      box(blade, '#765437', 0, 1.05, 0, .11, 2.1, .1);
      box(blade, '#f5e6b4', .22, 1.2, .015, .53, 1.4, .06);
      rotor.add(blade);
    }
    sphere(rotor, '#8f633b', 0, 0, .13, .23); g.add(rotor);
  }
  if (s.flag) {
    const base = s.h / 2;
    mesh(g, cylinder, '#6b5b3e', 0, base + .95, 0, .045, 1.9, .045);
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(.04, base + 1.82, .04); flag.name = 'flag'; g.add(flag);
    sphere(g, '#e8b74e', 0, base + 1.96, 0, .1);
  }
  return g;
}

export function environment(scene: THREE.Scene) {
  scene.background = new THREE.Color('#d5e8ea');
  scene.fog = new THREE.Fog('#d5e8ea', 95, 190);
  scene.add(new THREE.HemisphereLight('#fff9e7', '#8e9772', 2.6));
  const sun = new THREE.DirectionalLight('#fff4db', 3.2); sun.position.set(-25, 48, 30);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 25, bottom: -25, far: 130 });
  sun.shadow.normalBias = .04; sun.shadow.bias = -.0003; scene.add(sun);
  const world = new THREE.Group(); scene.add(world);
  box(world, '#b7a582', 0, -3.0, -20, 180, 5, 180);
  box(world, '#859d65', 0, -.4, -20, 180, .8, 180);
  box(world, '#99b277', 0, -.035, -20, 180, .12, 180);
  const random = randomFrom(2941);
  for (let i = 0; i < 23; i++) {
    const x = -80 + i * 7.6;
    sphere(world, i % 2 ? '#a3beb0' : '#b5cbc0', x, -5 + random() * 1.5, -38 - random() * 10, 15 + random() * 10, 4 + random() * 5, 13);
  }
  for (let i = 0; i < 15; i++) {
    const x = -50 + i * 7.5;
    sphere(world, '#799e7c', x, -1, -40 - random() * 9, 8 + random() * 5, 3 + random() * 3, 7);
  }
  const path = new THREE.Shape();
  path.moveTo(-1.3, -6); path.bezierCurveTo(-2, 2, 3, 9, -1.7, 28);
  path.lineTo(1.7, 28); path.bezierCurveTo(6, 9, 1, 2, 1.3, -6); path.closePath();
  const trail = new THREE.Mesh(new THREE.ShapeGeometry(path, 20), new THREE.MeshStandardMaterial({ color: '#c6bd8b', side: THREE.DoubleSide, roughness: 1 }));
  trail.rotation.x = Math.PI / 2; trail.position.y = .035; // Shape coordinates become x/z.
  world.add(trail);
  for (let i = 0; i < 150; i++) {
    const x = random() * 60 - 30, z = random() * 68 - 30;
    if ((Math.abs(x) < 10 && z < -4 && z > -22) || (Math.abs(x) < 3 && z > -8)) continue;
    if (i < 28) {
      sphere(world, i % 3 ? '#a7ae8c' : '#c0bea1', x, .1, z, .2 + random() * .45, .15 + random() * .3, .24 + random() * .4);
    } else {
      const h = .15 + random() * .32;
      box(world, '#748e55', x, h / 2, z, .045, h, .045).rotation.z = random() * .5;
      if (i % 3 === 0) sphere(world, i % 2 ? '#f6e8ae' : '#eee9d2', x, h, z, .11, .07, .11);
    }
  }
  for (const [x, z, scale] of [[-14, -15, 1.6], [-18, -22, 1.1], [15, -11, 1.4], [20, -19, 2], [13, 8, 1.5], [-12, 13, 1.5], [-18, -32, 2], [18, -30, 1.6]]) {
    const tree = new THREE.Group(); tree.position.set(x!, 0, z!); tree.scale.setScalar(scale!);
    mesh(tree, cylinder, '#786a4b', 0, 1.1, 0, .18, 2.2, .18);
    sphere(tree, '#537e60', 0, 2.65, 0, 1.35, 1.6, 1.2);
    sphere(tree, '#6a9569', -.4, 3.1, .2, .95, 1.25, .95);
    world.add(tree);
  }
  const clouds = new THREE.Group(); scene.add(clouds);
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Group(); cloud.position.set(-70 + i * 18, 13 + random() * 6, -25 - random() * 12);
    for (let n = 0; n < 5; n++) {
      const puff = sphere(cloud, '#f4f3e7', (n - 2) * 1.5, random(), 0, 2.4, 1.1 + random() * .8, 1.3);
      puff.castShadow = false;
    }
    clouds.add(cloud);
  }
  batchScenery(world); batchScenery(clouds);
  return clouds;
}

export function makeThumbnails() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(220, 150); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#9b8c70', 3));
  const light = new THREE.DirectionalLight('#fff5e7', 3); light.position.set(-3, 5, 5); scene.add(light);
  const camera = new THREE.OrthographicCamera(-2.1, 2.1, 1.43, -1.43, .1, 30);
  camera.position.set(3, 2, 6); camera.lookAt(0, .05, 0);
  const images = new Map<ProjectileKind, string>();
  for (const kind of ['cow', 'rocket', 'bomb', 'catapult', 'bowling'] as const) {
    const model = ammoModel(kind); scene.add(model); renderer.render(scene, camera);
    images.set(kind, renderer.domElement.toDataURL('image/png')); scene.remove(model);
  }
  renderer.dispose(); renderer.forceContextLoss();
  return images;
}
