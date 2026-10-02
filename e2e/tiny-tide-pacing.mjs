// Tiny Tide pacing study (spec §12). A diagnostic, not a gate: it reports numbers and proposes nothing.
//
//   node e2e/tiny-tide-pacing.mjs                       all 24 runs, 4 at a time, then 4 calibration runs one at a time
//   node e2e/tiny-tide-pacing.mjs --runs darter:11:none,bulk:12:sensible   only these runs (no calibration); a separate
//                                                       output: pacing-subset.json, pacing-subset.md, pacing-runs-subset/
//   node e2e/tiny-tide-pacing.mjs --parallel 2 --no-calibrate
//   node e2e/tiny-tide-pacing.mjs --summarize           rebuild pacing.json and the tables from the saved run files
//   node e2e/tiny-tide-pacing.mjs --summarize --subset  the same for the --runs output
//   node e2e/tiny-tide-pacing.mjs --run darter:11:none --out file.json   one run in this process (the study starts runs like this)
//   node e2e/tiny-tide-pacing.mjs --help
// A study first deletes the old run files of the directory it writes. The process exits with code 1 when a run did not finish.
//
// Each run is the journey bot (e2e/tiny-tide.mjs) from a fresh fixture save at the seed: Snapper at size 1, Beak at size 2,
// in both policies. `sensible` also buys a fixed shopping list once per item, when affordable and free of problems.
// A read-only sampler reads `window.__tinyTide` on every animation frame and integrates the game clock per size and mode.
// Output: .codex-drafts/tiny-tide-qa/pacing.json, pacing.md (the tables) and pacing-runs/<run>.json (+ .log).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { control, launch, makeFixture, openGame, start, state, watchErrors } from './fixtures/tiny-tide-fixtures.mjs';

const BRANCHES = {
  darter: ['swimmer', 'darter', 'sky_drifter', 'star_swimmer'],
  bulk: ['swimmer', 'bulk', 'sky_drifter', 'star_swimmer'],
  shellback: ['crawler', 'shellback', 'colossus', 'star_crawler'],
  burrower: ['crawler', 'burrower', 'colossus', 'star_crawler'],
};
const SEEDS = [11, 12, 13], POLICIES = ['none', 'sensible'];
/** The `sensible` shopping list, keyed by the plan the creature has at that size. Each item at most once. */
const SHOPPING = {
  swimmer: [{ id: 'fin_side', label: 'Side fin pair (middle)' }],
  crawler: [{ id: 'spike', label: 'Spike (middle)' }],
  darter: [{ id: 'tail_fan', replace: 'tail_paddle', label: 'Fan tail replaces Paddle' }],
  bulk: [{ id: 'shell_plate', label: 'Shell plate (middle)' }],
  shellback: [{ id: 'shell_plate', label: 'Shell plate (middle)' }],
  burrower: [{ id: 'cloak_fronds', label: 'Cloak fronds (middle)' }],
  sky_drifter: [{ id: 'wing_feather', label: 'Feather wing pair' }],
  colossus: [{ id: 'tower', label: 'Tower' }],
};
/** Watch bands (not gates), in seconds of active time. Size 4 (Cosmic) is measured separately. */
const BANDS = { 0: [45, 120], 1: [60, 240], 2: [60, 240], 3: [60, 240] };
const KNOWN_LIMITS = [
  'A single Spike at size 1 gives no mitigation: damage after armor is max(1, damage − floor(armor / 2)), and one Spike is armor 1.',
  "Shellback's Shell plate adds armor that today's hazards cannot use: Shellback already has armor 4 or more (2 from parts, +2 plan), so every hit already costs the 1-point minimum.",
  'The shopping lists are reference builds, not optimal ones.',
  'The bot is the journey bot, not a person. It eats the nearest approachable food of its diet and does not flee hunters.',
  'Wall time depends on machine load. Compare the calibration runs (one at a time) with the same runs in the parallel batch.',
];
const MAX_RUN_MINUTES = 90;

