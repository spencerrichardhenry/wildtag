// The combat contract: plain data types shared by profiles, registries, motion, mounts and the ecosystem.
// Ownership rules: positions and velocities are physical (not stage-local); `CombatRuntime` is never saved;
// cooldown keys are `${actorId}:${partUid}:${grantId}`; hit ledger keys are `${actionInstanceId}:${hitGroupId}:${targetId}`;
// hit resolution order is guard/counter -> immunity -> damage -> stagger -> impulse; an impulse changes `externalVelocity`
// by `impulse / mass x (1 - knockbackResistance)`; cooldowns start at the end of recovery; the resolver never owns a velocity.
import type { Medium } from './plans';
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type MutVec3 = { x: number; y: number; z: number };
export type PartUid = string; export type ActorId = string; export type ActiveSlot = 0 | 1 | 2 | 3;
export type Tuple4<T> = [T, T, T, T];
export type MoveKind = 'grab' | 'counter' | 'brace' | 'dash' | 'sweep';
export type SlotClass = 'defense' | 'movement' | 'attack';
/** The fixed slot priority (R1): defense, then movement, then attack. */
export const MOVE_PRIORITY: readonly MoveKind[] = ['brace', 'counter', 'dash', 'grab', 'sweep'];
export const SLOT_CLASS: Readonly<Record<MoveKind, SlotClass>> = { brace: 'defense', counter: 'defense', dash: 'movement', grab: 'attack', sweep: 'attack' };
export type SlotPin = MoveKind | null;
export type CombatTrait = 'weapon' | 'protection' | 'locomotion' | 'concealment';
export type MovementMode = 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
export interface PivotRef { kind: 'jaw' | 'seg' | 'flap' | 'swing'; index: number }
export interface CombatSocket { id: string; pivot?: PivotRef; origin: Vec3; forward: Vec3 }   // part space, at rest
export interface AttackGrant { id: string; attackId: string; socketIds: readonly string[] }
export interface ActiveGrant { id: string; abilityId: string; socketIds: readonly string[]; mirrorPolicy: 'shared-cast' }
export interface PartCombatFields { traits: readonly CombatTrait[]; sockets: readonly CombatSocket[]; basicAttacks: readonly AttackGrant[]; activeGrants: readonly ActiveGrant[] }
export interface AbilityBinding { partUid: PartUid; grantId: string }
export interface CombatLoadout { active: [AbilityBinding | null, AbilityBinding | null] }
/** Shape numbers are in attacker body lengths (L_a), in the aim frame (z = aim). A capsule with start = end is a sphere. */
export type AttackShape = { kind: 'cone'; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
/** value = base × (1 + k × (scale − 1)); one k per parameter key (moves.ts `resolveMove` names the key syntax). */
export type MoveScaling = Readonly<Record<string, number>>;
/** A mirrored pair: value × multiply[key] + add[key], applied before the one rounding. */
export interface PairBonus { multiply: Readonly<Record<string, number>>; add: Readonly<Record<string, number>> }
export type AimMode = 'input' | 'body-back' | 'centre' | 'fixed-at-start';
export interface AttackHold { seconds: number; sizeFactor: number; startHalfHearts: number; squeezeHalfHearts: number; squeezeEverySeconds: number }
export interface AttackSpec { id: string; shape: AttackShape; poseProfileId: string; windupSeconds: number; activeSeconds: number; recoverySeconds: number; cooldownSeconds: number;
  aimLockAtSeconds: number; maxTrackingRadiansPerSecond: number; damage: number; impulse: number; staggerSeconds: number; blockable: boolean; parryable: boolean; interruptible: boolean;
  maxTargets: number; hitGroup: 'shared-grant' | 'per-emitter'; maxHitsPerTarget: number; repeatHitSeconds: number; crossing: 'same-medium' | 'water-surface' | 'any-medium'; obstruction: 'terrain-and-cover'; telegraphProfileId: string;
  /** 'hp' for player attacks, 'half-heart' for species attacks. */
  damageUnit: 'hp' | 'half-heart'; aimMode: AimMode;
  /** Locomotion factor during windup and active. */
  moveSpeedFactor: number; poiseDamageMultiplier: number;
  /** The attacker moves along the aim during active. */
  lunge?: { distanceBodyLengths: number };
  hold?: AttackHold;
  /** Recovery when the attack hit nothing (grabs). */
  whiffRecoverySeconds?: number;
  /** A status applied on hit (ink). */
  statusEffectId?: string;
  /** Player attacks only. */
  scaling?: MoveScaling; pair?: PairBonus | null }
export interface AbilitySpec { id: string; cooldownSeconds: number; allowedMotionModes: readonly MovementMode[]; effectProfileId: string;
  kind: MoveKind; label: string; input: 'press' | 'hold';
  /** grab, sweep */
  attackId?: string;
  /** brace, counter */
  guardProfileId?: string;
  /** dash */
  evasionProfileId?: string;
  scaling: MoveScaling; pair: PairBonus | null }
export interface GuardProfile {
  id: string; kind: 'brace' | 'counter';
  startupSeconds: number; minActiveSeconds: number;
  /** Counter only. */
  windowSeconds: number | null;
  /** Brace only; radians. */
  frontHalfAngle: number | null;
  blockFraction: number;
  /** Brace only. */
  breakHalfHearts: number | null; breakStaggerSeconds: number; brokenCooldownSeconds: number;
  moveSpeedFactor: number; yawRateFactor: number;
  /** Counter only. */
  reflectDamage: number; attackerStaggerSeconds: number;
  recoverySeconds: number; whiffRecoverySeconds: number; successCooldownSeconds: number;
}
export interface EvasionProfile { id: string; distanceBodyLengths: number; startupSeconds: number; travelSeconds: number; recoverySeconds: number; plane: 'free' | 'horizontal'; endSpeedCarry: number }
export interface TelegraphProfile { id: string; color: 'amber' | 'red' | 'none'; pattern: 'solid' | 'stripes'; poseCue: 'rear' | 'crouch' | 'inflate' | 'coil' | 'burrow' | 'spin' | 'none'; flashLeadSeconds: number; edgeArrow: boolean }
export interface EffectProfile { id: string; kind: 'feedback' | 'status'; status?: { id: 'inked'; seconds: number; speedFactor: number }; sound: 'hit' | 'block' | 'counter' | 'dash' | 'grab' | 'break' | 'none'; particles: string }
/** The numbers of one move after size and pair (spec §7.3): resolved copies of the specs it came from, with their own field names.
 *  A species attack resolves to itself (kind 'species'). */
export interface ResolvedMove {
  kind: MoveKind | 'bite' | 'species';
  /** The ability of a slot move, else null. */
  abilityId: string | null;
  label: string; input: 'press' | 'hold';
  attack: AttackSpec | null; guard: GuardProfile | null; evasion: EvasionProfile | null;
  cooldownSeconds: number; allowedMotionModes: readonly MovementMode[];
}
export interface ContactHazard { id: string; damage: number; cadenceSeconds: number; invulnerabilitySeconds: number; impulse: number }
export interface HabitatProfile { id: string; media: readonly Medium[]; maxWaterDepthBodyLengths: number | null; maxFloorGapBodyLengths: number | null; maxLandSlopeRadians: number;
  surfaceBandBodyLengths: number | null; wadingSupportBodyLengths: number | null; refugeTags: readonly string[]; isStaticProp?: boolean }
export interface MovementProfile { id: string; mode: MovementMode; speedMultiplier: number; acceleration: number; braking: number; maxYawRate: number; maxPitchRate: number;
  facing: 'move' | 'aim' | 'lock-during-action'; evasionProfileId?: string }
export interface PursuitPolicy { id: string; memorySeconds: number; blockedWaitSeconds: number; reacquireSeconds: number; leashBodyLengths: number; giveUpBodyLengths: number }
export interface SpeciesCombatFields { movementProfileId: string; habitatProfileId: string; hullProfileId: string; attackMountProfileId: string; attackIds: readonly string[]; contactHazardId?: string; pursuitId: string;
  /** Only combat species (with a behaviour) use the action engine (bestiary.ts). */
  behaviourId?: string }
export interface EnvironmentSample { medium: Medium; groundHeight: number; surfaceHeight: number | null; waterDepth: number; groundClearance: number; groundNormal: Vec3; coverIds: readonly string[]; refugeId: string | null }
/** sway: horizontal and heave: vertical animation envelope. The swept volume is the capsule moved by any such offset. Against the
 *  solids, admission holds each sample sphere r as the ellipsoid of semi-axes r + sway (horizontal) and r + heave (vertical)
 *  (solids.ts sphereEnvelope), which covers less than the swept volume toward the diagonals: by less than (1 − 1/√2)(sway + heave)
 *  (largest ratio found numerically over r, sway, heave in (0, 1]: .248), and by .012–.071 L for the starter bodies, about 63° below
 *  the horizontal (fix round 4; re-review 3 m2).
 *  radii (optional): a tapered capsule. Its cross-section in each plane of constant body z between the ends is the disc around the
 *  axis point with a radius that goes linearly from radii[0] at start to radii[1] at end, plus a ball of that radius on each end (both
 *  ≤ radius). Admission's tight sample spheres use it; every other user may treat it as the capsule of `radius`, which holds it. */
export interface Capsule { start: Vec3; end: Vec3; radius: number; radii?: readonly [number, number]; sway?: number; heave?: number }
export type EmitterSource = { kind: 'part'; partUid: PartUid; copy: 0 | 1; socketId: string } | { kind: 'actor'; actorId: ActorId; mountId: string; socketId: string };
export interface Emitter { source: EmitterSource; origin: Vec3; forward: Vec3; localToWorld: readonly number[] }
export interface CombatPose { actorId: ActorId; position: Vec3; forward: Vec3; bodyLength: number; mass: number; knockbackResistance: number; hull: readonly Capsule[]; hurtboxes: readonly Capsule[]; emitters: readonly Emitter[] }
export interface Orientation { yaw: number; pitch: number }
export interface TraversalPermit { id: string; startsAt: number; expiresAt: number; media: readonly Medium[]; landingRequired: boolean }
/** How admission fits the hull to the terrain. 'conservative' (the default): sample spheres r + s/2 and a first-order ground grid
 *  (every point of the hull is outside the ground). 'tight' (the swim plans, owner playtest P3): sample spheres that cover the capsule
 *  exactly and a finer ground grid with a second-order margin, so the body stops close to its visible belly (world-queries.ts). */
export type HullFit = 'conservative' | 'tight';
export interface Actor { id: ActorId; hull: readonly Capsule[]; habitat: HabitatProfile; bodyLength: number; fit?: HullFit }   // hull in body space, physical scale, not oriented
/** slopeBound bounds |∇groundAt|; curvatureBound (default 0, for planar terrains) bounds the spectral norm of its Hessian. */
export interface Terrain { groundAt(x: number, z: number): number; surface: number; space: boolean; slopeBound: number; curvatureBound?: number }
export type Constraint = 'ground' | 'surface-top' | 'floor-gap' | 'depth' | 'water' | 'land-band' | 'air' | 'space' | 'bounds-x' | 'bounds-z' | 'bounds-y' | 'refuge' | 'solid';
export interface AdmissionContext { time: number; permit?: TraversalPermit | null; bounds?: { half: number; maxY?: number } }
/** On failure, `normal` is the unit direction back into the admitted region at `point` (motion uses it for contacts).
 *  `solidId`: the decoration solid (reef.ts) of a 'solid' refusal. */
export interface Admission { ok: boolean; constraint: Constraint | null; point: Vec3 | null; normal: Vec3 | null; solidId?: string }
export interface WorldQueries {
  terrain: Terrain;
  sampleEnvironment(p: Vec3): EnvironmentSample;
  visibility(from: Vec3, to: Vec3): number;
  refugeAt(p: Vec3): string | null;                                                   // for environment samples only
  refugeOverlap(world: readonly Capsule[]): { id: string; normal: Vec3 } | null;    // extent-aware: the first refuge the posed hull touches
  refugeAccess(actor: Actor, refugeId: string): boolean;
  overlapHull(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext): Admission;
  /** The top (largest y) of a decoration solid by id, when these queries have solids (the ground step-over, fix round 2). */
  solidTop?(id: string): number | undefined;
  /** Combat obstruction (spec §5.11): false when a sample at most `step` apart on the segment is under the ground or inside a reef solid. */
  segmentClear?(a: Vec3, b: Vec3, step: number): boolean;
}
export interface LegalityContext { queries: WorldQueries; bounds?: { half: number; maxY?: number } }
export interface MotionRequest { actorId: ActorId; from: Vec3; displacement: Vec3; orientation: Orientation; turn?: Orientation; hull: readonly Capsule[]; habitatProfileId: string;
  cause: 'locomotion' | 'dash' | 'knockback' | 'recovery' | 'lunge' | 'grab'; traversalPermit?: TraversalPermit | null;
  /** When set, a slide after a contact never lifts the body more than this above `from` (a ground body's support-following rise). */
  riseCap?: number }
export interface Contact { point: Vec3; normal: Vec3; constraint: Constraint; distanceFraction: number; time: number; solidId?: string }
export interface MotionResult { status: 'moved' | 'blocked' | 'clamped' | 'invalid-start' | 'needs-recovery'; position: Vec3; orientation: Orientation; contacts: readonly Contact[]; unconsumed: Vec3; time: number }
export type RecoveryResult = { ok: true; position: Vec3; orientation: Orientation } | { ok: false; reason: string };
export type ActionPhase = 'windup' | 'active' | 'hold' | 'recovery' | 'interrupted';
export type WorldShape = { kind: 'cone'; apex: Vec3; axis: Vec3; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
export type HitOutcome = 'countered' | 'blocked' | 'guard-broken' | 'evaded' | 'immune' | 'hit' | 'grabbed';
/** `startedAt` is world time (the resolver's processing order); every other time is the actor's action clock.
 *  Ledger keys (hitCounts, lastHitAt) are `${instanceId}:${hitGroupId}:${targetId}`. */
export interface ActionState { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; phase: ActionPhase; startedAt: number; aim: MutVec3; committedPose: CombatPose | null;
  hitCounts: Map<string, number>; lastHitAt: Map<string, number>;
  /** Action-clock seconds. */
  phaseStartedAt: number; aimLocked: boolean;
  /** Numbers after size and pair (§7.3); species: the spec itself. */
  resolved: ResolvedMove;
  /** The actor the attacker aimed at (director, telegraph). */
  targetId: ActorId | null;
  heldTarget: ActorId | null; windupExtension: number; released: boolean;
  /** A Counter that countered a hit (it ends with no recovery). */
  countered: boolean;
  /** The attack landed (hit, grabbed, blocked or guard-broken); a grab that did not connect recovers for `whiffRecoverySeconds`. */
  connected: boolean;
  /** Body lengths a lunge has moved. */
  lungeDone: number;
  /** The world shapes fixed at the lock (a mirrored pair has two), or null before it. */
  lockedShapes: WorldShape[] | null;
  /** Squeezes dealt in the hold phase. */
  squeezes: number;
  /** A Counter only: the instance ids of the parryable attacker actions it was open at the active start of (review R5, hit-resolver.ts armCounters). */
  armedAgainst?: string[];
  /** The cooldown key (contract: `${actorId}:${partUid}:${grantId}`; species `${actorId}:root:${attackId}`). */
  cooldownKey: string }
/** `endY`: the height the arc ends at, fixed when it starts (player-motion.ts `breachEndY`). */
export interface BreachArc { startedAt: number; duration: number; fromY: number; endY: number }
/** `invulnerableUntil`, `hitStopUntil`, `status.until`, `lastDamageAt` and `lastThreatAt` are world time; `staggerUntil`, cooldown ready times and
 *  `buffered.at` are action-clock seconds (spec §5.1). */
export interface CombatRuntime { targetable: boolean; perceivable: boolean; damageable: boolean; invulnerableUntil: number; staggerUntil: number; guardProfileId: string | null;
  controlledVelocity: MutVec3; externalVelocity: MutVec3; orientation: Orientation; cooldowns: Map<string, number>; actions: ActionState[]; permit: TraversalPermit | null;
  arc: BreachArc | null; breachReadyAt: number; groundOffset: number;
  actionClock: number; hitStopUntil: number;
  buffered: { input: 'basic' | ActiveSlot; at: number } | null;
  heldBy: ActorId | null; breakProgress: number;
  status: { id: 'inked'; until: number; speedFactor: number } | null;
  lastDamageAt: number; lastThreatAt: number }
export interface HitRequest { source: ActorId; target: ActorId; actionInstanceId: string; attackId: string; emitter: EmitterSource; hitGroupId: string; point: Vec3; normal: Vec3; damage: number; impulse: Vec3 }
export interface CombatInput { move: Vec3; aim: Vec3 | null; basicHeld: boolean; basicPressed: boolean; activePressed: [boolean, boolean]; activeHeld: [boolean, boolean]; activeReleased: [boolean, boolean]; activeCanceled: [boolean, boolean]; traversal: 'none' | 'rise' | 'dive' | 'breach' }
export type { DnaCredit } from './economy';
/** A fresh runtime: every flag true, every clock 0, zero velocities, empty maps. Never saved. */
export function newRuntime(orientation: Orientation = { yaw: 0, pitch: 0 }): CombatRuntime {
  return { targetable: true, perceivable: true, damageable: true, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null,
    controlledVelocity: { x: 0, y: 0, z: 0 }, externalVelocity: { x: 0, y: 0, z: 0 }, orientation: { yaw: orientation.yaw, pitch: orientation.pitch },
    cooldowns: new Map(), actions: [], permit: null, arc: null, breachReadyAt: 0, groundOffset: 0,
    actionClock: 0, hitStopUntil: 0, buffered: null, heldBy: null, breakProgress: 0, status: null, lastDamageAt: -Infinity, lastThreatAt: -Infinity };
}
