import type { RosterEntry } from '../critters/roster.ts';
import { speciesById } from '../critters/species.ts';
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
      return `Farm plot ${entry.status.plotId}`;
    case 'mount':
      return 'Mount';
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
    .wt-roster-id { flex: 1 1 auto; }
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

    const idBlock = document.createElement('div');
    idBlock.className = 'wt-roster-id';
    const nick = document.createElement('div');
    nick.className = 'wt-roster-nick';
    nick.textContent = entry.nickname;
    const species = document.createElement('div');
    species.className = 'wt-roster-species';
    species.textContent = sp?.name ?? entry.speciesId;
    idBlock.append(nick, species);
    row.appendChild(idBlock);

    const status = document.createElement('div');
    status.className = 'wt-roster-status';
    status.textContent = statusText(entry);
    row.appendChild(status);

    const btns = document.createElement('div');
    btns.className = 'wt-roster-actions';

    // Assign — disabled until Haven V5 provides an `assign` handler.
    const assign = document.createElement('button');
    assign.className = 'wt-roster-btn';
    assign.type = 'button';
    assign.textContent = 'Assign';
    if (actions.assign) {
      assign.addEventListener('click', () => actions.assign!(entry.id));
    } else {
      assign.disabled = true;
      assign.title = '(farm coming soon)';
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
