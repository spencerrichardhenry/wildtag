import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { GAME, KEYS, makeFixture, writeStorage } from './fixtures/tiny-tide-fixtures.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1000,height:750}});
const page=await context.newPage(),state=()=>page.evaluate(()=>window.__tinyTide);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const stored=key=>page.evaluate(k=>localStorage.getItem(k),key);
try{
 // A v1 save in space (fixture page), one planet left.
 const v1=await makeFixture(page,{legacy:'v1',legacyFields:{stage:4,bites:11,total:63,elapsed:100,eatenPlanets:Array.from({length:11},(_,i)=>i),completed:false}});
 await writeStorage(page,{[v1.key]:v1.json});
 await page.goto(process.env.VERIFY_URL||GAME);await page.waitForFunction(()=>window.__tinyTide?.time>.3);
 assert.equal((await state()).loadedKey,KEYS.v1);assert.equal((await state()).saveKey,KEYS.v4,'the migrated run writes the v4 key');
 await page.locator('#start').click();
 const held=new Set();async function control(keys){for(const k of [...held])if(!keys.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
 for(let i=0;i<180 && !(await state()).completed;i++){
  const s=await state(),f=s.foods.find(f=>!f.eaten),dx=f.x-s.player.x,dz=f.z-s.player.z,y=s.world.yaw,lx=Math.cos(y)*dx-Math.sin(y)*dz,lz=Math.sin(y)*dx+Math.cos(y)*dz,keys=['Space'];
  if(lx>.6)keys.push('KeyD');if(lx<-.6)keys.push('KeyA');if(lz>.6)keys.push('KeyS');if(lz<-.6)keys.push('KeyW');if(f.y-s.player.y>.8)keys.push('KeyE');if(s.player.y-f.y>.8)keys.push('KeyQ');await control(keys);await page.waitForTimeout(120);
 }
 await control([]);assert.ok((await state()).completed);await page.locator('#play-again').click();
 const fresh=await state();assert.ok(fresh.foods.length>0 && fresh.foods.every(f=>Math.abs(f.x)<60 && Math.abs(f.z)<60),'Food collision coordinates reset immediately with world scale');
 for(let i=0;i<120 && (await state()).bites===0;i++){
  const s=await state(),f=s.foods.filter(f=>f.tag==='plant').sort((a,b)=>Math.hypot(a.x-s.player.x,a.z-s.player.z)-Math.hypot(b.x-s.player.x,b.z-s.player.z))[0],dx=f.x-s.player.x,dz=f.z-s.player.z,y=s.world.yaw,lx=Math.cos(y)*dx-Math.sin(y)*dz,lz=Math.sin(y)*dx+Math.cos(y)*dz,keys=['Space'];
  if(lx>.55)keys.push('KeyD');if(lx<-.55)keys.push('KeyA');if(lz>.55)keys.push('KeyS');if(lz<-.55)keys.push('KeyW');await control(keys);await page.waitForTimeout(120);
 }
 await control([]);
 const replay=await state();await page.screenshot({path:'.codex-drafts/tiny-tide-qa/replay.png'});assert.equal(replay.mode,'playing');assert.equal(replay.stage,0,'The first chomp must not instantly evolve');assert.ok(replay.bites>0);
 // The new adventure is saved under the v4 key; the v1 bytes stay untouched.
 const saved=JSON.parse(await stored(KEYS.v4));assert.equal(saved.version,4);assert.equal(saved.completed,false);assert.equal(saved.seed,replay.world.seed,'-v4 holds the new adventure');
 assert.equal(await stored(KEYS.v1),v1.json,'-v1 stays unchanged');assert.equal(await stored(KEYS.fresh),null,'no second v4 key is needed');
 assert.deepEqual(errors,[]);console.log('PASS: v1 save migration (-v1 unchanged, -v4 written), final planet, ending, immediate collision reset and playable fresh adventure.');
}finally{await browser.close();}
