import type { RosterEntry } from '../critters/roster.ts';
import { speciesById } from '../critters/species.ts';
import { critterThumbnailUrl } from './model-thumbnails.ts';
import type { ScreenDef, ScreenManager } from './screens.ts';

// ---------------------------------------------------------------------------
// Roster screen (KeyB, Haven V2). Lists the player's bonded critters:
// nickname, species, status, and a Release button (confirm-on-second-click,
// like the pause screen's Reset Save). Assign / Set-as-mount buttons render
// DISABLED with "coming soon" tooltips — Haven V5 (farm) and V6 (mount) wire
// them via `setRosterActions`, the dialog-style hook other tasks plug into.
//
// The screen reads the live roster through `getRoster()` every render (main.ts
// reassigns its roster array on each bond), and `release(id)` removes the entry
// and returns the critter to the wild.
// ---------------------------------------------------------------------------

/** Later-task handlers (Haven V5/V6) plugged in via `setRosterActions`. */
export interface RosterActions {
  /** Assign a bonded critter to a farm plot (V5). Undefined ⇒ disabled. */
  assign?: (id: number) => void;
  /** Pull a bonded critter off its farm plot (V5). Shown when status is farm. */
  unassign?: (id: number) => void;
  /** Set a rideable bonded critter as the active mount (V6). Undefined ⇒ disabled. */
  mount?: (id: number) => void;
  /**
   * Whether entry `id` can currently be set as the active mount (V6): the
   * Saddle reward is owned AND the species is rideable. When omitted the Mount
   * button falls back to the species' `rideable` flag alone. Undefined result
   * ⇒ button disabled with a "saddle required" hint.
   */
  mountEnabled?: (id: number) => boolean;
}

let actions: RosterActions = {};

/**
 * Plug in the later-task action handlers (Haven V5 farm / V6 mount). Following
 * dialog's setRequestRenderer pattern: the screen ships now with the buttons
 * disabled; a later task calls this to make them live. MERGES into the existing
 * handlers (never replaces) so the farm (V5 `assign`) and mount (V6 `mount`)
 * tasks can each register their own handler from separate call sites and both
 * stay live — the two feature branches union cleanly.
 */
export function setRosterActions(next: RosterActions): void {
  actions = { ...actions, ...next };
}

