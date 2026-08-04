import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import { itemCount, NUM_SLOTS, type ItemId } from '../craft/hotbar.ts';
import type { CritterView } from '../critters/manager.ts';
import { speciesById } from '../critters/species.ts';
import { HEALTH, MOVE, SCATTER } from '../core/constants.ts';
import { toast } from './toasts.ts';
import {
  HUD as HUDT,
  CARDINALS as CARDINAL_LABEL,
  compassTicks,
  facingBearingDeg,
  worldBearingDeg,
  bearingToStripX,
  ringScreenState,
  healthBarHideEligible,
  hotbarItemLabel,
  type ProjectFn,
} from './hud-math.ts';

// ---------------------------------------------------------------------------
// The heads-up display (Task 11). All DOM lives inside #hud in a single
// injected <style> block, layered below the screen overlay (z 20) and toasts
// (z 15). The HUD is a thin DOM renderer over per-frame snapshots — every
// piece of geometry (tracking rings, compass) comes from the pure hud-math
// module so the maths is unit-tested and this file only paints.
//
// Poll model: main calls `update(frame)` once per animation frame. Text and
// class writes are diffed against the last painted value so a steady state
// touches no DOM. Tracking-ring DOM nodes are reused per critter id and
// created/removed as critters are tagged / linked / despawn.
// ---------------------------------------------------------------------------

/** Everything the HUD paints in one frame — a read-only snapshot from main. */
export interface HudFrame {
  pos: Vec3;
  /** Mouse-look yaw (radians) for the compass. */
  yaw: number;
  stamina: number;
  /** Movement core's exhaustion latch (true below 1 stamina until ≥20). */
  exhausted: boolean;
  /** Player HP (Cursed Castle Task 6), 0..HEALTH.max. */
  hp: number;
  /** True while the post-death daze window is active (invulnerable). */
  dazed: boolean;
  inventory: Inventory;
  unlocks: ReadonlySet<string>;
  /** Live critters (for rings + compass pips). */
  critters: CritterView[];
  /** Harvestable kind currently under the aim (e.g. "fiber"), or null. */
  harvestPrompt: string | null;
  /**
   * Build-piece pickup prompt (Inventory+Building Task 5): aiming at a placed
   * wall/ramp within pickup range, with the live hold-F progress [0, 1] (0
   * while not yet holding). A PARALLEL channel to `harvestPrompt` rather than
   * reusing its string shape directly — a piece pickup is a HOLD-to-complete
   * action ("Hold F — Reclaim Wall 40%"), not an instant harvest ("F —
   * Harvest Fiber"), so it needs its own wording + a live percentage; it
   * still reuses `harvestPrompt`'s green crosshair dot (`paintCrosshair`
   * below) since visually it's the same "something interactive is aimed at"
   * cue.
   */
  buildPickup: { kind: 'wall' | 'ramp'; progress: number } | null;
  spawn: Vec3;
  /** True while the pointer is locked (drives first-run hints). */
  locked: boolean;
  /** True while a full-screen menu is open — the gameplay HUD hides. */
  screenOpen: boolean;
  /** Day/night cycle fraction [0,1) — positions the day-arc indicator dot. */
  dayCycleT: number;
  /** Day/night darkness [0,1] — colors the dot sun (< 0.5) vs moon (≥ 0.5). */
  dayDarkness: number;
  /**
   * True while the player stands in the castle region at night with the
   * castle not yet purified (Cursed Castle spec §4, final-review fix): the HP
   * bar stays visible even at full HP while this is true, since a goblin
   * ambush is a live possibility regardless of current HP.
   */
  dangerZone: boolean;
  /**
   * True during the blackout-drag phase of a maze daze ejection (design spec
   * daze-eject-spires §1): the daze window ended while the player was still
   * inside the castle's walled footprint, so main.ts's tiny eject state
   * machine blacks the screen, teleports them just outside the gate, then
   * clears this. Independent of `dazed` — the HP/daze window is already over
   * by the time this goes true, this is purely the drag-out cutscene.
   */
  dazeBlack: boolean;
  /** The 6-slot hotbar loadout (Inventory+Building Task 3), owned by main.ts. */
  hotbarSlots: readonly (ItemId | null)[];
  /** Currently-selected hotbar slot, 0..NUM_SLOTS-1. */
  selectedSlot: number;
}

const RES_COLOR: Record<string, string> = {
  fiber: hex(SCATTER.colors.fiber),
  resin: hex(SCATTER.colors.resin),
  shard: hex(SCATTER.colors.shard),
  spark: hex(SCATTER.colors.spark),
  mushroom: '#9c5bd0', // glow-mushroom cap colour
  wood: '#8a5a35', // timberchomp produce — dam-brown
  stone: '#8f8f92', // pebbleshrew produce — flint grey
  dart: '#66e0ff',
  charm: '#d98cff', // Bond Charm — distinct violet
  purifier: '#8ef0c0', // Purifying Dart — pale minty green
  rp: '#9fd8b8',
};

