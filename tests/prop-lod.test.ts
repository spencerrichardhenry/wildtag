import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propDetail } from '../src/world/prop-lod.ts';
import { PropManager } from '../src/world/props.ts';

describe('scenery LOD', () => {
  it('keeps the current mesh through the hysteresis band in either direction', () => {
    expect(propDetail(34, 0, 'high')).toBe(0);
    expect(propDetail(34, 1, 'high')).toBe(1);
    expect(propDetail(27, 1, 'high')).toBe(0);
    expect(propDetail(37, 0, 'high')).toBe(1);
    expect(propDetail(90, 1, 'high')).toBe(1);
    expect(propDetail(90, 2, 'high')).toBe(2);
    expect(propDetail(83, 2, 'high')).toBe(1);
    expect(propDetail(93, 1, 'high')).toBe(2);
    expect(propDetail(5, 2, 'high')).toBe(0);
    expect(propDetail(200, 0, 'high')).toBe(2);
  });
  it('retains more detailed range on higher quality', () => {
    expect(propDetail(30, 0, 'high')).toBe(0);
    expect(propDetail(30, 0, 'low')).toBe(1);
    expect(propDetail(70, 1, 'high')).toBe(1);
    expect(propDetail(70, 1, 'low')).toBe(2);
  });
  it('changes drawing detail without changing collisions, harvest targeting, or population', () => {
    const full = new PropManager(new THREE.Scene(), false);
    const lod = new PropManager(new THREE.Scene());
    for (const [x, z] of [[0, 0], [70, 0], [130, 70], [0, 0]]) {
      full.primeAround(x, z, 0); lod.primeAround(x, z, 0);
      full.update(x, z, 0); lod.update(x, z, 0);
      expect(lod.poolStats()).toEqual(full.poolStats());
      expect(lod.getObstacles(x, z)).toEqual(full.getObstacles(x, z));
      expect(lod.getGrappleColliders(x, z)).toEqual(full.getGrappleColliders(x, z));
      expect(lod.findHarvestable({x, y: 10, z}, {x: 0, y: -1, z: 0}, 0))
        .toEqual(full.findHarvestable({x, y: 10, z}, {x: 0, y: -1, z: 0}, 0));
    }
    expect(full.detailStats().far).toBe(0);
    expect(lod.detailStats().far).toBeGreaterThan(100);
    expect(lod.detailStats().near).toBeGreaterThan(0);
    full.dispose(); lod.dispose();
  });
});
