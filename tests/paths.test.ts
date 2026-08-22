import { describe, expect, it } from 'vitest';
import { PATHS } from '../src/core/constants.ts';
import { pathMask, pathSegments } from '../src/world/paths.ts';
import { scatterForChunk } from '../src/world/scatter.ts';

// ---------------------------------------------------------------------------
// Dirt-path network (Fidelity-3). Pure position → mask math: the terrain
// colour pipeline lerps toward the path tan where mask > 0 and the scatter
// pass suppresses props on the corridor. heightAt is untouched — paths follow
// the terrain, so no movement/physics behaviour changes.
// ---------------------------------------------------------------------------

describe('paths — mask math', () => {
  it('route endpoints anchor exactly on the polyline (wobble tapers to 0)', () => {
    for (const route of PATHS.routes) {
      const [sx, sz] = route[0]!;
      const [ex, ez] = route[route.length - 1]!;
      expect(pathMask(sx, sz), `start of route at (${sx},${sz})`).toBe(1);
      expect(pathMask(ex, ez), `end of route at (${ex},${ez})`).toBe(1);
    }
  });

  it('is 1 on every tessellated segment midpoint (core width covers the line)', () => {
    for (const seg of pathSegments()) {
      const mx = (seg.ax + seg.bx) / 2;
      const mz = (seg.az + seg.bz) / 2;
      expect(pathMask(mx, mz)).toBe(1);
    }
  });

  it('fades monotonically to 0 moving perpendicular off a mid-route segment', () => {
    // A segment near junctions (spawn radiates three routes) never escapes a
    // SIBLING corridor within the sweep, so probe mid-route: the segment whose
    // midpoint is closest to the village→forest route's (120, -280) waypoint.
    let seg = pathSegments()[0]!;
    let bestD = Infinity;
    for (const s of pathSegments()) {
      const d = Math.hypot((s.ax + s.bx) / 2 - 120, (s.az + s.bz) / 2 + 280);
      if (d < bestD) {
        bestD = d;
        seg = s;
      }
    }
    const mx = (seg.ax + seg.bx) / 2;
    const mz = (seg.az + seg.bz) / 2;
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const len = Math.hypot(dx, dz);
    // Try both perpendicular directions; at least one must fade monotonically
    // to zero (the other may graze the corridor's own gentle curve).
    const fadesOut = (px: number, pz: number): boolean => {
      let prev = Infinity;
      let sawZero = false;
      for (let d = 0; d <= PATHS.coreWidth + PATHS.fadeWidth + 3; d += 0.5) {
        const m = pathMask(mx + px * d, mz + pz * d);
        if (m > prev + 1e-9) return false;
        prev = m;
        if (m === 0) sawZero = true;
      }
      return sawZero;
    };
    expect(fadesOut(-dz / len, dx / len) || fadesOut(dz / len, -dx / len)).toBe(true);
  });

  it('is 0 far from any route', () => {
    expect(pathMask(700, 700)).toBe(0);
    expect(pathMask(-700, 500)).toBe(0);
    expect(pathMask(0, -700)).toBe(0);
  });

  it('is deterministic', () => {
    const a = pathMask(20, -50);
    const b = pathMask(20, -50);
    expect(a).toBe(b);
    expect(pathSegments().length).toBe(pathSegments().length);
  });

  it('mask is in [0, 1] everywhere sampled along a coarse world sweep', () => {
    for (let x = -400; x <= 400; x += 37) {
      for (let z = -400; z <= 400; z += 37) {
        const m = pathMask(x, z);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('paths — scatter suppression', () => {
  it('no scatter placement sits on a path corridor (chunks the spawn→village route crosses)', () => {
    // Chunks around the spawn→village leg: chunk size 64 → (0,0), (0,-1), (0,-2).
    for (const [cx, cz] of [
      [0, 0],
      [0, -1],
      [0, -2],
    ] as const) {
      for (const p of scatterForChunk(cx, cz)) {
        expect(
          pathMask(p.x, p.z),
          `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) in chunk ${cx},${cz}`,
        ).toBeLessThan(PATHS.scatterMaskThreshold);
      }
    }
  });
});
