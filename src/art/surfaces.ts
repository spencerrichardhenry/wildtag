import * as THREE from 'three';
let ground:THREE.Texture|undefined;
let water:THREE.Texture|undefined;
export async function loadSurfaceMaps(base:string):Promise<void>{
  const loader=new THREE.TextureLoader();
  const textures=await Promise.all(['ground_grain','water_normal'].map(name=>loader.loadAsync(`${base}textures/${name}.png`)));
  for(const texture of textures){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;}
  ground=textures[0]!;water=textures[1]!;water.repeat.set(110,110);
}
export function waterNormalMap():THREE.Texture|undefined{return water;}
export function applyGroundArt(material:THREE.Material):void{
  if(!ground)return;
  const previous=material.onBeforeCompile.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);shader.uniforms.wtGroundGrain={value:ground};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 wtArtXZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nwtArtXZ = (modelMatrix * vec4(position,1.0)).xz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D wtGroundGrain;\nvarying vec2 wtArtXZ;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb *= 0.88 + 0.16 * texture2D(wtGroundGrain, wtArtXZ / 7.0).r;');
  };
  material.customProgramCacheKey=()=> 'wildtag-blender-ground-v1';
}
