"""Render a contact sheet of the shipping creature meshes in Blender."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/spencerhenry/projects/wildtag')
scene=bpy.data.scenes.get('Wildtag Creature Review') or bpy.data.scenes.new('Wildtag Creature Review')
bpy.context.window.scene=scene
for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.world=bpy.data.worlds.get('Wildtag Studio World')
ids=[a['id'] for a in json.loads((ROOT/'public/wildtag/asset-manifest.json').read_text())['assets'] if a['id'].startswith('critter_')]
for index,id in enumerate(ids):
    source=bpy.data.collections['WT_'+id]
    bounds=[o.matrix_world@Vector(corner) for o in source.objects if o.type=='MESH' for corner in o.bound_box]
    lo=Vector(tuple(min(v[k] for v in bounds) for k in range(3)));hi=Vector(tuple(max(v[k] for v in bounds) for k in range(3)))
    scale=2.45/max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z)
    center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    offset=Vector(((index%5-2)*3.7,(index//5-1.5)*3.7,0))
    for original in source.objects:
        if original.type!='MESH':continue
        obj=original.copy();obj.data=original.data;scene.collection.objects.link(obj)
        obj.matrix_world=original.matrix_world.copy();obj.location=(obj.location-center)*scale+offset;obj.scale*=scale;obj.hide_render=False;obj.hide_set(False)
    curve=bpy.data.curves.new(id+'_label','FONT');curve.body=id.removeprefix('critter_').upper();curve.size=.20;curve.align_x='CENTER'
    text=bpy.data.objects.new(id+'_label',curve);scene.collection.objects.link(text);text.location=offset+Vector((0,-1.55,.02))
    mat=bpy.data.materials.get('Wildtag label') or bpy.data.materials.new('Wildtag label');mat.diffuse_color=(.035,.09,.055,1);mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.035,.09,.055,1);curve.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.045));ground=bpy.context.object;ground.name='Review backdrop'
mat=bpy.data.materials.new('Wildtag review sage');mat.diffuse_color=(.43,.51,.42,1);ground.data.materials.append(mat)
camdata=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camdata);scene.collection.objects.link(camera)
camera.location=(0,-16,22);direction=Vector((0,0,0))-camera.location;camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=20;scene.camera=camera
for name,loc,power,size in [('Key',(-8,-8,15),2400,10),('Fill',(8,3,12),1900,9)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size;obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=1800;scene.render.resolution_y=1450;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'docs/wildtag/creature-library.png')
bpy.ops.render.render(write_still=True)
bpy.context.window.scene=bpy.data.scenes['Wildtag Atelier']
print('Rendered all 20 Wildtag species')
