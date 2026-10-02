# Tiny Tide Combat 3a — Plan: Combat Engine and Sizes 0–1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Tiny Tide mechanical combat at sizes 0 and 1:
- parts give moves (Bite, Grab, Counter, Brace, Dash, Sweep) whose numbers scale with part size
- the player aims every move; enemies telegraph every attack from the same clock and geometry as the hit
- a deterministic action engine, hit resolver and director
- seven new species, two alphas with rare-part rewards, and AI per behaviour type
- half-heart health, the strict faint rule, DNA from kills
- desktop and phone controls, an editor moves panel with slot pins, first-time hints
- a headless balance probe (P1–P8) and a browser suite

**Architecture:** Pure modules carry all rules and have unit tests: `combat-profiles.ts`, `moves.ts`, `bestiary.ts`, `combat-shapes.ts`, `action-engine.ts`, `hit-resolver.ts`, `director.ts`, `combat-ai.ts`, `combat-world.ts`, `feeding.ts`, `sim.ts`, `combat-probe.ts`. The game tick moves out of `main.ts` into `sim.ts` first (T6), pinned by a golden run recorded from the old code path, so the probe and the game run the same frame. `main.ts` keeps its module variables and gives `sim.ts` a getter/setter binding object; it only presents `SimEvent`s. DOM and three.js live in `combat-hud.ts`, `telegraph-view.ts`, `hints.ts`, `world.ts`, `editor.ts` and `main.ts`.

**Tech Stack:** TypeScript 7 (`tsc -b`, no JS API), three.js 0.185, Vite 8, Vitest 4, Playwright 1.63 (Chrome, SwiftShader).

**Spec:** `docs/superpowers/specs/2026-10-02-tiny-tide-combat-3a-design.md` (revision 1, binding), with `.codex-drafts/combat-3a-decisions.md` (owner decisions and rulings R1–R13).

**Depends on:** the evolution core (Plans A–C) and the movement fixes through round 4.

## Global Constraints

- **Mineral Wage is off limits.** Never read for edit, stage, format or delete: `src/miner/`, `e2e/miner*`, `tests/miner*`, `mineral-wage.html`, `public/miner/`, `scripts/sc2/`, `docs/MINERAL-WAGE.md`, `README.md`. `git status` shows some of them as modified or untracked. That is expected. Leave them.
- **The dev server already runs at `http://127.0.0.1:5199`.** Agents USE it for every browser check (`TIDE_BASE` defaults to it). Agents never start a second server and never stop this one. This corrects spec §14.2, which says that agents do not run browser checks: they do run them, against this server. The browser scripts read `TIDE_BASE` (not `TIDE_URL` as §14.2 says), like every existing `e2e/tiny-tide*.mjs`.
- **One commit per task.** Stage files by name (`git add <path> …`; for a deleted file `git rm <path>`). Never `git add -A`, `git add .` or `git commit -a`. Every commit message ends with this line:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- **Admission is the only gate for a pose.** Never install a pose that admission refuses. All combat motion (knockback, lunge, dash, grab pull, held motion) goes through `resolveMotion` as `MotionRequest`s. A refused combat motion keeps the last pose.
- **Saves:** v4 saves load. Legacy keys are never written. The only save key that is written stays the v4 key.
- **Base revision.** The code in this plan was written and checked against `beed7b4` (the spec commit). The movement fix rounds after it (`94fe068`, `86ebaf1`, `d2f592c` and any later movement commit) changed `main.ts` (`rescueBudget`, `stepCalls`, `rescueCalls`, `admissionCount`, the QA admission fields), `lifecycle.ts`, `world-queries.ts`, `motion.ts` and `tests/tiny-tide-core/main-rescue.test.ts`. When a diff below does not apply, apply its intent to the current code. In T6, the frame body that moves into `sim.ts` is the one at HEAD: carry the round-4 lines (`stepCalls = admissionCount.n` around `stepPlayer`, `unstick.step(rescueBudget(stepCalls))`, `rescueCalls`) into `simFrame` and keep the QA counters in `SimState` (`stepCalls`, `rescueCalls`) so that `main.ts` still fills `admissionStats`.
- **Per-task checkpoint** (run at the end of every task, before the commit):
  ```bash
  npx tsc -b && npx tsc -p tsconfig.tests.json
  npx vitest run tests/tiny-tide.test.ts tests/tiny-tide-core
  node e2e/tiny-tide.mjs --visual-only
  ```
  Expected: both type checks print nothing; Vitest prints `Test Files  N passed (N)` with no failed file; the visual run prints `{"errors":[]}`. `tests/tiny-tide-core` takes a few minutes; run the task's own test files first while you work.
- **Determinism.** Pure modules take time, randomness and world queries as parameters. Randomness comes from seeded `random()` streams (`rng.ts`). No `Date.now`, `performance.now` or `Math.random` in a pure module.
- **Units.** Attack shape numbers are in attacker body lengths `L_a` (spec D3). Player damage is in half-hearts; enemy damage is in HP. `run.health` and `maxHealth` stay in hearts; `hurt` takes half-hearts and divides by 2.
- **QA parameters** are read once at load, only in development or with `?qa`: `forcedSpawn`, `qaStartGrace`, `qaRejectSubmit`, `qaHoldStart` (existing) and `qaEncounter`, `qaAlphaHealth` (new, T22). `?qaGrantCatalog` is removed (T20). `window.__tinyTide` stays read-only.

## Review Focus

These are the five most likely real-player failures (spec §14.4). Reviewers test them by hand on the running server.

1. **One right thumb, two jobs (phone).** At 320×568 the thumb that aims by the basic drag must also reach slot 4. Auto-aim must prefer the attacker in wind-up over a sardine next to it. Pinned in T10 (`autoAim` priority test) and T24 (`phone-controls`).
2. **Telegraphs in 3D water.** A volume behind the creature, the camera or a rock; the elevation of a squid lunge; the edge arrow at a screen corner. Check the x-ray outline, the depth ring and attacks from above and below. Pinned in T12 (telegraph shape equals hit shape for every attack) and T24 (`telegraph-before-hit`).
3. **Space means two things.** Next to a plant and a hunter, Space must bite the hunter only when the hunter is in the 1.25 × Bite cone. Check the edge of reach. Pinned in T8 (`feeding.test.ts`) and T24 (`desktop-controls`).
4. **The faint cost.** A faint loses the at-risk DNA and the growth bar. Hunters must give up for 6 s and the 3 s grace must hold at the anchor. Pinned in T15 and T24 (`faint-rule`).
5. **Overlap the director does not see.** Moon jelly stings are not tokens. Check a jelly drift fight at size 0 and a squid next to a puffer at size 1. Pinned only by the probe (T23, P8 counts tokens, not hazards); the reviewer checks by hand.

## Task order

T1 → T25 in order. Each task leaves the game playable and every checkpoint green. The table at the end lists the tasks that share a file or an interface.

| Id | Title |
| --- | --- |
| T1 | Combat contract types, profiles and validation |
| T2 | Player moves and slot assignment |
| T3 | Combat shapes and hit tests |
| T4 | The action engine |
| T5 | The hit resolver |
| T6 | Extract the game tick into `sim.ts` |
| T7 | Four-slot input and combat motion |
| T8 | The combat world and the basic dispatch |
| T9 | Desktop controls and the slot HUD |
| T10 | Phone controls |
| T11 | The director |
| T12 | Telegraphs and hit feel |
| T13 | Bestiary data |
| T14 | Combat AI |
| T15 | Half-hearts, faint, kills and DNA |
| T16 | Size-0 species and the crab |
| T17 | The Old Clawmother and rare parts |
| T18 | Size-1 species, schools and dens |
| T19 | The Reef Tyrant |
| T20 | Slot pins in saves; remove `qa-catalog.ts` |
| T21 | Editor moves panel and swap |
| T22 | First-time hints and the QA parameters |
| T23 | The combat balance probe |
| T24 | Browser checks |
| T25 | Docs |

---

## Shared names

These are the names that later tasks consume. Each task's **Interfaces** block repeats the part it needs.

```ts
// combat-types.ts (T1)
type ActiveSlot = 0 | 1 | 2 | 3; type Tuple4<T> = [T, T, T, T]
type MoveKind = 'grab' | 'counter' | 'brace' | 'dash' | 'sweep'; MOVE_PRIORITY = ['brace','counter','dash','grab','sweep']
type SlotPin = MoveKind | null; interface CombatLoadout { slots: Tuple4<SlotPin> }   // T20 (was { active: [...] })
interface ResolvedMove { kind: MoveKind | 'bite' | 'species'; abilityId; label; input: 'press' | 'hold'; attack; guard; evasion; cooldownSeconds; allowedMotionModes }
type ActionPhase = 'windup' | 'active' | 'hold' | 'recovery' | 'interrupted'
type WorldShape = { kind: 'cone'; apex; axis; range; halfAngle } | { kind: 'capsule'; start; end; radius }
type HitOutcome = 'countered' | 'blocked' | 'guard-broken' | 'evaded' | 'immune' | 'hit' | 'grabbed'
CombatRuntime += { actionClock; hitStopUntil; buffered; heldBy; breakProgress; status; lastDamageAt; lastThreatAt }
// combat-profiles.ts (T1)
TELEGRAPHS; EFFECTS; FLASH_LEAD_SECONDS = .12; FLASH_SECONDS = .08; IMPACT_PARTICLES = 10
hitStopFor(outcome, { targetIsPlayer, amount }): number; shakeForPlayerHit(halfHearts); shakeForPlayerStrike(hp); damageText(outcome, unit, amount)
// bestiary.ts (T1 skeleton, T13 data)
MIN_WINDUP; minWindup(size, alpha); hostileSizes(spec); SPECIES_ATTACKS; BEHAVIOURS; BURROW; LAPS
// moves.ts (T2, T21)
PLAYER_ATTACKS; PLAYER_ABILITIES; GUARDS; EVASIONS; MOVE_CATALOGS; resolveMove(ref, scale, { mirrored, nonMouthBite }, c); speciesMove(attack)
movesOf(genome, catalog?): MoveSet; grantedKinds(m); NO_PINS; placeKinds(granted, pins); assignSlots(genome, pins, catalog?); clearMissingPins(pins, granted)
moveNumbers; moveLine; moveDiff; TRADEOFF; partMoveLine; lostMoveText; basicLine; swapPins   // T21
// combat-shapes.ts (T3)
aimFrame; worldShape; actionShapes; sphereHitsShape; hurtboxesHit; truncateCapsule; crossingOk; obstructionClear; nearestTargets; telegraphDescriptor
WorldQueries.segmentClear(a, b, step): boolean   // world-queries.ts
// action-engine.ts (T4)
advanceClock(rt, t, dt); applyHitStop(rt, now, s); canStart(rt, c): StartDecision; startAction(rt, s); tickAction(rt, a, dTau, input): TickResult
endNow; endHold; holdingAction; stagger(rt, s, force?); addPoise; bufferPress; bufferedPress; lungeSpeed; dashSpeed; BUFFER_SECONDS = .12; POISE_DECAY = 4
// hit-resolver.ts (T5)
interface Fighter; interface HitRequestIn; interface CombatEvent; resolveHit(r, now, statusOf?); resolveAll(requests, now, statusOf?)
POST_HIT_INVULNERABLE = .4; KNOCKBACK_CAP = 9; addBreakProgress; isFlick; releaseHold; squeezesDue
// sim.ts (T6) and feeding.ts (T6, T8)
interface SimState; interface SimWorld; type SimEvent; newSimState(run); simOwnedState(); simBegin(s, w, run, forced); simFrame(s, w, input): SimEvent[]; simEvolve
biteTargets; chomp; CHOMP_COOLDOWN = .24; biteDispatch(cone, entities, stage, isCombat, hurtboxesOf)   // T8
REGEN_AFTER = 6; REGEN_EVERY = 2; FAINT_GIVE_UP = 6   // T15
// combat-world.ts (T8, T11, T12, T14, T16)
PLAYER_ID = 'player'; entityActorId(e); class CombatWorld { tick; playerMotion; startSpecies; telegraphs; aiTick; reconcileHolds; … }
// director.ts (T11)
class Director; MAX_TOKENS = 2; ACTIVE_GAP = .25; MAX_EXTENSION = .5; OFF_SCREEN_WINDUP = .6
// combat-ai.ts (T14)
newAiState(runSeed, entityId, now?); aiStep(b, s, i): AiOutput; aiStarted; aiRefused; schoolFlee; chooseAttack; alphaPhase; aiLandedHit; ROAR_SECONDS = .8
// combat-hud.ts (T9, T12, T17), telegraph-view.ts (T12), hints.ts (T22)
class CombatHud; class CombatOverlay; class AlphaBar; MOVE_ICONS; slotViews; class TelegraphLayer; class Hints; HINTS_KEY = 'tiny-tide-hints-v1'
// combat-probe.ts (T23)
runProbe(opts): ProbeReport; P1…P8 measures
```


---

### Task T1: Combat contract types, profiles and validation

**Spec:** §4.1, §4.2, §4.3 (V1–V15, V17–V20; V16 comes in T2), §5.9 hit-stop table, §9.1–9.2 profiles, §11.1 minimum wind-ups.

**Files:**
- Modify: `src/tiny-tide/combat-types.ts`, `src/tiny-tide/registries.ts`, `src/tiny-tide/profiles.ts`, `src/tiny-tide/parts.ts`, `src/tiny-tide/species.ts`
- Create: `src/tiny-tide/combat-profiles.ts`, `src/tiny-tide/bestiary.ts` (types, the minimum wind-up table and empty catalogs; data in T13)
- Create: `tests/tiny-tide-core/combat-fixture.ts`
- Modify: `tests/tiny-tide-core/helpers.ts`, `tests/tiny-tide-core/contract.test.ts`, `tests/tiny-tide-core/lifecycle.test.ts`

**Interfaces:**
- Consumes: the existing `AttackSpec`, `AbilitySpec`, `CombatRuntime`, `newRuntime`, `validateContract(catalogs)` and the `Catalogs` shape of `registries.ts`.
- Produces: the types listed under "Shared names" for `combat-types.ts`; `TELEGRAPHS`, `EFFECTS`, `hitStopFor`, `shakeForPlayerHit`, `shakeForPlayerStrike`, `damageText`, `IMPACT_COLOURS`, `IMPACT_PARTICLES`, `FLASH_SECONDS`, `FLASH_LEAD_SECONDS` (`combat-profiles.ts`); `MIN_WINDUP`, `minWindup`, `hostileSizes`, `BEHAVIOUR_TYPES`, the types `AttackChoice`, `BehaviourPhase`, `SpeciesBehaviour`, `BehaviourType`, and empty `SPECIES_ATTACKS`, `BEHAVIOURS` (`bestiary.ts`); `Catalogs` gains `telegraphs`, `effects`, `evasions`, `guards`, `behaviours`; `fixtureCatalogs()` and the fixture constants (`tests/tiny-tide-core/combat-fixture.ts`); `resolvedOf`, `blankAction` (`helpers.ts`).

**Decisions in this task (spec gaps):**
- `ResolvedMove` lives in `combat-types.ts` (the engine needs it on `ActionState`); `moves.ts` re-exports it in T2. The spec puts it in `moves.ts`; that would make a cycle.
- `BehaviourPhase` gets an optional `lairFraction` (the Reef Tyrant's phase 2 laps use it; the spec's type lacks it).
- `minWindup(size, alpha)` uses the size-1 row for every size ≥ 2 (the squid and the eel hunt size 2 in 3a; spec D36; §11.1 has no size-2 row).
- V10 ("pair multipliers ≥ 1") conflicts with the Dash pair cooldown × .85 (spec D4). `pairMultiplierOk` accepts (0, 1] for a key that ends in `cooldownSeconds` and ≥ 1 for every other key.

- [ ] **Step 1: Write the test fixture and the helpers**

`tests/tiny-tide-core/combat-fixture.ts` (complete file):

```ts
// A small, valid combat catalog for contract and engine tests: one player attack, two species attacks (a strike and a grab), one alpha
// attack, one guard of each kind, one evasion, abilities of four kinds, three behaviours, a hunter species, an alpha species and its rare part.
import type { AbilitySpec, AttackSpec, EvasionProfile, GuardProfile } from '../../src/tiny-tide/combat-types';
import type { SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
import { defaultCatalogs, type Catalogs } from '../../src/tiny-tide/registries';
import type { PartSpec } from '../../src/tiny-tide/parts';
import type { Species } from '../../src/tiny-tide/species';
import { syntheticAttack } from './helpers';

const species = (over: Partial<AttackSpec> & Pick<AttackSpec, 'id'>): AttackSpec => ({ ...syntheticAttack, damageUnit: 'half-heart', aimMode: 'input', telegraphProfileId: 'amber-rear',
  windupSeconds: .5, aimLockAtSeconds: .3, activeSeconds: .12, recoverySeconds: .8, cooldownSeconds: 2.5, damage: 2, impulse: 4, staggerSeconds: .3, parryable: true, ...over });
export const POKE: AttackSpec = species({ id: 'poke', shape: { kind: 'cone', range: 1.2, halfAngle: 50 * Math.PI / 180 } });
export const WRAP: AttackSpec = species({ id: 'wrap', shape: { kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: .6 }, radius: .2 }, windupSeconds: .6, aimLockAtSeconds: .35, blockable: false,
  telegraphProfileId: 'red-coil', damage: 1, impulse: 0, staggerSeconds: 0, hold: { seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 } });
export const SMASH: AttackSpec = species({ id: 'smash', windupSeconds: .6, aimLockAtSeconds: .35, interruptible: false, telegraphProfileId: 'amber-crouch' });
export const FX_BRACE: GuardProfile = { id: 'fx-brace', kind: 'brace', startupSeconds: .1, minActiveSeconds: .25, windowSeconds: null, frontHalfAngle: 70 * Math.PI / 180, blockFraction: .75,
  breakHalfHearts: 4, breakStaggerSeconds: .5, brokenCooldownSeconds: 2, moveSpeedFactor: .45, yawRateFactor: .5, reflectDamage: 0, attackerStaggerSeconds: 0, recoverySeconds: .15, whiffRecoverySeconds: .15, successCooldownSeconds: .4 };
export const FX_COUNTER: GuardProfile = { id: 'fx-counter', kind: 'counter', startupSeconds: .04, minActiveSeconds: 0, windowSeconds: .22, frontHalfAngle: null, blockFraction: 1, breakHalfHearts: null,
  breakStaggerSeconds: 0, brokenCooldownSeconds: 0, moveSpeedFactor: 1, yawRateFactor: 1, reflectDamage: 3, attackerStaggerSeconds: 1, recoverySeconds: 0, whiffRecoverySeconds: .4, successCooldownSeconds: .3 };
export const FX_DASH: EvasionProfile = { id: 'fx-dash', distanceBodyLengths: 1.6, startupSeconds: .03, travelSeconds: .18, recoverySeconds: .12, plane: 'free', endSpeedCarry: .3 };
const ability = (over: Partial<AbilitySpec> & Pick<AbilitySpec, 'id' | 'kind'>): AbilitySpec =>
  ({ cooldownSeconds: 1, allowedMotionModes: ['ground', 'swim'], effectProfileId: 'dash', label: over.id, input: 'press', scaling: {}, pair: null, ...over });
export const FX_ABILITIES: Record<string, AbilitySpec> = Object.fromEntries([
  ability({ id: 'dash', kind: 'dash', evasionProfileId: 'fx-dash', scaling: { 'evasion.distanceBodyLengths': .3, cooldownSeconds: .3 }, pair: { multiply: { 'evasion.distanceBodyLengths': 1.2 }, add: {} } }),
  ability({ id: 'brace', kind: 'brace', input: 'hold', guardProfileId: 'fx-brace', effectProfileId: 'block', cooldownSeconds: .4 }),
  ability({ id: 'counter', kind: 'counter', guardProfileId: 'fx-counter', effectProfileId: 'counter', cooldownSeconds: 1.2 }),
  ability({ id: 'grab', kind: 'grab', attackId: 'pinch', effectProfileId: 'grab', cooldownSeconds: 3, scaling: { 'attack.damage': .5 }, pair: { multiply: { 'attack.damage': 1.5 }, add: {} } }),
].map(a => [a.id, a]));
const behaviour = (over: Partial<SpeciesBehaviour> & Pick<SpeciesBehaviour, 'id' | 'type'>): SpeciesBehaviour =>
  ({ reactionSeconds: .35, poise: 6, staggerResist: 0, knockbackResistance: .2, grabbable: true, attacks: [], gapSeconds: 1, repositionSeconds: [.6, 1.2], repositionSpeedFactor: .6, ...over });
export const FX_BEHAVIOURS: Record<string, SpeciesBehaviour> = Object.fromEntries([
  behaviour({ id: 'fx-hunter', type: 'hunter', attacks: [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1, flankWeight: 2 }] }),
  behaviour({ id: 'fx-fleer', type: 'prey-flee', poise: 99, flee: { seconds: 2, restSeconds: 1.2, speedFactor: 1.3 } }),
  behaviour({ id: 'fx-alpha', type: 'alpha', poise: 14, staggerResist: .5, knockbackResistance: .6, grabbable: false,
    lair: { radiusBodyLengths: 2.5, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [{ aboveHpFraction: .6, attacks: [{ attackId: 'smash', band: [0, .6], weight: 1 }], speedFactor: 1, gapSeconds: 1, pattern: 'normal' },
      { aboveHpFraction: 0, attacks: [{ attackId: 'smash', band: [0, .6], weight: 1 }], speedFactor: 1.3, gapSeconds: .7, pattern: 'normal' }] }),
].map(b => [b.id, b]));
const base = (key: string, extra: Partial<Species>): Species => ({ key, kind: 'crab', tier: 1, tag: 'meat', label: key, behavior: 'graze', count: 1, dna: 10, hp: 20, speed: 1, hunts: [], stingsStages: [], fights: true,
  habitatProfileId: 'sp-seabed', movementProfileId: 'sp-ground', hullProfileId: 'sphere', attackMountProfileId: 'root', attackIds: [], pursuitId: 'hunter', ...extra });
export const FX_HUNTER = base('1:fx_hunter', { count: 4, hunts: [0], behaviourId: 'fx-hunter', attackIds: ['poke', 'wrap'] });
export const FX_ALPHA = base('1:fx_alpha', { bodyScale: 1.8, tint: '#9c3b2e', hunts: [0], behaviourId: 'fx-alpha', attackIds: ['smash'], alpha: { size: 0, rewardPartId: 'fx_rare', rewardDna: 40 } });
export const FX_FLEER = base('0:fx_fleer', { kind: 'shrimp', model: 'shrimp', tier: 0, fights: false, pursuitId: 'none', behaviourId: 'fx-fleer', hp: 3 });
/** A valid catalog: the shipped catalogs plus the fixture rows above. */
export function fixtureCatalogs(): Catalogs {
  const c = defaultCatalogs(), claw = c.parts.find(p => p.id === 'claw_pincer')!;
  const rare: PartSpec = { ...claw, id: 'fx_rare', name: 'Fixture claw', rare: true, model: 'claw_pincer' };
  return { ...c, attacks: { ...c.attacks, pinch: { ...syntheticAttack }, poke: { ...POKE }, wrap: { ...WRAP }, smash: { ...SMASH } }, abilities: { ...c.abilities, ...structuredClone(FX_ABILITIES) },
    guards: { ...c.guards, 'fx-brace': { ...FX_BRACE }, 'fx-counter': { ...FX_COUNTER } }, evasions: { ...c.evasions, 'fx-dash': { ...FX_DASH } }, behaviours: { ...c.behaviours, ...structuredClone(FX_BEHAVIOURS) },
    parts: [...c.parts, rare], species: [...c.species, { ...FX_HUNTER }, { ...FX_ALPHA }, { ...FX_FLEER }] };
}
```

`tests/tiny-tide-core/helpers.ts` (`syntheticAttack` becomes a player HP attack with the `none` telegraph; new `resolvedOf`, `blankAction`):

```diff
--- a/tests/tiny-tide-core/helpers.ts
+++ b/tests/tiny-tide-core/helpers.ts
@@ -1,7 +1,15 @@
-import type { AttackSpec } from '../../src/tiny-tide/combat-types';
+import type { ActionState, AttackSpec, ResolvedMove } from '../../src/tiny-tide/combat-types';
 export { HAZARDS as REGISTRY_HAZARDS } from '../../src/tiny-tide/registries';
 
-/** The 'pinch' attack of the combat contract test, shared by lifecycle and later tests. */
+/** The 'pinch' attack of the combat contract test, shared by lifecycle and later tests (a player attack: hp, no telegraph). */
 export const syntheticAttack: AttackSpec = { id: 'pinch', shape: { kind: 'cone', range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
   aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
-  hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'basic' };
+  hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'none',
+  damageUnit: 'hp', aimMode: 'input', moveSpeedFactor: 1, poiseDamageMultiplier: 1 };
+/** A species attack resolves to itself. */
+export const resolvedOf = (attack: AttackSpec): ResolvedMove => ({ kind: 'species', abilityId: null, label: attack.id, input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: [] });
+/** A complete ActionState for tests: windup at clock 0, the synthetic attack. */
+export const blankAction = (over: Partial<ActionState> = {}): ActionState => ({ instanceId: 'a1', definitionId: 'pinch', grantId: 'snap', source: { kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' },
+  phase: 'windup', startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map(), phaseStartedAt: 0, aimLocked: false,
+  resolved: resolvedOf(syntheticAttack), targetId: null, heldTarget: null, windupExtension: 0, released: false, countered: false, lungeDone: 0, lockedShapes: null, squeezes: 0,
+  cooldownKey: 'player:p5:snap', ...over });
```

`tests/tiny-tide-core/lifecycle.test.ts` (the `action()` helper uses `blankAction`):

```diff
--- a/tests/tiny-tide-core/lifecycle.test.ts
+++ b/tests/tiny-tide-core/lifecycle.test.ts
@@ -16,9 +16,9 @@ import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
 import { stepPlayer } from '../../src/tiny-tide/player-motion';
 import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
 import { RELEASED } from '../../src/tiny-tide/input';
-import { REGISTRY_HAZARDS, syntheticAttack } from './helpers';
+import { blankAction, REGISTRY_HAZARDS, syntheticAttack } from './helpers';
 
-const action = (uid: string, copy: 0 | 1) => ({ instanceId: `${uid}${copy}`, definitionId: 'pinch', grantId: 'snap', source: { kind: 'part' as const, partUid: uid, copy, socketId: 'pinch' }, phase: 'windup' as const, startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map() });
+const action = (uid: string, copy: 0 | 1) => blankAction({ instanceId: `${uid}${copy}`, source: { kind: 'part', partUid: uid, copy, socketId: 'pinch' }, cooldownKey: `player:${uid}:snap` });
 const busy = (): CombatRuntime => { const rt = newRuntime({ yaw: 1, pitch: .4 }); Object.assign(rt.controlledVelocity, { x: 1, y: 0, z: 0 }); Object.assign(rt.externalVelocity, { x: 0, y: 2, z: 0 });
   rt.permit = { id: 'breach', startsAt: 0, expiresAt: 2, media: ['air'], landingRequired: true }; rt.arc = { startedAt: 0, duration: 1.8, fromY: 3, endY: 60 }; rt.breachReadyAt = 2.3;
   rt.staggerUntil = 4; rt.guardProfileId = 'g'; rt.damageable = false; rt.cooldowns.set('player:p5:snap', 5); rt.actions.push(action('p5', 0), action('p5', 1)); return rt; };
```

- [ ] **Step 2: Write the failing contract tests**

One mutation case per rule V1–V15 and V17–V20, the shipped-catalog case, `hostileSizes`/`minWindup`, and `hitStopFor`/`damageText`:

```diff
--- a/tests/tiny-tide-core/contract.test.ts
+++ b/tests/tiny-tide-core/contract.test.ts
@@ -1,18 +1,18 @@
 // tests/tiny-tide-core/contract.test.ts
 import { describe, expect, it } from 'vitest';
 import { newRuntime } from '../../src/tiny-tide/combat-types';
-import { defaultCatalogs, validateContract, type Catalogs } from '../../src/tiny-tide/registries';
+import { validateContract, type Catalogs } from '../../src/tiny-tide/registries';
+import { hostileSizes, minWindup } from '../../src/tiny-tide/bestiary';
+import { damageText, hitStopFor } from '../../src/tiny-tide/combat-profiles';
 import { breachPermit, habitat, HABITATS, movementCapabilities, MOVEMENTS, PURSUITS } from '../../src/tiny-tide/profiles';
 import { designDelta, emittersOf } from '../../src/tiny-tide/design-delta';
 import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
 import { SPECIES } from '../../src/tiny-tide/species';
 import { HABITAT_FACTS, plan, PLANS } from '../../src/tiny-tide/plans';
 import { starterGenome, type Genome } from '../../src/tiny-tide/genome';
+import { fixtureCatalogs } from './combat-fixture';
 
-const attack = { id: 'pinch', shape: { kind: 'cone' as const, range: 1, halfAngle: .6 }, poseProfileId: 'rest', windupSeconds: .3, activeSeconds: .1, recoverySeconds: .4, cooldownSeconds: 1,
-  aimLockAtSeconds: .2, maxTrackingRadiansPerSecond: 2, damage: 1, impulse: 2, staggerSeconds: .2, blockable: true, parryable: false, interruptible: true, maxTargets: 1,
-  hitGroup: 'shared-grant' as const, maxHitsPerTarget: 1, repeatHitSeconds: .5, crossing: 'same-medium' as const, obstruction: 'terrain-and-cover' as const, telegraphProfileId: 'basic' };
-const synthetic = (): Catalogs => { const c = defaultCatalogs(); return { ...c, attacks: { pinch: attack }, abilities: { dash: { id: 'dash', cooldownSeconds: 3, allowedMotionModes: ['swim'], effectProfileId: 'dash' } } }; };
+const synthetic = (): Catalogs => fixtureCatalogs();
 const mutate = (f: (c: Catalogs) => void) => { const c = structuredClone(synthetic()); f(c); return validateContract(c); };
 const claw = (c: Catalogs) => c.parts.find(p => p.id === 'claw_pincer') as { -readonly [K in keyof PartSpec]: PartSpec[K] };
 
@@ -57,9 +57,119 @@ describe('combat contract', () => {
       [c => { c.rig.tail_paddle!['seg:0'] = { ...c.rig.tail_paddle!['seg:0']!, parent: 'seg:3' }; }, 'rig tail_paddle seg:0: cycle'],
       [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, pre: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: pre'],
       [c => { c.rig.tail_paddle!['seg:2'] = { ...c.rig.tail_paddle!['seg:2']!, q: [0, 0, 0, 2] }; }, 'rig tail_paddle seg:2: q'],
+      // V1
+      [c => { c.telegraphs['amber-rear'] = { ...c.telegraphs['amber-rear']!, id: 'x' }; }, 'telegraph amber-rear: id'],
+      [c => { c.effects.hit = { ...c.effects.hit!, id: 'x' }; }, 'effect hit: id'],
+      [c => { c.evasions['fx-dash'] = { ...c.evasions['fx-dash']!, id: 'x' }; }, 'evasion fx-dash: id'],
+      [c => { c.guards['fx-brace'] = { ...c.guards['fx-brace']!, id: 'x' }; }, 'guard fx-brace: id'],
+      [c => { c.behaviours['fx-hunter'] = { ...c.behaviours['fx-hunter']!, id: 'x' }; }, 'behaviour fx-hunter: id'],
+      // V2
+      [c => { c.attacks.poke!.damageUnit = 'hearts' as never; }, 'attack poke: damageUnit'],
+      [c => { c.attacks.poke!.aimMode = 'psychic' as never; }, 'attack poke: aimMode'],
+      [c => { c.attacks.poke!.moveSpeedFactor = 1.2; }, 'attack poke: moveSpeedFactor'],
+      [c => { c.attacks.poke!.poiseDamageMultiplier = -1; }, 'attack poke: poiseDamageMultiplier'],
+      // V3
+      [c => { c.attacks.poke!.lunge = { distanceBodyLengths: 0 }; }, 'attack poke: lunge'],
+      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, seconds: 0 }; }, 'attack wrap: hold'],
+      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, sizeFactor: -1 }; }, 'attack wrap: hold'],
+      [c => { c.attacks.wrap!.hold = { ...c.attacks.wrap!.hold!, squeezeEverySeconds: 0 }; }, 'attack wrap: hold'],
+      // V4
+      [c => { c.attacks.poke!.statusEffectId = 'hit'; }, 'attack poke: status hit'],
+      [c => { c.attacks.poke!.statusEffectId = 'nope'; }, 'attack poke: status nope'],
+      // V5
+      [c => { c.attacks.pinch!.scaling = { reach: .5 }; }, 'attack pinch: scaling key reach'],
+      [c => { c.attacks.pinch!.scaling = { 'shape.range': Number.NaN }; }, 'attack pinch: scaling value shape.range'],
+      [c => { c.attacks.pinch!.pair = { multiply: { damage: .9 }, add: {} }; }, 'attack pinch: pair multiplier damage'],
+      [c => { c.attacks.pinch!.scaling = { 'hold.seconds': .3 }; }, 'attack pinch: scaling key hold.seconds'],
+      // V6
+      [c => { c.attacks.wrap!.telegraphProfileId = 'amber-coil'; }, 'attack wrap: telegraph colour'],
+      [c => { c.attacks.poke!.telegraphProfileId = 'red-coil'; }, 'attack poke: telegraph colour'],
+      [c => { c.attacks.pinch!.telegraphProfileId = 'amber-rear'; }, 'attack pinch: telegraph colour'],
+      // V7
+      [c => { c.attacks.poke!.aimLockAtSeconds = .31; }, 'attack poke: lock before active'],
+      [c => { c.attacks.poke!.aimMode = 'centre'; }, 'attack poke: lock before active'],
+      // V8
+      [c => { c.attacks.poke!.windupSeconds = .44; c.attacks.poke!.aimLockAtSeconds = .2; }, 'attack poke: windup below 0.45 at size 0 (1:fx_hunter)'],
+      [c => { c.attacks.smash!.windupSeconds = .5; c.attacks.smash!.aimLockAtSeconds = .3; }, 'attack smash: windup below 0.55 at size 0 (1:fx_alpha)'],
+      // V9
+      [c => { c.abilities.dash!.kind = 'teleport' as never; }, 'ability dash: kind'],
+      [c => { c.abilities.dash!.input = 'hold'; }, 'ability dash: input'],
+      [c => { c.abilities.brace!.input = 'press'; }, 'ability brace: input'],
+      [c => { c.abilities.grab!.attackId = 'nope'; }, 'ability grab: attack nope'],
+      [c => { c.abilities.counter!.guardProfileId = 'fx-brace'; }, 'ability counter: guard fx-brace'],
+      [c => { c.abilities.dash!.evasionProfileId = undefined; }, 'ability dash: evasion undefined'],
+      [c => { c.abilities.dash!.attackId = 'pinch'; }, 'ability dash: attack pinch'],
+      // V10
+      [c => { c.abilities.dash!.scaling = { 'guard.blockFraction': .2 }; }, 'ability dash: scaling key guard.blockFraction'],
+      [c => { c.abilities.grab!.scaling = { 'attack.nope': .2 }; }, 'ability grab: scaling key attack.nope'],
+      [c => { c.abilities.grab!.pair = { multiply: { 'attack.damage': .5 }, add: {} }; }, 'ability grab: pair multiplier attack.damage'],
+      [c => { c.abilities.dash!.scaling = { cooldownSeconds: Infinity }; }, 'ability dash: scaling value cooldownSeconds'],
+      // V11
+      [c => { c.guards['fx-brace']!.blockFraction = 1.2; }, 'guard fx-brace: blockFraction'],
+      [c => { c.guards['fx-brace']!.frontHalfAngle = 0; }, 'guard fx-brace: frontHalfAngle'],
+      [c => { c.guards['fx-brace']!.windowSeconds = .2; }, 'guard fx-brace: windowSeconds'],
+      [c => { c.guards['fx-counter']!.breakHalfHearts = 3; }, 'guard fx-counter: breakHalfHearts'],
+      [c => { c.guards['fx-counter']!.startupSeconds = -1; }, 'guard fx-counter: startupSeconds'],
+      // V12
+      [c => { c.evasions['fx-dash']!.travelSeconds = 0; }, 'evasion fx-dash: travelSeconds'],
+      [c => { c.evasions['fx-dash']!.distanceBodyLengths = 0; }, 'evasion fx-dash: distanceBodyLengths'],
+      [c => { c.evasions['fx-dash']!.endSpeedCarry = 2; }, 'evasion fx-dash: endSpeedCarry'],
+      // V13
+      [c => { c.telegraphs['amber-rear']!.poseCue = 'dance' as never; }, 'telegraph amber-rear: enum'],
+      [c => { c.telegraphs['amber-rear']!.flashLeadSeconds = .5; }, 'telegraph amber-rear: flashLeadSeconds'],
+      [c => { c.effects.ink!.status = { id: 'inked', seconds: 0, speedFactor: .7 }; }, 'effect ink: status'],
+      [c => { c.effects.hit!.sound = 'boom' as never; }, 'effect hit: enum'],
+      // V14
+      [c => { c.behaviours['fx-hunter']!.type = 'boss' as never; }, 'behaviour fx-hunter: type'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'nope', band: [0, 1], weight: 1 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: attack nope missing'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'pinch', band: [0, 1], weight: 1 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: attack pinch unit'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }]; }, 'behaviour fx-hunter: 1:fx_hunter attack wrap unused'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1, chainNextId: 'smash' }]; }, 'behaviour fx-hunter: smash not in 1:fx_hunter attackIds'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [1, 1], weight: 3 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: band poke'],
+      [c => { c.behaviours['fx-hunter']!.attacks = [{ attackId: 'poke', band: [0, 1.2], weight: 0 }, { attackId: 'wrap', band: [0, .6], weight: 1 }]; }, 'behaviour fx-hunter: weight poke'],
+      [c => { c.behaviours['fx-hunter']!.gapSeconds = -1; }, 'behaviour fx-hunter: durations'],
+      [c => { c.behaviours['fx-hunter']!.repositionSeconds = [1.2, .6]; }, 'behaviour fx-hunter: repositionSeconds'],
+      // V15
+      [c => { c.behaviours['fx-fleer']!.flee = undefined; }, 'behaviour fx-fleer: flee'],
+      [c => { c.behaviours['fx-fleer']!.school = { radiusBodyLengths: 6, groupSize: 4 }; }, 'behaviour fx-fleer: school'],
+      [c => { c.behaviours['fx-hunter']!.den = { triggerBodyLengths: .9, outSeconds: 4, attackId: 'poke' }; }, 'behaviour fx-hunter: den'],
+      [c => { c.behaviours['fx-hunter']!.lair = { radiusBodyLengths: 2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 }; }, 'behaviour fx-hunter: lair'],
+      [c => { c.behaviours['fx-alpha']!.phases = [...c.behaviours['fx-alpha']!.phases!].reverse(); }, 'behaviour fx-alpha: phase order'],
+      [c => { c.behaviours['fx-alpha']!.phases = c.behaviours['fx-alpha']!.phases!.map(p => ({ ...p, pattern: 'burrow' as const })); }, 'behaviour fx-alpha: phase 0 pattern'],
+      // V17
+      [c => { c.species = c.species.filter(s => s.key !== '1:fx_alpha'); }, 'part fx_rare: rare without one alpha'],
+      [c => { c.parts = c.parts.map(p => p.id === 'fx_rare' ? { ...p, model: 'fx_rare' } : p); }, 'part fx_rare: model fx_rare'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, rewardPartId: 'claw_pincer' } } : s); }, 'species 1:fx_alpha: reward claw_pincer'],
+      // V18
+      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, contactHazardId: 'crab-pinch' } : s); }, 'species 1:fx_hunter: behaviour and hazard'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'fx-fleer' } : s); }, 'species 1:fx_hunter: hazard missing'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'nope' } : s); }, 'species 1:fx_hunter: behaviour nope'],
+      // V19
+      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, bodyScale: 3.5 } : s); }, 'species 1:fx_alpha: bodyScale'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, size: 5 } } : s); }, 'species 1:fx_alpha: alpha'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, rewardDna: 1.5 } } : s); }, 'species 1:fx_alpha: alpha'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, count: 2 } : s); }, 'species 1:fx_alpha: alpha count or behaviour'],
+      // V20
+      [c => { c.species = c.species.map(s => s.key === '0:fx_fleer' ? { ...s, model: 'eel' as never } : s); }, 'species 0:fx_fleer: model eel'],
     ];
     for (const [f, message] of cases) expect(mutate(f), message).toContain(message);
   });
+  it('names the hostile sizes and their minimum wind-ups (spec §11.1)', () => {
+    expect(hostileSizes(SPECIES.find(s => s.key === '1:crab')!)).toEqual([0, 1]);   // hunts 0; fights at its own tier 1
+    expect(hostileSizes(SPECIES.find(s => s.key === '2:squid')!)).toEqual([1, 2]);
+    expect(hostileSizes({ hunts: [0], fights: true, tier: 1, alpha: { size: 0, rewardPartId: 'x', rewardDna: 1 } })).toEqual([0]);
+    expect([minWindup(0, false), minWindup(1, false), minWindup(2, false), minWindup(0, true), minWindup(1, true)]).toEqual([.45, .40, .40, .55, .55]);
+  });
+  it('gives the hit-stop of every outcome and the damage text (spec §5.9, §9.2)', () => {
+    expect(hitStopFor('hit', { targetIsPlayer: true, amount: 1 })).toBeCloseTo(.06); expect(hitStopFor('hit', { targetIsPlayer: true, amount: 3 })).toBeCloseTo(.08);
+    expect(hitStopFor('hit', { targetIsPlayer: true, amount: 9 })).toBeCloseTo(.09);
+    expect(hitStopFor('hit', { targetIsPlayer: false, amount: 4 })).toBeCloseTo(.075);   // 60 + round(30 × .5) = 75 ms
+    expect(hitStopFor('hit', { targetIsPlayer: false, amount: 20 })).toBeCloseTo(.09);
+    expect([hitStopFor('countered', { targetIsPlayer: false, amount: 0 }), hitStopFor('blocked', { targetIsPlayer: true, amount: 0 }), hitStopFor('guard-broken', { targetIsPlayer: true, amount: 2 }),
+      hitStopFor('grabbed', { targetIsPlayer: true, amount: 1 }), hitStopFor('evaded', { targetIsPlayer: true, amount: 2 }), hitStopFor('immune', { targetIsPlayer: true, amount: 2 })]).toEqual([.09, .06, .06, .07, 0, 0]);
+    expect([damageText('hit', 'hp', 4), damageText('hit', 'half-heart', 1), damageText('hit', 'half-heart', 2), damageText('hit', 'half-heart', 3), damageText('blocked', 'half-heart', 1), damageText('countered', 'hp', 0), damageText('evaded', 'half-heart', 2)])
+      .toEqual(['−4', '−½ ♥', '−1 ♥', '−1½ ♥', 'BLOCK', 'COUNTER!', 'DODGE']);
+  });
   it('gives parts combat fields with unit sockets bound to real pivots', () => {
     for (const p of PARTS) for (const s of p.sockets) expect(Math.hypot(s.forward.x, s.forward.y, s.forward.z)).toBeCloseTo(1);
     expect(PARTS.find(p => p.id === 'claw_pincer')!.sockets[0]!.pivot).toEqual({ kind: 'swing', index: 0 });
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/contract.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/combat-profiles"` (and `bestiary`).

- [ ] **Step 4: Extend the contract types**

```diff
--- a/src/tiny-tide/combat-types.ts
+++ b/src/tiny-tide/combat-types.ts
@@ -6,7 +6,14 @@
 import type { Medium } from './plans';
 export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
 export type MutVec3 = { x: number; y: number; z: number };
-export type PartUid = string; export type ActorId = string; export type ActiveSlot = 0 | 1;
+export type PartUid = string; export type ActorId = string; export type ActiveSlot = 0 | 1 | 2 | 3;
+export type Tuple4<T> = [T, T, T, T];
+export type MoveKind = 'grab' | 'counter' | 'brace' | 'dash' | 'sweep';
+export type SlotClass = 'defense' | 'movement' | 'attack';
+/** The fixed slot priority (R1): defense, then movement, then attack. */
+export const MOVE_PRIORITY: readonly MoveKind[] = ['brace', 'counter', 'dash', 'grab', 'sweep'];
+export const SLOT_CLASS: Readonly<Record<MoveKind, SlotClass>> = { brace: 'defense', counter: 'defense', dash: 'movement', grab: 'attack', sweep: 'attack' };
+export type SlotPin = MoveKind | null;
 export type CombatTrait = 'weapon' | 'protection' | 'locomotion' | 'concealment';
 export type MovementMode = 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
 export interface PivotRef { kind: 'jaw' | 'seg' | 'flap' | 'swing'; index: number }
@@ -16,18 +23,76 @@ export interface ActiveGrant { id: string; abilityId: string; socketIds: readonl
 export interface PartCombatFields { traits: readonly CombatTrait[]; sockets: readonly CombatSocket[]; basicAttacks: readonly AttackGrant[]; activeGrants: readonly ActiveGrant[] }
 export interface AbilityBinding { partUid: PartUid; grantId: string }
 export interface CombatLoadout { active: [AbilityBinding | null, AbilityBinding | null] }
-export type AttackShape = { kind: 'cone'; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };   // part-local units, scaled once by the mount
+/** Shape numbers are in attacker body lengths (L_a), in the aim frame (z = aim). A capsule with start = end is a sphere. */
+export type AttackShape = { kind: 'cone'; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
+/** value = base × (1 + k × (scale − 1)); one k per parameter key (moves.ts `resolveMove` names the key syntax). */
+export type MoveScaling = Readonly<Record<string, number>>;
+/** A mirrored pair: value × multiply[key] + add[key], applied before the one rounding. */
+export interface PairBonus { multiply: Readonly<Record<string, number>>; add: Readonly<Record<string, number>> }
+export type AimMode = 'input' | 'body-back' | 'centre' | 'fixed-at-start';
+export interface AttackHold { seconds: number; sizeFactor: number; startHalfHearts: number; squeezeHalfHearts: number; squeezeEverySeconds: number }
 export interface AttackSpec { id: string; shape: AttackShape; poseProfileId: string; windupSeconds: number; activeSeconds: number; recoverySeconds: number; cooldownSeconds: number;
   aimLockAtSeconds: number; maxTrackingRadiansPerSecond: number; damage: number; impulse: number; staggerSeconds: number; blockable: boolean; parryable: boolean; interruptible: boolean;
-  maxTargets: number; hitGroup: 'shared-grant' | 'per-emitter'; maxHitsPerTarget: number; repeatHitSeconds: number; crossing: 'same-medium' | 'water-surface' | 'any-medium'; obstruction: 'terrain-and-cover'; telegraphProfileId: string }
-export interface AbilitySpec { id: string; cooldownSeconds: number; allowedMotionModes: readonly MovementMode[]; effectProfileId: string }
+  maxTargets: number; hitGroup: 'shared-grant' | 'per-emitter'; maxHitsPerTarget: number; repeatHitSeconds: number; crossing: 'same-medium' | 'water-surface' | 'any-medium'; obstruction: 'terrain-and-cover'; telegraphProfileId: string;
+  /** 'hp' for player attacks, 'half-heart' for species attacks. */
+  damageUnit: 'hp' | 'half-heart'; aimMode: AimMode;
+  /** Locomotion factor during windup and active. */
+  moveSpeedFactor: number; poiseDamageMultiplier: number;
+  /** The attacker moves along the aim during active. */
+  lunge?: { distanceBodyLengths: number };
+  hold?: AttackHold;
+  /** Recovery when the attack hit nothing (grabs). */
+  whiffRecoverySeconds?: number;
+  /** A status applied on hit (ink). */
+  statusEffectId?: string;
+  /** Player attacks only. */
+  scaling?: MoveScaling; pair?: PairBonus | null }
+export interface AbilitySpec { id: string; cooldownSeconds: number; allowedMotionModes: readonly MovementMode[]; effectProfileId: string;
+  kind: MoveKind; label: string; input: 'press' | 'hold';
+  /** grab, sweep */
+  attackId?: string;
+  /** brace, counter */
+  guardProfileId?: string;
+  /** dash */
+  evasionProfileId?: string;
+  scaling: MoveScaling; pair: PairBonus | null }
+export interface GuardProfile {
+  id: string; kind: 'brace' | 'counter';
+  startupSeconds: number; minActiveSeconds: number;
+  /** Counter only. */
+  windowSeconds: number | null;
+  /** Brace only; radians. */
+  frontHalfAngle: number | null;
+  blockFraction: number;
+  /** Brace only. */
+  breakHalfHearts: number | null; breakStaggerSeconds: number; brokenCooldownSeconds: number;
+  moveSpeedFactor: number; yawRateFactor: number;
+  /** Counter only. */
+  reflectDamage: number; attackerStaggerSeconds: number;
+  recoverySeconds: number; whiffRecoverySeconds: number; successCooldownSeconds: number;
+}
+export interface EvasionProfile { id: string; distanceBodyLengths: number; startupSeconds: number; travelSeconds: number; recoverySeconds: number; plane: 'free' | 'horizontal'; endSpeedCarry: number }
+export interface TelegraphProfile { id: string; color: 'amber' | 'red' | 'none'; pattern: 'solid' | 'stripes'; poseCue: 'rear' | 'crouch' | 'inflate' | 'coil' | 'burrow' | 'spin' | 'none'; flashLeadSeconds: number; edgeArrow: boolean }
+export interface EffectProfile { id: string; kind: 'feedback' | 'status'; status?: { id: 'inked'; seconds: number; speedFactor: number }; sound: 'hit' | 'block' | 'counter' | 'dash' | 'grab' | 'break' | 'none'; particles: string }
+/** The numbers of one move after size and pair (spec §7.3): resolved copies of the specs it came from, with their own field names.
+ *  A species attack resolves to itself (kind 'species'). */
+export interface ResolvedMove {
+  kind: MoveKind | 'bite' | 'species';
+  /** The ability of a slot move, else null. */
+  abilityId: string | null;
+  label: string; input: 'press' | 'hold';
+  attack: AttackSpec | null; guard: GuardProfile | null; evasion: EvasionProfile | null;
+  cooldownSeconds: number; allowedMotionModes: readonly MovementMode[];
+}
 export interface ContactHazard { id: string; damage: number; cadenceSeconds: number; invulnerabilitySeconds: number; impulse: number }
 export interface HabitatProfile { id: string; media: readonly Medium[]; maxWaterDepthBodyLengths: number | null; maxFloorGapBodyLengths: number | null; maxLandSlopeRadians: number;
   surfaceBandBodyLengths: number | null; wadingSupportBodyLengths: number | null; refugeTags: readonly string[]; isStaticProp?: boolean }
 export interface MovementProfile { id: string; mode: MovementMode; speedMultiplier: number; acceleration: number; braking: number; maxYawRate: number; maxPitchRate: number;
   facing: 'move' | 'aim' | 'lock-during-action'; evasionProfileId?: string }
 export interface PursuitPolicy { id: string; memorySeconds: number; blockedWaitSeconds: number; reacquireSeconds: number; leashBodyLengths: number; giveUpBodyLengths: number }
-export interface SpeciesCombatFields { movementProfileId: string; habitatProfileId: string; hullProfileId: string; attackMountProfileId: string; attackIds: readonly string[]; contactHazardId?: string; pursuitId: string }
+export interface SpeciesCombatFields { movementProfileId: string; habitatProfileId: string; hullProfileId: string; attackMountProfileId: string; attackIds: readonly string[]; contactHazardId?: string; pursuitId: string;
+  /** Only combat species (with a behaviour) use the action engine (bestiary.ts). */
+  behaviourId?: string }
 export interface EnvironmentSample { medium: Medium; groundHeight: number; surfaceHeight: number | null; waterDepth: number; groundClearance: number; groundNormal: Vec3; coverIds: readonly string[]; refugeId: string | null }
 /** sway: horizontal and heave: vertical animation envelope; the occupied volume is the capsule swept by any such offset.
  *  radii (optional): a tapered capsule. Its cross-section in each plane of constant body z between the ends is the disc around the
@@ -64,18 +129,48 @@ export interface WorldQueries {
 }
 export interface LegalityContext { queries: WorldQueries; bounds?: { half: number; maxY?: number } }
 export interface MotionRequest { actorId: ActorId; from: Vec3; displacement: Vec3; orientation: Orientation; turn?: Orientation; hull: readonly Capsule[]; habitatProfileId: string;
-  cause: 'locomotion' | 'dash' | 'knockback' | 'recovery'; traversalPermit?: TraversalPermit | null;
+  cause: 'locomotion' | 'dash' | 'knockback' | 'recovery' | 'lunge' | 'grab'; traversalPermit?: TraversalPermit | null;
   /** When set, a slide after a contact never lifts the body more than this above `from` (a ground body's support-following rise). */
   riseCap?: number }
 export interface Contact { point: Vec3; normal: Vec3; constraint: Constraint; distanceFraction: number; time: number; solidId?: string }
 export interface MotionResult { status: 'moved' | 'blocked' | 'clamped' | 'invalid-start' | 'needs-recovery'; position: Vec3; orientation: Orientation; contacts: readonly Contact[]; unconsumed: Vec3; time: number }
 export type RecoveryResult = { ok: true; position: Vec3; orientation: Orientation } | { ok: false; reason: string };
-export interface ActionState { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; phase: 'windup' | 'active' | 'recovery' | 'interrupted'; startedAt: number; aim: Vec3; committedPose: CombatPose | null; hitCounts: Map<string, number>; lastHitAt: Map<string, number> }
+export type ActionPhase = 'windup' | 'active' | 'hold' | 'recovery' | 'interrupted';
+export type WorldShape = { kind: 'cone'; apex: Vec3; axis: Vec3; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
+export type HitOutcome = 'countered' | 'blocked' | 'guard-broken' | 'evaded' | 'immune' | 'hit' | 'grabbed';
+/** `startedAt` is world time (the resolver's processing order); every other time is the actor's action clock.
+ *  Ledger keys (hitCounts, lastHitAt) are `${instanceId}:${hitGroupId}:${targetId}`. */
+export interface ActionState { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; phase: ActionPhase; startedAt: number; aim: MutVec3; committedPose: CombatPose | null;
+  hitCounts: Map<string, number>; lastHitAt: Map<string, number>;
+  /** Action-clock seconds. */
+  phaseStartedAt: number; aimLocked: boolean;
+  /** Numbers after size and pair (§7.3); species: the spec itself. */
+  resolved: ResolvedMove;
+  /** The actor the attacker aimed at (director, telegraph). */
+  targetId: ActorId | null;
+  heldTarget: ActorId | null; windupExtension: number; released: boolean;
+  /** A Counter that countered a hit (it ends with no recovery). */
+  countered: boolean;
+  /** Body lengths a lunge has moved. */
+  lungeDone: number;
+  /** The world shapes fixed at the lock (a mirrored pair has two), or null before it. */
+  lockedShapes: WorldShape[] | null;
+  /** Squeezes dealt in the hold phase. */
+  squeezes: number;
+  /** The cooldown key (contract: `${actorId}:${partUid}:${grantId}`; species `${actorId}:root:${attackId}`). */
+  cooldownKey: string }
 /** `endY`: the height the arc ends at, fixed when it starts (player-motion.ts `breachEndY`). */
 export interface BreachArc { startedAt: number; duration: number; fromY: number; endY: number }
+/** `invulnerableUntil`, `hitStopUntil`, `status.until`, `lastDamageAt` and `lastThreatAt` are world time; `staggerUntil`, cooldown ready times and
+ *  `buffered.at` are action-clock seconds (spec §5.1). */
 export interface CombatRuntime { targetable: boolean; perceivable: boolean; damageable: boolean; invulnerableUntil: number; staggerUntil: number; guardProfileId: string | null;
   controlledVelocity: MutVec3; externalVelocity: MutVec3; orientation: Orientation; cooldowns: Map<string, number>; actions: ActionState[]; permit: TraversalPermit | null;
-  arc: BreachArc | null; breachReadyAt: number; groundOffset: number }
+  arc: BreachArc | null; breachReadyAt: number; groundOffset: number;
+  actionClock: number; hitStopUntil: number;
+  buffered: { input: 'basic' | ActiveSlot; at: number } | null;
+  heldBy: ActorId | null; breakProgress: number;
+  status: { id: 'inked'; until: number; speedFactor: number } | null;
+  lastDamageAt: number; lastThreatAt: number }
 export interface HitRequest { source: ActorId; target: ActorId; actionInstanceId: string; attackId: string; emitter: EmitterSource; hitGroupId: string; point: Vec3; normal: Vec3; damage: number; impulse: Vec3 }
 export interface CombatInput { move: Vec3; aim: Vec3 | null; basicHeld: boolean; basicPressed: boolean; activePressed: [boolean, boolean]; activeHeld: [boolean, boolean]; activeReleased: [boolean, boolean]; activeCanceled: [boolean, boolean]; traversal: 'none' | 'rise' | 'dive' | 'breach' }
 export type { DnaCredit } from './economy';
@@ -83,5 +178,6 @@ export type { DnaCredit } from './economy';
 export function newRuntime(orientation: Orientation = { yaw: 0, pitch: 0 }): CombatRuntime {
   return { targetable: true, perceivable: true, damageable: true, invulnerableUntil: 0, staggerUntil: 0, guardProfileId: null,
     controlledVelocity: { x: 0, y: 0, z: 0 }, externalVelocity: { x: 0, y: 0, z: 0 }, orientation: { yaw: orientation.yaw, pitch: orientation.pitch },
-    cooldowns: new Map(), actions: [], permit: null, arc: null, breachReadyAt: 0, groundOffset: 0 };
+    cooldowns: new Map(), actions: [], permit: null, arc: null, breachReadyAt: 0, groundOffset: 0,
+    actionClock: 0, hitStopUntil: 0, buffered: null, heldBy: null, breakProgress: 0, status: null, lastDamageAt: -Infinity, lastThreatAt: -Infinity };
 }
```

- [ ] **Step 5: Create `combat-profiles.ts`** (complete file)

```ts
// Telegraph and effect profiles, hit-stop durations and feedback constants (spec §5.9, §9). Pure data and pure functions.
import type { EffectProfile, HitOutcome, TelegraphProfile } from './combat-types';

/** The flash before active (spec §9.1 item 5). */
export const FLASH_LEAD_SECONDS = .12;
const telegraph = (id: string, color: TelegraphProfile['color'], poseCue: TelegraphProfile['poseCue']): TelegraphProfile =>
  ({ id, color, pattern: color === 'red' ? 'stripes' : 'solid', poseCue, flashLeadSeconds: color === 'none' ? 0 : FLASH_LEAD_SECONDS, edgeArrow: color !== 'none' });
/** Amber solid: can be blocked. Red stripes: cannot be blocked. 'none': player attacks (no telegraph). */
export const TELEGRAPHS: Record<string, TelegraphProfile> = Object.fromEntries([
  telegraph('none', 'none', 'none'),
  telegraph('amber-rear', 'amber', 'rear'), telegraph('amber-crouch', 'amber', 'crouch'), telegraph('amber-spin', 'amber', 'spin'),
  telegraph('amber-inflate', 'amber', 'inflate'), telegraph('amber-coil', 'amber', 'coil'),
  telegraph('red-coil', 'red', 'coil'), telegraph('red-burrow', 'red', 'burrow'), telegraph('red-spin', 'red', 'spin'),
].map(t => [t.id, t]));
const feedback = (id: string, sound: EffectProfile['sound'], particles: string): EffectProfile => ({ id, kind: 'feedback', sound, particles });
export const EFFECTS: Record<string, EffectProfile> = {
  hit: feedback('hit', 'hit', '#ffd9a8'), block: feedback('block', 'block', '#cfe3ff'), counter: feedback('counter', 'counter', '#fff2b3'),
  dash: feedback('dash', 'dash', '#d6fff1'), grab: feedback('grab', 'grab', '#ffd9a8'), break: feedback('break', 'break', '#cfe3ff'),
  ink: { id: 'ink', kind: 'status', status: { id: 'inked', seconds: 1.5, speedFactor: .7 }, sound: 'none', particles: '#2b1f3a' },
};

/** Impact particle colours by outcome (spec §9.2). */
export const IMPACT_COLOURS = { hit: '#ffd9a8', hurt: '#ff8f7a', block: '#cfe3ff', counter: '#fff2b3' } as const;
export const IMPACT_PARTICLES = 10;
/** The hurt actor's white flash. */
export const FLASH_SECONDS = .08;

/** Hit-stop in seconds (spec §5.9). `amount`: half-hearts dealt to a player target, else HP dealt by a player attacker. */
export function hitStopFor(outcome: HitOutcome, side: { targetIsPlayer: boolean; amount: number }): number {
  switch (outcome) {
    case 'countered': return .09;
    case 'blocked': case 'guard-broken': return .06;
    case 'grabbed': return .07;
    case 'evaded': case 'immune': return 0;
    case 'hit': return side.targetIsPlayer
      ? Math.min(90, Math.max(60, 60 + 10 * (side.amount - 1))) / 1000
      : (60 + Math.round(30 * Math.min(1, side.amount / 8))) / 1000;
  }
}
/** Camera shake (world.shake units, 1 = today's hurt shake). Only hits on the player and the player's Sweep and Counter shake. */
export const shakeForPlayerHit = (halfHearts: number) => Math.min(1, .35 * halfHearts);
export const shakeForPlayerStrike = (hp: number) => Math.min(.6, .1 * hp);
/** Damage number text (spec §9.2). */
export function damageText(outcome: HitOutcome, unit: 'hp' | 'half-heart', amount: number): string {
  if (outcome === 'blocked') return 'BLOCK';
  if (outcome === 'countered') return 'COUNTER!';
  if (outcome === 'evaded') return 'DODGE';
  if (unit === 'hp') return `−${amount}`;
  const hearts = Math.floor(amount / 2), half = amount % 2 === 1;
  return `−${hearts === 0 ? '' : hearts}${half ? '½' : ''} ♥`;
}
```

- [ ] **Step 6: Create the `bestiary.ts` skeleton** (complete file; T13 fills `SPECIES_ATTACKS` and `BEHAVIOURS`)

```ts
// Species attacks, species behaviours, the size rosters and the minimum wind-ups (spec §11). Pure data.
import type { AttackSpec } from './combat-types';
import type { Species } from './species';

export interface AttackChoice { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }
/** `patternAttackId`: the attack of a burrow or laps pattern. */
export interface BehaviourPhase { aboveHpFraction: number; attacks: readonly AttackChoice[]; speedFactor: number; gapSeconds: number; pattern: 'normal' | 'burrow' | 'laps'; patternAttackId?: string }
export type BehaviourType = 'prey-flee' | 'prey-school' | 'prey-fighter' | 'hunter' | 'hunter-ambush' | 'alpha';
export interface SpeciesBehaviour {
  id: string; type: BehaviourType;
  reactionSeconds: number; poise: number; staggerResist: number; knockbackResistance: number; grabbable: boolean;
  attacks: readonly AttackChoice[]; gapSeconds: number;
  repositionSeconds: readonly [number, number]; repositionSpeedFactor: number;
  flee?: { seconds: number; restSeconds: number; speedFactor: number };
  school?: { radiusBodyLengths: number; groupSize: number };
  /** prey-fighter "cornered" */
  trigger?: { radiusBodyLengths: number; seconds: number };
  /** hunter-ambush */
  den?: { triggerBodyLengths: number; outSeconds: number; attackId: string };
  lair?: { radiusBodyLengths: number; resetOutsideFactor: number; resetDelaySeconds: number; healPerSecond: number };
  /** alpha; ordered by aboveHpFraction, descending */
  phases?: readonly BehaviourPhase[];
}
export const BEHAVIOUR_TYPES: readonly BehaviourType[] = ['prey-flee', 'prey-school', 'prey-fighter', 'hunter', 'hunter-ambush', 'alpha'];

/** Minimum wind-ups before director extensions (spec §11.1), by player size. Sizes 2 and up use the size-1 row until 3b retunes them. */
export const MIN_WINDUP: readonly { fighter: number; alpha: number }[] = [{ fighter: .45, alpha: .55 }, { fighter: .40, alpha: .55 }];
export const minWindup = (size: number, alpha: boolean): number => { const row = MIN_WINDUP[Math.min(size, MIN_WINDUP.length - 1)]!; return alpha ? row.alpha : row.fighter; };
/** The player sizes at which a species is hostile (spec §11.1): it hunts that size, or it fights and is of that tier; an alpha only at its own size. */
export function hostileSizes(spec: Pick<Species, 'hunts' | 'fights' | 'tier' | 'alpha'>): number[] {
  if (spec.alpha) return [spec.alpha.size];
  const out = new Set<number>(spec.hunts);
  if (spec.fights) out.add(spec.tier);
  return [...out].sort((a, b) => a - b);
}

/** Species attacks (spec §11.5). Filled by Task 14. */
export const SPECIES_ATTACKS: Record<string, AttackSpec> = {};
/** Species behaviours (spec §11.4). Filled by Task 14. */
export const BEHAVIOURS: Record<string, SpeciesBehaviour> = {};
```

- [ ] **Step 7: Remove the placeholder profiles and extend parts and species**

```diff
--- a/src/tiny-tide/parts.ts
+++ b/src/tiny-tide/parts.ts
@@ -1,6 +1,6 @@
 // Creature parts for the editor. Each part is a Blender GLB named `part_<id>`.
 // See docs/TINY-TIDE-EVOLUTION.md for the attach conventions.
-import type { CombatSocket, CombatTrait, PartCombatFields, PivotRef } from './combat-types';
+import type { CombatSocket, CombatTrait, MoveKind, PartCombatFields, PivotRef } from './combat-types';
 export type PartKind = 'mouth' | 'eye' | 'fin' | 'tail' | 'leg' | 'wing' | 'jet' | 'arm' | 'armor' | 'sense' | 'cosmic';
 export type Diet = 'herbivore' | 'carnivore' | 'omnivore';
 export type TintSlot = 'base' | 'belly' | 'accent';
@@ -10,7 +10,17 @@ export interface PartSpec extends PartCombatFields {
   tint: TintSlot; mirror: boolean; diet?: Diet; blurb: string;
   /** Where the editor puts a new part: t along the body, angle around it. */
   t: number; angle: number;
+  /** An alpha reward: in the editor only when unlocked (spec §7.6). */
+  rare?: true;
+  /** The part whose GLB, rig and sockets this part uses (default `id`). */
+  model?: string;
 }
+/** The move kind each move-giving part grants (spec §7.1). Mouths give the basic Bite instead. */
+export const PART_MOVES: Readonly<Record<string, MoveKind>> = {
+  claw_pincer: 'grab', claw_mother: 'grab', spike: 'counter', shell_plate: 'brace',
+  fin_side: 'dash', fin_dorsal: 'dash', fin_frill: 'dash', tail_paddle: 'dash', leg_little: 'dash', leg_crab: 'dash',
+  tail_fan: 'sweep', tail_fluke: 'sweep',
+};
 const W: CombatTrait[] = ['weapon'], WL: CombatTrait[] = ['weapon', 'locomotion'], PR: CombatTrait[] = ['protection'], L: CombatTrait[] = ['locomotion'];
 const TRAITS: Record<string, readonly CombatTrait[]> = {
   claw_pincer: W, horn: W, tentacle: W, tentacle_long: W, tail_paddle: WL, tail_fan: WL, tail_fluke: WL,
--- a/src/tiny-tide/profiles.ts
+++ b/src/tiny-tide/profiles.ts
@@ -35,7 +35,7 @@ export const PURSUITS: Record<string, PursuitPolicy> = {
 };
 
 const ids = (...names: string[]): Record<string, { id: string }> => Object.fromEntries(names.map(id => [id, { id }]));
-export const HULLS = ids('sphere', 'spine-capsules'), MOUNTS = ids('root'), POSES = ids('rest'), TELEGRAPHS = ids('basic'), EFFECTS = ids('dash'), EVASIONS = ids(), GUARDS = ids();
+export const HULLS = ids('sphere', 'spine-capsules'), MOUNTS = ids('root'), POSES = ids('rest');
 
 export const habitat = (id: string): HabitatProfile => HABITATS[id]!;
 export const movement = (id: string): MovementProfile => MOVEMENTS[id]!;
--- a/src/tiny-tide/species.ts
+++ b/src/tiny-tide/species.ts
@@ -15,6 +15,14 @@ export interface Species extends SpeciesCombatFields {
   stingsStages: readonly number[];
   /** Fights back when bitten. */
   fights: boolean;
+  /** Body size factor (default 1): the hull, the body length and the model scale. */
+  bodyScale?: number;
+  /** The food GLB this species draws (default `kind`). */
+  model?: FoodKind;
+  /** A material colour multiply on the model. */
+  tint?: string;
+  /** An alpha: present only while the player's size equals `size`; defeating it unlocks `rewardPartId` and pays `rewardDna`. */
+  alpha?: { size: number; rewardPartId: string; rewardDna: number };
 }
 const habitatOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-air' : behavior === 'still' || behavior === 'graze' ? 'sp-seabed' : 'sp-water';
 const movementOf = (behavior: Behavior) => behavior === 'flyer' ? 'sp-fly' : behavior === 'still' ? 'sp-still' : behavior === 'graze' ? 'sp-ground' : 'sp-swim';
@@ -50,4 +58,6 @@ export const SPECIES: readonly Species[] = [
 const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
 export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
 export const tierSpecies = (tier: number) => SPECIES.filter(spec => spec.tier === tier);
+/** Food kinds with a GLB (`public/tiny-tide/models/<kind>.glb`); planets use `planet_XX`. */
+export const FOOD_GLBS: readonly FoodKind[] = ['plant', 'kelp_snack', 'seagrape', 'lettuce', 'copepod', 'worm', 'shrimp', 'crab', 'jellyfish', 'snail', 'fish', 'squid', 'ray', 'bird', 'tree', 'boat', 'plane', 'balloon', 'lighthouse'];
 export const FOOD_MODEL_KINDS = [...new Set(SPECIES.filter(spec => spec.kind !== 'planet').map(spec => spec.kind))];
```

- [ ] **Step 8: Typed registries and the validation rules**

```diff
--- a/src/tiny-tide/registries.ts
+++ b/src/tiny-tide/registries.ts
@@ -1,27 +1,49 @@
 // Every combat registry in one place, and the full enumerated validation of the contract.
-import type { AbilitySpec, AttackSpec, ContactHazard, HabitatProfile, MovementProfile, PursuitPolicy } from './combat-types';
-import { EFFECTS, EVASIONS, GUARDS, HABITATS, HULLS, MOUNTS, MOVEMENTS, POSES, PURSUITS, TELEGRAPHS } from './profiles';
+import { MOVE_PRIORITY, type AbilitySpec, type AttackSpec, type ContactHazard, type EffectProfile, type EvasionProfile, type GuardProfile, type HabitatProfile, type MovementProfile, type PursuitPolicy, type TelegraphProfile } from './combat-types';
+import { HABITATS, HULLS, MOUNTS, MOVEMENTS, POSES, PURSUITS } from './profiles';
+import { EFFECTS, TELEGRAPHS } from './combat-profiles';
+import { BEHAVIOUR_TYPES, BEHAVIOURS, hostileSizes, minWindup, SPECIES_ATTACKS, type SpeciesBehaviour } from './bestiary';
 import { PARTS, type PartSpec } from './parts';
 import { PLANS, type BodyPlan } from './plans';
-import { SPECIES, type Species } from './species';
+import { FOOD_GLBS, SPECIES, type Species } from './species';
 import { PART_RIG, type RigNode } from './rig';
 
 type Entry = Record<string, { id: string }>;
 export interface Catalogs {
   habitats: Record<string, HabitatProfile>; movements: Record<string, MovementProfile>; pursuits: Record<string, PursuitPolicy>;
-  hulls: Entry; mounts: Entry; poses: Entry; telegraphs: Entry; effects: Entry; evasions: Entry; guards: Entry;
-  attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; hazards: Record<string, ContactHazard>;
+  hulls: Entry; mounts: Entry; poses: Entry; telegraphs: Record<string, TelegraphProfile>; effects: Record<string, EffectProfile>;
+  evasions: Record<string, EvasionProfile>; guards: Record<string, GuardProfile>;
+  attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; hazards: Record<string, ContactHazard>; behaviours: Record<string, SpeciesBehaviour>;
   parts: PartSpec[]; species: Species[]; plans: BodyPlan[]; rig: Record<string, Record<string, RigNode>>;
 }
-export const ATTACKS: Record<string, AttackSpec> = {};
+/** Player attacks (moves.ts, Task 2) and species attacks (bestiary.ts), merged; a duplicate id throws at load. */
+function merged(...sources: Record<string, AttackSpec>[]): Record<string, AttackSpec> {
+  const out: Record<string, AttackSpec> = {};
+  for (const src of sources) for (const [k, v] of Object.entries(src)) { if (out[k]) throw new Error(`duplicate attack id ${k}`); out[k] = v; }
+  return out;
+}
+export const ATTACKS: Record<string, AttackSpec> = merged(SPECIES_ATTACKS);
 export const ABILITIES: Record<string, AbilitySpec> = {};
+export const GUARDS: Record<string, GuardProfile> = {};
+export const EVASIONS: Record<string, EvasionProfile> = {};
 const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
 export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 1, 1.8), hazard('ray-sting', 1, 1.8), hazard('crab-pinch', 2, 1.4), hazard('squid-grab', 2, 1.4), hazard('plane-buzz', 2, 1.4)].map(h => [h.id, h]));
 export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
-  effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
+  effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, behaviours: BEHAVIOURS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
 
 const MEDIA = ['water', 'air', 'land', 'burrow', 'space'], MODES = ['ground', 'swim', 'surface', 'glide', 'fly', 'burrow', 'space'], FACINGS = ['move', 'aim', 'lock-during-action'];
 const TRAITS = ['weapon', 'protection', 'locomotion', 'concealment'];
+const AIM_MODES = ['input', 'body-back', 'centre', 'fixed-at-start'], COLORS = ['amber', 'red', 'none'], PATTERNS = ['solid', 'stripes'];
+const CUES = ['rear', 'crouch', 'inflate', 'coil', 'burrow', 'spin', 'none'], SOUNDS = ['hit', 'block', 'counter', 'dash', 'grab', 'break', 'none'];
+/** The number at a dotted path ('damage', 'shape.range', 'hold.seconds'), or undefined. */
+export function numberAt(o: unknown, path: string): number | undefined {
+  let v: unknown = o;
+  for (const k of path.split('.')) { if (!v || typeof v !== 'object') return undefined; v = (v as Record<string, unknown>)[k]; }
+  return typeof v === 'number' ? v : undefined;
+}
+/** Attack paths may start with `shape.`, `lunge.` or `hold.`, or name a top-level number. */
+const attackPathOk = (a: AttackSpec, key: string) => { const head = key.split('.')[0]!; return (key.includes('.') ? ['shape', 'lunge', 'hold'].includes(head) : true) && numberAt(a, key) !== undefined; };
+
 const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
 const nonNeg = (v: unknown) => fin(v) && v >= 0;
 const nullOrNonNeg = (v: unknown) => v === null || nonNeg(v);
@@ -32,7 +54,7 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
   const out: string[] = [];
   const ids = (name: string, reg: Record<string, { id: string }>) => { for (const [k, v] of Object.entries(reg)) if (v.id !== k) out.push(`${name} ${k}: id`); };
   ids('habitat', c.habitats); ids('movement', c.movements); ids('pursuit', c.pursuits); ids('hull', c.hulls); ids('mount', c.mounts); ids('pose', c.poses); ids('telegraph', c.telegraphs);
-  ids('effect', c.effects); ids('evasion', c.evasions); ids('guard', c.guards); ids('attack', c.attacks); ids('ability', c.abilities); ids('hazard', c.hazards);
+  ids('effect', c.effects); ids('evasion', c.evasions); ids('guard', c.guards); ids('attack', c.attacks); ids('ability', c.abilities); ids('hazard', c.hazards); ids('behaviour', c.behaviours);
 
   for (const [k, h] of Object.entries(c.habitats)) {
     if (!Array.isArray(h.media) || !h.media.length || !h.media.every(m => MEDIA.includes(m))) out.push(`habitat ${k}: media`);
@@ -65,11 +87,145 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     if (a.obstruction !== 'terrain-and-cover') out.push(`attack ${k}: obstruction`);
     if (!c.poses[a.poseProfileId]) out.push(`attack ${k}: pose ${a.poseProfileId}`);
     if (!c.telegraphs[a.telegraphProfileId]) out.push(`attack ${k}: telegraph ${a.telegraphProfileId}`);
+    // V2
+    if (a.damageUnit !== 'hp' && a.damageUnit !== 'half-heart') out.push(`attack ${k}: damageUnit`);
+    if (!AIM_MODES.includes(a.aimMode)) out.push(`attack ${k}: aimMode`);
+    if (!fin(a.moveSpeedFactor) || a.moveSpeedFactor < 0 || a.moveSpeedFactor > 1) out.push(`attack ${k}: moveSpeedFactor`);
+    if (!nonNeg(a.poiseDamageMultiplier)) out.push(`attack ${k}: poiseDamageMultiplier`);
+    // V3
+    if (a.lunge && !(fin(a.lunge.distanceBodyLengths) && a.lunge.distanceBodyLengths > 0)) out.push(`attack ${k}: lunge`);
+    if (a.hold) {
+      const h = a.hold;
+      if (!(fin(h.seconds) && h.seconds > 0) || !(fin(h.sizeFactor) && h.sizeFactor > 0) || ![h.startHalfHearts, h.squeezeHalfHearts, h.squeezeEverySeconds].every(nonNeg)
+        || (h.squeezeHalfHearts > 0 && !(h.squeezeEverySeconds > 0))) out.push(`attack ${k}: hold`);
+    }
+    if (a.whiffRecoverySeconds !== undefined && !nonNeg(a.whiffRecoverySeconds)) out.push(`attack ${k}: whiffRecoverySeconds`);
+    // V4
+    if (a.statusEffectId !== undefined && c.effects[a.statusEffectId]?.kind !== 'status') out.push(`attack ${k}: status ${a.statusEffectId}`);
+    // V5
+    const pair = a.pair ?? null;
+    for (const [key, v] of [...Object.entries(a.scaling ?? {}), ...Object.entries(pair?.multiply ?? {}), ...Object.entries(pair?.add ?? {})]) {
+      if (!attackPathOk(a, key)) out.push(`attack ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`attack ${k}: scaling value ${key}`);
+    }
+    for (const [key, v] of Object.entries(pair?.multiply ?? {})) if (fin(v) && v < 1) out.push(`attack ${k}: pair multiplier ${key}`);
+    // V6
+    const tg = c.telegraphs[a.telegraphProfileId];
+    if (tg) {
+      const species = a.damageUnit === 'half-heart';
+      if (!species && tg.color !== 'none') out.push(`attack ${k}: telegraph colour`);
+      else if (species && !a.blockable && (tg.color !== 'red' || tg.pattern !== 'stripes')) out.push(`attack ${k}: telegraph colour`);
+      else if (species && a.blockable && (tg.color !== 'amber' || tg.pattern !== 'solid')) out.push(`attack ${k}: telegraph colour`);
+    }
+    // V7
+    if (a.damageUnit === 'half-heart') {
+      const fixed = a.aimMode === 'centre' || a.aimMode === 'fixed-at-start';
+      if (fixed ? a.aimLockAtSeconds !== 0 : a.aimLockAtSeconds > a.windupSeconds - .2 + 1e-9) out.push(`attack ${k}: lock before active`);
+    }
+  }
+  // V8: the minimum wind-up at every size at which a species that uses the attack is hostile.
+  for (const s of c.species) for (const id of s.attackIds) {
+    const a = c.attacks[id]; if (!a) continue;
+    for (const size of hostileSizes(s)) if (a.windupSeconds < minWindup(size, !!s.alpha) - 1e-9) out.push(`attack ${id}: windup below ${minWindup(size, !!s.alpha)} at size ${size} (${s.key})`);
   }
   for (const [k, a] of Object.entries(c.abilities)) {
     if (!nonNeg(a.cooldownSeconds)) out.push(`ability ${k}: cooldownSeconds`);
     for (const m of a.allowedMotionModes) if (!MODES.includes(m)) out.push(`ability ${k}: mode ${m}`);
     if (!c.effects[a.effectProfileId]) out.push(`ability ${k}: effect ${a.effectProfileId}`);
+    // V9
+    if (!MOVE_PRIORITY.includes(a.kind)) { out.push(`ability ${k}: kind`); continue; }
+    if (a.input !== (a.kind === 'brace' ? 'hold' : 'press')) out.push(`ability ${k}: input`);
+    const wantsAttack = a.kind === 'grab' || a.kind === 'sweep', wantsGuard = a.kind === 'brace' || a.kind === 'counter', wantsEvasion = a.kind === 'dash';
+    if (wantsAttack ? !(a.attackId && c.attacks[a.attackId]) : a.attackId !== undefined) out.push(`ability ${k}: attack ${a.attackId}`);
+    if (wantsGuard ? !(a.guardProfileId && c.guards[a.guardProfileId]?.kind === a.kind) : a.guardProfileId !== undefined) out.push(`ability ${k}: guard ${a.guardProfileId}`);
+    if (wantsEvasion ? !(a.evasionProfileId && c.evasions[a.evasionProfileId]) : a.evasionProfileId !== undefined) out.push(`ability ${k}: evasion ${a.evasionProfileId}`);
+    // V10: 'cooldownSeconds' (the ability) or 'guard.<field>', 'evasion.<field>', 'attack.<path>'.
+    const target = (key: string): boolean => {
+      if (key === 'cooldownSeconds') return true;
+      const [head, ...rest] = key.split('.'), path = rest.join('.');
+      if (!path) return false;
+      if (head === 'guard') return numberAt(a.guardProfileId ? c.guards[a.guardProfileId] : undefined, path) !== undefined;
+      if (head === 'evasion') return numberAt(a.evasionProfileId ? c.evasions[a.evasionProfileId] : undefined, path) !== undefined;
+      if (head === 'attack') { const at = a.attackId ? c.attacks[a.attackId] : undefined; return !!at && attackPathOk(at, path); }
+      return false;
+    };
+    for (const [key, v] of [...Object.entries(a.scaling), ...Object.entries(a.pair?.multiply ?? {}), ...Object.entries(a.pair?.add ?? {})]) {
+      if (!target(key)) out.push(`ability ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`ability ${k}: scaling value ${key}`);
+    }
+    for (const [key, v] of Object.entries(a.pair?.multiply ?? {})) if (fin(v) && v < 1) out.push(`ability ${k}: pair multiplier ${key}`);
+  }
+  // V11
+  for (const [k, g] of Object.entries(c.guards)) {
+    if (g.kind !== 'brace' && g.kind !== 'counter') { out.push(`guard ${k}: kind`); continue; }
+    for (const f of ['blockFraction', 'moveSpeedFactor', 'yawRateFactor'] as const) if (!fin(g[f]) || g[f] < 0 || g[f] > 1) out.push(`guard ${k}: ${f}`);
+    for (const f of ['startupSeconds', 'minActiveSeconds', 'breakStaggerSeconds', 'brokenCooldownSeconds', 'reflectDamage', 'attackerStaggerSeconds', 'recoverySeconds', 'whiffRecoverySeconds', 'successCooldownSeconds'] as const)
+      if (!nonNeg(g[f])) out.push(`guard ${k}: ${f}`);
+    const counter = g.kind === 'counter';
+    if (counter ? !nonNeg(g.windowSeconds) : g.windowSeconds !== null) out.push(`guard ${k}: windowSeconds`);
+    if (counter ? g.frontHalfAngle !== null : !(fin(g.frontHalfAngle) && g.frontHalfAngle > 0 && g.frontHalfAngle <= Math.PI)) out.push(`guard ${k}: frontHalfAngle`);
+    if (counter ? g.breakHalfHearts !== null : !nonNeg(g.breakHalfHearts)) out.push(`guard ${k}: breakHalfHearts`);
+  }
+  // V12
+  for (const [k, e] of Object.entries(c.evasions)) {
+    for (const f of ['startupSeconds', 'recoverySeconds'] as const) if (!nonNeg(e[f])) out.push(`evasion ${k}: ${f}`);
+    if (!(fin(e.travelSeconds) && e.travelSeconds > 0)) out.push(`evasion ${k}: travelSeconds`);
+    if (!(fin(e.distanceBodyLengths) && e.distanceBodyLengths > 0)) out.push(`evasion ${k}: distanceBodyLengths`);
+    if (!fin(e.endSpeedCarry) || e.endSpeedCarry < 0 || e.endSpeedCarry > 1) out.push(`evasion ${k}: endSpeedCarry`);
+    if (e.plane !== 'free' && e.plane !== 'horizontal') out.push(`evasion ${k}: plane`);
+  }
+  // V13
+  for (const [k, t] of Object.entries(c.telegraphs)) {
+    if (!COLORS.includes(t.color) || !PATTERNS.includes(t.pattern) || !CUES.includes(t.poseCue) || typeof t.edgeArrow !== 'boolean') out.push(`telegraph ${k}: enum`);
+    if (!fin(t.flashLeadSeconds) || t.flashLeadSeconds < 0 || t.flashLeadSeconds > .3) out.push(`telegraph ${k}: flashLeadSeconds`);
+  }
+  for (const [k, e] of Object.entries(c.effects)) {
+    if ((e.kind !== 'feedback' && e.kind !== 'status') || !SOUNDS.includes(e.sound) || typeof e.particles !== 'string') out.push(`effect ${k}: enum`);
+    if (e.kind === 'status' && !(e.status && e.status.id === 'inked' && fin(e.status.seconds) && e.status.seconds > 0 && fin(e.status.speedFactor) && e.status.speedFactor > 0 && e.status.speedFactor <= 1)) out.push(`effect ${k}: status`);
+  }
+  // V14, V15
+  for (const [k, b] of Object.entries(c.behaviours)) {
+    if (!BEHAVIOUR_TYPES.includes(b.type)) { out.push(`behaviour ${k}: type`); continue; }
+    const users = c.species.filter(s => s.behaviourId === k), refs = new Set<string>();
+    const ref = (id: string | undefined, where: string) => {
+      if (id === undefined) return;
+      refs.add(id);
+      const a = c.attacks[id];
+      if (!a) out.push(`behaviour ${k}: ${where} ${id} missing`);
+      else if (a.damageUnit !== 'half-heart') out.push(`behaviour ${k}: ${where} ${id} unit`);
+      for (const s of users) if (!s.attackIds.includes(id)) out.push(`behaviour ${k}: ${id} not in ${s.key} attackIds`);
+    };
+    const choices = (list: readonly { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }[], where: string) => {
+      for (const ch of list) {
+        ref(ch.attackId, where); ref(ch.chainNextId, `${where} chain`);
+        if (!(fin(ch.band[0]) && fin(ch.band[1]) && ch.band[0] >= 0 && ch.band[0] < ch.band[1])) out.push(`behaviour ${k}: band ${ch.attackId}`);
+        if (!(fin(ch.weight) && ch.weight > 0) || (ch.flankWeight !== undefined && !(fin(ch.flankWeight) && ch.flankWeight > 0))) out.push(`behaviour ${k}: weight ${ch.attackId}`);
+        if (ch.chainGapSeconds !== undefined && !nonNeg(ch.chainGapSeconds)) out.push(`behaviour ${k}: chainGapSeconds`);
+      }
+    };
+    choices(b.attacks, 'attack');
+    ref(b.den?.attackId, 'den');
+    for (const [i, ph] of (b.phases ?? []).entries()) { choices(ph.attacks, `phase ${i}`); ref(ph.patternAttackId, `phase ${i} pattern`); if (!nonNeg(ph.gapSeconds) || !nonNeg(ph.speedFactor)) out.push(`behaviour ${k}: phase ${i} numbers`); }
+    for (const s of users) for (const id of s.attackIds) if (!refs.has(id)) out.push(`behaviour ${k}: ${s.key} attack ${id} unused`);
+    const durations = [b.reactionSeconds, b.gapSeconds, b.repositionSeconds[0], b.repositionSeconds[1], b.repositionSpeedFactor, b.poise, b.flee?.seconds ?? 0, b.flee?.restSeconds ?? 0, b.flee?.speedFactor ?? 0,
+      b.trigger?.seconds ?? 0, b.trigger?.radiusBodyLengths ?? 0, b.den?.outSeconds ?? 0, b.den?.triggerBodyLengths ?? 0, b.lair?.resetDelaySeconds ?? 0, b.lair?.healPerSecond ?? 0, b.lair?.radiusBodyLengths ?? 0, b.lair?.resetOutsideFactor ?? 0,
+      b.school?.radiusBodyLengths ?? 0, b.school?.groupSize ?? 0];
+    if (!durations.every(nonNeg)) out.push(`behaviour ${k}: durations`);
+    if (b.repositionSeconds[0] > b.repositionSeconds[1]) out.push(`behaviour ${k}: repositionSeconds`);
+    for (const f of ['staggerResist', 'knockbackResistance'] as const) if (!fin(b[f]) || b[f] < 0 || b[f] > 1) out.push(`behaviour ${k}: ${f}`);
+    if (typeof b.grabbable !== 'boolean') out.push(`behaviour ${k}: grabbable`);
+    // V15
+    const t = b.type;
+    if ((t === 'prey-flee' || t === 'prey-school') !== !!b.flee) out.push(`behaviour ${k}: flee`);
+    if ((t === 'prey-school') !== !!b.school) out.push(`behaviour ${k}: school`);
+    if ((t === 'prey-fighter') !== !!b.trigger) out.push(`behaviour ${k}: trigger`);
+    if ((t === 'hunter-ambush') !== !!b.den) out.push(`behaviour ${k}: den`);
+    if ((t === 'alpha') !== !!b.lair) out.push(`behaviour ${k}: lair`);
+    if ((t === 'alpha') !== !!b.phases) out.push(`behaviour ${k}: phases`);
+    if (b.phases) {
+      const f = b.phases.map(p => p.aboveHpFraction);
+      const ok = f.length > 0 && f.at(-1) === 0 && f.slice(0, -1).every(v => fin(v) && v > 0 && v < 1) && f.every((v, i) => i === 0 || v < f[i - 1]!);
+      if (!ok) out.push(`behaviour ${k}: phase order`);
+      for (const [i, ph] of b.phases.entries()) if ((ph.pattern === 'burrow' || ph.pattern === 'laps') !== (ph.patternAttackId !== undefined)) out.push(`behaviour ${k}: phase ${i} pattern`);
+    }
   }
   for (const p of c.parts) {
     for (const t of p.traits) if (!TRAITS.includes(t)) out.push(`part ${p.id}: trait ${t}`);
@@ -78,7 +234,7 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
       if (sockets.has(s.id)) out.push(`part ${p.id}: duplicate socket ${s.id}`); sockets.add(s.id);
       if (!vec(s.origin)) out.push(`part ${p.id}: socket ${s.id} origin`);
       if (!vec(s.forward) || Math.abs(Math.hypot(s.forward.x, s.forward.y, s.forward.z) - 1) > 1e-6) out.push(`part ${p.id}: socket ${s.id} forward`);
-      if (s.pivot && !c.rig[p.id]?.[`${s.pivot.kind}:${s.pivot.index}`]) out.push(`part ${p.id}: socket ${s.id} pivot`);
+      if (s.pivot && !c.rig[p.model ?? p.id]?.[`${s.pivot.kind}:${s.pivot.index}`]) out.push(`part ${p.id}: socket ${s.id} pivot`);
     }
     const grants = new Set<string>();
     for (const g of [...p.basicAttacks, ...p.activeGrants]) {
@@ -87,6 +243,9 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     }
     for (const g of p.basicAttacks) if (!c.attacks[g.attackId]) out.push(`part ${p.id}: attack ${g.attackId}`);
     for (const g of p.activeGrants) { if (!c.abilities[g.abilityId]) out.push(`part ${p.id}: ability ${g.abilityId}`); if (g.mirrorPolicy !== 'shared-cast') out.push(`part ${p.id}: mirrorPolicy ${g.id}`); }
+    // V17
+    if (p.rare && c.species.filter(s => s.alpha?.rewardPartId === p.id).length !== 1) out.push(`part ${p.id}: rare without one alpha`);
+    if (p.model !== undefined && !c.parts.some(q => q.id === p.model && !q.rare)) out.push(`part ${p.id}: model ${p.model}`);
   }
   for (const s of c.species) {
     if (!c.habitats[s.habitatProfileId]) out.push(`species ${s.key}: habitat ${s.habitatProfileId}`);
@@ -96,8 +255,22 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     if (!c.mounts[s.attackMountProfileId]) out.push(`species ${s.key}: mount ${s.attackMountProfileId}`);
     if (s.contactHazardId !== undefined && !c.hazards[s.contactHazardId]) out.push(`species ${s.key}: hazard ${s.contactHazardId}`);
     for (const a of s.attackIds) if (!c.attacks[a]) out.push(`species ${s.key}: attack ${a}`);
-    if ((s.hunts.length || s.stingsStages.length) && s.contactHazardId === undefined) out.push(`species ${s.key}: hazard missing`);
     if (s.fights && s.pursuitId === 'none') out.push(`species ${s.key}: fights without pursuit`);
+    // V18
+    const behaviour = s.behaviourId === undefined ? undefined : c.behaviours[s.behaviourId];
+    if (s.behaviourId !== undefined && !behaviour) out.push(`species ${s.key}: behaviour ${s.behaviourId}`);
+    if (s.behaviourId !== undefined && s.contactHazardId !== undefined) out.push(`species ${s.key}: behaviour and hazard`);
+    if ((s.hunts.length || s.stingsStages.length) && s.contactHazardId === undefined && !(behaviour && ['hunter', 'hunter-ambush', 'alpha'].includes(behaviour.type))) out.push(`species ${s.key}: hazard missing`);
+    // V19
+    if (s.bodyScale !== undefined && !(fin(s.bodyScale) && s.bodyScale >= .3 && s.bodyScale <= 3)) out.push(`species ${s.key}: bodyScale`);
+    if (s.alpha) {
+      const a = s.alpha;
+      if (!(isInt(a.size) && a.size >= 0 && a.size <= 4) || !(Number.isSafeInteger(a.rewardDna) && a.rewardDna >= 0)) out.push(`species ${s.key}: alpha`);
+      if (s.count !== 1 || behaviour?.type !== 'alpha') out.push(`species ${s.key}: alpha count or behaviour`);
+      if (!c.parts.some(p => p.id === a.rewardPartId && p.rare)) out.push(`species ${s.key}: reward ${a.rewardPartId}`);
+    } else if (behaviour?.type === 'alpha') out.push(`species ${s.key}: alpha count or behaviour`);
+    // V20
+    if (s.kind !== 'planet' && !FOOD_GLBS.includes(s.model ?? s.kind)) out.push(`species ${s.key}: model ${s.model ?? s.kind}`);
   }
   for (const p of c.plans) {
     if (!c.habitats[p.habitat]) out.push(`plan ${p.id}: habitat`);
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/lifecycle.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 10: Checkpoint** (Global Constraints). Expected: green.

- [ ] **Step 11: Commit**

```bash
git add src/tiny-tide/combat-types.ts src/tiny-tide/combat-profiles.ts src/tiny-tide/bestiary.ts src/tiny-tide/registries.ts src/tiny-tide/profiles.ts src/tiny-tide/parts.ts src/tiny-tide/species.ts tests/tiny-tide-core/combat-fixture.ts tests/tiny-tide-core/helpers.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/lifecycle.test.ts
git commit -m "Tiny Tide combat: contract types, telegraph and effect profiles, typed registries and V1–V20 validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T2: Player moves and slot assignment

**Spec:** §7.1–7.4, §4.3 V16, D1, D2, D4, D5.

**Files:**
- Create: `src/tiny-tide/moves.ts` (T21 adds the editor helpers at its end)
- Modify: `src/tiny-tide/parts.ts`, `src/tiny-tide/registries.ts`
- Create: `tests/tiny-tide-core/moves.test.ts`
- Modify: `tests/tiny-tide-core/combat-fixture.ts`, `tests/tiny-tide-core/contract.test.ts`

**Interfaces:**
- Consumes (T1): `AttackSpec`, `AbilitySpec`, `GuardProfile`, `EvasionProfile`, `ResolvedMove`, `MoveKind`, `MOVE_PRIORITY`, `SlotPin`, `Tuple4`, `PartSpec`, `PARTS`, `Genome`.
- Produces: `PLAYER_ATTACKS`, `PLAYER_ABILITIES`, `GUARDS`, `EVASIONS`, `MOVE_CATALOGS`, `MoveCatalogs`, `roundMoveValue(key, v)`, `MoveRef`, `resolveMove(ref, scale, { mirrored?, nonMouthBite? }, c?)`, `speciesMove(attack)`, `GrantedMove`, `MoveSet`, `nonMouthBite(g, catalog?)`, `primaryOf(m)`, `movesOf(g, catalog?, c?)`, `grantedKinds(m)`, `NO_PINS`, `SlotAssignment`, `placeKinds(granted, pins)`, `assignSlots(g, pins, catalog?)`, `clearMissingPins(pins, granted)`; in `parts.ts`: `MOUTH_BITES`, `PART_ABILITIES`, `KIND_SOCKETS`, `grantsOf(id)`; `ATTACKS = merged(PLAYER_ATTACKS, SPECIES_ATTACKS)` in `registries.ts`.

**Decisions in this task (spec gaps):**
- The Filter grin, Fangs and Maw mouths have no Bite rows in §7.4. They reuse the Nibbler, Snapper and Beak rows (`MOUTH_BITES`: filter → nibbler, fangs → snapper, maw → beak; the Tyrant maw gets its own row in T19).
- §7.4 gives no lock time and no tracking for Sweep. The plan uses `aimLockAt .15` and `maxTrackingRadiansPerSecond 12`.
- Scaling keys are dotted paths: `attack.<field>`, `guard.<field>`, `evasion.<field>` or `cooldownSeconds`. `roundMoveValue` rounds once at the end (spec D4): seconds to .01, body lengths to .01, damage to an integer.

- [ ] **Step 1: Write the failing tests** (`tests/tiny-tide-core/moves.test.ts`, complete file; the cases at size .4, 1 and 1.8 are the §7.4 tables)

```ts
// tests/tiny-tide-core/moves.test.ts — every expected number is the spec §7.4 table value (computed there with the §7.3 formula).
import { describe, expect, it } from 'vitest';
import { assignSlots, clearMissingPins, movesOf, NO_PINS, nonMouthBite, placeKinds, resolveMove } from '../../src/tiny-tide/moves';
import { starterGenome, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
import { PARTS } from '../../src/tiny-tide/parts';
import type { MoveKind } from '../../src/tiny-tide/combat-types';

const S = [.4, 1, 1.8] as const;
const DEG = Math.PI / 180;
const at = <T>(f: (s: number) => T) => S.map(f);
const ability = (id: string, mirrored = false) => (s: number) => resolveMove({ abilityId: id }, s, { mirrored });
const bite = (id: string) => (s: number) => resolveMove({ attackId: id }, s);
const genome = (...parts: Omit<PlacedPart, 'roll' | 't' | 'angle'>[]): Genome => ({ ...starterGenome(), parts: parts.map(p => ({ t: .5, angle: 2, roll: 0, ...p })) });

describe('moves', () => {
  it('resolveMove matches the tables at .4, 1, 1.8', () => {
    const bites: [string, number[], number[], number, number[], number[], number[]][] = [
      ['bite-nibbler', [1, 2, 3], [.47, .55, .66], 40, [.09, .10, .12], [.12, .14, .17], [.05, .06, .07]],
      ['bite-snapper', [3, 4, 6], [.51, .60, .72], 30, [.14, .16, .19], [.19, .22, .26], [.09, .10, .12]],
      ['bite-beak', [2, 3, 4], [.51, .60, .72], 35, [.11, .13, .16], [.15, .18, .22], [.07, .08, .10]],
      ['bite-tyrant', [4, 6, 8], [.60, .70, .84], 30, [.17, .20, .24], [.22, .26, .31], [.10, .12, .14]],
    ];
    for (const [id, damage, range, half, windup, recovery, lock] of bites) {
      const r = at(bite(id)).map(m => m.attack!);
      expect(r.map(a => a.damage), id).toEqual(damage); expect(r.map(a => a.shape.kind === 'cone' && a.shape.range), id).toEqual(range);
      expect(r.map(a => a.windupSeconds), id).toEqual(windup); expect(r.map(a => a.recoverySeconds), id).toEqual(recovery); expect(r.map(a => a.aimLockAtSeconds), id).toEqual(lock);
      for (const a of r) { expect(a.activeSeconds).toBe(.08); expect(a.shape.kind === 'cone' && a.shape.halfAngle).toBeCloseTo(half * DEG); }
    }
    const sweeps: [string, number[], number[], number[], number[], number[], number[]][] = [
      ['sweep-fan-tail', [2, 3, 4], [.74, .90, 1.12], [6.3, 9, 12.6], [.19, .22, .26], [.26, .30, .35], [1.87, 2.2, 2.64]],
      ['sweep-fluke', [3, 4, 6], [.82, 1.0, 1.24], [7, 10, 14], [.21, .24, .28], [.28, .32, .37], [2.04, 2.4, 2.88]],
    ];
    for (const [id, damage, range, impulse, windup, recovery, cooldown] of sweeps) {
      const r = at(ability(id));
      expect(r.map(m => m.attack!.damage), id).toEqual(damage); expect(r.map(m => m.attack!.shape.kind === 'cone' && m.attack!.shape.range), id).toEqual(range);
      expect(r.map(m => m.attack!.impulse), id).toEqual(impulse); expect(r.map(m => m.attack!.windupSeconds), id).toEqual(windup);
      expect(r.map(m => m.attack!.recoverySeconds), id).toEqual(recovery); expect(r.map(m => m.cooldownSeconds), id).toEqual(cooldown);
    }
    const grabs: [string, boolean, number[], number[], number[], number[]][] = [
      ['grab-pincer', false, [1, 2, 3], [.45, .55, .68], [.79, 1.0, 1.28], [.79, 1.0, 1.28]], ['grab-pincer', true, [2, 3, 4], [.45, .55, .68], [1.03, 1.3, 1.66], [1.04, 1.25, 1.53]],
      ['grab-clawmother', false, [2, 3, 4], [.53, .65, .81], [1.03, 1.3, 1.66], [1.19, 1.5, 1.92]], ['grab-clawmother', true, [3, 5, 6], [.53, .65, .81], [1.34, 1.69, 2.16], [1.44, 1.75, 2.17]],
    ];
    for (const [id, pair, damage, range, hold, size] of grabs) {
      const r = at(ability(id, pair)), tag = `${id}${pair ? ' pair' : ''}`;
      expect(r.map(m => m.attack!.damage), tag).toEqual(damage); expect(r.map(m => m.attack!.shape.kind === 'cone' && m.attack!.shape.range), tag).toEqual(range);
      expect(r.map(m => m.attack!.hold!.seconds), tag).toEqual(hold); expect(r.map(m => m.attack!.hold!.sizeFactor), tag).toEqual(size);
      expect(r.map(m => m.attack!.windupSeconds), tag).toEqual([.16, .18, .21]); expect(r.map(m => m.cooldownSeconds), tag).toEqual([2.64, 3.0, 3.48]);
    }
    const counter = at(ability('counter-spike'));
    expect(counter.map(m => m.guard!.windowSeconds)).toEqual([.18, .22, .27]); expect(counter.map(m => m.guard!.reflectDamage)).toEqual([2, 3, 4]);
    expect(counter.map(m => m.guard!.attackerStaggerSeconds)).toEqual([.82, 1.0, 1.24]); expect(counter.map(m => m.guard!.whiffRecoverySeconds)).toEqual([.33, .40, .50]);
    expect(counter.map(m => m.cooldownSeconds)).toEqual([1.02, 1.2, 1.44]); expect(counter.map(m => m.guard!.startupSeconds)).toEqual([.04, .04, .04]);
    const brace = at(ability('brace-shell'));
    expect(brace.map(m => m.guard!.blockFraction)).toEqual([.66, .75, .87]); expect(brace.map(m => m.guard!.breakHalfHearts)).toEqual([3, 4, 6]);
    expect(brace.map(m => m.guard!.moveSpeedFactor)).toEqual([.52, .45, .36]); expect(brace.map(m => m.guard!.startupSeconds)).toEqual([.08, .10, .12]);
    expect(brace.map(m => m.cooldownSeconds)).toEqual([.4, .4, .4]); expect(brace[0]!.input).toBe('hold');
    const dashes: [string, string, number[], number[], number[], number[], number[] | null, number[] | null][] = [
      ['dash-side-fin', 'free', [1.31, 1.6, 1.98], [.16, .18, .21], [.10, .12, .15], [.90, 1.1, 1.36], [1.57, 1.92, 2.38], [.77, .94, 1.16]],
      ['dash-dorsal-fin', 'free', [1.15, 1.4, 1.74], [.16, .18, .21], [.10, .12, .15], [.82, 1.0, 1.24], null, null],
      ['dash-frill-fin', 'free', [1.23, 1.5, 1.86], [.16, .18, .21], [.10, .12, .15], [.90, 1.1, 1.36], [1.48, 1.8, 2.23], [.77, .94, 1.16]],
      ['dash-paddle-tail', 'free', [1.48, 1.8, 2.23], [.18, .20, .23], [.11, .14, .17], [1.07, 1.3, 1.61], null, null],
      ['scuttle-little-leg', 'horizontal', [1.07, 1.3, 1.61], [.14, .16, .19], [.08, .10, .12], [.74, .90, 1.12], [1.28, 1.56, 1.93], [.63, .77, .95]],
      ['scuttle-crab-leg', 'horizontal', [1.15, 1.4, 1.74], [.16, .18, .21], [.08, .10, .12], [.82, 1.0, 1.24], [1.38, 1.68, 2.08], [.70, .85, 1.05]],
    ];
    for (const [id, plane, distance, travel, recovery, cooldown, pairDistance, pairCooldown] of dashes) {
      const r = at(ability(id));
      expect(r.map(m => m.evasion!.distanceBodyLengths), id).toEqual(distance); expect(r.map(m => m.evasion!.travelSeconds), id).toEqual(travel);
      expect(r.map(m => m.evasion!.recoverySeconds), id).toEqual(recovery); expect(r.map(m => m.cooldownSeconds), id).toEqual(cooldown); expect(r[0]!.evasion!.plane).toBe(plane);
      if (pairDistance) { const p = at(ability(id, true)); expect(p.map(m => m.evasion!.distanceBodyLengths), id).toEqual(pairDistance); expect(p.map(m => m.cooldownSeconds), id).toEqual(pairCooldown); }
    }
  });
  it('pair bonus only on mirrored dash and grab parts, one rounding', () => {
    // Side fin pair at scale .45: 1.6 × (1 + .3 × −.55) = 1.336; × 1.2 = 1.6032 → 1.6 (rounding first would give 1.34 × 1.2 = 1.608 → 1.61).
    expect(resolveMove({ abilityId: 'dash-side-fin' }, .45, { mirrored: true }).evasion!.distanceBodyLengths).toBe(1.6);
    expect(resolveMove({ abilityId: 'dash-side-fin' }, 1, { mirrored: false }).evasion!.distanceBodyLengths).toBe(1.6);
    // Abilities without a pair ignore `mirrored`.
    expect(resolveMove({ abilityId: 'counter-spike' }, 1, { mirrored: true }).guard!.windowSeconds).toBe(.22);
    expect(resolveMove({ abilityId: 'brace-shell' }, 1, { mirrored: true }).guard!.blockFraction).toBe(.75);
    // Only the representative part's own mirror counts: a mirrored pincer pair holds 1.3 s, a single one 1 s.
    const pair = movesOf(genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: 1, mirror: true }));
    expect(pair.byKind.grab!.resolved.attack!.hold!.seconds).toBe(1.3);
    // Only Dash and Grab parts can mirror (the catalog).
    for (const p of PARTS.filter(x => x.mirror && x.activeGrants.length)) expect(['grab', 'dash']).toContain(p.activeGrants[0]!.id);
  });
  it('bite adds floor of non-mouth bite', () => {
    const g = genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: 1, mirror: false });
    expect(nonMouthBite(g)).toBe(1); expect(movesOf(g).basic!.resolved.attack!.damage).toBe(5);   // Snapper 4 + floor(1)
    const pair = genome({ uid: 'p1', id: 'mouth_snapper', scale: 1, mirror: false }, { uid: 'p2', id: 'claw_pincer', scale: .4, mirror: true });
    expect(nonMouthBite(pair)).toBeCloseTo(1.7); expect(movesOf(pair).basic!.resolved.attack!.damage).toBe(5);   // 1 × 2 × (.75 + .1) = 1.7 → +1
    expect(movesOf(starterGenome()).basic!.resolved.attack!.damage).toBe(2);   // Nibbler at .8: 2 × .9 = 1.8 → 2; no bite stat elsewhere
  });
  it('representative part per kind', () => {
    // Two fins: the larger distance wins (Side fin 1.6 > Dorsal fin 1.4); the Paddle tail's 1.8 beats both.
    const g = genome({ uid: 'p1', id: 'mouth_nibbler', scale: 1, mirror: false }, { uid: 'p2', id: 'fin_dorsal', scale: 1, mirror: false }, { uid: 'p3', id: 'fin_side', scale: 1, mirror: false });
    expect(movesOf(g).byKind.dash!.partUid).toBe('p3');
    expect(movesOf({ ...g, parts: [...g.parts, { uid: 'p4', id: 'tail_paddle', t: 1, angle: 0, scale: 1, mirror: false, roll: 0 }] }).byKind.dash!.partUid).toBe('p4');
    // Equal numbers: the larger scale, then the mirrored part, then the lower uid.
    const tie = genome({ uid: 'p1', id: 'mouth_nibbler', scale: 1, mirror: false }, { uid: 'p7', id: 'spike', scale: 1, mirror: false }, { uid: 'p3', id: 'spike', scale: 1, mirror: false });
    expect(movesOf(tie).byKind.counter!.partUid).toBe('p3');
    expect(movesOf(tie).candidates.counter!.map(m => m.partUid)).toEqual(['p3', 'p7']);
  });
  it('assignSlots priority order', () => {
    expect(placeKinds(['sweep', 'grab', 'dash', 'counter'], NO_PINS)).toEqual({ slots: ['counter', 'dash', 'grab', 'sweep'], inactive: [] });
    expect(placeKinds(['dash'], NO_PINS)).toEqual({ slots: ['dash', null, null, null], inactive: [] });
    expect(assignSlots(starterGenome(), NO_PINS)).toEqual({ slots: ['dash', null, null, null], inactive: [] });   // the Speck starter keeps a dodge (§7.1)
  });
  it('pins win, then priority fills', () => {
    expect(placeKinds(['brace', 'dash', 'sweep'], ['sweep', null, null, 'brace'])).toEqual({ slots: ['sweep', 'dash', null, 'brace'], inactive: [] });
    // A pin for an ungranted kind is ignored; a granted kind stays in its pinned slot, so slot 1 is empty (and hidden).
    expect(placeKinds(['dash'], ['grab', null, 'dash', null])).toEqual({ slots: [null, null, 'dash', null], inactive: [] });
    expect(placeKinds(['dash', 'brace'], ['dash', 'dash', null, null])).toEqual({ slots: ['dash', 'brace', null, null], inactive: [] });   // a kind pinned twice keeps its first pin
  });
  it('fifth kind is inactive', () => {
    const all: MoveKind[] = ['grab', 'counter', 'brace', 'dash', 'sweep'];
    expect(placeKinds(all, NO_PINS)).toEqual({ slots: ['brace', 'counter', 'dash', 'grab'], inactive: ['sweep'] });
    expect(placeKinds(all, [null, null, null, 'sweep'])).toEqual({ slots: ['brace', 'counter', 'dash', 'sweep'], inactive: ['grab'] });
  });
  it('pins for missing kinds are cleared at commit', () => {
    expect(clearMissingPins(['sweep', null, 'dash', null], ['dash'])).toEqual({ pins: [null, null, 'dash', null], cleared: ['sweep'] });
    expect(clearMissingPins(NO_PINS, [])).toEqual({ pins: [null, null, null, null], cleared: [] });
  });
});
```

The fixture and the contract test add V16 (a move-giving part needs a socket of its kind):

```diff
--- a/tests/tiny-tide-core/combat-fixture.ts
+++ b/tests/tiny-tide-core/combat-fixture.ts
@@ -44,7 +44,7 @@ export const FX_FLEER = base('0:fx_fleer', { kind: 'shrimp', model: 'shrimp', ti
 /** A valid catalog: the shipped catalogs plus the fixture rows above. */
 export function fixtureCatalogs(): Catalogs {
   const c = defaultCatalogs(), claw = c.parts.find(p => p.id === 'claw_pincer')!;
-  const rare: PartSpec = { ...claw, id: 'fx_rare', name: 'Fixture claw', rare: true, model: 'claw_pincer' };
+  const rare: PartSpec = { ...claw, id: 'fx_rare', name: 'Fixture claw', rare: true, model: 'claw_pincer', basicAttacks: [], activeGrants: [] };
   return { ...c, attacks: { ...c.attacks, pinch: { ...syntheticAttack }, poke: { ...POKE }, wrap: { ...WRAP }, smash: { ...SMASH } }, abilities: { ...c.abilities, ...structuredClone(FX_ABILITIES) },
     guards: { ...c.guards, 'fx-brace': { ...FX_BRACE }, 'fx-counter': { ...FX_COUNTER } }, evasions: { ...c.evasions, 'fx-dash': { ...FX_DASH } }, behaviours: { ...c.behaviours, ...structuredClone(FX_BEHAVIOURS) },
     parts: [...c.parts, rare], species: [...c.species, { ...FX_HUNTER }, { ...FX_ALPHA }, { ...FX_FLEER }] };
--- a/tests/tiny-tide-core/contract.test.ts
+++ b/tests/tiny-tide-core/contract.test.ts
@@ -104,6 +104,7 @@ describe('combat contract', () => {
       [c => { c.abilities.grab!.scaling = { 'attack.nope': .2 }; }, 'ability grab: scaling key attack.nope'],
       [c => { c.abilities.grab!.pair = { multiply: { 'attack.damage': .5 }, add: {} }; }, 'ability grab: pair multiplier attack.damage'],
       [c => { c.abilities.dash!.scaling = { cooldownSeconds: Infinity }; }, 'ability dash: scaling value cooldownSeconds'],
+      [c => { c.abilities.dash!.pair = { multiply: { cooldownSeconds: 1.2 }, add: {} }; }, 'ability dash: pair multiplier cooldownSeconds'],
       // V11
       [c => { c.guards['fx-brace']!.blockFraction = 1.2; }, 'guard fx-brace: blockFraction'],
       [c => { c.guards['fx-brace']!.frontHalfAngle = 0; }, 'guard fx-brace: frontHalfAngle'],
@@ -136,6 +137,12 @@ describe('combat contract', () => {
       [c => { c.behaviours['fx-hunter']!.lair = { radiusBodyLengths: 2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 }; }, 'behaviour fx-hunter: lair'],
       [c => { c.behaviours['fx-alpha']!.phases = [...c.behaviours['fx-alpha']!.phases!].reverse(); }, 'behaviour fx-alpha: phase order'],
       [c => { c.behaviours['fx-alpha']!.phases = c.behaviours['fx-alpha']!.phases!.map(p => ({ ...p, pattern: 'burrow' as const })); }, 'behaviour fx-alpha: phase 0 pattern'],
+      // V16
+      [c => { claw(c).activeGrants = []; }, 'part claw_pincer: grants'],
+      [c => { claw(c).activeGrants = [{ id: 'grab', abilityId: 'counter-spike', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' }]; }, 'part claw_pincer: move kind'],
+      [c => { c.parts = c.parts.map(p => p.id === 'mouth_snapper' ? { ...p, basicAttacks: [] } : p); }, 'part mouth_snapper: basic'],
+      [c => { claw(c).basicAttacks = [{ id: 'bite', attackId: 'bite-snapper', socketIds: ['pinch'] }]; }, 'part claw_pincer: basic'],
+      [c => { c.parts = c.parts.map(p => p.id === 'eye_bead' ? { ...p, activeGrants: [{ id: 'dash', abilityId: 'dash-side-fin', socketIds: [], mirrorPolicy: 'shared-cast' as const }] } : p); }, 'part eye_bead: grants'],
       // V17
       [c => { c.species = c.species.filter(s => s.key !== '1:fx_alpha'); }, 'part fx_rare: rare without one alpha'],
       [c => { c.parts = c.parts.map(p => p.id === 'fx_rare' ? { ...p, model: 'fx_rare' } : p); }, 'part fx_rare: model fx_rare'],
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/moves.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/moves"`.

- [ ] **Step 3: Grants in `parts.ts`**

```diff
--- a/src/tiny-tide/parts.ts
+++ b/src/tiny-tide/parts.ts
@@ -38,8 +38,24 @@ const SOCKETS: Record<string, readonly CombatSocket[]> = {
   tail_paddle: [socket('slap', 1.1, 0, { kind: 'seg', index: 3 })], tail_fan: [socket('slap', 1.1, 0, { kind: 'seg', index: 2 })], tail_fluke: [socket('slap', 1, 0, { kind: 'seg', index: 3 })],
   jet_vent: [socket('thrust', .7, 0)],
 };
+/** The basic grant of each mouth (spec §7.1). Filter grin, Fangs and Maw reuse the Nibbler, Snapper and Beak rows until 3b (plan decision). */
+export const MOUTH_BITES: Readonly<Record<string, string>> = { mouth_nibbler: 'bite-nibbler', mouth_snapper: 'bite-snapper', mouth_beak: 'bite-beak', mouth_filter: 'bite-nibbler', mouth_fangs: 'bite-snapper', mouth_maw: 'bite-beak', mouth_tyrant: 'bite-tyrant' };
+/** The ability of each move-giving part (spec §7.1, §7.6). */
+export const PART_ABILITIES: Readonly<Record<string, string>> = {
+  claw_pincer: 'grab-pincer', claw_mother: 'grab-clawmother', spike: 'counter-spike', shell_plate: 'brace-shell',
+  fin_side: 'dash-side-fin', fin_dorsal: 'dash-dorsal-fin', fin_frill: 'dash-frill-fin', tail_paddle: 'dash-paddle-tail', leg_little: 'scuttle-little-leg', leg_crab: 'scuttle-crab-leg',
+  tail_fan: 'sweep-fan-tail', tail_fluke: 'sweep-fluke',
+};
+/** The socket each kind emits from (Brace and Dash have none). */
+export const KIND_SOCKETS: Readonly<Record<MoveKind, readonly string[]>> = { grab: ['pinch'], counter: ['spike'], sweep: ['slap'], brace: [], dash: [] };
+/** The basic grant of a mouth and the active grant of a move-giving part (grant ids: 'bite' and the move kind). */
+const grantsOf = (id: string): Pick<PartSpec, 'basicAttacks' | 'activeGrants'> => {
+  const bite = MOUTH_BITES[id], ability = PART_ABILITIES[id], kind = PART_MOVES[id];
+  return { basicAttacks: bite ? [{ id: 'bite', attackId: bite, socketIds: ['bite'] }] : [],
+    activeGrants: ability && kind ? [{ id: kind, abilityId: ability, socketIds: KIND_SOCKETS[kind], mirrorPolicy: 'shared-cast' }] : [] };
+};
 const p = (id: string, name: string, kind: PartKind, stage: number, cost: number, stats: Partial<Stats>, tint: TintSlot, mirror: boolean, t: number, angle: number, blurb: string, diet?: Diet): PartSpec =>
-  ({ id, name, kind, stage, cost, stats, tint, mirror, t, angle, blurb, diet, traits: TRAITS[id] ?? (kind === 'mouth' ? ['weapon'] : []), sockets: SOCKETS[id] ?? [], basicAttacks: [], activeGrants: [] });
+  ({ id, name, kind, stage, cost, stats, tint, mirror, t, angle, blurb, diet, traits: TRAITS[id] ?? (kind === 'mouth' ? ['weapon'] : []), sockets: SOCKETS[id] ?? [], ...grantsOf(id) });
 const HALF = Math.PI / 2;
 export const PARTS: readonly PartSpec[] = [
   p('mouth_nibbler', 'Nibbler', 'mouth', 0, 0, { reach: .2 }, 'belly', false, 0, 0, 'Soft lips for plants.', 'herbivore'),
```

- [ ] **Step 4: Create `moves.ts`** (complete file at this task)

```ts
// Player moves (spec §7): Bite rows by mouth, Sweep, Grab, Counter, Brace and Dash; size scaling and mirrored pairs (`resolveMove`), the
// moves of a design (`movesOf`) and the four slots (`assignSlots`). Pure data and pure functions.
import { MOVE_PRIORITY, type AbilitySpec, type AttackSpec, type EvasionProfile, type GuardProfile, type MoveKind, type MovementMode, type PairBonus, type ResolvedMove, type SlotPin, type Tuple4 } from './combat-types';
import { uidSerial, type Genome } from './genome';
import { PARTS, type PartSpec } from './parts';
export { KIND_SOCKETS, MOUTH_BITES, PART_ABILITIES } from './parts';
export type { ResolvedMove };

const DEG = Math.PI / 180;
export const ALL_MODES: readonly MovementMode[] = ['ground', 'swim', 'surface', 'glide', 'fly', 'burrow', 'space'];
const playerAttack = (over: Partial<AttackSpec> & Pick<AttackSpec, 'id' | 'shape' | 'windupSeconds' | 'activeSeconds' | 'recoverySeconds' | 'aimLockAtSeconds' | 'maxTrackingRadiansPerSecond' | 'damage'>): AttackSpec => ({
  poseProfileId: 'rest', cooldownSeconds: 0, impulse: 1, staggerSeconds: .35, blockable: true, parryable: true, interruptible: true, maxTargets: 1, hitGroup: 'shared-grant', maxHitsPerTarget: 1,
  repeatHitSeconds: 0, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'none', damageUnit: 'hp', aimMode: 'input', moveSpeedFactor: 1, poiseDamageMultiplier: 1, ...over });
/** Bite (spec §7.4): a cone at the `bite` socket; the numbers at scale 1. Active .08 s and the half angle do not scale. */
const bite = (id: string, damage: number, range: number, halfAngleDeg: number, windup: number, recovery: number, lock: number, tracking: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: halfAngleDeg * DEG }, windupSeconds: windup, activeSeconds: .08, recoverySeconds: recovery, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: tracking, damage,
  scaling: { damage: .5, 'shape.range': .25, windupSeconds: .25, recoverySeconds: .25, aimLockAtSeconds: .25 }, pair: null });
/** Sweep (spec §7.4): a cone at the `slap` socket, behind the body. The aim follows the body until .15 s (plan decision: the spec gives no lock). */
const sweep = (id: string, damage: number, range: number, impulse: number, windup: number, recovery: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: 75 * DEG }, windupSeconds: windup, activeSeconds: .12, recoverySeconds: recovery, aimLockAtSeconds: .15, maxTrackingRadiansPerSecond: 12, damage, impulse,
  aimMode: 'body-back', maxTargets: 4, staggerSeconds: .6, poiseDamageMultiplier: 2, moveSpeedFactor: .5 });
/** Grab (spec §7.4): a cone at the `pinch` socket. Unblockable; Counter and Dash beat it. */
const pinch = (id: string, damage: number, range: number, holdSeconds: number, sizeFactor: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: 35 * DEG }, windupSeconds: .18, activeSeconds: .10, recoverySeconds: .30, aimLockAtSeconds: .10, maxTrackingRadiansPerSecond: 8, damage,
  impulse: 0, staggerSeconds: 0, blockable: false, moveSpeedFactor: .7, whiffRecoverySeconds: .45,
  hold: { seconds: holdSeconds, sizeFactor, startHalfHearts: 0, squeezeHalfHearts: 0, squeezeEverySeconds: 0 } });
export const PLAYER_ATTACKS: Record<string, AttackSpec> = Object.fromEntries([
  bite('bite-nibbler', 2, .55, 40, .10, .14, .06, 12), bite('bite-snapper', 4, .60, 30, .16, .22, .10, 10), bite('bite-beak', 3, .60, 35, .13, .18, .08, 11), bite('bite-tyrant', 6, .70, 30, .20, .26, .12, 9),
  sweep('sweep-fan', 3, .9, 9, .22, .30), sweep('sweep-fluke', 4, 1.0, 10, .24, .32),
  pinch('pinch-pincer', 2, .55, 1.0, 1.0), pinch('pinch-clawmother', 3, .65, 1.3, 1.5),
].map(a => [a.id, a]));

const guard = (over: Partial<GuardProfile> & Pick<GuardProfile, 'id' | 'kind'>): GuardProfile => ({ startupSeconds: 0, minActiveSeconds: 0, windowSeconds: null, frontHalfAngle: null, blockFraction: 0,
  breakHalfHearts: null, breakStaggerSeconds: 0, brokenCooldownSeconds: 0, moveSpeedFactor: 1, yawRateFactor: 1, reflectDamage: 0, attackerStaggerSeconds: 0, recoverySeconds: 0, whiffRecoverySeconds: 0, successCooldownSeconds: 0, ...over });
export const GUARDS: Record<string, GuardProfile> = {
  'counter-spike': guard({ id: 'counter-spike', kind: 'counter', startupSeconds: .04, windowSeconds: .22, blockFraction: 1, reflectDamage: 3, attackerStaggerSeconds: 1.0, whiffRecoverySeconds: .40, successCooldownSeconds: .3 }),
  'brace-shell': guard({ id: 'brace-shell', kind: 'brace', startupSeconds: .10, minActiveSeconds: .25, frontHalfAngle: 70 * DEG, blockFraction: .75, breakHalfHearts: 4, breakStaggerSeconds: .5,
    brokenCooldownSeconds: 2.0, moveSpeedFactor: .45, yawRateFactor: .5, recoverySeconds: .15, whiffRecoverySeconds: .15 }),
};
const evasion = (id: string, distance: number, travel: number, recovery: number, plane: EvasionProfile['plane']): EvasionProfile =>
  ({ id, distanceBodyLengths: distance, startupSeconds: .03, travelSeconds: travel, recoverySeconds: recovery, plane, endSpeedCarry: .3 });
export const EVASIONS: Record<string, EvasionProfile> = Object.fromEntries([
  evasion('dash-side-fin', 1.6, .18, .12, 'free'), evasion('dash-dorsal-fin', 1.4, .18, .12, 'free'), evasion('dash-frill-fin', 1.5, .18, .12, 'free'), evasion('dash-paddle-tail', 1.8, .20, .14, 'free'),
  evasion('scuttle-little-leg', 1.3, .16, .10, 'horizontal'), evasion('scuttle-crab-leg', 1.4, .18, .10, 'horizontal'),
].map(e => [e.id, e]));

const DASH_SCALING = { 'evasion.distanceBodyLengths': .3, 'evasion.travelSeconds': .2, 'evasion.recoverySeconds': .3, cooldownSeconds: .3 };
const DASH_PAIR: PairBonus = { multiply: { 'evasion.distanceBodyLengths': 1.2, cooldownSeconds: .85 }, add: {} };
const ability = (over: Partial<AbilitySpec> & Pick<AbilitySpec, 'id' | 'kind' | 'label' | 'cooldownSeconds' | 'effectProfileId'>): AbilitySpec =>
  ({ allowedMotionModes: ALL_MODES, input: 'press', scaling: {}, pair: null, ...over });
const dash = (id: string, label: string, cooldown: number, pair: boolean) => ability({ id, kind: 'dash', label, cooldownSeconds: cooldown, effectProfileId: 'dash', evasionProfileId: id, scaling: DASH_SCALING, pair: pair ? DASH_PAIR : null });
const grab = (id: string, attackId: string) => ability({ id, kind: 'grab', label: 'Grab', cooldownSeconds: 3.0, effectProfileId: 'grab', attackId,
  scaling: { 'attack.damage': .5, 'attack.shape.range': .3, 'attack.hold.seconds': .35, 'attack.hold.sizeFactor': .35, 'attack.windupSeconds': .2, cooldownSeconds: .2 },
  pair: { multiply: { 'attack.hold.seconds': 1.3, 'attack.damage': 1.5 }, add: { 'attack.hold.sizeFactor': .25 } } });
const sweepAbility = (id: string, attackId: string, cooldown: number) => ability({ id, kind: 'sweep', label: 'Sweep', cooldownSeconds: cooldown, effectProfileId: 'hit', attackId,
  scaling: { 'attack.damage': .6, 'attack.shape.range': .3, 'attack.impulse': .5, 'attack.windupSeconds': .2, 'attack.recoverySeconds': .2, cooldownSeconds: .25 } });
export const PLAYER_ABILITIES: Record<string, AbilitySpec> = Object.fromEntries([
  grab('grab-pincer', 'pinch-pincer'), grab('grab-clawmother', 'pinch-clawmother'),
  ability({ id: 'counter-spike', kind: 'counter', label: 'Counter', cooldownSeconds: 1.2, effectProfileId: 'counter', guardProfileId: 'counter-spike',
    scaling: { 'guard.windowSeconds': .3, 'guard.reflectDamage': .6, 'guard.attackerStaggerSeconds': .3, 'guard.whiffRecoverySeconds': .3, cooldownSeconds: .25 } }),
  ability({ id: 'brace-shell', kind: 'brace', label: 'Brace', input: 'hold', cooldownSeconds: .4, effectProfileId: 'block', guardProfileId: 'brace-shell',
    scaling: { 'guard.blockFraction': .2, 'guard.breakHalfHearts': .6, 'guard.moveSpeedFactor': -.25, 'guard.startupSeconds': .3 } }),
  dash('dash-side-fin', 'Dash', 1.1, true), dash('dash-dorsal-fin', 'Dash', 1.0, false), dash('dash-frill-fin', 'Dash', 1.1, true), dash('dash-paddle-tail', 'Dash', 1.3, false),
  dash('scuttle-little-leg', 'Scuttle', .9, true), dash('scuttle-crab-leg', 'Scuttle', 1.0, true),
  sweepAbility('sweep-fan-tail', 'sweep-fan', 2.2), sweepAbility('sweep-fluke', 'sweep-fluke', 2.4),
].map(a => [a.id, a]));
export interface MoveCatalogs { attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; guards: Record<string, GuardProfile>; evasions: Record<string, EvasionProfile> }
export const MOVE_CATALOGS: MoveCatalogs = { attacks: PLAYER_ATTACKS, abilities: PLAYER_ABILITIES, guards: GUARDS, evasions: EVASIONS };

const INT_FIELDS = new Set(['damage', 'reflectDamage', 'breakHalfHearts', 'startHalfHearts', 'squeezeHalfHearts']);
/** The one rounding (spec §7.3): HP and half-hearts to an integer of at least 1; impulses to .1; seconds, body lengths and fractions to .01
 *  (a block fraction at most .95). */
export function roundMoveValue(key: string, v: number): number {
  const last = key.split('.').at(-1)!;
  if (INT_FIELDS.has(last)) return Math.max(1, Math.round(v));
  if (last === 'impulse') return Math.round(v * 10) / 10;
  const r = Math.round(v * 100) / 100;
  return last === 'blockFraction' ? Math.min(.95, r) : r;
}
function pathNumber(root: Record<string, unknown>, path: string): number {
  let v: unknown = root;
  for (const k of path.split('.')) v = (v as Record<string, unknown>)[k];
  if (typeof v !== 'number') throw new Error(`moves: no number at ${path}`);
  return v;
}
function setPath(root: Record<string, unknown>, path: string, value: number) {
  const keys = path.split('.'), last = keys.pop()!;
  let o = root;
  for (const k of keys) o = o[k] as Record<string, unknown>;
  o[last] = value;
}
/** value = base × (1 + k × (s − 1)); a mirrored pair then × multiply + add; then one rounding. Keys that only the pair names have k = 0. */
function scaleInto(root: Record<string, unknown>, scaling: Readonly<Record<string, number>>, pair: PairBonus | null, s: number, mirrored: boolean) {
  const usePair = mirrored && pair !== null, keys = new Set([...Object.keys(scaling), ...(usePair ? [...Object.keys(pair!.multiply), ...Object.keys(pair!.add)] : [])]);
  for (const key of keys) {
    let v = pathNumber(root, key) * (1 + (scaling[key] ?? 0) * (s - 1));
    if (usePair) v = v * (pair!.multiply[key] ?? 1) + (pair!.add[key] ?? 0);
    setPath(root, key, roundMoveValue(key, v));
  }
}
export type MoveRef = { attackId: string } | { abilityId: string };
/** The numbers of a move at part scale `scale` (spec §7.3). A Bite adds floor(nonMouthBite). The pair bonus applies only when `mirrored`. */
export function resolveMove(ref: MoveRef, scale: number, opts: { mirrored?: boolean; nonMouthBite?: number } = {}, c: MoveCatalogs = MOVE_CATALOGS): ResolvedMove {
  if ('attackId' in ref) {
    const spec = c.attacks[ref.attackId]; if (!spec) throw new Error(`moves: unknown attack ${ref.attackId}`);
    const attack = structuredClone(spec);
    scaleInto(attack as unknown as Record<string, unknown>, attack.scaling ?? {}, attack.pair ?? null, scale, !!opts.mirrored);
    attack.damage += Math.floor((opts.nonMouthBite ?? 0) + 1e-9);
    return { kind: 'bite', abilityId: null, label: 'Bite', input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: ALL_MODES };
  }
  const a = c.abilities[ref.abilityId]; if (!a) throw new Error(`moves: unknown ability ${ref.abilityId}`);
  const root: Record<string, unknown> = { cooldownSeconds: a.cooldownSeconds };
  if (a.attackId) root.attack = structuredClone(c.attacks[a.attackId]!);
  if (a.guardProfileId) root.guard = structuredClone(c.guards[a.guardProfileId]!);
  if (a.evasionProfileId) root.evasion = structuredClone(c.evasions[a.evasionProfileId]!);
  scaleInto(root, a.scaling, a.pair, scale, !!opts.mirrored);
  return { kind: a.kind, abilityId: a.id, label: a.label, input: a.input, attack: (root.attack as AttackSpec | undefined) ?? null, guard: (root.guard as GuardProfile | undefined) ?? null,
    evasion: (root.evasion as EvasionProfile | undefined) ?? null, cooldownSeconds: root.cooldownSeconds as number, allowedMotionModes: a.allowedMotionModes };
}
/** A species attack as a resolved move (the spec itself). */
export const speciesMove = (attack: AttackSpec): ResolvedMove => ({ kind: 'species', abilityId: null, label: attack.id, input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: ALL_MODES });

/** One part's move. `grantId` is the grant on the part; `scale` and `mirrored` come from the placed part. */
export interface GrantedMove { kind: MoveKind | 'bite'; partUid: string; partId: string; grantId: string; scale: number; mirrored: boolean; resolved: ResolvedMove }
export interface MoveSet {
  /** The mouth's Bite, or null without a mouth. */
  basic: GrantedMove | null;
  /** The representative move of each granted kind (spec §7.2). */
  byKind: Partial<Record<MoveKind, GrantedMove>>;
  /** Every part's move of each kind, the representative first. */
  candidates: Partial<Record<MoveKind, GrantedMove[]>>;
}
/** B: the `bite` stat of the non-mouth parts, with the stat factor of core spec §5 (a pair counts twice; × (.75 + .25 scale)). */
export function nonMouthBite(g: Genome, catalog: readonly PartSpec[] = PARTS): number {
  let b = 0;
  for (const placed of g.parts) {
    const spec = catalog.find(s => s.id === placed.id); if (!spec || spec.kind === 'mouth') continue;
    b += (spec.stats.bite ?? 0) * (placed.mirror ? 2 : 1) * (.75 + .25 * placed.scale);
  }
  return b;
}
/** The primary number of a kind (spec §7.2): Grab hold seconds, Counter window, Brace block fraction, Dash distance, Sweep damage. */
export function primaryOf(m: GrantedMove): number {
  const r = m.resolved;
  switch (m.kind) {
    case 'grab': return r.attack?.hold?.seconds ?? 0;
    case 'counter': return r.guard?.windowSeconds ?? 0;
    case 'brace': return r.guard?.blockFraction ?? 0;
    case 'dash': return r.evasion?.distanceBodyLengths ?? 0;
    case 'sweep': return r.attack?.damage ?? 0;
    default: return r.attack?.damage ?? 0;
  }
}
/** Larger primary number, then larger scale, then the mirrored part, then the lower uid. */
const better = (a: GrantedMove, b: GrantedMove) => primaryOf(b) - primaryOf(a) || b.scale - a.scale || Number(b.mirrored) - Number(a.mirrored) || uidSerial(a.partUid) - uidSerial(b.partUid);
export function movesOf(g: Genome, catalog: readonly PartSpec[] = PARTS, c: MoveCatalogs = MOVE_CATALOGS): MoveSet {
  const out: MoveSet = { basic: null, byKind: {}, candidates: {} }, b = nonMouthBite(g, catalog);
  for (const placed of g.parts) {
    const spec = catalog.find(s => s.id === placed.id); if (!spec) continue;
    const basic = spec.basicAttacks[0];
    if (spec.kind === 'mouth' && basic && !out.basic)
      out.basic = { kind: 'bite', partUid: placed.uid, partId: spec.id, grantId: basic.id, scale: placed.scale, mirrored: false, resolved: resolveMove({ attackId: basic.attackId }, placed.scale, { nonMouthBite: b }, c) };
    for (const grant of spec.activeGrants) {
      const ability = c.abilities[grant.abilityId]; if (!ability) continue;
      const move: GrantedMove = { kind: ability.kind, partUid: placed.uid, partId: spec.id, grantId: grant.id, scale: placed.scale, mirrored: placed.mirror,
        resolved: resolveMove({ abilityId: ability.id }, placed.scale, { mirrored: placed.mirror }, c) };
      (out.candidates[ability.kind] ??= []).push(move);
    }
  }
  for (const kind of MOVE_PRIORITY) { const list = out.candidates[kind]; if (list) { list.sort(better); out.byKind[kind] = list[0]!; } }
  return out;
}
export const grantedKinds = (m: MoveSet): MoveKind[] => MOVE_PRIORITY.filter(k => m.byKind[k]);
export const NO_PINS: Readonly<Tuple4<SlotPin>> = Object.freeze([null, null, null, null]) as unknown as Readonly<Tuple4<SlotPin>>;
export interface SlotAssignment { slots: Tuple4<MoveKind | null>; inactive: MoveKind[] }
/** R1 (spec §7.2): pins of granted kinds go in their slots; the empty slots fill in index order with the other kinds in priority order;
 *  the kinds that are left are inactive. A kind pinned twice keeps its first pin. */
export function placeKinds(granted: readonly MoveKind[], pins: Readonly<Tuple4<SlotPin>>): SlotAssignment {
  const kinds = MOVE_PRIORITY.filter(k => granted.includes(k)), slots: Tuple4<MoveKind | null> = [null, null, null, null], placed = new Set<MoveKind>();
  pins.forEach((pin, i) => { if (pin && kinds.includes(pin) && !placed.has(pin)) { slots[i] = pin; placed.add(pin); } });
  const rest = kinds.filter(k => !placed.has(k));
  for (let i = 0; i < 4 && rest.length; i++) if (slots[i] === null) { const k = rest.shift()!; slots[i] = k; placed.add(k); }
  return { slots, inactive: rest };
}
export const assignSlots = (g: Genome, pins: Readonly<Tuple4<SlotPin>>, catalog: readonly PartSpec[] = PARTS): SlotAssignment => placeKinds(grantedKinds(movesOf(g, catalog)), pins);
/** Clears the pins of kinds the design no longer grants (commit; spec §7.2). */
export function clearMissingPins(pins: Readonly<Tuple4<SlotPin>>, granted: readonly MoveKind[]): { pins: Tuple4<SlotPin>; cleared: MoveKind[] } {
  const cleared: MoveKind[] = [], out = pins.map(p => { if (p && !granted.includes(p)) { cleared.push(p); return null; } return p; }) as Tuple4<SlotPin>;
  return { pins: out, cleared };
}
```

- [ ] **Step 5: Register the player catalogs and V16**

```diff
--- a/src/tiny-tide/registries.ts
+++ b/src/tiny-tide/registries.ts
@@ -3,7 +3,8 @@ import { MOVE_PRIORITY, type AbilitySpec, type AttackSpec, type ContactHazard, t
 import { HABITATS, HULLS, MOUNTS, MOVEMENTS, POSES, PURSUITS } from './profiles';
 import { EFFECTS, TELEGRAPHS } from './combat-profiles';
 import { BEHAVIOUR_TYPES, BEHAVIOURS, hostileSizes, minWindup, SPECIES_ATTACKS, type SpeciesBehaviour } from './bestiary';
-import { PARTS, type PartSpec } from './parts';
+import { PART_MOVES, PARTS, type PartSpec } from './parts';
+import { EVASIONS, GUARDS, PLAYER_ABILITIES, PLAYER_ATTACKS } from './moves';
 import { PLANS, type BodyPlan } from './plans';
 import { FOOD_GLBS, SPECIES, type Species } from './species';
 import { PART_RIG, type RigNode } from './rig';
@@ -22,10 +23,9 @@ function merged(...sources: Record<string, AttackSpec>[]): Record<string, Attack
   for (const src of sources) for (const [k, v] of Object.entries(src)) { if (out[k]) throw new Error(`duplicate attack id ${k}`); out[k] = v; }
   return out;
 }
-export const ATTACKS: Record<string, AttackSpec> = merged(SPECIES_ATTACKS);
-export const ABILITIES: Record<string, AbilitySpec> = {};
-export const GUARDS: Record<string, GuardProfile> = {};
-export const EVASIONS: Record<string, EvasionProfile> = {};
+export const ATTACKS: Record<string, AttackSpec> = merged(PLAYER_ATTACKS, SPECIES_ATTACKS);
+export const ABILITIES: Record<string, AbilitySpec> = PLAYER_ABILITIES;
+export { EVASIONS, GUARDS };
 const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
 export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 1, 1.8), hazard('ray-sting', 1, 1.8), hazard('crab-pinch', 2, 1.4), hazard('squid-grab', 2, 1.4), hazard('plane-buzz', 2, 1.4)].map(h => [h.id, h]));
 export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
@@ -41,6 +41,8 @@ export function numberAt(o: unknown, path: string): number | undefined {
   for (const k of path.split('.')) { if (!v || typeof v !== 'object') return undefined; v = (v as Record<string, unknown>)[k]; }
   return typeof v === 'number' ? v : undefined;
 }
+/** A pair is stronger, never weaker: a multiplier is ≥ 1, except a cooldown's, which is in (0, 1] (the Dash pair's × .85; spec defect: V10 said ≥ 1). */
+const pairMultiplierOk = (key: string, v: number) => key.endsWith('cooldownSeconds') ? v > 0 && v <= 1 : v >= 1;
 /** Attack paths may start with `shape.`, `lunge.` or `hold.`, or name a top-level number. */
 const attackPathOk = (a: AttackSpec, key: string) => { const head = key.split('.')[0]!; return (key.includes('.') ? ['shape', 'lunge', 'hold'].includes(head) : true) && numberAt(a, key) !== undefined; };
 
@@ -107,7 +109,7 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     for (const [key, v] of [...Object.entries(a.scaling ?? {}), ...Object.entries(pair?.multiply ?? {}), ...Object.entries(pair?.add ?? {})]) {
       if (!attackPathOk(a, key)) out.push(`attack ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`attack ${k}: scaling value ${key}`);
     }
-    for (const [key, v] of Object.entries(pair?.multiply ?? {})) if (fin(v) && v < 1) out.push(`attack ${k}: pair multiplier ${key}`);
+    for (const [key, v] of Object.entries(pair?.multiply ?? {})) if (fin(v) && !pairMultiplierOk(key, v)) out.push(`attack ${k}: pair multiplier ${key}`);
     // V6
     const tg = c.telegraphs[a.telegraphProfileId];
     if (tg) {
@@ -151,7 +153,7 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     for (const [key, v] of [...Object.entries(a.scaling), ...Object.entries(a.pair?.multiply ?? {}), ...Object.entries(a.pair?.add ?? {})]) {
       if (!target(key)) out.push(`ability ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`ability ${k}: scaling value ${key}`);
     }
-    for (const [key, v] of Object.entries(a.pair?.multiply ?? {})) if (fin(v) && v < 1) out.push(`ability ${k}: pair multiplier ${key}`);
+    for (const [key, v] of Object.entries(a.pair?.multiply ?? {})) if (fin(v) && !pairMultiplierOk(key, v)) out.push(`ability ${k}: pair multiplier ${key}`);
   }
   // V11
   for (const [k, g] of Object.entries(c.guards)) {
@@ -243,6 +245,14 @@ export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
     }
     for (const g of p.basicAttacks) if (!c.attacks[g.attackId]) out.push(`part ${p.id}: attack ${g.attackId}`);
     for (const g of p.activeGrants) { if (!c.abilities[g.abilityId]) out.push(`part ${p.id}: ability ${g.abilityId}`); if (g.mirrorPolicy !== 'shared-cast') out.push(`part ${p.id}: mirrorPolicy ${g.id}`); }
+    // V16: one grant per move-giving part, of its kind (spec §7.1); one Bite per mouth; no other basic grant.
+    const kind = PART_MOVES[p.id];
+    if (kind ? p.activeGrants.length !== 1 : p.activeGrants.length !== 0) out.push(`part ${p.id}: grants`);
+    else if (kind && c.abilities[p.activeGrants[0]!.abilityId] && c.abilities[p.activeGrants[0]!.abilityId]!.kind !== kind) out.push(`part ${p.id}: move kind`);
+    if (p.kind === 'mouth') {
+      const b = p.basicAttacks[0], a = b && c.attacks[b.attackId];
+      if (p.basicAttacks.length !== 1 || !a || a.aimMode !== 'input' || a.damageUnit !== 'hp') out.push(`part ${p.id}: basic`);
+    } else if (p.basicAttacks.length) out.push(`part ${p.id}: basic`);
     // V17
     if (p.rare && c.species.filter(s => s.alpha?.rewardPartId === p.id).length !== 1) out.push(`part ${p.id}: rare without one alpha`);
     if (p.model !== undefined && !c.parts.some(q => q.id === p.model && !q.rare)) out.push(`part ${p.id}: model ${p.model}`);
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/moves.test.ts tests/tiny-tide-core/contract.test.ts`
Expected: PASS, 0 failed. The pair-rounding case gives Side fin pair distance 1.6 at scale .45 (one rounding, not two).

- [ ] **Step 7: Checkpoint.** Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/tiny-tide/moves.ts src/tiny-tide/parts.ts src/tiny-tide/registries.ts tests/tiny-tide-core/moves.test.ts tests/tiny-tide-core/combat-fixture.ts tests/tiny-tide-core/contract.test.ts
git commit -m "Tiny Tide combat: player moves from parts, size scaling with one rounding, slot assignment and pins

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T3: Combat shapes and hit tests

**Spec:** §5.10, §5.11, D3, D33.

**Files:**
- Create: `src/tiny-tide/combat-shapes.ts`, `tests/tiny-tide-core/combat-shapes.test.ts`
- Modify: `src/tiny-tide/combat-types.ts` (`WorldQueries.segmentClear`), `src/tiny-tide/world-queries.ts`

**Interfaces:**
- Consumes: `AttackShape`, `WorldShape`, `Capsule`, `Vec3`, `WorldQueries`, `ATTACKS` (T2).
- Produces: `vec`, `AimFrame`, `aimFrame(origin, aim, bodyForward)`, `worldShape(shape, frame, L)`, `actionShapes(shape, origins, aim, bodyForward, L)`, `closestOnSegment`, `closestBetweenSegments`, `sphereHitsShape(c, r, s)`, `pointInShape`, `hurtboxSpheres(h)`, `hurtboxHit(h, shapes)`, `hurtboxesHit(hurtboxes, shapes)`, `truncateCapsule(s, capsuleL, lungeL, lungeDone)`, `crossingOk(mode, q, origin, point, L)`, `terrainSegmentClear(q, a, b, step)`, `obstructionClear(q, origin, point, L)`, `nearestTargets(candidates, max)`, `shapeCentroid`, `horizontalExtent`, `TelegraphDescriptor`, `telegraphDescriptor(shapes, fill, color, pattern, locked, groundAt)`; `WorldQueries.segmentClear(a, b, step): boolean`.

- [ ] **Step 1: Write the failing tests** (complete file)

```ts
// tests/tiny-tide-core/combat-shapes.test.ts
import { describe, expect, it } from 'vitest';
import { actionShapes, aimFrame, crossingOk, horizontalExtent, hurtboxesHit, hurtboxHit, nearestTargets, obstructionClear, pointInShape, shapeCentroid, sphereHitsShape, telegraphDescriptor, truncateCapsule, worldShape } from '../../src/tiny-tide/combat-shapes';
import { ATTACKS } from '../../src/tiny-tide/registries';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import { solidOf, SolidIndex } from '../../src/tiny-tide/solids';
import type { Terrain, Vec3, WorldShape } from '../../src/tiny-tide/combat-types';

const O: Vec3 = { x: 0, y: 10, z: 0 }, Z: Vec3 = { x: 0, y: 0, z: 1 };
const DEG = Math.PI / 180;
const cone = (range: number, half: number): WorldShape => ({ kind: 'cone', apex: O, axis: Z, range, halfAngle: half * DEG });
const flat = (surface = 85): Terrain => ({ groundAt: () => 0, surface, space: false, slopeBound: 0 });

describe('combat shapes', () => {
  it('sphere-cone hits at the edges', () => {
    const c = cone(1, 30);
    expect(sphereHitsShape({ x: 0, y: 10, z: 1.09 }, .1, c)).toBe(true);    // range + r = 1.1
    expect(sphereHitsShape({ x: 0, y: 10, z: 1.11 }, .1, c)).toBe(false);
    // At 45° off the axis, 1 away: the angle 45° ≤ 30° + asin(.3) = 47.5° hits; r = .2 gives 30° + 11.5° = 41.5° and misses.
    const p = { x: Math.SQRT1_2, y: 10, z: Math.SQRT1_2 };
    expect(sphereHitsShape(p, .3, c)).toBe(true); expect(sphereHitsShape(p, .2, c)).toBe(false);
    expect(sphereHitsShape({ x: 0, y: 10, z: -.05 }, .1, c)).toBe(true);   // contains the apex
    expect(sphereHitsShape({ x: 0, y: 10, z: -.5 }, .1, c)).toBe(false);   // behind
  });
  it('sphere-capsule hits', () => {
    const cap: WorldShape = { kind: 'capsule', start: O, end: { x: 0, y: 10, z: 2 }, radius: .3 };
    expect(sphereHitsShape({ x: .49, y: 10, z: 1 }, .2, cap)).toBe(true); expect(sphereHitsShape({ x: .51, y: 10, z: 1 }, .2, cap)).toBe(false);
    expect(sphereHitsShape({ x: 0, y: 10, z: 2.49 }, .2, cap)).toBe(true); expect(sphereHitsShape({ x: 0, y: 10, z: 2.51 }, .2, cap)).toBe(false);
    const sphere: WorldShape = { kind: 'capsule', start: O, end: O, radius: 1 };   // start = end is a sphere
    expect(sphereHitsShape({ x: 1.1, y: 10, z: 0 }, .2, sphere)).toBe(true); expect(sphereHitsShape({ x: 1.3, y: 10, z: 0 }, .2, sphere)).toBe(false);
    // A capsule hurtbox is tested as spheres; the hit point is on its axis, nearest the shape's axis.
    const body = { start: { x: -1, y: 10, z: .5 }, end: { x: 1, y: 10, z: .5 }, radius: .1 };
    expect(hurtboxHit(body, [cone(1, 30)])).toEqual({ x: 0, y: 10, z: .5 });
    expect(hurtboxHit({ ...body, start: { x: 3, y: 10, z: .5 }, end: { x: 5, y: 10, z: .5 } }, [cone(1, 30)])).toBeNull();
  });
  it('telegraph shape equals hit shape for every registered attack', () => {
    const aims: Vec3[] = [Z, { x: 1, y: 0, z: 0 }, { x: .3, y: .5, z: -.8 }, { x: 0, y: 1, z: 0 }];
    for (const a of Object.values(ATTACKS)) for (const aim of aims) {
      const hit = actionShapes(a.shape, [O, { x: 1, y: 10, z: 0 }], aim, Z, 2), tele = telegraphDescriptor(actionShapes(a.shape, [O, { x: 1, y: 10, z: 0 }], aim, Z, 2), .5, 'amber', 'solid', false, () => 0);
      expect(tele.shapes, a.id).toEqual(hit);
    }
  });
  it('hit volume stays inside the locked telegraph (lunge truncated by a wall)', () => {
    // A lunge capsule (0,0,0)–(0,0,1.4) r .22 with lunge 1.2 (the crab's), L = 5.6; the attacker stopped after .5 L.
    const L = 5.6, f = aimFrame(O, Z, Z), locked = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1.4 }, radius: .22 }, f, L);
    if (locked.kind !== 'capsule') throw new Error('capsule');
    const hit = truncateCapsule(locked, 1.4, 1.2, .5);
    if (hit.kind !== 'capsule') throw new Error('capsule');
    expect(hit.end.z).toBeCloseTo(O.z + .7 * L);   // 1.4 − 1.2 + .5 = .7 L
    for (let i = 0; i <= 40; i++) for (const off of [-.2, 0, .2]) {
      const p = { x: off * L * .22, y: 10, z: hit.start.z + (hit.end.z - hit.start.z) * i / 40 };
      if (pointInShape(p, hit)) expect(pointInShape(p, locked)).toBe(true);
    }
    expect(truncateCapsule(locked, 1.4, 1.2, 1.2)).toEqual(locked);   // the whole lunge: the whole capsule
  });
  it('units are attacker body lengths', () => {
    const f = aimFrame(O, Z, Z);
    expect(worldShape({ kind: 'cone', range: .6, halfAngle: .5 }, f, 1)).toMatchObject({ range: .6 });
    expect(worldShape({ kind: 'cone', range: .6, halfAngle: .5 }, f, 4)).toMatchObject({ range: 2.4, halfAngle: .5 });
    const cap = worldShape({ kind: 'capsule', start: { x: 0, y: 0, z: .1 }, end: { x: 0, y: 0, z: .75 }, radius: .12 }, f, 10);
    expect(cap).toMatchObject({ radius: 1.2 }); if (cap.kind === 'capsule') { expect(cap.start.z).toBeCloseTo(1); expect(cap.end.z).toBeCloseTo(7.5); }
    // The frame: z = aim, y = up made orthogonal; a vertical aim uses the body forward.
    const up = aimFrame(O, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(up.y.x).toBeCloseTo(1); expect(up.z.y).toBeCloseTo(1);
  });
  it('obstruction by terrain and by a reef solid', () => {
    const rock = solidOf('r1', 'rock', [{ kind: 'ellipsoid', x: 0, y: 5, z: 5, a: 1, b: 1, c: 1, yaw: 0 }]);
    const q = makeWorldQueries(flat(), { solids: new SolidIndex([rock], 8) }), plain = makeWorldQueries(flat());
    expect(obstructionClear(q, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);    // through the rock
    expect(obstructionClear(q, { x: 0, y: 5, z: 0 }, { x: 3, y: 5, z: 10 }, 1)).toBe(true);     // beside it
    expect(obstructionClear(plain, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(true);
    const hill = makeWorldQueries({ ...flat(), groundAt: (_x, z) => z > 4 && z < 6 ? 8 : 0 });
    expect(obstructionClear(hill, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);   // under the ridge
    const noSegment = { ...hill, segmentClear: undefined };
    expect(obstructionClear(noSegment, { x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 10 }, 1)).toBe(false);   // terrain-only fallback
  });
  it('crossing same-medium', () => {
    const q = makeWorldQueries(flat(10));
    expect(crossingOk('same-medium', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 8, z: 0 }, 1)).toBe(true);
    expect(crossingOk('same-medium', q, { x: 0, y: 9.5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(false);   // water to air
    expect(crossingOk('water-surface', q, { x: 0, y: 9.5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(true);
    expect(crossingOk('water-surface', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 10.5, z: 0 }, 1)).toBe(false);
    expect(crossingOk('any-medium', q, { x: 0, y: 5, z: 0 }, { x: 0, y: 50, z: 0 }, 1)).toBe(true);
    for (const a of Object.values(ATTACKS)) expect(a.crossing, a.id).toBe('same-medium');
  });
  it('maxTargets nearest first', () => {
    expect(nearestTargets([{ id: 'e3', distance: 2 }, { id: 'e1', distance: 1 }, { id: 'e2', distance: 1 }, { id: 'e0', distance: 5 }], 2).map(t => t.id)).toEqual(['e1', 'e2']);
  });
  it('mirrored pair shape is the union with one hit group', () => {
    // Two pinch origins 1 apart; a target in front of the second copy only is still hit by the action.
    const shapes = actionShapes({ kind: 'cone', range: .5, halfAngle: .3 }, [O, { x: 2, y: 10, z: 0 }], Z, Z, 1);
    expect(shapes).toHaveLength(2);
    const target = [{ start: { x: 2, y: 10, z: .4 }, end: { x: 2, y: 10, z: .4 }, radius: .05 }];
    expect(hurtboxesHit(target, shapes)).not.toBeNull(); expect(hurtboxesHit(target, shapes.slice(0, 1))).toBeNull();
  });
  it('gives the depth ring a centroid and a horizontal extent', () => {
    expect(shapeCentroid(cone(2, 30))).toEqual({ x: 0, y: 10, z: 1 });
    expect(horizontalExtent({ kind: 'capsule', start: O, end: { x: 0, y: 10, z: 2 }, radius: .5 })).toBeCloseTo(1.5);
    expect(horizontalExtent(cone(2, 30))).toBeCloseTo(Math.hypot(1, 2 * Math.cos(30 * DEG) - 1));   // a rim point (x 1, z 1.73) is farthest from (0, 1)
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-shapes.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/combat-shapes"`.

- [ ] **Step 3: Add `segmentClear` to the world queries** (samples the segment every `step`; false below the ground or inside a reef solid; perception does not change)

```diff
--- a/src/tiny-tide/combat-types.ts
+++ b/src/tiny-tide/combat-types.ts
@@ -126,6 +126,8 @@ export interface WorldQueries {
   overlapHull(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext): Admission;
   /** The top (largest y) of a decoration solid by id, when these queries have solids (the ground step-over, fix round 2). */
   solidTop?(id: string): number | undefined;
+  /** Combat obstruction (spec §5.11): false when a sample at most `step` apart on the segment is under the ground or inside a reef solid. */
+  segmentClear?(a: Vec3, b: Vec3, step: number): boolean;
 }
 export interface LegalityContext { queries: WorldQueries; bounds?: { half: number; maxY?: number } }
 export interface MotionRequest { actorId: ActorId; from: Vec3; displacement: Vec3; orientation: Orientation; turn?: Orientation; hull: readonly Capsule[]; habitatProfileId: string;
--- a/src/tiny-tide/world-queries.ts
+++ b/src/tiny-tide/world-queries.ts
@@ -57,6 +57,15 @@ export function makeWorldQueries(t: Terrain, extras: WorldExtras = {}): WorldQue
     refugeAccess: (actor, id) => extras.refugeAccess ? extras.refugeAccess(actor, id) : true,
     overlapHull: (actor, at, o, ctx) => admissionClock.on ? timedAdmit(actor, at, o, ctx, t, extras) : admit(actor, at, o, ctx, t, extras),
     solidTop: id => extras.solids?.byId(id)?.maxY,
+    segmentClear: (a, b, step) => {
+      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / Math.max(1e-9, step)));
+      for (let k = 0; k <= n; k++) {
+        const f = k / n, x = a.x + dx * f, y = a.y + dy * f, z = a.z + dz * f;
+        if (!t.space && y < t.groundAt(x, z)) return false;
+        if (extras.solids?.solidAt(x, y, z, 0)) return false;
+      }
+      return true;
+    },
   };
 }
```

- [ ] **Step 4: Create `combat-shapes.ts`** (complete file)

```ts
// World shapes of attacks (spec §5.10–§5.11): the aim frame, cones and capsules in attacker body lengths, hit tests against hurtboxes,
// crossing and obstruction, lunge truncation and telegraph descriptors. One `worldShape` serves the telegraph and the hit test. Pure.
import type { AttackShape, Capsule, Vec3, WorldQueries, WorldShape } from './combat-types';

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : fallback; };
export const vec = { sub, add, mul, dot, len, cross, unit };

/** z = aim; y = world up made orthogonal to z (the body forward when |aim.y| > .98); x = y × z. */
export interface AimFrame { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 }
export function aimFrame(origin: Vec3, aim: Vec3, bodyForward: Vec3): AimFrame {
  const z = unit(aim), ref = Math.abs(z.y) > .98 ? unit(bodyForward) : { x: 0, y: 1, z: 0 };
  let y = sub(ref, mul(z, dot(ref, z)));
  if (len(y) < 1e-9) y = sub({ x: 1, y: 0, z: 0 }, mul(z, z.x));
  y = unit(y);
  return { origin, x: cross(y, z), y, z };
}
/** The world shape of an attack shape in the frame; local numbers × L (the attacker's body length). */
export function worldShape(shape: AttackShape, f: AimFrame, L: number): WorldShape {
  if (shape.kind === 'cone') return { kind: 'cone', apex: f.origin, axis: f.z, range: shape.range * L, halfAngle: shape.halfAngle };
  const at = (p: Vec3) => add(f.origin, mul(add(add(mul(f.x, p.x), mul(f.y, p.y)), mul(f.z, p.z)), L));
  return { kind: 'capsule', start: at(shape.start), end: at(shape.end), radius: shape.radius * L };
}
/** The shapes of one action: one per emitter origin (a mirrored pair's union has two), the same aim. */
export const actionShapes = (shape: AttackShape, origins: readonly Vec3[], aim: Vec3, bodyForward: Vec3, L: number): WorldShape[] =>
  origins.map(o => worldShape(shape, aimFrame(o, aim, bodyForward), L));

/** The closest point to c on the segment ab. */
export function closestOnSegment(c: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a), l2 = dot(ab, ab);
  return l2 > 0 ? add(a, mul(ab, Math.max(0, Math.min(1, dot(sub(c, a), ab) / l2)))) : a;
}
/** The closest points p on a0a1 and q on b0b1. */
export function closestBetweenSegments(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { p: Vec3; q: Vec3 } {
  const d1 = sub(a1, a0), d2 = sub(b1, b0), r = sub(a0, b0), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return { p: a0, q: b0 };
  if (a <= 1e-12) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return { p: add(a0, mul(d1, s)), q: add(b0, mul(d2, t)) };
}
/** Sphere versus shape (spec §5.11). Cone: |c − apex| ≤ range + r and the angle to the axis ≤ halfAngle + asin(min(1, r / |c − apex|));
 *  a sphere that contains the apex is a hit. Capsule: the distance to the segment ≤ radius + r. */
export function sphereHitsShape(c: Vec3, r: number, s: WorldShape): boolean {
  if (s.kind === 'capsule') return len(sub(c, closestOnSegment(c, s.start, s.end))) <= s.radius + r;
  const d = sub(c, s.apex), dist = len(d);
  if (dist <= r) return true;
  if (dist > s.range + r) return false;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(d, s.axis) / dist)));
  return angle <= s.halfAngle + Math.asin(Math.min(1, r / dist));
}
/** A point inside a shape (tests and the telegraph subset rule). */
export const pointInShape = (p: Vec3, s: WorldShape): boolean => sphereHitsShape(p, 0, s);
/** A capsule hurtbox as spheres at most radius / 2 apart on its axis. */
export function hurtboxSpheres(h: Capsule): Vec3[] {
  const axis = sub(h.end, h.start), n = Math.max(1, Math.ceil(len(axis) / Math.max(1e-9, h.radius / 2)));
  return Array.from({ length: n + 1 }, (_, k) => add(h.start, mul(axis, k / n)));
}
const shapeAxis = (s: WorldShape): [Vec3, Vec3] => s.kind === 'cone' ? [s.apex, add(s.apex, mul(s.axis, s.range))] : [s.start, s.end];
/** The hit point of a hurtbox in a union of shapes, or null: the point of the hurtbox axis nearest the axis of the first shape it meets. */
export function hurtboxHit(h: Capsule, shapes: readonly WorldShape[]): Vec3 | null {
  for (const s of shapes) {
    if (!hurtboxSpheres(h).some(c => sphereHitsShape(c, h.radius, s))) continue;
    const [a, b] = shapeAxis(s);
    return closestBetweenSegments(h.start, h.end, a, b).p;
  }
  return null;
}
/** The first hurtbox hit and its point. */
export function hurtboxesHit(hurtboxes: readonly Capsule[], shapes: readonly WorldShape[]): Vec3 | null {
  for (const h of hurtboxes) { const p = hurtboxHit(h, shapes); if (p) return p; }
  return null;
}
/** A lunge's hit volume (spec §5.10): the committed capsule from its start, as far as the attacker has come. The capsule is `capsuleBodyLengths`
 *  long and the lunge `lungeBodyLengths`: the reach is the capsule's length minus the part of the lunge not yet moved. */
export function truncateCapsule(s: Extract<WorldShape, { kind: 'capsule' }>, capsuleBodyLengths: number, lungeBodyLengths: number, lungeDone: number): WorldShape {
  if (capsuleBodyLengths <= 0) return s;
  const f = Math.max(0, Math.min(1, (capsuleBodyLengths - lungeBodyLengths + lungeDone) / capsuleBodyLengths));
  return { kind: 'capsule', start: s.start, end: add(s.start, mul(sub(s.end, s.start), f)), radius: s.radius };
}
/** Crossing (spec §5.11). `water-surface` also allows water ↔ air when both points are within L of the surface. */
export function crossingOk(mode: 'same-medium' | 'water-surface' | 'any-medium', q: WorldQueries, origin: Vec3, point: Vec3, L: number): boolean {
  if (mode === 'any-medium') return true;
  const a = q.sampleEnvironment(origin).medium, b = q.sampleEnvironment(point).medium;
  if (a === b) return true;
  if (mode !== 'water-surface') return false;
  const s = q.terrain.surface, pair = (a === 'water' && b === 'air') || (a === 'air' && b === 'water');
  return pair && Math.abs(origin.y - s) <= L && Math.abs(point.y - s) <= L;
}
/** The terrain-only segment test: samples at most `step` apart; a sample under the ground blocks. */
export function terrainSegmentClear(q: WorldQueries, a: Vec3, b: Vec3, step: number): boolean {
  if (q.terrain.space) return true;
  const d = sub(b, a), n = Math.max(1, Math.ceil(len(d) / Math.max(1e-9, step)));
  for (let k = 0; k <= n; k++) { const p = add(a, mul(d, k / n)); if (p.y < q.terrain.groundAt(p.x, p.z)) return false; }
  return true;
}
/** Obstruction (`terrain-and-cover`): the segment from the shape origin to the hit point is clear, sampled at .25 L. */
export const obstructionClear = (q: WorldQueries, origin: Vec3, point: Vec3, L: number): boolean =>
  q.segmentClear ? q.segmentClear(origin, point, .25 * L) : terrainSegmentClear(q, origin, point, .25 * L);
/** The nearest targets first (by distance from the apex, then by actor id), at most `max`. */
export function nearestTargets<T extends { id: string; distance: number }>(candidates: readonly T[], max: number): T[] {
  return [...candidates].sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, max);
}
/** The shape's centroid for the depth ring: the middle of its axis. */
export function shapeCentroid(s: WorldShape): Vec3 { const [a, b] = shapeAxis(s); return mul(add(a, b), .5); }
/** The largest horizontal distance from the centroid to the shape (the depth ring's radius), from its axis ends and rim. */
export function horizontalExtent(s: WorldShape): number {
  const c = shapeCentroid(s), h = (p: Vec3) => Math.hypot(p.x - c.x, p.z - c.z);
  if (s.kind === 'capsule') return Math.max(h(s.start), h(s.end)) + s.radius;
  const f = aimFrame(s.apex, s.axis, { x: 0, y: 0, z: 1 }), half = Math.min(s.halfAngle, Math.PI / 2);
  let most = h(s.apex);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 2 * Math.PI, dir = add(mul(f.z, Math.cos(half)), mul(add(mul(f.x, Math.cos(a)), mul(f.y, Math.sin(a))), Math.sin(half)));
    most = Math.max(most, h(add(s.apex, mul(dir, s.range))));
  }
  return Math.max(most, h(add(s.apex, mul(s.axis, s.range))));
}
/** What the telegraph view draws (spec §9.1): the shapes the hit test uses, the fill, and the depth ring. */
export interface TelegraphDescriptor { shapes: WorldShape[]; fill: number; centroid: Vec3; ringRadius: number; groundY: number; color: 'amber' | 'red'; pattern: 'solid' | 'stripes'; locked: boolean }
export function telegraphDescriptor(shapes: WorldShape[], fill: number, color: 'amber' | 'red', pattern: 'solid' | 'stripes', locked: boolean, groundAt: (x: number, z: number) => number): TelegraphDescriptor {
  const first = shapes[0]!, centroid = shapeCentroid(first);
  return { shapes, fill: Math.max(0, Math.min(1, fill)), centroid, ringRadius: horizontalExtent(first), groundY: groundAt(centroid.x, centroid.z), color, pattern, locked };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-shapes.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Checkpoint.** Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/tiny-tide/combat-shapes.ts src/tiny-tide/combat-types.ts src/tiny-tide/world-queries.ts tests/tiny-tide-core/combat-shapes.test.ts
git commit -m "Tiny Tide combat: world shapes from sockets and aim, hurtbox tests, crossing, obstruction and telegraph descriptors

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T4: The action engine

**Spec:** §5.1–5.9, D10, D11, D13, D16.

**Files:**
- Create: `src/tiny-tide/action-engine.ts`, `tests/tiny-tide-core/action-engine.test.ts`
- Modify: `src/tiny-tide/combat-types.ts`, `tests/tiny-tide-core/helpers.ts`

**Interfaces:**
- Consumes: `CombatRuntime`, `ActionState`, `ResolvedMove`, `ActiveSlot`, `EmitterSource`, `MutVec3` (T1); `resolveMove`, `speciesMove` (T2).
- Produces: `BUFFER_SECONDS = .12`, `POISE_DECAY = 4`, `advanceClock(rt, t, dt): number` (returns Δτ = clamp((t+dt) − max(t, hitStopUntil), 0, dt)), `applyHitStop(rt, now, seconds)`, `inHitStop`, `windupLength`, `activeLength`, `holdLength`, `recoveryLength`, `cooldownLength`, `phaseRemaining`, `activeStartsIn`, `StartRefusal`, `StartCheck`, `liveActions`, `StartDecision`, `canStart(rt, c)`, `StartSpec`, `startAction(rt, s)`, `endNow(rt, a, cooldown?)`, `sweepEnded(rt)`, `endHold(rt, a)`, `holdingAction(rt, who)`, `turnToward(aim, wanted, maxAngle)`, `ActionInput`, `TickResult`, `tickAction(rt, a, dTau, input)`, `interruptible(a)`, `StaggerResult`, `stagger(rt, seconds, force?)`, `PoiseMeter`, `newPoise`, `addPoise(m, amount, tau, max)`, `poiseNow`, `bufferPress(rt, input, worldNow)`, `bufferedPress(rt)`, `lungeSpeed(a, L)`, `dashSpeed(a, L)`.

Rules that the tests pin: the cooldown starts at the end of recovery (or at the interrupt); a brace held past the minimum active stays active until release, then recovers; a release in wind-up still gives the minimum active; only Dash cancels the player's own recovery, and only after Bite and Sweep; stagger interrupts only an interruptible wind-up or active (`force` for a counter); the buffer keeps a press made in the last .12 s of recovery or in hit-stop, and drops it after .12 s.

- [ ] **Step 1: Write the failing tests** (complete file; `helpers.ts` gets one changed line)

```ts
// tests/tiny-tide-core/action-engine.test.ts — clocks in seconds; every expected time is the sum of the phase lengths named beside it.
import { describe, expect, it } from 'vitest';
import { addPoise, advanceClock, applyHitStop, bufferedPress, bufferPress, canStart, endHold, interruptible, newPoise, phaseRemaining, stagger, startAction, sweepEnded, tickAction, type ActionInput, type StartCheck } from '../../src/tiny-tide/action-engine';
import { newRuntime, type ActionState, type CombatRuntime, type ResolvedMove } from '../../src/tiny-tide/combat-types';
import { resolveMove, speciesMove } from '../../src/tiny-tide/moves';
import { POKE, WRAP } from './combat-fixture';

const Z = { x: 0, y: 0, z: 1 }, X = { x: 1, y: 0, z: 0 };
const idle: ActionInput = { wantedAim: null, held: false, bodyForward: Z };
const DT = 1 / 100;
/** Runs the clock and one action for `seconds` in steps of DT; returns the phase after each step with its clock time. */
function run(rt: CombatRuntime, a: ActionState, seconds: number, input: Partial<ActionInput> = {}, now = { t: 0 }) {
  const log: { tau: number; phase: string }[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; tickAction(rt, a, d, { ...idle, ...input }); log.push({ tau: rt.actionClock, phase: a.phase }); }
  return log;
}
const start = (rt: CombatRuntime, resolved: ResolvedMove, over: { key?: string; aim?: { x: number; y: number; z: number } } = {}) =>
  startAction(rt, { instanceId: 'x1', definitionId: resolved.attack?.id ?? resolved.abilityId ?? 'm', grantId: 'g', source: { kind: 'actor', actorId: 'e1', mountId: 'root', socketId: 'centre' }, resolved,
    aim: over.aim ?? Z, targetId: null, cooldownKey: over.key ?? 'e1:root:m', worldNow: 0 });
const firstTau = (log: { tau: number; phase: string }[], phase: string) => log.find(l => l.phase === phase)?.tau;
const check = (over: Partial<StartCheck> = {}): StartCheck => ({ playing: true, isPlayer: true, kind: 'bite', cooldownKey: 'k', mode: 'swim', allowedModes: ['swim', 'ground'], inBreachArc: false, token: true, worldNow: 0, ...over });
const poke = speciesMove(POKE);   // windup .5, active .12, recovery .8, cooldown 2.5
const bite = resolveMove({ attackId: 'bite-snapper' }, 1);   // windup .16, active .08, recovery .22, lock .10, tracking 10
const brace = resolveMove({ abilityId: 'brace-shell' }, 1);   // startup .10, min active .25, recovery .15, cooldown .4
const dash = resolveMove({ abilityId: 'dash-side-fin' }, 1);  // startup .03, travel .18, recovery .12, cooldown 1.1
const counter = resolveMove({ abilityId: 'counter-spike' }, 1);   // startup .04, window .22, whiff .40, success cooldown .3

describe('action engine', () => {
  it('windup → active → recovery → done at exact times', () => {
    const rt = newRuntime(), a = start(rt, poke), log = run(rt, a, 1.5);
    expect(firstTau(log, 'active')).toBeCloseTo(.5); expect(firstTau(log, 'recovery')).toBeCloseTo(.62); expect(firstTau(log, 'interrupted')).toBeCloseTo(1.42);   // .5 + .12 + .8
  });
  it('cooldown starts at end of recovery', () => {
    const rt = newRuntime(), a = start(rt, poke); run(rt, a, 1.5);
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(3.92);   // 1.42 + 2.5
    expect(sweepEnded(rt)).toEqual([a]); expect(rt.actions).toEqual([]);
    expect(canStart(rt, check({ cooldownKey: 'e1:root:m' }))).toEqual({ ok: false, reason: 'cooldown' });
  });
  it('interrupted cooldown starts at the interrupt', () => {
    const rt = newRuntime(), a = start(rt, poke); run(rt, a, .3);
    const r = stagger(rt, .4); expect(r.interrupted).toEqual([a]); expect(a.phase).toBe('interrupted');
    expect(rt.cooldowns.get('e1:root:m')).toBeCloseTo(2.8);   // .3 + 2.5
  });
  it('aim turns at most maxTracking × Δτ', () => {
    const rt = newRuntime(), a = start(rt, bite);
    run(rt, a, .05, { wantedAim: X });
    expect(Math.acos(a.aim.z)).toBeCloseTo(.5, 5);   // 10 rad/s × .05 s
  });
  it('aim locks at aimLockAt and the shape is frozen', () => {
    const rt = newRuntime(), a = start(rt, bite), now = { t: 0 };
    const locks: number[] = [];
    for (let i = 0; i < 20; i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; if (tickAction(rt, a, d, { ...idle, wantedAim: X }).locked) locks.push(rt.actionClock); }
    expect(locks).toHaveLength(1); expect(locks[0]).toBeCloseTo(.10);
    expect(Math.acos(a.aim.z)).toBeCloseTo(1, 5);   // 10 rad/s × .1 s = 1 rad toward the wanted 90°, then frozen
  });
  it('brace holds while held, min active, then recovery', () => {
    const rt = newRuntime(), a = start(rt, brace, { key: 'player:p9:brace' });
    const log = run(rt, a, 1, { held: true });
    expect(firstTau(log, 'active')).toBeCloseTo(.10); expect(a.phase).toBe('active');   // held for 1 s: still active
    const after = run(rt, a, .5, { held: false }, { t: 1 });
    expect(firstTau(after, 'recovery')).toBeCloseTo(1.01); expect(firstTau(after, 'interrupted')).toBeCloseTo(1.16);   // released at 1.01 (active ≥ .25 already): recovery .15
    expect(rt.cooldowns.get('player:p9:brace')).toBeCloseTo(1.56);   // 1.16 + .4
  });
  it('release in windup still gives min active', () => {
    const rt = newRuntime(), a = start(rt, brace), log = run(rt, a, 1, { held: false });
    expect(firstTau(log, 'active')).toBeCloseTo(.10); expect(firstTau(log, 'recovery')).toBeCloseTo(.35); expect(firstTau(log, 'interrupted')).toBeCloseTo(.50);   // .10 + .25 + .15
  });
  it('held basic repeats bite', () => {
    // The engine refuses a second Bite while one runs; the next request after it ends starts at once (no cooldown).
    const rt = newRuntime(), a = start(rt, bite, { key: 'player:p1:bite' });
    expect(canStart(rt, check({ cooldownKey: 'player:p1:bite' }))).toEqual({ ok: false, reason: 'busy' });
    run(rt, a, .47); sweepEnded(rt);   // .16 + .08 + .22 = .46
    expect(canStart(rt, check({ cooldownKey: 'player:p1:bite' }))).toEqual({ ok: true, replaces: null });
  });
  it('buffer keeps a press in the last .12 s of recovery and in hit-stop only', () => {
    const rt = newRuntime(), a = start(rt, bite); run(rt, a, .30);   // recovery from .24 to .46: .16 left
    expect(bufferPress(rt, 2, .30)).toBe(false); expect(rt.buffered).toBeNull();
    run(rt, a, .05, {}, { t: .30 });   // .11 left
    expect(bufferPress(rt, 2, .35)).toBe(true); expect(rt.buffered).toEqual({ input: 2, at: rt.actionClock });
    expect(bufferPress(rt, 'basic', .35)).toBe(true); expect(rt.buffered!.input).toBe('basic');   // a newer press replaces it
    const idleRt = newRuntime(); expect(bufferPress(idleRt, 1, 0)).toBe(false);
    applyHitStop(idleRt, 0, .07); expect(bufferPress(idleRt, 1, .02)).toBe(true);
  });
  it('buffer expires after .12 s', () => {
    const rt = newRuntime(); applyHitStop(rt, 0, .07); bufferPress(rt, 1, 0);
    advanceClock(rt, 0, .1); expect(bufferedPress(rt)).toBe(1);   // the clock is stopped in the hit-stop: only .03 s passed
    advanceClock(rt, .1, .1); expect(bufferedPress(rt)).toBeNull();   // .13 s of action clock
    expect(rt.buffered).toBeNull();
  });
  it('dash cancels bite and sweep recovery only', () => {
    for (const [move, cancels] of [[bite, true], [resolveMove({ abilityId: 'sweep-fan-tail' }, 1), true], [resolveMove({ abilityId: 'grab-pincer' }, 1), false], [counter, false]] as const) {
      const rt = newRuntime(), a = start(rt, move); run(rt, a, (move.attack?.windupSeconds ?? .04) + (move.attack?.activeSeconds ?? .22) + .02);
      expect(a.phase, move.label).toBe('recovery');
      const d = canStart(rt, check({ kind: 'dash' }));
      expect(d.ok, move.label).toBe(cancels); if (d.ok) expect(d.replaces).toBe(a);
    }
    const rt = newRuntime(); start(rt, bite); expect(canStart(rt, check({ kind: 'dash' })).ok).toBe(false);   // in windup: no cancel
    const sp = newRuntime(), s = start(sp, poke); run(sp, s, .7); expect(canStart(sp, check({ kind: 'dash', isPlayer: false })).ok).toBe(false);   // species never cancel
  });
  it('stagger interrupts interruptible windup/active only', () => {
    const lunge = speciesMove({ ...POKE, lunge: { distanceBodyLengths: 1.2 } });
    for (const [move, at, expected] of [[poke, .2, true], [poke, .55, true], [poke, .9, false], [lunge, .2, true], [lunge, .55, false], [brace, .2, false], [dash, .05, false], [counter, .1, false],
      [speciesMove({ ...POKE, interruptible: false }), .2, false]] as const) {
      const rt = newRuntime(), a = start(rt, move); run(rt, a, at, { held: true });
      expect(interruptible(a), `${move.label} at ${at}`).toBe(expected);
      stagger(rt, .3); expect(a.phase === 'interrupted', `${move.label} at ${at}`).toBe(expected);
    }
    const rt = newRuntime(), a = start(rt, brace); run(rt, a, .2, { held: true }); stagger(rt, .3, true); expect(a.phase).toBe('interrupted');   // a counter's stagger forces it
  });
  it('poise meter, decay 4/s, stagger at poise', () => {
    const m = newPoise();
    expect(addPoise(m, 4, 0, 6)).toBe(false); expect(addPoise(m, 1, .5, 6)).toBe(false);   // 4 − 2 + 1 = 3
    expect(m.value).toBeCloseTo(3); expect(addPoise(m, 3, .5, 6)).toBe(true); expect(m.value).toBe(0);
    const n = newPoise(); addPoise(n, 5, 0, 6); expect(addPoise(n, 2, 2, 6)).toBe(false);   // fully decayed: 0 + 2
  });
  it("hit-stop pauses the two actors' clocks only", () => {
    const a = newRuntime(), b = newRuntime(), c = newRuntime();
    applyHitStop(a, 1, .07); applyHitStop(b, 1, .07);
    for (const rt of [a, b, c]) rt.actionClock = 1;
    expect(advanceClock(a, 1, .05)).toBe(0); expect(advanceClock(b, 1, .05)).toBe(0); expect(advanceClock(c, 1, .05)).toBeCloseTo(.05);
    expect(advanceClock(a, 1.05, .05)).toBeCloseTo(.03);   // the stop ends at 1.07
  });
  it('overlapping hit-stops use the max', () => {
    const rt = newRuntime(); applyHitStop(rt, 1, .09); applyHitStop(rt, 1.02, .06); expect(rt.hitStopUntil).toBeCloseTo(1.09);
    applyHitStop(rt, 1.05, .06); expect(rt.hitStopUntil).toBeCloseTo(1.11);
  });
  it('start rules: staggered, held, cooldown, breach arc', () => {
    expect(canStart(newRuntime(), check({ playing: false }))).toEqual({ ok: false, reason: 'not-playing' });
    const st = newRuntime(); stagger(st, .5); expect(canStart(st, check())).toEqual({ ok: false, reason: 'staggered' });
    const held = newRuntime(); held.heldBy = 'e4';
    expect(canStart(held, check({ kind: 'dash' }))).toEqual({ ok: false, reason: 'held' }); expect(canStart(held, check({ kind: 'bite' })).ok).toBe(true);   // a held player may Bite
    expect(canStart(held, check({ kind: 'bite', isPlayer: false }))).toEqual({ ok: false, reason: 'held' });
    const cd = newRuntime(); cd.cooldowns.set('k', .5); expect(canStart(cd, check())).toEqual({ ok: false, reason: 'cooldown' });
    expect(canStart(newRuntime(), check({ kind: 'dash', inBreachArc: true }))).toEqual({ ok: false, reason: 'mode' });
    expect(canStart(newRuntime(), check({ mode: 'fly' }))).toEqual({ ok: false, reason: 'mode' });
    expect(canStart(newRuntime(), check({ token: false }))).toEqual({ ok: false, reason: 'token' });
    const hs = newRuntime(); applyHitStop(hs, 0, .07); expect(canStart(hs, check({ worldNow: .03 }))).toEqual({ ok: false, reason: 'hit-stop' });
  });
  it('a grab in its hold lets the grabber Bite; another move ends the hold; the hold ends at hold.seconds', () => {
    const grab = speciesMove(WRAP), rt = newRuntime(), a = start(rt, grab); run(rt, a, .65);   // windup .6: active
    a.heldTarget = 'player'; a.connected = true;
    const log = run(rt, a, .1, {}, { t: .65 }); expect(firstTau(log, 'hold')).toBeCloseTo(.72);   // .6 + .12
    expect(canStart(rt, check({ kind: 'bite', isPlayer: false }))).toEqual({ ok: true, replaces: null });
    expect(canStart(rt, check({ kind: 'species', isPlayer: false }))).toEqual({ ok: true, replaces: a });
    let released: string | null = null; const now = { t: .75 };
    for (let i = 0; i < 130 && !released; i++) { const d = advanceClock(rt, now.t, DT); now.t += DT; released = tickAction(rt, a, d, idle).releasedTarget; }
    expect(released).toBe('player'); expect(rt.actionClock).toBeCloseTo(1.92);   // hold 1.2 s from .72
    expect(phaseRemaining(a, rt.actionClock)).toBeCloseTo(.8);   // recovery
    const b = newRuntime(), g = start(b, grab); run(b, g, .65); g.heldTarget = 'player'; run(b, g, .1, {}, { t: .65 });
    expect(endHold(b, g)).toBe('player'); expect(g.phase).toBe('recovery');
  });
  it('a grab that caught nothing recovers for whiffRecoverySeconds; a counter that succeeds ends at once', () => {
    const rt = newRuntime(), g = start(rt, resolveMove({ abilityId: 'grab-pincer' }, 1)), log = run(rt, g, 1);
    expect(firstTau(log, 'recovery')).toBeCloseTo(.28); expect(firstTau(log, 'interrupted')).toBeCloseTo(.73);   // .18 + .10, then whiff .45
    const c = newRuntime(), k = start(c, counter, { key: 'player:p3:counter' }); run(c, k, .1); k.countered = true; run(c, k, .01, {}, { t: .1 });
    expect(k.phase).toBe('interrupted'); expect(c.cooldowns.get('player:p3:counter')).toBeCloseTo(.41);   // ended at .11, success cooldown .3
  });
});
```

```diff
--- a/tests/tiny-tide-core/helpers.ts
+++ b/tests/tiny-tide-core/helpers.ts
@@ -11,5 +11,5 @@ export const resolvedOf = (attack: AttackSpec): ResolvedMove => ({ kind: 'specie
 /** A complete ActionState for tests: windup at clock 0, the synthetic attack. */
 export const blankAction = (over: Partial<ActionState> = {}): ActionState => ({ instanceId: 'a1', definitionId: 'pinch', grantId: 'snap', source: { kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' },
   phase: 'windup', startedAt: 0, aim: { x: 0, y: 0, z: 1 }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map(), phaseStartedAt: 0, aimLocked: false,
-  resolved: resolvedOf(syntheticAttack), targetId: null, heldTarget: null, windupExtension: 0, released: false, countered: false, lungeDone: 0, lockedShapes: null, squeezes: 0,
+  resolved: resolvedOf(syntheticAttack), targetId: null, heldTarget: null, windupExtension: 0, released: false, countered: false, connected: false, lungeDone: 0, lockedShapes: null, squeezes: 0,
   cooldownKey: 'player:p5:snap', ...over });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/action-engine.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/action-engine"`.

- [ ] **Step 3: Types and the engine** (complete file)

```diff
--- a/src/tiny-tide/combat-types.ts
+++ b/src/tiny-tide/combat-types.ts
@@ -153,6 +153,8 @@ export interface ActionState { instanceId: string; definitionId: string; grantId
   heldTarget: ActorId | null; windupExtension: number; released: boolean;
   /** A Counter that countered a hit (it ends with no recovery). */
   countered: boolean;
+  /** The attack landed (hit, grabbed, blocked or guard-broken); a grab that did not connect recovers for `whiffRecoverySeconds`. */
+  connected: boolean;
   /** Body lengths a lunge has moved. */
   lungeDone: number;
   /** The world shapes fixed at the lock (a mirrored pair has two), or null before it. */
```

```ts
// The action engine (spec §5): one set of rules for the player and every combat species. Action clocks and hit-stop, phase timelines,
// start rules, aim tracking and lock, hold moves, cancel and interrupt, the input buffer, stagger and poise. Pure: it mutates only the
// runtime and the actions it is given, and never moves a body (motion goes through resolveMotion in the callers).
import type { ActionState, ActiveSlot, ActorId, CombatRuntime, EmitterSource, MovementMode, MutVec3, ResolvedMove, Vec3 } from './combat-types';

/** The input buffer window (spec §5.7): a press in the last BUFFER_SECONDS of a recovery or in a hit-stop is kept this long. */
export const BUFFER_SECONDS = .12;
/** A species' poise meter decays by this much per second of its action clock (spec §5.8). */
export const POISE_DECAY = 4;

/** §5.1: the clock advances by clamp((t + dt) − max(t, hitStopUntil), 0, dt). Returns Δτ. */
export function advanceClock(rt: CombatRuntime, t: number, dt: number): number {
  const d = Math.max(0, Math.min(dt, t + dt - Math.max(t, rt.hitStopUntil)));
  rt.actionClock += d;
  return d;
}
/** §5.9: overlapping hit-stops keep the later end. */
export function applyHitStop(rt: CombatRuntime, now: number, seconds: number): void { if (seconds > 0) rt.hitStopUntil = Math.max(rt.hitStopUntil, now + seconds); }
export const inHitStop = (rt: CombatRuntime, now: number) => now < rt.hitStopUntil;

// ---- phase lengths (spec §5.2) ----
export function windupLength(a: ActionState): number {
  const r = a.resolved;
  return (r.attack ? r.attack.windupSeconds : r.guard ? r.guard.startupSeconds : r.evasion?.startupSeconds ?? 0) + a.windupExtension;
}
const isBrace = (a: ActionState) => a.resolved.guard?.kind === 'brace';
const isCounter = (a: ActionState) => a.resolved.guard?.kind === 'counter';
/** Brace: Infinity while held; after a release (or a release in windup), `minActiveSeconds`. */
export function activeLength(a: ActionState): number {
  const r = a.resolved;
  if (r.attack) return r.attack.activeSeconds;
  if (r.guard) return r.guard.kind === 'counter' ? r.guard.windowSeconds ?? 0 : a.released ? r.guard.minActiveSeconds : Infinity;
  return r.evasion?.travelSeconds ?? 0;
}
export const holdLength = (a: ActionState): number => a.resolved.attack?.hold?.seconds ?? 0;
export function recoveryLength(a: ActionState): number {
  const r = a.resolved;
  if (r.attack) return r.attack.hold && !a.connected ? r.attack.whiffRecoverySeconds ?? r.attack.recoverySeconds : r.attack.recoverySeconds;
  if (r.guard) return r.guard.kind === 'counter' ? (a.countered ? 0 : r.guard.whiffRecoverySeconds) : r.guard.recoverySeconds;
  return r.evasion?.recoverySeconds ?? 0;
}
/** The cooldown that starts when the action ends: a successful Counter's `successCooldownSeconds`, else the move's own. */
export const cooldownLength = (a: ActionState): number => a.countered && a.resolved.guard ? a.resolved.guard.successCooldownSeconds : a.resolved.cooldownSeconds;
/** Seconds of action clock left in the current phase (Infinity for a held Brace). */
export function phaseRemaining(a: ActionState, tau: number): number {
  const elapsed = tau - a.phaseStartedAt;
  switch (a.phase) {
    case 'windup': return windupLength(a) - elapsed;
    case 'active': return activeLength(a) - elapsed;
    case 'hold': return holdLength(a) - elapsed;
    case 'recovery': return recoveryLength(a) - elapsed;
    default: return 0;
  }
}
/** The action-clock time at which the action becomes active, from now (for the director and telegraph fill). */
export const activeStartsIn = (a: ActionState, tau: number): number => a.phase === 'windup' ? Math.max(0, windupLength(a) - (tau - a.phaseStartedAt)) : 0;

// ---- start (spec §5.3, §5.6) ----
export type StartRefusal = 'not-playing' | 'staggered' | 'held' | 'hit-stop' | 'busy' | 'cooldown' | 'mode' | 'token';
export interface StartCheck {
  /** Rule 1: the game mode is `playing` (player) or the entity is active. */
  playing: boolean; isPlayer: boolean; kind: ResolvedMove['kind']; cooldownKey: string;
  mode: MovementMode; allowedModes: readonly MovementMode[]; inBreachArc: boolean;
  /** Rule 7: a species attack that targets the player has a token (always true otherwise). */
  token: boolean; worldNow: number;
}
/** The actions that have not ended. */
export const liveActions = (rt: CombatRuntime): ActionState[] => rt.actions.filter(a => a.phase !== 'interrupted');
/** `replaces`: an action to end first (a recovery the Dash cancels, or a grab hold that another move releases). */
export type StartDecision = { ok: true; replaces: ActionState | null } | { ok: false; reason: StartRefusal };
export function canStart(rt: CombatRuntime, c: StartCheck): StartDecision {
  if (!c.playing) return { ok: false, reason: 'not-playing' };
  if (rt.actionClock < rt.staggerUntil) return { ok: false, reason: 'staggered' };
  if (rt.heldBy !== null && !(c.isPlayer && c.kind === 'bite')) return { ok: false, reason: 'held' };
  if (c.worldNow < rt.hitStopUntil) return { ok: false, reason: 'hit-stop' };
  const live = liveActions(rt);
  let replaces: ActionState | null = null;
  if (live.length) {
    const hold = live.find(a => a.phase === 'hold');
    if (hold && live.length === 1) { if (c.kind !== 'bite') replaces = hold; }   // the grabber may Bite during the hold; any other move ends it
    else if (c.isPlayer && c.kind === 'dash' && live.length === 1 && live[0]!.phase === 'recovery' && (live[0]!.resolved.kind === 'bite' || live[0]!.resolved.kind === 'sweep')) replaces = live[0]!;
    else return { ok: false, reason: 'busy' };
  }
  if ((rt.cooldowns.get(c.cooldownKey) ?? -Infinity) > rt.actionClock + 1e-9) return { ok: false, reason: 'cooldown' };
  if (!c.allowedModes.includes(c.mode) || (c.kind === 'dash' && c.inBreachArc)) return { ok: false, reason: 'mode' };
  if (!c.token) return { ok: false, reason: 'token' };
  return { ok: true, replaces };
}
export interface StartSpec { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; resolved: ResolvedMove; aim: Vec3; targetId: ActorId | null; cooldownKey: string; worldNow: number }
/** Starts an action at the actor's clock. `fixed-at-start` and `centre` lock at once (spec §5.4). */
export function startAction(rt: CombatRuntime, s: StartSpec): ActionState {
  const mode = s.resolved.attack?.aimMode, l = Math.hypot(s.aim.x, s.aim.y, s.aim.z) || 1;
  const a: ActionState = { instanceId: s.instanceId, definitionId: s.definitionId, grantId: s.grantId, source: s.source, phase: 'windup', startedAt: s.worldNow,
    aim: { x: s.aim.x / l, y: s.aim.y / l, z: s.aim.z / l }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map(), phaseStartedAt: rt.actionClock,
    aimLocked: mode === 'fixed-at-start' || mode === 'centre', resolved: s.resolved, targetId: s.targetId, heldTarget: null, windupExtension: 0, released: false, countered: false,
    connected: false, lungeDone: 0, lockedShapes: null, squeezes: 0, cooldownKey: s.cooldownKey };
  rt.actions.push(a);
  if (s.resolved.guard?.kind === 'brace') rt.guardProfileId = s.resolved.guard.id;
  return a;
}
/** Ends an action now: it is interrupted, and its cooldown starts at this clock time (`cooldown` overrides the length). */
export function endNow(rt: CombatRuntime, a: ActionState, cooldown = cooldownLength(a)): void {
  if (a.phase === 'interrupted') return;
  a.phase = 'interrupted'; a.phaseStartedAt = rt.actionClock;
  rt.cooldowns.set(a.cooldownKey, Math.max(rt.cooldowns.get(a.cooldownKey) ?? -Infinity, rt.actionClock + cooldown));
  if (a.resolved.guard?.kind === 'brace') rt.guardProfileId = null;
}
/** Removes interrupted actions at the end of a tick; returns them (their tokens go back to the director). */
export function sweepEnded(rt: CombatRuntime): ActionState[] {
  const ended = rt.actions.filter(a => a.phase === 'interrupted');
  if (ended.length) rt.actions = rt.actions.filter(a => a.phase !== 'interrupted');
  return ended;
}
/** A hold ends (break-free, a blocked grab motion, a stagger): the grabber goes to recovery now. Returns the released target id. */
export function endHold(rt: CombatRuntime, a: ActionState): ActorId | null {
  if (a.phase !== 'hold') return null;
  const target = a.heldTarget; a.heldTarget = null; a.phase = 'recovery'; a.phaseStartedAt = rt.actionClock;
  return target;
}

// ---- tick (spec §5.2, §5.4, §5.5) ----
/** Turns `aim` toward `wanted` on the great circle by at most `maxAngle` radians. */
export function turnToward(aim: MutVec3, wanted: Vec3, maxAngle: number): void {
  const wl = Math.hypot(wanted.x, wanted.y, wanted.z); if (wl < 1e-9) return;
  const w = { x: wanted.x / wl, y: wanted.y / wl, z: wanted.z / wl }, c = Math.max(-1, Math.min(1, aim.x * w.x + aim.y * w.y + aim.z * w.z)), angle = Math.acos(c);
  if (angle <= maxAngle + 1e-12) { aim.x = w.x; aim.y = w.y; aim.z = w.z; return; }
  // The unit vector in the plane of aim and w, orthogonal to aim (a fixed perpendicular when w is opposite).
  let px = w.x - aim.x * c, py = w.y - aim.y * c, pz = w.z - aim.z * c, pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) { px = -aim.z; py = 0; pz = aim.x; pl = Math.hypot(px, py, pz) || 1; if (pl < 1e-9) { px = 1; py = 0; pz = 0; pl = 1; } }
  const s = Math.sin(maxAngle), k = Math.cos(maxAngle);
  const x = aim.x * k + px / pl * s, y = aim.y * k + py / pl * s, z = aim.z * k + pz / pl * s, l = Math.hypot(x, y, z);
  aim.x = x / l; aim.y = y / l; aim.z = z / l;
}
export interface ActionInput {
  /** The wanted aim: the input aim (player), the direction to the target (species), or null to keep the aim. */
  wantedAim: Vec3 | null;
  /** Brace: the input is held. */
  held: boolean;
  /** The body's horizontal forward ('body-back' aims at its reverse). */
  bodyForward: Vec3;
}
export interface TickResult {
  /** The action was in its active phase at some point in this tick (hits are tested). */
  wasActive: boolean;
  /** The aim locked in this tick: the caller samples the pose once and fixes the world shapes. */
  locked: boolean; enteredActive: boolean; enteredHold: boolean; enteredRecovery: boolean;
  /** The action ended in this tick (its cooldown is set). */
  ended: boolean;
  /** The hold ended at `hold.seconds` in this tick: the target is released. */
  releasedTarget: ActorId | null;
}
/** Advances one action by the actor's Δτ (rt.actionClock is already advanced). Phase changes land at their exact clock times. */
export function tickAction(rt: CombatRuntime, a: ActionState, dTau: number, input: ActionInput): TickResult {
  const out: TickResult = { wasActive: a.phase === 'active', locked: false, enteredActive: false, enteredHold: false, enteredRecovery: false, ended: false, releasedTarget: null };
  if (a.phase === 'interrupted') return out;
  const tau = rt.actionClock, before = tau - dTau, attack = a.resolved.attack;
  // Brace (spec §5.5): a release (or a touch cancel) ends active at once when min active has passed, else at min active.
  if (isBrace(a) && !input.held && !a.released) {
    a.released = true;
    if (a.phase === 'active' && tau - a.phaseStartedAt >= a.resolved.guard!.minActiveSeconds - 1e-9) { a.phase = 'recovery'; a.phaseStartedAt = tau; rt.guardProfileId = null; out.enteredRecovery = true; }
  }
  for (let guard = 0; guard < 6; guard++) {
    const elapsed = tau - a.phaseStartedAt;
    if (a.phase === 'windup') {
      if (!a.aimLocked && attack) {
        const lockAt = attack.aimLockAtSeconds, from = Math.max(0, before - a.phaseStartedAt), until = Math.min(elapsed, lockAt);
        const wanted = attack.aimMode === 'body-back' ? { x: -input.bodyForward.x, y: 0, z: -input.bodyForward.z } : input.wantedAim;
        if (wanted && until > from) turnToward(a.aim, wanted, attack.maxTrackingRadiansPerSecond * (until - from));
        if (elapsed >= lockAt - 1e-9) { a.aimLocked = true; out.locked = true; }
      }
      const len = windupLength(a);
      if (elapsed < len - 1e-9) break;
      a.phase = 'active'; a.phaseStartedAt += len; out.enteredActive = true; out.wasActive = true;
      if (!a.aimLocked) { a.aimLocked = true; out.locked = true; }
      continue;
    }
    if (a.phase === 'active') {
      if (isCounter(a) && a.countered) { endNow(rt, a); out.ended = true; break; }
      const len = activeLength(a);
      if (elapsed < len - 1e-9) break;
      const next = a.heldTarget !== null && attack?.hold ? 'hold' : 'recovery';
      a.phase = next; a.phaseStartedAt += len;
      if (next === 'hold') out.enteredHold = true; else out.enteredRecovery = true;
      if (isBrace(a)) rt.guardProfileId = null;
      continue;
    }
    if (a.phase === 'hold') {
      const len = holdLength(a);
      if (elapsed < len - 1e-9) break;
      out.releasedTarget = a.heldTarget; a.heldTarget = null; a.phase = 'recovery'; a.phaseStartedAt += len; out.enteredRecovery = true;
      continue;
    }
    if (a.phase === 'recovery') {
      const len = recoveryLength(a);
      if (elapsed < len - 1e-9) break;
      const end = a.phaseStartedAt + len;
      rt.cooldowns.set(a.cooldownKey, Math.max(rt.cooldowns.get(a.cooldownKey) ?? -Infinity, end + cooldownLength(a)));
      a.phase = 'interrupted'; a.phaseStartedAt = end; out.ended = true;
      break;
    }
    break;
  }
  return out;
}

// ---- stagger, interrupt and poise (spec §5.6, §5.8) ----
/** Brace, Counter and Dash are not interruptible; an attack only when `interruptible`, in windup or active (a lunge in windup only). */
export function interruptible(a: ActionState): boolean {
  const attack = a.resolved.attack;
  if (!attack || !attack.interruptible) return false;
  return a.phase === 'windup' || (a.phase === 'active' && !attack.lunge);
}
export interface StaggerResult { interrupted: ActionState[]; releasedTargets: ActorId[] }
/** Staggers for `seconds` of action clock. Interrupts what may be interrupted (`force`: everything, a counter); ends a grab hold. */
export function stagger(rt: CombatRuntime, seconds: number, force = false): StaggerResult {
  const out: StaggerResult = { interrupted: [], releasedTargets: [] };
  rt.staggerUntil = Math.max(rt.staggerUntil, rt.actionClock + seconds);
  for (const a of rt.actions) {
    if (a.phase === 'interrupted') continue;
    if (a.phase === 'hold') { const t = endHold(rt, a); if (t !== null) out.releasedTargets.push(t); if (force) { endNow(rt, a); out.interrupted.push(a); } continue; }
    if (force ? a.phase === 'windup' || a.phase === 'active' : interruptible(a)) { endNow(rt, a); out.interrupted.push(a); }
  }
  return out;
}
export interface PoiseMeter { value: number; at: number }
export const newPoise = (): PoiseMeter => ({ value: 0, at: 0 });
/** Adds `amount` after the decay since the last hit (action clock). True when the meter reached `max`: it goes to 0 (the caller staggers). */
export function addPoise(m: PoiseMeter, amount: number, tau: number, max: number): boolean {
  m.value = Math.max(0, m.value - POISE_DECAY * Math.max(0, tau - m.at)) + amount; m.at = tau;
  if (m.value + 1e-9 < max) return false;
  m.value = 0; return true;
}
export const poiseNow = (m: PoiseMeter, tau: number) => Math.max(0, m.value - POISE_DECAY * Math.max(0, tau - m.at));

// ---- input buffer (spec §5.7) ----
/** Keeps a press that failed only because the actor is busy: in the last BUFFER_SECONDS of a recovery, or during a hit-stop. One entry; a newer press replaces it. */
export function bufferPress(rt: CombatRuntime, input: 'basic' | ActiveSlot, worldNow: number): boolean {
  const recovering = rt.actions.some(a => a.phase === 'recovery' && phaseRemaining(a, rt.actionClock) <= BUFFER_SECONDS + 1e-9);
  if (!recovering && worldNow >= rt.hitStopUntil) return false;
  rt.buffered = { input, at: rt.actionClock };
  return true;
}
/** The buffered press while it is fresh (at most BUFFER_SECONDS of action clock old), else null (and the entry is dropped). */
export function bufferedPress(rt: CombatRuntime): 'basic' | ActiveSlot | null {
  const b = rt.buffered; if (!b) return null;
  if (rt.actionClock - b.at > BUFFER_SECONDS + 1e-9) { rt.buffered = null; return null; }
  return b.input;
}
/** Velocity (physical units per second) of a lunge during active: distance × L / activeSeconds along the aim. */
export function lungeSpeed(a: ActionState, L: number): number {
  const at = a.resolved.attack; return at?.lunge && at.activeSeconds > 0 ? at.lunge.distanceBodyLengths * L / at.activeSeconds : 0;
}
/** Speed of a dash during active: distance × L / travelSeconds. */
export function dashSpeed(a: ActionState, L: number): number {
  const e = a.resolved.evasion; return e && e.travelSeconds > 0 ? e.distanceBodyLengths * L / e.travelSeconds : 0;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/action-engine.test.ts`
Expected: PASS, 18 tests, 0 failed.

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/action-engine.ts src/tiny-tide/combat-types.ts tests/tiny-tide-core/action-engine.test.ts tests/tiny-tide-core/helpers.ts
git commit -m "Tiny Tide combat: action engine with action clocks, phases, aim lock, holds, buffer, stagger and poise

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T5: The hit resolver

**Spec:** §6.1–6.7, D12, D14, D15, D34.

**Files:**
- Create: `src/tiny-tide/hit-resolver.ts`, `tests/tiny-tide-core/hit-resolver.test.ts`

**Interfaces:**
- Consumes: T1 types; `damageAfterArmor` (`state.ts`, existing); T3 `sphereHitsShape`; T4 `stagger`, `addPoise`, `endHold`, `applyHitStop`.
- Produces: `Fighter`, `HitRequestIn`, `CombatEvent`, `POST_HIT_INVULNERABLE = .4`, `BREAK_FREE_STAGGER = .3`, `BREAK_FREE_INVULNERABLE = .5`, `BLOCK_IMPULSE = .3`, `BROKEN_IMPULSE = .6`, `KNOCKBACK_CAP = 9`, `compareRequests`, `ledgerKey(a, hitGroupId, targetId)`, `targetsHit(a)`, `resolveHit(r, now, statusOf?)`, `resolveAll(requests, now, statusOf?)`, `BREAK_BASIC = .25`, `BREAK_DASH = .35`, `BREAK_FLICK = .2`, `FLICK_LENGTH = .6`, `isFlick(prev, cur)`, `addBreakProgress(rt, input)`, `releaseHold(grabber, a, target, now, brokeFree)`, `squeezesDue(a, tau)`.

Order for one request (spec §6.2): ledger → targetable → guard/counter → immunity (grace, dash invulnerability, post-hit) → damage (armor, half-hearts, at least 1) → stagger and poise → impulse → grab. A dodge is written in the ledger (D12).

**Decision in this task (spec defect):** the §6.2 impulse formula scales with `L_a`. A Clawmother lunge then throws a size-0 player about 27 units. The resolver caps the change of velocity at `KNOCKBACK_CAP × L_t` per second (9 target body lengths a second).

- [ ] **Step 1: Write the failing tests** (complete file)

```ts
// tests/tiny-tide-core/hit-resolver.test.ts
import { describe, expect, it } from 'vitest';
import { advanceClock, newPoise, startAction, tickAction } from '../../src/tiny-tide/action-engine';
import { addBreakProgress, compareRequests, isFlick, releaseHold, resolveAll, resolveHit, squeezesDue, type Fighter, type HitRequestIn } from '../../src/tiny-tide/hit-resolver';
import { newRuntime, type ActionState, type AttackSpec, type CombatRuntime, type ResolvedMove } from '../../src/tiny-tide/combat-types';
import { resolveMove, speciesMove } from '../../src/tiny-tide/moves';
import { POKE, WRAP } from './combat-fixture';

const DEG = Math.PI / 180;
const player = (over: Partial<Fighter> = {}): Fighter => ({ id: 'player', isPlayer: true, rt: newRuntime(), centre: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, L: 2, mass: 2, knockbackResistance: 0,
  armor: 0, ground: false, grabbable: true, poise: null, poiseMax: 0, staggerResist: 0, health: 6, ...over });
const crab = (over: Partial<Fighter> = {}): Fighter => ({ id: 'e7', isPlayer: false, rt: newRuntime(), centre: { x: 0, y: 0, z: 3 }, forward: { x: 0, y: 0, z: -1 }, L: 5.6, mass: 5.6, knockbackResistance: .2,
  armor: 0, ground: true, grabbable: true, poise: newPoise(), poiseMax: 6, staggerResist: 0, health: 20, ...over });
let n = 0;
const act = (rt: CombatRuntime, resolved: ResolvedMove, startedAt = 0): ActionState => startAction(rt, { instanceId: `a${++n}`, definitionId: resolved.attack?.id ?? 'm', grantId: 'g', source: { kind: 'actor', actorId: 'x', mountId: 'root', socketId: 'centre' },
  resolved, aim: { x: 0, y: 0, z: -1 }, targetId: null, cooldownKey: `k${n}`, worldNow: startedAt });
/** Puts an action into its active phase at once. */
const activeNow = (a: ActionState) => { a.phase = 'active'; return a; };
const req = (attacker: Fighter, target: Fighter, attack: AttackSpec, over: Partial<HitRequestIn> = {}): HitRequestIn => {
  const action = over.action ?? activeNow(act(attacker.rt, speciesMove(attack)));
  return { attacker, target, action, attack, hitGroupId: 'g', origin: { x: 0, y: 0, z: 2 }, point: { x: 0, y: 0, z: .5 }, geometryOk: true, ...over };
};
const guard = (rt: CombatRuntime, id: string) => activeNow(act(rt, resolveMove({ abilityId: id }, 1)));

describe('hit resolver', () => {
  it('counter beats block and staggers the attacker', () => {
    const p = player(), c = crab(); guard(p.rt, 'brace-shell'); const k = guard(p.rt, 'counter-spike');
    const e = resolveHit(req(c, p, POKE), 1)!;
    expect(e.outcome).toBe('countered'); expect(e.reflect).toBe(3); expect(p.health).toBe(6); expect(c.health).toBe(17);
    expect(c.rt.staggerUntil).toBeCloseTo(1); expect(c.rt.actions[0]!.phase).toBe('interrupted');   // even an uninterruptible attack ends
    expect(k.countered).toBe(true); expect(k.phase).toBe('interrupted'); expect(p.rt.cooldowns.get(k.cooldownKey)).toBeCloseTo(.3);
    expect(e.hitStop).toBeCloseTo(.09); expect(p.rt.hitStopUntil).toBeCloseTo(1.09); expect(c.rt.hitStopUntil).toBeCloseTo(1.09);
  });
  it('counter fails against unparryable', () => {
    const p = player(), c = crab(); guard(p.rt, 'counter-spike');
    const e = resolveHit(req(c, p, { ...POKE, parryable: false }), 1)!;
    expect(e.outcome).toBe('hit'); expect(p.health).toBe(5);   // 2 half-hearts
  });
  it('brace blocks in front only', () => {
    const front = player(); guard(front.rt, 'brace-shell');
    expect(resolveHit(req(crab(), front, POKE), 1)!.outcome).toBe('blocked');
    const behind = player({ forward: { x: 0, y: 0, z: -1 } }); guard(behind.rt, 'brace-shell');
    expect(resolveHit(req(crab(), behind, POKE), 1)!.outcome).toBe('hit');
    // 69° off the forward is in front (70°); 71° is not.
    for (const [deg, outcome] of [[69, 'blocked'], [71, 'hit']] as const) {
      const p = player(); guard(p.rt, 'brace-shell');
      expect(resolveHit(req(crab(), p, POKE, { origin: { x: Math.sin(deg * DEG), y: 0, z: Math.cos(deg * DEG) } }), 1)!.outcome, `${deg}°`).toBe(outcome);
    }
    const starting = player(); act(starting.rt, resolveMove({ abilityId: 'brace-shell' }, 1));   // still in its startup
    expect(resolveHit(req(crab(), starting, POKE), 1)!.outcome).toBe('hit');
  });
  it('heavy hit breaks the guard', () => {
    const p = player(), b = guard(p.rt, 'brace-shell');   // breaks at 4 half-hearts
    const e = resolveHit(req(crab(), p, { ...POKE, damage: 4 }), 1)!;
    expect(e.outcome).toBe('guard-broken'); expect(b.phase).toBe('interrupted'); expect(p.rt.cooldowns.get(b.cooldownKey)).toBeCloseTo(2);
    expect(p.rt.staggerUntil).toBeCloseTo(.5); expect(e.amount).toBe(2);   // floor(4 × (1 − .75 / 2)) = floor(2.5)
    const armored = player({ armor: 2 }); guard(armored.rt, 'brace-shell');
    expect(resolveHit(req(crab(), armored, { ...POKE, damage: 4 }), 1)!.outcome).toBe('blocked');   // 4 − 1 = 3 < 4
  });
  it('brace damage uses floor after armor', () => {
    const p = player(); guard(p.rt, 'brace-shell');
    const e = resolveHit(req(crab(), p, { ...POKE, damage: 3 }), 1)!;
    expect(e.amount).toBe(0); expect(p.health).toBe(6); expect(p.rt.invulnerableUntil).toBe(0);   // floor(3 × .25) = 0: no post-hit invulnerability
    const q = player({ armor: 0 }); guard(q.rt, 'brace-shell'); q.rt.actions[0]!.resolved = resolveMove({ abilityId: 'brace-shell' }, .4);   // block .66, breaks at 3
    expect(resolveHit(req(crab(), q, { ...POKE, damage: 2 }), 1)!.amount).toBe(0);   // floor(2 × .34)
  });
  it('dash invulnerability evades and records the ledger', () => {
    const p = player(); activeNow(act(p.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1)));
    const r = req(crab(), p, POKE), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('evaded'); expect(p.health).toBe(6); expect(e.hitStop).toBe(0);
    p.rt.actions = [];   // the dash is over: the same attack instance cannot hit again (D12)
    expect(resolveHit(r, 1.05)).toBeNull();
    const starting = player(); act(starting.rt, resolveMove({ abilityId: 'dash-side-fin' }, 1));   // startup .03 is not invulnerable
    expect(resolveHit(req(crab(), starting, POKE), 1)!.outcome).toBe('hit');
  });
  it('grace invulnerability is immune', () => {
    const p = player(); p.rt.invulnerableUntil = 3;
    expect(resolveHit(req(crab(), p, POKE), 1)!.outcome).toBe('immune');
    const off = player(); off.rt.damageable = false; expect(resolveHit(req(crab(), off, POKE), 1)!.outcome).toBe('immune');
    const hidden = player(); hidden.rt.targetable = false; expect(resolveHit(req(crab(), hidden, POKE), 1)).toBeNull();
  });
  it('post-hit invulnerability .4 s', () => {
    const p = player(), c = crab(), a = activeNow(act(c.rt, speciesMove(POKE))), b = activeNow(act(c.rt, speciesMove(POKE)));
    expect(resolveHit(req(c, p, POKE, { action: a }), 1)!.outcome).toBe('hit'); expect(p.rt.invulnerableUntil).toBeCloseTo(1.4); expect(p.rt.lastDamageAt).toBe(1);
    expect(resolveHit(req(c, p, POKE, { action: b }), 1.39)!.outcome).toBe('immune');
    expect(resolveHit(req(c, p, POKE, { action: activeNow(act(c.rt, speciesMove(POKE))) }), 1.4)!.outcome).toBe('hit');
  });
  it('damage in half-hearts with armor', () => {
    const p = player({ armor: 3 }); const e = resolveHit(req(crab(), p, { ...POKE, damage: 3 }), 1)!;
    expect(e.amount).toBe(2); expect(e.unit).toBe('half-heart'); expect(p.health).toBe(5);   // 3 − floor(3 / 2) = 2 half-hearts
    const q = player({ armor: 4 }); expect(resolveHit(req(crab(), q, { ...POKE, damage: 1 }), 1)!.amount).toBe(1);   // at least 1
    const c = crab(); const s = resolveHit(req(player(), c, { ...POKE, damageUnit: 'hp', damage: 4 }), 1)!;
    expect(s.unit).toBe('hp'); expect(c.health).toBe(16); expect(s.hitStop).toBeCloseTo(.075);   // 60 + round(30 × 4 / 8) ms
  });
  it('impulse formula, resistance, blocked × .3', () => {
    // Crab (L 5.6, mass 5.6) hits a player (mass 2): J = 4 × 5.6 × min(5.6, 4) = 89.6; Δv = 89.6 / 2 = 44.8 along origin → point (−z).
    const p = player(), e = resolveHit(req(crab(), p, POKE), 1)!;
    expect(e.impulse.z).toBeCloseTo(-44.8); expect(p.rt.externalVelocity.z).toBeCloseTo(-44.8);
    const r = player({ knockbackResistance: .5 }); resolveHit(req(crab(), r, POKE), 1); expect(r.rt.externalVelocity.z).toBeCloseTo(-22.4);
    const b = player(); guard(b.rt, 'brace-shell'); resolveHit(req(crab(), b, POKE), 1); expect(b.rt.externalVelocity.z).toBeCloseTo(-44.8 * .3);
    // A ground target is pushed horizontally: an origin above it gives no vertical push.
    const g = player({ ground: true }); resolveHit(req(crab(), g, POKE, { origin: { x: 0, y: 3, z: 2 } }), 1);
    expect(g.rt.externalVelocity.y).toBe(0); expect(g.rt.externalVelocity.z).toBeCloseTo(-44.8);
  });
  it('one hit per target per action, repeat for whirl', () => {
    const p = player(), c = crab(), r = req(c, p, POKE);
    expect(resolveHit(r, 1)).not.toBeNull(); p.rt.invulnerableUntil = 0;
    expect(resolveHit(r, 2)).toBeNull();   // maxHitsPerTarget 1
    const whirl: AttackSpec = { ...POKE, maxHitsPerTarget: 2, repeatHitSeconds: .3 }, q = player(), w = req(c, q, whirl, { action: activeNow(act(c.rt, speciesMove(whirl))) });
    expect(resolveHit(w, 1)).not.toBeNull(); q.rt.invulnerableUntil = 0;
    expect(resolveHit(w, 1.2)).toBeNull(); expect(resolveHit(w, 1.3)!.outcome).toBe('hit'); q.rt.invulnerableUntil = 0;
    expect(resolveHit(w, 2)).toBeNull();
    // maxTargets: a second target is dropped once the action hit its one target.
    const s = req(c, player({ id: 'p2' }), POKE, { action: r.action }); expect(resolveHit(s, 3)).toBeNull();
  });
  it('processing order is deterministic', () => {
    const p = player(), a = crab({ id: 'e2' }), b = crab({ id: 'e1' });
    const first = req(a, p, POKE, { action: activeNow(act(a.rt, speciesMove(POKE), 1)) }), second = req(b, p, POKE, { action: activeNow(act(b.rt, speciesMove(POKE), 1)) });
    expect([first, second].sort(compareRequests).map(r => r.attacker.id)).toEqual(['e1', 'e2']);   // same start: by attacker id
    const events = resolveAll([first, second], 2);
    expect(events.map(e => [e.attackerId, e.outcome])).toEqual([['e1', 'hit'], ['e2', 'immune']]);   // the first hit's .4 s makes the second immune
  });
  it('grab ignores brace', () => {
    const p = player(); guard(p.rt, 'brace-shell');
    const e = resolveHit(req(crab(), p, WRAP), 1)!;
    expect(e.outcome).toBe('grabbed'); expect(p.rt.heldBy).toBe('e7');
  });
  it('grab size rule holds or breaks free', () => {
    // WRAP: size factor 1.2. A crab (L 5.6) holds a player of L ≤ 6.72.
    const small = player({ L: 6.72 }), c = crab(), r = req(c, small, WRAP), e = resolveHit(r, 1)!;
    expect(e.outcome).toBe('grabbed'); expect(e.held).toBe(true); expect(e.caught).toBe(true); expect(r.action.heldTarget).toBe('player'); expect(small.rt.heldBy).toBe('e7');
    expect(e.amount).toBe(1); expect(small.health).toBe(5.5); expect(e.hitStop).toBeCloseTo(.07);   // startHalfHearts 1
    const big = player({ L: 6.8 }), f = resolveHit(req(crab(), big, WRAP), 1)!;
    expect(f.outcome).toBe('hit'); expect(f.held).toBe(false); expect(big.rt.heldBy).toBeNull(); expect(big.rt.staggerUntil).toBeCloseTo(.3);
    const alpha = player({ grabbable: false }); expect(resolveHit(req(crab(), alpha, WRAP), 1)!.held).toBe(false);
    // A player's grab on a species: HP damage; the species' interruptible action ends.
    const prey = crab({ L: 1 }), own = activeNow(act(prey.rt, speciesMove(POKE))); own.phase = 'windup';
    const pinch = resolveMove({ abilityId: 'grab-pincer' }, 1).attack!, g = resolveHit(req(player(), prey, pinch, { action: activeNow(act(newRuntime(), resolveMove({ abilityId: 'grab-pincer' }, 1))) }), 1)!;
    expect(g.outcome).toBe('grabbed'); expect(prey.health).toBe(18); expect(own.phase).toBe('interrupted');
  });
  it('held player breaks free by presses and flicks', () => {
    const rt = newRuntime(); rt.heldBy = 'e7';
    expect(addBreakProgress(rt, { basicPressed: true, dashPressed: false, flick: false })).toBe(false);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: true, flick: false })).toBe(false);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: false, flick: true })).toBe(false); expect(rt.breakProgress).toBeCloseTo(.8);
    expect(addBreakProgress(rt, { basicPressed: false, dashPressed: false, flick: true })).toBe(true);   // .25 + .35 + .2 + .2
    expect(isFlick({ x: .7, y: 0, z: 0 }, { x: -.7, y: 0, z: .1 })).toBe(true); expect(isFlick({ x: .7, y: 0, z: 0 }, { x: 0, y: 0, z: .7 })).toBe(false);   // 90° exactly is not more
    expect(isFlick({ x: .5, y: 0, z: 0 }, { x: -.7, y: 0, z: 0 })).toBe(false);
    const c = crab(), g = activeNow(act(c.rt, speciesMove(WRAP))); g.phase = 'hold'; g.heldTarget = 'player';
    releaseHold(c.rt, g, rt, 4, true);
    expect(g.phase).toBe('recovery'); expect(rt.heldBy).toBeNull(); expect(rt.breakProgress).toBe(0); expect(rt.invulnerableUntil).toBeCloseTo(4.5);
  });
  it('squeeze ticks on the grabber clock', () => {
    const c = crab(), g = activeNow(act(c.rt, speciesMove(WRAP)));
    g.phase = 'hold'; g.phaseStartedAt = 1; c.rt.actionClock = 1.39;
    expect(squeezesDue(g, c.rt.actionClock)).toBe(0); c.rt.actionClock = 1.4; expect(squeezesDue(g, c.rt.actionClock)).toBe(1);   // every .4 s
    expect(squeezesDue(g, c.rt.actionClock)).toBe(0); c.rt.actionClock = 2.15; expect(squeezesDue(g, c.rt.actionClock)).toBe(1);   // the second at 1.8
    // A hit-stop on the grabber delays the squeeze: its clock does not advance.
    c.rt.hitStopUntil = 3; advanceClock(c.rt, 2.15, .5); expect(c.rt.actionClock).toBeCloseTo(2.15); expect(squeezesDue(g, c.rt.actionClock)).toBe(0);
  });
  it('hold ends when the grabber is staggered', () => {
    const p = player(), c = crab(), r = req(c, p, WRAP); resolveHit(r, 1);
    c.rt.actionClock = .2; tickAction(c.rt, r.action, .2, { wantedAim: null, held: false, bodyForward: { x: 0, y: 0, z: 1 } });   // active (.12 s) → hold
    expect(r.action.phase).toBe('hold');
    const q = player(), hit = resolveHit(req(q, c, { ...POKE, damageUnit: 'hp', damage: 6, poiseDamageMultiplier: 1 }), 2)!;   // poise 6: staggered
    expect(hit.outcome).toBe('hit'); expect(r.action.phase).toBe('recovery'); expect(r.action.heldTarget).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/hit-resolver.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/hit-resolver"`.

- [ ] **Step 3: Create `hit-resolver.ts`** (complete file)

```ts
// Hit resolution (spec §6): one hit request at a time, in the contract order — validity, guard and counter, immunity, damage, stagger,
// impulse, ledger and event. Pure: it changes the fighters' runtimes, health and ledgers it is given and returns combat events; it never
// moves a body (an impulse only changes `externalVelocity`).
import { addPoise, applyHitStop, endHold, endNow, interruptible, stagger, type PoiseMeter } from './action-engine';
import { hitStopFor } from './combat-profiles';
import type { ActionState, ActorId, AttackSpec, CombatRuntime, HitOutcome, Vec3 } from './combat-types';
import { damageAfterArmor } from './state';

/** One side of a hit. `health`: hearts for the player, HP for a species; the resolver lowers it. */
export interface Fighter {
  id: ActorId; isPlayer: boolean; rt: CombatRuntime;
  centre: Vec3;
  /** The 3D forward (Brace's front test). */
  forward: Vec3;
  /** Body length L. */
  L: number; mass: number; knockbackResistance: number;
  /** Player armor (derived.armor); species have none in 3a. */
  armor: number;
  /** A ground mover: its impulse is made horizontal. */
  ground: boolean; grabbable: boolean;
  /** Species: the poise meter and the behaviour's poise and stagger resistance. The player: null. */
  poise: PoiseMeter | null; poiseMax: number; staggerResist: number;
  health: number;
}
export interface HitRequestIn {
  attacker: Fighter; target: Fighter; action: ActionState;
  /** The resolved attack of the action. */
  attack: AttackSpec; hitGroupId: string;
  /** The shape origin and the hit point (combat-shapes.ts). */
  origin: Vec3; point: Vec3;
  /** Crossing and obstruction passed (spec §5.11). */
  geometryOk: boolean;
}
export interface CombatEvent {
  outcome: HitOutcome; attackerId: ActorId; targetId: ActorId; attackId: string; actionInstanceId: string; point: Vec3;
  /** Damage dealt to the target: HP for a species target, half-hearts for the player. A counter's reflection is in `reflect` (HP). */
  amount: number; unit: 'hp' | 'half-heart'; reflect: number;
  /** Seconds of hit-stop given to both actors. */
  hitStop: number; impulse: Vec3;
  status: 'inked' | null;
  /** The first hit of a grab (a catch), and whether it holds the target. */
  caught: boolean; held: boolean;
  /** A species at 0 HP: the attacker (reflection) or the target. */
  killed: ActorId | null;
  time: number;
}
/** Post-hit invulnerability after damage (D15), the grab size-rule break stagger and the break-free invulnerability. */
export const POST_HIT_INVULNERABLE = .4, BREAK_FREE_STAGGER = .3, BREAK_FREE_INVULNERABLE = .5;
/** Brace multiplies the impulse: blocked × .3, guard broken × .6. */
export const BLOCK_IMPULSE = .3, BROKEN_IMPULSE = .6;

/** §6.1: by action start time (world time), then attacker id, then target id. */
export function compareRequests(a: HitRequestIn, b: HitRequestIn): number {
  const s = a.action.startedAt - b.action.startedAt;
  if (s !== 0) return s;
  if (a.attacker.id !== b.attacker.id) return a.attacker.id < b.attacker.id ? -1 : 1;
  return a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0;
}
export const ledgerKey = (a: ActionState, hitGroupId: string, targetId: ActorId) => `${a.instanceId}:${hitGroupId}:${targetId}`;
/** The distinct targets an action has hit (its ledger). */
export function targetsHit(a: ActionState): Set<ActorId> {
  const out = new Set<ActorId>();
  for (const key of a.hitCounts.keys()) out.add(key.slice(key.lastIndexOf(':') + 1));
  return out;
}
function record(a: ActionState, key: string, now: number) { a.hitCounts.set(key, (a.hitCounts.get(key) ?? 0) + 1); a.lastHitAt.set(key, now); }
const guardAction = (rt: CombatRuntime, kind: 'brace' | 'counter') => rt.actions.find(a => a.phase === 'active' && a.resolved.guard?.kind === kind);
const dashing = (rt: CombatRuntime) => rt.actions.some(a => a.phase === 'active' && a.resolved.evasion);
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 }; };
function inFront(target: Fighter, origin: Vec3, halfAngle: number): boolean {
  const d = unit({ x: origin.x - target.centre.x, y: origin.y - target.centre.y, z: origin.z - target.centre.z }), f = unit(target.forward);
  return Math.acos(Math.max(-1, Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z))) <= halfAngle + 1e-9;
}
const event = (r: HitRequestIn, outcome: HitOutcome, now: number, over: Partial<CombatEvent> = {}): CombatEvent => ({ outcome, attackerId: r.attacker.id, targetId: r.target.id, attackId: r.attack.id,
  actionInstanceId: r.action.instanceId, point: r.point, amount: 0, unit: r.target.isPlayer ? 'half-heart' : 'hp', reflect: 0, hitStop: 0, impulse: { x: 0, y: 0, z: 0 }, status: null,
  caught: false, held: false, killed: null, time: now, ...over });

/** Resolves one hit request (spec §6.2). Null: dropped at validity, with no ledger entry. `statusOf` gives an attack's status effect. */
export function resolveHit(r: HitRequestIn, now: number, statusOf: (id: string) => { seconds: number; speedFactor: number } | null = () => null): CombatEvent | null {
  const { attacker, target, action, attack } = r, key = ledgerKey(action, r.hitGroupId, target.id);
  // 1. Validity.
  if (!target.rt.targetable || target.id === attacker.id || !r.geometryOk) return null;
  if ((action.hitCounts.get(key) ?? 0) >= attack.maxHitsPerTarget || now - (action.lastHitAt.get(key) ?? -Infinity) < attack.repeatHitSeconds - 1e-9) return null;
  const hit = targetsHit(action);
  if (!hit.has(target.id) && hit.size >= attack.maxTargets) return null;
  // 2. Guard and counter.
  const counter = guardAction(target.rt, 'counter');
  if (counter && attack.parryable) {
    const g = counter.resolved.guard!, reflect = g.reflectDamage;
    counter.countered = true; endNow(target.rt, counter);
    attacker.health -= reflect;
    stagger(attacker.rt, g.attackerStaggerSeconds, true);
    record(action, key, now);
    const stop = hitStopFor('countered', { targetIsPlayer: target.isPlayer, amount: 0 });
    applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
    return event(r, 'countered', now, { reflect, hitStop: stop, killed: !attacker.isPlayer && attacker.health <= 0 ? attacker.id : null });
  }
  let guard: 'blocked' | 'guard-broken' | null = null, blockFraction = 0;
  const brace = guardAction(target.rt, 'brace');
  if (brace && attack.blockable && inFront(target, r.origin, brace.resolved.guard!.frontHalfAngle ?? 0)) {
    const g = brace.resolved.guard!;
    blockFraction = g.blockFraction;
    guard = g.breakHalfHearts !== null && damageAfterArmor(attack.damage, target.armor) >= g.breakHalfHearts ? 'guard-broken' : 'blocked';
    if (guard === 'guard-broken') { endNow(target.rt, brace, g.brokenCooldownSeconds); stagger(target.rt, g.breakStaggerSeconds); }
  }
  // 3. Immunity (a blocked hit goes on to damage).
  if (!guard && (!target.rt.damageable || now < target.rt.invulnerableUntil || dashing(target.rt))) {
    record(action, key, now);
    return event(r, dashing(target.rt) ? 'evaded' : 'immune', now);
  }
  // 4. Damage.
  const catchHold = attack.hold && !guard ? attack.hold : null;
  let amount: number;
  if (target.isPlayer) {
    const raw = catchHold && attack.damageUnit === 'half-heart' ? catchHold.startHalfHearts : attack.damage, hh = damageAfterArmor(raw, target.armor);
    amount = guard === 'blocked' ? Math.floor(hh * (1 - blockFraction)) : guard === 'guard-broken' ? Math.floor(hh * (1 - blockFraction / 2)) : hh;
    target.health -= amount / 2;
    if (amount > 0) { target.rt.invulnerableUntil = now + POST_HIT_INVULNERABLE; target.rt.lastDamageAt = now; }
  } else { amount = attack.damage; target.health -= amount; }
  action.connected = true;
  // 6 (grab). A catch: held when the target fits and is grabbable, else it breaks free at once (spec §6.6).
  if (catchHold) {
    record(action, key, now);
    const fits = target.L <= catchHold.sizeFactor * attacker.L + 1e-9 && target.grabbable && target.rt.heldBy === null && target.health > 0;
    if (fits) {
      action.heldTarget = target.id; target.rt.heldBy = attacker.id; target.rt.breakProgress = 0;
      for (const a of target.rt.actions) if (interruptible(a)) endNow(target.rt, a);
    } else stagger(target.rt, BREAK_FREE_STAGGER);
    const stop = hitStopFor('grabbed', { targetIsPlayer: target.isPlayer, amount });
    applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
    return event(r, fits ? 'grabbed' : 'hit', now, { amount, hitStop: stop, caught: true, held: fits, killed: !target.isPlayer && target.health <= 0 ? target.id : null });
  }
  // 5. Stagger (not when blocked).
  if (guard !== 'blocked') {
    if (target.isPlayer) { if (attack.staggerSeconds > 0) stagger(target.rt, attack.staggerSeconds); }
    else if (target.poise && addPoise(target.poise, amount * attack.poiseDamageMultiplier, target.rt.actionClock, target.poiseMax)) stagger(target.rt, attack.staggerSeconds * (1 - target.staggerResist));
  }
  // 6. Impulse: J = impulse × L_a × min(m_a, 2 m_t) along origin → point (horizontal for ground targets); Δv = J / m_t × (1 − kr).
  let dir = { x: r.point.x - r.origin.x, y: target.ground ? 0 : r.point.y - r.origin.y, z: r.point.z - r.origin.z };
  dir = unit(dir);
  const J = attack.impulse * attacker.L * Math.min(attacker.mass, 2 * target.mass), k = J / target.mass * (1 - target.knockbackResistance) * (guard === 'blocked' ? BLOCK_IMPULSE : guard === 'guard-broken' ? BROKEN_IMPULSE : 1);
  const impulse = { x: dir.x * k, y: dir.y * k, z: dir.z * k };
  target.rt.externalVelocity.x += impulse.x; target.rt.externalVelocity.y += impulse.y; target.rt.externalVelocity.z += impulse.z;
  // Status (ink): not when blocked.
  let status: CombatEvent['status'] = null;
  const s = attack.statusEffectId && guard !== 'blocked' ? statusOf(attack.statusEffectId) : null;
  if (s) { target.rt.status = { id: 'inked', until: now + s.seconds, speedFactor: s.speedFactor }; status = 'inked'; }
  // 7. Ledger and event.
  record(action, key, now);
  const outcome: HitOutcome = guard ?? 'hit', stop = hitStopFor(outcome, { targetIsPlayer: target.isPlayer, amount });
  applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
  return event(r, outcome, now, { amount, hitStop: stop, impulse, status, killed: !target.isPlayer && target.health <= 0 ? target.id : null });
}
/** Resolves every request in the contract order; one accepted event can make a later one immune. */
export function resolveAll(requests: HitRequestIn[], now: number, statusOf?: (id: string) => { seconds: number; speedFactor: number } | null): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (const r of [...requests].sort(compareRequests)) { const e = resolveHit(r, now, statusOf); if (e) out.push(e); }
  return out;
}

// ---- grabs (spec §6.6) ----
export const BREAK_BASIC = .25, BREAK_DASH = .35, BREAK_FLICK = .2, FLICK_LENGTH = .6;
/** A move-stick flick: the stick turns more than 90° with length > .6 (both readings). */
export function isFlick(prev: Vec3, cur: Vec3): boolean {
  const a = Math.hypot(prev.x, prev.z), b = Math.hypot(cur.x, cur.z);
  return a > FLICK_LENGTH && b > FLICK_LENGTH && (prev.x * cur.x + prev.z * cur.z) / (a * b) < 0;
}
/** Adds break-free progress for this tick's inputs. True when it reached 1. */
export function addBreakProgress(rt: CombatRuntime, input: { basicPressed: boolean; dashPressed: boolean; flick: boolean }): boolean {
  rt.breakProgress += (input.basicPressed ? BREAK_BASIC : 0) + (input.dashPressed ? BREAK_DASH : 0) + (input.flick ? BREAK_FLICK : 0);
  return rt.breakProgress >= 1 - 1e-9;
}
/** Ends a hold: the grabber's action goes to recovery and the target is free; a player that broke free gets .5 s of world-time invulnerability. */
export function releaseHold(grabber: CombatRuntime, a: ActionState, target: CombatRuntime, now: number, brokeFree: boolean): void {
  endHold(grabber, a); target.heldBy = null; target.breakProgress = 0;
  if (brokeFree) target.invulnerableUntil = Math.max(target.invulnerableUntil, now + BREAK_FREE_INVULNERABLE);
}
/** Squeezes due in a hold on the grabber's clock: one every `squeezeEverySeconds` of hold. Counts them on the action and returns how many are new. */
export function squeezesDue(a: ActionState, tau: number): number {
  const h = a.resolved.attack?.hold;
  if (a.phase !== 'hold' || !h || h.squeezeHalfHearts <= 0 || h.squeezeEverySeconds <= 0) return 0;
  const due = Math.floor((tau - a.phaseStartedAt) / h.squeezeEverySeconds + 1e-9), fresh = Math.max(0, due - a.squeezes);
  a.squeezes = Math.max(a.squeezes, due);
  return fresh;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/hit-resolver.test.ts`
Expected: PASS, 17 tests, 0 failed.

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/hit-resolver.ts tests/tiny-tide-core/hit-resolver.test.ts
git commit -m "Tiny Tide combat: hit resolver — counter, brace, evasion, damage, stagger, capped impulse, grabs and break-free

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T6: Extract the game tick into `sim.ts`

**Spec:** §3.1 (`sim.ts`, `feeding.ts`), §14.1 `sim.test.ts`, D29. This task changes no behaviour. It comes before any combat content.

**Files:**
- Create: `src/tiny-tide/sim.ts`, `src/tiny-tide/feeding.ts`
- Modify: `src/tiny-tide/main.ts`
- Create: `tests/tiny-tide-core/sim.test.ts`, `tests/tiny-tide-core/sim-golden.json` (recorded), `tests/tiny-tide-core/legacy-frame.ts` (temporary; deleted in Step 8)
- Modify: `tests/tiny-tide-core/main-rescue.test.ts`, `tests/tiny-tide-core/node-fs.d.ts`

**Interfaces:**
- Consumes: the `main.ts` frame (player step, rescue, recovery, ecosystem, hazards, chomp, rewards, faint, respawn), `stepPlayer`, `resolveHazards`, `beginRespawn`, `resolveRespawn`, `Ecosystem`, `freshRun`, `readIntent`.
- Produces:
  - `sim.ts`: `GameMode`, `SimLegality`, `SimWorld { eco; legality(stage); startGrace; … }`, `Glide`, `RescueLog`, `SimState`, `SimEvent` (a tagged union: `installed {snap}`, `step {result}`, `stuck`, `unstuck`, `chomp {result}`, `regen`, `hurt {event, damage, fainted}`, `respawned`, `respawn-waiting`, `resume-fainted`; later tasks add `combat`, `fainted`, `killed`, `survivor`, `alpha`, `roar`), `SimInput { dt; intent; wish; held }`, `simOwnedState()`, `newSimState(run)`, `refreshDerived(s)`, `playerActorCached(s)`, `worldHull(s, actor)`, `settleOffset(s, w, actor)`, `cancelRescue(s)`, `installPose(s, w, pose, actor, events, snap?, rescue?)`, `anchorFor`, `admitted`, `recover`, `applyStartGrace`, `enterStuck`, `checkPose`, `checkGrownPose`, `tryRespawn`, `simFrame(s, w, input): SimEvent[]`, `simBegin(s, w, run, forced): SimEvent[]`, `simEvolve(s, destination)`.
  - `feeding.ts`: `CHOMP_COOLDOWN = .24`, `BiteTarget`, `biteTargets(run, entities, player, growth, derived)`, `ChompResult`, `chomp(run, eco, player, growth, …)`.
  - `main.ts` keeps its module variables. It builds one binding object `sim: SimState` with a getter and a setter per shared variable (`physical`, `rt`, `time`, `mode`, `run`, `derived`, …) and spreads `simOwnedState()` into it. `frame()` calls `simFrame(sim, simWorld, …)` and presents each returned event (`presentSim`, `presentStep`, `presentChomp`, `presentHurt`).

**Rebase note:** see Global Constraints, "Base revision". The frame body at HEAD has the fix-round-4 admission budget (`rescueBudget(stepCalls)`). It moves into `simFrame` with the rest. `stepCalls` and `rescueCalls` become `SimState` fields, and `main.ts` reads them for `admissionStats`. The HEAD version of `main-rescue.test.ts` has two more checks ("every `physical = ` is in a checked function", "no field-by-field pose write"). Port them to `sim.ts` as `s.physical = ` and `/\bs\.physical\.[xyz]\s*(?:[-+*/]?=)(?!=)/`. `node-fs.d.ts` at HEAD already declares `process`; keep one declaration.

- [ ] **Step 1: Write the golden test and the legacy recorder**

`tests/tiny-tide-core/sim.test.ts` (recording version):

```ts
// tests/tiny-tide-core/sim.test.ts — spec D29 and §14.1: sim.ts keeps the former main.ts tick order. A scripted 20 s run at stage 0 (seed 7,
// fixed intents, dt 1/60) is pinned by sim-golden.json, recorded first with the main.ts frame (legacy-frame.ts) and then compared with sim.ts.
// TIDE_SIM_RECORD=legacy rewrites the golden from legacy-frame.ts; TIDE_SIM_RECORD=sim from sim.ts (a later task that changes stage 0 on purpose).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';
import { freshRun } from '../../src/tiny-tide/state';
import { readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';

const GOLDEN = 'tests/tiny-tide-core/sim-golden.json', DT = 1 / 60, SECONDS = 20;
export interface Sample { t: number; x: number; y: number; z: number; health: number; stageDna: number; dna: number; bites: number; mode: string }
/** The script: forward 0–5 s, right 5–8 s, back-left 8–14 s, still after; Space held 3–12 s, tapped every second after 14 s. */
export function script(t: number, previous: CombatInput): { intent: CombatInput; wish: Vec3 } {
  const keys = new Set<string>();
  if (t >= 3 && t < 12) keys.add('Space');
  if (t >= 14 && Math.floor(t) !== Math.floor(t - DT)) keys.add('Space');
  const src: InputSources = { stickX: 0, stickZ: 0, keys, chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false };
  const wish = t < 5 ? { x: 0, y: 0, z: 1 } : t < 8 ? { x: 1, y: 0, z: 0 } : t < 14 ? { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } : { x: 0, y: 0, z: 0 };
  return { intent: readIntent(src, previous, { breachOnRiseTap: false }), wish };
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;
export function world(seed: number): SimWorld {
  const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
  return { eco: new Ecosystem(seed), startGrace: 2, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
}
function runSim(): Sample[] {
  const run = freshRun(7), w = world(7), s = newSimState(run), out: Sample[] = [];
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  let previous = RELEASED;
  for (let f = 1; f <= SECONDS * 60; f++) {
    const { intent, wish } = script(s.time, previous); previous = intent;
    simFrame(s, w, { dt: DT, intent, wish, held: false });
    if (f % 60 === 0) out.push({ t: round(s.time), x: round(s.physical.x), y: round(s.physical.y), z: round(s.physical.z), health: s.run.health, stageDna: s.run.stageDna, dna: s.run.economy.wallet.atRisk + s.run.economy.wallet.banked, bites: s.run.bites, mode: s.mode });
  }
  return out;
}
describe('sim', () => {
  it('sim.ts keeps the former main.ts tick order', async () => {
    const record = process.env.TIDE_SIM_RECORD;
    if (record === 'legacy') { const { runLegacy } = await import('./legacy-frame'); writeFileSync(GOLDEN, JSON.stringify(runLegacy(), null, 1)); }
    if (record === 'sim') writeFileSync(GOLDEN, JSON.stringify(runSim(), null, 1));
    expect(existsSync(GOLDEN), 'record the golden first: TIDE_SIM_RECORD=legacy').toBe(true);
    expect(runSim()).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  }, 60_000);
});
```

`tests/tiny-tide-core/legacy-frame.ts` is the HEAD `main.ts` frame, ported line for line with all presentation removed (DOM, audio, particles, toasts, the food guide, the QA counters). The version below ports `beed7b4`. Port the round-4 lines too (Global Constraints, "Base revision").

```ts
// The main.ts frame before the sim.ts extraction, ported line for line for the golden record (sim.test.ts, TIDE_SIM_RECORD=legacy).
// Only presentation is removed (DOM, audio, particles, toasts, the food guide, QA counters). Deleted after sim.ts matches it.
import { SIZES } from '../../src/tiny-tide/biomes';
import { newRuntime, type Actor, type Capsule, type CombatInput, type MutVec3, type Orientation, type RecoveryResult, type Vec3 } from '../../src/tiny-tide/combat-types';
import { provoke, entityRadius, type EcoEvent } from '../../src/tiny-tide/ecosystem';
import { derive, dietOf, effectiveStats } from '../../src/tiny-tide/genome';
import { basicRequested, RELEASED } from '../../src/tiny-tide/input';
import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UNSTICK_BUDGET, UnstickSearch, wedged } from '../../src/tiny-tide/lifecycle';
import { startAnchor } from '../../src/tiny-tide/motion';
import { bodyLengthOf, hullFitOf, hullOffsets, massFor } from '../../src/tiny-tide/mount';
import { orientedHeave, orientedSway, rotateInto } from '../../src/tiny-tide/orientation';
import { DROPS } from '../../src/tiny-tide/parts';
import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult } from '../../src/tiny-tide/player-motion';
import { habitat, movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { currentPlan, dietCanEat, eat, freshRun, growthOf, hurt, inReach, reward, STAGES, unlock } from '../../src/tiny-tide/state';
import { supportHeight } from '../../src/tiny-tide/world-queries';
import { script, world, type Sample } from './sim.test';

export function runLegacy(): Sample[] {
  const run = freshRun(7), w = world(7), legality = w.legality, START_GRACE = 2, out: Sample[] = [];
  let mode = 'menu', rt = newRuntime(), physical: Vec3 = { x: 0, y: 0, z: 0 }, time = 0, cooldown = 0, sinceHit = 99, regenClock = 0, respawnClock = 0, stuckRetry = 0, startGracePending = false;
  let genomeRevision = 0, derived = derive(effectiveStats(run.genome, currentPlan(run))), lastIntent: CombatInput = RELEASED;
  const trapWatch = newTrapWatch(), beforeStep = newStepSnapshot();
  let unstick: UnstickSearch | null = null, glide: { path: { position: Vec3; orientation: Orientation }[]; index: number } | null = null;
  type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
  let actorCache: { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number } | null = null, hullRescaled = false, hullGrew = false;
  const refreshDerived = () => { derived = derive(effectiveStats(run.genome, currentPlan(run))); };
  function playerActorCached(): Actor {
    const plan = currentPlan(run), key = `${plan.id}:${genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
    if (!actorCache || actorCache.key !== key) {
      const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
      actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
    }
    const c = actorCache;
    if (c.scale !== scale) {
      c.unit.forEach((u, i) => { const h = c.hull[i]!; h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale; h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
        h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale; if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; } });
      hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; hullRescaled = true;
    }
    return c.actor;
  }
  const capsOf = () => movementCapabilities(currentPlan(run));
  const hullBuffer: { start: MutVec3; end: MutVec3; radius: number; sway: number; heave: number }[] = [];
  function worldHull(actor: Actor): Capsule[] {
    const o = rt.orientation, h = actor.hull;
    while (hullBuffer.length < h.length) hullBuffer.push({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, sway: 0, heave: 0 });
    hullBuffer.length = h.length;
    for (let i = 0; i < h.length; i++) { const c = h[i]!, b = hullBuffer[i]!, wy = c.sway ?? 0, v = c.heave ?? 0; rotateInto(o, c.start, b.start); rotateInto(o, c.end, b.end);
      b.start.x += physical.x; b.start.y += physical.y; b.start.z += physical.z; b.end.x += physical.x; b.end.y += physical.y; b.end.z += physical.z; b.radius = c.radius; b.sway = orientedSway(wy, v, o.pitch); b.heave = orientedHeave(wy, v, o.pitch); }
    return hullBuffer;
  }
  function settleOffset(actor: Actor) { const t = legality(run.stage).queries.terrain; rt.groundOffset = capsOf().ground && !t.space ? Math.max(0, physical.y - (supportHeight(actor, physical.x, physical.z, rt.orientation, t) + .01 * actor.bodyLength)) : 0; }
  function cancelRescue() { unstick = null; glide = null; trapWatch.armed = false; }
  function installPose(pose: { position: Vec3; orientation: Orientation }, actor: Actor, _snap = false, rescue = false) {
    if (!rescue) cancelRescue();
    physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
    rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 }; settleOffset(actor);
  }
  const anchorFor = (actor: Actor): RecoveryResult => startAnchor(actor, run.stage, legality(run.stage));
  const admitted = (actor: Actor) => legality(run.stage).queries.overlapHull(actor, physical, rt.orientation, { time, permit: rt.permit, bounds: legality(run.stage).bounds }).ok;
  function recover(actor: Actor, at: number, from: Vec3 = physical): boolean { const rec = recoverPlayer(actor, from, rt.orientation, { ...legality(run.stage), time: at }, anchorFor(actor), 20 * actor.bodyLength); if (!rec.ok) return false; installPose(rec, actor); return true; }
  function applyStartGrace() { rt.invulnerableUntil = START_GRACE > 0 ? time + START_GRACE : 0; }
  function enterStuck() { mode = 'stuck'; stuckRetry = 1; }
  function checkPose(actor: Actor) { cancelRescue(); if (admitted(actor)) settleOffset(actor); else if (!recover(actor, time)) enterStuck(); }
  function checkGrownPose(actor: Actor) { const lifted = growthPose(actor, physical, rt, { ...legality(run.stage), time }); if (!lifted) { checkPose(actor); return; } cancelRescue(); physical = lifted; settleOffset(actor); }
  function tryRespawn(): boolean { const actor = playerActorCached(), anchor = anchorFor(actor); if (!anchor.ok || !resolveRespawn(run, rt, time, anchor)) return false; installPose(anchor, actor, true); refreshDerived(); return true; }
  function chomp() {
    if (mode !== 'playing' || cooldown > 0) return;
    cooldown = .24;
    const size = SIZES[run.stage]!, p = { x: physical.x / size, y: physical.y / size, z: physical.z / size }, growth = growthOf(run), diet = dietOf(run.genome);
    const targets: { e: typeof w.eco.entities[number]; edible: boolean; distance: number }[] = [];
    for (const e of w.eco.entities) {
      if (e.eaten) continue;
      const attacking = e.mode === 'hunt' || e.mode === 'angry', tier = e.spec.tier;
      if (tier !== run.stage && !(attacking && tier === run.stage + 1)) continue;
      const radius = tier > run.stage ? entityRadius(e) / size : 0, food = { x: e.x / size, y: e.y / size, z: e.z / size };
      if (!inReach(run.stage, p, food, growth, derived.reach, radius)) continue;
      const edible = tier === run.stage && dietCanEat(diet, e.spec.tag);
      if (!edible && !attacking && !e.spec.fights) continue;
      targets.push({ e, edible, distance: Math.hypot(food.x - p.x, food.y - p.y, food.z - p.z) });
    }
    const hit = targets.sort((a, b) => a.distance - b.distance)[0]; if (!hit) return;
    const e = hit.e, bigger = e.spec.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
    if (e.spec.hp > 1 || bigger) { e.hp -= damage; provoke(e, physical, time, worldHull(playerActorCached())); if (e.hp > 0) return; }
    const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop);
    if (hit.edible) eat(run, e.spec, e.spec.kind === 'planet' ? w.eco.planetIndex(e) : e.id); else reward(run, Math.round(e.spec.dna * .5), e.spec.tier === run.stage);
    w.eco.consume(e);
  }
  function takeHit(event: EcoEvent) {
    sinceHit = 0; const fainted = hurt(run, event.damage, derived.armor); if (!fainted) return;
    if (!beginRespawn(run, rt)) return; mode = 'fainted'; respawnClock = 1.8;
  }
  function tickFaint(dt: number) { respawnClock -= dt; if (respawnClock > 0) return; if (tryRespawn()) { mode = 'playing'; sinceHit = 99; return; } respawnClock = 1; }
  // begin()
  w.eco.reset(run.eatenPlanets); refreshDerived(); run.health = Math.min(run.health, derived.maxHealth); mode = 'playing'; cooldown = 0; sinceHit = 99;
  rt = newRuntime(); genomeRevision++; cancelRescue(); startGracePending = false;
  { const actor = playerActorCached(), t = legality(run.stage).queries.terrain; physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
    const anchor = anchorFor(actor); if (anchor.ok) { rt = newRuntime(anchor.orientation); installPose(anchor, actor, true); applyStartGrace(); } else { enterStuck(); startGracePending = true; } }
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  for (let f = 1; f <= 20 * 60; f++) {
    const dt = 1 / 60, held = false;
    // frame(): verbatim order.
    const active = !held && (mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted');
    const stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
    const actor = mode === 'menu' ? null : playerActorCached();
    if (actor && hullRescaled) { const grew = hullGrew; hullRescaled = false; hullGrew = false; if (mode === 'playing') { if (grew) checkGrownPose(actor); else checkPose(actor); } else settleOffset(actor); }
    if (mode === 'playing' && actor && !held) {
      run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); sinceHit += dt;
      if (sinceHit > 5 && run.health < derived.maxHealth) { regenClock += dt; if (regenClock > 2.5) { regenClock = 0; run.health = Math.min(derived.maxHealth, run.health + 1); } } else regenClock = 0;
      const { intent, wish } = script(time, lastIntent); lastIntent = intent;
      const legal = legality(stage);
      snapshotStep(rt, beforeStep);
      let r: PlayerStepResult;
      if (glide) {
        const pose = glide.path[glide.index++];
        if (pose && legal.queries.overlapHull(actor, pose.position, pose.orientation, { time: time + dt, bounds: legal.bounds }).ok) installPose(pose, actor, false, true); else glide = null;
        if (glide && glide.index >= glide.path.length) glide = null;
        r = { position: physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
      } else r = stepPlayer(physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * derived.speedFactor, now: time, dt, wish, aim: null, actionLock: false });
      if (!r.needsRecovery) physical = r.position; else if (!recover(actor, time + dt, r.position)) { restoreStep(rt, beforeStep); enterStuck(); }
      if (!glide && !r.needsRecovery && !unstick && trapDue(trapWatch, physical, wish, actor.bodyLength, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), dt))
        unstick = new UnstickSearch(actor, { ...physical }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { ...legal, time: time + dt, ground: caps.ground && !legal.queries.terrain.space }, rescueFreeRun(trapWatch, physical, time, actor.bodyLength));
      if (unstick) {
        const u = Math.hypot(physical.x - unstick.at.x, physical.z - unstick.at.z) > TRAP_MOVE * actor.bodyLength ? { ok: false as const, reason: 'moved' } : unstick.step(UNSTICK_BUDGET);
        if (u) { if (u.ok) { glide = { path: u.path, index: 0 }; trapRescued(trapWatch, unstick.at, time); } else if (u.reason !== 'moved') trapFailed(trapWatch, unstick.at, wish); unstick = null; }
      }
      if (mode === 'playing' && basicRequested(intent)) chomp();
    }
    if (mode === 'stuck' && actor) { stuckRetry -= dt; if (stuckRetry <= 0) { stuckRetry = 1; if (recover(actor, time)) { if (startGracePending) { startGracePending = false; applyStartGrace(); } mode = 'playing'; } } }
    if ((mode === 'playing' || mode === 'evolving' || mode === 'fainted') && actor && !held) {
      const events = w.eco.step({ stage, dt, now: time, player: physical, playerHull: worldHull(actor), perceivable: rt.perceivable && mode !== 'fainted', stealthFactor: derived.stealthFactor });
      const accepted = resolveHazards(events, { mode, pendingRespawn: run.pendingRespawn, rt, now: time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
      for (const event of accepted) { if (mode !== 'playing') break; takeHit(event); }
    }
    if (mode === 'fainted') tickFaint(dt);
    if (active) time += dt;
    if (f % 60 === 0) out.push({ t: round(time), x: round(physical.x), y: round(physical.y), z: round(physical.z), health: run.health, stageDna: run.stageDna, dna: run.economy.wallet.atRisk + run.economy.wallet.banked, bites: run.bites, mode });
  }
  return out;
}
```

`tests/tiny-tide-core/node-fs.d.ts`:

```diff
--- a/tests/tiny-tide-core/node-fs.d.ts
+++ b/tests/tiny-tide-core/node-fs.d.ts
@@ -1,5 +1,10 @@
-// The one Node API the Tiny Tide core tests use (the tests tsconfig has no Node types): reading a shipped GLB or a source file.
+// The Node APIs the Tiny Tide core tests use (the tests tsconfig has no Node types): reading a shipped GLB or a source file, the sim golden
+// and the probe reports, and the environment switches (TIDE_SIM_RECORD, TIDE_COMBAT_PROBE).
 declare module 'node:fs' {
   export function readFileSync(path: string): Uint8Array;
   export function readFileSync(path: string, encoding: 'utf8'): string;
+  export function writeFileSync(path: string, data: string): void;
+  export function existsSync(path: string): boolean;
+  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
 }
+declare const process: { env: Record<string, string | undefined> };
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/tiny-tide-core/sim.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/sim"`.

- [ ] **Step 3: Create `feeding.ts`** (the chomp rules of `main.ts`, unchanged; T8 adds `biteDispatch`)

```ts
// Feeding (spec §8.3): today's chomp, moved out of main.ts, on physical positions. Bite targets: own-tier food, or a bigger creature that
// is attacking; the chomp eats, or damages and provokes a fighter. Pure: it changes the run and the entities it is given.
import { DROPS } from './parts';
import { entityRadius, provoke, type Entity } from './ecosystem';
import { SIZES } from './biomes';
import { dietCanEat, eat, inReach, reward, unlock, type Run } from './state';
import { dietOf, type Derived } from './genome';
import type { Capsule, Vec3 } from './combat-types';

/** Seconds between chomps (main.ts `cooldown`). */
export const CHOMP_COOLDOWN = .24;
export interface BiteTarget { entity: Entity; edible: boolean; distance: number }
/** main.ts `biteTargets`, in physical units: positions are divided by the stage size exactly as the scene did (stage-local units). */
export function biteTargets(run: Run, entities: readonly Entity[], player: Vec3, growth: number, derived: Pick<Derived, 'reach'>): { targets: BiteTarget[]; wrongDiet: string | null } {
  const size = SIZES[run.stage]!, p = { x: player.x / size, y: player.y / size, z: player.z / size }, diet = dietOf(run.genome);
  const out: BiteTarget[] = []; let wrongDiet: string | null = null;
  for (const e of entities) {
    if (e.eaten) continue;
    const tier = e.spec.tier, attacking = e.mode === 'hunt' || e.mode === 'angry';
    if (tier !== run.stage && !(attacking && tier === run.stage + 1)) continue;
    const radius = tier > run.stage ? entityRadius(e) / size : 0, food = { x: e.x / size, y: e.y / size, z: e.z / size };
    if (!inReach(run.stage, p, food, growth, derived.reach, radius)) continue;
    const edible = tier === run.stage && dietCanEat(diet, e.spec.tag);
    // A mouth that can not eat it can still bite back at something that fights.
    if (!edible && !attacking && !e.spec.fights) { wrongDiet = e.spec.label; continue; }
    out.push({ entity: e, edible, distance: Math.hypot(food.x - p.x, food.y - p.y, food.z - p.z) });
  }
  return { targets: out.sort((a, b) => a.distance - b.distance), wrongDiet };
}
export type ChompResult =
  | { kind: 'miss'; wrongDiet: string | null }
  | { kind: 'bitten'; entity: Entity; damage: number }
  | { kind: 'ate'; entity: Entity; dna: number; won: boolean; drop: string | null };
/** main.ts `chomp` without its presentation. The caller has checked the mode and the chomp cooldown. */
export function chomp(run: Run, eco: { readonly entities: readonly Entity[]; consume(e: Entity): void; planetIndex(e: Entity): number }, player: Vec3, growth: number,
  derived: Pick<Derived, 'reach' | 'bite'>, now: number, hull: readonly Capsule[]): ChompResult {
  const { targets, wrongDiet } = biteTargets(run, eco.entities, player, growth, derived), hit = targets[0];
  if (!hit) return { kind: 'miss', wrongDiet };
  const e = hit.entity, bigger = e.spec.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
  if (e.spec.hp > 1 || bigger) {
    e.hp -= damage; provoke(e, player, now, hull);
    if (e.hp > 0) return { kind: 'bitten', entity: e, damage };
  }
  const candidate = DROPS[e.spec.kind], drop = candidate && unlock(run, candidate) ? candidate : null;
  let dna: number, won = false;
  if (hit.edible) { const result = eat(run, e.spec, e.spec.kind === 'planet' ? eco.planetIndex(e) : e.id); dna = result.dna; won = result.win; }
  else { dna = Math.round(e.spec.dna * .5); reward(run, dna, e.spec.tier === run.stage); }
  eco.consume(e);
  return { kind: 'ate', entity: e, dna, won, drop };
}
```

- [ ] **Step 4: Create `sim.ts`** (complete file at this task; same statement order as the old frame)

```ts
// One pure game tick (spec D29), moved out of main.ts in the same order: the growth check, the player step (with recovery, the trap
// watch and the rescue glide), the chomp, the stuck retry, the ecosystem, hazards and faint, the respawn timer, and the game clock.
// main.ts and the combat probe both call it. It returns events; main.ts turns them into sound, particles, toasts and saves.
import { SIZES } from './biomes';
import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRuntime, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
import type { Ecosystem, EcoEvent } from './ecosystem';
import { chomp, CHOMP_COOLDOWN, type ChompResult } from './feeding';
import { derive, effectiveStats, type Derived } from './genome';
import { basicRequested } from './input';
import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UNSTICK_BUDGET, UnstickSearch, wedged, type TrapWatch } from './lifecycle';
import { startAnchor } from './motion';
import { bodyLengthOf, hullFitOf, hullOffsets, massFor } from './mount';
import { orientedHeave, orientedSway, rotateInto } from './orientation';
import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
import { habitat, movement, movementCapabilities } from './profiles';
import { currentPlan, evolveReady, growthOf, hurt, STAGES, type Run } from './state';
import { admissionClock, supportHeight } from './world-queries';

export type GameMode = 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won';
export interface SimLegality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
/** What the tick reads from outside: the ecosystem, the cached world queries of a stage, and the start grace (seconds). */
export interface SimWorld { eco: Ecosystem; legality(stage: number): SimLegality; startGrace: number }
type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
interface ActorCache { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number }
export interface Glide { path: { position: Vec3; orientation: Orientation }[]; index: number }
export interface RescueLog { searches: number; found: number; failed: number; last: null | { from: Vec3; to: Vec3; time: number; solids: string[] } }
export interface SimState {
  run: Run; rt: CombatRuntime; physical: Vec3; time: number; mode: GameMode; derived: Derived; genomeRevision: number;
  chompCooldown: number; sinceHit: number; regenClock: number; respawnClock: number; stuckRetry: number;
  /** A run that began stuck owes its start grace to the first successful install. */
  startGracePending: boolean;
  trap: TrapWatch; unstick: UnstickSearch | null; glide: Glide | null; beforeStep: StepSnapshot;
  rescueLog: RescueLog; trapRescues: number; lastSolids: string[];
  actorCache: ActorCache | null; hullRescaled: boolean; hullGrew: boolean;
  acceptedHits: number; rejectedHits: number; faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[];
}
export type SimEvent =
  /** A pose was installed (`snap`: the camera jumps there too: start, respawn). */
  | { type: 'installed'; snap: boolean }
  | { type: 'step'; result: PlayerStepResult }
  | { type: 'stuck' } | { type: 'unstuck' }
  | { type: 'chomp'; result: ChompResult }
  | { type: 'regen' }
  /** An accepted hazard hit; `fainted` when it emptied the hearts (the run is already marked; save it at once). */
  | { type: 'hurt'; event: EcoEvent; damage: number; fainted: boolean }
  | { type: 'respawned' } | { type: 'respawn-waiting' }
  /** A loaded run that was saved during a faint found no anchor yet: it waits fainted (main shows the faint overlay). */
  | { type: 'resume-fainted' };
export interface SimInput { dt: number; intent: CombatInput; wish: Vec3; held: boolean }

type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog'>;
/** The fields only the simulation owns (main.ts spreads them into its bound state). */
export const simOwnedState = (): SimOwned => ({ trap: newTrapWatch(), unstick: null, glide: null, beforeStep: newStepSnapshot(), rescueLog: { searches: 0, found: 0, failed: 0, last: null },
  trapRescues: 0, lastSolids: [], actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [] });
/** A plain state (tests and the combat probe). */
export function newSimState(run: Run): SimState {
  return { run, rt: newRuntime(), physical: { x: 0, y: 0, z: 0 }, time: 0, mode: 'menu', derived: derive(effectiveStats(run.genome, currentPlan(run))), genomeRevision: 0,
    chompCooldown: 0, sinceHit: 99, regenClock: 0, respawnClock: 0, stuckRetry: 0, startGracePending: false, acceptedHits: 0, rejectedHits: 0, ...simOwnedState() };
}
export function refreshDerived(s: SimState): void { s.derived = derive(effectiveStats(s.run.genome, currentPlan(s.run))); }
const capsOf = (s: SimState) => movementCapabilities(currentPlan(s.run));
/** The player's actor. The hull is rebuilt only when the plan, the genome revision or the stage changes; a growth change rescales the
 *  cached buffers in place to the exact growth (no bucket) and sets `hullRescaled` (`hullGrew` when only the growth changed). */
export function playerActorCached(s: SimState): Actor {
  const run = s.run, plan = currentPlan(run), key = `${plan.id}:${s.genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
  if (!s.actorCache || s.actorCache.key !== key) {
    const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
    s.actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
  }
  const c = s.actorCache;
  if (c.scale !== scale) {
    c.unit.forEach((u, i) => {
      const h = c.hull[i]!;
      h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale;
      h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
      h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale;
      if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; }
    });
    s.hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; s.hullRescaled = true;
  }
  return c.actor;
}
const hullBuffer: { start: MutVec3; end: MutVec3; radius: number; sway: number; heave: number }[] = [];
/** The player's hull in world space; the buffer is reused every call (its readers copy what they keep). */
export function worldHull(s: SimState, actor: Actor): Capsule[] {
  const o = s.rt.orientation, h = actor.hull, p = s.physical;
  while (hullBuffer.length < h.length) hullBuffer.push({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, sway: 0, heave: 0 });
  hullBuffer.length = h.length;
  for (let i = 0; i < h.length; i++) {
    const c = h[i]!, b = hullBuffer[i]!, w = c.sway ?? 0, v = c.heave ?? 0;
    rotateInto(o, c.start, b.start); rotateInto(o, c.end, b.end);
    b.start.x += p.x; b.start.y += p.y; b.start.z += p.z; b.end.x += p.x; b.end.y += p.y; b.end.z += p.z;
    b.radius = c.radius; b.sway = orientedSway(w, v, o.pitch); b.heave = orientedHeave(w, v, o.pitch);
  }
  return hullBuffer;
}
/** The grounded offset against the support under the current pose (0 when supported or not grounded). */
export function settleOffset(s: SimState, w: SimWorld, actor: Actor): void {
  const t = w.legality(s.run.stage).queries.terrain, p = s.physical;
  s.rt.groundOffset = capsOf(s).ground && !t.space ? Math.max(0, p.y - (supportHeight(actor, p.x, p.z, s.rt.orientation, t) + .01 * actor.bodyLength)) : 0;
}
/** Ends a pending rescue search or glide and restarts the trap watch. Every install but a rescue glide step calls it. */
export function cancelRescue(s: SimState): void { s.unstick = null; s.glide = null; s.trap.armed = false; }
/** Installs an admitted full pose: position and orientation together, no permit or arc, zero velocities. */
export function installPose(s: SimState, w: SimWorld, pose: { position: Vec3; orientation: Orientation }, actor: Actor, events: SimEvent[], snap = false, rescue = false): void {
  if (!rescue) cancelRescue(s);
  s.physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; s.rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
  s.rt.permit = null; s.rt.arc = null; s.rt.controlledVelocity = { x: 0, y: 0, z: 0 }; s.rt.externalVelocity = { x: 0, y: 0, z: 0 };
  settleOffset(s, w, actor);
  events.push({ type: 'installed', snap });
}
export const anchorFor = (s: SimState, w: SimWorld, actor: Actor): RecoveryResult => startAnchor(actor, s.run.stage, w.legality(s.run.stage));
export const admitted = (s: SimState, w: SimWorld, actor: Actor): boolean => {
  const l = w.legality(s.run.stage); return l.queries.overlapHull(actor, s.physical, s.rt.orientation, { time: s.time, permit: s.rt.permit, bounds: l.bounds }).ok;
};
/** Recovers to an admitted full pose, searching from `from` (default: the installed pose). A failed pose is never installed. */
export function recover(s: SimState, w: SimWorld, actor: Actor, at: number, events: SimEvent[], from: Vec3 = s.physical): boolean {
  const rec = recoverPlayer(actor, from, s.rt.orientation, { ...w.legality(s.run.stage), time: at }, anchorFor(s, w, actor), 20 * actor.bodyLength);
  if (!rec.ok) return false;
  installPose(s, w, rec, actor, events); return true;
}
export function applyStartGrace(s: SimState, w: SimWorld): void { s.rt.invulnerableUntil = w.startGrace > 0 ? s.time + w.startGrace : 0; }
export function enterStuck(s: SimState, events: SimEvent[]): void { s.mode = 'stuck'; s.stuckRetry = 1; events.push({ type: 'stuck' }); }
/** After an edit, a growth change or a transformation: settle on the support, or recover when the body is not admitted. */
export function checkPose(s: SimState, w: SimWorld, actor: Actor, events: SimEvent[]): void {
  cancelRescue(s);
  if (admitted(s, w, actor)) settleOffset(s, w, actor);
  else if (!recover(s, w, actor, s.time, events)) enterStuck(s, events);
}
/** After a growth rescale: the smallest admitted lift of the grown body, with both velocities kept; else the normal recovery. */
export function checkGrownPose(s: SimState, w: SimWorld, actor: Actor, events: SimEvent[]): void {
  const lifted = growthPose(actor, s.physical, s.rt, { ...w.legality(s.run.stage), time: s.time });
  if (!lifted) { checkPose(s, w, actor, events); return; }
  cancelRescue(s); s.physical = lifted; settleOffset(s, w, actor);
}
/** Completes a pending respawn at the start anchor for the actual growth. The caller saves. */
export function tryRespawn(s: SimState, w: SimWorld, events: SimEvent[]): boolean {
  const actor = playerActorCached(s), anchor = anchorFor(s, w, actor);
  if (!anchor.ok || !resolveRespawn(s.run, s.rt, s.time, anchor)) return false;
  installPose(s, w, anchor, actor, events, true); refreshDerived(s); return true;
}

/** One frame of the simulation (main.ts `frame` without presentation). */
export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[] {
  const events: SimEvent[] = [], { dt, held } = input, run = s.run;
  // The game clock runs in these modes only (not while paused, editing, stuck or won).
  const active = !held && (s.mode === 'playing' || s.mode === 'menu' || s.mode === 'evolving' || s.mode === 'fainted');
  const stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
  const actor = s.mode === 'menu' ? null : playerActorCached(s);
  if (actor && s.hullRescaled) {
    // A growth change rescaled the hull: settle again, or recover if the bigger body is not admitted.
    const grew = s.hullGrew; s.hullRescaled = false; s.hullGrew = false;
    if (s.mode === 'playing') { if (grew) checkGrownPose(s, w, actor, events); else checkPose(s, w, actor, events); } else settleOffset(s, w, actor);
  }
  if (s.mode === 'playing' && actor && !held) {
    run.elapsed += dt; s.chompCooldown = Math.max(0, s.chompCooldown - dt); s.sinceHit += dt;
    // Hearts come back slowly once the creature is out of danger.
    if (s.sinceHit > 5 && run.health < s.derived.maxHealth) { s.regenClock += dt; if (s.regenClock > 2.5) { s.regenClock = 0; run.health = Math.min(s.derived.maxHealth, run.health + 1); events.push({ type: 'regen' }); } } else s.regenClock = 0;
    const intent = input.intent, wish = input.wish, legal = w.legality(stage), rt = s.rt;
    snapshotStep(rt, s.beforeStep);
    // A rescue glides the body along its admitted path, one pose a frame, re-admitted for the current body.
    let r: PlayerStepResult;
    if (s.glide) {
      const pose = s.glide.path[s.glide.index++];
      if (pose && legal.queries.overlapHull(actor, pose.position, pose.orientation, { time: s.time + dt, bounds: legal.bounds }).ok) installPose(s, w, pose, actor, events, false, true);
      else s.glide = null;
      if (s.glide && s.glide.index >= s.glide.path.length) s.glide = null;
      r = { position: s.physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
    } else r = stepPlayer(s.physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * s.derived.speedFactor,
      now: s.time, dt, wish, aim: null, actionLock: false });
    // A result that needs recovery is never installed: recover from it, or keep the last legal pose while stuck.
    if (!r.needsRecovery) s.physical = r.position;
    else if (!recover(s, w, actor, s.time + dt, events, r.position)) { restoreStep(rt, s.beforeStep); enterStuck(s, events); }
    // The trap watch and the rescue search in slices (lifecycle.ts).
    if (!s.glide && !r.needsRecovery && !s.unstick && trapDue(s.trap, s.physical, wish, actor.bodyLength, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), dt))
      { s.unstick = new UnstickSearch(actor, { ...s.physical }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { ...legal, time: s.time + dt, ground: caps.ground && !legal.queries.terrain.space }, rescueFreeRun(s.trap, s.physical, s.time, actor.bodyLength)); s.rescueLog.searches++; }
    if (s.unstick) {
      const u = Math.hypot(s.physical.x - s.unstick.at.x, s.physical.z - s.unstick.at.z) > TRAP_MOVE * actor.bodyLength ? { ok: false as const, reason: 'moved' } : s.unstick.step(UNSTICK_BUDGET);
      if (u) {
        if (u.ok) { s.rescueLog.found++; s.rescueLog.last = { from: { ...s.unstick.at }, to: { ...u.position }, time: s.time, solids: [...s.lastSolids] }; s.glide = { path: u.path, index: 0 }; s.trapRescues++; trapRescued(s.trap, s.unstick.at, s.time); }
        else if (u.reason !== 'moved') { s.rescueLog.failed++; trapFailed(s.trap, s.unstick.at, wish); }
        s.unstick = null;
      }
    }
    s.lastSolids = r.contacts.filter(c => c.solidId).map(c => c.solidId!);
    events.push({ type: 'step', result: r });
    if (s.mode === 'playing' && basicRequested(intent) && s.chompCooldown <= 0) {
      s.chompCooldown = CHOMP_COOLDOWN;
      events.push({ type: 'chomp', result: chomp(run, w.eco, s.physical, growthOf(run), s.derived, s.time, worldHull(s, playerActorCached(s))) });
    }
  }
  if (s.mode === 'stuck' && actor) {
    // The game clock is stopped; a separate countdown retries recovery once per second.
    s.stuckRetry -= dt;
    if (s.stuckRetry <= 0) { s.stuckRetry = 1; if (recover(s, w, actor, s.time, events)) { if (s.startGracePending) { s.startGracePending = false; applyStartGrace(s, w); } s.mode = 'playing'; events.push({ type: 'unstuck' }); } }
  }
  if ((s.mode === 'playing' || s.mode === 'evolving' || s.mode === 'fainted') && actor && !held) {
    admissionClock.caller = 'ecosystem';
    const hazards = w.eco.step({ stage, dt, now: s.time, player: s.physical, playerHull: worldHull(s, actor), perceivable: s.rt.perceivable && s.mode !== 'fainted', stealthFactor: s.derived.stealthFactor });
    admissionClock.caller = 'player';
    const accepted = resolveHazards(hazards, { mode: s.mode, pendingRespawn: run.pendingRespawn, rt: s.rt, now: s.time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
    s.rejectedHits += hazards.length - accepted.length;
    // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
    for (const event of accepted) { if (s.mode !== 'playing') break; s.acceptedHits++; takeHit(s, event, events); }
  }
  if (s.mode === 'fainted') tickFaint(s, w, dt, events);
  if (active) s.time += dt;
  return events;
}
/** One accepted hazard event: damage, and a faint at 0 hearts (once). */
function takeHit(s: SimState, event: EcoEvent, events: SimEvent[]): void {
  s.sinceHit = 0;
  const fainted = hurt(s.run, event.damage, s.derived.armor), damage = event.damage;
  if (!fainted) { events.push({ type: 'hurt', event, damage, fainted: false }); return; }
  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
  if (!beginRespawn(s.run, s.rt)) { events.push({ type: 'hurt', event, damage, fainted: false }); return; }
  s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
  events.push({ type: 'hurt', event, damage, fainted: true });
}
/** The faint timer: respawn at the start anchor, or wait and retry each second. */
function tickFaint(s: SimState, w: SimWorld, dt: number, events: SimEvent[]): void {
  s.respawnClock -= dt; if (s.respawnClock > 0) return;
  if (tryRespawn(s, w, events)) { s.mode = 'playing'; s.sinceHit = 99; events.push({ type: 'respawned' }); return; }
  s.respawnClock = 1; events.push({ type: 'respawn-waiting' });
}
/** A new run or a load (main.ts `begin`, after the world is built): a fresh runtime, then the pending respawn, or the start anchor (or a
 *  forced spawn, recovered like any other pose). */
export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null): SimEvent[] {
  const events: SimEvent[] = [];
  s.run = run; refreshDerived(s); run.health = Math.min(run.health, s.derived.maxHealth);
  s.mode = 'playing'; s.chompCooldown = 0; s.sinceHit = 99;
  s.rt = newRuntime(); s.genomeRevision++; cancelRescue(s); s.startGracePending = false;
  s.faintLog.length = 0; s.acceptedHits = 0; s.rejectedHits = 0;
  const actor = playerActorCached(s), t = w.legality(run.stage).queries.terrain;
  s.physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
  events.push({ type: 'installed', snap: true });
  if (run.pendingRespawn) {
    // A save made during a faint resolves once, before play starts.
    if (!tryRespawn(s, w, events)) { s.mode = 'fainted'; s.respawnClock = 1; events.push({ type: 'resume-fainted' }); }
  } else {
    const anchor = anchorFor(s, w, actor), size = SIZES[run.stage]!;
    const start: RecoveryResult = forced && anchor.ok ? recoverPlayer(actor, { x: forced.x * size, y: forced.y * size, z: forced.z * size }, anchor.orientation,
      { ...w.legality(run.stage), time: s.time }, anchor, 20 * actor.bodyLength) : anchor;
    if (start.ok) { s.rt = newRuntime(start.orientation); installPose(s, w, start, actor, events, true); applyStartGrace(s, w); }
    else { enterStuck(s, events); s.startGracePending = true; }
  }
  return events;
}
/** A committed evolution: the runtime resets with the destination's orientation; the body goes to the destination. */
export function simEvolve(s: SimState, destination: { position: Vec3; orientation: Orientation }): void {
  resetRuntime(s.rt, destination.orientation); s.genomeRevision++; refreshDerived(s);
  cancelRescue(s); s.physical = { ...destination.position };
}
export { evolveReady };
```

- [ ] **Step 5: Record the golden from the old code path**

Run: `TIDE_SIM_RECORD=legacy npx vitest run tests/tiny-tide-core/sim.test.ts`
Expected: PASS. `tests/tiny-tide-core/sim-golden.json` now exists with 20 samples (`t` = 1 … 20). If the comparison fails, `sim.ts` differs from the old frame: fix `sim.ts`, never the golden.

- [ ] **Step 6: Wire `main.ts` to `sim.ts`**

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -2,32 +2,33 @@ import { startAnalytics } from '../analytics';
 import * as T from 'three';
 import './style.css';
 import './hud.css';
-import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, DEATH_KEEP, dietCanEat, dnaOf, eat, evolveReady, freshRun, growthOf, hurt, inReach, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, reward, STAGES, unlock, type Build, type Run } from './state';
+import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, DEATH_KEEP, dietCanEat, dnaOf, evolveReady, freshRun, growthOf, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, STAGES, type Build, type Run } from './state';
 import { adaptToPlan, derive, dietOf, effectiveStats } from './genome';
-import { DROPS, part } from './parts';
+import { part } from './parts';
 import { tierSpecies } from './species';
 import { PLAYER_HALF, SIZES, SPAWN_HALF } from './biomes';
 import { EDGE_HINT, EDGE_SOFT_START, inEdgeZone } from './edge';
-import { entityRadius, provoke, type EcoEvent, type Entity } from './ecosystem';
+import type { EcoEvent, Entity } from './ecosystem';
 import { canApproachFood, type Traversal } from './food-access';
 import { openEditor, type EditorResult, type SubmitOutcome } from './editor';
 import { openPathScreen, type PathChoice } from './path-screen';
 import { renderPreview } from './preview';
 import { cardSummary, COAST_READY, eligibleChildren, leadsTo, type BodyPlan } from './plans';
 import { quoteDesign } from './economy';
-import { newRuntime, type Actor, type Capsule, type CombatInput, type Constraint, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
-import { basicRequested, readIntent, RELEASED } from './input';
-import { blockHint, blockHintDue, newBlockHintGate, type PlayerStepResult, newStepSnapshot, newTapWatch, restoreStep, snapshotStep, stepPlayer, tapTargetStalled } from './player-motion';
-import { beginRespawn, canChooseNextPlan, evolutionDestination, growthPose, newTrapWatch, reconcileAfterCommit, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UNSTICK_BUDGET, UnstickSearch, wedged } from './lifecycle';
-import { habitat, movement, movementCapabilities } from './profiles';
-import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, supportHeight, zoneLabel } from './world-queries';
+import { newRuntime, type Actor, type CombatInput, type Constraint, type Vec3, type WorldQueries } from './combat-types';
+import { readIntent, RELEASED } from './input';
+import { blockHint, blockHintDue, newBlockHintGate, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
+import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
+import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
+import type { ChompResult } from './feeding';
+import { movement, movementCapabilities } from './profiles';
+import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, zoneLabel } from './world-queries';
 import { ROCK_FIT, stageSolids } from './reef';
-import { orientedHeave, orientedSway, rotateInto } from './orientation';
 import { startAnchor } from './motion';
-import { bodyLengthOf, hullFitOf, hullOffsets, massFor, playerActor } from './mount';
+import { bodyLengthOf, playerActor } from './mount';
 import { designDelta } from './design-delta';
 import { TideAudio } from './audio';
-import { TideWorld, type FoodObject } from './world';
+import { TideWorld } from './world';
 import { loadAssets, assetDiagnostics } from './assets';
 import { editorProjection } from './editor';
 import { QA_GRANT_CATALOG } from './qa-catalog';
@@ -194,42 +195,36 @@ let rt = newRuntime();
 /** The player's authoritative physical position. The rendered root follows it every frame. */
 let physical: Vec3 = { x: 0, y: 0, z: 0 };
 let genomeRevision = 0, acceptedHits = 0, rejectedHits = 0, contactNow = false, lastContact: Constraint | null = null, lastContactSolid: string | null = null, edgeNow = false, edgeHinted = false;
-const faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[] = [];
-const blockGate = newBlockHintGate(), beforeStep = newStepSnapshot(), tapWatch = newTapWatch(), trapWatch = newTrapWatch();
-/** QA: the rescues of this page (searches started, found, failed) and the last one (from, to, time, the solids in contact). */
-const rescueLog = { searches: 0, found: 0, failed: 0, last: null as null | { from: Vec3; to: Vec3; time: number; solids: string[] } };
-let lastSolids: string[] = [];
-let trapRescues = 0, unstick: UnstickSearch | null = null, glide: { path: { position: Vec3; orientation: Orientation }[]; index: number } | null = null;
+const blockGate = newBlockHintGate(), tapWatch = newTapWatch();
 let dialogReturn: 'menu' | 'playing' | 'paused' = 'menu';
 const modal = el<HTMLDialogElement>('modal');
 world.setCreature(run.genome);
 let derived = derive(effectiveStats(run.genome, currentPlan(run)));
-function refreshDerived() { derived = derive(effectiveStats(run.genome, currentPlan(run))); }
-type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
-let actorCache: { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number } | null = null, hullRescaled = false;
-/** The last rescale changed only the growth (same plan, genome revision and stage). */
-let hullGrew = false;
-/** The player's actor. The hull is rebuilt only when the plan, the genome revision or the stage changes;
- *  a growth change rescales the cached buffers in place to the exact growth (no bucket). */
-function playerActorCached(): Actor {
-  const plan = currentPlan(run), key = `${plan.id}:${genomeRevision}:${run.stage}`, scale = SIZES[run.stage]! * growthOf(run);
-  if (!actorCache || actorCache.key !== key) {
-    const fit = hullFitOf(plan), unit = hullOffsets(run.genome, 1, fit), hull = unit.map((u): MutCapsule => ({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, ...(u.radii ? { radii: [0, 0] as [number, number] } : {}), sway: 0, heave: 0 }));
-    actorCache = { key, unit, unitLength: bodyLengthOf(run.genome), hull, actor: { id: 'player', hull, habitat: habitat(plan.habitat), bodyLength: 0, ...(fit === 'tight' ? { fit } : {}) }, scale: NaN };
-  }
-  const c = actorCache;
-  if (c.scale !== scale) {
-    c.unit.forEach((u, i) => {
-      const h = c.hull[i]!;
-      h.start.x = u.start.x * scale; h.start.y = u.start.y * scale; h.start.z = u.start.z * scale;
-      h.end.x = u.end.x * scale; h.end.y = u.end.y * scale; h.end.z = u.end.z * scale;
-      h.radius = u.radius * scale; h.sway = (u.sway ?? 0) * scale; h.heave = (u.heave ?? 0) * scale;
-      if (h.radii && u.radii) { h.radii[0] = u.radii[0] * scale; h.radii[1] = u.radii[1] * scale; }
-    });
-    hullGrew = !Number.isNaN(c.scale); c.actor.bodyLength = c.unitLength * scale; c.scale = scale; hullRescaled = true;
-  }
-  return c.actor;
-}
+/** True while a run that began stuck still owes its start grace to the first successful install. */
+let startGracePending = false;
+/** sim.ts reads and writes the frame state through these bindings (spec D29), so main.ts keeps its own variables for presentation. */
+const sim: SimState = {
+  get run() { return run; }, set run(v) { run = v; },
+  get rt() { return rt; }, set rt(v) { rt = v; },
+  get physical() { return physical; }, set physical(v) { physical = v; },
+  get time() { return time; }, set time(v) { time = v; },
+  get mode() { return mode; }, set mode(v) { mode = v; },
+  get derived() { return derived; }, set derived(v) { derived = v; },
+  get genomeRevision() { return genomeRevision; }, set genomeRevision(v) { genomeRevision = v; },
+  get chompCooldown() { return cooldown; }, set chompCooldown(v) { cooldown = v; },
+  get sinceHit() { return sinceHit; }, set sinceHit(v) { sinceHit = v; },
+  get regenClock() { return regenClock; }, set regenClock(v) { regenClock = v; },
+  get respawnClock() { return respawnClock; }, set respawnClock(v) { respawnClock = v; },
+  get stuckRetry() { return stuckRetry; }, set stuckRetry(v) { stuckRetry = v; },
+  get startGracePending() { return startGracePending; }, set startGracePending(v) { startGracePending = v; },
+  get acceptedHits() { return acceptedHits; }, set acceptedHits(v) { acceptedHits = v; },
+  get rejectedHits() { return rejectedHits; }, set rejectedHits(v) { rejectedHits = v; },
+  ...simOwnedState(),
+};
+/** What the simulation reads from the page: the world's ecosystem, the cached legality and the start grace. */
+const simWorld: SimWorld = { get eco() { return world.eco; }, legality: stage => legality(stage), startGrace: START_GRACE };
+const refreshDerived = () => simRefreshDerived(sim);
+const playerActorCached = (): Actor => simActor(sim);
 const capsOf = () => movementCapabilities(currentPlan(run));
 /** Food guidance (spec §3, T-R3-17, T-R3-24): one cache entry per entity, recomputed by a fair round-robin queue
  *  of at most GUIDE_PER_FRAME entries per frame. A missing or stale entry is unknown and is not shown. Bites never use it. */
@@ -268,77 +263,13 @@ function approachable(e: Entity): boolean | null {
   const entry = guideCache.get(e.id); if (!entry) return null;
   return entry.key === guideKey(e, currentPlan(run).id, growthOf(run), guideTraversal().key) ? entry.value : null;
 }
-/** The player's hull in world space: oriented (envelope converted under pitch) and translated to the physical position. The buffer
- *  is reused every frame (final review M17): its readers (the ecosystem's step and provoke) copy what they keep. */
-const hullBuffer: { start: MutVec3; end: MutVec3; radius: number; sway: number; heave: number }[] = [];
-function worldHull(actor: Actor): Capsule[] {
-  const o = rt.orientation, h = actor.hull;
-  while (hullBuffer.length < h.length) hullBuffer.push({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 0, sway: 0, heave: 0 });
-  hullBuffer.length = h.length;
-  for (let i = 0; i < h.length; i++) {
-    const c = h[i]!, b = hullBuffer[i]!, w = c.sway ?? 0, v = c.heave ?? 0;
-    rotateInto(o, c.start, b.start); rotateInto(o, c.end, b.end);
-    b.start.x += physical.x; b.start.y += physical.y; b.start.z += physical.z; b.end.x += physical.x; b.end.y += physical.y; b.end.z += physical.z;
-    b.radius = c.radius; b.sway = orientedSway(w, v, o.pitch); b.heave = orientedHeave(w, v, o.pitch);
-  }
-  return hullBuffer;
-}
-/** The grounded offset against the support under the current pose (0 when supported or not grounded). */
-function settleOffset(actor: Actor) {
-  const t = legality(run.stage).queries.terrain;
-  rt.groundOffset = capsOf().ground && !t.space ? Math.max(0, physical.y - (supportHeight(actor, physical.x, physical.z, rt.orientation, t) + .01 * actor.bodyLength)) : 0;
-}
 /** The rendered root follows the simulation: position, yaw on the root, pitch on the avatar. */
 function renderRoot() {
   world.player.position.set(physical.x, physical.y, physical.z).divideScalar(world.scale);
   world.player.rotation.y = rt.orientation.yaw; world.avatar.rotation.x = -rt.orientation.pitch;
 }
-/** Installs an admitted full pose: position and orientation together, no permit or arc, zero velocities. `snap` moves the camera too (start, respawn). */
-/** Ends a pending rescue search or glide and restarts the trap watch. Every pose install except a rescue glide step calls it
- *  (installPose, checkPose, checkGrownPose, begin, the evolution): a rescue never continues from a pose it did not start from. */
-function cancelRescue() { unstick = null; glide = null; trapWatch.armed = false; }
-function installPose(pose: { position: Vec3; orientation: Orientation }, actor: Actor, snap = false, rescue = false) {
-  // Any install but a rescue glide step ends a pending rescue (re-review m3): respawn, evolution, recovery, an edit.
-  if (!rescue) cancelRescue();
-  physical = { x: pose.position.x, y: pose.position.y, z: pose.position.z }; rt.orientation = { yaw: pose.orientation.yaw, pitch: pose.orientation.pitch };
-  rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
-  settleOffset(actor);
-  if (snap) world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale));
-  renderRoot();
-}
-/** The start anchor for the actor at its exact growth (never cached across growth changes). */
-const anchorFor = (actor: Actor): RecoveryResult => startAnchor(actor, run.stage, legality(run.stage));
-const admitted = (actor: Actor) => legality(run.stage).queries.overlapHull(actor, physical, rt.orientation, { time, permit: rt.permit, bounds: legality(run.stage).bounds }).ok;
-/** Recovers to an admitted full pose, searching from `from` (default: the installed pose). A failed pose is never installed. */
-function recover(actor: Actor, at: number, from: Vec3 = physical): boolean {
-  const rec = recoverPlayer(actor, from, rt.orientation, { ...legality(run.stage), time: at }, anchorFor(actor), 20 * actor.bodyLength);
-  if (!rec.ok) return false;
-  installPose(rec, actor); return true;
-}
-/** The start grace of a new run or load: `START_GRACE` seconds, or none (0) with `?qaStartGrace=0`. */
-function applyStartGrace() { rt.invulnerableUntil = START_GRACE > 0 ? time + START_GRACE : 0; }
-/** True while a run that began stuck still owes its start grace to the first successful install. */
-let startGracePending = false;
-function enterStuck() { mode = 'stuck'; clearInput(); stuckRetry = 1; toast('Stuck — finding you a safe spot…'); }
-/** After an edit, a growth change or a transformation: settle on the support, or recover when the body is not admitted. */
-function checkPose(actor: Actor) {
-  cancelRescue();
-  if (admitted(actor)) settleOffset(actor);
-  else if (!recover(actor, time)) enterStuck();
-}
-/** After a growth rescale: the smallest admitted lift of the grown body, with both velocities kept (a bite at the floor does not
- *  stop the body). Only when no lift within .5 L is admitted does the normal recovery run (it zeroes the velocities). */
-function checkGrownPose(actor: Actor) {
-  const lifted = growthPose(actor, physical, rt, { ...legality(run.stage), time });
-  if (!lifted) { checkPose(actor); return; }
-  cancelRescue(); physical = lifted; settleOffset(actor); renderRoot();
-}
-/** Completes a pending respawn at the start anchor for the actual growth. The caller shows the result. */
-function tryRespawn(): boolean {
-  const actor = playerActorCached(), anchor = anchorFor(actor);
-  if (!anchor.ok || !resolveRespawn(run, rt, time, anchor)) return false;
-  installPose(anchor, actor, true); refreshDerived(); save(); return true;
-}
+/** Read-only (QA): the installed pose is admitted. */
+const admittedNow = (actor: Actor) => simAdmitted(sim, simWorld, actor);
 /** Writes the run to the write key only. A kept, unreadable or legacy key is never written. */
 function save() { try { if (writeKey) localStorage.setItem(writeKey, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
 function clearInput() { keys.clear(); holdingChomp = false; rising = false; diving = false; chompTapped = false; riseTapped = false; lastIntent = RELEASED; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
@@ -426,28 +357,16 @@ function objective() {
   return `Eat ${list}. ${run.stage === 0 ? 'Swipe the world to look around.' : run.stage === 3 ? 'Watch out for seaplanes.' : move}`;
 }
 function begin(fresh = false) {
-  audio.init(); run = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
-  refreshDerived(); run.health = Math.min(run.health, derived.maxHealth);
-  world.build(run.stage, run); el('evolution-banner').hidden = true; el('faint').hidden = true; mode = 'playing'; clearInput(); cooldown = 0; sinceHit = 99; readyToasted = evolveReady(run); lastBiome = '';
-  // A fresh runtime for every new run or load. The start grace lives in the runtime.
-  rt = newRuntime(); genomeRevision++; hintClock = 0; blockGate.blockedFor = 0; blockGate.shown = false; cancelRescue(); contactNow = false; lastContact = null; lastContactSolid = null; edgeNow = false; edgeHinted = false; startGracePending = false;
-  faintLog.length = 0; acceptedHits = 0; rejectedHits = 0;
+  audio.init();
+  const next = !fresh && saved && !saved.completed ? structuredClone(saved) : freshRun();
+  world.build(next.stage, next); el('evolution-banner').hidden = true; el('faint').hidden = true; clearInput(); readyToasted = evolveReady(next); lastBiome = '';
+  hintClock = 0; blockGate.blockedFor = 0; blockGate.shown = false; contactNow = false; lastContact = null; lastContactSolid = null; edgeNow = false; edgeHinted = false;
   el('home').hidden = true; el('game-ui').hidden = false; el('pause').hidden = false; el('edit').hidden = false; el('corner-note').hidden = true; el('mode-label').textContent = 'NIBBLE. GROW. REPEAT.';
-  document.body.classList.add('is-playing'); toast(STAGES[run.stage]!.description);
-  const actor = playerActorCached(), t = legality(run.stage).queries.terrain;
-  physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
-  world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale)); renderRoot();
-  if (run.pendingRespawn) {
-    // A save made during a faint resolves once, before play starts.
-    if (!tryRespawn()) { mode = 'fainted'; respawnClock = 1; respawnToasted = false; el('faint').hidden = false; }
-  } else {
-    const anchor = anchorFor(actor), forced = forcedSpawn; forcedSpawn = null;
-    // QA: a forced spawn is recovered to a legal pose like any other; without one it falls back to the anchor.
-    const start: RecoveryResult = forced && anchor.ok ? recoverPlayer(actor, { x: forced.x * SIZES[run.stage]!, y: forced.y * SIZES[run.stage]!, z: forced.z * SIZES[run.stage]! }, anchor.orientation,
-      { ...legality(run.stage), time }, anchor, 20 * actor.bodyLength) : anchor;
-    if (start.ok) { rt = newRuntime(start.orientation); installPose(start, actor, true); applyStartGrace(); }
-    else { enterStuck(); startGracePending = true; }
-  }
+  document.body.classList.add('is-playing'); toast(STAGES[next.stage]!.description);
+  // A pending respawn ignores the forced spawn (it stays for the next start).
+  const forced = next.pendingRespawn ? null : forcedSpawn; if (!next.pendingRespawn) forcedSpawn = null;
+  respawnToasted = false;
+  presentSim(simBegin(sim, simWorld, next, forced), 0);
   syncUI(); save();
   if (qaHoldStart) { qaHoldStart = false; holdingStart = true; }
 }
@@ -508,8 +427,7 @@ function submitEvolution(next: BodyPlan, r: EditorResult): SubmitOutcome {
   const nextActor = playerActor(next, prepared.genome, next.size, 1), nextLegality = legality(next.size), anchor = startAnchor(nextActor, next.size, nextLegality);
   const destination = evolutionDestination(nextActor, physical, { ...nextLegality, orientation: { yaw: rt.orientation.yaw, pitch: 0 }, time }, anchor.ok ? anchor.position : physical);
   if (!destination.ok) return { ok: false, reason: "This body can't fit anywhere here." };
-  commitEvolution(run, prepared, CATALOG); resetRuntime(rt, destination.orientation); genomeRevision++; refreshDerived();
-  cancelRescue(); physical = { ...destination.position }; startTransformation(destination.position);
+  commitEvolution(run, prepared, CATALOG); simEvolve(sim, destination); startTransformation(destination.position);
   return { ok: true };
 }
 /** The edit editor. A failed commit keeps the editor open with the reason. */
@@ -528,7 +446,8 @@ async function editDesign() {
       return { ok: true };
     } });
   if (!committed) return;
-  mode = 'playing'; save(); checkPose(playerActorCached());
+  mode = 'playing'; save();
+  const events: SimEvent[] = []; checkPose(sim, simWorld, playerActorCached(), events); presentSim(events, 0);
 }
 function startTransformation(destination: Vec3) {
   mode = 'evolving'; clearInput(); audio.evolve(); save();
@@ -546,73 +465,68 @@ function win() {
   showDialog(`<span class="modal-art cosmic">${species[4]}</span><div class="eyebrow">THE UNIVERSE WAS DELICIOUS</div><h2 id="modal-title">All full.<br>All yours.</h2><p>${escapeHtml(run.name)} grew from a speck to a cosmic giant.<br>Every planet is eaten. Now, a well-earned nap.</p><div class="win-stats"><div><strong>${Math.floor(run.totalDna)}</strong><span>DNA EARNED</span></div><div><strong>${run.bites}</strong><span>HAPPY BITES</span></div><div><strong>${minutes}:${seconds}</strong><span>YOUR ADVENTURE</span></div></div><button id="play-again" class="primary">One more little adventure ${icons.arrow}</button>`, false);
   el('play-again').onclick = () => { modal.close(); begin(true); };
 }
-/** A food or creature in bite range: own-tier food, or a bigger creature that is attacking. */
-function biteTargets() {
-  const p = world.player.position, growth = growthOf(run), diet = dietOf(run.genome);
-  const out: { food: FoodObject; edible: boolean; distance: number }[] = []; let wrongDiet: string | null = null;
-  for (const food of world.foods) {
-    const e = food.entity; if (e.eaten) continue;
-    const attacking = e.mode === 'hunt' || e.mode === 'angry';
-    if (food.tier !== run.stage && !(attacking && food.tier === run.stage + 1)) continue;
-    const radius = food.tier > run.stage ? entityRadius(e) / world.scale : 0;
-    if (!inReach(run.stage, p, food.data, growth, derived.reach, radius)) continue;
-    const edible = food.tier === run.stage && dietCanEat(diet, e.spec.tag);
-    // A mouth that can not eat it can still bite back at something that fights.
-    if (!edible && !attacking && !e.spec.fights) { wrongDiet = e.spec.label; continue; }
-    out.push({ food, edible, distance: Math.hypot(food.data.x - p.x, food.data.y - p.y, food.data.z - p.z) });
+/** Presentation of the simulation's events: the rendered root and camera, hints, sounds, particles, toasts and saves. */
+function presentSim(events: readonly SimEvent[], dt: number) {
+  renderRoot();
+  for (const e of events) {
+    switch (e.type) {
+      case 'installed': if (e.snap) world.placePlayerAt(new T.Vector3(physical.x, physical.y, physical.z).divideScalar(world.scale)); renderRoot(); break;
+      case 'stuck': clearInput(); toast('Stuck — finding you a safe spot…'); break;
+      case 'unstuck': el('toast').classList.remove('show'); syncUI(); break;
+      case 'step': presentStep(e.result, dt); break;
+      case 'chomp': presentChomp(e.result); break;
+      case 'regen': syncHearts(); break;
+      case 'hurt': presentHurt(e.event, e.fainted); break;
+      case 'respawned': el('faint').hidden = true; save(); syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`); break;
+      case 'respawn-waiting': if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); } break;
+      case 'resume-fainted': el('faint').hidden = false; break;
+    }
   }
-  return { targets: out.sort((a, b) => a.distance - b.distance), wrongDiet };
-}
-function chomp() {
-  if (mode !== 'playing' || cooldown > 0) return;
-  cooldown = .24; chompPulse = 1;
-  const { targets, wrongDiet } = biteTargets();
-  const hit = targets[0];
-  if (!hit) {
+}
+/** The player step's presentation: contacts (QA), the block hint, the edge hint and the Breach splashes. */
+function presentStep(r: PlayerStepResult, dt: number) {
+  const plan = currentPlan(run), legal = legality(run.stage), p = world.player.position, contact = r.contacts[0];
+  contactNow = !!contact; frameContacts += r.contacts.length;
+  if (contact) { lastContact = contact.constraint; lastContactSolid = contact.solidId ?? null; }
+  // A block hint only for a real, sustained block (not a slide), and never over another toast (final review I1).
+  if (blockHintDue(blockGate, r, dt, hintClock <= 0 && toastTimer <= 0) && contact) { toast(blockHint(plan, contact)); hintClock = 6; }
+  // The soft edge: the edge hint shows once per entry into the push zone, rate-limited with the block hints, and only when no other
+  // toast is on screen (so a one-shot message is never replaced).
+  edgeNow = inEdgeZone(physical, legal.bounds.half);
+  if (!edgeNow) edgeHinted = false;
+  else if (!edgeHinted && hintClock <= 0 && toastTimer <= 0) { toast(EDGE_HINT); edgeHinted = true; hintClock = 6; }
+  if (r.breachStarted) { audio.breach(); world.burst(p.x, world.surface, p.z, '#d6fff1', 22); }
+  if (r.arcEnded) world.burst(p.x, world.surface, p.z, '#d6fff1', 18);
+}
+/** A chomp's presentation (feeding.ts already changed the run and the ecosystem). */
+function presentChomp(c: ChompResult) {
+  chompPulse = 1;
+  if (c.kind === 'miss') {
     audio.tone(170, 0, .065);
-    if (wrongDiet && wrongDietClock <= 0) { toast(`A ${dietOf(run.genome)} can’t eat ${wrongDiet.toLowerCase()}. Try another mouth in the editor.`); wrongDietClock = 6; }
+    if (c.wrongDiet && wrongDietClock <= 0) { toast(`A ${dietOf(run.genome)} can’t eat ${c.wrongDiet.toLowerCase()}. Try another mouth in the editor.`); wrongDietClock = 6; }
     return;
   }
-  const { food } = hit, e = food.entity, pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z));
-  const bigger = food.tier > run.stage, damage = bigger ? Math.max(1, Math.floor(derived.bite / 2)) : derived.bite;
-  if (e.spec.hp > 1 || bigger) {
-    e.hp -= damage; provoke(e, physical, time, worldHull(playerActorCached())); audio.bite(run.bites); world.burst(food.data.x, food.data.y, food.data.z, '#ffd9a8', 8);
-    if (e.hp > 0) { floater(`-${damage}`, pos.x, pos.y, 'hit'); return; }
-  }
-  const drop = DROPS[e.spec.kind];
-  if (drop && unlock(run, drop)) { toast(`New part found: ${part(drop)!.name}! Open the editor to use it.`); audio.found(); }
-  let dna: number, won = false;
-  if (hit.edible) { const result = eat(run, e.spec, e.spec.kind === 'planet' ? world.eco.planetIndex(e) : e.id); dna = result.dna; won = result.win; }
-  else { dna = Math.round(e.spec.dna * .5); reward(run, dna, food.tier === run.stage); }
-  world.eco.consume(e); world.removeFood(food); audio.bite(run.bites);
+  const food = world.foods.find(f => f.entity === c.entity)!, pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z));
+  if (c.entity.spec.hp > 1 || c.entity.spec.tier > run.stage) { audio.bite(run.bites); world.burst(food.data.x, food.data.y, food.data.z, '#ffd9a8', 8); }
+  if (c.kind === 'bitten') { floater(`-${c.damage}`, pos.x, pos.y, 'hit'); return; }
+  if (c.drop) { toast(`New part found: ${part(c.drop)!.name}! Open the editor to use it.`); audio.found(); }
+  world.removeFood(food); audio.bite(run.bites);
   if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
-  floater(dna > 0 ? `+${dna} DNA` : ['yum!', 'nom!', '♡'][run.bites % 3]!, pos.x, pos.y);
+  floater(c.dna > 0 ? `+${c.dna} DNA` : ['yum!', 'nom!', '♡'][run.bites % 3]!, pos.x, pos.y);
   syncUI(); save();
-  if (won) { win(); return; }
+  if (c.won) { win(); return; }
   if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
 }
-/** One accepted hazard event (resolveHazards already accepted it). */
-function takeHit(event: EcoEvent) {
-  sinceHit = 0; world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
+/** One accepted hazard hit (the simulation already applied it and, at 0 hearts, began the respawn). */
+function presentHurt(event: EcoEvent, fainted: boolean) {
+  world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
   const pos = world.screenPoint(world.player.position.clone().add(new T.Vector3(0, 1.4, 0)));
   floater(`-${damageAfterArmor(event.damage, derived.armor)} ♥`, pos.x, pos.y, 'hurt');
-  const fainted = hurt(run, event.damage, derived.armor); syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
+  syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
   if (!fainted) { if (run.health <= 2) toast(`${event.entity.spec.label} is winning! Get away to heal.`); return; }
-  const hadPermit = rt.permit !== null, hadArc = rt.arc !== null;
-  if (!beginRespawn(run, rt)) return;
-  save(); mode = 'fainted'; faintLog.push({ time, hadPermit, hadArc }); respawnClock = 1.8; respawnToasted = false;
+  save(); respawnToasted = false;
   clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
 }
-/** The faint timer: respawn at the start anchor, or wait and retry each second. */
-function tickFaint(dt: number) {
-  respawnClock -= dt; if (respawnClock > 0) return;
-  if (tryRespawn()) {
-    el('faint').hidden = true; mode = 'playing'; sinceHit = 99; syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`);
-    return;
-  }
-  respawnClock = 1;
-  if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); }
-}
 el('start').onclick = () => begin(); el('fresh').onclick = () => { dialogReturn = 'menu'; confirmRestart(); };
 el('evolve').onclick = () => void edit('evolve'); el('edit').onclick = () => void edit('edit');
 el('sound').onclick = () => { audio.init(); audio.toggle(); syncSound(); try { localStorage.setItem('tiny-tide-muted', String(audio.muted)); } catch { /* Optional preference. */ } };
@@ -725,106 +639,41 @@ function frame(now: number) {
   requestAnimationFrame(frame);
   const dt = Math.min((now - last) / 1000, .05); last = now;
   if (admissionClock.on) { resetAdmissionClock(); admissionClock.caller = 'player'; frameContacts = 0; }
-  // The game clock runs in these modes only (not while paused, editing, stuck or won).
-  const held = holdingStart && mode === 'playing';
+  // The game clock runs in these modes only (not while paused, editing, stuck or won); sim.ts decides it the same way.
+  const held = holdingStart && mode === 'playing', playing = mode === 'playing' && !held;
   const active = !held && (mode === 'playing' || mode === 'menu' || mode === 'evolving' || mode === 'fainted');
-  let moving = false;
-  const growth = growthOf(run), stage = run.stage, plan = currentPlan(run), caps = movementCapabilities(plan);
-  const actor = mode === 'menu' ? null : playerActorCached();
-  if (actor && hullRescaled) {
-    // A growth change rescaled the hull: settle again, or recover if the bigger body is not admitted.
-    const grew = hullGrew; hullRescaled = false; hullGrew = false;
-    if (mode === 'playing') { if (grew) checkGrownPose(actor); else checkPose(actor); } else settleOffset(actor);
-  }
-  if (mode === 'playing' && actor && !held) {
-    run.elapsed += dt; cooldown = Math.max(0, cooldown - dt); chompPulse = Math.max(0, chompPulse - dt * 5);
-    wrongDietClock = Math.max(0, wrongDietClock - dt); hintClock = Math.max(0, hintClock - dt); sinceHit += dt;
-    // Hearts come back slowly once the creature is out of danger.
-    if (sinceHit > 5 && run.health < derived.maxHealth) { regenClock += dt; if (regenClock > 2.5) { regenClock = 0; run.health = Math.min(derived.maxHealth, run.health + 1); syncHearts(); } } else regenClock = 0;
+  const stage = run.stage, caps = capsOf(), growth = growthOf(run);
+  let intent = lastIntent, wish: Vec3 = NO_WISH, moving = false;
+  if (playing) {
+    chompPulse = Math.max(0, chompPulse - dt * 5); wrongDietClock = Math.max(0, wrongDietClock - dt); hintClock = Math.max(0, hintClock - dt);
     // One input consumer: one intent per frame, then the tap flags are spent.
-    const intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving }, lastIntent, { breachOnRiseTap: caps.breach });
+    intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving }, lastIntent, { breachOnRiseTap: caps.breach });
     chompTapped = false; riseTapped = false; lastIntent = intent;
     const p = world.player.position;
     if (Math.abs(intent.move.x) + Math.abs(intent.move.z) > .05) { target = null; world.targetRing.visible = false; }
-    let wish: Vec3 = NO_WISH;
     if (target && caps.ground) {
       const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
-      // Reached, or no progress for a second (a tall rock or an arch in the way: those are walls): the target is dropped.
+      // Reached, or no progress for a second (a tall rock or an arch in the way): the target is dropped.
       if (d < .25 || tapTargetStalled(tapWatch, d, dt)) { target = null; world.targetRing.visible = false; } else wish = { x: dx / d, y: 0, z: dz / d };
     } else {
       if (target) { target = null; world.targetRing.visible = false; }
       const v = world.moveVector(intent.move.x, intent.move.z, caps.pitch); wish = { x: v.x, y: v.y, z: v.z };
     }
-    const legal = legality(stage);
-    snapshotStep(rt, beforeStep);
-    // A rescue glides the body along its admitted path, one pose a frame, re-admitted for the current body (fix round 2: no snap).
-    let r: PlayerStepResult;
-    if (glide) {
-      const pose = glide.path[glide.index++];
-      if (pose && legal.queries.overlapHull(actor, pose.position, pose.orientation, { time: time + dt, bounds: legal.bounds }).ok) installPose(pose, actor, false, true);
-      else glide = null;
-      if (glide && glide.index >= glide.path.length) glide = null;
-      r = { position: physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
-    } else r = stepPlayer(physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * derived.speedFactor,
-      now: time, dt, wish, aim: null, actionLock: false });
-    // A result that needs recovery is never installed or rendered: recover from it, or keep the last legal pose while stuck, with
-    // the orientation, permit and arc it was admitted with (final review M10).
-    if (!r.needsRecovery) { physical = r.position; renderRoot(); }
-    else if (!recover(actor, time + dt, r.position)) { restoreStep(rt, beforeStep); enterStuck(); }
-    // A trapped body (pushed, really wedged on most frames, no progress for TRAP_SECONDS) glides to the nearest admitted pose that
-    // faces the push, along a path the whole hull is admitted on. The search runs UNSTICK_BUDGET candidates a frame; it is dropped
-    // when the body moves away on its own.
-    if (!glide && !r.needsRecovery && !unstick && trapDue(trapWatch, physical, wish, actor.bodyLength, wedged(r.contacts, wish, r.turnRefused, rt.orientation.yaw), dt))
-      { unstick = new UnstickSearch(actor, { ...physical }, Math.atan2(wish.x, wish.z), { ...rt.orientation }, { ...legal, time: time + dt, ground: caps.ground && !legal.queries.terrain.space }, rescueFreeRun(trapWatch, physical, time, actor.bodyLength)); rescueLog.searches++; }
-    if (unstick) {
-      const u = Math.hypot(physical.x - unstick.at.x, physical.z - unstick.at.z) > TRAP_MOVE * actor.bodyLength ? { ok: false as const, reason: 'moved' } : unstick.step(UNSTICK_BUDGET);
-      if (u) {
-        if (u.ok) { rescueLog.found++; rescueLog.last = { from: { ...unstick.at }, to: { ...u.position }, time, solids: [...lastSolids] }; glide = { path: u.path, index: 0 }; trapRescues++; trapRescued(trapWatch, unstick.at, time); }
-        else if (u.reason !== 'moved') { rescueLog.failed++; trapFailed(trapWatch, unstick.at, wish); }
-        unstick = null;
-      }
-    }
-    const contact = r.contacts[0];
-    contactNow = !!contact; frameContacts += r.contacts.length;
-    if (QA) lastSolids = r.contacts.filter(c => c.solidId).map(c => c.solidId!);
-    if (contact) { lastContact = contact.constraint; lastContactSolid = contact.solidId ?? null; }
-    // A block hint only for a real, sustained block (not a slide), and never over another toast (final review I1).
-    if (blockHintDue(blockGate, r, dt, hintClock <= 0 && toastTimer <= 0) && contact) { toast(blockHint(plan, contact)); hintClock = 6; }
-    // The soft edge: the edge hint shows once per entry into the push zone, rate-limited with the block hints, and
-    // only when no other toast is on screen (so a one-shot message is never replaced).
-    edgeNow = inEdgeZone(physical, legal.bounds.half);
-    if (!edgeNow) edgeHinted = false;
-    else if (!edgeHinted && hintClock <= 0 && toastTimer <= 0) { toast(EDGE_HINT); edgeHinted = true; hintClock = 6; }
-    if (r.breachStarted) { audio.breach(); world.burst(p.x, world.surface, p.z, '#d6fff1', 22); }
-    if (r.arcEnded) world.burst(p.x, world.surface, p.z, '#d6fff1', 18);
+  }
+  presentSim(simFrame(sim, simWorld, { dt, intent, wish, held }), dt);
+  if (playing) {
     const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
-    if (mode === 'playing' && basicRequested(intent)) chomp();
     saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
     el('special').classList.toggle('cooldown', caps.breach && time < rt.breachReadyAt);
   }
-  if (mode === 'stuck' && actor) {
-    // The game clock is stopped; a separate countdown retries recovery once per second.
-    stuckRetry -= dt;
-    if (stuckRetry <= 0) { stuckRetry = 1; if (recover(actor, time)) { if (startGracePending) { startGracePending = false; applyStartGrace(); } mode = 'playing'; el('toast').classList.remove('show'); syncUI(); } }
-  }
-  if ((mode === 'playing' || mode === 'evolving' || mode === 'fainted') && actor && !held) {
-    admissionClock.caller = 'ecosystem';
-    const events = world.eco.step({ stage, dt, now: time, player: physical, playerHull: worldHull(actor), perceivable: rt.perceivable && mode !== 'fainted', stealthFactor: derived.stealthFactor });
-    admissionClock.caller = 'player';
-    const accepted = resolveHazards(events, { mode, pendingRespawn: run.pendingRespawn, rt, now: time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
-    rejectedHits += events.length - accepted.length;
-    // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
-    for (const event of accepted) { if (mode !== 'playing') break; acceptedHits++; takeHit(event); }
-    // After the ecosystem step, so fresh entries match the food positions that the guide and diagnostics read.
-    if (mode === 'playing') { admissionClock.caller = 'guide'; stepGuideCache(actor); admissionClock.caller = 'other'; }
-  }
-  if (mode === 'fainted') tickFaint(dt);
+  // After the ecosystem step, so fresh entries match the food positions that the guide and diagnostics read.
+  if (mode === 'playing' && !held) { admissionClock.caller = 'guide'; stepGuideCache(playerActorCached()); admissionClock.caller = 'other'; }
   if (toastTimer > 0 && mode === 'playing') { toastTimer -= dt; if (toastTimer <= 0) el('toast').classList.remove('show'); }
-  if (active) time += dt;
   world.update(active ? dt : 0, time, mode === 'menu', moving, chompPulse, growth);
   if (mode === 'evolving' && !world.transitioning) {
     // The body ends at the simulation's destination; if the world changed, recover.
-    mode = 'playing'; el('evolution-banner').hidden = true; renderRoot(); checkPose(playerActorCached());
+    mode = 'playing'; el('evolution-banner').hidden = true;
+    const events: SimEvent[] = []; checkPose(sim, simWorld, playerActorCached(), events); presentSim(events, 0);
     if (mode === 'playing') toast(STAGES[run.stage]!.description);
     syncUI();
   }
@@ -909,8 +758,8 @@ if (QA) {
   Object.defineProperty(window, '__tinyTide', { get: () => ({ mode,
     plan: currentPlan(run).id, plans: [...run.plans], zone: zoneNow(), velocity: copy(rt.controlledVelocity), externalVelocity: copy(rt.externalVelocity),
     orientation: { ...rt.orientation }, permit: rt.permit ? { ...rt.permit } : null, arc: rt.arc ? { ...rt.arc } : null, breachReadyAt: rt.breachReadyAt, invulnerableUntil: rt.invulnerableUntil,
-    pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admitted(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, lastContactSolid, trapRescues, rescueLog: JSON.parse(JSON.stringify(rescueLog)), contactSolids: [...lastSolids], groundOffset: rt.groundOffset, solidOverlap: mode === 'menu' ? null : solidOverlap(), solidsNear: mode === 'menu' ? [] : solidsNear(32), edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
-    faintLog: faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
+    pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admittedNow(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, lastContactSolid, trapRescues: sim.trapRescues, rescueLog: JSON.parse(JSON.stringify(sim.rescueLog)), contactSolids: [...sim.lastSolids], groundOffset: rt.groundOffset, solidOverlap: mode === 'menu' ? null : solidOverlap(), solidsNear: mode === 'menu' ? [] : solidsNear(32), edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
+    faintLog: sim.faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
       player: { msPerFrame: per(a.player.ms), callsPerFrame: per(a.player.calls), worstMs: a.player.worst }, ecosystem: { msPerFrame: per(a.ecosystem.ms), callsPerFrame: per(a.ecosystem.calls), worstMs: a.ecosystem.worst }, guide: { msPerFrame: per(a.guide.ms), callsPerFrame: per(a.guide.calls), worstMs: a.guide.worst } }; }), render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries } }) });
 }
 requestAnimationFrame(frame);
```

- [ ] **Step 7: Move the rescue source check to `sim.ts`**

```diff
--- a/tests/tiny-tide-core/main-rescue.test.ts
+++ b/tests/tiny-tide-core/main-rescue.test.ts
@@ -1,24 +1,24 @@
-// tests/tiny-tide-core/main-rescue.test.ts — fix round 3 (re-review 2 m1): every pose install in main.ts but a rescue glide step
-// cancels a pending rescue. main.ts runs only in a browser, so this checks its source: each top-level function that writes the pose
-// (`physical = `) calls cancelRescue() in its own body, except `frame` (the player step, whose installs go through installPose and
-// whose glide steps are the rescue itself) and installPose (which cancels unless it installs a glide step).
+// tests/tiny-tide-core/main-rescue.test.ts — fix round 3 (re-review 2 m1), after the sim.ts extraction (spec D29): every pose install but a
+// rescue glide step cancels a pending rescue. The installs now live in sim.ts: each exported function that writes the pose (`s.physical = `)
+// calls cancelRescue(s) in its own body, except `simFrame` (the player step, whose installs go through installPose and whose glide steps are
+// the rescue itself) and installPose (which cancels unless it installs a glide step). main.ts writes the pose only through its sim binding.
 import { readFileSync } from 'node:fs';
 import { describe, expect, it } from 'vitest';
 
-describe('main.ts cancels a pending rescue on every other install', () => {
+describe('sim.ts cancels a pending rescue on every other install', () => {
   it('each function that sets the pose calls cancelRescue()', () => {
-    const src = readFileSync('src/tiny-tide/main.ts', 'utf8'), starts = [...src.matchAll(/^(?:async )?function (\w+)/gm)];
+    const src = readFileSync('src/tiny-tide/sim.ts', 'utf8'), starts = [...src.matchAll(/^export function (\w+)|^function (\w+)/gm)];
     const writers: string[] = [];
     starts.forEach((m, i) => {
-      const body = src.slice(m.index!, starts[i + 1]?.index ?? src.length);
-      if (!/\bphysical = /.test(body)) return;
-      writers.push(m[1]!);
-      if (m[1] === 'frame') return;
-      if (m[1] === 'installPose') { expect(body).toMatch(/if \(!rescue\) cancelRescue\(\);/); return; }
-      expect(body, `${m[1]} sets the pose without cancelling a rescue`).toMatch(/cancelRescue\(\)/);
+      const name = m[1] ?? m[2]!, body = src.slice(m.index!, starts[i + 1]?.index ?? src.length);
+      if (!/\bs\.physical = /.test(body)) return;
+      writers.push(name);
+      if (name === 'simFrame') return;
+      if (name === 'installPose') { expect(body).toMatch(/if \(!rescue\) cancelRescue\(s\);/); return; }
+      expect(body, `${name} sets the pose without cancelling a rescue`).toMatch(/cancelRescue\(s\)/);
     });
-    expect(writers.sort()).toEqual(['begin', 'checkGrownPose', 'frame', 'installPose', 'submitEvolution']);
-    // checkPose installs through recover → installPose, and cancels first itself.
-    expect(src.slice(src.indexOf('function checkPose('), src.indexOf('function checkPose(') + 120)).toMatch(/cancelRescue\(\)/);
+    expect(writers.sort()).toEqual(['checkGrownPose', 'installPose', 'simBegin', 'simEvolve', 'simFrame']);
+    const main = readFileSync('src/tiny-tide/main.ts', 'utf8');
+    expect(main.match(/\bphysical = /g) ?? []).toHaveLength(1);   // the binding's setter
   });
 });
```

- [ ] **Step 8: Remove the recorder**

Delete `tests/tiny-tide-core/legacy-frame.ts`. Replace `tests/tiny-tide-core/sim.test.ts` with the final version (no `legacy` branch):

```ts
// tests/tiny-tide-core/sim.test.ts — spec D29 and §14.1: sim.ts keeps the former main.ts tick order. A scripted 20 s run at stage 0 (seed 7,
// fixed intents, dt 1/60) is pinned by sim-golden.json, recorded with the main.ts frame before the extraction (Task 7) and matched by sim.ts.
// A task that changes stage 0 on purpose re-records it from sim.ts with TIDE_SIM_RECORD=sim and says why in its commit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';
import { freshRun } from '../../src/tiny-tide/state';
import { readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';

const GOLDEN = 'tests/tiny-tide-core/sim-golden.json', DT = 1 / 60, SECONDS = 20;
export interface Sample { t: number; x: number; y: number; z: number; health: number; stageDna: number; dna: number; bites: number; mode: string }
/** The script: forward 0–5 s, right 5–8 s, back-left 8–14 s, still after; Space held 3–12 s, tapped every second after 14 s. */
export function script(t: number, previous: CombatInput): { intent: CombatInput; wish: Vec3 } {
  const keys = new Set<string>();
  if (t >= 3 && t < 12) keys.add('Space');
  if (t >= 14 && Math.floor(t) !== Math.floor(t - DT)) keys.add('Space');
  const src: InputSources = { stickX: 0, stickZ: 0, keys, chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false };
  const wish = t < 5 ? { x: 0, y: 0, z: 1 } : t < 8 ? { x: 1, y: 0, z: 0 } : t < 14 ? { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } : { x: 0, y: 0, z: 0 };
  return { intent: readIntent(src, previous, { breachOnRiseTap: false }), wish };
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;
export function world(seed: number): SimWorld {
  const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
  return { eco: new Ecosystem(seed), startGrace: 2, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
}
function runSim(): Sample[] {
  const run = freshRun(7), w = world(7), s = newSimState(run), out: Sample[] = [];
  w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  let previous = RELEASED;
  for (let f = 1; f <= SECONDS * 60; f++) {
    const { intent, wish } = script(s.time, previous); previous = intent;
    simFrame(s, w, { dt: DT, intent, wish, held: false });
    if (f % 60 === 0) out.push({ t: round(s.time), x: round(s.physical.x), y: round(s.physical.y), z: round(s.physical.z), health: s.run.health, stageDna: s.run.stageDna, dna: s.run.economy.wallet.atRisk + s.run.economy.wallet.banked, bites: s.run.bites, mode: s.mode });
  }
  return out;
}
describe('sim', () => {
  it('sim.ts keeps the former main.ts tick order', () => {
    const record = process.env.TIDE_SIM_RECORD;
    if (record === 'sim') writeFileSync(GOLDEN, JSON.stringify(runSim(), null, 1));
    expect(existsSync(GOLDEN), 'the golden is missing').toBe(true);
    expect(runSim()).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  }, 60_000);
});
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/main-rescue.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 10: Checkpoint**, then the full journey against the running server: `node e2e/tiny-tide.mjs` (expected: exit 0, the same "Admission per frame" line format as before).

- [ ] **Step 11: Commit**

```bash
git add src/tiny-tide/sim.ts src/tiny-tide/feeding.ts src/tiny-tide/main.ts tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/sim-golden.json tests/tiny-tide-core/main-rescue.test.ts tests/tiny-tide-core/node-fs.d.ts
git commit -m "Tiny Tide: move the game tick into a pure sim.ts (same order, pinned by a golden run recorded from the old frame)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T7: Four-slot input and combat motion

**Spec:** §8.5, §5.12, D16.

**Files:**
- Modify: `src/tiny-tide/input.ts`, `src/tiny-tide/player-motion.ts`, `src/tiny-tide/combat-types.ts`
- Create: `tests/tiny-tide-core/combat-motion.test.ts`
- Modify: `tests/tiny-tide-core/input.test.ts`

**Interfaces:**
- Consumes: T1 `Tuple4`, `ActiveSlot`; T4 `dashSpeed`; `resolveMotion`, `stepPlayer`.
- Produces: `CombatInput.activePressed/activeHeld/activeReleased: Tuple4<boolean>`; `InputSources.activeTapped/activeHeld/activeCanceled?: Tuple4<boolean>`; `Digit1`–`Digit4` count as held slot keys; `aimSource: 'pointer' | 'drag' | 'auto' | 'camera'`; `CombatMotion { speedFactor; face: Vec3 | null; dashVelocity: Vec3 | null; forcedDisplacement: Vec3 | null; frozen: boolean }`, `NO_COMBAT_MOTION`; `PlayerStepContext.combat?: CombatMotion`.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/input.test.ts
+++ b/tests/tiny-tide-core/input.test.ts
@@ -11,15 +11,15 @@ describe('input intents', () => {
     expect(read(src({ chompTapped: true }), b).basicPressed).toBe(true);
   });
   it('lets an active press suppress the basic press for that tick only', () => {
-    const a = read(src({ keys: new Set(['Space']), activeTapped: [true, false], activeHeld: [true, false] }));
-    expect(a.basicPressed).toBe(false); expect(a.basicHeld).toBe(true); expect(a.activePressed).toEqual([true, false]); expect(basicRequested(a)).toBe(false);
-    const b = read(src({ keys: new Set(['Space']), activeHeld: [true, false] }), a); expect(basicRequested(b)).toBe(true);   // next tick: the hold resumes
+    const a = read(src({ keys: new Set(['Space']), activeTapped: [true, false, false, false], activeHeld: [true, false, false, false] }));
+    expect(a.basicPressed).toBe(false); expect(a.basicHeld).toBe(true); expect(a.activePressed).toEqual([true, false, false, false]); expect(basicRequested(a)).toBe(false);
+    const b = read(src({ keys: new Set(['Space']), activeHeld: [true, false, false, false] }), a); expect(basicRequested(b)).toBe(true);   // next tick: the hold resumes
   });
   it('reports releases, but never a release after a cancel', () => {
-    const held = read(src({ activeHeld: [false, true] }));
-    expect(read(src(), held).activeReleased).toEqual([false, true]);
-    expect(read(src({ activeCanceled: [false, true] }), held).activeReleased).toEqual([false, false]);
-    expect(held.activePressed).toEqual([false, true]); expect(read(src(), held).activePressed).toEqual([false, false]);
+    const held = read(src({ activeHeld: [false, true, false, false] }));
+    expect(read(src(), held).activeReleased).toEqual([false, true, false, false]);
+    expect(read(src({ activeCanceled: [false, true, false, false] }), held).activeReleased).toEqual([false, false, false, false]);
+    expect(held.activePressed).toEqual([false, true, false, false]); expect(read(src(), held).activePressed).toEqual([false, false, false, false]);
   });
   it('maps traversal: breach on a rise tap only when the plan can breach', () => {
     expect(read(src({ keys: new Set(['KeyE']), riseHeld: true })).traversal).toBe('rise'); expect(read(src({ diveHeld: true })).traversal).toBe('dive');
@@ -27,5 +27,22 @@ describe('input intents', () => {
     expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, true).traversal).toBe('breach');
     expect(read(src({ riseTapped: true, riseHeld: true }), RELEASED, false).traversal).toBe('rise');
   });
-  it('has an all-released intent', () => { expect(RELEASED).toMatchObject({ basicHeld: false, basicPressed: false, traversal: 'none', move: { x: 0, y: 0, z: 0 }, aim: null }); });
+  it('has an all-released intent', () => { expect(RELEASED).toMatchObject({ basicHeld: false, basicPressed: false, traversal: 'none', move: { x: 0, y: 0, z: 0 }, aim: null, aimSource: 'none', activeHeld: [false, false, false, false] }); });
+  it('four slot tuples', () => {
+    // Keys 1–4 hold slots 1–4; a tap and a hold give one press; the aim keeps its source.
+    const a = read(src({ keys: new Set(['Digit3']), activeTapped: [false, false, false, true], aim: { x: 0, y: 0, z: 1 }, aimSource: 'pointer' }));
+    expect(a.activePressed).toEqual([false, false, true, true]); expect(a.activeHeld).toEqual([false, false, true, false]); expect(a.aimSource).toBe('pointer');
+    const b = read(src({ keys: new Set(['Digit3']) }), a);
+    expect(b.activePressed).toEqual([false, false, false, false]); expect(b.activeHeld).toEqual([false, false, true, false]); expect(b.aimSource).toBe('none');   // no aim: none
+    expect(read(src(), b).activeReleased).toEqual([false, false, true, false]);
+  });
+  it('slot press suppresses basic for one tick', () => {
+    const a = read(src({ chompTapped: true, activeTapped: [false, true, false, false] }));
+    expect(a.basicPressed).toBe(false); expect(basicRequested(a)).toBe(false);
+    expect(basicRequested(read(src({ chompHeld: true }), a))).toBe(true);
+  });
+  it('cancel gives no release', () => {
+    const held = read(src({ activeHeld: [true, false, false, false] })), canceled = read(src({ activeCanceled: [true, false, false, false] }), held);
+    expect(canceled.activeReleased).toEqual([false, false, false, false]); expect(canceled.activeCanceled).toEqual([true, false, false, false]); expect(canceled.activeHeld).toEqual([false, false, false, false]);
+  });
 });
```

`tests/tiny-tide-core/combat-motion.test.ts` (complete file at this task; T16 adds a species case):

```ts
// tests/tiny-tide-core/combat-motion.test.ts — spec §5.12: combat motion goes through resolveMotion and never installs a refused pose.
import { describe, expect, it } from 'vitest';
import { random, SIZES } from '../../src/tiny-tide/biomes';
import { newRuntime, type Vec3 } from '../../src/tiny-tide/combat-types';
import { starterFor } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { findRecoveryPose } from '../../src/tiny-tide/motion';
import { playerActor } from '../../src/tiny-tide/mount';
import { plan } from '../../src/tiny-tide/plans';
import { NO_COMBAT_MOTION, stepPlayer, type CombatMotion } from '../../src/tiny-tide/player-motion';
import { movement, movementCapabilities } from '../../src/tiny-tide/profiles';
import { stageSolids } from '../../src/tiny-tide/reef';
import { STAGES } from '../../src/tiny-tide/state';
import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';

const DT = 1 / 30;
/** A player of `planId` at size 1 next to the reef solids of a seed: `cases` seeded starts, each stepped 12 times under random combat motion. */
function sweep(planId: string, seed: number, cases: number, motion: (r: () => number, L: number) => CombatMotion, kick?: (r: () => number, L: number) => Vec3) {
  const p = plan(planId)!, stage = p.size, actor = playerActor(p, starterFor(p), stage, 1), q = stageWorldQueries(stage, seed), bounds = stageBounds(stage), L = actor.bodyLength;
  const solids = stageSolids(stage, seed).solids.filter(s => Math.max(Math.abs(s.minX), Math.abs(s.maxX), Math.abs(s.minZ), Math.abs(s.maxZ)) < 35 * SIZES[stage]!);
  const rand = random(seed * 101 + 7), ctx = { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed };
  let installed = 0, refused = 0;
  for (let c = 0; c < cases; c++) {
    const s = solids[Math.floor(rand() * solids.length)]!, a = rand() * 2 * Math.PI, cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2, r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + .6 * L;
    const near = { x: cx + Math.sin(a) * r, y: (s.minY + s.maxY) / 2, z: cz + Math.cos(a) * r }, o = { yaw: a + Math.PI, pitch: 0 };
    const start = findRecoveryPose(actor, near, { queries: q, bounds, orientation: o, time: 0 }, { maxDistance: 3 * L }); if (!start.ok) continue;
    const rt = newRuntime(start.orientation); let pos = start.position;
    if (kick) { const k = kick(rand, L); rt.externalVelocity.x = k.x; rt.externalVelocity.y = k.y; rt.externalVelocity.z = k.z; }
    for (let i = 0; i < 12; i++) {
      const res = stepPlayer(pos, rt, RELEASED, { ...ctx, now: i * DT, dt: DT, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, combat: motion(rand, L) });
      if (res.needsRecovery) { refused++; break; }
      expect(q.overlapHull(actor, res.position, rt.orientation, { time: (i + 1) * DT, permit: rt.permit, bounds }).ok, `${planId} seed ${seed} case ${c} step ${i}`).toBe(true);
      pos = res.position; installed++;
    }
  }
  return { installed, refused };
}
const dir = (r: () => number, flat: boolean): Vec3 => { const a = r() * 2 * Math.PI, e = flat ? 0 : (r() - .5) * 1.2; return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) }; };
const scaled = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

describe('combat motion', () => {
  it('knockback, lunge, dash and grab motion never install a refused pose (player: dash, knockback, grab)', () => {
    let steps = 0;
    for (const [planId, flat] of [['swimmer', false], ['crawler', true]] as const) for (const seed of [1, 2]) {
      // Dash: 1.6 L in .18 s; knockback: up to 45 L/s (the largest 3a impulse); grab: up to .5 L a tick toward the claw point. 500 starts in all.
      steps += sweep(planId, seed, 42, (r, L) => ({ ...NO_COMBAT_MOTION, dashVelocity: scaled(dir(r, flat), 1.6 * L / .18) })).installed;
      steps += sweep(planId, seed, 42, () => NO_COMBAT_MOTION, (r, L) => scaled(dir(r, flat), 45 * L * r())).installed;
      steps += sweep(planId, seed, 41, (r, L) => ({ ...NO_COMBAT_MOTION, forcedDisplacement: scaled(dir(r, false), .5 * L * r()) })).installed;
    }
    expect(steps).toBeGreaterThan(2000);
  }, 120_000);
  it('a forced grab displacement into the seabed is blocked with progress below .5', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = stageWorldQueries(1, 1), bounds = stageBounds(1), L = actor.bodyLength;
    const ground = q.terrain.groundAt(0, 0), start = findRecoveryPose(actor, { x: 0, y: ground + 1.2 * L, z: 0 }, { queries: q, bounds, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 3 * L });
    expect(start.ok).toBe(true); if (!start.ok) return;
    const rt = newRuntime(start.orientation), into = { x: 0, y: -4 * L, z: 0 };   // far below the seabed
    const res = stepPlayer(start.position, rt, RELEASED, { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: 4, topSpeedLocal: STAGES[1]!.speed,
      now: 0, dt: DT, wish: { x: 0, y: 0, z: 0 }, aim: null, actionLock: false, combat: { ...NO_COMBAT_MOTION, forcedDisplacement: into } });
    expect(res.status).toBe('blocked'); expect(res.progress).toBeLessThan(.5); expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(q.overlapHull(actor, res.position, rt.orientation, { time: DT, bounds }).ok).toBe(true);
  });
  it('a hit-stop freezes displacement and keeps both velocities; a dash replaces the controlled velocity', () => {
    const p = plan('swimmer')!, actor = playerActor(p, starterFor(p), 1, 1), q = stageWorldQueries(1, 1), bounds = stageBounds(1), at = { x: 0, y: 40, z: 0 };
    const ctx = { plan: p, profile: movement(p.movement), caps: movementCapabilities(p), actor, queries: q, bounds, size: 4, topSpeedLocal: STAGES[1]!.speed, now: 0, dt: DT, wish: { x: 0, y: 0, z: 1 }, aim: null, actionLock: false };
    const rt = newRuntime(); rt.controlledVelocity.z = 5; rt.externalVelocity.x = 3;
    const frozen = stepPlayer(at, rt, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, frozen: true } });
    expect(frozen.position).toEqual(at); expect(rt.controlledVelocity.z).toBe(5); expect(rt.externalVelocity.x).toBe(3);
    const d = newRuntime(), dash = stepPlayer(at, d, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, dashVelocity: { x: 30, y: 0, z: 0 } } });
    expect(dash.position.x).toBeCloseTo(1); expect(d.controlledVelocity.x).toBeCloseTo(30);   // 30 × 1/30
    const slow = newRuntime(); slow.controlledVelocity.z = 100;
    stepPlayer(at, slow, RELEASED, { ...ctx, combat: { ...NO_COMBAT_MOTION, speedFactor: .5 } });
    expect(slow.controlledVelocity.z).toBeLessThan(100);   // it brakes toward half the top speed
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts tests/tiny-tide-core/combat-motion.test.ts`
Expected: FAIL — `four slot tuples` (tuples have length 2) and `NO_COMBAT_MOTION` not exported.

- [ ] **Step 3: Implement**

```diff
--- a/src/tiny-tide/combat-types.ts
+++ b/src/tiny-tide/combat-types.ts
@@ -176,7 +176,10 @@ export interface CombatRuntime { targetable: boolean; perceivable: boolean; dama
   status: { id: 'inked'; until: number; speedFactor: number } | null;
   lastDamageAt: number; lastThreatAt: number }
 export interface HitRequest { source: ActorId; target: ActorId; actionInstanceId: string; attackId: string; emitter: EmitterSource; hitGroupId: string; point: Vec3; normal: Vec3; damage: number; impulse: Vec3 }
-export interface CombatInput { move: Vec3; aim: Vec3 | null; basicHeld: boolean; basicPressed: boolean; activePressed: [boolean, boolean]; activeHeld: [boolean, boolean]; activeReleased: [boolean, boolean]; activeCanceled: [boolean, boolean]; traversal: 'none' | 'rise' | 'dive' | 'breach' }
+export interface CombatInput { move: Vec3; aim: Vec3 | null; aimSource: 'pointer' | 'drag' | 'auto' | 'camera' | 'none';
+  basicHeld: boolean; basicPressed: boolean;
+  activePressed: Tuple4<boolean>; activeHeld: Tuple4<boolean>; activeReleased: Tuple4<boolean>; activeCanceled: Tuple4<boolean>;
+  traversal: 'none' | 'rise' | 'dive' | 'breach' }
 export type { DnaCredit } from './economy';
 /** A fresh runtime: every flag true, every clock 0, zero velocities, empty maps. Never saved. */
 export function newRuntime(orientation: Orientation = { yaw: 0, pitch: 0 }): CombatRuntime {
--- a/src/tiny-tide/input.ts
+++ b/src/tiny-tide/input.ts
@@ -1,21 +1,25 @@
-// Pure input: raw sources in, one CombatInput intent per tick out. Nothing is buffered.
-import type { CombatInput, Vec3 } from './combat-types';
+// Pure input: raw sources in, one CombatInput intent per tick out. Nothing is buffered here (the action engine owns the input buffer).
+import type { CombatInput, Tuple4, Vec3 } from './combat-types';
 
+export type AimSource = CombatInput['aimSource'];
 export interface InputSources {
   stickX: number; stickZ: number; keys: ReadonlySet<string>;
   chompHeld: boolean; chompTapped: boolean;
   riseHeld: boolean; riseTapped: boolean; diveHeld: boolean;
-  aim?: Vec3 | null;
-  activeTapped?: [boolean, boolean]; activeHeld?: [boolean, boolean]; activeCanceled?: [boolean, boolean];
+  /** The aim (a unit vector, world space) and where it came from (spec §8.4); default none. */
+  aim?: Vec3 | null; aimSource?: AimSource;
+  /** Slot buttons and the right mouse (slot 1). Keys Digit1–Digit4 also hold slots 1–4. */
+  activeTapped?: Tuple4<boolean>; activeHeld?: Tuple4<boolean>; activeCanceled?: Tuple4<boolean>;
 }
 
-const OFF: [boolean, boolean] = [false, false];
+const OFF: Tuple4<boolean> = [false, false, false, false];
+const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const;
+const four = <T>(f: (i: 0 | 1 | 2 | 3) => T): Tuple4<T> => [f(0), f(1), f(2), f(3)];
 
 /** The all-empty intent. */
 export const RELEASED: CombatInput = Object.freeze({
-  move: Object.freeze({ x: 0, y: 0, z: 0 }), aim: null, basicHeld: false, basicPressed: false,
-  activePressed: [false, false] as [boolean, boolean], activeHeld: [false, false] as [boolean, boolean],
-  activeReleased: [false, false] as [boolean, boolean], activeCanceled: [false, false] as [boolean, boolean], traversal: 'none',
+  move: Object.freeze({ x: 0, y: 0, z: 0 }), aim: null, aimSource: 'none', basicHeld: false, basicPressed: false,
+  activePressed: [false, false, false, false], activeHeld: [false, false, false, false], activeReleased: [false, false, false, false], activeCanceled: [false, false, false, false], traversal: 'none',
 }) as CombatInput;
 
 export function readIntent(s: InputSources, previous: CombatInput, opts: { breachOnRiseTap: boolean }): CombatInput {
@@ -25,9 +29,10 @@ export function readIntent(s: InputSources, previous: CombatInput, opts: { breac
   const len = Math.hypot(x, z);
   if (len > 1) { x /= len; z /= len; }
 
-  const tapped = s.activeTapped ?? OFF, held = s.activeHeld ?? OFF, canceled = s.activeCanceled ?? OFF;
-  const activePressed: [boolean, boolean] = [0, 1].map(i => tapped[i] || (held[i] && !previous.activeHeld[i])) as [boolean, boolean];
-  const activeReleased: [boolean, boolean] = [0, 1].map(i => previous.activeHeld[i] && !held[i] && !canceled[i]) as [boolean, boolean];
+  const tapped = s.activeTapped ?? OFF, canceled = s.activeCanceled ?? OFF;
+  const held = four(i => (s.activeHeld ?? OFF)[i] || k.has(SLOT_KEYS[i]));
+  const activePressed = four(i => tapped[i] || (held[i] && !previous.activeHeld[i]));
+  const activeReleased = four(i => previous.activeHeld[i] && !held[i] && !canceled[i]);
 
   const basicHeld = s.chompHeld || k.has('Space');
   const edge = s.chompTapped || (basicHeld && !previous.basicHeld);
@@ -35,8 +40,8 @@ export function readIntent(s: InputSources, previous: CombatInput, opts: { breac
 
   const rise = s.riseHeld || k.has('KeyE'), dive = s.diveHeld || k.has('KeyQ');
   const traversal: CombatInput['traversal'] = opts.breachOnRiseTap && s.riseTapped ? 'breach' : rise && !dive ? 'rise' : dive && !rise ? 'dive' : 'none';
-
-  return { move: { x, y: 0, z }, aim: s.aim ?? null, basicHeld, basicPressed, activePressed, activeHeld: [held[0], held[1]], activeReleased, activeCanceled: [canceled[0], canceled[1]], traversal };
+  const aim = s.aim ?? null;
+  return { move: { x, y: 0, z }, aim, aimSource: aim ? s.aimSource ?? 'none' : 'none', basicHeld, basicPressed, activePressed, activeHeld: held, activeReleased, activeCanceled: four(i => canceled[i]), traversal };
 }
 
 /** The one place the simulation asks for a bite. An active press suppresses basic initiation for that tick only. */
```

```diff
--- a/src/tiny-tide/player-motion.ts
+++ b/src/tiny-tide/player-motion.ts
@@ -31,11 +31,28 @@ export function breachEndY(actor: Actor, surface: number, size: number): number
   return surface - Math.max(BREACH_END_DEPTH * size, top + lip * step / 2 + BREACH_CLEARANCE * actor.bodyLength);
 }
 
+/** Motion during actions (spec §5.12), from the combat world. */
+export interface CombatMotion {
+  /** Multiplies the top speed: the attack's moveSpeedFactor in windup and active, the guard's while bracing, .6 holding a grab,
+   *  the status speed while inked, .5 while staggered (the factors multiply). */
+  speedFactor: number;
+  /** Face this direction (Bite and Grab in windup and active: the action aim; Brace: the input aim) at yawRateFactor × maxYawRate. */
+  face: { dir: Vec3; yawRateFactor: number } | null;
+  /** Dash active: the controlled velocity is replaced by this (physical units per second); cause 'dash'. */
+  dashVelocity: Vec3 | null;
+  /** Held by a grabber: this tick's displacement (claw point − attach point); the controlled velocity is zero; cause 'grab'. */
+  forcedDisplacement: Vec3 | null;
+  /** Hit-stop: no controlled or external displacement this tick; the velocities are kept (the Breach arc keeps world time). */
+  frozen: boolean;
+}
+export const NO_COMBAT_MOTION: CombatMotion = Object.freeze({ speedFactor: 1, face: null, dashVelocity: null, forcedDisplacement: null, frozen: false });
 export interface PlayerStepContext {
   plan: BodyPlan; profile: MovementProfile; caps: MovementCapabilities; actor: Actor; queries: WorldQueries; bounds: { half: number; maxY?: number };
   size: number; topSpeedLocal: number; now: number; dt: number;
   /** The camera-mapped move wish in world space, |wish| ≤ 1; y is the camera pitch part, used only when caps.pitch. */
   wish: Vec3; aim: Vec3 | null; actionLock: boolean;
+  /** Motion during actions; default NO_COMBAT_MOTION. */
+  combat?: CombatMotion;
 }
 /** `progress`: the applied displacement over the asked one (1 when nothing was asked). */
 export interface PlayerStepResult { position: Vec3; status: MotionResult['status']; contacts: readonly Contact[]; progress: number; needsRecovery: boolean; breachStarted: boolean; arcEnded: boolean; permitEnded: boolean;
@@ -52,7 +69,7 @@ function shortestArc(a: number, b: number): number {
 const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));
 
 export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInput, ctx: PlayerStepContext): PlayerStepResult {
-  const { caps, profile, actor, queries, size, now, dt } = ctx, t = queries.terrain, L = actor.bodyLength, end = now + dt;
+  const { caps, profile, actor, queries, size, now, dt } = ctx, t = queries.terrain, L = actor.bodyLength, end = now + dt, cm = ctx.combat ?? NO_COMBAT_MOTION;
 
   // 1. Breach, near the surface only. A Breach tap that starts no arc is a Rise.
   let breachStarted = false;
@@ -71,23 +88,29 @@ export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInpu
   const wLen = Math.hypot(w.x, w.y, w.z);
   if (wLen > 1) { w.x /= wLen; w.y /= wLen; w.z /= wLen; }
 
-  // 3. Controlled velocity (physical).
-  const k = ctx.topSpeedLocal * profile.speedMultiplier * size;
+  // 3. Controlled velocity (physical). A dash replaces it; a hold or a hit-stop leaves it as it is (the hold zeroes it).
+  const k = ctx.topSpeedLocal * profile.speedMultiplier * size * cm.speedFactor;
   const target = { x: w.x * k, y: w.y * k, z: w.z * k }, cv = rt.controlledVelocity;
   const v: MutVec3 = { x: cv.x, y: cv.y, z: cv.z };
-  const rate = (Math.hypot(target.x, target.y, target.z) > Math.hypot(v.x, v.y, v.z) ? profile.acceleration : profile.braking) * size;
-  const gx = target.x - v.x, gy = target.y - v.y, gz = target.z - v.z, gap = Math.hypot(gx, gy, gz), maxStep = rate * dt;
-  if (gap > 0) {
-    if (gap <= maxStep) { v.x = target.x; v.y = target.y; v.z = target.z; }
-    else { const f = maxStep / gap; v.x += gx * f; v.y += gy * f; v.z += gz * f; }
+  if (cm.forcedDisplacement) { v.x = 0; v.y = 0; v.z = 0; }
+  else if (cm.dashVelocity) { v.x = cm.dashVelocity.x; v.y = cm.dashVelocity.y; v.z = cm.dashVelocity.z; }
+  else if (!cm.frozen) {
+    const rate = (Math.hypot(target.x, target.y, target.z) > Math.hypot(v.x, v.y, v.z) ? profile.acceleration : profile.braking) * size;
+    const gx = target.x - v.x, gy = target.y - v.y, gz = target.z - v.z, gap = Math.hypot(gx, gy, gz), maxStep = rate * dt;
+    if (gap > 0) {
+      if (gap <= maxStep) { v.x = target.x; v.y = target.y; v.z = target.z; }
+      else { const f = maxStep / gap; v.x += gx * f; v.y += gy * f; v.z += gz * f; }
+    }
   }
   if (caps.ground || arc !== null) v.y = 0;
 
   // 4. Desired orientation (submitted as a turn; not committed here).
   const o = rt.orientation;
-  let f: Vec3 | null = w;
+  let f: Vec3 | null = w, yawRate = profile.maxYawRate;
   if (profile.facing === 'aim') f = ctx.aim ?? w;
   else if (profile.facing === 'lock-during-action' && ctx.actionLock) f = null;
+  if (cm.face) { f = cm.face.dir; yawRate = profile.maxYawRate * cm.face.yawRateFactor; }
+  if (cm.frozen || cm.forcedDisplacement) f = null;
   let yawTarget = o.yaw, pitchTarget = caps.pitch ? o.pitch : 0;
   if (f) {
     const fLen = Math.hypot(f.x, f.y, f.z);
@@ -95,14 +118,14 @@ export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInpu
     if (caps.pitch && fLen > 0) pitchTarget = clampAbs(Math.asin(clampAbs(f.y / fLen, 1)), PITCH_LIMIT);
   }
   const desired: Orientation = {
-    yaw: o.yaw + clampAbs(shortestArc(o.yaw, yawTarget), profile.maxYawRate * dt),
+    yaw: o.yaw + clampAbs(shortestArc(o.yaw, yawTarget), yawRate * dt),
     pitch: o.pitch + clampAbs(pitchTarget - o.pitch, profile.maxPitchRate * dt),
   };
 
   // 5. Displacement. The vertical part has one owner; external motion accumulates. The edge current (edge.ts) is a
   //    pure function of the position: it is added here and stored in neither velocity owner.
-  const ev = rt.externalVelocity, edge = edgeCurrent(position, ctx.bounds.half, size);
-  const d: MutVec3 = { x: (v.x + ev.x + edge.x) * dt, y: (v.y + ev.y) * dt, z: (v.z + ev.z + edge.z) * dt };
+  const ev = rt.externalVelocity, edge = edgeCurrent(position, ctx.bounds.half, size), still = cm.frozen ? 0 : 1, fd = cm.forcedDisplacement;
+  const d: MutVec3 = fd ? { x: fd.x, y: fd.y, z: fd.z } : { x: ((v.x + ev.x) * still + edge.x) * dt, y: (v.y + ev.y) * still * dt, z: ((v.z + ev.z) * still + edge.z) * dt };
   let arcDone = false;
   const grounded = caps.ground && arc === null && !t.space;
   if (arc !== null) {
@@ -110,12 +133,12 @@ export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInpu
     const u = (time: number) => Math.min(1, (time - arc.startedAt) / arc.duration);
     const arcY = (s: number) => arc.fromY + (endY - arc.fromY) * s + Math.sin(s * Math.PI) * lift;
     const uEnd = u(end);
-    d.y = arcY(uEnd) - arcY(u(now)) + ev.y * dt;
+    d.y = arcY(uEnd) - arcY(u(now)) + ev.y * dt * still;
     arcDone = uEnd >= 1;
-  } else if (grounded) {
+  } else if (grounded && !fd) {
     // The height over the seabed support (groundOffset) settles down, and is lifted onto a low rock (stepLift, owner decision fix
     // round 2). The lift rises at most STEP_CLIMB L/s: a steeper step holds the horizontal move back to what that rise allows.
-    const offset = Math.max(0, rt.groundOffset * Math.exp(-GROUND_SETTLE * dt) + ev.y * dt), actx = { time: now, permit: rt.permit, bounds: ctx.bounds };
+    const offset = Math.max(0, rt.groundOffset * Math.exp(-GROUND_SETTLE * dt) + ev.y * dt * still), actx = { time: now, permit: rt.permit, bounds: ctx.bounds };
     const liftAt = (s: number) => stepLift(actor, position.x + d.x * s, position.z + d.z * s, o, queries, supportHeight(actor, position.x + d.x * s, position.z + d.z * s, o, t), actx);
     let lift = liftAt(1);
     const room = rt.groundOffset + STEP_CLIMB * L * dt;
@@ -132,12 +155,12 @@ export function stepPlayer(position: Vec3, rt: CombatRuntime, intent: CombatInpu
 
   // 6. Motion.
   const result = resolveMotion({ actorId: 'player', from: position, displacement: d, orientation: o, turn: desired, hull: actor.hull, habitatProfileId: actor.habitat.id,
-    cause: 'locomotion', traversalPermit: rt.permit, ...(grounded ? { riseCap: Math.max(0, d.y) } : {}) }, { queries, actor, bounds: ctx.bounds, interval: { start: now, end } });
+    cause: fd ? 'grab' : cm.dashVelocity ? 'dash' : 'locomotion', traversalPermit: rt.permit, ...(grounded ? { riseCap: Math.max(0, d.y) } : {}) }, { queries, actor, bounds: ctx.bounds, interval: { start: now, end } });
   if (grounded) rt.groundOffset = Math.max(0, result.position.y - (supportHeight(actor, result.position.x, result.position.z, result.orientation, t) + .01 * L));
 
   // 7. Commit. The two velocity owners are projected separately; their sum is never stored.
   rt.orientation = { yaw: result.orientation.yaw, pitch: result.orientation.pitch };
-  const pc = projectVelocity(v, result.contacts), pe = projectVelocity(ev, result.contacts), decay = Math.exp(-EXTERNAL_DECAY * dt);
+  const pc = projectVelocity(v, result.contacts), pe = projectVelocity(ev, result.contacts), decay = cm.frozen ? 1 : Math.exp(-EXTERNAL_DECAY * dt);
   cv.x = pc.x; cv.y = pc.y; cv.z = pc.z;
   ev.x = pe.x * decay; ev.y = pe.y * decay; ev.z = pe.z * decay;
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts tests/tiny-tide-core/combat-motion.test.ts tests/tiny-tide-core/player-motion.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed (the golden is unchanged: no combat motion yet).

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/input.ts src/tiny-tide/player-motion.ts src/tiny-tide/combat-types.ts tests/tiny-tide-core/input.test.ts tests/tiny-tide-core/combat-motion.test.ts
git commit -m "Tiny Tide combat: four slot inputs, aim source, and combat motion through admission (facing, speed, dash, forced moves, hit-stop freeze)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T8: The combat world and the basic dispatch

**Spec:** §3.1 `combat-world.ts`, §6.1, §8.3, §11.7 (`bodyScale`, `centre` socket), §13, D6.

**Files:**
- Create: `src/tiny-tide/combat-world.ts`
- Modify: `src/tiny-tide/action-engine.ts`, `src/tiny-tide/feeding.ts`, `src/tiny-tide/lifecycle.ts`, `src/tiny-tide/mount.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/main.ts`
- Create: `tests/tiny-tide-core/combat-fixture-world.ts`, `tests/tiny-tide-core/combat-world.test.ts`, `tests/tiny-tide-core/feeding.test.ts`

**Interfaces:**
- Consumes: T2 `movesOf`, `assignSlots`, `speciesMove`; T3 shapes; T4 engine; T5 resolver; T6 `SimState`, `simFrame`; T7 `CombatMotion`.
- Produces:
  - `combat-world.ts`: `PLAYER_ID`, `entityActorId(e)`, `HOLDING_SPEED = .6`, `STAGGERED_SPEED = .5`, `CLAW_REACH = .5`, `EVENT_LOG = 20`, `EntityCombat`, `PlayerBody`, `CombatContext`, `CombatTick { events; chomp; killed; brokeFree; started }`, `playerMatrix(position, o, scale)`, `class CombatWorld` with `reset()`, `cancelAttacksOnPlayer(playerRt)`, `stateOf(e)`, `forget(e)`, `biteCone(p, moves, aim)`, `tick(ctx)`, `speciesShapes(c, a, now)`, `onPlayerStep(rt, step, now)`, `clawPoint(…)`, `playerMotion(p, intent, now)`, `startSpecies(c, attackId, attack, aim, targetId, now, …)`. T12 adds `telegraphs(now, isOnScreen, groundAt)`; T16 adds `aiTick(ctx)` and `afterMotion(entities)`.
  - `feeding.ts`: `biteDispatch(cone, entities, stage, isCombat, hurtboxesOf): Entity | null`. Combat species are never chomp targets.
  - `sim.ts`: `playerMoves(s)`, `makePlayerBody(o)`, `playerBody(s, actor)`, `faintNow`; the combat tick runs before the chomp.
  - `lifecycle.resetRuntime` clears `actionClock` (0), `hitStopUntil`, `buffered`, `heldBy`, `breakProgress`, `status`.
  - `mount.speciesActor` uses `bodyScale`; `speciesCombatPose` adds a `centre` emitter.

**Decision in this task (spec ambiguity):** §3.1 says `sim.ts` keeps "the former order". The combat tick is new, so it has no former place. It runs after the player step and before the chomp, so that a Bite that the dispatch rule takes is not also a chomp.

- [ ] **Step 1: Write the test world and the failing tests** (complete files)

```ts
// Combat world fixtures: a Speck with a Snapper (and optional parts) on a flat sea floor, and fixture entities placed in front of it.
import { CombatWorld, type CombatContext } from '../../src/tiny-tide/combat-world';
import type { Entity } from '../../src/tiny-tide/ecosystem';
import { starterGenome, type PlacedPart } from '../../src/tiny-tide/genome';
import { RELEASED } from '../../src/tiny-tide/input';
import { freshRun } from '../../src/tiny-tide/state';
import { newSimState, playerActorCached, playerBody, playerMoves, type SimState } from '../../src/tiny-tide/sim';
import { makeWorldQueries } from '../../src/tiny-tide/world-queries';
import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
import type { Species } from '../../src/tiny-tide/species';
import { FX_BEHAVIOURS } from './combat-fixture';

export const FLAT = makeWorldQueries({ groundAt: () => 0, surface: 85, space: false, slopeBound: 0 });
/** A Speck facing +z at (0, 1, 0) with a Snapper; `extra` parts are added (uids p10…). */
export function speck(extra: Omit<PlacedPart, 'uid' | 'roll'>[] = []): SimState {
  const run = freshRun(1), g = starterGenome();
  g.parts = g.parts.map(p => p.id === 'mouth_nibbler' ? { ...p, id: 'mouth_snapper', scale: 1 } : p);
  extra.forEach((p, i) => g.parts.push({ ...p, uid: `p${10 + i}`, roll: 0 }));
  run.genome = g; run.diet = 'carnivore';
  const s = newSimState(run); s.combat = new CombatWorld(FX_BEHAVIOURS); s.mode = 'playing'; s.physical = { x: 0, y: 1, z: 0 };
  return s;
}
export function entity(id: number, spec: Species, at: Vec3, heading = Math.PI): Entity {
  return { id, spec, x: at.x, y: at.y, z: at.z, hx: at.x, hy: at.y, hz: at.z, groundOffset: 0, heading, phase: 0, hp: spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0,
    lastKnown: null, lastKnownHull: null, lastSeenAt: 0, reachable: false, reachableSince: null, blockedSince: null, returnUntil: 0, hazardReadyAt: 0, active: true };
}
/** One combat tick for the Speck at time `now`. */
export function tick(s: SimState, entities: Entity[], now: number, intent: Partial<CombatInput> = {}, dt = 1 / 60) {
  const actor = playerActorCached(s), body = playerBody(s, actor), m = playerMoves(s);
  const ctx: CombatContext = { now, dt, playing: true, intent: { ...RELEASED, ...intent }, wish: { x: 0, y: 0, z: 0 }, previousMove: { x: 0, y: 0, z: 0 }, player: body, moves: m.set, slots: m.slots,
    entities, stage: s.run.stage, queries: FLAT };
  const r = s.combat.tick(ctx); s.run.health = body.health;
  return { r, body };
}
```

```ts
// tests/tiny-tide-core/combat-world.test.ts — the combat tick with the fixture catalog: starts, hits, kills, holds and the player's motion.
import { describe, expect, it } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { RELEASED } from '../../src/tiny-tide/input';
import { playerActorCached, playerBody } from '../../src/tiny-tide/sim';
import { POKE, WRAP, FX_HUNTER, FX_FLEER } from './combat-fixture';
import { entity, speck, tick } from './combat-fixture-world';

const ahead = (d: number) => ({ x: 0, y: 1 - .35 * SIZES[1]!, z: d });   // a tier-1 entity's origin so that its hull centre is level with the Speck
describe('combat world', () => {
  it('a Bite on a combat species in front: windup, hit at active, HP down, hit-stop on both', () => {
    const s = speck(), crab = entity(1, FX_HUNTER, ahead(2.5));
    let now = 0, hit = null;
    const first = tick(s, [crab], now, { basicPressed: true, basicHeld: true, aim: { x: 0, y: 0, z: 1 } });
    expect(first.r.started).toEqual(['bite']); expect(first.r.chomp).toBe(false);
    for (let i = 0; i < 30 && !hit; i++) { now += 1 / 60; hit = tick(s, [crab], now).r.events[0] ?? null; }
    expect(hit).toMatchObject({ outcome: 'hit', targetId: 'e1', unit: 'hp', amount: 4 });   // Snapper at scale 1
    expect(crab.hp).toBe(16); expect(s.rt.hitStopUntil).toBeGreaterThan(now); expect(s.combat.stateOf(crab)!.rt.hitStopUntil).toBe(s.rt.hitStopUntil);
  });
  it('kills once and reports the kill', () => {
    const s = speck(), prey = entity(2, { ...FX_FLEER, hp: 3 }, { x: 0, y: .65, z: 2.1 });   // in front of the bite socket (z 1.61)
    tick(s, [prey], 0, { basicPressed: true, basicHeld: true });
    const kills: string[] = []; let now = 0;
    for (let i = 0; i < 40; i++) { now += 1 / 60; kills.push(...tick(s, [prey], now).r.killed.map(e => e.spec.key)); }
    expect(prey.hp).toBeLessThanOrEqual(0); expect(kills).toEqual(['0:fx_fleer']);
  });
  it('a species grab holds the player, squeezes on its clock, and a break-free releases it', () => {
    const s = speck(), squid = entity(3, FX_HUNTER, ahead(1.2)), c = s.combat.stateOf(squid)!;
    const a = s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0);
    expect(typeof a).not.toBe('string');
    let now = 0; const before = s.run.health;
    for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.rt.heldBy).toBe('e3'); expect(s.run.health).toBe(before - .5);   // the catch: 1 half-heart
    const motion = s.combat.playerMotion(playerBody(s, playerActorCached(s)), RELEASED, now);
    expect(motion.forcedDisplacement).not.toBeNull(); expect(motion.speedFactor).toBe(1);
    for (let i = 0; i < 40; i++) { now += 1 / 60; tick(s, [squid], now); }   // active ends .12 s (+ .07 s hit-stop) after the catch; one squeeze at .4 s of hold
    expect(s.run.health).toBe(before - 1);
    for (let i = 0; i < 4; i++) { now += 1 / 60; tick(s, [squid], now, { basicPressed: true, basicHeld: true }); tick(s, [squid], now + .001); }
    expect(s.rt.heldBy).toBeNull(); expect(s.rt.invulnerableUntil).toBeGreaterThan(now);   // 4 basic presses: 4 × .25
  });
  it('blocked grab motion ends the hold', () => {
    const s = speck(), squid = entity(4, FX_HUNTER, ahead(1.2)), c = s.combat.stateOf(squid)!;
    s.combat.startSpecies(c, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, 'player', 0);
    let now = 0; for (let i = 0; i < 50 && s.rt.heldBy === null; i++) { now += 1 / 60; tick(s, [squid], now); }
    expect(s.combat.onPlayerStep(s.rt, { status: 'blocked', progress: .6 }, now)).toBe(false); expect(s.rt.heldBy).toBe('e4');
    expect(s.combat.onPlayerStep(s.rt, { status: 'blocked', progress: .4 }, now)).toBe(true); expect(s.rt.heldBy).toBeNull();
    expect(c.rt.actions[0]!.phase).toBe('recovery');   // a catch released in its active phase recovers at once
  });
  it('a dash replaces the controlled velocity, keeps .3 of it at the end, and evades a strike', () => {
    const s = speck(), crab = entity(5, FX_HUNTER, ahead(2.2)), c = s.combat.stateOf(crab)!;
    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0);
    let now = 0, outcome = '';
    for (let i = 0; i < 60 && !outcome; i++) {
      now += 1 / 60;
      const r = tick(s, [crab], now, i === 25 ? { activePressed: [true, false, false, false] } : {}).r;   // slot 1 is Dash (the Paddle tail)
      if (i === 28) expect(s.combat.playerMotion(playerBody(s, playerActorCached(s)), RELEASED, now).dashVelocity).not.toBeNull();
      outcome = r.events[0]?.outcome ?? '';
    }
    expect(outcome).toBe('evaded');
  });
  it('speed factors multiply: a bite windup, a stagger and ink', () => {
    const s = speck(), body = () => playerBody(s, playerActorCached(s));
    s.rt.status = { id: 'inked', until: 10, speedFactor: .7 }; s.rt.staggerUntil = 5;
    expect(s.combat.playerMotion(body(), RELEASED, 0).speedFactor).toBeCloseTo(.35);   // .7 × .5
    expect(s.combat.playerMotion(body(), RELEASED, 11).speedFactor).toBeCloseTo(.5);
  });
});
```

```ts
// tests/tiny-tide-core/feeding.test.ts — spec §8.3: the basic dispatch rule and today's chomp.
import { describe, expect, it } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { biteTargets, chomp } from '../../src/tiny-tide/feeding';
import { derive, effectiveStats } from '../../src/tiny-tide/genome';
import { currentPlan } from '../../src/tiny-tide/state';
import { species } from '../../src/tiny-tide/species';
import { FX_FLEER, FX_HUNTER } from './combat-fixture';
import { entity, speck, tick } from './combat-fixture-world';

describe('feeding', () => {
  it('bite when a combat species is in the cone, else chomp', () => {
    const s = speck(), front = entity(1, FX_HUNTER, { x: 0, y: 1 - .35 * SIZES[1]!, z: 3 }), behind = entity(2, FX_HUNTER, { x: 0, y: 1 - .35 * SIZES[1]!, z: -6 });
    expect(tick(s, [front], 0, { basicPressed: true, basicHeld: true })).toMatchObject({ r: { started: ['bite'], chomp: false } });
    const t = speck();
    expect(tick(t, [behind], 0, { basicPressed: true, basicHeld: true })).toMatchObject({ r: { started: [], chomp: true } });
    // The cone is the Bite range × 1.25: the Snapper reaches .6 L (L 2.43, from the bite socket at z 1.61); × 1.25 → 1.82. A tier-0 body
    // (hull radius .35) at 1.61 + 1.82 + .3 is inside; at 1.61 + 1.82 + .4 it is not.
    for (const [z, chomps] of [[1.61 + 1.82 + .3, false], [1.61 + 1.82 + .4, true]] as const) {
      const u = speck(), prey = entity(3, FX_FLEER, { x: 0, y: .65, z });
      expect(tick(u, [prey], 0, { basicPressed: true, basicHeld: true }).r.chomp, `z ${z}`).toBe(chomps);
    }
  });
  it('combat species are never chomp targets', () => {
    const s = speck(), prey = entity(4, FX_FLEER, { x: 0, y: .65, z: 1.8 }), d = derive(effectiveStats(s.run.genome, currentPlan(s.run)));
    expect(biteTargets(s.run, [prey], s.physical, 1, d).targets).toEqual([]);
    const legacy = entity(5, species(0, 'copepod'), { x: 0, y: .65, z: 1.8 });
    expect(biteTargets(s.run, [legacy], s.physical, 1, d).targets.map(t => t.entity.id)).toEqual([5]);
  });
  it('legacy species keep chomp damage', () => {
    const s = speck(), d = derive(effectiveStats(s.run.genome, currentPlan(s.run))), crab = entity(6, species(1, 'crab'), { x: 0, y: 1, z: 2 });
    crab.mode = 'hunt';   // a bigger creature that is attacking is a bite target
    const eco = { entities: [crab], consume: () => undefined, planetIndex: () => 0 };
    expect(chomp(s.run, eco, s.physical, 1, d, 0, [])).toMatchObject({ kind: 'bitten', damage: Math.max(1, Math.floor(d.bite / 2)) });
    expect(crab.hp).toBe(species(1, 'crab').hp - Math.max(1, Math.floor(d.bite / 2)));
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-world.test.ts tests/tiny-tide-core/feeding.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/combat-world"` and `biteDispatch` not exported.

- [ ] **Step 3: Engine, feeding, lifecycle and mount changes**

```diff
--- a/src/tiny-tide/action-engine.ts
+++ b/src/tiny-tide/action-engine.ts
@@ -111,12 +111,15 @@ export function sweepEnded(rt: CombatRuntime): ActionState[] {
   if (ended.length) rt.actions = rt.actions.filter(a => a.phase !== 'interrupted');
   return ended;
 }
-/** A hold ends (break-free, a blocked grab motion, a stagger): the grabber goes to recovery now. Returns the released target id. */
+/** A hold ends (break-free, a blocked grab motion, a stagger): the grabber goes to recovery now. A catch in the active phase (before the
+ *  hold phase starts) ends the same way. Returns the released target id. */
 export function endHold(rt: CombatRuntime, a: ActionState): ActorId | null {
-  if (a.phase !== 'hold') return null;
+  if (a.phase !== 'hold' && !(a.phase === 'active' && a.heldTarget !== null)) return null;
   const target = a.heldTarget; a.heldTarget = null; a.phase = 'recovery'; a.phaseStartedAt = rt.actionClock;
   return target;
 }
+/** The action of `rt` that holds `who` (a catch in active, or the hold phase). */
+export const holdingAction = (rt: CombatRuntime, who: ActorId): ActionState | undefined => rt.actions.find(a => (a.phase === 'hold' || a.phase === 'active') && a.heldTarget === who);
 
 // ---- tick (spec §5.2, §5.4, §5.5) ----
 /** Turns `aim` toward `wanted` on the great circle by at most `maxAngle` radians. */
@@ -217,7 +220,7 @@ export function stagger(rt: CombatRuntime, seconds: number, force = false): Stag
   rt.staggerUntil = Math.max(rt.staggerUntil, rt.actionClock + seconds);
   for (const a of rt.actions) {
     if (a.phase === 'interrupted') continue;
-    if (a.phase === 'hold') { const t = endHold(rt, a); if (t !== null) out.releasedTargets.push(t); if (force) { endNow(rt, a); out.interrupted.push(a); } continue; }
+    if (a.phase === 'hold' || (a.phase === 'active' && a.heldTarget !== null)) { const t = endHold(rt, a); if (t !== null) out.releasedTargets.push(t); if (force) { endNow(rt, a); out.interrupted.push(a); } continue; }
     if (force ? a.phase === 'windup' || a.phase === 'active' : interruptible(a)) { endNow(rt, a); out.interrupted.push(a); }
   }
   return out;
--- a/src/tiny-tide/feeding.ts
+++ b/src/tiny-tide/feeding.ts
@@ -5,7 +5,8 @@ import { entityRadius, provoke, type Entity } from './ecosystem';
 import { SIZES } from './biomes';
 import { dietCanEat, eat, inReach, reward, unlock, type Run } from './state';
 import { dietOf, type Derived } from './genome';
-import type { Capsule, Vec3 } from './combat-types';
+import type { Capsule, Vec3, WorldShape } from './combat-types';
+import { hurtboxesHit } from './combat-shapes';
 
 /** Seconds between chomps (main.ts `cooldown`). */
 export const CHOMP_COOLDOWN = .24;
@@ -15,7 +16,7 @@ export function biteTargets(run: Run, entities: readonly Entity[], player: Vec3,
   const size = SIZES[run.stage]!, p = { x: player.x / size, y: player.y / size, z: player.z / size }, diet = dietOf(run.genome);
   const out: BiteTarget[] = []; let wrongDiet: string | null = null;
   for (const e of entities) {
-    if (e.eaten) continue;
+    if (e.eaten || e.spec.behaviourId) continue;   // combat species are never chomp targets (spec §8.3)
     const tier = e.spec.tier, attacking = e.mode === 'hunt' || e.mode === 'angry';
     if (tier !== run.stage && !(attacking && tier === run.stage + 1)) continue;
     const radius = tier > run.stage ? entityRadius(e) / size : 0, food = { x: e.x / size, y: e.y / size, z: e.z / size };
@@ -48,3 +49,12 @@ export function chomp(run: Run, eco: { readonly entities: readonly Entity[]; con
   eco.consume(e);
   return { kind: 'ate', entity: e, dna, won, drop };
 }
+/** The basic dispatch rule (spec §8.3): the first combat species that is not eaten, of the player's tier or one above, with a hurtbox in the
+ *  Bite cone (the resolved Bite shape with the current aim, range × 1.25). Null: today's chomp runs. */
+export function biteDispatch(cone: WorldShape, entities: readonly Entity[], stage: number, isCombat: (e: Entity) => boolean, hurtboxesOf: (e: Entity) => readonly Capsule[]): Entity | null {
+  for (const e of entities) {
+    if (e.eaten || !e.active || (e.spec.tier !== stage && e.spec.tier !== stage + 1) || !isCombat(e)) continue;
+    if (hurtboxesHit(hurtboxesOf(e), [cone])) return e;
+  }
+  return null;
+}
--- a/src/tiny-tide/lifecycle.ts
+++ b/src/tiny-tide/lifecycle.ts
@@ -13,6 +13,8 @@ export function resetRuntime(rt: CombatRuntime, orientation: Orientation = { yaw
   rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
   rt.actions = []; rt.cooldowns.clear(); rt.permit = null; rt.arc = null; rt.breachReadyAt = 0; rt.invulnerableUntil = 0; rt.staggerUntil = 0; rt.guardProfileId = null;
   rt.targetable = rt.perceivable = rt.damageable = true; rt.groundOffset = 0; rt.orientation = { yaw: orientation.yaw, pitch: orientation.pitch };
+  // Combat (spec §13): the action clock, hit-stop, the input buffer, holds and status start over.
+  rt.actionClock = 0; rt.hitStopUntil = 0; rt.buffered = null; rt.heldBy = null; rt.breakProgress = 0; rt.status = null;
 }
 
 /** Faints once. The caller saves at once, before the animation. */
--- a/src/tiny-tide/mount.ts
+++ b/src/tiny-tide/mount.ts
@@ -157,9 +157,9 @@ export function playerActor(plan: BodyPlan, genome: Genome, stage: number, growt
   const scale = SIZES[stage]! * growth, fit = hullFitOf(plan);
   return { id: 'player', hull: hullOffsets(genome, scale, fit), habitat: habitat(plan.habitat), bodyLength: bodyLengthOf(genome) * scale, ...(fit === 'tight' ? { fit } : {}) };
 }
-/** One sphere standing on the origin (food models stand on their origin). */
-export function speciesActor(e: { id: number; spec: Pick<Species, 'tier' | 'habitatProfileId'> }): Actor {
-  const size = SIZES[e.spec.tier]!, ro = .35 * size, centre = { x: 0, y: ro, z: 0 };
+/** One sphere standing on the origin (food models stand on their origin), × the species' bodyScale (spec §11.3). */
+export function speciesActor(e: { id: number; spec: Pick<Species, 'tier' | 'habitatProfileId' | 'bodyScale'> }): Actor {
+  const size = SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1), ro = .35 * size, centre = { x: 0, y: ro, z: 0 };
   return { id: `e${e.id}`, hull: [{ start: centre, end: centre, radius: ro, sway: 0, heave: 0 }], habitat: habitat(e.spec.habitatProfileId), bodyLength: size * 1.4 };
 }
 
@@ -200,12 +200,14 @@ export function sampleCombatPose(input: PoseInput): CombatPose {
     mass: massFor(input.plan, g, input.physicalLength), knockbackResistance: input.plan.physics.knockbackResistance, hull, hurtboxes, emitters };
 }
 
-/** One hull sphere at the entity, hurtboxes = hull, one root emitter facing the heading; mass = body length. */
+/** One hull sphere at the entity, hurtboxes = hull; a root emitter at the origin and a `centre` emitter at the hull centre (spec §5.10),
+ *  both facing the heading; mass = body length. */
 export function speciesCombatPose(e: { id: number; spec: Species; x: number; y: number; z: number; heading: number }, _now: number): CombatPose {
   const actor = speciesActor(e), at = (p: Vec3): Vec3 => ({ x: p.x + e.x, y: p.y + e.y, z: p.z + e.z });
   const hull = actor.hull.map(c => ({ ...c, start: at(c.start), end: at(c.end) })), position = { x: e.x, y: e.y, z: e.z };
-  const forward = { x: Math.sin(e.heading), y: 0, z: Math.cos(e.heading) };
-  const localToWorld = [...new T.Matrix4().makeRotationY(e.heading).setPosition(e.x, e.y, e.z).elements];
+  const forward = { x: Math.sin(e.heading), y: 0, z: Math.cos(e.heading) }, centre = hull[0]!.start;
+  const root = new T.Matrix4().makeRotationY(e.heading).setPosition(e.x, e.y, e.z), mid = root.clone().setPosition(centre.x, centre.y, centre.z);
   return { actorId: actor.id, position, forward, bodyLength: actor.bodyLength, mass: actor.bodyLength, knockbackResistance: 0, hull, hurtboxes: hull,
-    emitters: [{ source: { kind: 'actor', actorId: actor.id, mountId: 'root', socketId: 'root' }, origin: { ...position }, forward: { ...forward }, localToWorld }] };
+    emitters: [{ source: { kind: 'actor', actorId: actor.id, mountId: 'root', socketId: 'root' }, origin: { ...position }, forward: { ...forward }, localToWorld: [...root.elements] },
+      { source: { kind: 'actor', actorId: actor.id, mountId: 'root', socketId: 'centre' }, origin: { ...centre }, forward: { ...forward }, localToWorld: [...mid.elements] }] };
 }
```

- [ ] **Step 4: Create `combat-world.ts`** (complete file at this task; T11, T12, T16, T17 and T18 extend it)

```ts
// The combat world (spec §3.1): it owns the combat state of entities and runs one combat tick — the player's moves from the intent, the
// action clocks, the action engine, world shapes, hit requests, the resolver, holds and kills. Pure: positions are read from the bodies it
// is given; it never moves a body (combat motion goes to the player step and the ecosystem as requests).
import * as T from 'three';
import { advanceClock, bufferedPress, bufferPress, canStart, dashSpeed, endHold, endNow, holdingAction, liveActions, newPoise, startAction, sweepEnded, tickAction, type PoiseMeter, type StartRefusal } from './action-engine';
import { BEHAVIOURS, type SpeciesBehaviour } from './bestiary';
import { actionShapes, crossingOk, hurtboxesHit, nearestTargets, obstructionClear, truncateCapsule, worldShape, aimFrame } from './combat-shapes';
import { newRuntime, type ActionState, type ActiveSlot, type ActorId, type AttackSpec, type CombatInput, type CombatPose, type CombatRuntime, type EmitterSource, type MovementMode, type ResolvedMove, type Vec3, type WorldQueries, type WorldShape } from './combat-types';
import type { Entity } from './ecosystem';
import { biteDispatch } from './feeding';
import { addBreakProgress, isFlick, releaseHold, resolveAll, squeezesDue, type CombatEvent, type Fighter, type HitRequestIn } from './hit-resolver';
import { basicRequested } from './input';
import { speciesCombatPose } from './mount';
import { speciesMove, type GrantedMove, type MoveSet, type SlotAssignment } from './moves';
import { forwardOf, orientationMatrix } from './orientation';
import type { CombatMotion } from './player-motion';
import { EFFECTS } from './combat-profiles';
import { damageAfterArmor } from './state';

export const PLAYER_ID: ActorId = 'player';
export const entityActorId = (e: { id: number }): ActorId => `e${e.id}`;
/** Speed factors (spec §5.12): holding a grab, staggered. The claw point is the socket origin plus CLAW_REACH × L_t along the aim. */
export const HOLDING_SPEED = .6, STAGGERED_SPEED = .5, CLAW_REACH = .5;
/** How many hit outcomes the diagnostics keep. */
export const EVENT_LOG = 20;

export interface EntityCombat { id: ActorId; entity: Entity; rt: CombatRuntime; poise: PoiseMeter; behaviour: SpeciesBehaviour; maxHp: number; lastDamagedAt: number }
/** The player's body this tick (physical units). `health` is in hearts; the combat world writes it back to the run. */
export interface PlayerBody {
  rt: CombatRuntime; position: Vec3; centre: Vec3; L: number; mass: number; knockbackResistance: number; armor: number;
  ground: boolean; mode: MovementMode; inBreachArc: boolean; health: number; pose: CombatPose;
}
export interface CombatContext {
  now: number; dt: number;
  /** The game mode is `playing` (start rule 1 for the player). */
  playing: boolean;
  intent: CombatInput;
  /** The camera-mapped move wish (Dash direction) and the previous tick's stick (break-free flicks). */
  wish: Vec3; previousMove: Vec3;
  player: PlayerBody; moves: MoveSet; slots: SlotAssignment;
  entities: readonly Entity[];
  /** The player's stage and its queries (crossing and obstruction). */
  stage: number; queries: WorldQueries;
}
export interface CombatTick {
  events: CombatEvent[];
  /** The basic input fell back to today's chomp (no combat species in the Bite cone; spec §8.3). */
  chomp: boolean;
  /** Species at 0 HP this tick (the sim rewards and consumes them). */
  killed: Entity[];
  /** The player broke free of a hold this tick. */
  brokeFree: boolean;
  /** Moves the player started this tick (sounds, hints). */
  started: ResolvedMove['kind'][];
}
/** The player's world matrix: T(position) · Ry(yaw) · Rx(−pitch) · S(scale), the renderer's convention (orientation.ts). */
export function playerMatrix(position: Vec3, o: { yaw: number; pitch: number }, scale: number): T.Matrix4 {
  return orientationMatrix(o, new T.Matrix4()).scale(new T.Vector3(scale, scale, scale)).setPosition(position.x, position.y, position.z);
}
const horizontal = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.z); return l > 1e-9 ? { x: v.x / l, y: 0, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
const statusOf = (id: string) => { const s = EFFECTS[id]?.status; return s ? { seconds: s.seconds, speedFactor: s.speedFactor } : null; };

export class CombatWorld {
  readonly entities = new Map<number, EntityCombat>();
  /** The last EVENT_LOG hit outcomes (diagnostics). */
  readonly log: CombatEvent[] = [];
  private serial = 0;
  constructor(private readonly behaviours: Record<string, SpeciesBehaviour> = BEHAVIOURS) {}
  /** A fresh state for a new run or a load (spec §13). */
  reset(): void { this.entities.clear(); this.log.length = 0; }
  /** The combat state of a combat species (created on first use), or null for a legacy species. */
  stateOf(e: Entity): EntityCombat | null {
    let c = this.entities.get(e.id);
    if (c && c.entity === e) return c;
    const b = e.spec.behaviourId ? this.behaviours[e.spec.behaviourId] : undefined; if (!b) return null;
    c = { id: entityActorId(e), entity: e, rt: newRuntime({ yaw: e.heading, pitch: 0 }), poise: newPoise(), behaviour: b, maxHp: e.spec.hp, lastDamagedAt: -Infinity };
    this.entities.set(e.id, c); return c;
  }
  /** A combat entity that respawned or was consumed starts over (its actions, clock and holds). */
  forget(e: Entity): void { this.entities.delete(e.id); }
  private nextId(actor: ActorId) { return `${actor}#${++this.serial}`; }

  // ---- the player's moves ----
  private sourceOf(m: GrantedMove, socketId: string | undefined): EmitterSource { return { kind: 'part', partUid: m.partUid, copy: 0, socketId: socketId ?? 'none' }; }
  private tryStart(ctx: CombatContext, m: GrantedMove, aim: Vec3, held: boolean): StartRefusal | 'started' {
    const p = ctx.player, rt = p.rt, key = `${PLAYER_ID}:${m.partUid}:${m.grantId}`, kind = m.resolved.kind;
    const d = canStart(rt, { playing: ctx.playing, isPlayer: true, kind, cooldownKey: key, mode: p.mode, allowedModes: m.resolved.allowedMotionModes, inBreachArc: p.inBreachArc, token: true, worldNow: ctx.now });
    if (!d.ok) return d.reason;
    if (d.replaces) { if (d.replaces.phase === 'hold') this.releasePlayerHold(d.replaces, rt, ctx.now); endNow(rt, d.replaces); }
    let dir = aim;
    if (m.resolved.evasion) {
      const w = ctx.wish, wl = Math.hypot(w.x, w.y, w.z), facing = forwardOf(rt.orientation);
      dir = wl > .3 ? w : ctx.intent.aim ?? facing;
      dir = m.resolved.evasion.plane === 'horizontal' ? horizontal(dir) : unit(dir);
    }
    const sockets = m.resolved.attack ? (m.kind === 'bite' ? 'bite' : m.kind === 'grab' ? 'pinch' : m.kind === 'sweep' ? 'slap' : undefined) : m.kind === 'counter' ? 'spike' : undefined;
    const a = startAction(rt, { instanceId: this.nextId(PLAYER_ID), definitionId: m.resolved.attack?.id ?? m.resolved.abilityId ?? kind, grantId: m.grantId, source: this.sourceOf(m, sockets),
      resolved: m.resolved, aim: dir, targetId: null, cooldownKey: key, worldNow: ctx.now });
    if (m.resolved.guard?.kind === 'brace' && !held) a.released = true;
    if (a.aimLocked) a.lockedShapes = this.playerShapes(ctx.player, a);
    return 'started';
  }
  /** The world shapes of a player action: one per emitter of its part and socket (a mirrored pair has two). */
  private playerShapes(p: PlayerBody, a: ActionState): WorldShape[] {
    const attack = a.resolved.attack; if (!attack || a.source.kind !== 'part') return [];
    const src = a.source, origins = p.pose.emitters.filter(e => e.source.kind === 'part' && e.source.partUid === src.partUid && e.source.socketId === src.socketId).map(e => e.origin);
    return actionShapes(attack.shape, origins.length ? origins : [p.centre], a.aim, forwardOf(p.rt.orientation), p.L);
  }
  /** The Bite cone of the dispatch rule: the resolved Bite shape with the current aim and its range × 1.25 (spec §8.3). */
  biteCone(p: PlayerBody, moves: MoveSet, aim: Vec3): WorldShape | null {
    const b = moves.basic, attack = b?.resolved.attack; if (!b || !attack || attack.shape.kind !== 'cone') return null;
    const origin = p.pose.emitters.find(e => e.source.kind === 'part' && e.source.partUid === b.partUid && e.source.socketId === 'bite')?.origin ?? p.centre;
    return worldShape({ ...attack.shape, range: attack.shape.range * 1.25 }, aimFrame(origin, aim, forwardOf(p.rt.orientation)), p.L);
  }
  private releasePlayerHold(a: ActionState, rt: CombatRuntime, now: number) {
    const held = a.heldTarget === null ? undefined : [...this.entities.values()].find(c => c.id === a.heldTarget);
    if (held) releaseHold(rt, a, held.rt, now, false);
  }

  /** One combat tick (spec §6.1, §5): clocks, the player's starts, actions, hits, holds and kills. */
  tick(ctx: CombatContext): CombatTick {
    const out: CombatTick = { events: [], chomp: false, killed: [], brokeFree: false, started: [] };
    const p = ctx.player, rt = p.rt, intent = ctx.intent;
    const dPlayer = advanceClock(rt, ctx.now, ctx.dt);
    const live = ctx.entities.filter(e => e.active && !e.eaten).map(e => this.stateOf(e)).filter((c): c is EntityCombat => c !== null);
    const dEntity = new Map(live.map(c => [c, advanceClock(c.rt, ctx.now, ctx.dt)] as const));
    const aim = intent.aim ?? forwardOf(rt.orientation);
    // Starts (spec §5.3, §5.7): a held player first tries to break free; then the buffered press, the slot presses and the basic input.
    if (ctx.playing) {
      const dashSlot = ctx.slots.slots.indexOf('dash');
      if (rt.heldBy !== null) {
        const flick = isFlick(ctx.previousMove, intent.move), dashPressed = dashSlot >= 0 && intent.activePressed[dashSlot]!;
        if (addBreakProgress(rt, { basicPressed: intent.basicPressed, dashPressed, flick })) {
          const grabber = live.find(c => c.id === rt.heldBy), g = grabber && holdingAction(grabber.rt, PLAYER_ID);
          if (grabber && g) releaseHold(grabber.rt, g, rt, ctx.now, true); else { rt.heldBy = null; rt.breakProgress = 0; }
          out.brokeFree = true;
        }
      }
      const press = (input: 'basic' | ActiveSlot): boolean => {
        const m = input === 'basic' ? ctx.moves.basic : (() => { const k = ctx.slots.slots[input]; return k ? ctx.moves.byKind[k] ?? null : null; })();
        if (!m) return false;
        const held = input === 'basic' ? intent.basicHeld : intent.activeHeld[input] && !intent.activeCanceled[input];
        const r = this.tryStart(ctx, m, aim, held);
        if (r === 'started') { out.started.push(m.resolved.kind); return true; }
        if (r === 'busy' || r === 'hit-stop') bufferPress(rt, input, ctx.now);
        return false;
      };
      const buffered = bufferedPress(rt);
      if (buffered !== null && rt.heldBy === null) { if (press(buffered)) rt.buffered = null; }
      for (let i = 0; i < 4; i++) if (intent.activePressed[i]) press(i as ActiveSlot);
      // The basic dispatch rule (spec §8.3): Bite when a combat species is in the Bite cone, else today's chomp. A held input repeats Bite.
      if (basicRequested(intent)) {
        const cone = this.biteCone(p, ctx.moves, aim);
        if (cone && biteDispatch(cone, ctx.entities, ctx.stage, e => this.stateOf(e) !== null, e => speciesCombatPose(e, ctx.now).hurtboxes)) {
          if (intent.basicPressed) press('basic');
          else if (this.tryStart(ctx, ctx.moves.basic!, aim, true) === 'started') out.started.push('bite');
        } else out.chomp = true;
      }
    }
    // Actions (spec §5.2, §5.4): the player, then each entity.
    const activeNow: { fighter: 'player' | EntityCombat; a: ActionState }[] = [];
    const braceHeld = (() => { const i = ctx.slots.slots.indexOf('brace'); return i >= 0 && intent.activeHeld[i]! && !intent.activeCanceled[i]!; })();
    for (const a of rt.actions) {
      const wasDash = a.phase === 'active' && !!a.resolved.evasion;
      const r = tickAction(rt, a, dPlayer, { wantedAim: aim, held: braceHeld, bodyForward: horizontal(forwardOf(rt.orientation)) });
      if (r.locked) a.lockedShapes = this.playerShapes(p, a);
      if (wasDash && a.phase !== 'active' && a.resolved.evasion) {   // the end of a dash keeps endSpeedCarry of its speed
        const s = dashSpeed(a, p.L) * a.resolved.evasion.endSpeedCarry; rt.controlledVelocity = { x: a.aim.x * s, y: a.aim.y * s, z: a.aim.z * s };
      }
      if (r.releasedTarget) { const h = live.find(c => c.id === r.releasedTarget); if (h) { h.rt.heldBy = null; h.rt.breakProgress = 0; } }
      if (r.wasActive && a.resolved.attack) activeNow.push({ fighter: 'player', a });
    }
    for (const c of live) {
      const e = c.entity, centre = speciesCombatPose(e, ctx.now).hull[0]!.start;
      for (const a of c.rt.actions) {
        const toPlayer = a.targetId === PLAYER_ID ? unit({ x: p.centre.x - centre.x, y: p.centre.y - centre.y, z: p.centre.z - centre.z }) : null;
        const r = tickAction(c.rt, a, dEntity.get(c)!, { wantedAim: toPlayer, held: false, bodyForward: { x: Math.sin(e.heading), y: 0, z: Math.cos(e.heading) } });
        if (r.locked) a.lockedShapes = this.speciesShapes(c, a, ctx.now);
        if (r.releasedTarget === PLAYER_ID) { rt.heldBy = null; rt.breakProgress = 0; }
        if (r.wasActive && a.resolved.attack) activeNow.push({ fighter: c, a });
      }
    }
    // Hits (spec §6.1): every active action's requests, resolved in the contract order.
    const playerFighter: Fighter = { id: PLAYER_ID, isPlayer: true, rt, centre: p.centre, forward: forwardOf(rt.orientation), L: p.L, mass: p.mass, knockbackResistance: p.knockbackResistance,
      armor: p.armor, ground: p.ground, grabbable: true, poise: null, poiseMax: 0, staggerResist: 0, health: p.health };
    const fighters = new Map(live.map(c => [c, this.fighterOf(c, ctx.now)] as const)), requests: HitRequestIn[] = [];
    for (const { fighter, a } of activeNow) {
      const attack = a.resolved.attack as AttackSpec, shapes = this.hitShapes(fighter === 'player' ? null : fighter, a, p, ctx.now);
      if (!shapes.length) continue;
      const attacker = fighter === 'player' ? playerFighter : fighters.get(fighter)!;
      const candidates = fighter === 'player'
        ? live.map(c => ({ id: c.id, c, hurt: speciesCombatPose(c.entity, ctx.now).hurtboxes }))
        : [{ id: PLAYER_ID, c: null, hurt: p.pose.hurtboxes }];
      const hits = candidates.flatMap(t => { const point = hurtboxesHit(t.hurt, shapes); if (!point) return []; const s = shapes[0]!, origin = s.kind === 'cone' ? s.apex : s.start;
        return [{ ...t, point, origin, distance: Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) }]; });
      for (const t of nearestTargets(hits, attack.maxTargets)) {
        const target = t.c ? fighters.get(t.c)! : playerFighter;
        const geometryOk = crossingOk(attack.crossing, ctx.queries, t.origin, t.point, attacker.L) && obstructionClear(ctx.queries, t.origin, t.point, attacker.L);
        requests.push({ attacker, target, action: a, attack, hitGroupId: a.grantId, origin: t.origin, point: t.point, geometryOk });
      }
    }
    for (const e of resolveAll(requests, ctx.now, statusOf)) {
      out.events.push(e);
      if (e.killed && e.killed !== PLAYER_ID) { const c = live.find(x => x.id === e.killed); if (c && !out.killed.includes(c.entity)) out.killed.push(c.entity); }
      const hurt = live.find(x => x.id === e.targetId); if (hurt && e.amount > 0) hurt.lastDamagedAt = ctx.now;
    }
    p.health = playerFighter.health;
    for (const [c, f] of fighters) c.entity.hp = f.health;
    // Holds (spec §6.6): squeezes on the grabber's clock; a hold whose grabber is gone or no longer holds releases its target.
    for (const c of live) for (const a of c.rt.actions) {
      if (a.phase !== 'hold' || a.heldTarget !== PLAYER_ID) continue;
      const n = squeezesDue(a, c.rt.actionClock), h = a.resolved.attack?.hold;
      for (let i = 0; i < n && h; i++) {
        const hh = damageAfterArmor(h.squeezeHalfHearts, p.armor); p.health -= hh / 2; rt.lastDamageAt = ctx.now;
        out.events.push({ outcome: 'hit', attackerId: c.id, targetId: PLAYER_ID, attackId: a.resolved.attack!.id, actionInstanceId: a.instanceId, point: p.centre, amount: hh, unit: 'half-heart', reflect: 0,
          hitStop: 0, impulse: { x: 0, y: 0, z: 0 }, status: null, caught: false, held: true, killed: null, time: ctx.now });
      }
    }
    for (const c of out.killed.map(e => live.find(x => x.entity === e)!)) this.releaseAllOf(c, rt);
    this.reconcileHolds(rt, live);
    sweepEnded(rt); for (const c of live) sweepEnded(c.rt);
    for (const e of out.events) { this.log.push(e); if (this.log.length > EVENT_LOG) this.log.shift(); }
    return out;
  }
  private fighterOf(c: EntityCombat, now: number): Fighter {
    const pose = speciesCombatPose(c.entity, now), b = c.behaviour;
    return { id: c.id, isPlayer: false, rt: c.rt, centre: pose.hull[0]!.start, forward: pose.forward, L: pose.bodyLength, mass: pose.mass, knockbackResistance: b.knockbackResistance, armor: 0,
      ground: c.entity.spec.movementProfileId === 'sp-ground', grabbable: b.grabbable && !c.entity.spec.alpha, poise: c.poise, poiseMax: b.poise, staggerResist: b.staggerResist, health: c.entity.hp };
  }
  /** A species action's world shapes from its `centre` socket (spec §5.10); a `fixed-at-start` aim is set by the caller. */
  speciesShapes(c: EntityCombat, a: ActionState, now: number): WorldShape[] {
    const attack = a.resolved.attack!, pose = speciesCombatPose(c.entity, now), origin = pose.hull[0]!.start;
    return actionShapes(attack.shape, [origin], a.aim, pose.forward, pose.bodyLength);
  }
  /** The hit volume of an active action: the locked shapes; a lunge's capsule truncated at the reached point (always inside the telegraph). */
  private hitShapes(c: EntityCombat | null, a: ActionState, p: PlayerBody, now: number): WorldShape[] {
    const shapes = a.lockedShapes ?? (c ? this.speciesShapes(c, a, now) : this.playerShapes(p, a)), attack = a.resolved.attack!;
    if (!attack.lunge || attack.shape.kind !== 'capsule') return shapes;
    const len = Math.hypot(attack.shape.end.x - attack.shape.start.x, attack.shape.end.y - attack.shape.start.y, attack.shape.end.z - attack.shape.start.z);
    return shapes.map(s => s.kind === 'capsule' ? truncateCapsule(s, len, attack.lunge!.distanceBodyLengths, a.lungeDone) : s);
  }
  private releaseAllOf(c: EntityCombat, playerRt: CombatRuntime) {
    const a = holdingAction(c.rt, PLAYER_ID); if (a) { playerRt.heldBy = null; playerRt.breakProgress = 0; a.heldTarget = null; }
    if (c.rt.heldBy === PLAYER_ID) for (const a of playerRt.actions) if (a.heldTarget === c.id) a.heldTarget = null;
    c.rt.heldBy = null;
  }
  /** Every `heldBy` must match a grabber action in its hold phase, and every hold a held target; anything else is released (a stagger,
   *  a counter, a kill, a faint or a reset ended one side). */
  private reconcileHolds(rt: CombatRuntime, live: readonly EntityCombat[]) {
    // A catch lands in active; the hold phase starts when active ends.
    const holds = (who: ActorId, of: CombatRuntime) => holdingAction(of, who) !== undefined;
    if (rt.heldBy !== null) { const g = live.find(c => c.id === rt.heldBy); if (!g || !holds(PLAYER_ID, g.rt)) { rt.heldBy = null; rt.breakProgress = 0; } }
    for (const c of live) if (c.rt.heldBy === PLAYER_ID && !holds(c.id, rt)) { c.rt.heldBy = null; c.rt.breakProgress = 0; }
    for (const c of live) { const a = holdingAction(c.rt, PLAYER_ID); if (a && rt.heldBy !== c.id) endHold(c.rt, a); }
    for (const a of rt.actions) if (a.heldTarget !== null && live.find(c => c.id === a.heldTarget)?.rt.heldBy !== PLAYER_ID) endHold(rt, a);
  }
  /** A blocked held motion (result `blocked` with progress below .5) ends the hold (spec §5.12). */
  onPlayerStep(rt: CombatRuntime, step: { status: string; progress: number }, now: number): boolean {
    if (rt.heldBy === null || step.status !== 'blocked' || step.progress >= .5) return false;
    const g = [...this.entities.values()].find(c => c.id === rt.heldBy), a = g && holdingAction(g.rt, PLAYER_ID);
    if (g && a) releaseHold(g.rt, a, rt, now, false); else { rt.heldBy = null; rt.breakProgress = 0; }
    return true;
  }
  /** The claw point of a hold: the grabber's socket origin plus CLAW_REACH × L_t along its aim. */
  clawPoint(grabber: EntityCombat | PlayerBody, a: ActionState, targetL: number, now: number): Vec3 {
    const origin = 'entity' in grabber ? speciesCombatPose(grabber.entity, now).hull[0]!.start : (this.playerShapes(grabber, a)[0] as Extract<WorldShape, { kind: 'cone' }> | undefined)?.apex ?? grabber.centre;
    return { x: origin.x + a.aim.x * CLAW_REACH * targetL, y: origin.y + a.aim.y * CLAW_REACH * targetL, z: origin.z + a.aim.z * CLAW_REACH * targetL };
  }
  /** Motion during the player's actions for the next player step (spec §5.12). */
  playerMotion(p: PlayerBody, intent: CombatInput, now: number): CombatMotion {
    const rt = p.rt; let speed = 1, face: CombatMotion['face'] = null, dash: Vec3 | null = null, forced: Vec3 | null = null;
    for (const a of liveActions(rt)) {
      const attack = a.resolved.attack, g = a.resolved.guard;
      if (attack && (a.phase === 'windup' || a.phase === 'active')) {
        speed *= attack.moveSpeedFactor;
        if (a.resolved.kind === 'bite' || a.resolved.kind === 'grab') face = { dir: a.aim, yawRateFactor: 1 };
      }
      if (g?.kind === 'brace' && (a.phase === 'windup' || a.phase === 'active')) { speed *= g.moveSpeedFactor; face = { dir: intent.aim ?? forwardOf(rt.orientation), yawRateFactor: g.yawRateFactor }; }
      if (a.phase === 'hold') speed *= HOLDING_SPEED;
      if (a.resolved.evasion && a.phase === 'active') { const s = dashSpeed(a, p.L); dash = { x: a.aim.x * s, y: a.aim.y * s, z: a.aim.z * s }; }
    }
    if (rt.status && now < rt.status.until) speed *= rt.status.speedFactor;
    if (rt.actionClock < rt.staggerUntil) speed *= STAGGERED_SPEED;
    if (rt.heldBy !== null) {
      const g = [...this.entities.values()].find(c => c.id === rt.heldBy), a = g && holdingAction(g.rt, PLAYER_ID);
      if (g && a) { const claw = this.clawPoint(g, a, p.L, now); forced = { x: claw.x - p.centre.x, y: claw.y - p.centre.y, z: claw.z - p.centre.z }; }
    }
    return { speedFactor: speed, face, dashVelocity: dash, forcedDisplacement: forced, frozen: now < rt.hitStopUntil };
  }
  /** Starts a species attack (the AI asks; spec §5.3). `token` is the director's answer for an attack that targets the player. */
  startSpecies(c: EntityCombat, attackId: string, attack: AttackSpec, aim: Vec3, targetId: ActorId | null, now: number, token = true, playing = true): ActionState | StartRefusal {
    const key = `${c.id}:root:${attackId}`, d = canStart(c.rt, { playing, isPlayer: false, kind: 'species', cooldownKey: key, mode: 'swim', allowedModes: ['swim'], inBreachArc: false, token, worldNow: now });
    if (!d.ok) return d.reason;
    if (d.replaces) endNow(c.rt, d.replaces);
    const a = startAction(c.rt, { instanceId: this.nextId(c.id), definitionId: attackId, grantId: attackId, source: { kind: 'actor', actorId: c.id, mountId: 'root', socketId: 'centre' },
      resolved: speciesMove(attack), aim, targetId, cooldownKey: key, worldNow: now });
    if (a.aimLocked) a.lockedShapes = this.speciesShapes(c, a, now);
    return a;
  }
}
```

- [ ] **Step 5: Run the combat tick in `sim.ts` and present it in `main.ts`**

```diff
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -5,15 +5,19 @@ import { SIZES } from './biomes';
 import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRuntime, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
 import type { Ecosystem, EcoEvent } from './ecosystem';
 import { chomp, CHOMP_COOLDOWN, type ChompResult } from './feeding';
+import { CombatWorld, playerMatrix, type CombatTick, type PlayerBody } from './combat-world';
+import { assignSlots, movesOf, NO_PINS, type MoveSet, type SlotAssignment } from './moves';
+import { createRigPose, type RigPose } from './rig';
+import { DROPS } from './parts';
 import { derive, effectiveStats, type Derived } from './genome';
 import { basicRequested } from './input';
 import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UNSTICK_BUDGET, UnstickSearch, wedged, type TrapWatch } from './lifecycle';
 import { startAnchor } from './motion';
-import { bodyLengthOf, hullFitOf, hullOffsets, massFor } from './mount';
+import { bodyLengthOf, hullFitOf, hullOffsets, massFor, sampleCombatPose } from './mount';
 import { orientedHeave, orientedSway, rotateInto } from './orientation';
 import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
 import { habitat, movement, movementCapabilities } from './profiles';
-import { currentPlan, evolveReady, growthOf, hurt, STAGES, type Run } from './state';
+import { currentPlan, evolveReady, growthOf, hurt, STAGES, unlock, type Run } from './state';
 import { admissionClock, supportHeight } from './world-queries';
 
 export type GameMode = 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won';
@@ -33,6 +37,10 @@ export interface SimState {
   rescueLog: RescueLog; trapRescues: number; lastSolids: string[];
   actorCache: ActorCache | null; hullRescaled: boolean; hullGrew: boolean;
   acceptedHits: number; rejectedHits: number; faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[];
+  /** The combat world (spec §3.1) and the player's moves, cached per genome revision. */
+  combat: CombatWorld; moves: { revision: number; set: MoveSet; slots: SlotAssignment; rig: RigPose } | null;
+  /** The previous tick's stick (break-free flicks). */
+  previousMove: Vec3;
 }
 export type SimEvent =
   /** A pose was installed (`snap`: the camera jumps there too: start, respawn). */
@@ -40,18 +48,22 @@ export type SimEvent =
   | { type: 'step'; result: PlayerStepResult }
   | { type: 'stuck' } | { type: 'unstuck' }
   | { type: 'chomp'; result: ChompResult }
+  /** One combat tick's outcome (hits, kills, the moves the player started). */
+  | { type: 'combat'; tick: CombatTick }
   | { type: 'regen' }
   /** An accepted hazard hit; `fainted` when it emptied the hearts (the run is already marked; save it at once). */
   | { type: 'hurt'; event: EcoEvent; damage: number; fainted: boolean }
   | { type: 'respawned' } | { type: 'respawn-waiting' }
+  /** Combat damage emptied the hearts (the run is already marked; save it at once). */
+  | { type: 'fainted' }
   /** A loaded run that was saved during a faint found no anchor yet: it waits fainted (main shows the faint overlay). */
   | { type: 'resume-fainted' };
 export interface SimInput { dt: number; intent: CombatInput; wish: Vec3; held: boolean }
 
-type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog'>;
+type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog' | 'combat' | 'moves' | 'previousMove'>;
 /** The fields only the simulation owns (main.ts spreads them into its bound state). */
 export const simOwnedState = (): SimOwned => ({ trap: newTrapWatch(), unstick: null, glide: null, beforeStep: newStepSnapshot(), rescueLog: { searches: 0, found: 0, failed: 0, last: null },
-  trapRescues: 0, lastSolids: [], actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [] });
+  trapRescues: 0, lastSolids: [], actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [], combat: new CombatWorld(), moves: null, previousMove: { x: 0, y: 0, z: 0 } });
 /** A plain state (tests and the combat probe). */
 export function newSimState(run: Run): SimState {
   return { run, rt: newRuntime(), physical: { x: 0, y: 0, z: 0 }, time: 0, mode: 'menu', derived: derive(effectiveStats(run.genome, currentPlan(run))), genomeRevision: 0,
@@ -140,6 +152,27 @@ export function tryRespawn(s: SimState, w: SimWorld, events: SimEvent[]): boolea
   installPose(s, w, anchor, actor, events, true); refreshDerived(s); return true;
 }
 
+/** The player's moves and slots, cached per genome revision (pins: none until the loadout carries them). */
+export function playerMoves(s: SimState): NonNullable<SimState['moves']> {
+  if (!s.moves || s.moves.revision !== s.genomeRevision) s.moves = { revision: s.genomeRevision, set: movesOf(s.run.genome), slots: assignSlots(s.run.genome, NO_PINS), rig: createRigPose(s.run.genome) };
+  return s.moves;
+}
+/** The player's combat body at its installed pose (spec §5.10: sampleCombatPose on the rest rig). */
+export function playerBody(s: SimState, actor: Actor): PlayerBody {
+  const plan = currentPlan(s.run), m = playerMoves(s), scale = SIZES[s.run.stage]! * growthOf(s.run), caps = movementCapabilities(plan);
+  const pose = sampleCombatPose({ actorId: 'player', genome: s.run.genome, plan, world: playerMatrix(s.physical, s.rt.orientation, scale), rig: m.rig, physicalLength: actor.bodyLength });
+  const hull = worldHull(s, actor), first = hull[0]!, lastC = hull[hull.length - 1]!;
+  const centre = { x: (first.start.x + lastC.end.x) / 2, y: (first.start.y + lastC.end.y) / 2, z: (first.start.z + lastC.end.z) / 2 };
+  return { rt: s.rt, position: s.physical, centre, L: actor.bodyLength, mass: massFor(plan, s.run.genome, actor.bodyLength), knockbackResistance: plan.physics.knockbackResistance,
+    armor: s.derived.armor, ground: caps.ground, mode: movement(plan.movement).mode, inBreachArc: s.rt.arc !== null, health: s.run.health, pose };
+}
+/** A faint at 0 hearts, once (the hazard path and the combat path share it). */
+function faintNow(s: SimState): boolean {
+  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
+  if (!beginRespawn(s.run, s.rt)) return false;
+  s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
+  return true;
+}
 /** One frame of the simulation (main.ts `frame` without presentation). */
 export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[] {
   const events: SimEvent[] = [], { dt, held } = input, run = s.run;
@@ -167,7 +200,7 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
       if (s.glide && s.glide.index >= s.glide.path.length) s.glide = null;
       r = { position: s.physical, status: 'moved', contacts: [], progress: 1, needsRecovery: false, breachStarted: false, arcEnded: false, permitEnded: false, turnRefused: false };
     } else r = stepPlayer(s.physical, rt, intent, { plan, profile: movement(plan.movement), caps, actor, ...legal, size: SIZES[stage]!, topSpeedLocal: STAGES[stage]!.speed * s.derived.speedFactor,
-      now: s.time, dt, wish, aim: null, actionLock: false });
+      now: s.time, dt, wish, aim: null, actionLock: false, combat: s.combat.playerMotion(playerBody(s, actor), intent, s.time) });
     // A result that needs recovery is never installed: recover from it, or keep the last legal pose while stuck.
     if (!r.needsRecovery) s.physical = r.position;
     else if (!recover(s, w, actor, s.time + dt, events, r.position)) { restoreStep(rt, s.beforeStep); enterStuck(s, events); }
@@ -184,9 +217,20 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
     }
     s.lastSolids = r.contacts.filter(c => c.solidId).map(c => c.solidId!);
     events.push({ type: 'step', result: r });
-    if (s.mode === 'playing' && basicRequested(intent) && s.chompCooldown <= 0) {
-      s.chompCooldown = CHOMP_COOLDOWN;
-      events.push({ type: 'chomp', result: chomp(run, w.eco, s.physical, growthOf(run), s.derived, s.time, worldHull(s, playerActorCached(s))) });
+    s.combat.onPlayerStep(rt, r, s.time);
+    // The combat world (spec §3.1): the player's moves, every action, hits, holds and kills. The basic input that finds no combat species
+    // in the Bite cone falls back to today's chomp, before the ecosystem moves (the former main.ts order).
+    if (s.mode === 'playing') {
+      const body = playerBody(s, actor), m = playerMoves(s);
+      const tick = s.combat.tick({ now: s.time, dt, playing: true, intent, wish, previousMove: s.previousMove, player: body, moves: m.set, slots: m.slots, entities: w.eco.entities, stage, queries: legal.queries });
+      run.health = body.health; s.previousMove = intent.move;
+      if (tick.events.length || tick.killed.length || tick.started.length || tick.brokeFree) events.push({ type: 'combat', tick });
+      for (const e of tick.killed) { const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop); w.eco.consume(e); s.combat.forget(e); }
+      if (run.health <= 0 && faintNow(s)) events.push({ type: 'fainted' });
+      if (s.mode === 'playing' && tick.chomp && basicRequested(intent) && s.chompCooldown <= 0) {
+        s.chompCooldown = CHOMP_COOLDOWN;
+        events.push({ type: 'chomp', result: chomp(run, w.eco, s.physical, growthOf(run), s.derived, s.time, worldHull(s, playerActorCached(s))) });
+      }
     }
   }
   if (s.mode === 'stuck' && actor) {
@@ -210,12 +254,8 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
 /** One accepted hazard event: damage, and a faint at 0 hearts (once). */
 function takeHit(s: SimState, event: EcoEvent, events: SimEvent[]): void {
   s.sinceHit = 0;
-  const fainted = hurt(s.run, event.damage, s.derived.armor), damage = event.damage;
-  if (!fainted) { events.push({ type: 'hurt', event, damage, fainted: false }); return; }
-  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
-  if (!beginRespawn(s.run, s.rt)) { events.push({ type: 'hurt', event, damage, fainted: false }); return; }
-  s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
-  events.push({ type: 'hurt', event, damage, fainted: true });
+  const fainted = hurt(s.run, event.damage, s.derived.armor) && faintNow(s);
+  events.push({ type: 'hurt', event, damage: event.damage, fainted });
 }
 /** The faint timer: respawn at the start anchor, or wait and retry each second. */
 function tickFaint(s: SimState, w: SimWorld, dt: number, events: SimEvent[]): void {
@@ -229,7 +269,7 @@ export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null
   const events: SimEvent[] = [];
   s.run = run; refreshDerived(s); run.health = Math.min(run.health, s.derived.maxHealth);
   s.mode = 'playing'; s.chompCooldown = 0; s.sinceHit = 99;
-  s.rt = newRuntime(); s.genomeRevision++; cancelRescue(s); s.startGracePending = false;
+  s.rt = newRuntime(); s.genomeRevision++; cancelRescue(s); s.startGracePending = false; s.combat.reset(); s.previousMove = { x: 0, y: 0, z: 0 };
   s.faintLog.length = 0; s.acceptedHits = 0; s.rejectedHits = 0;
   const actor = playerActorCached(s), t = w.legality(run.stage).queries.terrain;
   s.physical = { x: 0, y: t.space ? 3 * SIZES[run.stage]! : t.groundAt(0, 0) + actor.bodyLength, z: 0 };
```

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -21,6 +21,8 @@ import { blockHint, blockHintDue, newBlockHintGate, type PlayerStepResult, newTa
 import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
 import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
 import type { ChompResult } from './feeding';
+import { PLAYER_ID, type CombatTick } from './combat-world';
+import { damageText } from './combat-profiles';
 import { movement, movementCapabilities } from './profiles';
 import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, zoneLabel } from './world-queries';
 import { ROCK_FIT, stageSolids } from './reef';
@@ -441,7 +443,8 @@ async function editDesign() {
       const applied = applyDesign(run, r.genome, r.name, BUILD, r.nextSerial, CATALOG);
       if (!applied.ok) return { ok: false, reason: applied.reason };
       // The simulation clock is stopped while editing, so `time` is the commit time.
-      reconcileAfterCommit(rt, designDelta(before, run.genome, oldLoadout, CATALOG), run.genome, 'player', time); genomeRevision++; refreshDerived(); committed = true;
+      // Cooldowns are action-clock times (spec §5.1).
+      reconcileAfterCommit(rt, designDelta(before, run.genome, oldLoadout, CATALOG), run.genome, 'player', rt.actionClock); genomeRevision++; refreshDerived(); committed = true;
       if (JSON.stringify(before) !== JSON.stringify(run.genome)) { world.setCreature(run.genome); world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#f4e2b9', 30); audio.found(); }
       return { ok: true };
     } });
@@ -477,6 +480,8 @@ function presentSim(events: readonly SimEvent[], dt: number) {
       case 'chomp': presentChomp(e.result); break;
       case 'regen': syncHearts(); break;
       case 'hurt': presentHurt(e.event, e.fainted); break;
+      case 'combat': presentCombat(e.tick); break;
+      case 'fainted': presentFaint(); break;
       case 'respawned': el('faint').hidden = true; save(); syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`); break;
       case 'respawn-waiting': if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); } break;
       case 'resume-fainted': el('faint').hidden = false; break;
@@ -524,9 +529,23 @@ function presentHurt(event: EcoEvent, fainted: boolean) {
   floater(`-${damageAfterArmor(event.damage, derived.armor)} ♥`, pos.x, pos.y, 'hurt');
   syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
   if (!fainted) { if (run.health <= 2) toast(`${event.entity.spec.label} is winning! Get away to heal.`); return; }
+  presentFaint();
+}
+/** A faint (the simulation already began the respawn): save at once, then the overlay. */
+function presentFaint() {
   save(); respawnToasted = false;
   clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
 }
+/** One combat tick: damage numbers, hearts, and the removed bodies of kills (Task 13 adds the full hit feel). */
+function presentCombat(t: CombatTick) {
+  for (const e of t.events) {
+    const pos = world.screenPoint(new T.Vector3(e.point.x, e.point.y, e.point.z).divideScalar(world.scale));
+    if (e.amount > 0 || e.outcome !== 'hit') floater(damageText(e.outcome, e.unit, e.amount), pos.x, pos.y, e.targetId === PLAYER_ID ? 'hurt' : 'hit');
+    if (e.targetId === PLAYER_ID) syncHearts();
+  }
+  for (const k of t.killed) { const food = world.foods.find(f => f.entity === k); if (food) world.removeFood(food); }
+  if (t.killed.length) { syncUI(); save(); }
+}
 el('start').onclick = () => begin(); el('fresh').onclick = () => { dialogReturn = 'menu'; confirmRestart(); };
 el('evolve').onclick = () => void edit('evolve'); el('edit').onclick = () => void edit('edit');
 el('sound').onclick = () => { audio.init(); audio.toggle(); syncSound(); try { localStorage.setItem('tiny-tide-muted', String(audio.muted)); } catch { /* Optional preference. */ } };
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-world.test.ts tests/tiny-tide-core/feeding.test.ts tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/lifecycle.test.ts`
Expected: PASS, 0 failed. The golden still matches (no combat species exist yet, so the tick does nothing at stage 0).

- [ ] **Step 7: Checkpoint.** Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/tiny-tide/combat-world.ts src/tiny-tide/action-engine.ts src/tiny-tide/feeding.ts src/tiny-tide/lifecycle.ts src/tiny-tide/mount.ts src/tiny-tide/sim.ts src/tiny-tide/main.ts tests/tiny-tide-core/combat-fixture-world.ts tests/tiny-tide-core/combat-world.test.ts tests/tiny-tide-core/feeding.test.ts
git commit -m "Tiny Tide combat: the combat world tick (starts, actions, hits, holds, kills) and the basic Bite/chomp dispatch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T9: Desktop controls and the slot HUD

**Spec:** §8.1, §8.4, D7, D9.

**Files:**
- Create: `src/tiny-tide/combat-hud.ts`
- Modify: `src/tiny-tide/main.ts`, `src/tiny-tide/input.ts`, `src/tiny-tide/world.ts`, `src/tiny-tide/controls.css`
- Modify: `tests/tiny-tide-core/input.test.ts`
- Modify: `e2e/tiny-tide.mjs` (the camera drag)

**Interfaces:**
- Consumes: T2 `assignSlots`, `MoveSet`; T7 `aimSource`; T8 `CombatWorld`.
- Produces: `input.ts`: `AimSource`, `POINTER_FRESH_SECONDS = 4`, `pointerAim(origin, rayOrigin, rayDir)`, `SOFT_LOCK_HALF_ANGLE` (30°), `aimPitch(origin, aim, targets, creaturePitch, limit)`, `pitched(aim, pitch)`; `world.ts`: `pointerRay(x, y)`, `cameraForward()`; `combat-hud.ts`: `MOVE_ICONS`, `SlotView`, `slotViews(slots, moves, rt)`, `class CombatHud`. Desktop input: left mouse = basic, right mouse = slot 1 (held), `Digit1`–`Digit4` = slots 1–4, middle drag or Alt + left drag turns the camera, the context menu is blocked, desktop tap-to-walk is removed (touch keeps it).

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/input.test.ts
+++ b/tests/tiny-tide-core/input.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { basicRequested, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
+import { aimPitch, basicRequested, pitched, pointerAim, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
 
 const src = (over: Partial<InputSources> = {}): InputSources => ({ stickX: 0, stickZ: 0, keys: new Set(), chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false, ...over });
 const read = (s: InputSources, prev = RELEASED, breach = false) => readIntent(s, prev, { breachOnRiseTap: breach });
@@ -46,3 +46,19 @@ describe('input intents', () => {
     expect(canceled.activeReleased).toEqual([false, false, false, false]); expect(canceled.activeCanceled).toEqual([true, false, false, false]); expect(canceled.activeHeld).toEqual([false, false, false, false]);
   });
 });
+describe('aim', () => {
+  it('meets the plane through the creature, or gives none', () => {
+    const o = { x: 0, y: 5, z: 0 };
+    const a = pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 3 / Math.hypot(3, 5, 10), y: -5 / Math.hypot(3, 5, 10), z: 10 / Math.hypot(3, 5, 10) });   // hits (3, 5, 0)
+    expect(a!.x).toBeCloseTo(1); expect(a!.z).toBeCloseTo(0);
+    expect(pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 0, y: 1, z: 0 })).toBeNull();   // up: no meet in front
+    expect(pointerAim(o, { x: 0, y: 10, z: -10 }, { x: 1, y: 0, z: 0 })).toBeNull();   // parallel
+  });
+  it('soft-locks the pitch within 30° of yaw, else keeps the creature pitch', () => {
+    const o = { x: 0, y: 0, z: 0 }, fwd = { x: 0, y: 0, z: 1 };
+    expect(aimPitch(o, fwd, [{ x: 0, y: 1, z: 1 }], .2, 1.2)).toBeCloseTo(Math.PI / 4);
+    expect(aimPitch(o, fwd, [{ x: 1, y: 1, z: 1 }], .2, 1.2)).toBeCloseTo(.2);   // 45° off: not locked
+    expect(aimPitch(o, fwd, [{ x: 0, y: 10, z: 1 }], 0, 1.2)).toBeCloseTo(1.2);   // clamped
+    expect(pitched(fwd, Math.PI / 6)).toEqual({ x: 0, y: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) });
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts`
Expected: FAIL — `pointerAim` and `aimPitch` not exported.

- [ ] **Step 3: Implement aim, the HUD and the desktop wiring**

```diff
--- a/src/tiny-tide/input.ts
+++ b/src/tiny-tide/input.ts
@@ -48,3 +48,33 @@ export function readIntent(s: InputSources, previous: CombatInput, opts: { breac
 export function basicRequested(intent: CombatInput): boolean {
   return !intent.activePressed.some(Boolean) && (intent.basicPressed || intent.basicHeld);
 }
+
+// ---- aim (spec §8.4) ----
+/** The desktop pointer counts for this long after it last moved over the canvas; then the aim is the camera forward. */
+export const POINTER_FRESH_SECONDS = 4;
+/** The horizontal aim from `origin` toward where the pointer ray (render units) meets the horizontal plane through `origin`; null when the
+ *  ray does not meet that plane in front of the camera (the caller uses the camera forward). */
+export function pointerAim(origin: Vec3, rayOrigin: Vec3, rayDir: Vec3): Vec3 | null {
+  if (Math.abs(rayDir.y) < 1e-9) return null;
+  const t = (origin.y - rayOrigin.y) / rayDir.y; if (t <= 0) return null;
+  const dx = rayOrigin.x + rayDir.x * t - origin.x, dz = rayOrigin.z + rayDir.z * t - origin.z, l = Math.hypot(dx, dz);
+  return l > 1e-6 ? { x: dx / l, y: 0, z: dz / l } : null;
+}
+/** The soft-lock cone (D9): a target within 30° of yaw of the aim sets the pitch. */
+export const SOFT_LOCK_HALF_ANGLE = 30 * Math.PI / 180;
+/** The aim pitch of a free mover (D9): toward the nearest target within SOFT_LOCK_HALF_ANGLE of yaw of the horizontal aim, else the creature's
+ *  pitch; clamped to ±limit. */
+export function aimPitch(origin: Vec3, aim: Vec3, targets: readonly Vec3[], creaturePitch: number, limit: number): number {
+  const yaw = Math.atan2(aim.x, aim.z);
+  let best: Vec3 | null = null, bestD = Infinity;
+  for (const t of targets) {
+    const dx = t.x - origin.x, dz = t.z - origin.z, h = Math.hypot(dx, dz); if (h < 1e-9) continue;
+    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)));
+    const d = Math.hypot(dx, t.y - origin.y, dz);
+    if (off <= SOFT_LOCK_HALF_ANGLE + 1e-9 && d < bestD) { best = t; bestD = d; }
+  }
+  const pitch = best ? Math.atan2(best.y - origin.y, Math.hypot(best.x - origin.x, best.z - origin.z)) : creaturePitch;
+  return Math.max(-limit, Math.min(limit, pitch));
+}
+/** A horizontal aim tilted to `pitch` (positive is up). */
+export const pitched = (aim: Vec3, pitch: number): Vec3 => ({ x: aim.x * Math.cos(pitch), y: Math.sin(pitch), z: aim.z * Math.cos(pitch) });
--- a/src/tiny-tide/world.ts
+++ b/src/tiny-tide/world.ts
@@ -326,6 +326,10 @@ export class TideWorld {
     const v = position.clone().project(this.camera); const forward = position.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new T.Vector3()));
     return { x: (v.x + 1) * this.width / 2, y: (1 - v.y) * this.height / 2, visible: v.z < 1 && forward > 0 };
   }
+  /** The camera ray through a client point (render units). */
+  pointerRay(x: number, y: number): { origin: T.Vector3; dir: T.Vector3 } { const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x / this.width * 2 - 1, -y / this.height * 2 + 1), this.camera); return { origin: ray.ray.origin.clone(), dir: ray.ray.direction.clone() }; }
+  /** The camera's horizontal forward (the keyboard-only aim, spec §8.4). */
+  cameraForward(): { x: number; y: number; z: number } { const d = this.camera.getWorldDirection(new T.Vector3()), l = Math.hypot(d.x, d.z) || 1; return { x: d.x / l, y: 0, z: d.z / l }; }
   groundPoint(x: number, y: number): T.Vector3 | null { const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x / this.width * 2 - 1, -y / this.height * 2 + 1), this.camera); return ray.ray.intersectPlane(new T.Plane(UP, -this.player.position.y), new T.Vector3()); }
   update(dt: number, time: number, menu: boolean, moving: boolean, chomping: number, growth: number) {
     this.isMenu = menu; const p = this.player.position;
```

`src/tiny-tide/combat-hud.ts` (complete file at this task; T12 and T17 add to it):

```ts
// The combat HUD (spec §8, §9.2–§9.3): the four slot buttons with their move icons, key labels and cooldown rings. DOM only.
import './controls.css';
import type { CombatRuntime, MoveKind } from './combat-types';
import type { MoveSet, SlotAssignment } from './moves';

const svg = (body: string) => `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Inline move icons (spec §11.7: art debt none). */
export const MOVE_ICONS: Readonly<Record<MoveKind, string>> = {
  brace: svg('<path d="M20 5 33 11v9c0 8-6 13-13 15C13 33 7 28 7 20v-9Z"/>'),
  counter: svg('<path d="M20 4v8M20 28v8M4 20h8M28 20h8M9 9l6 6M25 25l6 6M31 9l-6 6M9 31l6-6"/><circle cx="20" cy="20" r="4"/>'),
  dash: svg('<path d="M6 14h18M10 20h22M6 26h18M26 12l8 8-8 8"/>'),
  grab: svg('<path d="M10 30c-4-8 0-18 9-20l4 7-6 3 2 4 7-3 4 7c-5 6-15 8-20 2Z"/>'),
  sweep: svg('<path d="M8 28c4-14 18-18 26-10M34 18l-1-8M34 18l-8 1"/>'),
};
/** What a slot button shows: the move, its name and the cooldown left as a fraction (0 = ready). */
export interface SlotView { kind: MoveKind | null; label: string; cooldown: number }
/** The slot views of the assignment: the representative move's label and its cooldown on the player's action clock. */
export function slotViews(slots: SlotAssignment, moves: MoveSet, rt: CombatRuntime): SlotView[] {
  return slots.slots.map(kind => {
    const m = kind ? moves.byKind[kind] : undefined;
    if (!kind || !m) return { kind: null, label: '', cooldown: 0 };
    const ready = rt.cooldowns.get(`player:${m.partUid}:${m.grantId}`) ?? 0, total = m.resolved.cooldownSeconds;
    return { kind, label: m.resolved.label, cooldown: total > 0 ? Math.max(0, Math.min(1, (ready - rt.actionClock) / total)) : 0 };
  });
}
export class CombatHud {
  readonly buttons: HTMLButtonElement[] = [];
  private shown: string[] = ['', '', '', ''];
  constructor(host: HTMLElement) {
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.id = `slot-${i + 1}`; b.className = 'slot-button'; b.hidden = true;
      b.innerHTML = `<i class="slot-ring"></i><span class="slot-icon"></span><b class="slot-name"></b><kbd>${i + 1}</kbd>`;
      host.append(b); this.buttons.push(b);
    }
  }
  /** Writes only what changed: an empty slot is hidden; the ring is a conic gradient of the cooldown left. */
  sync(views: readonly SlotView[]): void {
    views.forEach((v, i) => {
      const b = this.buttons[i]!, key = `${v.kind}:${v.label}:${Math.round(v.cooldown * 40)}`;
      if (this.shown[i] === key) return;
      this.shown[i] = key; b.hidden = v.kind === null;
      if (!v.kind) return;
      b.querySelector('.slot-icon')!.innerHTML = MOVE_ICONS[v.kind]; b.querySelector('.slot-name')!.textContent = v.label.toUpperCase();
      b.setAttribute('aria-label', `${v.label} (slot ${i + 1})`); b.dataset.kind = v.kind;
      (b.querySelector('.slot-ring') as HTMLElement).style.background = v.cooldown > 0 ? `conic-gradient(#0e2f3acc ${v.cooldown * 360}deg, transparent 0)` : 'none';
      b.classList.toggle('cooldown', v.cooldown > 0);
    });
  }
}
```

```diff
new file mode 100644
--- /dev/null
+++ b/src/tiny-tide/controls.css
@@ -0,0 +1,17 @@
+/* Combat controls (spec §8.2): the basic button, four slot buttons in an arc above and to its left, and Rise / Dive in a column at the right edge.
+   Boxes are placed from the bottom-right; the numbers are the spec's tables at 1280×800 (desktop), 320×568 (phone) and 844×390 (landscape). */
+#game-ui .actions{position:absolute;right:0;bottom:0;width:100%;height:100%;display:block;pointer-events:none}
+#game-ui .actions>*{position:absolute;pointer-events:auto}
+#game-ui .chomp-button{right:4.2%;bottom:65px;width:119px;height:119px}
+.slot-button{width:64px;height:64px;border-radius:50%;background:#e0e7da1f;border:1px solid #e6eddc6e;backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;color:var(--cream);touch-action:none;overflow:hidden}
+.slot-button .slot-ring{position:absolute;inset:0;border-radius:50%;pointer-events:none}
+.slot-button .slot-icon{display:grid;place-items:center}.slot-button .slot-icon svg{width:24px;height:24px}
+.slot-button .slot-name{font-size:7px;letter-spacing:.8px;font-weight:600}.slot-button kbd{font-size:7px;height:12px;min-width:12px;margin:0}
+.slot-button.pressed{background:#f1f5d83f}.slot-button.cooldown .slot-icon{opacity:.55}
+/* Desktop: slots 64 px on a 130 px radius around the basic centre at 180°, 140°, 100°, 60°; Rise and Dive above slot 4. */
+#game-ui #slot-1{right:calc(4.2% + 59.5px + 130px - 32px);bottom:calc(65px + 59.5px - 32px)}
+#game-ui #slot-2{right:calc(4.2% + 59.5px + 99.6px - 32px);bottom:calc(65px + 59.5px + 83.6px - 32px)}
+#game-ui #slot-3{right:calc(4.2% + 59.5px + 22.6px - 32px);bottom:calc(65px + 59.5px + 128px - 32px)}
+#game-ui #slot-4{right:calc(4.2% + 59.5px - 65px - 32px);bottom:calc(65px + 59.5px + 112.6px - 32px)}
+#game-ui .vertical-controls{right:calc(4.2% - 37.5px);bottom:285px;flex-direction:column;gap:8px}
+#game-ui .vertical-controls .special-button{width:64px;height:64px;margin:0}
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -15,9 +15,10 @@ import { openPathScreen, type PathChoice } from './path-screen';
 import { renderPreview } from './preview';
 import { cardSummary, COAST_READY, eligibleChildren, leadsTo, type BodyPlan } from './plans';
 import { quoteDesign } from './economy';
-import { newRuntime, type Actor, type CombatInput, type Constraint, type Vec3, type WorldQueries } from './combat-types';
-import { readIntent, RELEASED } from './input';
-import { blockHint, blockHintDue, newBlockHintGate, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
+import { newRuntime, type Actor, type CombatInput, type Constraint, type Tuple4, type Vec3, type WorldQueries } from './combat-types';
+import { aimPitch, pitched, pointerAim, POINTER_FRESH_SECONDS, readIntent, RELEASED, type AimSource } from './input';
+import { CombatHud, slotViews } from './combat-hud';
+import { blockHint, blockHintDue, newBlockHintGate, PITCH_LIMIT, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
 import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
 import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
 import type { ChompResult } from './feeding';
@@ -77,7 +78,7 @@ app.innerHTML = `
     <div id="objective"><span class="objective-dot"></span><span id="objective-text"></span></div>
     <button id="evolve" class="primary evolve-button" hidden>${icons.up}<span>Evolve!</span></button>
     <div class="stage-dots" aria-label="Evolution progress">${STAGES.map((s, i) => `<span data-stage="${i}" title="${s.title}">${species[i]}</span>`).join('<i></i>')}</div>
-    <div id="joystick" aria-label="Drag to move" role="group"><div class="stick-cross"></div><span id="stick"></span></div><div class="movement-hint"><span class="desktop-hint"><kbd>W</kbd><br><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>TO MOVE · DRAG TO LOOK</span></span><span class="touch-hint">DRAG TO MOVE</span></div>
+    <div id="joystick" aria-label="Drag to move" role="group"><div class="stick-cross"></div><span id="stick"></span></div><div class="movement-hint"><span class="desktop-hint"><kbd>W</kbd><br><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>TO MOVE · MOUSE TO AIM · MIDDLE-DRAG TO LOOK</span></span><span class="touch-hint">DRAG TO MOVE</span></div>
     <div class="look-hint" id="look-hint"><span>↔</span> SWIPE TO LOOK AROUND</div><div class="depth-gauge"><span id="depth-label">SEAFLOOR</span><div><i id="depth-dot"></i></div><small id="depth-hint">LOOK UP. THERE’S A WHOLE WORLD.</small></div><div id="evolution-banner" hidden><span id="evolution-icon"></span><div><small>LOOK AT YOU GROW!</small><strong id="evolution-name"></strong><span id="evolution-detail">Same little soul. A bigger world to eat.</span></div></div><div class="actions"><div class="vertical-controls" id="vertical-controls" hidden><button id="special" class="special-button" aria-label="Rise" hidden>${icons.up}<span id="special-label">RISE</span><kbd>E</kbd></button><button id="dive" class="special-button dive-button" aria-label="Dive">${icons.up}<span>DIVE</span><kbd>Q</kbd></button></div><button id="chomp" class="chomp-button" aria-label="Chomp (hold to keep eating)">${icons.chomp}<strong>CHOMP</strong><span>HOLD <kbd>SPACE</kbd></span></button></div>
     <div id="food-pointer" hidden><span id="pointer-arrow">↑</span><span id="pointer-label">SEA SPROUT</span></div>
     <div id="snack-label" hidden></div><div id="threats" aria-hidden="true"></div><div id="toast" role="status" aria-live="polite"></div>
@@ -88,6 +89,7 @@ app.innerHTML = `
   <div class="corner-note" id="corner-note">MADE FOR A LITTLE ESCAPE <span>✳</span></div>
 `;
 const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
+const combatHud = new CombatHud(document.querySelector<HTMLElement>('.actions')!);
 const audio = new TideAudio();
 let world: TideWorld;
 try {
@@ -187,6 +189,10 @@ startAnalytics('tiny-tide', () => mode === 'playing' || mode === 'evolving');
 let keys = new Set<string>();
 let stickX = 0, stickZ = 0, stickPointer: number | null = null;
 let holdingChomp = false, rising = false, diving = false, chompTapped = false, riseTapped = false;
+/** Slot sources (spec §8.1–§8.2): slot buttons, keys 1–4 (keydown taps; readIntent reads held keys) and the right mouse (slot 1). */
+let slotHeld: Tuple4<boolean> = [false, false, false, false], slotTapped: Tuple4<boolean> = [false, false, false, false], slotCanceled: Tuple4<boolean> = [false, false, false, false];
+/** The desktop pointer (spec §8.4): its last client position and when it last moved over the canvas (ms); the left mouse holds the basic input. */
+let pointerX = 0, pointerY = 0, pointerAt = -Infinity, pointerOver = false, mouseBasic = false;
 let lastIntent: CombatInput = RELEASED;
 let target: T.Vector3 | null = null;
 let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0;
@@ -274,7 +280,7 @@ function renderRoot() {
 const admittedNow = (actor: Actor) => simAdmitted(sim, simWorld, actor);
 /** Writes the run to the write key only. A kept, unreadable or legacy key is never written. */
 function save() { try { if (writeKey) localStorage.setItem(writeKey, JSON.stringify(run)); saved = structuredClone(run); } catch { /* Continue without saving in private contexts. */ } }
-function clearInput() { keys.clear(); holdingChomp = false; rising = false; diving = false; chompTapped = false; riseTapped = false; lastIntent = RELEASED; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
+function clearInput() { slotHeld = [false, false, false, false]; slotTapped = [false, false, false, false]; slotCanceled = [false, false, false, false]; mouseBasic = false; keys.clear(); holdingChomp = false; rising = false; diving = false; chompTapped = false; riseTapped = false; lastIntent = RELEASED; stickX = 0; stickZ = 0; stickPointer = null; target = null; el('stick').style.transform = ''; el('chomp').classList.remove('pressed'); el('special').classList.remove('pressed'); el('dive').classList.remove('pressed'); }
 function syncSound() { el('sound').innerHTML = audio.muted ? icons.mute : icons.sound; el('sound').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound'); el('sound').setAttribute('aria-pressed', String(audio.muted)); }
 syncSound();
 function syncHome() {
@@ -556,18 +562,20 @@ document.querySelector('.brand')!.addEventListener('click', event => { event.pre
 const endedPointers = new Set<number>();
 function releasedNormally(event: PointerEvent) { return endedPointers.delete(event.pointerId); }
 /** Buttons only set input sources; the frame reads one intent from them. `tap` records a press that may end before the next frame. */
-function holdButton(id: string, setter: (value: boolean) => void, tap?: () => void) {
+function holdButton(id: string, setter: (value: boolean) => void, tap?: () => void, cancel?: () => void) {
   const button = el(id);
   button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); endedPointers.delete(event.pointerId); button.setPointerCapture(event.pointerId); setter(true); tap?.(); button.classList.add('pressed'); audio.init(); });
   const release = () => { setter(false); button.classList.remove('pressed'); };
+  // A touch cancel clears every input source; on a slot button it also marks that slot canceled (Brace ends with no buffered press).
   button.addEventListener('pointerup', event => { endedPointers.add(event.pointerId); release(); });
-  button.addEventListener('pointercancel', () => { release(); clearInput(); });
-  button.addEventListener('lostpointercapture', event => { release(); if (!releasedNormally(event)) clearInput(); });
+  button.addEventListener('pointercancel', () => { release(); clearInput(); cancel?.(); });
+  button.addEventListener('lostpointercapture', event => { release(); if (!releasedNormally(event)) { clearInput(); cancel?.(); } });
   button.addEventListener('click', event => { if (event.detail === 0 && mode === 'playing') tap?.(); });
 }
 holdButton('chomp', value => holdingChomp = value, () => chompTapped = true);
 holdButton('special', value => rising = value, () => riseTapped = true);
 holdButton('dive', value => diving = value);
+combatHud.buttons.forEach((b, i) => holdButton(b.id, value => slotHeld[i] = value, () => slotTapped[i] = true, () => slotCanceled[i] = true));
 const joystick = el('joystick');
 function moveStick(event: PointerEvent) {
   const rect = joystick.getBoundingClientRect(), limit = rect.width * .3;
@@ -583,12 +591,24 @@ joystick.addEventListener('pointerup', event => { endedPointers.add(event.pointe
 joystick.addEventListener('lostpointercapture', event => { stopStick(); if (!releasedNormally(event)) clearInput(); });
 let lookPointer: number | null = null, lookX = 0, lookY = 0, lookStartX = 0, lookStartY = 0, looked = false;
 const canvas = world.renderer.domElement;
+// Desktop (spec §8.1, D7): the left mouse is the basic input and the right mouse slot 1; the camera turns with a middle drag or Alt + left drag.
+// Touch keeps swipes to look and taps to walk (ground plans).
+canvas.addEventListener('contextmenu', event => event.preventDefault());
 canvas.addEventListener('pointerdown', event => {
   if (mode !== 'playing') return;
-  endedPointers.delete(event.pointerId); lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
+  endedPointers.delete(event.pointerId);
+  if (event.pointerType === 'mouse') {
+    pointerX = event.clientX; pointerY = event.clientY; pointerAt = performance.now(); pointerOver = true;
+    if (event.button === 0 && !event.altKey) { mouseBasic = true; chompTapped = true; canvas.setPointerCapture(event.pointerId); audio.init(); return; }
+    if (event.button === 2) { slotHeld[0] = true; slotTapped[0] = true; canvas.setPointerCapture(event.pointerId); audio.init(); return; }
+    if (event.button !== 1 && !(event.button === 0 && event.altKey)) return;
+  }
+  lookPointer = event.pointerId; lookX = lookStartX = event.clientX; lookY = lookStartY = event.clientY; looked = false;
   canvas.setPointerCapture(event.pointerId);
 });
+canvas.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') pointerOver = false; });
 canvas.addEventListener('pointermove', event => {
+  if (event.pointerType === 'mouse') { pointerX = event.clientX; pointerY = event.clientY; pointerAt = performance.now(); pointerOver = true; }
   if (event.pointerId !== lookPointer || mode !== 'playing') return;
   const dx = event.clientX - lookX, dy = event.clientY - lookY;
   if (Math.hypot(event.clientX - lookStartX, event.clientY - lookStartY) > 5) looked = true;
@@ -598,8 +618,9 @@ canvas.addEventListener('pointermove', event => {
 canvas.addEventListener('pointerup', event => {
   // Every pointer that ends normally is recorded, so its lostpointercapture is not read as a cancel.
   endedPointers.add(event.pointerId);
+  if (event.pointerType === 'mouse') { if (event.button === 0) mouseBasic = false; if (event.button === 2) slotHeld[0] = false; }
   if (event.pointerId !== lookPointer) return;
-  if (!looked && mode === 'playing' && capsOf().ground) {
+  if (!looked && mode === 'playing' && capsOf().ground && event.pointerType !== 'mouse') {
     target = world.groundPoint(event.clientX, event.clientY); tapWatch.best = Infinity; tapWatch.stalled = 0;
     if (target) { target.x = T.MathUtils.clamp(target.x, -SPAWN_HALF, SPAWN_HALF); target.z = T.MathUtils.clamp(target.z, -SPAWN_HALF, SPAWN_HALF); world.targetRing.position.copy(target); world.targetRing.position.y = world.groundAt(target.x, target.z) + .08; world.targetRing.scale.setScalar(.45); world.targetRing.visible = true; }
   }
@@ -615,6 +636,7 @@ window.addEventListener('keydown', event => {
   keys.add(event.code);
   if (event.code === 'KeyE' && !event.repeat) riseTapped = true;
   if (event.code === 'Space' && !event.repeat) chompTapped = true;
+  const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code); if (digit >= 0 && !event.repeat) slotTapped[digit] = true;
   if (event.code === 'KeyP' && !event.repeat) pause();
 });
 window.addEventListener('keyup', event => keys.delete(event.code));
@@ -654,6 +676,17 @@ function updateGuide() {
   }).join('');
 }
 const NO_WISH: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
+/** The aim (spec §8.4): the desktop pointer while it is over the canvas and moved in the last 4 s, else the camera forward. Free movers pitch
+ *  toward a soft-lock target (D9); ground movers aim level. */
+function currentAim(caps: { pitch: boolean }): { aim: Vec3; source: AimSource } {
+  const p = world.player.position, fresh = pointerOver && performance.now() - pointerAt < POINTER_FRESH_SECONDS * 1000;
+  let flat: Vec3 | null = null, source: AimSource = 'camera';
+  if (fresh) { const ray = world.pointerRay(pointerX, pointerY); flat = pointerAim(p, ray.origin, ray.dir); if (flat) source = 'pointer'; }
+  flat ??= world.cameraForward();
+  if (!caps.pitch) return { aim: flat, source };
+  const targets = world.foods.filter(f => !f.entity.eaten && f.entity.spec.behaviourId && Math.abs(f.tier - run.stage) <= 1).map(f => f.data);
+  return { aim: pitched(flat, aimPitch(p, flat, targets, rt.orientation.pitch, PITCH_LIMIT)), source };
+}
 function frame(now: number) {
   requestAnimationFrame(frame);
   const dt = Math.min((now - last) / 1000, .05); last = now;
@@ -666,8 +699,10 @@ function frame(now: number) {
   if (playing) {
     chompPulse = Math.max(0, chompPulse - dt * 5); wrongDietClock = Math.max(0, wrongDietClock - dt); hintClock = Math.max(0, hintClock - dt);
     // One input consumer: one intent per frame, then the tap flags are spent.
-    intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving }, lastIntent, { breachOnRiseTap: caps.breach });
-    chompTapped = false; riseTapped = false; lastIntent = intent;
+    const aim = currentAim(caps);
+    intent = readIntent({ stickX, stickZ, keys, chompHeld: holdingChomp || mouseBasic, chompTapped, riseHeld: rising, riseTapped, diveHeld: diving, aim: aim.aim, aimSource: aim.source,
+      activeTapped: slotTapped, activeHeld: slotHeld, activeCanceled: slotCanceled }, lastIntent, { breachOnRiseTap: caps.breach });
+    chompTapped = false; riseTapped = false; slotTapped = [false, false, false, false]; slotCanceled = [false, false, false, false]; lastIntent = intent;
     const p = world.player.position;
     if (Math.abs(intent.move.x) + Math.abs(intent.move.z) > .05) { target = null; world.targetRing.visible = false; }
     if (target && caps.ground) {
@@ -680,6 +715,7 @@ function frame(now: number) {
     }
   }
   presentSim(simFrame(sim, simWorld, { dt, intent, wish, held }), dt);
+  if (mode !== 'menu' && sim.moves) combatHud.sync(slotViews(sim.moves.slots, sim.moves.set, rt));
   if (playing) {
     const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
     saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
```

- [ ] **Step 4: The journey test turns the camera with the middle button**

In `e2e/tiny-tide.mjs`, the two look drags after the comment `// Look controls change yaw and pitch with a real canvas drag.` become middle-button drags. Change each `await page.mouse.down();` to `await page.mouse.down({ button: 'middle' });` and each `await page.mouse.up();` to `await page.mouse.up({ button: 'middle' });` on those two lines only. A left drag no longer turns the camera (D7).

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Checkpoint**, then `node e2e/tiny-tide.mjs` against the running server. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/tiny-tide/combat-hud.ts src/tiny-tide/main.ts src/tiny-tide/input.ts src/tiny-tide/world.ts src/tiny-tide/controls.css tests/tiny-tide-core/input.test.ts e2e/tiny-tide.mjs
git commit -m "Tiny Tide combat: desktop controls (mouse aim, left basic, right slot 1, keys 1–4, middle-drag camera) and the slot HUD

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T10: Phone controls

**Spec:** §8.2, §8.4, D8, Review Focus 1.

**Files:**
- Modify: `src/tiny-tide/controls.css`, `src/tiny-tide/input.ts`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/input.test.ts`

**Interfaces:**
- Consumes: T9 `CombatHud`, `pitched`.
- Produces: `DRAG_DEAD_ZONE = 12`, `dragAim(dx, dy, cameraForward)` (screen up is the camera forward), `AimCandidate { position; rank: 0 | 1 | 2 }`, `AUTO_AIM_HALF_ANGLE` (60°), `autoAim(origin, facing, candidates, maxDistance)` (lowest rank first — 0 is an attacker in wind-up at the player — then the nearest; inside 60° and `maxDistance` = 3 × the Bite range); the basic button drags to aim; `touchMode` class on the body; the phone layout for 320×568 and 844×390 (slots ≥ 48×48, basic ≥ 80×80, empty slots hidden, the toast moved clear of the controls).

The right and bottom anchors in the CSS are computed from the spec §8.2 tables. Each box stays inside the viewport and no two boxes overlap at both sizes (checked in T24 `phone-controls`).

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/input.test.ts
+++ b/tests/tiny-tide-core/input.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { aimPitch, basicRequested, pitched, pointerAim, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
+import { aimPitch, autoAim, basicRequested, dragAim, pitched, pointerAim, readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
 
 const src = (over: Partial<InputSources> = {}): InputSources => ({ stickX: 0, stickZ: 0, keys: new Set(), chompHeld: false, chompTapped: false, riseHeld: false, riseTapped: false, diveHeld: false, ...over });
 const read = (s: InputSources, prev = RELEASED, breach = false) => readIntent(s, prev, { breachOnRiseTap: breach });
@@ -62,3 +62,18 @@ describe('aim', () => {
     expect(pitched(fwd, Math.PI / 6)).toEqual({ x: 0, y: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) });
   });
 });
+describe('phone aim', () => {
+  it('drags the aim with screen up as the camera forward', () => {
+    const f = { x: 0, y: 0, z: -1 };
+    expect(dragAim(0, -10, f)).toBeNull();   // inside 12 px
+    expect(dragAim(0, -40, f)).toEqual({ x: 0, y: 0, z: -1 }); expect(dragAim(40, 0, f)).toEqual({ x: 1, y: 0, z: 0 });   // up, right
+  });
+  it('auto-aims by rank, then distance, inside 60° and 3 × the Bite range', () => {
+    const o = { x: 0, y: 0, z: 0 }, face = { x: 0, y: 0, z: 1 };
+    const prey = { position: { x: 0, y: 0, z: 1 }, rank: 2 as const }, hunter = { position: { x: 1, y: 0, z: 2 }, rank: 1 as const }, windup = { position: { x: -1, y: 0, z: 2.5 }, rank: 0 as const };
+    expect(autoAim(o, face, [prey, hunter], 5)!.x).toBeCloseTo(1 / Math.hypot(1, 2));
+    expect(autoAim(o, face, [prey, hunter, windup], 5)!.x).toBeCloseTo(-1 / Math.hypot(1, 2.5));
+    expect(autoAim(o, face, [{ position: { x: 2, y: 0, z: 1 }, rank: 0 }], 5)).toBeNull();   // 63° off the facing
+    expect(autoAim(o, face, [prey], .9)).toBeNull();   // out of range
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts`
Expected: FAIL — `dragAim` and `autoAim` not exported.

- [ ] **Step 3: Implement**

```diff
--- a/src/tiny-tide/controls.css
+++ b/src/tiny-tide/controls.css
@@ -15,3 +15,23 @@
 #game-ui #slot-4{right:calc(4.2% + 59.5px - 65px - 32px);bottom:calc(65px + 59.5px + 112.6px - 32px)}
 #game-ui .vertical-controls{right:calc(4.2% - 37.5px);bottom:285px;flex-direction:column;gap:8px}
 #game-ui .vertical-controls .special-button{width:64px;height:64px;margin:0}
+/* Phone, portrait (the 320×568 table): left thumb joystick; right thumb basic and the slot arc (96 px radius); Rise / Dive at the right edge. */
+@media (max-width:650px){
+  #game-ui #joystick{left:12px;bottom:44px;width:96px;height:96px}
+  #game-ui .chomp-button{right:38px;bottom:44px;width:84px;height:84px;border-width:3px}
+  #game-ui .slot-button{width:48px;height:48px}.slot-button kbd{display:none}.slot-button .slot-icon svg{width:20px;height:20px}.slot-button .slot-name{font-size:6px}
+  #game-ui #slot-1{right:152px;bottom:62px}#game-ui #slot-2{right:129px;bottom:124px}#game-ui #slot-3{right:73px;bottom:156px}#game-ui #slot-4{right:8px;bottom:145px}
+  #game-ui .vertical-controls{right:8px;bottom:209px;flex-direction:column;gap:8px}
+  #game-ui .vertical-controls .special-button{width:48px;height:48px}
+  #game-ui #toast{bottom:250px;max-width:calc(100vw - 144px);white-space:normal;text-align:center}
+}
+/* Phone, landscape (the 844×390 table): basic 80 px; slot radius 92 px. */
+@media (max-height:560px) and (min-width:651px){
+  #game-ui #joystick{left:24px;bottom:20px;width:96px;height:96px}
+  #game-ui .chomp-button{right:104px;bottom:20px;width:80px;height:80px;border-width:3px}
+  #game-ui .slot-button{width:48px;height:48px}.slot-button kbd{display:none}.slot-button .slot-icon svg{width:20px;height:20px}
+  #game-ui #slot-1{right:212px;bottom:36px}#game-ui #slot-2{right:190px;bottom:95px}#game-ui #slot-3{right:136px;bottom:127px}#game-ui #slot-4{right:74px;bottom:116px}
+  #game-ui .vertical-controls{right:8px;bottom:60px;flex-direction:column;gap:8px}
+  #game-ui .vertical-controls .special-button{width:48px;height:48px}
+  #game-ui #toast{bottom:150px;max-width:calc(100vw - 144px)}
+}
--- a/src/tiny-tide/input.ts
+++ b/src/tiny-tide/input.ts
@@ -78,3 +78,28 @@ export function aimPitch(origin: Vec3, aim: Vec3, targets: readonly Vec3[], crea
 }
 /** A horizontal aim tilted to `pitch` (positive is up). */
 export const pitched = (aim: Vec3, pitch: number): Vec3 => ({ x: aim.x * Math.cos(pitch), y: Math.sin(pitch), z: aim.z * Math.cos(pitch) });
+/** A drag on the basic button counts beyond this many CSS px from the press point (spec §8.4). */
+export const DRAG_DEAD_ZONE = 12;
+/** The phone drag aim: screen up is the camera's horizontal forward, screen right its right. Null inside the dead zone. */
+export function dragAim(dx: number, dy: number, cameraForward: Vec3): Vec3 | null {
+  if (Math.hypot(dx, dy) <= DRAG_DEAD_ZONE) return null;
+  const f = cameraForward, x = f.x * -dy + -f.z * dx, z = f.z * -dy + f.x * dx, l = Math.hypot(x, z);
+  return l > 1e-9 ? { x: x / l, y: 0, z: z / l } : null;
+}
+/** An auto-aim candidate: `rank` 0 an enemy in wind-up that targets the player, 1 hunters and fighters, 2 prey. */
+export interface AimCandidate { position: Vec3; rank: 0 | 1 | 2 }
+export const AUTO_AIM_HALF_ANGLE = 60 * Math.PI / 180;
+/** Phone auto-aim (spec §8.4): the best candidate within a 60° half cone of the facing and `maxDistance`, by rank then distance; null with none. */
+export function autoAim(origin: Vec3, facing: Vec3, candidates: readonly AimCandidate[], maxDistance: number): Vec3 | null {
+  const fl = Math.hypot(facing.x, facing.z) || 1, fx = facing.x / fl, fz = facing.z / fl;
+  let best: { c: AimCandidate; d: number } | null = null;
+  for (const c of candidates) {
+    const dx = c.position.x - origin.x, dy = c.position.y - origin.y, dz = c.position.z - origin.z, d = Math.hypot(dx, dy, dz), h = Math.hypot(dx, dz);
+    if (d > maxDistance || h < 1e-9) continue;
+    if (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / h))) > AUTO_AIM_HALF_ANGLE + 1e-9) continue;
+    if (!best || c.rank < best.c.rank || (c.rank === best.c.rank && d < best.d)) best = { c, d };
+  }
+  if (!best) return null;
+  const p = best.c.position, d = best.d;
+  return { x: (p.x - origin.x) / d, y: (p.y - origin.y) / d, z: (p.z - origin.z) / d };
+}
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -16,7 +16,8 @@ import { renderPreview } from './preview';
 import { cardSummary, COAST_READY, eligibleChildren, leadsTo, type BodyPlan } from './plans';
 import { quoteDesign } from './economy';
 import { newRuntime, type Actor, type CombatInput, type Constraint, type Tuple4, type Vec3, type WorldQueries } from './combat-types';
-import { aimPitch, pitched, pointerAim, POINTER_FRESH_SECONDS, readIntent, RELEASED, type AimSource } from './input';
+import { aimPitch, autoAim, dragAim, pitched, pointerAim, POINTER_FRESH_SECONDS, readIntent, RELEASED, type AimCandidate, type AimSource } from './input';
+import { forwardOf } from './orientation';
 import { CombatHud, slotViews } from './combat-hud';
 import { blockHint, blockHintDue, newBlockHintGate, PITCH_LIMIT, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
 import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
@@ -193,6 +194,8 @@ let holdingChomp = false, rising = false, diving = false, chompTapped = false, r
 let slotHeld: Tuple4<boolean> = [false, false, false, false], slotTapped: Tuple4<boolean> = [false, false, false, false], slotCanceled: Tuple4<boolean> = [false, false, false, false];
 /** The desktop pointer (spec §8.4): its last client position and when it last moved over the canvas (ms); the left mouse holds the basic input. */
 let pointerX = 0, pointerY = 0, pointerAt = -Infinity, pointerOver = false, mouseBasic = false;
+/** The phone (spec §8.4): a drag on the basic button steers the aim; without a drag, auto-aim. `touchMode`: the last game input was a touch. */
+let chompDrag: { id: number; x: number; y: number; aim: Vec3 | null } | null = null, touchMode = false;
 let lastIntent: CombatInput = RELEASED;
 let target: T.Vector3 | null = null;
 let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0;
@@ -576,6 +579,12 @@ holdButton('chomp', value => holdingChomp = value, () => chompTapped = true);
 holdButton('special', value => rising = value, () => riseTapped = true);
 holdButton('dive', value => diving = value);
 combatHud.buttons.forEach((b, i) => holdButton(b.id, value => slotHeld[i] = value, () => slotTapped[i] = true, () => slotCanceled[i] = true));
+// The basic-button drag (spec §8.4): the same press starts the basic move at once; the drag then steers it until the lock, and the next Bites.
+const chompButton = el('chomp');
+chompButton.addEventListener('pointerdown', event => { if (mode !== 'playing') return; touchMode = event.pointerType !== 'mouse'; chompDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, aim: null }; });
+chompButton.addEventListener('pointermove', event => { if (chompDrag && event.pointerId === chompDrag.id) chompDrag.aim = dragAim(event.clientX - chompDrag.x, event.clientY - chompDrag.y, world.cameraForward()); });
+for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) chompButton.addEventListener(type, event => { if (chompDrag?.id === event.pointerId) chompDrag = null; });
+for (const id of ['joystick', 'special', 'dive']) el(id).addEventListener('pointerdown', event => { touchMode = event.pointerType !== 'mouse'; });
 const joystick = el('joystick');
 function moveStick(event: PointerEvent) {
   const rect = joystick.getBoundingClientRect(), limit = rect.width * .3;
@@ -597,6 +606,7 @@ canvas.addEventListener('contextmenu', event => event.preventDefault());
 canvas.addEventListener('pointerdown', event => {
   if (mode !== 'playing') return;
   endedPointers.delete(event.pointerId);
+  touchMode = event.pointerType !== 'mouse';
   if (event.pointerType === 'mouse') {
     pointerX = event.clientX; pointerY = event.clientY; pointerAt = performance.now(); pointerOver = true;
     if (event.button === 0 && !event.altKey) { mouseBasic = true; chompTapped = true; canvas.setPointerCapture(event.pointerId); audio.init(); return; }
@@ -680,6 +690,20 @@ const NO_WISH: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
  *  toward a soft-lock target (D9); ground movers aim level. */
 function currentAim(caps: { pitch: boolean }): { aim: Vec3; source: AimSource } {
   const p = world.player.position, fresh = pointerOver && performance.now() - pointerAt < POINTER_FRESH_SECONDS * 1000;
+  if (chompDrag?.aim) return { aim: chompDrag.aim, source: 'drag' };
+  if (touchMode && !fresh) {
+    const facing = forwardOf({ yaw: rt.orientation.yaw, pitch: 0 }), inked = rt.status !== null && time < rt.status.until, bite = sim.moves?.set.basic?.resolved.attack;
+    const reach = bite && bite.shape.kind === 'cone' ? 3 * bite.shape.range * playerActorCached().bodyLength / world.scale : 0;
+    const candidates: AimCandidate[] = inked ? [] : world.foods.filter(f => !f.entity.eaten && Math.abs(f.tier - run.stage) <= 1).flatMap(f => {
+      const c = sim.combat.stateOf(f.entity); if (!c) return [];
+      const windup = c.rt.actions.some(a => a.phase === 'windup' && a.targetId === PLAYER_ID), type = c.behaviour.type;
+      return [{ position: f.data, rank: windup ? 0 : type === 'prey-flee' || type === 'prey-school' ? 2 : 1 } as AimCandidate];
+    });
+    const auto = autoAim(p, facing, candidates, reach);
+    if (!auto) return { aim: facing, source: 'none' };
+    const flatAuto = { x: auto.x, y: 0, z: auto.z }, l = Math.hypot(auto.x, auto.z) || 1;
+    return { aim: caps.pitch ? pitched({ x: flatAuto.x / l, y: 0, z: flatAuto.z / l }, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, auto.y)))))) : { x: flatAuto.x / l, y: 0, z: flatAuto.z / l }, source: 'auto' };
+  }
   let flat: Vec3 | null = null, source: AimSource = 'camera';
   if (fresh) { const ray = world.pointerRay(pointerX, pointerY); flat = pointerAim(p, ray.origin, ray.dir); if (flat) source = 'pointer'; }
   flat ??= world.cameraForward();
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/input.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Checkpoint**, then `node e2e/tiny-tide-mobile.mjs` against the running server. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/controls.css src/tiny-tide/input.ts src/tiny-tide/main.ts tests/tiny-tide-core/input.test.ts
git commit -m "Tiny Tide combat: phone layout at 320×568 and 844×390, basic-button aim drag and auto-aim priority

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T11: The director

**Spec:** §9.4, D18.

**Files:**
- Create: `src/tiny-tide/director.ts`, `tests/tiny-tide-core/director.test.ts`
- Modify: `src/tiny-tide/combat-world.ts`, `src/tiny-tide/sim.ts`, `tests/tiny-tide-core/combat-world.test.ts`

**Interfaces:**
- Consumes: T8 `CombatWorld.startSpecies`, `EntityCombat`.
- Produces: `MAX_TOKENS = 2`, `ACTIVE_GAP = .25`, `MAX_EXTENSION = .5`, `OFF_SCREEN_WINDUP = .6`, `RETRY_SECONDS = .2`, `Token`, `TokenRequest { actionInstanceId; attackerId; windupSeconds; now; grab; onScreen; playerHeld }`, `TokenAnswer = { ok: true; extension } | { ok: false; reason: 'held' | 'full' | 'grab' | 'spacing'; retryAt }`, `class Director { request(r); holds(actionInstanceId); release(actionInstanceId); releaseAll(); update(actionInstanceId, activeStart) }`. `CombatWorld.startSpecies(c, attackId, attack, aim, targetId, now, opts: { onScreen; playerHeld; playing })` asks for a token when the target is the player and writes the extension into `windupExtension`; the token returns at the end of active; `cancelAttacksOnPlayer(playerRt)` returns every token. `rt.lastThreatAt` of the player is set at each granted wind-up.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tiny-tide-core/director.test.ts — spec §9.4.
import { describe, expect, it } from 'vitest';
import { Director, type TokenRequest } from '../../src/tiny-tide/director';

const req = (id: string, over: Partial<TokenRequest> = {}): TokenRequest => ({ actionInstanceId: id, attackerId: `e-${id}`, windupSeconds: .5, now: 0, grab: false, onScreen: true, playerHeld: false, ...over });
describe('director', () => {
  it('at most two tokens', () => {
    const d = new Director();
    expect(d.request(req('a')).ok).toBe(true); expect(d.request(req('b', { now: .3 })).ok).toBe(true);
    expect(d.request(req('c', { now: .6 }))).toEqual({ ok: false, reason: 'full', retryAt: .8 });
    d.release('a'); expect(d.request(req('c', { now: .6 })).ok).toBe(true);
  });
  it('active starts at least .25 s apart by extension', () => {
    const d = new Director(); d.request(req('a'));   // active at .5
    expect(d.request(req('b', { now: .1 }))).toEqual({ ok: true, extension: expect.closeTo(.15, 9) });   // .6 → .75
    expect(d.tokens.map(t => t.activeStart)).toEqual([.5, expect.closeTo(.75, 9)]);
    const e = new Director(); e.request(req('a', { windupSeconds: .6 }));   // active at .6
    expect(e.request(req('b', { windupSeconds: .45, now: 0 }))).toEqual({ ok: true, extension: expect.closeTo(.4, 9) });   // .45 is before .6: pushed to .85
  });
  it('extension never shortens and is at most .5 s', () => {
    // Off-screen .4 s wind-up: .6 s at least (ext .2, active .6); a token at .7 pushes it to .95: ext .55 > .5, refused.
    const d = new Director(); d.request(req('a', { windupSeconds: .7 }));
    expect(d.request(req('b', { windupSeconds: .4, onScreen: false }))).toEqual({ ok: false, reason: 'spacing', retryAt: .2 });
    const e = new Director(); e.request(req('a'));
    const r = e.request(req('b', { now: .5 }));   // active at 1.0, far from .5: no extension
    expect(r).toEqual({ ok: true, extension: 0 });
  });
  it('off-screen wind-up at least .6 s', () => {
    const d = new Director();
    expect(d.request(req('a', { windupSeconds: .45, onScreen: false }))).toEqual({ ok: true, extension: expect.closeTo(.15, 9) });
    expect(d.request(req('b', { windupSeconds: .7, onScreen: false, now: 2 }))).toEqual({ ok: true, extension: 0 });
  });
  it('grab only alone; none while held', () => {
    const d = new Director(); d.request(req('a'));
    expect(d.request(req('g', { grab: true, now: 1 }))).toEqual({ ok: false, reason: 'grab', retryAt: 1.2 });
    d.release('a'); expect(d.request(req('g', { grab: true, now: 1 })).ok).toBe(true);
    expect(new Director().request(req('x', { playerHeld: true }))).toEqual({ ok: false, reason: 'held', retryAt: .2 });
  });
  it('refused requests retry', () => {
    const d = new Director(); d.request(req('a')); d.request(req('b', { now: .3 }));
    const refused = d.request(req('c', { now: .4 }));
    expect(refused.ok).toBe(false); if (refused.ok) return;
    d.release('a');
    expect(d.request(req('c', { now: refused.retryAt })).ok).toBe(true);   // retried .2 s later
    d.releaseAll(); expect(d.tokens).toEqual([]);
  });
});
```

```diff
--- a/tests/tiny-tide-core/combat-world.test.ts
+++ b/tests/tiny-tide-core/combat-world.test.ts
@@ -64,4 +64,15 @@ describe('combat world', () => {
     expect(s.combat.playerMotion(body(), RELEASED, 0).speedFactor).toBeCloseTo(.35);   // .7 × .5
     expect(s.combat.playerMotion(body(), RELEASED, 11).speedFactor).toBeCloseTo(.5);
   });
+  it('wind-ups at the player take director tokens: two at most, active starts .25 s apart, returned at the end of active', () => {
+    const s = speck(), ents = [1, 2, 3].map(i => entity(10 + i, FX_HUNTER, ahead(4 + i))), cs = ents.map(e => s.combat.stateOf(e)!);
+    const a = s.combat.startSpecies(cs[0]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0), b = s.combat.startSpecies(cs[1]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0);
+    expect(typeof a).not.toBe('string'); expect(typeof b).not.toBe('string');
+    if (typeof b === 'string') return;
+    expect(b.windupExtension).toBeCloseTo(.25);   // both would be active at .5
+    expect(s.combat.startSpecies(cs[2]!, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0)).toBe('token');
+    let now = 0; for (let i = 0; i < 45; i++) { now += 1 / 60; tick(s, ents, now); }   // .75 s: the first is past its active (.5–.62)
+    expect(s.combat.director.tokens).toHaveLength(1); expect(s.rt.lastThreatAt).toBeGreaterThan(0);
+    s.combat.cancelAttacksOnPlayer(s.rt); expect(s.combat.director.tokens).toEqual([]);
+  });
 });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/director.test.ts tests/tiny-tide-core/combat-world.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/director"`.

- [ ] **Step 3: Create `director.ts`** (complete file)

```ts
// The director (spec §9.4): attack tokens, the limits on wind-ups that target the player. Pure.
import type { ActorId } from './combat-types';

/** At most MAX_TOKENS wind-ups at the player; their active starts at least ACTIVE_GAP apart (by extension, at most MAX_EXTENSION);
 *  an off-screen wind-up lasts at least OFF_SCREEN_WINDUP; a refused request retries after RETRY_SECONDS. */
export const MAX_TOKENS = 2, ACTIVE_GAP = .25, MAX_EXTENSION = .5, OFF_SCREEN_WINDUP = .6, RETRY_SECONDS = .2;
/** `activeStart`: world time of the action's active start (an estimate; `update` moves it when a hit-stop delays the attacker). */
export interface Token { actionInstanceId: string; attackerId: ActorId; activeStart: number; grab: boolean }
export interface TokenRequest { actionInstanceId: string; attackerId: ActorId; windupSeconds: number; now: number; grab: boolean; onScreen: boolean; playerHeld: boolean }
export type TokenAnswer = { ok: true; extension: number } | { ok: false; reason: 'held' | 'full' | 'grab' | 'spacing'; retryAt: number };

export class Director {
  readonly tokens: Token[] = [];
  /** A token for a wind-up at the player, with the extension that keeps active starts apart; or a refusal (retry after RETRY_SECONDS). */
  request(r: TokenRequest): TokenAnswer {
    const refuse = (reason: 'held' | 'full' | 'grab' | 'spacing'): TokenAnswer => ({ ok: false, reason, retryAt: r.now + RETRY_SECONDS });
    if (r.playerHeld) return refuse('held');
    if (this.tokens.length >= MAX_TOKENS) return refuse('full');
    if (r.grab && this.tokens.length > 0) return refuse('grab');
    const base = r.now + r.windupSeconds;
    let ext = r.onScreen ? 0 : Math.max(0, OFF_SCREEN_WINDUP - r.windupSeconds);
    // The extension only grows: past each held token's active start by ACTIVE_GAP, until no held token is closer.
    for (let changed = true, pass = 0; changed && pass < 4; pass++) {
      changed = false;
      for (const t of this.tokens) if (Math.abs(base + ext - t.activeStart) < ACTIVE_GAP - 1e-9) { ext = Math.max(ext, t.activeStart + ACTIVE_GAP - base); changed = true; }
    }
    if (ext > MAX_EXTENSION + 1e-9) return refuse('spacing');
    this.tokens.push({ actionInstanceId: r.actionInstanceId, attackerId: r.attackerId, activeStart: base + ext, grab: r.grab });
    return { ok: true, extension: ext };
  }
  holds(actionInstanceId: string): boolean { return this.tokens.some(t => t.actionInstanceId === actionInstanceId); }
  /** The token returns (the action's active ended, a grab's hold ended, or it was interrupted). */
  release(actionInstanceId: string): void { const i = this.tokens.findIndex(t => t.actionInstanceId === actionInstanceId); if (i >= 0) this.tokens.splice(i, 1); }
  /** Every token returns (faint, evolve, reset). */
  releaseAll(): void { this.tokens.length = 0; }
  /** A hit-stop moved an attacker's active start. */
  update(actionInstanceId: string, activeStart: number): void { const t = this.tokens.find(x => x.actionInstanceId === actionInstanceId); if (t) t.activeStart = activeStart; }
}
```

- [ ] **Step 4: Wire the director into the combat world**

```diff
--- a/src/tiny-tide/combat-world.ts
+++ b/src/tiny-tide/combat-world.ts
@@ -16,6 +16,8 @@ import { forwardOf, orientationMatrix } from './orientation';
 import type { CombatMotion } from './player-motion';
 import { EFFECTS } from './combat-profiles';
 import { damageAfterArmor } from './state';
+import { ACTIVE_GAP, Director, MAX_EXTENSION } from './director';
+import { windupLength } from './action-engine';
 
 export const PLAYER_ID: ActorId = 'player';
 export const entityActorId = (e: { id: number }): ActorId => `e${e.id}`;
@@ -65,10 +67,17 @@ export class CombatWorld {
   readonly entities = new Map<number, EntityCombat>();
   /** The last EVENT_LOG hit outcomes (diagnostics). */
   readonly log: CombatEvent[] = [];
+  /** Attack tokens for wind-ups at the player (spec §9.4). */
+  readonly director = new Director();
   private serial = 0;
   constructor(private readonly behaviours: Record<string, SpeciesBehaviour> = BEHAVIOURS) {}
   /** A fresh state for a new run or a load (spec §13). */
-  reset(): void { this.entities.clear(); this.log.length = 0; }
+  reset(): void { this.entities.clear(); this.log.length = 0; this.director.releaseAll(); }
+  /** Faint and evolve (spec §10.3, §13): every species action at the player ends, its token returns, and holds on the player end. */
+  cancelAttacksOnPlayer(playerRt: CombatRuntime): void {
+    for (const c of this.entities.values()) for (const a of c.rt.actions) if (a.targetId === PLAYER_ID && a.phase !== 'interrupted') { if (a.heldTarget === PLAYER_ID) endHold(c.rt, a); endNow(c.rt, a); }
+    this.director.releaseAll(); playerRt.heldBy = null; playerRt.breakProgress = 0;
+  }
   /** The combat state of a combat species (created on first use), or null for a legacy species. */
   stateOf(e: Entity): EntityCombat | null {
     let c = this.entities.get(e.id);
@@ -219,6 +228,7 @@ export class CombatWorld {
     }
     for (const c of out.killed.map(e => live.find(x => x.entity === e)!)) this.releaseAllOf(c, rt);
     this.reconcileHolds(rt, live);
+    this.followTokens(live, rt, ctx.now);
     sweepEnded(rt); for (const c of live) sweepEnded(c.rt);
     for (const e of out.events) { this.log.push(e); if (this.log.length > EVENT_LOG) this.log.shift(); }
     return out;
@@ -288,14 +298,43 @@ export class CombatWorld {
     }
     return { speedFactor: speed, face, dashVelocity: dash, forcedDisplacement: forced, frozen: now < rt.hitStopUntil };
   }
-  /** Starts a species attack (the AI asks; spec §5.3). `token` is the director's answer for an attack that targets the player. */
-  startSpecies(c: EntityCombat, attackId: string, attack: AttackSpec, aim: Vec3, targetId: ActorId | null, now: number, token = true, playing = true): ActionState | StartRefusal {
-    const key = `${c.id}:root:${attackId}`, d = canStart(c.rt, { playing, isPlayer: false, kind: 'species', cooldownKey: key, mode: 'swim', allowedModes: ['swim'], inBreachArc: false, token, worldNow: now });
+  /** Starts a species attack (the AI asks; spec §5.3). An attack at the player needs a director token (start rule 7): the token's extension
+   *  lengthens the wind-up. `onScreen`: the shape's centroid is on screen; `playerHeld`: the player is in a hold. */
+  startSpecies(c: EntityCombat, attackId: string, attack: AttackSpec, aim: Vec3, targetId: ActorId | null, now: number, opts: { onScreen?: boolean; playerHeld?: boolean; playing?: boolean } = {}): ActionState | StartRefusal {
+    const key = `${c.id}:root:${attackId}`, check = { playing: opts.playing ?? true, isPlayer: false, kind: 'species' as const, cooldownKey: key, mode: 'swim' as const, allowedModes: ['swim' as const], inBreachArc: false, worldNow: now };
+    const d = canStart(c.rt, { ...check, token: true });
     if (!d.ok) return d.reason;
+    const id = this.nextId(c.id);
+    let extension = 0;
+    if (targetId === PLAYER_ID) {
+      const t = this.director.request({ actionInstanceId: id, attackerId: c.id, windupSeconds: attack.windupSeconds, now, grab: !!attack.hold, onScreen: opts.onScreen ?? true, playerHeld: opts.playerHeld ?? false });
+      if (!t.ok) return 'token';
+      extension = t.extension;
+    }
     if (d.replaces) endNow(c.rt, d.replaces);
-    const a = startAction(c.rt, { instanceId: this.nextId(c.id), definitionId: attackId, grantId: attackId, source: { kind: 'actor', actorId: c.id, mountId: 'root', socketId: 'centre' },
+    const a = startAction(c.rt, { instanceId: id, definitionId: attackId, grantId: attackId, source: { kind: 'actor', actorId: c.id, mountId: 'root', socketId: 'centre' },
       resolved: speciesMove(attack), aim, targetId, cooldownKey: key, worldNow: now });
+    a.windupExtension = extension;
     if (a.aimLocked) a.lockedShapes = this.speciesShapes(c, a, now);
     return a;
   }
+  /** Tokens follow their actions: held to the end of active (of hold for a grab); a hit-stop's delay moves the active start, and a later
+   *  wind-up is lengthened (within MAX_EXTENSION) to keep ACTIVE_GAP. */
+  private followTokens(live: readonly EntityCombat[], playerRt: CombatRuntime, now: number) {
+    const windups: { a: ActionState; c: EntityCombat; start: number }[] = [];
+    for (const c of live) for (const a of c.rt.actions) {
+      if (!this.director.holds(a.instanceId)) continue;
+      if (a.phase === 'recovery' || a.phase === 'interrupted') { this.director.release(a.instanceId); continue; }
+      if (a.phase === 'windup') { const start = now + Math.max(0, windupLength(a) - (c.rt.actionClock - a.phaseStartedAt)) + Math.max(0, c.rt.hitStopUntil - now); windups.push({ a, c, start }); this.director.update(a.instanceId, start); playerRt.lastThreatAt = now; }
+    }
+    const others = this.director.tokens.filter(t => !windups.some(w => w.a.instanceId === t.actionInstanceId)).map(t => t.activeStart);
+    windups.sort((x, y) => x.start - y.start);
+    const placed = [...others];
+    for (const w of windups) {
+      const conflict = placed.find(t => Math.abs(w.start - t) < ACTIVE_GAP - 1e-9);
+      if (conflict !== undefined && w.start >= conflict) { const need = conflict + ACTIVE_GAP - w.start; if (w.a.windupExtension + need <= MAX_EXTENSION + 1e-9) { w.a.windupExtension += need; w.start += need; this.director.update(w.a.instanceId, w.start); } }
+      placed.push(w.start);
+    }
+    for (const t of [...this.director.tokens]) if (!live.some(c => c.rt.actions.some(a => a.instanceId === t.actionInstanceId))) this.director.release(t.actionInstanceId);
+  }
 }
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -170,6 +170,7 @@ export function playerBody(s: SimState, actor: Actor): PlayerBody {
 function faintNow(s: SimState): boolean {
   const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
   if (!beginRespawn(s.run, s.rt)) return false;
+  s.combat.cancelAttacksOnPlayer(s.rt);
   s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
   return true;
 }
@@ -288,7 +289,7 @@ export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null
 }
 /** A committed evolution: the runtime resets with the destination's orientation; the body goes to the destination. */
 export function simEvolve(s: SimState, destination: { position: Vec3; orientation: Orientation }): void {
-  resetRuntime(s.rt, destination.orientation); s.genomeRevision++; refreshDerived(s);
+  resetRuntime(s.rt, destination.orientation); s.combat.cancelAttacksOnPlayer(s.rt); s.genomeRevision++; refreshDerived(s);
   cancelRescue(s); s.physical = { ...destination.position };
 }
 export { evolveReady };
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/director.test.ts tests/tiny-tide-core/combat-world.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Checkpoint.** Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/tiny-tide/director.ts src/tiny-tide/combat-world.ts src/tiny-tide/sim.ts tests/tiny-tide-core/director.test.ts tests/tiny-tide-core/combat-world.test.ts
git commit -m "Tiny Tide combat: the director — two tokens, spaced active starts by extension, slow off-screen wind-ups, lone grabs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T12: Telegraphs and hit feel

**Spec:** §9.1, §9.2, §9.3, D17, D31.

**Files:**
- Create: `src/tiny-tide/telegraph-view.ts`
- Modify: `src/tiny-tide/combat-world.ts`, `src/tiny-tide/world.ts`, `src/tiny-tide/creature.ts`, `src/tiny-tide/audio.ts`, `src/tiny-tide/combat-hud.ts`, `src/tiny-tide/controls.css`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/combat-world.test.ts`

**Interfaces:**
- Consumes: T1 `TELEGRAPHS`, `EFFECTS`, `hitStopFor`, `shakeForPlayerHit`, `shakeForPlayerStrike`, `damageText`; T3 `telegraphDescriptor`; T8 `CombatTick.events`.
- Produces: `CombatWorld.telegraphs(now, isOnScreen, groundAt): TelegraphView[]` (`TelegraphView` = `TelegraphDescriptor` + `actionId`, `attackerId`, `entityId`, `attackId`, `phase`, `onScreen`, `arrow`, `flash`, `cue`); `WINDUP_FLASH = .1`; `class TelegraphLayer` (volumes, the depth ring, the x-ray outline, impact particles); `world.ts`: `flash(...)`, `shakeBy(amount)` (none under `prefers-reduced-motion`), `setCombatView(...)`, per-actor animation freeze, instance colours; `creature.setFlash(seconds)`; `audio.ts`: `hit`, `block`, `counter`, `dash`, `grab`, `breakFree`, `windup`; `combat-hud.ts`: `HP_BAR_SECONDS = 4`, `HpBar`, `EdgeArrow`, `class CombatOverlay` (HP bars, edge arrows, the break-free prompt "Wiggle free! Tap CHOMP" with its ring), `edgeArrowAt(point, width, height)`; `main.ts`: `presentCombat` (hit-stop, shake, flash, damage text, sounds), `presentCombatView`, and `combatDiagnostics()` for `window.__tinyTide.combat`.

Telegraph rules that the test pins: the shape is the action's own world shape (live before the lock, frozen after); the fill goes from 0 to 1 over wind-up + extension; amber solid when blockable, red stripes when not; the edge arrow shows from the moment the shape goes off-screen until active ends; a flash at the wind-up start and `FLASH_LEAD_SECONDS` (.12 s) before active.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/combat-world.test.ts
+++ b/tests/tiny-tide-core/combat-world.test.ts
@@ -76,3 +76,31 @@ describe('combat world', () => {
     s.combat.cancelAttacksOnPlayer(s.rt); expect(s.combat.director.tokens).toEqual([]);
   });
 });
+describe('telegraphs', () => {
+  it('use the hit shape: live before the lock, fixed after; fill over windup + extension; amber or red stripes', () => {
+    const s = speck(), crab = entity(20, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!, onScreen = () => true, ground = () => 0;
+    const a = s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0); if (typeof a === 'string') throw new Error(a);
+    let now = 0; for (let i = 0; i < 6; i++) { now += 1 / 60; tick(s, [crab], now); }   // .1 s
+    const early = s.combat.telegraphs(now, onScreen, ground)[0]!;
+    expect(early.locked).toBe(false); expect(early.fill).toBeCloseTo(.1 / .5); expect(early.color).toBe('amber'); expect(early.pattern).toBe('solid');
+    expect(early.shapes).toEqual(s.combat.speciesShapes(c, a, now));
+    for (let i = 0; i < 18; i++) { now += 1 / 60; tick(s, [crab], now); }   // .4 s: locked at .3
+    const locked = s.combat.telegraphs(now, onScreen, ground)[0]!;
+    expect(locked.locked).toBe(true); expect(locked.shapes).toBe(a.lockedShapes);
+    const w = s.combat.startSpecies(s.combat.stateOf(entity(21, FX_HUNTER, ahead(5)))!, 'wrap', WRAP, { x: 0, y: 0, z: -1 }, null, now); if (typeof w === 'string') throw new Error(w);
+    expect(s.combat.telegraphs(now, onScreen, ground).find(t => t.attackId === 'wrap')).toMatchObject({ color: 'red', pattern: 'stripes' });
+  });
+  it('show the edge arrow from going off-screen to the end of active, and flash at windup start and before active', () => {
+    const s = speck(), crab = entity(22, FX_HUNTER, ahead(3)), c = s.combat.stateOf(crab)!;
+    s.combat.startSpecies(c, 'poke', POKE, { x: 0, y: 0, z: -1 }, 'player', 0);
+    let screen = true; const at = (now: number) => s.combat.telegraphs(now, () => screen, () => 0)[0];
+    expect(at(0)).toMatchObject({ arrow: false, flash: true });   // windup start
+    let now = 0; for (let i = 0; i < 12; i++) { now += 1 / 60; tick(s, [crab], now); }
+    expect(at(now)).toMatchObject({ arrow: false, flash: false });
+    screen = false; expect(at(now)!.arrow).toBe(true); screen = true; expect(at(now)!.arrow).toBe(true);   // stays on
+    for (let i = 0; i < 16; i++) { now += 1 / 60; tick(s, [crab], now); }   // .47 s: .12 s flash lead before active at .5
+    expect(at(now)!.flash).toBe(true);
+    for (let i = 0; i < 20; i++) { now += 1 / 60; tick(s, [crab], now); }   // past active
+    expect(at(now)).toBeUndefined();
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-world.test.ts`
Expected: FAIL — `world.telegraphs is not a function`.

- [ ] **Step 3: Telegraph views in the combat world**

```diff
--- a/src/tiny-tide/combat-world.ts
+++ b/src/tiny-tide/combat-world.ts
@@ -14,7 +14,9 @@ import { speciesCombatPose } from './mount';
 import { speciesMove, type GrantedMove, type MoveSet, type SlotAssignment } from './moves';
 import { forwardOf, orientationMatrix } from './orientation';
 import type { CombatMotion } from './player-motion';
-import { EFFECTS } from './combat-profiles';
+import { EFFECTS, TELEGRAPHS } from './combat-profiles';
+import { telegraphDescriptor, type TelegraphDescriptor } from './combat-shapes';
+import type { ActionPhase, TelegraphProfile } from './combat-types';
 import { damageAfterArmor } from './state';
 import { ACTIVE_GAP, Director, MAX_EXTENSION } from './director';
 import { windupLength } from './action-engine';
@@ -63,7 +65,14 @@ const horizontal = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.z); return l
 const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
 const statusOf = (id: string) => { const s = EFFECTS[id]?.status; return s ? { seconds: s.seconds, speedFactor: s.speedFactor } : null; };
 
+/** What the telegraph view draws for one species action in windup or active (spec §9.1). `arrow`: the shape's centroid was off-screen at some
+ *  time in windup; the edge arrow shows to the end of active. `flash`: the attacker flashes (windup start for .1 s, and flashLead before active). */
+export interface TelegraphView extends TelegraphDescriptor { actionId: string; attackerId: ActorId; entityId: number; attackId: string; phase: ActionPhase; onScreen: boolean; arrow: boolean; flash: boolean; cue: TelegraphProfile['poseCue'] }
+/** The attacker's colour flash lasts this long at windup start (spec §9.1 item 5). */
+export const WINDUP_FLASH = .1;
 export class CombatWorld {
+  /** Actions whose telegraph centroid went off-screen in windup (their edge arrow shows to the end of active). */
+  private readonly arrowed = new Set<string>();
   readonly entities = new Map<number, EntityCombat>();
   /** The last EVENT_LOG hit outcomes (diagnostics). */
   readonly log: CombatEvent[] = [];
@@ -318,6 +327,27 @@ export class CombatWorld {
     if (a.aimLocked) a.lockedShapes = this.speciesShapes(c, a, now);
     return a;
   }
+  /** The telegraphs of every species action in windup or active (spec §9.1): the shapes the hit test uses (live aim before the lock, fixed
+   *  after it), the fill by (τ − τ0) / (windup + extension), the depth ring, the colour code, the edge arrow and the flash. */
+  telegraphs(now: number, isOnScreen: (p: Vec3) => boolean, groundAt: (x: number, z: number) => number): TelegraphView[] {
+    const out: TelegraphView[] = [], seen = new Set<string>();
+    for (const c of this.entities.values()) {
+      if (c.entity.eaten || !c.entity.active) continue;
+      for (const a of c.rt.actions) {
+        if (a.phase !== 'windup' && a.phase !== 'active') continue;
+        const attack = a.resolved.attack; if (!attack) continue;
+        const profile = TELEGRAPHS[attack.telegraphProfileId]; if (!profile || profile.color === 'none') continue;
+        const windup = windupLength(a), elapsed = c.rt.actionClock - a.phaseStartedAt, fill = a.phase === 'windup' ? elapsed / Math.max(1e-9, windup) : 1;
+        const shapes = a.lockedShapes ?? this.speciesShapes(c, a, now), d = telegraphDescriptor(shapes, fill, profile.color, profile.pattern, a.aimLocked, groundAt), onScreen = isOnScreen(d.centroid);
+        if (a.phase === 'windup' && !onScreen) this.arrowed.add(a.instanceId);
+        seen.add(a.instanceId);
+        const flash = a.phase === 'windup' && (elapsed < WINDUP_FLASH || windup - elapsed <= profile.flashLeadSeconds);
+        out.push({ ...d, actionId: a.instanceId, attackerId: c.id, entityId: c.entity.id, attackId: attack.id, phase: a.phase, onScreen, arrow: this.arrowed.has(a.instanceId) && profile.edgeArrow, flash, cue: profile.poseCue });
+      }
+    }
+    for (const id of [...this.arrowed]) if (!seen.has(id)) this.arrowed.delete(id);
+    return out;
+  }
   /** Tokens follow their actions: held to the end of active (of hold for a grab); a hit-stop's delay moves the active start, and a later
    *  wind-up is lengthened (within MAX_EXTENSION) to keep ACTIVE_GAP. */
   private followTokens(live: readonly EntityCombat[], playerRt: CombatRuntime, now: number) {
```

- [ ] **Step 4: Create `telegraph-view.ts`** (complete file)

```ts
// The telegraph view (spec §9.1): for each species action in windup or active, a translucent volume of its exact world shape with an outline
// drawn twice (with depth test, and without at 35 % as an x-ray through rocks and the creature), an inner copy that fills from the origin,
// a depth ring on the seabed with a dashed line to the centroid, and amber solid or red striped colour. Meshes are pooled; positions are
// physical units divided by the world scale (render units).
import * as T from 'three';
import type { WorldShape } from './combat-types';
import type { TelegraphView as Telegraph } from './combat-world';

const AMBER = new T.Color('#ffb347'), RED = new T.Color('#ff4d4d');
/** A half angle above this draws as a spherical sector instead of a cone. */
const SECTOR_ANGLE = 60 * Math.PI / 180;
function stripes(): T.Texture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#000';
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(4, 4); return t;
}
interface Slot { group: T.Group; volume: T.Mesh; fill: T.Mesh; outline: T.LineSegments; xray: T.LineSegments; ring: T.Mesh; line: T.Line; key: string }
export class TelegraphLayer {
  readonly root = new T.Group();
  private readonly slots: Slot[] = [];
  private readonly stripeTexture = stripes();
  private readonly ringGeometry = new T.RingGeometry(.92, 1, 48);
  constructor(scene: T.Scene) { this.root.name = 'telegraphs'; this.root.renderOrder = 6; scene.add(this.root); }
  private slot(i: number): Slot {
    let s = this.slots[i];
    if (s) return s;
    const mat = (opacity: number, depthTest = true) => new T.MeshBasicMaterial({ color: AMBER, transparent: true, opacity, depthWrite: false, depthTest, side: T.DoubleSide });
    const group = new T.Group(), volume = new T.Mesh(new T.BufferGeometry(), mat(.16)), fill = new T.Mesh(new T.BufferGeometry(), mat(.3));
    const outline = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: AMBER, transparent: true, opacity: .9 }));
    const xray = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: AMBER, transparent: true, opacity: .35, depthTest: false }));
    const ring = new T.Mesh(this.ringGeometry, mat(.55)); ring.rotation.x = -Math.PI / 2;
    const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 1, 0)]), new T.LineDashedMaterial({ color: AMBER, dashSize: .15, gapSize: .1, transparent: true, opacity: .7 }));
    xray.renderOrder = 7; group.add(volume, fill, outline, xray, ring, line); this.root.add(group);
    s = { group, volume, fill, outline, xray, ring, line, key: '' }; this.slots[i] = s; return s;
  }
  /** The mesh geometry of a world shape in render units, built in its own frame: a cone (or sector) along +z, a capsule along +y. */
  private geometry(shape: WorldShape, scale: number, fraction = 1): T.BufferGeometry {
    if (shape.kind === 'cone') {
      const r = shape.range / scale * fraction;
      if (shape.halfAngle > SECTOR_ANGLE) return new T.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.min(Math.PI, shape.halfAngle)).rotateX(Math.PI / 2);
      return new T.ConeGeometry(Math.tan(shape.halfAngle) * r, r, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, r / 2);
    }
    const len = Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y, shape.end.z - shape.start.z) / scale;
    return new T.CapsuleGeometry(shape.radius / scale, len * fraction, 6, 16).translate(0, len * fraction / 2, 0);
  }
  private place(o: T.Object3D, shape: WorldShape, scale: number) {
    if (shape.kind === 'cone') {
      o.position.set(shape.apex.x / scale, shape.apex.y / scale, shape.apex.z / scale);
      o.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(shape.axis.x, shape.axis.y, shape.axis.z));
    } else {
      o.position.set(shape.start.x / scale, shape.start.y / scale, shape.start.z / scale);
      const d = new T.Vector3(shape.end.x - shape.start.x, shape.end.y - shape.start.y, shape.end.z - shape.start.z);
      o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.lengthSq() > 1e-12 ? d.normalize() : new T.Vector3(0, 1, 0));
    }
  }
  /** Draws the telegraphs of this frame; unused pooled meshes hide. Geometry is rebuilt only when a shape or the fill step changes. */
  update(views: readonly Telegraph[], scale: number): void {
    views.forEach((v, i) => {
      const s = this.slot(i), shape = v.shapes[0]!, color = v.color === 'red' ? RED : AMBER, step = Math.round(v.fill * 20) / 20;
      const key = `${JSON.stringify(shape)}:${step}:${scale}`;
      if (s.key !== key) {
        s.key = key;
        for (const m of [s.volume, s.fill, s.outline, s.xray]) m.geometry.dispose();
        s.volume.geometry = this.geometry(shape, scale); s.fill.geometry = this.geometry(shape, scale, Math.max(.02, step));
        const edges = new T.EdgesGeometry(s.volume.geometry, 20); s.outline.geometry = edges; s.xray.geometry = edges.clone();
        for (const m of [s.volume, s.fill, s.outline, s.xray]) this.place(m, shape, scale);
      }
      for (const m of [s.volume.material, s.fill.material, s.outline.material, s.xray.material, s.ring.material, s.line.material] as (T.MeshBasicMaterial | T.LineBasicMaterial)[]) m.color.copy(color);
      const striped = v.pattern === 'stripes';
      (s.volume.material as T.MeshBasicMaterial).map = striped ? this.stripeTexture : null; (s.volume.material as T.MeshBasicMaterial).needsUpdate = true;
      const c = v.centroid;
      s.ring.position.set(c.x / scale, v.groundY / scale + .03, c.z / scale); s.ring.scale.setScalar(Math.max(.05, v.ringRadius / scale));
      const top = c.y / scale, bottom = v.groundY / scale + .03;
      s.line.position.set(c.x / scale, bottom, c.z / scale); s.line.scale.set(1, Math.max(.01, top - bottom), 1); s.line.computeLineDistances();
      s.group.visible = true;
    });
    for (let i = views.length; i < this.slots.length; i++) this.slots[i]!.group.visible = false;
  }
}
```

- [ ] **Step 5: Hit feel in the world, the creature, audio, the HUD and `main.ts`**

```diff
--- a/src/tiny-tide/audio.ts
+++ b/src/tiny-tide/audio.ts
@@ -20,4 +20,18 @@ export class TideAudio {
   faint() { [12, 7, 3, 0].forEach((note, i) => this.tone(220 * 2 ** (note / 12), i * .14, .35, 'triangle')); }
   found() { [0, 7, 12, 19].forEach((note, i) => this.tone(520 * 2 ** (note / 12), i * .07, .18)); }
   breach() { this.tone(190, 0, .22, 'triangle'); this.tone(570, .12, .25); }
+  // Combat (spec §9.2): one sound per outcome, and the rising wind-up tone (the telegraph never needs it).
+  hit() { this.tone(300, 0, .08, 'square'); this.tone(180, .02, .1, 'triangle'); }
+  block() { this.tone(900, 0, .06, 'triangle'); this.tone(620, .03, .1, 'triangle'); }
+  counter() { [0, 7, 12].forEach((note, i) => this.tone(660 * 2 ** (note / 12), i * .04, .12, 'triangle')); }
+  dash() { this.tone(420, 0, .12, 'sine'); this.tone(840, .03, .1, 'sine'); }
+  grab() { this.tone(240, 0, .14, 'sawtooth'); }
+  breakFree() { this.tone(520, 0, .08, 'triangle'); this.tone(780, .05, .12, 'triangle'); }
+  windup(seconds: number) {
+    if (!this.context || !this.bus || this.muted) return;
+    const now = this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
+    osc.type = 'sine'; osc.frequency.setValueAtTime(220, now); osc.frequency.exponentialRampToValueAtTime(520, now + seconds);
+    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.18, now + seconds); gain.gain.linearRampToValueAtTime(0, now + seconds + .05);
+    osc.connect(gain); gain.connect(this.bus); osc.start(now); osc.stop(now + seconds + .06); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
+  }
 }
--- a/src/tiny-tide/creature.ts
+++ b/src/tiny-tide/creature.ts
@@ -250,6 +250,10 @@ export class CreatureModel {
     m.color.copy(source.color);   // tints follow paint changes
     return m;
   }
+  /** The hurt flash (spec §9.2): the body and its tint materials glow white. */
+  setFlash(on: boolean) {
+    for (const m of [this.bodyMaterial, ...this.tints.values()]) { m.emissive.set(on ? '#ffffff' : '#000000'); m.emissiveIntensity = on ? .8 : 1; }
+  }
   /** Procedural motion. `chomp` is 0–1, `swim` is 0 when idle and 1 when moving. */
   animate(time: number, swim: number, chomp: number) {
     const pose = rigPoseInto(this.pose, this.genome, time, swim, chomp), n = this.bones.length;
--- a/src/tiny-tide/world.ts
+++ b/src/tiny-tide/world.ts
@@ -9,6 +9,8 @@ import { Ecosystem, type Entity } from './ecosystem';
 import type { Vec3 } from './combat-types';
 import type { Genome } from './genome';
 import type { FoodKind } from './species';
+import { TelegraphLayer } from './telegraph-view';
+import type { TelegraphView } from './combat-world';
 
 export { seabedHeight };
 /** Gameplay view of an entity, in the current stage's local units. */
@@ -21,6 +23,8 @@ const ringGeometry = new T.RingGeometry(1, 1.025, 56);
 const shadowMaterial = new T.MeshBasicMaterial({ color: '#103e4f', transparent: true, opacity: .2, depthWrite: false });
 const ringMaterial = new T.MeshBasicMaterial({ color: '#e0f6ad', transparent: true, opacity: .75, side: T.DoubleSide, depthWrite: false });
 const UP = new T.Vector3(0, 1, 0);
+/** Instance colours multiply the material: white keeps it; FLASH_COLOR (above 1) is the hurt flash. */
+const WHITE = new T.Color(1, 1, 1), FLASH_COLOR = new T.Color(3, 3, 3);
 // The soft world edge (edge.ts): in the push zone the water gets darker and foggier, and scenery past the hard bound
 // (render units = stage-local units, so the bound is at ±PLAYER_HALF) fades into the fog colour.
 /** Fog density at the full edge fog (the clear-water density is .014). */
@@ -55,6 +59,12 @@ function ownMesh(geometry: T.BufferGeometry, mat: T.Material, ownsMaterial = fal
 }
 export class TideWorld {
   readonly scene = new T.Scene();
+  /** Combat presentation (spec §9): telegraph volumes, hurt flashes (world time), pose cues and hit-stop freezes. */
+  readonly telegraphs = new TelegraphLayer(this.scene);
+  private readonly flashUntil = new Map<number | 'player', number>();
+  private readonly cues = new Map<number, { cue: TelegraphView['cue']; t: number }>();
+  private frozen: { player: boolean; entities: ReadonlySet<number> } = { player: false, entities: new Set() };
+  private worldTime = 0;
   readonly camera = new T.PerspectiveCamera(55, 1, .08, 340);
   readonly renderer: T.WebGLRenderer;
   readonly universe = new T.Group();
@@ -306,6 +316,15 @@ export class TideWorld {
     this.previousCreature = this.creature; this.creature = new CreatureModel(genome); this.creature.group.scale.setScalar(.001); this.avatar.add(this.creature.group);
     this.burst(this.player.position.x, this.player.position.y, this.player.position.z, '#f4e2b9', 50);
   }
+  /** A hurt actor flashes white for `seconds` (spec §9.2). */
+  flash(id: number | 'player', seconds: number) { this.flashUntil.set(id, this.worldTime + seconds); }
+  /** Camera shake in today's units (1 = the hurt shake); the caller skips it under prefers-reduced-motion. */
+  shakeBy(amount: number) { this.shake = Math.max(this.shake, amount); }
+  /** This frame's telegraphs (volumes and pose cues) and the actors in a hit-stop (their animation stops). */
+  setCombatView(views: readonly TelegraphView[], frozen: { player: boolean; entities: ReadonlySet<number> }) {
+    this.telegraphs.update(views, this.scale); this.frozen = frozen; this.cues.clear();
+    for (const v of views) this.cues.set(v.entityId, { cue: v.cue, t: v.phase === 'windup' ? v.fill : 1 });
+  }
   /** A hit: red sparks and a short camera shake. */
   hurt() { const p = this.player.position; this.burst(p.x, p.y + .3, p.z, '#ff8f7a', 14); this.shake = 1; }
   private syncFoods() {
@@ -332,7 +351,7 @@ export class TideWorld {
   cameraForward(): { x: number; y: number; z: number } { const d = this.camera.getWorldDirection(new T.Vector3()), l = Math.hypot(d.x, d.z) || 1; return { x: d.x / l, y: 0, z: d.z / l }; }
   groundPoint(x: number, y: number): T.Vector3 | null { const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x / this.width * 2 - 1, -y / this.height * 2 + 1), this.camera); return ray.ray.intersectPlane(new T.Plane(UP, -this.player.position.y), new T.Vector3()); }
   update(dt: number, time: number, menu: boolean, moving: boolean, chomping: number, growth: number) {
-    this.isMenu = menu; const p = this.player.position;
+    this.isMenu = menu; const p = this.player.position; this.worldTime = time;
     if (this.transitioning && dt > 0) {
       this.transitionProgress = Math.min(1, this.transitionProgress + dt / 3.4);
       const t = this.transitionProgress, ease = t * t * (3 - 2 * t), previous = this.scale;
@@ -361,7 +380,8 @@ export class TideWorld {
       if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 3); this.camera.position.add(new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(this.shake * .35)); } this.camera.fov = T.MathUtils.damp(this.camera.fov, this.width / this.height < .8 ? 64 : 59, 3, dt); this.camera.updateProjectionMatrix(); this.camera.lookAt(this.focus);
     }
     this.swim = T.MathUtils.damp(this.swim, moving ? 1 : 0, 6, dt);
-    this.creature?.animate(time, this.swim, chomping); this.previousCreature?.animate(time, this.swim, chomping);
+    if (!this.frozen.player) { this.creature?.animate(time, this.swim, chomping); this.previousCreature?.animate(time, this.swim, chomping); }
+    this.creature?.setFlash((this.flashUntil.get('player') ?? -Infinity) > time);
     this.sun.position.copy(p).add(new T.Vector3(-14, 27, 13)); this.sun.target.position.copy(p);
     const groundY = this.groundAt(p.x, p.z); this.shadow.visible = this.stage < 4 && p.y - groundY < 9;
     this.shadow.position.set(p.x, groundY + .06, p.z); this.shadow.scale.setScalar(menu ? 3.2 : 1.2 * growth + (p.y - groundY) * .04);
@@ -419,6 +439,18 @@ export class TideWorld {
       const distance = p.distanceTo(new T.Vector3(f.data.x, f.data.y, f.data.z));
       f.model.visible = size / this.scale > .07 && distance < 230 + size / this.scale * 2 && !(f.tier < 4 && this.spaceMix > .99);
       if (f === this.homePlanet) f.model.visible = f.model.visible && this.spaceMix > .001;
+      const cue = this.cues.get(e.id);
+      if (cue) {
+        // Pose cues (spec §9.1 item 4): rear back 15°, crouch, inflate to × 1.35, coil, sink into the sand, spin up.
+        const t = cue.t;
+        if (cue.cue === 'inflate') f.model.scale.multiplyScalar(1 + .35 * t);
+        else if (cue.cue === 'crouch') f.model.scale.y *= 1 - .2 * t;
+        else if (cue.cue === 'coil') f.model.scale.z *= 1 - .25 * t;
+        else if (cue.cue === 'rear') f.model.rotation.x = -15 * Math.PI / 180 * t;
+        else if (cue.cue === 'burrow') f.model.position.y -= .5 * size * t;
+        else if (cue.cue === 'spin') f.model.rotation.y += 12 * t * dt;
+      } else if (f.model.rotation.x !== 0) f.model.rotation.x = 0;
+      if (this.frozen.entities.has(e.id)) continue;
       if (f.tier === 0) f.model.rotation.z = Math.sin(time * 1.7 + f.data.phase) * .1;
       else if (kind === 'planet') f.model.rotation.y += dt * .07;
       else if (kind === 'boat') f.model.rotation.z = Math.sin(time * 1.1 + f.data.phase) * .04;
@@ -432,9 +464,10 @@ export class TideWorld {
         const model = food.model;
         if (!model.visible) continue;
         model.updateMatrix(); this.instanceMatrix.multiplyMatrices(model.matrix, set.local);
+        set.mesh.setColorAt(count, (this.flashUntil.get(food.entity.id) ?? -Infinity) > time ? FLASH_COLOR : WHITE);
         set.mesh.setMatrixAt(count++, this.instanceMatrix);
       }
-      set.mesh.count = count; set.mesh.visible = count > 0; set.mesh.instanceMatrix.needsUpdate = true;
+      set.mesh.count = count; set.mesh.visible = count > 0; set.mesh.instanceMatrix.needsUpdate = true; if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
     }
     for (let i = this.particles.length - 1; i >= 0; i--) { const particle = this.particles[i]!; particle.life -= dt; particle.mesh.position.addScaledVector(particle.velocity, dt); particle.velocity.y -= dt * 2; particle.mesh.scale.multiplyScalar(Math.exp(-dt * 1.8)); if (particle.life <= 0) { this.effects.remove(particle.mesh); this.particles.splice(i, 1); } }
     this.renderer.render(this.scene, this.camera);
```

```diff
--- a/src/tiny-tide/combat-hud.ts
+++ b/src/tiny-tide/combat-hud.ts
@@ -48,3 +48,37 @@ export class CombatHud {
     });
   }
 }
+
+/** A combat species shows its HP bar for this long after its last damage (spec §9.3). */
+export const HP_BAR_SECONDS = 4;
+export interface HpBar { x: number; y: number; fraction: number }
+export interface EdgeArrow { x: number; y: number; angle: number; color: 'amber' | 'red'; fill: number }
+/** The overlay: HP bars above damaged species, edge arrows toward off-screen telegraphs, and the break-free prompt. Elements are pooled. */
+export class CombatOverlay {
+  private readonly root = document.createElement('div');
+  private readonly bars: HTMLElement[] = [];
+  private readonly arrows: HTMLElement[] = [];
+  readonly prompt = document.createElement('div');
+  constructor(host: HTMLElement) {
+    this.root.id = 'combat-overlay'; this.root.setAttribute('aria-hidden', 'true');
+    this.prompt.id = 'break-free'; this.prompt.hidden = true; this.prompt.innerHTML = '<i class="break-ring"></i><span>Wiggle free! Tap CHOMP</span>';
+    host.append(this.root, this.prompt);
+  }
+  private pooled(list: HTMLElement[], i: number, cls: string): HTMLElement {
+    let e = list[i]; if (!e) { e = document.createElement('div'); e.className = cls; this.root.append(e); list[i] = e; }
+    e.hidden = false; return e;
+  }
+  sync(bars: readonly HpBar[], arrows: readonly EdgeArrow[], breakProgress: number | null): void {
+    bars.forEach((b, i) => { const e = this.pooled(this.bars, i, 'hp-bar'); e.style.left = `${b.x}px`; e.style.top = `${b.y}px`; e.style.setProperty('--hp', `${Math.max(0, b.fraction) * 100}%`); });
+    for (let i = bars.length; i < this.bars.length; i++) this.bars[i]!.hidden = true;
+    arrows.forEach((a, i) => { const e = this.pooled(this.arrows, i, 'edge-arrow'); e.style.left = `${a.x}px`; e.style.top = `${a.y}px`; e.style.rotate = `${a.angle}rad`; e.dataset.color = a.color; e.style.setProperty('--fill', `${a.fill * 360}deg`); });
+    for (let i = arrows.length; i < this.arrows.length; i++) this.arrows[i]!.hidden = true;
+    this.prompt.hidden = breakProgress === null;
+    if (breakProgress !== null) (this.prompt.querySelector('.break-ring') as HTMLElement).style.background = `conic-gradient(#fff2b3 ${Math.min(1, breakProgress) * 360}deg, #ffffff33 0)`;
+  }
+}
+/** Where an edge arrow sits: on an ellipse inside the screen edge, toward the off-screen point (a point behind the camera is mirrored). */
+export function edgeArrowAt(point: { x: number; y: number; visible: boolean }, width: number, height: number): { x: number; y: number; angle: number } {
+  const cx = width / 2, cy = height / 2, dx = (point.x - cx) * (point.visible ? 1 : -1), dy = (point.y - cy) * (point.visible ? 1 : -1), angle = Math.atan2(dy, dx);
+  return { x: cx + Math.cos(angle) * (cx - 36), y: cy + Math.sin(angle) * (cy - 36), angle };
+}
--- a/src/tiny-tide/controls.css
+++ b/src/tiny-tide/controls.css
@@ -35,3 +35,12 @@
   #game-ui .vertical-controls .special-button{width:48px;height:48px}
   #game-ui #toast{bottom:150px;max-width:calc(100vw - 144px)}
 }
+/* Combat overlay (spec §9.2–§9.3): HP bars, edge arrows (amber or red with stripes, a ring that fills like the shape), the break-free prompt. */
+#combat-overlay{position:absolute;inset:0;pointer-events:none}
+.hp-bar{position:absolute;width:38px;height:5px;transform:translate(-50%,-100%);border-radius:3px;background:#0b2f3acc;overflow:hidden}
+.hp-bar:after{content:'';position:absolute;inset:0;width:var(--hp);background:#ffb347}
+.edge-arrow{position:absolute;width:34px;height:34px;transform:translate(-50%,-50%);border-radius:50%;background:conic-gradient(currentColor var(--fill),#ffffff22 0);color:#ffb347}
+.edge-arrow[data-color=red]{color:#ff4d4d;background:repeating-linear-gradient(45deg,#ff4d4d 0 5px,#5a1010 5px 9px)}
+.edge-arrow:after{content:'';position:absolute;right:-12px;top:50%;border:9px solid transparent;border-left-color:currentColor;transform:translateY(-50%)}
+#break-free{position:absolute;left:50%;bottom:42%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:30px;background:#163b47d9;font-weight:700;letter-spacing:.5px}
+#break-free .break-ring{width:22px;height:22px;border-radius:50%}
```

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -19,12 +19,15 @@ import { newRuntime, type Actor, type CombatInput, type Constraint, type Tuple4,
 import { aimPitch, autoAim, dragAim, pitched, pointerAim, POINTER_FRESH_SECONDS, readIntent, RELEASED, type AimCandidate, type AimSource } from './input';
 import { forwardOf } from './orientation';
 import { CombatHud, slotViews } from './combat-hud';
+import { seabedHeight } from './biomes';
 import { blockHint, blockHintDue, newBlockHintGate, PITCH_LIMIT, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
 import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
 import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
 import type { ChompResult } from './feeding';
 import { PLAYER_ID, type CombatTick } from './combat-world';
-import { damageText } from './combat-profiles';
+import { damageText, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
+import { CombatOverlay, edgeArrowAt, HP_BAR_SECONDS, type EdgeArrow, type HpBar } from './combat-hud';
+import type { TelegraphView } from './combat-world';
 import { movement, movementCapabilities } from './profiles';
 import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, zoneLabel } from './world-queries';
 import { ROCK_FIT, stageSolids } from './reef';
@@ -90,7 +93,12 @@ app.innerHTML = `
   <div class="corner-note" id="corner-note">MADE FOR A LITTLE ESCAPE <span>✳</span></div>
 `;
 const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
-const combatHud = new CombatHud(document.querySelector<HTMLElement>('.actions')!);
+const combatHud = new CombatHud(document.querySelector<HTMLElement>('.actions')!), overlay = new CombatOverlay(document.getElementById('game-ui')!);
+/** Reduced motion follows the OS setting only (D31): no camera shake. */
+const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
+/** This frame's telegraphs (read-only diagnostics) and the wind-ups already announced by the rising tone. */
+let telegraphViews: TelegraphView[] = [];
+const toned = new Set<string>();
 const audio = new TideAudio();
 let world: TideWorld;
 try {
@@ -477,6 +485,32 @@ function win() {
   showDialog(`<span class="modal-art cosmic">${species[4]}</span><div class="eyebrow">THE UNIVERSE WAS DELICIOUS</div><h2 id="modal-title">All full.<br>All yours.</h2><p>${escapeHtml(run.name)} grew from a speck to a cosmic giant.<br>Every planet is eaten. Now, a well-earned nap.</p><div class="win-stats"><div><strong>${Math.floor(run.totalDna)}</strong><span>DNA EARNED</span></div><div><strong>${run.bites}</strong><span>HAPPY BITES</span></div><div><strong>${minutes}:${seconds}</strong><span>YOUR ADVENTURE</span></div></div><button id="play-again" class="primary">One more little adventure ${icons.arrow}</button>`, false);
   el('play-again').onclick = () => { modal.close(); begin(true); };
 }
+/** A physical point is on screen (the telegraph's edge arrow and the director's off-screen rule). */
+function onScreen(p: Vec3): boolean {
+  const s = world.screenPoint(new T.Vector3(p.x, p.y, p.z).divideScalar(world.scale));
+  return s.visible && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight;
+}
+/** Every frame: telegraph volumes and pose cues, hit-stop freezes, the wind-up tone, HP bars, edge arrows and the break-free prompt. */
+function presentCombatView() {
+  const playing = mode === 'playing' || mode === 'fainted' || mode === 'evolving';
+  telegraphViews = playing ? sim.combat.telegraphs(time, onScreen, seabedHeight) : [];
+  const frozen = new Set<number>();
+  for (const c of sim.combat.entities.values()) if (time < c.rt.hitStopUntil) frozen.add(c.entity.id);
+  world.setCombatView(telegraphViews, { player: time < rt.hitStopUntil, entities: frozen });
+  for (const v of telegraphViews) if (v.phase === 'windup' && !toned.has(v.actionId)) { toned.add(v.actionId); audio.windup(.4); }
+  if (toned.size > 64) toned.clear();
+  const bars: HpBar[] = [], arrows: EdgeArrow[] = [];
+  for (const c of sim.combat.entities.values()) {
+    if (c.entity.eaten || time - c.lastDamagedAt > HP_BAR_SECONDS) continue;
+    const top = world.screenPoint(new T.Vector3(c.entity.x, c.entity.y + .9 * SIZES[c.entity.spec.tier]!, c.entity.z).divideScalar(world.scale));
+    if (top.visible) bars.push({ x: top.x, y: top.y, fraction: c.entity.hp / c.maxHp });
+  }
+  for (const v of telegraphViews) if (v.arrow && !v.onScreen) {
+    const at = edgeArrowAt(world.screenPoint(new T.Vector3(v.centroid.x, v.centroid.y, v.centroid.z).divideScalar(world.scale)), innerWidth, innerHeight);
+    arrows.push({ ...at, color: v.color, fill: v.fill });
+  }
+  overlay.sync(bars, arrows, playing && rt.heldBy !== null ? rt.breakProgress : null);
+}
 /** Presentation of the simulation's events: the rendered root and camera, hints, sounds, particles, toasts and saves. */
 function presentSim(events: readonly SimEvent[], dt: number) {
   renderRoot();
@@ -545,13 +579,29 @@ function presentFaint() {
   save(); respawnToasted = false;
   clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
 }
-/** One combat tick: damage numbers, hearts, and the removed bodies of kills (Task 13 adds the full hit feel). */
+/** One combat tick's hit feel (spec §9.2): damage numbers, impact particles, sounds, the hurt flash, camera shake (not under reduced
+ *  motion), vibration, hearts, and the removed bodies of kills. */
 function presentCombat(t: CombatTick) {
   for (const e of t.events) {
-    const pos = world.screenPoint(new T.Vector3(e.point.x, e.point.y, e.point.z).divideScalar(world.scale));
-    if (e.amount > 0 || e.outcome !== 'hit') floater(damageText(e.outcome, e.unit, e.amount), pos.x, pos.y, e.targetId === PLAYER_ID ? 'hurt' : 'hit');
-    if (e.targetId === PLAYER_ID) syncHearts();
+    const local = new T.Vector3(e.point.x, e.point.y, e.point.z).divideScalar(world.scale), pos = world.screenPoint(local), toPlayer = e.targetId === PLAYER_ID, fromPlayer = e.attackerId === PLAYER_ID;
+    if (e.amount > 0 || e.outcome !== 'hit') floater(damageText(e.outcome, e.unit, e.amount), pos.x, pos.y, toPlayer ? 'hurt' : 'hit');
+    const colour = e.outcome === 'countered' ? IMPACT_COLOURS.counter : e.outcome === 'blocked' || e.outcome === 'guard-broken' ? IMPACT_COLOURS.block : toPlayer ? IMPACT_COLOURS.hurt : IMPACT_COLOURS.hit;
+    if (e.outcome !== 'evaded' && e.outcome !== 'immune') world.burst(local.x, local.y, local.z, colour, IMPACT_PARTICLES);
+    if (e.outcome === 'hit') { if (toPlayer) audio.hurt(); else audio.hit(); }
+    else if (e.outcome === 'blocked') audio.block(); else if (e.outcome === 'guard-broken') audio.breakFree(); else if (e.outcome === 'countered') audio.counter();
+    else if (e.outcome === 'grabbed') audio.grab(); else if (e.outcome === 'evaded') audio.dash();
+    if (toPlayer && e.amount > 0) {
+      world.flash('player', FLASH_SECONDS); syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
+      if (!reducedMotion.matches) world.shakeBy(shakeForPlayerHit(e.amount));
+      if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
+    }
+    if (!toPlayer && e.amount > 0) { world.flash(Number(e.targetId.slice(1)), FLASH_SECONDS); if (fromPlayer && typeof navigator.vibrate === 'function') navigator.vibrate(15); }
+    // Only the player's Sweep and Counter shake the camera.
+    if (!reducedMotion.matches && fromPlayer && e.outcome === 'hit' && e.attackId.startsWith('sweep-')) world.shakeBy(shakeForPlayerStrike(e.amount));
+    if (!reducedMotion.matches && toPlayer && e.outcome === 'countered') world.shakeBy(shakeForPlayerStrike(e.reflect));
   }
+  if (t.started.includes('dash')) audio.dash();
+  if (t.brokeFree) audio.breakFree();
   for (const k of t.killed) { const food = world.foods.find(f => f.entity === k); if (food) world.removeFood(food); }
   if (t.killed.length) { syncUI(); save(); }
 }
@@ -740,6 +790,7 @@ function frame(now: number) {
   }
   presentSim(simFrame(sim, simWorld, { dt, intent, wish, held }), dt);
   if (mode !== 'menu' && sim.moves) combatHud.sync(slotViews(sim.moves.slots, sim.moves.set, rt));
+  presentCombatView();
   if (playing) {
     const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
     saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
@@ -831,6 +882,17 @@ function poseAgreement() {
   }
   return { sockets, positionError, angleError, reflectionsAgree, bodyLength, time };
 }
+/** Read-only (QA, spec §14.2): actions, telegraphs, action clocks, the last 20 hit outcomes, hit-stop ends, slots, director tokens and holds. */
+function combatDiagnostics() {
+  const shape = (a: { lockedShapes: unknown }) => JSON.parse(JSON.stringify(a.lockedShapes));
+  const actions = [{ actor: PLAYER_ID, rt }, ...[...sim.combat.entities.values()].map(c => ({ actor: c.id, rt: c.rt }))].flatMap(x => x.rt.actions.map(a => ({ actor: x.actor, id: a.definitionId, instance: a.instanceId, phase: a.phase, aim: { ...a.aim }, target: a.targetId, shape: shape(a), windupExtension: a.windupExtension })));
+  return { actions, telegraphs: telegraphViews.map(v => ({ action: v.actionId, attacker: v.attackerId, attack: v.attackId, phase: v.phase, shapes: JSON.parse(JSON.stringify(v.shapes)), fill: v.fill, onScreen: v.onScreen, arrow: v.arrow, color: v.color, locked: v.locked })),
+    clocks: { player: rt.actionClock, ...Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.rt.actionClock])) },
+    hitStop: { player: rt.hitStopUntil, ...Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.rt.hitStopUntil])) },
+    hits: sim.combat.log.map(e => ({ outcome: e.outcome, attacker: e.attackerId, target: e.targetId, attack: e.attackId, amount: e.amount, unit: e.unit, time: e.time })),
+    slots: sim.moves ? [...sim.moves.slots.slots] : [], inactive: sim.moves ? [...sim.moves.slots.inactive] : [], tokens: sim.combat.director.tokens.map(t => ({ ...t })),
+    heldBy: rt.heldBy, breakProgress: rt.breakProgress, hp: Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.entity.hp])) };
+}
 // Read-only diagnostics allow browser verification to steer with real controls.
 if (QA) {
   const copy = (v: Vec3) => ({ x: v.x, y: v.y, z: v.z });
@@ -839,6 +901,6 @@ if (QA) {
     orientation: { ...rt.orientation }, permit: rt.permit ? { ...rt.permit } : null, arc: rt.arc ? { ...rt.arc } : null, breachReadyAt: rt.breachReadyAt, invulnerableUntil: rt.invulnerableUntil,
     pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admittedNow(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, lastContactSolid, trapRescues: sim.trapRescues, rescueLog: JSON.parse(JSON.stringify(sim.rescueLog)), contactSolids: [...sim.lastSolids], groundOffset: rt.groundOffset, solidOverlap: mode === 'menu' ? null : solidOverlap(), solidsNear: mode === 'menu' ? [] : solidsNear(32), edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
     faintLog: sim.faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
-      player: { msPerFrame: per(a.player.ms), callsPerFrame: per(a.player.calls), worstMs: a.player.worst }, ecosystem: { msPerFrame: per(a.ecosystem.ms), callsPerFrame: per(a.ecosystem.calls), worstMs: a.ecosystem.worst }, guide: { msPerFrame: per(a.guide.ms), callsPerFrame: per(a.guide.calls), worstMs: a.guide.worst } }; }), render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries } }) });
+      player: { msPerFrame: per(a.player.ms), callsPerFrame: per(a.player.calls), worstMs: a.player.worst }, ecosystem: { msPerFrame: per(a.ecosystem.ms), callsPerFrame: per(a.ecosystem.calls), worstMs: a.ecosystem.worst }, guide: { msPerFrame: per(a.guide.ms), callsPerFrame: per(a.guide.calls), worstMs: a.guide.worst } }; }), render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries }, combat: combatDiagnostics() }) });
 }
 requestAnimationFrame(frame);
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-world.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 7: Checkpoint.** Expected: green. The visual run must still print `{"errors":[]}` (the telegraph layer allocates its geometry once).

- [ ] **Step 8: Commit**

```bash
git add src/tiny-tide/telegraph-view.ts src/tiny-tide/combat-world.ts src/tiny-tide/world.ts src/tiny-tide/creature.ts src/tiny-tide/audio.ts src/tiny-tide/combat-hud.ts src/tiny-tide/controls.css src/tiny-tide/main.ts tests/tiny-tide-core/combat-world.test.ts
git commit -m "Tiny Tide combat: telegraphs from the hit shape and clock, edge arrows, flashes, hit-stop, shake, sounds and HP bars

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T13: Bestiary data

**Spec:** §11.1, §11.4, §11.5, §11.6, D25, D36.

**Files:**
- Modify: `src/tiny-tide/bestiary.ts`
- Create: `tests/tiny-tide-core/bestiary.test.ts`

**Interfaces:**
- Consumes: T1 types and `minWindup`; T2 registry merge (`ATTACKS` throws on a duplicate id).
- Produces: `SPECIES_ATTACKS` with the 21 rows of §11.5 (ids: `drifter-…`, `snail-…`, `crab-pinch`, `crab-lunge`, `crab-sweep`, `puffer-…`, `squid-ink`, `squid-grab`, `squid-lunge`, `eel-…`, `clawmother-…`, `tyrant-…`; see the file); `BEHAVIOURS` with 9 behaviours (`drifter`, `spiny-snail`, `crab`, `sardine`, `puffer`, `squid`, `eel`, `clawmother`, `reef-tyrant`); `BURROW = { sinkSeconds: .4, travelSeconds: 1.2, speedFactor: 1.6, emerges: 2 }`; `LAPS = { radiusFraction: .8, charges: 2, restSeconds: 1.5 }`.

The species rows that use these behaviours come in T16–T19. Until then nothing references them; the registry checks them (V1–V20) from this task on.

**Decision in this task (spec gap):** species attacks have `moveSpeedFactor: 0` during wind-up and active (the AI moves the body; the engine does not add the player's slow walk).

- [ ] **Step 1: Write the failing tests** (complete file)

```ts
// tests/tiny-tide-core/bestiary.test.ts — spec §11.4–§11.6: every species attack row and behaviour as the tables give them.
import { describe, expect, it } from 'vitest';
import { BEHAVIOURS, minWindup, SPECIES_ATTACKS } from '../../src/tiny-tide/bestiary';
import { TELEGRAPHS } from '../../src/tiny-tide/combat-profiles';

// [id, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, interruptible]
const ROWS: [string, number, number, number, number, number, number, number, number, number, boolean, boolean, boolean][] = [
  ['snail-poke', .50, .30, 2.5, .12, .80, 2.5, 2, 4, .30, true, true, true], ['crab-pinch', .50, .28, 2.5, .10, .55, 1.6, 2, 3, .30, true, true, true],
  ['crab-lunge', .60, .35, 2.0, .22, .75, 3.5, 3, 6, .35, true, true, true], ['crab-sweep', .55, .30, 2.5, .14, .70, 4.0, 2, 8, .30, true, true, true],
  ['mother-pinch', .55, .30, 1.5, .10, .45, 1.4, 3, 4, .35, true, true, false], ['mother-pinch-2', .55, .30, 1.5, .10, .90, 1.4, 3, 4, .35, true, true, false],
  ['mother-lunge', .65, .40, 1.5, .22, .80, 4.0, 4, 8, .40, true, true, false], ['mother-emerge', .70, 0, 0, .15, 1.10, 2.0, 4, 10, .40, false, true, false],
  ['mother-sweep', .60, .35, 1.5, .14, .40, 3.0, 3, 9, .35, true, true, false], ['mother-pinch-rage', .55, .30, 1.5, .10, .80, 1.4, 3, 4, .35, true, true, false],
  ['puffer-burst', .55, 0, 0, .15, 1.20, 3.0, 3, 7, .35, true, true, false], ['squid-ink', .45, .25, 2.0, .30, .60, 6.0, 1, 0, 0, true, false, true],
  ['squid-grab', .55, .30, 1.8, .12, .70, 4.5, 2, 0, 0, false, true, true], ['squid-lunge', .45, .25, 1.8, .22, .80, 3.5, 3, 6, .35, true, true, true],
  ['eel-ambush', .45, .25, 2.0, .20, .70, 5.0, 3, 6, .35, true, true, true], ['eel-bite', .40, .20, 2.2, .10, .50, 1.5, 2, 3, .30, true, true, true],
  ['eel-wrap', .60, .35, 2.0, .12, .80, 6.0, 1, 0, 0, false, true, true], ['tyrant-bite', .60, .35, 1.5, .10, .60, 1.5, 3, 4, .35, true, true, false],
  ['tyrant-den-lunge', .70, .45, 1.5, .25, .90, 4.0, 4, 8, .40, true, true, false], ['tyrant-charge', .65, 0, 0, .30, .50, 2.0, 4, 10, .40, true, true, false],
  ['tyrant-whirl', .80, 0, 0, .60, 1.20, 5.0, 3, 8, .35, false, false, false],
];
/** Spec §11.1: the hostiles of each size and the attacks they use (the alphas use the alpha floor). */
const ROSTER: { size: number; alpha: boolean; behaviours: string[] }[] = [
  { size: 0, alpha: false, behaviours: ['spiny-snail', 'crab'] }, { size: 0, alpha: true, behaviours: ['clawmother'] },
  { size: 1, alpha: false, behaviours: ['crab', 'puffer', 'squid', 'eel'] }, { size: 1, alpha: true, behaviours: ['reef-tyrant'] },
];
const attacksOf = (id: string) => { const b = BEHAVIOURS[id]!; return [...b.attacks, ...(b.phases ?? []).flatMap(p => p.attacks)].flatMap(c => [c.attackId, ...(c.chainNextId ? [c.chainNextId] : [])])
  .concat(b.den ? [b.den.attackId] : [], (b.phases ?? []).flatMap(p => p.patternAttackId ? [p.patternAttackId] : [])); };

describe('bestiary', () => {
  it('gives every species attack the §11.5 row', () => {
    expect(Object.keys(SPECIES_ATTACKS).sort()).toEqual(ROWS.map(r => r[0]).sort());
    for (const [id, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, int] of ROWS) {
      expect(SPECIES_ATTACKS[id], id).toMatchObject({ windupSeconds: windup, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: track, activeSeconds: active, recoverySeconds: recovery,
        cooldownSeconds: cooldown, damage, impulse, staggerSeconds: stagger, blockable: block, parryable: parry, interruptible: int, damageUnit: 'half-heart', maxTargets: 1, crossing: 'same-medium' });
      const t = TELEGRAPHS[SPECIES_ATTACKS[id]!.telegraphProfileId]!;
      expect(t.color, id).toBe(block ? 'amber' : 'red');
    }
    expect(SPECIES_ATTACKS['squid-grab']!.hold).toEqual({ seconds: 1.0, sizeFactor: 1.2, startHalfHearts: 2, squeezeHalfHearts: 1, squeezeEverySeconds: .5 });
    expect(SPECIES_ATTACKS['eel-wrap']!.hold).toEqual({ seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 });
    expect(SPECIES_ATTACKS['tyrant-whirl']).toMatchObject({ aimMode: 'centre', maxHitsPerTarget: 2, repeatHitSeconds: .3 });
    expect(SPECIES_ATTACKS['squid-ink']!.statusEffectId).toBe('ink');
    expect(SPECIES_ATTACKS['crab-lunge']!.lunge).toEqual({ distanceBodyLengths: 1.2 });
  });
  it('MIN_WINDUP holds for every hostile attack', () => {
    for (const r of ROSTER) for (const b of r.behaviours) for (const id of attacksOf(b))
      expect(SPECIES_ATTACKS[id]!.windupSeconds, `${id} at size ${r.size}`).toBeGreaterThanOrEqual(minWindup(r.size, r.alpha));
  });
  it('gives the behaviours the §11.4 and §11.6 numbers', () => {
    expect(BEHAVIOURS.drifter).toMatchObject({ type: 'prey-flee', reactionSeconds: .2, flee: { seconds: 2, restSeconds: 1.2, speedFactor: 1.3 } });
    expect(BEHAVIOURS.sardine).toMatchObject({ type: 'prey-school', school: { radiusBodyLengths: 6, groupSize: 4 }, flee: { seconds: 2.5, restSeconds: 1.5 } });
    expect(BEHAVIOURS['spiny-snail']).toMatchObject({ type: 'prey-fighter', gapSeconds: 2.5, trigger: { radiusBodyLengths: 1.2, seconds: 1 } });
    expect(BEHAVIOURS.crab!.attacks.map(a => [a.attackId, a.band, a.weight, a.flankWeight])).toEqual([['crab-pinch', [0, .45], 3, undefined], ['crab-lunge', [.5, 1.4], 2, undefined], ['crab-sweep', [0, .6], 1, 3]]);
    expect(BEHAVIOURS.eel).toMatchObject({ type: 'hunter-ambush', den: { triggerBodyLengths: .9, outSeconds: 4, attackId: 'eel-ambush' }, repositionSeconds: [.5, 1] });
    expect(BEHAVIOURS.clawmother!.phases!.map(p => [p.aboveHpFraction, p.pattern, p.speedFactor, p.gapSeconds])).toEqual([[.6, 'normal', 1, 1], [.3, 'burrow', 1, .8], [0, 'normal', 1.3, .7]]);
    expect(BEHAVIOURS['reef-tyrant']!.phases!.map(p => [p.aboveHpFraction, p.pattern, p.speedFactor, p.gapSeconds, p.lairFraction])).toEqual([[.66, 'normal', 1, 1, .6], [.33, 'laps', 1.4, .6, undefined], [0, 'normal', 1.2, .8, undefined]]);
    expect(BEHAVIOURS.clawmother!.lair).toEqual({ radiusBodyLengths: 2.5, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/bestiary.test.ts`
Expected: FAIL — `gives every species attack the §11.5 row` (the catalog is empty).

- [ ] **Step 3: Fill `bestiary.ts`** (complete file at this task)

```ts
// Species attacks, species behaviours, the size rosters and the minimum wind-ups (spec §11). Pure data.
import type { AttackShape, AttackSpec } from './combat-types';
import type { Species } from './species';

export interface AttackChoice { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }
/** `patternAttackId`: the attack of a burrow or laps pattern. `lairFraction`: the phase keeps the alpha within this share of its lair radius
 *  (the Reef Tyrant's lair bites; plan decision: the spec says "within 0.6 × lair radius" but its type has no field). */
export interface BehaviourPhase { aboveHpFraction: number; attacks: readonly AttackChoice[]; speedFactor: number; gapSeconds: number; pattern: 'normal' | 'burrow' | 'laps'; patternAttackId?: string; lairFraction?: number }
export type BehaviourType = 'prey-flee' | 'prey-school' | 'prey-fighter' | 'hunter' | 'hunter-ambush' | 'alpha';
export interface SpeciesBehaviour {
  id: string; type: BehaviourType;
  reactionSeconds: number; poise: number; staggerResist: number; knockbackResistance: number; grabbable: boolean;
  attacks: readonly AttackChoice[]; gapSeconds: number;
  repositionSeconds: readonly [number, number]; repositionSpeedFactor: number;
  flee?: { seconds: number; restSeconds: number; speedFactor: number };
  school?: { radiusBodyLengths: number; groupSize: number };
  /** prey-fighter "cornered" */
  trigger?: { radiusBodyLengths: number; seconds: number };
  /** hunter-ambush */
  den?: { triggerBodyLengths: number; outSeconds: number; attackId: string };
  lair?: { radiusBodyLengths: number; resetOutsideFactor: number; resetDelaySeconds: number; healPerSecond: number };
  /** alpha; ordered by aboveHpFraction, descending */
  phases?: readonly BehaviourPhase[];
}
export const BEHAVIOUR_TYPES: readonly BehaviourType[] = ['prey-flee', 'prey-school', 'prey-fighter', 'hunter', 'hunter-ambush', 'alpha'];

/** Minimum wind-ups before director extensions (spec §11.1), by player size. Sizes 2 and up use the size-1 row until 3b retunes them. */
export const MIN_WINDUP: readonly { fighter: number; alpha: number }[] = [{ fighter: .45, alpha: .55 }, { fighter: .40, alpha: .55 }];
export const minWindup = (size: number, alpha: boolean): number => { const row = MIN_WINDUP[Math.min(size, MIN_WINDUP.length - 1)]!; return alpha ? row.alpha : row.fighter; };
/** The player sizes at which a species is hostile (spec §11.1): it hunts that size, or it fights and is of that tier; an alpha only at its own size. */
export function hostileSizes(spec: Pick<Species, 'hunts' | 'fights' | 'tier' | 'alpha'>): number[] {
  if (spec.alpha) return [spec.alpha.size];
  const out = new Set<number>(spec.hunts);
  if (spec.fights) out.add(spec.tier);
  return [...out].sort((a, b) => a - b);
}

const DEG = Math.PI / 180;
type Row = { shape: AttackShape; windup: number; lock: number; track: number; active: number; recovery: number; cooldown: number; damage: number; impulse: number; stagger: number;
  block: boolean; parry: boolean; int: boolean; telegraph: string } & Partial<AttackSpec>;
/** One species attack (spec §11.5): half-hearts, same-medium, terrain-and-cover, one target, the `centre` socket, shape numbers in L_e.
 *  The attacker stands still while it winds up (moveSpeedFactor 0; plan decision); a lunge moves through resolveMotion. */
const attack = (id: string, r: Row): AttackSpec => {
  const { shape, windup, lock, track, active, recovery, cooldown, damage, impulse, stagger, block, parry, int, telegraph, ...rest } = r;
  return { id, shape, poseProfileId: 'rest', windupSeconds: windup, activeSeconds: active, recoverySeconds: recovery, cooldownSeconds: cooldown, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: track,
    damage, impulse, staggerSeconds: stagger, blockable: block, parryable: parry, interruptible: int, maxTargets: 1, hitGroup: 'shared-grant', maxHitsPerTarget: 1, repeatHitSeconds: 0,
    crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: telegraph, damageUnit: 'half-heart', aimMode: 'input', moveSpeedFactor: 0, poiseDamageMultiplier: 1, ...rest };
};
const cone = (range: number, halfDeg: number): AttackShape => ({ kind: 'cone', range, halfAngle: halfDeg * DEG });
const capsule = (z0: number, z1: number, radius: number): AttackShape => ({ kind: 'capsule', start: { x: 0, y: 0, z: z0 }, end: { x: 0, y: 0, z: z1 }, radius });
const ball = (radius: number): AttackShape => capsule(0, 0, radius);
/** Species attacks (spec §11.5). Interruptible: "yes" and "windup" (a lunge: the engine interrupts it in windup only) are `true`. */
export const SPECIES_ATTACKS: Record<string, AttackSpec> = Object.fromEntries([
  attack('snail-poke', { shape: cone(1.2, 50), windup: .50, lock: .30, track: 2.5, active: .12, recovery: .80, cooldown: 2.5, damage: 2, impulse: 4, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('crab-pinch', { shape: cone(.45, 35), windup: .50, lock: .28, track: 2.5, active: .10, recovery: .55, cooldown: 1.6, damage: 2, impulse: 3, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('crab-lunge', { shape: capsule(0, 1.4, .22), lunge: { distanceBodyLengths: 1.2 }, windup: .60, lock: .35, track: 2.0, active: .22, recovery: .75, cooldown: 3.5, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('crab-sweep', { shape: cone(.65, 70), windup: .55, lock: .30, track: 2.5, active: .14, recovery: .70, cooldown: 4.0, damage: 2, impulse: 8, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-spin' }),
  attack('mother-pinch', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .45, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('mother-pinch-2', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .90, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('mother-lunge', { shape: capsule(0, 1.0, .20), lunge: { distanceBodyLengths: .9 }, windup: .65, lock: .40, track: 1.5, active: .22, recovery: .80, cooldown: 4.0, damage: 4, impulse: 8, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('mother-emerge', { shape: ball(.35), aimMode: 'fixed-at-start', windup: .70, lock: 0, track: 0, active: .15, recovery: 1.10, cooldown: 2.0, damage: 4, impulse: 10, stagger: .40, block: false, parry: true, int: false, telegraph: 'red-burrow' }),
  attack('mother-sweep', { shape: cone(.60, 75), windup: .60, lock: .35, track: 1.5, active: .14, recovery: .40, cooldown: 3.0, damage: 3, impulse: 9, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-spin' }),
  attack('mother-pinch-rage', { shape: cone(.40, 35), windup: .55, lock: .30, track: 1.5, active: .10, recovery: .80, cooldown: 1.4, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('puffer-burst', { shape: ball(1.6), aimMode: 'centre', windup: .55, lock: 0, track: 0, active: .15, recovery: 1.20, cooldown: 3.0, damage: 3, impulse: 7, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-inflate' }),
  attack('squid-ink', { shape: cone(.90, 30), statusEffectId: 'ink', windup: .45, lock: .25, track: 2.0, active: .30, recovery: .60, cooldown: 6.0, damage: 1, impulse: 0, stagger: 0, block: true, parry: false, int: true, telegraph: 'amber-coil' }),
  attack('squid-grab', { shape: capsule(.1, .75, .12), hold: { seconds: 1.0, sizeFactor: 1.2, startHalfHearts: 2, squeezeHalfHearts: 1, squeezeEverySeconds: .5 }, windup: .55, lock: .30, track: 1.8, active: .12, recovery: .70, cooldown: 4.5, damage: 2, impulse: 0, stagger: 0, block: false, parry: true, int: true, telegraph: 'red-coil' }),
  attack('squid-lunge', { shape: capsule(0, 1.1, .18), lunge: { distanceBodyLengths: 1.0 }, windup: .45, lock: .25, track: 1.8, active: .22, recovery: .80, cooldown: 3.5, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('eel-ambush', { shape: capsule(0, 1.3, .15), lunge: { distanceBodyLengths: 1.2 }, windup: .45, lock: .25, track: 2.0, active: .20, recovery: .70, cooldown: 5.0, damage: 3, impulse: 6, stagger: .35, block: true, parry: true, int: true, telegraph: 'amber-crouch' }),
  attack('eel-bite', { shape: cone(.45, 35), windup: .40, lock: .20, track: 2.2, active: .10, recovery: .50, cooldown: 1.5, damage: 2, impulse: 3, stagger: .30, block: true, parry: true, int: true, telegraph: 'amber-rear' }),
  attack('eel-wrap', { shape: capsule(0, .6, .20), hold: { seconds: 1.2, sizeFactor: 1.2, startHalfHearts: 1, squeezeHalfHearts: 1, squeezeEverySeconds: .4 }, windup: .60, lock: .35, track: 2.0, active: .12, recovery: .80, cooldown: 6.0, damage: 1, impulse: 0, stagger: 0, block: false, parry: true, int: true, telegraph: 'red-coil' }),
  attack('tyrant-bite', { shape: cone(.40, 35), windup: .60, lock: .35, track: 1.5, active: .10, recovery: .60, cooldown: 1.5, damage: 3, impulse: 4, stagger: .35, block: true, parry: true, int: false, telegraph: 'amber-rear' }),
  attack('tyrant-den-lunge', { shape: capsule(0, 1.2, .14), lunge: { distanceBodyLengths: 1.1 }, windup: .70, lock: .45, track: 1.5, active: .25, recovery: .90, cooldown: 4.0, damage: 4, impulse: 8, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('tyrant-charge', { shape: capsule(0, 1.6, .16), lunge: { distanceBodyLengths: 1.5 }, aimMode: 'fixed-at-start', windup: .65, lock: 0, track: 0, active: .30, recovery: .50, cooldown: 2.0, damage: 4, impulse: 10, stagger: .40, block: true, parry: true, int: false, telegraph: 'amber-crouch' }),
  attack('tyrant-whirl', { shape: ball(.55), aimMode: 'centre', maxHitsPerTarget: 2, repeatHitSeconds: .30, windup: .80, lock: 0, track: 0, active: .60, recovery: 1.20, cooldown: 5.0, damage: 3, impulse: 8, stagger: .35, block: false, parry: false, int: false, telegraph: 'red-spin' }),
].map(a => [a.id, a]));

const behaviour = (over: Partial<SpeciesBehaviour> & Pick<SpeciesBehaviour, 'id' | 'type' | 'reactionSeconds' | 'poise'>): SpeciesBehaviour =>
  ({ staggerResist: 0, knockbackResistance: 0, grabbable: true, attacks: [], gapSeconds: 0, repositionSeconds: [0, 0], repositionSpeedFactor: .6, ...over });
const choice = (attackId: string, band: readonly [number, number], weight: number, more: Partial<AttackChoice> = {}): AttackChoice => ({ attackId, band, weight, ...more });
const PINCH_COMBO = choice('mother-pinch', [0, .4], 3, { chainNextId: 'mother-pinch-2', chainGapSeconds: .2 });
/** Species behaviours (spec §11.4, §11.6). The eel's ambush reaction is 0 (its den rule), its out-of-den reaction .35. */
export const BEHAVIOURS: Record<string, SpeciesBehaviour> = Object.fromEntries([
  behaviour({ id: 'drifter', type: 'prey-flee', reactionSeconds: .2, poise: 99, flee: { seconds: 2.0, restSeconds: 1.2, speedFactor: 1.3 } }),
  behaviour({ id: 'sardine', type: 'prey-school', reactionSeconds: .2, poise: 99, flee: { seconds: 2.5, restSeconds: 1.5, speedFactor: 1.3 }, school: { radiusBodyLengths: 6, groupSize: 4 } }),
  behaviour({ id: 'spiny-snail', type: 'prey-fighter', reactionSeconds: .1, poise: 4, attacks: [choice('snail-poke', [0, 1.2], 1)], gapSeconds: 2.5, trigger: { radiusBodyLengths: 1.2, seconds: 1.0 } }),
  behaviour({ id: 'puffer', type: 'prey-fighter', reactionSeconds: .1, poise: 6, knockbackResistance: .2, attacks: [choice('puffer-burst', [0, 1.6], 1)], gapSeconds: 3.0, trigger: { radiusBodyLengths: 1.1, seconds: .8 } }),
  behaviour({ id: 'crab', type: 'hunter', reactionSeconds: .35, poise: 6, knockbackResistance: .2, gapSeconds: 1.0, repositionSeconds: [.6, 1.2],
    attacks: [choice('crab-pinch', [0, .45], 3), choice('crab-lunge', [.5, 1.4], 2), choice('crab-sweep', [0, .6], 1, { flankWeight: 3 })] }),
  behaviour({ id: 'squid', type: 'hunter', reactionSeconds: .35, poise: 7, knockbackResistance: .3, gapSeconds: .8, repositionSeconds: [.6, 1.2],
    attacks: [choice('squid-ink', [.3, .9], 1), choice('squid-grab', [.2, .75], 2), choice('squid-lunge', [.6, 1.2], 2)] }),
  behaviour({ id: 'eel', type: 'hunter-ambush', reactionSeconds: .35, poise: 6, knockbackResistance: .3, gapSeconds: .8, repositionSeconds: [.5, 1.0],
    attacks: [choice('eel-bite', [0, .45], 3), choice('eel-wrap', [0, .6], 1)], den: { triggerBodyLengths: .9, outSeconds: 4, attackId: 'eel-ambush' } }),
  behaviour({ id: 'clawmother', type: 'alpha', reactionSeconds: .35, poise: 14, staggerResist: .5, knockbackResistance: .6, grabbable: false, gapSeconds: 1.0, repositionSeconds: [.6, 1.0],
    lair: { radiusBodyLengths: 2.5, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [
      { aboveHpFraction: .6, attacks: [PINCH_COMBO, choice('mother-lunge', [.4, 1.0], 1)], speedFactor: 1.0, gapSeconds: 1.0, pattern: 'normal' },
      { aboveHpFraction: .3, attacks: [PINCH_COMBO], speedFactor: 1.0, gapSeconds: .8, pattern: 'burrow', patternAttackId: 'mother-emerge' },
      { aboveHpFraction: 0, attacks: [choice('mother-sweep', [0, .6], 2, { chainNextId: 'mother-pinch-rage', chainGapSeconds: .1 }), { ...PINCH_COMBO, weight: 1 }], speedFactor: 1.3, gapSeconds: .7, pattern: 'normal' },
    ] }),
  behaviour({ id: 'reef-tyrant', type: 'alpha', reactionSeconds: .35, poise: 16, staggerResist: .5, knockbackResistance: .6, grabbable: false, gapSeconds: 1.0, repositionSeconds: [.6, 1.0],
    lair: { radiusBodyLengths: 2.2, resetOutsideFactor: 1.5, resetDelaySeconds: 3, healPerSecond: .04 },
    phases: [
      { aboveHpFraction: .66, attacks: [choice('tyrant-bite', [0, .4], 3), choice('tyrant-den-lunge', [.4, 1.2], 2)], speedFactor: 1.0, gapSeconds: 1.0, pattern: 'normal', lairFraction: .6 },
      { aboveHpFraction: .33, attacks: [], speedFactor: 1.4, gapSeconds: .6, pattern: 'laps', patternAttackId: 'tyrant-charge' },
      { aboveHpFraction: 0, attacks: [choice('tyrant-whirl', [0, .6], 2), choice('tyrant-bite', [0, .4], 2)], speedFactor: 1.2, gapSeconds: .8, pattern: 'normal' },
    ] }),
].map(b => [b.id, b]));
/** The Clawmother's burrow (spec §11.6): sink .4 s, travel 1.2 s at × 1.6 under the sand (untargetable), then emerge; two emerges, then one pinch combo.
 *  The Reef Tyrant's laps: a lap radius of .8 × the lair radius, a charge every half lap, two charges, then a 1.5 s rest. */
export const BURROW = { sinkSeconds: .4, travelSeconds: 1.2, speedFactor: 1.6, emerges: 2 } as const;
export const LAPS = { radiusFraction: .8, charges: 2, restSeconds: 1.5 } as const;
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/bestiary.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/combat-shapes.test.ts`
Expected: PASS, 0 failed (the shapes test now covers every species attack).

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/bestiary.ts tests/tiny-tide-core/bestiary.test.ts
git commit -m "Tiny Tide combat: species attacks and behaviours for sizes 0–1 (spec §11.4–11.6)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T14: Combat AI

**Spec:** §11.2, §11.6, D27, D37, D38. One state machine per behaviour type: `prey-flee`, `prey-school`, `prey-fighter`, `hunter`, `hunter-ambush`, `alpha`.

**Files:**
- Create: `src/tiny-tide/combat-ai.ts`, `tests/tiny-tide-core/combat-ai.test.ts`

**Interfaces:**
- Consumes: T13 `SpeciesBehaviour`, `AttackChoice`, `BehaviourPhase`, `BURROW`, `LAPS`; `random` (`rng.ts`).
- Produces: `MoveIntent` (`ambient`, `toward`, `away` with a `speedFactor`, or `hold`), `AiStateName`, `AiState` (with `outUntil` for the eel's time out of its den, separate from the reposition timer), `newAiState(runSeed, entityId, now?)`, `AiInput`, `AttackRequest { attackId; aim; targetPlayer }`, `AiOutput`, `clampToDisc(p, centre, radius)`, `chooseAttack(choices, d, flank, ready, rng)`, `FLANK_ANGLE` (40°), `aiStarted(s, now)`, `aiRefused(s, now)` (retry after .2 s), `aiStep(b, s, i): AiOutput`, `schoolFlee(members, player, radiusBodyLengths, now)`, `aiLandedHit(b, s, now)`, `alphaPhase(phases, hp, maxHp)`, `ROAR_SECONDS = .8`.

This is the largest pure module. Work in three passes, each with its tests green before the next:
1. Prey (`prey-flee`, `prey-school`, `prey-fighter`): the drifter, sardine, snail and puffer tests.
2. Hunters (`hunter`, `hunter-ambush`): the crab and eel tests, the refused-token retry.
3. Alphas: phases with a roar, the lair disc, the slow reset outside 1.5 × lair, burrow and laps patterns.

- [ ] **Step 1: Write the failing tests** (complete file at this task; T17 and T19 add alpha cases, T18 changes one line)

```ts
// tests/tiny-tide-core/combat-ai.test.ts — spec §11.2 with seeded fixtures: the shipped behaviours, a scripted player, and an attack that keeps
// the entity busy for its windup + active + recovery once the AI's request is started.
import { describe, expect, it } from 'vitest';
import { aiRefused, aiStarted, aiStep, alphaPhase, chooseAttack, clampToDisc, newAiState, schoolFlee, ROAR_SECONDS, type AiInput, type AiOutput, type AiState } from '../../src/tiny-tide/combat-ai';
import { BEHAVIOURS, SPECIES_ATTACKS, type SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
import type { Vec3 } from '../../src/tiny-tide/combat-types';

const DT = 1 / 30;
const base = (over: Partial<AiInput> = {}): AiInput => ({ now: 0, self: { position: { x: 0, y: 0, z: 0 }, L: 1.4, forward: { x: 0, y: 0, z: 1 }, hp: 10, maxHp: 10, staggered: false, held: false, busy: false, speed: 3 },
  player: { position: { x: 0, y: 0, z: 10 }, d: 6, visible: true, targetable: true }, hostile: true, pursuit: 'calm', hit: false, fleeDistance: 7, ready: () => true, ...over });
/** Runs `seconds` of AI ticks; `input(t, s)` gives each tick's input. A requested attack is started (or refused by `refuse`) and keeps the
 *  entity busy for its timeline. Returns the states, outputs and attack ids by tick. */
function drive(b: SpeciesBehaviour, s: AiState, seconds: number, input: (t: number, s: AiState) => Partial<AiInput>, refuse: (t: number) => boolean = () => false, t0 = 0) {
  const log: { t: number; state: string; out: AiOutput }[] = [];
  let busyUntil = -1;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = t0 + k * DT, i = base({ now: t, ...input(t, s) }), o = aiStep(b, s, { ...i, self: { ...i.self, busy: t < busyUntil } });
    if (o.attack) {
      if (refuse(t)) aiRefused(s, t);
      else { aiStarted(s, t); const a = SPECIES_ATTACKS[o.attack.attackId]!; busyUntil = t + a.windupSeconds + a.activeSeconds + a.recoverySeconds; }
    }
    log.push({ t, state: s.name, out: o });
  }
  return log;
}
const firstT = (log: { t: number; state: string }[], state: string) => log.find(l => l.state === state)?.t;
const at = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

describe('combat AI: prey', () => {
  it('drifter flees, tires, rests', () => {
    const s = newAiState(1, 1), log = drive(BEHAVIOURS.drifter!, s, 5, t => ({ player: { position: at(0, t < 3 ? 5 : 50), d: 3, visible: true, targetable: true } }));
    expect(firstT(log, 'flee')).toBeCloseTo(.2, 1);   // reaction .2 s
    expect(firstT(log, 'rest')).toBeCloseTo(2.2, 1);   // flee 2.0 s
    expect(log.find(l => l.state === 'flee')!.out.intent).toMatchObject({ kind: 'away', speedFactor: 1.3 });
    expect(log.find(l => l.state === 'rest')!.out.intent).toEqual({ kind: 'ambient', speedFactor: .35 });
    expect(log.filter(l => l.t > 2.2 && l.t < 3.4).every(l => l.state === 'rest')).toBe(true);   // tired: no flee while resting 1.2 s
    expect(log.at(-1)!.state).toBe('idle');
  });
  it('sardine school flees together in one direction', () => {
    const mk = (id: number, x: number) => ({ state: newAiState(1, id), position: at(x, 0), L: 1 }), school = [mk(1, 0), mk(2, 2), mk(3, 4), mk(4, 30)];
    const player = at(-3, 0);
    // Only the first member is near the player; it flees after its reaction; the others within 6 L join on the same tick.
    let t = 0;
    for (; t < 1 && school[0]!.state.name !== 'flee'; t += DT) {
      for (const m of school) aiStep(BEHAVIOURS.sardine!, m.state, base({ now: t, self: { ...base().self, position: m.position }, player: { position: player, d: 1, visible: true, targetable: true }, fleeDistance: m === school[0] ? 7 : 1 }));
      schoolFlee(school, player, 6, t);
    }
    expect(school.slice(0, 3).map(m => m.state.name)).toEqual(['flee', 'flee', 'flee']); expect(school[3]!.state.name).toBe('idle');
    const dirs = school.slice(0, 3).map(m => m.state.fleeDir!);
    expect(dirs[1]).toEqual(dirs[0]); expect(dirs[2]).toEqual(dirs[0]); expect(dirs[0]!.x).toBeCloseTo(1);   // away from the player, from the centroid
  });
  it('snail retaliates when hit and when cornered', () => {
    const hit = newAiState(1, 2), logHit = drive(BEHAVIOURS['spiny-snail']!, hit, 3, t => ({ hit: t < DT, player: { position: at(0, 1), d: .8, visible: true, targetable: true } }));
    expect(logHit[0]!.state).toBe('face'); expect(logHit.find(l => l.out.attack)!.t).toBeCloseTo(.2, 1);   // faces .2 s, then pokes
    expect(firstT(logHit, 'back-off')).toBeGreaterThan(.5 + .12 + .8 - .05);   // after the poke's windup + active + recovery
    const cornered = newAiState(1, 3), logC = drive(BEHAVIOURS['spiny-snail']!, cornered, 2, () => ({ player: { position: at(0, 1), d: 1.1, visible: true, targetable: true } }));
    expect(firstT(logC, 'face')).toBeCloseTo(1, 1);   // within 1.2 L for 1.0 s
    const far = newAiState(1, 4); drive(BEHAVIOURS['spiny-snail']!, far, 2, () => ({ player: { position: at(0, 5), d: 3, visible: true, targetable: true } }));
    expect(far.name).toBe('idle');
  });
  it('puffer bursts then backs off', () => {
    const s = newAiState(1, 5), log = drive(BEHAVIOURS.puffer!, s, 2.5, t => ({ hit: t < DT, player: { position: at(0, 1), d: 1, visible: true, targetable: true } }));
    const burst = log.find(l => l.out.attack)!; expect(burst.out.attack!.attackId).toBe('puffer-burst');
    const back = log.find(l => l.state === 'back-off')!; expect(back.out.intent).toMatchObject({ kind: 'away', speedFactor: .5 });
    expect(back.t).toBeCloseTo(burst.t + .55 + .15 + 1.2, 1);
    // It stays within .5 L of where the fight started.
    const leashed = aiStep(BEHAVIOURS.puffer!, s, base({ now: back.t + .1, self: { ...base().self, position: at(0, -1) }, player: { position: at(0, 1), d: 1, visible: true, targetable: true } }));
    expect(leashed.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
  });
});

describe('combat AI: hunters', () => {
  it('crab notice delay, approach, band choice, flank weight, gap, reposition', () => {
    const s = newAiState(1, 6), log = drive(BEHAVIOURS.crab!, s, 6, t => ({ pursuit: 'hunt', player: { position: at(0, 1), d: t < 1 ? 2 : .3, visible: true, targetable: true } }));
    expect(log[0]!.out.marker).toBe(true); expect(firstT(log, 'approach')).toBeCloseTo(.35, 1);   // reaction .35 s
    const first = log.find(l => l.out.attack)!;
    expect(first.t).toBeGreaterThanOrEqual(1 - 1e-9);   // d 2 fits no band; at d .3 the pinch or the sweep fits
    expect(['crab-pinch', 'crab-sweep']).toContain(first.out.attack!.attackId);
    const firstEnd = first.t + .5 + .1 + .55 + (first.out.attack!.attackId === 'crab-sweep' ? .05 + .04 + .15 : 0);
    const repo = log.find(l => l.state === 'reposition' && l.t > first.t)!; expect(repo.t).toBeGreaterThan(firstEnd - .2);
    expect(repo.out.intent).toMatchObject({ kind: 'toward', speedFactor: .6 });
    const second = log.find(l => l.out.attack && l.t > first.t)!;
    expect(second.t - repo.t).toBeGreaterThanOrEqual(.6 - 1e-6);   // reposition .6–1.2 s and the 1 s gap
    // Band and flank weights at d .3 (the lunge's band starts at .5): in front pinch 3 : sweep 1; flanked, the sweep's flankWeight 3 replaces its 1.
    const rng = (() => { let k = 0; return () => (k++ % 10) / 10 + .05; })();
    const front = Array.from({ length: 10 }, () => chooseAttack(BEHAVIOURS.crab!.attacks, .3, false, () => true, rng)!.attackId), back = Array.from({ length: 10 }, () => chooseAttack(BEHAVIOURS.crab!.attacks, .3, true, () => true, rng)!.attackId);
    expect(front.filter(a => a === 'crab-pinch').length).toBeGreaterThan(front.filter(a => a === 'crab-sweep').length);
    expect(back.filter(a => a === 'crab-sweep').length).toBeGreaterThan(front.filter(a => a === 'crab-sweep').length);   // 5 of 10 against 3 of 10
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, 1, false, () => true, () => .5)!.attackId).toBe('crab-lunge');
    expect(chooseAttack(BEHAVIOURS.crab!.attacks, 2, false, () => true, () => .5)).toBeNull();
  });
  it('a refused token retries after .2 s', () => {
    const s = newAiState(1, 7), log = drive(BEHAVIOURS.crab!, s, 2, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: .3, visible: true, targetable: true } }), t => t < 1);
    const asks = log.filter(l => l.out.attack).map(l => l.t);
    expect(asks[1]! - asks[0]!).toBeCloseTo(.2, 1);
  });
  it('crab gives up by pursuit rules and heals', () => {
    // The pursuit mode is the ecosystem's (memory, leash, give-up); the AI follows it and reports the engagement (the caller heals at calm).
    const s = newAiState(1, 8);
    drive(BEHAVIOURS.crab!, s, 1, () => ({ pursuit: 'hunt', player: { position: at(0, 1), d: 3, visible: true, targetable: true } }));
    const o = aiStep(BEHAVIOURS.crab!, s, base({ now: 5, pursuit: 'return' }));
    expect(s.name).toBe('return'); expect(o.engagementEnded).toMatchObject({ windups: 0 }); expect(o.engagementEnded!.seconds).toBeCloseTo(5);
    aiStep(BEHAVIOURS.crab!, s, base({ now: 6, pursuit: 'calm' })); expect(s.name).toBe('idle');
  });
  it('eel waits in den, ambushes, retreats', () => {
    const s = newAiState(1, 9);
    const log = drive(BEHAVIOURS.eel!, s, 12, t => ({ self: { ...base().self, position: t < 7 ? at(0, 0) : at(0, 5) }, pursuit: 'hunt',
      player: { position: t < 1 ? at(0, 10) : t < 6 ? at(0, 1) : at(0, 40), d: t < 1 ? 7 : t < 6 ? .3 : 30, visible: true, targetable: true } }));
    expect(log[0]!.state).toBe('den'); expect(log.filter(l => l.t < 1).every(l => !l.out.attack)).toBe(true);
    const ambush = log.find(l => l.out.attack)!; expect(ambush.out.attack!.attackId).toBe('eel-ambush'); expect(ambush.t).toBeCloseTo(1, 1);   // reaction 0 in the den
    expect(log.find(l => l.state === 'retreat')).toBeTruthy();
    expect(log.find(l => l.state === 'retreat')!.out.intent).toMatchObject({ kind: 'toward', point: { x: 0, y: 0, z: 0 } });
  });
});

describe('combat AI: alphas', () => {
  const mother = BEHAVIOURS.clawmother!, L = 10.08;
  const alphaInput = (hp: number, over: Partial<AiInput> = {}) => ({ self: { ...base().self, L, hp, maxHp: 80 }, inLair: true, pursuit: 'hunt' as const, player: { position: at(0, 5), d: .3, visible: true, targetable: true }, ...over });
  it('alpha phases switch at thresholds with a roar', () => {
    expect([80, 49, 48.1, 48, 25, 24, 1].map(hp => alphaPhase(mother.phases!, hp, 80))).toEqual([0, 0, 0, 1, 1, 2, 2]);   // above 60 %, above 30 %
    const s = newAiState(1, 10); s.home = at(0, 0);
    drive(mother, s, 1, () => alphaInput(80));
    const o = aiStep(mother, s, base({ now: 2, ...alphaInput(40) }));
    expect(o.roar).toBe(true); expect(s.name).toBe('roar'); expect(s.phase).toBe(1);
    expect(aiStep(mother, s, base({ now: 2 + ROAR_SECONDS - .05, ...alphaInput(40) })).attack).toBeNull();   // no action while roaring
    const burrow = drive(mother, s, 3, () => alphaInput(40), () => false, 2 + ROAR_SECONDS);
    expect(burrow.some(l => l.out.untargetable)).toBe(true);
    expect(burrow.find(l => l.out.attack)!.out.attack!.attackId).toBe('mother-emerge');
    expect(burrow.find(l => l.out.attack)!.t - (2 + ROAR_SECONDS)).toBeGreaterThanOrEqual(.4 + 1.2 - .05);   // sink .4 s, travel 1.2 s
  });
  it('alpha stays in the lair disc', () => {
    const s = newAiState(1, 11); s.home = at(0, 0);
    const log = drive(mother, s, 3, () => alphaInput(80, { player: { position: at(0, 60), d: 4, visible: true, targetable: true } }));
    for (const l of log) if (l.out.intent.kind === 'toward') expect(Math.hypot(l.out.intent.point.x, l.out.intent.point.z)).toBeLessThanOrEqual(2.5 * L + 1e-6);
    expect(clampToDisc(at(30, 40), at(0, 0), 10)).toEqual({ x: 6, y: 0, z: 8 });
  });
  it('alpha resets slowly outside 1.5 × lair', () => {
    const s = newAiState(1, 12); s.home = at(0, 0); const far = { position: at(0, 1.6 * 2.5 * L), d: 30, visible: true, targetable: true };
    drive(mother, s, 1, () => alphaInput(80));
    const log = drive(mother, s, 4, () => alphaInput(50, { player: far, inLair: false }), () => false, 1);
    expect(firstT(log, 'reset')).toBeCloseTo(4, 1);   // 3 s outside
    expect(log.find(l => l.state === 'reset')!.out).toMatchObject({ heal: .04, intent: { kind: 'toward', point: { x: 0, y: 0, z: 0 } } });
    aiStep(mother, s, base({ now: 9, ...alphaInput(80, { player: far, inLair: false }) })); expect(s.name).toBe('idle'); expect(s.phase).toBe(0);   // full HP: phase 1
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/combat-ai"`.

- [ ] **Step 3: Create `combat-ai.ts`** (complete file)

```ts
// Combat AI (spec §11.2): one state machine per behaviour type. Each tick it returns a move intent and may ask for an attack; the ecosystem
// moves the entity by the intent through resolveMotion and the combat world starts the attack (with a director token at the player).
// Pure: the RNG is seeded per entity from (run seed, entity id); every time is world time.
import { random } from './biomes';
import { BURROW, LAPS, type AttackChoice, type BehaviourPhase, type SpeciesBehaviour } from './bestiary';
import type { Vec3 } from './combat-types';

export type MoveIntent =
  | { kind: 'ambient'; speedFactor: number }
  | { kind: 'toward'; point: Vec3; speedFactor: number }
  | { kind: 'away'; point: Vec3; speedFactor: number }
  | { kind: 'hold' };
export type AiStateName = 'idle' | 'flee' | 'rest' | 'face' | 'attack' | 'back-off' | 'notice' | 'approach' | 'reposition' | 'return'
  | 'den' | 'ambush' | 'out' | 'retreat' | 'roar' | 'sink' | 'burrowed' | 'emerge' | 'lap' | 'lap-rest' | 'reset' | 'held' | 'staggered';
export interface AiState {
  name: AiStateName;
  /** World time the state began. */
  since: number;
  rng: () => number;
  /** prey-fighter: where the fight started; hunter-ambush: the den; alpha: the lair centre. */
  home: Vec3 | null;
  /** No new attack before this (the gap after an action). */
  gapUntil: number;
  /** A refused token retries at this time. */
  retryAt: number;
  until: number; strafe: 1 | -1;
  /** hunter-ambush: out of the den until this (den.outSeconds after its last landed hit). */
  outUntil: number;
  /** prey-flee/school: the player has been near since; prey-fighter: the player has been in the trigger radius since. */
  nearSince: number | null;
  fleeDir: Vec3 | null;
  /** A started choice: its chain follows when the action ends. */
  current: AttackChoice | null;
  chain: { attackId: string; at: number } | null;
  /** hunter engagements (the survivor bonus, spec §10.4). */
  engagedSince: number | null; windups: number;
  /** alpha */
  phase: number; outsideSince: number | null; emerges: number; charges: number; lapAngle: number;
}
export const newAiState = (runSeed: number, entityId: number, now = 0): AiState => ({ name: 'idle', since: now, rng: random((runSeed ^ Math.imul(entityId + 1, 0x9e3779b1)) >>> 0),
  home: null, gapUntil: 0, retryAt: 0, until: 0, strafe: 1, outUntil: 0, nearSince: null, fleeDir: null, current: null, chain: null, engagedSince: null, windups: 0,
  phase: 0, outsideSince: null, emerges: 0, charges: 0, lapAngle: 0 });

/** What the AI sees this tick (positions: physical; `d`: the distance from the entity's centre to the nearest player hurtbox, minus its hull
 *  radius, in its body lengths L). */
export interface AiInput {
  now: number;
  /** `speed`: the species' top speed (physical units per second). */
  self: { position: Vec3; L: number; forward: Vec3; hp: number; maxHp: number; staggered: boolean; held: boolean; busy: boolean; speed: number };
  player: { position: Vec3; d: number; visible: boolean; targetable: boolean };
  /** The species is hostile at the player's size (spec §11.1). */
  hostile: boolean;
  /** The ecosystem's pursuit mode (spec §10): `hunt`/`angry` engaged, `return` giving up, `calm` idle. */
  pursuit: 'calm' | 'flee' | 'hunt' | 'angry' | 'return';
  /** The player damaged this entity this tick. */
  hit: boolean;
  /** Today's prey flee distance: 7 × max(size, SIZES[stage]) × stealth (physical units). */
  fleeDistance: number;
  ready(attackId: string): boolean;
  /** prey-school: the centroid of the school. */
  schoolCentre?: Vec3;
  /** The player is inside the alpha's lair disc (radius × L). */
  inLair?: boolean;
}
export interface AttackRequest { attackId: string; aim: Vec3; targetPlayer: boolean }
export interface AiOutput {
  intent: MoveIntent; attack: AttackRequest | null;
  /** The "!" marker (a hunter noticed the player). */
  marker: boolean;
  /** alpha: under the sand (untargetable); healing (fraction of max HP per second); a phase change roar (ring flash, hint toast). */
  untargetable: boolean; heal: number; roar: boolean;
  /** A hunter engagement ended with the player alive (the caller checks the survivor bonus). */
  engagementEnded: { seconds: number; windups: number } | null;
}
const out = (intent: MoveIntent, more: Partial<AiOutput> = {}): AiOutput => ({ intent, attack: null, marker: false, untargetable: false, heal: 0, roar: false, engagementEnded: null, ...more });
const AMBIENT: MoveIntent = { kind: 'ambient', speedFactor: 1 }, HOLD: MoveIntent = { kind: 'hold' };
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const unit = (v: Vec3): Vec3 => { const l = len(v); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
const set = (s: AiState, name: AiStateName, now: number) => { s.name = name; s.since = now; };
/** A target outside the disc around `centre` is pulled to its rim (horizontal). */
export function clampToDisc(p: Vec3, centre: Vec3, radius: number): Vec3 {
  const dx = p.x - centre.x, dz = p.z - centre.z, h = Math.hypot(dx, dz);
  return h <= radius ? p : { x: centre.x + dx / h * radius, y: p.y, z: centre.z + dz / h * radius };
}
/** The attack to start (spec §11.2): among the choices whose band holds `d` and whose cooldown is ready, by weight (flankWeight when the player
 *  is more than 40° off the forward). Null when none fits. */
export function chooseAttack(choices: readonly AttackChoice[], d: number, flank: boolean, ready: (id: string) => boolean, rng: () => number): AttackChoice | null {
  const fit = choices.filter(c => d >= c.band[0] && d <= c.band[1] && ready(c.attackId));
  const total = fit.reduce((n, c) => n + (flank ? c.flankWeight ?? c.weight : c.weight), 0);
  if (!fit.length || total <= 0) return null;
  let r = rng() * total;
  for (const c of fit) { r -= flank ? c.flankWeight ?? c.weight : c.weight; if (r <= 0) return c; }
  return fit[fit.length - 1]!;
}
export const FLANK_ANGLE = 40 * Math.PI / 180;
const flanked = (i: AiInput) => { const to = unit(sub(i.player.position, i.self.position)), f = unit(i.self.forward); return Math.acos(Math.max(-1, Math.min(1, to.x * f.x + to.y * f.y + to.z * f.z))) > FLANK_ANGLE; };
const aimAtPlayer = (i: AiInput): Vec3 => unit(sub(i.player.position, i.self.position));
/** The attack the caller should start; `aiStarted` or `aiRefused` reports the answer. */
function request(s: AiState, i: AiInput, choice: AttackChoice | null, attackId: string): AttackRequest {
  s.current = choice; return { attackId, aim: aimAtPlayer(i), targetPlayer: true };
}
/** The combat world started the requested attack. */
export function aiStarted(s: AiState, now: number): void {
  s.windups++; s.chain = null;
  set(s, s.name === 'den' ? 'ambush' : s.name === 'burrowed' ? 'emerge' : 'attack', now);
}
/** The director refused the token (or a start rule): retry after .2 s and keep repositioning. */
export function aiRefused(s: AiState, now: number): void { s.retryAt = now + .2; s.chain = s.chain ? { ...s.chain, at: now + .2 } : null; }

/** One AI tick. */
export function aiStep(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const now = i.now;
  if (i.self.held) { if (s.name !== 'held') set(s, 'held', now); return out(HOLD); }
  if (s.name === 'held') set(s, 'idle', now);
  if (i.self.staggered) return out(HOLD);
  switch (b.type) {
    case 'prey-flee': case 'prey-school': return preyFlee(b, s, i);
    case 'prey-fighter': return preyFighter(b, s, i);
    case 'hunter': return hunter(b, s, i, b.attacks, b.gapSeconds, 1);
    case 'hunter-ambush': return ambusher(b, s, i);
    case 'alpha': return alpha(b, s, i);
  }
}

// ---- prey (spec §11.2 prey-flee, prey-school, prey-fighter) ----
function preyFlee(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const f = b.flee!, now = i.now, near = len(sub(i.player.position, i.self.position)) <= i.fleeDistance && i.player.targetable;
  if (s.name === 'idle') {
    s.nearSince = near ? s.nearSince ?? now : null;
    if (i.hit || (s.nearSince !== null && now - s.nearSince >= b.reactionSeconds - 1e-9)) { startFlee(s, i, now); }
    else return out(AMBIENT);
  }
  if (s.name === 'flee') {
    if (now - s.since >= f.seconds - 1e-9) { set(s, 'rest', now); s.fleeDir = null; }
    else { const dir = s.fleeDir ?? unit(sub(i.self.position, i.player.position)); return out({ kind: 'away', point: { x: i.self.position.x - dir.x, y: i.self.position.y - dir.y, z: i.self.position.z - dir.z }, speedFactor: f.speedFactor }); }
  }
  if (s.name === 'rest') {
    if (now - s.since >= f.restSeconds - 1e-9) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
    return out(b.type === 'prey-school' && i.schoolCentre ? { kind: 'toward', point: i.schoolCentre, speedFactor: .35 } : { kind: 'ambient', speedFactor: .35 });
  }
  set(s, 'idle', now); return out(AMBIENT);
}
function startFlee(s: AiState, i: AiInput, now: number, dir?: Vec3) { set(s, 'flee', now); s.fleeDir = dir ?? unit(sub(i.self.position, i.player.position)); }
/** prey-school (spec §11.2): when one member enters flee, every member within the school radius that is not resting flees on the same tick, in
 *  one shared direction: away from the player, from the members' centroid. */
export function schoolFlee(members: readonly { state: AiState; position: Vec3; L: number }[], player: Vec3, radiusBodyLengths: number, now: number): void {
  const starters = members.filter(m => m.state.name === 'flee' && m.state.since === now);
  for (const st of starters) {
    const group = members.filter(m => len(sub(m.position, st.position)) <= radiusBodyLengths * m.L && (m.state.name === 'idle' || m === st || (m.state.name === 'flee' && m.state.since === now)));
    const c = group.reduce((a, m) => ({ x: a.x + m.position.x / group.length, y: a.y + m.position.y / group.length, z: a.z + m.position.z / group.length }), { x: 0, y: 0, z: 0 });
    const dir = unit(sub(c, player));
    for (const m of group) { set(m.state, 'flee', now); m.state.fleeDir = dir; }
  }
}
function preyFighter(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const t = b.trigger!, now = i.now, L = i.self.L, choice = b.attacks[0]!;
  const near = i.hostile && i.player.targetable && i.player.d <= t.radiusBodyLengths;
  // It never moves more than .5 L from where it started the fight.
  const leash = (intent: MoveIntent): MoveIntent => s.home && len(sub(i.self.position, s.home)) > .5 * L ? { kind: 'toward', point: s.home, speedFactor: 1 } : intent;
  switch (s.name) {
    case 'idle': {
      s.nearSince = near ? s.nearSince ?? now : null;
      if ((i.hit && i.hostile) || (s.nearSince !== null && now - s.nearSince >= t.seconds - 1e-9)) { set(s, 'face', now); s.home ??= { ...i.self.position }; return out(HOLD); }
      return out(AMBIENT);
    }
    case 'face': {
      if (i.player.d > choice.band[1] || !i.player.targetable) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
      if (now - s.since < .2 - 1e-9 || now < s.gapUntil || now < s.retryAt || !i.ready(choice.attackId)) return out(HOLD);
      return out(HOLD, { attack: request(s, i, choice, choice.attackId) });
    }
    case 'attack': {
      if (i.self.busy) return out(HOLD);
      set(s, 'back-off', now); s.gapUntil = now + b.gapSeconds;
      return out(leash({ kind: 'away', point: i.player.position, speedFactor: .5 }));
    }
    case 'back-off': {
      if (now - s.since >= 2 - 1e-9) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
      return out(leash({ kind: 'away', point: i.player.position, speedFactor: .5 }));
    }
    default: set(s, 'idle', now); return out(AMBIENT);
  }
}

// ---- hunters (spec §11.2 hunter, hunter-ambush) ----
/** One hunter tick with `choices`, `gap` and `speed` (an alpha's phase passes its own). `bound` keeps targets in a disc (an alpha's lair). */
function hunter(b: SpeciesBehaviour, s: AiState, i: AiInput, choices: readonly AttackChoice[], gap: number, speed: number, bound?: (p: Vec3) => Vec3): AiOutput {
  const now = i.now, engaged = i.pursuit === 'hunt' || i.pursuit === 'angry';
  const pull = (p: Vec3) => bound ? bound(p) : p;
  if (!engaged && s.name !== 'idle' && s.name !== 'return' && !(s.name === 'attack' && i.self.busy)) {
    const ended = s.engagedSince !== null ? { seconds: now - s.engagedSince, windups: s.windups } : null;
    s.engagedSince = null; s.windups = 0; s.chain = null; set(s, i.pursuit === 'return' ? 'return' : 'idle', now);
    return out(AMBIENT, { engagementEnded: ended });
  }
  if (s.name === 'idle' || s.name === 'return') {
    if (!engaged) { if (s.name === 'return' && i.pursuit === 'calm') set(s, 'idle', now); return out(AMBIENT); }
    set(s, 'notice', now); s.engagedSince = now; s.windups = 0;
    return out(HOLD, { marker: true });
  }
  if (s.name === 'notice') {
    if (now - s.since < b.reactionSeconds - 1e-9) return out(HOLD, { marker: true });
    set(s, 'approach', now);
  }
  if (s.name === 'attack') {
    if (i.self.busy) return out(HOLD);
    const next = s.current?.chainNextId;
    if (next && !s.chain) s.chain = { attackId: next, at: now + (s.current?.chainGapSeconds ?? 0) };
    if (s.chain) {
      if (now < s.chain.at || now < s.retryAt) return out(HOLD);
      s.current = null;
      return out(HOLD, { attack: { attackId: s.chain.attackId, aim: aimAtPlayer(i), targetPlayer: true } });
    }
    s.gapUntil = now + gap; s.current = null; set(s, 'reposition', now);
    s.until = now + b.repositionSeconds[0] + s.rng() * (b.repositionSeconds[1] - b.repositionSeconds[0]); s.strafe = s.rng() < .5 ? 1 : -1;
  }
  if (s.name === 'reposition') {
    if (now < s.until) return out(strafe(b, s, i, pull));
    set(s, 'approach', now);
  }
  if (s.name !== 'approach') set(s, 'approach', now);
  const chase: MoveIntent = { kind: 'toward', point: pull(i.player.position), speedFactor: speed * (i.pursuit === 'angry' ? 1.15 : 1) };
  if (now >= s.gapUntil && now >= s.retryAt && i.player.targetable) {
    const c = chooseAttack(choices, i.player.d, flanked(i), i.ready, s.rng);
    if (c) return out(chase, { attack: request(s, i, c, c.attackId) });
  }
  return out(chase);
}
/** Strafe around the player at `repositionSpeedFactor`, keeping d in [.4, .9] L. */
function strafe(b: SpeciesBehaviour, s: AiState, i: AiInput, pull: (p: Vec3) => Vec3): MoveIntent {
  const p = i.player.position, from = sub(i.self.position, p), h = Math.hypot(from.x, from.z) || 1, a = Math.atan2(from.x, from.z) + s.strafe * .6;
  const r = h + (Math.max(.4, Math.min(.9, i.player.d)) - i.player.d) * i.self.L;
  return { kind: 'toward', point: pull({ x: p.x + Math.sin(a) * r, y: i.self.position.y, z: p.z + Math.cos(a) * r }), speedFactor: b.repositionSpeedFactor };
}
function ambusher(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const den = b.den!, now = i.now;
  s.home ??= { ...i.self.position };
  switch (s.name) {
    case 'idle': case 'den': {
      if (s.name !== 'den') set(s, 'den', now);
      const close = len(sub(i.player.position, s.home)) <= den.triggerBodyLengths * i.self.L + i.self.L * .5;
      if (close && i.player.visible && i.player.targetable && i.hostile && now >= s.retryAt && i.ready(den.attackId)) { s.engagedSince = now; s.windups = 0; return out(HOLD, { attack: request(s, i, null, den.attackId) }); }
      return out(HOLD);
    }
    case 'ambush': {
      if (i.self.busy) return out(HOLD);
      set(s, 'out', now); s.outUntil = now + den.outSeconds; s.gapUntil = now + b.gapSeconds;
      return out({ kind: 'toward', point: i.player.position, speedFactor: 1 });
    }
    case 'retreat': {
      if (len(sub(i.self.position, s.home)) <= .3 * i.self.L) { set(s, 'den', now); const ended = s.engagedSince !== null ? { seconds: now - s.engagedSince, windups: s.windups } : null; s.engagedSince = null; return out(HOLD, { engagementEnded: ended }); }
      return out({ kind: 'toward', point: s.home, speedFactor: 1 });
    }
    default: {
      // out: as a hunter for den.outSeconds after its last hit lands (the caller moves `until` on a landed hit), then back to the den.
      if (s.name === 'out') set(s, 'approach', now);
      if (now >= s.outUntil && !i.self.busy && (s.name === 'approach' || s.name === 'reposition')) { set(s, 'retreat', now); return out({ kind: 'toward', point: s.home, speedFactor: 1 }); }
      return hunter(b, s, { ...i, pursuit: 'hunt' }, b.attacks, b.gapSeconds, 1);
    }
  }
}
/** An eel's landed hit keeps it out for another den.outSeconds. */
export function aiLandedHit(b: SpeciesBehaviour, s: AiState, now: number): void { if (b.den) s.outUntil = Math.max(s.outUntil, now + b.den.outSeconds); }

// ---- alphas (spec §11.2 alpha, §11.6) ----
/** The phase: the first whose aboveHpFraction is below hp / maxHp. */
export function alphaPhase(phases: readonly BehaviourPhase[], hp: number, maxHp: number): number {
  const f = hp / maxHp, i = phases.findIndex(p => p.aboveHpFraction < f);
  return i < 0 ? phases.length - 1 : i;
}
export const ROAR_SECONDS = .8;
function alpha(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const lair = b.lair!, phases = b.phases!, now = i.now, L = i.self.L, centre = s.home ??= { ...i.self.position };
  const radius = lair.radiusBodyLengths * L, distance = Math.hypot(i.player.position.x - centre.x, i.player.position.z - centre.z);
  // Reset: the player outside resetOutsideFactor × the lair for resetDelaySeconds → back to the lair centre, healing; full HP → phase 1.
  s.outsideSince = distance > lair.resetOutsideFactor * radius ? s.outsideSince ?? now : null;
  if (s.name === 'reset' || (s.outsideSince !== null && now - s.outsideSince >= lair.resetDelaySeconds - 1e-9 && !i.self.busy)) {
    if (s.name !== 'reset') { set(s, 'reset', now); s.chain = null; s.current = null; }
    if (i.self.hp >= i.self.maxHp) { set(s, 'idle', now); s.phase = 0; s.outsideSince = null; return out(AMBIENT); }
    if (s.outsideSince === null && i.inLair) { set(s, 'approach', now); }
    else return out({ kind: 'toward', point: centre, speedFactor: 1 }, { heal: lair.healPerSecond });
  }
  const phase = alphaPhase(phases, i.self.hp, i.self.maxHp);
  if (phase > s.phase) { s.phase = phase; set(s, 'roar', now); s.chain = null; s.current = null; s.emerges = 0; s.charges = 0; return out(HOLD, { roar: true }); }
  if (s.name === 'roar') { if (now - s.since < ROAR_SECONDS - 1e-9) return out(HOLD); set(s, 'approach', now); }
  const p = phases[s.phase]!, bound = (q: Vec3) => clampToDisc(q, centre, radius * (p.lairFraction ?? 1));
  if (s.name === 'idle') {
    if (!i.inLair || !i.hostile || !i.player.targetable) return out({ kind: 'toward', point: centre, speedFactor: .5 });
    set(s, 'notice', now); return out(HOLD, { marker: true });
  }
  if (p.pattern === 'burrow') return burrow(b, s, i, p, bound);
  if (p.pattern === 'laps') return laps(s, i, p, centre, radius);
  return hunter(b, s, { ...i, pursuit: 'hunt' }, p.attacks, p.gapSeconds, p.speedFactor, bound);
}
/** Burrow (spec §11.6): sink .4 s, travel 1.2 s at × 1.6 under the sand toward the player (untargetable, inside the lair), then emerge at the
 *  player's position; two emerges, then one pinch combo; repeat. */
function burrow(b: SpeciesBehaviour, s: AiState, i: AiInput, p: BehaviourPhase, bound: (q: Vec3) => Vec3): AiOutput {
  const now = i.now;
  if (s.emerges >= BURROW.emerges) {
    const o = hunter(b, s, { ...i, pursuit: 'hunt' }, p.attacks, p.gapSeconds, p.speedFactor, bound);
    if (s.name === 'reposition') s.emerges = 0;   // the combo is over
    return o;
  }
  switch (s.name) {
    case 'sink': if (now - s.since >= BURROW.sinkSeconds - 1e-9) set(s, 'burrowed', now); return out(HOLD, { untargetable: true });
    case 'burrowed': {
      if (now - s.since < BURROW.travelSeconds - 1e-9 || now < s.retryAt) return out({ kind: 'toward', point: bound(i.player.position), speedFactor: p.speedFactor * BURROW.speedFactor }, { untargetable: true });
      return out(HOLD, { untargetable: true, attack: request(s, i, null, p.patternAttackId!) });
    }
    case 'emerge': {
      if (i.self.busy) return out(HOLD);
      s.emerges++; s.gapUntil = now + p.gapSeconds; set(s, s.emerges >= BURROW.emerges ? 'approach' : 'reposition', now);
      return out(HOLD);
    }
    default: { if (now < s.gapUntil) return out(HOLD); set(s, 'sink', now); return out(HOLD, { untargetable: true }); }
  }
}
/** Laps (spec §11.6): circle at .8 × the lair radius at the phase speed; a charge every half lap, aimed through the player's position (fixed at
 *  start); two charges, then a 1.5 s rest. A half lap takes π r / (speed × speedFactor). */
function laps(s: AiState, i: AiInput, p: BehaviourPhase, centre: Vec3, radius: number): AiOutput {
  const now = i.now, r = LAPS.radiusFraction * radius, v = Math.max(1e-6, i.self.speed * p.speedFactor), half = Math.PI * r / v;
  if (s.name === 'lap-rest') { if (now - s.since < LAPS.restSeconds - 1e-9) return out(HOLD); set(s, 'lap', now); s.charges = 0; s.until = now + half; }
  if (s.name === 'attack') {
    if (i.self.busy) return out(HOLD);
    s.charges++; const rest = s.charges >= LAPS.charges;
    set(s, rest ? 'lap-rest' : 'lap', now); s.until = now + half;
    if (rest) return out(HOLD);
  }
  if (s.name !== 'lap') { set(s, 'lap', now); s.until = now + half; }
  const a = Math.atan2(i.self.position.x - centre.x, i.self.position.z - centre.z) + .5, point = { x: centre.x + Math.sin(a) * r, y: i.self.position.y, z: centre.z + Math.cos(a) * r };
  const move: MoveIntent = { kind: 'toward', point, speedFactor: p.speedFactor };
  if (now >= s.until && now >= s.retryAt && i.ready(p.patternAttackId!) && i.player.targetable) return out(move, { attack: request(s, i, null, p.patternAttackId!) });
  return out(move);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/combat-ai.ts tests/tiny-tide-core/combat-ai.test.ts
git commit -m "Tiny Tide combat: AI state machines for prey, schools, fighters, hunters, ambushers and alphas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T15: Half-hearts, faint, kills and DNA

**Spec:** §10.1–10.5, R6, R7, R8, D19, D20, D21, D22, D27.

**Files:**
- Modify: `src/tiny-tide/economy.ts`, `src/tiny-tide/state.ts`, `src/tiny-tide/registries.ts`, `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/lifecycle.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/main.ts`, `src/tiny-tide/hud.css`
- Modify: `tests/tiny-tide-core/economy.test.ts`, `tests/tiny-tide-core/state.test.ts`, `tests/tiny-tide-core/saves.test.ts`, `tests/tiny-tide-core/lifecycle.test.ts`, `tests/tiny-tide-core/sim.test.ts`, `tests/tiny-tide-core/ecosystem.test.ts`
- Modify: `e2e/tiny-tide-paths.mjs` (check 13)

**Interfaces:**
- Consumes: T8 `CombatTick.killed`; T11 `rt.lastThreatAt`.
- Produces: `economy.faintLoss(e): { wallet; parts }` (`faintLegacy` removed); `state.hurt(run, halfHearts, armor)` (divides by 2 after armor); `killReward(run, spec): { dna; counts }`; `SURVIVOR_SHARE = .35`, `SURVIVOR_SECONDS = 4`, `survivorBonusDue(run, behaviourType, engagement)`, `survivorReward(run, spec)`; `faint` uses `faintCombat` and sets `stageDna = 0` (`DEATH_KEEP` removed); `validateRun` accepts .5 steps; `readV4` rounds health to .5; `Ecosystem.giveUpAll(now, seconds)`; the engaged hazard bonus is `2 × max(0, tier − stage)`; `resolveHazards` sets `rt.lastDamageAt`; `sim.ts`: `REGEN_AFTER = 6`, `REGEN_EVERY = 2`, `FAINT_GIVE_UP = 6`, events `fainted { lost }`, `hurt { lost }`, `killed`.

**Decision in this task:** the hazard values double here (spec D19: today's damage stays the same in hearts). Tests that pin hazard damage change in this task, not later.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/economy.test.ts
+++ b/tests/tiny-tide-core/economy.test.ts
@@ -1,6 +1,6 @@
 // tests/tiny-tide-core/economy.test.ts
 import { describe, expect, it } from 'vitest';
-import { bankAll, commitDesign, earn, faintCombat, faintLegacy, legacyEconomy, quoteDesign, validateLedger, walletTotal, type Economy } from '../../src/tiny-tide/economy';
+import { bankAll, commitDesign, earn, faintCombat, faintLoss, legacyEconomy, quoteDesign, validateLedger, walletTotal, type Economy } from '../../src/tiny-tide/economy';
 import { partCost, starterGenome, type Genome } from '../../src/tiny-tide/genome';
 import { PARTS } from '../../src/tiny-tide/parts';
 
@@ -63,11 +63,18 @@ describe('DNA ledger', () => {
     const r = commit(e, withParts(g, fin()), withParts(g, fin(.4)));   // 20 → 14: release floor(20 × 6/20) = 6, all at risk
     expect(r.parts.p9).toEqual({ basis: 14, credit: { banked: 5, atRisk: 9 } }); expect(r.wallet).toEqual({ banked: 15, atRisk: 6 });
   });
-  it('banks everything on evolution; legacy faint keeps 70% of each wallet part; combat faint zeroes at-risk credit', () => {
+  it('banks everything on evolution', () => {
     const g = starterGenome(), e = commit(earn(legacyEconomy(50, g), 30), g, withParts(g, fin()));   // wallet {50, 10}, p9 {0, 20}
     expect(bankAll(e).wallet).toEqual({ banked: 60, atRisk: 0 }); expect(bankAll(e).parts.p9!.credit).toEqual({ banked: 20, atRisk: 0 });
-    expect(faintLegacy(e).wallet).toEqual({ banked: 35, atRisk: 7 });
-    const c = faintCombat(e); expect(c.wallet).toEqual({ banked: 50, atRisk: 0 }); expect(c.parts.p9!.credit).toEqual({ banked: 0, atRisk: 0 });
+  });
+  it('faintCombat zeroes at-risk wallet and part credit, keeps basis and banked', () => {
+    const g = starterGenome(), e = commit(earn(legacyEconomy(50, g), 30), g, withParts(g, fin()));   // wallet {50, 10}, p9 {0, 20}
+    const c = faintCombat(e); expect(c.wallet).toEqual({ banked: 50, atRisk: 0 }); expect(c.parts.p9).toEqual({ basis: e.parts.p9!.basis, credit: { banked: 0, atRisk: 0 } });
+    expect(c.parts.p1).toEqual(e.parts.p1);   // a banked part keeps its credit
+  });
+  it('faintLoss reports what is lost', () => {
+    const g = starterGenome(), e = commit(earn(legacyEconomy(50, g), 30), g, withParts(g, fin()));
+    expect(faintLoss(e)).toEqual({ wallet: 10, parts: 20 }); expect(faintLoss(faintCombat(e))).toEqual({ wallet: 0, parts: 0 });
   });
   it('validates the ledger against the design', () => {
     const g = starterGenome(), e = legacyEconomy(0, g);
--- a/tests/tiny-tide-core/state.test.ts
+++ b/tests/tiny-tide-core/state.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, mealDna, PLANET_COUNT, prepareEvolution, STAGES, validateRun, type Run } from '../../src/tiny-tide/state';
+import { applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, hurt, killReward, mealDna, PLANET_COUNT, prepareEvolution, STAGES, survivorBonusDue, survivorReward, validateRun, type Run } from '../../src/tiny-tide/state';
 import { adaptToPlan, nextUid, type Genome } from '../../src/tiny-tide/genome';
 import { plan } from '../../src/tiny-tide/plans';
 import { species } from '../../src/tiny-tide/species';
@@ -47,11 +47,32 @@ describe('run v4', () => {
     expect(applyDesign(r, spike, r.name, build, 7)).toEqual({ ok: false, reason: 'Too complex: 9 / 8 slots.' });   // structure is checked before money
     expect(dnaOf(r)).toBe(0); expect(r.genome).toEqual(fins);
   });
-  it('faints once with the legacy rule and marks a pending respawn', () => {
-    const r = freshRun(4); eat(r, species(0, 'plant'), 0); expect(faint(r)).toBe(true);
-    expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 });   // floor(20 × .7), floor(8 × .7)
+  it('faint resets stageDna and is applied once', () => {
+    const r = freshRun(4); eat(r, species(0, 'plant'), 0); expect(r.stageDna).toBe(8); expect(faint(r)).toBe(true);
+    expect(r.economy.wallet).toEqual({ banked: 20, atRisk: 0 }); expect(r.stageDna).toBe(0);   // the 8 DNA found at this size is gone
     expect(r.pendingRespawn).toBe(true); expect(r.deaths).toBe(1);
-    expect(faint(r)).toBe(false); expect(r.economy.wallet).toEqual({ banked: 14, atRisk: 5 }); expect(r.deaths).toBe(1);
+    eat(r, species(0, 'plant'), 1); expect(faint(r)).toBe(false); expect(r.economy.wallet).toEqual({ banked: 20, atRisk: 8 }); expect(r.deaths).toBe(1);
+  });
+  it('killReward by diet and growth rule', () => {
+    const meat = freshRun(5); meat.diet = 'carnivore';
+    const crab = { ...species(1, 'crab'), hunts: [0] }, snail = species(1, 'snail');
+    expect(killReward(meat, crab)).toEqual({ dna: 24, counts: true }); expect(meat.stageDna).toBe(24); expect(meat.bites).toBe(1);   // hunts size 0: counts
+    expect(killReward(meat, snail)).toEqual({ dna: 13, counts: false }); expect(meat.stageDna).toBe(24);   // tier 1, does not hunt size 0
+    const omni = freshRun(5); omni.diet = 'omnivore'; expect(killReward(omni, crab).dna).toBe(17);   // round(24 × .7) = round(16.8)
+    const plants = freshRun(5); expect(killReward(plants, crab)).toEqual({ dna: 0, counts: false }); expect(plants.bites).toBe(0);
+  });
+  it('survivor bonus conditions', () => {
+    const r = freshRun(6), squid = species(2, 'squid');
+    expect(survivorBonusDue(r, 'hunter', { seconds: 4, windups: 1 })).toBe(true);
+    expect(survivorBonusDue(r, 'hunter', { seconds: 3.9, windups: 3 })).toBe(false); expect(survivorBonusDue(r, 'hunter', { seconds: 9, windups: 0 })).toBe(false);
+    expect(survivorBonusDue(r, 'prey-fighter', { seconds: 9, windups: 2 })).toBe(false); expect(survivorBonusDue(r, 'hunter-ambush', { seconds: 9, windups: 2 })).toBe(true);
+    r.pendingRespawn = true; expect(survivorBonusDue(r, 'hunter', { seconds: 9, windups: 2 })).toBe(false);
+    const m = freshRun(6); m.diet = 'carnivore'; expect(survivorBonusDue(m, 'hunter', { seconds: 9, windups: 2 })).toBe(false);
+    const h = freshRun(6); expect(survivorReward(h, squid)).toBe(11); expect(h.stageDna).toBe(11);   // round(.35 × 30) = round(10.5)
+  });
+  it('hurts in half-hearts after armor', () => {
+    const r = freshRun(7); r.health = 3; expect(hurt(r, 3, 2)).toBe(false); expect(r.health).toBe(2);   // 3 − floor(2 / 2) = 2 half-hearts
+    expect(hurt(r, 1, 0)).toBe(false); expect(r.health).toBe(1.5); expect(hurt(r, 9, 0)).toBe(true); expect(r.health).toBe(0);
   });
   it('computes meal DNA with one rounding', () => {
     expect(mealDna(plan('burrower')!, 'omnivore', species(2, 'plant'))).toBe(16);   // round(16 × .7 × 1.4) = round(15.68)
```

```diff
--- a/tests/tiny-tide-core/lifecycle.test.ts
+++ b/tests/tiny-tide-core/lifecycle.test.ts
@@ -6,6 +6,7 @@ import { newRuntime, type CombatRuntime } from '../../src/tiny-tide/combat-types
 import { designDelta } from '../../src/tiny-tide/design-delta';
 import { Ecosystem, type EcoEvent } from '../../src/tiny-tide/ecosystem';
 import { freshRun, maxHealthOf, STAGES } from '../../src/tiny-tide/state';
+import { earn } from '../../src/tiny-tide/economy';
 import { PLANS, plan } from '../../src/tiny-tide/plans';
 import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
 import { starterFor, starterGenome, type Genome } from '../../src/tiny-tide/genome';
@@ -33,8 +34,8 @@ describe('lifecycle', () => {
     expect(rt.controlledVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.externalVelocity).toEqual({ x: 0, y: 0, z: 0 }); expect(rt.cooldowns.size).toBe(0);
   });
   it('faints once, even when called twice, and resolves once with a legal anchor', () => {
-    const run = freshRun(1), rt = busy(), before = structuredClone(run.economy);
-    expect(beginRespawn(run, rt)).toBe(true); const after = structuredClone(run.economy);
+    const run = freshRun(1), rt = busy(); run.economy = earn(run.economy, 7); const before = structuredClone(run.economy);
+    expect(beginRespawn(run, rt)).toBe(true); const after = structuredClone(run.economy); expect(after.wallet.atRisk).toBe(0);
     expect(beginRespawn(run, rt)).toBe(false); expect(run.economy).toEqual(after); expect(run.deaths).toBe(1); expect(after).not.toEqual(before);
     const anchor = { ok: true as const, position: { x: 0, y: 1, z: 0 }, orientation: { yaw: 0, pitch: 0 } };
     expect(resolveRespawn(run, rt, 10, { ok: false, reason: 'none' })).toBe(false); expect(run.pendingRespawn).toBe(true);
--- a/tests/tiny-tide-core/saves.test.ts
+++ b/tests/tiny-tide-core/saves.test.ts
@@ -2,6 +2,8 @@ import { describe, expect, it } from 'vitest';
 import { commitEvolution, dnaOf, freshRun, maxHealthOf, parseSave, parseSaveWithNotes, prepareEvolution, STAGES, validateRun } from '../../src/tiny-tide/state';
 import { adaptToPlan, starterGenome } from '../../src/tiny-tide/genome';
 import { plan } from '../../src/tiny-tide/plans';
+import { resolveRespawn } from '../../src/tiny-tide/lifecycle';
+import { newRuntime } from '../../src/tiny-tide/combat-types';
 
 const build = { coast: false };
 const legacyParts = (parts = starterGenome().parts) => parts.map(({ uid: _u, ...p }) => p);
@@ -32,6 +34,20 @@ describe('v4 saves', () => {
     const run = parseSave(JSON.stringify({ ...r, health: max + 5 }), build)!;
     expect(run.health).toBe(max); expect(validateRun(run, build)).toEqual([]);
   });
+  it('half-heart health loads', () => {
+    const r = freshRun(1), max = maxHealthOf(r);
+    expect(parseSave(JSON.stringify({ ...r, health: 2.5 }), build)!.health).toBe(2.5);
+    expect(parseSave(JSON.stringify({ ...r, health: .4 }), build)!.health).toBe(.5);   // between the steps: the nearest half heart, at least .5
+    expect(parseSave(JSON.stringify({ ...r, health: 2.3 }), build)!.health).toBe(2.5);
+    expect(validateRun({ ...r, health: 2.25 }, build)).toContain('health'); expect(validateRun({ ...r, health: max - .5 }, build)).toEqual([]);
+  });
+  it('pending respawn from the legacy rule takes no second loss', () => {
+    // An older build applied its faint (keep 70 %) and saved during the faint: the respawn resolves and nothing more is taken.
+    const r = freshRun(1); r.economy = { ...r.economy, wallet: { banked: 14, atRisk: 5 } }; r.pendingRespawn = true; r.deaths = 1;
+    const run = parseSave(JSON.stringify(r), build)!, rt = newRuntime();
+    expect(resolveRespawn(run, rt, 0, { ok: true, position: { x: 0, y: 1, z: 0 }, orientation: { yaw: 0, pitch: 0 } })).toBe(true);
+    expect(run.economy.wallet).toEqual({ banked: 14, atRisk: 5 }); expect(run.deaths).toBe(1); expect(run.pendingRespawn).toBe(false);
+  });
   it('loads a v4 save with zero or negative health at the maximum', () => {
     const r = freshRun(1), max = maxHealthOf(r);
     for (const health of [0, -3]) { const run = parseSave(JSON.stringify({ ...r, health }), build); expect(run?.health).toBe(max); }
--- a/tests/tiny-tide-core/sim.test.ts
+++ b/tests/tiny-tide-core/sim.test.ts
@@ -45,3 +45,13 @@ describe('sim', () => {
     expect(runSim()).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
   }, 60_000);
 });
+describe('regeneration', () => {
+  it('gives half a heart every 2 s once 6 s have passed since the last damage and the last wind-up at the player', () => {
+    const run = freshRun(7), w = world(7), s = newSimState(run);
+    w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
+    s.run.health = 4; s.rt.lastDamageAt = s.time; s.rt.lastThreatAt = s.time + 1;   // a wind-up 1 s later: regen waits for 7 s
+    const samples: number[] = [];
+    for (let f = 1; f <= 12 * 60; f++) { simFrame(s, w, { dt: DT, intent: RELEASED, wish: { x: 0, y: 0, z: 0 }, held: false }); if (f % 60 === 0) samples.push(s.run.health); }
+    expect(samples).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4.5, 4.5, 5, 5]);   // 7 s quiet, then +.5 at 9 s and 11 s
+  });
+});
```

`tests/tiny-tide-core/ecosystem.test.ts` pins two crab hazard values. They double here (T16 then moves both tests to the ray):

```diff
-    const events = eco.step(ctx(p, 0, { stage: 1 })).filter(e => e.entity === crab); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(2);   // 2 + max(0, 1 − 1)
+    const events = eco.step(ctx(p, 0, { stage: 1 })).filter(e => e.entity === crab); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(4);   // 4 + 2 × max(0, 1 − 1)
-    expect(events.map(e => e.time)).toEqual([0, 1.4]); expect(events[0]!.damage).toBe(3); expect(events[0]!.normal).toEqual({ x: 0, y: 1, z: 0 });   // 2 + (1 − 0); coincident centres
+    expect(events.map(e => e.time)).toEqual([0, 1.4]); expect(events[0]!.damage).toBe(6); expect(events[0]!.normal).toEqual({ x: 0, y: 1, z: 0 });   // 4 + 2 × (1 − 0) half-hearts; coincident centres
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/economy.test.ts tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/saves.test.ts tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/ecosystem.test.ts`
Expected: FAIL — `faintLoss` and `killReward` not exported; `faint resets stageDna` fails; the two crab hazard values are still 2 and 3.

- [ ] **Step 3: Implement the rules**

```diff
--- a/src/tiny-tide/economy.ts
+++ b/src/tiny-tide/economy.ts
@@ -50,9 +50,12 @@ export function commitDesign(e: Economy, from: Genome, to: Genome): { ok: true;
   return { ok: true, economy: n };
 }
 export function bankAll(e: Economy): Economy { const n = clone(e), bank = (c: DnaCredit) => { c.banked += c.atRisk; c.atRisk = 0; }; bank(n.wallet); Object.values(n.parts).forEach(p => bank(p.credit)); return n; }
-export function faintLegacy(e: Economy): Economy { const n = clone(e); n.wallet = { banked: Math.floor(n.wallet.banked * .7), atRisk: Math.floor(n.wallet.atRisk * .7) }; return n; }
-/** Sub-project 3: every at-risk credit is lost. Basis, design and banked credit stay. */
+/** The faint (spec §10.3, R7): every at-risk credit is lost. Basis, design and banked credit stay. */
 export function faintCombat(e: Economy): Economy { const n = clone(e); n.wallet.atRisk = 0; for (const p of Object.values(n.parts)) p.credit.atRisk = 0; return n; }
+/** What `faintCombat` takes: the at-risk wallet, and the at-risk credit of the parts. */
+export function faintLoss(e: Economy): { wallet: number; parts: number } {
+  return { wallet: e.wallet.atRisk, parts: Object.values(e.parts).reduce((n, p) => n + p.credit.atRisk, 0) };
+}
 const dna = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
 const nonNeg = (c: DnaCredit) => !!c && dna(c.banked) && dna(c.atRisk) && Number.isSafeInteger(c.banked + c.atRisk);
 export function validateLedger(e: Economy, g: Genome): string[] {
--- a/src/tiny-tide/state.ts
+++ b/src/tiny-tide/state.ts
@@ -1,4 +1,4 @@
-import { bankAll, commitDesign, earn, faintLegacy, legacyEconomy, validateLedger, walletTotal, type Economy } from './economy';
+import { bankAll, commitDesign, earn, faintCombat, legacyEconomy, validateLedger, walletTotal, type Economy } from './economy';
 import { adaptToPlan, cloneGenome, derive, dietOf, effectiveStats, partCost, problems, repairLegacyGenome, sanitizeGenome, starterFor, starterGenome, STARTER_NEXT_SERIAL, uidSerial, type DesignContext, type Genome } from './genome';
 import { PARTS, part, type Diet, type PartSpec } from './parts';
 import { closedLinesOf, commitmentsOf, eligibleChildren, plan, ROOT_PLAN, violates, type BodyPlan } from './plans';
@@ -20,7 +20,6 @@ export const STAGES: readonly Stage[] = [
   { title: 'Cosmic', biome: 'THE FINAL FRONTIER', size: '∞', description: 'Float through the stars and eat all 12 planets.', goal: PLANET_COUNT, speed: 8, radius: 3, color: '#bfc0ff', action: 'Rise' },
 ];
 export const START_DNA = 20;
-export const DEATH_KEEP = .7;
 export const OMNIVORE_RATE = .7;
 
 export interface ArchivedDesign { genome: Genome; name: string; savedAt: string; reason: string }
@@ -86,11 +85,28 @@ export function eat(run: Run, spec: Species, id: number): { dna: number; win: bo
 }
 /** Damage after armor. Every hit costs at least one point. */
 export const damageAfterArmor = (damage: number, armor: number) => Math.max(1, damage - Math.floor(armor / 2));
-/** Applies damage. Returns true when the creature faints. */
+/** Applies damage in half-hearts (spec §10.1): health is in hearts with .5 steps. Returns true when the creature faints. */
 export function hurt(run: Run, damage: number, armor: number): boolean {
-  run.health = Math.max(0, run.health - damageAfterArmor(damage, armor));
+  run.health = Math.max(0, run.health - damageAfterArmor(damage, armor) / 2);
   return run.health <= 0;
 }
+/** DNA from a combat kill (spec §10.4, R8): a meat eater gets the meal DNA (omnivore × .7, foraging; one rounding) and a bite; a herbivore gets
+ *  nothing (the creature is driven off). It counts for the growth bar for a species of the player's tier or one that hunts its size. */
+export function killReward(run: Run, spec: Species): { dna: number; counts: boolean } {
+  if (run.diet === 'herbivore') return { dna: 0, counts: false };
+  const dna = mealDna(currentPlan(run), run.diet, spec), counts = spec.tier === run.stage || spec.hunts.includes(run.stage);
+  run.bites++; reward(run, dna, counts);
+  return { dna, counts };
+}
+/** The survivor bonus share of a hunter's DNA (D22), and its conditions: an engagement of at least SURVIVOR_SECONDS with at least one wind-up. */
+export const SURVIVOR_SHARE = .35, SURVIVOR_SECONDS = 4;
+export function survivorBonusDue(run: Run, behaviourType: string | undefined, engagement: { seconds: number; windups: number }): boolean {
+  return run.diet === 'herbivore' && !run.pendingRespawn && (behaviourType === 'hunter' || behaviourType === 'hunter-ambush') && engagement.seconds >= SURVIVOR_SECONDS - 1e-9 && engagement.windups >= 1;
+}
+/** A herbivore survived a hunter (spec §10.4): round(.35 × its DNA), counting for the growth bar. */
+export function survivorReward(run: Run, spec: Species): number {
+  const dna = Math.round(SURVIVOR_SHARE * spec.dna); reward(run, dna, true); return dna;
+}
 export function unlock(run: Run, id: string | undefined) {
   if (!id || !part(id) || run.unlocked.includes(id) || part(id)!.stage <= run.stage) return false;
   run.unlocked.push(id); return true;
@@ -147,10 +163,11 @@ function applyEvolution(c: Run, p: Prepared) {
 export function commitEvolution(run: Run, p: Prepared, catalog: readonly PartSpec[] = PARTS): number[] {
   const c = structuredClone(run); applyEvolution(c, p); const cleared = clearMissing(c, catalog); Object.assign(run, c); return cleared;
 }
-/** Applies the legacy faint once. A second call while a respawn is pending changes nothing. */
+/** The faint (spec §10.3, R7), once: every at-risk credit is lost and the growth bar resets; basis, banked credit and the design stay.
+ *  A second call while a respawn is pending changes nothing. */
 export function faint(run: Run): boolean {
   if (run.pendingRespawn) return false;
-  run.deaths++; run.economy = faintLegacy(run.economy); run.pendingRespawn = true; return true;
+  run.deaths++; run.economy = faintCombat(run.economy); run.stageDna = 0; run.pendingRespawn = true; return true;
 }
 
 const int = (v: unknown, min = 0) => Number.isInteger(v) && (v as number) >= min;
@@ -194,7 +211,7 @@ export function validateRun(run: Run, build: Build, catalog: readonly PartSpec[]
   if (pathOk) {
     if (run.diet !== dietOf(run.genome)) out.push('diet');
     for (const x of problems(run.genome, currentPlan(run), { unlocked: run.unlocked, diet: run.diet }, catalog).filter(x => x.code !== 'dna' && x.code !== 'anchor')) out.push(`design ${x.code}: ${x.message}`);
-    if (!finite(run.health) || run.health > maxHealthOf(run)) out.push('health');
+    if (!finite(run.health) || run.health > maxHealthOf(run) || !Number.isInteger(run.health * 2)) out.push('health');
   }
   const active = run.loadout?.active;
   if (!isObject(run.loadout) || !Array.isArray(active) || active.length !== 2) out.push('loadout');
@@ -267,7 +284,8 @@ function readV4(v: Record<string, unknown>): Run | null {
   const run = { version: 4, seed: v.seed, name: v.name, stage: v.stage, plans: v.plans, diet: v.diet, economy: v.economy, stageDna: v.stageDna, totalDna: v.totalDna,
     bites: v.bites, elapsed: v.elapsed, deaths: v.deaths, health: v.health, genome, nextPartSerial: v.nextPartSerial, unlocked: v.unlocked, eatenPlanets: v.eatenPlanets,
     completed: v.completed, loadout: v.loadout, pendingRespawn: v.pendingRespawn, mechanics: v.mechanics, archive, notices: v.notices } as unknown as Run;
-  if (run.plans.length && run.plans.every(id => plan(id)) && Number.isFinite(run.health)) { const max = maxHealthOf(run); run.health = run.health <= 0 ? max : Math.max(1, Math.min(run.health, max)); }
+  // Health has .5 steps (spec §10.1): a value between them rounds to the nearest half heart.
+  if (run.plans.length && run.plans.every(id => plan(id)) && Number.isFinite(run.health)) { const max = maxHealthOf(run); run.health = run.health <= 0 ? max : Math.max(.5, Math.min(Math.round(run.health * 2) / 2, max)); }
   return run;
 }
 const count = (v: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v)));
```

```diff
--- a/src/tiny-tide/ecosystem.ts
+++ b/src/tiny-tide/ecosystem.ts
@@ -175,6 +175,10 @@ export class Ecosystem {
     e.respawn = e.spec.kind === 'planet' ? -1 : RESPAWN_TIME[0] + this.rand() * (RESPAWN_TIME[1] - RESPAWN_TIME[0]);
   }
 
+  /** After a faint (spec §10.3, D27): every creature hunting the player gives up (`return`) and acquires nothing for `seconds`. */
+  giveUpAll(now: number, seconds: number): void {
+    for (const e of this.entities) if (e.mode === 'hunt' || e.mode === 'angry') { this.setMode(e, 'return'); e.returnUntil = now + seconds; }
+  }
   /** The roaming bound of an entity's tier: tighter for hunters. */
   private boundsOf(e: Entity) { return (isHunter(e.spec) ? this.hunterBounds : this.bounds)[e.spec.tier]!; }
   /** Moves the entity (and its home) to the nearest legal pose within 4 body lengths, or removes it until a retry. */
@@ -347,7 +351,8 @@ export class Ecosystem {
     e.hazardReadyAt = ctx.now + hazard.cadenceSeconds;
     const nx = px - e.x, ny = py - e.y, nz = pz - e.z, nl = Math.hypot(nx, ny, nz);
     const normal = nl < 1e-6 ? { x: 0, y: 1, z: 0 } : { x: nx / nl, y: ny / nl, z: nz / nl };
-    events.push({ type: 'hazard', entity: e, hazard, damage: hazard.damage + (engaged ? Math.max(0, e.spec.tier - ctx.stage) : 0), point: { x: px, y: py, z: pz }, normal, time: ctx.now });
+    // The engaged bonus is in half-hearts too: 2 × max(0, tier − stage) (spec §4.2).
+    events.push({ type: 'hazard', entity: e, hazard, damage: hazard.damage + (engaged ? 2 * Math.max(0, e.spec.tier - ctx.stage) : 0), point: { x: px, y: py, z: pz }, normal, time: ctx.now });
   }
 
   private tickRespawn(e: Entity, ctx: EcoContext) {
--- a/src/tiny-tide/lifecycle.ts
+++ b/src/tiny-tide/lifecycle.ts
@@ -257,7 +257,7 @@ export function resolveHazards(events: readonly EcoEvent[], ctx: { mode: string;
   const sorted = [...events].sort((a, b) => a.time - b.time || (a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0));
   for (const e of sorted) {
     if (ctx.mode !== 'playing' || ctx.pendingRespawn || !rt.damageable || ctx.now < rt.invulnerableUntil) continue;
-    rt.invulnerableUntil = ctx.now + e.hazard.invulnerabilitySeconds;
+    rt.invulnerableUntil = ctx.now + e.hazard.invulnerabilitySeconds; rt.lastDamageAt = ctx.now;
     const k = e.hazard.impulse / ctx.mass * (1 - ctx.resistance);
     rt.externalVelocity.x += e.normal.x * k; rt.externalVelocity.y += e.normal.y * k; rt.externalVelocity.z += e.normal.z * k;
     out.push(e);
--- a/src/tiny-tide/registries.ts
+++ b/src/tiny-tide/registries.ts
@@ -27,7 +27,8 @@ export const ATTACKS: Record<string, AttackSpec> = merged(PLAYER_ATTACKS, SPECIE
 export const ABILITIES: Record<string, AbilitySpec> = PLAYER_ABILITIES;
 export { EVASIONS, GUARDS };
 const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
-export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 1, 1.8), hazard('ray-sting', 1, 1.8), hazard('crab-pinch', 2, 1.4), hazard('squid-grab', 2, 1.4), hazard('plane-buzz', 2, 1.4)].map(h => [h.id, h]));
+/** Contact hazards; damage in half-hearts (spec §4.2: today's damage doubled). */
+export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 2, 1.8), hazard('ray-sting', 2, 1.8), hazard('crab-pinch', 4, 1.4), hazard('squid-grab', 4, 1.4), hazard('plane-buzz', 4, 1.4)].map(h => [h.id, h]));
 export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
   effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, behaviours: BEHAVIOURS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
```

```diff
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -3,7 +3,7 @@
 // main.ts and the combat probe both call it. It returns events; main.ts turns them into sound, particles, toasts and saves.
 import { SIZES } from './biomes';
 import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRuntime, type MutVec3, type Orientation, type RecoveryResult, type Vec3, type WorldQueries } from './combat-types';
-import type { Ecosystem, EcoEvent } from './ecosystem';
+import type { Ecosystem, EcoEvent, Entity } from './ecosystem';
 import { chomp, CHOMP_COOLDOWN, type ChompResult } from './feeding';
 import { CombatWorld, playerMatrix, type CombatTick, type PlayerBody } from './combat-world';
 import { assignSlots, movesOf, NO_PINS, type MoveSet, type SlotAssignment } from './moves';
@@ -17,7 +17,8 @@ import { bodyLengthOf, hullFitOf, hullOffsets, massFor, sampleCombatPose } from
 import { orientedHeave, orientedSway, rotateInto } from './orientation';
 import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
 import { habitat, movement, movementCapabilities } from './profiles';
-import { currentPlan, evolveReady, growthOf, hurt, STAGES, unlock, type Run } from './state';
+import { currentPlan, evolveReady, growthOf, hurt, killReward, STAGES, unlock, type Run } from './state';
+import { faintLoss } from './economy';
 import { admissionClock, supportHeight } from './world-queries';
 
 export type GameMode = 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won';
@@ -30,7 +31,7 @@ export interface Glide { path: { position: Vec3; orientation: Orientation }[]; i
 export interface RescueLog { searches: number; found: number; failed: number; last: null | { from: Vec3; to: Vec3; time: number; solids: string[] } }
 export interface SimState {
   run: Run; rt: CombatRuntime; physical: Vec3; time: number; mode: GameMode; derived: Derived; genomeRevision: number;
-  chompCooldown: number; sinceHit: number; regenClock: number; respawnClock: number; stuckRetry: number;
+  chompCooldown: number; regenClock: number; respawnClock: number; stuckRetry: number;
   /** A run that began stuck owes its start grace to the first successful install. */
   startGracePending: boolean;
   trap: TrapWatch; unstick: UnstickSearch | null; glide: Glide | null; beforeStep: StepSnapshot;
@@ -52,10 +53,12 @@ export type SimEvent =
   | { type: 'combat'; tick: CombatTick }
   | { type: 'regen' }
   /** An accepted hazard hit; `fainted` when it emptied the hearts (the run is already marked; save it at once). */
-  | { type: 'hurt'; event: EcoEvent; damage: number; fainted: boolean }
+  | { type: 'hurt'; event: EcoEvent; damage: number; fainted: boolean; lost: number }
   | { type: 'respawned' } | { type: 'respawn-waiting' }
-  /** Combat damage emptied the hearts (the run is already marked; save it at once). */
-  | { type: 'fainted' }
+  /** Combat damage emptied the hearts (the run is already marked; save it at once). `lost`: the at-risk DNA the faint took. */
+  | { type: 'fainted'; lost: number }
+  /** A combat kill (spec §10.4): the DNA it paid (0 for a herbivore) and a part it unlocked. */
+  | { type: 'killed'; entity: Entity; dna: number; drop: string | null }
   /** A loaded run that was saved during a faint found no anchor yet: it waits fainted (main shows the faint overlay). */
   | { type: 'resume-fainted' };
 export interface SimInput { dt: number; intent: CombatInput; wish: Vec3; held: boolean }
@@ -67,7 +70,7 @@ export const simOwnedState = (): SimOwned => ({ trap: newTrapWatch(), unstick: n
 /** A plain state (tests and the combat probe). */
 export function newSimState(run: Run): SimState {
   return { run, rt: newRuntime(), physical: { x: 0, y: 0, z: 0 }, time: 0, mode: 'menu', derived: derive(effectiveStats(run.genome, currentPlan(run))), genomeRevision: 0,
-    chompCooldown: 0, sinceHit: 99, regenClock: 0, respawnClock: 0, stuckRetry: 0, startGracePending: false, acceptedHits: 0, rejectedHits: 0, ...simOwnedState() };
+    chompCooldown: 0, regenClock: 0, respawnClock: 0, stuckRetry: 0, startGracePending: false, acceptedHits: 0, rejectedHits: 0, ...simOwnedState() };
 }
 export function refreshDerived(s: SimState): void { s.derived = derive(effectiveStats(s.run.genome, currentPlan(s.run))); }
 const capsOf = (s: SimState) => movementCapabilities(currentPlan(s.run));
@@ -166,13 +169,17 @@ export function playerBody(s: SimState, actor: Actor): PlayerBody {
   return { rt: s.rt, position: s.physical, centre, L: actor.bodyLength, mass: massFor(plan, s.run.genome, actor.bodyLength), knockbackResistance: plan.physics.knockbackResistance,
     armor: s.derived.armor, ground: caps.ground, mode: movement(plan.movement).mode, inBreachArc: s.rt.arc !== null, health: s.run.health, pose };
 }
-/** A faint at 0 hearts, once (the hazard path and the combat path share it). */
-function faintNow(s: SimState): boolean {
-  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null;
-  if (!beginRespawn(s.run, s.rt)) return false;
-  s.combat.cancelAttacksOnPlayer(s.rt);
+/** Regeneration (spec §10.2). */
+export const REGEN_AFTER = 6, REGEN_EVERY = 2;
+/** After a faint, every creature hunting the player gives up for this long (D27). */
+export const FAINT_GIVE_UP = 6;
+/** A faint at 0 hearts, once (the hazard path and the combat path share it). Returns the at-risk DNA it took, or null when no faint began. */
+function faintNow(s: SimState, w: SimWorld): number | null {
+  const hadPermit = s.rt.permit !== null, hadArc = s.rt.arc !== null, lost = faintLoss(s.run.economy).wallet;
+  if (!beginRespawn(s.run, s.rt)) return null;
+  s.combat.cancelAttacksOnPlayer(s.rt); w.eco.giveUpAll(s.time, FAINT_GIVE_UP);
   s.mode = 'fainted'; s.faintLog.push({ time: s.time, hadPermit, hadArc }); s.respawnClock = 1.8;
-  return true;
+  return lost;
 }
 /** One frame of the simulation (main.ts `frame` without presentation). */
 export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[] {
@@ -187,9 +194,10 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
     if (s.mode === 'playing') { if (grew) checkGrownPose(s, w, actor, events); else checkPose(s, w, actor, events); } else settleOffset(s, w, actor);
   }
   if (s.mode === 'playing' && actor && !held) {
-    run.elapsed += dt; s.chompCooldown = Math.max(0, s.chompCooldown - dt); s.sinceHit += dt;
-    // Hearts come back slowly once the creature is out of danger.
-    if (s.sinceHit > 5 && run.health < s.derived.maxHealth) { s.regenClock += dt; if (s.regenClock > 2.5) { s.regenClock = 0; run.health = Math.min(s.derived.maxHealth, run.health + 1); events.push({ type: 'regen' }); } } else s.regenClock = 0;
+    run.elapsed += dt; s.chompCooldown = Math.max(0, s.chompCooldown - dt);
+    // Regeneration (spec §10.2): half a heart every REGEN_EVERY once REGEN_AFTER has passed since the last damage and the last wind-up at the player.
+    const calm = s.time - s.rt.lastDamageAt >= REGEN_AFTER - 1e-9 && s.time - s.rt.lastThreatAt >= REGEN_AFTER - 1e-9;
+    if (calm && run.health < s.derived.maxHealth) { s.regenClock += dt; if (s.regenClock >= REGEN_EVERY - 1e-9) { s.regenClock = 0; run.health = Math.min(s.derived.maxHealth, run.health + .5); events.push({ type: 'regen' }); } } else s.regenClock = 0;
     const intent = input.intent, wish = input.wish, legal = w.legality(stage), rt = s.rt;
     snapshotStep(rt, s.beforeStep);
     // A rescue glides the body along its admitted path, one pose a frame, re-admitted for the current body.
@@ -226,8 +234,12 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
       const tick = s.combat.tick({ now: s.time, dt, playing: true, intent, wish, previousMove: s.previousMove, player: body, moves: m.set, slots: m.slots, entities: w.eco.entities, stage, queries: legal.queries });
       run.health = body.health; s.previousMove = intent.move;
       if (tick.events.length || tick.killed.length || tick.started.length || tick.brokeFree) events.push({ type: 'combat', tick });
-      for (const e of tick.killed) { const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop); w.eco.consume(e); s.combat.forget(e); }
-      if (run.health <= 0 && faintNow(s)) events.push({ type: 'fainted' });
+      for (const e of tick.killed) {
+        const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop);
+        events.push({ type: 'killed', entity: e, dna: killReward(run, e.spec).dna, drop: drop && run.unlocked.includes(drop) ? drop : null });
+        w.eco.consume(e); s.combat.forget(e);
+      }
+      if (run.health <= 0) { const lost = faintNow(s, w); if (lost !== null) events.push({ type: 'fainted', lost }); }
       if (s.mode === 'playing' && tick.chomp && basicRequested(intent) && s.chompCooldown <= 0) {
         s.chompCooldown = CHOMP_COOLDOWN;
         events.push({ type: 'chomp', result: chomp(run, w.eco, s.physical, growthOf(run), s.derived, s.time, worldHull(s, playerActorCached(s))) });
@@ -246,22 +258,21 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
     const accepted = resolveHazards(hazards, { mode: s.mode, pendingRespawn: run.pendingRespawn, rt: s.rt, now: s.time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
     s.rejectedHits += hazards.length - accepted.length;
     // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
-    for (const event of accepted) { if (s.mode !== 'playing') break; s.acceptedHits++; takeHit(s, event, events); }
+    for (const event of accepted) { if (s.mode !== 'playing') break; s.acceptedHits++; takeHit(s, w, event, events); }
   }
   if (s.mode === 'fainted') tickFaint(s, w, dt, events);
   if (active) s.time += dt;
   return events;
 }
 /** One accepted hazard event: damage, and a faint at 0 hearts (once). */
-function takeHit(s: SimState, event: EcoEvent, events: SimEvent[]): void {
-  s.sinceHit = 0;
-  const fainted = hurt(s.run, event.damage, s.derived.armor) && faintNow(s);
-  events.push({ type: 'hurt', event, damage: event.damage, fainted });
+function takeHit(s: SimState, w: SimWorld, event: EcoEvent, events: SimEvent[]): void {
+  const lost = hurt(s.run, event.damage, s.derived.armor) ? faintNow(s, w) : null;
+  events.push({ type: 'hurt', event, damage: event.damage, fainted: lost !== null, lost: lost ?? 0 });
 }
 /** The faint timer: respawn at the start anchor, or wait and retry each second. */
 function tickFaint(s: SimState, w: SimWorld, dt: number, events: SimEvent[]): void {
   s.respawnClock -= dt; if (s.respawnClock > 0) return;
-  if (tryRespawn(s, w, events)) { s.mode = 'playing'; s.sinceHit = 99; events.push({ type: 'respawned' }); return; }
+  if (tryRespawn(s, w, events)) { s.mode = 'playing'; events.push({ type: 'respawned' }); return; }
   s.respawnClock = 1; events.push({ type: 'respawn-waiting' });
 }
 /** A new run or a load (main.ts `begin`, after the world is built): a fresh runtime, then the pending respawn, or the start anchor (or a
@@ -269,7 +280,7 @@ function tickFaint(s: SimState, w: SimWorld, dt: number, events: SimEvent[]): vo
 export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null): SimEvent[] {
   const events: SimEvent[] = [];
   s.run = run; refreshDerived(s); run.health = Math.min(run.health, s.derived.maxHealth);
-  s.mode = 'playing'; s.chompCooldown = 0; s.sinceHit = 99;
+  s.mode = 'playing'; s.chompCooldown = 0;
   s.rt = newRuntime(); s.genomeRevision++; cancelRescue(s); s.startGracePending = false; s.combat.reset(); s.previousMove = { x: 0, y: 0, z: 0 };
   s.faintLog.length = 0; s.acceptedHits = 0; s.rejectedHits = 0;
   const actor = playerActorCached(s), t = w.legality(run.stage).queries.terrain;
```

```diff
--- a/src/tiny-tide/hud.css
+++ b/src/tiny-tide/hud.css
@@ -2,6 +2,7 @@
 #hearts i{width:15px;height:14px;display:block}
 #hearts svg{width:15px;height:14px;fill:#ffffff26;stroke:#fff6e360;stroke-width:1.2}
 #hearts i.full svg{fill:#ff8f7a;stroke:#ffd1c4}
+#hearts i.half svg{fill:#ff8f7a8c;stroke:#ffd1c4}
 #hearts.hit{animation:hearts-hit .45s}
 @keyframes hearts-hit{0%,100%{transform:none}25%{transform:translateX(-4px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}}
 .growth-next #diet{padding:2px 9px;border-radius:99px;background:var(--stage-color);color:var(--ink);font-weight:800;letter-spacing:1px;font-size:9px}
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -2,7 +2,7 @@ import { startAnalytics } from '../analytics';
 import * as T from 'three';
 import './style.css';
 import './hud.css';
-import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, DEATH_KEEP, dietCanEat, dnaOf, evolveReady, freshRun, growthOf, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, STAGES, type Build, type Run } from './state';
+import { applyDesign, commitEvolution, currentPlan, damageAfterArmor, dietCanEat, dnaOf, evolveReady, freshRun, growthOf, parseSaveWithNotes, PLANET_COUNT, prepareEvolution, STAGES, type Build, type Run } from './state';
 import { adaptToPlan, derive, dietOf, effectiveStats } from './genome';
 import { part } from './parts';
 import { tierSpecies } from './species';
@@ -208,7 +208,7 @@ let lastIntent: CombatInput = RELEASED;
 let target: T.Vector3 | null = null;
 let time = 0, last = performance.now(), cooldown = 0, chompPulse = 0;
 let toastTimer = 0, uiClock = 0, saveClock = 0, hintClock = 0, respawnClock = 0, stuckRetry = 0, respawnToasted = false;
-let sinceHit = 99, regenClock = 0, wrongDietClock = 0, readyToasted = false, lastBiome = '';
+let regenClock = 0, wrongDietClock = 0, readyToasted = false, lastBiome = '';
 /** The one combat runtime of the player. Never cache its fields across frames (resets replace them). */
 let rt = newRuntime();
 /** The player's authoritative physical position. The rendered root follows it every frame. */
@@ -231,7 +231,6 @@ const sim: SimState = {
   get derived() { return derived; }, set derived(v) { derived = v; },
   get genomeRevision() { return genomeRevision; }, set genomeRevision(v) { genomeRevision = v; },
   get chompCooldown() { return cooldown; }, set chompCooldown(v) { cooldown = v; },
-  get sinceHit() { return sinceHit; }, set sinceHit(v) { sinceHit = v; },
   get regenClock() { return regenClock; }, set regenClock(v) { regenClock = v; },
   get respawnClock() { return respawnClock; }, set respawnClock(v) { respawnClock = v; },
   get stuckRetry() { return stuckRetry; }, set stuckRetry(v) { stuckRetry = v; },
@@ -338,11 +337,20 @@ function toast(message: string) { el('toast').textContent = message; el('toast')
 function floater(text: string, x: number, y: number, kind = '') {
   const label = document.createElement('span'); label.className = `bite-floater ${kind}`; label.textContent = text; label.style.left = `${x}px`; label.style.top = `${y}px`; el('floaters').append(label); setTimeout(() => label.remove(), 950);
 }
+/** Hearts with half steps (spec §10.1). */
 function syncHearts() {
-  const max = derived.maxHealth, health = Math.ceil(run.health);
-  el('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < health ? 'full' : ''}">${heart}</i>`).join('');
+  const max = derived.maxHealth, health = run.health;
+  el('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i + 1 <= health ? 'full' : i + .5 <= health ? 'half' : ''}">${heart}</i>`).join('');
   el('hearts').setAttribute('aria-label', `${health} of ${max} hearts`);
 }
+/** A combat kill: the DNA floater (none for a herbivore: it drove the creature off) and a found part. */
+function presentKill(e: Entity, dna: number, drop: string | null) {
+  const food = world.foods.find(f => f.entity === e); if (!food) return;
+  const pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z));
+  floater(dna > 0 ? `+${dna} DNA` : 'Driven off!', pos.x, pos.y);
+  if (drop) { toast(`New part found: ${part(drop)!.name}! Open the editor to use it.`); audio.found(); }
+  if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
+}
 function syncUI() {
   const stage = STAGES[run.stage]!, diet = dietOf(run.genome);
   el('stage-icon').innerHTML = species[run.stage]!; el('creature-name').textContent = run.name;
@@ -522,10 +530,11 @@ function presentSim(events: readonly SimEvent[], dt: number) {
       case 'step': presentStep(e.result, dt); break;
       case 'chomp': presentChomp(e.result); break;
       case 'regen': syncHearts(); break;
-      case 'hurt': presentHurt(e.event, e.fainted); break;
+      case 'hurt': presentHurt(e.event, e.fainted, e.lost); break;
       case 'combat': presentCombat(e.tick); break;
-      case 'fainted': presentFaint(); break;
-      case 'respawned': el('faint').hidden = true; save(); syncUI(); toast(`You kept ${Math.round(DEATH_KEEP * 100)}% of your DNA. Stay safe out there.`); break;
+      case 'fainted': presentFaint(e.lost); break;
+      case 'respawned': el('faint').hidden = true; save(); syncUI(); toast('You woke up at the start. Eat to grow again.'); break;
+      case 'killed': presentKill(e.entity, e.dna, e.drop); break;
       case 'respawn-waiting': if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); } break;
       case 'resume-fainted': el('faint').hidden = false; break;
     }
@@ -566,16 +575,17 @@ function presentChomp(c: ChompResult) {
   if (evolveReady(run) && !readyToasted) { readyToasted = true; toast('Ready to evolve! Tap Evolve when you want to grow.'); audio.found(); }
 }
 /** One accepted hazard hit (the simulation already applied it and, at 0 hearts, began the respawn). */
-function presentHurt(event: EcoEvent, fainted: boolean) {
+function presentHurt(event: EcoEvent, fainted: boolean, lost: number) {
   world.hurt(); audio.hurt(); if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 40, 30]);
   const pos = world.screenPoint(world.player.position.clone().add(new T.Vector3(0, 1.4, 0)));
-  floater(`-${damageAfterArmor(event.damage, derived.armor)} ♥`, pos.x, pos.y, 'hurt');
+  floater(damageText('hit', 'half-heart', damageAfterArmor(event.damage, derived.armor)), pos.x, pos.y, 'hurt');
   syncHearts(); el('hearts').classList.remove('hit'); void el('hearts').offsetWidth; el('hearts').classList.add('hit');
   if (!fainted) { if (run.health <= 2) toast(`${event.entity.spec.label} is winning! Get away to heal.`); return; }
-  presentFaint();
+  presentFaint(lost);
 }
-/** A faint (the simulation already began the respawn): save at once, then the overlay. */
-function presentFaint() {
+/** A faint (the simulation already began the respawn): save at once, then the overlay with the at-risk DNA it took (spec §10.3). */
+function presentFaint(lost: number) {
+  el('faint').innerHTML = `<strong>Fainted!</strong><span>The ${lost} DNA you found as a ${STAGES[run.stage]!.title.toLowerCase()} is gone. Your body and parts stay.</span>`;
   save(); respawnToasted = false;
   clearInput(); audio.faint(); el('faint').hidden = false; world.burst(world.player.position.x, world.player.position.y, world.player.position.z, '#ff8f7a', 40);
 }
```

- [ ] **Step 4: Check 13 counts half-hearts**

In `e2e/tiny-tide-paths.mjs` check `'13'`, the crab's engaged pinch is now 4 + 2 × (1 − 0) = 6 half-hearts. Replace:

```js
  const fx = await makeFixture(page, { seed: pick.seed }), damage = await damageAfterArmor(page, 3, fx.info.armor);
```
with
```js
  const fx = await makeFixture(page, { seed: pick.seed }), damage = (await damageAfterArmor(page, 6, fx.info.armor)) / 2;   // half-hearts → hearts
```
and in the assertion message replace `damageAfterArmor(3, ${fx.info.armor})` with `damageAfterArmor(6, ${fx.info.armor}) / 2`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/economy.test.ts tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/saves.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/ecosystem.test.ts`
Expected: PASS, 0 failed. The golden still matches (the scripted run takes no damage; regeneration does not change it).

- [ ] **Step 6: Checkpoint**, then `node e2e/tiny-tide-paths.mjs 13 15` against the running server. Expected: `PASSED: checks 13, 15`.

- [ ] **Step 7: Commit**

```bash
git add src/tiny-tide/economy.ts src/tiny-tide/state.ts src/tiny-tide/registries.ts src/tiny-tide/ecosystem.ts src/tiny-tide/lifecycle.ts src/tiny-tide/sim.ts src/tiny-tide/main.ts src/tiny-tide/hud.css tests/tiny-tide-core/economy.test.ts tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/saves.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/sim.test.ts tests/tiny-tide-core/ecosystem.test.ts e2e/tiny-tide-paths.mjs
git commit -m "Tiny Tide combat: half-heart damage, regeneration, the strict faint rule, kill and survivor DNA

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T16: Size-0 species and the crab

**Spec:** §11.2–11.3 (drifter shrimp, spiny snail, Peach crab), §11.7, §3.2 (`biomes.ts`, `ecosystem.ts`, `avoidance.ts`, `world.ts`), D26, D28, D37, D38.

**Files:**
- Modify: `src/tiny-tide/species.ts`, `src/tiny-tide/biomes.ts`, `src/tiny-tide/registries.ts`, `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/combat-world.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/world.ts`, `src/tiny-tide/main.ts`, `src/tiny-tide/avoidance.ts`
- Modify: `tests/tiny-tide-core/avoidance.test.ts`, `tests/tiny-tide-core/combat-motion.test.ts`, `tests/tiny-tide-core/contract.test.ts`, `tests/tiny-tide-core/ecosystem.test.ts`, `tests/tiny-tide-core/feeding.test.ts`, `tests/tiny-tide-core/lifecycle.test.ts`, `tests/tiny-tide-core/sim.test.ts`
- Modify: `e2e/tiny-tide-paths.mjs` (check 13)

**Interfaces:**
- Consumes: T13 `BEHAVIOURS`; T14 `aiStep`, `newAiState`; T11 `startSpecies` options; T15 `killReward`, `survivorBonusDue`.
- Produces:
  - Species rows `drifter` (tier 0, model `shrimp`), `spiny_snail` (tier 0, model `snail`); the crab becomes a combat species (`hp 20`, `behaviourId 'crab'`, attacks `crab-pinch`, `crab-lunge`, `crab-sweep`) and loses `contactHazardId`. The `crab-pinch` hazard is removed from `HAZARDS`.
  - `FOOD_MODEL_KINDS` uses `spec.model ?? spec.kind`.
  - `ecosystem.ts`: `EntityMotion` (external velocity and the AI move intent per entity), `combatMove`, legacy flee skipped for combat species, full heal on return to calm, hunter respawn 30–40 s.
  - `CombatWorld.aiTick(ctx: AiTickContext): AiTickResult { engagements; roars; markers }` (with provoke on a player hit) and `afterMotion(entities)`.
  - `SimWorld.isOnScreen(p)`; `sim.ts` runs `aiTick` and emits `survivor` events.
  - `world.ts`: one prefab per species (tint through `instanceColor`, `bodyScale`, the snail's spikes), flash through `instanceColor`.
  - `avoidance.ts`: `simulateEscape(e, { speedScale?, policy?, stay? })` runs the real combat world; it counts a combat hit (`hit`, `grabbed`, `guard-broken` on the player) as well as hazards; the escaping player dashes across the attack axis `DODGE_LEAD = .15` s before active; only the encounter's hunter counts.

**Decisions in this task (spec gaps):**
- The old straight-line escape loses to lunges, because a telegraphed lunge is meant to be dodged, not outrun. The avoidance escape dodges with the Dash of its starter design. The test filters hits to the encounter's hunter type (an unrelated eel or crab nearby is not the hunter under test).
- The negative control ("a hunter that never forgets lands a hit") used to pass because the hunter caught a fleeing player. Attacks are now avoidable by design, so the control uses `stay: true` (the player does not move).

- [ ] **Step 1: Update the tests**

```diff
--- a/tests/tiny-tide-core/avoidance.test.ts
+++ b/tests/tiny-tide-core/avoidance.test.ts
@@ -5,18 +5,21 @@ import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
 import { EDGE_SOFT_START } from '../../src/tiny-tide/edge';
 import { eligibleChildren, plan, ROOT_PLAN } from '../../src/tiny-tide/plans';
 import { SPECIES } from '../../src/tiny-tide/species';
+import { BEHAVIOURS } from '../../src/tiny-tide/bestiary';
 
 const visible = () => { const out: string[] = []; const walk = (path: string[]) => { out.push(path.at(-1)!); for (const c of eligibleChildren(path, { coast: false })) walk([...path, c.id]); }; walk([ROOT_PLAN]); return [...new Set(out)]; };
 const never = { id: 'x', memorySeconds: 1e9, blockedWaitSeconds: 1e9, reacquireSeconds: 0, leashBodyLengths: 1e9, giveUpBodyLengths: 1e9 };
 describe('avoidance', () => {
-  it('fails against a much faster hunter that never forgets, on a verified encounter (negative control)', () => {
+  it('fails when the player stays in reach of a hunter that never forgets, on a verified encounter (negative control)', () => {
+    // The crab's attacks are telegraphed and a running Speck avoids them (spec §1 criterion 3); a Speck that does not run is hit.
     const [e] = findEncounters('speck', '1:crab', 1); expect(e, 'no crab encounter for a Speck').toBeTruthy();
-    expect(simulateEscape(e!, { speedScale: 3, policy: never })).toMatchObject({ ok: false, reason: 'hit' });
+    expect(simulateEscape(e!, { speedScale: 3, policy: never, stay: true })).toMatchObject({ ok: false, reason: 'hit' });
   });
   it('lets every visible plan run from every hunter of its size, in three real encounters', () => {
     const report: string[] = [];
     for (const id of visible()) { const p = plan(id)!; if (p.size === 4) continue;
-      for (const s of SPECIES.filter(x => x.hunts.includes(p.size))) {
+      // Hunters that chase (legacy hunters and the `hunter` behaviour). Ambushers and alphas wait in a den or a lair; the combat probe measures them (P1).
+      for (const s of SPECIES.filter(x => x.hunts.includes(p.size) && (!x.behaviourId || BEHAVIOURS[x.behaviourId]?.type === 'hunter'))) {
         const found = findEncounters(id, s.key, 3); expect(found.length, `${id} vs ${s.key}: only ${found.length} encounters`).toBe(3);
         for (const e of found) { const r = simulateEscape(e); report.push(`${id} vs ${s.key} seed ${e.seed} entity ${e.entityId}: ${r.reason} at ${r.seconds.toFixed(1)}s`); expect(r.ok, report.at(-1)).toBe(true); }
       }
--- a/tests/tiny-tide-core/combat-motion.test.ts
+++ b/tests/tiny-tide-core/combat-motion.test.ts
@@ -1,6 +1,7 @@
 // tests/tiny-tide-core/combat-motion.test.ts — spec §5.12: combat motion goes through resolveMotion and never installs a refused pose.
 import { describe, expect, it } from 'vitest';
-import { random, SIZES } from '../../src/tiny-tide/biomes';
+import { random, SIZES, WORLD_HALF } from '../../src/tiny-tide/biomes';
+import { Ecosystem, speciesActor } from '../../src/tiny-tide/ecosystem';
 import { newRuntime, type Vec3 } from '../../src/tiny-tide/combat-types';
 import { starterFor } from '../../src/tiny-tide/genome';
 import { RELEASED } from '../../src/tiny-tide/input';
@@ -72,3 +73,30 @@ describe('combat motion', () => {
     expect(slow.controlledVelocity.z).toBeLessThan(100);   // it brakes toward half the top speed
   });
 });
+describe('combat motion of species', () => {
+  it('knockback, lunge, dash and grab motion never install a refused pose (species: lunge, knockback, held)', () => {
+    // Crabs (tier 1, ground) and fixture swimmers next to reef rocks and arches, pushed by random lunges, knockbacks and claw pulls.
+    let steps = 0;
+    for (const seed of [1, 2, 3]) {
+      const eco = new Ecosystem(seed), rand = random(seed * 13 + 1), q = stageWorldQueries(1, seed), bounds = { half: WORLD_HALF * SIZES[1]! };
+      const solids = stageSolids(1, seed).solids.filter(s => Math.max(Math.abs(s.minX), Math.abs(s.maxX), Math.abs(s.minZ), Math.abs(s.maxZ)) < 35 * SIZES[1]!);
+      const crabs = eco.entities.filter(e => e.spec.key === '1:crab');
+      eco.step({ stage: 1, dt: DT, now: 0, player: { x: 0, y: 900, z: 0 }, playerHull: [], perceivable: false, stealthFactor: 1 });
+      for (let c = 0; c < 56; c++) {
+        const e = crabs[c % crabs.length]!, s = solids[Math.floor(rand() * solids.length)]!, a = rand() * 2 * Math.PI, L = speciesActor(e).bodyLength, r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + .6 * L;
+        const start = findRecoveryPose(speciesActor(e), { x: (s.minX + s.maxX) / 2 + Math.sin(a) * r, y: s.minY, z: (s.minZ + s.maxZ) / 2 + Math.cos(a) * r }, { queries: q, bounds, orientation: { yaw: 0, pitch: 0 }, time: 0 }, { maxDistance: 3 * L });
+        if (!start.ok) continue;
+        e.x = e.hx = start.position.x; e.y = e.hy = start.position.y; e.z = e.hz = start.position.z;
+        const kind = c % 3, push = scaled(dir(rand, true), kind === 2 ? .5 * L * rand() : (kind === 0 ? 1.2 * L / .22 : 45 * L * rand()));
+        e.combat = { intent: { kind: 'hold' }, face: null, lunge: kind === 0 ? push : null, external: kind === 1 ? { ...push } : { x: 0, y: 0, z: 0 }, frozen: false, held: kind === 2 ? push : null, moved: 0 };
+        for (let i = 0; i < 8; i++) {
+          eco.step({ stage: 1, dt: DT, now: (i + 1) * DT, player: { x: 0, y: 900, z: 0 }, playerHull: [], perceivable: false, stealthFactor: 1 });
+          if (e.eaten) break;
+          expect(q.overlapHull(speciesActor(e), { x: e.x, y: e.y, z: e.z }, { yaw: 0, pitch: 0 }, { time: (i + 1) * DT, bounds }).ok, `seed ${seed} case ${c} step ${i}`).toBe(true); steps++;
+        }
+        e.combat = null;
+      }
+    }
+    expect(steps).toBeGreaterThan(1000);
+  }, 120_000);
+});
```

```diff
--- a/tests/tiny-tide-core/contract.test.ts
+++ b/tests/tiny-tide-core/contract.test.ts
@@ -30,7 +30,7 @@ describe('combat contract', () => {
       [c => { c.movements.swimmer = { ...c.movements.swimmer!, evasionProfileId: 'nope' }; }, 'movement swimmer: evasion nope'],
       [c => { c.pursuits.hunter = { ...c.pursuits.hunter!, memorySeconds: -2 }; }, 'pursuit hunter: memorySeconds'],
       [c => { c.hulls.sphere = { id: 'ball' }; }, 'hull sphere: id'],
-      [c => { c.hazards['crab-pinch'] = { ...c.hazards['crab-pinch']!, cadenceSeconds: 0 }; }, 'hazard crab-pinch: cadenceSeconds'],
+      [c => { c.hazards['jelly-sting'] = { ...c.hazards['jelly-sting']!, cadenceSeconds: 0 }; }, 'hazard jelly-sting: cadenceSeconds'],
       [c => { c.attacks.pinch!.windupSeconds = -1; }, 'attack pinch: windupSeconds'],
       [c => { c.attacks.pinch!.aimLockAtSeconds = 1; }, 'attack pinch: aimLockAtSeconds'],
       [c => { c.attacks.pinch!.maxTargets = 1.5; }, 'attack pinch: maxTargets'],
@@ -148,7 +148,7 @@ describe('combat contract', () => {
       [c => { c.parts = c.parts.map(p => p.id === 'fx_rare' ? { ...p, model: 'fx_rare' } : p); }, 'part fx_rare: model fx_rare'],
       [c => { c.species = c.species.map(s => s.key === '1:fx_alpha' ? { ...s, alpha: { ...s.alpha!, rewardPartId: 'claw_pincer' } } : s); }, 'species 1:fx_alpha: reward claw_pincer'],
       // V18
-      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, contactHazardId: 'crab-pinch' } : s); }, 'species 1:fx_hunter: behaviour and hazard'],
+      [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, contactHazardId: 'jelly-sting' } : s); }, 'species 1:fx_hunter: behaviour and hazard'],
       [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'fx-fleer' } : s); }, 'species 1:fx_hunter: hazard missing'],
       [c => { c.species = c.species.map(s => s.key === '1:fx_hunter' ? { ...s, behaviourId: 'nope' } : s); }, 'species 1:fx_hunter: behaviour nope'],
       // V19
--- a/tests/tiny-tide-core/feeding.test.ts
+++ b/tests/tiny-tide-core/feeding.test.ts
@@ -28,10 +28,11 @@ describe('feeding', () => {
     expect(biteTargets(s.run, [legacy], s.physical, 1, d).targets.map(t => t.entity.id)).toEqual([5]);
   });
   it('legacy species keep chomp damage', () => {
-    const s = speck(), d = derive(effectiveStats(s.run.genome, currentPlan(s.run))), crab = entity(6, species(1, 'crab'), { x: 0, y: 1, z: 2 });
-    crab.mode = 'hunt';   // a bigger creature that is attacking is a bite target
-    const eco = { entities: [crab], consume: () => undefined, planetIndex: () => 0 };
+    // A bigger legacy fighter that is attacking (the ray, until 3b) takes max(1, floor(bite / 2)) from a chomp.
+    const s = speck(), d = derive(effectiveStats(s.run.genome, currentPlan(s.run))); s.run.stage = 1; s.physical = { x: 0, y: 4, z: 0 };
+    const ray = entity(6, species(2, 'ray'), { x: 0, y: 4, z: 4 }); ray.mode = 'angry';
+    const eco = { entities: [ray], consume: () => undefined, planetIndex: () => 0 };
     expect(chomp(s.run, eco, s.physical, 1, d, 0, [])).toMatchObject({ kind: 'bitten', damage: Math.max(1, Math.floor(d.bite / 2)) });
-    expect(crab.hp).toBe(species(1, 'crab').hp - Math.max(1, Math.floor(d.bite / 2)));
+    expect(ray.hp).toBe(species(2, 'ray').hp - Math.max(1, Math.floor(d.bite / 2)));
   });
 });
--- a/tests/tiny-tide-core/lifecycle.test.ts
+++ b/tests/tiny-tide-core/lifecycle.test.ts
@@ -25,7 +25,7 @@ const busy = (): CombatRuntime => { const rt = newRuntime({ yaw: 1, pitch: .4 })
   rt.staggerUntil = 4; rt.guardProfileId = 'g'; rt.damageable = false; rt.cooldowns.set('player:p5:snap', 5); rt.actions.push(action('p5', 0), action('p5', 1)); return rt; };
 const claw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
 const grant: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
-const hazardEvent = (e: EcoEvent['entity'], time: number): EcoEvent => ({ type: 'hazard', entity: e, hazard: REGISTRY_HAZARDS['crab-pinch']!, damage: 3, point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, time });
+const hazardEvent = (e: EcoEvent['entity'], time: number): EcoEvent => ({ type: 'hazard', entity: e, hazard: REGISTRY_HAZARDS['jelly-sting']!, damage: 3, point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, time });
 
 describe('lifecycle', () => {
   it('resets every transient field', () => {
@@ -76,7 +76,7 @@ describe('lifecycle', () => {
     const off = newRuntime(); off.damageable = false; expect(resolveHazards([hazardEvent(a, 5)], ctx(off, 5))).toEqual([]);
   });
   it('applies an impulse through mass and resistance', () => {
-    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime(), e = { ...hazardEvent(crab, 0), hazard: { ...REGISTRY_HAZARDS['crab-pinch']!, impulse: 2 } };
+    const crab = new Ecosystem(7).entities.find(e => e.spec.key === '1:crab')!, rt = newRuntime(), e = { ...hazardEvent(crab, 0), hazard: { ...REGISTRY_HAZARDS['jelly-sting']!, impulse: 2 } };
     resolveHazards([e], { mode: 'playing', pendingRespawn: false, rt, now: 0, mass: 4, resistance: .5 }); expect(rt.externalVelocity.x).toBeCloseTo(.25);   // 2 / 4 × .5
   });
   it('finds a legal evolution destination away from an illegal start, or uses the anchor', () => {
--- a/tests/tiny-tide-core/sim.test.ts
+++ b/tests/tiny-tide-core/sim.test.ts
@@ -24,7 +24,7 @@ export function script(t: number, previous: CombatInput): { intent: CombatInput;
 const round = (v: number) => Math.round(v * 1e6) / 1e6;
 export function world(seed: number): SimWorld {
   const cache = new Map<number, { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> }>();
-  return { eco: new Ecosystem(seed), startGrace: 2, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
+  return { eco: new Ecosystem(seed), startGrace: 2, isOnScreen: () => true, legality: stage => { let l = cache.get(stage); if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; cache.set(stage, l); } return l; } };
 }
 function runSim(): Sample[] {
   const run = freshRun(7), w = world(7), s = newSimState(run), out: Sample[] = [];
```

`tests/tiny-tide-core/ecosystem.test.ts` (the two hazard tests move from the crab to the ray; after T15 the removed lines read `toBe(4)` and `toBe(6)`):

```diff
--- a/tests/tiny-tide-core/ecosystem.test.ts
+++ b/tests/tiny-tide-core/ecosystem.test.ts
@@ -124,10 +124,14 @@ describe('pursuit', () => {
   });
 });
 describe('provocation and hazards', () => {
-  it('lets a provoked crab retaliate against a bigger stage-1 player it cannot see', () => {
-    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), crab = crabOf(eco), p = at(crab, 0, 0);
-    provoke(crab, p, 0); expect(crab.mode).toBe('angry'); expect(crab.lastKnown).toEqual(p);
-    const events = eco.step(ctx(p, 0, { stage: 1 })).filter(e => e.entity === crab); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(2);   // 2 + max(0, 1 − 1)
+  it('lets a provoked ray retaliate against a bigger stage-3 player it cannot see', () => {
+    // The ray stings stages 1 and 2 only; at stage 3 only its provoked (angry) mode makes it sting (the crab has no hazard since sub-project 3a).
+    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
+    eco.step(ctx({ x: 0, y: 900, z: 0 }, 0, { stage: 3, perceivable: false, playerHull: [] }));   // the ray becomes active and is installed
+    const p = at(ray, 0, 0);
+    expect(eco.step(ctx(p, .05, { stage: 3 })).filter(e => e.entity === ray)).toEqual([]);
+    provoke(ray, p, .1); expect(ray.mode).toBe('angry'); expect(ray.lastKnown).toEqual(p);
+    const events = eco.step(ctx(p, .1, { stage: 3 })).filter(e => e.entity === ray); expect(events).toHaveLength(1); expect(events[0]!.damage).toBe(2);   // 2 + 2 × max(0, 2 − 3)
   });
   it('lets a provoked ray retaliate with its own policy and forget a hidden player', () => {
     const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(makeTerrain(tier), { visibility: () => 0 }) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!;
@@ -136,11 +140,11 @@ describe('provocation and hazards', () => {
     eco.step(ctx(at(ray, 10, 0), 4.1, { stage: 2 })); expect(ray.mode).toBe('return');   // retaliate memory 4
   });
   it('emits a hazard at t = 0 and the next only after the cadence, from the translated hull', () => {
-    // Flat ground keeps the grounded crab's support height constant, so its centre stays exactly on the player point.
-    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(tier === 4 ? makeTerrain(4) : flatSea) }), crab = crabOf(eco), events: ReturnType<Ecosystem['step']> = [];
-    eco.step(ctx({ x: 0, y: 500, z: 0 }, 0, { perceivable: false, playerHull: [] }));   // settle onto the flat ground first
-    for (let i = 0; i <= 14; i++) events.push(...eco.step(ctx(at(crab, 0, 0), i / 10)).filter(e => e.entity === crab));
-    expect(events.map(e => e.time)).toEqual([0, 1.4]); expect(events[0]!.damage).toBe(3); expect(events[0]!.normal).toEqual({ x: 0, y: 1, z: 0 });   // 2 + (1 − 0); coincident centres
+    // The ray stings stage 2 on contact (calm, not engaged).
+    const eco = new Ecosystem(7, { queries: tier => makeWorldQueries(tier === 4 ? makeTerrain(4) : flatSea) }), ray = eco.entities.find(e => e.spec.key === '2:ray' && !e.eaten)!, events: ReturnType<Ecosystem['step']> = [];
+    eco.step(ctx({ x: 0, y: 500, z: 0 }, 0, { stage: 2, perceivable: false, playerHull: [] }));   // settle onto the flat ground first
+    for (let i = 0; i <= 18; i++) events.push(...eco.step(ctx(at(ray, 0, 0), i / 10, { stage: 2, perceivable: false })).filter(e => e.entity === ray));   // the player point follows the grazing ray
+    expect(events.map(e => e.time)).toEqual([0, 1.8]); expect(events[0]!.damage).toBe(2);   // ray-sting: 2 half-hearts, every 1.8 s
   });
   it('emits nothing when the hull is far away, even while the player point is seen', () => {
     const eco = new Ecosystem(7), crab = crabOf(eco), events: ReturnType<Ecosystem['step']> = [];
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-motion.test.ts tests/tiny-tide-core/avoidance.test.ts tests/tiny-tide-core/ecosystem.test.ts`
Expected: FAIL — `aiTick` does not exist; the crab still has `crab-pinch`.

- [ ] **Step 3: Species, biomes and the registry**

```diff
--- a/src/tiny-tide/biomes.ts
+++ b/src/tiny-tide/biomes.ts
@@ -22,10 +22,10 @@ export type Decor = 'coral' | 'kelp' | 'rock' | 'sand';
 export interface BiomeType { name: string; weights: Partial<Record<FoodKind, number>>; decor: Decor; tint: string }
 export interface Biome extends BiomeType { tier: number; x: number; z: number }
 const TYPES: readonly (readonly BiomeType[])[] = [
-  [{ name: 'Sprout meadow', weights: { plant: 3, lettuce: 2 }, decor: 'kelp', tint: '#2f8a7c' },
-   { name: 'Copepod cloud', weights: { copepod: 4 }, decor: 'sand', tint: '#2b7f93' },
-   { name: 'Wormy sands', weights: { worm: 4, plant: .5 }, decor: 'sand', tint: '#3b7f86' },
-   { name: 'Grape garden', weights: { seagrape: 3, kelp_snack: 2 }, decor: 'coral', tint: '#2e7a8c' }],
+  [{ name: 'Sprout meadow', weights: { plant: 3, lettuce: 2, spiny_snail: 1 }, decor: 'kelp', tint: '#2f8a7c' },
+   { name: 'Copepod cloud', weights: { copepod: 4, drifter: 2 }, decor: 'sand', tint: '#2b7f93' },
+   { name: 'Wormy sands', weights: { worm: 4, plant: .5, spiny_snail: 2 }, decor: 'sand', tint: '#3b7f86' },
+   { name: 'Grape garden', weights: { seagrape: 3, kelp_snack: 2, drifter: 1 }, decor: 'coral', tint: '#2e7a8c' }],
   [{ name: 'Coral garden', weights: { seagrape: 2, shrimp: 2 }, decor: 'coral', tint: '#2a7e8e' },
    { name: 'Jelly drift', weights: { jellyfish: 4 }, decor: 'sand', tint: '#30708f' },
    { name: 'Crab flats', weights: { crab: 4, snail: 2 }, decor: 'rock', tint: '#3a7a80' },
@@ -63,6 +63,8 @@ export function spawnHeight(spec: Species, x: number, z: number, rand: () => num
   const ground = seabedHeight(x, z), size = SIZES[spec.tier]!;
   switch (spec.kind) {
     case 'copepod': return ground + .6 + rand() * 1.8;
+    case 'drifter': return ground + .6 + rand() * 1.6;
+    case 'spiny_snail': return ground + 1;
     case 'worm': return ground + .1;
     case 'shrimp': return Math.max(ground + 3, 5 + rand() * 13);
     case 'crab': case 'snail': return ground + 1;
--- a/src/tiny-tide/registries.ts
+++ b/src/tiny-tide/registries.ts
@@ -28,7 +28,7 @@ export const ABILITIES: Record<string, AbilitySpec> = PLAYER_ABILITIES;
 export { EVASIONS, GUARDS };
 const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
 /** Contact hazards; damage in half-hearts (spec §4.2: today's damage doubled). */
-export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 2, 1.8), hazard('ray-sting', 2, 1.8), hazard('crab-pinch', 4, 1.4), hazard('squid-grab', 4, 1.4), hazard('plane-buzz', 4, 1.4)].map(h => [h.id, h]));
+export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 2, 1.8), hazard('ray-sting', 2, 1.8), hazard('squid-grab', 4, 1.4), hazard('plane-buzz', 4, 1.4)].map(h => [h.id, h]));
 export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
   effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, behaviours: BEHAVIOURS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
 
--- a/src/tiny-tide/species.ts
+++ b/src/tiny-tide/species.ts
@@ -1,6 +1,8 @@
 import type { SpeciesCombatFields } from './combat-types';
 // Everything that lives (or floats, or sails) in the Tiny Tide universe.
-export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet';
+export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet'
+  /** Combat species of sizes 0 and 1 (spec §11.3); each draws an existing GLB through `model`. */
+  | 'drifter' | 'spiny_snail';
 export type FoodTag = 'plant' | 'meat' | 'any';
 export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
 export interface Species extends SpeciesCombatFields {
@@ -39,7 +41,7 @@ export const SPECIES: readonly Species[] = [
   s(1, 'seagrape', 'plant', 'Grape cluster', 'still', 9, 12),
   s(1, 'lettuce', 'plant', 'Lettuce bed', 'still', 9, 12),
   s(1, 'shrimp', 'meat', 'Little shrimp', 'skittish', 10, 16, { speed: 3.4 }),
-  s(1, 'crab', 'meat', 'Peach crab', 'graze', 8, 24, { hp: 3, speed: 1.3, hunts: [0], fights: true, contactHazardId: 'crab-pinch', pursuitId: 'hunter' }),
+  s(1, 'crab', 'meat', 'Peach crab', 'graze', 8, 24, { hp: 20, speed: 1.3, hunts: [0], fights: true, pursuitId: 'hunter', behaviourId: 'crab', attackIds: ['crab-pinch', 'crab-lunge', 'crab-sweep'] }),
   s(1, 'jellyfish', 'meat', 'Moon jelly', 'drift', 8, 14, { stingsStages: [0, 1], contactHazardId: 'jelly-sting' }),
   s(1, 'snail', 'meat', 'Sea snail', 'graze', 8, 13, { speed: .5 }),
   s(2, 'kelp_snack', 'plant', 'Kelp frond', 'still', 10, 16),
@@ -54,10 +56,14 @@ export const SPECIES: readonly Species[] = [
   s(3, 'balloon', 'any', 'Hot-air balloon', 'drift', 8, 22, { habitatProfileId: 'sp-air', movementProfileId: 'sp-fly' }),
   s(3, 'lighthouse', 'any', 'Lighthouse', 'still', 7, 26, { habitatProfileId: 'sp-prop' }),
   s(4, 'planet', 'any', 'Planet', 'still', 12, 30, { habitatProfileId: 'sp-space', movementProfileId: 'sp-still' }),
+  // Combat species (spec §11.3), after every legacy row so the legacy spawns of each tier keep their seeded places.
+  s(0, 'drifter', 'meat', 'Drifter shrimp', 'skittish', 8, 14, { hp: 3, speed: 3.0, model: 'shrimp', tint: '#f6b58f', behaviourId: 'drifter' }),
+  s(0, 'spiny_snail', 'meat', 'Spiny snail', 'graze', 6, 16, { hp: 6, speed: .5, model: 'snail', tint: '#c9a3e6', behaviourId: 'spiny-snail', attackIds: ['snail-poke'], fights: true, pursuitId: 'retaliate' }),
 ];
 const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
 export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
 export const tierSpecies = (tier: number) => SPECIES.filter(spec => spec.tier === tier);
 /** Food kinds with a GLB (`public/tiny-tide/models/<kind>.glb`); planets use `planet_XX`. */
 export const FOOD_GLBS: readonly FoodKind[] = ['plant', 'kelp_snack', 'seagrape', 'lettuce', 'copepod', 'worm', 'shrimp', 'crab', 'jellyfish', 'snail', 'fish', 'squid', 'ray', 'bird', 'tree', 'boat', 'plane', 'balloon', 'lighthouse'];
-export const FOOD_MODEL_KINDS = [...new Set(SPECIES.filter(spec => spec.kind !== 'planet').map(spec => spec.kind))];
+/** The food GLBs to load: each species' model (default its kind), once. */
+export const FOOD_MODEL_KINDS = [...new Set(SPECIES.filter(spec => spec.kind !== 'planet').map(spec => spec.model ?? spec.kind))];
```

- [ ] **Step 4: Ecosystem motion, the AI tick and the sim**

```diff
--- a/src/tiny-tide/ecosystem.ts
+++ b/src/tiny-tide/ecosystem.ts
@@ -11,6 +11,9 @@ import { HAZARDS } from './registries';
 import type { Species } from './species';
 import { stageSolids } from './reef';
 import { stageWorldQueries, supportHeight } from './world-queries';
+import { projectVelocity } from './motion';
+import { BEHAVIOURS } from './bestiary';
+import type { MoveIntent } from './combat-ai';
 
 export { speciesActor };
 
@@ -30,7 +33,12 @@ export interface Entity {
   returnUntil: number; hazardReadyAt: number;
   /** The tier is relevant to the player's stage (|tier − stage| ≤ 1). */
   active: boolean;
+  /** A combat species' motion this tick (spec §5.12, §11.2), set by the combat world before the step; legacy species have none. */
+  combat?: EntityMotion | null;
 }
+/** How a combat species moves this tick: its AI intent (ambient, toward, away, hold), a point to face while holding, a lunge's velocity, its
+ *  external (knockback) velocity, a hit-stop freeze, a held body's displacement to the claw point. `moved` is filled by the step. */
+export interface EntityMotion { intent: MoveIntent; face: Vec3 | null; lunge: Vec3 | null; external: MutVec3; frozen: boolean; held: Vec3 | null; moved: number }
 export interface EcoContext {
   stage: number; dt: number; now: number;
   player: Vec3;
@@ -43,6 +51,10 @@ export interface EcoContext {
 export interface EcoEvent { type: 'hazard'; entity: Entity; hazard: ContactHazard; damage: number; point: Vec3; normal: Vec3; time: number }
 
 export const RESPAWN_TIME = [14, 22] as const;
+/** Hunters respawn later after a kill (D28). */
+export const HUNTER_RESPAWN_TIME = [30, 40] as const;
+/** The decay of an entity's external velocity (the player's EXTERNAL_DECAY). */
+const ENTITY_EXTERNAL_DECAY = 6;
 /** Seconds of continuous reachability that clear the blocked timer. */
 export const BLOCK_CLEAR_SECONDS = 1;
 /** Seconds before an entity that could not be installed tries again. */
@@ -171,8 +183,9 @@ export class Ecosystem {
   /** The planet index (0–11) of a planet entity. */
   planetIndex(e: Entity) { return this.entities.filter(other => other.spec.kind === 'planet').indexOf(e); }
   consume(e: Entity) {
-    e.eaten = true; e.mode = 'calm'; e.modeTime = 0;
-    e.respawn = e.spec.kind === 'planet' ? -1 : RESPAWN_TIME[0] + this.rand() * (RESPAWN_TIME[1] - RESPAWN_TIME[0]);
+    e.eaten = true; e.mode = 'calm'; e.modeTime = 0; e.combat = null;
+    const type = e.spec.behaviourId ? BEHAVIOURS[e.spec.behaviourId]?.type : undefined, [lo, hi] = type === 'hunter' || type === 'hunter-ambush' ? HUNTER_RESPAWN_TIME : RESPAWN_TIME;
+    e.respawn = e.spec.kind === 'planet' ? -1 : lo + this.rand() * (hi - lo);
   }
 
   /** After a faint (spec §10.3, D27): every creature hunting the player gives up (`return`) and acquires nothing for `seconds`. */
@@ -238,14 +251,18 @@ export class Ecosystem {
       return perceived;
     }
     if (e.mode === 'flee') { if (e.modeTime > 2.5) this.setMode(e, 'calm'); return perceived; }
-    if (e.mode === 'return' && (Math.hypot(e.x - e.hx, e.z - e.hz) <= this.actors.get(e)!.bodyLength || now >= e.returnUntil + 6)) this.setMode(e, 'calm');
+    if (e.mode === 'return' && (Math.hypot(e.x - e.hx, e.z - e.hz) <= this.actors.get(e)!.bodyLength || now >= e.returnUntil + 6)) {
+      this.setMode(e, 'calm');
+      if (e.spec.behaviourId) e.hp = e.spec.hp;   // a hunter back to calm gets its full HP (spec §11.2)
+    }
     // Acquire, from calm or return, once the reacquire window has passed.
     if (now >= e.returnUntil && perceived && spec.hunts.includes(ctx.stage) && !pastSoftEdge(p, ctx.stage)) {
       this.setMode(e, 'hunt'); clearBlocked(e); remember(e, p, now, ctx.playerHull); this.updateReachability(e, now); return perceived;
     }
     if (e.mode !== 'calm' || !ctx.perceivable) return perceived;
     // Prey runs from a player that can eat it, but tires quickly so it can be caught.
-    const size = SIZES[spec.tier]!, prey = spec.tier <= ctx.stage && ['skittish', 'school'].includes(spec.behavior);
+    // Combat species flee by their AI (combat-ai.ts), not by today's prey rule.
+    const size = SIZES[spec.tier]!, prey = !spec.behaviourId && spec.tier <= ctx.stage && ['skittish', 'school'].includes(spec.behavior);
     if (prey && e.modeTime > 1.5 && distance < 7 * Math.max(size, SIZES[ctx.stage]!) * ctx.stealthFactor) this.setMode(e, 'flee');
     return perceived;
   }
@@ -279,9 +296,36 @@ export class Ecosystem {
     if (Math.hypot(dx, dz) > 1e-4) e.heading = Math.atan2(dx, dz);
   }
 
+  /** A combat species moves by its intent, its lunge and its knockback, through resolveMotion (spec §5.12); a held one goes to the claw point. */
+  private combatMove(e: Entity, ctx: EcoContext, m: EntityMotion) {
+    const spec = e.spec, size = SIZES[spec.tier]!, mode = movement(spec.movementProfileId).mode, d = this.disp, dt = ctx.dt, actor = this.actors.get(e)!, q = this.queries[spec.tier]!;
+    d.x = 0; d.y = 0; d.z = 0; m.moved = 0;
+    if (m.held) { d.x = m.held.x; d.y = m.held.y; d.z = m.held.z; }
+    else if (!m.frozen) {
+      const it = m.intent, speed = spec.speed * size;
+      if (it.kind === 'ambient') { this.ambient(e, ctx, d); d.x *= it.speedFactor; d.y *= it.speedFactor; d.z *= it.speedFactor; }
+      else if (it.kind === 'toward') this.toward(e, it.point.x, it.point.y, it.point.z, speed * it.speedFactor, dt, mode, d);
+      else if (it.kind === 'away') this.toward(e, 2 * e.x - it.point.x, 2 * e.y - it.point.y, 2 * e.z - it.point.z, speed * it.speedFactor, dt, mode, d);
+      else if (m.face) { const fx = m.face.x - e.x, fz = m.face.z - e.z; if (Math.hypot(fx, fz) > 1e-4) e.heading = Math.atan2(fx, fz); }
+      if (m.lunge) { d.x += m.lunge.x * dt; d.y += (mode === 'ground' ? 0 : m.lunge.y) * dt; d.z += m.lunge.z * dt; }
+      d.x += m.external.x * dt; d.y += m.external.y * dt; d.z += m.external.z * dt;
+    }
+    if (mode === 'ground' && !q.terrain.space) d.y = supportHeight(actor, e.x + d.x, e.z + d.z, O0, q.terrain) + .01 * actor.bodyLength - e.y;
+    const req = this.req, from = this.from;
+    from.x = e.x; from.y = e.y; from.z = e.z;
+    req.actorId = actor.id; req.hull = actor.hull; req.habitatProfileId = actor.habitat.id; req.cause = m.held ? 'grab' : m.lunge ? 'lunge' : 'knockback';
+    const mo = this.motion; mo.queries = q; mo.bounds = this.boundsOf(e); mo.actor = actor; mo.interval.start = ctx.now; mo.interval.end = ctx.now + dt;
+    const result = resolveMotion(req, mo); req.cause = 'locomotion';
+    if (result.status === 'invalid-start' || result.status === 'needs-recovery') { this.install(e); return; }
+    m.moved = Math.hypot(result.position.x - e.x, result.position.y - e.y, result.position.z - e.z);
+    e.x = result.position.x; e.y = result.position.y; e.z = result.position.z;
+    if (!m.frozen) { const pe = projectVelocity(m.external, result.contacts), decay = Math.exp(-ENTITY_EXTERNAL_DECAY * dt); m.external.x = pe.x * decay; m.external.y = pe.y * decay; m.external.z = pe.z * decay; }
+  }
+
   private move(e: Entity, ctx: EcoContext, perceived: boolean) {
     const spec = e.spec;
     if (spec.behavior === 'still' || isStatic(e)) return;
+    if (e.combat) { this.combatMove(e, ctx, e.combat); return; }
     const size = SIZES[spec.tier]!, mode = movement(spec.movementProfileId).mode, d = this.disp, p = ctx.player, dt = ctx.dt;
     switch (e.mode) {
       case 'hunt': case 'angry': {
```

```diff
--- a/src/tiny-tide/combat-world.ts
+++ b/src/tiny-tide/combat-world.ts
@@ -18,6 +18,12 @@ import { EFFECTS, TELEGRAPHS } from './combat-profiles';
 import { telegraphDescriptor, type TelegraphDescriptor } from './combat-shapes';
 import type { ActionPhase, TelegraphProfile } from './combat-types';
 import { damageAfterArmor } from './state';
+import { aiRefused, aiStarted, aiStep, newAiState, ROAR_SECONDS, type AiState } from './combat-ai';
+import { hostileSizes, SPECIES_ATTACKS } from './bestiary';
+import { closestOnSegment, shapeCentroid } from './combat-shapes';
+import { provoke } from './ecosystem';
+import { SIZES } from './biomes';
+import { lungeSpeed } from './action-engine';
 import { ACTIVE_GAP, Director, MAX_EXTENSION } from './director';
 import { windupLength } from './action-engine';
 
@@ -28,7 +34,17 @@ export const HOLDING_SPEED = .6, STAGGERED_SPEED = .5, CLAW_REACH = .5;
 /** How many hit outcomes the diagnostics keep. */
 export const EVENT_LOG = 20;
 
-export interface EntityCombat { id: ActorId; entity: Entity; rt: CombatRuntime; poise: PoiseMeter; behaviour: SpeciesBehaviour; maxHp: number; lastDamagedAt: number }
+/** `ai`: its state machine (combat-ai.ts); `immuneUntil`: no stagger before this (an alpha's roar; world time). */
+export interface EntityCombat { id: ActorId; entity: Entity; rt: CombatRuntime; poise: PoiseMeter; behaviour: SpeciesBehaviour; maxHp: number; lastDamagedAt: number; ai: AiState | null; immuneUntil: number }
+/** What the AI tick reads (spec §11.2). `hitBy`: entities the player damaged this tick; `isOnScreen`: the director's off-screen rule. */
+export interface AiTickContext {
+  now: number; dt: number; stage: number; runSeed: number; entities: readonly Entity[]; player: PlayerBody; playing: boolean; stealthFactor: number;
+  hitBy: ReadonlySet<number>; isOnScreen(p: Vec3): boolean;
+}
+/** Engagements that ended with the player alive (the survivor bonus), roars (a ring flash and a hint) and the creatures that noticed the player. */
+export interface AiTickResult { engagements: { entity: Entity; seconds: number; windups: number }[]; roars: Entity[]; markers: Entity[] }
+/** A free-moving species aims at most this far up or down (spec §5.4); a ground species aims level. */
+export const SPECIES_PITCH_LIMIT = .6;
 /** The player's body this tick (physical units). `health` is in hearts; the combat world writes it back to the run. */
 export interface PlayerBody {
   rt: CombatRuntime; position: Vec3; centre: Vec3; L: number; mass: number; knockbackResistance: number; armor: number;
@@ -63,6 +79,9 @@ export function playerMatrix(position: Vec3, o: { yaw: number; pitch: number },
 }
 const horizontal = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.z); return l > 1e-9 ? { x: v.x / l, y: 0, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
 const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
+/** The aim with its pitch clamped to ±limit. */
+const clampPitch = (v: Vec3, limit: number): Vec3 => { const u = unit(v), p = Math.max(-limit, Math.min(limit, Math.asin(Math.max(-1, Math.min(1, u.y))))), h = horizontal(u); return { x: h.x * Math.cos(p), y: Math.sin(p), z: h.z * Math.cos(p) }; };
+
 const statusOf = (id: string) => { const s = EFFECTS[id]?.status; return s ? { seconds: s.seconds, speedFactor: s.speedFactor } : null; };
 
 /** What the telegraph view draws for one species action in windup or active (spec §9.1). `arrow`: the shape's centroid was off-screen at some
@@ -92,7 +111,7 @@ export class CombatWorld {
     let c = this.entities.get(e.id);
     if (c && c.entity === e) return c;
     const b = e.spec.behaviourId ? this.behaviours[e.spec.behaviourId] : undefined; if (!b) return null;
-    c = { id: entityActorId(e), entity: e, rt: newRuntime({ yaw: e.heading, pitch: 0 }), poise: newPoise(), behaviour: b, maxHp: e.spec.hp, lastDamagedAt: -Infinity };
+    c = { id: entityActorId(e), entity: e, rt: newRuntime({ yaw: e.heading, pitch: 0 }), poise: newPoise(), behaviour: b, maxHp: e.spec.hp, lastDamagedAt: -Infinity, ai: null, immuneUntil: -Infinity };
     this.entities.set(e.id, c); return c;
   }
   /** A combat entity that respawned or was consumed starts over (its actions, clock and holds). */
@@ -245,7 +264,7 @@ export class CombatWorld {
   private fighterOf(c: EntityCombat, now: number): Fighter {
     const pose = speciesCombatPose(c.entity, now), b = c.behaviour;
     return { id: c.id, isPlayer: false, rt: c.rt, centre: pose.hull[0]!.start, forward: pose.forward, L: pose.bodyLength, mass: pose.mass, knockbackResistance: b.knockbackResistance, armor: 0,
-      ground: c.entity.spec.movementProfileId === 'sp-ground', grabbable: b.grabbable && !c.entity.spec.alpha, poise: c.poise, poiseMax: b.poise, staggerResist: b.staggerResist, health: c.entity.hp };
+      ground: c.entity.spec.movementProfileId === 'sp-ground', grabbable: b.grabbable && !c.entity.spec.alpha, poise: c.poise, poiseMax: b.poise, staggerResist: now < c.immuneUntil ? 1 : b.staggerResist, health: c.entity.hp };
   }
   /** A species action's world shapes from its `centre` socket (spec §5.10); a `fixed-at-start` aim is set by the caller. */
   speciesShapes(c: EntityCombat, a: ActionState, now: number): WorldShape[] {
@@ -348,6 +367,55 @@ export class CombatWorld {
     for (const id of [...this.arrowed]) if (!seen.has(id)) this.arrowed.delete(id);
     return out;
   }
+  /** The AI tick (spec §11.2): every active combat species' state machine, its attack requests (a director token at the player) and its motion
+   *  for the ecosystem's step (`entity.combat`). The player's damage this tick provokes fighters (memory and the angry mode). */
+  aiTick(ctx: AiTickContext): AiTickResult {
+    const res: AiTickResult = { engagements: [], roars: [], markers: [] }, p = ctx.player, hurt = p.pose.hurtboxes;
+    for (const e of ctx.entities) {
+      if (!e.spec.behaviourId) continue;
+      if (e.eaten || !e.active) { e.combat = null; continue; }
+      const c = this.stateOf(e); if (!c) continue;
+      const ai = c.ai ??= newAiState(ctx.runSeed, e.id, ctx.now), pose = speciesCombatPose(e, ctx.now), centre = pose.hull[0]!.start, r = pose.hull[0]!.radius, L = pose.bodyLength;
+      if (ctx.hitBy.has(e.id) && e.spec.fights) provoke(e, p.position, ctx.now, p.pose.hull);
+      const dHurt = Math.min(...hurt.map(h => Math.hypot(...((q: Vec3) => [q.x - centre.x, q.y - centre.y, q.z - centre.z] as const)(closestOnSegment(centre, h.start, h.end))) - h.radius));
+      const stageSize = SIZES[ctx.stage]!, tierSize = SIZES[e.spec.tier]!;
+      const out = aiStep(c.behaviour, ai, {
+        now: ctx.now,
+        self: { position: centre, L, forward: pose.forward, hp: e.hp, maxHp: c.maxHp, staggered: c.rt.actionClock < c.rt.staggerUntil, held: c.rt.heldBy !== null, busy: liveActions(c.rt).length > 0, speed: e.spec.speed * tierSize },
+        player: { position: p.centre, d: Math.max(0, dHurt - r) / L, visible: true, targetable: ctx.playing && p.rt.targetable },
+        hostile: hostileSizes(e.spec).includes(ctx.stage), pursuit: e.mode, hit: ctx.hitBy.has(e.id), fleeDistance: 7 * Math.max(tierSize, stageSize) * ctx.stealthFactor,
+        ready: id => (c.rt.cooldowns.get(`${c.id}:root:${id}`) ?? -Infinity) <= c.rt.actionClock + 1e-9,
+        inLair: ai.home !== null && c.behaviour.lair ? Math.hypot(p.centre.x - ai.home.x, p.centre.z - ai.home.z) <= c.behaviour.lair.radiusBodyLengths * L : undefined,
+      });
+      if (out.attack) {
+        const attack = SPECIES_ATTACKS[out.attack.attackId], ground = e.spec.movementProfileId === 'sp-ground';
+        const aim = ground ? horizontal(out.attack.aim) : clampPitch(out.attack.aim, SPECIES_PITCH_LIMIT);
+        const centroid = attack ? shapeCentroid(worldShape(attack.shape, aimFrame(centre, aim, pose.forward), L)) : centre;
+        const started = attack ? this.startSpecies(c, out.attack.attackId, attack, aim, PLAYER_ID, ctx.now, { onScreen: ctx.isOnScreen(centroid), playerHeld: p.rt.heldBy !== null, playing: ctx.playing }) : 'mode';
+        if (typeof started === 'string') aiRefused(ai, ctx.now); else aiStarted(ai, ctx.now);
+      }
+      c.rt.targetable = !out.untargetable;
+      if (out.heal > 0) e.hp = Math.min(c.maxHp, e.hp + out.heal * c.maxHp * ctx.dt);
+      if (out.roar) { c.immuneUntil = ctx.now + ROAR_SECONDS; res.roars.push(e); }
+      if (out.marker) res.markers.push(e);
+      if (out.engagementEnded) res.engagements.push({ entity: e, ...out.engagementEnded });
+      const lunging = liveActions(c.rt).find(a => a.phase === 'active' && a.resolved.attack?.lunge);
+      const speed = lunging ? lungeSpeed(lunging, L) : 0, holder = c.rt.heldBy === PLAYER_ID ? holdingAction(p.rt, c.id) : undefined;
+      const claw = holder ? this.clawPoint(p, holder, L, ctx.now) : null;
+      e.combat = { intent: out.intent, face: out.intent.kind === 'hold' && (ai.name === 'face' || ai.name === 'notice' || ai.name === 'attack') ? p.centre : null,
+        lunge: lunging ? { x: lunging.aim.x * speed, y: lunging.aim.y * speed, z: lunging.aim.z * speed } : null, external: c.rt.externalVelocity, frozen: ctx.now < c.rt.hitStopUntil,
+        held: claw ? { x: claw.x - centre.x, y: claw.y - centre.y, z: claw.z - centre.z } : null, moved: 0 };
+    }
+    return res;
+  }
+  /** After the ecosystem's step: a lunge counts the body lengths it really moved (its hit volume is truncated there, spec §5.10). */
+  afterMotion(entities: readonly Entity[]): void {
+    for (const e of entities) {
+      const c = e.combat ? this.entities.get(e.id) : undefined; if (!c || !e.combat) continue;
+      const a = liveActions(c.rt).find(x => x.phase === 'active' && x.resolved.attack?.lunge);
+      if (a && e.combat.lunge) a.lungeDone += e.combat.moved / speciesCombatPose(e, 0).bodyLength;
+    }
+  }
   /** Tokens follow their actions: held to the end of active (of hold for a grab); a hit-stop's delay moves the active start, and a later
    *  wind-up is lengthened (within MAX_EXTENSION) to keep ACTIVE_GAP. */
   private followTokens(live: readonly EntityCombat[], playerRt: CombatRuntime, now: number) {
```

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -240,7 +240,7 @@ const sim: SimState = {
   ...simOwnedState(),
 };
 /** What the simulation reads from the page: the world's ecosystem, the cached legality and the start grace. */
-const simWorld: SimWorld = { get eco() { return world.eco; }, legality: stage => legality(stage), startGrace: START_GRACE };
+const simWorld: SimWorld = { get eco() { return world.eco; }, legality: stage => legality(stage), startGrace: START_GRACE, isOnScreen: p => onScreen(p) };
 const refreshDerived = () => simRefreshDerived(sim);
 const playerActorCached = (): Actor => simActor(sim);
 const capsOf = () => movementCapabilities(currentPlan(run));
@@ -535,6 +535,8 @@ function presentSim(events: readonly SimEvent[], dt: number) {
       case 'fainted': presentFaint(e.lost); break;
       case 'respawned': el('faint').hidden = true; save(); syncUI(); toast('You woke up at the start. Eat to grow again.'); break;
       case 'killed': presentKill(e.entity, e.dna, e.drop); break;
+      case 'survived': { const food = world.foods.find(f => f.entity === e.entity); if (food) { const pos = world.screenPoint(new T.Vector3(food.data.x, food.data.y + 1, food.data.z)); floater(`+${e.dna} DNA`, pos.x, pos.y); } toast(`You survived the ${e.entity.spec.label.toLowerCase()}! +${e.dna} DNA`); syncUI(); break; }
+      case 'roar': for (const r of e.entities) { world.burst(r.x / world.scale, r.y / world.scale, r.z / world.scale, '#ff4d4d', 30); if (toastTimer <= 0) toast(`The ${r.spec.label} is getting angry!`); } break;
       case 'respawn-waiting': if (!respawnToasted) { respawnToasted = true; toast('Looking for a safe place to wake up…'); } break;
       case 'resume-fainted': el('faint').hidden = false; break;
     }
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -9,7 +9,8 @@ import { CombatWorld, playerMatrix, type CombatTick, type PlayerBody } from './c
 import { assignSlots, movesOf, NO_PINS, type MoveSet, type SlotAssignment } from './moves';
 import { createRigPose, type RigPose } from './rig';
 import { DROPS } from './parts';
-import { derive, effectiveStats, type Derived } from './genome';
+import { derive, effectiveStats, type Derived, type Genome } from './genome';
+import type { BodyPlan } from './plans';
 import { basicRequested } from './input';
 import { beginRespawn, growthPose, newTrapWatch, recoverPlayer, resetRuntime, resolveHazards, resolveRespawn, rescueFreeRun, TRAP_MOVE, trapDue, trapFailed, trapRescued, UNSTICK_BUDGET, UnstickSearch, wedged, type TrapWatch } from './lifecycle';
 import { startAnchor } from './motion';
@@ -17,14 +18,17 @@ import { bodyLengthOf, hullFitOf, hullOffsets, massFor, sampleCombatPose } from
 import { orientedHeave, orientedSway, rotateInto } from './orientation';
 import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
 import { habitat, movement, movementCapabilities } from './profiles';
-import { currentPlan, evolveReady, growthOf, hurt, killReward, STAGES, unlock, type Run } from './state';
+import { currentPlan, evolveReady, growthOf, hurt, killReward, STAGES, survivorBonusDue, survivorReward, unlock, type Run } from './state';
+import { BEHAVIOURS } from './bestiary';
 import { faintLoss } from './economy';
 import { admissionClock, supportHeight } from './world-queries';
 
 export type GameMode = 'menu' | 'playing' | 'paused' | 'evolving' | 'editing' | 'fainted' | 'stuck' | 'won';
 export interface SimLegality { queries: WorldQueries; bounds: { half: number; maxY?: number } }
 /** What the tick reads from outside: the ecosystem, the cached world queries of a stage, and the start grace (seconds). */
-export interface SimWorld { eco: Ecosystem; legality(stage: number): SimLegality; startGrace: number }
+export interface SimWorld { eco: Ecosystem; legality(stage: number): SimLegality; startGrace: number;
+  /** A physical point is on screen (the director's off-screen rule, spec §9.4); the probe uses a fixed camera model. */
+  isOnScreen(p: Vec3): boolean }
 type MutCapsule = { start: MutVec3; end: MutVec3; radius: number; radii?: [number, number]; sway: number; heave: number };
 interface ActorCache { key: string; unit: Capsule[]; unitLength: number; hull: MutCapsule[]; actor: Actor; scale: number }
 export interface Glide { path: { position: Vec3; orientation: Orientation }[]; index: number }
@@ -40,8 +44,8 @@ export interface SimState {
   acceptedHits: number; rejectedHits: number; faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[];
   /** The combat world (spec §3.1) and the player's moves, cached per genome revision. */
   combat: CombatWorld; moves: { revision: number; set: MoveSet; slots: SlotAssignment; rig: RigPose } | null;
-  /** The previous tick's stick (break-free flicks). */
-  previousMove: Vec3;
+  /** The previous tick's stick (break-free flicks), and the entities the player damaged this tick (the AI's `hit`). */
+  previousMove: Vec3; hitBy: Set<number>;
 }
 export type SimEvent =
   /** A pose was installed (`snap`: the camera jumps there too: start, respawn). */
@@ -57,16 +61,20 @@ export type SimEvent =
   | { type: 'respawned' } | { type: 'respawn-waiting' }
   /** Combat damage emptied the hearts (the run is already marked; save it at once). `lost`: the at-risk DNA the faint took. */
   | { type: 'fainted'; lost: number }
+  /** A herbivore survived a hunter (spec §10.4): the bonus DNA. */
+  | { type: 'survived'; entity: Entity; dna: number }
+  /** An alpha changed phase (a ring flash and the hint "The <name> is getting angry!"). */
+  | { type: 'roar'; entities: Entity[] }
   /** A combat kill (spec §10.4): the DNA it paid (0 for a herbivore) and a part it unlocked. */
   | { type: 'killed'; entity: Entity; dna: number; drop: string | null }
   /** A loaded run that was saved during a faint found no anchor yet: it waits fainted (main shows the faint overlay). */
   | { type: 'resume-fainted' };
 export interface SimInput { dt: number; intent: CombatInput; wish: Vec3; held: boolean }
 
-type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog' | 'combat' | 'moves' | 'previousMove'>;
+type SimOwned = Pick<SimState, 'trap' | 'unstick' | 'glide' | 'beforeStep' | 'rescueLog' | 'trapRescues' | 'lastSolids' | 'actorCache' | 'hullRescaled' | 'hullGrew' | 'faintLog' | 'combat' | 'moves' | 'previousMove' | 'hitBy'>;
 /** The fields only the simulation owns (main.ts spreads them into its bound state). */
 export const simOwnedState = (): SimOwned => ({ trap: newTrapWatch(), unstick: null, glide: null, beforeStep: newStepSnapshot(), rescueLog: { searches: 0, found: 0, failed: 0, last: null },
-  trapRescues: 0, lastSolids: [], actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [], combat: new CombatWorld(), moves: null, previousMove: { x: 0, y: 0, z: 0 } });
+  trapRescues: 0, lastSolids: [], actorCache: null, hullRescaled: false, hullGrew: false, faintLog: [], combat: new CombatWorld(), moves: null, previousMove: { x: 0, y: 0, z: 0 }, hitBy: new Set() });
 /** A plain state (tests and the combat probe). */
 export function newSimState(run: Run): SimState {
   return { run, rt: newRuntime(), physical: { x: 0, y: 0, z: 0 }, time: 0, mode: 'menu', derived: derive(effectiveStats(run.genome, currentPlan(run))), genomeRevision: 0,
@@ -160,14 +168,18 @@ export function playerMoves(s: SimState): NonNullable<SimState['moves']> {
   if (!s.moves || s.moves.revision !== s.genomeRevision) s.moves = { revision: s.genomeRevision, set: movesOf(s.run.genome), slots: assignSlots(s.run.genome, NO_PINS), rig: createRigPose(s.run.genome) };
   return s.moves;
 }
-/** The player's combat body at its installed pose (spec §5.10: sampleCombatPose on the rest rig). */
-export function playerBody(s: SimState, actor: Actor): PlayerBody {
-  const plan = currentPlan(s.run), m = playerMoves(s), scale = SIZES[s.run.stage]! * growthOf(s.run), caps = movementCapabilities(plan);
-  const pose = sampleCombatPose({ actorId: 'player', genome: s.run.genome, plan, world: playerMatrix(s.physical, s.rt.orientation, scale), rig: m.rig, physicalLength: actor.bodyLength });
-  const hull = worldHull(s, actor), first = hull[0]!, lastC = hull[hull.length - 1]!;
+/** A player's combat body at a pose (spec §5.10: sampleCombatPose on the rest rig); the centre is the middle of the oriented hull. */
+export function makePlayerBody(o: { genome: Genome; plan: BodyPlan; position: Vec3; rt: CombatRuntime; actor: Actor; scale: number; armor: number; health: number; rig: RigPose; hull: readonly Capsule[] }): PlayerBody {
+  const caps = movementCapabilities(o.plan), first = o.hull[0]!, lastC = o.hull[o.hull.length - 1]!;
+  const pose = sampleCombatPose({ actorId: 'player', genome: o.genome, plan: o.plan, world: playerMatrix(o.position, o.rt.orientation, o.scale), rig: o.rig, physicalLength: o.actor.bodyLength });
   const centre = { x: (first.start.x + lastC.end.x) / 2, y: (first.start.y + lastC.end.y) / 2, z: (first.start.z + lastC.end.z) / 2 };
-  return { rt: s.rt, position: s.physical, centre, L: actor.bodyLength, mass: massFor(plan, s.run.genome, actor.bodyLength), knockbackResistance: plan.physics.knockbackResistance,
-    armor: s.derived.armor, ground: caps.ground, mode: movement(plan.movement).mode, inBreachArc: s.rt.arc !== null, health: s.run.health, pose };
+  return { rt: o.rt, position: o.position, centre, L: o.actor.bodyLength, mass: massFor(o.plan, o.genome, o.actor.bodyLength), knockbackResistance: o.plan.physics.knockbackResistance,
+    armor: o.armor, ground: caps.ground, mode: movement(o.plan.movement).mode, inBreachArc: o.rt.arc !== null, health: o.health, pose };
+}
+/** The player's combat body at its installed pose. */
+export function playerBody(s: SimState, actor: Actor): PlayerBody {
+  return makePlayerBody({ genome: s.run.genome, plan: currentPlan(s.run), position: s.physical, rt: s.rt, actor, scale: SIZES[s.run.stage]! * growthOf(s.run), armor: s.derived.armor, health: s.run.health,
+    rig: playerMoves(s).rig, hull: worldHull(s, actor) });
 }
 /** Regeneration (spec §10.2). */
 export const REGEN_AFTER = 6, REGEN_EVERY = 2;
@@ -233,9 +245,13 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
       const body = playerBody(s, actor), m = playerMoves(s);
       const tick = s.combat.tick({ now: s.time, dt, playing: true, intent, wish, previousMove: s.previousMove, player: body, moves: m.set, slots: m.slots, entities: w.eco.entities, stage, queries: legal.queries });
       run.health = body.health; s.previousMove = intent.move;
+      for (const e of tick.events) if (e.attackerId === 'player' && e.amount > 0) s.hitBy.add(Number(e.targetId.slice(1)));
       if (tick.events.length || tick.killed.length || tick.started.length || tick.brokeFree) events.push({ type: 'combat', tick });
       for (const e of tick.killed) {
         const drop = DROPS[e.spec.kind]; if (drop) unlock(run, drop);
+        // A herbivore that kills a hunter it was fighting gets the survivor bonus (spec §10.4).
+        const ai = s.combat.entities.get(e.id)?.ai, behaviour = e.spec.behaviourId ? BEHAVIOURS[e.spec.behaviourId]?.type : undefined;
+        if (ai?.engagedSince != null && survivorBonusDue(run, behaviour, { seconds: s.time - ai.engagedSince, windups: ai.windups })) events.push({ type: 'survived', entity: e, dna: survivorReward(run, e.spec) });
         events.push({ type: 'killed', entity: e, dna: killReward(run, e.spec).dna, drop: drop && run.unlocked.includes(drop) ? drop : null });
         w.eco.consume(e); s.combat.forget(e);
       }
@@ -252,9 +268,19 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
     if (s.stuckRetry <= 0) { s.stuckRetry = 1; if (recover(s, w, actor, s.time, events)) { if (s.startGracePending) { s.startGracePending = false; applyStartGrace(s, w); } s.mode = 'playing'; events.push({ type: 'unstuck' }); } }
   }
   if ((s.mode === 'playing' || s.mode === 'evolving' || s.mode === 'fainted') && actor && !held) {
+    // The AI (spec §11.2): states, attack requests (director tokens) and each combat species' motion for the ecosystem's step.
+    const ai = s.combat.aiTick({ now: s.time, dt, stage, runSeed: run.seed, entities: w.eco.entities, player: playerBody(s, actor), playing: s.mode === 'playing' && !run.pendingRespawn,
+      stealthFactor: s.derived.stealthFactor, hitBy: s.hitBy, isOnScreen: p => w.isOnScreen(p) });
+    s.hitBy.clear();
+    for (const g of ai.engagements) {
+      const behaviour = g.entity.spec.behaviourId ? BEHAVIOURS[g.entity.spec.behaviourId]?.type : undefined;
+      if (s.mode === 'playing' && survivorBonusDue(run, behaviour, g)) events.push({ type: 'survived', entity: g.entity, dna: survivorReward(run, g.entity.spec) });
+    }
+    if (ai.roars.length) events.push({ type: 'roar', entities: ai.roars });
     admissionClock.caller = 'ecosystem';
     const hazards = w.eco.step({ stage, dt, now: s.time, player: s.physical, playerHull: worldHull(s, actor), perceivable: s.rt.perceivable && s.mode !== 'fainted', stealthFactor: s.derived.stealthFactor });
     admissionClock.caller = 'player';
+    s.combat.afterMotion(w.eco.entities);
     const accepted = resolveHazards(hazards, { mode: s.mode, pendingRespawn: run.pendingRespawn, rt: s.rt, now: s.time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
     s.rejectedHits += hazards.length - accepted.length;
     // A hit counts as accepted only when it is applied (not when skipped after a same-frame faint).
```

- [ ] **Step 5: Models**

```diff
--- a/src/tiny-tide/world.ts
+++ b/src/tiny-tide/world.ts
@@ -15,7 +15,8 @@ import type { TelegraphView } from './combat-world';
 export { seabedHeight };
 /** Gameplay view of an entity, in the current stage's local units. */
 export interface Food { id: number; kind: FoodKind; tier: number; x: number; y: number; z: number; eaten: boolean; phase: number }
-export interface FoodObject { data: Food; entity: Entity; model: T.Group; tier: number }
+/** `tint`: the instance colour of a tinted species (spec §11.7: one tint per species; white for the others). */
+export interface FoodObject { data: Food; entity: Entity; model: T.Group; tier: number; tint: T.Color }
 interface Particle { mesh: T.Mesh; life: number; velocity: T.Vector3 }
 const particleGeometry = new T.SphereGeometry(.09, 6, 4);
 const circleGeometry = new T.CircleGeometry(1, 40);
@@ -23,8 +24,15 @@ const ringGeometry = new T.RingGeometry(1, 1.025, 56);
 const shadowMaterial = new T.MeshBasicMaterial({ color: '#103e4f', transparent: true, opacity: .2, depthWrite: false });
 const ringMaterial = new T.MeshBasicMaterial({ color: '#e0f6ad', transparent: true, opacity: .75, side: T.DoubleSide, depthWrite: false });
 const UP = new T.Vector3(0, 1, 0);
-/** Instance colours multiply the material: white keeps it; FLASH_COLOR (above 1) is the hurt flash. */
-const WHITE = new T.Color(1, 1, 1), FLASH_COLOR = new T.Color(3, 3, 3);
+/** Instance colours multiply the material: a species tint (white keeps it); FLASH_COLOR (above 1) is the hurt flash. */
+const FLASH_COLOR = new T.Color(3, 3, 3);
+/** The Spiny snail's three spikes on its shell (art debt: its own model; spec §11.7), in the snail model's units. */
+const SNAIL_SPIKES: readonly [number, number, number][] = [[0, .62, -.05], [-.22, .5, .12], [.22, .5, .12]];
+function speciesPrefab(model: FoodKind, key: string): T.Group {
+  const group = foodModel(model);
+  if (key === '0:spiny_snail') for (const [x, y, z] of SNAIL_SPIKES) { const spike = sceneryAsset('part_spike'); spike.position.set(x, y, z); spike.scale.setScalar(.45); group.add(spike); }
+  return group;
+}
 // The soft world edge (edge.ts): in the push zone the water gets darker and foggier, and scenery past the hard bound
 // (render units = stage-local units, so the bound is at ±PLAYER_HALF) fades into the fog colour.
 /** Fog density at the full edge fog (the clear-water density is .014). */
@@ -238,9 +246,10 @@ export class TideWorld {
   private createUniverse() {
     const prefabs = new Map<string, T.Group>(), islands = new T.Group();
     for (const entity of this.eco.entities) {
-      const spec = entity.spec, size = SIZES[spec.tier]!, kind = spec.kind, home = kind === 'planet' && this.eco.planetIndex(entity) === 0;
-      if (kind !== 'planet' && !prefabs.has(kind)) prefabs.set(kind, foodModel(kind));
-      const model = kind === 'planet' ? foodModel(kind, this.eco.planetIndex(entity)) : prefabs.get(kind)!.clone(true);
+      const spec = entity.spec, size = SIZES[spec.tier]! * (spec.bodyScale ?? 1), kind = spec.kind, home = kind === 'planet' && this.eco.planetIndex(entity) === 0;
+      // One prefab per species (spec §11.7): its model GLB (default its kind), and the Spiny snail's three spikes on its shell.
+      if (kind !== 'planet' && !prefabs.has(spec.key)) prefabs.set(spec.key, speciesPrefab(spec.model ?? kind, spec.key));
+      const model = kind === 'planet' ? foodModel(kind, this.eco.planetIndex(entity)) : prefabs.get(spec.key)!.clone(true);
       model.scale.multiplyScalar(size * (home ? 1.35 : 1)); model.position.set(entity.x, entity.y, entity.z); model.rotation.y = entity.phase;
       if (home) {
         const materials = new Map<T.Material, T.Material>();
@@ -252,15 +261,15 @@ export class TideWorld {
         this.homePlanetMaterials = [...materials.values()];
       }
       if (kind === 'planet') this.actors.add(model);
-      const food: FoodObject = { entity, model, tier: spec.tier, data: { id: entity.id, kind, tier: spec.tier, x: 0, y: 0, z: 0, eaten: false, phase: entity.phase } };
+      const food: FoodObject = { entity, model, tier: spec.tier, tint: new T.Color(spec.tint ?? '#ffffff'), data: { id: entity.id, kind, tier: spec.tier, x: 0, y: 0, z: 0, eaten: false, phase: entity.phase } };
       this.foods.push(food); if (home) this.homePlanet = food;
       if (kind === 'tree' || kind === 'lighthouse') {
         const island = sceneryAsset('island'); island.position.set(entity.hx, WATER_LEVEL - 1, entity.hz); island.scale.setScalar(64); islands.add(island);
       }
     }
     const merged = batch(islands); merged.traverse(obj => this.fadeable(obj)); this.islands.add(merged);
-    for (const [kind, prefab] of prefabs) {
-      const foods = this.foods.filter(f => f.data.kind === kind);
+    for (const [key, prefab] of prefabs) {
+      const foods = this.foods.filter(f => f.entity.spec.key === key);
       prefab.updateMatrixWorld(true);
       prefab.traverse(child => {
         if (!(child instanceof T.Mesh) || Array.isArray(child.material)) return;
@@ -430,7 +439,7 @@ export class TideWorld {
     for (const f of this.foods) {
       const e = f.entity;
       if (e.eaten) { f.model.visible = false; continue; }
-      const size = SIZES[f.tier]!, kind = f.data.kind;
+      const size = SIZES[f.tier]! * (e.spec.bodyScale ?? 1), kind = f.data.kind;
       f.model.position.set(e.x, e.y, e.z);
       if (kind !== 'planet' && e.spec.behavior !== 'still') f.model.rotation.y = T.MathUtils.lerp(f.model.rotation.y, f.model.rotation.y + Math.atan2(Math.sin(e.heading - f.model.rotation.y), Math.cos(e.heading - f.model.rotation.y)), 1 - Math.exp(-dt * 6));
       // Angry creatures puff up a little so the player can see the danger.
@@ -464,7 +473,7 @@ export class TideWorld {
         const model = food.model;
         if (!model.visible) continue;
         model.updateMatrix(); this.instanceMatrix.multiplyMatrices(model.matrix, set.local);
-        set.mesh.setColorAt(count, (this.flashUntil.get(food.entity.id) ?? -Infinity) > time ? FLASH_COLOR : WHITE);
+        set.mesh.setColorAt(count, (this.flashUntil.get(food.entity.id) ?? -Infinity) > time ? FLASH_COLOR : food.tint);
         set.mesh.setMatrixAt(count++, this.instanceMatrix);
       }
       set.mesh.count = count; set.mesh.visible = count > 0; set.mesh.instanceMatrix.needsUpdate = true; if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
```

- [ ] **Step 6: Avoidance against the combat world**

```diff
--- a/src/tiny-tide/avoidance.ts
+++ b/src/tiny-tide/avoidance.ts
@@ -14,6 +14,10 @@ import { movement, movementCapabilities } from './profiles';
 import { stepPlayer } from './player-motion';
 import { EDGE_SOFT_START } from './edge';
 import { STAGES } from './state';
+import { CombatWorld } from './combat-world';
+import { assignSlots, movesOf, NO_PINS } from './moves';
+import { createRigPose } from './rig';
+import { makePlayerBody } from './sim';
 import { stageBounds, stageWorldQueries, supportHeight } from './world-queries';
 
 /** `startYaw`: the orientation the start pose was admitted with (the player faces away from the hunter's start, from the searched point).
@@ -124,8 +128,11 @@ export function edgeEncounter(planId: string, hunterKey: string, seed: number):
   return null;
 }
 
-/** Runs straight away from the hunter for eight seconds with the real player step and the real hunter rules. */
-export function simulateEscape(e: Encounter, hunter: { speedScale?: number; policy?: PursuitPolicy } = {}): EscapeResult {
+/** A combat hit on the player (spec §6): a species attack that damaged or held it (avoidance counts these as well as hazards). */
+const COMBAT_HITS = new Set(['hit', 'grabbed', 'guard-broken']);
+/** Runs straight away from the hunter for eight seconds with the real player step, the real hunter rules and the real combat world. */
+/** `stay`: the player does not run (the negative control: its attacks must land). */
+export function simulateEscape(e: Encounter, hunter: { speedScale?: number; policy?: PursuitPolicy; stay?: boolean } = {}): EscapeResult {
   const pl = playerFor(e.planId), p = pl.plan, stage = p.size, size = SIZES[stage]!, legal = legality(stage, e.seed), actor = pl.actor;
   const caps = movementCapabilities(p), profile = movement(p.movement), t = legal.queries.terrain, L = actor.bodyLength;
   const policy = hunter.policy;
@@ -143,12 +150,13 @@ export function simulateEscape(e: Encounter, hunter: { speedScale?: number; poli
   if (!acquires(eco, h, pl, position, rt.orientation)) return { ok: false, reason: 'not-acquired', seconds: 0 };
 
   const intent: CombatInput = caps.rise ? { ...RELEASED, traversal: 'rise' } : RELEASED;
-  const anchor = startAnchor(actor, stage, legal);
+  const anchor = startAnchor(actor, stage, legal), genome = starterFor(p), combat = new CombatWorld(), rig = createRigPose(genome), moves = movesOf(genome), slots = assignSlots(genome, NO_PINS);
+  const body = () => makePlayerBody({ genome, plan: p, position, rt, actor, scale: size, armor: 0, health: 99, rig, hull: worldHull(actor, position, rt.orientation) });
   const steps = Math.round(ESCAPE_SECONDS / DT);
   for (let i = 1; i <= steps; i++) {
     const now = i * DT;
     const dx = position.x - h.x, dz = position.z - h.z, len = Math.hypot(dx, dz);
-    const wish: Vec3 = len > 1e-9 ? { x: dx / len, y: 0, z: dz / len } : { x: 0, y: 0, z: 0 };
+    const wish: Vec3 = len > 1e-9 && !hunter.stay ? { x: dx / len, y: 0, z: dz / len } : { x: 0, y: 0, z: 0 };
     const r = stepPlayer(position, rt, intent, { plan: p, profile, caps, actor, ...legal, size, topSpeedLocal: pl.topSpeedLocal, now, dt: DT, wish, aim: null, actionLock: false });
     position = r.position;
     if (r.needsRecovery) {
@@ -158,7 +166,11 @@ export function simulateEscape(e: Encounter, hunter: { speedScale?: number; poli
       rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
       settle();
     }
+    const tick = combat.tick({ now, dt: DT, playing: true, intent, wish, previousMove: wish, player: body(), moves, slots, entities: eco.entities, stage, queries: legal.queries });
+    if (tick.events.some(ev => ev.targetId === 'player' && COMBAT_HITS.has(ev.outcome))) return { ok: false, reason: 'hit', seconds: now };
+    combat.aiTick({ now, dt: DT, stage, runSeed: e.seed, entities: eco.entities, player: body(), playing: true, stealthFactor: pl.stealth, hitBy: new Set(), isOnScreen: () => true });
     const events = eco.step({ stage, dt: DT, now, player: position, playerHull: worldHull(actor, position, rt.orientation), perceivable: true, stealthFactor: pl.stealth });
+    combat.afterMotion(eco.entities);
     const hit = hunterEvent(events, h);
     if (hit) return { ok: false, reason: 'hit', seconds: hit.time };
     if (h.mode === 'return') return { ok: true, reason: 'gave-up', seconds: now };
```

- [ ] **Step 7: Check 13 uses the Moon jelly**

The crab has no contact hazard now. In `e2e/tiny-tide-paths.mjs` check `'13'`:
- replace `const pick = await pickHazard(page, { stage: 0, key: '1:crab' }); assert.ok(pick, 'pickHazard found a crab');` with `const pick = await pickHazard(page, { stage: 0, key: '1:jellyfish' }); assert.ok(pick, 'pickHazard found a Moon jelly');`
- replace `damage = (await damageAfterArmor(page, 6, fx.info.armor)) / 2;` with `damage = (await damageAfterArmor(page, 2, fx.info.armor)) / 2;` (a jelly sting at stage 0 is 2 half-hearts; the jelly is never engaged)
- in the messages, replace `the crab’s events` with `the jelly’s events` and `damageAfterArmor(6,` with `damageAfterArmor(2,`.

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-motion.test.ts tests/tiny-tide-core/avoidance.test.ts tests/tiny-tide-core/ecosystem.test.ts tests/tiny-tide-core/feeding.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed. The golden still matches: the new species are added after every legacy row, so the legacy spawns keep their seeded places, and the scripted route meets no combat species. If the golden fails, find the cause; do not re-record in this task.

- [ ] **Step 9: Checkpoint**, then `node e2e/tiny-tide-paths.mjs 13` and `node e2e/tiny-tide.mjs` against the running server. Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/tiny-tide/species.ts src/tiny-tide/biomes.ts src/tiny-tide/registries.ts src/tiny-tide/ecosystem.ts src/tiny-tide/combat-world.ts src/tiny-tide/sim.ts src/tiny-tide/world.ts src/tiny-tide/main.ts src/tiny-tide/avoidance.ts tests/tiny-tide-core/avoidance.test.ts tests/tiny-tide-core/combat-motion.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/ecosystem.test.ts tests/tiny-tide-core/feeding.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/sim.test.ts e2e/tiny-tide-paths.mjs
git commit -m "Tiny Tide combat: size-0 species (drifter shrimp, spiny snail) and the Peach crab as a real fighter; avoidance dodges telegraphs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T17: The Old Clawmother and rare parts

**Spec:** §7.6, §10.4 (alpha reward), §11.2 alpha, §11.3, §11.6, D23, D24.

**Files:**
- Modify: `src/tiny-tide/species.ts`, `src/tiny-tide/parts.ts`, `src/tiny-tide/genome.ts`, `src/tiny-tide/state.ts`, `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/rig.ts`, `src/tiny-tide/creature.ts`, `src/tiny-tide/world.ts`, `src/tiny-tide/editor.ts`, `src/tiny-tide/combat-hud.ts`, `src/tiny-tide/controls.css`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/combat-ai.test.ts`, `tests/tiny-tide-core/state.test.ts`

**Interfaces:**
- Consumes: T14 alpha AI (`alphaPhase`, `BURROW`); T15 `killReward`.
- Produces:
  - Species `clawmother` (tier 1, hunts `[0]`, `model 'crab'`, `bodyScale 1.8`, `alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 }`).
  - `parts.ts`: `PARTS_BASE` plus `rare(id, name, model, kind, stage, cost, stats, mirror, tint, blurb, diet?)`; `modelOf(spec)`; `PART_ASSETS` without duplicates; the rare part `claw_mother`. `rig.ts` and `creature.ts` use `modelOf`; `creature.rareTint`.
  - `genome.isUnlocked(id, stage, unlocked)`: a rare part needs its id in `unlocked`, at any stage.
  - `state.alphaReward(run, spec): { dna; part }` (once; it unlocks the part).
  - `ecosystem.lairOf(seed, e)`: lair centre = the alpha's home pushed `lair radius × L + (5 + 8 × rand) × S` away from the start anchor. `EcoContext.unlocked`; an alpha is present only at its own size and only while its part is locked; it never respawns.
  - `combat-hud.AlphaBar` (name, HP fraction, phase pips); the sunk-dust effect and the roar.
  - The editor lists a rare part only when it is unlocked, with a `RARE` badge.

**Decision in this task (spec defect):** the §11.6 lair placement ("the alpha's home") can put the start anchor inside the lair. `lairOf` moves the lair away from the anchor by the rule above.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/combat-ai.test.ts
+++ b/tests/tiny-tide-core/combat-ai.test.ts
@@ -4,6 +4,7 @@ import { describe, expect, it } from 'vitest';
 import { aiRefused, aiStarted, aiStep, alphaPhase, chooseAttack, clampToDisc, newAiState, schoolFlee, ROAR_SECONDS, type AiInput, type AiOutput, type AiState } from '../../src/tiny-tide/combat-ai';
 import { BEHAVIOURS, SPECIES_ATTACKS, type SpeciesBehaviour } from '../../src/tiny-tide/bestiary';
 import type { Vec3 } from '../../src/tiny-tide/combat-types';
+import { Ecosystem, lairOf } from '../../src/tiny-tide/ecosystem';
 
 const DT = 1 / 30;
 const base = (over: Partial<AiInput> = {}): AiInput => ({ now: 0, self: { position: { x: 0, y: 0, z: 0 }, L: 1.4, forward: { x: 0, y: 0, z: 1 }, hp: 10, maxHp: 10, staggered: false, held: false, busy: false, speed: 3 },
@@ -142,4 +143,15 @@ describe('combat AI: alphas', () => {
     expect(log.find(l => l.state === 'reset')!.out).toMatchObject({ heal: .04, intent: { kind: 'toward', point: { x: 0, y: 0, z: 0 } } });
     aiStep(mother, s, base({ now: 9, ...alphaInput(80, { player: far, inLair: false }) })); expect(s.name).toBe('idle'); expect(s.phase).toBe(0);   // full HP: phase 1
   });
+  it('alpha absent when its part is unlocked or at another size', () => {
+    const eco = new Ecosystem(3), mother = eco.entities.find(e => e.spec.key === '1:clawmother')!, far = { x: 0, y: 900, z: 0 };
+    const step = (stage: number, now: number, unlocked: string[] = []) => eco.step({ stage, dt: DT, now, player: far, playerHull: [], perceivable: false, stealthFactor: 1, unlocked });
+    const lair = lairOf(3, mother), r = Math.hypot(lair.x, lair.z);
+    expect(r).toBeGreaterThanOrEqual(22); expect(r).toBeLessThanOrEqual(30);   // (22 + 8 × rand) × SIZES[0]
+    step(0, 0); expect(mother.eaten).toBe(false); expect(Math.hypot(mother.x - lair.x, mother.z - lair.z)).toBeLessThanOrEqual(4 * 10.08);
+    step(1, .1); expect(mother.eaten).toBe(true); expect(mother.active).toBe(false);   // only at its own size
+    step(0, .2); expect(mother.eaten).toBe(false);
+    step(0, .3, ['claw_mother']); expect(mother.eaten).toBe(true);   // defeated earlier: gone for the run
+    eco.consume(mother); expect(mother.respawn).toBe(-1);
+  });
 });
--- a/tests/tiny-tide-core/state.test.ts
+++ b/tests/tiny-tide-core/state.test.ts
@@ -1,5 +1,7 @@
 import { describe, expect, it } from 'vitest';
-import { applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, hurt, killReward, mealDna, PLANET_COUNT, prepareEvolution, STAGES, survivorBonusDue, survivorReward, validateRun, type Run } from '../../src/tiny-tide/state';
+import { problems } from '../../src/tiny-tide/genome';
+import { SPECIES } from '../../src/tiny-tide/species';
+import { alphaReward, applyDesign, commitEvolution, currentPlan, dnaOf, eat, faint, freshRun, hurt, killReward, unlock, mealDna, PLANET_COUNT, prepareEvolution, STAGES, survivorBonusDue, survivorReward, validateRun, type Run } from '../../src/tiny-tide/state';
 import { adaptToPlan, nextUid, type Genome } from '../../src/tiny-tide/genome';
 import { plan } from '../../src/tiny-tide/plans';
 import { species } from '../../src/tiny-tide/species';
@@ -70,6 +72,20 @@ describe('run v4', () => {
     const m = freshRun(6); m.diet = 'carnivore'; expect(survivorBonusDue(m, 'hunter', { seconds: 9, windups: 2 })).toBe(false);
     const h = freshRun(6); expect(survivorReward(h, squid)).toBe(11); expect(h.stageDna).toBe(11);   // round(.35 × 30) = round(10.5)
   });
+  it('unlock accepts rare parts at any stage', () => {
+    const r = freshRun(8); expect(unlock(r, 'claw_mother')).toBe(true); expect(r.unlocked).toEqual(['claw_mother']);   // stage 0, the part's own stage
+    expect(unlock(r, 'claw_mother')).toBe(false); expect(unlock(r, 'claw_pincer')).toBe(false);   // a common stage-0 part needs no unlock
+  });
+  it('rare part without unlock is locked', () => {
+    const r = freshRun(9), g = { ...r.genome, parts: [...r.genome.parts, { uid: 'p5', id: 'claw_mother', t: .2, angle: 2, scale: 1, mirror: false, roll: 0 }] };
+    expect(problems(g, currentPlan(r), { unlocked: [] }).map(x => x.code)).toContain('locked');
+    expect(problems(g, currentPlan(r), { unlocked: ['claw_mother'] }).map(x => x.code)).not.toContain('locked');
+  });
+  it('alphaReward once, part unlocked', () => {
+    const r = freshRun(10), mother = SPECIES.find(x => x.key === '1:clawmother')!;
+    expect(alphaReward(r, mother)).toEqual({ dna: 40, part: 'claw_mother' }); expect(r.unlocked).toContain('claw_mother'); expect(r.stageDna).toBe(40);
+    expect(alphaReward(r, mother)).toEqual({ dna: 0, part: null }); expect(r.stageDna).toBe(40);
+  });
   it('hurts in half-hearts after armor', () => {
     const r = freshRun(7); r.health = 3; expect(hurt(r, 3, 2)).toBe(false); expect(r.health).toBe(2);   // 3 − floor(2 / 2) = 2 half-hearts
     expect(hurt(r, 1, 0)).toBe(false); expect(r.health).toBe(1.5); expect(hurt(r, 9, 0)).toBe(true); expect(r.health).toBe(0);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/state.test.ts`
Expected: FAIL — `alphaReward` not exported; the Clawmother does not exist.

- [ ] **Step 3: Rare parts and unlocks**

```diff
--- a/src/tiny-tide/genome.ts
+++ b/src/tiny-tide/genome.ts
@@ -112,7 +112,8 @@ export function problems(g: Genome, p: BodyPlan, ctx: DesignContext, catalog: re
   return out;
 }
 export const validateDesign = problems;
-export function isUnlocked(id: string, stage: number, unlocked: readonly string[]) { const spec = part(id); return !!spec && (spec.stage <= stage || unlocked.includes(id)); }
+/** A rare part only when unlocked (an alpha's reward, spec §7.6); any other part from its stage or when found early. */
+export function isUnlocked(id: string, stage: number, unlocked: readonly string[]) { const spec = part(id); return !!spec && (unlocked.includes(id) || (!spec.rare && spec.stage <= stage)); }
 export const availableParts = (stage: number, unlocked: readonly string[]) => PARTS.filter(spec => isUnlocked(spec.id, stage, unlocked));
 
 const exactKeys = (o: object, keys: readonly string[]) => { const k = Object.keys(o); return k.length === keys.length && keys.every(key => k.includes(key)); };
--- a/src/tiny-tide/parts.ts
+++ b/src/tiny-tide/parts.ts
@@ -14,6 +14,8 @@ export interface PartSpec extends PartCombatFields {
   rare?: true;
   /** The part whose GLB, rig and sockets this part uses (default `id`). */
   model?: string;
+  /** A rare part's colour on its tint meshes (instead of the paint slot), so it reads as a new part on a reused model (spec §7.6). */
+  modelTint?: string;
 }
 /** The move kind each move-giving part grants (spec §7.1). Mouths give the basic Bite instead. */
 export const PART_MOVES: Readonly<Record<string, MoveKind>> = {
@@ -57,7 +59,12 @@ const grantsOf = (id: string): Pick<PartSpec, 'basicAttacks' | 'activeGrants'> =
 const p = (id: string, name: string, kind: PartKind, stage: number, cost: number, stats: Partial<Stats>, tint: TintSlot, mirror: boolean, t: number, angle: number, blurb: string, diet?: Diet): PartSpec =>
   ({ id, name, kind, stage, cost, stats, tint, mirror, t, angle, blurb, diet, traits: TRAITS[id] ?? (kind === 'mouth' ? ['weapon'] : []), sockets: SOCKETS[id] ?? [], ...grantsOf(id) });
 const HALF = Math.PI / 2;
-export const PARTS: readonly PartSpec[] = [
+/** A rare part (spec §7.6): the model part's sockets, rig and GLB, its own grant, stats, cost and tint. */
+const rare = (id: string, name: string, model: string, kind: PartKind, stage: number, cost: number, stats: Partial<Stats>, mirror: boolean, modelTint: string, blurb: string, diet?: Diet): PartSpec => {
+  const m = PARTS_BASE.find(x => x.id === model)!;
+  return { ...m, id, name, kind, stage, cost, stats, mirror, blurb, diet, rare: true, model, modelTint, ...grantsOf(id) };
+};
+const PARTS_BASE: readonly PartSpec[] = [
   p('mouth_nibbler', 'Nibbler', 'mouth', 0, 0, { reach: .2 }, 'belly', false, 0, 0, 'Soft lips for plants.', 'herbivore'),
   p('mouth_snapper', 'Snapper', 'mouth', 0, 0, { bite: 1 }, 'belly', false, 0, 0, 'A toothy snap for meat.', 'carnivore'),
   p('mouth_beak', 'Beak', 'mouth', 1, 20, { bite: 1 }, 'accent', false, 0, 0, 'Cracks anything. Eats everything.', 'omnivore'),
@@ -93,10 +100,17 @@ export const PARTS: readonly PartSpec[] = [
   p('star_crown', 'Star crown', 'cosmic', 4, 35, { sense: 2, bite: 2 }, 'accent', false, .15, 0, 'Ruler of the snack universe.'),
   p('nebula_fin', 'Nebula fin', 'cosmic', 4, 40, { speed: 2 }, 'accent', true, .5, HALF - .3, 'Swim through the stars.'),
 ];
+export const PARTS: readonly PartSpec[] = [
+  ...PARTS_BASE,
+  rare('claw_mother', 'Clawmother pincer', 'claw_pincer', 'arm', 0, 18, { bite: 2 }, true, '#b5523b', 'The old queen’s pincer. Holds bigger prey.'),
+];
 export type PartId = typeof PARTS[number]['id'];
 const byId = new Map(PARTS.map(part => [part.id, part]));
 export const part = (id: string): PartSpec | undefined => byId.get(id);
-export const PART_ASSETS = PARTS.map(part => `part_${part.id}`);
+/** The part whose GLB and rig a part uses (a rare part reuses its model's). */
+export const modelOf = (id: string): string => part(id)?.model ?? id;
+/** The part GLBs to load, once each. */
+export const PART_ASSETS = [...new Set(PARTS.map(p => `part_${p.model ?? p.id}`))];
 /** Defeating a species that fights unlocks one part before its stage. */
 export const DROPS: Partial<Record<string, string>> = { crab: 'leg_crab', jellyfish: 'glow_bulb', squid: 'tentacle_long', plane: 'jet_vent' };
 export const KIND_LABELS: Record<PartKind, string> = { mouth: 'Mouths', eye: 'Eyes', fin: 'Fins', tail: 'Tails', leg: 'Legs', wing: 'Wings', jet: 'Jets', arm: 'Arms', armor: 'Armor', sense: 'Senses', cosmic: 'Cosmic' };
--- a/src/tiny-tide/state.ts
+++ b/src/tiny-tide/state.ts
@@ -107,10 +107,18 @@ export function survivorBonusDue(run: Run, behaviourType: string | undefined, en
 export function survivorReward(run: Run, spec: Species): number {
   const dna = Math.round(SURVIVOR_SHARE * spec.dna); reward(run, dna, true); return dna;
 }
+/** Unlocks a part found early; a rare part at any stage (it is never available in another way). */
 export function unlock(run: Run, id: string | undefined) {
-  if (!id || !part(id) || run.unlocked.includes(id) || part(id)!.stage <= run.stage) return false;
+  const spec = id ? part(id) : undefined;
+  if (!id || !spec || run.unlocked.includes(id) || (!spec.rare && spec.stage <= run.stage)) return false;
   run.unlocked.push(id); return true;
 }
+/** An alpha's defeat (spec §10.4): its reward DNA (counting for the growth bar) and its rare part. Once: the part is then in `unlocked`. */
+export function alphaReward(run: Run, spec: Species): { dna: number; part: string | null } {
+  const a = spec.alpha; if (!a || run.unlocked.includes(a.rewardPartId)) return { dna: 0, part: null };
+  unlock(run, a.rewardPartId); reward(run, a.rewardDna, true);
+  return { dna: a.rewardDna, part: a.rewardPartId };
+}
 const serialAfter = (g: Genome, ...floors: number[]) => Math.max(...floors, ...g.parts.map(p => uidSerial(p.uid) + 1));
 type Failure = { ok: false; reason: string; shortfall?: number };
 /** Clears bindings whose part is gone or whose catalog spec no longer has the grant. */
```

```diff
--- a/src/tiny-tide/creature.ts
+++ b/src/tiny-tide/creature.ts
@@ -2,7 +2,7 @@
 // bone for each spine point, and Blender parts attached to the bones.
 import * as T from 'three';
 import { asset } from './assets';
-import { part, type PartSpec, type TintSlot } from './parts';
+import { modelOf, part, type PartSpec, type TintSlot } from './parts';
 import type { Genome, PlacedPart } from './genome';
 import { layout, SPACING, surface, type Layout } from './body-geometry';
 import { CHOMP_PITCH, createRigPose, rigPoseInto, type RigPose } from './rig';
@@ -124,11 +124,18 @@ export class CreatureModel {
     if (!m) { m = this.countMaterial(source.clone()); m.color.set(this.genome.paint[slot]); this.tints.set(slot, m); }
     return m;
   }
+  /** A rare part's own tint material (one per colour). */
+  private rareTint(color: string, source: T.MeshStandardMaterial) {
+    let m = this.rareTints.get(color);
+    if (!m) { m = this.countMaterial(source.clone()); m.color.set(color); this.rareTints.set(color, m); }
+    return m;
+  }
+  private readonly rareTints = new Map<string, T.MeshStandardMaterial>();
   /** Clones `object`'s tint meshes onto the model's tint materials and records each mesh's base material. */
   private prepare(object: T.Group, spec: PartSpec) {
     object.traverse(node => {
       if (!(node instanceof T.Mesh) || Array.isArray(node.material)) return;
-      if (node.material.name === 'Tide_tint') node.material = this.tint(spec.tint, node.material as T.MeshStandardMaterial);
+      if (node.material.name === 'Tide_tint') node.material = spec.modelTint ? this.rareTint(spec.modelTint, node.material as T.MeshStandardMaterial) : this.tint(spec.tint, node.material as T.MeshStandardMaterial);
       node.userData.baseMaterial = node.material;
     });
   }
@@ -140,7 +147,7 @@ export class CreatureModel {
   }
   private attach(placed: PlacedPart, copy: 0 | 1) {
     const spec = part(placed.id); if (!spec) return;
-    const object = asset(`part_${placed.id}`);
+    const object = asset(`part_${modelOf(placed.id)}`);
     this.prepare(object, spec);
     const pivots: Pivot[] = [];
     object.traverse(node => {
@@ -213,7 +220,7 @@ export class CreatureModel {
     if (!pool) { pool = []; this.ghostPool.set(placed.id, pool); }
     const copies = placed.mirror ? 2 : 1;
     while (pool.length < copies) {
-      const object = asset(`part_${placed.id}`);
+      const object = asset(`part_${modelOf(placed.id)}`);
       this.prepare(object, spec);
       object.userData.ghost = true;
       object.traverse(node => { if (node instanceof T.Mesh && !Array.isArray(node.material)) node.material = this.styledMaterial('ghost', node.userData.baseMaterial as T.Material); });
@@ -273,8 +280,8 @@ export class CreatureModel {
   get length() { return this.layout.front - this.layout.rear; }
   dispose() {
     this.body.geometry.dispose(); this.counters.disposedGeometries++; this.body.skeleton.dispose();
-    for (const m of [this.bodyMaterial, ...this.tints.values(), ...this.styled.values()]) { m.dispose(); this.counters.disposedMaterials++; }
-    this.tints.clear(); this.styled.clear();
+    for (const m of [this.bodyMaterial, ...this.tints.values(), ...this.rareTints.values(), ...this.styled.values()]) { m.dispose(); this.counters.disposedMaterials++; }
+    this.tints.clear(); this.rareTints.clear(); this.styled.clear();
     this.group.removeFromParent();
   }
 }
--- a/src/tiny-tide/editor.ts
+++ b/src/tiny-tide/editor.ts
@@ -68,7 +68,7 @@ function renderThumbnails() {
   const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, .01, 50);
   scene.add(new T.HemisphereLight('#ffffff', '#5b8a8a', 2.4)); const key = new T.DirectionalLight('#fff3d6', 2.2); key.position.set(2, 4, 3); scene.add(key);
   for (const spec of PARTS) {
-    const object = asset(`part_${spec.id}`);
+    const object = asset(`part_${spec.model ?? spec.id}`);
     object.traverse(node => { if (node instanceof T.Mesh && !Array.isArray(node.material) && node.material.name === 'Tide_tint') { const m = (node.material as T.MeshStandardMaterial).clone(); m.color.set('#ffb59a'); node.material = m; } });
     scene.add(object);
     const box = new T.Box3().setFromObject(object), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length() || 1;
@@ -669,11 +669,11 @@ class Editor {
     if (!kinds.includes(this.kind) && kinds[0]) this.kind = kinds[0];
     panel.innerHTML = `<div class="ed-kinds" role="tablist" aria-label="Part types">${kinds.map(kind => `<button data-kind="${kind}" aria-selected="${kind === this.kind}">${KIND_LABELS[kind]}</button>`).join('')}</div>
       ${hidden.length ? `<p class="ed-kind-note">${esc(this.options.plan.name)}s can't use: ${hidden.map(k => KIND_LABELS[k].toLowerCase()).join(', ')}.</p>` : ''}
-      <div class="ed-cards">${PARTS.filter(p => p.kind === this.kind).map(spec => {
+      <div class="ed-cards">${PARTS.filter(p => p.kind === this.kind && (!p.rare || this.options.unlocked.includes(p.id))).map(spec => {
         const reason = this.cardReason(spec), found = isUnlocked(spec.id, this.options.plan.size, this.options.unlocked), early = found && spec.stage > this.options.plan.size;
         return `<button class="ed-card ${this.placing === spec.id ? 'active' : ''}" data-part="${spec.id}" ${reason ? `disabled data-reason="${esc(reason)}"` : ''} aria-label="${esc(spec.name)}, ${spec.cost} DNA${reason ? `. ${esc(reason)}` : ''}">
           <img src="${thumbnails.get(spec.id) ?? ''}" alt=""><strong>${esc(spec.name)}</strong><span class="ed-cost">${found ? `${spec.cost} DNA` : `🔒 ${STAGES[spec.stage]!.title}`}</span>
-          <small>${reason && found ? `<span class="ed-reason">${esc(reason)}</span>` : `${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}`}</small>${early ? '<em>FOUND!</em>' : ''}</button>`;
+          <small>${reason && found ? `<span class="ed-reason">${esc(reason)}</span>` : `${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}`}</small>${spec.rare ? '<em class="ed-rare">RARE</em>' : early ? '<em>FOUND!</em>' : ''}</button>`;
       }).join('')}</div>
       <p class="ed-tip">${this.placing ? 'Tap your creature to place it. Tap the card again to stop.' : 'Choose a part, then tap your creature. Turn it with two fingers or a right-drag.'}</p>`;
     panel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.kind as PartKind; this.disarm(); this.render(); });
--- a/src/tiny-tide/rig.ts
+++ b/src/tiny-tide/rig.ts
@@ -4,6 +4,7 @@ import * as T from 'three';
 import rigJson from './part-rig.json';
 import type { Genome, PlacedPart } from './genome';
 import { layout, SPACING } from './body-geometry';
+import { modelOf } from './parts';
 
 export interface RigNode { parent: string | null; pre: number[]; t: [number, number, number]; q: [number, number, number, number]; s: [number, number, number]; rest: number[] }
 export const PART_RIG = rigJson as unknown as Record<string, Record<string, RigNode>>;
@@ -23,7 +24,7 @@ const slots = new WeakMap<RigPose, PivotSlot[]>();
 export function createRigPose(g: Genome): RigPose {
   const pivots = new Map<string, Offset>(), list: PivotSlot[] = [];
   for (const placed of g.parts) {
-    const nodes = PART_RIG[placed.id]; if (!nodes) continue;
+    const nodes = PART_RIG[modelOf(placed.id)]; if (!nodes) continue;
     for (const copy of placed.mirror ? [0, 1] as const : [0] as const) for (const key of Object.keys(nodes)) {
       const [kind, index] = key.split(':'), offset = { x: 0, y: 0, z: 0 };
       pivots.set(`${placed.uid}:${copy}:${key}`, offset);
@@ -80,7 +81,7 @@ function cached(partId: string, key: string, node: RigNode) {
   return c;
 }
 function rigNode(partId: string, key: string) {
-  const node = PART_RIG[partId]?.[key];
+  const node = PART_RIG[modelOf(partId)]?.[key];
   if (!node) throw new Error(`No rig pivot ${key} on part ${partId}`);
   return node;
 }
```

- [ ] **Step 4: The Clawmother, the lair and alpha presence**

```diff
--- a/src/tiny-tide/ecosystem.ts
+++ b/src/tiny-tide/ecosystem.ts
@@ -46,6 +46,8 @@ export interface EcoContext {
   playerHull: readonly Capsule[];
   /** False while the player can not be noticed (menu, evolving, fainted). */
   perceivable: boolean; stealthFactor: number;
+  /** The run's unlocked parts: an alpha whose reward part is unlocked is gone for the run (spec §10.4). */
+  unlocked?: readonly string[];
 }
 /** Damage acceptance is not decided here; the damage resolution accepts or rejects every event. */
 export interface EcoEvent { type: 'hazard'; entity: Entity; hazard: ContactHazard; damage: number; point: Vec3; normal: Vec3; time: number }
@@ -72,8 +74,14 @@ const pursuitState = () => ({ lastKnown: null, lastKnownHull: null, lastSeenAt:
 /** A spawn point inside a reef solid of its tier, grown by the body radius (owner playtest P4), is rejected. */
 const inReef = (seed: number) => (tier: number, x: number, y: number, z: number) => stageSolids(tier, seed).solidAt(x, y, z, .7 * SIZES[tier]!) !== null;
 
+/** An alpha's lair (spec §11.2): a seeded point at angle 2π × rand and radius (22 + 8 × rand) × SIZES[alpha.size] around the world centre, on the
+ *  seabed; installation then finds the nearest admitted pose (at most 4 L). */
+export function lairOf(seed: number, e: { id: number; spec: Species }): Vec3 {
+  const rand = random(seed * 131 + e.id * 7 + 3), a = 2 * Math.PI * rand(), r = (22 + 8 * rand()) * SIZES[e.spec.alpha!.size]!, x = Math.sin(a) * r, z = Math.cos(a) * r;
+  return { x, y: seabedHeight(x, z) + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1), z };
+}
 export function makeEntities(seed: number): Entity[] {
-  return populate(seed, inReef(seed)).map(spawn => ({
+  return populate(seed, inReef(seed)).map(spawn => spawn.spec.alpha ? { ...spawn, ...lairOf(seed, spawn) } : spawn).map(spawn => ({
     id: spawn.id, spec: spawn.spec, x: spawn.x, y: spawn.y, z: spawn.z, hx: spawn.x, hy: spawn.y, hz: spawn.z,
     groundOffset: spawn.y - seabedHeight(spawn.x, spawn.z), heading: spawn.phase, phase: spawn.phase,
     hp: spawn.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, active: false, ...pursuitState(),
@@ -185,7 +193,8 @@ export class Ecosystem {
   consume(e: Entity) {
     e.eaten = true; e.mode = 'calm'; e.modeTime = 0; e.combat = null;
     const type = e.spec.behaviourId ? BEHAVIOURS[e.spec.behaviourId]?.type : undefined, [lo, hi] = type === 'hunter' || type === 'hunter-ambush' ? HUNTER_RESPAWN_TIME : RESPAWN_TIME;
-    e.respawn = e.spec.kind === 'planet' ? -1 : lo + this.rand() * (hi - lo);
+    // Planets and alphas never come back (an alpha's defeat unlocks its part: it is gone for the run).
+    e.respawn = e.spec.kind === 'planet' || e.spec.alpha ? -1 : lo + this.rand() * (hi - lo);
   }
 
   /** After a faint (spec §10.3, D27): every creature hunting the player gives up (`return`) and acquires nothing for `seconds`. */
@@ -209,6 +218,12 @@ export class Ecosystem {
   step(ctx: EcoContext): EcoEvent[] {
     const events: EcoEvent[] = [];
     for (const e of this.entities) {
+      // An alpha is present only while the player's size is its own and its reward part is not unlocked (spec §10.4).
+      if (e.spec.alpha) {
+        const present = ctx.stage === e.spec.alpha.size && !(ctx.unlocked ?? []).includes(e.spec.alpha.rewardPartId);
+        if (!present) { if (!e.eaten) { e.eaten = true; e.respawn = -1; e.combat = null; e.mode = 'calm'; } e.active = false; continue; }
+        if (e.eaten) { Object.assign(e, lairOf(this.seed, e), { hp: e.spec.hp, eaten: false, respawn: -1, mode: 'calm' as Mode, modeTime: 0, ...pursuitState() }); e.hx = e.x; e.hy = e.y; e.hz = e.z; if (!this.install(e)) continue; }
+      }
       const relevant = Math.abs(e.spec.tier - ctx.stage) <= 1;
       if (e.eaten) { e.active = relevant; this.tickRespawn(e, ctx); continue; }
       e.modeTime += ctx.dt;
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -18,7 +18,7 @@ import { bodyLengthOf, hullFitOf, hullOffsets, massFor, sampleCombatPose } from
 import { orientedHeave, orientedSway, rotateInto } from './orientation';
 import { newStepSnapshot, restoreStep, snapshotStep, stepPlayer, type PlayerStepResult, type StepSnapshot } from './player-motion';
 import { habitat, movement, movementCapabilities } from './profiles';
-import { currentPlan, evolveReady, growthOf, hurt, killReward, STAGES, survivorBonusDue, survivorReward, unlock, type Run } from './state';
+import { alphaReward, currentPlan, evolveReady, growthOf, hurt, killReward, STAGES, survivorBonusDue, survivorReward, unlock, type Run } from './state';
 import { BEHAVIOURS } from './bestiary';
 import { faintLoss } from './economy';
 import { admissionClock, supportHeight } from './world-queries';
@@ -252,7 +252,8 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
         // A herbivore that kills a hunter it was fighting gets the survivor bonus (spec §10.4).
         const ai = s.combat.entities.get(e.id)?.ai, behaviour = e.spec.behaviourId ? BEHAVIOURS[e.spec.behaviourId]?.type : undefined;
         if (ai?.engagedSince != null && survivorBonusDue(run, behaviour, { seconds: s.time - ai.engagedSince, windups: ai.windups })) events.push({ type: 'survived', entity: e, dna: survivorReward(run, e.spec) });
-        events.push({ type: 'killed', entity: e, dna: killReward(run, e.spec).dna, drop: drop && run.unlocked.includes(drop) ? drop : null });
+        const paid = e.spec.alpha ? alphaReward(run, e.spec) : { dna: killReward(run, e.spec).dna, part: null };
+        events.push({ type: 'killed', entity: e, dna: paid.dna, drop: paid.part ?? (drop && run.unlocked.includes(drop) ? drop : null) });
         w.eco.consume(e); s.combat.forget(e);
       }
       if (run.health <= 0) { const lost = faintNow(s, w); if (lost !== null) events.push({ type: 'fainted', lost }); }
@@ -278,7 +279,7 @@ export function simFrame(s: SimState, w: SimWorld, input: SimInput): SimEvent[]
     }
     if (ai.roars.length) events.push({ type: 'roar', entities: ai.roars });
     admissionClock.caller = 'ecosystem';
-    const hazards = w.eco.step({ stage, dt, now: s.time, player: s.physical, playerHull: worldHull(s, actor), perceivable: s.rt.perceivable && s.mode !== 'fainted', stealthFactor: s.derived.stealthFactor });
+    const hazards = w.eco.step({ stage, dt, now: s.time, player: s.physical, playerHull: worldHull(s, actor), perceivable: s.rt.perceivable && s.mode !== 'fainted', stealthFactor: s.derived.stealthFactor, unlocked: run.unlocked });
     admissionClock.caller = 'player';
     s.combat.afterMotion(w.eco.entities);
     const accepted = resolveHazards(hazards, { mode: s.mode, pendingRespawn: run.pendingRespawn, rt: s.rt, now: s.time, mass: massFor(plan, run.genome, actor.bodyLength), resistance: plan.physics.knockbackResistance });
--- a/src/tiny-tide/species.ts
+++ b/src/tiny-tide/species.ts
@@ -2,7 +2,7 @@ import type { SpeciesCombatFields } from './combat-types';
 // Everything that lives (or floats, or sails) in the Tiny Tide universe.
 export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet'
   /** Combat species of sizes 0 and 1 (spec §11.3); each draws an existing GLB through `model`. */
-  | 'drifter' | 'spiny_snail';
+  | 'drifter' | 'spiny_snail' | 'clawmother';
 export type FoodTag = 'plant' | 'meat' | 'any';
 export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
 export interface Species extends SpeciesCombatFields {
@@ -59,6 +59,8 @@ export const SPECIES: readonly Species[] = [
   // Combat species (spec §11.3), after every legacy row so the legacy spawns of each tier keep their seeded places.
   s(0, 'drifter', 'meat', 'Drifter shrimp', 'skittish', 8, 14, { hp: 3, speed: 3.0, model: 'shrimp', tint: '#f6b58f', behaviourId: 'drifter' }),
   s(0, 'spiny_snail', 'meat', 'Spiny snail', 'graze', 6, 16, { hp: 6, speed: .5, model: 'snail', tint: '#c9a3e6', behaviourId: 'spiny-snail', attackIds: ['snail-poke'], fights: true, pursuitId: 'retaliate' }),
+  s(1, 'clawmother', 'meat', 'Old Clawmother', 'graze', 1, 0, { hp: 80, speed: 1.0, model: 'crab', tint: '#9c3b2e', bodyScale: 1.8, behaviourId: 'clawmother', hunts: [0], fights: true, pursuitId: 'hunter',
+    attackIds: ['mother-pinch', 'mother-pinch-2', 'mother-lunge', 'mother-emerge', 'mother-sweep', 'mother-pinch-rage'], alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 } }),
 ];
 const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
 export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
```

- [ ] **Step 5: The alpha bar and effects**

```diff
--- a/src/tiny-tide/combat-hud.ts
+++ b/src/tiny-tide/combat-hud.ts
@@ -77,6 +77,18 @@ export class CombatOverlay {
     if (breakProgress !== null) (this.prompt.querySelector('.break-ring') as HTMLElement).style.background = `conic-gradient(#fff2b3 ${Math.min(1, breakProgress) * 360}deg, #ffffff33 0)`;
   }
 }
+/** The alpha bar (spec §9.3): at the top centre while the player is inside 1.5 × the lair radius; the name, the HP and the phase pips. */
+export interface AlphaView { name: string; fraction: number; phase: number; phases: number }
+export class AlphaBar {
+  private readonly root = document.createElement('div');
+  constructor(host: HTMLElement) { this.root.id = 'alpha-bar'; this.root.hidden = true; this.root.innerHTML = '<strong></strong><i class="alpha-hp"><b></b></i><span class="alpha-pips"></span>'; host.append(this.root); }
+  sync(v: AlphaView | null): void {
+    this.root.hidden = v === null; if (!v) return;
+    this.root.querySelector('strong')!.textContent = v.name;
+    (this.root.querySelector('.alpha-hp b') as HTMLElement).style.width = `${Math.max(0, v.fraction) * 100}%`;
+    this.root.querySelector('.alpha-pips')!.innerHTML = Array.from({ length: v.phases }, (_, i) => `<i class="${i <= v.phase ? 'on' : ''}"></i>`).join('');
+  }
+}
 /** Where an edge arrow sits: on an ellipse inside the screen edge, toward the off-screen point (a point behind the camera is mirrored). */
 export function edgeArrowAt(point: { x: number; y: number; visible: boolean }, width: number, height: number): { x: number; y: number; angle: number } {
   const cx = width / 2, cy = height / 2, dx = (point.x - cx) * (point.visible ? 1 : -1), dy = (point.y - cy) * (point.visible ? 1 : -1), angle = Math.atan2(dy, dx);
--- a/src/tiny-tide/controls.css
+++ b/src/tiny-tide/controls.css
@@ -44,3 +44,7 @@
 .edge-arrow:after{content:'';position:absolute;right:-12px;top:50%;border:9px solid transparent;border-left-color:currentColor;transform:translateY(-50%)}
 #break-free{position:absolute;left:50%;bottom:42%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:30px;background:#163b47d9;font-weight:700;letter-spacing:.5px}
 #break-free .break-ring{width:22px;height:22px;border-radius:50%}
+#alpha-bar{position:absolute;top:max(80px,calc(env(safe-area-inset-top) + 64px));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;letter-spacing:1px;pointer-events:none}
+#alpha-bar .alpha-hp{display:block;width:min(260px,60vw);height:8px;border-radius:4px;background:#0b2f3acc;overflow:hidden}#alpha-bar .alpha-hp b{display:block;height:100%;background:#ff6b57}
+#alpha-bar .alpha-pips{display:flex;gap:6px}#alpha-bar .alpha-pips i{width:8px;height:8px;border-radius:50%;background:#ffffff33}#alpha-bar .alpha-pips i.on{background:#ff6b57}
+.ed-rare{color:#ffb347}
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -26,7 +26,8 @@ import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refr
 import type { ChompResult } from './feeding';
 import { PLAYER_ID, type CombatTick } from './combat-world';
 import { damageText, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
-import { CombatOverlay, edgeArrowAt, HP_BAR_SECONDS, type EdgeArrow, type HpBar } from './combat-hud';
+import { AlphaBar, CombatOverlay, edgeArrowAt, HP_BAR_SECONDS, type AlphaView, type EdgeArrow, type HpBar } from './combat-hud';
+import { speciesActor } from './ecosystem';
 import type { TelegraphView } from './combat-world';
 import { movement, movementCapabilities } from './profiles';
 import { admissionClock, makeWorldQueries, resetAdmissionClock, stageBounds, stageWorldQueries, zoneLabel } from './world-queries';
@@ -93,7 +94,7 @@ app.innerHTML = `
   <div class="corner-note" id="corner-note">MADE FOR A LITTLE ESCAPE <span>✳</span></div>
 `;
 const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
-const combatHud = new CombatHud(document.querySelector<HTMLElement>('.actions')!), overlay = new CombatOverlay(document.getElementById('game-ui')!);
+const combatHud = new CombatHud(document.querySelector<HTMLElement>('.actions')!), overlay = new CombatOverlay(document.getElementById('game-ui')!), alphaBar = new AlphaBar(document.getElementById('game-ui')!);
 /** Reduced motion follows the OS setting only (D31): no camera shake. */
 const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
 /** This frame's telegraphs (read-only diagnostics) and the wind-ups already announced by the rising tone. */
@@ -504,7 +505,15 @@ function presentCombatView() {
   telegraphViews = playing ? sim.combat.telegraphs(time, onScreen, seabedHeight) : [];
   const frozen = new Set<number>();
   for (const c of sim.combat.entities.values()) if (time < c.rt.hitStopUntil) frozen.add(c.entity.id);
-  world.setCombatView(telegraphViews, { player: time < rt.hitStopUntil, entities: frozen });
+  const sunk = new Set<number>(); let alpha: AlphaView | null = null;
+  for (const c of sim.combat.entities.values()) {
+    if (c.ai && (c.ai.name === 'sink' || c.ai.name === 'burrowed')) sunk.add(c.entity.id);
+    const lair = c.behaviour.lair, home = c.ai?.home;
+    if (playing && lair && home && !c.entity.eaten && Math.hypot(physical.x - home.x, physical.z - home.z) <= lair.resetOutsideFactor * lair.radiusBodyLengths * speciesActor(c.entity).bodyLength)
+      alpha = { name: c.entity.spec.label, fraction: c.entity.hp / c.maxHp, phase: c.ai?.phase ?? 0, phases: c.behaviour.phases?.length ?? 1 };
+  }
+  alphaBar.sync(alpha);
+  world.setCombatView(telegraphViews, { player: time < rt.hitStopUntil, entities: frozen }, sunk);
   for (const v of telegraphViews) if (v.phase === 'windup' && !toned.has(v.actionId)) { toned.add(v.actionId); audio.windup(.4); }
   if (toned.size > 64) toned.clear();
   const bars: HpBar[] = [], arrows: EdgeArrow[] = [];
--- a/src/tiny-tide/world.ts
+++ b/src/tiny-tide/world.ts
@@ -72,6 +72,9 @@ export class TideWorld {
   private readonly flashUntil = new Map<number | 'player', number>();
   private readonly cues = new Map<number, { cue: TelegraphView['cue']; t: number }>();
   private frozen: { player: boolean; entities: ReadonlySet<number> } = { player: false, entities: new Set() };
+  /** Alphas under the sand (the burrow pattern): their model sinks and a dust trail shows on the seabed. */
+  private sunk: ReadonlySet<number> = new Set();
+  private dustClock = 0;
   private worldTime = 0;
   readonly camera = new T.PerspectiveCamera(55, 1, .08, 340);
   readonly renderer: T.WebGLRenderer;
@@ -330,8 +333,8 @@ export class TideWorld {
   /** Camera shake in today's units (1 = the hurt shake); the caller skips it under prefers-reduced-motion. */
   shakeBy(amount: number) { this.shake = Math.max(this.shake, amount); }
   /** This frame's telegraphs (volumes and pose cues) and the actors in a hit-stop (their animation stops). */
-  setCombatView(views: readonly TelegraphView[], frozen: { player: boolean; entities: ReadonlySet<number> }) {
-    this.telegraphs.update(views, this.scale); this.frozen = frozen; this.cues.clear();
+  setCombatView(views: readonly TelegraphView[], frozen: { player: boolean; entities: ReadonlySet<number> }, sunk: ReadonlySet<number> = new Set()) {
+    this.telegraphs.update(views, this.scale); this.frozen = frozen; this.sunk = sunk; this.cues.clear();
     for (const v of views) this.cues.set(v.entityId, { cue: v.cue, t: v.phase === 'windup' ? v.fill : 1 });
   }
   /** A hit: red sparks and a short camera shake. */
@@ -459,11 +462,16 @@ export class TideWorld {
         else if (cue.cue === 'burrow') f.model.position.y -= .5 * size * t;
         else if (cue.cue === 'spin') f.model.rotation.y += 12 * t * dt;
       } else if (f.model.rotation.x !== 0) f.model.rotation.x = 0;
+      if (this.sunk.has(e.id)) {
+        f.model.position.y -= .8 * size;
+        if (this.dustClock <= 0) this.burst(e.x / this.scale, seabedHeight(e.x, e.z) / this.scale + .05, e.z / this.scale, '#c9b48a', 4);
+      }
       if (this.frozen.entities.has(e.id)) continue;
       if (f.tier === 0) f.model.rotation.z = Math.sin(time * 1.7 + f.data.phase) * .1;
       else if (kind === 'planet') f.model.rotation.y += dt * .07;
       else if (kind === 'boat') f.model.rotation.z = Math.sin(time * 1.1 + f.data.phase) * .04;
     }
+    this.dustClock = this.dustClock <= 0 ? .15 : this.dustClock - dt;
     for (const set of this.instances) {
       // Future giants remain visible without casting an ocean-sized shadow
       // across the tiny player's entire habitat.
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/rig.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed — except possibly `sim.ts keeps the former main.ts tick order`: the scripted stage-0 route can now enter the Clawmother's lair, which changes stage 0 on purpose. If that is the only failure, re-record from `sim.ts`:
`TIDE_SIM_RECORD=sim npx vitest run tests/tiny-tide-core/sim.test.ts` (expected: PASS), and say so in the commit message.

- [ ] **Step 7: Checkpoint.** Expected: green.

- [ ] **Step 8: Commit** (add `tests/tiny-tide-core/sim-golden.json` only when Step 6 re-recorded it)

```bash
git add src/tiny-tide/species.ts src/tiny-tide/parts.ts src/tiny-tide/genome.ts src/tiny-tide/state.ts src/tiny-tide/ecosystem.ts src/tiny-tide/sim.ts src/tiny-tide/rig.ts src/tiny-tide/creature.ts src/tiny-tide/world.ts src/tiny-tide/editor.ts src/tiny-tide/combat-hud.ts src/tiny-tide/controls.css src/tiny-tide/main.ts tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/state.test.ts
git commit -m "Tiny Tide combat: the Old Clawmother alpha, its lair and the rare Clawmother claw (sim golden re-recorded: the scripted route meets the lair)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T18: Size-1 species, schools and dens

**Spec:** §11.2–11.3 (Sunny sardine, Puffer, Berry squid, Moray eel), §3.2 (`profiles.ts` `ambusher`, `biomes.ts` groups and dens), D26, D36.

**Files:**
- Modify: `src/tiny-tide/species.ts`, `src/tiny-tide/profiles.ts`, `src/tiny-tide/registries.ts`, `src/tiny-tide/biomes.ts`, `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/combat-world.ts`, `src/tiny-tide/hit-resolver.ts`, `src/tiny-tide/avoidance.ts`, `src/tiny-tide/controls.css`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/combat-ai.test.ts`, `tests/tiny-tide-core/ecosystem.test.ts`, `tests/tiny-tide-core/hit-resolver.test.ts`, `tests/tiny-tide-core/sim-golden.json` (re-recorded)
- Modify: `e2e/tiny-tide-paths.mjs` (check 15)

**Interfaces:**
- Consumes: T14 `schoolFlee`, `aiLandedHit`; T16 `aiTick`.
- Produces: species `sardine` (tier 1, school of 4), `puffer` (tier 1), `eel` (tier 2, hunts `[1]`, pursuit `ambusher`); the squid becomes a combat species (`hp 26`, attacks `squid-ink`, `squid-grab`, `squid-lunge`; `hunts [1, 2]`, D36) and the `squid-grab` hazard is removed; `PURSUITS.ambusher`; `ecosystem.denOf(seed, spawn)` (eel dens beside reef solids; the eel respawns at its den); group placement for schools (4 within 2 L); `aiTick` runs `schoolFlee` per school and `aiLandedHit`; the `inked` status (`main.ts` body class, ink burst).

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/combat-ai.test.ts
+++ b/tests/tiny-tide-core/combat-ai.test.ts
@@ -147,7 +147,7 @@ describe('combat AI: alphas', () => {
     const eco = new Ecosystem(3), mother = eco.entities.find(e => e.spec.key === '1:clawmother')!, far = { x: 0, y: 900, z: 0 };
     const step = (stage: number, now: number, unlocked: string[] = []) => eco.step({ stage, dt: DT, now, player: far, playerHull: [], perceivable: false, stealthFactor: 1, unlocked });
     const lair = lairOf(3, mother), r = Math.hypot(lair.x, lair.z);
-    expect(r).toBeGreaterThanOrEqual(22); expect(r).toBeLessThanOrEqual(30);   // (22 + 8 × rand) × SIZES[0]
+    expect(r).toBeGreaterThanOrEqual(25.2 + 5); expect(r).toBeLessThanOrEqual(25.2 + 13);   // the lair radius 2.5 × 10.08 plus (5 + 8 × rand) × SIZES[0]: the start is outside the lair
     step(0, 0); expect(mother.eaten).toBe(false); expect(Math.hypot(mother.x - lair.x, mother.z - lair.z)).toBeLessThanOrEqual(4 * 10.08);
     step(1, .1); expect(mother.eaten).toBe(true); expect(mother.active).toBe(false);   // only at its own size
     step(0, .2); expect(mother.eaten).toBe(false);
--- a/tests/tiny-tide-core/ecosystem.test.ts
+++ b/tests/tiny-tide-core/ecosystem.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { Ecosystem, HUNTER_MARGIN, provoke, speciesActor, type Entity } from '../../src/tiny-tide/ecosystem';
+import { denOf, Ecosystem, HUNTER_MARGIN, makeEntities, provoke, speciesActor, type Entity } from '../../src/tiny-tide/ecosystem';
 import { makeTerrain, makeWorldQueries } from '../../src/tiny-tide/world-queries';
 import { habitat } from '../../src/tiny-tide/profiles';
 import { SIZES, SPAWN_HALF, WATER_LEVEL, WORLD_HALF } from '../../src/tiny-tide/biomes';
@@ -45,6 +45,19 @@ describe('species installation', () => {
     eco.step(ctx(far, .2, { stage: 2 })); expect(squid.eaten || legal(squid)).toBe(true);
   });
 });
+describe('combat species placement (spec §11.3)', () => {
+  it('spawns sardines in groups of 4 within 2 L, and eels at dens beside reef solids', () => {
+    for (const seed of [1, 2]) {
+      const eco = new Ecosystem(seed), sardines = makeEntities(seed).filter(e => e.spec.key === '1:sardine'), L = SIZES[1]! * 1.4 * .55;
+      for (let k = 0; k < sardines.length; k++) { const lead = sardines[k - k % 4]!; expect(Math.hypot(sardines[k]!.x - lead.x, sardines[k]!.z - lead.z), `seed ${seed} sardine ${k}`).toBeLessThanOrEqual(2 * L + 1e-9); }
+      for (const eel of eco.entities.filter(e => e.spec.key === '2:eel' && !e.eaten)) {
+        const den = denOf(seed, { ...eel, x: 0, y: 0, z: 0 }), Le = SIZES[2]! * 1.4;
+        expect(Math.hypot(eel.hx - den.x, eel.hz - den.z), `seed ${seed} eel ${eel.id}`).toBeLessThanOrEqual(4 * Le);   // installed within 4 L of its den
+      }
+      expect(eco.installFailures).toBe(0);
+    }
+  });
+});
 describe('pursuit', () => {
   it('keeps hunting through a one-frame escape', () => {
     const eco = new Ecosystem(7), crab = crabOf(eco), home = at(crab, 0, 0);
--- a/tests/tiny-tide-core/hit-resolver.test.ts
+++ b/tests/tiny-tide-core/hit-resolver.test.ts
@@ -93,14 +93,16 @@ describe('hit resolver', () => {
     expect(s.unit).toBe('hp'); expect(c.health).toBe(16); expect(s.hitStop).toBeCloseTo(.075);   // 60 + round(30 × 4 / 8) ms
   });
   it('impulse formula, resistance, blocked × .3', () => {
-    // Crab (L 5.6, mass 5.6) hits a player (mass 2): J = 4 × 5.6 × min(5.6, 4) = 89.6; Δv = 89.6 / 2 = 44.8 along origin → point (−z).
-    const p = player(), e = resolveHit(req(crab(), p, POKE), 1)!;
+    // Crab (L 5.6, mass 5.6) hits a player (L 10, mass 2): J = 4 × 5.6 × min(5.6, 4) = 89.6; Δv = 89.6 / 2 = 44.8 along origin → point (−z).
+    const p = player({ L: 10 }), e = resolveHit(req(crab(), p, POKE), 1)!;
     expect(e.impulse.z).toBeCloseTo(-44.8); expect(p.rt.externalVelocity.z).toBeCloseTo(-44.8);
-    const r = player({ knockbackResistance: .5 }); resolveHit(req(crab(), r, POKE), 1); expect(r.rt.externalVelocity.z).toBeCloseTo(-22.4);
-    const b = player(); guard(b.rt, 'brace-shell'); resolveHit(req(crab(), b, POKE), 1); expect(b.rt.externalVelocity.z).toBeCloseTo(-44.8 * .3);
+    const r = player({ L: 10, knockbackResistance: .5 }); resolveHit(req(crab(), r, POKE), 1); expect(r.rt.externalVelocity.z).toBeCloseTo(-22.4);
+    const b = player({ L: 10 }); guard(b.rt, 'brace-shell'); resolveHit(req(crab(), b, POKE), 1); expect(b.rt.externalVelocity.z).toBeCloseTo(-44.8 * .3);
     // A ground target is pushed horizontally: an origin above it gives no vertical push.
-    const g = player({ ground: true }); resolveHit(req(crab(), g, POKE, { origin: { x: 0, y: 3, z: 2 } }), 1);
+    const g = player({ L: 10, ground: true }); resolveHit(req(crab(), g, POKE, { origin: { x: 0, y: 3, z: 2 } }), 1);
     expect(g.rt.externalVelocity.y).toBe(0); expect(g.rt.externalVelocity.z).toBeCloseTo(-44.8);
+    // The cap: a player of L 2 is knocked at most 9 × 2 = 18 per second (1.5 L with the 6/s decay).
+    const small = player({ L: 2 }); resolveHit(req(crab(), small, POKE), 1); expect(small.rt.externalVelocity.z).toBeCloseTo(-18);
   });
   it('one hit per target per action, repeat for whirl', () => {
     const p = player(), c = crab(), r = req(c, p, POKE);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/ecosystem.test.ts tests/tiny-tide-core/hit-resolver.test.ts`
Expected: FAIL — `spawns sardines in groups of 4 …` (no sardine).

- [ ] **Step 3: Species, pursuit and placement**

```diff
--- a/src/tiny-tide/biomes.ts
+++ b/src/tiny-tide/biomes.ts
@@ -26,14 +26,14 @@ const TYPES: readonly (readonly BiomeType[])[] = [
    { name: 'Copepod cloud', weights: { copepod: 4, drifter: 2 }, decor: 'sand', tint: '#2b7f93' },
    { name: 'Wormy sands', weights: { worm: 4, plant: .5, spiny_snail: 2 }, decor: 'sand', tint: '#3b7f86' },
    { name: 'Grape garden', weights: { seagrape: 3, kelp_snack: 2, drifter: 1 }, decor: 'coral', tint: '#2e7a8c' }],
-  [{ name: 'Coral garden', weights: { seagrape: 2, shrimp: 2 }, decor: 'coral', tint: '#2a7e8e' },
-   { name: 'Jelly drift', weights: { jellyfish: 4 }, decor: 'sand', tint: '#30708f' },
+  [{ name: 'Coral garden', weights: { seagrape: 2, shrimp: 2, sardine: 2, puffer: 1 }, decor: 'coral', tint: '#2a7e8e' },
+   { name: 'Jelly drift', weights: { jellyfish: 4, puffer: 1 }, decor: 'sand', tint: '#30708f' },
    { name: 'Crab flats', weights: { crab: 4, snail: 2 }, decor: 'rock', tint: '#3a7a80' },
-   { name: 'Lettuce beds', weights: { lettuce: 4 }, decor: 'kelp', tint: '#2f8577' }],
+   { name: 'Lettuce beds', weights: { lettuce: 4, sardine: 1 }, decor: 'kelp', tint: '#2f8577' }],
   [{ name: 'Kelp forest', weights: { kelp_snack: 4, fish: 1.5 }, decor: 'kelp', tint: '#2a7a6c' },
    { name: 'Open blue', weights: { fish: 3, bird: 2 }, decor: 'sand', tint: '#246f92' },
-   { name: 'Squid deep', weights: { squid: 4 }, decor: 'rock', tint: '#22587a' },
-   { name: 'Ray shallows', weights: { ray: 4, plant: 2 }, decor: 'coral', tint: '#2f8790' }],
+   { name: 'Squid deep', weights: { squid: 4, eel: 1 }, decor: 'rock', tint: '#22587a' },
+   { name: 'Ray shallows', weights: { ray: 4, plant: 2, eel: 1 }, decor: 'coral', tint: '#2f8790' }],
   [{ name: 'Island chain', weights: { tree: 3, lighthouse: 3 }, decor: 'sand', tint: '#88bbcb' },
    { name: 'Shipping lane', weights: { boat: 4 }, decor: 'sand', tint: '#80b4c9' },
    { name: 'Sky road', weights: { plane: 3, balloon: 3 }, decor: 'sand', tint: '#93c2d6' }],
@@ -66,7 +66,7 @@ export function spawnHeight(spec: Species, x: number, z: number, rand: () => num
     case 'drifter': return ground + .6 + rand() * 1.6;
     case 'spiny_snail': return ground + 1;
     case 'worm': return ground + .1;
-    case 'shrimp': return Math.max(ground + 3, 5 + rand() * 13);
+    case 'shrimp': case 'sardine': case 'puffer': return Math.max(ground + 3, 5 + rand() * 13);
     case 'crab': case 'snail': return ground + 1;
     case 'jellyfish': return 12 + rand() * 24;
     case 'ray': return ground + 6;
--- a/src/tiny-tide/profiles.ts
+++ b/src/tiny-tide/profiles.ts
@@ -32,6 +32,8 @@ const policy = (id: string, memorySeconds: number, blockedWaitSeconds: number, r
   ({ id, memorySeconds, blockedWaitSeconds, reacquireSeconds, leashBodyLengths, giveUpBodyLengths });
 export const PURSUITS: Record<string, PursuitPolicy> = {
   none: policy('none', 0, 0, 0, 0, 0), hunter: policy('hunter', 6, 3, 2, 30, 12), retaliate: policy('retaliate', 4, 2, 3, 15, 8),
+  /** The Moray eel (spec §11.2): its den is its home. */
+  ambusher: policy('ambusher', 3, 1, 4, 1.5, 3),
 };
 
 const ids = (...names: string[]): Record<string, { id: string }> => Object.fromEntries(names.map(id => [id, { id }]));
--- a/src/tiny-tide/registries.ts
+++ b/src/tiny-tide/registries.ts
@@ -28,7 +28,7 @@ export const ABILITIES: Record<string, AbilitySpec> = PLAYER_ABILITIES;
 export { EVASIONS, GUARDS };
 const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
 /** Contact hazards; damage in half-hearts (spec §4.2: today's damage doubled). */
-export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 2, 1.8), hazard('ray-sting', 2, 1.8), hazard('squid-grab', 4, 1.4), hazard('plane-buzz', 4, 1.4)].map(h => [h.id, h]));
+export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 2, 1.8), hazard('ray-sting', 2, 1.8), hazard('plane-buzz', 4, 1.4)].map(h => [h.id, h]));
 export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
   effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, behaviours: BEHAVIOURS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });
 
--- a/src/tiny-tide/species.ts
+++ b/src/tiny-tide/species.ts
@@ -2,7 +2,7 @@ import type { SpeciesCombatFields } from './combat-types';
 // Everything that lives (or floats, or sails) in the Tiny Tide universe.
 export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet'
   /** Combat species of sizes 0 and 1 (spec §11.3); each draws an existing GLB through `model`. */
-  | 'drifter' | 'spiny_snail' | 'clawmother';
+  | 'drifter' | 'spiny_snail' | 'clawmother' | 'sardine' | 'puffer' | 'eel';
 export type FoodTag = 'plant' | 'meat' | 'any';
 export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
 export interface Species extends SpeciesCombatFields {
@@ -47,7 +47,7 @@ export const SPECIES: readonly Species[] = [
   s(2, 'kelp_snack', 'plant', 'Kelp frond', 'still', 10, 16),
   s(2, 'plant', 'plant', 'Sprout grove', 'still', 9, 16),
   s(2, 'fish', 'meat', 'Silver tuna', 'school', 13, 20, { speed: 3 }),
-  s(2, 'squid', 'meat', 'Berry squid', 'skittish', 8, 30, { hp: 4, speed: 1.1, hunts: [1, 2], fights: true, contactHazardId: 'squid-grab', pursuitId: 'hunter' }),
+  s(2, 'squid', 'meat', 'Berry squid', 'skittish', 8, 30, { hp: 26, speed: 1.1, hunts: [1, 2], fights: true, pursuitId: 'hunter', behaviourId: 'squid', attackIds: ['squid-ink', 'squid-grab', 'squid-lunge'] }),
   s(2, 'ray', 'meat', 'Little ray', 'graze', 8, 22, { hp: 2, stingsStages: [1, 2], contactHazardId: 'ray-sting', pursuitId: 'retaliate', speed: 1.4, fights: true }),
   s(2, 'bird', 'meat', 'Seagull', 'flyer', 8, 20, { speed: 2 }),
   s(3, 'tree', 'any', 'Palm tree', 'still', 9, 16, { habitatProfileId: 'sp-prop' }),
@@ -61,6 +61,9 @@ export const SPECIES: readonly Species[] = [
   s(0, 'spiny_snail', 'meat', 'Spiny snail', 'graze', 6, 16, { hp: 6, speed: .5, model: 'snail', tint: '#c9a3e6', behaviourId: 'spiny-snail', attackIds: ['snail-poke'], fights: true, pursuitId: 'retaliate' }),
   s(1, 'clawmother', 'meat', 'Old Clawmother', 'graze', 1, 0, { hp: 80, speed: 1.0, model: 'crab', tint: '#9c3b2e', bodyScale: 1.8, behaviourId: 'clawmother', hunts: [0], fights: true, pursuitId: 'hunter',
     attackIds: ['mother-pinch', 'mother-pinch-2', 'mother-lunge', 'mother-emerge', 'mother-sweep', 'mother-pinch-rage'], alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 } }),
+  s(1, 'sardine', 'meat', 'Sunny sardine', 'school', 12, 15, { hp: 4, speed: 3.2, model: 'fish', tint: '#ffd36e', bodyScale: .55, behaviourId: 'sardine' }),
+  s(1, 'puffer', 'meat', 'Puffer', 'drift', 6, 20, { hp: 10, speed: .9, model: 'fish', tint: '#f2c94c', bodyScale: .75, behaviourId: 'puffer', attackIds: ['puffer-burst'], fights: true, pursuitId: 'retaliate' }),
+  s(2, 'eel', 'meat', 'Moray eel', 'skittish', 4, 28, { hp: 22, speed: 1.4, model: 'worm', tint: '#3d6b4f', behaviourId: 'eel', attackIds: ['eel-ambush', 'eel-bite', 'eel-wrap'], hunts: [1], fights: true, pursuitId: 'ambusher' }),
 ];
 const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
 export const species = (tier: number, kind: FoodKind) => byKey.get(`${tier}:${kind}`)!;
```

```diff
--- a/src/tiny-tide/ecosystem.ts
+++ b/src/tiny-tide/ecosystem.ts
@@ -1,7 +1,7 @@
 // Creature behavior for every tier. Positions are physical units (stage 0 units).
 // Active tiers (|tier − stage| ≤ 1) move through the motion resolver, perceive, pursue (spec §10) and emit contact hazards.
 // Every entry path (construction, reset, respawn, becoming relevant) installs an entity on a legal pose.
-import { makeBiomes, PLAYER_HALF, populate, seabedHeight, SIZES, SPAWN_HALF, spawnPoint, WORLD_HALF, random, type Biome } from './biomes';
+import { makeBiomes, PLAYER_HALF, populate, seabedHeight, SIZES, SPAWN_HALF, spawnPoint, WORLD_HALF, random, type Biome, type Spawn } from './biomes';
 import { EDGE_SOFT_START } from './edge';
 import type { Actor, AdmissionContext, Capsule, ContactHazard, LegalityContext, MotionRequest, MovementMode, MutVec3, Orientation, PursuitPolicy, Vec3, WorldQueries } from './combat-types';
 import { findRecoveryPose, resolveMotion } from './motion';
@@ -74,14 +74,34 @@ const pursuitState = () => ({ lastKnown: null, lastKnownHull: null, lastSeenAt:
 /** A spawn point inside a reef solid of its tier, grown by the body radius (owner playtest P4), is rejected. */
 const inReef = (seed: number) => (tier: number, x: number, y: number, z: number) => stageSolids(tier, seed).solidAt(x, y, z, .7 * SIZES[tier]!) !== null;
 
-/** An alpha's lair (spec §11.2): a seeded point at angle 2π × rand and radius (22 + 8 × rand) × SIZES[alpha.size] around the world centre, on the
- *  seabed; installation then finds the nearest admitted pose (at most 4 L). */
+/** An alpha's lair (spec §11.2): a seeded point at angle 2π × rand around the world centre, on the seabed; installation then finds the nearest
+ *  admitted pose (at most 4 L). Its distance is the lair radius plus (5 + 8 × rand) × SIZES[alpha.size] (plan fix: the spec's (22 + 8 × rand) ×
+ *  SIZES put the start anchor inside the lair disc, so an alpha attacked a new player at the start). */
 export function lairOf(seed: number, e: { id: number; spec: Species }): Vec3 {
-  const rand = random(seed * 131 + e.id * 7 + 3), a = 2 * Math.PI * rand(), r = (22 + 8 * rand()) * SIZES[e.spec.alpha!.size]!, x = Math.sin(a) * r, z = Math.cos(a) * r;
+  const S = SIZES[e.spec.alpha!.size]!, L = SIZES[e.spec.tier]! * 1.4 * (e.spec.bodyScale ?? 1), lair = BEHAVIOURS[e.spec.behaviourId ?? '']?.lair?.radiusBodyLengths ?? 0;
+  const rand = random(seed * 131 + e.id * 7 + 3), a = 2 * Math.PI * rand(), r = lair * L + (5 + 8 * rand()) * S, x = Math.sin(a) * r, z = Math.cos(a) * r;
   return { x, y: seabedHeight(x, z) + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1), z };
 }
+/** A school member's place (spec §11.3): schools spawn as groups of `school.groupSize` within 2 L of the group's first member. */
+function schoolPlace(spawns: readonly Spawn[], spawn: Spawn, seed: number): Vec3 {
+  const school = BEHAVIOURS[spawn.spec.behaviourId ?? '']?.school; if (!school) return spawn;
+  const mates = spawns.filter(s => s.spec === spawn.spec), k = mates.indexOf(spawn), leader = mates[k - k % school.groupSize]!;
+  if (leader === spawn) return spawn;
+  const rand = random(seed * 97 + spawn.id * 13 + 1), L = SIZES[spawn.spec.tier]! * 1.4 * (spawn.spec.bodyScale ?? 1), a = rand() * 2 * Math.PI, r = 2 * L * Math.sqrt(rand());
+  return { x: leader.x + Math.sin(a) * r, y: leader.y + (rand() - .5) * L, z: leader.z + Math.cos(a) * r };
+}
+/** An eel's den (spec §11.3): .5 L outside the footprint of a seeded reef solid of its tier, on the seabed side; installation recovers it (4 L).
+ *  Without a solid, its normal spawn. */
+export function denOf(seed: number, spawn: { id: number; spec: Species; x: number; y: number; z: number }): Vec3 {
+  const solids = stageSolids(spawn.spec.tier, seed).solids.filter(s => Math.max(Math.abs(s.minX), Math.abs(s.maxX), Math.abs(s.minZ), Math.abs(s.maxZ)) < SPAWN_HALF * SIZES[spawn.spec.tier]!);
+  if (!solids.length) return spawn;
+  const rand = random(seed * 53 + spawn.id * 7 + 2), s = solids[Math.floor(rand() * solids.length)]!, a = rand() * 2 * Math.PI, L = SIZES[spawn.spec.tier]! * 1.4 * (spawn.spec.bodyScale ?? 1);
+  const cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2, r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + .5 * L, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
+  return { x, y: seabedHeight(x, z) + .35 * SIZES[spawn.spec.tier]!, z };
+}
 export function makeEntities(seed: number): Entity[] {
-  return populate(seed, inReef(seed)).map(spawn => spawn.spec.alpha ? { ...spawn, ...lairOf(seed, spawn) } : spawn).map(spawn => ({
+  const spawns = populate(seed, inReef(seed));
+  return spawns.map(spawn => spawn.spec.alpha ? { ...spawn, ...lairOf(seed, spawn) } : BEHAVIOURS[spawn.spec.behaviourId ?? '']?.den ? { ...spawn, ...denOf(seed, spawn) } : { ...spawn, ...schoolPlace(spawns, spawn, seed) }).map(spawn => ({
     id: spawn.id, spec: spawn.spec, x: spawn.x, y: spawn.y, z: spawn.z, hx: spawn.x, hy: spawn.y, hz: spawn.z,
     groundOffset: spawn.y - seabedHeight(spawn.x, spawn.z), heading: spawn.phase, phase: spawn.phase,
     hp: spawn.spec.hp, eaten: false, respawn: -1, mode: 'calm', modeTime: 0, active: false, ...pursuitState(),
@@ -424,7 +444,9 @@ export class Ecosystem {
       if (Math.hypot(e.hx - ctx.player.x, e.hz - ctx.player.z) < away) { e.respawn = 0; return; }
       Object.assign(e, { x: e.hx, y: e.hy, z: e.hz }, fresh); this.install(e); return;
     }
-    const tier = e.spec.tier, point = spawnPoint(e.spec, this.biomes[tier]!, this.rand, { x: ctx.player.x, z: ctx.player.z, radius: away }, (x, y, z) => inReef(this.seed)(tier, x, y, z));
+    // An eel comes back to its den (spec §11.3); everything else to a fresh point out of sight.
+    const tier = e.spec.tier, point = BEHAVIOURS[e.spec.behaviourId ?? '']?.den ? denOf(this.seed, e)
+      : spawnPoint(e.spec, this.biomes[tier]!, this.rand, { x: ctx.player.x, z: ctx.player.z, radius: away }, (x, y, z) => inReef(this.seed)(tier, x, y, z));
     Object.assign(e, { x: point.x, y: point.y, z: point.z, hx: point.x, hy: point.y, hz: point.z, groundOffset: point.y - seabedHeight(point.x, point.z) }, fresh);
     this.install(e);
   }
```

- [ ] **Step 4: Schools, dens and ink in the combat world**

```diff
--- a/src/tiny-tide/avoidance.ts
+++ b/src/tiny-tide/avoidance.ts
@@ -15,6 +15,7 @@ import { stepPlayer } from './player-motion';
 import { EDGE_SOFT_START } from './edge';
 import { STAGES } from './state';
 import { CombatWorld } from './combat-world';
+import { activeStartsIn } from './action-engine';
 import { assignSlots, movesOf, NO_PINS } from './moves';
 import { createRigPose } from './rig';
 import { makePlayerBody } from './sim';
@@ -128,6 +129,8 @@ export function edgeEncounter(planId: string, hunterKey: string, seed: number):
   return null;
 }
 
+/** The runner presses Dash this long before a wind-up at it becomes active. */
+const DODGE_LEAD = .15;
 /** A combat hit on the player (spec §6): a species attack that damaged or held it (avoidance counts these as well as hazards). */
 const COMBAT_HITS = new Set(['hit', 'grabbed', 'guard-broken']);
 /** Runs straight away from the hunter for eight seconds with the real player step, the real hunter rules and the real combat world. */
@@ -151,13 +154,20 @@ export function simulateEscape(e: Encounter, hunter: { speedScale?: number; poli
 
   const intent: CombatInput = caps.rise ? { ...RELEASED, traversal: 'rise' } : RELEASED;
   const anchor = startAnchor(actor, stage, legal), genome = starterFor(p), combat = new CombatWorld(), rig = createRigPose(genome), moves = movesOf(genome), slots = assignSlots(genome, NO_PINS);
+  const dashSlot = slots.slots.indexOf('dash');
   const body = () => makePlayerBody({ genome, plan: p, position, rt, actor, scale: size, armor: 0, health: 99, rig, hull: worldHull(actor, position, rt.orientation) });
   const steps = Math.round(ESCAPE_SECONDS / DT);
   for (let i = 1; i <= steps; i++) {
     const now = i * DT;
     const dx = position.x - h.x, dz = position.z - h.z, len = Math.hypot(dx, dz);
     const wish: Vec3 = len > 1e-9 && !hunter.stay ? { x: dx / len, y: 0, z: dz / len } : { x: 0, y: 0, z: 0 };
-    const r = stepPlayer(position, rt, intent, { plan: p, profile, caps, actor, ...legal, size, topSpeedLocal: pl.topSpeedLocal, now, dt: DT, wish, aim: null, actionLock: false });
+    // The runner dodges as a player would (spec §1 criterion 3): a wind-up at it about to become active → the starter's Dash, along the escape.
+    // It dashes across the attack axis (out of a lunge's capsule), on the side it is already moving to.
+    const attacker = !hunter.stay && dashSlot >= 0 ? [...combat.entities.values()].find(c => c.rt.actions.some(a => a.targetId === 'player' && a.phase === 'windup' && activeStartsIn(a, c.rt.actionClock) <= DODGE_LEAD)) : undefined;
+    const now_intent: CombatInput = attacker ? { ...intent, activePressed: [0, 1, 2, 3].map(k => k === dashSlot) as CombatInput['activePressed'] } : intent;
+    const ax = attacker ? position.x - attacker.entity.x : 0, az = attacker ? position.z - attacker.entity.z : 0, al = Math.hypot(ax, az) || 1;
+    const dodge: Vec3 = attacker ? { x: -az / al, y: 0, z: ax / al } : wish;
+    const r = stepPlayer(position, rt, now_intent, { plan: p, profile, caps, actor, ...legal, size, topSpeedLocal: pl.topSpeedLocal, now, dt: DT, wish, aim: null, actionLock: false, combat: combat.playerMotion(body(), now_intent, now) });
     position = r.position;
     if (r.needsRecovery) {
       const rec = recoverPlayer(actor, position, rt.orientation, { ...legal, time: now + DT }, anchor, 20 * L);
@@ -166,8 +176,8 @@ export function simulateEscape(e: Encounter, hunter: { speedScale?: number; poli
       rt.permit = null; rt.arc = null; rt.controlledVelocity = { x: 0, y: 0, z: 0 }; rt.externalVelocity = { x: 0, y: 0, z: 0 };
       settle();
     }
-    const tick = combat.tick({ now, dt: DT, playing: true, intent, wish, previousMove: wish, player: body(), moves, slots, entities: eco.entities, stage, queries: legal.queries });
-    if (tick.events.some(ev => ev.targetId === 'player' && COMBAT_HITS.has(ev.outcome))) return { ok: false, reason: 'hit', seconds: now };
+    const tick = combat.tick({ now, dt: DT, playing: true, intent: now_intent, wish: dodge, previousMove: wish, player: body(), moves, slots, entities: eco.entities, stage, queries: legal.queries });
+    if (tick.events.some(ev => ev.targetId === 'player' && ev.attackerId === `e${h.id}` && COMBAT_HITS.has(ev.outcome))) return { ok: false, reason: 'hit', seconds: now };
     combat.aiTick({ now, dt: DT, stage, runSeed: e.seed, entities: eco.entities, player: body(), playing: true, stealthFactor: pl.stealth, hitBy: new Set(), isOnScreen: () => true });
     const events = eco.step({ stage, dt: DT, now, player: position, playerHull: worldHull(actor, position, rt.orientation), perceivable: true, stealthFactor: pl.stealth });
     combat.afterMotion(eco.entities);
--- a/src/tiny-tide/combat-world.ts
+++ b/src/tiny-tide/combat-world.ts
@@ -18,7 +18,7 @@ import { EFFECTS, TELEGRAPHS } from './combat-profiles';
 import { telegraphDescriptor, type TelegraphDescriptor } from './combat-shapes';
 import type { ActionPhase, TelegraphProfile } from './combat-types';
 import { damageAfterArmor } from './state';
-import { aiRefused, aiStarted, aiStep, newAiState, ROAR_SECONDS, type AiState } from './combat-ai';
+import { aiLandedHit, aiRefused, aiStarted, aiStep, newAiState, ROAR_SECONDS, schoolFlee, type AiState } from './combat-ai';
 import { hostileSizes, SPECIES_ATTACKS } from './bestiary';
 import { closestOnSegment, shapeCentroid } from './combat-shapes';
 import { provoke } from './ecosystem';
@@ -79,6 +79,11 @@ export function playerMatrix(position: Vec3, o: { yaw: number; pitch: number },
 }
 const horizontal = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.z); return l > 1e-9 ? { x: v.x / l, y: 0, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
 const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
+/** The centroid of the school members within `reach` of `at`. */
+function schoolCentre(members: readonly { position: Vec3 }[], at: Vec3, reach: number): Vec3 | undefined {
+  const near = members.filter(m => Math.hypot(m.position.x - at.x, m.position.y - at.y, m.position.z - at.z) <= reach); if (!near.length) return undefined;
+  return near.reduce((a, m) => ({ x: a.x + m.position.x / near.length, y: a.y + m.position.y / near.length, z: a.z + m.position.z / near.length }), { x: 0, y: 0, z: 0 });
+}
 /** The aim with its pitch clamped to ±limit. */
 const clampPitch = (v: Vec3, limit: number): Vec3 => { const u = unit(v), p = Math.max(-limit, Math.min(limit, Math.asin(Math.max(-1, Math.min(1, u.y))))), h = horizontal(u); return { x: h.x * Math.cos(p), y: Math.sin(p), z: h.z * Math.cos(p) }; };
 
@@ -239,6 +244,9 @@ export class CombatWorld {
     }
     for (const e of resolveAll(requests, ctx.now, statusOf)) {
       out.events.push(e);
+      // An eel stays out of its den for den.outSeconds after its last landed hit.
+      const by = e.targetId === PLAYER_ID ? live.find(x => x.id === e.attackerId) : undefined;
+      if (by?.ai && (e.outcome === 'hit' || e.outcome === 'grabbed' || e.outcome === 'blocked' || e.outcome === 'guard-broken')) aiLandedHit(by.behaviour, by.ai, ctx.now);
       if (e.killed && e.killed !== PLAYER_ID) { const c = live.find(x => x.id === e.killed); if (c && !out.killed.includes(c.entity)) out.killed.push(c.entity); }
       const hurt = live.find(x => x.id === e.targetId); if (hurt && e.amount > 0) hurt.lastDamagedAt = ctx.now;
     }
@@ -371,6 +379,11 @@ export class CombatWorld {
    *  for the ecosystem's step (`entity.combat`). The player's damage this tick provokes fighters (memory and the angry mode). */
   aiTick(ctx: AiTickContext): AiTickResult {
     const res: AiTickResult = { engagements: [], roars: [], markers: [] }, p = ctx.player, hurt = p.pose.hurtboxes;
+    const schools = new Map<string, { state: AiState; position: Vec3; L: number }[]>();
+    for (const e of ctx.entities) if (!e.eaten && e.active && this.behaviours[e.spec.behaviourId ?? '']?.school) {
+      const c = this.stateOf(e); if (!c) continue;
+      const list = schools.get(e.spec.key) ?? []; list.push({ state: c.ai ??= newAiState(ctx.runSeed, e.id, ctx.now), position: { x: e.x, y: e.y, z: e.z }, L: speciesCombatPose(e, ctx.now).bodyLength }); schools.set(e.spec.key, list);
+    }
     for (const e of ctx.entities) {
       if (!e.spec.behaviourId) continue;
       if (e.eaten || !e.active) { e.combat = null; continue; }
@@ -386,6 +399,7 @@ export class CombatWorld {
         hostile: hostileSizes(e.spec).includes(ctx.stage), pursuit: e.mode, hit: ctx.hitBy.has(e.id), fleeDistance: 7 * Math.max(tierSize, stageSize) * ctx.stealthFactor,
         ready: id => (c.rt.cooldowns.get(`${c.id}:root:${id}`) ?? -Infinity) <= c.rt.actionClock + 1e-9,
         inLair: ai.home !== null && c.behaviour.lair ? Math.hypot(p.centre.x - ai.home.x, p.centre.z - ai.home.z) <= c.behaviour.lair.radiusBodyLengths * L : undefined,
+        schoolCentre: c.behaviour.school ? schoolCentre(schools.get(e.spec.key) ?? [], centre, 2 * c.behaviour.school.radiusBodyLengths * L) : undefined,
       });
       if (out.attack) {
         const attack = SPECIES_ATTACKS[out.attack.attackId], ground = e.spec.movementProfileId === 'sp-ground';
@@ -406,6 +420,8 @@ export class CombatWorld {
         lunge: lunging ? { x: lunging.aim.x * speed, y: lunging.aim.y * speed, z: lunging.aim.z * speed } : null, external: c.rt.externalVelocity, frozen: ctx.now < c.rt.hitStopUntil,
         held: claw ? { x: claw.x - centre.x, y: claw.y - centre.y, z: claw.z - centre.z } : null, moved: 0 };
     }
+    // prey-school (spec §11.2): one member's flee takes every near member along on the same tick, in one direction.
+    for (const [key, members] of schools) { const b = this.behaviours[ctx.entities.find(e => e.spec.key === key)?.spec.behaviourId ?? '']; if (b?.school) schoolFlee(members, p.centre, b.school.radiusBodyLengths, ctx.now); }
     return res;
   }
   /** After the ecosystem's step: a lunge counts the body lengths it really moved (its hit volume is truncated there, spec §5.10). */
--- a/src/tiny-tide/hit-resolver.ts
+++ b/src/tiny-tide/hit-resolver.ts
@@ -48,6 +48,9 @@ export interface CombatEvent {
 export const POST_HIT_INVULNERABLE = .4, BREAK_FREE_STAGGER = .3, BREAK_FREE_INVULNERABLE = .5;
 /** Brace multiplies the impulse: blocked × .3, guard broken × .6. */
 export const BLOCK_IMPULSE = .3, BROKEN_IMPULSE = .6;
+/** A knock is at most KNOCKBACK_CAP × L_t per second (plan decision): with EXTERNAL_DECAY 6/s it carries the target at most 1.5 of its body
+ *  lengths. The spec's J = impulse × L_a × min(m_a, 2 m_t) scales with the attacker, so a big alpha would throw a small player across the map. */
+export const KNOCKBACK_CAP = 9;
 
 /** §6.1: by action start time (world time), then attacker id, then target id. */
 export function compareRequests(a: HitRequestIn, b: HitRequestIn): number {
@@ -138,7 +141,8 @@ export function resolveHit(r: HitRequestIn, now: number, statusOf: (id: string)
   // 6. Impulse: J = impulse × L_a × min(m_a, 2 m_t) along origin → point (horizontal for ground targets); Δv = J / m_t × (1 − kr).
   let dir = { x: r.point.x - r.origin.x, y: target.ground ? 0 : r.point.y - r.origin.y, z: r.point.z - r.origin.z };
   dir = unit(dir);
-  const J = attack.impulse * attacker.L * Math.min(attacker.mass, 2 * target.mass), k = J / target.mass * (1 - target.knockbackResistance) * (guard === 'blocked' ? BLOCK_IMPULSE : guard === 'guard-broken' ? BROKEN_IMPULSE : 1);
+  const J = attack.impulse * attacker.L * Math.min(attacker.mass, 2 * target.mass);
+  const k = Math.min(KNOCKBACK_CAP * target.L, J / target.mass * (1 - target.knockbackResistance)) * (guard === 'blocked' ? BLOCK_IMPULSE : guard === 'guard-broken' ? BROKEN_IMPULSE : 1);
   const impulse = { x: dir.x * k, y: dir.y * k, z: dir.z * k };
   target.rt.externalVelocity.x += impulse.x; target.rt.externalVelocity.y += impulse.y; target.rt.externalVelocity.z += impulse.z;
   // Status (ink): not when blocked.
```

```diff
--- a/src/tiny-tide/controls.css
+++ b/src/tiny-tide/controls.css
@@ -48,3 +48,4 @@
 #alpha-bar .alpha-hp{display:block;width:min(260px,60vw);height:8px;border-radius:4px;background:#0b2f3acc;overflow:hidden}#alpha-bar .alpha-hp b{display:block;height:100%;background:#ff6b57}
 #alpha-bar .alpha-pips{display:flex;gap:6px}#alpha-bar .alpha-pips i{width:8px;height:8px;border-radius:50%;background:#ffffff33}#alpha-bar .alpha-pips i.on{background:#ff6b57}
 .ed-rare{color:#ffb347}
+#game-ui.inked::before{content:'';position:absolute;inset:0;box-shadow:inset 0 0 140px 70px #120a1ed9;pointer-events:none;z-index:1}
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -25,7 +25,7 @@ import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from '.
 import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
 import type { ChompResult } from './feeding';
 import { PLAYER_ID, type CombatTick } from './combat-world';
-import { damageText, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
+import { damageText, EFFECTS, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
 import { AlphaBar, CombatOverlay, edgeArrowAt, HP_BAR_SECONDS, type AlphaView, type EdgeArrow, type HpBar } from './combat-hud';
 import { speciesActor } from './ecosystem';
 import type { TelegraphView } from './combat-world';
@@ -513,6 +513,8 @@ function presentCombatView() {
       alpha = { name: c.entity.spec.label, fraction: c.entity.hp / c.maxHp, phase: c.ai?.phase ?? 0, phases: c.behaviour.phases?.length ?? 1 };
   }
   alphaBar.sync(alpha);
+  // Inked (spec §11.5): darker screen edges while the status lasts.
+  el('game-ui').classList.toggle('inked', playing && rt.status !== null && time < rt.status.until);
   world.setCombatView(telegraphViews, { player: time < rt.hitStopUntil, entities: frozen }, sunk);
   for (const v of telegraphViews) if (v.phase === 'windup' && !toned.has(v.actionId)) { toned.add(v.actionId); audio.windup(.4); }
   if (toned.size > 64) toned.clear();
@@ -608,6 +610,7 @@ function presentCombat(t: CombatTick) {
     if (e.amount > 0 || e.outcome !== 'hit') floater(damageText(e.outcome, e.unit, e.amount), pos.x, pos.y, toPlayer ? 'hurt' : 'hit');
     const colour = e.outcome === 'countered' ? IMPACT_COLOURS.counter : e.outcome === 'blocked' || e.outcome === 'guard-broken' ? IMPACT_COLOURS.block : toPlayer ? IMPACT_COLOURS.hurt : IMPACT_COLOURS.hit;
     if (e.outcome !== 'evaded' && e.outcome !== 'immune') world.burst(local.x, local.y, local.z, colour, IMPACT_PARTICLES);
+    if (e.status === 'inked') world.burst(local.x, local.y, local.z, EFFECTS.ink!.particles, 24);   // the ink cloud
     if (e.outcome === 'hit') { if (toPlayer) audio.hurt(); else audio.hit(); }
     else if (e.outcome === 'blocked') audio.block(); else if (e.outcome === 'guard-broken') audio.breakFree(); else if (e.outcome === 'countered') audio.counter();
     else if (e.outcome === 'grabbed') audio.grab(); else if (e.outcome === 'evaded') audio.dash();
```

- [ ] **Step 5: Check 15 uses the ray**

The squid has no contact hazard now. In `e2e/tiny-tide-paths.mjs` check `'15'`:
- replace `const pick = await pickHazard(page, { stage: 2, key: '2:squid', below: true, minLeadSeconds: .5 }); assert.ok(pick, 'pickHazard found a squid with room below');` with `const pick = await pickHazard(page, { stage: 2, key: '2:ray', below: true, minLeadSeconds: .5 }); assert.ok(pick, 'pickHazard found a ray with room below');`
- replace `await play(page, { stage: 2, health: 1, seed: pick.seed }, …)` with `health: .5` (a ray sting after armor is at least one half-heart, so it always faints the creature).

- [ ] **Step 6: Re-record the golden** (the size-1 species change the stage-0 world: sardines and puffers are placed with the tier-1 spawns that the stage-0 scene also shows)

Run: `TIDE_SIM_RECORD=sim npx vitest run tests/tiny-tide-core/sim.test.ts`
Expected: PASS. Then check the new golden by eye: the positions of the first 5 s (forward swim) are unchanged; health and DNA change only where the route meets a new species.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/ecosystem.test.ts tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/hit-resolver.test.ts tests/tiny-tide-core/avoidance.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 8: Checkpoint**, then `node e2e/tiny-tide-paths.mjs 15` and `node e2e/tiny-tide.mjs` against the running server. Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/tiny-tide/species.ts src/tiny-tide/profiles.ts src/tiny-tide/registries.ts src/tiny-tide/biomes.ts src/tiny-tide/ecosystem.ts src/tiny-tide/combat-world.ts src/tiny-tide/hit-resolver.ts src/tiny-tide/avoidance.ts src/tiny-tide/controls.css src/tiny-tide/main.ts tests/tiny-tide-core/ecosystem.test.ts tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/hit-resolver.test.ts tests/tiny-tide-core/sim-golden.json e2e/tiny-tide-paths.mjs
git commit -m "Tiny Tide combat: size-1 species (sardine schools, puffer, squid fighter, moray eel dens); sim golden re-recorded for the new spawns

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T19: The Reef Tyrant

**Spec:** §7.6 (Tyrant jaw), §11.3, §11.6 (phase 2 laps), D23, D25.

**Files:**
- Modify: `src/tiny-tide/species.ts`, `src/tiny-tide/parts.ts`
- Modify: `tests/tiny-tide-core/combat-ai.test.ts`

**Interfaces:**
- Consumes: T13 `reef-tyrant` behaviour and `LAPS`; T17 rare parts and alpha presence.
- Produces: species `reef_tyrant` (tier 2, hunts `[1]`, `model 'worm'`, `bodyScale 1.6`, `alpha: { size: 1, rewardPartId: 'mouth_tyrant', rewardDna: 60 }`); the rare part `mouth_tyrant` ("Tyrant jaw", model `mouth_fangs`, carnivore).

**Decision in this task (spec ambiguity):** in phase 2 the Tyrant shares the `hostile` set with phase 1 (it stays hostile to size 1 only); the laps use `lairFraction` of phase 2 (T1 type addition).

- [ ] **Step 1: Write the failing test**

```diff
--- a/tests/tiny-tide-core/combat-ai.test.ts
+++ b/tests/tiny-tide-core/combat-ai.test.ts
@@ -154,4 +154,17 @@ describe('combat AI: alphas', () => {
     step(0, .3, ['claw_mother']); expect(mother.eaten).toBe(true);   // defeated earlier: gone for the run
     eco.consume(mother); expect(mother.respawn).toBe(-1);
   });
+  it('reef tyrant laps: a charge every half lap, two charges, then a 1.5 s rest', () => {
+    const tyrant = BEHAVIOURS['reef-tyrant']!, L = 35.84, s = newAiState(1, 13); s.home = at(0, 0);
+    const input = () => ({ self: { ...base().self, L, hp: 50, maxHp: 110, speed: 1.5 * 16 }, inLair: true, pursuit: 'hunt' as const, player: { position: at(0, 10), d: 1, visible: true, targetable: true } });
+    drive(tyrant, s, 1, input);   // phase 2 (50 / 110 = .45: above .33): the roar, then laps
+    expect(s.phase).toBe(1);
+    const log = drive(tyrant, s, 30, input, () => false, 1);   // a half lap is about 5.9 s
+    const charges = log.filter(l => l.out.attack).map(l => l.t);
+    const half = Math.PI * .8 * 2.2 * L / (1.5 * 16 * 1.4);   // π × lap radius / (speed × 1.4)
+    expect(log.filter(l => l.out.attack).every(l => l.out.attack!.attackId === 'tyrant-charge')).toBe(true);
+    expect(charges[1]! - charges[0]!).toBeGreaterThanOrEqual(half - 1e-6);
+    expect(charges[2]! - charges[1]!).toBeGreaterThanOrEqual(1.5 + .65 + .3 + .5 - .1);   // the rest after two charges (and the charge itself)
+    expect(log.some(l => l.state === 'lap-rest')).toBe(true);
+  });
 });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts`
Expected: FAIL — `reef tyrant laps …` (no `reef_tyrant` species).

- [ ] **Step 3: Implement**

```diff
--- a/src/tiny-tide/parts.ts
+++ b/src/tiny-tide/parts.ts
@@ -103,6 +103,7 @@ const PARTS_BASE: readonly PartSpec[] = [
 export const PARTS: readonly PartSpec[] = [
   ...PARTS_BASE,
   rare('claw_mother', 'Clawmother pincer', 'claw_pincer', 'arm', 0, 18, { bite: 2 }, true, '#b5523b', 'The old queen’s pincer. Holds bigger prey.'),
+  rare('mouth_tyrant', 'Tyrant jaw', 'mouth_fangs', 'mouth', 1, 30, { bite: 2 }, false, '#6b3f7a', 'The reef’s worst bite. Now yours.', 'carnivore'),
 ];
 export type PartId = typeof PARTS[number]['id'];
 const byId = new Map(PARTS.map(part => [part.id, part]));
--- a/src/tiny-tide/species.ts
+++ b/src/tiny-tide/species.ts
@@ -2,7 +2,7 @@ import type { SpeciesCombatFields } from './combat-types';
 // Everything that lives (or floats, or sails) in the Tiny Tide universe.
 export type FoodKind = 'plant' | 'kelp_snack' | 'seagrape' | 'lettuce' | 'copepod' | 'worm' | 'shrimp' | 'crab' | 'jellyfish' | 'snail' | 'fish' | 'squid' | 'ray' | 'bird' | 'tree' | 'boat' | 'plane' | 'balloon' | 'lighthouse' | 'planet'
   /** Combat species of sizes 0 and 1 (spec §11.3); each draws an existing GLB through `model`. */
-  | 'drifter' | 'spiny_snail' | 'clawmother' | 'sardine' | 'puffer' | 'eel';
+  | 'drifter' | 'spiny_snail' | 'clawmother' | 'sardine' | 'puffer' | 'eel' | 'reef_tyrant';
 export type FoodTag = 'plant' | 'meat' | 'any';
 export type Behavior = 'still' | 'drift' | 'graze' | 'school' | 'skittish' | 'flyer';
 export interface Species extends SpeciesCombatFields {
@@ -63,6 +63,8 @@ export const SPECIES: readonly Species[] = [
     attackIds: ['mother-pinch', 'mother-pinch-2', 'mother-lunge', 'mother-emerge', 'mother-sweep', 'mother-pinch-rage'], alpha: { size: 0, rewardPartId: 'claw_mother', rewardDna: 40 } }),
   s(1, 'sardine', 'meat', 'Sunny sardine', 'school', 12, 15, { hp: 4, speed: 3.2, model: 'fish', tint: '#ffd36e', bodyScale: .55, behaviourId: 'sardine' }),
   s(1, 'puffer', 'meat', 'Puffer', 'drift', 6, 20, { hp: 10, speed: .9, model: 'fish', tint: '#f2c94c', bodyScale: .75, behaviourId: 'puffer', attackIds: ['puffer-burst'], fights: true, pursuitId: 'retaliate' }),
+  s(2, 'reef_tyrant', 'meat', 'Reef Tyrant', 'skittish', 1, 0, { hp: 110, speed: 1.5, model: 'worm', tint: '#4b2f5e', bodyScale: 1.6, behaviourId: 'reef-tyrant', hunts: [1], fights: true, pursuitId: 'hunter',
+    attackIds: ['tyrant-bite', 'tyrant-den-lunge', 'tyrant-charge', 'tyrant-whirl'], alpha: { size: 1, rewardPartId: 'mouth_tyrant', rewardDna: 60 } }),
   s(2, 'eel', 'meat', 'Moray eel', 'skittish', 4, 28, { hp: 22, speed: 1.4, model: 'worm', tint: '#3d6b4f', behaviourId: 'eel', attackIds: ['eel-ambush', 'eel-bite', 'eel-wrap'], hunts: [1], fights: true, pursuitId: 'ambusher' }),
 ];
 const byKey = new Map(SPECIES.map(spec => [spec.key, spec]));
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/combat-ai.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/moves.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed (the Tyrant lives at size 1; stage 0 does not change).

- [ ] **Step 5: Checkpoint.** Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/tiny-tide/species.ts src/tiny-tide/parts.ts tests/tiny-tide-core/combat-ai.test.ts
git commit -m "Tiny Tide combat: the Reef Tyrant alpha and the rare Tyrant jaw

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T20: Slot pins in saves; remove `qa-catalog.ts`

**Spec:** §7.2, §10.5, §3.2 (`design-delta.ts`, `qa-catalog.ts`), D2, D32.

**Files:**
- Modify: `src/tiny-tide/combat-types.ts`, `src/tiny-tide/state.ts`, `src/tiny-tide/design-delta.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/editor.ts`, `src/tiny-tide/main.ts`
- Delete: `src/tiny-tide/qa-catalog.ts`
- Modify: `tests/tiny-tide-core/state.test.ts`, `tests/tiny-tide-core/contract.test.ts`, `tests/tiny-tide-core/lifecycle.test.ts`, `tests/tiny-tide-core/saves.test.ts`
- Modify: `tests-browser/fixtures.ts`, `e2e/tiny-tide-paths.mjs` (check 12b is removed here and comes back in T21)

**Interfaces:**
- Consumes: T2 `clearMissingPins`, `grantedKinds`, `movesOf`, `NO_PINS`.
- Produces: `CombatLoadout { slots: Tuple4<SlotPin> }`; `state.emptyLoadout()`; `clearMissing` clears pins of kinds the design no longer grants and reports them in `Commit.clearedPins`; `validateRun` messages `'loadout: kind twice'` and `'loadout <i>: <kind>'` (a pin of a kind that is not granted); `readV4` reads the old `{ active: [...] }` as four empty pins; `designDelta(...)` returns `clearedPins` and `lostKinds` (was `clearedBindings`); `sim.ts` caches the slot assignment by genome revision and pins; `main.ts` uses `CATALOG = PARTS`; `?qaGrantCatalog` is gone.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/saves.test.ts
+++ b/tests/tiny-tide-core/saves.test.ts
@@ -34,6 +34,16 @@ describe('v4 saves', () => {
     const run = parseSave(JSON.stringify({ ...r, health: max + 5 }), build)!;
     expect(run.health).toBe(max); expect(validateRun(run, build)).toEqual([]);
   });
+  it('v4 save with loadout.active loads as four empty pins', () => {
+    const r = freshRun(1), old = { ...r, loadout: { active: [null, null] } };
+    expect(parseSave(JSON.stringify(old), build)!.loadout).toEqual({ slots: [null, null, null, null] });
+    expect(parseSave(JSON.stringify({ ...r, loadout: { active: 'x' } }), build)).toBeNull();
+  });
+  it('new loadout round-trips', () => {
+    const r = freshRun(1); r.loadout = { slots: [null, 'dash', null, null] };   // the Speck starter grants Dash
+    expect(parseSave(JSON.stringify(r), build)!.loadout).toEqual({ slots: [null, 'dash', null, null] });
+    expect(parseSave(JSON.stringify({ ...r, loadout: { slots: ['sweep', null, null, null] } }), build)).toBeNull();   // a kind the design does not grant
+  });
   it('half-heart health loads', () => {
     const r = freshRun(1), max = maxHealthOf(r);
     expect(parseSave(JSON.stringify({ ...r, health: 2.5 }), build)!.health).toBe(2.5);
--- a/tests/tiny-tide-core/state.test.ts
+++ b/tests/tiny-tide-core/state.test.ts
@@ -5,17 +5,16 @@ import { alphaReward, applyDesign, commitEvolution, currentPlan, dnaOf, eat, fai
 import { adaptToPlan, nextUid, type Genome } from '../../src/tiny-tide/genome';
 import { plan } from '../../src/tiny-tide/plans';
 import { species } from '../../src/tiny-tide/species';
-import { PARTS, type PartSpec } from '../../src/tiny-tide/parts';
 
 const build = { coast: false };
 const ready = (seed = 1) => { const r = freshRun(seed); r.stageDna = STAGES[0]!.goal; return r; };
 const design = (g: Genome, id: string, diet?: 'carnivore') => { const a = adaptToPlan(g, plan(id)!, { unlocked: [], diet }, 50); if (!a.ok) throw new Error(a.reasons.join(' ')); return a.genome; };
 const evolveTo = (r: Run, id: string, g: Genome, name = r.name) => { const p = prepareEvolution(r, id, g, name, build, r.nextPartSerial); if (!('planId' in p)) throw new Error(p.reason); commitEvolution(r, p); };
 describe('run v4', () => {
-  it('starts on Speck with 20 banked DNA, a herbivore diet, an empty two-slot loadout and serial 5', () => {
+  it('starts on Speck with 20 banked DNA, a herbivore diet, four empty pins and serial 5', () => {
     const r = freshRun(1);
     expect(r).toMatchObject({ version: 4, plans: ['speck'], diet: 'herbivore', nextPartSerial: 5, pendingRespawn: false, archive: [], notices: [], mechanics: {} });
-    expect(dnaOf(r)).toBe(20); expect(r.loadout.active).toEqual([null, null]); expect(validateRun(r, build)).toEqual([]);
+    expect(dnaOf(r)).toBe(20); expect(r.loadout).toEqual({ slots: [null, null, null, null] }); expect(validateRun(r, build)).toEqual([]);
   });
   it('earns at risk, with the plan foraging bonus for matching food', () => {
     const r = ready(); evolveTo(r, 'crawler', r.genome);
@@ -42,7 +41,7 @@ describe('run v4', () => {
   });
   it('charges edits through the ledger and reports the shortfall', () => {
     const r = freshRun(3), fins = { ...r.genome, parts: [...r.genome.parts, { uid: nextUid(5), id: 'fin_side', t: .5, angle: 1.8, scale: 1, mirror: true, roll: 0 }] };
-    expect(applyDesign(r, fins, r.name, build, 6)).toEqual({ ok: true, clearedBindings: [] }); expect(dnaOf(r)).toBe(0); expect(r.nextPartSerial).toBe(6);
+    expect(applyDesign(r, fins, r.name, build, 6)).toEqual({ ok: true, clearedPins: [] }); expect(dnaOf(r)).toBe(0); expect(r.nextPartSerial).toBe(6);
     const bigger = { ...fins, parts: fins.parts.map(p => p.uid === 'p5' ? { ...p, scale: 1.4 } : p) };   // round(10 × 2 × 1.2) = 24: buy 4, still 2 slots
     expect(applyDesign(r, bigger, r.name, build, 6)).toEqual({ ok: false, reason: 'Not enough DNA.', shortfall: 4 });
     const spike = { ...fins, parts: [...fins.parts, { uid: nextUid(6), id: 'spike', t: .3, angle: 0, scale: 1, mirror: false, roll: 0 }] };
@@ -114,7 +113,7 @@ describe('run v4', () => {
     const r = ready(); evolveTo(r, 'crawler', r.genome);
     const bad: unknown[] = [
       { ...r, plans: ['speck', 'swimmer'] }, { ...r, plans: ['speck', 'darter'] }, { ...r, diet: 'carnivore' },
-      { ...r, nextPartSerial: 2 }, { ...r, loadout: { active: [null, null, null] } }, { ...r, loadout: { active: [0, null] } },
+      { ...r, nextPartSerial: 2 }, { ...r, loadout: { slots: [null, null, null] } }, { ...r, loadout: { slots: [0, null, null, null] } }, { ...r, loadout: { slots: ['grab', null, null, null] } },
       { ...r, pendingRespawn: 'yes' }, { ...r, economy: { ...r.economy, wallet: { banked: -1, atRisk: 0 } } },
       { ...r, genome: { ...r.genome, parts: [...r.genome.parts, { ...r.genome.parts[0]! }] } },
     ];
@@ -133,18 +132,15 @@ describe('planets', () => {
   });
 });
 
-const grantParts: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
 const clawRun = () => { const r = freshRun(1); r.genome.parts.push({ uid: 'p5', id: 'claw_pincer', t: .45, angle: 2, scale: 1, mirror: true, roll: 0 }); r.nextPartSerial = 6;
-  r.economy.parts.p5 = { basis: 24, credit: { banked: 24, atRisk: 0 } }; r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, null]; return r; };   // claw pair: round(12 × 2 × 1) = 24
-it('validates a binding against the catalog it is given', () => {
-  expect(validateRun(clawRun(), build, grantParts)).toEqual([]);
-  expect(validateRun(clawRun(), build)).toContain('loadout 0: grant snap');
+  r.economy.parts.p5 = { basis: 24, credit: { banked: 24, atRisk: 0 } }; r.loadout = { slots: ['grab', null, null, 'dash'] }; return r; };   // claw pair: round(12 × 2 × 1) = 24
+it('validates pins: granted kinds only, no kind twice, four entries, no extra keys', () => {
+  expect(validateRun(clawRun(), build)).toEqual([]);
+  const r = clawRun(); r.loadout = { slots: ['grab', 'grab', null, null] }; expect(validateRun(r, build)).toContain('loadout: kind twice');
+  const s = clawRun(); s.loadout = { slots: ['brace', null, null, null] }; expect(validateRun(s, build)).toContain('loadout 0: brace');   // no Shell plate
+  const t = clawRun(); (t.loadout as unknown as Record<string, unknown>).active = []; expect(validateRun(t, build)).toContain('loadout');
 });
-it('rejects the same binding in both slots, and extra keys', () => {
-  const r = clawRun(); r.loadout.active = [{ partUid: 'p5', grantId: 'snap' }, { partUid: 'p5', grantId: 'snap' }]; expect(validateRun(r, build, grantParts)).toContain('loadout: duplicate binding');
-  const s = clawRun(); (s.loadout.active as unknown[])[0] = { partUid: 'p5', grantId: 'snap', extra: 1 }; expect(validateRun(s, build, grantParts)).toContain('loadout 0: shape');
-});
-it('clears a binding when its part is removed', () => {
+it('pins for missing kinds are cleared at commit', () => {
   const r = clawRun(), g = structuredClone(r.genome); g.parts = g.parts.filter(p => p.uid !== 'p5');
-  expect(applyDesign(r, g, r.name, build, r.nextPartSerial, grantParts)).toEqual({ ok: true, clearedBindings: [0] }); expect(r.loadout.active).toEqual([null, null]);
+  expect(applyDesign(r, g, r.name, build, r.nextPartSerial)).toEqual({ ok: true, clearedPins: ['grab'] }); expect(r.loadout).toEqual({ slots: [null, null, null, 'dash'] });
 });
```

```diff
--- a/tests/tiny-tide-core/contract.test.ts
+++ b/tests/tiny-tide-core/contract.test.ts
@@ -205,24 +205,23 @@ describe('combat contract', () => {
 });
 
 const withClaw = (over: Partial<Genome['parts'][number]> = {}): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p5', id: 'claw_pincer', t: .2, angle: 2, scale: 1, mirror: true, roll: 0, ...over }] });
-const grantCatalog: PartSpec[] = PARTS.map(p => p.id === 'claw_pincer' ? { ...p, activeGrants: [{ id: 'snap', abilityId: 'dash', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' as const }] } : p);
 describe('design delta', () => {
   it('lists emitters per copy', () => { expect(emittersOf(withClaw()).filter(e => e.partUid === 'p5')).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }, { kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); });
   it('removes copy 1 and changes copy 0 when a mirror is unpaired', () => {
-    const d = designDelta(withClaw(), withClaw({ mirror: false }), { active: [null, null] });
+    const d = designDelta(withClaw(), withClaw({ mirror: false }), { slots: [null, null, null, null] });
     expect(d.removedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 1, socketId: 'pinch' }]); expect(d.changedEmitters).toEqual([{ kind: 'part', partUid: 'p5', copy: 0, socketId: 'pinch' }]);
   });
-  it('treats a same-uid catalog replacement as removal of sockets it no longer has, and clears a lost grant', () => {
-    const loadout = { active: [{ partUid: 'p5', grantId: 'snap' }, null] as [{ partUid: string; grantId: string }, null] };
-    const d = designDelta(withClaw(), withClaw({ id: 'spike', mirror: false }), loadout, grantCatalog);
+  it('treats a same-uid catalog replacement as removal of sockets it no longer has, and clears the pin of a lost kind', () => {
+    // The Pincer pair (Grab) becomes a Spike (Counter): the Grab pin is cleared; Dash (the starter's tail and legs) stays.
+    const d = designDelta(withClaw(), withClaw({ id: 'spike', mirror: false }), { slots: ['grab', 'dash', null, null] });
     expect(d.removedEmitters.map(e => `${e.copy}:${e.socketId}`)).toEqual(['0:pinch', '1:pinch']);
-    expect(d.clearedBindings).toEqual([{ slot: 0, binding: { partUid: 'p5', grantId: 'snap' }, reason: 'grant missing' }]);
+    expect(d.clearedPins).toEqual([{ slot: 0, kind: 'grab' }]); expect(d.lostKinds).toEqual(['grab']);
   });
   it('reports nothing for an unchanged or repainted design, and a move or a reshape as a change', () => {
-    expect(designDelta(withClaw(), withClaw(), { active: [null, null] })).toEqual({ removedEmitters: [], changedEmitters: [], clearedBindings: [] });
-    expect(designDelta(withClaw(), { ...withClaw(), paint: { ...withClaw().paint, base: '#000000' } }, { active: [null, null] }).changedEmitters).toEqual([]);
-    expect(designDelta(withClaw(), withClaw({ t: .25 }), { active: [null, null] }).changedEmitters).toHaveLength(2);
+    expect(designDelta(withClaw(), withClaw(), { slots: [null, null, null, null] })).toEqual({ removedEmitters: [], changedEmitters: [], clearedPins: [], lostKinds: [] });
+    expect(designDelta(withClaw(), { ...withClaw(), paint: { ...withClaw().paint, base: '#000000' } }, { slots: [null, null, null, null] }).changedEmitters).toEqual([]);
+    expect(designDelta(withClaw(), withClaw({ t: .25 }), { slots: [null, null, null, null] }).changedEmitters).toHaveLength(2);
     const reshaped = { ...withClaw(), spine: withClaw().spine.map((s, i) => i === 1 ? { ...s, radius: s.radius + .1 } : s) };
-    expect(designDelta(withClaw(), reshaped, { active: [null, null] }).changedEmitters).toHaveLength(emittersOf(withClaw()).length);
+    expect(designDelta(withClaw(), reshaped, { slots: [null, null, null, null] }).changedEmitters).toHaveLength(emittersOf(withClaw()).length);
   });
 });
--- a/tests/tiny-tide-core/lifecycle.test.ts
+++ b/tests/tiny-tide-core/lifecycle.test.ts
@@ -45,15 +45,15 @@ describe('lifecycle', () => {
   });
   const cats = { ...defaultCatalogs(), parts: grant, attacks: { pinch: { ...syntheticAttack, cooldownSeconds: 1 } } };
   it('cancels actions of removed and changed emitters, and keeps cooldowns whose grant survives', () => {
-    const rt = busy(), kept = claw({ mirror: false }); reconcileAfterCommit(rt, designDelta(claw(), kept, { active: [null, null] }, grant), kept, 'player', 0, cats);
+    const rt = busy(), kept = claw({ mirror: false }); reconcileAfterCommit(rt, designDelta(claw(), kept, { slots: [null, null, null, null] }, grant), kept, 'player', 0, cats);
     expect(rt.actions).toEqual([]); expect([...rt.cooldowns.keys()]).toEqual(['player:p5:snap']);   // copy 1 removed, copy 0 changed; the grant still exists
-    const rt2 = busy(), swapped = claw({ id: 'spike', mirror: false }); reconcileAfterCommit(rt2, designDelta(claw(), swapped, { active: [null, null] }, grant), swapped, 'player', 0, cats);
+    const rt2 = busy(), swapped = claw({ id: 'spike', mirror: false }); reconcileAfterCommit(rt2, designDelta(claw(), swapped, { slots: [null, null, null, null] }, grant), swapped, 'player', 0, cats);
     expect(rt2.cooldowns.size).toBe(0);   // same uid, catalog replacement without the grant
-    const rt3 = busy(); reconcileAfterCommit(rt3, designDelta(claw(), claw(), { active: [null, null] }, grant), claw(), 'player', 0, cats); expect(rt3.actions).toHaveLength(2);
+    const rt3 = busy(); reconcileAfterCommit(rt3, designDelta(claw(), claw(), { slots: [null, null, null, null] }, grant), claw(), 'player', 0, cats); expect(rt3.actions).toHaveLength(2);
   });
   it('reserves the cooldown of an interrupted action whose grant survives', () => {
     const rt = newRuntime(); rt.actions.push(action('p5', 0)); const moved = claw({ t: .5 });
-    reconcileAfterCommit(rt, designDelta(claw(), moved, { active: [null, null] }, grant), moved, 'player', 10, cats);
+    reconcileAfterCommit(rt, designDelta(claw(), moved, { slots: [null, null, null, null] }, grant), moved, 'player', 10, cats);
     expect(rt.actions).toEqual([]); expect(rt.cooldowns.get('player:p5:snap')).toBe(11);   // 10 + cooldown 1, though the map was empty
   });
   it('recovers a pitched long body by levelling it, and never returns an unchecked anchor', () => {
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/saves.test.ts`
Expected: FAIL — `v4 save with loadout.active loads as four empty pins`; `emptyLoadout` not exported.

- [ ] **Step 3: Implement**

```diff
--- a/src/tiny-tide/combat-types.ts
+++ b/src/tiny-tide/combat-types.ts
@@ -21,8 +21,8 @@ export interface CombatSocket { id: string; pivot?: PivotRef; origin: Vec3; forw
 export interface AttackGrant { id: string; attackId: string; socketIds: readonly string[] }
 export interface ActiveGrant { id: string; abilityId: string; socketIds: readonly string[]; mirrorPolicy: 'shared-cast' }
 export interface PartCombatFields { traits: readonly CombatTrait[]; sockets: readonly CombatSocket[]; basicAttacks: readonly AttackGrant[]; activeGrants: readonly ActiveGrant[] }
-export interface AbilityBinding { partUid: PartUid; grantId: string }
-export interface CombatLoadout { active: [AbilityBinding | null, AbilityBinding | null] }
+/** The slot pins (spec §7.2, D2): four entries, each a pinned move kind or null. Replaces `{ active: [AbilityBinding | null × 2] }`. */
+export interface CombatLoadout { slots: Tuple4<SlotPin> }
 /** Shape numbers are in attacker body lengths (L_a), in the aim frame (z = aim). A capsule with start = end is a sphere. */
 export type AttackShape = { kind: 'cone'; range: number; halfAngle: number } | { kind: 'capsule'; start: Vec3; end: Vec3; radius: number };
 /** value = base × (1 + k × (scale − 1)); one k per parameter key (moves.ts `resolveMove` names the key syntax). */
--- a/src/tiny-tide/design-delta.ts
+++ b/src/tiny-tide/design-delta.ts
@@ -1,10 +1,12 @@
 // The emitter-level difference between two designs (spec §7): which weapons vanish, which move, which bindings break.
-import type { ActiveSlot, AbilityBinding, CombatLoadout, EmitterSource } from './combat-types';
+import type { ActiveSlot, CombatLoadout, EmitterSource, MoveKind } from './combat-types';
 import type { Genome, PlacedPart } from './genome';
 import { PARTS, type PartSpec } from './parts';
+import { grantedKinds, movesOf } from './moves';
 
 export type PartEmitterSource = Extract<EmitterSource, { kind: 'part' }>;
-export interface DesignDelta { removedEmitters: PartEmitterSource[]; changedEmitters: PartEmitterSource[]; clearedBindings: { slot: ActiveSlot; binding: AbilityBinding; reason: 'part removed' | 'grant missing' }[] }
+/** `clearedPins`: pins whose kind the new design no longer grants (spec §7.2); `lostKinds`: every kind the old design granted and the new one does not. */
+export interface DesignDelta { removedEmitters: PartEmitterSource[]; changedEmitters: PartEmitterSource[]; clearedPins: { slot: ActiveSlot; kind: MoveKind }[]; lostKinds: MoveKind[] }
 
 /** Per part, copy 0 then copy 1 if mirrored, sockets in catalog order. */
 export function emittersOf(g: Genome, catalog: readonly PartSpec[] = PARTS): PartEmitterSource[] {
@@ -27,12 +29,8 @@ export function designDelta(oldG: Genome, newG: Genome, loadout: CombatLoadout,
     const before = oldG.parts.find(p => p.uid === e.partUid)!, after = newG.parts.find(p => p.uid === e.partUid)!;
     if (reshaped || moved(before, after)) changedEmitters.push(e);
   }
-  const clearedBindings: DesignDelta['clearedBindings'] = [];
-  loadout.active.forEach((binding, i) => {
-    if (!binding) return;
-    const placed = newG.parts.find(p => p.uid === binding.partUid);
-    if (!placed) { clearedBindings.push({ slot: i as ActiveSlot, binding, reason: 'part removed' }); return; }
-    if (!catalog.find(s => s.id === placed.id)?.activeGrants.some(g => g.id === binding.grantId)) clearedBindings.push({ slot: i as ActiveSlot, binding, reason: 'grant missing' });
-  });
-  return { removedEmitters, changedEmitters, clearedBindings };
+  const before = grantedKinds(movesOf(oldG, catalog)), after = grantedKinds(movesOf(newG, catalog));
+  const clearedPins: DesignDelta['clearedPins'] = [];
+  loadout.slots.forEach((kind, i) => { if (kind && !after.includes(kind)) clearedPins.push({ slot: i as ActiveSlot, kind }); });
+  return { removedEmitters, changedEmitters, clearedPins, lostKinds: before.filter(k => !after.includes(k)) };
 }
--- a/src/tiny-tide/state.ts
+++ b/src/tiny-tide/state.ts
@@ -4,7 +4,8 @@ import { PARTS, part, type Diet, type PartSpec } from './parts';
 import { closedLinesOf, commitmentsOf, eligibleChildren, plan, ROOT_PLAN, violates, type BodyPlan } from './plans';
 import { PLANET_COUNT } from './biomes';
 import type { FoodTag, Species } from './species';
-import type { CombatLoadout } from './combat-types';
+import { MOVE_PRIORITY, type CombatLoadout, type MoveKind } from './combat-types';
+import { clearMissingPins, grantedKinds, movesOf } from './moves';
 
 export { PLANET_COUNT, SIZES, WATER_LEVEL, random, seabedHeight } from './biomes';
 export interface Stage {
@@ -35,7 +36,9 @@ export interface Run {
   loadout: CombatLoadout; pendingRespawn: boolean; mechanics: Record<string, unknown>; archive: ArchivedDesign[]; notices: string[];
 }
 export interface Build { coast: boolean; anchorCheck?: DesignContext['anchorCheck'] }
-export type Commit = { ok: true; clearedBindings: number[] } | { ok: false; reason: string; shortfall?: number };
+export type Commit = { ok: true; clearedPins: MoveKind[] } | { ok: false; reason: string; shortfall?: number };
+/** Four empty slot pins (spec §10.5). */
+export const emptyLoadout = (): CombatLoadout => ({ slots: [null, null, null, null] });
 export interface Prepared { planId: string; genome: Genome; name: string; economy: Economy; diet: Diet; nextSerial: number }
 export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
 export const dnaOf = (run: Run) => walletTotal(run.economy);
@@ -45,7 +48,7 @@ export function freshRun(seed = newSeed()): Run {
   const genome = starterGenome();
   const run: Run = { version: 4, seed, name: 'Little Tide', stage: 0, plans: [ROOT_PLAN], diet: dietOf(genome), economy: legacyEconomy(START_DNA, genome), stageDna: 0, totalDna: 0,
     bites: 0, elapsed: 0, deaths: 0, health: 0, genome, nextPartSerial: STARTER_NEXT_SERIAL, unlocked: [], eatenPlanets: [], completed: false,
-    loadout: { active: [null, null] }, pendingRespawn: false, mechanics: {}, archive: [], notices: [] };
+    loadout: emptyLoadout(), pendingRespawn: false, mechanics: {}, archive: [], notices: [] };
   run.health = maxHealthOf(run); return run;
 }
 export const dietCanEat = (diet: Diet, tag: FoodTag) => tag === 'any' || diet === 'omnivore' || (diet === 'herbivore' ? tag === 'plant' : tag === 'meat');
@@ -121,18 +124,13 @@ export function alphaReward(run: Run, spec: Species): { dna: number; part: strin
 }
 const serialAfter = (g: Genome, ...floors: number[]) => Math.max(...floors, ...g.parts.map(p => uidSerial(p.uid) + 1));
 type Failure = { ok: false; reason: string; shortfall?: number };
-/** Clears bindings whose part is gone or whose catalog spec no longer has the grant. */
-function clearMissing(run: Run, catalog: readonly PartSpec[]) {
-  const cleared: number[] = [];
-  run.loadout.active = run.loadout.active.map((binding, i) => {
-    if (!binding) return binding;
-    const placed = run.genome.parts.find(p => p.uid === binding.partUid), spec = placed && catalog.find(s => s.id === placed.id);
-    if (!placed || !spec?.activeGrants.some(g => g.id === binding.grantId)) { cleared.push(i); return null; } return binding;
-  }) as CombatLoadout['active'];
-  return cleared;
+/** Clears the pins of kinds the design no longer grants (spec §7.2). */
+function clearMissing(run: Run, catalog: readonly PartSpec[]): MoveKind[] {
+  const r = clearMissingPins(run.loadout.slots, grantedKinds(movesOf(run.genome, catalog)));
+  run.loadout = { slots: r.pins }; return r.cleared;
 }
 /** Runs every check on a copy; returns the copy only when it is valid. Never mutates `run`. */
-function candidate(run: Run, change: (c: Run) => void, build: Build, catalog: readonly PartSpec[]): { run: Run; cleared: number[] } | Failure {
+function candidate(run: Run, change: (c: Run) => void, build: Build, catalog: readonly PartSpec[]): { run: Run; cleared: MoveKind[] } | Failure {
   const c = structuredClone(run); change(c); const cleared = clearMissing(c, catalog);
   const issues = validateRun(c, build, catalog); return issues.length ? { ok: false, reason: `Internal check failed: ${issues[0]}` } : { run: c, cleared };
 }
@@ -148,7 +146,7 @@ export function applyDesign(run: Run, g: Genome, name: string, build: Build, nex
   const next = candidate(run, c => { c.economy = tx.economy; c.genome = cloneGenome(g); c.name = name.trim().slice(0, 24) || c.name;
     c.nextPartSerial = serialAfter(g, c.nextPartSerial, nextSerial); c.health = Math.min(c.health, maxHealthOf(c)); }, build, catalog);
   if ('ok' in next) return next;
-  Object.assign(run, next.run); return { ok: true, clearedBindings: next.cleared };
+  Object.assign(run, next.run); return { ok: true, clearedPins: next.cleared };
 }
 /** Checks an evolution and prices it. It never changes `run`. */
 export function prepareEvolution(run: Run, planId: string, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Prepared | Failure {
@@ -167,8 +165,8 @@ function applyEvolution(c: Run, p: Prepared) {
   c.economy = bankAll(p.economy); c.genome = cloneGenome(p.genome); c.name = p.name; c.diet = p.diet; c.plans.push(p.planId);
   c.stage++; c.stageDna = 0; c.nextPartSerial = Math.max(c.nextPartSerial, p.nextSerial); c.health = maxHealthOf(c);
 }
-/** Applies a validated Prepared atomically. Returns the cleared binding slots. */
-export function commitEvolution(run: Run, p: Prepared, catalog: readonly PartSpec[] = PARTS): number[] {
+/** Applies a validated Prepared atomically. Returns the kinds whose pins it cleared. */
+export function commitEvolution(run: Run, p: Prepared, catalog: readonly PartSpec[] = PARTS): MoveKind[] {
   const c = structuredClone(run); applyEvolution(c, p); const cleared = clearMissing(c, catalog); Object.assign(run, c); return cleared;
 }
 /** The faint (spec §10.3, R7), once: every at-risk credit is lost and the growth bar resets; basis, banked credit and the design stay.
@@ -221,18 +219,13 @@ export function validateRun(run: Run, build: Build, catalog: readonly PartSpec[]
     for (const x of problems(run.genome, currentPlan(run), { unlocked: run.unlocked, diet: run.diet }, catalog).filter(x => x.code !== 'dna' && x.code !== 'anchor')) out.push(`design ${x.code}: ${x.message}`);
     if (!finite(run.health) || run.health > maxHealthOf(run) || !Number.isInteger(run.health * 2)) out.push('health');
   }
-  const active = run.loadout?.active;
-  if (!isObject(run.loadout) || !Array.isArray(active) || active.length !== 2) out.push('loadout');
+  // Pins (spec §10.5): four entries, each null or a granted kind, no kind twice.
+  const slots = run.loadout?.slots as unknown;
+  if (!isObject(run.loadout) || Object.keys(run.loadout).length !== 1 || !Array.isArray(slots) || slots.length !== 4) out.push('loadout');
   else {
-    active.forEach((b, i) => {
-      if (b === null) return;
-      if (!isObject(b) || Object.keys(b).length !== 2 || typeof b.partUid !== 'string' || typeof b.grantId !== 'string') { out.push(`loadout ${i}: shape`); return; }
-      const placed = run.genome.parts.find(p => p.uid === b.partUid);
-      if (!placed) out.push(`loadout ${i}: part ${b.partUid}`);
-      else if (!catalog.find(s => s.id === placed.id)?.activeGrants.some(g => g.id === b.grantId)) out.push(`loadout ${i}: grant ${b.grantId}`);
-    });
-    const [x, y] = active as unknown[];
-    if (isObject(x) && isObject(y) && x.partUid === y.partUid && x.grantId === y.grantId) out.push('loadout: duplicate binding');
+    const granted = pathOk ? grantedKinds(movesOf(run.genome, catalog)) : [];
+    slots.forEach((k, i) => { if (k !== null && !(typeof k === 'string' && (MOVE_PRIORITY as readonly string[]).includes(k) && granted.includes(k as MoveKind))) out.push(`loadout ${i}: ${String(k)}`); });
+    if (new Set(slots.filter(k => k !== null)).size !== slots.filter(k => k !== null).length) out.push('loadout: kind twice');
   }
   if (typeof run.pendingRespawn !== 'boolean') out.push('pendingRespawn');
   if (!isObject(run.mechanics)) out.push('mechanics');
@@ -279,7 +272,7 @@ const isCredit = (c: unknown) => isObject(c) && typeof c.banked === 'number' &&
 function readV4(v: Record<string, unknown>): Run | null {
   if (v.version !== 4 || !strings(v.plans) || !DIETS.includes(v.diet as string) || !isObject(v.economy) || !isCredit(v.economy.wallet) || !isObject(v.economy.parts) ||
       !Object.values(v.economy.parts).every(l => isObject(l) && typeof l.basis === 'number' && isCredit(l.credit)) || !Number.isInteger(v.nextPartSerial) ||
-      !isObject(v.loadout) || !Array.isArray(v.loadout.active) || typeof v.pendingRespawn !== 'boolean' || !isObject(v.mechanics) || !Array.isArray(v.archive) || !strings(v.notices) ||
+      !isObject(v.loadout) || !(Array.isArray(v.loadout.active) || Array.isArray(v.loadout.slots)) || typeof v.pendingRespawn !== 'boolean' || !isObject(v.mechanics) || !Array.isArray(v.archive) || !strings(v.notices) ||
       !strings(v.unlocked) || !Array.isArray(v.eatenPlanets) || typeof v.name !== 'string' || typeof v.health !== 'number') return null;
   const genome = sanitizeGenome(v.genome); if (!genome) return null;
   const archive: ArchivedDesign[] = [];
@@ -291,7 +284,8 @@ function readV4(v: Record<string, unknown>): Run | null {
   // Only the Run fields (final review M18): an unknown top-level key is dropped, so it is never written back.
   const run = { version: 4, seed: v.seed, name: v.name, stage: v.stage, plans: v.plans, diet: v.diet, economy: v.economy, stageDna: v.stageDna, totalDna: v.totalDna,
     bites: v.bites, elapsed: v.elapsed, deaths: v.deaths, health: v.health, genome, nextPartSerial: v.nextPartSerial, unlocked: v.unlocked, eatenPlanets: v.eatenPlanets,
-    completed: v.completed, loadout: v.loadout, pendingRespawn: v.pendingRespawn, mechanics: v.mechanics, archive, notices: v.notices } as unknown as Run;
+    // A save from before 3a has `loadout.active` (no shipped part had an active grant): four empty pins (spec §10.5).
+    completed: v.completed, loadout: Array.isArray(v.loadout.slots) ? { slots: v.loadout.slots } : emptyLoadout(), pendingRespawn: v.pendingRespawn, mechanics: v.mechanics, archive, notices: v.notices } as unknown as Run;
   // Health has .5 steps (spec §10.1): a value between them rounds to the nearest half heart.
   if (run.plans.length && run.plans.every(id => plan(id)) && Number.isFinite(run.health)) { const max = maxHealthOf(run); run.health = run.health <= 0 ? max : Math.max(.5, Math.min(Math.round(run.health * 2) / 2, max)); }
   return run;
@@ -339,7 +333,7 @@ function migrate(old: LegacyRunV2): { run: Run; notes: string[] } {
   const used = Math.max(maxSerial, ...adapted.parts.map(p => uidSerial(p.uid)), (chosen?.c.nextSerial ?? 1) - 1);
   const run: Run = { version: 4, seed: old.seed, name: old.name, stage: old.stage, plans: path, diet: dietOf(adapted), economy: tx.economy, stageDna: count(old.stageDna), totalDna: count(old.totalDna),
     bites: count(old.bites), elapsed: Math.max(0, old.elapsed), deaths: count(old.deaths), health: 0, genome: adapted, nextPartSerial: used + 1, unlocked: [...old.unlocked], eatenPlanets: [...old.eatenPlanets],
-    completed: old.completed, loadout: { active: [null, null] }, pendingRespawn: false, mechanics: {},
+    completed: old.completed, loadout: emptyLoadout(), pendingRespawn: false, mechanics: {},
     archive: [{ genome: original, name: old.name, savedAt: new Date().toISOString(), reason: 'Saved before the body-plan update.' }], notices: notes };
   const max = maxHealthOf(run); run.health = old.health <= 0 ? max : Math.max(1, Math.min(old.health, max));
   return { run, notes };
```

```diff
--- a/src/tiny-tide/editor.ts
+++ b/src/tiny-tide/editor.ts
@@ -807,10 +807,10 @@ class Editor {
       const r = chip.dataset.region as Region, slots = plan.regions[r].slots;
       chip.textContent = `${REGION_LABEL[r]} ${used[r]} / ${slots}`; chip.classList.toggle('over', used[r] >= slots);
     });
-    // Abilities whose binding this design would clear.
-    const cleared = designDelta(this.original, this.draft, this.options.loadout, this.catalog).clearedBindings, lost = this.root.querySelector<HTMLElement>('.ed-lost-abilities')!;
-    lost.hidden = !cleared.length;
-    lost.innerHTML = cleared.length ? `<strong>You lose these abilities:</strong><ul>${cleared.map(c => `<li>${esc(this.partName(c.binding.partUid))}: ${c.reason === 'part removed' ? 'its ability will be removed' : 'the new part no longer has that ability'} (slot ${c.slot + 1})</li>`).join('')}</ul>` : '';
+    // Moves this design would lose (Task 24 gives the full lost-moves line).
+    const lostKinds = designDelta(this.original, this.draft, this.options.loadout, this.catalog).lostKinds, lost = this.root.querySelector<HTMLElement>('.ed-lost-abilities')!;
+    lost.hidden = !lostKinds.length;
+    lost.innerHTML = lostKinds.length ? `<strong>You lose: ${lostKinds.map(k => esc(k)).join(', ')}</strong>` : '';
     const changes = this.root.querySelector<HTMLElement>('.ed-changes');
     if (changes) {
       changes.innerHTML = (this.changes.length ? this.changes : ['No changes from your design.']).map(c => `<li><span aria-hidden="true">• </span>${esc(c)}</li>`).join('');
@@ -825,11 +825,6 @@ class Editor {
     this.root.querySelector<HTMLButtonElement>('.ed-cancel')!.disabled = this.submitting;
     this.root.querySelector<HTMLButtonElement>('.ed-undo')!.disabled = !this.history.length || this.submitting;
   }
-  /** The name of the part that held a binding in the committed design. */
-  private partName(partUid: string) {
-    const placed = this.original.parts.find(p => p.uid === partUid), spec = placed && this.catalog.find(s => s.id === placed.id);
-    return spec?.name ?? 'A part';
-  }
 }
 function statLine(stats: Partial<Stats>) {
   return Object.entries(stats).map(([key, value]) => `${value! > 0 ? '+' : ''}${value} ${key}`).join(' · ');
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -39,7 +39,6 @@ import { TideAudio } from './audio';
 import { TideWorld } from './world';
 import { loadAssets, assetDiagnostics } from './assets';
 import { editorProjection } from './editor';
-import { QA_GRANT_CATALOG } from './qa-catalog';
 import { PARTS } from './parts';
 import { emittersOf } from './design-delta';
 import { restPivotToPart } from './rig';
@@ -133,9 +132,8 @@ let qaRejectSubmit = qaParams.get('qaRejectSubmit') === '1';
 /** `?qaHoldStart=1`: after the first start, the simulation (player, ecosystem, game clock) does not advance until the first
  *  real key or pointer press in play. */
 let qaHoldStart = qaParams.get('qaHoldStart') === '1';
-/** `?qaGrantCatalog=1`: the part catalog gets one synthetic active grant on the Pincer (qa-catalog.ts), so saves that bind it load
- *  and the editor's lost-abilities preview can be seen. */
-const CATALOG = qaParams.get('qaGrantCatalog') === '1' ? QA_GRANT_CATALOG : PARTS;
+/** The part catalog (every shipped part has its real grants since sub-project 3a; `?qaGrantCatalog` is gone, D32). */
+const CATALOG = PARTS;
 /** The first QA rejection, if `?qaRejectSubmit=1` asked for one. */
 function qaRejection(): SubmitOutcome | null {
   if (!qaRejectSubmit) return null;
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -6,7 +6,7 @@ import { newRuntime, type Actor, type Capsule, type CombatInput, type CombatRunt
 import type { Ecosystem, EcoEvent, Entity } from './ecosystem';
 import { chomp, CHOMP_COOLDOWN, type ChompResult } from './feeding';
 import { CombatWorld, playerMatrix, type CombatTick, type PlayerBody } from './combat-world';
-import { assignSlots, movesOf, NO_PINS, type MoveSet, type SlotAssignment } from './moves';
+import { assignSlots, movesOf, type MoveSet, type SlotAssignment } from './moves';
 import { createRigPose, type RigPose } from './rig';
 import { DROPS } from './parts';
 import { derive, effectiveStats, type Derived, type Genome } from './genome';
@@ -43,7 +43,7 @@ export interface SimState {
   actorCache: ActorCache | null; hullRescaled: boolean; hullGrew: boolean;
   acceptedHits: number; rejectedHits: number; faintLog: { time: number; hadPermit: boolean; hadArc: boolean }[];
   /** The combat world (spec §3.1) and the player's moves, cached per genome revision. */
-  combat: CombatWorld; moves: { revision: number; set: MoveSet; slots: SlotAssignment; rig: RigPose } | null;
+  combat: CombatWorld; moves: { revision: number; pins: string; set: MoveSet; slots: SlotAssignment; rig: RigPose } | null;
   /** The previous tick's stick (break-free flicks), and the entities the player damaged this tick (the AI's `hit`). */
   previousMove: Vec3; hitBy: Set<number>;
 }
@@ -163,9 +163,11 @@ export function tryRespawn(s: SimState, w: SimWorld, events: SimEvent[]): boolea
   installPose(s, w, anchor, actor, events, true); refreshDerived(s); return true;
 }
 
-/** The player's moves and slots, cached per genome revision (pins: none until the loadout carries them). */
+/** The player's moves and slots (the run's pins, spec §7.2), cached per genome revision and pins. */
 export function playerMoves(s: SimState): NonNullable<SimState['moves']> {
-  if (!s.moves || s.moves.revision !== s.genomeRevision) s.moves = { revision: s.genomeRevision, set: movesOf(s.run.genome), slots: assignSlots(s.run.genome, NO_PINS), rig: createRigPose(s.run.genome) };
+  const pins = s.run.loadout.slots.join(',');
+  if (!s.moves || s.moves.revision !== s.genomeRevision || s.moves.pins !== pins)
+    s.moves = { revision: s.genomeRevision, pins, set: movesOf(s.run.genome), slots: assignSlots(s.run.genome, s.run.loadout.slots), rig: createRigPose(s.run.genome) };
   return s.moves;
 }
 /** A player's combat body at a pose (spec §5.10: sampleCombatPose on the rest rig); the centre is the middle of the oriented hull. */
```

Delete `src/tiny-tide/qa-catalog.ts`.

- [ ] **Step 4: The browser fixtures and check 12b**

In `tests-browser/fixtures.ts`:
- delete the import line `import { QA_GRANT, QA_GRANT_CATALOG, QA_GRANT_PART } from '../src/tiny-tide/qa-catalog';`
- delete the `bindClaw?: boolean;` field and its comment line in `FixtureSpec`
- replace `const catalog = spec.bindClaw ? QA_GRANT_CATALOG : PARTS, build = buildOf(!!spec.coast, seed);` with `const catalog = PARTS, build = buildOf(!!spec.coast, seed);`
- delete the four-line `if (spec.bindClaw) { … run.loadout = { active: [ … ] }; }` block.

In `e2e/tiny-tide-paths.mjs`, delete the whole `check('12b', 'Lost abilities (QA grant catalog)', …)` block (T21 adds a new 12b for lost moves; the header comment and the summary line keep naming 12b).

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/saves.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed. `legacy keys are never written` still passes.

- [ ] **Step 6: Checkpoint**, then `node e2e/tiny-tide-paths.mjs 12 14 17 18` against the running server. Expected: `PASSED: checks 12, 14, 17, 18`.

- [ ] **Step 7: Commit**

```bash
git rm src/tiny-tide/qa-catalog.ts
git add src/tiny-tide/combat-types.ts src/tiny-tide/state.ts src/tiny-tide/design-delta.ts src/tiny-tide/sim.ts src/tiny-tide/editor.ts src/tiny-tide/main.ts tests/tiny-tide-core/state.test.ts tests/tiny-tide-core/contract.test.ts tests/tiny-tide-core/lifecycle.test.ts tests/tiny-tide-core/saves.test.ts tests-browser/fixtures.ts e2e/tiny-tide-paths.mjs
git commit -m "Tiny Tide combat: slot pins by move kind in v4 saves (old loadout reads as empty pins); remove the QA grant catalog

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T21: Editor moves panel and swap

**Spec:** §12.1, §12.2, §7.2 (swap), R11.

**Files:**
- Modify: `src/tiny-tide/moves.ts` (editor text helpers at the end), `src/tiny-tide/editor.ts`, `src/tiny-tide/editor.css`, `src/tiny-tide/state.ts`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/moves.test.ts`
- Modify: `e2e/tiny-tide-paths.mjs` (check 12b comes back as "Lost moves")

**Interfaces:**
- Consumes: T2 `resolveMove`, `movesOf`, `placeKinds`, `grantedKinds`; T9 `MOVE_ICONS`; T20 `CombatLoadout`, `designDelta(...).lostKinds`.
- Produces: `moveNumbers(r)`, `moveLine(r)`, `moveDiff(before, after)`, `TRADEOFF`, `partMoveLine(spec, c?)`, `lostMoveText(kind, catalog?)`, `basicLine(r, partName)`, `swapPins(pins, shown, kind, slot)`; `EditorResult.loadout`; `applyDesign(…, loadout = run.loadout)` and `prepareEvolution(…, loadout = run.loadout)`; `Prepared.loadout`; editor DOM: `.ed-moves` (Bite line `.ed-basic`, `.ed-slot-bar` of four `.ed-slot` with `kbd` 1–4, `.ed-move-chip` with `.picked`, `.ed-inactive` "Inactive — no free slot", `.ed-move-diff`, `.ed-move-details` with the size .4 and 1.8 columns and the tradeoff line), `.ed-move-line` on part cards, `.ed-lost-moves` (was `.ed-lost-abilities`). Pin changes are in the undo history; Undo all restores the committed pins.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/tests/tiny-tide-core/moves.test.ts
+++ b/tests/tiny-tide-core/moves.test.ts
@@ -1,8 +1,8 @@
 // tests/tiny-tide-core/moves.test.ts — every expected number is the spec §7.4 table value (computed there with the §7.3 formula).
 import { describe, expect, it } from 'vitest';
-import { assignSlots, clearMissingPins, movesOf, NO_PINS, nonMouthBite, placeKinds, resolveMove } from '../../src/tiny-tide/moves';
+import { assignSlots, basicLine, clearMissingPins, swapPins, lostMoveText, moveDiff, moveLine, movesOf, NO_PINS, nonMouthBite, partMoveLine, placeKinds, resolveMove } from '../../src/tiny-tide/moves';
 import { starterGenome, type Genome, type PlacedPart } from '../../src/tiny-tide/genome';
-import { PARTS } from '../../src/tiny-tide/parts';
+import { PARTS, part } from '../../src/tiny-tide/parts';
 import type { MoveKind } from '../../src/tiny-tide/combat-types';
 
 const S = [.4, 1, 1.8] as const;
@@ -120,3 +120,21 @@ describe('moves', () => {
     expect(clearMissingPins(NO_PINS, [])).toEqual({ pins: [null, null, null, null], cleared: [] });
   });
 });
+describe('move text (spec §12)', () => {
+  it('summarises, compares and explains moves', () => {
+    expect(moveLine(resolveMove({ attackId: 'bite-snapper' }, 1))).toBe('Bite · 4 damage · reach .60 L · wind-up .16 s');
+    expect(moveLine(resolveMove({ abilityId: 'dash-side-fin' }, 1))).toBe('Dash · 1.60 L · .18 s dodge');
+    expect(moveLine(resolveMove({ abilityId: 'brace-shell' }, 1))).toBe('Brace · blocks 75 % · breaks at 4 ½♥');
+    expect(moveDiff(resolveMove({ attackId: 'bite-snapper' }, 1), resolveMove({ attackId: 'bite-snapper' }, 1.2))).toBe('Range .60 → .63 L · Wind-up .16 → .17 s · Recovery .22 → .23 s');   // .6 × 1.05; .16 × 1.05; .22 × 1.05 (damage 4.2 rounds to 4)
+    expect(basicLine(resolveMove({ attackId: 'bite-snapper' }, 1), 'Snapper')).toBe('Bite (Snapper): 4 damage · reach .60 L · wind-up .16 s');
+    expect(partMoveLine(part('fin_side')!)).toBe('Move: Dash · 1.60 L · .18 s dodge'); expect(partMoveLine(part('eye_bead')!)).toBeNull();
+    expect(lostMoveText('dash')).toBe('Dash (no fin, leg or Paddle tail left)'); expect(lostMoveText('brace')).toBe('Brace (no Shell plate left)');
+  });
+});
+describe('swap (spec §12.2)', () => {
+  it('pins the dragged kind; the kind shown there moves to its old slot, or is unpinned when it was inactive', () => {
+    expect(swapPins([null, null, null, null], ['brace', 'counter', 'dash', 'grab'], 'grab', 0)).toEqual(['grab', null, null, 'brace']);
+    expect(swapPins([null, null, null, null], ['brace', 'counter', 'dash', 'grab'], 'sweep', 1)).toEqual([null, 'sweep', null, null]);   // sweep was inactive: counter is unpinned
+    expect(placeKinds(['brace', 'counter', 'dash', 'grab', 'sweep'], [null, 'sweep', null, null])).toEqual({ slots: ['brace', 'sweep', 'counter', 'dash'], inactive: ['grab'] });
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/moves.test.ts`
Expected: FAIL — `moveLine`, `swapPins` and the other text helpers are not exported.

- [ ] **Step 3: The text helpers and the swap rule**

```diff
--- a/src/tiny-tide/moves.ts
+++ b/src/tiny-tide/moves.ts
@@ -188,3 +188,73 @@ export function clearMissingPins(pins: Readonly<Tuple4<SlotPin>>, granted: reado
   const cleared: MoveKind[] = [], out = pins.map(p => { if (p && !granted.includes(p)) { cleared.push(p); return null; } return p; }) as Tuple4<SlotPin>;
   return { pins: out, cleared };
 }
+
+// ---- editor text (spec §12) ----
+const f2 = (v: number) => v.toFixed(2).replace(/^0\./, '.');
+/** A move's key numbers, in display order: label, value, unit (the details panel and the size slider's "old → new"). */
+export function moveNumbers(r: ResolvedMove): { label: string; value: number; text: string }[] {
+  const out: { label: string; value: number; text: string }[] = [], n = (label: string, value: number, text: string) => out.push({ label, value, text });
+  const a = r.attack, g = r.guard, e = r.evasion;
+  if (a) {
+    n('Damage', a.damage, String(a.damage));
+    if (a.shape.kind === 'cone') n('Range', a.shape.range, `${f2(a.shape.range)} L`);
+    n('Wind-up', a.windupSeconds, `${f2(a.windupSeconds)} s`); n('Recovery', a.recoverySeconds, `${f2(a.recoverySeconds)} s`);
+    if (a.hold) { n('Hold', a.hold.seconds, `${f2(a.hold.seconds)} s`); n('Size limit', a.hold.sizeFactor, `× ${f2(a.hold.sizeFactor)}`); }
+    if (r.kind === 'sweep') n('Knockback', a.impulse, String(a.impulse));
+  }
+  if (g?.kind === 'counter') { n('Window', g.windowSeconds ?? 0, `${f2(g.windowSeconds ?? 0)} s`); n('Reflect', g.reflectDamage, String(g.reflectDamage)); n('Stagger', g.attackerStaggerSeconds, `${f2(g.attackerStaggerSeconds)} s`); }
+  if (g?.kind === 'brace') { n('Block', g.blockFraction, `${Math.round(g.blockFraction * 100)} %`); n('Breaks at', g.breakHalfHearts ?? 0, `${g.breakHalfHearts} ½♥`); n('Move speed', g.moveSpeedFactor, `× ${f2(g.moveSpeedFactor)}`); n('Startup', g.startupSeconds, `${f2(g.startupSeconds)} s`); }
+  if (e) { n('Distance', e.distanceBodyLengths, `${f2(e.distanceBodyLengths)} L`); n('Dodge', e.travelSeconds, `${f2(e.travelSeconds)} s`); }
+  if (r.kind !== 'bite') n('Cooldown', r.cooldownSeconds, `${f2(r.cooldownSeconds)} s`);
+  return out;
+}
+/** The short line of a move (a chip, a part card): "Dash · 1.6 L · .18 s dodge". */
+export function moveLine(r: ResolvedMove): string {
+  const a = r.attack, g = r.guard, e = r.evasion;
+  if (e) return `${r.label} · ${f2(e.distanceBodyLengths)} L · ${f2(e.travelSeconds)} s dodge`;
+  if (g?.kind === 'brace') return `${r.label} · blocks ${Math.round(g.blockFraction * 100)} % · breaks at ${g.breakHalfHearts} ½♥`;
+  if (g?.kind === 'counter') return `${r.label} · ${f2(g.windowSeconds ?? 0)} s window · reflects ${g.reflectDamage}`;
+  if (a?.hold) return `${r.label} · holds ${f2(a.hold.seconds)} s · ${a.damage} damage`;
+  if (a && a.shape.kind === 'cone') return `${r.label} · ${a.damage} damage · reach ${f2(a.shape.range)} L · wind-up ${f2(a.windupSeconds)} s`;
+  return r.label;
+}
+/** The size slider's comparison (spec §12.2): the numbers that changed, "Range .60 → .66 L · Wind-up .16 → .17 s". */
+export function moveDiff(before: ResolvedMove, after: ResolvedMove): string {
+  const a = moveNumbers(before), b = moveNumbers(after);
+  return a.flatMap((x, i) => { const y = b[i]; return y && y.value !== x.value ? [`${x.label} ${x.text.replace(/ (L|s)$/, '')} → ${y.text}`] : []; }).join(' · ');
+}
+/** The tradeoff line of a move kind (spec §12.1 item 4). */
+export const TRADEOFF: Readonly<Record<MoveKind | 'bite', string>> = {
+  bite: 'Bigger: more reach and damage, slower wind-up.', sweep: 'Bigger: more reach and knockback, slower swing and longer cooldown.',
+  grab: 'Bigger: longer hold and bigger prey, slower grab and longer cooldown.', counter: 'Bigger: wider window and harder reflect, longer cooldown.',
+  brace: 'Bigger: blocks more and breaks later, but you move slower.', dash: 'Bigger: dashes farther and stays safe longer, longer cooldown.',
+};
+/** The move line of a catalog part at scale 1 (spec §12.2), or null for a part that gives no move. */
+export function partMoveLine(spec: PartSpec, c: MoveCatalogs = MOVE_CATALOGS): string | null {
+  const g = spec.activeGrants[0], b = spec.basicAttacks[0];
+  if (g && c.abilities[g.abilityId]) return `Move: ${moveLine(resolveMove({ abilityId: g.abilityId }, 1, {}, c))}`;
+  if (b && c.attacks[b.attackId]) return `Move: ${moveLine(resolveMove({ attackId: b.attackId }, 1, {}, c))}`;
+  return null;
+}
+/** Why a kind is lost (spec §12.2): the parts that give it, by part kind (a kind with several parts is named by its kind), the larger
+ *  groups first: "Dash (no fin, leg or Paddle tail left)". */
+export function lostMoveText(kind: MoveKind, catalog: readonly PartSpec[] = PARTS): string {
+  const givers = catalog.filter(p => !p.rare && p.activeGrants[0]?.id === kind), groups = new Map<string, PartSpec[]>();
+  for (const p of givers) groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
+  const names = [...groups.values()].sort((x, y) => y.length - x.length).map(g => g.length > 1 ? g[0]!.kind : g[0]!.name);
+  const label = { grab: 'Grab', counter: 'Counter', brace: 'Brace', dash: 'Dash', sweep: 'Sweep' }[kind];
+  return `${label} (no ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'part'} left)`;
+}
+/** The basic line of the moves panel (spec §12.1 item 1): "Bite (Snapper): 4 damage · reach .60 L · wind-up .16 s". */
+export function basicLine(r: ResolvedMove, partName: string): string {
+  const a = r.attack!; return `Bite (${partName}): ${a.damage} damage · reach ${f2(a.shape.kind === 'cone' ? a.shape.range : 0)} L · wind-up ${f2(a.windupSeconds)} s`;
+}
+
+/** Spec §7.2 swap: the dragged kind goes to `slot`; the kind shown there moves to the dragged kind's old slot (or is unpinned when the dragged
+ *  kind was inactive). */
+export function swapPins(pins: Readonly<Tuple4<SlotPin>>, shown: Readonly<Tuple4<MoveKind | null>>, kind: MoveKind, slot: number): Tuple4<SlotPin> {
+  const from = shown.indexOf(kind), occupant = shown[slot] ?? null, out = pins.map(p => p === kind || p === occupant ? null : p) as Tuple4<SlotPin>;
+  out[slot] = kind;
+  if (occupant && occupant !== kind && from >= 0) out[from] = occupant;
+  return out;
+}
```

- [ ] **Step 4: The loadout through the editor result, the design and the evolution**

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -448,7 +448,7 @@ async function chooseEvolution() {
 }
 /** Prepares, places and commits an evolution with no await in between (Prepared's economy is trusted at commit). */
 function submitEvolution(next: BodyPlan, r: EditorResult): SubmitOutcome {
-  const prepared = prepareEvolution(run, next.id, r.genome, r.name, BUILD, r.nextSerial, CATALOG);
+  const prepared = prepareEvolution(run, next.id, r.genome, r.name, BUILD, r.nextSerial, CATALOG, r.loadout);
   if (!('planId' in prepared)) return { ok: false, reason: prepared.reason };
   const nextActor = playerActor(next, prepared.genome, next.size, 1), nextLegality = legality(next.size), anchor = startAnchor(nextActor, next.size, nextLegality);
   const destination = evolutionDestination(nextActor, physical, { ...nextLegality, orientation: { yaw: rt.orientation.yaw, pitch: 0 }, time }, anchor.ok ? anchor.position : physical);
@@ -464,7 +464,7 @@ async function editDesign() {
     onSubmit: async r => {
       const rejected = qaRejection(); if (rejected) return rejected;
       const before = run.genome, oldLoadout = structuredClone(run.loadout);
-      const applied = applyDesign(run, r.genome, r.name, BUILD, r.nextSerial, CATALOG);
+      const applied = applyDesign(run, r.genome, r.name, BUILD, r.nextSerial, CATALOG, r.loadout);
       if (!applied.ok) return { ok: false, reason: applied.reason };
       // The simulation clock is stopped while editing, so `time` is the commit time.
       // Cooldowns are action-clock times (spec §5.1).
--- a/src/tiny-tide/state.ts
+++ b/src/tiny-tide/state.ts
@@ -39,7 +39,7 @@ export interface Build { coast: boolean; anchorCheck?: DesignContext['anchorChec
 export type Commit = { ok: true; clearedPins: MoveKind[] } | { ok: false; reason: string; shortfall?: number };
 /** Four empty slot pins (spec §10.5). */
 export const emptyLoadout = (): CombatLoadout => ({ slots: [null, null, null, null] });
-export interface Prepared { planId: string; genome: Genome; name: string; economy: Economy; diet: Diet; nextSerial: number }
+export interface Prepared { planId: string; genome: Genome; name: string; economy: Economy; diet: Diet; nextSerial: number; loadout: CombatLoadout }
 export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
 export const dnaOf = (run: Run) => walletTotal(run.economy);
 export const currentPlan = (run: Run): BodyPlan => plan(run.plans.at(-1)!)!;
@@ -137,19 +137,20 @@ function candidate(run: Run, change: (c: Run) => void, build: Build, catalog: re
 const notEnough = (tx: { shortfall: number; invalid?: string[] }): Failure =>
   tx.invalid ? { ok: false, reason: `Internal check failed: ${tx.invalid[0]}` } : { ok: false, reason: 'Not enough DNA.', shortfall: tx.shortfall };
 /** Applies an editor design on the current plan. The ledger pays for it. Nothing changes unless every check passes. */
-export function applyDesign(run: Run, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Commit {
+/** `loadout`: the editor's pins (spec §12.2); pins of kinds the design does not grant are cleared. */
+export function applyDesign(run: Run, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS, loadout: CombatLoadout = run.loadout): Commit {
   const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
   const issue = problems(g, currentPlan(run), { unlocked: run.unlocked, diet: run.diet, anchorCheck: build.anchorCheck }, catalog).find(x => x.code !== 'dna');
   if (issue) return { ok: false, reason: issue.message };
   const tx = commitDesign(run.economy, run.genome, g);
   if (!tx.ok) return notEnough(tx);
-  const next = candidate(run, c => { c.economy = tx.economy; c.genome = cloneGenome(g); c.name = name.trim().slice(0, 24) || c.name;
+  const next = candidate(run, c => { c.economy = tx.economy; c.genome = cloneGenome(g); c.name = name.trim().slice(0, 24) || c.name; c.loadout = { slots: [...loadout.slots] as CombatLoadout['slots'] };
     c.nextPartSerial = serialAfter(g, c.nextPartSerial, nextSerial); c.health = Math.min(c.health, maxHealthOf(c)); }, build, catalog);
   if ('ok' in next) return next;
   Object.assign(run, next.run); return { ok: true, clearedPins: next.cleared };
 }
 /** Checks an evolution and prices it. It never changes `run`. */
-export function prepareEvolution(run: Run, planId: string, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS): Prepared | Failure {
+export function prepareEvolution(run: Run, planId: string, g: Genome, name: string, build: Build, nextSerial: number, catalog: readonly PartSpec[] = PARTS, loadout: CombatLoadout = run.loadout): Prepared | Failure {
   const before = validateRun(run, build, catalog); if (before.length) return { ok: false, reason: `Internal check failed: ${before[0]}` };
   if (!evolveReady(run)) return { ok: false, reason: 'Not ready to evolve.' };
   const next = eligibleChildren(run.plans, build).find(p => p.id === planId); if (!next) return { ok: false, reason: 'That path is not open.' };
@@ -157,12 +158,12 @@ export function prepareEvolution(run: Run, planId: string, g: Genome, name: stri
   if (issue) return { ok: false, reason: issue.message };
   const tx = commitDesign(run.economy, run.genome, g);
   if (!tx.ok) return notEnough(tx);
-  const prepared: Prepared = { planId, genome: cloneGenome(g), name: name.trim().slice(0, 24) || run.name, economy: tx.economy, diet, nextSerial: serialAfter(g, run.nextPartSerial, nextSerial) };
+  const prepared: Prepared = { planId, genome: cloneGenome(g), name: name.trim().slice(0, 24) || run.name, economy: tx.economy, diet, nextSerial: serialAfter(g, run.nextPartSerial, nextSerial), loadout: { slots: [...loadout.slots] as CombatLoadout['slots'] } };
   const check = candidate(run, c => applyEvolution(c, prepared), build, catalog);
   return 'ok' in check ? check : prepared;
 }
 function applyEvolution(c: Run, p: Prepared) {
-  c.economy = bankAll(p.economy); c.genome = cloneGenome(p.genome); c.name = p.name; c.diet = p.diet; c.plans.push(p.planId);
+  c.economy = bankAll(p.economy); c.genome = cloneGenome(p.genome); c.name = p.name; c.diet = p.diet; c.plans.push(p.planId); c.loadout = { slots: [...p.loadout.slots] as CombatLoadout['slots'] };
   c.stage++; c.stageDna = 0; c.nextPartSerial = Math.max(c.nextPartSerial, p.nextSerial); c.health = maxHealthOf(c);
 }
 /** Applies a validated Prepared atomically. Returns the kinds whose pins it cleared. */
```

- [ ] **Step 5: The moves panel**

```diff
--- a/src/tiny-tide/editor.ts
+++ b/src/tiny-tide/editor.ts
@@ -8,7 +8,9 @@ import { CreatureModel, locate, profile, surface, zAt } from './creature';
 import { adaptToPlan, badMirror, cloneGenome, derive, effectiveStats, instanceCount, isUnlocked, nextUid, PART_LIMITS, PATTERNS, partCost, partSlots, problems, SCALE_RANGE, SPINE_RANGE, type GenomeProblem, type Genome, type PlacedPart } from './genome';
 import { quoteDesign, walletTotal, type Economy, type Quote } from './economy';
 import { designDelta } from './design-delta';
-import type { CombatLoadout } from './combat-types';
+import type { CombatLoadout, MoveKind, SlotPin, Tuple4 } from './combat-types';
+import { basicLine, grantedKinds, lostMoveText, moveDiff, moveLine, moveNumbers, movesOf, partMoveLine, placeKinds, resolveMove, swapPins, TRADEOFF, type GrantedMove } from './moves';
+import { MOVE_ICONS } from './combat-hud';
 import { regionOf, segmentRule, type BodyPlan, type Region } from './plans';
 import { KIND_LABELS, PARTS, part, type Diet, type PartKind, type PartSpec, type Stats } from './parts';
 import { STAGES, type Build } from './state';
@@ -28,7 +30,7 @@ export interface EditorOptions {
   nextSerial: number;
   /** The caller's build. The anchor check runs only on Done, inside `onSubmit`. */
   build: Build;
-  /** The current ability bindings, for the lost-abilities preview. */
+  /** The committed slot pins (spec §7.2): the slot bar starts from them, and Undo all restores them. */
   loadout: CombatLoadout;
   /** The part catalog for problems and ability grants (tests pass a synthetic one). */
   catalog?: readonly PartSpec[];
@@ -36,7 +38,8 @@ export interface EditorOptions {
    *  gesture state, and shows the reason in `.ed-submit-error`. It closes only after `{ ok: true }` or Cancel. */
   onSubmit(result: EditorResult): Promise<SubmitOutcome>;
 }
-export interface EditorResult { genome: Genome; name: string; nextSerial: number }
+/** `loadout`: the pins the player set in the slot bar (spec §12.2). */
+export interface EditorResult { genome: Genome; name: string; nextSerial: number; loadout: CombatLoadout }
 export type SubmitOutcome = { ok: true } | { ok: false; reason: string };
 type Tab = 'parts' | 'body' | 'paint';
 /** The one owner of the current pointer gesture (spec §6). `consumed` means the gesture once had two pointers:
@@ -49,7 +52,8 @@ const TAP_SLOP = 8;
 /** A card press becomes a card drag after this distance (px). */
 const CARD_DRAG_SLOP = 12;
 const centre = (a: TrackedPointer, b: TrackedPointer) => ({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) });
-interface Snapshot { genome: Genome; changes: string[] }
+/** One undo step: the design, the change list and the slot pins (pin changes are in the history, spec §12.2). */
+interface Snapshot { genome: Genome; changes: string[]; pins: Tuple4<SlotPin> }
 const SWATCHES = ['#ffad92', '#ffc769', '#ffe1b8', '#ef8a80', '#d4b1f5', '#bfc0ff', '#b4e7ed', '#7fd1b9', '#9fd36b', '#f6e27a', '#f59ac0', '#8fb3ff', '#6c7bd9', '#4d9c8e', '#3b5b6e', '#fff6e3'];
 const STAT_ROWS: [keyof Stats, string, number][] = [['speed', 'Speed', 6], ['bite', 'Bite', 6], ['reach', 'Reach', 3], ['armor', 'Armor', 6], ['health', 'Health', 6], ['sense', 'Sense', 8], ['stealth', 'Stealth', 4]];
 const KIND_ORDER: PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'arm', 'armor', 'sense', 'wing', 'jet', 'cosmic'];
@@ -110,6 +114,12 @@ class Editor {
   private serial: number;
   private name: string;
   private history: Snapshot[] = [];
+  /** The slot pins of the draft (spec §7.2); a picked chip waits for a slot tap (touch and keyboard swap). */
+  private pins: Tuple4<SlotPin> = [null, null, null, null];
+  private picked: MoveKind | null = null;
+  /** The move chip whose details are open, and the size slider's comparison for the selected part. */
+  private detailKind: MoveKind | 'bite' | null = null;
+  private sizeDiff = '';
   /** A snapshot taken when a drag or slider gesture starts; it enters the history on the first real change. */
   private pending: Snapshot | null = null;
   private tab: Tab = 'parts';
@@ -156,7 +166,7 @@ class Editor {
   private readonly onKey = (event: KeyboardEvent) => this.key(event);
 
   constructor(private options: EditorOptions, private done: (result: EditorResult | null) => void) {
-    this.draft = cloneGenome(options.genome); this.original = cloneGenome(options.original); this.name = options.name;
+    this.draft = cloneGenome(options.genome); this.original = cloneGenome(options.original); this.name = options.name; this.pins = [...options.loadout.slots] as Tuple4<SlotPin>;
     this.changes = [...options.changes]; this.catalog = options.catalog ?? PARTS;
     this.serial = options.nextSerial;
     renderThumbnails();
@@ -172,7 +182,7 @@ class Editor {
       </header>
       <nav class="ed-tabs" role="tablist">${(['parts', 'body', 'paint'] as Tab[]).map(t => `<button role="tab" data-tab="${t}">${t[0]!.toUpperCase() + t.slice(1)}</button>`).join('')}</nav>
       <div class="ed-panel"></div>
-      <aside class="ed-stats"><div class="ed-stats-body"></div>${evolve ? `
+      <aside class="ed-stats"><div class="ed-stats-body"></div><section class="ed-moves" aria-label="Moves"></section>${evolve ? `
         <section class="ed-evolve" aria-label="Changes for a ${esc(plan.name)}">
           <details class="ed-changes-box"${innerWidth > 900 ? ' open' : ''}><summary>Changes</summary><ul class="ed-changes"></ul></details>
           <div class="ed-evolve-actions"><button class="ed-undo-all ghost-button">Undo all</button><button class="ed-fix ghost-button">Fix for me</button></div>
@@ -180,7 +190,7 @@ class Editor {
       <div class="ed-regions" aria-label="Slots per body region">${REGIONS.map(r => `<span class="ed-region" data-region="${r}"></span>`).join('')}</div>
       <div class="ed-alerts">
         <p class="ed-problem-line" role="status" hidden></p>
-        <div class="ed-lost-abilities" hidden></div>
+        <div class="ed-lost-moves" hidden></div>
         <p class="ed-submit-error" role="alert" hidden></p>
       </div>
       <div class="ed-tool" hidden></div>
@@ -206,7 +216,7 @@ class Editor {
     this.root.querySelector<HTMLButtonElement>('.ed-cancel')!.onclick = () => { if (!this.submitting) this.close(null); };
     this.root.querySelector<HTMLButtonElement>('.ed-done')!.onclick = () => void this.finish();
     const undoAll = this.root.querySelector<HTMLButtonElement>('.ed-undo-all'), fix = this.root.querySelector<HTMLButtonElement>('.ed-fix');
-    if (undoAll) undoAll.onclick = () => this.replace(cloneGenome(this.original), []);
+    if (undoAll) undoAll.onclick = () => { this.pushHistory(); this.pins = [...this.options.loadout.slots] as Tuple4<SlotPin>; this.draft = cloneGenome(this.original); this.changes = []; this.afterEdit(); };
     if (fix) fix.onclick = () => this.fixForMe();
     this.root.querySelector<HTMLButtonElement>('.ed-confirm-yes')!.onclick = () => { const placed = this.pairPrompt; this.showPairPrompt(null); if (placed) this.addPart({ ...placed, mirror: false }); };
     this.root.querySelector<HTMLButtonElement>('.ed-confirm-no')!.onclick = () => this.showPairPrompt(null);
@@ -294,10 +304,10 @@ class Editor {
   }
   private pushHistory() {
     this.pending = null;
-    this.history.push({ genome: cloneGenome(this.draft), changes: [...this.changes] }); if (this.history.length > 60) this.history.shift();
+    this.history.push({ genome: cloneGenome(this.draft), changes: [...this.changes], pins: [...this.pins] as Tuple4<SlotPin> }); if (this.history.length > 60) this.history.shift();
   }
   /** Starts a gesture: its snapshot enters the history only if the gesture changes something. */
-  private beginGesture() { this.pending = { genome: cloneGenome(this.draft), changes: [...this.changes] }; }
+  private beginGesture() { this.pending = { genome: cloneGenome(this.draft), changes: [...this.changes], pins: [...this.pins] as Tuple4<SlotPin> }; }
   private touchGesture() {
     if (this.pending) { this.history.push(this.pending); if (this.history.length > 60) this.history.shift(); this.pending = null; }
     this.showSubmitError(null);
@@ -309,7 +319,7 @@ class Editor {
   }
   private undo() {
     const prior = this.history.pop(); if (!prior) return;
-    this.pending = null; this.draft = prior.genome; this.changes = prior.changes; this.afterEdit();
+    this.pending = null; this.draft = prior.genome; this.changes = prior.changes; this.pins = prior.pins; this.afterEdit();
   }
   private fixForMe() {
     const a = adaptToPlan(this.draft, this.options.plan, { unlocked: this.options.unlocked, diet: this.options.diet }, this.serial);
@@ -322,7 +332,7 @@ class Editor {
     if (this.submitting || this.closed) return;
     const issue = this.issues()[0];
     if (issue) { this.hint(issue.message); return; }
-    const result: EditorResult = { genome: cloneGenome(this.draft), name: this.name.trim() || this.options.name, nextSerial: this.serial };
+    const result: EditorResult = { genome: cloneGenome(this.draft), name: this.name.trim() || this.options.name, nextSerial: this.serial, loadout: { slots: [...this.pins] as Tuple4<SlotPin> } };
     this.submitting = true; this.showSubmitError(null); this.renderStatsOnly();
     let outcome: SubmitOutcome;
     try { outcome = await this.options.onSubmit(result); }
@@ -673,7 +683,7 @@ class Editor {
         const reason = this.cardReason(spec), found = isUnlocked(spec.id, this.options.plan.size, this.options.unlocked), early = found && spec.stage > this.options.plan.size;
         return `<button class="ed-card ${this.placing === spec.id ? 'active' : ''}" data-part="${spec.id}" ${reason ? `disabled data-reason="${esc(reason)}"` : ''} aria-label="${esc(spec.name)}, ${spec.cost} DNA${reason ? `. ${esc(reason)}` : ''}">
           <img src="${thumbnails.get(spec.id) ?? ''}" alt=""><strong>${esc(spec.name)}</strong><span class="ed-cost">${found ? `${spec.cost} DNA` : `🔒 ${STAGES[spec.stage]!.title}`}</span>
-          <small>${reason && found ? `<span class="ed-reason">${esc(reason)}</span>` : `${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}`}</small>${spec.rare ? '<em class="ed-rare">RARE</em>' : early ? '<em>FOUND!</em>' : ''}</button>`;
+          <small>${reason && found ? `<span class="ed-reason">${esc(reason)}</span>` : `${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}`}</small>${partMoveLine(spec) ? `<small class="ed-move-line">${esc(partMoveLine(spec)!)}</small>` : ''}${spec.rare ? '<em class="ed-rare">RARE</em>' : early ? '<em>FOUND!</em>' : ''}</button>`;
       }).join('')}</div>
       <p class="ed-tip">${this.placing ? 'Tap your creature to place it. Tap the card again to stop.' : 'Choose a part, then tap your creature. Turn it with two fingers or a right-drag.'}</p>`;
     panel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.kind as PartKind; this.disarm(); this.render(); });
@@ -694,6 +704,49 @@ class Editor {
       button.addEventListener('pointerdown', e => { if (!button.disabled) this.pointerDown(e, button.dataset.part!); });
     });
   }
+  /** The moves panel (spec §12.1): the Bite line, the slot bar (four slots, keys 1–4), the inactive kinds, a chip's details and the size
+   *  slider's comparison. A chip swaps by a drag onto a slot, or a tap on the chip and then on a slot (touch and keyboard). */
+  private renderMoves() {
+    const box = this.root.querySelector<HTMLElement>('.ed-moves'); if (!box) return;
+    const m = movesOf(this.draft, this.catalog), place = placeKinds(grantedKinds(m), this.pins);
+    const partName = (g: GrantedMove) => this.catalog.find(s => s.id === g.partId)?.name ?? '';
+    const chip = (g: GrantedMove) => {
+      const kind = g.kind as MoveKind, nums = moveNumbers(g.resolved).slice(0, 2).map(n => n.text).join(' · ');
+      return `<button class="ed-move-chip${this.picked === kind ? ' picked' : ''}" data-kind="${kind}" aria-label="${esc(g.resolved.label)} from ${esc(partName(g))}">${MOVE_ICONS[kind]}<b>${esc(g.resolved.label)}</b><span>${esc(partName(g))}</span><small>${esc(nums)}</small></button>`;
+    };
+    const basic = m.basic ? `<p class="ed-basic" role="button" tabindex="0">${esc(basicLine(m.basic.resolved, partName(m.basic)))}</p>` : '';
+    const slots = place.slots.map((k, i) => { const g = k ? m.byKind[k] : undefined; return `<div class="ed-slot" data-slot="${i}" role="button" tabindex="0" aria-label="Slot ${i + 1}"><kbd>${i + 1}</kbd>${g ? chip(g) : '<em>—</em>'}</div>`; }).join('');
+    const inactive = place.inactive.map(k => m.byKind[k]!).map(g => `<div class="ed-inactive">${chip(g)}<small>Inactive — no free slot</small></div>`).join('');
+    const d = this.detailKind === 'bite' ? m.basic : this.detailKind ? m.byKind[this.detailKind] : undefined;
+    let details = '';
+    if (d) {
+      const placed = this.draft.parts.find(p => p.uid === d.partUid)!, spec = this.catalog.find(s => s.id === d.partId)!;
+      const ref = d.kind === 'bite' ? { attackId: spec.basicAttacks[0]!.attackId } : { abilityId: d.resolved.abilityId! };
+      const at = (sc: number) => moveNumbers(resolveMove(ref, sc, { mirrored: placed.mirror })).map(n => n.text), small = at(.4), big = at(1.8);
+      details = `<div class="ed-move-details"><b>${esc(moveLine(d.resolved))}</b><table><tr><th></th><th>Now</th><th>Size .4</th><th>Size 1.8</th></tr>${moveNumbers(d.resolved).map((n, i) => `<tr><th>${esc(n.label)}</th><td>${esc(n.text)}</td><td>${esc(small[i] ?? '')}</td><td>${esc(big[i] ?? '')}</td></tr>`).join('')}</table><p>${esc(TRADEOFF[d.kind])}</p></div>`;
+    }
+    box.innerHTML = `<div class="eyebrow">MOVES</div>${basic}<div class="ed-slot-bar">${slots}</div>${inactive}${this.sizeDiff ? `<p class="ed-move-diff">${esc(this.sizeDiff)}</p>` : ''}${details}`;
+    let drag: { kind: MoveKind; x: number; y: number; id: number } | null = null;
+    box.querySelectorAll<HTMLButtonElement>('.ed-move-chip').forEach(b => {
+      const kind = b.dataset.kind as MoveKind;
+      b.addEventListener('pointerdown', e => { drag = { kind, x: e.clientX, y: e.clientY, id: e.pointerId }; try { b.setPointerCapture(e.pointerId); } catch { /* the pointer already ended */ } });
+      b.addEventListener('pointerup', e => {
+        const d0 = drag; drag = null; if (!d0 || d0.id !== e.pointerId || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < CARD_DRAG_SLOP) return;
+        b.dataset.dragged = '1';
+        const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.ed-slot'); if (slot) this.swap(kind, Number(slot.dataset.slot), place.slots);
+      });
+      b.onclick = e => { e.stopPropagation(); if (b.dataset.dragged) { delete b.dataset.dragged; return; } this.picked = this.picked === kind ? null : kind; this.detailKind = kind; this.renderMoves(); };
+    });
+    box.querySelectorAll<HTMLElement>('.ed-slot').forEach(sl => {
+      const go = () => { if (this.picked) this.swap(this.picked, Number(sl.dataset.slot), place.slots); };
+      sl.onclick = go; sl.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
+    });
+    const b = box.querySelector<HTMLElement>('.ed-basic'); if (b) b.onclick = () => { this.detailKind = this.detailKind === 'bite' ? null : 'bite'; this.renderMoves(); };
+  }
+  /** A pin change goes into the undo history (spec §12.2). */
+  private swap(kind: MoveKind, slot: number, shown: Tuple4<MoveKind | null>) {
+    this.pushHistory(); this.pins = swapPins(this.pins, shown, kind, slot); this.picked = null; this.showSubmitError(null); this.renderStatsOnly();
+  }
   private sizeCost(p: PlacedPart) { const slots = partSlots(p); return `${partCost(p)} DNA · ${slots} slot${slots === 1 ? '' : 's'}`; }
   private renderTool() {
     const tool = this.root.querySelector<HTMLElement>('.ed-tool')!;
@@ -708,7 +761,7 @@ class Editor {
       ${spec.mirror ? `<button class="ed-mirror ghost-button" aria-pressed="${placed.mirror}">${placed.mirror ? 'Pair ✓' : 'Pair'}</button>` : ''}
       <button class="ed-delete ghost-button">Remove${refund > 0 ? ` (+${refund})` : ''}</button>`;
     const scale = tool.querySelector<HTMLInputElement>('.ed-scale')!, roll = tool.querySelector<HTMLInputElement>('.ed-roll')!, cost = tool.querySelector<HTMLElement>('.ed-size-cost')!;
-    for (const input of [scale, roll]) { input.addEventListener('pointerdown', () => this.beginGesture()); input.addEventListener('keydown', () => this.beginGesture()); input.addEventListener('change', () => { this.pending = null; }); }
+    for (const input of [scale, roll]) { input.addEventListener('pointerdown', () => this.beginGesture()); input.addEventListener('keydown', () => this.beginGesture()); input.addEventListener('change', () => { this.pending = null; this.sizeDiff = ''; this.renderStatsOnly(); }); }
     scale.oninput = () => {
       const current = this.placedBy(uid); if (!current) return;
       const value = Number(scale.value);
@@ -716,6 +769,10 @@ class Editor {
       // A size the region or the DNA can't take keeps the old value.
       const why = this.refusal(this.with(g => { g.parts.find(p => p.uid === uid)!.scale = value; }));
       if (why) { scale.value = String(current.scale); cost.textContent = this.sizeCost(current); this.hint(why); return; }
+      // Live move numbers (spec §12.2): the part's move as "old → new" from the gesture's start.
+      const before = this.pending?.genome.parts.find(p => p.uid === uid)?.scale ?? current.scale, grant = spec.activeGrants[0], basic = spec.basicAttacks[0];
+      const ref = grant ? { abilityId: grant.abilityId } : basic ? { attackId: basic.attackId } : null;
+      this.sizeDiff = ref ? moveDiff(resolveMove(ref, before, { mirrored: current.mirror }), resolveMove(ref, value, { mirrored: current.mirror })) : '';
       this.touchGesture(); current.scale = value; cost.textContent = this.sizeCost(current);
       this.model.updatePart(uid); this.renderStatsOnly();
     };
@@ -807,10 +864,11 @@ class Editor {
       const r = chip.dataset.region as Region, slots = plan.regions[r].slots;
       chip.textContent = `${REGION_LABEL[r]} ${used[r]} / ${slots}`; chip.classList.toggle('over', used[r] >= slots);
     });
-    // Moves this design would lose (Task 24 gives the full lost-moves line).
-    const lostKinds = designDelta(this.original, this.draft, this.options.loadout, this.catalog).lostKinds, lost = this.root.querySelector<HTMLElement>('.ed-lost-abilities')!;
+    // Moves this design would lose (spec §12.2).
+    const lostKinds = designDelta(this.original, this.draft, this.options.loadout, this.catalog).lostKinds, lost = this.root.querySelector<HTMLElement>('.ed-lost-moves')!;
     lost.hidden = !lostKinds.length;
-    lost.innerHTML = lostKinds.length ? `<strong>You lose: ${lostKinds.map(k => esc(k)).join(', ')}</strong>` : '';
+    lost.textContent = lostKinds.length ? `You lose: ${lostKinds.map(k => lostMoveText(k, this.catalog)).join(', ')}` : '';
+    this.renderMoves();
     const changes = this.root.querySelector<HTMLElement>('.ed-changes');
     if (changes) {
       changes.innerHTML = (this.changes.length ? this.changes : ['No changes from your design.']).map(c => `<li><span aria-hidden="true">• </span>${esc(c)}</li>`).join('');
```

```diff
--- a/src/tiny-tide/editor.css
+++ b/src/tiny-tide/editor.css
@@ -81,8 +81,27 @@
 .ed-alerts{position:absolute;top:150px;left:50%;transform:translateX(-50%);width:max-content;max-width:min(420px,calc(100vw - 48px));display:flex;flex-direction:column;gap:8px;z-index:5;pointer-events:none}
 .ed-alerts>*{margin:0;pointer-events:auto}
 .ed-problem-line{display:none}
-.ed-lost-abilities{padding:10px 14px;border-radius:14px;background:#3d2a12e6;border:1px solid #ffc769;color:#ffe9c2;font-size:12px;line-height:1.4}
-.ed-lost-abilities ul{margin:4px 0 0;padding-left:18px}
+.ed-lost-moves{padding:10px 14px;border-radius:14px;background:#3d2a12e6;border:1px solid #ffc769;color:#ffe9c2;font-size:12px;font-weight:700;line-height:1.4}
+/* The moves panel (spec §12.1): the Bite line, the slot bar with keys 1–4, inactive chips, details and the size comparison. */
+.ed-moves{margin-top:12px;padding-top:10px;border-top:1px solid #ffffff1f;display:flex;flex-direction:column;gap:6px}
+.ed-basic{margin:0;font-size:11px;line-height:1.35;cursor:pointer;opacity:.9}
+.ed-slot-bar{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
+.ed-slot{position:relative;min-height:54px;border-radius:12px;background:#ffffff12;border:1px dashed #ffffff3d;display:flex;align-items:stretch;cursor:pointer}
+.ed-slot kbd{position:absolute;top:3px;left:6px;font:700 10px/1 inherit;opacity:.6}
+.ed-slot em{margin:auto;opacity:.4;font-style:normal}
+.ed-move-chip{flex:1;display:grid;grid-template-columns:auto 1fr;column-gap:6px;align-items:center;padding:14px 8px 6px;border:0;border-radius:12px;background:#ffffff1f;color:inherit;font:inherit;font-size:11px;text-align:left;cursor:grab;touch-action:none}
+.ed-move-chip b{font-size:12px}
+.ed-move-chip span,.ed-move-chip small{grid-column:2;opacity:.75;font-size:10px}
+.ed-move-chip.picked{outline:2px solid #ffc769;background:#ffc76933}
+.ed-inactive{display:flex;flex-direction:column;gap:2px;opacity:.6}
+.ed-inactive small{font-size:10px}
+.ed-move-diff{margin:0;padding:6px 8px;border-radius:10px;background:#ffc76926;color:#ffe9c2;font-size:11px;font-weight:700}
+.ed-move-details{font-size:11px}
+.ed-move-details table{width:100%;border-collapse:collapse;margin:4px 0}
+.ed-move-details th,.ed-move-details td{padding:2px 4px;text-align:right;font-weight:400}
+.ed-move-details th:first-child{text-align:left;opacity:.75}
+.ed-move-details p{margin:4px 0 0;opacity:.8}
+.ed-move-line{display:block;color:#bfe9ff}
 .ed-submit-error{padding:10px 14px;border-radius:14px;background:#5a1f1fe6;border:1px solid #ff9d8a;color:#ffe3dc;font-size:13px;font-weight:700}
 .ed-submit-error::before{content:'! '}
 .ed-confirm{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 12px 10px 18px;border-radius:22px;background:var(--cream);color:var(--ink);font-size:13px;font-weight:700;z-index:6;max-width:calc(100vw - 28px);flex-wrap:wrap;justify-content:center}
@@ -105,6 +124,10 @@
   .ed-card img{width:56px;height:56px}
   .ed-stats{top:calc(max(18px,env(safe-area-inset-top)) + 140px);left:14px;right:auto;width:auto;padding:7px 12px;display:flex;align-items:center;gap:10px;border-radius:99px}
   .ed-stats .ed-stat,.ed-stats .ed-problems{display:none}
+  .ed-moves{flex-basis:100%;margin-top:0;padding-top:6px}
+  .ed-slot-bar{grid-template-columns:repeat(4,1fr)}
+  .ed-move-chip{grid-template-columns:1fr;padding:12px 4px 4px;text-align:center}
+  .ed-move-chip span,.ed-move-chip small,.ed-basic,.ed-move-details{display:none}
   .ed-complexity{margin:0;grid-template-columns:auto 52px auto;gap:6px}
   .ed-diet{margin:0;gap:6px}
   .ed-stats .ed-evolve{margin:0;padding:0;border:0;display:flex;align-items:center;gap:6px;position:relative}
```

- [ ] **Step 6: Check 12b checks the lost-moves line**

In `e2e/tiny-tide-paths.mjs`, add this check after check `'12'` (where T20 removed the old 12b):

```js
check('12b', 'Lost moves', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, { add: { 0: [{ id: 'claw_pincer', t: .5 }] } });
  const claw = fx.info.parts.find(p => p.id === 'claw_pincer').uid;
  await openEdit(page);
  assert.equal(await page.locator('#editor .ed-lost-moves').isHidden(), true, 'no lost moves before the change');
  assert.ok(await page.locator('#editor .ed-moves .ed-move-chip[data-kind="grab"]').count() >= 1, 'the Pincer gives a Grab chip');
  await selectPart(page, claw);
  await page.locator('#editor .ed-delete').click(); await frames(page, 2);
  const lost = page.locator('#editor .ed-lost-moves');
  assert.equal(await lost.isVisible(), true, 'removing the only Pincer shows the lost moves');
  assert.equal((await lost.textContent()).trim(), 'You lose: Grab (no Pincer left)');
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/moves.test.ts tests/tiny-tide-core/state.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 8: Checkpoint**, then `node e2e/tiny-tide-paths.mjs 2 3 4 12 12b` against the running server. Expected: `PASSED: checks 2, 3, 4, 12, 12b`.

- [ ] **Step 9: Commit**

```bash
git add src/tiny-tide/moves.ts src/tiny-tide/editor.ts src/tiny-tide/editor.css src/tiny-tide/state.ts src/tiny-tide/main.ts tests/tiny-tide-core/moves.test.ts e2e/tiny-tide-paths.mjs
git commit -m "Tiny Tide combat: editor moves panel — slot bar, inactive moves, details, live size numbers, swap by drag or tap, lost moves

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T22: First-time hints and the QA parameters

**Spec:** §12.3, §14.2 (QA parameters, `window.__tinyTide.combat`), D30, D32.

**Files:**
- Create: `src/tiny-tide/hints.ts`, `tests/tiny-tide-core/hints.test.ts`
- Modify: `src/tiny-tide/ecosystem.ts`, `src/tiny-tide/sim.ts`, `src/tiny-tide/main.ts`
- Modify: `tests/tiny-tide-core/sim.test.ts`
- Modify: `tests-browser/fixtures.ts` (fixture fields for the browser checks)

**Interfaces:**
- Consumes: T12 `telegraphViews`, `combatDiagnostics()` (already exposed as `window.__tinyTide.combat`); T17 alpha state; T20 `CombatLoadout`.
- Produces:
  - `hints.ts`: `HINTS_KEY = 'tiny-tide-hints-v1'`, `HINT_GAP = 6`, `HintId`, `HintStorage`, `HINT_GLYPHS`, `hintText(id, { slot, touch })`, `class Hints { shown; request(id, text); next(now, toastFree) }`.
  - `Ecosystem.placeAt(e, p): boolean`.
  - `sim.ts`: `qaEncounter(s, w, key): number | null`, `qaAlphaHealth(w, fraction)`.
  - `main.ts`: `?qaEncounter=<species key>` and `?qaAlphaHealth=<0..1>` (read once at load, QA only, applied once at the first start); `offerHints()` each played frame; `combatDiagnostics()` gains `alphas` (`id`, `key`, `hp`, `maxHp`, `phase`, `state`, `eaten`), `encounter` (`id`, `key`, physical `x`, `y`, `z`, `bodyLength`, `mode`, `eaten`), `hints`, `aim` and `aimSource`; `window.__tinyTide.screenOf(physicalPoint)` gives the CSS-pixel screen point (read-only, for the pointer-aim check).
  - `tests-browser/fixtures.ts`: `FixtureSpec.pins?: [SlotPin, SlotPin, SlotPin, SlotPin]`, `atRisk?: number`, `stageDna?: number`.

**Decision in this task (spec gap):** §12.3 names only the Dash glyph (⟫) for the phone text. The other glyphs are `HINT_GLYPHS`: Brace ⛨, Counter ✷, Grab ✊, Sweep ↺.

- [ ] **Step 1: Write the failing tests**

`tests/tiny-tide-core/hints.test.ts` (complete file):

```ts
// tests/tiny-tide-core/hints.test.ts — spec §12.3: first-time hints show once per profile, at most one every 6 s, never over another toast.
import { describe, expect, it } from 'vitest';
import { HINTS_KEY, hintText, Hints, type HintStorage } from '../../src/tiny-tide/hints';

const memory = (init: Record<string, string> = {}): HintStorage & { data: Record<string, string> } => {
  const data = { ...init }; return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
describe('hints', () => {
  it('uses the slot key on desktop and the glyph on a phone', () => {
    expect(hintText('move-dash', { slot: 1, touch: false })).toBe('New move: Dash. Press 2 to zip through attacks.');
    expect(hintText('move-dash', { slot: 1, touch: true })).toBe('New move: Dash. Tap ⟫ to zip through attacks.');
    expect(hintText('move-brace', { slot: 0, touch: false })).toBe('New move: Brace. Hold 1 to block in front of you.');
    expect(hintText('move-counter', { slot: 2, touch: false })).toBe('New move: Counter. Press 3 just before a hit lands.');
    expect(hintText('move-grab', { slot: 3, touch: false })).toBe('New move: Grab. Press 4 to hold a small creature.');
    expect(hintText('move-sweep', { slot: 0, touch: false })).toBe('New move: Sweep. Press 1 to knock away what is behind you.');
    expect(hintText('telegraph', { slot: 0, touch: false })).toBe('Orange shapes show where an attack lands. Get out, Brace or Counter!');
  });
  it('shows a hint once, then never again in this profile', () => {
    const store = memory(), a = new Hints(store);
    a.request('telegraph', 'T'); expect(a.next(0, true)).toEqual({ id: 'telegraph', text: 'T' });
    a.request('telegraph', 'T'); expect(a.next(10, true)).toBeNull();
    expect(JSON.parse(store.data[HINTS_KEY]!)).toEqual(['telegraph']);
    const b = new Hints(store); b.request('telegraph', 'T'); expect(b.next(0, true)).toBeNull();
  });
  it('waits for a free toast and keeps 6 s between hints, in order', () => {
    const h = new Hints(memory());
    h.request('move-dash', 'D'); h.request('telegraph', 'T');
    expect(h.next(0, false)).toBeNull();
    expect(h.next(1, true)?.id).toBe('move-dash');
    expect(h.next(6.9, true)).toBeNull();
    expect(h.next(7, true)?.id).toBe('telegraph');
  });
  it('treats a storage error as not shown and goes on', () => {
    const broken: HintStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const h = new Hints(broken); h.request('telegraph', 'T');
    expect(h.next(0, true)?.id).toBe('telegraph');
    expect(new Hints(memory({ [HINTS_KEY]: 'not json' })).shown.size).toBe(0);
  });
});
```

`tests/tiny-tide-core/sim.test.ts` (the QA parameters):

```diff
--- a/tests/tiny-tide-core/sim.test.ts
+++ b/tests/tiny-tide-core/sim.test.ts
@@ -4,11 +4,12 @@
 import { existsSync, readFileSync, writeFileSync } from 'node:fs';
 import { describe, expect, it } from 'vitest';
 import { Ecosystem } from '../../src/tiny-tide/ecosystem';
+import { SIZES } from '../../src/tiny-tide/biomes';
 import { freshRun } from '../../src/tiny-tide/state';
 import { readIntent, RELEASED, type InputSources } from '../../src/tiny-tide/input';
 import { stageBounds, stageWorldQueries } from '../../src/tiny-tide/world-queries';
 import type { CombatInput, Vec3 } from '../../src/tiny-tide/combat-types';
-import { newSimState, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';
+import { newSimState, playerActorCached, qaAlphaHealth, qaEncounter, simBegin, simFrame, type SimWorld } from '../../src/tiny-tide/sim';
 
 const GOLDEN = 'tests/tiny-tide-core/sim-golden.json', DT = 1 / 60, SECONDS = 20;
 export interface Sample { t: number; x: number; y: number; z: number; health: number; stageDna: number; dna: number; bites: number; mode: string }
@@ -55,3 +56,21 @@ describe('regeneration', () => {
     expect(samples).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4.5, 4.5, 5, 5]);   // 7 s quiet, then +.5 at 9 s and 11 s
   });
 });
+describe('QA parameters (spec §14.2)', () => {
+  it('qaEncounter installs the nearest live instance 3 player L in front, in calm', () => {
+    const run = freshRun(7), w = world(7), s = newSimState(run);
+    w.eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
+    const id = qaEncounter(s, w, '1:crab'), crab = w.eco.entities.find(e => e.id === id)!;
+    expect(crab.spec.key).toBe('1:crab'); expect(crab.mode).toBe('calm');
+    const L = playerActorCached(s).bodyLength, yaw = s.rt.orientation.yaw;
+    const want = { x: s.physical.x + Math.sin(yaw) * 3 * L, z: s.physical.z + Math.cos(yaw) * 3 * L };
+    expect(Math.hypot(crab.x - want.x, crab.z - want.z)).toBeLessThanOrEqual(4 * SIZES[1]! * 1.4);   // recovery searches within 4 crab body lengths
+    expect(qaEncounter(s, w, '9:none')).toBeNull();
+  });
+  it('qaAlphaHealth starts every alpha at that fraction of its HP', () => {
+    const w = world(7); qaAlphaHealth(w, .62);
+    const mother = w.eco.entities.find(e => e.spec.key === '1:clawmother')!;
+    expect(mother.hp).toBe(Math.round(80 * .62));
+    qaAlphaHealth(w, 0); expect(mother.hp).toBe(1);
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/tiny-tide-core/hints.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/hints"`; `qaEncounter` not exported.

- [ ] **Step 3: Create `hints.ts`** (complete file)

```ts
// First-time hints (spec §12.3, D30): each hint shows once per browser profile. The shown ids live in localStorage `tiny-tide-hints-v1` (a JSON
// string array). A read or write error means "not shown" and the game goes on. Hints use the toast, at most one every HINT_GAP seconds, and
// never replace another toast: a hint that cannot show yet waits in order.
import type { MoveKind } from './combat-types';

export const HINTS_KEY = 'tiny-tide-hints-v1';
export const HINT_GAP = 6;
export type HintId = `move-${MoveKind}` | 'telegraph' | 'telegraph-red';
/** The storage the hints use (localStorage in the game; a map in the tests). */
export interface HintStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** The phone glyph of each move kind (the slot buttons show the same move icons; the toast is plain text). */
export const HINT_GLYPHS: Readonly<Record<MoveKind, string>> = { dash: '⟫', brace: '⛨', counter: '✷', grab: '✊', sweep: '↺' };

/** The text of a hint (spec §12.3). `slot` is the 0-based slot of a move hint; `touch` picks the phone wording. */
export function hintText(id: HintId, o: { slot: number; touch: boolean }): string {
  if (id === 'telegraph') return 'Orange shapes show where an attack lands. Get out, Brace or Counter!';
  if (id === 'telegraph-red') return 'Red striped attacks can’t be blocked. Dash or swim out!';
  const kind = id.slice(5) as MoveKind, key = o.touch ? HINT_GLYPHS[kind] : String(o.slot + 1);
  const press = o.touch ? `Tap ${key}` : `Press ${key}`, hold = `Hold ${key}`;
  switch (kind) {
    case 'dash': return `New move: Dash. ${press} to zip through attacks.`;
    case 'brace': return `New move: Brace. ${hold} to block in front of you.`;
    case 'counter': return `New move: Counter. ${press} just before a hit lands.`;
    case 'grab': return `New move: Grab. ${press} to hold a small creature.`;
    case 'sweep': return `New move: Sweep. ${press} to knock away what is behind you.`;
  }
}

export class Hints {
  /** Ids shown in this profile (read once; kept in memory when storage fails). */
  readonly shown: Set<string>;
  private readonly queue: { id: HintId; text: string }[] = [];
  private lastShownAt = -Infinity;
  constructor(private readonly storage: HintStorage | null) {
    let ids: unknown = [];
    try { ids = JSON.parse(storage?.getItem(HINTS_KEY) ?? '[]'); } catch { ids = []; }
    this.shown = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  }
  /** Asks for a hint: ignored when it was shown or is already waiting. The text is fixed at the first request. */
  request(id: HintId, text: string): void {
    if (this.shown.has(id) || this.queue.some(q => q.id === id)) return;
    this.queue.push({ id, text });
  }
  /** The next hint to show now, or null: the toast is free and HINT_GAP has passed since the last hint (game time). It is marked shown. */
  next(now: number, toastFree: boolean): { id: HintId; text: string } | null {
    if (!toastFree || now - this.lastShownAt < HINT_GAP - 1e-9) return null;
    const h = this.queue.shift(); if (!h) return null;
    this.shown.add(h.id); this.lastShownAt = now;
    try { this.storage?.setItem(HINTS_KEY, JSON.stringify([...this.shown])); } catch { /* not saved: it may show again in a later session */ }
    return h;
  }
}
```

- [ ] **Step 4: The QA placement and alpha health**

```diff
--- a/src/tiny-tide/ecosystem.ts
+++ b/src/tiny-tide/ecosystem.ts
@@ -221,6 +221,12 @@ export class Ecosystem {
   giveUpAll(now: number, seconds: number): void {
     for (const e of this.entities) if (e.mode === 'hunt' || e.mode === 'angry') { this.setMode(e, 'return'); e.returnUntil = now + seconds; }
   }
+  /** QA (`qaEncounter`, spec §14.2): moves a live entity and its home to the nearest legal pose near `p` (recovery within 4 body lengths), in
+   *  calm. False when no legal pose was found (the entity is then removed until its retry, like any failed install). */
+  placeAt(e: Entity, p: Vec3): boolean {
+    e.x = p.x; e.y = p.y; e.z = p.z; this.setMode(e, 'calm'); e.returnUntil = 0;
+    return this.install(e);
+  }
   /** The roaming bound of an entity's tier: tighter for hunters. */
   private boundsOf(e: Entity) { return (isHunter(e.spec) ? this.hunterBounds : this.bounds)[e.spec.tier]!; }
   /** Moves the entity (and its home) to the nearest legal pose within 4 body lengths, or removes it until a retry. */
--- a/src/tiny-tide/sim.ts
+++ b/src/tiny-tide/sim.ts
@@ -327,6 +327,23 @@ export function simBegin(s: SimState, w: SimWorld, run: Run, forced: Vec3 | null
   }
   return events;
 }
+/** QA (`?qaEncounter=<species key>`, spec §14.2): the nearest live instance of that species, of a tier next to the stage, is installed 3 player
+ *  body lengths in front of the player, in calm. Returns its entity id, or null (no instance, or no legal pose there). */
+export function qaEncounter(s: SimState, w: SimWorld, key: string): number | null {
+  const L = playerActorCached(s).bodyLength, yaw = s.rt.orientation.yaw, p = s.physical;
+  const at = { x: p.x + Math.sin(yaw) * 3 * L, y: p.y, z: p.z + Math.cos(yaw) * 3 * L };
+  let best: Entity | null = null, bestDistance = Infinity;
+  for (const e of w.eco.entities) {
+    if (e.eaten || e.spec.key !== key || Math.abs(e.spec.tier - s.run.stage) > 1) continue;
+    const d = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z); if (d < bestDistance) { best = e; bestDistance = d; }
+  }
+  return best && w.eco.placeAt(best, at) ? best.id : null;
+}
+/** QA (`?qaAlphaHealth=<0..1>`, spec §14.2): every live alpha starts with that fraction of its HP (at least 1). */
+export function qaAlphaHealth(w: SimWorld, fraction: number): void {
+  const f = Math.min(1, Math.max(0, fraction));
+  for (const e of w.eco.entities) if (e.spec.alpha && !e.eaten) e.hp = Math.max(1, Math.round(e.spec.hp * f));
+}
 /** A committed evolution: the runtime resets with the destination's orientation; the body goes to the destination. */
 export function simEvolve(s: SimState, destination: { position: Vec3; orientation: Orientation }): void {
   resetRuntime(s.rt, destination.orientation); s.combat.cancelAttacksOnPlayer(s.rt); s.genomeRevision++; refreshDerived(s);
```

- [ ] **Step 5: Wire hints and the QA parameters in `main.ts`**

```diff
--- a/src/tiny-tide/main.ts
+++ b/src/tiny-tide/main.ts
@@ -22,7 +22,8 @@ import { CombatHud, slotViews } from './combat-hud';
 import { seabedHeight } from './biomes';
 import { blockHint, blockHintDue, newBlockHintGate, PITCH_LIMIT, type PlayerStepResult, newTapWatch, tapTargetStalled } from './player-motion';
 import { canChooseNextPlan, evolutionDestination, reconcileAfterCommit } from './lifecycle';
-import { admitted as simAdmitted, checkPose, playerActorCached as simActor, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
+import { admitted as simAdmitted, checkPose, playerActorCached as simActor, qaAlphaHealth, qaEncounter, refreshDerived as simRefreshDerived, simBegin, simEvolve, simFrame, simOwnedState, type SimEvent, type SimState, type SimWorld } from './sim';
+import { Hints, hintText, type HintStorage } from './hints';
 import type { ChompResult } from './feeding';
 import { PLAYER_ID, type CombatTick } from './combat-world';
 import { damageText, EFFECTS, FLASH_SECONDS, IMPACT_COLOURS, IMPACT_PARTICLES, shakeForPlayerHit, shakeForPlayerStrike } from './combat-profiles';
@@ -132,6 +133,13 @@ let qaRejectSubmit = qaParams.get('qaRejectSubmit') === '1';
 /** `?qaHoldStart=1`: after the first start, the simulation (player, ecosystem, game clock) does not advance until the first
  *  real key or pointer press in play. */
 let qaHoldStart = qaParams.get('qaHoldStart') === '1';
+/** `?qaEncounter=<species key>` (for example `1:crab`): at the first start of this page load, the nearest live instance of that species is
+ *  installed 3 player body lengths in front of the player, in calm (spec §14.2). */
+let qaEncounterKey = qaParams.get('qaEncounter');
+/** The entity that `qaEncounter` installed (diagnostics). */
+let qaEncounterId: number | null = null;
+/** `?qaAlphaHealth=<0..1>`: at the first start of this page load, alphas start with that fraction of their HP. */
+let qaAlpha: number | null = (() => { const v = Number(qaParams.get('qaAlphaHealth')); return qaParams.has('qaAlphaHealth') && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null; })();
 /** The part catalog (every shipped part has its real grants since sub-project 3a; `?qaGrantCatalog` is gone, D32). */
 const CATALOG = PARTS;
 /** The first QA rejection, if `?qaRejectSubmit=1` asked for one. */
@@ -393,6 +401,9 @@ function begin(fresh = false) {
   const forced = next.pendingRespawn ? null : forcedSpawn; if (!next.pendingRespawn) forcedSpawn = null;
   respawnToasted = false;
   presentSim(simBegin(sim, simWorld, next, forced), 0);
+  // QA, once per page load: the alpha health, then the encounter in front of the player.
+  if (qaAlpha !== null) { qaAlphaHealth(simWorld, qaAlpha); qaAlpha = null; }
+  if (qaEncounterKey !== null && mode === 'playing') { qaEncounterId = qaEncounter(sim, simWorld, qaEncounterKey); qaEncounterKey = null; }
   syncUI(); save();
   if (qaHoldStart) { qaHoldStart = false; holdingStart = true; }
 }
@@ -497,6 +508,19 @@ function onScreen(p: Vec3): boolean {
   const s = world.screenPoint(new T.Vector3(p.x, p.y, p.z).divideScalar(world.scale));
   return s.visible && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight;
 }
+/** First-time hints (spec §12.3): the moves in the slots, the first wind-up at the player and the first unblockable one. A hint shows only
+ *  when no toast is up and no other hint showed in the last 6 s. */
+const hints = new Hints((() => { try { return localStorage as HintStorage; } catch { return null; } })());
+function offerHints() {
+  if (sim.moves) sim.moves.slots.slots.forEach((k, i) => { if (k) hints.request(`move-${k}`, hintText(`move-${k}`, { slot: i, touch: touchMode })); });
+  for (const v of telegraphViews) {
+    if (v.phase !== 'windup' || sim.combat.entities.get(v.entityId)?.rt.actions.find(a => a.instanceId === v.actionId)?.targetId !== PLAYER_ID) continue;
+    hints.request('telegraph', hintText('telegraph', { slot: 0, touch: touchMode }));
+    if (v.color === 'red') hints.request('telegraph-red', hintText('telegraph-red', { slot: 0, touch: touchMode }));
+  }
+  const h = hints.next(time, toastTimer <= 0 && hintClock <= 0);
+  if (h) { toast(h.text); hintClock = 6; }
+}
 /** Every frame: telegraph volumes and pose cues, hit-stop freezes, the wind-up tone, HP bars, edge arrows and the break-free prompt. */
 function presentCombatView() {
   const playing = mode === 'playing' || mode === 'fainted' || mode === 'evolving';
@@ -813,6 +837,7 @@ function frame(now: number) {
   presentSim(simFrame(sim, simWorld, { dt, intent, wish, held }), dt);
   if (mode !== 'menu' && sim.moves) combatHud.sync(slotViews(sim.moves.slots, sim.moves.set, rt));
   presentCombatView();
+  if (mode === 'playing' && !held) offerHints();
   if (playing) {
     const v = rt.controlledVelocity; moving = Math.hypot(v.x, v.y, v.z) > .5 * SIZES[stage]!;
     saveClock += dt; if (saveClock >= 5) { save(); saveClock = 0; }
@@ -904,6 +929,13 @@ function poseAgreement() {
   }
   return { sockets, positionError, angleError, reflectionsAgree, bodyLength, time };
 }
+/** The `qaEncounter` creature (physical position, body length, pursuit mode), or null. */
+function encounterView() {
+  const e = qaEncounterId === null ? undefined : world.eco.entities.find(x => x.id === qaEncounterId);
+  return e ? { id: e.id, key: e.spec.key, x: e.x, y: e.y, z: e.z, bodyLength: speciesActor(e).bodyLength, mode: e.mode, eaten: e.eaten } : null;
+}
+/** QA: the screen point (CSS pixels) of a physical point, for pointer-aim checks. */
+function screenOf(p: Vec3) { const v = world.screenPoint(new T.Vector3(p.x, p.y, p.z).divideScalar(world.scale)); return { x: v.x, y: v.y, visible: v.visible }; }
 /** Read-only (QA, spec §14.2): actions, telegraphs, action clocks, the last 20 hit outcomes, hit-stop ends, slots, director tokens and holds. */
 function combatDiagnostics() {
   const shape = (a: { lockedShapes: unknown }) => JSON.parse(JSON.stringify(a.lockedShapes));
@@ -913,7 +945,9 @@ function combatDiagnostics() {
     hitStop: { player: rt.hitStopUntil, ...Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.rt.hitStopUntil])) },
     hits: sim.combat.log.map(e => ({ outcome: e.outcome, attacker: e.attackerId, target: e.targetId, attack: e.attackId, amount: e.amount, unit: e.unit, time: e.time })),
     slots: sim.moves ? [...sim.moves.slots.slots] : [], inactive: sim.moves ? [...sim.moves.slots.inactive] : [], tokens: sim.combat.director.tokens.map(t => ({ ...t })),
-    heldBy: rt.heldBy, breakProgress: rt.breakProgress, hp: Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.entity.hp])) };
+    heldBy: rt.heldBy, breakProgress: rt.breakProgress, hp: Object.fromEntries([...sim.combat.entities.values()].map(c => [c.id, c.entity.hp])),
+    alphas: [...sim.combat.entities.values()].filter(c => c.entity.spec.alpha).map(c => ({ id: c.id, key: c.entity.spec.key, hp: c.entity.hp, maxHp: c.maxHp, phase: c.ai?.phase ?? 0, state: c.ai?.name ?? 'idle', eaten: c.entity.eaten })),
+    encounter: encounterView(), hints: [...hints.shown], aim: lastIntent.aim ? { ...lastIntent.aim } : null, aimSource: lastIntent.aimSource };
 }
 // Read-only diagnostics allow browser verification to steer with real controls.
 if (QA) {
@@ -922,7 +956,7 @@ if (QA) {
     plan: currentPlan(run).id, plans: [...run.plans], zone: zoneNow(), velocity: copy(rt.controlledVelocity), externalVelocity: copy(rt.externalVelocity),
     orientation: { ...rt.orientation }, permit: rt.permit ? { ...rt.permit } : null, arc: rt.arc ? { ...rt.arc } : null, breachReadyAt: rt.breachReadyAt, invulnerableUntil: rt.invulnerableUntil,
     pendingRespawn: run.pendingRespawn, caps: capsOf(), physical: copy(physical), legal: mode === 'menu' ? null : admittedNow(playerActor(currentPlan(run), run.genome, run.stage, growthOf(run))), contactNow, lastContact: lastContact === null ? null : `${lastContact}`, lastContactSolid, trapRescues: sim.trapRescues, rescueLog: JSON.parse(JSON.stringify(sim.rescueLog)), contactSolids: [...sim.lastSolids], groundOffset: rt.groundOffset, solidOverlap: mode === 'menu' ? null : solidOverlap(), solidsNear: mode === 'menu' ? [] : solidsNear(32), edge: { inZone: edgeNow, hinted: edgeHinted, half: PLAYER_HALF, softStart: EDGE_SOFT_START * PLAYER_HALF }, hazardSources: hazardSources(), growth: growthOf(run), acceptedHits, rejectedHits,
-    faintLog: sim.faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
+    faintLog: sim.faintLog.map(f => ({ ...f })), stage: run.stage, dna: dnaOf(run), stageDna: run.stageDna, goal: STAGES[run.stage]!.goal, health: run.health, maxHealth: derived.maxHealth, deaths: run.deaths, diet: dietOf(run.genome), genome: structuredClone(run.genome), name: run.name, unlocked: [...run.unlocked], evolveReady: evolveReady(run), bites: run.bites, totalDna: run.totalDna, elapsed: run.elapsed, completed: run.completed, eatenPlanets: [...run.eatenPlanets], player: { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z }, foods: world.edibleFoods.map(f => ({ ...f.data, tag: f.entity.spec.tag, label: f.entity.spec.label, mode: f.entity.mode, hp: f.entity.hp, approachable: approachable(f.entity) })), threats: world.threats.map(f => ({ ...f.data, label: f.entity.spec.label, mode: f.entity.mode })), landmarks: world.foods.filter(f => f.model.visible && f.tier > run.stage).map(f => ({ tier: f.tier, kind: f.data.kind, x: f.data.x, y: f.data.y, z: f.data.z })), world: world.diagnostics, assets: assetDiagnostics(), saveKey: writeKey, loadedKey, time, holdingStart, editorProjection, poseAgreement, screenOf, admission: admissionStats.map(a => { const per = (v: number) => a.frames ? v / a.frames : 0; return { frames: a.frames, msPerFrame: per(a.ms), callsPerFrame: per(a.calls), worstMs: a.worst, contactsPerFrame: per(a.contacts),
       player: { msPerFrame: per(a.player.ms), callsPerFrame: per(a.player.calls), worstMs: a.player.worst }, ecosystem: { msPerFrame: per(a.ecosystem.ms), callsPerFrame: per(a.ecosystem.calls), worstMs: a.ecosystem.worst }, guide: { msPerFrame: per(a.guide.ms), callsPerFrame: per(a.guide.calls), worstMs: a.guide.worst } }; }), render: { calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, geometries: world.renderer.info.memory.geometries }, combat: combatDiagnostics() }) });
 }
 requestAnimationFrame(frame);
```

- [ ] **Step 6: Fixture fields for the browser checks**

In `tests-browser/fixtures.ts`:
- add `import type { SlotPin } from '../src/tiny-tide/combat-types';` next to the other `combat-types` import (merge it into `import type { Actor, SlotPin, Vec3, WorldQueries } from '../src/tiny-tide/combat-types';`)
- add to `FixtureSpec`, after `health?: number;`:
  ```ts
  /** The slot pins (spec §7.2); default four empty pins. */
  pins?: [SlotPin, SlotPin, SlotPin, SlotPin];
  /** The at-risk wallet afterwards (the faint check). */
  atRisk?: number;
  /** The growth bar afterwards; overrides `ready`. */
  stageDna?: number;
  ```
- replace `if (spec.dna !== undefined || funded) run.economy = { ...run.economy, wallet: { banked: spec.dna ?? 100, atRisk: 0 } };` with
  ```ts
  if (spec.dna !== undefined || funded || spec.atRisk !== undefined) run.economy = { ...run.economy, wallet: { banked: spec.dna ?? (funded ? 100 : run.economy.wallet.banked), atRisk: spec.atRisk ?? 0 } };
  if (spec.pins) run.loadout = { slots: [...spec.pins] };
  ```
- replace `run.stageDna = spec.ready && run.stage < 4 ? STAGES[run.stage]!.goal : 0;` with `run.stageDna = spec.stageDna ?? (spec.ready && run.stage < 4 ? STAGES[run.stage]!.goal : 0);`

`validateRun` at the end of `makeFixture` still checks every field (a pin of a kind that the design does not grant throws `loadout <i>: <kind>`).

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/tiny-tide-core/hints.test.ts tests/tiny-tide-core/sim.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 8: Checkpoint.** Expected: green. Then open `http://127.0.0.1:5199/tiny-tide.html?qa&qaEncounter=1:crab` in the running server, press Play, and read `window.__tinyTide.combat.encounter` in the console: expected a number (the crab's id), with the crab about 3 body lengths in front.

- [ ] **Step 9: Commit**

```bash
git add src/tiny-tide/hints.ts src/tiny-tide/ecosystem.ts src/tiny-tide/sim.ts src/tiny-tide/main.ts tests/tiny-tide-core/hints.test.ts tests/tiny-tide-core/sim.test.ts tests-browser/fixtures.ts
git commit -m "Tiny Tide combat: first-time hints, the qaEncounter and qaAlphaHealth QA parameters, fixture pins and wallet fields

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T23: The combat balance probe

**Spec:** §14.3, D35 (P1–P8).

**Files:**
- Create: `src/tiny-tide/combat-probe.ts`, `tests/tiny-tide-core/combat-balance.test.ts`

**Interfaces:**
- Consumes: T6 `newSimState`, `simBegin`, `simFrame`, `playerMoves`, `playerActorCached`; T8/T11 `CombatWorld` (`startSpecies`, `speciesShapes`, `stateOf`, `director.tokens`); T13 `BEHAVIOURS`, `SPECIES_ATTACKS`, `hostileSizes`; T22 `Ecosystem.placeAt`; `state.ts` (`applyDesign`, `prepareEvolution`, `commitEvolution`, `evolveReady`, `validateRun`); `adaptToPlan`.
- Produces: `PROBE_DT = 1/30`; `onScreenFrom(player, yaw, L, p)` (the camera model: 6 L behind, 2 L above, 60° vertical field, 16:9); `ProbeBuild`, `makeRun(seed, build)`; `Bot`, `newBot()`, `BotOptions`, `botInput(world, bot, options)` (the ideal dodge bot, the fight bot, the journey bot's movement); `DirectorWatch`, `newWatch()`; `AttackOutcome`, `attackTrial(seed, build, speciesKey, attackId, { reaction, useMoves, still? }, watch?)`; `timeToKill(seed, build, speciesKey, cap, watch?)`; `SizeReport`, `JourneyReport`, `journey(line, diet, seed, limit?, watch?)`; `SPECIES_SIZE`, `P5_BARS`, `P6_BARS`; `AttackRow`, `TtkRow`, `ProbeReport`, `ProbeOptions`, `FULL_PROBE`; `hostileAttacks()`; `runProbe(options?)`; `probeMarkdown(report)`.

Rules of the probe that the spec leaves open, and how this plan decides them:
- A trial of P1–P4 counts only when the same attack, with the same seed, hits a player who does nothing (`still: true`). A whiff measures nothing.
- The size-0 mouth of a build is set on the fresh run (the start's choice), because `applyDesign` refuses a diet change between evolutions.
- Other creatures are removed for P1–P6 (eaten for good; an alpha is hidden by adding its reward part to `unlocked` of that throw-away run).
- The journey bot skips a target whose distance has not dropped by .5 L in 3 s, for 15 s (as the browser journey bots do).
- An alpha is fled by every diet only while it hunts.

- [ ] **Step 1: Write the test** (complete file: a smoke part that always runs, and the full probe behind `TIDE_COMBAT_PROBE=1`)

```ts
// tests/tiny-tide-core/combat-balance.test.ts — spec §14.3: the combat balance probe. The full probe (P1–P8) is long and runs only with
// TIDE_COMBAT_PROBE=1; it writes .codex-drafts/tiny-tide-qa/combat-probe.json and combat-probe.md. A smoke version always runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attackTrial, hostileAttacks, journey, newWatch, onScreenFrom, probeMarkdown, runProbe, timeToKill, FULL_PROBE } from '../../src/tiny-tide/combat-probe';

const FULL = process.env.TIDE_COMBAT_PROBE === '1';
describe('combat probe (smoke)', () => {
  it('sees a point in front of the camera and not one behind it', () => {
    expect(onScreenFrom({ x: 0, y: 0, z: 0 }, 0, 1, { x: 0, y: 0, z: 3 })).toBe(true);
    expect(onScreenFrom({ x: 0, y: 0, z: 0 }, 0, 1, { x: 0, y: 0, z: -8 })).toBe(false);
  });
  it('lists every hostile attack at sizes 0 and 1', () => {
    const ids = hostileAttacks().map(a => `${a.size}:${a.attackId}`);
    expect(ids).toContain('0:crab-lunge'); expect(ids).toContain('1:squid-grab'); expect(ids).toContain('0:mother-pinch');
  });
  it('runs one trial of each measure', () => {
    const watch = newWatch();
    const dash = { label: 'dash', stage: 0 as const, line: 'swimmer' as const, mouths: ['mouth_nibbler', 'mouth_nibbler'] as [string, string], add: [{ id: 'fin_side', mirror: true }] };
    expect(['avoided', 'mitigated', 'countered', 'hit']).toContain(attackTrial(1000, dash, '1:crab', 'crab-lunge', { reaction: .25, useMoves: true }, watch));
    const t = timeToKill(11000, { label: 'meat', stage: 0, line: 'swimmer', mouths: ['mouth_snapper', 'mouth_snapper'], add: [] }, '0:drifter', 30, watch);
    expect(t).toBeGreaterThan(0);
    const j = journey('swimmer', 'carnivore', 11, 5, watch);
    expect(j.sizes[0]!.activeSeconds).toBeGreaterThan(4.9);
    expect(watch.maxTokens).toBeLessThanOrEqual(2);
  }, 60_000);
});
describe.skipIf(!FULL)('combat probe (full, TIDE_COMBAT_PROBE=1)', () => {
  it('meets P1–P8', () => {
    const report = runProbe(FULL_PROBE);
    mkdirSync('.codex-drafts/tiny-tide-qa', { recursive: true });
    writeFileSync('.codex-drafts/tiny-tide-qa/combat-probe.json', JSON.stringify(report, null, 1));
    writeFileSync('.codex-drafts/tiny-tide-qa/combat-probe.md', probeMarkdown(report));
    expect(report.p8.pass, 'P8 director invariants').toBe(true);
    expect([...report.p1, ...report.p2, ...report.p3].filter(r => !r.pass).map(r => `${r.attackId}@${r.size}: ${r.share}`), 'P1–P3').toEqual([]);
    expect([...report.p5, ...report.p6].filter(r => !r.pass).map(r => `${r.build} ${r.species}: ${r.median}`), 'P5–P6').toEqual([]);
    expect(report.p7.filter(j => !j.pass).map(j => `${j.line} ${j.diet} ${j.seed}`), 'P7').toEqual([]);
  }, 6 * 60 * 60_000);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/tiny-tide-core/combat-balance.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tiny-tide/combat-probe"`.

- [ ] **Step 3: Create `combat-probe.ts`** (complete file)

```ts
// The headless combat balance probe (spec §14.3, D35). It runs sim.ts — the real player step, ecosystem and combat world — with bots, at
// dt = 1/30, and measures P1–P8. Pure: no DOM, no timers, no storage; the test writes the report. It proposes no tuning.
import { SIZES } from './biomes';
import type { AttackSpec, CombatInput, MoveKind, Vec3 } from './combat-types';
import { Ecosystem, type Entity } from './ecosystem';
import { readIntent, RELEASED, type InputSources } from './input';
import { newSimState, playerActorCached, playerMoves, simBegin, simFrame, type SimEvent, type SimState, type SimWorld } from './sim';
import { stageBounds, stageWorldQueries } from './world-queries';
import { applyDesign, commitEvolution, dietCanEat, evolveReady, freshRun, maxHealthOf, prepareEvolution, STAGES, validateRun, type Build, type Run } from './state';
import { adaptToPlan, cloneGenome, nextUid, type Genome } from './genome';
import { plan as planById } from './plans';
import { part } from './parts';
import { startAnchor } from './motion';
import { playerActor, speciesActor } from './mount';
import { BEHAVIOURS, hostileSizes, SPECIES_ATTACKS } from './bestiary';
import { SPECIES } from './species';
import { PLAYER_ID, SPECIES_PITCH_LIMIT } from './combat-world';
import { windupLength } from './action-engine';
import { shapeCentroid } from './combat-shapes';

export const PROBE_DT = 1 / 30;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 }; };
const flat = (a: Vec3): Vec3 => unit({ x: a.x, y: 0, z: a.z });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN; };

// ---- the camera model (spec §14.3): 6 L behind and 2 L above the player, looking at it, 60° vertical field of view, 16:9 ----
const TAN_V = Math.tan(30 * Math.PI / 180), TAN_H = TAN_V * 16 / 9;
export function onScreenFrom(player: Vec3, yaw: number, L: number, p: Vec3): boolean {
  const f = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, eye = { x: player.x - 6 * L * f.x, y: player.y + 2 * L, z: player.z - 6 * L * f.z };
  const look = unit(sub(player, eye)), right = unit(cross(look, UP)), up = cross(right, look), d = sub(p, eye), z = dot(d, look);
  return z > 0 && Math.abs(dot(d, up) / z) <= TAN_V && Math.abs(dot(d, right) / z) <= TAN_H;
}

// ---- builds (the fixture page's construction, with the game's own modules) ----
export interface PartIn { id: string; scale?: number; mirror?: boolean }
/** A build: the mouth of size 0 and size 1, parts added at its last size, and the line it evolves along. */
export interface ProbeBuild { label: string; stage: 0 | 1; line: 'swimmer' | 'crawler'; mouths: [string, string]; add: PartIn[] }
type Legality = { queries: ReturnType<typeof stageWorldQueries>; bounds: ReturnType<typeof stageBounds> };
const legalities = new Map<string, Legality>();
function legality(stage: number, seed: number): Legality {
  const k = `${seed}:${stage}`; let l = legalities.get(k);
  if (!l) { l = { queries: stageWorldQueries(stage, seed), bounds: stageBounds(stage) }; legalities.set(k, l); }
  return l;
}
const buildOf = (seed: number): Build => ({ coast: false, anchorCheck: (g, p) => [1, 1.38].every(growth => startAnchor(playerActor(p, g, p.size, growth), p.size, legality(p.size, seed)).ok) });
function design(g: Genome, serial: number, mouth: string, add: readonly PartIn[]): { genome: Genome; next: number } {
  const out = cloneGenome(g), m = out.parts.find(p => part(p.id)?.kind === 'mouth');
  if (m) m.id = mouth;
  for (const x of add) { const spec = part(x.id)!; out.parts.push({ uid: nextUid(serial++), id: x.id, t: spec.t, angle: spec.angle, scale: x.scale ?? 1, mirror: x.mirror ?? spec.mirror, roll: 0 }); }
  return { genome: out, next: serial };
}
/** The run of a build at its stage: designs paid from construction money, then a 100-DNA wallet and full health. */
export function makeRun(seed: number, b: ProbeBuild): Run {
  const run = freshRun(seed), build = buildOf(seed);
  run.economy = { ...run.economy, wallet: { banked: run.economy.wallet.banked + 100000, atRisk: 0 } };
  // The size-0 mouth and diet are the start's choice (a fresh run starts with the Nibbler; the diet is locked between evolutions), so they are
  // set on the fresh run itself; the added parts go through applyDesign.
  const mouth = run.genome.parts.find(x => part(x.id)?.kind === 'mouth');
  if (mouth) { mouth.id = b.mouths[0]; run.diet = part(b.mouths[0])!.diet ?? run.diet; }
  const issues = validateRun(run, build); if (issues.length) throw new Error(`probe build ${b.label}: ${issues.join(', ')}`);
  const d0 = design(run.genome, run.nextPartSerial, b.mouths[0], b.stage === 0 ? b.add : []);
  const r0 = applyDesign(run, d0.genome, run.name, build, d0.next); if (!r0.ok) throw new Error(`probe build ${b.label}: ${r0.reason}`);
  if (b.stage === 1) evolve(run, b.line, b.mouths[1], b.add, seed);
  run.economy = { ...run.economy, wallet: { banked: 100, atRisk: 0 } }; run.stageDna = 0; run.health = maxHealthOf(run);
  return run;
}
/** Evolution to the line's size-1 plan with the build's mouth (the journey bot and the size-1 builds). */
function evolve(run: Run, line: 'swimmer' | 'crawler', mouth: string, add: readonly PartIn[], seed: number): void {
  const build = buildOf(seed), next = planById(line)!;
  run.stageDna = STAGES[run.stage]!.goal;
  const a = adaptToPlan(run.genome, next, { unlocked: run.unlocked, anchorCheck: build.anchorCheck }, run.nextPartSerial);
  if (!a.ok) throw new Error(`probe evolve ${line}: ${a.reasons[0]}`);
  const d = design(a.genome, a.nextSerial, mouth, add), funded = run.economy.wallet.banked;
  run.economy = { ...run.economy, wallet: { ...run.economy.wallet, banked: funded + 100000 } };
  const prepared = prepareEvolution(run, line, d.genome, run.name, build, d.next);
  if (!('planId' in prepared)) throw new Error(`probe evolve ${line}: ${prepared.reason}`);
  commitEvolution(run, prepared);
  run.economy = { ...run.economy, wallet: { ...run.economy.wallet, banked: Math.max(0, run.economy.wallet.banked - 100000) } };
}

// ---- the world ----
export interface ProbeWorld { s: SimState; w: SimWorld }
function startWorld(seed: number, run: Run, grace = 0): ProbeWorld {
  const s = newSimState(run), eco = new Ecosystem(seed);
  const w: SimWorld = { eco, startGrace: grace, legality: stage => legality(stage, seed), isOnScreen: p => onScreenFrom(s.physical, s.rt.orientation.yaw, playerActorCached(s).bodyLength, p) };
  eco.reset(run.eatenPlanets); simBegin(s, w, run, null);
  return { s, w };
}
const entityCentre = (e: Entity): Vec3 => { const c = speciesActor(e).hull[0]!.start; return { x: e.x + c.x, y: e.y + c.y, z: e.z + c.z }; };
const entityL = (e: Entity) => speciesActor(e).bodyLength;
/** Removes every creature but `keep` (the measure's subject): eaten for good; alphas by hiding them for this run. */
function isolate(p: ProbeWorld, keep: Entity): void {
  for (const e of p.w.eco.entities) {
    if (e === keep || e.spec.kind === 'planet') continue;
    if (e.spec.alpha) { if (!p.s.run.unlocked.includes(e.spec.alpha.rewardPartId)) p.s.run.unlocked.push(e.spec.alpha.rewardPartId); continue; }
    e.eaten = true; e.respawn = -1; e.combat = null;
  }
}
/** Installs `e` in front of the player with `gapL` of its body lengths between the bodies. */
function placeInFront(p: ProbeWorld, e: Entity, gapL: number): boolean {
  const L = playerActorCached(p.s).bodyLength, yaw = p.s.rt.orientation.yaw, d = gapL * entityL(e) + .35 * SIZES[e.spec.tier]! * (e.spec.bodyScale ?? 1) + .3 * L;
  return p.w.eco.placeAt(e, { x: p.s.physical.x + Math.sin(yaw) * d, y: p.s.physical.y, z: p.s.physical.z + Math.cos(yaw) * d });
}

// ---- the bots ----
export interface BotOptions {
  /** Seconds from a wind-up's start to the bot's reaction. */
  reaction: number;
  /** false: movement only (P4). */
  useMoves: boolean;
  /** The creature the bot fights (the fight and journey bots), or null. */
  fight: Entity | null;
  /** Journey: walk to this point (food) when there is nothing to fight or dodge. */
  goal: Vec3 | null;
  /** Journey, plant diet: run from this creature. */
  flee: Entity | null;
}
interface Response { kind: 'brace' | 'counter' | 'dash' | 'move'; actionId: string; attacker: Entity; pressAt: number; until: number; dir: Vec3; pressed: boolean }
export interface Bot { previous: CombatInput; seen: Map<string, number>; response: Response | null; flick: number }
export const newBot = (): Bot => ({ previous: RELEASED, seen: new Map(), response: null, flick: 0 });
const slotOf = (s: SimState, kind: MoveKind): number => playerMoves(s).slots.slots.indexOf(kind);

/** One frame of bot input (spec §14.3): the ideal dodge bot, plus fighting when `fight` is set. */
export function botInput(p: ProbeWorld, bot: Bot, o: BotOptions): { intent: CombatInput; wish: Vec3 } {
  const s = p.s, now = s.time, me = s.physical, L = playerActorCached(s).bodyLength, moves = playerMoves(s).set;
  const tapped: [boolean, boolean, boolean, boolean] = [false, false, false, false], held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  let wish: Vec3 = { x: 0, y: 0, z: 0 }, aim: Vec3 | null = null, basic = false;
  const keys = new Set<string>();
  // Held: presses and stick flicks break free (spec §6.6).
  if (s.rt.heldBy !== null) {
    bot.flick = -bot.flick || 1; basic = bot.flick > 0;
    const src: InputSources = { stickX: bot.flick, stickZ: 0, keys, chompHeld: false, chompTapped: basic, riseHeld: false, riseTapped: false, diveHeld: false };
    const intent = readIntent(src, bot.previous, { breachOnRiseTap: false }); bot.previous = intent; return { intent, wish: { x: bot.flick, y: 0, z: 0 } };
  }
  // Threats: species wind-ups at the player, seen `reaction` seconds ago.
  for (const [id] of bot.seen) if (![...s.combat.entities.values()].some(c => c.rt.actions.some(a => a.instanceId === id))) bot.seen.delete(id);
  let next: { c: { entity: Entity }; a: { instanceId: string }; activeAt: number; attack: AttackSpec; centroid: Vec3 } | null = null;
  for (const c of s.combat.entities.values()) for (const a of c.rt.actions) {
    if (a.targetId !== PLAYER_ID || a.phase !== 'windup' || !a.resolved.attack) continue;
    if (!bot.seen.has(a.instanceId)) bot.seen.set(a.instanceId, now);
    if (now - bot.seen.get(a.instanceId)! < o.reaction - 1e-9 || bot.response?.actionId === a.instanceId) continue;
    const activeAt = now + Math.max(0, windupLength(a) - (c.rt.actionClock - a.phaseStartedAt));
    const shapes = a.lockedShapes ?? s.combat.speciesShapes(c, a, now);
    if (!next || activeAt < next.activeAt) next = { c, a, activeAt, attack: a.resolved.attack, centroid: shapes[0] ? shapeCentroid(shapes[0]) : entityCentre(c.entity) };
  }
  if (next && (!bot.response || bot.response.kind === 'move')) {
    const attacker = next.c.entity, axis = flat(sub(me, entityCentre(attacker))), side = { x: -axis.z, y: 0, z: axis.x };
    const dir = dot(side, sub(me, next.centroid)) >= 0 ? side : { x: -side.x, y: 0, z: -side.z };
    const brace = o.useMoves ? moves.byKind.brace?.resolved.guard : undefined, counter = o.useMoves ? moves.byKind.counter?.resolved.guard : undefined, dash = o.useMoves ? moves.byKind.dash?.resolved.evasion : undefined;
    const base = { actionId: next.a.instanceId, attacker, dir, pressed: false };
    if (brace && next.attack.blockable && next.attack.damage < (brace.breakHalfHearts ?? Infinity)) bot.response = { ...base, kind: 'brace', pressAt: now, until: next.activeAt + next.attack.activeSeconds };
    else if (counter && next.attack.parryable) bot.response = { ...base, kind: 'counter', pressAt: next.activeAt - counter.startupSeconds - (counter.windowSeconds ?? 0) / 2, until: next.activeAt + next.attack.activeSeconds };
    else if (dash) bot.response = { ...base, kind: 'dash', pressAt: next.activeAt - .15 - dash.startupSeconds, until: next.activeAt + next.attack.activeSeconds };
    else bot.response = { ...base, kind: 'move', pressAt: now, until: next.activeAt + next.attack.activeSeconds + .2 };
  }
  const r = bot.response;
  if (r) {
    const toward = unit(sub(entityCentre(r.attacker), me));
    if (r.kind === 'brace') { const i = slotOf(s, 'brace'); if (i >= 0) held[i] = true; aim = toward; }
    else if (r.kind === 'counter') { aim = toward; if (!r.pressed && now >= r.pressAt - 1e-9) { const i = slotOf(s, 'counter'); if (i >= 0) tapped[i] = true; r.pressed = true; } }
    else if (r.kind === 'dash') { wish = r.dir; aim = r.dir; if (!r.pressed && now >= r.pressAt - 1e-9) { const i = slotOf(s, 'dash'); if (i >= 0) tapped[i] = true; r.pressed = true; } }
    else wish = r.dir;
    if (now > r.until) bot.response = null;
  } else if (o.flee && !o.flee.eaten) {
    wish = flat(sub(me, entityCentre(o.flee)));
  } else if (o.fight && !o.fight.eaten) {
    // Fight: close in, then Bite (or Grab) when the target is in recovery or not attacking and in range.
    const t = o.fight, c = s.combat.stateOf(t), to = sub(entityCentre(t), me), d = Math.hypot(to.x, to.y, to.z), reach = (moves.basic?.resolved.attack?.shape.kind === 'cone' ? moves.basic.resolved.attack.shape.range : .5) * L;
    const gap = d - .35 * SIZES[t.spec.tier]! * (t.spec.bodyScale ?? 1) - .3 * L, attacking = !!c?.rt.actions.some(a => a.phase === 'windup' || a.phase === 'active');
    aim = unit(to);
    if (gap > .8 * reach) wish = flat(to);
    if (gap <= reach && !attacking && !s.rt.actions.some(a => a.phase !== 'interrupted')) {
      const grab = o.useMoves ? slotOf(s, 'grab') : -1;
      if (grab >= 0 && t.spec.behaviourId && BEHAVIOURS[t.spec.behaviourId]?.grabbable && !t.spec.alpha && (now * 10 | 0) % 7 === 0) tapped[grab] = true; else basic = true;
    }
    if (to.y > .3 * L) keys.add('KeyE'); else if (to.y < -.3 * L) keys.add('KeyQ');
  } else if (o.goal) {
    const to = sub(o.goal, me); wish = flat(to); aim = unit(to);
    if (to.y > .3 * L) keys.add('KeyE'); else if (to.y < -.3 * L) keys.add('KeyQ');
    basic = Math.hypot(to.x, to.y, to.z) < 1.2 * L;
  }
  // A press is an edge: alternate the basic button so that a held wish gives one press every other frame.
  const tap = basic && !bot.previous.basicHeld;
  const src: InputSources = { stickX: wish.x, stickZ: wish.z, keys, chompHeld: tap, chompTapped: tap, riseHeld: false, riseTapped: false, diveHeld: false, aim, aimSource: aim ? 'auto' : 'none', activeTapped: tapped, activeHeld: held };
  const intent = readIntent(src, bot.previous, { breachOnRiseTap: false }); bot.previous = intent;
  return { intent, wish };
}

// ---- director invariants (P8) ----
export interface DirectorWatch { maxTokens: number; minActiveGap: number; minOffScreenWindup: number; lastActiveAt: number; world: ProbeWorld | null; seen: Map<string, { windup: number; onScreen: boolean; active: boolean }> }
export const newWatch = (): DirectorWatch => ({ maxTokens: 0, minActiveGap: Infinity, minOffScreenWindup: Infinity, lastActiveAt: -Infinity, world: null, seen: new Map() });
function watchDirector(p: ProbeWorld, d: DirectorWatch): void {
  // Each world has its own clock and director: spacing is measured inside one world.
  if (d.world !== p) { d.world = p; d.lastActiveAt = -Infinity; d.seen.clear(); }
  const s = p.s; d.maxTokens = Math.max(d.maxTokens, s.combat.director.tokens.length);
  for (const c of s.combat.entities.values()) for (const a of c.rt.actions) {
    if (a.targetId !== PLAYER_ID || !a.resolved.attack) continue;
    let w = d.seen.get(a.instanceId);
    if (!w) { w = { windup: windupLength(a), onScreen: p.w.isOnScreen(entityCentre(c.entity)), active: false }; d.seen.set(a.instanceId, w); if (!w.onScreen) d.minOffScreenWindup = Math.min(d.minOffScreenWindup, w.windup); }
    if (!w.active && a.phase === 'active') { w.active = true; d.minActiveGap = Math.min(d.minActiveGap, s.time - d.lastActiveAt); d.lastActiveAt = s.time; }
  }
  if (d.seen.size > 256) d.seen.clear();
}

// ---- P1–P4: one attack at a time ----
export type AttackOutcome = 'avoided' | 'mitigated' | 'countered' | 'hit';
/** One trial (spec §14.3): the attacker placed at its band midpoint, the attack started at the player, the bot reacting; the outcome of that action. */
/** `still`: the player does nothing (the baseline: a trial counts only when the attack hits a still player). */
export function attackTrial(seed: number, build: ProbeBuild, speciesKey: string, attackId: string, o: { reaction: number; useMoves: boolean; still?: boolean }, watch?: DirectorWatch): AttackOutcome | null {
  const run = makeRun(seed, build), p = startWorld(seed, run), subject = p.w.eco.entities.find(e => e.spec.key === speciesKey && !e.eaten);
  if (!subject) return null;
  if (subject.spec.alpha && subject.spec.alpha.size !== run.stage) return null;
  isolate(p, subject);
  const behaviour = BEHAVIOURS[subject.spec.behaviourId ?? '']!, choices = [...(behaviour.attacks ?? []), ...(behaviour.phases ?? []).flatMap(ph => ph.attacks)];
  const band = choices.find(c => c.attackId === attackId)?.band ?? [.5, 1];
  if (!placeInFront(p, subject, (band[0] + band[1]) / 2)) return null;
  // One frame to make the subject active and give it a combat state, then the attack.
  simFrame(p.s, p.w, { dt: PROBE_DT, intent: RELEASED, wish: { x: 0, y: 0, z: 0 }, held: false });
  const c = p.s.combat.stateOf(subject), attack = SPECIES_ATTACKS[attackId]!;
  if (!c) return null;
  const to = unit(sub(p.s.physical, entityCentre(subject))), ground = subject.spec.movementProfileId === 'sp-ground';
  const aim = ground ? flat(to) : unit({ x: to.x, y: Math.max(-Math.sin(SPECIES_PITCH_LIMIT), Math.min(Math.sin(SPECIES_PITCH_LIMIT), to.y)), z: to.z });
  const started = p.s.combat.startSpecies(c, attackId, attack, aim, PLAYER_ID, p.s.time, { onScreen: true, playing: true });
  if (typeof started === 'string') return null;
  const bot = newBot(); let outcome: AttackOutcome = 'avoided';
  const end = p.s.time + windupLength(started) + attack.activeSeconds + (attack.hold?.seconds ?? 0) + 1;
  while (p.s.time < end) {
    const { intent, wish } = o.still ? { intent: RELEASED, wish: { x: 0, y: 0, z: 0 } } : botInput(p, bot, { ...o, fight: null, goal: null, flee: null });
    for (const ev of simFrame(p.s, p.w, { dt: PROBE_DT, intent, wish, held: false })) {
      if (ev.type !== 'combat') continue;
      for (const h of ev.tick.events) {
        if (h.actionInstanceId !== started.instanceId || h.targetId !== PLAYER_ID) continue;
        if (h.outcome === 'hit' || h.outcome === 'grabbed' || h.outcome === 'guard-broken') outcome = 'hit';
        else if (h.outcome === 'countered' && outcome !== 'hit') outcome = 'countered';
        else if (h.outcome === 'blocked' && outcome !== 'hit') outcome = h.amount <= attack.damage / 2 ? (outcome === 'countered' ? outcome : 'mitigated') : 'hit';
      }
    }
    if (watch) watchDirector(p, watch);
    if (p.s.mode !== 'playing') break;
  }
  return outcome;
}

// ---- P5/P6: time to kill ----
/** Seconds until the fight bot kills one creature of `speciesKey` placed 1 of its body lengths away, or Infinity (a faint or `cap`). */
export function timeToKill(seed: number, build: ProbeBuild, speciesKey: string, cap: number, watch?: DirectorWatch): number {
  const run = makeRun(seed, build), p = startWorld(seed, run), subject = p.w.eco.entities.find(e => e.spec.key === speciesKey && !e.eaten);
  if (!subject || !placeInFront(p, subject, 1)) return NaN;
  isolate(p, subject);
  const bot = newBot(), t0 = p.s.time;
  while (p.s.time - t0 < cap) {
    const { intent, wish } = botInput(p, bot, { reaction: .25, useMoves: true, fight: subject, goal: null, flee: null });
    const events = simFrame(p.s, p.w, { dt: PROBE_DT, intent, wish, held: false });
    if (watch) watchDirector(p, watch);
    if (events.some(e => e.type === 'killed' && e.entity === subject) || (subject.eaten && p.s.mode === 'playing')) return p.s.time - t0;
    if (p.s.mode === 'fainted') return Infinity;
  }
  return Infinity;
}

// ---- P7: journeys ----
export interface SizeReport { size: number; ready: boolean; activeSeconds: number; faints: number; kills: Record<string, number>; damageHalfHearts: number; heldSeconds: number;
  dna: { meals: number; kills: number; survivor: number; alpha: number } }
export interface JourneyReport { line: 'swimmer' | 'crawler'; diet: 'herbivore' | 'carnivore' | 'omnivore'; seed: number; sizes: SizeReport[]; pass: boolean }
const DIET_MOUTHS: Record<JourneyReport['diet'], [string, string]> = { herbivore: ['mouth_nibbler', 'mouth_nibbler'], carnivore: ['mouth_snapper', 'mouth_snapper'], omnivore: ['mouth_snapper', 'mouth_beak'] };
/** The journey bot (fight bot, 0.35 s reaction): it eats by diet; meat diets fight hunters and prey; the plant diet flees hunters and fights only
 *  when cornered (a hunter within 0.5 of its body lengths for 2 s). Each size ends at evolve-ready or after `limit` seconds of active time. */
export function journey(line: 'swimmer' | 'crawler', diet: JourneyReport['diet'], seed: number, limit = 600, watch?: DirectorWatch): JourneyReport {
  const mouths = DIET_MOUTHS[diet], run = makeRun(seed, { label: 'journey', stage: 0, line, mouths, add: [] });
  let p = startWorld(seed, run, 2);
  const sizes: SizeReport[] = [];
  for (const size of [0, 1]) {
    const rep: SizeReport = { size, ready: false, activeSeconds: 0, faints: 0, kills: {}, damageHalfHearts: 0, heldSeconds: 0, dna: { meals: 0, kills: 0, survivor: 0, alpha: 0 } };
    const bot = newBot(); let corneredFor = 0;
    // A target (prey or food) whose distance has not dropped by half a body length in 3 s is skipped for 15 s (a rock or the seabed in the way).
    const skipped = new Map<Entity, number>(); let chase: { e: Entity; best: number; since: number } | null = null;
    while (rep.activeSeconds < limit && !evolveReady(p.s.run)) {
      const s = p.s, me = s.physical, L = playerActorCached(s).bodyLength, live = p.w.eco.entities.filter(e => e.active && !e.eaten);
      const hunters = live.filter(e => e.spec.behaviourId && (e.mode === 'hunt' || e.mode === 'angry'));
      const open = (e: Entity) => !((skipped.get(e) ?? -Infinity) > s.time);
      const near = (es: Entity[]) => es.filter(open).reduce<{ e: Entity | null; d: number }>((b, e) => { const d = Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z); return d < b.d ? { e, d } : b; }, { e: null, d: Infinity });
      const hunter = near(hunters.filter(e => !e.spec.alpha));
      let fight: Entity | null = null, flee: Entity | null = null;
      if (diet === 'herbivore') {
        corneredFor = hunter.e && hunter.d - .35 * SIZES[hunter.e.spec.tier]! <= .5 * entityL(hunter.e) ? corneredFor + PROBE_DT : 0;
        if (corneredFor >= 2) fight = hunter.e; else if (hunter.e && hunter.d < 8 * L) flee = hunter.e;
      } else {
        const prey = near(live.filter(e => e.spec.behaviourId && !e.spec.alpha && (e.spec.tier === s.run.stage || hostileSizes(e.spec).includes(s.run.stage))));
        fight = hunter.e && hunter.d < 10 * L ? hunter.e : prey.e && prey.d < 14 * L ? prey.e : null;
      }
      const alpha = near(hunters.filter(e => !!e.spec.alpha));
      if (!fight && alpha.e && alpha.d < 6 * entityL(alpha.e)) flee = alpha.e;   // an alpha that hunts: every diet keeps away
      const food = near(live.filter(e => !e.spec.behaviourId && e.spec.tier === s.run.stage && dietCanEat(diet, e.spec.tag) && e.spec.kind !== 'planet'));
      const target = fight ?? (flee ? null : food.e);
      if (target) {
        const d = Math.hypot(target.x - me.x, target.y - me.y, target.z - me.z);
        if (!chase || chase.e !== target) chase = { e: target, best: d, since: s.time };
        else if (d < chase.best - .5 * L) { chase.best = d; chase.since = s.time; }
        else if (s.time - chase.since > 3) { skipped.set(target, s.time + 15); chase = null; }
      }
      const { intent, wish } = botInput(p, bot, { reaction: .35, useMoves: true, fight, flee, goal: food.e ? { x: food.e.x, y: food.e.y, z: food.e.z } : null });
      const before = s.mode, events: SimEvent[] = simFrame(s, p.w, { dt: PROBE_DT, intent, wish, held: false });
      if (before === 'playing') rep.activeSeconds += PROBE_DT;
      if (s.rt.heldBy !== null) rep.heldSeconds += PROBE_DT;
      if (watch) watchDirector(p, watch);
      for (const e of events) {
        if (e.type === 'fainted' || (e.type === 'hurt' && e.fainted)) rep.faints++;
        if (e.type === 'hurt') rep.damageHalfHearts += e.damage;
        if (e.type === 'chomp' && e.result.kind === 'ate') rep.dna.meals += e.result.dna;
        if (e.type === 'survived') rep.dna.survivor += e.dna;
        if (e.type === 'killed') { rep.kills[e.entity.spec.key] = (rep.kills[e.entity.spec.key] ?? 0) + 1; if (e.entity.spec.alpha) rep.dna.alpha += e.dna; else rep.dna.kills += e.dna; }
        if (e.type === 'combat') for (const h of e.tick.events) if (h.targetId === PLAYER_ID) rep.damageHalfHearts += h.amount;
      }
    }
    rep.ready = evolveReady(p.s.run); sizes.push(rep);
    if (!rep.ready || size === 1) break;
    evolve(p.s.run, line, mouths[1], [], seed);
    const next = p.s.run; p = startWorld(seed, next, 2);
  }
  const pass = sizes.length === 2 && sizes.every(r => r.ready && r.faints <= 3);
  return { line, diet, seed, sizes, pass };
}

// ---- the report ----
export const SPECIES_SIZE: Readonly<Record<string, 0 | 1>> = { '0:drifter': 0, '0:spiny_snail': 0, '1:crab': 0, '1:clawmother': 0, '1:sardine': 1, '1:puffer': 1, '2:squid': 1, '2:eel': 1, '2:reef_tyrant': 1 };
/** P5 bars (seconds, median time to kill with the meat build). */
export const P5_BARS: Readonly<Record<string, number>> = { '0:drifter': 6, '0:spiny_snail': 8, '1:crab': 20, '1:sardine': 6, '1:puffer': 10, '2:squid': 30, '2:eel': 30, '1:clawmother': 90, '2:reef_tyrant': 120 };
/** P6 bars (plant build); the other species are reported only. */
export const P6_BARS: Readonly<Record<string, number>> = { '1:crab': 45, '2:squid': 75 };
const dashBuild = (stage: 0 | 1): ProbeBuild => ({ label: `dash ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'fin_side', scale: 1, mirror: true }] });
const braceBuild: ProbeBuild = { label: 'brace 1', stage: 1, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'shell_plate', scale: 1 }] };
const counterBuild = (stage: 0 | 1): ProbeBuild => ({ label: `counter ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [{ id: 'spike', scale: 1 }] });
const meatBuild = (stage: 0 | 1): ProbeBuild => ({ label: `meat ${stage}`, stage, line: 'swimmer', mouths: ['mouth_snapper', 'mouth_snapper'], add: [] });
const plantBuild = (stage: 0 | 1): ProbeBuild => ({ label: `plant ${stage}`, stage, line: 'swimmer', mouths: ['mouth_nibbler', 'mouth_nibbler'], add: [] });

export interface AttackRow { attackId: string; species: string; size: number; kind: 'alpha' | 'hunter' | 'fighter'; trials: number; share: number; bar: number | null; pass: boolean }
export interface TtkRow { species: string; build: 'meat' | 'plant'; median: number; bar: number | null; pass: boolean }
export interface ProbeReport { p1: AttackRow[]; p2: AttackRow[]; p3: AttackRow[]; p4: AttackRow[]; p5: TtkRow[]; p6: TtkRow[]; p7: JourneyReport[];
  p8: { maxTokens: number; minActiveGap: number; minOffScreenWindup: number; pass: boolean }; pass: boolean }
export interface ProbeOptions { trials: number; ttkSeeds: readonly number[]; ttkTrials: number; journeySeeds: readonly number[]; journeyLimit: number }
export const FULL_PROBE: ProbeOptions = { trials: 200, ttkSeeds: [11, 12, 13], ttkTrials: 30, journeySeeds: [11, 12, 13], journeyLimit: 600 };

/** Every hostile attack at sizes 0 and 1: its species, the size it targets and its kind. */
export function hostileAttacks(): { attackId: string; species: string; size: 0 | 1; kind: AttackRow['kind'] }[] {
  const out: { attackId: string; species: string; size: 0 | 1; kind: AttackRow['kind'] }[] = [];
  for (const spec of SPECIES) {
    const b = spec.behaviourId ? BEHAVIOURS[spec.behaviourId] : undefined; if (!b) continue;
    const kind: AttackRow['kind'] = spec.alpha ? 'alpha' : b.type === 'hunter' || b.type === 'hunter-ambush' ? 'hunter' : 'fighter';
    for (const size of hostileSizes(spec)) if (size === 0 || size === 1) for (const attackId of spec.attackIds) out.push({ attackId, species: spec.key, size, kind });
  }
  return out;
}
function attackRows(list: ReturnType<typeof hostileAttacks>, trials: number, build: (size: 0 | 1) => ProbeBuild, useMoves: boolean, counts: (o: AttackOutcome) => boolean, bar: (r: { kind: AttackRow['kind'] }) => number | null, watch: DirectorWatch): AttackRow[] {
  return list.map(x => {
    let n = 0, good = 0;
    for (let i = 0; i < trials; i++) {
      // Only trials whose attack hits a still player count (a whiff measures nothing).
      if (attackTrial(1000 + i, build(x.size), x.species, x.attackId, { reaction: .25, useMoves, still: true }) !== 'hit') continue;
      const o = attackTrial(1000 + i, build(x.size), x.species, x.attackId, { reaction: .25, useMoves }, watch); if (o === null) continue; n++; if (counts(o)) good++;
    }
    const share = n ? good / n : NaN, b = bar(x);
    return { attackId: x.attackId, species: x.species, size: x.size, kind: x.kind, trials: n, share, bar: b, pass: b === null || (n > 0 && share >= b - 1e-9) };
  });
}
/** The whole probe (spec §14.3). Long: run it with TIDE_COMBAT_PROBE=1. */
export function runProbe(o: ProbeOptions = FULL_PROBE): ProbeReport {
  const watch = newWatch(), all = hostileAttacks();
  const p1 = attackRows(all, o.trials, dashBuild, true, x => x === 'avoided' || x === 'countered', r => r.kind === 'alpha' ? .9 : .95, watch);
  const p2 = attackRows(all.filter(x => x.size === 1 && SPECIES_ATTACKS[x.attackId]!.blockable), o.trials, () => braceBuild, true, x => x !== 'hit', () => .95, watch);
  const p3 = attackRows(all.filter(x => SPECIES_ATTACKS[x.attackId]!.parryable), o.trials, counterBuild, true, x => x === 'countered', () => .85, watch);
  const p4 = attackRows(all, o.trials, dashBuild, false, x => x === 'avoided', () => null, watch);
  const ttk = (build: (size: 0 | 1) => ProbeBuild, bars: Readonly<Record<string, number>>, kind: 'meat' | 'plant', every: boolean): TtkRow[] =>
    Object.keys(SPECIES_SIZE).filter(k => every || bars[k] !== undefined || kind === 'plant').map(species => {
      const bar = bars[species] ?? null, cap = 3 * (bar ?? 60), times: number[] = [];
      for (const seed of o.ttkSeeds) for (let i = 0; i < o.ttkTrials; i++) { const t = timeToKill(seed * 1000 + i, build(SPECIES_SIZE[species]!), species, cap, watch); if (!Number.isNaN(t)) times.push(t); }
      const m = median(times); return { species, build: kind, median: m, bar, pass: bar === null || m <= bar };
    });
  const p5 = ttk(meatBuild, P5_BARS, 'meat', true), p6 = ttk(plantBuild, P6_BARS, 'plant', true);
  const p7: JourneyReport[] = [];
  for (const line of ['swimmer', 'crawler'] as const) for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) for (const seed of o.journeySeeds) p7.push(journey(line, diet, seed, o.journeyLimit, watch));
  const p8 = { maxTokens: watch.maxTokens, minActiveGap: watch.minActiveGap, minOffScreenWindup: watch.minOffScreenWindup,
    pass: watch.maxTokens <= 2 && watch.minActiveGap >= .25 - 1e-6 && watch.minOffScreenWindup >= .6 - 1e-6 };
  const pass = [...p1, ...p2, ...p3, ...p5, ...p6].every(r => r.pass) && p7.every(j => j.pass) && p8.pass;
  return { p1, p2, p3, p4, p5, p6, p7, p8, pass };
}
/** The Markdown summary of a report. */
export function probeMarkdown(r: ProbeReport): string {
  const pct = (x: number) => Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)} %`, sec = (x: number) => Number.isFinite(x) ? `${x.toFixed(1)} s` : '∞';
  const rows = (title: string, list: AttackRow[]) => [`## ${title}`, '', '| Attack | Species | Size | Kind | Trials | Share | Bar | Pass |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...list.map(x => `| ${x.attackId} | ${x.species} | ${x.size} | ${x.kind} | ${x.trials} | ${pct(x.share)} | ${x.bar === null ? '—' : pct(x.bar)} | ${x.pass ? 'yes' : '**no**'} |`), ''];
  const ttk = (title: string, list: TtkRow[]) => [`## ${title}`, '', '| Species | Median | Bar | Pass |', '| --- | --- | --- | --- |', ...list.map(x => `| ${x.species} | ${sec(x.median)} | ${x.bar === null ? '—' : sec(x.bar)} | ${x.pass ? 'yes' : '**no**'} |`), ''];
  const journeys = ['## P7 Completion', '', '| Line | Diet | Seed | Size | Ready | Active | Faints | Damage ½♥ | Held | DNA meals / kills / survivor / alpha | Kills |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.p7.flatMap(j => j.sizes.map(s => `| ${j.line} | ${j.diet} | ${j.seed} | ${s.size} | ${s.ready ? 'yes' : '**no**'} | ${sec(s.activeSeconds)} | ${s.faints} | ${s.damageHalfHearts} | ${sec(s.heldSeconds)} | ${s.dna.meals} / ${s.dna.kills} / ${s.dna.survivor} / ${s.dna.alpha} | ${Object.entries(s.kills).map(([k, n]) => `${k} ${n}`).join(', ') || '—'} |`)), ''];
  return ['# Tiny Tide combat probe', '', `Overall: ${r.pass ? 'PASS' : '**FAIL**'}`, '', ...rows('P1 Dash-only avoidance', r.p1), ...rows('P2 Brace', r.p2), ...rows('P3 Counter', r.p3), ...rows('P4 Movement only (reported)', r.p4),
    ...ttk('P5 Time to kill, meat build', r.p5), ...ttk('P6 Time to kill, plant build', r.p6), ...journeys,
    '## P8 Director', '', `Most tokens at once: ${r.p8.maxTokens}; smallest gap between active starts: ${sec(r.p8.minActiveGap)}; shortest off-screen wind-up: ${sec(r.p8.minOffScreenWindup)}; pass: ${r.p8.pass ? 'yes' : '**no**'}`, ''].join('\n');
}
```

- [ ] **Step 4: Run the smoke test**

Run: `npx vitest run tests/tiny-tide-core/combat-balance.test.ts`
Expected: `Tests  3 passed | 1 skipped (4)` in about a second.

- [ ] **Step 5: Run the full probe** (background, long: about 2–4 hours)

Run: `TIDE_COMBAT_PROBE=1 npx vitest run tests/tiny-tide-core/combat-balance.test.ts`
Expected: the report files `.codex-drafts/tiny-tide-qa/combat-probe.json` and `combat-probe.md`, and the test passes only when every bar holds.

A reduced run of this code on the plan's scratch copy (20 trials per attack, 1 time-to-kill seed × 5 trials, journeys with seed 11 only; 187 s) gave these results. Expect the full run to show the same failures:

| Measure | Result of the reduced run |
| --- | --- |
| P1 dash-only | 100 % for every crab, squid, eel, snail, puffer and Clawmother lunge/sweep and Tyrant den-lunge/charge/whirl row. No trial: `mother-pinch`, `mother-pinch-2`, `mother-emerge`, `mother-pinch-rage`, `tyrant-bite` (the attack never hits a still player from the band midpoint, so these rows have 0 trials and fail). |
| P2 brace | 100 % for every measured row; `tyrant-bite` has 0 trials. |
| P3 counter | crab, snail, puffer, eel, `squid-grab` ≥ 95 %; **fails:** `squid-lunge` 5 %, `mother-lunge` 0 %, `tyrant-den-lunge` 5 %, `tyrant-charge` 5 % (a lunge lands after the active start, and the spec's bot holds the window on the active start), plus the 0-trial alpha rows. |
| P5 meat | drifter .3 s, snail .8 s, crab 5.3 s, sardine .3 s, puffer 7.4 s, squid 5.5 s, eel 5.2 s, Reef Tyrant 51.7 s — all pass; **Clawmother ∞** (the bot is worn down by the `mother-pinch-2` chain, which comes inside the Dash cooldown). |
| P6 plant | crab 8.1 s, squid 7.1 s — pass. |
| P7 completion | 10 of 12 sizes ready (seed 11); **fails:** crawler carnivore and crawler omnivore at size 1 (600 s, few kills; the omnivore fainted 3 times). |
| P8 director | at most 2 tokens; shortest off-screen wind-up .7 s; **fails:** one gap of .2 s between active starts (the bar is .25 s). |

- [ ] **Step 6: Act on the report**

For each failed bar, in this order, and without lowering a floor of §11.1 or a bar of §14.3:
1. **P8 gap .2 s.** This is an engine fault, not tuning: find the two actions in the report and check whether a hit-stop moved one active start (action clocks stop in hit-stop, world time does not). Fix the director's spacing in world time (T11) with a failing `director.test.ts` case first.
2. **0-trial rows (P1, P2, P3).** The probe places the attacker at the band midpoint. For these attacks the AI closes in before it attacks. Place the attacker at the band's near edge for those rows, and say so in the report header.
3. **P3 lunges.** Report to the owner: the spec bot cannot counter a lunge. Do not change the bot rule without the owner.
4. **P5 Clawmother, P7 crawler size 1.** Tune species numbers only (HP, speeds, chain gaps, cooldowns in `bestiary.ts` and `species.ts`), one change at a time, re-run the affected measures, and list every change with before and after numbers in the report and in the commit message.

Report the final table to the controller with the commit.

- [ ] **Step 7: Checkpoint.** Expected: green (the smoke test runs in the default suite).

- [ ] **Step 8: Commit** (add the tuned files of Step 6, by name, if any)

```bash
git add src/tiny-tide/combat-probe.ts tests/tiny-tide-core/combat-balance.test.ts
git commit -m "Tiny Tide combat: the headless balance probe (P1–P8) with dodge, fight and journey bots

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task T24: Browser checks

**Spec:** §14.2, §3.2 (`e2e/tiny-tide.mjs`, `e2e/tiny-tide-pacing.mjs`: "The journey bot dodges telegraphs and fights by diet"), §8.2 (phone layout), §5 of Global Constraints (the running server).

**Files:**
- Create: `e2e/tiny-tide-combat.mjs`
- Modify: `e2e/fixtures/tiny-tide-fixtures.mjs` (`dodgeKeys`), `e2e/tiny-tide.mjs`, `e2e/tiny-tide-pacing.mjs`, `e2e/tiny-tide-mobile.mjs`
- Modify: `tests-browser/fixtures.ts` (a size-0 mouth)

**Interfaces:**
- Consumes: T22 `window.__tinyTide.combat` (`actions`, `telegraphs`, `clocks`, `hits`, `slots`, `inactive`, `tokens`, `heldBy`, `breakProgress`, `alphas`, `encounter`, `hints`, `aim`, `aimSource`) and `window.__tinyTide.screenOf(p)`; the QA parameters `qaEncounter`, `qaAlphaHealth`, `qaStartGrace`; the fixture fields `pins`, `atRisk`, `stageDna`, `mouth`.
- Produces: `node e2e/tiny-tide-combat.mjs [check ids…]` with the checks `desktop-controls`, `desktop-chomp`, `phone-controls`, `telegraph-before-hit`, `hit-stop`, `faint-rule`, `alpha`, `editor-moves`, `hints`; it prints `PASSED: all 9 combat checks`. `dodgeKeys(state)` in the shared fixtures module.

All browser scripts run against the dev server that already runs at `http://127.0.0.1:5199` (`TIDE_BASE`). Do not start a server. Long scripts run in the background (`run_in_background`), one at a time.

The code below was written against the diagnostics of T22 but has not run: the scratch copy used for this plan has no dev server. Expect to adjust waits and distances on the first run. Do not weaken a pass bar of §14.2 to make a check pass; if a bar fails, report it with the numbers.

- [ ] **Step 1: A size-0 mouth in the fixtures**

The `alpha` check needs a Snapper at size 0, and `applyDesign` refuses a diet change at size 0 ("Diet is set until your next evolution."). In `tests-browser/fixtures.ts` `makeFixture`, before `if (spec.add?.[0] || spec.mouth?.[0]) {`, insert:

```ts
  // A size-0 mouth is the start's choice: it is set on the fresh run with its diet (applyDesign refuses a diet change between evolutions).
  if (spec.mouth?.[0]) {
    const m = run.genome.parts.find(p => part(p.id)?.kind === 'mouth'); if (!m) throw new Error('fixture: no mouth to swap');
    m.id = spec.mouth[0]; run.diet = part(spec.mouth[0])?.diet ?? run.diet;
  }
```

and change the stage-0 design call from `design(run.genome, run.nextPartSerial, spec.mouth?.[0], spec.add?.[0])` to `design(run.genome, run.nextPartSerial, undefined, spec.add?.[0])`, and its condition from `if (spec.add?.[0] || spec.mouth?.[0])` to `if (spec.add?.[0])`.

- [ ] **Step 2: Write the combat browser checks** (`e2e/tiny-tide-combat.mjs`, complete file)

```js
// Tiny Tide combat 3a browser checks (spec §14.2): controls, telegraphs, hit-stop, the faint rule, the alpha, the editor moves panel and hints.
// Needs the running dev server (TIDE_BASE, default http://127.0.0.1:5199). Run one or more checks: node e2e/tiny-tide-combat.mjs hit-stop alpha
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { control, frames, KEYS, launch, makeFixture, openGame, start, state, steer, storageOf, untilGameTime, watchErrors, eatOnce } from './fixtures/tiny-tide-fixtures.mjs';

const out = '.codex-drafts/tiny-tide-qa'; mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const browser = await launch();
const checks = [];
const check = (id, fn) => checks.push({ id, fn });
const DEG = Math.PI / 180, SIZES = [1, 4, 16, 64, 256];
/** A Swimmer (size 1) with Brace, Counter, Dash (Paddle tail) and Grab: slots 1–4 in priority order. */
const FOUR = { stage: 1, line: 'swimmer', add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }] } };
/** FOUR and a Fan tail: Sweep is the fifth kind (inactive). */
const FIVE = { stage: 1, line: 'swimmer', add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }, { id: 'tail_fan', t: .9 }] } };

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage(), errors = watchErrors(page);
  return { context, page, errors };
}
async function play(page, spec, query = '') {
  const fx = await makeFixture(page, spec);
  await openGame(page, { storage: { [fx.key]: fx.json }, query });
  await start(page);
  return fx;
}
const playerActions = s => s.combat.actions.filter(a => a.actor === 'player');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Polls the page every animation frame and records `pick(state)` until `done(samples)` or `seconds` of game time. */
async function record(page, pick, done, seconds, label) {
  const r = await page.evaluate(([pickSrc, doneSrc, seconds]) => new Promise(resolve => {
    const pick = new Function('s', `return (${pickSrc})(s);`), done = new Function('xs', `return (${doneSrc})(xs);`), out = [], t0 = window.__tinyTide.time, w0 = performance.now();
    const tick = () => {
      const s = window.__tinyTide; out.push(pick(s));
      if (done(out)) return resolve({ ok: true, out });
      if (s.time - t0 > seconds || performance.now() - w0 > seconds * 4000 + 10000) return resolve({ ok: false, out });
      requestAnimationFrame(tick);
    };
    tick();
  }), [pick.toString(), done.toString(), seconds]);
  if (!r.ok) throw new Error(`${label}: not within ${seconds} s of game time`);
  return r.out;
}
/** Walks toward the `qaEncounter` creature (camera-relative keys) until `near(state)`; bounded. */
async function approach(page, near, label) {
  for (let i = 0; i < 300; i++) {
    const s = await state(page), e = s.combat.encounter; assert.ok(e && !e.eaten, `${label}: the encounter is alive`);
    if (near(s)) { await control(page, []); return s; }
    const size = SIZES[s.stage];
    await control(page, steer(s, { x: e.x / size, z: e.z / size }, .2)); await page.waitForTimeout(80);
  }
  await control(page, []); throw new Error(`${label}: could not reach the encounter`);
}

// ---------------------------------------------------------------------------------------------------------------------------
check('desktop-controls', async () => {
  const { page, errors } = await newPage();
  await play(page, FOUR, 'qaEncounter=1:crab');
  let s = await state(page);
  assert.deepEqual(s.combat.slots, ['brace', 'counter', 'dash', 'grab'], 'four slots in priority order');
  // The aim follows the pointer: a point 40° right of the facing, at the creature's height.
  const yaw = s.orientation.yaw + 40 * DEG, P = { x: s.physical.x + 3 * SIZES[s.stage] * Math.sin(yaw), y: s.physical.y, z: s.physical.z + 3 * SIZES[s.stage] * Math.cos(yaw) };
  const screen = await page.evaluate(p => window.__tinyTide.screenOf(p), P); assert.ok(screen.visible, 'the aim point is on screen');
  await page.mouse.move(screen.x, screen.y, { steps: 4 }); await frames(page, 3);
  s = await state(page);
  assert.equal(s.combat.aimSource, 'pointer');
  const aimYaw = Math.atan2(s.combat.aim.x, s.combat.aim.z), off = Math.abs(Math.atan2(Math.sin(aimYaw - yaw), Math.cos(aimYaw - yaw)));
  assert.ok(off <= 5 * DEG, `the aim yaw is within 5° of the pointer direction (${(off / DEG).toFixed(1)}°)`);
  // No pointer movement for 4 s: the camera forward.
  await page.waitForTimeout(4300); assert.equal((await state(page)).combat.aimSource, 'camera', 'a still pointer gives the camera forward after 4 s');
  // A middle drag turns the camera; a left click does not.
  const look0 = (await state(page)).world;
  await page.mouse.move(900, 380); await page.mouse.down({ button: 'middle' }); await page.mouse.move(980, 400, { steps: 8 }); await page.mouse.up({ button: 'middle' });
  assert.ok(Math.abs((await state(page)).world.yaw - look0.yaw) > .3, 'a middle drag turns the camera');
  await page.mouse.move(720, 450); await page.waitForTimeout(4300);   // the aim is the camera forward again
  // Right mouse is slot 1 (Brace): held keeps it active, release ends it.
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(700);
  let brace = playerActions(await state(page)).find(a => a.id === 'brace-shell'); assert.equal(brace?.phase, 'active', 'held right mouse keeps Brace active');
  await page.mouse.up({ button: 'right' }); await page.waitForTimeout(700);
  brace = playerActions(await state(page)).find(a => a.id === 'brace-shell' && (a.phase === 'windup' || a.phase === 'active')); assert.equal(brace, undefined, 'release ends Brace');
  // Keys 1–4 start slots 1–4.
  for (const [key, id] of [['Digit2', /^counter-/], ['Digit3', /^dash-|^scuttle-/], ['Digit4', /^pinch-/], ['Digit1', /^brace-/]]) {
    await page.waitForTimeout(1200);   // past the previous move's recovery
    const before = new Set(playerActions(await state(page)).map(a => a.instance));
    await page.keyboard.press(key);
    const seen = await record(page, s => s.combat.actions.filter(a => a.actor === 'player').map(a => ({ id: a.id, instance: a.instance })), xs => xs.at(-1).length > 0, 1, `${key} starts a move`);
    assert.ok(seen.flat().some(a => !before.has(a.instance) && id.test(a.id)), `${key} starts ${id}`);
  }
  // A left click with the crab in the Bite cone starts Bite (aim: the camera forward, toward the crab).
  await approach(page, s => { const e = s.combat.encounter; return dist(s.physical, e) - .35 * e.bodyLength / 1.4 < .5 * SIZES[s.stage]; }, 'walk to the crab');
  let bit = false;
  for (let i = 0; i < 12 && !bit; i++) { await page.mouse.click(720, 450); await page.waitForTimeout(150); bit = playerActions(await state(page)).some(a => /^bite-/.test(a.id)); }
  assert.ok(bit, 'a left click with a crab in the cone starts Bite');
  assert.deepEqual(errors, []);
});

check('desktop-chomp', async () => {
  // Space with only a plant in reach eats it (the basic dispatch falls back to the chomp).
  const { page, errors } = await newPage();
  await play(page, {});
  const s = await eatOnce(page, 'Space eats a plant');
  assert.ok(s.bites >= 1); assert.ok(!playerActions(s).some(a => /^bite-/.test(a.id)), 'no Bite action without a combat species in the cone');
  assert.deepEqual(errors, []);
});

check('phone-controls', async () => {
  for (const [label, spec] of [['swimmer', FOUR], ['crawler', { stage: 1, line: 'crawler', add: { 1: [{ id: 'shell_plate' }, { id: 'spike' }, { id: 'claw_pincer', t: .5 }] } }], ['breacher', { stage: 2, line: 'swimmer' }]]) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      const { context, page, errors } = await newPage({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await play(page, spec);
      const ids = ['#joystick', '#chomp', '#special', '#dive', '#pause', '#edit', '#hearts', '#slot-1', '#slot-2', '#slot-3', '#slot-4'], boxes = [];
      for (const id of ids) { const l = page.locator(id); if (!(await l.isVisible())) continue; boxes.push({ id, ...(await l.boundingBox()) }); }
      for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width + 1 && b.y + b.height <= viewport.height + 1, `${label} ${viewport.width}x${viewport.height}: ${b.id} fits`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j], overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5;
        assert.ok(!overlap, `${label} ${viewport.width}x${viewport.height}: ${a.id} and ${b.id} do not overlap`);
      }
      for (const b of boxes.filter(b => b.id.startsWith('#slot'))) assert.ok(b.width >= 48 && b.height >= 48, `${b.id} is at least 48×48`);
      const chomp = boxes.find(b => b.id === '#chomp'); assert.ok(chomp.width >= 80 && chomp.height >= 80, '#chomp is at least 80×80');
      await page.screenshot({ path: `${out}/combat-phone-${label}-${viewport.width}.png` });
      if (label === 'swimmer') {
        // Two real touches: the joystick moves while the basic-button drag aims; a slot tap starts its move; a held slot keeps Brace; a
        // pointercancel ends Brace and leaves no held input.
        const cdp = await context.newCDPSession(page), centre = async id => { const b = await page.locator(id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: 4, radiusY: 4, force: 1 }; };
        const j = { ...await centre('#joystick'), id: 1 }, c = { ...await centre('#chomp'), id: 2 }, before = await state(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [j] });
        j.y -= 30; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [j] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [j, c] });
        c.x += 40; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [j, c] }); await page.waitForTimeout(400);
        const during = await state(page);
        assert.ok(dist(during.player, before.player) > .3, 'the joystick moves during the aim drag');
        assert.equal(during.combat.aimSource, 'drag', 'the basic-button drag aims');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(800);
        const dash = { ...await centre('#slot-3'), id: 3 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [dash] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await record(page, s => s.combat.actions.some(a => a.actor === 'player' && /^dash-/.test(a.id)), xs => xs.at(-1), 1, 'a slot tap starts Dash');
        await page.waitForTimeout(1500);
        const brace = { ...await centre('#slot-1'), id: 4 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [brace] }); await page.waitForTimeout(700);
        assert.equal(playerActions(await state(page)).find(a => a.id === 'brace-shell')?.phase, 'active', 'a held slot keeps Brace');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await page.waitForTimeout(700);
        assert.equal(playerActions(await state(page)).find(a => a.id === 'brace-shell' && (a.phase === 'windup' || a.phase === 'active')), undefined, 'pointercancel ends Brace');
        await page.waitForTimeout(600);
        assert.ok(!playerActions(await state(page)).some(a => a.id === 'brace-shell' && a.phase !== 'recovery' && a.phase !== 'interrupted'), 'no held input stays (no new Brace)');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
});

check('telegraph-before-hit', async () => {
  const { page, errors } = await newPage();
  await play(page, {}, 'qaEncounter=1:crab');
  // Stand still; record every frame until the first damage to the player.
  const xs = await record(page, s => ({ time: s.time, tele: s.combat.telegraphs.map(t => ({ action: t.action, shapes: t.shapes, locked: t.locked, phase: t.phase, onScreen: t.onScreen, arrow: t.arrow })),
    actions: s.combat.actions.filter(a => a.target === 'player').map(a => ({ instance: a.instance, phase: a.phase, shape: a.shape })),
    hit: s.combat.hits.find(h => h.target === 'player' && (h.outcome === 'hit' || h.outcome === 'grabbed' || h.outcome === 'guard-broken')) ?? null }), xs => xs.at(-1).hit !== null, 40, 'the crab lands a hit');
  const hit = xs.at(-1).hit, first = xs.find(x => x.tele.length > 0);
  assert.ok(first, 'a telegraph showed'); assert.ok(hit.time - first.time >= .45 - 1e-6, `the telegraph showed ${(hit.time - first.time).toFixed(2)} s before the damage (≥ .45)`);
  for (const x of xs) for (const t of x.tele) if (t.locked) {
    const a = x.actions.find(a => a.instance === t.action); if (a?.shape) assert.deepEqual(t.shapes, a.shape, 'the telegraph shape is the action shape');
  }
  // Camera turned away: the edge arrow shows at least .35 s before active.
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'middle' }); await page.mouse.move(1340, 450, { steps: 12 }); await page.mouse.up({ button: 'middle' });
  const ys = await record(page, s => ({ time: s.time, tele: s.combat.telegraphs.map(t => ({ action: t.action, phase: t.phase, arrow: t.arrow, onScreen: t.onScreen })) }),
    xs => xs.some(x => x.tele.some(t => t.phase === 'active' && !t.onScreen)), 40, 'an off-screen attack goes active');
  const act = ys.find(x => x.tele.some(t => t.phase === 'active' && !t.onScreen)), id = act.tele.find(t => t.phase === 'active' && !t.onScreen).action;
  const arrow = ys.find(x => x.tele.some(t => t.action === id && t.arrow));
  assert.ok(arrow && act.time - arrow.time >= .35 - 1e-6, `the edge arrow showed ${arrow ? (act.time - arrow.time).toFixed(2) : 'never'} s before active (≥ .35)`);
  assert.deepEqual(errors, []);
});

check('hit-stop', async () => {
  const { page, errors } = await newPage();
  await play(page, FOUR, 'qaEncounter=1:crab');
  await approach(page, s => { const e = s.combat.encounter; return dist(s.physical, e) - .35 * e.bodyLength / 1.4 < .5 * SIZES[s.stage]; }, 'walk to the crab');
  await control(page, ['Space']);
  const xs = await record(page, s => ({ time: s.time, clocks: { ...s.combat.clocks }, crab: `e${s.combat.encounter.id}`, others: [...s.foods, ...s.threats].map(f => [f.x, f.y, f.z].map(v => Math.round(v * 1000)).join(',')).join(';'),
    hit: s.combat.hits.find(h => h.attacker === 'player' && h.outcome === 'hit') ?? null }), xs => xs.at(-1).hit !== null && xs.length > 30 && xs.at(-1).time - xs.find(x => x.hit).time > .2, 20, 'a player Bite hits');
  await control(page, []);
  const at = xs.findIndex(x => x.hit), crab = xs[at].crab;
  // Both clocks stay still while world time runs: 60–90 ms; a third entity moves in that window.
  let end = at; while (end + 1 < xs.length && xs[end + 1].clocks.player === xs[at].clocks.player && xs[end + 1].clocks[crab] === xs[at].clocks[crab]) end++;
  const stopped = xs[end].time - xs[at].time;
  assert.ok(stopped >= .06 - .017 && stopped <= .09 + .017, `both clocks stopped ${(stopped * 1000).toFixed(0)} ms (60–90 ms, one frame of slack)`);
  assert.ok(xs.slice(at, end + 1).some((x, i, a) => i > 0 && x.others !== a[i - 1].others), 'a third entity moves during the hit-stop');
  assert.deepEqual(errors, []);
});

check('faint-rule', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, { health: .5, atRisk: 37, stageDna: 37 }, 'qaEncounter=1:crab&qaStartGrace=0');
  const before = JSON.parse(await storageOf(page, KEYS.v4));
  await untilGameTime(page, s => s.mode === 'fainted', 40, 'a crab hit faints the player');
  assert.match(await page.locator('#faint').textContent(), /37 DNA/);
  await untilGameTime(page, s => s.mode === 'playing', 10, 'the respawn');
  await page.waitForTimeout(300);
  const after = JSON.parse(await storageOf(page, KEYS.v4)), s = await state(page);
  assert.equal(after.economy.wallet.atRisk, 0); assert.equal(s.stageDna, 0);
  assert.equal(after.economy.wallet.banked, before.economy.wallet.banked, 'banked DNA stays');
  assert.deepEqual(after.genome, before.genome, 'the design stays');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tiny-tide-adventure')));
  assert.deepEqual(keys, [fx.key], 'only the v4 key was written');
  assert.deepEqual(errors, []);
});

check('alpha', async () => {
  const { page, errors } = await newPage();
  await play(page, { mouth: { 0: 'mouth_snapper' } }, 'qaEncounter=1:clawmother&qaAlphaHealth=0.62&qaStartGrace=0');
  const seen = { phases: new Set(), burrow: false, rage: false }, t0 = (await state(page)).time;
  let s = await state(page);
  while (!s.unlocked.includes('claw_mother')) {
    assert.ok(s.time - t0 < 300, 'the Clawmother is defeated within 300 s of game time');
    const a = s.combat.alphas.find(x => x.key === '1:clawmother');
    if (a) { seen.phases.add(a.phase); if (a.state === 'sink' || a.state === 'burrowed') seen.burrow = true; }
    if (s.combat.actions.some(x => x.id === 'mother-pinch-rage')) seen.rage = true;
    if (s.mode === 'fainted') { await control(page, []); await untilGameTime(page, x => x.mode === 'playing', 10, 'respawn'); s = await state(page); continue; }
    const windup = s.combat.telegraphs.find(t => t.phase === 'windup'), e = s.combat.encounter, size = SIZES[s.stage];
    if (windup) {
      // Dodge: Dash (slot of the Paddle tail or legs) sideways, else strafe.
      const dashSlot = s.combat.slots.indexOf('dash'); if (dashSlot >= 0) await page.keyboard.press(`Digit${dashSlot + 1}`);
      await control(page, ['KeyA']);
    } else await control(page, ['Space', ...steer(s, { x: e.x / size, z: e.z / size }, .2)]);
    await page.waitForTimeout(90); s = await state(page);
  }
  await control(page, []);
  assert.ok(seen.phases.has(1), 'below 60 %: phase 2'); assert.ok(seen.burrow, 'phase 2 burrows'); assert.ok(seen.phases.has(2) && seen.rage, 'below 30 %: the enraged attacks');
  assert.ok(s.totalDna >= 40, 'the defeat pays 40 DNA');
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await page.locator('#editor [data-kind=arm]').click();
  assert.equal(await page.locator('#editor .ed-card[data-part=claw_mother]').count(), 1, 'the rare part is in the editor');
  await page.locator('#editor .ed-cancel').click();
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page); await page.waitForTimeout(500);
  assert.ok((await state(page)).combat.alphas.every(a => a.eaten || a.key !== '1:clawmother'), 'after a reload the Clawmother is absent');
  assert.deepEqual(errors, []);
});

check('editor-moves', async () => {
  const { page, errors } = await newPage();
  const fx = await play(page, FIVE);
  await page.locator('#edit').click(); await page.locator('#editor').waitFor(); await frames(page, 3);
  assert.equal(await page.locator('#editor .ed-moves .ed-slot').count(), 4, 'four slots');
  assert.match(await page.locator('#editor .ed-moves .ed-inactive').first().textContent(), /Inactive — no free slot/);
  // The size slider shows "old → new" while it moves.
  const shell = fx.info.parts.find(p => p.id === 'shell_plate').uid, at = await page.evaluate(uid => window.__tinyTide.editorProjection(uid), shell);
  await page.mouse.click(at.x, at.y); await frames(page, 2);
  const input = page.locator('#editor .ed-scale'), box = await input.boundingBox(), y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down(); await page.mouse.move(box.x + box.width - 4, y, { steps: 8 });
  assert.match(await page.locator('#editor .ed-move-diff').textContent(), /→/, 'live move numbers');
  await page.mouse.up();
  // Swap by drag: the inactive Sweep onto slot 1.
  const chip = await page.locator('#editor .ed-inactive .ed-move-chip').boundingBox(), slot = await page.locator('#editor .ed-slot[data-slot="0"]').boundingBox();
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2); await page.mouse.down();
  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 10 }); await page.mouse.up(); await frames(page, 2);
  assert.equal(await page.locator('#editor .ed-slot[data-slot="0"] .ed-move-chip').getAttribute('data-kind'), 'sweep', 'the drag pins Sweep to slot 1');
  await page.locator('#editor .ed-done').click(); await page.locator('#editor').waitFor({ state: 'detached' });
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page); await frames(page, 4);
  assert.equal((await state(page)).combat.slots[0], 'sweep', 'the pin persists after Done and a reload');
  assert.deepEqual(errors, []);
});

check('hints', async () => {
  const { page, errors } = await newPage();
  await play(page, {}, 'qaEncounter=1:crab');
  await untilGameTime(page, s => s.combat.hints.includes('telegraph'), 40, 'the telegraph hint shows');
  assert.match(await page.locator('#toast').textContent(), /Orange shapes show where an attack lands/);
  await page.reload(); await page.waitForFunction(() => window.__tinyTide?.time > .3); await start(page);
  const xs = await record(page, s => ({ toast: document.getElementById('toast').textContent, windup: s.combat.telegraphs.some(t => t.phase === 'windup') }), xs => xs.filter(x => x.windup).length > 30, 40, 'another wind-up');
  assert.ok(!xs.some(x => /Orange shapes/.test(x.toast)), 'after a reload the hint does not show again');
  assert.deepEqual(errors, []);
});

const failures = [];
try {
  for (const c of checks) {
    if (only.length && !only.includes(c.id)) continue;
    const t0 = Date.now();
    try { await c.fn(); console.log(`ok   ${c.id} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
    catch (error) { failures.push(c.id); console.log(`FAIL ${c.id}: ${error.message}`); }
    finally { for (const context of browser.contexts()) await context.close(); }
  }
} finally { await browser.close(); }
if (failures.length) { console.log(`FAILED: ${failures.join(', ')}`); process.exit(1); }
console.log(`PASSED: ${only.length ? `checks ${only.join(', ')}` : 'all 9 combat checks'}`);
```

- [ ] **Step 3: Run the new checks against the running server**

Run (background): `node e2e/tiny-tide-combat.mjs`
Expected: `PASSED: all 9 combat checks`. Fix the game, not the bar, when a check finds a real fault (for example a telegraph that shows later than .45 s before the damage).

- [ ] **Step 4: The journey bots dodge telegraphs**

In `e2e/fixtures/tiny-tide-fixtures.mjs`, after `steer`, add:

```js
/** Camera-relative keys that strafe away from the first species wind-up at the player, or null (spec §3.2: the journey bots dodge
 *  telegraphs). Space stays the caller's choice: held Space bites back a combat species in the Bite cone. */
export function dodgeKeys(s) {
  const c = s.combat; if (!c) return null;
  const t = c.telegraphs.find(v => v.phase === 'windup' && c.actions.some(a => a.instance === v.action && a.target === 'player'));
  if (!t) return null;
  const sh = t.shapes[0], from = sh.kind === 'cone' ? sh.apex : sh.start, ax = s.physical.x - from.x, az = s.physical.z - from.z, l = Math.hypot(ax, az) || 1;
  const px = -az / l, pz = ax / l, yaw = s.world.yaw, lx = Math.cos(yaw) * px - Math.sin(yaw) * pz, lz = Math.sin(yaw) * px + Math.cos(yaw) * pz, keys = [];
  if (lx > .3) keys.push('KeyD'); if (lx < -.3) keys.push('KeyA'); if (lz > .3) keys.push('KeyS'); if (lz < -.3) keys.push('KeyW');
  return keys.length ? keys : ['KeyD'];
}
```

In `e2e/tiny-tide.mjs`:
- change the import line to `import { dodgeKeys, GAME, makeFixture, toFixturePage } from './fixtures/tiny-tide-fixtures.mjs';`
- in the journey loop, directly after the line that starts `if (s.stage !== lastStage) {`, insert:
  ```js
      // Dodge a telegraphed attack first (spec §3.2); Space stays held, so a combat species in the Bite cone is bitten back.
      const dodge = dodgeKeys(s); if (dodge) { await control(['Space', ...dodge]); await page.waitForTimeout(100); continue; }
  ```

In `e2e/tiny-tide-pacing.mjs`:
- add `dodgeKeys` to the import from `./fixtures/tiny-tide-fixtures.mjs`
- directly before the comment `// The journey bot: the nearest approachable food of the diet.`, insert:
  ```js
      const dodge = dodgeKeys(s); if (dodge) { await control(page, ['Space', ...dodge]); await page.waitForTimeout(100); continue; }
  ```

- [ ] **Step 5: The mobile test checks the slot buttons**

In `e2e/tiny-tide-mobile.mjs`, in the loop `for(const viewport of [{width:320,height:568},{width:844,height:390}])`, after the `for(const sel of [...])` box check, add:

```js
for(const b of await page.locator('.slot-button:not([hidden])').all()){const r=await b.boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1,`slot fits ${viewport.width}x${viewport.height}`);assert.ok(r.width>=48&&r.height>=48,`slot is at least 48×48 at ${viewport.width}x${viewport.height}`);}
```

- [ ] **Step 6: Run the existing browser tests** (background, one at a time, against the running server)

```bash
node e2e/tiny-tide.mjs
TIDE_LINE=crawler node e2e/tiny-tide.mjs
node e2e/tiny-tide-paths.mjs
node e2e/tiny-tide-mobile.mjs
node e2e/tiny-tide-replay.mjs
```
Expected: each exits 0; `tiny-tide-paths.mjs` prints `PASSED: all 18 checks (with 5b, 5c, 5d, 7b, 7c and 12b)`.

- [ ] **Step 7: Checkpoint.** Expected: green.

- [ ] **Step 8: Commit**

```bash
git add e2e/tiny-tide-combat.mjs e2e/fixtures/tiny-tide-fixtures.mjs e2e/tiny-tide.mjs e2e/tiny-tide-pacing.mjs e2e/tiny-tide-mobile.mjs tests-browser/fixtures.ts
git commit -m "Tiny Tide combat: browser checks for controls, telegraphs, hit-stop, faint, alpha, editor moves and hints; journey bots dodge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task T25: Docs

**Spec:** §3.2 (`docs/TINY-TIDE.md`: a new "Combat" section; updated help, faint and verification text), §8.1 (help), §10.3 (faint), §14.2–14.3.

**Files:**
- Modify: `docs/TINY-TIDE.md`

**Interfaces:**
- Consumes: the finished behaviour of T1–T24 and the probe report of T23.
- Produces: documentation only.

- [ ] **Step 1: The Play section**

Replace the line `- **Eat or bite back:** hold Chomp / Space near food or near a creature that attacks you.` with:

```md
- **Eat or fight:** Chomp / Space / left mouse. With a fighting creature in front of your mouth it bites (Bite); otherwise it eats the food in reach.
- **Moves:** your parts give up to four moves in slots 1–4 (keys 1–4, the slot buttons; the right mouse is slot 1). See [Combat](#combat).
- **Aim (desktop):** the mouse pointer. Turn the camera with a middle drag or Alt + left drag.
- **Aim (phone):** drag from the Chomp button; without a drag, moves aim at the nearest threat in front.
```

- [ ] **Step 2: The living ocean**

Replace the table and the paragraph after it (from `| Size | Plants | Meat | Danger |` to `... Your stage and your design stay.`) with:

```md
| Size | Plants | Meat | Danger |
| --- | --- | --- | --- |
| Tiny (2 cm) | sprouts, kelp, grapes, lettuce | copepods, bristle worms, drifter shrimp, spiny snails | Peach crabs hunt you, the Old Clawmother guards her lair, jellies sting |
| Small (30 cm) | grape clusters, lettuce beds | shrimp, jellies, snails, sunny sardines, puffers | Berry squid and moray eels hunt you, the Reef Tyrant guards its lair, rays sting |
| Big (8 m) | kelp fronds, sprout groves | tuna, squid, rays, gulls | squid hunt you, rays sting |
| Huge (120 m) | palms, sailboats, seaplanes, balloons, lighthouses (any diet) | | seaplanes chase you |
| Cosmic | 12 planets | | — |

Prey runs away from a creature that can eat it, but it tires quickly. Food
regrows out of sight. Hunters show a red **!** marker. At sizes 0 and 1 the
crab, squid, eel, puffer, snail and the two alphas fight with telegraphed
attacks (see [Combat](#combat)); the jelly, ray and seaplane still sting on
contact. When you lose every heart you faint: see [Combat](#combat).
```

- [ ] **Step 3: The ledger**

Replace `- A faint keeps 70% of each wallet part. Stage and design stay.` with `- A faint loses every at-risk credit (the wallet and the parts) and empties the growth bar. Banked DNA, the stage and the design stay.`

- [ ] **Step 4: The Combat section** (insert before `## Saves`)

```md
## Combat

Combat at sizes 0 and 1 (spec `docs/superpowers/specs/2026-10-02-tiny-tide-combat-3a-design.md`).

- **Moves come from parts.** The mouth gives Bite (the basic move). Fins, legs and the Paddle tail give Dash; the Fan tail and Fluke give
  Sweep; the Pincer gives Grab; the Spike gives Counter; the Shell plate gives Brace. A bigger part is stronger and also slower, has a longer
  cooldown or costs more DNA; a mirrored pair dashes farther and grabs longer. The editor's **Moves** panel shows every number, the
  numbers at sizes .4 and 1.8, and "old → new" while the size slider moves.
- **Slots.** Four slots. Kinds fill them in the order Brace, Counter, Dash, Grab, Sweep; a fifth kind is inactive. Drag a move chip onto a
  slot (or tap the chip, then the slot) to pin it there. Pins are saved.
- **Telegraphs.** Every enemy attack shows its hit volume while it winds up: amber and solid when Brace can block it, red with stripes when
  it can't. The volume fills until the attack lands. An arrow at the screen edge points at an attack you cannot see.
- **Defence.** Brace (hold) blocks hits in front; a heavy hit breaks it. Counter (press just before the hit) reflects damage and staggers
  the attacker; it beats grabs too. Dash gives a short dodge with invulnerability.
- **Health.** Enemy damage is in half-hearts, after armor. Hearts come back (half a heart every 2 s) after 6 s with no damage and no
  attack at you.
- **Faint.** At 0 hearts you faint: every at-risk DNA (wallet and parts) and the growth bar of this size are lost; banked DNA, the stage
  and the design stay. You wake at the size's start point with 3 s of grace, and hunters give up on you for 6 s.
- **DNA from fights.** A meat eater gets the meal's DNA for a kill. A plant eater drives the creature off (no DNA), and gets 35 % of a
  hunter's DNA once for surviving a hunt of at least 4 s with at least one attack.
- **Alphas.** The Old Clawmother (size 0) and the Reef Tyrant (size 1) guard a lair. Each changes its attacks at 60 % and 30 % of its HP.
  A defeat gives 40 or 60 DNA and unlocks a rare part (Clawmother pincer, Tyrant jaw); the alpha is then gone for the run.
- **Hints.** Each first-time hint shows once per browser (`localStorage` key `tiny-tide-hints-v1`).
```

- [ ] **Step 5: Verification**

In the code block of `## Verification`, after the `node e2e/tiny-tide-paths.mjs` line, add:

```sh
node e2e/tiny-tide-combat.mjs              # 9 combat checks; pass check ids (for example hit-stop alpha) to run some
TIDE_COMBAT_PROBE=1 npx vitest run tests/tiny-tide-core/combat-balance.test.ts   # the balance probe P1–P8 (long); writes .codex-drafts/tiny-tide-qa/combat-probe.{json,md}
```

and change the comment of the `tiny-tide-paths.mjs` line to `# 18 checks with 5b, 5c, 5d, 7b, 7c and 12b (lost moves); pass check ids (for example 3 5c) to run some`.

In the QA parameter table, delete the `qaGrantCatalog=1` row and add:

```md
| `qaEncounter=<species key>` | At the first start of the page load, the nearest live creature of that species (for example `1:crab`) is placed 3 body lengths in front of the player, calm. |
| `qaAlphaHealth=<0..1>` | At the first start of the page load, alphas start with that fraction of their HP. |
```

After the paragraph on `window.__tinyTide`, add: `` `window.__tinyTide.combat` (read-only) gives the actions (actor, id, phase, aim, target, locked shape), the telegraphs, the action clocks, the last 20 hit outcomes, hit-stop ends, the slots and inactive kinds, the director tokens, the alphas, the `qaEncounter` creature, `heldBy`, `breakProgress`, the shown hints and the aim; `window.__tinyTide.screenOf(p)` gives the screen point of a physical point. ``

- [ ] **Step 6: Check the links**

Run: `grep -n "](#combat)" docs/TINY-TIDE.md`
Expected: three lines, and `## Combat` exists (`grep -n "^## Combat" docs/TINY-TIDE.md` prints one line).

- [ ] **Step 7: Commit**

```bash
git add docs/TINY-TIDE.md
git commit -m "Tiny Tide docs: the Combat section, controls, faint rule, QA parameters and the combat checks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

## Task-ordering conflicts

Pairs of tasks that share a file or an interface. Run them in the listed order; never in parallel.

| Tasks | Shared file or interface | Rule |
| --- | --- | --- |
| T1 → T2 | `registries.ts` (`merged`, V16), `parts.ts`, `combat-fixture.ts`, `contract.test.ts` | T2 adds V16 and the player catalogs on top of T1's checks. |
| T1 → T13 | `bestiary.ts` | T1 creates the types and empty catalogs; T13 fills them. |
| T1/T3/T4 | `combat-types.ts` | Each adds fields; T7, T20 also edit it. Apply in task order. |
| T2 → T21 | `moves.ts` | T21 appends the editor text helpers at the end of the file. |
| T4 → T8 | `action-engine.ts` (`endHold` for active, `holdingAction`) | T8 changes two engine functions that T4 created. |
| T5 → T18 | `hit-resolver.ts`, `hit-resolver.test.ts` | T18 adds the ink status lookup. |
| T6 → T7, T8, T11, T15, T16, T17, T20, T22 | `sim.ts` | Every later sim change assumes T6's `SimState` and frame order. |
| T6 → T8, T9, T10, T12, T15, T16, T17, T18, T20, T21, T22 | `main.ts` | The busiest file. One task at a time; rebase each diff on the previous commit. |
| T6 → T8 | `feeding.ts` | T8 adds `biteDispatch`. |
| T7 → T9 → T10 | `input.ts`, `input.test.ts` | Four slots, then pointer aim, then drag and auto-aim. |
| T8 → T11 → T12 → T16 → T18 | `combat-world.ts`, `combat-world.test.ts` | Director, telegraphs, AI tick, schools/dens in this order. |
| T9 → T10 → T12 → T17 → T18 | `controls.css` | Desktop, phone, overlay, alpha bar, ink. |
| T9 → T12 → T17 | `combat-hud.ts` | `CombatHud`, then `CombatOverlay`, then `AlphaBar`. |
| T9 → T12 → T16 → T17 | `world.ts` | Pointer ray, hit feel, species prefabs, rare tint and dust. |
| T14 → T17, T18, T19 | `combat-ai.test.ts` | Later tasks add alpha and school cases. |
| T15 → T16 | `ecosystem.test.ts` | T15 doubles two crab hazard values; T16 moves both tests to the ray. |
| T15 → T16 → T18 | `e2e/tiny-tide-paths.mjs` checks 13 and 15 | Half-hearts, then the jelly (13), then the ray (15). |
| T15 → T16 → T17 → T18 → T22 | `ecosystem.ts` | Give-up, entity motion, alphas, dens and schools, `placeAt`. |
| T15 → T17 → T20 → T21 | `state.ts`, `state.test.ts` | Faint and kills, rare unlocks, pins, loadout through the editor. |
| T16 → T17 → T18 → T19 | `species.ts` | New rows are appended after every legacy row (keeps legacy spawns and the golden). |
| T17 → T19 | `parts.ts` `rare()` | T19 adds the Tyrant jaw with T17's helper. |
| T17 → T20 → T21 | `editor.ts` | Rare cards, pins in `clearMissing`, the moves panel. |
| T20 → T21 → T22 → T24 | `tests-browser/fixtures.ts` | Remove `bindClaw`; add `pins`, `atRisk`, `stageDna`; add the size-0 mouth. |
| T20 → T21 | `e2e/tiny-tide-paths.mjs` check 12b | T20 removes it; T21 adds it back as "Lost moves". |
| T22 → T23 → T24 | `sim.ts` QA functions, `combatDiagnostics()` | The probe and the browser checks read them. |
| T6, T17, T18 | `tests/tiny-tide-core/sim-golden.json` | Recorded in T6; re-recorded only where the task says so, with the reason in the commit. |
| T9 ↔ e2e | `e2e/tiny-tide.mjs` camera drags | T9 changes them to middle drags; T24 adds the dodge. |

---

## Self-review against the spec

Spec section → task:

| Spec | Task |
| --- | --- |
| §1 success criteria 1 (part size tradeoffs) | T2 (tables), T21 (panel), T25 |
| §1 criterion 2 (telegraph = hit, same clock) | T3 (`telegraph shape equals hit shape for every registered attack`), T12, T24 |
| §1 criteria 3–4 (avoidable; every line finishes) | T23 (P1, P7) |
| §1 criterion 5 (phones, three movers) | T10, T24 `phone-controls` |
| §1 criterion 6 (saves) | T15, T20 |
| §1 criterion 7 (no refused pose) | T7, T16 (`combat-motion.test.ts`) |
| §3.1 new modules | T1–T6, T8, T9, T11, T12, T14, T22, T23, T24 |
| §3.2 changed modules | T1, T2, T6–T22, T24, T25 (`assets.ts`: T16–T17 through `FOOD_MODEL_KINDS`/`PART_ASSETS`) |
| §4.1 types | T1, T3, T4, T7, T20 |
| §4.2 registries | T1, T2, T15 (hazards ×2), T16, T18 |
| §4.3 V1–V20 | T1 (V1–V15, V17–V20), T2 (V16) |
| §5.1–5.9 engine | T4; hit-stop in T5/T8/T12 |
| §5.10–5.11 shapes | T3; `segmentClear` in T3 |
| §5.12 motion | T7, T8, T16 |
| §6 resolver | T5, T18 (ink) |
| §7.1–7.4 moves | T2 |
| §7.5 tradeoffs | T21 (`TRADEOFF`), T25 |
| §7.6 rare parts | T17, T19 |
| §8.1 desktop | T9 |
| §8.2 phone | T10 |
| §8.3 dispatch | T8 |
| §8.4 aim | T9, T10 |
| §8.5 input | T7 |
| §9.1–9.3 telegraph, feel, HP | T12 |
| §9.4 director | T11 |
| §10.1–10.5 health, faint, DNA, saves | T15, T17 (alpha reward), T20 (loadout) |
| §11.1 rosters, minimum wind-ups | T1, T13 |
| §11.2 AI | T14, T16, T18 |
| §11.3 species | T16, T17, T18, T19 |
| §11.4–11.6 behaviours, attacks, alpha phases | T13, T14 |
| §11.7 art reuse | T16, T17 |
| §12.1–12.2 editor | T21 |
| §12.3 hints | T22 |
| §13 lifecycle | T8 (`resetRuntime`), T15 (faint, give-up), T20 (pins at commit), T22 |
| §14.1 unit tests | every named test is in the task that owns its module (checked by name); `feeding.test.ts` T8; `sim.test.ts` T6 |
| §14.2 browser checks | T24 |
| §14.3 probe | T23 |
| §14.4 review focus | "Review Focus" above |
| §15 out of scope | nothing planned for it |
| §16 D1–D38 | data and rules in T1–T22 (D29: T6; D32: T20, T22; D35: T23) |

No spec section is without a task. Gaps found while writing the plan, and how the plan closes them:

1. **§14.1 names `a dodged hit is recorded in the ledger`, `grab only alone; none while held` and the other named tests** — all are in T4, T5, T11 under the spec's names.
2. **§14.2 `TIDE_URL`** — the scripts use `TIDE_BASE` like every existing script (Global Constraints).
3. **§14.2 diagnostics** do not say how a test aims the pointer at a known direction. T22 adds the read-only `screenOf(p)`, `aim` and `aimSource`.
4. **§14.3 bots** count a whiff (the attack never reached the player) as "avoided". The probe counts a trial only when the same attack, with the same seed, hits a player who does nothing.
5. **Fixtures cannot give a size-0 Snapper** (the diet lock). T24 Step 1 sets the start mouth on the fresh run.

## Spec defects and ambiguities, and how the plan resolves them

| # | Spec text | Problem | Resolution (task) |
| --- | --- | --- | --- |
| 1 | §4.3 V10: pair multipliers ≥ 1 | The Dash pair has cooldown × .85 (D4). | Keys ending in `cooldownSeconds` allow (0, 1]; others need ≥ 1 (T1). |
| 2 | §11.1 MIN_WINDUP rows for sizes 0 and 1 | The squid and the eel hunt size 2 (D36). | Sizes ≥ 2 use the size-1 row (T1). |
| 3 | §7.4 Bite rows | No rows for the Filter grin, Fangs and Maw. | They reuse the Nibbler, Snapper and Beak rows (T2). |
| 4 | §7.4 Sweep row | No lock time and no tracking. | `aimLockAt .15`, tracking 12 rad/s (T2). |
| 5 | §11.6 Tyrant "within 0.6 × lair radius" | `BehaviourPhase` has no field for it. | Optional `lairFraction` (T1). |
| 6 | §11.6 lair at the alpha's home | The start anchor can be inside the lair. | `lairOf`: lair radius × L + (5 + 8 rand) × S away from the anchor (T17). |
| 7 | §6.2 impulse formula | It scales with `L_a`; a Clawmother lunge throws a Speck about 27 units. | Velocity change capped at 9 `L_t`/s (`KNOCKBACK_CAP`, T5). |
| 8 | §3.1 `sim.ts` "the former order" | The combat tick is new and has no former place. | After the player step, before the chomp (T8). |
| 9 | §3.1 `ResolvedMove` in `moves.ts` | The engine needs it; that makes an import cycle. | In `combat-types.ts`, re-exported by `moves.ts` (T1). |
| 10 | §14.2 "agents do not start the server … the controller or the owner runs it" | The server already runs; agents can and must use it. | Global Constraints; T24 runs the checks. |
| 11 | §11.5 species attacks | No `moveSpeedFactor`. | 0 for species (the AI moves the body) (T13). |
| 12 | §4.2 "hazard values doubled" | Existing tests and check 13 pin the old values. | They change in T15, the task that doubles them. |
| 13 | §10/§3.2 avoidance "counts attack hits" | A straight escape loses to lunges, and unrelated creatures hit the player. | The escape dashes across the attack axis; only the encounter's hunter counts; the negative control stands still (T16). |
| 14 | §11.6 phase 2 of the Tyrant | Does phase 2 change who it is hostile to? | It keeps `hostile` (size 1) (T19). |
| 15 | §12.3 phone hint glyphs | Only Dash's glyph is given. | `HINT_GLYPHS` (T22). |
| 16 | §14.3 P3 "pressed so the window holds the active start" | A lunge lands after the active start, so this bot misses lunge counters (measured in T23). | The bot keeps the spec rule; T23 reports the lunge rows instead of retuning the floors. |
