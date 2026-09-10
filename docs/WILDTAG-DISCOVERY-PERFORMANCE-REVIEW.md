# Discovery performance follow-up

This pass removes redundant saves and reduces rendering work while retaining
all 18 Blender scenes, their geometry, materials and independent animations.

## Changes

**Save only new memories.** Discovery interactions distinguish a newly
remembered visit from a handled repeat. Only the new visit serializes and
writes the game. Cooldown presses still consume F, so they cannot accidentally
fall through to harvesting, but perform no saves. Existing autosave and manual
save behavior remains in place.

**Batch compatible pieces inside animation pivots.** Two Blender materials
had identical shading but different names. They now share a material, and
pieces within each moving pivot can merge into one mesh. A nested wing,
hinge or orbiter retains its own pivot. Static mesh transforms are cached.

**Remove distant scenes from renderer traversal.** Beyond the existing
190-metre visibility limit, a discovery detaches from the scene graph.
Previously its invisible descendants still received world-matrix updates.
Returning to range reattaches the same objects; it does not reload their art.
Animation still stops beyond 65 metres.

**Avoid redundant UI work.** The interaction prompt changes its DOM only when
its target or visibility changes. Scenery clearing uses squared distance.

## Controlled measurements

The benchmark uses Chrome on Apple M5/ANGLE Metal, high quality and a
1440×900 viewport at DPR 2. Uncapped comparisons use the same loaded world and
camera, freeze the world clock and animation pose, then sample discoveries
**on / off / off / on**. Each window has 100 warmup frames and 359 measured
intervals. Terrain, collision, vegetation clearings and creature positions
remain identical within the comparison. This isolates presentation costs;
it does not measure live simulation cost while running between biomes.

The code also retains a developer-only `?dev=1&wonders=off` boot option for
cold-load comparisons. This omits the discovery assets and presentation while
keeping the rest of the test world the same. It is a profiling fixture.

Raw measurements:

- [Original on/off and cold-load audit](wildtag/discoveries/performance-audit-baseline-all.json)
- [Final on/off rendering audit](wildtag/discoveries/performance-audit-final-pairs.json)
- [Optimized build cold-load audit](wildtag/discoveries/performance-audit-final-all.json)
- [Comparison summary](wildtag/discoveries/performance-audit-summary.json)

The following counts are **added discovery draw calls**: rendering on minus
rendering off in the same view, including shadow and post-processing passes.
They are not the total world draw counts.

| View | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Castle Crown Walk | 34 | 30 | 12% |
| Atlantis nave | 5 | 4 | 20% |
| Sky sanctuary | 7 | 6 | 14% |
| Bumblepost | 32 | 26 | 19% |
| Woodpecker workshop | 26 | 18 | 31% |
| Reed Organ | 84 | 59 | 30% |
| Kite Garden | 37 | 24 | 35% |

Haven's comparison has no visible discovery draws in either version. Its
distance-culling benefit is removal of invisible scene traversal.

With discoveries enabled, final uncapped throughput ranged from **101 to
140 FPS** across the eight views. Within-world frame-time differences ranged
from **−0.46 to +0.53 ms** when toggling discoveries. Negative values illustrate
measurement variation; they are not evidence that adding geometry makes the
world faster. These small costs and the draw reductions do not establish a
large overall FPS improvement.

Uncapped results measure actual frame delivery rather than stopping at a
60 FPS ceiling. The asynchronous GPU timer is retained as diagnostic data;
its queued timings in uncapped Chrome should not be read as a per-frame budget.
Small time differences vary across windows, so draw counts provide the clearest
evidence of reduced work. Frozen comparisons are supplemented by the interactive
playthrough and normal refresh-limited performance runs.

The final normal-play runs each measured 479 frame intervals, with creatures
and animation running. All four held **60.0 FPS**, **16.8 ms p99** and **zero
frames over 50 ms** at high quality/DPR 2:

- [Sky sanctuary](wildtag/performance-wonders-optimized-sky-sanctuary.json)
- [Castle Crown Walk](wildtag/performance-wonders-optimized-castle-crown.json)
- [Active Reed Organ](wildtag/performance-wonders-optimized-wonder-reed-organ.json)
- [Active Kite Garden](wildtag/performance-wonders-optimized-wonder-kite-garden.json)

## Loading and fidelity decision

All 18 models still load before play. They add **18 requests and 1.84 MiB** to
approximately 63.94 MiB of other startup resources in this fixture.

Cold tests use a fresh browser context with HTTP caching disabled, 20 ms
latency and a 20 MiB/s download limit. Three samples per configuration are
counterbalanced in order. Before optimization, median game-ready time was
**4.074 seconds with discoveries versus 3.947 seconds without**: an extra
**127 ms**. After optimization, the corresponding times were **4.103 versus
3.988 seconds**, an extra **115 ms**. This does not establish an overall
startup speedup; the download payload remains the same. The first rendered
frame is recorded separately in the reports.

Given that cost, the current decision is to keep the scenes ready before
exploration. Streaming them on approach would trade this small startup cost
for runtime decoding and possible pop-in. Slower connections will pay more
for those bytes; these measurements do not represent mobile network speeds.

No polygon reduction was applied. The full collection is only 73,678 source
triangles; reducing redundant draw submissions preserves the visible details
and avoids adding another set of LOD downloads. The existing distance limits
bound both visibility and animation work.

## Verification

- Production TypeScript/Vite build passes.
- 119 tests pass across discovery geometry, nested animation, save semantics,
  static merging, castle/Atlantis architecture, sky traversal and prop LODs.
- Actual GLB tests confirm unchanged triangle counts and world bounds after
  batching, preserved motion pivots and correct dynamic-shadow flags.
- All 18 first visits save exactly once in Chrome. Four additional cooldown
  presses plus a later repeat produce zero additional saves for every site.
- Every interaction leaves inventory unchanged, and all memories survive
  save/reload. The hollow passage and menu behavior still pass.
- Screenshots of the optimized scenes are in the
  [discovery verification folder](wildtag/discoveries/).

## Reproduce

```sh
AUDIT_LABEL=final node e2e/wildtag-discovery-performance.mjs
node e2e/wildtag-discoveries.mjs
```

`VERIFY_URL` selects another local build, `AUDIT_MODE=pairs` runs only the
uncapped comparisons, and `AUDIT_MODE=cold` runs only startup tests. Run GPU
benchmarks sequentially, with other automated game browsers closed.
