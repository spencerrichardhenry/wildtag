import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, {recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await context.addInitScript(()=>{localStorage.setItem('tiny-tide-adventure-v1',JSON.stringify({stage:1,bites:0,total:10,elapsed:20,eatenPlanets:[],completed:false}));});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__tinyTide);
try {
 await page.goto(process.env.VERIFY_URL||'http://localhost:5199/tiny-tide.html?qa');await page.waitForFunction(()=>window.__tinyTide?.time>.4);await page.locator('#start').click();await page.waitForTimeout(600);
 const cdp=await context.newCDPSession(page);
 const center=async id=>{const b=await page.locator(id).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,radiusX:4,radiusY:4,force:1};};
 const j={...await center('#joystick'),id:1},rise={...await center('#special'),id:2};const before=await state();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[j]});
 j.x+=27;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[j]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[j,rise]});await page.waitForTimeout(550);
 const during=await state();assert.ok(during.player.x>before.player.x+1.2,'Joystick moves during Rise');assert.ok(during.player.y>before.player.y+1.2,'Two-finger Rise changes depth');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);const release=await state();await page.waitForTimeout(250);const hover=await state();assert.ok(Math.abs(hover.player.x-release.player.x)<.05);assert.ok(Math.abs(hover.player.y-release.player.y)<.05,'Releasing vertical controls hovers');
 const look={id:3,x:285,y:365,radiusX:4,radiusY:4,force:1};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[look]});look.x+=40;look.y-=70;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[look]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const looked=await state();assert.ok(looked.world.pitch<hover.world.pitch-.25,'Touch swipe looks up');assert.ok(looked.world.yaw<hover.world.yaw-.15,'Touch swipe turns camera');
 await page.screenshot({path:`${out}/mobile-swimming.png`});
 const dive={...await center('#dive'),id:4};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dive]});await page.waitForTimeout(350);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});const dived=await state();assert.ok(dived.player.y<looked.player.y-1,'Dive descends');await page.waitForTimeout(150);assert.ok(Math.abs((await state()).player.y-dived.player.y)<.05,'Cancelled touch releases Dive');
 for(const viewport of [{width:320,height:568},{width:844,height:390}]) {await page.setViewportSize(viewport);await page.waitForTimeout(200);for(const sel of ['#joystick','#chomp','#special','#dive','#pause']){const b=await page.locator(sel).boundingBox();assert.ok(b && b.x>=0 && b.y>=0 && b.x+b.width<=viewport.width+1 && b.y+b.height<=viewport.height+1,`${sel} fits ${viewport.width}x${viewport.height}`);}await page.screenshot({path:`${out}/mobile-${viewport.width}.png`});}
 assert.deepEqual(errors,[]);console.log('PASSED: genuine multitouch move + rise, swipe camera, stable hover, Dive, touch cancellation, 390/320 portrait and landscape control layout.');
} finally {await browser.close();}
