# Tiny Tide Evolution Core — Plan C: Game Integration and Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Plans A and B into the game:
- one input consumer and one pure player step that owns velocities, turning, Breach and recovery
- lifecycle transitions and one pure damage resolution
- avoidance acceptance against the real hunters
- food guidance
- the path screen, the evolution submit flow and the plan-aware, ledger-backed editor with one-owner gestures
- start-screen notices, the archive and safe save keys
- browser tests, including rendered-versus-combat pose agreement
- the pacing study

**Architecture:** Five new pure modules (`input.ts`, `player-motion.ts`, `lifecycle.ts`, `avoidance.ts`, plus guide caching inside `main.ts`) carry the logic and have unit tests. `main.ts`, `world.ts`, `editor.ts`, `path-screen.ts` and `preview.ts` wire them to the DOM and WebGL. Browser tests use real input, save fixtures built from the game's own modules, and read-only diagnostics.

**Tech Stack:** TypeScript 7, three.js 0.185, Vite 8, Vitest 4, Playwright 1.63 (Chrome, SwiftShader).

**Spec:** `docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md` (revision 4), sections 3, 4, 6, 7, 9, 11, 12, 14.

**Depends on:** Plans A and B complete.

## Global Constraints

- All Plan A global constraints apply (both type checks after every task).
- The editor must not create geometry or materials per pointer move or per frame. The body mesh is rebuilt only when the body shape changes, at most once per animation frame.
- Diagnostics (`window.__tinyTide`) stay read-only. Tests never call game functions or change game state through diagnostics.
- QA-only URL parameters are read once at load and documented: `forcedSpawn`, `qaStartGrace`, `qaRejectSubmit`, `qaHoldStart`. Nothing changes a running game from outside.
- Long browser tests run in the background. A task is green only when its listed browser scripts pass.

## Review Focus

1. An impulse with no input, at every size — expected: it decays and never grows; into a wall it is removed once. Pinned in C2.
2. A long body turning toward a wall — expected: it stops turning; it is never teleported by recovery. Pinned in C2 and C11.
3. A faint during a Breach — expected: one loss, everything transient reset (arc, permit, both velocities, actions, guard, stagger), one respawn, also after a reload. Pinned in C3 and C11.
4. A Speck hunted by a crab — expected: running away works (the hunter gives up or never lands a hit). Pinned in C5.
5. Evolution whose destination cannot be found — expected: the editor stays open with its draft and undo history; nothing changes. Pinned in C7.

---

## Shared names produced by Plan C

```ts
// input.ts (C1)
interface InputSources { stickX; stickZ; keys: ReadonlySet<string>; chompHeld; chompTapped; riseHeld; riseTapped; diveHeld; aim?: Vec3 | null; activeTapped?: [boolean, boolean]; activeHeld?: [boolean, boolean]; activeCanceled?: [boolean, boolean] }
readIntent(src, previous: CombatInput, opts: { breachOnRiseTap: boolean }): CombatInput; RELEASED: CombatInput; basicRequested(intent): boolean
// player-motion.ts (C2)
BREACH_SECONDS = 1.8; BREACH_COOLDOWN = 2.3; BREACH_END_DEPTH = 1.3; EXTERNAL_DECAY = 6; GROUND_SETTLE = 6
interface PlayerStepContext { plan; profile; caps; actor; queries; bounds; size; topSpeedLocal; now; dt; wish: Vec3; aim: Vec3 | null; actionLock: boolean }
interface PlayerStepResult { position: Vec3; status; contacts; needsRecovery: boolean; breachStarted: boolean; arcEnded: boolean; permitEnded: boolean }
stepPlayer(position, rt, intent, ctx): PlayerStepResult; blockHint(plan, contact): string
// lifecycle.ts (C3)
resetRuntime(rt, orientation?); beginRespawn(run, rt): boolean; resolveRespawn(run, rt, now, anchor: RecoveryResult): boolean
recoverPlayer(actor, position, orientation, ctx, anchor, maxDistance): RecoveryResult
reconcileAfterCommit(rt, delta, genome, actorId, now, catalogs?); resolveHazards(events, ctx): EcoEvent[]
evolutionDestination(actor, here, ctx, anchor): RecoveryResult; canChooseNextPlan(run, build, plans?)
// avoidance.ts (C5)
findEncounters(planId, hunterKey, count, seeds?): Encounter[]; simulateEscape(encounter, hunter?): EscapeResult
// world.ts (C4)
placePlayerAt(local: T.Vector3): void; transform(stage, genome, targetPhysical: Vec3): void
// editor.ts (C7, C8)
EditorOptions.onSubmit(result: EditorResult): Promise<{ ok: true } | { ok: false; reason: string }>; EditorResult { genome; name; nextSerial }
```

---

### Task C1: Input intents with one consumer

**Files:**
- Create: `src/tiny-tide/input.ts`
- Test: `tests/tiny-tide-core/input.test.ts`

**Interfaces:**
- Consumes: `CombatInput` (B2).
- Produces: `InputSources`, `readIntent`, `RELEASED`, `basicRequested`.

