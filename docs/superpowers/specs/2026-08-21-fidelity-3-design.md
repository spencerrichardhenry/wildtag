# Fidelity-3: Visual Quality Re-Pass — Design

**Date:** 2026-08-21
**Goal:** Bring every rendered asset and every biome vignette up to the quality bar of the reference image (`docs/fidelity/reference.png`) — a dense, saturated, low-poly stylized forest-meadow scene. Not pixel-exact; the bar is *busyness, terrain-vs-player scale intimacy, and per-asset fidelity*. HUD is restyled in appearance only — zero functional changes.

## Reference style spec (sampled from reference.png)

| Element | Palette / form notes |
|---|---|
| Sky | Saturated blue `#4a9ffb` (zenith) → `#75bafd` (horizon). Low-poly white clouds, flat bottoms, faceted puffy tops, drifting slowly. |
| Mountains | Distant faceted silhouette ring, desaturated blue-teal `#62a0ac`, no detail, atmospheric fade. |
| Terrain | Rolling meadow greens (bright `#7cc24e`→mid `#58a344` range), warm tan dirt paths `#d3a668` winding through, scatter-free on path. |
| Broadleaf trees | Fat faceted trunks `#6f4d2f`, multi-lobe blobby canopies, lit facets `#669b45` → shadow `#294827`. Giant framing specimens near player. |
| Conifers | Stacked faceted tiers, dark saturated green `#18562d`–`#2f7756`, chunky. |
| Ground scatter | VERY dense: chunky 4–5-petal flowers (pink `#ea5f77`, yellow `#f2c744`, blue `#5b7fe8`, yellow centers), red/yellow mushrooms `#d95f4c` w/ cream stems, faceted bushes (green blobs, single + clusters), cut logs (ring end-caps `#583f26`, bark `#795635`), grey faceted rocks `#4f5662`–`#7b7b7a` in all sizes, chunky grass tufts (not slabs). |
| Hands | Tan skin `#efae61`, faceted but with distinct fingers + thumb, dark sleeve cuffs `#7b664e`/`#4a423c`. Held items chunky (blue cube `#2967bb`). |
| Critters | Chunky faceted bodies, big glossy black eyes, defined ears/tails (reference Mossbun: sandy body, leaf tail). |
| HUD | Dark translucent charcoal panels `rgba(20,28,36,0.72)`, ~10px rounded corners, clean sans-serif (system-ui), mint accent `#88f3cb`. Top-left tracker pill, top-center compass strip w/ tick marks + mint diamond, bottom-center hotbar dark slots w/ counts, bottom-right progress bar w/ mint fill. |
| Village | Colored gable roofs (red/orange/blue), cream walls, windmill silhouette visible from meadow. |

## Gap analysis (current master, 2026-08-21)

1. **Scatter density** — near-field is almost bare; reference has continuous flowers/mushrooms/rocks/bushes/logs/tufts. Biggest single gap.
2. **Sky** — washed pale gradient; no clouds; no distant mountains → horizon reads as empty ocean.
3. **Grass tufts** — slab-like crossed quads close up (known fidelity-2 followup).
4. **Trees** — thin-trunk lollipops; canopies single-blob; conifers too small/skinny.
5. **Critters** — most of the 15 are blob-plus-stick-legs with small eyes; far below reference Mossbun bar.
6. **Hands** — fingerless faceted mittens; reference has fingers, thumbs, sleeve cuffs.
7. **HUD** — grey chip cluster + monospace font; nothing like the reference's clean dark panels.
8. **No paths** — terrain has no dirt path network; reference composition is anchored by one.
9. **Saturation** — terrain/lighting desaturated relative to reference.

## Constraints (hard project rules preserved)

- ALL tuning constants in `src/core/constants.ts`.
- `heightAt(x,z)` remains the single analytic ground truth; paths recolor terrain + suppress scatter analytically, no mesh raycasts.
- Pure modules never import three; scatter placement/path math is pure + Vitest-TDD'd.
- All models procedural from three primitives; zero external assets.
- Free-flight invariant untouched (no movement changes at all).
- HUD: appearance only. Same DOM structure/IDs/update logic wherever possible; CSS-level reskin + minimal markup additions.
- Perf: keep instanced/batched draw pattern; densities quality-gated (low/med/high). Draw calls stay in the ~300 band on medium; heavy density scales down on low.
- Grapple colliders + obstacle yTop stay correct for reshaped trees/rocks.

## Approach

Chosen: **in-place upgrade of the existing scatter/prop/sky systems** (not a parallel new renderer). Alternatives rejected: (a) shader-based ground detail imposters — cheaper but can't match the reference's parallax/silhouettes; (b) full asset overhaul via external meshes — violates zero-external-assets rule.

Workstreams (mostly independent, verified by fidelity snips):

1. **Verification tooling first** (`e2e/fidelity.mjs`): fixed-pose snips via `__game` teleport + camera-yaw handles → `docs/fidelity/`; HTML side-by-side compare page vs reference; one command re-run. This is the loop everything else iterates against.
2. **Sky/atmosphere**: saturated 3-stop sky, instanced low-poly cloud puffs w/ flat bottoms + slow drift, faceted mountain ring at far fog distance, fog/lighting saturation retune.
3. **Scatter density + new props**: flowers (3 colors), mushrooms (red/yellow), bushes, cut logs, small rocks, chunky grass-tuft clusters; per-biome palettes/densities in constants; InstancedMesh per type per chunk (merged into existing BatchedMesh flow where applicable).
4. **Trees**: trunk radius up, multi-lobe canopies (3–5 icosphere-ish lobes), conifer tier stacks, keep giant tier ~5%.
5. **Paths**: pure `pathMask(x,z)` (noise-wobbled polyline corridors spawn↔village↔forest↔crags), consumed by terrain vertex coloring + scatter suppression + (optionally) critter wander bias. TDD.
6. **HUD reskin**: CSS overhaul to dark-panel style; compass gets tick marks + diamond; hotbar slots restyled; counters consolidated visually (same elements/handlers).
7. **Hands**: finger/thumb geometry + sleeve cuffs; held-item scale check.
8. **Village/windmill**: roof color variety, windmill prop on meadow-visible hill, house trim.
9. **Critters** (scope expanded mid-session by Spencer): full whimsical
   redesign — "more whimsical and varied, kinda like Neopets vibes", with four
   Neopets/plushie inspiration images provided. Round-3 rework of
   `src/critters/models.ts` (executed by codex gpt-5.6-sol with the images
   attached): bigger sclera+iris+highlight eyes, one unmistakable silhouette
   feature per species (ears/antennae/frills/plumes/wings), two-tone plush
   palettes, plump proportions. `CritterParts` animation contract and tri
   budgets preserved; verified in `?preview=critters`.
10. **Final sweep**: all biome snips + critter sheet vs reference; 936-test suite + e2e verify green; draw-call/fps sanity on medium.

## Verification

- `node e2e/fidelity.mjs` (PLAYWRIGHT_DIR-style env like verify.mjs) captures: meadow-path vista, meadow ground close-up, forest interior, crags vista, highlands, wetland shore, village+windmill, castle, night, hands+HUD, critter preview sheet. Compare page `docs/fidelity/compare.html` shows each next to the reference.
- Acceptance per snip: matches reference on (a) scatter density, (b) silhouette quality, (c) palette saturation, (d) HUD style — judged visually each iteration; iterate until no snip is the obvious weak link.
- `npm test` (936+) and `node e2e/verify.mjs` (28 checks) stay green; new pure modules (path math, scatter placement) get Vitest coverage.
