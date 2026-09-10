import * as THREE from 'three';
import { expect, it } from 'vitest';
import { mergeStaticMeshes } from '../src/art/merge-static.ts';

it('preserves world bounds and triangle counts while retaining moving pieces and materials', () => {
  const root = new THREE.Group(); root.position.set(50,5,-20); root.rotation.y=.4;
  const material = new THREE.MeshStandardMaterial({color:0xaabba0});
  const parent = new THREE.Group(); parent.position.set(5,1,2); parent.rotation.z=.3; root.add(parent);
  for (let i=0;i<4;i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,2,3), material);
    mesh.position.set(i*3,1,0); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  }
  const moving = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), material);
  moving.userData.animated=true; parent.add(moving);
  const bounds = new THREE.Box3().setFromObject(root);
  mergeStaticMeshes(root, m=>!m.userData.animated);
  const after = new THREE.Box3().setFromObject(root);
  expect(after.min.distanceTo(bounds.min)).toBeLessThan(1e-5);
  expect(after.max.distanceTo(bounds.max)).toBeLessThan(1e-5);
  const meshes:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
  expect(meshes).toHaveLength(2); expect(moving.parent).toBe(parent);
  expect(meshes.every(m=>m.material===material)).toBe(true);
  expect(meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3,0)).toBe(60);
  expect(meshes.find(m=>m!==moving)?.castShadow).toBe(true);
  // Four indexed boxes retain 96 vertices rather than expanding to 144.
  expect(meshes.find(m=>m!==moving)?.geometry.getAttribute('position').count).toBe(96);
  expect(meshes.find(m=>m!==moving)?.geometry.index?.count).toBe(144);
});
