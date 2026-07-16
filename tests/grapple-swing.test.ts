import { describe, expect, it } from 'vitest';
import { MOVE } from '../src/core/constants.ts';
import type { Vec3 } from '../src/core/types.ts';
import { applyRopeConstraint } from '../src/player/grapple.ts';

// Physics trace: a 2 s pendulum swing from a cliff anchor on a CONSTANT-length
// rope. We integrate gravity exactly as the movement core would (vy +=
// gravity·dt, then integrate pos), then post-process the rope constraint — the
// same pipeline the controller runs while latched (here with the auto-zip held
// off so we isolate the swing). Sampled every 0.25 s and asserted to be a sane
// arc: descend from the release, swing through the bottom, rise on the far
// side, and never fly meaningfully past the rope length.

const DT = 1 / 60;

describe('grapple swing — physics trace', () => {
  it('descends, swings through, rises, and stays within rope length', () => {
    const anchor: Vec3 = { x: 0, y: 25, z: 0 };
    const length = 12;
    // Released at rest, arm horizontal to +x (a quarter-circle above the bottom).
    let pos: Vec3 = { x: 12, y: 25, z: 0 };
    let vel: Vec3 = { x: 0, y: 0, z: 0 };

    const dist = (p: Vec3): number =>
      Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);

    const rows: string[] = [];
    const sample = (t: number): void => {
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      rows.push(
        `t=${t.toFixed(2)}  pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ` +
          `${pos.z.toFixed(2)})  speed=${sp.toFixed(2)}  dist=${dist(pos).toFixed(3)}`,
      );
    };

    let maxDist = dist(pos);
    let minY = pos.y;
    let yAt025 = pos.y;
    sample(0);
    const steps = Math.round(2 / DT); // 2 seconds
    for (let i = 1; i <= steps; i++) {
      const vy = vel.y + MOVE.gravity * DT;
      pos = { x: pos.x + vel.x * DT, y: pos.y + vy * DT, z: pos.z + vel.z * DT };
      vel = applyRopeConstraint(anchor, length, pos, { x: vel.x, y: vy, z: vel.z }, DT);

      maxDist = Math.max(maxDist, dist(pos));
      minY = Math.min(minY, pos.y);
      const t = i * DT;
      if (Math.abs(t - 0.25) < DT / 2) yAt025 = pos.y;
      if (i % Math.round(0.25 / DT) === 0) sample(t);
    }

    // eslint-disable-next-line no-console
    console.log('\nGrapple 2 s swing trace (anchor 0,25,0  length 12):\n' + rows.join('\n') + '\n');

    // Descends from the release point in the first quarter second.
    expect(yAt025).toBeLessThan(25);
    // Swings through the bottom — reaches near the lowest point of the arc.
    expect(minY).toBeLessThan(anchor.y - length + 0.6);
    // Rises again on the far (−x) side by the end of the run.
    expect(pos.x).toBeLessThan(0);
    expect(pos.y).toBeGreaterThan(minY + 3);
    // Never flies meaningfully past the rope length (soft-spring overstretch
    // peaks near the bottom of the arc where centripetal demand is highest).
    expect(maxDist).toBeLessThan(length + 1);
  });
});
