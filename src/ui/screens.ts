import type { Inventory } from '../craft/inventory.ts';
import { canCraft, craft, RECIPES } from '../craft/recipes.ts';
import {
  assign as assignHotbar,
  itemCount,
  ITEM_IDS,
  NUM_SLOTS,
  type HotbarState,
  type ItemId,
} from '../craft/hotbar.ts';
import { hotbarItemLabel } from './hud-math.ts';
import type { Recipe, RecipeId, ResourceKind } from '../core/types.ts';
import { clearSave } from '../core/save.ts';
import { QUALITY_IDS, type QualityId } from '../core/quality.ts';

/**
 * Esc-menu quality selector hook (Fidelity-2 P1). `current()` reads the live
 * preset for the active-button highlight; `apply(id)` switches it (main.ts
 * live-applies the cheap flags and toasts a reload for the rest).
 */
export interface QualityControl {
  current(): QualityId;
  apply(id: QualityId): void;
}

// ---------------------------------------------------------------------------
// Screen manager: one overlay div appended to #hud, screens register a
// (re)render function keyed by id. Only one screen is ever open at a time.
// KeyC / Esc toggle wiring lives in main.ts (via `toggle('craft')` /
// `handleEscape()`); main.ts also gates `player.update` and pointer lock on
// `isOpen()`. Opening a screen releases pointer lock so the mouse is free to
// click cards; closing it does not re-acquire lock — the player re-locks by
// clicking the canvas (Input's existing click handler).
//
// Plain DOM, no framework. A single injected <style> block (once per page)
// covers every registered screen so per-screen render functions stay pure
// markup + a couple of inline class toggles.
// ---------------------------------------------------------------------------

