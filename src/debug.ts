import type { GroundQuery, Vec3 } from './core/types.ts';
import type { Inventory } from './craft/inventory.ts';
import { RECIPES } from './craft/recipes.ts';
import type { HotbarState } from './craft/hotbar.ts';
import type { PlayerController } from './player/controller.ts';
import type { Input } from './player/input.ts';
import type { CritterManager, CritterView } from './critters/manager.ts';
import { speciesById } from './critters/species.ts';
import type { ZiplineSystem } from './structures/ziplines.ts';
import type { DroneSystem } from './structures/drones.ts';
import { currentQuality } from './core/quality.ts';
import { DAYLIGHT } from './core/constants.ts';

// ---------------------------------------------------------------------------
// window.__game (Task 14): the full debug handle backbone for Task 15's
// Playwright verification. Every method here operates on the *live* systems
// wired in main.ts — nothing here is cosmetic, all of it actually mutates
// game state so a verification script can drive the whole loop (grant
// resources → craft → unlock; spawn a critter → track → complete → see the
// reward land; fast-forward time; save/reset) without a real mouse/keyboard.
// ---------------------------------------------------------------------------

export interface DebugDeps {
  player: PlayerController;
  input: Input;
  inventory: Inventory;
  ground: GroundQuery;
  critters: CritterManager;
  ziplines: ZiplineSystem;
  drones: DroneSystem;
  /** True while a structure placement ghost is active (a kit slot selected). */
  isPlacing(): boolean;
  /** Live hotbar state (Inventory+Building Task 3 — state().selectedSlot / hotbarSlots). */
  hotbar(): HotbarState;
  /** True while a grapple rope is attached (Task 15 verification observes this). */
  isGrappling(): boolean;
  getTimeScale(): number;
  setTimeScale(f: number): void;
  /** Set the day/night world clock (seconds since world start), Task 5 e2e. */
  setWorldClock(t: number): void;
  /** Bond a critter into the roster (spec §6 __game.bond). Returns success. */
  bond(id: number): boolean;
  /** Force-fulfil an NPC's barter request ignoring cost (spec §6). Returns success. */
  fulfillRequest(npcId: string): boolean;
  /** Grant a reward by id, applying its effect (spec §6 __game.grantReward). */
  grantReward(id: string): void;
  /** Summon the active mount to the player's side (spec §6 __game.summonMount). */
  summonMount(): void;
  /** Instantly ride the active mount (Haven V6 e2e). Returns success. */
  ride(): boolean;
  /** Assign a bonded roster entry to the first free farm plot (Haven V7 e2e). */
  assignFarm(entryId: number): boolean;
  /** How many bonded critters are in the roster (state() rosterCount). */
  rosterCount(): number;
  /** Owned barter reward ids (state() rewards). */
  rewards(): string[];
  save(): void;
  resetSave(): void;
  /** Live farm state snapshot (spec §6 __game.farmState()). */
  farmState(): unknown;
  /** Sampled renderer.info after the last render (draw calls / tris / resources). */
  renderStats(): RenderStats;
  /** Active quality preset id + its resolved feature flags (F2 P1). */
  quality(): unknown;
  /** Player HP (Cursed Castle Task 11 — state().hp / verification). */
  hp(): number;
  /**
   * Debug-only: apply `dmg` HP of damage directly (daze-eject-spires §1 e2e
   * verification — no damage-debug handle existed before this task, so a
   * headless script had no way to trigger a knockout without waiting for a
   * live goblin hit). Routes through the same `applyHit` goblins use, so it
   * respects the dazed-invulnerability rule identically.
   */
  hurt(dmg: number): void;
  /** Live goblin count (Cursed Castle Task 11). */
  goblinCount(): number;
  /**
   * Live goblin (x, y, z) positions (Castle Ward Task 6 e2e verification —
   * `state().goblinPositions`), so a headless script can confirm goblins are
   * distributed across ward zones rather than clumped in one ring.
   */
  goblinPositions(): Vec3[];
  /**
   * Debug-only: force-spawn one goblin near the player regardless of the
   * current phase (Cursed Castle Task 11 e2e verification). Returns its id.
   */
  spawnGoblin(): number;
  /** Live elf count (Cursed Castle Task 12 — state().elfCount / verification). */
  elfCount(): number;
  /**
   * Debug-only: reconcile the live elf count to `n` (Cursed Castle Task 12
   * e2e verification — `__game.setElves(6)`).
   */
  setElves(n: number): void;
  /** True once the castle's dark crystal has been purified (Cursed Castle Task 14). */
  castlePurified(): boolean;
  /** True while the player stands under a roofed hall (Castle Ward Task 5 — state().inHall / verification). */
  inHall(): boolean;
  /**
   * Debug-only: run the full crystal-purify sequence immediately, regardless
   * of dart position (Cursed Castle Task 14 e2e verification —
   * `__game.purifyCrystal()`).
   */
  purifyCrystal(): void;
}

