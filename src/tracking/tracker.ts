import type { Vec3, SpeciesDef } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { CritterManager, CritterView } from '../critters/manager.ts';
import { speciesById } from '../critters/species.ts';
import { stepTracking, isComplete } from './progress.ts';

// ---------------------------------------------------------------------------
// Tracking coordinator (Task 10). Each sim step, for every tagged-not-linked
// critter it advances tracking progress by the player↔critter distance, writes
// the new value back through the manager, and — the instant progress completes
// — Links the critter (calming it), grants its spark/RP rewards once, and
// fires the `onLink` callback (main.ts wires the chime + toast there so this
// module stays free of three/DOM/audio and remains unit-testable).
// ---------------------------------------------------------------------------

/**
 * The no-double-award guard, extracted pure: a critter earns its Link reward
 * only while tagged, not yet linked, and at full tracking progress. Once the
 * manager flips `linked`, this is false, so a completed critter is awarded
 * exactly once even if its progress stays clamped at trackTime.
 */
export function shouldLink(view: CritterView, sp: SpeciesDef): boolean {
  return view.tagged && !view.linked && isComplete(view.trackProgress, sp);
}

export interface TrackerDeps {
  manager: CritterManager;
  inventory: Inventory;
  playerPos: Vec3;
  /** Called once when a critter Links, after rewards are granted. */
  onLink?: (view: CritterView, sp: SpeciesDef) => void;
}

/** 3D distance between the player and a critter. */
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Advance tracking for every tagged-not-linked critter by one `dt` step. */
export function updateTracking(dt: number, deps: TrackerDeps): void {
  const { manager, inventory, playerPos, onLink } = deps;
  for (const c of manager.list()) {
    if (!c.tagged || c.linked) continue;
    const sp = speciesById(c.species);
    if (!sp) continue;

    const next = stepTracking(c.trackProgress, dist(playerPos, c.pos), dt, sp);
    manager.setTrackProgress(c.id, next);

    if (shouldLink({ ...c, trackProgress: next }, sp)) {
      manager.setLinked(c.id); // flips linked → guard blocks any re-award
      inventory.spark += sp.rewardSparks;
      inventory.rp += sp.rewardRP;
      onLink?.(c, sp);
    }
  }
}

/**
 * The nearest tagged-not-linked critter to the player, with its species and
 * live distance — feeds the temporary tracking line on the debug HUD.
 */
export function nearestTracked(
  manager: CritterManager,
  playerPos: Vec3,
): { view: CritterView; sp: SpeciesDef; dist: number } | null {
  let best: { view: CritterView; sp: SpeciesDef; dist: number } | null = null;
  for (const c of manager.list()) {
    if (!c.tagged || c.linked) continue;
    const sp = speciesById(c.species);
    if (!sp) continue;
    const d = dist(playerPos, c.pos);
    if (!best || d < best.dist) best = { view: c, sp, dist: d };
  }
  return best;
}
