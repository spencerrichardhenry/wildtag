"""Original sky kingdom kit. Run via Blender MCP; never modifies another scene.
The same layout-data.json drives exported geometry and the game's collision map.
"""
import bpy, math, json, random, importlib.util, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'public/wildtag/models'; ART=ROOT/'art/wildtag/sky'
DATA=json.loads((ROOT/'src/sky/layout-data.json').read_text())
spec=importlib.util.spec_from_file_location('sky_geometry_helpers',ROOT/'scripts/tiny-tide/blender/build_assets.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
CREAM='#e9e4cf'; WHITE='#f6f0d8'; GOLD='#bd9753'; TEAL='#548c91'; DARK='#436270'; CLOUD='#d7e4e7'; STONE='#a0b3bc'; BLUE='#80d3d5'; PINK='#cbb4b1'
MATS={};CURRENT=None

def mat(kind='soft'):
    if kind in MATS:return MATS[kind]
    m=bpy.data.materials.get('SkyKingdom_'+kind) or bpy.data.materials.new('SkyKingdom_'+kind)
    m.use_nodes=True;n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');b=n.new('ShaderNodeBsdfPrincipled');v=n.new('ShaderNodeVertexColor');v.layer_name='Tint'
    m.node_tree.links.new(v.outputs['Color'],b.inputs['Base Color']);m.node_tree.links.new(b.outputs['BSDF'],out.inputs['Surface'])
    b.inputs['Roughness'].default_value={'soft':.66,'rock':.83,'eye':.19,'leaf':.75,'glow':.48}[kind]
    if kind=='eye':b.inputs['Metallic'].default_value=.32
    m.node_tree.links.new(v.outputs['Color'],b.inputs['Emission Color']);b.inputs['Emission Strength'].default_value=.55 if kind=='glow' else .055
    MATS[kind]=m;return m
H.mat=mat

def box(n,p,s,c=CREAM,bevel=.09,parent=None):return H.box(n,p,s,c,parent,bevel=bevel,kind='rock')
def orb(n,p,s,c=CREAM,parent=None,seg=16,rings=10):return H.ellipsoid(n,p,s,c,parent,seg=seg,rings=rings)
def beam(n,a,b,r=.06,c=GOLD,parent=None):return H.tube(n,[a,b],[r,r],c,parent,sides=8,steps=1,kind='rock')
def ring(n,p,r,t,c=GOLD,vertical=False,parent=None):return H.torus(n,p,r,t,c,parent,tilt=(math.pi/2,0,0) if vertical else (0,0,0),segments=32,sides=6,kind='eye')
def begin(id):
    global CURRENT
    old=bpy.data.collections.get('SKY_'+id)
    if old:
        for o in list(old.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(old)
    CURRENT=bpy.data.collections.new('SKY_'+id);bpy.context.scene.collection.children.link(CURRENT);H.CURRENT=CURRENT

def merge_objects(objects,name):
    if not objects:return
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name=name
    bpy.context.object.select_set(False)

def export(id,category='sky',moving=False):
    # One mesh per material / rig part. Vertex paint preserves all color detail.
    if not moving:merge_objects([o for o in CURRENT.objects if o.type=='MESH'],id+'_surface')
    else:
        parents=set(o.parent for o in CURRENT.objects if o.type=='MESH')
        for i,parent in enumerate(parents):merge_objects([o for o in CURRENT.objects if o.type=='MESH' and o.parent==parent],id+'_rigmesh_'+str(i))
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in CURRENT.objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(CURRENT.objects))
    p=OUT/(id+'.glb');bpy.ops.export_scene.gltf(filepath=str(p),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_extras=True,export_animations=False)
    tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in CURRENT.objects if o.type=='MESH')
    entry=dict(id=id,category=category,triangles=tris,sourceTriangles=0,bytes=p.stat().st_size,parts=sum(o.type=='MESH' for o in CURRENT.objects),authoring='Blender MCP')
    manifest_path=ROOT/'public/wildtag/asset-manifest.json';manifest=json.loads(manifest_path.read_text());manifest['assets']=[a for a in manifest['assets'] if a['id']!=id]+[entry];manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    for o in CURRENT.objects:o.select_set(False);o.hide_set(True)
    print(json.dumps(entry),flush=True)

