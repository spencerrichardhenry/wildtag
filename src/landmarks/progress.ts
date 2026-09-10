import { LANDMARKS, landmarkWorld, breathingAirbell } from './world.ts';
import type { Vec3 } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { LandmarkLayout, Relic, Zone } from './architecture.ts';
import { blip } from '../ui/audio.ts';

export interface LandmarkProgress {discovered:string[];records:string[]}
export function restoreLandmarkProgress(raw:unknown):LandmarkProgress {
  const p=raw&&typeof raw==='object'?raw as Partial<LandmarkProgress>:{};
  const places=new Set(LANDMARKS.flatMap(l=>l.zones.map(z=>`${l.id}:${z.id}`))),records=new Set(LANDMARKS.flatMap(l=>l.relics.map(r=>`${l.id}:${r.id}`)));
  return {discovered:Array.isArray(p.discovered)?[...new Set(p.discovered.filter(id=>places.has(id)))]:[],records:Array.isArray(p.records)?[...new Set(p.records.filter(id=>records.has(id)))]:[]};
}
export function landmarkZone(p:Vec3):{layout:LandmarkLayout;zone:Zone}|null {
  for(const layout of LANDMARKS){const c=layout.center;
    for(let i=layout.zones.length-1;i>=0;i--){const z=layout.zones[i]!;if(Math.abs(p.x-c.x-z.x)<=z.w/2&&Math.abs(p.z-c.z-z.z)<=z.d/2&&p.y-c.y>=z.y-.7&&p.y-c.y<=z.y+z.h)return {layout,zone:z};}
  }return null;
}
export function nearbyRecord(p:Vec3):{layout:LandmarkLayout;relic:Relic}|null {
  for(const layout of LANDMARKS)for(const relic of layout.relics){const q=landmarkWorld(layout,relic);if(Math.hypot(q.x-p.x,q.z-p.z)<3&&Math.abs(q.y-p.y)<3)return {layout,relic};}return null;
}
export function readRecord(progress:LandmarkProgress,layout:LandmarkLayout,relic:Relic,inventory:Inventory):boolean {
  const id=`${layout.id}:${relic.id}`;if(progress.records.includes(id))return false;
  progress.records.push(id);inventory.rp+=12;
  if(layout.id==='castle')inventory.spark+=2;else inventory.shell+=2;
  if(layout.relics.every(r=>progress.records.includes(`${layout.id}:${r.id}`))){
    if(layout.id==='castle'){inventory.stone+=12;inventory.resin+=8;}else{inventory.shard+=10;inventory.scale+=3;}
  }return true;
}
export class LandmarkJourney {
  progress:LandmarkProgress=restoreLandmarkProgress(null);
  private readonly guide=document.createElement('div');
  private readonly title=document.createElement('div');
  private readonly detail=document.createElement('div');
  private timer=0;
  constructor(private readonly toast:(s:string)=>void,private readonly purified:()=>boolean){
    this.guide.id='landmark-guide';this.guide.style.cssText='display:none;position:fixed;left:18px;top:160px;max-width:310px;padding:12px 15px;border-left:2px solid #d6be85;border-radius:0 9px 9px 0;background:linear-gradient(90deg,rgba(22,40,51,.9),rgba(22,40,51,.65));color:#f4ecd4;font:13px/1.5 system-ui;pointer-events:none;z-index:4';
    this.title.style.cssText='font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#e6ce94;margin-bottom:5px';this.guide.append(this.title,this.detail);document.body.append(this.guide);
  }
  step(dt:number,p:Vec3,inventory:Inventory,hidden:boolean):void {
    if(hidden){this.guide.style.display='none';return;}
    this.timer-=dt;if(this.timer>0)return;this.timer=.2;
    const here=landmarkZone(p),record=nearbyRecord(p),air=breathingAirbell({x:p.x,y:p.y+1.65,z:p.z});
    if(!here&&!record&&!air){this.guide.style.display='none';return;}
    const layout=here?.layout??record?.layout??LANDMARKS[1];
    if(here){const id=`${layout.id}:${here.zone.id}`;if(!this.progress.discovered.includes(id)){this.progress.discovered.push(id);inventory.rp+=5;this.toast(`${here.zone.name} · +5 research. ${here.zone.story}`);}}
    const count=this.progress.records.filter(id=>id.startsWith(layout.id+':')).length,places=this.progress.discovered.filter(id=>id.startsWith(layout.id+':')).length;
    const name=layout.id==='castle'?(this.purified()?'Dawnlight Castle':'Cursed Castle'):'Atlantis';
    this.guide.style.display='block';this.title.textContent=name+(here?' · '+here.zone.name:'');
    this.detail.textContent=air?(air==='crown'?'Airbell refuge · Breath recovering. Rise beside the bell, through the open oculus, to return to the surface.':'Airbell refuge · Breath recovering. Look for the next brass bell before swimming onward.'):record?`F · ${this.progress.records.includes(`${layout.id}:${record.relic.id}`)?'Read again: ':''}${record.relic.name}`:`${places}/${layout.zones.length} places · ${count}/3 records. ${here?.zone.story??''}`;
  }
  interact(p:Vec3,inventory:Inventory):boolean {
    const nearby=nearbyRecord(p);if(!nearby)return false;
    const fresh=readRecord(this.progress,nearby.layout,nearby.relic,inventory);
    this.toast(`${nearby.relic.name}${fresh?' · +12 research':''}. ${nearby.relic.story}`);
    if(fresh){blip(nearby.layout.id==='castle'?610:820,.2,.045);if(nearby.layout.relics.every(r=>this.progress.records.includes(`${nearby.layout.id}:${r.id}`)))this.toast(nearby.layout.id==='castle'?'The ward’s history restored · +12 stone, +8 resin':'The lost charts reunited · +10 shards, +3 croc hide');}
    this.timer=0;return true;
  }
}
