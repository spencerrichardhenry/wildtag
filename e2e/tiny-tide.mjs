import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let modelRequests=0;page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.glb'))modelRequests++;});
const diets = [['plant','kelp_snack','seagrape','lettuce'],['shrimp','crab','jellyfish','snail'],['fish','squid','ray','bird'],['tree','boat','plane','balloon','lighthouse'],['planet']];
const state = () => page.evaluate(() => window.__tinyTide);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const url = process.env.VERIFY_URL || 'http://localhost:5199/tiny-tide.html?qa';
try {
  await page.goto(url); await page.waitForFunction(() => window.__tinyTide?.time > .5);
  await shot('01-home'); console.log('Home rendered', (await state()).render);
  assert.equal((await state()).assets.loaded,50,'All Blender models preload before play');
  await page.getByRole('button', { name: 'How to play' }).click(); await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: /Got it/ }).click();
  await page.getByRole('button', { name: /Let’s eat/ }).click(); await page.waitForTimeout(700); await shot('02-play');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await shot('03-mobile-play');
  for (const selector of ['#chomp', '#joystick', '#pause', '#growth-fill']) { const b = await page.locator(selector).boundingBox(); assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 391 && b.y + b.height <= 845, `${selector} fits mobile`); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Exercise a captured pointer drag, then release and confirm the joystick stops.
  const before = await state(); const j = await page.locator('#joystick').boundingBox();
  await page.mouse.move(j.x + j.width / 2, j.y + j.height / 2); await page.mouse.down(); await page.mouse.move(j.x + j.width - 10, j.y + j.height / 2); await page.waitForTimeout(450); await page.mouse.up();
  assert.ok((await state()).player.x > before.player.x + 1);
  const released = (await state()).player.x; await page.waitForTimeout(200); assert.ok(Math.abs((await state()).player.x - released) < .05);
  await page.getByRole('button', { name: 'Pause game' }).click(); const paused = await state(); await page.waitForTimeout(200); assert.equal((await state()).elapsed, paused.elapsed);
  await page.getByRole('button', { name: /Keep munching/ }).click();
  await page.getByRole('button', { name: 'Mute sound' }).click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
  if (process.argv.includes('--visual-only')) {
    await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(600); await shot('04-mobile-home');
    console.log(JSON.stringify({ errors, state: await state() }));
  } else {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Look controls change yaw and pitch with a real canvas drag.
    const lookBefore = (await state()).world;
    await page.mouse.move(900, 380); await page.mouse.down(); await page.mouse.move(970, 405, { steps: 8 }); await page.mouse.up();
    const lookAfter = (await state()).world; assert.ok(Math.abs(lookAfter.yaw - lookBefore.yaw) > .3); assert.ok(lookAfter.pitch > lookBefore.pitch);
    await page.mouse.move(970,405);await page.mouse.down();await page.mouse.move(900,380,{steps:8});await page.mouse.up();
    const universeId=(await state()).world.worldId;
    assert.ok((await state()).landmarks.some(f=>f.kind==='fish'),'Larger fish coexist with the opening shrimp');
    let transforms=0;

    const held = new Set();
    async function control(wanted) {
      for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    }
    const eatenKinds = new Set(); let prior = await state(), loops = 0, targetId = null, lastStage = -1;
    while (!(await state()).completed && loops++ < 2000) {
      const s = await state();
      for (const food of s.foods) if (food.eaten && !prior.foods.find(p => p.id === food.id)?.eaten) eatenKinds.add(food.kind);
      if (s.mode === 'evolving') {
        await control([]); assert.equal(await page.locator('#modal').evaluate(d=>d.open),false,'Evolution has no dialog or loading screen');
        const physical = s.world.physicalPosition; const startScale=s.world.scale;
        await page.waitForTimeout(1100);const mid=await state();
        assert.equal(modelRequests,50,'Transformations reuse preloaded Blender models');
        assert.ok(mid.world.scale>startScale,'World shrinks continuously');assert.equal(mid.world.worldId,universeId,'Same persistent universe');
        assert.ok(Math.abs(mid.world.physicalPosition.x-physical.x)<.01 && Math.abs(mid.world.physicalPosition.z-physical.z)<.01,'Transformation preserves physical location');
        await shot(`evolution-${s.stage}`);await page.waitForFunction(()=>window.__tinyTide.mode==='playing');transforms++;targetId=null;prior=await state();continue;
      }
      if (s.stage !== lastStage) { await shot(`stage-${s.stage}`); console.log('Playing stage', s.stage, 'total', s.total, 'render', s.render); lastStage = s.stage; }
      const candidates = s.foods.filter(f => !f.eaten);
      // Eat every distinct food in each habitat before filling up on repeats.
      const required = diets[s.stage].find(kind => !eatenKinds.has(kind));
      const sorted = candidates.filter(f => !required || f.kind === required).sort((a,b) => Math.hypot(a.x-s.player.x,a.z-s.player.z)-Math.hypot(b.x-s.player.x,b.z-s.player.z));
      let f = sorted.find(f => f.id === targetId) || sorted[0]; targetId = f?.id;
      if (!f) throw new Error('No food left before victory');
      const dx=f.x-s.player.x, dz=f.z-s.player.z, distance=Math.hypot(dx,dz);
      const desired=['Space']; if(distance>1.05) { const yaw=s.world.yaw,lx=Math.cos(yaw)*dx-Math.sin(yaw)*dz,lz=Math.sin(yaw)*dx+Math.cos(yaw)*dz;if(lx>.55)desired.push('KeyD');if(lx<-.55)desired.push('KeyA');if(lz>.55)desired.push('KeyS');if(lz<-.55)desired.push('KeyW'); }
      if(s.stage===2 && f.kind==='bird' && distance<2.5 && s.leap<0) await page.keyboard.press('KeyE');
      if(s.stage!==2 && s.stage>0 && f.y-s.player.y>.8) desired.push('KeyE');
      if(s.stage>0 && s.leap<0 && s.player.y-f.y>.8) desired.push('KeyQ');
      if(s.stage===2 && f.kind!=='bird' && s.leap<0 && f.y-s.player.y>1.6 && distance<3)await page.keyboard.press('KeyE');
      await control(desired); prior=s; await page.waitForTimeout(130);
      if(loops%150===0)console.log('Progress',s.mode,s.stage,s.bites,'player',s.player,'target',f.kind,[f.x,f.y,f.z],'yaw',s.world.yaw,'keys',desired);
    }
    await control([]); const done=await state(); assert.equal(done.completed,true); assert.equal(done.eatenPlanets.length,12); assert.equal(transforms,4);assert.equal(done.world.worldId,universeId); assert.equal(done.foods.filter(f=>!f.eaten).length,0);
    assert.ok(eatenKinds.has('bird'),'Breach eats a bird'); for(const kind of diets.flat())assert.ok(eatenKinds.has(kind),`Ate ${kind}`);
    await page.getByRole('dialog', { name: /All full/ }).waitFor(); await shot('05-victory');
    await page.locator('#play-again').click(); assert.equal((await state()).stage,0);assert.equal((await state()).bites,0);assert.equal((await state()).foods[0].x,4);
    await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForFunction(()=>window.__tinyTide.bites>0,{},{timeout:5000}); await page.keyboard.up('KeyD');await page.keyboard.up('Space');
    const progress=await state(); assert.ok(progress.bites>0); await page.reload();await page.waitForFunction(()=>window.__tinyTide?.time>.3);await page.locator('#start').click();assert.equal((await state()).bites,progress.bites);
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Pause game'}).click();await shot('06-mobile-pause');
    await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForTimeout(600);await shot('04-mobile-home');
    assert.deepEqual(errors,[]);writeFileSync(`${out}/results.json`,JSON.stringify({passed:true,eatenKinds:[...eatenKinds],final:done,errors},null,2));console.log('PASSED: continuous five-stage journey, in-place transformations, shrinking persistent world, look camera, all foods, breach, victory, replay, save/resume, pause, sound, joystick, mobile layout.');
  }
} finally { await browser.close(); }
