# Wildtag Blender source

Open `wildtag-art.blend` in Blender. The file opens on Puffle. Each `WT_*`
collection is a model entry in the Asset Browser; toggle its visibility to edit.
The file is an isolated library and does not depend on the other games' scenes.

- `design-reference.json.gz`: frozen original silhouettes, colors, mesh-local
  coordinates, and posed transforms. These are modeling references, not shipping art.
- `../../scripts/wildtag/blender/build_assets.py`: modeling, polish, budgets,
  logistics kit, and GLB export.
- `../../public/wildtag/`: shipping models, surface maps, and asset manifest.
- `../../docs/WILDTAG-REVAMP-REVIEW.md`: gameplay and visual design review.

## Rebuild

Use the existing local Blender MCP environment documented in
`docs/TINY-TIDE-ART.md`. No new server or saved Blender preferences are required.
The task uses the standard MCP Python client to call `execute_blender_code`.

To recapture design references after deliberately changing the original source:

```sh
node --experimental-transform-types scripts/wildtag/export-design.mjs
```

Run this from the project root through Blender MCP (adjust the absolute path if
moving the checkout):

```sh
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py eval "import importlib.util; spec=importlib.util.spec_from_file_location('wildtag_art', '/Users/spencerhenry/projects/wildtag/scripts/wildtag/blender/build_assets.py'); wt=importlib.util.module_from_spec(spec); spec.loader.exec_module(wt); print(wt.build(0,120))"
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/blender/surface_maps.py
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/blender/build_lods.py
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/blender/render_review.py
.codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/blender/present_library.py
python3 scripts/wildtag/check_assets.py
```

`build(start,end)` also supports slices: reference assets occupy indices 0–103;
new logistics assets occupy 104–119. Use smaller slices if your MCP timeout or
machine requires it. Export requests restrict selection to the active Wildtag
scene so unrelated Blender scenes never enter a shipping GLB.

The GLBs preserve each reference mesh's local coordinate frame. Do not apply
object transforms to their exported geometry: the runtime still owns the
original animation pivots. Custom logistics models use their exported scene
transforms directly. Blender-authored color attributes and normals are embedded;
there are no external model texture downloads or live Blender dependencies.

The 42 repeated scenery assets each have two Blender-generated distance variants
in `public/wildtag/lod/`. Rebuild these after changing their near meshes. The
runtime chooses detail by distance and object size, retaining large silhouettes
longer. Atlantis is exported with its original part ordering; its stationary
pieces merge by material after refinement, while seaweed stays animated.
