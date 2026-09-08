"""Validate the shipped Blender exports without installing Blender or glTF tools."""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / 'public/tiny-tide'
manifest = json.loads((PUBLIC / 'asset-manifest.json').read_text())
assert len(manifest) == 50, 'Expected five heroes, seventeen foods, sixteen scenery assets and twelve planets'
assert {p.stem for p in (PUBLIC / 'models').glob('*.glb')} == set(manifest)
total = 0

for name, record in manifest.items():
    data = (PUBLIC / 'models' / record['file']).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and length == len(data), name
    json_length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A, name
    gltf = json.loads(data[20:20 + json_length])
    binary = data[28 + json_length:]
    assert all('uri' not in b for b in gltf['buffers']), f'{name}: external buffer'
    assert not gltf.get('images'), f'{name}: unexpected texture download'
    assert record['authoring'] == 'Blender MCP'
    assert record['bytes'] == len(data) and len(data) < 1_000_000, name
    total += len(data)

    def values(index):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        fmt = '<' + {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[accessor['componentType']] * components
        stride = view.get('byteStride', struct.calcsize(fmt))
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return [struct.unpack_from(fmt, binary, offset + i * stride) for i in range(accessor['count'])]

    triangles = 0
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            assert all(key in attrs for key in ['POSITION', 'NORMAL', 'COLOR_0']), name
            assert primitive.get('mode', 4) == 4, name
            positions = values(attrs['POSITION'])
            assert all(math.isfinite(v) for p in positions for v in p), name
            indices = [i[0] for i in values(primitive['indices'])]
            assert max(indices) < len(positions), name
            triangles += len(indices) // 3
            if name in ['seabed_1', 'seabed_2']:
                inner = 65 if name == 'seabed_1' else 450
                for i in range(0, len(indices), 3):
                    points = [positions[j] for j in indices[i:i + 3]]
                    x = sum(p[0] for p in points) / 3
                    z = sum(p[2] for p in points) / 3
                    assert max(abs(x), abs(z)) >= inner - .001, f'{name}: distant terrain overlaps the detailed reef'
    assert triangles == record['triangles'], name

    if name.startswith('hero_'):
        clips = gltf.get('animations', [])
        assert {a['name'] for a in clips} == {'Idle', 'Swim', 'Chomp'}, name
        for clip in clips:
            targets = [(c['target']['node'], c['target']['path']) for c in clip['channels']]
            assert len(set(targets)) == len(targets), f'{name}: duplicate animation channels'
            assert any(len(set(values(s['output']))) > 1 for s in clip['samplers']), f'{name}: static {clip["name"]} clip'

assert total < 8 * 1024 * 1024
print(f'PASS: {len(manifest)} self-contained Blender GLBs, {total / 1024 / 1024:.2f} MiB, painted colors, valid meshes, 15 moving hero clips, open terrain rings.')
