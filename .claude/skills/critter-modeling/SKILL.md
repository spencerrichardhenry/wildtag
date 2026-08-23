---
name: critter-modeling
description: Use when adding or reworking a wildtag critter/character model — new species, model redesigns, "make it look like the concept", eye/silhouette complaints, or any src/critters/models.ts geometry work.
---

# Wildtag Critter Modeling (round-5 register)

## Pipeline (fal.ai concept → procedural build)

1. **Concept first.** Generate with fal.ai flux (`FAL_AI_KEY` in `.env`):
   prompt = `"low-poly faceted 3D game figurine, flat-shaded triangular
   facets, hard edges, chibi proportions, big glossy dark eyes with white
   highlights, standing on a small rock base, plain light background, "
   + species identity`. Get Spencer's approval on the concept BEFORE building.
2. **Hero species only:** also generate side/back turnarounds (+ optionally
   fal image-to-3D for proportion reference — guidance only, NEVER import
   meshes; the game is zero-external-assets procedural).
3. **Build in `src/critters/models.ts`.** Pattern implementations:
   `buildCragdrake` (hero, 5k), `buildPuffle` (standard).

## Register rules

- Flat material class (`mat(color, { flat: true })`) on every surface EXCEPT
  eyes. Low-seg geometry: icosahedra detail 0/1 for masses, 4–6-seg
  cylinders/cones for limbs; a 4-seg cylinder rotated 45° = chamfered wedge
  (muzzles). BoxGeometry banned for body/head.
- **Eyes = inset lenses**, never protruding spheres: flattened dark lens
  seated INTO the skull flush with facet planes, highlight chip inside the
  lens. Use the shared inset-lens helper.
- Per-face lightness jitter (`CRITTER_VARIATION.facetLightnessJitter`) on
  flat masses — kills the flat "same-y" read.
- Silhouette from the concept: stance/mass/pose per species, not one grammar.
- Keep: `CritterParts` pivots (legs/wings/head/body/tail/antennae), rng
  jitter + weathering rolls, emissive identities, palettes.

## Budgets (enforced by tests/models.test.ts)

Tris ≤1700 (prismhorse 2200, cragdrake hero 5000). Bake classes are the mesh
cap (≤10; shardwing 12, prismhorse 24): flat + smooth-eyes ≈ 2 meshes/head,
1/part — every extra material CLASS (not color) costs a mesh.

## New-species checklist

species.ts entry → fleeStyle (ai.ts + AI constants + guide.ts label) →
builder + registry → tests/species.test.ts pins → verify.mjs Field-Guide
count → `?preview=critters&focus=<id>` review (profile shot for eye
flushness) → full suite → gallery artifact refresh.

## Verify loop

`npx tsc --noEmit` → `npx vitest run tests/models.test.ts` → screenshot via
scratchpad `snap.mjs` against the concept → full `npx vitest run`.
