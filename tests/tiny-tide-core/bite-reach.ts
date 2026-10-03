// Bite reach of a fresh starter against a combat species (review of T18, I1): combat species are hit only by the Bite cone, not by the chomp
// reach of canApproachFood. A pose counts when it is admitted (ground movers stand on supportHeight), faces the species and its basic Bite cone,
// from the mouth's bite emitters, aimed level for a ground mover (else at the hurtbox centre), meets a species hurtbox.
import { SIZES } from '../../src/tiny-tide/biomes';
import { playerMatrix } from '../../src/tiny-tide/combat-world';
import { actionShapes, hurtboxesHit } from '../../src/tiny-tide/combat-shapes';
import type { Entity } from '../../src/tiny-tide/ecosystem';
import { starterFor } from '../../src/tiny-tide/genome';
import { movesOf } from '../../src/tiny-tide/moves';
import { playerActor, sampleCombatPose, speciesCombatPose } from '../../src/tiny-tide/mount';
import { forwardOf } from '../../src/tiny-tide/orientation';
import type { BodyPlan } from '../../src/tiny-tide/plans';
import { movement } from '../../src/tiny-tide/profiles';
import { createRigPose } from '../../src/tiny-tide/rig';
import { stageBounds, stageWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';

export interface BiteReacher { canBite(e: Entity): boolean }
export function biteReacher(p: BodyPlan, seed: number): BiteReacher {
  const stage = p.size, size = SIZES[stage]!, g = starterFor(p), actor = playerActor(p, g, stage, 1), L = actor.bodyLength, rig = createRigPose(g);
  const q = stageWorldQueries(stage, seed), bounds = stageBounds(stage), ground = ['ground', 'burrow'].includes(movement(p.movement).mode);
  const bite = movesOf(g).basic!, shape = bite.resolved.attack!.shape;
  return {
    canBite(e: Entity): boolean {
      const target = speciesCombatPose(e, 0), c = target.hull[0]!.start, R = target.hull[0]!.radius;
      for (let ring = 0; ring < 8; ring++) for (let k = 0; k < 16; k++) {
        const a = k / 16 * 2 * Math.PI, r = R + (.1 + .15 * ring) * L, x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        const o = { yaw: Math.atan2(c.x - x, c.z - z), pitch: 0 };
        const heights = ground ? [supportHeight(actor, x, z, o, q.terrain) + .01 * L] : [c.y, c.y - .3 * L, c.y + .3 * L];
        for (const y of heights) {
          const at = { x, y, z };
          if (!q.overlapHull(actor, at, o, { time: 0, permit: null, bounds }).ok) continue;
          const pose = sampleCombatPose({ actorId: 'player', genome: g, plan: p, world: playerMatrix(at, o, size), rig, physicalLength: L });
          const origins = pose.emitters.filter(m => m.source.kind === 'part' && m.source.partUid === bite.partUid && m.source.socketId === 'bite').map(m => m.origin);
          const from = origins[0] ?? at, aim = ground ? { x: c.x - from.x, y: 0, z: c.z - from.z } : { x: c.x - from.x, y: c.y - from.y, z: c.z - from.z };
          const len = Math.hypot(aim.x, aim.y, aim.z) || 1, dir = { x: aim.x / len, y: aim.y / len, z: aim.z / len };
          if (hurtboxesHit(target.hurtboxes, actionShapes(shape, origins.length ? origins : [at], dir, forwardOf(o), L))) return true;
        }
      }
      return false;
    },
  };
}
