import * as THREE from 'three';

/** Keep the exact Blender triangles, but bound large static meshes in small
 * patches so the view and the two shadow cameras can cull them independently.
 * Attributes stay shared; each patch only owns its index and bounds. */
export function partitionStaticMesh(mesh:THREE.Mesh,size=32):THREE.Group|null {
  const g=mesh.geometry,p=g.getAttribute('position'),index=g.index;
  if(!index||index.count<30000||Array.isArray(mesh.material))return null;
  g.computeBoundingBox();const extent=g.boundingBox!.getSize(new THREE.Vector3());
  if(Math.max(extent.x,extent.z)<size*2)return null;
  const bins=new Map<string,number[]>();
  for(let i=0;i<index.count;i+=3){
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
    const x=Math.floor((p.getX(a)+p.getX(b)+p.getX(c))/(3*size)),z=Math.floor((p.getZ(a)+p.getZ(b)+p.getZ(c))/(3*size));
    const key=`${x},${z}`;let bin=bins.get(key);if(!bin)bins.set(key,bin=[]);bin.push(a,b,c);
  }
  if(bins.size<2)return null;
  const group=new THREE.Group();group.name=mesh.name+' patches';group.position.copy(mesh.position);group.quaternion.copy(mesh.quaternion);group.scale.copy(mesh.scale);
  const v=new THREE.Vector3();
  for(const [key,indices] of bins){
    const part=new THREE.BufferGeometry();for(const name of Object.keys(g.attributes))part.setAttribute(name,g.getAttribute(name));part.setIndex(indices);
    const bounds=new THREE.Box3();for(const i of indices)bounds.expandByPoint(v.fromBufferAttribute(p,i));
    part.boundingBox=bounds;part.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());
    const patch=new THREE.Mesh(part,mesh.material);patch.name=mesh.name+' '+key;patch.castShadow=mesh.castShadow;patch.receiveShadow=mesh.receiveShadow;patch.userData={...mesh.userData};group.add(patch);
  }
  mesh.parent?.add(group);mesh.removeFromParent();g.dispose();return group;
}
