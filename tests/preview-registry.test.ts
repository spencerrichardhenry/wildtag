import { describe, expect, it } from 'vitest';
import { EXTRA_CHARACTERS } from '../src/critters/preview.ts';

// Spencer (Bounce Wave): ?preview=critters must cover EVERY character model —
// non-species characters (underwater + castle) register in EXTRA_CHARACTERS.
// When a new non-species character system lands, add its builder there AND to
// this required list.
describe('preview covers all non-species characters', () => {
  it('registers every known non-species character builder', () => {
    const ids = new Set(EXTRA_CHARACTERS.map((e) => e.id));
    for (const required of ['clam', 'crocodile', 'turtle', 'goblin', 'elf']) {
      expect(ids.has(required), `preview EXTRA_CHARACTERS missing '${required}'`).toBe(true);
    }
  });

  it('every registered builder produces a non-empty group', () => {
    for (const e of EXTRA_CHARACTERS) {
      const g = e.build(42);
      expect(g.children.length, e.id).toBeGreaterThan(0);
    }
  });
});
