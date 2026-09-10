import {expect,it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {CURIOSITIES,curiosityArchitecture,curiosityRaycast,nearbyCuriosity,reservedForCuriosity,restoreCuriosities,curiosityFloorBelow} from '../src/discoveries/world.ts';
import {biomeAt,heightAt} from '../src/world/terrain.ts';
import {initialMoveState} from '../src/player/movement.ts';
import {landmarkRaycast} from '../src/landmarks/world.ts';
import {raycastSky} from '../src/sky/collision.ts';
import {resourceDeposits} from '../src/logistics/layout.ts';

it('places two distinct discoveries in every region, away from extraction nodes',()=>{
 expect(CURIOSITIES).toHaveLength(18);expect(new Set(CURIOSITIES.map(p=>p.id)).size).toBe(18);
 const regions=new Map<string,number>();
 for(const p of CURIOSITIES){
  regions.set(p.region,(regions.get(p.region)??0)+1);
  if(['meadow','forest','wetland','crags','highlands'].includes(p.region))expect(biomeAt(p.pos.x,p.pos.z)).toBe(p.region);
  for(const d of resourceDeposits())expect(Math.hypot(p.pos.x-d.pos.x,p.pos.z-d.pos.z)).toBeGreaterThan(18);
  if(p.region==='atlantis')expect(Math.abs(p.pos.y-heightAt(p.pos.x,p.pos.z))).toBeLessThan(.01);
 }
 expect([...regions.values()]).toEqual(Array(9).fill(2));
});

it('offers every interaction from its walk-up point with no architecture in the way',()=>{
 for(const p of CURIOSITIES){
  const eye={...p.approach,y:p.approach.y+1.65},d=new THREE.Vector3(p.focus.x-eye.x,p.focus.y-eye.y,p.focus.z-eye.z).normalize();
  const blocked=(a:typeof eye,b:typeof eye)=>curiosityRaycast(a,b)??landmarkRaycast(a,b)??raycastSky(a,b);
  expect(nearbyCuriosity(eye,d,blocked)?.id,p.id).toBe(p.id);
  expect(nearbyCuriosity(eye,d.clone().negate(),blocked)).toBeNull();
  expect(nearbyCuriosity({...eye,y:eye.y-10},d,blocked)).toBeNull();
  expect(nearbyCuriosity(eye,d,()=>eye)).toBeNull();
 }
});

it('leaves Rootlight Hollow walkable and supports the crag and coast approaches',()=>{
 const hollow=curiosityArchitecture.find(a=>a.layout.id==='rootlight')!,c=hollow.layout.center;
 const a={x:c.x,y:c.y+.15,z:c.z+3},b={x:c.x,y:c.y+.15,z:c.z-3};
 expect(hollow.resolve(a,{...initialMoveState(a),pos:b},.4).pos).toEqual(b);
 for(const p of CURIOSITIES.filter(p=>p.floors.length)){
  expect(curiosityFloorBelow(p.pos.x,p.pos.z,p.pos.y+.1)).toBeCloseTo(p.pos.y);
  expect(p.pos.y-p.floors[0]!.thickness).toBeLessThan(heightAt(p.pos.x,p.pos.z));
  expect(curiosityFloorBelow(p.approach.x,p.approach.z,Math.max(p.pos.y,p.approach.y)+.1)).toBeCloseTo(p.approach.y,3);
 }
});

it('sanitizes remembered visits and keeps sky clearings off the terrain below',()=>{
 expect(restoreCuriosities(['bumblepost','bumblepost','unknown',false,'glassfin'])).toEqual(['bumblepost','glassfin']);
 expect(restoreCuriosities(null)).toEqual([]);
 for(const p of CURIOSITIES){
  expect(reservedForCuriosity(p.pos.x,p.pos.y,p.pos.z)).toBe(true);
  expect(reservedForCuriosity(p.pos.x,p.pos.y,p.pos.z+p.radius+.1)).toBe(false);
 }
 const s=CURIOSITIES.find(p=>p.region==='sky')!;expect(reservedForCuriosity(s.pos.x,heightAt(s.pos.x,s.pos.z),s.pos.z)).toBe(false);
});

it('ships an independently animated Blender scene for every discovery within the total geometry budget',async()=>{
 let triangles=0;
 for(const p of CURIOSITIES){
  const file=readFileSync(`public/wildtag/models/discovery_${p.id}.glb`);
  const {scene}=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  let rigs=0;scene.traverse(o=>{if(o.userData.curioMotion)rigs++;if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;});
  expect(rigs,p.id).toBeGreaterThan(0);scene.updateMatrixWorld(true);
  const size=new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  expect(size.y,p.id).toBeGreaterThan(1.5);expect(size.x,p.id).toBeLessThan(10);expect(size.z,p.id).toBeLessThan(12);
 }
 expect(triangles).toBeLessThan(100000);
});