def arch(x,z,y=4,width=6,height=6,depth=.7,parent=None):
    for sx in [-1,1]:
        box('Fluted arch pier',(x+sx*width/2,y+height*.3,z),(.7,height*.6,depth),CREAM,parent=parent)
        for gy in [.18,height*.56]:box('Pier collar',(x+sx*width/2,y+gy,z),(.94,.2,depth+.18),GOLD,parent=parent)
    pts=[(x+math.cos(a)*width/2,y+height*.6+math.sin(a)*height*.4,z) for a in [i*math.pi/20 for i in range(21)]]
    H.tube('Carved arch crown',pts,[.39]*21,WHITE,parent,sides=8,steps=1,kind='rock')
    for i in range(1,20,3):
        a=i*math.pi/20;orb('Arch inlay',(x+math.cos(a)*width/2,y+height*.6+math.sin(a)*height*.4,z+depth*.48),(.13,.13,.08),GOLD,parent)

def visible_floor_rects(f):
    # Cut overlaps against earlier coplanar slabs, avoiding Z-fighting at joins.
    parts=[(f['x']-f['w']/2,f['z']-f['d']/2,f['x']+f['w']/2,f['z']+f['d']/2)]
    for old in DATA['floors']:
        if old['id']==f['id']:break
        if old['rise'] or old['y']!=f['y']:continue
        c,d,e,g=old['x']-old['w']/2,old['z']-old['d']/2,old['x']+old['w']/2,old['z']+old['d']/2
        out=[]
        for a,b,h,j in parts:
            l,r,t,u=max(a,c),min(h,e),max(b,d),min(j,g)
            if l>=r or t>=u:out.append((a,b,h,j));continue
            for rect in [(a,b,l,j),(r,b,h,j),(l,b,r,t),(l,u,r,j)]:
                if rect[2]-rect[0]>.001 and rect[3]-rect[1]>.001:out.append(rect)
        parts=out
    return parts

