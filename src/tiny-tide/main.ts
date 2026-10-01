import { startAnalytics } from '../analytics';
import * as T from 'three';
import './style.css';
import './hud.css';
import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, DEATH_KEEP, dietCanEat, dnaOf, eat, evolveReady, faint, freshRun, growthOf, hurt, inReach, maxHealthOf, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, reward, STAGES, unlock, type Build, type Run } from './state';
import { adaptToPlan, derive, dietOf, effectiveStats, genomeCost } from './genome';
import { DROPS, part } from './parts';
import { tierSpecies } from './species';
import { PLAYER_HALF } from './biomes';
import { entityRadius, provoke } from './ecosystem';
import { openEditor } from './editor';
import { COAST_READY, eligibleChildren } from './plans';
import { TideAudio } from './audio';
import { TideWorld, type FoodObject } from './world';
import { loadAssets, assetDiagnostics } from './assets';

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
const BUILD: Build = { coast: COAST_READY };
/** Older keys are read for migration only. They are never written. */
const LEGACY_KEYS = ['tiny-tide-adventure-v2', 'tiny-tide-adventure-v1'];
let saved: Run | null = null;
try {
  for (const key of [SAVE_KEY, ...LEGACY_KEYS]) {
    const raw = localStorage.getItem(key); if (raw === null) continue;
    const loaded = parseSaveWithNotes(raw, BUILD); if (loaded?.status === 'ok') { saved = loaded.run; break; }
    if (loaded?.status === 'kept') break;   // Plan C shows the kept-save message.
  }
  audio.muted = localStorage.getItem('tiny-tide-muted') === 'true'; } catch { /* Storage is optional. */ }
