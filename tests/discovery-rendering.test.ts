import {afterEach,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {registerArtAsset} from '../src/art/library.ts';
import {CURIOSITIES} from '../src/discoveries/world.ts';
import {SmallWonders} from '../src/discoveries/wonders.ts';

afterEach(()=>vi.unstubAllGlobals());
const triangles=(root:THREE.Object3D)=>{let n=0;root.traverse(o=>{if(o instanceof THREE.Mesh)n+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;});return n;};
const meshes=(root:THREE.Object3D)=>{let n=0;root.traverse(o=>{if(o instanceof THREE.Mesh)n++;});return n;};

it('reduces actual Blender draw meshes without changing geometry, nested animation or saved interactions',async()=>{
 vi.stubGlobal('document',{createElement:()=>({style:{},textContent:''}),body:{append:()=>{}}});
 vi.stubGlobal('window',{setTimeout:()=>0});
 const source=new Map<string,{bounds:THREE.Box3;triangles:number;rigs:number;meshes:number}>();
 for(const p of CURIOSITIES){
  const file=readFileSync(`public/wildtag/models/discovery_${p.id}.glb`);
  const {scene}=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  let rigs=0;scene.traverse(o=>{if(o.userData.curioMotion)rigs++;});
  source.set(p.id,{bounds:new THREE.Box3().setFromObject(scene).translate(new THREE.Vector3(p.pos.x,p.pos.y,p.pos.z)),triangles:triangles(scene),rigs,meshes:meshes(scene)});
  registerArtAsset('discovery_'+p.id,scene);
 }
 const scene=new THREE.Scene(),toast=vi.fn(),wonders=new SmallWonders(scene,toast,()=>null);
 let savedMeshes=0;
 for(const p of CURIOSITIES){
  const root=scene.getObjectByName(p.name)!,before=source.get(p.id)!,bounds=new THREE.Box3().setFromObject(root);
  expect(triangles(root),p.id).toBe(before.triangles);
  expect(bounds.min.distanceTo(before.bounds.min),p.id).toBeLessThan(1e-4);
  expect(bounds.max.distanceTo(before.bounds.max),p.id).toBeLessThan(1e-4);
  expect(wonders.snapshot().rigs.find(r=>r.id===p.id)?.count,p.id).toBe(before.rigs);
  root.traverse(o=>{
   if(o instanceof THREE.Mesh){expect(o.matrixAutoUpdate).toBe(false);for(let parent=o.parent;parent&&parent!==root;parent=parent.parent)if(parent.userData.curioMotion){expect(o.castShadow).toBe(false);expect(o.userData.noShadow).toBe(true);}}
   if(o.userData.curioMotion==='flap')expect(o.parent?.parent).not.toBeNull();
  });
  savedMeshes+=before.meshes-meshes(root);
 }
 expect(savedMeshes).toBeGreaterThan(15);
 const p=CURIOSITIES.find(p=>p.id==='woodpecker')!,camera=new THREE.PerspectiveCamera();
 camera.position.set(p.approach.x,p.approach.y+1.65,p.approach.z);camera.lookAt(p.focus.x,p.focus.y,p.focus.z);camera.updateMatrixWorld(true);
 const root=scene.getObjectByName(p.name)!;
 let wing:THREE.Object3D|undefined;root.traverse(o=>{if(o.userData.curioMotion==='flap')wing=o;});
 wonders.update(.1,10,camera,false);scene.updateMatrixWorld(true);const pose=wing!.getWorldQuaternion(new THREE.Quaternion());
 expect(wonders.interact(camera)).toBe('remembered');expect(wonders.interact(camera)).toBe('handled');expect(toast).toHaveBeenCalledTimes(1);
 wonders.update(.1,11.5,camera,false);scene.updateMatrixWorld(true);expect(wing!.getWorldQuaternion(new THREE.Quaternion()).angleTo(pose)).toBeGreaterThan(.01);
 expect(wonders.interact(camera)).toBe('handled');expect(wonders.visited).toEqual(['woodpecker']);
 camera.position.set(0,1000,0);wonders.update(.1,12,camera,false);expect(scene.children).toHaveLength(0);
 camera.position.set(p.approach.x,p.approach.y+1.65,p.approach.z);wonders.update(.1,13,camera,false);expect(root.parent).toBe(scene);
 wonders.restore(['woodpecker']);expect(wonders.interact(camera)).toBe('handled');
});