export interface ScreenDef {
  id: string;
  /** (Re)build this screen's content into `root`. Called on open and on refresh(). */
  render(root: HTMLElement): void;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-screen-overlay {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(6, 8, 10, 0.72);
      pointer-events: auto;
      cursor: default;
    }
    .wt-panel {
      width: min(880px, 92vw);
      max-height: 86vh;
      overflow-y: auto;
      background: rgba(18, 22, 26, 0.92);
      border: 1px solid rgba(200, 220, 230, 0.18);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      color: #eef2f4;
      font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 18px 22px 22px;
    }
    .wt-panel h1 {
      margin: 0 0 2px;
      font-size: 20px;
      letter-spacing: 0.02em;
    }
    .wt-panel .wt-subhead {
      margin: 0 0 16px;
      font-size: 13px;
      color: #9fd8b8;
      opacity: 0.9;
    }
    .wt-close {
      float: right;
      background: transparent;
      border: 1px solid rgba(200, 220, 230, 0.3);
      color: #eef2f4;
      border-radius: 6px;
      font: inherit;
      font-size: 13px;
      padding: 4px 10px;
      cursor: pointer;
    }
    .wt-close:hover {
      background: rgba(200, 220, 230, 0.12);
    }
    .wt-tier-label {
      margin: 18px 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #9fb0b8;
    }
    .wt-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 12px;
    }
    .wt-card {
      border: 1px solid rgba(200, 220, 230, 0.15);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .wt-card.wt-locked {
      opacity: 0.62;
    }
    .wt-card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .wt-card-name {
      font-size: 14px;
      font-weight: bold;
    }
    .wt-card-name .wt-batch {
      font-weight: normal;
      color: #9fb0b8;
      font-size: 12px;
      margin-left: 4px;
    }
    .wt-rp-badge {
      font-size: 11px;
      border-radius: 4px;
      padding: 2px 6px;
      white-space: nowrap;
    }
    .wt-rp-badge.wt-rp-met {
      background: rgba(120, 200, 150, 0.18);
      color: #9fd8b8;
    }
    .wt-rp-badge.wt-rp-locked {
      background: rgba(220, 120, 90, 0.2);
      color: #f0a888;
    }
    .wt-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .wt-pill {
      font-size: 11px;
      border-radius: 10px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .wt-pill.wt-have {
      color: #a8e6bc;
      border-color: rgba(120, 200, 150, 0.35);
    }
    .wt-pill.wt-short {
      color: #f5a1a1;
      border-color: rgba(220, 100, 100, 0.4);
    }
    .wt-craft-btn {
      margin-top: auto;
      font: inherit;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(200, 220, 230, 0.3);
      background: rgba(120, 200, 150, 0.18);
      color: #eef2f4;
      cursor: pointer;
    }
    .wt-craft-btn:hover:not(:disabled) {
      background: rgba(120, 200, 150, 0.3);
    }
    .wt-craft-btn:disabled {
      cursor: default;
      opacity: 0.45;
      background: rgba(255, 255, 255, 0.05);
    }
  `;
  document.head.appendChild(style);
}

/** The slice of Input the screen manager needs (edge-latch hygiene). */
export interface EdgeClearer {
  clearEdges(): void;
}

export class ScreenManager {
  private readonly overlay: HTMLDivElement;
  private readonly screens = new Map<string, ScreenDef>();
  private readonly input: EdgeClearer;
  private active: string | null = null;

  constructor(hud: HTMLElement, input: EdgeClearer) {
    this.input = input;
    injectStyles();
    this.overlay = document.createElement('div');
    this.overlay.className = 'wt-screen-overlay';
    hud.appendChild(this.overlay);
    // Clicking the scrim (not a card/panel) closes the screen. The panel
    // itself stops propagation so clicks inside it don't bubble here.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  /** Register a screen definition. Re-registering the same id replaces it. */
  register(def: ScreenDef): void {
    this.screens.set(def.id, def);
  }

  /** True while any screen is open (main.ts pauses player.update on this). */
  isOpen(): boolean {
    return this.active !== null;
  }

  open(id: string): void {
    const def = this.screens.get(id);
    if (!def) return;
    this.active = id;
    this.overlay.style.display = 'flex';
    document.exitPointerLock();
    // Drop any jump/dash/rocket edge latched just before opening — state()
    // is not read while a screen is open, so it would fire stale on close.
    this.input.clearEdges();
    this.renderActive();
  }

  close(): void {
    this.active = null;
    this.overlay.style.display = 'none';
    this.overlay.replaceChildren();
    // Keydown listeners stay live while a screen is open, so edges latched
    // during it must be dropped too — clear on close as well as open.
    this.input.clearEdges();
  }

  toggle(id: string): void {
    if (this.active === id) this.close();
    else this.open(id);
  }

  /** Esc closes whichever screen is open; no-op if none is. */
  handleEscape(): void {
    if (this.active) this.close();
  }

  /** Re-render the currently open screen in place (e.g. after a craft). */
  refresh(): void {
    if (this.active) this.renderActive();
  }

  private renderActive(): void {
    const def = this.active ? this.screens.get(this.active) : undefined;
    if (!def) return;
    this.overlay.replaceChildren();
    def.render(this.overlay);
  }
}

// ---------------------------------------------------------------------------
// Crafting pane. `inventory` and `unlocks` are the live objects owned by
// main.ts/PlayerController — craft() itself is pure, so the click handler
// below copies the returned inv fields back onto the same object (keeping
// referential identity for every other consumer: HUD, addResource, etc.) and
// adds `unlocked` to the unlocks set itself, per the "craft() never mutates
// unlocks — caller adds it" contract.
// ---------------------------------------------------------------------------

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  fiber: 'Fiber',
  resin: 'Resin',
  shard: 'Shard',
  spark: 'Spark',
  mushroom: 'Mushroom',
  wood: 'Wood',
  stone: 'Stone',
};

function applyCraft(inventory: Inventory, unlocks: Set<string>, recipeId: RecipeId): void {
  const result = craft(inventory, recipeId, unlocks);
  Object.assign(inventory, result.inv);
  if (result.unlocked) unlocks.add(result.unlocked);
}

function renderCostPills(inv: Inventory, cost: Recipe['cost']): HTMLDivElement {
  const pills = document.createElement('div');
  pills.className = 'wt-pills';
  for (const key of Object.keys(cost) as ResourceKind[]) {
    const need = cost[key] ?? 0;
    const have = inv[key];
    const pill = document.createElement('span');
    pill.className = `wt-pill ${have >= need ? 'wt-have' : 'wt-short'}`;
    pill.textContent = `${RESOURCE_LABEL[key]} ${have}/${need}`;
    pills.appendChild(pill);
  }
  return pills;
}

function renderRecipeCard(
  inv: Inventory,
  unlocks: Set<string>,
  recipe: Recipe,
  onChanged: () => void,
): HTMLDivElement {
  const check = canCraft(inv, recipe.id, unlocks);
  const rpMet = inv.rp >= recipe.rpRequired;

  const card = document.createElement('div');
  card.className = `wt-card${check.ok ? '' : ' wt-locked'}`;

  const head = document.createElement('div');
  head.className = 'wt-card-head';

  const name = document.createElement('span');
  name.className = 'wt-card-name';
  name.textContent = recipe.name;
  if (recipe.batch && recipe.batch > 1) {
    const batch = document.createElement('span');
    batch.className = 'wt-batch';
    batch.textContent = `×${recipe.batch}`;
    name.appendChild(batch);
  }
  head.appendChild(name);

  if (recipe.rpRequired > 0) {
    const badge = document.createElement('span');
    badge.className = `wt-rp-badge ${rpMet ? 'wt-rp-met' : 'wt-rp-locked'}`;
    badge.textContent = rpMet ? `Tier ${recipe.tier}` : `🔒 ${recipe.rpRequired} RP`;
    head.appendChild(badge);
  }
  card.appendChild(head);

  card.appendChild(renderCostPills(inv, recipe.cost));

  const button = document.createElement('button');
  button.className = 'wt-craft-btn';
  button.type = 'button';
  if (check.reason === 'owned') {
    button.textContent = 'Owned';
    button.disabled = true;
  } else {
    button.textContent = 'Craft';
    button.disabled = !check.ok;
  }
  button.addEventListener('click', () => {
    applyCraft(inv, unlocks, recipe.id);
    onChanged();
  });
  card.appendChild(button);

  return card;
}

// ---------------------------------------------------------------------------
// Pause / Help overlay (Esc). A keybind reference plus a (disabled) Reset Save
// placeholder — Task 14 wires the reset — and a Resume button. Registered by
// main.ts and opened when Esc is pressed with no other screen open; Esc while
// any screen is open closes it (ScreenManager.handleEscape), so this only ever
// opens from the un-paused state. Reuses the shared panel style + one small
// injected block for the keybind grid.
// ---------------------------------------------------------------------------

const KEYBINDS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump  (hold to Glide — when crafted)'],
  ['Q', 'Dash'],
  ['R', 'Rocket  (when crafted) — rotates the build ghost +90° while placing'],
  ['Ctrl', 'Hold while placing to snap to nearby pieces (freeform otherwise)'],
  ['RMB', 'Fire Grapple — auto-zips on latch  (when crafted)'],
  ['F', 'Harvest / Interact'],
  ['LMB', 'Use the selected hotbar item (throw / confirm placement)'],
  ['1 – 6', 'Hotbar select'],
  ['Wheel', 'Hotbar select'],
  ['C', 'Crafting'],
  ['B', 'Roster'],
  ['Tab', 'Field Guide'],
  ['Esc', 'Inventory / Close'],
];

let helpStylesInjected = false;

function injectHelpStyles(): void {
  if (helpStylesInjected) return;
  helpStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-help-grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 18px;
      margin: 6px 0 20px;
      font-size: 14px;
    }
    .wt-help-key {
      font-weight: bold;
      color: #a8e6bc;
      white-space: nowrap;
    }
    .wt-help-desc { color: #cfe0d6; }
    .wt-help-actions { display: flex; gap: 10px; }
    .wt-help-btn {
      font: inherit;
      font-size: 14px;
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid rgba(200, 220, 230, 0.3);
      background: rgba(120, 200, 150, 0.18);
      color: #eef2f4;
      cursor: pointer;
    }
    .wt-help-btn:hover:not(:disabled) { background: rgba(120, 200, 150, 0.3); }
    .wt-help-btn:disabled { cursor: default; opacity: 0.4; background: rgba(255,255,255,0.05); }
    .wt-quality {
      margin: 4px 0 18px;
    }
    .wt-quality-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #9fb0b8;
      margin-bottom: 8px;
    }
    .wt-quality-btns { display: flex; gap: 8px; }
    .wt-quality-btn {
      font: inherit;
      font-size: 13px;
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid rgba(200, 220, 230, 0.3);
      background: rgba(255, 255, 255, 0.05);
      color: #cfe0d6;
      cursor: pointer;
      text-transform: capitalize;
    }
    .wt-quality-btn:hover { background: rgba(200, 220, 230, 0.12); }
    .wt-quality-btn.wt-quality-active {
      background: rgba(120, 200, 150, 0.28);
      border-color: rgba(120, 200, 150, 0.6);
      color: #eef2f4;
      font-weight: bold;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Quality preset row (Fidelity-2 P1): three preset buttons, active one
 * highlighted. Applying persists the choice; main.ts toasts "reload to
 * apply" for the reload-required flags (shadows/post/LOD). Shared by the
 * inventory screen (Inventory+Building Task 3 relocated it here from the
 * pause/help overlay — see `createInventoryScreen`) — a plain DOM-append
 * helper rather than its own ScreenDef since it's a fragment of a screen, not
 * a screen itself.
 */
function renderQualitySelector(panel: HTMLElement, quality: QualityControl, manager: ScreenManager): void {
  const active = quality.current();
  const qwrap = document.createElement('div');
  qwrap.className = 'wt-quality';
  const qlabel = document.createElement('div');
  qlabel.className = 'wt-quality-label';
  qlabel.textContent = 'Quality';
  qwrap.appendChild(qlabel);
  const qbtns = document.createElement('div');
  qbtns.className = 'wt-quality-btns';
  for (const id of QUALITY_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wt-quality-btn${id === active ? ' wt-quality-active' : ''}`;
    b.dataset.quality = id;
    b.textContent = id;
    b.addEventListener('click', () => {
      quality.apply(id);
      manager.refresh(); // re-render to move the active highlight
    });
    qbtns.appendChild(b);
  }
  qwrap.appendChild(qbtns);
  panel.appendChild(qwrap);
}

