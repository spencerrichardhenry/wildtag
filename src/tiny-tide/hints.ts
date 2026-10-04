// First-time hints (spec §12.3, D30): each hint shows once per browser profile. The shown ids live in localStorage `tiny-tide-hints-v1` (a JSON
// string array), never in the run save. A read or write error means "not shown" and the game goes on. Hints use the toast, at most one every
// HINT_GAP seconds, and never replace another toast: a hint that cannot show yet waits in order.
import { BEHAVIOURS } from './bestiary';
import type { MoveKind } from './combat-types';

export const HINTS_KEY = 'tiny-tide-hints-v1';
export const HINT_GAP = 6;
export type HintId = `move-${MoveKind}` | 'telegraph' | 'telegraph-red' | `trait-${string}`;
/** The storage the hints use (localStorage in the game; a map in the tests). */
export interface HintStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** The move names in the hint text. On a phone the hint names the button ("Tap Dash") and the toast adds the move's slot icon after the name
 *  (T22 fix round 1: no text glyphs such as ✊ or ⛨, which a phone font may not have). */
const MOVE_NAMES: Readonly<Record<MoveKind, string>> = { dash: 'Dash', brace: 'Brace', counter: 'Counter', grab: 'Grab', sweep: 'Sweep' };
/** The first wind-up at the player (spec §12.3): this hint skips the HINT_GAP and may replace a non-critical toast (T22 fix round 1). */
export const PRIORITY_HINT: HintId = 'telegraph';
/** The move whose icon the toast shows after the move name: a move hint on a phone; null otherwise. */
export function hintIcon(id: HintId, touch: boolean): MoveKind | null {
  return touch && id.startsWith('move-') ? id.slice(5) as MoveKind : null;
}

/** The text of a hint (spec §12.3). `slot` is the 0-based slot of a move hint; `touch` picks the phone wording. */
export function hintText(id: HintId, o: { slot: number; touch: boolean }): string {
  if (id === 'telegraph') return 'Orange shapes show where an attack lands. Get out, Brace or Counter!';
  if (id === 'telegraph-red') return 'Red striped attacks can’t be blocked. Dash or swim out!';
  const kind = id.slice(5) as MoveKind, key = o.touch ? MOVE_NAMES[kind] : String(o.slot + 1);
  const press = o.touch ? `Tap ${key}` : `Press ${key}`, hold = `Hold ${key}`;
  switch (kind) {
    case 'dash': return `New move: Dash. ${press} to zip through attacks.`;
    case 'brace': return `New move: Brace. ${hold} to block in front of you.`;
    case 'counter': return `New move: Counter. ${press} just before a hit lands.`;
    case 'grab': return `New move: Grab. ${press} to hold a small creature.`;
    case 'sweep': return `New move: Sweep. ${press} to knock away what is behind you.`;
  }
}

/** Spec §11.8: the first-meeting hint of a species with a strength and a weakness (by behaviour id), or null. */
export function traitHint(behaviourId: string | undefined): { id: HintId; text: string } | null {
  const t = behaviourId ? BEHAVIOURS[behaviourId]?.traits : undefined;
  return t ? { id: `trait-${behaviourId}`, text: t.hint } : null;
}
/** The hints that may show in a fight: the telegraph hints and the trait hints (the move hints wait). */
export const fightHint = (id: HintId): boolean => id === 'telegraph' || id === 'telegraph-red' || id.startsWith('trait-');

export class Hints {
  /** Ids shown in this profile (read once; kept in memory when storage fails). */
  readonly shown: Set<string>;
  private readonly queue: { id: HintId; text: string }[] = [];
  private lastShownAt = -Infinity;
  constructor(private readonly storage: HintStorage | null) {
    let ids: unknown = [];
    try { ids = JSON.parse(storage?.getItem(HINTS_KEY) ?? '[]'); } catch { ids = []; }
    this.shown = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  }
  /** Asks for a hint: ignored when it was shown or is already waiting. The text is fixed at the first request. */
  request(id: HintId, text: string): void {
    if (this.shown.has(id) || this.queue.some(q => q.id === id)) return;
    this.queue.push({ id, text });
  }
  /** The next hint to show now, or null: the toast is free and HINT_GAP has passed since the last hint (game time). It is marked shown.
   *  `allow` (optional): only a waiting hint that it accepts can show now (the first in order); the others keep waiting.
   *  `replaceable`: the toast on screen (if any) is not critical. The PRIORITY_HINT then shows at once, with no gap. */
  next(now: number, toastFree: boolean, allow?: (id: HintId) => boolean, replaceable = false): { id: HintId; text: string } | null {
    const p = this.queue.findIndex(q => q.id === PRIORITY_HINT);
    if (p >= 0 && (toastFree || replaceable) && (!allow || allow(PRIORITY_HINT))) return this.mark(this.queue.splice(p, 1)[0]!, now);
    if (!toastFree || now - this.lastShownAt < HINT_GAP - 1e-9) return null;
    const i = allow ? this.queue.findIndex(q => allow(q.id)) : 0; if (i < 0) return null;
    const h = this.queue.splice(i, 1)[0]; if (!h) return null;
    return this.mark(h, now);
  }
  private mark(h: { id: HintId; text: string }, now: number): { id: HintId; text: string } {
    this.shown.add(h.id); this.lastShownAt = now;
    try { this.storage?.setItem(HINTS_KEY, JSON.stringify([...this.shown])); } catch { /* not saved: it may show again in a later session */ }
    return h;
  }
}

/** The help dialog's danger row (final review I5): the faint rule as state.ts applies it (a faint takes the DNA collected at this size and
 *  resets the growth bar; the body and parts stay) and the combat controls. Plain text; the caller adds the "!" markup. */
export function helpDangerText(touch: boolean): string {
  const controls = touch ? 'Tap Chomp to Bite; tap the slot buttons for your moves.' : 'Use a click or Space to Bite; right click and keys 1–4 for your moves.';
  return `marks a hunter. ${controls} Read the amber and red shapes: they show where an attack will land. You can also swim away or hide with stealth parts. `
    + 'If you lose every heart, you faint. You wake up at the start and lose the DNA you collected at this size. Your body and parts stay.';
}