def sector(name):
    begin('sky_sector_'+name);rng=random.Random(name)
    for f in DATA['floors']:
        if f['sector']!=name:continue
        x,z,w,d,y=f['x'],f['z'],f['w'],f['d'],f['y'];rise=f['rise']
        if rise:
            axis=f['axis']
            def top(a,b):return y+rise*((a-x)/w+.5 if axis=='x' else (b-z)/d+.5 if axis=='-z' else .5-(b-z)/d)
            v=[(a,top(a,b)+dy,b) for dy in [-.8,0] for a,b in [(x-w/2,z-d/2),(x+w/2,z-d/2),(x+w/2,z+d/2),(x-w/2,z+d/2)]]
            H.mesh('Sloping cloudstone walkway',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],CREAM,kind='rock',smooth=False)
            for i in range(19):
                t=i/18;a=x+(t-.5)*w if axis=='x' else x;b=z if axis=='x' else z+(t-.5)*d
                box('Brass tread',(a,top(a,b)+.018,b),(.06,.03,d-.5) if axis=='x' else (w-.5,.03,.06),GOLD,bevel=0)
        else:
            for a,b,c,e in visible_floor_rects(f):
                box('Cloudstone floor '+f['id'],((a+c)/2,y-.5,(b+e)/2),(c-a,1,e-b),CREAM,bevel=.025)
            if 'roof' in f['id']:
                box('Roof cornice',(x,y-.15,z),(w+.35,.25,d+.35),GOLD,bevel=.08)
                # A shallow teal tile cap reads on the skyline without filling the room below.
                if name in ['observatory','sanctuary']:
                    box('Patinated roof crown',(x,y+.25,z),(w*.92,.45,d*.92),TEAL,bevel=.18)
            elif 'ramp' not in f['id']:
                # Soft billowing island skirts, opaque and shadowed rather than fill-rate-heavy alpha clouds.
                for side in [-1,1]:
                    for i in range(max(3,int(w/4))):
                        a=x-w*.43+i*w*.86/max(2,int(w/4)-1)
                        orb('Sculpted cloud bank',(a,y-2.55,z+side*d*.43),(3.6,2.25,3.3),CLOUD,seg=12,rings=8)
                    for i in range(max(3,int(d/5))):
                        b=z-d*.4+i*d*.8/max(2,int(d/5)-1)
                        orb('Sculpted cloud edge',(x+side*w*.44,y-2.6,b),(3,2.35,3.6),CLOUD,seg=12,rings=8)
                # Pavement tile grid, engraved at the surface, with a warm perimeter line.
                for a,b,c,e in visible_floor_rects(f):
                    for xx in range(math.ceil(a)+2,math.floor(c),4):box('Pavement seam',(xx,y+.014,(b+e)/2),(.025,.016,e-b-.06),STONE,bevel=0)
                    for zz in range(math.ceil(b)+2,math.floor(e),4):box('Pavement seam',((a+c)/2,y+.014,zz),(c-a-.06,.016,.025),STONE,bevel=0)
    for b in DATA['walls']:
        if b['sector']!=name:continue
        x,z,y,w,d,h=b['x'],b['z'],b['y'],b['w'],b['d'],b['h']
        box('Masonry '+b['id'],(x,y+h/2,z),(w,h,d),CREAM,bevel=.08)
        if h>3:
            for dy in [.2,h-.25]:box('Wall cornice',(x,y+dy,z),(w+.13,.23,d+.13),GOLD)
            # Inlaid shallow relief panels keep interior walls from being blank planes.
            if w>4:
                for dx in range(int(-w/2)+2,int(w/2),4):box('Wall relief',(x+dx,y+h*.48,z+d/2+.012),(1.6,h*.36,.04),STONE,bevel=.015)
            if d>4:
                for dz in range(int(-d/2)+2,int(d/2),4):box('Wall relief',(x+w/2+.012,y+h*.48,z+dz),(.04,h*.36,1.6),STONE,bevel=.015)
    for a in DATA['arches']:
        if a['sector']!=name:continue
        parent=H.empty('Arch surround',(a['x'],a['y'],a['z']));parent.rotation_euler.z=a['yaw']
        arch(0,0,0,a['w'],a['h'],parent=parent)
    export('sky_sector_'+name)

