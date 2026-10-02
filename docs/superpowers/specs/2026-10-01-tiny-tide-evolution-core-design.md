# Tiny Tide evolution core — design

Date: 2026-10-01
Status: revision 4 (with the round-4 precision edits made while writing Plan B), after three rounds of adversarial review (technical, gameplay,
combat). Round-3 ids (T-R3-xx, G3-x, C-R3-xx) are cited where answered. Reviews: `.codex-drafts/reviews/` (not tracked). Round-2 finding ids
(for example `T-R2-04`, `G-R5`, `C-R2-07`) are cited where this revision
answers them.
Builds on: `docs/TINY-TIDE-EVOLUTION.md` (the creature editor update)

## 1. Purpose

The creature editor works, but part choices do not change how the game plays,
and no choice excludes another. This update adds real tradeoffs. The main goal
is replay value: each game takes a different path. A second goal is depth
inside one game.

This is sub-project 1 of 4:

1. **Evolution core** (this document): the body-plan tree, lineage commitments,
   habitats and movement, body and part rules, the evolve flow, editor changes,
   the DNA ledger, and the full **combat data contract** with the shared
   services it needs (environment queries, motion, recovery, rig pose, mounts,
   pursuit, hazards, input intents, lifecycle). No attacks or abilities.
2. **The coast**: one shared island that rises out of the sea at every size.
3. **Combat**: attacks, abilities, telegraphs, hit resolution, the ability UI
   and the new faint rule, built on the contract from sub-project 1.
4. **Paths and keystones**: the full tree and 2–3 keystones, including a
   planet-absorbing gloop that crosses space on tendrils instead of flying.

### Decisions from the owner (2026-10-01)

| Topic | Decision |
| --- | --- |
| Diet | Fixed at each evolution. In a normal edit, only a mouth with the same diet can replace the mouth. |
| Part size | Bigger parts give more stats, and also cost more DNA and can use more slots. |
| Lineage | Each size-1 line keeps at least one commitment through sizes 3 and 4. |
| Combat groundwork | The full contract is part of this sub-project. Combat behavior is not. |

### What stays

- The cozy tone, the editor, the five sizes, the in-place growth between sizes,
  the one persistent world and the planet ending.
- The current faint rule (keep 70% of each wallet part) stays until sub-project 3.

### Out of scope (noted for later)

- Meta-progression across runs (profile, discovered plans, creature
  collection): sub-project 4, separate storage key.
- Attack and ability content, the ability-slot UI, hit resolution, AI wind-ups
  and telegraph effects: sub-project 3. Their acceptance criteria are recorded
  in section 14 so they are not lost.
- Keystone mechanics (anchored movement, host planet, tendril graph):
  sub-project 4. Section 13 lists the extension seams that exist now.

### Success criteria

1. Two games on different lines differ in where you can go, how you move,
   what you eat efficiently, which parts fit, and the body shape. Each
   difference is data and a test checks it reaches gameplay.
2. Every evolution shows, before you choose: the playstyle payoff, the lasting
   sacrifice, where it leads, and what happens to your creature.
3. Every visible line can finish the game with every diet it can have.
4. Existing v1 and v2 saves load. The original creature is archived and can be
   viewed; the value of its parts is kept; changes are listed.
5. No service returns an illegal result as success: repair, recovery, motion
   and transactions return a valid result or an explicit failure.
6. The pacing study (section 12) runs and its numbers are reported to the
   owner. It is a diagnostic, not a pass/fail gate.

## 2. Body plans and lineages

```ts
type Medium = 'water' | 'air' | 'land' | 'burrow' | 'space';
type Region = 'head' | 'middle' | 'tail';
type Commitment = 'no-flight' | 'no-swim' | 'no-land' | 'seabed-bound' | 'no-legs';

interface BodyPlan {
  id; name; blurb; size: number; parents: readonly string[];
  line: string;                     // stable lineage tag
  habitat: string;                  // HabitatProfile id (section 3) — the only habitat source
  movement: string;                 // MovementProfile id (section 3) — the only movement source
  spine: { min; max; head: SegmentRule; middle: SegmentRule; tail: SegmentRule };
  regions: Record<Region, { kinds: readonly PartKind[]; slots: number }>;
  requiresKinds: readonly PartKind[];
  requiresCapabilities: readonly { stat: 'armor' | 'speed'; min: number; label: string }[]; // part stats only
  bans: readonly PartKind[];
  bonuses: Partial<Stats>;          // plan stats, added to part stats for gameplay
  foraging: readonly { habitat: string; dnaMultiplier: number }[]; // keyed by the food species' habitat profile
  physics: { massPerBodyLength: number; knockbackResistance: number };
  commits: readonly Commitment[];
  keystone?: { closesLines: readonly string[]; note: string };
  needs?: 'coast';
  feedingStrategy: 'bite';          // keystone seam (section 13)
}
```

`requiresCapabilities` exists once, on the plan. The combat field
`BodyPlanCombatFields` is `{ hullProfile: 'spine-capsules' }` only (C-R2-09).

### Commitments

`Run.commitments` is the union of `commits` on the path. A plan is eligible
only if it breaks no commitment, its line is not closed, and its `needs` is
met. Saves that break a commitment are invalid.

