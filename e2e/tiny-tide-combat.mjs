// Tiny Tide combat 3a browser checks (spec §14.2): controls, telegraphs, hit-stop, the faint rule, the alpha, the editor moves panel, hints
// and frame time (plan review R18). Needs the running dev server (TIDE_BASE, default http://127.0.0.1:5199).
// Run one or more checks: node e2e/tiny-tide-combat.mjs hit-stop alpha. TIDE_SEED=<n> sets the world seed of every fixture (default 1501).
// Every bot aims with the pointer at the target's projected position (keyboard-only aim along the camera is not a valid fight).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { control, frames, KEYS, makeFixture, openGame, start, state, steer, storageOf, untilGameTime, watchErrors, eatOnce } from './fixtures/tiny-tide-fixtures.mjs';

const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const SEED = Number(process.env.TIDE_SEED ?? 1501);
if (!Number.isInteger(SEED)) throw new Error(`TIDE_SEED must be an integer, got ${process.env.TIDE_SEED}`);
// --enable-precise-memory-info: the frame-time check reads the JS heap per frame (allocation estimate).
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const checks = [];
const check = (id, fn, wallSeconds = 240) => checks.push({ id, fn, wallSeconds });
const DEG = Math.PI / 180, SIZES = [1, 4, 16, 64, 256];
/** A carnivore Swimmer (size 1, Snapper) with Brace, Counter, Dash (Paddle tail) and Grab: slots 1–4 in priority order. A carnivore Bites any
 *  combat species in the cone; a herbivore Bites only one engaged with it (review R17), and a size-1 crab is calm toward a size-1 player. */
const FOUR = { seed: SEED, stage: 1, line: 'swimmer', mouth: { 1: 'mouth_snapper' }, add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }] } };
/** FOUR and a Fan tail: Sweep is the fifth kind (inactive). */
const FIVE = { seed: SEED, stage: 1, line: 'swimmer', mouth: { 1: 'mouth_snapper' }, add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }, { id: 'tail_fan', t: .9 }] } };
/** Facts each check reports (seeds, measured numbers); printed after the check. */
let facts = {};

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage(), errors = watchErrors(page);
  page.setDefaultTimeout(20000);
  return { context, page, errors };
}
async function play(page, spec, query = '', beforeStart = async () => {}) {
  const fx = await makeFixture(page, { seed: SEED, ...spec });
  await openGame(page, { storage: { [fx.key]: fx.json }, query });
  await beforeStart();
  await start(page);
  facts.seed = fx.run?.seed ?? SEED;
  page.bodyLength = await bodyLength(page);
  return fx;
}
const playerActions = s => s.combat.actions.filter(a => a.actor === 'player');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Polls the page every animation frame and records `pick(state)` until `done(samples)`, `seconds` of game time, or a real-time cap. */
async function record(page, pick, done, seconds, label, wallSeconds = seconds * 4 + 10) {
  const r = await page.evaluate(([pickSrc, doneSrc, seconds, wall]) => new Promise(resolve => {
    const pick = new Function('s', `return (${pickSrc})(s);`), done = new Function('xs', `return (${doneSrc})(xs);`), out = [], t0 = window.__tinyTide.time, w0 = performance.now();
    const tick = () => {
      const s = window.__tinyTide; out.push(pick(s));
      if (done(out)) return resolve({ ok: true, out });
      if (s.time - t0 > seconds || performance.now() - w0 > wall * 1000) return resolve({ ok: false, out });
      requestAnimationFrame(tick);
    };
    tick();
  }), [pick.toString(), done.toString(), seconds, wallSeconds]);
  if (!r.ok) throw new Error(`${label}: not within ${seconds} s of game time (${wallSeconds} s real time)`);
  return r.out;
}
/** Starts recording `pick(state)` every animation frame in the page (bounded to 20000 samples); `stopRecorder` returns the samples. */
async function startRecorder(page, pick) {
  await page.evaluate(src => {
    const pick = new Function('s', `return (${src})(s);`), out = []; window.__rec = { out, on: true };
    const tick = () => { if (!window.__rec?.on || window.__rec.out !== out) return; out.push(pick(window.__tinyTide)); if (out.length > 20000) out.shift(); requestAnimationFrame(tick); };
    tick();
  }, pick.toString());
}
const stopRecorder = page => page.evaluate(() => { const r = window.__rec; if (!r) return []; r.on = false; return r.out; });
/** The screen point (CSS pixels) of a physical point. */
const screenOf = (page, p) => page.evaluate(p => window.__tinyTide.screenOf(p), p);
/** The screen point that aims at a creature: the pointer ray meets the horizontal plane through the player (spec §8.4), so the bot points at
 *  the creature's place at the player's height (a free mover's pitch then follows the soft lock, D9). */
const aimPoint = (s, e) => ({ x: e.x, y: s.physical.y, z: e.z });
/** Moves the pointer so that the aim points at creature `e` (pointer aim); false when that point is off screen. */
async function aimAt(page, s, e) {
  const v = await screenOf(page, aimPoint(s, e)); if (!v.visible) return false;
  const vp = page.viewportSize(); if (v.x < 2 || v.y < 2 || v.x > vp.width - 2 || v.y > vp.height - 2) return false;
  await page.mouse.move(v.x, v.y); return v;
}
/** Left-clicks with the aim on creature `e` (Bite when it is in the cone). */
async function clickAt(page, s, e) { const v = await aimAt(page, s, e); if (v) await page.mouse.click(v.x, v.y); return !!v; }
/** The player's body length L (physical units). */
const bodyLength = page => page.evaluate(() => { const t = window.__tinyTide; return t.poseAgreement().bodyLength * t.world.scale; });
/** The gap between the player's centre and the encounter creature's hull (centre distance less about .35 of its length), in player L. */
const gapL = (page, s) => { const e = s.combat.encounter; return e ? (dist(s.physical, e) - .35 * e.bodyLength) / page.bodyLength : Infinity; };
/** The player faces the creature within `deg` of yaw. */
const facing = (s, e, deg = 25) => { const want = Math.atan2(e.x - s.physical.x, e.z - s.physical.z), d = want - s.orientation.yaw; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) <= deg * DEG; };
/** In Bite reach: facing the creature with a gap of .45–.9 L. The Bite cone starts at the mouth (about .5 L ahead of the centre), so a creature
 *  closer than that lies beside or under the mouth, outside the cone. */
