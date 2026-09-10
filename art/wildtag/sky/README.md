# Sky Kingdom source

`sky-kingdom.blend` contains the dedicated **Wildtag Sky Kingdom** Blender scene.
Its 23 assets were authored through Blender MCP and exported as local GLBs.
The previous Blender scene is restored after each authoring run.

Run `scripts/wildtag/sky/build_kingdom.py` through the existing MCP client to
rebuild. The client supplies `__file__`, so the script resolves repository paths
without relying on a machine-specific project location. Geometry and physics
share `src/sky/layout-data.json`; the asset manifest records its SHA-256 hash.

City sectors have merged painted geometry. Creature wing/head/body/tail pivots,
and drone rotor/membrane pivots, carry `part` metadata in their GLB nodes for
runtime animation. Original assets use cream cloudstone, teal roofs, brass,
feathers and painted colors; no third-party models or textures are included.

See [the system review](../../../docs/WILDTAG-SKY-KINGDOM-REVIEW.md) for routes,
mechanics, rewards and verification.
