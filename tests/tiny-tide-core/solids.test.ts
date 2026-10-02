// tests/tiny-tide-core/solids.test.ts — owner playtest P4: rock and arch solids in admission, motion, growth, the ecosystem and spawning.
import { describe, expect, it } from 'vitest';
import { PLAYER_HALF, SIZES, WATER_LEVEL, WORLD_HALF, makeBiomes, random, spawnPoint } from '../../src/tiny-tide/biomes';
import { newRuntime, type Actor, type CombatRuntime, type Orientation, type Terrain, type Vec3, type WorldQueries } from '../../src/tiny-tide/combat-types';
import { Ecosystem, speciesActor } from '../../src/tiny-tide/ecosystem';
import { derive, effectiveStats, starterFor } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { growthPose, newTrapWatch, RESCUE_FREE, RESCUE_FREE_REPEAT, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, FRAME_ADMISSIONS, rescueBudget, UnstickSearch, wedged } from '../../src/tiny-tide/lifecycle';
import { startAnchor } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { PLANS, plan } from '../../src/tiny-tide/plans';
import { blockHint, newTapWatch, stepPlayer, TAP_STALL_SECONDS, tapTargetStalled, type PlayerStepResult } from '../../src/tiny-tide/player-motion';
import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { archShapes, placeReef, REEF_LAYERS, REEF_MESHES, rockShape, stageSolids } from '../../src/tiny-tide/reef';
import { meshShape, newContact, pointInSolid, solidOf, SolidIndex, sphereShape, type EllipsoidShape, type Solid } from '../../src/tiny-tide/solids';
import { SPECIES } from '../../src/tiny-tide/species';
import { STAGES } from '../../src/tiny-tide/state';
import { admissionCount, makeTerrain, makeWorldQueries, stageBounds, stageWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { REEF_SEEDS } from './glb';

/** The slow tier (fix round 4): TIDE_SLOW=1 runs the long property tests in full (all seeds, long bodies, more solids); without it
 *  each runs a smoke version (one seed, the starter body, fewer solids). See docs/TINY-TIDE.md "Verification". */
const SLOW = Boolean(process.env.TIDE_SLOW);
const tier = SLOW ? 'slow tier' : 'smoke';
const flat = (surface = WATER_LEVEL): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });
const O = { yaw: 0, pitch: 0 };
const index = (solids: Solid[], cell = 8) => new SolidIndex(solids, cell);
const inAnySolid = (ix: SolidIndex, p: Vec3) => ix.solidAt(p.x, p.y, p.z) !== null;

/** main.ts's trap rescue around the player step: the watch, the search in slices (what the step left of FRAME_ADMISSIONS) and the
 *  glide (one admitted path pose a frame). `worstFrame`: the most admissions a frame with a search slice spent (step and slice). */
function rescuer(a: Actor, q: WorldQueries, bounds: { half: number; maxY?: number } | undefined, ground: boolean) {
  const watch = newTrapWatch(), L = a.bodyLength, stats = { rescues: 0, failed: 0, recov: 0, ends: [] as Vec3[], paths: [] as Vec3[][], worstFrame: 0 };
  let search: UnstickSearch | null = null, glide: { path: { position: Vec3; orientation: Orientation }[]; index: number } | null = null;
  const frame = (pos: Vec3, rt: CombatRuntime, wish: Vec3, f: number, step: () => PlayerStepResult): Vec3 => {
    if (glide) {
      const pose = glide.path[glide.index++]!;
      expect(q.overlapHull(a, pose.position, pose.orientation, { time: (f + 1) / 60, bounds }).ok, 'every glide pose is admitted').toBe(true);
      rt.orientation = { ...pose.orientation }; rt.controlledVelocity = { x: 0, y: 0, z: 0 };
      rt.groundOffset = ground ? Math.max(0, pose.position.y - (supportHeight(a, pose.position.x, pose.position.z, rt.orientation, q.terrain) + .01 * L)) : 0;
      if (glide.index >= glide.path.length) glide = null;
      return pose.position;
    }
    const before = admissionCount.n, r = step(), stepped = admissionCount.n - before;
    if (r.needsRecovery) { stats.recov++; return pos; }
    const p = r.position;
    if (!search && trapDue(watch, p, wish, L, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), 1 / 60)) search = new UnstickSearch(a, { ...p }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { queries: q, bounds, time: (f + 1) / 60, ground }, rescueFreeRun(watch, p, f / 60, L));
    if (search) {
      const spent = search.spent, u = Math.hypot(p.x - search.at.x, p.z - search.at.z) > TRAP_MOVE * L ? { ok: false as const, reason: 'moved' } : search.step(rescueBudget(stepped));
      stats.worstFrame = Math.max(stats.worstFrame, stepped + search.spent - spent);
      if (u) { const at = search.at; search = null; if (u.ok) { glide = { path: u.path, index: 0 }; stats.rescues++; stats.ends.push(u.position); stats.paths.push(u.path.map(x => x.position)); trapRescued(watch, at, f / 60); } else if (u.reason !== 'moved') { stats.failed++; trapFailed(watch, at, wish); } }
    }
    return p;
  };
  return { stats, frame };
}

describe('solid shapes', () => {
  it('measures the distance to an ellipsoid exactly and points the normal out of it', () => {
    const rand = random(5);
    for (let n = 0; n < 200; n++) {
      const e: EllipsoidShape = { kind: 'ellipsoid', x: rand() * 4, y: rand() * 4, z: rand() * 4, a: .3 + rand() * 3, b: .3 + rand() * 2, c: .3 + rand() * 3, yaw: rand() * 7 };
      const p = { x: e.x + (rand() - .5) * 12, y: e.y + (rand() - .5) * 8, z: e.z + (rand() - .5) * 12 };
      // Brute force: the nearest of 20 000 surface points.
      let best = Infinity;
      for (let i = 0; i <= 100; i++) for (let j = 0; j < 200; j++) {
        const ph = Math.PI * i / 100, th = 2 * Math.PI * j / 200, u = e.a * Math.sin(ph) * Math.cos(th), v = e.b * Math.cos(ph), w = e.c * Math.sin(ph) * Math.sin(th);
        const co = Math.cos(e.yaw), si = Math.sin(e.yaw);
        best = Math.min(best, Math.hypot(e.x + u * co + w * si - p.x, e.y + v - p.y, e.z - u * si + w * co - p.z));
      }
      const c = newContact(); c.depth = -Infinity;
      if (!sphereShape(e, p.x, p.y, p.z, 100, c)) throw new Error('no contact');
      const inside = ((p.x - e.x) * Math.cos(e.yaw) - (p.z - e.z) * Math.sin(e.yaw)) ** 2 / e.a ** 2 + (p.y - e.y) ** 2 / e.b ** 2 + ((p.x - e.x) * Math.sin(e.yaw) + (p.z - e.z) * Math.cos(e.yaw)) ** 2 / e.c ** 2 < 1;
      if (inside) continue;
      expect(100 - c.depth).toBeLessThanOrEqual(best + 1e-9);
      expect(100 - c.depth).toBeGreaterThan(best - .08 * Math.max(e.a, e.b, e.c));
      // The normal points from the closest point toward p.
      expect(c.nx * (p.x - c.px) + c.ny * (p.y - c.py) + c.nz * (p.z - c.pz)).toBeGreaterThan(0);
    }
  });
  it('lists exactly the solids whose bounds meet a box', () => {
    const rand = random(9), solids: Solid[] = [];
    for (let i = 0; i < 300; i++) solids.push(solidOf(`r${i}`, 'rock', [rockShape((rand() - .5) * 400, 0, (rand() - .5) * 400, 1 + rand() * 9, 1 + rand() * 5, 1 + rand() * 9, rand() * 7)]));
    const ix = index(solids, 12);
    for (let n = 0; n < 200; n++) {
      const x = (rand() - .5) * 400, z = (rand() - .5) * 400, h = rand() * 30, box = [x - h, x + h, -h, h, z - h, z + h] as const;
      ix.gather(...box);
      const got = [...ix.found.slice(0, ix.count)].map(i => solids[i]!.id).sort();
      const want = solids.filter(s => !(s.maxX < box[0] || s.minX > box[1] || s.maxY < box[2] || s.minY > box[3] || s.maxZ < box[4] || s.minZ > box[5])).map(s => s.id).sort();
      expect(got).toEqual(want);
    }
  });
});