| Commitment | Forbids a plan whose |
| --- | --- |
| `no-flight` | habitat admits `air` and movement mode is `glide` or `fly` |
| `no-swim` | habitat admits `water` |
| `no-land` | habitat admits `land` |
| `seabed-bound` | habitat admits free water (`maxFloorGapBodyLengths: null`), or movement mode is `glide` or `fly` |
| `no-legs` | regions allow the `leg` kind |

Card text for a commitment comes only from this table (G-R3): "Never swims
freely or flies", "Can never swim again", "Can never fly", "Can never walk on
land", "Can never grow legs again".

### Effective stats (G-R2, T-R2-14)

`effectiveStats(genome, plan) = partStats(genome) + plan.bonuses`.
`derive(effective)` gives gameplay numbers. Maximum hearts =
`max(3, 6 + round(effective.health))`, so a negative bonus is a real cost.
Every gameplay, HUD and editor consumer uses `effectiveStats`; capability
requirements use `partStats` only.

### Sample tree

Every plan has data-level gains and costs. Numbers are in the plan data.

```
Speck (0)        seabed; baseline
├─ Swimmer (1)    line swimmer; free water; requires tail; commits no-legs
│   ├─ Darter (2)   speed ×1.15, accel 40, yaw 12; body radius ≤ .7; 4 middle / 4 tail slots
│   └─ Bulk (2)     hearts +2, knockback resistance .6, mass ×1.5; speed ×.9; wide middle; 8 middle slots
├─ Crawler (1)   line crawler; seabed; requires legs; seabed food ×1.25; commits seabed-bound
│   ├─ Shellback (2)  needs armor ≥ 2 from parts; armor +2 (plan); speed ×.8; locked wide middle; 8 middle slots; seabed food ×1.25
│   └─ Burrower (2)   stealth +2; seabed food ×1.4; hearts −1 (max 5); speed ×.95; no fins; burrow reserved
└─ Shore-walker (1) line shore; shallow water + land; needs coast; commits no-flight
    ├─ Strider (2)    land only; bans fins; commits no-swim       (needs coast)
    └─ Mudskipper (2) shallow water + land                        (needs coast)
Size 3: Sky drifter (darter, bulk)      flies; free water; bans legs
        Colossus (shellback, burrower) seabed + land; wades; no flight
        Dune giant (strider)            land only; no fins         (needs coast)
        Shore giant (mudskipper)        shallow water + land        (needs coast)
Size 4: Star swimmer (sky drifter)  space; bans legs
        Star crawler (colossus)     space, slow; bans wings; armor +1, hearts +1
        Star walker (dune giant, shore giant) space, slow (needs coast)
```

Shore-walker commits `no-flight` (owner rule: each size-1 line keeps a
commitment). Strider adds `no-swim`, so its only child is Dune giant (T-R2-21).

## 3. World queries, habitats and movement

### World queries (C-R2-05, T-R3-02, C-R3-01)

```ts
interface Terrain { groundAt(x: number, z: number): number; surface: number; space: boolean; slopeBound: number }  // physical; slopeBound = max |∇ground|
interface WorldQueries {
  terrain: Terrain;
  sampleEnvironment(p: Vec3): EnvironmentSample;
  visibility(from: Vec3, to: Vec3): number;          // 0 hidden … 1 clear; default 1
  refugeAt(p: Vec3): string | null;                  // environment samples only; default null
  refugeOverlap(world: readonly Capsule[]): { id: string; normal: Vec3 } | null;   // whole-hull refuge test; default null
  refugeAccess(actor: Actor, refugeId: string): boolean;
  overlapHull(actor: Actor, at: Vec3, o: Orientation, ctx: AdmissionContext): Admission;   // the one admission entry point
}
interface AdmissionContext { time: number; permit?: TraversalPermit; bounds?: { half: number; maxY?: number } }
interface Admission { ok: boolean; constraint: Constraint | null; point: Vec3 | null; normal: Vec3 | null }   // normal points back into the admitted region
type Constraint = 'ground' | 'surface-top' | 'floor-gap' | 'depth' | 'water' | 'land-band' | 'air' | 'space' | 'bounds-x' | 'bounds-z' | 'bounds-y' | 'refuge'
```

The coast (sub-project 2) adds solid geometry by replacing `overlapHull`'s
ground part, without changing callers. In space, `groundClearance` is
`+Infinity` and `surfaceHeight` is `null` (documented sentinels).

### Habitat profiles

```ts
interface HabitatProfile {
  id; media: readonly Medium[];
  maxWaterDepthBodyLengths: number | null;
  maxFloorGapBodyLengths: number | null;      // null = free; a number = lowest body point must stay this close to the ground
  maxLandSlopeRadians: number;
  surfaceBandBodyLengths: number | null;      // surface actors may rise this far above the water surface
  wadingSupportBodyLengths: number | null;    // non-null: may stand with the upper body above the water while the lowest point is within this band of the ground
  refugeTags: readonly string[];
  isStaticProp?: boolean;                     // decorative, never moves, exempt from admission
}
```

### Admission of a body (conservative)

