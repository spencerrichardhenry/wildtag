# Tiny Tide Evolution Core — Plan B: Physical Services and Combat Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared rig pose, the combat data contract with full validation, world queries with conservative body admission, one motion resolver with recovery and start anchors, mounts with an enclosing animated hull and combat poses, species actors with perception-driven pursuit and hazards, and food approach that respects how each body moves — all pure and unit-tested.

**Architecture:** Pure modules under `src/tiny-tide/`. Every physical calculation is in physical units. The renderer (`creature.ts`) switches to the rig in B1 and to mounts in B5; the ecosystem switches to these services in B6; the player's game loop switches in Plan C. Algorithms are exact rules with hand-checked tests; the implementer writes the code to the rules.

**Tech Stack:** TypeScript 7 strict, three.js 0.185 math, Vitest 4, Python 3 (asset checker).

**Spec:** `docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md` (revision 4), sections 3, 8, 9 (damage events), 10, 13.

**Depends on:** Plan A complete. **Followed by:** Plan C.

## Global Constraints

- All Plan A global constraints apply (repo, branch, commit approval, Mineral Wage untouched, dev server, both type checks after every task, integer DNA, unused-import rule, hand-computed numbers).
- Test terrain fixtures are `{ groundAt, surface, space, slopeBound }` objects. A fixture with a discontinuous ground uses `slopeBound: 0` and tests **motion mechanics only**; conservative admission is tested only with valid slope bounds (B3).
- No service returns an illegal pose as success. A service that cannot find a legal pose says so explicitly.
- Orientation convention everywhere: `yaw` about +Y, `pitch > 0` is nose up, `forwardOf(o) = (sin yaw cos pitch, sin pitch, cos yaw cos pitch)`, matrix `Ry(yaw) · Rx(−pitch)` (B3 `orientation.ts`).

## Review Focus

1. A body resting on a smooth slope — expected: admission never accepts a pose that intersects the ground (dense check). Pinned in B3.
2. A creature sliding along the water surface from any starting gap — expected: keeps its sideways motion. Pinned in B4.
3. A creature that stops while a permit expires — expected: `needs-recovery`, never a silent illegal pose. Pinned in B4.
4. A hunter whose target hides after being seen — expected: goes to the last seen point and gives up after its memory. Pinned in B6.
5. A grounded Crawler and food that floats above its reach — expected: approach is false for ground movement and true for a swimmer. Pinned in B7.

---

## Shared names produced by Plan B

```ts
// rig.ts (B1)
interface RigNode { parent: string | null; pre: number[]; t: [number, number, number]; q: [number, number, number, number]; s: [number, number, number]; rest: number[] }
PART_RIG: Record<string, Record<string, RigNode>>          // part id → "<kind>:<index>" → node
interface RigPose { genome: Genome; boneYaw: Float64Array; chomp: number; pivots: Map<string, { x: number; y: number; z: number }> }   // key `${uid}:${copy}:${kind}:${index}`
createRigPose(g): RigPose; rigPoseInto(out, g, time, swim, chomp): RigPose; restRig(g): RigPose
pivotToPart(partId, key, offsets: (key: string) => { x: number; y: number; z: number } | undefined, out: T.Matrix4): T.Matrix4
restPivotToPart(partId, key): T.Matrix4
boneMatricesInto(out: T.Matrix4[], g, pose): T.Matrix4[]; restBoneMatrices(g): T.Matrix4[]
SWIM_AMP_MAX = .22; CHOMP_PITCH = .12
// profiles.ts (B2)
HABITATS, MOVEMENTS, PURSUITS, HULLS, MOUNTS, POSES, TELEGRAPHS, EFFECTS, EVASIONS, GUARDS; habitat(id); movement(id); pursuit(id)
LAND_BAND = .6; movementCapabilities(plan): { ground; rise; dive; breach; pitch }; breachPermit(now): TraversalPermit; BREACH_RISE = 3.8
// combat-types.ts (B2) — every contract type (listed in B2)
newRuntime(orientation?): CombatRuntime
// registries.ts (B2)
interface Catalogs; defaultCatalogs(); validateContract(c?): string[]; ATTACKS; ABILITIES; HAZARDS
// design-delta.ts (B2)
emittersOf(g, catalog): EmitterSource[]; designDelta(oldG, newG, loadout, catalog): DesignDelta
// orientation.ts (B3)
forwardOf(o); orientationMatrix(o, out?); orientHull(hull, o): Capsule[]
// world-queries.ts (B3)
makeTerrain(stage): Terrain; SEABED_SLOPE_BOUND = .63; makeWorldQueries(t, extras?): WorldQueries
admit(actor, at, o, ctx, t, extras): Admission   // the body of overlapHull
supportHeight(actor, x, z, o, t): number; sampleEnvironment(p, t); zoneLabel(env, bodyLength)
// motion.ts (B4)
resolveMotion(req, ctx): MotionResult; projectVelocity(v, contacts): Vec3
findRecoveryPose(actor, near, ctx, opts): RecoveryResult; startAnchor(actor, stage, ctx): RecoveryResult
// mount.ts (B5)
resolveMount(g, placed, copy, l?): Mount; bodyHull(g): Capsule[]; hullOffsets(g, scale): Capsule[]; bodyLengthOf(g)
massFor(plan, g, physicalLength); sampleCombatPose(input): CombatPose; speciesCombatPose(e, now): CombatPose
playerActor(plan, genome, stage, growth): Actor
// ecosystem.ts (B6)
new Ecosystem(seed, opts?: { queries?: (tier: number) => WorldQueries }); EcoContext; EcoEvent; speciesActor(e); provoke(e, player, now)
// food-access.ts (B7)
canApproachFood(actor, mode, food, bite, ctx): boolean; reachableFoodDna(plan, diet, seed, opts): number
```

---

### Task B1: Part rig data and the shared rig pose

**Files:**
- Modify: `scripts/tiny-tide/blender/check_assets.py` (rig export and stale check)
- Create: `src/tiny-tide/part-rig.json` (generated), `src/tiny-tide/rig.ts`
- Modify: `src/tiny-tide/creature.ts` (`animate` uses the rig pose; head-only chomp)
- Test: `tests/tiny-tide-core/rig.test.ts`

**Interfaces:**
- Consumes: `Genome`, `layout`, `SPACING` (Plan A).
- Produces: the `rig.ts` names in "Shared names".

**Rig JSON (spec §8).** `src/tiny-tide/part-rig.json` maps a part id (without `part_`) to its pivot nodes, keyed `"<kind>:<index>"`:

- `parent`: the key of the nearest ancestor that is also a pivot, else `null`.
- `pre`: the 16-number column-major matrix from the parent pivot's frame (or the part root, when `parent` is `null`) to this node's parent frame. It is the product of the local matrices of the non-pivot nodes between them. It is the identity when the direct parent is the parent pivot.
- `t`, `q`, `s`: this node's own rest translation, rotation quaternion `[x, y, z, w]` and scale.
- `rest`: the 16-number rest matrix from this node to the part root, computed by Python directly from the glTF node chain. TypeScript never uses it to pose anything; the test uses it as an independent check of `restPivotToPart`.

Numbers are rounded to 6 decimals; keys are sorted. It lives under `src/` because `tsconfig.json` includes only `src` and `src/**/*.json` (`resolveJsonModule` is already on).