const RING_IN = '#6fe08a'; // within track radius (green)
const RING_OUT = '#f0c058'; // outside radius (amber)
const SPAWN_COLOR = '#ffffff';
const LINKED_FADE_MS = 10_000;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** DOM handles for one reusable tracking-ring node. */
interface RingNode {
  root: HTMLDivElement;
  prog: SVGCircleElement;
  arrow: HTMLDivElement;
  label: HTMLDivElement;
  circ: number;
}

export class HUD {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly host: HTMLElement;

  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly harvestLabel: HTMLDivElement;
  private readonly stamina: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly resEls = new Map<string, { dot: HTMLElement; count: HTMLElement; last: number }>();
  private readonly slots: {
    root: HTMLDivElement;
    nameEl: HTMLSpanElement;
    badge: HTMLDivElement;
  }[] = [];
  /** Last-painted selected slot index (0-based) — `shake()` reads this to
   *  know which slot's DOM node to flash, without main.ts having to pass it
   *  in separately. */
  private lastSelectedSlot = 0;
  private readonly compassTrack: HTMLDivElement;
  /** Persistent tick nodes keyed by bearing (deg) — repositioned, never rebuilt. */
  private readonly tickEls = new Map<number, HTMLDivElement>();
  /** Persistent spawn-point pip. */
  private readonly spawnPip: HTMLDivElement;
  /** Persistent critter pip nodes keyed by critter id (rings reuse pattern). */
  private readonly critterPips = new Map<number, HTMLDivElement>();
  private readonly rings: HTMLDivElement;
  private readonly ringNodes = new Map<number, RingNode>();
  private readonly dayCycle: HTMLDivElement;
  private readonly dayCycleDot: HTMLDivElement;
  private lastCycleT = -1;
  private lastDarkness = -1;
  private readonly dazeVeil: HTMLDivElement;
  private lastDazeVeil = false;
  /** Blackout-drag overlay (daze-eject-spires §1) — see `HudFrame.dazeBlack`. */
  private readonly blackoutVeil: HTMLDivElement;
  private lastBlackout = false;
  /** One-shot full-screen white flash overlay (Cursed Castle Task 14 — the
   *  crystal-purify moment). Separate from `dazeVeil`: that one is a
   *  continuous, state-driven vignette (`frame.dazed`); this is a fire-and-
   *  forget animation triggered once by `flash()`, not painted from a frame. */
  private readonly purifyFlash: HTMLDivElement;

  private crosshairOverride: string | null = null;
  private lastCrosshair = '';
  private staminaFullSince: number | null = null;
  private staminaShown = false;
  private lastExhausted = false;
  private healthFullSince: number | null = null;
  private healthShown = false;
  private lastDazed = false;
  private linkTimes = new Map<number, number>();

  // First-run hint one-shots.
  private hintedBoot = false;
  private hintedLock = false;
  private hintedDart = false;
  private hintedTag = false;

  // Projection scratch.
  private readonly _v = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();

