import { describe, expect, it } from 'vitest';
import { basicRequested, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';

const src = (over: Partial<InputSources> = {}): InputSources => ({ stickX: 0, stickZ: 0, keys: new Set(), chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false, ...over });
const read = (s: InputSources, prev = RELEASED, breach = false) => readIntent(s, prev, { breachOnRiseTap: breach });
describe('input intents', () => {
  it('maps keys and stick to a clamped move', () => { expect(Math.hypot(read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.x, read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.z)).toBeCloseTo(1); });
  it('gives one press for a held or repeating Space, and keeps the hold', () => {
    const a = read(src({ keys: new Set(['Space']) })), b = read(src({ keys: new Set(['Space']) }), a);
    expect(a.basicPressed).toBe(true); expect(b.basicPressed).toBe(false); expect(b.basicHeld).toBe(true); expect(basicRequested(b)).toBe(true);
    expect(read(src({ chompTapped: true }), b).basicPressed).toBe(true);
  });
  it('lets an active press suppress the basic press for that tick only', () => {
    const a = read(src({ keys: new Set(['Space']), activeTapped: [true, false], activeHeld: [true, false] }));
    expect(a.basicPressed).toBe(false); expect(a.basicHeld).toBe(true); expect(a.activePressed).toEqual([true, false]); expect(basicRequested(a)).toBe(false);
    const b = read(src({ keys: new Set(['Space']), activeHeld: [true, false] }), a); expect(basicRequested(b)).toBe(true);   // next tick: the hold resumes
  });
  it('reports releases, but never a release after a cancel', () => {
    const held = read(src({ activeHeld: [false, true] }));
    expect(read(src(), held).activeReleased).toEqual([false, true]);
    expect(read(src({ activeCanceled: [false, true] }), held).activeReleased).toEqual([false, false]);
    expect(held.activePressed).toEqual([false, true]); expect(read(src(), held).activePressed).toEqual([false, false]);
  });
  it('maps traversal: breach on a rise tap only when the plan can breach', () => {
    expect(read(src({ keys: new Set(['KeyE']), riseHeld: true })).traversal).toBe('rise'); expect(read(src({ diveHeld: true })).traversal).toBe('dive');
    expect(read(src({ riseHeld: true, diveHeld: true })).traversal).toBe('none');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, true).traversal).toBe('breach');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, false).traversal).toBe('rise');
  });
  it('has an all-released intent', () => { expect(RELEASED).toMatchObject({ basicHeld: false, basicPressed: false, traversal: 'none', move: { x: 0, y: 0, z: 0 }, aim: null }); });
});
