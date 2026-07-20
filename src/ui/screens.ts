import type { Inventory } from '../craft/inventory.ts';
import { canCraft, craft, RECIPES } from '../craft/recipes.ts';
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
  ['R', 'Rocket  (when crafted)'],
  ['RMB', 'Fire Grapple — auto-zips on latch  (when crafted)'],
  ['F', 'Harvest / Interact'],
  ['LMB', 'Throw tracker dart'],
  ['1 – 4', 'Hotbar'],
  ['C', 'Crafting'],
  ['B', 'Roster'],
  ['Tab', 'Field Guide'],
  ['Esc', 'Pause / Close'],
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
 * Build the ScreenDef for the pause / help overlay (Esc). "Reset Save" is a
 * double-confirm: the first click arms it ("Really? Click again", reverting
 * after 3 s if untouched); the second click clears the save and reloads.
 * Confirm state is scoped to this call (one instance per ScreenManager), so
 * it survives the `refresh()` re-render the arm/disarm triggers.
 */
export function createHelpScreen(manager: ScreenManager, quality?: QualityControl): ScreenDef {
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

      // Quality selector (Fidelity-2 P1): three preset buttons, active one
      // highlighted. Applying live-updates the cheap flags (grass); main.ts
      // toasts "reload to apply" for the reload-required ones.
      if (quality) {
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