// A rock (radius ~ 3 swimmer bodies) and the stage 1 Swimmer.
const swimmer = plan('swimmer')!, g1 = starterFor(swimmer);
const actor1 = playerActor(swimmer, g1, 1, 1), L1 = actor1.bodyLength;
const rock = solidOf('rock:test', 'rock', [rockShape(0, -4, 0, 18, 30, 22, .4)]);
describe('admission against solids', () => {
  const q = makeWorldQueries(flat(), { solids: index([rock]) }), plain = makeWorldQueries(flat());
  it('refuses a hull inside a rock with the solid constraint, its id and an outward normal', () => {
    const at = { x: 6, y: 10, z: 0 }, a = q.overlapHull(actor1, at, O, { time: 0 });
    expect(plain.overlapHull(actor1, at, O, { time: 0 }).ok).toBe(true);
    expect(a.ok).toBe(false); expect(a.constraint).toBe('solid'); expect(a.solidId).toBe('rock:test');
    expect(a.normal!.x).toBeGreaterThan(0);
  });
  it('names the rock in the block hint', () => {
    expect(blockHint(swimmer, { point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, constraint: 'solid', distanceFraction: 0, time: 0, solidId: 'rock:test' })).toBe('A rock is in the way.');
  });
  it('admits the hull clear of the rock', () => {
    expect(q.overlapHull(actor1, { x: 60, y: 10, z: 0 }, O, { time: 0 }).ok).toBe(true);
  });
});

/** Swims the stage 1 Swimmer with the real player step; returns the track, the contacts and whether every installed pose was admitted. */
function swim(queries: ReturnType<typeof makeWorldQueries>, from: Vec3, wish: Vec3, frames: number, a: Actor = actor1, planId = 'swimmer', stage = 1) {
  const p = plan(planId)!, g = starterFor(p), size = SIZES[stage]!, rt = newRuntime({ yaw: Math.atan2(wish.x, wish.z), pitch: 0 }), bounds = { half: 1e6 };
  const top = STAGES[stage]!.speed * derive(effectiveStats(g, p)).speedFactor, track: Vec3[] = [from], contacts: { frame: number; constraint: string; normal: Vec3; solidId?: string }[] = [];
  let pos = from, refused = 0, recover = 0;
  for (let f = 0; f < frames; f++) {
    const r = stepPlayer(pos, rt, RELEASED, { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor: a, queries, bounds, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
    if (r.needsRecovery) { recover++; continue; }
    pos = r.position; track.push(pos);
    if (!queries.overlapHull(a, pos, rt.orientation, { time: (f + 1) / 60, bounds }).ok) refused++;
    for (const c of r.contacts) contacts.push({ frame: f, constraint: c.constraint, normal: c.normal, solidId: c.solidId });
  }
  return { track, contacts, refused, recover, speed: top * movement(p.movement).speedMultiplier * size };
}

describe('the player against solids', () => {
  it('a Swimmer swimming into a rock at a glancing angle slides around it (≥ 80 % of the ideal tangent travel), never refused', () => {
    const q = makeWorldQueries(flat(), { solids: index([rock]) });
    // Aimed past the centre by half the rock's reach: a glancing approach. y is the rock's mid height.
    const from = { x: -70, y: 14, z: -12 }, wish = { x: 1, y: 0, z: 0 }, r = swim(q, from, wish, 360);
    expect(r.refused).toBe(0); expect(r.recover).toBe(0);
    const touching = r.contacts.filter(c => c.constraint === 'solid');
    expect(touching.length).toBeGreaterThan(5); expect(touching.every(c => c.solidId === 'rock:test')).toBe(true);
    // Per contact frame: the travel against the ideal (the wish speed along the tangent of that frame's normal).
    let travel = 0, ideal = 0;
    const frames = new Map<number, Vec3>(); for (const c of touching) if (!frames.has(c.frame)) frames.set(c.frame, c.normal);
    for (const [f, n] of frames) {
      if (f < 30) continue;   // past the acceleration
      const a = r.track[f]!, b = r.track[f + 1]!, d = wish.x * n.x + wish.y * n.y + wish.z * n.z;
      travel += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      ideal += r.speed / 60 * Math.hypot(wish.x - d * n.x, wish.y - d * n.y, wish.z - d * n.z);
    }
    expect(travel / ideal, `slide ${(travel / ideal).toFixed(3)}`).toBeGreaterThanOrEqual(.8);
    // It got past the rock and kept going.
    const end = r.track[r.track.length - 1]!; expect(end.x).toBeGreaterThan(rock.maxX + 2 * L1);
  });
  it('a Swimmer swims through the opening of a big arch without touching it', () => {
    const arch = solidOf('arch:test', 'arch', archShapes(0, 0, 0, REEF_LAYERS[2] * .7, 0)), q = makeWorldQueries(flat(), { solids: index([arch]) });
    // The arch's span is along x (yaw 0), so its opening faces z. Mid height of the opening.
    const r = swim(q, { x: 0, y: 12, z: -60 }, { x: 0, y: 0, z: 1 }, 420);
    expect(r.refused).toBe(0); expect(r.contacts.filter(c => c.constraint === 'solid')).toEqual([]);
    expect(r.track[r.track.length - 1]!.z).toBeGreaterThan(60);
  });
  it('a Swimmer into an arch leg is stopped by it', () => {
    const arch = solidOf('arch:test', 'arch', archShapes(0, 0, 0, REEF_LAYERS[1] * .7, 0)), q = makeWorldQueries(flat(), { solids: index([arch]) });
    const r = swim(q, { x: -5.5, y: 3, z: -30 }, { x: 0, y: 0, z: 1 }, 240);
    expect(r.refused).toBe(0); expect(r.contacts.some(c => c.constraint === 'solid' && c.solidId === 'arch:test')).toBe(true);
  });
  it('a Crawler walking into a rock is blocked by it, slides along it on the seabed, and is never refused', () => {
    const crawler = plan('crawler')!, a = playerActor(crawler, starterFor(crawler), 1, 1), t = flat(), q = makeWorldQueries(t, { solids: index([rock]) });
    const y0 = supportHeight(a, -70, -12, O, t) + .01 * a.bodyLength, r = swim(q, { x: -70, y: y0, z: -12 }, { x: 1, y: 0, z: 0 }, 420, a, 'crawler', 1);
    expect(r.refused).toBe(0); expect(r.recover).toBe(0);
    expect(r.contacts.some(c => c.constraint === 'solid')).toBe(true);
    // Rocks are walls for ground plans: the body stays on the seabed's support line.
    for (const p of r.track) expect(p.y).toBeLessThan(y0 + .05 * a.bodyLength);
    expect(r.track[r.track.length - 1]!.x).toBeGreaterThan(rock.maxX);
    for (const p of r.track) expect(inAnySolid(index([rock]), p)).toBe(false);
  });
});

describe('a tap-to-walk target behind a tall rock (owner ruling M12: tall rocks and arches are walls for ground plans)', () => {
  /** A Crawler walks to a tap target as main.ts does: the wish points at the target, and the target is cleared when it is reached
   *  (.25 local units) or when the walk makes no progress for TAP_STALL_SECONDS. Returns the frame it was cleared and why. */
  const walk = (q: ReturnType<typeof makeWorldQueries>, target: Vec3, frames: number) => {
    const crawler = plan('crawler')!, g = starterFor(crawler), a = playerActor(crawler, g, 1, 1), size = SIZES[1]!, t = q.terrain, watch = newTapWatch();
    const top = STAGES[1]!.speed * derive(effectiveStats(g, crawler)).speedFactor, rt = newRuntime({ yaw: Math.PI / 2, pitch: 0 });
    let pos: Vec3 = { x: -70, y: supportHeight(a, -70, 0, O, t) + .01 * a.bodyLength, z: 0 }, firstContact = -1;
    for (let f = 0; f < frames; f++) {
      const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz) / size;
      if (d < .25) return { cleared: f, why: 'reached', firstContact };
      if (tapTargetStalled(watch, d, 1 / 60)) return { cleared: f, why: 'stalled', firstContact };
      const r = stepPlayer(pos, rt, RELEASED, { plan: crawler, profile: movement(crawler.movement), caps: movementCapabilities(crawler), actor: a, queries: q, bounds: { half: 1e6 }, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: dx / Math.hypot(dx, dz), y: 0, z: dz / Math.hypot(dx, dz) }, aim: null, actionLock: false });
      if (firstContact < 0 && r.contacts.some(c => c.constraint === 'solid')) firstContact = f;
      pos = r.position;
    }
    return { cleared: -1, why: 'never', firstContact };
  };
  it('clears the target about a second after a head-on stop at the rock', () => {
    const wall = solidOf('rock:wall', 'rock', [rockShape(0, -4, 0, 18, 30, 22, 0)]), q = makeWorldQueries(flat(), { solids: index([wall]) });
    const r = walk(q, { x: 70, y: 0, z: 0 }, 60 * 30);
    expect(r.why).toBe('stalled');
    expect(r.firstContact).toBeGreaterThan(0);
    expect((r.cleared - r.firstContact) / 60).toBeGreaterThanOrEqual(TAP_STALL_SECONDS - .05);
    expect((r.cleared - r.firstContact) / 60).toBeLessThanOrEqual(TAP_STALL_SECONDS + .5);
  });
  it('keeps the target while the walk makes progress, until it is reached', () => {
    const r = walk(makeWorldQueries(flat()), { x: 30, y: 0, z: 0 }, 60 * 60);
    expect(r.why).toBe('reached');
  });
});

