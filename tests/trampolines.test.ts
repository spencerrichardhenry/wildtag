import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrampolineSystem, bounceLaunchVelocity } from '../src/structures/trampolines.ts';
import { MOVE, STRUCTURES } from '../src/core/constants.ts';
import type { GroundQuery } from '../src/core/types.ts';

const flat: GroundQuery = { heightAt: () => 5 };

function makeSys() {
  const inv = { kits: { trampoline: 2, skytramp: 1 } };
  const sys = new TrampolineSystem(new THREE.Scene(), flat, inv);
  return { sys, inv };
}

describe('trampolines (Bounce Wave)', () => {
  it('launch velocity reaches exactly the requested apex under gravity', () => {
    const apex = STRUCTURES.trampolineBounceFactor * STRUCTURES.droneHover; // 1.5 × drone height
    const v = bounceLaunchVelocity(MOVE.gravity, apex);
    // Ballistics: apex = v²/2g.
    expect((v * v) / (2 * Math.abs(MOVE.gravity))).toBeCloseTo(apex, 6);
    expect(apex).toBeCloseTo(37.5, 6);
  });

  it('placement consumes the matching kit; recall refunds it', () => {
    const { sys, inv } = makeSys();
    const res = sys.place({ x: 0, y: 0, z: 0 }, 'ground');
    expect(res.ok).toBe(true);
    expect(inv.kits.trampoline).toBe(1);
    expect(sys.recall(res.id!)).toBe(true);
    expect(inv.kits.trampoline).toBe(2);
  });

  it('sky trampolines sit at drone altitude and bounce from there', () => {
    const { sys } = makeSys();
    sys.place({ x: 0, y: 0, z: 0 }, 'sky');
    const padY = 5 + STRUCTURES.droneHover;
    // Descending onto the pad → launch; total apex = pad + 1.5×hover.
    const v = sys.bounceVelocity({ x: 0.5, y: padY + 0.3, z: 0 }, -4, MOVE.gravity);
    expect(v).not.toBeNull();
    const apexAbovePad = (v! * v!) / (2 * Math.abs(MOVE.gravity));
    expect(padY + apexAbovePad).toBeCloseTo(5 + 2.5 * STRUCTURES.droneHover, 5);
  });

  it('no bounce while rising, outside the pad, or under it', () => {
    const { sys } = makeSys();
    sys.place({ x: 0, y: 0, z: 0 }, 'ground');
    const padY = 5 + 0.9;
    expect(sys.bounceVelocity({ x: 0, y: padY + 0.2, z: 0 }, 3, MOVE.gravity)).toBeNull(); // rising
    expect(sys.bounceVelocity({ x: 9, y: padY + 0.2, z: 0 }, -3, MOVE.gravity)).toBeNull(); // off pad
    expect(sys.bounceVelocity({ x: 0, y: padY - 2, z: 0 }, -3, MOVE.gravity)).toBeNull(); // beneath
  });

  it('respects the placement cap and empty-kit rejection', () => {
    const inv = { kits: { trampoline: 99, skytramp: 0 } };
    const sys = new TrampolineSystem(new THREE.Scene(), flat, inv);
    expect(sys.place({ x: 0, y: 0, z: 0 }, 'sky').reason).toBe('nokit');
    for (let i = 0; i < STRUCTURES.maxTrampolines; i++) {
      expect(sys.place({ x: i * 10, y: 0, z: 0 }, 'ground').ok).toBe(true);
    }
    expect(sys.place({ x: 999, y: 0, z: 0 }, 'ground').reason).toBe('max');
  });

  it('save round-trip: data() → load() rebuilds pads without spending kits', () => {
    const { sys, inv } = makeSys();
    sys.place({ x: 3, y: 0, z: 4 }, 'ground');
    sys.place({ x: 8, y: 0, z: 1 }, 'sky');
    const data = sys.data();
    const inv2 = { kits: { trampoline: 0, skytramp: 0 } };
    const sys2 = new TrampolineSystem(new THREE.Scene(), flat, inv2);
    sys2.load(data);
    expect(sys2.count).toBe(2);
    expect(inv2.kits.trampoline).toBe(0);
    expect(sys2.data().map((t) => t.kind).sort()).toEqual(['ground', 'sky']);
    void inv;
  });
});
