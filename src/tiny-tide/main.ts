import { startAnalytics } from '../analytics';
import * as T from 'three';
import './style.css';
import './hud.css';
import { applyDesign, commitEvolution, stageDescription, currentPlan, damageAfterArmor, dietCanEat, dnaOf, evolveReady, freshRun, growthOf, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, STAGES, type Build, type Run } from './state';
import { adaptToPlan, derive, dietOf, effectiveStats } from './genome';
import { part } from './parts';
import { tierSpecies } from './species';
import { PLAYER_HALF, seabedHeight, SIZES, SPAWN_HALF } from './biomes';
import { EDGE_HINT, EDGE_SOFT_START, inEdgeZone } from './edge';
import type { EcoEvent, Entity } from './ecosystem';
import { canApproachFood, type Traversal } from './food-access';
import { openEditor, type EditorResult, type SubmitOutcome } from './editor';
import { openPathScreen, type PathChoice } from './path-screen';
import { renderPreview } from './preview';
import { cardSummary, COAST_READY, eligibleChildren, leadsTo, type BodyPlan } from './plans';
import { quoteDesign } from './economy';
import { newRuntime, type Actor, type CombatInput, type Constraint, type MoveKind, type Tuple4, type Vec3, type WorldQueries } from './combat-types';
import { aimChevron, aimPitch, autoAim, BRACE_AUTO_AIM_HALF_ANGLE, dragAim, aimToward, mouseButtons, NO_MOUSE, pickAimTarget, pitched, pointerAim, type PickCandidate, readIntent, RELEASED, type AimCandidate, type AimSource, type MouseState } from './input';
import { BURROW } from './bestiary';
import { AlphaBar, alphaView, avoidKeepOut, CombatHud, CombatOverlay, EdgeArrowMemory, edgeArrowAt, faintMessage, FLOATER_COLOURS, floaterClass, floaterText, HP_BAR_SECONDS, MOVE_ICONS, slotViews, type AlphaView, type EdgeArrow, type HpBar } from './combat-hud';
import { forwardOf } from './orientation';
import { blockHint, blockHintDue, newBlockHintGate, PITCH_LIMIT, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
import { admitted as simAdmitted, checkPose, playerActorCached as simActor, qaAlphaHealth, qaCrowd, qaEncounter, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, simSuspend, worldHull as simWorldHull, type GameMode, type SimEvent, type SimState, type SimWorld } from './sim';
import { helpDangerText, hintIcon, Hints, hintText, type HintId, type HintStorage } from './hints';
import type { ChompResult } from './feeding';
import { PLAYER_ID, type CombatTick, type TelegraphView } from './combat-world';
import { damageText, EFFECTS, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
import { movement, movementCapabilities } from './profiles';
import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, zoneLabel } from './world-queries';
import { ROCK_FIT, stageSolids } from './reef';
import { startAnchor } from './motion';
import { bodyLengthOf, playerActor, speciesActor } from './mount';
import { designDelta } from './design-delta';
import { TideAudio } from './audio';
import { TideWorld } from './world';
import { loadAssets, assetDiagnostics } from './assets';
import { editorFrame, editorProjection } from './editor';
import { PARTS } from './parts';
import { emittersOf } from './design-delta';
import { restPivotToPart } from './rig';
import { sampleCombatPose } from './mount';

const svg = (body: string, cls = '') => `<svg class="${cls}" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const species = [
  svg('<path d="M28 17c-2-8-13-10-18-3-6 8 1 18 11 16l6-3M13 21c0 5 5 7 9 5M11 14l5 3m-7 3 5 1m-1 7 3-4m9-9 4-7m-1 8 7-4M26 25l7 4-7 3"/><circle cx="25" cy="17" r="1.4" fill="currentColor"/>'),
  svg('<path d="M29 20c-9-13-21-10-24 0 3 10 15 13 24 0Zm0 0 7-8v16l-7-8ZM15 11l5-5 3 7m-8 16 5 5 3-7"/><circle cx="12" cy="18" r="1.3" fill="currentColor"/>'),
  svg('<path d="M5 23C3 9 21 8 28 19l7-5-1 9 4 5-10-1C16 36 5 29 5 23Z"/><path d="m17 12 4-7 3 10M7 25c7 4 14 3 20-1m-11 5-2 5"/><circle cx="10" cy="20" r="1.3" fill="currentColor"/>'),
  svg('<path d="M10 21c0-12 20-12 20 0m-17-8V7h5v5m5 0V5h5v10M10 20c-8 5-5 14-1 11l4-5c-2 13 6 12 7 1 2 11 8 12 7-1 5 12 12 4 3-6"/><circle cx="15" cy="20" r="1.5" fill="currentColor"/><circle cx="25" cy="20" r="1.5" fill="currentColor"/>'),
  svg('<circle cx="20" cy="20" r="10"/><ellipse cx="20" cy="20" rx="19" ry="6" transform="rotate(-28 20 20)"/><path d="m29 5 2-3 1 4 4 1-4 1-1 4-2-4-3-1 3-2"/><circle cx="17" cy="18" r="1" fill="currentColor"/><circle cx="24" cy="18" r="1" fill="currentColor"/><path d="M18 23q3 3 5-1"/>'),
];
const icons = {
  edit: svg('<path d="M8 32l2-8L26 8l6 6-16 16-8 2Zm16-22 6 6"/><circle cx="11" cy="11" r="3"/><circle cx="31" cy="30" r="2"/>'),
  dna: svg('<path d="M12 4c0 10 16 10 16 20s-16 10-16 12M28 4c0 10-16 10-16 20s16 10 16 12M14 10h12m-14 9h16m-16 11h14"/>'),
  sound: svg('<path d="m9 16 7-6v20l-7-6H4v-8h5Zm14-2q7 6 0 12m5-17q12 11 0 22"/>'),
  mute: svg('<path d="m9 16 7-6v20l-7-6H4v-8h5Zm15 0 10 10m0-10L24 26"/>'),
  help: svg('<circle cx="20" cy="20" r="14"/><path d="M16 15c0-6 12-6 9 1-1 3-5 2-5 7m0 5v.1"/>'),
  pause: svg('<path d="M15 11v18m10-18v18" stroke-width="4"/>'),
  arrow: svg('<path d="M9 20h23m-9-9 10 9-10 9"/>'),
  chomp: svg('<path d="M33 13A15 15 0 1 0 33 29L21 21l12-8Z" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="2" fill="#ffac87"/><circle cx="34" cy="21" r="2.5" fill="currentColor" stroke="none"/>'),
  up: svg('<path d="M20 31V9M10 20 20 9l10 11m-21 20h22"/>'),
  leaf: svg('<path d="M10 29C2 11 20 6 31 8c2 13-3 29-19 23L26 14M9 35l8-12"/>'),
  play: svg('<path d="m15 10 16 10-16 10V10Z" fill="currentColor" stroke="none"/>'),
};
const heart = '<svg viewBox="0 0 20 18" aria-hidden="true"><path d="M10 17 2.4 9.6a4.6 4.6 0 0 1 6.5-6.5L10 4.2l1.1-1.1a4.6 4.6 0 0 1 6.5 6.5Z"/></svg>';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="vignette"></div><div class="grain"></div>
  <header class="topbar"><a class="brand" href="#" aria-label="Tiny Tide home"><span class="brand-mark">${species[0]}</span><span>tiny tide<span class="brand-dot">.</span></span></a><div class="top-actions"><span id="mode-label">A SMALL GAME ABOUT GETTING BIG</span><button class="icon-button" id="edit" aria-label="Edit your creature" hidden>${icons.edit}</button><button class="icon-button" id="sound" aria-label="Mute sound" aria-pressed="false">${icons.sound}</button><button class="icon-button" id="help" aria-label="How to play">${icons.help}</button><button class="icon-button" id="pause" aria-label="Pause game" hidden>${icons.pause}</button></div></header>
  <main id="home">
    <div class="home-copy"><div class="eyebrow"><span class="tiny-star">✳</span> DESIGN IT. FEED IT. EVOLVE IT.</div><h1>Small fry.<br><em>Big appetite.</em></h1><p>Build your own little creature. <br>Grow it until it eats the universe.</p><div class="start-row"><button id="start" class="primary">Let’s eat ${icons.arrow}</button><span class="play-note">YOUR CREATURE.<br>YOUR RULES.</span></div><button id="fresh" class="text-button" hidden>Start a fresh adventure</button><div class="home-hint"><span class="hint-line"></span> A cozy 3D eat-and-evolve adventure</div></div>
    <div class="creature-caption"><span class="caption-line"></span><span id="home-name">little tide<br><small>big things start small.</small></span><span class="caption-spark">✧</span></div>
    <section id="home-notes" aria-label="Save notices" hidden></section>
    <div class="journey"><div class="journey-heading"><span>YOUR NEXT BIG THING</span><span>5 SIZES · ONE HUNGRY LITTLE SOUL</span></div><div class="journey-track">${STAGES.map((s, i) => `<div class="journey-step ${i === 0 ? 'current' : ''}"><span class="step-icon">${species[i]}</span><div><span class="step-number">0${i + 1}</span><span class="step-name">${s.title}</span><small>${['Nibble', 'Swim', 'Breach', 'Take flight', 'Devour the stars'][i]}</small></div>${i < 4 ? '<span class="step-dots">···</span>' : ''}<span class="sr-only">${s.size}</span></div>`).join('')}</div></div>
  </main>
  <section id="game-ui" hidden aria-label="Game controls">
    <div class="stage-card"><div id="stage-icon"></div><div><span class="eyebrow" id="biome"></span><h2 id="creature-name"></h2><span id="size"></span><div id="hearts" role="img"></div></div></div>
    <div class="growth-card"><div class="growth-meta"><span id="growth-label">DNA FOR YOUR NEXT EVOLUTION</span><strong id="growth-count"></strong></div><div class="growth-track"><div id="growth-fill"></div></div><div class="growth-next"><span id="diet"></span><span id="wallet">${icons.dna}<b id="dna"></b> DNA</span></div></div>
    <div id="objective"><span class="objective-dot"></span><span id="objective-text"></span></div>
    <button id="evolve" class="primary evolve-button" hidden>${icons.up}<span>Evolve!</span></button>
    <div class="stage-dots" aria-label="Evolution progress">${STAGES.map((s, i) => `<span data-stage="${i}" title="${s.title}">${species[i]}</span>`).join('<i></i>')}</div>
    <div id="joystick" aria-label="Drag to move" role="group"><div class="stick-cross"></div><span id="stick"></span></div><div class="movement-hint"><span class="desktop-hint"><kbd>W</kbd><br><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>TO MOVE · MOUSE TO AIM · MIDDLE-DRAG TO LOOK</span></span><span class="touch-hint">DRAG TO MOVE</span></div>
    <div class="look-hint" id="look-hint"><span>↔</span><b class="fine-only">MIDDLE-DRAG TO LOOK AROUND</b><b class="coarse-only">SWIPE TO LOOK AROUND</b></div><div class="depth-gauge"><span id="depth-label">SEAFLOOR</span><div><i id="depth-dot"></i></div><small id="depth-hint">LOOK UP. THERE’S A WHOLE WORLD.</small></div><div id="evolution-banner" hidden><span id="evolution-icon"></span><div><small>LOOK AT YOU GROW!</small><strong id="evolution-name"></strong><span id="evolution-detail">Same little soul. A bigger world to eat.</span></div></div><div class="actions"><div class="vertical-controls" id="vertical-controls" hidden><button id="special" class="special-button" aria-label="Rise" hidden>${icons.up}<span id="special-label">RISE</span><kbd>E</kbd></button><button id="dive" class="special-button dive-button" aria-label="Dive">${icons.up}<span>DIVE</span><kbd>Q</kbd></button></div><button id="chomp" class="chomp-button" aria-label="Chomp (hold to keep eating)">${icons.chomp}<strong>CHOMP</strong><span>HOLD <kbd>SPACE</kbd></span></button></div>
    <div id="food-pointer" hidden><span id="pointer-arrow">↑</span><span id="pointer-label">SEA SPROUT</span></div>
    <div id="snack-label" hidden></div><div id="threats" aria-hidden="true"></div><div id="toast" role="status" aria-live="polite"></div>
    <div id="faint" hidden><strong>Gobbled!</strong><span>Your little one carries on.</span></div>
  </section>
  <div id="floaters" aria-hidden="true"></div>
  <dialog id="modal" aria-labelledby="modal-title"><button id="close-modal" class="close-button" aria-label="Close dialog">×</button><div id="modal-content"></div></dialog>
  <div class="corner-note" id="corner-note">MADE FOR A LITTLE ESCAPE <span>✳</span></div>
`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** A touch-first device (no fine pointer): the camera turns with a swipe, not a middle drag (spec §8.1). */
const coarsePointer = () => matchMedia('(pointer: coarse)').matches;
const combatHud = new CombatHud(document.querySelector<HTMLElement>('#game-ui .actions')!), overlay = new CombatOverlay(document.getElementById('game-ui')!), alphaBar = new AlphaBar(document.getElementById('game-ui')!);
/** Reduced motion follows the OS setting only (D31): no camera shake. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** This frame's telegraphs (read-only diagnostics), the ones whose edge arrow shows, and the edge-arrow memory. */
let telegraphViews: TelegraphView[] = [], arrowed = new Set<string>();
const arrowMemory = new EdgeArrowMemory();
const audio = new TideAudio();
let world: TideWorld;
try {
  el<HTMLButtonElement>('start').disabled = true;
  await loadAssets(fraction => { el('start').textContent = `Waking the reef… ${Math.round(fraction * 100)}%`; });
  el<HTMLButtonElement>('start').disabled = false; el('start').innerHTML = `Let’s eat ${icons.arrow}`;
  world = new TideWorld(document.querySelector<HTMLCanvasElement>('#ocean')!); }
catch {
  app.innerHTML = '<div class="fallback"><h1>A little help?</h1><p>The reef couldn’t finish loading. Check your connection and make sure 3D graphics are enabled, then try again.</p><button onclick="location.reload()" class="primary">Try again</button></div>';
  throw new Error('Tiny Tide could not load its Blender assets or start WebGL.');
}
const SAVE_KEY = 'tiny-tide-adventure-v4';
const QA = import.meta.env.DEV || new URLSearchParams(location.search).has('qa');
/** QA: the admission time (every overlapHull call: player, ecosystem, food guide) of each played frame, summed per stage, in total and
 *  per caller, with the player's contacts. Only calls made inside a played frame count (the clock resets when a frame starts). */
admissionClock.on = QA;
const admissionStats = SIZES.map(() => ({ frames: 0, ms: 0, calls: 0, worst: 0, contacts: 0, player: { ms: 0, calls: 0, worst: 0, worstCalls: 0 }, rescueWorstCalls: 0, ecosystem: { ms: 0, calls: 0, worst: 0 }, guide: { ms: 0, calls: 0, worst: 0 } }));
let frameContacts = 0;
// QA-only URL parameters (development or `?qa`). Each is read once here, at load. None changes a running game from outside.
const qaParams = new URLSearchParams(QA ? location.search : '');
/** `?qaStartGrace=0` removes the start grace. */
const START_GRACE = qaParams.get('qaStartGrace') === '0' ? 0 : 2;
/** `?forcedSpawn=x,y,z` (stage-local units): the first start of this page load searches for a legal pose from there instead of the
 *  start anchor. The spawn is still recovered to a legal pose (else the start anchor is used). A pending respawn ignores it. */
let forcedSpawn: Vec3 | null = (() => {
  const v = qaParams.get('forcedSpawn')?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? { x: v[0]!, y: v[1]!, z: v[2]! } : null;
})();
/** `?qaRejectSubmit=1`: the first editor submit (edit or evolve) of this page load returns `{ ok: false, reason: 'QA rejection' }`. */
let qaRejectSubmit = qaParams.get('qaRejectSubmit') === '1';
/** `?qaHoldStart=1`: after the first start, the simulation (player, ecosystem, game clock) does not advance until the first
 *  real key or pointer press in play. */
let qaHoldStart = qaParams.get('qaHoldStart') === '1';
/** `?qaEncounter=<species key>` (for example `1:crab`): at the first start of this page load, the nearest live instance of that species (of a
 *  tier next to the stage) is installed 3 player body lengths in front of the player, in calm (spec §14.2). */
let qaEncounterKey = qaParams.get('qaEncounter');
/** The entity that `qaEncounter` installed (diagnostics). */
let qaEncounterId: number | null = null;
/** `?qaCrowd=<species key>,<species key>…` (for example `1:sardine,1:puffer`): at the first start of this page load, every live non-alpha
 *  instance of those species is installed on a ring of 3 player body lengths around the player, in calm (the frame-time check, review R18). */
let qaCrowdKeys: string[] | null = qaParams.get('qaCrowd')?.split(',').filter(Boolean) ?? null;
/** The entities that `qaCrowd` installed (diagnostics). */
let qaCrowdIds: number[] = [];
/** `?qaAlphaHealth=<0..1>`: at the first start of this page load, every live alpha starts with that fraction of its HP (at least 1). */
/** `?qaFollowScale=<n>` (.5 to 2): a fixed play-camera follow scale (the camera-away check keeps the old size-0 distance, scale 1). */
world.followOverride = (() => { const v = Number(qaParams.get('qaFollowScale')); return qaParams.has('qaFollowScale') && Number.isFinite(v) ? Math.min(2, Math.max(.5, v)) : null; })();
let qaAlpha: number | null = (() => { const v = Number(qaParams.get('qaAlphaHealth')); return qaParams.has('qaAlphaHealth') && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null; })();
/** The part catalog (every shipped part has its real grants since sub-project 3a; `?qaGrantCatalog` is gone, D32). */
const CATALOG = PARTS;
/** The first QA rejection, if `?qaRejectSubmit=1` asked for one. */
function qaRejection(): SubmitOutcome | null {
  if (!qaRejectSubmit) return null;
  qaRejectSubmit = false; return { ok: false, reason: 'QA rejection' };
}
interface Legality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
const legalities = new Map<number, Legality>();
/** The player's world queries (terrain and the run's reef solids) and bounds for a stage (physical units). `maxY` replaces the old
 *  sky clamp. The world seed defaults to the current run's. The cache key is numeric (no string per call; seeds are 32-bit integers). */
function legality(stage: number, seed = run.seed): Legality {
  const key = seed * 8 + stage;
  let l = legalities.get(key);
  if (!l) {
    l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) };
    if (legalities.size >= 16) legalities.clear();
    legalities.set(key, l);
  }
  return l;
}
/** A design is buildable only when the body has a start anchor at both growth ends (spec §3). */
const BUILD: Build = { coast: COAST_READY, anchorCheck: (g, p) => [1, 1.38].every(growth => startAnchor(playerActor(p, g, p.size, growth), p.size, legality(p.size)).ok) };
/** A second v4 key. It holds a new run when `SAVE_KEY` holds a kept or unreadable save, so those bytes stay untouched. */
const FRESH_KEY = 'tiny-tide-adventure-v4-fresh';
const V4_KEYS = [FRESH_KEY, SAVE_KEY];
/** Older keys are read for migration only, and only when no v4 key exists. They are never written. */
const LEGACY_KEYS = ['tiny-tide-adventure-v2', 'tiny-tide-adventure-v1'];
let saved: Run | null = null;
/** The key the resumable run came from, or null. */
let loadedKey: string | null = null;
/** The message of a kept (coast) save, shown on the home screen. */
let keptMessage: string | null = null;
/** The one key this session writes, or null when no key is safe to write. */
let writeKey: string | null = null;
/** True when every v4 key holds a save that cannot load, so this session cannot save. */
let unsavable = false;
try {
  const present = new Set<string>(), blocked = new Set<string>();
  for (const key of V4_KEYS) {
    const raw = localStorage.getItem(key); if (raw === null) continue;
    present.add(key);
    const loaded = parseSaveWithNotes(raw, BUILD, CATALOG);
    if (loaded?.status === 'kept') { keptMessage ??= loaded.message; blocked.add(key); }
    else if (loaded?.status === 'ok') { if (!loadedKey) { saved = loaded.run; loadedKey = key; } }
    else blocked.add(key);   // Unreadable: keep the bytes, they may be recoverable.
  }
  // A v4 key that exists but cannot load never falls back to an older legacy run.
  if (present.size === 0) {
    for (const key of LEGACY_KEYS) {
      const loaded = parseSaveWithNotes(localStorage.getItem(key), BUILD, CATALOG);
      if (loaded?.status === 'ok') { saved = loaded.run; loadedKey = key; break; }
    }
  }
  unsavable = present.size > 0 && blocked.size === V4_KEYS.length;
  writeKey = loadedKey && V4_KEYS.includes(loadedKey) ? loadedKey : [SAVE_KEY, FRESH_KEY].find(key => !blocked.has(key)) ?? null;
  // A migrated run is written once to its v4 key, so the legacy keys are not read again.
  if (saved && loadedKey && LEGACY_KEYS.includes(loadedKey) && writeKey) localStorage.setItem(writeKey, JSON.stringify(saved));
  audio.muted = localStorage.getItem('tiny-tide-muted') === 'true'; } catch { /* Storage is optional. */ }
