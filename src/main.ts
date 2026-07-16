import * as THREE from 'three';
import { CAMERA, MAX_FRAME_DT, SIM_DT } from './core/constants.ts';
import { setupEnvironment } from './world/environment.ts';
import { ChunkManager } from './world/chunks.ts';

// ---------------------------------------------------------------------------
// Boot scene: renderer, camera, environment (lighting/fog/sky/water) and the
// streaming terrain ChunkManager. Later tasks hook their own systems into
// `update(dt)` / `render()` below.
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

const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far,
);

setupEnvironment(scene);

const chunks = new ChunkManager(scene);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// TEMP: fly-over — replaced by PlayerController in Task 5.
// Camera drifts from spawn (meadow) west toward the crags at ~120 m altitude,
// looking down ~30°, feeding its x/z to the ChunkManager so chunks stream.
// ---------------------------------------------------------------------------
const flyover = {
  t: 0,
  altitude: 120,
  speed: 18, // m/s
  from: new THREE.Vector3(0, 0, 0), // spawn (meadow)
  to: new THREE.Vector3(-750, 0, 0), // crags lobe is west (−x)
};

function updateFlyover(dt: number): void {
  flyover.t += dt;
  const dist = flyover.from.distanceTo(flyover.to);
  const travelled = Math.min(flyover.t * flyover.speed, dist);
  const s = dist > 0 ? travelled / dist : 1;

  const x = THREE.MathUtils.lerp(flyover.from.x, flyover.to.x, s);
  const z = THREE.MathUtils.lerp(flyover.from.z, flyover.to.z, s);
  camera.position.set(x, flyover.altitude, z);

  // Look ~30° below horizontal, in the direction of travel.
  const dir = new THREE.Vector3().subVectors(flyover.to, flyover.from).setY(0).normalize();
  const look = new THREE.Vector3(x, flyover.altitude, z)
    .addScaledVector(dir, 100)
    .setY(flyover.altitude - 100 * Math.tan(Math.PI / 6));
  camera.lookAt(look);

  chunks.update(x, z);
}

/** Advance simulation state by a fixed timestep. Systems hook in here. */
function update(dt: number): void {
  updateFlyover(dt);
}

/** Draw the current state. Called once per animation frame. */
function render(): void {
  renderer.render(scene, camera);
}

// Prime the chunk field at spawn before the first frame so nothing pops in.
chunks.update(0, 0);

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
