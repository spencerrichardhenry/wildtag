// tests/tiny-tide-core/hints.test.ts — spec §12.3: first-time hints show once per profile, at most one every 6 s, never over another toast.
import { describe, expect, it } from 'vitest';
import { HINTS_KEY, hintIcon, hintText, Hints, type HintStorage } from '../../src/tiny-tide/hints';

const memory = (init: Record<string, string> = {}): HintStorage & { data: Record<string, string> } => {
  const data = { ...init }; return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
describe('hints', () => {
  it('uses the slot key on desktop and the move name (plus its icon) on a phone', () => {
    expect(hintText('move-dash', { slot: 1, touch: false })).toBe('New move: Dash. Press 2 to zip through attacks.');
    expect(hintText('move-dash', { slot: 1, touch: true })).toBe('New move: Dash. Tap Dash to zip through attacks.');
    expect(hintText('move-brace', { slot: 0, touch: true })).toBe('New move: Brace. Hold Brace to block in front of you.');
    expect(hintText('move-grab', { slot: 3, touch: true })).toBe('New move: Grab. Tap Grab to hold a small creature.');
    expect(hintIcon('move-dash', true)).toBe('dash'); expect(hintIcon('move-dash', false)).toBeNull(); expect(hintIcon('telegraph', true)).toBeNull();
    for (const t of ['move-dash', 'move-brace', 'move-counter', 'move-grab', 'move-sweep'] as const) expect(hintText(t, { slot: 0, touch: true })).toMatch(/^[\x20-\x7e]+$/);   // no text glyphs (tofu risk)
    expect(hintText('move-brace', { slot: 0, touch: false })).toBe('New move: Brace. Hold 1 to block in front of you.');
    expect(hintText('move-counter', { slot: 2, touch: false })).toBe('New move: Counter. Press 3 just before a hit lands.');
    expect(hintText('move-grab', { slot: 3, touch: false })).toBe('New move: Grab. Press 4 to hold a small creature.');
    expect(hintText('move-sweep', { slot: 0, touch: false })).toBe('New move: Sweep. Press 1 to knock away what is behind you.');
    expect(hintText('telegraph', { slot: 0, touch: false })).toBe('Orange shapes show where an attack lands. Get out, Brace or Counter!');
  });
  it('shows a hint once, then never again in this profile', () => {
    const store = memory(), a = new Hints(store);
    a.request('telegraph', 'T'); expect(a.next(0, true)).toEqual({ id: 'telegraph', text: 'T' });
    a.request('telegraph', 'T'); expect(a.next(10, true)).toBeNull();
    expect(JSON.parse(store.data[HINTS_KEY]!)).toEqual(['telegraph']);
    const b = new Hints(store); b.request('telegraph', 'T'); expect(b.next(0, true)).toBeNull();
  });
  it('waits for a free toast and keeps 6 s between hints, in order', () => {
    const h = new Hints(memory());
    h.request('move-dash', 'D'); h.request('telegraph-red', 'R');   // (not the priority hint: see the next test)
    expect(h.next(0, false)).toBeNull();
    expect(h.next(1, true)?.id).toBe('move-dash');
    expect(h.next(6.9, true)).toBeNull();
    expect(h.next(7, true)?.id).toBe('telegraph-red');
  });
  it('in a fight only an allowed hint shows; the others keep their place', () => {
    const h = new Hints(memory());
    h.request('move-dash', 'D'); h.request('telegraph', 'T');
    expect(h.next(0, true, id => id === 'telegraph')?.id).toBe('telegraph');
    expect(h.next(6, true, id => id === 'telegraph')).toBeNull();
    expect(h.next(6, true)?.id).toBe('move-dash');
  });
  it('the first telegraph hint skips the 6 s gap and may replace a non-critical toast, not a critical one', () => {
    const h = new Hints(memory());
    h.request('move-dash', 'D'); expect(h.next(0, true)?.id).toBe('move-dash');
    h.request('telegraph', 'T'); h.request('telegraph-red', 'R');
    expect(h.next(1, false, undefined, false)).toBeNull();                 // a critical toast is up: it waits
    expect(h.next(1.5, false, undefined, true)?.id).toBe('telegraph');     // inside the gap, over a non-critical toast
    expect(h.next(2, true, undefined, true)).toBeNull();                   // the red hint keeps the gap
    expect(h.next(7.5, true)?.id).toBe('telegraph-red');
  });
  it('treats a storage error as not shown and goes on', () => {
    const broken: HintStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const h = new Hints(broken); h.request('telegraph', 'T');
    expect(h.next(0, true)?.id).toBe('telegraph');
    expect(new Hints(memory({ [HINTS_KEY]: 'not json' })).shown.size).toBe(0);
  });
});

// Final review I5: the help's danger row matches the faint rule (state.ts: a faint takes the DNA collected at this size) and names the combat
// controls instead of "Chomp back".
import { helpDangerText } from '../../src/tiny-tide/hints';
describe('help danger text (final review I5)', () => {
  it('states the faint rule and the combat controls', () => {
    for (const touch of [false, true]) {
      const t = helpDangerText(touch);
      expect(t).toContain('If you lose every heart, you faint. You wake up at the start and lose the DNA you collected at this size. Your body and parts stay.');
      expect(t).not.toContain('most of your DNA'); expect(t).not.toContain('Chomp back');
      expect(t).toContain('amber and red shapes');
    }
    expect(helpDangerText(false)).toContain('click or Space to Bite'); expect(helpDangerText(false)).toContain('1–4');
    expect(helpDangerText(true)).toContain('Chomp to Bite');
  });
});
