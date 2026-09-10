"""Original miniature world scenes, authored through Blender MCP."""
import bpy, math, json, hashlib, importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('curiosity_helpers',ROOT/'scripts/tiny-tide/blender/build_assets.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
DATA=json.loads((ROOT/'src/discoveries/data.json').read_text())
OUT=ROOT/'public/wildtag/models';ART=ROOT/'art/wildtag/discoveries'
ONLY=set(globals().get('DISCOVERY_ONLY',[]));ENTRIES=[];MATS={};P={};CURRENT=None
PALETTES={
 'meadow':['#99714d','#eadab1','#718c5b','#d98175','#e7c76d'],
 'forest':['#694a39','#cfa875','#4e8267','#b98ba8','#b6efd0'],
 'wetland':['#606951','#dbc898','#729b87','#b5a4cd','#e8d08a'],
 'crags':['#8c7865','#d7c2a0','#74899d','#74b6d3','#f3cb7c'],
 'highlands':['#77808a','#dcd4bf','#658d8a','#8babc6','#f8dc9a'],
 'coast':['#927958','#e7dac0','#6ea9a5','#d99987','#fae6ac'],
 'castle':['#655e71','#d4c4ac','#779080','#aa83ad','#eccb88'],
 'atlantis':['#467d84','#b2d4c9','#69b4a6','#d8a5b7','#97f2e3'],
 'sky':['#99b5ba','#f1e4c9','#9dc0af','#a39dcd','#e9cd81'],
}
def mat(kind='rock'):
 if kind in MATS:return MATS[kind]
 m=bpy.data.materials.get('Discoveries_'+kind) or bpy.data.materials.new('Discoveries_'+kind);m.use_nodes=True
 n=m.node_tree.nodes;n.clear();v=n.new('ShaderNodeVertexColor');v.layer_name='Tint';p=n.new('ShaderNodeBsdfPrincipled');o=n.new('ShaderNodeOutputMaterial')
 m.node_tree.links.new(v.outputs['Color'],p.inputs['Base Color']);m.node_tree.links.new(p.outputs['BSDF'],o.inputs['Surface'])
 p.inputs['Roughness'].default_value=.38 if kind=='glow' else .48 if kind=='eye' else .82
 p.inputs['Metallic'].default_value=.45 if kind=='eye' else 0
 if kind=='glow':m.node_tree.links.new(v.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=1.2
 MATS[kind]=m;return m
H.mat=mat
def color(c):return P.get(c,c)
def box(n,p,s,c='base',parent=None,bevel=.04):
 return H.box(n,p,s,color(c),parent,bevel=bevel,kind='rock')
def pitched_box(n,p,s,angle,c='accent'):
 # Mesh vertices carry their position. Rotate around the piece's own center,
 # never around the scene origin (Blender Y is negative game Z).
 o=box(n,(0,0,0),s,c);o.location=H.V(p);o.rotation_euler.y=angle;return o
def orb(n,p,s,c='light',parent=None,kind='soft',seg=12,rings=7):
 return H.ellipsoid(n,p,s,color(c),parent,seg=seg,rings=rings,kind=kind)
def tube(n,p,r,c='base',parent=None,sides=10):return H.tube(n,p,r,color(c),parent,sides=sides,steps=1,kind='rock')
def beam(n,a,b,r=.065,c='gold',parent=None):return tube(n,[a,b],[r,r],c,parent,8)
def ring(n,p,r,t=.05,c='gold',parent=None,vertical=False):return H.torus(n,p,r,t,color(c),parent,segments=20,sides=6,tilt=(math.pi/2,0,0) if vertical else (0,0,0),kind='eye')
def moving(kind,p=(0,0,0),parent=None,phase=0,speed=1,amplitude=.15):
 o=H.empty('Moving '+kind,p,parent);o['curioMotion']=kind;o['phase']=phase;o['speed']=speed;o['amplitude']=amplitude;return o
def stone(p,s=(1,.5,.8),c='base'):return orb('Weathered stone',p,s,c,seg=10,rings=5)
def leaf(p,s=(.15,.6,.2),parent=None,c='leaf'):return orb('Carved leaf',p,s,c,parent,seg=8,rings=5)
def flower(p,s=1):
 x,y,z=p;tube('Flower stem',[(x,y,z),(x,y+s*.8,z)],[.05,.035],'leaf')
 for i in range(5):
  a=i*math.tau/5;orb('Flower petal',(x+math.cos(a)*s*.18,y+s*.83,z+math.sin(a)*s*.18),(s*.23,s*.08,s*.23),'accent',seg=8,rings=5)
 orb('Pollen heart',(x,y+s*.9,z),(s*.14,s*.09,s*.14),'gold',seg=8,rings=5)
def lantern(p,s=1):
 x,y,z=p;box('Lantern foot',(x,y,z),(s*.5,s*.1,s*.5),'gold')
 for dx in [-.2,.2]:
  for dz in [-.2,.2]:beam('Lantern frame',(x+dx*s,y,z+dz*s),(x+dx*s,y+.7*s,z+dz*s),.04*s)
 box('Lantern cap',(x,y+.72*s,z),(s*.58,s*.12,s*.58),'gold')
 bulb=moving('bloom',(x,y+.34*s,z));orb('Warm lantern',(0,0,0),(.17*s,.27*s,.17*s),'glow',bulb,kind='glow')
 ring('Lantern handle',(x,y+.96*s,z),s*.16,s*.025,vertical=True)
def bench(p=(0,0,0),s=1,buried=.12):
 x,y,z=p;box('Bench seat',(x,y+.7*s,z),(2.8*s,.18*s,.72*s),'light')
 for a in [-1,1]:box('Bench leg',(x+a*s,y+.29*s-buried/2,z),(.22*s,.62*s+buried,.62*s))
def pot(p,s=1):
 x,y,z=p;tube('Pottery planter',[(x,y-.08,z),(x,y+.65*s,z),(x,y+.7*s,z)],[.3*s,.46*s,.42*s],'accent');ring('Pottery lip',(x,y+.65*s,z),.44*s,.045*s,'light')
 for i in range(5):
  a=i*math.tau/5;leaf((x+math.cos(a)*s*.22,y+s,z+math.sin(a)*s*.22),(s*.12,s*.55,s*.18))
def bird(parent,p=(0,0,0),s=1,c='light',facing=0):
 if facing:
  parent=H.empty('Bird facing',p,parent);parent.rotation_euler.z=facing;p=(0,0,0)
 x,y,z=p;orb('Bird body',(x,y,z),(.34*s,.24*s,.5*s),c,parent);orb('Bird head',(x,y+.22*s,z-.35*s),(.23*s,.23*s,.24*s),c,parent)
 tube('Bird beak',[(x,y+.2*s,z-.48*s),(x,y+.17*s,z-.76*s)],[.13*s,.01],'gold',parent,6)
 for a in [-1,1]:orb('Bird eye',(x+a*.19*s,y+.27*s,z-.49*s),(.035*s,.045*s,.035*s),'dark',parent,seg=8,rings=5)
 for a in [-1,1]:
  wing=moving('flap',(x+a*.2*s,y,z),parent,phase=a,amplitude=.28);leaf((a*.38*s,0,.06*s),(.55*s,.055*s,.3*s),wing,c='accent')
def bee(parent):
 orb('Brass bee',(0,0,0),(.17,.16,.3),'gold',parent)
 for z in [-.1,.08]:ring('Bee stripe',(0,0,z),.16,.025,'dark',parent,True)
 orb('Bee face',(0,.05,.24),(.14,.13,.11),'gold',parent)
 for a in [-1,1]:
  orb('Bee eye',(a*.075,.08,.33),(.027,.035,.02),'dark',parent,seg=8,rings=5)
  beam('Bee antenna',(a*.06,.14,.27),(a*.11,.28,.28),.012,'dark',parent)
  wing=moving('flap',(a*.1,.09,0),parent,phase=a,amplitude=.28);leaf((a*.16,.035,0),(.2,.025,.11),wing,c='light')
def fireflies(center=(0,1.7,0),count=5,fish=False,paper=False):
 orbit=moving('orbit',center,speed=.22,amplitude=.2)
 for i in range(count):
  a=i*math.tau/count;r=1.1+(i%2)*.5
  rig=moving('bob',(math.cos(a)*r,(i%3)*.3,math.sin(a)*r),orbit,phase=i*1.7,speed=1.6,amplitude=.14)
  if fish:
   rig.rotation_euler.z=-a;orb('Glassfin body',(0,0,0),(.1,.18,.35),'accent',rig)
   H.mesh('Glassfin tail',[(-.18,0,.45),(0,0,.2),(.18,0,.45),(0,.19,.45)],[(0,1,2),(1,3,2),(0,3,1)],color('gold'),rig,kind='soft',smooth=False)
   orb('Glassfin eye',(.08,.05,-.22),(.035,.04,.04),'dark',rig,seg=8,rings=5)
  elif paper=='crane':
   # Folded paper silhouette with pointed wings, neck and tail.
   H.mesh('Origami crane',[(-.08,0,-.3),(.08,0,-.3),(0,-.13,.22),(0,.15,.2),(-.65,.18,.1),(.65,.18,.1),(0,.38,-.45),(0,.3,-.62),(0,.26,.55)],[(0,1,3),(0,3,4),(1,5,3),(0,4,2),(1,2,5),(2,3,8),(0,6,7),(0,7,1),(0,2,1)],color('light'),rig,kind='soft',smooth=False)
   beam('Crane tether',(-math.cos(a)*r,-.5-(i%3)*.3,-math.sin(a)*r),(0,0,0),.008,'gold',rig)
  elif paper:bird(rig,s=.55)
  else:
   orb('Little light',(0,0,0),(.065,.08,.09),'glow',rig,kind='glow',seg=8,rings=5)
   for side in [-1,1]:leaf((side*.11,0,0),(.13,.025,.065),rig,c='light')
def wheel(p,r=.65,parent=None):
 ring('Wheel rim',p,r,.09,'gold',parent,True)
 x,y,z=p
 for i in range(6):
  a=i*math.tau/6;beam('Wheel spoke',(x,y,z),(x+math.cos(a)*r,y+math.sin(a)*r,z),.045,'light',parent)
 orb('Wheel hub',p,(.14,.14,.12),'gold',parent)
def foundations(item):
 for f in item['floors']:
  x,z,w,d,y=f['x'],f['z'],f['w'],f['d'],f['y']
  if not f['rise']:
   box('Grounded stone plinth',(x,y-f['thickness']/2,z),(w,f['thickness'],d),'base',bevel=.09)
   for a in [-2,0,2]:box('Plinth paving',(a,.035,0),(1.94,.07,5.9),'light',bevel=.025)
  else:
   def top(z):return f['y']+f['rise']*(.5-(z-f['z'])/f['d'])
   verts=[(a,top(b)+dy,b) for dy in [-f['thickness'],0] for a,b in [(x-w/2,z-d/2),(x+w/2,z-d/2),(x+w/2,z+d/2),(x-w/2,z+d/2)]]
   H.mesh('Approach steps',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],color('base'),kind='rock',smooth=False)
   for i in range(8):
    zz=z-d/2+(i+.5)*d/8;box('Step nosing',(0,top(zz)+.018,zz),(w-.08,.035,.075),'light',bevel=.008)
def scene_model(item):
 global CURRENT,P
 id='discovery_'+item['id'];old=bpy.data.collections.get(id)
 if old:
  for o in list(old.objects):bpy.data.objects.remove(o,do_unlink=True)
  bpy.data.collections.remove(old)
 CURRENT=bpy.data.collections.new(id);bpy.context.scene.collection.children.link(CURRENT);H.CURRENT=CURRENT
 p=PALETTES[item['theme']];P=dict(zip(['base','light','leaf','accent','gold'],p));P.update(dark='#263940',glow=p[4] if item['theme']!='atlantis' else '#a0f7e6')
 shape=item['shape'];foundations(item)
 if shape=='mailbox':
  box('Mailbox post',(0,.8,-.3),(.3,2.1,.3))
  box('Letter house back',(0,1.9,-.87),(1.5,1.1,.12),'light')
  for x in [-.69,.69]:box('Letter house side',(x,1.9,-.3),(.12,1.1,1.25),'light')
  for y in [1.4,2.4]:box('Letter house shelf',(0,y,-.3),(1.5,.1,1.25),'light')
  for a in [-1,1]:
   pitched_box('Bee roof',(a*.45,2.56,-.3),(1.05,.13,1.6),a*.45)
  lid=moving('hinge',(0,1.35,.34),amplitude=1.1);box('Letter flap',(0,.45,0),(1.25,.86,.12),'accent',lid)
  for i in range(5):
   x=-.5+i*.25;tube('Bee nesting tube',[(x,1.95,-.8),(x,1.95,.2)],[.07,.07],'gold',sides=8);orb('Nesting hole',(x,1.95,.205),(.05,.05,.015),'dark',seg=8,rings=5)
  box('Waiting letter',(0,1.47,-.1),(.85,.04,.5),'light');beam('Vane spindle',(0,2.75,-.3),(0,2.99,-.3),.035)
  vane=moving('spin',(0,3.08,-.3),speed=.3);bee(vane);flower((-1.7,0,.5),.9);flower((1.5,0,.2),1.2);fireflies((0,1.6,0),3)
 elif shape=='tea':
  tube('Stump table',[(0,-.4,0),(0,.85,0),(0,.96,0)],[1,.82,1.4],'base');ring('Table edge',(0,.96,0),1.4,.055,'light')
  for i in range(4):
   a=i*math.tau/4;bench((math.cos(a)*2.3,0,math.sin(a)*2.3),.45)
  pot((-.55,.98,-.3),.5);orb('Copper teapot',(.3,1.22,0),(.35,.3,.3),'gold');ring('Teapot handle',(.6,1.27,0),.22,.045,'gold',vertical=True)
  tube('Teapot spout',[(.06,1.25,0),(-.23,1.42,0)],[.13,.065],'gold')
  for x,z in [(-.6,.45),(.65,.55),(0,-.75)]:tube('Tea cup',[(x,1.02,z),(x,1.25,z)],[.16,.19],'light');ring('Cup rim',(x,1.25,z),.19,.025,'gold')
  for i in range(3):
   steam=moving('steam',(.3,1.52,0),phase=i*2.1,amplitude=.35);orb('Kettle steam',(0,0,0),(.04+i*.012,.09,.04+i*.012),'light',steam)
  flower((2,0,-1.6),.6)
 elif shape=='hollow':
  # A genuinely open log, with bark ribs surrounding a person-sized passage.
  for end in [-2.4,2.4]:
   for i in range(15):
    a=i*math.pi/14;stone((math.cos(a)*1.85,math.sin(a)*2.95-.12,end),(.43,.42,.36),'light')
  for i in range(15):
   a=i*math.pi/14;tube('Old bark ridge',[(math.cos(a)*1.88,math.sin(a)*2.95-.25,-2.4),(math.cos(a)*2,math.sin(a)*3.1-.1,0),(math.cos(a)*1.88,math.sin(a)*2.95-.25,2.4)],[.36,.42,.36])
  for x,z in [(-2.3,-1),(-2.1,1.8),(2.2,.5),(1.5,-2.3)]:
   tube('Mushroom stem',[(x,-.2,z),(x,.55,z)],[.11,.09],'light');orb('Mushroom cap',(x,.62,z),(.46,.19,.4),'accent');orb('Mushroom glow',(x,.52,z),(.31,.06,.29),'glow',kind='glow')
  fireflies((0,1.65,0),6)
 elif shape=='workshop':
  tube('Workshop stump',[(0,-.5,-.3),(0,1.05,-.3)],[1.25,1.05]);box('Workbench',(0,1.15,-.3),(2.8,.18,1.4),'light')
  rotor=moving('wheel',(0,.65,1.05),speed=.6);wheel((0,0,0),.55,rotor)
  beam('Wheel axle',(0,.65,.45),(0,.65,1.08),.1)
  pecker=moving('peck',(.65,1.51,-.2),amplitude=.35);bird(pecker,s=1,facing=2.3)
  for x in [.5,.8]:beam('Carved bird foot',(x,1.24,-.2),(x,1.48,-.2),.035)
  for x,z in [(-.8,-.3),(-.2,.1),(-.5,-.6)]:orb('Acorn blank',(x,1.45,z),(.18,.22,.18),'gold');ring('Acorn cap',(x,1.59,z),.18,.04)
  box('Tool rack',(-1.15,1.9,-.8),(.14,1.3,.16));beam('Hanging saw',(-1.15,2.3,-.8),(-.2,2.3,-.8),.05)
  for i in range(6):box('Carving shavings',(-1.8+i*.23,.1,1.4),(.17,.06,.25),'light',bevel=.008)
 elif shape=='organ':
  box('Organ chest',(0,.6,-.3),(2.9,1.3,1.4));box('Ivory keys',(0,1.29,.43),(2.5,.12,.6),'light')
  for i in range(7):
   x=(i-3)*.36;h=2+(i%4)*.38;tube('Reed pipe',[(x,.9,-.55),(x,h,-.55)],[.13,.13],'leaf');ring('Pipe lip',(x,h,-.55),.135,.025)
   key=moving('key',(x,1.35,.65),phase=i*.7,amplitude=.06);box('Frog key',(0,0,0),(.23,.11,.34),'accent',key)
   for side in [-1,1]:
    orb('Frog eye mound',(side*.065,.08,.08),(.055,.055,.05),'leaf',key,seg=8,rings=5);orb('Frog key eye',(side*.065,.09,.12),(.025,.025,.017),'dark',key,seg=8,rings=5)
  bellows=moving('pulse',(0,.55,.58),amplitude=.18);box('Pump bellows',(0,0,0),(1.6,.6,.4),'accent',bellows)
  for x in [-2,2]:pot((x,0,-.5),.85)
 elif shape=='skiff':
  for i in range(9):
   z=(i-4)*.32;w=3.8*(1-.34*(abs(i-4)/4)**2);box('Ferry hull plank',(0,.1+abs(i-4)*.055,z),(w,.16,.28),'light')
  for x in [-1.85,1.85]:tube('Curved ferry gunwale',[(x*.66,.55,-1.45),(x,.72,0),(x*.66,.55,1.45)],[.16,.15,.16])
  for x in [-1,1]:box('Ferry seat',(x,.65,0),(.4,.15,2.1),'accent')
  beam('Lantern pole',(-1.4,0,-.8),(-1.4,2.6,-.8),.075);beam('Lantern arm',(-1.4,2.6,-.8),(-.7,2.6,-.8),.06);lantern((-.7,1.65,-.8),.9)
  for x,z in [(1.5,1),(-1.5,1.2),(.9,-1.5)]:pot((x,-.1,z),.65)
  beam('Abandoned oar',(-2,.3,-1.5),(1,.5,1.8),.06);leaf((1.15,.5,1.95),(.3,.05,.6),c='light')
 elif shape=='harp':
  for x in [-1.8,1.8]:
   tube('Wind-worn rib',[(x,-.4,0),(x*.93,2,0),(x*.68,3.6,0)],[.5,.32,.18],'light')
  beam('Harp crown',(-1.25,3.6,0),(1.25,3.6,0),.18)
  beam('Harp bridge',(-1.8,.65,0),(1.8,.65,0),.12,'light')
  for i in range(9):
   x=(i-4)*.27;beam('Tuned metal string',(x,.65,0),(x,3.45,0),.014,'gold')
   bell=moving('sway',(x,2.7,.08),phase=i*.8,amplitude=.12);tube('Wind chime',[(0,0,0),(0,-.4-(i%3)*.14,0)],[.07,.07],'gold',bell)
  for x in [-2,2]:stone((x,0,0),(.7,.5,.9))
 elif shape=='mine':
  for x in [-2,2]:box('Old mine support',(x,1.45,-1.2),(.4,3.5,.45))
  box('Mine crossbeam',(0,3.05,-1.2),(4.8,.4,.5),'light');lantern((-1.4,2.15,-1.2),.8)
  for x in [-.65,.65]:beam('Short cart rail',(x,.15,-1.5),(x,.15,2),.07,'dark')
  cart=moving('cart',(0,.65,-.25),amplitude=.35)
  box('Ore cart',(0,0,0),(1.9,.9,1.3),'light',cart);box('Ore cart rim',(0,.45,0),(2,.13,1.4),'gold',cart)
  for x in [-.8,.8]:
   for z in [-.5,.5]:ring('Cart wheel',(x,-.4,z),.25,.055,'dark',cart,True)
  for i in range(5):tube('Blue ore',[(math.sin(i*2)*.6,.38,math.cos(i*2)*.4),(math.sin(i*2)*.6,.85+(i%2)*.2,math.cos(i*2)*.4)],[.23,.01],'accent',cart,5)
  wind=moving('wheel',(1.9,1.7,0),speed=.5);wheel((0,0,0),.6,wind);beam('Winch rope',(1.9,1.7,0),(0,1.1,0),.025)
 elif shape=='cairn':
  for i in range(5):stone((0,.2+i*.45,-.3),(1.2-i*.17,.32,1-i*.13),'base' if i%2 else 'light')
  star=moving('spin',(0,2.85,-.3),speed=.17)
  ring('Star mirror frame',(0,0,0),.6,.08,'gold',star,True)
  for i in range(5):
   a=i*math.tau/5;beam('Mirror star',(0,0,0),(math.sin(a)*.6,math.cos(a)*.6,0),.055,'gold',star)
  orb('Mirror heart',(0,0,.02),(.17,.17,.045),'glow',star,kind='glow')
  for x,z in [(-2,1.5),(2,1.5),(-1.8,-1.8),(1.8,-1.8)]:stone((x,.1,z),(.5,.7,.45));flower((x+.2,0,z),.5)
 elif shape=='shelter':
  for x in [-2.2,2.2]:
   for z in [-1.8,1.8]:box('Shelter post',(x,1.35,z),(.28,3.9,.28),'base')
  for x in [-1.45,0,1.45]:box('Roof beam',(x,3.22,0),(.15,.22,4.8),'gold')
  for x in [-1,1]:
   pitched_box('Shelter roof',(x*1.35,3.65,0),(2.95,.16,4.9),x*.25)
  bench((0,0,-1.45),buried=.65);lantern((1.05,.8,-1.4),.9)
  beam('Shelter ridge',(0,3.98,-2.45),(0,3.98,2.45),.11,'gold')
  for i in range(5):
   rig=moving('sway',((i-2)*.48,3.15,1.9),phase=i,amplitude=.2)
   beam('Bell cord',(0,0,0),(0,-.35,0),.02,'light',rig);tube('Shepherd bell',[(0,-.35,0),(0,-.68,0)],[.09,.2],'gold',rig)
  box('Spare wool blanket',(-.7,.85,-1.4),(.8,.15,.7),'accent');tube('Traveller cup',[(.8,.8,-1.4),(.8,1.05,-1.4)],[.12,.15],'light')
 elif shape=='bottles':
  tube('Driftwood post',[(0,-.6,-.3),(.1,1.9,-.3)],[.33,.22]);box('Tide letter shelf',(0,.7,-.3),(2.9,.18,1.4),'light')
  for i in range(5):
   x=(i-2)*.45;tube('Sea letter bottle',[(x,.8,-.3),(x,1.2,-.3),(x,1.35,-.3),(x,1.55,-.3)],[.16,.16,.075,.075],'leaf');ring('Bottle collar',(x,1.5,-.3),.085,.025)
  paper=moving('reveal',(0,1.8,.1),amplitude=.25)
  H.mesh('Folded paper boat',[(-.65,0,0),(.65,0,0),(0,-.25,.25),(0,-.25,-.25),(0,.45,0)],[(0,2,1),(0,1,3),(0,4,1)],color('light'),paper,kind='rock',smooth=False)
  for x,z in [(-1.8,1.1),(1.6,.6),(.8,-1.4)]:stone((x,-.05,z),(.5,.25,.4),'light')
 elif shape=='lookout':
  for x,z in [(-.7,-.4),(.7,-.4),(0,.7)]:beam('Telescope tripod',(x,-.1,z),(0,1.6,0),.09,'base')
  scope=moving('sway',(0,1.65,0),speed=.45,amplitude=.08);scope.rotation_euler.z=.65;tube('Lookout telescope',[(0,0,.65),(0,.25,-1.1)],[.25,.38],'gold',scope);orb('Telescope lens',(0,.26,-1.13),(.31,.31,.045),'accent',scope);ring('Eyepiece rim',(0,0,.67),.21,.035,'dark',scope,True)
  for x in [-2,2]:beam('Lookout railing',(x,0,-1.6),(x,1,-1.6),.065);beam('Cross rail',(-2,.95,-1.6),(2,.95,-1.6),.06)
  pole=moving('spin',(1.8,3,-1.5),speed=.2);beam('Weather vane staff',(1.8,-.2,-1.5),(1.8,3,-1.5),.06,'base');bird(pole,s=.55);fireflies((0,3,0),3,paper=True)
 elif shape=='rookery':
  box('Rookery plinth',(0,.55,-.3),(2,1.3,1.4),'base');ring('Brass nest',(0,1.35,-.3),.75,.13)
  for i in range(3):orb('Clockwork egg',((i-1)*.32,1.5,-.2),(.16,.22,.16),'accent')
  clock=moving('wheel',(0,.65,.47),speed=.2);wheel((0,0,0),.45,clock)
  rook=moving('peck',(0,1.7,-.5),amplitude=.17);bird(rook,s=1.3,c='base',facing=2.55)
  for x in [-1.5,1.5]:beam('Perch rail',(x,0,-1),(x,2.5,-1),.08);orb('Perch finial',(x,2.65,-1),(.15,.2,.15),'gold')
 elif shape=='garden':
  bench((0,0,-.3));box('Potting shelf',(0,1.6,-.85),(3.4,.14,.65),'light')
  for x in [-1.5,1.5]:box('Shelf support',(x,.85,-.95),(.13,1.7,.13),'base')
  for x,s in [(-1.2,.65),(0,.85),(1.2,.55)]:pot((x,.85,-.3),s)
  lantern((0,1.68,-.8),.9);pot((-2,0,-.7),1);pot((2,0,-.6),.8);fireflies((0,2.2,.2),5)
  for x,h in [(-1.2,1.55),(0,1.8),(1.2,1.4)]:flower((x,h,-.3),.35)
 elif shape=='shell':
  # An open shell bowl: curved ribs and a hollow inner lip, not a solid orb.
  skin=[]
  for i in range(17):
   a=-math.pi*.85+i*math.pi*1.7/16
   path=[(math.sin(a)*2.1,.15,-math.cos(a)*1.7-.6),(math.sin(a)*1.8,1.7,-math.cos(a)*1.35-.6),(math.sin(a)*.9,2.8,-math.cos(a)*.7-.6)]
   tube('Shell rib',path,[.19,.16,.11],'accent' if i%3==0 else 'light');skin.extend(path)
  o=H.mesh('Shell inner bowl',skin,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(16) for j in range(2)],color('light'),kind='soft');mod=o.modifiers.new('Shell thickness','SOLIDIFY');mod.thickness=.08;H.apply_mod(o,mod)
  ring('Shell listening ring',(0,1.35,-.6),1,.1,'gold',vertical=True);bench((0,0,.45),.65)
  song=moving('pulse',(0,1.4,-.65),amplitude=.16);orb('Shell song pearl',(0,0,0),(.34,.34,.34),'glow',song,kind='glow');fireflies((0,2.1,0),4)
 elif shape=='nursery':
  for x in [-1.8,0,1.8]:
   ring('Coral nursery ring',(x,1.3,-.5),.85,.14,'accent',vertical=True)
   tube('Coral root',[(x,-.5,-.5),(x,1.4,-.5)],[.22,.1],'leaf')
   for a in [-1,1]:tube('Coral branch',[(x,.4,-.5),(x+a*.5,1.1,-.5),(x+a*.65,1.3,-.4)],[.14,.09,.03],'light')
  fireflies((0,1.8,-.2),6,fish=True);lantern((0,.1,.65),.65)
 elif shape=='laundry':
  for x in [-2.2,2.2]:beam('Laundry mast',(x,-.1,0),(x,3.3,0),.1);orb('Laundry finial',(x,3.4,0),(.16,.21,.16),'gold')
  tube('Sagging clothesline',[(-2.2,3.1,0),(0,2.85,0),(2.2,3.1,0)],[.025]*3,'gold')
  for i in range(5):
   x=(i-2)*.77;cloth=moving('cloth',(x,2.95,0),phase=i,amplitude=.12)
   verts=[((col/4-.5)*.62,-row/6*(1.15+(i%2)*.25),math.sin(row*.7+col*.4)*.12) for row in range(7) for col in range(5)]
   faces=[(r*5+c,r*5+c+1,(r+1)*5+c+1,(r+1)*5+c) for r in range(6) for c in range(4)]
   o=H.mesh('Wind-dried scarf',verts,faces,color('light' if i%2 else 'accent'),cloth,kind='soft');mod=o.modifiers.new('Cloth thickness','SOLIDIFY');mod.thickness=.02;H.apply_mod(o,mod)
   box('Brass peg',(0,.02,0),(.07,.18,.1),'gold',cloth)
  tube('Laundry basket',[(1.4,-.04,1),(1.4,.65,1)],[.42,.55],'base');ring('Basket rim',(1.4,.65,1),.55,.06,'light')
 elif shape=='kites':
  box('Weather machine',(0,.65,-.3),(1.8,1.4,1.3),'light');rotor=moving('wheel',(0,1,.45),speed=.8);wheel((0,0,0),.55,rotor)
  tube('Kite mast',[(0,-.2,-.3),(0,3.3,-.3)],[.13,.08],'gold');ring('Wind crown',(0,3.15,-.3),1.1,.06)
  fireflies((0,3,-.3),5,paper='crane')
 for o in list(CURRENT.objects):
  if o.type=='MESH':o.hide_set(False)
 # Preserve each motion pivot; stationary pieces share one Blender mesh.
 buckets={}
 for o in CURRENT.objects:
  if o.type=='MESH':buckets.setdefault(o.parent,[]).append(o)
 for i,(parent,objects) in enumerate(buckets.items()):
  for o in bpy.context.scene.objects:o.select_set(False)
  owned=[o.data for o in objects]
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name=id+'_part_'+str(i)
  for mesh in owned:
   if mesh.users==0:bpy.data.meshes.remove(mesh)
 for o in bpy.context.scene.objects:o.select_set(False)
 for o in CURRENT.objects:o.select_set(True);o.hide_set(False)
 bpy.context.view_layer.objects.active=next(iter(CURRENT.objects));path=OUT/(id+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_extras=True,export_animations=False)
 entry=dict(id=id,category='discovery',triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in CURRENT.objects if o.type=='MESH'),sourceTriangles=0,bytes=path.stat().st_size,parts=sum(o.type=='MESH' for o in CURRENT.objects),authoring='Blender MCP')
 ENTRIES.append(entry)
 for o in CURRENT.objects:o.select_set(False);o.hide_set(True)
 print(json.dumps(entry),flush=True)
previous=bpy.context.window.scene
scene=bpy.data.scenes.get('Wildtag Small Wonders') or bpy.data.scenes.new('Wildtag Small Wonders');bpy.context.window.scene=scene
try:
 ART.mkdir(parents=True,exist_ok=True)
 for item in DATA:
  if not ONLY or item['id'] in ONLY:scene_model(item)
 path=ROOT/'public/wildtag/asset-manifest.json';manifest=json.loads(path.read_text());ids={e['id'] for e in ENTRIES}
 manifest['assets']=[a for a in manifest['assets'] if a['id'] not in ids]+ENTRIES
 manifest['discoveries']={'layoutSha256':hashlib.sha256((ROOT/'src/discoveries/data.json').read_bytes()).hexdigest(),'source':'art/wildtag/discoveries/small-wonders.blend'}
 path.write_text(json.dumps(manifest,indent=2)+'\n');bpy.data.libraries.write(str(ART/'small-wonders.blend'),{scene},fake_user=True,compress=True)
 print('SMALL WONDERS COMPLETE',len(ENTRIES),'assets',sum(e['triangles'] for e in ENTRIES),'triangles')
finally:bpy.context.window.scene=previous
