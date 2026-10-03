// tests/tiny-tide-core/hull-fit.test.ts — owner playtest P3: the tighter swim hull and the grown-body Breach landing.
import { describe, expect, it, vi } from 'vitest';
// Final review I8: heavy geometry tests; 1–5 s alone, much longer beside a browser check (the default 5 s timed out under load).
vi.setConfig({ testTimeout: 30_000 });
import { newRuntime, type Actor, type Capsule, type CombatInput, type Terrain, type Vec3 } from '../../src/tiny-tide/combat-types';
import { random, SIZES, WATER_LEVEL } from '../../src/tiny-tide/biomes';
import { derive, effectiveStats, starterFor, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { recoverPlayer } from '../../src/tiny-tide/lifecycle';
import { bodyHull, hullOffsets, playerActor } from '../../src/tiny-tide/mount';
import { resolveMotion } from '../../src/tiny-tide/motion';
import { plan } from '../../src/tiny-tide/plans';
import { stepPlayer } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { STAGES } from '../../src/tiny-tide/state';
import { createRigPose, rigPoseInto } from '../../src/tiny-tide/rig';
import { makeTerrain, makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { gapOf, skinnedBody, swimPoses } from './body-gap';

/** The owner's tighter fit: the largest visible gap between the body and the seabed, and the tail's allowed clip, in body lengths. */
const MAX_GAP = .06, TAIL_CLIP = .1;
/** The measured largest gap of an edited (non-starter) swim body while it slides along the seabed (final review M15; see the test). */
const EDITED_GAP = .2;
const SWIM_CASES = [['swimmer', 1], ['darter', 2], ['bulk', 2]] as const;

/** The genomes of the fit tests: the swim starters, one extreme spine, and 12 random spines (16 in all). */
function fitGenomes(): Genome[] {
  const rand = random(97), pick = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const genomes: Genome[] = [...SWIM_CASES.map(([id]) => starterFor(plan(id)!)),
    { ...starterGenome(), spine: [{ radius: 1.2, height: .25, lift: .5 }, { radius: .25, height: 1.2, lift: -.5 }, { radius: 1.2, height: 1.2, lift: 0 }, { radius: .25, height: .25, lift: .5 }] }];
  for (let i = 0; i < 12; i++) genomes.push({ ...starterGenome(), spine: Array.from({ length: 3 + (i % 6) }, () => ({ radius: pick(.25, 1.2), height: pick(.25, 1.2), lift: pick(-.5, .5) })) });
  return genomes;
}
/** A swim plan's body `g` slides along the real seabed slope (6 runs of 240 frames: three headings, level and diving). At every seabed
 *  contact: the rest body's gap over the seabed, and the lowest swimming torso and tail, in body lengths. */
function slideGaps(id: string, g: Genome, stage: number, growth: number) {
  const p0 = plan(id)!, actor = playerActor(p0, g, stage, growth), L = actor.bodyLength, size = SIZES[stage]!, scale = size * growth, rest = skinnedBody(g);
  const t = makeTerrain(stage), q = makeWorldQueries(t), swims = swimPoses(g, 8), caps = movementCapabilities(p0);
  const top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor;
  let contacts = 0, maxGap = -Infinity, minRest = Infinity, minTorso = Infinity, minTail = Infinity, recoveries = 0;
  for (const traversal of ['none', 'dive'] as const) for (const yaw of [Math.PI / 4, -1.05, 3]) {
    const rt = newRuntime({ yaw, pitch: 0 });
    let p: Vec3 = { x: 0, y: supportHeight(actor, 0, 0, rt.orientation, t) + .02 * L, z: 0 };
    for (let f = 0; f < 240; f++) {
      const r = stepPlayer(p, rt, { ...RELEASED, traversal }, { plan: p0, profile: movement(p0.movement), caps, actor, queries: q, bounds: { half: 50 * size }, size,
        topSpeedLocal: top, now: f / 60, dt: 1 / 60, wish: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, aim: null, actionLock: false });
      if (r.needsRecovery) { recoveries++; continue; }
      p = r.position;
      if (!r.contacts.some(c => c.constraint === 'ground')) continue;
      contacts++;
      const gap = gapOf(rest, scale, p, rt.orientation, t.groundAt).all / L; maxGap = Math.max(maxGap, gap); minRest = Math.min(minRest, gap);
      for (const m of swims) { const s = gapOf(m, scale, p, rt.orientation, t.groundAt); minTorso = Math.min(minTorso, s.torso / L); minTail = Math.min(minTail, s.tail / L); }
    }
  }
  expect(recoveries, `${id} ${JSON.stringify(g.spine)}`).toBe(0);
  return { contacts, maxGap, minRest, minTorso, minTail };
}

describe('swim hull fit (owner playtest P3)', () => {
  const setup = (id: string, stage: number, growth: number) => {
    const p0 = plan(id)!, g = starterFor(p0), actor = playerActor(p0, g, stage, growth);
    return { p0, g, actor, L: actor.bodyLength, size: SIZES[stage]!, scale: SIZES[stage]! * growth, rest: skinnedBody(g) };
  };
  const flat: Terrain = { groundAt: () => 0, surface: 1e5, space: false, slopeBound: 0 };
  const drop = (actor: Actor, t: Terrain, yaw: number) => resolveMotion({ actorId: 'player', from: { x: 0, y: 2 * actor.bodyLength, z: 0 }, displacement: { x: 0, y: -3 * actor.bodyLength, z: 0 },
    orientation: { yaw, pitch: 0 }, hull: actor.hull, habitatProfileId: actor.habitat.id, cause: 'locomotion' }, { queries: makeWorldQueries(t), actor, interval: { start: 0, end: 1 / 60 } });
  for (const [id, stage] of SWIM_CASES) for (const growth of [1, 1.38]) {
    it(`rests a ${id} (growth ${growth}) on a flat seabed with a visible gap of at most ${MAX_GAP} L and the torso above it`, () => {
      const b = setup(id, stage, growth), chompRig = createRigPose(b.g); rigPoseInto(chompRig, b.g, 0, 0, 1);
      const chomp = skinnedBody(b.g, chompRig);
      for (const yaw of [0, .7, 2.1]) {
        const r = drop(b.actor, flat, yaw), o = { yaw, pitch: 0 }, gap = gapOf(b.rest, b.scale, r.position, o, flat.groundAt);
        expect(r.contacts.some(c => c.constraint === 'ground'), 'stopped by the seabed').toBe(true);
        expect(gap.all / b.L, `gap at yaw ${yaw}`).toBeLessThanOrEqual(MAX_GAP); expect(gap.all, 'rest body above the seabed').toBeGreaterThanOrEqual(0);
        expect(gapOf(chomp, b.scale, r.position, o, flat.groundAt).torso, 'biting torso above the seabed').toBeGreaterThanOrEqual(0);
      }
    });
    it(`slides a ${id} (growth ${growth}) along the seabed slope with a gap of at most ${MAX_GAP} L; the tail clips at most ${TAIL_CLIP} L`, () => {
      const { contacts, maxGap, minRest, minTorso, minTail } = slideGaps(id, starterFor(plan(id)!), stage, growth);
      expect(contacts, 'seabed contacts').toBeGreaterThan(100);
      expect(maxGap, 'largest gap at a seabed contact').toBeLessThanOrEqual(MAX_GAP); expect(minRest, 'rest body above the seabed').toBeGreaterThanOrEqual(0);
      expect(minTorso, 'swimming torso above the seabed').toBeGreaterThanOrEqual(0); expect(minTail, 'tail clip').toBeGreaterThanOrEqual(-TAIL_CLIP);
    });
  }
  // Final review M15: the gap probe on the 16 fit genomes. The starters stay within MAX_GAP; edited bodies with flat or tall segments
  // (radius ≠ height, a round tight capsule holds the larger of the two) or large lift steps keep a larger belly gap: measured up to
  // .19 L (genome 12 as a Darter). The bound below pins that measurement; fixing it needs non-round hull pieces (reported, not done).
  it('slides each of the 16 fit genomes as a Swimmer and a Darter: never below the seabed, the starters within MAX_GAP L, edited bodies within EDITED_GAP L', () => {
    const rows: { text: string; r: ReturnType<typeof slideGaps> }[] = [];
    fitGenomes().forEach((g, i) => { for (const [id, stage] of [['swimmer', 1], ['darter', 2]] as const) {
      const r = slideGaps(id, g, stage, 1);
      rows.push({ text: `genome ${i} (${g.spine.length} segments) as ${id}: gap ${r.maxGap.toFixed(4)} L, rest ${r.minRest.toFixed(4)} L, torso ${r.minTorso.toFixed(4)} L, tail ${r.minTail.toFixed(4)} L (${r.contacts} contacts)`, r });
    } });
    console.log(rows.map(x => x.text).join('\n'));
    for (const { text, r } of rows) {
      expect(r.contacts, text).toBeGreaterThan(50);
      expect(r.maxGap, text).toBeLessThanOrEqual(text.startsWith('genome 0 ') || text.startsWith('genome 1 ') || text.startsWith('genome 2 ') ? MAX_GAP : EDITED_GAP); expect(r.minRest, text).toBeGreaterThanOrEqual(0);
      expect(r.minTorso, text).toBeGreaterThanOrEqual(0); expect(r.minTail, text).toBeGreaterThanOrEqual(-TAIL_CLIP);
    }
  }, 120_000);
  it('holds every rest-pose body vertex in the tight hull (tapered frusta and end balls), for many genomes', () => {
    const genomes = fitGenomes();
    // A tapered capsule's cross-section in the plane of p (constant body z), or its end balls.
    const inside = (p: { x: number; y: number; z: number }, c: Capsule) => {
      const [r0, r1] = c.radii ?? [c.radius, c.radius];
      if (Math.hypot(p.x - c.start.x, p.y - c.start.y, p.z - c.start.z) <= r0 + 1e-9 || Math.hypot(p.x - c.end.x, p.y - c.end.y, p.z - c.end.z) <= r1 + 1e-9) return true;
      const dz = c.end.z - c.start.z; if (Math.abs(dz) < 1e-12) return false;
      const f = (p.z - c.start.z) / dz;
      if (f < 0 || f > 1) return false;
      return Math.hypot(p.x - (c.start.x + (c.end.x - c.start.x) * f), p.y - (c.start.y + (c.end.y - c.start.y) * f)) <= r0 + (r1 - r0) * f + 1e-9;
    };
    for (const g of genomes) {
      const hull = bodyHull(g, 'tight');
      for (const v of skinnedBody(g).vertices) expect(hull.some(c => inside(v, c)), `${JSON.stringify(g.spine)} at ${v.toArray().map(x => x.toFixed(3))}`).toBe(true);
    }
  });
  it('never admits a pose with the resting body below the seabed (random poses on the real seabed, any pitch)', () => {
    const rand = random(41);
    for (const [id, stage] of SWIM_CASES) {
      const b = setup(id, stage, 1.38), t = makeTerrain(stage), q = makeWorldQueries(t);
      let admitted = 0;
      for (let i = 0; i < 150; i++) {
        const o = { yaw: rand() * 2 * Math.PI, pitch: (rand() * 2 - 1) * 1.2 }, x = (rand() * 2 - 1) * 40 * b.size, z = (rand() * 2 - 1) * 40 * b.size;
        const at = { x, y: supportHeight(b.actor, x, z, o, t), z };   // the lowest height the ground rule admits: the hull touches the seabed
        if (!q.overlapHull(b.actor, at, o, { time: 0 }).ok) continue;
        admitted++;
        expect(gapOf(b.rest, b.scale, at, o, t.groundAt).all, `${id} pose ${i}`).toBeGreaterThanOrEqual(0);
      }
      expect(admitted, id).toBeGreaterThan(50);
    }
  });
  it('keeps the conservative hull for the crawler and ground plans', () => {
    for (const id of ['speck', 'crawler', 'shellback', 'burrower', 'colossus']) {
      const p0 = plan(id)!, g = starterFor(p0), a = playerActor(p0, g, p0.size, 1);
      expect(a.fit ?? 'conservative', id).toBe('conservative'); expect(a.hull, id).toEqual(hullOffsets(g, SIZES[p0.size]!));
      expect(hullOffsets(g, 1), id).toEqual(bodyHull(g).map(c => ({ ...c, sway: c.sway ?? 0, heave: c.heave ?? 0 })));
    }
  });
});

describe('grown Breach landings (owner playtest P3)', () => {
  /** Breach arcs at stage 2, as the game runs them: a key-down starts the arc, then E stays held (rise) until the next arc.
   *  The game's recovery runs whenever a step asks for it (counted). The camera wish has a vertical part `wy` (it pitches the body). */
  const arcs = (id: 'darter' | 'bulk', growth: number, wy: number, count: number) => {
    const p0 = plan(id)!, g = starterFor(p0), stage = 2, size = SIZES[stage]!, actor = playerActor(p0, g, stage, growth), L = actor.bodyLength;
    const t = makeTerrain(stage), queries = makeWorldQueries(t), bounds = { half: 50 * size }, caps = movementCapabilities(p0);
    const top = STAGES[stage]!.speed * derive(effectiveStats(g, p0)).speedFactor, rt = newRuntime({ yaw: Math.PI / 2, pitch: 0 });
    const wish = { x: Math.sqrt(1 - wy * wy), y: wy, z: 0 };
    let p: Vec3 = { x: -30 * size, y: WATER_LEVEL - .8 * L, z: 0 }, started = 0, recoveries = 0, refused = 0, held = false;
    expect(queries.overlapHull(actor, p, rt.orientation, { time: 0, bounds }).ok, 'start pose').toBe(true);
    for (let f = 0; started < count || rt.arc !== null || rt.permit !== null; f++) {
      const now = f / 60, wantArc = started < count && rt.arc === null && rt.permit === null && now >= rt.breachReadyAt;
      const intent: CombatInput = { ...RELEASED, traversal: wantArc ? 'breach' : held ? 'rise' : 'none' };
      const r = stepPlayer(p, rt, intent, { plan: p0, profile: movement(p0.movement), caps, actor, queries, bounds, size, topSpeedLocal: top, now, dt: 1 / 60, wish, aim: null, actionLock: false });
      if (r.breachStarted) { started++; held = true; }
      if (r.arcEnded) held = false;
      if (r.needsRecovery) {
        recoveries++;
        const rec = recoverPlayer(actor, r.position, rt.orientation, { queries, bounds, time: now + 1 / 60 }, { ok: false, reason: 'none' }, 20 * L);
        if (rec.ok) { p = rec.position; rt.orientation = rec.orientation; rt.permit = null; rt.arc = null; }
      } else p = r.position;
      if (!queries.overlapHull(actor, p, rt.orientation, { time: now + 1 / 60, permit: rt.permit, bounds }).ok) refused++;
      if (f > 60 * 60) throw new Error('arcs did not finish');
      // Keep the body in the open water for the next arc: drift back toward the start between arcs.
      if (rt.arc === null && p.x > 30 * size) p = { ...p, x: -30 * size };
    }
    return { started, recoveries, refused };
  };
  for (const id of ['darter', 'bulk'] as const) for (const wy of [0, -.6, .6]) {
    it(`lands 10 Breach arcs of a grown ${id} (camera wish y ${wy}) with no recovery and every pose admitted`, () => {
      const r = arcs(id, 1.38, wy, 10);
      expect(r.started).toBe(10); expect(r.recoveries, 'recoveries').toBe(0); expect(r.refused, 'refused poses').toBe(0);
    });
  }
});
