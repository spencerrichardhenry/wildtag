import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = '.codex-drafts/siege-3d-qa';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage(), cdp = await context.newCDPSession(page);
const errors = [], results = [];
let resultDismissed = false;
page.on('pageerror', error => errors.push(error.message));
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5202/royal-yeet.html';
const state = () => page.evaluate(() => window.__siege);
const shot = name => page.screenshot({ path: `${output}/${name}.png` });
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 7, radiusY: 7, force: 1 })) });
async function load(query = '?seed=42') {
  resultDismissed = false;
  await page.goto(base + query); await page.waitForFunction(() => window.__siege?.time > .2);
}
async function ready() {
  await page.waitForFunction(() => window.__siege.ready || document.querySelector('#result-modal.open'));
  if ((await state()).won && !resultDismissed) {
    await page.locator('#result-modal.open').waitFor();
    await page.getByRole('button', { name: 'Close result' }).click();
    resultDismissed = true;
  }
  await page.waitForFunction(() => window.__siege.ready && !document.querySelector('.modal-backdrop.open'));
}
async function pullAndRelease(x = 0, y = .8, screenshot) {
  await ready();
  const s = await state(), { x: cx, y: cy, radius } = s.sling;
  const count = s.shots;
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx + x * radius * i / 8, cy + y * radius * i / 8]]);
  assert.equal((await state()).dragging, true);
  if (screenshot) await shot(screenshot);
  await touch('touchEnd', []);
  await page.waitForFunction(n => window.__siege.shots === n, count + 1);
  return s.current;
}
try {
  await load();
  assert.equal((await state()).camera.type, 'PerspectiveCamera');
  assert.equal(await page.locator('#angle, #fire, [data-ammo]').count(), 0);
  assert.equal((await state()).current, 'cow'); assert.equal((await state()).next, 'rocket');
  assert.equal((await state()).shotsLeft, null);
  assert.equal(await page.getByRole('slider', { name: 'Launch power' }).count(), 1);
  assert.equal((await state()).buildings.length, 10);
  const slider = await page.locator('#power').boundingBox();
  await page.touchscreen.tap(slider.x + slider.width * .3, slider.y + slider.height / 2);
  assert.ok((await state()).power > 25 && (await state()).power < 75);
  await page.locator('#power').focus(); await page.keyboard.press('End');
  assert.equal((await state()).power, 100);
  await shot('01-phone-ready');
  await page.getByRole('button', { name: 'How to play' }).tap();
  await page.getByRole('dialog', { name: 'GRAB. STRETCH. YEET.' }).waitFor();
  await page.getByRole('button', { name: 'Close instructions' }).tap();
  const initial = await state();
  // A background swipe, a tap, cancellation, or returning the pouch uses no ammo.
  await touch('touchStart', [[35, 210]]); await touch('touchMove', [[35, 310]]); await touch('touchEnd', []);
  const { x, y } = initial.sling;
  await touch('touchStart', [[x, y]]); await touch('touchEnd', []);
  await touch('touchStart', [[x, y]]); await touch('touchMove', [[x + 20, y + 90]]); await touch('touchCancel', []);
  assert.equal((await state()).dragging, false);
  await touch('touchStart', [[x, y]]); await touch('touchMove', [[x, y + 90]]); await touch('touchMove', [[x, y]]); await touch('touchEnd', []);
  assert.equal((await state()).shots, 0); assert.equal((await state()).current, 'cow');
  results.push('Touch starts only at pouch; taps, cancelled and returned pulls preserve ammo');
  // A second finger cannot steal the first finger's draw or fire a second shot.
  await touch('touchStart', [[x, y]]);
  await touch('touchStart', [[x, y], [x + 100, y + 10, 2]]);
  await touch('touchMove', [[x - 10, y + 42], [x + 110, y + 20, 2]]);
  await shot('02-stretched-sling');
  await touch('touchEnd', [[x + 110, y + 20, 2]]);
  assert.equal((await state()).shots, 0);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__siege.shots === 1);
  assert.equal((await state()).current, 'rocket'); assert.equal((await state()).next, 'bomb');
  await page.waitForFunction(() => window.__siege.damage > 0);
  await shot('03-cow-impact');
  const firstPosition = (await state()).projectiles.find(s => s.kind === 'cow')?.position;
  if (firstPosition) { assert.ok(firstPosition.x > 0); assert.ok(firstPosition.z < 5); }
  assert.ok((await state()).camera.position[2] < 37);
  results.push('Real touch drag aims in 3D, advances queue once, and follows impact');
  assert.equal(await pullAndRelease(.1, .45), 'rocket');
  await page.waitForFunction(() => window.__siege.projectiles.some(s => s.kind === 'rocket' && s.special));
  assert.equal(await pullAndRelease(-.4, .4), 'bomb');
  await page.getByRole('button', { name: /Tap to detonate/ }).tap();
  await page.waitForFunction(() => !window.__siege.projectiles.some(s => s.kind === 'bomb'));
  assert.equal(await pullAndRelease(0, .4), 'catapult');
  await page.waitForFunction(() => window.__siege.projectiles.some(s => s.kind === 'watermelon'));
  await shot('04-watermelon');
  assert.equal((await state()).current, 'bowling');
  assert.equal(await pullAndRelease(.35, .14), 'bowling');
  await ready(); assert.equal((await state()).current, 'cow');
  results.push('All five queued weapons, bomb action, automatic rocket and watermelon, queue wrap');
  // Aim at distinct visible structure positions with actual drag input and the power slider.
  for (let i = 0; i < 80 && !(await state()).won; i++) {
    const current = await state();
    const buildings = current.buildings.filter(b => b.damage < 90);
    const b = buildings[i % buildings.length];
    const tx = b.x + (i % 2 ? -1 : 1) * b.width * .2;
    const tz = b.z + b.depth * .25, ty = Math.max(.6, b.height * (i % 3 === 0 ? .65 : .25));
    const dx = tx, dz = tz - 22, range = Math.hypot(dx, dz), dy = ty - 3.6;
    const v = 36, discriminant = v ** 4 - 12 * (12 * range ** 2 + 2 * dy * v ** 2);
    if (discriminant < 0) continue;
    const elevation = Math.atan((v ** 2 - Math.sqrt(discriminant)) / (12 * range));
    let px = -Math.atan2(dx, -dz) / .68, py = (elevation - .05) / .8;
    if (Math.hypot(px, py) < .13) py = .13;
    await pullAndRelease(px, py); await ready();
  }
  assert.ok((await state()).score > 0);
  assert.ok((await state()).buildings.some(b => b.awarded));
  assert.equal((await state()).won, true, `Demo should be winnable: ${JSON.stringify(await state())}`);
  await shot('05-demolished');
  results.push('Demo win through real queued touch launches');
  await load('?seed=42&shots=2');
  assert.equal((await state()).shotsLeft, 2);
  await pullAndRelease(1, .25); await ready();
  assert.equal((await state()).shotsLeft, 1); assert.equal((await state()).next, null);
  await pullAndRelease(1, .25);
  await page.getByRole('dialog', { name: 'OUT OF SHOTS.' }).waitFor();
  await shot('06-out-of-shots');
  assert.equal((await state()).shots, 2); assert.equal((await state()).ready, false);
  await page.getByRole('button', { name: /TRY THIS CASTLE AGAIN/ }).tap();
  assert.equal((await state()).seed, 42); assert.equal((await state()).shotsLeft, 2); assert.equal((await state()).current, 'cow');
  results.push('Optional shot budget ends the round and retry restores the original queue');
  await load();
  for (const viewport of [{width:360,height:640},{width:844,height:390},{width:1440,height:900}]) {
    await page.setViewportSize(viewport); await page.waitForFunction(() => window.__siege.ready);
    await shot(`07-${viewport.width}x${viewport.height}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const target = await page.locator('#sling-grab').boundingBox();
    assert.ok(target && target.x > 0 && target.y > 0 && target.x + target.width < viewport.width && target.y + target.height < viewport.height);
  }
  await page.locator('#sling-grab').focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__siege.dragging);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__siege.shots === 1);
  results.push('Small phone, landscape, desktop, and keyboard alternative');
  const g = (await state()).render.geometries;
  for (let i=0;i<5;i++) await page.getByRole('button',{name:'New fortress',exact:true}).click();
  assert.ok((await state()).render.geometries <= g + 1);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ passed:true, results, errors }, null, 2));
  console.log(JSON.stringify({passed:true,results,errors}));
} catch (error) { await shot('failure'); console.log(JSON.stringify(await state())); throw error; } finally { await browser.close(); }
