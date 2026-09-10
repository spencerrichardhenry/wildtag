import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CritterManager } from '../src/critters/manager.ts';
import { AI, SIM_DT, TRACKING } from '../src/core/constants.ts';

it('bonds the linked creature even when an unlinked flockmate is closer', () => {
  const m = new CritterManager(new THREE.Scene());
  const nearer = m.debugSpawn('puffle', { x: 0, y: 0, z: 2 })!;
  const linked = m.debugSpawn('puffle', { x: 0, y: 0, z: 5 })!;
  m.setLinked(linked);
  const origin = { x: 0, y: 0, z: 0 }, aim = { x: 0, y: 0, z: 1 };
  expect(m.nearestInCone(origin, aim, 30, .7)?.id).toBe(nearer);
  expect(m.nearestInCone(origin, aim, 30, .7, true)?.id).toBe(linked);
});

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

describe('tracking lifetime', () => {
  it('removes an empty tag and its ring after two gameplay minutes', () => {
    const m = new CritterManager(new THREE.Scene());
    const id = m.debugSpawn('puffle', { x: 2, y: 0, z: 0 })!;
    m.setTagged(id);

    m.tickTrackingTimers(TRACKING.emptyExpiryS - 0.01);
    expect(m.byId(id)?.tagged).toBe(true);
    expect(m.byId(id)?.trackEmptyFor).toBeCloseTo(TRACKING.emptyExpiryS - 0.01, 5);

    m.tickTrackingTimers(0.01);
    expect(m.byId(id)?.tagged).toBe(false);
    expect(m.byId(id)?.trackProgress).toBe(0);
    expect(m.byId(id)?.trackEmptyFor).toBe(0);
  });

  it('starts a fresh two-minute window when partial progress first decays to empty', () => {
    const m = new CritterManager(new THREE.Scene());
    const id = m.debugSpawn('puffle', { x: 2, y: 0, z: 0 })!;
    m.setTagged(id);
    m.tickTrackingTimers(60);
    m.setTrackProgress(id, 1);
    expect(m.byId(id)?.trackEmptyFor).toBe(0);

    m.tickTrackingTimers(60);
    expect(m.byId(id)?.trackEmptyFor).toBe(0);
    m.setTrackProgress(id, 0);
    m.tickTrackingTimers(TRACKING.emptyExpiryS - 0.01);
    expect(m.byId(id)?.tagged).toBe(true);
    m.tickTrackingTimers(0.01);
    expect(m.byId(id)?.tagged).toBe(false);
  });

  it('expires a tagged critter even while it is streamed out', () => {
    const m = new CritterManager(new THREE.Scene());
    const id = m.debugSpawn('puffle', { x: 0, y: 0, z: 0 })!;
    m.setTagged(id);
    m.update(SIM_DT, { x: AI.deactivateRadius + 100, y: 0, z: 0 });
    expect(m.byId(id)).toBeUndefined();

    m.tickTrackingTimers(TRACKING.emptyExpiryS);
    expect(m.exportRegistry()[id]?.tagged).toBe(false);
  });
});

describe('Slowing Dart timers', () => {
  it('applies for exactly twenty gameplay seconds and survives streaming state', () => {
    const m = new CritterManager(new THREE.Scene());
    const id = m.debugSpawn('puffle', { x: 2, y: 0, z: 0 })!;
    m.setSlowed(id);
    expect(m.byId(id)?.slowFor).toBe(TRACKING.slowDurationS);

    m.tickTrackingTimers(TRACKING.slowDurationS - 0.01);
    expect(m.byId(id)?.slowFor).toBeCloseTo(0.01, 5);
    m.tickTrackingTimers(0.01);
    expect(m.byId(id)?.slowFor).toBe(0);
  });
});

describe('Nectar Wisp sting pressure', () => {
  it('repeatedly stings after tagging and stops immediately when the Link completes', () => {
    const m = new CritterManager(new THREE.Scene());
    const id = m.debugSpawn('nectarwisp', { x: 0, y: 0, z: 0 })!;
    let stings = 0;
    m.onPlayerSting = () => { stings += 1; };
    m.setTagged(id);

    for (let i = 0; i < Math.ceil((AI.stingCooldown + 0.5) / SIM_DT); i++) {
      m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    }
    expect(stings).toBeGreaterThanOrEqual(2);

    m.setLinked(id);
    const atLink = stings;
    for (let i = 0; i < Math.ceil((AI.stingCooldown * 2) / SIM_DT); i++) {
      m.update(SIM_DT, { x: 0, y: 0, z: 0 });
    }
    expect(stings).toBe(atLink);
  });
});
