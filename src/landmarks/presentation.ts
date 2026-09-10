import * as THREE from 'three';
import { cloneArtAsset, hasArtAsset } from '../art/library.ts';
import { mergeStaticMeshes } from '../art/merge-static.ts';
import { partitionStaticMesh } from '../art/spatial-batches.ts';
import type { LandmarkLayout } from './architecture.ts';

/** Culling stays local to each district. Both castle dressings use identical geometry. */
export function buildLandmark(layout:LandmarkLayout,purified=false):THREE.Group {
  const root=new THREE.Group();root.name=layout.id==='castle'?'castle':'atlantis';
  const hasShadow=hasArtAsset(layout.id+'_shadow');
  const variant=layout.id==='castle'?(purified?'_purified':'_cursed'):'';
  const sectors=new Set([...layout.floors.map(f=>f.sector),...layout.walls.map(w=>w.sector),...layout.towers.map(t=>t.sector)]);
  for(const sector of sectors){
    const district=new THREE.Group();district.name=layout.id+' '+sector;
    district.add(cloneArtAsset(`${layout.id}_district_${sector}${variant}`));root.add(district);
    const stationary=new THREE.Group();stationary.name=sector+' furnishings';district.add(stationary);
    for(const p of layout.props.filter(p=>p.sector===sector)){
      const prop=cloneArtAsset(`${layout.id}_detail_${p.kind}${variant}`);prop.position.set(p.x,p.y,p.z);prop.rotation.y=p.yaw;prop.scale.setScalar(p.s);
      if(p.kind==='tide_engine'||p.kind==='airbell'){
        // Only the rotor/pearl moves. Bell shells and engine frames join the
        // district's stationary batch along with the other furnishings.
        const moving:THREE.Object3D[]=[];prop.traverse(o=>{if(o.userData.part)moving.push(o);});
        stationary.add(prop);root.updateMatrixWorld(true);
        for(const rig of moving){district.attach(rig);rig.userData.landmarkBaseY=rig.position.y;}
      }else stationary.add(prop);
    }
    mergeStaticMeshes(district,m=>{for(let p:THREE.Object3D|null=m;p&&p!==district;p=p.parent)if(p.userData.part)return false;return true;});
    const meshes:THREE.Mesh[]=[];district.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
    for(const mesh of meshes){
      let moving=false;for(let p:THREE.Object3D|null=mesh;p&&p!==district;p=p.parent)if(p.userData.part)moving=true;
      if(hasShadow&&!moving){mesh.castShadow=false;mesh.userData.noShadow=true;}
      partitionStaticMesh(mesh);
    }
  }
  if(hasShadow){
    const proxy=cloneArtAsset(layout.id+'_shadow');proxy.name=layout.id+' shadow silhouette';root.add(proxy);
    proxy.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
      o.material=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false});o.receiveShadow=false;o.castShadow=true;
      // Shadow passes use onBeforeShadow, whereas beauty and AO call these
      // render hooks. Suppress the proxy's draw there without affecting its
      // shadow visibility or changing any shared source geometry.
      const {start,count}=o.geometry.drawRange;
      o.onBeforeRender=()=>o.geometry.setDrawRange(0,0);
      o.onAfterRender=()=>o.geometry.setDrawRange(start,count);
    });
  }
  return root;
}
