// Tiny Tide C11: paths, editor, gestures, limits, soft world edge, solid reef rocks, block hints, hazards, pose agreement, lifecycle and saves (18 checks, with 5b, 5c, 5d, 7b, 7c, 10b and 12b).
// Fixtures come from the dev-only fixture page (the game's own modules). Run one or more checks: node e2e/tiny-tide-paths.mjs 3 7b
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { control, damageAfterArmor, forcedStart, eatOnce, frames, KEYS, launch, makeFixture, openGame, pickHazard, start, state, steer, storageOf, untilGameTime, waitGameTime, watchErrors } from './fixtures/tiny-tide-fixtures.mjs';

const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const browser = await launch();
const checks = [];
const check = (id, name, fn) => checks.push({ id, name, fn });

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage(), errors = watchErrors(page);
  return { context, page, errors };
}
/** A fixture written to its key, the game opened with `query`, and play started. */
async function play(page, spec, query = '') {
  const fx = await makeFixture(page, spec);
  await openGame(page, { storage: { [fx.key]: fx.json }, query });
  await start(page);
  return fx;
}
async function openPaths(page) {
  await page.locator('#evolve').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#evolve').click();
  await page.locator('#path-screen').waitFor();
}
async function choosePath(page, id) {
  await page.locator(`#path-screen [data-plan=${id}] .path-choose`).click();
  await page.locator('#editor').waitFor(); await frames(page, 3);
}
async function openEdit(page) {
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await frames(page, 3);
}
/** Fails a check whose in-page wait hit its real-time cap (the game clock stops in stuck, paused and editing). */
const noWallTimeout = (r, label) => { if (r.wall) assert.fail(`${label}: the real-time cap tripped; mode ${r.s?.mode}`); };
const view = page => page.locator('#editor .ed-view');
const data = (page, name) => view(page).getAttribute(`data-${name}`);
const selectedUid = async page => (await data(page, 'selected'))?.split('|')[0] ?? '';
const complexity = async page => Number((await page.locator('#editor .ed-complexity em').textContent()).split('/')[0]);
const dnaLeft = async page => Number(await page.locator('#editor .ed-dna-value').textContent());
const project = (page, target) => page.evaluate(t => window.__tinyTide.editorProjection(t), target);
/** A body point on the side of the creature that faces the camera. */
async function side(page, t) {
  const found = [];
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, 2 * Math.PI / 3, -2 * Math.PI / 3]) { const p = await project(page, { t, angle }); if (p) found.push(p); }
  assert.ok(found.length, `a visible body side point at t ${t}`);
  return found.sort((a, b) => a.depth - b.depth)[0];
}
/** A visible body point near the rear tip (t ≥ .85, so a tail keeps the drop point), far on screen from `from`. */
async function rearTarget(page, from) {
  let best = null;
  for (const t of [.86, .9, .94]) {
    const p = await side(page, t), d = Math.hypot(p.x - from.x, p.y - from.y);
    if (!best || d > best.d) best = { ...p, d };
  }
  return best;
}
async function selectPart(page, uid) {
  const p = await project(page, uid); assert.ok(p, `part ${uid} is on screen`);
  await page.mouse.click(p.x, p.y); await frames(page, 2);
  assert.equal(await selectedUid(page), uid, `a click at editorProjection(${uid}) selects it`);
}
async function showKind(page, kind) { await page.locator(`#editor [data-kind=${kind}]`).click(); }
/** Arms a card with a real click. */
async function arm(page, kind, id) { await showKind(page, kind); await page.locator(`#editor .ed-card[data-part=${id}]`).click(); }
/** Drags a range input's thumb to its maximum with the mouse. */
async function dragSliderToMax(page, selector) {
  const input = page.locator(selector), box = await input.boundingBox();
  const { value, min, max } = await input.evaluate(i => ({ value: Number(i.value), min: Number(i.min), max: Number(i.max) }));
  const x0 = box.x + 8 + (box.width - 16) * (value - min) / (max - min), y = box.y + box.height / 2;
  await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move(box.x + box.width + 30, y, { steps: 12 }); await page.mouse.up();
}
/** A point on the editor canvas that no panel covers, far from the creature. The creature's centre is a visible point at
 *  mid-body on the side facing the camera: the top line (angle 0) is near the silhouette in the default view, so the idle
 *  sway hides it for half of each wave cycle and `editorProjection` rightly returns null there. The point keeps 16 px from
 *  any panel, and the drags that the checks start there ((+60, +30) and (−60, +10)) stay on the canvas. */
async function emptyCanvasPoint(page) {
  const centre = await side(page, .5);
  return page.evaluate(c => {
    let best = null;
    const offsets = [[0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16], [60, 30], [-60, 10]];
    for (let x = 40; x < innerWidth - 40; x += 40) for (let y = 120; y < innerHeight - 40; y += 40) {
      if (!offsets.every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.classList.contains('ed-view'))) continue;
      const d = Math.hypot(x - c.x, y - c.y); if (!best || d > best.d) best = { x, y, d };
    }
    return best;
  }, centre);
}

// ---------------------------------------------------------------------------------------------------------------------------
check('1', 'Path screen', async () => {
  const { page, errors } = await newPage();
  await play(page, { ready: true });
  await openPaths(page);
  const plans = await page.locator('#path-screen .path-card').evaluateAll(cards => cards.map(c => c.dataset.plan));
  assert.deepEqual([...plans].sort(), ['crawler', 'swimmer'], 'a ready Speck sees exactly the swimmer and crawler cards');
  const sacrifice = { swimmer: 'Can never grow legs again', crawler: 'Never swims freely or flies' };
  for (const id of plans) {
    const card = page.locator(`#path-screen [data-plan=${id}]`);
    assert.match(await card.locator('.path-silhouette').getAttribute('src'), /^data:image\//, `${id}: silhouette`);
    const lines = await card.locator('.path-summary > div').evaluateAll(rows => Object.fromEntries(rows.map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])));
    assert.deepEqual(Object.keys(lines), ['Playstyle:', "This form's cost:", 'Lasting sacrifice:', 'Leads to:'], `${id}: the four card lines`);
    assert.equal(lines['Lasting sacrifice:'], sacrifice[id], `${id}: lasting sacrifice`);
    assert.ok(lines['Playstyle:'] && lines["This form's cost:"] && lines['Leads to:'], `${id}: lines are filled`);
  }
  await page.locator('#path-screen [data-plan=swimmer] .path-details summary').click();
  assert.equal(await page.locator('#path-screen [data-plan=swimmer] .path-details').evaluate(d => d.open), true, 'Details opens');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#path-screen').count(), 1, 'opening Details does not select the card');
  assert.equal(await page.locator('#editor').count(), 0, 'opening Details does not open the editor');
  await page.locator('#path-screen .path-later').click();
  await page.locator('#path-screen').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__tinyTide.mode === 'playing');
  assert.deepEqual(errors, []);
});

