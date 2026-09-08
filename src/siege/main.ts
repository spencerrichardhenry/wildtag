import { startAnalytics } from '../analytics';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AMMO, LAUNCH, WIN_PERCENT, clamp, normalizePull, trajectory, type Pull, type Vector3 } from './layout';
import { SiegeSimulation, type Burst, type Shot } from './physics';
import { ammoModel, environment, makeThumbnails, material, box, slingshotModel, sphere, stoneModel } from './models';
import { MATERIALS } from './materials';
import { Sound } from './audio';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const soundIcon = (muted: boolean) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/>${muted ? '<path d="m16 9 6 6m0-6-6 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;

async function boot() {
  await RAPIER.init();
  const canvas = $<HTMLCanvasElement>('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const scene = new THREE.Scene(), clouds = environment(scene);
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 230);
  const cameraPosition = new THREE.Vector3(0, 10.8, 38);
  const cameraTarget = new THREE.Vector3(0, -1.35, -9);
  const lookTarget = cameraTarget.clone();
  const shotFocus = new THREE.Vector3(0, 3, -12);
  const sound = new Sound(), thumbnails = makeThumbnails();
  const params = new URLSearchParams(location.search);
  const configuredLimit = Number(params.get('shots'));
  const shotLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? clamp(Math.floor(configuredLimit), 1, 99) : undefined;
  let seed = Number(params.get('seed')) || Math.floor(Math.random() * 99999) + 1;
  let simulation = new SiegeSimulation(seed, { shotLimit });
  let modal: 'help' | 'result' | null = null, previousFocus: HTMLElement | null = null;
  let resultShown = false, resultAt = 0, toastUntil = 0, shake = 0;
  let lastDamage = -1, lastShots = -1, lastReady = false, lastLaunch = -10;
  let hadShot = false, keyboardCharge = false;
  let power = 75, lastScore = -1;
  let bonusUntil = 0;
  const markers = new Map<string, HTMLElement>();
  let aimedAt: ReturnType<SiegeSimulation['aimTarget']> = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const castle = new THREE.Group(); scene.add(castle);
  const stoneViews = new Map<number, THREE.Group>(), shotViews = new Map<number, THREE.Group>();
  const sling = slingshotModel(); scene.add(sling.group);
  const pouch = new THREE.Vector3(LAUNCH.x, LAUNCH.y, LAUNCH.z);
  let loaded = ammoModel(simulation.currentAmmo); scene.add(loaded);
  let pull: Pull = { x: 0, y: 0 };
  let drag: { id: number; x: number; y: number; target: HTMLElement } | null = null;
  const center = new THREE.Vector2(), pointer = new THREE.Vector3();
  const dragRadius = () => Math.min(145, innerHeight * .16);

  $('hud').innerHTML = `
    <header class="topbar"><div class="brand"><h1>ROYAL YEET</h1><p>A VERY UNSERIOUS SIEGE</p></div><div class="top-actions"><button id="sound" class="icon-button" aria-label="Mute sound" aria-pressed="false">${soundIcon(false)}</button><button id="help" class="icon-button" aria-label="How to play">?</button><button id="new" class="icon-button" aria-label="New fortress" title="New fortress">⟳</button></div></header>
    <section class="scoreboard" aria-label="Demolition progress"><div class="damage-line"><span class="eyebrow">VILLAGE DAMAGE</span><div class="damage-track" role="progressbar" aria-label="Castle damage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="damage-progress"><div class="damage-fill" id="damage-fill"></div><span class="goal-tick"></span></div><strong id="damage">0%</strong></div><div class="score-foot"><span id="fortress-name"></span><span>Wreck ${WIN_PERCENT}% to win</span></div><div class="score-total"><span>✦ <b id="score">0</b> points</span><span id="bonus-count">0 bonus targets</span></div></section><div id="bonus-feed" class="bonus-feed" role="status" aria-live="polite"></div><div id="landmarks"></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <div id="launch-hint" class="launch-hint"><strong id="gesture-title">PULL BACK & RELEASE</strong><span id="gesture-detail">Set power below. Drag the pouch to aim.</span></div>
    <button id="sling-grab" class="sling-grab" aria-label="Slingshot pouch: drag to aim, then release; power is set separately" aria-describedby="keyboard-help"><span class="grab-ring" aria-hidden="true"></span></button>
    <span class="sr-only" id="keyboard-help">Keyboard: hold Space, use arrow keys to aim, release Space to shoot. Set power with the slider. Escape cancels.</span>
    <button id="special" class="special-button"><span id="special-label">Special delivery</span><span aria-hidden="true">✦</span></button>
    <footer class="bottom-hud"><div class="round-label"><span id="round-mode">DEMO LEVEL</span><span class="round-divider">·</span><span id="shot-budget">∞ SHOTS</span></div><div id="aim-target" class="aim-target" aria-live="polite"></div><label class="power-control" for="power"><span>POWER</span><input id="power" type="range" min="25" max="100" value="75" aria-label="Launch power" /><output id="power-value" for="power">75%</output></label><section class="ammo-queue" aria-label="Projectile queue"><div class="queue-item current"><img id="current-image" alt="" /><div><span class="eyebrow" id="current-label">IN THE SLING</span><strong id="current-name"></strong></div></div><span class="queue-arrow" aria-hidden="true">›</span><div class="queue-item upcoming"><img id="next-image" alt="" /><div><span class="eyebrow">UP NEXT</span><strong id="next-name"></strong></div></div></section><p class="round-foot"><span id="shots-fired">0 shots fired</span><span>Empty castle. Full send.</span></p></footer>
    <div class="modal-backdrop" id="help-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button class="close-modal" data-close aria-label="Close instructions">×</button><span class="eyebrow">A QUICK FIELD MANUAL</span><h2 id="help-title">GRAB. STRETCH. YEET.</h2><ol><li><b>Touch the middle of the slingshot.</b> Your current projectile is already loaded.</li><li><b>Set power with the slider.</b> Drag the pouch to aim: left or right steers the opposite way; down aims higher and up aims lower.</li><li><b>Let go.</b> Watch the village crumble. The next projectile loads automatically.</li></ol><p>Rockets boost and catapults fire their watermelons automatically. Tap the special button in flight to activate them early or detonate a bomb.</p><p>Gold markers show bonus targets. Demolish 55% of a marked building to claim its bonus, or smash the treasury chest for its gold.</p><div class="material-guide">${Object.values(MATERIALS).map(m => `<div><i style="background:${m.color}"></i><span><b>${m.name}</b> ${m.description}</span></div>`).join('')}</div><p id="budget-help"></p><button class="primary-button" data-close>LET'S WRECK IT <span>↗</span></button></section></div>
    <div class="modal-backdrop" id="result-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="result-title"><button class="close-modal" data-close aria-label="Close result">×</button><div class="result-symbol" aria-hidden="true">✦</div><span class="eyebrow" id="result-eyebrow"></span><h2 id="result-title"></h2><p id="result-message"></p><div class="result-stats"><div><strong id="result-damage"></strong><span>DEMOLISHED</span></div><div><strong id="result-shots"></strong><span>SHOTS FIRED</span></div></div><button class="primary-button" id="result-action"></button><button class="text-button" data-close id="keep-playing">Keep demolishing</button></section></div>`;
  $('round-mode').textContent = shotLimit ? 'DEMO CHALLENGE' : 'DEMO LEVEL';
  $('budget-help').textContent = shotLimit ? `This round gives you ${shotLimit} shots. Wreck ${WIN_PERCENT}% of the castle to win.` : `This demo has unlimited shots. Wreck ${WIN_PERCENT}% of the castle to win, or just keep playing.`;

  const dots = new THREE.Group(); scene.add(dots); dots.visible = false;
  for (let i = 0; i < 47; i++) { const dot = sphere(dots, '#fff6d6', 0, 0, 0, .095 + i * .0015); dot.castShadow = false; dot.receiveShadow = false; }
  const particleGeometry = new THREE.IcosahedronGeometry(1, 0);
  interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; max: number; base: number }
  const particles: Particle[] = [];
  function particle(position: Vector3, color: string, size: number, velocity: Vector3, life: number) {
    if (particles.length > 220) return;
    const mesh = new THREE.Mesh(particleGeometry, material(color)); mesh.position.copy(position); mesh.scale.setScalar(size); scene.add(mesh);
    particles.push({ mesh, velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z), life, max: life, base: size });
  }
  function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('show'); toastUntil = performance.now() + 1400; }
  function burst(event: Burst) {
    const colors = event.kind === 'glass' ? ['#a1dccc', '#dcfff1', '#81bbaa'] : event.kind === 'timber' ? ['#b38350', '#dcc399', '#87613f'] : event.kind === 'iron' ? ['#697879', '#aebcb5', '#455457'] : event.kind === 'watermelon' ? ['#e56163', '#f39a87', '#5e954b', '#2e6341'] : event.kind === 'bomb' || event.kind === 'rocket' || event.kind === 'powder' ? ['#ffd37a', '#f2a156', '#e67b4e', '#c6b990'] : ['#e9dab7', '#b9ac87', '#d8cba8', '#f4e8c8'];
    for (let i = 0; i < 18 + event.strength * 20; i++) {
      const a = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 9 * event.strength;
      particle(event, colors[i % colors.length]!, .12 + Math.random() * .35, { x: Math.cos(a) * speed, y: 3 + Math.random() * speed, z: Math.sin(a) * speed }, .6 + Math.random() * .9);
    }
    if (event.strength > .3) { shake = Math.min(.2, event.strength * .1); sound.impact(event.strength); }
    const messages: Partial<Record<Burst['kind'], string>> = { cow: 'UDDER DESTRUCTION!', bomb: 'THAT SHOULD DO IT.', rocket: 'HOUSTON, WE HAVE RUBBLE.', watermelon: 'FRESHLY SQUEEZED!', catapult: 'SPECIAL DELIVERY!', bowling: 'STRIKE!', powder: 'CHAIN REACTION!' };
    if (messages[event.kind]) toast(messages[event.kind]!);
  }
  function updateQueue() {
    const current = AMMO.find(a => a.id === simulation.currentAmmo)!;
    const next = AMMO.find(a => a.id === simulation.nextAmmo);
    $<HTMLImageElement>('current-image').src = thumbnails.get(current.id)!;
    $('current-name').textContent = simulation.shotsLeft === 0 ? 'All used up' : current.name;
    $('current-image').style.opacity = simulation.shotsLeft === 0 ? '.25' : '1';
    $<HTMLImageElement>('next-image').src = next ? thumbnails.get(next.id)! : thumbnails.get(current.id)!;
    $('next-image').style.visibility = next ? 'visible' : 'hidden'; $('next-name').textContent = next?.name ?? '—';
    $('shot-budget').textContent = simulation.shotsLeft === null ? '∞ SHOTS' : `${simulation.shotsLeft} SHOT${simulation.shotsLeft === 1 ? '' : 'S'} LEFT`;
    $('shots-fired').textContent = `${simulation.shotCount} shot${simulation.shotCount === 1 ? '' : 's'} fired`;
    scene.remove(loaded); loaded = ammoModel(current.id); loaded.scale.setScalar(.9); loaded.rotation.y = -.25; scene.add(loaded);
    lastShots = simulation.shotCount;
  }
  function buildCastle() {
    renderer.shadowMap.needsUpdate = true;
    castle.clear(); stoneViews.clear(); markers.clear(); $('landmarks').replaceChildren();
    for (const building of simulation.buildings) {
      const b = building.spec;
      if (b.kind !== 'fortress' && b.kind !== 'keep') {
        box(castle, '#b9b082', b.x, .04, b.z, b.width + .5, .06, b.depth + .5);
        const road = box(castle, '#c6bd8b', b.x / 2, .045, b.z + b.depth / 2 + 1, Math.abs(b.x), .04, 1.05); road.receiveShadow = true;
      }
      if (['treasury', 'powder-store', 'windmill', 'forge'].includes(b.kind)) {
        const marker = document.createElement('div'); marker.className = 'landmark'; marker.textContent = `✦ ${b.bonus}`; marker.title = `${b.name} bonus`;
        $('landmarks').append(marker); markers.set(b.id, marker);
      }
    }
    for (const stone of simulation.stones) { const view = stoneModel(stone.spec); stoneViews.set(stone.spec.id, view); castle.add(view); }
    $('fortress-name').textContent = simulation.layout.name; lastDamage = -1; lastScore = -1; updateQueue();
  }
  function cancelDrag() {
    const previousDrag = drag; drag = null; keyboardCharge = false; pull = { x: 0, y: 0 }; dots.visible = false; aimedAt = null; $('aim-target').textContent = '';
    if (previousDrag?.target.hasPointerCapture(previousDrag.id)) previousDrag.target.releasePointerCapture(previousDrag.id);
    $('sling-grab').classList.remove('drawing');
  }
  function showModal(type: 'help' | 'result') {
    cancelDrag(); previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal = type; $(`${type}-modal`).classList.add('open'); $(`${type}-modal`).querySelector<HTMLButtonElement>('button')?.focus();
  }
  function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.remove('open')); modal = null; previousFocus?.focus();
  }
  function newFortress(retry = false) {
    cancelDrag(); closeModal(); simulation.dispose(); if (!retry) seed = Math.floor(Math.random() * 99999) + 1;
    simulation = new SiegeSimulation(seed, { shotLimit });
    for (const view of shotViews.values()) scene.remove(view); shotViews.clear();
    for (const p of particles) scene.remove(p.mesh); particles.length = 0;
    resultShown = false; resultAt = 0; hadShot = false; lastLaunch = -10; shake = 0; lastReady = false;
    $('toast').classList.remove('show'); toastUntil = 0; $('bonus-feed').classList.remove('show'); buildCastle();
  }
  function finishShot() {
    const released = { ...pull }, kind = simulation.currentAmmo;
    const focus = simulation.aimTarget(released, power)?.point ?? trajectory(released, 1.1, power);
    shotFocus.set(clamp(focus.x, -15, 15), clamp(focus.y, 1, 7), clamp(focus.z, -24, 10));
    cancelDrag();
    if (modal || !simulation.launch(released, power)) return;
    sound.launch(kind); hadShot = true; lastLaunch = simulation.time; updateQueue();
  }
  function updateAim() {
    dots.visible = (drag !== null || keyboardCharge) && Math.hypot(pull.x, pull.y) >= .12;
    aimedAt = dots.visible ? simulation.aimTarget(pull, power) : null;
    $('aim-target').textContent = aimedAt ? `${aimedAt.building.spec.name} · ${MATERIALS[aimedAt.stone.spec.material].name}${aimedAt.building.spec.bonus && !aimedAt.building.awarded ? ` · +${aimedAt.building.spec.bonus}` : ''}` : '';
    let ended = false;
    dots.children.forEach((dot, i) => {
      const p = trajectory(pull, i * .052, power); dot.position.copy(p); dot.visible = !ended && p.y > .12;
      if (p.y <= .12 || (aimedAt && Math.hypot(p.x - LAUNCH.x, p.z - LAUNCH.z) >= Math.hypot(aimedAt.point.x - LAUNCH.x, aimedAt.point.z - LAUNCH.z))) ended = true;
    });
  }
  function beginDrag(event: PointerEvent) {
    if (event.button !== 0 || drag || keyboardCharge || modal || !simulation.canFire) return;
    if (Math.hypot(event.clientX - center.x, event.clientY - center.y) > 58) return;
    event.preventDefault(); sound.unlock();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.currentTarget as HTMLElement };
    drag.target.setPointerCapture(event.pointerId); $('sling-grab').classList.add('drawing');
  }
  $('sling-grab').addEventListener('pointerdown', beginDrag); canvas.addEventListener('pointerdown', beginDrag);
  addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    pull = normalizePull((event.clientX - drag.x) / dragRadius(), (event.clientY - drag.y) / dragRadius()); updateAim();
  });
  addEventListener('pointerup', event => { if (drag && event.pointerId === drag.id) finishShot(); });
  addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) cancelDrag(); });
  for (const element of [canvas, $('sling-grab')]) element.addEventListener('lostpointercapture', event => { if (drag?.id === (event as PointerEvent).pointerId) cancelDrag(); });
  $('power').addEventListener('input', () => { power = Number($<HTMLInputElement>('power').value); $('power-value').textContent = `${power}%`; if (drag || keyboardCharge) updateAim(); });
  $('special').addEventListener('click', () => { sound.unlock(); simulation.special(); });
  $('new').addEventListener('click', () => newFortress());
  $('result-action').addEventListener('click', () => newFortress(!simulation.won));
  $('help').addEventListener('click', () => showModal('help'));
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  $('sound').addEventListener('click', () => {
    sound.unlock(); sound.muted = !sound.muted; $('sound').innerHTML = soundIcon(sound.muted);
    $('sound').setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound'); $('sound').setAttribute('aria-pressed', String(sound.muted));
  });
  addEventListener('keydown', event => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Escape') { cancelDrag(); if (modal) closeModal(); return; }
    if (modal) {
      if (event.code === 'Tab') {
        const controls = [...$(`${modal}-modal`).querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
        const first = controls[0]!, last = controls[controls.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.code === 'Space' && event.target === $('sling-grab')) {
      event.preventDefault();
      if (simulation.activeShot) { if (!event.repeat) simulation.special(); return; }
      if (!simulation.canFire || drag || keyboardCharge) return;
      sound.unlock(); keyboardCharge = true; pull = { x: 0, y: .42 }; updateAim();
    } else if (keyboardCharge && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
      event.preventDefault(); if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') pull.x = clamp(pull.x + (event.code === 'ArrowLeft' ? -.06 : .06), -1, 1); else pull.y = clamp(pull.y + (event.code === 'ArrowDown' ? .06 : -.06), -1, 1); updateAim();
    }
  });
  addEventListener('keyup', event => { if (event.code === 'Space' && keyboardCharge) { event.preventDefault(); finishShot(); } });
  addEventListener('blur', cancelDrag);

  function resize() {
    cancelDrag(); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < .8 ? 66 : camera.aspect < 1.2 ? 56 : 48; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  let previous = performance.now(), accumulator = 0, trailTimer = 0;
  document.addEventListener('visibilitychange', () => { cancelDrag(); previous = performance.now(); accumulator = 0; });
  buildCastle(); resize(); $('loading').remove();
  startAnalytics('royal-yeet', () => modal === null);
  Object.defineProperty(window, '__siege', { configurable: true, get: () => ({ seed, name: simulation.layout.name, blocks: simulation.stones.length,
    damage: simulation.destruction, shots: simulation.shotCount, shotsLeft: simulation.shotsLeft, current: simulation.currentAmmo, next: simulation.nextAmmo,
    ready: simulation.canFire, won: simulation.won, exhausted: simulation.exhausted, time: simulation.time, power, score: simulation.score, target: aimedAt?.building.spec.name ?? null, buildings: simulation.buildings.map(b => ({ ...b.spec, awarded: b.awarded, damage: Math.round(b.stones.filter(s => s.destroyed).length / b.stones.length * 100) })), pull: { ...pull }, dragging: !!drag || keyboardCharge,
    sling: { x: center.x, y: center.y, radius: dragRadius() }, camera: { type: camera.type, position: camera.position.toArray() },
    projectiles: simulation.shots.filter(s => !s.expired).map(s => ({ kind: s.kind, age: s.age, special: s.usedSpecial, position: s.body.translation() })),
    render: { calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries },
  }) });

  function renderShot(shot: Shot) {
    if (shot.expired) return;
    let view = shotViews.get(shot.id);
    if (!view) { view = ammoModel(shot.kind); shotViews.set(shot.id, view); scene.add(view); }
    const p = shot.body.translation(); view.position.copy(p);
    if (shot.kind === 'rocket') {
      const v = shot.body.linvel(); view.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(v.x, v.y, v.z).normalize());
    } else view.quaternion.copy(shot.body.rotation());
    if (shot.kind === 'catapult' && shot.usedSpecial) { const melon = view.getObjectByName('melon'); if (melon) melon.visible = false; }
    if (trailTimer <= 0 && !shot.impacted) {
      particle(p, shot.kind === 'rocket' && shot.usedSpecial ? '#ffc269' : '#faf2d8', .12, { x: 0, y: .3, z: 1 }, .45);
    }
  }
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - previous) / 1000, .1); previous = now;
    if (document.hidden) return;
    if (modal !== 'help') { accumulator += dt; while (accumulator >= 1 / 60) { simulation.step(); accumulator -= 1 / 60; } }
    for (const stone of simulation.stones) {
      const view = stoneViews.get(stone.spec.id)!; view.visible = !stone.shattered; view.position.copy(stone.body.translation()); view.quaternion.copy(stone.body.rotation());
      const rotor = view.getObjectByName('rotor'); if (rotor && !stone.destroyed && !reducedMotion) rotor.rotation.z = now * .0005;
      const flag = view.getObjectByName('flag'); if (flag && !reducedMotion) flag.rotation.y = Math.sin(now * .003 + stone.spec.id) * .17;
    }
    trailTimer -= dt; simulation.shots.forEach(renderShot); if (trailTimer <= 0) trailTimer = .06;
    const liveIds = new Set(simulation.shots.filter(s => !s.expired).map(s => s.id));
    for (const [id, view] of shotViews) if (!liveIds.has(id)) { scene.remove(view); shotViews.delete(id); }
    simulation.bursts.splice(0).forEach(burst);
    const bonuses = simulation.bonuses.splice(0);
    if (bonuses.length) { $('bonus-feed').textContent = bonuses.map(b => `${b.name} +${b.points}`).join(' · '); $('bonus-feed').classList.add('show'); bonusUntil = now + 3300; sound.tone(540, 880, .3, .04, 'triangle'); }
    if (bonusUntil < now) $('bonus-feed').classList.remove('show');
    if (lastScore !== simulation.score) { lastScore = simulation.score; $('score').textContent = lastScore.toLocaleString(); $('bonus-count').textContent = `${simulation.buildings.filter(b => b.awarded).length} / ${simulation.buildings.filter(b => b.spec.bonus > 0).length} bonuses`; }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!; p.life -= dt;
      if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); continue; }
      p.velocity.y -= 9 * dt; p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.position.y < .1) { p.mesh.position.y = .1; p.velocity.y *= -.25; p.velocity.x *= .94; p.velocity.z *= .94; }
      p.mesh.scale.setScalar(p.base * Math.min(1, p.life / p.max * 3)); p.mesh.rotation.z += dt * 2;
    }
    const sinceLaunch = simulation.time - lastLaunch;
    const follow = reducedMotion ? 0 : Math.sin(clamp((sinceLaunch - .12) / 3.2, 0, 1) * Math.PI);
    camera.position.copy(cameraPosition); camera.position.z -= follow * clamp((LAUNCH.z - shotFocus.z) * .35, 3, 15); camera.position.y += follow * 5.5; camera.position.x += follow * (shotFocus.x * .6 + 2.5);
    shake = Math.max(0, shake - dt * .65);
    if (!reducedMotion && shake > 0) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; }
    lookTarget.copy(cameraTarget).lerp(shotFocus, follow);
    camera.lookAt(lookTarget); camera.updateMatrixWorld();
    for (const building of simulation.buildings) {
      const marker = markers.get(building.spec.id); if (!marker) continue;
      const p = new THREE.Vector3(building.spec.x, building.spec.height + .55, building.spec.z).project(camera);
      marker.style.left = `${(p.x + 1) / 2 * innerWidth}px`; marker.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
      marker.hidden = building.awarded || !!modal || p.z > 1 || Math.abs(p.x) > .93 || p.y > .57 || p.y < -.35;
    }
    const projected = new THREE.Vector3(LAUNCH.x, LAUNCH.y, LAUNCH.z).project(camera);
    center.set((projected.x + 1) / 2 * innerWidth, (1 - projected.y) / 2 * innerHeight);
    $('sling-grab').style.left = `${center.x}px`; $('sling-grab').style.top = `${center.y}px`;
    $('launch-hint').style.left = `${center.x}px`; $('launch-hint').style.top = `${center.y - (innerWidth < 760 ? 104 : 125)}px`;
    if (drag || keyboardCharge) {
      pointer.set((center.x + pull.x * dragRadius()) / innerWidth * 2 - 1, 1 - (center.y + pull.y * dragRadius()) / innerHeight * 2, projected.z).unproject(camera);
      pouch.copy(pointer); pouch.y = Math.max(.95, pouch.y);
    } else pouch.lerp(new THREE.Vector3(LAUNCH.x, LAUNCH.y, LAUNCH.z), Math.min(1, dt * 24));
    sling.update(pouch); loaded.position.copy(pouch); loaded.visible = simulation.canFire && !modal;
    loaded.rotation.z = reducedMotion ? 0 : Math.sin(now * .0015) * .035;
    $('sling-grab').style.visibility = simulation.canFire && !modal ? 'visible' : 'hidden';
    $('sling-grab').classList.toggle('used', hadShot);
    $('launch-hint').style.opacity = simulation.canFire && !modal ? '1' : '0';
    $('gesture-title').textContent = drag || keyboardCharge ? Math.hypot(pull.x, pull.y) < .12 ? 'DRAG TO AIM' : 'LET IT FLY' : hadShot ? 'NEXT ONE IS READY' : 'AIM. RELEASE. WRECK.';
    $('gesture-detail').textContent = drag || keyboardCharge ? 'Release to shoot · return to cancel' : hadShot ? 'Power sets speed. The pouch sets direction.' : 'Set power below. Drag the pouch to aim.';
    if (simulation.shotCount !== lastShots) updateQueue();
    if (simulation.canFire !== lastReady) { lastReady = simulation.canFire; $('current-label').textContent = lastReady ? 'IN THE SLING' : simulation.shotsLeft === 0 ? 'NO SHOTS LEFT' : 'LOADING'; }
    if (simulation.destruction !== lastDamage) {
      lastDamage = simulation.destruction; $('damage').textContent = `${lastDamage}%`; $('damage-fill').style.width = `${lastDamage}%`;
      $('damage-progress').setAttribute('aria-valuenow', String(lastDamage));
    }
    const active = simulation.activeShot; $('special').classList.toggle('show', !!active && !modal);
    if (active) $('special-label').textContent = active.kind === 'bomb' ? 'Tap to detonate' : active.kind === 'rocket' ? 'Tap to boost' : 'Launch the watermelon';
    if (toastUntil < now) $('toast').classList.remove('show');
    if (!resultShown && !resultAt && (simulation.won || simulation.exhausted)) resultAt = now + (simulation.won ? 1200 : 600);
    if (!resultShown && resultAt && now > resultAt && !modal) {
      resultShown = true;
      $('result-eyebrow').textContent = simulation.won ? 'A SPECTACULAR LACK OF FORTRESS' : 'THE CASTLE LIVES ANOTHER DAY';
      $('result-title').textContent = simulation.won ? 'ROYALLY WRECKED.' : 'OUT OF SHOTS.';
      $('result-message').textContent = simulation.won ? `A royal mess. ${simulation.score.toLocaleString()} points, including ${simulation.buildings.filter(b => b.awarded).length} building bonuses.` : 'Try another approach. Take out the supports and let gravity help.';
      $('result-damage').textContent = `${simulation.destruction}%`; $('result-shots').textContent = String(simulation.shotCount);
      $('result-action').textContent = simulation.won ? 'ANOTHER UNLUCKY CASTLE ↗' : 'TRY THIS CASTLE AGAIN ↗';
      $('keep-playing').hidden = !simulation.won || simulation.shotsLeft === 0;
      showModal('result'); if (simulation.won) sound.tone(400, 800, .5, .08, 'triangle');
    }
    if (!reducedMotion) clouds.position.x = Math.sin(now * .000025) * 2;
    if (drag || keyboardCharge || sinceLaunch < 8) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
void boot().catch(error => {
  console.error('Royal Yeet could not start', error);
  const loading = $('loading');
  if (loading) loading.innerHTML = '<strong>A LITTLE LAUNCH TROUBLE.</strong><p>The game could not start. Reload to try again, and make sure WebGL is enabled.</p><button onclick="location.reload()">Try again</button>';
});
