import * as THREE from 'three';
import {expect,it} from 'vitest';
import {partitionStaticMesh} from '../src/art/spatial-batches.ts';
it('preserves every indexed triangle and transform while tightening patch bounds',()=>{
 const geo=new THREE.PlaneGeometry(160,160,100,100);geo.rotateX(-Math.PI/2);
 const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());mesh.position.set(31,7,44);mesh.rotation.y=.8;mesh.castShadow=true;
 const root=new THREE.Group();root.add(mesh);const before=new THREE.Box3().setFromObject(root);
 const expected=Array.from(geo.index!.array),group=partitionStaticMesh(mesh)!;expect(group.children.length).toBeGreaterThan(10);
 const after=new THREE.Box3().setFromObject(root);expect(after.min.distanceTo(before.min)).toBeLessThan(.001);expect(after.max.distanceTo(before.max)).toBeLessThan(.001);
 const actual:number[]=[];
 for(const child of group.children){const m=child as THREE.Mesh;actual.push(...m.geometry.index!.array);expect(m.geometry.getAttribute('position')).toBe(geo.getAttribute('position'));expect(m.geometry.boundingSphere!.radius).toBeLessThan(26);expect(m.castShadow).toBe(true);}
 const triples=(a:number[])=>Array.from({length:a.length/3},(_,i)=>a.slice(i*3,i*3+3).join(',')).sort();expect(triples(actual)).toEqual(triples(expected));
});
