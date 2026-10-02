// tests/tiny-tide-core/solids.test.ts — owner playtest P4: rock and arch solids in admission, motion, growth, the ecosystem and spawning.
import { describe, expect, it } from 'vitest';
import { PLAYER_HALF, SIZES, WATER_LEVEL, WORLD_HALF, makeBiomes, random, spawnPoint } from '../../src/tiny-tide/biomes';
import { newRuntime, type Actor, type Terrain, type Vec3 } from '../../src/tiny-tide/combat-types';
import { Ecosystem, speciesActor } from '../../src/tiny-tide/ecosystem';
import { derive, effectiveStats, starterFor } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { growthPose, newTrapWatch, TRAP_MOVE, trapDue, UNSTICK_BUDGET, UnstickSearch, unstickPose, wedged } from '../../src/tiny-tide/lifecycle';
import { startAnchor } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { PLANS, plan } from '../../src/tiny-tide/plans';
import { blockHint, newTapWatch, stepPlayer, TAP_STALL_SECONDS, tapTargetStalled } from '../../src/tiny-tide/player-motion';
import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { archShapes, placeReef, REEF_LAYERS, rockShape, stageSolids } from '../../src/tiny-tide/reef';
import { newContact, pointInSolid, solidOf, SolidIndex, sphereShape, type EllipsoidShape, type Solid } from '../../src/tiny-tide/solids';
import { SPECIES } from '../../src/tiny-tide/species';
import { STAGES } from '../../src/tiny-tide/state';
import { makeWorldQueries, stageBounds, stageWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { REEF_SEEDS } from './glb';

const flat = (surface = WATER_LEVEL): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });
const O = { yaw: 0, pitch: 0 };
const index = (solids: Solid[], cell = 8) => new SolidIndex(solids, cell);
const inAnySolid = (ix: SolidIndex, p: Vec3) => ix.solidAt(p.x, p.y, p.z) !== null;

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

