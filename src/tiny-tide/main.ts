import { startAnalytics } from '../analytics';
import * as T from 'three';
import './style.css';
import './hud.css';
import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, DEATH_KEEP, dietCanEat, dnaOf, eat, evolveReady, freshRun, growthOf, hurt, inReach, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, reward, STAGES, unlock, type Build, type Run } from './state';
import { adaptToPlan, derive, dietOf, effectiveStats } from './genome';
import { DROPS, part } from './parts';
import { tierSpecies } from './species';
import { PLAYER_HALF, SIZES, SPAWN_HALF } from './biomes';
import { EDGE_HINT, EDGE_SOFT_START, inEdgeZone } from './edge';
import { entityRadius, provoke, type EcoEvent, type Entity } from './ecosystem';
import { canApproachFood, type Traversal } from './food-access';
import { openEditor, type EditorResult, type SubmitOutcome } from './editor';
import { openPathScreen, type PathChoice } from './path-screen';
import { renderPreview } from './preview';
import { cardSummary, COAST_READY, eligibleChildren, leadsTo, type BodyPlan } from './plans';
import { quoteDesign } from './economy';
import { newRuntime, type Actor, type Capsule, type CombatInput, type Constraint, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
import { basicRequested, readIntent, RELEASED } from './input';
import { blockHint, stepPlayer } from './player-motion';
import { beginRespawn, canChooseNextPlan, evolutionDestination, growthPose, reconcileAfterCommit, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn } from './lifecycle';
import { habitat, movement, movementCapabilities } from './profiles';
import { makeTerrain, makeWorldQueries, supportHeight, zoneLabel } from './world-queries';
import { orientHull } from './orientation';
import { startAnchor } from './motion';
import { bodyLengthOf, hullFitOf, hullOffsets, massFor, playerActor } from './mount';
import { designDelta } from './design-delta';
import { TideAudio } from './audio';
import { TideWorld, type FoodObject } from './world';
import { loadAssets, assetDiagnostics } from './assets';
import { editorProjection } from './editor';
import { QA_GRANT_CATALOG } from './qa-catalog';
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
    <div id="joystick" aria-label="Drag to move" role="group"><div class="stick-cross"></div><span id="stick"></span></div><div class="movement-hint"><span class="desktop-hint"><kbd>W</kbd><br><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>TO MOVE · DRAG TO LOOK</span></span><span class="touch-hint">DRAG TO MOVE</span></div>
    <div class="look-hint" id="look-hint"><span>↔</span> SWIPE TO LOOK AROUND</div><div class="depth-gauge"><span id="depth-label">SEAFLOOR</span><div><i id="depth-dot"></i></div><small id="depth-hint">LOOK UP. THERE’S A WHOLE WORLD.</small></div><div id="evolution-banner" hidden><span id="evolution-icon"></span><div><small>LOOK AT YOU GROW!</small><strong id="evolution-name"></strong><span id="evolution-detail">Same little soul. A bigger world to eat.</span></div></div><div class="actions"><div class="vertical-controls" id="vertical-controls" hidden><button id="special" class="special-button" aria-label="Rise" hidden>${icons.up}<span id="special-label">RISE</span><kbd>E</kbd></button><button id="dive" class="special-button dive-button" aria-label="Dive">${icons.up}<span>DIVE</span><kbd>Q</kbd></button></div><button id="chomp" class="chomp-button" aria-label="Chomp (hold to keep eating)">${icons.chomp}<strong>CHOMP</strong><span>HOLD <kbd>SPACE</kbd></span></button></div>
    <div id="food-pointer" hidden><span id="pointer-arrow">↑</span><span id="pointer-label">SEA SPROUT</span></div>
    <div id="snack-label" hidden></div><div id="threats" aria-hidden="true"></div><div id="toast" role="status" aria-live="polite"></div>
    <div id="faint" hidden><strong>Gobbled!</strong><span>Your little one carries on.</span></div>
  </section>
  <div id="floaters" aria-hidden="true"></div>
  <dialog id="modal" aria-labelledby="modal-title"><button id="close-modal" class="close-button" aria-label="Close dialog">×</button><div id="modal-content"></div></dialog>
  <div class="corner-note" id="corner-note">MADE FOR A LITTLE ESCAPE <span>✳</span></div>
`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
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
/** `?qaGrantCatalog=1`: the part catalog gets one synthetic active grant on the Pincer (qa-catalog.ts), so saves that bind it load
 *  and the editor's lost-abilities preview can be seen. */
const CATALOG = qaParams.get('qaGrantCatalog') === '1' ? QA_GRANT_CATALOG : PARTS;
/** The first QA rejection, if `?qaRejectSubmit=1` asked for one. */
function qaRejection(): SubmitOutcome | null {
  if (!qaRejectSubmit) return null;
  qaRejectSubmit = false; return { ok: false, reason: 'QA rejection' };
}
interface Legality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
const legalities = new Map<number, Legality>();
/** The player's world queries and bounds for a stage (physical units). `maxY` replaces the old sky clamp. */
function legality(stage: number): Legality {
  let l = legalities.get(stage);
  if (!l) {
    const size = SIZES[stage]!;
    l = { queries: makeWorldQueries(makeTerrain(stage)), bounds: { half: PLAYER_HALF * size, maxY: stage >= 3 ? 30 * size : undefined } };
    legalities.set(stage, l);
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
let mode: 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won' = 'menu';
startAnalytics('tiny-tide', () => mode === 'playing' || mode === 'evolving');
let keys = new Set<string>();
let stickX = 0, stickZ = 0, stickPointer: number | null = null;
let holdingChomp = false, rising = false, diving = false, chompTapped = false, riseTapped = false;
let lastIntent: CombatInput = RELEASED;
let target: T.Vector3 | null = null;
let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0;
let toastTimer = 0, uiClock = 0, saveClock = 0, hintClock = 0, respawnClock = 0, stuckRetry = 0, respawnToasted = false;
let sinceHit = 99, regenClock = 0, wrongDietClock = 0, readyToasted = false, lastBiome = '';
/** The one combat runtime of the player. Never cache its fields across frames (resets replace them). */
let rt = newRuntime();
/** The player's authoritative physical position. The rendered root follows it every frame. */
let physical: Vec3 = { x: 0, y: 0, z: 0 };
let genomeRevision = 0, acceptedHits = 0, rejectedHits = 0, contactNow = false, lastContact: Constraint | null = null, edgeNow = false, edgeHinted = false;
const faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[] = [];
let dialogReturn: 'menu' | 'playing' | 'paused' = 'menu';
const modal = el<HTMLDialogElement>('modal');
world.setCreature(run.genome);
let derived = derive(effectiveStats(run.genome, currentPlan(run)));
function refreshDerived() { derived = derive(effectiveStats(run.genome, currentPlan(run))); }
type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
let actorCache: { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number } | null = null, hullRescaled = false;
/** The last rescale changed only the growth (same plan, genome revision and stage). */
let hullGrew = false;
/** The player's actor. The hull is rebuilt only when the plan, the genome revision or the stage changes;
 *  a growth change rescales the cached buffers in place to the exact growth (no bucket). */
function playerActorCached(): Actor {
  const plan = currentPlan(run), key = `${plan.id}:${genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
  if (!actorCache || actorCache.key !== key) {
    const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
    actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
  }
  const c = actorCache;
  if (c.scale !== scale) {
    c.unit.forEach((u, i) => {
      const h = c.hull[i]!;
      h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale;
      h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
      h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale;
      if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; }
    });
    hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; hullRescaled = true;
  }
  return c.actor;
}
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
/** The player's hull in world space: oriented (envelope converted under pitch) and translated to the physical position. */
function worldHull(actor: Actor): Capsule[] {
  const at = (v: Vec3): Vec3 => ({ x: v.x + physical.x, y: v.y + physical.y, z: v.z + physical.z });
  return orientHull(actor.hull, rt.orientation).map(c => ({ ...c, start: at(c.start), end: at(c.end) }));
}
/** The grounded offset against the support under the current pose (0 when supported or not grounded). */
function settleOffset(actor: Actor) {
  const t = legality(run.stage).queries.terrain;
  rt.groundOffset = capsOf().ground && !t.space ? Math.max(0, physical.y - (supportHeight(actor, physical.x, physical.z, rt.orientation, t) + .01 * actor.bodyLength)) : 0;
}
/** The rendered root follows the simulation: position, yaw on the root, pitch on the avatar. */
function renderRoot() {
  world.player.position.set(physical.x, physical.y, physical.z).divideScalar(world.scale);
  world.player.rotation.y = rt.orientation.yaw; world.avatar.rotation.x = -rt.orientation.pitch;
}
/** Installs an admitted full pose: position and orientation together, no permit or arc, zero velocities. `snap` moves the camera too (start, respawn). */
function installPose(pose: { position: Vec3; orientation: Orientation }, actor: Actor, snap = false) {
  physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
  rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
  settleOffset(actor);
  if (snap) world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale));
  renderRoot();
}
/** The start anchor for the actor at its exact growth (never cached across growth changes). */
const anchorFor = (actor: Actor): RecoveryResult => startAnchor(actor, run.stage, legality(run.stage));
const admitted = (actor: Actor) => legality(run.stage).queries.overlapHull(actor, physical, rt.orientation, { time, permit: rt.permit, bounds: legality(run.stage).bounds }).ok;
/** Recovers to an admitted full pose, searching from `from` (default: the installed pose). A failed pose is never installed. */
function recover(actor: Actor, at: number, from: Vec3 = physical): boolean {
  const rec = recoverPlayer(actor, from, rt.orientation, { ...legality(run.stage), time: at }, anchorFor(actor), 20 * actor.bodyLength);
  if (!rec.ok) return false;
  installPose(rec, actor); return true;
}
/** The start grace of a new run or load: `START_GRACE` seconds, or none (0) with `?qaStartGrace=0`. */
function applyStartGrace() { rt.invulnerableUntil = START_GRACE > 0 ? time + START_GRACE : 0; }
/** True while a run that began stuck still owes its start grace to the first successful install. */
let startGracePending = false;
function enterStuck() { mode = 'stuck'; clearInput(); stuckRetry = 1; toast('Stuck — finding you a safe spot…'); }
/** After an edit, a growth change or a transformation: settle on the support, or recover when the body is not admitted. */
function checkPose(actor: Actor) {
  if (admitted(actor)) settleOffset(actor);
  else if (!recover(actor, time)) enterStuck();
}
/** After a growth rescale: the smallest admitted lift of the grown body, with both velocities kept (a bite at the floor does not
 *  stop the body). Only when no lift within .5 L is admitted does the normal recovery run (it zeroes the velocities). */
