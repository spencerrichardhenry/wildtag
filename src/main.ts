import * as THREE from 'three';
import { CAMERA, MAX_FRAME_DT, SIM_DT } from './core/constants.ts';
import { setupEnvironment } from './world/environment.ts';
import { ChunkManager } from './world/chunks.ts';
import { PropManager } from './world/props.ts';
import { groundNormalAt, heightAt } from './world/terrain.ts';
import type { GroundQuery } from './core/types.ts';
import { Input } from './player/input.ts';
import { PlayerController } from './player/controller.ts';
import { createInventory, addResource } from './craft/inventory.ts';
import { ScreenManager, createCraftScreen, createHelpScreen } from './ui/screens.ts';
import { createGuideScreen } from './ui/guide.ts';
import { HUD } from './ui/hud.ts';
import { runCritterPreview } from './critters/preview.ts';
import { CritterManager } from './critters/manager.ts';
import { DartSystem } from './tracking/darts.ts';
import { updateTracking } from './tracking/tracker.ts';
import { toast } from './ui/toasts.ts';
import { chime } from './ui/audio.ts';

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

// Dev hook: `?preview=critters` takes over the renderer with the critter
// showcase (all 8 species on a turntable) and skips the normal player spawn.
if (new URLSearchParams(window.location.search).get('preview') === 'critters') {
  runCritterPreview(renderer);
} else {
  bootGame();
}