const inReach = (page, s) => { const g = gapL(page, s); return g >= .45 && g <= .9 && facing(s, s.combat.encounter); };
/** Dive (Q) or Rise (E) toward a target's height when the plan can (a free mover drifts off the seabed while it aims down). */
function verticalKeys(page, s, e) {
  const dy = e.y - s.physical.y, L = page.bodyLength;
  if (s.caps.dive && !s.caps.breach && dy < -.3 * L) return ['KeyQ'];
  if (s.caps.rise && !s.caps.breach && dy > .3 * L) return ['KeyE'];
  return [];
}
/** Walks toward the `qaEncounter` creature (camera-relative keys) with the pointer on it, until `near(state)`; bounded in loops and real time. */
async function approach(page, near, label, wallSeconds = 40) {
  const w0 = Date.now();
  for (let i = 0; i < 400 && Date.now() - w0 < wallSeconds * 1000; i++) {
    const s = await state(page), e = s.combat.encounter; assert.ok(e && !e.eaten, `${label}: the encounter is alive`);
    if (near(s)) { await control(page, []); return s; }
    const size = SIZES[s.stage];
    await aimAt(page, s, e);
    // Too close: back off first; then walk at it (the walk turns the body toward it).
    const away = gapL(page, s) < .45, goal = away ? { x: 2 * s.player.x - e.x / size, z: 2 * s.player.z - e.z / size } : { x: e.x / size, z: e.z / size };
    await control(page, [...steer(s, goal, .2), ...verticalKeys(page, s, e)]); await page.waitForTimeout(away ? 150 : 60);
  }
  const s = await state(page), e = s.combat.encounter;
  await control(page, []); throw new Error(`${label}: could not reach the encounter (gap ${gapL(page, s).toFixed(2)} L, its mode ${e?.mode}, player y ${s.physical.y.toFixed(1)}, its y ${e?.y.toFixed(1)}, hp ${JSON.stringify(s.combat.hp[`e${e?.id}`])})`);
}
/** The ids of the attacks a check must see telegraphed (controller addition: every hunter attack at least once). */
const HUNTER_ATTACKS = { '1:crab': ['crab-pinch', 'crab-lunge', 'crab-sweep'], '2:squid': ['squid-ink', 'squid-grab', 'squid-lunge'], '2:eel': ['eel-ambush', 'eel-bite', 'eel-wrap'] };
/** The AI bands of those attacks (bestiary.ts BEHAVIOURS, in attacker body lengths): the bot stands where a missing attack can start. The eel's
 *  ambush starts at its den (trigger .9 L). */
const BANDS = { 'crab-pinch': [0, .45], 'crab-lunge': [.5, 1.4], 'crab-sweep': [0, .6], 'squid-ink': [.3, .9], 'squid-grab': [.2, .75], 'squid-lunge': [.6, 1.2], 'eel-bite': [0, .45], 'eel-wrap': [0, .6], 'eel-ambush': [0, .9] };

