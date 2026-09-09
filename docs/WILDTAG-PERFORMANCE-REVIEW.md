# Wildtag performance review

The revamp retains its full-detail nearby art while using substantially less
rendering work. In Chrome tests on the **Apple M5 GPU**, High quality at Retina
resolution went from roughly **38 FPS to a steady 60 FPS** around Haven. An
uncapped comparison measured **38 → 91 FPS**, providing headroom beyond the
headless browser's normal 60 Hz cadence.

Open `wildtag.html?dev=1` for the performance overlay. Swimming controls are now
**Q to dive / E to rise**. Q remains dash on land; Space remains jump/glide and
Ctrl remains the building snap modifier. Help text and both dive warnings match.

## Decisions and tradeoffs

### Distance and size determine scenery detail

All 42 repeated scenery assets now have two additional **Blender MCP-authored
GLBs**, with approximately 35% and 12% of their original triangles. Nearby models,
placements, resource nodes and collision shapes remain intact.

On High, small objects use nominal detail bands of 32 m and 88 m. Large objects
retain detail proportionally farther away. The first trial used distance alone;
screenshot comparison exposed angular tree canopies, so I added this size
adjustment. An 8 m base hysteresis band prevents repeated switches at a boundary.
Medium and Low use shorter bands.

Switching geometry reuses the existing batched instance, preserving its position,
color and harvest state. In a controlled High-quality Haven comparison:

| Same 12,681 scenery placements | Full detail everywhere | Distance detail |
| --- | ---: | ---: |
| Triangles submitted across the whole frame | 11.06 million | 3.05 million |
| FPS at Retina resolution | 48.4 | 60.0 |

That is approximately **72% fewer submitted triangles**, with the other renderer
optimizations enabled in both runs. Counts include shadow and post passes.
Raw measurements: [full detail](wildtag/performance-lod-disabled.json),
[distance detail](wildtag/performance-final-haven.json).

The 84 variants add about 1.9 MiB to the model library, now about 34.5 MiB.
See [the art README](../art/wildtag/README.md) for rebuilding through Blender MCP.

### Shadows update once per display frame

Ambient occlusion renders the scene again to obtain normals. Previously, that
also rendered both shadow maps again. Updates are now requested once at the
start of each display frame. Moving shadows still update every frame.

This isolated change reduced the Haven frame from approximately **1,159 to 893
draws**, and CPU render time from **7.1 to 5.6 ms**. It does not lower shadow
resolution or update frequency.

### Ambient occlusion uses half resolution

The quality preset described half-resolution SSAO, but allocated full-resolution
targets at startup. It now uses half the drawing-buffer width and height,
including device pixel ratio, consistently on startup and resize. Those passes
process 75% fewer pixels. The main scene and UI retain their existing resolution.
Contact shading is less finely sampled; the full-resolution color image stays sharp.
Post-processing passes also release their render targets when disposed.

### Opaque scenery skips sorting

Chrome profiling identified sorting thousands of opaque props before each scene
and shadow pass as a CPU cost. Per-instance frustum culling remains enabled.
Transparent objects retain their existing ordering.

