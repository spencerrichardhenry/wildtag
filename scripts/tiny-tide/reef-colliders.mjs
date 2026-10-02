// Writes src/tiny-tide/reef-colliders.json: the stone (material Tide_rock) and moss (Tide_leaf) meshes of each reef solid's GLB, which
// reef.ts uses as the rock and arch colliders (final review I2). The arch's crown coral (Tide_soft) has no collision, like all coral. Run after the Blender assets change: node scripts/tiny-tide/reef-colliders.mjs
// tests/tiny-tide-core/reef.test.ts fails while the file differs from the GLBs.
import { readFileSync, writeFileSync } from 'node:fs';

const ASSETS = ['reef_rock_0', 'reef_rock_1', 'reef_arch'];
/** POSITION and indices of the GLB primitive with this material (the reef GLBs have no node transforms). */
function stone(path, material = 'Tide_rock') {
  const data = readFileSync(path), dv = new DataView(data.buffer, data.byteOffset, data.byteLength), jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength))), bin = 28 + jsonLength;
  const view = i => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3 }[a.type], o = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out = [];
    for (let k = 0; k < a.count * n; k++) out.push(a.componentType === 5126 ? dv.getFloat32(o + 4 * k, true) : a.componentType === 5125 ? dv.getUint32(o + 4 * k, true) : dv.getUint16(o + 2 * k, true));
    return out;
  };
  for (const m of json.meshes) for (const p of m.primitives) if (json.materials?.[p.material]?.name === material) return { positions: view(p.attributes.POSITION).map(x => Math.round(x * 1e6) / 1e6), index: view(p.indices) };
  throw new Error(`${path}: no ${material} primitive`);
}
const out = Object.fromEntries(ASSETS.map(name => [name, { stone: stone(`public/tiny-tide/models/${name}.glb`), moss: stone(`public/tiny-tide/models/${name}.glb`, 'Tide_leaf') }]));
writeFileSync('src/tiny-tide/reef-colliders.json', JSON.stringify(out) + '\n');
console.log(`Wrote src/tiny-tide/reef-colliders.json: ${ASSETS.map(n => `${n} ${out[n].stone.index.length / 3} + ${out[n].moss.index.length / 3} triangles`).join(', ')}.`);
