import { describe, expect, it } from 'vitest';
import { stepTracking, isComplete } from '../src/tracking/progress.ts';
import { spawnDart, stepDart, dartHitCritter } from '../src/tracking/darts.ts';
import type { DartState } from '../src/tracking/darts.ts';
import { shouldLink } from '../src/tracking/tracker.ts';
import { speciesById } from '../src/critters/species.ts';
import { DART } from '../src/core/constants.ts';
import type { GroundQuery, SpeciesDef, Vec3 } from '../src/core/types.ts';
import type { CritterView } from '../src/critters/manager.ts';

function sp(id: string): SpeciesDef {
  const s = speciesById(id);
  if (!s) throw new Error(`no species ${id}`);
  return s;
}

const flatGround: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};
/** Ground far below so a dart only dies by DART.maxLife, never by contact. */
const abyss: GroundQuery = {
  heightAt: () => -10000,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

// ---------------------------------------------------------------------------
// stepTracking / isComplete
// ---------------------------------------------------------------------------

describe('stepTracking', () => {
  const puffle = sp('puffle'); // trackRadius 12, trackTime 8

  it('accumulates at +dt while inside the track radius', () => {
    expect(stepTracking(0, 5, 1, puffle)).toBeCloseTo(1, 6);
    expect(stepTracking(2, puffle.trackRadius, 0.5, puffle)).toBeCloseTo(2.5, 6);
  });

  it('decays at half rate while outside the track radius', () => {
    expect(stepTracking(4, 100, 1, puffle)).toBeCloseTo(3.5, 6);
    expect(stepTracking(4, puffle.trackRadius + 0.01, 2, puffle)).toBeCloseTo(3, 6);
  });

  it('clamps at the low end (never negative)', () => {
    expect(stepTracking(0, 100, 1, puffle)).toBe(0);
    expect(stepTracking(0.2, 100, 1, puffle)).toBe(0);
  });

  it('clamps at the high end (never exceeds trackTime)', () => {
    expect(stepTracking(puffle.trackTime, 1, 1, puffle)).toBe(puffle.trackTime);
    expect(stepTracking(puffle.trackTime - 0.1, 1, 1, puffle)).toBe(puffle.trackTime);
  });

  it('reports complete once progress reaches trackTime', () => {
    expect(isComplete(puffle.trackTime - 0.01, puffle)).toBe(false);
    expect(isComplete(puffle.trackTime, puffle)).toBe(true);
    expect(isComplete(puffle.trackTime + 1, puffle)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dart ballistics
// ---------------------------------------------------------------------------

describe('stepDart', () => {
  it('follows a ballistic arc that lands where projectile math predicts', () => {
    // Launch from 2 m up, 10° below horizontal, along +x, over flat ground.
    const angle = (-10 * Math.PI) / 180;
    const origin: Vec3 = { x: 0, y: 2, z: 0 };
    const dir: Vec3 = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };

    // Analytic landing range (y = 0): solve y0 + vy t + ½ g t² = 0.
    const vx = DART.speed * Math.cos(angle);
    const vy = DART.speed * Math.sin(angle);
    const a = 0.5 * DART.gravity;
    const disc = Math.sqrt(vy * vy - 4 * a * origin.y);
    const t = (-vy - disc) / (2 * a); // positive root
    const range = vx * t;

    let d = spawnDart(origin, dir);
    const dt = 0.001;
    let guard = 0;
    while (!d.dead && guard++ < 100000) d = stepDart(d, dt, flatGround);

    expect(d.dead).toBe(true);
    expect(d.pos.y).toBeLessThanOrEqual(0); // died on the ground
    expect(d.pos.x).toBeCloseTo(range, 1); // within ~0.05 m of predicted range
    expect(d.pos.z).toBeCloseTo(0, 6); // no lateral drift
  });

  it('dies once it lives past DART.maxLife (no ground in reach)', () => {
    // Horizontal throw over an abyss — only maxLife can kill it.
    let d = spawnDart({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const dt = 1 / 60;
    let guard = 0;
    while (!d.dead && guard++ < 100000) d = stepDart(d, dt, abyss);
    expect(d.dead).toBe(true);
    expect(d.age).toBeGreaterThanOrEqual(DART.maxLife);
    // Should not have taken dramatically longer than maxLife.
    expect(d.age).toBeLessThan(DART.maxLife + dt + 1e-6);
  });

  it('dies on ground contact well before maxLife', () => {
    // Thrown flat just above the ground — contact within a fraction of a second.
    let d = spawnDart({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 });
    const dt = 1 / 240;
    let guard = 0;
    while (!d.dead && guard++ < 100000) d = stepDart(d, dt, flatGround);
    expect(d.dead).toBe(true);
    expect(d.pos.y).toBeLessThanOrEqual(0);
    expect(d.age).toBeLessThan(DART.maxLife);
  });

  it('does not mutate the input state', () => {
    const d = spawnDart({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 });
    const next = stepDart(d, 1 / 60, flatGround);
    expect(d.age).toBe(0);
    expect(d.pos).toEqual({ x: 0, y: 5, z: 0 });
    expect(next).not.toBe(d);
  });
});

// ---------------------------------------------------------------------------
// dartHitCritter (sphere test, radius = species.size)
// ---------------------------------------------------------------------------

describe('dartHitCritter', () => {
  const dart: DartState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, dead: false };

  it('hits a critter whose species-size sphere contains the dart', () => {
    const critters = [{ id: 7, pos: { x: 0.3, y: 0, z: 0 }, size: 0.5 }];
    expect(dartHitCritter(dart, critters)).toBe(7);
  });

  it('misses when the dart is outside every sphere', () => {
    const critters = [{ id: 7, pos: { x: 2, y: 0, z: 0 }, size: 0.5 }];
    expect(dartHitCritter(dart, critters)).toBeNull();
  });

  it('returns the nearest overlapping critter', () => {
    const critters = [
      { id: 1, pos: { x: 0.9, y: 0, z: 0 }, size: 1.0 },
      { id: 2, pos: { x: 0.2, y: 0, z: 0 }, size: 1.0 },
    ];
    expect(dartHitCritter(dart, critters)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// no-double-award guard + a full tag→track→complete trace
// ---------------------------------------------------------------------------

describe('shouldLink (no-double-award guard)', () => {
  const puffle = sp('puffle');

  function view(over: Partial<CritterView>): CritterView {
    return {
      id: 1,
      species: 'puffle',
      pos: { x: 0, y: 0, z: 0 },
      state: 'idle',
      tagged: false,
      linked: false,
      trackProgress: 0,
      ...over,
    };
  }

  it('links a tagged, unlinked critter at full progress', () => {
    expect(shouldLink(view({ tagged: true, trackProgress: puffle.trackTime }), puffle)).toBe(true);
  });

  it('never re-links once linked, even at full progress', () => {
    expect(
      shouldLink(view({ tagged: true, linked: true, trackProgress: puffle.trackTime }), puffle),
    ).toBe(false);
  });

  it('does not link before progress completes or without a tag', () => {
    expect(shouldLink(view({ tagged: true, trackProgress: puffle.trackTime - 0.5 }), puffle)).toBe(false);
    expect(shouldLink(view({ tagged: false, trackProgress: puffle.trackTime }), puffle)).toBe(false);
  });

  it('completes a full cycle: tag, accrue inside the ring, then link exactly once', () => {
    const puffle2 = sp('puffle');
    let progress = 0;
    let linked = false;
    let awards = 0;
    const dt = 1 / 60;
    // Player sits 3 m from a tagged puffle for well over trackTime.
    for (let i = 0; i < Math.ceil(puffle2.trackTime / dt) + 120; i++) {
      progress = stepTracking(progress, 3, dt, puffle2);
      const v: CritterView = {
        id: 1, species: 'puffle', pos: { x: 0, y: 0, z: 0 }, state: 'calm',
        tagged: true, linked, trackProgress: progress,
      };
      if (shouldLink(v, puffle2)) {
        linked = true; // mirror manager.setLinked flipping the flag
        awards++;
      }
    }
    expect(progress).toBe(puffle2.trackTime); // clamped, not overshooting
    expect(linked).toBe(true);
    expect(awards).toBe(1); // awarded exactly once
  });
});
