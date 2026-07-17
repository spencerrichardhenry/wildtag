import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CritterManager } from '../src/critters/manager.ts';
import { SIM_DT } from '../src/core/constants.ts';

// The manager caches its list() snapshot per sim step so tracker + HUD + darts
// share one array (allocation churn cut); update() and any flag change bust it.

describe('CritterManager.list() per-step cache', () => {
  it('returns the same array reference within a step', () => {
    const m = new CritterManager(new THREE.Scene());
    m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    const a = m.list();
    const b = m.list();
    expect(a).toBe(b);
  });

  it('rebuilds the snapshot after update()', () => {
    const m = new CritterManager(new THREE.Scene());
    m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    const a = m.list();
    m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    const b = m.list();
    expect(b).not.toBe(a);
  });

  it('busts the cache when a critter is spawned', () => {
    const m = new CritterManager(new THREE.Scene());
    m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    const before = m.list();
    const id = m.debugSpawn('puffle', { x: 2, y: 0, z: 0 });
    expect(id).not.toBeNull();
    const after = m.list();
    expect(after).not.toBe(before);
    expect(after.some((c) => c.id === id)).toBe(true);
  });
});