**Pose formulas** (the renderer's, unchanged, except the head-only chomp):

- Bone `i ≥ 1`: `boneYaw[i] = (.05 + swim × .17) × sin(time × (2.2 + swim × 5.5) − i × .9) × i / (n − 1)`.
- Bone 0: `rotation.x = −chomp × CHOMP_PITCH`. **New:** bone 1 gets `rotation.x = +chomp × CHOMP_PITCH`, so only the head nods and every later bone keeps a vertical yaw axis. This bounds the animation envelope (B5). It is a deliberate, small visual change.
- Pivot offsets per part copy, with `speed = 2.2 + swim × 5.5` and `phase = t × 4 + (copy ? π : 0)`:
  - jaw: `x = −chomp × .65`
  - seg: `z = sin(time × speed × .9 − index × .8 + phase) × (.1 + swim × .22)`
  - flap: `z = sin(time × (speed + 1) + phase) × (.08 + swim × .32)`
  - swing: `x = sin(time × speed × 1.4 + phase) × (.06 + swim × .45)`
- A posed pivot's local matrix is `T(t) · R(euler) · S(s)`, where `euler` = the rest Euler (`new T.Euler().setFromQuaternion(q, 'XYZ')`, exactly what three.js shows as `node.rotation`) **plus** the offset, componentwise. This is what the renderer does with `rotation.set(rest + offset)`. Quaternion multiplication is not used.
- `pivotToPart(partId, key, offsets, out)` = `pivotToPart(parent) · pre · T(t) · R(euler) · S(s)` along the chain. `restPivotToPart` is the same with no offsets (cached).
- `boneMatricesInto(out, g, pose)`: body-space world matrices of the spine bones, built like `CreatureModel`: bone 0 at `(0, lift0, z0)` with `Rx(−chomp × .12)`; bone `i` at `(0, lift_i − lift_{i−1}, −SPACING)` in its parent with `Rx(i === 1 ? chomp × .12 : 0) · Ry(boneYaw[i])` (Euler `XYZ`). `restBoneMatrices(g)` uses a zero pose.
- `RigPose` buffers are reusable. `createRigPose(g)` allocates the key map once for a genome; `rigPoseInto` writes numbers only and throws if `out.genome !== g`. `restRig(g)` is a pose with every value 0.

- [ ] **Step 1: Extend the checker**

In `check_assets.py`, for every `part_*` GLB:

1. Walk the scene from its root nodes and compute each node's local matrix from `matrix` or `translation`/`rotation`/`scale`.
2. For each node with `extras.tt_pivot`, record `key = f"{kind}:{extras.get('tt_index', 0)}"`, `parent` (nearest pivot ancestor), `pre`, `t`, `q`, `s`, and `rest` (the product of every local matrix from the root down to and including this node).
3. Assert that keys are unique inside each part.
4. `python3 scripts/tiny-tide/blender/check_assets.py --write-rig` writes the JSON. Without the flag the checker only **compares**: a missing or different file fails with `part-rig.json is stale; run check_assets.py --write-rig`.

Run `--write-rig`, then run the checker without the flag. Expected: both pass, and the JSON exists.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/tiny-tide-core/rig.test.ts
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { boneMatricesInto, createRigPose, PART_RIG, pivotToPart, restBoneMatrices, restPivotToPart, restRig, rigPoseInto } from '../../src/tiny-tide/rig';
import { starterGenome } from '../../src/tiny-tide/genome';

describe('rig data', () => {
  it('keys pivots by kind and index, with the tail chain from root to tip', () => {
    const paddle = PART_RIG.tail_paddle!;
    expect(paddle['seg:0']!.parent).toBeNull(); expect(paddle['seg:1']!.parent).toBe('seg:0');
    expect(paddle['seg:2']!.parent).toBe('seg:1'); expect(paddle['seg:3']!.parent).toBe('seg:2');
    expect(PART_RIG.mouth_nibbler!['jaw:0']).toBeTruthy(); expect(PART_RIG.claw_pincer!['swing:0']).toBeTruthy();
  });
  it('composes rest chains that agree with the independent Python matrices', () => {
    for (const [part, nodes] of Object.entries(PART_RIG)) for (const key of Object.keys(nodes)) {
      const mine = restPivotToPart(part, key).elements, python = nodes[key]!.rest;
      for (let i = 0; i < 16; i++) expect(mine[i]!, `${part} ${key} ${i}`).toBeCloseTo(python[i]!, 5);
    }
  });
  it('moves a tail tip when the root segment bends', () => {
    const rest = restPivotToPart('tail_paddle', 'seg:3'), out = new T.Matrix4();
    const bent = pivotToPart('tail_paddle', 'seg:3', k => k === 'seg:0' ? { x: 0, y: 0, z: .5 } : undefined, out);
    const a = new T.Vector3().setFromMatrixPosition(rest), b = new T.Vector3().setFromMatrixPosition(bent);
    expect(a.distanceTo(b)).toBeGreaterThan(.1);   // seg:3 sits well above seg:0, so a .5 rad bend moves it
  });
});
describe('rig pose', () => {
  it('matches the renderer formulas', () => {
    const g = starterGenome(), pose = rigPoseInto(createRigPose(g), g, 1, 1, .5), n = 4;
    expect(pose.chomp).toBe(.5);
    expect(pose.boneYaw[2]!).toBeCloseTo(.22 * Math.sin(7.7 - 1.8) * 2 / (n - 1));   // −.0548352441751
    expect(pose.pivots.get('p1:0:jaw:0')!.x).toBeCloseTo(-.325);                        // −.5 × .65
    const swing = (copy: 0 | 1) => Math.sin(1 * 7.7 * 1.4 + .45 * 4 + (copy ? Math.PI : 0)) * (.06 + .45);
    expect(pose.pivots.get('p4:0:swing:0')!.x).toBeCloseTo(swing(0)); expect(pose.pivots.get('p4:1:swing:0')!.x).toBeCloseTo(swing(1));
  });
  it('reuses its buffers and refuses another genome', () => {
    const g = starterGenome(), out = createRigPose(g), map = out.pivots;
    rigPoseInto(out, g, 2, 0, 0); expect(out.pivots).toBe(map);
    expect(() => rigPoseInto(out, starterGenome(), 0, 0, 0)).toThrow();
  });
  it('has a true rest pose', () => {
    const g = starterGenome(), r = restRig(g);
    expect([...r.boneYaw].every(v => v === 0)).toBe(true); expect([...r.pivots.values()].every(o => o.x === 0 && o.y === 0 && o.z === 0)).toBe(true);
  });
  it('nods only the head: bone 1 and later keep a vertical yaw axis', () => {
    const g = starterGenome(), pose = rigPoseInto(createRigPose(g), g, 0, 0, 1), m = boneMatricesInto(restBoneMatrices(g).map(x => x.clone()), g, pose);
    const up = new T.Vector3(0, 1, 0).transformDirection(m[2]!); expect(up.y).toBeCloseTo(1);
    const headUp = new T.Vector3(0, 1, 0).transformDirection(m[0]!); expect(headUp.y).toBeCloseTo(Math.cos(.12));
  });
});
```

The starter has 4 spine points, so `n = 4`; at `swim = 1` the amplitude is `.22` and the speed is `7.7`. The legs are `p4` at `t = .45`, so `phase = 1.8` for copy 0.

- [ ] **Step 3: Run** `npx vitest run tests/tiny-tide-core/rig.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `rig.ts`** to the rules above (`import rigJson from './part-rig.json'`, typed as `Record<string, Record<string, RigNode>>`).

- [ ] **Step 5: Renderer uses the rig pose.** In `creature.ts`:
  - The model keeps one `RigPose` from `createRigPose(genome)`.
  - `animate(time, swim, chomp)` calls `rigPoseInto`, then sets `bones[i].rotation.y = boneYaw[i]` (i ≥ 1), `bones[0].rotation.x = −chomp × .12`, `bones[1].rotation.x = chomp × .12`, and for each attached copy and pivot `rotation.set(rest.x + o.x, rest.y + o.y, rest.z + o.z)` with `o = pose.pivots.get(\`${uid}:${copy}:${kind}:${index}\`)`.
  - `AttachedPart` stores its `copy` (0 or 1) instead of `phase`.

  Check with `node e2e/tiny-tide.mjs --visual-only`. The idle screenshots must look the same as before (chomp is 0 when idle).

- [ ] **Step 6: Run and checkpoint.** Expected: PASS (7 tests), and the full checkpoint.

- [ ] **Step 7: Commit**

```bash
git add scripts/tiny-tide/blender/check_assets.py src/tiny-tide/part-rig.json src/tiny-tide/rig.ts src/tiny-tide/creature.ts tests/tiny-tide-core/rig.test.ts
git commit -m "Tiny Tide: part rig data and one rig pose for renderer and gameplay"
```

---

### Task B2: Profiles, the contract, registries, validation and design delta

**Files:**
- Create: `src/tiny-tide/profiles.ts`, `src/tiny-tide/combat-types.ts`, `src/tiny-tide/registries.ts`, `src/tiny-tide/design-delta.ts`
- Modify: `src/tiny-tide/plans.ts` (facts derived from profiles), `src/tiny-tide/parts.ts` (combat fields), `src/tiny-tide/species.ts` (combat fields, `stings` → `stingsStages`), `src/tiny-tide/ecosystem.ts` (the one `stings` read), `src/tiny-tide/state.ts` (loadout type, binding validation)
- Test: `tests/tiny-tide-core/contract.test.ts`, `tests/tiny-tide-core/state.test.ts` (3 added tests)

**Interfaces:**
- Consumes: Plan A types; `PART_RIG` (B1).
- Produces: the contract types below (copy exactly), the `profiles.ts`, `registries.ts` and `design-delta.ts` names in "Shared names".

```ts
// combat-types.ts
import type { Medium } from './plans';
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type MutVec3 = { x: number; y: number; z: number };
export type PartUid = string; export type ActorId = string; export type ActiveSlot = 0 | 1;
export type CombatTrait = 'weapon' | 'protection' | 'locomotion' | 'concealment';
export type MovementMode = 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
export interface PivotRef { kind: 'jaw' | 'seg' | 'flap' | 'swing'; index: number }
export interface CombatSocket { id: string; pivot?: PivotRef; origin: Vec3; forward: Vec3 }   // part space, at rest
export interface AttackGrant { id: string; attackId: string; socketIds: readonly string[] }
export interface ActiveGrant { id: string; abilityId: string; socketIds: readonly string[]; mirrorPolicy: 'shared-cast' }
export interface PartCombatFields { traits: readonly CombatTrait[]; sockets: readonly CombatSocket[]; basicAttacks: readonly AttackGrant[]; activeGrants: readonly ActiveGrant[] }
export interface AbilityBinding { partUid: PartUid; grantId: string }
export interface CombatLoadout { active: [AbilityBinding | null, AbilityBinding | null] }
export type AttackShape = { kind: 'cone'; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };   // part-local units, scaled once by the mount
export interface AttackSpec { id: string; shape: AttackShape; poseProfileId: string; windupSeconds: number; activeSeconds: number; recoverySeconds: number; cooldownSeconds: number;
  aimLockAtSeconds: number; maxTrackingRadiansPerSecond: number; damage: number; impulse: number; staggerSeconds: number; blockable: boolean; parryable: boolean; interruptible: boolean;
  maxTargets: number; hitGroup: 'shared-grant' | 'per-emitter'; maxHitsPerTarget: number; repeatHitSeconds: number; crossing: 'same-medium' | 'water-surface' | 'any-medium'; obstruction: 'terrain-and-cover'; telegraphProfileId: string }
export interface AbilitySpec { id: string; cooldownSeconds: number; allowedMotionModes: readonly MovementMode[]; effectProfileId: string }
export interface ContactHazard { id: string; damage: number; cadenceSeconds: number; invulnerabilitySeconds: number; impulse: number }
export interface HabitatProfile { id: string; media: readonly Medium[]; maxWaterDepthBodyLengths: number | null; maxFloorGapBodyLengths: number | null; maxLandSlopeRadians: number;
  surfaceBandBodyLengths: number | null; wadingSupportBodyLengths: number | null; refugeTags: readonly string[]; isStaticProp?: boolean }
export interface MovementProfile { id: string; mode: MovementMode; speedMultiplier: number; acceleration: number; braking: number; maxYawRate: number; maxPitchRate: number;
  facing: 'move' | 'aim' | 'lock-during-action'; evasionProfileId?: string }
export interface PursuitPolicy { id: string; memorySeconds: number; blockedWaitSeconds: number; reacquireSeconds: number; leashBodyLengths: number; giveUpBodyLengths: number }
export interface SpeciesCombatFields { movementProfileId: string; habitatProfileId: string; hullProfileId: string; attackMountProfileId: string; attackIds: readonly string[]; contactHazardId?: string; pursuitId: string }
export interface EnvironmentSample { medium: Medium; groundHeight: number; surfaceHeight: number | null; waterDepth: number; groundClearance: number; groundNormal: Vec3; coverIds: readonly string[]; refugeId: string | null }
/** sway: horizontal and heave: vertical animation envelope; the occupied volume is the capsule swept by any such offset. */
export interface Capsule { start: Vec3; end: Vec3; radius: number; sway?: number; heave?: number }
export type EmitterSource = { kind: 'part'; partUid: PartUid; copy: 0 | 1; socketId: string } | { kind: 'actor'; actorId: ActorId; mountId: string; socketId: string };
export interface Emitter { source: EmitterSource; origin: Vec3; forward: Vec3; localToWorld: readonly number[] }
export interface CombatPose { actorId: ActorId; position: Vec3; forward: Vec3; bodyLength: number; mass: number; knockbackResistance: number; hull: readonly Capsule[]; hurtboxes: readonly Capsule[]; emitters: readonly Emitter[] }
export interface Orientation { yaw: number; pitch: number }
export interface TraversalPermit { id: string; startsAt: number; expiresAt: number; media: readonly Medium[]; landingRequired: boolean }
export interface Actor { id: ActorId; hull: readonly Capsule[]; habitat: HabitatProfile; bodyLength: number }   // hull in body space, physical scale, not oriented
export interface Terrain { groundAt(x: number, z: number): number; surface: number; space: boolean; slopeBound: number }
export type Constraint = 'ground' | 'surface-top' | 'floor-gap' | 'depth' | 'water' | 'land-band' | 'air' | 'space' | 'bounds-x' | 'bounds-z' | 'bounds-y' | 'refuge';
export interface AdmissionContext { time: number; permit?: TraversalPermit | null; bounds?: { half: number; maxY?: number } }
/** On failure, `normal` is the unit direction back into the admitted region at `point` (motion uses it for contacts). */
export interface Admission { ok: boolean; constraint: Constraint | null; point: Vec3 | null; normal: Vec3 | null }
export interface WorldQueries {
  terrain: Terrain;
  sampleEnvironment(p: Vec3): EnvironmentSample;
  visibility(from: Vec3, to: Vec3): number;
  refugeAt(p: Vec3): string | null;                                                   // for environment samples only
  refugeOverlap(world: readonly Capsule[]): { id: string; normal: Vec3 } | null;    // extent-aware: the first refuge the posed hull touches
  refugeAccess(actor: Actor, refugeId: string): boolean;
  overlapHull(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext): Admission;
}
export interface LegalityContext { queries: WorldQueries; bounds?: { half: number; maxY?: number } }
export interface MotionRequest { actorId: ActorId; from: Vec3; displacement: Vec3; orientation: Orientation; turn?: Orientation; hull: readonly Capsule[]; habitatProfileId: string;
  cause: 'locomotion' | 'dash' | 'knockback' | 'recovery'; traversalPermit?: TraversalPermit | null }
export interface Contact { point: Vec3; normal: Vec3; constraint: Constraint; distanceFraction: number; time: number }
export interface MotionResult { status: 'moved' | 'blocked' | 'clamped' | 'invalid-start' | 'needs-recovery'; position: Vec3; orientation: Orientation; contacts: readonly Contact[]; unconsumed: Vec3; time: number }
export type RecoveryResult = { ok: true; position: Vec3; orientation: Orientation } | { ok: false; reason: string };
export interface ActionState { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; phase: 'windup' | 'active' | 'recovery' | 'interrupted'; startedAt: number; aim: Vec3; committedPose: CombatPose | null; hitCounts: Map<string, number>; lastHitAt: Map<string, number> }
export interface BreachArc { startedAt: number; duration: number; fromY: number }
export interface CombatRuntime { targetable: boolean; perceivable: boolean; damageable: boolean; invulnerableUntil: number; staggerUntil: number; guardProfileId: string | null;
  controlledVelocity: MutVec3; externalVelocity: MutVec3; orientation: Orientation; cooldowns: Map<string, number>; actions: ActionState[]; permit: TraversalPermit | null;
  arc: BreachArc | null; breachReadyAt: number; groundOffset: number }
export interface HitRequest { source: ActorId; target: ActorId; actionInstanceId: string; attackId: string; emitter: EmitterSource; hitGroupId: string; point: Vec3; normal: Vec3; damage: number; impulse: Vec3 }
export interface CombatInput { move: Vec3; aim: Vec3 | null; basicHeld: boolean; basicPressed: boolean; activePressed: [boolean, boolean]; activeHeld: [boolean, boolean]; activeReleased: [boolean, boolean]; activeCanceled: [boolean, boolean]; traversal: 'none' | 'rise' | 'dive' | 'breach' }
export type { DnaCredit } from './economy';
/** A fresh runtime: every flag true, every clock 0, zero velocities, empty maps. Never saved. */
export function newRuntime(orientation: Orientation = { yaw: 0, pitch: 0 }): CombatRuntime
```

Ownership rules (JSDoc on the types): positions and velocities are physical; `CombatRuntime` is never saved; cooldown keys are `${actorId}:${partUid}:${grantId}`; hit ledger keys are `${actionInstanceId}:${hitGroupId}:${targetId}`; hit resolution order is guard/counter → immunity → damage → stagger → impulse; an impulse changes `externalVelocity` by `impulse / mass × (1 − knockbackResistance)`; cooldowns start at the end of recovery; the resolver never owns a velocity (spec §3).

```ts
// design-delta.ts
export type PartEmitterSource = Extract<EmitterSource, { kind: 'part' }>;
export interface DesignDelta { removedEmitters: PartEmitterSource[]; changedEmitters: PartEmitterSource[]; clearedBindings: { slot: ActiveSlot; binding: AbilityBinding; reason: 'part removed' | 'grant missing' }[] }
export function emittersOf(g: Genome, catalog?: readonly PartSpec[]): PartEmitterSource[]   // per part, copy 0 then copy 1 if mirrored, sockets in catalog order
export function designDelta(oldG: Genome, newG: Genome, loadout: CombatLoadout, catalog?: readonly PartSpec[]): DesignDelta
```

`designDelta` (spec §7): an old emitter whose `uid:copy:socketId` does not exist in the new genome is **removed**. An old emitter that still exists is **changed** when its part's `id`, `t`, `angle`, `roll`, `scale` or `mirror` differs, **or when the spine differs in any value or length** (a body reshape moves every attachment; paint-only edits change nothing). A binding is cleared when its part uid is gone (`part removed`) or the new part's catalog spec has no active grant with that id (`grant missing`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/contract.test.ts
import { describe, expect, it } from 'vitest';
import { newRuntime } from '../../src/tiny-tide/combat-types';
import { defaultCatalogs, validateContract, type Catalogs } from '../../src/tiny-tide/registries';
import { breachPermit, habitat, HABITATS, movementCapabilities, MOVEMENTS, PURSUITS } from '../../src/tiny-tide/profiles';
import { designDelta, emittersOf } from '../../src/tiny-tide/design-delta';
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
import { SPECIES } from '../../src/tiny-tide/species';
import { HABITAT_FACTS, plan, PLANS } from '../../src/tiny-tide/plans';
import { starterGenome, type Genome } from '../../src/tiny-tide/genome';

const attack = { id: 'pinch', shape: { kind: 'cone' as const, range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
  aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
  hitGroup: 'shared-grant' as const, maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium' as const, obstruction: 'terrain-and-cover' as const, telegraphProfileId: 'basic' };
const synthetic = (): Catalogs => { const c = defaultCatalogs(); return { ...c, attacks: { pinch: attack }, abilities: { dash: { id: 'dash', cooldownSeconds: 3, allowedMotionModes: ['swim'], effectProfileId: 'dash' } } }; };
const mutate = (f: (c: Catalogs) => void) => { const c = structuredClone(synthetic()); f(c); return validateContract(c); };
const claw = (c: Catalogs) => c.parts.find(p => p.id === 'claw_pincer') as { -readonly [K in keyof PartSpec]: PartSpec[K] };

describe('combat contract', () => {
  it('validates the shipped catalogs and a synthetic non-empty attack and ability catalog', () => { expect(validateContract()).toEqual([]); expect(validateContract(synthetic())).toEqual([]); });
  it('rejects each broken rule with its exact message', () => {
    const cases: [(c: Catalogs) => void, string][] = [
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, id: 'other' }; }, 'habitat seabed: id'],
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, media: [] }; }, 'habitat seabed: media'],
      [c => { c.habitats.seabed = { ...c.habitats.seabed!, maxFloorGapBodyLengths: -1 }; }, 'habitat seabed: maxFloorGapBodyLengths'],
      [c => { c.habitats.land = { ...c.habitats.land!, maxLandSlopeRadians: 2 }; }, 'habitat land: maxLandSlopeRadians'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, acceleration: -24 }; }, 'movement swimmer: acceleration'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, mode: 'teleport' as never }; }, 'movement swimmer: mode'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, facing: 'sideways' as never }; }, 'movement swimmer: facing'],
      [c => { c.movements.swimmer = { ...c.movements.swimmer!, evasionProfileId: 'nope' }; }, 'movement swimmer: evasion nope'],
      [c => { c.pursuits.hunter = { ...c.pursuits.hunter!, memorySeconds: -2 }; }, 'pursuit hunter: memorySeconds'],
      [c => { c.hulls.sphere = { id: 'ball' }; }, 'hull sphere: id'],
      [c => { c.hazards['crab-pinch'] = { ...c.hazards['crab-pinch']!, cadenceSeconds: 0 }; }, 'hazard crab-pinch: cadenceSeconds'],
      [c => { c.attacks.pinch!.windupSeconds = -1; }, 'attack pinch: windupSeconds'],
      [c => { c.attacks.pinch!.aimLockAtSeconds = 1; }, 'attack pinch: aimLockAtSeconds'],
      [c => { c.attacks.pinch!.maxTargets = 1.5; }, 'attack pinch: maxTargets'],
      [c => { c.attacks.pinch!.shape = { kind: 'cone', range: 0, halfAngle: .5 }; }, 'attack pinch: shape'],
      [c => { c.attacks.pinch!.poseProfileId = 'nope'; }, 'attack pinch: pose nope'],
      [c => { c.attacks.pinch!.telegraphProfileId = 'nope'; }, 'attack pinch: telegraph nope'],
      [c => { c.abilities.dash!.effectProfileId = 'nope'; }, 'ability dash: effect nope'],
      [c => { c.abilities.dash!.allowedMotionModes = ['warp' as never]; }, 'ability dash: mode warp'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, forward: { x: Number.NaN, y: 0, z: 1 } }]; }, 'part claw_pincer: socket pinch forward'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, forward: { x: 0, y: 0, z: 2 } }]; }, 'part claw_pincer: socket pinch forward'],
      [c => { claw(c).sockets = [{ ...claw(c).sockets[0]!, pivot: { kind: 'seg', index: 9 } }]; }, 'part claw_pincer: socket pinch pivot'],
      [c => { claw(c).sockets = [claw(c).sockets[0]!, claw(c).sockets[0]!]; }, 'part claw_pincer: duplicate socket pinch'],
      [c => { claw(c).traits = ['laser' as never]; }, 'part claw_pincer: trait laser'],
      [c => { claw(c).basicAttacks = [{ id: 'a', attackId: 'pinch', socketIds: ['nope'] }]; }, 'part claw_pincer: grant a socket nope'],
      [c => { claw(c).basicAttacks = [{ id: 'a', attackId: 'nope', socketIds: ['pinch'] }]; }, 'part claw_pincer: attack nope'],
      [c => { claw(c).activeGrants = [{ id: 'g', abilityId: 'dash', socketIds: [], mirrorPolicy: 'shared-cast' }, { id: 'g', abilityId: 'dash', socketIds: [], mirrorPolicy: 'shared-cast' }]; }, 'part claw_pincer: duplicate grant g'],
      [c => { c.species[0] = { ...c.species[0]!, habitatProfileId: 'nope' }; }, 'species 0:plant: habitat nope'],
      [c => { c.species = c.species.map(s => s.key === '2:ray' ? { ...s, pursuitId: 'none' } : s); }, 'species 2:ray: fights without pursuit'],
      [c => { c.species = c.species.map(s => s.key === '1:jellyfish' ? { ...s, contactHazardId: undefined } : s); }, 'species 1:jellyfish: hazard missing'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, physics: { massPerBodyLength: 0, knockbackResistance: .2 } } : p); }, 'plan swimmer: mass'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, physics: { massPerBodyLength: 1, knockbackResistance: 1.5 } } : p); }, 'plan swimmer: resistance'],
      [c => { c.plans = c.plans.map(p => p.id === 'swimmer' ? { ...p, hullProfile: 'blob' as never } : p); }, 'plan swimmer: hull blob'],
      [c => { c.rig.tail_paddle!['seg:1'] = { ...c.rig.tail_paddle!['seg:1']!, parent: 'seg:9' }; }, 'rig tail_paddle seg:1: parent'],
      [c => { c.rig.tail_paddle!['seg:0'] = { ...c.rig.tail_paddle!['seg:0']!, parent: 'seg:3' }; }, 'rig tail_paddle seg:0: cycle'],
      [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, pre: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: pre'],
      [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, q: [0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: q'],
    ];
    for (const [f, message] of cases) expect(mutate(f), message).toContain(message);
  });
  it('gives parts combat fields with unit sockets bound to real pivots', () => {
    for (const p of PARTS) for (const s of p.sockets) expect(Math.hypot(s.forward.x, s.forward.y, s.forward.z)).toBeCloseTo(1);
    expect(PARTS.find(p => p.id === 'claw_pincer')!.sockets[0]!.pivot).toEqual({ kind: 'swing', index: 0 });
    expect(PARTS.find(p => p.id === 'horn')!.traits).not.toContain('protection');
  });
  it('gives every species and plan resolvable profiles, with the balloon in the air', () => {
    for (const s of SPECIES) { expect(HABITATS[s.habitatProfileId]).toBeTruthy(); expect(MOVEMENTS[s.movementProfileId]).toBeTruthy(); expect(PURSUITS[s.pursuitId]).toBeTruthy(); }
    for (const p of PLANS) { expect(HABITATS[p.habitat]).toBeTruthy(); expect(MOVEMENTS[p.movement]).toBeTruthy(); }
    expect(SPECIES.find(s => s.key === '3:balloon')).toMatchObject({ habitatProfileId: 'sp-air', movementProfileId: 'sp-fly' });
    expect(SPECIES.find(s => s.key === '2:ray')!.pursuitId).toBe('retaliate');
    expect(habitat('sp-surface').surfaceBandBodyLengths).toBe(.6); expect(habitat('shallow-shore').wadingSupportBodyLengths).toBe(1.1); expect(habitat('sp-prop').isStaticProp).toBe(true);
    expect(HABITAT_FACTS.seabed).toEqual({ media: ['water'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null });
  });
  it('derives movement capabilities and the Breach permit', () => {
    expect(movementCapabilities(plan('crawler')!)).toEqual({ ground: true, rise: false, dive: false, breach: false, pitch: false });
    expect(movementCapabilities(plan('darter')!)).toMatchObject({ rise: true, breach: true, pitch: true });
    expect(movementCapabilities(plan('shellback')!).breach).toBe(false);
    expect(breachPermit(10)).toEqual({ id: 'breach', startsAt: 10, expiresAt: 11.9, media: ['air'], landingRequired: true });
  });
  it('makes a fresh runtime with no shared state', () => {
    const a = newRuntime(), b = newRuntime({ yaw: 1, pitch: 0 });
    expect(a).toMatchObject({ targetable: true, perceivable: true, damageable: true, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null, permit: null, arc: null, breachReadyAt: 0, groundOffset: 0, actions: [] });
    expect(a.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(a.controlledVelocity).not.toBe(b.controlledVelocity);
    expect(a.cooldowns).not.toBe(b.cooldowns); expect(b.orientation).toEqual({ yaw: 1, pitch: 0 });
  });
});

