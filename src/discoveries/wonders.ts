import * as THREE from 'three';
import {cloneArtAsset} from '../art/library.ts';
import {mergeStaticMeshes} from '../art/merge-static.ts';
import {blip} from '../ui/audio.ts';
import {CURIOSITIES,nearbyCuriosity,restoreCuriosities,type Curiosity} from './world.ts';
import type {Vec3} from '../core/types.ts';

interface Rig {object:THREE.Object3D;motion:string;position:THREE.Vector3;rotation:THREE.Euler;scale:THREE.Vector3;phase:number;speed:number;amplitude:number}
interface Wonder {data:Curiosity;root:THREE.Group;rigs:Rig[];activeUntil:number;lastUsed:number}
const NOTES:Record<string,number[]>={meadow:[523,659,784],forest:[392,587,698],wetland:[294,349,440,523],crags:[220,330,440],highlands:[440,554,659],coast:[330,440,523],castle:[392,494,587],atlantis:[130.81,196,261.63],sky:[659,784,988]};

/** Optional scenes: permanent memories, repeatable reactions, no resource farming
 * or quest gates. Distant rigs and hidden-tab audio do no work. */
export class SmallWonders {
 visited:string[]=[];
 private readonly memories=new Set<string>();
 private readonly entries:Wonder[]=[];
 private readonly hint=document.createElement('div');
 private readonly direction=new THREE.Vector3();
 private nearby:Curiosity|null=null;
 private nextScan=0;
 private time=0;
 private presentationEnabled=true;
 constructor(private readonly scene:THREE.Scene,private readonly toast:(s:string)=>void,private readonly raycast:(a:Vec3,b:Vec3)=>Vec3|null,enabled=true){
  this.hint.id='curiosity-prompt';this.hint.style.cssText='display:none;position:fixed;top:60%;left:50%;transform:translateX(-50%);max-width:min(390px,85vw);padding:9px 15px;border:1px solid #c4cfad70;border-radius:10px;background:#172f32e8;color:#f7edd8;text-align:center;font:13px/1.5 system-ui;pointer-events:none;z-index:5';document.body.append(this.hint);
  this.presentationEnabled=enabled;
  for(const data of enabled?CURIOSITIES:[]){
   const root=cloneArtAsset('discovery_'+data.id);root.name=data.name;root.position.set(data.pos.x,data.pos.y,data.pos.z);scene.add(root);
   const rigs:Rig[]=[];
   root.traverse(o=>{if(o.userData.curioMotion){rigs.push({object:o,motion:o.userData.curioMotion,position:o.position.clone(),rotation:o.rotation.clone(),scale:o.scale.clone(),phase:Number(o.userData.phase??0),speed:Number(o.userData.speed??1),amplitude:Number(o.userData.amplitude??.15)});if(o.userData.curioMotion==='steam'||o.userData.curioMotion==='reveal')o.visible=false;}
    if(o instanceof THREE.Mesh){for(let p:THREE.Object3D|null=o;p&&p!==root;p=p.parent)if(p.userData.curioMotion){o.castShadow=false;o.userData.noShadow=true;break;}}
   });
   mergeStaticMeshes(root,m=>{for(let p:THREE.Object3D|null=m;p&&p!==root;p=p.parent)if(p.userData.curioMotion)return false;return true;});
   // Collapse matching materials within a moving pivot as well. Nested wings,
   // hinges and orbiters keep their own transforms and remain independent.
   for(const r of rigs)mergeStaticMeshes(r.object as THREE.Group,m=>{
    for(let p=m.parent;p&&p!==r.object;p=p.parent)if(p.userData.curioMotion)return false;
    return true;
   });
   root.traverse(o=>{if(o instanceof THREE.Mesh&&!o.castShadow)o.userData.noShadow=true;});
   // Mesh-local transforms never change; only the authored motion pivots do.
   root.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=!!o.userData.curioMotion;});
   this.entries.push({data,root,rigs,activeUntil:-Infinity,lastUsed:-Infinity});
  }
 }
 /** Dev comparison hook: leave the same world, collision and clearings in place. */
 setPresentationEnabled(enabled:boolean):void {
  this.presentationEnabled=enabled;this.nextScan=0;
  for(const e of this.entries)if(enabled&&e.root.visible)this.scene.add(e.root);else e.root.removeFromParent();
 }
 restore(raw:unknown):void {this.visited=restoreCuriosities(raw);this.memories.clear();for(const id of this.visited)this.memories.add(id);}
 private showHint(data:Curiosity|null):void {
  if(this.nearby?.id===data?.id)return;
  this.nearby=data;this.hint.style.display=data?'block':'none';
  if(data)this.hint.textContent=`${data.name} · F — ${data.action}`;
 }
 interact(camera:THREE.Camera):false|'remembered'|'handled' {
  if(!this.presentationEnabled)return false;
  camera.getWorldDirection(this.direction);
  const data=nearbyCuriosity(camera.position,this.direction,this.raycast);if(!data)return false;
  const e=this.entries.find(e=>e.data.id===data.id)!;
  if(this.time-e.lastUsed<1.2)return 'handled';
  e.lastUsed=this.time;e.activeUntil=this.time+6;
  const first=!this.memories.has(data.id);if(first){this.memories.add(data.id);this.visited.push(data.id);}
  this.toast(`${data.name}${first?' · Remembered':''}. ${data.story}`);
  (NOTES[data.region]??NOTES.meadow!).forEach((frequency,i)=>window.setTimeout(()=>{
   if(document.hidden||!document.pointerLockElement||Math.hypot(camera.position.x-data.pos.x,camera.position.y-data.pos.y,camera.position.z-data.pos.z)>12)return;
   blip(frequency,data.region==='atlantis'?.65:.35,data.region==='atlantis'?.035:.025);
  },i*160));
  this.nextScan=0;return first?'remembered':'handled';
 }
 update(dt:number,time:number,camera:THREE.Camera,hidden:boolean):void {
  this.time=time;const p=camera.position;
  if(!this.presentationEnabled){this.showHint(null);return;}
  this.nextScan-=dt;
  if(this.nextScan<=0){
   this.nextScan=.15;camera.getWorldDirection(this.direction);
   this.showHint(hidden?null:nearbyCuriosity(p,this.direction,this.raycast));
  }
  if(hidden)this.showHint(null);
  for(const e of this.entries){
   const distance=p.distanceToSquared(e.root.position);e.root.visible=distance<190**2;
   // Invisible Object3Ds still update their descendant world matrices.
   // Detach distant scenes so neither render nor shadow passes traverse them.
   if(!e.root.visible){e.root.removeFromParent();continue;}
   if(!e.root.parent)this.scene.add(e.root);
   if(distance>65**2||hidden)continue;
   const remembered=this.memories.has(e.data.id),energy=Math.max(0,Math.min(1,(e.activeUntil-time)/2));
   for(const r of e.rigs){
    const o=r.object,t=time*r.speed+r.phase,wave=Math.sin(t),motion=remembered?.28:.08;
    o.position.copy(r.position);o.rotation.copy(r.rotation);o.scale.copy(r.scale);
    switch(r.motion){
     case 'spin':o.rotation.y+=t+energy*Math.sin(time*2)*.7;break;
     case 'wheel':o.rotation.z+=t*(remembered?1:.14)+Math.sin(time*2)*energy*.8;break;
     case 'orbit':o.rotation.y+=t+energy*Math.sin(time)*.5;break;
     case 'bob':o.position.y+=wave*r.amplitude*(1+energy*1.8);break;
     case 'flap':o.rotation.z+=Math.sin(time*5+r.phase)*r.amplitude*(.15+energy);break;
     case 'sway':case 'cloth':o.rotation.z+=wave*r.amplitude*(.35+energy);break;
     case 'peck':o.rotation.x+=Math.max(0,Math.sin(time*3))*r.amplitude*(motion+energy);break;
     case 'key':o.position.y-=Math.max(0,Math.sin(time*8+r.phase))*r.amplitude*energy;break;
     case 'pulse':o.scale.multiplyScalar(1+wave*r.amplitude*(motion+energy));break;
     case 'bloom':o.scale.multiplyScalar((remembered?.9:.4)+wave*.04+energy*.1);break;
     case 'hinge':o.rotation.x+=(remembered?-.35:0)-energy*r.amplitude;break;
     case 'cart':o.position.z+=Math.sin(time*1.7)*r.amplitude*energy;break;
     case 'steam':o.visible=remembered||energy>0;o.position.y+=((time*.3+r.phase/7)%1)*.7;o.position.x+=wave*.06;o.scale.multiplyScalar(.6+wave*.15+energy*.3);break;
     case 'reveal':o.visible=remembered||energy>0;o.position.y+=wave*r.amplitude;o.rotation.y+=time*.25;break;
    }
   }
  }
 }
 snapshot(){return {enabled:this.presentationEnabled,visited:[...this.visited],nearby:this.nearby?.id??null,visible:this.entries.filter(e=>e.root.parent&&e.root.visible).map(e=>e.data.id),active:this.entries.filter(e=>e.activeUntil>this.time).map(e=>e.data.id),rigs:this.entries.map(e=>({id:e.data.id,count:e.rigs.length}))};}
}
