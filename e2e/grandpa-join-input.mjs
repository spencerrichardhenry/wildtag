import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199';
const repro = process.env.REPRO === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const host = await browser.newPage();
const guest = await browser.newPage();
const errors = [];
for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
const position = () => host.evaluate(() => __grandpa.state().creature.pos);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function walk() {
  const before = await position();
  // Real repeated keydowns match holding W across an unlocked→locked transition.
  for (let i = 0; i < 10; i++) { await guest.keyboard.down('w'); await guest.waitForTimeout(100); }
  await guest.keyboard.up('w');
  return distance(before, await position());
}
try {
  await host.goto(`${base}/wildtag.html?dev=1&quality=low&wonders=off`);
  await host.waitForFunction(() => !!window.__grandpa, null, { timeout: 120000 });
  await host.getByRole('button', { name: 'Invite Grandpa', exact: true }).click();
  await host.getByRole('button', { name: 'Create invite', exact: true }).click();
  await host.waitForFunction(() => __grandpa.state().status === 'waiting');
  const code = await host.evaluate(() => __grandpa.state().code);
  // Leave the invite card open, as a child sharing the code naturally would.
  await guest.goto(`${base}/grandpa.html?dev=1&quality=low&wonders=off`);
  await guest.getByRole('textbox', { name: 'Invite code' }).fill(code);
  await guest.getByRole('button', { name: 'Join their world', exact: true }).click();
  await guest.waitForFunction(() => !!window.__grandpa?.state().creature, null, { timeout: 120000 });
  await guest.bringToFront();
  await guest.locator('#game').click({ position: { x: 600, y: 380 } });
  await guest.waitForFunction(() => !!document.pointerLockElement);
  const inviteOpenWalk = await walk();
  console.log(JSON.stringify({ scenario: 'first click while child shares invite', meters: inviteOpenWalk, hud: await guest.locator('.gp-tracking').innerText() }));

  await host.getByRole('button', { name: 'Back to the world', exact: true }).click();
  await guest.bringToFront();
  await guest.evaluate(() => document.exitPointerLock());
  await guest.waitForFunction(() => !document.pointerLockElement);
  await guest.keyboard.down('w');
  await guest.locator('#game').click({ position: { x: 600, y: 380 } });
  await guest.waitForFunction(() => !!document.pointerLockElement);
  const heldAcrossClick = await walk();
  const freshPress = await walk();
  console.log(JSON.stringify({ scenario: 'W held during first world click', heldAcrossClick, freshPress }));

  await guest.keyboard.press('Escape');
  await guest.getByRole('button', { name: 'Back to the visit', exact: true }).waitFor();
  await guest.keyboard.down('w');
  await guest.getByRole('button', { name: 'Back to the visit', exact: true }).click();
  await guest.waitForFunction(() => !!document.pointerLockElement);
  const heldAcrossResume = await walk();
  console.log(JSON.stringify({ scenario: 'W held during menu resume', heldAcrossResume }));
  await guest.keyboard.press('Escape');
  await guest.getByRole('button', { name: 'Back to the visit', exact: true }).waitFor();
  await guest.waitForTimeout(250);
  const menuWalk = await walk();
  await guest.keyboard.press('Space');
  const jumpId = await host.evaluate(() => __grandpa.state().creature.jumpId);
  await guest.getByRole('button', { name: 'Back to the visit', exact: true }).click();
  await guest.waitForTimeout(300);
  const resumedJumpId = await host.evaluate(() => __grandpa.state().creature.jumpId);
  console.log(JSON.stringify({ scenario: 'menu input stays inactive', menuWalk, jumpId, resumedJumpId }));
  if (!repro) {
    assert(inviteOpenWalk > 2, 'The child sharing the invite must not block Grandpa movement');
    assert(heldAcrossClick > 2, 'Movement held during the first click must work without Escape/repress');
    assert(freshPress > 2, 'A normal movement press must still work');
    assert(heldAcrossResume > 2, 'Resume must accept held movement');
    assert(menuWalk < .3, 'W must not move Grandpa while his menu is open');
    assert.equal(resumedJumpId, jumpId, 'Space in a menu must not jump after resume');
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ result: repro ? 'reproduction recorded' : 'passed', errors }));
} finally { await browser.close(); }