def prop_asset(kind):
    begin('sky_'+kind)
    if kind=='lantern':
        box('Lantern foot',(0,.1,0),(.8,.2,.8),GOLD);beam('Twisted lantern stem',(0,.2,0),(0,3.5,0),.09,TEAL)
        ring('Lantern halo',(0,3.65,0),.55,.055,GOLD,True)
        orb('Warm glass',(0,3.25,0),(.25,.43,.25),'#ffdda2')
        for a in range(4):beam('Glass ribs',(math.cos(a*math.pi/2)*.3,2.85,math.sin(a*math.pi/2)*.3),(math.cos(a*math.pi/2)*.3,3.6,math.sin(a*math.pi/2)*.3),.035,GOLD)
    elif kind=='planter':
        H.tube('Terracotta urn',[(0,0,0),(0,.3,0),(0,.9,0),(0,1.25,0)],[.55,.7,.8,.64],TEAL,sides=16,steps=2,kind='rock');ring('Urn lip',(0,1.25,0),.67,.09,GOLD)
        for i in range(9):
            a=i*2.4;x=math.sin(a)*.6;z=math.cos(a)*.6;beam('Silvergrass stem',(0,1,0),(x,2+(i%3)*.25,z),.03,'#719a8c');orb('Silvergrass plume',(x,2+(i%3)*.25,z),(.18,.5,.15),WHITE)
    elif kind=='stall':
        box('Stall base',(0,.22,0),(4.8,.44,3),TEAL)
        for x in [-2.1,2.1]:
            for z in [-1.1,1.1]:beam('Market post',(x,.2,z),(x,3.8,z),.11,GOLD)
        for i in range(8):box('Striped awning',(-2.1+i*.6,3.72,0),(.58,.13,3.4),TEAL if i%2 else WHITE)
        box('Market counter',(0,1.1,.8),(4.5,.23,.8),GOLD)
        for i in range(5):orb('Market wares',(-1.6+i*.8,1.5,.8),(.23,.32,.24),[PINK,BLUE,CREAM][i%3])
        box('Draped counter',(0,.7,1),(4,.65,.07),PINK)
    elif kind=='bench':
        for x in [-1.2,1.2]:box('Bench carved foot',(x,.4,0),(.3,.8,.9),GOLD)
        for z in [-.3,0,.3]:box('Seat plank',(0,.85,z),(3,.13,.25),TEAL)
        box('Bench back',(0,1.4,-.42),(3,.85,.15),CREAM)
    elif kind=='bookshelf':
        for x in [-.25,.25]:box('Bookcase upright',(x,1.4,0),(.13,2.8,3),GOLD)
        for y in [.2,1,1.8,2.6]:
            box('Book shelf',(0,y,0),(.6,.1,3),GOLD)
            for i in range(8):box('Bound weather journal',(0,y+.34,-1.25+i*.34),(.5,.56,.22),[TEAL,PINK,CREAM,DARK][i%4],bevel=.03)
    elif kind=='nest':
        for j in range(4):ring('Woven eagle nest',(0,.22+j*.16,0),1.1-j*.04,.15,'#947951')
        for i in range(20):
            a=i*math.tau/20;beam('Nest twigs',(math.cos(a)*.7,.4,math.sin(a)*.7),(math.cos(a+.4)*1.4,.45,math.sin(a+.4)*1.4),.045,GOLD)
        for x in [-.32,.32]:orb('Speckled egg',(x,.6,0),(.23,.33,.23),CREAM)
    elif kind=='spire':
        for y,r in [(0,1.6),(.5,1.3),(1,1.1)]:H.tube('Spire plinth',[(0,y,0),(0,y+.3,0)],[r,r],CREAM,sides=12,steps=1,kind='rock')
        H.tube('Fluted cloud spire',[(0,1.3,0),(0,8,0),(0,10,0),(0,12.5,0)],[1.05,.75,1.2,.03],TEAL,sides=12,steps=1,kind='rock')
        for y in [1.4,7.8,9.9]:ring('Spire gold collar',(0,y,0),1.08 if y<2 else .85,.13,GOLD)
        ring('Spire crown',(0,12.9,0),.65,.10,GOLD,True);orb('Spire sky pearl',(0,12.9,0),(.28,.28,.28),BLUE)
    elif kind=='orrery':
        H.tube('Orrery pedestal',[(0,0,0),(0,.25,0),(0,1.15,0)],[1.3,1.1,.55],TEAL,sides=16,steps=1,kind='rock')
        for r in [1.1,1.65,2.2]:ring('Celestial orbit',(0,2.25,0),r,.055,GOLD,vertical=r==1.65)
        orb('Miniature sun',(0,2.25,0),(.47,.47,.47),'#efd595')
        for a,r in [(0,1.1),(2.6,1.65),(4,2.2)]:orb('Orbiting world',(math.cos(a)*r,2.25,math.sin(a)*r),(.19,.19,.19),BLUE)
    elif kind=='bell':
        for x in [-1.6,1.6]:beam('Bell support',(x,0,0),(x,5,0),.16,TEAL)
        beam('Bell crossbeam',(-1.8,4.9,0),(1.8,4.9,0),.18,GOLD)
        H.tube('Bell body',[(0,2.4,0),(0,2.8,0),(0,3.8,0),(0,4.1,0)],[1.1,.8,.5,.28],GOLD,sides=24,steps=3,kind='eye')
        ring('Bell lip',(0,2.4,0),1.08,.10,GOLD);orb('Bell clapper',(0,2.45,0),(.18,.2,.18),DARK)
    elif kind=='chime':
        for x in [-.8,.8]:beam('Chime fork',(x,0,0),(x,2.6,0),.07,TEAL)
        arch(0,0,0,1.6,2.8,.15)
        for i in range(5):
            x=-.55+i*.275;beam('Chime string',(x,2.5,0),(x,1.9,0),.008,GOLD);beam('Wind chime pipe',(x,1.9,0),(x,.75+(i%3)*.18,0),.055,GOLD)
        orb('Chime seal',(0,.65,0),(.22,.22,.09),BLUE)
    elif kind=='skyglass':
        for i in range(7):
            a=i*2.4;x=math.sin(a)*.65;z=math.cos(a)*.65
            H.tube('Skyglass prism',[(x,0,z),(x,1+(i%3)*.35,z),(x+.12,1.3+(i%3)*.35,z+.08)],[.2,.14,.015],BLUE if i%2 else WHITE,sides=6,steps=1,kind='glow')
        ring('Stone vein',(0,.08,0),1,.12,STONE)
    elif kind=='anchor':
        H.tube('Grapple beacon stem',[(0,-6,0),(0,0,0)],[.35,.24],TEAL,sides=12,steps=1,kind='rock')
        ring('Grapple beacon outer halo',(0,0,0),3.3,.18,GOLD,True)
        ring('Grapple beacon inner halo',(0,0,0),2.6,.13,BLUE,True)
        orb('Hookable cloudstone knot',(0,-2.15,0),(.8,.4,.65),GOLD,seg=24,rings=16)
        for x in [-1,1]:
            H.fan('Beacon wings',(x*2,0,0),[(x*3.5,1.7,0),(x*4.5,1.2,0),(x*4,.4,0),(x*3,-.2,0)],WHITE,thickness=.13)
    elif kind in ['launch_pad','drone_pad']:
        H.tube('Cloudstone bounce rim',[(0,-.2,0),(0,0,0)],[2.8,2.8],GOLD,sides=32,steps=1,kind='rock')
        membrane=H.empty('Bouncing membrane');membrane['part']='membrane'
        H.tube('Laced trampoline membrane',[(0,.03,0),(0,.10,0)],[2.55,2.55],TEAL,membrane,sides=32,steps=1,kind='soft')
        for i in range(24):
            a=i*math.tau/24;beam('Membrane lacing',(math.cos(a)*2.45,.1,math.sin(a)*2.45),(math.cos(a)*2.8,.04,math.sin(a)*2.8),.025,CREAM)
        ring('Bounce emblem',(0,.12,0),.7,.045,GOLD)
        for sx,sz in [(-1,-1),(-1,1),(1,-1),(1,1)]:
            x=sx*2.5;z=sz*2.5
            if kind=='launch_pad':box('Launch pad feet',(sx*1.7,-.4,sz*1.7),(.3,.8,.3),CREAM)
            else:
                beam('Drone tether',(sx*1.8,-.12,sz*1.8),(x,.4,z),.075,GOLD)
                orb('Hover drone shell',(x,.35,z),(.62,.37,.62),CREAM)
                ring('Rotor guard',(x,.8,z),.8,.08,GOLD)
                rotor=H.empty('Hover drone rotor',(x,.82,z));rotor['part']='rotor'
                box('Rotor blade',(0,0,0),(1.3,.04,.12),TEAL,bevel=.02,parent=rotor)
                orb('Drone blue eye',(x,.3,z+sz*.55),(.13,.15,.08),BLUE)
    export('sky_'+kind,moving=kind in ['launch_pad','drone_pad'])

