# Tiny Tide evolution design

This document describes the Spore-style evolution update. It replaces the five
fixed hero forms with one creature that the player designs and keeps from the
seabed to space.

## Scope

- A full creature editor: body spine, free part placement, paint.
- Stats from parts, and a diet type from the mouth.
- A DNA economy: eating earns DNA, parts cost DNA, stage progress uses DNA earned.
- A living ecosystem: grazers, schools, prey that flee, prey that fight back,
  predators, and food that respawns.
- Health, damage and death. Death keeps the stage and costs some DNA.
- Seeded biomes, so each new adventure has a different layout.
- A versioned save (v2) with migration from the v1 save.

Out of scope: a new verb or goal for each stage. Stages keep the current
goals: eat, grow, and eat 12 planets to finish. The orca stage keeps Breach.

## The creature genome

```ts
interface Genome {
  spine: { radius: number; height: number; lift: number }[]; // front to rear, 3–8 points
  parts: { id: PartId; t: number; angle: number; scale: number; mirror: boolean; roll: number }[];
  paint: { base: string; belly: string; accent: string; pattern: 'plain' | 'stripes' | 'spots' | 'freckles' };
}
```

- The runtime builds the body as a skinned, lofted mesh with one bone for each
  spine point. Swimming bends the bones in a wave.
- `t` is the position along the body surface, 0 = front tip, 1 = rear tip.
  `angle` is the angle around the spine: 0 = top, π/2 = right, π = belly.
- A part with `mirror: true` has a copy at `-angle`.
- A creature must have exactly one mouth. The mouth sets the diet.
- Each stage has a limit for spine points and for part count (complexity).

## Part GLB conventions

Parts are Blender assets named `part_<id>.glb`. They follow the art kit style
in `scripts/tiny-tide/blender/build_assets.py`.

- The origin is the attach point on the body surface.
- Local +Y is the outward surface normal. Local +Z is creature forward.
  At the front and rear tips, the normal is along the body axis; then local +Z
  is creature up.
- Size the part for a body radius of 1.
- Tintable surfaces use the `Tide_tint` material with a light neutral painted
  gradient. The runtime multiplies it by a paint color. Eyes, teeth and glow
  keep their own fixed materials.
- Optional pivots (empties) for procedural animation:
  - `jaw` — mouths. The runtime opens it on a chomp.
  - `seg_0`, `seg_1`, … nested — tails and tentacles. The runtime waves the chain.
  - `flap` — fins and wings. The runtime rotates it.
  - `swing` — legs and claws. The runtime rotates it in a walk cycle.
- No baked clips. All part motion is procedural.

## Part catalog

| id | Kind | Stage | DNA | Effect |
| --- | --- | --- | --- | --- |
| mouth_nibbler | mouth | 0 | 0 | Herbivore. Reach +0.2 |
| mouth_snapper | mouth | 0 | 0 | Carnivore. Bite +1 |
| mouth_beak | mouth | 1 | 20 | Omnivore. Bite +1 |
| mouth_filter | mouth | 2 | 30 | Herbivore. Reach +0.6 |
| mouth_fangs | mouth | 2 | 35 | Carnivore. Bite +3 |
| mouth_maw | mouth | 3 | 50 | Omnivore. Bite +3, reach +0.4 |
| eye_bead | eye | 0 | 5 | Sense +1 |
| eye_stalk | eye | 0 | 10 | Sense +2 |
| eye_big | eye | 1 | 15 | Sense +2, stealth +1 |
| eye_compound | eye | 2 | 20 | Sense +3 |
| eye_cosmic | eye | 4 | 30 | Sense +4 |
| fin_side | fin | 0 | 10 | Speed +0.4 |
| fin_dorsal | fin | 1 | 12 | Speed +0.2, health +1 |
| fin_frill | fin | 1 | 18 | Speed +0.4, stealth +1 |
| tail_paddle | tail | 0 | 10 | Speed +0.6 |
| tail_fan | tail | 1 | 18 | Speed +0.9 |
| tail_fluke | tail | 2 | 25 | Speed +1.2 |
| leg_little | leg | 0 | 8 | Speed +0.4 |
| leg_crab | leg | 1 | 14 | Speed +0.3, armor +1 |
| wing_feather | wing | 3 | 30 | Speed +1.0 |
| jet_vent | jet | 3 | 35 | Speed +1.5 |
| claw_pincer | arm | 0 | 12 | Bite +1 |
| tentacle | arm | 1 | 15 | Reach +0.5 |
| tentacle_long | arm | 3 | 30 | Reach +1.0 |
| spike | armor | 0 | 6 | Armor +1 |
| shell_plate | armor | 1 | 14 | Armor +2, speed −0.2 |
| horn | armor | 2 | 18 | Bite +2 |
| tower | armor | 3 | 30 | Armor +3, health +2 |
| antenna | sense | 0 | 6 | Sense +1 |
| glow_bulb | sense | 2 | 15 | Sense +1, reach +0.3 |
| cloak_fronds | sense | 1 | 16 | Stealth +2 |
| halo | cosmic | 4 | 40 | Health +3 |
| star_crown | cosmic | 4 | 35 | Sense +2, bite +2 |
| nebula_fin | cosmic | 4 | 40 | Speed +2 |

Some parts also unlock early when the player defeats a species that fights:
crab → `leg_crab`, jellyfish → `glow_bulb`, squid → `tentacle_long`,
seaplane → `jet_vent`.

## Diet and food

Each food has a tag: `plant`, `meat` or `any`. Herbivores eat plants. Carnivores
eat meat. Omnivores eat both for 70% DNA. Every creature eats `any` food.

| Tier | Plant | Meat | Any |
| --- | --- | --- | --- |
| 0 | sprout, kelp, grapes, lettuce | copepod, bristle worm | — |
| 1 | grape cluster, lettuce bed | shrimp, crab, jelly, snail | — |
| 2 | kelp frond, sea sprout grove | tuna, squid, ray, gull | — |
| 3 | — | — | palm, sailboat, seaplane, balloon, lighthouse |
| 4 | — | — | 12 planets |

## Ecosystem rules

- Each species has a behavior: `still`, `drift`, `graze`, `school`, `skittish`
  (flees), `fighter` (fights back when bitten) or `hunter` (hunts smaller tiers).
- An entity one tier above the player is a threat if it is a `hunter`.
  An entity in the player's tier with `fighter` or `hunter` fights back.
- Stealth reduces the distance at which hunters notice the player.
- Sense increases the distance of the food guide and the threat warnings.
- Food in tiers 0–3 respawns out of view. Planets do not respawn.

## Health and death

- Health = 6 + parts. Armor reduces each hit (minimum 1 damage).
- Health regenerates after 5 seconds without damage.
- At 0 health the creature respawns at the stage start point with 70% of its
  DNA wallet. The stage and the design stay.

## Progress

- `dnaWallet` — DNA the player can spend in the editor.
- `stageDna` — DNA earned in this stage. It fills the growth bar.
- When the bar is full, the Evolve button opens the editor with the next
  stage's parts. Confirming the editor starts the in-place transformation.
- The editor is also available at any time from the Edit button.
- Removing a part refunds its full cost.
