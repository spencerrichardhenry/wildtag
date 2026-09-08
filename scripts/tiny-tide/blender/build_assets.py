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
    bsdf.inputs['Roughness'].default_value={'soft':.43,'eye':.13,'leaf':.67,'rock':.82,'glow':.3}[kind]
    bsdf.inputs['Metallic'].default_value=.1 if kind=='eye' else 0
    if kind=='soft': bsdf.inputs['Subsurface Weight'].default_value=.045
    if kind=='glow':m.node_tree.links.new(paint.outputs['Color'],bsdf.inputs['Emission Color']);bsdf.inputs['Emission Strength'].default_value=.65
    MATS[kind]=m;return m

def paint(obj, hexcolor, kind='soft', gradient=True, bottom=None):
    obj.data.materials.clear();obj.data.materials.append(mat(kind)); base=color(hexcolor); lower=color(bottom) if bottom else tuple(c*.76 for c in base)
    attr=obj.data.color_attributes.get('Tint') or obj.data.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT')
    zvals=[v.co.z for v in obj.data.vertices]; lo=min(zvals,default=0); span=max(zvals,default=1)-lo or 1
    for v in obj.data.vertices:
        t=(v.co.z-lo)/span; c=mix(lower,base,.35+.65*t) if gradient else base
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

def box(name,p,s,c,parent=None,bevel=.06,kind='soft'):
    x,y,z=p;a,b,d=[v*.5 for v in s]
    verts=[(x+ix*a,y+iy*b,z+iz*d) for ix,iy,iz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
    o=mesh(name,verts,faces,c,parent,kind)
    if bevel:mod=o.modifiers.new('Hand softened edges','BEVEL');mod.width=bevel;mod.segments=3;apply_mod(o,mod);paint(o,c,kind)
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
    global CURRENT
    prior=bpy.data.collections.get(name)
    if prior:
        for o in list(prior.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(prior)
    CURRENT=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(CURRENT)
    root=fn();root['tiny_tide_asset']=name;root['authored_in']='Blender 5.2 via Blender MCP';merge_static(root)
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
    MANIFEST[name]={'file':name+'.glb','triangles':triangles,'bytes':path.stat().st_size,'authoring':'Blender MCP','animated':any(o.animation_data for o in CURRENT.all_objects)}
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
