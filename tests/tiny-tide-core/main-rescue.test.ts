// tests/tiny-tide-core/main-rescue.test.ts — fix round 3 (re-review 2 m1), after the sim.ts extraction (spec D29): every pose install but a
// rescue glide step cancels a pending rescue. The installs now live in sim.ts: each function that writes the pose (`s.physical = `)
// calls cancelRescue(s) in its own body, except `simFrame` (the player step, whose installs go through installPose and whose glide steps are
// the rescue itself) and installPose (which cancels unless it installs a glide step). main.ts writes the pose only through its sim binding.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sim.ts cancels a pending rescue on every other install', () => {
  it('each function that sets the pose calls cancelRescue(s)', () => {
    const src = readFileSync('src/tiny-tide/sim.ts', 'utf8'), starts = [...src.matchAll(/^export function (\w+)|^function (\w+)/gm)];
    const nameOf = (m: RegExpMatchArray) => m[1] ?? m[2]!, bodyOf = (i: number) => src.slice(starts[i]!.index!, starts[i + 1]?.index ?? src.length);
    const writers: string[] = [];
    starts.forEach((m, i) => {
      const name = nameOf(m), body = bodyOf(i);
      if (!/\bs\.physical = /.test(body)) return;
      writers.push(name);
      if (name === 'simFrame') return;
      if (name === 'installPose') { expect(body).toMatch(/if \(!rescue\) cancelRescue\(s\);/); return; }
      expect(body, `${name} sets the pose without cancelling a rescue`).toMatch(/cancelRescue\(s\)/);
    });
    expect(writers.sort()).toEqual(['checkGrownPose', 'installPose', 'simBegin', 'simEvolve', 'simFrame']);
    // Fix round 4 (re-review 3 m4): every write of the pose is one of those (`s.physical = ` inside those function bodies, none in an
    // arrow function or a statement outside them), and the pose is never changed field by field.
    const inWriters = starts.reduce((n, m, i) => writers.includes(nameOf(m)) ? n + (bodyOf(i).match(/\bs\.physical = /g)?.length ?? 0) : n, 0);
    expect(src.match(/\bs\.physical = /g)?.length, 'every `s.physical = ` is in a checked function').toBe(inWriters);
    expect(src, 'no field-by-field pose write').not.toMatch(/\bs\.physical\.[xyz]\s*(?:[-+*/]?=)(?!=)/);
    // checkPose installs through recover → installPose, and cancels first itself.
    expect(src.slice(src.indexOf('function checkPose('), src.indexOf('function checkPose(') + 140)).toMatch(/cancelRescue\(s\)/);
    // main.ts writes the pose only in the binding's setter, and never field by field.
    const main = readFileSync('src/tiny-tide/main.ts', 'utf8');
    expect(main.match(/\bphysical = /g) ?? []).toHaveLength(1);
    expect(main, 'no field-by-field pose write in main.ts').not.toMatch(/\bphysical\.[xyz]\s*(?:[-+*/]?=)(?!=)/);
  });
});
