"""Start the upstream Blender MCP add-on in a separate, unsaved art session."""
import bpy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
addon_path = ROOT / '.codex-drafts/blender-mcp/addon.py'
spec = importlib.util.spec_from_file_location('tiny_tide_blender_mcp', addon_path)
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.register()
# The task's adapter only listens on this computer. No preferences are saved.
server = getattr(bpy.types, 'blendermcp_server', None)
if not server or not server.running:
    server = addon.BlenderMCPServer(host='127.0.0.1', port=9876)
    bpy.types.blendermcp_server = server
    server.start()
bpy.context.scene.blendermcp_server_running = server.running
bpy.context.scene.name = 'Tiny Tide Art Studio'
print('TINY_TIDE_BLENDER_MCP_READY', flush=True)
