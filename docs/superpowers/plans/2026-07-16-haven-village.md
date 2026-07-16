# Haven Village Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Phase 2 of Wildtag per docs/superpowers/specs/2026-07-16-haven-village-design.md — bonding, Haven village + NPCs, barter, farm, Prismhorse mount, 4 new species.

**Architecture:** Same pattern as phase 1: pure TDD'd cores (`bonding.ts`, `barter.ts`, `farm.ts`, mount math in controller constants) + thin three/DOM layers. Village is seeded static content. Save bumps to v2 with v1 migration.

## Global Constraints

- Everything from the phase-1 plan still binds: constants in `src/core/constants.ts`; pure modules never import three; determinism from WORLD_SEED (village layout, NPC requests seeded); no free flight (mount is ground-bound: speed 15, jump 11, no glide interaction while mounted); `npm test` green after every task; conventional commits.
- Spec §8 success criteria are the definition of done. Numbers in the spec (§1 charm recipe, §4 roles/timers, §5 species params, §3 reward track) are binding.
- Save v2 must load v1 saves losslessly (defaults for new fields); decodeSave keeps its never-throw contract.

## File Structure (new)

```
src/critters/roster.ts        — pure bonded-roster core (bond/release/assign/summon eligibility)
src/village/layout.ts         — seeded village layout data (buildings/paths/pens, pure)
src/village/buildings.ts      — procedural building/fence/lamp meshes + obstacles
src/village/npcs.ts           — NPC defs + models + idle AI + labels + interact hook
src/village/barter.ts         — pure request generation/fulfillment/reward track
src/village/dialog.ts         — dialog screen (DOM, via ScreenManager)
src/farm/farm.ts              — pure plots/assignment/production/auras/hoppers/deeds
src/farm/visuals.ts           — plot meshes, assigned-critter puppets, collect prompt
src/player/mount.ts           — pure ride kinematics helpers + summon rules
src/ui/roster.ts              — roster screen (KeyB)
tests/{roster,barter,farm,mount,village}.test.ts
```

Tasks (each = implement → review → fix → merge, per SDD):

### Task V1: New species ×4 (data + models + animation + preview)
Prismhorse (16 legs!, crystal clusters, antennae bobbles — spend the tri budget here, ≤400 tris ok), Bumblewhale (hover bob), Snickerdoodle (flip-to-move animation), Gloomgobbler (stilt legs, lantern eyes). Spec §5 params binding incl. `bold`, add `rideable: boolean` and `farmRole: { kind: 'produce'|'aura'|'none', resource?, amount?, auraPct?, special? }` to SpeciesDef (all 12 species get farmRole per spec §4/§5). Update species tests + `?preview=critters` (grid layout for 12). AI: 'fly' flee for bumblewhale reuses flyer path with slow rise; snickerdoodle flip = animation only.

### Task V2: Bond Charm + roster core + roster screen
Recipe (3 fiber/1 shard/1 spark, batch 2, tier 1, id 'charm', kind 'consumable' → new `charms` counter on Inventory). Pure `roster.ts`: `bond(roster, critterView, speciesId)` (requires linked; returns new roster w/ generated nickname), `release`, `assign(plotId)`, `unassign`, statuses. Manager: `consumeSlot(id)` (bonded critters leave the wild permanently), `debugBond(id)`. Interact priority: aiming at a linked critter within trackRadius w/ charms>0 → F bonds (else existing harvest/mount logic). Roster screen on KeyB via ScreenManager. Save v2 fields (roster) + migration test.

### Task V3: Village — layout, buildings, NPCs, dialog shell
Seeded layout (pure, tested: deterministic, no overlaps, inside meadow radius, paths connect). Blocky buildings + fences + lamps as obstacles; NPC models (5 distinct) + name labels + idle wander/face-player AI; F → dialog screen (flavor line + request slot + Fulfill button placeholder). Village renders from spawn; terrain under village flattened locally (heightAt stays authoritative — buildings sit on sampled ground; flatten visually by choosing a flat pocket, do NOT modify heightAt).

### Task V4: Barter core + reward track + pens
Pure `barter.ts`: seeded request rotation per NPC (species requests weighted to player's linked-species tier, resource requests as fallback), `canFulfill(request, roster, inventory)`, `fulfill(...)` → consumes roster members (permanently → pen list) / resources, grants next reward from track (Saddle, Plot Deed ×2, Golden Dart Tip (TRACKING.fillRate 1.5), Critter Whistle, Lantern Charm, then resource bundles). Delivered critters render idling in a small pen by that NPC's home. Dialog Fulfill wired. Rewards land in a new `rewards: Set<string>` on save/state. TDD: rotation determinism, fulfillment math, roster consumption, reward order, no-duplicate uniques.

### Task V5: Farm — plots, assignment, production, deeds
Pure `farm.ts`: plots (2 + 2×deeds, max 6, positions from layout), assign/unassign bonded critters, production tick (per-species farmRole; mirefin/emberpup auras +25% each cap +50%; bumblewhale +1 hopper cap aura; snickerdoodle adjacency double), hoppers cap 10, `collect(plotId)` → inventory. Visuals: plot meshes at farmhouse, mini critter puppet on assigned plot (reuse buildCritterModel at 0.7 scale, idle anim), F collect prompt + hopper count label. TDD: production math w/ aura stacking, caps, deed expansion, collect.

### Task V6: Mount — saddle + summon + ride mode
Controller `mode: 'mount'`: mount via F near your bonded Prismhorse when Saddle owned (spawn it near player on summon: KeyV summons if Whistle owned, else it idles near the farm); ride: speed 15, accel 30, jump 11, stamina-free, camera slightly raised, dismount KeyV / hold Space; mount can't enter water deeper than knee (heightAt < -0.5 blocks). No glide/rocket/grapple while mounted (masks off). Prismhorse model gets a saddle mesh when ridden. TDD pure helpers (mount eligibility, speed constants sanity, water block); ride verified via debug + screenshot.

### Task V7: Save v2 + debug + e2e + README + final polish
SaveV2 (roster/farm/barter/rewards/mount) + v1 migration (test). Debug handles per spec §6. e2e additions: bond flow, barter fulfillment, farm tick (setTimeScale), mount ride smoke, village screenshot, 12-species preview screenshot. README: village/bonding/barter/farm/mount sections + controls (KeyB roster, KeyV mount). Final whole-phase review + merge.

## Self-Review
Spec coverage: §1→V2, §2→V3, §3→V4, §4→V5, §5→V1(+V6 rideable), §6→V2/V7, §7→V7, §8 gate→V7. Type consistency: SpeciesDef extensions defined once in V1; roster/farm/barter interfaces owned by their pure modules. No placeholders.
