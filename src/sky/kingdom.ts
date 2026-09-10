import { SkySound } from './sound.ts';
import * as THREE from 'three';
import { cloneArtAsset } from '../art/library.ts';
import { mergeStaticMeshes } from '../art/merge-static.ts';
import { MOVE, STRUCTURES } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { PlayerController } from '../player/controller.ts';
import { bounceLaunchVelocity } from '../structures/trampolines.ts';
import type { AnchorRegistry } from '../structures/anchors.ts';
import { heightAt } from '../world/terrain.ts';
import { blip } from '../ui/audio.ts';
import { SKY, SKY_CENTER, inSkyBounds, skyZone } from './layout.ts';
import { createSkyProgress, restoreSkyProgress, nearbySkyPoint, SKY_CHIMES, SKY_GLASS, type SkyProgress } from './progress.ts';

export class SkyKingdom {
  readonly city=new THREE.Group();
  readonly approach=new THREE.Group();
  progress:SkyProgress=createSkyProgress();
  private readonly guide=document.createElement('div');
  private readonly title=document.createElement('div');
  private readonly detail=document.createElement('div');
  private guideTime=0;
  private readonly sound=new SkySound();
  private journey:'ground'|'drone'|'grapple'|'arrived'='ground';
  private launchWindow=0;
  private readonly rotors:THREE.Object3D[]=[];
  private readonly membranes=new Map<string,THREE.Object3D>();
  private readonly bounceAge={ground:100,drone:100};
  private bouncedGround=0;
  private bouncedDrone=0;
  private readonly chimeModels:THREE.Group[]=[];
  private readonly glassModels:THREE.Group[]=[];
  private readonly labels:THREE.Sprite[]=[];
  private readonly beacon:THREE.Group;