/**
 * Build the ScreenDef for the pause / help overlay. "Reset Save" is a
 * double-confirm: the first click arms it ("Really? Click again", reverting
 * after 3 s if untouched); the second click clears the save and reloads.
 * Confirm state is scoped to this call (one instance per ScreenManager), so
 * it survives the `refresh()` re-render the arm/disarm triggers. No longer
 * Esc's direct target (Inventory+Building Task 3: Esc with nothing open now
 * opens the Inventory screen instead) — reached via the inventory screen's
 * "Controls" button, or the `?screen=help` dev hook.
 */
export function createHelpScreen(manager: ScreenManager): ScreenDef {
  let confirmingReset = false;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    id: 'help',
    render(root: HTMLElement) {
      injectHelpStyles();
      const panel = document.createElement('div');
      panel.className = 'wt-panel';
      panel.addEventListener('click', (e) => e.stopPropagation());

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wt-close';
      closeBtn.type = 'button';
      closeBtn.textContent = 'Resume (Esc)';
      closeBtn.addEventListener('click', () => manager.close());
      panel.appendChild(closeBtn);

      const h1 = document.createElement('h1');
      h1.textContent = 'Paused';
      panel.appendChild(h1);

      const subhead = document.createElement('p');
      subhead.className = 'wt-subhead';
      subhead.textContent = 'Controls';
      panel.appendChild(subhead);

      const grid = document.createElement('div');
      grid.className = 'wt-help-grid';
      for (const [key, desc] of KEYBINDS) {
        const k = document.createElement('div');
        k.className = 'wt-help-key';
        k.textContent = key;
        const d = document.createElement('div');
        d.className = 'wt-help-desc';
        d.textContent = desc;
        grid.append(k, d);
      }
      panel.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'wt-help-actions';

      const resume = document.createElement('button');
      resume.className = 'wt-help-btn';
      resume.type = 'button';
      resume.textContent = 'Resume';
      resume.addEventListener('click', () => manager.close());

      const reset = document.createElement('button');
      reset.className = 'wt-help-btn';
      reset.type = 'button';
      reset.textContent = confirmingReset ? 'Really? Click again' : 'Reset Save';
      reset.addEventListener('click', () => {
        if (confirmingReset) {
          if (resetTimer !== null) clearTimeout(resetTimer);
          confirmingReset = false;
          clearSave();
          window.location.reload();
          return;
        }
        confirmingReset = true;
        resetTimer = setTimeout(() => {
          confirmingReset = false;
          manager.refresh();
        }, 3000);
        manager.refresh();
      });

      actions.append(resume, reset);
      panel.appendChild(actions);

      root.appendChild(panel);
    },
  };
}

