// The combat HUD (spec §8, §9.2–§9.3): the four slot buttons with their move icons, key labels and cooldown rings. DOM only.
import './controls.css';
import type { CombatRuntime, MoveKind } from './combat-types';
import { PLAYER_ID } from './combat-world';
import type { MoveSet, SlotAssignment } from './moves';

const svg = (body: string) => `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Inline move icons (spec §11.7: art debt none). */
export const MOVE_ICONS: Readonly<Record<MoveKind, string>> = {
  brace: svg('<path d="M20 5 33 11v9c0 8-6 13-13 15C13 33 7 28 7 20v-9Z"/>'),
  counter: svg('<path d="M20 4v8M20 28v8M4 20h8M28 20h8M9 9l6 6M25 25l6 6M31 9l-6 6M9 31l6-6"/><circle cx="20" cy="20" r="4"/>'),
  dash: svg('<path d="M6 14h18M10 20h22M6 26h18M26 12l8 8-8 8"/>'),
  grab: svg('<path d="M10 30c-4-8 0-18 9-20l4 7-6 3 2 4 7-3 4 7c-5 6-15 8-20 2Z"/>'),
  sweep: svg('<path d="M8 28c4-14 18-18 26-10M34 18l-1-8M34 18l-8 1"/>'),
};
/** What a slot button shows: the move, its name and the cooldown left as a fraction (0 = ready). */
export interface SlotView { kind: MoveKind | null; label: string; cooldown: number }
/** The slot views of the assignment: the representative move's label and its cooldown on the player's action clock (the key is the one
 *  CombatWorld.tryStart writes). */
export function slotViews(slots: SlotAssignment, moves: MoveSet, rt: CombatRuntime): SlotView[] {
  return slots.slots.map(kind => {
    const m = kind ? moves.byKind[kind] : undefined;
    if (!kind || !m) return { kind: null, label: '', cooldown: 0 };
    const ready = rt.cooldowns.get(`${PLAYER_ID}:${m.partUid}:${m.grantId}`) ?? 0, total = m.resolved.cooldownSeconds;
    return { kind, label: m.resolved.label, cooldown: total > 0 ? Math.max(0, Math.min(1, (ready - rt.actionClock) / total)) : 0 };
  });
}
/** The ring is redrawn in RING_STEPS steps. A cooldown above 0 is at least step 1, so the last sliver of a cooldown never looks like a ready
 *  slot to `sync` (the button would keep its cooldown look). */
export const RING_STEPS = 40;
export const ringStep = (cooldown: number): number => cooldown > 0 ? Math.max(1, Math.round(cooldown * RING_STEPS)) : 0;
export class CombatHud {
  readonly buttons: HTMLButtonElement[] = [];
  private shown: string[] = ['', '', '', ''];
  constructor(host: HTMLElement) {
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.id = `slot-${i + 1}`; b.className = 'slot-button'; b.hidden = true;
      b.innerHTML = `<i class="slot-ring"></i><span class="slot-icon"></span><b class="slot-name"></b><kbd>${i + 1}</kbd>`;
      host.append(b); this.buttons.push(b);
    }
  }
  /** Writes only what changed: an empty slot is hidden; the ring is a conic gradient of the cooldown left. */
  sync(views: readonly SlotView[]): void {
    views.forEach((v, i) => {
      const b = this.buttons[i]!, key = `${v.kind}:${v.label}:${ringStep(v.cooldown)}`;
      if (this.shown[i] === key) return;
      this.shown[i] = key; b.hidden = v.kind === null;
      if (!v.kind) return;
      b.querySelector('.slot-icon')!.innerHTML = MOVE_ICONS[v.kind]; b.querySelector('.slot-name')!.textContent = v.label.toUpperCase();
      b.setAttribute('aria-label', `${v.label} (slot ${i + 1})`); b.dataset.kind = v.kind;
      (b.querySelector('.slot-ring') as HTMLElement).style.background = v.cooldown > 0 ? `conic-gradient(#0e2f3acc ${v.cooldown * 360}deg, transparent 0)` : 'none';
      b.classList.toggle('cooldown', v.cooldown > 0);
    });
  }
}
