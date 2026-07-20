# Wildtag — Fidelity 2: "Beautiful, still light" (2026-07-20)

Spencer's brief: go from extremely blocky to fairly high-fidelity — a graphically beautiful but
low-intensity game (~"6×"). Implement behind a quality system so the floor stays playable
everywhere. Add perf tests that verify the changes. Work stays on a local branch, unmerged and
unpushed, until Spencer signs off (master auto-deploys).

## P1 — Foundations: quality presets + draw-call consolidation + perf harness

- **Quality presets** `low | medium | high` in a new `src/core/quality.ts`:
  - Auto-detect at boot (generalize the existing shadow fps-gate: software renderer → low;
    measure ~120 frames → <40fps drops a tier). URL `?quality=low|medium|high` overrides;
    user choice from the Esc menu persists (localStorage side key, not the save).
  - A `QUALITY` constants table maps preset → feature flags/values (shadowCascades, ssao, bloom,
    waterReflections, terrainDetailShader, nearLodEnabled, grassDensity multiplier, shadowRes).
  - Esc pause menu gets a quality selector (applies live where cheap; reload-required flags
    prompt a reload toast).
- **Draw-call consolidation (prerequisite)**: replace per-(chunk,kind) InstancedMesh with global
  per-kind instance POOLS (one InstancedMesh per prop kind, capacity-managed, chunk ranges
  allocated/freed on stream in/out). Target: total scene draw calls ≤ 250 at spawn (measured via
  renderer.info) vs ~500+ today.
- **Perf harness**:
  - Unit: chunk-build benchmark test generalized per LOD (budget ≤0.6ms/chunk LOD0 @1m,
    ≤0.4ms @2m, generous 3× machine-tolerance multiplier read from env).
  - e2e additions: (a) draw-call budget check — `renderer.info.render.calls ≤ 250` at spawn
    (exposed via `__game.renderStats()`); (b) per-preset boot check — `?quality=low|high` each
    boot clean, state reflects preset, low ≠ high in measured draw calls/features; (c) SwiftShader
    forces low automatically (existing floor stays meaningful); (d) fps per preset RECORDED in the
    e2e output (assert only against the low floor; high is informational on software renderers).

## P2 — Terrain & ground beauty (the blockiness killer)

- **Near-LOD terrain**: 1m-grid chunks within ~96m of the player (LOD0), current 2m elsewhere;
  ring boundary uses edge SKIRTS (drop rim verts ~0.4m) to hide T-junction seams. LOD0 rebuild
  budget respected via the existing buildsPerUpdate cap; chunk-build benchmark gates the cost.
- **Smooth shading** on terrain (per-vertex normals from the height grid — already computed) with
  the flat-shaded look retained only for props/critters (stylistic contrast is deliberate).
- **Vertex AO**: valley/concavity darkening baked into vertex colors from height-grid curvature
  (pure, tested); subtle slope/height tint refinements; palette pass tuned post-ACES.
- **Grass 2.0**: density ×4 on medium, ×8 on high (pool-instanced, one draw call), shader wind
  (vertex sway via onBeforeCompile time uniform — no per-frame JS matrix writes), wider 32m ring
  on high. Meadow flowers join the wind shader.
- **Water 1.5**: normal-perturbed animated surface (procedural ripple in shader), fresnel-ish
  rim, shore fade. (True reflections are P3/high.)

## P3 — Light & post (medium/high presets)

- **CSM shadows**: 2 cascades (near 40m sharp / far 160m soft), 2048px on high, 1024 on medium;
  low = no shadows. Replaces the single follow-light gate.
- **Terrain detail shader (medium+)**: triplanar procedural detail noise (albedo perturbation +
  cheap normal perturbation) via onBeforeCompile on the terrain material — no texture assets,
  keeps the stylized look but kills the flat-poly read up close.
- **Post pipeline (high)**: EffectComposer with bloom (soft threshold, subtle) + SSAO (half-res)
  + existing ACES output. Medium = no composer (direct render). Composer must be cleanly
  bypassable (low/medium path unchanged).
- **Prop/critter material upgrade**: Lambert → Standard (roughness tuned per kind) on medium+;
  emissives (crystals, lanterns, lumenstag) get bloom-friendly intensities.

## Guardrails / definition of done

- All suites green; e2e 15/15 + the new perf checks; draw-call budget met; low preset ≥ current
  fps on software render (record before/after numbers).
- Visual bar: side-by-side biome screenshots (low vs high) — high must read dramatically richer;
  low must look no worse than today.
- Free-flight invariant untouched (rendering-only phase); no gameplay constants change.
- NOTHING merged to master or pushed. Branch: build/fidelity-2.