const withClaw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .2, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
const grantCatalog: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
describe('design delta', () => {
  it('lists emitters per copy', () => { expect(emittersOf(withClaw()).filter(e => e.partUid === 'p5')).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }, { kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); });
  it('removes copy 1 and changes copy 0 when a mirror is unpaired', () => {
    const d = designDelta(withClaw(), withClaw({ mirror: false }), { active: [null, null] });
    expect(d.removedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); expect(d.changedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }]);
  });
  it('treats a same-uid catalog replacement as removal of sockets it no longer has, and clears a lost grant', () => {
    const loadout = { active: [{ partUid: 'p5', grantId: 'snap' }, null] as [{ partUid: string; grantId: string }, null] };
    const d = designDelta(withClaw(), withClaw({ id: 'spike', mirror: false }), loadout, grantCatalog);
    expect(d.removedEmitters.map(e => `${e.copy}:${e.socketId}`)).toEqual(['0:pinch', '1:pinch']);
    expect(d.clearedBindings).toEqual([{ slot: 0, binding: { partUid: 'p5', grantId: 'snap' }, reason: 'grant missing' }]);
  });
  it('reports nothing for an unchanged or repainted design, and a move or a reshape as a change', () => {
    expect(designDelta(withClaw(), withClaw(), { active: [null, null] })).toEqual({ removedEmitters: [], changedEmitters: [], clearedBindings: [] });
    expect(designDelta(withClaw(), { ...withClaw(), paint: { ...withClaw().paint, base: '#000000' } }, { active: [null, null] }).changedEmitters).toEqual([]);
    expect(designDelta(withClaw(), withClaw({ t: .25 }), { active: [null, null] }).changedEmitters).toHaveLength(2);
    const reshaped = { ...withClaw(), spine: withClaw().spine.map((s, i) => i === 1 ? { ...s, radius: s.radius + .1 } : s) };
    expect(designDelta(withClaw(), reshaped, { active: [null, null] }).changedEmitters).toHaveLength(emittersOf(withClaw()).length);
  });
});
```

Add to `tests/tiny-tide-core/state.test.ts` (the synthetic catalog is passed explicitly; the shipped catalog is never changed):

```ts
import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
const grantParts: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
const clawRun = () => { const r = freshRun(1); r.genome.parts.push({ uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0 }); r.nextPartSerial = 6;
  r.economy.parts.p5 = { basis: 24, credit: { banked: 24, atRisk: 0 } }; r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, null]; return r; };   // claw pair: round(12 × 2 × 1) = 24
it('validates a binding against the catalog it is given', () => {
  expect(validateRun(clawRun(), build, grantParts)).toEqual([]);
  expect(validateRun(clawRun(), build)).toContain('loadout 0: grant snap');
});
it('rejects the same binding in both slots, and extra keys', () => {
  const r = clawRun(); r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, { partUid: 'p5', grantId: 'snap' }]; expect(validateRun(r, build, grantParts)).toContain('loadout: duplicate binding');
  const s = clawRun(); (s.loadout.active as unknown[])[0] = { partUid: 'p5', grantId: 'snap', extra: 1 }; expect(validateRun(s, build, grantParts)).toContain('loadout 0: shape');
});
it('clears a binding when its part is removed', () => {
  const r = clawRun(), g = structuredClone(r.genome); g.parts = g.parts.filter(p => p.uid !== 'p5');
  expect(applyDesign(r, g, r.name, build, r.nextPartSerial, grantParts)).toEqual({ ok: true, clearedBindings: [0] }); expect(r.loadout.active).toEqual([null, null]);
});
```

`freshRun(1)` gives 20 banked DNA. The claw pair's ledger entry is written by hand with full credit, so the economy is valid before the edit; removing it releases 24.

- [ ] **Step 2: Run** `npx vitest run tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/state.test.ts`. Expected: FAIL.

- [ ] **Step 3: Write `profiles.ts`**

Habitat rows (body lengths; `null` = unlimited; every row has `refugeTags: []`):

| id | media | maxDepth | maxFloorGap | maxLandSlope | surfaceBand | wadingSupport | static |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `seabed` | water | null | 1.1 | .9 | null | 1.1 | — |
| `open-water` | water | null | null | .9 | null | null | — |
| `shallow-shore` | water, land | 2.5 | null | .7 | null | 1.1 | — |
| `land` | land | null | null | .7 | null | null | — |
| `seabed-land` | water, land | null | 1.1 | .8 | null | 1.1 | — |
| `sky-sea` | water, air | null | null | .9 | null | null | — |
| `space` | space | null | null | 0 | null | null | — |
| `sp-seabed` | water | null | 1.6 | .9 | null | null | — |
| `sp-water` | water | null | null | .9 | null | null | — |
| `sp-air` | air | null | null | .9 | null | null | — |
| `sp-surface` | water | null | null | .9 | .6 | null | — |
| `sp-prop` | land | null | null | 1.5 | null | null | true |
| `sp-space` | space | null | null | 0 | null | null | — |

`sp-surface` uses `.6`: a boat (tier 3, body length `64 × 1.4 = 89.6`, hull radius `.35 × 64 = 22.4` lifted by 22.4) spawned at `85 + 4 = 89` has its top at `89 + 44.8 = 133.8 ≤ 85 + .6 × 89.6 = 138.76`.

Movement rows: the 12 plan rows from Plan A `MOVEMENT_FACTS` as full `MovementProfile`s (`speedMultiplier = speed`, `maxYawRate = yaw`, `maxPitchRate = pitch`, `facing: 'move'`), plus species rows (mode, speed ×, accel, braking, yaw, pitch): `sp-still` (ground, 0, 0, 0, 0, 0), `sp-ground` (ground, 1, 20, 20, 6, 0), `sp-swim` (swim, 1, 20, 16, 6, 3), `sp-fly` (fly, 1, 16, 12, 4, 2), `sp-surface` (surface, 1, 8, 8, 2, 0). Species speed comes from `Species.speed`; the multiplier is 1.

Pursuit rows (spec §10): `none` (all 0), `hunter` (6, 3, 2, 30, 12), `retaliate` (4, 2, 3, 15, 8) in the field order memory, blockedWait, reacquire, leash, giveUp.

Other registries (each value `{ id }`): `HULLS = { sphere, 'spine-capsules' }`, `MOUNTS = { root }`, `POSES = { rest }`, `TELEGRAPHS = { basic }`, `EFFECTS = { dash }`, `EVASIONS = {}`, `GUARDS = {}`.

Also in `profiles.ts`:
- `movementCapabilities(plan)`: `ground` = mode `ground` or `burrow`; `rise` = `dive` = mode `swim`, `fly`, `glide` or `space`; `breach` = `plan.size === 2` and mode `swim` and `maxFloorGapBodyLengths === null` and `media` has `water`; `pitch` = mode `swim`, `glide`, `fly` or `space`.
- `breachPermit(now) = { id: 'breach', startsAt: now, expiresAt: now + 1.9, media: ['air'], landingRequired: true }`.
- `BREACH_RISE = 3.8` (stage-local units above the surface at the top of today's arc, `main.ts`).

`profiles.ts` imports only types from `plans.ts`. In `plans.ts`, `HABITAT_FACTS` and `MOVEMENT_FACTS` become **derived views** of `HABITATS`/`MOVEMENTS` (same field names and values as Plan A, so every Plan A test passes unchanged): `{ media, maxDepth: maxWaterDepthBodyLengths, floorGap: maxFloorGapBodyLengths, wading: wadingSupportBodyLengths, surfaceBand: surfaceBandBodyLengths }` and `{ mode, speed: speedMultiplier, acceleration, braking, yaw: maxYawRate, pitch: maxPitchRate }`, for the plan rows only. `BodyPlan` gains `hullProfile: 'spine-capsules'` on every plan.

- [ ] **Step 4: Write `combat-types.ts`** (the block above; `newRuntime` returns fresh objects: zero velocities, `new Map()`s, `[]`, all three flags `true`, clocks `0`, `guardProfileId: null`, `permit: null`, `arc: null`, `breachReadyAt: 0`, `groundOffset: 0`, the given orientation copied).

- [ ] **Step 5: Write `registries.ts`**

```ts
export interface Catalogs { habitats: Record<string, HabitatProfile>; movements: Record<string, MovementProfile>; pursuits: Record<string, PursuitPolicy>;
  hulls: Record<string, { id: string }>; mounts: Record<string, { id: string }>; poses: Record<string, { id: string }>; telegraphs: Record<string, { id: string }>;
  effects: Record<string, { id: string }>; evasions: Record<string, { id: string }>; guards: Record<string, { id: string }>;
  attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; hazards: Record<string, ContactHazard>;
  parts: PartSpec[]; species: Species[]; plans: BodyPlan[]; rig: Record<string, Record<string, RigNode>> }
export const ATTACKS: Record<string, AttackSpec> = {}; export const ABILITIES: Record<string, AbilitySpec> = {};
export const HAZARDS: Record<string, ContactHazard>;   // jelly-sting 1/1.8, ray-sting 1/1.8, crab-pinch 2/1.4, squid-grab 2/1.4, plane-buzz 2/1.4 (damage/cadence); invulnerability .8; impulse 0
export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
  effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
export function validateContract(c: Catalogs = defaultCatalogs()): string[]
```

`validateContract` pushes these exact messages (`X` is the key; `<field>` is the field name):

- **Every registry record:** the value's `id` equals its key (`<registry> X: id`, with registry words `habitat`, `movement`, `pursuit`, `hull`, `mount`, `pose`, `telegraph`, `effect`, `evasion`, `guard`, `attack`, `ability`, `hazard`).
- **Habitats:** `media` non-empty and each one of `water | air | land | burrow | space` (`habitat X: media`); `maxWaterDepthBodyLengths`, `maxFloorGapBodyLengths`, `surfaceBandBodyLengths`, `wadingSupportBodyLengths` are `null` or finite ≥ 0 (`habitat X: <field>`); `maxLandSlopeRadians` finite in `[0, π/2]`; `refugeTags` an array of strings; `isStaticProp` absent or boolean.
- **Movements:** `mode` one of the 7 modes (`movement X: mode`); `speedMultiplier`, `acceleration`, `braking`, `maxYawRate`, `maxPitchRate` finite ≥ 0 (`movement X: <field>`); `facing` one of 3 values (`movement X: facing`); `evasionProfileId` absent or a key of `evasions` (`movement X: evasion Y`).
- **Pursuits:** the 5 numbers finite ≥ 0 (`pursuit X: <field>`).
- **Hazards:** `damage`, `invulnerabilitySeconds`, `impulse` finite ≥ 0; `cadenceSeconds` finite > 0 (`hazard X: <field>`).
- **Attacks:** every duration, rate, `damage`, `impulse`, `staggerSeconds`, `repeatHitSeconds` finite ≥ 0 (`attack X: <field>`); `aimLockAtSeconds ≤ windupSeconds` (`attack X: aimLockAtSeconds`); `maxTargets` and `maxHitsPerTarget` integers ≥ 1; shape valid — cone `range > 0`, `0 < halfAngle ≤ π`; capsule `radius > 0` and finite ends (`attack X: shape`); `hitGroup`, `crossing`, `obstruction` in their enums (`attack X: <field>`); `poseProfileId` in `poses` (`attack X: pose Y`); `telegraphProfileId` in `telegraphs` (`attack X: telegraph Y`).
- **Abilities:** `cooldownSeconds` finite ≥ 0; each mode valid (`ability X: mode M`); `effectProfileId` in `effects` (`ability X: effect Y`).
- **Parts:** each trait valid (`part X: trait T`); socket ids unique (`part X: duplicate socket S`); `origin` finite (`part X: socket S origin`); `forward` finite and unit length within 1e-6 (`part X: socket S forward`); a socket `pivot` exists as `rig[X]["kind:index"]` (`part X: socket S pivot`); grant ids unique across both grant lists (`part X: duplicate grant G`); each grant socket exists (`part X: grant G socket S`); the attack exists (`part X: attack A`) and the ability exists (`part X: ability B`); `mirrorPolicy` is `shared-cast`.
- **Species:** habitat, movement, pursuit, hull and mount resolve (`species K: habitat Y`, `… movement Y`, `… pursuit Y`, `… hull Y`, `… mount Y`); `contactHazardId` resolves when set (`species K: hazard Y`); each attack exists (`species K: attack A`); a species that hunts or stings some stage has a hazard (`species K: hazard missing`); a species with `fights: true` has a pursuit other than `none` (`species K: fights without pursuit`).
- **Plans:** habitat and movement resolve (`plan X: habitat`, `plan X: movement`); `hullProfile` in `hulls` (`plan X: hull Y`); `massPerBodyLength` finite > 0 (`plan X: mass`); `knockbackResistance` in `[0, 1]` (`plan X: resistance`).
- **Rig:** for each part and key: `parent` is `null` or a key of the same part (`rig P K: parent`); following parents never returns to `K` (`rig P K: cycle`); `pre` and `rest` have 16 finite numbers with the last row `0, 0, 0, 1` (`rig P K: pre` / `rest`); `t`, `s` finite with no zero scale (`rig P K: t` / `s`); `q` finite and unit within 1e-6 (`rig P K: q`).

- [ ] **Step 6: Parts, species and the run**

**Parts** (`parts.ts`). `PartSpec` extends `PartCombatFields`. Traits:
- Mouths, `claw_pincer`, `horn`, `tentacle`, `tentacle_long`: weapon.
- Tails: weapon and locomotion.
- `spike`, `shell_plate`, `tower`: protection.
- `leg_crab`: locomotion and protection.
- Fins, `leg_little`, `wing_feather`, `jet_vent`, `nebula_fin`: locomotion.
- `fin_frill`: locomotion and concealment; `cloak_fronds`, `eye_big`: concealment.
- Others: no traits.

Sockets (part space, at rest; pivots by `kind:index`):

| Part | Socket | Pivot | Origin | Forward |
| --- | --- | --- | --- | --- |
| each mouth | `bite` | `{ jaw, 0 }` | (0, .3, 0); snapper .5, beak .6, maw .35 | (0, 1, 0) |
| `claw_pincer` | `pinch` | `{ swing, 0 }` | (0, .6, .7) | (0, 0, 1) |
| `horn` | `gore` | — | (0, .75, .2) | (0, 1, 0) |
| `spike` | `spike` | — | (0, .5, 0) | (0, 1, 0) |
| `tentacle` | `lash` | `{ seg, 3 }` | (0, .9, .3) | (0, 1, 0) |
| `tentacle_long` | `lash` | `{ seg, 4 }` | (0, 1.5, .5) | (0, 1, 0) |
| `tail_paddle` | `slap` | `{ seg, 3 }` | (0, 1.1, 0) | (0, 1, 0) |
| `tail_fan` | `slap` | `{ seg, 2 }` | (0, 1.1, 0) | (0, 1, 0) |
| `tail_fluke` | `slap` | `{ seg, 3 }` | (0, 1, 0) | (0, 1, 0) |
| `jet_vent` | `thrust` | — | (0, .7, 0) | (0, 1, 0) |

Every part has `basicAttacks: []` and `activeGrants: []`. If a listed pivot key is missing from `PART_RIG`, the contract test names it; use the key the checker found and note it in the commit message.

**Species** (`species.ts`). `Species` extends `SpeciesCombatFields`. Defaults by behavior: `still` → `sp-seabed`/`sp-still`; `graze` → `sp-seabed`/`sp-ground`; `drift`, `school`, `skittish` → `sp-water`/`sp-swim`; `flyer` → `sp-air`/`sp-fly`. Every species gets `hullProfileId: 'sphere'`, `attackMountProfileId: 'root'`, `attackIds: []`, `pursuitId: 'none'`. Overrides:

| Species | Override |
| --- | --- |
| `1:crab` | `contactHazardId: 'crab-pinch'`, `pursuitId: 'hunter'` |
| `1:jellyfish` | `contactHazardId: 'jelly-sting'` |
| `2:squid` | `contactHazardId: 'squid-grab'`, `pursuitId: 'hunter'` |
| `2:ray` | `contactHazardId: 'ray-sting'`, `pursuitId: 'retaliate'` |
| `3:plane` | `contactHazardId: 'plane-buzz'`, `pursuitId: 'hunter'` |
| `3:balloon` | `habitatProfileId: 'sp-air'`, `movementProfileId: 'sp-fly'` |
| `3:tree`, `3:lighthouse` | `habitatProfileId: 'sp-prop'` |
| `3:boat` | `habitatProfileId: 'sp-surface'`, `movementProfileId: 'sp-surface'` |
| `4:planet` | `habitatProfileId: 'sp-space'`, `movementProfileId: 'sp-still'` |

Rename `stings` to `stingsStages` and change the one read in `ecosystem.ts` (`e.spec.stings.includes` → `e.spec.stingsStages.includes`) in this task, so the checkpoint compiles. Keep `damage` until B6.

**Run** (`state.ts`):
- `Run.loadout` becomes `CombatLoadout`.
- `validateRun(run, build, catalog)` checks each element: `null`, or an object with exactly the keys `partUid` and `grantId`, both strings (`loadout N: shape`); the part exists (`loadout N: part U`); the catalog spec of that part has an active grant with that id (`loadout N: grant G`); the same binding is not in both slots (`loadout: duplicate binding`).
- `clearMissing` also clears a binding whose grant is missing in the given catalog.

- [ ] **Step 7: Write `design-delta.ts`** to the rules above. Catalog default `PARTS`.

- [ ] **Step 8: Run and checkpoint.** Expected: the new tests pass; all Plan A tests pass unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/tiny-tide/profiles.ts src/tiny-tide/combat-types.ts src/tiny-tide/registries.ts src/tiny-tide/design-delta.ts src/tiny-tide/plans.ts src/tiny-tide/parts.ts src/tiny-tide/species.ts src/tiny-tide/ecosystem.ts src/tiny-tide/state.ts tests/tiny-tide-core
git commit -m "Tiny Tide: combat contract, registries, full validation and design delta"
```

