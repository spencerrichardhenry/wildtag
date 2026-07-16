import * as THREE from 'three';
import { CAMERA, MAX_FRAME_DT, SIM_DT } from './core/constants.ts';

// ---------------------------------------------------------------------------
// Boot scene: renderer, camera, a placeholder ground plane + spinning cube.
// Later tasks hook their own systems into `update(dt)` / `render()` below.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('canvas#game not found');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = false; // shadows off for perf
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // placeholder sky color

const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far,
);
camera.position.set(0, 2, 6);
camera.lookAt(0, 1, 0);

// Lighting: hemisphere fill + a directional "sun" so the cube reads as lit.
const hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x6b5b47, 1.0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff2d0, 1.2);
sunLight.position.set(50, 80, 30);
scene.add(sunLight);

// Placeholder ground plane.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x4a7c3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Placeholder spinning cube.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xcc5533 }),
);
cube.position.set(0, 1, 0);
scene.add(cube);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', resize);

/** Advance simulation state by a fixed timestep. Systems hook in here. */
function update(dt: number): void {
  cube.rotation.x += 0.6 * dt;
  cube.rotation.y += 0.9 * dt;
}

/** Draw the current state. Called once per animation frame. */
function render(): void {
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Fixed-timestep game loop: accumulator pattern, SIM_DT-sized update steps,
// render every animation frame. Frame delta is clamped so tab-switches /
// long stalls don't cause a spiral-of-death catch-up burst.
// ---------------------------------------------------------------------------

let accumulator = 0;
let lastTime = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);

  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const frameDt = Math.min(rawDt, MAX_FRAME_DT);

  accumulator += frameDt;
  while (accumulator >= SIM_DT) {
    update(SIM_DT);
    accumulator -= SIM_DT;
  }

  render();
}

requestAnimationFrame(frame);
