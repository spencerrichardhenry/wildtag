#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Wildtag end-to-end verification (Task 15).
//
// A standalone Node script that drives the real game in a headless Chromium
// (SwiftShader WebGL) and ASSERTS the whole gameplay loop end-to-end: boot,
// movement, tracking/link, crafting, structures, grapple, save round-trip and
// a perf smoke. Every phase writes a screenshot to docs/verify/NN-name.png.
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
async function check(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  // Retry once: SwiftShader under load can transiently crash a renderer page
  // (window.__game vanishing). A genuine failure fails both attempts; each
  // attempt opens its own fresh page(s), so a retry is side-effect-clean.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      results.push({ name, ok: true, ms: Date.now() - t0 });
      console.log(`  ✔ PASS (${Date.now() - t0}ms)`);
      return;
    } catch (e) {
      if (attempt === 1) {
        console.log(`  … attempt 1 failed (${e.message}); retrying`);
        await sleep(1000);
        continue;
      }
      results.push({ name, ok: false, err: e.message, ms: Date.now() - t0 });
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

      // 8 species — assert via the Field Guide denominator
      await page.keyboard.press('Tab');
      await sleep(400);
      const guideH1 = await page.evaluate(() => document.querySelector('.wt-panel h1')?.textContent ?? '');
      assert(/\/8\b/.test(guideH1), `Field Guide does not show /8 species ("${guideH1}")`);
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
  await check('c. Tracking loop: spawn → track → ring → complete → link → guide 1/8', async () => {
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

      // Field Guide shows 1/8
      await page.keyboard.press('Tab');
      const guide18 = await page.waitForFunction(
        () => /\b1\/8\b/.test(document.querySelector('.wt-panel h1')?.textContent || ''),
        { timeout: 3000 },
      ).then(() => true).catch(() => false);
      assert(guide18, 'Field Guide did not show 1/8');
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

async function checkStructures() {
  await check('e. Structures: placement ghost (hotbar 3) + real zipline+drone via ?debug=structures', async () => {
    // Placement ghost path (keyboard-driven; confirm needs LMB/pointer-lock — see header note).
    const page = await openPage('?fresh=1');
    try {
      await page.evaluate(() => window.__game.grant('kit:zipline', 3));
      await page.keyboard.press('3'); // hotbar 3 -> enter zipline placement
      const placing = await pollState(page, (s) => s.structures.placing === true, { timeout: 3000 });
      assert(placing.structures.placing === true, 'placement ghost (placing flag) never became true');
      console.log('    zipline placement ghost active (state.structures.placing = true)');
      await shot(page, '06-placement-ghost.png');

      await page.keyboard.press('Escape'); // cancel placement
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
    // Reel-in displacement (LMB) needs pointer lock (unavailable headless); the
    // rope pull/pendulum physics are covered by tests/grapple.test.ts and
    // tests/grapple-swing.test.ts.
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
let browser;
async function main() {
  BASE = await startServer();
  browser = await chromium.launch({ headless: true, args: LAUNCH_FLAGS });
  context = await browser.newContext({ viewport: VIEWPORT });

  await checkBoot();
  await checkMovement();
  await checkTracking();
  await checkCraft();
  await checkStructures();
  await checkGrapple();
  await checkSaveRoundtrip();
  await checkPerf();
  await checkBiomeTour();

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
console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${passed}/${total} checks passed`);
for (const r of results) console.log(`  ${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.err}`);
if (global.__perfFps) console.log(`  perf: ${global.__perfFps.toFixed(1)} fps (SwiftShader)`);
console.log('─'.repeat(64));
console.log(`Screenshots: ${SHOT_DIR}`);

process.exit(passed === total ? 0 : 1);
