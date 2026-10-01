import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { layout, locate, partFrame, surface } from '../../src/tiny-tide/body-geometry';
import { starterGenome } from '../../src/tiny-tide/genome';

describe('body geometry', () => {
  it('puts the front tip at t=0 facing forward and the rear tip at t=1 facing back', () => {
    const g = starterGenome(), l = layout(g);
    expect(surface(g, l, 0, 0).normal.z).toBe(1); expect(surface(g, l, 1, 0).normal.z).toBe(-1);
    expect(surface(g, l, 0, 0).position.z).toBeCloseTo(l.front);
  });
  it('locates a surface point back to its t and angle', () => {
    const g = starterGenome(), l = layout(g), back = locate(g, l, surface(g, l, .4, 1.1).position);
    expect(back.t).toBeCloseTo(.4, 2); expect(back.angle).toBeCloseTo(1.1, 1);
  });
  it('builds a right-handed part frame with +Y along the normal', () => {
    const q = partFrame(new T.Vector3(1, 0, 0)), y = new T.Vector3(0, 1, 0).applyQuaternion(q);
    expect(y.x).toBeCloseTo(1); expect(new T.Matrix4().makeRotationFromQuaternion(q).determinant()).toBeCloseTo(1);
  });
});