describe('a ground creature touching a rock or an arch can always move away from it (continuation: crawler freeze)', () => {
  /** 2.5 s: a slide away, or a slide into a wedge, the trap rescue (TRAP_SECONDS .75 s, the search in slices, a .15 s glide) and
   *  walking on (fix round 2: 2 s → 2.5 s; a long Shellback that slid along rock:1:2 of seed 99 needed 2.1 s for .3 L). */
  const AWAY_FRAMES = 150;
  /** The crawler bodies of the test: the starter, a long thin spine and a short wide one (the journey edits within these ranges). */
  const bodies = (planId: string) => {
    const g = starterFor(plan(planId)!);
    return [g, { ...g, spine: Array.from({ length: 7 }, () => ({ radius: .3, height: .3, lift: 0 })) }, { ...g, spine: [{ radius: 1.1, height: .6, lift: 0 }, { radius: 1.2, height: .7, lift: 0 }, { radius: 1, height: .6, lift: 0 }] }];
  };
  for (const [planId, stage] of [['crawler', 1], ['shellback', 2], ['burrower', 2]] as const) it(`${planId} (stage ${stage}, ${tier}): from a contact with every nearby solid, 2.5 s of input away from it frees the body (≥ .3 L from the contact), or it stops in a corner it can back out of`, () => {
    const p0 = plan(planId)!, size = SIZES[stage]!, caps = movementCapabilities(p0), profile = movement(p0.movement), fails: string[] = [];
    let cases = 0, unstuck = 0;
    const slower: string[] = [], corners: string[] = [];
    for (const seed of SLOW ? [1402777635, 4242, 99] : [1402777635]) {
      const q = stageWorldQueries(stage, seed), t = q.terrain, bounds = stageBounds(stage);
      const near = stageSolids(stage, seed).solids.filter(s => Math.max(Math.abs(s.minX + s.maxX), Math.abs(s.minZ + s.maxZ)) / 2 < 30 * size);
      for (const g of SLOW ? bodies(planId) : bodies(planId).slice(0, 1)) {
        const a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
        const step = (pos: Vec3, rt: ReturnType<typeof newRuntime>, wish: Vec3, f: number) => stepPlayer(pos, rt, RELEASED, { plan: p0, profile, caps, actor: a, queries: q, bounds, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
        for (const solid of near.slice(0, planId === 'crawler' ? 24 : SLOW ? 10 : 6)) for (let k = 0; k < 6; k++) {   // stage 1: most rocks are low steps, so more of them
          // Walk toward the solid's centre from 2 L outside its bounds until it stops the body.
          const cx = (solid.minX + solid.maxX) / 2, cz = (solid.minZ + solid.maxZ) / 2, ang = k * Math.PI / 3, R = Math.max(solid.maxX - solid.minX, solid.maxZ - solid.minZ) / 2 + 2 * L;
          const x0 = cx + Math.cos(ang) * R, z0 = cz + Math.sin(ang) * R, o = { yaw: Math.atan2(cx - x0, cz - z0), pitch: 0 }, rt = newRuntime(o);
          let pos: Vec3 = { x: x0, y: supportHeight(a, x0, z0, o, t) + .01 * L, z: z0 }, normal: Vec3 | null = null, f = 0;
          if (!q.overlapHull(a, pos, o, { time: 0, bounds }).ok) continue;
          for (; f < 600 && !normal; f++) {
            const d = Math.hypot(cx - pos.x, cz - pos.z), r = step(pos, rt, { x: (cx - pos.x) / d, y: 0, z: (cz - pos.z) / d }, f);
            if (r.needsRecovery) break;
            pos = r.position; const c = r.contacts.find(c => c.constraint === 'solid' && c.solidId === solid.id); if (c) normal = c.normal;
          }
          if (!normal || Math.hypot(normal.x, normal.z) < .2) continue;
          cases++;
          // Then input along the contact normal's horizontal part (away from the solid), with the game's trap rescue (main.ts).
          const hl = Math.hypot(normal.x, normal.z), away = { x: normal.x / hl, y: 0, z: normal.z / hl }, from = pos, rescue = rescuer(a, q, bounds, caps.ground);
          for (let e = 0; e < AWAY_FRAMES; e++, f++) { const at = pos, ff = f; pos = rescue.frame(pos, rt, away, f, () => step(at, rt, away, ff)); }
          const recov = rescue.stats.recov, failedRescues = rescue.stats.failed; unstuck += rescue.stats.rescues;
          // Free again: ≥ .3 L from the contact spot. (Straight along the first normal is not always free: in a cluster of solids the
          // way out can be around a second one; the measure along it is in the message.)
          const moved = Math.hypot(pos.x - from.x, pos.z - from.z), along = (pos.x - from.x) * away.x + (pos.z - from.z) * away.z;
          if (along < .3 * L) slower.push(`${solid.id} ${(along / L).toFixed(2)} L along`);
          // A body that slid into a concave corner of other solids (two walls ahead of it) is not trapped as long as it can back out:
          // 1.5 s of the opposite input moves it ≥ .3 L (fix round 3; .1 L in round 2: the rescue is only for real wedges, and the hull's path must be free).
          let backed = Infinity;
          if (moved < .3 * L) {
            const back = { x: -away.x, y: 0, z: -away.z }, start = pos, rescue2 = rescuer(a, q, bounds, caps.ground);
            for (let e = 0; e < 90; e++, f++) { const at = pos, ff = f; pos = rescue2.frame(pos, rt, back, f, () => step(at, rt, back, ff)); }
            backed = Math.hypot(pos.x - start.x, pos.z - start.z);
            if (backed >= .3 * L) corners.push(`${solid.id} (${(moved / L).toFixed(2)} L, then backed out ${(backed / L).toFixed(2)} L)`);
          }
          if ((moved < .3 * L && backed < .3 * L) || recov > 0) fails.push(`seed ${seed} ${solid.id} body ${g.spine.length} segs dir ${k}: moved ${(moved / L).toFixed(3)} L, backed ${(backed / L).toFixed(3)} L, recoveries ${recov}, failed rescues ${failedRescues}`);
        }
      }
    }
    console.log(`${planId}: ${cases} contact cases, ${unstuck} trap rescues; out around another solid (under .3 L along the normal): ${slower.join(', ') || 'none'}; stopped in a corner and backed out: ${corners.join(', ') || 'none'}`);
    // Fewer cases since bodies step over low rocks (fix round 2) and the belly sits low over them (round 3): most stage-1 rocks.
    expect(cases, 'contact cases').toBeGreaterThanOrEqual(SLOW ? 10 : 2);
    expect(fails, `${fails.length} of ${cases}`).toEqual([]);
  }, SLOW ? 900_000 : 120_000);   // slow tier: 2–6 min alone (the crawler case tests 24 solids)
});

describe('ground plans step over low rocks (owner decision, fix round 2)', () => {
  /** A real mesh rock (reef_rock_0) on flat ground, its top `top` body lengths over the seabed, `wide` body lengths across. */
  const meshRock = (L: number, top: number, wide: number) => {
    const sy = top * L / .87, sx = wide * L / 2, sz = wide * L / 1.7;
    return solidOf('rock:test', 'rock', REEF_MESHES.reef_rock_0.map(m => meshShape(m, 0, top * L - .851 * sy, 0, sx, sy, sz, .3)));
  };
  const cases: [string, number, number][] = [['crawler', 1, 4], ['shellback', 2, 4], ['colossus', 3, 7]];
  const genomeOf = (planId: string, segments: number) => { const g = starterFor(plan(planId)!); return segments === g.spine.length ? g : { ...g, spine: Array.from({ length: segments }, (_, i) => g.spine[Math.min(i, g.spine.length - 1)]!) }; };
  const cross = (planId: string, stage: number, segments: number, rock: (L: number) => Solid) => {
    const p0 = plan(planId)!, g = genomeOf(planId, segments), a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, size = SIZES[stage]!, solid = rock(L);
    const q = makeWorldQueries(flat(), { solids: index([solid], 4 * size) }), top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
    const rt = newRuntime({ yaw: Math.PI / 2, pitch: 0 });
    const x0 = solid.minX - 2 * L;
    let pos: Vec3 = { x: x0, y: supportHeight(a, x0, 0, rt.orientation, q.terrain) + .01 * L, z: 0 }, refused = 0, recov = 0, maxRise = 0, slow = 0, maxStepUp = 0;
    const base = pos.y, speed = top * movement(p0.movement).speedMultiplier * size;
    for (let f = 0; f < 360; f++) {
      const r = stepPlayer(pos, rt, RELEASED, { plan: p0, profile: movement(p0.movement), caps: movementCapabilities(p0), actor: a, queries: q, bounds: { half: 1e6 }, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: 1, y: 0, z: 0 }, aim: null, actionLock: false });
      if (r.needsRecovery) { recov++; continue; }
      if (!q.overlapHull(a, r.position, rt.orientation, { time: (f + 1) / 60 }).ok) refused++;
      maxStepUp = Math.max(maxStepUp, (r.position.y - pos.y) / L);
      if (f > 30 && pos.x < solid.maxX + L && r.position.x - pos.x < .3 * speed / 60) slow++;
      pos = r.position; maxRise = Math.max(maxRise, (pos.y - base) / L);
      if (pos.x > solid.maxX + 2 * L) break;
    }
    return { pos, L, refused, recov, maxRise, slow, maxStepUp, solid };
  };
  // Fix round 3 (re-review 2 I1): on a low rock the belly is as close to the stone as it is to the seabed. The gap is how far the hull
  // without its animation margins (sway and heave 0) can drop before it touches the rock or the seabed, over the middle of the rock.
  const bare = (a: Actor): Actor => ({ ...a, hull: a.hull.map(c => ({ ...c, sway: 0, heave: 0 })) });
  const dropGap = (a: Actor, q: WorldQueries, p: Vec3, o: Orientation) => {
    const b = bare(a), L = a.bodyLength; let lo = 0, hi = .8 * L;
    if (q.overlapHull(b, { ...p, y: p.y - hi }, o, { time: 0 }).ok) return hi;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (q.overlapHull(b, { ...p, y: p.y - m }, o, { time: 0 }).ok) lo = m; else hi = m; }
    return lo;
  };
  for (const [planId, stage, segments] of [['crawler', 1, 4], ['shellback', 2, 4], ['colossus', 3, 3], ['colossus', 3, 7]] as const) it(`a ${planId} (${segments} segments) rides over low rocks with the belly as close to the stone as to the seabed (≤ max(.06 L, its seabed gap + .01 L))`, () => {
    const p0 = plan(planId)!, g = genomeOf(planId, segments), a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, size = SIZES[stage]!, rows: string[] = [];
    for (const h of [.05, .1, .14]) {
      const solid = meshRock(L, h, 1.2), q = makeWorldQueries(flat(), { solids: index([solid], 4 * size) }), top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
      // On top: within 8 % of the rock's width of its middle. The shoulders (to 25 %) are reported too.
      const rt = newRuntime({ yaw: Math.PI / 2, pitch: 0 }), x0 = solid.minX - 2 * L, mid = (solid.maxX - solid.minX) * .08, shoulder = (solid.maxX - solid.minX) * .25;
      let pos: Vec3 = { x: x0, y: supportHeight(a, x0, 0, rt.orientation, q.terrain) + .01 * L, z: 0 }, onTop = 0, worst = 0, shoulders = 0;
      const seabed = dropGap(a, q, pos, rt.orientation);
      for (let f = 0; f < 400 && pos.x < solid.maxX + L; f++) {
        const r = stepPlayer(pos, rt, RELEASED, { plan: p0, profile: movement(p0.movement), caps: movementCapabilities(p0), actor: a, queries: q, bounds: { half: 1e6 }, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: 1, y: 0, z: 0 }, aim: null, actionLock: false });
        if (r.needsRecovery) continue;
        pos = r.position;
        if (Math.abs(pos.x) < mid) { onTop++; worst = Math.max(worst, dropGap(a, q, pos, rt.orientation)); }
        else if (Math.abs(pos.x) < shoulder) shoulders = Math.max(shoulders, dropGap(a, q, pos, rt.orientation));
      }
      rows.push(`rock ${h} L: seabed gap ${(seabed / L).toFixed(3)} L, gap on top ${(worst / L).toFixed(3)} L (${onTop} frames), on the shoulders ${(shoulders / L).toFixed(3)} L`);
      expect(onTop, rows.at(-1)).toBeGreaterThan(0);
      // Target: as close as on the seabed (≤ .06 L, or the body's own seabed gap + .01 L). Measured (fix round 3): Crawler .052–.055,
      // Shellback .040–.043, Colossus .065–.068 (its seabed gap .068), 7-segment Colossus .030 L; before: .21–.32 L.
      expect(worst / L, rows.at(-1)).toBeLessThanOrEqual(Math.max(.06, seabed / L + .01));
    }
    console.log(`${planId} ${segments}: ${rows.join('; ')}`);
  });
  for (const [planId, stage, segments] of cases) {
    it(`a ${planId} (${segments} segments) walks across a rock .1 L high without stopping, and rides over it smoothly`, () => {
      const r = cross(planId, stage, segments, L => meshRock(L, .1, 1.2));
      expect({ refused: r.refused, recov: r.recov }).toEqual({ refused: 0, recov: 0 });
      expect(r.pos.x, 'got across').toBeGreaterThan(r.solid.maxX + .5 * r.L);
      expect(r.maxRise, 'rode up over the rock').toBeGreaterThan(.05);
      expect(r.slow, 'frames under 30 % speed while crossing').toBeLessThanOrEqual(6);
      expect(r.maxStepUp, 'no snap up (per frame)').toBeLessThanOrEqual(.04);
    });
    it(`a ${planId} (${segments} segments) does not step onto a rock .4 L high (a wall)`, () => {
      // 6 L across, hit in the middle: in the walk's time the body does not get past it, and it never rides up onto it.
      const r = cross(planId, stage, segments, L => meshRock(L, .4, 6));
      expect({ refused: r.refused, recov: r.recov }).toEqual({ refused: 0, recov: 0 });
      expect(r.pos.x).toBeLessThan(r.solid.maxX);
      expect(r.maxRise, 'never on top of the rock (its top is at .4 L; sliding along the face lifts a body a little)').toBeLessThan(.25);
    });
  }
});

