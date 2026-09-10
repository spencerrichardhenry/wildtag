import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {registerArtAsset,isSharedArtMaterial} from '../src/art/library.ts';
import {buildLandmark} from '../src/landmarks/presentation.ts';
import {ATLANTIS_DEPTH} from '../src/landmarks/world.ts';

it('exports a single exposed surface at castle roof/wall joins in both palettes',async()=>{
 // These off-diagonal samples lie in the intersections that visibly flickered
 // when roof slabs and wall caps were both exported at the same height.
 const probes:Record<string,number[][]>={
  keep:[[-9.6,20,-4.3],[-3.2,20,-9.6],[-9.6,20,-9.7]],
  library:[[-16.2,8,-61.3],[-1.3,8,-71.2]],
  forge:[[-71.2,8,-1.3],[-61.3,8,-16.2]],
  ramparts:[[32.3,8,-90.2],[-90.2,8,32.3]],
 };
 for(const variant of ['cursed','purified'])for(const [sector,points] of Object.entries(probes)){
  const file=readFileSync(`public/wildtag/models/castle_district_${sector}_${variant}.glb`);
  const {scene}=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');scene.updateMatrixWorld(true);
  for(const [x,y,z] of points){
   const ray=new THREE.Raycaster(new THREE.Vector3(x!,y!+.1,z!),new THREE.Vector3(0,-1,0),0,.2);
   const hits=ray.intersectObject(scene,true).filter(h=>Math.abs(h.point.y-y!)<.001);
   expect(hits.length,`${variant} ${sector} at ${x},${z}`).toBe(1);
  }
 }
});

it('keeps the real Blender airbell pearls and tidewheel at their authored pivots after batching',async()=>{
 for(const id of ['atlantis_detail_airbell','atlantis_detail_tide_engine']){
  const file=readFileSync(`public/wildtag/models/${id}.glb`);
  const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');registerArtAsset(id,gltf.scene);
 }
 const props=[{kind:'airbell',x:10,y:5,z:3,s:1,yaw:0,sector:'fixture'},{kind:'airbell',x:-8,y:10,z:7,s:1,yaw:0,sector:'fixture'},{kind:'tide_engine',x:5,y:0,z:-3,s:1.6,yaw:0,sector:'fixture'}];
 const root=buildLandmark({...ATLANTIS_DEPTH,props,walls:[],towers:[],floors:[{...ATLANTIS_DEPTH.floors[0]!,sector:'fixture'}]});root.updateMatrixWorld(true);
 const pearls:THREE.Vector3[]=[];let rotor:THREE.Vector3|undefined;
 root.traverse(o=>{if(o.userData.part==='bellPearl')pearls.push(o.getWorldPosition(new THREE.Vector3()));if(o.userData.part==='tideRotor')rotor=o.getWorldPosition(new THREE.Vector3());if(o instanceof THREE.Mesh)expect(isSharedArtMaterial(o.material as THREE.Material)).toBe(true);});
 expect(pearls.map(v=>v.toArray())).toEqual([[10,6,3],[-8,11,7]]);expect(rotor?.toArray()).toEqual([5,4,-3]);
 const meshes:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
 expect(meshes.length).toBeLessThan(12); // Two bells share a stationary shell batch.
});

it('exports solid Atlantis foundations and observatory supports down to the seabed',async()=>{
 for(const [sector,z,y,edge] of [['hall',12,.3,-17],['observatory',52.5,6,-13]] as const){
  const file=readFileSync(`public/wildtag/models/atlantis_district_${sector}.glb`);
  const {scene}=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');scene.updateMatrixWorld(true);
  const hits=new THREE.Raycaster(new THREE.Vector3(-22,y,z),new THREE.Vector3(1,0,0),0,20).intersectObject(scene,true);
  expect(hits.length,`${sector} has a visible foundation`).toBeGreaterThan(0);
  expect(hits[0]!.point.x).toBeCloseTo(edge,1);
 }
});
