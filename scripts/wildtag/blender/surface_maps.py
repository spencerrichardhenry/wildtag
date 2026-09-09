"""Author seamless ground-grain and water-normal maps in the Wildtag Blender studio."""
import bpy, math
from mathutils import noise, Vector
from pathlib import Path
ROOT=Path('/Users/spencerhenry/projects/wildtag')
OUT=ROOT/'public/wildtag/textures';OUT.mkdir(parents=True,exist_ok=True)
size=256
height=[]
for y in range(size):
    for x in range(size):
        u=x/size*math.tau;v=y/size*math.tau
        # A torus parameterization makes opposite edges continuous.
        p=Vector(((2+.65*math.cos(v))*math.cos(u),(2+.65*math.cos(v))*math.sin(u),.65*math.sin(v)))
        value=noise.fractal(p*5,.8,2,4)
        height.append(value)
for name in ['ground_grain','water_normal']:
    image=bpy.data.images.get('Wildtag_'+name) or bpy.data.images.new('Wildtag_'+name,width=size,height=size,alpha=False)
    pixels=[]
    for y in range(size):
        for x in range(size):
            h=height[y*size+x]
            if name=='ground_grain':
                c=max(.72,min(1,.88+h*.14));pixels.extend([c,c,c,1])
            else:
                dx=height[y*size+(x+1)%size]-height[y*size+(x-1)%size]
                dy=height[((y+1)%size)*size+x]-height[((y-1)%size)*size+x]
                n=Vector((-dx*.7,-dy*.7,1)).normalized();pixels.extend([n.x*.5+.5,n.y*.5+.5,n.z*.5+.5,1])
    image.pixels.foreach_set(pixels);image.filepath_raw=str(OUT/(name+'.png'));image.file_format='PNG';image.save()
    image.pack()
    print(name,image.size[:])
# Preserve the editable images along with the isolated scene library.
scene=bpy.data.scenes['Wildtag Atelier']
bpy.data.libraries.write(str(ROOT/'art/wildtag/wildtag-art.blend'),{scene,*[i for i in bpy.data.images if i.name.startswith('Wildtag_')]},fake_user=True,compress=True)