The same traversal measured **5.0 → 3.8 ms CPU render time**, with identical
triangle counts and similar GPU query intervals. This was tested as an A/B
change. The controls are documented in
[Three.js's BatchedMesh API](https://threejs.org/docs/pages/BatchedMesh.html).

### Static underwater pieces share draws

Atlantis's columns, walls and coral now merge by exact material after applying
the Blender geometry. Vertex positions, normals, materials and triangle detail
are retained. Seaweed keeps its animation pivots; creatures remain independent.

This removes hundreds of independently submitted meshes. Merging makes culling
coarser for these small static batches, a worthwhile tradeoff for their modest
geometry. Before/after palace screenshots were inspected. Shared art materials
also avoid repeated shader invalidation when their shading mode is already correct.

### The camera follows display frames

Physics still runs at 60 Hz. The displayed eye interpolates between completed
simulation steps; mouse look updates every rendered frame. This avoids repeated
camera positions on high-refresh displays or irregular frame cadences.

Position interpolation introduces at most one simulation step of visual delay
(16.7 ms at normal speed); mouse look is immediate. Gameplay raycasts retain the
current simulation pose. Teleports, recovery and tab resume reset interpolation
so the view does not travel through intervening terrain.

### Dev measurements cover the whole frame

`?dev=1` displays FPS, average and p95 frame time, CPU simulation/render durations,
an optional asynchronous GPU timer, quality, pixel ratio, draws and triangles.
The overlay refreshes four times per second over a bounded recent window.
Backgrounding resets that window. Normal sessions create no overlay or CPU/GPU
timing instrumentation.

CPU values are elapsed JavaScript times and can include driver waits. GPU query
intervals are asynchronous, driver-dependent and can include scheduling time;
they are not additive with CPU time or a guaranteed FPS limit. Actual frame
cadence is the primary comparison. Unsupported GPUs display “unavailable.”

Counters now cover **all passes in a frame**. The old High-quality counter
reported only the final fullscreen triangle, so its draw/triangle totals cannot
be directly compared with the new totals.

## Measurements

Production builds, desktop Chrome using ANGLE Metal on Apple M5, High quality,
1440 × 900 CSS pixels at 2× device pixel ratio (2880 × 1800 rendering), unless
specified. Runs had 90 warmup frames and 119–359 measured intervals; latest
checks use 359. Comparisons ran sequentially.

| View / scenario | Before FPS | After FPS | After p95 frame time |
| --- | ---: | ---: | ---: |
| Haven | 37.8 | 60.0 | 16.8 ms |
| Forest | 38.9 | 60.0 | 16.8 ms |
| Nighttime castle | 52.7 | 60.0 | 16.8 ms |
| Underwater palace, fully warmed | 60.0 | 60.0 | 16.8 ms |
| Six extractors with six assigned haulers | — | 60.0 | 16.8 ms |
| Fast scripted traversal | — | 60.0 | 16.7 ms |
| Haven at 3840 × 2160 rendering | — | 60.0 | 16.8 ms |
| Haven, Chrome frame cap disabled | 38.0 | 90.5 | 13.1 ms |

The final Haven, supply-network, traversal, 4K and warmed underwater captures had
no measured frames above 50 ms. An earlier underwater trial slowed simulation
before warming terrain, causing entry hitches. That intermediate evidence is
retained, but the table uses full-speed, fully warmed runs.

These are short local tests, not guarantees for every device, browser, save or
thermal condition. Uncapped headless results measure throughput; they do not
prove a physical display's refresh rate or eliminate compositing costs.

### Visual comparisons

| View | Before | After |
| --- | --- | --- |
| Haven | [Screenshot](wildtag/performance-baseline-retina.png) | [Screenshot](wildtag/performance-final-haven.png) |
| Forest | [Screenshot](wildtag/performance-baseline-forest.png) | [Screenshot](wildtag/performance-current-forest.png) |
| Castle | [Screenshot](wildtag/performance-baseline-castle.png) | [Screenshot](wildtag/performance-current-castle.png) |
| Palace | [Screenshot](wildtag/performance-lagoon-original.png) | [Screenshot](wildtag/performance-lagoon-merged.png) |

## Verification and reproduction

- **1,048 tests across 60 files pass** in the full-suite run, including streaming
  churn, collision consistency, LOD hysteresis, camera interpolation and merging.
  Two additional post-pipeline tests pass, checking native/half-resolution targets
  at three pixel ratios, resize behavior and disposal: **1,050 tests total**.
- `npm run build` passes, with the existing large-bundle warning.
- `python3 scripts/wildtag/check_assets.py` validates all 120 models and 84 LODs.
- `e2e/wildtag-controls.mjs` verifies pointer lock and keyboard-driven Q/E swimming,
  removal of Ctrl/Space swimming, between-step camera motion, teleport reset,
  resizing with High-quality effects, and absence of profiling in normal sessions.
- The supply-route browser test still completes gathering, research, construction,
  bonding, assignment, delivery, recall and save/reload.
- Final browser captures report no JavaScript, shader or resource-loading errors.

Run a local production preview, then:

```sh
PERF_GPU=metal PERF_DPR=2 PERF_LABEL=my-run \
  VERIFY_URL=http://127.0.0.1:5209/wildtag/wildtag.html \
  node e2e/wildtag-performance.mjs
```

Use `PERF_SCENE=forest|castle|lagoon|industry|traverse`, `PERF_UNCAPPED=1`,
`PERF_FRAMES=360`, or `PERF_PROFILE=1` for other captures. Width and height are
configurable with `PERF_WIDTH` / `PERF_HEIGHT`. Omitting `PERF_GPU=metal` uses
SwiftShader for compatibility; its FPS is not a hardware benchmark.

For dev comparisons, `&lod=0` disables scenery LOD and `&sortProps=1` restores
opaque-prop sorting. Both require `?dev=1`. Measurement JSON files are alongside
the screenshots. CPU profiles and intermediate screenshots remain in the ignored
`.codex-drafts` working folder.

## Next useful targets

Keep High quality as the starting point on this machine. On slower devices,
measure the actual world before changing global fidelity. Asset streaming/boot
latency and very large player-built bases are the next useful profiling targets.
If pixel cost dominates on weaker GPUs, a separate render-scale setting could
preserve geometry, lighting and animation while offering a resolution tradeoff.
This pass keeps the default rendering resolution and scenery density.
