import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const sites=JSON.parse(readFileSync('src/discoveries/data.json'));
const base=process.env.VERIFY_URL??'http://127.0.0.1:5209/wildtag/wildtag.html';
const out='docs/wildtag/discoveries';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
await page.addInitScript(()=>{
 window.__discoverySaveWrites=0;const write=Storage.prototype.setItem;
 Storage.prototype.setItem=function(key,value){if(key==='wildtag-save-v1')window.__discoverySaveWrites++;return write.call(this,key,value);};
});
const report={checks:[],sites:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function look(target){await page.evaluate(t=>{const p=window.__game.player.pos(),dx=t.x-p.x,dz=t.z-p.z;window.__game.setLook(Math.atan2(-dx,-dz),Math.atan2(t.y-p.y-1.65,Math.hypot(dx,dz)));},target);}
async function walk(target){
 return page.evaluate(t=>new Promise(resolve=>{
  const started=performance.now();let held=false;
  function tick(){const g=window.__game,p=g.player.pos(),dx=t.x-p.x,dz=t.z-p.z;
   if(Math.hypot(dx,dz)<.3||performance.now()-started>16000){document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true}));return resolve({pos:p,reached:Math.hypot(dx,dz)<.3});}
   g.setLook(Math.atan2(-dx,-dz),0);if(!held){document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));held=true;}requestAnimationFrame(tick);
  }requestAnimationFrame(tick);
 }),target);
}
try{
 await page.goto(`${base}?fresh=1&quality=high`);await page.waitForFunction(()=>!!window.__wonders,{timeout:120000});
 await page.locator('#game').click({position:{x:900,y:600}});await page.waitForFunction(()=>document.pointerLockElement?.id==='game');
 await page.evaluate(()=>window.__game.setTimeOfDay('day'));
 for(const site of sites){
  // Separate fixtures reach distant biomes; the final approach uses actual
  // keyboard movement and the production terrain/architecture collision.
  const approach=site.approach,start={...approach,z:approach.z+3};
  if(!['sky','castle','atlantis'].includes(site.region))start.y=await page.evaluate(p=>window.__game.groundY(p.x,p.z)+.1,start);
  await page.evaluate(p=>window.__game.player.teleport(p.x,p.y,p.z),start);
  await page.waitForTimeout(450);await look(site.focus);
  await page.screenshot({path:`${out}/${site.id}-approach.png`});
  const walked=await walk(approach);assert(walked.reached,`${site.id} approach blocked: ${JSON.stringify(walked)}`);
  await look(site.focus);await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>window.__wonders.state().nearby),site.id,`${site.id} visible prompt`);
  const inventory=await page.evaluate(()=>window.__game.state().inventory);
  const writes=await page.evaluate(()=>window.__discoverySaveWrites);
  await page.keyboard.press('f');await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>window.__discoverySaveWrites),writes+1,`${site.id} first visit saves once`);
  // Repeated keydowns during the cooldown must still consume F, but cannot
  // serialize the game again or fall through to harvesting/building.
  for(let i=0;i<4;i++){await page.keyboard.press('f');await page.waitForTimeout(35);}
  assert.equal(await page.evaluate(()=>window.__discoverySaveWrites),writes+1,`${site.id} cooldown spam performs no saves`);
  assert.deepEqual(await page.evaluate(()=>window.__game.state().inventory),inventory,`${site.id} has no resource cost or reward`);
  let state=await page.evaluate(()=>window.__wonders.state());
  assert(state.visited.includes(site.id),`${site.id} remembers F`);assert(state.active.includes(site.id),`${site.id} reacts`);
  assert(state.rigs.find(r=>r.id===site.id).count>0,`${site.id} has animated Blender pivots`);
  await page.screenshot({path:`${out}/${site.id}.png`});
  await page.waitForTimeout(950);await page.keyboard.press('f');await page.waitForTimeout(80);
  state=await page.evaluate(()=>window.__wonders.state());assert.equal(state.visited.filter(id=>id===site.id).length,1);
  assert.equal(await page.evaluate(()=>window.__discoverySaveWrites),writes+1,`${site.id} repeat reaction performs no saves`);
  assert.deepEqual(await page.evaluate(()=>window.__game.state().inventory),inventory,`${site.id} repeat cannot farm rewards`);
  report.sites.push({id:site.id,region:site.region,walked:walked.pos,rigs:state.rigs.find(r=>r.id===site.id).count});
  console.log('PASS',site.id);
 }
 report.checks.push('All 18 sites: walk-up approach, visible F prompt, real F reaction, Blender motion pivots, repeatable interaction without duplicate memories; first and repeated uses leave inventory unchanged');
 report.checks.push('All 18 first visits save once; cooldown spam and repeated reactions perform no additional saves');
 // Walk through the hollow itself; the center passage must remain clear.
 const hollow=sites.find(s=>s.id==='rootlight');
 await page.evaluate(p=>window.__game.player.teleport(p.x,p.y,p.z+3.8),hollow.pos);
 assert((await walk({...hollow.pos,z:hollow.pos.z-3.8})).reached);report.checks.push('Walk through the full Rootlight Hollow passage');
 await page.keyboard.press('Escape');await page.waitForTimeout(250);assert.equal(await page.locator('#curiosity-prompt').isVisible(),false);await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__game.save());
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('wildtag-save-v1')));assert.equal(before.curiosities.length,18);
 await page.goto(`${base}?quality=high`);await page.waitForFunction(()=>!!window.__game,{timeout:120000});
 const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('wildtag-save-v1')));assert.deepEqual(restored.curiosities,before.curiosities);
 assert.equal(await page.locator('#dev-performance').count(),0);report.checks.push('Normal save/reload retains all 18 memories; inventory screen hides prompt and dev overlay stays absent');
 await page.goto(`${base}?debug=discovery-restore&quality=high`);await page.waitForFunction(()=>!!window.__wonders,{timeout:120000});
 assert.deepEqual(await page.evaluate(()=>window.__wonders.state().visited),before.curiosities);report.checks.push('Restored runtime memory matches the saved discoveries');
 report.art=await page.evaluate(()=>window.__game.logistics().art);assert.deepEqual(report.art.failed,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error);report.state=await page.evaluate(()=>window.__wonders?.state());await page.screenshot({path:`${out}/failure.png`});throw error;}
finally{writeFileSync(`${out}/verification.json`,JSON.stringify(report,null,2));await browser.close();}