**Rules (C-R3-09):**
- `move` comes from the stick plus WASD and the arrow keys, clamped to length 1.
- `basicHeld` = Chomp button held or Space held. `basicPressed` = `chompTapped`, or `basicHeld && !previous.basicHeld` (an edge, so a held or repeating key gives one press).
- **Priority:** when any `activePressed[i]` is true in this tick, `basicPressed` is false for this tick; `basicHeld` is unchanged (holding resumes next tick).
- `traversal`: `breach` when `opts.breachOnRiseTap && riseTapped`; else `rise` when only rise is held (E or the special button); `dive` when only dive is held (Q or the Dive button); else `none`.
- Actives (none ship yet): `activePressed[i]` = tapped, or held now and not held before. `activeReleased[i]` = held before, not held now, and not canceled. `activeCanceled[i]` comes from the source (touch cancel). A canceled hold never becomes a release.
- `aim` defaults to `null`.
- `basicRequested(intent) = !intent.activePressed.some(Boolean) && (intent.basicPressed || intent.basicHeld)` — the one place the simulation asks for a bite. An active press suppresses basic **initiation** for that tick; the hold resumes the next tick.
- `RELEASED` is the all-empty intent. `main.ts` sets `lastIntent = RELEASED` and clears every source on pause, edit, blur, `pointercancel` and lost pointer capture. Nothing is buffered.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/input.test.ts
import { describe, expect, it } from 'vitest';
import { basicRequested, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';

const src = (over: Partial<InputSources> = {}): InputSources => ({ stickX: 0, stickZ: 0, keys: new Set(), chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false, ...over });
const read = (s: InputSources, prev = RELEASED, breach = false) => readIntent(s, prev, { breachOnRiseTap: breach });
describe('input intents', () => {
  it('maps keys and stick to a clamped move', () => { expect(Math.hypot(read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.x, read(src({ stickX: .8, keys: new Set(['KeyW']) })).move.z)).toBeCloseTo(1); });
  it('gives one press for a held or repeating Space, and keeps the hold', () => {
    const a = read(src({ keys: new Set(['Space']) })), b = read(src({ keys: new Set(['Space']) }), a);
    expect(a.basicPressed).toBe(true); expect(b.basicPressed).toBe(false); expect(b.basicHeld).toBe(true); expect(basicRequested(b)).toBe(true);
    expect(read(src({ chompTapped: true }), b).basicPressed).toBe(true);
  });
  it('lets an active press suppress the basic press for that tick only', () => {
    const a = read(src({ keys: new Set(['Space']), activeTapped: [true, false], activeHeld: [true, false] }));
    expect(a.basicPressed).toBe(false); expect(a.basicHeld).toBe(true); expect(a.activePressed).toEqual([true, false]); expect(basicRequested(a)).toBe(false);
    const b = read(src({ keys: new Set(['Space']), activeHeld: [true, false] }), a); expect(basicRequested(b)).toBe(true);   // next tick: the hold resumes
  });
  it('reports releases, but never a release after a cancel', () => {
    const held = read(src({ activeHeld: [false, true] }));
    expect(read(src(), held).activeReleased).toEqual([false, true]);
    expect(read(src({ activeCanceled: [false, true] }), held).activeReleased).toEqual([false, false]);
    expect(held.activePressed).toEqual([false, true]); expect(read(src(), held).activePressed).toEqual([false, false]);
  });
  it('maps traversal: breach on a rise tap only when the plan can breach', () => {
    expect(read(src({ keys: new Set(['KeyE']), riseHeld: true })).traversal).toBe('rise'); expect(read(src({ diveHeld: true })).traversal).toBe('dive');
    expect(read(src({ riseHeld: true, diveHeld: true })).traversal).toBe('none');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, true).traversal).toBe('breach');
    expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, false).traversal).toBe('rise');
  });
  it('has an all-released intent', () => { expect(RELEASED).toMatchObject({ basicHeld: false, basicPressed: false, traversal: 'none', move: { x: 0, y: 0, z: 0 }, aim: null }); });
});
```

`readIntent` treats `KeyE` like `riseHeld` and `KeyQ` like `diveHeld`; `main.ts` sets `riseTapped` on a non-repeat `KeyE` keydown or a special-button pointerdown and clears it after the tick reads it.

- [ ] **Step 2: Implement and run.** Expected: PASS (6 tests).

- [ ] **Step 3: Checkpoint and commit**

```bash
git add src/tiny-tide/input.ts tests/tiny-tide-core/input.test.ts
git commit -m "Tiny Tide: input intents with edges, priority and cancel"
```

---

### Task C2: The pure player step

**Files:**
- Create: `src/tiny-tide/player-motion.ts`
- Test: `tests/tiny-tide-core/player-motion.test.ts`

**Interfaces:**
- Consumes: B2 (`movementCapabilities`, `breachPermit`, `BREACH_RISE`, types, `newRuntime`), B3 (`supportHeight`, `forwardOf`), B4 (`resolveMotion`, `projectVelocity`), B5 (`playerActor`).
- Produces: the C2 names in "Shared names". `PlayerStepContext.wish` is the camera-mapped move wish in world space (`|wish| ≤ 1`; its `y` is the camera pitch part, used only when `caps.pitch`). `topSpeedLocal = STAGES[stage].speed × derived.speedFactor`.

**`stepPlayer(position, rt, intent, ctx)` (spec §3, §9; C-R3-02, T-R3-12, T-R3-13).** It mutates `rt` and returns the result. In this order:

1. **Breach.** If `intent.traversal === 'breach'`, `caps.breach`, `rt.arc === null` and `now ≥ rt.breachReadyAt`: `rt.arc = { startedAt: now, duration: BREACH_SECONDS, fromY: position.y }`, `rt.permit = breachPermit(now)`, `rt.breachReadyAt = now + BREACH_COOLDOWN`, `breachStarted = true`.
2. **Complete wish.** `w = (wish.x, caps.pitch ? wish.y : 0, wish.z)`; add `+1` (rise) or `−1` (dive) to `w.y` when `caps.rise` and there is no arc; ground modes force `w.y = 0`; if `|w| > 1`, normalize. This happens **before** acceleration.
3. **Controlled velocity** (physical). `target = w × topSpeedLocal × profile.speedMultiplier × size`. `rate = |target| > |v| ? acceleration : braking` (× `size`). `v` moves toward `target` by at most `rate × dt` (as a vector). Ground modes keep `v.y = 0`. During an arc, `v.y = 0` (the arc owns the controlled vertical motion).
4. **Desired orientation** (not committed). Facing source: `move` → the wish; `aim` → `ctx.aim` when set, else the wish; `lock-during-action` → the current orientation while `ctx.actionLock`, else the wish. Yaw target `atan2(f.x, f.z)` (only when the horizontal part exceeds .05); pitch target `asin(f.y / |f|)` clamped to ±1.2 when `caps.pitch`, else 0. Each moves by at most `maxYawRate × dt` / `maxPitchRate × dt` (shortest arc for yaw).
5. **Displacement.** `d = (v + rt.externalVelocity) × dt`. The vertical part has one owner, and external motion **accumulates** (it is never servoed away):
   - **Arc:** `arcY(u) = lerp(fromY, endY, u) + sin(uπ) × (surface + BREACH_RISE × size − max(fromY, endY))`, `endY = surface − BREACH_END_DEPTH × size`, `u(t) = min(1, (t − startedAt) / duration)`. `d.y = arcY(u(now + dt)) − arcY(u(now)) + externalVelocity.y × dt` (the arc's own change plus the external change).
   - **Ground modes** (no arc): the runtime keeps `rt.groundOffset` (≥ 0, the height above the support line; add it to `CombatRuntime` in B2 with default 0, reset by `resetRuntime`). `offset' = max(0, offset × exp(−GROUND_SETTLE × dt) + externalVelocity.y × dt)` with `GROUND_SETTLE = 6` (the explicit reattachment rule); `d.y = supportHeight(actor, position.x + d.x, position.z + d.z, rt.orientation) + .01 × L + offset' − position.y`; after the motion, `rt.groundOffset = max(0, result.position.y − (supportHeight(actor, result.position.x, result.position.z, result.orientation) + .01 L))` — measured against the support under the **installed** pose, not the requested one.
6. **Motion.** `resolveMotion({ actorId: 'player', from: position, displacement: d, orientation: rt.orientation, turn: desired, hull: actor.hull, habitatProfileId: actor.habitat.id, cause: 'locomotion', traversalPermit: rt.permit }, { queries, actor, bounds, interval: { start: now, end: now + dt } })`.
7. **Commit.** `rt.orientation = result.orientation` (only the resolver's orientation). `rt.controlledVelocity = projectVelocity(v, contacts)`; `rt.externalVelocity = projectVelocity(rt.externalVelocity, contacts) × exp(−EXTERNAL_DECAY × dt)`. The two owners are projected separately; their sum is never stored.
8. **Ends.** If the arc reached `u = 1`: `rt.arc = null`, `arcEnded = true`. If `rt.permit` and `now + dt ≥ expiresAt`: `rt.permit = null`, `permitEnded = true`, and the landing check runs: `overlapHull(actor, result.position, rt.orientation, { time: now + dt, bounds })` without a permit; a failure sets `needsRecovery`.
9. `needsRecovery` is also true for `invalid-start` and `needs-recovery` results. The caller recovers with the actual orientation and bounds (C4).

**`blockHint(plan, contact)`** by constraint: `bounds-x`, `bounds-z` → "That's the edge of the world for now."; `bounds-y` → "That's as high as you can go for now."; `ground` → "Something solid is in the way."; `surface-top` → "`<Plan>`s can't leave the water."; `air` → "`<Plan>`s can't fly."; `land-band` → "`<Plan>`s can't go on land."; `floor-gap` → "`<Plan>`s stay on the seabed."; `depth` → "`<Plan>`s stay in shallow water."; anything else → "`<Plan>`s can't go there."

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/player-motion.test.ts
import { describe, expect, it } from 'vitest';
import { blockHint, stepPlayer, type PlayerStepContext } from '../../src/tiny-tide/player-motion';
import { breachPermit, habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { newRuntime, type Actor, type CombatInput, type MovementProfile, type Terrain, type Vec3 } from '../../src/tiny-tide/combat-types';
import { RELEASED } from '../../src/tiny-tide/input';
import { plan } from '../../src/tiny-tide/plans';
import { makeWorldQueries, supportHeight } from '../../src/tiny-tide/world-queries';
import { forwardOf } from '../../src/tiny-tide/orientation';

const sea = (surface = 85): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });
const deep: Terrain = { groundAt: () => -1e6, surface: 1e6, space: false, slopeBound: 0 };
const ball = (id: string, r: number, L: number): Actor => ({ id: 'player', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r }], habitat: habitat(id), bodyLength: L });
const rod: Actor = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat('open-water'), bodyLength: 2 };
const ctxFor = (planId: string, actor: Actor, t: Terrain, over: Partial<PlayerStepContext> = {}): PlayerStepContext => {
  const p = plan(planId)!;
  return { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: makeWorldQueries(t), bounds: { half: 1e6 }, size: 4, topSpeedLocal: 6.5,
    now: 0, dt: .1, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, ...over };
};
const intent = (over: Partial<CombatInput> = {}): CombatInput => ({ ...RELEASED, ...over });

describe('player step: velocities', () => {
  it('accelerates and brakes in physical units', () => {
    const rt = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, rt, intent(), ctxFor('bulk', ball('open-water', 2, 10), sea(), { wish: { x: 0, y: 0, z: 1 } }));
    expect(rt.controlledVelocity.z).toBeCloseTo(5.6);   // accel 14 × 4 × .1
    const r2 = newRuntime(); r2.controlledVelocity.z = 10; stepPlayer({ x: 0, y: 40, z: 0 }, r2, intent(), ctxFor('bulk', ball('open-water', 2, 10), sea()));
    expect(r2.controlledVelocity.z).toBeCloseTo(6);     // braking 10 × 4 × .1
  });
  it('rises from rest, and never vertically for ground modes', () => {
    const rt = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', 2, 10), sea(), { dt: 1 / 60 }));
    expect(rt.controlledVelocity.y).toBeCloseTo(1.6);   // 24 × 4 / 60
    const c = newRuntime(); stepPlayer({ x: 0, y: 2.6, z: 0 }, c, intent({ traversal: 'rise' }), ctxFor('crawler', ball('seabed', 2.5, 10), sea()));
    expect(c.controlledVelocity.y).toBe(0);
  });
  it('normalizes a diagonal plus rise to the top speed', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 40, z: 0 };
    for (let i = 0; i < 120; i++) p = stepPlayer(p, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', .5, 2), deep, { now: i / 60, dt: 1 / 60, wish: { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 } })).position;
    const v = rt.controlledVelocity; expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(26 + 1e-9); expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(25);   // 6.5 × 1 × 4
  });
  it('decays an impulse without input and never grows it, at every size', () => {
    for (const size of [1, 4, 16, 64, 256]) {
      const rt = newRuntime(); rt.externalVelocity.x = 10 * size; let p: Vec3 = { x: 0, y: 0, z: 0 }, last = Infinity;
      for (let i = 0; i < 60; i++) {
        p = stepPlayer(p, rt, intent(), ctxFor('swimmer', ball('open-water', .3 * size, 2 * size), deep, { size, now: i / 60, dt: 1 / 60 })).position;
        const speed = Math.hypot(rt.controlledVelocity.x + rt.externalVelocity.x, rt.controlledVelocity.y + rt.externalVelocity.y, rt.controlledVelocity.z + rt.externalVelocity.z);
        expect(speed).toBeLessThan(last); last = speed;
      }
      expect(p.x / size).toBeCloseTo(1.74706, 3);   // Σ 10 e^(−.1k) / 60, k = 0…59
      expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 });
    }
  });
  it('removes an impulse into a wall once, and the rest still decays', () => {
    const wall: Terrain = { groundAt: x => x > .5 ? 30 : 0, surface: 85, space: false, slopeBound: 0 };
    const rt = newRuntime(); rt.externalVelocity.x = 5; let p: Vec3 = { x: 0, y: 10, z: 0 };
    for (let i = 0; i < 10; i++) { p = stepPlayer(p, rt, intent(), ctxFor('swimmer', ball('open-water', .3, 2), wall, { now: i / 10 })).position; expect(p.x).toBeLessThanOrEqual(.2 + 1e-6); expect(Math.hypot(rt.externalVelocity.x, rt.externalVelocity.y)).toBeLessThanOrEqual(5); }
    expect(rt.externalVelocity.x).toBeLessThan(.01);
  });
});
describe('player step: turning and facing', () => {
  it('stops a turn at a wall without asking for recovery', () => {
    const wall: Terrain = { groundAt: x => x > .8 ? 30 : 0, surface: 85, space: false, slopeBound: 0 }, fast: MovementProfile = { ...movement('swimmer'), maxYawRate: 100 };
    const rt = newRuntime(), r = stepPlayer({ x: 0, y: 10, z: 0 }, rt, intent(), ctxFor('swimmer', rod, wall, { profile: fast, wish: { x: 1, y: 0, z: 0 } }));
    expect(r.needsRecovery).toBe(false); expect(r.status).not.toBe('invalid-start'); expect(rt.orientation.yaw).toBeGreaterThan(0); expect(rt.orientation.yaw).toBeLessThanOrEqual(3 * Math.PI / 28 + 1e-9);
  });
  it('pitches the nose up for upward intent', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 40, z: 0 };
    for (let i = 0; i < 30; i++) p = stepPlayer(p, rt, intent({ traversal: 'rise' }), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { now: i / 60, dt: 1 / 60, wish: { x: 0, y: 0, z: 1 } })).position;
    expect(rt.orientation.pitch).toBeGreaterThan(0); expect(forwardOf(rt.orientation).y).toBeGreaterThan(0);
  });
  it('faces the aim, and holds facing only while an action locks it', () => {
    const aimP: MovementProfile = { ...movement('swimmer'), facing: 'aim' }, lockP: MovementProfile = { ...movement('swimmer'), facing: 'lock-during-action' };
    const a = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, a, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: aimP, aim: { x: 1, y: 0, z: 0 }, wish: { x: 0, y: 0, z: 1 } })); expect(a.orientation.yaw).toBeCloseTo(.8);   // 8 rad/s × .1 toward +X
    const b = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, b, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: lockP, actionLock: true, wish: { x: 1, y: 0, z: 0 } })); expect(b.orientation.yaw).toBe(0);
    const c = newRuntime(); stepPlayer({ x: 0, y: 40, z: 0 }, c, intent(), ctxFor('swimmer', ball('open-water', .5, 2), sea(), { profile: lockP, actionLock: false, wish: { x: 1, y: 0, z: 0 } })); expect(c.orientation.yaw).toBeCloseTo(.8);
  });
  it('keeps a grounded body at its support height while it moves', () => {
    const slope: Terrain = { groundAt: x => .2 * x, surface: 85, space: false, slopeBound: .2 }, a = ball('seabed', .3, 2), rt = newRuntime();
    const start = { x: 0, y: supportHeight(a, 0, 0, { yaw: 0, pitch: 0 }, slope) + .02, z: 0 };
    const r = stepPlayer(start, rt, intent(), ctxFor('crawler', a, slope, { size: 1, wish: { x: 1, y: 0, z: 0 } }));
    expect(r.position.x).toBeGreaterThan(0); expect(r.position.y).toBeCloseTo(supportHeight(a, r.position.x, 0, rt.orientation, slope) + .02, 3);
  });
});
describe('player step: Breach', () => {
  const darter = (t = sea()) => ctxFor('darter', ball('open-water', 2, 10), t, { size: 16, now: 10 });
  it('starts an arc and a permit once, only for plans that can breach', () => {
    const rt = newRuntime(), r = stepPlayer({ x: 0, y: 70, z: 0 }, rt, intent({ traversal: 'breach' }), darter());
    expect(r.breachStarted).toBe(true); expect(rt.permit).toEqual(breachPermit(10)); expect(rt.breachReadyAt).toBeCloseTo(12.3); expect(rt.arc).toMatchObject({ startedAt: 10, fromY: 70 });
    expect(r.position.y).toBeCloseTo(82.8403, 3);   // 70 − 5.8 × .0556 + sin(π/18) × 75.8
    expect(stepPlayer(r.position, rt, intent({ traversal: 'breach' }), { ...darter(), now: 10.1 }).breachStarted).toBe(false);
    const c = newRuntime(); expect(stepPlayer({ x: 0, y: 2.6, z: 0 }, c, intent({ traversal: 'breach' }), ctxFor('crawler', ball('seabed', 2.5, 10), sea())).breachStarted).toBe(false); expect(c.permit).toBeNull();
  });
  it('accumulates external vertical motion on top of the arc', () => {
    const rt = newRuntime(); rt.externalVelocity.y = 5;
    const a = stepPlayer({ x: 0, y: 70, z: 0 }, rt, intent({ traversal: 'breach' }), darter()); expect(a.position.y).toBeCloseTo(83.3403, 3);   // + 5 × .1
    const b = stepPlayer(a.position, rt, intent(), { ...darter(), now: 10.1 });
    expect(b.position.y).toBeCloseTo(96.0551, 3);   // arcY(.2/1.8) = 95.2807, plus .5 + 5e^(−.6) × .1 = .7744
  });
  it('measures the ground offset against the installed pose after a wall stops the move', () => {
    const slope: Terrain = { groundAt: x => .2 * x, surface: 85, space: false, slopeBound: .2 }, a = ball('seabed', .3, 2), rt = newRuntime(), o = { yaw: 0, pitch: 0 };
    const start = { x: 0, y: supportHeight(a, 0, 0, o, slope) + .02, z: 0 }; rt.externalVelocity.y = 10; rt.externalVelocity.x = 50;   // pushed up and into the x bound at .5
    const r = stepPlayer(start, rt, intent(), ctxFor('crawler', a, slope, { size: 1, bounds: { half: .8 } }));
    expect(r.position.x).toBeLessThanOrEqual(.5 + 1e-9);
    expect(rt.groundOffset).toBeCloseTo(Math.max(0, r.position.y - (supportHeight(a, r.position.x, 0, rt.orientation, slope) + .02)), 9);
  });
  it('lets an upward push lift a grounded body and settle it back, nearly the same at 60 and 120 Hz', () => {
    const at = (hz: number) => { const rt = newRuntime(), a = ball('seabed', .3, 2), sup = supportHeight(a, 0, 0, { yaw: 0, pitch: 0 }, sea()) + .02; rt.externalVelocity.y = 5; let p: Vec3 = { x: 0, y: sup, z: 0 };
      for (let i = 0; i < Math.round(.3 * hz); i++) p = stepPlayer(p, rt, intent(), ctxFor('crawler', a, sea(), { size: 1, now: i / hz, dt: 1 / hz })).position; return p.y - sup; };
    const o60 = at(60), o120 = at(120);
    expect(o60).toBeCloseTo(1.5 * Math.exp(-1.8 + 6 / 60), 3); expect(Math.abs(o60 - o120) / o120).toBeLessThan(.06);   // offset_n = 5 h n e^(−6(n−1)h)
  });
  it('ends the permit by time and asks for a landing when the body is still in the air', () => {
    const rt = newRuntime(); rt.permit = { id: 'breach', startsAt: 9, expiresAt: 10.05, media: ['air'], landingRequired: true };
    const r = stepPlayer({ x: 0, y: 90, z: 0 }, rt, intent(), darter()); expect(r.permitEnded).toBe(true); expect(rt.permit).toBeNull(); expect(r.needsRecovery).toBe(true);
  });
  it('lands in the water at the end of a full arc', () => {
    const rt = newRuntime(); let p: Vec3 = { x: 0, y: 70, z: 0 }, ended = false;
    for (let i = 0; i < 20; i++) { const r = stepPlayer(p, rt, intent(i === 0 ? { traversal: 'breach' } : {}), { ...darter(), now: 10 + i / 10 }); p = r.position; ended ||= r.arcEnded; expect(r.needsRecovery).toBe(false); }
    expect(ended).toBe(true); expect(rt.arc).toBeNull(); expect(rt.permit).toBeNull(); expect(p.y).toBeCloseTo(85 - 1.3 * 16, 3);
  });
});
describe('block hints', () => {
  it('explains each constraint', () => {
    const c = (constraint: string) => ({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: -1, z: 0 }, constraint: constraint as never, distanceFraction: 0, time: 0 });
    expect(blockHint(plan('swimmer')!, c('surface-top'))).toBe("Swimmers can't leave the water."); expect(blockHint(plan('crawler')!, c('floor-gap'))).toBe('Crawlers stay on the seabed.');
    expect(blockHint(plan('swimmer')!, c('bounds-x'))).toBe("That's the edge of the world for now."); expect(blockHint(plan('swimmer')!, c('ground'))).toBe('Something solid is in the way.');
  });
});
```

