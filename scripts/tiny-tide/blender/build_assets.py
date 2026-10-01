"""Tiny Tide's original Blender art kit. Execute through Blender MCP.

Coordinates in modeling helpers are game coordinates: X right, Y up, Z forward.
The helper conversion authors them in Blender's Z-up coordinate system.
Materials use painted vertex colors and a small shared PBR material set so the
models retain their gradients without large textures on mobile.
"""
import bpy
import bmesh
import math
import random
import json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'public/tiny-tide/models'
ART = ROOT / 'art/tiny-tide'
RENDERS = ROOT / '.codex-drafts/tiny-tide-art'
TAU = math.pi * 2
MATS = {}
MANIFEST = json.loads((ROOT/'public/tiny-tide/asset-manifest.json').read_text()) if (ROOT/'public/tiny-tide/asset-manifest.json').exists() else {}
CURRENT = None
# Records who authored a build. Headless batch runs set this to 'Blender (headless script)'.
AUTHORING = 'Blender MCP'
# Part builders paint 'tint' surfaces over one shared part-space height span, and
# record pivot positions so meshes beneath a pivot are authored in part space.
TINT_SPAN = None
PW = {}


def V(p): return Vector((p[0], -p[2], p[1]))
def color(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x < .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)
def mix(a, b, f): return tuple(a[i] * (1-f) + b[i] * f for i in range(3))

def mat(kind='soft'):
    if kind in MATS and MATS[kind].name in bpy.data.materials: return MATS[kind]
    m = bpy.data.materials.get('Tide_' + kind) or bpy.data.materials.new('Tide_' + kind)
    m.use_nodes = True; nodes=m.node_tree.nodes; nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial'); bsdf=nodes.new('ShaderNodeBsdfPrincipled'); paint=nodes.new('ShaderNodeVertexColor');paint.layer_name='Tint'
    m.node_tree.links.new(paint.outputs['Color'], bsdf.inputs['Base Color']);m.node_tree.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value={'soft':.43,'tint':.43,'eye':.13,'leaf':.67,'rock':.82,'glow':.3}[kind]
    bsdf.inputs['Metallic'].default_value=.1 if kind=='eye' else 0
    if kind in ('soft','tint'): bsdf.inputs['Subsurface Weight'].default_value=.045
    if kind=='glow':m.node_tree.links.new(paint.outputs['Color'],bsdf.inputs['Emission Color']);bsdf.inputs['Emission Strength'].default_value=.65
    MATS[kind]=m;return m

def paint(obj, hexcolor, kind='soft', gradient=True, bottom=None):
    if kind=='tint' and bottom is None:bottom='#c9c4bd'
    obj.data.materials.clear();obj.data.materials.append(mat(kind)); base=color(hexcolor); lower=color(bottom) if bottom else tuple(c*.76 for c in base)
    attr=obj.data.color_attributes.get('Tint') or obj.data.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT')
    zvals=[v.co.z for v in obj.data.vertices]; lo=min(zvals,default=0); span=max(zvals,default=1)-lo or 1
    if kind=='tint' and TINT_SPAN:lo,span=TINT_SPAN[0],TINT_SPAN[1]-TINT_SPAN[0]
    for v in obj.data.vertices:
        t=max(0,min(1,(v.co.z-lo)/span)); c=mix(lower,base,.35+.65*t) if gradient else base
        attr.data[v.index].color=(*c,1)
    obj.data.color_attributes.active_color=attr
    for poly in obj.data.polygons:poly.use_smooth=True
    return obj

def empty(name, p=(0,0,0), parent=None):
    o=bpy.data.objects.new(name,None);CURRENT.objects.link(o);o.location=V(p);o.parent=parent;return o