  constructor(host: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.host = host;
    this.camera = camera;
    injectStyles();

    this.root = el('div', 'wt-hud');

    // --- Tracking rings layer (behind the reticle / bars) ------------------
    this.rings = el('div', 'wt-rings');
    this.root.appendChild(this.rings);

    // --- Crosshair ---------------------------------------------------------
    this.crosshair = el('div', 'wt-crosshair');
    this.crosshair.innerHTML =
      '<span class="wt-cross-dot"></span><span class="wt-cross-diamond"></span>';
    this.harvestLabel = el('div', 'wt-harvest');
    this.crosshair.appendChild(this.harvestLabel);
    this.root.appendChild(this.crosshair);

    // --- Resource strip (top-left) -----------------------------------------
    const res = el('div', 'wt-resources');
    for (const kind of ['fiber', 'resin', 'shard', 'spark', 'mushroom', 'wood', 'stone', 'dart', 'charm', 'purifier', 'rp'] as const) {
      const item = el('div', 'wt-res');
      const dot = el('span', 'wt-res-dot');
      if (kind === 'rp') dot.classList.add('wt-res-rp');
      dot.style.background = RES_COLOR[kind]!;
      const count = el('span', 'wt-res-count');
      count.textContent = '0';
      const tag = el('span', 'wt-res-tag');
      tag.textContent =
        kind === 'rp'
          ? 'RP'
          : kind === 'dart'
            ? 'darts'
            : kind === 'charm'
              ? 'charms'
              : kind === 'purifier'
                ? 'Purifiers'
                : '';
      item.append(dot, count, tag);
      res.appendChild(item);
      this.resEls.set(kind, { dot, count, last: -1 });
    }
    this.root.appendChild(res);

    // --- Day/night cycle indicator (top-right) ------------------------------
    this.dayCycle = el('div', 'wt-daycycle');
    this.dayCycleDot = el('div', 'wt-daycycle-dot');
    this.dayCycle.appendChild(this.dayCycleDot);
    this.root.appendChild(this.dayCycle);

    // --- Compass (top-centre) ----------------------------------------------
    const compass = el('div', 'wt-compass');
    this.compassTrack = el('div', 'wt-compass-track');
    const centreMark = el('div', 'wt-compass-centre');
    compass.append(this.compassTrack, centreMark);
    this.root.appendChild(compass);

    // Persistent tick pool: one node per bearing, repositioned each frame and
    // hidden when it scrolls out of the strip's span (no per-frame rebuilds).
    for (let deg = 0; deg < 360; deg += HUDT.compassTickStepDeg) {
      const major = deg % 45 === 0;
      const mark = el('div', `wt-tick${major ? ' wt-tick-major' : ''}`);
      mark.style.display = 'none';
      if (major) {
        const lbl = el('span', 'wt-tick-label');
        lbl.textContent = CARDINAL_LABEL[deg] ?? '';
        mark.appendChild(lbl);
      }
      this.compassTrack.appendChild(mark);
      this.tickEls.set(deg, mark);
    }

    // Persistent spawn pip (white); critter pips are created per id on demand.
    this.spawnPip = el('div', 'wt-pip');
    this.spawnPip.style.background = SPAWN_COLOR;
    this.spawnPip.style.display = 'none';
    this.compassTrack.appendChild(this.spawnPip);

    // --- Stamina bar (bottom-centre) ---------------------------------------
    this.stamina = el('div', 'wt-stamina');
    this.staminaFill = el('div', 'wt-stamina-fill');
    this.stamina.appendChild(this.staminaFill);
    this.root.appendChild(this.stamina);

    // --- HP bar (bottom-centre, stacked above stamina) ---------------------
    this.health = el('div', 'wt-health');
    this.healthFill = el('div', 'wt-health-fill');
    this.health.appendChild(this.healthFill);
    this.root.appendChild(this.health);

    // --- Hotbar (bottom-centre) — 6 assignable slots (Inventory+Building
    // Task 3): each renders whatever ItemId main.ts's HotbarState has
    // assigned (or empty), painted fresh every frame by `paintHotbar` off
    // `frame.hotbarSlots`/`frame.selectedSlot`. No fixed per-slot identity
    // (darts/grapple/...) any more — grapple left the hotbar entirely (it's
    // permanently equipped) and every other slot is now player-assignable.
    const hotbar = el('div', 'wt-hotbar');
    for (let i = 0; i < NUM_SLOTS; i++) {
      const slot = el('div', 'wt-slot');
      const keyEl = el('span', 'wt-slot-key');
      keyEl.textContent = String(i + 1);
      const nameEl = el('span', 'wt-slot-name');
      const badge = el('div', 'wt-slot-badge');
      slot.append(keyEl, nameEl, badge);
      hotbar.appendChild(slot);
      this.slots.push({ root: slot, nameEl, badge });
    }
    this.root.appendChild(hotbar);

    // --- Dazed daze veil (Cursed Castle Task 11) — a full-screen dim/red
    // vignette while the post-death daze window is active. Added last so it
    // paints over everything else.
    this.dazeVeil = el('div', 'wt-daze-veil');
    this.root.appendChild(this.dazeVeil);

    // --- Blackout-drag veil (daze-eject-spires Task 1) — a full-black overlay
    // painted OVER the daze veil while main.ts's eject state machine drags the
    // player out through the gate. State-driven like the daze veil (not a
    // one-shot keyframe like the purify flash), so it holds solid black for
    // however long the eject phase lasts.
    this.blackoutVeil = el('div', 'wt-daze-black');
    this.root.appendChild(this.blackoutVeil);

    // --- Purify flash (Cursed Castle Task 14) — a one-shot white flash for
    // the crystal-purify moment. Added last of all, so it paints over even
    // the daze veil.
    this.purifyFlash = el('div', 'wt-purify-flash');
    this.root.appendChild(this.purifyFlash);

    this.host.appendChild(this.root);
  }

  /**
   * Brief shake on the currently-selected slot (Inventory+Building Task 3) —
   * feedback for an LMB press that had nothing to do (empty slot, zero-count
   * item, or an item with no LMB action). Re-triggerable like `flash()`:
   * forces a reflow before re-adding the class so a rapid repeat press always
   * restarts the shake from the top.
   */
  shake(): void {
    const slot = this.slots[this.lastSelectedSlot];
    if (!slot) return;
    slot.root.classList.remove('wt-slot-shake');
    void slot.root.offsetWidth; // force reflow so re-adding restarts the animation
    slot.root.classList.add('wt-slot-shake');
  }

  /**
   * Escape hatch for other systems (e.g. the grapple task) to force the
   * crosshair. Pass a mode string to override; pass 'auto' to release control
   * back to the HUD's own harvest/dart logic.
   */
  setCrosshairMode(mode: string): void {
    this.crosshairOverride = mode === 'auto' ? null : mode;
  }

  /** Paint one frame from a snapshot. Called once per animation frame. */
  update(frame: HudFrame): void {
    // Hide the gameplay HUD entirely while a menu is open (clean scrim).
    this.root.classList.toggle('wt-hidden', frame.screenOpen);

    this.hints(frame);
    if (frame.screenOpen) return;

    this.paintCrosshair(frame);
    this.paintStamina(frame.stamina, frame.exhausted);
    this.paintHealth(frame.hp, frame.dazed, frame.dangerZone);
    this.paintDazeVeil(frame.dazed);
    this.paintBlackout(frame.dazeBlack);
    this.paintResources(frame.inventory);
    this.paintHotbar(frame);
    this.paintCompass(frame);
    this.paintRings(frame);
    this.paintDayCycle(frame);
  }