// ---------------------------------------------------------------------------------------------------------------------------
check('desktop-controls', async () => {
  const { page, errors } = await newPage();
  await play(page, FOUR, 'qaEncounter=1:crab');
  let s = await state(page);
  assert.deepEqual(s.combat.slots, ['brace', 'counter', 'dash', 'grab'], 'four slots in priority order');
  // The aim follows the pointer: a point 40° right of the facing, at the creature's height.
  const yaw = s.orientation.yaw + 40 * DEG, P = { x: s.physical.x + 3 * SIZES[s.stage] * Math.sin(yaw), y: s.physical.y, z: s.physical.z + 3 * SIZES[s.stage] * Math.cos(yaw) };
  const screen = await screenOf(page, P); assert.ok(screen.visible, 'the aim point is on screen');
  await page.mouse.move(screen.x - 20, screen.y); await page.mouse.move(screen.x, screen.y, { steps: 4 }); await frames(page, 3);
  s = await state(page);
  assert.equal(s.combat.aimSource, 'pointer');
  const aimYaw = Math.atan2(s.combat.aim.x, s.combat.aim.z), want = Math.atan2(P.x - s.physical.x, P.z - s.physical.z), off = Math.abs(Math.atan2(Math.sin(aimYaw - want), Math.cos(aimYaw - want)));
  facts.pointerAimErrorDeg = +(off / DEG).toFixed(2);
  assert.ok(off <= 5 * DEG, `the aim yaw is within 5° of the pointer direction (${(off / DEG).toFixed(1)}°)`);
  // No pointer movement for 4 s: the camera forward.
  await page.waitForTimeout(4300); s = await state(page);
  assert.equal(s.combat.aimSource, 'camera', 'a still pointer gives the camera forward after 4 s');
  // A middle drag turns the camera; a left click does not.
  const look0 = s.world;
  await page.mouse.move(900, 380); await page.mouse.down({ button: 'middle' }); await page.mouse.move(980, 400, { steps: 8 }); await page.mouse.up({ button: 'middle' });
  const look1 = (await state(page)).world; assert.ok(Math.abs(look1.yaw - look0.yaw) > .3, 'a middle drag turns the camera');
  await page.mouse.click(720, 450); assert.ok(Math.abs((await state(page)).world.yaw - look1.yaw) < 1e-6, 'a left click does not turn the camera');
  await page.waitForTimeout(1000);
  // Right mouse is slot 1 (Brace): held keeps it active, release ends it.
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(700);
  let brace = playerActions(await state(page)).find(a => a.id === 'brace-shell'); assert.equal(brace?.phase, 'active', 'held right mouse keeps Brace active');
  await page.mouse.up({ button: 'right' }); await page.waitForTimeout(700);
  brace = playerActions(await state(page)).find(a => a.id === 'brace-shell' && (a.phase === 'windup' || a.phase === 'active')); assert.equal(brace, undefined, 'release ends Brace');
  // Keys 1–4 start slots 1–4.
  for (const [key, id] of [['Digit2', /counter/], ['Digit3', /dash|scuttle/], ['Digit4', /grab|pinch/], ['Digit1', /brace/]]) {
    await page.waitForTimeout(1500);   // past the previous move's recovery
    const before = new Set(playerActions(await state(page)).map(a => a.instance));
    await page.keyboard.down(key);
    const seen = await record(page, s => s.combat.actions.filter(a => a.actor === 'player').map(a => ({ id: a.id, instance: a.instance })), xs => xs.at(-1).length > 0 && xs.length > 3, 1, `${key} starts a move`);
    await page.keyboard.up(key);
    assert.ok(seen.flat().some(a => !before.has(a.instance) && id.test(a.id)), `${key} starts ${id} (saw ${[...new Set(seen.flat().map(a => a.id))].join(', ')})`);
  }
  await page.waitForTimeout(1500);
  // A left click on the crab (pointer aim on it) with the crab in the Bite cone starts Bite.
  await approach(page, s => inReach(page, s), 'walk to the crab');
  let bit = false; const tries = [];
  for (let i = 0; i < 20 && !bit; i++) {
    const s0 = await state(page); if (!await clickAt(page, s0, s0.combat.encounter)) { tries.push('aim point off screen'); await approach(page, s => inReach(page, s), 'walk to the crab again'); continue; }
    // The click starts Bite (the dispatch rule: a combat species is in the Bite cone; the crab is the creature in reach and under the aim).
    const xs = await record(page, s => s.combat.actions.some(a => a.actor === 'player' && /^bite-/.test(a.id)), xs => xs.at(-1), .6, 'a Bite', 4).catch(() => null);
    bit = !!xs;
    if (!xs) { const t = await state(page); tries.push(`no Bite (player actions ${playerActions(t).map(a => `${a.id}:${a.phase}`).join(' ') || 'none'}; aim ${t.combat.aimSource}; gap ${gapL(page, t).toFixed(2)} L; facing ${facing(t, t.combat.encounter)})`); }
    else tries.push('Bite');
    if (!bit) { const s = await state(page); if (!inReach(page, s)) await approach(page, s => inReach(page, s), 'walk to the crab again'); else await page.waitForTimeout(300); }
  }
  facts.biteTries = tries.length;
  assert.ok(bit, `a left click with a crab in the cone starts Bite (tries: ${tries.join(' | ')})`);
  assert.deepEqual(errors, []);
});

check('desktop-chomp', async () => {
  // Space with only a plant in reach eats it (the basic dispatch falls back to the chomp).
  const { page, errors } = await newPage();
  await play(page, {});
  const s = await eatOnce(page, 'Space eats a plant');
  assert.ok(s.bites >= 1); assert.ok(!playerActions(s).some(a => /^bite-/.test(a.id)), 'no Bite action without a combat species in the cone');
  assert.deepEqual(errors, []);
});

check('phone-controls', async () => {
  for (const [label, spec] of [['swimmer', FOUR], ['crawler', { stage: 1, line: 'crawler', add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }] } }], ['breacher', { stage: 2, line: 'swimmer' }]]) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      const { context, page, errors } = await newPage({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await play(page, spec);
      const ids = ['#joystick', '#chomp', '#special', '#dive', '#pause', '#edit', '#hearts', '#slot-1', '#slot-2', '#slot-3', '#slot-4'], boxes = [];
      for (const id of ids) { const l = page.locator(id); if (!(await l.isVisible())) continue; boxes.push({ id, ...(await l.boundingBox()) }); }
      for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width + 1 && b.y + b.height <= viewport.height + 1, `${label} ${viewport.width}x${viewport.height}: ${b.id} fits`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j], overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5;
        assert.ok(!overlap, `${label} ${viewport.width}x${viewport.height}: ${a.id} and ${b.id} do not overlap`);
      }
      const slots = boxes.filter(b => b.id.startsWith('#slot'));
      if (label !== 'breacher') assert.equal(slots.length, 4, `${label}: four slot buttons show`);
      for (const b of slots) assert.ok(b.width >= 48 && b.height >= 48, `${b.id} is at least 48×48 (${b.width}×${b.height})`);
      const chomp = boxes.find(b => b.id === '#chomp'); assert.ok(chomp.width >= 80 && chomp.height >= 80, `#chomp is at least 80×80 (${chomp.width}×${chomp.height})`);
      await page.screenshot({ path: `${out}/combat-phone-${label}-${viewport.width}.png` });
      if (label === 'swimmer') {
        // Two real touches: the joystick moves while the basic-button drag aims; a slot tap starts its move; a held slot keeps Brace; a
        // pointercancel ends Brace and leaves no held input.
        const cdp = await context.newCDPSession(page), centre = async id => { const b = await page.locator(id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: 4, radiusY: 4, force: 1 }; };
        const j = { ...await centre('#joystick'), id: 1 }, c = { ...await centre('#chomp'), id: 2 }, before = await state(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [j] });
        j.y -= 30; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [j] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [j, c] });
        for (let k = 1; k <= 4; k++) { c.x -= 10; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [j, c] }); await page.waitForTimeout(30); }
        await page.waitForTimeout(400);
        const during = await state(page);
        assert.ok(dist(during.player, before.player) > .3, `the joystick moves during the aim drag (${dist(during.player, before.player).toFixed(2)})`);
        assert.equal(during.combat.aimSource, 'drag', 'the basic-button drag aims');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(800);
        const dash = { ...await centre('#slot-3'), id: 3 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [dash] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await record(page, s => s.combat.actions.some(a => a.actor === 'player' && /dash|scuttle/.test(a.id)), xs => xs.at(-1), 1, 'a slot tap starts Dash');
        await page.waitForTimeout(1500);
        const brace = { ...await centre('#slot-1'), id: 4 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [brace] }); await page.waitForTimeout(700);
        assert.equal(playerActions(await state(page)).find(a => a.id === 'brace-shell')?.phase, 'active', 'a held slot keeps Brace');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await page.waitForTimeout(700);
        assert.equal(playerActions(await state(page)).find(a => a.id === 'brace-shell' && (a.phase === 'windup' || a.phase === 'active')), undefined, 'pointercancel ends Brace');
        await page.waitForTimeout(600);
        const after = await state(page);
        assert.ok(!playerActions(after).some(a => a.id === 'brace-shell' && a.phase !== 'recovery' && a.phase !== 'interrupted'), 'no held input stays (no new Brace)');
        assert.deepEqual(after.input.activeHeld, [false, false, false, false], 'no slot stays held');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
}, 300);

