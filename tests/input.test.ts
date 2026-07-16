import { describe, expect, it } from 'vitest';
import { EdgeLatch } from '../src/player/input.ts';

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
