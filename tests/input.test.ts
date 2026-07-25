import { describe, expect, it } from 'vitest';
import { EdgeLatch, actionForCode } from '../src/player/input.ts';

// EdgeLatch is the DOM-free one-shot movement-edge core of Input: keydown
// latches, state() consumes, ScreenManager clears on screen open/close so a
// press made around a crafting-screen session never fires a stale edge.

describe('EdgeLatch', () => {
  it('latches an edge until consumed, then clears (one edge per press)', () => {
    const latch = new EdgeLatch();
    latch.latch('dash');
    expect(latch.consume()).toEqual({ jump: false, dash: true, rocket: false });
    // A second consume with no new press yields no edges.
    expect(latch.consume()).toEqual({ jump: false, dash: false, rocket: false });
  });

  it('tracks the three edges independently', () => {
    const latch = new EdgeLatch();
    latch.latch('jump');
    latch.latch('rocket');
    expect(latch.consume()).toEqual({ jump: true, dash: false, rocket: true });
  });

  it('clear() drops pending edges without firing them (screen-open regression)', () => {
    // Scenario: player presses Q just before opening the crafting screen.
    // While the screen is open state() is never read, so without clear() the
    // dash would stay latched and fire on the first sim step after close.
    const latch = new EdgeLatch();
    latch.latch('dash'); // press just before opening
    latch.clear(); // ScreenManager.open()

    latch.latch('jump'); // keydown listeners stay live while the screen is open
    latch.clear(); // ScreenManager.close()

    // First sim step after closing: nothing stale fires.
    expect(latch.consume()).toEqual({ jump: false, dash: false, rocket: false });
  });

  it('edges latched after a clear() still fire normally', () => {
    const latch = new EdgeLatch();
    latch.clear();
    latch.latch('rocket');
    expect(latch.consume()).toEqual({ jump: false, dash: false, rocket: true });
  });
});

// actionForCode is the DOM-free key-code → UI-action mapping extracted from
// Input's onKeyDown (same spirit as EdgeLatch — Input itself needs a real
// canvas/document and isn't unit-testable in this suite's node environment).

describe('actionForCode', () => {
  it('maps Digit1-4 to their hotbar slots', () => {
    expect(actionForCode('Digit1')).toEqual({ type: 'hotbar', slot: 1 });
    expect(actionForCode('Digit2')).toEqual({ type: 'hotbar', slot: 2 });
    expect(actionForCode('Digit3')).toEqual({ type: 'hotbar', slot: 3 });
    expect(actionForCode('Digit4')).toEqual({ type: 'hotbar', slot: 4 });
  });

  it('maps Digit5 to hotbar slot 5 (Cursed Castle Task 13 — Purify)', () => {
    expect(actionForCode('Digit5')).toEqual({ type: 'hotbar', slot: 5 });
  });

  it('maps the remaining UI keys', () => {
    expect(actionForCode('KeyF')).toEqual({ type: 'interact' });
    expect(actionForCode('Tab')).toEqual({ type: 'tab' });
    expect(actionForCode('KeyC')).toEqual({ type: 'toggleC' });
    expect(actionForCode('KeyB')).toEqual({ type: 'roster' });
    expect(actionForCode('KeyV')).toEqual({ type: 'mount' });
    expect(actionForCode('Escape')).toEqual({ type: 'escape' });
  });

  it('returns null for unmapped codes (movement keys, modifiers)', () => {
    expect(actionForCode('KeyW')).toBeNull();
    expect(actionForCode('ShiftLeft')).toBeNull();
    expect(actionForCode('Space')).toBeNull();
  });
});
