// tests/tiny-tide-core/main-rescue.test.ts — fix round 3 (re-review 2 m1): every pose install in main.ts but a rescue glide step
// cancels a pending rescue. main.ts runs only in a browser, so this checks its source: each top-level function that writes the pose
// (`physical = `) calls cancelRescue() in its own body, except `frame` (the player step, whose installs go through installPose and
// whose glide steps are the rescue itself) and installPose (which cancels unless it installs a glide step).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main.ts cancels a pending rescue on every other install', () => {
  it('each function that sets the pose calls cancelRescue()', () => {
    const src = readFileSync('src/tiny-tide/main.ts', 'utf8'), starts = [...src.matchAll(/^(?:async )?function (\w+)/gm)];
    const writers: string[] = [];
    starts.forEach((m, i) => {
      const body = src.slice(m.index!, starts[i + 1]?.index ?? src.length);
      if (!/\bphysical = /.test(body)) return;
      writers.push(m[1]!);
      if (m[1] === 'frame') return;
      if (m[1] === 'installPose') { expect(body).toMatch(/if \(!rescue\) cancelRescue\(\);/); return; }
      expect(body, `${m[1]} sets the pose without cancelling a rescue`).toMatch(/cancelRescue\(\)/);
    });
    expect(writers.sort()).toEqual(['begin', 'checkGrownPose', 'frame', 'installPose', 'submitEvolution']);
    // checkPose installs through recover → installPose, and cancels first itself.
    expect(src.slice(src.indexOf('function checkPose('), src.indexOf('function checkPose(') + 120)).toMatch(/cancelRescue\(\)/);
  });
});