---

### Task B3: Orientation, world queries and conservative admission

**Files:**
- Create: `src/tiny-tide/orientation.ts`, `src/tiny-tide/world-queries.ts`
- Test: `tests/tiny-tide-core/admission.test.ts`

**Interfaces:**
- Consumes: contract types (B2), `habitat` (B2), `seabedHeight`, `WATER_LEVEL` (`biomes.ts`).
- Produces: the `orientation.ts` and `world-queries.ts` names in "Shared names".

**Orientation (`orientation.ts`).** `orientationMatrix(o) = Ry(yaw) · Rx(−pitch)`. `forwardOf(o)` is that matrix times `(0, 0, 1)`. `orientHull(hull, o)` rotates both ends of each capsule, keeps the radius, and converts the body-frame envelope into a world-aligned one: `sway' = sway + heave × |sin pitch|`, `heave' = heave × |cos pitch| + sway × |sin pitch|`.

**Terrain.** `makeTerrain(stage) = { groundAt: seabedHeight, surface: WATER_LEVEL, space: stage === 4, slopeBound: SEABED_SLOPE_BOUND }`. `SEABED_SLOPE_BOUND` bounds `|∇ seabedHeight|`: `2.4 × (.075 + .055) + 4.5 × .018 × √2 + 13 × (.006 + .009) = .312 + .1146 + .195 = .6216`, rounded up to `.63`.

**`makeWorldQueries(t, extras?)`.** `extras = { visibility?: (from, to) => number; refugeAt?: (p) => string | null; refugeOverlap?: (world: readonly Capsule[]) => { id; normal } | null; refugeAccess?: (actor, id) => boolean }`. Defaults: `1`, `null`, `null`, `true`. A refuge provider must answer `refugeOverlap` for the **whole** posed hull (an exact or conservative volume test); point samples are not enough for refuges. `overlapHull(actor, at, o, ctx)` = `admit(actor, at, o, ctx, t, extras)`.

**Admission (`admit`, spec §3).** Orient the actor's hull, translate it to `at`, and test in this order; the first failure returns `{ ok: false, constraint, point }`. `L = actor.bodyLength`. A static prop (`habitat.isStaticProp`) is always admitted.

1. **Bounds.** For each capsule with radius `r`, sway `w`, heave `v`: `min(a.x, b.x) − r − w ≥ −half` and `max(a.x, b.x) + r + w ≤ half` (`bounds-x`), the same for `z` (`bounds-z`), and `max(a.y, b.y) + r + v ≤ maxY` when `maxY` is set (`bounds-y`). `point` is the extreme point.
2. **Axis samples.** For a capsule of axis length `ℓ`: `n = max(1, ceil(ℓ / (r / 2)))`, spacing `s = ℓ / n`, samples `a + (b − a) × k / n` for `k = 0…n`. Each sample is a sphere of radius `r' = r + s / 2` with the capsule's `w` and `v`. (For `ℓ = 0`, `n = 1`, `s = 0`, `r' = r`.)
3. **Ground** (skipped in space). For each sample sphere with centre `c`: horizontal reach `R = r' + w`, grid spacing `h = r' / 2`, margin `m = slopeBound × h / √2`. For every grid point `g = (c.x + i h, c.z + j h)` (integers `i`, `j`) with horizontal distance `d = |g − c| ≤ R + h / √2`:
   - `e = max(0, d − h / √2 − w)`; `depth = e < r' ? sqrt(r'² − e²) : 0`;
   - require `c.y − v − depth ≥ groundAt(g) + m`.

   This is conservative: any point under the sphere is within `h/√2` of a grid point, where the ground is at most `m` higher, and the underside there is no deeper than `depth`. On failure, `constraint: 'ground'`, `point` = the grid point with the largest shortfall (`(g.x, groundAt(g), g.z)`).
4. **Body floor gap.** `lowest` = the sample sphere with the smallest `c.y − r' − v`; `gap = (c.y − r' − v) − groundAt(c.x, c.z)` for that sphere (`+∞` in space).
5. **Media.** For each sample sphere, reuse its step-3 grid to get conservative ground bounds over its footprint: `Gmin = min(groundAt(g)) − m` and `Gmax = max(groundAt(g)) + m` (in space, skip). Terrain-dependent rules use these bounds, so no part of the body between the six points escapes them: a water point's depth is `surface − Gmin`; an air point is "over water" when `Gmin < surface` and "over dry ground" when `Gmax ≥ surface` (a mixed footprint must satisfy **both** rules); its height above dry ground is `p.y − Gmin`. The flat water surface needs only the exact vertical extremes. Test six points in this order: `−y`, `+y` (at `r' + v`), `−x`, `+x`, `−z`, `+z` (at `r' + w`). A permit with `startsAt ≤ ctx.time < expiresAt` adds its media. For a point `p` with ground `G = groundAt(p.x, p.z)`:
   - **space** (terrain is space): needs `space` (`space`).
   - **water** (`p.y < surface`): needs `water` (`water`); when `maxWaterDepth` is set, `surface − Gmin ≤ maxWaterDepth × L` (`depth`); when `maxFloorGap` is set, `gap ≤ maxFloorGap × L` (`floor-gap`).
   - **air over water** (`p.y ≥ surface` and `Gmin < surface`): admitted if `surfaceBand !== null && p.y − surface ≤ surfaceBand × L`; or `wadingSupport !== null && gap ≤ wadingSupport × L`; or the media have `air`. Else `surface-top`.
   - **air over dry ground** (`Gmax ≥ surface`): if `p.y − Gmin ≤ LAND_BAND × L`, needs `land` with slope `acos(groundNormal.y) ≤ maxLandSlopeRadians`, or `air` (`land-band`). Higher, needs `air` (`air`).
6. **Refuge.** `refugeOverlap(posed capsules, with each radius grown by its sway and heave)`; if it returns an id and `refugeAccess(actor, id)` is false, fail with `refuge` and the provider's normal.

**Failure normals** (returned in `Admission.normal`, unit length, pointing back into the admitted region): `ground` → the terrain normal at the worst grid point; `surface-top` → `(0, −1, 0)`; `water` → `(0, 1, 0)`; `floor-gap` and `air` → `normalize(∂G/∂x, −1, ∂G/∂z)` at the point (the boundary is a height above the ground, so on a slope it tilts); `depth` → `normalize(∂G/∂x, 0, ∂G/∂z)` (uphill; fallback `null`); `land-band` → `normalize(−∂G/∂x, 0, −∂G/∂z)` (downhill toward the water; fallback `null`); `bounds-x` → `(−sign(point.x), 0, 0)`; `bounds-z` → `(0, 0, −sign(point.z))`; `bounds-y` → `(0, −1, 0)`; `refuge` → the provider's normal; `space` → `null`. Gradients use central differences with step `.5`.

**`hullExtents(actor, o)`** returns `{ top, bottom }`: the largest height above and below the origin of any oriented sample sphere, using `r' + heave` (the same spheres admission tests). Recovery and food approach use it for their band heights.

**`supportHeight(actor, x, z, o, t)`.** The lowest origin height at which step 3 passes (the ground part only), plus `1e-9`. For each sample sphere with offset `k` from the origin, the ground rule needs `origin.y ≥ max over its grid points of (groundAt(g) + m + v + depth) − k.y`; grid positions do not depend on `y`, so this is exact for the rule. Plan C's ground movement and B7's food approach both place grounded bodies at `supportHeight + .01 × L`, so they agree.

**`sampleEnvironment(p, t)`.** In space: `{ medium: 'space', groundHeight: −Infinity, surfaceHeight: null, waterDepth: 0, groundClearance: +Infinity, groundNormal: (0,1,0), coverIds: [], refugeId: null }`. Otherwise: `medium` is `land` below the ground, `water` below the surface, else `air`; `waterDepth = max(0, surface − ground)`; `groundClearance = y − ground`; the normal is `normalize(−∂g/∂x, 1, −∂g/∂z)` from central differences with step `.5`. `refugeId` comes from `refugeAt`.

**`zoneLabel(env, L)`**: `space`; `seabed` (water and clearance ≤ 1.1L); `shallow` (water and depth < 2.5L); `deep` (other water); `land` (dry ground, clearance ≤ .6L); `air`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/admission.test.ts
import { describe, expect, it } from 'vitest';
import { makeTerrain, makeWorldQueries, sampleEnvironment, supportHeight, zoneLabel } from '../../src/tiny-tide/world-queries';
import { forwardOf, orientHull } from '../../src/tiny-tide/orientation';
import { habitat } from '../../src/tiny-tide/profiles';
import type { Actor, Capsule, Terrain } from '../../src/tiny-tide/combat-types';

const T = (groundAt: (x: number, z: number) => number, slopeBound = 0, surface = 20, space = false): Terrain => ({ groundAt, surface, space, slopeBound });
const flat = T(() => 0), island = T(x => x > 30 ? 24 : 0), wall = T(x => x > .5 ? 30 : 0);
const ball = (r: number, extra: Partial<Capsule> = {}): Capsule[] => [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r, ...extra }];
const actor = (id: string, hull: Capsule[], L: number): Actor => ({ id: 'a', hull, habitat: habitat(id), bodyLength: L });
const admit = (id: string, hull: Capsule[], L: number, t: Terrain, at: { x: number; y: number; z: number }, ctx = {}, extras = {}) =>
  makeWorldQueries(t, extras).overlapHull(actor(id, hull, L), at, { yaw: 0, pitch: 0 }, { time: 0, ...ctx });
/** Independent dense check: true when no point under the hull is below the ground. */
const clearOf = (t: Terrain, hull: Capsule[], at: { x: number; y: number; z: number }) => {
  for (const c of hull) for (let k = 0; k <= 40; k++) {
    const f = k / 40, ax = at.x + c.start.x + (c.end.x - c.start.x) * f, ay = at.y + c.start.y + (c.end.y - c.start.y) * f, az = at.z + c.start.z + (c.end.z - c.start.z) * f;
    for (let ring = 0; ring <= 8; ring++) for (let s = 0; s < 24; s++) {
      const d = c.radius * ring / 8, a = s / 24 * Math.PI * 2, x = ax + Math.cos(a) * d, z = az + Math.sin(a) * d;
      if (ay - Math.sqrt(Math.max(0, c.radius ** 2 - d * d)) < t.groundAt(x, z) - 1e-9) return false;
    }
  }
  return true;
};

describe('orientation', () => {
  it('points the nose up for positive pitch', () => { const f = forwardOf({ yaw: 0, pitch: .3 }); expect(f.y).toBeCloseTo(Math.sin(.3)); expect(f.z).toBeCloseTo(Math.cos(.3)); });
  it('turns +Z toward +X for positive yaw', () => { expect(forwardOf({ yaw: Math.PI / 2, pitch: 0 }).x).toBeCloseTo(1); });
  it('widens the envelope when pitched', () => {
    const h = orientHull(ball(1, { sway: .2, heave: .1 }), { yaw: 0, pitch: Math.PI / 2 })[0]!;
    expect(h.sway).toBeCloseTo(.3); expect(h.heave).toBeCloseTo(.2);   // .2 + .1 × 1, .1 × 0 + .2 × 1
  });
});
describe('conservative ground admission', () => {
  const plane = T(x => .5 * x, .5);
  it('rejects a sphere that touches a sloped plane between grid points', () => {
    expect(admit('open-water', ball(1), 2, plane, { x: 0, y: 1, z: 0 })).toMatchObject({ ok: false, constraint: 'ground' });   // true clearance 1/√1.25 = .894 < 1
    expect(admit('open-water', ball(1), 2, plane, { x: 0, y: 1.45, z: 0 }).ok).toBe(true);   // worst grid point (1, 0): .5 + .1768 + .7630 = 1.4398
  });
  it('never admits a pose that intersects a valid-bound terrain (dense check)', () => {
    const wavy = T((x, z) => .3 * Math.sin(2 * x) * Math.cos(1.5 * z), .75);   // |∇| ≤ √(.6² + .45²) = .75
    const bump = T((x, z) => .4 * Math.max(0, 1 - ((x - .3) ** 2 + z * z) / .04), 4);   // peak .4 at d = .3; slope ≤ .4 × 2 × .2 / .04 = 4
    const capsule: Capsule[] = [{ start: { x: -1, y: 0, z: 0 }, end: { x: 1, y: 0, z: .5 }, radius: .4 }];
    let admitted = 0;
    for (const [t, hull] of [[plane, ball(1)], [wavy, capsule], [bump, ball(1)]] as const) for (let x = -1; x <= 1; x += .25) for (let y = .4; y <= 3.6; y += .05) {
      const ok = admit('open-water', [...hull], 2, t, { x, y, z: 0 }).ok; if (ok) { admitted++; expect(clearOf(t, [...hull], { x, y, z: 0 }), `${x} ${y}`).toBe(true); }
    }
    expect(admitted).toBeGreaterThan(100);   // not vacuous
    expect(admit('open-water', ball(1), 2, bump, { x: 0, y: 1.2, z: 0 }).ok).toBe(false);   // the bump pierces the underside: 1.2 − √(1 − .09) = .246 < .4
  });
  it('covers the capsule between axis samples', () => {
    const ridge = T(x => .5 * Math.max(0, 1 - Math.abs(x - .0714) / .05), 10);
    const rod: Capsule[] = [{ start: { x: -1, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, radius: .3 }];
    expect(admit('open-water', rod, 2, ridge, { x: 0, y: .75, z: 0 }).ok).toBe(false);   // underside .45 < ridge .5
  });
  it('adds the sway to the ground reach', () => {
    expect(admit('open-water', ball(.3), 2, wall, { x: 0, y: 10, z: 0 }).ok).toBe(true);                     // reach .3 + h/√2 = .406: grid x ≤ .3
    expect(admit('open-water', ball(.3, { sway: .3 }), 2, wall, { x: 0, y: 10, z: 0 })).toMatchObject({ ok: false, constraint: 'ground' });   // grid x = .6 is in the wall
  });
  it('places a grounded body at its support height', () => {
    const y = supportHeight(actor('seabed', ball(.3), 2), 0, 0, { yaw: 0, pitch: 0 }, flat); expect(y).toBeCloseTo(.3, 6);
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: y + .02, z: 0 }).ok).toBe(true); expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: y - .01, z: 0 }).ok).toBe(false);
  });
  it('bounds the real seabed slope', () => {
    const t = makeTerrain(0); let worst = 0;
    for (let x = -400; x <= 400; x += 7) for (let z = -400; z <= 400; z += 7) worst = Math.max(worst, Math.hypot(t.groundAt(x + .01, z) - t.groundAt(x, z), t.groundAt(x, z + .01) - t.groundAt(x, z)) / .01);
    expect(worst).toBeLessThanOrEqual(t.slopeBound);
  });
});
describe('media, bounds and refuges', () => {
  it('admits a swimmer in water and rejects it when its top leaves the water', () => {
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 19.6, z: 0 }).ok).toBe(true);                                       // top 19.9
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 19.8, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });   // top 20.1
  });
  it('keeps a seabed body within its floor gap, measured from the lowest point', () => {
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: 2.4, z: 0 }).ok).toBe(true);                                        // lowest 2.1 ≤ 1.1 × 2
    expect(admit('seabed', ball(.3), 2, flat, { x: 0, y: 2.6, z: 0 })).toMatchObject({ ok: false, constraint: 'floor-gap' });  // 2.3 > 2.2
  });
  it('lets a surface actor float within its band', () => {
    expect(admit('sp-surface', ball(.3), 2, flat, { x: 0, y: 20.8, z: 0 }).ok).toBe(true);    // top 21.1 ≤ 20 + .6 × 2
    expect(admit('sp-surface', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }).ok).toBe(false);     // top 21.3
  });
  it('lets wading bodies stand above the water, including shallow-shore with no floor gap', () => {
    for (const id of ['seabed-land', 'shallow-shore']) expect(admit(id, ball(15), 10, flat, { x: 0, y: 15.5, z: 0 }).ok, id).toBe(true);   // gap .5 ≤ 11; depth 20 ≤ 25
    expect(admit('open-water', ball(15), 10, flat, { x: 0, y: 15.5, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });
    expect(admit('shallow-shore', ball(.3), 2, flat, { x: 0, y: 25, z: 0 })).toMatchObject({ ok: false, constraint: 'surface-top' });   // wading does not mean flying
  });
  it('limits water depth over the whole footprint, not just six points', () => {
    const tilted = T((x, z) => .2 * (x + z), Math.sqrt(.08), 5);   // |∇| = .2√2
    expect(admit('shallow-shore', ball(1), 2.1, tilted, { x: 0, y: 2.5, z: 0 })).toMatchObject({ ok: false, constraint: 'depth' });   // the diagonal point sits in 5.28 > 2.5 × 2.1 = 5.25
    expect(admit('shallow-shore', ball(1), 2.1, tilted, { x: 2, y: 2.5, z: 2 }).ok).toBe(true);   // shallower: Gmin ≈ .8 − .3 − .1 = .4, depth 4.6
  });
  it('limits water depth', () => { expect(admit('shallow-shore', ball(.3), 2, T(() => -10), { x: 0, y: 5, z: 0 })).toMatchObject({ ok: false, constraint: 'depth' }); });   // 30 > 2.5 × 2
  it('admits land only near dry ground, and air anywhere for flyers', () => {
    expect(admit('land', ball(.3), 2, island, { x: 40, y: 24.5, z: 0 }).ok).toBe(true);                                   // .2 ≤ .6 × 2
    expect(admit('land', ball(.3), 2, island, { x: 40, y: 30, z: 0 })).toMatchObject({ ok: false, constraint: 'air' });     // 5.7 > 1.2
    expect(admit('sp-air', ball(.3), 2, island, { x: 40, y: 30, z: 0 }).ok).toBe(true);
  });
  it('treats space as its own medium with the documented sentinels', () => {
    const space = T(() => 0, 0, 20, true);
    expect(sampleEnvironment({ x: 0, y: 0, z: 0 }, space)).toMatchObject({ medium: 'space', groundClearance: Number.POSITIVE_INFINITY, surfaceHeight: null });
    expect(admit('space', ball(1), 2, space, { x: 0, y: 0, z: 0 }).ok).toBe(true); expect(admit('open-water', ball(1), 2, space, { x: 0, y: 0, z: 0 })).toMatchObject({ ok: false, constraint: 'space' });
  });
  it('uses the full extent for bounds, including radius and sky', () => {
    expect(admit('open-water', ball(1), 2, flat, { x: 9.9, y: 10, z: 0 }, { bounds: { half: 10 } })).toMatchObject({ ok: false, constraint: 'bounds-x' });
    expect(admit('open-water', ball(1), 2, flat, { x: 8.9, y: 10, z: 0 }, { bounds: { half: 10 } }).ok).toBe(true);
    expect(admit('open-water', ball(1), 2, flat, { x: 0, y: 10, z: 0 }, { bounds: { half: 50, maxY: 10.5 } })).toMatchObject({ ok: false, constraint: 'bounds-y' });
  });
  it('lets a permit admit its media only inside its interval', () => {
    const permit = { id: 'b', startsAt: 0, expiresAt: 5, media: ['air' as const], landingRequired: true };
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }).ok).toBe(false);
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }, { time: 1, permit }).ok).toBe(true);
    expect(admit('open-water', ball(.3), 2, flat, { x: 0, y: 21, z: 0 }, { time: 5, permit }).ok).toBe(false);
  });
  it('checks a refuge touched only by a flank, with the actor for access', () => {
    // An exact provider for the half-space x > .5: a capsule touches it when its farthest point in +x passes .5.
    const half = (n: { x: number; z: number }, d: number) => (world: readonly Capsule[]) => world.some(c => Math.max(c.start.x * n.x + c.start.z * n.z, c.end.x * n.x + c.end.z * n.z) + c.radius > d) ? { id: 'cave', normal: { x: -n.x, y: 0, z: -n.z } } : null;
    const extras = (access: boolean) => ({ refugeOverlap: half({ x: 1, z: 0 }, .5), refugeAccess: () => access });
    expect(admit('open-water', ball(.6), 2, flat, { x: 0, y: 10, z: 0 }, {}, extras(false))).toMatchObject({ ok: false, constraint: 'refuge' });   // +x point at .6
    expect(admit('open-water', ball(.6), 2, flat, { x: 0, y: 10, z: 0 }, {}, extras(true)).ok).toBe(true);
    expect(admit('open-water', ball(.6), 2, flat, { x: -1, y: 10, z: 0 }, {}, extras(false)).ok).toBe(true);
    const diagonal = { refugeOverlap: half({ x: Math.SQRT1_2, z: Math.SQRT1_2 }, .8), refugeAccess: () => false };   // a sphere of radius 1 at the origin reaches projection 1 > .8
    expect(admit('open-water', ball(1), 2, flat, { x: 0, y: 10, z: 0 }, {}, diagonal)).toMatchObject({ ok: false, constraint: 'refuge', normal: { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } });
  });
  it('returns a tilted floor-gap normal on a slope, and an upward one for water entry', () => {
    const slope = T(x => .2 * x, .2), r = admit('seabed', ball(.3), 2, slope, { x: 0, y: 3, z: 0 });   // lowest 2.7 > 2.2 above the ground at 0
    expect(r.constraint).toBe('floor-gap'); expect(r.normal!.x).toBeCloseTo(.2 / Math.hypot(.2, 1)); expect(r.normal!.y).toBeCloseTo(-1 / Math.hypot(.2, 1));
    expect(admit('sp-air', ball(.3), 2, flat, { x: 0, y: 19.9, z: 0 })).toMatchObject({ ok: false, constraint: 'water', normal: { x: 0, y: 1, z: 0 } });   // bottom 19.6 is in the water
  });
  it('labels zones for the UI', () => {
    expect(zoneLabel(sampleEnvironment({ x: 0, y: 1, z: 0 }, flat), 2)).toBe('seabed'); expect(zoneLabel(sampleEnvironment({ x: 0, y: 10, z: 0 }, flat), 2)).toBe('deep');
    expect(zoneLabel(sampleEnvironment({ x: 40, y: 24.5, z: 0 }, island), 2)).toBe('land');
  });
});
```

Hand checks:
- **Plane, y = 1:** grid point `(.5, 0)`: `d = .5`, `e = .5 − .3536 = .1464`, depth `.9892`; underside `1 − .9892 = .0108` < ground `.25` + margin `.5 × .5 / √2 = .1768` → fails. The rule is conservative: it also rejects `1.2` (true tangency is `√1.25 = 1.118`). At `1.45` the worst grid point is `(1, 0)`: `e = .6464`, depth `.7630`, need `.5 + .1768 + .7630 = 1.4398` (margin uses `h = .5`: `.5 × .5 / √2 = .1768`).
- **Sway:** `r' = .3`, `h = .15`; without sway the reach is `.3 + .106 = .406`, so the farthest grid x is `.3` (ground 0); with sway `.3` the reach is `.706` and the grid point at `x = .6` is inside the wall.

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3:** Implement both modules. **Step 4:** Run. Expected: PASS, every test in the file.

