// ---------------------------------------------------------------------------
// Owned-rewards store (Haven V4). A tiny module-level singleton holding the
// ordered list of reward ids the player has been granted from the barter
// track. Kept as an ordered list (not a Set) because 'plotDeed' is granted
// TWICE and each deed counts (V5 reads `plotDeedCount()` to size the farm).
// `getRewards()` exposes the unique set for on/off checks (V6 reads
// 'saddle'/'whistle'; the tracker reads 'goldenDart'). Save persists the list
// (`rewards?: string[]`); on load `resetRewards(list)` restores it WITHOUT
// re-applying any bundle resources (inventory is saved separately).
// ---------------------------------------------------------------------------

let granted: string[] = [];

/** Replace the granted list (load / new game). No side effects on inventory. */
export function resetRewards(list: readonly string[] = []): void {
  granted = [...list];
}

/** Record that reward `id` was granted (append; 'plotDeed' may repeat). */
export function recordReward(id: string): void {
  granted.push(id);
}

/** How many rewards have been granted so far (drives `nextReward`). */
export function grantedCount(): number {
  return granted.length;
}

/** The ordered granted-reward id list (for save serialization). */
export function grantedRewards(): readonly string[] {
  return granted;
}

/** Unique set of owned reward ids — for on/off checks (saddle/whistle/goldenDart). */
export function getRewards(): Set<string> {
  return new Set(granted);
}

/** True once reward `id` has been granted at least once. */
export function hasReward(id: string): boolean {
  return granted.includes(id);
}

/** How many Plot Deeds have been granted (each unlocks +2 farm plots — V5). */
export function plotDeedCount(): number {
  return granted.filter((id) => id === 'plotDeed').length;
}