let run = saved && !saved.completed ? structuredClone(saved) : freshRun();
let mode: GameMode = 'menu';
startAnalytics('tiny-tide', () => mode === 'playing' || mode === 'evolving');
let keys = new Set<string>();
let stickX = 0, stickZ = 0, stickPointer: number | null = null;
let holdingChomp = false, rising = false, diving = false, chompTapped = false, riseTapped = false;
/** Slot sources (spec §8.1–§8.2): slot buttons, keys 1–4 (keydown taps; readIntent reads held keys) and the right mouse (slot 1). */
let slotHeld: Tuple4<boolean> = [false, false, false, false], slotTapped: Tuple4<boolean> = [false, false, false, false], slotCanceled: Tuple4<boolean> = [false, false, false, false];
/** The desktop pointer (spec §8.4): its last client position, when it last moved over the canvas (ms) and whether it is over the canvas. */
let pointerX = 0, pointerY = 0, pointerAt = -Infinity, pointerOver = false;
/** The mouse buttons (spec §8.1): left holds the basic input, right holds slot 1. `mouseButtonsDown` is the last `buttons` bitmask read;
 *  `mouseLookBit` is the button that drives a mouse camera drag (4 middle, 1 Alt + left; 0 none). */
let mouse: MouseState = NO_MOUSE, mouseButtonsDown = 0, mouseLookBit = 0;
/** The phone (spec §8.4): a drag on the basic button steers the aim; without a drag, auto-aim. `touchMode`: the last game input was a touch
 *  (a pen or touch pointer); the body carries the `touchMode` class while it is on. */
let chompDrag: { id: number; x: number; y: number; aim: Vec3 | null } | null = null, touchMode = false;
function setTouchMode(on: boolean) { if (on !== touchMode) { touchMode = on; document.body.classList.toggle('touchMode', on); } }
let lastIntent: CombatInput = RELEASED;
let target: T.Vector3 | null = null;
let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0;
let toastTimer = 0, uiClock = 0, saveClock = 0, hintClock = 0, respawnClock = 0, stuckRetry = 0, respawnToasted = false;
let regenClock = 0, wrongDietClock = 0, readyToasted = false, lastBiome = '';
/** The one combat runtime of the player. Never cache its fields across frames (resets replace them). */
let rt = newRuntime();
/** The player's authoritative physical position. The rendered root follows it every frame. sim.ts writes it through the `sim` binding;
 *  every write but a rescue glide step cancels a pending rescue (cancelRescue): tests/tiny-tide-core/main-rescue.test.ts. */
let physical: Vec3 = { x: 0, y: 0, z: 0 };
let genomeRevision = 0, acceptedHits = 0, rejectedHits = 0, contactNow = false, lastContact: Constraint | null = null, lastContactSolid: string | null = null, edgeNow = false, edgeHinted = false;
const blockGate = newBlockHintGate(), tapWatch = newTapWatch();
let dialogReturn: 'menu' | 'playing' | 'paused' = 'menu';
const modal = el<HTMLDialogElement>('modal');
world.setCreature(run.genome);
let derived = derive(effectiveStats(run.genome, currentPlan(run)));
/** True while a run that began stuck still owes its start grace to the first successful install. */
let startGracePending = false;
/** sim.ts reads and writes the frame state through these bindings (spec D29), so main.ts keeps its own variables for presentation. */
const sim: SimState = {
  get run() { return run; }, set run(v) { run = v; },
  get rt() { return rt; }, set rt(v) { rt = v; },
  get physical() { return physical; }, set physical(v) { physical = v; },
  get time() { return time; }, set time(v) { time = v; },
  get mode() { return mode; }, set mode(v) { mode = v; },
  get derived() { return derived; }, set derived(v) { derived = v; },
  get genomeRevision() { return genomeRevision; }, set genomeRevision(v) { genomeRevision = v; },
  get chompCooldown() { return cooldown; }, set chompCooldown(v) { cooldown = v; },
  get regenClock() { return regenClock; }, set regenClock(v) { regenClock = v; },
  get respawnClock() { return respawnClock; }, set respawnClock(v) { respawnClock = v; },
  get stuckRetry() { return stuckRetry; }, set stuckRetry(v) { stuckRetry = v; },
  get startGracePending() { return startGracePending; }, set startGracePending(v) { startGracePending = v; },
  get acceptedHits() { return acceptedHits; }, set acceptedHits(v) { acceptedHits = v; },
  get rejectedHits() { return rejectedHits; }, set rejectedHits(v) { rejectedHits = v; },
  ...simOwnedState(),
};
/** What the simulation reads from the page: the world's ecosystem, the cached legality, the start grace and the QA flag. */
const simWorld: SimWorld = { get eco() { return world.eco; }, legality: stage => legality(stage), startGrace: START_GRACE, qa: QA, isOnScreen: p => onScreen(p) };
const refreshDerived = () => simRefreshDerived(sim);
const playerActorCached = (): Actor => simActor(sim);
const capsOf = () => movementCapabilities(currentPlan(run));
/** Food guidance (spec §3, T-R3-17, T-R3-24): one cache entry per entity, recomputed by a fair round-robin queue
 *  of at most GUIDE_PER_FRAME entries per frame. A missing or stale entry is unknown and is not shown. Bites never use it. */