/** Renderer draw-call / resource counters sampled post-render (F2 P1). */
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface GameDebugHandle {
  state(): unknown;
  player: {
    pos(): Vec3;
    teleport(x: number, y: number, z: number): void;
    setStamina(n: number): void;
  };
  grant(kind: string, n?: number): void;
  unlockAll(): void;
  spawn(speciesId: string, dist?: number): number | null;
  track(id: number): void;
  completeTracking(id: number): boolean;
  bond(id: number): boolean;
  fulfillRequest(npcId: string): boolean;
  grantReward(id: string): void;
  farmState(): unknown;
  renderStats(): RenderStats;
  quality(): unknown;
  assignFarm(entryId: number): boolean;
  summonMount(): void;
  ride(): boolean;
  setTimeScale(f: number): void;
  /**
   * Jump the day/night clock to a named phase's START, or to an absolute
   * seconds position within the cycle (Cursed Castle Task 5 e2e verification:
   * `__game.setTimeOfDay('night')` should immediately read as dark).
   */
  setTimeOfDay(phase: 'day' | 'dusk' | 'night' | 'dawn' | number): void;
  listCritters(): CritterView[];
  save(): void;
  reset(): void;
  /** Debug-only: force-spawn one goblin near the player. Returns its id. */
  spawnGoblin(): number;
  /** Debug-only: reconcile the live elf count to `n` (Cursed Castle Task 12 e2e). */
  setElves(n: number): void;
  /** Debug-only: run the full crystal-purify sequence (Cursed Castle Task 14 e2e). */
  purifyCrystal(): void;
  /** Debug-only: apply `dmg` HP of damage directly (daze-eject-spires §1 e2e). */
  hurt(dmg: number): void;
}