/** One sample of a fight: the telegraphs at the player (visible on screen or as an edge arrow; locked shape equal to the action's shape) and
 *  the actions at the player, on the game clock. */
function telegraphPick(s) {
  const actions = s.combat.actions.filter(a => a.target === 'player');
  return { time: s.time, mode: s.mode, actions: actions.map(a => ({ instance: a.instance, id: a.id, phase: a.phase })),
    tele: s.combat.telegraphs.filter(t => t.targetsPlayer).map(t => { const a = actions.find(a => a.instance === t.action);
      return { action: t.action, attack: t.attack, phase: t.phase, onScreen: t.onScreen, arrow: t.arrow, shapeOk: !t.locked || !a?.shape || JSON.stringify(a.shape) === JSON.stringify(t.shapes) }; }),
    hit: s.combat.hits.filter(h => h.target === 'player' && (h.outcome === 'hit' || h.outcome === 'grabbed' || h.outcome === 'guard-broken')).at(-1) ?? null };
}
/** Per telegraphed action that went active: its attack, when it was first visible in wind-up (on screen or as an edge arrow), when it went
 *  active, whether it was off screen when it went active, and whether every locked shape equalled the action's shape. */
function telegraphLeads(xs) {
  const by = new Map();
  for (const x of xs) {
    for (const t of x.tele) {
      const r = by.get(t.action) ?? { attack: t.attack, seenAt: x.time, visibleAt: null, onScreenAt: null, arrowAt: null, activeAt: null, offAtActive: null, shapeOk: true }; by.set(t.action, r);
      if (t.phase === 'windup' && r.visibleAt === null && (t.onScreen || t.arrow)) r.visibleAt = x.time;
      if (t.phase === 'windup' && r.onScreenAt === null && t.onScreen) r.onScreenAt = x.time;
      if (t.phase === 'windup' && r.arrowAt === null && t.arrow) r.arrowAt = x.time;
      if (t.phase === 'active' && r.offAtActive === null) r.offAtActive = !t.onScreen;
      if (!t.shapeOk) r.shapeOk = false;
    }
    for (const a of x.actions) { const r = by.get(a.instance); if (r && r.activeAt === null && a.phase === 'active') r.activeAt = x.time; }
  }
  // An action whose wind-up began before the first sample has no full lead: it is left out.
  return [...by.values()].filter(r => r.activeAt !== null && r.seenAt > xs[0].time);
}
/** Asserts the telegraph rule for every recorded action: visible ≥ .35 s before its active start (on screen or as an edge arrow), the
 *  shape is the action's shape, and an action that goes active off screen showed its edge arrow ≥ .35 s before (spec §14.2). */
function assertLeads(rows, leads) {
  for (const r of rows) {
    assert.ok(r.visibleAt !== null, `${r.attack}: the telegraph was visible before the active start`);
    assert.ok(r.shapeOk, `${r.attack}: the telegraph shape is the action shape`);
    const lead = r.activeAt - r.visibleAt;
    assert.ok(lead >= .35 - 1e-6, `${r.attack}: visible ${lead.toFixed(2)} s before active (≥ .35)`);
    // Off screen for its whole wind-up (the spec's camera turned away): the edge arrow ≥ .35 s before active. Shown on screen in the wind-up and
    // then off screen (the camera moved): the arrow takes over by the active start.
    if (r.offAtActive && r.onScreenAt === null) assert.ok(r.arrowAt !== null && r.activeAt - r.arrowAt >= .35 - 1e-6, `${r.attack}: off screen in its wind-up, the edge arrow showed ${r.arrowAt === null ? 'never' : (r.activeAt - r.arrowAt).toFixed(2)} s before active (≥ .35)`);
    if (r.offAtActive) assert.ok(r.arrowAt !== null && r.arrowAt <= r.activeAt, `${r.attack}: off screen at active, the edge arrow shows`);
    leads[r.attack] = Math.min(leads[r.attack] ?? Infinity, +lead.toFixed(3));
  }
}
/** Turns the look camera (middle drags) to a yaw and pitch (radians, world.yaw / world.pitch); bounded. */
async function turnCamera(page, yaw, pitch) {
  const vp = page.viewportSize(), cx = vp.width / 2, cy = vp.height / 2;
  for (let i = 0; i < 12; i++) {
    const w = (await state(page)).world, dy = Math.atan2(Math.sin(yaw - w.yaw), Math.cos(yaw - w.yaw)), dp = pitch - w.pitch;
    if (Math.abs(dy) < .1 && Math.abs(dp) < .1) return;
    const mx = Math.max(-cx + 10, Math.min(cx - 10, -dy / .006)), my = Math.max(-cy + 10, Math.min(cy - 10, dp / .005));
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx + mx, cy + my, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  }
}

