# Task: draft upgraded low-poly prop builders (wildtag fidelity pass)

You are drafting THREE.js procedural geometry builders for a stylized low-poly game.
Study `src/world/props.ts` first — especially the helpers `colored()`, `merge()`,
`cyl()`, `cone()`, `blob()`, `box()`, `oct()` and existing builders like
`buildBroadleaf`, `buildTree`, `buildRock`, `buildMushroom`, `buildGrasstuft`.

Write ONE file: `.codex-drafts/props-fidelity.ts` containing NEW builder functions
in exactly the same style (same helpers copied into the file so it's self-contained,
same `THREE.BufferGeometry` merged single-geometry return, vertex colors baked via
`colored`, no materials, no rng — variety comes from instance scale/yaw).

Style bar: dense saturated low-poly like Ghibli-meets-Crossy-Road. Chunky, faceted,
readable silhouettes. Each prop stands on y=0.

## Builders to draft (tri budget each ≈ 60–400; these get instanced hundreds of times)

1. `buildBroadleaf2()` — deciduous tree ~5m: FAT tapered faceted trunk (radius ~0.35
   at base), canopy of 4-6 overlapping icosphere lobes (detail 1) forming one big
   blobby crown, slightly lighter green on upper lobes. Trunk `#6f4d2f`, canopy
   `#4e8c3a` lower / `#669b45` upper.
2. `buildOak2()` — like buildBroadleaf2 but squatter+wider, 6 lobes, giant-capable.
3. `buildPine2()` — conifer ~5.5m: chunky trunk + 4 stacked faceted cone tiers with
   visible gaps between tiers, tiers get smaller upward, dark green `#2e6b45` with
   the top tier slightly lighter.
4. `buildFlowerPatch(color: number)` — 3 flowers in a tight clump: each = thin stem
   cyl `#3f7a35`, one small leaf, chunky head of 4-5 flat petal boxes/cones around a
   yellow `#f2c744` center blob. ~0.45m tall. (Called with pink #ea5f77,
   yellow #f2c744 w/ orange center, blue #5b7fe8.)
5. `buildMushroomRed()` / `buildMushroomYellow()` — chunky toadstool ~0.5m: fat cream
   `#efe5d0` stem, wide faceted cap (low-poly hemisphere, 7 segments) `#d95f4c` /
   `#e8a83c`, cap has a visible underside rim.
6. `buildBush()` — 2-3 overlapping faceted icosphere lobes, ~1.2m tall, mid-green
   `#4e8c3a`, sits fat on the ground.
7. `buildBushBerry()` — buildBush + 5-6 tiny red `#d95f4c` berry blobs on the surface.
8. `buildLog()` — fallen log ~2.2m long, horizontal faceted cylinder (7 seg) radius
   ~0.3 lying on ground (axis along X), bark `#795635`, both END CAPS lighter cut-wood
   `#c9a876` discs inset slightly, plus 1 short stub branch. Include a
   second smaller parallel log half-buried.
9. `buildTuft2()` — grass clump: 6-8 chunky TAPERED CONES (4 segments, slightly
   curved outward by tilting), NOT flat quads, heights 0.25-0.5m, splayed like a
   fountain. Green `#5da03f` with tips slightly lighter (bake a two-tone: darker at
   base). Must read as grass from 2m away.
10. `buildPebbleCluster()` — 3-4 small faceted rocks `#7b828c` of varied size, ~0.3m.
11. `buildWindmill()` — village windmill ~9m: tapered faceted tower (6-sided,
    cream `#e8dcc8` walls, brown trim), small pitched cap roof `#8a4a3a`, 4 blades
    (thin boxes w/ lattice feel via 2 crossed thinner boxes each) on a front hub,
    blades as a SEPARATE returned geometry so the game can spin them:
    return `{ tower: BufferGeometry, blades: BufferGeometry }` for this one only —
    blades centered on origin, hub position documented in a comment.

## Rules
- Self-contained file: import only `three` + BufferGeometryUtils.mergeGeometries.
- Every other builder returns a single merged `THREE.BufferGeometry` with vertex
  colors, non-indexed (mirror `colored()`'s toNonIndexed + color attr approach).
- Flat-shaded look comes from faceting (compute nothing; the game's materials use
  flatShading where needed) — keep facets visible, no smooth high-seg spheres.
- Comment each builder with its approx height and tri count.
- TypeScript, no `any`. It must compile with `npx tsc --noEmit` given the repo's
  tsconfig (you may run that to check, but do NOT modify any file outside
  .codex-drafts/).
