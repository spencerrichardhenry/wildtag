import castleData from './castle.json';
import atlantisData from './atlantis.json';
import { Architecture, type LandmarkLayout } from './architecture.ts';
import type { MoveState, Vec3 } from '../core/types.ts';
export const CASTLE_DEPTH:LandmarkLayout=castleData;
export const ATLANTIS_DEPTH:LandmarkLayout=atlantisData;
export const LANDMARKS=[CASTLE_DEPTH,ATLANTIS_DEPTH] as const;
export const castleArchitecture=new Architecture(CASTLE_DEPTH);
export const atlantisArchitecture=new Architecture(ATLANTIS_DEPTH);
export function landmarkFloorBelow(x:number,z:number,maxY:number):number {return Math.max(castleArchitecture.floorBelow(x,z,maxY),atlantisArchitecture.floorBelow(x,z,maxY));}
export function landmarkRaycast(a:Vec3,b:Vec3):Vec3|null {
  const hits=[castleArchitecture.raycast(a,b),atlantisArchitecture.raycast(a,b)].filter((h):h is Vec3=>!!h);
  return hits.sort((p,q)=>Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z)-Math.hypot(q.x-a.x,q.y-a.y,q.z-a.z))[0]??null;
}
export function resolveLandmarkMovement(a:Vec3,b:MoveState,r:number):MoveState {return atlantisArchitecture.resolve(a,castleArchitecture.resolve(a,b,r),r);}
export function landmarkWorld(layout:LandmarkLayout,p:{x:number;y:number;z:number}):Vec3 {return {x:layout.center.x+p.x,y:layout.center.y+p.y,z:layout.center.z+p.z};}
export function breathingAirbell(eye:Vec3):string|null {
  const c=ATLANTIS_DEPTH.center;
  if(Math.abs(eye.x-c.x)>100||Math.abs(eye.z-c.z)>110)return null;
  return ATLANTIS_DEPTH.airbells.find(a=>Math.hypot(eye.x-c.x-a.x,eye.z-c.z-a.z)<a.r&&eye.y-c.y>a.y-1.7&&eye.y-c.y<a.y+1.95)?.id??null;
}
