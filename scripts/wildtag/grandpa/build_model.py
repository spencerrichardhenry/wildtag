"""Author Grandpa Featherfoot through Blender MCP; preserve other open scenes.

Original fantasy running bird: saffron plumage, teal flight feathers, coral
crest, ivory eyebrows/beard, expressive inset eyes, springy bare legs.
All modeling coordinates are game X/right, Y/up, Z/forward.
"""
import bpy, math, json, importlib.util
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'public/wildtag/models/grandpa_featherfoot.glb'
ART = ROOT / 'art/wildtag/grandpa-featherfoot.blend'
REVIEW = ROOT / 'docs/grandpa/verify'
spec = importlib.util.spec_from_file_location('grandpa_geometry', ROOT / 'scripts/tiny-tide/blender/build_assets.py')
H = importlib.util.module_from_spec(spec); spec.loader.exec_module(H)
scene_name = 'Grandpa Featherfoot Studio'
old = bpy.data.scenes.get(scene_name)
if old:
    for obj in list(old.objects): bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(scene_name)
bpy.context.window.scene = scene
collection = bpy.data.collections.new('Grandpa Featherfoot'); scene.collection.children.link(collection)
H.CURRENT = collection
MATS = {}

def mat(kind='soft'):
    if kind in MATS: return MATS[kind]
    m = bpy.data.materials.get('Grandpa_' + kind) or bpy.data.materials.new('Grandpa_' + kind)
    m.use_nodes = True; nodes = m.node_tree.nodes; nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled'); tint = nodes.new('ShaderNodeVertexColor'); tint.layer_name = 'Tint'
    m.node_tree.links.new(tint.outputs['Color'], bsdf.inputs['Base Color']); m.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = .16 if kind == 'eye' else .66
    MATS[kind] = m; return m
H.mat = mat
GOLD = '#edb846'; LIGHT = '#ffe292'; OCHRE = '#c58430'; TEAL = '#398b87'; PALE = '#fff1cf'; CORAL = '#cf6244'; LEG = '#736448'; BEAK = '#a95b38'; DARK = '#172b32'

def orb(n, p, s, c=GOLD, parent=None, kind='soft', seg=16, rings=10):
    return H.ellipsoid(n, p, s, c, parent, kind=kind, seg=seg, rings=rings)
def tube(n, points, radii, c, parent=None):
    return H.tube(n, points, radii, c, parent, sides=8, steps=3)
def feather(n, a, b, width, c, parent):
    # A tapered, keeled feather rather than a stack of spherical blobs.
    a, b = Vector(a), Vector(b); axis = b - a
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < .01: side = axis.cross(Vector((0, 1, 0)))
    side.normalize(); normal = side.cross(axis).normalized()
    verts = []; faces = []
    for t, w in [(0, .28), (.28, .85), (.58, 1), (.82, .65), (1, .02)]:
        center = a + axis * t + normal * (math.sin(t * math.pi) * width * .18)
        for u, depth in [(-1, 0), (0, .2), (1, 0), (0, -.12)]:
            verts.append(tuple(center + side * u * w * width + normal * depth * width))
    for j in range(4):
        for k in range(4): faces.append((j*4+k, j*4+(k+1)%4, (j+1)*4+(k+1)%4, (j+1)*4+k))
    faces += [(3, 2, 1, 0), (16, 17, 18, 19)]
    return H.mesh(n, verts, faces, c, parent, smooth=False)

root = H.empty('gp_root')
body = H.empty('gp_body', (0, 2.55, 0), root)
orb('Pear shaped breast', (0, .18, .04), (.91, .89, .79), GOLD, body, seg=24, rings=16)
orb('Soft belly bib', (0, .03, .52), (.65, .68, .34), LIGHT, body)
orb('Round rump', (0, .02, -.4), (.8, .63, .63), OCHRE, body)
for side in [-1, 1]:
    for row in range(3):
        for j in range(4):
            x = side * (.5 + row * .13)
            feather('Layered flank feather', (x, .51-row*.3, .28-j*.24), (x*1.1, .03-row*.3, -.12-j*.24), .14, [GOLD, LIGHT, OCHRE][(j+row)%3], body)

# Flexible neck and a smaller, explicitly avian head on the large running body.
tube('Curving feather neck', [(0,.55,.34),(0,.89,.51),(0,1.13,.69)], [.36,.3,.35], GOLD, body)
head = H.empty('gp_head', (0, 1.1, .66), body)
orb('Bird skull', (0,.28,.05), (.52,.5,.48), GOLD, head, seg=24, rings=16)
orb('Cheek ruff', (0,.06,.11), (.53,.31,.4), LIGHT, head)
# Upper bill, hooked but friendly; lower bill and visible dark smiling seam.
H.loft('Sculpted upper beak', [(.31,.12,.29,.14),(.57,.12,.29,.17),(.94,.02,.12,.075),(1.05,-.035,.015,.02)], BEAK, head, seg=10)
H.loft('Lower bill', [(.34,-.085,.23,.065),(.61,-.1,.2,.06),(.92,-.08,.035,.02)], '#d28c4c', head, seg=10)
for side in [-1,1]:
    # Flat inset lens on each skull side, with a tiny warm highlight.
    orb('Inset eye', (side*.455,.32,.23), (.035,.16,.185), DARK, head, 'eye')
    orb('Eye glint', (side*.49,.38,.285), (.012,.044,.045), PALE, head, 'eye', seg=10, rings=6)
    tube('Knowing ivory brow', [(side*.40,.53,.36),(side*.51,.55,.22),(side*.54,.48,.055)], [.085,.095,.012], PALE, head)
    feather('Long eyebrow flick', (side*.48,.52,.18), (side*.7,.59,-.11), .07, PALE, head)
    orb('Nostril', (side*.145,.217,.65), (.03,.013,.045), DARK, head, seg=8, rings=6)
    for j in range(3):
        feather('White cheek whisker', (side*.31,-.035,.29-j*.1), (side*(.4+j*.06),-.42,.15-j*.12), .12, PALE, head)
