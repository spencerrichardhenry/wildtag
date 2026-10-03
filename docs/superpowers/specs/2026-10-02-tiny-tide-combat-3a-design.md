# Tiny Tide combat 3a — mechanical combat execution — design

Date: 2026-10-02
Status: revision 1, for the implementation plan.
Builds on: `docs/superpowers/specs/2026-10-01-tiny-tide-evolution-core-design.md`
(the "core spec"), especially §8 (combat data contract), §9 (lifecycle), §10
(pursuit) and §14 (sub-project 3 acceptance).
Binding inputs: `.codex-drafts/combat-3a-decisions.md` (owner decisions and the
controller rulings R1–R13). Section 16 lists every decision that this spec
adds.

## 1. Purpose and scope

The owner said: "still no mechanical execution whatsoever to combat, still no
notable tradeoffs on body design". The bar is "Spore level of creature
building and combat".

Sub-project 3 is split in two:

- **3a (this document):** the combat engine and the full content for sizes 0
  and 1. After 3a, a player can fight, dodge, block and counter at sizes 0
  and 1.
- **3b (later):** content for sizes 2–4 on the same engine.

Combat is a **hybrid**. Parts give the moves. The player aims each move.
Enemies telegraph each attack. The player wins by the timing of a dodge, a
block or a counter.

### Success criteria

1. Each move-giving part gives one move. Its numbers change with the part
   size. A bigger part is stronger, and it is also slower, has a longer
   cooldown or costs more DNA.
2. Every enemy attack shows a telegraph from the same clock and the same
   geometry as its hit. A test proves it for every attack.
3. Every hunter attack can be avoided. The balance probe (§14.3) measures it.
4. Every size-0/1 line (meat, plant and omnivore diets) can finish sizes 0
   and 1. The balance probe measures it.
5. Combat works at 320×568 and 844×390 on a phone, for a swimmer, a crawler
   and a breacher.
6. v4 saves load. Legacy keys are never written.
7. No combat motion installs a refused pose. Knockback, lunges, dashes and
   grabs go through `resolveMotion`.

## 2. Terms

| Term | Meaning |
| --- | --- |
| `L` | The body length of an actor, in physical units. Player: `actor.bodyLength` (body length × stage size × growth). Species: `SIZES[tier] × 1.4 × bodyScale`. |
| `L_a`, `L_t` | `L` of the attacker, `L` of the target. |
| World time | The game clock `time` in `main.ts`. It stops only in pause, editing, stuck and won. |
| Action clock | One clock per combatant. It advances with world time, except during that combatant's hit-stop (§5.9). |
| HP | Hit points of an enemy. Player attacks deal HP. |
| Half-heart | The unit of player damage. Enemy attacks deal half-hearts. Two half-hearts are one heart. |
| Combat species | A species with a `behaviourId`. Only combat species use the action engine. |
| Legacy species | A species without a `behaviourId` (food, jellyfish, ray, seaplane). They keep today's chomp and contact-hazard rules in 3a. |
| Move | One timeline of a part: Bite, Grab, Counter, Brace, Dash or Sweep. |
| Move kind | `grab`, `counter`, `brace`, `dash` or `sweep`. Bite is the basic move and is not a kind. |
| Telegraph | The visible cue of an enemy wind-up (§9). |
| Token | The permission from the director to start a wind-up against the player (§9.4). |

## 3. Modules

Each module has one responsibility. "Pure" means no DOM, no three.js scene,
no `localStorage`; three.js math types are allowed.

### 3.1 New modules

| Module | Pure | Responsibility |
| --- | --- | --- |
| `src/tiny-tide/moves.ts` | yes | Player move data (mouth, tail and pincer attacks; abilities; guard and evasion profiles), `resolveMove`, `movesOf`, `assignSlots`. |
| `src/tiny-tide/bestiary.ts` | yes | Species attack specs, species behaviours, the size rosters, the minimum wind-up table, alpha data. |
| `src/tiny-tide/combat-profiles.ts` | yes | Telegraph profiles, effect profiles, hit-stop and feedback constants. |
| `src/tiny-tide/combat-shapes.ts` | yes | World shapes from an attack, a pose and an aim; hit tests; crossing and obstruction tests; telegraph descriptors. |
| `src/tiny-tide/action-engine.ts` | yes | Action timelines per actor: start rules, phases, aim tracking and lock, cooldowns, hold, input buffer, cancel, interrupt, stagger and poise, action clocks. |
| `src/tiny-tide/hit-resolver.ts` | yes | Resolves hit requests in the contract order; guard, counter, evasion, damage, stagger, impulse, grab and break-free; returns outcomes and combat events. |
| `src/tiny-tide/combat-ai.ts` | yes | One state machine per behaviour type; move intents; attack choice; alpha phases; lair; dens; schools. |
| `src/tiny-tide/director.ts` | yes | Attack tokens: the limits on wind-ups that target the player. |
| `src/tiny-tide/combat-world.ts` | yes | Owns the combat state of entities. Runs one combat tick: AI, director, engine, shapes, resolver, motion requests, kills and rewards. |
| `src/tiny-tide/feeding.ts` | yes | Today's chomp rules, moved out of `main.ts` (bite targets, eat, legacy damage), and the basic dispatch rule (§8.3). |
| `src/tiny-tide/sim.ts` | yes | One pure game tick, moved out of `main.ts` in the same order: player step, combat world, ecosystem, hazards, feeding, rewards, faint and respawn decisions. It returns `SimEvent[]`. `main.ts` and the probe both call it. |
| `src/tiny-tide/combat-hud.ts` | no | DOM: the slot cluster, cooldown rings, the basic-button aim drag, edge arrows, enemy HP bars, the alpha bar, the break-free prompt, damage numbers. |
| `src/tiny-tide/telegraph-view.ts` | no | three.js: telegraph volumes, depth rings, the x-ray outline, flashes, impact particles, camera shake. |
| `src/tiny-tide/hints.ts` | no | First-time hint ids and their persistence in `localStorage` key `tiny-tide-hints-v1`. |
| `src/tiny-tide/combat-probe.ts` | yes | The headless balance probe: bots, encounters, measurements (§14.3). |
| `e2e/tiny-tide-combat.mjs` | no | The browser checks (§14.2). |

### 3.2 Changed modules

| Module | Change |
| --- | --- |
| `combat-types.ts` | The type extensions of §4.1. |
| `registries.ts` | Typed registries for telegraphs, effects, evasions, guards and behaviours; the attack and ability registries filled from `moves.ts` and `bestiary.ts`; the `validateContract` additions of §4.3. |
| `profiles.ts` | The empty placeholders `TELEGRAPHS`, `EFFECTS`, `EVASIONS`, `GUARDS` move out (to `combat-profiles.ts` and `moves.ts`). New pursuit policy `ambusher`. |
| `parts.ts` | Grants on move-giving parts; the fields `rare` and `model`; two rare parts (§7.6). |
| `species.ts` | New fields `behaviourId`, `bodyScale`, `model`, `tint`, `alpha`; new species (§11); crab and squid get behaviours and lose their contact hazards. |
| `biomes.ts` | Spawn heights and biome weights for the new kinds; group spawns for schools; eel dens. |
| `assets.ts` | Food model names come from `spec.model ?? spec.kind`; part model names from `spec.model ?? spec.id`, without duplicates. |
| `rig.ts`, `creature.ts`, `mount.ts` | Rig and GLB lookups use the part's model id. `speciesActor` and `speciesCombatPose` use `bodyScale` and add a `centre` socket. |
| `economy.ts` | `faintLegacy` is removed. New helper `faintLoss`. |
| `state.ts` | The faint rule (§10.3), kill and survivor rewards (§10.4), rare unlocks, the loadout shape and its v4 read (§10.5), half-heart health. `DEATH_KEEP` is removed. |
| `lifecycle.ts` | Resets of the new runtime fields; `reconcileAfterCommit` with pins; hazard damage in half-hearts; combat on evolve, faint and respawn (§13). |
| `design-delta.ts` | `clearedBindings` becomes `clearedPins`. |
| `input.ts` | Four slots; `aimSource` (§8.5). |
| `player-motion.ts` | Facing during actions, speed factors, dash motion, held motion (§5.12). |
| `ecosystem.ts` | Entity combat state, external velocity, AI move intents, school flee, dens, the lair, alpha presence, hunter respawn time. |
| `avoidance.ts` | `simulateEscape` counts attack hits from the combat world as well as hazards. |
| `world.ts` | Tinted and scaled species models, the telegraph view, hit flashes, per-actor animation freeze, reduced-motion shake. |
| `audio.ts` | Sounds: hit, block, counter, dash, grab, break-free, wind-up cue. |
| `editor.ts`, `editor.css` | The moves panel, the slot bar, the swap, the move line on part cards, live size numbers (§12). |
| `main.ts`, `hud.css`, `style.css` | Wiring to `sim.ts`, controls (§8), HUD, faint message, help text, diagnostics. |
| `qa-catalog.ts` | Removed, with the `?qaGrantCatalog` parameter. Shipped parts now have real grants. |
| `tests-browser/fixtures.ts` | Fixture fields for moves, pins, encounters and alpha health. |
| `e2e/tiny-tide.mjs`, `e2e/tiny-tide-pacing.mjs` | The journey bot dodges telegraphs and fights by diet. |
| `docs/TINY-TIDE.md` | A new "Combat" section; updated help, faint and verification text. |

## 4. Data contract

### 4.1 Type extensions (`combat-types.ts`)

```ts
export type ActiveSlot = 0 | 1 | 2 | 3;
export type Tuple4<T> = [T, T, T, T];
export type MoveKind = 'grab' | 'counter' | 'brace' | 'dash' | 'sweep';
export type SlotClass = 'defense' | 'movement' | 'attack';
/** The fixed slot priority (R1): defense, then movement, then attack. */
export const MOVE_PRIORITY: readonly MoveKind[] = ['brace', 'counter', 'dash', 'grab', 'sweep'];
export const SLOT_CLASS: Readonly<Record<MoveKind, SlotClass>> = { brace: 'defense', counter: 'defense', dash: 'movement', grab: 'attack', sweep: 'attack' };
export type SlotPin = MoveKind | null;
/** Replaces `{ active: [AbilityBinding | null, AbilityBinding | null] }`. `AbilityBinding` is removed. */
export interface CombatLoadout { slots: Tuple4<SlotPin> }

/** value = base × (1 + k × (scale − 1)); one k per parameter name. */
export type MoveScaling = Readonly<Record<string, number>>;
/** A mirrored pair: value × multiply[p] + add[p], applied before the one rounding. */
export interface PairBonus { multiply: Readonly<Record<string, number>>; add: Readonly<Record<string, number>> }
export type AimMode = 'input' | 'body-back' | 'centre' | 'fixed-at-start';

export interface AttackSpec {
  /* every field of today's AttackSpec, unchanged, plus: */
  damageUnit: 'hp' | 'half-heart';          // 'hp' for player attacks, 'half-heart' for species attacks
  aimMode: AimMode;
  moveSpeedFactor: number;                  // locomotion factor during windup and active
  poiseDamageMultiplier: number;            // §5.8
  lunge?: { distanceBodyLengths: number };  // the attacker moves along the aim during active
  hold?: { seconds: number; sizeFactor: number; startHalfHearts: number; squeezeHalfHearts: number; squeezeEverySeconds: number };
  whiffRecoverySeconds?: number;            // recovery when the attack hit nothing (grabs)
  statusEffectId?: string;                  // a status applied on hit (ink)
  scaling?: MoveScaling;                    // player attacks only
  pair?: PairBonus | null;                  // player attacks only
}
export interface AbilitySpec {
  /* id, cooldownSeconds, allowedMotionModes, effectProfileId (today), plus: */
  kind: MoveKind; label: string; input: 'press' | 'hold';
  attackId?: string;          // grab, sweep
  guardProfileId?: string;    // brace, counter
  evasionProfileId?: string;  // dash
  scaling: MoveScaling; pair: PairBonus | null;
}
export interface GuardProfile {
  id: string; kind: 'brace' | 'counter';
  startupSeconds: number; minActiveSeconds: number; windowSeconds: number | null;   // window: counter only
  frontHalfAngle: number | null;                                                   // brace only; radians
  blockFraction: number; breakHalfHearts: number | null; breakStaggerSeconds: number; brokenCooldownSeconds: number;
  moveSpeedFactor: number; yawRateFactor: number;
  reflectDamage: number; attackerStaggerSeconds: number;                           // counter only
  recoverySeconds: number; whiffRecoverySeconds: number; successCooldownSeconds: number;
}
export interface EvasionProfile { id: string; distanceBodyLengths: number; startupSeconds: number; travelSeconds: number; recoverySeconds: number; plane: 'free' | 'horizontal'; endSpeedCarry: number }
export interface TelegraphProfile { id: string; color: 'amber' | 'red' | 'none'; pattern: 'solid' | 'stripes'; poseCue: 'rear' | 'crouch' | 'inflate' | 'coil' | 'burrow' | 'spin' | 'none'; flashLeadSeconds: number; edgeArrow: boolean }
export interface EffectProfile { id: string; kind: 'feedback' | 'status'; status?: { id: 'inked'; seconds: number; speedFactor: number }; sound: 'hit' | 'block' | 'counter' | 'dash' | 'grab' | 'break' | 'none'; particles: string }

export type ActionPhase = 'windup' | 'active' | 'hold' | 'recovery' | 'interrupted';
export interface ActionState {
  /* instanceId, definitionId, grantId, source, startedAt, committedPose, hitCounts, lastHitAt (today), plus: */
  phase: ActionPhase; phaseStartedAt: number;          // action-clock seconds
  aim: MutVec3; aimLocked: boolean;
  resolved: ResolvedMove;                              // numbers after size and pair (§7.3); species: the spec itself
  targetId: ActorId | null;                            // the actor the attacker aimed at (director, telegraph)
  heldTarget: ActorId | null; windupExtension: number; released: boolean; countered: boolean; lungeDone: number;
}
export interface CombatRuntime {
  /* every field of today, plus: */
  actionClock: number; hitStopUntil: number;          // hitStopUntil is world time
  buffered: { input: 'basic' | ActiveSlot; at: number } | null;   // at: action clock
  heldBy: ActorId | null; breakProgress: number;
  status: { id: 'inked'; until: number; speedFactor: number } | null;  // until: world time
  lastDamageAt: number; lastThreatAt: number;           // world time; regen (§10.2)
}
export interface CombatInput {
  move: Vec3; aim: Vec3 | null; aimSource: 'pointer' | 'drag' | 'auto' | 'camera' | 'none';
  basicHeld: boolean; basicPressed: boolean;
  activePressed: Tuple4<boolean>; activeHeld: Tuple4<boolean>; activeReleased: Tuple4<boolean>; activeCanceled: Tuple4<boolean>;
  traversal: 'none' | 'rise' | 'dive' | 'breach';
}
export type WorldShape = { kind: 'cone'; apex: Vec3; axis: Vec3; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
export type HitOutcome = 'countered' | 'blocked' | 'guard-broken' | 'evaded' | 'immune' | 'hit' | 'grabbed';
export interface MotionRequest { /* today, with */ cause: 'locomotion' | 'dash' | 'knockback' | 'recovery' | 'lunge' | 'grab' }
```

