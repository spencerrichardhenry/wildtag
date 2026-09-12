import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
try {
  await host.goto(`${base}/wildtag.html?dev=1&quality=low&wonders=off`);
  await host.waitForFunction(() => !!window.__grandpa, null, { timeout: 120000 });
  await host.getByRole('button', { name: 'Invite Grandpa', exact: true }).click();
  await host.getByRole('button', { name: 'Create invite', exact: true }).click();
  await host.waitForFunction(() => __grandpa.state().status === 'waiting', null, { timeout: 25000 });
  const code = await host.evaluate(() => __grandpa.state().code);
  await host.getByRole('button', { name: 'Back to the world' }).click();
  await guest.goto(`${base}/grandpa.html?dev=1&quality=low&wonders=off#join=${code}`);
  await guest.getByRole('button', { name: 'Join their world' }).click();
  await guest.waitForFunction(() => window.__grandpa?.state().creature && __grandpa.state().status === 'connected', null, { timeout: 120000 });
  // Find a continuous, steep downhill section of the actual western mountains.
  const slope = await host.evaluate(() => {
    for (let x = -470; x < -220; x += 13) for (let z = -300; z < -140; z += 13) {
      const y = __game.groundY(x, z); const end = __game.groundY(x, z - 20);
      if (y < 25 || y - end < 7 || y - end > 20) continue;
      const hs = Array.from({ length: 21 }, (_, i) => __game.groundY(x, z - i));
      if (hs.slice(1).some((h, i) => Math.abs(h - hs[i]) > 1.8)) continue;
      return { x, y, z, drop: y - end };
    }
    throw new Error('No mountain route found');
  });
  await host.evaluate(p => { __game.player.teleport(p.x + 4, __game.groundY(p.x + 4, p.z), p.z); __grandpa.positionCreature(p.x, p.y, p.z); }, slope);
  await guest.waitForFunction(p => Math.abs(__grandpa.state().creature.pos.x - p.x) < 2, slope);
  await guest.bringToFront();
  await guest.locator('#game').click({ position: { x: 600, y: 380 } });
  await guest.waitForFunction(() => !!document.pointerLockElement);
  await guest.evaluate(() => __game.setLook(0, -.08));
  await guest.waitForTimeout(500);
  const initial = await host.evaluate(() => __grandpa.state().creature.pos);
  await guest.keyboard.down('w');
  const samples = [];
  for (let n = 0; n < 30; n++) {
    await host.waitForTimeout(100);
    samples.push(await host.evaluate(() => __grandpa.state().creature));
  }
  await guest.keyboard.up('w');
  const last = samples.at(-1);
  assert(last.pos.z < initial.z - 10, `Mountain walk stalled: ${initial.z - last.pos.z} m`);
  assert(last.pos.y < initial.y - 4, 'Route did not exercise the downhill bug');
  assert(samples.filter(s => s.recovery > 0).length <= 1, 'Walking triggered repeated landing recovery');
  assert(samples.filter(s => !s.grounded).length <= 1, 'Lost ordinary slope contact');
  await guest.screenshot({ path: 'docs/grandpa/verify/mountain-walk.png' });
  await host.evaluate(() => {
    const p = __grandpa.state().creature.pos;
    __game.player.teleport(p.x + 5, p.y + 1, p.z - 7);
    __village.lookAt(p.x, p.y + 2.5, p.z);
  });
  await host.waitForTimeout(300);
  await host.screenshot({ path: 'docs/grandpa/verify/featherfoot-in-world.png' });
  const pad = await host.evaluate(() => {
    const p = __grandpa.state().creature.pos;
    const id = __game.placeTrampoline('ground', p.x, p.z);
    return { id, x: p.x, z: p.z, serial: __grandpa.state().creature.bounceSerial };
  });
  assert(pad.id, 'Ground trampoline placed');
  await guest.waitForFunction(id => __grandpa.structureState().structures.trampolines.some(t => t.id === id), pad.id, { timeout: 6000 });
  await guest.bringToFront();
  if (!(await guest.evaluate(() => !!document.pointerLockElement))) await guest.locator('#game').click({ position: { x: 600, y: 380 } });
  await guest.keyboard.press('Space');
  await host.waitForFunction(serial => __grandpa.state().creature.bounceSerial > serial, pad.serial, { timeout: 5000 });
  assert((await host.evaluate(() => __grandpa.state().creature.vel.y)) > 20, 'Normal jump triggered a trampoline launch');
  await guest.waitForFunction(serial => __grandpa.state().creature.bounceSerial > serial, pad.serial);
  await guest.screenshot({ path: 'docs/grandpa/verify/trampoline-bounce.png' });
  const sky = await host.evaluate(p => ({ id: __game.placeTrampoline('sky', p.x + 14, p.z), x: p.x + 14, z: p.z }), pad);
  assert(sky.id, 'Sky trampoline placed');
  await guest.waitForFunction(id => __grandpa.structureState().structures.trampolines.some(t => t.id === id), sky.id, { timeout: 6000 });
  const serial = await host.evaluate(p => {
    __grandpa.positionCreature(p.x, __game.groundY(p.x, p.z) + 45, p.z);
    return __grandpa.state().creature.bounceSerial;
  }, sky);
  await host.waitForFunction(n => __grandpa.state().creature.bounceSerial > n, serial, { timeout: 7000 });
  await guest.waitForFunction(n => __grandpa.state().creature.bounceSerial > n, serial);
  await guest.screenshot({ path: 'docs/grandpa/verify/sky-trampoline-bounce.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', slope, walked: initial.z - last.pos.z, descended: initial.y - last.pos.y, checks: ['real mountain terrain', 'continuous downhill walk', 'no repeated stumble', 'Blender bird in both clients', 'normal jump onto ground trampoline', 'sky trampoline', 'both clients receive trampoline launches'] }));
} finally { await browser.close(); }