> **Owner override (P3 playtest, "tighter fit"):** for the swim plans' envelope
> only, admission uses a tight fit (`HullFit` 'tight'): tapered hull pieces,
> sample spheres that cover them exactly, half the swim sway, a ground grid of
> `r'/6` with a second-order (curvature) margin instead of the slope margin.
> The body stops within .06 L of the seabed; the tail may clip a little into it.
> Every other plan keeps the conservative rules below. See docs/TINY-TIDE.md,
> "Hull fit". The ecosystem's contact hazards (touch, hazard events and the
> remembered target hull) use the same admission hull: for the swim plans, the
> tight hull. Only `sampleCombatPose` builds the conservative hull for them.

A body is a list of capsules, oriented and placed in physical space. With
`L` = body length:

1. **Bounds:** every capsule's extent (axis ± (radius + sway), top + radius
   + heave) stays inside `|x|, |z| ≤ half` and `y ≤ maxY`. Constraint
   `bounds-x/z/y`.
2. **Ground (conservative):** axis points are placed `s ≤ radius / 2`
   apart; each is tested as a sphere of radius `r' = radius + s/2` (so the
   spheres cover the capsule between samples), with the capsule's animation
   envelope (`sway` horizontal, `heave` vertical; see §8). For each sphere,
   the ground is sampled on a square grid of spacing `h = r' / 2` at every
   grid point with horizontal distance `d ≤ r' + sway + h/√2`. With
   `e = max(0, d − h/√2 − sway)` and `depth = sqrt(r'² − e²)` (0 when
   `e ≥ r'`), the rule is `c.y − heave − depth ≥ ground(grid point) +
   slopeBound × h / √2`. Every point under the swept sphere is within `h/√2`
   of a grid point, where the ground is at most the margin higher and the
   underside is no deeper than `depth`, so the slope bound **raises** the
   required clearance. Constraint `ground`; `point` is the worst grid point.
   `supportHeight(actor, x, z, o)` is the lowest origin height that passes
   this rule; grounded movement and food approach both use
   `supportHeight + .01 L`.
3. **Media:** each axis sphere's six extreme points (±y at `r' + heave`;
   ±x, ±z at `r' + sway`) must be admitted. Terrain-dependent rules (depth,
   over-water versus over-dry-ground, height above dry ground) use conservative
   ground bounds over the sphere's whole footprint (the ground grid's minimum
   and maximum with the slope margin), so no part of the body escapes them:
   - water: `media` has `water`; depth ≤ `maxDepth × L`; the body's floor gap
     (lowest point − ground below it) ≤ `maxFloorGap × L`. Constraints
     `depth`, `floor-gap`.
   - air above water: admitted if `surfaceBand` and height above surface ≤
     `band × L`; or `wadingSupport` and floor gap ≤ `wadingSupport × L`; or
     `media` has `air`. Else constraint `surface-top`.
   - air over dry ground, lowest point within `.6 L` of it: needs `land` (slope
     ok) or `air`; constraint `land-band`. Air elsewhere needs `air`
     (constraint `air`).
   - space needs `space` (constraint `space`).
   - a permit admits its media for times in `[startsAt, expiresAt)`.
4. **Refuge:** the world answers `refugeOverlap(posed hull)` for the whole
   hull (exact or conservative; point samples are not enough); a touched
   refuge needs `refugeAccess(actor, id)`. Constraint `refuge`, with the
   provider's normal.

Body lengths: player = body length × growth × stage size; species =
`SIZES[tier] × 1.4`. A species' occupancy hull is one sphere of radius
`.35 × SIZES[tier]` centred that far above its origin (food models stand on
their origin); its contact radius for hazards and bites stays
`entityRadius` around the origin.

### Movement profiles

```ts
interface MovementProfile {
  id; mode: 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
  speedMultiplier; acceleration; braking;    // stage-local units/s², converted × size
  maxYawRate; maxPitchRate;                  // rad/s
  facing: 'move' | 'aim' | 'lock-during-action';
  evasionProfileId?: string;
}
```

**Orientation convention (C-R3-02, T-R3-12):** `yaw` turns about +Y,
`pitch > 0` is nose up. `forwardOf(o) = (sin yaw cos pitch, sin pitch,
cos yaw cos pitch)`. The hull, renderer, sockets and motion all use
`orientationMatrix(o)` from one helper. Pitch is allowed for `swim`, `glide`,
`fly`, `space`.

**Facing:** `move` faces the wished direction; `aim` faces `intent.aim` when
set, else the wish; `lock-during-action` freezes facing while any runtime
action is in `windup` or `active`, else behaves as `move`.

### Motion (one service, one interval)

```ts
resolveMotion(req: MotionRequest, ctx: LegalityContext & { actor: Actor; interval: { start: number; end: number } }): MotionResult
interface LegalityContext { queries: WorldQueries; bounds?: { half: number; maxY?: number } }
interface MotionRequest { actorId; from: Vec3; displacement: Vec3; orientation: Orientation; turn?: Orientation;
  hull: readonly Capsule[]; habitatProfileId; cause: 'locomotion' | 'dash' | 'knockback' | 'recovery'; traversalPermit?: TraversalPermit }
interface MotionResult { status: 'moved' | 'blocked' | 'clamped' | 'invalid-start' | 'needs-recovery';
  position: Vec3; orientation: Orientation; contacts: readonly Contact[]; unconsumed: Vec3; time: number }
interface Contact { point: Vec3; normal: Vec3; constraint: Constraint; distanceFraction: number; time: number }
```

Rules:

