import { constrainSkyWildlife } from './sky/wildlife.ts';
import { GrandpaNetwork } from './grandpa/network.ts';
import { GrandpaUI } from './grandpa/ui.ts';
import { GrandpaSystem } from './grandpa/system.ts';
import { SmallWonders } from './discoveries/wonders.ts';
import { CURIOSITIES, curiosityFloorBelow, curiosityRaycast, resolveCuriosityMovement } from './discoveries/world.ts';
import { landmarkFloorBelow, landmarkRaycast, resolveLandmarkMovement, castleArchitecture, breathingAirbell, LANDMARKS, landmarkWorld } from './landmarks/world.ts';
import { LandmarkJourney, restoreLandmarkProgress } from './landmarks/progress.ts';
import { SkyKingdom } from './sky/kingdom.ts';
import { skyFloorBelow, SKY_CRITTER_SLOTS, inSkyBounds } from './sky/layout.ts';
import { raycastSky, resolveSkyMovement } from './sky/collision.ts';
import { startAnalytics } from './analytics';
import { loadArtLibrary, artStats } from './art/library.ts';
import { resourceDeposits, DEPOT } from './logistics/layout.ts';
import { createEconomy, restoreEconomy, tickEconomy, gather, buildSite, buyTechnology, collectSite, assignHauler, recallHauler, type Technology } from './logistics/economy.ts';
import { createLogisticsScreen } from './logistics/screen.ts';
import { LogisticsVisuals } from './logistics/visuals.ts';
import * as THREE from 'three';
import {
  AI,
  BUILD,
  CAMERA,
  CASTLE,
  DEMOLISH,
  DISCOVERY_HINTS,
  ENV,
  GOBLIN,
  HEALTH,
  MAX_FRAME_DT,
  MOUNT,
  SIM_DT,
  STRUCTURES,
  UNDERWATER,
  MOVE,
} from './core/constants.ts';
import { setupEnvironment, setupDaylight, updateWater, updateClouds } from './world/environment.ts';
import { daylightAt } from './core/daylight.ts';
import { ChunkManager } from './world/chunks.ts';
import { PropManager } from './world/props.ts';
import { groundNormalAt, heightAt } from './world/terrain.ts';
import type { GroundQuery, Vec3 } from './core/types.ts';
import { Input, shouldTreatRmbAsPlacementConfirm } from './player/input.ts';
import { PlayerController } from './player/controller.ts';
import { CameraInterpolation } from './player/camera-interpolation.ts';
import { HandsView } from './player/hands.ts';
import { createHealth, applyHit, isDazed, stepHealth } from './player/health.ts';
import { createInventory, addResource } from './craft/inventory.ts';
import {
  createHotbar,
  itemCount,
  migrateLegacy as migrateLegacyHotbar,
  select as selectHotbar,
  selectStep as selectStepHotbar,
  type HotbarState,
  type ItemId,
} from './craft/hotbar.ts';
import { ScreenManager, createCraftScreen, createHelpScreen, createInventoryScreen } from './ui/screens.ts';
import { createGuideScreen } from './ui/guide.ts';
import { createRosterScreen, setRosterActions } from './ui/roster.ts';
import { HUD } from './ui/hud.ts';
import { createPerformanceHUD } from './ui/performance.ts';
import { runCritterPreview } from './critters/preview.ts';
import { CritterManager, type CritterView } from './critters/manager.ts';
import { speciesById } from './critters/species.ts';
import { bond, release, byId, type RosterEntry } from './critters/roster.ts';
import { MountSystem } from './player/mount-system.ts';
import { canAssignToFarm, canMount, canSummon, setActiveMount } from './player/mount.ts';
import { DartSystem } from './tracking/darts.ts';
import { updateTracking } from './tracking/tracker.ts';
import { toast } from './ui/toasts.ts';
import { blip, chime } from './ui/audio.ts';
import { AnchorRegistry } from './structures/anchors.ts';
import { ZiplineSystem } from './structures/ziplines.ts';
import { DroneSystem } from './structures/drones.ts';
import { TrampolineSystem } from './structures/trampolines.ts';
import { PlacementSystem, serializeStructures, deserializeStructures } from './structures/placement.ts';
import { BuildSystem } from './structures/build.ts';
import { pieceAtRayHit, resolveBuildAim } from './structures/buildmath.ts';
import { demolishTargetAt, type DemolishHit } from './structures/demolish.ts';
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
import { buildVillage, villageObstacles, updateWindmill } from './village/buildings.ts';
import { buildCastle } from './castle/builders.ts';
import {
  castleLayout,
  spireObstacles,
  spireGrappleColliders,
  inCastleRegion,
  type Point2,
} from './castle/layout.ts';
import { CastleSystem } from './castle/system.ts';
import {
  inHall,
  inHallBelowRoof,
  retreatPath,
  gateOutsidePoint,
} from './castle/ward.ts';
import { ElfSystem } from './castle/elves.ts';
import { PurifierSystem } from './castle/purifier.ts';
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
import { inDiveZone, diveEntryPoint } from './underwater/layout.ts';
import { UnderwaterSystem } from './underwater/system.ts';
import {
  breathMax,
  breathTradeCostText,
  createBreath,
  stepBreath,
  tradeForBreath,
} from './underwater/progression.ts';

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

// Grandpa starts as a guest BEFORE any world/save simulation is booted.
const grandpaGuest = document.body.dataset.grandpa === 'true';
const guestNetwork = grandpaGuest ? new GrandpaNetwork(true) : null;
const guestUI = guestNetwork ? new GrandpaUI(guestNetwork) : null;
if (grandpaGuest) document.body.classList.add('gp-guest');
const guestWorld = guestNetwork ? await new Promise<SaveV3>(resolve => {
  guestNetwork.onJoin = () => { if (guestNetwork.initialWorld) resolve(guestNetwork.initialWorld); };
}) : null;

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
// showcase (all 18 species in a scrollable turntable gallery) and skips the
// normal player spawn.
const discoveryPerfOff=new URLSearchParams(window.location.search).get('dev')==='1'&&new URLSearchParams(window.location.search).get('wonders')==='off';
await loadArtLibrary({skipDiscoveries:discoveryPerfOff});
if (new URLSearchParams(window.location.search).get('preview') === 'critters') {
  runCritterPreview(renderer);
} else {
  bootGame();
}