`ResolvedMove` (in `moves.ts`) is a flat record of resolved numbers with
the same field names as the spec it came from. `AttackShape` keeps its two
kinds. Its units change: **shape numbers are in attacker body lengths**
(`L_a`), not part-local units. A capsule with `start = end` is a sphere.

`SpeciesCombatFields` gets `behaviourId?: string`. `Species` gets
`bodyScale?: number` (default 1), `model?: FoodKind` (default `kind`),
`tint?: string`, and
`alpha?: { size: number; rewardPartId: string; rewardDna: number }`.
`PartSpec` gets `rare?: true` and `model?: string` (default `id`).

`SpeciesBehaviour` (in `bestiary.ts`):

```ts
interface AttackChoice { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }
interface BehaviourPhase { aboveHpFraction: number; attacks: readonly AttackChoice[]; speedFactor: number; gapSeconds: number; pattern: 'normal' | 'burrow' | 'laps'; patternAttackId?: string }   // patternAttackId: burrow, laps
interface SpeciesBehaviour {
  id: string; type: 'prey-flee' | 'prey-school' | 'prey-fighter' | 'hunter' | 'hunter-ambush' | 'alpha';
  reactionSeconds: number; poise: number; staggerResist: number; knockbackResistance: number; grabbable: boolean;
  attacks: readonly AttackChoice[]; gapSeconds: number;
  repositionSeconds: readonly [number, number]; repositionSpeedFactor: number;
  flee?: { seconds: number; restSeconds: number; speedFactor: number };
  school?: { radiusBodyLengths: number; groupSize: number };
  trigger?: { radiusBodyLengths: number; seconds: number };       // prey-fighter "cornered"
  den?: { triggerBodyLengths: number; outSeconds: number; attackId: string };   // hunter-ambush
  lair?: { radiusBodyLengths: number; resetOutsideFactor: number; resetDelaySeconds: number; healPerSecond: number };
  phases?: readonly BehaviourPhase[];                               // alpha; ordered by aboveHpFraction, descending
}
```

### 4.2 Registries

`Catalogs` (in `registries.ts`) changes these entries from untyped `Entry` to
typed records, and adds one:

| Registry | Type | Source |
| --- | --- | --- |
| `telegraphs` | `Record<string, TelegraphProfile>` | `combat-profiles.ts` |
| `effects` | `Record<string, EffectProfile>` | `combat-profiles.ts` |
| `evasions` | `Record<string, EvasionProfile>` | `moves.ts` |
| `guards` | `Record<string, GuardProfile>` | `moves.ts` |
| `attacks` | `Record<string, AttackSpec>` | `moves.ts` (player) and `bestiary.ts` (species), merged; duplicate ids throw at load |
| `abilities` | `Record<string, AbilitySpec>` | `moves.ts` |
| `behaviours` (new) | `Record<string, SpeciesBehaviour>` | `bestiary.ts` |

`HAZARDS` keeps `jelly-sting`, `ray-sting` and `plane-buzz`, with damage in
half-hearts: 2, 2 and 4. `crab-pinch` and `squid-grab` are removed. The
ecosystem's engaged bonus (`max(0, tier − stage)`) is doubled, so it is also
in half-hearts.

### 4.3 `validateContract` additions

Each check has a mutation test in `tests/tiny-tide-core/contract.test.ts`
(one mutated catalog per check; the check must report it, and the unmutated
catalog must report nothing).

