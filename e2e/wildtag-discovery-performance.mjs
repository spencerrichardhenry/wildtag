import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const base=process.env.VERIFY_URL??'http://127.0.0.1:5209/wildtag/wildtag.html';
const label=process.env.AUDIT_LABEL??'final';
const mode=process.env.AUDIT_MODE??'all';
const frames=Number(process.env.AUDIT_FRAMES??360);
const coldRuns=Number(process.env.AUDIT_COLD_RUNS??3);
const out='docs/wildtag/discoveries';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal','--disable-frame-rate-limit']});
const report={label,uncapped:true,viewport:[1440,900],dpr:2,quality:'high',pairs:[],cold:[],errors:[]};
const median=a=>{const s=a.slice().sort((x,y)=>x-y),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
async function boot(query='',cold=false){
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
 await context.addInitScript(()=>{
  performance.setResourceTimingBufferSize(2500);
  let game;Object.defineProperty(window,'__game',{configurable:true,get:()=>game,set:g=>{game=g;window.__readyAt=performance.now();}});
  function readyFrame(){if(!game)return requestAnimationFrame(readyFrame);requestAnimationFrame(()=>{window.__firstFrameAt=performance.now();});}requestAnimationFrame(readyFrame);
  window.__saveWrites=[];
  const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){const t=performance.now();const result=write.call(this,k,v);if(k==='wildtag-save-v1')window.__saveWrites.push({ms:performance.now()-t,bytes:v.length});return result;};
 });
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 if(cold){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:20*1024*1024,uploadThroughput:5*1024*1024});}
 await page.goto(`${base}?dev=1&quality=high${query}`);
 await page.waitForFunction(()=>!!window.__game,{timeout:120000});
 return {page,context};
}
async function waitFrames(page,n){await page.evaluate(n=>new Promise(resolve=>{let count=0;function tick(){if(++count>=n)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),n);}
async function position(page,scene){
 await page.evaluate(scene=>{
  const g=window.__game;window.__wonders.freezeWorld(false);g.setTimeOfDay('day');
  const views={'haven':[76,g.groundY(76,-26)+.5,-26,.65,-.08],'castle-crown':[-427.7,121.1,-178.6,0,-.24],'atlantis-nave':[594,-15.65,659,Math.PI,.05],'sky-sanctuary':[229,155,-230,0,.08]};
  if(views[scene]){const [x,y,z,yaw,pitch]=views[scene];g.player.teleport(x,y,z);g.setLook(yaw,pitch);}
  else{const site=window.__wonders.sites.find(s=>s.id===scene);if(!site)throw Error(scene);const p=site.approach,t=site.focus;g.player.teleport(p.x,p.y,p.z);g.setLook(Math.atan2(p.x-t.x,p.z-t.z),Math.atan2(t.y-p.y-1.65,Math.hypot(t.x-p.x,t.z-p.z)));}
 },scene);
 await waitFrames(page,150);
 if(!['haven','castle-crown','atlantis-nave','sky-sanctuary'].includes(scene)){await page.keyboard.press('f');await waitFrames(page,8);}
 await page.evaluate(()=>window.__wonders.freezeWorld(true));
}
async function sample(page,enabled){
 await page.evaluate(enabled=>window.__wonders.presentation(enabled),enabled);await waitFrames(page,100);
 return page.evaluate(frames=>new Promise(resolve=>{
  const timing=[],gpu=[],sim=[],render=[],draws=[],tris=[];let last=performance.now();
  function tick(now){
   timing.push(now-last);last=now;const s=window.__game.renderStats(),p=s.performance;
   if(p.gpuMs!==null)gpu.push(p.gpuMs);sim.push(p.simulationMs);render.push(p.renderMs);draws.push(s.drawCalls);tris.push(s.triangles);
   if(timing.length<frames)return requestAnimationFrame(tick);
   const sorted=timing.slice(1).sort((a,b)=>a-b),mean=sorted.reduce((a,b)=>a+b,0)/sorted.length,median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
   resolve({fps:1000/mean,frameMs:mean,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],p99Ms:sorted[Math.ceil(sorted.length*.99)-1],over50Ms:sorted.filter(x=>x>50).length,gpuMs:median(gpu),simulationMs:median(sim),renderMs:median(render),drawCalls:median(draws),triangles:median(tris),state:window.__wonders.state()});
  }requestAnimationFrame(tick);
 }),frames);
}
try{
 if(mode==='all'||mode==='pairs'){
  const {page,context}=await boot();
  for(const scene of ['haven','castle-crown','atlantis-nave','sky-sanctuary','bumblepost','woodpecker','reed-organ','kite-garden']){
   await position(page,scene);const samples=[];
   // ABBA counterbalances temperature/drift; the world clock, creatures,
   // camera and animation pose are frozen throughout each comparison.
   for(const enabled of [true,false,false,true])samples.push({enabled,...await sample(page,enabled)});
   const summarize=enabled=>{const a=samples.filter(s=>s.enabled===enabled);return Object.fromEntries(['fps','frameMs','gpuMs','simulationMs','renderMs','drawCalls','triangles'].map(k=>[k,median(a.map(s=>s[k]))]));};
   report.pairs.push({scene,on:summarize(true),off:summarize(false),samples});console.log('PAIR',scene,JSON.stringify({on:summarize(true),off:summarize(false)}));
  }
  await context.close();
 }
 if(mode==='all'||mode==='cold'){
  report.network={cache:'disabled, fresh browser context per sample',latencyMs:20,downloadMiBps:20};
  for(let i=0;i<coldRuns;i++)for(const enabled of (i%2?[false,true]:[true,false])){
   const {page,context}=await boot(enabled?'':'&wonders=off',true);
   await page.waitForFunction(()=>!!window.__firstFrameAt);
   const result=await page.evaluate(()=>{
    const resources=performance.getEntriesByType('resource').filter(r=>r.responseEnd<=window.__readyAt),discoveries=resources.filter(r=>r.name.includes('/discovery_'));
    return {readyMs:window.__readyAt,firstFrameMs:window.__firstFrameAt,requests:resources.length,bytes:resources.reduce((n,r)=>n+r.encodedBodySize,0),discoveryRequests:discoveries.length,discoveryBytes:discoveries.reduce((n,r)=>n+r.encodedBodySize,0),heapBytes:performance.memory?.usedJSHeapSize,art:window.__game.logistics().art};
   });
   report.cold.push({run:i,enabled,...result});console.log('COLD',i,enabled,result.readyMs,result.discoveryRequests,result.discoveryBytes);await context.close();
  }
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{writeFileSync(`${out}/performance-audit-${label}-${mode}.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
