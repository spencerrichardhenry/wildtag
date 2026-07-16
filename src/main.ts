import * as THREE from 'three';
import { CAMERA, MAX_FRAME_DT, SIM_DT, STRUCTURES } from './core/constants.ts';
import { setupEnvironment } from './world/environment.ts';
import { ChunkManager } from './world/chunks.ts';
import { PropManager } from './world/props.ts';
import { biomeAt, groundNormalAt, heightAt } from './world/terrain.ts';
import type { GroundQuery } from './core/types.ts';
import { Input } from './player/input.ts';
import { PlayerController } from './player/controller.ts';
import { createInventory, addResource } from './craft/inventory.ts';
import { ScreenManager, createCraftScreen } from './ui/screens.ts';
import { createGuideScreen } from './ui/guide.ts';
import { runCritterPreview } from './critters/preview.ts';
import { CritterManager } from './critters/manager.ts';
import { DartSystem } from './tracking/darts.ts';
import { updateTracking, nearestTracked } from './tracking/tracker.ts';
import { toast } from './ui/toasts.ts';
import { chime } from './ui/audio.ts';
import { AnchorRegistry } from './structures/anchors.ts';
import { ZiplineSystem } from './structures/ziplines.ts';
import { DroneSystem } from './structures/drones.ts';
import { PlacementSystem } from './structures/placement.ts';
import { raycastTerrain } from './player/grapple.ts';

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
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  const debugGrapple = debugParam === 'grapple';
  const debugStructures = debugParam === 'structures';
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

  // Grapple anchor registry — drones (Task 13) register tracked spheres here;
  // the controller raycasts it alongside the terrain when a grapple is fired.
  const anchors = new AnchorRegistry();

  const input = new Input(canvas as HTMLCanvasElement);
  const player = new PlayerController(camera, input, ground, spawn, scene, anchors);

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

  // Dev hook: `?screen=craft` / `?screen=guide` forces a screen open on boot —
  // used for verification screenshots; harmless to keep for future tasks.
  const screenParam = new URLSearchParams(window.location.search).get('screen');
  if (screenParam === 'craft' || screenParam === 'guide') {
    screens.open(screenParam);
  }

  // -------------------------------------------------------------------------
  // Tracker darts (Task 10): LMB throws a dart from the camera; a hit tags the
  // critter, which the tracking loop below Links once the player has stayed in
  // range long enough. Reward chime + toast fire from the tracker's onLink.
  // -------------------------------------------------------------------------
  const darts = new DartSystem(scene, camera, critters, inventory, ground);

  // -------------------------------------------------------------------------
  // Deployable structures (Task 13): ziplines + drones + their placement mode.
  // Hotbar 3 → zipline (two-stage), hotbar 4 → drone. Drones register grapple
  // anchors on the shared registry, so a hovering drone is instantly
  // grappleable. `hudHooks` exposes live counts for the Task 11 HUD to read.
  // -------------------------------------------------------------------------
  const ziplines = new ZiplineSystem(scene, ground, inventory);
  const drones = new DroneSystem(scene, ground, anchors, inventory);
  const placement = new PlacementSystem(scene, camera, ground, inventory, ziplines, drones);
  const hudHooks = {
    ziplineCount: (): number => ziplines.count,
    droneCount: (): number => drones.count,
    placing: (): boolean => placement.active,
    riding: (): boolean => ziplines.riding,
  };

  // Reusable scratch for the camera look direction (harvest aim).
  const _look = new THREE.Vector3();
  function cameraLook(): { x: number; y: number; z: number } {
    camera.getWorldDirection(_look);
    return { x: _look.x, y: _look.y, z: _look.z };
  }

  // -------------------------------------------------------------------------
  // Debug HUD: a tiny dev line (pos / stamina / grounded / biome), refreshed at
  // ~4 Hz. Replaced by the real HUD in Task 11.
  // -------------------------------------------------------------------------
  const debugLine = document.createElement('div');
  debugLine.style.cssText =
    'position:fixed;top:8px;left:8px;font:12px monospace;color:#cfe;text-shadow:0 1px 2px #000;white-space:pre;';
  hud.appendChild(debugLine);

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  let hudTimer = 0;
  function updateHud(dt: number): void {
    hudTimer += dt;
    if (hudTimer < 0.25) return;
    hudTimer = 0;
    const p = player.pos;
    const b = biomeAt(p.x, p.z);
    const aimed = props.findHarvestable(camera.position, cameraLook(), worldTime);
    const prompt = aimed ? `\nF — Harvest ${capitalize(aimed.kind)}` : '';

    // Nearest active critter (species/state) for the dev line.
    let nearest: { species: string; state: string } | null = null;
    let nearestD = Infinity;
    for (const c of critters.list()) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = { species: c.species, state: c.state };
      }
    }
    const critterLine = nearest
      ? `\ncritters ${critters.count()}  nearest ${nearest.species} (${nearest.state}) ${nearestD.toFixed(0)}m`
      : `\ncritters ${critters.count()}`;

    // Temporary tracking readout (Task 11 replaces with the real HUD): nearest
    // tagged-not-linked critter's Link progress and current distance vs radius.
    const tracked = nearestTracked(critters, p);
    const trackLine = tracked
      ? `\nTRACKING ${tracked.sp.name} ${((tracked.view.trackProgress / tracked.sp.trackTime) * 100).toFixed(0)}% ` +
        `${tracked.dist.toFixed(1)}m/${tracked.sp.trackRadius}m`
      : '';

    debugLine.textContent =
      `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  ` +
      `stamina ${player.stamina.toFixed(0)}  ` +
      `${player.grounded ? 'grounded' : 'air'}  ${player.mode}  biome ${b}  ` +
      `[fib ${inventory.fiber} res ${inventory.resin} shd ${inventory.shard} spk ${inventory.spark} ` +
      `rp ${inventory.rp} darts ${inventory.darts}]` +
      critterLine +
      trackLine +
      prompt;
  }

  /** Advance simulation state by a fixed timestep. Systems hook in here. */
  function update(dt: number): void {
    worldTime += dt;

    // While a screen (crafting) is open: don't step movement/collision, and
    // ignore gameplay action edges (interact) — only the screen-toggle edges
    // below still fire so KeyC/Esc can close it. Chunk/prop streaming keeps
    // running so nothing pops in when the menu closes.
    const paused = screens.isOpen();

    // `?debug=grapple`/`?debug=structures` freeze the player for a clean static
    // screenshot while the world keeps streaming.
    const debugFrozen = debugGrapple || debugStructures;
    if (!paused && !debugFrozen) {
      // Zipline ride / mount / recall runs first: while riding it drives the
      // controller's pos/vel and the controller skips its normal pipeline.
      ziplines.updateRide(dt, player, player.pos, input);
      // Feed the controller trees/rocks near the player before it integrates.
      const prev = player.pos;
      player.obstacles = props.getObstacles(prev.x, prev.z);
      player.update(dt);
    }

    // Structure cosmetics + placement ghost always tick (drones bob/spin even
    // while frozen for the debug screenshot); interaction is gated above.
    drones.update(dt);
    if (!paused && !debugFrozen) {
      drones.updateRecall(dt, player.pos, input);
      if (placement.active) placement.update(dt);
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
        // Esc cancels an in-progress placement before it touches any screen.
        if (placement.active) placement.cancel();
        else screens.handleEscape();
        continue;
      }
      if (paused) continue; // gameplay actions (interact/hotbar/lmb/rmb) freeze while a screen is open
      // Hotbar 3/4 enter (or toggle out of) structure placement mode.
      if (action.type === 'hotbar') {
        if (action.slot === 3) placement.toggle('zipline');
        else if (action.slot === 4) placement.toggle('drone');
        continue;
      }
      if (action.type === 'interact') {
        // F near a post (mount/recall) or under a drone (recall) is owned by the
        // structure systems — don't also harvest there.
        if (!ziplines.nearMount(player.pos) && !drones.nearRecall(player.pos)) {
          const gained = props.harvestAt(camera.position, cameraLook(), worldTime);
          if (gained) addResource(inventory, gained, 1);
        }
      }
      if (action.type === 'lmb') {
        if (placement.active) {
          placement.confirm(); // LMB confirms a placement
        } else if (!player.isGrappling() && player.mode !== 'zipline') {
          // LMB reels the rope while grappled; dart throws are suppressed then
          // and while riding a zipline.
          darts.tryThrow();
        }
      }
    }

    // Keep the sky dome centred on the camera so its gradient never parallaxes.
    if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
    updateHud(dt);
  }

  /** Draw the current state. Called once per animation frame. */
  function render(): void {
    renderer.render(scene, camera);
  }

  // Prime the chunk field + props + critters at spawn before the first frame so
  // nothing pops in.
  chunks.update(spawn.x, spawn.z);
  props.primeAround(spawn.x, spawn.z, worldTime);
  critters.update(SIM_DT, spawn);

  // -------------------------------------------------------------------------
  // Debug swing (`?debug=grapple`): drop the player onto a highlands ridge,
  // scan the look for an uphill hillside within grapple range, fire the rope
  // there and freeze — a static frame showing the rope from the eye to the
  // slope. Verification-only; harmless otherwise.
  // -------------------------------------------------------------------------
  if (debugGrapple) {
    player.unlocks.add('grapple');
    // A low saddle in the western crags: sharp ridged spires rise within range,
    // so the scan below can find an anchor above the eye for an upward rope.
    let px = -300;
    let pz = -40;
    // Nudge to the lowest of a few nearby candidates so terrain rises around us.
    for (const [cx, cz] of [
      [-300, -40],
      [-280, -80],
      [-320, 0],
      [-260, -30],
      [-340, 40],
    ] as const) {
      if (heightAt(cx, cz) < heightAt(px, pz)) {
        px = cx;
        pz = cz;
      }
    }
    // Sweep the aim (looking gently down at the surrounding slope) using the
    // real camera forward, and take the longest terrain hit — the most legible
    // rope. The camera is re-synced per candidate via a teleport so the fired
    // anchor lands exactly along the view centre.
    let bestYaw = 0;
    let bestPitch = 0;
    let bestScore = -Infinity;
    let bestHit: { x: number; y: number; z: number } | null = null;
    // Sweep yaw and a few upward pitches; score anchors above the eye highest.
    for (let deg = 0; deg < 360; deg += 4) {
      const yaw = (deg * Math.PI) / 180;
      for (const pitch of [0.35, 0.2, 0.05, -0.1]) {
        input.yaw = yaw;
        input.pitch = pitch;
        player.teleport(px, heightAt(px, pz) + 1.5, pz);
        const eye = camera.position;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const hit = raycastTerrain({ x: eye.x, y: eye.y, z: eye.z }, dir, heightAt, 44);
        if (!hit) continue;
        const dist = Math.hypot(hit.x - eye.x, hit.y - eye.y, hit.z - eye.z);
        if (dist <= 14) continue;
        const rise = hit.y - eye.y; // reward an anchor above the eye
        const score = rise * 6 + dist;
        if (score > bestScore) {
          bestScore = score;
          bestYaw = yaw;
          bestPitch = pitch;
          bestHit = hit;
        }
      }
    }
    if (bestHit) {
      input.yaw = bestYaw;
      input.pitch = bestPitch;
      player.teleport(px, heightAt(px, pz) + 1.5, pz); // re-sync camera to the winning aim
      player.debugFireGrapple(bestHit);
    }
    chunks.update(px, pz);
    props.primeAround(px, pz, worldTime);
  }

  // -------------------------------------------------------------------------
  // Debug structures (`?debug=structures`): grant kits, auto-place a zipline
  // across a meadow strip and a drone hovering overhead, then frame the camera
  // on them and freeze — a static shot of posts + sagging cable + drone.
  // -------------------------------------------------------------------------
  if (debugStructures) {
    inventory.kits.zipline += 3;
    inventory.kits.drone += 2;

    const az = 10;
    const ax = -15;
    const bx = 35;
    const a = { x: ax, y: heightAt(ax, az) + STRUCTURES.postHeight, z: az };
    const b = { x: bx, y: heightAt(bx, az) + STRUCTURES.postHeight, z: az };
    ziplines.place(a, b);
    drones.place({ x: 10, y: heightAt(10, az), z: az }, { instant: true });
    drones.update(SIM_DT); // register the anchor + seat the mesh at altitude

    // Stand back on the -z side and look toward the structures (+z), tilted up
    // so both the cable and the hovering drone are in frame.
    const cx = 10;
    const cz = -28;
    input.yaw = Math.PI; // face +z
    input.pitch = 0.32;
    player.teleport(cx, heightAt(cx, cz) + 0.2, cz);

    chunks.update(cx, cz);
    props.primeAround(cx, cz, worldTime);
  }

  // -------------------------------------------------------------------------
  // Debug handle for later tasks (Task 14 expands this into a full debug menu).
  // -------------------------------------------------------------------------
  (window as unknown as { __game: unknown }).__game = {
    structures: hudHooks,
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
