# Wildtag Phase 2 — Haven Village (Design Spec, 2026-07-16)

Spencer's brief: a little village at spawn with NPCs and a farm; captured animals help the farm
(PALworld farming side); barter economy — no money — trading animals/goods for upgrades, property,
land, tools; NPC requests ("get me five of this animal"); rideable animals incl. a whimsical
"horse" (16 legs, crystal body, antennae — go crazy); more, and more whimsical, species overall.
Decisions confirmed with Spencer: capture is a SEPARATE item (not auto-on-Link); delivered animals
are traded away permanently; full loop in one phase.

## 1. Bonding (capture)

- New consumable: **Bond Charm** — tier 1 recipe (3 fiber, 1 shard, 1 spark; batch 2). Craftable
  once tracking exists; sparks make Linking feed capturing.
- Usage: aim at a **Linked** critter within its trackRadius and press **F** (interact takes
  priority over harvest when aiming at a bondable critter) → consumes one charm → critter joins
  the **roster** (removed from the wild; its spawn slot marked consumed so it doesn't respawn).
- Only Linked critters can be bonded (Link first = research, then capture — the two-step Spencer
  chose). Each wild individual is a distinct bondable unit; "five Puffles" = bond five.
- **Roster screen** (KeyB): list of bonded critters (species, nickname auto-generated, status:
  idle / farm plot N / traded away marker history not needed). Actions per critter: Assign to
  plot, Set as mount (rideable species w/ saddle), Release to wild (returns to a wild slot).

## 2. Haven Village

- Fixed seeded settlement in the spawn meadow (~centered 40m NE of origin, radius ~55m): 5
  procedural blocky buildings (Farmhouse, Barter Stand, 3 homes), dirt paths, fences, lamp posts
  (emissive). All primitives, flat-shaded, matching the world's look. Buildings are obstacles.
- **5 NPCs** (procedural blocky villagers with distinct silhouettes/colors + floating name labels):
  Mayor Fenn, Farmer Odd, Trader Juno, Old Bram, Kit the Kid. Idle behavior: wander short loops
  inside the village, pause, face the player when nearby. Non-combat, no schedules (scope).
- **F to talk** → dialog panel (DOM overlay like other screens): a line of flavor + their current
  barter request (if any) + Fulfill button when requirements are met.

## 3. Barter (no money, ever)

- Each NPC holds one active **request** at a time, generated from a seeded rotation:
  `Bring me N × species` (N 1–5 weighted by rarity; only species reachable at the player's
  progression tier) or `N × resource`. Fulfilling consumes the goods — **delivered critters are
  traded away permanently** and appear living around that NPC's home (small pen), a visible
  reminder of trades. A new request appears after fulfillment.
- **Reward track** (fixed order per NPC pool, no duplicates): Saddle (unlocks riding), Plot Deed
  ×2 (each +2 farm plots), Golden Dart Tip (tracking rings fill 1.5×), Critter Whistle (summon
  your mount to you), Lantern Charm (personal light at night—cosmetic glow), plus resource
  bundles as filler once uniques run out.

## 4. Farm

- At the Farmhouse: **plot grid** — 2 plots at start, +2 per Plot Deed (max 6). Assign a bonded
  critter to a plot (roster or walk-up F): it visibly stands/putters on the plot and produces its
  species resource into the plot hopper on a timer (cap 10 per hopper; F collects).
- Species work-roles (produce per ~90s): puffle→fiber×2, skitterling→resin×2, bellowbuck→fiber×4
  (big hauler), mirefin→+25% speed to adjacent plots (irrigation, produces nothing), craghorn→
  shard×2, emberpup→+25% speed aura (warmth; stacks with mirefin, cap +50%), zephyrfinch→spark×1,
  lumenstag→spark×2. New species get roles in §5. Timers run only while the game is open (no
  offline progress — scope).

## 5. New species (+4, whimsy mandate) — total roster 12

1. **Prismhorse** — THE mount. Horse-sized, 16 legs (two skittering rows of 8), body of clustered
   translucent crystals, two long antennae with glowing bobbles. Crags/highlands, rare (0.08),
   bold (ignores you untagged), R16/T18, aware 22, flee sprint. Farm role: none — it's transport.
   **Rideable** with Saddle: summon/mount via KeyV (needs Whistle for remote summon; without it,
   mount by walking up + F), ride speed 15 m/s, jump 11, stamina-free, dismount KeyV/Space-hold.
2. **Bumblewhale** — a placid two-metre whale-blimp that drifts 3m above the wetland, humming.
   Bold. Slow. R14/T20, aware 10, flee 'fly' (slow rise). Farm role: hovers over plots, +1 hopper
   cap aura. Rarity 0.15.
3. **Snickerdoodle** — a pancake-flat meadow cat that flips itself over to move. Common (0.8),
   skittish zigzag, R10/T8, aware 12. Farm role: fiber×1 but produces double when adjacent to
   another snickerdoodle (they knead).
4. **Gloomgobbler** — round forest shadow-ball on two stilt legs, huge lantern eyes, eats
   glow-flowers. Skittish sprint, R12/T14, aware 15, rarity 0.3. Farm role: resin×3.
- Existing 8 get a whimsy pass ONLY if trivially cheap (e.g. antenna bobbles); no redesigns.

## 6. Persistence & compat

- Save **v2**: adds roster, farm (plots/assignments/hoppers/deeds), NPC request states, owned
  rewards, mount state. v1 saves migrate (new fields default empty; nothing lost).
- Debug handles extend: `__game.bond(id)`, `grantReward(id)`, `fulfillRequest(npc)`,
  `farmState()`, `summonMount()`.

## 7. Testing / verification

- Same regime: pure cores TDD'd (bonding rules, request generation/fulfillment, farm production
  math incl. auras, mount kinematics constants, save v2 migration); Playwright e2e extends with:
  bond flow (debug), barter fulfillment round-trip, farm tick production, mount ride smoke;
  village + new-species screenshots (`?preview=critters` shows all 12).

## 8. Success criteria

1. Walk into Haven from spawn: buildings, 5 named NPCs, dialog + requests work.
2. Full loop playable: Link → Bond Charm → roster → assign to farm (resources accrue) OR deliver
   to NPC (traded away, visible at their pen, reward granted).
3. Saddle → ride the Prismhorse (16 legs and all) around the island; never free flight.
4. 12 species in preview; the 4 new ones read as delightfully weird.
5. All suites green; e2e extended checks pass; README updated.
