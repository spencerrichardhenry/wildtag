"""Wildtag higher-fidelity library. Execute ONLY through Blender MCP.

The source references retain the game's silhouettes and local animation pivots.
Blender welds the old triangle soup, sculpts softer creature surfaces, bevels
hard surfaces, paints interpolated vertex colors, and exports the new meshes.
New resource/logistics models are built directly in Blender.
"""
import bpy, bmesh, math, json, random, sys, gzip
from pathlib import Path
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'public/wildtag/models'
ART=ROOT/'art/wildtag'
MANIFEST=ROOT/'public/wildtag/asset-manifest.json'
BASIS=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
REFERENCES=None
CURRENT=None

def setup():
    OUT.mkdir(parents=True,exist_ok=True)
    scene=bpy.data.scenes.get('Wildtag Atelier') or bpy.data.scenes.new('Wildtag Atelier')
    bpy.context.window.scene=scene
    scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.world=bpy.data.worlds.new('Wildtag Studio World') if not scene.world else scene.world
    scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.16,.22,.19,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.45
    return scene

def material(p):
    key='Wildtag_'+str((tuple(p['color']),tuple(p['emissive']),p['roughness'],p['opacity'],p['metalness'],bool(p.get('colors'))))
    m=bpy.data.materials.get(key)
    if m:return m
    m=bpy.data.materials.new(key);m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF'); shader.inputs['Base Color'].default_value=(*p['color'],1)
    if p.get('colors'):
        node=m.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Tint';m.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value=max(.2,min(.88,p['roughness']*.85));shader.inputs['Metallic'].default_value=p['metalness']
    shader.inputs['Alpha'].default_value=p['opacity'];shader.inputs['Emission Color'].default_value=(*p['emissive'],1)
    shader.inputs['Emission Strength'].default_value=.5
    return m

def apply(o,mod):
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name);o.select_set(False)

def collection(id):
    global CURRENT
    old=bpy.data.collections.get('WT_'+id)
    if old:
        for o in list(old.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(old)
    CURRENT=bpy.data.collections.new('WT_'+id);bpy.context.scene.collection.children.link(CURRENT)
    return CURRENT

def reference_asset(ref):
    id=ref['id'];collection(id)
    for i,p in enumerate(ref['parts']):
        v=p['positions'];verts=[(v[j],-v[j+2],v[j+1]) for j in range(0,len(v),3)]
        indices=p['indices'] or list(range(len(verts)));faces=[indices[j:j+3] for j in range(0,len(indices),3)]
        data=bpy.data.meshes.new(f'{id}_surface_{i}');data.from_pydata(verts,[],faces);data.update()
        o=bpy.data.objects.new(f'{id}_part_{i}',data);CURRENT.objects.link(o);data.materials.append(material(p))
        if p['colors']:
            attr=data.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT')
            for j,item in enumerate(attr.data):item.color=(*p['colors'][j*3:j*3+3],1)
            data.color_attributes.active_color=attr
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
        organic=ref['category'] in ('creature','character') and not any(k in id for k in ('prismhorse','gargoyle','cragdrake','shardwing'))
        if organic and len(data.polygons)>12:
            mod=o.modifiers.new('Sculpted silhouette refinement','SUBSURF');mod.levels=1;mod.render_levels=1;mod.subdivision_type='SIMPLE';apply(o,mod)
            smooth=o.modifiers.new('Gentle sculpt polish','SMOOTH');smooth.factor=.22;smooth.iterations=2;apply(o,smooth)
        else:
            # Angle-limited chamfers keep architectural planes and crystal facets crisp.
            dims=[max((v.co[k] for v in data.vertices),default=0)-min((v.co[k] for v in data.vertices),default=0) for k in range(3)]
            width=min(.045,max(.001,min(dims)*.055))
            mod=o.modifiers.new('Hand-finished edges','BEVEL');mod.width=width;mod.segments=1 if ref['category']=='architecture' else 2;mod.limit_method='ANGLE';mod.angle_limit=.45;apply(o,mod)
        # Architectural chamfers are visible at close range; limit repeated trim density.
        original_tris=len(faces)
        triangles=sum(len(poly.vertices)-2 for poly in data.polygons)
        budget=original_tris*(3 if ref['category']=='architecture' else 5)
        if triangles>budget:
            mod=o.modifiers.new('Game silhouette budget','DECIMATE');mod.ratio=budget/triangles;apply(o,mod)
        for face in data.polygons:face.use_smooth=organic
        # Painted surface variation is deterministic and survives export without texture files.
        attr=data.color_attributes.get('Tint')
        if attr:
            for j,c in enumerate(attr.data):
                co=data.vertices[j].co if j<len(data.vertices) else Vector((0,0,0))
                factor=.97+.03*math.sin(co.x*4.2+co.y*3.3+co.z*6.5)
                c.color=tuple(max(0,min(1,x*factor)) for x in c.color[:3])+(1,)
        # The local mesh remains in its animation frame; the .blend carries the design pose.
        matrix=Matrix([p['matrix'][j::4] for j in range(4)])
        o.matrix_world=BASIS@matrix@BASIS.inverted()
        o['source_part']=i;o['authoring']='Blender MCP'
    return export(id,ref['category'],sum(len(p['indices'] or p['positions'])//3 if p['indices'] else len(p['positions'])//9 for p in ref['parts']))

def export(id,category,source_triangles=0):
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in CURRENT.objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(CURRENT.objects))
    path=OUT/(id+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_yup=True,export_extras=True,export_animations=False)
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in CURRENT.objects if o.type=='MESH')
    entry={'id':id,'category':category,'triangles':triangles,'sourceTriangles':source_triangles,'bytes':path.stat().st_size,'parts':sum(o.type=='MESH' for o in CURRENT.objects),'authoring':'Blender MCP'}
    manifest=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'version':1,'assets':[]}
    manifest['assets']=[a for a in manifest['assets'] if a['id']!=id]+[entry]
    MANIFEST.write_text(json.dumps(manifest,indent=2))
    CURRENT.hide_render=True
    for o in CURRENT.objects:o.select_set(False);o.hide_set(True)
    print(json.dumps(entry),flush=True)
    return entry

