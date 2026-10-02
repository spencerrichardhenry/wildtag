import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { GAME, makeFixture, toFixturePage } from './fixtures/tiny-tide-fixtures.mjs';
/** The evolution line of the journey: TIDE_LINE=crawler, else the swimmer line. */
const LINE = process.env.TIDE_LINE === 'crawler' ? ['crawler', 'shellback', 'colossus', 'star_crawler'] : ['swimmer', 'darter', 'sky_drifter', 'star_swimmer'];
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let modelRequests = 0; page.on('request', r => { if (new URL(r.url()).pathname.endsWith('.glb')) modelRequests++; });
const state = () => page.evaluate(() => window.__tinyTide);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const url = process.env.VERIFY_URL || GAME;
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
  // The journey starts from a fixture save built by the game's own modules (seed 1501, stage 0).
  const fixture = await makeFixture(page, { seed: 1501, stage: 0 });
  await toFixturePage(page); await page.evaluate(([key, json]) => { localStorage.clear(); localStorage.setItem(key, json); }, [fixture.key, fixture.json]);
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
    const eatenKinds = new Set(), diets = new Set(), skipped = new Map(); let loops = 0, targetId = null, lastStage = -1, sawHit = false, approach = { best: Infinity, since: 0 };
    while (!(await state()).completed && loops++ < 8000) {
      s = await state();
      if (s.health < s.maxHealth) sawHit = true;
      if (s.mode === 'fainted') { await control([]); await page.waitForFunction(() => window.__tinyTide.mode !== 'fainted'); continue; }
      if (s.mode === 'evolving') {
        await control([]); assert.equal(await page.locator('#modal').evaluate(d => d.open), false, 'Evolution has no dialog or loading screen');
        const startScale = s.world.scale;
        await page.waitForTimeout(1100); const mid = await state();
        assert.equal(modelRequests, preloadRequests, 'Transformations reuse preloaded Blender models');
        assert.ok(mid.world.scale > startScale, 'World shrinks continuously'); assert.equal(mid.world.worldId, universeId, 'Same persistent universe');
        await shot(`evolution-${s.stage}`); await page.waitForFunction(() => window.__tinyTide.mode !== 'evolving', {}, { timeout: 20000 });
        // The body may move to a legal destination (X/Z can change); after the transformation it must be admitted.
        await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 20000 });
        const done = await state(); assert.equal(done.legal, true, `the zone is legal after transformation ${transforms + 1} (${done.zone})`);
        transforms++; targetId = null; continue;
      }
      if (s.mode !== 'playing') { await page.waitForTimeout(100); continue; }
      if (s.evolveReady) {
        await control([]);
        // The path screen, then the evolve editor for this line's next plan.
        await page.locator('#evolve').waitFor({ state: 'visible' }); await page.locator('#evolve').click();
        await page.locator('#path-screen').waitFor(); await shot(`paths-${s.stage + 1}`);
        await page.locator(`#path-screen [data-plan=${LINE[s.stage]}] .path-choose`).click();
        await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
        // Become a carnivore for stage 1, then an omnivore from stage 2 on.
        const mouth = s.stage === 0 ? 'mouth_snapper' : s.stage === 1 ? 'mouth_beak' : null;
        if (mouth) { await page.locator('#editor [data-tab=parts]').click(); await page.locator('#editor [data-kind=mouth]').click(); await page.locator(`#editor .ed-card[data-part=${mouth}]`).click(); }
        if (await page.locator('#editor .ed-fix').isVisible()) await page.locator('#editor .ed-fix').click();
        await shot(`editor-evolve-${s.stage + 1}`);
        assert.equal(await page.locator('#editor .ed-done').isDisabled(), false, `the ${LINE[s.stage]} design can evolve (${await page.locator('#editor .ed-problem-line').textContent()})`);
        await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
        continue;
      }
      if (s.stage !== lastStage) { diets.add(`${s.stage}:${s.diet}`); await shot(`stage-${s.stage}`); console.log('Playing stage', s.stage, s.diet, 'dna', s.dna, 'render', s.render); lastStage = s.stage; }
      // Only approachable foods of the creature's diet. A target whose distance has not dropped by .5 in 3 s is dropped for a while.
      const edible = s.foods.filter(f => !f.eaten && f.approachable === true && !(skipped.get(f.id) > s.time) && (f.tag === 'any' || s.diet === 'omnivore' || (s.diet === 'herbivore') === (f.tag === 'plant')));
      const reach = f => Math.hypot(f.x - s.player.x, f.z - s.player.z) + Math.abs(f.y - s.player.y);
      const sorted = edible.sort((a, b) => reach(a) - reach(b));
      let f = sorted.find(f => f.id === targetId);
      if (f && reach(f) < approach.best - .5) approach = { best: reach(f), since: s.time };
      else if (f && s.time - approach.since > 3) { skipped.set(f.id, s.time + 12); f = undefined; }
      if (!f) { f = sorted.find(x => x.id !== targetId); targetId = f?.id; approach = { best: f ? reach(f) : Infinity, since: s.time }; }
      if (!f) { await control([]); await page.waitForTimeout(200); continue; }
      const dx = f.x - s.player.x, dz = f.z - s.player.z, distance = Math.hypot(dx, dz);
      const desired = ['Space']; if (distance > 1.05) { const yaw = s.world.yaw, lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz, lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz; if (lx > .55) desired.push('KeyD'); if (lx < -.55) desired.push('KeyA'); if (lz > .55) desired.push('KeyS'); if (lz < -.55) desired.push('KeyW'); }
      // Breach only when the plan can Breach; Rise and Dive only when it can rise (a Breach plan's E tap is a Breach).
      if (s.caps.breach && s.arc === null && ((f.kind === 'bird' && distance < 2.5) || (f.y - s.player.y > 1.6 && distance < 3))) await page.keyboard.press('KeyE');
      if (s.caps.rise && !s.caps.breach && f.y - s.player.y > .8) desired.push('KeyE');
      // Blocked by the seabed (a slope stops a swimmer; it does not slide): rise over it, as a player would.
      const blocked = s.contactNow && s.lastContact === 'ground';
      if (blocked && s.caps.breach && s.arc === null && s.time >= s.breachReadyAt) await page.keyboard.press('KeyE');
      if (blocked && s.caps.rise && !s.caps.breach && !desired.includes('KeyE')) desired.push('KeyE');
      if (!blocked && s.caps.dive && s.arc === null && s.player.y - f.y > .8) desired.push('KeyQ');
      await control(desired); await page.waitForTimeout(130);
      const after = await state(); for (const food of s.foods) if (!after.foods.find(o => o.id === food.id) && after.stage === s.stage) eatenKinds.add(`${food.tier}:${food.kind}`);
      if (loops % 150 === 0) console.log('Progress', s.mode, s.stage, s.stageDna, '/', s.goal, 'player', s.player, 'target', f.kind, [f.x, f.y, f.z]);
    }
    await control([]); const done = await state();
    assert.equal(done.completed, true); assert.equal(done.eatenPlanets.length, 12); assert.equal(transforms, 4); assert.equal(done.world.worldId, universeId);
    assert.deepEqual(done.plans, ['speck', ...LINE], `the journey followed the ${LINE[0]} line`);
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
    console.log(`PASSED (${LINE[0]} line): editor (place, undo, paint, body, name), path screen, diet changes, DNA evolution through five sizes, in-place transformations, persistent world, look camera, breach, victory, new seeded world, save/resume, pause, sound, joystick, mobile layout.`);
  }
} finally { await browser.close(); }