Hand checks:
- **Breach first frame:** `u = .1 / 1.8 = .0556`, `endY = 85 − 1.3 × 16 = 64.2`, the rise term is `85 + 3.8 × 16 − max(70, 64.2) = 75.8`; `y = 70 + (64.2 − 70) × .0556 + sin(.1745) × 75.8 = 70 − .3222 + 13.1625 = 82.8403`.
- **Full arc:** at `u = 1` the body is at `endY = 64.2` (water), so the permit can end without recovery.
- **Impulse:** the step uses the external velocity at the start of the frame, then decays it by `e^(−.1)`; the sum is `(1/6)(1 − e^(−6)) / (1 − e^(−.1)) = 1.74706`.
- **Arc, frame 2:** `u = .2/1.8 = .1111`: `70 − 5.8 × .1111 + sin(.3491) × 75.8 = 69.3556 + 25.9251 = 95.2807`; the external part is `.5` (frame 1) `+ 5 × e^(−.6) × .1 = .2744`.
- **Grounded push:** with `o' = o e^(−6h) + v h` and `v = 5 e^(−6t)`, `o_n = 5 h n e^(−6(n−1)h)`; at `t = .3`, 60 Hz gives `1.5 e^(−1.7) = .27403` and 120 Hz `1.5 e^(−1.75) = .26066` (5 % apart).
- **Aim:** `facing: 'aim'` turns toward `+X` (yaw π/2) at 8 rad/s, so `.8` after `.1` s.

- [ ] **Step 2: Implement and run.** Expected: PASS, every test in the file.

- [ ] **Step 3: Checkpoint and commit**

```bash
git add src/tiny-tide/player-motion.ts tests/tiny-tide-core/player-motion.test.ts
git commit -m "Tiny Tide: one pure player step with owned velocities, swept turning and Breach"
```

---

### Task C3: Lifecycle transitions and damage resolution

**Files:**
- Create: `src/tiny-tide/lifecycle.ts`
- Test: `tests/tiny-tide-core/lifecycle.test.ts`

**Interfaces:**
- Consumes: Plan A `faint`, `maxHealthOf`, `evolveReady`, `eligibleChildren`; B2 `DesignDelta`, `newRuntime`; B4 `findRecoveryPose`; B6 `EcoEvent`.
- Produces:
  - `resetRuntime(rt, orientation = { yaw: rt.orientation.yaw, pitch: 0 })`: both velocities to zero, `actions = []`, `cooldowns.clear()`, `permit = null`, `arc = null`, `breachReadyAt = 0`, `invulnerableUntil = 0`, `staggerUntil = 0`, `guardProfileId = null`, `targetable = perceivable = damageable = true`, `groundOffset = 0`, orientation as given.
  - `beginRespawn(run, rt): boolean`: if `run.pendingRespawn`, return `false` and change nothing. Otherwise `faint(run)` (Plan A: loss, `deaths++`, `pendingRespawn = true`), `resetRuntime(rt)`, return `true`. The caller saves at once, before the animation.
  - `resolveRespawn(run, rt, now, anchor: RecoveryResult): boolean`: `false` when not pending or when `!anchor.ok` (still pending; the caller retries). Otherwise `health = maxHealthOf(run)`, `pendingRespawn = false`, `resetRuntime(rt, anchor.orientation)` (the orientation the anchor was validated with), `invulnerableUntil = now + 3`, return `true`. The caller installs `anchor.position` (computed for the **actual** growth) and saves.
  - `recoverPlayer(actor, position, orientation, ctx: LegalityContext & { time }, anchor: RecoveryResult, maxDistance): RecoveryResult` — in order: `findRecoveryPose` at the current orientation; then at `{ yaw: orientation.yaw, pitch: 0 }` (a level body fits where a pitched one cannot); then the anchor **revalidated** with its own orientation for this actor, time and bounds. Otherwise `{ ok: false }`. The caller installs position **and** orientation together, or keeps an explicit stuck state (C4); it never installs a pose that failed.
  - `reconcileAfterCommit(rt, delta, genome, actorId, now, catalogs: Pick<Catalogs, 'parts' | 'attacks' | 'abilities'> = defaultCatalogs())`: removes actions whose `source` is a part emitter listed in `delta.removedEmitters` or `delta.changedEmitters` (`uid:copy:socketId` match). A removed action whose part and grant survive **reserves its cooldown**: `cooldowns.set(\`${actorId}:${uid}:${action.grantId}\`, max(existing, now + spec.cooldownSeconds))`, with `spec` = the attack or ability `definitionId` names (so an edit never refreshes a just-used weapon). Then it removes every cooldown `actorId:uid:grant` whose part is gone from `genome` or whose catalog spec has no grant (basic or active) with that id; it keeps every other cooldown. (`ActionState` gains `grantId: string` in B2.)
  - `resolveHazards(events, ctx: { mode: string; pendingRespawn: boolean; rt: CombatRuntime; now: number; mass: number; resistance: number }): EcoEvent[]` — sorts by `(time, entity.id)`; accepts an event only when `mode === 'playing'`, `!pendingRespawn`, `rt.damageable`, and `now ≥ rt.invulnerableUntil`; on acceptance sets `rt.invulnerableUntil = now + hazard.invulnerabilitySeconds` (so a second event in the same tick or window is rejected) and adds `normal × impulse / mass × (1 − resistance)` to `rt.externalVelocity`. Returns the accepted events in order.
  - `evolutionDestination(actor, here, ctx: LegalityContext & { orientation; time }, anchor: Vec3)`: `findRecoveryPose(actor, here, ctx, { maxDistance: 30 × L, anchor })`.
  - `canChooseNextPlan(run, build, plans?)`: `evolveReady(run)` and at least one eligible child.