- [ ] **Step 5: Checkpoint and commit**

```bash
git add src/tiny-tide/orientation.ts src/tiny-tide/world-queries.ts tests/tiny-tide-core/admission.test.ts
git commit -m "Tiny Tide: orientation, world queries and conservative full-body admission"
```

---

### Task B4: Motion, permits, recovery and start anchors

**Files:**
- Create: `src/tiny-tide/motion.ts`
- Test: `tests/tiny-tide-core/motion.test.ts`

**Interfaces:**
- Consumes: B2 types, B3 `overlapHull`, `supportHeight`, `orientHull`.
- Produces: `resolveMotion(req, ctx: LegalityContext & { actor: Actor; interval: { start: number; end: number } })`, `projectVelocity(v, contacts)`, `findRecoveryPose(actor, near, ctx: LegalityContext & { orientation: Orientation; time: number }, opts: { maxDistance: number; anchor?: Vec3 })`, `startAnchor(actor, stage, ctx: LegalityContext)`.

#### `resolveMotion` rules (spec §3)

`adm(p, o, time)` = `ctx.queries.overlapHull(ctx.actor, p, o, { time, permit: req.traversalPermit, bounds: ctx.bounds })`. `minR` = the smallest capsule radius. `extent` = the largest distance of any capsule end from the origin plus its radius and sway.

1. `req.hull !== ctx.actor.hull` or `req.habitatProfileId !== ctx.actor.habitat.id` → throw an `Error` (programming error).
2. **Invalid start.** If `adm(from, orientation, start)` fails → `{ status: 'invalid-start', position: from, orientation, contacts: [], unconsumed: displacement, time: start }`.
3. **Turn.** If `turn` is set: `step = minR / (2 × extent)`; `m = ceil(max(|Δyaw|, |Δpitch|) / step)` (Δyaw on the shortest arc); test orientations `k / m` of the way for `k = 1…m` at time `start`; stop at the last admitted one. A blocked turn is never an invalid start.
4. **Translation and time** (every query time lies in `[start, end]`). `s = minR / 2`. The motion is a sequence of straight **legs**; the first leg is `d` from `from` at `start`. For a leg with base `B`, vector `V`, start time `t0`: `N = ceil(|V| / s)` is computed **once**, and slot `k = 1…N` is the position `B + V × k / N` at time `t0 + (end − t0) × k / N` (positions and times come from the slot index, never from repeated subtraction, so floating-point residue cannot add a slot). For each slot, from the last admitted position `P` (slot `k − 1`), test `Q` (slot `k`) at its time:
   - If `Q` is admitted, move there.
   - If `P` itself is not admitted at the slot time (the change is in time, for example a permit expiry): a contact at `P`, fraction `f = 0`.
   - Otherwise bisect 8 times between `P` and `Q` at the slot time; the contact point is the last admitted point, at fraction `f` of the slot.
   - At a contact: the time is `t = time(k − 1) + f × (time(k) − time(k − 1))`; record `{ point, normal, constraint, distanceFraction: |travelled path| / |d|, time: t }`; the remaining vector is `V × (N − k + 1 − f) / N`, projected `rem −= min(0, rem · n) n`; a **new leg** starts at the contact point with that vector and `t0 = t`. A fourth contact stops the call (`blocked`). A remaining vector shorter than `1e-9` ends the motion.
   - At most 512 slot tests run per call; then the status is `clamped`, with `unconsumed` = the remaining vector of the current leg.
5. **Normals** come from `Admission.normal` of the failed position (B3). When it is `null`, use `−step / |step|`.
6. **End of interval.** If the final position is not admitted at `end` (same orientation and permit), the status is `needs-recovery`. This runs even with zero displacement.
7. **Status:** `invalid-start` > `needs-recovery` > `clamped` > `blocked` (any contact) > `moved`. `unconsumed` = `rem` when the call stops (projected parts are not counted). `time` = the time of the last admitted slot or contact (always `≤ end`).
8. `projectVelocity(v, contacts)`: for each contact, `v −= min(0, v · n) n`. The resolver never returns a velocity.

#### `findRecoveryPose` rules

1. If `near` is admitted (at `ctx.time`, `ctx.orientation`, `ctx.bounds`), return it.
2. **Offsets.** `(0, 0)`, then rings `k = 1, 2, …` of 16 points at radius `k × .5 × L`, angle `j × π / 8` for `j = 0…15`; stop when a ring radius exceeds `maxDistance`.
3. **Heights** at each offset (`G` = ground there; `{ top, bottom } = hullExtents(actor, ctx.orientation)` from B3 — the inflated sample spheres admission tests; `ε = .01 × L`): `near.y`; `supportHeight + ε`; when `maxFloorGap` is set, `G + maxFloorGap × L + bottom − ε`; when `wadingSupport` is set, `G + wadingSupport × L + bottom − ε`; `surface − top − ε`; `surface + bottom + ε`; when `surfaceBand` is set, `surface + surfaceBand × L − top − ε`. In space: `near.y` only.
4. **Order and bounds.** Candidates in generation order (offset by offset, heights in the listed order), stable-sorted by 3D distance to `near`; drop those farther than `maxDistance`; test at most 2,000.
5. **Anchor.** If none is admitted, test `opts.anchor` (any distance).
6. **Result:** `{ ok: true, position, orientation: ctx.orientation }` or `{ ok: false, reason: 'No legal pose within the search budget.' }`.

#### `startAnchor(actor, stage, ctx)`

`findRecoveryPose` from `near = (0, supportHeight(actor, 0, 0, o0) + .01 L, 0)`, or `(0, 3 × SIZES[stage], 0)` in space, with orientation `{ yaw: 0, pitch: 0 }`, time 0 and `maxDistance = 60 × L`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/motion.test.ts
import { describe, expect, it } from 'vitest';
import { findRecoveryPose, projectVelocity, resolveMotion } from '../../src/tiny-tide/motion';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { orientHull } from '../../src/tiny-tide/orientation';
import { habitat } from '../../src/tiny-tide/profiles';
import type { Actor, Capsule, Orientation, Terrain, TraversalPermit } from '../../src/tiny-tide/combat-types';

// Discontinuous fixtures use slopeBound 0 and test motion mechanics only.
const T = (groundAt: (x: number, z: number) => number, surface = 20): Terrain => ({ groundAt, surface, space: false, slopeBound: 0 });
const flat = T(() => 0), strip = T(x => x > 10 && x < 11 ? 30 : 0), wall = T(x => x > .8 ? 30 : 0);
const ball = (id: string, r = .2, L = 2): Actor => ({ id: 'p', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: r }], habitat: habitat(id), bodyLength: L });
const rod = (id = 'open-water'): Actor => ({ id: 'p', hull: [{ start: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 0, z: 1 }, radius: .3 }], habitat: habitat(id), bodyLength: 2 });
type V = { x: number; y: number; z: number };
const run = (a: Actor, t: Terrain, from: V, d: V, extra: { turn?: Orientation; traversalPermit?: TraversalPermit } = {}, bounds?: { half: number; maxY?: number }, interval = { start: 0, end: 1 }) =>
  resolveMotion({ actorId: 'p', from, displacement: d, orientation: { yaw: 0, pitch: 0 }, hull: a.hull, habitatProfileId: a.habitat.id, cause: 'locomotion', ...extra },
    { queries: makeWorldQueries(t), actor: a, interval, bounds });

