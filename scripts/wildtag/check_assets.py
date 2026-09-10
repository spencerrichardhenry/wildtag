"""Validate the actual shipping GLBs, their catalog coverage, and Blender geometry."""
import json,struct,math,gzip,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
manifest=json.loads((ROOT/'public/wildtag/asset-manifest.json').read_text())
if 'skyKingdom' in manifest:
    assert manifest['skyKingdom']['layoutSha256']==hashlib.sha256((ROOT/'src/sky/layout-data.json').read_bytes()).hexdigest(), 'Sky collision layout changed without rebuilding Blender architecture'
    assert (ROOT/manifest['skyKingdom']['source']).is_file()
ref=ROOT/'art/wildtag/design-reference.json'
references=json.loads(ref.read_text() if ref.exists() else gzip.decompress(ref.with_suffix('.json.gz').read_bytes()))
ids={a['id'] for a in manifest['assets']}
assert len(ids)==len(manifest['assets'])
if 'discoveries' in manifest:
    discovery_path=ROOT/'src/discoveries/data.json';discoveries=json.loads(discovery_path.read_text())
    assert manifest['discoveries']['layoutSha256']==hashlib.sha256(discovery_path.read_bytes()).hexdigest(), 'Discovery layout changed without rebuilding Blender models'
    assert (ROOT/manifest['discoveries']['source']).is_file()
    assert len(discoveries)==18 and len({p['region'] for p in discoveries})==9
    assert all('discovery_'+p['id'] in ids for p in discoveries)
    assert sum(a['triangles'] for a in manifest['assets'] if a.get('category')=='discovery')<100000, 'Small-wonder geometry budget exceeded'
for place,source in manifest.get('landmarks',{}).items():
    layout_path=ROOT/'src/landmarks'/f'{place}.json';layout=json.loads(layout_path.read_text())
    assert source['layoutSha256']==hashlib.sha256(layout_path.read_bytes()).hexdigest(), f'{place} layout changed without rebuilding Blender architecture'
    assert (ROOT/source['source']).is_file()
    assert place+'_shadow' in ids
    sectors={p['sector'] for key in ['floors','walls','towers'] for p in layout[key]}
    for variant in (['_cursed','_purified'] if place=='castle' else ['']):
        required={f'{place}_district_{s}{variant}' for s in sectors}|{f'{place}_detail_{p["kind"]}{variant}' for p in layout['props']}
        assert required<=ids, required-ids
    assert len(layout['zones'])==10 and len(layout['relics'])==3
if manifest.get('landmarks'):
    assert all(a.get('load') is False for a in manifest['assets'] if a['id'] in ['castle_cursed','castle_purified','atlantis'])
assert all(a['id'] in ids for a in references)
reference_by_id={a['id']:a for a in references}
shipping=[]
for item in manifest['assets']:
    shipping.append({**item,'path':'models/'+item['id']+'.glb'})
    lods=item.get('lods',[])
    if item['id'].startswith('prop_'):
        assert [l['level'] for l in lods]==[1,2],item['id']
        assert item['triangles']>lods[0]['triangles']>lods[1]['triangles']>0,item['id']
    shipping.extend({**l,'id':item['id']+'_lod'+str(l['level'])} for l in lods)
for item in shipping:
    data=(ROOT/'public/wildtag'/item['path']).read_bytes()
    assert data[:4]==b'glTF' and struct.unpack_from('<I',data,4)[0]==2
    assert len(data)==struct.unpack_from('<I',data,8)[0]==item['bytes']
    length=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+length]);binary=data[28+length:]
    assert gltf.get('meshes') and gltf.get('buffers')
    assert not any('uri' in b for b in gltf['buffers'])
    assert all(item['id'] in n.get('name','') for n in gltf.get('nodes',[]) if 'mesh' in n),item['id']
    actual=0
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            pos=gltf['accessors'][primitive['attributes']['POSITION']]
            if '_lod' in item['id']: assert 'COLOR_0' in primitive['attributes'],item['id']
            assert pos['type']=='VEC3' and pos['count']>0
            assert all(math.isfinite(v) for v in pos['min']+pos['max'])
            view=gltf['bufferViews'][pos['bufferView']];offset=view.get('byteOffset',0)+pos.get('byteOffset',0)
            stride=view.get('byteStride',12)
            for i in range(pos['count']):
                assert all(math.isfinite(v) for v in struct.unpack_from('<fff',binary,offset+i*stride))
            if 'indices' in primitive:
                acc=gltf['accessors'][primitive['indices']];actual+=acc['count']//3
                view=gltf['bufferViews'][acc['bufferView']];fmt={5121:'B',5123:'H',5125:'I'}[acc['componentType']]
                values=struct.unpack_from('<'+fmt*acc['count'],binary,view.get('byteOffset',0)+acc.get('byteOffset',0))
                assert max(values)<pos['count']
            else:actual+=pos['count']//3
    assert actual==item['triangles'],(item['id'],actual,item['triangles'])
    if item['id'] in reference_by_id:
        assert len(gltf['meshes'])==len(reference_by_id[item['id']]['parts']),item['id']
print(f"PASS: {len(ids)} Blender assets + {len(shipping)-len(ids)} LOD variants, {sum(a['triangles'] for a in shipping):,} unique triangles, {sum(a['bytes'] for a in shipping)/1024/1024:.1f} MiB; all reference models covered")