Pause and canceled edit keep the runtime exactly (spec §9): `main.ts` does not step it in those modes; C11 checks it in the browser.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/lifecycle.test.ts
import { describe, expect, it } from 'vitest';
import { beginRespawn, canChooseNextPlan, evolutionDestination, reconcileAfterCommit, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn } from '../../src/tiny-tide/lifecycle';
import { defaultCatalogs } from '../../src/tiny-tide/registries';
import { newRuntime, type CombatRuntime } from '../../src/tiny-tide/combat-types';
import { designDelta } from '../../src/tiny-tide/design-delta';
import { Ecosystem, type EcoEvent } from '../../src/tiny-tide/ecosystem';
import { freshRun, maxHealthOf, STAGES } from '../../src/tiny-tide/state';
import { PLANS, plan } from '../../src/tiny-tide/plans';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { starterFor, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { playerActor } from '../../src/tiny-tide/mount';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { REGISTRY_HAZARDS, syntheticAttack } from './helpers';
import { habitat } from '../../src/tiny-tide/profiles';

const action = (uid: string, copy: 0 | 1) => ({ instanceId: `${uid}${copy}`, definitionId: 'pinch', grantId: 'snap', source: { kind: 'part' as const, partUid: uid, copy, socketId: 'pinch' }, phase: 'windup' as const, startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map() });
const busy = (): CombatRuntime => { const rt = newRuntime({ yaw: 1, pitch: .4 }); Object.assign(rt.controlledVelocity, { x: 1, y: 0, z: 0 }); Object.assign(rt.externalVelocity, { x: 0, y: 2, z: 0 });
  rt.permit = { id: 'breach', startsAt: 0, expiresAt: 2, media: ['air'], landingRequired: true }; rt.arc = { startedAt: 0, duration: 1.8, fromY: 3 }; rt.breachReadyAt = 2.3;
  rt.staggerUntil = 4; rt.guardProfileId = 'g'; rt.damageable = false; rt.cooldowns.set('player:p5:snap', 5); rt.actions.push(action('p5', 0), action('p5', 1)); return rt; };
const claw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
const grant: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
const hazardEvent = (e: EcoEvent['entity'], time: number): EcoEvent => ({ type: 'hazard', entity: e, hazard: REGISTRY_HAZARDS['crab-pinch']!, damage: 3, point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, time });

describe('lifecycle', () => {
  it('resets every transient field', () => {
    const rt = busy(); resetRuntime(rt);
    expect(rt).toMatchObject({ permit: null, arc: null, breachReadyAt: 0, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null, damageable: true, targetable: true, perceivable: true, actions: [], orientation: { yaw: 1, pitch: 0 } });
    expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.externalVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.cooldowns.size).toBe(0);
  });
  it('faints once, even when called twice, and resolves once with a legal anchor', () => {
    const run = freshRun(1), rt = busy(), before = structuredClone(run.economy);
    expect(beginRespawn(run, rt)).toBe(true); const after = structuredClone(run.economy);
    expect(beginRespawn(run, rt)).toBe(false); expect(run.economy).toEqual(after); expect(run.deaths).toBe(1); expect(after).not.toEqual(before);
    const anchor = { ok: true as const, position: { x: 0, y: 1, z: 0 }, orientation: { yaw: 0, pitch: 0 } };
    expect(resolveRespawn(run, rt, 10, { ok: false, reason: 'none' })).toBe(false); expect(run.pendingRespawn).toBe(true);
    expect(resolveRespawn(run, rt, 10, anchor)).toBe(true); expect(run.health).toBe(maxHealthOf(run)); expect(rt.invulnerableUntil).toBe(13);
    expect(rt.orientation).toEqual({ yaw: 0, pitch: 0 });   // the anchor's checked orientation, not the retained yaw 1
    expect(resolveRespawn(run, rt, 11, anchor)).toBe(false);
  });
  const cats = { ...defaultCatalogs(), parts: grant, attacks: { pinch: { ...syntheticAttack, cooldownSeconds: 1 } } };
  it('cancels actions of removed and changed emitters, and keeps cooldowns whose grant survives', () => {
    const rt = busy(), kept = claw({ mirror: false }); reconcileAfterCommit(rt, designDelta(claw(), kept, { active: [null, null] }, grant), kept, 'player', 0, cats);
    expect(rt.actions).toEqual([]); expect([...rt.cooldowns.keys()]).toEqual(['player:p5:snap']);   // copy 1 removed, copy 0 changed; the grant still exists
    const rt2 = busy(), swapped = claw({ id: 'spike', mirror: false }); reconcileAfterCommit(rt2, designDelta(claw(), swapped, { active: [null, null] }, grant), swapped, 'player', 0, cats);
    expect(rt2.cooldowns.size).toBe(0);   // same uid, catalog replacement without the grant
    const rt3 = busy(); reconcileAfterCommit(rt3, designDelta(claw(), claw(), { active: [null, null] }, grant), claw(), 'player', 0, cats); expect(rt3.actions).toHaveLength(2);
  });
  it('reserves the cooldown of an interrupted action whose grant survives', () => {
    const rt = newRuntime(); rt.actions.push(action('p5', 0)); const moved = claw({ t: .5 });
    reconcileAfterCommit(rt, designDelta(claw(), moved, { active: [null, null] }, grant), moved, 'player', 10, cats);
    expect(rt.actions).toEqual([]); expect(rt.cooldowns.get('player:p5:snap')).toBe(11);   // 10 + cooldown 1, though the map was empty
  });
  it('recovers a pitched long body by levelling it, and never returns an unchecked anchor', () => {
    const shallow = makeWorldQueries({ groundAt: () => 0, surface: 1.2, space: false, slopeBound: 0 });
    const rod = { id: 'player', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat('open-water'), bodyLength: 2 };
    const bad = { ok: true as const, position: { x: 0, y: 5, z: 0 }, orientation: { yaw: 0, pitch: 0 } };
    const r = recoverPlayer(rod, { x: 0, y: .6, z: 0 }, { yaw: .5, pitch: 1.2 }, { queries: shallow, time: 0 }, bad, 4);   // pitched span 2 sin 1.2 + .6 > 1.2
    expect(r).toMatchObject({ ok: true, position: { x: 0, y: .6, z: 0 }, orientation: { yaw: .5, pitch: 0 } });
    const none = makeWorldQueries({ groundAt: () => 0, surface: .5, space: false, slopeBound: 0 });   // nothing fits; the anchor is rechecked and refused
    expect(recoverPlayer(rod, { x: 0, y: .3, z: 0 }, { yaw: 0, pitch: 0 }, { queries: none, time: 0 }, bad, 4).ok).toBe(false);
  });
  it('accepts one hit per invulnerability window, in order, only while playing and damageable', () => {
    const crabs = new Ecosystem(7).entities.filter(e => e.spec.key === '1:crab'), [a, b] = [crabs[0]!, crabs[1]!];
    const ctx = (rt: CombatRuntime, now: number, over = {}) => ({ mode: 'playing', pendingRespawn: false, rt, now, mass: 4, resistance: .5, ...over });
    const rt = newRuntime(); const first = resolveHazards([hazardEvent(b, 0), hazardEvent(a, 0)], ctx(rt, 0));
    expect(first.map(e => e.entity)).toEqual([a.id < b.id ? a : b]); expect(rt.invulnerableUntil).toBeCloseTo(.8); expect(rt.externalVelocity.x).toBeCloseTo(0);   // impulse 0 today
    expect(resolveHazards([hazardEvent(a, .5)], ctx(rt, .5))).toEqual([]); expect(resolveHazards([hazardEvent(b, .9)], ctx(rt, .9))).toHaveLength(1);
    expect(resolveHazards([hazardEvent(a, 5)], ctx(newRuntime(), 5, { mode: 'evolving' }))).toEqual([]);
    expect(resolveHazards([hazardEvent(a, 5)], ctx(newRuntime(), 5, { pendingRespawn: true }))).toEqual([]);
    const off = newRuntime(); off.damageable = false; expect(resolveHazards([hazardEvent(a, 5)], ctx(off, 5))).toEqual([]);
  });
  it('applies an impulse through mass and resistance', () => {
    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime(), e = { ...hazardEvent(crab, 0), hazard: { ...REGISTRY_HAZARDS['crab-pinch']!, impulse: 2 } };
    resolveHazards([e], { mode: 'playing', pendingRespawn: false, rt, now: 0, mass: 4, resistance: .5 }); expect(rt.externalVelocity.x).toBeCloseTo(.25);   // 2 / 4 × .5
  });
  it('finds a legal evolution destination away from an illegal start, or uses the anchor', () => {
    const p = plan('shellback')!, actor = playerActor(p, starterFor(p), 2, 1), q = makeWorldQueries(makeTerrain(2)), here = { x: 0, y: 80, z: 0 };
    const r = evolutionDestination(actor, here, { queries: q, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { x: 0, y: 0, z: 0 });
    expect(r.ok).toBe(true); if (!r.ok) return; expect(r.position.y).toBeLessThan(here.y);
    expect(q.overlapHull(actor, r.position, r.orientation, { time: 0 }).ok).toBe(true);
  });
  it('allows evolution only when ready and a child is eligible', () => {
    const run = freshRun(1); expect(canChooseNextPlan(run, { coast: false })).toBe(false);
    run.stageDna = STAGES[0]!.goal; expect(canChooseNextPlan(run, { coast: false })).toBe(true);
    expect(canChooseNextPlan(run, { coast: false }, PLANS.filter(p => p.size === 0))).toBe(false);
  });
});
```

Create `tests/tiny-tide-core/helpers.ts` with `export { HAZARDS as REGISTRY_HAZARDS } from '../../src/tiny-tide/registries';` and `export const syntheticAttack` (the `pinch` attack object from B2's contract test, typed `AttackSpec`), so test files share them.

The Shellback is a size-2 seabed body; at `y = 80` it is far above its floor band (and its top is above the surface), so the destination is lower.

- [ ] **Step 2: Implement and run.** Expected: PASS, every test in the file.

- [ ] **Step 3: Checkpoint and commit**

```bash
git add src/tiny-tide/lifecycle.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/helpers.ts
git commit -m "Tiny Tide: lifecycle transitions, one respawn and pure damage resolution"
```

---

### Task C4: The game loop uses the new services

**Files:**
- Modify: `src/tiny-tide/main.ts`, `src/tiny-tide/world.ts`
- Modify: `e2e/tiny-tide.mjs`, `e2e/tiny-tide-mobile.mjs` (braking-aware checks)

**Integration rules (each is a reviewed requirement):**

1. **Legality and anchors.**
   - `legality(stage)` caches `{ queries: makeWorldQueries(makeTerrain(stage)), bounds: { half: PLAYER_HALF × SIZES[stage], maxY: stage >= 3 ? 30 × SIZES[stage] : undefined } }`. The `maxY` replaces today's size-3/4 sky clamp.
   - `const BUILD: Build = { coast: COAST_READY, anchorCheck: (g, p) => [1, 1.38].every(growth => startAnchor(playerActor(p, g, p.size, growth), p.size, legality(p.size)).ok) }` (spec §3: both growths).
2. **Effective stats.** `refreshDerived()` uses `derive(effectiveStats(run.genome, currentPlan(run)))`. (The `statsOf` alias is removed in C8, after the editor's last use.)
3. **One runtime owner.** `let rt = newRuntime()`. Delete `leap`, `leapStart`, `leapCooldown` and `grace`; the arc, the Breach cooldown and invulnerability live in `rt`. `begin()` (new run or load) creates a **fresh** runtime; `invulnerableUntil = time + 2` keeps today's start grace (QA: `?qaStartGrace=0` sets it to 0, read once at load).
4. **One authoritative root transform (C-R4-10).** The simulation owns the player's physical position, orientation and **exact** growth each tick. `playerActorCached()` rebuilds its hull only when `${plan.id}:${genomeRevision}:${stage}` changes (`genomeRevision` increases on every commit); when growth changes, it rescales the cached hull buffers in place to the exact growth (no bucket). In `world.ts`, delete the `player.scale` easing toward growth and the `avatar.position.y` bob: the rendered root is set from the simulation every frame (`scale = growth`), so the rendered body, the admitted hull and `sampleCombatPose` (given `world = T(position) · orientationMatrix(o) · S(SIZES[stage] × growth)`) use one transform. The transformation during `evolving` may ease the scale (presentation only; hazards are rejected in that mode).
   - The start anchor for the current actor is computed when needed (fallback, respawn) for the exact growth, not cached across growth changes.
5. **One input consumer.**
   - `holdButton('chomp', setter)` and `holdButton('special', setter)` lose their immediate callbacks; the special button sets `riseHeld` and, on pointerdown, `riseTapped`. Keydown `KeyE` (non-repeat) sets `riseTapped` instead of calling `special()`. Delete `special()`.
   - Each playing frame: `intent = readIntent(sources, lastIntent, { breachOnRiseTap: caps.breach })`; clear the tap flags; `lastIntent = intent`.
   - The only bite call: `if (basicRequested(intent)) chomp()` (its cooldown still gates repeats).
   - Pause, edit, blur, `pointercancel`, lost capture: `clearInput()` and `lastIntent = RELEASED`.
6. **Player step.** Each playing frame, after input:
   - `wish` = the click target direction (normalized, horizontal, only when `caps.ground`) or `world.moveVector(dx, dz, caps.pitch)`; any manual input clears the target, as today.
   - `const r = stepPlayer(physical, rt, intent, { plan, profile, caps, actor, ...legality(stage), size, topSpeedLocal: STAGES[stage].speed × derived.speedFactor, now: time, dt, wish, aim: null, actionLock: false })`.
   - `world.player.position = r.position / scale`; `world.player.rotation.y = rt.orientation.yaw`; `world.avatar.rotation.x = −rt.orientation.pitch`. Delete today's position clamps and the old leap code.
   - If `r.needsRecovery`: `const rec = recoverPlayer(actor, r.position, rt.orientation, { ...legality(stage), time: time + dt }, startAnchor(actor, stage, legality(stage)), 20 × L)`. On success install **both** `rec.position` and `rt.orientation = rec.orientation`, recompute `rt.groundOffset` against the support under the installed pose (0 for a supported anchor), clear `rt.permit` and `rt.arc`, project both velocities to zero along any axis that pointed out of the legal region (simplest: zero them), and re-render both rotations. On failure, enter mode `stuck`: clear input; the simulation does not step the player; a separate `stuckRetry` countdown driven by the frame `dt` (the game clock does not run in `stuck`) retries recovery once per second; the toast reads "Stuck — finding you a safe spot…"; play resumes only after an admitted full pose is installed. Never install a pose that failed. After an edit or a growth change rescales the hull, recompute `rt.groundOffset` the same way.
   - `r.breachStarted` plays the Breach sound and splash; `r.arcEnded` plays the landing splash.
7. **Hints.** When `r.contacts[0]` exists and `hintClock <= 0`: toast `blockHint(plan, contact)` and set `hintClock = 6`. `hintClock` decreases by the playing `dt`. `contactNow` (diagnostics) is true only on frames with a contact.
8. **Controls and text follow capabilities.** `#vertical-controls` hidden when `!caps.rise && !caps.breach`; `#special` shows `BREACH` when `caps.breach`, else `RISE` when `caps.rise`, else hidden; `#dive` hidden when `!caps.dive`; `objective()` mentions Breach only when `caps.breach`; the depth hint uses `caps.ground`; tap-to-move works when `caps.ground`; the special button shows its cooldown from `rt.breachReadyAt`.
9. **Ecosystem.** Each frame in `playing`, `evolving` or `fainted`: `world.eco.step({ stage, dt, now: time, player: physical, playerHull: orientHull(actor.hull, rt.orientation) translated to physical, perceivable: rt.perceivable && mode !== 'fainted', stealthFactor })`.
10. **Hazards.** `accepted = resolveHazards(events, { mode, pendingRespawn: run.pendingRespawn, rt, now: time, mass, resistance })`. Count `acceptedHits` and `rejectedHits` (diagnostics). For each accepted event, `takeHit(event)`: floater, `hurt(run, event.damage, derived.armor)`, hearts. On a faint: `if (beginRespawn(run, rt)) { save(); mode = 'fainted'; record faintLog { time, hadPermit, hadArc } (from before the reset) }`; after 1.8 s: `anchor = startAnchor(actor at the actual growth, stage, legality(stage))`; if `resolveRespawn(run, rt, time, anchor)` returns true, install `anchor.position` with the orientation it set, then `save()`. If the anchor fails, keep `fainted`, retry each second, and toast once.
11. **Load.** If the loaded run has `pendingRespawn`, resolve it the same way before play starts, and save.
12. **Evolution (until C7 replaces the screen).** In today's evolve flow: after `prepareEvolution` succeeds, compute `evolutionDestination(playerActor(next, g, next.size, 1), here, { ...legality(next.size), orientation: { yaw: rt.orientation.yaw, pitch: 0 }, time }, anchor)`; if it fails, toast "This body can't fit anywhere here." and change nothing. Otherwise `commitEvolution`, `resetRuntime(rt)`, `world.transform(stage, genome, destination)`. The transformation is presentation only; `resolveHazards` rejects everything while `mode === 'evolving'`. At the end, the body is at the destination; if it is not admitted (the world changed), recover.
13. **Edit commits.** Before `applyDesign`, keep the old genome and loadout; after success: `reconcileAfterCommit(rt, designDelta(old, run.genome, oldLoadout), run.genome, 'player', time)` (`time` is the simulation clock, stopped while editing; never wall time or 0), `genomeRevision++`, and recover if the new hull is not admitted at the current pose.
14. **Diagnostics** (read-only): `plan`, `plans`, `zone`, `velocity` (controlled), `externalVelocity`, `orientation`, `permit`, `arc`, `breachReadyAt`, `invulnerableUntil`, `pendingRespawn`, `caps`, `contactNow`, `lastContact` (constraint or null), `hazardSources` (`{ id, key, x, y, z, mode }` in local units for relevant-tier entities with a hazard), `growth`, `acceptedHits`, `rejectedHits`, `faintLog`, `time`.
15. **World.** `placePlayerAt(local)` replaces `placePlayer`. `transform(stage, genome, targetPhysical)` interpolates the physical position from start to target with the scale ease, before rendering.
16. **Browser scripts for braking** (T-R2-19): in `e2e/tiny-tide.mjs` and `e2e/tiny-tide-mobile.mjs`, each "stops immediately" check becomes: wait until `Math.hypot(velocity) < .01` (2 s timeout), record the position, wait 200 ms, assert it moved less than `.01`. A canceled touch must make the next frame's speed decrease. Click `#start` by id.

- [ ] **Step 1: Implement in order 1–15.** After each rule, run `npx tsc -b`.

- [ ] **Step 2: Checkpoint.** `npx tsc -b && npx tsc -p tsconfig.tests.json && npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-core && node e2e/tiny-tide.mjs --visual-only && node e2e/tiny-tide-mobile.mjs && node e2e/tiny-tide-replay.mjs`. Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/tiny-tide/main.ts src/tiny-tide/world.ts e2e/tiny-tide.mjs e2e/tiny-tide-mobile.mjs
git commit -m "Tiny Tide: one input consumer and one physical motion owner in the game loop"
```

---

### Task C5: Avoidance acceptance against the real hunters

**Files:**
- Create: `src/tiny-tide/avoidance.ts`
- Modify: `src/tiny-tide/ecosystem.ts` (one test seam), `src/tiny-tide/species.ts` (hunter data, only if the test demands it)
- Test: `tests/tiny-tide-core/avoidance.test.ts`

**Interfaces:**
- Consumes: B6 `Ecosystem`, `noticeRadius`; C2 `stepPlayer`; B5 `playerActor`; B4 `findRecoveryPose`.
- Produces:
  - `Ecosystem` option `pursuitFor?: (e: Entity) => PursuitPolicy | undefined` (test seam; default uses the registry).
  - `interface Encounter { seed: number; entityId: number; hunterKey: string; planId: string; start: Vec3; hunterStart: Vec3; separation: number }`
  - `findEncounters(planId, hunterKey, count, seeds = 1…40): Encounter[]` — fixture construction (G4-3, R4-08).
  - `interface EscapeResult { ok: boolean; reason: 'gave-up' | 'no-hit' | 'hit' | 'not-acquired' | 'stuck'; seconds: number }`
  - `simulateEscape(e: Encounter, hunter?: { speedScale?: number; policy?: PursuitPolicy }): EscapeResult`

**Encounter search (separate from evaluation).** For each seed in order and for **each candidate**, start from a fresh `new Ecosystem(seed)` (never from a world already advanced by an earlier candidate), acquiring at `now = 0`, `dt = 1/60`; for each live entity of `hunterKey` in entity order: `n = noticeRadius(hunter, size, stealthFactor)` (stealth from `derive(effectiveStats(starter, plan))`); for `k = 0…7` the direction is the hunter-to-origin direction rotated by `k × π/4`; the candidate is the hunter position plus `.95 n` horizontally. Recover it for the player (`maxDistance = 2 × L`, the player's `legality(size)` bounds — the player's own playable square). Accept it when it is admitted, within `n` of the hunter, **not** in hazard contact, and one ecosystem step with the player there puts the hunter in `hunt` with no hazard event. Record the encounter and continue until `count` encounters exist. Fewer than `count` is reported by the test as a fixture failure ("no encounter"), never as an escape result.

**Escape (spec §3).** Rebuild a fresh ecosystem for `e.seed` (with `pursuitFor` and a `speedScale` copy of that entity's `spec` when given), place the player at `e.start`, run the acquiring step (`now = 0`, `dt = 1/60`) and return `not-acquired` unless the hunter is in `hunt` with no hazard event, then at 60 Hz for 8 s: `wish` = the horizontal unit vector away from the hunter; `traversal: 'rise'` when `caps.rise`; `stepPlayer`; `recoverPlayer` when asked (failure → `stuck`); `eco.step` with the translated hull. Any hazard event from the hunter → `hit`. The hunter in `return` → `gave-up`. Eight seconds without a hit → `no-hit`. Both successes are reported separately.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/avoidance.test.ts
import { describe, expect, it } from 'vitest';
import { findEncounters, simulateEscape } from '../../src/tiny-tide/avoidance';
import { eligibleChildren, plan, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { SPECIES } from '../../src/tiny-tide/species';

const visible = () => { const out: string[] = []; const walk = (path: string[]) => { out.push(path.at(-1)!); for (const c of eligibleChildren(path, { coast: false })) walk([...path, c.id]); }; walk([ROOT_PLAN]); return [...new Set(out)]; };
const never = { id: 'x', memorySeconds: 1e9, blockedWaitSeconds: 1e9, reacquireSeconds: 0, leashBodyLengths: 1e9, giveUpBodyLengths: 1e9 };
describe('avoidance', () => {
  it('fails against a much faster hunter that never forgets, on a verified encounter (negative control)', () => {
    const [e] = findEncounters('speck', '1:crab', 1); expect(e, 'no crab encounter for a Speck').toBeTruthy();
    expect(simulateEscape(e!, { speedScale: 3, policy: never })).toMatchObject({ ok: false, reason: 'hit' });
  });
  it('lets every visible plan run from every hunter of its size, in three real encounters', () => {
    const report: string[] = [];
    for (const id of visible()) { const p = plan(id)!; if (p.size === 4) continue;
      for (const s of SPECIES.filter(x => x.hunts.includes(p.size))) {
        const found = findEncounters(id, s.key, 3); expect(found.length, `${id} vs ${s.key}: only ${found.length} encounters`).toBe(3);
        for (const e of found) { const r = simulateEscape(e); report.push(`${id} vs ${s.key} seed ${e.seed} entity ${e.entityId}: ${r.reason} at ${r.seconds.toFixed(1)}s`); expect(r.ok, report.at(-1)).toBe(true); }
      }
    }
    console.log(report.join('\n'));
  });
});
```

- [ ] **Step 2: Implement and run.**

  **Expected first result:** the shipped hunters are faster than their prey. With the starters' derived speeds, the Speck moves at about `5.4955` physical units/s against the crab's `2.2 × 4 = 8.8`; a size-1 Swimmer at about `23.27` (a Crawler at `24.6`) against the squid's `3.2 × 16 = 51.2`. These scenarios fail with `hit`.

  **Then (spec §3):** change only hunter data in `species.ts`, rerunning after each: `1:crab` speed `2.2 → 1.3` (`5.2`, below the Speck); `2:squid` speed `3.2 → 1.4` (`22.4`, below the slowest size-1 starter). If a scenario still fails with `hit`, lower that hunter's speed by `.1` more, at most three times. Fixture failures (`no encounter`) are fixed by the search range, never by speed. Never raise food counts here. Report to the owner, in the task report and the commit message: the failing scenarios before the change, the final speeds, and each encounter's result (`gave-up` or `no-hit`) and time. The plane (`2.6 × 64 = 166` against size-3 speeds near `400`) needs no change.

- [ ] **Step 3: Checkpoint and commit**

```bash
git add src/tiny-tide/avoidance.ts src/tiny-tide/ecosystem.ts src/tiny-tide/species.ts tests/tiny-tide-core/avoidance.test.ts
git commit -m "Tiny Tide: avoidance acceptance on real encounters with the real hunter and player rules"
```

---

### Task C6: Food guidance

**Files:**
- Modify: `src/tiny-tide/main.ts`

**Rules (spec §3, T-R3-17, T-R3-24):**
- One cache entry per entity: `{ key, value }`. `key = ${round(x)}:${round(y)}:${round(z)}:${plan.id}:${genomeRevision}:${round(growth × 20)}:${traversalKey}`, where `traversalKey` is `p<expiresAt>` while a permit is active, `hb` when `caps.breach` and no permit, else `n`. Changing the plan, the genome revision or the stage clears the whole cache.
- A fair round-robin queue: at most 8 recomputations per frame, continuing from where the last frame stopped. A missing or stale entry counts as unknown and is not shown.
- The value is `canApproachFood(actor, mode, food, { stage, growth, reach: derived.reach }, { ...legality(stage), traversal })` (the derived bite bonus, as the live bite uses; `food.radius` 0 for own-tier food), with `traversal` = active permit → `{ kind: 'active', permit, now: time }`; else `caps.breach` → `{ kind: 'hypothetical-breach', now: time }`; else `none`.
- `updateGuide()` and `objective()` show only approachable foods.
- `biteTargets()` never uses approach. Bites keep `inReach` from the current pose (spec §3).
- Diagnostics: each food entry gains `approachable: boolean | null`.

- [ ] **Step 1: Implement.** Run `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`.

- [ ] **Step 2: Commit**

```bash
git add src/tiny-tide/main.ts
git commit -m "Tiny Tide: bounded, invalidated food guidance cache"
```

---

### Task C7: The path screen and the evolution submit flow

**Files:**
- Create: `src/tiny-tide/path-screen.ts`, `src/tiny-tide/path-screen.css`, `src/tiny-tide/preview.ts`
- Modify: `src/tiny-tide/editor.ts` (submit contract), `src/tiny-tide/main.ts` (both `openEditor` callers: `edit('edit')` and `edit('evolve')`)

**Interfaces:**
- `renderPreview(genome, size = 160): string` reuses one offscreen renderer and disposes it after 30 s idle.
- `interface PathChoice { plan: BodyPlan; adaptation: Adaptation; quote: Quote | null; leadsTo: string[]; summary: { playstyle: string; cost: string; sacrifice: string } }` with `summary = cardSummary(current, plan, run.plans)`.
- `openPathScreen({ current, choices }): Promise<string | null>`.
- Editor (T-R3-18): `EditorOptions` gains `onSubmit(result: EditorResult): Promise<{ ok: true } | { ok: false; reason: string }>`; `EditorResult = { genome; name; nextSerial }`. Done calls `onSubmit`; the editor **stays mounted** with its draft, undo history and gesture state on `{ ok: false }` and shows the reason in `.ed-submit-error`; it closes only after `{ ok: true }` or Cancel. `openEditor` still resolves `EditorResult | null` after closing.

**Card content (spec §6), in order:** the plan name; a 64-px silhouette (`renderPreview(adaptation.ok ? adaptation.genome : run.genome, 64)`) outside the details; **Playstyle:** `summary.playstyle`; **This form's cost:** `summary.cost`; **Lasting sacrifice:** `summary.sacrifice`; **Leads to:** names joined with ` · `, or "The end of this path for now"; the banner: none when ok and affordable; "Needs changes you choose: short by N DNA" when ok but not affordable; "Needs changes you choose: <first reason>" when not ok; then `<details>` "Details" with the larger preview, every gain and loss from `compareCapabilities` under "You gain" and "You give up", the change list and the DNA line. Text markers (`+`, `−`, `•`) so color is never the only signal. Opening the details never selects the card (the `<summary>` click stops propagation).

**Screen rules:** title "Choose your path" (2+ cards) or "Next form" (1 card); subtitle "Choose your diet now: you can change your mouth while you evolve."; only eligible plans are listed, so no card is disabled.

**`edit('evolve')`:**
1. Open the path screen. "Not yet" returns to play.
2. Pick a card. Open the editor in evolve mode with `nextSerial = max(run.nextPartSerial, adaptation.nextSerial ?? 0)`, the proposal genome when `adaptation.ok`, else the current genome (spec §6).
3. `onSubmit`: `prepareEvolution(run, planId, result.genome, result.name, BUILD, result.nextSerial)`; on failure, return its reason. Then `evolutionDestination(...)` (C4 rule 12); on failure, return "This body can't fit anywhere here." Only then `commitEvolution`, `resetRuntime(rt)`, `genomeRevision++`, `world.transform(...)`, and return `{ ok: true }`.
4. Cancel in the editor returns to the path screen.

**`edit('edit')`:** `onSubmit` runs `applyDesign(..., result.nextSerial)` and the C4 rule-13 reconciliation; a failure returns its reason and keeps the editor open.

The Evolve button and the objective use `canChooseNextPlan(run, BUILD)` in `syncUI` and the 0.1-second UI tick.

- [ ] **Step 1: Implement.** Copy the base CSS from `.codex-drafts/plan-history/b-integration-rev2.md` (Task B3) and add `.path-banner`, `.path-summary`, `.path-silhouette`, `details` and `.ed-submit-error` styles. Run `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`.

- [ ] **Step 2: Commit**

```bash
git add src/tiny-tide/path-screen.ts src/tiny-tide/path-screen.css src/tiny-tide/preview.ts src/tiny-tide/editor.ts src/tiny-tide/main.ts
git commit -m "Tiny Tide: path screen and an evolution submit that keeps the editor on failure"
```

---

### Task C8: The editor follows the plan, the diet and the ledger, without per-move allocation

**Files:**
- Modify: `src/tiny-tide/editor.ts`, `src/tiny-tide/editor.css`, `src/tiny-tide/creature.ts` (`updatePart(uid, placed)`, `setGhost(placed | null)`, `setHighlight(uids, style)`, resource counters), `src/tiny-tide/main.ts` (option changes for both callers), `src/tiny-tide/genome.ts` (delete the `statsOf` alias), `tests/tiny-tide.test.ts` (any `statsOf` use → `partStats`)

**Interfaces:**
- `EditorOptions { genome; original: Genome; changes: string[]; name; plan: BodyPlan; unlocked; economy: Economy; mode: 'edit' | 'evolve'; diet?: Diet; nextSerial: number; build: Build; loadout: CombatLoadout; catalog?: readonly PartSpec[]; onSubmit }`. Both `main.ts` callers pass every field in this task; the old `stage` and `budget` options are removed in the same commit.
- DOM contract for the tests: `#editor .ed-changes`, `.ed-undo-all`, `.ed-fix`; `.ed-region[data-region]` (text like `Head 3 / 4`, class `over` when full); `.ed-card[data-part][disabled][data-reason]`; `.ed-kind-note`; `[data-v][data-locked=true]`; `.ed-problem` (desktop) and `.ed-problem-line` (phone); `.ed-size-cost`; `.ed-dna-value`; `.ed-lost-abilities`; `.ed-submit-error`; `.ed-view[data-created-geometries][data-disposed-geometries][data-created-materials][data-disposed-materials][data-rebuilds][data-yaw][data-zoom][data-gesture][data-selected]` (`data-selected` = `uid|t|angle` or empty).

**Rules:**
- **Stats:** the stat panel uses `derive(effectiveStats(draft, plan))`. After this, no caller of `statsOf` remains; delete the alias.
- **Budget:** `quote = quoteDesign(economy, original, draft)`; DNA left = `walletTotal(economy) − quote.net`; a `dna` problem "Short by N DNA" when `!quote.affordable`; `problems(draft, plan, { unlocked, diet }, catalog)` on change; the anchor check runs only on Done (inside `onSubmit`, through `BUILD`).
- **Serial (T-R3-08):** one allocator starting at `options.nextSerial`; it advances on every addition and on every **Fix for me** (it adopts `max(own, adaptation.nextSerial)`); it never goes back on undo; `EditorResult.nextSerial` is its high-water mark.
- **Evolve mode:** the change list; **Undo all** restores `original`; **Fix for me** runs `adaptToPlan(draft, plan, { unlocked, diet }, serial)` and shows `reasons[0]` on failure.
- **Diet:** in edit mode, another-diet mouth card is disabled with "Diet is set until your next evolution."; a same-diet mouth click replaces the mouth's `id` in place (uid, `t`, `angle` unchanged).
- **Banned and nowhere-fitting kinds:** hide tabs where every part is banned or fits no region; note "`<Plan>`s can't use: fins, legs."; an unlocked card that fits no region is disabled with a reason.
- **Region chips** are always visible and count `Σ partSlots` per region.
- **Rig invalidation.** The model's `RigPose` is bound to one genome topology. Every addition, removal, pair toggle or segment-count change refreshes the model's genome binding, its rig key map and bone buffers **outside** the animation loop (in the edit method); placement drags and slider moves only change numbers. A regression in C11 adds a claw, animates, toggles its pair, and animates again with no missing pivot key.
- **Persistent model.** One `CreatureModel` while the editor is open: ghosts reuse one object per part id from a pool; drags call `updatePart`; body-shape changes call `rebuildBody()` at most once per animation frame and dispose the old geometry; additions and removals attach or detach one object; highlights swap materials from a cache keyed by `${style}:${sourceMaterialId}`.
- **Counters (T-R3-24):** `creature.ts` counts every geometry and material it **creates** and **disposes** (cumulative, not live). The editor exposes them on `.ed-view`.
- **Rings and handles:** two persistent region rings (visible only while placing or dragging) and pooled vertebra handles, disposed in `close()`.
- **Locked segments:** the chip shows `🔒`; sliders disabled; handle hidden; a new segment is clamped by `segmentRule`.
- **Size slider:** live `14 DNA · 2 slots`; a size that would overflow the region or the DNA keeps the old value with a hint.
- **Pairs:** "Only room for one `<name>`. Place one?" with "Place one" and "Cancel"; pair toggles at poles or tips are refused with a hint.
- **Lost abilities:** `designDelta(original, draft, loadout, catalog).clearedBindings` listed in `.ed-lost-abilities` before Done (a test passes the synthetic grant catalog through `catalog`).

- [ ] **Step 1: Implement.** Run `npx tsc -b && npx tsc -p tsconfig.tests.json && node e2e/tiny-tide.mjs --visual-only`.

- [ ] **Step 2: Allocation check** (in `e2e/tiny-tide-paths.mjs`, C11): arm a part; hover once over the head, the middle and the tail to warm the ghost pool; record the four `data-created-*`/`data-disposed-*` counters and `data-rebuilds`; move the pointer over the creature 60 times; assert that no counter changed.

- [ ] **Step 3: Commit**

```bash
git add src/tiny-tide/editor.ts src/tiny-tide/editor.css src/tiny-tide/creature.ts src/tiny-tide/main.ts src/tiny-tide/genome.ts tests/tiny-tide.test.ts
git commit -m "Tiny Tide: plan, diet, ledger and serial rules in a persistent, counted editor"
```

---

### Task C9: One owner per gesture

**Files:**
- Modify: `src/tiny-tide/editor.ts`, `src/tiny-tide/editor.css`

**Rules (spec §6):**
- A gesture owner exists from pointerdown until all its pointers are released or canceled. Kinds: `none`, `turn`, `pinch`, `part-drag`, `handle-drag`, `card-drag`, `place-tap`, `consumed`.
- The owner covers the canvas, the cards and the handles together; the root `pointermove` and `pointerup` handlers check it first.
- **Card tap** arms placement on every device (no touch auto-place). A body tap places when the pointer moved less than 8 px. Keyboard Enter on a card is a separate quick-add.
- **Second finger** → `pinch`: a part or handle drag restores its pointerdown snapshot (outside the undo history); a card drag is canceled. When the pinch ends, the owner is `consumed` until no pointers remain; a consumed gesture never places, selects or drags.
- **Desktop:** right or middle drag turns; left drag on empty space does nothing; `contextmenu` is prevented on the view.
- **Cancel:** `pointercancel` and `lostpointercapture` roll back an active drag; the owner becomes `consumed` if other pointers remain, else `none`.

- [ ] **Step 1: Implement.** Use checked access for touches (`const [a, b] = touches; if (!a || !b) return;`). Run `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`.

- [ ] **Step 2: Commit**

```bash
git add src/tiny-tide/editor.ts src/tiny-tide/editor.css
git commit -m "Tiny Tide: single-owner gestures across canvas, cards and handles"
```

---

### Task C10: Start screen, notices, archive and save keys

**Files:**
- Modify: `src/tiny-tide/main.ts`, `src/tiny-tide/hud.css`

**Rules (spec §11, G3-2):**
- **Loading.** Read `tiny-tide-adventure-v4-fresh`, `-v4`, `-v2`, `-v1` in that order. `loadedKey` = the first key that gives `status: 'ok'`; `keptMessage` from any key that gives `status: 'kept'` (keep scanning after an `ok` only for this).
- **Writing.** The write key is `loadedKey` **only when it is a v4 key**. A run migrated from `-v2` or `-v1` is written to `-v4` (or `-v4-fresh` when `-v4` holds a kept save). Legacy v1/v2 keys are never written. A key that holds a kept save is never written.
- **Home screen.** `keptMessage` shows as a notice ("Keep munching" stays available when a resumable run exists). Run `notices` show under "While you were away" with "Got it", which clears them and saves to the write key. An archive shows "View your original `<name>`": a dialog with `renderPreview(archive[0].genome)`, the name and paint, and "Copy design" (the archived JSON to the clipboard).

- [ ] **Step 1: Implement.** Run `npx tsc -b && node e2e/tiny-tide.mjs --visual-only`.

- [ ] **Step 2: Commit**

```bash
git add src/tiny-tide/main.ts src/tiny-tide/hud.css
git commit -m "Tiny Tide: save notices, viewable archive and untouched legacy saves"
```

---

### Task C11: Browser tests

**Files:**
- Create: `e2e/tiny-tide-paths.mjs`, `e2e/fixtures/tiny-tide-fixtures.mjs`, `tests-browser/fixtures.html`, `tests-browser/fixtures.ts`
- Modify: `e2e/tiny-tide.mjs`, `e2e/tiny-tide-mobile.mjs`, `e2e/tiny-tide-replay.mjs`, `vite.config.ts` (development-only input), `src/tiny-tide/main.ts` (QA hooks and read-only diagnostics)

**Fixtures.** `tests-browser/fixtures.ts`, served by the dev server only (added to `build.rollupOptions.input` only when `mode === 'development'`), exposes `window.makeFixture(spec)` (built with `freshRun`, `adaptToPlan`, `prepareEvolution`, `commitEvolution`, so goals, costs and ledgers come from the code) and `window.pickHazard({ stage, key, below?, minLeadSeconds? })`, which scans seeds 1–50 with an installed `Ecosystem` and returns `{ seed, entityId, home, start }` for the first live entity of that key whose home is inside the playable square with a 10-unit margin and, when asked, has a legal player start directly below it with the requested lead-in (checked with the same admission and recovery services). Tests write fixtures into `localStorage` before opening the game.

**QA hooks** (read once at load, documented): `?forcedSpawn=x,y,z` (local units; the spawn is still recovered to a legal pose), `?qaStartGrace=0`, `?qaRejectSubmit=1`, `?qaHoldStart=1`. Read-only diagnostics: `editorProjection(uid)` (screen position of a part anchor) and `poseAgreement()`.

**`e2e/tiny-tide-paths.mjs` checks** (each with an assertion message; numbers come from `makeFixture`):

1. **Path screen.** A ready Speck shows exactly the `swimmer` and `crawler` cards, each with a silhouette and its Playstyle, This form's cost, Lasting sacrifice and Leads to lines. Swimmer's sacrifice is "Can never grow legs again"; Crawler's is "Never swims freely or flies". Opening Details does not select the card. "Not yet" returns to play.
2. **Customize fallback.** A ready Crawler with zero DNA and an extra leg pair: the Shellback card shows "Needs changes you choose: short by N DNA"; the editor opens; removing the extra pair enables Done; Done reaches `plans = [..., 'shellback']`.
3. **Submit failure keeps the editor.** With `?qaRejectSubmit=1` (read once at load: the first `onSubmit` returns `{ ok: false, reason: 'QA rejection' }`), a ready Speck chooses Crawler, adds an Antenna pair, and presses Done: the editor is still open, `.ed-submit-error` reads "QA rejection", the part count and `data-selected` are unchanged, and Undo removes the Antenna pair (the history survived). Done again succeeds. Separately: with the check-2 fixture (an unaffordable Shellback proposal), `.ed-dna-value` is negative and Done is disabled; and dragging a size slider to a size the DNA cannot pay for leaves the slider value, the genome and `.ed-dna-value` unchanged and shows the hint.
4. **Evolve editor.** Choose Swimmer: `.ed-changes` includes "Little leg removed: Swimmers can't use it."; Undo all disables Done; Fix for me enables it again; a new part added after Fix for me gets a uid above every proposal uid (read through `data-selected`).
5. **Swimmer surface limit.** Hold Rise until `player.y` has not increased for 1 s of game time (poll `time`), then 2 s more: `zone !== 'air'`, `lastContact === 'surface-top'` on a frame with `contactNow`, and `#toast` reads "Swimmers can't leave the water." Negative control: a `sky_drifter` fixture rises above the surface.
6. **Crawler.** `caps.rise` is false and `#vertical-controls` is hidden; after Rise + W for 1.5 s the zone is `seabed`.
7. **A Crawler placed high recovers onto the seabed.** A ready Crawler with `forcedSpawn` at 30 local units: after start, `zone === 'seabed'` and the position is legal.
7b. **The transformation moves toward the destination.** A ready Speck evolves to Crawler at the seabed (the 4× larger body needs a higher support height, so the destination differs from the start). While `mode === 'evolving'`, sample `world.physicalPosition` every frame: at least one sample lies strictly between the start and the destination height; at the end the body is exactly at the destination and admitted (`zone === 'seabed'`).
8. **Diet lock.** A carnivore Crawler: Nibbler and Beak disabled with the reason; at size 2, swapping Snapper for Fangs keeps the `data-selected` uid.
9. **Size pricing.** Select the Paddle tail, move the slider to its maximum: `.ed-size-cost` reads `14 DNA · 2 slots`.
10. **Gestures (desktop).** Left drag on an empty corner: `data-yaw` unchanged after two frames. Right drag changes `data-yaw`. Click the tail at `editorProjection(uid)`: `data-selected` gives its uid; a left drag changes its attachment.
11. **Gestures (touch, 390×844).** Arm Antenna: `data-gesture` is `none` and placement is armed. Two-finger drag then release finger 1 then 2: `data-yaw` changed, part count unchanged; repeat releasing finger 2 first. One-finger part drag plus a second finger: the part returns to its attachment. Card drag plus a second finger: nothing is placed.
12. **Allocation.** The C8 check.
13. **Hazard integration and invulnerability.** `pickHazard({ stage: 0, key: '1:crab' })` gives a seed and a home. A Speck fixture with that seed and `forcedSpawn` at the home (recovered to a legal pose in contact), with the default start grace (`invulnerableUntil = 2`). Stand still. While `time < 2`, the crab's events are rejected: `rejectedHits ≥ 1` and health stays at maximum. After it, `acceptedHits` becomes 1 and health drops by `damageAfterArmor(3, armor)` (the fixture's armor). The next accepted hit comes no sooner than `.8` s later. Bounded wait: 10 s of game time. (The two-sources-in-one-window rule is the pure C3 test.)
14. **Pose agreement.** `poseAgreement()` compares, for every socket of the player, the rendered transform (part object `matrixWorld` × pivot node matrix relative to the part × `inverse(restPivotToPart)` × socket) with `sampleCombatPose` at the same tick: position error `< 1e-3 × bodyLength`, forward angle error `< .01` rad, and the same reflection sign. Fixture: a Speck with a claw pair **and** a Paddle tail (translated pivot chain), sampled in 5 frames while swimming and chomping.
15. **Faint during a Breach.** `pickHazard({ stage: 2, key: '2:squid', below: true, minLeadSeconds: .5 })` returns a squid whose home leaves room for a legal Darter start directly below it, with a no-input lead-in of at least `.5` s at the squid's speed (separation ≥ contact distance + speed × .5). A Darter fixture with 1 health, `qaStartGrace=0`, `qaHoldStart=1` (documented, read at load: the simulation does not advance until the first real key or pointer press in play), and `forcedSpawn` at that start. The first input is E (Breach), so the arc and permit start on the first simulated frame and rise through the squid's column. Poll each frame for at most 3 s of game time. Assert `faintLog[0]` exists with `hadPermit` and `hadArc` true; fail with "non-Breach faint" otherwise. After the faint: `pendingRespawn` true and saved (read `localStorage`), then false after the timer; health is at maximum; `velocity`, `externalVelocity` are zero; `permit` and `arc` are null; the zone is legal. Separately, reload while `pendingRespawn` is true in storage: it resolves once after loading (deaths and DNA unchanged by the reload; one respawn), and the saved flag becomes false.
16. **Pause keeps the runtime.** Hold W until `velocity` is non-zero, start a Breach where possible (Darter fixture), pause, wait 1 s of real time: `time`, `velocity`, `externalVelocity`, `permit`, `arc` and `breachReadyAt` are unchanged; after resume, `time` advances again.
17. **Kept coast save.** A coast fixture in `-v4`: the notice shows. Start fresh and eat once; reload: the fresh run resumes from `-v4-fresh`, and `-v4` still holds the coast fixture.
18. **Legacy key untouched.** A v2 fixture in `-v2`: load, eat once, reload: `-v2` bytes are unchanged and `-v4` holds the migrated run.

