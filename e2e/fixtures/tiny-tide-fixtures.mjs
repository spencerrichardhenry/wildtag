// Shared helpers for the Tiny Tide browser tests. Fixtures come from the dev-only page tests-browser/fixtures.html, which
// builds saves with the game's own modules. Tests write them into localStorage (same origin) before opening the game.
import { chromium } from 'playwright';

export const BASE = process.env.TIDE_BASE || 'http://127.0.0.1:5199';
export const GAME = `${BASE}/tiny-tide.html?qa`;
export const FIXTURES = `${BASE}/tests-browser/fixtures.html`;
export const KEYS = { v4: 'tiny-tide-adventure-v4', fresh: 'tiny-tide-adventure-v4-fresh', v2: 'tiny-tide-adventure-v2', v1: 'tiny-tide-adventure-v1' };

export const launch = () => chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });

/** Navigates `page` to the fixture page (same origin as the game). */
export async function toFixturePage(page) {
  await page.goto(FIXTURES);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', {}, { timeout: 60000 });
}
/** `{ key, json, run, info }` from `makeFixture(spec)` (built by the game's modules). */
export async function makeFixture(page, spec) {
  if (!(await page.evaluate(() => typeof window.makeFixture === 'function').catch(() => false))) await toFixturePage(page);
  return page.evaluate(spec => window.makeFixture(spec), spec);
}
export async function pickHazard(page, spec) {
  if (!(await page.evaluate(() => typeof window.pickHazard === 'function').catch(() => false))) await toFixturePage(page);
  return page.evaluate(spec => window.pickHazard(spec), spec);
}
export async function damageAfterArmor(page, damage, armor) {
  if (!(await page.evaluate(() => typeof window.damageAfterArmor === 'function').catch(() => false))) await toFixturePage(page);
  return page.evaluate(([d, a]) => window.damageAfterArmor(d, a), [damage, armor]);
}
/** Clears storage, then writes `{ key: json }` entries (sound muted). */
export async function writeStorage(page, entries) {
  await toFixturePage(page);
  await page.evaluate(entries => { localStorage.clear(); localStorage.setItem('tiny-tide-muted', 'true'); for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, entries);
}
/** Opens the game. `storage` (optional) replaces localStorage first; `query` adds QA parameters ("a=1&b=2"). */
export async function openGame(page, { storage, query = '' } = {}) {
  if (storage) await writeStorage(page, storage);
  await page.goto(query ? `${GAME}&${query}` : GAME);
  await page.waitForFunction(() => window.__tinyTide?.time > .3, {}, { timeout: 60000 });
}
export const state = page => page.evaluate(() => window.__tinyTide);
export const storageOf = (page, key) => page.evaluate(key => localStorage.getItem(key), key);
/** Clicks #start and waits for play. */
export async function start(page) {
  await page.locator('#start').click();
  await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
}
/** Records page errors and console errors. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
/** Waits for `n` animation frames. */
export const frames = (page, n = 2) => page.evaluate(n => new Promise(r => { const step = k => k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)); step(n); }), n);
/** Polls `predicate(state)` in the page every animation frame until it is true or `seconds` of game time pass; returns the last state. */
export async function untilGameTime(page, predicate, seconds, label) {
  const result = await page.evaluate(([src, seconds]) => new Promise(resolve => {
    const test = new Function('s', `return (${src})(s);`), t0 = window.__tinyTide.time;
    const tick = () => { const s = window.__tinyTide; if (test(s)) return resolve({ ok: true, s }); if (s.time - t0 > seconds) return resolve({ ok: false, s }); requestAnimationFrame(tick); };
    tick();
  }), [predicate.toString(), seconds]);
  if (!result.ok) throw new Error(`${label}: not within ${seconds} s of game time`);
  return result.s;
}

/** Waits until `seconds` of game time have passed. */
export async function waitGameTime(page, seconds) {
  const t0 = (await state(page)).time;
  await page.waitForFunction(([t0, s]) => window.__tinyTide.time - t0 >= s, [t0, seconds], { timeout: seconds * 4000 + 5000 });
}

const held = new WeakMap();
/** Holds exactly `wanted` keys (real keyboard events). */
export async function control(page, wanted) {
  let set = held.get(page); if (!set) { set = new Set(); held.set(page, set); }
  for (const k of [...set]) if (!wanted.includes(k)) { await page.keyboard.up(k); set.delete(k); }
  for (const k of wanted) if (!set.has(k)) { await page.keyboard.down(k); set.add(k); }
}
/** WASD keys that move toward a stage-local point (camera-relative). */
export function steer(s, target, slack = .55) {
  const dx = target.x - s.player.x, dz = target.z - s.player.z, yaw = s.world.yaw, lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz, lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz, keys = [];
  if (lx > slack) keys.push('KeyD'); if (lx < -slack) keys.push('KeyA'); if (lz > slack) keys.push('KeyS'); if (lz < -slack) keys.push('KeyW');
  return keys;
}
/** Eats one approachable food of the creature's diet with real controls (bounded). */
export async function eatOnce(page, label) {
  const before = (await state(page)).bites;
  let targetId = null, best = Infinity, since = 0;
  for (let i = 0; i < 400; i++) {
    const s = await state(page);
    if (s.bites > before) { await control(page, []); return s; }
    const edible = s.foods.filter(f => !f.eaten && f.approachable === true && (f.tag === 'any' || s.diet === 'omnivore' || (s.diet === 'herbivore') === (f.tag === 'plant')));
    const dist = f => Math.hypot(f.x - s.player.x, f.z - s.player.z) + Math.abs(f.y - s.player.y);
    let f = edible.find(x => x.id === targetId);
    if (f && dist(f) < best - .5) { best = dist(f); since = s.time; } else if (f && s.time - since > 3) f = undefined;
    if (!f) { f = edible.filter(x => x.id !== targetId).sort((a, b) => dist(a) - dist(b))[0]; targetId = f?.id ?? null; best = f ? dist(f) : Infinity; since = s.time; }
    if (!f) { await control(page, []); await page.waitForTimeout(150); continue; }
    await control(page, ['Space', ...steer(s, f)]); await page.waitForTimeout(120);
  }
  await control(page, []);
  throw new Error(`${label}: could not eat within the bound`);
}