def mesh(name, verts, faces, c, parent=None, kind='soft', smooth=True, bottom=None):
    data=bpy.data.meshes.new(name+'_mesh');data.from_pydata([V(v) for v in verts],[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
    o=bpy.data.objects.new(name,data);CURRENT.objects.link(o);o.parent=parent;paint(o,c,kind,bottom=bottom)
    if parent is not None and parent.as_pointer() in PW:data.transform(Matrix.Translation(-V(PW[parent.as_pointer()])))
    if not smooth:
        for p in data.polygons:p.use_smooth=False
    return o

def ellipsoid(name,p,s,c,parent=None,kind='soft',seg=24,rings=16,bottom=None):
    verts=[(p[0],p[1]+s[1],p[2])];faces=[]
    for j in range(1,rings):
        phi=math.pi*j/rings
        for i in range(seg):
            a=TAU*i/seg;verts.append((p[0]+s[0]*math.sin(phi)*math.cos(a),p[1]+s[1]*math.cos(phi),p[2]+s[2]*math.sin(phi)*math.sin(a)))
    verts.append((p[0],p[1]-s[1],p[2]));bottom_id=len(verts)-1
    for i in range(seg):faces.append((0,1+i,1+(i+1)%seg))
    for j in range(rings-2):
        for i in range(seg):a=1+j*seg+i;b=1+j*seg+(i+1)%seg;faces.append((a,a+seg,b+seg,b))
    for i in range(seg):faces.append((bottom_id,1+(rings-2)*seg+(i+1)%seg,1+(rings-2)*seg+i))
    return mesh(name,verts,faces,c,parent,kind,bottom=bottom)

def tube(name,points,radii,c,parent=None,sides=8,kind='soft',steps=5,bottom=None):
    # Catmull-Rom interpolation, with transported circular sections and taper.
    ps=[Vector(p) for p in points];rs=radii if isinstance(radii,(list,tuple)) else [radii]*len(points)
    coords=[];rads=[]
    for i in range(len(ps)-1):
        a=ps[max(0,i-1)];b=ps[i];d=ps[i+1];e=ps[min(len(ps)-1,i+2)]
        for j in range(steps):
            t=j/steps;coords.append(.5*((2*b)+(-a+d)*t+(2*a-5*b+4*d-e)*t*t+(-a+3*b-3*d+e)*t*t*t));rads.append(rs[i]*(1-t)+rs[i+1]*t)
    coords.append(ps[-1]);rads.append(rs[-1]);verts=[];faces=[]
    previous_n=None
    for j,p in enumerate(coords):
        tangent=(coords[min(len(coords)-1,j+1)]-coords[max(0,j-1)]).normalized();ref=Vector((0,1,0)) if abs(tangent.y)<.95 else Vector((1,0,0));n=(previous_n-tangent*previous_n.dot(tangent)).normalized() if previous_n is not None else tangent.cross(ref).normalized();b=tangent.cross(n).normalized();previous_n=n
        for i in range(sides):a=TAU*i/sides;v=p+(n*math.cos(a)+b*math.sin(a))*rads[j];verts.append(tuple(v))
    for j in range(len(coords)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;faces.append((a,b,b+sides,a+sides))
    faces.append(tuple(reversed(range(sides))));faces.append(tuple((len(coords)-1)*sides+i for i in range(sides)))
    return mesh(name,verts,faces,c,parent,kind,bottom=bottom)

def loft(name,profiles,c,parent=None,seg=32,bottom=None):
    # Profiles are (forward position, vertical center, width, height).
    verts=[];faces=[]
    for z,y,rx,ry in profiles:
        for i in range(seg):a=TAU*i/seg;verts.append((rx*math.cos(a),y+ry*math.sin(a),z))
    for j in range(len(profiles)-1):
        for i in range(seg):a=j*seg+i;b=j*seg+(i+1)%seg;faces.append((a,b,b+seg,a+seg))
    faces.append(tuple(reversed(range(seg))));faces.append(tuple((len(profiles)-1)*seg+i for i in range(seg)))
    return mesh(name,verts,faces,c,parent,bottom=bottom)

def fan(name,root,edge,c,parent=None,thickness=.045,kind='soft',ribs=False):
    verts=[root];n=len(edge)
    for factor in [.32,.7,1]:
        for i,p in enumerate(edge):
            v=tuple(root[k]+(p[k]-root[k])*factor for k in range(3));v=(v[0],v[1]+math.sin(i*2.2)*.025*factor,v[2]);verts.append(v)
    faces=[]
    for i in range(n-1):faces.append((0,1+i,2+i))
    for j in range(2):
        for i in range(n-1):a=1+j*n+i;faces.append((a,a+n,a+n+1,a+1))
    o=mesh(name,verts,faces,c,parent,kind);solid=o.modifiers.new('Soft edge thickness','SOLIDIFY');solid.thickness=thickness
    apply_mod(o,solid)
    if ribs:
        for i in range(1,len(edge)-1,2):tube(name+'_rib', [root,tuple((root[k]+edge[i][k])*.5 for k in range(3)),edge[i]], [.012,.016,.008], '#ffe6bc',parent,sides=5,steps=3)
    return o

def apply_mod(o,modifier):
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    try:bpy.ops.object.modifier_apply(modifier=modifier.name)
    finally:o.select_set(False)

def box(name,p,s,c,parent=None,bevel=.06,kind='soft',segments=3):
    x,y,z=p;a,b,d=[v*.5 for v in s]
    verts=[(x+ix*a,y+iy*b,z+iz*d) for ix,iy,iz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
    o=mesh(name,verts,faces,c,parent,kind)
    if bevel:mod=o.modifiers.new('Hand softened edges','BEVEL');mod.width=bevel;mod.segments=segments;apply_mod(o,mod);paint(o,c,kind)
    return o

def torus(name,p,major,minor,c,parent=None,tilt=(0,0,0),kind='soft',segments=40,sides=6):
    verts=[];faces=[];rot=Matrix.Rotation(tilt[0],4,'X')@Matrix.Rotation(tilt[1],4,'Y')@Matrix.Rotation(tilt[2],4,'Z')
    for i in range(segments):
        a=TAU*i/segments
        for j in range(sides):b=TAU*j/sides;v=rot@Vector(((major+minor*math.cos(b))*math.cos(a),minor*math.sin(b),(major+minor*math.cos(b))*math.sin(a)));verts.append(tuple(v+Vector(p)))
    for i in range(segments):
        for j in range(sides):faces.append((i*sides+j,i*sides+(j+1)%sides,((i+1)%segments)*sides+(j+1)%sides,((i+1)%segments)*sides+j))
    return mesh(name,verts,faces,c,parent,kind)

def animate(o,axis,amount,phase=0):
    index={'x':0,'y':2,'z':1}[axis];sign=-1 if axis=='z' else 1
    o.animation_data_create()
    for clip,factor in [('Idle',.28),('Swim',1)]:
        track=next((t for t in o.animation_data.nla_tracks if t.name==clip),None)
        if track:o.animation_data.action=track.strips[0].action
        for f in range(0,49,6):o.rotation_euler[index]=sign*math.sin(f/48*TAU+phase)*amount*factor;o.keyframe_insert(data_path='rotation_euler',index=index,frame=f)
        action=o.animation_data.action;action.name=CURRENT.name+'_'+clip+'_'+o.name
        if not track:
            track=o.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,0,action)
        o.animation_data.action=None;o.rotation_euler[index]=0

def eyes(parent,width,y,z,size=.22,stalk=False):
    for side in [-1,1]:
        x=side*width
        if stalk:tube('Eyestalk',[(x*.7,y-.37,z-.17),(x*.85,y-.15,z-.03),(x,y,z)], [.07,.065,.065],'#e08074',parent)
        ellipsoid('Ivory eye',(x,y,z),(size*1.23,size*1.4,size*.9),'#fff1d3',parent,seg=24,rings=16)
        ellipsoid('Deep teal iris',(x,y+.006,z+size*.73),(size*.77,size*.97,size*.4),'#25545d',parent,'eye',seg=24,rings=16)
        ellipsoid('Pupil',(x,y+.018,z+size*1.045),(size*.49,size*.68,size*.12),'#102e3b',parent,'eye',seg=20,rings=14)
        ellipsoid('Eye glint',(x-size*.22,y+size*.36,z+size*1.16),(size*.18,size*.22,size*.055),'#fffaf0',parent,'glow',seg=12,rings=8)
        ellipsoid('Little glint',(x+size*.23,y-size*.28,z+size*1.17),(size*.07,size*.09,size*.03),'#b9e9e2',parent,'glow',seg=10,rings=6)
        ellipsoid('Blush',(x*1.15,y-size*1.43,z-.025),(size*.64,size*.27,size*.15),'#ef8e8d',parent,seg=16,rings=10)
    mouth=empty('mouth',(0,y-.4,z+.24),parent)
    tube('Friendly smile',[(-.18,.03,0),(-.11,-.07,.025),(0,-.10,.038),(.11,-.07,.025),(.18,.03,0)], [.022,.026,.03,.026,.022],'#28414b',mouth,steps=4,sides=6)
    ellipsoid('Mouth interior',(0,-.03,-.022),(.14,.065,.03),'#553c51',mouth,seg=16,rings=10)
    ellipsoid('Tongue',(0,-.065,.005),(.075,.028,.016),'#f6aeaa',mouth,seg=12,rings=8)
    mouth.animation_data_create()
    for frame,scale in [(0,(1,1,1)),(3,(1.18,1.12,1.5)),(6,(1.28,1.18,3.5)),(9,(1.12,1.05,1.8)),(12,(1,1,1))]:
        mouth.scale=scale;mouth.keyframe_insert(data_path='scale',frame=frame)
    action=mouth.animation_data.action;action.name=CURRENT.name+'_Chomp'
    track=mouth.animation_data.nla_tracks.new();track.name='Chomp';track.strips.new('Chomp',0,action)
    mouth.animation_data.action=None;mouth.scale=(1,1,1)
    return mouth

def make_shrimp():
    root=empty('hero_shrimp')
    loft('Carapace',[(-.75,.16,.14,.21),(-.56,.20,.5,.43),(-.12,.23,.71,.58),(.45,.23,.75,.58),(.84,.23,.6,.46),(1.05,.25,.24,.24),(1.1,.25,.035,.07)],'#faaa86',root,bottom='#d97878')
    ellipsoid('Cream belly',(0,-.04,.4),(.60,.30,.62),'#ffdfb0',root,bottom='#efaa8c')
    # Overlapping shell plates with scalloped ridges, tapering into a curled fan.
    for i in range(5):
        z=-.55-i*.27;scale=1-i*.12
        ellipsoid('Abdomen shell %02d'%i,(0,.20+i*.018,z),(.58*scale,.42*scale,.30),'#f49c83' if i%2 else '#ffc09a',root,bottom='#d87279',seg=24,rings=12)
        ridge=[]
        for j in range(13):a=math.pi*j/12;ridge.append((math.cos(a)*.58*scale,.20+i*.018+math.sin(a)*.42*scale,z-.12))
        tube('Shell piping',ridge,.018,'#ffe0b1',root,steps=1,sides=5)
    tail=empty('tail',(0,.25,-1.81),root)
    for side in [-1,0,1]:
        fan('Tail paddle',(0,0,0),[(side*.27-.23,.05,-.25),(side*.42-.15,.06,-.65),(side*.43+.15,.06,-.7),(side*.27+.23,.04,-.32)],'#ee8980',tail,ribs=True)
    animate(tail,'x',.2)
    for side in [-1,1]:
        antenna=empty('antenna_'+str(side),(side*.38,.76,.60),root)
        tube('Long curling antenna',[(0,0,0),(side*.3,.39,.16),(side*.86,.57,.4),(side*1.22,.46,.66),(side*1.33,.22,.78)],[.034,.027,.022,.014,.005],'#ffdab0',antenna,steps=7,sides=6)
        animate(antenna,'z',.12,side)
        for i in range(4):
            leg=empty('leg_%s_%s'%(side,i),(side*.47,-.10,.36-i*.29),root)
            tube('Jointed swimmeret',[(0,0,0),(side*.27,-.15,.02),(side*.39,-.35,.16),(side*.27,-.43,.30)],[.06,.058,.038,.012],'#e98478',leg,steps=4,sides=7)
            animate(leg,'z',.30,i*1.3+side)
        claw=empty('claw_'+str(side),(side*.73,-.01,.8),root)
        tube('Little arm',[(0,0,-.2),(side*.18,0,.1),(side*.12,.02,.25)],[.08,.1,.09],'#f5a88c',claw)
        ellipsoid('Chubby claw',(side*.1,.02,.36),(.21,.14,.25),'#ffd0a1',claw)
        tube('Pincer crease',[(side*.1,.06,.48),(side*.08,.07,.36),(side*.11,.07,.29)],.012,'#d68078',claw,sides=5)
        animate(claw,'x',.15,side)
    # A tiny rostrum and freckles make the face read as a shrimp rather than a blob.
    fan('Rostrum',(0,.60,.5),[(-.09,.61,1.0),(0,.58,1.27),(.09,.61,1.0)],'#f8bc92',root,thickness=.07)
    eyes(root,.49,.90,.78,.245,True)
    for side in [-1,1]:
        for i in range(3):ellipsoid('Shell freckle',(side*(.39+i*.1),.60-i*.05,.53),(.025,.018,.018),'#e98a77',root,seg=8,rings=6)
    return root

def merge_static(root):
    # Preserve animated pivots while joining their painted pieces into few draws.
    pivots=[o for o in root.children_recursive if o.type=='EMPTY']+[root]
    for pivot in pivots:
        meshes=[o for o in pivot.children if o.type=='MESH']
        if not meshes:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:o.select_set(True)
        bpy.context.view_layer.objects.active=meshes[0]

        if len(meshes)>1:bpy.ops.object.join()
        bpy.context.object.name=pivot.name+'_painted_mesh'
    bpy.ops.object.select_all(action='DESELECT')

def export_asset(name,fn):
    global CURRENT,TINT_SPAN
    PW.clear();TINT_SPAN=None
    prior=bpy.data.collections.get(name)
    if prior:
        for o in list(prior.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(prior)
    CURRENT=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(CURRENT)
    root=fn();root['tiny_tide_asset']=name;root['authored_in']='Blender 5.2 via Blender MCP' if AUTHORING=='Blender MCP' else 'Blender 5.2 (headless script)';merge_static(root)
    if name.startswith('part_'):claim_pivot_names(CURRENT)
    # Repeated vegetation gets a Blender-authored mobile mesh budget while
    # retaining its silhouette, painted colors and softened shading.
    budgets={'tree':4500,'reef_kelp':1800,'reef_coral_0':1700,'reef_coral_1':1700,'reef_coral_3':1500,'reef_grass':850,'reef_rock_0':800,'reef_rock_1':800}
    if name in budgets:
        for o in CURRENT.all_objects:
            if o.type!='MESH':continue
            tris=sum(len(p.vertices)-2 for p in o.data.polygons)
            if tris>budgets[name]:
                mod=o.modifiers.new('Mobile silhouette budget','DECIMATE');mod.ratio=budgets[name]/tris;apply_mod(o,mod)
    bpy.context.scene.frame_set(0)
    for o in bpy.data.objects:o.select_set(False)
    for o in CURRENT.all_objects:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    path=OUT/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_frame_range=True,export_anim_slide_to_zero=True,export_yup=True,export_extras=True)
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in CURRENT.all_objects if o.type=='MESH')
    MANIFEST[name]={'file':name+'.glb','triangles':triangles,'bytes':path.stat().st_size,'authoring':AUTHORING,'animated':any(o.animation_data for o in CURRENT.all_objects)}
    for o in CURRENT.all_objects:o.select_set(False)
    CURRENT.hide_render=True;CURRENT.hide_viewport=True
    print(json.dumps({'asset':name,**MANIFEST[name]}))
    return root

def setup():
    bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=48;bpy.context.scene.render.fps=24
    for name in ['Cube','Camera','Light']:
        o=bpy.data.objects.get(name)
        if o:bpy.data.objects.remove(o,do_unlink=True)
    OUT.mkdir(parents=True,exist_ok=True);ART.mkdir(parents=True,exist_ok=True);RENDERS.mkdir(parents=True,exist_ok=True)

def save():
    (ROOT/'public/tiny-tide/asset-manifest.json').write_text(json.dumps(MANIFEST,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'tiny-tide-art.blend'))

def build(names):
    setup()
    for name in names:export_asset(name,BUILDERS[name])
    save()

BUILDERS={'hero_shrimp':make_shrimp}

def render_asset(name,filename=None):
    for c in bpy.data.collections:
        if c.name in BUILDERS:c.hide_render=True;c.hide_viewport=True
    col=bpy.data.collections[name];col.hide_render=False;col.hide_viewport=False
    for obj in list(bpy.data.objects):
        if obj.name.startswith('Studio_'):bpy.data.objects.remove(obj,do_unlink=True)
    points=[o.matrix_world@Vector(v) for o in col.all_objects if o.type=='MESH' for v in o.bound_box]
    lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)]);center=(lo+hi)*.5;size=max(hi-lo)
    camera_data=bpy.data.cameras.new('Studio_Camera');camera=bpy.data.objects.new('Studio_Camera',camera_data);bpy.context.scene.collection.objects.link(camera)
    camera.location=center+V((size*1.15,size*.75,size*1.7));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=size*1.4;bpy.context.scene.camera=camera
    for name,p,power,light_size in [('Key',(-4,6,5),700,5),('Fill',(4,3,4),430,5),('Rim',(1,4,-5),800,4)]:
        data=bpy.data.lights.new('Studio_'+name,'AREA');data.energy=power*(size/4)**2;data.shape='DISK';data.size=light_size*(size/4);obj=bpy.data.objects.new('Studio_'+name,data);bpy.context.scene.collection.objects.link(obj);obj.location=center+V(tuple(x*size/4 for x in p));obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(*color('#b9d5dc'),1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35
    scene.render.resolution_x=960;scene.render.resolution_y=960;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(RENDERS/(filename or col.name+'.png'));scene.view_settings.view_transform='AgX';scene.frame_set(0)
    bpy.ops.render.render(write_still=True);print('RENDERED '+scene.render.filepath)
    col.hide_render=True;col.hide_viewport=True

def make_fish():
    root=empty('hero_fish')
    loft('Round golden body',[(-1.1,.10,.07,.12),(-.85,.17,.32,.43),(-.4,.23,.7,.79),(.1,.25,.88,.94),(.6,.28,.78,.78),(1.03,.24,.43,.48),(1.2,.23,.09,.14)],'#ffc35d',root,seg=32,bottom='#e48a52')
    ellipsoid('Warm cream breast',(0,-.02,.65),(.66,.58,.56),'#ffe3a0',root)
    # Painted dorsal stipples and a gently scalloped, ribbed fin silhouette.
    for side in [-1,1]:
        for i in range(5):ellipsoid('Golden freckle',(side*(.62-i*.04),.76+i%2*.04,.3-i*.18),(.04,.025,.03),'#d98a4e',root,seg=10,rings=6)
        fin=empty('fin_'+str(side),(side*.68,.07,.02),root)
        fan('Pectoral fan',(0,0,0),[(side*.43,.12,.3),(side*.79,.02,.11),(side*.84,-.1,-.2),(side*.66,-.17,-.45),(side*.19,-.06,-.32)],'#e89559',fin,ribs=True)
        animate(fin,'z',.35,side*.8)
    dorsal=empty('dorsal',(0,.69,-.08),root)
    fan('Ribbon dorsal',(0,0,0),[(0,.24,.43),(0,.49,.20),(0,.64,-.08),(0,.49,-.43),(0,.18,-.81)],'#f5a554',dorsal,ribs=True,thickness=.065);animate(dorsal,'z',.1)
    tail=empty('tail',(0,.1,-1.05),root)
    for side in [-1,1]:fan('Tail fan',(0,0,0),[(.04,side*.23,-.32),(.015,side*.53,-.66),(0,side*.62,-.98),(-.015,side*.19,-.83),(0,0,-.65)],'#ee9960',tail,ribs=True)
    animate(tail,'y',.38)
    eyes(root,.44,.58,1.025,.25)
    for side in [-1,1]:tube('Gill seam',[(side*.69,.41,.55),(side*.76,.19,.59),(side*.65,-.03,.57)],.02,'#d69157',root)
    return root

def make_orca():
    root=empty('hero_orca')
    body=loft('Orca sculpt',[(-2.08,.18,.13,.15),(-1.6,.15,.33,.32),(-.95,.19,.68,.56),(-.25,.29,1.0,.84),(.55,.32,1.05,.92),(1.25,.29,.88,.73),(1.69,.20,.57,.46),(1.88,.14,.14,.18)],'#244754',root,seg=40,bottom='#102d42')
    # Ivory belly paint follows the body topology, including a tapered lower jaw.
    attr=body.data.color_attributes['Tint']
    for v in body.data.vertices:
        if v.co.z < -.08 or (v.co.z < .14 and -v.co.y>1.35):attr.data[v.index].color=(*color('#f8efd8'),1)
    for side in [-1,1]:
        ellipsoid('Eye saddle',(side*.88,.67,.90),(.19,.23,.40),'#faf0dc',root,seg=24,rings=14)
        flipper=empty('fin_'+str(side),(side*.83,-.10,.30),root)
        fan('Sculpted flipper',(0,0,0),[(side*.42,.02,.31),(side*.86,-.13,.34),(side*1.01,-.25,.08),(side*.75,-.29,-.38),(side*.34,-.10,-.49)],'#254c59',flipper,thickness=.12);animate(flipper,'z',.21,side)
    dorsal=empty('dorsal',(0,.9,-.37),root)
    fan('Curved dorsal',(0,0,0),[(0,.27,.46),(0,.92,.21),(0,1.31,-.13),(0,1.24,-.31),(0,.58,-.36),(0,.07,-.75)],'#254553',dorsal,thickness=.18)
    tail=empty('tail',(0,.15,-1.95),root)
    for side in [-1,1]:fan('Fluke',(0,0,0),[(side*.32,.03,.12),(side*.9,.06,.06),(side*1.1,.0,-.26),(side*.73,-.05,-.58),(side*.27,-.02,-.36)],'#2c5260',tail,thickness=.13)
    animate(tail,'x',.28)
    eyes(root,.47,.56,1.65,.21)
    tube('Blowhole smile',[(-.10,1.13,.31),(0,1.15,.36),(.1,1.13,.31)],.025,'#143442',root)
    return root

def cone(name,p,r,h,c,parent=None,segments=20,tip=.01):
    verts=[];faces=[]
    for y,rad in [(p[1]-h/2,r),(p[1]+h/2,tip)]:
        for i in range(segments):a=TAU*i/segments;verts.append((p[0]+math.cos(a)*rad,y,p[2]+math.sin(a)*rad))
    for i in range(segments):faces.append((i,(i+1)%segments,(i+1)%segments+segments,i+segments))
    faces.extend([tuple(reversed(range(segments))),tuple(range(segments,segments*2))]);return mesh(name,verts,faces,c,parent)

def star(name,p,r,c,parent=None,kind='glow'):
    x,y,z=p;verts=[(x,y,z+.05)]+[(x+math.sin(i*math.pi/5)*r*(1 if i%2==0 else .44),y+math.cos(i*math.pi/5)*r*(1 if i%2==0 else .44),z) for i in range(10)]+[(x,y,z-.05)]
    faces=[]
    for i in range(10):faces.extend([(0,1+i,1+(i+1)%10),(11,1+(i+1)%10,1+i)])
    return mesh(name,verts,faces,c,parent,kind)

def tower(parent,x,z,y=.85,scale=1):
    cone('Cream stone tower',(x,y+.25*scale,z),.26*scale,.85*scale,'#e9d8db',parent,tip=.26*scale)
    torus('Tower cornice',(x,y+.64*scale,z),.29*scale,.035*scale,'#b69ccf',parent)
    cone('Candy spire',(x,y+.92*scale,z),.39*scale,.6*scale,'#8767b2',parent,tip=.025)
    ellipsoid('Arched glowing window',(x,y+.3*scale,z+.252*scale),(.075*scale,.16*scale,.024*scale),'#ffdba1',parent,'glow',seg=16,rings=12)
    star('Spire star',(x,y+1.24*scale,z),.08*scale,'#ffe0a2',parent)

def make_horror(cosmic=False):
    root=empty('hero_cosmic' if cosmic else 'hero_fortress')
    body=ellipsoid('Moon-soft mantle',(0,.52,0),(1.40,1.12,1.21),'#9283d3' if cosmic else '#b59ad0',root,seg=40,rings=26,bottom='#4f527e' if cosmic else '#816ea4')
    ellipsoid('Lavender belly',(0,.18,.48),(1.12,.73,.8),'#c8b0e8' if cosmic else '#d8bfe3',root,seg=28,rings=20)
    for i in range(8):
        a=i*TAU/8;dx=math.sin(a);dz=math.cos(a);limb=empty('tentacle_%02d'%i,(dx*.90,-.10,dz*.73),root)
        path=[(0,0,0),(dx*.34,-.48,dz*.30),(dx*.66,-.87,dz*.57),(dx*1.03,-1.0,dz*.9),(dx*1.26,-.72,dz*1.10),(dx*1.19,-.48,dz*1.19)]
        tube('Curled arm',path,[.24,.23,.19,.13,.075,.018],'#a69adf' if cosmic else '#ac90c8',limb,steps=5,sides=10,bottom='#695985')
        for k in range(4):
            f=k/4;pos=(dx*(.34+.7*f),-.51-.39*math.sin(f*math.pi/2),dz*(.3+.57*f));torus('Pearl sucker',pos,.08-.035*f,.025,'#e4c9e7',limb,tilt=(0,0,.18*dx),segments=12,sides=5)
        animate(limb,'z',.16,a);animate(limb,'x',.10,a)
    if cosmic:
        for i in range(30):
            a=i*2.39996;h=-.1+(i%7)/7*1.7;r=math.sqrt(max(.05,1-((h-.52)/1.12)**2));p=(math.sin(a)*1.4*r,h,math.cos(a)*1.21*r)
            ellipsoid('Nebula speck',p,(.023,.023,.023),'#e4d8f5',root,'glow',seg=8,rings=6)
        for i in range(5):star('Celestial crown',((i-2)*.35,1.65+(2-abs(i-2))*.14,.1),.16,'#ffe2a4',root)
        orbit=empty('orbit',(0,.22,0),root);torus('Saturn halo',(0,0,0),2.02,.027,'#f5d4a7',orbit,tilt=(.23,0,-.20),kind='glow',segments=72)
        ellipsoid('Companion moon',(1.73,.3,.99),(.15,.15,.15),'#a7ddd8',orbit,'glow',seg=16,rings=12);animate(orbit,'y',.22)
        for side in [-1,1]:star('Cheek star',(side*1.12,.49,.94),.09,'#ffe6ba',root)
    else:
        # A little inhabited fortress with arch windows, parapets and warm lights.
        box('Keep',(0,1.5,-.22),(1.42,.67,1.15),'#e3d4df',root,.10)
        for x in [-.7,.7]:
            for z in [-.69,.26]:tower(root,x,z,1.33,.85)
        tower(root,0,-.18,1.66,1.25)
        for x in [-.48,-.16,.16,.48]:
            box('Battlement',(x,1.91,.32),(.19,.23,.22),'#eedee7',root,.025)
            if abs(x)>.2:ellipsoid('Keep window',(x,1.51,.373),(.10,.18,.023),'#ffd699',root,'glow',seg=14,rings=10)
        box('Gate recess',(0,1.44,.386),(.26,.35,.028),'#7d6b9d',root,.10)
        for x in [-.08,0,.08]:box('Tiny gate bar',(x,1.41,.41),(.018,.23,.014),'#deb899',root,.006)
        for side in [-1,1]:
            wing=empty('fin_'+str(side),(side*1.15,.64,-.31),root)
            fan('Velvet wing',(0,0,0),[(side*.25,.35,.03),(side*.84,.5,-.13),(side*1.0,.23,-.47),(side*.73,.08,-.62),(side*.58,.18,-.81),(side*.30,.02,-.7)],'#cbb4e0',wing,thickness=.055,ribs=True);animate(wing,'z',.22,side)
        for i in range(9):ellipsoid('Roof moss',(math.sin(i*2.4)*.57,1.84,math.cos(i*2.4)*.39-.17),(.12,.06,.09),'#92b5a2',root,seg=12,rings=8)
    eyes(root,.60,.78,1.055,.27)
    return root

BUILDERS.update({'hero_fish':make_fish,'hero_orca':make_orca,'hero_fortress':make_horror,'hero_cosmic':lambda:make_horror(True)})

def leaf(name,start,end,width,c,parent,ruffle=0):
    s=Vector(start);e=Vector(end);direction=e-s;side=Vector((direction.z,0,-direction.x)).normalized()
    if side.length<.1:side=Vector((1,0,0))
    verts=[];faces=[]
    for j in range(9):
        t=j/8;center=s+direction*t+Vector((0,math.sin(t*math.pi)*.14,0));w=math.sin(t*math.pi)**.7*width
        for i in [-1,0,1]:v=center+side*w*i;v.y+=math.sin(t*TAU*2+i)*ruffle*abs(i);verts.append(tuple(v))
    for j in range(8):
        for i in range(2):a=j*3+i;faces.append((a,a+3,a+4,a+1))
    o=mesh(name,verts,faces,c,parent,'leaf');mod=o.modifiers.new('Fleshy leaf edge','SOLIDIFY');mod.thickness=.035;apply_mod(o,mod);return o

def make_plant(kind='plant'):
    root=empty('food_'+kind)
    ellipsoid('Holdfast',(0,.055,0),(.29,.12,.26),'#b4bd81',root,'rock',seg=14,rings=8)
    if kind=='seagrape':
        for j in range(3):
            x=(j-1)*.27;h=.7+j%2*.35;tube('Grape stalk',[(x,0,0),(x*.9,h*.5,0),(x*.8,h,0)],[.035,.025,.01],'#76b77c',root,kind='leaf')
            for k in range(7):a=k*2.4;p=(x+math.sin(a)*.15,.2+k*h/8,math.cos(a)*.14);ellipsoid('Jade sea grape',p,(.10,.11,.10),'#b3dd8b',root,'leaf',seg=12,rings=8)
    elif kind=='lettuce':
        for k in range(3):
            verts=[(0,.08+k*.14,0)];faces=[];n=40
            for j in range(1,6):
                r=j/5*(.48-k*.08)
                for i in range(n):a=TAU*i/n;verts.append((math.cos(a)*r,.10+k*.14+r*.32+math.sin(a*7+j)*.09*(j/5)**2,math.sin(a)*r))
            for i in range(n):faces.append((0,1+i,1+(i+1)%n))
            for j in range(4):
                for i in range(n):a=1+j*n+i;b=1+j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
            o=mesh('Ruffled sea lettuce',verts,faces,['#a6d88b','#c1e6a2','#8cc98f'][k],root,'leaf');mod=o.modifiers.new('Lettuce thickness','SOLIDIFY');mod.thickness=.025;apply_mod(o,mod)
    else:
        for i in range(5 if kind=='kelp_snack' else 3):
            a=i*2.4;h=1.0+(i%3)*.18;end=(math.sin(a)*(.55 if kind=='kelp_snack' else .40),h,math.cos(a)*.3)
            leaf('Tender blade',(0,.1,0),end,.16 if kind=='kelp_snack' else .23,'#a9d993' if kind=='plant' else '#7dbf93',root,ruffle=.025 if kind=='kelp_snack' else 0)
        if kind=='plant':ellipsoid('Golden seed',(0,.98,.06),(.15,.18,.14),'#f6dfa0',root,'glow',seg=14,rings=10)
    return root

def make_food_shrimp():
    root=empty('food_shrimp')
    ellipsoid('Shrimp shell',(0,.09,0),(.34,.28,.64),'#f3a88c',root,seg=18,rings=12)
    for i in range(3):ellipsoid('Tail segment',(0,.12,-.38-i*.15),(.25-i*.05,.19-i*.03,.17),'#f6b696',root,seg=14,rings=8)
    for side in [-1,1]:
        fan('Tail fin',(0,.12,-.68),[(side*.25,.12,-.70),(side*.34,.14,-.95),(side*.09,.13,-1.02)],'#e98d83',root)
        tube('Antenna',[(side*.15,.33,.34),(side*.39,.54,.58),(side*.52,.47,.76)],[.019,.014,.004],'#ffddb2',root,sides=5,steps=4)
        for i in range(3):tube('Leg',[(side*.22,-.02,.2-i*.2),(side*.4,-.14,.24-i*.2),(side*.37,-.24,.3-i*.2)],[.035,.03,.009],'#d98278',root,steps=2,sides=5)
        ellipsoid('Eye',(side*.17,.32,.42),(.10,.13,.09),'#fff2d9',root,seg=12,rings=8);ellipsoid('Pupil',(side*.17,.34,.5),(.055,.08,.027),'#153e49',root,'eye',seg=10,rings=8)
    return root

def make_crab():
    root=empty('food_crab');ellipsoid('Peach carapace',(0,.2,0),(.49,.29,.37),'#efa889',root,seg=22,rings=14)
    for side in [-1,1]:
        for i in range(3):tube('Crab walking leg',[(side*.3,.12,.15-i*.18),(side*.68,.04,.30-i*.27),(side*.75,-.14,.38-i*.28)],[.053,.045,.012],'#d77d78',root,sides=6,steps=3)
        tube('Arm',[(side*.4,.23,.24),(side*.62,.27,.55),(side*.54,.31,.74)],[.07,.08,.055],'#ed9d7e',root,sides=7)
        ellipsoid('Crab claw',(side*.52,.34,.75),(.21,.15,.23),'#ffbe91',root,seg=16,rings=10)
        tube('Pincer opening',[(side*.52,.39,.91),(side*.55,.4,.8),(side*.52,.40,.71)],.018,'#b66b70',root,sides=5,steps=2)
        tube('Eye stalk',[(side*.19,.37,.26),(side*.24,.56,.35)],[.034,.045],'#d48476',root,sides=6)
        ellipsoid('Eye',(side*.24,.58,.35),(.085,.105,.075),'#fff1d9',root,seg=12,rings=8);ellipsoid('Pupil',(side*.24,.59,.415),(.047,.069,.025),'#204c52',root,'eye',seg=10,rings=6)
    tube('Happy crab smile',[(-.11,.27,.36),(0,.2,.386),(.11,.27,.36)],.015,'#9b6269',root,steps=4,sides=5)
    return root

def make_jelly():
    root=empty('food_jellyfish')
    verts=[];faces=[];n=28
    for j in range(10):
        phi=(j+.05)/9.05*math.pi*.54;r=math.sin(phi)*.53;y=.22+math.cos(phi)*.46
        for i in range(n):a=TAU*i/n;verts.append((math.cos(a)*r,y+(j/9)**5*math.sin(a*9)*.04,math.sin(a)*r))
    for j in range(9):
        for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    o=mesh('Pearlescent bell',verts,faces,'#d6b5e3',root,bottom='#9b8bd2');mod=o.modifiers.new('Bell rim thickness','SOLIDIFY');mod.thickness=.028;apply_mod(o,mod)
    torus('Bell hem',(0,.16,0),.5,.03,'#f7d8ec',root,segments=36)
    for i in range(8):a=i*TAU/8;x=math.cos(a)*.28;z=math.sin(a)*.28;tube('Trailing ribbon',[(x,.2,z),(x*1.2,-.1,z*1.2),(x*.8,-.43,z*.9),(x*1.1,-.62,z*1.15)],[.032,.03,.023,.007],'#e8c7ed',root,sides=6,steps=4)
    for side in [-1,1]:ellipsoid('Jelly eye',(side*.15,.33,.46),(.048,.072,.025),'#524976',root,'eye',seg=10,rings=6)
    return root

def make_snail():
    root=empty('food_snail');ellipsoid('Sea slug foot',(0,.08,0),(.3,.13,.61),'#add2b2',root,seg=18,rings=12)
    ellipsoid('Shell body',(0,.38,-.13),(.41,.4,.39),'#efc9a6',root,seg=24,rings=16)
    pts=[];rads=[]
    for i in range(56):t=i/55;a=t*math.pi*4.5;r=.32*(1-t)+.018;pts.append((math.cos(a)*r,.38+math.sin(a)*r,.21+.1*t));rads.append(.042*(1-t)+.02)
    tube('Shell spiral',pts,rads,'#ce937f',root,steps=1,sides=6)
    for side in [-1,1]:tube('Rhinophore',[(side*.13,.13,.37),(side*.18,.42,.48),(side*.2,.49,.5)],[.038,.028,.015],'#8db798',root,sides=6);ellipsoid('Snail eye',(side*.2,.49,.51),(.045,.06,.04),'#325359',root,'eye',seg=10,rings=6)
    return root

def make_tuna():
    root=empty('food_fish');loft('Blue silver tuna',[(-1.0,0,.07,.1),(-.65,.04,.24,.33),(-.15,.06,.42,.53),(.47,.04,.35,.42),(.74,0,.11,.19)],'#74bac1',root,seg=20,bottom='#e3e6c4')
    for side in [-1,1]:fan('Tail fluke',(0,0,-.89),[(0,side*.36,-1.13),(0,side*.53,-1.48),(0,side*.08,-1.24)],'#498eaa',root,thickness=.035);fan('Side fin',(side*.3,.01,.13),[(side*.57,-.04,-.07),(side*.59,-.06,-.38),(side*.31,-.03,-.27)],'#529daa',root)
    fan('Dorsal',(0,.36,-.1),[(0,.61,-.14),(0,.56,-.35),(0,.29,-.62)],'#5a9baa',root)
    for side in [-1,1]:ellipsoid('Eye',(side*.22,.17,.59),(.09,.11,.07),'#fff1d7',root,seg=12,rings=8);ellipsoid('Pupil',(side*.22,.18,.65),(.049,.071,.028),'#1d4352',root,'eye',seg=10,rings=8)
    return root

def make_squid():
    root=empty('food_squid');loft('Squid mantle',[(-.77,.25,.025,.04),(-.48,.18,.24,.3),(.04,.07,.35,.37),(.38,.04,.28,.29)],'#dd9ec2',root,seg=22,bottom='#bb80af')
    for side in [-1,1]:fan('Mantle fin',(side*.13,.1,-.49),[(side*.47,.07,-.38),(side*.58,.05,-.03),(side*.23,.04,.18)],'#eab0cd',root)
    for i in range(8):a=i*TAU/8;x=math.sin(a)*.21;y=math.cos(a)*.2;tube('Squid arm',[(x,y,.28),(x*1.4,y*.9,.67),(x*1.6,y*.8,.96),(x*1.3,y*.65,1.12)],[.075,.057,.03,.008],'#e8b8cc',root,steps=4,sides=6)
    for side in [-1,1]:ellipsoid('Squid eye',(side*.29,.15,.31),(.095,.13,.09),'#fff1d9',root,seg=12,rings=8);ellipsoid('Squid pupil',(side*.30,.16,.38),(.056,.085,.034),'#493f69',root,'eye',seg=10,rings=8)
    return root

def make_ray():
    root=empty('food_ray');ellipsoid('Ray body',(0,.06,0),(.38,.15,.72),'#83b6c5',root,seg=20,rings=12)
    for side in [-1,1]:fan('Manta wing',(side*.18,.02,.05),[(side*.51,.09,.62),(side*1.03,.04,.25),(side*1.25,-.02,-.1),(side*.77,-.07,-.49),(side*.31,-.06,-.55)],'#83b6c5',root,thickness=.07)
    tube('Ray tail',[(0,0,-.56),(0,-.06,-.94),(.16,-.06,-1.38),(.23,.01,-1.65)],[.07,.04,.022,.005],'#6e96b1',root,steps=5,sides=6)
    for side in [-1,1]:ellipsoid('Ray eye',(side*.21,.20,.39),(.09,.085,.10),'#fff0d4',root,seg=12,rings=8);ellipsoid('Pupil',(side*.21,.24,.45),(.05,.044,.06),'#274859',root,'eye',seg=10,rings=6)
    return root

def make_gull():
    root=empty('food_bird');ellipsoid('Gull breast',(0,.04,0),(.22,.25,.45),'#fff2dc',root,seg=18,rings=12)
    ellipsoid('Head',(0,.2,.34),(.2,.21,.22),'#fff5e0',root,seg=16,rings=12)
    loft('Golden beak',[(.43,.17,.12,.055),(.7,.15,.01,.02)],'#edb764',root,seg=10)
    for side in [-1,1]:
        fan('Swept wing',(side*.13,.08,.09),[(side*.49,.18,.18),(side*.91,.28,-.02),(side*1.19,.33,-.40),(side*.72,.19,-.38),(side*.28,.08,-.3)],'#e7e9da',root,thickness=.045)
        for j in range(4):fan('Charcoal feather',(side*(.66+j*.1),.22,-.12-j*.07),[(side*(.94+j*.09),.26,-.27-j*.08),(side*(1.03+j*.055),.28,-.47-j*.04),(side*(.75+j*.07),.20,-.37-j*.05)],'#697e8a',root,thickness=.023)
        ellipsoid('Gull eye',(side*.15,.28,.43),(.04,.054,.03),'#274650',root,'eye',seg=10,rings=6)
    fan('Tail feathers',(0,.04,-.28),[(-.25,.02,-.62),(0,.04,-.69),(.25,.02,-.62)],'#d9dfd4',root)
    return root

BUILDERS.update({'plant':lambda:make_plant('plant'),'kelp_snack':lambda:make_plant('kelp_snack'),'seagrape':lambda:make_plant('seagrape'),'lettuce':lambda:make_plant('lettuce'),'shrimp':make_food_shrimp,'crab':make_crab,'jellyfish':make_jelly,'snail':make_snail,'fish':make_tuna,'squid':make_squid,'ray':make_ray,'bird':make_gull})

def make_tree():
    root=empty('food_tree')
    tube('Leaning palm trunk',[(0,0,0),(.07,.55,0),(.02,1.2,-.06),(-.13,1.8,-.11)],[.14,.12,.10,.075],'#b38e6e',root,sides=10,steps=6)
    for i in range(9):torus('Palm ring',(.03 if i<5 else -.035,i*.18+.15,-.04),.12-i*.003,.012,'#d8b28a',root,segments=14,sides=5)
    for i in range(8):
        a=TAU*i/8;dx=math.sin(a);dz=math.cos(a);start=(-.13,1.8,-.11);end=(start[0]+dx*1.13,1.67,start[2]+dz*1.13)
        tube('Palm midrib',[start,(start[0]+dx*.54,2.08,start[2]+dz*.54),end],[.029,.021,.007],'#b3cc83',root,kind='leaf',sides=5,steps=5)
        for j in range(5):
            t=(j+1)/6;p=(start[0]+dx*t,1.85+math.sin(t*math.pi)*.19,start[2]+dz*t)
            for side in [-1,1]:e=(p[0]+dx*.24+dz*side*.24*(1-t*.5),p[1]-.22,p[2]+dz*.24-dx*side*.24*(1-t*.5));leaf('Palm leaflet',p,e,.09,'#78b384' if i%2 else '#9ac17e',root)
    for i in range(3):ellipsoid('Coconut',(-.13+math.cos(i*2.1)*.14,1.66,math.sin(i*2.1)*.14-.11),(.13,.16,.12),'#b99972',root,seg=12,rings=8)
    return root

def make_boat():
    root=empty('food_boat')
    loft('Rounded wooden hull',[(-1.05,.01,.05,.06),(-.81,-.04,.38,.22),(-.1,-.05,.49,.28),(.6,-.01,.4,.20),(1.09,.05,.025,.04)],'#c78069',root,seg=20,bottom='#875f66')
    box('Ivory deck',(0,.10,-.04),(.80,.11,1.55),'#f1d7b3',root,.14)
    for i in range(5):box('Deck plank seam',((i-2)*.135,.162,-.05),(.012,.003,1.37),'#bd957b',root,.0)
    tube('Mast',[(0,.17,.0),(0,1.78,.0)],[.035,.026],'#a67e65',root,sides=8)
    fan('Billowing mainsail',(.015,.31,0),[(.05,1.71,-.015),(.12,1.45,-.26),(.18,1.06,-.56),(.14,.54,-.80),(.02,.30,-.86)],'#fff0cd',root,thickness=.02)
    fan('Coral jib',(-.03,.39,.10),[(-.04,1.38,.07),(-.11,1.01,.39),(-.12,.59,.75),(-.02,.38,.75)],'#f2a48c',root,thickness=.02)
    tube('Boom',[(0,.32,0),(0,.31,-.91)],.018,'#a37d67',root,sides=6)
    for side in [-1,1]:tube('Rigging',[(0,1.61,0),(side*.37,.17,-.57)],.008,'#e4d5b4',root,sides=4,steps=1)
    torus('Lifebuoy',(.44,.17,-.37),.13,.035,'#ee9a85',root,tilt=(0,0,math.pi/2),segments=20)
    box('Stern seat',(0,.23,-.64),(.66,.11,.21),'#9f7768',root,.035)
    return root

def make_plane():
    root=empty('food_plane')
    loft('Cream fuselage',[(-1.1,.01,.06,.09),(-.70,.02,.16,.20),(-.1,.03,.24,.27),(.59,.02,.22,.24),(.87,.02,.12,.16)],'#f6debb',root,seg=22,bottom='#cea68c')
    for side in [-1,1]:
        fan('Coral wing',(side*.1,.02,.1),[(side*.49,.035,.37),(side*1.41,.07,.17),(side*1.55,.07,-.02),(side*1.48,.07,-.23),(side*.32,.01,-.34)],'#e9957c',root,thickness=.07)
        ellipsoid('Pontoon',(side*.38,-.48,.11),(.14,.13,.64),'#7daeb8',root,seg=16,rings=10)
        for z in [-.19,.38]:tube('Float strut',[(side*.15,-.12,z),(side*.37,-.4,z)],[.022,.022],'#768b96',root,sides=5,steps=1)
        fan('Tailplane',(0,.10,-.89),[(side*.49,.1,-.74),(side*.57,.1,-1.03),(side*.16,.1,-1.16)],'#df8e77',root,thickness=.045)
        star('Wing emblem',(side*1.07,.12,-.01),.12,'#fff0d0',root,'soft')
    fan('Tail rudder',(0,.04,-.88),[(0,.32,-.82),(0,.48,-1.05),(0,.08,-1.16)],'#dd967f',root,thickness=.06)
    ellipsoid('Blue canopy',(0,.235,.10),(.17,.16,.31),'#689fae',root,'eye',seg=18,rings=12)
    ellipsoid('Propeller hub',(0,.025,.91),(.10,.10,.10),'#d39876',root,seg=12,rings=8)
    for side in [-1,1]:ellipsoid('Propeller blade',(side*.19,.025,.975),(.26,.046,.028),'#667e8b',root,seg=12,rings=8)
    return root

def make_balloon():
    root=empty('food_balloon')
    body=ellipsoid('Striped balloon',(0,.76,0),(.67,.88,.67),'#f0be8c',root,seg=40,rings=26)
    attr=body.data.color_attributes['Tint']
    for v in body.data.vertices:
        a=math.atan2(v.co.y,v.co.x);stripe=int((a+math.pi)/TAU*12)
        if stripe%2:attr.data[v.index].color=(*color('#f7e2b6'),1)
    cone('Balloon skirt',(0,-.02,0),.20,.31,'#de9a7e',root,tip=.34)
    box('Wicker basket',(0,-.66,0),(.40,.31,.34),'#bd9070',root,.06)
    for side in [-1,1]:
        for z in [-.13,.13]:tube('Balloon suspension',[(side*.16,-.51,z),(side*.24,-.08,z*1.3)],.012,'#d2b38b',root,sides=4,steps=1)
    for i in range(3):box('Wicker weave',(0,-.77+i*.085,.175),(.39,.018,.012),'#e5bf91',root,.005)
    return root

def make_lighthouse():
    root=empty('food_lighthouse')
    cone('Stone base',(0,.06,0),.50,.18,'#a5af9e',root,tip=.48)
    cone('Ivory lighthouse',(0,.75,0),.37,1.30,'#f4e1c4',root,tip=.29)
    for y in [.43,.92]:cone('Coral painted band',(0,y,0),.35-(y-.3)*.06,.19,'#e6937d',root,tip=.34-(y-.3)*.06)
    torus('Gallery rim',(0,1.45,0),.43,.055,'#758f9b',root,segments=28)
    for i in range(8):a=TAU*i/8;tube('Gallery railing',[(math.cos(a)*.42,1.46,math.sin(a)*.42),(math.cos(a)*.42,1.71,math.sin(a)*.42)],.016,'#7a929b',root,sides=5,steps=1)
    torus('Top railing',(0,1.7,0),.42,.022,'#7c9298',root,segments=28)
    cone('Lantern glass',(0,1.69,0),.26,.41,'#bfd9ca',root,tip=.26)
    ellipsoid('Beacon',(0,1.71,0),(.18,.17,.18),'#ffe1a1',root,'glow',seg=16,rings=12)
    cone('Roof',(0,1.98,0),.36,.24,'#778d9d',root,tip=.035)
    for y in [.48,.94]:ellipsoid('Arched window',(0,y,.346 if y<.6 else .32),(.07,.12,.02),'#7093a1',root,'eye',seg=12,rings=10)
    box('Little door',(0,.21,.379),(.19,.31,.035),'#a27966',root,.07)
    return root

def make_rock(seed=0):
    root=empty('reef_rock_'+str(seed));rng=random.Random(seed+282)
    o=ellipsoid('Weathered reef stone',(0,.15,0),(1.0,.66,.83),'#80a9a0',root,'rock',seg=18,rings=12,bottom='#4d7e83')
    for v in o.data.vertices:
        p=v.co;noise=1+.07*math.sin(p.x*10+seed)*math.sin(p.y*9)+rng.uniform(-.025,.025);p.x*=noise;p.y*=noise;p.z*=noise
    o.data.update();paint(o,'#8cac9f','rock',bottom='#4e8286')
    for i in range(5):a=i*2.4;ellipsoid('Moss patch',(math.sin(a)*.60,.61,math.cos(a)*.48),(.24,.045,.18),'#a8c29a',root,'leaf',seg=12,rings=8)
    return root

def make_arch():
    root=empty('reef_arch')
    o=tube('Eroded stone arch',[(-1.65,-.2,0),(-1.5,.78,.0),(-1.1,1.9,.03),(-.31,2.53,.04),(.62,2.31,.04),(1.36,1.40,0),(1.58,-.2,0)],[.6,.51,.44,.48,.49,.51,.64],'#7caaa2',root,steps=5,sides=14,kind='rock',bottom='#4c7d83')
    for v in o.data.vertices:p=v.co;p.x+=math.sin(p.y*7+p.z*4)*.04;p.y+=math.cos(p.x*7+p.z*5)*.065
    paint(o,'#8eafa2','rock',bottom='#4f7c82')
    for i in range(8):a=i*2.4;ellipsoid('Arch moss',(math.sin(a)*.64,2.50+math.cos(a)*.1,math.cos(a)*.34),(.29,.06,.22),'#abc09a',root,'leaf',seg=12,rings=8)
    for i in range(4):x=-.72+i*.43;tube('Crown coral',[(x,2.56,0),(x+.04,2.82,0),(x-.06,3.02,.07)],[.05,.038,.018],'#eba598',root,sides=6,steps=3)
    return root

def make_coral(kind=0):
    root=empty('reef_coral_'+str(kind));rng=random.Random(347+kind)
    if kind==2:
        for i in range(5):
            x=math.sin(i*2.4)*.42;z=math.cos(i*2.4)*.42;h=.65+(i%3)*.3
            # Hollow sponge tubes have a real rim and dark cavity.
            verts=[];faces=[];n=16
            for y,r in [(0,.17),(h,.19),(h,.13),(.13,.11)]:
                for j in range(n):a=TAU*j/n;verts.append((x+math.cos(a)*r,y,z+math.sin(a)*r))
            for k in range(3):
                for j in range(n):a=k*n+j;b=k*n+(j+1)%n;faces.append((a,b,b+n,a+n))
            faces.append(tuple(range(3*n,4*n)));mesh('Tube sponge',verts,faces,'#cba3d2',root,'rock',bottom='#8b7da8')
    elif kind==3:
        ellipsoid('Brain coral',(0,.39,0),(.76,.53,.60),'#dfbc86',root,'rock',seg=24,rings=16)
        for k in range(8):
            pts=[]
            for j in range(22):t=j/21*math.pi;a=k*TAU/8+math.sin(t*5)*.11;pts.append((math.sin(t)*math.cos(a)*.74,.4+math.cos(t)*.50,math.sin(t)*math.sin(a)*.61))
            tube('Coral maze ridge',pts,.035,'#f1d3a0',root,sides=5,steps=1)
    else:
        c='#ef9c92' if kind==0 else '#d7a8d2'
        for i in range(6):
            a=i*2.4;x=math.sin(a)*.45;z=math.cos(a)*.38;h=.75+rng.random()*.6
            tube('Branching coral',[(x*.3,0,z*.3),(x*.7,h*.42,z*.7),(x,h*.76,z),(x*.9,h,z)],[.11,.085,.055,.027],c,root,sides=7,steps=4)
            for side in [-1,1]:
                tube('Coral fork',[(x*.7,h*.42,z*.7),(x+side*.20,h*.60,z),(x+side*.25,h*.86,z+.08)],[.07,.05,.02],c,root,sides=6,steps=4)
                ellipsoid('Pale growing tip',(x+side*.25,h*.86,z+.08),(.05,.06,.045),'#ffdbc6' if kind==0 else '#eed5ea',root,seg=10,rings=6)
    return root

def make_kelp():
    root=empty('reef_kelp')
    for k in range(3):
        x=(k-1)*.35;h=2.6+k*.36
        tube('Kelp stipe',[(x,0,0),(x+.12,h*.4,.04),(x-.15,h*.8,.08),(x+.04,h,.10)],[.045,.04,.028,.008],'#739c77',root,kind='leaf',sides=6)
        for j in range(7):
            y=.28+j*h/8;side=-1 if j%2 else 1
            leaf('Ribbon frond',(x,y,.05),(x+side*(.45+j*.03),y+.5,.14+side*.19),.15,'#83b58a' if j%2 else '#a3c88d',root,ruffle=.045)
            ellipsoid('Air bladder',(x+side*.09,y+.05,.05),(.055,.075,.052),'#c4d49a',root,'leaf',seg=10,rings=6)
    return root

def make_grass():
    root=empty('reef_grass')
    for i in range(13):
        a=i*2.4;r=.2+(i%3)*.16;x=math.cos(a)*r;z=math.sin(a)*r
        leaf('Sea grass blade',(x,0,z),(x+math.cos(a)*.22,.48+(i%5)*.13,z+math.sin(a)*.22),.052,'#88b68e' if i%2 else '#b0cc98',root)
    return root

def make_shell():
    root=empty('reef_shell');verts=[(0,.03,-.22)];faces=[];n=25
    for j in range(1,7):
        r=j/6*.45
        for i in range(n):a=-math.pi*.68+i/(n-1)*math.pi*1.36;verts.append((math.sin(a)*r,.035+math.sin(j/6*math.pi)*.13+math.cos(i*math.pi)*.01,math.cos(a)*r-.22))
    for i in range(n-1):faces.append((0,1+i,2+i))
    for j in range(5):
        for i in range(n-1):a=1+j*n+i;faces.append((a,a+n,a+n+1,a+1))
    o=mesh('Scalloped shell',verts,faces,'#f0c3a9',root);mod=o.modifiers.new('Shell lip','SOLIDIFY');mod.thickness=.035;apply_mod(o,mod)
    return root

def make_starfish():
    root=empty('reef_starfish')
    for i in range(5):a=TAU*i/5;dx=math.sin(a);dz=math.cos(a);tube('Starfish arm',[(0,.07,0),(dx*.22,.09,dz*.22),(dx*.47,.045,dz*.47)],[.14,.12,.015],'#eaa18e',root,sides=8,steps=4)
    for i in range(5):a=TAU*i/5;ellipsoid('Starfish pearl',(math.sin(a)*.20,.18,math.cos(a)*.20),(.025,.02,.025),'#ffd2ab',root,seg=8,rings=6)
    return root

def make_island():
    root=empty('island');verts=[];faces=[];n=40
    profiles=[(-.95,.6),(-.53,1.05),(-.07,1.38),(.04,1.35),(.15,1.14),(.22,.80),(.23,.03)]
    for y,r in profiles:
        for i in range(n):a=TAU*i/n;rr=r*(1+.11*math.sin(a*3)+.06*math.sin(a*7));verts.append((math.cos(a)*rr,y,math.sin(a)*rr*.8))
    for j in range(len(profiles)-1):
        for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    o=mesh('Rock sand and meadow',verts,faces,'#a7bf91',root,'rock')
    attr=o.data.color_attributes['Tint']
    for v in o.data.vertices:attr.data[v.index].color=(*color('#6f9690' if v.co.z<-.05 else '#dfc89c' if v.co.z<.16 else '#a5bf91'),1)
    return root

def make_cloud():
    root=empty('cloud')
    for i,(p,s) in enumerate([((0,0,0),(.9,.29,.54)),((-.52,.12,0),(.50,.36,.44)),((.16,.22,0),(.59,.47,.46)),((.69,.03,0),(.51,.3,.39))]):ellipsoid('Cloud puff',p,s,'#e5eeea',root,seg=16,rings=10)
    return root

BUILDERS.update({'tree':make_tree,'boat':make_boat,'plane':make_plane,'balloon':make_balloon,'lighthouse':make_lighthouse,'reef_rock_0':lambda:make_rock(0),'reef_rock_1':lambda:make_rock(1),'reef_arch':make_arch,'reef_coral_0':lambda:make_coral(0),'reef_coral_1':lambda:make_coral(1),'reef_coral_2':lambda:make_coral(2),'reef_coral_3':lambda:make_coral(3),'reef_kelp':make_kelp,'reef_grass':make_grass,'reef_shell':make_shell,'reef_starfish':make_starfish,'island':make_island,'cloud':make_cloud})

def spherical_patch(root,theta,phi,radius,size,c,name='Continent'):
    center=Vector((math.sin(phi)*math.cos(theta),math.cos(phi),math.sin(phi)*math.sin(theta)));u=center.cross(Vector((0,1,0))).normalized()
    if u.length<.1:u=Vector((1,0,0))
    v=center.cross(u).normalized();verts=[tuple(center*radius)];n=22
    for j in range(1,4):
        for i in range(n):a=TAU*i/n;r=size*j/3*(1+.19*math.sin(a*3+theta)+.11*math.cos(a*7));point=(center+(u*math.cos(a)+v*math.sin(a))*r).normalized()*radius;verts.append(tuple(point))
    faces=[]
    for i in range(n):faces.append((0,1+i,1+(i+1)%n))
    for j in range(2):
        for i in range(n):a=1+j*n+i;b=1+j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    return mesh(name,verts,faces,c,root,'rock')

def make_planet(index):
    root=empty('planet_%02d'%index)
    colors=['#65aebd','#c0bbb5','#d6aa82','#9b8fc7','#8db7aa','#c1869b','#b0cbd6','#8d91c0','#dfb180','#76949b','#c6a5cb','#9abdb6']
    r=1.0
    body=ellipsoid('Planet body',(0,0,0),(r,r,r),colors[index],root,'rock',seg=48,rings=32)
    attr=body.data.color_attributes['Tint']
    if index in [2,3,5,8,10]:
        for vertex in body.data.vertices:
            p=vertex.co;lat=p.z;long=math.atan2(p.y,p.x);wave=math.sin(lat*21+math.sin(long*3)*.45);base=color(colors[index]);t=.2+.22*(wave*.5+.5);attr.data[vertex.index].color=(*mix(base,color('#f1d2b0'),t),1)
    if index==1:
        craters=[(math.sin(i*2.4)*.7,math.cos(i*1.7)*.7,math.sin(i*1.4)*.7) for i in range(14)]
        centers=[Vector(c).normalized() for c in craters]
        for vertex in body.data.vertices:
            p=vertex.co;n=p.normalized();indent=sum(max(0,1-(n-c).length/.17)**2*.07 for c in centers);vertex.co*=1-indent
        paint(body,'#c7c4b6','rock',bottom='#8d9697')
    elif index==9:
        for i in range(7):
            a=i*2.4;points=[]
            for j in range(12):t=j/11*1.7-.85;p=Vector((math.cos(a+math.sin(t*7)*.05)*math.cos(t),math.sin(t),math.sin(a+math.sin(t*7)*.05)*math.cos(t)))*1.014;points.append(tuple(p))
            tube('Lava river',points,.011,'#f2b278',root,kind='glow',sides=5,steps=1)
    else:
        if index not in [2,5,8,10]:
            for i in range(6):spherical_patch(root,i*2.4+index, .55+(i%4)*.61,1.009,.24+(i%3)*.11,'#a9c59a' if index in [0,4,11] else '#d5dcd0',name='Painted continents')
        if index in [0,4,6,11]:
            for i in range(4):spherical_patch(root,i*2.5,.45+i*.65,1.027,.09,'#e8e6d1',name='Cloud bank')
    if index in [2,3,5,8,10]:
        verts=[];faces=[];n=88
        for r in [1.24,1.32,1.46,1.61,1.72]:
            for j in range(n):a=TAU*j/n;verts.append((math.cos(a)*r,math.sin(a)*r*.18,math.sin(a)*r))
        for k in range(4):
            for j in range(n):a=k*n+j;b=k*n+(j+1)%n;faces.append((a,b,b+n,a+n))
        mesh('Saturn dust rings',verts,faces,'#e8c9a1' if index%2 else '#b9c8d1',root,'rock')
    return root

def height(x,z):return math.sin(x*.075)*math.cos(z*.055)*2.4+math.sin((x+z)*.018)*4.5+math.sin(x*.006)*math.sin(z*.009)*13

def make_terrain(level):
    root=empty('seabed_%s'%level);n=100;verts=[];faces=[]
    if level==0:
        for j in range(n+1):
            for i in range(n+1):x=(i/n-.5)*130;z=(j/n-.5)*130;verts.append((x,height(x,z),z))
        for j in range(n):
            for i in range(n):a=j*(n+1)+i;faces.append((a,a+n+1,a+n+2,a+1))
    else:
        # Nested open rings share the preceding mesh's exact boundary. A coarse
        # full plane would cut through the fine reef and bury small creatures.
        inner,outer=([65,450],[450,2750])[level-1];steps=24
        for side in range(4):
            offset=len(verts)
            for j in range(steps+1):
                radius=inner+(outer-inner)*j/steps
                for i in range(n+1):
                    u=(i/n*2-1)*radius
                    x,z=[(u,-radius),(radius,u),(-u,radius),(-radius,-u)][side]
                    verts.append((x,height(x,z),z))
            for j in range(steps):
                for i in range(n):a=offset+j*(n+1)+i;faces.append((a,a+n+1,a+n+2,a+1))
    o=mesh('Rolling sand',verts,faces,'#8eb8a4',root,'rock');attr=o.data.color_attributes['Tint']
    for vert in o.data.vertices:
        x=vert.co.x;z=-vert.co.y;t=max(0,min(1,(abs(x)+abs(z))/650+math.sin(x*.08)*.09));c=mix(color('#d6d2ad'),color('#65a1a2'),t);ripple=.96+.04*math.sin(x*3.7+math.sin(z*.7));attr.data[vert.index].color=(*(v*ripple for v in c),1)
    return root

BUILDERS.update({'planet_%02d'%i:(lambda i=i:make_planet(i)) for i in range(12)})
BUILDERS.update({'seabed_%s'%i:(lambda i=i:make_terrain(i)) for i in range(3)})

# ---------------------------------------------------------------------------
# Creature editor parts and tier-0 foods.
#
# Part convention: the root empty is the attach point on the body surface.
# Local +Y is the outward surface normal, +Z is creature forward (creature up at
# the front and rear tips), +X is right. Parts are sized for a body radius of 1.
# 'tint' surfaces carry a light neutral gradient that the runtime multiplies by
# a paint color. Pivot empties carry glTF extras: tt_pivot ('jaw', 'seg',
# 'flap', 'swing') and tt_index for chain segments. No clips are baked.
# ---------------------------------------------------------------------------
import re
T='#f4f1ec';TB='#c9c4bd'
_C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

def claim_pivot_names(col):
    # All parts share one .blend, so Blender suffixes duplicate pivot names.
    # Give this asset's pivots their clean names for the export.
    for o in col.all_objects:
        m=re.match(r'^(.*)\.\d{3}$',o.name)
        if o.type!='EMPTY' or not m:continue
        base=m.group(1);other=bpy.data.objects.get(base)
        if other is not None and other!=o:other.name=base+'_swap';o.name=base;other.name=base
        elif other is None:o.name=base

def fin(name,root,edge,c,parent,thickness=.05,kind='tint',ribs=True,sub=4,rib_color=T):
    # A smooth membrane: Catmull-Rom edge, centred thickness and optional ribs.
    ps=[Vector(p) for p in edge];n=len(ps);pts=[]
    for i in range(n-1):
        a=ps[max(0,i-1)];b=ps[i];d=ps[i+1];e=ps[min(n-1,i+2)]
        for j in range(sub):t=j/sub;pts.append(.5*((2*b)+(-a+d)*t+(2*a-5*b+4*d-e)*t*t+(-a+3*b-3*d+e)*t*t*t))
    pts.append(ps[-1]);r=Vector(root);verts=[tuple(r)];m=len(pts)
    for f in [.3,.65,1]:
        for p in pts:verts.append(tuple(r+(p-r)*f))
    faces=[(0,1+i,2+i) for i in range(m-1)]
    for j in range(2):
        for i in range(m-1):a=1+j*m+i;faces.append((a,a+m,a+m+1,a+1))
    o=mesh(name,verts,faces,c,parent,kind);mod=o.modifiers.new('Membrane thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=0;apply_mod(o,mod)
    if ribs:
        for i in range(1,n-1):tube(name+' rib',[tuple(r+(ps[i]-r)*.16),tuple(r+(ps[i]-r)*.55),tuple(r+(ps[i]-r)*.9)],[thickness*.5,thickness*.62,thickness*.3],rib_color,parent,sides=5,steps=3,kind='tint' if rib_color==T else 'soft')
    return o

def part_root(pid,span=(-.1,1.0)):
    global TINT_SPAN
    PW.clear();TINT_SPAN=span;root=empty('part_'+pid);root['tt_part']=pid;return root

def pivot(name,pw,parent,kind,index=None):
    base=PW.get(parent.as_pointer(),(0,0,0))
    e=empty(name,tuple(pw[i]-base[i] for i in range(3)),parent);e['tt_pivot']=kind
    if index is not None:e['tt_index']=index
    PW[e.as_pointer()]=tuple(pw);return e

def chain(root,points):
    segs=[];parent=root
    for i,p in enumerate(points):parent=pivot('seg_%d'%i,p,parent,'seg',i);segs.append(parent)
    return segs

def xf(objs,M):
    # Apply a game-space transform to root-level pieces.
    B=_C@M@_C.inverted()
    for o in objs:o.data.transform(B);o.data.update()
    return objs

def gm(rx=0,ry=0,rz=0,t=(0,0,0)):
    return Matrix.Translation(Vector(t))@Matrix.Rotation(ry,4,'Y')@Matrix.Rotation(rx,4,'X')@Matrix.Rotation(rz,4,'Z')

def sweep_rings(points,rw,rt,wdir=(1,0,0),sides=10,steps=4):
    # Catmull-Rom path with elliptical sections: rw along wdir, rt across it.
    ps=[Vector(p) for p in points];n=len(ps)
    rw=list(rw) if isinstance(rw,(list,tuple)) else [rw]*n;rt=list(rt) if isinstance(rt,(list,tuple)) else [rt]*n
    coords=[];W=[];R=[]
    for i in range(n-1):
        a=ps[max(0,i-1)];b=ps[i];d=ps[i+1];e=ps[min(n-1,i+2)]
        for j in range(steps):
            t=j/steps;coords.append(.5*((2*b)+(-a+d)*t+(2*a-5*b+4*d-e)*t*t+(-a+3*b-3*d+e)*t*t*t));W.append(rw[i]*(1-t)+rw[i+1]*t);R.append(rt[i]*(1-t)+rt[i+1]*t)
    coords.append(ps[-1]);W.append(rw[-1]);R.append(rt[-1]);rings=[];w=Vector(wdir)
    for j,p in enumerate(coords):
        tangent=(coords[min(len(coords)-1,j+1)]-coords[max(0,j-1)]).normalized();u=w-tangent*w.dot(tangent)
        if u.length<1e-4:u=Vector((0,0,1))-tangent*tangent.z
        u.normalize();b=tangent.cross(u).normalized()
        rings.append([p+u*math.cos(TAU*i/sides)*W[j]+b*math.sin(TAU*i/sides)*R[j] for i in range(sides)])
    return rings

def ring_mesh(name,rings,c,parent=None,kind='tint',bottom=None,cap0=True,cap1=True):
    sides=len(rings[0]);verts=[tuple(v) for r in rings for v in r];faces=[]
    for j in range(len(rings)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;faces.append((a,b,b+sides,a+sides))
    if cap0:faces.append(tuple(reversed(range(sides))))
    if cap1:faces.append(tuple((len(rings)-1)*sides+i for i in range(sides)))
    return mesh(name,verts,faces,c,parent,kind,bottom=bottom)

def sweep(name,points,rw,rt,c,parent=None,wdir=(1,0,0),sides=10,kind='tint',steps=4,bottom=None):
    return ring_mesh(name,sweep_rings(points,rw,rt,wdir,sides,steps),c,parent,kind,bottom)

def chain_rings(name,segs,rings,starts,c,kind='tint',overlap=.9):
    # Split one continuous surface across a pivot chain. Internal ends stay open
    # so shading is seamless; each child tucks a slightly smaller ring into its parent.
    out=[]
    for k,s in enumerate(segs):
        i0=starts[k];i1=starts[k+1] if k+1<len(starts) else len(rings)-1;rr=rings[i0:i1+1]
        if k:
            prev=rings[i0-1];ctr=sum(prev,Vector())/len(prev);rr=[[ctr+(v-ctr)*overlap for v in prev]]+rr
        out.append(ring_mesh(name,rr,c,s,kind,cap0=k==0,cap1=k==len(segs)-1))
    return out

def yrings(rings,seg=20):
    out=[]
    for ring in rings:
        y,rx,rz=ring[:3];cz=ring[3] if len(ring)>3 else 0
        out.append([Vector((rx*math.cos(TAU*i/seg),y,cz+rz*math.sin(TAU*i/seg))) for i in range(seg)])
    return out

def yloft(name,rings,c,parent=None,kind='tint',seg=20,bottom=None):
    # Rings stacked along +Y: (y, rx, rz[, cz]). Sections are ellipses in X/Z.
    return ring_mesh(name,yrings(rings,seg),c,parent,kind,bottom)

def nub(parent,s=(.3,.12,.3),p=(0,-.04,0),seg=16,rings=8):
    # A soft tinted mound that blends a part into the body surface.
    return ellipsoid('Blend mound',p,s,T,parent,'tint',seg=seg,rings=rings)

def part_eye(parent,r,iris='#25545d',pupil='#102e3b',sink=.1,ivory='#fff1d3',iris_kind='eye',with_pupil=True):
    # A single eye centred on the origin, gazing along +Y.
    y0=.85*r-sink;out=[]
    out.append(ellipsoid('Ivory eye',(0,y0,0),(r,.85*r,r),ivory,parent,seg=16,rings=10))
    out.append(ellipsoid('Iris',(0,y0+.62*r,0),(.64*r,.36*r,.64*r),iris,parent,iris_kind,seg=18,rings=8))
    if with_pupil:out.append(ellipsoid('Pupil',(0,y0+.9*r,0),(.38*r,.12*r,.38*r),pupil,parent,'eye',seg=12,rings=6))
    out.append(ellipsoid('Eye glint',(-.2*r,y0+1.0*r,.2*r),(.15*r,.05*r,.15*r),'#fffaf0',parent,'glow',seg=8,rings=6))
    out.append(ellipsoid('Little glint',(.22*r,y0+.96*r,-.2*r),(.06*r,.03*r,.06*r),'#b9e9e2',parent,'glow',seg=8,rings=4))
    return out

def lid(parent,r,y=.02,minor=.055):
    return torus('Tinted eyelid rim',(0,y,0),r,minor,T,parent,kind='tint',segments=22,sides=5)

# Mouths: the opening faces +Y. At the front tip local +Z is creature up, so the
# fixed upper half sits at +Z and the lower half hangs from the 'jaw' hinge.
def arc(cx,cy,r,a0,a1,n,y):
    return [(cx+r*math.cos(a0+(a1-a0)*i/(n-1)),y,cy+r*math.sin(a0+(a1-a0)*i/(n-1))) for i in range(n)]

def make_mouth_nibbler():
    root=part_root('mouth_nibbler',(-.12,.3))
    nub(root,(.36,.14,.32),(0,.0,0))
    ellipsoid('Snout',(0,.1,.05),(.27,.14,.2),T,root,'tint',seg=20,rings=12)
    sweep('Upper lip',arc(0,0,.15,.15,math.pi-.15,7,.24),.065,.065,T,root,sides=8,steps=3)
    ellipsoid('Mouth interior',(0,.2,-.01),(.13,.05,.09),'#553c51',root,seg=14,rings=8)
    for side in [-1,1]:
        box('Buck tooth',(side*.042,.255,.075),(.075,.035,.11),'#fffaf0',root,.015)
        ellipsoid('Blush',(side*.27,.17,.1),(.08,.03,.05),'#ef8e8d',root,seg=12,rings=6)
    jaw=pivot('jaw',(0,.12,0),root,'jaw')
    ellipsoid('Chin',(0,.13,-.1),(.21,.11,.1),T,jaw,'tint',seg=18,rings=10)
    sweep('Lower lip',arc(0,0,.15,math.pi+.15,TAU-.15,7,.24),.065,.065,T,jaw,sides=8,steps=3)
    ellipsoid('Tongue',(0,.22,-.07),(.07,.03,.035),'#f6aeaa',jaw,seg=12,rings=6)
    return root

def make_mouth_snapper():
    root=part_root('mouth_snapper',(-.12,.6))
    nub(root,(.38,.14,.3),(0,0,0))
    ellipsoid('Upper snout',(0,.28,.07),(.3,.34,.1),T,root,'tint',seg=22,rings=12)
    for side in [-1,1]:ellipsoid('Nostril',(side*.09,.55,.13),(.03,.02,.02),'#7d5a62',root,seg=8,rings=4)
    for i in range(7):
        a=-1.25+2.5*i/6;x=.26*math.sin(a);y=.27+.31*math.cos(a)
        sweep('Upper fang',[(x,y,.02),(x,y+.005,-.09)],[.035,.004],[.035,.004],'#fffaf0',root,sides=6,steps=1,kind='soft')
    ellipsoid('Mouth interior',(0,.25,-.01),(.24,.27,.04),'#553c51',root,seg=18,rings=8)
    jaw=pivot('jaw',(0,.05,0),root,'jaw')
    ellipsoid('Lower snout',(0,.25,-.08),(.27,.31,.08),T,jaw,'tint',seg=22,rings=12)
    for i in range(6):
        a=-1.05+2.1*i/5;x=.23*math.sin(a);y=.25+.27*math.cos(a)
        sweep('Lower fang',[(x,y,-.03),(x,y+.005,.06)],[.03,.004],[.03,.004],'#fffaf0',jaw,sides=6,steps=1,kind='soft')
    ellipsoid('Tongue',(0,.24,-.03),(.1,.14,.025),'#f6aeaa',jaw,seg=12,rings=6)
    return root

def make_mouth_beak():
    root=part_root('mouth_beak',(-.12,.65));k=1.25
    def S(pts):return [tuple(c*k for c in p) for p in pts]
    nub(root,(.4,.14,.36),(0,0,0))
    sweep('Hooked upper beak',S([(0,-.02,.08),(0,.22,.11),(0,.42,.06),(0,.53,-.06),(0,.5,-.17)]),[.31,.24,.15,.075,.014],[.25,.19,.12,.06,.012],T,root,wdir=(1,0,0),sides=14,steps=5)
    ellipsoid('Cere',(0,.07,.18),(.27,.1,.12),'#f3d9a8',root,seg=16,rings=8)
    for side in [-1,1]:ellipsoid('Nostril',(side*.09,.17,.27),(.03,.024,.024),'#8a6a5a',root,seg=8,rings=4)
    jaw=pivot('jaw',(0,.06,-.03),root,'jaw')
    sweep('Lower beak',S([(0,0,-.07),(0,.18,-.1),(0,.33,-.1),(0,.4,-.06)]),[.25,.18,.1,.025],[.14,.11,.075,.018],T,jaw,sides=12,steps=4)
    ellipsoid('Mouth interior',(0,.21,-.06),(.16,.18,.035),'#553c51',jaw,seg=14,rings=8)
    ellipsoid('Tongue',(0,.27,-.045),(.075,.1,.025),'#f6aeaa',jaw,seg=10,rings=6)
    return root

def make_mouth_filter():
    root=part_root('mouth_filter',(-.12,.35))
    nub(root,(.48,.14,.34),(0,0,0))
    ellipsoid('Upper lip',(0,.17,.09),(.44,.15,.13),T,root,'tint',seg=24,rings=12)
    for i in range(11):
        a=-1.1+2.2*i/10;x=.36*math.sin(a);y=.13+.15*math.cos(a)
        ellipsoid('Baleen plate',(x,y,-.015),(.022,.018,.065),'#efe3c8',root,seg=6,rings=5)
    ellipsoid('Mouth interior',(0,.13,-.02),(.38,.12,.06),'#553c51',root,seg=18,rings=8)
    jaw=pivot('jaw',(0,.04,0),root,'jaw')
    ellipsoid('Big chin',(0,.15,-.1),(.42,.14,.11),T,jaw,'tint',seg=24,rings=12)
    for i in range(5):
        x=(i-2)*.11
        sweep('Throat pleat',[(x,.05,-.2),(x*1.05,.13,-.205),(x*1.1,.22,-.18)],.014,.014,T,jaw,sides=5,steps=2)
    ellipsoid('Tongue',(0,.16,-.04),(.18,.08,.03),'#f6aeaa',jaw,seg=14,rings=6)
    for side in [-1,1]:ellipsoid('Smile dimple',(side*.42,.2,0),(.04,.03,.03),'#7d5a62',root,seg=8,rings=4)
    return root

def make_mouth_fangs():
    root=part_root('mouth_fangs',(-.12,.35))
    nub(root,(.42,.14,.32),(0,0,0))
    ellipsoid('Upper lip',(0,.15,.08),(.36,.13,.12),T,root,'tint',seg=22,rings=12)
    ellipsoid('Mouth interior',(0,.18,-.01),(.29,.09,.05),'#553c51',root,seg=18,rings=8)
    for side in [-1,1]:
        sweep('Fang',[(side*.14,.23,.03),(side*.15,.27,-.07),(side*.14,.28,-.16)],[.05,.035,.004],[.04,.03,.004],'#fffaf0',root,sides=8,steps=3,kind='soft')
        ellipsoid('Blush',(side*.34,.16,.1),(.07,.03,.045),'#ef8e8d',root,seg=12,rings=6)
    jaw=pivot('jaw',(0,.04,0),root,'jaw')
    ellipsoid('Lower lip',(0,.13,-.08),(.33,.12,.1),T,jaw,'tint',seg=22,rings=12)
    ellipsoid('Tongue',(0,.19,-.05),(.12,.05,.03),'#f6aeaa',jaw,seg=12,rings=6)
    return root

def make_mouth_maw():
    root=part_root('mouth_maw',(-.12,.4))
    ellipsoid('Maw collar',(0,.06,0),(.5,.2,.5),T,root,'tint',seg=28,rings=12)
    ellipsoid('Maw throat',(0,.24,0),(.31,.05,.31),'#3f2a3d',root,seg=24,rings=8)
    jaw=pivot('jaw',(0,.18,0),root,'jaw')
    for half,parent in [(0,root),(1,jaw)]:
        a0=.05+half*math.pi;sweep('Ring lip',arc(0,0,.36,a0,a0+math.pi-.1,12,.27),.1,.1,T,parent,sides=10,steps=3)
        for i in range(5):
            a=a0+.25+(math.pi-.6)*i/4;cx=math.cos(a);cz=math.sin(a)
            sweep('Soft tooth',[(cx*.31,.3,cz*.31),(cx*.17,.34,cz*.17)],[.06,.016],[.05,.014],'#fff4ea',parent,sides=8,steps=1,kind='soft')
    ellipsoid('Tongue',(0,.27,-.1),(.09,.03,.07),'#f6aeaa',jaw,seg=12,rings=6)
    return root

# Eyes.
def make_eye_bead():
    # A small glossy bead: mostly dark iris with two bright glints.
    root=part_root('eye_bead',(-.1,.3));r=.22;y0=.85*r-.08
    nub(root,(.25,.07,.25),(0,-.02,0),12,6)
    ellipsoid('Ivory eye',(0,y0,0),(r,.85*r,r),'#fff1d3',root,seg=18,rings=12)
    ellipsoid('Bead iris',(0,y0+.5*r,0),(.84*r,.38*r,.84*r),'#1b3540',root,'eye',seg=18,rings=10)
    ellipsoid('Eye glint',(-.25*r,y0+.84*r,.25*r),(.2*r,.06*r,.2*r),'#fffaf0',root,'glow',seg=8,rings=6)
    ellipsoid('Little glint',(.3*r,y0+.8*r,-.28*r),(.08*r,.04*r,.08*r),'#b9e9e2',root,'glow',seg=8,rings=4)
    return root

def make_eye_stalk():
    root=part_root('eye_stalk',(-.1,.7));nub(root,(.16,.08,.16),(0,-.02,0),12,6)
    sweep('Eye stalk',[(0,-.08,0),(0,.25,.03),(0,.5,.09)],[.08,.06,.065],[.08,.06,.065],T,root,sides=10,steps=4)
    pieces=part_eye(root,.24)+[ellipsoid('Eye cup',(0,.0,0),(.2,.1,.2),T,root,'tint',seg=16,rings=8)]
    xf(pieces,gm(rx=.4,t=(0,.48,.1)));return root

def make_eye_big():
    root=part_root('eye_big',(-.1,.45));nub(root,(.42,.1,.42),(0,-.03,0),12,6)
    r=.38;part_eye(root,r,sink=.12);lid(root,.37,.0,.065)
    # A sleepy rear lid lets the big eye peek forward.
    c=.32*r;y0=.85*r-.12;o=ellipsoid('Peeking lid',(0,y0,0),(r*1.08,r*1.14,r*1.08),T,root,'tint',seg=20,rings=10)
    for v in o.data.vertices:v.co.y=max(v.co.y,c);v.co.z=max(v.co.z,-.11)
    o.data.update();q=math.sqrt(1-(c/r/1.08)**2);a=r*1.08*q;b=r*1.14*q
    tube('Lid lash line',[(a*math.cos(t),y0+b*math.sin(t),-c+.008) for t in [math.pi*i/12 for i in range(13)]],.02,'#3b3340',root,sides=5,steps=2)
    return root

def make_eye_compound():
    root=part_root('eye_compound',(-.1,.35));lid(root,.31,.0,.055)
    dome=ellipsoid('Faceted dome',(0,-.04,0),(.33,.36,.33),'#4a8a96',root,'eye',seg=12,rings=8,bottom='#2c3f63')
    for v in dome.data.vertices:v.co.z=max(v.co.z,-.1)
    dome.data.update()
    for p in dome.data.polygons:p.use_smooth=False
    n=26
    for k in range(n):
        cy=1-k/(n-1)*.82;rr=math.sqrt(1-cy*cy);a=k*2.39996
        ellipsoid('Facet bump',(math.cos(a)*rr*.33,-.04+cy*.36,math.sin(a)*rr*.33),(.065,.065,.065),'#5fa6ad' if k%3 else '#7c76c4',root,'eye',seg=6,rings=3)
    ellipsoid('Eye glint',(-.08,.31,.09),(.06,.025,.05),'#fffaf0',root,'glow',seg=8,rings=4)
    ellipsoid('Little glint',(.1,.27,-.1),(.025,.015,.025),'#b9e9e2',root,'glow',seg=6,rings=4)
    return root

def make_eye_cosmic():
    root=part_root('eye_cosmic',(-.1,.4));nub(root,(.36,.09,.36),(0,-.03,0),12,6)
    part_eye(root,.32,iris='#9d86ee',ivory='#3b3478',iris_kind='glow',with_pupil=False);lid(root,.31,.0,.055)
    xf([star('Star pupil',(0,0,0),.13,'#fff3c4',root)],gm(rx=-math.pi/2,t=(0,.47,0)))
    torus('Orbit ring',(0,.18,0),.48,.022,'#f5d4a7',root,tilt=(.42,0,.2),kind='glow',segments=36,sides=4)
    for i in range(7):a=i*2.4;ellipsoid('Star speck',(math.cos(a)*.2,.18+.14*math.sin(i*1.3),math.sin(a)*.2),(.016,.016,.016),'#fff6d8',root,'glow',seg=6,rings=4)
    ellipsoid('Companion moon',(.47,.33,.08),(.05,.05,.05),'#a7ddd8',root,'glow',seg=10,rings=6)
    return root

# Fins: the blade lies in the local Y/Z plane, thin along X.
def make_fin_side():
    root=part_root('fin_side',(-.1,.8));flap=pivot('flap',(0,0,0),root,'flap')
    ellipsoid('Fin root',(0,0,-.1),(.09,.09,.22),T,flap,'tint',seg=12,rings=8)
    fin('Side fin',(0,-.02,0),[(0,.18,.24),(0,.48,.2),(0,.74,0),(0,.88,-.32),(0,.7,-.44),(0,.42,-.47),(0,.12,-.3)],T,flap,thickness=.06)
    return root

def make_fin_dorsal():
    root=part_root('fin_dorsal',(-.1,1.05));flap=pivot('flap',(0,0,0),root,'flap')
    ellipsoid('Fin root',(0,-.03,-.12),(.08,.08,.4),T,flap,'tint',seg=14,rings=8)
    fin('Dorsal sail',(0,-.02,-.05),[(0,.1,.42),(0,.5,.27),(0,.88,-.02),(0,1.06,-.32),(0,.92,-.43),(0,.56,-.42),(0,.22,-.6),(0,.03,-.68)],T,flap,thickness=.085)
    return root

def make_fin_frill():
    root=part_root('fin_frill',(-.1,.75));flap=pivot('flap',(0,0,0),root,'flap')
    ellipsoid('Frill root',(0,0,0),(.09,.1,.3),T,flap,'tint',seg=12,rings=8)
    edge=[]
    for i in range(13):
        a=-1.35+2.7*i/12;r=.72 if i%2==0 else .6
        edge.append(((.06 if i%2 else -.06),r*math.cos(a)+.02,r*math.sin(a)))
    fin('Ruffled frill',(0,-.02,0),edge,T,flap,thickness=.04)
    return root

# Tails grow along +Y from the rear tip; local +Z is creature up there.
def tail_body(segs,ys,prof,seg=16,m=6):
    # One lofted stem split at the chain pivots (ys are the pivot heights).
    yy=[-.1]+[ys[k]+(ys[k+1]-ys[k])*j/m for k in range(len(ys)-1) for j in range(m)]+[ys[-1]]
    if yy[1]<=yy[0]:yy=yy[1:]
    rings=yrings([(y,max(prof(y)[0],.006),max(prof(y)[1],.006)) for y in yy],seg)
    starts=[1+k*m for k in range(len(segs))];starts[0]=0
    return chain_rings('Tail stem',segs,rings,starts,T)

def make_tail_paddle():
    # A tadpole-style vertical paddle: flat blade, local Z is creature up here.
    root=part_root('tail_paddle',(-.1,1.25))
    ys=[0,.3,.6,.9];segs=chain(root,[(0,y,0) for y in ys])
    def prof(y):
        f=max(0,min(1,y/1.28));h=.15*(1-f)+.27*math.sin(math.pi*f)**.75+.004
        return (.12*(1-.75*f)+.006,h)
    tail_body(segs,ys+[1.28],prof,seg=20,m=7)
    for side in [-1,1]:sweep('Paddle midrib',[(side*.035,.5,0),(side*.03,.8,0),(side*.02,1.08,0)],.014,.014,'#ffe6bc',segs[2],sides=5,steps=3,kind='soft')
    return root

def make_tail_fan():
    root=part_root('tail_fan',(-.1,1.25))
    ys=[0,.22,.44];segs=chain(root,[(0,y,0) for y in ys])
    tail_body(segs[:2],[0,.22,.5],lambda y:(.15-.1*y,.2-.14*y))
    fin('Fan lobes',(0,.42,0),[(0,.62,.2),(0,.92,.48),(0,1.2,.56),(0,1.24,.3),(0,1.06,0),(0,1.24,-.3),(0,1.2,-.56),(0,.92,-.48),(0,.62,-.2)],T,segs[2],thickness=.05)
    ellipsoid('Fan knot',(0,.45,0),(.07,.08,.11),T,segs[2],'tint',seg=12,rings=8)
    return root

def make_tail_fluke():
    root=part_root('tail_fluke',(-.1,1.2))
    ys=[0,.25,.5,.72];segs=chain(root,[(0,y,0) for y in ys])
    tail_body(segs[:3],[0,.25,.5,.8],lambda y:(.17-.12*y,.22-.12*y))
    for side in [-1,1]:
        fin('Fluke',(side*.02,.72,0),[(side*.08,.76,0),(side*.42,.82,0),(side*.72,.94,0),(side*.86,1.1,0),(side*.66,1.12,0),(side*.4,1.07,0),(side*.15,1.13,0),(side*.03,1.06,0)],T,segs[3],thickness=.075,ribs=False)
    ellipsoid('Fluke knot',(0,.78,0),(.09,.1,.075),T,segs[3],'tint',seg=12,rings=8)
    return root

def make_leg_little():
    root=part_root('leg_little',(-.1,.8));sw=pivot('swing',(0,0,0),root,'swing')
    tube('Chubby thigh',[(0,-.08,0),(0,.18,.03),(0,.36,.04)],[.17,.15,.13],T,sw,sides=12,kind='tint')
    ellipsoid('Knee',(0,.38,.04),(.13,.12,.13),T,sw,'tint',seg=14,rings=8)
    tube('Shin',[(0,.38,.04),(0,.54,.01),(0,.66,-.02)],[.12,.11,.1],T,sw,sides=12,kind='tint')
    ellipsoid('Round foot',(0,.71,.08),(.16,.09,.24),T,sw,'tint',seg=16,rings=10)
    for i in [-1,0,1]:
        ellipsoid('Toe',(i*.085,.71,.29),(.055,.055,.06),T,sw,'tint',seg=10,rings=6)
        ellipsoid('Toe claw',(i*.085,.71,.345),(.03,.025,.025),'#fff1d3',sw,seg=8,rings=4)
    return root

def make_leg_crab():
    root=part_root('leg_crab',(-.1,1.1));sw=pivot('swing',(0,0,0),root,'swing')
    tube('Coxa',[(0,-.08,0),(0,.2,.08),(0,.4,.13)],[.11,.1,.085],T,sw,sides=12,kind='tint')
    ellipsoid('Joint',(0,.41,.13),(.095,.095,.095),T,sw,'tint',seg=12,rings=8)
    tube('Merus',[(0,.41,.13),(0,.6,.11),(0,.76,.05)],[.085,.08,.07],T,sw,sides=12,kind='tint')
    ellipsoid('Joint',(0,.77,.05),(.075,.075,.075),T,sw,'tint',seg=12,rings=8)
    sweep('Pointed dactyl',[(0,.77,.05),(0,.98,-.03),(0,1.12,-.13)],[.07,.045,.006],[.07,.045,.006],T,sw,sides=10,steps=5)
    for y,z in [(.25,.1),(.6,.11)]:sweep('Leg spine',[(0,y,z+.08),(0,y+.06,z+.15)],[.02,.003],[.02,.003],'#fff1d3',sw,sides=5,steps=1,kind='soft')
    return root

def make_claw_pincer():
    root=part_root('claw_pincer',(-.1,.75));sw=pivot('swing',(0,0,0),root,'swing')
    tube('Arm',[(0,-.08,0),(0,.24,.05),(0,.45,.18)],[.13,.11,.12],T,sw,sides=12,kind='tint')
    ellipsoid('Claw palm',(0,.52,.33),(.2,.21,.27),T,sw,'tint',seg=18,rings=12)
    tube('Upper pincer',[(0,.6,.48),(0,.66,.66),(0,.6,.83),(0,.51,.9)],[.11,.09,.055,.014],T,sw,sides=12,kind='tint')
    tube('Lower pincer',[(0,.4,.5),(0,.37,.66),(0,.42,.79),(0,.48,.84)],[.1,.08,.05,.014],T,sw,sides=12,kind='tint')
    for z in [.62,.74]:sweep('Pincer tooth',[(0,.6,z),(0,.53,z+.01)],[.025,.004],[.025,.004],'#fff1d3',sw,sides=5,steps=1,kind='soft')
    ellipsoid('Pincer gap',(0,.51,.6),(.06,.06,.08),'#7d5a62',sw,seg=10,rings=6)
    return root

def limb_chain(root,path,radii,cuts,suckers=0,sucker_r=.045,steps=5):
    # One tapered tube split at the chain pivots, with suckers on the curl side.
    segs=chain(root,[path[i] for i in cuts])
    rings=sweep_rings(path,radii,radii,(1,0,0),12,steps)
    chain_rings('Limb',segs,rings,[c*steps for c in cuts],T)
    for i in range(suckers):
        f=(i+1)/(suckers+1)*(len(path)-1.4);j=int(f);t=f-j;p=Vector(path[j]).lerp(Vector(path[j+1]),t);r=radii[j]*(1-t)+radii[j+1]*t
        d=(Vector(path[j+1])-Vector(path[j])).normalized();n=Vector((0,-d.z,d.y));pos=p+n*r*.86;theta=math.atan2(n.z,n.y)
        k=max(i2 for i2,c in enumerate(cuts) if c<=j)
        torus('Sucker',tuple(pos),max(.018,sucker_r*r/.14),max(.009,.017*r/.14),'#f3d2dc',segs[k],tilt=(theta,0,0),segments=10,sides=4)
    return segs

def make_tentacle():
    root=part_root('tentacle',(-.1,1.0))
    path=[(0,-.08,0),(0,.3,.02),(0,.58,.08),(0,.82,.18),(0,.95,.33),(0,.93,.46),(0,.85,.49)]
    limb_chain(root,path,[.16,.14,.115,.085,.06,.04,.018],[0,1,2,3],suckers=8)
    return root

def make_tentacle_long():
    root=part_root('tentacle_long',(-.1,1.6))
    path=[(0,-.08,0),(0,.32,.0),(0,.66,.05),(0,.98,.14),(0,1.28,.26),(0,1.5,.42),(0,1.56,.6),(0,1.47,.7),(0,1.38,.64)]
    limb_chain(root,path,[.13,.115,.1,.085,.065,.048,.032,.02,.01],[0,1,2,3,4],suckers=10,sucker_r=.04)
    return root

# Armor.
def make_spike():
    root=part_root('spike',(-.1,.6))
    sweep('Spike',[(0,-.1,0),(0,.22,-.03),(0,.55,-.13)],[.2,.12,.01],[.2,.12,.01],T,root,sides=14,steps=6)
    torus('Spike collar',(0,.0,0),.19,.04,T,root,kind='tint',segments=24,sides=6)
    torus('Growth ring',(0,.2,-.025),.125,.018,T,root,tilt=(.12,0,0),kind='tint',segments=20,sides=5)
    return root

def make_shell_plate():
    root=part_root('shell_plate',(-.1,.24))
    o=ellipsoid('Scalloped shell',(0,0,0),(.62,.24,.56),T,root,'tint',seg=40,rings=14)
    for v in o.data.vertices:
        x,z,y=v.co.x,-v.co.y,v.co.z;a=math.atan2(z,x);edge=1-max(0,y)/.24
        f=1+.07*math.cos(10*a)*edge;v.co.x*=f;v.co.y*=f
        if y<0:v.co.z*=.4
    o.data.update();paint(o,T,'tint')
    pts=[]
    for i in range(41):a=TAU*i/40;fr=.86;f=1+.07*math.cos(10*a)*fr;pts.append((math.cos(a)*.62*fr*f,.24*math.sqrt(1-fr*fr)+.004,math.sin(a)*.56*fr*f))
    tube('Rim ridge',pts,.02,T,root,sides=5,steps=1,kind='tint')
    for i in range(10):
        a=TAU*i/10;pts=[(math.cos(a)*.62*f,.24*math.sqrt(max(0,1-f*f))+.002,math.sin(a)*.56*f) for f in [.12,.4,.66,.84]]
        tube('Radial rib',pts,[.012,.026,.028,.016],T,root,sides=6,steps=3,kind='tint')
    ellipsoid('Crown boss',(0,.235,0),(.1,.03,.09),T,root,'tint',seg=12,rings=6)
    return root

def make_horn():
    root=part_root('horn',(-.1,.8))
    path=[(0,-.1,0),(0,.3,.05),(0,.6,.18),(0,.78,.38)]
    sweep('Curved horn',path,[.2,.15,.09,.012],[.2,.15,.09,.012],T,root,sides=14,steps=6)
    for i,(p,r) in enumerate([((0,.12,.01),.17),((0,.3,.05),.145),((0,.47,.1),.12)]):
        torus('Horn ridge',p,r,.02,T,root,tilt=(.15+i*.25,0,0),kind='tint',segments=22,sides=5)
    return root

def make_tower():
    root=part_root('tower',(-.1,.85))
    yloft('Turret wall',[(-.12,.3,.3),(.55,.27,.27),(.58,.33,.33),(.78,.33,.33),(.78,.3,.3)],T,root,seg=24)
    for i in range(8):a=TAU*i/8+.2;box('Crenel',(math.cos(a)*.3,.84,math.sin(a)*.3),(.1,.13,.1),T,root,.02,kind='tint',segments=1)
    cone('Candy spire',(0,1.05,0),.27,.54,'#8767b2',root,tip=.02)
    star('Spire star',(0,1.38,0),.08,'#ffe0a2',root)
    ellipsoid('Arched window',(0,.42,.265),(.07,.12,.025),'#ffdba1',root,'glow',seg=14,rings=10)
    box('Little door',(0,.07,.29),(.13,.2,.04),'#7d6b9d',root,.05,segments=2)
    for y in [.12,.3]:
        for i in range(6):a=TAU*i/6+y*5;box('Brick',(math.cos(a)*.29,y,math.sin(a)*.29),(.07,.04,.07),T,root,.012,kind='tint',segments=1)
    return root

# Sense and cosmic parts.
def make_antenna():
    root=part_root('antenna',(-.1,.8));nub(root,(.1,.06,.1),(0,-.02,0))
    sweep('Antenna stalk',[(0,-.06,0),(0,.3,.05),(0,.58,.18),(0,.72,.34)],[.06,.04,.03,.026],[.06,.04,.03,.026],T,root,sides=8,steps=5)
    ellipsoid('Ball tip',(0,.75,.4),(.085,.085,.085),'#ffcf9e',root,seg=14,rings=10)
    ellipsoid('Tip glint',(-.03,.8,.44),(.02,.015,.02),'#fffaf0',root,'glow',seg=6,rings=4)
    return root

def make_glow_bulb():
    root=part_root('glow_bulb',(-.1,.8));nub(root,(.12,.06,.12),(0,-.02,0))
    sweep('Lure stalk',[(0,-.06,0),(0,.35,.04),(0,.66,.2),(0,.78,.44),(0,.72,.58)],[.07,.05,.036,.03,.025],[.07,.05,.036,.03,.025],T,root,sides=8,steps=5)
    ellipsoid('Lure cap',(0,.71,.6),(.055,.04,.055),T,root,'tint',seg=10,rings=6)
    ellipsoid('Glowing bulb',(0,.6,.64),(.12,.13,.12),'#fff0a8',root,'glow',seg=16,rings=10,bottom='#ffc96b')
    for i in range(3):a=i*2.1;ellipsoid('Glow mote',(math.cos(a)*.2,.58+i*.05,.64+math.sin(a)*.2),(.022,.022,.022),'#fff4c8',root,'glow',seg=6,rings=4)
    return root

def make_cloak_fronds():
    # Kelp ribbons that flow back over the body; one chain drives all three.
    root=part_root('cloak_fronds',(-.1,.45));nub(root,(.36,.09,.2),(0,-.03,.02))
    cps=[(0,0,0),(0,.12,-.3),(0,.15,-.6),(0,.12,-.9)];segs=chain(root,cps);steps=5
    for f,x in enumerate([-.26,0,.26]):
        path=[(x*.6,-.05,.06),(x*1.0+.03*f,.12,-.3),(x*1.35-.04,.15,-.6),(x*1.6+.04,.12,-.9),(x*1.8,.04,-1.18)]
        rw=[.1,.19,.21,.17,.03];rings=sweep_rings(path,rw,.022,(1,0,0),10,steps)
        for j,ring in enumerate(rings):
            ctr=sum(ring,Vector())/len(ring)
            for i,v in enumerate(ring):
                side=math.cos(TAU*i/10);v.y+=math.sin(j*1.3+f)*.035*abs(side)**2
        chain_rings('Kelp frond',segs,rings,[k*steps for k in range(4)],T)
        for k in (1,2):ellipsoid('Air bladder',(path[k][0],path[k][1]+.035,path[k][2]+.12),(.04,.045,.045),'#e6e1b8',segs[k],seg=8,rings=6)
    return root

def make_halo():
    root=part_root('halo',(-.1,.7));nub(root,(.1,.06,.1),(0,-.02,0))
    sweep('Halo stem',[(0,-.06,0),(0,.32,-.06),(0,.55,-.2),(0,.64,-.29)],[.045,.035,.028,.024],[.045,.035,.028,.024],T,root,sides=8,steps=5)
    torus('Glowing halo',(0,.72,0),.3,.045,'#ffe2a4',root,tilt=(-.2,0,0),kind='glow',segments=40,sides=8)
    for i in range(4):a=i*1.6+.4;ellipsoid('Halo sparkle',(math.cos(a)*.42,.8+.06*math.sin(i*2),math.sin(a)*.42),(.025,.025,.025),'#fff6d8',root,'glow',seg=6,rings=4)
    return root

def make_star_crown():
    root=part_root('star_crown',(-.1,.5))
    yloft('Crown band',[(-.08,.34,.34),(.12,.36,.36),(.14,.33,.33),(.12,.3,.3),(.08,.3,.3)],T,root,seg=28)
    ellipsoid('Velvet cushion',(0,.1,0),(.3,.12,.3),'#8a6fc0',root,seg=20,rings=8)
    for i in range(5):
        a=TAU*i/5+math.pi/2;cx=math.cos(a);cz=math.sin(a);big=1.25 if i==0 else 1
        sweep('Crown point',[(cx*.33,.08,cz*.33),(cx*.37,.3*big,cz*.37),(cx*.39,.4*big,cz*.39)],[.08,.035,.012],[.04,.02,.01],T,root,wdir=(-cz,0,cx),sides=8,steps=3)
        s=star('Crown star',(0,0,0),.1*big,'#ffe2a4',root)
        xf([s],gm(ry=math.atan2(cx,cz),t=(cx*.41,.45*big+.04,cz*.41)))
        ellipsoid('Band jewel',(math.cos(a+.63)*.36,.03,math.sin(a+.63)*.36),(.035,.035,.035),'#9ad9ff',root,'glow',seg=8,rings=6)
    return root

def make_nebula_fin():
    # A glowing cosmic membrane with star specks; the root and rim take the tint.
    root=part_root('nebula_fin',(-.1,1.0));flap=pivot('flap',(0,0,0),root,'flap')
    ellipsoid('Fin root',(0,-.02,-.08),(.09,.08,.28),T,flap,'tint',seg=14,rings=8)
    edge=[(0,.16,.3),(0,.55,.26),(0,.9,.06),(0,1.06,-.22),(0,.84,-.36),(0,.7,-.3),(0,.56,-.52),(0,.26,-.58),(0,.05,-.42)]
    o=fin('Nebula membrane',(0,-.02,0),edge,'#c9b4ff',flap,thickness=.05,kind='glow',ribs=False);attr=o.data.color_attributes['Tint']
    for v in o.data.vertices:
        y=v.co.z;z=-v.co.y;cloud=.5+.5*math.sin(y*7.3+z*5.1)*math.cos(z*6.7-y*2.2)
        c=mix(mix(color('#2c2180'),color('#6a4fd8'),min(1,y/.9)),color('#c06bc9') if z<-.2 else color('#4f8fe0'),cloud*.55)
        attr.data[v.index].color=(*c,1)
    sweep('Fin rim',[(0,.0,.22)]+edge[:-1],.028,.028,T,flap,sides=6,steps=3)
    for i in range(18):
        t=(i*.618)%1;r=.22+.6*((i*.37)%1);a=-1.15+2.1*t;side=-1 if i%2 else 1
        ellipsoid('Star speck',(side*.032,r*math.cos(a)*.95+.04,r*math.sin(a)*.62-.1),(.02,.02,.02),'#fff6d8',flap,'glow',seg=6,rings=4)
    for p,r in [((0,.62,-.12),.07),((0,.34,.06),.05),((0,.8,-.18),.045)]:
        for side in [-1,1]:
            st=star('Fin star',(0,0,0),r,'#fff3c4',root);xf([st],gm(ry=side*math.pi/2,t=(side*.03,p[1],p[2])));st.parent=flap
    return root

def make_wing_feather():
    # A soft feathered wing in the local Y/Z plane: leading arm, scalloped
    # flight feathers, and a smaller layered row of coverts on each face.
    root=part_root('wing_feather',(-.1,1.25));flap=pivot('flap',(0,0,0),root,'flap')
    lead=[(0,.1,.12),(0,.4,.22),(0,.76,.24),(0,1.1,.12),(0,1.3,-.06)]
    tips=[(0,1.2,-.32),(0,1.0,-.5),(0,.78,-.62),(0,.55,-.64),(0,.33,-.56),(0,.13,-.4)]
    def scallop(tp,pull):
        out=[]
        for i,t in enumerate(tp):
            out.append(t)
            if i+1<len(tp):m=Vector(t).lerp(Vector(tp[i+1]),.5);out.append(tuple(m*(1-pull)))
        return out
    edge=lead+[tuple(Vector(lead[-1]).lerp(Vector(tips[0]),.5)*.9)]+scallop(tips,.13)+[(0,.0,-.22)]
    fin('Flight feathers',(0,0,0),edge,T,flap,thickness=.045,ribs=False,sub=3)
    cov=[tuple(Vector(t)*.62) for t in [(0,1.25,-.22),(0,1.06,-.42),(0,.86,-.55),(0,.64,-.6),(0,.42,-.56),(0,.2,-.45)]]
    cedge=[tuple(Vector(t)*.66) for t in lead]+scallop(cov,.1)+[(0,.0,-.16)]
    for side in [-1,1]:
        o=fin('Covert feathers',(0,0,0),cedge,T,flap,thickness=.035,ribs=False,sub=3);o.data.transform(Matrix.Translation((side*.03,0,0)))
    sweep('Wing arm',[(0,-.08,.06),(0,.4,.2),(0,.84,.18),(0,1.2,.0)],[.1,.08,.06,.03],[.085,.075,.055,.028],T,flap,wdir=(0,0,1),sides=10,steps=5)
    for t in tips:
        t=Vector(t);b=Vector((0,t.y*.62,.1));tube('Feather quill',[tuple(b+Vector((.026,0,0))),tuple(b.lerp(t,.55)+Vector((.026,0,0))),tuple(b.lerp(t,.92)+Vector((.026,0,0)))],[.012,.01,.004],'#fff6e8',flap,sides=5,steps=3)
    return root

def make_jet_vent():
    root=part_root('jet_vent',(-.1,.6))
    yloft('Nozzle',[(-.1,.32,.32),(.06,.31,.31),(.2,.25,.25),(.32,.24,.24),(.45,.3,.3),(.53,.33,.33),(.57,.31,.31),(.56,.27,.27),(.45,.22,.22),(.36,.19,.19)],T,root,seg=24)
    torus('Nozzle band',(0,.2,0),.26,.03,'#8b98a3',root,segments=28,sides=6)
    for i in range(8):a=TAU*i/8;ellipsoid('Rivet',(math.cos(a)*.31,.02,math.sin(a)*.31),(.025,.025,.025),'#8b98a3',root,seg=6,rings=4)
    ellipsoid('Glowing core',(0,.38,0),(.2,.05,.2),'#ffd27a',root,'glow',seg=18,rings=6)
    paint(cone('Exhaust flame',(0,.56,0),.15,.38,'#a7e6ff',root,tip=.01),'#a7e6ff','glow',bottom='#fff0b8')
    return root

def make_copepod():
    root=empty('food_copepod')
    ellipsoid('Copepod body',(0,.21,.06),(.19,.17,.25),'#f6a983',root,seg=18,rings=12,bottom='#d97a6c')
    ellipsoid('Body segment',(0,.2,-.16),(.15,.13,.12),'#f4b08c',root,seg=14,rings=8,bottom='#d97a6c')
    ellipsoid('Body segment',(0,.19,-.27),(.11,.1,.09),'#f6b896',root,seg=12,rings=8,bottom='#d97a6c')
    tube('Little tail',[(0,.19,-.3),(0,.18,-.42),(0,.2,-.5)],[.05,.035,.026],'#f1a48a',root,sides=7,steps=3)
    for side in [-1,1]:
        tube('Tail bristle',[(0,.2,-.5),(side*.05,.22,-.6),(side*.09,.25,-.67)],[.016,.01,.003],'#ffe0c0',root,sides=5,steps=3)
        ant=[(side*.1,.3,.2),(side*.36,.38,.19),(side*.62,.34,.07),(side*.78,.25,-.11)]
        tube('Long antenna',ant,[.026,.019,.012,.004],'#ffd9b5',root,sides=6,steps=5)
        for k in range(3):p=Vector(ant[k+1]);tube('Antenna bristle',[tuple(p),tuple(p+Vector((side*.02,-.07,-.04)))],[.008,.002],'#ffe9d2',root,sides=4,steps=1)
        for i in range(3):tube('Swim leg',[(side*.07,.08,.12-i*.1),(side*.15,.0,.08-i*.1),(side*.17,-.03,.03-i*.1)],[.022,.016,.005],'#e98e7c',root,sides=5,steps=2)
        ellipsoid('Eye',(side*.065,.28,.25),(.058,.068,.05),'#fff1d9',root,seg=12,rings=8)
        ellipsoid('Pupil',(side*.065,.29,.29),(.034,.044,.016),'#153e49',root,'eye',seg=10,rings=6)
        ellipsoid('Glint',(side*.065-.012,.305,.302),(.01,.012,.005),'#fffaf0',root,'glow',seg=6,rings=4)
        ellipsoid('Blush',(side*.14,.19,.24),(.04,.018,.02),'#ef8e8d',root,seg=8,rings=6)
    tube('Tiny smile',[(-.035,.2,.302),(0,.185,.31),(.035,.2,.302)],.007,'#7d4a50',root,sides=5,steps=3)
    return root

def make_worm():
    # A curled little bristle worm with soft parapodia tufts.
    root=empty('food_worm');n=11;r=.27;span=3.6;pts=[]
    for i in range(n):
        f=i/(n-1);a=-.6+span*f;lift=.1+.1*max(0,f-.7)/.3
        pts.append((math.cos(a)*r*(1-.15*(1-f)),lift,math.sin(a)*r*(1-.15*(1-f))))
    for i,p in enumerate(pts):
        f=i/(n-1);rad=.05+.06*f
        ellipsoid('Worm segment',p,(rad,rad*.9,rad),'#f19a8c' if i%2 else '#f7b3a0',root,seg=10,rings=7,bottom='#d87b78')
        if i==n-1 or i==0:continue
        d=(Vector(pts[i+1])-Vector(p)).normalized();side_v=Vector((-d.z,0,d.x))
        for side in [-1,1]:
            base=Vector(p)+side_v*side*rad*.8
            ellipsoid('Soft parapod',tuple(base+side_v*side*.012),(.026,.022,.026),'#f4a596',root,seg=6,rings=3)
            for k in [-1,0,1]:
                tip=base+side_v*side*(.075+.015*(k==0))+d*k*.03+Vector((0,.012+.01*(k==0),0))
                tube('Soft bristle',[tuple(base+side_v*side*.02),tuple(base.lerp(tip,.6)+Vector((0,.008,0))),tuple(tip)],[.009,.007,.003],'#ffd9cc',root,sides=4,steps=1)
    head=Vector(pts[-1]);d=(head-Vector(pts[-2])).normalized();side_v=Vector((-d.z,0,d.x))
    for side in [-1,1]:
        e=head+d*.075+side_v*side*.048+Vector((0,.045,0))
        ellipsoid('Eye',tuple(e),(.03,.034,.03),'#fff1d9',root,seg=10,rings=6)
        ellipsoid('Pupil',tuple(e+d*.02+Vector((0,.004,0))),(.019,.023,.019),'#153e49',root,'eye',seg=8,rings=6)
        ellipsoid('Glint',tuple(e+d*.033+Vector((0,.014,0))-side_v*side*.006),(.006,.006,.006),'#fffaf0',root,'glow',seg=6,rings=4)
        palp=head+d*.08+side_v*side*.03+Vector((0,.06,0))
        tube('Palp',[tuple(palp),tuple(palp+d*.05+side_v*side*.035+Vector((0,.03,0)))],[.014,.009],'#f7b3a0',root,sides=6,steps=1)
        ellipsoid('Palp tip',tuple(palp+d*.05+side_v*side*.035+Vector((0,.03,0))),(.012,.012,.012),'#f7b3a0',root,seg=6,rings=4)
    tube('Tiny smile',[tuple(head+d*.1-side_v*.025-Vector((0,.01,0))),tuple(head+d*.108-Vector((0,.02,0))),tuple(head+d*.1+side_v*.025-Vector((0,.01,0)))],.006,'#7d4a50',root,sides=5,steps=3)
    return root

BUILDERS.update({
    'part_mouth_nibbler':make_mouth_nibbler,'part_mouth_snapper':make_mouth_snapper,'part_mouth_beak':make_mouth_beak,
    'part_mouth_filter':make_mouth_filter,'part_mouth_fangs':make_mouth_fangs,'part_mouth_maw':make_mouth_maw,
    'part_eye_bead':make_eye_bead,'part_eye_stalk':make_eye_stalk,'part_eye_big':make_eye_big,
    'part_eye_compound':make_eye_compound,'part_eye_cosmic':make_eye_cosmic,
    'part_fin_side':make_fin_side,'part_fin_dorsal':make_fin_dorsal,'part_fin_frill':make_fin_frill,
    'part_tail_paddle':make_tail_paddle,'part_tail_fan':make_tail_fan,'part_tail_fluke':make_tail_fluke,
    'part_leg_little':make_leg_little,'part_leg_crab':make_leg_crab,'part_wing_feather':make_wing_feather,
    'part_jet_vent':make_jet_vent,'part_claw_pincer':make_claw_pincer,'part_tentacle':make_tentacle,
    'part_tentacle_long':make_tentacle_long,'part_spike':make_spike,'part_shell_plate':make_shell_plate,
    'part_horn':make_horn,'part_tower':make_tower,'part_antenna':make_antenna,'part_glow_bulb':make_glow_bulb,
    'part_cloak_fronds':make_cloak_fronds,'part_halo':make_halo,'part_star_crown':make_star_crown,
    'part_nebula_fin':make_nebula_fin,'copepod':make_copepod,'worm':make_worm})
PARTS=[n for n in BUILDERS if n.startswith('part_')]
NEW_ASSETS=PARTS+['copepod','worm']