**Journey (`e2e/tiny-tide.mjs`):** start from `makeFixture({ seed: 1501, stage: 0 })` and `#start`. `LINE` = `['crawler','shellback','colossus','star_crawler']` when `TIDE_LINE=crawler`, else `['swimmer','darter','sky_drifter','star_swimmer']`. Evolve through `#evolve` and `[data-plan=LINE[stage]]`; in the editor set the mouth to Snapper at 0→1 and Beak at 1→2; click `.ed-fix` when visible; Done. Targets: only `approachable === true` foods of a matching diet; retarget when the distance has not dropped by 0.5 local units in 3 s. Rise and Dive only when `caps.rise`, Breach only when `caps.breach`. After each transformation the zone is legal (X/Z may change). Final: `plans` equals `['speck', ...LINE]`; diets `0:herbivore, 1:carnivore, 2:omnivore, 3:omnivore, 4:omnivore`; the herbivore ate plants and the carnivore ate meat.

**Mobile and replay:** the v1 fixture migrates (and `-v1` stays unchanged); `#edit` and `#hearts` fit the viewport; a second context at 390×844 chooses Evolve → Swimmer → Undo all and sees a visible `.ed-problem-line` that mentions legs and fits. Replay: `#start` by id and the new save keys.

- [ ] **Step 1: Implement the fixture page, hooks and scripts.** Run `node e2e/tiny-tide-paths.mjs`, `node e2e/tiny-tide-mobile.mjs`, `node e2e/tiny-tide-replay.mjs`; run both journeys in the background (`node e2e/tiny-tide.mjs` and `TIDE_LINE=crawler node e2e/tiny-tide.mjs`). Expected: every script prints `PASSED` or `PASS`.

