"""Frame the editable art library after exporting. Execute through Blender MCP."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(bpy.data.filepath).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/tiny-tide/blender'))
import build_assets as art

art.render_asset('hero_shrimp')
for name in art.BUILDERS:
    collection = bpy.data.collections.get(name)
    if not collection:
        continue
    collection.hide_viewport = name != 'hero_shrimp'
    collection.hide_render = name != 'hero_shrimp'
    collection.asset_mark()
    collection.asset_data.description = 'Tiny Tide original Blender MCP asset: ' + name.replace('_', ' ')
    collection.asset_data.author = 'Tiny Tide'

bpy.ops.object.select_all(action='DESELECT')
root = next(o for o in bpy.data.collections['hero_shrimp'].objects if o.get('tiny_tide_asset') == 'hero_shrimp')
root.select_set(True)
bpy.context.view_layer.objects.active = root
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_distance = 7
            space.region_3d.view_location = Vector((0, .3, .25))
            space.region_3d.view_rotation = bpy.context.scene.camera.rotation_euler.to_quaternion()
            space.shading.type = 'MATERIAL'
            space.overlay.show_overlays = False
bpy.context.scene['Library guide'] = 'Each named collection is a model. Toggle collection visibility to edit; use the Asset Browser to browse. Build source: scripts/tiny-tide/blender/build_assets.py'
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/tiny-tide/tiny-tide-art.blend'), compress=True)
print('Saved the framed, editable Tiny Tide Blender asset library.')
