// tests/tiny-tide-core/combat-hud.test.ts — T9: the slot views (label and cooldown fraction on the action clock) and the ring step that
// decides when a slot button is redrawn (a cooldown that is almost over must still differ from a ready slot).
import { describe, expect, it } from 'vitest';
import { ringStep, slotViews } from '../../src/tiny-tide/combat-hud';
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
