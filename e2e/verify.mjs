#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Wildtag end-to-end verification (Task 15).
//
// A standalone Node script that drives the real game in a headless Chromium
// (SwiftShader WebGL) and ASSERTS the whole gameplay loop end-to-end: boot,
// movement, tracking/link, crafting, the assignable inventory/hotbar screen,
// structures, buildable walls/ramps + composed ground, the first-person hands
// viewmodel, grapple, save round-trip, village/bond/barter/farm (incl. the
// farm-only wood/stone producers)/mount, quality presets + draw calls, a perf
// smoke, and (Cursed Castle) the day/night cycle, the castle site + a
// gargoyle, night goblins landing a hit on the player, and the purify arc
// (crystal → elves → persists across reload). Every phase writes a
// screenshot to docs/verify/NN-name.png.
//
// Run:
//   PLAYWRIGHT_DIR=/path/to/playwright/install node e2e/verify.mjs
//
// Playwright is installed per-session OUTSIDE this repo (never a repo dep):
//   cd <scratchpad> && npm i playwright && npx playwright install chromium
// then point PLAYWRIGHT_DIR at that directory. The script resolves the
// `playwright` module from there.
//
// The script launches its own `npm run dev` vite server and drives whatever
// localhost port vite reports, unless VERIFY_URL is set (then it drives that).
//
// Exit code is non-zero if any check fails; the failing check(s) are named.
//
// NOTE ON HEADLESS INPUT: this environment cannot acquire pointer lock ("root
// document not valid for pointer lock"), and the game gates LMB/RMB actions on
// pointer lock. So mouse-driven actions (dart throw, grapple FIRE via RMB,
// zipline placement CONFIRM via LMB) cannot be driven by synthetic input here.
// Those paths are instead verified through the debug handle + dedicated debug
// hooks (?debug=grapple, ?debug=structures) and are additionally covered by the
// pure unit suite (npm test). Keyboard, DOM clicks and window.__game all work.
// Held keys must use lowercase key names ('w', not 'KeyW') for Playwright to
// keep them down; the anti-throttle launch flags keep requestAnimationFrame at
// full cadence so wall-clock movement assertions are stable.
// ---------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SHOT_DIR = join(REPO, 'docs', 'verify');
mkdirSync(SHOT_DIR, { recursive: true });

const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR;
if (!PLAYWRIGHT_DIR) {
  console.error('FATAL: set PLAYWRIGHT_DIR to a directory where `npm i playwright` + `npx playwright install chromium` were run.');
  process.exit(2);
}
const requireFrom = createRequire(join(PLAYWRIGHT_DIR, 'noop.js'));
const { chromium } = requireFrom('playwright');

const LAUNCH_FLAGS = [
  // WebGL in headless Chromium needs SwiftShader.
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  // Keep requestAnimationFrame at full cadence (headless throttles bg pages),
  // otherwise MAX_FRAME_DT clamps catch-up into slow-motion and wall-clock
  // movement assertions become flaky.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
];

const VIEWPORT = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- server ---------------------------------------------------------------
let serverProc = null;

