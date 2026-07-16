import { describe, expect, it } from 'vitest';
import { GRAPPLE, MOVE } from '../src/core/constants.ts';
import type { MoveState, Vec3 } from '../src/core/types.ts';
import { initialMoveState } from '../src/player/movement.ts';
import {
  fireGrapple,
  raycastTerrain,
  stepGrapple,
  type GrappleState,
} from '../src/player/grapple.ts';
import { AnchorRegistry } from '../src/structures/anchors.ts';

const DT = 1 / 60;

function state(pos: Vec3, vel: Vec3): MoveState {
  return { ...initialMoveState(pos), vel: { ...vel } };
}

function grapple(anchor: Vec3, length: number, over: Partial<GrappleState> = {}): GrappleState {
  return { active: true, anchor, length, reeling: false, occludedFor: 0, ...over };
}

function speed(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

// A rope anchored above the origin. Player hangs below it.
const ANCHOR: Vec3 = { x: 0, y: 10, z: 0 };

describe('fireGrapple', () => {
  it('anchors at the hit with length = fire-time distance', () => {
    const g = fireGrapple({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 30, z: 0 });
    expect(g).not.toBeNull();
    expect(g!.active).toBe(true);
    expect(g!.anchor).toEqual({ x: 0, y: 30, z: 0 });
    expect(g!.length).toBeCloseTo(30, 6);
    expect(g!.occludedFor).toBe(0);
  });

  it('returns null when there is no hit', () => {
    expect(fireGrapple({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, null)).toBeNull();
  });

  it('rejects hits beyond maxRange', () => {
    const far: Vec3 = { x: 0, y: GRAPPLE.maxRange + 5, z: 0 };
    expect(fireGrapple({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, far)).toBeNull();
  });

  it('accepts a hit exactly at maxRange', () => {
    const edge: Vec3 = { x: 0, y: GRAPPLE.maxRange, z: 0 };
    const g = fireGrapple({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, edge);
    expect(g).not.toBeNull();
    expect(g!.length).toBeCloseTo(GRAPPLE.maxRange, 6);
  });
});

describe('stepGrapple — taut rope', () => {
  it('kills outward radial velocity but preserves tangential speed', () => {
    // Player at (5,10,0): straight out along +x from the anchor, so the rope
    // is horizontal and the radial axis is +x. Slightly overstretched (length
    // 4.9 < dist 5) so the rope is unambiguously taut.
    const g = grapple(ANCHOR, 4.9);
    const vTangential = 6; // along -z
    const vOutward = 4; // along +x (radial, outward)
    const s = state({ x: 5, y: 10, z: 0 }, { x: vOutward, y: 0, z: -vTangential });

    const { vel } = stepGrapple(g, s, false, DT);

    // Outward radial (x) component removed — only a small inward spring remains.
    expect(vel.x).toBeLessThanOrEqual(0);
    expect(vel.x).toBeGreaterThan(-0.1);
    // Tangential (z) is untouched — the constraint acts only along the rope axis.
    expect(vel.z).toBeCloseTo(-vTangential, 10);
    // Tangential swing speed preserved (energy of the swing is not stolen).
    expect(Math.hypot(vel.y, vel.z)).toBeCloseTo(vTangential, 10);
  });

  it('does not add energy: outbound speed never grows when taut', () => {
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 5, y: 10, z: 0 }, { x: 4, y: 0, z: -6 });
    const before = speed(s.vel);
    const { vel } = stepGrapple(g, s, false, DT);
    expect(speed(vel)).toBeLessThanOrEqual(before + 1e-9);
  });

  it('spring pulls inward when overstretched at rest', () => {
    // At rest, stretched past the rope length → a purely inward velocity appears.
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 7, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }); // dist 7 > length 5
    const { vel } = stepGrapple(g, s, false, DT);
    expect(vel.x).toBeLessThan(0); // pulled back toward the anchor (−x)
    expect(vel.y).toBeCloseTo(0, 6);
    expect(vel.z).toBeCloseTo(0, 6);
    // Magnitude matches the capped spring impulse.
    const expected = Math.min(GRAPPLE.stiffness * (7 - 5), GRAPPLE.springAccelMax) * DT;
    expect(-vel.x).toBeCloseTo(expected, 6);
  });
});