/** Build the ScreenDef for the crafting pane (KeyC). */
export function createCraftScreen(
  inventory: Inventory,
  unlocks: Set<string>,
  manager: ScreenManager,
): ScreenDef {
  return {
    id: 'craft',
    render(root: HTMLElement) {
      const panel = document.createElement('div');
      panel.className = 'wt-panel';
      panel.addEventListener('click', (e) => e.stopPropagation());

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wt-close';
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close (Esc)';
      closeBtn.addEventListener('click', () => manager.close());
      panel.appendChild(closeBtn);

      const h1 = document.createElement('h1');
      h1.textContent = 'Crafting';
      panel.appendChild(h1);

      const subhead = document.createElement('p');
      subhead.className = 'wt-subhead';
      subhead.textContent = `Research ${inventory.rp}`;
      panel.appendChild(subhead);

      const tiers = [0, 1, 2, 3] as const;
      for (const tier of tiers) {
        const recipes = RECIPES.filter((r) => r.tier === tier);
        if (recipes.length === 0) continue;

        // Tier header RP comes from the recipe data itself (rpRequired is
        // uniform within a tier by construction), never a duplicated literal.
        const rpRequired = recipes[0]!.rpRequired;
        const label = document.createElement('div');
        label.className = 'wt-tier-label';
        label.textContent = tier === 0 ? 'Tier 0 — Start' : `Tier ${tier} — ${rpRequired} RP`;
        panel.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'wt-grid';
        for (const recipe of recipes) {
          grid.appendChild(
            renderRecipeCard(inventory, unlocks, recipe, () => manager.refresh()),
          );
        }
        panel.appendChild(grid);
      }

      root.appendChild(panel);
    },
  };
}

