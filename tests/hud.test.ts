import { describe, expect, it } from 'vitest';
import {
  clamp,
  clampHotbarSlot,
  wrap180,
  mod360,
  facingBearingDeg,
  worldBearingDeg,
  bearingToStripX,
  compassTicks,
  ringScreenState,
  healthBarHideEligible,
  HUD,
  type Projected,
  type ProjectFn,
} from '../src/ui/hud-math.ts';
import { speciesById } from '../src/critters/species.ts';
import type { SpeciesDef, Vec3 } from '../src/core/types.ts';
import type { CritterView } from '../src/critters/manager.ts';

function sp(id: string): SpeciesDef {
  const s = speciesById(id);
  if (!s) throw new Error(`no species ${id}`);
  return s;
}

function critter(over: Partial<CritterView> = {}): CritterView {
  return {
    id: 1,
    species: 'puffle',
    pos: { x: 0, y: 0, z: 0 },
    state: 'idle',
    tagged: true,
    linked: false,
    trackProgress: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// scalar helpers
// ---------------------------------------------------------------------------

describe('clamp / wrap180 / mod360', () => {
  it('clamps to bounds', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('wraps degrees into (-180, 180]', () => {
    expect(wrap180(0)).toBe(0);
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(360)).toBe(0);
    expect(wrap180(540)).toBe(180);
    // wraps cleanly around the ±180 seam
    expect(wrap180(181)).toBeCloseTo(-179, 6);
    expect(wrap180(-181)).toBeCloseTo(179, 6);
  });

  it('normalises degrees into [0, 360)', () => {
    expect(mod360(0)).toBe(0);
    expect(mod360(-90)).toBe(270);
    expect(mod360(450)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// bearings
// ---------------------------------------------------------------------------

describe('facingBearingDeg', () => {
  it('maps yaw=0 to due North', () => {
    expect(facingBearingDeg(0)).toBeCloseTo(0, 6);
  });
  it('maps yaw=-90° to East and +90° to West', () => {
    expect(facingBearingDeg(-Math.PI / 2)).toBeCloseTo(90, 6);
    expect(facingBearingDeg(Math.PI / 2)).toBeCloseTo(270, 6);
  });
  it('maps yaw=±180° to South', () => {
    expect(facingBearingDeg(Math.PI)).toBeCloseTo(180, 6);
  });
});

describe('worldBearingDeg', () => {
  it('reads cardinal directions from world offsets', () => {
    expect(worldBearingDeg(0, -1)).toBeCloseTo(0, 6); // -Z = North
    expect(worldBearingDeg(1, 0)).toBeCloseTo(90, 6); // +X = East
    expect(worldBearingDeg(0, 1)).toBeCloseTo(180, 6); // +Z = South
    expect(worldBearingDeg(-1, 0)).toBeCloseTo(270, 6); // -X = West
  });
});

// ---------------------------------------------------------------------------
// compass strip / ticks
// ---------------------------------------------------------------------------

describe('bearingToStripX', () => {
  it('centres the facing bearing and marks off-window bearings hidden', () => {
    const c = bearingToStripX(90, 90, 1000, 150);
    expect(c.x).toBeCloseTo(500, 6);
    expect(c.visible).toBe(true);

    // 90° away with a 150° span (±75) is outside the window
    const off = bearingToStripX(180, 90, 1000, 150);
    expect(off.visible).toBe(false);
  });

  it('places a bearing left/right of centre correctly', () => {
    // bearing 30° left of a facing of 90° → left of centre
    const left = bearingToStripX(60, 90, 1000, 150);
    expect(left.x).toBeLessThan(500);
    const right = bearingToStripX(120, 90, 1000, 150);
    expect(right.x).toBeGreaterThan(500);
  });
});

describe('compassTicks', () => {
  it('puts the N tick dead-centre when facing North (yaw=0)', () => {
    const ticks = compassTicks(0, 1200);
    const north = ticks.find((t) => t.deg === 0);
    expect(north).toBeDefined();
    expect(north!.label).toBe('N');
    expect(north!.major).toBe(true);
    expect(north!.x).toBeCloseTo(600, 6);
  });

  it('labels 45° ticks and leaves 15° ticks blank', () => {
    const ticks = compassTicks(0, 1200);
    const ne = ticks.find((t) => t.deg === 45);
    const minor = ticks.find((t) => t.deg === 15);
    expect(ne?.label).toBe('NE');
    expect(minor?.label).toBe('');
    expect(minor?.major).toBe(false);
  });

  it('only returns ticks within the strip span, symmetric around the seam', () => {
    // Facing North, span 150 → visible bearings are [-75, 75] i.e. 0,±15…±75
    // = 285,300,315,330,345,0,15,30,45,60,75 → 11 ticks.
    const ticks = compassTicks(0, 1200);
    expect(ticks.length).toBe(11);
    for (const t of ticks) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(1200);
    }
  });

  it('scrolls the strip as yaw turns East', () => {
    // Facing East (yaw=-90°): the E tick (90°) is centred.
    const ticks = compassTicks(-Math.PI / 2, 1200);
    const east = ticks.find((t) => t.deg === 90);
    expect(east?.label).toBe('E');
    expect(east!.x).toBeCloseTo(600, 6);
  });
});

// ---------------------------------------------------------------------------
// tracking rings
// ---------------------------------------------------------------------------

const centreProject: Projected = { x: 0, y: 0, behind: false };

describe('ringScreenState', () => {
  it('clamps progress fraction to [0, 1]', () => {
    const puffle = sp('puffle'); // trackTime 8
    const under = ringScreenState(
      critter({ trackProgress: 4 }),
      puffle,
      { x: 0, y: 0, z: 0 },
      () => centreProject,
    );
    expect(under.pct).toBeCloseTo(0.5, 6);

    const over = ringScreenState(
      critter({ trackProgress: 999 }),
      puffle,
      { x: 0, y: 0, z: 0 },
      () => centreProject,
    );
    expect(over.pct).toBe(1);
  });

  it('flips inRadius at the species track radius', () => {
    const puffle = sp('puffle'); // trackRadius 12
    const inside = ringScreenState(
      critter({ pos: { x: 11, y: 0, z: 0 } }),
      puffle,
      { x: 0, y: 0, z: 0 },
      () => centreProject,
    );
    expect(inside.inRadius).toBe(true);
    expect(inside.dist).toBeCloseTo(11, 6);

    const outside = ringScreenState(
      critter({ pos: { x: 13, y: 0, z: 0 } }),
      puffle,
      { x: 0, y: 0, z: 0 },
      () => centreProject,
    );
    expect(outside.inRadius).toBe(false);
  });

  it('reports onScreen for a centred projection', () => {
    const r = ringScreenState(critter(), sp('puffle'), { x: 0, y: 0, z: 0 }, () => centreProject);
    expect(r.onScreen).toBe(true);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('clamps an offscreen point onto the edge box', () => {
    // Projects far off to the right and slightly up → clamp x to +1.
    const proj: ProjectFn = () => ({ x: 3, y: 0.5, behind: false });
    const r = ringScreenState(critter(), sp('puffle'), { x: 0, y: 0, z: 0 }, proj);
    expect(r.onScreen).toBe(false);
    expect(r.x).toBeCloseTo(1, 6);
    expect(Math.abs(r.y)).toBeLessThanOrEqual(1);
    // direction preserved: y stays positive and proportional
    expect(r.y).toBeCloseTo(0.5 / 3, 6);
  });

  it('anchors the ring at the size-based default height when no ringHeight is set', () => {
    // Capture the world point handed to the projector.
    let head: Vec3 | null = null;
    const proj: ProjectFn = (w) => {
      head = w;
      return centreProject;
    };
    const puffle = sp('puffle'); // size 0.5, no ringHeight
    ringScreenState(critter({ pos: { x: 0, y: 0, z: 0 } }), puffle, { x: 0, y: 0, z: 0 }, proj);
    expect(head!.y).toBeCloseTo(puffle.size * HUD.ringHeadFactor, 6);
  });

  it('anchors the ring at the per-species ringHeight when supplied (tall species)', () => {
    let head: Vec3 | null = null;
    const proj: ProjectFn = (w) => {
      head = w;
      return centreProject;
    };
    const stag = sp('lumenstag'); // has an explicit taller ringHeight
    expect(stag.ringHeight).toBeDefined();
    expect(stag.ringHeight!).toBeGreaterThan(stag.size * HUD.ringHeadFactor);
    ringScreenState(critter({ species: 'lumenstag', pos: { x: 0, y: 0, z: 0 } }), stag, { x: 0, y: 0, z: 0 }, proj);
    expect(head!.y).toBeCloseTo(stag.ringHeight!, 6);
  });

  it('flips a behind-camera point to the opposite edge', () => {
    // Behind the camera the raw NDC points right; flipped it should hit the
    // left edge (and always be treated as offscreen).
    const proj: ProjectFn = () => ({ x: 0.4, y: 0, behind: true });
    const r = ringScreenState(critter(), sp('puffle'), { x: 0, y: 0, z: 0 }, proj);
    expect(r.onScreen).toBe(false);
    expect(r.x).toBeCloseTo(-1, 6);
  });
});

describe('HUD tuning', () => {
  it('exposes a positive ring reach and compass span', () => {
    expect(HUD.ringMaxDist).toBeGreaterThan(0);
    expect(HUD.compassSpanDeg).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// hotbar slot clamp (Cursed Castle Task 13 — the DOM-free seam behind
// HUD.selectHotbar; the HUD class itself needs `document` and isn't
// unit-testable in this suite's DOM-free node environment).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HP bar hide-eligibility (Cursed Castle spec §4 / final-review fix): the bar
// stays up at full HP while `dangerZone` is true, and only becomes
// hide-eligible (subject to the caller's own linger timer) once none of
// "not full" / dazed / dangerZone hold.
// ---------------------------------------------------------------------------

describe('healthBarHideEligible', () => {
  it('is eligible to hide at full HP, not dazed, not in the danger zone', () => {
    expect(healthBarHideEligible(true, false, false)).toBe(true);
  });

  it('is NOT eligible while dazed, even at full HP', () => {
    expect(healthBarHideEligible(true, true, false)).toBe(false);
  });

  it('is NOT eligible while in the danger zone, even at full HP and not dazed', () => {
    expect(healthBarHideEligible(true, false, true)).toBe(false);
  });

  it('is NOT eligible when not full, regardless of dazed/dangerZone', () => {
    expect(healthBarHideEligible(false, false, false)).toBe(false);
  });
});

describe('clampHotbarSlot', () => {
  it('accepts every slot in range, including the new Purify slot 5', () => {
    expect(clampHotbarSlot(1)).toBe(1);
    expect(clampHotbarSlot(4)).toBe(4);
    expect(clampHotbarSlot(5)).toBe(5);
  });

  it('ignores a request past the last slot', () => {
    expect(clampHotbarSlot(6)).toBeNull();
  });

  it('ignores a request below slot 1', () => {
    expect(clampHotbarSlot(0)).toBeNull();
    expect(clampHotbarSlot(-1)).toBeNull();
  });
});
