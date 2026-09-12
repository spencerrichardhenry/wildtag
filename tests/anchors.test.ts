import { describe, expect, it } from 'vitest';
import { AnchorRegistry } from '../src/structures/anchors.ts';

describe('drone grapple intersections', () => {
  it('ignores a sphere wholly behind the hook, even when its infinite ray intersects', () => {
    const anchors = new AnchorRegistry();
    anchors.registerAnchor('behind', () => ({ x: 0, y: 25, z: 10 }), 4.8);
    expect(anchors.raycastAnchors({ x: 0, y: 25, z: 0 }, { x: 0, y: 0, z: -1 }, 1)).toBeNull();
  });

  it('does not catch the drone above your column when firing down', () => {
    const anchors = new AnchorRegistry();
    anchors.registerAnchor('overhead', () => ({ x: 0, y: 25, z: 0 }), 4.8);
    for (const y of [1, 10, 19]) {
      expect(anchors.raycastAnchors({ x: 0, y, z: 0 }, { x: 0, y: -1, z: 0 }, 1)).toBeNull();
    }
  });

  it('counts starting inside a sphere as immediate contact on a short sweep', () => {
    const anchors = new AnchorRegistry();
    anchors.registerAnchor('inside', () => ({ x: 0, y: 25, z: 0 }), 4.8);
    expect(anchors.raycastAnchors({ x: 0, y: 25, z: 0 }, { x: 0, y: 1, z: 0 }, .5)).toEqual({ anchorId: 'inside', point: { x: 0, y: 25, z: 0 } });
  });

  it('selects the nearest forward sphere and respects the segment length', () => {
    const anchors = new AnchorRegistry();
    anchors.registerAnchor('behind', () => ({ x: -8, y: 0, z: 0 }), 1);
    anchors.registerAnchor('far', () => ({ x: 12, y: 0, z: 0 }), 1);
    anchors.registerAnchor('near', () => ({ x: 5, y: 0, z: 0 }), 1);
    const origin = { x: 0, y: 0, z: 0 }, dir = { x: 2, y: 0, z: 0 };
    expect(anchors.raycastAnchors(origin, dir, 3.9)).toBeNull();
    expect(anchors.raycastAnchors(origin, dir, 4)).toEqual({ anchorId: 'near', point: { x: 4, y: 0, z: 0 } });
  });
});