describe('the Colossus reaches its food among the stage-3 rocks (re-review N1)', () => {
  // Seed 1927562791 held a crawler journey at stage 3 (274 rescues): layer-2 rocks .05–.08 L tall were walls for the Colossus.
  // Five walks toward the five nearest stage-3 foods, 15 s each, with and without the solids.
  const seed = 1927562791, stage = 3, size = SIZES[stage]!, p0 = plan('colossus')!, bounds = stageBounds(stage);
  const foods = new Ecosystem(seed).entities.filter(e => e.spec.tier === 3 && !e.eaten).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 5);
  const walk = (a: Actor, q: ReturnType<typeof makeWorldQueries>, target: Vec3, g: ReturnType<typeof starterFor>) => {
    const anchor = startAnchor(a, stage, { queries: q, bounds });
    if (!anchor.ok) throw new Error('no anchor');
    const top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor, rt = newRuntime(anchor.orientation);
    let pos = anchor.position, best = Infinity;
    for (let f = 0; f < 900; f++) {
      const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz); best = Math.min(best, d / size);
      if (d / size < .25) break;
      const r = stepPlayer(pos, rt, RELEASED, { plan: p0, profile: movement(p0.movement), caps: movementCapabilities(p0), actor: a, queries: q, bounds, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: dx / d, y: 0, z: dz / d }, aim: null, actionLock: false });
      if (!r.needsRecovery) pos = r.position;
    }
    return best;
  };
  for (const segments of SLOW ? [3, 7] : [3]) it(`a ${segments}-segment Colossus (growth 1.2, ${tier}) gets as close with the solids as without, on ${SLOW ? 'all 5' : 'the 2 nearest'} walks`, () => {
    const s0 = starterFor(p0), g = segments === s0.spine.length ? s0 : { ...s0, spine: Array.from({ length: segments }, (_, i) => s0.spine[Math.min(i, s0.spine.length - 1)]!) };
    const a = playerActor(p0, g, stage, 1.2), solid = stageWorldQueries(stage, seed), bare = makeWorldQueries(makeTerrain(stage)), rows: string[] = [];
    for (const f of SLOW ? foods : foods.slice(0, 2)) {
      const target = { x: f.x, y: 0, z: f.z }, withSolids = walk(a, solid, target, g), without = walk(a, bare, target, g);
      rows.push(`${f.spec.key} at ${(Math.hypot(f.x, f.z) / size).toFixed(1)}: closest ${withSolids.toFixed(2)} with solids, ${without.toFixed(2)} without`);
      expect(withSolids, rows.at(-1)).toBeLessThanOrEqual(without + .5);
    }
    console.log(rows.join('\n'));
  }, 60_000);
});

