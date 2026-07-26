import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure castle-purify sequencing (Cursed Castle Task 14). No `three` import —
// safe to unit-test directly, mirroring the project's convention of pulling
// the interesting decision/mapping logic out of the three.js-owning system
// (`CastleSystem`) into a small pure module (see `src/castle/goblins.ts`'s
// `shouldSpawnGoblins`, `src/castle/elves.ts`'s `elfHomePosition`).
// ---------------------------------------------------------------------------

/**
 * A trivial named shape for "where is the castle in its purify arc right
 * now" — kept as a standalone interface (rather than inlined) so future
 * callers (save/load, debug state) can reason about castle state without
 * reaching into `CastleSystem` itself.
 */
export interface CastleWorldState {
  purified: boolean;
  nightIndex: number;
}

/**
 * The purify sequence's pure "what happens to each live goblin" step: every
 * goblin position becomes an elf spawn point, in the same order. Trivial by
 * design (a straight map) — kept as a standalone pure function so the
 * "every last goblin becomes a happy elf" mapping the purify burst relies on
 * is unit-testable without a headless `THREE.Scene`.
 */
export function purifySequenceSteps(goblinPositions: Vec3[]): { elfSpawns: Vec3[] } {
  return { elfSpawns: goblinPositions.map((p) => ({ ...p })) };
}