// ---------------------------------------------------------------------------
// Inventory screen (Inventory+Building Task 3). Esc's new default target
// (opened when no screen is open; Esc while it's open still just closes it,
// same as every other screen). Three sections in one panel:
//   1. Item grid — the 7 ItemIds, shown once owned (count > 0) or already
//      assigned to a slot. Click a card to "arm" it (highlighted), then click
//      a hotbar slot below to assign it there.
//   2. Resources row — read-only counts for every ResourceKind + RP.
//   3. Hotbar strip — the live 6 slots. Click an armed slot to assign the
//      armed item there (overwriting/moving as `assign()` dictates); click a
//      FILLED slot with nothing armed to clear it. No drag-and-drop needed.
// The quality selector (relocated from the old pause/help overlay) sits in a
// compact row at the bottom; a "Controls" button reaches the keybind
// reference + Reset Save, since Esc no longer opens that screen directly.
// ---------------------------------------------------------------------------

const ITEM_COLOR: Record<ItemId, string> = {
  darts: '#66e0ff',
  purifiers: '#8ef0c0',
  charms: '#d98cff',
  'kit:zipline': '#f0c058',
  'kit:drone': '#7fb2f0',
  wall: '#8f8f92',
  ramp: '#c9a06a',
  cube: '#8f8f92',
};

const RESOURCE_COLOR: Record<ResourceKind, string> = {
  fiber: '#8bd18a',
  resin: '#e0a85c',
  shard: '#8ecbe0',
  spark: '#f0e06a',
  mushroom: '#9c5bd0',
  wood: '#8a5a35',
  stone: '#8f8f92',
};

let inventoryStylesInjected = false;

