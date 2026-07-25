import * as THREE from 'three';
import { CAMERA, ENV, MAX_FRAME_DT, MOUNT, SIM_DT, STRUCTURES } from './core/constants.ts';
import { setupEnvironment, setupDaylight, updateWater } from './world/environment.ts';
import { daylightAt } from './core/daylight.ts';
import { ChunkManager } from './world/chunks.ts';
import { PropManager } from './world/props.ts';
import { groundNormalAt, heightAt } from './world/terrain.ts';
import type { GroundQuery, Vec3 } from './core/types.ts';
import { Input } from './player/input.ts';
import { PlayerController } from './player/controller.ts';
import { createHealth, isDazed, stepHealth } from './player/health.ts';
import { createInventory, addResource } from './craft/inventory.ts';
import { ScreenManager, createCraftScreen, createHelpScreen } from './ui/screens.ts';
import { createGuideScreen } from './ui/guide.ts';
import { createRosterScreen, setRosterActions } from './ui/roster.ts';
import { HUD } from './ui/hud.ts';
import { runCritterPreview } from './critters/preview.ts';
import { CritterManager, type CritterView } from './critters/manager.ts';
import { speciesById } from './critters/species.ts';
import { bond, release, byId, type RosterEntry } from './critters/roster.ts';
import { MountSystem } from './player/mount-system.ts';
import { canAssignToFarm, canMount, canSummon, setActiveMount } from './player/mount.ts';
import { DartSystem } from './tracking/darts.ts';
import { updateTracking } from './tracking/tracker.ts';
import { toast } from './ui/toasts.ts';
import { chime } from './ui/audio.ts';
import { AnchorRegistry } from './structures/anchors.ts';
import { ZiplineSystem } from './structures/ziplines.ts';
import { DroneSystem } from './structures/drones.ts';
import { PlacementSystem, serializeStructures, deserializeStructures } from './structures/placement.ts';
import { raycastTerrain } from './player/grapple.ts';
import {
  applyStartingLoadout,
  loadSave,
  writeSave,
  clearSave,
  snapToGround,
  type SaveV3,
} from './core/save.ts';
import { buildDebugHandle } from './debug.ts';
import {
  currentQuality,
  initQuality,
  isSoftwareRenderer,
  loadStoredQuality,
  parseQualityOverride,
  qualityFlags,
  setQuality,
  tierBelow,
  type QualityId,
} from './core/quality.ts';
import { ShadowRig, planShadows } from './world/lighting.ts';
import { buildPostPipeline, type PostPipeline } from './world/post.ts';
import { buildVillage, villageObstacles } from './village/buildings.ts';
import { NpcManager, NPCS, npcAnchors } from './village/npcs.ts';
import { createDialogScreen, openDialog, setRequestRenderer } from './village/dialog.ts';
import { villageCenter } from './village/layout.ts';
import {
  generateRequest,
  canFulfill,
  fulfill,
  nextReward,
  requestText,
  reroll,
  trackingFillRate,
  type NpcRequestState,
} from './village/barter.ts';
import {
  resetRewards,
  recordReward,
  grantedCount,
  grantedRewards,
  getRewards,
} from './village/rewards.ts';
import { PenSystem } from './village/pens.ts';
import {
  createFarm,
  setDeeds,
  assign as assignPlot,
  unassignEntry,
  firstFreePlot,
  collect as collectPlot,
  tick as tickFarm,
  type FarmState,
} from './farm/farm.ts';
import { FarmVisuals } from './farm/visuals.ts';

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
// ACES filmic tone mapping + sRGB output: the whole scene is authored/lit in
// linear space and mapped through the film curve on output, so highlights roll
// off and the golden-hour warmth reads richly instead of clipping.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ENV.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Shadows start ENABLED; a perf gate (first ENV.shadowGateFrames frames) turns
// them off for the session if measured fps is below ENV.shadowFpsGate. On
// SwiftShader/e2e that gate trips immediately → shadows auto-off.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// Dev hook: `?preview=critters` takes over the renderer with the critter
// showcase (all 12 species on a turntable) and skips the normal player spawn.
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
  const debugVillage = debugParam === 'village';
  // Dev override (`?forcefx=1`): run cascade shadows + the post composer even on
  // a software backend (SwiftShader). The software gate normally skips both so
  // the headless suite stays on the low/direct path; this forces the real code
  // paths on for verification screenshots (slow, but proves they compile/render).
  const forceFx = new URLSearchParams(window.location.search).get('forcefx') === '1';

  // Quality preset (Fidelity-2 P1): resolve `?quality=` override > stored
  // Esc-menu choice > auto-detect (software backend → low). The chosen preset
  // drives the shadow gate below; P2/P3 grow more consumers.
  initQuality(renderer);
  // Whether the preset was auto-detected (no explicit override / stored choice):
  // only an auto preset is allowed to auto-downgrade on the fps gate below.
  const qualityAuto =
    !parseQualityOverride(window.location.search) &&
    !loadStoredQuality(window.localStorage);
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );

  setupEnvironment(scene);
  // Day/night visuals (Cursed Castle Task 5): sun/hemi/fog/sky-dome/stars react
  // to `worldClock` below; `daylight.sunScale` is fed into the shadow rig each
  // frame (created further down) so cascade shares stay proportionally correct.
  const daylight = setupDaylight(scene);

  const chunks = new ChunkManager(scene);
  const props = new PropManager(scene);
  const critters = new CritterManager(scene);

  /**
   * Esc-menu quality change: persist the choice, and — because shadows/post/LOD
   * need a fresh boot to rebuild their pipelines — toast a reload prompt when any
   * of those reload-required flags differ from the previous preset.
   */
  function applyQuality(id: QualityId): void {
    const prev = qualityFlags();
    if (id === currentQuality()) return;
    setQuality(id, true);
    const next = qualityFlags();
    const reloadNeeded =
      prev.shadowCascades !== next.shadowCascades ||
      prev.shadowRes !== next.shadowRes ||
      prev.ssao !== next.ssao ||
      prev.bloom !== next.bloom ||
      prev.waterReflections !== next.waterReflections ||
      prev.terrainDetailShader !== next.terrainDetailShader ||
      prev.nearLod !== next.nearLod;
    toast(
      reloadNeeded
        ? `Quality: ${id} — reload to apply shadows & effects`
        : `Quality: ${id}`,
    );
  }
  const skyDome = scene.getObjectByName('skyDome');

  // Cascade shadows (F2 P3). The always-present sun (environment.ts) is wrapped
  // as the base cascade by a hand-rolled ShadowRig; on high a second near-cascade
  // light is added (see lighting.ts). Cascades follow the player each frame with
  // tight ortho frusta. `shadowRig.enabled` is the live gate, mirrored onto the
  // debug state (window.__f1) and cleared by the fps gate in the frame loop.
  const sunLight = scene.getObjectByName('sunLight') as THREE.DirectionalLight;
  const sunDir = new THREE.Vector3(ENV.sunPos.x, ENV.sunPos.y, ENV.sunPos.z).normalize();
  const shadowRig = new ShadowRig(scene, sunLight);
  let shadowFlagFrame = 0;
  // A software backend (SwiftShader/llvmpipe — headless e2e) can't afford shadows
  // or the post composer even under ?quality=high: the preset FLAGS still report
  // the requested cascades/ssao/bloom (so the e2e feature-diff stays honest), but
  // the actual GPU passes are skipped. `?forcefx=1` overrides this for verification.
  const softwareRenderer = isSoftwareRenderer(renderer);
  const fxAllowed = !softwareRenderer || forceFx;

  // Post pipeline (F2 P3, high only + fxAllowed). Null on medium/low/software →
  // the direct render path. Rebuilt only by a fresh boot (reload-required flags).
  let post: PostPipeline | null = null;

  /** Re-derive the cascade rig from the live preset (boot + fps-gate tier drop). */
  function syncShadowQuality(): void {
    const q = qualityFlags();
    const renderShadows = q.shadowCascades > 0 && fxAllowed;
    shadowRig.apply(planShadows(q.shadowCascades, q.shadowRes), renderShadows);
    renderer.shadowMap.enabled = shadowRig.enabled;
    if (shadowRig.enabled) flagShadowCasters();
  }

  /** Build/tear-down the post composer to match the live preset. */
  function syncPost(): void {
    const flags = qualityFlags();
    const want = (flags.ssao || flags.bloom) && fxAllowed;
    if (want && !post) {
      post = buildPostPipeline(renderer, scene, camera, flags);
    } else if (!want && post) {
      post.dispose();
      post = null;
    }
  }
  syncShadowQuality();
  syncPost();

  /** Flag props/critters/village/terrain meshes as shadow casters/receivers. */
  function flagShadowCasters(): void {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      if (mesh.name === 'skyDome' || mesh.name === 'water') return;
      mesh.castShadow = true;
      // Terrain chunks already receive in chunks.ts; broad ground props too.
      if (mesh.name.startsWith('chunk ')) mesh.receiveShadow = true;
    });
  }

  /** Bracket the cascade lights around the player each frame. */
  function updateShadowFollow(): void {
    if (!shadowRig.enabled) return;
    shadowRig.follow(player.pos, sunDir);
    // Re-flag casters periodically (props/critters stream in over time).
    if (shadowFlagFrame++ % 15 === 0) flagShadowCasters();
  }

  // Haven Village (Task V3): static seeded settlement in the NE spawn meadow —
  // built once (always resident near spawn), its NPCs streamed by NpcManager.
  // Buildings/lamps expose collision circles fed into the player obstacle set.
  buildVillage(scene);
  const npcs = new NpcManager(scene);
  const villageObs = villageObstacles();
  // Traded-away critters live in a pen beside their NPC (Haven V4).
  const pens = new PenSystem(scene);

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    post?.setSize(width, height);
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
  // Feed the grapple hook the nearby grappleable tree/rock cylinders so a fired
  // hook can latch to props, not just bare terrain.
  player.grappleColliders = (x, z) => props.getGrappleColliders(x, z);

  // Inventory accumulating harvested resources + the crafting tree's currency
  // (RP), consumables (darts/charms) and held deployable kits.
  const inventory = createInventory();

  // Bonded roster (Haven V2): critters captured out of the wild with a Bond
  // Charm. Reassigned (not mutated) on each bond so the roster screen's
  // getter always reads the live array. `nameCursor` is a monotonic index into
  // the shuffled name pool (persisted in the save as `nameCursor`) so bonded
  // nicknames never collide within a session or across reloads.
  let roster: RosterEntry[] = [];
  let nameCursor = 0;

  // Barter (Haven V4): each NPC holds one live request from a seeded rotation;
  // the global reward track (owned-rewards store) is shared across all NPCs.
  // Requests are (re)generated deterministically from seq + the player's
  // linked species, so a loaded save reproduces the exact live request.
  const barterStates = new Map<string, NpcRequestState>();
  resetRewards();

  /** The live barter state for `npcId`, creating a seq-0 request on first ask. */
  function barterStateFor(npcId: string): NpcRequestState {
    let st = barterStates.get(npcId);
    if (!st) {
      st = {
        npcId,
        seq: 0,
        request: generateRequest(npcId, 0, critters.linkedSpecies()),
        fulfilled: 0,
      };
      barterStates.set(npcId, st);
    }
    return st;
  }

  // Farm (Haven V5): plots at the farmhouse; bonded critters produce their
  // species resource into per-plot hoppers on a timer. Unlocked plot count is
  // 2 + 2×(Plot Deeds owned) — deeds live on the barter reward track (V4).
  const getDeedCount = (): number =>
    grantedRewards().filter((r) => r === 'plotDeed').length;
  let farm: FarmState = createFarm(getDeedCount());
  let lastDeeds = getDeedCount();
  const farmVisuals = new FarmVisuals(scene);

  // Player HP (Cursed Castle Task 6): pure state stepped each frame. No
  // damage sources exist yet — goblins (Task 11) will call `applyHit`.
  let health = createHealth();

  /** Replace a roster entry's status (immutably, so the screen re-reads it). */
  function setEntryStatus(id: number, status: RosterEntry['status']): void {
    roster = roster.map((e) => (e.id === id ? { ...e, status } : e));
  }

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
  // Pause / Help overlay (Esc): keybind reference + Resume (Task 11) + the
  // Fidelity-2 quality selector.
  screens.register(createHelpScreen(screens, { current: currentQuality, apply: applyQuality }));
  // Village dialog (F near an NPC): flavour + request placeholder (Task V3).
  screens.register(createDialogScreen(screens));
  // Roster (KeyB, Haven V2): bonded critters + Release. `getRoster` reads the
  // live array (reassigned on each bond); `release` drops the entry and returns
  // the critter to the wild near the player.
  screens.register(
    createRosterScreen({
      getRoster: () => roster,
      release: releaseFromRoster,
      manager: screens,
    }),
  );

  // The heads-up display (Task 11): crosshair, stamina, resources, hotbar,
  // compass and tracking rings. All DOM lives in #hud, layered below screens
  // and toasts. Fed a per-frame snapshot in `render()` below.
  const hudUi = new HUD(hud, camera);

  // Dev hook: `?screen=craft` / `?screen=guide` / `?screen=help` forces a
  // screen open on boot — used for verification screenshots.
  const screenParam = new URLSearchParams(window.location.search).get('screen');
  if (screenParam === 'roster') {
    // Inject a few bonded critters so the screenshot shows a populated roster.
    for (const [id, speciesId] of [
      [-9001, 'puffle'],
      [-9002, 'prismhorse'],
      [-9003, 'snickerdoodle'],
    ] as const) {
      const r = bond(roster, { id, speciesId, linked: true }, nameCursor);
      if (r) {
        roster = r.roster;
        nameCursor++;
      }
    }
  }
  if (
    screenParam === 'craft' ||
    screenParam === 'guide' ||
    screenParam === 'help' ||
    screenParam === 'roster'
  ) {
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
  // grappleable. Live counts/placing/riding are read straight off these
  // systems by the Task 14 debug handle's `state()` snapshot.
  // -------------------------------------------------------------------------
  const ziplines = new ZiplineSystem(scene, ground, inventory);
  const drones = new DroneSystem(scene, ground, anchors, inventory);
  const placement = new PlacementSystem(scene, camera, ground, inventory, ziplines, drones);

  // Prismhorse mount (Haven V6): owns the single active-mount actor + ride
  // state. Set from the roster (Mount button) or a barter'd Saddle; ridden via
  // KeyV. The pure kinematics + eligibility gates live in player/mount.ts.
  const mounts = new MountSystem(scene, ground, camera);

  // -------------------------------------------------------------------------
  // Save/load (Task 14): apply a stored save (if any) BEFORE the world primes
  // around the player below, so streamed critters/props reflect the restored
  // state on the very first frame. `?fresh=1` skips loading (dev aid). A
  // brand-new game (no save, or `?fresh=1`) instead grants the starting dart
  // loadout — `createInventory()` itself stays a pure zero constructor.
  // -------------------------------------------------------------------------
  const freshStart = new URLSearchParams(window.location.search).get('fresh') === '1';
  // `?dev=1`: playtest mode — everything unlocked, effectively-infinite darts
  // and materials. Implies a fresh throwaway session (never touches the save).
  const devMode = new URLSearchParams(window.location.search).get('dev') === '1';
  let loaded: SaveV3 | null = freshStart || devMode ? null : loadSave();
  // Day/night clock (Cursed Castle Task 5): seconds since world start, fed
  // through `daylightAt()` each frame. Restored from the save (absent on
  // pre-v3 saves → fresh day-1 boot).
  let worldClock = loaded?.daylightT ?? 0;
  let primePos: Vec3 = spawn;
  if (loaded) {
    try {
      Object.assign(inventory, applyStartingLoadout(inventory, loaded));
      for (const u of loaded.unlocks) player.unlocks.add(u);
      critters.importRegistry(loaded.critterPersist);
      roster = (loaded.roster ?? []).map((e) => ({ ...e, status: { ...e.status } }));
      // Restore the nickname cursor (absent on pre-V7 saves → 0) so names keep
      // marching through the shuffled pool rather than repeating from the top.
      nameCursor = loaded.nameCursor ?? 0;
      // Barter/pens/rewards (Haven V4): restore the granted-reward list (WITHOUT
      // re-applying bundle resources — inventory is saved separately), the
      // per-NPC rotation state (live request regenerated from seq + linked
      // species), and the traded-away critters living at each pen.
      resetRewards(loaded.rewards ?? []);
      for (const b of loaded.barter ?? []) {
        barterStates.set(b.npcId, {
          npcId: b.npcId,
          seq: b.seq,
          // Prefer the CONCRETE persisted request (Haven V7) so a reload never
          // swaps an outstanding request; regeneration is the fallback for old
          // saves that predate request persistence.
          request: b.request ?? generateRequest(b.npcId, b.seq, critters.linkedSpecies()),
          fulfilled: b.fulfilled,
        });
      }
      pens.load(loaded.pens ?? []);
      // Farm: restore saved plots, re-deriving unlock flags from the live deed
      // count (a fresh farm if the save predates V5).
      farm = loaded.farm ? setDeeds(loaded.farm, getDeedCount()) : createFarm(getDeedCount());
      lastDeeds = getDeedCount();
      deserializeStructures(loaded.structures, ziplines, drones);
      // Cursed Castle: snap the restored position back onto the live terrain if
      // it's reshaped underneath an old save (e.g. the world grandeur rescale)
      // — otherwise the player could resurrect buried in or floating far above
      // the new ground.
      const restoredPos = snapToGround(loaded.player.pos, heightAt(loaded.player.pos.x, loaded.player.pos.z));
      player.teleport(restoredPos.x, restoredPos.y, restoredPos.z);
      input.yaw = loaded.player.yaw;
      hudUi.setHintFlags(loaded.hints);
      primePos = { ...restoredPos };
      // Mount (Haven V6): respawn the active-mount actor at its saved position
      // (or near the player if the field is absent but a roster entry still
      // carries the 'mount' status). Saddle mesh iff the Saddle reward is owned.
      mounts.load(loaded.mount ?? null, roster, player.pos, getRewards().has('saddle'));
    } catch (err) {
      // Belt and braces: decodeSave shape-guards the save, but any remaining
      // within-v1 drift must never break boot — unwind whatever half-applied
      // and fall back to a fresh start.
      console.warn('[wildtag] save apply failed — starting fresh', err);
      loaded = null;
      player.unlocks.clear();
      roster = [];
      nameCursor = 0;
      barterStates.clear();
      resetRewards();
      pens.load([]); // clear any pen critters half-applied before the throw
      farm = createFarm(getDeedCount());
      critters.importRegistry({});
      ziplines.deserialize([]);
      drones.deserialize([]);
      player.teleport(spawn.x, spawn.y, spawn.z);
      input.yaw = 0;
      hudUi.setHintFlags([]);
      primePos = spawn;
    }
  }
  if (!loaded) {
    // Fresh start (no save / ?fresh=1 / corrupt-apply fallback above): zeroed
    // inventory + the starting dart loadout.
    Object.assign(inventory, applyStartingLoadout(createInventory(), null));
  }
  if (devMode) {
    // Playtest loadout: every unlock, deep stacks of everything. The counts
    // are finite so all existing spend/decrement paths still exercise.
    inventory.fiber = 9999;
    inventory.resin = 9999;
    inventory.shard = 9999;
    inventory.spark = 9999;
    inventory.rp = 999;
    inventory.darts = 999;
    inventory.charms = 999;
    inventory.kits.zipline = 9;
    inventory.kits.drone = 9;
    for (const u of ['grapple', 'boots', 'glider', 'rocket']) player.unlocks.add(u);
    toast('DEV MODE — all unlocks, 999 darts, deep material stacks (no saving)');
  }

  /** Build the current in-memory state as a plain-data SaveV3 snapshot. */
  function buildSaveState(): SaveV3 {
    return {
      v: 3,
      inventory: { ...inventory, kits: { ...inventory.kits } },
      unlocks: [...player.unlocks],
      critterPersist: critters.exportRegistry(),
      structures: serializeStructures(ziplines, drones),
      player: { pos: player.pos, yaw: input.yaw },
      hints: hudUi.getHintFlags(),
      roster: roster.map((e) => ({ ...e, status: { ...e.status } })),
      nameCursor,
      barter: [...barterStates.values()].map((s) => ({
        npcId: s.npcId,
        seq: s.seq,
        fulfilled: s.fulfilled,
        // Persist the concrete outstanding request (Haven V7): a reload restores
        // the exact request rather than regenerating a possibly-different one.
        request: s.request,
      })),
      pens: pens.serialize(),
      rewards: [...grantedRewards()],
      farm: { plots: farm.plots.map((p) => ({ ...p, hopper: { ...p.hopper } })) },
      // Day/night clock (Cursed Castle Task 5): so a reload resumes at the
      // same time of day instead of always waking up at dawn.
      daylightT: worldClock,
      // Mount (Haven V6): only surfaced when a mount is active, so pre-mount
      // saves round-trip to exactly their old shape.
      ...(mounts.saveState() ? { mount: mounts.saveState()! } : {}),
    };
  }

  function doSave(): void {
    writeSave(buildSaveState());
  }

  // A dev-hook boot (?fresh=1, ?dev=1 or any ?debug=) runs throwaway state
  // that must never overwrite the player's real save — skip automatic writes.
  // `?screen=roster` injects phantom roster entries for screenshots — treat it
  // as a dev session too so they can never autosave into a real save.
  const devSession =
    freshStart || devMode || debugParam !== null || screenParam === 'roster' || forceFx;

  // Autosave every 10 s + on tab close/hide (mobile-safe: pagehide fires
  // where beforeunload sometimes doesn't).
  if (!devSession) {
    setInterval(doSave, 10_000);
    window.addEventListener('beforeunload', doSave);
    window.addEventListener('pagehide', doSave);
  }

  function resetSave(): void {
    clearSave();
    window.location.reload();
  }

  // Reusable scratch for the camera look direction (harvest aim).
  const _look = new THREE.Vector3();
  function cameraLook(): { x: number; y: number; z: number } {
    camera.getWorldDirection(_look);
    return { x: _look.x, y: _look.y, z: _look.z };
  }

  // -------------------------------------------------------------------------
  // Bonding (Haven V2). One Bond Charm captures a Linked critter into the
  // roster: it leaves the wild permanently (manager.consumeSlot) and gains a
  // deterministic nickname. `bondCritter` is the shared core used by both the
  // F-interaction and the __game.bond debug hook.
  // -------------------------------------------------------------------------
  const BOND_MAX_DIST = 30; // ≥ every species' trackRadius (per-species gate below)
  const BOND_COS = Math.cos((45 * Math.PI) / 180); // aim-cone half-angle

  function bondCritter(target: CritterView): boolean {
    if (inventory.charms <= 0) return false;
    if (!target.linked) return false;
    const sp = speciesById(target.species);
    if (!sp) return false;
    const result = bond(
      roster,
      { id: target.id, speciesId: target.species, linked: target.linked },
      nameCursor,
    );
    if (!result) return false;
    roster = result.roster;
    nameCursor++;
    inventory.charms -= 1;
    critters.consumeSlot(target.id);
    toast(`${result.entry.nickname} the ${sp.name} joins you!`);
    chime();
    screens.refresh(); // live-update the roster screen if it's open
    return true;
  }

  /**
   * F-interaction bond: the nearest Linked critter in the aim cone within its
   * own trackRadius, when the player holds a charm. Returns true if a bond
   * happened (so the interact chain skips harvest).
   */
  function tryBondInteract(): boolean {
    if (inventory.charms <= 0) return false;
    const target = critters.nearestInCone(camera.position, cameraLook(), BOND_MAX_DIST, BOND_COS);
    if (!target || !target.linked) return false;
    const sp = speciesById(target.species);
    if (!sp) return false;
    const p = player.pos;
    const d = Math.hypot(target.pos.x - p.x, target.pos.y - p.y, target.pos.z - p.z);
    if (d > sp.trackRadius) return false;
    return bondCritter(target);
  }

  /** __game.bond(id): bond a specific critter by id (verification hook). */
  function bondById(id: number): boolean {
    const target = critters.byId(id);
    if (!target) return false;
    return bondCritter(target);
  }

  /**
   * Release a bonded critter back to the wild: drop it from the roster and
   * return it to the world. A real wild slot (positive id) is re-opened at its
   * ORIGINAL home — `critters.releaseSlot` un-consumes the registry entry (kept
   * Linked), so it persists across save/reload and streams back in when the
   * player is near, then walks off. An ad-hoc debug-bonded critter (negative id
   * — its home isn't a real spawn slot) keeps the old ephemeral debug-spawn near
   * the player.
   */
  function releaseFromRoster(id: number): void {
    const entry = byId(roster, id);
    if (!entry) return;
    roster = release(roster, id);
    farm = unassignEntry(farm, id); // free any plot it worked
    if (mounts.activeEntryId() === id) {
      // Releasing the active mount: hop off first, then tear down the actor
      // (clearActive disposes the actor meshes per the disposeGroup pattern).
      if (player.mounted) mounts.dismount(player);
      mounts.clearActive();
    }
    // Re-open the original wild slot (persists, returns at home); fall back to
    // the ephemeral debug spawn only for ad-hoc negative-id (debug-bonded) ones.
    if (id < 0 || !critters.releaseSlot(id)) {
      const p = player.pos;
      const rx = p.x + 3;
      const rz = p.z;
      critters.debugSpawn(entry.speciesId, { x: rx, y: heightAt(rx, rz), z: rz });
    }
    toast(`${entry.nickname} released to the wild`);
  }

  // -------------------------------------------------------------------------
  // Barter fulfilment (Haven V4). Fulfilling an NPC's request consumes the
  // goods (idle roster critters → the NPC's pen, permanently; or resources),
  // grants the next reward on the global track, and rotates the NPC to a fresh
  // request. `force` (debug) grants the reward + rotates even when the goods
  // aren't on hand (no consumption in that case).
  // -------------------------------------------------------------------------
  function npcNameFor(npcId: string): string {
    return NPCS.find((n) => n.id === npcId)?.name ?? 'They';
  }

  function fulfillRequestFor(npcId: string, force: boolean): boolean {
    const st = barterStateFor(npcId);
    const req = st.request;
    if (canFulfill(req, roster, inventory)) {
      const res = fulfill(req, roster, inventory);
      if (res) {
        roster = res.roster;
        Object.assign(inventory, res.inventory);
        for (const e of res.delivered) pens.add(npcId, e.speciesId, e.nickname);
      }
    } else if (!force) {
      return false;
    }

    // Grant the next reward on the shared track (bundles add resources).
    const reward = nextReward(grantedCount());
    recordReward(reward.id);
    if (reward.kind === 'bundle' && reward.resource && reward.amount != null) {
      addResource(inventory, reward.resource, reward.amount);
    }

    // Rotate this NPC to a fresh request.
    st.fulfilled += 1;
    st.seq += 1;
    st.request = generateRequest(npcId, st.seq, critters.linkedSpecies());

    toast(`${npcNameFor(npcId)} gives you: ${reward.name}!`);
    chime();
    screens.refresh(); // live-update the dialog if it's open
    return true;
  }

  /**
   * Reroll an NPC's request (dialog "Ask for something else"): advance the seq
   * and mint a fresh request WITHOUT any reward or consumption — the escape
   * hatch for a request the player can no longer fulfil.
   */
  function rerollRequestFor(npcId: string): void {
    const st = barterStateFor(npcId);
    barterStates.set(npcId, reroll(st, critters.linkedSpecies()));
    screens.refresh(); // live-update the open dialog
  }

  /** Debug: grant a specific reward id (records it in the owned-rewards store). */
  function grantRewardById(id: string): void {
    recordReward(id);
    toast(`Granted reward: ${id}`);
    screens.refresh();
  }

  // Plug the real barter request into the dialog screen (Task V3 shipped the
  // hook + a placeholder). The renderer reads the live per-NPC request, shows a
  // reward preview, and enables Fulfill only when the request can be met.
  setRequestRenderer((npc, container) => {
    const st = barterStateFor(npc.id);
    const req = st.request;

    const body = document.createElement('div');
    body.className = 'wt-dialog-req-body';
    body.textContent = requestText(req);
    container.appendChild(body);

    const reward = nextReward(grantedCount());
    const rewardLine = document.createElement('div');
    rewardLine.className = 'wt-dialog-req-body';
    rewardLine.style.marginTop = '6px';
    rewardLine.style.color = '#c9b98a';
    rewardLine.textContent = `Reward: ${reward.name} — ${reward.description}`;
    container.appendChild(rewardLine);

    const actions = document.createElement('div');
    actions.className = 'wt-dialog-actions';
    // "Ask for something else": reroll this NPC's request with no reward/cost —
    // an escape hatch when the current ask is unmeetable. Styled as a quiet link.
    const rerollBtn = document.createElement('button');
    rerollBtn.type = 'button';
    rerollBtn.textContent = 'Ask for something else';
    rerollBtn.style.cssText =
      'margin-right:auto;background:none;border:none;color:#9fb0b8;font:inherit;' +
      'font-size:12px;text-decoration:underline;cursor:pointer;padding:6px 2px;';
    rerollBtn.addEventListener('click', () => {
      rerollRequestFor(npc.id);
    });
    const btn = document.createElement('button');
    btn.className = 'wt-craft-btn';
    btn.type = 'button';
    btn.textContent = 'Fulfill';
    btn.disabled = !canFulfill(req, roster, inventory);
    btn.addEventListener('click', () => {
      fulfillRequestFor(npc.id, false);
    });
    actions.append(rerollBtn, btn);
    container.appendChild(actions);
  });

  // Lantern Charm reward (Haven V4): a soft point light that follows the player
  // once the charm is owned (cosmetic night glow). Created lazily on first need.
  const lantern = new THREE.PointLight(0xffd9a0, 0, 14, 2);
  lantern.visible = false;
  scene.add(lantern);

  // Roster screen actions (Haven V5): Assign sends an idle critter to the first
  // free unlocked plot; Unassign pulls a farmed critter back to idle.
  // (setRosterActions MERGES handlers, so the mount task's registration below
  // coexists with this one.)
  /**
   * Assign a bonded roster entry to the first free unlocked plot. Shared by the
   * roster screen's Assign button and the __game.assignFarm(entryId) e2e hook.
   * Returns true iff a free plot took the critter.
   */
  function assignEntryToFarm(id: number): boolean {
    const free = firstFreePlot(farm);
    const entry = byId(roster, id);
    if (!entry) return false;
    if (!canAssignToFarm(entry)) {
      toast('Unset as mount first (Roster → Mount)');
      return false;
    }
    if (free === null) {
      toast('No free farm plots — earn Plot Deeds to expand the farm');
      return false;
    }
    farm = assignPlot(farm, free, id);
    setEntryStatus(id, { kind: 'farm', plotId: free });
    toast(`${entry.nickname} → farm plot ${free + 1}`);
    screens.refresh();
    return true;
  }

  setRosterActions({
    assign: (id: number) => {
      assignEntryToFarm(id);
    },
    unassign: (id: number) => {
      farm = unassignEntry(farm, id);
      setEntryStatus(id, { kind: 'idle' });
      screens.refresh();
    },
  });

  // -------------------------------------------------------------------------
  // Prismhorse mount (Haven V6). The roster Mount button sets a rideable bonded
  // critter as the single active mount (spec: only one at a time). KeyV rides
  // (within 4m), dismounts (while riding), or summons (with the Whistle) — else
  // it toasts how far away the mount wandered. The pure gates/kinematics/roster
  // transition live in player/mount.ts; the actor + ride live in the MountSystem.
  // -------------------------------------------------------------------------
  function activateMount(id: number): void {
    const entry = byId(roster, id);
    if (!canMount(getRewards(), entry) || !entry) {
      toast('Needs a Saddle and a rideable critter (barter for the Saddle).');
      return;
    }
    if (player.mounted) mounts.dismount(player); // hop off any current ride first
    roster = setActiveMount(roster, id); // previous mount → idle (single active)
    const p = player.pos;
    mounts.setActive(
      { id: entry.id, speciesId: entry.speciesId, nickname: entry.nickname },
      { x: p.x + 2, y: 0, z: p.z },
      getRewards().has('saddle'),
    );
    toast(`${entry.nickname} is your mount — press V near it to ride`);
    screens.refresh();
  }

  /** KeyV: dismount / mount-up / summon / locate, per the spec ladder. */
  function handleMountKey(): void {
    if (player.mounted) {
      mounts.dismount(player);
      return;
    }
    if (!mounts.active()) {
      toast('No active mount — set a rideable critter as your mount in the Roster (B).');
      return;
    }
    if (player.mode !== 'normal' || player.isGrappling()) {
      // Mount-up only from a settled, on-foot state — riding out of a zipline
      // ride snaps the player back, and riding off a grapple hook teleports.
      toast("Can't mount up right now — get to solid ground first.");
      return;
    }
    const nick = mounts.nickname() ?? 'Your mount';
    const ap = mounts.actorPos()!;
    const p = player.pos;
    // Full 3D distance (include the vertical delta) so a mount on a ledge
    // above/below doesn't read as in-range from a planar-only measure.
    const dist = Math.hypot(ap.x - p.x, ap.y - p.y, ap.z - p.z);
    if (dist <= MOUNT.mountRange) {
      if (placement.active) placement.cancel(); // no placement ghost mid-ride
      mounts.startRide(player);
      toast(`Riding ${nick}!`);
    } else if (canSummon(getRewards())) {
      mounts.summon(p);
      toast(`${nick} whistles to your side!`);
    } else {
      toast(`${nick} is ${Math.round(dist)}m away — walk over or barter for the Whistle.`);
    }
  }

  /** Debug (§6): summon the active mount to the player's side. */
  function debugSummonMount(): void {
    if (!mounts.active()) {
      toast('No active mount to summon.');
      return;
    }
    mounts.summon(player.pos);
    toast(`${mounts.nickname() ?? 'Your mount'} whistles to your side!`);
  }

  /** Debug (V6 e2e): instantly ride — activating a rideable mount if needed. */
  function debugRide(): boolean {
    if (player.mounted) return true;
    if (player.mode !== 'normal' || player.isGrappling()) return false;
    if (!mounts.active()) {
      const entry = roster.find((e) => canMount(getRewards(), e));
      if (!entry) return false;
      activateMount(entry.id);
    }
    if (placement.active) placement.cancel(); // no placement ghost mid-ride
    return mounts.startRide(player);
  }

  // Wire the roster Mount button (merges with the farm task's Assign handler).
  setRosterActions({
    mount: (id: number) => activateMount(id),
    mountEnabled: (id: number) => canMount(getRewards(), byId(roster, id)),
  });

  /** Advance simulation state by a fixed timestep. Systems hook in here. */
  function update(dt: number): void {
    worldTime += dt;

    // While a screen (crafting) is open: don't step movement/collision, and
    // ignore gameplay action edges (interact) — only the screen-toggle edges
    // below still fire so KeyC/Esc can close it. Chunk/prop streaming keeps
    // running so nothing pops in when the menu closes.
    const paused = screens.isOpen();
    if (!paused) health = stepHealth(health, dt);

    // `?debug=grapple`/`?debug=structures` freeze the player for a clean static
    // screenshot while the world keeps streaming.
    const debugFrozen = debugGrapple || debugStructures || debugVillage;
    // Day/night clock: advances at the same rate as `worldTime` (and so
    // inherits `timeScale` for free via extra accumulator steps per frame),
    // frozen under the same conditions as the rest of the sim.
    if (!paused && !debugFrozen) worldClock += dt;
    if (!paused && !debugFrozen) {
      // Zipline ride / recall runs first: while riding it drives the controller's
      // pos/vel and the controller skips its normal pipeline. Suppressed while
      // riding a mount so a nearby post can't hijack the ride.
      if (!player.mounted) ziplines.updateRide(dt, player, player.pos, input);
      // Feed the controller trees/rocks near the player before it integrates,
      // plus the static village building/lamp collision circles.
      const prev = player.pos;
      player.obstacles = props.getObstacles(prev.x, prev.z).concat(villageObs);
      player.update(dt);
      // Prismhorse mount: pin/animate the actor under the camera while riding,
      // or loosely trail the player while idle (also handles hold-Space dismount).
      mounts.update(dt, player, input);
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
    npcs.update(dt, p);
    pens.update(dt, worldTime);

    // Farm production (Haven V5): assigned critters accrue toward their hoppers.
    // Frozen while a screen is open (parity with tracking — no free progress).
    // Re-derive plot unlocks if the deed count changed (V4 grants deeds).
    if (!paused) {
      const deeds = getDeedCount();
      if (deeds !== lastDeeds) {
        farm = setDeeds(farm, deeds);
        lastDeeds = deeds;
      }
      farm = tickFarm(farm, roster, speciesById, dt);
    }

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
        // Golden Dart Tip reward accelerates ring fill 1.5× once owned.
        fillRate: trackingFillRate(getRewards()),
        onLink: (view, sp) => {
          chime();
          toast(`Linked ${sp.name}!  +${sp.rewardSparks} spark  +${sp.rewardRP} RP`);
          // Live-refresh an open screen so the Field Guide reflects a fresh Link
          // immediately (it rebuilds from manager.linkedSpecies() on render).
          screens.refresh();
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
      if (action.type === 'roster') {
        screens.toggle('roster');
        continue;
      }
      if (action.type === 'escape') {
        // Esc priority: cancel an in-progress placement, then close an open
        // screen, otherwise open the pause/help overlay.
        if (placement.active) placement.cancel();
        else if (screens.isOpen()) screens.handleEscape();
        else screens.open('help');
        continue;
      }
      if (action.type === 'mount') {
        // KeyV: ride/dismount your Prismhorse, or summon/locate it (Haven V6).
        if (!paused) handleMountKey();
        continue;
      }
      if (paused) continue; // gameplay actions (interact/hotbar/lmb/rmb) freeze while a screen is open
      // While mounted: dart-throw and structure placement are masked (F still
      // talks/collects; the grapple is already gated off in the controller).
      if (player.mounted && (action.type === 'hotbar' || action.type === 'lmb')) {
        if (action.type === 'hotbar') hudUi.selectHotbar(action.slot);
        continue;
      }
      // Hotbar: HUD highlight for every slot; 3/4 also toggle placement mode.
      // Slot 2 (grapple) isn't a selectable tool — it lives on RMB — so
      // selecting it explains the controls instead of silently doing nothing.
      if (action.type === 'hotbar') {
        hudUi.selectHotbar(action.slot);
        if (action.slot === 2) {
          toast(
            player.unlocks.has('grapple')
              ? 'Grapple: tap RMB to fire · auto-zips on latch · Space jumps off'
              : 'Grapple Hook not crafted yet — open Crafting (C)',
          );
        } else if (action.slot === 3) placement.toggle('zipline');
        else if (action.slot === 4) placement.toggle('drone');
        continue;
      }
      if (action.type === 'interact') {
        // Interact priority chain (Haven): village NPC > BOND > structures > harvest.
        const npc = npcs.nearestNpc(player.pos, 3);
        if (npc) {
          openDialog(screens, npc.def);
          continue;
        }
        // BOND: aiming at a Linked critter (within trackRadius) with a charm.
        if (tryBondInteract()) continue;
        // FARM: standing by a plot whose hopper holds something → collect it.
        const cp = farmVisuals.nearestCollectable(farm, player.pos);
        if (cp !== null) {
          const res = collectPlot(farm, cp);
          farm = res.farm;
          for (const g of res.gained) {
            addResource(inventory, g.resource, g.n);
            toast(`+${g.n} ${g.resource}`);
          }
          continue;
        }
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
        } else if (player.mode !== 'zipline') {
          // LMB throws a tracker dart (the grapple now lives entirely on RMB —
          // no reel binding); suppressed only while riding a zipline.
          darts.tryThrow();
        }
      }
    }

    // Keep the sky dome centred on the camera so its gradient never parallaxes.
    if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
  }

  /** Draw the current state + repaint the HUD. Called once per frame. */
  function render(): void {
    // Lantern Charm reward: a soft glow tracking the player once owned.
    if (getRewards().has('lanternCharm')) {
      lantern.visible = true;
      lantern.intensity = 1.6;
      lantern.position.set(camera.position.x, camera.position.y + 0.3, camera.position.z);
    } else {
      lantern.visible = false;
    }
    farmVisuals.update(farm, roster, worldTime, SIM_DT);
    // Day/night visuals (Task 5): sun/hemi/fog/sky-dome/moon/stars react to the
    // live daylight sample; the resolved sun-scale feeds the cascade rig so
    // night dimming survives a shadow re-plan (quality change / fps gate).
    const daylightSample = daylightAt(worldClock);
    daylight.update(daylightSample);
    shadowRig.setSunScale(daylight.sunScale);
    updateShadowFollow();
    // Water 1.5: advance the shader ripple/shimmer clock (one uniform write).
    updateWater(scene, worldTime);
    // High + fxAllowed → the post composer (SSAO + bloom + tone-map output);
    // otherwise the unchanged direct render path (medium/low/software).
    if (post) post.render();
    else renderer.render(scene, camera);
    npcs.updateLabels(camera);
    const p = player.pos;
    const aimed = props.findHarvestable(camera.position, cameraLook(), worldTime);
    // Latched-rope crosshair state (amber) so an attach is always legible.
    hudUi.setCrosshairMode(player.isGrappling() ? 'grapple' : 'auto');
    hudUi.update({
      pos: p,
      yaw: input.yaw,
      stamina: player.stamina,
      exhausted: player.exhausted,
      hp: health.hp,
      dazed: isDazed(health),
      inventory,
      unlocks: player.unlocks,
      critters: critters.list(),
      harvestPrompt: aimed ? aimed.kind : null,
      spawn,
      locked: input.locked,
      screenOpen: screens.isOpen(),
      dayCycleT: daylightSample.cycleT,
      dayDarkness: daylightSample.darkness,
    });
  }

  // Prime the chunk field + props + critters around the player before the
  // first frame so nothing pops in. `primePos` is the restored save position
  // when a save was loaded, otherwise the fresh spawn point.
  chunks.update(primePos.x, primePos.z);
  props.primeAround(primePos.x, primePos.z, worldTime);
  critters.update(SIM_DT, primePos);

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
  // Debug village (`?debug=village`): stand back from the settlement on a small
  // rise, look toward the plaza and freeze — a static cozy-hamlet frame showing
  // the buildings, lamps, fences and NPCs with their labels. Verification-only.
  // -------------------------------------------------------------------------
  if (debugVillage) {
    const c = villageCenter();
    // Camera on the origin side of the village, pulled back and lifted.
    const toOrigin = Math.atan2(-c.x, -c.z); // bearing from centre toward origin
    const dist = 38;
    const cx = c.x + Math.sin(toOrigin) * dist;
    const cz = c.z + Math.cos(toOrigin) * dist;
    const rise = heightAt(cx, cz) + 5.5;
    // Face the plaza: yaw so model/camera forward points centre-ward; pitch down.
    const dx = c.x - cx;
    const dz = c.z - cz;
    const horiz = Math.hypot(dx, dz);
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = Math.atan2(2 - rise, horiz); // aim at ~2m above the plaza
    player.teleport(cx, rise, cz);

    chunks.update(cx, cz);
    props.primeAround(cx, cz, worldTime);
    // Seat the NPCs (and their labels) for the frozen frame.
    npcs.update(SIM_DT, player.pos);
  }

  // -------------------------------------------------------------------------
  // Debug handle (Task 14): window.__game — the backbone for Task 15's
  // Playwright verification (state snapshot, teleport/grant/spawn/track/
  // completeTracking, time-scaling, save/reset). `timeScale` is read by the
  // fixed-timestep loop below (clamped 0.1..16 in setTimeScale so a runaway
  // value can neither stall nor explode the accumulator).
  // -------------------------------------------------------------------------
  let timeScale = 1;

  (window as unknown as { __game: unknown }).__game = buildDebugHandle({
    player,
    input,
    inventory,
    ground,
    critters,
    ziplines,
    drones,
    isPlacing: () => placement.active,
    isGrappling: () => player.isGrappling(),
    getTimeScale: () => timeScale,
    setTimeScale: (f: number) => {
      timeScale = Math.max(0.1, Math.min(16, f));
    },
    setWorldClock: (t: number) => {
      worldClock = t;
    },
    bond: (id: number) => {
      // Force-Link then bond — convenience for headless verification.
      critters.debugBond(id);
      return bondById(id);
    },
    fulfillRequest: (npcId: string) => fulfillRequestFor(npcId, true),
    grantReward: (id: string) => grantRewardById(id),
    summonMount: debugSummonMount,
    ride: debugRide,
    assignFarm: (entryId: number) => assignEntryToFarm(entryId),
    rosterCount: () => roster.length,
    rewards: () => [...grantedRewards()],
    save: doSave,
    resetSave,
    farmState: () => farm,
    // Draw-call / resource counters sampled from renderer.info after the last
    // render (Fidelity-2 P1 draw-call budget check).
    renderStats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    }),
    quality: () => ({ id: currentQuality(), flags: qualityFlags() }),
  });

  // Verification aid (Haven V4): expose deterministic village anchors + a couple
  // of camera helpers so the headless screenshot harness can frame the dialog
  // and pens without a real mouse (pointer lock is unavailable in headless).
  // No gameplay effect beyond opening a screen / aiming the existing camera —
  // but gated behind a dev session (?fresh/?dev/?debug/?screen=roster) so a
  // shipped build doesn't surface it. `__game` stays exposed always (its own
  // gating lives on the individual dev-only hooks).
  if (devSession) {
    (window as unknown as { __village: unknown }).__village = {
      center: villageCenter(),
      anchors: npcAnchors(),
      /** Open the barter dialog for `npcId` directly (bypasses F-proximity). */
      talk(npcId: string): void {
        const def = NPCS.find((n) => n.id === npcId);
        if (def) openDialog(screens, def);
      },
      /** Aim the camera at a world point (sets input yaw/pitch). */
      lookAt(x: number, y: number, z: number): void {
        const e = camera.position;
        const dx = x - e.x;
        const dy = y - e.y;
        const dz = z - e.z;
        input.yaw = Math.atan2(-dx, -dz);
        input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fixed-timestep game loop: accumulator pattern, SIM_DT-sized update steps,
  // render every animation frame. Frame delta is clamped so tab-switches /
  // long stalls don't cause a spiral-of-death catch-up burst.
  // -------------------------------------------------------------------------

  const MAX_STEPS_PER_FRAME = 240;
  let accumulator = 0;
  let lastTime = performance.now();

  // Perf gate (generalised from the F1 shadow gate into quality, P1): average
  // wall-clock fps over the first ENV.shadowGateFrames frames; if it's below
  // ENV.shadowFpsGate AND the preset was auto-detected, drop one quality tier
  // (which turns shadows down/off via syncShadowQuality). An explicit ?quality=
  // / stored choice is never auto-downgraded. Mirrored onto window.__f1.
  flagShadowCasters();
  let gateWarmup = 0;
  let gateFrames = 0;
  let gateElapsed = 0;
  // Skip the measurement window when there's nothing to protect (already on the
  // low preset → no shadows) or the preset is explicit (not auto).
  let gateDecided = !qualityAuto || currentQuality() === 'low';
  const f1State = { shadows: shadowRig.enabled, fps: 0 };
  (window as unknown as { __f1: typeof f1State }).__f1 = f1State;

  function frame(now: number): void {
    requestAnimationFrame(frame);

    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const frameDt = Math.min(rawDt, MAX_FRAME_DT);

    // Shadow perf gate (real GPUs only — software already decided): skip the
    // opening chunk-build hitches, then average a clean window and decide once.
    if (!gateDecided) {
      if (gateWarmup < 30) {
        gateWarmup++;
      } else {
        gateElapsed += Math.min(rawDt, MAX_FRAME_DT);
        gateFrames++;
        if (gateFrames >= ENV.shadowGateFrames) {
          const avgFps = gateFrames / Math.max(gateElapsed, 1e-6);
          f1State.fps = avgFps;
          if (avgFps < ENV.shadowFpsGate) {
            // Under budget: drop one tier (does not persist — auto only), then
            // re-derive shadows from the new preset.
            setQuality(tierBelow(currentQuality()), false);
            syncShadowQuality();
            syncPost();
          }
          f1State.shadows = shadowRig.enabled;
          gateDecided = true;
        }
      }
    }

    // `timeScale` (debug setTimeScale, clamped 0.1..16) multiplies the sim
    // dt fed into the accumulator — Task 15's Playwright verification fast-
    // forwards tracking/respawn timers this way. `MAX_STEPS_PER_FRAME` is a
    // defensive cap (never hit at the 16x ceiling with MAX_FRAME_DT=0.1: that's
    // 96 steps) so a future change to either constant can't turn a slow frame
    // into an unbounded catch-up spiral.
    accumulator += frameDt * timeScale;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      update(SIM_DT);
      accumulator -= SIM_DT;
      steps++;
    }

    render();
  }

  requestAnimationFrame(frame);
}