/** Build the `window.__game` debug handle from the live systems main.ts owns. */
export function buildDebugHandle(deps: DebugDeps): GameDebugHandle {
  return {
    state(): unknown {
      const inv = deps.inventory;
      return {
        pos: deps.player.pos,
        stamina: deps.player.stamina,
        exhausted: deps.player.exhausted,
        inventory: { ...inv, kits: { ...inv.kits } },
        unlocks: [...deps.player.unlocks],
        linkedSpeciesCount: deps.critters.linkedSpecies().size,
        linked: [...deps.critters.linkedSpecies()],
        rosterCount: deps.rosterCount(),
        rewards: deps.rewards(),
        activeCritters: deps.critters.count(),
        structures: {
          ziplines: deps.ziplines.count,
          drones: deps.drones.count,
          riding: deps.ziplines.riding,
          placing: deps.isPlacing(),
        },
        grappling: deps.isGrappling(),
        timeScale: deps.getTimeScale(),
        quality: currentQuality(),
        hp: deps.hp(),
        goblinCount: deps.goblinCount(),
        goblinPositions: deps.goblinPositions(),
        elfCount: deps.elfCount(),
        castlePurified: deps.castlePurified(),
        inHall: deps.inHall(),
        // Inventory+Building Task 3 e2e verification (scroll-select, kit ghost
        // enter/cancel): the live hotbar loadout + current selection.
        selectedSlot: deps.hotbar().selected,
        hotbarSlots: deps.hotbar().slots,
      };
    },

    player: {
      pos: (): Vec3 => deps.player.pos,
      teleport: (x, y, z): void => deps.player.teleport(x, y, z),
      setStamina: (n): void => deps.player.setStamina(n),
    },

    /**
     * Grant `n` (default 1) of a plain numeric inventory field (fiber, resin,
     * shard, spark, rp, darts), or a kit via the `kit:<id>` prefix (e.g.
     * `grant('kit:zipline', 2)`). Unknown kinds are a silent no-op.
     */
    grant(kind: string, n = 1): void {
      if (kind.startsWith('kit:')) {
        const kitKind = kind.slice(4);
        const kits = deps.inventory.kits as unknown as Record<string, number>;
        const current = kits[kitKind];
        if (typeof current === 'number') kits[kitKind] = current + n;
        return;
      }
      const inv = deps.inventory as unknown as Record<string, unknown>;
      if (Object.hasOwn(inv, kind) && typeof inv[kind] === 'number') {
        inv[kind] = (inv[kind] as number) + n;
      }
    },

    /** Unlock every craftable ability (grapple/boots/glider/rocket). */
    unlockAll(): void {
      for (const r of RECIPES) {
        if (r.kind === 'unlock') deps.player.unlocks.add(r.id);
      }
    },

    /**
     * Force-activate a critter of `speciesId` `dist` metres in front of the
     * player (along the current look yaw, at ground height there). Returns
     * the new critter id, or null if `speciesId` is unknown.
     */
    spawn(speciesId: string, dist = 8): number | null {
      const yaw = deps.input.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const p = deps.player.pos;
      const x = p.x + dirX * dist;
      const z = p.z + dirZ * dist;
      const y = deps.ground.heightAt(x, z);
      return deps.critters.debugSpawn(speciesId, { x, y, z });
    },

    /** Tag a critter (starts the normal tracking-ring accrual toward Link). */
    track(id: number): void {
      deps.critters.setTagged(id, true);
    },

    /**
     * Force a tagged critter's tracking progress to done. The very next sim
     * step's normal `updateTracking` call then Links it through the regular
     * path — rewards, the onLink chime/toast, everything — exactly once.
     * Returns false if `id` isn't a currently-active critter or its species
     * is unknown.
     */
    completeTracking(id: number): boolean {
      const view = deps.critters.byId(id);
      if (!view) return false;
      const sp = speciesById(view.species);
      if (!sp) return false;
      deps.critters.setTagged(id, true);
      deps.critters.setTrackProgress(id, sp.trackTime);
      return true;
    },

    /**
     * Bond the critter `id` into the roster (spec §6). Delegates to main.ts's
     * bond flow (which force-Links the critter first for convenience, spends a
     * charm if held, removes it from the wild and names it). Returns false if
     * the critter isn't active or the bond couldn't complete.
     */
    bond(id: number): boolean {
      return deps.bond(id);
    },

    /** Force-fulfil `npcId`'s current request ignoring cost, granting its reward. */
    fulfillRequest(npcId: string): boolean {
      return deps.fulfillRequest(npcId);
    },

    /** Grant reward `id` (applies its effect: bundles add resources, etc.). */
    grantReward(id: string): void {
      deps.grantReward(id);
    },

    /** Live farm state (plots / assignments / hoppers / progress). */
    farmState(): unknown {
      return deps.farmState();
    },

    /** Renderer draw-call / resource counters sampled after the last render. */
    renderStats(): RenderStats {
      return deps.renderStats();
    },

    /** Active quality preset id + resolved feature flags (F2 P1). */
    quality(): unknown {
      return deps.quality();
    },

    /** Assign a bonded roster entry to the first free farm plot (Haven V7 e2e). */
    assignFarm(entryId: number): boolean {
      return deps.assignFarm(entryId);
    },

    /** Summon the active mount to the player's side (spec §6). */
    summonMount(): void {
      deps.summonMount();
    },

    /** Instantly ride the active mount (Haven V6 e2e). Returns success. */
    ride(): boolean {
      return deps.ride();
    },

    /** Multiply the fixed-step accumulator's dt feed (clamped 0.1..16). */
    setTimeScale(f: number): void {
      deps.setTimeScale(f);
    },

    /**
     * A phase name jumps the world clock to that phase's start (day→0,
     * dusk→dayS, night→dayS+duskS, dawn→dayS+duskS+nightS); a number sets the
     * clock to that many seconds into the cycle directly.
     */
    setTimeOfDay(phase: 'day' | 'dusk' | 'night' | 'dawn' | number): void {
      if (typeof phase === 'number') {
        deps.setWorldClock(phase);
        return;
      }
      const d = DAYLIGHT;
      const starts: Record<'day' | 'dusk' | 'night' | 'dawn', number> = {
        day: 0,
        dusk: d.dayS,
        night: d.dayS + d.duskS,
        dawn: d.dayS + d.duskS + d.nightS,
      };
      deps.setWorldClock(starts[phase]);
    },

    listCritters(): CritterView[] {
      return deps.critters.list();
    },

    save(): void {
      deps.save();
    },

    reset(): void {
      deps.resetSave();
    },

    /** Debug-only: force-spawn one goblin near the player. Returns its id. */
    spawnGoblin(): number {
      return deps.spawnGoblin();
    },

    /** Debug-only: reconcile the live elf count to `n` (Cursed Castle Task 12 e2e). */
    setElves(n: number): void {
      deps.setElves(n);
    },

    /** Debug-only: run the full crystal-purify sequence (Cursed Castle Task 14 e2e). */
    purifyCrystal(): void {
      deps.purifyCrystal();
    },

    /** Debug-only: apply `dmg` HP of damage directly (daze-eject-spires §1 e2e). */
    hurt(dmg: number): void {
      deps.hurt(dmg);
    },
  };
}
