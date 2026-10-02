// tests/tiny-tide-core/hull-fit.test.ts — owner playtest P3: the tighter swim hull and the grown-body Breach landing.
import { describe, expect, it } from 'vitest';
import { newRuntime, type CombatInput, type Vec3 } from '../../src/tiny-tide/combat-types';
import { SIZES, WATER_LEVEL } from '../../src/tiny-tide/biomes';
import { derive, effectiveStats, starterFor } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { recoverPlayer } from '../../src/tiny-tide/lifecycle';
import { playerActor } from '../../src/tiny-tide/mount';
import { plan } from '../../src/tiny-tide/plans';
import { stepPlayer } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { STAGES } from '../../src/tiny-tide/state';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';

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