/** Normal gameplay boot: scene, camera, world streaming and the FP controller. */
function bootGame(): void {
  // SSAO renders the scene again for normals; refresh both shadow cascades
  // only on the first scene pass of each animation frame.
  renderer.shadowMap.autoUpdate = false;
  const devMode = new URLSearchParams(window.location.search).get('dev') === '1';
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  const debugGrapple = debugParam === 'grapple';
  const debugStructures = debugParam === 'structures';
  const debugVillage = debugParam === 'village';
  const debugCastle = debugParam === 'castle';
  // `?debug=grapple/structures/village/castle` freeze the player for a clean
  // static framing shot — hoisted here (rather than recomputed per call) so
  // both the update() gate below and render()'s hands-hidden gate (Inventory+
  // Building Task 6) share one definition.
  const debugFrozen = debugGrapple || debugStructures || debugVillage || debugCastle;
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
  // The camera must be part of the scene graph — `WebGLRenderer.render`
  // builds its draw list by traversing FROM `scene` (not from `camera`), so
  // anything parented only to the camera (the hands viewmodel, Inventory+
  // Building Task 6) would have its matrixWorld kept correct but would never
  // actually be drawn without this. `flagShadowCasters` below explicitly
  // excludes the hands from shadow-casting, same as it already does skyDome/water.
  scene.add(camera);

  setupEnvironment(scene);
  // Day/night visuals (Cursed Castle Task 5): sun/hemi/fog/sky-dome/stars react
  // to `worldClock` below; `daylight.sunScale` is fed into the shadow rig each
  // frame (created further down) so cascade shares stay proportionally correct.
  const daylight = setupDaylight(scene);

  const chunks = new ChunkManager(scene);
  const props = new PropManager(scene,
    !(devMode && new URLSearchParams(window.location.search).get('lod') === '0'),
    devMode && new URLSearchParams(window.location.search).get('sortProps') === '1');
  const critters = new CritterManager(scene);
  critters.constrainMovement = constrainSkyWildlife;

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
      if(mesh.userData.noShadow)return;
      if (
        mesh.name === 'skyDome' ||
        mesh.name === 'water' ||
        mesh.name === 'handsView' ||
        mesh.name === 'clouds' ||
        mesh.name === 'mountains'
      )
        return;
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

  // Cursed Castle (Task 9): collision + grapple colliders are pure layout
  // geometry (memoised, ~80/56 circles) — independent of which dressing is
  // actually built, so they're wired in regardless of the save's
  // `castlePurified` flag. The castle mesh itself is built further down, once
  // the save has been loaded (its dressing depends on `loaded.castlePurified`).
  // Gargoyle-hunting spires (daze-eject-spires design spec §2): same pure,
  // memoised-circle convention as the castle geometry above — wired in
  // alongside it regardless of dressing (the spires themselves are built
  // inside `buildCastle`, so they're always present once the castle mesh is).
  const spireObs = spireObstacles();
  const spireGrapple = spireGrappleColliders();

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

  // Inventory accumulating harvested resources + the crafting tree's currency
  // (RP), consumables (darts/charms) and held deployable kits. Constructed
  // early (moved up from below BuildSystem's original slot) because
  // BuildSystem needs it before the composed `ground` further down.
  const inventory = createInventory();

  // Raw terrain-only ground (heightAt/normalAt = natural terrain, no placed
  // pieces) — BuildSystem's own reference for its height-cap check (measured
  // above natural terrain, not above whatever's already stacked there) and
  // for its ghost/debug-place validity. The COMPOSED `ground` every other
  // consumer gets is defined just below, once `build` exists to close over.
  const rawGround: GroundQuery = { heightAt, normalAt: groundNormalAt };
  const spawn = { x: 0, y: heightAt(0, 0), z: 0 };

  // Buildable walls/ramps (Inventory+Building Task 5): ghost placement, pickup,
  // the live piece list + its physics near-queries, and persistence. Built
  // before the composed `ground` below since that query reads `build.topAt`.
  const build = new BuildSystem(scene, rawGround, inventory);

  // Composed ground truth (design spec §3 / Task 5 brief): effectiveGroundAt =
  // max(terrain, build tops). Every consumer that means "the floor" (player,
  // darts/purifier ground-hit, mounts, castle goblins/elves, snapToGround-on-
  // load, kit placement aiming) gets THIS query; consumers that mean "the
  // terrain" (chunk meshing/scatter/water/village/castle layout/daylight, and
  // CritterManager's own private ground for wild critters) keep raw
  // heightAt/groundNormalAt, untouched. Normal stays terrain-based even when a
  // build top wins — nothing in the movement core currently reads
  // GroundQuery.normalAt (grep-verified: only two construction sites exist,
  // no consumer), so this branch is inert today but future-proofs the seam
  // per the brief's literal directive: flat-normal-when-on-a-build-top would
  // otherwise be the right call once something (slope-slide) does read it, so
  // a player standing on a wall over steep terrain doesn't misread as a steep
  // slope underfoot.
  const ground: GroundQuery = {
    heightAt: (x, z) => {
      const t = heightAt(x, z);
      const b = build.topAt(x, z);
      return b > t ? b : t;
    },
    heightBelow: (x, z, maxY) => Math.max(heightAt(x,z), build.topAt(x,z), skyFloorBelow(x,z,maxY), landmarkFloorBelow(x,z,maxY),curiosityFloorBelow(x,z,maxY)),
    normalAt: (x, z) => (build.topAt(x, z) > heightAt(x, z) ? { x: 0, y: 1, z: 0 } : groundNormalAt(x, z)),
  };

  // Grapple anchor registry — drones (Task 13) register tracked spheres here;
  // the controller raycasts it alongside the terrain when a grapple is fired.
  const anchors = new AnchorRegistry();
  const skyKingdom = new SkyKingdom(scene, anchors, toast);

  const input = new Input(canvas as HTMLCanvasElement);
  const player = new PlayerController(camera, input, ground, spawn, scene, anchors);
  player.canDiveAt = inDiveZone;
  const worldRaycast:typeof raycastSky=(a,b)=>{
    let best:Vec3|null=null,distance=Infinity;
    for(const hit of [raycastSky(a,b),landmarkRaycast(a,b),curiosityRaycast(a,b)]){
      if(!hit)continue;const d=(hit.x-a.x)**2+(hit.y-a.y)**2+(hit.z-a.z)**2;
      if(d<distance){best=hit;distance=d;}
    }return best;
  };
  player.worldRaycast = worldRaycast;
  player.resolveWorldMovement = (a,b,r)=>resolveCuriosityMovement(a,resolveLandmarkMovement(a,resolveSkyMovement(a,b,r),r),r);
  // First-person hands (Inventory+Building Task 6): a camera-child viewmodel,
  // purely cosmetic — constructed right after the camera/player so it's ready
  // for the very first render() call below.
  const hands = new HandsView(camera);
  // Feed the grapple hook the nearby grappleable tree/rock cylinders so a fired
  // hook can latch to props, not just bare terrain.
  player.grappleColliders = (x, z) =>
    props
      .getGrappleColliders(x, z)
      .concat(spireGrapple)
      .concat(build.grappleNear(x, z));
  // Castle Ward Task 5: "No sky in here!" — no grapple/glider while the
  // player stands under a roofed hall. The predicate is a generic seam on
  // the controller (movementCeiling); this is the one place that ties it to
  // the castle module, keeping player/ code free of castle imports.
  //
  // Final-review Fix 2: `inHall` alone is a 2D (x, z) footprint test with no
  // notion of height, so a player GLIDING ABOVE the roof (hall wall tops sit
  // at `CASTLE.padHeight + WARD.wallH`) who crossed a hall's footprint used
  // to have their glide cut and fall through the (collider-less) roof
  // mid-air, same as if they were standing on the ground inside it.
  // `inHallBelowRoof` (pure, in ward.ts) adds the height gate; the controller
  // now threads the player's current y into the seam alongside x/z.
  player.movementCeiling = inHallBelowRoof;
  player.onCeilingBlocked = () => toast('No sky in here!');

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
  const deposits = resourceDeposits();
  let economy = createEconomy(deposits);
  const logisticsVisuals = new LogisticsVisuals(scene, deposits);
  let lastDeeds = getDeedCount();
  const farmVisuals = new FarmVisuals(scene);

  // Player HP (Cursed Castle Task 6): pure state stepped each frame. No
  // damage sources exist yet — goblins (Task 11) will call `applyHit`.
  let health = createHealth();

  // Build-piece pickup (Inventory+Building Task 5): tracks interact's rising
  // edge so `build.beginPickup` locks in the aim exactly once per press,
  // mirroring the zipline mount/recall hold pattern (`input.interactHeld`
  // read every frame, not through the edge-action queue).
  let buildInteractHeldPrev = false;

  // Destruction ("demolish") mode (playtest Task 9): KeyX toggle, SESSION-ONLY
  // (deliberately never written to/read from the save — a fresh reload always
  // starts with it off, same as e.g. `snapHintShown` below). See `setDemolish`
  // (below `setHotbar`) for the enter/exit side effects.
  let demolishActive = false;

  // --- Maze-aware daze ejection (daze-eject-spires design spec §1) ---------
  // A tiny 3-state machine: 'stumbling' (isDazed(health) true — the corridor
  // walk below) → 'blackout' (daze just ended, still inside the walls — the
  // screen blacks out and drags the player through the gate) → 'none' (normal
  // control). `wasDazed` detects the daze rising/falling edges each frame.
  let wasDazed = false;
  /** Current corridor route (world waypoints) toward the gate; recomputed on
   *  every fresh daze (rising edge). Empty outside the castle region / when
   *  no path exists — the radial-retreat fallback is used instead. */
  let stumbleWaypoints: Point2[] = [];
  let stumbleWaypointIdx = 0;
  type EjectPhase = 'none' | 'blackout';
  let ejectPhase: EjectPhase = 'none';
  /** Seconds into the current blackout phase (teleport at 0.4s, clears at 0.8s). */
  let ejectTimer = 0;
  let ejectTeleported = false;

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
  // Pause / Help overlay: keybind reference + Resume + Reset Save. No longer
  // Esc's direct target (Inventory+Building Task 3 — see the inventory
  // screen registration below) — reached via its "Controls" button, or the
  // `?screen=help` dev hook.
  screens.register(createHelpScreen(screens));
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
  // Assigned after save restore/castle wiring below. The dart callbacks close
  // over it safely: no update/fire can run until boot has completed.
  let underwater: UnderwaterSystem | null = null;
  let grandpa: GrandpaSystem | null = null;
  const darts = new DartSystem(scene, camera, critters, inventory, ground, {
    raycastWorld: (a, b) => grandpaRaycast(a, b),
    extraTargets: () => grandpa?.targets() ?? [],
    onExtraHit: () => grandpa?.tag(),
    hostileTargets: () => underwater?.dartTargets() ?? [],
    onHostileHit: (id, kind) => {
      underwater?.hitEnemy(id, kind);
    },
  });

  // -------------------------------------------------------------------------
  // Deployable structures (Task 13): ziplines + drones + their placement mode.
  // Entered by selecting a 'kit:zipline' (two-stage) or 'kit:drone' hotbar
  // item — since Inventory+Building Task 3, hotbar slots are a flexible
  // 6-slot loadout the player assigns freely from the inventory screen, not
  // fixed slot numbers (see `syncHotbarPlacement`'s doc further down). Drones
  // register grapple anchors on the shared registry, so a hovering drone is
  // instantly grappleable. Live counts/placing/riding are read straight off
  // these systems by the Task 14 debug handle's `state()` snapshot.
  // -------------------------------------------------------------------------
  const ziplines = new ZiplineSystem(scene, ground, inventory);
  const drones = new DroneSystem(scene, ground, anchors, inventory);
  const tramps = new TrampolineSystem(scene, ground, inventory);
  const placement = new PlacementSystem(scene, camera, ground, inventory, ziplines, drones, tramps);

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
  const performanceHUD = devMode ? createPerformanceHUD(renderer) : null;
  // Count the entire frame, including shadow and post passes, not just the last pass.
  renderer.info.autoReset = false;
  let loaded: SaveV3 | null = grandpaGuest ? guestWorld : freshStart || devMode ? null : loadSave();
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
      deserializeStructures(loaded.structures, ziplines, drones, tramps);
      // Build pieces (Inventory+Building Task 5): deserialize BEFORE the
      // snapToGround call below, which uses the COMPOSED `ground.heightAt` —
      // so a player who saved standing atop their own fort snaps back onto
      // the fort's top, not the bare terrain beneath it.
      build.deserialize(loaded.builds ?? []);
      // Cursed Castle: snap the restored position back onto the live terrain if
      // it's reshaped underneath an old save (e.g. the world grandeur rescale)
      // — otherwise the player could resurrect buried in or floating far above
      // the new ground.
      const savedPos = loaded.player.pos;
      const savedGround = ground.heightBelow!(savedPos.x, savedPos.z, savedPos.y + .45);
      skyKingdom.restore(loaded.skyKingdom);
      // A legitimate saved dive position is intentionally several metres
      // above its seabed, so the generic terrain-drift guard would mistake it
      // for an old floating save and snap it to the floor. Preserve only a
      // position inside the authored lagoon and between floor/surface; all
      // other saves keep the existing defensive snap.
      const restoredPos =
        (inSkyBounds(savedPos) || castleArchitecture.contains(savedPos,3) || inDiveZone(savedPos.x, savedPos.z) &&
        savedPos.y >= savedGround + UNDERWATER.floorClearance &&
        savedPos.y <= UNDERWATER.surfaceY)
          ? { ...savedPos }
          : snapToGround(savedPos, savedGround);
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
      build.deserialize([]);
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

  // Atlantis breath progression is separate from HP: air drains only once
  // the camera is submerged, refills at the surface, and its max is extended
  // by two post-castle elf trades. The current partial breath is session state;
  // only the upgrade level needs persistence.
  let breathLevel = loaded?.underwater?.breathLevel ?? 0;
  let breath = createBreath(breathLevel);
  let breathWarned = false;
  let underwaterRecovery = false;
  let diveHintShown = false;
  let wasInDiveZone = false;

  // -------------------------------------------------------------------------
  // Hotbar (Inventory+Building Task 3): main.ts owns the live 6-slot
  // `HotbarState`. A save with a `hotbar` block (Task 2's decode already
  // shape-guarded every slot string against `ItemId` and clamped `selected`)
  // loads it straight; a save predating the hotbar (`loaded` truthy, `hotbar`
  // absent) migrates the old fixed slots via `migrateLegacy()`; no save at
  // all (fresh start / corrupt-apply fallback, `loaded` now null either way)
  // gets the fresh-start default loadout.
  // -------------------------------------------------------------------------
  let hotbar: HotbarState = loaded?.hotbar
    ? { slots: loaded.hotbar.slots as (ItemId | null)[], selected: loaded.hotbar.selected }
    : loaded
      ? migrateLegacyHotbar()
      : createHotbar();

  /**
   * Placement-ghost sync: entering a placeable slot (kit OR wall/ramp) auto-
   * enters its ghost; selecting anything else — another item, an empty slot —
   * cancels whichever ghost (PlacementSystem's or BuildSystem's) is active.
   * Tracks the last-synced ITEM rather than the selected slot INDEX so
   * assigning a different item into the currently-selected slot (from the
   * inventory screen, with no selection-index change) still re-syncs.
   * Primed to the boot-time selection below so loading a save with a kit
   * slot already selected never auto-opens a ghost with no player input.
   */
  let hotbarSyncedItem: ItemId | null = hotbar.slots[hotbar.selected] ?? null;
  // Playtest Task 8 (explicit Ctrl-snap): a one-time-per-session nudge the
  // first time ANY build ghost enters, so the new "snapping is opt-in" rule
  // doesn't read as a silent regression. Fires alongside (not instead of)
  // BuildSystem.enter's own "Wall — aim and click to place"-style toast.
  let snapHintShown = false;
  function maybeShowSnapHint(): void {
    if (snapHintShown) return;
    snapHintShown = true;
    toast('Hold Ctrl to snap');
  }

  // Kid-UX discovery hint (final-review Fix 5): a one-shot nudge toward the
  // inventory screen (Esc) — session-only, never persisted to the save (same
  // convention as `snapHintShown` above). Simpler trigger picked over "first
  // craft" per the finding's own "pick the simpler trigger" — gated on
  // `worldTime` (accumulates unconditionally, even while a screen is open —
  // see `update()`'s very first line) rather than any craft-flow hook, so it
  // needs no wiring through the craft screen's `applyCraft` callback at all.
  let inventoryHintShown = false;
  function maybeShowInventoryHint(): void {
    if (inventoryHintShown) return;
    inventoryHintShown = true;
    toast('Press Esc to open your inventory');
  }
  /**
   * `force` (final-review Fix 4): bypasses the "item unchanged" short-circuit
   * below. Needed after a mount dismount — mounting-up already cancelled any
   * active ghost (see `handleMountKey`/`debugRide`) WITHOUT updating
   * `hotbarSyncedItem` (mount/dismount deliberately bypass `setHotbar` while
   * riding, per the doc above), so the plain change-detection would otherwise
   * read the selection as "unchanged" and skip re-entering the ghost even
   * though it's actually inactive.
   */
  function syncHotbarPlacement(force = false): void {
    const item = hotbar.slots[hotbar.selected] ?? null;
    if (!force && item === hotbarSyncedItem) return;
    hotbarSyncedItem = item;
    // Switching straight between two ghosts of the SAME system (zipline<->
    // drone, or wall<->ramp/cube) is handled internally by that system's own
    // enter/toggle (a single "entered" toast, no separate "cancelled" one) —
    // only the OTHER system needs an explicit cancel first.
    if (item === 'kit:zipline') {
      setDemolish(false); // playtest Task 9: a placeable slot always exits demolish first
      if (build.active) build.cancel();
      placement.toggle('zipline');
    } else if (item === 'kit:drone') {
      setDemolish(false);
      if (build.active) build.cancel();
      placement.toggle('drone');
    } else if (item === 'kit:trampoline' || item === 'kit:skytramp') {
      setDemolish(false);
      if (build.active) build.cancel();
      placement.toggle(item === 'kit:skytramp' ? 'skytramp' : 'trampoline');
    } else if (item === 'wall' || item === 'ramp' || item === 'cube') {
      setDemolish(false);
      if (placement.active) placement.cancel();
      build.enter(item);
      maybeShowSnapHint();
    } else {
      if (placement.active) placement.cancel();
      if (build.active) build.cancel();
    }
  }

  /**
   * Destruction mode (playtest Task 9): entering cancels any active build/
   * placement ghost — the two are mutually exclusive, same reasoning as
   * `syncHotbarPlacement`'s cross-system cancels above (a ghost and a
   * demolish target reticle can't coexist without conflicting over what LMB
   * means). Selecting a placeable hotbar slot while demolish is active exits
   * it FIRST (see `syncHotbarPlacement`'s `setDemolish(false)` calls) rather
   * than leaving it on and silently re-suppressing the ghost every frame —
   * picked as the more discoverable of the two possible semantics: LMB
   * unambiguously means "confirm placement" the moment a wall/kit is
   * selected, with no leftover demolish state for the player to remember
   * they're still in. A no-op when the mode is already in the requested
   * state (idempotent — safe to call from multiple sync points).
   */
  function setDemolish(next: boolean): void {
    if (next === demolishActive) return;
    demolishActive = next;
    if (next) {
      if (build.active) build.cancel();
      if (placement.active) placement.cancel();
      toast('Demolish mode — click to reclaim');
    } else {
      toast('Demolish off');
    }
  }

  /**
   * The current demolish aim target (a build piece or zipline post — see
   * `structures/demolish.ts`'s file header for why drones are excluded from
   * this ray test), or null on a miss. Recomputed fresh from the live camera
   * aim every time it's needed — same redundant-but-cheap pattern as
   * `build.aimedPiece`'s call sites (one in the interact-action check below,
   * a separate one in render()'s HUD prompt).
   */
  function demolishAim(): DemolishHit | null {
    return demolishTargetAt(
      camera.position,
      cameraLook(),
      build.pieces(),
      ziplines.list(),
      DEMOLISH.range,
      DEMOLISH.zipPostRadius,
    );
  }

  /**
   * LMB while demolish mode is active (Inventory+Building playtest Task 9):
   * instant, no-penalty reclaim. Drones check first — see `demolishAim`'s doc
   * for why they're a separate PROXIMITY branch rather than part of the ray
   * test. Toasts on both success and a total miss (mirrors `build.confirm`'s
   * "Nothing to place there" precedent) so a click always gives feedback.
   */
  function tryDemolishReclaim(): void {
    const droneId = drones.recallableIdNear(player.pos);
    if (droneId) {
      drones.recall(droneId);
      toast('Drone reclaimed');
      return;
    }
    const trampId = tramps.reclaimableIdNear(player.pos);
    if (trampId) {
      tramps.recall(trampId);
      toast('Trampoline reclaimed');
      return;
    }
    const hit = demolishAim();
    if (!hit) {
      toast('Nothing to reclaim');
      return;
    }
    if (hit.system === 'build') {
      build.demolishReclaim(hit.id);
    } else {
      ziplines.recall(hit.id);
      toast('Zipline reclaimed');
    }
  }

  /** Replace the live hotbar (main.ts's own mutations AND the inventory
   *  screen's assign/clear clicks funnel through here) and re-sync placement. */
  function setHotbar(next: HotbarState): void {
    hotbar = next;
    syncHotbarPlacement();
  }

  // Inventory screen (Escape, when nothing else is open): item grid + hotbar
  // assignment + the quality selector (relocated from the old pause/help
  // overlay — see createHelpScreen's docs above).
  screens.register(
    createInventoryScreen({
      inventory,
      getHotbar: () => hotbar,
      setHotbar,
      manager: screens,
      quality: { current: currentQuality, apply: applyQuality },
      onGrandpa: () => { screens.close(); grandpaUi.open(); },
    }),
  );

  // Cursed Castle (Task 9): the dressing follows the save (absent → cursed,
  // the lived-in default). Task 14 makes this live-mutable: one purifying
  // dart on the keep's crystal flips it permanently (`CastleSystem.purifyCastle`
  // → `onPurified` below), so this is a `let`, not a boot-time constant.
  let castlePurified = loaded?.castlePurified ?? false;
  buildCastle(scene, castlePurified);
  const landmarkJourney=new LandmarkJourney(toast,()=>castlePurified);
  landmarkJourney.progress=restoreLandmarkProgress(loaded?.landmarkExploration);
  const smallWonders=new SmallWonders(scene,toast,worldRaycast,!discoveryPerfOff);
  smallWonders.restore(loaded?.curiosities);

  /** Direction from `from` toward `to`, scaled to `mag` (horizontal), plus a
   *  modest vertical lift — the lift matters: while airborne with no player
   *  input, the movement core skips ground friction entirely (see
   *  movement.ts's airborne branch), so a purely-horizontal impulse would
   *  otherwise be eaten by MOVE.accelGround within a couple of frames. */
  function awayFrom(from: Vec3, to: Vec3, mag: number): Vec3 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: (dx / len) * mag, y: mag * 0.3, z: (dz / len) * mag };
  }

  // Nectar Wisps use the critter manager's contact hook so the species/AI
  // layer stays independent of player HP. They sting only while tagged and
  // unlinked; manager.ts stops invoking this the instant the circle completes
  // or its empty two-minute window expires.
  critters.onPlayerSting = (dmg, from) => {
    if (isDazed(health)) return;
    health = applyHit(health, dmg);
    player.applyImpulse(awayFrom(from, player.pos, AI.stingKnockback));
    blip(230, 0.09);
  };

  // Cursed Castle (Task 12): happy elves — persistent castle residents that
  // wander/dance around the grounds. Purified goblins become elves; count is
  // restored from the save (defaults to 0 elves) and grows via `elves.addAt`
  // (single goblin purify) or the Task 14 castle-wide purify burst. Built
  // BEFORE `castleSys` below, which closes over it (`opts.addElf`).
  // Build pieces block/collide goblins+elves the same way ward/spire geometry
  // does (Inventory+Building Task 5) — injected as a plain callback (like
  // `ground` itself) so neither module gains a `structures/build.ts` import.
  const elves = new ElfSystem(scene, ground, (x, z) => build.obstaclesNear(x, z));
  elves.setCount(loaded?.elves ?? 0);

  // Cursed Castle (Task 11): night goblins — spawn at dusk, chase/lunge, deal
  // damage on a landed hit (knockback + a hit blip), skipped once purified.
  // Task 14: also owns the keep's dark crystal + `purifyCastle()`, the
  // finale sequence a landed purifying-dart crystal hit runs.
  const castleSys = new CastleSystem(scene, ground, {
    purified: () => castlePurified,
    onPlayerHit: (dmg, from) => {
      if (!isDazed(health)) {
        health = applyHit(health, dmg);
        player.applyImpulse(awayFrom(from, player.pos, GOBLIN.knockback));
        blip(180, 0.12);
      }
    },
    onPurified: () => {
      castlePurified = true;
      if (elves.count === 0) {
        elves.addAt({ x: CASTLE.center.x, y: CASTLE.padHeight, z: CASTLE.center.z });
      }
      toast('Freed elves can now trade you longer-breathing charms');
    },
    addElf: (pos) => elves.addAt(pos),
    flashPurify: () => hudUi.flash(),
    buildObstacles: (x, z) => build.obstaclesNear(x, z),
  });

  // Cursed Castle (Task 13): purifying darts — hotbar slot 5's fire path.
  // Reuses the tracker dart's ballistics (PurifierSystem); on a goblin hit it
  // purifies the goblin (removed from CastleSystem) into a happy elf at its
  // last position. On a crystal hit (Task 14), `castleSys.purifyCastle()`
  // runs the whole finale sequence.
  const purifier = new PurifierSystem(scene, camera, inventory, ground, {
    raycastWorld: worldRaycast,
    goblinTargets: () => castleSys.goblinTargets(),
    onPurifyGoblin: (id) => {
      const pos = castleSys.purifyGoblin(id);
      if (pos) {
        elves.addAt(pos);
        toast('A goblin becomes a happy elf!');
      }
    },
    clamTargets: () => underwater?.purifierTargets() ?? [],
    onPurifyClam: (id) => {
      if (underwater?.purifyClam(id)) toast('The clam becomes a happy little turtle! 🐢');
    },
    // Spec §5 (final-review fix): a purifying dart on an ordinary critter
    // (e.g. a perched gargoyle) is a harmless sparkle — same target shape
    // DartSystem.update maps for its own critter hit test.
    critterTargets: () =>
      critters.list().map((c) => ({
        id: c.id,
        pos: c.pos,
        r: speciesById(c.species)?.size ?? 0.5,
      })),
    crystalTarget: () => castleSys.crystalTarget(),
    onPurifyCrystal: () => castleSys.purifyCastle(),
  });

  // Atlantis: one permanently-present authored reef shelf, palace, enemies,
  // and saved clam→turtle transformations. Standard darts can bootstrap the
  // first materials; crafted Tide Darts deal double enemy damage underwater.
  underwater = new UnderwaterSystem(scene, ground, {
    purifiedClams: loaded?.underwater?.purifiedClams ?? [],
    linkedCrocs: loaded?.underwater?.linkedCrocs ?? [],
    onCrocTagged: () => toast('Crocodile tagged — stay close to win its trust!'),
    onCrocLinked: () => {
      toast('The crocodile trusts you now! 🐊');
      blip(660, 0.12);
    },
    onDrop: (kind, amount) => {
      addResource(inventory, kind, amount);
      toast(`+${amount} ${kind === 'shell' ? 'shell fragments' : 'croc hide'}`);
    },
    onPlayerHit: (dmg, from) => {
      if (isDazed(health)) return;
      health = applyHit(health, dmg);
      player.applyImpulse(awayFrom(from, player.pos, 4.5));
      blip(145, 0.11);
    },
  });

  /**
   * LMB dispatch on the selected hotbar item (Inventory+Building Task 3),
   * replacing the old fixed slot-5-is-Purify / slot-3-4-toggle behavior:
   *  - 'darts' / 'slowDarts' / 'purifiers': throw (their own `tryThrow`
   *    already no-ops — and returns false — at zero count, which shakes the
   *    slot).
   *  - 'kit:zipline' / 'kit:drone': confirms the already-active placement
   *    ghost (selecting the slot auto-entered it — `syncHotbarPlacement`
   *    above); if it somehow isn't active (e.g. the kit ran out right as the
   *    slot was selected), shakes instead.
   *  - 'charms': NOT an LMB-usable item — charms are spent by the F-interact
   *    bond flow (`tryBondInteract` below), never thrown. The slot shows the
   *    live count for information, but LMB always shakes here.
   *  - 'wall' / 'ramp' / 'cube': confirms the already-active BuildSystem
   *    ghost (`syncHotbarPlacement` auto-entered it) — same "shake if
   *    somehow not active" fallback as the kit slots.
   *  - empty slot: shakes.
   */
  function fireSelectedItem(): void {
    const item = hotbar.slots[hotbar.selected] ?? null;
    switch (item) {
      case 'darts':
        if (!darts.tryThrow()) hudUi.shake();
        return;
      case 'slowDarts':
        if (!darts.tryThrow('slowing')) hudUi.shake();
        return;
      case 'tideDarts':
        if (!darts.tryThrow('tide')) hudUi.shake();
        return;
      case 'purifiers':
        if (!purifier.tryThrow()) hudUi.shake();
        return;
      case 'kit:zipline':
      case 'kit:drone':
      case 'kit:trampoline':
      case 'kit:skytramp':
        if (placement.active) placement.confirm();
        else hudUi.shake();
        return;
      case 'wall':
      case 'ramp':
      case 'cube':
        if (build.active) build.confirm();
        else hudUi.shake();
        return;
      case 'charms':
      case null:
        hudUi.shake();
        return;
    }
  }

  // Cursed Castle (Task 10): a gargoyle perched on each tower top + keep
  // corner. Fixed slots (negative ids), not part of the procedural per-cell
  // spawn table — see CritterManager.addFixedSlots.
  critters.addFixedSlots(
    castleLayout().perches.map((p) => ({
      species: 'gargoyle',
      home: p,
      // SpawnSlot requires flightHeight, so it's still computed here for
      // shape-completeness, but it's INERT for fleeStyle:'perch' — ai.ts's
      // locomote targets `home.y` directly for perch critters and never
      // reads flightHeight (that field only drives the terrain-relative
      // cruise band for ordinary 'fly' fleers).
      flightHeight: p.y - heightAt(p.x, p.z),
    })),
  );

  critters.addFixedSlots(SKY_CRITTER_SLOTS.map((s,i)=>({...s,id:-88001-i})));

  if (devMode) {
    // Playtest loadout: every unlock, deep stacks of everything. The counts
    // are finite so all existing spend/decrement paths still exercise.
    inventory.fiber = 9999;
    inventory.resin = 9999;
    inventory.shard = 9999;
    inventory.spark = 9999;
    // Final-review Fix 7: wood/stone are farm-only (never scattered/harvested
    // in the world — see core/types.ts's ResourceKind doc), so without this a
    // dev session couldn't craft/place ANY wall/ramp/cube at all despite the
    // build pieces themselves being granted below — the wood/stone COST of
    // crafting more once the starting stock ran out was simply unreachable.
    inventory.wood = 9999;
    inventory.stone = 9999;
    inventory.shell = 999;
    inventory.scale = 999;
    // Spencer (Bounce Wave): the dev loadout skipped several materials —
    // grant EVERYTHING craftable-with for easier testing.
    inventory.mushroom = 999;
    inventory.fiber = 9999;
    inventory.resin = 9999;
    inventory.shard = 9999;
    inventory.horn = 999;
    inventory.purifiers = 99;
    inventory.rp = 999;
    inventory.darts = 999;
    inventory.slowDarts = 999;
    inventory.tideDarts = 999;
    inventory.honey = 999;
    inventory.charms = 999;
    inventory.walls = 50;
    inventory.ramps = 50;
    // Final-review Fix 7: cubes were the one placeable piece missing from the
    // dev loadout entirely (wall/ramp both got a stack, cube got none).
    inventory.cubes = 50;
    inventory.kits.zipline = 9;
    inventory.kits.drone = 9;
    inventory.kits.trampoline = 4;
    inventory.kits.skytramp = 2;
    for (const u of ['grapple', 'boots', 'glider', 'rocket', 'currentboard']) player.unlocks.add(u);
    breathLevel = UNDERWATER.breathUpgradeCount;
    breath = createBreath(breathLevel);
    toast('DEV MODE — all unlocks, 999 darts, deep material stacks (no saving)');
  }

  economy = restoreEconomy(loaded?.logistics, deposits, roster);
  if (devMode) economy.tech = ['fieldworks','harness','tools','extraction','cargo','trailcraft'];
  function logisticsAction(action:'gather'|'build'|'upgrade'|'collect'|'recall'|'survey', id:string): void {
    const deposit=deposits.find(d=>d.id===id), site=economy.sites.find(s=>s.id===id);
    if (!deposit || !site) return;
    const near=Math.hypot(player.pos.x-deposit.pos.x,player.pos.z-deposit.pos.z)<=6;
    if (['gather','collect','survey','build','upgrade'].includes(action) && !near) { toast('Move within 6 m of the deposit'); return; }
    if (action==='survey') { site.surveyed=true; toast('Deposit surveyed — build from Supply Routes (N)'); }
    if (action==='gather') toast(gather(economy,site,deposit,inventory));
    if (action==='build'||action==='upgrade') toast(buildSite(economy,site,inventory,action==='upgrade'));
    if (action==='collect') toast(`+${collectSite(site,deposit,inventory)} ${deposit.kind}`);
    if (action==='recall') { recallHauler(site,roster); toast('Companion recalled; carried cargo returned to the site hopper'); }
  }
  screens.register(createLogisticsScreen({manager:screens,state:()=>economy,roster:()=>roster,inventory,deposits,pos:()=>player.pos,
    action:logisticsAction,research:(id)=>toast(buyTechnology(economy,id,inventory)),
    assign:(id,worker)=>{const site=economy.sites.find(s=>s.id===id);if(site)toast(assignHauler(economy,site,roster,worker));},
  }));
  if (screenParam==='logistics') screens.open('logistics');
  const supplyButton=document.createElement('button');supplyButton.textContent='N · Supply routes';supplyButton.setAttribute('aria-label','Open supply routes');
  supplyButton.style.cssText='position:fixed;right:18px;top:18px;z-index:12;pointer-events:auto;background:#193a31dd;color:#e4e7bf;border:1px solid #afc89a66;border-radius:6px;padding:10px 14px;cursor:pointer;font:13px system-ui';
  supplyButton.onclick=()=>screens.toggle('logistics');hud.append(supplyButton);
  if (grandpaGuest) supplyButton.hidden = true;

  const grandpaNet = guestNetwork ?? new GrandpaNetwork(false, buildSaveState);
  const grandpaUi = guestUI ?? new GrandpaUI(grandpaNet);
  const grandpaRaycast = (a: Vec3, b: Vec3): Vec3 | null => {
    const delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    if (length < .001) return null;
    const dir = { x: delta.x / length, y: delta.y / length, z: delta.z / length };
    const terrain = raycastTerrain(a, dir, heightAt, length);
    const piece = pieceAtRayHit(build.pieces(), a, dir, length);
    const hits = [worldRaycast(a, b), terrain, piece?.point ?? null].filter((p): p is Vec3 => p !== null);
    hits.sort((p, q) => Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z)-Math.hypot(q.x-a.x,q.y-a.y,q.z-a.z));
    return hits[0] ?? null;
  };
  grandpa = new GrandpaSystem({ scene, camera, input, player, net: grandpaNet, ui: grandpaUi, reward: loaded?.grandpa,
    world: { ground,
      obstacles: p => props.getObstacles(p.x,p.z).concat(villageObs, logisticsVisuals.obstacles(economy), spireObs, build.obstaclesNear(p.x,p.z)),
      resolve: player.resolveWorldMovement,
    },
    raycast: grandpaRaycast,
    save: () => { if (!grandpaGuest && !devSession) doSave(); },
    hostSnapshot: () => ({
      child: { pos: player.pos, yaw: input.yaw, vel: player.vel, grapple: player.grappleSnapshot?.anchor ?? null, mounted: player.mounted },
      critters: critters.list(), clock: worldClock, darts: darts.snapshot(),
    }),
  });
  grandpaUi.onRejoin = () => { location.hash = `join=${grandpaNet.code}`; location.reload(); };
  grandpaUi.onPlace = () => { build.cancel(); placement.cancel(); setDemolish(false); grandpa!.startPlacement(); };
  document.addEventListener('visibilitychange', () => {
    if (!grandpaGuest && grandpa?.state && grandpaNet.connected) {
      grandpaNet.sendSnapshot({
        grandpa: grandpa.state, chase: grandpa.chase,
        child: { pos: player.pos, yaw: input.yaw, vel: player.vel, grapple: player.grappleSnapshot?.anchor ?? null, mounted: player.mounted },
        critters: critters.list(), clock: worldClock, darts: darts.snapshot(),
        paused: document.hidden || screens.isOpen() || grandpaUi.isOpen,
      });
    }
  });
  if (grandpaGuest) {
    let previousStructures = JSON.stringify({ builds: loaded?.builds, structures: loaded?.structures });
    let previousPens = JSON.stringify(loaded?.pens);
    grandpaNet.onWorld = world => {
      const structuresKey = JSON.stringify({ builds: world.builds, structures: world.structures });
      if (structuresKey !== previousStructures) {
        previousStructures = structuresKey; build.deserialize(world.builds ?? []); deserializeStructures(world.structures, ziplines, drones, tramps);
      }
      const pensKey = JSON.stringify(world.pens);
      if (pensKey !== previousPens) {
        previousPens = pensKey;
        for (const p of (world.pens ?? []).slice(pens.serialize().length)) pens.add(p.npcId, p.speciesId, p.nickname);
      }
      if (world.farm) farm = world.farm;
      roster = world.roster ?? [];
      if (world.logistics) Object.assign(economy, world.logistics);
      if (world.castlePurified && !castlePurified) { castlePurified = true; castleSys.purifyCastle(); }
      for (const id of world.underwater?.purifiedClams ?? []) underwater?.purifyClam(id);
      grandpa?.restoreReward(world.grandpa);
    };
    grandpaUi.ready();
  }

  /** Build the current in-memory state as a plain-data SaveV3 snapshot. */
  function buildSaveState(): SaveV3 {
    return {
      v: 3,
      ...(grandpa?.reward.caught ? { grandpa: grandpa.reward } : {}),
      logistics: structuredClone(economy),
      skyKingdom: structuredClone(skyKingdom.progress),
      landmarkExploration: structuredClone(landmarkJourney.progress),
      curiosities: [...smallWonders.visited],
      inventory: { ...inventory, kits: { ...inventory.kits } },
      unlocks: [...player.unlocks],
      critterPersist: critters.exportRegistry(),
      structures: serializeStructures(ziplines, drones, tramps),
      builds: build.serialize(),
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
      // Elves (Cursed Castle Task 12): persistent resident count.
      elves: elves.count,
      // Castle purified (Cursed Castle Task 14): permanent, round-trips a reload.
      castlePurified,
      underwater: {
        purifiedClams: underwater?.purifiedClamIds() ?? [],
        linkedCrocs: underwater?.linkedCrocIds() ?? [],
        breathLevel,
      },
      // Mount (Haven V6): only surfaced when a mount is active, so pre-mount
      // saves round-trip to exactly their old shape.
      ...(mounts.saveState() ? { mount: mounts.saveState()! } : {}),
      // Hotbar (Inventory+Building Task 3): the live 6-slot loadout + selection.
      hotbar: { slots: hotbar.slots, selected: hotbar.selected },
    };
  }

  function doSave(): void {
    if (grandpaGuest) return;
    writeSave(buildSaveState());
  }

  // A dev-hook boot (?fresh=1, ?dev=1 or any ?debug=) runs throwaway state
  // that must never overwrite the player's real save — skip automatic writes.
  // `?screen=roster` injects phantom roster entries for screenshots — treat it
  // as a dev session too so they can never autosave into a real save.
  const devSession =
    grandpaGuest || freshStart || devMode || debugParam !== null || screenParam === 'roster' || forceFx;

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
  // Reusable scratch for the build-ghost aim raycast (Inventory+Building Task 5).
  const _buildDir = new THREE.Vector3();

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
    const target = critters.nearestInCone(camera.position, cameraLook(), BOND_MAX_DIST, BOND_COS, true);
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
    for (const site of economy.sites) if (site.worker===id) recallHauler(site,roster);
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
    if ((id < 0 && !critters.hasFixedSlot(id)) || !critters.releaseSlot(id)) {
      const p = player.pos;
      const rx = p.x + 3;
      const rz = p.z;
      critters.debugSpawn(entry.speciesId, { x: rx, y: ground.heightBelow!(rx,rz,p.y+.45), z: rz });
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
      toast('Finish mount or hauling duty first (B / N)');
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
      // Final-review Fix 4: force a ghost re-sync — see `syncHotbarPlacement`'s
      // `force` param doc for why the plain change-detection would miss this.
      syncHotbarPlacement(true);
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
      if (build.active) build.cancel();
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
    if (build.active) build.cancel();
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
    if (grandpaGuest) {
      grandpa!.step(dt, false);
      const p = player.pos;
      chunks.update(p.x, p.z); props.update(p.x, p.z, worldTime, p.y + 4);
      if (grandpaNet.latest) {
        worldClock = grandpaNet.latest.clock;
        critters.applyRemote(grandpaNet.latest.critters, dt);
      }
      drones.update(dt); npcs.update(dt, p); pens.update(dt, worldTime);
      return;
    }
    if (worldTime >= DISCOVERY_HINTS.inventoryHintDelayS) maybeShowInventoryHint();

    // While a screen (crafting) is open: don't step movement/collision, and
    // ignore gameplay action edges (interact) — only the screen-toggle edges
    // below still fire so KeyC/Esc can close it. Chunk/prop streaming keeps
    // running so nothing pops in when the menu closes.
    const paused = screens.isOpen() || grandpaUi.isOpen || document.hidden;
    grandpa!.step(dt, paused);
    if (!paused) health = stepHealth(health, dt);

    // `?debug=grapple`/`?debug=structures` freeze the player for a clean static
    // screenshot while the world keeps streaming (`debugFrozen` hoisted above).
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
      player.obstacles = props
        .getObstacles(prev.x, prev.z)
        .concat(villageObs)
        .concat(logisticsVisuals.obstacles(economy))
        .concat(spireObs)
        .concat(build.obstaclesNear(prev.x, prev.z));
      // Maze-aware daze ejection (daze-eject-spires design spec §1) — replaces
      // the old radial-only stumble: inside the ward maze, walking straight
      // away from CASTLE.center just ran the player into a wall, which
      // resolveCollision then pushed straight back out — net motion ~0, so
      // the player jittered in place for the whole daze window. See the
      // `wasDazed`/`stumbleWaypoints`/`ejectPhase` field docs above for the
      // 3-state (stumbling → blackout → none) shape of what follows.
      const dazedNow = isDazed(health);

      // Falling edge: the daze window just ended THIS frame (stepHealth
      // already refilled HP). If the player is still inside the castle's
      // walled footprint, don't hand control back yet — run the
      // blackout-drag eject instead of leaving them stranded mid-maze.
      if (wasDazed && !dazedNow && ejectPhase === 'none') {
        const insideWalls =
          Math.max(Math.abs(prev.x - CASTLE.center.x), Math.abs(prev.z - CASTLE.center.z)) < CASTLE.half;
        if (insideWalls) {
          ejectPhase = 'blackout';
          ejectTimer = 0;
          ejectTeleported = false;
        }
      }

      if (ejectPhase === 'blackout') {
        ejectTimer += dt;
        // Teleport once the veil has had time to reach full black (~0.4s),
        // so the actual pop happens while the screen can't show it.
        if (!ejectTeleported && ejectTimer >= 0.4) {
          ejectTeleported = true;
          const out = gateOutsidePoint();
          player.teleport(out.x, heightAt(out.x, out.z) + 0.5, out.z);
        }
        // Clears ~0.8s in total — the veil starts fading back out from here.
        if (ejectTimer >= 0.8) ejectPhase = 'none';
      }

      if (dazedNow && !wasDazed) {
        // A knockout below the surface returns the player to the lagoon's
        // island-facing buoy line, preventing an inescapable drown/revive loop.
        underwaterRecovery = player.underwater;
        if (underwaterRecovery) {
          const entry = diveEntryPoint();
          player.teleport(entry.x, entry.y, entry.z);
          breath = createBreath(breathLevel);
          stumbleWaypoints = [];
        } else {
          // Rising edge: a fresh land daze plans the castle corridor walk.
          stumbleWaypoints = inCastleRegion(prev.x, prev.z) ? retreatPath(prev.x, prev.z) : [];
        }
        stumbleWaypointIdx = 0;
      }

      if (dazedNow) {
        if (underwaterRecovery) {
          player.setStumble({ x: 0, y: 0, z: 0 });
        } else if (stumbleWaypoints.length > 0) {
          // Steer toward the current waypoint at HEALTH.stumbleSpeed,
          // advancing to the next one once within 1 m of it.
          let target = stumbleWaypoints[stumbleWaypointIdx]!;
          let dx = target.x - prev.x;
          let dz = target.z - prev.z;
          while (Math.hypot(dx, dz) < 1 && stumbleWaypointIdx < stumbleWaypoints.length - 1) {
            stumbleWaypointIdx++;
            target = stumbleWaypoints[stumbleWaypointIdx]!;
            dx = target.x - prev.x;
            dz = target.z - prev.z;
          }
          const len = Math.hypot(dx, dz) || 1;
          player.setStumble({
            x: (dx / len) * HEALTH.stumbleSpeed,
            y: 0,
            z: (dz / len) * HEALTH.stumbleSpeed,
          });
        } else {
          // Outside the castle region (or no path found): the old radial
          // retreat away from the castle centre — no maze to navigate there.
          const dx = prev.x - CASTLE.center.x;
          const dz = prev.z - CASTLE.center.z;
          const len = Math.hypot(dx, dz) || 1;
          player.setStumble({
            x: (dx / len) * HEALTH.stumbleSpeed,
            y: 0,
            z: (dz / len) * HEALTH.stumbleSpeed,
          });
        }
      } else if (ejectPhase === 'blackout') {
        // Daze already over but the blackout-drag is still running: hold
        // still (the player can't see anything anyway) until it clears.
        player.setStumble({ x: 0, y: 0, z: 0 });
      } else {
        underwaterRecovery = false;
        player.setStumble(null);
      }
      wasDazed = dazedNow;
      // Playtest Task 8: while a build ghost is active, KeyR rotates the
      // ghost (handled in the action-consumption loop below) instead of
      // firing the rocket — drop the rocket edge BEFORE player.update()
      // reads it via input.state(), so the same R press never ALSO boosts
      // the player this frame. A no-op when R wasn't pressed.
      if (build.active || grandpa!.placing) input.clearRocketEdge();
      // Final-review Fix 2 (defensive, macOS click translation): while
      // snap-confirming a build ghost, mask RMB out of the grapple entirely —
      // see `shouldTreatRmbAsPlacementConfirm`'s doc in input.ts and the
      // `action.type === 'rmb'` branch below, which does the actual confirm.
      player.grappleSuppressed = shouldTreatRmbAsPlacementConfirm(build.active, input.snapHeld);
      const wasMounted = player.mounted;
      player.update(dt);
      skyKingdom.step(dt, prev, player, inventory);
      // Prismhorse mount: pin/animate the actor under the camera while riding,
      // or loosely trail the player while idle (also handles hold-Space dismount).
      mounts.update(dt, player, input);
      // Final-review Fix 4: a hold-Space dismount runs INSIDE mounts.update
      // (KeyV's own dismount branch is in handleMountKey below) — either way,
      // the mounted branch above bypasses `setHotbar`/`syncHotbarPlacement`
      // entirely, so a placeable slot selected mid-ride never auto-entered a
      // ghost. Force a full re-sync the instant riding ends so a selected
      // wall/ramp/cube/kit slot gets its ghost back immediately on dismount.
      if (wasMounted && !player.mounted) syncHotbarPlacement(true);

      const shelteredAir=breathingAirbell({x:player.pos.x,y:player.pos.y+1.65,z:player.pos.z})!==null;
      const breathStep = stepBreath(breath, player.underwater&&!shelteredAir, dt, breathLevel);
      breath = breathStep.state;
      if (player.underwater && breath.remaining <= 5 && breath.remaining > 0 && !breathWarned) {
        breathWarned = true;
        toast('Air is running low — E to rise!');
        blip(310, 0.08);
      }
      if ((!player.underwater||shelteredAir) && breath.remaining > 5) breathWarned = false;
      for (let i = 0; i < breathStep.drownHits; i++) {
        if (!isDazed(health)) health = applyHit(health, UNDERWATER.drownDamage);
      }
    }

    // Structure cosmetics + placement ghost always tick (drones bob/spin even
    // while frozen for the debug screenshot); interaction is gated above.
    drones.update(dt);
    if (!paused && !debugFrozen) {
      drones.updateRecall(dt, player.pos, input);
      if (placement.active) placement.update(dt);

      // Build ghost (Inventory+Building Task 5): main.ts owns the one
      // raycast — against the COMPOSED ground, so a freeform aim can land
      // directly on an existing piece's top — and hands the resolved point +
      // camera yaw (degrees) to BuildSystem, which stays camera-free.
      //
      // Playtest Task 8 ("ghost lands behind the target"): the terrain march
      // only ever finds where the ray crosses the walkable TOP surface — a
      // wall's vertical FACE isn't part of that height field at all, so
      // aiming levelly at a wall's side used to sail straight past it into
      // whatever terrain is behind. Fixed by testing build pieces FIRST
      // (`pieceAtRayHit`, an AABB ray test that covers side faces too) and
      // preferring that hit whenever it's nearer than the terrain hit.
      if (build.active) {
        camera.getWorldDirection(_buildDir);
        const origin: Vec3 = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        const dir: Vec3 = { x: _buildDir.x, y: _buildDir.y, z: _buildDir.z };
        const pieceHit = pieceAtRayHit(build.pieces(), origin, dir, BUILD.placeRange);
        const terrainAim = raycastTerrain(origin, dir, ground.heightAt, BUILD.placeRange);
        const aim = resolveBuildAim(pieceHit, terrainAim, origin);
        build.update(dt, aim, (input.yaw * 180) / Math.PI, input.snapHeld);
      }

      // Build pickup (hold F on an aimed piece): reads the held state every
      // frame (not the edge-action queue) so the hold can be timed.
      const heldF = input.interactHeld;
      if (heldF && !buildInteractHeldPrev) build.beginPickup(camera.position, cameraLook());
      if (heldF) build.tickPickup(dt);
      else build.cancelPickup();
      buildInteractHeldPrev = heldF;
    }

    const p = player.pos;
    const inLagoon = inDiveZone(p.x, p.z);
    if (inLagoon && !wasInDiveZone && !diveHintShown) {
      diveHintShown = true;
      toast('Turquoise water is diveable — Q to dive, E to rise');
    }
    wasInDiveZone = inLagoon;
    chunks.update(p.x, p.z);
    props.update(p.x, p.z, worldTime, p.y + 1.65);
    critters.update(dt, p);
    npcs.update(dt, p);
    // Night goblins (Task 11): frozen while a screen is open, parity with the
    // rest of combat/progress (health regen, tracking) above.
    if (!paused) castleSys.update(dt, p, daylightAt(worldClock));
    // Elves (Task 12): ambient wander/dance, frozen while a screen is open
    // (parity with the rest of the world sim above).
    if (!paused) elves.update(dt, p);
    if (!paused) underwater?.update(dt, p, player.underwater);
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
      tickEconomy(economy, deposits, roster, inventory, dt, point => build.obstaclesNear(point.x, point.z).some(o => point.y < (o.yTop ?? Infinity) && Math.hypot(point.x-o.x,point.z-o.z)<o.r+0.7));
    }

    // Advance darts in flight and tracking progress for tagged critters. On a
    // Link the tracker grants rewards; onLink plays the chime + toast here.
    // Both freeze while a screen is open (parity: no linking over a menu, no
    // unfair progress decay while the player is frozen).
    if (!paused) {
      darts.update(dt);
      purifier.update(dt);
      updateTracking(dt, {
        manager: critters,
        inventory,
        playerPos: p,
        // Golden Dart Tip reward accelerates ring fill 1.5× once owned.
        fillRate: trackingFillRate(getRewards()),
        onLink: (view, sp) => {
          chime();
          const honey = sp.rewardHoney ? `  +${sp.rewardHoney} honey` : '';
          toast(`Linked ${sp.name}!  +${sp.rewardSparks} spark  +${sp.rewardRP} RP${honey}`);
          // Live-refresh an open screen so the Field Guide reflects a fresh Link
          // immediately (it rebuilds from manager.linkedSpecies() on render).
          screens.refresh();
          void view;
        },
      });
    }

    for (const action of input.consumeActions()) {
      if (action.type === 'escape' && grandpaUi.isOpen) { grandpaUi.close(); continue; }
      if (grandpaUi.isOpen) continue;
      if (grandpa!.placing && action.type === 'escape') { grandpa!.cancelPlacement(); continue; }
      if (grandpa!.placing && action.type === 'rotate') { grandpa!.rotatePlacement(); continue; }
      if (grandpa!.placing && action.type === 'lmb') { grandpa!.confirmPlacement(); continue; }
      if (action.type === 'toggleC') {
        screens.toggle('craft');
        continue;
      }
      if (action.type === 'tab') {
        screens.toggle('guide');
        continue;
      }
      if (action.type === 'logistics') { screens.toggle('logistics'); continue; }
      if (action.type === 'roster') {
        screens.toggle('roster');
        continue;
      }
      if (action.type === 'escape') {
        // Esc priority: cancel an in-progress placement, then close an open
        // screen, otherwise open the inventory screen (Inventory+Building
        // Task 3 — Esc's new default target; the old pause/help overlay is
        // now reached from inside it via the "Controls" button instead).
        if (placement.active) placement.cancel();
        else if (build.active) build.cancel();
        else if (screens.isOpen()) screens.handleEscape();
        else screens.open('inventory');
        continue;
      }
      if (action.type === 'mount') {
        // KeyV: ride/dismount your Prismhorse, or summon/locate it (Haven V6).
        if (!paused) handleMountKey();
        continue;
      }
      if (paused) continue; // gameplay actions (interact/hotbar/lmb/rmb) freeze while a screen is open
      if (action.type === 'rotate') {
        // Playtest Task 8: R is context-sensitive. The rocket edge (also
        // always latched on this same KeyR press) is dropped earlier this
        // tick whenever a ghost is active (see the `input.clearRocketEdge()`
        // call above `player.update`), so there's no double-fire risk here —
        // when NOT active, this action is simply a no-op and the rocket edge
        // already reached `player.update` normally this frame.
        if (build.active) build.rotateGhost();
        continue;
      }
      if (action.type === 'toggleDemolish') {
        setDemolish(!demolishActive);
        continue;
      }
      // While mounted: dart-throw and structure placement are masked (F still
      // talks/collects; the grapple is already gated off in the controller).
      // Hotbar selection still moves the HUD highlight (via the plain
      // select/selectStep ops, bypassing `setHotbar`) so the strip doesn't
      // look frozen, but never auto-enters/cancels a placement ghost while
      // riding — `syncHotbarPlacement` only runs through `setHotbar`.
      if (
        player.mounted &&
        (action.type === 'hotbar' || action.type === 'hotbarStep' || action.type === 'lmb')
      ) {
        if (action.type === 'hotbar') hotbar = selectHotbar(hotbar, action.slot - 1);
        else if (action.type === 'hotbarStep') hotbar = selectStepHotbar(hotbar, action.dir);
        continue;
      }
      // Hotbar select (Digit1-6 / scroll wheel): selection-change side
      // effects (entering/cancelling a kit's placement ghost) run through
      // `setHotbar` → `syncHotbarPlacement`. Grapple is no longer a hotbar
      // slot at all — it's permanently equipped, fired on RMB.
      if (action.type === 'hotbar') {
        setHotbar(selectHotbar(hotbar, action.slot - 1));
        continue;
      }
      if (action.type === 'hotbarStep') {
        setHotbar(selectStepHotbar(hotbar, action.dir));
        continue;
      }
      if (action.type === 'interact') {
        if(landmarkJourney.interact(player.pos,inventory)){doSave();continue;}
        if(skyKingdom.interact(player, inventory)){doSave();continue;}
        const deposit=deposits.find(d=>Math.hypot(player.pos.x-d.pos.x,player.pos.z-d.pos.z)<=6);
        if(deposit){logisticsAction('gather',deposit.id);continue;}
        if(Math.hypot(player.pos.x-DEPOT.x,player.pos.z-DEPOT.z)<5){screens.open('logistics');continue;}
        // Interact priority chain (Haven): village NPC > BOND > structures > harvest.
        const npc = npcs.nearestNpc(player.pos, 3);
        if (npc) {
          openDialog(screens, npc.def);
          continue;
        }
        // Once the goblin curse is lifted, any nearby elf offers the next
        // deterministic breath upgrade for Atlantis materials.
        if (castlePurified && elves.nearest(player.pos, 3)) {
          const trade = tradeForBreath(inventory, breathLevel, castlePurified);
          if (trade.ok) {
            Object.assign(inventory, trade.inventory);
            breathLevel = trade.level;
            breath = createBreath(breathLevel);
            toast(`${trade.trade.name} acquired — air now lasts ${breathMax(breathLevel)} seconds`);
          } else if (trade.reason === 'complete') {
            toast('Your breathing gear is fully upgraded');
          } else if (trade.trade) {
            toast(`${trade.trade.name} costs ${breathTradeCostText(trade.trade)}`);
          }
          continue;
        }
        // BOND: aiming at a Linked critter (within trackRadius) with a charm.
        if (tryBondInteract()) continue;
        const curiosityResult=smallWonders.interact(camera);
        if(curiosityResult){if(curiosityResult==='remembered')doSave();continue;}
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
        // F near a post (mount/recall) or under a drone (recall), or aiming at
        // a placed piece (hold-F reclaim owns that press), is owned by the
        // structure systems — don't also harvest there.
        if (
          !ziplines.nearMount(player.pos) &&
          !drones.nearRecall(player.pos) &&
          !build.aimedPiece(camera.position, cameraLook())
        ) {
          const gained = props.harvestAt(camera.position, cameraLook(), worldTime);
          if (gained) addResource(inventory, gained, 1);
        }
      }
      if (action.type === 'lmb') {
        if (demolishActive) {
          // Playtest Task 9: demolish mode owns LMB outright — normal
          // fire/placement-confirm never runs while it's active (entering it
          // already cancelled any ghost, and a placeable hotbar slot exits it
          // first — see `setDemolish`/`syncHotbarPlacement`, so the other two
          // branches below are unreachable here anyway; this ordering just
          // makes that explicit rather than relying on it).
          tryDemolishReclaim();
        } else if (placement.active) {
          placement.confirm(); // LMB confirms a placement
        } else if (build.active) {
          build.confirm(); // LMB confirms a build ghost
        } else if (player.mode !== 'zipline') {
          // LMB fires the selected hotbar item (see `fireSelectedItem` above)
          // — the grapple now lives entirely on RMB (no reel binding);
          // suppressed only while riding a zipline.
          fireSelectedItem();
        }
      }
      if (action.type === 'rmb') {
        // Final-review Fix 2 (defensive, macOS click translation): macOS
        // translates a Ctrl+LMB click into this same RMB event at the OS
        // level, so a Ctrl-held snap-confirm may arrive here instead of as
        // 'lmb' — see `shouldTreatRmbAsPlacementConfirm`'s doc in input.ts.
        // The grapple itself is ALREADY masked out this frame (controller's
        // `grappleSuppressed`, set above from the same predicate), so this
        // is the confirm's only path through while suppressed — normal play
        // (snap not held, or no ghost active) leaves RMB doing nothing here,
        // same as before this fix (the grapple fire lives entirely in
        // controller.ts's own level-read of `input.rmbHeld`, not this queue).
        if (shouldTreatRmbAsPlacementConfirm(build.active, input.snapHeld)) {
          build.confirm();
        }
      }
    }

    // Keep the sky dome centred on the camera so its gradient never parallaxes.
    if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
  }

  /** Draw the current state + repaint the HUD. Called once per frame with the
   *  raw (unclamped-by-timeScale) frame delta — only consumed by the hands
   *  viewmodel's idle-sway/walk-bob clock, which is a wall-clock cosmetic
   *  effect rather than part of the fixed-step sim. */
  function render(dt: number): void {
    grandpa!.render(dt);
    // Lantern Charm reward: a soft glow tracking the player once owned.
    if (getRewards().has('lanternCharm')) {
      lantern.visible = true;
      lantern.intensity = 1.6;
      lantern.position.set(camera.position.x, camera.position.y + 0.3, camera.position.z);
    } else {
      lantern.visible = false;
    }
    farmVisuals.update(farm, roster, worldTime, SIM_DT);
    logisticsVisuals.update(economy, roster, worldTime, SIM_DT);
    // Day/night visuals (Task 5): sun/hemi/fog/sky-dome/moon/stars react to the
    // live daylight sample; the resolved sun-scale feeds the cascade rig so
    // night dimming survives a shadow re-plan (quality change / fps gate).
    const daylightSample = daylightAt(worldClock);
    daylight.update(daylightSample);
    underwater?.applyView(player.underwater, daylightSample.darkness);
    // Nothing beyond the underwater fog is visible. Keep it out of the
    // beauty/AO draw lists, restoring the full island view on surfacing.
    const viewFar=player.underwater?UNDERWATER.fogFar:CAMERA.far;
    if(camera.far!==viewFar){camera.far=viewFar;camera.updateProjectionMatrix();}
    shadowRig.setSunScale(daylight.sunScale);
    updateShadowFollow();
    // Water 1.5: advance the shader ripple/shimmer clock (one uniform write).
    updateWater(scene, worldTime);
    // Fidelity-3: slow cloud-layer drift (one rotation write).
    updateClouds(scene, worldTime);
    // Fidelity-3: windmill blade spin (one rotation write).
    updateWindmill(scene, worldTime);
    // Bounce Wave: trampoline cosmetics + the bounce impulse. The launch apex
    // is fixed relative to the PAD, so chained bounces plateau (free-flight
    // invariant). Uses the movement core's gravity for an exact apex.
    skyKingdom.render(worldTime, player.pos, grandpaGuest || screens.isOpen());
    if (!grandpaGuest) landmarkJourney.step(dt,player.pos,inventory,screens.isOpen());
    smallWonders.update(dt,worldTime,camera,grandpaGuest||screens.isOpen()||document.hidden);
    tramps.update(dt);
    {
      const bvy = tramps.bounceVelocity(player.pos, player.vel.y, MOVE.gravity);
      if (!grandpaGuest && bvy !== null) player.bounce(bvy);
    }

    // First-person hands (Inventory+Building Task 6) — must run before the
    // render call below since the view model is a camera child. Hidden while
    // a screen is open, mid daze-blackout, during a `?debug=` framing freeze,
    // or while mounted (the mount fills the view for both hands, not just the
    // grapple-gated right one). `selectedItem` is resolved from a zero-count
    // slot to `null` here — see `HandsUpdateOpts.selectedItem`'s doc comment —
    // so `HandsView` never has to import `Inventory`/`itemCount` itself.
    const rawSelectedItem = hotbar.slots[hotbar.selected] ?? null;
    hands.update(dt, {
      speed: Math.hypot(player.vel.x, player.vel.z),
      selectedItem: rawSelectedItem && itemCount(inventory, rawSelectedItem) > 0 ? rawSelectedItem : null,
      grappleUnlocked: player.unlocks.has('grapple'),
      hookLive: player.isGrappling(),
      riding: player.mounted,
      hidden: grandpaGuest || screens.isOpen() || ejectPhase === 'blackout' || debugFrozen || player.mounted,
    });

    // High + fxAllowed → the post composer (SSAO + bloom + tone-map output);
    // otherwise the unchanged direct render path (medium/low/software).
    renderer.info.reset();
    renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;
    performanceHUD?.gpu.begin();
    if (post) post.render();
    else renderer.render(scene, camera);
    performanceHUD?.gpu.end();
    npcs.updateLabels(camera);
    if (grandpaGuest) return;
    const p = player.pos;
    const aimed = props.findHarvestable(camera.position, cameraLook(), worldTime);
    // Build pickup prompt (Inventory+Building Task 5): aiming at a placed
    // piece within pickup range, regardless of whether F is currently held.
    const aimedPieceForPrompt = build.aimedPiece(camera.position, cameraLook());
    // Demolish-mode prompt (playtest Task 9): drone proximity checked first
    // (see `demolishAim`'s doc — drones reclaim by standing beneath one, not
    // by aim), then the ray-based build-piece/zipline-post target. Only
    // computed while the mode is actually active — a real per-frame cost
    // (a ray sweep over every placed piece + zipline post) with nothing to
    // show for it otherwise.
    const demolishTargetLabel = demolishActive
      ? drones.recallableIdNear(p)
        ? 'Drone'
        : demolishAim()?.label ?? null
      : null;
    // Latched-rope / demolish crosshair states take priority over the
    // harvest/dart auto-detection below (`paintCrosshair`'s own fallback).
    hudUi.setCrosshairMode(demolishActive ? 'demolish' : player.isGrappling() ? 'grapple' : 'auto');
    hudUi.update({
      pos: p,
      yaw: input.yaw,
      stamina: player.stamina,
      exhausted: player.exhausted,
      hp: health.hp,
      dazed: isDazed(health),
      breath: breath.remaining,
      breathMax: breathMax(breathLevel),
      underwater: player.underwater,
      dazeBlack: ejectPhase === 'blackout',
      inventory,
      unlocks: player.unlocks,
      critters: critters.list(),
      harvestPrompt: aimed ? aimed.kind : null,
      interactionPrompt:
        deposits.some(d=>Math.hypot(p.x-d.pos.x,p.z-d.pos.z)<=6) ? 'Gather deposit · N manages extractor & hauler' :
        Math.hypot(p.x-DEPOT.x,p.z-DEPOT.z)<5 ? 'Open Haven supply routes' :
        castlePurified && elves.nearest(p, 3)
          ? breathLevel >= UNDERWATER.breathUpgradeCount
            ? 'Talk to elf (breathing gear complete)'
            : 'Trade with elf for longer breath'
          : null,
      buildPickup: aimedPieceForPrompt
        ? { kind: aimedPieceForPrompt.kind, progress: build.pickupProgress() }
        : null,
      demolishTarget: demolishTargetLabel,
      spawn,
      locked: input.locked,
      screenOpen: screens.isOpen(),
      dayCycleT: daylightSample.cycleT,
      dayDarkness: daylightSample.darkness,
      // Spec §4 (final-review fix): the HP bar surfaces within the castle
      // region at night even at full HP — a live ambush threat, not just a
      // damage readout. Purified castle = no danger = no bar.
      dangerZone: inCastleRegion(p.x, p.z) && daylightSample.darkness > 0.5 && !castlePurified,
      hotbarSlots: hotbar.slots,
      selectedSlot: hotbar.selected,
    });
  }

  // Prime the chunk field + props + critters around the player before the
  // first frame so nothing pops in. `primePos` is the restored save position
  // when a save was loaded, otherwise the fresh spawn point.
  chunks.update(primePos.x, primePos.z);
  props.primeAround(primePos.x, primePos.z, worldTime);
  if (!grandpaGuest) critters.update(SIM_DT, primePos);

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
  // Debug castle (`?debug=castle`): stand outside the gate (whichever wall it
  // actually falls on — the EAST wall for this site, see castle/layout.ts)
  // looking in toward the keep, and freeze — a static frame showing the
  // curtain wall, towers and gate arch together. Verification-only.
  // -------------------------------------------------------------------------
  if (debugCastle) {
    const layout = castleLayout();
    // Pulled back well outside the gate so the curtain wall AND both flanking
    // towers fit the frame together (right up against the gate, the arch fills
    // the view and the ~18 m towers fall outside it).
    const cx = CASTLE.center.x + CASTLE.half + 65;
    const cz = CASTLE.center.z;
    const camY = CASTLE.padHeight + 3;
    // Aim at the keep rising behind the gate so wall/towers/keep all frame up.
    const dx = layout.keep.x - cx;
    const dz = layout.keep.z - cz;
    const horiz = Math.hypot(dx, dz);
    const targetY = CASTLE.padHeight + layout.keep.h * 0.7;
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = Math.atan2(targetY - camY, horiz);
    player.teleport(cx, camY, cz);

    chunks.update(cx, cz);
    props.primeAround(cx, cz, worldTime);
  }

  // -------------------------------------------------------------------------
  // Debug handle (Task 14): window.__game — the backbone for Task 15's
  // Playwright verification (state snapshot, teleport/grant/spawn/track/
  // completeTracking, time-scaling, save/reset). `timeScale` is read by the
  // fixed-timestep loop below (clamped 0.1..16 in setTimeScale so a runaway
  // value can neither stall nor explode the accumulator).
  // -------------------------------------------------------------------------
  let timeScale = 1;

  if (devSession) (window as unknown as { __grandpa: unknown }).__grandpa = {
    state: () => ({ role: grandpaGuest ? 'grandpa' : 'child', status: grandpaNet.status, code: grandpaNet.code, message: grandpaNet.message, creature: structuredClone(grandpa!.state), chase: { ...grandpa!.chase }, reward: structuredClone(grandpa!.reward), placing: grandpa!.placing }),
    aim: () => {
      const p = grandpa!.state?.pos; if (!p) return;
      const dx = p.x - player.pos.x, dz = p.z - player.pos.z, dy = p.y + 3.3 - camera.position.y;
      input.yaw = Math.atan2(-dx, -dz); input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    // Fixture positioning only; darts, input, tracking and rewards use their real paths.
    positionCreature: (x: number, y: number, z: number) => {
      if (grandpaGuest || !grandpa!.state) return;
      grandpa!.state.pos = { x, y, z }; grandpa!.state.vel = { x: 0, y: 0, z: 0 };
    },
    structureState: () => ({ builds: build.serialize(), structures: serializeStructures(ziplines, drones, tramps) }),
  };

  if(devMode)(window as unknown as {__sky:unknown}).__sky={state:()=>skyKingdom.snapshot(),floor:(x:number,z:number,y:number)=>skyFloorBelow(x,z,y),hook:()=>player.grappleSnapshot};
  if(devSession)(window as unknown as {__landmarks:unknown}).__landmarks={layouts:LANDMARKS,progress:()=>structuredClone(landmarkJourney.progress),airbell:()=>breathingAirbell(camera.position),world:landmarkWorld};
  if(devSession)(window as unknown as {__wonders:unknown}).__wonders={sites:CURIOSITIES,state:()=>smallWonders.snapshot(),presentation:(enabled:boolean)=>smallWonders.setPresentationEnabled(enabled),freezeWorld:(enabled:boolean)=>{timeScale=enabled?0:1;}};

  (window as unknown as { __game: unknown }).__game = buildDebugHandle({
    player,
    input,
    inventory,
    ground,
    critters,
    ziplines,
    drones,
    isPlacing: () => placement.active,
    hotbar: () => hotbar,
    placedPieces: () => build.pieces().length,
    isBuilding: () => build.active,
    placePiece: (kind: string, x: number, y: number, z: number, yaw: number) =>
      build.debugPlace(kind, x, y, z, yaw),
    isGrappling: () => player.isGrappling(),
    // Playtest Task 9 e2e verification hooks (destruction mode).
    isDemolishing: () => demolishActive,
    setDemolishing: (next: boolean) => {
      setDemolish(next);
      return demolishActive;
    },
    placeTrampoline: (kind: 'ground' | 'sky', x: number, z: number) => {
      const res = tramps.place({ x, y: ground.heightAt(x, z), z }, kind);
      return res.ok ? (res.id ?? null) : null;
    },
    placeDrone: (x: number, z: number) => {
      const res = drones.place({ x, y: ground.heightAt(x, z), z }, { instant: true });
      if (!res.ok || !res.id) return null;
      drones.update(SIM_DT); // register the anchor immediately (instant spawns at altitude)
      return res.id;
    },
    placeZipline: (ax: number, az: number, bx: number, bz: number) => {
      const a = { x: ax, y: ground.heightAt(ax, az) + STRUCTURES.postHeight, z: az };
      const b = { x: bx, y: ground.heightAt(bx, bz) + STRUCTURES.postHeight, z: bz };
      const res = ziplines.place(a, b);
      return res.ok && res.id ? res.id : null;
    },
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
    logistics: () => ({state:structuredClone(economy),deposits, depot:DEPOT, roster:structuredClone(roster), art:artStats}),
    logisticsAction,
    researchField: (id:Technology) => buyTechnology(economy,id,inventory),
    assignHauler: (id:string,worker:number) => { const site=economy.sites.find(s=>s.id===id);return site?assignHauler(economy,site,roster,worker):'Unknown site'; },
    // Draw-call / resource counters sampled from renderer.info after the last
    // render (Fidelity-2 P1 draw-call budget check).
    renderStats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      scenery: props.detailStats(),
      view: devMode ? { ...cameraInterpolation.lastRendered } : undefined,
      performance: performanceHUD ? { ...performanceHUD.metrics.snapshot(), gpuMs: performanceHUD.gpu.milliseconds } : undefined,
    }),
    quality: () => ({ id: currentQuality(), flags: qualityFlags() }),
    hp: () => health.hp,
    // Debug-only: direct damage (daze-eject-spires §1 e2e verification) —
    // routes through the same applyHit goblins use, so dazed invulnerability
    // still applies identically.
    hurt: (dmg: number) => {
      health = applyHit(health, dmg);
    },
    goblinCount: () => castleSys.goblinCount(),
    // Castle Ward Task 6 e2e verification: raw goblin (x, y, z) positions.
    goblinPositions: () => castleSys.goblinTargets().map((t) => t.pos),
    // Debug: spawn one goblin 6 m ahead of the player, regardless of phase
    // (Cursed Castle Task 11 e2e verification).
    spawnGoblin: () => {
      const yaw = input.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const p = player.pos;
      return castleSys.spawnOne({ x: p.x + dirX * 6, y: p.y, z: p.z + dirZ * 6 });
    },
    elfCount: () => elves.count,
    // Debug: reconcile the live elf count (Cursed Castle Task 12 e2e).
    setElves: (n: number) => elves.setCount(n),
    castlePurified: () => castlePurified,
    // Debug: run the full crystal-purify sequence (Cursed Castle Task 14 e2e).
    purifyCrystal: () => castleSys.purifyCastle(),
    // Castle Ward Task 5 e2e: is the player currently under a roofed hall.
    inHall: () => inHall(player.pos.x, player.pos.z),
    handsState: () => hands.debugState(),
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
    (window as unknown as { __underwater: unknown }).__underwater = {
      center: { ...UNDERWATER.center, y: UNDERWATER.floorY },
      /** Jump to the marked buoy line, ready to press Q and descend. */
      surface(): void {
        const p = diveEntryPoint();
        player.teleport(p.x, p.y, p.z);
      },
      /** Jump directly into the water column facing the sunken palace. */
      dive(): void {
        player.teleport(
          UNDERWATER.center.x,
          UNDERWATER.floorY + 9,
          UNDERWATER.center.z - 58,
        );
        input.yaw = Math.PI;
        input.pitch = -0.08;
      },
      state: () => ({
        underwater: player.underwater,
        breath: breath.remaining,
        breathMax: breathMax(breathLevel),
        breathLevel,
        targets: underwater?.dartTargets().length ?? 0,
        purifiedClams: underwater?.purifiedClamIds() ?? [],
        linkedCrocs: underwater?.linkedCrocIds() ?? [],
        shell: inventory.shell,
        scale: inventory.scale,
        tideDarts: inventory.tideDarts,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Fixed-timestep game loop: accumulator pattern, SIM_DT-sized update steps,
  // render every animation frame. Frame delta is clamped so tab-switches /
  // long stalls don't cause a spiral-of-death catch-up burst.
  // -------------------------------------------------------------------------

  startAnalytics('wildtag', () => !screens.isOpen() && !debugFrozen);

  const MAX_STEPS_PER_FRAME = 240;
  let accumulator = 0;
  let lastTime = performance.now();
  const cameraInterpolation = new CameraInterpolation(camera.position, player.teleportVersion);
  document.addEventListener('visibilitychange', () => {
    lastTime = performance.now();
    accumulator = 0;
    cameraInterpolation.reset(camera.position, player.teleportVersion);
    performanceHUD?.metrics.reset();
  });

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
    const simulationStart = performanceHUD ? performance.now() : 0;
    cameraInterpolation.syncTeleport(camera.position, player.teleportVersion);
    accumulator += frameDt * timeScale;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      update(SIM_DT);
      cameraInterpolation.record(camera.position, player.teleportVersion);
      accumulator -= SIM_DT;
      steps++;
    }

    const renderStart = performanceHUD ? performance.now() : 0;
    cameraInterpolation.sample(accumulator / SIM_DT, camera.position);
    // Mouse look follows the display cadence, including frames with no sim step.
    camera.rotation.set(input.pitch, input.yaw, 0, 'YXZ');
    if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z);
    render(frameDt);
    // Restore the authoritative eye before gameplay raycasts and the next step.
    camera.position.copy(cameraInterpolation.current);
    camera.updateMatrixWorld();
    if (performanceHUD && !document.hidden) {
      performanceHUD.update(now, rawDt * 1000, renderStart - simulationStart, performance.now() - renderStart);
    }
  }

  requestAnimationFrame(frame);
}