describe('resolveMotion', () => {
  it('never tunnels through a thin strip on a long dash', () => {
    const r = run(ball('open-water'), strip, { x: 0, y: 1, z: 0 }, { x: 1000, y: 0, z: 0 });
    expect(r.position.x).toBeLessThanOrEqual(9.8 + 1e-6); expect(r.position.x).toBeGreaterThan(9.7); expect(r.status).toBe('blocked'); expect(r.contacts[0]!.constraint).toBe('ground');
  });
  it('clamps very long moves and reports the rest', () => {
    const r = run(ball('open-water'), flat, { x: 0, y: 1, z: 0 }, { x: 200, y: 0, z: 0 });   // 2000 slots of .1; 512 run
    expect(r.status).toBe('clamped'); expect(r.position.x).toBeCloseTo(51.2); expect(r.unconsumed.x).toBeCloseTo(148.8);
  });
  it('stops on the floor with an upward normal, and the caller removes the inward velocity', () => {
    const r = run(ball('open-water', .3), flat, { x: 0, y: .5, z: 0 }, { x: 0, y: -2, z: 0 });
    expect(r.position.y).toBeGreaterThanOrEqual(.3); expect(r.position.y).toBeLessThan(.301); expect(r.status).toBe('blocked'); expect(r.contacts[0]!.normal.y).toBeCloseTo(1);
    expect(projectVelocity({ x: 3, y: -2, z: 0 }, r.contacts)).toEqual({ x: 3, y: 0, z: 0 }); expect(projectVelocity({ x: 0, y: 2, z: 0 }, r.contacts)).toEqual({ x: 0, y: 2, z: 0 });
  });
  it('slides along the water surface from any starting gap, keeping the sideways motion', () => {
    for (const y0 of [19.5, 19.59, 19.69]) {
      const r = run(ball('open-water', .3), flat, { x: 0, y: y0, z: 0 }, { x: 1, y: 1, z: 0 });
      expect(r.position.x, `${y0}`).toBeCloseTo(1, 6); expect(r.position.y).toBeLessThanOrEqual(19.7); expect(r.contacts[0]!.normal).toEqual({ x: 0, y: -1, z: 0 });
    }
  });
  it('reports an invalid start instead of moving', () => {
    expect(run(ball('open-water'), flat, { x: 0, y: 25, z: 0 }, { x: 1, y: 0, z: 0 })).toMatchObject({ status: 'invalid-start', position: { x: 0, y: 25, z: 0 } });
  });
  it('stops a turn that would swing a long body into a wall, without an invalid start', () => {
    const a = rod(), r = run(a, wall, { x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, { turn: { yaw: Math.PI / 2, pitch: 0 } });
    expect(r.status).not.toBe('invalid-start'); expect(r.orientation.yaw).toBeCloseTo(3 * Math.PI / 28, 6);   // steps of (π/2)/14; the 4th reaches the wall
    const rotated = orientHull(a.hull, r.orientation); expect(Math.max(...rotated.map(c => Math.max(c.start.x, c.end.x) + c.radius))).toBeLessThanOrEqual(.8);
  });
  it('lets a permit carry a body into the air only inside its interval', () => {
    const a = ball('open-water', .3), up = { x: 0, y: 3, z: 0 };
    const full = run(a, flat, { x: 0, y: 19, z: 0 }, up, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: 5, media: ['air'], landingRequired: true } });
    expect(full.status).toBe('moved'); expect(full.position.y).toBeCloseTo(22, 6);
    const half = run(a, flat, { x: 0, y: 19, z: 0 }, up, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: .5, media: ['air'], landingRequired: true } });
    expect(half.status).toBe('needs-recovery'); expect(half.position.y).toBeCloseTo(20.35, 6);   // slot 10 (t = .5) is the first without the permit
  });
  it('asks for recovery when a permit expires while standing still', () => {
    const r = run(ball('open-water', .3), flat, { x: 0, y: 20.5, z: 0 }, { x: 0, y: 0, z: 0 }, { traversalPermit: { id: 'b', startsAt: 0, expiresAt: .5, media: ['air'], landingRequired: true } });
    expect(r).toMatchObject({ status: 'needs-recovery', position: { x: 0, y: 20.5, z: 0 } });
  });
  it('slides inside the interval: no query or result time passes its end', () => {
    // One substep (|d| = .1414 < s = .15) hits the x bound at 40 % of it; the slide must still finish z inside [0, 1].
    const permit = { id: 'b', startsAt: 0, expiresAt: 1.5, media: ['air' as const], landingRequired: true };
    const a = run(ball('open-water', .3), flat, { x: .66, y: 21, z: 0 }, { x: .1, y: 0, z: .1 }, { traversalPermit: permit }, { half: 1 });
    expect(a.position.x).toBeLessThanOrEqual(.7 + 1e-9); expect(a.position.z).toBeCloseTo(.1, 6); expect(a.time).toBeLessThanOrEqual(1);
    for (const c of a.contacts) { expect(c.time).toBeGreaterThanOrEqual(0); expect(c.time).toBeLessThanOrEqual(1); }
    const b = run(ball('open-water', .3), flat, { x: 0, y: 19.6999, z: 0 }, { x: Math.sqrt(.99), y: .1, z: 0 });   // a partial first step, then a long slide
    expect(b.position.x).toBeCloseTo(Math.sqrt(.99), 6); expect(b.time).toBeLessThanOrEqual(1); for (const c of b.contacts) expect(c.time).toBeLessThanOrEqual(1);
  });
  it('treats world bounds as a contact with a face normal', () => {
    const r = run(ball('open-water'), flat, { x: 9, y: 1, z: 0 }, { x: 5, y: 0, z: 0 }, {}, { half: 10 });
    expect(r.position.x).toBeLessThanOrEqual(9.8); expect(r.contacts[0]).toMatchObject({ constraint: 'bounds-x', normal: { x: -1, y: 0, z: 0 } });
  });
});
describe('findRecoveryPose', () => {
  const ctx = (t: Terrain, o: Orientation = { yaw: 0, pitch: 0 }, bounds?: { half: number; maxY?: number }) => ({ queries: makeWorldQueries(t), orientation: o, time: 0, bounds });
  it('recovers an air creature to just above the surface', () => {
    const r = findRecoveryPose(ball('sp-air', .3), { x: 0, y: 10, z: 0 }, ctx(flat), { maxDistance: 30 }); expect(r.ok && r.position.y).toBeCloseTo(20.32);   // 20 + .3 + .01 × 2
  });
  it('picks the nearest legal height within a 3D bound', () => {
    const a = ball('seabed', .3);   // floor band top: 0 + 1.1 × 2 + .3 − .02 = 2.48
    expect(findRecoveryPose(a, { x: 0, y: 12, z: 0 }, ctx(flat), { maxDistance: 5 }).ok).toBe(false);
    const r = findRecoveryPose(a, { x: 0, y: 12, z: 0 }, ctx(flat), { maxDistance: 12 }); expect(r.ok && r.position.y).toBeCloseTo(2.48);
  });
  it('fails explicitly, and then uses a legal anchor', () => {
    expect(findRecoveryPose(ball('shallow-shore', .3), { x: 0, y: 10, z: 0 }, ctx(flat), { maxDistance: 10 })).toEqual({ ok: false, reason: 'No legal pose within the search budget.' });
    const island = T(x => x > 30 ? 24 : 0);
    expect(findRecoveryPose(ball('land', .3), { x: 0, y: 10, z: 0 }, ctx(island), { maxDistance: 2, anchor: { x: 40, y: 24.4, z: 0 } })).toEqual({ ok: true, position: { x: 40, y: 24.4, z: 0 }, orientation: { yaw: 0, pitch: 0 } });
  });
  it('recovers a turned long body with its own orientation', () => {
    const o = { yaw: Math.PI / 2, pitch: 0 }, r = findRecoveryPose(rod(), { x: 0, y: 10, z: 0 }, ctx(wall, o), { maxDistance: 5 });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.position.x).toBeCloseTo(-Math.SQRT1_2); expect(r.position.z).toBeCloseTo(Math.SQRT1_2); expect(r.orientation).toEqual(o);   // ring 1, j = 6 is the first with its tip clear of x = .8
  });
  it('respects the sky bound', () => {
    const r = findRecoveryPose(ball('sp-air', .3), { x: 0, y: 40, z: 0 }, ctx(flat, undefined, { half: 50, maxY: 30 }), { maxDistance: 30 }); expect(r.ok && r.position.y).toBeCloseTo(20.32);
  });
});
```

Hand checks:
- **Strip:** `r = .2`, `h = .1`; the grid point at `c.x + .2` must not be inside `(10, 11)`, so the last legal centre is `9.8`.
- **Floor:** the centre may go down to `.3` (underside 0, margin 0); 8 bisections of a `.15` substep are within `.0006`.
- **Surface slide, y = 19.69:** the first substep reaches 19.79 (top 20.09); bisection finds `y ≈ 19.7`; the remaining `(≈ .99, ≈ .99)` loses its upward part, and the body slides the full `x = 1`.
- **Turn:** `extent = 1 + .3 = 1.3`, step `≤ .3 / 2.6 = .1154`, `m = ceil(1.5708 / .1154) = 14`, so steps of `.1122`. The capsule has `n = 14` samples, `r' = .3714`, `h = .1857`; the farthest grid offset is `2h = .3714`. Yaw `.3366` puts the tip at `sin(.3366) = .3303`, `.3303 + .3714 = .7017 ≤ .8`; yaw `.4488` gives `.8053 > .8`.
- **Permit expiry:** `N = ceil(3 / .15) = 20`; slot 9 (time `.45`) reaches `20.35` (top 20.65, legal by permit); slot 10 is at time `.5`, where `P` itself is no longer admitted, so the contact is at `P`; the end check fails → `needs-recovery` at `20.35`.
- **Turned rod recovery:** after yaw π/2 the rod spans `x ± 1`; it needs `offset.x + 1 + .3714 ≤ .8`, so `cos(jπ/8) ≤ −.5714`; the first ring-1 point is `j = 6` (135°). All ring-1 `near.y` candidates are at distance 1 and keep generation order.