/** Normal gameplay boot: scene, camera, world streaming and the FP controller. */
function bootGame(): void {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );

  setupEnvironment(scene);

  const chunks = new ChunkManager(scene);
  const props = new PropManager(scene);
  const critters = new CritterManager(scene);
  const skyDome = scene.getObjectByName('skyDome');

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  window.addEventListener('resize', resize);

  // -------------------------------------------------------------------------
  // Player: first-person input + movement + camera. Spawn in the central meadow
  // at ground height. No abilities are unlocked initially — walk / sprint / jump
  // / dash are available from spawn; glider / rocket / boots / grapple are not.
  // -------------------------------------------------------------------------
  const ground: GroundQuery = { heightAt, normalAt: groundNormalAt };
  const spawn = { x: 0, y: heightAt(0, 0), z: 0 };

  const input = new Input(canvas as HTMLCanvasElement);
  const player = new PlayerController(camera, input, ground, spawn);

  // Inventory accumulating harvested resources + the crafting tree's currency
  // (RP), consumables (darts) and held deployable kits.
  const inventory = createInventory();

  // World clock (seconds of simulated time) driving resource-node respawns.
  let worldTime = 0;

  const hud = document.getElementById('hud');
  if (!hud) throw new Error('#hud not found');

  // -------------------------------------------------------------------------
  // Screens (KeyC crafting, Esc to close): one overlay in #hud. While a screen
  // is open, pointer lock is released and the player controller is not
  // stepped (see `update()` below) — the sim otherwise keeps running (chunk
  // streaming, prop upkeep) so nothing pops in when the player closes the menu.
  // Input is passed so open/close drop latched jump/dash/rocket edges (state()
  // isn't read while paused, so they'd otherwise fire stale on close).
  // -------------------------------------------------------------------------
  const screens = new ScreenManager(hud, input);
  screens.register(createCraftScreen(inventory, player.unlocks, screens));
  // Field Guide (Tab): the 8-species silhouette grid (Task 10).
  screens.register(createGuideScreen(critters, screens));
  // Pause / Help overlay (Esc): keybind reference + Resume (Task 11).
  screens.register(createHelpScreen(screens));

  // The heads-up display (Task 11): crosshair, stamina, resources, hotbar,
  // compass and tracking rings. All DOM lives in #hud, layered below screens
  // and toasts. Fed a per-frame snapshot in `render()` below.
  const hudUi = new HUD(hud, camera);

  // Dev hook: `?screen=craft` / `?screen=guide` / `?screen=help` forces a
  // screen open on boot — used for verification screenshots.
  const screenParam = new URLSearchParams(window.location.search).get('screen');
  if (screenParam === 'craft' || screenParam === 'guide' || screenParam === 'help') {
    screens.open(screenParam);
  }

  // -------------------------------------------------------------------------
  // Tracker darts (Task 10): LMB throws a dart from the camera; a hit tags the
  // critter, which the tracking loop below Links once the player has stayed in
  // range long enough. Reward chime + toast fire from the tracker's onLink.
  // -------------------------------------------------------------------------
  const darts = new DartSystem(scene, camera, critters, inventory, ground);

  // Reusable scratch for the camera look direction (harvest aim).
  const _look = new THREE.Vector3();
  function cameraLook(): { x: number; y: number; z: number } {
    camera.getWorldDirection(_look);
    return { x: _look.x, y: _look.y, z: _look.z };
  }

  /** Advance simulation state by a fixed timestep. Systems hook in here. */
  function update(dt: number): void {
    worldTime += dt;

    // While a screen (crafting) is open: don't step movement/collision, and
    // ignore gameplay action edges (interact) — only the screen-toggle edges
    // below still fire so KeyC/Esc can close it. Chunk/prop streaming keeps
    // running so nothing pops in when the menu closes.
    const paused = screens.isOpen();

    if (!paused) {
      // Feed the controller trees/rocks near the player before it integrates.
      const prev = player.pos;
      player.obstacles = props.getObstacles(prev.x, prev.z);
      player.update(dt);
    }

    const p = player.pos;
    chunks.update(p.x, p.z);
    props.update(p.x, p.z, worldTime);
    critters.update(dt, p);

    // Advance darts in flight and tracking progress for tagged critters. On a
    // Link the tracker grants rewards; onLink plays the chime + toast here.
    // Both freeze while a screen is open (parity: no linking over a menu, no
    // unfair progress decay while the player is frozen).
    if (!paused) {
      darts.update(dt);
      updateTracking(dt, {
        manager: critters,
        inventory,
        playerPos: p,
        onLink: (view, sp) => {
          chime();
          toast(`Linked ${sp.name}!  +${sp.rewardSparks} spark  +${sp.rewardRP} RP`);
          void view;
        },
      });
    }

    for (const action of input.consumeActions()) {
      if (action.type === 'toggleC') {
        screens.toggle('craft');
        continue;
      }
      if (action.type === 'tab') {
        screens.toggle('guide');
        continue;
      }
      if (action.type === 'escape') {
        // Esc opens the pause/help overlay when nothing is open; while a
        // screen is open it closes that screen (existing handleEscape).
        if (screens.isOpen()) screens.handleEscape();
        else screens.open('help');
        continue;
      }
      if (paused) continue; // gameplay actions (interact/hotbar/lmb/rmb) freeze while a screen is open
      if (action.type === 'hotbar') {
        hudUi.selectHotbar(action.slot);
      }
      if (action.type === 'interact') {
        const gained = props.harvestAt(camera.position, cameraLook(), worldTime);
        if (gained) addResource(inventory, gained, 1);
      }
      if (action.type === 'lmb') {
        darts.tryThrow();
      }
    }

    // Keep the sky dome centred on the camera so its gradient never parallaxes.
    if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
  }

  /** Draw the current state + repaint the HUD. Called once per frame. */
  function render(): void {
    renderer.render(scene, camera);
    const p = player.pos;
    const aimed = props.findHarvestable(camera.position, cameraLook(), worldTime);
    hudUi.update({
      pos: p,
      yaw: input.yaw,
      stamina: player.stamina,
      inventory,
      unlocks: player.unlocks,
      critters: critters.list(),
      harvestPrompt: aimed ? aimed.kind : null,
      spawn,
      locked: input.locked,
      screenOpen: screens.isOpen(),
    });
  }

  // Prime the chunk field + props + critters at spawn before the first frame so
  // nothing pops in.
  chunks.update(spawn.x, spawn.z);
  props.primeAround(spawn.x, spawn.z, worldTime);
  critters.update(SIM_DT, spawn);

  // -------------------------------------------------------------------------
  // Debug handle for later tasks (Task 14 expands this into a full debug menu).
  // -------------------------------------------------------------------------
  (window as unknown as { __game: unknown }).__game = {
    player: {
      pos: () => player.pos,
      teleport: (x: number, y: number, z: number) => player.teleport(x, y, z),
      look: (yaw: number, pitch = 0) => {
        input.yaw = yaw;
        input.pitch = pitch;
      },
    },
    critters: () => critters.list(),
  };

  // -------------------------------------------------------------------------
  // Fixed-timestep game loop: accumulator pattern, SIM_DT-sized update steps,
  // render every animation frame. Frame delta is clamped so tab-switches /
  // long stalls don't cause a spiral-of-death catch-up burst.
  // -------------------------------------------------------------------------

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
}
