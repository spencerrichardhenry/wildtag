import * as T from 'three';
import './style.css';
import { canEat, eat, freshRun, parseSave, STAGES, FOOD_LABELS, type Run } from './state';
import { TideAudio } from './audio';
import { TideWorld } from './world';
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
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="vignette"></div><div class="grain"></div>
  <header class="topbar"><a class="brand" href="#" aria-label="Tiny Tide home"><span class="brand-mark">${species[0]}</span><span>tiny tide<span class="brand-dot">.</span></span></a><div class="top-actions"><span id="mode-label">A SMALL GAME ABOUT GETTING BIG</span><button class="icon-button" id="sound" aria-label="Mute sound" aria-pressed="false">${icons.sound}</button><button class="icon-button" id="help" aria-label="How to play">${icons.help}</button><button class="icon-button" id="pause" aria-label="Pause game" hidden>${icons.pause}</button></div></header>
  <main id="home">
    <div class="home-copy"><div class="eyebrow"><span class="tiny-star">✳</span> A LITTLE CREATURE. A VERY BIG UNIVERSE.</div><h1>Small fry.<br><em>Big appetite.</em></h1><p>Start with a nibble. <br>End with the whole universe.</p><div class="start-row"><button id="start" class="primary">Let’s eat ${icons.arrow}</button><span class="play-note">ZERO PRESSURE.<br>INFINITE APPETITE.</span></div><button id="fresh" class="text-button" hidden>Start a fresh adventure</button><div class="home-hint"><span class="hint-line"></span> A cozy 3D eat-and-evolve adventure</div></div>
    <div class="creature-caption"><span class="caption-line"></span><span>little shrimp<br><small>big things start small.</small></span><span class="caption-spark">✧</span></div>
    <div class="journey"><div class="journey-heading"><span>YOUR NEXT BIG THING</span><span>5 FORMS · ONE HUNGRY LITTLE SOUL</span></div><div class="journey-track">${STAGES.map((s, i) => `<div class="journey-step ${i === 0 ? 'current' : ''}"><span class="step-icon">${species[i]}</span><div><span class="step-number">0${i + 1}</span><span class="step-name">${['Little shrimp', 'Happy fish', 'Pocket orca', 'Cuddlethulhu', 'Cosmic cutie'][i]}</span><small>${['Nibble', 'Swim', 'Breach', 'Take flight', 'Devour the stars'][i]}</small></div>${i < 4 ? '<span class="step-dots">···</span>' : ''}<span class="sr-only">${s.size}</span></div>`).join('')}</div></div>
  </main>
  <section id="game-ui" hidden aria-label="Game controls">
    <div class="stage-card"><div id="stage-icon"></div><div><span class="eyebrow" id="biome"></span><h2 id="creature-name"></h2><span id="size"></span></div></div>
    <div class="growth-card"><div class="growth-meta"><span id="growth-label">A LITTLE BIGGER WITH EVERY BITE</span><strong id="growth-count"></strong></div><div class="growth-track"><div id="growth-fill"></div></div><div class="growth-next"><span id="diet"></span><span id="next-form"></span></div></div>
    <div id="objective"><span class="objective-dot"></span><span id="objective-text"></span></div>
    <div class="stage-dots" aria-label="Evolution progress">${STAGES.map((s, i) => `<span data-stage="${i}" title="${s.name}">${species[i]}</span>`).join('<i></i>')}</div>
    <div id="joystick" aria-label="Drag to move" role="group"><div class="stick-cross"></div><span id="stick"></span></div><div class="movement-hint"><span class="desktop-hint"><kbd>W</kbd><br><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>TO MOVE · DRAG TO LOOK</span></span><span class="touch-hint">DRAG TO MOVE</span></div>
    <div class="look-hint" id="look-hint"><span>↔</span> SWIPE TO LOOK AROUND</div><div class="depth-gauge"><span id="depth-label">SEAFLOOR</span><div><i id="depth-dot"></i></div><small id="depth-hint">LOOK UP. THERE’S A WHOLE WORLD.</small></div><div id="evolution-banner" hidden><span id="evolution-icon"></span><div><small>LOOK AT YOU GROW!</small><strong id="evolution-name"></strong><span id="evolution-detail">Same little soul. A bigger world to eat.</span></div></div><div class="actions"><div class="vertical-controls" id="vertical-controls" hidden><button id="special" class="special-button" aria-label="Rise" hidden>${icons.up}<span id="special-label">RISE</span><kbd>E</kbd></button><button id="dive" class="special-button dive-button" aria-label="Dive">${icons.up}<span>DIVE</span><kbd>Q</kbd></button></div><button id="chomp" class="chomp-button" aria-label="Chomp (hold to keep eating)">${icons.chomp}<strong>CHOMP</strong><span>HOLD <kbd>SPACE</kbd></span></button></div>
    <div id="food-pointer" hidden><span id="pointer-arrow">↑</span><span id="pointer-label">SEA SPROUT</span></div>
    <div id="snack-label" hidden></div><div id="toast" role="status" aria-live="polite"></div>
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
const SAVE_KEY = 'tiny-tide-adventure-v1';
let saved: Run | null = null;
try { saved = parseSave(localStorage.getItem(SAVE_KEY)); audio.muted = localStorage.getItem('tiny-tide-muted') === 'true'; } catch { /* Storage is optional. */ }
let run = freshRun();
let mode: 'menu' | 'playing' | 'paused' | 'evolving' | 'won' = 'menu';
let keys = new Set<string>();
let stickX = 0, stickZ = 0, stickPointer: number | null = null;
let holdingChomp = false, rising = false, diving = false;
let target: T.Vector3 | null = null;
let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0, leap = -1, leapCooldown = 0;
let toastTimer = 0, uiClock = 0, saveClock = 0, leapStart = 0;
let dialogReturn: 'menu' | 'playing' | 'paused' = 'menu';
const modal = el<HTMLDialogElement>('modal');
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
function clearInput() { keys.clear(); holdingChomp = false; rising = false; diving = false; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
function syncSound() { el('sound').innerHTML = audio.muted ? icons.mute : icons.sound; el('sound').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound'); el('sound').setAttribute('aria-pressed', String(audio.muted)); }
syncSound();
if (saved && !saved.completed) { el('start').innerHTML = `Keep munching ${icons.arrow}`; el('fresh').hidden = false; }
function toast(message: string) { el('toast').textContent = message; el('toast').classList.add('show'); toastTimer = 4.5; }
function syncUI() {
  const stage = STAGES[run.stage]!;
  el('stage-icon').innerHTML = species[run.stage]!; el('biome').textContent = stage.biome;
  el('creature-name').textContent = stage.name; el('size').textContent = `${stage.size} OF PURE POTENTIAL`;
  el('growth-count').textContent = `${run.bites} / ${stage.goal}`;
  el('growth-fill').style.width = `${Math.min(100, run.bites / stage.goal * 100)}%`;
  el('diet').textContent = stage.diet;
  el('next-form').textContent = run.stage === 4 ? `${12 - run.bites} planets left` : `Next: ${STAGES[run.stage + 1]!.name} ↗`;
  el('growth-label').textContent = run.stage === 4 ? 'ONE UNIVERSE. NO LEFTOVERS.' : 'A LITTLE BIGGER WITH EVERY BITE';
  el('vertical-controls').hidden = run.stage === 0; el('special').hidden = run.stage === 0; el('special-label').textContent = stage.action.toUpperCase(); el('special').setAttribute('aria-label', stage.action);
  el('objective-text').textContent = ['Find tasty plants. Swipe the world to look around.', 'Shrimp, crabs, jellies & snails. Rise / Dive to explore.', 'Tuna, squid & rays below. Breach for gulls!', 'Palms, sailboats, seaplanes, balloons & lighthouses!', 'Float freely. Eat every last planet.'][run.stage]!;
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(node => { const n = Number(node.dataset.stage); node.classList.toggle('active', n === run.stage); node.classList.toggle('done', n < run.stage); });
  document.documentElement.style.setProperty('--stage-color', stage.color);
}
function begin(fresh = false) {
  audio.init(); run = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
  // A save taken on an evolution boundary resumes in the newly unlocked form.
  if (run.bites >= STAGES[run.stage]!.goal && run.stage < 4) { run.stage++; run.bites = 0; }
  world.build(run.stage, run.eatenPlanets); el('evolution-banner').hidden = true; mode = 'playing'; clearInput(); cooldown = 0; leap = -1; leapCooldown = 0;
  el('home').hidden = true; el('game-ui').hidden = false; el('pause').hidden = false; el('corner-note').hidden = true; el('mode-label').textContent = 'NIBBLE. GROW. REPEAT.';
  document.body.classList.add('is-playing'); syncUI(); save(); toast(STAGES[run.stage]!.nickname);
}
function showDialog(content: string, closable = true) { clearInput(); el('modal-content').innerHTML = content; el('close-modal').hidden = !closable; if (!modal.open) modal.showModal(); }
function closeDialog() { modal.close(); if (mode === 'paused') mode = dialogReturn === 'playing' ? 'playing' : 'menu'; clearInput(); }
function pause() {
  if (mode !== 'playing') return;
  mode = 'paused'; dialogReturn = 'playing'; save();
  showDialog(`<span class="modal-art">${species[run.stage]}</span><div class="eyebrow">TAKE A LITTLE BREATHER</div><h2 id="modal-title">Small pause.<br>Big dreams.</h2><p>Your little adventure is saved.<br>The snacks will wait for you.</p><button id="resume" class="primary">Keep munching ${icons.play}</button><button id="restart" class="text-button">Start a fresh adventure</button>`);
  el('resume').onclick = closeDialog; el('restart').onclick = confirmRestart;
}
function confirmRestart() {
  showDialog(`<span class="modal-art">${species[0]}</span><div class="eyebrow">BACK TO THE SHALLOWS</div><h2 id="modal-title">A fresh little start?</h2><p>This replaces your saved adventure.<br>You'll be a tiny shrimp again.</p><button id="confirm-restart" class="primary">Start fresh ${icons.arrow}</button><button id="cancel-restart" class="text-button">Keep my adventure</button>`);
  el('confirm-restart').onclick = () => { modal.close(); begin(true); }; el('cancel-restart').onclick = closeDialog;
}
function help() {
  if (mode === 'evolving' || mode === 'won') return;
  dialogReturn = mode === 'playing' || mode === 'paused' ? 'playing' : 'menu'; if (mode === 'playing') mode = 'paused';
  showDialog(`<div class="eyebrow">A RECIPE FOR BIG THINGS</div><h2 id="modal-title">Follow your tummy.</h2><p>Wander, chomp, grow. There are no enemies, timers, or wrong turns.</p><div class="help-rows"><div><span>01</span><div><strong>A little wander</strong><p>Drag the left joystick or use WASD / arrow keys. Swipe the world to turn the camera. While swimming or flying, push forward to travel in the direction you’re looking.</p></div></div><div><span>02</span><div><strong>A little nibble</strong><p>Get close to food and hold Chomp or Space. Follow the snack arrow to your next bite.</p></div></div><div><span>03</span><div><strong>A whole new you</strong><p>Fill your growth bar and transform right where you are. Hold Rise / E to go up, Dive / Q to go down, and release to hover. As an orca, tap Breach / E and hold Chomp for birds.</p></div></div><div><span>04</span><div><strong>An enormous ending</strong><p>The same world shrinks around you as you grow through all five forms. Eat every planet to finish. Progress saves on this browser automatically.</p></div></div></div><button id="got-it" class="primary">Got it. Let’s snack. ${icons.arrow}</button>`);
  el('got-it').onclick = closeDialog;
}
function evolve() {
  mode = 'evolving'; clearInput(); audio.evolve(); run.stage++; run.bites = 0; save();
  const stage = STAGES[run.stage]!;
  world.transform(run.stage); syncUI();
  el('evolution-icon').innerHTML = species[run.stage]!;
  el('evolution-name').textContent = stage.name;
  el('evolution-detail').textContent = stage.nickname;
  el('evolution-banner').hidden = false;
  leap = -1; leapCooldown = 0;
}

function win() {
  mode = 'won'; clearInput(); save(); audio.evolve();
  const minutes = Math.floor(run.elapsed / 60), seconds = Math.floor(run.elapsed % 60).toString().padStart(2, '0');
  showDialog(`<span class="modal-art cosmic">${species[4]}</span><div class="eyebrow">THE UNIVERSE WAS DELICIOUS</div><h2 id="modal-title">All full.<br>All yours.</h2><p>From a tiny shrimp to a cosmic cutie.<br>You ate every planet. Now, a well-earned nap.</p><div class="win-stats"><div><strong>${run.total}</strong><span>HAPPY BITES</span></div><div><strong>12 / 12</strong><span>PLANETS EATEN</span></div><div><strong>${minutes}:${seconds}</strong><span>YOUR ADVENTURE</span></div></div><button id="play-again" class="primary">One more little adventure ${icons.arrow}</button>`, false);
  el('play-again').onclick = () => { modal.close(); begin(true); };
}
function chomp() {
  if (mode !== 'playing' || cooldown > 0) return;
  cooldown = .24; chompPulse = 1;
  let hadBite = false;
  for (const f of world.edibleFoods) {
    if (!canEat(run.stage, world.player.position, f.data, 1 + run.bites / STAGES[run.stage]!.goal * .38)) continue;
    hadBite = true; const result = eat(run, f.data); world.removeFood(f); audio.bite(run.bites);
    if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
    const pos = world.screenPoint(new T.Vector3(f.data.x, f.data.y + 1, f.data.z));
    const label = document.createElement('span'); label.className = 'bite-floater'; label.textContent = ['yum!', 'nom!', 'delish!', '♡', 'one more!'][run.total % 5]!; label.style.left = `${pos.x}px`; label.style.top = `${pos.y}px`; el('floaters').append(label); setTimeout(() => label.remove(), 950);
    syncUI(); save();
    if (result === 'evolve') { evolve(); break; }
    if (result === 'win') { win(); break; }
  }
  if (!hadBite) audio.tone(170, 0, .065);
}
function special() {
  if (mode !== 'playing' || run.stage !== 2 || leap >= 0 || leapCooldown > 0) return;
  leap = 0; leapStart = world.player.position.y; leapCooldown = 2.3; audio.breach(); world.burst(world.player.position.x, world.surface, world.player.position.z, '#d6fff1', 22);
}
el('start').onclick = () => begin(); el('fresh').onclick = () => { dialogReturn = 'menu'; confirmRestart(); };
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
    if (target) { target.x = T.MathUtils.clamp(target.x, -34, 34); target.z = T.MathUtils.clamp(target.z, -34, 34); world.targetRing.position.copy(target); world.targetRing.position.y = world.groundAt(target.x, target.z) + .08; world.targetRing.scale.setScalar(.45); world.targetRing.visible = true; }
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
  if (mode !== 'playing') { el('food-pointer').hidden = true; el('snack-label').hidden = true; return; }
  let nearest = world.edibleFoods.filter(f => !f.data.eaten).sort((a, b) => {
    const p = world.player.position;
    return Math.hypot(a.data.x - p.x, a.data.z - p.z) + Math.abs(a.data.y - p.y) * .6 - Math.hypot(b.data.x - p.x, b.data.z - p.z) - Math.abs(b.data.y - p.y) * .6;
  })[0];
  if (!nearest) return;
  const f = nearest.data, p = world.player.position;
  const point = world.screenPoint(new T.Vector3(f.x, f.y + 1.4, f.z));
  const near = Math.hypot(f.x - p.x, f.z - p.z) < STAGES[run.stage]!.radius + 1;
  const names = FOOD_LABELS;
  const heightHint = f.y - p.y > 2.1 ? run.stage === 2 ? 'BREACH TO REACH!' : 'HOLD RISE TO REACH' : p.y - f.y > 2.1 ? 'HOLD DIVE TO REACH' : 'HOLD CHOMP';
  const onscreen = point.visible && point.x > 65 && point.x < innerWidth - 65 && point.y > 200 && point.y < innerHeight - 200;
  el('snack-label').hidden = !onscreen; el('food-pointer').hidden = onscreen;
  if (onscreen) { el('snack-label').style.left = `${point.x}px`; el('snack-label').style.top = `${point.y}px`; el('snack-label').textContent = near ? heightHint : names[f.kind].toUpperCase(); }
  else {
    const pp = world.screenPoint(p); const dx = (point.x - pp.x) * (point.visible ? 1 : -1), dy = (point.y - pp.y) * (point.visible ? 1 : -1);
    const angle = Math.atan2(dy, dx); const r = Math.min(innerWidth * .31, innerHeight * .27);
    el('food-pointer').style.left = `${innerWidth / 2 + Math.cos(angle) * r}px`; el('food-pointer').style.top = `${innerHeight / 2 + Math.sin(angle) * r}px`;
    el('pointer-arrow').style.transform = `rotate(${angle + Math.PI / 2}rad)`; el('pointer-label').textContent = near ? heightHint : names[f.kind].toUpperCase();
  }
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now;
  const active = mode === 'playing' || mode === 'menu' || mode === 'evolving'; if (active) time += dt;
  let moving = false;
  if (mode === 'playing') {
    run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); leapCooldown = Math.max(0, leapCooldown - dt); chompPulse = Math.max(0, chompPulse - dt * 5);
    const s = STAGES[run.stage]!, p = world.player.position;
    let dx = stickX + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    let dz = stickZ + Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    if (Math.abs(dx) + Math.abs(dz) > .05) { target = null; world.targetRing.visible = false; }
    if (target) { dx = target.x - p.x; dz = target.z - p.z; if (Math.hypot(dx, dz) < .25) { target = null; dx = 0; dz = 0; world.targetRing.visible = false; } }
    const length = Math.hypot(dx, dz); moving = length > .07;
    if (moving) {
      const normalized = Math.min(1, length) / Math.max(length, .001);
      const direction = target ? new T.Vector3(dx * normalized, 0, dz * normalized) : world.moveVector(dx * normalized, dz * normalized, run.stage > 0);
      p.addScaledVector(direction, dt * s.speed);
      p.x = T.MathUtils.clamp(p.x, -38, 38); p.z = T.MathUtils.clamp(p.z, -38, 38);
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
        p.y += vertical * dt * s.speed * .7;
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
  world.update(active ? dt : 0, time, mode === 'menu', moving, chompPulse, 1 + run.bites / STAGES[run.stage]!.goal * .38);
  if (mode === 'evolving' && !world.transitioning) { mode = 'playing'; el('evolution-banner').hidden = true; toast(STAGES[run.stage]!.nickname); }
  const depth = world.player.position.y / world.surface;
  el('depth-label').textContent = run.stage === 4 ? 'DEEP SPACE' : depth > 1.15 ? 'OPEN SKY' : depth > .88 ? 'THE SURFACE' : depth > .25 ? 'MIDWATER' : 'THE SEAFLOOR';
  el('depth-dot').style.bottom = `${T.MathUtils.clamp(depth * 72, 3, 96)}%`;
  el('depth-hint').textContent = run.stage === 0 ? 'LOOK UP ↑' : run.stage === 4 ? 'A WHOLE UNIVERSE' : 'SURFACE ↑';
  uiClock += dt; if (uiClock > .1) { updateGuide(); uiClock = 0; }
}
// Read-only diagnostics allow browser verification to steer with real controls.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
  Object.defineProperty(window, '__tinyTide', { get: () => ({ mode, stage: run.stage, bites: run.bites, total: run.total, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), leap, time, render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries } }) });
}
requestAnimationFrame(frame);