const args = process.argv.slice(2), arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l, i, all) => all.slice(0, i + 1).every(x => x.startsWith('//'))).map(l => l.slice(3)).join('\n'));
  process.exit(0);
}
const VALUE_FLAGS = ['--runs', '--parallel', '--run', '--out'], SWITCHES = ['--no-calibrate', '--summarize', '--subset', '--serial'];
for (let i = 0; i < args.length; i++) {
  if (VALUE_FLAGS.includes(args[i])) { if (args[i + 1] === undefined || args[i + 1].startsWith('--')) { console.error(`${args[i]} needs a value (see --help)`); process.exit(2); } i++; }
  else if (!SWITCHES.includes(args[i])) { console.error(`Unknown argument "${args[i]}" (see --help)`); process.exit(2); }
}
if (arg('--parallel') !== undefined && !(Number.isInteger(Number(arg('--parallel'))) && Number(arg('--parallel')) > 0)) { console.error('--parallel needs a positive integer'); process.exit(2); }
/** A `--runs` subset writes its own files, so it never mixes with or overwrites the full study. */
const SUBSET = !!arg('--runs') || args.includes('--subset');
const OUT = '.codex-drafts/tiny-tide-qa', RUNS_DIR = `${OUT}/pacing-runs${SUBSET ? '-subset' : ''}`, REPORT = `${OUT}/pacing${SUBSET ? '-subset' : ''}`;
const parseRun = text => { const [branch, seed, policy] = text.split(':'); if (!BRANCHES[branch] || !POLICIES.includes(policy) || !Number.isInteger(Number(seed))) throw new Error(`bad run "${text}" (branch:seed:policy)`); return { branch, seed: Number(seed), policy }; };
const runId = (r, serial = false) => `${r.branch}-${r.seed}-${r.policy}${serial ? '-serial' : ''}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (arg('--run')) await child(parseRun(arg('--run')), arg('--out'));
else if (args.includes('--summarize')) summarize();
else await study();

// ---------------------------------------------------------------- the study (orchestrator)

async function study() {
  mkdirSync(RUNS_DIR, { recursive: true });
  // Old run files (earlier studies, trials, failed runs) would otherwise enter the summary.
  for (const f of readdirSync(RUNS_DIR)) if (/\.(json|log)$/.test(f)) unlinkSync(`${RUNS_DIR}/${f}`);
  const parallel = Number(arg('--parallel') ?? 4);
  const runs = arg('--runs') ? arg('--runs').split(',').map(parseRun)
    : Object.keys(BRANCHES).flatMap(branch => SEEDS.flatMap(seed => POLICIES.map(policy => ({ branch, seed, policy }))));
  const calibrate = !arg('--runs') && !args.includes('--no-calibrate');
  console.log(`Pacing study: ${runs.length} runs, ${parallel} at a time${calibrate ? ', then 4 calibration runs one at a time' : ''}.`);
  const started = Date.now();
  await pool(runs.map(r => () => spawnRun(r, false)), parallel);
  if (calibrate) for (const branch of Object.keys(BRANCHES)) await spawnRun({ branch, seed: 11, policy: 'none' }, true);
  console.log(`Study wall time: ${((Date.now() - started) / 60000).toFixed(1)} min.`);
  summarize();
}
async function pool(jobs, size) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => { while (next < jobs.length) await jobs[next++](); }));
}
function spawnRun(r, serial) {
  const id = runId(r, serial), out = `${RUNS_DIR}/${id}.json`, log = createWriteStream(`${RUNS_DIR}/${id}.log`);
  const t0 = Date.now(); console.log(`start ${id}`);
  return new Promise(resolve => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run', `${r.branch}:${r.seed}:${r.policy}`, '--out', out, ...(serial ? ['--serial'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(log); p.stderr.pipe(log);
    const kill = setTimeout(() => p.kill('SIGKILL'), (MAX_RUN_MINUTES + 5) * 60000);
    p.on('exit', code => {
      clearTimeout(kill);
      let status = `exit ${code}`; try { const j = JSON.parse(readFileSync(out, 'utf8')); status = j.completed ? 'completed' : `incomplete at size ${j.stageReached}: ${j.error}`; } catch { /* no result file */ }
      console.log(`done  ${id} in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${status}`); resolve();
    });
  });
}

// ---------------------------------------------------------------- one run (child)

/** Read-only sampler: integrates the game clock (`time`) per size and mode on every animation frame. It never changes game state. */
async function installSampler(page) {
  await page.evaluate(async () => {
    const [st, sp, pl, rg, gn] = await Promise.all(['state', 'species', 'plans', 'registries', 'genome'].map(m => import(`/src/tiny-tide/${m}.ts`)));
    const P = window.__pacing = { sizes: {}, meals: [], hits: [], frames: 0 };
    const size = k => P.sizes[k] ??= { game: {}, wall: {}, active: 0, travel: 0, feeding: 0, contact: 0, food: {}, meals: 0, mealDna: 0, otherDna: 0, forageExtra: 0, hits: 0, damage: 0, armorPrevented: 0, faints: 0 };
    const specOf = (tier, kind) => sp.SPECIES.find(x => x.tier === tier && x.kind === kind);
    let last = null, key = '', derived = null;
    const tick = () => {
      requestAnimationFrame(tick);
      const s = window.__tinyTide; if (!s || s.mode === 'menu') return;
      const now = performance.now(), plan = pl.plan(s.plan);
      const k = s.plan + JSON.stringify(s.genome.parts.map(p => [p.id, p.scale, p.mirror]));
      if (k !== key) { key = k; derived = gn.derive(gn.effectiveStats(s.genome, plan)); }
      const playing = s.mode === 'playing';
      const feeding = playing && s.foods.some(f => !f.eaten && st.dietCanEat(s.diet, f.tag) && st.inReach(s.stage, s.player, f, s.growth, derived.reach));
      const cur = { time: s.time, now, mode: s.mode, stage: s.stage, plan: s.plan, diet: s.diet, contactNow: s.contactNow, feeding, bites: s.bites, totalDna: s.totalDna,
        acceptedHits: s.acceptedHits, deaths: s.deaths, health: s.health, armor: derived.armor, player: s.player, hazards: s.hazardSources,
        foods: s.foods.map(f => ({ id: f.id, kind: f.kind, tier: f.tier, x: f.x, y: f.y, z: f.z })) };
      P.frames++;
      if (last) {
        const a = size(last.stage), dt = Math.max(0, cur.time - last.time), dw = (now - last.now) / 1000;
        a.game[last.mode] = (a.game[last.mode] ?? 0) + dt; a.wall[last.mode] = (a.wall[last.mode] ?? 0) + dw;
        if (last.mode === 'playing') { a.active += dt; if (last.contactNow) a.contact += dt; if (last.feeding) a.feeding += dt; else a.travel += dt; }
        const b = size(last.stage), dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        // Meals: the foods that disappeared on the frame the bite count rose (nearest to the player first).
        const bites = cur.bites - last.bites; let mealDna = 0;
        if (bites > 0 && cur.stage === last.stage) {
          const gone = last.foods.filter(f => !cur.foods.some(g => g.id === f.id)).sort((p, q) => dist(p, last.player) - dist(q, last.player)).slice(0, bites);
          for (const f of gone) {
            const spec = specOf(f.tier, f.kind); if (!spec) continue;
            const dna = st.mealDna(plan, last.diet, spec), base = st.dnaFor(last.diet, spec);
            b.meals++; b.food[f.kind] = (b.food[f.kind] ?? 0) + 1; b.forageExtra += dna - base; mealDna += dna;
            P.meals.push({ stage: last.stage, id: f.id, kind: f.kind, tier: f.tier, dna, forageExtra: dna - base, time: cur.time });
          }
        }
        const gained = cur.totalDna - last.totalDna; if (gained > 0) { b.mealDna += Math.min(gained, mealDna); b.otherDna += Math.max(0, gained - mealDna); }
        // Accepted hits: the raw damage of the nearest hazard source; armor prevention = raw − damageAfterArmor(raw, armor).
        const hits = cur.acceptedHits >= last.acceptedHits ? cur.acceptedHits - last.acceptedHits : cur.acceptedHits;
        for (let i = 0; i < hits; i++) {
          const src = [...(last.hazards ?? [])].sort((p, q) => dist(p, last.player) - dist(q, last.player))[0];
          const spec = src && sp.SPECIES.find(x => x.key === src.key), raw = spec?.contactHazardId ? rg.HAZARDS[spec.contactHazardId]?.damage : undefined;
          const taken = raw === undefined ? Math.max(0, last.health - cur.health) : st.damageAfterArmor(raw, last.armor);
          b.hits++; b.damage += taken; if (raw !== undefined) b.armorPrevented += raw - taken;
          P.hits.push({ stage: last.stage, source: src?.key ?? null, raw: raw ?? null, armor: last.armor, taken, time: cur.time });
        }
        if (cur.deaths > last.deaths) b.faints += cur.deaths - last.deaths;
      }
      last = cur;
    };
    tick();
  });
}

async function child(r, outFile = `${RUNS_DIR}/${runId(r)}.json`) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const LINE = BRANCHES[r.branch], serial = args.includes('--serial');
  const result = { ...r, serial, path: ['speck', ...LINE], completed: false, stageReached: 0, error: null, startedAt: new Date().toISOString(),
    wallSeconds: 0, wallBySize: {}, purchases: [], skipped: [], evolutions: [], verticalTargets: [], sampler: null, errors: [] };
  const t0 = Date.now(), deadline = t0 + MAX_RUN_MINUTES * 60000;
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const errors = watchErrors(page);
  const vertical = new Set(), bought = new Set(), stageWall = {};
  let lastStage = 0, stageStart = Date.now(), s = null;
  const wallMark = st => { if (st !== lastStage) { stageWall[lastStage] = (stageWall[lastStage] ?? 0) + (Date.now() - stageStart) / 1000; stageStart = Date.now(); lastStage = st; } };
  const shopInfo = {};
  try {
    const fixture = await makeFixture(page, { seed: r.seed, stage: 0 });
    await openGame(page, { storage: { [fixture.key]: fixture.json } });
    await installSampler(page);
    await start(page);
    let targetId = null, approach = { best: Infinity, since: 0 }, retryEvolveAt = -Infinity, loops = 0;
    const skipped = new Map(), retryShopAt = new Map();
    while (!(s = await state(page)).completed) {
      if (Date.now() > deadline) throw new Error(`not finished within ${MAX_RUN_MINUTES} min of wall time`);
      loops++; wallMark(s.stage); result.stageReached = s.stage;
      if (s.mode === 'fainted') { await control(page, []); await page.waitForFunction(() => window.__tinyTide.mode !== 'fainted', {}, { timeout: 60000 }); continue; }
      if (s.mode === 'evolving') { await control(page, []); await page.waitForFunction(() => window.__tinyTide.mode !== 'evolving', {}, { timeout: 60000 }); targetId = null; continue; }
      if (s.mode !== 'playing') { await page.waitForTimeout(100); continue; }
      if (s.evolveReady && s.time >= retryEvolveAt) {
        const ok = await evolve(page, s, LINE, result);
        if (!ok) retryEvolveAt = s.time + 15;
        targetId = null; continue;
      }
      if (r.policy === 'sensible') {
        const item = (SHOPPING[s.plan] ?? []).find(x => !bought.has(`${s.plan}:${x.id}`) && !(retryShopAt.get(`${s.plan}:${x.id}`) > s.time));
        if (item) {
          const info = shopInfo[item.id] ??= await page.evaluate(id => import('/src/tiny-tide/parts.ts').then(m => { const p = m.part(id); return { kind: p.kind, cost: p.cost * (p.mirror ? 2 : 1), name: p.name }; }), item.id);
          if (s.dna >= info.cost) {
            const outcome = await buy(page, s, item, info, result);
            if (outcome === 'retry') retryShopAt.set(`${s.plan}:${item.id}`, s.time + 10); else bought.add(`${s.plan}:${item.id}`);
            targetId = null; continue;
          }
        }
      }
      // The journey bot: the nearest approachable food of the diet. A target whose distance has not dropped by .5 in 3 s is skipped for 12 s.
      const edible = s.foods.filter(f => !f.eaten && f.approachable === true && !(skipped.get(f.id) > s.time) && (f.tag === 'any' || s.diet === 'omnivore' || (s.diet === 'herbivore') === (f.tag === 'plant')));
      const reach = f => Math.hypot(f.x - s.player.x, f.z - s.player.z) + Math.abs(f.y - s.player.y);
      const sorted = edible.sort((a, b) => reach(a) - reach(b));
      let f = sorted.find(x => x.id === targetId);
      if (f && reach(f) < approach.best - .5) approach = { best: reach(f), since: s.time };
      else if (f && s.time - approach.since > 3) { skipped.set(f.id, s.time + 12); f = undefined; }
      if (!f) { f = sorted.find(x => x.id !== targetId); targetId = f?.id; approach = { best: f ? reach(f) : Infinity, since: s.time }; }
      if (!f) { await control(page, []); await page.waitForTimeout(200); continue; }
      const dx = f.x - s.player.x, dz = f.z - s.player.z, distance = Math.hypot(dx, dz);
      const desired = ['Space']; if (distance > 1.05) { const yaw = s.world.yaw, lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz, lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz; if (lx > .55) desired.push('KeyD'); if (lx < -.55) desired.push('KeyA'); if (lz > .55) desired.push('KeyS'); if (lz < -.55) desired.push('KeyW'); }
      // Vertical access for the target: Breach only when the plan can Breach; Rise and Dive only when it can rise.
      let up = false;
      if (s.caps.breach && s.arc === null && ((f.kind === 'bird' && distance < 2.5) || (f.y - s.player.y > 1.6 && distance < 3))) { await page.keyboard.press('KeyE'); up = true; }
      if (s.caps.rise && !s.caps.breach && f.y - s.player.y > .8) { desired.push('KeyE'); up = true; }
      if (s.caps.dive && s.arc === null && s.player.y - f.y > .8) { desired.push('KeyQ'); up = true; }
      if (up) vertical.add(`${s.stage}:${f.id}`);
      await control(page, desired); await page.waitForTimeout(130);
      if (loops % 300 === 0) console.log('progress', { stage: s.stage, plan: s.plan, stageDna: s.stageDna, goal: s.goal, dna: s.dna, active: Math.round(s.elapsed), wallMin: ((Date.now() - t0) / 60000).toFixed(1) });
    }
    await control(page, []);
    wallMark(5); result.completed = true; result.stageReached = 4;
  } catch (error) {
    result.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
    wallMark(-1); console.log('run ended early:', result.error);
  } finally {
    result.wallSeconds = (Date.now() - t0) / 1000; result.wallBySize = stageWall;
    result.sampler = await page.evaluate(() => window.__pacing ?? null).catch(() => null);
    result.final = s ? { stage: s.stage, plan: s.plan, elapsed: s.elapsed, deaths: s.deaths, eatenPlanets: s.eatenPlanets?.length, dna: s.dna, totalDna: s.totalDna, genome: s.genome.parts.map(p => p.id) } : null;
    result.verticalTargets = [...vertical]; result.errors = errors.slice(0, 20);
    writeFileSync(outFile, JSON.stringify(result, null, 2));
    await browser.close();
  }
  console.log(result.completed ? `PACING RUN COMPLETE: ${runId(r)}` : `PACING RUN INCOMPLETE: ${runId(r)}: ${result.error}`);
}

/** Path screen → this line's plan → the editor: Snapper at size 1, Beak at size 2 (both policies), Fix for me when shown. */
async function evolve(page, s, LINE, result) {
  const next = LINE[s.stage], record = { from: s.plan, to: next, size: s.stage + 1, walletBefore: s.dna, time: s.time };
  await control(page, []);
  await page.locator('#evolve').waitFor({ state: 'visible', timeout: 10000 }); await page.locator('#evolve').click();
  await page.locator('#path-screen').waitFor();
  await page.locator(`#path-screen [data-plan=${next}] .path-choose`).click();
  await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
  const mouth = s.stage === 0 ? 'mouth_snapper' : s.stage === 1 ? 'mouth_beak' : null;
  if (mouth) { await page.locator('#editor [data-tab=parts]').click(); await page.locator('#editor [data-kind=mouth]').click(); await page.locator(`#editor .ed-card[data-part=${mouth}]`).click(); }
  if (await page.locator('#editor .ed-fix').isVisible()) await page.locator('#editor .ed-fix').click();
  record.changes = (await page.locator('#editor .ed-changes').textContent().catch(() => '') ?? '').replace(/\s+/g, ' ').trim();
  if (await page.locator('#editor .ed-done').isDisabled()) {
    record.blocked = (await page.locator('#editor .ed-problem-line').textContent().catch(() => '')) || 'Done disabled';
    result.evolutions.push(record); console.log('evolution blocked', record);
    await page.locator('#editor .ed-cancel').click(); await page.locator('#path-screen').waitFor();
    await page.locator('#path-screen .path-later').click();
    await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
    return false;
  }
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__tinyTide.mode !== 'editing', {}, { timeout: 15000 });
  const after = await state(page);
  Object.assign(record, { walletAfter: after.dna, mandatoryNet: s.dna - after.dna, parts: after.genome.parts.map(p => p.id) });
  result.evolutions.push(record); console.log('evolved', record.from, '→', record.to, 'net DNA', record.mandatoryNet);
  return true;
}