interface PocketHold { rescues: number; ends: Vec3[]; refused: number; recov: number; L: number; yaw: number; restFrames: number; restWorst: number; worstFrame: number }
/** Pockets on a downslope where a held push was rescued again and again (re-review 3 I-1): plan, stage, seed, the two solids, the approach. */
const POCKETS: readonly (readonly [string, number, number, string, string, number])[] = [
  ['shellback', 2, 763919134, 'rock:1:0', 'rock:1:35', 0],
  ['burrower', 2, 358833899, 'rock:1:2', 'rock:1:20', 3],
  ['shellback', 2, 1553277208, 'rock:1:4', 'rock:1:7', 3],
];
describe('the trap rescue (continuation: crawler freeze)', () => {
  const crawler = plan('crawler')!, g = starterFor(crawler), a = playerActor(crawler, g, 1, 1), L = a.bodyLength, top = STAGES[1]!.speed * derive(effectiveStats(g, crawler)).speedFactor;
  const walk = (q: ReturnType<typeof makeWorldQueries>, from: Vec3, wish: Vec3, frames: number, yaw = Math.atan2(wish.x, wish.z), keepY = false) => {
    const rt = newRuntime({ yaw, pitch: 0 }), t = q.terrain, rescue = rescuer(a, q, undefined, true);
    let pos: Vec3 = { x: from.x, y: keepY ? from.y : supportHeight(a, from.x, from.z, rt.orientation, t) + .01 * L, z: from.z }, frozen = 0, last = pos;
    for (let f = 0; f < frames; f++) {
      const at = pos, ff = f;
      pos = rescue.frame(pos, rt, wish, f, () => stepPlayer(at, rt, RELEASED, { plan: crawler, profile: movement(crawler.movement), caps: movementCapabilities(crawler), actor: a, queries: q, bounds: { half: 1e6 }, size: 4, topSpeedLocal: top, now: ff / 60, dt: 1 / 60, wish, aim: null, actionLock: false }));
      frozen = Math.hypot(pos.x - last.x, pos.z - last.z) < 1e-3 * L ? frozen + 1 : 0; last = pos;
    }
    expect(rescue.stats.recov).toBe(0);
    return { pos, rescues: rescue.stats.rescues, rescued: rescue.stats.ends, paths: rescue.stats.paths, frozen, yaw: rt.orientation.yaw };
  };
  for (const [planId, stage] of [['crawler', 1], ['shellback', 2]] as const) it(`never fires when a ${SLOW ? 'starter or long' : 'starter'} ${planId} pushes head-on into one real mesh rock (re-review N2, ${tier})`, () => {
    const p0 = plan(planId)!, s0 = starterFor(p0), g7 = { ...s0, spine: Array.from({ length: 7 }, () => ({ radius: .3, height: .3, lift: 0 })) }, size = SIZES[stage]!;
    let pushes = 0, rescues = 0, multi = 0, multiRescues = 0;
    for (const seed of SLOW ? [1402777635, 4242] : [1402777635]) {
      const q = stageWorldQueries(stage, seed), bounds = stageBounds(stage), t = q.terrain;
      const rocks = stageSolids(stage, seed).solids.filter(x => x.kind === 'rock' && Math.max(Math.abs(x.minX + x.maxX), Math.abs(x.minZ + x.maxZ)) / 2 < 30 * size).slice(0, 8);
      for (const g of SLOW ? [s0, g7] : [s0]) {
        const a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
        for (const rock of rocks) for (let k = 0; k < 4; k++) {
          const cx = (rock.minX + rock.maxX) / 2, cz = (rock.minZ + rock.maxZ) / 2, ang = k * Math.PI / 2 + .3, R = Math.max(rock.maxX - rock.minX, rock.maxZ - rock.minZ) / 2 + 1.5 * L;
          const x0 = cx + Math.cos(ang) * R, z0 = cz + Math.sin(ang) * R, wish = { x: -Math.cos(ang), y: 0, z: -Math.sin(ang) }, rt = newRuntime({ yaw: Math.atan2(wish.x, wish.z), pitch: 0 });
          let pos: Vec3 = { x: x0, y: supportHeight(a, x0, z0, rt.orientation, t) + .01 * L, z: z0 };
          if (!q.overlapHull(a, pos, rt.orientation, { time: 0, bounds }).ok) continue;
          const rescue = rescuer(a, q, bounds, true), touched = new Set<string>();
          for (let f = 0; f < 300; f++) {
            const at = pos, ff = f;
            pos = rescue.frame(pos, rt, wish, f, () => { const r = stepPlayer(at, rt, RELEASED, { plan: p0, profile: movement(p0.movement), caps: movementCapabilities(p0), actor: a, queries: q, bounds, size, topSpeedLocal: top, now: ff / 60, dt: 1 / 60, wish, aim: null, actionLock: false }); for (const c of r.contacts) if (c.solidId) touched.add(c.solidId); return r; });
          }
          // A push that also met a second solid (a rock beside an arch, two rocks) can be a real wedge: counted apart.
          if (touched.size <= 1) { pushes++; rescues += rescue.stats.rescues; } else { multi++; multiRescues += rescue.stats.rescues; }
        }
      }
    }
    console.log(`${planId}: ${pushes} pushes against one solid (${rescues} rescues); ${multi} that met two or more solids (${multiRescues} rescues)`);
    expect(pushes).toBeGreaterThan(SLOW ? 30 : 8);
    expect(rescues, `${rescues} rescues in ${pushes} head-on pushes of 5 s against one solid`).toBe(0);
  }, 120_000);
  it('a trap at the spot of a rescue in the last 10 s needs a free run of 2 L, so the next rescue gets past the pocket (fix round 3)', () => {
    const w = newTrapWatch(), L = 10, at = { x: 5, y: 0, z: 5 };
    expect(rescueFreeRun(w, at, 3, L)).toBe(RESCUE_FREE);
    trapRescued(w, at, 3);
    expect(rescueFreeRun(w, { x: 5 + .5 * L, y: 0, z: 5 }, 8, L)).toBe(RESCUE_FREE_REPEAT);
    expect(rescueFreeRun(w, { x: 5 + 2 * L, y: 0, z: 5 }, 8, L)).toBe(RESCUE_FREE);
    expect(rescueFreeRun(w, at, 14, L)).toBe(RESCUE_FREE);
  });
  /** A held push of `frames` frames into the pocket between two nearby solids of a real stage (re-review 3 I-1 and its probe): from
   *  2.5 L outside the pair, across its axis from side `k < 2 ? +1 : −1`, tilted ∓30° (k even / odd). Every installed pose is checked. */
  function pocketHold(planId: string, stage: number, seed: number, id1: string, id2: string, k: number, frames?: number, segments?: number): PocketHold;
  function pocketHold(planId: string, stage: number, seed: number, id1: string, id2: string, k: number, frames: number, segments: number, skipBlocked: true): PocketHold | null;
  function pocketHold(planId: string, stage: number, seed: number, id1: string, id2: string, k: number, frames = 600, segments = 0, skipBlocked = false): PocketHold | null {
    const p0 = plan(planId)!, s0 = starterFor(p0), g = segments ? { ...s0, spine: Array.from({ length: segments }, (_, i) => s0.spine[Math.min(i, s0.spine.length - 1)]!) } : s0;
    const a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, size = SIZES[stage]!, q = stageWorldQueries(stage, seed), t = q.terrain, bounds = stageBounds(stage);
    const top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor, solids = stageSolids(stage, seed);
    const c = (id: string) => { const s = solids.byId(id)!; return { x: (s.minX + s.maxX) / 2, z: (s.minZ + s.maxZ) / 2, r: Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 }; };
    const A = c(id1), B = c(id2), mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, ax = B.z - A.z, az = -(B.x - A.x), al = Math.hypot(ax, az) || 1;
    const side = k < 2 ? 1 : -1, tilt = (k % 2 ? 1 : -1) * Math.PI / 6, ang = Math.atan2(side * ax / al, side * az / al) + tilt;
    const R = Math.max(A.r, B.r) + 2.5 * L, x0 = mx + Math.sin(ang) * R, z0 = mz + Math.cos(ang) * R;
    const wish = { x: -Math.sin(ang), y: 0, z: -Math.cos(ang) }, rt = newRuntime({ yaw: Math.atan2(wish.x, wish.z), pitch: 0 }), rescue = rescuer(a, q, bounds, true);
    let pos: Vec3 = { x: x0, y: supportHeight(a, x0, z0, rt.orientation, t) + .01 * L, z: z0 }, refused = 0, restFrames = 0, restWorst = 0;
    const startOk = q.overlapHull(a, pos, rt.orientation, { time: 0, bounds }).ok;
    if (!startOk && skipBlocked) return null;
    expect(startOk, 'the start is admitted').toBe(true);
    for (let f = 0; f < frames; f++) {
      const at = pos, ff = f;
      let calls = -1;
      pos = rescue.frame(pos, rt, wish, f, () => {
        const n0 = admissionCount.n, r = stepPlayer(at, rt, RELEASED, { plan: p0, profile: movement(p0.movement), caps: movementCapabilities(p0), actor: a, queries: q, bounds, size, topSpeedLocal: top, now: ff / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
        calls = admissionCount.n - n0; return r;
      });
      // A step that left the body where it was (at rest against the walls).
      if (calls >= 0 && pos.x === at.x && pos.y === at.y && pos.z === at.z) { restFrames++; restWorst = Math.max(restWorst, calls); }
      if (!q.overlapHull(a, pos, rt.orientation, { time: (f + 1) / 60, bounds }).ok) refused++;
    }
    return { rescues: rescue.stats.rescues, ends: rescue.stats.ends, refused, recov: rescue.stats.recov, L, yaw: Math.atan2(wish.x, wish.z), restFrames, restWorst, worstFrame: rescue.stats.worstFrame };
  }
  // Re-review 3 I-1: the free-run check held the body at the candidate's height over a seabed that falls away, so it passed over a
  // tall rock the walking body meets; a held push got a rescue back out of the pocket about every 2 s, without end.
  for (const [planId, stage, seed, id1, id2, k] of POCKETS) it(`a ${planId} holding one push for 10 s into the downslope pocket ${id1}/${id2} (seed ${seed}) gets at most 1 rescue, every pose admitted (re-review 3 I-1)`, () => {
    const r = pocketHold(planId, stage, seed, id1, id2, k);
    expect({ refused: r.refused, recov: r.recov }).toEqual({ refused: 0, recov: 0 });
    expect(r.rescues, `rescues to ${r.ends.map(e => `(${(e.x / r.L).toFixed(2)}, ${(e.z / r.L).toFixed(2)})`).join(' ')}`).toBeLessThanOrEqual(1);
  }, 60_000);
  // The long variants (slow tier): every pocket of two solids near the start, from 4 approaches, held 10 s, starter and 7-segment
  // bodies (the reviewer's probe, re-review 3 item 4): at most 1 rescue per hold, every pose admitted, no frame with a rescue slice
  // over FRAME_ADMISSIONS.
  for (const [planId, stage] of [['crawler', 1], ['shellback', 2], ['burrower', 2]] as const) it.runIf(SLOW)(`a ${planId} holding one push for 10 s into each pocket of two solids near the start gets at most 1 rescue (slow tier)`, () => {
    const rows: string[] = [], size = SIZES[stage]!;
    let holds = 0, rescues = 0;
    for (const seed of [763919134, 358833899, 1944398416]) {
      const solids = stageSolids(stage, seed).solids.filter(s => Math.max(Math.abs(s.minX + s.maxX), Math.abs(s.minZ + s.maxZ)) / 2 < 40 * size);
      const c = (s: Solid) => ({ x: (s.minX + s.maxX) / 2, z: (s.minZ + s.maxZ) / 2, r: Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 });
      for (const segments of [0, 7]) {
        const L = playerActor(plan(planId)!, starterFor(plan(planId)!), stage, 1.2).bodyLength, pairs: [Solid, Solid][] = [];
        for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
          const A = c(solids[i]!), B = c(solids[j]!);
          if (Math.hypot(A.x - B.x, A.z - B.z) - A.r - B.r < 1.2 * L) pairs.push([solids[i]!, solids[j]!]);
        }
        for (const [s1, s2] of pairs.slice(0, 8)) for (let k = 0; k < 4; k++) {
          const r = pocketHold(planId, stage, seed, s1.id, s2.id, k, 600, segments, true);
          if (!r) continue;
          holds++; rescues += r.rescues;
          const row = `seed ${seed} ${s1.id}/${s2.id}/${k} ${segments || 'starter'}: ${r.rescues} rescues, worst frame with a slice ${r.worstFrame}`;
          if (r.rescues > 1 || r.refused > 0 || r.recov > 0 || r.worstFrame > FRAME_ADMISSIONS) rows.push(`${row}, refused ${r.refused}, recoveries ${r.recov}`);
        }
      }
    }
    console.log(`${planId}: ${holds} holds, ${rescues} rescues`);
    expect(holds).toBeGreaterThan(50);
    expect(rows).toEqual([]);
  }, 1_800_000);
  // Fix round 4: a body held against the walls of a pocket stayed still for 43 admissions a frame (4 contacts × 8 bisections), and
  // a rescue slice came on top of that (up to 110 in one frame).
  it('a body at rest against the walls of a pocket spends at most 16 admissions on a step, and a frame with a rescue slice at most FRAME_ADMISSIONS', () => {
    const rows: string[] = [];
    for (const [planId, stage, seed, id1, id2, k] of POCKETS) {
      const r = pocketHold(planId, stage, seed, id1, id2, k);
      rows.push(`${planId} ${seed} ${id1}/${id2}: ${r.restFrames} frames at rest, worst ${r.restWorst} admissions; worst frame with a rescue slice ${r.worstFrame}`);
      expect(r.refused).toBe(0);
      expect(r.restFrames, rows.at(-1)).toBeGreaterThan(30);
      expect(r.restWorst, rows.at(-1)).toBeLessThanOrEqual(16);
      expect(r.worstFrame, rows.at(-1)).toBeLessThanOrEqual(FRAME_ADMISSIONS);
    }
    console.log(rows.join('\n'));
  }, 60_000);
  it('a search slice never spends more than its budget, goes on inside a candidate, and finds what one whole search finds (fix round 4)', () => {
    // A crawler against a small rock, pushing into it: the rescue is beside the rock, after candidates whose free run or path fails.
    const rock = solidOf('rock:small', 'rock', [rockShape(0, 0, 0, 1.2 * L, 2 * L, 1.2 * L, 0)]), q = makeWorldQueries(flat(), { solids: index([rock]) });
    const o = { yaw: 0, pitch: 0 }, ctx = { queries: q, time: 0, ground: true };
    let z = -3 * L;
    while (q.overlapHull(a, { x: 0, y: supportHeight(a, 0, z + .02 * L, o, q.terrain) + .01 * L, z: z + .02 * L }, o, { time: 0 }).ok) z += .02 * L;
    const at = { x: 0, y: supportHeight(a, 0, z, o, q.terrain) + .01 * L, z };
    const whole = new UnstickSearch(a, at, 0, o, ctx).step(Infinity)!;
    expect(whole.ok, 'a rescue beside the rock').toBe(true);
    for (const budget of [1, 5, 13]) {
      const sliced = new UnstickSearch(a, at, 0, o, ctx);
      let r: ReturnType<UnstickSearch['step']> = null, slices = 0;
      while (!r) { const before = sliced.spent; r = sliced.step(budget); slices++; expect(sliced.spent - before, `slice ${slices} of budget ${budget}`).toBeLessThanOrEqual(budget); }
      expect(r, `budget ${budget}`).toEqual(whole);
    }
    const idle = new UnstickSearch(a, at, 0, o, ctx);
    expect(idle.step(0)).toBeNull(); expect(idle.spent, 'a budget of 0 spends nothing').toBe(0);
    expect(rescueBudget(43)).toBe(FRAME_ADMISSIONS - 43); expect(rescueBudget(75)).toBe(0);
  });
  it('never fires for a push into one flat wall while facing it', () => {
    const wall = solidOf('rock:wall', 'rock', [rockShape(0, -4, 0, 18, 30, 22, 0)]), q = makeWorldQueries(flat(), { solids: index([wall]) });
    const r = walk(q, { x: -70, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 300);
    expect(r.rescues).toBe(0);
  });
  it('never moves a body pushed into the tip of a V of two walls across them, and the body can back out', () => {
    // Two long walls meet at the origin and open toward −z; the push goes into the tip.
    const V = solidOf('arch:v', 'arch', [{ kind: 'capsule', x0: 0, y0: 0, z0: 0, x1: -40, y1: 0, z1: -30, radius: 1.5 }, { kind: 'capsule', x0: 0, y0: 0, z0: 0, x1: 40, y1: 0, z1: -30, radius: 1.5 }]);
    const q = makeWorldQueries(flat(), { solids: index([V]) });
    const r = walk(q, { x: 0, y: 0, z: -30 }, { x: 0, y: 0, z: 1 }, 600);
    for (const path of r.paths) for (const p of path) expect(p.z, 'the glide stays inside the V').toBeLessThan(0);
    // Pushing into the tip is pushing into walls: a rescue needs a pose from which the push is free (fix round 3), and there is none
    // inside the V, so the body stays. Backing out works.
    const back = walk(q, r.pos, { x: 0, y: 0, z: -1 }, 60, r.yaw, true);
    expect(r.pos.z - back.pos.z, 'backed out of the V').toBeGreaterThan(.3 * L);
  });
});

describe('growth lift and thin solids (P1 review, R4)', () => {
  it('stops the lift at a thin solid above the body instead of jumping past it', () => {
    const L = 2, body: Actor = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -.8 }, end: { x: 0, y: 0, z: .8 }, radius: .1 }], habitat: habitat('open-water'), bodyLength: L };
    // The body sinks .1 L into the seabed, and a thin bar lies .025 L above its top: the lift that clears the seabed (.1 L) would carry
    // the body through the bar, and the first admitted lift (about .15 L) is above it.
    const y0 = .1 - .2, bar = solidOf('arch:bar', 'arch', [{ kind: 'capsule', x0: -3, y0: y0 + .1 + .05 + .02, z0: 0, x1: 3, y1: y0 + .1 + .05 + .02, z1: 0, radius: .02 }]);
    const t = flat(), pos = { x: 0, y: y0, z: 0 }, rt = newRuntime();
    const without = makeWorldQueries(t), withBar = makeWorldQueries(t, { solids: index([bar]) });
    expect(without.overlapHull(body, pos, O, { time: 0 }).constraint).toBe('ground');
    // Without the bar the lift is found; with it, the lift would pass through the bar, so there is no lift.
    expect(growthPose(body, pos, rt, { queries: without, time: 0 })).not.toBeNull();
    expect(growthPose(body, pos, rt, { queries: withBar, time: 0 })).toBeNull();
  });
});

