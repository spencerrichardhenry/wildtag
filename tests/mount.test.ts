import { describe, expect, it } from 'vitest';
import { bond, type Roster } from '../src/critters/roster.ts';
import { MOUNT } from '../src/core/constants.ts';
import {
  canAssignToFarm,
  canMount,
  canSummon,
  dismountEyeOffset,
  dismountVelocity,
  mountStep,
  setActiveMount,
} from '../src/player/mount.ts';
import type { GroundQuery, MoveInput, MoveState } from '../src/core/types.ts';

// ---------------------------------------------------------------------------
// Prismhorse mount core (pure). Eligibility gates, single-active-mount roster
// transition, and the ride kinematics (`mountStep`).
// ---------------------------------------------------------------------------

/** Flat ground at y=0 everywhere. */
const flat: GroundQuery = {
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

/** Deep water (y=-1) for x > 0, dry land (y=0) otherwise — a shoreline at x=0. */
const shoreline: GroundQuery = {
  heightAt: (x) => (x > 0 ? -1 : 0),
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

function moveInput(partial: Partial<MoveInput> = {}): MoveInput {
  return {
    forward: 0,
    strafe: 0,
    yaw: 0,
    sprint: false,
    jump: false,
    jumpHeld: false,
    dash: false,
    rocket: false,
    ...partial,
  };
}

function mountState(partial: Partial<MoveState> = {}): MoveState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    stamina: 100,
    exhausted: false,
    coyote: 0,
    jumpBuffer: 0,
    dashCooldown: 0,
    dashTime: 0,
    dashDir: { x: 0, y: 0, z: -1 },
    airDashUsed: false,
    airRocketUsed: false,
    rocketCooldown: 0,
    gliding: false,
    staminaRegenDelay: 0,
    mode: 'mount',
    ...partial,
  };
}

function planarSpeed(s: MoveState): number {
  return Math.hypot(s.vel.x, s.vel.z);
}

/** A single bonded roster entry with the given id/species/status. */
function rosterWith(...specs: Array<{ id: number; speciesId: string }>): Roster {
  let r: Roster = [];
  let i = 0;
  for (const s of specs) {
    r = bond(r, { id: s.id, speciesId: s.speciesId, linked: true }, i++)!.roster;
  }
  return r;
}

describe('canMount', () => {
  const rideable = rosterWith({ id: 1, speciesId: 'prismhorse' })[0]!;
  const walker = rosterWith({ id: 2, speciesId: 'puffle' })[0]!;

  it('is false with no entry selected', () => {
    expect(canMount(new Set(['saddle']), undefined)).toBe(false);
  });

  it('is false without the Saddle reward', () => {
    expect(canMount(new Set(), rideable)).toBe(false);
    expect(canMount(new Set(['whistle']), rideable)).toBe(false);
  });

  it('is false for a non-rideable species even with a saddle', () => {
    expect(canMount(new Set(['saddle']), walker)).toBe(false);
  });

  it('is true for a rideable species with the Saddle owned', () => {
    expect(canMount(new Set(['saddle']), rideable)).toBe(true);
  });

  it('is false for an entry on farm duty even with a saddle (statuses exclusive)', () => {
    const farmed = { ...rideable, status: { kind: 'farm', plotId: 1 } as const };
    expect(canMount(new Set(['saddle']), farmed)).toBe(false);
  });
});

describe('canAssignToFarm', () => {
  const idle = rosterWith({ id: 1, speciesId: 'puffle' })[0]!;

  it('is false with no entry selected', () => {
    expect(canAssignToFarm(undefined)).toBe(false);
  });

  it('is true for an idle entry', () => {
    expect(canAssignToFarm(idle)).toBe(true);
  });

  it('is false for an entry on mount duty (statuses exclusive — symmetric to canMount)', () => {
    const mounted = { ...idle, status: { kind: 'mount' } as const };
    expect(canAssignToFarm(mounted)).toBe(false);
  });
});

describe('canSummon', () => {
  it('needs the Whistle reward', () => {
    expect(canSummon(new Set())).toBe(false);
    expect(canSummon(new Set(['saddle']))).toBe(false);
    expect(canSummon(new Set(['whistle']))).toBe(true);
  });
});

describe('setActiveMount', () => {
  it('sets the chosen entry to mount status', () => {
    const r = rosterWith({ id: 1, speciesId: 'prismhorse' });
    const after = setActiveMount(r, 1);
    expect(after[0]!.status).toEqual({ kind: 'mount' });
  });

  it('reverts a previous mount to idle (single active mount)', () => {
    let r = rosterWith({ id: 1, speciesId: 'prismhorse' }, { id: 2, speciesId: 'prismhorse' });
    r = setActiveMount(r, 1);
    r = setActiveMount(r, 2);
    const mounts = r.filter((e) => e.status.kind === 'mount');
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.id).toBe(2);
    expect(r.find((e) => e.id === 1)!.status).toEqual({ kind: 'idle' });
  });

  it('is pure — never mutates the input roster', () => {
    const r = rosterWith({ id: 1, speciesId: 'prismhorse' });
    setActiveMount(r, 1);
    expect(r[0]!.status).toEqual({ kind: 'idle' });
  });

  it('returns the roster unchanged (never drops a mount) for an unknown id', () => {
    let r = rosterWith({ id: 1, speciesId: 'prismhorse' });
    r = setActiveMount(r, 1);
    const after = setActiveMount(r, 999);
    expect(after).toBe(r);
    expect(after.find((e) => e.id === 1)!.status).toEqual({ kind: 'mount' });
  });

  it('refuses an entry on farm duty — plot assignment and current mount both survive', () => {
    let r = rosterWith({ id: 1, speciesId: 'prismhorse' }, { id: 2, speciesId: 'prismhorse' });
    r = setActiveMount(r, 1);
    const farmed = r.map((e) =>
      e.id === 2 ? { ...e, status: { kind: 'farm', plotId: 3 } as const } : e,
    );
    const after = setActiveMount(farmed, 2);
    expect(after).toBe(farmed); // input returned unchanged
    expect(after.find((e) => e.id === 2)!.status).toEqual({ kind: 'farm', plotId: 3 });
    expect(after.find((e) => e.id === 1)!.status).toEqual({ kind: 'mount' });
  });
});