1. The request's hull and habitat are authoritative; `ctx.actor` must match.
2. Invalid start (at `interval.start`) → `invalid-start`, nothing moves.
3. **Turn:** rotate toward `turn` in substeps of at most `minR / (2 × extent)`
   radians; stop at the last admitted orientation. A blocked turn is never an
   invalid start.
4. **Translation:** the motion is a series of straight legs. A leg from base
   `B` with vector `V`, starting at time `t0`, has `N = ceil(|V| / s)` slots
   (`s = minR / 2`), computed once; slot `k` is at `B + V k/N` and time
   `t0 + (end − t0) k/N`. A contact ends the leg; the projected remainder is a
   new leg from the contact point and contact time. At most 512 slot tests per
   call (then `clamped` with `unconsumed`). Permits are evaluated at slot
   times.
5. **Contact:** every query time stays in `[start, end]`: after a contact,
   the remaining displacement is resolved inside the remaining interval
   (partial progress consumes only its share of the time). At a blocked
   substep, find the boundary by bisection (8
   halvings) between the last admitted and the blocked position. If the last
   admitted position is itself no longer admitted at the new slot time (a
   permit ended), the contact is at that position. The normal comes from the
   failed constraint: `ground` → terrain normal at the worst grid point
   (pointing up); `surface-top`, `bounds-y` → `(0,−1,0)`; `floor-gap`, `air`
   → `normalize(∂g/∂x, −1, ∂g/∂z)` (a height above a sloped ground); `water`
   (an air-only body entering water) → `(0,1,0)`; `land-band` → downhill;
   `depth` → the horizontal uphill direction of the ground; admission returns
   this normal with the failed constraint; `bounds-x/z` → the inward face normal; `refuge` → the
   provider's normal; when a constraint has no normal (`space`, or a flat
   gradient), the reverse of the step. Remove the inward part of the remaining
   displacement (`rem −= min(0, rem·n) n`) and continue; a fourth contact
   stops the call.
6. **Velocity is not owned by the resolver.** Callers project each velocity
   they own with `projectVelocity(v, contacts)` (`v −= min(0, v·n) n` per
   contact).
7. **End of interval:** if the actor is no longer admitted at `interval.end`
   (for example, a permit expired inside the interval, even with zero
   displacement), the status is `needs-recovery`.
8. Bounds and the sky limit come from `ctx.bounds` and are constraints.

### Traversal permits

`TraversalPermit { id; startsAt; expiresAt; media; landingRequired }`. A
permit ends by time, interruption or cancellation; the caller then runs the
landing check (`overlapHull` without the permit) and recovery if needed.

### Recovery

```ts
findRecoveryPose(actor, near: Vec3, ctx: LegalityContext & { orientation: Orientation; time: number }, opts: { maxDistance: number; anchor?: Vec3 }): RecoveryResult
type RecoveryResult = { ok: true; position: Vec3; orientation: Orientation } | { ok: false; reason: string }
```

Candidates per horizontal offset: `near.y`, `supportHeight + ε`, the
floor-band top, the wading-band top, just under the surface, just above the
surface, the surface-band top; offsets on rings of 16 at half-body-length
steps; equal distances keep generation order. Sorted by 3D distance; farther than `maxDistance` skipped; at most 2,000
tests; full hull at the given orientation and bounds. The anchor is tried
last. Failure is explicit.

### Start anchors

`startAnchor(actor, stage, ctx)` = recovery from just above the ground at the
origin (space: `(0, 3 × size, 0)`), `maxDistance = 60 L`. A design is valid
for a plan only if an anchor exists at growth 1 **and** at growth 1.38
(admission is not monotonic in growth).

### Food access (G3-3, T-R3-17)

- `canApproachFood(actor, mode, food, bite, ctx)`: a pose must be admitted
  **and maintainable by the plan's locomotion**: ground modes only at support
  height (ground + hull bottom + clearance); free modes anywhere in their band;
  with `ctx.traversal = { kind: 'active', permit, now }` or
  `{ kind: 'hypothetical-breach' }` (permit `[now, now + 1.9)` from the
  current pose).
- Bites keep `legacyCanBite`. Approach never vetoes a bite.
- Budget tests use the installed live population (after legalization).

### Avoidance acceptance (G3-3, C-R3-04, T-R3-21)

`simulateEscape(encounter)` (Plan C, because it needs the real player step)
steps the real hunter rules and the real player step for up to 8 s: the player starts at the hunter's notice distance, already
acquired, and flees with a fixed policy (directly away; rises if able). It
succeeds when no hazard lands, or the hunter gives up (reported separately).
Encounters are found first by a bounded seed/instance search for a legal,
perceivable, non-contact start inside the player's own bounds where the
hunter acquires; a matchup without three such encounters is a fixture
failure, never a reason to change hunters; a negative fixture (a faster hunter with no
memory limit) must fail. If a shipped matchup fails, hunter data (speed or
pursuit policy) changes — not food counts — and the change is reported to the
owner.

## 4. Diet

- The diet is the mouth's diet. `Run.diet` stores it.
- At evolution, the path screen says "Choose your diet now" and the editor
  allows any unlocked mouth.
- In a normal edit, other-diet mouths are disabled: "Diet is set until your
  next evolution." A same-diet swap keeps the mouth's position.

## 5. Part size, cost and slots

