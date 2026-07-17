# Wildtag — Fidelity Pass (2026-07-17)

Spencer's brief: take the whole game up a notch graphically (~2-3× prettier) without hurting
smoothness; more scenery variety in the biomes (different kinds of trees, cliffs); Codex is good at
3D models — use it where helpful. Also: dismounting the Prismhorse feels wonky.

## F1 — Atmosphere & rendering (cheap, whole-scene wins)
- ACES filmic tone mapping + correct output color space; retuned sun (slightly warmer, higher
  intensity), hemisphere balance, fog color/distances per a golden-hour look.
- Terrain: smooth biome color BLENDING at borders (weighted blend instead of hard vertex pick),
  per-vertex micro color variation (hash-based jitter), subtle slope-based rock tint on steep
  faces, brighter sand ring. No geometry change.
- Sky: richer gradient (3-stop), soft sun disc + glow sprite. Water: nicer two-tone + fresnel-ish
  rim via vertex alpha if cheap.
- Optional (perf-gated): a single tight directional shadow map covering ~60m around the player,
  OFF by default at boot if measured fps < 40 on first 120 frames (auto-detect, persist choice).
- Mount dismount polish: dismount keeps planar ride momentum (no dead stop), small 2 m/s hop,
  camera height LERPS down over ~0.25s instead of popping, land beside—not inside—the mount.

## F2 — Scenery variety (instanced, budget-capped)
- Trees: 3 variants per forested biome — forest: tall pine / broadleaf dome / dead snag;
  meadow: lone oak-ish + flowering shrub; highlands: wind-bent pine + boulder-pine cluster;
  wetland: willow-ish drape + reeds clusters + lily pads on lakes; crags: gnarled juniper snag.
- Cliffs/rocks: crag mesa slabs + stacked boulder formations (2-3 composite builders), scattered
  scree; highlands rock ribs; meadow erratic boulders (rare).
- Ground cover: instanced crossed-quad grass tufts in meadow/forest (dense near player ring only,
  ~24m radius, rebuilt on cell change), forest glow-mushroom clusters, crag crystal clusters get a
  size/color variant range.
- Codex assist: use `codex exec` to draft 2-3 of the fancier builder functions (e.g. willow,
  mesa slab, broadleaf) as pure three.js builder code; integrate/adapt/review like any other code.
  Fall back to hand-built if output is unusable. Note provenance in ASSET note in README.
- All still procedural primitives + InstancedMesh; per-chunk instance caps; scatter densities
  tuned so total instances stay within ~1.5× current.

## Guardrails / done
- e2e 15/15 stays green; perf check must not regress below the current floor (record before/after
  fps in the report); all screenshots refreshed; biome tour visibly transformed (the reviewer
  should say "wow" or it isn't done).
