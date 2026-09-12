import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199';
await mkdir('docs/grandpa/verify', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
for (const [name, page] of [['host', host], ['guest', guest]]) page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
const state = p => p.evaluate(() => __grandpa.state());
const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
async function lock(page) {
  await page.bringToFront();
  if (!(await page.evaluate(() => !!document.pointerLockElement))) await page.locator('#game').click({ position: { x: 600, y: 380 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game');
}
try {
  await host.goto(`${base}/wildtag.html?dev=1&quality=low&wonders=off`);
  await host.waitForFunction(() => !!window.__grandpa, null, { timeout: 120000 });
  await host.getByRole('button', { name: 'Invite Grandpa', exact: true }).click();
  await host.getByRole('button', { name: 'Create invite', exact: true }).click();
  await host.waitForFunction(() => __grandpa.state().status === 'waiting', null, { timeout: 25000 });
  const code = (await state(host)).code;
  await host.screenshot({ path: 'docs/grandpa/verify/invite.png' });
  await host.getByRole('button', { name: 'Back to the world' }).click();

  await guest.addInitScript(() => localStorage.setItem('wildtag-save-v1', 'grandpas-existing-save'));
  await guest.goto(`${base}/grandpa.html?dev=1&quality=low&wonders=off#join=${code}`);
  await guest.getByRole('button', { name: 'Join their world' }).waitFor();
  assert.equal(await guest.getByRole('textbox', { name: 'Invite code' }).inputValue(), code);
  await guest.screenshot({ path: 'docs/grandpa/verify/join.png' });
  await guest.getByRole('button', { name: 'Join their world' }).click();
  await guest.waitForFunction(() => window.__grandpa?.state().creature !== null && window.__grandpa?.state().status === 'connected', null, { timeout: 120000 });
  assert.equal((await state(guest)).role, 'grandpa');
  const hostWorld = await host.evaluate(() => __grandpa.structureState());
  const guestWorld = await guest.evaluate(() => __grandpa.structureState());
  assert.deepEqual(guestWorld, hostWorld);
  assert.equal(await guest.evaluate(() => localStorage.getItem('wildtag-save-v1')), 'grandpas-existing-save', 'guest must not write host data into its own save');

  await lock(guest);
  const y0 = (await state(host)).creature.pos.y;
  await guest.keyboard.press('Space');
  await host.waitForFunction(y => __grandpa.state().creature.pos.y > y + .7, y0);
  assert.equal((await state(host)).creature.charge, 0);
  await host.waitForFunction(() => __grandpa.state().creature.grounded);
  assert.equal((await state(host)).creature.recovery, 0);
  await hold(guest, 'e', 900);
  await host.waitForFunction(y => __grandpa.state().creature.pos.y > y + 4, y0, { timeout: 6000 });
  assert.equal((await state(host)).creature.stunt, 'vault');
  await host.waitForFunction(() => __grandpa.state().creature.grounded && __grandpa.state().creature.recovery === 0, null, { timeout: 8000 });
  await guest.keyboard.press('Shift');
  await guest.keyboard.down('w');
  await host.waitForFunction(() => __grandpa.state().creature.sprintRemaining > 0, null, { timeout: 4000 });
  await host.waitForFunction(() => { const s = __grandpa.state().creature; return Math.hypot(s.vel.x, s.vel.z) > 20; });
  await guest.screenshot({ path: 'docs/grandpa/verify/speed-burst.png' });
  await guest.waitForTimeout(700); await guest.keyboard.up('w');
  await host.waitForFunction(() => __grandpa.state().creature.sprintRemaining === 0, null, { timeout: 7500 });
  assert((await state(host)).creature.sprintCooldown > 22);
  await host.waitForFunction(() => __grandpa.state().creature.grounded && __grandpa.state().creature.recovery === 0);
  await hold(guest, 'q', 150);
  await host.waitForFunction(() => __grandpa.state().creature.sneezeWindup > 0);
  await host.waitForFunction(() => __grandpa.state().creature.updraft !== null, null, { timeout: 5000 });
  const windY = await host.evaluate(() => { const p = __grandpa.state().creature.updraft.pos; __game.player.teleport(p.x, p.y + .3, p.z); return p.y; });
  await host.waitForFunction(y => __game.player.pos().y > y + 3, windY, { timeout: 3000 });
  await guest.screenshot({ path: 'docs/grandpa/verify/sneeze.png' });
  await host.waitForFunction(() => __grandpa.state().creature.grounded && __grandpa.state().creature.recovery === 0, null, { timeout: 8000 });

  // Fixture move only: use a real thrown dart and real tracking to earn the statue.
  await host.evaluate(() => {
    const p = __grandpa.state().creature.pos;
    __game.player.teleport(p.x, p.y + 1, p.z + 8);
  });
  await lock(host); await host.waitForTimeout(500);
  await host.evaluate(() => __grandpa.aim());
  await host.waitForTimeout(150); await host.mouse.down(); await host.mouse.up();
  await host.waitForFunction(() => __grandpa.state().chase.phase === 'tracking', null, { timeout: 5000 });
  await host.screenshot({ path: 'docs/grandpa/verify/tracking.png' });
  await host.waitForTimeout(1300);
  const partial = (await state(host)).chase.progress;
  assert(partial > 0);
  await host.evaluate(() => { const p = __game.player.pos(); __game.player.teleport(p.x + 80, p.y, p.z); });
  await host.waitForTimeout(1300);
  assert(Math.abs((await state(host)).chase.progress - partial) < .08, 'escape holds tracking progress');
  await host.evaluate(() => { const p = __grandpa.state().creature.pos; __game.player.teleport(p.x, p.y + 1, p.z + 8); });
  await host.waitForFunction(() => __grandpa.state().reward.caught, null, { timeout: 30000 });
  await guest.waitForFunction(() => __grandpa.state().chase.phase === 'caught', null, { timeout: 2500 });
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: 'Grandpa visit', exact: true }).click();
  await host.getByRole('button', { name: 'Place Grandpa statue' }).click();
  await host.evaluate(() => __game.setLook(0, -.7));
  await host.waitForTimeout(300); await host.mouse.down(); await host.mouse.up();
  await host.waitForFunction(() => __grandpa.state().reward.statue !== null);
  await host.screenshot({ path: 'docs/grandpa/verify/statue.png' });
  const reward = (await state(host)).reward;
  await host.evaluate(() => __game.save());
  const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('wildtag-save-v1')));
  assert.deepEqual(saved.grandpa, JSON.parse(JSON.stringify(reward)));
  await guest.waitForFunction(() => __grandpa.state().reward.statue !== null, null, { timeout: 6000 });
  assert.deepEqual((await state(guest)).reward, JSON.parse(JSON.stringify(reward)));
  assert.equal(await guest.evaluate(() => localStorage.getItem('wildtag-save-v1')), 'grandpas-existing-save');
  await host.goto(`${base}/wildtag.html?quality=low`);
  await host.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await host.getByRole('button', { name: 'Invite Grandpa', exact: true }).click();
  await host.getByRole('button', { name: 'Move Grandpa statue' }).waitFor();
  const reloaded = await host.evaluate(() => JSON.parse(localStorage.getItem('wildtag-save-v1')).grandpa);
  assert.deepEqual(reloaded, JSON.parse(JSON.stringify(reward)));
  await host.screenshot({ path: 'docs/grandpa/verify/reloaded-reward.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', checks: ['invite UI', 'dedicated Grandpa URL', 'shared world', 'quick-tap normal jump', 'faster E vault', 'six-second speed burst', 'sneeze', 'child rides updraft', 'real dart tag', 'tracking holds on escape', 'first-catch reward', 'place statue', 'save and reload statue', 'guest save isolation'] }));
} catch (err) {
  console.error('page errors', errors);
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    console.error(name, await page.evaluate(() => window.__grandpa?.state() ?? document.body.innerText).catch(() => 'closed'));
    await page.screenshot({ path: `docs/grandpa/verify/${name}-failure.png` }).catch(() => {});
  }
  throw err;
} finally { await browser.close(); }