describe('a tap-to-walk target behind a rock (owner ruling M12: rocks stay walls for ground plans)', () => {
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
  /** 2 s: a slide away, or a slide into a wedge, the trap rescue (TRAP_SECONDS .75 s, then the search in slices) and walking on. */
  const AWAY_FRAMES = 120;
  /** The crawler bodies of the test: the starter, a long thin spine and a short wide one (the journey edits within these ranges). */
  const bodies = (planId: string) => {
    const g = starterFor(plan(planId)!);
    return [g, { ...g, spine: Array.from({ length: 7 }, () => ({ radius: .3, height: .3, lift: 0 })) }, { ...g, spine: [{ radius: 1.1, height: .6, lift: 0 }, { radius: 1.2, height: .7, lift: 0 }, { radius: 1, height: .6, lift: 0 }] }];
  };
  for (const [planId, stage] of [['crawler', 1], ['shellback', 2], ['burrower', 2]] as const) it(`${planId} (stage ${stage}): from a contact with every nearby solid, 2 s of input away from it frees the body (≥ .3 L from the contact)`, () => {
    const p0 = plan(planId)!, size = SIZES[stage]!, caps = movementCapabilities(p0), profile = movement(p0.movement), fails: string[] = [];
    let cases = 0, unstuck = 0;
    const slower: string[] = [];
    for (const seed of [1402777635, 4242, 99]) {
      const q = stageWorldQueries(stage, seed), t = q.terrain, bounds = stageBounds(stage);
      const near = stageSolids(stage, seed).solids.filter(s => Math.max(Math.abs(s.minX + s.maxX), Math.abs(s.minZ + s.maxZ)) / 2 < 30 * size);
      for (const g of bodies(planId)) {
        const a = playerActor(p0, g, stage, 1.2), L = a.bodyLength, top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
        const step = (pos: Vec3, rt: ReturnType<typeof newRuntime>, wish: Vec3, f: number) => stepPlayer(pos, rt, RELEASED, { plan: p0, profile, caps, actor: a, queries: q, bounds, size, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
        for (const solid of near.slice(0, 10)) for (let k = 0; k < 6; k++) {
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
          const hl = Math.hypot(normal.x, normal.z), away = { x: normal.x / hl, y: 0, z: normal.z / hl }, from = pos, watch = newTrapWatch();
          let recov = 0, failedRescues = 0, search: UnstickSearch | null = null;
          for (let e = 0; e < AWAY_FRAMES; e++, f++) {
            const r = step(pos, rt, away, f);
            if (r.needsRecovery) { recov++; continue; }
            pos = r.position;
            // As main.ts: the search runs UNSTICK_BUDGET candidates a frame.
            if (!search && trapDue(watch, pos, away, L, wedged(r.contacts, rt.orientation.yaw, away), 1 / 60)) search = new UnstickSearch(a, { ...pos }, Math.atan2(away.x, away.z), { ...rt.orientation }, { queries: q, bounds, time: (f + 1) / 60, ground: caps.ground });
            if (search) {
              const u = Math.hypot(pos.x - search.at.x, pos.z - search.at.z) > TRAP_MOVE * L ? { ok: false as const, reason: 'moved' } : search.step(UNSTICK_BUDGET);
              if (u) { search = null; if (u.ok) { pos = u.position; rt.orientation = { ...u.orientation }; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; unstuck++; } else if (u.reason !== 'moved') failedRescues++; }
            }
          }
          // Free again: ≥ .3 L from the contact spot. (Straight along the first normal is not always free: in a cluster of solids the
          // way out can be around a second one; the measure along it is in the message.)
          const moved = Math.hypot(pos.x - from.x, pos.z - from.z), along = (pos.x - from.x) * away.x + (pos.z - from.z) * away.z;
          if (along < .3 * L) slower.push(`${solid.id} ${(along / L).toFixed(2)} L along`);
          if (moved < .3 * L || recov > 0) fails.push(`seed ${seed} ${solid.id} body ${g.spine.length} segs dir ${k}: moved ${(moved / L).toFixed(3)} L, recoveries ${recov}, failed rescues ${failedRescues}`);
        }
      }
    }
    console.log(`${planId}: ${cases} contact cases, ${unstuck} trap rescues; out around another solid (under .3 L along the normal): ${slower.join(', ') || 'none'}`);
    expect(cases, 'contact cases').toBeGreaterThan(30);
    expect(fails, `${fails.length} of ${cases}`).toEqual([]);
  }, 120_000);
});

describe('the trap rescue (continuation: crawler freeze)', () => {
  const crawler = plan('crawler')!, g = starterFor(crawler), a = playerActor(crawler, g, 1, 1), L = a.bodyLength, top = STAGES[1]!.speed * derive(effectiveStats(g, crawler)).speedFactor;
  const walk = (q: ReturnType<typeof makeWorldQueries>, from: Vec3, wish: Vec3, frames: number) => {
    const rt = newRuntime({ yaw: Math.atan2(wish.x, wish.z), pitch: 0 }), watch = newTrapWatch(), t = q.terrain;
    let pos: Vec3 = { x: from.x, y: supportHeight(a, from.x, from.z, rt.orientation, t) + .01 * L, z: from.z }, rescues = 0, frozen = 0, last = pos;
    const rescued: Vec3[] = [];
    for (let f = 0; f < frames; f++) {
      const r = stepPlayer(pos, rt, RELEASED, { plan: crawler, profile: movement(crawler.movement), caps: movementCapabilities(crawler), actor: a, queries: q, bounds: { half: 1e6 }, size: 4, topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish, aim: null, actionLock: false });
      expect(r.needsRecovery).toBe(false); pos = r.position;
      if (trapDue(watch, pos, wish, L, wedged(r.contacts, rt.orientation.yaw, wish), 1 / 60)) {
        const u = unstickPose(a, pos, Math.atan2(wish.x, wish.z), rt.orientation, { queries: q, time: (f + 1) / 60, ground: true });
        if (u.ok) { pos = u.position; rt.orientation = { ...u.orientation }; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rescues++; rescued.push(pos); expect(q.overlapHull(a, pos, rt.orientation, { time: 0 }).ok).toBe(true); }
      }
      frozen = Math.hypot(pos.x - last.x, pos.z - last.z) < 1e-3 * L ? frozen + 1 : 0; last = pos;
    }
    return { pos, rescues, rescued, frozen };
  };
  it('never fires for a push into one flat wall while facing it', () => {
    const wall = solidOf('rock:wall', 'rock', [rockShape(0, -4, 0, 18, 30, 22, 0)]), q = makeWorldQueries(flat(), { solids: index([wall]) });
    const r = walk(q, { x: -70, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 300);
    expect(r.rescues).toBe(0);
  });
  it('frees a body pushed into a V of two walls, never across them', () => {
    // Two long walls meet at the origin and open toward −z; the push goes into the tip.
    const V = solidOf('arch:v', 'arch', [{ kind: 'capsule', x0: 0, y0: 0, z0: 0, x1: -40, y1: 0, z1: -30, radius: 1.5 }, { kind: 'capsule', x0: 0, y0: 0, z0: 0, x1: 40, y1: 0, z1: -30, radius: 1.5 }]);
    const q = makeWorldQueries(flat(), { solids: index([V]) });
    const r = walk(q, { x: 0, y: 0, z: -30 }, { x: 0, y: 0, z: 1 }, 600);
    for (const p of r.rescued) expect(p.z, 'the rescued pose stays inside the V').toBeLessThan(0);
    expect(r.frozen, 'never frozen for more than TRAP_SECONDS and a little').toBeLessThan(60);
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