check('telegraph-before-hit', async () => {
  facts.leads = {};
  // Part 1 (spec §14.2): a still Speck and qaEncounter=1:crab; the telegraph is visible ≥ .45 s before the first damage and its shape is the
  // action's shape.
  {
    const { page, errors } = await newPage();
    await play(page, {}, 'qaEncounter=1:crab');
    const xs = await record(page, telegraphPick, xs => xs.at(-1).hit !== null, 40, 'the crab lands a hit');
    const hit = xs.at(-1).hit, first = xs.find(x => x.tele.some(t => t.onScreen || t.arrow));
    assert.ok(first, 'a telegraph showed'); facts.firstTelegraphLead = +(hit.time - first.time).toFixed(3);
    assert.ok(hit.time - first.time >= .45 - 1e-6, `the telegraph showed ${(hit.time - first.time).toFixed(2)} s before the damage (≥ .45)`);
    assertLeads(telegraphLeads(xs), facts.leads);
    // The camera turned away (spec §14.2), set up so that an attack is off screen for its whole wind-up: a 320×568 portrait viewport, the camera
    // at its low pitch limit (-.8) and turned so that the crab is 90° to the side, and the Speck kept at the crab's lunge distance (a gap of
    // .9–1.3 crab lengths). The crab's long attacks then have their shape centroid 1.5–2 player L to the side, past the screen edge. The camera
    // turns only between attacks (it holds still through every wind-up). At the default camera every attack is on screen (T23 found the same).
    // Bar: at least one wind-up off screen from start to active, and its edge arrow shows ≥ .6 s before active (the director's off-screen
    // wind-up, OFF_SCREEN_WINDUP); every attack is visible ≥ .35 s before active.
    await page.setViewportSize({ width: 320, height: 568 }); await frames(page, 3);
    await startRecorder(page, telegraphPick);
    const t0 = (await state(page)).time, w0 = Date.now(), size = SIZES[0];
    let rows = [];
    while ((await state(page)).time - t0 < 90 && Date.now() - w0 < 150000) {
      const s = await state(page), e = s.combat.encounter;
      if (s.mode === 'fainted') { await control(page, []); await untilGameTime(page, x => x.mode === 'playing', 10, 'respawn'); continue; }
      rows = telegraphLeads(await page.evaluate(() => window.__rec.out.slice()));
      if (rows.some(r => r.offAtActive && r.onScreenAt === null) && s.time - t0 > 10) break;
      if (s.combat.telegraphs.some(t => t.targetsPlayer && t.phase === 'windup')) { await control(page, []); await page.waitForTimeout(100); continue; }
      const gap = (Math.hypot(s.physical.x - e.x, s.physical.z - e.z) - .35 * e.bodyLength) / e.bodyLength;
      await control(page, gap < .9 ? steer(s, { x: 2 * s.player.x - e.x / size, z: 2 * s.player.z - e.z / size }, .2) : gap > 1.3 ? steer(s, { x: e.x / size, z: e.z / size }, .2) : []);
      await turnCamera(page, Math.atan2(e.x - s.physical.x, e.z - s.physical.z) + Math.PI / 2, -.8); await page.waitForTimeout(100);
    }
    await control(page, []);
    rows = telegraphLeads(await stopRecorder(page));
    assertLeads(rows, facts.leads);
    const offWhole = rows.filter(r => r.offAtActive && r.onScreenAt === null);
    facts.cameraAway = { attacks: rows.length, offWholeWindup: offWhole.length, edgeArrowLead: offWhole.map(r => `${r.attack} ${r.arrowAt === null ? 'none' : (r.activeAt - r.arrowAt).toFixed(3)}`) };
    assert.ok(offWhole.length >= 1, `an attack was off screen for its whole wind-up (${rows.length} attacks, none off screen)`);
    for (const r of offWhole) assert.ok(r.arrowAt !== null && r.activeAt - r.arrowAt >= .6 - 1e-6, `${r.attack}: off screen in its wind-up, the edge arrow showed ${r.arrowAt === null ? 'never' : (r.activeAt - r.arrowAt).toFixed(3)} s before active (≥ .6)`);
    assert.deepEqual(errors, []);
  }
  // Part 2 (controller addition): every hunter attack at least once; each is visible (on screen or as an edge arrow) ≥ .35 s before its active
  // start, on the game clock. The player stands, backs off to provoke the long attacks, and goes to the den for the ambush.
  for (const [key, ids] of Object.entries(HUNTER_ATTACKS)) {
    const { page, errors } = await newPage();
    // The recorder starts before the start: the eel's den ambush can begin on the first played frame.
    // The eel: a Swimmer with Brace (FOUR) that braces through each wind-up. An unbraced ambush hit knocks the player past the eel's leash, so
    // the eel goes home at once and its out-of-den attacks (eel-bite, eel-wrap) almost never start (fix round 1: eel-wrap was missed in 240 s).
    const eel = key === '2:eel';
    await play(page, key === '1:crab' ? {} : eel ? FOUR : { stage: 1, line: 'swimmer' }, `qaEncounter=${key}&qaStartGrace=0`, () => startRecorder(page, telegraphPick));
    const w0 = Date.now(), seen = new Set(); let den = null, rows = [];
    while (ids.some(id => !seen.has(id)) && Date.now() - w0 < 240000) {
      const s = await state(page);
      if (s.mode === 'fainted') { await control(page, []); await untilGameTime(page, x => x.mode === 'playing', 10, 'respawn'); continue; }
      const e = s.combat.encounter; if (!e || e.eaten) break;
      if (key === '2:eel' && e.mode === 'calm') den ??= { x: e.x, y: e.y, z: e.z };
      // Stand still (wind-ups at the player are recorded), or walk into the band of the first missing attack (the eel's ambush: to its den).
      const missing = ids.filter(id => !seen.has(id)), size = SIZES[s.stage], gap = (dist(s.physical, e) - .35 * e.bodyLength) / e.bodyLength;
      const busy = s.combat.actions.some(a => a.target === 'player' && a.phase !== 'recovery');
      const goal = missing[0] === 'eel-ambush' && den && e.mode !== 'hunt' && e.mode !== 'angry' ? den : e, [lo, hi] = BANDS[missing[0]];
      let keys = [];
      if (eel && s.combat.actions.some(a => a.target === 'player' && a.phase === 'windup')) keys = ['Digit1'];   // hold Brace (slot 1)
      else if (!busy) {
        if (goal === den || gap > hi - .05) keys = [...steer(s, { x: goal.x / size, z: goal.z / size }, .2), ...verticalKeys(page, s, goal)];
        else if (gap < lo + .05) keys = steer(s, { x: 2 * s.player.x - e.x / size, z: 2 * s.player.z - e.z / size }, .2);
      }
      await control(page, keys); await page.waitForTimeout(150);
      rows = telegraphLeads(await page.evaluate(() => window.__rec.out.slice()));
      for (const r of rows) seen.add(r.attack);
    }
    await control(page, []);
    rows = telegraphLeads(await stopRecorder(page));
    assertLeads(rows, facts.leads);
    if (process.env.TIDE_DEBUG) console.log(key, JSON.stringify(facts.leads));
    const missing = ids.filter(id => !rows.some(r => r.attack === id));
    assert.deepEqual(missing, [], `${key}: every attack was telegraphed (missing ${missing.join(', ')})`);
    assert.deepEqual(errors, []);
  }
}, 900);