| # | Check |
| --- | --- |
| V1 | Every registry key equals its entry's `id` (telegraphs, effects, evasions, guards, behaviours). |
| V2 | Attack: `damageUnit` and `aimMode` are in their enums; the optional `origin` is `'target'` only with `aimMode: 'fixed-at-start'` (plan review R4); `moveSpeedFactor` is in `[0, 1]`; `poiseDamageMultiplier ≥ 0`. |
| V3 | Attack: `lunge.distanceBodyLengths > 0`; `hold.seconds > 0`; `hold.sizeFactor > 0`; hold numbers non-negative; `squeezeEverySeconds > 0` when `squeezeHalfHearts > 0`. |
| V4 | Attack: `statusEffectId` exists and has `kind: 'status'`. |
| V5 | Attack: every `scaling` and `pair` key names a numeric field of the attack or of its `lunge`/`hold`; every value is finite; every pair multiplier is `≥ 1`, except a `cooldownSeconds` multiplier, which is in `(0, 1]` (a pair recovers faster: the Dash pair's × 0.85; final review M7). |
| V6 | Attack: an attack with `blockable: false` uses a telegraph with `color: 'red'` and `pattern: 'stripes'`; a blockable species attack uses `color: 'amber'` and `pattern: 'solid'`; a player attack uses `color: 'none'`. |
| V7 | Species attack: `aimLockAtSeconds ≤ windupSeconds − 0.2`, unless `aimMode` is `centre` or `fixed-at-start` (then `aimLockAtSeconds = 0`). |
| V8 | Species attack: `windupSeconds ≥ MIN_WINDUP` for every size at which a species that uses it is hostile (§11.1). |
| V9 | Ability: `kind` is a `MoveKind`; `input` is `'hold'` only for `brace`; `attackId` exists for `grab` and `sweep`; `guardProfileId` exists for `brace` and `counter` and its guard `kind` matches; `evasionProfileId` exists for `dash`; no other reference is set. |
| V10 | Ability: scaling and pair keys name a numeric field of the ability or of its guard, evasion or attack; values finite; multipliers `≥ 1`, except a `cooldownSeconds` multiplier in `(0, 1]` (final review M7). |
| V11 | Guard: fractions in `[0, 1]`; angles in `(0, π]`; durations non-negative; `windowSeconds` set only for counter; `frontHalfAngle` and `breakHalfHearts` set only for brace. |
| V12 | Evasion: all durations non-negative; `travelSeconds > 0`; `distanceBodyLengths > 0`; `endSpeedCarry` in `[0, 1]`. |
| V13 | Telegraph: enums valid; `flashLeadSeconds` in `[0, 0.3]`. Effect: enums valid; a status effect has `status`, `seconds > 0`, `speedFactor` in `(0, 1]`. |
| V14 | Behaviour: `type` valid; every referenced attack (`attacks`, `chainNextId`, `den.attackId`, phase `attacks` and `patternAttackId`) exists, has `damageUnit: 'half-heart'`, and is in the species' `attackIds`; every id in the species' `attackIds` is referenced; bands have `0 ≤ min < max`; weights `> 0`; durations non-negative; `repositionSeconds[0] ≤ [1]`. |
| V15 | Behaviour: `flee` set for `prey-flee` and `prey-school`; `school` set only for `prey-school`; `trigger` set for `prey-fighter`; `den` set only for `hunter-ambush`; `lair` and `phases` set only for `alpha`; phases strictly descending by `aboveHpFraction`, the last `= 0`, the others in `(0, 1)`; `patternAttackId` set exactly when `pattern` is `burrow` or `laps`. |
| V16 | Part: a part with an active grant has exactly one; its ability's kind matches §7.1 for that part. A mouth has exactly one basic grant, an attack with `aimMode: 'input'` and `damageUnit: 'hp'`. No other part has a basic grant. |
| V17 | Part: a `rare` part is the `alpha.rewardPartId` of exactly one species; every `alpha.rewardPartId` names a `rare` part. `model` names a part id that has a GLB (a non-rare part). |
| V18 | Species: a species with `behaviourId` has no `contactHazardId`; a species with `hunts` or `stingsStages` has a `contactHazardId` or a hunter, ambush or alpha behaviour (replaces today's "hazard missing" rule). |
| V19 | Species: `bodyScale` finite and in `[0.3, 3]`; `alpha.size` in `[0, 4]`; `alpha.rewardDna` a non-negative safe integer; an alpha species has `count: 1` and an alpha behaviour. |
| V20 | Species: `model` names a food kind that has a GLB. |
| V21 | Behaviour (plan review R2): every `AttackChoice.band[1]` ≤ the forward reach of its attack's shape from the hull front (cone: `range`; capsule: the far end's `z` + `radius`; a lunge: the full committed capsule). A `centre` attack starts at the hull centre, so its reach is that value minus the species hull radius (0.25 L_e; T23 probe, P0). |

## 5. The action engine (`action-engine.ts`)

The engine is one set of rules for the player and for every combat species.

### 5.1 Clocks

- Every combatant has an action clock `τ` (`rt.actionClock`). Entities keep
  theirs in their combat state.
- In a tick from world time `t` to `t + dt`, `τ` advances by
  `Δτ = clamp((t + dt) − max(t, hitStopUntil), 0, dt)`.
- Action start times, phase times, cooldowns, stagger ends, the input buffer
  and dash invulnerability use the action clock.
- `invulnerableUntil` (grace, hazards, post-hit) stays in world time, as in
  the core contract.
- Pause stops world time, so it stops every action clock.

### 5.2 Phase timeline

An action runs these phases in order. Each length comes from the resolved
move (§7.3) or the species attack.

| Phase | Starts | Ends |
| --- | --- | --- |
| `windup` | `τ0` (start) | `τ0 + windupSeconds + windupExtension` |
| `active` | end of windup | `+ activeSeconds` (Brace: while held, at least `minActiveSeconds`) |
| `hold` | end of active, only for a grab that caught a target | `+ hold.seconds`, or earlier at a break-free or a blocked grab motion |
| `recovery` | end of active (or of hold) | `+ recoverySeconds` (`whiffRecoverySeconds` for a grab that caught nothing; Counter: `whiffRecoverySeconds` without a success, 0 after a success) |
| `interrupted` | at an interrupt | immediately removed at the end of the tick |

- The **cooldown starts at the end of recovery** (contract). The ready time
  is `τ_end + cooldownSeconds`. An interrupted action starts its cooldown at
  the interrupt.
- Cooldown keys stay `${actorId}:${partUid}:${grantId}`. For a player move,
  `partUid` is the representative part of the move kind (§7.2). Species keys
  use `${actorId}:root:${attackId}`.
- Counter maps to the timeline as: windup = `startupSeconds`, active =
  `windowSeconds`. Dash: windup = `startupSeconds`, active = `travelSeconds`.
  Brace: windup = `startupSeconds`, active = held.

### 5.3 Start rules

An actor can start an action only when all of these are true:

1. The game mode is `playing` (player) or the entity is active (entity).
2. The actor is not staggered (`τ ≥ staggerUntil`).
3. The actor is not held, except for a held player's Bite (§6.6).
4. No action runs, or the cancel rule (§5.6) allows it.
5. The cooldown is ready.
6. The movement mode is in `allowedMotionModes` (all modes in 3a, except
   that Dash is refused during a Breach arc).
7. For a species attack that targets the player: the director gave a token
   (§9.4).

### 5.4 Aim tracking and lock

- At start, `aim` is the input aim (player) or the direction to the target's
  hurtbox centre (species). Every species clamps the pitch to ±0.6 rad,
  ground species included (plan review R3: a ground attacker on a ledge aims
  down at a target lower on the seabed). The wanted aim while tracking is
  clamped the same way. Impulses stay horizontal for ground targets (§6.2).
- In windup, until `τ − τ0 ≥ aimLockAtSeconds`, the aim turns toward the
  wanted aim on the great circle, by at most
  `maxTrackingRadiansPerSecond × Δτ`.
- At the lock, `aimLocked` becomes true. The engine samples the pose once and
  stores it in `committedPose`. From then on, the world shape is fixed in
  world space (§5.10).
- `aimMode: 'fixed-at-start'` and `'centre'`: the lock is at `τ0`. `'centre'`
  uses the actor's centre as the shape origin. `'body-back'`: the aim is the
  reverse of the body's horizontal forward, tracked with the body.
- Before the lock, the telegraph follows the live aim and the live pose.

### 5.5 Hold moves

- Brace acts while its input is held. Release, or a cancel of the touch,
  ends the active phase, but not before `minActiveSeconds`. Then recovery
  runs.
- A release during windup ends Brace at the end of windup plus
  `minActiveSeconds`.
- A held basic input repeats Bite: the next Bite starts at the first tick
  where the start rules pass.

### 5.6 Cancel and interrupt rules

- An actor runs one action at a time. One exception: during a grab's `hold`
  phase, the grabber can start Bite. Any other move ends the hold (the target
  is released) and then starts.
- **Player cancel:** Dash can start during the `recovery` phase of the
  player's Bite or Sweep. Nothing else cancels. Species never cancel.
- **Interrupt:** a stagger interrupts an action in `windup` or `active` when
  that action is `interruptible`. Brace, Counter and Dash are not
  interruptible. A lunge is interruptible in windup only.
- An interrupted action ends; its hits stop; its token returns to the
  director.

### 5.7 Input buffer

- A press that fails only because the actor is busy is kept when it comes in
  the last 0.12 s of a recovery or during a hit-stop.
- One entry is kept. A newer press replaces it.
- It starts the move at the first tick where the start rules pass. It expires
  0.12 s of action clock after the press.
- Every other press while busy is dropped. Nothing is buffered across pause
  (the core rule stays).

### 5.8 Stagger and poise

- **Player:** an unblocked hit staggers the player for the attack's
  `staggerSeconds`. While staggered, the player cannot start moves, and
  locomotion is × 0.5.
- **Species:** each species has a poise meter. A hit adds
  `damage × poiseDamageMultiplier`. The meter decays by 4 per second. When it
  reaches the behaviour's `poise`, the species is staggered for
  `staggerSeconds × (1 − staggerResist)` of the attack that broke it, and the
  meter goes to 0. A counter always staggers (§6.3).
- A staggered species does not move under its own power and starts no action.

### 5.9 Hit-stop

- An applied hit (outcome `hit`, `blocked`, `guard-broken`, `countered` or
  `grabbed`) sets `hitStopUntil = max(hitStopUntil, t + stop)` on the attacker
  and the target.
- Durations:

  | Case | Stop |
  | --- | --- |
  | The player is hit for `h` half-hearts | `clamp(60 + 10 × (h − 1), 60, 90)` ms |
  | The player hits for `d` HP | `60 + round(30 × min(1, d / 8))` ms |
  | Countered | 90 ms |
  | Blocked or guard broken | 60 ms |
  | Grabbed | 70 ms |
  | Evaded, immune | none |

- During a hit-stop, the two actors' action clocks stop, their rig animation
  stops, and their controlled and external displacement is zero. Their
  velocities are kept.
- These do not stop: world time, every other actor, the ecosystem, pursuit
  timers, hazard cadence, the Breach arc and its permit, audio and UI timers.

### 5.10 Hit shapes from sockets

- The shape origin is the emitter origin of the action's socket in the pose.
  The player pose comes from `sampleCombatPose`; a species pose from
  `speciesCombatPose`, which gets a `centre` socket at its hull centre.
- Species origin (plan review R2): for `aimMode` `input` and `fixed-at-start`,
  the origin is the hull front: hull centre + aim × hull radius. A `centre`
  attack keeps the hull centre. The claw point of a species hold uses the same
  origin. An attack with `origin: 'target'` (R4, `mother-emerge`) is centred
  on the target's hurtbox centre at wind-up start; the action stores that
  point, and the telegraph and the hit use it.
- The engine samples the pose at the start and at the lock. Between them, the
  live pose is sampled each tick (at most once per actor per tick).
- The local frame: `z` = aim; `y` = world up made orthogonal to `z` (if
  `|aim.y| > 0.98`, the body forward is used); `x = y × z`. Local numbers
  are multiplied by `L_a`.
- **Cone:** apex = origin; axis = aim; range = `range × L_a`.
- **Player cone** (Bite, Grab's pinch; final review I2): apex = the player's
  hull centre; range = `(range + m) × L`, where `m` is the centre-to-socket
  distance in L; the half angle is unchanged. A creature pressed against the
  player (beside or under the mouth) is inside it. The dispatch cone (§8.3)
  uses the same rule with `range × 1.25 + m`.
- **Capsule:** start and end = origin + frame × (local × `L_a`); radius =
  `radius × L_a`.
- A mirrored pair (`shared-cast`): one action; the shape is the union of the
  shapes of both copies; one hit group (`grantId`).
- **Lunge:** the telegraph and the hit volume are the full committed capsule.
  During active, the attacker moves along the aim through `resolveMotion`
  (cause `lunge`) at `distance / activeSeconds`. If the motion stops, the hit
  volume for later ticks is truncated at the reached point. So the hit volume
  is always inside the telegraphed volume.
- **Rule:** at every active tick, the hit volume is a subset of the volume
  that the telegraph showed at the lock. A test checks it for every attack.

### 5.11 Hit tests, crossing and obstruction (`combat-shapes.ts`)

- Targets: the hurtboxes of the target pose. Player hurtboxes come from
  `sampleCombatPose` (the conservative hull, as today); species hurtboxes are
  the hull sphere.
- A capsule hurtbox is tested as spheres placed at most `radius / 2` apart on
  its axis.
- **Sphere versus cone:** hit when `|c − apex| ≤ range + r` and the angle
  between `c − apex` and the axis is at most
  `halfAngle + asin(min(1, r / |c − apex|))`. A sphere that contains the apex
  is a hit.
- **Sphere versus capsule:** hit when the distance from `c` to the shape
  segment is at most `radius + r`.
- The hit point is the point of the hurtbox axis nearest the shape axis.
- **Crossing:** `same-medium` needs `sampleEnvironment(origin).medium` to
  equal `sampleEnvironment(point).medium`. `water-surface` also allows water
  to air and air to water within 1 `L_a` of the surface. `any-medium` always
  passes. Every 3a attack is `same-medium`.
- **Obstruction (`terrain-and-cover`):** the segment from the shape origin to
  the hit point must be clear. New optional query
  `WorldQueries.segmentClear(a, b, step): boolean` samples the segment at
  steps of at most `0.25 L_a`: a sample below `groundAt` or inside a reef
  solid (`solidAt(x, y, z, 0)`) blocks it. The default implementation tests
  the terrain only. Perception (`visibility`) does not change.
- Maximum targets: the nearest targets by distance from the apex, then by
  actor id.

### 5.12 Motion during actions (`player-motion.ts`, `ecosystem.ts`)

- **Facing:** in windup and active of Bite and Grab, the player faces the
  action aim (yaw) at the movement profile's yaw rate. While bracing, the
  player turns toward the input aim at `yawRateFactor × maxYawRate`. Sweep
  does not change facing.
- **Speed factors** (multiply the player's top speed): the attack's
  `moveSpeedFactor` in windup and active; the guard's `moveSpeedFactor`
  while bracing; 0.6 while holding a grab; the status `speedFactor` while
  inked; 0.5 while staggered. Factors multiply.
- **Dash:** during active, the controlled velocity is replaced by
  `direction × distance / travelSeconds` (cause `dash`). At the end,
  controlled velocity = that velocity × `endSpeedCarry` (0.3).
- **Held:** `stepPlayer` gets `forcedDisplacement` = (claw point of the
  grabber − attach point) for the tick. Controlled velocity is zero. The
  motion cause is `grab`. If the result is `blocked` with progress below 0.5,
  the grab ends.
- **Knockback:** an impulse adds to `externalVelocity` (player runtime, or
  the entity's new `externalVelocity`). The ecosystem adds
  `externalVelocity × dt` to the entity displacement, resolves motion with
  cause `knockback`, projects the velocity on the contacts, and decays it by
  `exp(−6 dt)` (the player's `EXTERNAL_DECAY`).
- **Never install a refused pose.** Every combat motion goes through
  `resolveMotion`. `invalid-start` or `needs-recovery` uses the existing
  recovery and install paths.

## 6. Hit resolution (`hit-resolver.ts`)

### 6.1 Order of processing

In one tick, the combat world collects hit requests from every active
action. It sorts them by action start time (world time), then by attacker
id, then by target id. It processes them one at a time. Then contact hazards
(`resolveHazards`) run. One accepted event can make a later event immune.

### 6.2 Steps for one hit request

1. **Validity.** The target is targetable and is not the attacker. Crossing
   and obstruction pass (§5.11). The ledger allows it: for the key
   `${actionInstanceId}:${hitGroupId}:${targetId}`, the count is below
   `maxHitsPerTarget` and `now − lastHit ≥ repeatHitSeconds`. The action has
   hit fewer than `maxTargets` targets. Else drop it, with no ledger entry.
2. **Counter.** Counter window open on the target (or a Counter armed against
   this action at its active start, §6.3) and `parryable` → `countered`
   (§6.3). Stop. A Counter still counters while the target is immune.
3. **Immunity.** `damageable` false, or world time `< invulnerableUntil`, or
   the target is in dash invulnerability → `evaded` (dash) or `immune`. The
   ledger records it (D12). Stop. An immune target takes no damage, no guard
   break and no stagger, even while it braces (controller ruling, T5 fix
   round 1).
4. **Brace.** Brace active on the target (after startup), `blockable`, and
   the source in front (§6.4) → `blocked` or `guard-broken`. Go on to step 5
   with the block multiplier.
5. **Damage.**
   - Player target: `hh = damageAfterArmor(raw, armor)`; blocked:
     `floor(hh × (1 − blockFraction))`; guard broken:
     `floor(hh × (1 − blockFraction / 2))`. `health −= hh / 2`. Then
     `invulnerableUntil = max(invulnerableUntil, now + 0.4)` when the dealt
     amount is above 0 (the grace never shortens).
   - Species target: `hp −= damage`. Species have no armor in 3a.
   - A grab catch then follows §6.6 and stops (no stagger, no impulse).
6. **Stagger.** Not when blocked. Player: §5.8. Species: poise (§5.8).
7. **Impulse.** `J = impulse × L_a × min(m_a, 2 m_t)` along the direction from
   the shape origin to the hit point, made horizontal for ground targets. The
   contract formula then gives `Δv = J / m_t × (1 − kr)`, capped at
   `KNOCKBACK_CAP` (9) × `L_t` per second (plan review R8; with the external
   decay of 6/s a knock carries the target at most 1.5 of its body lengths, so
   a big alpha cannot throw a small player across the map; final review M8).
   Blocked: × 0.3 of the capped knock. Guard broken: × 0.6. `kr` is the
   plan's knockback resistance (player) or the behaviour's (species).
8. **Ledger and events.** Record the hit. Emit a `CombatEvent` with the
   outcome, the point, the damage and the hit-stop.

### 6.3 Counter (Spike)

- The window opens after `startupSeconds` and lasts `windowSeconds`. Spikes
  cover every direction.
- A countered hit: the target takes 0 damage. The attacker takes
  `reflectDamage` HP and is staggered for `attackerStaggerSeconds`. This
  interrupts the attacker's action even when it is not interruptible.
- The counterer's action ends with no recovery. Its cooldown becomes
  `successCooldownSeconds` (0.3 s).
- Without a countered hit, recovery is `whiffRecoverySeconds`.
- Counter works against grabs (they are parryable). It does not work against
  unparryable attacks.

### 6.4 Brace (Shell plate)

- **In front:** the angle between the bracer's forward (3D) and the direction
  from the bracer's centre to the attack's shape origin is at most
  `frontHalfAngle`.
- **Heavy hit:** when `damageAfterArmor(raw, armor) ≥ breakHalfHearts`, the
  outcome is `guard-broken`. Brace ends, the bracer is staggered for
  `breakStaggerSeconds`, and Brace goes on cooldown for
  `brokenCooldownSeconds`.
- After a release, the cooldown is `cooldownSeconds` of the ability (0.4 s).
- Grabs are not blockable. **Brace beats strikes, grabs beat Brace, Counter
  and Dash beat grabs.**

### 6.5 Dash invulnerability

- The dash is invulnerable during its whole active (travel) phase.
- A hit inside it is `evaded`. The ledger records it, so that attack instance
  cannot hit that target again.
- The startup (0.03 s) is not invulnerable.

### 6.6 Grab (Pincer, squid, eel)

- **Catch:** the first `hit` of a grab attack is a catch. The target takes
  `damage` (player grab: HP; species grab: `hold.startHalfHearts`). A catch
  gives no impulse and no poise (controller ruling, T5 fix round 1). A target
  that is already held is not held again.
- **Size rule:** the target is held only when `L_t ≤ sizeFactor × L_a` and
  the target is grabbable (alphas are not). Otherwise it "breaks free" at
  once: it takes the catch damage and a 0.3 s stagger, and there is no hold.
- **Hold:** the grabber's action goes to `hold`. The target's action is
  interrupted (when it is interruptible). The target's `heldBy` is set.
  Each tick, the target moves to the grabber's claw point (the action's
  socket origin plus `0.5 × L_t` along the aim) through `resolveMotion`
  (cause `grab`).
- **A held species** cannot move under its own power or act. The grabber can
  Bite it. A hold on a species ends at `hold.seconds`.
- **A held player** cannot move, cannot Dash, and cannot use slot moves. The
  player can Bite (it hits the grabber normally). The player breaks free
  early when `breakProgress ≥ 1`:

  | Input while held | Progress |
  | --- | --- |
  | Basic press (Bite starts or not) | +0.25 |
  | Dash press | +0.35 |
  | A move-stick flick: the stick turns more than 90° with length > 0.6 | +0.2 |

  A squeeze deals `squeezeHalfHearts` every `squeezeEverySeconds` of the
  grabber's action clock. A break-free ends the hold; the grabber goes to
  recovery; the player gets 0.5 s of world-time invulnerability.
- The hold also ends when the grabber is staggered, countered or killed, or
  when the held motion is blocked (§5.12).

### 6.7 Kills

- A species at `hp ≤ 0` is killed. The combat world emits `killed` with the
  killer. `sim.ts` applies the reward (§10.4) and calls `eco.consume(e)`.
- A player at `health ≤ 0` faints (§10.3).

## 7. Player moves

### 7.1 Part to move

| Part | Stage | Move | Kind | Class | Input |
| --- | --- | --- | --- | --- | --- |
| Nibbler, Snapper, Beak, Tyrant jaw (any mouth) | 0, 0, 1, rare | Bite | basic | — | press or hold |
| Pincer, Clawmother pincer | 0, rare | Grab | `grab` | attack | press |
| Spike | 0 | Counter | `counter` | defense | press |
| Shell plate | 1 | Brace | `brace` | defense | hold |
| Side fin, Dorsal fin, Frill fin | 0, 1, 1 | Dash | `dash` | movement | press |
| Paddle tail | 0 | Dash | `dash` | movement | press |
| Little leg, Crab leg | 0, 1 | Dash ("Scuttle", horizontal) | `dash` | movement | press |
| Fan tail, Fluke | 1, 2 | Sweep | `sweep` | attack | press |

Tentacle, horn, eyes, senses, wings, jets and cosmic parts give no move in 3a.
Their stats stay passive.

The starters keep a dodge: the Speck starter (Paddle tail, Little leg pair)
and the Swimmer starter (Paddle tail) have Dash.

### 7.2 Slots (R1)

- The mouth gives the basic move. It is not in a slot.
- Each distinct move kind uses at most one slot. When several parts give
  the same kind, the **representative** part gives the numbers: the part with
  the largest primary number (Grab: hold seconds; Counter: window; Brace:
  block fraction; Dash: distance; Sweep: damage), then the larger scale, then
  the mirrored part, then the lower uid. The other parts of that kind give no
  extra effect.
- `assignSlots(genome, loadout)`:
  1. List the granted kinds in `MOVE_PRIORITY` order.
  2. For slots 0–3 in order: a pin that names a granted kind not yet placed
     goes in its slot.
  3. Fill the empty slots, in index order, with the kinds not yet placed, in
     priority order.
  4. The kinds that are left are **inactive**. The editor says "Inactive — no
     free slot".
- At sizes 0–1, five kinds exist, so at most one is inactive.
- Pins are saved in the run (`run.loadout.slots`). A pin for a kind that the
  design no longer grants is cleared at commit (`clearMissing`), and
  `designDelta` reports it in `clearedPins`.

### 7.3 Size scaling and mirrored pairs

- `s` is the placed part's `scale` (`[0.4, 1.8]`).
- `value = base × (1 + k × (s − 1))`, then for a mirrored pair
  `× multiply + add`, then **one** rounding:
  seconds and body lengths to 0.01 (`Math.round(x × 100) / 100`); fractions
  to 0.01; HP and half-hearts to an integer, at least 1 (`Math.max(1,
  Math.round(x))`); impulses to 0.1.
- The pair bonus applies only when the representative part is placed with
  `mirror: true`. Only Dash and Grab parts can mirror.
- **Bite damage** also adds `floor(B)`, where `B` is the sum of the `bite`
  stat of the non-mouth parts, with the stat factor of core spec §5. A Pincer
  at scale 1 adds 1.
- The formula in `moves.ts` is authoritative. The tables below are the values
  at `s = 0.4 / 1.0 / 1.8`, computed with it.

### 7.4 Move numbers

**Bite** (cone at the `bite` socket; `aimMode: 'input'`; `maxTargets` 1;
`hitGroup: 'shared-grant'`; `staggerSeconds` 0.35; `poiseDamageMultiplier` 0.5
(final review I1: with 1, every size-1 Snapper Bite staggered every size-1
hunter, a stun-lock; with 0.5 a hunter staggers on about the third or fourth
quick Bite); `impulse` 1; no cooldown; `moveSpeedFactor` 1).
Scaling k: damage 0.5, range 0.25, windup 0.25, recovery 0.25, lock 0.25.
Active 0.08 s and the half angle do not scale.

| Mouth | Diet | Damage (HP) | Range (L) | Half angle | Wind-up (s) | Recovery (s) | Lock (s) | Tracking (rad/s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nibbler | plant | 1 / 2 / 3 | .47 / .55 / .66 | 40° | .09 / .10 / .12 | .12 / .14 / .17 | .05 / .06 / .07 | 12 |
| Snapper | meat | 3 / 4 / 6 | .51 / .60 / .72 | 30° | .14 / .16 / .19 | .19 / .22 / .26 | .09 / .10 / .12 | 10 |
| Beak | omnivore | 2 / 3 / 4 | .51 / .60 / .72 | 35° | .11 / .13 / .16 | .15 / .18 / .22 | .07 / .08 / .10 | 11 |
| Tyrant jaw | meat | 4 / 6 / 8 | .60 / .70 / .84 | 30° | .17 / .20 / .24 | .22 / .26 / .31 | .10 / .12 / .14 | 9 |

Meat mouths hit harder; plant mouths are faster. Bigger mouths reach farther
and hit harder, but bite more slowly.

**Sweep** (cone at the `slap` socket; `aimMode: 'body-back'`; active 0.12 s;
half angle 75°; `maxTargets` 4; `staggerSeconds` 0.6;
`poiseDamageMultiplier` 2; `moveSpeedFactor` 0.5; blockable and parryable
are not used).
Scaling k: damage 0.6, range 0.3, impulse 0.5, windup 0.2, recovery 0.2,
cooldown 0.25.

| Tail | Damage (HP) | Range (L) | Impulse | Wind-up (s) | Recovery (s) | Cooldown (s) |
| --- | --- | --- | --- | --- | --- | --- |
| Fan tail | 2 / 3 / 4 | .74 / .90 / 1.12 | 6.3 / 9 / 12.6 | .19 / .22 / .26 | .26 / .30 / .35 | 1.87 / 2.2 / 2.64 |
| Fluke | 3 / 4 / 6 | .82 / 1.0 / 1.24 | 7 / 10 / 14 | .21 / .24 / .28 | .28 / .32 / .37 | 2.04 / 2.4 / 2.88 |

**Grab** (cone at the `pinch` socket; `aimMode: 'input'`; active 0.10 s;
half angle 35°; lock 0.10 s; tracking 8 rad/s; recovery 0.30 s;
`whiffRecoverySeconds` 0.45; `maxTargets` 1; `moveSpeedFactor` 0.7).
Scaling k: damage 0.5, range 0.3, hold 0.35, sizeFactor 0.35, windup 0.2,
cooldown 0.2. Pair: hold × 1.3, damage × 1.5, sizeFactor + 0.25.

| Part | Damage (HP) | Range (L) | Hold (s) | Size factor | Wind-up (s) | Cooldown (s) |
| --- | --- | --- | --- | --- | --- | --- |
| Pincer | 1 / 2 / 3 | .45 / .55 / .68 | .79 / 1.0 / 1.28 | .79 / 1.0 / 1.28 | .16 / .18 / .21 | 2.64 / 3.0 / 3.48 |
| Pincer pair | 2 / 3 / 4 | same | 1.03 / 1.3 / 1.66 | 1.04 / 1.25 / 1.53 | same | same |
| Clawmother pincer | 2 / 3 / 4 | .53 / .65 / .81 | 1.03 / 1.3 / 1.66 | 1.19 / 1.5 / 1.92 | .16 / .18 / .21 | 2.64 / 3.0 / 3.48 |
| Clawmother pair | 3 / 5 / 6 | same | 1.34 / 1.69 / 2.16 | 1.44 / 1.75 / 2.17 | same | same |

**Counter** (guard `counter-spike`; startup 0.04 s; all directions;
success cooldown 0.3 s).
Scaling k: window 0.3, reflectDamage 0.6, attackerStagger 0.3,
whiffRecovery 0.3, cooldown 0.25.

| Spike | Window (s) | Reflect (HP) | Attacker stagger (s) | Whiff recovery (s) | Cooldown (s) |
| --- | --- | --- | --- | --- | --- |
| Spike | .18 / .22 / .27 | 2 / 3 / 4 | .82 / 1.0 / 1.24 | .33 / .40 / .50 | 1.02 / 1.2 / 1.44 |

**Brace** (guard `brace-shell`; hold; min active 0.25 s; recovery 0.15 s;
release cooldown 0.4 s; front half angle 70°; break stagger 0.5 s; broken
cooldown 2.0 s; yaw rate × 0.5).
Scaling k: blockFraction 0.2 (capped at 0.95), breakHalfHearts 0.6,
moveSpeedFactor −0.25, startup 0.3.

| Shell plate | Block fraction | Breaks at (half-hearts) | Move speed | Startup (s) |
| --- | --- | --- | --- | --- |
| Shell plate | .66 / .75 / .87 | 3 / 4 / 6 | × .52 / .45 / .36 | .08 / .10 / .12 |

**Dash** (evasion per part; startup 0.03 s; invulnerable for the whole
travel; end speed carry 0.3).
Scaling k: distance 0.3, travel (invulnerability) 0.2, recovery 0.3,
cooldown 0.3. Pair: distance × 1.2, cooldown × 0.85.
Direction: the move wish when its length is above 0.3, else the aim, else
the facing. `free` dashes keep the wish's vertical part (swimmers, with
Rise and Dive); `horizontal` dashes stay level.

| Part | Plane | Distance (L) | Invulnerable (s) | Recovery (s) | Cooldown (s) | Pair distance | Pair cooldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Side fin | free | 1.31 / 1.6 / 1.98 | .16 / .18 / .21 | .10 / .12 / .15 | .90 / 1.1 / 1.36 | 1.57 / 1.92 / 2.38 | .77 / .94 / 1.16 |
| Dorsal fin | free | 1.15 / 1.4 / 1.74 | .16 / .18 / .21 | .10 / .12 / .15 | .82 / 1.0 / 1.24 | — | — |
| Frill fin | free | 1.23 / 1.5 / 1.86 | .16 / .18 / .21 | .10 / .12 / .15 | .90 / 1.1 / 1.36 | 1.48 / 1.8 / 2.23 | .77 / .94 / 1.16 |
| Paddle tail | free | 1.48 / 1.8 / 2.23 | .18 / .20 / .23 | .11 / .14 / .17 | 1.07 / 1.3 / 1.61 | — | — |
| Little leg | horizontal | 1.07 / 1.3 / 1.61 | .14 / .16 / .19 | .08 / .10 / .12 | .74 / .90 / 1.12 | 1.28 / 1.56 / 1.93 | .63 / .77 / .95 |
| Crab leg | horizontal | 1.15 / 1.4 / 1.74 | .16 / .18 / .21 | .08 / .10 / .12 | .82 / 1.0 / 1.24 | 1.38 / 1.68 / 2.08 | .70 / .85 / 1.05 |

### 7.5 Body tradeoffs that this creates

- A Swimmer must have a tail. Paddle tail gives Dash; Fan tail gives Sweep
  and more speed. A Swimmer with a Fan tail needs a fin to keep a dodge.
- Bigger mouths and tails hit harder and reach farther, but wind up more
  slowly. Bigger shells block more but slow the bracer more.
- A pair of fins, legs or pincers costs twice the DNA and gives one stronger
  move, not two moves.
- Five move kinds compete for four slots.
- A herbivore gains no DNA from kills (§10.4). Its defensive moves keep it
  alive.

### 7.6 Rare parts (alpha rewards)

| Id | Name | Kind | Stage | Cost | Stats | Mirror | Diet | Model | Grant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claw_mother` | Clawmother pincer | arm | 0 | 18 | bite 2 | yes | — | `claw_pincer`, tint `#b5523b` | `grab-clawmother` |
| `mouth_tyrant` | Tyrant jaw | mouth | 1 | 30 | bite 2 | no | carnivore | `mouth_fangs`, tint `#6b3f7a` | `bite-tyrant` |

- A rare part is in the editor only when it is in `run.unlocked`. It shows a
  "RARE" badge. Placing it without the unlock is the problem `locked`.
- `unlock(run, id)` accepts a rare part at any stage (it is never available
  in another way). Other parts keep today's rule.
- Sockets copy those of the model part. Rig lookups use the model id.

## 8. Controls

### 8.1 Desktop (R2)

| Input | Action |
| --- | --- |
| W A S D, arrows | Move (unchanged) |
| Mouse pointer | Aim (§8.4) |
| Left mouse press | Basic (§8.3) |
| Space | Basic (§8.3) |
| Right mouse | Slot 1 (hold for Brace) |
| 1, 2, 3, 4 | Slots 1–4 |
| E / Q | Rise (or Breach) / Dive (unchanged) |
| Middle-mouse drag, or Alt + left drag | Turn the camera |
| Esc, P | Pause (unchanged) |

- A left press on the canvas no longer turns the camera. The camera turns
  with a middle drag, or an Alt + left drag (trackpads).
- Tap-to-walk on the ground (ground plans) stays for touch only. On desktop,
  a left click is the basic move.
- The context menu is suppressed on the canvas.
- The desktop hint reads "WASD TO MOVE · MOUSE TO AIM · MIDDLE-DRAG TO LOOK".

### 8.2 Phone (R3)

- The left thumb uses the joystick (move).
- The right thumb uses the basic button (`#chomp`, label "CHOMP") and four
  slot buttons (`#slot-1` … `#slot-4`) in an arc above and to the left of it.
- Rise / Breach and Dive are in a column at the right edge.
- An empty slot is hidden. An inactive move has no button.
- Each slot button shows the move icon, a cooldown ring
  (`conic-gradient`) and, on desktop, its key.
- A press on a slot button starts the move. A hold keeps Brace up.
- **Touch cancel:** `pointercancel`, or a lost capture without `pointerup`,
  on any combat button sets `activeCanceled` for that slot and clears input.
  A cancel ends Brace with no buffered press.
- Swipes on the world still turn the camera.

**Layout at 320×568** (CSS px from the top-left; circles drawn in these
boxes; no two boxes overlap):

| Control | x | y | w | h |
| --- | --- | --- | --- | --- |
| Joystick | 12 | 428 | 96 | 96 |
| Basic `#chomp` | 198 | 440 | 84 | 84 |
| Slot 1 (180°) | 120 | 458 | 48 | 48 |
| Slot 2 (140°) | 143 | 396 | 48 | 48 |
| Slot 3 (100°) | 199 | 364 | 48 | 48 |
| Slot 4 (60°) | 264 | 375 | 48 | 48 |
| Rise / Breach | 264 | 255 | 48 | 48 |
| Dive | 264 | 311 | 48 | 48 |

The basic centre is (240, 482). The slot centres are at 96 px from it, at
180°, 140°, 100° and 60° (counterclockwise from the right, screen up). The
toast moves to `bottom: 250px` with `max-width: calc(100vw − 144px)` so it
never covers a control.

**Layout at 844×390:**

| Control | x | y | w | h |
| --- | --- | --- | --- | --- |
| Joystick | 24 | 274 | 96 | 96 |
| Basic `#chomp` | 660 | 290 | 80 | 80 |
| Slot 1 (180°) | 584 | 306 | 48 | 48 |
| Slot 2 (140°) | 606 | 247 | 48 | 48 |
| Slot 3 (100°) | 660 | 215 | 48 | 48 |
| Slot 4 (60°) | 722 | 226 | 48 | 48 |
| Rise / Breach | 788 | 226 | 48 | 48 |
| Dive | 788 | 282 | 48 | 48 |

The basic centre is (700, 330); the slot radius is 92 px.

**Desktop reference (1280×800):** basic 119 px (today's size) at right 4.2 %,
bottom 65 px; slots 64 px on a 130 px radius at the same angles; Rise and
Dive 64 px in a column above slot 4 (x 1200, y 379 and 451).

The layouts are the same for a swimmer, a crawler (no Rise or Dive column)
and a breacher (the Rise button reads "BREACH").

### 8.3 The basic dispatch rule (`feeding.ts`)

When the basic input is pressed or held:

1. The **Bite cone** is the resolved Bite shape with the current aim, with
   the range × 1.25.
2. If a combat species that is not eaten, with `tier` equal to the stage or
   the stage + 1, has a hurtbox inside the Bite cone, the player starts Bite.
3. Else, today's chomp runs (`biteTargets` and `chomp`, moved to
   `feeding.ts`). Combat species are not chomp targets.

Herbivores (plan review R17): in step 2, a herbivore takes only a combat
species that is engaged with it: its mode is `hunt` or `angry`, it has an
action that targets the player, or it made contact with the player (any
outcome: hit, blocked, evaded, countered) in the last 3 s
(`ENGAGED_SECONDS`). Otherwise CHOMP eats. Meat and omnivore diets keep the
rule above.

This rule is the same for Space, the left mouse and the phone button. Space
keeps its eat-food meaning when no enemy is in the cone.

### 8.4 Aim

- **Desktop pointer, pick first** (final review C1): the pointer picks the
  live combat species under it: the nearest hurtbox sphere that the pointer
  ray meets, else the nearest projected hull centre within 48 CSS px of the
  pointer. The aim points from the player at that hull centre: yaw and pitch
  for a free mover (pitch clamped to `PITCH_LIMIT`), yaw only for a ground
  mover. A pick counts while the pointer is over the canvas, also when the
  pointer is still (review M1).
- **Desktop pointer, no pick:** the aim yaw points at the first point of the
  ray beyond the player's depth along the ray that is on the horizontal plane
  through the creature's origin, or in the seabed or a solid (sampled up to
  16 L beyond the player). A point between the camera and the player is never
  used (it lies behind the player when the target is lower or higher). With
  no such point, the aim is the ray's own horizontal direction.
- The no-pick pointer counts only when it is over the canvas and moved in the
  last 4 s. Else the aim is the camera forward (keyboard-only, R2).
- **Phone drag:** a drag on the basic button beyond 12 px from the press
  point sets the aim yaw: screen up is the camera's horizontal forward. The
  same press starts the basic move at once; the drag then steers it until the
  lock, and steers the next Bites while the button is held.
- **Phone auto-aim** (no drag): the nearest hostile within a 60° half cone of
  the facing and within 3 × the Bite range. Priority: an enemy in wind-up
  that targets the player, then hunters and fighters, then prey; then
  distance. With none, the aim is the facing. Auto-aim is off while inked.
- **Pitch (free movers):** toward the soft-lock target when one is within a
  30° yaw cone of the aim, else the creature's pitch; clamped to
  ±`PITCH_LIMIT`. Ground movers aim level.
- A small aim chevron at 1 L in the aim direction shows while a combat
  species is within 4 L.

### 8.5 Input intent (`input.ts`)

- `InputSources` gets `activeTapped`, `activeHeld` and `activeCanceled` as
  `Tuple4<boolean>`, `aim` and `aimSource`.
- `readIntent` builds the four-slot tuples with today's rules.
  `basicPressed` is the raw basic press, also on a tick with a slot press
  (T9, the T7 carry). `CombatWorld` suppresses the basic input of a tick
  only when a slot press of that tick is accepted (the move starts, or it
  is buffered behind a busy action). An empty, inactive, cooling or
  refused slot does not suppress a Bite or the chomp fallback. A raw basic
  press still counts toward break-free progress.
- `basicRequested(intent, slotAccepted)` stays the one place the simulation
  asks for the basic move.
- `RELEASED` has four-slot tuples.

## 9. Telegraphs, hit feel and the director

### 9.1 Telegraph (R4)

For each species action in windup, the telegraph view draws:

1. **The shape volume.** A translucent 3D mesh of the exact `WorldShape`
   (cone, spherical sector for half angles above 60°, or capsule) from
   `combat-shapes.ts`. Its outline is drawn twice: once with depth test, and
   once without depth test at 35 % opacity (an x-ray outline through rocks and
   the creature).
2. **The fill.** An inner copy fills from the origin outward:
   `fill = (τ − τ0) / (windup + extension)`. A cone fills by range; a capsule
   from start to end; a sphere by radius.
3. **The depth ring.** A ring on the seabed under the shape's centroid, with
   the shape's horizontal extent as radius, and a dashed vertical line from
   the centroid to the ring.
4. **The pose cue.** The telegraph profile's `poseCue` (rear back 15°,
   crouch, inflate to × 1.35, coil, sink into the sand, spin up).
5. **The colour flash.** The attacker flashes at windup start for 0.1 s, and
   again `flashLeadSeconds` (0.12 s) before active.
6. **Colour code.** Amber, solid: can be blocked. Red with stripes: cannot be
   blocked. The stripes make the difference readable without colour.
7. **Sound.** A rising wind-up tone. The telegraph never needs the sound.
8. **Off-screen arrow.** When the shape centroid is outside the view frustum
   at any time in windup, an edge arrow in the telegraph colour shows at the
   screen edge toward it, with a ring that fills like the shape. It shows
   from windup start (or from the moment it goes off-screen) to the end of
   active.

The volume, fill and ring use the same `WorldShape` object as the hit test.
Before the lock they follow the live aim; after the lock they are fixed.

### 9.2 Hit feel (R5)

| Feedback | Rule |
| --- | --- |
| Hit-stop | §5.9 |
| Knockback | Impulse into `externalVelocity` (§6.2 step 6) |
| Flash | The hurt actor's materials flash white for 0.08 s |
| Damage number | Enemy: "−4". Player: "−½ ♥", "−1 ♥", "−1½ ♥". Blocked: "BLOCK". Countered: "COUNTER!". Evaded: "DODGE" |
| Camera shake | Only for hits on the player and for the player's Sweep and Counter. It uses today's `world.shake` (1 = today's hurt shake): `min(1, 0.35 × hh)` for a player hit; `min(0.6, 0.1 × d)` for a Sweep or Counter hit. None when `prefers-reduced-motion: reduce` |
| Impact particles | At the hit point: 10 particles; colour by outcome (hit `#ffd9a8`, player hurt `#ff8f7a`, block `#cfe3ff`, counter `#fff2b3`) |
| Sounds | `hit`, `block`, `counter`, `dash`, `grab`, `break` (break-free and guard break); today's `hurt` for the player |
| Vibration | Phones: 15 ms on a player hit on an enemy; `[30, 40, 30]` when the player is hit (today's pattern) |

### 9.3 HP display

- A combat species shows a small HP bar above it after its first damage, for
  4 s after the last damage.
- An alpha shows a bar at the top centre while the player is inside 1.5 × its
  lair radius: the name, the HP and the phase pips.

### 9.4 The director (`director.ts`)

- A species action that targets the player needs a **token** at its start.
  The token is held to the end of active (to the end of hold for a grab).
- **At most 2 tokens** at once.
- **Active starts at least 0.25 s apart.** When a new token's active start
  `T` is less than 0.25 s from a held token's active start `T_i`, the new
  action's `windupExtension` grows to `T_i + 0.25 − T`. The extension only
  makes a wind-up longer, never shorter. The check repeats against each held
  token. The extension is at most 0.5 s; if more is needed, the token is
  refused.
- **The estimate** (plan review R6): a new token's active start is
  `now + one tick + the attacker's remaining hit-stop + windup + extension`
  (the action's clock starts on the next combat tick). After each combat
  tick, every held wind-up's active start is estimated again (remaining
  wind-up plus remaining hit-stop), so a hit-stop moves it.
- **Spacing holds after the grant** (plan review R6): after each combat
  tick, in order of active start, a wind-up less than 0.25 s after an
  earlier token's active start grows by the missing time. If its total
  extension would then be more than 0.5 s, the wind-up **ends**: its token
  returns, its cooldown is not spent, and its attacker asks again after
  0.2 s. Two active starts at the player are never less than 0.25 s apart.
- **Game time** (T11 fix round 1): active starts are ≥ 0.25 s apart in game
  time (read from the action clock: `activeStartedAt`); a frame-based
  observer may see up to one tick less.
- `rt.lastThreatAt` of the player is set at the end of each combat tick
  while a wind-up at the player runs.
- A faint or an evolution ends every attack at the player and returns every
  token; it does not spend the attackers' cooldowns.
- A token whose attacker is no longer live (eaten, inactive, gone) returns,
  and its action ends without a cooldown. The sim forgets the combat state
  of every eaten entity at the end of the frame.
- A start at the player must give `onScreen`, `playerHeld` and the tick
  length; without them it is refused (`no-context`).
- **Off-screen:** when the shape centroid is off-screen at the request,
  `windup + extension ≥ 0.6 s`. `sim.ts` gets an `isOnScreen(p)` function
  from `main.ts`; the probe uses a fixed camera model (§14.3).
- **Grabs:** a grab gets a token only when no other token is held. While the
  player is held, no token is given.
- A refused request: the entity repositions and asks again after 0.2 s.
- Prey fighters use tokens too.

## 10. Health, damage, faint and DNA

### 10.1 Units (R6)

- Player health stays in hearts (`run.health`). It can now have `.5` steps.
  The maximum is unchanged: `max(3, 6 + round(effective.health))`.
- Enemy attacks and contact hazards deal half-hearts.
  `damageAfterArmor(raw, armor) = max(1, raw − floor(armor / 2))` works in
  half-hearts. Brace multiplies after it (§6.2).
- Hearts on the HUD show half hearts.
- Legacy chomp damage against legacy species (`derived.bite` against
  `spec.hp`) does not change.

### 10.2 Regeneration

The player regains 0.5 heart every 2 s once 6 s have passed since the last
damage taken (`lastDamageAt`) and since the last wind-up that targeted the
player (`lastThreatAt`). This replaces "1 heart every 2.5 s after 5 s".

### 10.3 Faint (R7)

- At 0 hearts, `beginRespawn` runs once (unchanged guard). `state.faint` now:
  increments `deaths`, applies `faintCombat` (wallet at-risk to 0; every
  part's at-risk credit to 0; basis, banked credit and the design stay), sets
  `stageDna = 0`, and sets `pendingRespawn`. The run is saved before the
  animation.
- `economy.ts`: `faintLegacy` is removed. New pure helper
  `faintLoss(e): { wallet: number; parts: number }` returns what
  `faintCombat` takes. `state.ts` loses `DEATH_KEEP`.
- The faint overlay says: "Fainted! You lost N DNA. Your body and parts
  stay." N is the true loss: `faintLoss(e).wallet + faintLoss(e).parts` (the
  at-risk wallet and the at-risk credit of the parts; T15 ruling). With no loss
  it says "No DNA was lost."; with no known loss, "Waking up at the start."
- After the respawn, the toast says: "You woke up at the start. Eat to grow
  again."
- Respawn uses today's flow (validated anchor, 3 s grace). Also: every
  hunter or alpha whose target was the player gives up (`return`, with
  `returnUntil = now + 6`), and every token returns to the director.
- A save made during a faint by an older build (legacy loss already applied)
  resolves the respawn and applies no second loss.

### 10.4 DNA from combat (R8)

`state.ts` gets `killReward(run, spec, killer)`, `survivorReward(run, spec)`
and `alphaReward(run, spec)`.

| Case | DNA | Counts for the growth bar |
| --- | --- | --- |
| Meat eater (carnivore or omnivore) kills a combat species | `mealDna(plan, diet, spec)` (omnivore × 0.7, foraging; one rounding). `bites` + 1 | When `spec.tier === stage` or `spec.hunts` includes the stage |
| Herbivore kills a combat species | 0. The entity is driven off: consumed, and it respawns | — |
| Herbivore survives a hunter | `round(0.35 × spec.dna)` | Yes |
| Anyone defeats an alpha | `alpha.rewardDna`, and the rare part is unlocked | Yes |

- **Survivor bonus:** the species has a `hunter` or `hunter-ambush`
  behaviour; it was in `hunt` or `angry` with the player as target for at
  least 4 s; it started at least one wind-up against the player in that
  engagement; then it gives up (`return`) or the herbivore kills it; the
  player is not fainted. One bonus per engagement.
- **Alphas:** the defeat is recorded by the rare part in `run.unlocked`. An
  alpha whose reward part is unlocked is not spawned for the rest of the run.
  So the reward comes once. An alpha is present only while the player's stage
  equals `alpha.size`.
- `DROPS` stays: defeating a crab can still unlock the Crab leg.

### 10.5 Saves

- The version stays 4. The save key rules do not change: legacy keys are
  never written.
- `readV4` reads `loadout` in two shapes. The old `{ active: [a, b] }`
  becomes `{ slots: [null, null, null, null] }` (no shipped part had an active
  grant, so no real binding is lost). The new shape must be four entries,
  each `null` or a `MoveKind`.
- `validateRun` checks: `slots` has four entries; each is null or a granted
  kind; no kind twice. It accepts health in `.5` steps (`finite`, `≤ max`).
- `freshRun` and `migrate` write `{ slots: [null, null, null, null] }`.
- No other field is added. Alpha defeats use `unlocked`.
- First-time hints are not in the save (§12.3).

## 11. Enemies

### 11.1 Rosters and minimum wind-ups

A species is **hostile at size s** when it hunts `s`, or it is a fighter
with `tier === s`, or it is an alpha with `alpha.size === s`. Prey are at the
player's tier. Hunters and alphas are one tier up, as in today's ecosystem.

| Size | Prey that flees | Prey that fights | Hunters | Alpha |
| --- | --- | --- | --- | --- |
| 0 | Drifter shrimp `0:drifter` | Spiny snail `0:spiny_snail` | Peach crab `1:crab` | Old Clawmother `1:clawmother` |
| 1 | Sunny sardine school `1:sardine` | Puffer `1:puffer` | Berry squid `2:squid`, Moray eel `2:eel` | Reef Tyrant `2:reef_tyrant` |

Existing legacy food (plants, copepod, worm, shrimp, sea snail) stays. The
Moon jelly (`1:jellyfish`) stays a contact hazard (2 half-hearts). At size
1, the Peach crab is a same-tier fighter: it fights back when bitten, with
the same attacks.

`MIN_WINDUP` (validated by V8, before director extensions):

| Size | Prey fighters and hunters | Alphas |
| --- | --- | --- |
| 0 | 0.45 s | 0.55 s |
| 1 | 0.40 s | 0.55 s |

The Berry squid keeps `hunts: [1, 2]`. At size 2 it uses these attacks until
3b retunes it.

### 11.2 AI state machines (R9, `combat-ai.ts`)

The ecosystem keeps its pursuit modes (`calm`, `flee`, `hunt`, `angry`,
`return`) and the §10 rules for acquisition, memory, reachability and give-up.
A combat species also has a combat state. Each tick, `combat-ai.ts` returns a
**move intent** (`ambient`, `toward(point, speedFactor)`,
`away(point, speedFactor)`, `hold`) and may request an action. The
ecosystem moves the entity by the intent through `resolveMotion`. The RNG is
seeded per entity from `(run seed, entity id)`.

**Common states:** `held` (grabbed: no intent, no action), `staggered` (no
intent, no action), `dead`.

**`prey-flee` (Drifter shrimp):**

| State | Rule | Next |
| --- | --- | --- |
| `idle` | Ambient. The player is within today's flee distance (`7 × max(size, SIZES[stage]) × stealth`), after `reactionSeconds` (0.2 s). Or a hit. | `flee` |
| `flee` | `away(player, flee.speedFactor 1.3)` for `flee.seconds` (2.0 s) | `rest` |
| `rest` | Ambient at 0.35 speed for `restSeconds` (1.2 s); it cannot flee (it is tired) | `idle` |

**`prey-school` (Sunny sardine):** as `prey-flee`, and: when one member
enters `flee`, every member within `school.radiusBodyLengths` (6) enters
`flee` on the same tick, with one shared direction (away from the player,
from the members' centroid). `rest` moves toward the school centroid. Schools
spawn as groups of `school.groupSize` (4) within 2 L of a group centre.

**`prey-fighter` (Spiny snail, Puffer):**

| State | Rule | Next |
| --- | --- | --- |
| `idle` | Ambient (graze or drift). A hit, or the player within `trigger.radiusBodyLengths` for `trigger.seconds` | `face` |
| `face` | `hold`; turn to the player for 0.2 s | `attack` (token) or `idle` (player out of range) |
| `attack` | The engine runs its one attack | `back-off` |
| `back-off` | `away(player, 0.5)` for 2 s; level (horizontal) when the player is a ground mover, so it never rises out of a crawler's reach (T18 review M2) | `idle` |

It never approaches more than 0.5 L from where it started the fight. Its
pursuit policy is `retaliate` (memory only).

**`hunter` (Peach crab, Berry squid):**

| State | Rule | Next |
| --- | --- | --- |
| `idle` | Today's calm and acquisition | `notice` when it acquires |
| `notice` | `hold`; face the player; the "!" marker; `reactionSeconds` (0.35 s) | `approach` |
| `approach` | `toward(pursuit target, 1.0; 1.15 when angry)` | `attack` when a band holds `d`, the attack cooldown and the gap are ready, and the director gives a token |
| `attack` | The engine runs the action | `reposition` |
| `reposition` | Strafe around the player at `repositionSpeedFactor` (0.6) for a seeded time in `repositionSeconds`, keeping `d` in `[0.4, 0.9] L_e` | `approach` |
| any | Today's give-up rules | `return`, then `idle` |

- `d` is the distance between the entity centre and the nearest player
  hurtbox, minus the entity's hull radius, in `L_e`.
- **Attack choice:** among the attacks whose band holds `d` and whose
  cooldown is ready, pick by weight. When the player is more than 40° off the
  entity's forward, `flankWeight` replaces `weight`. A chain
  (`chainNextId`) starts the next attack after `chainGapSeconds` without a
  new choice, but it needs its own token. The chained attack starts only while
  `d` is within its reach (the parent's band end, and no more than the chained
  attack's own reach from the hull surface); until then the entity closes in.
  A chain not started 1 s after it was due is dropped (T23 probe, P0: the
  first hit's knockback carried the player out of reach of the second).
- **Gap:** after an action ends, the hunter starts no attack for `gapSeconds`.
- A hunter that returns to `calm` gets its full HP back, but not within 8 s
  of its last damage: then it heals once 8 s pass without damage (D37, T18
  review).
- Inside its smallest band (only when every band starts above 0, as the
  squid's do) no attack fits, so the hunter backs out to that band's lower
  bound + 0.1 L instead of pressing in (T18).

**`hunter-ambush` (Moray eel):**

| State | Rule | Next |
| --- | --- | --- |
| `den` | `hold` at the den; only the head shows; targetable | `ambush` when the player's centre is within `den.triggerBodyLengths` (0.9 L_e) + 0.5 L_e (a hull allowance) of the den, so 1.4 L_e, and visible (review M9) |
| `ambush` | `eel-ambush` (token) | `out` |
| `out` | As `hunter` `approach`/`attack`/`reposition`, for `den.outSeconds` (4 s) after its last hit lands | `retreat` |
| `retreat` | `toward(den, 1.0)` | `den` |

Pursuit policy `ambusher`: memory 3 s, blocked wait 1 s, reacquire 4 s, leash
3 L, give-up 4 L (final review I4: with 1.5 L and 3 L the 1.2 L ambush lunge
and its knock used up the leash, and the eel swam home without a Bite or a
Wrap). The den is its home: the leash is measured from the den,
and a reinstall during a fight does not move the den. For every pursuit, the
leash and give-up distances leave out the displacement that knockback and
body separation gave the body during the engagement, so a Bite's knockback
alone never ends a fight (T18 review I2).

**`alpha`:** a hunter bound to its lair, with phases.

- The **lair** is a seeded point (plan review R15, T17): its centre is
  `resetOutsideFactor × lair radius + 5 × L_p + (1 + rand) × SIZES[alpha.size]`
  from the start anchor (next to the world centre), at the angle
  `π/4 + k × π/2 ± 0.05` (k = 0–3 from `rand`), where `L_p` is the longest
  fully grown (× 1.38) starter body length of that size. Then the nearest
  admitted pose of the alpha's actor (`findRecoveryPose`, max distance 4 L).
  So the start anchor is outside 1.5 × the lair radius + 5 player body lengths,
  and the whole lair is inside the spawn square. (The earlier rule, radius
  `(22 + 8 × rand) × S` around the centre, could put the anchor in the lair.) It never moves out of
  `lair.radiusBodyLengths × L_e` of the lair: approach targets are clamped to
  that disc.
- It acquires the player only inside the lair radius (plus its notice rules).
- **Phase:** the first phase whose `aboveHpFraction < hp / maxHp`, in order.
  At a phase change it roars for 0.8 s: no action, stagger-immune, a ring
  flash, and the hint toast "The <name> is getting angry!".
- **Reset:** when the player is outside `resetOutsideFactor` (1.5) × the lair
  radius for `resetDelaySeconds` (3 s), the alpha goes to the lair centre and
  heals `healPerSecond` (4 %) of max HP per second. At full HP it is back in
  phase 1.
- **Defeat:** reward (§10.4); the entity is removed for the run.

### 11.3 Species data

Speeds are in tier-local units per second (× `SIZES[tier]`). HP is in HP.
`L_e = SIZES[tier] × 1.4 × bodyScale`.

| Key | Label | Tier | Model (tint, scale) | Tag | Count | DNA | HP | Speed | Behaviour | Poise | Stagger resist | Knockback resist | Grabbable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0:drifter` | Drifter shrimp | 0 | shrimp (`#f6b58f`, 1.0) | meat | 8 | 14 | 3 | 3.0 | `drifter` (prey-flee) | 99 | 0 | 0 | yes |
| `0:spiny_snail` | Spiny snail | 0 | snail + 3 `part_spike` (`#c9a3e6`, 1.0) | meat | 6 | 16 | 6 | 0.5 | `spiny-snail` (prey-fighter) | 4 | 0 | 0 | yes |
| `1:crab` | Peach crab | 1 | crab (today) | meat | 8 | 24 | 20 | 1.3 | `crab` (hunter) | 6 | 0 | 0.2 | yes |
| `1:clawmother` | Old Clawmother | 1 | crab (`#9c3b2e`, 1.8) | meat | 1 | 0 | 80 | 1.0 | `clawmother` (alpha) | 14 | 0.5 | 0.6 | no |
| `1:sardine` | Sunny sardine | 1 | fish (`#ffd36e`, 0.55) | meat | 12 | 15 | 4 | 3.2 | `sardine` (prey-school) | 99 | 0 | 0 | yes |
| `1:puffer` | Puffer | 1 | fish (`#f2c94c`, 0.75) | meat | 6 | 20 | 10 | 0.9 | `puffer` (prey-fighter) | 6 | 0 | 0.2 | yes |
| `2:squid` | Berry squid | 2 | squid (today) | meat | 8 | 30 | 26 | 1.1 | `squid` (hunter) | 7 | 0 | 0.3 | yes |
| `2:eel` | Moray eel | 2 | worm (`#3d6b4f`, 1.0) | meat | 4 | 28 | 22 | 1.4 | `eel` (hunter-ambush) | 6 | 0 | 0.3 | yes |
| `2:reef_tyrant` | Reef Tyrant | 2 | worm (`#4b2f5e`, 1.6) | meat | 1 | 0 | 110 | 1.5 | `reef-tyrant` (alpha) | 16 | 0.5 | 0.6 | no |

- `hunts`: crab `[0]` (today), Clawmother `[0]`, squid `[1, 2]` (today), eel
  `[1]`, Reef Tyrant `[1]`. `fights: true` for every combat species except
  the drifter and the sardine.
- Pursuit: crab, squid, Clawmother, Reef Tyrant `hunter`; eel `ambusher`;
  snail, puffer `retaliate`; drifter, sardine `none`.
- Movement and habitat: drifter, sardine, puffer, squid, eel, Reef Tyrant
  `sp-swim` / `sp-water`; snail, crab, Clawmother `sp-ground` / `sp-seabed`.
- Alpha data: Clawmother `{ size: 0, rewardPartId: 'claw_mother',
  rewardDna: 40 }`; Reef Tyrant `{ size: 1, rewardPartId: 'mouth_tyrant',
  rewardDna: 60 }`.
- Biome weights (added): tier 0 "Copepod cloud" drifter 2, "Grape garden"
  drifter 1, "Wormy sands" spiny snail 2, "Sprout meadow" spiny snail 1;
  tier 1 "Coral garden" sardine 2 and puffer 1, "Lettuce beds" sardine 1,
  "Jelly drift" puffer 1; tier 2 "Ray shallows" eel 1, "Squid deep" eel 1.
  Alphas are placed at their lair, not by weight.
- Spawn heights: drifter `ground + 0.6 + 1.6 × rand`; spiny snail
  `ground + 1`; sardine `ground + (1.25 + 1.25 × rand) × S`; puffer
  `ground + (0.8 + 0.8 × rand) × S`, inside a size-1 crawler's level Bite
  cone (T18 review I1: it reaches 1.8–2.4 S); school members keep their
  leader's height above the seabed ± 0.5 L; eel at its den.
- **Eel dens:** each eel picks a seeded reef solid of `stageSolids(2, seed)`
  inside the spawn square; from the solid's centre it walks out along a
  seeded direction until its hull clears every solid by 0.25 L_e, on the
  seabed, then `findRecoveryPose` (4 L). Without a solid, a normal spawn. The
  eel respawns at its den.
- Respawn after a kill: hunters 30–40 s; other combat species today's
  14–22 s. Alphas never respawn.
- `entityRadius`, the hull sphere and `bodyLength` are multiplied by
  `bodyScale`.

### 11.4 Behaviour data

| Behaviour | Reaction (s) | Gap (s) | Reposition (s) | Other |
| --- | --- | --- | --- | --- |
| `drifter` | 0.2 | — | — | flee 2.0 s at × 1.3, rest 1.2 s |
| `sardine` | 0.2 | — | — | flee 2.5 s at × 1.3, rest 1.5 s; school radius 6 L, group 4 |
| `spiny-snail` | 0.1 | 2.5 | — | trigger 1.2 L for 1.0 s |
| `puffer` | 0.1 | 3.0 | — | trigger 1.1 L for 0.8 s |
| `crab` | 0.35 | 1.0 | 0.6–1.2 | — |
| `squid` | 0.35 | 0.8 | 0.6–1.2 | — |
| `eel` | 0 (ambush), 0.35 (out) | 0.8 | 0.5–1.0 | den trigger 0.9 L, out 4 s |
| `clawmother` | 0.35 | phase | 0.6–1.0 | lair 1.2 L (R15) |
| `reef-tyrant` | 0.35 | phase | 0.6–1.0 | lair 1.39 L (R15) |

### 11.5 Species attacks

All species attacks: `damageUnit: 'half-heart'`, `crossing: 'same-medium'`,
`obstruction: 'terrain-and-cover'`, `maxTargets: 1`, `hitGroup:
'shared-grant'`, socket `centre`; the shape origin is the hull front, or the
hull centre for `centre` attacks (§5.10, plan review R2). Shape numbers in `L_e`. "Lock" is
`aimLockAtSeconds`. Telegraph: amber solid unless the attack is unblockable
(red stripes). `staggerSeconds` is the player's stagger. "Int." = interruptible
(in windup; lunges in windup only).

| Attack | Shape | Wind-up | Lock | Track (rad/s) | Active | Recovery | Cooldown | Damage (½♥) | Impulse | Stagger | Block | Parry | Int. | Band (L_e), weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `snail-poke` | cone 1.2, half 50° | .50 | .30 | 2.5 | .12 | .80 | 2.5 | 2 | 4 | .30 | yes | yes | yes | [0, 1.2] 1 |
| `crab-pinch` | cone .45, half 35° | .50 | .28 | 2.5 | .10 | .55 | 1.6 | 2 | 3 | .30 | yes | yes | yes | [0, .45] 3 |
| `crab-lunge` | capsule (0,0,0)–(0,0,1.4) r .22; lunge 1.2 | .60 | .35 | 2.0 | .22 | .75 | 3.5 | 3 | 6 | .35 | yes | yes | windup | [.5, 1.4] 2 |
| `crab-sweep` | cone .65, half 70° | .55 | .30 | 2.5 | .14 | .70 | 4.0 | 2 | 8 | .30 | yes | yes | yes | [0, .6] 1, flank 3 |
| `mother-pinch` | cone .40, half 35° | .55 | .30 | 1.5 | .10 | .45 | 1.4 | 3 | 4 | .35 | yes | yes | no | [0, .4] 3; chain → `mother-pinch-2` after .55 s (T23, R13: was .2 s) |
| `mother-pinch-2` | cone .40, half 35° | .55 | .30 | 1.5 | .10 | .90 | 1.4 | 3 | 4 | .35 | yes | yes | no | chain only |
| `mother-lunge` | capsule (0,0,0)–(0,0,1.0) r .20; lunge .9 | .65 | .40 | 1.5 | .22 | .80 | 4.0 | 4 | 8 | .40 | yes | yes | no | [.4, 1.0] 1 |
| `mother-emerge` | capsule start = end r .35, at the player's position at windup start (`fixed-at-start`, `origin: 'target'`, R4) | .70 | 0 | 0 | .15 | 1.10 | 2.0 | 4 | 10 | .40 | **no** | yes | no | burrow pattern |
| `mother-sweep` | cone .60, half 75° | .60 | .35 | 1.5 | .14 | .40 | 3.0 | 3 | 9 | .35 | yes | yes | no | [0, .6] 2; chain → `mother-pinch-rage` after .55 s (T23, R13: was .1 s) |
| `mother-pinch-rage` | cone .40, half 35° | .55 | .30 | 1.5 | .10 | .80 | 1.4 | 3 | 4 | .35 | yes | yes | no | chain only |
| `puffer-burst` | capsule start = end r 1.6 (`centre`) | .55 | 0 | 0 | .15 | 1.20 | 3.0 | 3 | 7 | .35 | yes | yes | no | [0, 1.35] 1 (T23: was [0, 1.6]; the ball reaches 1.35 past the hull surface) |
| `squid-ink` | cone .90, half 30°; status `inked` | .45 | .25 | 2.0 | .30 | .60 | 6.0 | 1 | 0 | 0 | yes | **no** | yes | [.3, .9] 1 |
| `squid-grab` | capsule (0,0,.1)–(0,0,.75) r .12; hold 1.0 s, size factor 1.2, start 2, squeeze 1 every .5 s | .55 | .30 | 1.8 | .12 | .70 | 4.5 | 2 | 0 | 0 | **no** | yes | yes | [.2, .75] 2 |
| `squid-lunge` | capsule (0,0,0)–(0,0,1.1) r .18; lunge 1.0 | .45 | .25 | 1.8 | .22 | .80 | 3.5 | 3 | 6 | .35 | yes | yes | windup | [.6, 1.2] 2 |
| `eel-ambush` | capsule (0,0,0)–(0,0,1.3) r .15; lunge 1.2 | .45 | .25 | 2.0 | .20 | .70 | 5.0 | 3 | 3 (I4; was 6) | .35 | yes | yes | windup | den only |
| `eel-bite` | cone .45, half 35° | .45 (T23 ruling: was .40; avoidable by a move at a .35 s reaction) | .20 | 2.2 | .10 | .50 | 1.5 | 2 | 3 | .30 | yes | yes | yes | [0, .45] 3 |
| `eel-wrap` | capsule (0,0,0)–(0,0,.6) r .20; hold 1.2 s, size factor 1.2, start 1, squeeze 1 every .4 s | .60 | .35 | 2.0 | .12 | .80 | 6.0 | 1 | 0 | 0 | **no** | yes | yes | [0, .6] 1 |
| `tyrant-bite` | cone .40, half 35° | .60 | .35 | 1.5 | .10 | .60 | 1.5 | 3 | 4 | .35 | yes | yes | no | [0, .4] 3 |
| `tyrant-den-lunge` | capsule (0,0,0)–(0,0,1.2) r .14; lunge 1.1 | .70 | .45 | 1.5 | .25 | .90 | 4.0 | 4 | 8 | .40 | yes | yes | no | [.4, 1.2] 2 |
| `tyrant-charge` | capsule (0,0,0)–(0,0,1.6) r .16; lunge 1.5 (`fixed-at-start`) | .65 | 0 | 0 | .30 | .50 | 2.0 | 4 | 10 | .40 | yes | yes | no | laps pattern |
| `tyrant-whirl` | capsule start = end r .55 (`centre`); max 2 hits per target, repeat .30 s | .80 | 0 | 0 | .60 | 1.20 | 5.0 | 3 | 8 | .35 | **no** | **no** | no | [0, .3] 2 (T23: was [0, .55]; V21: the ball (.55) reaches .3 past the hull surface) |

`inked` status (`effect ink`): 1.5 s, player speed × 0.7, darker screen edges,
auto-aim off. A blocked ink applies no status.

The wind-ups respect the floors: size-0 hostiles ≥ 0.45 s (snail 0.50, crab
0.50–0.60); size-1 hostiles ≥ 0.40 s (puffer 0.55, squid 0.45–0.55, eel
0.45–0.60); alphas ≥ 0.55 s (Clawmother 0.55–0.70, Reef Tyrant 0.60–0.80).

### 11.6 Alpha phases

**Old Clawmother** (lair radius 1.2 L_e = 12.1 units, plan review R15: at most 0.25 × `PLAYER_HALF` × SIZES[0]; L_e = 10.08):

| Phase | HP above | Pattern | Attacks (weight) | Speed | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 Pinch combos | 60 % | normal | `mother-pinch` → `mother-pinch-2` (3), `mother-lunge` (1) | × 1.0 | 1.0 s |
| 2 Burrow ambush | 30 % | burrow | two `mother-emerge`, then one pinch combo; repeat | × 1.0 (× 1.6 while burrowed) | 0.8 s |
| 3 Enraged | 0 | normal | `mother-sweep` → `mother-pinch-rage` (2), `mother-pinch` (1) | × 1.3 | 0.7 s |

Burrow: the Clawmother sinks (0.4 s, pose cue `burrow`), moves under the sand
toward the player for 1.2 s at × 1.6 (untargetable, inside the lair), then
starts `mother-emerge` at the player's position. While burrowed, a dust trail
shows on the seabed.

**Reef Tyrant** (lair radius 1.39 L_e = 49.8 units, plan review R15: at most 0.25 × `PLAYER_HALF` × SIZES[1] = 50; the review's 1.4 L_e is 50.18, just over; L_e = 35.84):

| Phase | HP above | Pattern | Attacks (weight) | Speed | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 Lair bites | 66 % | normal, within 0.6 × lair radius | `tyrant-bite` (3), `tyrant-den-lunge` (2) | × 1.0 | 1.0 s |
| 2 Charge laps | 33 % | laps | `tyrant-charge` every half lap, 2 charges, then a 1.5 s rest | × 1.4 on the lap (radius 0.8 × lair) | 0.6 s |
| 3 Whirl | 0 | normal | `tyrant-whirl` (2), `tyrant-bite` (2) | × 1.2 | 0.8 s |

**Lair place (both alphas, T19 review M2).** The lair rule of §11.2 picks one of four
corners: the angle is `π/4 + k × π/2 ± 0.05` with `k = floor(4 × rand)`, and the
distance from the start anchor changes only by `(1 + rand) × SIZES[alpha.size]`.
So each alpha is always near one of four diagonal points, and many seeds share
one (seeds 11, 12 and 13 all put the Reef Tyrant near (−104, −105)). This is
on purpose: the lair must stay inside the spawn square and away from the
anchor (R15). The root of a lair (and of an eel's den) is `HOME_LIFT` (0.05) ×
the hull radius above the seabed (T19 fix round 1, M1).

`lairFraction` (the BehaviourPhase field): phase 1 keeps the Tyrant within `lairFraction` (.6) × the lair radius; other phases leave it unset. Every phase keeps the same hostile set (size 1 only, `hostileSizes`); the laps circle the lair centre at 0.8 × the lair radius (T19).

The charge aims through the player's position at windup start, so its
telegraph is fixed for the whole wind-up.

### 11.7 Art reuse and art debt

| Item | 3a art | Debt (for a later art pass) |
| --- | --- | --- |
| Drifter shrimp | `shrimp.glb` at tier 0, tinted | Its own model |
| Spiny snail | `snail.glb` + 3 `part_spike.glb` on the shell, tinted | Its own model |
| Old Clawmother | `crab.glb` × 1.8, dark red tint; burrow = sink transform + dust particles | Its own model; burrow and emerge animation |
| Sunny sardine | `fish.glb` × 0.55, yellow tint | Its own model |
| Puffer | `fish.glb` × 0.75, yellow tint; inflate = uniform scale to × 1.35 | A round puffer model with spines and an inflate morph |
| Moray eel | `worm.glb` (tier 2), green tint | An eel model with a jaw pivot |
| Reef Tyrant | `worm.glb` × 1.6, purple tint | A moray model with a jaw pivot |
| Clawmother pincer | `part_claw_pincer.glb`, tint (no extra render scale, so `poseAgreement` stays exact) | Its own part model |
| Tyrant jaw | `part_mouth_fangs.glb`, tint | Its own part model |
| Ink cloud, impacts, telegraph volumes, depth rings | Procedural (three.js) | — |
| Move icons on slot buttons | Inline SVG (like today's icons) | — |

Tints are a material colour multiply, one cached material per (asset,
tint). `assets.ts` loads each GLB once.

## 12. Editor and hints (R11)

### 12.1 Moves panel

The stats sidebar gets a **Moves** section:

1. **Basic:** "Bite (Snapper): 4 damage · reach .60 L · wind-up .16 s".
2. **Slot bar:** four slots with the labels 1–4 (desktop keys). Each slot
   shows a move chip: icon, move name, part name, two key numbers.
3. **Inactive:** chips for the kinds that do not fit, with the label
   "Inactive — no free slot".
4. A tap on a chip opens its details: every resolved number at the current
   size, the numbers at size 0.4 and 1.8, and one line on the tradeoff
   ("Bigger: more reach and damage, slower wind-up.").

### 12.2 Part cards, size and swap

- A part card in the catalog gets a move line under its stats line, for
  example "Move: Dash · 1.6 L · 0.18 s dodge". A rare part shows "RARE".
- While the size slider moves for a selected part, the moves panel shows
  that part's move numbers as "old → new" (for example "Range .60 → .66 L ·
  Wind-up .16 → .17 s"), from `resolveMove`.
- **Swap:** drag a chip onto a slot (pointer drag), or tap a chip and then
  tap a slot (touch and keyboard). The dragged kind is pinned to that slot.
  When another kind was pinned there, it moves to the dragged kind's old slot
  (or is unpinned if the dragged kind was inactive).
- Pin changes are in the undo history. **Undo all** restores the committed
  pins.
- `EditorResult` gets `loadout`. `applyDesign` and `prepareEvolution` take
  it, and `clearMissing` clears pins for kinds that the design no longer
  grants.
- The lost-abilities preview becomes a lost-moves preview: "You lose: Dash
  (no fin, leg or Paddle tail left)", from `designDelta(...).clearedPins` and
  the kinds that disappear.
- There is no "Test" sandbox.

### 12.3 First-time hints

Each hint shows once per browser profile. The shown ids are kept in
`localStorage` key `tiny-tide-hints-v1` (a JSON string array; a read or write
error means "not shown", and the game goes on). Hints use the toast, at most
one every 6 s, and never replace another toast.

| Id | When | Text (desktop / phone) |
| --- | --- | --- |
| `move-<kind>` | The first time that kind is in a slot in play | Dash: "New move: Dash. Press 2 to zip through attacks." / "New move: Dash. Tap ⟫ to zip through attacks." (the key or icon is the slot's own) |
| | | Brace: "New move: Brace. Hold <key> to block in front of you." |
| | | Counter: "New move: Counter. Press <key> just before a hit lands." |
| | | Grab: "New move: Grab. Press <key> to hold a small creature." |
| | | Sweep: "New move: Sweep. Press <key> to knock away what is behind you." |
| `telegraph` | The first species wind-up that targets the player | "Orange shapes show where an attack lands. Get out, Brace or Counter!" |
| `telegraph-red` | The first unblockable wind-up | "Red striped attacks can't be blocked. Dash or swim out!" |

The break-free prompt ("Wiggle free! Tap CHOMP") is UI, not a hint. It shows
every time the player is held, with a ring for `breakProgress`.

## 13. Lifecycle integration

| Transition | Combat rule |
| --- | --- |
| Pause, canceled edit | World time stops, so every action clock stops. Input becomes `RELEASED`. |
| Committed edit | Today's design-delta rules cancel actions of removed or changed emitters. Pins are reconciled. Cooldowns of kinds that are gone are deleted. |
| Evolve | `resetRuntime` also clears `actionClock` (to 0), `hitStopUntil`, `buffered`, `heldBy`, `breakProgress`, `status`. Every species action that targets the player is canceled; tokens return. The player is not targetable while evolving. |
| Faint | §10.3. Grabs on the player end. Hunters give up until 6 s after the respawn grace. |
| Respawn | Today's rules; 3 s grace. |
| Load, new run | A fresh runtime; fresh entity combat state. |

`resolveHazards` keeps its rules. Its damage is in half-hearts. It sets
`lastDamageAt` for an accepted event.

## 14. Testing (R12)

### 14.1 Unit tests (`tests/tiny-tide-core/`)

| File | Named tests |
| --- | --- |
| `moves.test.ts` | `resolveMove matches the tables at .4, 1, 1.8`; `pair bonus only on mirrored dash and grab parts, one rounding`; `bite adds floor of non-mouth bite`; `representative part per kind`; `assignSlots priority order`; `pins win, then priority fills`; `fifth kind is inactive`; `pins for missing kinds are cleared at commit`. |
| `action-engine.test.ts` | `windup → active → recovery → done at exact times`; `cooldown starts at end of recovery`; `interrupted cooldown starts at the interrupt`; `aim turns at most maxTracking × Δτ`; `aim locks at aimLockAt and the shape is frozen`; `brace holds while held, min active, then recovery`; `release in windup still gives min active`; `held basic repeats bite`; `buffer keeps a press in the last .12 s of recovery and in hit-stop only`; `buffer expires after .12 s`; `dash cancels bite and sweep recovery only`; `stagger interrupts interruptible windup/active only`; `poise meter, decay 4/s, stagger at poise`; `hit-stop pauses the two actors' clocks only`; `overlapping hit-stops use the max`; `start rules: staggered, held, cooldown, breach arc`. |
| `combat-shapes.test.ts` | `sphere-cone hits at the edges`; `sphere-capsule hits`; `telegraph shape equals hit shape for every registered attack`; `hit volume stays inside the locked telegraph (lunge truncated by a wall)`; `units are attacker body lengths`; `obstruction by terrain and by a reef solid`; `crossing same-medium`; `maxTargets nearest first`; `mirrored pair shape is the union with one hit group`. |
| `hit-resolver.test.ts` | `counter beats block and staggers the attacker`; `counter fails against unparryable`; `brace blocks in front only`; `heavy hit breaks the guard`; `brace damage uses floor after armor`; `grab ignores brace`; `dash invulnerability evades and records the ledger`; `grace invulnerability is immune`; `post-hit invulnerability .4 s`; `damage in half-hearts with armor`; `impulse formula, resistance, blocked × .3`; `one hit per target per action, repeat for whirl`; `processing order is deterministic`; `grab size rule holds or breaks free`; `held player breaks free by presses and flicks`; `squeeze ticks on the grabber clock`; `hold ends when the grabber is staggered`. |
| `combat-ai.test.ts` | Seeded fixtures: `drifter flees, tires, rests`; `sardine school flees together in one direction`; `snail retaliates when hit and when cornered`; `puffer bursts then backs off`; `crab notice delay, approach, band choice, flank weight, gap, reposition`; `crab gives up by pursuit rules and heals`; `eel waits in den, ambushes, retreats`; `alpha phases switch at thresholds with a roar`; `alpha stays in the lair disc`; `alpha resets slowly outside 1.5 × lair`; `alpha absent when its part is unlocked or at another size`. |
| `director.test.ts` | `at most two tokens`; `active starts at least .25 s apart by extension`; `extension never shortens and is at most .5 s`; `off-screen wind-up at least .6 s`; `grab only alone; none while held`; `refused requests retry`. |
| `contract.test.ts` | One mutation test per V1–V20; `the shipped catalogs pass`; `MIN_WINDUP holds for every hostile attack`. |
| `economy.test.ts` | `faintCombat zeroes at-risk wallet and part credit, keeps basis and banked`; `faintLoss reports what is lost`. |
| `state.test.ts` | `faint resets stageDna and is applied once`; `killReward by diet and growth rule`; `survivor bonus conditions`; `alphaReward once, part unlocked`; `unlock accepts rare parts at any stage`; `rare part without unlock is locked`. |
| `saves.test.ts` | `v4 save with loadout.active loads as four empty pins`; `half-heart health loads`; `new loadout round-trips`; `legacy keys are never written` (today's test stays); `pending respawn from the legacy rule takes no second loss`. |
| `input.test.ts` | `four slot tuples`; `slot press suppresses basic for one tick`; `cancel gives no release`. |
| `combat-motion.test.ts` | `knockback, lunge, dash and grab motion never install a refused pose` (500 seeded cases next to reef rocks and arches; every installed pose is admitted); `blocked grab motion ends the hold`. |
| `feeding.test.ts` | `bite when a combat species is in the cone, else chomp`; `combat species are never chomp targets`; `legacy species keep chomp damage`. |
| `sim.test.ts` | `sim.ts keeps the former main.ts tick order`. The extraction is its own plan task, before any combat content. A scripted 20 s run at stage 0 (fixed seed, fixed intents) is recorded with the old code path first; after the extraction, the same run gives the same positions, health and DNA. |

### 14.2 Browser checks (`e2e/tiny-tide-combat.mjs`)

They need a running dev server. The dev server already runs at
`http://127.0.0.1:5199`. Agents do run the browser checks, against this server,
and never start a second one or stop it. The script reads `TIDE_BASE` (default
that address; not `TIDE_URL`), like every `e2e/tiny-tide*.mjs`, and `TIDE_SEED`
(default 1501). Fixtures come from `tests-browser/fixtures.html`. Three QA
parameters are added (read once at load, development or `?qa` only):

| Parameter | Effect |
| --- | --- |
| `qaEncounter=<species key>` | At the first start, the nearest active instance of that species is installed (by recovery) 3 player L in front of the player, in `calm`. |
| `qaAlphaHealth=<0..1>` | Alphas start with that fraction of their HP. |
| `qaCrowd=<species keys>` | (T24, plan review R18) At the first start, every live non-alpha instance of those species is installed on a ring of 3 player L around the player, in `calm`. It gives the frame-time check 13 or more combat bodies. |

`window.__tinyTide.combat` (read-only) gives: actions (actor, id, phase, aim,
world shape), telegraphs (shape, fill, on-screen, arrow), action clocks, the
last 20 hit outcomes, hit-stop ends, slots and inactive kinds, director
tokens, alpha state, `heldBy`, `breakProgress` and the shown hints.

| Check | Pass |
| --- | --- |
| `desktop-controls` | A left click starts Bite with a crab in the cone; Space with only a plant in reach eats it; right mouse held keeps Brace active and release ends it; keys 1–4 start slots 1–4; the aim yaw is within 5° of the pointer direction; with no pointer movement for 4 s the aim is the camera forward; a middle drag turns the camera. |
| `phone-controls` | At 320×568 and 844×390, for a swimmer, a crawler and a breacher (Darter fixture): every control box is inside the viewport; no two boxes overlap; slots ≥ 48×48, basic ≥ 80×80; two real touches move with the joystick and aim by the basic drag at once; a slot tap starts its move; a held slot keeps Brace; a `pointercancel` ends Brace and leaves no held input. |
| `telegraph-before-hit` | With `qaEncounter=1:crab` and audio muted: the telegraph is visible at least 0.45 s before the first damage, and its shape equals the action's shape; every crab, squid and eel attack (9 attacks) shows its telegraph at least 0.35 s before active; with the camera turned away (a forced off-screen wind-up), the edge arrow is visible at least 0.6 s before active (the director's off-screen minimum; T24 fix round 1). |
| `hit-stop` | On a player Bite hit, both actors' action clocks stop for 60–90 ms while world time advances, and a third entity moves during it. |
| `faint-rule` | Fixture: 0.5 heart, 37 at-risk DNA, stageDna 37. A crab hit faints the player; the overlay text contains "37 DNA"; after the respawn the at-risk wallet and stageDna are 0, banked and the design are unchanged, and only the v4 key was written. |
| `alpha` | `qaEncounter=1:clawmother&qaAlphaHealth=0.62`: phase 1 attacks; below 60 % the burrow pattern; below 30 % the enraged attacks; the defeat unlocks `claw_mother` and adds 40 DNA; the part is in the editor; after a reload the Clawmother is absent. |
| `editor-moves` | The moves panel shows numbers that change with the size slider; the slot bar and an inactive chip show; a drag swap persists after Done and a reload. |
| `hints` | The first telegraph hint shows once; after a reload it does not show again. |
| `frame-time` | (T24, plan review R18) With `qaCrowd` bodies near the player: the median of the game's frame callback is at most 16.7 ms on a desktop and 33.3 ms on a phone at 4× CPU slowdown; the p95 is at most 33 ms and 50 ms. |

The existing browser tests (`tiny-tide.mjs`, `-paths`, `-mobile`, `-replay`)
must still pass. `tiny-tide-mobile.mjs` also checks the slot buttons at
320×568 and 844×390.

### 14.3 Combat balance probe (`combat-probe.ts`)

Run with `TIDE_COMBAT_PROBE=1 npx vitest run
tests/tiny-tide-core/combat-balance.test.ts` (skipped without the variable;
long). It uses `sim.ts`, the real player step, the real ecosystem and the
real combat world. Fixed `dt = 1/30`. The camera model for `isOnScreen` is a
camera 6 L behind and 2 L above the player, looking at it, 60° vertical
field of view. It writes `.codex-drafts/tiny-tide-qa/combat-probe.json` and
`combat-probe.md`.

**Bots:**

- **Ideal dodge bot:** reacts 0.25 s after a wind-up starts. Order: Brace
  (blockable, raw below the break threshold, facing the attacker until active
  ends); else Counter (parryable; pressed so the window holds the active
  start); else Dash (perpendicular to the attack axis, away from the shape, at
  windup end − 0.15 s); else move perpendicular at full speed.
- **Fight bot:** the ideal dodge bot, and it bites (and uses Grab and Sweep)
  when the target is in recovery or not attacking and in range.
- **Journey bot:** the fight bot with a 0.35 s reaction; it eats by diet;
  meat diets fight hunters and prey; the plant diet flees hunters and fights
  only when cornered (a hunter within 0.5 L_e for 2 s).

**Measures and pass bars:**

| Id | Measure | Pass bar |
| --- | --- | --- |
| P0 | (T23) A still player is hit at the near, middle and far point of each attack band (5 % inside each edge) | ≥ 90 %, and ≥ 20 trials for a point |
| P1 | Avoided share per attack id, dash-only build (Speck: Side fin pair at scale 1; Swimmer at size 1: Side fin pair at scale 1), 200 seeded trials from the band midpoint | ≥ 95 % for every hunter and fighter attack; ≥ 90 % for every alpha attack |
| P2 | Brace build (Shell plate at scale 1, size 1): avoided or mitigated (damage ≤ half of raw) per blockable attack | ≥ 95 % |
| P3 | Counter build (Spike at scale 1): countered share per parryable attack | ≥ 85 % |
| P4 | Movement-only build (no moves) | Reported, no bar |
| P5 | Median time-to-kill, fight bot, meat build (Snapper at scale 1 + starter parts), seeds 11–13, 30 trials each | Drifter ≤ 6 s; spiny snail ≤ 8 s; crab ≤ 20 s; sardine ≤ 6 s; puffer ≤ 10 s; squid ≤ 30 s; eel ≤ 30 s; Clawmother ≤ 90 s; Reef Tyrant ≤ 120 s |
| P6 | Median time-to-kill, plant build (Nibbler at scale 1) | Crab ≤ 45 s; squid ≤ 75 s; the rest reported |
| P7 | Completion: journey bot on Speck → Swimmer and Speck → Crawler, × three diet plans: herbivore (Nibbler at sizes 0 and 1), carnivore (Snapper at sizes 0 and 1), omnivore (Snapper at size 0, then the Beak from the evolution to size 1), × seeds 11–15 (30 runs; T23 fix round 1) | Every run becomes evolve-ready at size 0 and at size 1 within 600 s of active time per size, with at most 3 faints per size |
| P8 | Director invariants over every probe run | Never more than 2 wind-ups at the player at once; active starts ≥ 0.25 s apart; off-screen wind-ups ≥ 0.6 s |

The probe also reports, per run and size: active time, faints, kills by
species, damage taken, DNA by source (meals, kills, survivor, alpha) and the
time spent held. It proposes no tuning. If a bar fails, the plan changes
species numbers (not the floors of §11.1) and reports the change to the
owner.

Last result (after `ce1bb1b`): every bar passes except P7, which passes 29 of 30 runs (crawler omnivore, seed 14, size 1: 600 s, no faints, 142 of 150 DNA, 465 s in skipped sardine chases). This is the owner decision R14 (3); no number was changed for it.

### 14.4 Review focus

The five most likely real-player failures, for the reviewers to test by hand:

1. **One right thumb, two jobs.** On a phone, the thumb that aims by the
   basic drag must also reach a slot. Auto-aim may pick a sardine next to a
   squid in wind-up. Check the priority rule and the reach to slot 4 at
   320×568.
2. **Telegraphs in 3D water.** A volume can hide behind the creature, the
   camera or a rock; the elevation of a squid lunge can be misread; the edge
   arrow can come late at the screen corner. Check the x-ray outline, the
   depth ring, and an attack from above and from below.
3. **Space means two things.** Next to a plant and a hunter, Space bites the
   hunter when the player wants to eat, or the reverse. Check the 1.25 × cone
   rule at the edge of reach.
4. **The faint cost.** Losing all DNA of the size and the growth bar after a
   long size may make players quit, and hunters may wait at the respawn
   anchor. Check the message, the 6 s give-up and the 3 s grace.
5. **Overlap that the director does not see.** Contact hazards (Moon jelly)
   are not tokens. A grab plus a jelly sting, or two fighter prey plus a
   hunter, can still feel unfair. Check a jelly drift fight at size 0 and a
   squid near a puffer at size 1.

## 15. Out of scope (R13)

- Content for sizes 2–4 (3b). The ray and the seaplane keep the legacy
  chomp and hazard rules.
- The coast and land.
- Keystones.
- Meta-progression across runs.
- PvP and co-op.
- A combat tutorial beyond the first-time hints of §12.3.
- A "Test" sandbox in the editor.
- An in-game reduced-motion toggle (the OS setting is used).
- Key remapping.

## 16. Decisions made in this spec

These decisions were not covered by the owner decisions or R1–R13. The
controller relays them to the owner. "Cost if wrong" is the change to undo
it.

| # | Decision | Cost if wrong |
| --- | --- | --- |
| D1 | Move sources: fins, the Paddle tail and legs give Dash; the Fan tail and Fluke give Sweep. The owner's "Fin / Paddle" was read as "fins and the Paddle tail". Legs give Dash ("Scuttle") so crawlers have a dodge. Tentacle, horn, eyes and senses give no move in 3a. | Data rows in `parts.ts` and `moves.ts`. |
| D2 | The slot unit is the move kind. Pins are saved as kinds (`loadout.slots`, four entries). The old `loadout.active` reads as four empty pins. | A save-shape change. |
| D3 | Attack shape numbers are in attacker body lengths, not part-local units. Part size acts through the scaling formula only. | Shape data and one function. |
| D4 | Size scaling is `base × (1 + k (s − 1))` with one k per number and one rounding. The pair bonus (× 1.2 distance and × 0.85 cooldown for Dash; × 1.3 hold, × 1.5 damage, + 0.25 size factor for Grab) applies only to mirrored parts. | Data. |
| D5 | Bite damage adds `floor` of the non-mouth `bite` stat (a Pincer adds 1). | One line. |
| D6 | Basic dispatch: Bite when a combat species is in the Bite cone (range × 1.25), else today's chomp, for Space, left mouse and the phone button. Legacy species keep chomp. | `feeding.ts` rule. |
| D7 | Desktop camera turns with a middle drag or Alt + left drag. A left click no longer turns the camera. Desktop tap-to-walk is removed; touch keeps it. | Input wiring. |
| D8 | The exact phone and desktop layouts of §8.2; empty slots are hidden; the toast moves to keep controls clear. | CSS. |
| D9 | Swimmer aim pitch comes from a soft-lock target in a 30° cone, else from the creature's pitch. | One function. |
| D10 | A 0.12 s input buffer for presses in the last 0.12 s of recovery or in hit-stop. | Engine constant. |
| D11 | Only Dash can cancel the player's own recovery, and only after Bite and Sweep. | Engine rule. |
| D12 | A dodged hit is recorded in the ledger: one dodge spends that attack on that target. | Resolver rule. |
| D13 | Species have poise (no stun-lock); a counter always staggers. Player hit stagger = the attack's stagger. | Data and engine rule. |
| D14 | Grabs are unblockable; Counter and Dash beat grabs; Brace beats strikes. | Data flags. |
| D15 | The player gets 0.4 s of invulnerability after a hit that deals damage. | Constant. |
| D16 | Hit-stop also stops the two actors' controlled and external displacement. The Breach arc and permits keep world time. | Engine rule. |
| D17 | Telegraph colour code: amber solid = blockable, red stripes = unblockable; the telegraph is locked at least 0.2 s before active; an x-ray outline shows through rocks. | Data and view. |
| D18 | Director details: extensions only lengthen (≤ 0.5 s); off-screen wind-ups ≥ 0.6 s; a grab only when no other token is held; no token while the player is held. | `director.ts`. |
| D19 | Enemy and hazard damage is in half-hearts; hazard values doubled to keep today's damage; regeneration is 0.5 heart every 2 s after 6 s with no damage and no wind-up at the player. | Constants. |
| D20 | A faint also resets the growth bar (`stageDna`) to 0 — the strictest reading of "lose all DNA collected at the current size". Part at-risk credit is also lost (today's `faintCombat`), so buying parts does not shelter DNA. | One line in `state.faint` (keep `stageDna`). |
| D21 | A kill's DNA counts for the growth bar when the species hunts the player's size, as well as for same-tier species. | One condition. |
| D22 | The herbivore survivor bonus is 35 % of the hunter's DNA, once per engagement, after ≥ 4 s and ≥ 1 wind-up. | Constants. |
| D23 | An alpha defeat is recorded by its reward part in `unlocked` (no new save field). The reward comes once. An alpha is present only at its own size. Rewards: Clawmother 40 DNA, Reef Tyrant 60 DNA. | Save field if the owner wants rematches. |
| D24 | Rare parts reuse GLBs through a `model` field, with a tint; they show only when unlocked. | Art pass. |
| D25 | The roster species, tiers, HP, speeds, counts and all attack numbers of §11. Prey are at the player's tier; hunters and alphas are one tier up. New species: drifter shrimp, spiny snail, Old Clawmother, Sunny sardine, Puffer, Moray eel, Reef Tyrant. | Data; the probe retunes. |
| D26 | The crab and the squid lose their contact hazards (their attacks replace them). The jelly, ray and seaplane keep hazards until 3b. The jelly stings stage 1 only: a Speck lives within 1.1 L of the seabed and never reaches a jelly (12+ units up), so its stage-0 entry was dead data (T16b fix round 1). | Data. |
| D27 | After a faint, hunters that targeted the player give up at once, and no creature attacks or acquires the player during the window: until 6 s after the respawn grace (the 3 s grace + 6 s, counted from the respawn). | Constant. |
| D28 | Hunters respawn 30–40 s after a kill (other combat species 14–22 s, as today). | Constant. |
| D29 | The game tick moves out of `main.ts` into a pure `sim.ts`, so the probe runs the real frame order. | Refactor size. |
| D30 | First-time hints are kept in `localStorage` `tiny-tide-hints-v1`, not in the run save. One extra hint for the first unblockable telegraph. | Storage key. |
| D31 | Reduced motion follows `prefers-reduced-motion` only. | A settings toggle later. |
| D32 | `qa-catalog.ts` and `?qaGrantCatalog` are removed; real grants exist. New QA parameters `qaEncounter` and `qaAlphaHealth`. | QA tooling. |
| D33 | Obstruction uses a new `segmentClear` query (terrain and reef solids); perception does not change. | One query. |
| D34 | Grab size rule: held when `L_t ≤ sizeFactor × L_a`; alphas cannot be grabbed. A held player can Bite; presses and stick flicks add break-free progress. The grabber can Bite during the hold; any other move ends it. | Resolver rules. |
| D35 | The probe bars P1–P8. | Test thresholds. |
| D36 | The Berry squid keeps `hunts: [1, 2]` and uses the 3a attacks at size 2 until 3b. | One data row. |
| D37 | Enemies regain full HP when they return to calm, but not within 8 s of their last damage (then once 8 s pass without damage; T18 review I2); an alpha heals 4 % per second after 3 s with the player outside 1.5 × its lair. | Constants. |
| D38 | A herbivore's kill drives the creature off (consumed, respawns) with no DNA. | One rule. |
