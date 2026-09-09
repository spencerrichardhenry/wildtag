"""Save an editable Wildtag library opening on its Puffle, with all assets cataloged."""
import bpy
from mathutils import Vector
from pathlib import Path
ROOT=Path('/Users/spencerhenry/projects/wildtag')
scene=bpy.data.scenes['Wildtag Atelier'];bpy.context.window.scene=scene
for collection in scene.collection.children:
    if not collection.name.startswith('WT_'):continue
    collection.asset_mark();collection.asset_data.description='Wildtag original design, higher-fidelity Blender MCP geometry'
    visible=collection.name=='WT_critter_puffle';collection.hide_render=not visible
    for obj in collection.objects:obj.hide_set(not visible);obj.select_set(False)
source=bpy.data.collections['WT_critter_puffle']
bounds=[o.matrix_world@Vector(c) for o in source.objects for c in o.bound_box]
lo=Vector(tuple(min(v[i] for v in bounds) for i in range(3)));hi=Vector(tuple(max(v[i] for v in bounds) for i in range(3)));center=(lo+hi)*.5
camera=bpy.data.objects.get('Wildtag Library Camera')
if not camera:
    camera=bpy.data.objects.new('Wildtag Library Camera',bpy.data.cameras.new('Wildtag Library Camera'));scene.collection.objects.link(camera)
camera.location=center+Vector((2.5,-4,2));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3;scene.camera=camera
for name,delta,power in [('Key',(-3,-4,5),500),('Fill',(3,-2,3),220)]:
    obj=bpy.data.objects.get('Wildtag Library '+name)
    if not obj:
        light=bpy.data.lights.new('Wildtag Library '+name,'AREA');obj=bpy.data.objects.new(light.name,light);scene.collection.objects.link(obj)
    obj.data.energy=power;obj.data.shape='DISK';obj.data.size=4;obj.location=center+Vector(delta);obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=3;area.spaces.active.region_3d.view_location=center
        area.spaces.active.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
images={i for i in bpy.data.images if i.name.startswith('Wildtag_')}
bpy.data.libraries.write(str(ROOT/'art/wildtag/wildtag-art.blend'),{scene,*images},fake_user=True,compress=True)
print('Wildtag library presented and saved')