const GUIDE_PER_FRAME = 8;
const guideCache = new Map<number, { key: string; value: boolean }>();
let guideScope = '', guideCursor = 0;
/** The traversal for approach: an active permit, else a hypothetical Breach when the plan can Breach, else none. */
function guideTraversal(): { key: string; traversal: Traversal } {
  if (rt.permit) return { key: `p${rt.permit.expiresAt}`, traversal: { kind: 'active', permit: rt.permit, now: time } };
  if (capsOf().breach) return { key: 'hb', traversal: { kind: 'hypothetical-breach', now: time } };
  return { key: 'n', traversal: { kind: 'none' } };
}
/** Positions are rounded in stage-local units, so a moving food keeps its key at every stage. */
function guideKey(e: Entity, planId: string, growth: number, traversalKey: string) {
  const size = SIZES[run.stage]!;
  return `${Math.round(e.x / size)}:${Math.round(e.y / size)}:${Math.round(e.z / size)}:${planId}:${genomeRevision}:${Math.round(growth * 20)}:${traversalKey}`;
}
/** Recomputes up to GUIDE_PER_FRAME missing or stale entries, continuing from where the last frame stopped. */
function stepGuideCache(actor: Actor) {
  const plan = currentPlan(run), scope = `${plan.id}:${genomeRevision}:${run.stage}`;
  if (scope !== guideScope) { guideCache.clear(); guideScope = scope; guideCursor = 0; }
  const foods = world.edibleFoods; if (foods.length === 0) return;
  const growth = growthOf(run), { key: traversalKey, traversal } = guideTraversal(), mode = movement(plan.movement).mode;
  const bite = { stage: run.stage, growth, reach: derived.reach }, ctx = { ...legality(run.stage), traversal };
  let recomputed = 0;
  for (let n = 0, start = guideCursor % foods.length; n < foods.length && recomputed < GUIDE_PER_FRAME; n++) {
    const i = (start + n) % foods.length, e = foods[i]!.entity, key = guideKey(e, plan.id, growth, traversalKey);
    if (guideCache.get(e.id)?.key === key) continue;
    // Own-tier food: radius 0, as the live bite uses.
    guideCache.set(e.id, { key, value: canApproachFood(actor, mode, { x: e.x, y: e.y, z: e.z, radius: 0 }, bite, ctx) });
    recomputed++; guideCursor = i + 1;
  }
}
/** true or false from a fresh entry; null when the entry is missing or stale (unknown). */
function approachable(e: Entity): boolean | null {
  const entry = guideCache.get(e.id); if (!entry) return null;
  return entry.key === guideKey(e, currentPlan(run).id, growthOf(run), guideTraversal().key) ? entry.value : null;
}
/** The rendered root follows the simulation: position, yaw on the root, pitch on the avatar. */
function renderRoot() {
  world.player.position.set(physical.x, physical.y, physical.z).divideScalar(world.scale);
  world.player.rotation.y = rt.orientation.yaw; world.avatar.rotation.x = -rt.orientation.pitch;
}
/** Read-only (QA): the installed pose is admitted. */
const admittedNow = (actor: Actor) => simAdmitted(sim, simWorld, actor);
/** Writes the run to the write key only. A kept, unreadable or legacy key is never written. */
function save() { try { if (writeKey) localStorage.setItem(writeKey, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
function clearInput() { chompDrag = null; slotHeld = [false, false, false, false]; slotTapped = [false, false, false, false]; slotCanceled = [false, false, false, false]; mouse = NO_MOUSE; mouseButtonsDown = 0; mouseLookBit = 0; combatHud.buttons.forEach(b => b.classList.remove('pressed')); keys.clear(); holdingChomp = false; rising = false; diving = false; chompTapped = false; riseTapped = false; lastIntent = RELEASED; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
function syncSound() { el('sound').innerHTML = audio.muted ? icons.mute : icons.sound; el('sound').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound'); el('sound').setAttribute('aria-pressed', String(audio.muted)); }
syncSound();
function syncHome() {
  const resume = saved && !saved.completed;
  el('start').innerHTML = resume ? `Keep munching ${icons.arrow}` : `Let’s eat ${icons.arrow}`; el('fresh').hidden = !resume;
  el('home-name').innerHTML = `${escapeHtml(run.name.toLowerCase())}<br><small>${resume ? `${STAGES[run.stage]!.title.toLowerCase()} and still hungry.` : 'big things start small.'}</small>`;
  syncNotes();
}
/** Kept-save message, run notices and the archive on the home screen. Everything comes from the save. */
function syncNotes() {
  const notes: string[] = [], notices = saved?.notices ?? [], original = saved?.archive[0];
  if (keptMessage) notes.push(`<p class="home-note kept" role="status">${escapeHtml(keptMessage)}</p>`);
  if (unsavable) notes.push('<p class="home-note kept" role="status">Your saved adventure could not be read. It is kept untouched, but this adventure will not be saved.</p>');
  if (notices.length) notes.push(`<div class="home-note away"><div class="eyebrow">WHILE YOU WERE AWAY</div><ul>${notices.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul><button id="notices-ok" class="text-button">Got it</button></div>`);
  if (original) notes.push(`<button id="view-original" class="text-button">View your original ${escapeHtml(original.name)}</button>`);
  const box = el('home-notes'); box.innerHTML = notes.join(''); box.hidden = notes.length === 0;
  if (notices.length) el('notices-ok').onclick = clearNotices;
  if (original) el('view-original').onclick = viewOriginal;
}
/** "Got it": the notices go away and the save without them goes to the write key. */
function clearNotices() {
  if (!saved) return;
  saved.notices = []; run.notices = [];
  try { if (writeKey) localStorage.setItem(writeKey, JSON.stringify(saved)); } catch { /* Continue without saving in private contexts. */ }
  syncNotes();
}
function viewOriginal() {
  const original = saved?.archive[0]; if (!original) return;
  const paint = original.genome.paint, swatch = (label: string, color: string) => `<span class="paint-swatch"><i style="background:${escapeHtml(color)}"></i>${label}</span>`;
  dialogReturn = 'menu';
  // A WebGL failure in the preview still opens the archive (without the picture).
  let preview = ''; try { preview = renderPreview(original.genome, 160); } catch { /* no preview */ }
  showDialog(`${preview ? `<img class="archive-preview" width="160" height="160" alt="${escapeHtml(original.name)} preview" src="${preview}">` : ''}<div class="eyebrow">YOUR ORIGINAL DESIGN</div><h2 id="modal-title">${escapeHtml(original.name)}</h2><p>${escapeHtml(original.reason)}</p><div class="archive-paint">${swatch('Base', paint.base)}${swatch('Belly', paint.belly)}${swatch('Accent', paint.accent)}<span class="paint-swatch">${escapeHtml(paint.pattern)}</span></div><button id="copy-design" class="primary">Copy design</button><button id="close-original" class="text-button">Close</button>`);
  el('close-original').onclick = closeDialog;
  el('copy-design').onclick = async () => {
    const button = el('copy-design');
    try { await navigator.clipboard.writeText(JSON.stringify(original)); button.textContent = 'Copied!'; }
    catch { button.textContent = 'Copy failed'; }
  };
}
function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }
syncHome();
/** What the toast on screen is (T22 fix round 1): the first wind-up hint may replace a 'hint' toast (block, edge, wrong diet, first-time
 *  hints) or the 'stage' text (the objective pill repeats it), never a 'message' (parts, evolve, survivals, stuck, respawn, warnings). */
let toastKind: 'hint' | 'stage' | 'message' = 'message';
/** Shows a toast for 4.5 s. `icon`: a move whose slot icon follows the last use of `iconAfter` in the text (a phone move hint). */
function toast(message: string, kind: 'hint' | 'stage' | 'message' = 'message', icon: { kind: MoveKind; after: string } | null = null) {
  const t = el('toast'), at = icon ? message.lastIndexOf(icon.after) : -1;
  if (icon && at >= 0) {
    const end = at + icon.after.length, mark = document.createElement('span');
    mark.className = 'hint-icon'; mark.innerHTML = MOVE_ICONS[icon.kind];   // our own static SVG
    t.replaceChildren(message.slice(0, end), mark, message.slice(end));
  } else t.textContent = message;
  t.classList.add('show'); toastTimer = 4.5; toastKind = kind;
}
/** The float-up animation's rise (style.css `float-up`: 65 px) plus half a floater's height. */
const FLOATER_RISE = 65 + 18;
function floater(text: string, x: number, y: number, kind = '', colour?: string) {
  // A floater rises FLOATER_RISE px: it starts low enough never to cover the HUD band, the hint pill or the alpha bar (T17 fix round 1).
  const label = document.createElement('span'); label.className = `bite-floater ${kind}`; label.textContent = text; label.style.left = `${x}px`; label.style.top = `${Math.max(y, hudBand() + FLOATER_RISE)}px`;
  if (colour) label.style.color = colour;
  el('floaters').append(label); setTimeout(() => label.remove(), 950);
}
/** Hearts with half steps (spec §10.1). */
function syncHearts() {
  const max = derived.maxHealth, health = run.health;
  el('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i + 1 <= health ? 'full' : i + .5 <= health ? 'half' : ''}">${heart}</i>`).join('');
  el('hearts').setAttribute('aria-label', `${health} of ${max} hearts`);
}
/** A combat kill: the DNA floater (none for a herbivore: it drove the creature off) and a found part. */
function presentKill(e: Entity, dna: number, drop: string | null) {
  const food = world.foods.find(f => f.entity === e);
  if (food) { const pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z)); if (pos.visible) floater(dna > 0 ? `+${dna} DNA` : 'Driven off!', pos.x, pos.y); }
  if (drop && e.spec.alpha) { toast(`You defeated the ${e.spec.label}! +${dna} DNA and a RARE part: ${part(drop)!.name}.`); audio.found(); }
  else if (drop) { toast(`New part found: ${part(drop)!.name}! Open the editor to use it.`); audio.found(); }
  if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
}
/** The survivor bonus (spec §10.4, D22): a DNA floater at the hunter and a toast. */
function presentSurvived(e: Entity, dna: number) {
  const food = world.foods.find(f => f.entity === e);
  if (food) { const pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z)); if (pos.visible) floater(`+${dna} DNA`, pos.x, pos.y); }
  toast(`You survived the ${e.spec.label}! +${dna} DNA`); syncUI();
}
/** An alpha's phase roar (spec §11.6): a red flash of particles at it and the hint. */
function presentRoar(e: Entity) {
  const food = world.foods.find(f => f.entity === e);
  if (food) world.burst(food.data.x, food.data.y, food.data.z, '#ff4d4d', 30);
  toast(`The ${e.spec.label} is getting angry!`);
}
function syncUI() {
  const stage = STAGES[run.stage]!, diet = dietOf(run.genome);
  el('stage-icon').innerHTML = species[run.stage]!; el('creature-name').textContent = run.name;
  el('size').textContent = `${stage.title.toUpperCase()} · ${stage.size}`;
  const planets = run.stage === 4;
  el('growth-count').textContent = planets ? `${run.eatenPlanets.length} / ${PLANET_COUNT}` : `${Math.floor(Math.min(run.stageDna, stage.goal))} / ${stage.goal}`;
  el('growth-fill').style.width = `${Math.min(100, (planets ? run.eatenPlanets.length / PLANET_COUNT : run.stageDna / stage.goal) * 100)}%`;
  el('growth-label').textContent = planets ? 'ONE UNIVERSE. NO LEFTOVERS.' : 'DNA FOR YOUR NEXT EVOLUTION';
  el('diet').textContent = diet.toUpperCase(); el('diet').dataset.diet = diet;
  el('dna').textContent = String(Math.floor(dnaOf(run)));
  // Controls follow the plan's capabilities, not the stage.
  const caps = capsOf(), action = caps.breach ? 'Breach' : 'Rise';
  el('vertical-controls').hidden = !caps.rise && !caps.breach; el('special').hidden = !caps.rise && !caps.breach; el('dive').hidden = !caps.dive;
  el('special-label').textContent = action.toUpperCase(); el('special').setAttribute('aria-label', action);
  const canEvolve = canChooseNextPlan(run, BUILD);
  el('evolve').hidden = !canEvolve || mode !== 'playing'; el('objective').hidden = canEvolve;
  el('objective-text').textContent = objective();
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(node => { const n = Number(node.dataset.stage); node.classList.toggle('active', n === run.stage); node.classList.toggle('done', n < run.stage); });
  document.documentElement.style.setProperty('--stage-color', stage.color);
  syncHearts();
}
function objective() {
  if (run.stage === 4) return 'Float freely. Eat every last planet.';
  if (evolveReady(run) && !canChooseNextPlan(run, BUILD)) return 'Your path ends here for now. Keep eating to grow strong.';
  // Only species with an approachable instance (a known, fresh guide entry) are named.
  const diet = dietOf(run.genome), reachable = new Set(world.edibleFoods.filter(f => approachable(f.entity) === true).map(f => f.entity.spec.key));
  const foods = tierSpecies(run.stage).filter(s => dietCanEat(diet, s.tag) && reachable.has(s.key)).map(s => s.label.toLowerCase());
  if (foods.length === 0) return 'Explore to find a snack you can reach.';
  const list = foods.length > 3 ? `${foods.slice(0, 3).join(', ')} & more` : foods.join(' & ');
  const caps = capsOf(), move = caps.breach ? 'Breach for gulls!' : caps.rise ? 'Rise / Dive to explore.' : 'Graze along the seabed.';
  return `Eat ${list}. ${run.stage === 0 ? (coarsePointer() ? 'Swipe the world to look around.' : 'Middle-drag the world to look around.') : run.stage === 3 ? 'Watch out for seaplanes.' : move}`;
}
function begin(fresh = false) {
  audio.init();
  const next = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
  world.build(next.stage, next); el('evolution-banner').hidden = true; el('faint').hidden = true; clearInput(); readyToasted = evolveReady(next); lastBiome = '';
  hintClock = 0; blockGate.blockedFor = 0; blockGate.shown = false; contactNow = false; lastContact = null; lastContactSolid = null; edgeNow = false; edgeHinted = false;
  el('home').hidden = true; el('game-ui').hidden = false; el('pause').hidden = false; el('edit').hidden = false; el('corner-note').hidden = true; el('mode-label').textContent = 'NIBBLE. GROW. REPEAT.';
  document.body.classList.add('is-playing'); toast(stageDescription(next.stage, movementCapabilities(currentPlan(next))), 'stage');
  // A pending respawn ignores the forced spawn (it stays for the next start).
  const forced = next.pendingRespawn ? null : forcedSpawn; if (!next.pendingRespawn) forcedSpawn = null;
  respawnToasted = false;
  presentSim(simBegin(sim, simWorld, next, forced), 0);
  // QA, once per page load: the alpha health, then the encounter in front of the player.
  if (qaAlpha !== null) { qaAlphaHealth(simWorld, qaAlpha); qaAlpha = null; }
  if (qaEncounterKey !== null && mode === 'playing') { qaEncounterId = qaEncounter(sim, simWorld, qaEncounterKey); qaEncounterKey = null; }
  if (qaCrowdKeys !== null && mode === 'playing') { qaCrowdIds = qaCrowd(sim, simWorld, qaCrowdKeys); qaCrowdKeys = null; }
  syncUI(); save();
  if (qaHoldStart) { qaHoldStart = false; holdingStart = true; }
}
/** QA (`?qaHoldStart=1`): true from the first start until the first real key or pointer press in play. */
let holdingStart = false;
addEventListener('keydown', () => { if (mode === 'playing') holdingStart = false; }, { capture: true });
addEventListener('pointerdown', () => { if (mode === 'playing') holdingStart = false; }, { capture: true });
function showDialog(content: string, closable = true) { clearInput(); el('modal-content').innerHTML = content; el('close-modal').hidden = !closable; if (!modal.open) modal.showModal(); }
function closeDialog() { modal.close(); if (mode === 'paused') mode = dialogReturn === 'playing' ? 'playing' : 'menu'; clearInput(); syncUI(); }
function pause() {
  if (mode !== 'playing') return;
  simSuspend(sim, 'paused'); dialogReturn = 'playing'; save();
  showDialog(`<span class="modal-art">${species[run.stage]}</span><div class="eyebrow">TAKE A LITTLE BREATHER</div><h2 id="modal-title">Small pause.<br>Big dreams.</h2><p>Your little adventure is saved.<br>The snacks will wait for you.</p><button id="resume" class="primary">Keep munching ${icons.play}</button><button id="restart" class="text-button">Start a fresh adventure</button>`);
  el('resume').onclick = closeDialog; el('restart').onclick = confirmRestart;
}
function confirmRestart() {
  showDialog(`<span class="modal-art">${species[0]}</span><div class="eyebrow">BACK TO THE SHALLOWS</div><h2 id="modal-title">A fresh little start?</h2><p>This replaces your saved adventure.<br>You get a new world and a tiny new creature.</p><button id="confirm-restart" class="primary">Start fresh ${icons.arrow}</button><button id="cancel-restart" class="text-button">Keep my adventure</button>`);
  el('confirm-restart').onclick = () => { modal.close(); begin(true); }; el('cancel-restart').onclick = closeDialog;
}
function help() {
  if (mode === 'evolving' || mode === 'won' || mode === 'editing' || mode === 'fainted' || mode === 'stuck') return;
  dialogReturn = mode === 'playing' || mode === 'paused' ? 'playing' : 'menu'; if (mode === 'playing') simSuspend(sim, 'paused');
  showDialog(`<div class="eyebrow">A RECIPE FOR BIG THINGS</div><h2 id="modal-title">Follow your tummy.</h2><p>Eat to earn DNA. Spend DNA on new parts. Grow from a speck to a cosmic giant.</p><div class="help-rows"><div><span>01</span><div><strong>A little wander</strong><p>Drag the left joystick or use WASD / arrow keys. ${coarsePointer() ? 'Swipe the world to turn the camera.' : 'Aim with the mouse; middle-drag (or Alt + drag) the world to turn the camera.'} While swimming or flying, push forward to travel in the direction you’re looking.</p></div></div><div><span>02</span><div><strong>A little nibble</strong><p>Get close to food and hold Chomp or Space. Your mouth sets your diet: herbivores eat plants, carnivores eat meat, omnivores eat both for less DNA.</p></div></div><div><span>03</span><div><strong>A little danger</strong><p>Red <b>!</b> ${helpDangerText(coarsePointer())}</p></div></div><div><span>04</span><div><strong>A whole new you</strong><p>Tap the pencil to edit your creature at any time. When the DNA bar is full, tap Evolve, pick new parts, and grow right where you are. Eat every planet to finish.</p></div></div></div><button id="got-it" class="primary">Got it. Let’s snack. ${icons.arrow}</button>`);
  el('got-it').onclick = closeDialog;
}
async function edit(kind: 'edit' | 'evolve') {
  if (mode !== 'playing' || (kind === 'evolve' && !canChooseNextPlan(run, BUILD))) return;
  simSuspend(sim, 'editing'); clearInput(); save(); el('game-ui').classList.add('dimmed');
  if (kind === 'evolve') await chooseEvolution(); else await editDesign();
  el('game-ui').classList.remove('dimmed');
  // A committed evolution is already transforming (mode 'evolving').
  if ((mode as GameMode) === 'editing') { mode = 'playing'; save(); }
  syncUI();
}
/** The path screen, then the evolve editor. Cancel in the editor returns to the path screen; "Not yet" returns to play. */
async function chooseEvolution() {
  const current = currentPlan(run);
  const choices: PathChoice[] = eligibleChildren(run.plans, BUILD).map(plan => {
    const adaptation = adaptToPlan(run.genome, plan, { unlocked: run.unlocked, anchorCheck: BUILD.anchorCheck }, run.nextPartSerial);
    return { plan, adaptation, quote: adaptation.ok ? quoteDesign(run.economy, run.genome, adaptation.genome) : null, leadsTo: leadsTo(plan, run.plans, BUILD), summary: cardSummary(current, plan, run.plans) };
  });
  for (;;) {
    const id = await openPathScreen({ current, choices, genome: run.genome });
    const chosen = id === null ? undefined : choices.find(c => c.plan.id === id);
    if (!chosen) return;
    const a = chosen.adaptation;
    // The diet is free while evolving; the ledger prices the draft against the committed design.
    const result = await openEditor({ genome: a.ok ? a.genome : run.genome, original: run.genome, changes: a.ok ? a.changes : [], name: run.name, plan: chosen.plan, unlocked: run.unlocked,
      economy: run.economy, mode: 'evolve', nextSerial: Math.max(run.nextPartSerial, a.ok ? a.nextSerial : 0), build: BUILD, loadout: run.loadout,
      onSubmit: async r => qaRejection() ?? submitEvolution(chosen.plan, r), catalog: CATALOG });
    if (result) return;
  }
}
/** Prepares, places and commits an evolution with no await in between (Prepared's economy is trusted at commit). */
function submitEvolution(next: BodyPlan, r: EditorResult): SubmitOutcome {
  const prepared = prepareEvolution(run, next.id, r.genome, r.name, BUILD, r.nextSerial, CATALOG, r.loadout);
  if (!('planId' in prepared)) return { ok: false, reason: prepared.reason };
  const nextActor = playerActor(next, prepared.genome, next.size, 1), nextLegality = legality(next.size), anchor = startAnchor(nextActor, next.size, nextLegality);
  const destination = evolutionDestination(nextActor, physical, { ...nextLegality, orientation: { yaw: rt.orientation.yaw, pitch: 0 }, time }, anchor.ok ? anchor.position : physical);
  if (!destination.ok) return { ok: false, reason: "This body can't fit anywhere here." };
  commitEvolution(run, prepared, CATALOG); simEvolve(sim, destination); startTransformation(destination.position);
  return { ok: true };
}
/** The edit editor. A failed commit keeps the editor open with the reason. */
async function editDesign() {
  let committed = false;
  await openEditor({ genome: run.genome, original: run.genome, changes: [], name: run.name, plan: currentPlan(run), unlocked: run.unlocked, economy: run.economy, mode: 'edit',
    diet: run.diet, nextSerial: run.nextPartSerial, build: BUILD, loadout: run.loadout, catalog: CATALOG,
    onSubmit: async r => {
      const rejected = qaRejection(); if (rejected) return rejected;
      const before = run.genome, oldLoadout = structuredClone(run.loadout);
      const applied = applyDesign(run, r.genome, r.name, BUILD, r.nextSerial, CATALOG, r.loadout);
      if (!applied.ok) return { ok: false, reason: applied.reason };
      // Cooldowns are action-clock times (spec §5.1); the action clock is stopped while editing.
      reconcileAfterCommit(rt, designDelta(before, run.genome, oldLoadout, CATALOG), run.genome, 'player', rt.actionClock); genomeRevision++; refreshDerived(); committed = true;
      if (JSON.stringify(before) !== JSON.stringify(run.genome)) { world.setCreature(run.genome); world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#f4e2b9', 30); audio.found(); }
      return { ok: true };
    } });
  if (!committed) return;
  mode = 'playing'; save();
  const events: SimEvent[] = []; checkPose(sim, simWorld, playerActorCached(), events); presentSim(events, 0);
}
function startTransformation(destination: Vec3) {
  mode = 'evolving'; clearInput(); audio.evolve(); save();
  const stage = STAGES[run.stage]!;
  world.transform(run.stage, run.genome, destination); world.player.rotation.y = rt.orientation.yaw; world.avatar.rotation.x = -rt.orientation.pitch; syncUI();
  el('evolution-icon').innerHTML = species[run.stage]!;
  el('evolution-name').textContent = `${run.name}, ${stage.title.toLowerCase()}`;
  el('evolution-detail').textContent = 'Same little soul. A bigger world to eat.';
  el('evolution-banner').hidden = false;
  readyToasted = false;
}
function win() {
  mode = 'won'; clearInput(); save(); audio.evolve();
  const minutes = Math.floor(run.elapsed / 60), seconds = Math.floor(run.elapsed % 60).toString().padStart(2, '0');
  showDialog(`<span class="modal-art cosmic">${species[4]}</span><div class="eyebrow">THE UNIVERSE WAS DELICIOUS</div><h2 id="modal-title">All full.<br>All yours.</h2><p>${escapeHtml(run.name)} grew from a speck to a cosmic giant.<br>Every planet is eaten. Now, a well-earned nap.</p><div class="win-stats"><div><strong>${Math.floor(run.totalDna)}</strong><span>DNA EARNED</span></div><div><strong>${run.bites}</strong><span>HAPPY BITES</span></div><div><strong>${minutes}:${seconds}</strong><span>YOUR ADVENTURE</span></div></div><button id="play-again" class="primary">One more little adventure ${icons.arrow}</button>`, false);
  el('play-again').onclick = () => { modal.close(); begin(true); };
}
/** Presentation of the simulation's events: the rendered root and camera, hints, sounds, particles, toasts and saves. */
function presentSim(events: readonly SimEvent[], dt: number) {
  renderRoot();
  for (const e of events) {
    switch (e.type) {
      case 'installed': if (e.snap) world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale)); renderRoot(); break;
      // main.ts's enterStuck cleared the input (and lastIntent) when the body got stuck.
      case 'stuck': clearInput(); toast('Stuck — finding you a safe spot…'); break;
      case 'unstuck': el('toast').classList.remove('show'); syncUI(); break;
      case 'step': presentStep(e.result, dt); break;
      case 'chomp': presentChomp(e.result); break;
      case 'regen': syncHearts(); break;
      case 'hurt': presentHurt(e.event, e.fainted, e.lost); break;
      case 'combat': presentCombat(e.tick); break;
      case 'fainted': presentFaint(e.lost); break;
      case 'killed': presentKill(e.entity, e.dna, e.drop); break;
      case 'survived': presentSurvived(e.entity, e.dna); break;
      case 'roar': for (const r of e.entities) presentRoar(r); break;
      case 'respawned': el('faint').hidden = true; save(); syncUI(); toast('You woke up at the start. Eat to grow again.'); break;
      case 'respawn-waiting': if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); } break;
      case 'resume-fainted': showFaintText(null); el('faint').hidden = false; break;   // the loss was taken before the save: not known here
    }
  }
}
/** The player step's presentation: contacts (QA), the block hint, the edge hint and the Breach splashes. */
function presentStep(r: PlayerStepResult, dt: number) {
  const plan = currentPlan(run), legal = legality(run.stage), p = world.player.position, contact = r.contacts[0];
  contactNow = !!contact; frameContacts += r.contacts.length;
  if (contact) { lastContact = contact.constraint; lastContactSolid = contact.solidId ?? null; }
  // A block hint only for a real, sustained block (not a slide), and never over another toast (final review I1).
  if (blockHintDue(blockGate, r, dt, hintClock <= 0 && toastTimer <= 0) && contact) { toast(blockHint(plan, contact), 'hint'); hintClock = 6; }
  // The soft edge: the edge hint shows once per entry into the push zone, rate-limited with the block hints, and only when no other
  // toast is on screen (so a one-shot message is never replaced).
  edgeNow = inEdgeZone(physical, legal.bounds.half);
  if (!edgeNow) edgeHinted = false;
  else if (!edgeHinted && hintClock <= 0 && toastTimer <= 0) { toast(EDGE_HINT, 'hint'); edgeHinted = true; hintClock = 6; }
  if (r.breachStarted) { audio.breach(); world.burst(p.x, world.surface, p.z, '#d6fff1', 22); }
  if (r.arcEnded) world.burst(p.x, world.surface, p.z, '#d6fff1', 18);
}
/** A chomp's presentation (feeding.ts already changed the run and the ecosystem). */
function presentChomp(c: ChompResult) {
  chompPulse = 1;
  if (c.kind === 'miss') {
    audio.tone(170, 0, .065);
    if (c.wrongDiet && wrongDietClock <= 0 && !inCombat()) { toast(`A ${dietOf(run.genome)} can’t eat ${c.wrongDiet.toLowerCase()}. Try another mouth in the editor.`, 'hint'); wrongDietClock = 6; }
    return;
  }
  const food = world.foods.find(f => f.entity === c.entity)!, pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z));
  if (c.entity.spec.hp > 1 || c.entity.spec.tier > run.stage) { audio.bite(run.bites); world.burst(food.data.x, food.data.y, food.data.z, '#ffd9a8', 8); }
  if (c.kind === 'bitten') { floater(`-${c.damage}`, pos.x, pos.y, 'hit'); return; }
  if (c.drop) { toast(`New part found: ${part(c.drop)!.name}! Open the editor to use it.`); audio.found(); }
  world.removeFood(food); audio.bite(run.bites);
  if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
  floater(c.dna > 0 ? `+${c.dna} DNA` : ['yum!', 'nom!', '♡'][run.bites % 3]!, pos.x, pos.y);
  syncUI(); save();
  if (c.won) { win(); return; }
  if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
}
/** One accepted hazard hit (the simulation already applied it and, at 0 hearts, began the respawn). */
function presentHurt(event: EcoEvent, fainted: boolean, lost: number) {
  world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
  const pos = world.screenPoint(world.player.position.clone().add(new T.Vector3(0, 1.4, 0)));
  floater(damageText('hit', 'half-heart', damageAfterArmor(event.damage, derived.armor)), pos.x, pos.y, 'hurt');
  syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
  if (!fainted) { if (run.health <= 2) toast(`${event.entity.spec.label} is winning! Get away to heal.`); return; }
  presentFaint(lost);
}
/** The faint overlay's text: the true loss, or a neutral line when it is not known (null). */
function showFaintText(lost: number | null) {
  const m = faintMessage(lost), title = document.createElement('strong'), line = document.createElement('span');
  title.textContent = m.title; line.textContent = m.line; el('faint').replaceChildren(title, line);
}
/** A faint (the simulation already began the respawn): save at once, clear the input (main.ts's takeHit did), then the overlay with the
 *  true loss: the at-risk wallet and part credit the faint took (spec §10.3, T15 fix round 1). */
