import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadSurfaceMaps } from './surfaces.ts';

const meshes=new Map<string,THREE.Mesh[]>();
const assets=new Map<string,THREE.Group>();
export const artStats={loaded:0,lodsLoaded:0,failed:[] as string[],replaced:0};
/** All shipping art is local. Constructors retain their animation/collision handles. */
export async function loadArtLibrary():Promise<void>{
  const base=`${import.meta.env.BASE_URL}wildtag/`;
  const loading=document.createElement('div');loading.style.cssText='position:fixed;inset:0;z-index:100;background:#18362f;color:#e8e3be;display:grid;place-content:center;gap:12px;font:16px system-ui;text-align:center';
  loading.textContent='WILDTAG · Preparing the island…';document.body.append(loading);
  await loadSurfaceMaps(base);
  const manifest=await fetch(`${base}asset-manifest.json`).then(r=>{if(!r.ok)throw Error('Wildtag art manifest unavailable');return r.json();}) as {assets:{id:string;lods?:{level:number;path:string}[]}[]};
  const loader=new GLTFLoader();
  // Limit simultaneous decoding and requests to keep boot memory bounded.
  const queue=manifest.assets.flatMap(a=>[
    {id:a.id,path:`models/${a.id}.glb`,lod:false},
    ...(a.lods??[]).map(l=>({id:`${a.id}_lod${l.level}`,path:l.path,lod:true})),
  ]);
  const total=queue.length;
  await Promise.all(Array.from({length:6},async()=>{while(queue.length){const item=queue.shift()!;try{
    const gltf=await loader.loadAsync(`${base}${item.path}`);
    assets.set(item.id,gltf.scene);
    const parts:THREE.Mesh[]=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)parts.push(o);});
    parts.sort((a,b)=>Number(a.name.match(/part_(\d+)/)?.[1]??0)-Number(b.name.match(/part_(\d+)/)?.[1]??0));
    meshes.set(item.id,parts);if(item.lod)artStats.lodsLoaded++;else artStats.loaded++;loading.textContent=`WILDTAG · Preparing the island ${Math.round(100*(artStats.loaded+artStats.lodsLoaded)/total)}%`;
  }catch(error){artStats.failed.push(item.id);console.error(`Art failed: ${item.id}`,error);}}}));
  if(artStats.failed.length){loading.textContent='Some Wildtag art could not load. Please reload to try again.';throw Error(`Unable to load ${artStats.failed.length} Wildtag art assets`);}
  loading.remove();
}
/** Mesh-local coordinates and original pivots are preserved through Blender. */
export function refineArt(root:THREE.Object3D,id:string):void{
  const parts=meshes.get(id);if(!parts)return;let index=0;
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const source=parts[index++];if(!source)return;
    o.geometry.dispose();o.geometry=source.geometry.clone();
    // Keep per-instance gameplay materials (emissive identities, fade, state colors).
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats)if('flatShading' in mat && mat.flatShading){mat.flatShading=false;mat.needsUpdate=true;}
    artStats.replaced++;
  });
  root.userData.blenderAsset=id;
}
export function artGeometry(id:string):THREE.BufferGeometry|undefined{return meshes.get(id)?.[0]?.geometry.clone();}
export function cloneArtAsset(id:string):THREE.Group{
  const original=assets.get(id);if(!original)return new THREE.Group();
  const clone=original.clone(true);clone.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry=o.geometry.clone();o.castShadow=true;o.receiveShadow=true;}});return clone;
}