function statusText(entry: RosterEntry): string {
  switch (entry.status.kind) {
    case 'idle':
      return 'Idle';
    case 'farm':
      return `Farm plot ${entry.status.plotId + 1}`;
    case 'mount':
      return 'Mount';
    case 'haul':
      return `Hauling · ${entry.status.siteId.replace('haven-', '')} (N)`;
  }
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-roster-empty { color: #9fb0b8; font-size: 14px; margin: 8px 0 4px; }
    .wt-roster-list { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .wt-roster-row {
      display: flex;
      align-items: center;
      gap: 14px;
      border: 1px solid rgba(200, 220, 230, 0.15);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px 14px;
    }
    .wt-roster-portrait {
      position: relative;
      width: 84px;
      height: 84px;
      flex: 0 0 84px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(200, 220, 230, 0.18);
      border-radius: 9px;
      background:
        radial-gradient(circle at 50% 40%, rgba(150, 195, 215, 0.19), transparent 67%),
        rgba(8, 12, 16, 0.52);
    }
    .wt-roster-portrait img {
      display: block;
      width: 80px;
      height: 80px;
      object-fit: contain;
      pointer-events: none;
      filter: drop-shadow(0 5px 5px rgba(0,0,0,0.48));
    }
    .wt-roster-portrait-fallback {
      font-size: 30px;
      font-weight: bold;
      color: #9fd8b8;
    }
    .wt-roster-portrait::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 50%;
      top: calc(100% + 7px);
      z-index: 8;
      transform: translate(-50%, -4px);
      padding: 5px 8px;
      border: 1px solid rgba(190, 220, 235, 0.3);
      border-radius: 5px;
      background: rgba(8, 11, 14, 0.96);
      color: #f1f5f6;
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 80ms ease, transform 80ms ease;
      box-shadow: 0 5px 14px rgba(0,0,0,0.45);
    }
    .wt-roster-portrait:hover::after,
    .wt-roster-portrait:focus-visible::after {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .wt-roster-id { flex: 1 1 auto; min-width: 110px; }
    .wt-roster-nick { font-size: 15px; font-weight: bold; }
    .wt-roster-species { font-size: 12px; color: #9fd8b8; }
    .wt-roster-status {
      font-size: 12px;
      color: #cfe0d6;
      min-width: 92px;
      text-align: center;
    }
    .wt-roster-actions { display: flex; gap: 8px; }
    .wt-roster-btn {
      font: inherit;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid rgba(200, 220, 230, 0.3);
      background: rgba(120, 200, 150, 0.18);
      color: #eef2f4;
      cursor: pointer;
    }
    .wt-roster-btn:hover:not(:disabled) { background: rgba(120, 200, 150, 0.3); }
    .wt-roster-btn:disabled { cursor: default; opacity: 0.4; background: rgba(255, 255, 255, 0.05); }
    .wt-roster-btn.wt-roster-release { background: rgba(220, 120, 90, 0.2); }
    .wt-roster-btn.wt-roster-release:hover:not(:disabled) { background: rgba(220, 120, 90, 0.32); }
    .wt-roster-btn.wt-roster-arm { background: rgba(220, 120, 90, 0.4); }
    @media (max-width: 720px) {
      .wt-roster-row { align-items: flex-start; flex-wrap: wrap; }
      .wt-roster-status { margin-left: auto; padding-top: 8px; }
      .wt-roster-actions { flex: 1 0 100%; justify-content: flex-end; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Build the roster ScreenDef (KeyB). `getRoster` is read on every (re)render so
 * the screen always reflects the live roster; `release(id)` drops the entry and
 * returns the critter to the wild.
 */
export function createRosterScreen(deps: {
  getRoster: () => readonly RosterEntry[];
  release: (id: number) => void;
  manager: ScreenManager;
}): ScreenDef {
  const { getRoster, release, manager } = deps;
  // Confirm-on-second-click state, scoped per screen instance (survives the
  // refresh() re-render each arm/disarm triggers).
  let confirmingId: number | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function disarm(): void {
    if (confirmTimer !== null) clearTimeout(confirmTimer);
    confirmTimer = null;
    confirmingId = null;
  }

  return {
    id: 'roster',
    render(root: HTMLElement) {
      injectStyles();
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
      h1.textContent = 'Roster';
      panel.appendChild(h1);

      const roster = getRoster();
      const sub = document.createElement('p');
      sub.className = 'wt-subhead';
      sub.textContent = `${roster.length} bonded critter${roster.length === 1 ? '' : 's'}`;
      panel.appendChild(sub);

      if (roster.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'wt-roster-empty';
        empty.textContent = 'No bonded critters yet. Link a critter, craft a Bond Charm (C), then aim at it and press F.';
        panel.appendChild(empty);
        root.appendChild(panel);
        return;
      }

      const list = document.createElement('div');
      list.className = 'wt-roster-list';
      for (const entry of roster) {
        list.appendChild(renderRow(entry));
      }
      panel.appendChild(list);
      root.appendChild(panel);
    },
  };

  function renderRow(entry: RosterEntry): HTMLDivElement {
    const sp = speciesById(entry.speciesId);
    const row = document.createElement('div');
    row.className = 'wt-roster-row';

    const portrait = document.createElement('div');
    portrait.className = 'wt-roster-portrait';
    portrait.tabIndex = 0;
    const speciesName = sp?.name ?? entry.speciesId;
    portrait.dataset.tooltip = `${entry.nickname} · ${speciesName}`;
    portrait.setAttribute('aria-label', `${entry.nickname}, ${speciesName}`);
    const thumbnail = critterThumbnailUrl(entry.speciesId, entry.id);
    if (thumbnail) {
      const image = document.createElement('img');
      image.src = thumbnail;
      image.alt = '';
      image.draggable = false;
      portrait.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'wt-roster-portrait-fallback';
      fallback.textContent = speciesName.slice(0, 1).toUpperCase();
      portrait.appendChild(fallback);
    }
    row.appendChild(portrait);

    const idBlock = document.createElement('div');
    idBlock.className = 'wt-roster-id';
    const nick = document.createElement('div');
    nick.className = 'wt-roster-nick';
    nick.textContent = entry.nickname;
    const species = document.createElement('div');
    species.className = 'wt-roster-species';
    species.textContent = speciesName;
    idBlock.append(nick, species);
    row.appendChild(idBlock);

    const status = document.createElement('div');
    status.className = 'wt-roster-status';
    status.textContent = statusText(entry);
    row.appendChild(status);

    const btns = document.createElement('div');
    btns.className = 'wt-roster-actions';

    // Assign / Unassign — a farmed critter shows Unassign; an idle one Assign.
    // Both disabled until Haven V5 provides the handlers.
    const farmed = entry.status.kind === 'farm';
    const assign = document.createElement('button');
    assign.className = 'wt-roster-btn';
    assign.type = 'button';
    if (farmed) {
      assign.textContent = 'Unassign';
      if (actions.unassign) {
        assign.addEventListener('click', () => actions.unassign!(entry.id));
      } else {
        assign.disabled = true;
        assign.title = '(farm coming soon)';
      }
    } else {
      assign.textContent = 'Assign';
      // A mount-status critter can't go to the farm (statuses are exclusive —
      // mirrors how a farm-status critter can't be mounted): unset it first.
      if (entry.status.kind === 'mount') {
        assign.disabled = true;
        assign.title = '(unset as mount first)';
      } else if (actions.assign) {
        assign.addEventListener('click', () => actions.assign!(entry.id));
      } else {
        assign.disabled = true;
        assign.title = '(farm coming soon)';
      }
    }
    btns.appendChild(assign);

    // Mount — disabled until Haven V6 provides a `mount` handler (and a saddle).
    const mount = document.createElement('button');
    mount.className = 'wt-roster-btn';
    mount.type = 'button';
    mount.textContent = entry.status.kind === 'mount' ? 'Mounted' : 'Mount';
    const rideEnabled =
      !!actions.mount &&
      !!sp?.rideable &&
      (actions.mountEnabled ? actions.mountEnabled(entry.id) : true);
    if (rideEnabled) {
      mount.addEventListener('click', () => actions.mount!(entry.id));
    } else {
      mount.disabled = true;
      mount.title = sp?.rideable ? '(saddle required)' : '(not rideable)';
    }
    btns.appendChild(mount);

    // Release — confirm-on-second-click (like Reset Save).
    const releaseBtn = document.createElement('button');
    releaseBtn.type = 'button';
    const arming = confirmingId === entry.id;
    releaseBtn.className = `wt-roster-btn wt-roster-release${arming ? ' wt-roster-arm' : ''}`;
    releaseBtn.textContent = arming ? 'Confirm?' : 'Release';
    releaseBtn.addEventListener('click', () => {
      if (confirmingId === entry.id) {
        disarm();
        release(entry.id);
        manager.refresh();
        return;
      }
      disarm();
      confirmingId = entry.id;
      confirmTimer = setTimeout(() => {
        confirmingId = null;
        manager.refresh();
      }, 3000);
      manager.refresh();
    });
    btns.appendChild(releaseBtn);

    row.appendChild(btns);
    return row;
  }
}
