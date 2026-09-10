import type { MoveState, Vec3 } from '../core/types.ts';
import { SKY, SKY_CENTER, inSkyBounds, floorHeight } from './layout.ts';

export interface SkyBox { id:string; min:Vec3; max:Vec3; floor:boolean }
export const SKY_SOLIDS: SkyBox[] = [
  ...SKY.floors.filter(f=>f.rise===0).map(f=>({id:f.id,floor:true,min:{x:f.x-f.w/2+SKY_CENTER.x,y:f.y-f.thickness+SKY_CENTER.y,z:f.z-f.d/2+SKY_CENTER.z},max:{x:f.x+f.w/2+SKY_CENTER.x,y:f.y+SKY_CENTER.y,z:f.z+f.d/2+SKY_CENTER.z}})),
  ...SKY.arches.flatMap((a,i)=>[-1,1].map(side=>{
    const x=SKY_CENTER.x+a.x+Math.cos(a.yaw)*side*a.w/2,z=SKY_CENTER.z+a.z-Math.sin(a.yaw)*side*a.w/2;
    return {id:`arch-${i}-${side}`,floor:false,min:{x:x-.35,y:SKY_CENTER.y+a.y,z:z-.35},max:{x:x+.35,y:SKY_CENTER.y+a.y+a.h*.6,z:z+.35}};
  })),
  ...SKY.walls.map(w=>({id:w.id,floor:false,min:{x:w.x-w.w/2+SKY_CENTER.x,y:w.y+SKY_CENTER.y,z:w.z-w.d/2+SKY_CENTER.z},max:{x:w.x+w.w/2+SKY_CENTER.x,y:w.y+w.h+SKY_CENTER.y,z:w.z+w.d/2+SKY_CENTER.z}})),
];
const AXES=['x','y','z'] as const;
interface Hit { t:number; axis:'x'|'y'|'z'; normal:number; point:Vec3 }
/** Segment vs expanded box. The expansion represents a player's upright body. */
export function hitBox(a:Vec3,b:Vec3,box:SkyBox,radius=0,height=0):Hit|null {
  const min={x:box.min.x-radius,y:box.min.y-height,z:box.min.z-radius};
  const max={x:box.max.x+radius,y:box.max.y,z:box.max.z+radius};
  let near=-Infinity,far=Infinity,axis:'x'|'y'|'z'='y',normal=1;
  for(const k of AXES){
    const d=b[k]-a[k];
    if(Math.abs(d)<1e-10){if(a[k]<=min[k]+1e-7 || a[k]>=max[k]-1e-7)return null;continue;}
    const t1=(min[k]-a[k])/d,t2=(max[k]-a[k])/d;
    const lo=Math.min(t1,t2),hi=Math.max(t1,t2);
    if(lo>near){near=lo;axis=k;normal=d>0?-1:1;}
    far=Math.min(far,hi);if(near>far)return null;
  }
  if(near < -1e-6 || near > 1 || far < 0)return null;
  const t=Math.max(0,near);
  return {t,axis,normal,point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}};
}

function hitRamp(a:Vec3,b:Vec3,radius=0,height=0):Hit|null {
  let best:Hit|null=null;
  for(const f of SKY.floors){
    if(!f.rise)continue;
    const ay=floorHeight(f,a.x-SKY_CENTER.x,a.z-SKY_CENTER.z),by=floorHeight(f,b.x-SKY_CENTER.x,b.z-SKY_CENTER.z);
    for(const underside of [false,true]){
      const da=a.y+(underside?height+.8:0)-ay,db=b.y+(underside?height+.8:0)-by;
      if(underside?!(da<-.0001&&db>=0):!(da>.0001&&db<=0))continue;
      const t=da/(da-db),point={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
      if(Math.abs(point.x-SKY_CENTER.x-f.x)>f.w/2+radius || Math.abs(point.z-SKY_CENTER.z-f.z)>f.d/2+radius)continue;
      if(!best||t<best.t)best={t,point,axis:'y',normal:underside?-1:1};
    }
  }
  return best;
}

export function raycastSky(a:Vec3,b:Vec3):Vec3|null {
  if(Math.max(a.y,b.y)<SKY_CENTER.y-5)return null;
  let nearest:Hit|null=hitRamp(a,b);
  for(const box of SKY_SOLIDS){const hit=hitBox(a,b,box);if(hit && (!nearest || hit.t<nearest.t))nearest=hit;}
  return nearest?.point??null;
}
/** Swept body collision, with plane sliding. Handles walls, ceilings and fast falls. */
export function resolveSkyMovement(prev:Vec3,next:MoveState,radius:number):MoveState {
  if(!inSkyBounds(prev,30) && !inSkyBounds(next.pos,30))return next;
  let a={...prev},b={...next.pos},vel={...next.vel};let grounded=next.grounded;
  for(let pass=0;pass<4;pass++){
    let best:Hit|null=hitRamp(a,b,radius,1.72);
    for(const box of SKY_SOLIDS){
      // The floor solver already supports normal steps and ramp transitions.
      if(box.floor && prev.y>=box.max.y-.48 && (b.y>=box.max.y-.001 || next.grounded && b.y>=prev.y-.10))continue;
      const hit=hitBox(a,b,box,radius,1.72);
      if(hit && (!best||hit.t<best.t))best=hit;
    }
    if(!best)break;
    const remaining={x:b.x-best.point.x,y:b.y-best.point.y,z:b.z-best.point.z};
    a={...best.point};a[best.axis]+=best.normal*.001;
    remaining[best.axis]=0;vel[best.axis]=0;
    if(best.axis==='y' && best.normal>0)grounded=true;
    b={x:a.x+remaining.x,y:a.y+remaining.y,z:a.z+remaining.z};
  }
  return {...next,pos:b,vel,grounded};
}