describe('mountStep', () => {
  it('accelerates toward and caps planar speed at MOUNT.speed (15)', () => {
    let s = mountState();
    for (let i = 0; i < 300; i++) {
      s = mountStep(s, moveInput({ forward: 1 }), 1 / 60, flat);
    }
    expect(planarSpeed(s)).toBeCloseTo(MOUNT.speed, 5);
    expect(planarSpeed(s)).toBeLessThanOrEqual(MOUNT.speed + 1e-9);
  });

  it('launches a grounded jump at MOUNT.jumpVel (11)', () => {
    const s = mountStep(mountState(), moveInput({ jump: true }), 1 / 60, flat);
    // vy = jumpVel then one gravity tick within the same step.
    expect(s.vel.y).toBeCloseTo(MOUNT.jumpVel + (-24) / 60, 5);
    expect(s.grounded).toBe(false);
  });

  it('does not double-jump: a jump edge while airborne is ignored', () => {
    const airborne = mountState({ grounded: false, pos: { x: 0, y: 5, z: 0 } });
    const s = mountStep(airborne, moveInput({ jump: true }), 1 / 60, flat);
    expect(s.vel.y).toBeLessThan(0); // only gravity, no launch
  });

  it('integrates gravity and snaps to the ground with grounded=true', () => {
    let s = mountState({ grounded: false, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 120; i++) s = mountStep(s, moveInput(), 1 / 60, flat);
    expect(s.pos.y).toBe(0);
    expect(s.vel.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it('blocks movement into deep water by zeroing the into-water velocity component', () => {
    // Standing at the shoreline (x=0), driving toward +x (deep water at x>0).
    let s = mountState({ pos: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 120; i++) {
      s = mountStep(s, moveInput({ forward: 1, yaw: -Math.PI / 2 }), 1 / 60, shoreline);
    }
    // yaw -PI/2 faces +x (facing = (-sin, 0, -cos) = (1, 0, 0)).
    expect(s.vel.x).toBe(0);
    expect(s.pos.x).toBeLessThanOrEqual(0); // never waded past the shore
  });

  it('still moves freely ALONG the shore (only the into-water axis is blocked)', () => {
    let s = mountState({ pos: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 120; i++) {
      // yaw 0 faces -Z; forward drives along z, which stays on dry land (x=0).
      s = mountStep(s, moveInput({ forward: 1 }), 1 / 60, shoreline);
    }
    expect(Math.abs(s.vel.z)).toBeGreaterThan(1);
  });

  it('never touches stamina while riding', () => {
    let s = mountState({ stamina: 42 });
    for (let i = 0; i < 300; i++) {
      s = mountStep(s, moveInput({ forward: 1, jump: i % 30 === 0 }), 1 / 60, flat);
    }
    expect(s.stamina).toBe(42);
    expect(s.staminaRegenDelay).toBe(0);
    expect(s.exhausted).toBe(false);
  });

  it('is pure — the input state is not mutated', () => {
    const s = mountState({ vel: { x: 1, y: 0, z: 0 } });
    const before = JSON.stringify(s);
    mountStep(s, moveInput({ forward: 1 }), 1 / 60, flat);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('dismountVelocity', () => {
  it('keeps the planar ride momentum and replaces Y with the hop', () => {
    const v = dismountVelocity({ x: 4, y: -9, z: -3 }, MOUNT.dismountHop);
    expect(v.x).toBe(4);
    expect(v.z).toBe(-3);
    expect(v.y).toBe(MOUNT.dismountHop); // upward hop, never a dead stop
  });

  it('never dead-stops a moving dismount (planar speed preserved)', () => {
    const ride = { x: 10, y: 0, z: 5 };
    const v = dismountVelocity(ride, MOUNT.dismountHop);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(Math.hypot(ride.x, ride.z), 9);
    expect(v.y).toBeGreaterThan(0);
  });
});

describe('dismountEyeOffset', () => {
  const D = MOUNT.dismountEyeLerp;
  const B = MOUNT.eyeHeightBonus;

  it('starts at the full mounted bonus and decays to zero over the window', () => {
    expect(dismountEyeOffset(0, D, B)).toBe(B);
    expect(dismountEyeOffset(D, D, B)).toBe(0);
    expect(dismountEyeOffset(D / 2, D, B)).toBeCloseTo(B / 2, 9);
  });

  it('clamps outside the window (never negative, never above the bonus)', () => {
    expect(dismountEyeOffset(-1, D, B)).toBe(B);
    expect(dismountEyeOffset(D * 3, D, B)).toBe(0);
    expect(dismountEyeOffset(0.1, 0, B)).toBe(0); // zero-duration → immediate
  });

  it('is monotonically non-increasing across the decay', () => {
    let prev = Infinity;
    for (let t = 0; t <= D; t += D / 10) {
      const v = dismountEyeOffset(t, D, B);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});
