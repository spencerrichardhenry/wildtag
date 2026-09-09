"""Build medium/far scenery from the shipping GLBs through Blender MCP.

Run with mcp_client.py code. Uses a temporary isolated scene and preserves the
active authoring scene. Near meshes, local coordinates and vertex paint remain
unchanged; only these distance variants are simplified.
"""
import bpy
import bmesh
import json
from pathlib import Path

ROOT = Path('/Users/spencerhenry/projects/wildtag')
OUT = ROOT / 'public/wildtag/lod'
OUT.mkdir(parents=True, exist_ok=True)
manifest_path = ROOT / 'public/wildtag/asset-manifest.json'
manifest = json.loads(manifest_path.read_text())
original_scene = bpy.context.window.scene
scene = bpy.data.scenes.new('Wildtag LOD Export')
bpy.context.window.scene = scene
try:
    for asset in manifest['assets']:
        if not asset['id'].startswith('prop_'):
            continue
        bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/wildtag/models' / (asset['id'] + '.glb')))
        sources = [o for o in scene.objects if o.type == 'MESH']
        assert len(sources) == 1, asset['id']
        source = sources[0]
        source.hide_set(True)
        asset['lods'] = []
        for level, ratio in [(1, .35), (2, .12)]:
            obj = source.copy()
            obj.data = source.data.copy()
            obj.name = f"{asset['id']}_lod{level}"
            scene.collection.objects.link(obj)
            obj.hide_set(False)
            # glTF splits vertices at normal/color seams. Weld before collapse
            # so bevel strips simplify instead of detaching from their faces.
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.00001)
            bm.to_mesh(obj.data)
            bm.free()
            for other in scene.objects:
                other.select_set(False)
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new('Distance silhouette budget', 'DECIMATE')
            mod.ratio = max(ratio, 24 / asset['triangles'])
            bpy.ops.object.modifier_apply(modifier=mod.name)
            obj.data.calc_loop_triangles()
            tris = len(obj.data.loop_triangles)
            filename = f"{asset['id']}_lod{level}.glb"
            path = OUT / filename
            bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                use_selection=True, use_active_scene=True, export_apply=True,
                export_yup=True, export_animations=False)
            asset['lods'].append({'level': level, 'path': 'lod/' + filename,
                'triangles': tris, 'bytes': path.stat().st_size, 'authoring': 'Blender MCP'})
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)
        for obj in list(scene.objects):
            data = obj.data if obj.type == 'MESH' else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if data and data.users == 0:
                bpy.data.meshes.remove(data)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'assets': sum('lods' in a for a in manifest['assets']),
        'variants': sum(len(a.get('lods', [])) for a in manifest['assets']),
        'triangles': sum(l['triangles'] for a in manifest['assets'] for l in a.get('lods', []))}))
finally:
    bpy.context.window.scene = original_scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(scene)