check('hit-stop', async () => {
  const { page, errors } = await newPage();
  await play(page, FOUR, 'qaEncounter=1:crab');
  await approach(page, s => inReach(page, s), 'walk to the crab');
  // Left clicks on the crab (pointer aim on it) while every frame is recorded, until a player Bite hits.
  await startRecorder(page, s => ({ time: s.time, clocks: { ...s.combat.clocks }, stops: { ...s.combat.hitStop }, crab: `e${s.combat.encounter.id}`,
    others: [...s.foods, ...s.threats].filter(f => f.id !== s.combat.encounter.id).map(f => [f.x, f.y, f.z].map(v => Math.round(v * 1000)).join(',')).join(';'),
    hit: s.combat.hits.find(h => h.attacker === 'player' && h.outcome === 'hit') ?? null }));
  const w0 = Date.now(); let hitAt = null;
  while (Date.now() - w0 < 60000) {
    const s = await state(page);
    if (s.combat.hits.some(h => h.attacker === 'player' && h.outcome === 'hit')) { hitAt ??= Date.now(); if (Date.now() - hitAt > 600) break; await page.waitForTimeout(100); continue; }
    if (!inReach(page, s)) await approach(page, s => inReach(page, s), 'walk to the crab again');
    const s1 = await state(page); await clickAt(page, s1, s1.combat.encounter); await page.waitForTimeout(150);
  }
  const xs = await stopRecorder(page);
  const at = xs.findIndex(x => x.hit), last = await state(page);
  assert.ok(at > 0, `a player Bite hits the crab within 60 s (hits ${JSON.stringify(last.combat.hits.slice(-5))}, gap ${((dist(last.physical, last.combat.encounter) - .35 * last.combat.encounter.bodyLength) / page.bodyLength).toFixed(2)} L)`);
  const crab = xs[at].crab;
  // The hit lands inside the frame that produced sample `at`; from there both clocks stay put while world time runs.
  let end = at; while (end + 1 < xs.length && xs[end + 1].clocks.player === xs[at].clocks.player && xs[end + 1].clocks[crab] === xs[at].clocks[crab]) end++;
  const frameDt = xs[at].time - xs[at - 1].time, stopped = xs[end].time - xs[at].time + frameDt;
  if (process.env.TIDE_DEBUG) console.log(JSON.stringify(xs.slice(at - 3, end + 6).map(x => ({ t: x.time, p: x.clocks.player, c: x.clocks[crab], sp: x.stops.player, sc: x.stops[crab], hit: x.hit?.time }))));
  facts.hitStopMs = Math.round(stopped * 1000); facts.frameMs = Math.round(frameDt * 1000); facts.stoppedFrames = end - at + 1; facts.expectedMs = 60 + Math.round(30 * Math.min(1, xs[at].hit.amount / 8));
  // The stop is seen in whole frames: allow one frame of slack on each side.
  const lo = .06 - frameDt - 1e-6, hi = .09 + frameDt + 1e-6;
  assert.ok(stopped >= lo && stopped <= hi, `both clocks stopped about ${(stopped * 1000).toFixed(0)} ms (60–90 ms ± one ${(frameDt * 1000).toFixed(0)} ms frame)`);
  assert.ok(end > at || stopped >= .06 - 1e-6, 'the clocks stay still for more than one frame');
  assert.ok(xs.slice(at, end + 1).some((x, i, a) => i > 0 && x.others !== a[i - 1].others), 'a third entity moves during the hit-stop');
  assert.ok(xs[end].time > xs[at].time, 'world time advances during the hit-stop');
  assert.deepEqual(errors, []);
});

check('faint-rule', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, { health: .5, atRisk: 37, stageDna: 37 }, 'qaEncounter=1:crab&qaStartGrace=0');
  const before = JSON.parse(await storageOf(page, KEYS.v4) ?? fx.json);
  await untilGameTime(page, s => s.mode === 'fainted', 40, 'a crab hit faints the player');
  assert.match(await page.locator('#faint').textContent(), /\b37 DNA/);
  await untilGameTime(page, s => s.mode === 'playing', 10, 'the respawn');
  await page.waitForTimeout(300);
  const after = JSON.parse(await storageOf(page, KEYS.v4)), s = await state(page);
  assert.equal(after.economy.wallet.atRisk, 0); assert.equal(s.stageDna, 0);
  assert.equal(after.economy.wallet.banked, before.economy.wallet.banked, 'banked DNA stays');
  assert.deepEqual(after.genome, before.genome, 'the design stays');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tiny-tide-adventure')));
  assert.deepEqual(keys, [fx.key], 'only the v4 key was written');
  assert.deepEqual(errors, []);
});

