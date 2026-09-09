import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199/wildtag.html';
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page = await browser.newPage({viewport:{width:1280,height:800}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
page.on('console', msg=>{if(msg.type()==='error')errors.push(msg.text());});
const y = () => page.evaluate(()=>window.__game.player.pos().y);
const hold = async (key,ms=500) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
try {
  await page.goto(`${base}?dev=1&quality=high`);
  await page.waitForFunction(()=>!!window.__game,{timeout:120000});
  await page.locator('#game').click({position:{x:640,y:400}});
  await page.waitForFunction(()=>document.pointerLockElement?.id==='game');
  await page.evaluate(()=>window.__underwater.surface());
  await page.waitForTimeout(1000);
  const surface=await y();
  await hold('q',650); const down=await y();
  assert(down<surface-2,`Q descends: ${surface} -> ${down}`);
  await hold('e',300); const up=await y();
  assert(up>down+1,`E ascends: ${down} -> ${up}`);
  await hold('Control',350); const ctrl=await y();
  assert(Math.abs(ctrl-up)<.2,'Ctrl no longer descends');
  await hold('Space',350); const space=await y();
  assert(Math.abs(space-ctrl)<.2,'Space no longer ascends');
  await page.keyboard.down('q'); await hold('e',350); await page.keyboard.up('q');
  assert(Math.abs(await y()-space)<.3,'Q and E cancel when held together');
  await page.waitForTimeout(600);
  assert(Math.abs(await y()-space)<.3,'Releasing swim keys holds depth');
  assert.match(await page.locator('#dev-performance').innerText(), /\d+ FPS/);
  // Slow the fixed simulation to 6 Hz to make between-step camera motion
  // observable on this 60 Hz headless display. Physics positions stay discrete.
  await page.evaluate(()=>window.__game.setTimeScale(.1));
  await page.keyboard.down('q');
  const motion = await page.evaluate(()=>new Promise(resolve=>{
    const samples=[];
    function tick() {
      const g=window.__game;samples.push({feet:g.player.pos().y,eye:g.renderStats().view.y});
      if(samples.length===90)resolve(samples);else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));
  await page.keyboard.up('q');
  const betweenSteps=motion.slice(1).filter((s,i)=>s.feet===motion[i].feet && Math.abs(s.eye-motion[i].eye)>.0001);
  assert(betweenSteps.length>40,'The camera moves smoothly even on frames without a simulation step');
  await page.evaluate(()=>{const g=window.__game;g.player.teleport(50,g.groundY(50,0)+1,0);});
  await page.waitForTimeout(50);
  assert(Math.abs(await page.evaluate(()=>window.__game.renderStats().view.x)-50)<.5,'Teleport resets view interpolation');
  for (const size of [{width:960,height:600},{width:1440,height:900}]) {
    await page.setViewportSize(size); await page.waitForTimeout(250);
    const buffer = await page.evaluate(()=>{
      const gl=document.querySelector('#game').getContext('webgl2');
      return [gl.drawingBufferWidth,gl.drawingBufferHeight];
    });
    assert.deepEqual(buffer,[size.width,size.height],'Resizing keeps the full-resolution scene buffer');
  }
  // A normal session gets no overlay or per-frame CPU/GPU instrumentation.
  await page.goto(`${base}?fresh=1&quality=medium`);
  await page.waitForFunction(()=>!!window.__game,{timeout:120000});
  assert.equal(await page.locator('#dev-performance').count(),0);
  assert.equal(await page.evaluate(()=>window.__game.renderStats().performance),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS real pointer-lock Q/E swimming, old keys removed, smooth between-step camera, teleport reset, dev-only metrics.');
} finally { await browser.close(); }