# Original field engineering kit, using the repository's proven Blender geometry helpers.
def helpers():
    sys.path.insert(0,str(ROOT/'scripts/tiny-tide/blender'))
    import build_assets as H
    H.CURRENT=CURRENT
    return H

PALETTE={'wood':'#88ad6e','stone':'#9daead','fiber':'#cad587','resin':'#e8a848','shard':'#78cbd2','spark':'#b99be2'}
WOOD='#805939';EDGE='#c6a273';METAL='#476c67';CREAM='#ece3be';ROCK='#758d8d'

def plank(H,p,s,c=WOOD):return H.box('Carved timber',p,s,c,bevel=.035,kind='rock')
def beam(H,a,b,r=.055,c=METAL):return H.tube('Bound strut',[a,b],[r,r],c,sides=10,steps=1,kind='rock')
def stone(H,p,s,c=ROCK):return H.ellipsoid('Worn stone',p,s,c,seg=12,rings=8,kind='rock')
def custom_asset(id):
    collection(id);H=helpers();rng=random.Random(id)
    if id.startswith('deposit_'):
        kind=id.removeprefix('deposit_');c=PALETTE[kind]
        for i in range(12):
            a=i*math.tau/12;stone(H,(math.cos(a)*1.4,.12,math.sin(a)*1.3),(.35,.22,.32))
        if kind in ('wood','resin'):
            for x,z in [(-.65,-.3),(.7,.2),(0,.65)]:
                H.tube('Living trunk',[(x,0,z),(x+.12,1.3,z),(x-.05,2.7,z)], [.22,.17,.1],WOOD,sides=12)
                for j in range(4):stone(H,(x+math.sin(j*2.4)*.5,2.4+j*.25,z+math.cos(j*2.4)*.4),(.68,.55,.65),c if kind=='wood' else '#85a572')
                if kind=='resin':H.ellipsoid('Amber sap',(x,.8,z+.18),(.19,.34,.13),c,kind='glow')
            for i in range(3):plank(H,(-.8+i*.6,.22,1),(.5,.22,.75),EDGE)
        elif kind=='fiber':
            for i in range(18):
                x=rng.uniform(-1.1,1.1);z=rng.uniform(-1,1);h=rng.uniform(.7,1.5)
                beam(H,(x,.1,z),(x+.14,h,z),.025,'#71996a')
                H.ellipsoid('Flax flower',(x+.14,h,z),(.13,.12,.13),'#c6b9df',seg=12,rings=8)
                H.ellipsoid('Seed head',(x+.14,h-.25,z),(.09,.2,.09),c,seg=12,rings=8)
        else:
            for i in range(7):
                x=rng.uniform(-1,1);z=rng.uniform(-.8,.8)
                stone(H,(x,.4,z),(.65,.6,.65),ROCK)
                if kind!='stone':
                    H.tube('Mineral prism',[(x,.35,z),(x+.1,1.2+rng.random()*.7,z+.1)], [.26,.025],c,sides=6,steps=1,kind='glow')
    elif id.startswith('extractor_'):
        kind=id.removeprefix('extractor_');c=PALETTE[kind]
        for x in [-.8,.8]:
            for z in [-.65,.65]:stone(H,(x,.12,z),(.25,.18,.25));plank(H,(x,1,z),(.14,1.8,.14));beam(H,(x,.4,z),(x*.4,1.5,z))
        plank(H,(0,1.93,0),(2,.16,1.75),METAL)
        # Individually cut roof shingles, wide eaves and brass fasteners.
        for j in range(5):plank(H,(-.85+j*.42,2.07,0),(.39,.11,1.92),c)
        plank(H,(0,.22,0),(1.65,.18,1.4),EDGE)
        for j in range(4):plank(H,(-.5+j*.33,.6,.75),(.28,.65,.08),WOOD)
        for x in [-.68,.68]:plank(H,(x,.62,.35),(.08,.7,.88),WOOD)
        for i in range(3):stone(H,(-.35+i*.35,.6,.5),(.19,.18,.2),c)
        H.ellipsoid('Status lantern',(.85,1.55,.72),(.12,.2,.12),c,kind='glow')
        if kind in ('stone','shard','spark'):
            beam(H,(0,1.75,-.25),(0,.45,-.25),.13,METAL)
            for y in [.6,.85,1.1]:H.tube('Auger helix',[(-.18,y,-.25),(.15,y+.08,-.1),(.18,y+.16,-.25),(-.15,y+.24,-.4)],[.06]*4,EDGE,sides=8,steps=3)
        elif kind=='resin':H.ellipsoid('Collection barrel',(0,.7,-.25),(.4,.6,.4),EDGE)
        elif kind=='wood':plank(H,(0,.9,-.25),(1.2,.12,.6),EDGE);beam(H,(-.5,1.2,-.25),(.5,1.2,-.25),.08,METAL)
        else:
            for x in [-.35,0,.35]:beam(H,(x,.3,-.4),(x,1.4,-.4),.025,c)
    elif id=='creature_cart':
        for i in range(6):plank(H,(-.55+i*.22,.6,0),(.2,.1,1.35),EDGE)
        for x in [-.7,.7]:
            for y in [.8,1.03]:plank(H,(x,y,0),(.1,.16,1.55))
            beam(H,(x,.6,-.7),(x,1.15,-.7));beam(H,(x,.6,.7),(x,1.15,.7))
            # Curved tires, visible hub and eight spokes.
            for z in [-.45,.45]:
                center=(x*1.18,.37,z)
                pts=[(center[0],center[1]+math.sin(i*math.tau/32)*.34,center[2]+math.cos(i*math.tau/32)*.34) for i in range(33)]
                H.tube('Wheel rim',pts,[.055]*33,METAL,sides=8,steps=1)
                for j in range(8):beam(H,center,(center[0],center[1]+math.sin(j*math.tau/8)*.3,center[2]+math.cos(j*math.tau/8)*.3),.025,EDGE)
                stone(H,center,(.09,.09,.09),METAL)
        for x in [-.45,.45]:beam(H,(x,.6,.65),(x,.8,2.15),.045,WOOD)
        beam(H,(-.45,.8,2.15),(.45,.8,2.15),.035,CREAM)
    elif id=='cargo_bundle':
        for x,z in [(-.3,-.25),(.3,-.25),(0,.3)]:
            H.ellipsoid('Canvas sack',(x,.1,z),(.28,.35,.28),'#dacba3');H.tube('Tied cord',[(x-.15,.4,z),(x,.43,z+.06),(x+.15,.4,z)],[.025]*3,METAL,sides=6)
    elif id=='trail_marker':
        plank(H,(0,.35,0),(.1,.7,.1));plank(H,(0,.67,0),(.4,.13,.12),CREAM)
    elif id=='logistics_depot':
        plank(H,(0,.15,0),(4.5,.3,3),EDGE)
        for x in [-1.8,1.8]:
            for z in [-1,1]:plank(H,(x,1.5,z),(.22,2.7,.22));beam(H,(x,1.8,z),(x*.6,2.8,z),.08,EDGE)
        for i in range(10):plank(H,(-2+i*.45,2.95,0),(.43,.15,3.4), '#789784')
        plank(H,(0,2.4,1.1),(3.1,.5,.12),CREAM)
        for x in [-1.2,0,1.2]:
            plank(H,(x,.65,0),(.9,.9,.9));plank(H,(x,1.13,0),(1,.1,1),EDGE)
            for z in [-.47,.47]:beam(H,(x-.45,.3,z),(x+.45,1,z),.03,METAL)
        for x in [-1.85,1.85]:H.ellipsoid('Warm lantern',(x,2.2,1.05),(.16,.25,.16),'#e5bd75',kind='glow')
    else:raise ValueError(id)
    # One vertex-painted mesh per custom asset keeps the network inexpensive.
    objs=[o for o in CURRENT.objects if o.type=='MESH']
    for o in bpy.context.scene.objects:o.select_set(False)
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.join();bpy.context.object.name=id+'_part_0'
    return export(id,'logistics')

CUSTOM=['deposit_'+k for k in PALETTE]+['extractor_'+k for k in PALETTE]+['creature_cart','cargo_bundle','trail_marker','logistics_depot']
def build(start=0,end=None):
    global REFERENCES
    setup()
    if REFERENCES is None:
        raw=ART/'design-reference.json'
        REFERENCES=json.loads(raw.read_text() if raw.exists() else gzip.decompress((ART/'design-reference.json.gz').read_bytes()))
    jobs=[a['id'] for a in REFERENCES]+CUSTOM
    for id in jobs[start:end]:
        ref=next((a for a in REFERENCES if a['id']==id),None)
        reference_asset(ref) if ref else custom_asset(id)
    # Save just this scene's data, leaving the existing Tiny Tide studio untouched.
    bpy.data.libraries.write(str(ART/'wildtag-art.blend'),{bpy.context.scene},fake_user=True,compress=True)
    return {'assets':len(json.loads(MANIFEST.read_text())['assets']),'next':end,'total':len(jobs)}
