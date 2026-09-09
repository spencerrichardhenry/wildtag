import type { WebGLRenderer } from 'three';
import { FrameMetrics } from '../core/frame-metrics.ts';
import { GpuTimer } from '../core/gpu-timer.ts';
import { currentQuality } from '../core/quality.ts';

/** Dev-only, pointer-transparent and updated four times a second. */
export function createPerformanceHUD(renderer: WebGLRenderer) {
  const metrics = new FrameMetrics();
  const gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  const element = document.createElement('output');
  element.id = 'dev-performance';
  element.setAttribute('aria-label', 'Game performance');
  element.style.cssText = 'position:fixed;right:12px;top:64px;z-index:90;pointer-events:none;white-space:pre;padding:10px 12px;border:1px solid #82c6ae66;border-radius:8px;background:#10231fe8;color:#c5f8dc;font:12px/1.55 ui-monospace,monospace;font-variant-numeric:tabular-nums;box-shadow:0 2px 12px #0004';
  element.textContent = 'Measuring FPS…';
  document.body.append(element);
  let nextPaint = 0;
  return {
    metrics,
    gpu,
    update(now: number, frameMs: number, simulationMs: number, renderMs: number): void {
      metrics.record(frameMs, simulationMs, renderMs);
      if (now < nextPaint) return;
      nextPaint = now + 250;
      const s = metrics.snapshot();
      const r = renderer.info.render;
      element.textContent = `${s.fps.toFixed(0)} FPS  ·  ${s.frameMs.toFixed(1)} ms/frame\n`
        + `p95 ${s.p95Ms.toFixed(1)} ms  ·  ${currentQuality()} · ${renderer.getPixelRatio().toFixed(2)}×\n`
        + `CPU sim ${s.simulationMs.toFixed(1)} / render ${s.renderMs.toFixed(1)} ms\n`
        + `GPU ${gpu.milliseconds === null ? 'unavailable' : gpu.milliseconds.toFixed(1) + ' ms'}\n`
        + `${r.calls} draws  ·  ${(r.triangles / 1e6).toFixed(2)}M triangles`;
    },
  };
}