- [ ] **Step 2: Commit**

```bash
git add e2e tests-browser vite.config.ts src/tiny-tide/main.ts
git commit -m "Tiny Tide: browser tests for paths, editor, gestures, limits, hazards, pose agreement, lifecycle and saves"
```

---

### Task C12: Pacing study and docs

**Files:**
- Create: `e2e/tiny-tide-pacing.mjs`
- Modify: `docs/TINY-TIDE.md`, `docs/TINY-TIDE-EVOLUTION.md`

**Study (spec §12):**
- **Runs:** branches Darter, Bulk, Shellback, Burrower × seeds 11, 12, 13 × policies `none` ("no optional purchases") and `sensible` = 24 runs, 4 at a time in the background. A subset of 4 runs is also run one at a time to calibrate wall time against machine load.
- **Same in both policies:** the journey bot; Snapper at size 1, Beak at size 2. Mandatory costs and refunds at evolution are logged separately from optional purchases.
- **`sensible` shopping list** (each item at most once, when affordable and free of problems):

  | Line | Size 1 | Size 2 (by branch) | Size 3 |
  | --- | --- | --- | --- |
  | Swimmer | Side fin pair (middle) | Darter: Fan tail replaces Paddle. Bulk: Shell plate (middle) | Feather wing pair |
  | Crawler | Spike (middle) | Shellback: Shell plate (middle). Burrower: Cloak fronds (middle) | Tower |

