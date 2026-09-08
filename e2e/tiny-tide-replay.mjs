import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1000,height:750}});
await context.addInitScript(()=>{if(!localStorage.getItem('tiny-tide-adventure-v1'))localStorage.setItem('tiny-tide-adventure-v1',JSON.stringify({stage:4,bites:11,total:63,elapsed:100,eatenPlanets:Array.from({length:11},(_,i)=>i),completed:false}));});
const page=await context.newPage(),state=()=>page.evaluate(()=>window.__tinyTide);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(process.env.VERIFY_URL||'http://localhost:5199/tiny-tide.html?qa');await page.waitForFunction(()=>window.__tinyTide?.time>.3);await page.locator('#start').click();
 const held=new Set();async function control(keys){for(const k of [...held])if(!keys.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
 for(let i=0;i<180 && !(await state()).completed;i++){
  const s=await state(),f=s.foods.find(f=>!f.eaten),dx=f.x-s.player.x,dz=f.z-s.player.z,y=s.world.yaw,lx=Math.cos(y)*dx-Math.sin(y)*dz,lz=Math.sin(y)*dx+Math.cos(y)*dz,keys=['Space'];
  if(lx>.6)keys.push('KeyD');if(lx<-.6)keys.push('KeyA');if(lz>.6)keys.push('KeyS');if(lz<-.6)keys.push('KeyW');if(f.y-s.player.y>.8)keys.push('KeyE');if(s.player.y-f.y>.8)keys.push('KeyQ');await control(keys);await page.waitForTimeout(120);
 }
 await control([]);assert.ok((await state()).completed);await page.locator('#play-again').click();
 assert.equal((await state()).foods[0].x,4,'Food collision coordinates reset immediately with world scale');
 await page.keyboard.down('Space');await page.keyboard.down('KeyD');await page.waitForTimeout(1200);await page.keyboard.up('KeyD');await page.keyboard.up('Space');
 const replay=await state();await page.screenshot({path:'.codex-drafts/tiny-tide-qa/replay.png'});assert.equal(replay.mode,'playing');assert.equal(replay.stage,0,'The first chomp must not instantly skip shrimp');assert.ok(replay.bites>0);assert.deepEqual(errors,[]);console.log('PASS: final planet, ending, immediate collision reset and playable fresh adventure.');
}finally{await browser.close();}