describe('stepGrapple — slack rope', () => {
  it('leaves velocity unchanged inside the rope reach', () => {
    const g = grapple(ANCHOR, 8);
    const s = state({ x: 3, y: 10, z: 0 }, { x: 4, y: -2, z: 1 }); // dist 3 < length 8
    const { vel } = stepGrapple(g, s, false, DT);
    expect(vel).toEqual(s.vel);
  });
});

describe('stepGrapple — reeling', () => {
  it('shortens length by reelSpeed·dt and reports reelCostPerS·dt', () => {
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 5, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    const res = stepGrapple(g, s, true, DT);
    expect(res.g.length).toBeCloseTo(5 - GRAPPLE.reelSpeed * DT, 6);
    expect(res.staminaCost).toBeCloseTo(GRAPPLE.reelCostPerS * DT, 6);
    expect(res.g.reeling).toBe(true);
  });

  it('charges nothing and does not shorten when not reeling', () => {
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 5, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    const res = stepGrapple(g, s, false, DT);
    expect(res.staminaCost).toBe(0);
    expect(res.g.length).toBe(5);
    expect(res.g.reeling).toBe(false);
  });

  it('auto-releases below minLength while still charging that step', () => {
    const g = grapple(ANCHOR, GRAPPLE.minLength + GRAPPLE.reelSpeed * DT * 0.5);
    const s = state({ x: 0, y: 10 - g.length, z: 0 }, { x: 0, y: 0, z: 0 });
    const res = stepGrapple(g, s, true, DT);
    expect(res.g.active).toBe(false);
    expect(res.staminaCost).toBeCloseTo(GRAPPLE.reelCostPerS * DT, 6);
  });
});

describe('stepGrapple — occlusion release', () => {
  it('stays active below the grace threshold', () => {
    const g = grapple(ANCHOR, 5, { occludedFor: GRAPPLE.occlusionGrace - 0.01 });
    const s = state({ x: 5, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(stepGrapple(g, s, false, DT).g.active).toBe(true);
  });

  it('releases at the grace threshold, preserving velocity', () => {
    const g = grapple(ANCHOR, 5, { occludedFor: GRAPPLE.occlusionGrace });
    const s = state({ x: 5, y: 10, z: 0 }, { x: 1, y: -2, z: 3 });
    const res = stepGrapple(g, s, false, DT);
    expect(res.g.active).toBe(false);
    expect(res.vel).toEqual(s.vel);
  });
});

describe('stepGrapple — pendulum energy conservation', () => {
  it('conserves mechanical energy over a 2s swing within 10%', () => {
    // Anchor high; player released from the side at rest — a full pendulum.
    const anchor: Vec3 = { x: 0, y: 20, z: 0 };
    const length = 12;
    let g = grapple(anchor, length);
    // Start out to the side, at rest, exactly at rope length (horizontal arm).
    let s = state({ x: length, y: 20, z: 0 }, { x: 0, y: 0, z: 0 });

    const gAbs = -MOVE.gravity; // positive magnitude
    const energy = (st: MoveState): number =>
      0.5 * (st.vel.x ** 2 + st.vel.y ** 2 + st.vel.z ** 2) + gAbs * st.pos.y;

    const e0 = energy(s);
    let maxDist = 0;
    for (let i = 0; i < 120; i++) {
      // Integrate gravity like the movement core would, then constrain.
      const vy = s.vel.y + MOVE.gravity * DT;
      const pos: Vec3 = {
        x: s.pos.x + s.vel.x * DT,
        y: s.pos.y + vy * DT,
        z: s.pos.z + s.vel.z * DT,
      };
      s = { ...s, pos, vel: { x: s.vel.x, y: vy, z: s.vel.z } };
      const res = stepGrapple(g, s, false, DT);
      g = res.g;
      s = { ...s, vel: res.vel };
      maxDist = Math.max(maxDist, Math.hypot(pos.x - anchor.x, pos.y - anchor.y, pos.z - anchor.z));
    }

    const drift = Math.abs(energy(s) - e0) / e0;
    expect(drift).toBeLessThan(0.1);
    // Never flies meaningfully past the rope length (soft-spring overstretch).
    expect(maxDist).toBeLessThan(length + 1);
  });
});

describe('stepGrapple — determinism', () => {
  it('produces identical output for identical input', () => {
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 5, y: 10, z: 0 }, { x: 3, y: -1, z: 2 });
    const a = stepGrapple(g, s, true, DT);
    const b = stepGrapple(g, s, true, DT);
    expect(a).toEqual(b);
  });

  it('does not mutate its inputs', () => {
    const g = grapple(ANCHOR, 5);
    const s = state({ x: 6, y: 10, z: 0 }, { x: 2, y: 0, z: 0 });
    const gSnap = JSON.parse(JSON.stringify(g));
    const sSnap = JSON.parse(JSON.stringify(s));
    stepGrapple(g, s, true, DT);
    expect(g).toEqual(gSnap);
    expect(s).toEqual(sSnap);
  });
});

