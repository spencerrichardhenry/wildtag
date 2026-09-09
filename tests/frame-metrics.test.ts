import { describe, expect, it } from 'vitest';
import { FrameMetrics } from '../src/core/frame-metrics.ts';

describe('frame timing', () => {
  it('uses total elapsed time for FPS and exposes long frames in p95', () => {
    const metrics = new FrameMetrics(20);
    for (let i = 0; i < 18; i++) metrics.record(10, 1, 2);
    metrics.record(50, 3, 4); metrics.record(70, 5, 6);
    expect(metrics.snapshot()).toEqual({ samples: 20, fps: 1000 / 15,
      frameMs: 15, p95Ms: 50, simulationMs: 1.3, renderMs: 2.3 });
  });
  it('ages out old stalls and resets after backgrounding', () => {
    const metrics = new FrameMetrics(3);
    metrics.record(1000, 100, 200);
    for (let i = 0; i < 3; i++) metrics.record(20, 2, 4);
    expect(metrics.snapshot().fps).toBe(50);
    expect(metrics.snapshot().p95Ms).toBe(20);
    metrics.reset();
    metrics.record(NaN, 0, 0); metrics.record(0, 0, 0);
    expect(metrics.snapshot().samples).toBe(0);
    expect(metrics.snapshot().fps).toBe(0);
  });
});