/** One shopping item through the edit editor with real input (keyboard quick-add on the card). 'done' | 'skip' | 'retry'. */
async function buy(page, s, item, info, result) {
  const entry = { item: item.label, id: item.id, size: s.stage, plan: s.plan, walletBefore: s.dna, time: s.time };
  await control(page, []);
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.waitForTimeout(300);
  const cancel = async (reason, outcome) => {
    if (await page.locator('#editor .ed-confirm').isVisible()) await page.locator('#editor .ed-confirm-no').click();
    await page.locator('#editor .ed-cancel').click(); await page.locator('#editor').waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
    result.skipped.push({ ...entry, reason, outcome }); console.log('purchase skipped', item.label, reason); return outcome;
  };
  await page.locator('#editor [data-tab=parts]').click();
  await page.locator(`#editor .ed-kinds [data-kind=${info.kind}]`).click();
  const card = page.locator(`#editor .ed-card[data-part=${item.id}]`);
  if (await card.isDisabled()) return cancel(await card.getAttribute('data-reason') ?? 'card disabled', 'skip');
  await card.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  if (await page.locator('#editor .ed-confirm').isVisible()) return cancel('only room for one of the pair', 'skip');
  const hint = (await page.locator('#editor .ed-hint').textContent()) ?? '';
  if (!/added/i.test(hint)) return cancel(hint || 'not placed', /DNA/.test(hint) ? 'retry' : 'skip');
  if (item.replace) {
    const uid = s.genome.parts.find(p => p.id === item.replace)?.uid;
    let removed = !uid;
    for (let i = 0; i < 8 && !removed; i++) {
      const pt = await page.evaluate(u => window.__tinyTide.editorProjection(u), uid);
      if (pt) {
        await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(150);
        if ((await page.locator('#editor .ed-view').getAttribute('data-selected'))?.startsWith(`${uid}|`)) { await page.keyboard.press('Delete'); await page.waitForTimeout(150); removed = true; break; }
      }
      // Turn the model a little with a right drag and look again.
      const box = await page.locator('#editor .ed-view').boundingBox();
      await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5); await page.mouse.down({ button: 'right' });
      await page.mouse.move(box.x + box.width * .6 - 60, box.y + box.height * .5, { steps: 6 }); await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(150);
    }
    if (!removed) entry.note = `could not select the ${item.replace}; it stays`;
  }
  if (await page.locator('#editor .ed-done').isDisabled()) {
    const problem = (await page.locator('#editor .ed-problem-line').textContent().catch(() => '')) || 'Done disabled';
    return cancel(problem, /DNA/.test(problem) ? 'retry' : 'skip');
  }
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
  const after = await state(page);
  Object.assign(entry, { walletAfter: after.dna, spent: s.dna - after.dna, installed: after.genome.parts.some(p => p.id === item.id),
    replaced: item.replace ? !after.genome.parts.some(p => p.id === item.replace) : undefined });
  result.purchases.push(entry); console.log('bought', item.label, 'for', entry.spent, 'DNA');
  return 'done';
}