/** A ready Crawler with zero DNA and an extra Little-leg pair (p5). */
const SHORT_CRAWLER = { path: ['crawler'], ready: true, dna: 0, add: { 1: [{ id: 'leg_little', t: .6, scale: .7 }] } };
check('2', 'Customize fallback', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, SHORT_CRAWLER);
  const shell = fx.info.children.find(c => c.id === 'shellback'); assert.ok(shell.quote && !shell.quote.affordable, 'fixture: the Shellback proposal is unaffordable');
  const extra = fx.info.parts.at(-1).uid;
  await openPaths(page);
  assert.equal(await page.locator('#path-screen [data-plan=shellback] .path-banner').textContent(), `Needs changes you choose: short by ${shell.quote.shortfall} DNA`);
  await choosePath(page, 'shellback');
  assert.equal(await page.locator('#editor .ed-done').isDisabled(), true, 'Done is disabled while short of DNA');
  await selectPart(page, extra);
  await page.locator('#editor .ed-delete').click(); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-done').isDisabled(), false, 'removing the extra pair enables Done');
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
  assert.deepEqual((await state(page)).plans, ['speck', 'crawler', 'shellback']);
  assert.deepEqual(errors, []);
});

check('3', 'Submit failure keeps the editor', async () => {
  const { page, errors } = await newPage();
  await play(page, { ready: true }, 'qaRejectSubmit=1');
  await openPaths(page); await choosePath(page, 'crawler');
  const count0 = await complexity(page);
  await arm(page, 'sense', 'antenna');
  const at = await side(page, .5); await page.mouse.click(at.x, at.y); await frames(page, 2);
  const count1 = await complexity(page), selected = await data(page, 'selected');
  assert.equal(count1, count0 + 2, 'an Antenna pair was added');
  await page.locator('#editor .ed-done').click();
  await page.locator('#editor .ed-submit-error:not([hidden])').waitFor();
  assert.equal(await page.locator('#editor').count(), 1, 'the editor stays open');
  assert.equal(await page.locator('#editor .ed-submit-error').textContent(), 'QA rejection');
  assert.equal(await complexity(page), count1, 'the part count is unchanged');
  assert.equal(await data(page, 'selected'), selected, 'data-selected is unchanged');
  await page.locator('#editor .ed-undo').click(); await frames(page, 2);
  assert.equal(await complexity(page), count0, 'Undo removes the Antenna pair (the history survived)');
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__tinyTide.mode === 'playing', {}, { timeout: 15000 });
  assert.deepEqual((await state(page)).plans, ['speck', 'crawler'], 'Done again succeeds');

  // An unaffordable proposal; a size the DNA cannot pay for is refused.
  const second = await newPage();
  await play(second.page, SHORT_CRAWLER); await openPaths(second.page); await choosePath(second.page, 'shellback');
  const p = second.page, dna = await dnaLeft(p);
  assert.ok(dna < 0, `.ed-dna-value is negative (${dna})`);
  assert.equal(await p.locator('#editor .ed-done').isDisabled(), true, 'Done is disabled');
  await selectPart(p, 'p3');
  const before = { value: await p.locator('#editor .ed-scale').inputValue(), cost: await p.locator('#editor .ed-size-cost').textContent(), selected: await data(p, 'selected'), count: await complexity(p) };
  await dragSliderToMax(p, '#editor .ed-scale'); await frames(p, 2);
  assert.equal(await p.locator('#editor .ed-scale').inputValue(), before.value, 'the slider keeps its value');
  assert.equal(await p.locator('#editor .ed-size-cost').textContent(), before.cost, 'the size cost is unchanged');
  assert.equal(await data(p, 'selected'), before.selected, 'the part is unchanged');
  assert.equal(await complexity(p), before.count, 'the slots are unchanged');
  assert.equal(await dnaLeft(p), dna, '.ed-dna-value is unchanged');
  assert.match(await p.locator('#editor .ed-hint').textContent(), /Not enough DNA/, 'the hint shows');
  assert.deepEqual([...errors, ...second.errors], []);
});

check('4', 'Evolve editor', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, { ready: true });
  await openPaths(page); await choosePath(page, 'swimmer');
  const changes = await page.locator('#editor .ed-changes li').allTextContents();
  assert.ok(changes.some(c => c.includes("Little leg removed: Swimmers can't use it.")), '.ed-changes lists the removed leg');
  await page.locator('#editor .ed-undo-all').click(); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-done').isDisabled(), true, 'Undo all disables Done');
  await page.locator('#editor .ed-fix').click(); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-done').isDisabled(), false, 'Fix for me enables Done');
  await showKind(page, 'armor');
  await page.locator('#editor .ed-card[data-part=spike]').focus(); await page.keyboard.press('Enter'); await frames(page, 2);
  const uid = await selectedUid(page), serial = Number(uid.slice(1));
  const proposal = fx.info.children.find(c => c.id === 'swimmer').uids, all = [...proposal, ...fx.info.uids].map(u => Number(u.slice(1)));
  assert.ok(uid && serial > Math.max(...all), `the new part ${uid} has a uid above every proposal uid (${proposal.join(', ')}) and every committed uid`);
  assert.deepEqual(errors, []);
});