function presentFaint(lost: number) {
  showFaintText(lost);
  save(); respawnToasted = false;
  clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
}
/** One combat tick's hit feel (spec §9.2): floaters (a number only above 0, else a word; T8 carry), impact particles, one sound per outcome,
 *  the hurt flash, camera shake (none under reduced motion), vibration, hearts, and the removed bodies of kills. Hit-stop itself is
 *  simulation state (the resolver set both actors' hitStopUntil); presentCombatView only shows it as frozen animation. */
function presentCombat(t: CombatTick) {
  for (const e of t.events) {
    const local = new T.Vector3(e.point.x, e.point.y, e.point.z).divideScalar(world.scale), pos = world.screenPoint(local);
    const toPlayer = e.targetId === PLAYER_ID, fromPlayer = e.attackerId === PLAYER_ID, text = floaterText(e.outcome, e.unit, e.amount);
    if (text && pos.visible) { const cls = floaterClass(e.attackerId, e.targetId); floater(text, pos.x, pos.y, `${toPlayer ? 'hurt' : 'hit'} ${cls}`, FLOATER_COLOURS[cls]); }
    const colour = e.outcome === 'countered' ? IMPACT_COLOURS.counter : e.outcome === 'blocked' || e.outcome === 'guard-broken' ? IMPACT_COLOURS.block : toPlayer ? IMPACT_COLOURS.hurt : IMPACT_COLOURS.hit;
    if (e.outcome !== 'evaded' && e.outcome !== 'immune' ) world.impact(local.x, local.y, local.z, colour, IMPACT_PARTICLES);
    if (e.status === 'inked') world.impact(local.x, local.y, local.z, EFFECTS.ink!.particles, 24);   // the ink cloud (pooled particles)
    if (e.outcome === 'hit') { if (toPlayer) audio.hurt(); else audio.hit(); }
    else if (e.outcome === 'blocked') audio.block(); else if (e.outcome === 'guard-broken') audio.guardBreak(); else if (e.outcome === 'countered') audio.counter();
    else if (e.outcome === 'grabbed') audio.grab(); else if (e.outcome === 'evaded') audio.dash();
    if (toPlayer && e.amount > 0) {
      world.flash('player', FLASH_SECONDS); syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
      world.shakeBy(shakeForPlayerHit(e.amount));
      if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
    }
    if (!toPlayer && e.amount > 0) { world.flash(Number(e.targetId.slice(1)), FLASH_SECONDS); if (fromPlayer && typeof navigator.vibrate === 'function') navigator.vibrate(15); }
    // Only the player's Sweep and Counter shake the camera (and hits on the player, above).
    if (fromPlayer && e.outcome === 'hit' && e.attackId.startsWith('sweep')) world.shakeBy(shakeForPlayerStrike(e.amount));
    if (toPlayer && e.outcome === 'countered') world.shakeBy(shakeForPlayerStrike(e.reflect));
  }
  if (t.started.includes('dash')) audio.dash();
  if (t.brokeFree) audio.breakFree();
  for (const k of t.killed) { const food = world.foods.find(f => f.entity === k); if (food) world.removeFood(food); }
  if (t.killed.length) { syncUI(); save(); }
}
/** The bottom of the top HUD band (the stage card, the growth card and the objective), in CSS pixels: world-anchored labels (threat
 *  markers, HP bars) stay below it (T16b live look: over a close crab they sat on the DNA bar and the objective). */