function checkGrownPose(actor: Actor) {
  const lifted = growthPose(actor, physical, rt, { ...legality(run.stage), time });
  if (!lifted) { checkPose(actor); return; }
  physical = lifted; settleOffset(actor); renderRoot();
}
/** Completes a pending respawn at the start anchor for the actual growth. The caller shows the result. */
function tryRespawn(): boolean {
  const actor = playerActorCached(), anchor = anchorFor(actor);
  if (!anchor.ok || !resolveRespawn(run, rt, time, anchor)) return false;
  installPose(anchor, actor, true); refreshDerived(); save(); return true;
}
/** Writes the run to the write key only. A kept, unreadable or legacy key is never written. */
function save() { try { if (writeKey) localStorage.setItem(writeKey, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
function clearInput() { keys.clear(); holdingChomp = false; rising = false; diving = false; chompTapped = false; riseTapped = false; lastIntent = RELEASED; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
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
function toast(message: string) { el('toast').textContent = message; el('toast').classList.add('show'); toastTimer = 4.5; }
function floater(text: string, x: number, y: number, kind = '') {
  const label = document.createElement('span'); label.className = `bite-floater ${kind}`; label.textContent = text; label.style.left = `${x}px`; label.style.top = `${y}px`; el('floaters').append(label); setTimeout(() => label.remove(), 950);
}
function syncHearts() {
  const max = derived.maxHealth, health = Math.ceil(run.health);
  el('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < health ? 'full' : ''}">${heart}</i>`).join('');
  el('hearts').setAttribute('aria-label', `${health} of ${max} hearts`);
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
  return `Eat ${list}. ${run.stage === 0 ? 'Swipe the world to look around.' : run.stage === 3 ? 'Watch out for seaplanes.' : move}`;
}
function begin(fresh = false) {
  audio.init(); run = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
  refreshDerived(); run.health = Math.min(run.health, derived.maxHealth);
  world.build(run.stage, run); el('evolution-banner').hidden = true; el('faint').hidden = true; mode = 'playing'; clearInput(); cooldown = 0; sinceHit = 99; readyToasted = evolveReady(run); lastBiome = '';
  // A fresh runtime for every new run or load. The start grace lives in the runtime.
  rt = newRuntime(); genomeRevision++; hintClock = 0; contactNow = false; lastContact = null; edgeNow = false; edgeHinted = false; startGracePending = false;
  faintLog.length = 0; acceptedHits = 0; rejectedHits = 0;
  el('home').hidden = true; el('game-ui').hidden = false; el('pause').hidden = false; el('edit').hidden = false; el('corner-note').hidden = true; el('mode-label').textContent = 'NIBBLE. GROW. REPEAT.';
  document.body.classList.add('is-playing'); toast(STAGES[run.stage]!.description);
  const actor = playerActorCached(), t = legality(run.stage).queries.terrain;
  physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
  world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale)); renderRoot();
  if (run.pendingRespawn) {
    // A save made during a faint resolves once, before play starts.
    if (!tryRespawn()) { mode = 'fainted'; respawnClock = 1; respawnToasted = false; el('faint').hidden = false; }
  } else {
    const anchor = anchorFor(actor), forced = forcedSpawn; forcedSpawn = null;
    // QA: a forced spawn is recovered to a legal pose like any other; without one it falls back to the anchor.
    const start: RecoveryResult = forced && anchor.ok ? recoverPlayer(actor, { x: forced.x * SIZES[run.stage]!, y: forced.y * SIZES[run.stage]!, z: forced.z * SIZES[run.stage]! }, anchor.orientation,
      { ...legality(run.stage), time }, anchor, 20 * actor.bodyLength) : anchor;
    if (start.ok) { rt = newRuntime(start.orientation); installPose(start, actor, true); applyStartGrace(); }
    else { enterStuck(); startGracePending = true; }
  }
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
  mode = 'paused'; dialogReturn = 'playing'; save();
  showDialog(`<span class="modal-art">${species[run.stage]}</span><div class="eyebrow">TAKE A LITTLE BREATHER</div><h2 id="modal-title">Small pause.<br>Big dreams.</h2><p>Your little adventure is saved.<br>The snacks will wait for you.</p><button id="resume" class="primary">Keep munching ${icons.play}</button><button id="restart" class="text-button">Start a fresh adventure</button>`);
  el('resume').onclick = closeDialog; el('restart').onclick = confirmRestart;
}
function confirmRestart() {
  showDialog(`<span class="modal-art">${species[0]}</span><div class="eyebrow">BACK TO THE SHALLOWS</div><h2 id="modal-title">A fresh little start?</h2><p>This replaces your saved adventure.<br>You get a new world and a tiny new creature.</p><button id="confirm-restart" class="primary">Start fresh ${icons.arrow}</button><button id="cancel-restart" class="text-button">Keep my adventure</button>`);
  el('confirm-restart').onclick = () => { modal.close(); begin(true); }; el('cancel-restart').onclick = closeDialog;
}
function help() {
  if (mode === 'evolving' || mode === 'won' || mode === 'editing' || mode === 'fainted' || mode === 'stuck') return;
  dialogReturn = mode === 'playing' || mode === 'paused' ? 'playing' : 'menu'; if (mode === 'playing') mode = 'paused';
  showDialog(`<div class="eyebrow">A RECIPE FOR BIG THINGS</div><h2 id="modal-title">Follow your tummy.</h2><p>Eat to earn DNA. Spend DNA on new parts. Grow from a speck to a cosmic giant.</p><div class="help-rows"><div><span>01</span><div><strong>A little wander</strong><p>Drag the left joystick or use WASD / arrow keys. Swipe the world to turn the camera. While swimming or flying, push forward to travel in the direction you’re looking.</p></div></div><div><span>02</span><div><strong>A little nibble</strong><p>Get close to food and hold Chomp or Space. Your mouth sets your diet: herbivores eat plants, carnivores eat meat, omnivores eat both for less DNA.</p></div></div><div><span>03</span><div><strong>A little danger</strong><p>Red <b>!</b> marks a hunter. Chomp back, swim away, or hide with stealth parts. If you lose every heart, you wake up at the start with most of your DNA.</p></div></div><div><span>04</span><div><strong>A whole new you</strong><p>Tap the pencil to edit your creature at any time. When the DNA bar is full, tap Evolve, pick new parts, and grow right where you are. Eat every planet to finish.</p></div></div></div><button id="got-it" class="primary">Got it. Let’s snack. ${icons.arrow}</button>`);
  el('got-it').onclick = closeDialog;
}
async function edit(kind: 'edit' | 'evolve') {
  if (mode !== 'playing' || (kind === 'evolve' && !canChooseNextPlan(run, BUILD))) return;
  mode = 'editing'; clearInput(); save(); el('game-ui').classList.add('dimmed');
  if (kind === 'evolve') await chooseEvolution(); else await editDesign();
  el('game-ui').classList.remove('dimmed');
  // A committed evolution is already transforming (mode 'evolving').
  if (mode === 'editing') { mode = 'playing'; save(); }
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
  const prepared = prepareEvolution(run, next.id, r.genome, r.name, BUILD, r.nextSerial, CATALOG);
  if (!('planId' in prepared)) return { ok: false, reason: prepared.reason };
  const nextActor = playerActor(next, prepared.genome, next.size, 1), nextLegality = legality(next.size), anchor = startAnchor(nextActor, next.size, nextLegality);
  const destination = evolutionDestination(nextActor, physical, { ...nextLegality, orientation: { yaw: rt.orientation.yaw, pitch: 0 }, time }, anchor.ok ? anchor.position : physical);
  if (!destination.ok) return { ok: false, reason: "This body can't fit anywhere here." };
  commitEvolution(run, prepared, CATALOG); resetRuntime(rt, destination.orientation); genomeRevision++; refreshDerived();
  physical = { ...destination.position }; startTransformation(destination.position);
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
      const applied = applyDesign(run, r.genome, r.name, BUILD, r.nextSerial, CATALOG);
      if (!applied.ok) return { ok: false, reason: applied.reason };
      // The simulation clock is stopped while editing, so `time` is the commit time.
      reconcileAfterCommit(rt, designDelta(before, run.genome, oldLoadout, CATALOG), run.genome, 'player', time); genomeRevision++; refreshDerived(); committed = true;
      if (JSON.stringify(before) !== JSON.stringify(run.genome)) { world.setCreature(run.genome); world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#f4e2b9', 30); audio.found(); }
      return { ok: true };
    } });
  if (!committed) return;
  mode = 'playing'; save(); checkPose(playerActorCached());
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
/** A food or creature in bite range: own-tier food, or a bigger creature that is attacking. */
function biteTargets() {
  const p = world.player.position, growth = growthOf(run), diet = dietOf(run.genome);
  const out: { food: FoodObject; edible: boolean; distance: number }[] = []; let wrongDiet: string | null = null;
  for (const food of world.foods) {
    const e = food.entity; if (e.eaten) continue;
    const attacking = e.mode === 'hunt' || e.mode === 'angry';
    if (food.tier !== run.stage && !(attacking && food.tier === run.stage + 1)) continue;
    const radius = food.tier > run.stage ? entityRadius(e) / world.scale : 0;
    if (!inReach(run.stage, p, food.data, growth, derived.reach, radius)) continue;
    const edible = food.tier === run.stage && dietCanEat(diet, e.spec.tag);
    // A mouth that can not eat it can still bite back at something that fights.
    if (!edible && !attacking && !e.spec.fights) { wrongDiet = e.spec.label; continue; }
    out.push({ food, edible, distance: Math.hypot(food.data.x - p.x, food.data.y - p.y, food.data.z - p.z) });
  }
  return { targets: out.sort((a, b) => a.distance - b.distance), wrongDiet };
}
function chomp() {
  if (mode !== 'playing' || cooldown > 0) return;
  cooldown = .24; chompPulse = 1;
  const { targets, wrongDiet } = biteTargets();
  const hit = targets[0];
  if (!hit) {
    audio.tone(170, 0, .065);
    if (wrongDiet && wrongDietClock <= 0) { toast(`A ${dietOf(run.genome)} can’t eat ${wrongDiet.toLowerCase()}. Try another mouth in the editor.`); wrongDietClock = 6; }
    return;
  }
  const { food } = hit, e = food.entity, pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z));
  const bigger = food.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
  if (e.spec.hp > 1 || bigger) {
    e.hp -= damage; provoke(e, physical, time, worldHull(playerActorCached())); audio.bite(run.bites); world.burst(food.data.x, food.data.y, food.data.z, '#ffd9a8', 8);
    if (e.hp > 0) { floater(`-${damage}`, pos.x, pos.y, 'hit'); return; }
  }
  const drop = DROPS[e.spec.kind];
  if (drop && unlock(run, drop)) { toast(`New part found: ${part(drop)!.name}! Open the editor to use it.`); audio.found(); }
  let dna: number, won = false;
  if (hit.edible) { const result = eat(run, e.spec, e.spec.kind === 'planet' ? world.eco.planetIndex(e) : e.id); dna = result.dna; won = result.win; }
  else { dna = Math.round(e.spec.dna * .5); reward(run, dna, food.tier === run.stage); }
  world.eco.consume(e); world.removeFood(food); audio.bite(run.bites);
  if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
  floater(dna > 0 ? `+${dna} DNA` : ['yum!', 'nom!', '♡'][run.bites % 3]!, pos.x, pos.y);
  syncUI(); save();
  if (won) { win(); return; }
  if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
}
/** One accepted hazard event (resolveHazards already accepted it). */
function takeHit(event: EcoEvent) {
  sinceHit = 0; world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
  const pos = world.screenPoint(world.player.position.clone().add(new T.Vector3(0, 1.4, 0)));
  floater(`-${damageAfterArmor(event.damage, derived.armor)} ♥`, pos.x, pos.y, 'hurt');
  const fainted = hurt(run, event.damage, derived.armor); syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
  if (!fainted) { if (run.health <= 2) toast(`${event.entity.spec.label} is winning! Get away to heal.`); return; }
  const hadPermit = rt.permit !== null, hadArc = rt.arc !== null;
  if (!beginRespawn(run, rt)) return;
  save(); mode = 'fainted'; faintLog.push({ time, hadPermit, hadArc }); respawnClock = 1.8; respawnToasted = false;
  clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
}
/** The faint timer: respawn at the start anchor, or wait and retry each second. */
function tickFaint(dt: number) {
  respawnClock -= dt; if (respawnClock > 0) return;
  if (tryRespawn()) {
    el('faint').hidden = true; mode = 'playing'; sinceHit = 99; syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`);
    return;
  }
  respawnClock = 1;
  if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); }
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
function holdButton(id: string, setter: (value: boolean) => void, tap?: () => void) {
  const button = el(id);
  button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); endedPointers.delete(event.pointerId); button.setPointerCapture(event.pointerId); setter(true); tap?.(); button.classList.add('pressed'); audio.init(); });
  const release = () => { setter(false); button.classList.remove('pressed'); };
  button.addEventListener('pointerup', event => { endedPointers.add(event.pointerId); release(); });
  button.addEventListener('pointercancel', () => { release(); clearInput(); });
  button.addEventListener('lostpointercapture', event => { release(); if (!releasedNormally(event)) clearInput(); });
  button.addEventListener('click', event => { if (event.detail === 0 && mode === 'playing') tap?.(); });
}
holdButton('chomp', value => holdingChomp = value, () => chompTapped = true);
holdButton('special', value => rising = value, () => riseTapped = true);
holdButton('dive', value => diving = value);
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
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'playing') return;
  endedPointers.delete(event.pointerId); lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== lookPointer || mode !== 'playing') return;
  const dx = event.clientX - lookX, dy = event.clientY - lookY;
  if (Math.hypot(event.clientX - lookStartX, event.clientY - lookStartY) > 5) looked = true;
  if (looked) { world.look(dx, dy); el('look-hint').classList.add('learned'); target = null; }
  lookX = event.clientX; lookY = event.clientY;
});
canvas.addEventListener('pointerup', event => {
  // Every pointer that ends normally is recorded, so its lostpointercapture is not read as a cancel.
  endedPointers.add(event.pointerId);
  if (event.pointerId !== lookPointer) return;
  if (!looked && mode === 'playing' && capsOf().ground) {
    target = world.groundPoint(event.clientX, event.clientY);
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
  keys.add(event.code);
  if (event.code === 'KeyE' && !event.repeat) riseTapped = true;
  if (event.code === 'Space' && !event.repeat) chompTapped = true;
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
    el('snack-label').hidden = !onscreen; el('food-pointer').hidden = onscreen;
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
  el('threats').innerHTML = markers.map(f => {
    const point = world.screenPoint(new T.Vector3(f.data.x, f.data.y + (f.tier > run.stage ? 4 : 1.6), f.data.z));
    const x = T.MathUtils.clamp(point.visible ? point.x : innerWidth - point.x, 30, innerWidth - 30), y = T.MathUtils.clamp(point.visible ? point.y : innerHeight - 60, 90, innerHeight - 60);
    return `<span class="threat ${point.visible ? '' : 'edge'}" style="left:${x}px;top:${y}px">!<small>${f.entity.spec.label.toUpperCase()}</small></span>`;
  }).join('');
}
const NO_WISH: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now;
  // The game clock runs in these modes only (not while paused, editing, stuck or won).
  const held = holdingStart && mode === 'playing';
  const active = !held && (mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted');
  let moving = false;
  const growth = growthOf(run), stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
  const actor = mode === 'menu' ? null : playerActorCached();
  if (actor && hullRescaled) {
    // A growth change rescaled the hull: settle again, or recover if the bigger body is not admitted.
    const grew = hullGrew; hullRescaled = false; hullGrew = false;
    if (mode === 'playing') { if (grew) checkGrownPose(actor); else checkPose(actor); } else settleOffset(actor);
  }
  if (mode === 'playing' && actor && !held) {
    run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); chompPulse = Math.max(0, chompPulse - dt * 5);
    wrongDietClock = Math.max(0, wrongDietClock - dt); hintClock = Math.max(0, hintClock - dt); sinceHit += dt;
    // Hearts come back slowly once the creature is out of danger.
    if (sinceHit > 5 && run.health < derived.maxHealth) { regenClock += dt; if (regenClock > 2.5) { regenClock = 0; run.health = Math.min(derived.maxHealth, run.health + 1); syncHearts(); } } else regenClock = 0;
    // One input consumer: one intent per frame, then the tap flags are spent.
    const intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving }, lastIntent, { breachOnRiseTap: caps.breach });
    chompTapped = false; riseTapped = false; lastIntent = intent;
    const p = world.player.position;
    if (Math.abs(intent.move.x) + Math.abs(intent.move.z) > .05) { target = null; world.targetRing.visible = false; }
    let wish: Vec3 = NO_WISH;
    if (target && caps.ground) {
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
      if (d < .25) { target = null; world.targetRing.visible = false; } else wish = { x: dx / d, y: 0, z: dz / d };
    } else {
      if (target) { target = null; world.targetRing.visible = false; }
      const v = world.moveVector(intent.move.x, intent.move.z, caps.pitch); wish = { x: v.x, y: v.y, z: v.z };
    }
    const legal = legality(stage);
    const poseBefore = { yaw: rt.orientation.yaw, pitch: rt.orientation.pitch };
    const r = stepPlayer(physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * derived.speedFactor,
      now: time, dt, wish, aim: null, actionLock: false });
    // A result that needs recovery is never installed or rendered: recover from it, or keep the last legal pose while stuck.
    if (!r.needsRecovery) { physical = r.position; renderRoot(); }
    else if (!recover(actor, time + dt, r.position)) { rt.orientation = poseBefore; enterStuck(); }
    const contact = r.contacts[0];
    contactNow = !!contact;
    if (contact) { lastContact = contact.constraint; if (hintClock <= 0) { toast(blockHint(plan, contact)); hintClock = 6; } }
    // The soft edge: the edge hint shows once per entry into the push zone, rate-limited with the block hints, and
    // only when no other toast is on screen (so a one-shot message is never replaced).
    edgeNow = inEdgeZone(physical, legal.bounds.half);
    if (!edgeNow) edgeHinted = false;
    else if (!edgeHinted && hintClock <= 0 && toastTimer <= 0) { toast(EDGE_HINT); edgeHinted = true; hintClock = 6; }
    if (r.breachStarted) { audio.breach(); world.burst(p.x, world.surface, p.z, '#d6fff1', 22); }
    if (r.arcEnded) world.burst(p.x, world.surface, p.z, '#d6fff1', 18);
    const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
    if (mode === 'playing' && basicRequested(intent)) chomp();
    saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
    el('special').classList.toggle('cooldown', caps.breach && time < rt.breachReadyAt);
  }
  if (mode === 'stuck' && actor) {
    // The game clock is stopped; a separate countdown retries recovery once per second.
    stuckRetry -= dt;
    if (stuckRetry <= 0) { stuckRetry = 1; if (recover(actor, time)) { if (startGracePending) { startGracePending = false; applyStartGrace(); } mode = 'playing'; el('toast').classList.remove('show'); syncUI(); } }
  }
  if ((mode === 'playing' || mode === 'evolving' || mode === 'fainted') && actor && !held) {
    const events = world.eco.step({ stage, dt, now: time, player: physical, playerHull: worldHull(actor), perceivable: rt.perceivable && mode !== 'fainted', stealthFactor: derived.stealthFactor });
    const accepted = resolveHazards(events, { mode, pendingRespawn: run.pendingRespawn, rt, now: time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
    rejectedHits += events.length - accepted.length;
    // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
    for (const event of accepted) { if (mode !== 'playing') break; acceptedHits++; takeHit(event); }
    // After the ecosystem step, so fresh entries match the food positions that the guide and diagnostics read.
    if (mode === 'playing') stepGuideCache(actor);
  }
  if (mode === 'fainted') tickFaint(dt);
  if (toastTimer > 0 && mode === 'playing') { toastTimer -= dt; if (toastTimer <= 0) el('toast').classList.remove('show'); }
  if (active) time += dt;
  world.update(active ? dt : 0, time, mode === 'menu', moving, chompPulse, growth);
  if (mode === 'evolving' && !world.transitioning) {
    // The body ends at the simulation's destination; if the world changed, recover.
    mode = 'playing'; el('evolution-banner').hidden = true; renderRoot(); checkPose(playerActorCached());
    if (mode === 'playing') toast(STAGES[run.stage]!.description);
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
}
/** Read-only: the player's zone at its physical position. */
function zoneNow() { return zoneLabel(legality(run.stage).queries.sampleEnvironment(physical), bodyLengthOf(run.genome) * SIZES[run.stage]! * growthOf(run)); }
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
// Read-only diagnostics allow browser verification to steer with real controls.
if (QA) {
  const copy = (v: Vec3) => ({ x: v.x, y: v.y, z: v.z });
  Object.defineProperty(window, '__tinyTide', { get: () => ({ mode,
    plan: currentPlan(run).id, plans: [...run.plans], zone: zoneNow(), velocity: copy(rt.controlledVelocity), externalVelocity: copy(rt.externalVelocity),
    orientation: { ...rt.orientation }, permit: rt.permit ? { ...rt.permit } : null, arc: rt.arc ? { ...rt.arc } : null, breachReadyAt: rt.breachReadyAt, invulnerableUntil: rt.invulnerableUntil,
    pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admitted(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
    faintLog: faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries } }) });
}
requestAnimationFrame(frame);