- **Logged per size:** active, editor and wall time; food mix by species; travel versus feeding time; damage taken and faints; seconds with `contactNow` true (current-frame contact, not a sticky label); purchases; extra DNA from foraging bonuses; damage prevented by armor; meals that needed vertical access.
- **Output:** `.codex-drafts/tiny-tide-qa/pacing.json` and a table per branch, with the known limits stated (a single Spike at size 1 gives no mitigation; Shellback's Shell plate adds armor that today's hazards cannot use; the shopping lists are reference builds, not optimal ones).
- **Watch bands** (not gates): first evolution 45–120 s active; sizes 1–3 each 60–240 s; Cosmic separately; `T_none / T_sensible` per branch. The study proposes nothing; the owner receives the table.

**Docs:** `docs/TINY-TIDE.md` gets "Body plans and lines", "Habitats and movement" (borders, hints, Breach, recovery, anchors), "Avoidance" (the hunter speeds from C5), "Diet", "Part size", "The ledger", "Editor controls", "Saves" (v4, migration, archive, kept saves, untouched legacy keys), "Pacing (baseline)" and the verification commands. `docs/TINY-TIDE-EVOLUTION.md` gets a "Later updates" pointer to the core spec.

- [ ] **Step 1: Implement and run the study.** **Step 2: Write the docs** with the measured baseline.