let bandCache = { frame: -1, bottom: 90, alpha: 0 };
function bandNow() {
  if (bandCache.frame !== frameNo) {
    const a = alphaBar.root, r = a.hidden ? null : a.getBoundingClientRect();
    bandCache = { frame: frameNo, bottom: Math.max(90, ...['.stage-card', '.growth-card', '#objective'].map(q => document.querySelector(q)?.getBoundingClientRect().bottom ?? 0)), alpha: r ? r.bottom : 0 };
  }
  return bandCache;
}
/** The top HUD band without the alpha bar (the alpha bar sits just below it). */
const baseBand = () => bandNow().bottom;
/** The top HUD band, the alpha bar included while it shows (T17 live look: labels and HP bars sat on it). */
function hudBand(): number { const b = bandNow(); return Math.max(b.bottom, b.alpha); }
/** The threat marker box (CSS: a 26 px "!" over an 8 px label, translate(-50%, -100%), a 6 px bob): its height in pixels. */
const MARKER_HEIGHT = 52;
/** The bottom of each entity's threat marker this frame (screen pixels): its HP bar goes at least 4 px below it. */
const markerBottoms = new Map<number, number>(), markerXs = new Map<number, number>();
/** Engaged in combat (readability): a combat species has an action at the player, made contact with it, or was damaged by it in the last
 *  3 s. Hints that are not about the fight wait. */
function inCombat(): boolean {
  for (const c of sim.combat.entities.values()) {
    if (c.entity.eaten) continue;
    if (time - c.lastAttackedPlayerAt <= 3 || time - c.lastDamagedAt <= 3 || c.rt.actions.some(a => a.phase !== 'interrupted' && a.targetId === PLAYER_ID)) return true;
  }
  return false;
}
/** A physical point is on screen (the telegraph's edge arrow). */
function onScreen(p: Vec3): boolean {
  const s = world.screenPoint(new T.Vector3(p.x, p.y, p.z).divideScalar(world.scale));
  return s.visible && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight;
}
/** First-time hints (spec §12.3, D30): the moves in the slots, the first wind-up at the player and the first unblockable one. A hint shows
 *  only when no toast is up and no other hint showed in the last 6 s. In a fight only the telegraph hints show (a move hint waits). */
const hints = new Hints((() => { try { return localStorage as HintStorage; } catch { return null; } })());
const TELEGRAPH_HINTS: ReadonlySet<HintId> = new Set<HintId>(['telegraph', 'telegraph-red']);
function offerHints() {
  const touch = touchMode || coarsePointer();
  if (sim.moves) sim.moves.slots.slots.forEach((k, i) => { if (k) hints.request(`move-${k}`, hintText(`move-${k}`, { slot: i, touch })); });
  for (const v of telegraphViews) {
    if (v.phase !== 'windup' || !v.targetsPlayer) continue;
    hints.request('telegraph', hintText('telegraph', { slot: 0, touch }));
    if (v.color === 'red') hints.request('telegraph-red', hintText('telegraph-red', { slot: 0, touch }));
  }
  const fight = inCombat();
  const h = hints.next(time, toastTimer <= 0 && hintClock <= 0, fight ? id => TELEGRAPH_HINTS.has(id) : undefined, toastTimer <= 0 || toastKind !== 'message');
  const kind = h && hintIcon(h.id, touch);
  if (h) { toast(h.text, 'hint', kind ? { kind, after: `${kind[0]!.toUpperCase()}${kind.slice(1)}` } : null); hintClock = 6; }
}
/** The phone layouts (portrait and landscape): the toast always uses the objective's slot there. */
const phoneLayout = matchMedia('(max-width: 650px), (max-height: 560px)');
/** Every played frame (T22, review of D30): a shown toast sits in the objective's slot on a phone and in a fight, so it covers no control, not
 *  the creature and no telegraph near it; elsewhere it keeps its low place. With the Evolve button on screen (the objective is then hidden):
 *  on a phone the toast stays in the objective's slot ABOVE the button, raised so that its bottom is 6 px over the button (fix round 1: below
 *  the button it covered the creature at 320x568 and Dash at 844x390); on a desktop in a fight it goes 8 px below the button (room there). */
/** Final review I9: on a portrait phone the Evolve button stays at least 8 px above the creature's screen box (it is up until tapped), raised
 *  as needed but never onto the stage and growth cards. Landscape places it by CSS (the top band). Every played frame, before placeToast. */
const portraitPhone = matchMedia('(max-width: 650px)');
function placeEvolve() {
  const evolve = el('evolve');
  if (evolve.hidden || !portraitPhone.matches) { evolve.style.removeProperty('top'); return; }
  evolve.style.removeProperty('top');
  const css = evolve.getBoundingClientRect(), creature = creatureBox(); if (!creature || css.bottom + 8 <= creature.top) return;
  const cards = Math.max(document.querySelector('.stage-card')?.getBoundingClientRect().bottom ?? 0, document.querySelector('.growth-card')?.getBoundingClientRect().bottom ?? 0) + 4;
  evolve.style.top = `${Math.round(Math.max(cards, creature.top - 8 - css.height))}px`;
}
function placeToast() {
  const ui = el('game-ui'), t = el('toast'), up = t.classList.contains('show') && (phoneLayout.matches || inCombat());
  t.classList.remove('toast-compact', 'toast-line'); t.removeAttribute('title');
  ui.classList.toggle('toast-top', up); if (!up) return;
  const evolve = el('evolve'), slot = parseFloat(getComputedStyle(el('objective')).top);
  ui.style.removeProperty('--toast-left'); ui.style.removeProperty('--toast-max');
  let top = slot;
  if (!evolve.hidden && !phoneLayout.matches) top = evolve.getBoundingClientRect().bottom + 8;
  else if (phoneLayout.matches) {
    // The toast ends 6 px over the Evolve button and 4 px over the creature's screen box. Full width, it never goes over the stage and growth
    // cards; when it does not fit there (a landscape phone: the cards stand side by side), it narrows to the gap between the cards and may
    // rise to just under the top bar.
    const box = (q: string) => document.querySelector(q)?.getBoundingClientRect();
    // The Evolve button limits the toast only when it sits below the toast's slot (a landscape phone puts it in the top band, beside the toast).
    const eb = evolve.hidden ? null : evolve.getBoundingClientRect(), creature = creatureBox();
    const limit = Math.min(eb && eb.top >= slot ? eb.top - 6 : Infinity, creature ? creature.top - 4 : Infinity);
    const stageCard = box('.stage-card'), growthCard = box('.growth-card');
    const floor = Math.max(stageCard?.bottom ?? 0, growthCard?.bottom ?? 0) + 4;
    top = Math.max(floor, Math.min(slot, limit - t.offsetHeight));
    if (top + t.offsetHeight > limit && stageCard && growthCard && growthCard.left - stageCard.right >= 160) {
      ui.style.setProperty('--toast-left', `${Math.round((stageCard.right + growthCard.left) / 2)}px`);
      ui.style.setProperty('--toast-max', `${Math.round(growthCard.left - stageCard.right - 16)}px`);
      const topBar = box('.topbar')?.bottom ?? 0;
      top = Math.max(topBar + 4, Math.min(slot, limit - t.offsetHeight));
    } else if (top + t.offsetHeight > limit) {
      // Fix round 2: a portrait phone with the Evolve button raised over the creature has a short band under the cards. The toast stays in it
      // and covers no card: first compact (smaller type, the full text), then one line with an ellipsis (the full text in its title).
      t.classList.add('toast-compact');
      if (floor + t.offsetHeight > limit) { t.classList.add('toast-line'); t.title = t.textContent ?? ''; }
      top = floor;
    }
  }
  if (Number.isFinite(top)) ui.style.setProperty('--toast-top', `${Math.round(top)}px`);
}
/** The creature's box on screen (CSS pixels): every capsule of its world hull, ends ± radius on each axis, projected; null when no point is
 *  visible. Read-only (QA `creatureBox()` too). */