  /**
   * One-shot full-screen white flash, fading over `CRYSTAL.flashS` (Cursed
   * Castle Task 14 — the crystal-purify moment). A CSS keyframe animation
   * (not a `frame`-driven paint like the daze veil): re-triggerable by
   * forcing a reflow before re-adding the class, so a rapid repeat call
   * (e.g. debug spam) always restarts the flash from full white.
   */
  flash(): void {
    this.purifyFlash.classList.remove('wt-purify-flash-active');
    void this.purifyFlash.offsetWidth; // force reflow so re-adding restarts the animation
    this.purifyFlash.classList.add('wt-purify-flash-active');
  }

  /**
   * Snapshot of which first-run hints have already fired (Task 14 save/load).
   * Ids: 'boot' | 'lock' | 'dart' | 'tag'.
   */
  getHintFlags(): string[] {
    const out: string[] = [];
    if (this.hintedBoot) out.push('boot');
    if (this.hintedLock) out.push('lock');
    if (this.hintedDart) out.push('dart');
    if (this.hintedTag) out.push('tag');
    return out;
  }

  /** Restore hint flags from a save. Call before the first `update()`. */
  setHintFlags(flags: readonly string[]): void {
    const set = new Set(flags);
    this.hintedBoot = set.has('boot');
    this.hintedLock = set.has('lock');
    this.hintedDart = set.has('dart');
    this.hintedTag = set.has('tag');
  }

  // -------------------------------------------------------------------------
  // First-run hint toasts (one-shot). Persisted via get/setHintFlags above so
  // returning players don't see them replay every session.
  // -------------------------------------------------------------------------
  private hints(frame: HudFrame): void {
    if (!this.hintedBoot) {
      this.hintedBoot = true;
      toast('Click to look around');
    }
    if (!this.hintedLock && frame.locked) {
      this.hintedLock = true;
      toast('Harvest fiber & resin (F), then craft darts (C)');
    }
    if (!this.hintedDart && frame.inventory.darts >= 1) {
      this.hintedDart = true;
      toast('Throw a dart at a critter (LMB)');
    }
    if (!this.hintedTag && frame.critters.some((c) => c.tagged && !c.linked)) {
      this.hintedTag = true;
      toast("Stay within the ring's radius!");
    }
  }

  // -------------------------------------------------------------------------
  // Crosshair
  // -------------------------------------------------------------------------
  private paintCrosshair(frame: HudFrame): void {
    let mode = this.crosshairOverride;
    if (!mode) {
      if (frame.buildPickup) mode = 'harvest';
      else if (frame.harvestPrompt) mode = 'harvest';
      else if (frame.inventory.darts > 0) mode = 'dart';
      else mode = 'default';
    }
    if (mode !== this.lastCrosshair) {
      this.crosshair.className = `wt-crosshair wt-cross-${mode}`;
      this.lastCrosshair = mode;
    }
    const label = frame.buildPickup
      ? `Hold F — Reclaim ${cap(frame.buildPickup.kind)} ${Math.round(frame.buildPickup.progress * 100)}%`
      : frame.harvestPrompt
        ? `F — Harvest ${cap(frame.harvestPrompt)}`
        : '';
    if (this.harvestLabel.textContent !== label) this.harvestLabel.textContent = label;
  }

  // -------------------------------------------------------------------------
  // Stamina — fill %, red flash when exhausted, auto-hide when full for >2s.
  // -------------------------------------------------------------------------
  private paintStamina(stamina: number, exhausted: boolean): void {
    const pct = Math.max(0, Math.min(1, stamina / MOVE.staminaMax));
    this.staminaFill.style.width = `${(pct * 100).toFixed(1)}%`;

    if (exhausted !== this.lastExhausted) {
      this.stamina.classList.toggle('wt-exhausted', exhausted);
      this.lastExhausted = exhausted;
    }

    const now = performance.now();
    const full = stamina >= MOVE.staminaMax - 0.5;
    let show = true;
    if (full) {
      if (this.staminaFullSince === null) this.staminaFullSince = now;
      if (now - this.staminaFullSince > 2000) show = false;
    } else {
      this.staminaFullSince = null;
    }
    if (show !== this.staminaShown) {
      this.stamina.classList.toggle('wt-visible', show);
      this.staminaShown = show;
    }
  }

