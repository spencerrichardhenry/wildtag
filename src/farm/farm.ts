import { FARM } from '../core/constants.ts';
import type { ResourceKind, SpeciesDef } from '../core/types.ts';
import type { RosterEntry } from '../critters/roster.ts';

// ---------------------------------------------------------------------------
// Farm core (Haven V5) — PURE. No three, no DOM. Plots hold an assigned bonded
// critter that putters away producing its species resource into the plot hopper
// on a timer (spec §4). Speed auras (mirefin/emberpup, +25% each, cap +50%) and
// the snickerdoodle adjacency-double / bumblewhale hopper-cap aura are all
// resolved from plot adjacency (index ±1 among unlocked plots). Everything is
// returned as a NEW FarmState; the inputs are never mutated, so `tick` is a pure
// function (determinism is asserted in tests).
// ---------------------------------------------------------------------------

export interface Plot {
  /** 0-based plot index (0..maxPlots-1). */
  id: number;
  unlocked: boolean;
  /** Roster entry id of the assigned bonded critter, or null when empty. */
  assigned: number | null;
  /** Accumulated resources awaiting collection (summed total capped per plot). */
  hopper: Partial<Record<ResourceKind, number>>;
  /** Speed-scaled seconds accrued toward the next production cycle. */
  progress: number;
}

export interface FarmState {
  plots: Plot[];
}

/** How many plots are unlocked for `deeds` Plot Deeds (spec §4). */
export function unlockedPlots(deeds: number): number {
  const n = FARM.basePlots + FARM.plotsPerDeed * Math.max(0, Math.floor(deeds));
  return Math.min(FARM.maxPlots, n);
}

/** A fresh farm: `maxPlots` empty plots, the first `unlockedPlots(deeds)` open. */
export function createFarm(deeds = 0): FarmState {
  const open = unlockedPlots(deeds);
  const plots: Plot[] = [];
  for (let id = 0; id < FARM.maxPlots; id++) {
    plots.push({ id, unlocked: id < open, assigned: null, hopper: {}, progress: 0 });
  }
  return { plots };
}

/** Clone a plot (deep enough — hopper is a flat record). */
function clonePlot(p: Plot): Plot {
  return { id: p.id, unlocked: p.unlocked, assigned: p.assigned, hopper: { ...p.hopper }, progress: p.progress };
}

/** Deep-ish clone of a farm (plots + hoppers). */
function cloneFarm(farm: FarmState): FarmState {
  return { plots: farm.plots.map(clonePlot) };
}

/**
 * New farm with unlock flags re-derived from `deeds` (assignments/hoppers kept).
 * Called by main.ts whenever the live deed count changes.
 */
export function setDeeds(farm: FarmState, deeds: number): FarmState {
  const open = unlockedPlots(deeds);
  return { plots: farm.plots.map((p) => ({ ...clonePlot(p), unlocked: p.id < open })) };
}

/** The first unlocked, empty plot's id, or null when none is free. */
export function firstFreePlot(farm: FarmState): number | null {
  for (const p of farm.plots) if (p.unlocked && p.assigned === null) return p.id;
  return null;
}

/**
 * Assign roster entry `rosterEntryId` to `plotId`. Returns a NEW farm, or the
 * input unchanged when the plot is missing / locked / already occupied. A roster
 * entry can only occupy one plot, so any prior plot it held is cleared first.
 */
export function assign(farm: FarmState, plotId: number, rosterEntryId: number): FarmState {
  const target = farm.plots.find((p) => p.id === plotId);
  if (!target || !target.unlocked || target.assigned !== null) return farm;
  const next = cloneFarm(farm);
  for (const p of next.plots) {
    if (p.assigned === rosterEntryId) {
      p.assigned = null;
      p.progress = 0;
    }
  }
  const t = next.plots.find((p) => p.id === plotId)!;
  t.assigned = rosterEntryId;
  t.progress = 0;
  return next;
}

/** Clear the critter off `plotId` (progress resets; hopper kept). New farm. */
export function unassign(farm: FarmState, plotId: number): FarmState {
  const target = farm.plots.find((p) => p.id === plotId);
  if (!target || target.assigned === null) return farm;
  const next = cloneFarm(farm);
  const t = next.plots.find((p) => p.id === plotId)!;
  t.assigned = null;
  t.progress = 0;
  return next;
}

/** Remove roster entry `id` from whatever plot holds it (release path). New farm. */
export function unassignEntry(farm: FarmState, rosterEntryId: number): FarmState {
  const holder = farm.plots.find((p) => p.assigned === rosterEntryId);
  if (!holder) return farm;
  return unassign(farm, holder.id);
}

type Lookup = (id: string) => SpeciesDef | undefined;