function creatureBox(): { left: number; top: number; right: number; bottom: number } | null {
  if (mode === 'menu') return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const c of simWorldHull(sim, playerActorCached())) for (const e of [c.start, c.end]) for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    const v = world.screenPoint(new T.Vector3(e.x + x * c.radius, e.y + y * c.radius, e.z + z * c.radius).divideScalar(world.scale));
    if (!v.visible) continue;
    left = Math.min(left, v.x); right = Math.max(right, v.x); top = Math.min(top, v.y); bottom = Math.max(bottom, v.y);
  }
  return Number.isFinite(top) ? { left, top, right, bottom } : null;
}
/** The alpha bar's content this frame (read-only diagnostics). */
let shownAlpha: AlphaView | null = null;
/** Every frame: telegraph volumes and pose cues, hit-stop freezes, the wind-up tone, HP bars, edge arrows and the break-free prompt.
 *  Reads the simulation only. */
function presentCombatView() {
  const playing = mode === 'playing' || mode === 'fainted' || mode === 'evolving';
  world.reducedMotion = reducedMotion.matches;
  telegraphViews = playing ? sim.combat.telegraphs(time, onScreen, seabedHeight) : [];
  const frozen = new Set<number>(), sunk = new Map<number, number>();
  for (const c of sim.combat.entities.values()) {
    if (time < c.rt.hitStopUntil) frozen.add(c.entity.id);
    // The Clawmother under the sand (spec §11.6): it sinks over the sink time, stays under while it travels, and rises over the emerge wind-up.
    const ai = c.ai, id = c.entity.id;
    if (ai?.name === 'sink') sunk.set(id, Math.min(1, (time - ai.since) / BURROW.sinkSeconds));
    else if (ai?.name === 'burrowed') sunk.set(id, 1);
    else if (ai?.name === 'emerge') { const v = telegraphViews.find(t => t.entityId === id && t.phase === 'windup'); if (v) sunk.set(id, 1 - v.fill); }
  }
  world.setCombatView(telegraphViews, { player: time < rt.hitStopUntil, entities: frozen }, sunk);
  const alpha = shownAlpha = playing ? alphaView(sim.combat.entities.values(), sim.physical) : null;
  if (alpha) alphaBar.root.style.top = `${baseBand() + 8}px`;
  alphaBar.sync(alpha);
  // Inked (spec §11.5): darker screen edges while the status lasts.
  el('game-ui').classList.toggle('inked', playing && rt.status !== null && time < rt.status.until);
  arrowed = arrowMemory.update(telegraphViews);
  audio.windupTones(new Map(telegraphViews.filter(v => v.phase === 'windup' && v.targetsPlayer).map(v => [v.actionId, v.fill])));
  const bars: HpBar[] = [], arrows: EdgeArrow[] = [];
  let band: number | undefined;
  if (playing) for (const c of sim.combat.entities.values()) {
    if (c.entity.eaten || !c.entity.active || time - c.lastDamagedAt > HP_BAR_SECONDS) continue;
    if (alpha && c.entity.spec.alpha) continue;   // the alpha bar shows its HP
    const top = world.screenPoint(new T.Vector3(c.entity.x, c.entity.y + .9 * SIZES[c.entity.spec.tier]!, c.entity.z).divideScalar(world.scale));
    if (!top.visible) continue;
    const below = markerBottoms.get(c.entity.id), bar = { x: top.x, y: Math.max(top.y, (band ??= hudBand()) + 12), fraction: c.entity.hp / c.maxHp };
    if (below !== undefined) { bar.x = markerXs.get(c.entity.id) ?? bar.x; bar.y = Math.max(bar.y, below + 4 + 5); }   // the bar (5 px, bottom-anchored) under its marker
    bars.push(bar);
  }
  for (const v of telegraphViews) if (arrowed.has(v.actionId) && !v.onScreen) {
    const at = edgeArrowAt(world.screenPoint(new T.Vector3(v.centroid.x, v.centroid.y, v.centroid.z).divideScalar(world.scale)), innerWidth, innerHeight);
    arrows.push({ ...at, color: v.color, fill: v.fill });
  }
  overlay.sync(bars, arrows, playing && rt.heldBy !== null ? rt.breakProgress : null);
}
el('start').onclick = () => begin(); el('fresh').onclick = () => { dialogReturn = 'menu'; confirmRestart(); };
el('evolve').onclick = () => void edit('evolve'); el('edit').onclick = () => void edit('edit');
el('sound').onclick = () => { audio.init(); audio.toggle(); syncSound(); try { localStorage.setItem('tiny-tide-muted', String(audio.muted)); } catch { /* Optional preference. */ } };
el('help').onclick = help; el('pause').onclick = pause; el('close-modal').onclick = closeDialog;
modal.addEventListener('cancel', event => { event.preventDefault(); if (mode !== 'evolving' && mode !== 'won') closeDialog(); });
document.querySelector('.brand')!.addEventListener('click', event => { event.preventDefault(); if (mode === 'playing') pause(); });
/** Pointers that ended normally. A capture lost without a pointerup is a cancel. */
const endedPointers = new Set<number>();
function releasedNormally(event: PointerEvent) { return endedPointers.delete(event.pointerId); }
/** Buttons only set input sources; the frame reads one intent from them. `tap` records a press that may end before the next frame. */
function holdButton(id: string, setter: (value: boolean) => void, tap?: () => void, cancel?: () => void) {
  const button = el(id);
  button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); endedPointers.delete(event.pointerId); button.setPointerCapture(event.pointerId); setter(true); tap?.(); button.classList.add('pressed'); audio.init(); });
  const release = () => { setter(false); button.classList.remove('pressed'); };
  button.addEventListener('pointerup', event => { endedPointers.add(event.pointerId); release(); });
  // A touch cancel clears every input source; on a slot button it also marks that slot canceled (Brace ends with no buffered press).
  button.addEventListener('pointercancel', () => { release(); clearInput(); cancel?.(); });
  button.addEventListener('lostpointercapture', event => { release(); if (!releasedNormally(event)) { clearInput(); cancel?.(); } });
  button.addEventListener('click', event => { if (event.detail === 0 && mode === 'playing') tap?.(); });
}
holdButton('chomp', value => holdingChomp = value, () => chompTapped = true);
holdButton('special', value => rising = value, () => riseTapped = true);
holdButton('dive', value => diving = value);
combatHud.buttons.forEach((b, i) => holdButton(b.id, value => slotHeld[i] = value, () => slotTapped[i] = true, () => slotCanceled[i] = true));
// The basic-button drag (spec §8.4): the same press starts the basic move at once; the drag then steers it until the lock, and the next Bites.
const chompButton = el('chomp');
chompButton.addEventListener('pointerdown', event => { if (mode !== 'playing') return; chompDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, aim: null }; });
chompButton.addEventListener('pointermove', event => { if (chompDrag && event.pointerId === chompDrag.id) chompDrag.aim = dragAim(event.clientX - chompDrag.x, event.clientY - chompDrag.y, world.cameraForward()); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) chompButton.addEventListener(type, event => { if (chompDrag?.id === event.pointerId) chompDrag = null; });
// Every game control and the canvas record the device of the last press (touch mode: phone auto-aim; a mouse turns it off).
for (const node of [chompButton, el('special'), el('dive'), el('joystick'), ...combatHud.buttons, world.renderer.domElement])
  node.addEventListener('pointerdown', event => { if (mode === 'playing') setTouchMode(event.pointerType !== 'mouse'); });
const joystick = el('joystick');
function moveStick(event: PointerEvent) {
  const rect = joystick.getBoundingClientRect(), limit = rect.width * .3;
  const dx = event.clientX - rect.left - rect.width / 2, dz = event.clientY - rect.top - rect.height / 2;
  const length = Math.hypot(dx, dz), factor = length > limit ? limit / length : 1;
  stickX = dx * factor / limit; stickZ = dz * factor / limit;
  el('stick').style.transform = `translate(${dx * factor}px, ${dz * factor}px)`; target = null;
}
joystick.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); endedPointers.delete(event.pointerId); stickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveStick(event); });
joystick.addEventListener('pointermove', event => { if (event.pointerId === stickPointer) moveStick(event); });
function stopStick() { stickPointer = null; stickX = 0; stickZ = 0; el('stick').style.transform = ''; }
joystick.addEventListener('pointerup', event => { endedPointers.add(event.pointerId); stopStick(); }); joystick.addEventListener('pointercancel', clearInput);
joystick.addEventListener('lostpointercapture', event => { stopStick(); if (!releasedNormally(event)) clearInput(); });
let lookPointer: number | null = null, lookX = 0, lookY = 0, lookStartX = 0, lookStartY = 0, looked = false;
const canvas = world.renderer.domElement;
// Desktop (spec §8.1, D7): the left mouse is the basic input and the right mouse slot 1; the camera turns with a middle drag or Alt + left drag.
// Touch keeps swipes to look and taps to walk (ground plans).
canvas.addEventListener('contextmenu', event => event.preventDefault());
const notePointer = (event: PointerEvent) => { pointerX = event.clientX; pointerY = event.clientY; pointerAt = performance.now(); pointerOver = true; };
/** Every mouse pointer event goes through here: a chorded press or release arrives as a pointermove (only the first press is a pointerdown
 *  and only the last release a pointerup), so the state is read from the `buttons` bitmask, never from `button` (review fix round 1).
 *  A middle press, or an Alt + left press, starts a camera drag that ends when that button is released. */
function syncMouse(event: PointerEvent) {
  const b = mode === 'playing' ? event.buttons : 0, pressed = b & ~mouseButtonsDown;
  if (mouseLookBit && !(b & mouseLookBit)) mouseLookBit = 0;
  if (!mouseLookBit && lookPointer === event.pointerId) lookPointer = null;   // also after clearInput ended a mouse drag
  if (!mouseLookBit && (pressed & 4 || (pressed & 1 && event.altKey))) {
    mouseLookBit = pressed & 4 ? 4 : 1;
    lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
  }
  const m = mouseButtons(mouse, b, mouseLookBit === 1);
  if (m.basicPressed) chompTapped = true;
  if (m.slot1Pressed) slotTapped[0] = true;
  if (m.basicPressed || m.slot1Pressed) audio.init();
  mouse = { basic: m.basic, slot1: m.slot1 }; mouseButtonsDown = b;
}
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'playing') return;
  endedPointers.delete(event.pointerId);
  if (event.pointerType === 'mouse') {
    notePointer(event); if (event.button === 1) event.preventDefault();   // a middle press does not start the browser's autoscroll
    canvas.setPointerCapture(event.pointerId); syncMouse(event); return;
  }
  lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') pointerOver = false; });
canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'mouse') { notePointer(event); syncMouse(event); }
  if (event.pointerId !== lookPointer || mode !== 'playing') return;
  const dx = event.clientX - lookX, dy = event.clientY - lookY;
  if (Math.hypot(event.clientX - lookStartX, event.clientY - lookStartY) > 5) looked = true;
  if (looked) { world.look(dx, dy); el('look-hint').classList.add('learned'); target = null; }
  lookX = event.clientX; lookY = event.clientY;
});
canvas.addEventListener('pointerup', event => {
  // Every pointer that ends normally is recorded, so its lostpointercapture is not read as a cancel.
  endedPointers.add(event.pointerId);
  if (event.pointerType === 'mouse') { syncMouse(event); return; }   // the mouse never taps to walk (D7)
  if (event.pointerId !== lookPointer) return;
  if (!looked && mode === 'playing' && capsOf().ground) {
    target = world.groundPoint(event.clientX, event.clientY); tapWatch.best = Infinity; tapWatch.stalled = 0;
    if (target) { target.x = T.MathUtils.clamp(target.x, -SPAWN_HALF, SPAWN_HALF); target.z = T.MathUtils.clamp(target.z, -SPAWN_HALF, SPAWN_HALF); world.targetRing.position.copy(target); world.targetRing.position.y = world.groundAt(target.x, target.z) + .08; world.targetRing.scale.setScalar(.45); world.targetRing.visible = true; }
  }
  lookPointer = null;
});
canvas.addEventListener('pointercancel', () => { lookPointer = null; clearInput(); });
canvas.addEventListener('lostpointercapture', event => { lookPointer = null; if (!releasedNormally(event)) clearInput(); });