check('alpha', async () => {
  const { page, errors } = await newPage();
  await play(page, { mouth: { 0: 'mouth_snapper' } }, 'qaEncounter=1:clawmother&qaAlphaHealth=0.62&qaStartGrace=0');
  const seen = { phases: new Set(), phase0Attack: false, burrow: false, rage: false, faints: 0 }, t0 = (await state(page)).time, w0 = Date.now();
  let s = await state(page); const dna0 = s.totalDna;
  while (!s.unlocked.includes('claw_mother')) {
    assert.ok(s.time - t0 < 300 && Date.now() - w0 < 420000, `the Clawmother is defeated within 300 s of game time (hp ${s.combat.alphas.find(x => x.key === '1:clawmother')?.hp})`);
    const a = s.combat.alphas.find(x => x.key === '1:clawmother');
    if (a) { seen.phases.add(a.phase); if (a.state === 'sink' || a.state === 'burrowed') seen.burrow = true; if (a.phase === 0 && s.combat.actions.some(x => x.actor === a.id && x.target === 'player')) seen.phase0Attack = true; }
    if (s.combat.actions.some(x => x.id === 'mother-pinch-rage' || x.id === 'mother-sweep')) seen.rage = true;
    if (s.mode === 'fainted') { seen.faints++; await control(page, []); await untilGameTime(page, x => x.mode === 'playing', 10, 'respawn'); s = await state(page); continue; }
    const e = s.combat.encounter, size = SIZES[s.stage];
    const windup = s.combat.telegraphs.find(t => t.phase === 'windup' && t.targetsPlayer);
    // Below 30 % the bot holds its bites until it has seen an enraged attack (else a fast kill can end the fight before one starts).
    const hold = a?.phase === 2 && !seen.rage;
    if (windup) {
      // Dodge: Dash when the slot has one, else strafe away from the attack's line.
      const dashSlot = s.combat.slots.indexOf('dash'); if (dashSlot >= 0) await page.keyboard.press(`Digit${dashSlot + 1}`);
      const sh = windup.shapes[0], from = sh.kind === 'cone' ? sh.apex : sh.start;
      const ax = s.physical.x - from.x, az = s.physical.z - from.z, l = Math.hypot(ax, az) || 1;
      await control(page, steer(s, { x: s.player.x + (ax / l - az / l) * 3, z: s.player.z + (az / l + ax / l) * 3 }, .2));
    } else {
      if (e && !e.eaten) await aimAt(page, s, e);
      await control(page, [...(hold ? [] : ['Space']), ...(e ? steer(s, { x: e.x / size, z: e.z / size }, .2) : [])]);
    }
    await page.waitForTimeout(60); s = await state(page);
  }
  await control(page, []);
  facts.alpha = { phases: [...seen.phases], phase0Attack: seen.phase0Attack, burrow: seen.burrow, rage: seen.rage, faints: seen.faints, gameSeconds: +(s.time - t0).toFixed(1) };
  assert.ok(seen.phases.has(0) && seen.phase0Attack, 'phase 1 attacks'); assert.ok(seen.phases.has(1), 'below 60 %: phase 2'); assert.ok(seen.burrow, 'phase 2 burrows'); assert.ok(seen.phases.has(2) && seen.rage, 'below 30 %: the enraged attacks');
  assert.ok(s.totalDna - dna0 >= 40, `the defeat pays 40 DNA (${s.totalDna - dna0})`);
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.locator('#editor [data-tab=parts]').click(); await page.locator('#editor [data-kind=arm]').click();
  assert.equal(await page.locator('#editor .ed-card[data-part=claw_mother]').count(), 1, 'the rare part is in the editor');
  await page.locator('#editor .ed-cancel').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page); await page.waitForTimeout(500);
  const reloaded = await state(page);
  assert.ok(Object.keys(reloaded.combat.hp).length > 0, 'after a reload the combat world is live (its diagnostics are not empty)');
  assert.ok(reloaded.unlocked.includes('claw_mother'), 'after a reload the reward stays unlocked');
  assert.ok(!reloaded.combat.alphas.some(a => a.key === '1:clawmother' && !a.eaten), 'after a reload the Clawmother is absent');
  assert.deepEqual(errors, []);
}, 480);

check('editor-moves', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, FIVE);
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await frames(page, 3);
  assert.equal(await page.locator('#editor .ed-moves .ed-slot').count(), 4, 'four slots');
  assert.match(await page.locator('#editor .ed-moves .ed-inactive').first().textContent(), /Inactive — no free slot/);
  // The size slider shows "old → new" while it moves.
  const shell = fx.info.parts.find(p => p.id === 'shell_plate').uid, at = await page.evaluate(uid => window.__tinyTide.editorProjection(uid), shell);
  await page.mouse.click(at.x, at.y); await frames(page, 2);
  const input = page.locator('#editor .ed-scale'), box = await input.boundingBox(), y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down(); await page.mouse.move(box.x + box.width - 4, y, { steps: 8 });
  assert.match(await page.locator('#editor .ed-move-diff').textContent(), /→/, 'live move numbers');
  await page.mouse.up();
  // Swap by drag: the inactive Sweep onto slot 1.
  const chip = await page.locator('#editor .ed-inactive .ed-move-chip').boundingBox(), slot = await page.locator('#editor .ed-slot[data-slot="0"]').boundingBox();
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2); await page.mouse.down();
  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 10 }); await page.mouse.up(); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-slot[data-slot="0"] .ed-move-chip').getAttribute('data-kind'), 'sweep', 'the drag pins Sweep to slot 1');
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page); await frames(page, 4);
  assert.equal((await state(page)).combat.slots[0], 'sweep', 'the pin persists after Done and a reload');
  assert.deepEqual(errors, []);
});

check('hints', async () => {
  const { page, errors } = await newPage();
  await play(page, {}, 'qaEncounter=1:crab');
  const s = await untilGameTime(page, s => s.combat.hints.includes('telegraph'), 40, 'the telegraph hint shows');
  assert.match(await page.locator('#toast').textContent(), /Orange shapes show where an attack lands/);
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page);
  const xs = await record(page, s => ({ toast: document.getElementById('toast').textContent, windup: s.combat.telegraphs.some(t => t.phase === 'windup') }), xs => xs.filter(x => x.windup).length > 30, 60, 'another wind-up');
  assert.ok(!xs.some(x => /Orange shapes/.test(x.toast)), 'after a reload the hint does not show again');
  assert.deepEqual(errors, []);
});