check('5', 'Swimmer surface limit', async () => {
  const { page, errors } = await newPage();
  await play(page, { path: ['swimmer'] });
  await control(page, ['KeyE']);
  const result = await page.evaluate(() => new Promise(resolve => {
    let top = -Infinity, rose = window.__tinyTide.time, stopped = null, sawContact = false;
    const t0 = window.__tinyTide.time, w0 = performance.now();
    const tick = () => {
      const s = window.__tinyTide;
      if (s.player.y > top + 1e-6) { top = s.player.y; rose = s.time; }
      if (stopped === null && s.time - rose >= 1) stopped = s.time;
      if (stopped !== null && s.contactNow && s.lastContact === 'surface-top') sawContact = true;
      if (stopped !== null && s.time - stopped >= 2) return resolve({ ok: true, s, sawContact, top });
      if (s.time - t0 > 40) return resolve({ ok: false, s, sawContact, top });
      if (performance.now() - w0 > 120000) return resolve({ ok: false, wall: true, s, sawContact, top });
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await control(page, []);
  noWallTimeout(result, 'check 5 (rise)');
  assert.ok(result.ok, 'the swimmer stops rising within 40 s of game time');
  assert.notEqual(result.s.zone, 'air', 'a Swimmer never reaches the air');
  assert.ok(result.top < result.s.world.surface, 'the body stays below the surface');
  assert.ok(result.sawContact, "lastContact is 'surface-top' on a frame with contactNow");
  assert.equal(await page.locator('#toast').textContent(), "Swimmers can't leave the water.");
  // Negative control: a Sky drifter rises above the surface.
  const sky = await newPage();
  await play(sky.page, { stage: 3 });
  await control(sky.page, ['KeyE']);
  await untilGameTime(sky.page, s => s.player.y > s.world.surface + .5, 30, 'a Sky drifter rises above the surface');
  await control(sky.page, []);
  assert.deepEqual([...errors, ...sky.errors], []);
});

check('5b', 'Soft world edge', async () => {
  const { page, errors } = await newPage();
  await play(page, { path: ['swimmer'] }, 'forcedSpawn=20,10,0');
  const first = await state(page), half = first.edge.half, soft = first.edge.softStart;
  // An in-page sampler watches every frame for 10 s of game time while real keys swim toward +x (bounded in real time).
  const sampling = page.evaluate(([edgeText]) => new Promise(resolve => {
    const t0 = window.__tinyTide.time, w0 = performance.now(), track = [];
    let boundsFrames = 0, refused = 0, toast = false, toasts = 0, showing = false, inZone = false, fog = 0;
    const tick = () => {
      const s = window.__tinyTide, el = document.getElementById('toast');
      if (s.contactNow && `${s.lastContact}`.startsWith('bounds')) boundsFrames++;
      if (s.legal === false || s.mode !== 'playing') refused++;
      const now = el.classList.contains('show') && el.textContent === edgeText; if (now) toast = true; if (now && !showing) toasts++; showing = now;
      inZone ||= s.edge.inZone; fog = Math.max(fog, s.world.edgeFog);
      track.push({ t: s.time - t0, reach: Math.max(Math.abs(s.player.x), Math.abs(s.player.z)) });
      if (s.time - t0 >= 10) return resolve({ boundsFrames, refused, toast, toasts, inZone, fog, track, s });
      if (performance.now() - w0 > 60000) return resolve({ wall: true, s });
      requestAnimationFrame(tick);
    };
    tick();
  }), ["That's the edge of the world for now."]);
  let done = false; sampling.then(() => { done = true; });
  while (!done) {
    const s = await state(page);
    // A unit step toward +x picks the nearest of the 8 key directions (camera-relative).
    await control(page, steer(s, { x: s.player.x + 1, z: s.player.z }, .38));
    await page.waitForTimeout(100);
  }
  const r = await sampling;
  await control(page, []);
  noWallTimeout(r, 'check 5b (edge)');
  const reach = Math.max(...r.track.map(f => f.reach)), last = r.track.filter(f => f.t >= 9).map(f => f.reach);
  assert.ok(r.inZone && reach > soft, `the Swimmer entered the push zone (max reach ${reach.toFixed(2)}, soft start ${soft})`);
  assert.equal(r.boundsFrames, 0, 'no frame touches the hard bound');
  assert.equal(r.refused, 0, 'every frame is admitted and playing');
  assert.ok(reach < half - 1, `the reach settles inside the bound (max ${reach.toFixed(2)} of ${half})`);
  assert.ok(Math.max(...last) - Math.min(...last) < .5, `the reach has settled in the last second (${Math.min(...last).toFixed(2)}–${Math.max(...last).toFixed(2)})`);
  assert.ok(r.toast, 'the edge toast showed in the push zone');
  assert.equal(r.toasts, 1, 'the edge toast shows once per entry, not again while the creature stays in the zone');
  assert.ok(r.fog > .5, `the edge fog closed in (${r.fog.toFixed(2)})`);
  // Released, the current carries the creature back inward.
  const released = await state(page), from = Math.max(Math.abs(released.player.x), Math.abs(released.player.z));
  await waitGameTime(page, 2);
  const after = await state(page), to = Math.max(Math.abs(after.player.x), Math.abs(after.player.z));
  assert.ok(to < from - 1, `released, the creature drifts inward (${from.toFixed(2)} → ${to.toFixed(2)})`);
  assert.deepEqual(errors, []);
  console.log(`     edge: max reach ${reach.toFixed(2)} of ${half} (soft start ${soft}), fog ${r.fog.toFixed(2)}, drift ${from.toFixed(2)} → ${to.toFixed(2)}`);
});

check('5c', 'Reef rocks are solid', async () => {
  // Owner playtest P4: a stage 1 Swimmer swims at the tallest of the reef rocks nearest the start, at a glancing angle with real keys.
  // It must touch it (the contact names the rock), never pass into it, stay admitted, and keep moving as it slides around it.
  const { page, errors } = await newPage(), spec = { path: ['swimmer'], seed: 4242 };
  await play(page, spec);
  // A layer 1 rock (the stage's own size): since final review I3 the small layer 0 rocks near the start collide at stage 1 too.
  const near = (await state(page)).solidsNear.filter(r => r.id.startsWith('rock:1:') && Math.max(Math.abs(r.x), Math.abs(r.z)) + r.half < 30).sort((a, b) => (b.top - b.ground) - (a.top - a.ground));
  assert.ok(near.length > 0, 'a reef rock near the start');
  const rock = near[0], z0 = rock.z + .35 * rock.inner, x0 = rock.x - rock.half - 4, y0 = rock.ground + .5 * (rock.top - rock.ground);
  await page.close();
  const second = await newPage();
  await play(second.page, spec, `forcedSpawn=${x0},${y0},${z0}`);
  const sampling = second.page.evaluate(id => new Promise(resolve => {
    const t0 = window.__tinyTide.time, w0 = performance.now(), track = [];
    let touched = 0, firstTouch = null, refused = 0, inside = 0, deepest = Infinity, rock = null;
    const tick = () => {
      const s = window.__tinyTide;
      rock ??= s.solidsNear.find(r => r.id === id) ?? null;
      if (s.contactNow && s.lastContact === 'solid' && s.lastContactSolid === id) { touched++; firstTouch ??= { t: s.time - t0, x: s.player.x, z: s.player.z }; }
      if (s.legal === false || s.mode !== 'playing') refused++;
      // The admission's own solid test (no other rule first): the hull never overlaps a rock (P4 review: no pass-through).
      if (s.solidOverlap !== null) inside++;
      if (rock) deepest = Math.min(deepest, Math.hypot(s.player.x - rock.x, s.player.z - rock.z));
      track.push({ t: s.time - t0, x: s.player.x, y: s.player.y, z: s.player.z });
      if (s.time - t0 >= 8) return resolve({ touched, firstTouch, refused, inside, deepest, track, rock, s });
      if (performance.now() - w0 > 90000) return resolve({ wall: true, s });
      requestAnimationFrame(tick);
    };
    tick();
  }), rock.id);
  let done = false, touching = false; sampling.then(() => { done = true; });
  while (!done) {
    const s = await state(second.page);
    touching ||= s.lastContactSolid === rock.id;
    // Toward a point beside the rock's centre (a glancing hit), then, once it touched, toward a point far past it (+x).
    await control(second.page, steer(s, touching ? { x: rock.x + 40, z: z0 } : { x: rock.x, z: z0 }, .38));
    await second.page.waitForTimeout(100);
  }
  const r = await sampling;
  await control(second.page, []);
  noWallTimeout(r, 'check 5c (rock)');
  assert.ok(r.touched > 0 && r.firstTouch, `the Swimmer touched rock ${rock.id} (contact 'solid' naming it); closest ${r.deepest?.toFixed(2)}`);
  assert.equal(r.refused, 0, 'every frame is admitted and playing');
  // No pass-through, from the admission's own solid test on every frame (P4 review: the old check compared the centre's horizontal
  // distance with the rock's smallest semi-axis, which says nothing above or below the rock's widest part).
  assert.equal(r.inside, 0, 'no frame has the hull inside a rock (the admission solid test)');
  // After the first touch the body keeps moving: it slides at least 2 units in the next 2 s, and ends past the rock's centre.
  const after = r.track.filter(f => f.t >= r.firstTouch.t && f.t <= r.firstTouch.t + 2), moved = Math.hypot(after.at(-1).x - after[0].x, after.at(-1).z - after[0].z);
  assert.ok(moved > 2, `the Swimmer slides on after touching the rock (${moved.toFixed(2)} in 2 s)`);
  assert.ok(r.track.at(-1).x > rock.x, `the Swimmer got around the rock (x ${r.track.at(-1).x.toFixed(2)} past ${rock.x.toFixed(2)})`);
  assert.deepEqual([...errors, ...second.errors], []);
  console.log(`     rock ${rock.id}: first touch at ${r.firstTouch.t.toFixed(2)} s, ${r.touched} contact frames, closest ${r.deepest.toFixed(2)} (inner ${rock.inner.toFixed(2)}), slid ${moved.toFixed(2)} in 2 s`);
});

check('5d', 'Block hints only for a real block; one-shot toasts stay', async () => {
  // Final review I1. (a) A Swimmer that skims and dives along the seabed for 10 s with real keys gets no block hint. (b) A Swimmer
  // that dives straight into the seabed at the start keeps the stage toast for its full time; the block hint shows only after it.
  const hints = ['Something solid is in the way.', 'A rock is in the way.'];
  const watch = (page, seconds) => page.evaluate(([hintTexts, seconds]) => new Promise(resolve => {
    const t0 = window.__tinyTide.time, w0 = performance.now(), shown = [];
    let contacts = 0, last = null;
    const tick = () => {
      const s = window.__tinyTide, el = document.getElementById('toast'), text = el.classList.contains('show') ? el.textContent : null;
      if (s.contactNow && s.lastContact === 'ground') contacts++;
      if (text !== last) { shown.push({ t: s.time - t0, text }); last = text; }
      if (s.time - t0 >= seconds) return resolve({ contacts, shown, hinted: shown.filter(x => hintTexts.includes(x.text)) });
      if (performance.now() - w0 > 90000) return resolve({ wall: true, s });
      requestAnimationFrame(tick);
    };
    tick();
  }), [hints, seconds]);
  const { page, errors } = await newPage();
  await play(page, { path: ['swimmer'] });
  await waitGameTime(page, 5);   // the stage toast (4.5 s) is gone
  const first = await state(page);
  const skim = watch(page, 10);
  let done = false; skim.then(() => { done = true; });
  let k = 0;
  while (!done) {
    const s = await state(page), a = k++ * .05;
    // Forward along a slowly turning heading, with Dive held: the body stays pressed onto the seabed and slides along it.
    await control(page, ['KeyQ', ...steer(s, { x: s.player.x + 10 * Math.cos(a), z: s.player.z + 10 * Math.sin(a) }, .38)]);
    await page.waitForTimeout(120);
  }
  const r = await skim; await control(page, []);
  noWallTimeout(r, 'check 5d (skim)');
  assert.ok(r.contacts > 30, `the Swimmer skimmed the seabed (${r.contacts} contact frames, from y ${first.player.y.toFixed(2)})`);
  assert.deepEqual(r.hinted, [], 'no block hint while sliding along the seabed');
  // (b) A fresh start; Dive held straight down at once.
  const second = await newPage();
  await play(second.page, { path: ['swimmer'] });
  const stageToast = await second.page.locator('#toast').textContent();
  await control(second.page, ['KeyQ']);
  const d = await watch(second.page, 7.5);
  await control(second.page, []);
  noWallTimeout(d, 'check 5d (dive)');
  const ownEnd = d.shown.find(x => x.text !== stageToast)?.t ?? Infinity;
  assert.ok(ownEnd >= 4.3, `the stage toast stays its full time (until ${ownEnd.toFixed(2)} s of 4.5 s): ${JSON.stringify(d.shown)}`);
  assert.ok(d.contacts > 30, `the dive pushed into the seabed (${d.contacts} contact frames)`);
  assert.equal(d.hinted.length, 1, `one block hint, after the stage toast: ${JSON.stringify(d.shown)}`);
  assert.ok(d.hinted[0].t >= 4.3, 'the block hint waits for the stage toast');
  assert.deepEqual([...errors, ...second.errors], []);
  console.log(`     skim: ${r.contacts} contact frames, 0 hints; dive: stage toast until ${ownEnd.toFixed(2)} s, hint at ${d.hinted[0].t.toFixed(2)} s`);
});

check('6', 'Crawler', async () => {
  const { page, errors } = await newPage();
  await play(page, { path: ['crawler'] });
  const s = await state(page);
  assert.equal(s.caps.rise, false, 'caps.rise is false');
  assert.equal(await page.locator('#vertical-controls').isHidden(), true, '#vertical-controls is hidden');
  await control(page, ['KeyE', 'KeyW']);
  await waitGameTime(page, 1.5);
  const after = await state(page); await control(page, []);
  assert.equal(after.zone, 'seabed', 'the Crawler stays on the seabed');
  assert.deepEqual(errors, []);
});

check('7', 'A Crawler placed high recovers onto the seabed', async () => {
  const { page, errors } = await newPage();
  const spec = { path: ['crawler'], ready: true }, high = { x: 0, y: 30, z: 0 };
  // The pose the game must start from: recoverPlayer from (0, 30, 0), as the fixture page computes it with the game's modules.
  const expected = await forcedStart(page, spec, high);
  assert.ok(expected.start && expected.anchor, 'fixture: a recovered start and an anchor exist');
  assert.ok(Math.hypot(expected.start.x - expected.anchor.x, expected.start.y - expected.anchor.y, expected.start.z - expected.anchor.z) > 1e-6, 'fixture: the recovered start differs from the anchor');
  // qaHoldStart keeps the installed pose until a press, so the first pose is read exactly.
  await play(page, spec, `forcedSpawn=${high.x},${high.y},${high.z}&qaHoldStart=1`);
  const first = await state(page);
  assert.equal(first.holdingStart, true);
  assert.deepEqual(first.physical, expected.start, 'the start is exactly recoverPlayer from (0, 30, 0)');
  assert.equal(first.legal, true, 'the recovered start is legal');
  // A grounded body then settles onto its support: every frame is legal, and it is on the seabed (bounded: 1 s game, 10 s real).
  await page.keyboard.press('ShiftLeft');   // a harmless first press ends the hold
  const r = await page.evaluate(() => new Promise(resolve => {
    const t0 = window.__tinyTide.time, w0 = performance.now(), frames = []; const tick = () => {
      const s = window.__tinyTide; frames.push({ zone: s.zone, legal: s.legal, mode: s.mode });
      if (s.zone === 'seabed' && s.legal) return resolve({ s, frames });
      if (s.time - t0 > 1) return resolve({ s, frames });
      if (performance.now() - w0 > 10000) return resolve({ s, frames, wall: true });
      requestAnimationFrame(tick);
    }; tick();
  }));
  noWallTimeout(r, 'check 7 (settle)');
  assert.ok(r.frames.every(f => f.legal === true && f.mode === 'playing'), 'the position is legal on every frame');
  assert.equal(r.s.zone, 'seabed', `zone is seabed (start zone ${first.zone}, ${r.frames.length} frames)`);
  assert.deepEqual(errors, []);
});

check('7c', 'A bite at the floor keeps the body moving', async () => {
  // Final review M4: a Speck that eats on the seabed grows; the grown body keeps its motion (main.ts checkGrownPose, the growth
  // lift), so on the frame after each bite the mode is 'playing' and the speed is at least half of the speed at the bite.
  const { page, errors } = await newPage();
  await play(page, {});
  const sampler = page.evaluate(() => new Promise(resolve => {
    const w0 = performance.now(), bites = [];
    let last = window.__tinyTide, pending = null;
    const speed = s => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    const tick = () => {
      const s = window.__tinyTide;
      if (pending) { bites.push({ ...pending, after: speed(s), mode: s.mode, growth: s.growth, zone: s.zone }); pending = null; }
      if (s.bites > last.bites) pending = { at: speed(s), before: speed(last), growthBefore: last.growth };
      last = s;
      if (bites.length >= 3) return resolve({ bites });
      if (performance.now() - w0 > 90000) return resolve({ wall: true, bites, s });
      requestAnimationFrame(tick);
    };
    tick();
  }));
  for (let i = 0; i < 3; i++) await eatOnce(page, `bite ${i + 1}`);
  const r = await sampler;
  noWallTimeout(r, 'check 7c (bites)');
  assert.equal(r.bites.length, 3, 'three bites sampled');
  for (const b of r.bites) {
    assert.equal(b.mode, 'playing', `playing on the frame after the bite: ${JSON.stringify(b)}`);
    assert.ok(b.growth > b.growthBefore, `the bite grew the body: ${JSON.stringify(b)}`);
    assert.equal(b.zone, 'seabed', `the bite was at the floor: ${JSON.stringify(b)}`);
    if (b.at > .5) assert.ok(b.after >= .5 * b.at, `the speed is kept through the growth step: ${JSON.stringify(b)}`);
  }
  assert.ok(r.bites.some(b => b.at > .5 && b.after > 0), `at least one bite while moving keeps moving: ${JSON.stringify(r.bites)}`);
  assert.deepEqual(errors, []);
  console.log(`     bites at the floor: ${r.bites.map(b => `${b.at.toFixed(2)} → ${b.after.toFixed(2)}`).join(', ')}`);
});

check('7b', 'The transformation moves toward the destination', async () => {
  const { page, errors } = await newPage();
  await play(page, { ready: true });
  await openPaths(page); await choosePath(page, 'crawler');
  const startY = (await state(page)).world.physicalPosition.y;
  const sampling = page.evaluate(() => new Promise(resolve => {
    const samples = []; let destination = null, t0 = performance.now();
    const tick = () => {
      const s = window.__tinyTide;
      if (s.mode === 'evolving') { samples.push(s.world.physicalPosition.y); destination = s.physical; }
      else if (samples.length) return resolve({ samples, destination, end: s });
      if (performance.now() - t0 > 20000) return resolve({ samples, destination, end: s, timeout: true });
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.locator('#editor .ed-done').click();
  const r = await sampling;
  assert.ok(!r.timeout && r.samples.length > 3, 'frames were sampled while evolving');
  assert.ok(Math.abs(r.destination.y - startY) > 1e-6, 'the destination differs from the start');
  const lo = Math.min(startY, r.destination.y), hi = Math.max(startY, r.destination.y);
  assert.ok(r.samples.some(y => y > lo && y < hi), 'a sample lies strictly between the start and the destination height');
  const end = r.end.world.physicalPosition;
  assert.ok(Math.hypot(end.x - r.destination.x, end.y - r.destination.y, end.z - r.destination.z) < 1e-6, 'the body ends exactly at the destination');
  assert.equal(r.end.zone, 'seabed', 'the destination is on the seabed'); assert.equal(r.end.legal, true, 'and admitted');
  assert.deepEqual(errors, []);
});

check('8', 'Diet lock', async () => {
  const { page, errors } = await newPage();
  await play(page, { path: ['crawler'], mouth: { 1: 'mouth_snapper' } });
  await openEdit(page); await showKind(page, 'mouth');
  for (const id of ['mouth_nibbler', 'mouth_beak']) {
    const card = page.locator(`#editor .ed-card[data-part=${id}]`);
    assert.equal(await card.isDisabled(), true, `${id} is disabled`);
    assert.equal(await card.getAttribute('data-reason'), 'Diet is set until your next evolution.', `${id} says why`);
  }
  // At size 2, swapping Snapper for Fangs keeps the mouth's uid.
  const big = await newPage();
  const fx = await play(big.page, { path: ['crawler', 'burrower'], mouth: { 1: 'mouth_snapper' } });
  const mouth = fx.info.parts.find(p => p.id === 'mouth_snapper').uid;
  await openEdit(big.page); await selectPart(big.page, mouth);
  await showKind(big.page, 'mouth'); await big.page.locator('#editor .ed-card[data-part=mouth_fangs]').click(); await frames(big.page, 2);
  assert.equal(await selectedUid(big.page), mouth, 'swapping Snapper for Fangs keeps the data-selected uid');
  assert.deepEqual([...errors, ...big.errors], []);
});

check('9', 'Size pricing', async () => {
  const { page, errors } = await newPage();
  await play(page, {});
  await openEdit(page); await selectPart(page, 'p3');
  await dragSliderToMax(page, '#editor .ed-scale'); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-size-cost').textContent(), '14 DNA · 2 slots');
  assert.deepEqual(errors, []);
});

check('10', 'Gestures (desktop)', async () => {
  const { page, errors } = await newPage();
  await play(page, {});
  await openEdit(page);
  const empty = await emptyCanvasPoint(page); assert.ok(empty, 'an empty canvas point exists');
  const yaw0 = await data(page, 'yaw');
  await page.mouse.move(empty.x, empty.y); await page.mouse.down(); await page.mouse.move(empty.x + 60, empty.y + 30, { steps: 8 }); await page.mouse.up();
  await frames(page, 2);
  assert.equal(await data(page, 'yaw'), yaw0, 'a left drag on empty space does not turn the model');
  // Leftward, so the view turns toward the rear and the tail stays in sight.
  await page.mouse.move(empty.x, empty.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(empty.x - 60, empty.y + 10, { steps: 8 }); await page.mouse.up({ button: 'right' });
  await frames(page, 2);
  assert.notEqual(await data(page, 'yaw'), yaw0, 'a right drag turns the model');
  await selectPart(page, 'p3');
  const attached = await data(page, 'selected'), from = await project(page, 'p3'), to = await rearTarget(page, from);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await frames(page, 2);
  const moved = await data(page, 'selected');
  assert.equal(moved.split('|')[0], 'p3'); assert.notEqual(moved, attached, 'a left drag on the tail changes its attachment');
  assert.deepEqual(errors, []);
});

check('10b', 'Chorded mouse buttons (desktop)', async () => {
  // Left, right, release left, release right: Chrome sends the right press and the left release as pointermoves. Basic and slot 1 follow
  // the buttons bitmask; nothing stays held (T9 review fix round 1).
  const { page, errors } = await newPage();
  await play(page, {});
  const held = async () => { await frames(page, 2); const s = await state(page); return [s.input.basicHeld, s.input.activeHeld[0]]; };
  await page.mouse.move(720, 430);
  await page.mouse.down(); assert.deepEqual(await held(), [true, false], 'left holds the basic input');
  await page.mouse.down({ button: 'right' }); assert.deepEqual(await held(), [true, true], 'a chorded right press holds slot 1');
  await page.mouse.up(); assert.deepEqual(await held(), [false, true], 'a chorded left release ends the basic input');
  await page.mouse.up({ button: 'right' }); assert.deepEqual(await held(), [false, false], 'the last release ends slot 1');
  await page.mouse.down({ button: 'right' }); await page.mouse.down(); await page.mouse.up({ button: 'right' }); await page.mouse.up();
  assert.deepEqual(await held(), [false, false], 'right, left, release right, release left: nothing stays held');
  assert.deepEqual(errors, []);
});
check('11', 'Gestures (touch, 390x844)', async () => {
  const { context, page, errors } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await play(page, {});
  await openEdit(page);
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const centre = async locator => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const tap = async (p, id = 1) => { await touch('touchStart', [{ ...p, id }]); await touch('touchEnd', []); await frames(page, 2); };
  // Arm the Antenna with a tap.
  await page.locator('#editor [data-kind=sense]').click();
  const card = page.locator('#editor .ed-card[data-part=antenna]');
  await card.scrollIntoViewIfNeeded(); await tap(await centre(card));
  assert.equal(await data(page, 'gesture'), 'none', 'data-gesture is none after the tap');
  assert.match(await card.getAttribute('class'), /\bactive\b/, 'placement is armed');
  // Two-finger drags, released in both orders: the view turns, nothing is placed.
  for (const firstUp of [1, 2]) {
    const count = await complexity(page), yaw = await data(page, 'yaw'), body = await side(page, .5);
    const a = { x: body.x - 60, y: body.y - 40, id: 1 }, b = { x: body.x + 60, y: body.y + 40, id: 2 };
    await touch('touchStart', [a]); await touch('touchStart', [a, b]);
    for (let i = 0; i < 6; i++) { a.x -= 8; b.x -= 8; await touch('touchMove', [a, b]); }   // toward the rear view
    await touch('touchEnd', firstUp === 1 ? [b] : [a]); await frames(page, 1); await touch('touchEnd', []); await frames(page, 2);
    assert.notEqual(await data(page, 'yaw'), yaw, `two-finger drag turns the view (finger ${firstUp} up first)`);
    assert.equal(await complexity(page), count, `two-finger drag places nothing (finger ${firstUp} up first)`);
    assert.equal(await data(page, 'gesture'), 'none');
  }
  // One-finger part drag plus a second finger: the part returns to its attachment.
  await tap(await centre(card));   // disarm
  assert.doesNotMatch(await card.getAttribute('class'), /\bactive\b/, 'placement is disarmed');
  const tail = await project(page, 'p3'); await tap(tail);
  assert.equal(await selectedUid(page), 'p3', 'a tap selects the tail');
  const attached = await data(page, 'selected'), target = await rearTarget(page, tail);
  const f = { x: tail.x, y: tail.y, id: 1 };
  await touch('touchStart', [f]);
  for (let i = 1; i <= 8; i++) { f.x = tail.x + (target.x - tail.x) * i / 8; f.y = tail.y + (target.y - tail.y) * i / 8; await touch('touchMove', [f]); }
  await frames(page, 2);
  assert.notEqual(await data(page, 'selected'), attached, 'the one-finger drag moves the tail');
  const free = await emptyCanvasPoint(page); assert.ok(free, 'an empty canvas point for the second finger');
  await touch('touchStart', [f, { x: free.x, y: free.y, id: 2 }]); await frames(page, 2);
  assert.equal(await data(page, 'selected'), attached, 'a second finger returns the part to its attachment');
  await touch('touchEnd', []); await frames(page, 2);
  assert.equal(await data(page, 'selected'), attached, 'still at its attachment after release');
  // Card drag plus a second finger: nothing is placed.
  const count = await complexity(page), from = await centre(card), body = await side(page, .5), g = { ...from, id: 1 };
  await touch('touchStart', [g]);
  for (let i = 1; i <= 8; i++) { g.x = from.x + (body.x - from.x) * i / 8; g.y = from.y + (body.y - from.y) * i / 8; await touch('touchMove', [g]); }
  await touch('touchStart', [g, { x: free.x, y: free.y, id: 2 }]); await touch('touchEnd', [{ x: free.x, y: free.y, id: 2 }]); await touch('touchEnd', []); await frames(page, 3);
  assert.equal(await complexity(page), count, 'a card drag with a second finger places nothing');
  assert.equal(await data(page, 'gesture'), 'none');
  assert.deepEqual(errors, []);
});

check('12', 'Allocation and rig invalidation', async () => {
  const { page, errors } = await newPage();
  await play(page, { dna: 200 });
  await openEdit(page);
  await arm(page, 'sense', 'antenna');
  const points = [await side(page, .12), await side(page, .5), await side(page, .9)];
  for (const p of points) { await page.mouse.move(p.x, p.y, { steps: 3 }); await frames(page, 2); }
  const counters = () => page.evaluate(() => Object.fromEntries(['created-geometries', 'disposed-geometries', 'created-materials', 'disposed-materials', 'rebuilds'].map(n => [n, document.querySelector('#editor .ed-view').getAttribute(`data-${n}`)])));
  const before = await counters();
  for (let i = 0; i < 60; i++) { const p = points[i % 3]; await page.mouse.move(p.x + (i % 7) - 3, p.y + (i % 5) - 2); if (i % 10 === 0) await frames(page, 1); }
  await frames(page, 3);
  assert.deepEqual(await counters(), before, 'hovering 60 times creates and disposes nothing');
  // Rig invalidation: add a Pincer pair, animate, toggle the pair, animate again; no pivot key is missing.
  await page.keyboard.press('Escape');
  await arm(page, 'arm', 'claw_pincer');
  const at = await side(page, .55); await page.mouse.click(at.x, at.y); await frames(page, 6);
  assert.equal(await selectedUid(page) !== '', true, 'a Pincer was placed');
  await page.locator('#editor .ed-mirror').click(); await frames(page, 6);
  await page.locator('#editor .ed-mirror').click(); await frames(page, 6);
  assert.equal(await data(page, 'missing-pivots'), '0', 'no animated pivot is missing a rig key');
  assert.deepEqual(errors, []);
});

check('12b', 'Lost abilities (QA grant catalog)', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, { add: { 0: [{ id: 'claw_pincer', t: .5 }] }, bindClaw: true }, 'qaGrantCatalog=1');
  const claw = fx.info.parts.find(p => p.id === 'claw_pincer').uid;
  await openEdit(page);
  assert.equal(await page.locator('#editor .ed-lost-abilities').isHidden(), true, 'no lost abilities before the change');
  await selectPart(page, claw);
  await page.locator('#editor .ed-delete').click(); await frames(page, 2);
  const lost = page.locator('#editor .ed-lost-abilities');
  assert.equal(await lost.isVisible(), true, 'removing the bound Pincer shows the lost abilities');
  assert.match(await lost.textContent(), /Pincer: its ability will be removed \(slot 1\)/);
  assert.deepEqual(errors, []);
});

check('13', 'Hazard integration and invulnerability', async () => {
  const { page, errors } = await newPage();
  const pick = await pickHazard(page, { stage: 0, key: '1:crab' }); assert.ok(pick, 'pickHazard found a crab');
  const fx = await makeFixture(page, { seed: pick.seed }), damage = (await damageAfterArmor(page, 6, fx.info.armor)) / 2;   // the engaged pinch: 4 + 2 × (1 − 0) half-hearts → hearts
  await openGame(page, { storage: { [fx.key]: fx.json }, query: `forcedSpawn=${pick.home.x},${pick.home.y},${pick.home.z}` }); await start(page);
  const first = await state(page);
  assert.ok(Math.abs(first.invulnerableUntil - first.time - 2) < .5 && first.invulnerableUntil - first.time <= 2, `the default start grace is 2 s (until ${first.invulnerableUntil}, now ${first.time})`);
  const r = await page.evaluate(() => new Promise(resolve => {
    const samples = [], t0 = window.__tinyTide.time, w0 = performance.now();
    const tick = () => {
      const s = window.__tinyTide;
      samples.push({ time: s.time, health: s.health, max: s.maxHealth, accepted: s.acceptedHits, rejected: s.rejectedHits, until: s.invulnerableUntil, mode: s.mode });
      if (s.acceptedHits >= 2 || s.time - t0 > 10) return resolve(samples);
      if (performance.now() - w0 > 40000) return resolve({ wall: true, s, samples });
      requestAnimationFrame(tick);
    };
    tick();
  }));
  noWallTimeout(r, 'check 13 (hazard)');
  const grace = first.invulnerableUntil, during = r.filter(x => x.time < grace), after = r.filter(x => x.time >= grace);
  assert.ok(during.at(-1).rejected >= 1, 'the crab’s events are rejected during the grace');
  assert.ok(during.every(x => x.health === x.max && x.accepted === 0), 'health stays at maximum during the grace');
  const hit1 = after.findIndex(x => x.accepted >= 1); assert.ok(hit1 >= 0, 'a hit is accepted after the grace (within 10 s)');
  assert.equal(after[hit1].accepted, 1);
  assert.equal(after[hit1].health, after[hit1].max - damage, `health drops by damageAfterArmor(6, ${fx.info.armor}) / 2 = ${damage}`);
  const hit2 = after.findIndex(x => x.accepted >= 2); assert.ok(hit2 >= 0, 'a second hit is accepted within 10 s');
  assert.ok(after[hit2].time - after[hit1].time >= .8 - 1e-9, `the next accepted hit is no sooner than .8 s later (${(after[hit2].time - after[hit1].time).toFixed(3)} s)`);
  assert.deepEqual(errors, []);
});

check('14', 'Pose agreement', async () => {
  const { page, errors } = await newPage();
  await play(page, { add: { 0: [{ id: 'claw_pincer', t: .5 }] } });
  await control(page, ['KeyW', 'Space']); await page.waitForTimeout(500);
  const samples = await page.evaluate(() => new Promise(resolve => {
    const out = []; const tick = () => { out.push(window.__tinyTide.poseAgreement()); if (out.length >= 5) return resolve(out); requestAnimationFrame(tick); }; tick();
  }));
  await control(page, []);
  for (const a of samples) {
    assert.ok(a, 'poseAgreement() returns a result');
    assert.equal(a.sockets, 4, 'every socket is sampled: bite, two pinches, slap');
    assert.ok(a.positionError < 1e-3 * a.bodyLength, `position error ${a.positionError} < 1e-3 × body length ${a.bodyLength}`);
    assert.ok(a.angleError < .01, `forward angle error ${a.angleError} < .01 rad`);
    assert.equal(a.reflectionsAgree, true, 'the same reflection sign');
  }
  assert.deepEqual(errors, []);
});

check('15', 'Faint during a Breach', async () => {
  const { page, errors } = await newPage();
  const pick = await pickHazard(page, { stage: 2, key: '2:squid', below: true, minLeadSeconds: .5 }); assert.ok(pick, 'pickHazard found a squid with room below');
  await play(page, { stage: 2, health: 1, seed: pick.seed }, `qaStartGrace=0&qaHoldStart=1&forcedSpawn=${pick.start.x},${pick.start.y},${pick.start.z}`);
  const s0 = await state(page);
  assert.equal(s0.holdingStart, true, 'the simulation holds until the first press');
  await frames(page, 5);
  assert.equal((await state(page)).time, s0.time, 'the game clock holds');
  const watching = page.evaluate(() => new Promise(resolve => {
    let t0 = null; const w0 = performance.now(); const tick = () => {
      const s = window.__tinyTide;
      if (!s.holdingStart && t0 === null) t0 = s.time;
      if (s.faintLog.length) return resolve({ s, saved: localStorage.getItem(s.saveKey) });
      if (t0 !== null && s.time - t0 > 3) return resolve({ s, timeout: true });
      if (performance.now() - w0 > 20000) return resolve({ s, wall: true });
      requestAnimationFrame(tick);
    }; tick();
  }));
  await page.keyboard.press('KeyE');
  const w = await watching;
  noWallTimeout(w, 'check 15 (Breach faint)');
  assert.ok(!w.timeout, 'a faint within 3 s of game time');
  const f = w.s.faintLog[0];
  if (!f.hadPermit || !f.hadArc) assert.fail('non-Breach faint');
  assert.equal(w.s.pendingRespawn, true, 'pendingRespawn is true');
  const pending = JSON.parse(w.saved); assert.equal(pending.pendingRespawn, true, 'and saved');
  const s = await untilGameTime(page, x => x.mode === 'playing', 6, 'the respawn timer');
  assert.equal(s.pendingRespawn, false); assert.equal(s.health, s.maxHealth, 'health is at maximum');
  assert.deepEqual(s.velocity, { x: 0, y: 0, z: 0 }); assert.deepEqual(s.externalVelocity, { x: 0, y: 0, z: 0 });
  assert.equal(s.permit, null); assert.equal(s.arc, null); assert.equal(s.legal, true, 'the zone is legal');
  assert.equal(JSON.parse(await storageOf(page, s.saveKey)).pendingRespawn, false);
  // Reload while pendingRespawn is true in storage: it resolves once.
  const again = await newPage();
  await openGame(again.page, { storage: { [KEYS.v4]: w.saved } }); await start(again.page);
  const r = await state(again.page);
  assert.equal(r.pendingRespawn, false); assert.equal(r.deaths, pending.deaths, 'deaths unchanged by the reload');
  assert.equal(r.dna, pending.economy.wallet.banked + pending.economy.wallet.atRisk, 'DNA unchanged by the reload');
  assert.equal(r.health, r.maxHealth); assert.equal(r.legal, true);
  assert.equal(JSON.parse(await storageOf(again.page, KEYS.v4)).pendingRespawn, false, 'the saved flag becomes false');
  assert.deepEqual([...errors, ...again.errors], []);
});

check('16', 'Pause keeps the runtime', async () => {
  const { page, errors } = await newPage();
  await play(page, { stage: 2 });
  await control(page, ['KeyW']);
  await untilGameTime(page, s => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z) > 0, 5, 'moving');
  await page.keyboard.press('KeyE');
  await untilGameTime(page, s => s.arc !== null, 2, 'a Breach starts');
  await page.locator('#pause').click(); await page.getByRole('dialog').waitFor();
  const pick = s => ({ time: s.time, velocity: s.velocity, externalVelocity: s.externalVelocity, permit: s.permit, arc: s.arc, breachReadyAt: s.breachReadyAt });
  const before = pick(await state(page)); await page.waitForTimeout(1000); const after = pick(await state(page));
  assert.deepEqual(after, before, 'pause keeps the runtime and the clock');
  await control(page, []);
  await page.getByRole('button', { name: /Keep munching/ }).click();
  await untilGameTime(page, s => s.mode === 'playing', 2, 'resume');
  await page.waitForTimeout(300);
  assert.ok((await state(page)).time > before.time, 'time advances after resume');
  assert.deepEqual(errors, []);
});

check('17', 'Kept coast save', async () => {
  const { page, errors } = await newPage();
  const coast = await makeFixture(page, { path: ['shore_walker'], coast: true });
  await openGame(page, { storage: { [KEYS.v4]: coast.json } });
  await page.locator('#home-notes .home-note.kept').waitFor();
  assert.match(await page.locator('#home-notes .home-note.kept').textContent(), /lives on the coast/);
  await start(page);
  await eatOnce(page, 'eat once');
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3);
  assert.equal((await state(page)).loadedKey, KEYS.fresh, 'the fresh run resumes from -v4-fresh');
  await start(page); assert.ok((await state(page)).bites >= 1, 'the meal was kept');
  assert.equal(await storageOf(page, KEYS.v4), coast.json, '-v4 still holds the coast fixture');
  assert.deepEqual(errors, []);
});

check('18', 'Legacy key untouched', async () => {
  const { page, errors } = await newPage();
  const v2 = await makeFixture(page, { legacy: 'v2' });
  await openGame(page, { storage: { [KEYS.v2]: v2.json } });
  assert.equal((await state(page)).loadedKey, KEYS.v2);
  await start(page);
  await eatOnce(page, 'eat once');
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3);
  assert.equal(await storageOf(page, KEYS.v2), v2.json, '-v2 bytes are unchanged');
  const migrated = JSON.parse(await storageOf(page, KEYS.v4));
  assert.equal(migrated.version, 4); assert.equal(migrated.bites, JSON.parse(v2.json).bites + 1, '-v4 holds the migrated run with the new meal');
  assert.equal((await state(page)).loadedKey, KEYS.v4);
  assert.deepEqual(errors, []);
});

const failures = [];
try {
  for (const c of checks) {
    if (only.length && !only.includes(c.id)) continue;
    const t0 = Date.now();
    try { await c.fn(); console.log(`ok   ${c.id}. ${c.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
    catch (error) { failures.push(c.id); console.log(`FAIL ${c.id}. ${c.name}: ${error.message}`); }
    finally { for (const context of browser.contexts()) await context.close(); }
  }
} finally { await browser.close(); }
if (failures.length) { console.log(`FAILED: ${failures.join(', ')}`); process.exit(1); }
console.log(`PASSED: ${only.length ? `checks ${only.join(', ')}` : 'all 18 checks (with 5b, 5c, 5d, 7b, 7c, 10b and 12b)'}: path screen, customize fallback, submit failure, evolve editor, swimmer and crawler limits, soft world edge, solid reef rocks, block hints, high spawn recovery, bite at the floor, transformation path, diet lock, size pricing, desktop and touch gestures, chorded mouse buttons, allocation, lost abilities, hazards and invulnerability, pose agreement, faint during a Breach, pause, kept coast save, legacy keys.`);
