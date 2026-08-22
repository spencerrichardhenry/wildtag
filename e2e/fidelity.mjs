#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Wildtag visual-fidelity snips (Fidelity-3).
//
// NOT a pass/fail gate — a repeatable camera rig. Captures a fixed set of
// framed screenshots ("snips") across biomes/assets so every visual change
// can be eyeballed against the style reference (docs/fidelity/reference.png),
// and regenerates docs/fidelity/compare.html placing each snip next to the
// reference. The only assertions are that pages boot without console/page
// errors.
//
// Run:
//   PLAYWRIGHT_DIR=/path/to/playwright/install node e2e/fidelity.mjs
//   ... [snipName ...]        capture only the named snips (faster iteration)
//   FIDELITY_QUALITY=medium   preset for 3D snips (default medium — SwiftShader
//                             auto-detects LOW, which hides the target look)
//
// Playwright setup + server behaviour identical to e2e/verify.mjs (VERIFY_URL
// respected). Camera framing uses __game.setLook (headless has no pointer
// lock) + the teleport-and-settle trick for true ground height.
// ---------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SHOT_DIR = join(REPO, 'docs', 'fidelity');
mkdirSync(SHOT_DIR, { recursive: true });

const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR;
if (!PLAYWRIGHT_DIR) {
  console.error('FATAL: set PLAYWRIGHT_DIR (see e2e/verify.mjs header).');
  process.exit(2);
}
const requireFrom = createRequire(join(PLAYWRIGHT_DIR, 'noop.js'));
const { chromium } = requireFrom('playwright');

const LAUNCH_FLAGS = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
];

// Reference image is 1672x941; match its aspect so compositions compare 1:1.
const VIEWPORT = { width: 1672, height: 941 };
const QUALITY = process.env.FIDELITY_QUALITY || 'medium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- server (same contract as verify.mjs) ----------------------------------
let serverProc = null;

async function startServer() {
  if (process.env.VERIFY_URL) {
    const base = process.env.VERIFY_URL.replace(/\/+$/, '') + '/';
    await waitReachable(base);
    return base;
  }
  console.log('Spawning `npm run dev` ...');
  const base = await new Promise((res, rej) => {
    serverProc = spawn('npm', ['run', 'dev'], { cwd: REPO, detached: true, env: process.env });
    let out = '';
    const to = setTimeout(() => rej(new Error('dev server did not report a port within 40s')), 40000);
    const onData = (d) => {
      out += d.toString().replace(/\x1b\[[0-9;]*m/g, '');
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
  return base;
}

async function waitReachable(base) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`server at ${base} never became reachable`);
}

function stopServer() {
  if (!serverProc) return;
  try { process.kill(-serverProc.pid, 'SIGTERM'); }
  catch { try { serverProc.kill('SIGTERM'); } catch { /* ignore */ } }
}

// --- page helpers -----------------------------------------------------------
let BASE;
let context;

async function openPage(query, { waitForGame = true } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.__errors = errors;
  await page.goto(BASE + query, { waitUntil: 'load' });
  if (waitForGame) {
    // ?preview=critters boots a bare turntable without the __game handle,
    // so those snips wait on the canvas instead.
    await page.waitForFunction(
      () => window.__game && typeof window.__game.state === 'function',
      { timeout: 30000 },
    );
  } else {
    await page.waitForSelector('canvas', { timeout: 30000 });
  }
  await sleep(700);
  return page;
}

/** Teleport straight to ground height (+eye) via __game.groundY — exact and
 *  immune to the SwiftShader stalls that made fall-and-settle flaky. Gravity
 *  keeps acting after a teleport, so elevated (`eye`) poses are re-pinned
 *  right before the caller screenshots (the player would otherwise have
 *  fallen to the ground during the streaming wait — a probe artifact that
 *  once masqueraded as a rendering bug). */
async function frame(page, { x, z, yaw = 0, pitch = 0, eye = 0 }) {
  const place = () =>
    page.evaluate(([xx, zz, ee]) => {
      const y = window.__game.groundY(xx, zz);
      window.__game.player.teleport(xx, y + 0.1 + ee, zz);
    }, [x, z, eye]);
  await place();
  await page.evaluate(([yw, pt]) => window.__game.setLook(yw, pt), [yaw, pitch]);
  await sleep(2400); // stream chunks/props at the new spot
  if (eye > 0) await place(); // re-pin: the wait let gravity pull the pose down
}

const shot = (page, name) => page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });

// --- snip catalogue ----------------------------------------------------------
// Each snip: { name, note, query?, run(page) }. Coordinates follow the biome
// map (sectorBiome): crags W/SW, highlands NW, forest N/NE, meadow E/SE,
// wetland S. Village at ~(40, -104), castle at (-424.7, -176.6).
const SNIPS = [
  {
    name: 'meadow-vista',
    note: 'Reference composition: eye-level meadow, path + scatter + framing trees, village/windmill distant.',
    run: async (page) => {
      await frame(page, { x: 120, z: 30, yaw: Math.PI / 2, pitch: -0.06 });
      await shot(page, 'meadow-vista');
    },
  },
  {
    name: 'meadow-ground',
    note: 'Near-field scatter density: grass tufts, flowers, mushrooms, small rocks.',
    run: async (page) => {
      // Off-path pose (route 3 passes ~(150, 57)) — standing ON a corridor
      // reads as an empty ring since scatter is path-suppressed by design.
      await frame(page, { x: 140, z: 34, yaw: 0.6, pitch: -0.3 });
      await shot(page, 'meadow-ground');
    },
  },
  {
    name: 'forest-interior',
    note: 'Tree trunks/canopies from inside the forest; conifer + broadleaf mix.',
    run: async (page) => {
      await frame(page, { x: 161, z: -388, yaw: Math.PI, pitch: 0.04 });
      await shot(page, 'forest-interior');
    },
  },
  {
    name: 'crags-vista',
    note: 'Crag silhouettes + rock palette.',
    run: async (page) => {
      await frame(page, { x: -420, z: 0, yaw: -Math.PI / 2, pitch: 0.05, eye: 18 });
      await shot(page, 'crags-vista');
    },
  },
  {
    name: 'highlands',
    note: 'Highland rolling terrain + tree line.',
    run: async (page) => {
      await frame(page, { x: -297, z: -297, yaw: -Math.PI * 0.75, pitch: -0.03 });
      await shot(page, 'highlands');
    },
  },
  {
    name: 'wetland-shore',
    note: 'Water edge, reeds, lilypads.',
    run: async (page) => {
      await frame(page, { x: 0, z: 400, yaw: Math.PI, pitch: -0.12 });
      await shot(page, 'wetland-shore');
    },
  },
  {
    name: 'village',
    note: 'Haven village houses/roofs/windmill from the meadow approach.',
    run: async (page) => {
      await frame(page, { x: 90, z: -60, yaw: Math.PI * 0.35, pitch: -0.02 });
      await shot(page, 'village');
    },
  },
  {
    name: 'castle',
    note: 'Castle silhouette from the approach.',
    run: async (page) => {
      await frame(page, { x: -360, z: -140, yaw: -Math.PI * 0.42, pitch: 0.1 });
      await shot(page, 'castle');
    },
  },
  {
    name: 'night',
    note: 'Night palette: sky stops, stars, moon (should stay dark vs day).',
    run: async (page) => {
      await page.evaluate(() => window.__game.setTimeOfDay('night'));
      await frame(page, { x: 120, z: 30, yaw: Math.PI / 2, pitch: -0.02 });
      await shot(page, 'night');
    },
  },
  {
    name: 'hands-hud',
    note: 'First-person hands + full HUD (compass/hotbar/counters) at spawn.',
    run: async (page) => {
      // A tracked critter puts the tracker pill + ring on screen like the reference.
      await frame(page, { x: 120, z: 30, yaw: Math.PI / 2, pitch: -0.1 });
      await page.evaluate(() => {
        const id = window.__game.spawn('puffle', 7);
        if (id != null) window.__game.track(id);
      });
      await sleep(900);
      await shot(page, 'hands-hud');
    },
  },
  {
    name: 'critter-sheet',
    note: 'All species turntable (?preview=critters) — chunky bodies, big eyes bar.',
    query: `?preview=critters&quality=${QUALITY}`,
    waitForGame: false,
    run: async (page) => {
      await sleep(2500);
      await shot(page, 'critter-sheet');
    },
  },
];

// --- compare page -------------------------------------------------------------
function writeComparePage(captured) {
  const rows = SNIPS.map((s) => {
    const done = captured.has(s.name);
    return `
    <section>
      <h2>${s.name}${done ? '' : ' <em>(not captured this run)</em>'}</h2>
      <p>${s.note}</p>
      <div class="pair">
        <figure><img src="reference.png" alt="reference"><figcaption>reference</figcaption></figure>
        <figure><img src="${s.name}.png?t=${Date.now()}" alt="${s.name}"><figcaption>${s.name}</figcaption></figure>
      </div>
    </section>`;
  }).join('\n');
  writeFileSync(join(SHOT_DIR, 'compare.html'), `<!doctype html>
<meta charset="utf-8">
<title>wildtag fidelity compare</title>
<style>
  body { font: 14px system-ui; margin: 24px; background: #14181e; color: #dfe6ee; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 28px 0 4px; }
  p { color: #9aa7b5; margin: 0 0 8px; }
  .pair { display: flex; gap: 8px; }
  figure { margin: 0; flex: 1; min-width: 0; }
  img { width: 100%; border-radius: 6px; }
  figcaption { color: #9aa7b5; font-size: 12px; padding-top: 2px; }
  em { color: #e0b060; font-style: normal; }
</style>
<h1>wildtag fidelity snips vs reference &mdash; quality=${QUALITY}</h1>
${rows}
`);
}

// --- main ---------------------------------------------------------------------
const only = new Set(process.argv.slice(2));
const results = [];

try {
  BASE = await startServer();
  const browser = await chromium.launch({ args: LAUNCH_FLAGS });
  context = await browser.newContext({ viewport: VIEWPORT });

  const captured = new Set();
  for (const snip of SNIPS) {
    if (only.size && !only.has(snip.name)) continue;
    process.stdout.write(`▶ ${snip.name}\n`);
    const t0 = Date.now();
    try {
      const page = await openPage(snip.query ?? `?fresh=1&quality=${QUALITY}`, { waitForGame: snip.waitForGame !== false });
      await snip.run(page);
      const errs = page.__errors;
      if (errs.length) throw new Error(errs.join(' | '));
      await page.close();
      captured.add(snip.name);
      results.push({ name: snip.name, ok: true });
      console.log(`  ✔ ${Date.now() - t0}ms`);
    } catch (e) {
      results.push({ name: snip.name, ok: false, err: e.message });
      console.log(`  x FAIL: ${e.message}`);
    }
  }
  writeComparePage(only.size ? new Set(SNIPS.map((s) => s.name)) : captured);
  await browser.close();
} finally {
  stopServer();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} snips captured → docs/fidelity/`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.name}: ${f.err}`);
  process.exit(1);
}
