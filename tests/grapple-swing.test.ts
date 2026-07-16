import { describe, expect, it } from 'vitest';
import { MOVE } from '../src/core/constants.ts';
import type { MoveState, Vec3 } from '../src/core/types.ts';
import { initialMoveState } from '../src/player/movement.ts';
import { stepGrapple, type GrappleState } from '../src/player/grapple.ts';

// Physics trace: a 2 s pendulum swing from a cliff anchor. We integrate gravity
// exactly as the movement core would (vy += gravity·dt, then integrate pos),
// then post-process the rope constraint with stepGrapple — the same pipeline
// the controller runs. Sampled every 0.25 s and asserted to be a sane arc:
// descend from the release, swing through the bottom, rise on the far side,
// and never fly meaningfully past the rope length.

const DT = 1 / 60;

describe('grapple swing — physics trace', () => {
  it('descends, swings through, rises, and stays within rope length', () => {
    const anchor: Vec3 = { x: 0, y: 25, z: 0 };
    const length = 12;
    let g: GrappleState = {
      active: true,
      anchor,
      length,
      reeling: false,
      occludedFor: 0,
    };
    // Released at rest, arm horizontal to +x (a quarter-circle above the bottom).
    let s: MoveState = { ...initialMoveState({ x: 12, y: 25, z: 0 }), vel: { x: 0, y: 0, z: 0 } };

    const dist = (p: Vec3): number =>
      Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);

    const rows: string[] = [];
    const sample = (t: number): void => {
      const sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      rows.push(
        `t=${t.toFixed(2)}  pos=(${s.pos.x.toFixed(2)}, ${s.pos.y.toFixed(2)}, ` +
          `${s.pos.z.toFixed(2)})  speed=${sp.toFixed(2)}  dist=${dist(s.pos).toFixed(3)}`,
      );
    };

    let maxDist = dist(s.pos);
    let minY = s.pos.y;
    let yAt025 = s.pos.y;
    sample(0);
    const steps = Math.round(2 / DT); // 2 seconds
    for (let i = 1; i <= steps; i++) {
      const vy = s.vel.y + MOVE.gravity * DT;
      const pos: Vec3 = {
        x: s.pos.x + s.vel.x * DT,
        y: s.pos.y + vy * DT,
        z: s.pos.z + s.vel.z * DT,
      };
      s = { ...s, pos, vel: { x: s.vel.x, y: vy, z: s.vel.z } };
      const res = stepGrapple(g, s, false, DT);
      g = res.g;
      s = { ...s, vel: res.vel };

      maxDist = Math.max(maxDist, dist(s.pos));
      minY = Math.min(minY, s.pos.y);
      const t = i * DT;
      if (Math.abs(t - 0.25) < DT / 2) yAt025 = s.pos.y;
      if (i % Math.round(0.25 / DT) === 0) sample(t);
    }

    // eslint-disable-next-line no-console
    console.log('\nGrapple 2 s swing trace (anchor 0,25,0  length 12):\n' + rows.join('\n') + '\n');

    // Descends from the release point in the first quarter second.
    expect(yAt025).toBeLessThan(25);
    // Swings through the bottom — reaches near the lowest point of the arc.
    expect(minY).toBeLessThan(anchor.y - length + 0.6);
    // Rises again on the far (−x) side by the end of the run.
    expect(s.pos.x).toBeLessThan(0);
    expect(s.pos.y).toBeGreaterThan(minY + 3);
    // Never flies meaningfully past the rope length (soft-spring overstretch
    // peaks near the bottom of the arc where centripetal demand is highest).
    expect(maxDist).toBeLessThan(length + 1);
  });
});
