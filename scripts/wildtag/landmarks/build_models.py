"""Castle districts and Atlantis, authored/exported through Blender MCP.
Run layout.mjs first after changing the level design. Other Blender scenes are preserved.
"""
import bpy, math, json, random, importlib.util, hashlib
from mathutils import Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'public/wildtag/models';ART=ROOT/'art/wildtag/landmarks'
spec=importlib.util.spec_from_file_location('landmark_geometry_helpers',ROOT/'scripts/tiny-tide/blender/build_assets.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
CURRENT=None;PALETTE={};MATS={};ENTRIES=[]
ONLY=set(globals().get('LANDMARK_ONLY',[]))
PALETTES={
 'cursed':dict(stone='#625a72',light='#8a7c91',dark='#383346',trim='#a9865c',roof='#352c4e',wood='#5c4247',cloth='#873e67',glow='#eea862',leaf='#52635b',pearl='#c7a4ea'),
 'purified':dict(stone='#d8c8a8',light='#efe1c3',dark='#99876f',trim='#bf9652',roof='#627ead',wood='#91704a',cloth='#d9658d',glow='#ffe8ab',leaf='#679d68',pearl='#c1e6c8'),
 'atlantis':dict(stone='#67a6a9',light='#aad5ce',dark='#326d79',trim='#c5ac6a',roof='#397c87',wood='#506b69',cloth='#c59ab3',glow='#81f1df',leaf='#79c0a4',pearl='#edcbd7'),
}
def mat(kind='soft'):
    if kind in MATS:return MATS[kind]
    name='Landmarks_'+kind;m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');b=n.new('ShaderNodeBsdfPrincipled');v=n.new('ShaderNodeVertexColor');v.layer_name='Tint'
    m.node_tree.links.new(v.outputs['Color'],b.inputs['Base Color']);m.node_tree.links.new(b.outputs['BSDF'],out.inputs['Surface'])
    b.inputs['Roughness'].default_value={'soft':.68,'rock':.82,'eye':.27,'leaf':.73,'glow':.4}[kind]
    b.inputs['Metallic'].default_value=.42 if kind=='eye' else 0
    m.node_tree.links.new(v.outputs['Color'],b.inputs['Emission Color']);b.inputs['Emission Strength'].default_value=.75 if kind=='glow' else .07
    MATS[kind]=m;return m
H.mat=mat
def color(c):return PALETTE.get(c,c)
def box(n,p,s,c='stone',bevel=.06,parent=None):return H.box(n,p,s,color(c),parent,bevel=bevel,kind='rock')
def orb(n,p,s,c='stone',parent=None,kind='soft',seg=16,rings=10):return H.ellipsoid(n,p,s,color(c),parent,seg=seg,rings=rings,kind=kind)
def beam(n,a,b,r=.07,c='trim',parent=None):return H.tube(n,[a,b],[r,r],color(c),parent,sides=8,steps=1,kind='rock')
def ring(n,p,r,t,c='trim',vertical=False,parent=None):return H.torus(n,p,r,t,color(c),parent,tilt=(math.pi/2,0,0) if vertical else (0,0,0),segments=28,sides=6,kind='eye')
def tube(n,points,radii,c='stone',parent=None,sides=12,kind='rock'):return H.tube(n,points,radii,color(c),parent,sides=sides,steps=1,kind=kind)
def begin(id):
    global CURRENT
    old=bpy.data.collections.get('LANDMARK_'+id)
    if old:
        for o in list(old.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(old)
    CURRENT=bpy.data.collections.new('LANDMARK_'+id);bpy.context.scene.collection.children.link(CURRENT);H.CURRENT=CURRENT
def join(objects,name):
    if not objects:return
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in objects:o.select_set(True)
    owned=[o.data for o in objects]
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name=name;bpy.context.object.select_set(False)
    for data in owned:
        if data.users==0:bpy.data.meshes.remove(data)
def export(id,moving=False):
    if moving:
        for i,parent in enumerate(set(o.parent for o in CURRENT.objects if o.type=='MESH')):join([o for o in CURRENT.objects if o.type=='MESH' and o.parent==parent],id+'_part_'+str(i))
    else:join([o for o in CURRENT.objects if o.type=='MESH'],id+'_surface')
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in CURRENT.objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(CURRENT.objects));path=OUT/(id+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_extras=True,export_animations=False)
    tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in CURRENT.objects if o.type=='MESH')
    entry=dict(id=id,category='landmark',triangles=tris,sourceTriangles=0,bytes=path.stat().st_size,parts=sum(o.type=='MESH' for o in CURRENT.objects),authoring='Blender MCP');ENTRIES.append(entry)
    for o in CURRENT.objects:o.select_set(False);o.hide_set(True)
    print(json.dumps(entry),flush=True)