- Stats: `factor = copies × (.75 + .25 × scale)`.
- Cost: `partCost(p) = round(spec.cost × copies × (.5 + .5 × scale))`.
- Slots: `copies × (scale > 1.4 ? 2 : 1)`. Complexity counts slots.
- The editor shows cost and slots while the size slider moves.

## 6. Evolve flow and editor

### Path screen

Each eligible child gets a card with three prominent lines (G-R3):

1. **Playstyle:** up to three gains (section 7).
2. **This form's cost:** up to two losses (section 7).
3. **Lasting sacrifice:** the new commitment, or "None new" with the inherited ones.
4. **Leads to:** names of the next eligible plans.

A small creature silhouette is visible outside the details. Opening the
details never selects the card.

Then, under a "Details" disclosure: all gains and losses, the creature preview
after the proposed adaptation, the list of changes to the creature, and the
DNA result. Capability comparison is typed and value-sensitive (section 7).

A card is disabled only if the plan is not eligible. If the automatic proposal
fails or is unaffordable, the card says so ("Needs changes you choose: short
by 12 DNA") and opens the editor so the player can customize (G-R4): with the
proposal when it succeeded but is unaffordable, or with the current design
when it failed.

### Evolve editor

- Opens with the proposal when it succeeded, or the current design otherwise.
- Done calls `onSubmit(draft)`; the editor stays open with its draft and undo
  history if preparation fails (T-R3-18).
- Shows the change list, **Undo all** (back to the current design) and
  **Fix for me** (reapply `adaptToPlan`).
- Done is enabled only for a valid, affordable design that has a start anchor.
- Diet can change only in this mode.

### Editor rules and performance (T-R2-17, T-R2-18)

- Region chips (`Head 3 / 4`) are always visible; two persistent rings show
  region borders while placing or dragging.
- Banned kinds: tabs hidden, with a note. Problems: all listed on desktop; a
  one-line summary on phones. Problem parts and segments are red.
- The creature model persists while the editor is open. Hover, ghost and part
  drags update object transforms through `resolveMount`; the body mesh is
  rebuilt only when the body shape changes (at most once per animation frame).
  Highlight materials come from a small cache keyed by a stable style id.
- A card tap arms placement on every device; a body tap places. There is no
  touch auto-place.

### Gestures (one owner per gesture)

| Input | Result |
| --- | --- |
| Left click on the body | place the chosen part |
| Left drag on a part | move the part |
| Left drag on empty space | nothing |
| Right or middle drag | turn the model |
| Wheel | zoom |
| One-finger tap (< 8 px) on the body | place |
| One-finger drag on a part or handle | move it |
| Two-finger drag | turn; cancels and rolls back any part, handle or card drag |
| Pinch | zoom |

A gesture that ever had two touches is consumed until all its pointers end.

## 7. Design rules, identity and repair

### Identity and serials (C-R2-08, T-R3-08)

- `PlacedPart.uid` is `p<serial>`. One allocator: the editor starts at
  `max(run.nextPartSerial, proposal.nextSerial)`, advances on every addition
  and repair, never goes back on undo, and returns its high-water mark in
  `EditorResult.nextSerial`. `Prepared` and every commit store
  `max(old, returned)`. Reservations made in a cancelled editor are not kept.
- A same-diet mouth swap keeps the uid and is a **catalog replacement**.

### Design delta (C-R3-07)

`designDelta(oldGenome, newGenome, loadout, catalog)` returns
`{ removedEmitters: EmitterSource[]; changedEmitters: EmitterSource[]; clearedBindings: { slot: ActiveSlot; binding: AbilityBinding; reason: string }[] }`.
Removed = the part or the copy is gone; changed = same uid with a different
catalog id, position, roll, scale or mirror. Actions from removed or changed
emitters are cancelled; cooldown debt is kept per `actor:uid:grant` unless the
grant itself is gone.

### Strict validation (T-R3-07, C-R3-08)

One function `validateDesign(genome, plan, ctx, catalog)` is used by every
commit and every v4 load. It rejects: unknown ids; bad, duplicate or unsafe
uid serials; `mirror` on a part whose catalog says it cannot mirror; mirrors at
poles (`|sin angle| < .3`) or tips (`t < .05` or `t > .95`); any non-finite or
out-of-range placement (`t ∈ [0,1]`, `angle ∈ (−π, π]`, `scale ∈ [.4, 1.8]`,
`roll ∈ [−π, π]`); spine values out of `SPINE_RANGE`; plus all plan problems.
Clamping and uid assignment exist only in `repairLegacyGenome` (v1/v2
migration).

Problem codes: `mouth`, `parts`, `segment`, `locked`, `unknown`, `uid`,
`banned`, `region`, `required`, `capability`, `diet`, `dna`, `mirror`,
`placement`, `anchor`.

### adaptToPlan

1. Remove unknown and locked parts.
2. Unpair bad mirrors.
3. Mouth: keep one; if a diet is given and no mouth has it, remove the mouth
   and remember its position.
4. Move each part in a disallowed region to the nearest allowed region with
   room; parts with no allowed region with room are **flagged**.
5. Remove flagged parts (`X removed: no room for it on a <Plan>`).
6. Add requirements (mouth of the diet at the old mouth's spot; required kinds;
   capability deficits) at the catalog default when it fits, else the nearest
   allowed region with room, else the nearest allowed region.
7. While a region or the global limit is over: remove one optional part
   (not the mouth, not a required kind, not needed for a capability), choosing
   first parts with no stats, then the lowest `partCost`, then the newest uid.
8. Fix the spine.
9. Allocate uids from the serial.
10. Validate (strict, with the anchor check). Failure returns reasons.

### Typed capability comparison (G3-4, T-R3-19, C-R3-10)

```ts
type CapabilityChange =
  | { field: 'water'; from: 'none' | 'seabed' | 'shallow' | 'free'; to: … } | { field: 'medium'; medium: 'land' | 'air' | 'space'; from: boolean; to: boolean }
  | { field: 'depthLimit' | 'floorGap' | 'wading' | 'surfaceBand'; from: number | null; to: number | null }
  | { field: 'speed' | 'acceleration' | 'braking' | 'yaw' | 'pitch'; from: number; to: number }
  | { field: 'slots'; region: Region; from: number; to: number } | { field: 'kind'; region: Region; kind: PartKind; from: boolean; to: boolean }
  | { field: 'range'; segment: 'head' | 'middle' | 'tail'; dim: 'radius' | 'height'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'locked'; segment: …; from: boolean; to: boolean } | { field: 'segments'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'bonus'; stat: keyof Stats; from: number; to: number } | { field: 'forage'; habitat: string; from: number; to: number }
  | { field: 'requiresKind'; kind: PartKind; from: boolean; to: boolean } | { field: 'requiresCapability'; stat; from: number; to: number }
  | { field: 'commit'; commitment: Commitment; inherited: boolean }
```

Each change has a direction (`good`). Water access is containment-ordered for
the "free" relation only: `seabed → free` is a gain (more vertical freedom),
not a loss of the seabed; `free → seabed` is a loss. A separate renderer gives
text.

**Card summary:** `Playstyle` = up to three gains by priority (water, media,
forage, speed, bonuses, turning, slots). `This form's cost` = up to two losses
by priority (hearts and other bonus losses, kinds lost, commitments, speed,
slots, body ranges). `Lasting sacrifice` = the new commitment text if the plan
adds one, else "None new" plus the inherited commitments ("Still: never swims
freely or flies"). Burrower shows "This form's cost: Hearts −1 (5 base); no
fins" and "Lasting sacrifice: None new — still never swims freely or flies".

## 8. Combat data contract

Contract types are defined in Plan B Task B2 and match the combat review with
these deliberate changes:

| Contract surface | Change |
| --- | --- |
| Body-plan habitat/movement ids | On `BodyPlan`, not in `combat`. |
| Species pursuit | `pursuitId` into a registry; every species that can be angry has a non-`none` policy. |
| Hull/mount | Extensible registry ids; today `sphere`, `spine-capsules`, `root`. |
| Emitter source | `EmitterSource = { kind: 'part'; partUid; copy; socketId } \| { kind: 'actor'; actorId; mountId; socketId }`. `ActionState.source` and `HitRequest.emitter` use it. Species get a root emitter through `speciesCombatPose`. |
| `ContactHazard` | Added. |
| `EnvironmentSample` in space | `groundClearance = +Infinity`, `surfaceHeight = null`. |
| `Run.pendingRespawn` | Kept. |

`Catalogs` holds every registry: habitats, movements, pursuits, hulls, mounts,
poses, telegraphs, effects, evasions, guards, attacks, abilities, hazards,
parts, species, plans, rig. `validateContract(catalogs)` enumerates every
check in Plan B Task B2 (key/id agreement, enums, finite and non-negative
numbers, unit axes, integer counts, references, rig chains without cycles,
16-number affine matrices); each check has a mutation test.

### Rig, sockets and pose (C-R3-03, T-R3-03)

- `src/tiny-tide/part-rig.json` maps `part → { "<kind>:<index>": { parent, pre, t, q, s, rest } }`:
  `parent` is the nearest pivot ancestor or null, `pre` the 16-number matrix
  of any non-pivot nodes between them, `t`/`q`/`s` the node's rest transform
  (the rest Euler is derived from `q` with three.js, exactly as the renderer
  sees `node.rotation`), and `rest` an independent Python product used only
  as a test oracle. It is generated by `check_assets.py --write-rig`; the
  default checker run compares and fails on a stale file. It lives under
  `src/` because only `src` is compiled.
- Sockets are authored in **part space**. A socket bound to a pivot moves by
  `posedPivotToPart × inverse(restPivotToPart)`; at rest it is exactly its
  authored point.
- `rigPoseInto(out, genome, time, swim, chomp)` fills a reusable buffer.
  Pivot offsets add to the rest Euler, as the renderer does. Chomp nods the
  head only: bone 1 counter-rotates bone 0's pitch, so later bones keep a
  vertical yaw axis (a small deliberate visual change).
- `restRig(genome)` is the zero-offset pose for pure tests.
- An action-pose layer keyed by `poseProfileId` is reserved (empty today).

### Hull and physics (T-R3-04)

- Occupancy hull: one capsule per spine segment on the chord between spine
  points. Radius = the exact maximum of `max(radius(f), height(f))` over the
  segment (Catmull-Rom cubics; extrema from derivative roots) plus the exact
  maximum of `|lift(f) − chordLift(f)|`. End caps reach the tips. Each
  capsule also carries an **animation envelope**: `sway`, the largest
  horizontal displacement the swim wave and the head nod can cause at that
  capsule (from the rig's maximum amplitudes, composed along the bone chain),
  and `heave`, the largest vertical displacement (from the head nod only).
  Admission treats the occupied volume as the capsule swept by any such
  offset, so grounded bodies do not float by the horizontal wave.
  (Owner override P3: the swim plans' admission hull is the tight hull of
  `bodyHull(genome, 'tight')`; see "Admission of a body". The ecosystem's
  contact hazards use that admission hull too.)
- Hurtboxes are the posed capsules (bones applied) for the current tick.
- `massFor(plan, genome, physicalLength)` = `massPerBodyLength × length`.

### DNA ledger (T-R3-06, G3-1, C-R3-06)

- All DNA amounts, bases and credits are non-negative safe integers; the
  validator enforces it. A transaction first validates the current ledger and
  never refunds invalid credit.
- Shrink release = `floor(creditTotal × (oldBasis − newBasis) / oldBasis)`,
  computed with integers; at full credit it equals `oldBasis − newBasis`.
  Taken from at-risk credit first.
- `commitDesign` validates the resulting ledger before returning success.
- The rest of the ledger is as in revision 3: basis versus credit, releases
  before purchases, deterministic uid-order allocation, unchanged parts cost 0,
  banking at evolution, `faintLegacy` active, `faintCombat` reserved.
- `mealDna(plan, diet, species) = round(species.dna × dietRate × forage)` —
  one rounding, used by rewards and all budget tests.

## 9. Lifecycle (C-R3-07, T-R3-14)

The simulation owns one root transform per tick (position, orientation, exact growth); rendering, admission and combat poses all use it (no separate render-side growth easing or bob outside the transformation). The player runtime owns every transient state, including the grounded body's settle offset: velocities, orientation, the
Breach arc and its cooldown, the permit, actions, cooldowns, stagger, guard,
and the flags `targetable`, `perceivable`, `damageable`.

| Transition | Rule |
| --- | --- |
| Pause, canceled edit | Simulation time stops; the runtime is kept exactly. Input becomes `RELEASED`; nothing is buffered. |
| Committed edit | Consume the design delta: cancel actions of removed/changed emitters, keep unaffected cooldowns; recompute the hull; recover the pose with the legality context if needed. |
| Evolve | Prepared before commit, including a validated destination (position and orientation at growth 1 for the new plan) — or nothing changes. Then reset the runtime (actions, permit, arc, velocities; cooldowns reset), install the destination after a presentation-only interpolation; hazards are suspended while evolving. |
| Faint | Only when `pendingRespawn` is false: apply the loss, set `pendingRespawn`, reset the runtime, save — before the animation. |
| Respawn | Once: needs a validated anchor pose (position **and** orientation) for the actual growth; set health, clear `pendingRespawn`, install the full pose, grace 3 s, save. On load with `pendingRespawn`, resolve the same way before play, and save. |
| Recovery | Try the current orientation, then level (pitch 0), then the revalidated anchor pose; install position and orientation together. If all fail, an explicit stuck state retries; an unchecked pose is never installed. |
| Load / new run | A fresh runtime. |

**Damage resolution** is one pure function: events are processed in a
deterministic order; an event is accepted only in `playing` mode, with
`damageable`, outside `invulnerableUntil`; acceptance sets
`invulnerableUntil = now + hazard.invulnerabilitySeconds`, so a second event in
the same tick or window is ignored. Perception uses `perceivable` only.

## 10. Pursuit (C-R3-04, T-R3-16)

```ts
interface PursuitPolicy { memorySeconds; blockedWaitSeconds; reacquireSeconds; leashBodyLengths; giveUpBodyLengths }
```

Registry: `none`, `hunter` (6, 3, 2, 30, 12), `retaliate` (4, 2, 3, 15, 8).
Every species with `fights: true` that does not hunt uses `retaliate`.

- **Perception:** distance ≤ notice × stealth, `visibility > 0`, and the
  player is `perceivable`.
- **Acquire:** a perceived player in a hunted size (`hunt`), or
  `provoke(e, playerPosition, now)` (`angry`). Both set `lastKnown` and
  `lastSeenAt`, and set `reachable` from the strict test below. Hunting
  acquisition happens in `calm` or `return`, only when `now ≥ returnUntil`;
  provocation can happen at any time.
- **Memory:** refreshed only by perception or a hit.
- **Reachability and the blocked timer:** `reachable` = the hunter can touch
  the last perceived target from a pose its movement can hold (free movers:
  the target point; grounded: the support height under it; surface: its band),
  and that pose is admitted. "Touch" uses the last **observed** target hull
  (a snapshot taken on perception or provocation) with the same
  sphere-versus-capsule test as hazards, never a sphere at the target's root. The blocked timer starts on the
  first unreachable tick and clears only after one continuous second of
  reachability, so border jitter cannot reset it.
- **Target:** perceived and reachable → the player; perceived and not
  reachable → the nearest admitted point toward the player (wait at the
  border); not perceived → `lastKnown`.
- **Give up** (`return`, `returnUntil = now + reacquireSeconds`) when any:
  not perceived for more than `memorySeconds`; perceived but unreachable
  continuously for more than `blockedWaitSeconds + memorySeconds`; distance
  to the player > `giveUpBodyLengths × L`; distance from home >
  `leashBodyLengths × L` (the leash wins).
- **Return:** to `calm` at home (within one body length) or 6 s after
  `returnUntil`.
- **Hazards** apply while hunting, while angry, or when `stingsStages`
  includes the stage.
- Hidden targets are not tracked: future action tracking reads the same
  perception state.

## 11. Saves

- Version 4: revision-2 fields plus `nextPartSerial`, `pendingRespawn`,
  `mechanics`, `archive`, `notices`, and the ledger of section 8.
- Load and every commit share the strict validator (section 7).
- A coast path in a build without the coast yields "kept" status; a fresh run
  then writes to `tiny-tide-adventure-v4-fresh`.
- **v2 → v4 (G3-2):**
  1. The original genome is repaired (`repairLegacyGenome`: uids, clamping)
     and archived with name, paint and time. The archive is viewable.
  2. Line: legs and no tail → Crawler line; otherwise Swimmer line.
  3. Candidate histories: every eligible path through that line to the saved
     size. For each, adapt the **original** design once to the **final** plan
     with the final size's unlocks and the path's commitments (no intermediate
     limits). Score, in order: retained part cost (higher better); the diet
     kept; an exact fit before any changed design; fewer segments added or
     removed; the smallest radius/height/lift change on shared segments; fewer
     moved or resized parts; the first path. Choose the best.
  4. Ledger: grandfather the original at current costs (banked), then commit
     the adaptation; removed parts are refunded, added required parts paid; a
     shortfall is granted as banked credit with a notice.
  5. Notices are stored and shown once.
  6. The migrated run is written to the v4 key; **legacy v1/v2 keys are never
     written**.
- v1 → v2 → v4 uses the v1 reader first.

## 12. Pacing study (G-R5, T-R2-23)

A scripted diagnostic. It reports numbers; the owner decides tuning.

- Runs: all four size-2 branches (Darter, Bulk, Shellback, Burrower), seeds
  11–13, each with `none` purchases and with `sensible` purchases.
  `sensible` = a fixed shopping list per line applied once each when
  affordable and fitting (listed in Plan C); mouth changes at evolution are
  part of both runs.
- Logged per size: active time, editor time, wall time, food mix, travel
  versus feeding time, damage and faints, time at borders, purchases made.
- Watch bands (not gates): first evolution 45–120 s active; sizes 1–3 each
  60–240 s; the cosmic size measured separately; `T_none / T_sensible`
  reported per branch.
- Before any tuning, the study runs once on the new build to set a baseline.
- Tuning changes are proposed to the owner with the numbers; none are
  applied automatically.

## 13. Extension seams for keystones (G-R8, gloop)

- Movement and feeding are dispatched through `MovementProfile.mode` and a
  `feedingStrategy` id on the plan (today `'bite'` for all).
- `Run.mechanics: Record<string, unknown>` (versioned, empty today) is
  reserved for keystone state such as a host planet and tendril links.
- A fixture plan in tests (not in the shipped tree) with a keystone closing a
  line proves closures reject the closed descendants on eligibility and load.

## 14. Sub-project 3 acceptance (recorded, not built now)

- Wind-up cues do not depend on sense parts; they use the same action clock
  and committed geometry as damage; direction and elevation are readable in
  water; they work with muted audio; off-screen warnings arrive before an
  attack is unavoidable; overlapping threats leave a response.
- Two-thumb mobile scheme: move + aim/basic, then an active reaction, then
  basic again, at 320×568 and 844×390, for a swimmer, a crawler and a
  breacher; touch cancel; depth-separated threats.
- Breach stays traversal, not a third active. Dodge and guard use the two
  equipped slots.

## 15. Modules

| Module | Plan | Role |
| --- | --- | --- |
| `body-geometry.ts` | A | Pure body maths. |
| `plans.ts` | A | Plans, commitments, eligibility, typed comparison. |
| `genome.ts` | A | uids, cost, slots, effective stats, problems, adaptToPlan. |
| `economy.ts` | A | Ledger and transactions. |
| `state.ts` | A | Run v4, transactions on the run, validation, migration. |
| `rig.ts`, `part-rig.json` | B | Rig data and the shared rig pose. |
| `combat-types.ts`, `profiles.ts`, `registries.ts`, `design-delta.ts` | B | Contract types, profiles, capabilities, validation, design delta. |
| `orientation.ts`, `world-queries.ts`, `motion.ts` | B | Orientation, environment, admission, support height, motion, recovery, permits. |
| `mount.ts` | B | Mounts, hull and envelope, combat poses, mass, player actor. |
| `ecosystem.ts`, `species.ts` | B | Species actors, motion, pursuit, hazards. |
| `food-access.ts` | B | `canApproachFood`, food budgets. |
| `avoidance.ts` | C | `simulateEscape`. |
| `input.ts`, `player-motion.ts`, `lifecycle.ts` | C | Intents, player motion, transitions. |
| `path-screen.ts`, `preview.ts`, `editor.ts`, `main.ts`, `world.ts`, `creature.ts` | C | UI and integration. |

## 16. Testing

Every rule above has a named test in the plan that owns it, including every
reproduction cited from round 2 as a regression case. Browser tests use real
input and read-only diagnostics; fixtures come from authoritative goals and the
cost function, never hard-coded duplicates.
