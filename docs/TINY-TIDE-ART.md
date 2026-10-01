# Tiny Tide Blender art

All game models are original work authored in Blender 5.2. The first 50 assets
were built through the local [Blender MCP server](https://github.com/ahujasid/blender-mcp).
The 36 assets of the evolution update (creature parts, copepod and worm) were
built with the same script in headless Blender. The manifest records which
method built each asset.

- Editable library: `art/tiny-tide/tiny-tide-art.blend`
- Modeling and export source: `scripts/tiny-tide/blender/build_assets.py`
- Shipping files: `public/tiny-tide/models/`
- Inventory with triangle counts and byte sizes: `public/tiny-tide/asset-manifest.json`
- Local review renders: `.codex-drafts/tiny-tide-art/`

There are 86 assets:

- 34 creature parts (`part_<id>`), used by the creature editor
- 19 food models, including the copepod and the bristle worm
- 16 scenery assets
- 12 distinct planets
- 5 heroes from the fixed-form version

The runtime no longer shows the five heroes. The player creature is built at
runtime: the body is a skinned mesh generated from the genome, and the parts
are these GLBs attached to its bones. Heroes keep their Blender-authored
**Idle**, **Swim** and **Chomp** clips in the file and the checker still validates them.

Parts follow the conventions in [TINY-TIDE-EVOLUTION.md](TINY-TIDE-EVOLUTION.md#part-glb-conventions):
the origin is the attach point, +Y is the surface normal, +Z is forward, and
tintable surfaces use the `Tide_tint` material. Parts have no baked clips.
Their pivot empties carry glTF extras (`tt_pivot` = `jaw`, `seg`, `flap` or
`swing`, and `tt_index` for chain segments); the runtime animates them
procedurally. Each part root carries `tt_part`.

Animated empty pivots preserve separate fins, legs, antennae, wings, mouths
and tentacles, while meshes beneath each pivot are joined for efficient
rendering. Each asset lives in its own named Blender collection. Toggle
collection visibility to edit another model.

The style uses sculpted profiles, curved appendages, painted gradients, cream
eyes with teal pupils, warm blush and a small shared PBR palette. Vertex colors
keep the complete export library near 7 MiB without image texture downloads.
The terrain consists of one detailed center mesh and two open rings with shared
boundaries, so distant geometry never cuts through the small reef.

## Rebuild through MCP

The local MCP environment and upstream add-on are kept in the ignored
`.codex-drafts/blender-mcp/` directory. This setup does not change saved Blender
preferences. It uses `blender-mcp==1.9.1` in a Python 3.13 virtual environment,
the upstream `addon.py`, and the standard MCP Python client SDK. The client
disables telemetry and connects to the local add-on on port 9876.

Start a separate Blender session using:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --factory-startup --python scripts/tiny-tide/blender/mcp_bootstrap.py
```

Then author and export through the MCP tool:

```sh
.codex-drafts/blender-mcp/venv/bin/python scripts/tiny-tide/blender/mcp_client.py eval "import sys; sys.path.insert(0, 'scripts/tiny-tide/blender'); import build_assets as art; art.build(list(art.BUILDERS))"
```

For an iteration, reload the module and pass just the changed asset names to
`art.build([...])`. Use `art.render_asset('hero_shrimp')` to render an individual
asset in the Blender studio. The same command client supports `scene`, `list`,
and `code <python-file>` for MCP inspection and authoring. The build saves the
editable `.blend`, updates the manifest, and exports selected collections only.
Finish with `code scripts/tiny-tide/blender/present_library.py` to frame the
shrimp, mark collections for the Asset Browser, and save a clean editable file.

## Rebuild headless

The parts can also be rebuilt without MCP. Open the existing library, so the
save keeps the other assets:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b art/tiny-tide/tiny-tide-art.blend --python-expr "import sys; sys.path.insert(0, 'scripts/tiny-tide/blender'); import build_assets as art; art.AUTHORING = 'Blender (headless script)'; art.build(art.NEW_ASSETS)"
```

## Validation

```sh
python3 scripts/tiny-tide/blender/check_assets.py
npm run build
npm test -- --run tests/tiny-tide.test.ts
node e2e/tiny-tide.mjs
node e2e/tiny-tide-mobile.mjs
node e2e/tiny-tide-replay.mjs
```

The asset checker reads each actual GLB, checks embedded geometry and colors,
valid triangle indices, moving animation channels, export size and terrain
ring clearance. Browser tests exercise every food with real game controls,
all transformations, planetary completion and touch interactions. These are
desktop Chromium checks with mobile viewport/touch emulation; physical phone
GPU performance still depends on the device.
