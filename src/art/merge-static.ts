import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge stationary meshes by exact material, preserving local transforms and
 * normals. Animation owners explicitly exclude moving pieces. */
export function mergeStaticMeshes(root: THREE.Group, include: (mesh: THREE.Mesh) => boolean): void {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !include(o) || Array.isArray(o.material)
      || o.material.transparent || !o.visible) return;
    // Keep differing attribute layouts and shadow flags separate.
    const key = `${o.material.uuid}:${Object.keys(o.geometry.attributes).sort()}:${o.castShadow}:${o.receiveShadow}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = { material: o.material, meshes: [] });
    bucket.meshes.push(o);
  });
  for (const { material, meshes } of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, material);
    merged.name = `${root.name} static ${material.name || material.type}`;
    merged.castShadow = meshes[0]!.castShadow;
    merged.receiveShadow = meshes[0]!.receiveShadow;
    root.add(merged);
    const owned = new Set<THREE.BufferGeometry>();
    for (const m of meshes) { owned.add(m.geometry); m.removeFromParent(); }
    for (const g of owned) g.dispose();
  }
}