describe('raycastTerrain', () => {
  const flatAt = (h: number) => () => h;

  it('hits flat ground below a downward ray', () => {
    // Origin above a flat plane at y=0, aiming down and forward.
    const hit = raycastTerrain({ x: 0, y: 10, z: 0 }, { x: 1, y: -1, z: 0 }, flatAt(0), 45);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(0, 1);
    expect(hit!.x).toBeCloseTo(10, 1); // 45° ray travels equal x and −y
  });

  it('returns null when the ray never meets the ground within range', () => {
    // Aiming up over flat ground never descends to it.
    const hit = raycastTerrain({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, flatAt(0), 45);
    expect(hit).toBeNull();
  });

  it('finds a hillside (rising ground ahead)', () => {
    // Ground rises 1m per metre of +x; a level ray from x=0,y=5 meets it at x≈5.
    const rising = (x: number) => x;
    const hit = raycastTerrain({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, rising, 45);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(5, 0);
    expect(hit!.y).toBeCloseTo(5, 0);
  });
});

describe('AnchorRegistry', () => {
  it('raycasts the nearest registered sphere', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('near', () => ({ x: 5, y: 0, z: 0 }), 1);
    reg.registerAnchor('far', () => ({ x: 20, y: 0, z: 0 }), 1);
    const hit = reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45);
    expect(hit).not.toBeNull();
    expect(hit!.anchorId).toBe('near');
    expect(hit!.point.x).toBeCloseTo(4, 5); // front face of the near sphere
  });

  it('misses spheres the ray does not cross', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('off', () => ({ x: 5, y: 10, z: 0 }), 1);
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).toBeNull();
  });

  it('respects maxDist and unregister', () => {
    const reg = new AnchorRegistry();
    reg.registerAnchor('a', () => ({ x: 40, y: 0, z: 0 }), 1);
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull();
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).not.toBeNull();
    reg.unregisterAnchor('a');
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)).toBeNull();
  });

  it('tracks a moving anchor via getPos', () => {
    const reg = new AnchorRegistry();
    let x = 5;
    reg.registerAnchor('drone', () => ({ x, y: 0, z: 0 }), 1);
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)!.point.x).toBeCloseTo(
      4,
      5,
    );
    x = 30;
    expect(reg.raycastAnchors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 45)!.point.x).toBeCloseTo(
      29,
      5,
    );
  });
});