def arch(a,atlantis=False):
    parent=H.empty('Carved arch',(a['x'],a['y'],a['z']));parent.rotation_euler.z=a['yaw'];w=a['w'];h=a['h']
    for side in [-1,1]:
        box('Fluted pier',(side*w/2,h*.30,0),(.65,h*.6,.7),'light',parent=parent)
        for y in [.16,h*.56]:box('Arch capital',(side*w/2,y,0),(1,.22,.95),'trim',parent=parent)
    pts=[]
    for i in range(25):
        t=i/24;x=-w/2+w*t;y=h*.6+h*.4*(math.sin(t*math.pi) if atlantis else 1-abs(2*t-1)**.75)
        pts.append((x,y,0))
    H.tube('Cut stone arch',pts,[.32]*len(pts),color('light'),parent,sides=8,steps=1,kind='rock')
    for i in [4,8,12,16,20]:orb('Arch keystone',(pts[i][0],pts[i][1],.37),(.16,.21,.08),'trim',parent)
def rectangles(f,earlier):
    parts=[(f['x']-f['w']/2,f['z']-f['d']/2,f['x']+f['w']/2,f['z']+f['d']/2)]
    for old in earlier:
        if old['rise'] or old['y']!=f['y']:continue
        c,d,e,g=old['x']-old['w']/2,old['z']-old['d']/2,old['x']+old['w']/2,old['z']+old['d']/2;out=[]
        for a,b,h,j in parts:
            l,r,t,u=max(a,c),min(h,e),max(b,d),min(j,g)
            if l>=r or t>=u:out.append((a,b,h,j));continue
            for rect in [(a,b,l,j),(r,b,h,j),(l,b,r,t),(l,u,r,j)]:
                if rect[2]-rect[0]>.001 and rect[3]-rect[1]>.001:out.append(rect)
        parts=out
    return parts

def subtract_solids(solid, cutters):
    """Partition a masonry solid around existing slabs/walls, with no shared volume.

    Roofs own their complete top surface. Supporting masonry terminates at the
    slab underside, including partial roof coverage and intersecting wall caps.
    This is authored geometry, not a depth bias or a runtime material workaround.
    """
    parts=[solid]
    for cut in cutters:
        remaining=[]
        for lo,hi in parts:
            a=[max(lo[i],cut[0][i]) for i in range(3)]
            b=[min(hi[i],cut[1][i]) for i in range(3)]
            if any(b[i]-a[i]<.0001 for i in range(3)):
                remaining.append((lo,hi));continue
            core_lo=list(lo);core_hi=list(hi)
            for axis in range(3):
                if a[axis]-core_lo[axis]>.0001:
                    end=core_hi.copy();end[axis]=a[axis];remaining.append((core_lo.copy(),end))
                    core_lo[axis]=a[axis]
                if core_hi[axis]-b[axis]>.0001:
                    start=core_lo.copy();start[axis]=b[axis];remaining.append((start,core_hi.copy()))
                    core_hi[axis]=b[axis]
        parts=remaining
    return parts

def wall_solid(w):
    return ([w['x']-w['w']/2,w['y'],w['z']-w['d']/2],
            [w['x']+w['w']/2,w['y']+w['h'],w['z']+w['d']/2])