/** The species of the critter assigned to a plot, or undefined. */
function plotSpecies(
  plot: Plot,
  rosterById: Map<number, RosterEntry>,
  speciesById: Lookup,
): SpeciesDef | undefined {
  if (plot.assigned === null) return undefined;
  const entry = rosterById.get(plot.assigned);
  if (!entry) return undefined;
  return speciesById(entry.speciesId);
}

/** Unlocked, index-adjacent (±1) neighbours of `plot`. */
function neighbours(farm: FarmState, plot: Plot): Plot[] {
  const out: Plot[] = [];
  for (const p of farm.plots) {
    if (!p.unlocked) continue;
    if (p.id === plot.id - 1 || p.id === plot.id + 1) out.push(p);
  }
  return out;
}

/** Sum of the values currently in a hopper. */
function hopperTotal(hopper: Partial<Record<ResourceKind, number>>): number {
  let t = 0;
  for (const k of Object.keys(hopper) as ResourceKind[]) t += hopper[k] ?? 0;
  return t;
}

/**
 * Advance the whole farm by `dt` seconds. Pure: returns a NEW FarmState, never
 * mutating `farm`. Per assigned produce-role critter: progress accrues at
 * `dt × speedMult` (1 + adjacent speed auras, capped at +`speedCapBonus`); each
 * time it crosses `producePeriod`, `amount` of the species resource lands in the
 * hopper (doubled by an adjacent same-species snickerdoodle), clamped so the
 * hopper total never exceeds its cap (`hopperCap` + `bumblewhaleHopperBonus` per
 * adjacent bumblewhale). Aura critters (mirefin/emberpup/bumblewhale) produce
 * nothing themselves.
 */
export function tick(
  farm: FarmState,
  roster: readonly RosterEntry[],
  speciesById: Lookup,
  dt: number,
): FarmState {
  const rosterById = new Map<number, RosterEntry>();
  for (const e of roster) rosterById.set(e.id, e);
  const next = cloneFarm(farm);

  for (const plot of next.plots) {
    if (!plot.unlocked || plot.assigned === null) continue;
    const sp = plotSpecies(plot, rosterById, speciesById);
    if (!sp || sp.farmRole.kind !== 'produce') continue;
    const role = sp.farmRole;
    const resource = role.resource;
    if (!resource) continue;

    const adj = neighbours(next, plot);

    // Speed auras from adjacent aura critters (auraPct producers only).
    let bonus = 0;
    for (const n of adj) {
      const ns = plotSpecies(n, rosterById, speciesById);
      if (ns && ns.farmRole.kind === 'aura' && ns.farmRole.auraPct) {
        bonus += ns.farmRole.auraPct / 100;
      }
    }
    const speedMult = 1 + Math.min(FARM.speedCapBonus, bonus);

    // Adjacency double (snickerdoodle beside another snickerdoodle).
    let amount = role.amount ?? 0;
    if (role.special === 'adjacencyDouble') {
      const hasSameNeighbour = adj.some((n) => {
        const ns = plotSpecies(n, rosterById, speciesById);
        return ns?.id === sp.id;
      });
      if (hasSameNeighbour) amount *= 2;
    }

    // Hopper cap, raised by adjacent bumblewhale hopperCap auras.
    let cap = FARM.hopperCap;
    for (const n of adj) {
      const ns = plotSpecies(n, rosterById, speciesById);
      if (ns && ns.farmRole.kind === 'aura' && ns.farmRole.special === 'hopperCap') {
        cap += FARM.bumblewhaleHopperBonus;
      }
    }

    let progress = plot.progress + dt * speedMult;
    while (progress >= FARM.producePeriod) {
      const total = hopperTotal(plot.hopper);
      if (total >= cap) {
        progress = FARM.producePeriod; // full: hold "ready", stop accruing
        break;
      }
      const room = cap - total;
      const added = Math.min(amount, room);
      plot.hopper[resource] = (plot.hopper[resource] ?? 0) + added;
      progress -= FARM.producePeriod;
    }
    plot.progress = progress;
  }

  return next;
}

/**
 * Empty `plotId`'s hopper. Returns the new farm plus the collected amounts (one
 * entry per resource with a positive count). A locked/empty/absent hopper yields
 * an empty `gained` list and the farm unchanged.
 */
export function collect(
  farm: FarmState,
  plotId: number,
): { farm: FarmState; gained: { resource: ResourceKind; n: number }[] } {
  const plot = farm.plots.find((p) => p.id === plotId);
  if (!plot) return { farm, gained: [] };
  const gained: { resource: ResourceKind; n: number }[] = [];
  for (const k of Object.keys(plot.hopper) as ResourceKind[]) {
    const n = plot.hopper[k] ?? 0;
    if (n > 0) gained.push({ resource: k, n });
  }
  if (gained.length === 0) return { farm, gained: [] };
  const next = cloneFarm(farm);
  const t = next.plots.find((p) => p.id === plotId)!;
  t.hopper = {};
  return { farm: next, gained };
}
