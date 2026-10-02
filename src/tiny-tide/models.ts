import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset } from './assets';
import type { FoodKind } from './species';

const effectMaterials = new Map<string, T.MeshStandardMaterial>();
/** Small runtime particles use an effect material; all game models are GLBs. */
export function material(color: string, glow = 0) {
  const key = color + glow;
  if (!effectMaterials.has(key)) effectMaterials.set(key, new T.MeshStandardMaterial({ color, roughness: .75, emissive: color, emissiveIntensity: glow }));
  return effectMaterials.get(key)!;
}
export function batch(group: T.Group): T.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  group.traverse(obj => {
    if (!(obj instanceof T.Mesh) || Array.isArray(obj.material)) return;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
    // Exported meshes all have painted colors. Normalize optional attributes
    // so distinct Blender assets can share a single static draw per material.
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.color) {
      const colors = new Float32Array(geometry.attributes.position!.count * 4).fill(1); geometry.setAttribute('color', new T.BufferAttribute(colors, 4));
    } else if (geometry.attributes.color.itemSize === 3) {
      const a = geometry.attributes.color, colors = new Float32Array(a.count * 4);
      for (let i = 0; i < a.count; i++) colors.set([a.getX(i), a.getY(i), a.getZ(i), 1], i * 4);
      geometry.setAttribute('color', new T.BufferAttribute(colors, 4));
    }
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position!.count }, (_, i) => i));
    const list = buckets.get(obj.material) || []; list.push(geometry); buckets.set(obj.material, list);
  });
  const result = new T.Group();
  for (const [mat, geoms] of buckets) {
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('Could not batch Blender scenery');
    const m = new T.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; m.userData.ownedGeometry = true; result.add(m);
    for (const geometry of geoms) geometry.dispose();
  }
  return result;
}
export function foodModel(kind: FoodKind, id = 0): T.Group { return asset(kind === 'planet' ? `planet_${String(id).padStart(2, '0')}` : kind); }
export { asset as sceneryAsset };
