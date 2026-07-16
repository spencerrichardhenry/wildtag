import * as THREE from 'three';
import { CAMERA, MAX_FRAME_DT, SIM_DT } from './core/constants.ts';
import { setupEnvironment } from './world/environment.ts';
import { ChunkManager } from './world/chunks.ts';
import { biomeAt, groundNormalAt, heightAt } from './world/terrain.ts';
import type { GroundQuery } from './core/types.ts';
import { Input } from './player/input.ts';
import { PlayerController } from './player/controller.ts';

// ---------------------------------------------------------------------------
// Boot scene: renderer, camera, environment (lighting/fog/sky/water) and the
// streaming terrain ChunkManager, plus the playable first-person controller.
// The fixed-timestep loop steps the controller (input → movement → camera) and
// streams chunks around the player. Later tasks hook further systems into
// `update(dt)` / `render()`.
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
const skyDome = scene.getObjectByName('skyDome');

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Player: first-person input + movement + camera. Spawn in the central meadow
// at ground height. No abilities are unlocked initially — walk / sprint / jump
// / dash are available from spawn; glider / rocket / boots / grapple are not.
// ---------------------------------------------------------------------------
const ground: GroundQuery = { heightAt, normalAt: groundNormalAt };
const spawn = { x: 0, y: heightAt(0, 0), z: 0 };

const input = new Input(canvas);
const player = new PlayerController(camera, input, ground, spawn);

// ---------------------------------------------------------------------------
// Debug HUD: a tiny dev line (pos / stamina / grounded / biome), refreshed at
// ~4 Hz. Replaced by the real HUD in Task 11.
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
const debugLine = document.createElement('div');
debugLine.style.cssText =
  'position:fixed;top:8px;left:8px;font:12px monospace;color:#cfe;text-shadow:0 1px 2px #000;white-space:pre;';
hud?.appendChild(debugLine);

let hudTimer = 0;
function updateHud(dt: number): void {
  hudTimer += dt;
  if (hudTimer < 0.25) return;
  hudTimer = 0;
  const p = player.pos;
  const b = biomeAt(p.x, p.z);
  debugLine.textContent =
    `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  ` +
    `stamina ${player.stamina.toFixed(0)}  ` +
    `${player.grounded ? 'grounded' : 'air'}  ${player.mode}  biome ${b}`;
}

/** Advance simulation state by a fixed timestep. Systems hook in here. */
function update(dt: number): void {
  player.update(dt);
  const p = player.pos;
  chunks.update(p.x, p.z);
  // Keep the sky dome centred on the camera so its gradient never parallaxes.
  if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
  updateHud(dt);
}

/** Draw the current state. Called once per animation frame. */
function render(): void {
  renderer.render(scene, camera);
}

// Prime the chunk field at spawn before the first frame so nothing pops in.
chunks.update(spawn.x, spawn.z);

// ---------------------------------------------------------------------------
// Debug handle for later tasks (Task 14 expands this into a full debug menu).
// ---------------------------------------------------------------------------
(window as unknown as { __game: unknown }).__game = {
  player: {
    pos: () => player.pos,
    teleport: (x: number, y: number, z: number) => player.teleport(x, y, z),
  },
};

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
