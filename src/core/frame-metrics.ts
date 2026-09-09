export interface FrameSample {
  frameMs: number;
  simulationMs: number;
  renderMs: number;
}

/** A bounded rolling window. Frame time is wall time; CPU timings exclude GPU work. */
export class FrameMetrics {
  private readonly samples: FrameSample[] = [];
  private cursor = 0;

  constructor(private readonly capacity = 120) {}

  record(frameMs: number, simulationMs: number, renderMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    const sample = this.samples[this.cursor];
    if (sample) Object.assign(sample, { frameMs, simulationMs, renderMs });
    else this.samples.push({ frameMs, simulationMs, renderMs });
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  reset(): void { this.samples.length = 0; this.cursor = 0; }

  snapshot() {
    const count = this.samples.length;
    const avg = (key: keyof FrameSample) => count
      ? this.samples.reduce((sum, s) => sum + s[key], 0) / count : 0;
    const sorted = this.samples.map(s => s.frameMs).sort((a, b) => a - b);
    const frameMs = avg('frameMs');
    return {
      samples: count,
      fps: frameMs ? 1000 / frameMs : 0,
      frameMs,
      p95Ms: sorted[Math.max(0, Math.ceil(count * .95) - 1)] ?? 0,
      simulationMs: avg('simulationMs'),
      renderMs: avg('renderMs'),
    };
  }
}