- [ ] **Step 2: Implement `motion.ts`.** **Step 3: Run.** Expected: PASS, every test in the file. (The multi-capsule recovery regression needs `playerActor`, so it lives in B5's `anchors.test.ts`.)

- [ ] **Step 4: Checkpoint and commit**

```bash
git add src/tiny-tide/motion.ts tests/tiny-tide-core/motion.test.ts
git commit -m "Tiny Tide: interval motion with bisection contacts, permits, recovery and start anchors"
```

---

### Task B5: Mounts, the animated hull, combat poses, mass and the player actor

**Files:**
- Create: `src/tiny-tide/mount.ts`
- Modify: `src/tiny-tide/creature.ts` (attach parts through `resolveMount`; `userData.partUid`, `userData.copy`)
- Test: `tests/tiny-tide-core/mount.test.ts`, `tests/tiny-tide-core/anchors.test.ts`

**Interfaces:**
- Consumes: B1 rig, B2 types and `PARTS` sockets, B3 `supportHeight`, B4 `startAnchor`, Plan A `layout`, `surface`, `partFrame`, `PART_SCALE`, `SPACING`.
- Produces:
  - `Mount { boneIndex: number; local: T.Matrix4; body: T.Matrix4; reflected: boolean }` — `local` is the part root in its bone's space (what `creature.ts` decomposes); `body` is the part root in body space at rest.
  - `resolveMount(g, placed, copy, l?)`, `bodyHull(g)`, `hullOffsets(g, scale)`, `bodyLengthOf(g)` (`front − rear`), `massFor(plan, g, physicalLength) = plan.physics.massPerBodyLength × physicalLength`.
  - `PoseInput { actorId; genome; plan; world: T.Matrix4; rig: RigPose; physicalLength: number }`; `sampleCombatPose(input): CombatPose`.
  - `speciesCombatPose(e, now): CombatPose`.
  - `playerActor(plan, genome, stage, growth): Actor` = `{ id: 'player', hull: hullOffsets(genome, SIZES[stage] × growth), habitat: habitat(plan.habitat), bodyLength: bodyLengthOf(genome) × SIZES[stage] × growth }`.
  - `speciesActor(e: { id: number; spec: Species }): Actor` = `{ id: \`e${e.id}\`, hull: [one sphere of radius ro = .35 × SIZES[tier], centred ro above the origin, sway and heave 0], habitat: habitat(spec.habitatProfileId), bodyLength: SIZES[tier] × 1.4 }` (food models stand on their origin). B6 re-exports it from `ecosystem.ts`.

**Mount (same as today's `attach`).** For copy 1 the angle and roll are negated and `scale.x` is −1. `boneIndex = round((z0 − position.z) / SPACING)` clamped; `local = T(position − boneRest) · R(partFrame(normal, roll)) · S(scale × PART_SCALE, with the mirror sign)`.

**Emitter (spec §8).** For a socket on a pivot `P` of copy `c` of part `u`:
`M = world · bone[boneIndex] · local · pivotToPart(P, posed) · inverse(restPivotToPart(P))`; `origin = M · socket.origin`; `forward = normalize(linear(M) · socket.forward)`; `localToWorld = M.elements`. A socket without a pivot uses `world · bone · local`. At the rest pose the correction is the identity, so the socket is exactly its authored point. `source = { kind: 'part', partUid: u, copy: c, socketId }`.

**Occupancy hull (spec §8).**
- **Segment capsules.** For segment `k` (spine points `k`, `k + 1`): the chord from `(0, lift_k, z_k)` to `(0, lift_{k+1}, z_{k+1})`. Radius = `max(.05, maxCubic(radius), maxCubic(height))` + `maxCubic(|lift − chordLift|)`, where each `maxCubic` is the exact maximum of the Catmull-Rom cubic used by `profile()` on `f ∈ [0, 1]` (endpoints and real roots of the derivative in `[0, 1]`; for the lift difference, the extrema of the cubic minus the linear chord, taking absolute values). This bounds every surface point, because at equal `z` the cross-section lies in a disk of radius `max(r, h)` around `(0, lift)`.
- **Caps.** Front: from spine point 0 to `(0, lift_0, front)` with radius `max(r_0, h_0)`. Rear: from spine point `n − 1` to `(0, lift_{n−1}, rear)` with radius `max(r_{n−1}, h_{n−1})`.
- **Animation envelope** (B1 formulas; `θ_i = SWIM_AMP_MAX × i / (n − 1)` for `i ≥ 1`; `o_i` = rest origin of bone `i`). For a capsule, `dist_i` = the larger horizontal distance from `o_i` to its two ends, plus its radius. For bone `j`:
  - yaw bound `Y_j`: `disp = 0; for i = j down to 1: disp += θ_i × (dist_i + disp)`;
  - chomp bound `C_0 = CHOMP_PITCH × (max 3D distance from o_0 to the capsule ends + radius)`; `C_j = CHOMP_PITCH × |o_1 − o_0|` for `j ≥ 1`.
  - The capsule's bones are: front cap `{0}`; segment `k`: `{k, k + 1}`; rear cap `{n − 1}`. `sway = max over its bones of (Y_j + C_j)`; `heave = max over its bones of C_j`.
- `hullOffsets(g, scale)` multiplies positions, radii, sway and heave by `scale`.

**Combat pose.** `hull` = `bodyHull` moved by `world` (scale included). `hurtboxes` = posed capsules: segment `k` from posed bone origin `k` to posed bone origin `k + 1`, radius without envelope; caps from posed bone 0 / `n − 1` to the posed tips. `emitters` per `emittersOf(g)`. `position` = `world` origin; `forward` = `normalize(linear(world) · (0, 0, 1))`; `mass` = `massFor(plan, g, physicalLength)`; `knockbackResistance` = `plan.physics.knockbackResistance`.

**Species pose.** `speciesCombatPose(e, now)`: one hull sphere (`speciesActor(e).hull` moved to the entity), hurtboxes = hull, and one root emitter `{ source: { kind: 'actor', actorId: \`e${e.id}\`, mountId: 'root', socketId: 'root' }, origin: entity position, forward: (sin heading, 0, cos heading) }`; mass = body length; resistance 0.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/mount.test.ts
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { bodyHull, bodyLengthOf, hullOffsets, massFor, resolveMount, sampleCombatPose } from '../../src/tiny-tide/mount';
import { boneMatricesInto, createRigPose, restBoneMatrices, restRig, rigPoseInto, type RigPose } from '../../src/tiny-tide/rig';
import { layout, surface, SPACING } from '../../src/tiny-tide/body-geometry';
import { starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';
import type { Capsule } from '../../src/tiny-tide/combat-types';

const withPart = (id: string, t: number, angle: number, mirror = true, roll = 0): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p9', id, t, angle, scale: 1, mirror, roll }] });
const pose = (g: Genome, rig: RigPose = restRig(g), world = new T.Matrix4()) => sampleCombatPose({ actorId: 'player', genome: g, plan: plan('speck')!, world, rig, physicalLength: bodyLengthOf(g) });
const ems = (g: Genome, rig?: RigPose, world?: T.Matrix4) => pose(g, rig, world).emitters.filter(e => e.source.kind === 'part' && e.source.partUid === 'p9');
/** Inside the capsule swept by any offset with |horizontal| ≤ sway and |vertical| ≤ heave. */
const inside = (p: T.Vector3, c: Capsule) => {
  for (let k = 0; k <= 64; k++) {
    const f = k / 64, s = new T.Vector3(c.start.x + (c.end.x - c.start.x) * f, c.start.y + (c.end.y - c.start.y) * f, c.start.z + (c.end.z - c.start.z) * f), d = p.clone().sub(s);
    const dh = Math.max(0, Math.hypot(d.x, d.z) - (c.sway ?? 0)), dv = Math.max(0, Math.abs(d.y) - (c.heave ?? 0));
    if (Math.hypot(dh, dv) <= c.radius + 1e-6) return true;
  }
  return false;
};
const extreme: Genome = { ...starterGenome(), spine: [{ radius: 1.2, height: .25, lift: .5 }, { radius: .25, height: 1.2, lift: -.5 }, { radius: 1.2, height: 1.2, lift: 0 }, { radius: .25, height: .25, lift: .5 }] };
const long: Genome = { ...starterGenome(), spine: Array.from({ length: 8 }, (_, i) => ({ radius: .3 + .1 * (i % 3), height: .3 + .1 * ((i + 1) % 3), lift: i % 2 ? .2 : -.2 })) };
/** The renderer's skinned vertices (bodyGeometry: 44 rings × 29 sides, linear blend of two bones). */
const skinned = (g: Genome, rig: RigPose) => {
  const l = layout(g), n = g.spine.length, rest = restBoneMatrices(g), posed = boneMatricesInto(rest.map(m => m.clone()), g, rig), out: T.Vector3[] = [];
  for (let ring = 0; ring <= 44; ring++) for (let side = 0; side <= 28; side++) {
    const t = (1 - Math.cos(Math.PI * ring / 44)) / 2, v = surface(g, l, t, side / 28 * Math.PI * 2).position;
    const f = (l.z[0]! - v.z) / SPACING, i = Math.max(0, Math.min(n - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - i));
    const a = v.clone().applyMatrix4(rest[i]!.clone().invert()).applyMatrix4(posed[i]!), b = v.clone().applyMatrix4(rest[i + 1]!.clone().invert()).applyMatrix4(posed[i + 1]!);
    out.push(a.multiplyScalar(1 - w).add(b.multiplyScalar(w)));
  }
  return out;
};

describe('mounts and combat poses', () => {
  it('places front mounts ahead and rear mounts behind', () => { expect(ems(withPart('claw_pincer', .1, 2))[0]!.origin.z).toBeGreaterThan(0); expect(ems(withPart('claw_pincer', .9, 2))[0]!.origin.z).toBeLessThan(0); });
  it('mirrors the second copy exactly at the rest pose, with reflection', () => {
    const [a, b] = ems(withPart('claw_pincer', .3, 2));
    expect(a!.origin.x).toBeCloseTo(-b!.origin.x); expect(a!.origin.y).toBeCloseTo(b!.origin.y); expect(a!.origin.z).toBeCloseTo(b!.origin.z); expect(a!.forward.x).toBeCloseTo(-b!.forward.x);
    expect(new T.Matrix4().fromArray([...b!.localToWorld]).determinant()).toBeLessThan(0);
  });
  it('animates each copy with its own phase', () => {
    const g = withPart('claw_pincer', .3, 2), rig = rigPoseInto(createRigPose(g), g, .7, 1, 0), [a, b] = ems(g, rig), [ra, rb] = ems(g);
    expect(Math.hypot(a!.origin.x - ra!.origin.x, a!.origin.y - ra!.origin.y, a!.origin.z - ra!.origin.z)).toBeGreaterThan(.01);
    expect(Math.abs(a!.origin.x + b!.origin.x)).toBeGreaterThan(1e-4);   // phases differ by π, so the animated copies are not mirror images
    expect(Math.hypot(b!.origin.x - rb!.origin.x, b!.origin.y - rb!.origin.y, b!.origin.z - rb!.origin.z)).toBeGreaterThan(.01);
  });
  it('keeps a tail socket at its authored point at rest, and moves it when the root segment bends', () => {
    const g = withPart('tail_paddle', 1, 0, false), m = resolveMount(g, g.parts[4]!, 0), authored = new T.Vector3(0, 1.1, 0).applyMatrix4(m.body);
    const rest = ems(g)[0]!; expect(rest.origin.x).toBeCloseTo(authored.x); expect(rest.origin.y).toBeCloseTo(authored.y); expect(rest.origin.z).toBeCloseTo(authored.z);
    const bent = restRig(g); bent.pivots.get('p9:0:seg:0')!.z = .5; const b = ems(g, bent)[0]!;
    expect(Math.hypot(b.origin.x - rest.origin.x, b.origin.y - rest.origin.y, b.origin.z - rest.origin.z)).toBeGreaterThan(.1);
  });
  it('rolls the part around its normal', () => {
    const a = ems(withPart('claw_pincer', .3, Math.PI / 2, false, 0))[0]!, b = ems(withPart('claw_pincer', .3, Math.PI / 2, false, Math.PI / 2))[0]!;
    expect(Math.hypot(a.forward.x - b.forward.x, a.forward.y - b.forward.y, a.forward.z - b.forward.z)).toBeGreaterThan(.5);
  });
  it('points the mouth forward and applies world scale once', () => {
    const bite = pose(starterGenome()).emitters.find(e => e.source.kind === 'part' && e.source.socketId === 'bite')!; expect(bite.forward.z).toBeCloseTo(1);
    const one = ems(withPart('claw_pincer', .1, 2))[0]!, four = ems(withPart('claw_pincer', .1, 2), undefined, new T.Matrix4().makeScale(4, 4, 4))[0]!;
    expect(four.origin.z).toBeCloseTo(one.origin.z * 4);
  });
  it('encloses the rest surface, including the starter regression point', () => {
    for (const g of [starterGenome(), extreme, long]) {
      const l = layout(g), hull = bodyHull(g);
      for (let i = 0; i <= 40; i++) for (let j = 0; j < 24; j++) { const p = surface(g, l, i / 40, j / 24 * Math.PI * 2).position; expect(hull.some(c => inside(p, { ...c, sway: 0, heave: 0 })), `t=${i / 40}`).toBe(true); }
    }
    const p = surface(starterGenome(), layout(starterGenome()), .425, Math.PI / 2).position;   // ≈ (.62010, .01966, .26768): outside a two-endpoint capsule by 1e-4
    expect(bodyHull(starterGenome()).some(c => inside(p, { ...c, sway: 0, heave: 0 }))).toBe(true);
  });
  it('encloses every skinned vertex in the animation envelope', () => {
    for (const g of [starterGenome(), extreme, long]) { const hull = bodyHull(g);
      for (const time of [0, .37, 1.3, 2.9]) for (const swim of [0, 1]) for (const chomp of [0, 1]) {
        const rig = rigPoseInto(createRigPose(g), g, time, swim, chomp);
        for (const v of skinned(g, rig)) expect(hull.some(c => inside(v, c)), `${g.spine.length} ${time} ${swim} ${chomp}`).toBe(true);
      }
    }
    expect(hullOffsets(starterGenome(), 2)[1]!.radius).toBeCloseTo(bodyHull(starterGenome())[1]!.radius * 2);
  });
  it('derives mass and resistance from the plan', () => {
    expect(massFor(plan('bulk')!, starterGenome(), 10)).toBeCloseTo(15); expect(pose(starterGenome()).knockbackResistance).toBe(0);
  });
  it('gives the renderer a reflected local transform for copy 1', () => {
    const g = withPart('claw_pincer', .3, 2), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
    resolveMount(g, g.parts[4]!, 1).local.decompose(p, q, s); expect(s.x).toBeLessThan(0);
  });
});
```

```ts
// tests/tiny-tide-core/anchors.test.ts
import { describe, expect, it } from 'vitest';
import { findRecoveryPose, startAnchor } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { hullExtents, makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { adaptToPlan, starterFor, type Genome } from '../../src/tiny-tide/genome';
import { eligibleChildren, plan, PLANS, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';

describe('start anchors', () => {
  it('exist at growth 1 and 1.38 for every starter, every inherited design and an extreme Colossus', () => {
    const designs: [string, Genome][] = PLANS.filter(p => !p.needs).map(p => [p.id, starterFor(p)]);
    const walk = (path: string[], g: Genome) => { for (const c of eligibleChildren(path, { coast: false })) {
      const a = adaptToPlan(g, c, { unlocked: [] }, 900); if (!a.ok) throw new Error(`${c.id}: ${a.reasons.join('; ')}`); designs.push([c.id, a.genome]); walk([...path, c.id], a.genome); } };
    walk([ROOT_PLAN], starterFor(plan('speck')!));
    const colossus = starterFor(plan('colossus')!); designs.push(['colossus', { ...colossus, spine: colossus.spine.map(s => ({ ...s, radius: 1.2, height: 1.2 })) }]);
    for (const [id, g] of designs) for (const growth of [1, 1.38]) {
      const p = plan(id)!, size = SIZES[p.size]!;
      const r = startAnchor(playerActor(p, g, p.size, growth), p.size, { queries: makeWorldQueries(makeTerrain(p.size)), bounds: { half: PLAYER_HALF * size } });
      expect(r.ok, `${id} growth ${growth}`).toBe(true);
    }
  });
  it('recovers a multi-capsule body with the same inflated extents admission uses', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = makeWorldQueries({ groundAt: () => 0, surface: 20, space: false, slopeBound: 0 }), { top } = hullExtents(actor, { yaw: 0, pitch: 0 });
    const r = findRecoveryPose(actor, { x: 0, y: 21, z: 0 }, { queries: q, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 10 });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.position.y).toBeCloseTo(20 - top - .01 * actor.bodyLength, 6); expect(q.overlapHull(actor, r.position, r.orientation, { time: 0 }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3:** Implement `mount.ts` to the rules. In `creature.ts`, `attach()` decomposes `resolveMount(...).local` into the object's transform and sets `userData.partUid` and `userData.copy`. **Step 4:** Run. Expected: PASS, every test in both files.

  The enclosure tests are the authority. If one fails, fix the hull bound (never the tolerance, the sample grid or the renderer shape) and say which bound was wrong in the commit message.

- [ ] **Step 5: Checkpoint** (including `node e2e/tiny-tide.mjs --visual-only`) **and commit**

```bash
git add src/tiny-tide/mount.ts src/tiny-tide/creature.ts tests/tiny-tide-core/mount.test.ts tests/tiny-tide-core/anchors.test.ts
git commit -m "Tiny Tide: mounts, exact animated hulls, combat poses on the shared rig"
```

---

### Task B6: Species actors, legal installation, pursuit and hazards

**Files:**
- Modify: `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/species.ts` (remove `damage`), `src/tiny-tide/main.ts`, `src/tiny-tide/world.ts` (callers), `tests/tiny-tide.test.ts` (old ecosystem tests)
- Test: `tests/tiny-tide-core/ecosystem.test.ts`

**Interfaces:**
- Consumes: B2–B5.
- Produces:
  - `new Ecosystem(seed, opts?: { queries?: (tier: number) => WorldQueries })`. Default: tier 4 → `makeWorldQueries(makeTerrain(4))`; tiers 0–3 → `makeWorldQueries(makeTerrain(0))` (one physical sea).
  - `EcoContext { stage: number; dt: number; now: number; player: Vec3; playerHull: readonly Capsule[] (world space, already oriented and translated); perceivable: boolean; stealthFactor: number }`.
  - `EcoEvent { type: 'hazard'; entity: Entity; hazard: ContactHazard; damage: number; point: Vec3; normal: Vec3; time: number }`.
  - `speciesActor(e)` — produced by B5 (`mount.ts`), re-exported here. Contacts (hazards, bites) keep `entityRadius(e)` around the origin, as today.
  - `provoke(e, player: Vec3, now: number, hull?: readonly Capsule[])` and `touches(c: Vec3, R: number, hull: readonly Capsule[]): boolean` (exported for tests and Plan C).
  - Entity fields added: `lastKnown: Vec3 | null`, `lastKnownHull: Capsule[] | null`, `lastSeenAt: number`, `reachable: boolean`, `reachableSince: number | null`, `blockedSince: number | null`, `returnUntil: number`, `hazardReadyAt: number`, `active: boolean`; `eco.installFailures: number`.

#### Rules

**Installation (one function for every entry path).** `install(e)`: static props (`isStaticProp`) are skipped. Otherwise `findRecoveryPose(speciesActor(e), current position, { queries: queries(tier), bounds: { half: WORLD_HALF × SIZES[tier] }, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 4 × L })`. On success, the position **and home** become the recovered pose. On failure, `e.eaten = true`, `e.respawn = 2`, `installFailures++` (it retries at the next respawn). It runs: in the constructor; in `reset` after the fresh assignment; at every respawn; and when an entity becomes relevant (`active` goes from false to true, where relevant means `|tier − stage| ≤ 1`).

**Movement.** Each active, non-static, non-`still` entity computes a desired displacement (hunt and angry: toward the target at `speed × size × (angry ? 1.15 : 1) × dt`; flee and return: as today; calm: today's ambient formula, as a displacement), then calls `resolveMotion` with interval `[now, now + dt]`:
- `ground` mode: the vertical part is `supportHeight(actor at the new x, z) + .01 L − y`.
- `surface` mode: the vertical part keeps `y = hy`.
- `swim`, `fly`: free.
- `invalid-start` or `needs-recovery` → `install(e)`.
Inactive tiers keep today's ambient formula with no checks; they cannot interact with the player.

**Perception.** `perceived` = `distance(origin, player) ≤ noticeRadius(e, stage, stealthFactor)` and `visibility(origin, player) > 0` and `ctx.perceivable`.

**Pursuit (hunt and angry; spec §10).** `policy = pursuit(spec.pursuitId)`, `L` as above.
1. **Acquire** in `calm` or `return`, only when `now ≥ returnUntil` (initially 0): perceived and `spec.hunts.includes(stage)` → `hunt`. `provoke(e, player, now)` → `angry` at any time (if `fights` and not eaten). Both set `lastKnown = player`, `lastSeenAt = now`, and run the reachability update below once.
2. **Memory.** Each tick, when perceived: `lastKnown = player`, `lastSeenAt = now`.
3. **Reachability (movement-aware) and the blocked timer.** Memory holds the last **observed** target shape: when the player is perceived, copy `lastKnown = player` and `lastKnownHull = ctx.playerHull` (world-space capsules, copied into reusable per-entity buffers); `provoke(e, player, now, hull?)` records the same snapshot from the bite. A hidden live hull never refreshes it; install, reset and respawn clear it (`null`; with no snapshot the target counts as a point capsule of radius 0 at `lastKnown`). Each tick in `hunt` or `angry`, `reachable` asks whether the hunter can **touch** that remembered shape from a pose its movement can hold: for `swim` and `fly`, the pose is `lastKnown` itself; for `ground` (and `still`), it is `(lastKnown.x, supportHeight(actor, lastKnown.x, lastKnown.z, o0) + .01 L, lastKnown.z)`; for `surface`, it is `(lastKnown.x, hy, lastKnown.z)`. `reachable` = that pose is admitted **and** `touches(pose, entityRadius(e), lastKnownHull)`, where `touches(c, R, hull)` = some capsule has `distanceToSegment(c, start, end) ≤ R + radius` — the **same** helper the hazard check uses. A target inside the hunter's habitat but out of a grounded hunter's touch (for example a body lifted above its own root) is therefore unreachable, and a pitched body that reaches down to the hunter is reachable. When not reachable: `blockedSince ??= now`, `reachableSince = null`. When reachable: `reachableSince ??= now`, and `blockedSince` clears only after `now − reachableSince ≥ BLOCK_CLEAR_SECONDS = 1`. Border jitter therefore never resets the timer, and a target just past the border is given up after the finite wait.
4. **Target.** Perceived → the player (motion stops the body at its own border). Not perceived → `lastKnown`.
5. **Give up** (→ `return`, `returnUntil = now + reacquireSeconds`), checked in this order: `distance(origin, home) > leash × L`; `distance(origin, player) > giveUp × L`; not perceived and `now − lastSeenAt > memorySeconds`; perceived, not reachable and `now − blockedSince > blockedWaitSeconds + memorySeconds`.
6. **Return** → `calm` within one body length of home (horizontal), or at `now ≥ returnUntil + 6`.
7. Prey flee rules stay as today.

**Hazards.** After movement, for each active entity with a `contactHazardId` that applies (mode `hunt` or `angry`, or `stingsStages.includes(stage)`): if `touches(origin, entityRadius(e), playerHull)` and `now ≥ hazardReadyAt`, set `hazardReadyAt = now + cadenceSeconds` and emit `{ type: 'hazard', entity, hazard, damage, point, normal, time: now }`. `damage = hazard.damage + (hunt or angry ? max(0, tier − stage) : 0)`. `point` = the closest point on the hull axis; `normal` = `normalize(point − origin)`, or `(0, 1, 0)` under `1e-6`. The ecosystem does not check damageability; Plan C's pure damage resolution accepts or rejects every event (spec §9).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/ecosystem.test.ts
import { describe, expect, it } from 'vitest';
import { Ecosystem, provoke, speciesActor, type Entity } from '../../src/tiny-tide/ecosystem';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { habitat } from '../../src/tiny-tide/profiles';
import { SIZES, WATER_LEVEL, WORLD_HALF } from '../../src/tiny-tide/biomes';
import { SPECIES } from '../../src/tiny-tide/species';
import type { Terrain, Vec3 } from '../../src/tiny-tide/combat-types';

const hullAt = (p: Vec3, r = .6) => [{ start: p, end: p, radius: r }];
const ctx = (player: Vec3, now: number, extra: { stage?: number; playerHull?: ReturnType<typeof hullAt>; perceivable?: boolean } = {}) =>
  ({ stage: 0, dt: .1, now, player, playerHull: hullAt(player), perceivable: true, stealthFactor: 1, ...extra });
const crabOf = (eco: Ecosystem) => eco.entities.find(e => e.spec.key === '1:crab' && !e.eaten)!;
const at = (e: Entity, dx: number, dy: number, dz = 0) => ({ x: e.x + dx, y: e.y + dy, z: e.z + dz });
const tick = (t: number) => Math.round(t * 10) / 10;
const legal = (e: Entity) => makeWorldQueries(makeTerrain(e.spec.tier === 4 ? 4 : 0))
  .overlapHull(speciesActor(e), { x: e.x, y: e.y, z: e.z }, { yaw: 0, pitch: 0 }, { time: 0, bounds: { half: WORLD_HALF * SIZES[e.spec.tier]! } }).ok;
const legalAll = (eco: Ecosystem) => eco.entities.filter(e => !e.eaten && !habitat(e.spec.habitatProfileId).isStaticProp).every(legal);
const flatSea: Terrain = { groundAt: () => 0, surface: WATER_LEVEL, space: false, slopeBound: 0 };

describe('species installation', () => {
  it('installs every species legally with its full population on four seeds, keeping balloons up and boats afloat', () => {
    for (const seed of [1, 2, 3, 7]) {
      const eco = new Ecosystem(seed); expect(eco.installFailures, `seed ${seed}`).toBe(0); expect(legalAll(eco)).toBe(true);
      for (const s of SPECIES) expect(eco.entities.filter(e => e.spec === s && !e.eaten).length, `${seed} ${s.key}`).toBe(s.count);
      for (const b of eco.entities.filter(e => e.spec.key === '3:balloon')) expect(b.y).toBeGreaterThan(WATER_LEVEL + 100);
      for (const b of eco.entities.filter(e => e.spec.key === '3:boat')) { expect(b.y).toBeGreaterThan(WATER_LEVEL - 10); expect(b.y).toBeLessThan(WATER_LEVEL + 10); }
    }
  });
  it('re-installs on reset to the same legal poses as construction', () => {
    const eco = new Ecosystem(7), installed = eco.entities.map(e => [e.x, e.y, e.z]);
    for (const e of eco.entities) e.y -= 500; eco.reset([]);
    expect(eco.entities.map(e => [e.x, e.y, e.z])).toEqual(installed); expect(legalAll(eco)).toBe(true);
  });
  it('re-installs an entity when its tier becomes relevant', () => {
    const eco = new Ecosystem(7), squid = eco.entities.find(e => e.spec.key === '2:squid')!, far = { x: 0, y: 900, z: 0 };
    eco.step(ctx(far, 0, { stage: 4 })); squid.y = -400; eco.step(ctx(far, .1, { stage: 4 })); expect(squid.y).toBeLessThan(-300);   // inactive: unchecked
    eco.step(ctx(far, .2, { stage: 2 })); expect(squid.eaten || legal(squid)).toBe(true);
  });
});
describe('pursuit', () => {
  it('keeps hunting through a one-frame escape', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), home = at(crab, 0, 0);
    eco.step(ctx(at(crab, 6, 0), 0)); expect(crab.mode).toBe('hunt');
    eco.step(ctx({ x: home.x + 6, y: home.y + 60, z: home.z }, .1)); expect(crab.mode).toBe('hunt');   // 60.3 < give-up 12 × 5.6 = 67.2
    eco.step(ctx(at(crab, 6, 0), .2)); expect(crab.mode).toBe('hunt');
  });
  it('gives up after its memory on a sustained escape and does not re-hunt inside the reacquire window', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco); eco.step(ctx(at(crab, 6, 0), 0));
    let returnedAt = -1;
    for (let t = .1; t <= 6.1; t = tick(t + .1)) { eco.step(ctx(at(crab, 6, 60), t)); if (crab.mode !== 'hunt' && returnedAt < 0) returnedAt = t; }
    expect(returnedAt).toBe(6.1);   // last seen at 0; memory 6; strict >
    eco.step(ctx(at(crab, 3, 0), 6.2)); expect(crab.mode).not.toBe('hunt');   // returnUntil = 8.1, even if it is already calm at home
    eco.step(ctx(at(crab, 3, 0), 8.2)); expect(crab.mode).toBe('hunt');
  });
  it('goes to the last seen point when the target hides, then gives up', () => {
    let visible = true; const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => visible ? 1 : 0 }) });
    const crab = crabOf(eco), start = at(crab, 0, 0); eco.step(ctx(at(crab, 6, 0), 0)); visible = false;
    for (let t = .1; t <= 1; t = tick(t + .1)) eco.step(ctx({ x: start.x - 6, y: start.y, z: start.z }, t));
    expect(crab.mode).toBe('hunt'); expect(crab.x).toBeGreaterThan(start.x);   // toward the old sighting (east), not the hidden player (west)
    for (let t = 1.1; t <= 6.1; t = tick(t + .1)) eco.step(ctx({ x: start.x - 6, y: start.y, z: start.z }, t));
    expect(crab.mode).toBe('return');
  });
  it('gives up on a visible but unreachable target after wait plus memory', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), above = { x: crab.x, y: g + 9.5, z: crab.z };   // floor gap 9.5 > 1.6 × 5.6 = 8.96
    eco.step(ctx(above, 0)); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(above, t)); expect(crab.mode).toBe('hunt');
    eco.step(ctx(above, 9.1)); expect(crab.mode).toBe('return');   // blocked since 0; 3 + 6 = 9; strict >
  });
  it('gives up on a target hovering inside its habitat but out of a grounded reach', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), hover = { x: crab.x, y: g + 8.5, z: crab.z };   // 8.5 ≤ 8.96 is admitted, but 8.5 − (support offset) > 3.4
    eco.step(ctx(hover, 0)); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(hover, t)); expect(crab.mode).toBe('hunt');
    eco.step(ctx(hover, 9.1)); expect(crab.mode).toBe('return');
  });
  it('tests touch against the remembered body, not a sphere at its root', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z);
    const root = { x: crab.x, y: g + 4.5, z: crab.z }, lifted = [{ start: { x: root.x, y: root.y + 2, z: root.z - 1 }, end: { x: root.x, y: root.y + 2, z: root.z + 1 }, radius: 2 }];
    eco.step(ctx(root, 0, { playerHull: lifted })); expect(crab.mode).toBe('hunt'); expect(crab.reachable).toBe(false);   // axis ≈ 6.5 − offset > 2.8 + 2, though the root is within 4.8
    for (let t = .1; t <= 9; t = tick(t + .1)) eco.step(ctx(root, t, { playerHull: lifted }));
    eco.step(ctx(root, 9.1, { playerHull: lifted })); expect(crab.mode).toBe('return');
    const eco2 = new Ecosystem(7), crab2 = crabOf(eco2), high = { x: crab2.x, y: g + 6, z: crab2.z };
    const reaching = [{ start: high, end: { x: crab2.x, y: g + .5, z: crab2.z + .5 }, radius: .6 }];   // pitched down to the crab
    eco2.step(ctx(high, 0, { playerHull: reaching })); expect(crab2.reachable).toBe(true);
  });
  it('keeps the blocked timer through border jitter and gives up after the finite wait', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), gap = (h: number) => ({ x: crab.x, y: g + h, z: crab.z });
    eco.step(ctx(gap(2), 0)); expect(crab.reachable).toBe(true); expect(crab.blockedSince).toBeNull();   // within touch: 2 − offset ≤ 2.8 + .6
    let t = .1; for (; t <= 9.1; t = tick(t + .1)) { eco.step(ctx(gap(Math.round(t * 10) % 2 ? 5 : 2), t)); expect(crab.blockedSince).toBe(.1); }   // 5 is out of touch; 2 is in touch for only .1 s
    expect(crab.mode).toBe('hunt'); eco.step(ctx(gap(5), 9.2)); expect(crab.mode).toBe('return');   // 9.2 − .1 > 3 + 6
  });
  it('clears the blocked timer after one second of reachability', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), g = makeTerrain(0).groundAt(crab.x, crab.z), gap = (h: number) => ({ x: crab.x, y: g + h, z: crab.z });
    eco.step(ctx(gap(2), 0)); eco.step(ctx(gap(5), .1)); expect(crab.blockedSince).toBe(.1);
    for (let t = .2; t <= 1.1; t = tick(t + .1)) eco.step(ctx(gap(2), t)); expect(crab.blockedSince).not.toBeNull();   // reachable since .2: .9 s so far
    eco.step(ctx(gap(2), 1.3)); expect(crab.blockedSince).toBeNull();                                                   // 1.1 s ≥ 1
  });
  it('lets the leash win while the player is still seen', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco); eco.step(ctx(at(crab, 6, 0), 0)); crab.hx = crab.x - 200;   // 200 > 30 × 5.6 = 168
    eco.step(ctx(at(crab, 6, 0), .1)); expect(crab.mode).toBe('return');
  });
  it('perceives with visibility and the perceivable flag, independent of damage', () => {
    const hidden = new Ecosystem(9, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), a = crabOf(hidden);
    hidden.step(ctx(at(a, 5, 0), 0)); expect(a.mode).toBe('calm');
    const eco = new Ecosystem(9), b = crabOf(eco); eco.step(ctx(at(b, 5, 0), 0, { perceivable: false })); expect(b.mode).toBe('calm');
  });
});
describe('provocation and hazards', () => {
  it('lets a provoked crab retaliate against a bigger stage-1 player it cannot see', () => {
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), crab = crabOf(eco), p = at(crab, 0, 0);
    provoke(crab, p, 0); expect(crab.mode).toBe('angry'); expect(crab.lastKnown).toEqual(p);
    const events = eco.step(ctx(p, 0, { stage: 1 })).filter(e => e.entity === crab); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(2);   // 2 + max(0, 1 − 1)
  });
  it('lets a provoked ray retaliate with its own policy and forget a hidden player', () => {
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
    provoke(ray, at(ray, 10, 0), 0); expect(ray.mode).toBe('angry');
    for (let t = .1; t <= 4; t = tick(t + .1)) eco.step(ctx(at(ray, 10, 0), t, { stage: 2 })); expect(ray.mode).toBe('angry');
    eco.step(ctx(at(ray, 10, 0), 4.1, { stage: 2 })); expect(ray.mode).toBe('return');   // retaliate memory 4
  });
  it('emits a hazard at t = 0 and the next only after the cadence, from the translated hull', () => {
    // Flat ground keeps the grounded crab's support height constant, so its centre stays exactly on the player point.
    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(tier === 4 ? makeTerrain(4) : flatSea) }), crab = crabOf(eco), events: ReturnType<Ecosystem['step']> = [];
    eco.step(ctx({ x: 0, y: 500, z: 0 }, 0, { perceivable: false, playerHull: [] }));   // settle onto the flat ground first
    for (let i = 0; i <= 14; i++) events.push(...eco.step(ctx(at(crab, 0, 0), i / 10)).filter(e => e.entity === crab));
    expect(events.map(e => e.time)).toEqual([0, 1.4]); expect(events[0]!.damage).toBe(3); expect(events[0]!.normal).toEqual({ x: 0, y: 1, z: 0 });   // 2 + (1 − 0); coincident centres
  });
  it('emits nothing when the hull is far away, even while the player point is seen', () => {
    const eco = new Ecosystem(7), crab = crabOf(eco), events: ReturnType<Ecosystem['step']> = [];
    for (let i = 0; i <= 14; i++) events.push(...eco.step(ctx(at(crab, 0, 0), i / 10, { playerHull: hullAt(at(crab, 100, 0)) })).filter(e => e.entity === crab));
    expect(events).toEqual([]); expect(crab.mode).toBe('hunt');
  });
});
```

Numbers: the crab's body length is `SIZES[1] × 1.4 = 5.6`; its notice radius at stage 0 is `2.5 × 4 = 10`; its floor gap limit is `1.6 × 5.6 = 8.96`; its contact radius is `.7 × 4 = 2.8`, so with the test hull radius `.6` it can touch a target whose origin is within `3.4`. The ray's body length is `16 × 1.4 = 22.4`.

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3:** Implement to the rules. Remove `Species.damage` and the old `attack`/`sting` events.

- [ ] **Step 4: Callers.**
  - `main.ts`: `world.eco.step({ stage, dt, now: time, player: world.physical(), playerHull: <a world-space sphere at the player, radius .9 × growth × world.scale> , perceivable: mode === 'playing', stealthFactor })`. Plan C replaces the sphere with the real hull. For each event, keep today's guard: `takeHit` still returns unless `mode === 'playing' && grace <= 0`.
  - `provoke(e)` → `provoke(e, world.physical(), time)`.
  - `world.ts` menu step: `perceivable: false`, `playerHull: []`.
  - `tests/tiny-tide.test.ts`: every `'attack'`/`'sting'` event becomes `'hazard'`; the old "invulnerable player" test now asserts that perception does not depend on damage (the ecosystem no longer has a damage flag).

- [ ] **Step 5: Run and checkpoint**, including `node e2e/tiny-tide.mjs --visual-only`. If the installation test reports a failure, report the entity and its spawn; do not loosen the test.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/ecosystem.ts src/tiny-tide/species.ts src/tiny-tide/main.ts src/tiny-tide/world.ts tests
git commit -m "Tiny Tide: species install legally, pursue by perception with hysteresis, hazards with cadence"
```

