// First-time hints (spec §12.3, D30): each hint shows once per browser profile. The shown ids live in localStorage `tiny-tide-hints-v1` (a JSON
// string array), never in the run save. A read or write error means "not shown" and the game goes on. Hints use the toast, at most one every
// HINT_GAP seconds, and never replace another toast: a hint that cannot show yet waits in order.
import type { MoveKind } from './combat-types';

export const HINTS_KEY = 'tiny-tide-hints-v1';
export const HINT_GAP = 6;
export type HintId = `move-${MoveKind}` | 'telegraph' | 'telegraph-red';
/** The storage the hints use (localStorage in the game; a map in the tests). */
export interface HintStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** The phone glyph of each move kind (spec §12.3 names Dash ⟫; the others are a T22 decision). The toast is plain text. */
export const HINT_GLYPHS: Readonly<Record<MoveKind, string>> = { dash: '⟫', brace: '⛨', counter: '✷', grab: '✊', sweep: '↺' };

/** The text of a hint (spec §12.3). `slot` is the 0-based slot of a move hint; `touch` picks the phone wording. */
export function hintText(id: HintId, o: { slot: number; touch: boolean }): string {
  if (id === 'telegraph') return 'Orange shapes show where an attack lands. Get out, Brace or Counter!';
  if (id === 'telegraph-red') return 'Red striped attacks can’t be blocked. Dash or swim out!';
  const kind = id.slice(5) as MoveKind, key = o.touch ? HINT_GLYPHS[kind] : String(o.slot + 1);
  const press = o.touch ? `Tap ${key}` : `Press ${key}`, hold = `Hold ${key}`;
  switch (kind) {
    case 'dash': return `New move: Dash. ${press} to zip through attacks.`;
    case 'brace': return `New move: Brace. ${hold} to block in front of you.`;
    case 'counter': return `New move: Counter. ${press} just before a hit lands.`;
    case 'grab': return `New move: Grab. ${press} to hold a small creature.`;
    case 'sweep': return `New move: Sweep. ${press} to knock away what is behind you.`;
  }
}

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
   *  `allow` (optional): only a waiting hint that it accepts can show now (the first in order); the others keep waiting. */
  next(now: number, toastFree: boolean, allow?: (id: HintId) => boolean): { id: HintId; text: string } | null {
    if (!toastFree || now - this.lastShownAt < HINT_GAP - 1e-9) return null;
    const i = allow ? this.queue.findIndex(q => allow(q.id)) : 0; if (i < 0) return null;
    const h = this.queue.splice(i, 1)[0]; if (!h) return null;
    this.shown.add(h.id); this.lastShownAt = now;
    try { this.storage?.setItem(HINTS_KEY, JSON.stringify([...this.shown])); } catch { /* not saved: it may show again in a later session */ }
    return h;
  }
}