// ---------------------------------------------------------------- summary

function summarize() {
  if (!existsSync(RUNS_DIR)) throw new Error(`no runs in ${RUNS_DIR}`);
  const files = readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort();
  const all = files.map(f => JSON.parse(readFileSync(`${RUNS_DIR}/${f}`, 'utf8')));
  const runs = all.filter(r => !r.serial), calibration = all.filter(r => r.serial);
  const perRun = r => {
    const verticalSet = new Set(r.verticalTargets ?? []);
    const sizes = [0, 1, 2, 3, 4].map(k => {
      const a = r.sampler?.sizes?.[k]; if (!a) return null;
      const meals = (r.sampler.meals ?? []).filter(m => m.stage === k);
      const editorWall = a.wall.editing ?? 0, wall = Object.values(a.wall).reduce((x, y) => x + y, 0);
      return { size: k, plan: r.path[k], active: a.active, editorWall, wall, evolvingGame: a.game.evolving ?? 0, faintedGame: a.game.fainted ?? 0,
        travel: a.travel, feeding: a.feeding, contact: a.contact, food: a.food, meals: a.meals, mealDna: a.mealDna, otherDna: a.otherDna,
        forageExtra: a.forageExtra, hits: a.hits, damage: a.damage, armorPrevented: a.armorPrevented, faints: a.faints,
        verticalMeals: meals.filter(m => verticalSet.has(`${k}:${m.id}`)).length,
        purchases: (r.purchases ?? []).filter(p => p.size === k).map(p => ({ item: p.item, spent: p.spent, note: p.note })),
        skipped: (r.skipped ?? []).filter(p => p.size === k).map(p => ({ item: p.item, reason: p.reason })),
        evolution: (r.evolutions ?? []).filter(e => e.size === k + 1 && !e.blocked).map(e => ({ to: e.to, mandatoryNet: e.mandatoryNet, changes: e.changes }))[0] ?? null,
        blockedEvolutions: (r.evolutions ?? []).filter(e => e.size === k + 1 && e.blocked).length,
        complete: r.completed || r.stageReached > k };
    });
    const total = sizes.filter(Boolean).reduce((x, z) => x + z.active, 0);
    return { id: runId(r, r.serial), branch: r.branch, seed: r.seed, policy: r.policy, completed: r.completed, stageReached: r.stageReached, error: r.error,
      wallSeconds: r.wallSeconds, activeTotal: total, activeSizes0to3: sizes.slice(0, 4).filter(Boolean).reduce((x, z) => x + z.active, 0), sizes, pageErrors: r.errors?.length ?? 0 };
  };
  const rows = runs.map(perRun), calib = calibration.map(perRun);
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const stat = xs => xs.length ? { mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length } : null;
  const branches = {};
  for (const branch of Object.keys(BRANCHES)) {
    const b = branches[branch] = { path: ['speck', ...BRANCHES[branch]], sizes: [], T: {} };
    for (const k of [0, 1, 2, 3, 4]) {
      const row = { size: k, plan: b.path[k] };
      for (const policy of POLICIES) {
        const zs = rows.filter(r => r.branch === branch && r.policy === policy).map(r => r.sizes[k]).filter(z => z && z.complete);
        const sum = key => stat(zs.map(z => z[key]));
        const food = {}; for (const z of zs) for (const [kind, n] of Object.entries(z.food)) food[kind] = (food[kind] ?? 0) + n;
        row[policy] = zs.length ? { runs: zs.length, active: sum('active'), editorWall: sum('editorWall'), wall: sum('wall'), travel: sum('travel'), feeding: sum('feeding'), contact: sum('contact'),
          damage: sum('damage'), hits: sum('hits'), faints: sum('faints'), armorPrevented: sum('armorPrevented'), forageExtra: sum('forageExtra'), verticalMeals: sum('verticalMeals'), meals: sum('meals'),
          foodMix: food, purchases: zs.flatMap(z => z.purchases), skipped: zs.flatMap(z => z.skipped),
          mandatoryNet: stat(zs.map(z => z.evolution?.mandatoryNet).filter(x => typeof x === 'number')),
          band: k in BANDS ? bandOf(mean(zs.map(z => z.active)), BANDS[k]) : 'separate' } : null;
      }
      b.sizes.push(row);
    }
    for (const policy of POLICIES) {
      const done = rows.filter(r => r.branch === branch && r.policy === policy && r.completed);
      b.T[policy] = { completedRuns: done.length, of: rows.filter(r => r.branch === branch && r.policy === policy).length, all: stat(done.map(r => r.activeTotal)), sizes0to3: stat(done.map(r => r.activeSizes0to3)) };
    }
    const ratio = key => b.T.none[key] && b.T.sensible[key] ? b.T.none[key].mean / b.T.sensible[key].mean : null;
    b.T.ratioAll = ratio('all'); b.T.ratioSizes0to3 = ratio('sizes0to3');
  }
  const calibrationRows = calib.map(c => {
    const twin = rows.find(r => r.branch === c.branch && r.seed === c.seed && r.policy === c.policy);
    return { id: c.id, serialWall: c.wallSeconds, serialActive: c.activeTotal, parallelWall: twin?.wallSeconds ?? null, parallelActive: twin?.activeTotal ?? null,
      wallPerActiveSerial: c.wallSeconds / Math.max(1, c.activeTotal), wallPerActiveParallel: twin ? twin.wallSeconds / Math.max(1, twin.activeTotal) : null, completed: c.completed };
  });
  let commit = null; try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
  const report = { generatedAt: new Date().toISOString(), commit, seeds: SEEDS, policies: POLICIES, shopping: SHOPPING, bands: { ...BANDS, 4: 'separate' }, knownLimits: KNOWN_LIMITS,
    definitions: {
      active: 'game seconds in mode playing (run.elapsed advances in this mode only)', editorWall: 'real seconds in mode editing (path screen, evolve editor and purchase edits; the game clock stops)',
      wall: 'real seconds in all modes at this size', travel: 'active seconds with no food of the diet in bite reach (inReach with the effective reach)', feeding: 'active seconds with a food of the diet in bite reach',
      contact: 'active seconds with contactNow true (a contact on the current frame)', damage: 'approximate hearts lost to accepted hits: derived, not observed — damageAfterArmor(raw, armor) with the raw damage of the hazard source nearest the player',
      armorPrevented: 'approximate: derived, not observed — raw damage of the nearest hazard source minus damageAfterArmor(raw, armor)',
      meals: 'a meal is a food that disappears on the frame the bite count rises (nearest to the player first, as many as the bite increase); a food that disappears on a later frame is not counted',
      forageExtra: 'mealDna − dnaFor (the plan foraging bonus)', verticalMeals: "meals of a target for which the bot itself used Rise, Breach or Dive because of the target's height (not a game measure)",
      mandatoryNet: 'wallet before the path screen minus wallet after the evolution (Snapper/Beak, Fix for me, refunds)', T: 'mean total active seconds of completed runs' },
    runs: rows, calibration: calibrationRows, branches };
  writeFileSync(`${REPORT}.json`, JSON.stringify(report, null, 2));
  const md = tables(report); writeFileSync(`${REPORT}.md`, md);
  console.log(md);
  const unfinished = [...rows, ...calib].filter(r => !r.completed);
  if (unfinished.length) { console.error(`${unfinished.length} run(s) did not finish: ${unfinished.map(r => r.id).join(', ')}`); process.exitCode = 1; }
}
function bandOf(x, [lo, hi]) { return x === null ? '—' : x < lo ? 'below' : x > hi ? 'above' : 'in'; }
function tables(report) {
  const f = (x, d = 0) => x === null || x === undefined ? '—' : Number(x).toFixed(d);
  const ms = s => s ? `${f(s.mean)} (${f(s.min)}–${f(s.max)})` : '—';
  const out = [`# Tiny Tide pacing baseline`, '', `Commit ${report.commit}, ${report.generatedAt}. Seeds ${report.seeds.join(', ')}. Times are seconds; "a (b–c)" is mean (min–max) over the completed runs.`, ''];
  for (const [name, b] of Object.entries(report.branches)) {
    out.push(`## ${name[0].toUpperCase() + name.slice(1)} (${b.path.join(' → ')})`, '');
    out.push('| Size | Policy | Runs | Active | Band | Editor (real) | Wall | Travel / feeding | Contact | Damage / faints | Armor prevented | Forage +DNA | Vertical meals | Evolve DNA |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of b.sizes) for (const policy of POLICIES) {
      const x = row[policy];
      if (!x) { out.push(`| ${row.size} ${row.plan} | ${policy} | 0 | — | — | — | — | — | — | — | — | — | — | — |`); continue; }
      out.push(`| ${row.size} ${row.plan} | ${policy} | ${x.runs} | ${ms(x.active)} | ${x.band} | ${f(x.editorWall.mean)} | ${f(x.wall.mean)} | ${f(x.travel.mean)} / ${f(x.feeding.mean)} | ${f(x.contact.mean, 1)} | ${f(x.damage.mean, 1)} / ${f(x.faints.mean, 1)} | ${f(x.armorPrevented.mean, 1)} | ${f(x.forageExtra.mean)} | ${f(x.verticalMeals.mean, 1)} | ${x.mandatoryNet ? f(x.mandatoryNet.mean) : '—'} |`);
    }
    out.push('');
    for (const row of b.sizes) for (const policy of POLICIES) {
      const x = row[policy]; if (!x) continue;
      const mix = Object.entries(x.foodMix).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${n}`).join(', ');
      const buys = x.purchases.length ? x.purchases.map(p => `${p.item} (${p.spent} DNA${p.note ? `; ${p.note}` : ''})`).join('; ') : 'none';
      const skips = x.skipped.length ? `; skipped: ${x.skipped.map(p => `${p.item}: ${p.reason}`).join('; ')}` : '';
      out.push(`- Size ${row.size}, ${policy}: food ${mix || 'none'}. Purchases: ${buys}${skips}.`);
    }
    const t = b.T;
    out.push('', `T_none = ${ms(t.none.all)} (${t.none.completedRuns}/${t.none.of} completed); T_sensible = ${ms(t.sensible.all)} (${t.sensible.completedRuns}/${t.sensible.of} completed); T_none / T_sensible = ${f(t.ratioAll, 2)} (sizes 0–3 only: ${f(t.ratioSizes0to3, 2)}).`, '');
  }
  const failed = report.runs.filter(r => !r.completed);
  if (failed.length) { out.push('## Runs that did not finish', ''); for (const r of failed) out.push(`- ${r.id}: stopped at size ${r.stageReached}: ${r.error}`); out.push(''); }
  if (report.calibration.length) {
    out.push('## Wall-time calibration (one at a time versus the parallel batch)', '', '| Run | Wall serial | Wall parallel | Active serial | Active parallel | Wall/active serial | Wall/active parallel |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const c of report.calibration) out.push(`| ${c.id} | ${f(c.serialWall)} | ${f(c.parallelWall)} | ${f(c.serialActive)} | ${f(c.parallelActive)} | ${f(c.wallPerActiveSerial, 2)} | ${f(c.wallPerActiveParallel, 2)} |`);
    out.push('');
  }
  out.push('## Known limits', '', ...report.knownLimits.map(k => `- ${k}`), '');
  return out.join('\n');
}