def critter(id,angel=False):
    begin('critter_'+id)
    body=H.empty(id+'_body');body['part']='body'
    head=H.empty(id+'_head',(0,.18,.65),body);head['part']='head'
    orb('Flight breast',(0,0,0),(.46,.45,.92),CREAM if angel else '#77563b',body,24,16)
    orb('Head',(0,0,.17),(.37,.39,.39),WHITE,head,24,16)
    if angel:
        ring('Seraphlet halo',(0,.86,.55),.56,.055,GOLD,False,body)
        for i in range(7):orb('Halo light seed',(math.cos(i*math.tau/7)*.56,.86,.55+math.sin(i*math.tau/7)*.56),(.035,.055,.035),BLUE,body)
        for x in [-.16,.16]:orb('Gentle luminous eyes',(x,.04,.50),(.09,.12,.05),DARK,head);orb('Eye glint',(x-.02,.085,.54),(.025,.028,.015),WHITE,head)
        H.tube('Beak',[(0,-.12,.48),(0,-.22,.63)],[.08,.018],GOLD,head,sides=8,steps=2)
    else:
        H.tube('Hooked eagle beak',[(0,-.05,.49),(0,-.08,.77),(0,-.25,.72)],[.13,.105,.01],GOLD,head,sides=10,steps=3)
        for x in [-.29,.29]:orb('Golden eagle eye',(x,.12,.36),(.095,.1,.075),GOLD,head);orb('Dark eagle pupil',(x*1.03,.12,.39),(.049,.061,.035),DARK,head)
        for i in range(5):H.fan('Suncrest feather',(0,.29,.1),[(-.08,.48+i*.018,-.02-i*.09),(0,.60,-.13-i*.09),(.08,.48,-.02-i*.09)],GOLD,head,thickness=.025)
    for row in range(3 if angel else 1):
        for side in [-1,1]:
            wing=H.empty(id+'_wing_'+str(row)+'_'+str(side),(side*.32,.04-row*.07,.25-row*.46),body);wing['part']='wing';wing['side']=side;wing['row']=row
            span=(2.1-row*.32) if angel else 2.65
            H.fan('Layered feather wing',(0,0,0),[(side*.55,.08,.45),(side*span,.10,.15),(side*(span+.13),-.04,-.42),(side*.8,-.12,-.68)],WHITE if angel else '#89694c',wing,thickness=.07)
            for i in range(10):
                t=i/9;x=side*(.4+t*(span-.4));z=.28-t*.32;length=.55+t*.48
                H.fan('Primary flight feather',(x,.02,z),[(x+side*.14,-.03,z-.25),(x+side*.17,-.04,z-length),(x-side*.03,-.05,z-length-.09),(x-side*.11,-.025,z-.20)],CREAM if angel else '#4f4336',wing,thickness=.035)
                if angel:beam('Gilt feather shaft',(x,.01,z-.08),(x+side*.04,-.03,z-length+.12),.012,GOLD,wing)
    tail=H.empty(id+'_tail',(0,-.08,-.7),body);tail['part']='tail'
    for i in range(5):
        x=(i-2)*.13;H.fan('Tail feather',(x,0,0),[(x-.11,0,-.7),(x,0,-1.0),(x+.11,0,-.7)],WHITE if angel else '#d3ba82',tail,thickness=.04)
    for side in [-1,1]:
        leg=H.empty(id+'_leg_'+str(side),(side*.24,-.32,.18),body);leg['part']='leg'
        beam('Folded talon',(0,0,0),(0,-.28,.12),.05,GOLD,leg)
        for i in [-1,0,1]:beam('Talon toe',(0,-.28,.12),(i*.08,-.33,.28),.025,GOLD,leg)
    export('critter_'+id,'creature',True)

