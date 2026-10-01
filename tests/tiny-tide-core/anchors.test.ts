// tests/tiny-tide-core/anchors.test.ts
import { describe, expect, it } from 'vitest';
import { findRecoveryPose, startAnchor } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { hullExtents, makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { adaptToPlan, starterFor, type Genome } from '../../src/tiny-tide/genome';
import { eligibleChildren, plan, PLANS, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';

describe('start anchors', () => {
  it('exist at growth 1 and 1.38 for every starter, every inherited design and an extreme Colossus', () => {
    const designs: [string, Genome][] = PLANS.filter(p => !p.needs).map(p => [p.id, starterFor(p)]);
    const walk = (path: string[], g: Genome) => { for (const c of eligibleChildren(path, { coast: false })) {
      const a = adaptToPlan(g, c, { unlocked: [] }, 900); if (!a.ok) throw new Error(`${c.id}: ${a.reasons.join('; ')}`); designs.push([c.id, a.genome]); walk([...path, c.id], a.genome); } };
    walk([ROOT_PLAN], starterFor(plan('speck')!));
    const colossus = starterFor(plan('colossus')!); designs.push(['colossus', { ...colossus, spine: colossus.spine.map(s => ({ ...s, radius: 1.2, height: 1.2 })) }]);
    for (const [id, g] of designs) for (const growth of [1, 1.38]) {
      const p = plan(id)!, size = SIZES[p.size]!;
      const r = startAnchor(playerActor(p, g, p.size, growth), p.size, { queries: makeWorldQueries(makeTerrain(p.size)), bounds: { half: PLAYER_HALF * size } });
      expect(r.ok, `${id} growth ${growth}`).toBe(true);
    }
  });
  it('recovers a multi-capsule body with the same inflated extents admission uses', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = makeWorldQueries({ groundAt: () => 0, surface: 20, space: false, slopeBound: 0 }), { top } = hullExtents(actor, { yaw: 0, pitch: 0 });
    const r = findRecoveryPose(actor, { x: 0, y: 21, z: 0 }, { queries: q, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 10 });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.position.y).toBeCloseTo(20 - top - .01 * actor.bodyLength, 6); expect(q.overlapHull(actor, r.position, r.orientation, { time: 0 }).ok).toBe(true);
  });
});