describe('growth lift at a rock base and between two solids (final review M6, P4 review)', () => {
  const L = 2, body: Actor = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -.8 }, end: { x: 0, y: 0, z: .8 }, radius: .1 }], habitat: habitat('open-water'), bodyLength: L };
  it('lifts a body out of the crease of the seabed and a rock base along both normals, keeping the motion', () => {
    // The body sinks .02 into the seabed and its side touches the underside of a rock that bulges over it, so a lift straight up
    // (the seabed's normal) goes deeper into the rock.
    const rock = solidOf('rock:base', 'rock', [rockShape(2.85, 1 - .15 * 3, 0, 3, 3, 3, 0)]), q = makeWorldQueries(flat(), { solids: index([rock]) }), pos = { x: 0, y: .08, z: 0 };
    expect(q.overlapHull(body, pos, O, { time: 0 }).constraint).toBe('ground');
    expect(q.overlapHull(body, { x: 0, y: .2, z: 0 }, O, { time: 0 }).constraint).toBe('solid');
    const lifted = growthPose(body, pos, newRuntime(), { queries: q, time: 0 });
    expect(lifted).not.toBeNull();
    expect(q.overlapHull(body, lifted!, O, { time: 0 }).ok).toBe(true);
    expect(Math.hypot(lifted!.x - pos.x, lifted!.y - pos.y, lifted!.z - pos.z)).toBeLessThanOrEqual(.5 * L);
    expect(lifted!.x).toBeLessThan(pos.x);   // away from the rock
  });
  it('never lifts a body out of solid A through a thin solid B above it', () => {
    // The body sinks .02 into the top of a wide flat rock A (normal +y), and a thin bar B lies .02 above its top.
    const y0 = 5, A = solidOf('rock:A', 'rock', [{ kind: 'capsule', x0: -6, y0: y0 - .1 - 1 + .02, z0: 0, x1: 6, y1: y0 - .1 - 1 + .02, z1: 0, radius: 1 }]);
    const B = solidOf('arch:B', 'arch', [{ kind: 'capsule', x0: -3, y0: y0 + .1 + .02 + .02, z0: 0, x1: 3, y1: y0 + .1 + .02 + .02, z1: 0, radius: .02 }]);
    const pos = { x: 0, y: y0, z: 0 }, onlyA = makeWorldQueries(flat(), { solids: index([A]) }), both = makeWorldQueries(flat(), { solids: index([A, B]) });
    expect(both.overlapHull(body, pos, O, { time: 0 })).toMatchObject({ constraint: 'solid', solidId: 'rock:A' });
    expect(growthPose(body, pos, newRuntime(), { queries: onlyA, time: 0 })).not.toBeNull();
    expect(growthPose(body, pos, newRuntime(), { queries: both, time: 0 })).toBeNull();
  });
});

