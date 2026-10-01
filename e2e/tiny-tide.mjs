import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let modelRequests = 0; page.on('request', r => { if (new URL(r.url()).pathname.endsWith('.glb')) modelRequests++; });
const state = () => page.evaluate(() => window.__tinyTide);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const url = process.env.VERIFY_URL || 'http://localhost:5199/tiny-tide.html?qa';
/** Braking-aware stop check: wait until the controlled velocity is zero, then the body must stay put for 200 ms. */
async function assertStops(label) {
  await page.waitForFunction(() => { const v = window.__tinyTide.velocity; return Math.hypot(v.x, v.y, v.z) < .01; }, {}, { timeout: 2000 });
  const at = (await state()).player; await page.waitForTimeout(200); const later = (await state()).player;
  assert.ok(Math.hypot(later.x - at.x, later.y - at.y, later.z - at.z) < .01, `${label}: stays put after braking`);
}
/** Click the editor viewport where the creature is. */
async function tapCreature() {
  const box = await page.locator('#editor .ed-view').boundingBox();
  const wide = await page.evaluate(() => innerWidth > 900);
  // The desktop view offset moves the creature right of center.
  await page.mouse.click(box.x + box.width * (wide ? .58 : .5), box.y + box.height * (wide ? .5 : .38));
}
async function placePart(kindLabel, partName) {
  await page.locator('#editor [data-tab=parts]').click();
  await page.locator('#editor .ed-kinds button', { hasText: kindLabel }).click();
  await page.locator('#editor .ed-card', { hasText: partName }).click();
  await tapCreature();
}
try {
  await page.goto(url); await page.waitForFunction(() => window.__tinyTide?.time > .5, {}, { timeout: 60000 });
  await shot('01-home');
  const boot = await state();
  assert.equal(boot.assets.loaded, boot.assets.expected, 'All Blender models preload before play');
  const preloadRequests = modelRequests;
  await page.getByRole('button', { name: 'How to play' }).click(); await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: /Got it/ }).click();
  await page.locator('#start').click(); await page.waitForTimeout(700); await shot('02-play');
  let s = await state(); assert.equal(s.diet, 'herbivore'); assert.ok(s.health === s.maxHealth && s.maxHealth >= 6);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await shot('03-mobile-play');
  for (const selector of ['#chomp', '#joystick', '#pause', '#growth-fill', '#edit', '#hearts']) { const b = await page.locator(selector).boundingBox(); assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 391 && b.y + b.height <= 845, `${selector} fits mobile`); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // The editor also works at phone size.
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.waitForTimeout(400); await shot('03b-mobile-editor');
  for (const selector of ['#editor .ed-done', '#editor .ed-panel', '#editor .ed-dna']) { const b = await page.locator(selector).boundingBox(); assert.ok(b && b.x >= 0 && b.x + b.width <= 391 && b.y + b.height <= 845, `${selector} fits mobile`); }
  await page.locator('#editor .ed-cancel').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(200);
  // Exercise a captured pointer drag, then release and confirm the joystick stops.
  const before = await state(); const j = await page.locator('#joystick').boundingBox();
  await page.mouse.move(j.x + j.width / 2, j.y + j.height / 2); await page.mouse.down(); await page.mouse.move(j.x + j.width - 10, j.y + j.height / 2); await page.waitForTimeout(450); await page.mouse.up();
  assert.ok((await state()).player.x > before.player.x + 1);
  await assertStops('Joystick release');
  await page.getByRole('button', { name: 'Pause game' }).click(); const paused = await state(); await page.waitForTimeout(200); assert.equal((await state()).elapsed, paused.elapsed);
  await page.getByRole('button', { name: /Keep munching/ }).click();
  await page.getByRole('button', { name: 'Mute sound' }).click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');

  // ---- Editor: place, undo, paint, body, rename, confirm ----
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.waitForTimeout(500);
  const editorStart = await state(); assert.equal(editorStart.mode, 'editing');
  const dnaBefore = Number(await page.locator('#editor .ed-dna-value').textContent());
  await placePart('Senses', 'Antenna');
  await page.waitForFunction(() => document.querySelector('#editor .ed-tool:not([hidden])'));
  assert.ok(Number(await page.locator('#editor .ed-dna-value').textContent()) < dnaBefore, 'Placing a part spends DNA');
  await page.locator('#editor .ed-undo').click();
  assert.equal(Number(await page.locator('#editor .ed-dna-value').textContent()), dnaBefore, 'Undo refunds the part');
  await placePart('Armor', 'Spike');
  await page.locator('#editor [data-tab=paint]').click();
  await page.locator('#editor .ed-swatch[data-slot=base][data-color="#9fd36b"]').click();
  await page.locator('#editor [data-pattern=stripes]').click();
  await page.locator('#editor [data-tab=body]').click();
  await page.locator('#editor .ed-add').click();
  await page.locator('#editor .ed-name').fill('Sprig');
  await shot('04-editor');
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  s = await state();
  assert.equal(s.mode, 'playing'); assert.equal(s.name, 'Sprig'); assert.equal(s.genome.paint.base, '#9fd36b'); assert.equal(s.genome.paint.pattern, 'stripes');
  assert.equal(s.genome.spine.length, editorStart.genome.spine.length + 1); assert.ok(s.genome.parts.some(p => p.id === 'spike'));
  assert.ok(s.dna < editorStart.dna, 'The design was paid for');
  assert.equal(await page.locator('#creature-name').textContent(), 'Sprig');
  await shot('05-new-design');

  if (process.argv.includes('--visual-only')) {
    await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(600); await shot('06-mobile-home');
    console.log(JSON.stringify({ errors }));
  } else {
    // Look controls change yaw and pitch with a real canvas drag.
    const lookBefore = (await state()).world;
    await page.mouse.move(900, 380); await page.mouse.down(); await page.mouse.move(970, 405, { steps: 8 }); await page.mouse.up();
    const lookAfter = (await state()).world; assert.ok(Math.abs(lookAfter.yaw - lookBefore.yaw) > .3); assert.ok(lookAfter.pitch > lookBefore.pitch);
    await page.mouse.move(970, 405); await page.mouse.down(); await page.mouse.move(900, 380, { steps: 8 }); await page.mouse.up();
    const universeId = (await state()).world.worldId;
    assert.ok((await state()).landmarks.some(f => f.kind === 'fish'), 'Larger fish coexist with the tiny creature');
    let transforms = 0;
    const held = new Set();
    async function control(wanted) {
      for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    }
    const eatenKinds = new Set(), diets = new Set(); let loops = 0, targetId = null, lastStage = -1, sawHit = false;
    while (!(await state()).completed && loops++ < 3000) {
      s = await state();
      if (s.health < s.maxHealth) sawHit = true;
      if (s.mode === 'fainted') { await control([]); await page.waitForFunction(() => window.__tinyTide.mode !== 'fainted'); continue; }
      if (s.mode === 'evolving') {
        await control([]); assert.equal(await page.locator('#modal').evaluate(d => d.open), false, 'Evolution has no dialog or loading screen');
        const physical = s.world.physicalPosition, startScale = s.world.scale;
        await page.waitForTimeout(1100); const mid = await state();
        assert.equal(modelRequests, preloadRequests, 'Transformations reuse preloaded Blender models');
        assert.ok(mid.world.scale > startScale, 'World shrinks continuously'); assert.equal(mid.world.worldId, universeId, 'Same persistent universe');
        assert.ok(Math.abs(mid.world.physicalPosition.x - physical.x) < .01 && Math.abs(mid.world.physicalPosition.z - physical.z) < .01, 'Transformation preserves physical location');
        await shot(`evolution-${s.stage}`); await page.waitForFunction(() => window.__tinyTide.mode === 'playing'); transforms++; targetId = null; continue;
      }
      if (s.mode !== 'playing') { await page.waitForTimeout(100); continue; }
      if (s.evolveReady) {
        await control([]);
        await page.locator('#evolve').click(); await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
        // Become a carnivore for stage 1, then an omnivore from stage 2 on.
        if (s.stage === 0) await placePart('Mouths', 'Snapper');
        if (s.stage === 1) await placePart('Mouths', 'Beak');
        await shot(`editor-evolve-${s.stage + 1}`);
        await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
        continue;
      }
      if (s.stage !== lastStage) { diets.add(`${s.stage}:${s.diet}`); await shot(`stage-${s.stage}`); console.log('Playing stage', s.stage, s.diet, 'dna', s.dna, 'render', s.render); lastStage = s.stage; }
      const edible = s.foods.filter(f => !f.eaten && (f.tag === 'any' || s.diet === 'omnivore' || (s.diet === 'herbivore') === (f.tag === 'plant')));
      const sorted = edible.sort((a, b) => Math.hypot(a.x - s.player.x, a.z - s.player.z) + Math.abs(a.y - s.player.y) - Math.hypot(b.x - s.player.x, b.z - s.player.z) - Math.abs(b.y - s.player.y));
      const f = sorted.find(f => f.id === targetId) || sorted[0]; targetId = f?.id;
      if (!f) { await control([]); await page.waitForTimeout(200); continue; }
      const dx = f.x - s.player.x, dz = f.z - s.player.z, distance = Math.hypot(dx, dz);
      const desired = ['Space']; if (distance > 1.05) { const yaw = s.world.yaw, lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz, lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz; if (lx > .55) desired.push('KeyD'); if (lx < -.55) desired.push('KeyA'); if (lz > .55) desired.push('KeyS'); if (lz < -.55) desired.push('KeyW'); }
      if (s.stage === 2 && f.kind === 'bird' && distance < 2.5 && s.arc === null) await page.keyboard.press('KeyE');
      if (s.stage !== 2 && s.stage > 0 && f.y - s.player.y > .8) desired.push('KeyE');
      if (s.stage > 0 && s.arc === null && s.player.y - f.y > .8) desired.push('KeyQ');
      if (s.stage === 2 && f.kind !== 'bird' && s.arc === null && f.y - s.player.y > 1.6 && distance < 3) await page.keyboard.press('KeyE');
      await control(desired); await page.waitForTimeout(130);
      const after = await state(); for (const food of s.foods) if (!after.foods.find(o => o.id === food.id) && after.stage === s.stage) eatenKinds.add(`${food.tier}:${food.kind}`);
      if (loops % 150 === 0) console.log('Progress', s.mode, s.stage, s.stageDna, '/', s.goal, 'player', s.player, 'target', f.kind, [f.x, f.y, f.z]);
    }
    await control([]); const done = await state();
    assert.equal(done.completed, true); assert.equal(done.eatenPlanets.length, 12); assert.equal(transforms, 4); assert.equal(done.world.worldId, universeId);
    assert.deepEqual([...diets], ['0:herbivore', '1:carnivore', '2:omnivore', '3:omnivore', '4:omnivore']);
    assert.ok(['0:plant', '0:kelp_snack', '0:seagrape', '0:lettuce'].some(k => eatenKinds.has(k)), 'Herbivore ate plants');
    assert.ok(['1:shrimp', '1:crab', '1:snail', '1:jellyfish'].some(k => eatenKinds.has(k)), 'Carnivore ate meat');
    console.log('Hits taken during the journey:', sawHit, 'kinds', [...eatenKinds].join(' '));
    await page.getByRole('dialog', { name: /All full/ }).waitFor(); await shot('07-victory');
    await page.locator('#play-again').click();
    s = await state(); assert.equal(s.stage, 0); assert.equal(s.bites, 0); assert.equal(s.name, 'Little Tide'); assert.notEqual(s.world.seed, done.world.seed, 'A new adventure has a new world');
    assert.ok(s.foods.every(f => Math.abs(f.x) < 60 && Math.abs(f.z) < 60), 'Food coordinates reset to the tiny scale');
    // Eat one thing, then reload and resume.
    for (let i = 0; i < 120 && (await state()).bites === 0; i++) {
      const t = await state(), f = t.foods.filter(f => f.tag === 'plant').sort((a, b) => Math.hypot(a.x - t.player.x, a.z - t.player.z) - Math.hypot(b.x - t.player.x, b.z - t.player.z))[0];
      const dx = f.x - t.player.x, dz = f.z - t.player.z, yaw = t.world.yaw, lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz, lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz, keys = ['Space'];
      if (lx > .55) keys.push('KeyD'); if (lx < -.55) keys.push('KeyA'); if (lz > .55) keys.push('KeyS'); if (lz < -.55) keys.push('KeyW');
      await control(keys); await page.waitForTimeout(130);
    }
    await control([]);
    const progress = await state(); assert.ok(progress.bites > 0); await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await page.locator('#start').click();
    const resumed = await state(); assert.equal(resumed.bites, progress.bites); assert.equal(resumed.world.seed, progress.world.seed, 'Resume keeps the same world');
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Pause game' }).click(); await shot('08-mobile-pause');
    await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(600); await shot('06-mobile-home');
    assert.deepEqual(errors, []); writeFileSync(`${out}/results.json`, JSON.stringify({ passed: true, eatenKinds: [...eatenKinds], final: done, errors }, null, 2));
    console.log('PASSED: editor (place, undo, paint, body, name), diet changes, DNA evolution through five sizes, in-place transformations, persistent world, look camera, breach, victory, new seeded world, save/resume, pause, sound, joystick, mobile layout.');
  }
} finally { await browser.close(); }
