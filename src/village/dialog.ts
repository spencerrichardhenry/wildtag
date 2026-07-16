import type { ScreenDef, ScreenManager } from '../ui/screens.ts';
import type { NpcDef } from './npcs.ts';

// ---------------------------------------------------------------------------
// Dialog screen ('dialog') — a DOM overlay via ScreenManager, opened with F near
// an NPC (main.ts gives a village NPC priority over harvest within 3m). Shows
// the NPC's name, a rotating flavour line, and a request area. Task V3 ships a
// placeholder request + a disabled Fulfill button; Task V4 plugs the real barter
// request in via `setRequestRenderer(fn)` — no rewrite of this screen needed.
// ---------------------------------------------------------------------------

const FLAVOR: Record<string, string[]> = {
  fenn: [
    'Welcome to Haven. Small place, big heart — mind the puffles.',
    'Every critter you bring home makes this village a little warmer.',
    'A mayor is really just the person who waters the plaza flowers.',
  ],
  odd: [
    'These plots won’t tend themselves. Well — some of them nearly do.',
    'A bellowbuck earns its keep. Eats twice its keep too, mind you.',
    'Rain or shine, Farmer Odd is out here. Mostly shine, thankfully.',
  ],
  juno: [
    'No coin in Haven — we trade in critters and good faith.',
    'Bring me the right beast and I’ll make it worth your while.',
    'Everything has a price. Ours just happens to have legs.',
  ],
  bram: [
    'In my day we tracked critters uphill both ways, y’know.',
    'Sit a spell. The wild keeps; it always has.',
    'This old cane’s seen more of the island than most feet ever will.',
  ],
  kit: [
    'Didja SEE the lumenstag?! It GLOWS! I wanna bond one so bad.',
    'When I grow up I’m gonna ride a Prismhorse. Sixteen legs!',
    'Tag you’re it! ...oh. You’re busy. That’s okay.',
  ],
};

const PLACEHOLDER = '…has no request yet (coming with the barter system)';

/** Task V4 replaces the placeholder request block; see setRequestRenderer. */
export type RequestRenderer = (npc: NpcDef, container: HTMLElement) => void;

let requestRenderer: RequestRenderer | null = null;
let currentNpc: NpcDef | null = null;
const flavorIndex = new Map<string, number>();

/** V4 hook: supply the real barter-request renderer for the request area. */
export function setRequestRenderer(fn: RequestRenderer | null): void {
  requestRenderer = fn;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-dialog-panel { width: min(560px, 92vw); }
    .wt-dialog-flavor {
      font-size: 15px; line-height: 1.5; color: #f2ecd8;
      margin: 8px 0 18px; font-style: italic;
    }
    .wt-dialog-req {
      border: 1px solid rgba(200, 220, 230, 0.15); border-radius: 8px;
      background: rgba(255, 255, 255, 0.03); padding: 12px 14px; margin-bottom: 16px;
    }
    .wt-dialog-req-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
      color: #c9b98a; margin-bottom: 6px;
    }
    .wt-dialog-req-body { font-size: 13px; color: #cfc6ad; }
    .wt-dialog-actions { display: flex; gap: 10px; justify-content: flex-end; }
  `;
  document.head.appendChild(style);
}

/**
 * Build the dialog ScreenDef. Open it with `openDialog(screens, npc)` — that sets
 * the target NPC and rotates the flavour line, then opens the screen.
 */
export function createDialogScreen(manager: ScreenManager): ScreenDef {
  return {
    id: 'dialog',
    render(root: HTMLElement) {
      injectStyles();
      const npc = currentNpc;
      const panel = document.createElement('div');
      panel.className = 'wt-panel wt-dialog-panel';
      panel.addEventListener('click', (e) => e.stopPropagation());

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wt-close';
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close (Esc)';
      closeBtn.addEventListener('click', () => manager.close());
      panel.appendChild(closeBtn);

      const h1 = document.createElement('h1');
      h1.textContent = npc ? npc.name : 'Villager';
      panel.appendChild(h1);

      const flavor = document.createElement('p');
      flavor.className = 'wt-dialog-flavor';
      if (npc) {
        const lines = FLAVOR[npc.id] ?? ['...'];
        const idx = flavorIndex.get(npc.id) ?? 0;
        flavor.textContent = `“${lines[idx % lines.length]}”`;
      }
      panel.appendChild(flavor);

      const req = document.createElement('div');
      req.className = 'wt-dialog-req';
      const reqLabel = document.createElement('div');
      reqLabel.className = 'wt-dialog-req-label';
      reqLabel.textContent = 'Request';
      req.appendChild(reqLabel);

      if (npc && requestRenderer) {
        // Task V4: real barter request (may append its own Fulfill button).
        requestRenderer(npc, req);
      } else {
        const body = document.createElement('div');
        body.className = 'wt-dialog-req-body';
        body.textContent = `${npc ? npc.name : 'They'} ${PLACEHOLDER}`;
        req.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'wt-dialog-actions';
        const fulfill = document.createElement('button');
        fulfill.className = 'wt-craft-btn';
        fulfill.type = 'button';
        fulfill.textContent = 'Fulfill';
        fulfill.disabled = true;
        actions.appendChild(fulfill);
        req.appendChild(actions);
      }
      panel.appendChild(req);

      root.appendChild(panel);
    },
  };
}

/** Set the dialog's target NPC (rotating its flavour line) and open the screen. */
export function openDialog(manager: ScreenManager, npc: NpcDef): void {
  currentNpc = npc;
  flavorIndex.set(npc.id, (flavorIndex.get(npc.id) ?? -1) + 1);
  manager.open('dialog');
}