- [ ] **Step 3: Final verification**

```bash
npx tsc -b
npx tsc -p tsconfig.tests.json
npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-core
npm run build
python3 scripts/tiny-tide/blender/check_assets.py
```

Then every browser script, with the journeys and the study in the background. Expected: no type errors; every Tiny Tide test passes; the build succeeds (the existing chunk-size warning is expected); `PASS: 86 self-contained Blender GLBs` and a current `part-rig.json`; every browser script passes.

- [ ] **Step 4: Commit**

```bash
git add e2e/tiny-tide-pacing.mjs docs/TINY-TIDE.md docs/TINY-TIDE-EVOLUTION.md
git commit -m "Tiny Tide: pacing baseline and docs"
```

Then report the pacing table and the C5 hunter changes to the owner.

---

## Self-review notes

**Round-3 findings answered in Plan C:**

| Finding | Task |
| --- | --- |
| T-R3-01 items 5–6 (`statsOf`, editor callers) | C8 removes the alias after the editor; C7 and C8 change both `openEditor` callers in the same commits |
| T-R3-12, T-R3-13, C-R3-02, G3-5 (turn, pitch, velocity ownership, Breach dispatch, wish order) | C2 `stepPlayer`; C4 rule 6 |
| T-R3-14, C-R3-07 (arc ownership, reset fields, guarded faint, persistence) | C3; C4 rules 3, 10, 11 |
| T-R3-17 (permit time in guidance) | C6 traversal kinds and cache keys |
| T-R3-18 (editor stays open) | C7 `onSubmit` |
| T-R3-20, C10 checks 12–14 | C11 checks 13–15 (`pickHazard`, grace window, `faintLog`, reload) |
| T-R3-21, G3-3 B (avoidance) | C5 |
| T-R3-24 (cache lifecycle, churn) | C6 one entry per entity and a fair queue; C8 cumulative counters with a warmed pool |
| T-R3-25 (rename, pause test, interpolation) | C11 checks 7, 7b and 16; the pure C3 test covers destination choice only |
| C-R3-05 (recovery with orientation and bounds, actual growth, prepared destination) | C4 rules 1, 6, 10, 12; C7 submit |
| C-R3-09 (single consumer, priority, cancel) | C1; C4 rule 5 |
| G3-2 (legacy keys) | C10; C11 check 18 |
| G3-4 (card lines) | C7 |

**Test hooks.** QA-only and documented: `forcedSpawn`, `qaStartGrace`, `qaRejectSubmit`, `qaHoldStart`, `editorProjection`, `poseAgreement`, `pickHazard` (fixture page only). They set a spawn or grace at load, or read state. They never change a running game.