async function startServer() {
  if (process.env.VERIFY_URL) {
    const base = process.env.VERIFY_URL.replace(/\/+$/, '') + '/';
    console.log(`Using VERIFY_URL ${base}`);
    await waitReachable(base);
    return base;
  }
  console.log('Spawning `npm run dev` ...');
  const base = await new Promise((res, rej) => {
    serverProc = spawn('npm', ['run', 'dev'], { cwd: REPO, detached: true, env: process.env });
    let out = '';
    const to = setTimeout(() => rej(new Error('dev server did not report a port within 40s')), 40000);
    const onData = (d) => {
      out += d.toString().replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI colour codes
      const m = out.match(/localhost:(\d+)/);
      if (m) {
        clearTimeout(to);
        serverProc.stdout.off('data', onData);
        res(`http://localhost:${m[1]}/`);
      }
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', () => {});
    serverProc.on('error', rej);
  });
  await waitReachable(base);
  console.log(`Dev server ready at ${base}`);
  return base;
}

async function waitReachable(base) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server at ${base} never became reachable`);
}

function stopServer() {
  if (!serverProc) return;
  try {
    process.kill(-serverProc.pid, 'SIGTERM');
  } catch {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

// --- assertion harness -----------------------------------------------------
const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// VERIFY_STRICT=1: treat ANY retry as a failure (surfaces transient flakiness
// that a single silent retry would otherwise mask). Retries are still ALLOWED
// by default; they're just counted and reported.
const STRICT = process.env.VERIFY_STRICT === '1';
const retryWord = (n) => (n === 1 ? 'retry' : 'retries');

async function check(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  // Retry once: SwiftShader under load can transiently crash a renderer page
  // (window.__game vanishing). A genuine failure fails both attempts; each
  // attempt opens its own fresh page(s), so a retry is side-effect-clean.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      const retries = attempt - 1;
      const ms = Date.now() - t0;
      if (retries > 0 && STRICT) {
        // Strict: an attempt that only passed on retry is reported as a failure.
        results.push({ name, ok: false, retries, err: `passed only on retry (VERIFY_STRICT=1)`, ms });
        console.log(`  x FAIL (strict): passed on ${retries} ${retryWord(retries)}`);
        return;
      }
      results.push({ name, ok: true, retries, ms });
      console.log(`  ✔ PASS (${ms}ms)${retries ? ` (${retries} ${retryWord(retries)})` : ''}`);
      return;
    } catch (e) {
      if (attempt === 1) {
        console.log(`  … attempt 1 failed (${e.message}); retrying`);
        await sleep(1000);
        continue;
      }
      results.push({ name, ok: false, retries: 1, err: e.message, ms: Date.now() - t0 });
      console.log(`  x FAIL: ${e.message}`);
    }
  }
}

// --- page helpers ----------------------------------------------------------
let BASE;
let context;

async function openPage(query = '?fresh=1') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.__errors = errors;
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__game && typeof window.__game.state === 'function',
    { timeout: 20000 },
  );
  await sleep(700); // let a few frames render / world prime
  return page;
}

const state = (page) => page.evaluate(() => window.__game.state());
const pos = (page) => page.evaluate(() => window.__game.player.pos());
const shot = (page, name) => page.screenshot({ path: join(SHOT_DIR, name) });

async function pollState(page, pred, { timeout = 6000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await state(page);
    if (pred(last)) return last;
    await sleep(interval);
  }
  return last; // caller asserts on the returned (stale) state for a good message
}

function horiz(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Poll an arbitrary async getter until `pred` holds (or timeout); returns last value. */
async function pollUntil(getter, pred, { timeout = 6000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await getter();
    if (pred(last)) return last;
    await sleep(interval);
  }
  return last;
}

// --- Inventory-screen helpers (Inventory+Building Task 3's .wt-inv-* DOM) --
// Esc opens/closes the inventory screen (main.ts: `screens.open('inventory')`
// when nothing else is open, `screens.handleEscape()` otherwise). Assigning
// an item to a hotbar slot is a pure DOM click flow (arm a `.wt-inv-card`,
// then click a `.wt-inv-slot`) — no pointer lock needed, unlike LMB/RMB/wheel.

/** Open the inventory screen via Escape (from a state with no screen open and
 *  no active placement/build ghost) and wait for its DOM to render. */
async function openInventory(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => (document.querySelector('.wt-panel h1')?.textContent || '').includes('Inventory'),
    { timeout: 3000 },
  );
}

/** Close whichever screen is open via Escape and wait for the overlay to hide. */
async function closeInventory(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.querySelector('.wt-screen-overlay')?.style.display === 'none',
    { timeout: 3000 },
  );
}

/**
 * Click-assign `itemLabel` (the exact `hotbarItemLabel` text, e.g. 'Zipline'
 * or 'Purify') to hotbar slot index `slotIdx` (0-based; key `slotIdx+1`) via
 * the REAL inventory-screen DOM — arm the owned-item card, then click the
 * target slot. The inventory screen must already be open (`openInventory`).
 */
async function assignItemToSlot(page, itemLabel, slotIdx) {
  const cardClicked = await page.evaluate((label) => {
    const card = [...document.querySelectorAll('.wt-inv-card')].find((c) =>
      (c.textContent || '').includes(label),
    );
    if (!card) return false;
    card.click();
    return true;
  }, itemLabel);
  assert(cardClicked, `inventory item card for "${itemLabel}" not found (not owned/assigned?)`);
  await sleep(150); // the click's own re-render (armed highlight) settles
  const slotClicked = await page.evaluate((idx) => {
    const slot = document.querySelectorAll('.wt-inv-slot')[idx];
    if (!slot) return false;
    slot.click();
    return true;
  }, slotIdx);
  assert(slotClicked, `inventory hotbar slot index ${slotIdx} not found`);
  await sleep(150);
}

/**
 * Fake pointer-lock acquisition on the game canvas: `Input.locked` gates
 * LMB/RMB/wheel handling on `document.pointerLockElement === canvas`, and
 * headless Chromium cannot acquire a real pointer lock ("root document not
 * valid for pointer lock" — see the file header's NOTE ON HEADLESS INPUT).
 * Overriding the getter with an own-property on `document` is the same
 * technique Task 3's standalone verification script used (task-3-report.md)
 * to exercise the real wheel-driven hotbar step. Idempotent.
 */
async function fakePointerLock(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  });
}

// --- PNG luminance-variance (canvas non-blank) -----------------------------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let p = 8;
  let width = 0, height = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.toString('ascii', p, p + 4); p += 4;
    const data = buf.subarray(p, p + len); p += len; p += 4; // skip CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
  }
  if (interlace !== 0) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (!channels) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[rp++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = rb;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function luminanceStdDev(png) {
  const { width, height, channels, data } = png;
  const stride = width * channels;
  let n = 0, sum = 0, sum2 = 0;
  const step = 7; // sample lattice
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * stride + x * channels;
      const lum = channels >= 3 ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] : data[i];
      n++; sum += lum; sum2 += lum * lum;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

/** Mean luminance over the same sample lattice as `luminanceStdDev` (Cursed Castle day/night check). */
function meanLuminance(png) {
  const { width, height, channels, data } = png;
  const stride = width * channels;
  let n = 0, sum = 0;
  const step = 7; // sample lattice (matches luminanceStdDev)
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * stride + x * channels;
      const lum = channels >= 3 ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] : data[i];
      n++; sum += lum;
    }
  }
  return sum / n;
}

// ---------------------------------------------------------------------------
// CHECKS
// ---------------------------------------------------------------------------

async function checkBoot() {
  await check('a. Boot: canvas non-blank, no console errors, HUD present, state sane', async () => {
    const page = await openPage('?fresh=1');
    try {
      // canvas non-blank: full-viewport screenshot luminance variance
      const buf = await page.screenshot();
      await shot(page, '01-boot.png');
      const png = decodePNG(buf);
      assert(png, 'could not decode boot screenshot PNG');
      const sd = luminanceStdDev(png);
      assert(sd > 8, `canvas appears blank (luminance stddev ${sd.toFixed(2)} <= 8)`);
      console.log(`    canvas luminance stddev = ${sd.toFixed(1)}`);

      // HUD root present
      const hud = await page.$('.wt-hud');
      assert(hud, '.wt-hud root not present');

      // state sane
      const st = await state(page);
      assert(st.stamina === 100, `stamina ${st.stamina} != 100`);
      assert(st.inventory.darts === 4, `darts ${st.inventory.darts} != 4 (fresh loadout)`);
      assert(st.inventory.rp === 0, `rp ${st.inventory.rp} != 0`);
      assert(st.activeCritters > 20, `activeCritters ${st.activeCritters} not > 20`);
      assert(st.linkedSpeciesCount === 0, `linkedSpeciesCount ${st.linkedSpeciesCount} != 0`);
      console.log(`    state: stamina=${st.stamina} darts=${st.inventory.darts} rp=${st.inventory.rp} active=${st.activeCritters}`);

      // 15 species (Haven added 4, Cursed Castle added the gargoyle, Task 1
      // added timberchomp + pebbleshrew) — assert via the Field Guide denominator
      await page.keyboard.press('Tab');
      await sleep(400);
      const guideH1 = await page.evaluate(() => document.querySelector('.wt-panel h1')?.textContent ?? '');
      assert(/\/15\b/.test(guideH1), `Field Guide does not show /15 species ("${guideH1}")`);
      console.log(`    guide: "${guideH1.trim()}"`);
      await page.keyboard.press('Tab');
      await sleep(200);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkMovement() {
  await check('b. Movement: walk, sprint drain, dash burst, regen', async () => {
    const page = await openPage('?fresh=1');
    try {
      await sleep(400); // settle grounded
      // walk
      const p0 = await pos(page);
      await page.keyboard.down('w');
      await sleep(1000);
      await page.keyboard.up('w');
      const p1 = await pos(page);
      const walked = horiz(p0, p1);
      assert(walked > 3, `walk moved only ${walked.toFixed(2)}m (<=3)`);
      console.log(`    walked ${walked.toFixed(2)}m`);
      await sleep(600);

      // sprint drains stamina
      await page.evaluate(() => window.__game.player.setStamina(100));
      const sBefore = (await state(page)).stamina;
      await page.keyboard.down('Shift');
      await page.keyboard.down('w');
      await sleep(1300);
      await page.keyboard.up('w');
      await page.keyboard.up('Shift');
      const sAfter = (await state(page)).stamina;
      assert(sAfter < sBefore - 3, `sprint did not drain stamina (${sBefore} -> ${sAfter})`);
      console.log(`    sprint stamina ${sBefore} -> ${sAfter.toFixed(1)}`);
      await sleep(700); // stop drift

      // dash burst
      await page.evaluate(() => window.__game.player.setStamina(100));
      await sleep(300);
      const d0 = await pos(page);
      await page.keyboard.press('q');
      await sleep(300);
      const d1 = await pos(page);
      const dashed = horiz(d0, d1);
      assert(dashed > 2.5, `dash burst only ${dashed.toFixed(2)}m (<=2.5)`);
      console.log(`    dash burst ${dashed.toFixed(2)}m`);
      await shot(page, '02-movement.png');

      // regen back above 90 (timeScale to speed the wait; reset after)
      await page.evaluate(() => window.__game.player.setStamina(50));
      await page.evaluate(() => window.__game.setTimeScale(4));
      await sleep(2200);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(200);
      const sRegen = (await state(page)).stamina;
      assert(sRegen > 90, `stamina regen only reached ${sRegen.toFixed(1)} (<=90)`);
      console.log(`    stamina regenerated to ${sRegen.toFixed(1)}`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkTracking() {
  await check('c. Tracking loop: spawn → track → ring → complete → link → guide 1/15', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.setTimeScale(1));
      const id = await page.evaluate(() => window.__game.spawn('puffle', 6));
      assert(id !== null && id !== undefined, 'spawn("puffle") returned null');
      await page.evaluate((cid) => window.__game.track(cid), id);

      // ring appears in the DOM
      const gotRing = await page.waitForFunction(
        () => (document.querySelector('.wt-rings')?.children.length ?? 0) > 0,
        { timeout: 5000 },
      ).then(() => true).catch(() => false);
      assert(gotRing, 'tracking ring never appeared in .wt-rings');
      await shot(page, '03-tracking-ring.png');

      const before = await state(page);
      const ok = await page.evaluate((cid) => window.__game.completeTracking(cid), id);
      assert(ok === true, 'completeTracking returned false');

      const after = await pollState(
        page,
        (s) => s.inventory.rp === before.inventory.rp + 8 && s.linkedSpeciesCount === 1,
        { timeout: 6000 },
      );
      assert(after.inventory.rp === before.inventory.rp + 8, `rp did not increase by 8 (${before.inventory.rp} -> ${after.inventory.rp})`);
      assert(after.inventory.spark === before.inventory.spark + 1, `spark did not increase by 1 (${before.inventory.spark} -> ${after.inventory.spark})`);
      assert(after.linkedSpeciesCount === 1, `linkedSpeciesCount ${after.linkedSpeciesCount} != 1`);
      console.log(`    linked puffle: rp ${before.inventory.rp}->${after.inventory.rp}, spark ${before.inventory.spark}->${after.inventory.spark}, linked=${after.linkedSpeciesCount}`);

      // toast visible
      const toast = await page.waitForFunction(
        () => [...document.querySelectorAll('.wt-toast')].some((t) => /Linked/.test(t.textContent || '')),
        { timeout: 3000 },
      ).then(() => true).catch(() => false);
      assert(toast, 'no "Linked" toast appeared');
      await shot(page, '04-linked-toast.png');

      // Field Guide shows 1/15 (Task 1 raised the roster to 15 species)
      await page.keyboard.press('Tab');
      const guide18 = await page.waitForFunction(
        () => /\b1\/15\b/.test(document.querySelector('.wt-panel h1')?.textContent || ''),
        { timeout: 3000 },
      ).then(() => true).catch(() => false);
      assert(guide18, 'Field Guide did not show 1/15');
      const guideH1 = await page.evaluate(() => document.querySelector('.wt-panel h1')?.textContent ?? '');
      console.log(`    guide: "${guideH1.trim()}"`);
      await page.keyboard.press('Tab');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkCraft() {
  await check('d. Craft flow: grant → open craft → craft Grapple Hook → unlock present', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => {
        window.__game.grant('rp', 30);
        window.__game.grant('fiber', 12);
        window.__game.grant('resin', 6);
        window.__game.grant('shard', 8);
      });
      await page.keyboard.press('c'); // open craft
      await page.waitForFunction(
        () => (document.querySelector('.wt-panel h1')?.textContent || '').includes('Crafting'),
        { timeout: 3000 },
      );
      await shot(page, '05-craft.png');

      const clicked = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.wt-card')];
        const card = cards.find((c) => (c.querySelector('.wt-card-name')?.textContent || '').includes('Grapple Hook'));
        if (!card) return 'no-card';
        const btn = card.querySelector('.wt-craft-btn');
        if (!btn) return 'no-button';
        if (btn.disabled) return 'disabled';
        btn.click();
        return 'clicked';
      });
      assert(clicked === 'clicked', `could not click Grapple Hook craft button: ${clicked}`);

      const st = await pollState(page, (s) => s.unlocks.includes('grapple'), { timeout: 3000 });
      assert(st.unlocks.includes('grapple'), `unlocks does not contain grapple: [${st.unlocks.join(',')}]`);
      console.log(`    unlocks after craft: [${st.unlocks.join(', ')}]`);

      await page.keyboard.press('c'); // close
      await sleep(300);
      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkInventoryHotbar() {
  await check('w. Inventory + hotbar: Escape opens it, click-assign purifiers to a slot, wheel-selects it', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.grant('purifiers', 5));

      await openInventory(page);
      const h1 = await page.evaluate(() => document.querySelector('.wt-panel h1')?.textContent ?? '');
      assert(h1.includes('Inventory'), `Escape did not open the Inventory screen (h1="${h1}")`);
      console.log(`    Escape opened the Inventory screen ("${h1.trim()}")`);

      // Click-assign the owned Purify card to hotbar slot index 1 (key '2') —
      // the real `.wt-inv-card` / `.wt-inv-slot` DOM (Task 3), not a debug seam.
      await assignItemToSlot(page, 'Purify', 1);
      const assigned = await state(page);
      assert(
        assigned.hotbarSlots[1] === 'purifiers',
        `slot index 1 not assigned purifiers ([${assigned.hotbarSlots.join(',')}])`,
      );
      console.log(`    assigned purifiers -> hotbar slot 2 via .wt-inv-card/.wt-inv-slot clicks`);
      await shot(page, '29-inventory-hotbar.png');

      await closeInventory(page);
      const closedDisplay = await page.evaluate(
        () => document.querySelector('.wt-screen-overlay')?.style.display,
      );
      assert(closedDisplay === 'none', `inventory overlay did not hide on Escape (display="${closedDisplay}")`);

      // Scroll-wheel selection (Input.onWheel, gated on pointer lock — faked
      // here, see fakePointerLock's doc comment): one tick with deltaY>0
      // steps the selection +1 (hotbarStepForWheel), landing on the slot we
      // just assigned purifiers to.
      const before = await state(page);
      assert(before.selectedSlot === 0, `expected the default selection (slot 0) before scrolling, got ${before.selectedSlot}`);
      await fakePointerLock(page);
      await page.evaluate(() => {
        document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      });
      const after = await pollState(page, (s) => s.selectedSlot === 1, { timeout: 3000 });
      assert(after.selectedSlot === 1, `selectedSlot ${after.selectedSlot} != 1 after one wheel tick`);
      assert(after.hotbarSlots[after.selectedSlot] === 'purifiers', 'wheel-selected slot is not the purifiers slot');
      console.log(`    wheel tick (deltaY=120) selectedSlot ${before.selectedSlot} -> ${after.selectedSlot}`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkStructures() {
  await check('e. Structures: assign zipline kit to a hotbar slot (real inventory UI), select it, ghost active + real zipline+drone via ?debug=structures', async () => {
    // Placement ghost path: the pre-Task-3 model had a fixed Digit3-enters-
    // zipline-placement slot; the new 6-slot ASSIGNABLE hotbar starts a fresh
    // save with darts in slot 1 and every other slot empty, so a kit has to be
    // click-assigned to a slot via the real inventory screen (Task 3's
    // `.wt-inv-card`/`.wt-inv-slot` DOM) before any digit key selects it into
    // a placement ghost (`syncHotbarPlacement` in main.ts). Assigning alone
    // does not change the SELECTED slot (`assign()` in craft/hotbar.ts keeps
    // `selected` as-is) — and hotbar/digit actions are frozen while a screen
    // is open (`paused = screens.isOpen()` in main.ts) — so the inventory
    // screen must be closed before pressing the digit key that selects it.
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.grant('kit:zipline', 3));

      await openInventory(page);
      await assignItemToSlot(page, 'Zipline', 2); // slot index 2 -> key '3'
      const assignedState = await state(page);
      assert(
        assignedState.hotbarSlots[2] === 'kit:zipline',
        `slot index 2 not assigned kit:zipline ([${assignedState.hotbarSlots.join(',')}])`,
      );
      await closeInventory(page);

      await page.keyboard.press('3'); // hotbar slot 3 (now the zipline kit) -> enter placement
      const placing = await pollState(page, (s) => s.structures.placing === true, { timeout: 3000 });
      assert(placing.structures.placing === true, 'placement ghost (placing flag) never became true');
      assert(placing.selectedSlot === 2, `selectedSlot ${placing.selectedSlot} != 2 after pressing '3'`);
      console.log('    zipline kit assigned to slot 3 via the real inventory UI, then selected -> placement ghost active');
      await shot(page, '06-placement-ghost.png');

      await page.keyboard.press('Escape'); // cancel placement (Esc's top priority, per main.ts)
      const cancelled = await pollState(page, (s) => s.structures.placing === false, { timeout: 3000 });
      assert(cancelled.structures.placing === false, 'placement did not cancel on Escape');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }

    // Real placement path via the debug auto-place hook.
    const dbg = await openPage('?debug=structures&fresh=1');
    try {
      const st = await pollState(dbg, (s) => s.structures.ziplines === 1 && s.structures.drones === 1, { timeout: 6000 });
      assert(st.structures.ziplines === 1, `debug zipline not placed (count=${st.structures.ziplines})`);
      assert(st.structures.drones === 1, `debug drone not placed (count=${st.structures.drones})`);
      console.log(`    ?debug=structures placed: ziplines=${st.structures.ziplines}, drones=${st.structures.drones}`);
      await shot(dbg, '07-structures-debug.png');
      assert(dbg.__errors.length === 0, `console/page errors: ${dbg.__errors.join(' | ')}`);
    } finally {
      await dbg.close();
    }
    // Zipline count limit (maxZiplines=3) is covered by tests/structures.test.ts
    // ("enforces the max-zipline count and reports it"); confirm placement here
    // needs LMB which requires pointer lock (unavailable headless).
  });
}

async function checkBuilding() {
  await check('x. Building: craft Wall+Ramp, stack via __game.placePiece, composed-ground stand height', async () => {
    const page = await openPage('?fresh=1');
    try {
      await sleep(400); // settle grounded (mirrors checkMovement) before reading p0 below

      // Craft a Wall Block + a Ramp through the REAL craft screen — grants
      // farm-only wood/stone (Inventory+Building Task 1) directly rather than
      // farming them, but the RECIPE path itself (RP gate + cost spend +
      // Task 5's `walls`/`ramps` counters) is exercised for real, same DOM
      // technique as checkCraft's Grapple Hook click.
      await page.evaluate(() => {
        window.__game.grant('rp', 60);
        window.__game.grant('wood', 10);
        window.__game.grant('stone', 10);
      });
      await page.keyboard.press('c'); // open craft
      await page.waitForFunction(
        () => (document.querySelector('.wt-panel h1')?.textContent || '').includes('Crafting'),
        { timeout: 3000 },
      );
      const craftOne = async (name) => {
        const res = await page.evaluate((n) => {
          const card = [...document.querySelectorAll('.wt-card')].find((c) =>
            (c.querySelector('.wt-card-name')?.textContent || '').includes(n),
          );
          if (!card) return 'no-card';
          const btn = card.querySelector('.wt-craft-btn');
          if (!btn) return 'no-button';
          if (btn.disabled) return 'disabled';
          btn.click();
          return 'clicked';
        }, name);
        assert(res === 'clicked', `could not click ${name} craft button: ${res}`);
      };
      await craftOne('Wall Block');
      await craftOne('Ramp');
      await page.keyboard.press('c'); // close craft
      await sleep(300);

      const afterCraft = await state(page);
      assert(afterCraft.inventory.walls === 4, `walls after craft = ${afterCraft.inventory.walls} (expected 4, batch size)`);
      assert(afterCraft.inventory.ramps === 2, `ramps after craft = ${afterCraft.inventory.ramps} (expected 2, batch size)`);
      console.log(`    crafted via real craft screen: walls=${afterCraft.inventory.walls}, ramps=${afterCraft.inventory.ramps}`);

      // Place a 2-high wall stack + a standalone ramp via the debug
      // `__game.placePiece(kind,x,y,z,yaw)` seam, which routes through the
      // SAME `placementValid` path a real LMB confirm uses (bypassing only
      // the inventory spend) — a real LMB confirm itself needs a pointer
      // lock this harness fakes only for the wheel check above, and hold-F
      // pickup is separately noted as flaky headless below. `y` is each
      // piece's BASE height; stacking flush means piece 2's base == piece
      // 1's top (`terrain + wall.h`).
      const p0 = await pos(page);
      const bx = p0.x + 6;
      const bz = p0.z;
      const placed1 = await page.evaluate(
        ([x, y, z]) => window.__game.placePiece('wall', x, y, z, 0),
        [bx, p0.y, bz],
      );
      assert(placed1, 'placePiece(wall) #1 failed');
      const placed2 = await page.evaluate(
        ([x, y, z]) => window.__game.placePiece('wall', x, y, z, 0),
        [bx, p0.y + 2, bz],
      );
      assert(placed2, 'placePiece(wall) #2 (stacked flush on #1) failed');
      const rampPlaced = await page.evaluate(
        ([x, y, z]) => window.__game.placePiece('ramp', x, y, z, 0),
        [bx + 4, p0.y, bz],
      );
      assert(rampPlaced, 'placePiece(ramp) failed');

      const built = await state(page);
      assert(built.placedPieces === 3, `placedPieces ${built.placedPieces} != 3 (2 walls + 1 ramp)`);
      console.log(`    placed a 2-wall stack at (${bx.toFixed(1)}, ${bz.toFixed(1)}) + 1 standalone ramp; placedPieces=${built.placedPieces}`);

      // Composed ground (Task 5): teleport just above the stack and let
      // gravity settle the player — the controller's ground query is
      // `max(rawTerrain, build.topAt)`, so standing height should land on
      // the STACK's top (terrain + 2×wall.h = +4), not raw terrain.
      await page.evaluate(
        ([x, y, z]) => window.__game.player.teleport(x, y, z),
        [bx, p0.y + 5, bz],
      );
      await sleep(1000);
      const settled = await pos(page);
      const expectedY = p0.y + 4;
      assert(
        Math.abs(settled.y - expectedY) < 0.15,
        `standing height ${settled.y.toFixed(3)} not within 0.15 of the stack top ${expectedY.toFixed(3)} (composed ground not wired?)`,
      );
      console.log(`    stood on the 2-wall stack: y=${settled.y.toFixed(3)} (terrain ${p0.y.toFixed(3)} + 2×wall.h=4 -> ${expectedY.toFixed(3)})`);

      // Pop to a vantage a few metres back and above so the screenshot
      // actually frames the stack + ramp (standing ON TOP of the stack looks
      // out at the landscape, not down at what's underfoot) — same
      // `window.__village.lookAt` pattern checkVillage/checkPurifyArc use
      // for their own vantage shots (gated behind the same `?fresh=1` dev
      // session, not actually village-specific despite the name).
      await page.evaluate(
        ([x, y, z]) => window.__game.player.teleport(x, y, z),
        [bx - 6, expectedY + 4, bz + 6],
      );
      await page.evaluate(
        ([x, y, z]) => window.__village.lookAt(x, y, z),
        [bx + 1, p0.y + 1, bz],
      );
      await sleep(400);
      await shot(page, '30-building-stack.png');

      // Pick-up (hold-F reclaim) is intentionally NOT exercised here: it is a
      // real-hold-key + real-aim interaction (task-5-report.md's own manual
      // real-UI verification already exercised it once, with a documented
      // methodological note about SwiftShader frame-pacing making a held key
      // flaky to script reliably headless); BuildSystem's pickup math itself
      // (aim/begin/tick/cancel/progress) is covered by
      // tests/build-system.test.ts, not re-verified here.
      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkHands() {
  await check('y. Hands viewmodel: fresh save, camera-child "handsView" root visible + dart held, screenshot', async () => {
    const page = await openPage('?fresh=1');
    try {
      await sleep(400);
      const st = await state(page);
      // `state().hands` == `HandsView.debugState()` (Inventory+Building Task
      // 6): `rootVisible` is literally `this.root.visible` where
      // `this.root.name === 'handsView'` and `this.root` is a child of the
      // camera (`camera.add(root)` in hands.ts) — window.__game exposes no
      // raw camera/scene handle for a `page.evaluate` scene-graph traversal
      // (debug.ts/main.ts are outside this task's file scope), so this debug
      // snapshot IS the "camera has a child group named 'handsView' with
      // visible===true" fact, not a proxy for it.
      assert(st.hands, 'state().hands missing');
      assert(st.hands.rootVisible === true, `hands.rootVisible ${st.hands.rootVisible} != true`);
      // Fresh loadout: darts in slot 0 with PLAYER_START.startingDarts > 0,
      // so the left hand should be holding the dart mesh, not the bare mitten.
      assert(st.hands.leftItem === 'darts', `fresh loadout should hold darts in-hand, got "${st.hands.leftItem}"`);
      console.log(
        `    hands: rootVisible=${st.hands.rootVisible}, leftItem=${st.hands.leftItem}, ` +
          `rightWorldPos=[${st.hands.rightWorldPos.map((n) => n.toFixed(2)).join(',')}]`,
      );

      const buf = await page.screenshot();
      await shot(page, '31-hands.png');
      const png = decodePNG(buf);
      assert(png, 'could not decode hands screenshot PNG');
      const sd = luminanceStdDev(png);
      assert(sd > 8, `canvas appears blank (luminance stddev ${sd.toFixed(2)} <= 8)`);
      console.log(`    canvas luminance stddev = ${sd.toFixed(1)}`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkGrapple() {
  await check('f. Grapple: ?debug=grapple attaches a rope (state.grappling)', async () => {
    const page = await openPage('?debug=grapple&fresh=1');
    try {
      const st = await pollState(page, (s) => s.grappling === true, { timeout: 8000 });
      assert(st.grappling === true, 'grapple rope did not attach (state.grappling stayed false)');
      console.log('    grapple attached (state.grappling = true)');
      await shot(page, '08-grapple.png');
      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
    // Firing a live projectile hook + the auto-zip / hang need pointer lock
    // (unavailable headless); the projectile flight, latch, zip and pendulum
    // physics are covered by tests/grapple.test.ts and tests/grapple-swing.test.ts.
  });
}

async function checkSaveRoundtrip() {
  await check('g. Save round-trip: save → reload persists → reset → fresh', async () => {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    try {
      await page.goto(BASE + '?fresh=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game && window.__game.state, { timeout: 20000 });
      await sleep(600);

      // Build a distinctive state: an unlock, some RP, and a linked species.
      await page.evaluate(() => {
        window.__game.grant('rp', 50);
        window.__game.unlockAll();
      });
      const id = await page.evaluate(() => window.__game.spawn('puffle', 6));
      await page.evaluate((cid) => window.__game.track(cid), id);
      await page.evaluate((cid) => window.__game.completeTracking(cid), id);
      const saved = await pollState(page, (s) => s.linkedSpeciesCount === 1, { timeout: 6000 });
      assert(saved.linkedSpeciesCount === 1, 'failed to link a species before save');
      await page.evaluate(() => window.__game.save());
      const expectRp = saved.inventory.rp;
      console.log(`    saved state: rp=${expectRp}, linked=${saved.linkedSpeciesCount}, unlocks=[${saved.unlocks.join(',')}]`);

      // Reload WITHOUT ?fresh (same context => localStorage persists).
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game && window.__game.state, { timeout: 20000 });
      await sleep(600);
      const reloaded = await state(page);
      assert(reloaded.inventory.rp === expectRp, `rp not persisted (${reloaded.inventory.rp} != ${expectRp})`);
      assert(reloaded.linkedSpeciesCount === 1, `linked not persisted (${reloaded.linkedSpeciesCount})`);
      assert(reloaded.unlocks.includes('grapple'), `unlocks not persisted ([${reloaded.unlocks.join(',')}])`);
      console.log(`    reloaded: rp=${reloaded.inventory.rp}, linked=${reloaded.linkedSpeciesCount}, unlocks preserved`);
      await shot(page, '09-save-reload.png');

      // Reset: clears the save + reloads to a fresh loadout.
      await page.evaluate(() => window.__game.reset()).catch(() => {});
      await page.waitForLoadState('load').catch(() => {});
      await sleep(700);
      await page.waitForFunction(() => window.__game && window.__game.state, { timeout: 20000 });
      await sleep(400);
      const fresh = await state(page);
      assert(fresh.inventory.darts === 4, `after reset darts ${fresh.inventory.darts} != 4`);
      assert(fresh.inventory.rp === 0, `after reset rp ${fresh.inventory.rp} != 0`);
      assert(fresh.linkedSpeciesCount === 0, `after reset linked ${fresh.linkedSpeciesCount} != 0`);
      const key = await page.evaluate(() => localStorage.getItem('wildtag-save-v1'));
      assert(key === null, 'save key survived reset (autosave-on-unload re-wrote it)');
      console.log(`    after reset: darts=${fresh.inventory.darts}, rp=${fresh.inventory.rp}, linked=${fresh.linkedSpeciesCount}, save cleared`);
      await shot(page, '10-reset-fresh.png');

      assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });
}

async function checkPerf() {
  await check('h. Perf smoke: rAF fps at spawn', async () => {
    const page = await openPage('?fresh=1');
    try {
      const fps = await page.evaluate(() => new Promise((res) => {
        let n = 0; const t0 = performance.now();
        function tick() {
          n++;
          const el = performance.now() - t0;
          if (el >= 5000) res(n / (el / 1000));
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }));
      console.log(`    rAF fps over 5s = ${fps.toFixed(1)}`);
      // SwiftShader (software WebGL, no GPU) renders this full scene at only
      // ~11-15 fps on this host — measured empirically, and far below a real
      // GPU. The smoke's job is "the sim+render loop is live and animating, not
      // frozen"; the floor is set accordingly and the actual number recorded.
      // Real-GPU target is 60 (vsync-capped).
      assert(fps > 8, `fps ${fps.toFixed(1)} below the software-render floor of 8 (loop stalled?)`);
      if (fps <= 30) {
        console.log('    NOTE: SwiftShader software WebGL — expected low; a real GPU targets 60 fps.');
      }
      global.__perfFps = fps;
    } finally {
      await page.close();
    }
  });
}

// ---------------------------------------------------------------------------
// FIDELITY-2 P1 CHECKS (quality presets + draw-call consolidation)
// ---------------------------------------------------------------------------

/** Median draw calls over a short window (rejects per-frame critter-wander jitter). */
async function medianDrawCalls(page, samples = 15) {
  const xs = [];
  for (let i = 0; i < samples; i++) {
    xs.push(await page.evaluate(() => window.__game.renderStats().drawCalls));
    await sleep(60);
  }
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/** rAF fps over `ms`, measured on the live page. */
async function measureFps(page, ms = 3000) {
  return page.evaluate((dur) => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    function tick() {
      n++;
      const el = performance.now() - t0;
      if (el >= dur) res(n / (el / 1000));
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), ms);
}

// Draw-call budget at spawn. Two P1 consolidations: props went from one
// InstancedMesh per (chunk,kind) to one BatchedMesh per material group
// (~110 → ~9 draw calls, with per-instance frustum culling), and the static
// Haven village was merged into a handful of vertex-coloured meshes
// (~189 → ~4). Total spawn scene: ~566 before → ~276 after. The remaining
// floor is out-of-P1-scope dynamic geometry: ~48 primed wild critters
// (animated multi-mesh groups, ~170 draw calls in view) + the streamed
// per-chunk terrain field (~74, consolidation is P2 near-LOD work) — which is
// why the ceiling is 300 rather than the spec's aspirational 250. This check
// guards both consolidations against regression and records the live number;
// see the P1 report for the per-category budget breakdown.
const DRAW_CALL_CEILING = 300;

async function checkDrawCalls() {
  await check('o. Draw calls: renderStats at spawn under the consolidated ceiling', async () => {
    const page = await openPage('?fresh=1');
    try {
      await sleep(1200); // settle: prime + a few streamed frames
      const stats = await page.evaluate(() => window.__game.renderStats());
      assert(typeof stats.drawCalls === 'number', 'renderStats().drawCalls not a number');
      assert(typeof stats.triangles === 'number', 'renderStats().triangles not a number');
      assert(typeof stats.geometries === 'number', 'renderStats().geometries not a number');
      assert('textures' in stats, 'renderStats() missing textures');
      const dc = await medianDrawCalls(page);
      console.log(`    drawCalls (median) = ${dc}  [P1 ceiling ${DRAW_CALL_CEILING}; aspirational spec target 250 — see report: critters+terrain floor it]`);
      console.log(`    renderStats: calls=${stats.drawCalls} tris=${stats.triangles} geo=${stats.geometries} tex=${stats.textures}`);
      assert(dc <= DRAW_CALL_CEILING, `draw calls ${dc} exceed the consolidated ceiling ${DRAW_CALL_CEILING} (prop pooling regressed?)`);
      await shot(page, '21-drawcalls.png');
      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkQualityPresets() {
  await check('p. Quality presets: auto→low, low/high boot clean, flags differ, fps per preset', async () => {
    // (c) SwiftShader auto-detect → low with no ?quality param.
    const auto = await openPage('?fresh=1');
    let lowFps, highFps, lowDc, highDc;
    try {
      const st = await state(auto);
      assert(st.quality === 'low', `auto-detect quality ${st.quality} != low on SwiftShader`);
      console.log(`    (c) auto-detect on SwiftShader → quality=${st.quality}`);
      assert(auto.__errors.length === 0, `auto boot errors: ${auto.__errors.join(' | ')}`);
    } finally {
      await auto.close();
    }

    // (b)+(d) explicit ?quality=low — clean, state exposes it, flags dormant, fps ≥ floor.
    const low = await openPage('?quality=low&fresh=1');
    try {
      const st = await state(low);
      const q = await low.evaluate(() => window.__game.quality());
      assert(st.quality === 'low', `?quality=low → state.quality ${st.quality}`);
      assert(q.flags.shadowCascades === 0, `low shadowCascades ${q.flags.shadowCascades} != 0`);
      // P2: near-LOD 1 m terrain is OFF on the low preset (2 m grid everywhere).
      assert(q.flags.nearLod === false, `low nearLod ${q.flags.nearLod} != false`);
      await sleep(1000);
      lowDc = await medianDrawCalls(low);
      lowFps = await measureFps(low);
      console.log(`    (b) low: quality=${st.quality} shadowCascades=${q.flags.shadowCascades} nearLod=${q.flags.nearLod} drawCalls=${lowDc}`);
      console.log(`    (d) low fps over 3s = ${lowFps.toFixed(1)}`);
      assert(low.__errors.length === 0, `low boot errors: ${low.__errors.join(' | ')}`);
    } finally {
      await low.close();
    }

    // (b)+(d) explicit ?quality=high — clean, state exposes it, shadow flag differs, fps recorded.
    const high = await openPage('?quality=high&fresh=1');
    try {
      const st = await state(high);
      const q = await high.evaluate(() => window.__game.quality());
      assert(st.quality === 'high', `?quality=high → state.quality ${st.quality}`);
      assert(q.flags.shadowCascades === 2, `high shadowCascades ${q.flags.shadowCascades} != 2`);
      // P2: near-LOD 1 m terrain is ON for medium+; differs from low (false).
      assert(q.flags.nearLod === true, `high nearLod ${q.flags.nearLod} != true`);
      await sleep(1000);
      highDc = await medianDrawCalls(high);
      highFps = await measureFps(high);
      console.log(`    (b) high: quality=${st.quality} shadowCascades=${q.flags.shadowCascades} nearLod=${q.flags.nearLod} drawCalls=${highDc}`);
      console.log(`    (d) high fps over 3s = ${highFps.toFixed(1)} (informational on software render)`);
      assert(high.__errors.length === 0, `high boot errors: ${high.__errors.join(' | ')}`);
    } finally {
      await high.close();
    }

    // (b) low ≤ high draw calls, and the presets' shadow flag differs (0 vs 2).
    assert(lowDc <= highDc, `low draw calls ${lowDc} > high ${highDc}`);
    console.log(`    (b) low.drawCalls ${lowDc} ≤ high.drawCalls ${highDc}; shadow flag differs (0 vs 2); nearLod differs (false vs true)`);
    // (d) assert only against the low floor; high is informational on SwiftShader.
    assert(lowFps > 8, `low preset fps ${lowFps.toFixed(1)} below the software floor of 8`);
    console.log(`    fps recorded — low=${lowFps.toFixed(1)} high=${highFps.toFixed(1)} (assert: low ≥ 8)`);
  });
}

// ---------------------------------------------------------------------------
// HAVEN VILLAGE CHECKS (Phase 2 / Task V7)
// ---------------------------------------------------------------------------

async function checkVillage() {
  await check('i. Village: teleport to centre, ≥5 NPC labels in DOM, screenshot', async () => {
    const page = await openPage('?fresh=1');
    try {
      const center = await page.evaluate(() => window.__village.center);
      // Drop in above the plaza and settle onto the ground.
      await page.evaluate(([x, z]) => window.__game.player.teleport(x, 250, z), [center.x, center.z]);
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1800);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);
      const landed = await pos(page);
      // Pop to a vantage above the plaza and look down at the hamlet.
      await page.evaluate(([x, y, z]) => window.__game.player.teleport(x, y, z), [center.x, landed.y + 22, center.z]);
      await page.evaluate(([x, y, z]) => window.__village.lookAt(x, y, z), [center.x, landed.y, center.z]);
      await sleep(600);

      const labels = await page.$$eval('.wt-npc-label', (els) => els.map((e) => e.textContent));
      assert(labels.length >= 5, `only ${labels.length} NPC labels in DOM (<5): [${labels.join(', ')}]`);
      console.log(`    ${labels.length} NPC labels: [${labels.join(', ')}]`);
      await shot(page, '16-village.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkBondFlow() {
  await check('j. Bond flow: grant charm → spawn/track/complete → bond → rosterCount 1', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.grant('charms', 3));
      const id = await page.evaluate(() => window.__game.spawn('puffle', 6));
      assert(id !== null && id !== undefined, 'spawn("puffle") returned null');
      await page.evaluate((cid) => window.__game.track(cid), id);
      const ok = await page.evaluate((cid) => window.__game.completeTracking(cid), id);
      assert(ok === true, 'completeTracking returned false');
      // Let the tracking loop Link it, then bond.
      await pollState(page, (s) => s.linkedSpeciesCount === 1, { timeout: 6000 });
      const bonded = await page.evaluate((cid) => window.__game.bond(cid), id);
      assert(bonded === true, '__game.bond returned false');
      const st = await pollState(page, (s) => s.rosterCount === 1, { timeout: 4000 });
      assert(st.rosterCount === 1, `rosterCount ${st.rosterCount} != 1 after bond`);
      console.log(`    bonded puffle → rosterCount=${st.rosterCount}`);
      await shot(page, '17-bond-roster.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkBarter() {
  await check('k. Barter: fulfillRequest ×2 → rewards saddle+plotDeed, farm 4 unlocked plots', async () => {
    const page = await openPage('?fresh=1');
    try {
      // Force-fulfil Trader Juno twice: reward track hands out Saddle then Plot Deed.
      const r1 = await page.evaluate(() => window.__game.fulfillRequest('juno'));
      const r2 = await page.evaluate(() => window.__game.fulfillRequest('juno'));
      assert(r1 === true && r2 === true, `fulfillRequest failed (${r1}, ${r2})`);
      const st = await pollState(page, (s) => s.rewards.includes('saddle') && s.rewards.includes('plotDeed'), { timeout: 4000 });
      assert(st.rewards.includes('saddle'), `rewards missing saddle: [${st.rewards.join(',')}]`);
      assert(st.rewards.includes('plotDeed'), `rewards missing plotDeed: [${st.rewards.join(',')}]`);
      console.log(`    rewards after 2 fulfilments: [${st.rewards.join(', ')}]`);

      // One Plot Deed => 2 base + 2 = 4 unlocked plots. The farm reconciles the
      // live deed count in the sim loop, so poll a couple of frames for it.
      const farm = await pollUntil(
        () => page.evaluate(() => window.__game.farmState()),
        (f) => f.plots.filter((p) => p.unlocked).length === 4,
        { timeout: 4000 });
      const unlocked = farm.plots.filter((p) => p.unlocked).length;
      assert(unlocked === 4, `expected 4 unlocked plots after 1 deed, got ${unlocked}`);
      console.log(`    farm unlocked plots = ${unlocked}`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkFarm() {
  await check('l. Farm: bond → assignFarm → time-scale → hopper accrues', async () => {
    const page = await openPage('?fresh=1');
    try {
      // Grant a deed so a plot is unlocked, bond a puffle, assign it.
      await page.evaluate(() => {
        window.__game.grant('charms', 2);
        window.__game.grantReward('plotDeed');
      });
      const id = await page.evaluate(() => window.__game.spawn('puffle', 6));
      const bonded = await page.evaluate((cid) => window.__game.bond(cid), id);
      assert(bonded === true, 'bond failed');
      const rosterId = await page.evaluate(() => window.__game.state().rosterCount);
      assert(rosterId === 1, `rosterCount ${rosterId} != 1`);
      // The bonded critter reuses the wild critter id; assign it by that id.
      const assigned = await page.evaluate((cid) => window.__game.assignFarm(cid), id);
      assert(assigned === true, '__game.assignFarm returned false');

      // Fast-forward well past one produce period (90s) at 16×.
      await page.evaluate(() => window.__game.setTimeScale(16));
      const farm = await pollUntil(
        () => page.evaluate(() => window.__game.farmState()),
        (f) => f.plots.some((p) => Object.values(p.hopper).some((n) => n > 0)),
        { timeout: 15000 });
      await page.evaluate(() => window.__game.setTimeScale(1));
      const total = farm.plots.reduce((s, p) => s + Object.values(p.hopper).reduce((a, b) => a + b, 0), 0);
      assert(total > 0, `farm hopper never accrued (total=${total})`);
      console.log(`    farm produced ${total} item(s) into the hopper`);
      await shot(page, '18-farm.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkFarmProduce() {
  await check('l2. Farm produce (Inventory+Building): timberchomp assigned -> hopper accrues wood', async () => {
    // Mirrors checkFarm's flow exactly (grant a deed, bond, assignFarm,
    // fast-forward, poll the hopper) substituting a farm-only-resource
    // producer (timberchomp -> wood, Inventory+Building Task 1's
    // `farmRole: { kind: 'produce', resource: 'wood', amount: 2 }`) for the
    // generic puffle checkFarm already covers, so the species' farmRole ->
    // farm/farm.ts's produce accrual gets one real end-to-end exercise for
    // the new wood/stone resources specifically (not just "some resource").
    // The flow transferred cleanly (same debug seams, no species-specific
    // gate found in bond/assignFarm), so this is a standalone check rather
    // than an extension of checkFarm's own assertions.
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => {
        window.__game.grant('charms', 2);
        window.__game.grantReward('plotDeed');
      });
      const id = await page.evaluate(() => window.__game.spawn('timberchomp', 6));
      assert(id !== null && id !== undefined, 'spawn("timberchomp") returned null');
      const bonded = await page.evaluate((cid) => window.__game.bond(cid), id);
      assert(bonded === true, 'bond(timberchomp) failed');
      const rosterN = (await state(page)).rosterCount;
      assert(rosterN === 1, `rosterCount ${rosterN} != 1`);
      const assigned = await page.evaluate((cid) => window.__game.assignFarm(cid), id);
      assert(assigned === true, '__game.assignFarm(timberchomp) returned false');

      await page.evaluate(() => window.__game.setTimeScale(16));
      const farm = await pollUntil(
        () => page.evaluate(() => window.__game.farmState()),
        (f) => f.plots.some((p) => (p.hopper.wood ?? 0) > 0),
        { timeout: 15000 },
      );
      await page.evaluate(() => window.__game.setTimeScale(1));
      const wood = farm.plots.reduce((s, p) => s + (p.hopper.wood ?? 0), 0);
      assert(wood > 0, `timberchomp's farm plot never accrued wood (total=${wood})`);
      console.log(`    timberchomp produced ${wood} wood into the hopper`);
      await shot(page, '32-farm-wood.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkMount() {
  await check('m. Mount: __game.ride() true, pos moves >5m with W while mounted', async () => {
    const page = await openPage('?fresh=1');
    try {
      // Grant a saddle + bond a Prismhorse, then instantly ride.
      await page.evaluate(() => {
        window.__game.grant('charms', 2);
        window.__game.grantReward('saddle');
      });
      const id = await page.evaluate(() => window.__game.spawn('prismhorse', 6));
      const bonded = await page.evaluate((cid) => window.__game.bond(cid), id);
      assert(bonded === true, 'bond of prismhorse failed');
      const rode = await page.evaluate(() => window.__game.ride());
      assert(rode === true, '__game.ride() returned false');
      await sleep(300);
      const p0 = await pos(page);
      await page.keyboard.down('w');
      await sleep(1400);
      await page.keyboard.up('w');
      const p1 = await pos(page);
      const moved = horiz(p0, p1);
      assert(moved > 5, `mounted ride moved only ${moved.toFixed(2)}m (<=5)`);
      console.log(`    mounted ride moved ${moved.toFixed(2)}m`);
      await shot(page, '19-mount.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkSpeciesPreview() {
  await check('n. Species preview: ?preview=critters shows all 15, screenshot', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    try {
      await page.goto(BASE + '?preview=critters', { waitUntil: 'load' });
      await sleep(1500); // let the preview grid render
      const buf = await page.screenshot();
      await shot(page, '20-species-preview.png');
      const png = decodePNG(buf);
      assert(png, 'could not decode preview screenshot PNG');
      const sd = luminanceStdDev(png);
      assert(sd > 8, `preview canvas appears blank (luminance stddev ${sd.toFixed(2)} <= 8)`);
      console.log(`    preview canvas luminance stddev = ${sd.toFixed(1)}`);
      assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkBiomeTour() {
  await check('tuning. Biome flythrough screenshots (meadow/forest/wetland/crags/highlands)', async () => {
    const page = await openPage('?fresh=1');
    try {
      const biomes = [
        ['meadow', 120, 30, '11-biome-meadow.png'],
        ['forest', 161, -388, '12-biome-forest.png'],
        ['wetland', 0, 420, '13-biome-wetland.png'],
        ['crags', -420, 0, '14-biome-crags.png'],
        ['highlands', -297, -297, '15-biome-highlands.png'],
      ];
      for (const [name, x, z, file] of biomes) {
        // Stage 1: drop in, let it land on the biome surface + stream chunks.
        await page.evaluate(([xx, zz]) => window.__game.player.teleport(xx, 250, zz), [x, z]);
        await page.evaluate(() => window.__game.setTimeScale(8));
        await sleep(2200);
        await page.evaluate(() => window.__game.setTimeScale(1));
        await sleep(300);
        const landed = await pos(page);
        // Stage 2: pop to a fixed vantage above the landed ground so the forced-
        // horizontal headless camera (no mouse pitch) frames a landscape vista
        // instead of embedding in a steep slope. Chunks are already resident.
        await page.evaluate(([xx, yy, zz]) => window.__game.player.teleport(xx, yy, zz), [x, landed.y + 40, z]);
        await sleep(500);
        await shot(page, file);
        console.log(`    ${name}: ground y=${landed.y.toFixed(1)}, vista at (${x}, ${(landed.y + 40).toFixed(0)}, ${z}) -> ${file}`);
      }
      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

// ---------------------------------------------------------------------------
// CURSED CASTLE CHECKS (Task 15)
// ---------------------------------------------------------------------------

// Castle courtyard centre (src/core/constants.ts CASTLE.center) — fixed by
// the one-off site pick (Task 8); mirrored here rather than reaching into the
// module graph since the debug handle doesn't expose castle geometry.
const CASTLE_CENTER = { x: -424.7, z: -176.6 };
// A point inside the flattened build pad (padRadius=135) but outside the
// curtain wall (half=90), on the gate-facing (east) side — safe, flat ground
// to drop the player onto for a clean approach/vista shot (Castle Ward Task 2:
// resized 45→90/80→135, offset scaled from half+25 to half+20 outside).
const CASTLE_APPROACH = { x: CASTLE_CENTER.x + 110, z: CASTLE_CENTER.z };

// Ward maze world coordinates (Castle Ward Task 1's hand-authored 36x36
// `src/castle/wardMap.ts`, cellSize=5m, computed once via `wardLayout()` in a
// throwaway node script and pasted here — verify.mjs stays dependency-free,
// no ward.ts import). Grid cell (col,row) -> world via `cellToWorld` in
// ward.ts: x = CASTLE.center.x - 90 + 2.5 + col*5, z = CASTLE.center.z - 90 +
// 2.5 + row*5 (halfW=halfH=90 for the 36x36x5m grid).
//
// Map cell (row 10, col 17): a plain corridor '.' cell on the north-south
// spine directly above hall 0, 3 cells north of the hall's south entrance.
const WARD_CORRIDOR = { x: -427.2, z: -214.1 };
// Map cells (rows 4-6, col 15-19): hall 0 (the northwest great hall), a 3x5
// `H` region with doorway entrances at (row 3, col 17) and (row 7, col 17).
// Its centroid (returned as `wardLayout().halls[0].center`) sits inside the
// hall's own footprint since the region is a solid rectangle.
const WARD_HALL0_CENTER = { x: -427.2, z: -239.1 };
// Map cells (rows 4-8, col 4-8): plaza 0 (the northwest plaza), mid cell
// (row 6, col 6) = 'P'.
const WARD_PLAZA0_CENTER = { x: -482.2, z: -234.1 };

async function checkDayNight() {
  await check('q. Day/night cycle: night reads much darker than day, setTimeOfDay restores it', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.setTimeOfDay('day'));
      await sleep(500);
      const dayPng = decodePNG(await page.screenshot());
      assert(dayPng, 'could not decode day screenshot PNG');
      const dayMean = meanLuminance(dayPng);

      await page.evaluate(() => window.__game.setTimeOfDay('night'));
      await sleep(1200); // let night sky/fog/lighting settle
      const nightBuf = await page.screenshot();
      await shot(page, '22-night.png');
      const nightPng = decodePNG(nightBuf);
      assert(nightPng, 'could not decode night screenshot PNG');
      const nightSd = luminanceStdDev(nightPng);
      const nightMean = meanLuminance(nightPng);
      assert(nightSd > 2, `night canvas has no structure (luminance stddev ${nightSd.toFixed(2)} <= 2)`);
      assert(nightMean < dayMean * 0.6, `night mean (${nightMean.toFixed(1)}) not well below day mean (${dayMean.toFixed(1)})`);
      console.log(`    day mean=${dayMean.toFixed(1)}, night mean=${nightMean.toFixed(1)} (stddev ${nightSd.toFixed(2)})`);

      await page.evaluate(() => window.__game.setTimeOfDay('day'));
      await sleep(800);
      const restoredPng = decodePNG(await page.screenshot());
      assert(restoredPng, 'could not decode restored-day screenshot PNG');
      const restoredMean = meanLuminance(restoredPng);
      assert(restoredMean > nightMean, `day restore (${restoredMean.toFixed(1)}) not brighter than night (${nightMean.toFixed(1)})`);
      console.log(`    setTimeOfDay('day') restored mean=${restoredMean.toFixed(1)}`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkCastle() {
  await check('r. Castle: ?debug=castle framing, no errors, a gargoyle on its perch', async () => {
    const page = await openPage('?debug=castle&fresh=1');
    try {
      const buf = await page.screenshot();
      await shot(page, '23-castle-day.png');
      const png = decodePNG(buf);
      assert(png, 'could not decode castle screenshot PNG');
      const sd = luminanceStdDev(png);
      assert(sd > 8, `castle canvas appears blank (luminance stddev ${sd.toFixed(2)} <= 8)`);

      const critters = await page.evaluate(() => window.__game.listCritters());
      // GARGOYLE_DETECT_R: perches sit on tower tops/keep corners, at most
      // CASTLE.half*sqrt(2) (90*sqrt(2) ~= 127.3m) from center — 160 keeps a
      // safe ~33m margin (Castle Ward Task 2 resized half 45->90, which ate
      // most of the old 150m literal's slack down to ~23m).
      const GARGOYLE_DETECT_R = 160; // CASTLE.half*sqrt(2) + margin
      const gargoyle = critters.find(
        (c) => c.species === 'gargoyle' && Math.hypot(c.pos.x - CASTLE_CENTER.x, c.pos.z - CASTLE_CENTER.z) < GARGOYLE_DETECT_R,
      );
      assert(
        gargoyle,
        `no gargoyle within ${GARGOYLE_DETECT_R}m of castle center (active species: [${[...new Set(critters.map((c) => c.species))].join(',')}])`,
      );
      console.log(
        `    gargoyle #${gargoyle.id} at (${gargoyle.pos.x.toFixed(1)}, ${gargoyle.pos.y.toFixed(1)}, ${gargoyle.pos.z.toFixed(1)}), state=${gargoyle.state}`,
      );

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
  // A castle-wall grapple assertion was considered (spec §9's "playtest the
  // whole loop" implies grappling the keep). checkGrapple's ?debug=grapple
  // scan fires via `raycastTerrain` against the height-field only — castle
  // walls are mesh obstacles, not terrain, so that scan can never hit one.
  // `player.debugFireGrapple(anchor)` (the method the debug path calls) takes
  // an arbitrary world point and isn't picky about the source, but it is not
  // reachable from `window.__game` (only `state/player.{pos,teleport,
  // setStamina}` are exposed) and wiring a new debug hook for it is out of
  // this task's declared file scope (e2e/verify.mjs + FOLLOWUPS.md +
  // screenshots only). Noted in the task report rather than implemented.
}

async function checkGoblinsAndHp() {
  await check('s. Goblins + HP: night spawns a ring, a forced goblin lands a hit, HP drops', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(
        ([x, z]) => window.__game.player.teleport(x, 250, z),
        [CASTLE_APPROACH.x, CASTLE_APPROACH.z],
      );
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1800);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);

      await page.evaluate(() => window.__game.setTimeOfDay('night'));
      const night = await pollState(page, (s) => s.goblinCount > 0, { timeout: 6000 });
      assert(night.goblinCount > 0, `goblinCount stayed 0 after night fell (${night.goblinCount})`);
      console.log(`    night fell: goblinCount=${night.goblinCount}`);

      const before = await state(page);
      assert(before.hp === 100, `hp ${before.hp} != 100 before the debug goblin lands a hit`);
      await page.evaluate(() => window.__game.spawnGoblin());
      const hit = await pollState(page, (s) => s.hp < 100, { timeout: 8000 });
      assert(hit.hp < 100, `hp never dropped below 100 after spawnGoblin() (stayed ${hit.hp})`);
      console.log(`    debug goblin lunge: hp ${before.hp} -> ${hit.hp}`);
      await shot(page, '24-goblins-night.png');

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkPurifyArc() {
  await check('t. Purify arc: purifyCrystal → castlePurified, elf city by day, survives reload', async () => {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    try {
      await page.goto(BASE + '?fresh=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game && window.__game.state, { timeout: 20000 });
      await sleep(600);

      const before = await state(page);
      assert(before.castlePurified === false, `castlePurified already true before purifyCrystal() (${before.castlePurified})`);

      await page.evaluate(() => window.__game.purifyCrystal());
      const purified = await pollState(page, (s) => s.castlePurified === true, { timeout: 4000 });
      assert(purified.castlePurified === true, 'castlePurified never became true after purifyCrystal()');
      console.log('    castlePurified = true after purifyCrystal()');

      // Populate the elf city directly at its deterministic castle-side homes
      // (setElves reconciles to N at their spiral home positions) so the day
      // screenshot actually shows residents, rather than waiting on however
      // many goblins happened to be alive (here: none) to wander home.
      await page.evaluate(() => window.__game.setElves(6));
      const populated = await pollState(page, (s) => s.elfCount === 6, { timeout: 3000 });
      assert(populated.elfCount === 6, `elfCount ${populated.elfCount} != 6 after setElves(6)`);

      await page.evaluate(() => window.__game.setTimeOfDay('day'));
      await page.evaluate(
        ([x, z]) => window.__game.player.teleport(x, 250, z),
        [CASTLE_APPROACH.x, CASTLE_APPROACH.z],
      );
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1800);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);
      const landed = await pos(page);
      await page.evaluate(
        ([x, y, z]) => window.__game.player.teleport(x, y, z),
        [CASTLE_APPROACH.x, landed.y + 30, CASTLE_APPROACH.z],
      );
      await sleep(500);
      await shot(page, '25-elf-city.png');
      console.log(`    elf-city vista shot at (${CASTLE_APPROACH.x}, ${(landed.y + 30).toFixed(0)}, ${CASTLE_APPROACH.z})`);

      await page.evaluate(() => window.__game.save());

      // Reload WITHOUT ?fresh (same context => localStorage persists) —
      // mirrors checkSaveRoundtrip's reload pattern.
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game && window.__game.state, { timeout: 20000 });
      await sleep(600);
      const reloaded = await state(page);
      assert(reloaded.castlePurified === true, `castlePurified not persisted across reload (${reloaded.castlePurified})`);
      assert(reloaded.elfCount === 6, `elfCount not persisted across reload (${reloaded.elfCount} != 6)`);
      console.log(`    reloaded: castlePurified=${reloaded.castlePurified}, elfCount=${reloaded.elfCount}`);

      assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });
}

async function checkWardMaze() {
  await check('u. Ward maze: corridor teleport, hall entry sets inHall, night torchlight', async () => {
    const page = await openPage('?fresh=1');
    try {
      // Drop into a known ward corridor cell (see WARD_CORRIDOR comment) —
      // teleport + settle mirrors checkGoblinsAndHp/checkPurifyArc's pattern
      // rather than a keyboard walk: headless has no pointer lock, so the
      // camera yaw (and thus 'w' movement direction) can't be steered.
      await page.evaluate(
        ([x, z]) => window.__game.player.teleport(x, 150, z),
        [WARD_CORRIDOR.x, WARD_CORRIDOR.z],
      );
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1500);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);

      const corridorState = await state(page);
      assert(corridorState.inHall === false, `inHall true while standing in the open corridor (${WARD_CORRIDOR.x}, ${WARD_CORRIDOR.z})`);
      await shot(page, '26-ward-corridor.png');
      console.log(`    corridor: inHall=${corridorState.inHall} at (${WARD_CORRIDOR.x}, ${WARD_CORRIDOR.z})`);

      // Night, so the hall's torchlight actually reads in the screenshot.
      await page.evaluate(() => window.__game.setTimeOfDay('night'));
      await sleep(500);

      // "Walk into hall 0's doorway": teleported straight to the hall's
      // centroid (inside its footprint, past the doorway) for the same
      // no-pointer-lock reason as above; `inHall` is polled rather than
      // asserted immediately since the ceiling/roof check reads the player's
      // position on the next sim step (Task 5's `movementCeiling`).
      await page.evaluate(
        ([x, z]) => window.__game.player.teleport(x, 150, z),
        [WARD_HALL0_CENTER.x, WARD_HALL0_CENTER.z],
      );
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1500);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);

      const hallState = await pollState(page, (s) => s.inHall === true, { timeout: 4000 });
      assert(hallState.inHall === true, `inHall never became true inside hall 0 (${WARD_HALL0_CENTER.x}, ${WARD_HALL0_CENTER.z})`);
      console.log(`    hall 0 interior: inHall=${hallState.inHall} at night`);
      await shot(page, '27-hall-interior.png');
      // Grapple suppression under a hall roof (state().inHall gates
      // `player.movementCeiling`, Task 5) is NOT separately asserted here:
      // the only grapple entry point exposed to e2e is `?debug=grapple`'s
      // own auto-fire-on-load flow (see checkGrapple), which can't be
      // combined with a mid-run teleport into the hall first, and there is
      // no pointer-lock faking in this harness to fire RMB directly (see the
      // file header's NOTE ON HEADLESS INPUT). `inHall` — the flag the
      // suppression itself is gated on — is asserted above; the suppression
      // wiring itself is covered by tests/*.test.ts (grapple + hall).

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

async function checkWardElves() {
  await check('v. Ward elves: setElves(9), day, elfCount reflects it at a plaza', async () => {
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.setTimeOfDay('day'));
      await page.evaluate(() => window.__game.setElves(9));
      const populated = await pollState(page, (s) => s.elfCount === 9, { timeout: 3000 });
      assert(populated.elfCount === 9, `elfCount ${populated.elfCount} != 9 after setElves(9)`);

      await page.evaluate(
        ([x, z]) => window.__game.player.teleport(x, 150, z),
        [WARD_PLAZA0_CENTER.x, WARD_PLAZA0_CENTER.z],
      );
      await page.evaluate(() => window.__game.setTimeScale(8));
      await sleep(1500);
      await page.evaluate(() => window.__game.setTimeScale(1));
      await sleep(300);
      await shot(page, '28-elf-plaza.png');
      console.log(`    elfCount=${populated.elfCount} at plaza 0 (${WARD_PLAZA0_CENTER.x}, ${WARD_PLAZA0_CENTER.z})`);

      assert(page.__errors.length === 0, `console/page errors: ${page.__errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });
}

// ---------------------------------------------------------------------------
let browser;
async function main() {
  BASE = await startServer();
  browser = await chromium.launch({ headless: true, args: LAUNCH_FLAGS });
  context = await browser.newContext({ viewport: VIEWPORT });

  await checkBoot();
  await checkMovement();
  await checkTracking();
  await checkCraft();
  await checkInventoryHotbar();
  await checkStructures();
  await checkBuilding();
  await checkHands();
  await checkGrapple();
  await checkSaveRoundtrip();
  await checkVillage();
  await checkBondFlow();
  await checkBarter();
  await checkFarm();
  await checkFarmProduce();
  await checkMount();
  await checkSpeciesPreview();
  await checkPerf();
  await checkDrawCalls();
  await checkQualityPresets();
  await checkBiomeTour();
  await checkDayNight();
  await checkCastle();
  await checkGoblinsAndHp();
  await checkPurifyArc();
  await checkWardMaze();
  await checkWardElves();

  await context.close();
  await browser.close();
}

try {
  await main();
} catch (e) {
  console.error('\nFATAL harness error:', e.stack || e.message);
  results.push({ name: 'harness', ok: false, err: e.message });
} finally {
  stopServer();
}

// --- summary ---------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const total = results.length;
const totalRetries = results.reduce((s, r) => s + (r.retries || 0), 0);
console.log('\n' + '─'.repeat(64));
console.log(
  `RESULT: ${passed}/${total} checks passed` +
    (totalRetries ? ` — ${totalRetries} ${retryWord(totalRetries)} across the run` : '') +
    (STRICT ? ' [VERIFY_STRICT]' : ''),
);
for (const r of results) {
  const tag = r.retries ? ` (${r.retries} ${retryWord(r.retries)})` : '';
  console.log(`  ${r.ok ? '✔' : '✘'} ${r.name}${tag}${r.ok ? '' : ' — ' + r.err}`);
}
if (global.__perfFps) console.log(`  perf: ${global.__perfFps.toFixed(1)} fps (SwiftShader)`);
if (totalRetries && !STRICT) {
  console.log(`  NOTE: ${totalRetries} ${retryWord(totalRetries)} used — re-run with VERIFY_STRICT=1 to fail on any retry.`);
}
console.log('─'.repeat(64));
console.log(`Screenshots: ${SHOT_DIR}`);

process.exit(passed === total ? 0 : 1);
