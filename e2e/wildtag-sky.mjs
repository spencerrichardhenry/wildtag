import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.VERIFY_URL??'http://127.0.0.1:5209/wildtag/wildtag.html';
const out=process.env.VERIFY_OUT??'docs/wildtag/sky';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],report={checks:[],route:[]};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pos=()=>page.evaluate(()=>window.__game.player.pos());
const state=()=>page.evaluate(()=>({pos:window.__game.player.pos(),sky:window.__sky?.state(),hook:window.__sky?.hook()}));
async function aim(t){await page.evaluate(t=>{const p=window.__game.player.pos(),dx=t.x-p.x,dy=t.y-p.y-1.65,dz=t.z-p.z;window.__game.setLook(Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));},t);}
async function click(button){await page.mouse.down({button});await page.waitForTimeout(85);await page.mouse.up({button});}
async function walk(x,z){
 const started=Date.now();await page.keyboard.down('w');
 while(Date.now()-started<22000){const p=await pos(),distance=Math.hypot(p.x-x,p.z-z);if(distance<.6)break;await aim({x,y:p.y+1.65,z});await page.waitForTimeout(50);assert(p.y>140,`Fell from route approaching ${x},${z}: ${JSON.stringify(p)}`);}
 await page.keyboard.up('w');await page.waitForTimeout(170);const p=await pos();assert(Math.hypot(p.x-x,p.z-z)<1,`Route blocked at ${JSON.stringify(p)}, heading to ${x},${z}`);report.route.push(p);
}
async function captureSpecies(species){
 const target=await page.evaluate(id=>window.__game.listCritters().filter(c=>c.species===id).sort((a,b)=>{const p=window.__game.player.pos();return Math.hypot(a.pos.x-p.x,a.pos.z-p.z)-Math.hypot(b.pos.x-p.x,b.pos.z-p.z);})[0],species);
 assert(target,`${species} naturally spawned in its habitat`);
 let tagged=false;
 for(let attempt=0;attempt<6&&!tagged;attempt++){
  const a=await page.evaluate(id=>window.__game.listCritters().find(c=>c.id===id),target.id);await page.waitForTimeout(110);
  const b=await page.evaluate(id=>window.__game.listCritters().find(c=>c.id===id),target.id);const p=await pos(),t=Math.hypot(b.pos.x-p.x,b.pos.y-p.y-1.65,b.pos.z-p.z)/28;
  await aim({x:b.pos.x+(b.pos.x-a.pos.x)/.11*t,y:b.pos.y+(b.pos.y-a.pos.y)/.11*t+3*t*t,z:b.pos.z+(b.pos.z-a.pos.z)/.11*t});await click('left');await page.waitForTimeout(550);
  tagged=await page.evaluate(id=>!!window.__game.listCritters().find(c=>c.id===id)?.tagged,target.id);
 }
 assert(tagged,`Real tracker dart tags ${species}`);
 await page.waitForFunction(id=>window.__game.listCritters().find(c=>c.id===id)?.linked,target.id,{timeout:35000});
 const c=await page.evaluate(id=>window.__game.listCritters().find(c=>c.id===id),target.id);await aim(c.pos);await page.waitForTimeout(120);await page.keyboard.press('f');await page.waitForTimeout(300);
 assert(await page.evaluate(id=>window.__game.logistics().roster.some(c=>c.id===id),target.id),`F bonds ${species}`);
 report.checks.push(`real dart, tracking and F bond: ${species}`);console.log('Captured',species);
}
try{
 await page.goto(`${base}?dev=1&quality=high`);await page.waitForFunction(()=>!!window.__sky,{timeout:120000});
 await page.locator('#game').click({position:{x:700,y:450}});await page.waitForFunction(()=>document.pointerLockElement?.id==='game');
 await page.evaluate(()=>{const p=window.__sky.state().launch.ground;window.__game.player.teleport(p.x,window.__game.groundY(p.x,p.z),p.z);window.__game.setTimeOfDay('day');});await page.waitForTimeout(700);
 // All ascent motion after this fixture is produced by normal keyboard/mouse input.
 await page.keyboard.press('Space');await page.waitForFunction(()=>window.__sky.state().bounces.ground>0,undefined,{timeout:6000});
 let started=Date.now(),held=false;
 while(Date.now()-started<6500){const s=await state();if(s.sky.bounces.drone>0)break;const target=s.sky.launch.drone,d=Math.hypot(target.x-s.pos.x,target.z-s.pos.z);await aim({...target,y:s.pos.y+1.65});
  if(d>1.3&&!held){await page.keyboard.down('w');held=true;}else if(d<=1.3&&held){await page.keyboard.up('w');held=false;}await page.waitForTimeout(65);
 }await page.keyboard.up('w');
 await page.waitForFunction(()=>window.__sky.state().bounces.drone>0,undefined,{timeout:4000});await page.waitForFunction(()=>window.__game.player.pos().y>68,undefined,{timeout:4000});
 await aim((await state()).sky.launch.anchor);await click('right');await page.waitForFunction(()=>window.__sky.hook()?.hang,undefined,{timeout:7000});
 report.hang=await state();await page.screenshot({path:`${out}/ascent-grapple.png`});assert.equal((await state()).sky.progress.ascent,true);
 await aim({x:184,y:145,z:-150});await page.keyboard.down('w');await page.keyboard.press('Space');await page.waitForTimeout(1400);await page.keyboard.up('w');await page.waitForTimeout(900);
 assert.equal((await pos()).y,143);report.ascent=(await state()).sky.bounces;report.checks.push('ground trampoline -> drone trampoline -> ballistic midair grapple -> walkable landing');console.log('Ascent passed');
 await page.screenshot({path:`${out}/ascent-landing.png`});
 const route=[[184,-184],[184,-191],[189,-190],[211,-191],[220,-197],[220,-207],[220,-217],[203,-217],[203,-210],[184,-210],[177,-220],[177,-234],[175,-241],[177,-244],[205,-244],[205,-261],[205,-274],[229,-274],[229,-238],[248,-240],[251,-245],[256,-245],[256,-223],[265,-223],[265,-215],[241,-215]];
 for(let i=0;i<route.length;i++){
  await walk(...route[i]);const s=await state();if(s.sky.chimes.some((p,j)=>!s.sky.progress.chimes.includes(j)&&Math.hypot(s.pos.x-p.x,s.pos.z-p.z)<2.8&&Math.abs(s.pos.y-p.y)<3)){await page.keyboard.press('f');await page.waitForTimeout(180);}
  if([5,9,12,17,18,22].includes(i)){console.log('Walking checkpoint',i,await pos());await page.screenshot({path:`${out}/walk-${i}.png`});}
 }
 const sky=(await state()).sky;assert.equal(sky.progress.discovered.length,7);assert.equal(sky.progress.chimes.length,3);report.checks.push('complete walk-only city loop, all seven places, all three wind chimes');
 await walk(255,-215);await walk(263,-221);await captureSpecies('suncresteagle');
 await walk(263,-215);await walk(240,-215);await walk(238,-193);await captureSpecies('seraphlet');
 report.art=await page.evaluate(()=>window.__game.logistics().art);report.performance=await page.evaluate(()=>window.__game.renderStats());
 // Normal-mode persistence: collect, spend and reload real saved state.
 await page.goto(`${base}?fresh=1&quality=medium`);await page.waitForFunction(()=>!!window.__game,{timeout:120000});
 const readSave=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wildtag-save-v1')));
 for(const p of sky.chimes){await page.evaluate(p=>window.__game.player.teleport(p.x,p.y,p.z),p);await page.waitForTimeout(350);await page.keyboard.press('f');await page.waitForTimeout(180);}
 let saved=await readSave();assert.equal(saved.skyKingdom.chimes.length,3);const rewardRP=saved.inventory.rp;await page.keyboard.press('f');await page.waitForTimeout(200);assert.equal((await readSave()).inventory.rp,rewardRP);
 await page.evaluate(()=>window.__game.player.teleport(249,155,-244.5));await page.waitForTimeout(350);await page.keyboard.press('f');await page.waitForTimeout(200);saved=await readSave();assert.equal(saved.inventory.shard,15);assert(saved.skyKingdom.glassCooldowns[2]>40);
 const id=await page.evaluate(()=>{const g=window.__game,id=-88004;g.grant('charms',1);g.completeTracking(id);g.bond(id);g.save();return id;});
 await page.goto(`${base}?quality=medium`);await page.waitForFunction(()=>!!window.__game,{timeout:120000});await page.waitForTimeout(500);
 assert.equal((await pos()).y,155);assert.equal((await readSave()).skyKingdom.chimes.length,3);assert.equal((await readSave()).inventory.shard,15);assert(await page.evaluate(id=>window.__game.logistics().roster.some(c=>c.id===id),id));
 assert.equal(await page.locator('#dev-performance').count(),0);assert.equal(await page.evaluate(id=>window.__game.listCritters().some(c=>c.id===id),id),false);
 await page.keyboard.press('b');await page.getByRole('button',{name:'Release',exact:true}).click();await page.getByRole('button',{name:'Confirm?',exact:true}).click();await page.keyboard.press('Escape');
 await page.waitForFunction(id=>window.__game.listCritters().some(c=>c.id===id),id,{timeout:4000});assert((await page.evaluate(id=>window.__game.listCritters().find(c=>c.id===id).pos.y,id))>140);
 report.checks.push('normal save/reload preserves altitude, chimes, rewards, resource cooldown and bonded sky creature; release restores original sky home');
 assert.deepEqual(errors,[]);report.errors=errors;report.passed=true;writeFileSync(`${out}/gameplay-verification.json`,JSON.stringify(report,null,2));console.log('PASS sky kingdom',JSON.stringify(report.checks));
}catch(e){report.error=String(e);report.errors=errors;report.state=await state();report.creatures=await page.evaluate(()=>window.__game.listCritters());report.roster=await page.evaluate(()=>window.__game.logistics().roster);report.ui=await page.locator('body').innerText();writeFileSync(`${out}/gameplay-failure.json`,JSON.stringify(report,null,2));await page.screenshot({path:`${out}/gameplay-failure.png`});throw e;}finally{await browser.close();}