/** Frame time (plan review R18): the game's work per frame (the requestAnimationFrame callback, timed in the page) and the frame interval,
 *  with 13 or more live combat bodies within 6 L of the player (`qaCrowd`: every sardine and puffer, or every drifter and spiny snail at size 0,
 *  on a ring of 3 L). Budgets: desktop median callback ≤ 16.7 ms (controller ruling); a phone with 4× CPU throttle ≤ 33.3 ms (set here: two
 *  60 Hz frames; the owner may change it). p95 budgets (fix round 1): desktop ≤ 33 ms, phone ≤ 50 ms. The heap growth per frame (positive JS heap deltas across the callback) estimates allocations. */
const BUDGET = { desktop: 16.7, phone: 33.3 }, P95_BUDGET = { desktop: 33, phone: 50 };
check('frame-time', async () => {
  facts.frames = {};
  const phone = viewport => ({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), STAGE1 = [{ stage: 1, line: 'swimmer' }, '1:sardine,1:puffer'], STAGE0 = [{}, '0:drifter,0:spiny_snail'];
  // Desktop and a 320×568 phone (controller ruling); 844×390 at stage 0 and stage 1 with 4× CPU throttle (plan review R18).
  for (const [label, options, throttle, [spec, crowd], budget, p95Budget] of [['desktop stage 1', { viewport: { width: 1440, height: 900 } }, 1, STAGE1, BUDGET.desktop, P95_BUDGET.desktop],
    ['phone 320x568 stage 1 (4x CPU)', phone({ width: 320, height: 568 }), 4, STAGE1, BUDGET.phone, P95_BUDGET.phone], ['phone 844x390 stage 0 (4x CPU)', phone({ width: 844, height: 390 }), 4, STAGE0, BUDGET.phone, P95_BUDGET.phone],
    ['phone 844x390 stage 1 (4x CPU)', phone({ width: 844, height: 390 }), 4, STAGE1, BUDGET.phone, P95_BUDGET.phone]]) {
    const { context, page, errors } = await newPage(options);
    // Time every requestAnimationFrame callback (the game's frame and nothing else in this page asks for frames during the sample).
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window); window.__frameWork = []; window.__frameHeap = [];
      window.requestAnimationFrame = cb => raf(t => { const a = performance.now(), h0 = performance.memory?.usedJSHeapSize ?? 0; cb(t); window.__frameWork.push(performance.now() - a);
        const h1 = performance.memory?.usedJSHeapSize ?? 0; window.__frameHeap.push(h1 - h0); if (window.__frameWork.length > 4000) { window.__frameWork.splice(0, 2000); window.__frameHeap.splice(0, 2000); } });
    });
    await play(page, spec, `qaCrowd=${crowd}`);
    // The crowd (every instance of the listed species, on a ring of 3 L around the player); count the bodies within 6 L when the sample starts and ends.
    const cdp = await context.newCDPSession(page), L = page.bodyLength;
    await page.waitForTimeout(500);
    const nearCount = s => s.combat.crowd.filter(e => dist(e, s.physical) < 6 * L).length;
    const before = nearCount(await state(page)), bodies = Object.keys((await state(page)).combat.hp).length;
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.evaluate(() => { window.__frameWork.length = 0; window.__frameHeap.length = 0; });
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => ({ work: [...window.__frameWork], heap: [...window.__frameHeap], now: performance.now() }));
    const after = await state(page), afterNear = nearCount(after);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const sorted = [...r.work].sort((a, b) => a - b), q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    const interval = (r.now - t0) / r.work.length, positive = r.heap.filter(v => v > 0);
    facts.frames[label] = { throttle, frames: r.work.length, medianMs: +q(.5).toFixed(2), p95Ms: +q(.95).toFixed(2), meanIntervalMs: +interval.toFixed(2), combatBodies: bodies, crowdWithin6L: [before, afterNear], mode: after.mode,
      heapGrowthPerFrameKB: positive.length ? +(positive.reduce((a, b) => a + b, 0) / r.heap.length / 1024).toFixed(1) : null };
    assert.ok(Math.min(before, afterNear) >= 13, `${label}: 13 or more combat bodies within 6 L of the player (${before} at the start, ${afterNear} at the end)`);
    assert.equal(after.mode, 'playing', `${label}: the sample is play`);
    assert.ok(q(.5) <= budget, `${label}: median frame work ${q(.5).toFixed(2)} ms ≤ ${budget} ms`);
    assert.ok(q(.95) <= p95Budget, `${label}: p95 frame work ${q(.95).toFixed(2)} ms ≤ ${p95Budget} ms`);
    assert.deepEqual(errors, []);
    await context.close();
  }
}, 300);

const failures = [];
try {
  for (const c of checks) {
    if (only.length && !only.includes(c.id)) continue;
    const t0 = Date.now(); facts = {};
    let timer;
    try {
      await Promise.race([c.fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`real-time cap of ${c.wallSeconds} s`)), c.wallSeconds * 1000); })]);
      console.log(`ok   ${c.id} (${((Date.now() - t0) / 1000).toFixed(1)} s) ${JSON.stringify({ seed: SEED, ...facts })}`);
    } catch (error) { failures.push(c.id); console.log(`FAIL ${c.id}: ${error.message} ${JSON.stringify({ seed: SEED, ...facts })}`); }
    finally { clearTimeout(timer); for (const context of browser.contexts()) await context.close().catch(() => {}); }
  }
} finally { await browser.close(); }
if (failures.length) { console.log(`FAILED: ${failures.join(', ')}`); process.exit(1); }
console.log(`PASSED: ${only.length ? `checks ${only.join(', ')}` : `all ${checks.length} combat checks`}`);
