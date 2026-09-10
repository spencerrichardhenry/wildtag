# Castle and Atlantis atelier

`castle-and-atlantis.blend` contains the original Blender-authored district meshes
and furnishing kits for both rebuilt landmarks. The dedicated scene is
`Wildtag Castle and Atlantis`; other scenes in the running Blender session are
preserved. The two castle palettes use identical architecture.

Authoring uses the official Blender MCP server's `execute_blender_code` tool:

```sh
node scripts/wildtag/landmarks/layout.mjs
BLENDER_TIMEOUT_SECONDS=1200 .codex-drafts/blender-mcp/venv/bin/python scripts/wildtag/blender/mcp_client.py code scripts/wildtag/landmarks/build_models.py
python3 scripts/wildtag/check_assets.py
```

The bridge must be running in Blender on localhost port 9876. The project-local
MCP environment and bridge setup are described in `docs/TINY-TIDE-ART.md`.
The local script invokes that server through the standard MCP client SDK.

`src/landmarks/castle.json` and `atlantis.json` describe the walkable floors,
ramps, wall openings, roofs, props, records, airbells and discoveries. The same
layout feeds the Blender generator and the runtime spatial collision index.
The manifest records layout hashes, exact exported triangle counts and file
sizes; `check_assets.py` validates them against the actual GLBs.

All source geometry is authored through Blender. District geometry is joined
by material, with vertex-painted masonry, carved arches, bevels, stair nosings,
friezes, battlements and inlays. Furnishing kits include books, maps, market
stalls, a forge, thrones, coral planters, tablet shelves, pearl coffers, an
astrolabe and a rotating tide engine. Airbell pearls and the tidewheel retain
separate moving pivots.

At runtime, identical landmark materials are shared across GLBs. Stationary
pieces are batched per district; the large castle districts are subdivided
into spatial patches without removing any triangles. The original monolithic
castle/Atlantis GLBs remain as historical references, marked `load: false` so
normal game startup downloads the rebuilt versions only.

Two additional Blender-authored silhouette models supply the stationary shadow
passes. The full detailed meshes remain in beauty and ambient occlusion. Shadow
proxies are suppressed from both visible passes using renderer callbacks; the
animated pearls and tidewheel still cast their own live shadows.

Roof slabs own their exposed cap surface. The Blender generator fits supporting
masonry beneath those slabs and subtracts shared wall volumes, preventing the
coplanar faces that caused flickering on the keep, hall roofs and battlements.
This applies to both castle palettes and Atlantis's roof joins.

Atlantis's lower floors and stairs extend below the rippled seabed as solid
foundations. Four masonry piers carry the raised observatory while leaving the
back-road swim passage open. Floor thickness and pier walls feed the same
collision layout as the exported models.
