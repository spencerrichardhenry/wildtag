import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base=process.env.VERIFY_URL??'http://127.0.0.1:5209/wildtag/wildtag.html';
const out='docs/wildtag/landmarks';mkdirSync(out,{recursive:true});
const C=JSON.parse(readFileSync('src/landmarks/castle.json')),A=JSON.parse(readFileSync('src/landmarks/atlantis.json'));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],report={checks:[],route:[]};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pos=()=>page.evaluate(()=>window.__game.player.pos());
const state=()=>page.evaluate(()=>({game:window.__game.state(),water:window.__underwater?.state(),landmarks:window.__landmarks?.progress()}));
const world=(l,x,y,z)=>({x:l.center.x+x,y:l.center.y+y,z:l.center.z+z});
async function aim(t){await page.evaluate(t=>{const p=window.__game.player.pos(),dx=t.x-p.x,dy=t.y-p.y-1.65,dz=t.z-p.z;window.__game.setLook(Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));},t);}
async function fixture(l,x,y,z){const p=world(l,x,y,z);await page.evaluate(p=>window.__game.player.teleport(p.x,p.y,p.z),p);await page.waitForTimeout(400);}
async function lock(){await page.locator('#game').click({position:{x:900,y:600}});await page.waitForFunction(()=>document.pointerLockElement?.id==='game');}
async function walk(l,x,z,minY=0){
 const target=world(l,x,0,z);
 const result=await page.evaluate(({target,floor})=>new Promise(resolve=>{
   const started=performance.now();let held=false;
   function stop(error){document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true}));resolve({error,pos:window.__game.player.pos()});}
   function tick(){const g=window.__game,p=g.player.pos(),dx=target.x-p.x,dz=target.z-p.z;
     if(Math.hypot(dx,dz)<.5)return stop(null);
     if(p.y<floor-.7)return stop('Fell from route');
     if(performance.now()-started>30000)return stop('Route blocked');
     g.setLook(Math.atan2(-dx,-dz),0);if(!held){document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));held=true;}requestAnimationFrame(tick);
   }requestAnimationFrame(tick);
 }),{target,floor:l.center.y+minY});
 await page.keyboard.up('w');await page.waitForTimeout(100);assert(!result.error,`${result.error} toward ${x},${z}: ${JSON.stringify(result.pos)}`);report.route.push(result.pos);
}
async function depth(y){
 const target=A.center.y+y;
 const result=await page.evaluate(target=>new Promise(resolve=>{
   const start=performance.now();let held='';
   const key=(code,type)=>document.dispatchEvent(new KeyboardEvent(type,{code,key:code==='KeyE'?'e':'q',bubbles:true}));
   function tick(){const p=window.__game.player.pos(),d=target-p.y;
     if(Math.abs(d)<.18||performance.now()-start>12000){if(held)key(held,'keyup');return resolve(p.y);}
     const next=d>0?'KeyE':'KeyQ';if(next!==held){if(held)key(held,'keyup');held=next;key(held,'keydown');}requestAnimationFrame(tick);
   }requestAnimationFrame(tick);
 }),target);
 assert(Math.abs(result-target)<.4,`Q/E could not reach depth ${y}: ${result}`);
}
async function swim(x,z,y){if(y!==undefined)await depth(y);await walk(A,x,z,-1);assert((await state()).game.hp>0,'Dive remains survivable');}
async function bell(id){const a=A.airbells.find(a=>a.id===id);await swim(a.x,a.z);await depth(a.y-1.65);await page.waitForTimeout(1700);const s=await state();assert(s.water.breath>s.water.breathMax-.5,`Airbell ${id} refills breath`);report.checks.push(`airbell refuge: ${id}`);console.log('Refuge',id);}
async function record(l,id){const r=l.relics.find(r=>r.id===id);await page.keyboard.press('f');await page.waitForTimeout(220);assert((await state()).landmarks.records.includes(`${l.id}:${r.id}`),`Read ${l.id}:${id}`);console.log('Record',l.id,id);}
async function shot(target){await aim(target);await page.mouse.down({button:'left'});await page.waitForTimeout(70);await page.mouse.up({button:'left'});await page.waitForTimeout(1000);}
async function screenshot(name,target){if(target)await aim(target);await page.waitForTimeout(200);await page.screenshot({path:`${out}/${name}.png`});}
try{
 await page.goto(`${base}?fresh=1&quality=high`);await page.waitForFunction(()=>!!window.__landmarks,{timeout:120000});await lock();
 await page.evaluate(()=>{window.__game.grant('purifiers',20);window.__game.setTimeOfDay('day');window.__game.setTimeScale(1);});
 await fixture(C,102,.08,-3);await screenshot('castle-gate',world(C,90,8,0));
 for(const [x,z] of [[102,26],[90,26],[90,-82],[82,-82],[82,-90],[-2.5,-90],[-2.5,-63],[-2.5,-7]])await walk(C,x,z,x===102?0:7);
 assert(Math.abs((await pos()).y-C.center.y-8)<.2);report.checks.push('gate stair -> battlement corner -> library roof -> north keep door, normal walking');
 for(const [x,z] of [[7,-7],[7,7],[-7,7],[-3,-2]])await walk(C,x,z,7);
 assert(Math.abs((await pos()).y-C.center.y-20)<.2);await record(C,'watch');await screenshot('castle-crown',world(C,-62,4,-30));
 await page.evaluate(()=>window.__game.setTimeScale(1));await fixture(C,7,.08,0);
 for(const [x,z] of C.routeHints.roofPath)await walk(C,x,z);
 assert(Math.abs((await pos()).y-C.center.y-20)<.2);report.checks.push('all four keep stair flights from crystal chamber to Crown Walk');
 await fixture(C,4.5,.08,-65.5);await record(C,'library');await screenshot('castle-library',world(C,-10,3,-60));
 await fixture(C,-58.5,.08,-8.5);await record(C,'forge');await screenshot('castle-forge',world(C,-63,2,-9));
 for(const id of ['garden','market','court']){const z=C.zones.find(z=>z.id===id);await fixture(C,z.x+5,.08,z.z);await screenshot('castle-'+id,world(C,z.x,2,z.z));}
 assert.equal((await state()).landmarks.discovered.filter(id=>id.startsWith('castle:')).length,10);
 await page.keyboard.press('Escape');await page.locator('.wt-inv-card[data-item-name="Purify"]').click();await page.locator('.wt-inv-slot').nth(1).click();await page.keyboard.press('Escape');await lock();
 await fixture(C,6,.08,0);await page.keyboard.press('2');
 await shot(world(C,0,1.4,0));await page.waitForFunction(()=>window.__game.state().castlePurified,undefined,{timeout:10000});report.checks.push('real purifying dart lifts curse; detailed warm castle replaces cursed dressing');
 await fixture(C,-3,20,-8);await screenshot('castle-purified',world(C,-2.5,7,-70));
 // One continuous base-breath dive through the city's lower rooms and upper crown.
 await fixture(A,6,6.35,-55);await bell('gate');await screenshot('atlantis-causeway',world(A,0,8,12));
 await swim(-5,-32);await bell('market');
 await swim(-25,-32);await swim(-25,-14);await bell('entry');await swim(-47,-14);await bell('arcade');
 await screenshot('atlantis-arcade',world(A,-47,4,14));
 for(let attempt=0;attempt<3&&!(await state()).water.purifiedClams.includes(2003);attempt++)await shot(world(A,-47,2.9+attempt*.25,6));
 assert((await state()).water.purifiedClams.includes(2003));report.checks.push('real purifier dart turns relocated arcade clam 2003 into a turtle');
 await swim(-47,14);await swim(-31,14);await bell('turn');await swim(-31,38);await bell('archive');
 await swim(-40,49,3.5);await record(A,'archive');await screenshot('atlantis-archive',world(A,-28,4,46));
 await bell('archive');await swim(-35,40,3.5);await swim(-55,40);await bell('crypt');await screenshot('atlantis-crypt',world(A,-59,3,42));await swim(-35,40);await bell('archive');
 await swim(-35,42,4.5);await swim(-18,42);await bell('road');await swim(0,42);await swim(24,42);await bell('reef');
 await screenshot('atlantis-conservatory',world(A,42,7,54));
 await swim(37,30);await swim(37,13);await bell('tideworks');await swim(43,22,5);await record(A,'tideworks');await screenshot('atlantis-tideworks',world(A,39,7,16));await bell('tideworks');
 await swim(37,12,6);await bell('crossing');await swim(0,12,6);await bell('nave');await screenshot('atlantis-nave',world(A,0,10,29));
 await swim(0,12);await depth(11.3);await swim(0,30);await swim(0,44);await bell('crown');await swim(7,48,12);await record(A,'crown');await screenshot('atlantis-crown',world(A,0,15,40));
 assert.equal((await state()).landmarks.records.length,6);report.checks.push('continuous Q/E dive through arcade, archive, crypt, conservatory, tideworks, nave and crown; all six records');
 await swim(4,46);await depth(23);assert((await state()).water.breath>0);report.checks.push('open observatory oculus provides a direct surface exit');
 report.final=await state();report.art=await page.evaluate(()=>window.__game.logistics().art);
 // The entire run used a normal save, normal swim speed and starting breath.
 const readSave=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wildtag-save-v1')));
 assert.equal((await state()).landmarks.discovered.length,20);
 await fixture(C,-3,20,-2);await page.evaluate(()=>window.__game.save());
 const earned=(await readSave()).inventory;
 await page.keyboard.press('f');await page.waitForTimeout(180);assert.deepEqual((await readSave()).inventory,earned);
 await page.goto(`${base}?quality=medium`);await page.waitForFunction(()=>!!window.__game,{timeout:120000});await page.waitForTimeout(500);
 const restored=await readSave();assert.equal(restored.landmarkExploration.records.length,6);assert.equal(restored.landmarkExploration.discovered.length,20);assert(restored.underwater.purifiedClams.includes(2003));assert(restored.castlePurified);assert(Math.abs((await pos()).y-C.center.y-20)<.2);assert.equal(await page.locator('#dev-performance').count(),0);
 await page.keyboard.press('f');await page.waitForTimeout(180);assert.equal((await readSave()).inventory.spark,earned.spark);assert.equal((await readSave()).inventory.stone,earned.stone);
 report.checks.push('normal save/reload preserves twenty discoveries, six records, one-time rewards, castle purification, clam identity and keep-roof altitude; FPS overlay stays dev-only');
 assert.deepEqual(errors,[]);report.passed=true;writeFileSync(`${out}/gameplay-verification.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report.checks));
}catch(e){report.error=String(e);report.errors=errors;report.state=await state();report.ui=await page.locator('body').innerText();writeFileSync(`${out}/gameplay-failure.json`,JSON.stringify(report,null,2));await page.screenshot({path:`${out}/gameplay-failure.png`});throw e;}finally{await browser.close();}