window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (mode === 'playing') pause(); return; }
  if (mode !== 'playing') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code); setTouchMode(false);
  if (event.code === 'KeyE' && !event.repeat) riseTapped = true;
  if (event.code === 'Space' && !event.repeat) chompTapped = true;
  const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code); if (digit >= 0 && !event.repeat) slotTapped[digit] = true;
  if (event.code === 'KeyP' && !event.repeat) pause();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { clearInput(); if (mode === 'playing') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
window.addEventListener('pagehide', () => { if (mode !== 'menu') save(); });
window.addEventListener('resize', () => world.resize());
function updateGuide() {
  if (mode !== 'playing') { el('food-pointer').hidden = true; el('snack-label').hidden = true; el('threats').innerHTML = ''; return; }
  const p = world.player.position, diet = dietOf(run.genome);
  el('objective-text').textContent = objective();
  const nearest = world.edibleFoods.filter(f => dietCanEat(diet, f.entity.spec.tag) && approachable(f.entity) === true).sort((a, b) =>
    Math.hypot(a.data.x - p.x, a.data.z - p.z) + Math.abs(a.data.y - p.y) * .6 - Math.hypot(b.data.x - p.x, b.data.z - p.z) - Math.abs(b.data.y - p.y) * .6)[0];
  if (nearest) {
    const f = nearest.data;
    const point = world.screenPoint(new T.Vector3(f.x, f.y + 1.4, f.z));
    const near = Math.hypot(f.x - p.x, f.z - p.z) < STAGES[run.stage]!.radius + 1 + derived.reach;
    const caps = capsOf(), out = 'OUT OF REACH';
    const heightHint = f.y - p.y > 2.1 ? caps.breach ? 'BREACH TO REACH!' : caps.rise ? 'HOLD RISE TO REACH' : out : p.y - f.y > 2.1 ? caps.dive ? 'HOLD DIVE TO REACH' : out : 'HOLD CHOMP';
    const label = near ? heightHint : nearest.entity.spec.label.toUpperCase();
    const onscreen = point.visible && point.x > 65 && point.x < innerWidth - 65 && point.y > 200 && point.y < innerHeight - 200;
    // Readability: no "HOLD CHOMP" over the Speck while a fight is on (the marker and the HP bar sit there).
    const fight = inCombat();
    el('snack-label').hidden = !onscreen || fight; el('food-pointer').hidden = onscreen;
    if (onscreen) { el('snack-label').style.left = `${point.x}px`; el('snack-label').style.top = `${point.y}px`; el('snack-label').textContent = label; }
    else {
      const pp = world.screenPoint(p); const dx = (point.x - pp.x) * (point.visible ? 1 : -1), dy = (point.y - pp.y) * (point.visible ? 1 : -1);
      const angle = Math.atan2(dy, dx); const r = Math.min(innerWidth * .31, innerHeight * .27);
      el('food-pointer').style.left = `${innerWidth / 2 + Math.cos(angle) * r}px`; el('food-pointer').style.top = `${innerHeight / 2 + Math.sin(angle) * r}px`;
      el('pointer-arrow').style.transform = `rotate(${angle + Math.PI / 2}rad)`; el('pointer-label').textContent = label;
    }
  } else { el('food-pointer').hidden = true; el('snack-label').hidden = true; }
  // Sense parts let the creature notice hunters from farther away.
  const markers = world.threats.filter(f => Math.hypot(f.data.x - p.x, f.data.y - p.y, f.data.z - p.z) < derived.senseRange).slice(0, 4);
  // A marker (bottom-anchored) stays below the top HUD band with its whole box, and inside the viewport horizontally (its label included).
  const top = markers.length ? hudBand() + MARKER_HEIGHT + 4 : 90;
  markerBottoms.clear(); markerXs.clear();
  // Final review M4 / item i: a marker never sits on the depth label or the growth card ("DNA FOR YOUR NEXT EVOLUTION").
  const keepOut = markers.length ? (['depth-label', 'growth-card'] as const).map(id => (id === 'growth-card' ? document.querySelector('.growth-card') : el(id))?.getBoundingClientRect())
    .filter((b): b is DOMRect => !!b && b.width > 0) : [];
  el('threats').innerHTML = markers.map(f => {
    const point = world.screenPoint(new T.Vector3(f.data.x, f.data.y + (f.tier > run.stage ? 4 : 1.6), f.data.z)), half = Math.max(16, f.entity.spec.label.length * 3.4 + 6);
    const x0 = T.MathUtils.clamp(point.visible ? point.x : innerWidth - point.x, half + 4, innerWidth - half - 4), y0 = T.MathUtils.clamp(point.visible ? point.y : innerHeight - 60, Math.min(top, innerHeight - 60), innerHeight - 60);
    const { x, y } = avoidKeepOut(x0, y0, half, MARKER_HEIGHT, keepOut, { minX: half + 4, maxX: innerWidth - half - 4, minY: Math.min(top, innerHeight - 60), maxY: innerHeight - 60 });
    markerBottoms.set(f.entity.id, y); markerXs.set(f.entity.id, x);
    return `<span class="threat ${point.visible ? '' : 'edge'}" style="left:${x}px;top:${y}px">!<small>${f.entity.spec.label.toUpperCase()}</small></span>`;
  }).join('');
}
const NO_WISH: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
/** The live combat species of the combat tiers (the stage and the stage + 1), as world objects. */
const combatFoods = () => world.foods.filter(f => f.entity.active && !f.entity.eaten && f.tier >= run.stage && f.tier <= run.stage + 1 && sim.combat.stateOf(f.entity) !== null);
/** Phone auto-aim (spec §8.4): the combat species within 3 × the Bite range and 60° of the facing (180° for an attacker in wind-up while
 *  Brace is up, review R16), by rank then distance; null with none, while inked, or with no Bite. Render units. */
function phoneAutoAim(p: Vec3, facing: Vec3): Vec3 | null {
  const bite = sim.moves?.set.basic?.resolved.attack, inked = rt.status !== null && time < rt.status.until;
  if (!bite || bite.shape.kind !== 'cone' || inked) return null;
  const reach = 3 * bite.shape.range * playerActorCached().bodyLength / world.scale;
  const bracing = rt.actions.some(a => a.resolved.guard?.kind === 'brace' && (a.phase === 'windup' || a.phase === 'active'));
  const candidates: AimCandidate[] = combatFoods().flatMap(f => {
    const c = sim.combat.stateOf(f.entity); if (!c) return [];
    const windup = c.rt.actions.some(a => a.phase === 'windup' && a.targetId === PLAYER_ID), type = c.behaviour.type;
    if (bracing && !windup) return [];   // a bracing player turns only toward an attack (else toward the move stick)
    return [{ position: f.data, rank: windup ? 0 : type === 'prey-flee' || type === 'prey-school' ? 2 : 1 }];
  });
  return autoAim(p, facing, candidates, reach, bracing ? BRACE_AUTO_AIM_HALF_ANGLE : undefined);
}
/** The combat species under the desktop pointer (spec §8.4, final review C1): the nearest hurtbox the pointer ray meets, else the nearest
 *  hull centre within 48 CSS px of the pointer. Its hull centre (physical units), or null. */
let lastAimPick: Vec3 | null = null;
function pointerPick(): Vec3 | null {
  const ray = world.pointerRay(pointerX, pointerY), k = world.scale, origin = { x: ray.origin.x * k, y: ray.origin.y * k, z: ray.origin.z * k };
  const candidates: PickCandidate[] = combatFoods().flatMap(f => {
    if (sim.combat.stateOf(f.entity)?.rt.targetable === false) return [];
    const e = f.entity, h = speciesActor(e).hull[0]!, centre = { x: e.x + h.start.x, y: e.y + h.start.y, z: e.z + h.start.z };
    const sp = world.screenPoint(new T.Vector3(centre.x / k, centre.y / k, centre.z / k));
    return [{ centre, spheres: [{ ...centre, r: h.radius }], screen: sp.visible ? { x: sp.x, y: sp.y } : null }];
  });
  return pickAimTarget(origin, ray.dir, candidates, { x: pointerX, y: pointerY });
}
/** The aim (spec §8.4): a phone drag on the basic button; else the desktop pointer while it is over the canvas (moving or still): the combat
 *  species under it, else where its ray meets the seabed, a solid or the
 *  player's height plane beyond the player (never a point behind the player: review C1); else on a phone auto-aim (or the facing, source
 *  none); else the camera forward. Free movers pitch toward a pick or a soft-lock target (D9); ground movers aim level. Render units:
 *  only directions leave this function. */
function currentAim(caps: { pitch: boolean }): { aim: Vec3; source: AimSource } {
  // Fix round 3 (re-review Minor 2): the pointer counts while it is over the canvas, moving or still (no drift to the camera forward).
  const p = world.player.position, fresh = pointerOver && pointerAt > -Infinity;
  let flat: Vec3 | null = null, source: AimSource = 'camera'; lastAimPick = null;
  if (chompDrag?.aim) { flat = chompDrag.aim; source = 'drag'; }
  else if (pointerOver && !touchMode) {
    const pick = lastAimPick = pointerPick(), toward = pick && aimToward(physical, pick, caps.pitch, PITCH_LIMIT);
    if (toward) return { aim: toward, source: 'pointer' };
  }
  if (!flat && fresh) {
    const ray = world.pointerRay(pointerX, pointerY), k = world.scale, q = legality(run.stage).queries, at = { x: 0, y: 0, z: 0 };
    const blocked = (r: Vec3) => { at.x = r.x * k; at.y = r.y * k; at.z = r.z * k; return q.segmentClear?.(at, at, 1) === false; };
    flat = pointerAim(p, ray.origin, ray.dir, blocked, 16 * playerActorCached().bodyLength / k); if (flat) source = 'pointer';
  }
  else if (!flat && touchMode) {
    const facing = forwardOf({ yaw: rt.orientation.yaw, pitch: 0 }), auto = phoneAutoAim(p, facing);
    if (!auto) return { aim: facing, source: 'none' };   // review R16: a bracing player then turns toward the move stick
    const h = Math.hypot(auto.x, auto.z); if (h < 1e-9) return { aim: facing, source: 'none' };
    const level = { x: auto.x / h, y: 0, z: auto.z / h };
    return { aim: caps.pitch ? pitched(level, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(auto.y, h)))) : level, source: 'auto' };
  }
  flat ??= world.cameraForward();
  if (!caps.pitch) return { aim: flat, source };
  return { aim: pitched(flat, aimPitch(p, flat, combatFoods().map(f => f.data), rt.orientation.pitch, PITCH_LIMIT)), source };
}
/** The aim chevron (spec §8.4): 1 L along the aim while a combat species is within 4 L (physical units in, render units to the world). */
function syncAimChevron(intent: CombatInput) {
  if (mode !== 'playing') { world.showAimChevron(null, NO_WISH, 0); return; }
  const L = playerActorCached().bodyLength, aim = intent.aim ?? forwardOf(rt.orientation);
  const at = aimChevron(physical, aim, L, combatFoods().map(f => f.entity));
  world.showAimChevron(at && { x: at.x / world.scale, y: at.y / world.scale, z: at.z / world.scale }, aim, L / world.scale);
}
let frameNo = 0;
function frame(now: number) {
  requestAnimationFrame(frame); frameNo++;
  const dt = Math.min((now - last) / 1000, .05); last = now;
  if (admissionClock.on) { resetAdmissionClock(); admissionClock.caller = 'player'; frameContacts = 0; }
  // The game clock runs in these modes only (not while paused, editing, stuck or won); sim.ts decides it the same way.
  const held = holdingStart && mode === 'playing', playing = mode === 'playing' && !held;
  const active = !held && (mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted');
  const stage = run.stage, caps = capsOf(), growth = growthOf(run);
  let intent = lastIntent, wish: Vec3 = NO_WISH, moving = false;
  if (playing) {
    chompPulse = Math.max(0, chompPulse - dt * 5); wrongDietClock = Math.max(0, wrongDietClock - dt); hintClock = Math.max(0, hintClock - dt);
    // One input consumer: one intent per frame, then the tap flags are spent.
    const aim = currentAim(caps);
    intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp || mouse.basic, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving, aim: aim.aim, aimSource: aim.source,
      activeTapped: slotTapped, activeHeld: [slotHeld[0] || mouse.slot1, slotHeld[1], slotHeld[2], slotHeld[3]], activeCanceled: slotCanceled }, lastIntent, { breachOnRiseTap: caps.breach });
    chompTapped = false; riseTapped = false; slotTapped = [false, false, false, false]; slotCanceled = [false, false, false, false]; lastIntent = intent;
    const p = world.player.position;
    if (Math.abs(intent.move.x) + Math.abs(intent.move.z) > .05) { target = null; world.targetRing.visible = false; }
    if (target && caps.ground) {
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
      // Reached, or no progress for a second (a tall rock or an arch in the way: those are walls): the target is dropped.
      if (d < .25 || tapTargetStalled(tapWatch, d, dt)) { target = null; world.targetRing.visible = false; } else wish = { x: dx / d, y: 0, z: dz / d };
    } else {
      if (target) { target = null; world.targetRing.visible = false; }
      const v = world.moveVector(intent.move.x, intent.move.z, caps.pitch); wish = { x: v.x, y: v.y, z: v.z };
    }
  }
  presentSim(simFrame(sim, simWorld, { dt, intent, wish, held }), dt);
  if (mode !== 'menu' && sim.moves) combatHud.sync(slotViews(sim.moves.slots, sim.moves.set, rt));
  presentCombatView();
  syncAimChevron(intent);
  if (playing) offerHints();

  if (playing) {
    const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
    saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
    el('special').classList.toggle('cooldown', caps.breach && time < rt.breachReadyAt);
  }
  // After the ecosystem step, so fresh entries match the food positions that the guide and diagnostics read.
  if (mode === 'playing' && !held) { admissionClock.caller = 'guide'; stepGuideCache(playerActorCached()); admissionClock.caller = 'other'; }
  if (toastTimer > 0 && mode === 'playing') { toastTimer -= dt; if (toastTimer <= 0) el('toast').classList.remove('show'); }
  world.update(active ? dt : 0, time, mode === 'menu', moving, chompPulse, growth);
  if (mode === 'evolving' && !world.transitioning) {
    // The body ends at the simulation's destination; if the world changed, recover.
    mode = 'playing'; el('evolution-banner').hidden = true;
    const events: SimEvent[] = []; checkPose(sim, simWorld, playerActorCached(), events); presentSim(events, 0);
    if (mode === 'playing') toast(stageDescription(run.stage, capsOf()), 'stage');
    syncUI();
  }
  const depth = world.player.position.y / world.surface;
  el('depth-label').textContent = run.stage === 4 ? 'DEEP SPACE' : depth > 1.15 ? 'OPEN SKY' : depth > .88 ? 'THE SURFACE' : depth > .25 ? 'MIDWATER' : 'THE SEAFLOOR';
  el('depth-dot').style.bottom = `${T.MathUtils.clamp(depth * 72, 3, 96)}%`;
  el('depth-hint').textContent = capsOf().ground ? 'LOOK UP ↑' : run.stage === 4 ? 'A WHOLE UNIVERSE' : 'SURFACE ↑';
  uiClock += dt;
  if (uiClock > .1) {
    updateGuide(); uiClock = 0;
    if (mode === 'playing') {
      const biome = world.biome.name;
      if (biome !== lastBiome) { el('biome').textContent = `${STAGES[run.stage]!.biome} · ${biome.toUpperCase()}`; lastBiome = biome; }
      const canEvolve = canChooseNextPlan(run, BUILD);
      el('evolve').hidden = !canEvolve; el('objective').hidden = canEvolve;
    }
  }
  // Fix round 2: last in the frame, after every UI update of this frame (a card that changed width after the toast was placed let a landscape
  // toast overlap the stage card for a frame).
  if (mode === 'playing') { placeEvolve(); placeToast(); }
  if (admissionClock.on) {
    if (mode === 'playing' && !held) {
      const a = admissionStats[stage]!, by = admissionClock.by; a.frames++; a.ms += admissionClock.ms; a.calls += admissionClock.calls; a.worst = Math.max(a.worst, admissionClock.ms); a.contacts += frameContacts;
      for (const k of ['player', 'ecosystem', 'guide'] as const) { a[k].ms += by[k].ms; a[k].calls += by[k].calls; a[k].worst = Math.max(a[k].worst, by[k].ms); }
      a.player.worstCalls = Math.max(a.player.worstCalls, by.player.calls); a.rescueWorstCalls = Math.max(a.rescueWorstCalls, sim.rescueCalls);
    }
    resetAdmissionClock();
  }
}
/** Read-only: the player's zone at its physical position. */
function zoneNow() { return zoneLabel(legality(run.stage).queries.sampleEnvironment(physical), bodyLengthOf(run.genome) * SIZES[run.stage]! * growthOf(run)); }
/** Read-only: the reef solids of the current stage nearest the player (QA), in stage-local units: the bounds centre, the horizontal
 *  half extent, the top and bottom, the seabed under the centre and a rock's smallest horizontal semi-axis. */