---

### Task B7: Food approach for each way of moving

**Files:**
- Create: `src/tiny-tide/food-access.ts`
- Modify (data only, when a test demands it): `src/tiny-tide/species.ts`
- Test: `tests/tiny-tide-core/food.test.ts`

**Interfaces:**
- Consumes: B2–B6, `inReach`, `STAGES`, `mealDna` (Plan A).
- Produces:
  - `type Traversal = { kind: 'none' } | { kind: 'active'; permit: TraversalPermit; now: number } | { kind: 'hypothetical-breach'; now: number }`
  - `canApproachFood(actor, mode: MovementMode, food: { x; y; z; radius }, bite: { stage; growth; reach }, ctx: LegalityContext & { traversal?: Traversal }): boolean`
  - `reachableFoodDna(plan, diet, seed, opts: { peacefulOnly: boolean }): number`

**Search (spec §3, "Food access").** `size = SIZES[stage]`; `R = (STAGES[stage].radius × growth + .5 + reach) × size + food.radius`; `V = ((stage === 0 ? 2 : 2.2) + reach / 2) × size + food.radius`.
- Offsets: the food's x/z, then 8 directions at `.45 R` and at `.9 R`. Yaw faces the food (`atan2(food.x − x, food.z − z)`, 0 at the centre); pitch 0.
- **Ground and burrow modes:** one height only: `supportHeight + .01 L` (the same rule as Plan C's ground movement).
- **Surface mode:** the B4 surface-band heights only.
- **Free modes** (`swim`, `fly`, `glide`, `space`): `food.y`, `food.y ± .9 V`, and the B4 recovery heights, each clamped into `[food.y − V, food.y + V]`.
- **Traversal:** `active` → admission at `now` with that permit (it fails before `startsAt` and at `expiresAt`); `hypothetical-breach` → admission with `breachPermit(now)` at `now`, and heights above `surface + BREACH_RISE × size` are dropped.
- A candidate counts when it is admitted and `inReach(stage, c / size, food / size, growth, reach, food.radius / size)` holds (the bite rule, unchanged). Approach never vetoes a bite.

**Budget.** `reachableFoodDna` builds `new Ecosystem(seed)` (the **installed** live population), takes the live entities of tier `plan.size` whose tag the diet can eat, and, when `peacefulOnly`, drops species that hunt or sting this size or that fight. It sums `mealDna(plan, diet, spec)` for those where `canApproachFood(actor, mode, food, bite, ctx)` is true, with `actor = playerActor(plan, starterFor(plan), size, 1)`, `mode = movement(plan.movement).mode`, `food = { x, y, z, radius: 0 }` (own-tier food, as `biteTargets` uses), `bite = { stage: size, growth: 1, reach: derive(effectiveStats(starter, plan)).reach }` (the derived bonus the live bite uses: `.45 ×` the stat), and `ctx = { queries, bounds, traversal: caps.breach ? { kind: 'hypothetical-breach', now: 0 } : { kind: 'none' } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/food.test.ts
import { describe, expect, it } from 'vitest';
import { canApproachFood, reachableFoodDna } from '../../src/tiny-tide/food-access';
import { playerActor } from '../../src/tiny-tide/mount';
import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { breachPermit, habitat } from '../../src/tiny-tide/profiles';
import { eligibleChildren, plan, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { starterFor } from '../../src/tiny-tide/genome';
import { STAGES } from '../../src/tiny-tide/state';
import { populate, WATER_LEVEL } from '../../src/tiny-tide/biomes';
import type { Actor, Terrain } from '../../src/tiny-tide/combat-types';

const visible = () => { const out: string[] = []; const walk = (path: string[]) => { out.push(path.at(-1)!); for (const c of eligibleChildren(path, { coast: false })) walk([...path, c.id]); }; walk([ROOT_PLAN]); return [...new Set(out)]; };
const dietsOf = (size: number) => size >= 3 ? (['herbivore'] as const) : (['herbivore', 'carnivore', 'omnivore'] as const);
const sea = (stage: number) => ({ queries: makeWorldQueries(makeTerrain(stage)) });

describe('food approach', () => {
  it('lets a wading Colossus reach the first seed-1 boat', () => {
    const p = plan('colossus')!, boat = populate(1).find(s => s.spec.key === '3:boat')!;
    expect(canApproachFood(playerActor(p, starterFor(p), 3, 1), 'ground', { ...boat, radius: 0 }, { stage: 3, growth: 1, reach: 0 }, sea(3))).toBe(true);
  });
  it('does not let a Shellback reach a gull', () => {
    const p = plan('shellback')!, gull = populate(1).find(s => s.spec.key === '2:bird')!;
    expect(canApproachFood(playerActor(p, starterFor(p), 2, 1), 'ground', { ...gull, radius: 0 }, { stage: 2, growth: 1, reach: 0 }, sea(2))).toBe(false);
  });
  it('does not count hovering food for a grounded body that cannot rise to it', () => {
    const flat: Terrain = { groundAt: () => 0, surface: 85, space: false, slopeBound: 0 }, q = { queries: makeWorldQueries(flat) };
    const a: Actor = { id: 'p', hull: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 2.5 }], habitat: habitat('seabed'), bodyLength: 10 };
    const food = { x: 0, y: 18, z: 0, radius: 0 }, bite = { stage: 1, growth: 1, reach: 0 };
    expect(canApproachFood(a, 'ground', food, bite, q)).toBe(false);   // support 2.5 + .1: |2.6 − 18| = 15.4 > V = 2.2 × 4 = 8.8
    expect(canApproachFood(a, 'swim', food, bite, q)).toBe(true);      // 18 − .9 × 8.8 = 10.08; lowest 7.58 ≤ 1.1 × 10
  });
  it('separates an active Breach from a hypothetical one, and respects the permit times', () => {
    const p = plan('darter')!, a = playerActor(p, starterFor(p), 2, 1), gull = { x: 0, y: WATER_LEVEL + 36, z: 0, radius: 0 }, bite = { stage: 2, growth: 1, reach: 0 };
    expect(canApproachFood(a, 'swim', gull, bite, sea(2))).toBe(false);
    expect(canApproachFood(a, 'swim', gull, bite, { ...sea(2), traversal: { kind: 'hypothetical-breach', now: 0 } })).toBe(true);
    const permit = breachPermit(10);
    for (const [now, ok] of [[9.9, false], [10, true], [11.89, true], [11.9, false]] as const) expect(canApproachFood(a, 'swim', gull, bite, { ...sea(2), traversal: { kind: 'active', permit, now } }), `${now}`).toBe(ok);
  });
  it('gives every visible plan and diet a peaceful food supply worth more than its goal, on three seeds', () => {
    for (const id of visible()) { const p = plan(id)!; if (p.size === 4) continue;
      for (const diet of dietsOf(p.size)) for (const seed of [1, 2, 3]) expect(reachableFoodDna(p, diet, seed, { peacefulOnly: true }), `${id} ${diet} ${seed}`).toBeGreaterThan(STAGES[p.size]!.goal);
    }
  });
});
```

The gull at `85 + 36 = 121`: the Darter (size 2) is limited to water without a permit; its highest centre is `85 − top − ε`, about 76, and `|121 − 76| / 16 ≈ 2.8 > 2.2`. With a Breach the air is legal and `121 ≤ 85 + 3.8 × 16 = 145.8`. At sizes 3 and 4 all food is `any`, so one diet stands for all three.

- [ ] **Step 2: Implement and run.**

  If the supply test fails for a plan and diet, change only data in `species.ts`: raise the `count` of a **peaceful** species of the right tag in that tier by the smallest amount that passes. Never change hazards or hunters here. List every changed count, with the measured totals before and after, in the commit message and in the task report to the owner.

- [ ] **Step 3: Checkpoint and commit**

```bash
git add src/tiny-tide/food-access.ts src/tiny-tide/species.ts tests/tiny-tide-core/food.test.ts
git commit -m "Tiny Tide: food approach that respects each way of moving"
```

Avoidance acceptance (spec §3) needs the real player step, so it is Plan C Task C5.

---

## Self-review notes

**Round-3 findings answered here:**

| Finding | Where |
| --- | --- |
| T-R3-01 item 4 (rename without consumer) | B2 changes the ecosystem read in the same task |
| T-R3-02 (`newRuntime`, `WorldQueries`, actor for refuges) | B2 types and `newRuntime`; B3 `overlapHull(actor, …)` |
| T-R3-03, C-R3-03 (pivot identity, mirror test, socket space) | B1 `kind:index` keys and Python cross-check; B5 rest mirror test, per-copy animation test, posed × inverse(rest) |
| T-R3-04 (hull enclosure) | B5 exact cubic extrema, lift deviation, animation envelope; skinned-vertex test |
| T-R3-05 (hazard hull at the origin) | B6 translated hull and far-hull negative control |
| T-R3-09, C-R3-07 (emitter-level delta, catalog seam) | B2 `designDelta`; catalogs passed to `validateRun`/`applyDesign` |
| T-R3-10, C-R3-01 (conservative admission) | B3 grid rule with added margin, full-extent bounds, lateral media points, flank refuge, dense check |
| T-R3-11 (normals) | B4 bisection and constraint normals; slide test at three gaps |
| T-R3-15 (installation paths, balloon, per-tier queries) | B6 `install` on construct, reset, respawn and relevance; balloon `sp-air` |
| T-R3-16, C-R3-04 (provoke, hidden targets, hysteresis, retaliate) | B6 |
| T-R3-17, G3-3 A (food approach) | B7 maintainable heights and traversal kinds |
| T-R3-21, G3-3 B (avoidance) | Plan C Task C5 |
| T-R3-24 (rig allocation) | B1 reusable `RigPose` |
| T-R3-25, C-R3-08 (enumerated validation, write vs compare, species emitter) | B2 list and mutation tests; B1 `--write-rig`; B5 `speciesCombatPose` |
| C-R3-05 (needs-recovery, wading with null gap, bounds in recovery) | B3 wading rule; B4 end-of-interval check and recovery context |

**Known judgment calls:** the conservative ground rule rejects some poses that do not touch the ground (about `.22 r'` of margin on flat ground with the global slope bound); species occupancy spheres are lifted because food models stand on their origin; chomp now nods only the head. The tests decide every numeric bound; the implementer must not weaken them.