def build():
    previous=bpy.context.window.scene
    scene=bpy.data.scenes.get('Wildtag Sky Kingdom') or bpy.data.scenes.new('Wildtag Sky Kingdom');bpy.context.window.scene=scene
    try:
        OUT.mkdir(parents=True,exist_ok=True);ART.mkdir(parents=True,exist_ok=True)
        for name in sorted(set(f['sector'] for f in DATA['floors'])):sector(name)
        for kind in ['lantern','planter','stall','bench','bookshelf','nest','spire','orrery','bell','chime','skyglass','anchor','launch_pad','drone_pad']:prop_asset(kind)
        critter('suncresteagle');critter('seraphlet',True)
        manifest_path=ROOT/'public/wildtag/asset-manifest.json';manifest=json.loads(manifest_path.read_text())
        manifest['skyKingdom']={'layoutSha256':hashlib.sha256((ROOT/'src/sky/layout-data.json').read_bytes()).hexdigest(),'source':'art/wildtag/sky/sky-kingdom.blend'}
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
        bpy.data.libraries.write(str(ART/'sky-kingdom.blend'),{scene},fake_user=True,compress=True)
        print('SKY KINGDOM COMPLETE: original Blender MCP models and matching world layout.')
    finally:bpy.context.window.scene=previous
build()
