import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = '.codex-drafts/siege-balance';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage(), cdp = await context.newCDPSession(page);
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => window.__siege);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1, radiusX: 7, radiusY: 7, force: 1 })) });
async function fireAt(building, height = 1.3, afterLaunch) {
  await page.waitForFunction(() => window.__siege.ready);
  const s = await state(), dx = building.x, dz = building.z + building.depth / 2 - 22;
  const range = Math.hypot(dx, dz), dy = height - 3.6, v = 36;
  const elevation = Math.atan((v * v - Math.sqrt(v ** 4 - 12 * (12 * range * range + 2 * dy * v * v))) / (12 * range));
  const px = -Math.atan2(dx, -dz) / .68, py = (elevation - .05) / .8;
  const { x, y, radius } = s.sling;
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[x + px * radius * i / 8, y + py * radius * i / 8]]);
  assert.equal((await state()).dragging, true);
  await touch('touchEnd', []);
  if (afterLaunch) await afterLaunch();
  await page.waitForFunction(n => window.__siege.shots === n && window.__siege.ready, s.shots + 1);
  await page.waitForFunction(t => window.__siege.time > t + 6, s.time);
  return { before: s, after: await state() };
}
try {
  await page.goto((process.env.VERIFY_URL || 'http://127.0.0.1:5202/royal-yeet.html') + '?seed=42');
  await page.waitForFunction(() => window.__siege?.ready);
  await page.locator('#power').focus(); await page.keyboard.press('End');
  await page.screenshot({ path: `${output}/01-ready.png` });
  const buildings = (await state()).buildings;
  const nearHouse = buildings.find(b => b.kind === 'cottage' || b.kind === 'market');
  const cow = await fireAt(nearHouse);
  assert.equal(cow.before.current, 'cow');
  const changed = cow.after.buildings.filter(b => b.damage > 0);
  assert.ok(changed.some(b => b.id === nearHouse.id), 'Cow should damage the house it hits');
  assert.ok(changed.length <= 2, 'One cow must not demolish a row of buildings');
  assert.ok(cow.after.damage > 0 && cow.after.damage < 12);
  results.push({ projectile: 'cow', damage: cow.after.damage, buildings: changed.map(b => ({ name: b.name, damage: b.damage })) });
  await page.screenshot({ path: `${output}/02-cow-local-impact.png` });
  const rocket = await fireAt(buildings.find(b => b.kind === 'greenhouse'));
  assert.equal(rocket.before.current, 'rocket');
  assert.ok(rocket.after.damage - rocket.before.damage < 15);
  results.push({ projectile: 'rocket', addedDamage: rocket.after.damage - rocket.before.damage });
  const bomb = await fireAt(buildings.find(b => b.kind === 'barn'));
  assert.equal(bomb.before.current, 'bomb');
  assert.ok(bomb.after.damage > bomb.before.damage, 'A bomb at a timber barn should still be useful');
  assert.ok(bomb.after.damage - bomb.before.damage < 15, 'Bomb damage should stay local');
  const untouched = bomb.after.buildings.filter(b => b.damage === 0);
  assert.ok(untouched.length >= 5, 'Most of the village should remain intact after three shots');
  results.push({ projectile: 'bomb', addedDamage: bomb.after.damage - bomb.before.damage, untouched: untouched.map(b => b.name) });
  await page.screenshot({ path: `${output}/03-after-three-shots.png` });
  const catapult = await fireAt(buildings.find(b => b.kind === 'keep'), 4, async () => {
    await page.waitForFunction(() => window.__siege.projectiles.some(p => p.kind === 'watermelon'));
    await page.screenshot({ path: `${output}/04-watermelon-in-flight.png` });
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'FRESHLY SQUEEZED!');
    await page.screenshot({ path: `${output}/05-watermelon-explosion.png` });
  });
  assert.equal(catapult.before.current, 'catapult');
  assert.equal(catapult.after.current, 'bowling');
  assert.equal(catapult.after.shots, catapult.before.shots + 1);
  assert.ok(catapult.after.damage > catapult.before.damage, 'The fired watermelon must cause real blast damage');
  results.push({ projectile: 'catapult and explosive watermelon', addedDamage: catapult.after.damage - catapult.before.damage });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/browser-results.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, errors }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.log(JSON.stringify(await state())); throw error;
} finally { await browser.close(); }