  // -------------------------------------------------------------------------
  // HP — fill %, red flash while dazed, auto-hide when full for
  // HEALTH.barLingerS (Cursed Castle Task 6; no damage sources until Task 11).
  // Also stays visible at full HP while `dangerZone` (spec §4, final-review
  // fix) — a goblin ambush is a live threat inside the castle at night
  // regardless of current HP — and still lingers `barLingerS` after leaving
  // before hiding, same as the full-HP case.
  // -------------------------------------------------------------------------
  private paintHealth(hp: number, dazed: boolean, dangerZone: boolean): void {
    const pct = Math.max(0, Math.min(1, hp / HEALTH.max));
    this.healthFill.style.width = `${(pct * 100).toFixed(1)}%`;

    if (dazed !== this.lastDazed) {
      this.health.classList.toggle('wt-dazed', dazed);
      this.lastDazed = dazed;
    }

    const now = performance.now();
    const full = hp >= HEALTH.max - 0.5;
    const hideEligible = healthBarHideEligible(full, dazed, dangerZone);
    let show = true;
    if (hideEligible) {
      if (this.healthFullSince === null) this.healthFullSince = now;
      if (now - this.healthFullSince > HEALTH.barLingerS * 1000) show = false;
    } else {
      this.healthFullSince = null;
    }
    if (show !== this.healthShown) {
      this.health.classList.toggle('wt-visible', show);
      this.healthShown = show;
    }
  }

  // -------------------------------------------------------------------------
  // Dazed daze veil — full-screen dim/red vignette while HEALTH.isDazed
  // (Cursed Castle Task 11). Reuses the wt-flash pattern's spirit (CSS-driven,
  // class-toggled) but as an opacity transition rather than a hard blink —
  // this one lingers for the whole daze window, not a hit-flash.
  // -------------------------------------------------------------------------
  private paintDazeVeil(dazed: boolean): void {
    if (dazed === this.lastDazeVeil) return;
    this.lastDazeVeil = dazed;
    this.dazeVeil.classList.toggle('wt-visible', dazed);
  }

  /**
   * Blackout-drag veil (daze-eject-spires §1) — painted over the daze veil
   * while `frame.dazeBlack` is true. A plain opacity fade (CSS transition,
   * 0.4s — see the STYLE block) in both directions: fades in when the eject
   * starts, fades back out when main.ts clears it ~0.8s later.
   */
  private paintBlackout(active: boolean): void {
    if (active === this.lastBlackout) return;
    this.lastBlackout = active;
    this.blackoutVeil.classList.toggle('wt-visible', active);
  }

  // -------------------------------------------------------------------------
  // Day/night arc — a small track + dot, positioned by cycleT, sun/moon
  // coloured by darkness (Cursed Castle Task 5). Diffed like the rest of the
  // HUD so a steady state (cycleT/darkness unchanged) touches no DOM.
  // -------------------------------------------------------------------------
  private paintDayCycle(frame: HudFrame): void {
    if (frame.dayCycleT === this.lastCycleT && frame.dayDarkness === this.lastDarkness) return;
    this.lastCycleT = frame.dayCycleT;
    this.lastDarkness = frame.dayDarkness;
    const t = Math.max(0, Math.min(1, frame.dayCycleT));
    this.dayCycleDot.style.left = `${(t * 100).toFixed(2)}%`;
    this.dayCycleDot.classList.toggle('wt-moon', frame.dayDarkness >= 0.5);
  }