  constructor(scene:THREE.Scene,anchors:AnchorRegistry,private readonly toast:(s:string)=>void){
    this.city.name='Sky Kingdom';this.city.position.set(SKY_CENTER.x,SKY_CENTER.y,SKY_CENTER.z);scene.add(this.city,this.approach);
    for(const sector of new Set(SKY.floors.map(f=>f.sector)))this.city.add(cloneArtAsset(`sky_sector_${sector}`));
    const decorations=new THREE.Group();this.city.add(decorations);
    for(const p of SKY.props){
      const asset=cloneArtAsset(`sky_${p.kind}`);asset.position.set(p.x,p.y,p.z);asset.scale.setScalar(p.s);asset.rotation.y=p.yaw;
      if(p.kind==='chime'){this.city.add(asset);this.chimeModels.push(asset);}
      else if(p.kind==='skyglass'){this.city.add(asset);this.glassModels.push(asset);}
      else decorations.add(asset);
    }
    mergeStaticMeshes(decorations,()=>true);
    for(const [kind,p] of [['launch_pad',SKY.launch.ground],['drone_pad',SKY.launch.drone]] as const){const asset=cloneArtAsset(`sky_${kind}`);asset.position.set(p.x,p.y,p.z);asset.traverse(o=>{if(o.userData.part==='rotor')this.rotors.push(o);if(o.userData.part==='membrane')this.membranes.set(kind==='launch_pad'?'ground':'drone',o);});this.approach.add(asset);}
    this.beacon=cloneArtAsset('sky_anchor');this.beacon.position.set(SKY.launch.anchor.x,SKY.launch.anchor.y,SKY.launch.anchor.z);scene.add(this.beacon);
    anchors.registerAnchor('sky-gate',()=>({...SKY.launch.anchor}),3.8);
    this.addLabel('SKY KINGDOM  ↗\nJump • drone bounce • midair grapple',SKY.launch.ground.x,SKY.launch.ground.y+4.5,SKY.launch.ground.z+3.8,6.8);
    this.addLabel('DRONE TRAMPOLINE\nBounce, then aim for the gold halo',SKY.launch.drone.x,SKY.launch.drone.y-3.6,SKY.launch.drone.z,6.8);
    this.addLabel('RMB · GRAPPLE',SKY.launch.anchor.x,SKY.launch.anchor.y+4.9,SKY.launch.anchor.z,7);
    // Lantern trail begins at Haven's eastern edge and leads to the lower pad.
    for(let i=0;i<7;i++){
      const t=i/7,x=72+(SKY.launch.ground.x-72)*t,z=-52+(SKY.launch.ground.z+52)*t;
      const marker=cloneArtAsset('sky_lantern');marker.position.set(x+2.2,heightAt(x+2.2,z),z);marker.scale.setScalar(.65);this.approach.add(marker);
    }
    this.addLabel('SKY KINGDOM\nFollow the lanterns ↗',72,heightAt(72,-52)+3,-52,5.5);
    Object.assign(this.guide.style,{position:'fixed',left:'18px',top:'160px',maxWidth:'310px',padding:'12px 15px',borderLeft:'2px solid #dac286',borderRadius:'0 9px 9px 0',background:'linear-gradient(90deg,rgba(25,51,62,.87),rgba(25,51,62,.60))',color:'#f4ecd4',font:'13px/1.5 system-ui',pointerEvents:'none',zIndex:'4',display:'none'});
    this.guide.id='sky-guide';this.title.style.cssText='font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#e6ce94;margin-bottom:5px';
    this.guide.append(this.title,this.detail);document.body.append(this.guide);
  }
  private addLabel(text:string,x:number,y:number,z:number,width:number):void {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=160;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='rgba(29,53,62,.9)';ctx.beginPath();ctx.roundRect(3,3,762,154,18);ctx.fill();ctx.strokeStyle='#c8b17a';ctx.lineWidth=3;ctx.stroke();
    const lines=text.split('\n');ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>{ctx.font=i===0?'bold 30px system-ui':'25px system-ui';ctx.fillStyle=i===0?'#f4e9bf':'#e1e8de';ctx.fillText(line,384,lines.length===1?80:55+i*53,738);});
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthWrite:false,transparent:true}));sprite.position.set(x,y,z);sprite.scale.set(width,width*160/768,1);this.approach.add(sprite);this.labels.push(sprite);
  }
  restore(raw:unknown):void {this.progress=restoreSkyProgress(raw);}
  snapshot(){return {progress:structuredClone(this.progress),journey:this.journey,bounces:{ground:this.bouncedGround,drone:this.bouncedDrone},launch:SKY.launch,chimes:SKY_CHIMES,glass:SKY_GLASS,zones:SKY.zones};}
  step(dt:number,previous:Vec3,player:PlayerController,inventory:Inventory):void {
    this.bounceAge.ground+=dt;this.bounceAge.drone+=dt;
    const pos=player.pos;this.launchWindow=Math.max(0,this.launchWindow-dt);
    for(let i=0;i<3;i++)this.progress.glassCooldowns[i]=Math.max(0,this.progress.glassCooldowns[i]!-dt);
    if(!player.mounted && player.vel.y<=0){
      for(const [kind,pad] of [['ground',SKY.launch.ground],['drone',SKY.launch.drone]] as const){
        if(Math.hypot(pos.x-pad.x,pos.z-pad.z)>2.55 || previous.y<pad.y-.12 || pos.y>pad.y+.12)continue;
        player.bounce(bounceLaunchVelocity(MOVE.gravity,STRUCTURES.trampolineBounceFactor*STRUCTURES.droneHover));
        this.bounceAge[kind]=0;
        if(kind==='ground'){this.bouncedGround++;this.journey='drone';}
        else {this.bouncedDrone++;this.journey='grapple';this.launchWindow=12;this.toast('Aim at the golden halo and tap RMB near the top of this bounce.');}
        blip(kind==='ground'?340:510,.12,.05);break;
      }
    }
    if(this.launchWindow>0 && player.grappleAnchorId==='sky-gate')this.progress.ascent=true;
    if(inSkyBounds(pos) && pos.y>=SKY_CENTER.y-.1 && player.grounded){
      this.journey='arrived';
      const zone=skyZone(pos);
      if(zone && !this.progress.discovered.includes(zone.id)){
        this.progress.discovered.push(zone.id);inventory.rp+=5;this.toast(`${zone.name} · +5 research. ${zone.story}`);blip(620,.12,.04);
      }
    }
    this.guideTime-=dt;
    if(this.guideTime<=0){this.guideTime=.2;this.refreshGuide(player);}
  }
  interact(player:PlayerController,inventory:Inventory):boolean {
    const pos=player.pos;
    const chime=nearbySkyPoint(pos,SKY_CHIMES);
    if(chime>=0){
      if(this.progress.chimes.includes(chime)){this.toast('This wind chime is already singing.');return true;}
      this.progress.chimes.push(chime);inventory.rp+=12;inventory.spark+=3;
      [520,650,780].forEach((f,i)=>window.setTimeout(()=>blip(f,.3,.055),i*110));
      this.toast(`Wind chime ${this.progress.chimes.length}/3 · +12 research, +3 sparks`);
      if(this.progress.chimes.length===3){inventory.shard+=12;inventory.spark+=8;this.toast('The kingdom sings again · +12 skyglass shards, +8 sparks.');}
      return true;
    }
    const glass=nearbySkyPoint(pos,SKY_GLASS);
    if(glass>=0){
      const wait=this.progress.glassCooldowns[glass]!;
      if(wait>0){this.toast(`Skyglass is regrowing · ${Math.ceil(wait)}s`);return true;}
      this.progress.glassCooldowns[glass]=45;inventory.shard+=3;inventory.spark+=1;this.toast('Skyglass gathered · +3 shards, +1 spark');blip(880,.1,.04);return true;
    }
    return false;
  }
  private refreshGuide(player:PlayerController):void {
    const pos=player.pos;const near=Math.hypot(pos.x-SKY.launch.ground.x,pos.z-SKY.launch.ground.z)<65;
    if(!near&&!inSkyBounds(pos)){this.guide.style.display='none';return;}
    this.guide.style.display='block';this.title.textContent=inSkyBounds(pos)?`Sky Kingdom · ${skyZone(pos)?.name??'Above the clouds'}`:'Sky Kingdom · The ascent';
    if(player.grappleAnchorId==='sky-gate'){this.title.textContent='Sky Kingdom · Final leap';this.detail.textContent='Turn toward the cloud landing, hold W, and tap Space to release the grapple.';return;}
    const chime=nearbySkyPoint(pos,SKY_CHIMES),glass=nearbySkyPoint(pos,SKY_GLASS);
    this.detail.textContent=chime>=0?this.progress.chimes.includes(chime)?'This chime is singing. Seek the other voices.':'F · Awaken this wind chime':glass>=0?this.progress.glassCooldowns[glass]!>0?`Skyglass regrowing · ${Math.ceil(this.progress.glassCooldowns[glass]!)}s`:'F · Gather skyglass':inSkyBounds(pos)?`${this.progress.chimes.length}/3 wind chimes • ${this.progress.discovered.length}/7 places discovered. Follow the lanterns through the market gallery, or climb from the eagle nests.`:!player.unlocks.has('grapple')?'Craft a Grapple in your inventory before attempting the ascent. The lantern trail starts east of Haven.':this.journey==='grapple'?'Aim UP at the golden halo. Tap RMB near the apex to latch, then Space to release over the landing.':this.journey==='drone'?'Drift northeast onto the drone trampoline. Land on its teal membrane for the second launch.':'Jump onto the lower trampoline. Drift northeast onto the drone trampoline, then catch the high gold halo with RMB.';
  }
  render(time:number,playerPos:Vec3,hidden:boolean):void {
    for(const rotor of this.rotors)rotor.rotation.y=time*28;
    for(const [kind,membrane] of this.membranes)membrane.scale.y=1-.7*Math.exp(-this.bounceAge[kind as 'ground'|'drone']*9);
    this.city.visible=Math.hypot(playerPos.x-SKY_CENTER.x,playerPos.z-SKY_CENTER.z)<750;
    for(const label of this.labels)label.visible=Math.hypot(label.position.x-playerPos.x,label.position.y-playerPos.y,label.position.z-playerPos.z)<130;
    for(let i=0;i<this.chimeModels.length;i++){const m=this.chimeModels[i]!;m.rotation.z=this.progress.chimes.includes(i)?Math.sin(time*1.7+i)*.025:0;}
    for(let i=0;i<this.glassModels.length;i++)this.glassModels[i]!.scale.y=this.progress.glassCooldowns[i]!>0?.45:1;
    const zone=skyZone(playerPos);
    this.sound.update(!hidden&&!!document.pointerLockElement&&inSkyBounds(playerPos),zone?.id==='tunnel'||zone?.id==='observatory'||zone?.id==='sanctuary');
    if(hidden)this.guide.style.display='none';
  }
}