let run = saved && !saved.completed ? structuredClone(saved) : freshRun();
let mode: 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'won' = 'menu';
startAnalytics('tiny-tide', () => mode === 'playing' || mode === 'evolving');
let keys = new Set<string>();
let stickX = 0, stickZ = 0, stickPointer: number | null = null;
let holdingChomp = false, rising = false, diving = false;
let target: T.Vector3 | null = null;
let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0, leap = -1, leapCooldown = 0;
let toastTimer = 0, uiClock = 0, saveClock = 0, leapStart = 0;
let grace = 0, sinceHit = 99, regenClock = 0, wrongDietClock = 0, readyToasted = false, lastBiome = '';
let dialogReturn: 'menu' | 'playing' | 'paused' = 'menu';
const modal = el<HTMLDialogElement>('modal');
world.setCreature(run.genome);
let derived = derive(effectiveStats(run.genome, currentPlan(run)));
function refreshDerived() { derived = derive(effectiveStats(run.genome, currentPlan(run))); }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
function clearInput() { keys.clear(); holdingChomp = false; rising = false; diving = false; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
function syncSound() { el('sound').innerHTML = audio.muted ? icons.mute : icons.sound; el('sound').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound'); el('sound').setAttribute('aria-pressed', String(audio.muted)); }
syncSound();
function syncHome() {
  const resume = saved && !saved.completed;
  el('start').innerHTML = resume ? `Keep munching ${icons.arrow}` : `Let’s eat ${icons.arrow}`; el('fresh').hidden = !resume;
  el('home-name').innerHTML = `${escapeHtml(run.name.toLowerCase())}<br><small>${resume ? `${STAGES[run.stage]!.title.toLowerCase()} and still hungry.` : 'big things start small.'}</small>`;
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
  el('vertical-controls').hidden = run.stage === 0; el('special').hidden = run.stage === 0; el('special-label').textContent = stage.action.toUpperCase(); el('special').setAttribute('aria-label', stage.action);
  const ready = evolveReady(run);
  el('evolve').hidden = !ready || mode !== 'playing'; el('objective').hidden = ready;
  el('objective-text').textContent = objective();
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(node => { const n = Number(node.dataset.stage); node.classList.toggle('active', n === run.stage); node.classList.toggle('done', n < run.stage); });
  document.documentElement.style.setProperty('--stage-color', stage.color);
  syncHearts();
}
function objective() {
  const diet = dietOf(run.genome), foods = tierSpecies(run.stage).filter(s => dietCanEat(diet, s.tag)).map(s => s.label.toLowerCase());
  if (run.stage === 4) return 'Float freely. Eat every last planet.';
  const list = foods.length > 3 ? `${foods.slice(0, 3).join(', ')} & more` : foods.join(' & ');
  return `Eat ${list}. ${['Swipe the world to look around.', 'Rise / Dive to explore.', 'Breach for gulls!', 'Watch out for seaplanes.'][run.stage]}`;
}
function begin(fresh = false) {
  audio.init(); run = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
  refreshDerived(); run.health = Math.min(run.health, derived.maxHealth);
  world.build(run.stage, run); el('evolution-banner').hidden = true; mode = 'playing'; clearInput(); cooldown = 0; leap = -1; leapCooldown = 0; grace = 2; sinceHit = 99; readyToasted = evolveReady(run); lastBiome = '';
  el('home').hidden = true; el('game-ui').hidden = false; el('pause').hidden = false; el('edit').hidden = false; el('corner-note').hidden = true; el('mode-label').textContent = 'NIBBLE. GROW. REPEAT.';
  document.body.classList.add('is-playing'); syncUI(); save(); toast(STAGES[run.stage]!.description);
}
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
  if (mode === 'evolving' || mode === 'won' || mode === 'editing' || mode === 'fainted') return;
  dialogReturn = mode === 'playing' || mode === 'paused' ? 'playing' : 'menu'; if (mode === 'playing') mode = 'paused';
  showDialog(`<div class="eyebrow">A RECIPE FOR BIG THINGS</div><h2 id="modal-title">Follow your tummy.</h2><p>Eat to earn DNA. Spend DNA on new parts. Grow from a speck to a cosmic giant.</p><div class="help-rows"><div><span>01</span><div><strong>A little wander</strong><p>Drag the left joystick or use WASD / arrow keys. Swipe the world to turn the camera. While swimming or flying, push forward to travel in the direction you’re looking.</p></div></div><div><span>02</span><div><strong>A little nibble</strong><p>Get close to food and hold Chomp or Space. Your mouth sets your diet: herbivores eat plants, carnivores eat meat, omnivores eat both for less DNA.</p></div></div><div><span>03</span><div><strong>A little danger</strong><p>Red <b>!</b> marks a hunter. Chomp back, swim away, or hide with stealth parts. If you lose every heart, you wake up at the start with most of your DNA.</p></div></div><div><span>04</span><div><strong>A whole new you</strong><p>Tap the pencil to edit your creature at any time. When the DNA bar is full, tap Evolve, pick new parts, and grow right where you are. Eat every planet to finish.</p></div></div></div><button id="got-it" class="primary">Got it. Let’s snack. ${icons.arrow}</button>`);
  el('got-it').onclick = closeDialog;
}
async function edit(kind: 'edit' | 'evolve') {
  if (mode !== 'playing' || (kind === 'evolve' && !evolveReady(run))) return;
  mode = 'editing'; clearInput(); save(); el('game-ui').classList.add('dimmed');
  const next = kind === 'evolve' ? eligibleChildren(run.plans, BUILD)[0] : undefined, target = next ?? currentPlan(run);
  const result = await openEditor({ genome: run.genome, name: run.name, stage: target.size, plan: target, unlocked: run.unlocked, budget: dnaOf(run) + genomeCost(run.genome), mode: kind, nextSerial: run.nextPartSerial });
  el('game-ui').classList.remove('dimmed');
  if (!result) { mode = 'playing'; syncUI(); return; }
  const before = run.genome;
  if (kind === 'evolve') {
    const adapted = next ? adaptToPlan(result.genome, next, { unlocked: run.unlocked }, Math.max(run.nextPartSerial, result.nextSerial)) : null;
    const prepared = next && adapted?.ok ? prepareEvolution(run, next.id, adapted.genome, result.name, BUILD, Math.max(result.nextSerial, adapted.nextSerial)) : null;
    if (prepared && 'planId' in prepared) { commitEvolution(run, prepared); refreshDerived(); startTransformation(); return; }
    toast('That evolution is not possible yet.'); mode = 'playing'; syncUI(); return;
  }
  const applied = applyDesign(run, result.genome, result.name, BUILD, result.nextSerial);
  if (!applied.ok) toast(applied.reason);
  refreshDerived(); if (JSON.stringify(before) !== JSON.stringify(run.genome)) { world.setCreature(run.genome); world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#f4e2b9', 30); audio.found(); }
  mode = 'playing'; save(); syncUI();
}
function startTransformation() {
  mode = 'evolving'; clearInput(); audio.evolve(); save();
  const stage = STAGES[run.stage]!;
  world.transform(run.stage, run.genome); syncUI();
  el('evolution-icon').innerHTML = species[run.stage]!;
  el('evolution-name').textContent = `${run.name}, ${stage.title.toLowerCase()}`;
  el('evolution-detail').textContent = 'Same little soul. A bigger world to eat.';
  el('evolution-banner').hidden = false;
  leap = -1; leapCooldown = 0; readyToasted = false;
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
    e.hp -= damage; provoke(e, world.physical(), time); audio.bite(run.bites); world.burst(food.data.x, food.data.y, food.data.z, '#ffd9a8', 8);
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
function special() {
  if (mode !== 'playing' || run.stage !== 2 || leap >= 0 || leapCooldown > 0) return;
  leap = 0; leapStart = world.player.position.y; leapCooldown = 2.3; audio.breach(); world.burst(world.player.position.x, world.surface, world.player.position.z, '#d6fff1', 22);
}
function takeHit(damage: number, label: string) {
  if (mode !== 'playing' || grace > 0) return;
  sinceHit = 0; world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
  const pos = world.screenPoint(world.player.position.clone().add(new T.Vector3(0, 1.4, 0)));
  floater(`-${damageAfterArmor(damage, derived.armor)} ♥`, pos.x, pos.y, 'hurt');
  const fainted = hurt(run, damage, derived.armor); syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
  if (!fainted) { if (run.health <= 2) toast(`${label} is winning! Swim away to heal.`); return; }
  mode = 'fainted'; clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
  setTimeout(() => {
    faint(run); run.health = maxHealthOf(run); run.pendingRespawn = false; refreshDerived(); world.placePlayer(run.stage); el('faint').hidden = true;
    mode = 'playing'; grace = 3; sinceHit = 99; save(); syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`);
  }, 1800);
}
el('start').onclick = () => begin(); el('fresh').onclick = () => { dialogReturn = 'menu'; confirmRestart(); };
el('evolve').onclick = () => void edit('evolve'); el('edit').onclick = () => void edit('edit');
el('sound').onclick = () => { audio.init(); audio.toggle(); syncSound(); try { localStorage.setItem('tiny-tide-muted', String(audio.muted)); } catch { /* Optional preference. */ } };
el('help').onclick = help; el('pause').onclick = pause; el('close-modal').onclick = closeDialog;
modal.addEventListener('cancel', event => { event.preventDefault(); if (mode !== 'evolving' && mode !== 'won') closeDialog(); });
document.querySelector('.brand')!.addEventListener('click', event => { event.preventDefault(); if (mode === 'playing') pause(); });
function holdButton(id: string, setter: (value: boolean) => void, press?: () => void) {
  const button = el(id);
  button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); button.setPointerCapture(event.pointerId); setter(true); button.classList.add('pressed'); audio.init(); press?.(); });
  const release = () => { setter(false); button.classList.remove('pressed'); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  button.addEventListener('click', event => { if (event.detail === 0) press?.(); });
}
holdButton('chomp', value => holdingChomp = value, chomp);
holdButton('special', value => rising = value, special);
holdButton('dive', value => diving = value);
const joystick = el('joystick');
function moveStick(event: PointerEvent) {
  const rect = joystick.getBoundingClientRect(), limit = rect.width * .3;
  const dx = event.clientX - rect.left - rect.width / 2, dz = event.clientY - rect.top - rect.height / 2;
  const length = Math.hypot(dx, dz), factor = length > limit ? limit / length : 1;
  stickX = dx * factor / limit; stickZ = dz * factor / limit;
  el('stick').style.transform = `translate(${dx * factor}px, ${dz * factor}px)`; target = null;
}
joystick.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); stickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveStick(event); });
joystick.addEventListener('pointermove', event => { if (event.pointerId === stickPointer) moveStick(event); });
function stopStick() { stickPointer = null; stickX = 0; stickZ = 0; el('stick').style.transform = ''; }
joystick.addEventListener('pointerup', stopStick); joystick.addEventListener('pointercancel', stopStick); joystick.addEventListener('lostpointercapture', stopStick);
let lookPointer: number | null = null, lookX = 0, lookY = 0, lookStartX = 0, lookStartY = 0, looked = false;
const canvas = world.renderer.domElement;
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'playing') return;
  lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
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
  if (event.pointerId !== lookPointer) return;
  if (!looked && mode === 'playing' && run.stage === 0) {
    target = world.groundPoint(event.clientX, event.clientY);
    if (target) { target.x = T.MathUtils.clamp(target.x, -PLAYER_HALF, PLAYER_HALF); target.z = T.MathUtils.clamp(target.z, -PLAYER_HALF, PLAYER_HALF); world.targetRing.position.copy(target); world.targetRing.position.y = world.groundAt(target.x, target.z) + .08; world.targetRing.scale.setScalar(.45); world.targetRing.visible = true; }
  }
  lookPointer = null;
});
canvas.addEventListener('pointercancel', () => lookPointer = null);
canvas.addEventListener('lostpointercapture', () => lookPointer = null);

window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (mode === 'playing') pause(); return; }
  if (mode !== 'playing') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'KeyE' && !event.repeat) special();
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
  const nearest = world.edibleFoods.filter(f => dietCanEat(diet, f.entity.spec.tag)).sort((a, b) =>
    Math.hypot(a.data.x - p.x, a.data.z - p.z) + Math.abs(a.data.y - p.y) * .6 - Math.hypot(b.data.x - p.x, b.data.z - p.z) - Math.abs(b.data.y - p.y) * .6)[0];
  if (nearest) {
    const f = nearest.data;
    const point = world.screenPoint(new T.Vector3(f.x, f.y + 1.4, f.z));
    const near = Math.hypot(f.x - p.x, f.z - p.z) < STAGES[run.stage]!.radius + 1 + derived.reach;
    const heightHint = f.y - p.y > 2.1 ? run.stage === 2 ? 'BREACH TO REACH!' : 'HOLD RISE TO REACH' : p.y - f.y > 2.1 ? 'HOLD DIVE TO REACH' : 'HOLD CHOMP';
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
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now;
  const active = mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted'; if (active) time += dt;
  let moving = false;
  const growth = growthOf(run);
  if (mode === 'playing') {
    run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); leapCooldown = Math.max(0, leapCooldown - dt); chompPulse = Math.max(0, chompPulse - dt * 5);
    grace = Math.max(0, grace - dt); wrongDietClock = Math.max(0, wrongDietClock - dt); sinceHit += dt;
    // Hearts come back slowly once the creature is out of danger.
    if (sinceHit > 5 && run.health < derived.maxHealth) { regenClock += dt; if (regenClock > 2.5) { regenClock = 0; run.health = Math.min(derived.maxHealth, run.health + 1); syncHearts(); } } else regenClock = 0;
    const s = STAGES[run.stage]!, p = world.player.position, speed = s.speed * derived.speedFactor;
    let dx = stickX + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    let dz = stickZ + Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    if (Math.abs(dx) + Math.abs(dz) > .05) { target = null; world.targetRing.visible = false; }
    if (target) { dx = target.x - p.x; dz = target.z - p.z; if (Math.hypot(dx, dz) < .25) { target = null; dx = 0; dz = 0; world.targetRing.visible = false; } }
    const length = Math.hypot(dx, dz); moving = length > .07;
    if (moving) {
      const normalized = Math.min(1, length) / Math.max(length, .001);
      const direction = target ? new T.Vector3(dx * normalized, 0, dz * normalized) : world.moveVector(dx * normalized, dz * normalized, run.stage > 0);
      p.addScaledVector(direction, dt * speed);
      p.x = T.MathUtils.clamp(p.x, -PLAYER_HALF, PLAYER_HALF); p.z = T.MathUtils.clamp(p.z, -PLAYER_HALF, PLAYER_HALF);
      const angle = Math.atan2(direction.x, direction.z), diff = Math.atan2(Math.sin(angle - world.player.rotation.y), Math.cos(angle - world.player.rotation.y)); world.player.rotation.y += diff * (1 - Math.exp(-dt * 10));
      if (run.stage > 0 && leap < 0) world.avatar.rotation.x = T.MathUtils.damp(world.avatar.rotation.x, -direction.y * .5, 5, dt);
    }
    const floor = world.groundAt(p.x, p.z);
    if (run.stage === 0) p.y = T.MathUtils.damp(p.y, floor + .65, 15, dt);
    else {
      if (run.stage === 2 && leap >= 0) {
        leap += dt; const u = Math.min(1, leap / 1.8), endY = world.surface - 1.3;
        p.y = T.MathUtils.lerp(leapStart, endY, u) + Math.sin(u * Math.PI) * (world.surface + 3.8 - Math.max(leapStart, endY));
        world.avatar.rotation.x = Math.cos(u * Math.PI) * -.55;
        if (u >= 1) { leap = -1; world.avatar.rotation.x = 0; world.burst(p.x, world.surface, p.z, '#d6fff1', 18); }
      } else {
        const vertical = Number(rising || keys.has('KeyE')) - Number(diving || keys.has('KeyQ'));
        p.y += vertical * dt * speed * .7;
        const minY = run.stage === 4 ? -18 : floor + (run.stage === 3 ? 1.5 : .9);
        const maxY = run.stage <= 2 ? world.surface - .6 : 30;
        p.y = T.MathUtils.clamp(p.y, minY, maxY);
        if (!moving) world.avatar.rotation.x = T.MathUtils.damp(world.avatar.rotation.x, 0, 5, dt);
      }
    }
    if (holdingChomp || keys.has('Space')) chomp();
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) el('toast').classList.remove('show'); }
    saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
    el('special').classList.toggle('cooldown', run.stage === 2 && leapCooldown > 0);
  }
  if (mode === 'playing' || mode === 'evolving' || mode === 'fainted') {
    // A world-space sphere stands in for the player hull until the combat runtime passes the real one.
    const player = world.physical(), playerHull = [{ start: player, end: player, radius: .9 * growth * world.scale }];
    const events = world.eco.step({ stage: run.stage, dt, now: time, player, playerHull, perceivable: mode === 'playing', stealthFactor: derived.stealthFactor });
    for (const event of events) takeHit(event.damage, event.entity.spec.label);
  }
  world.update(active ? dt : 0, time, mode === 'menu', moving, chompPulse, growth);
  if (mode === 'evolving' && !world.transitioning) { mode = 'playing'; el('evolution-banner').hidden = true; toast(STAGES[run.stage]!.description); syncUI(); }
  const depth = world.player.position.y / world.surface;
  el('depth-label').textContent = run.stage === 4 ? 'DEEP SPACE' : depth > 1.15 ? 'OPEN SKY' : depth > .88 ? 'THE SURFACE' : depth > .25 ? 'MIDWATER' : 'THE SEAFLOOR';
  el('depth-dot').style.bottom = `${T.MathUtils.clamp(depth * 72, 3, 96)}%`;
  el('depth-hint').textContent = run.stage === 0 ? 'LOOK UP ↑' : run.stage === 4 ? 'A WHOLE UNIVERSE' : 'SURFACE ↑';
  uiClock += dt;
  if (uiClock > .1) {
    updateGuide(); uiClock = 0;
    if (mode === 'playing') {
      const biome = world.biome.name;
      if (biome !== lastBiome) { el('biome').textContent = `${STAGES[run.stage]!.biome} · ${biome.toUpperCase()}`; lastBiome = biome; }
      el('evolve').hidden = !evolveReady(run);
    }
  }
}
// Read-only diagnostics allow browser verification to steer with real controls.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
  Object.defineProperty(window, '__tinyTide', { get: () => ({ mode, stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), leap, time, render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries } }) });
}
requestAnimationFrame(frame);
