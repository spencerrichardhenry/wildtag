// tests/tiny-tide-core/combat-hud.test.ts — T9: the slot views (label and cooldown fraction on the action clock) and the ring step that
// decides when a slot button is redrawn (a cooldown that is almost over must still differ from a ready slot).
import { describe, expect, it } from 'vitest';
import { edgeArrowAt, floaterText, ringStep, slotViews } from '../../src/tiny-tide/combat-hud';
import { playerMoves } from '../../src/tiny-tide/sim';
import { speck } from './combat-fixture-world';

describe('the slot HUD', () => {
  it('shows the slot moves and their cooldown left as a fraction of the action clock', () => {
    const s = speck(), m = playerMoves(s), dash = m.set.byKind.dash!;
    expect(slotViews(m.slots, m.set, s.rt).map(v => v.kind)).toEqual(['dash', null, null, null]);
    expect(slotViews(m.slots, m.set, s.rt)[0]).toMatchObject({ label: dash.resolved.label, cooldown: 0 });
    s.rt.cooldowns.set(`player:${dash.partUid}:${dash.grantId}`, s.rt.actionClock + dash.resolved.cooldownSeconds / 2);
    expect(slotViews(m.slots, m.set, s.rt)[0]!.cooldown).toBeCloseTo(.5);
  });
  it('a cooldown that is almost over is a different ring step from a ready slot', () => {
    expect(ringStep(0)).toBe(0); expect(ringStep(.001)).toBeGreaterThan(0); expect(ringStep(1)).toBe(40);
  });
});

describe('combat floaters and edge arrows (T12)', () => {
  it('a number only for damage above 0; a word for a block, counter, dodge or immunity; nothing for a 0-damage hit (T8 carry)', () => {
    expect(floaterText('hit', 'hp', 4)).toBe('−4'); expect(floaterText('hit', 'half-heart', 3)).toBe('−1½ ♥');
    expect(floaterText('hit', 'hp', 0)).toBeNull(); expect(floaterText('hit', 'half-heart', 0)).toBeNull(); expect(floaterText('grabbed', 'half-heart', 0)).toBeNull();
    expect(floaterText('blocked', 'half-heart', 0)).toBe('BLOCK'); expect(floaterText('countered', 'hp', 0)).toBe('COUNTER!');
    expect(floaterText('evaded', 'half-heart', 0)).toBe('DODGE'); expect(floaterText('immune', 'hp', 0)).toBe('IMMUNE');
    expect(floaterText('guard-broken', 'half-heart', 2)).toBe('−1 ♥'); expect(floaterText('guard-broken', 'half-heart', 0)).toBeNull();
  });
  it('an edge arrow sits inside the screen edge toward the point; a point behind the camera is mirrored', () => {
    const right = edgeArrowAt({ x: 2000, y: 300, visible: true }, 800, 600);
    expect(right.angle).toBeCloseTo(0); expect(right.x).toBeCloseTo(800 - 36); expect(right.y).toBeCloseTo(300);
    const behind = edgeArrowAt({ x: 2000, y: 300, visible: false }, 800, 600);
    expect(Math.abs(behind.angle)).toBeCloseTo(Math.PI); expect(behind.x).toBeCloseTo(36);
  });
});
