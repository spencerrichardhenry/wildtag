import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
const base=process.env.VERIFY_URL??'http://localhost:5199/wildtag.html';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
mkdirSync('docs/wildtag',{recursive:true});
try{
 await page.goto(`${base}?fresh=1&quality=high`);await page.waitForFunction(()=>!!window.__game,{timeout:120000});
 await page.evaluate(()=>{const g=window.__game,d=g.logistics().depot;g.player.teleport(d.x+8,d.y+.5,d.z+10);g.setLook(.65,-.08);});
 await page.waitForTimeout(1200);await page.screenshot({path:'docs/wildtag/haven-depot.png'});
 const state=await page.evaluate(()=>({stats:window.__game.renderStats(),art:window.__game.logistics().art}));
 assert.equal(state.art.loaded,120);assert.equal(state.art.failed.length,0);assert(state.stats.triangles>0);
 await page.evaluate(()=>{
   const g=window.__game,d=g.logistics().deposits[0];g.player.teleport(d.pos.x,d.pos.y+.5,d.pos.z+3);
   for(const key of ['wood','stone','fiber','resin','rp','charms'])g.grant(key,100);
   g.researchField('fieldworks');g.researchField('harness');g.logisticsAction('survey',d.id);g.logisticsAction('build',d.id);
   const worker=g.spawn('timberchomp',4);g.completeTracking(worker);g.bond(worker);g.assignHauler(d.id,worker);g.setTimeScale(.1);
   const depot=g.logistics().depot;g.player.teleport(depot.x+5,depot.y+.5,depot.z+6);g.setLook(.7,-.12);
 });
 await page.waitForTimeout(1200);await page.screenshot({path:'docs/wildtag/companion-hauling.png'});
 await page.goto(`${base}?preview=critters&quality=high`);await page.locator('canvas').waitFor();
 await page.waitForFunction(()=>!document.body.innerText.includes('Preparing the island'),{timeout:120000});await page.waitForTimeout(1800);
 await page.screenshot({path:'docs/wildtag/creatures-in-game.png'});
 assert.deepEqual(errors,[]);writeFileSync('docs/wildtag/art-verification.json',JSON.stringify({passed:true,...state,errors},null,2));console.log('PASS Blender runtime art',state);
}finally{await browser.close();}
