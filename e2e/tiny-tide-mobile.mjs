import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { GAME, KEYS, frames, makeFixture, openGame, start, writeStorage } from './fixtures/tiny-tide-fixtures.mjs';
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, {recursive:true});
/** The most triangles a phone frame may draw at any stage (final review M1). Measured at 390×844: .86M / 1.26M / 1.51M / 1.24M at
 *  stages 0–3 (stage 3 was 1.35M before the coarse seabed ring); the budget leaves about 6 % over the largest. */
const PHONE_TRIANGLE_BUDGET = 1_600_000;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__tinyTide);
const moved=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Braking-aware stop check: wait until the controlled velocity is zero, then the body must stay put for 200 ms. */
async function assertStops(label){await page.waitForFunction(()=>{const v=window.__tinyTide.velocity;return Math.hypot(v.x,v.y,v.z)<.01;},{},{timeout:2000});const at=(await state()).player;await page.waitForTimeout(200);assert.ok(moved((await state()).player,at)<.01,`${label}: stays put after braking`);}
/** The controlled speed now and after the next frame. */
const speedNextFrame=()=>page.evaluate(()=>new Promise(r=>{const v=()=>{const s=window.__tinyTide.velocity;return Math.hypot(s.x,s.y,s.z);};const a=v();requestAnimationFrame(()=>requestAnimationFrame(()=>r([a,v()])));}));
try {
 // A v1 save (fixture page) migrates; the -v1 bytes stay unchanged.
 const v1=await makeFixture(page,{legacy:'v1'});await writeStorage(page,{[v1.key]:v1.json});
 await page.goto(process.env.VERIFY_URL||GAME);await page.waitForFunction(()=>window.__tinyTide?.time>.4);
 const boot=await state();assert.equal(boot.loadedKey,KEYS.v1,'the v1 save is the resumable run');
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEYS.v1),v1.json,'-v1 stays unchanged');
 assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),KEYS.v4)).version,4,'the migrated run is written to -v4');
 await page.locator('#start').click();await page.waitForTimeout(600);
 assert.equal((await state()).plan,'swimmer','the v1 stage-1 save became a Swimmer');
 const cdp=await context.newCDPSession(page);
 const center=async id=>{const b=await page.locator(id).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,radiusX:4,radiusY:4,force:1};};
 const j={...await center('#joystick'),id:1},rise={...await center('#special'),id:2};const before=await state();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[j]});
 j.x+=27;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[j]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[j,rise]});await page.waitForTimeout(550);
 const during=await state();assert.ok(during.player.x>before.player.x+1.2,'Joystick moves during Rise');assert.ok(during.player.y>before.player.y+1.2,'Two-finger Rise changes depth');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await assertStops('Releasing vertical controls hovers');const hover=await state();
 const look={id:3,x:285,y:365,radiusX:4,radiusY:4,force:1};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[look]});look.x+=40;look.y-=70;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[look]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const looked=await state();assert.ok(looked.world.pitch<hover.world.pitch-.25,'Touch swipe looks up');assert.ok(looked.world.yaw<hover.world.yaw-.15,'Touch swipe turns camera');
 await page.screenshot({path:`${out}/mobile-swimming.png`});
 const dive={...await center('#dive'),id:4};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dive]});await page.waitForTimeout(350);
 const diving=(await state()).velocity;await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});const [atCancel,next]=await speedNextFrame();
 assert.ok(Math.hypot(diving.x,diving.y,diving.z)>.01,'Dive moves');assert.ok(next===0||next<Math.min(atCancel,Math.hypot(diving.x,diving.y,diving.z)),'Cancelled touch makes the next frame slower (or stops: braking can reach 0 in one frame)');
 const dived=await state();assert.ok(dived.player.y<looked.player.y-1,'Dive descends');await assertStops('Cancelled touch releases Dive');
 for(const viewport of [{width:320,height:568},{width:844,height:390}]) {await page.setViewportSize(viewport);await page.waitForTimeout(200);for(const sel of ['#joystick','#chomp','#special','#dive','#pause','#edit','#hearts']){const b=await page.locator(sel).boundingBox();assert.ok(b && b.x>=0 && b.y>=0 && b.x+b.width<=viewport.width+1 && b.y+b.height<=viewport.height+1,`${sel} fits ${viewport.width}x${viewport.height}`);}await page.screenshot({path:`${out}/mobile-${viewport.width}.png`});}
 // A second phone context: Evolve -> Swimmer -> Undo all shows a visible problem line about legs that fits.
 const phone=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const second=await phone.newPage();
 second.on('pageerror',e=>errors.push(e.message));second.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const ready=await makeFixture(second,{ready:true});await openGame(second,{storage:{[ready.key]:ready.json}});await start(second);
 await second.locator('#evolve').waitFor({state:'visible'});await second.locator('#evolve').tap();await second.locator('#path-screen').waitFor();
 await second.locator('#path-screen [data-plan=swimmer] .path-choose').tap();await second.locator('#editor').waitFor();await frames(second,3);
 await second.locator('#editor .ed-changes-box summary').tap();await second.locator('#editor .ed-undo-all').tap();await frames(second,3);
 const line=second.locator('#editor .ed-problem-line');assert.equal(await line.isVisible(),true,'.ed-problem-line is visible');
 assert.match(await line.textContent(),/\bleg/i,'the problem line mentions legs');
 const lb=await line.boundingBox();assert.ok(lb&&lb.x>=0&&lb.y>=0&&lb.x+lb.width<=391&&lb.y+lb.height<=845,'the problem line fits the phone');
 await second.screenshot({path:`${out}/mobile-problem-line.png`});
 // Final review M1: the triangle budget of a phone at every stage (a fixture per stage; the Big stage drew the fine seabed rings).
 const tris={};
 for(const stage of [0,1,2,3]){const pc=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const pg=await pc.newPage();
  pg.on('pageerror',e=>errors.push(e.message));pg.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const fx=await makeFixture(pg,{stage});await openGame(pg,{storage:{[fx.key]:fx.json}});await start(pg);await frames(pg,30);
  let most=0;for(let i=0;i<20;i++){await frames(pg,2);most=Math.max(most,(await pg.evaluate(()=>window.__tinyTide.render.triangles)));}
  tris[stage]=most;await pc.close();}
 console.log('Phone triangles per frame (most of 20 samples):',JSON.stringify(tris));
 for(const [stage,count] of Object.entries(tris)) assert.ok(count<=PHONE_TRIANGLE_BUDGET,`stage ${stage}: ${count} triangles within the phone budget ${PHONE_TRIANGLE_BUDGET}`);
 assert.deepEqual(errors,[]);console.log('PASSED: v1 migration (-v1 unchanged), genuine multitouch move + rise, swipe camera, stable hover, Dive, touch cancellation, 390/320 portrait and landscape control layout, phone Evolve → Swimmer → Undo all problem line, phone triangle budget at stages 0–3.');
} finally {await browser.close();}