  // -------------------------------------------------------------------------
  // Resource strip — write only when a count changes.
  // -------------------------------------------------------------------------
  private paintResources(inv: Inventory): void {
    const values: Record<string, number> = {
      fiber: inv.fiber,
      resin: inv.resin,
      shard: inv.shard,
      spark: inv.spark,
      mushroom: inv.mushroom,
      wood: inv.wood,
      stone: inv.stone,
      dart: inv.darts,
      charm: inv.charms,
      purifier: inv.purifiers,
      rp: inv.rp,
    };
    for (const [kind, ref] of this.resEls) {
      const v = values[kind]!;
      if (v !== ref.last) {
        ref.count.textContent = String(v);
        ref.last = v;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Hotbar — 6 assignable slots (Inventory+Building Task 3). Each slot paints
  // whatever ItemId main.ts's HotbarState has assigned there (or nothing);
  // there's no more per-slot fixed identity or padlock concept — kits/charms
  // just show their live count like darts/purify always did, and dim exactly
  // when they'd no-op on LMB (empty slot or a zero-count item).
  // -------------------------------------------------------------------------
  private paintHotbar(frame: HudFrame): void {
    const inv = frame.inventory;
    this.lastSelectedSlot = frame.selectedSlot;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const item = frame.hotbarSlots[i] ?? null;
      const count = item ? itemCount(inv, item) : 0;
      const label = hotbarItemLabel(item);
      if (slot.nameEl.textContent !== label) slot.nameEl.textContent = label;
      slot.root.classList.toggle('wt-slot-dim', item === null || count <= 0);
      slot.root.classList.toggle('wt-slot-active', frame.selectedSlot === i);
      const badge = item ? String(count) : '';
      if (slot.badge.textContent !== badge) slot.badge.textContent = badge;
    }
  }

  // -------------------------------------------------------------------------
  // Compass — scrolling tick strip + tagged/linked/spawn pips.
  // -------------------------------------------------------------------------
  private paintCompass(frame: HudFrame): void {
    const w = this.compassTrack.clientWidth || 360;

    // Reposition the persistent tick pool; hide ticks outside the span.
    const visibleTicks = new Set<number>();
    for (const tick of compassTicks(frame.yaw, w)) {
      visibleTicks.add(tick.deg);
      const mark = this.tickEls.get(tick.deg);
      if (!mark) continue;
      mark.style.left = `${tick.x}px`;
      if (mark.style.display) mark.style.display = '';
    }
    for (const [deg, mark] of this.tickEls) {
      if (!visibleTicks.has(deg) && !mark.style.display) mark.style.display = 'none';
    }

    const facing = facingBearingDeg(frame.yaw);
    const now = performance.now();

    // Spawn pip (white, persistent node).
    this.positionPip(this.spawnPip, frame.spawn, frame.pos, facing, w);

    // Critter pips: reuse one node per critter id (same pattern as rings).
    const live = new Set<number>();
    for (const c of frame.critters) {
      if (!c.tagged) continue;
      let color = RING_OUT;
      let opacity = 1;
      if (c.linked) {
        let t = this.linkTimes.get(c.id);
        if (t === undefined) {
          // Start a fade only on the link *transition*: the critter still has
          // a tracking-ring node this frame (paintRings prunes it afterwards).
          // Without this gate, a pruned linkTimes entry would restart the fade
          // every LINKED_FADE_MS for as long as the critter stays active.
          if (!this.ringNodes.has(c.id)) continue;
          t = now;
          this.linkTimes.set(c.id, t);
        }
        const age = now - t;
        if (age > LINKED_FADE_MS) {
          this.linkTimes.delete(c.id); // fade complete — entry pruned for good
          continue;
        }
        color = RING_IN;
        opacity = 1 - age / LINKED_FADE_MS;
      }
      live.add(c.id);
      let pip = this.critterPips.get(c.id);
      if (!pip) {
        pip = el('div', 'wt-pip');
        this.compassTrack.appendChild(pip);
        this.critterPips.set(c.id, pip);
      }
      pip.style.background = color;
      pip.style.opacity = opacity.toFixed(2);
      this.positionPip(pip, c.pos, frame.pos, facing, w);
    }

    // Drop pip nodes for critters no longer shown (linked-faded / despawned).
    for (const [id, pip] of this.critterPips) {
      if (!live.has(id)) {
        pip.remove();
        this.critterPips.delete(id);
      }
    }
  }

  /** Place a persistent pip on the strip, hiding it outside the span. */
  private positionPip(
    pip: HTMLDivElement,
    target: Vec3,
    from: Vec3,
    facing: number,
    width: number,
  ): void {
    const bearing = worldBearingDeg(target.x - from.x, target.z - from.z);
    const { x, visible } = bearingToStripX(bearing, facing, width, HUDT.compassSpanDeg);
    if (!visible) {
      if (!pip.style.display) pip.style.display = 'none';
      return;
    }
    pip.style.left = `${x}px`;
    if (pip.style.display) pip.style.display = '';
  }

  // -------------------------------------------------------------------------
  // Tracking rings — project each tagged-not-linked critter within reach.
  // -------------------------------------------------------------------------
  private paintRings(frame: HudFrame): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    const project: ProjectFn = (world: Vec3) => {
      this._v.set(world.x, world.y, world.z);
      this._v.project(this.camera);
      // Reliable behind test: is the point in front of the camera?
      this.camera.getWorldDirection(this._fwd);
      const bx = world.x - this.camera.position.x;
      const by = world.y - this.camera.position.y;
      const bz = world.z - this.camera.position.z;
      const behind = bx * this._fwd.x + by * this._fwd.y + bz * this._fwd.z <= 0;
      return { x: this._v.x, y: this._v.y, behind };
    };

    const live = new Set<number>();
    for (const c of frame.critters) {
      if (!c.tagged || c.linked) continue;
      const sp = speciesById(c.species);
      if (!sp) continue;
      const r = ringScreenState(c, sp, frame.pos, project);
      if (r.dist > HUDT.ringMaxDist) continue;

      live.add(c.id);
      const node = this.ensureRing(c.id);

      // NDC → pixels; keep offscreen pips inset from the very edge.
      let px = (r.x * 0.5 + 0.5) * width;
      let py = (1 - (r.y * 0.5 + 0.5)) * height;
      if (!r.onScreen) {
        const inset = 26;
        px = Math.max(inset, Math.min(width - inset, px));
        py = Math.max(inset, Math.min(height - inset, py));
      }
      node.root.style.left = `${px}px`;
      node.root.style.top = `${py}px`;
      node.root.classList.toggle('wt-ring-off', !r.onScreen);

      const color = r.inRadius ? RING_IN : RING_OUT;
      node.prog.style.stroke = color;
      node.prog.style.strokeDashoffset = String(node.circ * (1 - r.pct));

      if (!r.onScreen) {
        const cx = width / 2;
        const cy = height / 2;
        const ang = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
        node.arrow.style.transform = `rotate(${ang + 90}deg)`;
        node.arrow.style.borderBottomColor = color;
      }

      const distText = `${r.dist.toFixed(1)}m`;
      if (node.label.textContent !== distText) node.label.textContent = distText;
    }

    // Remove rings for critters that are no longer tracked / in range.
    for (const [id, node] of this.ringNodes) {
      if (!live.has(id)) {
        node.root.remove();
        this.ringNodes.delete(id);
      }
    }
  }

  private ensureRing(id: number): RingNode {
    const existing = this.ringNodes.get(id);
    if (existing) return existing;

    const root = el('div', 'wt-ring');
    const size = 46;
    const r = 18;
    const circ = 2 * Math.PI * r;
    const svg = svgEl('svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));

    const track = svgEl('circle');
    track.setAttribute('cx', String(size / 2));
    track.setAttribute('cy', String(size / 2));
    track.setAttribute('r', String(r));
    track.setAttribute('class', 'wt-ring-track');

    const prog = svgEl('circle');
    prog.setAttribute('cx', String(size / 2));
    prog.setAttribute('cy', String(size / 2));
    prog.setAttribute('r', String(r));
    prog.setAttribute('class', 'wt-ring-prog');
    prog.style.strokeDasharray = String(circ);
    prog.style.strokeDashoffset = String(circ);
    // Start the progress arc at 12 o'clock.
    prog.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);

    svg.append(track, prog);

    const arrow = el('div', 'wt-ring-arrow');
    const label = el('div', 'wt-ring-label');

    root.append(svg, arrow, label);
    this.rings.appendChild(root);

    const node: RingNode = { root, prog, arrow, label, circ };
    this.ringNodes.set(id, node);
    return node;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// One injected style block for the whole HUD. Kept below the screen overlay
// (z 20) and toasts (z 15).
// ---------------------------------------------------------------------------
const STYLE = `
.wt-hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #eaf2f4;
}
.wt-hud.wt-hidden { display: none; }

/* Crosshair --------------------------------------------------------------- */
.wt-crosshair {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  z-index: 6;
}
.wt-cross-dot, .wt-cross-diamond {
  position: absolute;
  left: 50%;
  top: 50%;
  display: none;
}
.wt-cross-dot {
  width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: rgba(240, 248, 250, 0.9);
  box-shadow: 0 0 2px rgba(0,0,0,0.8);
}
.wt-cross-diamond {
  width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
  background: #66e0ff;
  transform: rotate(45deg);
  box-shadow: 0 0 4px rgba(0,0,0,0.8);
}
.wt-cross-default .wt-cross-dot { display: block; }
.wt-cross-dart .wt-cross-diamond { display: block; }
.wt-cross-harvest .wt-cross-dot { display: block; background: #a8e6bc; }
.wt-cross-grapple .wt-cross-dot { display: block; background: #f0c058; }
.wt-harvest {
  position: absolute;
  left: 50%;
  top: 20px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 12px;
  color: #cfe8d8;
  text-shadow: 0 1px 3px #000;
}

/* Resource strip ---------------------------------------------------------- */
.wt-resources {
  position: fixed;
  left: 14px;
  top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  max-width: 240px;
  z-index: 5;
  text-shadow: 0 1px 2px #000;
}
.wt-res { display: flex; align-items: center; gap: 5px; font-size: 13px; }
.wt-res-dot {
  width: 10px; height: 10px; border-radius: 50%;
  box-shadow: 0 0 2px rgba(0,0,0,0.6);
}
.wt-res-rp { border-radius: 3px; }
.wt-res-count { min-width: 12px; font-weight: bold; }
.wt-res-tag { font-size: 11px; color: #9fb0b8; }

/* Day/night arc ------------------------------------------------------------ */
.wt-daycycle {
  position: fixed;
  right: 14px;
  top: 12px;
  width: 60px;
  height: 8px;
  background: rgba(10, 14, 16, 0.55);
  border: 1px solid rgba(200, 220, 230, 0.24);
  border-radius: 4px;
  z-index: 5;
}
.wt-daycycle-dot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: #ffdca0;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
  transition: left 0.2s linear;
}
.wt-daycycle-dot.wt-moon { background: #9db4e0; }

/* Compass ----------------------------------------------------------------- */
.wt-compass {
  position: fixed;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  width: 360px;
  height: 26px;
  overflow: hidden;
  background: rgba(8, 12, 14, 0.5);
  border: 1px solid rgba(200, 220, 230, 0.18);
  border-radius: 6px;
  z-index: 5;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.wt-compass-track { position: absolute; inset: 0; }
.wt-compass-centre {
  position: absolute;
  left: 50%;
  top: 0;
  width: 1px;
  height: 100%;
  background: rgba(255, 255, 255, 0.65);
  transform: translateX(-50%);
}
.wt-tick {
  position: absolute;
  top: 16px;
  width: 1px;
  height: 5px;
  background: rgba(210, 226, 232, 0.5);
  transform: translateX(-50%);
}
.wt-tick-major { top: 12px; height: 9px; background: rgba(230, 242, 246, 0.85); }
.wt-tick-label {
  position: absolute;
  left: 50%;
  top: -12px;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: bold;
  color: #eaf2f4;
  text-shadow: 0 1px 2px #000;
}
.wt-pip {
  position: absolute;
  top: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: 0 0 3px rgba(0,0,0,0.7);
}

/* Stamina ----------------------------------------------------------------- */
.wt-stamina {
  position: fixed;
  left: 50%;
  bottom: 94px;
  transform: translateX(-50%);
  width: 220px;
  height: 6px;
  background: rgba(10, 14, 16, 0.6);
  border: 1px solid rgba(200, 220, 230, 0.22);
  border-radius: 4px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 5;
}
.wt-stamina.wt-visible { opacity: 1; }
.wt-stamina-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #6fe08a, #a8e6bc);
  transition: width 0.12s linear;
}
.wt-stamina.wt-exhausted .wt-stamina-fill {
  background: #e2564f;
  animation: wt-flash 0.5s steps(2, start) infinite;
}
@keyframes wt-flash { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }

/* HP ------------------------------------------------------------------ */
.wt-health {
  position: fixed;
  left: 50%;
  bottom: 118px;
  transform: translateX(-50%);
  width: 220px;
  height: 6px;
  background: rgba(10, 14, 16, 0.6);
  border: 1px solid rgba(200, 220, 230, 0.22);
  border-radius: 4px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 5;
}
.wt-health.wt-visible { opacity: 1; }
.wt-health-fill {
  height: 100%;
  width: 100%;
  background: #e0463a;
  transition: width 0.12s linear;
}
.wt-health.wt-dazed .wt-health-fill {
  animation: wt-flash 0.5s steps(2, start) infinite;
}

/* Dazed daze veil ----------------------------------------------------------- */
.wt-daze-veil {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(120, 20, 20, 0) 32%, rgba(90, 8, 8, 0.6) 100%);
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: 8;
  pointer-events: none;
}
.wt-daze-veil.wt-visible { opacity: 1; }

/* Blackout-drag veil (daze-eject-spires Task 1) ----------------------------- */
.wt-daze-black {
  position: fixed;
  inset: 0;
  background: #000;
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: 8;
  pointer-events: none;
}
.wt-daze-black.wt-visible { opacity: 1; }

/* Purify flash (Cursed Castle Task 14) -------------------------------------
   One-shot: wt-purify-flash-active starts the animation, which ends at
   opacity 0 and stays there (forwards) -- no removal needed between plays,
   HUD.flash() just forces a reflow before re-adding the class. Duration
   mirrors CRYSTAL.flashS (core/constants.ts). ------------------------------ */
.wt-purify-flash {
  position: fixed;
  inset: 0;
  background: #ffffff;
  opacity: 0;
  z-index: 9;
  pointer-events: none;
}
.wt-purify-flash.wt-purify-flash-active {
  animation: wt-purify-flash-anim 0.5s ease-out forwards;
}
@keyframes wt-purify-flash-anim {
  0% { opacity: 1; }
  100% { opacity: 0; }
}

/* Hotbar ------------------------------------------------------------------ */
.wt-hotbar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 5;
}
.wt-slot {
  position: relative;
  width: 58px;
  height: 52px;
  border: 1px solid rgba(200, 220, 230, 0.28);
  border-radius: 7px;
  background: rgba(14, 18, 22, 0.62);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.wt-slot-key {
  position: absolute;
  left: 5px;
  top: 3px;
  font-size: 10px;
  color: #9fb0b8;
}
.wt-slot-name { font-size: 11px; color: #dbe6ea; }
/* dim = unusable right now (empty slot or a zero-count item) */
.wt-slot-dim { opacity: 0.42; }
.wt-slot-dim .wt-slot-name { color: #8a9aa2; }
.wt-slot-active {
  border-color: #a8e6bc;
  box-shadow: 0 0 0 1px #a8e6bc, 0 0 10px rgba(120, 220, 160, 0.4);
  background: rgba(30, 48, 38, 0.7);
}
.wt-slot-badge {
  position: absolute;
  right: 3px;
  bottom: 2px;
  min-width: 15px;
  padding: 0 3px;
  font-size: 11px;
  font-weight: bold;
  text-align: center;
  color: #0b0d10;
  background: #ffe06a;
  border-radius: 8px;
}
.wt-slot-badge:empty { display: none; }
/* Empty-or-zero-count LMB feedback (Inventory+Building Task 3): a brief
   horizontal shake on the selected slot, re-triggerable via HUD.shake(). */
@keyframes wt-slot-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
.wt-slot-shake { animation: wt-slot-shake 0.28s ease; }

/* Tracking rings ---------------------------------------------------------- */
.wt-rings { position: fixed; inset: 0; z-index: 4; }
.wt-ring {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.wt-ring-track { fill: none; stroke: rgba(255, 255, 255, 0.18); stroke-width: 3; }
.wt-ring-prog { fill: none; stroke: #6fe08a; stroke-width: 3; stroke-linecap: round; transition: stroke-dashoffset 0.1s linear; }
.wt-ring-arrow { display: none; }
.wt-ring-label {
  font-size: 11px;
  font-weight: bold;
  color: #eaf2f4;
  text-shadow: 0 1px 2px #000;
  margin-top: 1px;
}
.wt-ring.wt-ring-off { transform: translate(-50%, -50%) scale(0.6); }
.wt-ring.wt-ring-off .wt-ring-arrow {
  display: block;
  width: 0; height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 9px solid #f0c058;
  margin-bottom: 2px;
}
.wt-ring.wt-ring-off .wt-ring-label { display: none; }
`;
