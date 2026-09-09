import * as THREE from 'three';
import { buildCritterModel, type CritterParts } from '../critters/models.ts';
import { animateCritter } from '../critters/animation.ts';
import { mulberry32 } from '../core/rng.ts';
import type { Roster } from '../critters/roster.ts';
import { cloneArtAsset } from '../art/library.ts';
import { DEPOT } from './layout.ts';
import { DEPOSITS, routePoint, type Deposit, type EconomyState } from './economy.ts';

export class LogisticsVisuals {
  readonly root=new THREE.Group();
  private sites=new Map<string,{deposit:THREE.Group;station:THREE.Group;lamp:THREE.Mesh}>();
  private workers=new Map<string,{id:number;root:THREE.Group;parts:CritterParts;cart:THREE.Group;load:THREE.Object3D;wheels:THREE.Object3D[]}>();
  constructor(scene:THREE.Scene,private deposits:Deposit[]){
    this.root.name='Haven supply network';scene.add(this.root);
    const depot=cloneArtAsset('logistics_depot');depot.position.copy(DEPOT);this.root.add(depot);
    this.label('HAVEN DEPOT  ·  N / SUPPLY ROUTES',DEPOT.x,DEPOT.y+3.8,DEPOT.z);
    for(const d of deposits){
      const deposit=cloneArtAsset(`deposit_${d.kind}`);deposit.position.copy(d.pos);this.root.add(deposit);
      const station=cloneArtAsset(`extractor_${d.kind}`);station.position.set(d.pos.x+2.3,d.pos.y,d.pos.z);this.root.add(station);
      const lamp=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),new THREE.MeshBasicMaterial({color:DEPOSITS[d.kind].color}));lamp.position.set(d.pos.x,d.pos.y+3.4,d.pos.z);this.root.add(lamp);
      this.sites.set(d.id,{deposit,station,lamp});
      this.label(`${DEPOSITS[d.kind].name.toUpperCase()}  ·  F`,d.pos.x,d.pos.y+4,d.pos.z);
      // Low-profile route markers on reserved trails; color matches the deposit.
      const points=d.route.map(p=>new THREE.Vector3(p.x,p.y+.05,p.z));
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:DEPOSITS[d.kind].color,transparent:true,opacity:.32}));this.root.add(line);
      for(let i=8;i<d.route.length;i+=12){const p=d.route[i]!;const marker=cloneArtAsset('trail_marker');marker.position.set(p.x+1.4,p.y,p.z);this.root.add(marker);}
    }
  }
  private label(value:string,x:number,y:number,z:number){
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=72;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#17342ddd';ctx.roundRect(0,0,768,72,14);ctx.fill();ctx.fillStyle='#e7e8c3';ctx.font='bold 24px system-ui';ctx.textAlign='center';ctx.fillText(value,384,45);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));sprite.scale.set(6.4,.6,1);sprite.position.set(x,y,z);this.root.add(sprite);
  }
  obstacles(state:EconomyState){
    return [
      {x:DEPOT.x,z:DEPOT.z,r:2.25,yTop:DEPOT.y+3.1},
      ...this.deposits.map(d=>({x:d.pos.x,z:d.pos.z,r:1.35,yTop:d.pos.y+2})),
      ...this.deposits.filter(d=>state.sites.find(s=>s.id===d.id)?.built).map(d=>({x:d.pos.x+2.3,z:d.pos.z,r:.95,yTop:d.pos.y+2.2})),
    ];
  }
  update(state:EconomyState,roster:Roster,time:number,dt:number){
    for(const s of state.sites){
      const visual=this.sites.get(s.id)!;visual.station.visible=s.built;
      visual.deposit.scale.setScalar(s.cooldown>0?.94:1);visual.lamp.visible=s.surveyed;
      const old=this.workers.get(s.id);const entry=roster.find(e=>e.id===s.worker);
      if(old&&old.id!==entry?.id){this.root.remove(old.root);old.root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});this.workers.delete(s.id);}
      if(!entry)continue;
      let worker=this.workers.get(s.id);
      if(!worker){
        const model=buildCritterModel(entry.speciesId,mulberry32(entry.id));const root=new THREE.Group();root.add(model.group);
        const box=new THREE.Box3().setFromObject(model.group);const scale=Math.min(1,1.8/Math.max(.1,box.getSize(new THREE.Vector3()).y));model.group.scale.multiplyScalar(scale);
        const cart=cloneArtAsset('creature_cart');cart.position.z=-2;root.add(cart);
        const load=cloneArtAsset('cargo_bundle');load.position.set(0,.8,-2);root.add(load);
        worker={id:entry.id,root,parts:model.parts,cart,load,wheels:[]};this.root.add(root);this.workers.set(s.id,worker);
      }
      const d=this.deposits.find(d=>d.id===s.id)!;const point=routePoint(d.route,s.distance);
      worker.root.position.copy(point.pos);worker.root.rotation.y=point.yaw+(s.phase==='homebound'?Math.PI:0);
      worker.load.visible=s.cargo>0;worker.cart.rotation.x=Math.sin(time*6)*.012;
      animateCritter(worker.parts,s.phase==='loading'||s.blocked?0:3,time,dt,entry.speciesId);
    }
  }
}