function solidsNear(count = 8) {
  const size = SIZES[run.stage]!, p = physical;
  return stageSolids(run.stage, run.seed).solids.map(s => ({ id: s.id, kind: s.kind, x: (s.minX + s.maxX) / 2 / size, z: (s.minZ + s.maxZ) / 2 / size,
    half: Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 / size, top: s.maxY / size, bottom: s.minY / size, ground: world.groundAt((s.minX + s.maxX) / 2 / size, (s.minZ + s.maxZ) / 2 / size),
    // A rock's stone stands at least .9 of its footprint ellipsoid's smallest horizontal semi-axis (÷ ROCK_FIT) out from its centre
    // (make_rock's noise is at most 9.5 %): a centre closer than this to the rock's centre is inside the stone.
    inner: s.footprint?.[0]?.kind === 'ellipsoid' ? .9 * Math.min(s.footprint[0].a, s.footprint[0].c) / ROCK_FIT / size : 0,
    distance: Math.hypot((s.minX + s.maxX) / 2 - p.x, (s.minZ + s.maxZ) / 2 - p.z) / size })).sort((a, b) => a.distance - b.distance).slice(0, count);
}
/** Read-only (QA): the id of the stage solid the player's hull overlaps at its physical pose, or null. Only the solid rule is tested
 *  (no ground, bounds or media rule can come first), so a body that passed into a rock is seen even where another rule fails. */
const solidOnly = new Map<number, WorldQueries>();
function solidOverlap(): string | null {
  const key = run.seed * 8 + run.stage;
  let q = solidOnly.get(key);
  if (!q) { q = makeWorldQueries({ groundAt: () => -1e9, surface: 1e9, space: false, slopeBound: 0 }, { solids: stageSolids(run.stage, run.seed) }); solidOnly.clear(); solidOnly.set(key, q); }
  const a = q.overlapHull(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run)), physical, rt.orientation, { time });
  return a.constraint === 'solid' ? a.solidId ?? null : null;
}
/** Read-only: relevant-tier entities with a contact hazard, in local units. */
function hazardSources() {
  return world.eco.entities.filter(e => e.active && !e.eaten && e.spec.contactHazardId).map(e => ({ id: e.id, key: e.spec.key, x: e.x / world.scale, y: e.y / world.scale, z: e.z / world.scale, mode: e.mode }));
}
/** Read-only (QA): for every socket of the player, the rendered transform (part object × pivot node relative to the part ×
 *  inverse rest pivot × socket) against `sampleCombatPose` with the same world matrix and the same rig pose (the last rendered tick). */
function poseAgreement() {
  const creature = world.creature; if (!creature) return null;
  const g = creature.genome, world4 = creature.group.matrixWorld, scale = world4.getMaxScaleOnAxis(), bodyLength = bodyLengthOf(g) * scale;
  const pose = sampleCombatPose({ actorId: 'player', genome: g, plan: currentPlan(run), world: world4, rig: creature.rigPose as Parameters<typeof sampleCombatPose>[0]['rig'], physicalLength: bodyLength });
  const M = new T.Matrix4(), inv = new T.Matrix4(), linear = new T.Matrix3(), emitted = new T.Matrix4();
  let positionError = 0, angleError = 0, reflectionsAgree = true, sockets = 0;
  for (const [i, source] of emittersOf(g).entries()) {
    const placed = g.parts.find(p => p.uid === source.partUid)!, socket = PARTS.find(s => s.id === placed.id)!.sockets.find(s => s.id === source.socketId)!;
    const attached = creature.parts.find(a => a.placed.uid === source.partUid && a.copy === source.copy); if (!attached) return null;
    M.copy(attached.object.matrixWorld);
    if (socket.pivot) {
      const node = attached.pivots.find(p => p.kind === socket.pivot!.kind && p.index === socket.pivot!.index)?.node; if (!node) return null;
      M.multiply(inv.copy(attached.object.matrixWorld).invert().multiply(node.matrixWorld)).multiply(inv.copy(restPivotToPart(placed.id, `${socket.pivot.kind}:${socket.pivot.index}`)).invert());
    }
    const origin = new T.Vector3(socket.origin.x, socket.origin.y, socket.origin.z).applyMatrix4(M);
    const forward = new T.Vector3(socket.forward.x, socket.forward.y, socket.forward.z).applyMatrix3(linear.setFromMatrix4(M)).normalize();
    const e = pose.emitters[i]!; emitted.fromArray(e.localToWorld);
    positionError = Math.max(positionError, origin.distanceTo(new T.Vector3(e.origin.x, e.origin.y, e.origin.z)));
    angleError = Math.max(angleError, forward.angleTo(new T.Vector3(e.forward.x, e.forward.y, e.forward.z)));
    if (Math.sign(linear.setFromMatrix4(M).determinant()) !== Math.sign(linear.setFromMatrix4(emitted).determinant())) reflectionsAgree = false;
    sockets++;
  }
  return { sockets, positionError, angleError, reflectionsAgree, bodyLength, time };
}
/** The `qaEncounter` creature (physical position, body length, pursuit mode), or null. */
function encounterView() {
  const e = qaEncounterId === null ? undefined : world.eco.entities.find(x => x.id === qaEncounterId);
  return e ? { id: e.id, key: e.spec.key, x: e.x, y: e.y, z: e.z, bodyLength: speciesActor(e).bodyLength, mode: e.mode, eaten: e.eaten } : null;
}
/** QA: the screen point (CSS pixels) of a physical point, for pointer-aim checks. */
function screenOf(p: Vec3) { const v = world.screenPoint(new T.Vector3(p.x, p.y, p.z).divideScalar(world.scale)); return { x: v.x, y: v.y, visible: v.visible }; }
/** Read-only (QA, spec §14.2): actions, telegraphs, action clocks, the last 20 hit outcomes, hit-stop ends, slots, director tokens and holds. */
function combatDiagnostics() {
  const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
  const actors = [{ actor: PLAYER_ID, rt }, ...[...sim.combat.entities.values()].map(c => ({ actor: c.id, rt: c.rt }))];
  return {
    actions: actors.flatMap(x => x.rt.actions.map(a => ({ actor: x.actor, id: a.definitionId, instance: a.instanceId, phase: a.phase, aim: { ...a.aim }, target: a.targetId, shape: clone(a.lockedShapes), windupExtension: a.windupExtension }))),
    telegraphs: telegraphViews.map(v => ({ action: v.actionId, attacker: v.attackerId, attack: v.attackId, phase: v.phase, shapes: clone(v.shapes), fill: v.fill, onScreen: v.onScreen, arrow: arrowed.has(v.actionId), targetsPlayer: v.targetsPlayer, flash: v.flash, color: v.color, pattern: v.pattern, locked: v.locked, cue: v.cue })),
    telegraphMeshes: world.telegraphs.counts,
    clocks: Object.fromEntries(actors.map(x => [x.actor, x.rt.actionClock])), hitStop: Object.fromEntries(actors.map(x => [x.actor, x.rt.hitStopUntil])),
    hits: sim.combat.log.map(e => ({ outcome: e.outcome, attacker: e.attackerId, target: e.targetId, attack: e.attackId, amount: e.amount, unit: e.unit, time: e.time })),
    slots: sim.moves ? [...sim.moves.slots.slots] : [], tokens: sim.combat.director.tokens.map(t => ({ ...t })),
    heldBy: rt.heldBy, breakProgress: rt.breakProgress, hp: Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.entity.hp])), reducedMotion: reducedMotion.matches,
    alphas: [...sim.combat.entities.values()].filter(c => c.entity.spec.alpha).map(c => ({ id: c.id, key: c.entity.spec.key, hp: c.entity.hp, maxHp: c.maxHp, phase: c.ai?.phase ?? 0, state: c.ai?.name ?? 'idle', eaten: c.entity.eaten })),
    encounter: encounterView(), crowd: qaCrowdIds.map(id => world.eco.entities.find(x => x.id === id)).filter(e => !!e && !e.eaten).map(e => ({ id: e!.id, key: e!.spec.key, x: e!.x, y: e!.y, z: e!.z })), hints: [...hints.shown], aim: lastIntent.aim ? { ...lastIntent.aim } : null, aimSource: lastIntent.aimSource,
    alpha: shownAlpha && { ...shownAlpha }, ai: Object.fromEntries([...sim.combat.entities.values()].filter(c => c.entity.spec.alpha).map(c => [c.id, { name: c.ai?.name ?? null, phase: c.ai?.phase ?? 0, eaten: c.entity.eaten, x: c.entity.x / world.scale, y: c.entity.y / world.scale, z: c.entity.z / world.scale }])),
  };
}
// Read-only diagnostics allow browser verification to steer with real controls.
if (QA) {
  const copy = (v: Vec3) => ({ x: v.x, y: v.y, z: v.z });
  Object.defineProperty(window, '__tinyTide', { get: () => ({ mode, input: { basicHeld: lastIntent.basicHeld, activeHeld: [...lastIntent.activeHeld], aim: lastIntent.aim && copy(lastIntent.aim), aimSource: lastIntent.aimSource, aimPick: lastAimPick && copy(lastAimPick), touchMode },
    plan: currentPlan(run).id, plans: [...run.plans], zone: zoneNow(), velocity: copy(rt.controlledVelocity), externalVelocity: copy(rt.externalVelocity),
    orientation: { ...rt.orientation }, permit: rt.permit ? { ...rt.permit } : null, arc: rt.arc ? { ...rt.arc } : null, breachReadyAt: rt.breachReadyAt, invulnerableUntil: rt.invulnerableUntil,
    pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admittedNow(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, lastContactSolid, trapRescues: sim.trapRescues, rescueLog: JSON.parse(JSON.stringify(sim.rescueLog)), contactSolids: [...sim.lastSolids], groundOffset: rt.groundOffset, solidOverlap: mode === 'menu' ? null : solidOverlap(), solidsNear: mode === 'menu' ? [] : solidsNear(32), edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
    faintLog: sim.faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, editorFrame, poseAgreement, screenOf, creatureBox, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
      player: { msPerFrame: per(a.player.ms), callsPerFrame: per(a.player.calls), worstMs: a.player.worst, worstCalls: a.player.worstCalls }, rescueWorstCalls: a.rescueWorstCalls, ecosystem: { msPerFrame: per(a.ecosystem.ms), callsPerFrame: per(a.ecosystem.calls), worstMs: a.ecosystem.worst }, guide: { msPerFrame: per(a.guide.ms), callsPerFrame: per(a.guide.calls), worstMs: a.guide.worst } }; }), render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries }, combat: combatDiagnostics() }) });
}
requestAnimationFrame(frame);
