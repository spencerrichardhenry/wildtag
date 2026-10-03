import { describe, expect, it } from 'vitest';
import { aimChevron, aimPitch, basicRequested, pitched, pointerAim, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';

const src = (over: Partial<InputSources> = {}): InputSources => ({ stickX: 0, stickZ: 0, keys: new Set(), chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false, ...over });
const read = (s: InputSources, prev = RELEASED, breach = false) => readIntent(s, prev, { breachOnRiseTap: breach });
describe('input intents', () => {
  it('maps keys and stick to a clamped move', () => { expect(Math.hypot(read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.x, read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.z)).toBeCloseTo(1); });
  it('gives one press for a held or repeating Space, and keeps the hold', () => {
    const a = read(src({ keys: new Set(['Space']) })), b = read(src({ keys: new Set(['Space']) }), a);
    expect(a.basicPressed).toBe(true); expect(b.basicPressed).toBe(false); expect(b.basicHeld).toBe(true); expect(basicRequested(b)).toBe(true);
    expect(read(src({ chompTapped: true }), b).basicPressed).toBe(true);
  });
  it('keeps a same-tick basic press next to an active press (T7 carry: the combat world suppresses it only when the slot move is accepted)', () => {
    const a = read(src({ keys: new Set(['Space']), activeTapped: [true, false, false, false], activeHeld: [true, false, false, false] }));
    expect(a.basicPressed).toBe(true); expect(a.basicHeld).toBe(true); expect(a.activePressed).toEqual([true, false, false, false]);
    expect(basicRequested(a)).toBe(true); expect(basicRequested(a, true)).toBe(false);   // suppressed only when a slot move was accepted this tick
    const b = read(src({ keys: new Set(['Space']), activeHeld: [true, false, false, false] }), a); expect(basicRequested(b, false)).toBe(true);   // next tick: the hold resumes
  });
  it('reports releases, but never a release after a cancel', () => {
    const held = read(src({ activeHeld: [false, true, false, false] }));
    expect(read(src(), held).activeReleased).toEqual([false, true, false, false]);
    expect(read(src({ activeCanceled: [false, true, false, false] }), held).activeReleased).toEqual([false, false, false, false]);
    expect(held.activePressed).toEqual([false, true, false, false]); expect(read(src(), held).activePressed).toEqual([false, false, false, false]);
  });
  it('maps traversal: breach on a rise tap only when the plan can breach', () => {
    expect(read(src({ keys: new Set(['KeyE']), riseHeld: true })).traversal).toBe('rise'); expect(read(src({ diveHeld: true })).traversal).toBe('dive');
    expect(read(src({ riseHeld: true, diveHeld: true })).traversal).toBe('none');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, true).traversal).toBe('breach');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, false).traversal).toBe('rise');
  });
  it('has an all-released intent', () => { expect(RELEASED).toMatchObject({ basicHeld: false, basicPressed: false, traversal: 'none', move: { x: 0, y: 0, z: 0 }, aim: null, aimSource: 'none', activeHeld: [false, false, false, false] }); });
  it('four slot tuples', () => {
    // Keys 1–4 hold slots 1–4; a tap and a hold give one press; the aim keeps its source.
    const a = read(src({ keys: new Set(['Digit3']), activeTapped: [false, false, false, true], aim: { x: 0, y: 0, z: 1 }, aimSource: 'pointer' }));
    expect(a.activePressed).toEqual([false, false, true, true]); expect(a.activeHeld).toEqual([false, false, true, false]); expect(a.aimSource).toBe('pointer');
    const b = read(src({ keys: new Set(['Digit3']) }), a);
    expect(b.activePressed).toEqual([false, false, false, false]); expect(b.activeHeld).toEqual([false, false, true, false]); expect(b.aimSource).toBe('none');   // no aim: none
    expect(read(src(), b).activeReleased).toEqual([false, false, true, false]);
  });
  it('slot press suppresses basic for one tick only when the slot move is accepted', () => {
    const a = read(src({ chompTapped: true, activeTapped: [false, true, false, false] }));
    expect(a.basicPressed).toBe(true); expect(basicRequested(a, true)).toBe(false); expect(basicRequested(a, false)).toBe(true);
    expect(basicRequested(read(src({ chompHeld: true }), a), false)).toBe(true);
  });
  it('cancel gives no release', () => {
    const held = read(src({ activeHeld: [true, false, false, false] })), canceled = read(src({ activeCanceled: [true, false, false, false] }), held);
    expect(canceled.activeReleased).toEqual([false, false, false, false]); expect(canceled.activeCanceled).toEqual([true, false, false, false]); expect(canceled.activeHeld).toEqual([false, false, false, false]);
  });
});
describe('aim', () => {
  it('meets the plane through the creature, or gives none', () => {
    const o = { x: 0, y: 5, z: 0 };
    const a = pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 3 / Math.hypot(3, 5, 10), y: -5 / Math.hypot(3, 5, 10), z: 10 / Math.hypot(3, 5, 10) });   // hits (3, 5, 0)
    expect(a!.x).toBeCloseTo(1); expect(a!.z).toBeCloseTo(0);
    expect(pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 0, y: 1, z: 0 })).toBeNull();   // up: no meet in front
    expect(pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 1, y: 0, z: 0 })).toBeNull();   // parallel
  });
  it('soft-locks the pitch within 30° of yaw, else keeps the creature pitch', () => {
    const o = { x: 0, y: 0, z: 0 }, fwd = { x: 0, y: 0, z: 1 };
    expect(aimPitch(o, fwd, [{ x: 0, y: 1, z: 1 }], .2, 1.2)).toBeCloseTo(Math.PI / 4);
    expect(aimPitch(o, fwd, [{ x: 1, y: 1, z: 1 }], .2, 1.2)).toBeCloseTo(.2);   // 45° off: not locked
    expect(aimPitch(o, fwd, [{ x: 0, y: 10, z: 1 }], 0, 1.2)).toBeCloseTo(1.2);   // clamped
    expect(pitched(fwd, Math.PI / 6)).toEqual({ x: 0, y: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) });
  });
  it('places the aim chevron 1 L along the aim while a combat species is within 4 L (spec §8.4)', () => {
    const o = { x: 0, y: 1, z: 0 }, aim = { x: 0, y: 0, z: 1 };
    expect(aimChevron(o, aim, 2, [{ x: 0, y: 1, z: 7.9 }])).toEqual({ x: 0, y: 1, z: 2 });
    expect(aimChevron(o, aim, 2, [{ x: 0, y: 1, z: 8.1 }])).toBeNull();   // beyond 4 L
    expect(aimChevron(o, aim, 2, [])).toBeNull();
    const p = aimChevron(o, { x: 3, y: 0, z: 4 }, 1, [{ x: 1, y: 1, z: 1 }])!;   // a non-unit aim is normalised
    expect(p.x).toBeCloseTo(.6); expect(p.z).toBeCloseTo(.8);
  });
});