def district(data,sector,variant):
    id=data['id']+'_district_'+sector+variant;begin(id);rng=random.Random(id);sea=data['id']=='atlantis';earlier=[]
    for f in data['floors']:
        if f['sector']!=sector:earlier.append(f);continue
        x,z,w,d,y=f['x'],f['z'],f['w'],f['d'],f['y']
        if f['rise']:
            def top(a,b):
                t=(a-x)/w+.5 if f['axis']=='x' else .5-(a-x)/w if f['axis']=='-x' else (b-z)/d+.5 if f['axis']=='-z' else .5-(b-z)/d
                return y+f['rise']*t
            v=[(a,top(a,b)+dy,b) for dy in [-f['thickness'],0] for a,b in [(x-w/2,z-d/2),(x+w/2,z-d/2),(x+w/2,z+d/2),(x-w/2,z+d/2)]]
            H.mesh('Continuous stair ramp',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],color('stone'),kind='rock',smooth=False)
            on_x=f['axis'] in ['x','-x'];n=max(8,math.ceil((w if on_x else d)/.65))
            for i in range(n):
                t=(i+.5)/n;a=x+(t-.5)*w if on_x else x;b=z if on_x else z+(t-.5)*d
                box('Worn stair nosing',(a,top(a,b)+.017,b),(.075,.035,d-.2) if on_x else (w-.2,.035,.075),'light',bevel=.01)
        else:
            for a,b,h,j in rectangles(f,earlier):
                c='dark' if 'roof' in f['id'] else 'stone';box('Dressed stone paving',((a+h)/2,y-f['thickness']/2,(b+j)/2),(h-a,f['thickness'],j-b),c,bevel=0 if 'ward-paving' in f['id'] else .025)
                if 'roof' not in f['id']:
                    # Fine joints and corner insets are actual painted geometry.
                    for xx in range(math.ceil(a/4)*4,math.floor(h/4)*4+1,4):box('Pavement joint',(xx,y+.009,(b+j)/2),(.026,.017,j-b),'dark',bevel=0)
                    for zz in range(math.ceil(b/4)*4,math.floor(j/4)*4+1,4):box('Pavement joint',((a+h)/2,y+.009,zz),(h-a,.017,.026),'dark',bevel=0)
        earlier.append(f)
    slabs=[([f['x']-f['w']/2,f['y']-f['thickness'],f['z']-f['d']/2],
            [f['x']+f['w']/2,f['y'],f['z']+f['d']/2]) for f in data['floors'] if not f['rise']]
    preceding_walls=[]
    for wall in data['walls']:
        if wall['style']=='hidden':continue
        solid=wall_solid(wall)
        # Only a shared cap plane can fight the slab. Ground paving and lower
        # interior floors need no cuts through a taller wall: those would add
        # hundreds of hidden beveled fragments for no visible benefit.
        cutters=[s for s in slabs if abs(s[1][1]-solid[1][1])<.0001]+preceding_walls
        preceding_walls.append(solid)
        if wall['sector']!=sector or wall['style']=='hidden':continue
        x,z,w,d,y,h=wall['x'],wall['z'],wall['w'],wall['d'],wall['y'],wall['h'];style=wall['style']
        for lo,hi in subtract_solids(solid,cutters):
            box('Fitted masonry wall',tuple((a+b)/2 for a,b in zip(lo,hi)),tuple(b-a for a,b in zip(lo,hi)),'stone',bevel=.045)
        if style=='crenel':
            n=math.floor(max(w,d)/3)
            for i in range(n):
                t=(i+.5)/n-.5;box('Battlement merlon',(x+t*w if w>d else x,y+h+.35,z if w>d else z+t*d),(1.1,.7,.6) if w>d else (.6,.7,1.1),'light')
        elif h>3:
            for yy in [y+.18,y+h*.48,y+h-.14]:box('Stone string course',(x,yy,z),(w+.05,.15,d+.05),'dark' if yy<y+h*.7 else 'trim',bevel=.015)
            length=max(w,d)
            for i in range(int(length/5)):
                off=-length/2+2.5+i*5
                if w>d:
                    for side in [-1,1]:box('Wall face ashlar',(x+off,y+h*.27,z+side*(d/2+.018)),(1.65,h*.30,.045),'light',bevel=.01)
                else:
                    for side in [-1,1]:box('Wall face ashlar',(x+side*(w/2+.018),y+h*.27,z+off),(.045,h*.30,1.65),'light',bevel=.01)
    for a in data['arches']:
        if a['sector']==sector:arch(a,sea)
    for t in data['towers']:
        if t['sector']!=sector:continue
        x,z,y,r,h=t['x'],t['z'],t['y'],t['r'],t['h']
        tube('Fluted bastion',[(x,y,z),(x,y+h*.8,z),(x,y+h,z)],[r,r*.96,r],sides=12)
        for yy in [y+.3,y+h*.3,y+h*.63,y+h-.3]:ring('Bastion collar',(x,yy,z),r,.17,'trim')
        for i in range(8):
            a=i*math.tau/8;box('Tower crown',(x+math.cos(a)*r*.86,y+h+.65,z+math.sin(a)*r*.86),(1.25,1.3,1.25),'light')
        if t.get('spire'):
            tube('Hunting pinnacle',[(x,y+h-3,z),(x,y+h,z)],[r*.8,.12],'roof');orb('Perch crest',(x,y+h+.1,z),(.25,.25,.25),'trim')
        else:
            for a in [0,math.pi/2,math.pi,math.pi*1.5]:orb('Tower embrasure',(x+math.cos(a)*r*.97,y+h*.64,z+math.sin(a)*r*.97),(.45,1.8,.45),'dark')
    export(id)

