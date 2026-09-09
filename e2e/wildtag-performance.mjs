import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.VERIFY_URL ?? 'http://localhost:5199/wildtag.html';
const label = process.env.PERF_LABEL ?? 'after';
const software = process.env.PERF_GPU !== 'metal';
const legacy = process.env.PERF_LEGACY === '1';
const uncapped = process.env.PERF_UNCAPPED === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: [...(software ? ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
    : ['--enable-gpu', '--use-angle=metal']), ...(uncapped ? ['--disable-frame-rate-limit'] : [])] });
const dpr = Number(process.env.PERF_DPR ?? 1);
const scenario = process.env.PERF_SCENE ?? 'haven';
const frames = Number(process.env.PERF_FRAMES ?? 240);
const page = await browser.newPage({ viewport: {
  width: Number(process.env.PERF_WIDTH ?? 1440), height: Number(process.env.PERF_HEIGHT ?? 900),
}, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
mkdirSync('docs/wildtag', { recursive: true });
try {
  await page.goto(`${base}?dev=1&quality=${process.env.PERF_QUALITY ?? 'high'}${process.env.FORCE_FX ? '&forcefx=1' : ''}${process.env.PERF_QUERY ?? ''}`);
  await page.waitForFunction(() => !!window.__game, { timeout: 120000 });
  await page.evaluate(scenario => {
    const g = window.__game, d = g.logistics().depot;
    g.player.teleport(d.x + 8, d.y + .5, d.z + 10);
    g.setLook(.65, -.08);
    if (scenario === 'industry') {
      for (const site of g.logistics().deposits) {
        g.player.teleport(site.pos.x,site.pos.y+.5,site.pos.z+3);
        g.logisticsAction('survey',site.id); g.logisticsAction('build',site.id);
        const id=g.spawn('timberchomp',5);g.completeTracking(id);g.bond(id);g.assignHauler(site.id,id);
      }
      g.player.teleport(d.x+8,d.y+.5,d.z+10);g.setLook(.65,-.08);
    }
    if (scenario === 'forest') { g.player.teleport(160, g.groundY(160,-130)+.5, -130); g.setLook(-.5, -.08); }
    if (scenario === 'castle') { g.player.teleport(-424, g.groundY(-424,-65)+.5, -65); g.setLook(0, -.04); g.setTimeOfDay('night'); }
    if (scenario === 'lagoon') { window.__underwater.dive(); }
  }, scenario);
  if (!legacy) await page.locator('#dev-performance').waitFor();
  console.log('Game ready; warming up.');
  // Fixed frame counts give the two software-rendered runs the same warmup.
  await page.evaluate(() => new Promise(resolve => {
    let n = 0; function tick() { if (++n >= 90) resolve(); else requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }));
  const cdp = process.env.PERF_PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const result = await page.evaluate(({scenario, frames}) => new Promise(resolve => {
    const samples = []; let last = performance.now();
    function tick(now) {
      samples.push(now - last); last = now;
      if (scenario === 'traverse') {
        const g = window.__game, x = 76 + samples.length * .75, z = -26 - samples.length * .5;
        g.player.teleport(x, g.groundY(x,z) + 2, z); g.setLook(-1, -.15);
      }
      if (samples.length < frames) return requestAnimationFrame(tick);
      const sorted = samples.slice(1).sort((a, b) => a - b);
      const mean = samples.slice(1).reduce((a, b) => a + b, 0) / (samples.length - 1);
      const gl = document.querySelector('#game').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      resolve({ backend: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', viewport: [innerWidth, innerHeight], devicePixelRatio,
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        scenario, frameMs: mean, fps: 1000 / mean, p95Ms: sorted[Math.ceil(sorted.length*.95)-1], p99Ms: sorted[Math.ceil(sorted.length*.99)-1],
        over50Ms: sorted.filter(x=>x>50).length, samples: sorted.length,
        stats: window.__game.renderStats(), quality: window.__game.quality(),
        routes: scenario==='industry' ? window.__game.logistics().state.sites.map(s=>({id:s.id,built:s.built,worker:s.worker,phase:s.phase})) : undefined,
        overlay: document.querySelector('#dev-performance')?.textContent });
    }
    requestAnimationFrame(tick);
  }), {scenario, frames});
  if (cdp) {
    const {profile} = await cdp.send('Profiler.stop');
    mkdirSync('.codex-drafts', {recursive:true});
    writeFileSync(`.codex-drafts/performance-${label}.cpuprofile`, JSON.stringify(profile));
    const totals = new Map();
    for (let i=0;i<profile.samples.length;i++) totals.set(profile.samples[i], (totals.get(profile.samples[i])??0)+profile.timeDeltas[i]/1000);
    result.cpuProfile = profile.nodes.map(n=>({function:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1,selfMs:totals.get(n.id)??0}))
      .sort((a,b)=>b.selfMs-a.selfMs).slice(0,20);
  }
  if (!legacy) {
    assert(result.stats.performance.samples > 0);
    assert.match(result.overlay, /FPS/);
  }
  if (scenario==='industry') {
    assert.equal(result.routes.length,6);
    assert(result.routes.every(s=>s.built && s.worker!==null),'All six extractors and hauling jobs are active');
  }
  await page.screenshot({ path: `docs/wildtag/performance-${label}.png` });
  assert.deepEqual(errors, []);
  result.uncapped = uncapped;
  writeFileSync(`docs/wildtag/performance-${label}.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
