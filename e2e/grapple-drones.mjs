import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199';
const repro = process.env.REPRO === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${base}/wildtag.html?dev=1&quality=low&wonders=off`);
  await page.waitForFunction(() => !!window.__sky, null, { timeout: 120000 });
  await page.locator('#game').click({ position: { x: 600, y: 380 } });
  await page.waitForFunction(() => !!document.pointerLockElement);
  const drone = await page.evaluate(() => {
    const x = 100, z = 150, y = __game.groundY(x, z);
    __game.unlockAll();
    return { x, y, z, id: __game.placeDrone(x, z) };
  });
  assert(drone.id, 'Placed a real hovering drone');
  const shots = [];
  for (const shot of [
    { name: 'down inside overhead column', height: 1, zOffset: 0, pitch: -1.4 },
    { name: 'forward with drone behind', height: 24, zOffset: -12, pitch: 0 },
    { name: 'long forward arc under drone', height: 4, zOffset: 0, pitch: .5 },
    { name: 'aimed upward at drone', height: 0, zOffset: 0, pitch: 1.4, hit: true },
  ]) {
    await page.evaluate(({ d, s }) => { __game.player.teleport(d.x, d.y + s.height, d.z + s.zOffset); __game.setLook(0, s.pitch); }, { d: drone, s: shot });
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(85);
    await page.mouse.up({ button: 'right' });
    const samples = [];
    for (let i = 0; i < 130; i++) { samples.push(await page.evaluate(() => __sky.hook())); await page.waitForTimeout(16); }
    const attached = samples.find(s => s?.anchorDrone === `${drone.id}-anchor`);
    const result = { name: shot.name, droneHit: !!attached, time: attached?.flightTime, hookPosition: attached?.pos, maxFlightTime: Math.max(0, ...samples.map(s => s?.flightTime ?? 0)) };
    shots.push(result); console.log(JSON.stringify(result));
    if (!repro) {
      assert(result.maxFlightTime > 0, `A real hook fired: ${shot.name}`);
      assert.equal(!!attached, !!shot.hit, shot.name);
      if (shot.name === 'long forward arc under drone') assert(result.maxFlightTime > 1.9, 'The missed arc reaches the end of its flight');
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: repro ? 'reproduction recorded' : 'passed', shots }));
} finally { await browser.close(); }