describe('spawning and the ecosystem never use a solid (R5)', () => {
  it('spawnPoint never returns a blocked point', () => {
    const spec = SPECIES.find(s => s.key === '0:plant')!, biomes = makeBiomes(3, 0), rand = random(4);
    for (let i = 0; i < 300; i++) { const p = spawnPoint(spec, biomes, rand, undefined, (x, _y, z) => x > 0 && z > 0); expect(p.x > 0 && p.z > 0).toBe(false); }
  });
  for (const seed of REEF_SEEDS.slice(0, 5)) it(`seed ${seed}: no food, home or anchor inside a solid at any stage; every reef plant and arch foot clear`, () => {
    const eco = new Ecosystem(seed);
    let foods = 0, homes = 0, anchors = 0, checked = 0;
    for (const e of eco.entities) {
      if (e.eaten || e.spec.tier > 3) continue;
      const ix = stageSolids(e.spec.tier, seed), q = stageWorldQueries(e.spec.tier, seed); checked++;
      if (inAnySolid(ix, e) || q.overlapHull(speciesActor(e), e, O, { time: 0, bounds: { half: WORLD_HALF * SIZES[e.spec.tier]! } }).constraint === 'solid') foods++;
      if (inAnySolid(ix, { x: e.hx, y: e.hy, z: e.hz })) homes++;
    }
    for (const p of PLANS) for (const growth of [1, 1.38]) {
      if (p.size > 3 || p.needs) continue;   // coast plans have no start anchor in open sea (anchors.test.ts)
      const a = playerActor(p, starterFor(p), p.size, growth), r = startAnchor(a, p.size, { queries: stageWorldQueries(p.size, seed), bounds: { half: PLAYER_HALF * SIZES[p.size]! } });
      if (!r.ok || inAnySolid(stageSolids(p.size, seed), r.position)) anchors++;
    }
    expect(checked).toBeGreaterThan(100);
    expect({ foods, homes, anchors }).toEqual({ foods: 0, homes: 0, anchors: 0 });
  });
  it('respawned food and creatures are never inside a solid', () => {
    for (const seed of REEF_SEEDS.slice(0, 3)) {
      const eco = new Ecosystem(seed), far = { x: 1e5, y: 0, z: 1e5 };
      for (const e of eco.entities) if (e.spec.tier <= 2) { eco.consume(e); e.respawn = .01; }
      for (const stage of [0, 1, 2]) eco.step({ stage, dt: .1, now: stage, player: far, playerHull: [], perceivable: false, stealthFactor: 1 });
      for (const e of eco.entities) if (e.spec.tier <= 2 && !e.eaten) { expect(inAnySolid(stageSolids(e.spec.tier, seed), e)).toBe(false); expect(inAnySolid(stageSolids(e.spec.tier, seed), { x: e.hx, y: e.hy, z: e.hz })).toBe(false); }
    }
  });
  it('critters and hunters stay out of every solid over 600 frames near the player: no centre inside, and no hull refused as solid', () => {
    for (const [seed, stage] of [[4242, 0], [99, 1], [1501, 2]] as const) {
      const eco = new Ecosystem(seed), size = SIZES[stage]!, actors = new Map<number, Actor>();
      // The player sits by the nearest rock of its stage, so creatures move about rocks.
      const near = placeReef(stage, seed).rocks.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]!;
      const player = { x: near.x + 2 * near.sx, y: near.y + 3 * size, z: near.z }, hull = [{ start: player, end: player, radius: .6 * size }];
      let inside = 0, hullInside = 0, steps = 0;
      for (let f = 0; f < 600; f++) {
        eco.step({ stage, dt: 1 / 60, now: f / 60, player, playerHull: hull, perceivable: true, stealthFactor: 1 });
        for (const e of eco.entities) {
          if (e.eaten || !e.active || e.spec.tier > 3) continue;
          steps++;
          if (inAnySolid(stageSolids(e.spec.tier, seed), e)) inside++;
          // The whole hull (P4 review): admitted against the solids. No bounds, so a bounds rule cannot hide a solid one.
          const a = actors.get(e.id) ?? speciesActor(e); actors.set(e.id, a);
          if (stageWorldQueries(e.spec.tier, seed).overlapHull(a, e, O, { time: 0 }).constraint === 'solid') hullInside++;
        }
      }
      expect(steps).toBeGreaterThan(1000);
      expect({ inside, hullInside }, `seed ${seed} stage ${stage}`).toEqual({ inside: 0, hullInside: 0 });
    }
  });
  it('a reef plant base is never inside a solid, at every stage that collides with it', () => {
    for (const seed of REEF_SEEDS) for (let layer = 0; layer < REEF_LAYERS.length; layer++) {
      const reef = placeReef(layer, seed);
      for (const p of reef.plants) for (const s of reef.solids) expect(pointInSolid(s, p.x, p.y, p.z, p.footprint)).toBe(false);
    }
  });
});