for j in range(3):
    feather('Feather goatee', ((j-1)*.13,-.14,.32), ((j-1)*.07,-.67+abs(j-1)*.09,.37), .14, PALE, head)
for j in range(5):
    feather('Swept coral crest', ((j-2)*.12,.62,-.01), ((j-2)*.19,1.03-abs(j-2)*.085,-.43-abs(j-2)*.09), .13, CORAL if j%2 else OCHRE, head)

tail = H.empty('gp_tail', (0,.05,-.63), body)
for j in range(7):
    t = (j-3)/3
    feather('Long tail plume', (t*.25,0,-.04), (t*.9,.56-abs(t)*.3,-1.55+abs(t)*.35), .23, TEAL if j%2 else GOLD, tail)
for side, name in [(-1,'left'),(1,'right')]:
    wing = H.empty('gp_wing_'+name, (side*.8,.39,.05), body)
    orb('Tiny wing shoulder', (side*.08,-.14,-.02), (.25,.34,.26), GOLD, wing)
    for j in range(5):
        feather('Wing flight feather', (side*.12,-.06,-.12+j*.055), (side*(.22+j*.025),-.65+j*.045,-.54+j*.18), .135, TEAL if j<3 else LIGHT, wing)
    leg = H.empty('gp_leg_'+name, (side*.52,2.3,.02), root)
    orb('Feather shorts', (0,-.16,0), (.34,.4,.34), OCHRE, leg)
    tube('Upper spring leg', [(0,-.15,0),(0,-.5,.14),(0,-.78,.2)], [.16,.125,.12], LEG, leg)
    knee = H.empty('gp_knee_'+name, (0,-.78,.2), leg)
    orb('Knee', (0,0,0), (.145,.15,.14), LEG, knee)
    tube('Long scaled shin', [(0,0,0),(0,-.61,-.26),(0,-1.2,-.22)], [.11,.095,.105], LEG, knee)
    for j in range(6):
        orb('Shin scale', (0,-.2-j*.135,-.04-j*.022), (.115,.045,.10), '#aa925f', knee, seg=8, rings=6)
    foot = H.empty('gp_foot_'+name, (0,-1.2,-.22), knee)
    orb('Ankle', (0,-.07,.025), (.15,.15,.18), LEG, foot)
    for toe in [-1,0,1]:
        end = (toe*.24,-.18,.52-abs(toe)*.10)
        tube('Splayed gripping toe', [(0,-.08,.05),(toe*.13,-.15,.29),end], [.095,.085,.035], LEG, foot)
        tube('Ivory talon', [end,(end[0],-.14,end[2]+.12),(end[0],-.20,end[2]+.2)], [.05,.035,.002], PALE, foot)
    tube('Back toe', [(0,-.08,0),(0,-.16,-.23),(0,-.2,-.36)], [.08,.05,.002], PALE, foot)

# Merge only within each pivot/material: cheap draw count, independent motion.
for parent in [o for o in collection.objects if o.type == 'EMPTY']:
    for kind in ['soft','eye']:
        objs = [o for o in collection.objects if o.type=='MESH' and o.parent==parent and o.data.materials[0]==mat(kind)]
        if not objs: continue
        for o in scene.objects: o.select_set(False)
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join()
        bpy.context.object.name = 'grandpa_featherfoot_'+parent.name+'_'+kind
        bpy.context.object.select_set(False)

root['authoring'] = 'Blender MCP'; root['character'] = 'Grandpa Featherfoot'
OUT.parent.mkdir(parents=True,exist_ok=True); ART.parent.mkdir(parents=True,exist_ok=True); REVIEW.mkdir(parents=True,exist_ok=True)
for o in collection.objects: o.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_extras=True,export_animations=False)
tris = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in collection.objects if o.type=='MESH')
entry = dict(id='grandpa_featherfoot',category='visitor',triangles=tris,sourceTriangles=0,bytes=OUT.stat().st_size,parts=sum(o.type=='MESH' for o in collection.objects),authoring='Blender MCP')
manifest_path = ROOT/'public/wildtag/asset-manifest.json'; manifest=json.loads(manifest_path.read_text())
manifest['assets']=[a for a in manifest['assets'] if a['id']!=entry['id']]+[entry]
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
for o in collection.objects:o.select_set(False)

# Self-contained source and a three-quarter studio render, without other art.
scene.world = bpy.data.worlds.new('Grandpa warm studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.22,.24,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
for name,p,energy,size in [('Key',(-4,7,7),1100,5),('Fill',(5,4,2),800,4),('Rim',(1,6,-5),1300,3)]:
    data=bpy.data.lights.new('Grandpa '+name,'AREA'); data.energy=energy; data.shape='DISK';data.size=size
    light=bpy.data.objects.new('Grandpa '+name,data);scene.collection.objects.link(light);light.location=H.V(p)
    light.rotation_euler=(H.V((0,2.3,0))-light.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Grandpa Camera');cam=bpy.data.objects.new('Grandpa Camera',camdata);scene.collection.objects.link(cam)
cam.location=H.V((7,4.8,9));cam.rotation_euler=(H.V((0,2.4,0))-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO';camdata.ortho_scale=6.5;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=1024;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(REVIEW/'featherfoot-blender.png')
bpy.data.libraries.write(str(ART),{scene},compress=True)
print(json.dumps(entry),flush=True)
bpy.ops.render.render(write_still=True)
print('GRANDPA_FEATHERFOOT_COMPLETE',flush=True)