def castle_prop(kind,variant):
    id='castle_detail_'+kind+variant;begin(id)
    if kind=='brazier':
        tube('Brazier foot',[(0,0,0),(0,.25,0),(0,1.8,0)],[.65,.4,.16],'dark');tube('Hammered fire cup',[(0,1.6,0),(0,2,0)],[.25,.65],'trim');ring('Fire rim',(0,2,0),.63,.08)
        for i in range(5):orb('Ember flame',(math.sin(i*2.4)*.25,2.2+(i%2)*.13,math.cos(i*2.4)*.25),(.16,.45,.16),'glow',kind='glow')
    elif kind=='banner':
        tube('Banner base',[(0,0,0),(0,.25,0)],[.46,.34],'dark');beam('Banner mast',(0,.1,0),(0,4.5,0),.09);orb('Banner finial',(0,4.7,0),(.2,.3,.2),'trim')
        beam('Banner arm',(-.85,4,0),(.85,4,0),.06);verts=[]
        for row in range(9):
            for col in range(5):
                x=(col/4-.5)*1.6;yy=4-row/8*2.9+(abs(x)*.32 if row==8 else 0);verts.append((x,yy,math.sin(row*.65+col*.4)*.13))
        faces=[]
        for row in range(8):
            for col in range(4):a=row*5+col;faces.append((a,a+1,a+6,a+5))
        H.mesh('Woven banner',verts,faces,color('cloth'),kind='soft',smooth=True)
        ring('Warden emblem',(0,2.75,.18),.35,.05,'trim',True)
    elif kind in ['shelf','bench']:
        if kind=='shelf':
            for x in [-1.5,1.5]:box('Carved bookcase post',(x,1.6,0),(.22,3.2,.8),'wood')
            for y in [.2,1.1,2,2.9]:
                box('Library shelf',(0,y,0),(3.2,.14,.85),'wood')
                if y<2.8:
                    for i in range(10):box('Leather-bound volume',(-1.28+i*.28,y+.4,.06),(.19,.64+(i%3)*.035,.55),['roof','cloth','trim','dark'][i%4],bevel=.025)
            box('Bookcase pediment',(0,3.27,0),(3.5,.2,.95),'trim')
        else:
            for x in [-1.1,1.1]:box('Bench carved foot',(x,.4,0),(.24,.8,.9),'dark')
            box('Bench seat',(0,.85,0),(2.8,.17,.85),'wood');box('Bench back',(0,1.4,-.4),(2.8,.8,.14),'wood')
    elif kind in ['war_table','reading_table']:
        for x in [-1.1,1.1]:
            for z in [-.65,.65]:beam('Table leg',(x,0,z),(x,1.2,z),.1,'wood')
        box('Heavy tabletop',(0,1.2,0),(3,.22,2),'wood');box('Parchment map',(0,1.325,0),(1.8,.025,1.4),'light',bevel=.01)
        for i in range(6):box('Map inlay',(-.6+i*.23,1.345,.1),(.035,.02,.8),'dark',bevel=0)
        for x in [-.8,.8]:tube('Rolled vellum',[(x,1.4,-.7),(x,1.4,.7)],[.11,.11],'light',sides=10)
        if kind=='war_table':
            for x,z in [(-.3,.2),(.45,-.3)]:beam('Strategy pin',(x,1.34,z),(x,1.9,z),.025);box('Tiny standard',(x+.12,1.8,z),(.24,.18,.025),'cloth',bevel=0)
    elif kind=='barrels':
        for x,z in [(-.6,0),(.6,.25)]:
            tube('Coopered cask',[(x,0,z),(x,.25,z),(x,.75,z),(x,1.2,z)],[.4,.52,.52,.4],'wood',sides=14)
            for y in [.18,1.05]:ring('Barrel hoop',(x,y,z),.47,.045,'dark')
        box('Supply crate',(0,.5,1.2),(1.2,1,1),'wood');beam('Crate brace',(-.5,.1,1.72),(.5,.9,1.72),.045,'trim')
    elif kind=='forge':
        for x in [-1.5,1.5]:box('Hearth jamb',(x,1.25,0),(.7,2.5,2.2),'dark')
        box('Hearth lintel',(0,2.4,0),(3.7,.45,2.2),'stone');box('Forge chimney',(0,4.2,-.6),(2.6,3.2,1.25),'stone')
        box('Coal bed',(0,.3,.2),(2.4,.55,1.65),'dark')
        for i in range(9):orb('Live coals',((i%3-1)*.6,.64,(i//3-1)*.45),(.25,.13,.2),'glow',kind='glow')
        box('Anvil base',(2.8,.35,1),(.8,.7,.8),'wood');box('Anvil face',(2.8,1.1,1),(1.7,.32,.7),'dark');tube('Anvil horn',[(3.4,1.1,1),(4.1,1.1,1)],[.25,.015],'trim')
    elif kind in ['throne','memorial']:
        box('Ceremonial plinth',(0,.2,0),(2.5,.4,2.3),'dark')
        if kind=='throne':
            box('Throne seat',(0,1,0),(1.7,.3,1.6),'cloth');box('High carved back',(0,2,-.7),(1.9,2.8,.4),'wood')
            for x in [-1,1]:box('Throne arm',(x,1.25,0),(.28,.9,1.6),'wood');orb('Lion arm finial',(x,1.8,.65),(.26,.3,.28),'trim')
            for x,y in [(-.7,3.4),(0,3.8),(.7,3.4)]:tube('Throne crown',[(x,3,-.7),(x,y,-.7)],[.14,.035],'trim')
        else:
            box('Memorial pedestal',(0,1,0),(1.25,1.3,1.2),'stone');orb('Stone bird',(0,2.1,0),(.45,.7,.4),'light');orb('Stone head',(0,2.85,.1),(.32,.35,.35),'light')
            for side in [-1,1]:H.fan('Memorial wing',(side*.2,2.5,0),[(side*1.6,3.0,0),(side*1.1,2.1,0),(side*.5,1.8,0)],color('light'),thickness=.14)
    elif kind=='planter':
        tube('Cloister urn',[(0,0,0),(0,.3,0),(0,1,0)],[.5,.85,.72],'dark');ring('Urn rim',(0,1,0),.75,.1)
        for i in range(9):
            a=i*2.4;x=math.sin(a)*.6;z=math.cos(a)*.6;beam('Ivy stem',(0,.9,0),(x,1.8+(i%3)*.2,z),.03,'leaf');orb('Cloister foliage',(x,1.8+(i%3)*.2,z),(.3,.35,.25),'leaf')
    elif kind=='market_stall':
        box('Provisioners counter',(0,.85,.65),(3.7,1.7,.6),'wood');box('Stone stall foot',(0,.15,0),(4.2,.3,2.6),'dark')
        for x in [-1.8,1.8]:
            for z in [-1,1]:beam('Canopy post',(x,0,z),(x,3.2,z),.09,'wood')
        for i in range(7):box('Striped awning',(-1.8+i*.6,3.2,0),(.58,.12,2.8),'cloth' if i%2 else 'light')
        for x in [-1.2,-.5,.4,1.2]:orb('Market provision',(x,1.95,.65),(.27,.28,.23),'pearl')
    elif kind=='chandelier':
        ring('Hanging lamp hoop',(0,0,0),1.5,.10);ring('Inner lamp hoop',(0,.4,0),.7,.08)
        for i in range(8):
            a=i*math.tau/8;x=math.cos(a)*1.5;z=math.sin(a)*1.5;beam('Lamp chain',(0,1.5,0),(x,.1,z),.025);orb('Candle flame',(x,.32,z),(.10,.27,.10),'glow',kind='glow')
    elif kind=='relic':relic_model()
    export(id)
def relic_model():
    tube('Archive lectern foot',[(0,0,0),(0,.2,0),(0,1.15,0)],[.7,.55,.16],'dark');box('Record stand',(0,1.23,0),(1.35,.16,1.1),'trim')
    box('Ancient record',(0,1.34,0),(1.05,.10,.85),'light',bevel=.025)
    for i in range(5):box('Inscribed line',(0,1.40,-.28+i*.14),(.7-(i%2)*.2,.015,.026),'dark',bevel=0)
    ring('Record seal',(.33,1.43,.22),.17,.035,'trim');orb('Seal jewel',(.33,1.47,.22),(.09,.06,.09),'glow',kind='glow')
def atlantis_prop(kind):
    id='atlantis_detail_'+kind;begin(id)
    if kind=='reef_lantern':
        tube('Reef lamp column',[(0,0,0),(0,.2,0),(0,2.8,0)],[.5,.35,.18],'dark');ring('Lamp crown',(0,2.8,0),.48,.08);orb('Luminous pearl',(0,2.5,0),(.3,.48,.3),'glow',kind='glow')
    elif kind=='amphora':
        tube('Ancient amphora',[(0,0,0),(0,.2,0),(0,.7,0),(0,1.2,0),(0,1.45,0)],[.24,.46,.56,.23,.26],'light',sides=20)
        for x in [-.38,.38]:ring('Amphora handle',(x,1,0),.32,.065,'trim',True)
        for y,r in [(.25,.49),(1.38,.26)]:ring('Amphora engraving',(0,y,0),r,.025)
    elif kind in ['coral_planter','coral_spire']:
        if kind=='coral_spire':
            tube('Reclaimed column',[(0,0,0),(0,.35,0),(0,6.6,0),(0,7,0)],[.9,.7,.55,.85],'stone',sides=12)
            for y in [.5,3.5,6.6]:ring('Column collar',(0,y,0),.7,.1)
            base=6.6;scale=.7
        else:
            tube('Coral basin',[(0,0,0),(0,.25,0),(0,.6,0)],[1.4,1.4,1.15],'dark',sides=16);base=.5;scale=1
        for i in range(12):
            a=i*2.4;xx=math.cos(a)*scale;zz=math.sin(a)*scale;cc=['#e798b5','#f0b778','#a998d5','#8bc4ad'][i%4]
            pts=[(xx*.3,base,zz*.3),(xx*.6,base+1*scale,zz*.6),(xx,base+(1.7+i%3*.25)*scale,zz)]
            H.tube('Branching coral',pts,[.13,.09,.035],cc,sides=8,steps=3,kind='soft')
            for side in [-1,1]:H.tube('Coral fingers',[pts[1],(xx+side*.4,base+1.2*scale,zz),(xx+side*.5,base+1.8*scale,zz+.12)],[.08,.05,.018],cc,sides=6,steps=2,kind='soft')
    elif kind=='shell_stall':
        for x in [-1.6,1.6]:beam('Shell shop pier',(x,0,0),(x,3.4,0),.16,'light')
        box('Shell merchant table',(0,1.2,.6),(3.8,.28,1.2),'trim')
        for i in range(8):
            a=math.pi*i/7;x=math.cos(a)*2;y=3+math.sin(a)*1.5
            beam('Scalloped shop canopy',(0,3,-.4),(x,y,-.4),.12,'pearl')
        for x in [-1.1,0,1.1]:orb('Traded pearl',(x,1.65,.6),(.28,.29,.28),'pearl',kind='eye')
    elif kind=='tablet_shelf':
        for x in [-1.7,1.7]:box('Archive jamb',(x,1.65,0),(.3,3.3,.9),'dark')
        for y in [.2,1.35,2.5]:
            box('Stone archive shelf',(0,y,0),(3.6,.2,1),'trim')
            for i in range(7):
                x=-1.4+i*.45;box('Engraved tablet',(x,y+.53,0),(.32,.85,.55),'light')
                for yy in [.35,.55,.73]:box('Tablet glyph',(x,y+yy,.285),(.20,.026,.016),'dark',bevel=0)
    elif kind in ['chart_table','tidal_throne']:
        if kind=='chart_table':
            box('Chart pedestal',(0,.65,0),(1,1.3,1),'dark');box('Stone map table',(0,1.4,0),(3.2,.24,2.2),'trim')
            for r in [.4,.8]:ring('Etched tide circles',(0,1.53,0),r,.025,'glow')
        else:
            box('Royal dais',(0,.2,0),(3.1,.4,2.7),'dark');box('Pearl throne seat',(0,1,0),(1.9,.3,1.8),'pearl')
            for i in range(7):
                x=(i-3)*.32;tube('Shell throne ribs',[(x,.5,-.8),(x,2.1,-.8),(x*1.6,3.7-abs(x)*.6,-.8)],[.13,.13,.04],'light')
            for x in [-1,1]:orb('Seahorse arm',(x,1.65,.4),(.23,.65,.23),'trim')
    elif kind=='astrolabe':
        tube('Astronomer plinth',[(0,0,0),(0,.35,0),(0,1.2,0)],[1,.8,.35],'dark',sides=16)
        for r in [.8,1.3,1.8]:ring('Tidal orbit',(0,2.1,0),r,.055,'trim',r==1.3)
        orb('Captured starlight',(0,2.1,0),(.35,.35,.35),'glow',kind='glow')
        for a in [0,2,4]:orb('Moon marker',(math.cos(a)*1.8,2.1,math.sin(a)*1.8),(.17,.17,.17),'pearl',kind='eye')
    elif kind=='pearl_cache':
        box('Ancient coffer',(0,.6,0),(2.4,1.2,1.5),'dark');box('Coffer rim',(0,1.22,0),(2.6,.16,1.65),'trim')
        for i in range(9):orb('Coffer pearls',((i%3-1)*.62,1.35+(i%2)*.12,(i//3-1)*.36),(.28,.29,.28),'pearl',kind='eye')
        for x in [-1,1]:box('Coffer binding',(x,.6,.78),(.12,1.2,.05),'trim')
    elif kind=='tide_engine':
        for x in [-1.7,1.7]:box('Tidewheel upright',(x,1.8,0),(.4,3.6,.8),'dark')
        box('Engine plinth',(0,.2,0),(4.3,.4,2.2),'stone')
        rotor=H.empty('Tidewheel rotor',(0,2.5,0));rotor['part']='tideRotor'
        ring('Tidewheel',(0,0,0),1.6,.16,'trim',True,rotor);orb('Wheel hub',(0,0,0),(.28,.28,.25),'glow',rotor,kind='glow')
        for i in range(12):
            a=i*math.tau/12;beam('Tidewheel spoke',(0,0,0),(math.cos(a)*1.6,math.sin(a)*1.6,0),.065,'trim',rotor)
            box('Tidewheel tooth',(math.cos(a)*1.7,math.sin(a)*1.7,0),(.22,.22,.24),'light',parent=rotor)
    elif kind=='airbell':
        # Open-bottom diving bell, with a visible pearl/bubble refuge below its rim.
        verts=[];faces=[];n=32;rows=10
        for j in range(rows+1):
            a=j/rows*math.pi/2;r=2.6*math.sin(a);y=1.2+.9*math.cos(a)
            for i in range(n):verts.append((math.cos(i*math.tau/n)*r,y,math.sin(i*math.tau/n)*r))
        for j in range(rows):
            for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
        H.mesh('Open brass airbell',verts,faces,color('trim'),kind='eye',smooth=True);ring('Airbell rim',(0,1.2,0),2.6,.12)
        ring('Refuge halo',(0,-1.5,0),2.2,.055,'glow')
        for i in range(8):
            a=i*math.tau/8;orb('Air stream',(math.cos(a)*1.8,-1+(i%3)*.45,math.sin(a)*1.8),(.06,.09,.06),'glow',kind='glow')
        pearl=H.empty('Refuge pearl',(0,1,0));pearl['part']='bellPearl';orb('Breathing pearl',(0,0,0),(.35,.35,.35),'glow',pearl,kind='glow')
    elif kind=='relic':relic_model()
    export(id,moving=kind in ['airbell','tide_engine'])

def shadow_model(data):
    """A Blender-authored shadow silhouette; the beauty meshes stay untouched."""
    id=data['id']+'_shadow';begin(id)
    for f in data['floors']:
        if f['rise']:
            def top(a,b):
                t=(a-f['x'])/f['w']+.5 if f['axis']=='x' else .5-(a-f['x'])/f['w'] if f['axis']=='-x' else (b-f['z'])/f['d']+.5 if f['axis']=='-z' else .5-(b-f['z'])/f['d']
                return f['y']+f['rise']*t
            v=[(x,top(x,z)+dy,z) for dy in [-f['thickness'],0] for x,z in [(f['x']-f['w']/2,f['z']-f['d']/2),(f['x']+f['w']/2,f['z']-f['d']/2),(f['x']+f['w']/2,f['z']+f['d']/2),(f['x']-f['w']/2,f['z']+f['d']/2)]]
            H.mesh('Shadow stair',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],color('stone'),kind='rock',smooth=False);continue
        if f['y']<.2:continue
        box('Shadow deck',(f['x'],f['y']-f['thickness']/2,f['z']),(f['w'],f['thickness'],f['d']),bevel=0)
    for w in data['walls']:
        if w['style']=='hidden':continue
        box('Shadow masonry',(w['x'],w['y']+w['h']/2,w['z']),(w['w'],w['h'],w['d']),bevel=0)
        if w['style']=='crenel':
            n=math.floor(max(w['w'],w['d'])/3)
            for i in range(n):
                t=(i+.5)/n-.5;wide=w['w']>w['d'];box('Shadow merlon',(w['x']+t*w['w'] if wide else w['x'],w['y']+w['h']+.35,w['z'] if wide else w['z']+t*w['d']),(1.1,.7,.6) if wide else (.6,.7,1.1),bevel=0)
    for a in data['arches']:
        # The high arch remains curved; small carved keystones need no separate shadow.
        parent=H.empty('Shadow arch',(a['x'],a['y'],a['z']));parent.rotation_euler.z=a['yaw']
        for side in [-1,1]:box('Shadow pier',(side*a['w']/2,a['h']*.3,0),(.65,a['h']*.6,.7),parent=parent,bevel=0)
        pts=[]
        for i in range(17):
            t=i/16;pts.append((-a['w']/2+a['w']*t,a['h']*.6+a['h']*.4*(math.sin(t*math.pi) if data['id']=='atlantis' else 1-abs(2*t-1)**.75),0))
        tube('Shadow vault',pts,[.32]*17,parent=parent,sides=6)
    for t in data['towers']:
        tube('Shadow bastion',[(t['x'],t['y'],t['z']),(t['x'],t['y']+t['h'],t['z'])],[t['r'],t['r']],sides=12)
        for i in range(8):
            a=i*math.tau/8;box('Shadow tower crown',(t['x']+math.cos(a)*t['r']*.86,t['y']+t['h']+.65,t['z']+math.sin(a)*t['r']*.86),(1.25,1.3,1.25),bevel=0)
    bpy.context.view_layer.update()
    for p in data['props']:
        suffix='_cursed' if data['id']=='castle' else '';collection=bpy.data.collections.get('LANDMARK_'+data['id']+'_detail_'+p['kind']+suffix)
        if not collection:continue
        transform=Matrix.Translation((p['x'],-p['z'],p['y']))@Matrix.Rotation(p['yaw'],4,'Z')@Matrix.Diagonal((p['s'],p['s'],p['s'],1))
        for original in collection.objects:
            if original.type!='MESH':continue
            parent=original.parent;moving=False
            while parent:
                if parent.get('part'):moving=True
                parent=parent.parent
            if moving:continue
            copy=original.copy();copy.data=original.data.copy();copy.parent=None;CURRENT.objects.link(copy);copy.matrix_world=transform@original.matrix_world;copy.hide_set(False)
            if len(copy.data.polygons)>100:
                dec=copy.modifiers.new('Shadow silhouette','DECIMATE');dec.ratio=.12;H.apply_mod(copy,dec)
            copy.data.materials.clear();copy.data.materials.append(mat('rock'))
            for face in copy.data.polygons:face.material_index=0
    export(id)

def build():
    global PALETTE
    previous=bpy.context.window.scene;name='Wildtag Castle and Atlantis';scene=bpy.data.scenes.get(name) or bpy.data.scenes.new(name);bpy.context.window.scene=scene
    OUT.mkdir(parents=True,exist_ok=True);ART.mkdir(parents=True,exist_ok=True)
    try:
        for place in ['castle','atlantis']:
            data=json.loads((ROOT/'src/landmarks'/f'{place}.json').read_text())
            for variant in (['_cursed','_purified'] if place=='castle' else ['']):
                PALETTE=PALETTES[variant[1:] if variant else 'atlantis']
                sectors=sorted(set([f['sector'] for f in data['floors']]+[w['sector'] for w in data['walls']]+[t['sector'] for t in data['towers']]))
                for s in sectors:
                    if not ONLY or place+'_district_'+s+variant in ONLY:district(data,s,variant)
                for kind in sorted(set(p['kind'] for p in data['props'])):
                    if ONLY and place+'_detail_'+kind+variant not in ONLY:continue
                    if place=='castle':castle_prop(kind,variant)
                    else:atlantis_prop(kind)
            if not ONLY or place+'_shadow' in ONLY:shadow_model(data)
        path=ROOT/'public/wildtag/asset-manifest.json';manifest=json.loads(path.read_text());ids={e['id'] for e in ENTRIES};manifest['assets']=[a for a in manifest['assets'] if a['id'] not in ids]+ENTRIES
        for a in manifest['assets']:
            if a['id'] in ['castle_cursed','castle_purified','atlantis']:a['load']=False
        manifest['landmarks']={place:dict(layoutSha256=hashlib.sha256((ROOT/'src/landmarks'/f'{place}.json').read_bytes()).hexdigest(),source='art/wildtag/landmarks/castle-and-atlantis.blend') for place in ['castle','atlantis']}
        path.write_text(json.dumps(manifest,indent=2)+'\n');bpy.data.libraries.write(str(ART/'castle-and-atlantis.blend'),{scene},fake_user=True,compress=True)
        print('LANDMARKS COMPLETE',len(ENTRIES),'assets',sum(e['triangles'] for e in ENTRIES),'triangles',sum(e['bytes'] for e in ENTRIES),'bytes')
    finally:bpy.context.window.scene=previous
build()
