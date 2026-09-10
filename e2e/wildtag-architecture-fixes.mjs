import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';

const base=process.env.VERIFY_URL??'http://127.0.0.1:5209/wildtag/wildtag.html';
const out='docs/wildtag/architecture-fixes';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const report={checks:[],views:{},errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function fixture(place,p,t){
 await page.evaluate(({place,p,t})=>{
  const g=window.__game,c=window.__landmarks.layouts.find(l=>l.id===place).center;
  g.player.teleport(c.x+p[0],c.y+p[1],c.z+p[2]);
  g.setLook(Math.atan2(p[0]-t[0],p[2]-t[2]),Math.atan2(t[1]-p[1]-1.65,Math.hypot(t[0]-p[0],t[2]-p[2])));
 },{place,p,t});
 await page.waitForTimeout(300);
}
async function capture(name){
 await page.waitForTimeout(2200);
 await page.screenshot({path:`${out}/${name}.png`});
 report.views[name]=await page.evaluate(()=>window.__game.renderStats());
}
async function swim(place,target,duration=0){
 return page.evaluate(({place,target,duration})=>new Promise(resolve=>{
  const c=window.__landmarks.layouts.find(l=>l.id===place).center;
  const start=performance.now();let held=false;
  function tick(){
   const g=window.__game,p=g.player.pos(),dx=c.x+target[0]-p.x,dz=c.z+target[1]-p.z;
   if(Math.hypot(dx,dz)<.4||performance.now()-start>(duration||20000)){
    document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true}));
    return resolve({x:p.x-c.x,y:p.y-c.y,z:p.z-c.z,reached:Math.hypot(dx,dz)<.4});
   }
   g.setLook(Math.atan2(-dx,-dz),0);
   if(!held){document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));held=true;}
   requestAnimationFrame(tick);
  }requestAnimationFrame(tick);
 }),{place,target,duration});
}
async function refill(){await fixture('atlantis',[0,26,-60],[0,26,-50]);await page.waitForTimeout(1800);}
try{
 await page.goto(`${base}?dev=1&quality=high`);
 await page.waitForFunction(()=>!!window.__landmarks,{timeout:120000});
 await page.locator('#game').click({position:{x:900,y:600}});
 await page.waitForFunction(()=>document.pointerLockElement?.id==='game');
 await page.evaluate(()=>window.__game.setTimeOfDay('day'));
 const castleViews=[
  ['keep-roof',[0,20,0],[-15,18,-10]],
  ['keep-corner',[-7,20,1],[-10,20,-10]],
  ['library-roof',[-2.5,8,-61],[-15,8,-69]],
  ['forge-roof',[-62.5,8,-2.5],[-70,8,-14]],
  ['rampart',[70,8,-90],[0,8,-90]],
 ];
 for(const palette of ['cursed','purified']){
  if(palette==='purified'){await page.evaluate(()=>window.__game.purifyCrystal());await page.waitForFunction(()=>window.__game.state().castlePurified);}
  for(const [name,p,t] of castleViews){
   await fixture('castle',p,t);await capture(`${palette}-${name}`);
   const y=await page.evaluate(()=>window.__game.player.pos().y-window.__landmarks.layouts[0].center.y);
   assert(Math.abs(y-p[1])<.1,`${palette} ${name} stays walkable`);
  }
 }
 report.checks.push('Keep, library, forge and rampart roof joins inspected in cursed and purified palettes; all standing heights preserved');
 for(const [name,p,t] of [
  ['atlantis-foundation',[-12,1.2,-24],[-7,1.8,5]],
  ['atlantis-side',[-26,.8,0],[-14,1.3,12]],
  ['atlantis-crown-support',[19,5,60],[0,6,44]],
 ]){await refill();await fixture('atlantis',p,t);await capture(name);}
 await refill();await fixture('atlantis',[-22,.3,12],[-10,.3,12]);
 const blocked=await swim('atlantis',[-10,12],2400);assert(blocked.x<-17.3,JSON.stringify(blocked));
 report.checks.push('Nave foundation blocks swimming beneath the previously floating floor');
 for(const [start,end] of [[[0,6,-15],[0,5]],[[24,6,12],[0,12]],[[-20,6,44],[20,44]]]){
  await refill();await fixture('atlantis',start,[end[0],start[1],end[1]]);
  const result=await swim('atlantis',end);assert(result.reached,JSON.stringify(result));
 }
 report.checks.push('Normal swimming still passes through front and side nave doors and the observatory underpass');
 report.art=await page.evaluate(()=>window.__game.logistics().art);
 assert.deepEqual(report.art.failed,[]);assert.deepEqual(report.errors,[]);report.passed=true;
 console.log('PASS',report.checks);
}finally{
 writeFileSync(`${out}/verification.json`,JSON.stringify(report,null,2));await browser.close();
}