function injectInventoryStyles(): void {
  if (inventoryStylesInjected) return;
  inventoryStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-inv-section-label {
      margin: 18px 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #9fb0b8;
    }
    .wt-inv-section-label:first-of-type { margin-top: 4px; }
    .wt-inv-empty {
      color: #9fb0b8;
      font-size: 13px;
      margin: 4px 0;
    }
    .wt-inv-items {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .wt-inv-card {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(200, 220, 230, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      color: #eef2f4;
    }
    .wt-inv-card:hover { background: rgba(255, 255, 255, 0.07); }
    .wt-inv-card.wt-inv-armed {
      border-color: #a8e6bc;
      box-shadow: 0 0 0 1px #a8e6bc;
      background: rgba(120, 200, 150, 0.16);
    }
    .wt-inv-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
      flex: none;
    }
    .wt-inv-card-count {
      font-weight: bold;
      color: #9fd8b8;
    }
    .wt-inv-res-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
    }
    .wt-inv-res {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #cfe0d6;
    }
    .wt-inv-hotbar {
      display: flex;
      gap: 8px;
    }
    .wt-inv-slot {
      width: 78px;
      height: 62px;
      border: 1px solid rgba(200, 220, 230, 0.28);
      border-radius: 7px;
      background: rgba(14, 18, 22, 0.62);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      cursor: pointer;
      font: inherit;
      color: #dbe6ea;
      position: relative;
    }
    .wt-inv-slot:hover { background: rgba(255, 255, 255, 0.06); }
    .wt-inv-slot-key {
      position: absolute;
      left: 5px;
      top: 3px;
      font-size: 10px;
      color: #9fb0b8;
    }
    .wt-inv-slot-name { font-size: 11px; }
    .wt-inv-slot-count { font-size: 11px; color: #9fd8b8; }
    .wt-inv-slot-empty { font-size: 11px; color: #66707a; }
    .wt-inv-slot.wt-inv-slot-selected {
      border-color: #a8e6bc;
      box-shadow: 0 0 0 1px #a8e6bc, 0 0 10px rgba(120, 220, 160, 0.4);
    }
    .wt-inv-controls-btn {
      float: right;
      margin-left: 8px;
      font: inherit;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(200, 220, 230, 0.3);
      background: transparent;
      color: #eef2f4;
      cursor: pointer;
    }
    .wt-inv-controls-btn:hover { background: rgba(200, 220, 230, 0.12); }
  `;
  document.head.appendChild(style);
}

export interface InventoryScreenDeps {
  inventory: Inventory;
  /** Read the live hotbar (main.ts owns the `let hotbar` state). */
  getHotbar(): HotbarState;
  /** Replace the live hotbar with a new (pure-derived) state and sync any
   *  selection-driven side effects (main.ts's placement-ghost enter/cancel). */
  setHotbar(next: HotbarState): void;
  manager: ScreenManager;
  quality?: QualityControl;
}

const RESOURCE_KINDS: readonly ResourceKind[] = [
  'fiber',
  'resin',
  'shard',
  'spark',
  'mushroom',
  'wood',
  'stone',
];

/** Build the ScreenDef for the inventory screen (Esc, when nothing else is open). */
export function createInventoryScreen(deps: InventoryScreenDeps): ScreenDef {
  const { inventory, getHotbar, setHotbar, manager, quality } = deps;
  // "Armed" item: the last-clicked item-grid card, staged to be assigned into
  // whichever hotbar slot is clicked next. Scoped to this call (one instance
  // per ScreenManager) so it survives the refresh() re-render each click
  // triggers. `expectRefresh` distinguishes "we just called manager.refresh()
  // ourselves" (keep `armed`) from a fresh `open()` render (Esc/scrim-close
  // never runs our code, so this is the only hook point to reset a stale arm
  // before the screen is shown again).
  let armed: ItemId | null = null;
  let expectRefresh = false;
  function refresh(): void {
    expectRefresh = true;
    manager.refresh();
  }

  return {
    id: 'inventory',
    render(root: HTMLElement) {
      if (!expectRefresh) armed = null;
      expectRefresh = false;
      injectInventoryStyles();
      injectHelpStyles(); // shares .wt-quality* styles with the old help screen
      const panel = document.createElement('div');
      panel.className = 'wt-panel';
      panel.addEventListener('click', (e) => e.stopPropagation());

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wt-close';
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close (Esc)';
      closeBtn.addEventListener('click', () => {
        armed = null;
        manager.close();
      });
      panel.appendChild(closeBtn);

      const controlsBtn = document.createElement('button');
      controlsBtn.className = 'wt-inv-controls-btn';
      controlsBtn.type = 'button';
      controlsBtn.textContent = 'Controls';
      controlsBtn.addEventListener('click', () => manager.open('help'));
      panel.appendChild(controlsBtn);

      const h1 = document.createElement('h1');
      h1.textContent = 'Inventory';
      panel.appendChild(h1);

      const hotbar = getHotbar();

      // --- Items -------------------------------------------------------------
      const itemsLabel = document.createElement('div');
      itemsLabel.className = 'wt-inv-section-label';
      itemsLabel.textContent = 'Items';
      panel.appendChild(itemsLabel);

      const owned = ITEM_IDS.filter(
        (item) => itemCount(inventory, item) > 0 || hotbar.slots.includes(item),
      );
      if (owned.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'wt-inv-empty';
        empty.textContent = 'Nothing craftable yet — check the Crafting menu (C).';
        panel.appendChild(empty);
      } else {
        const itemsGrid = document.createElement('div');
        itemsGrid.className = 'wt-inv-items';
        for (const item of owned) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = `wt-inv-card${item === armed ? ' wt-inv-armed' : ''}`;
          const dot = document.createElement('span');
          dot.className = 'wt-inv-dot';
          dot.style.background = ITEM_COLOR[item];
          const name = document.createElement('span');
          name.textContent = hotbarItemLabel(item);
          const count = document.createElement('span');
          count.className = 'wt-inv-card-count';
          count.textContent = String(itemCount(inventory, item));
          card.append(dot, name, count);
          card.addEventListener('click', () => {
            armed = armed === item ? null : item; // clicking the armed card again disarms it
            refresh();
          });
          itemsGrid.appendChild(card);
        }
        panel.appendChild(itemsGrid);
      }

      // --- Resources (read-only) ---------------------------------------------
      const resLabel = document.createElement('div');
      resLabel.className = 'wt-inv-section-label';
      resLabel.textContent = 'Resources';
      panel.appendChild(resLabel);

      const resRow = document.createElement('div');
      resRow.className = 'wt-inv-res-row';
      for (const kind of RESOURCE_KINDS) {
        const item = document.createElement('div');
        item.className = 'wt-inv-res';
        const dot = document.createElement('span');
        dot.className = 'wt-inv-dot';
        dot.style.background = RESOURCE_COLOR[kind];
        const label = document.createElement('span');
        label.textContent = `${RESOURCE_LABEL[kind]} ${inventory[kind]}`;
        item.append(dot, label);
        resRow.appendChild(item);
      }
      const rp = document.createElement('div');
      rp.className = 'wt-inv-res';
      const rpDot = document.createElement('span');
      rpDot.className = 'wt-inv-dot';
      rpDot.style.background = '#9fd8b8';
      const rpLabel = document.createElement('span');
      rpLabel.textContent = `RP ${inventory.rp}`;
      rp.append(rpDot, rpLabel);
      resRow.appendChild(rp);
      panel.appendChild(resRow);

      // --- Hotbar --------------------------------------------------------------
      const hotbarLabel = document.createElement('div');
      hotbarLabel.className = 'wt-inv-section-label';
      hotbarLabel.textContent = 'Hotbar';
      panel.appendChild(hotbarLabel);

      const hotbarRow = document.createElement('div');
      hotbarRow.className = 'wt-inv-hotbar';
      for (let i = 0; i < NUM_SLOTS; i++) {
        const item = hotbar.slots[i] ?? null;
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = `wt-inv-slot${hotbar.selected === i ? ' wt-inv-slot-selected' : ''}`;
        const key = document.createElement('span');
        key.className = 'wt-inv-slot-key';
        key.textContent = String(i + 1);
        slot.appendChild(key);
        if (item) {
          const name = document.createElement('span');
          name.className = 'wt-inv-slot-name';
          name.textContent = hotbarItemLabel(item);
          const count = document.createElement('span');
          count.className = 'wt-inv-slot-count';
          count.textContent = String(itemCount(inventory, item));
          slot.append(name, count);
        } else {
          const empty = document.createElement('span');
          empty.className = 'wt-inv-slot-empty';
          empty.textContent = 'Empty';
          slot.appendChild(empty);
        }
        slot.addEventListener('click', () => {
          if (armed) {
            setHotbar(assignHotbar(getHotbar(), i, armed));
            armed = null;
          } else if (item) {
            setHotbar(assignHotbar(getHotbar(), i, null));
          }
          refresh();
        });
        hotbarRow.appendChild(slot);
      }
      panel.appendChild(hotbarRow);

      // --- Quality (relocated from the old pause/help overlay) -----------------
      if (quality) renderQualitySelector(panel, quality, manager);

      root.appendChild(panel);
    },
  };
}
