import data from './data.json';
import {Architecture,type Floor,type Wall} from '../landmarks/architecture.ts';
import type {MoveState,Vec3} from '../core/types.ts';

export interface Curiosity {
 id:string;region:string;name:string;action:string;story:string;theme:string;shape:string;
 pos:Vec3;approach:Vec3;focus:Vec3;radius:number;floors:Floor[];walls:Wall[];
}
export const CURIOSITIES:readonly Curiosity[]=data;
export const curiosityArchitecture=CURIOSITIES.map(p=>new Architecture({
 id:p.id,center:p.pos,floors:p.floors,walls:p.walls,arches:[],props:[],zones:[],relics:[],airbells:[],towers:[],
}));
const raisedSites=curiosityArchitecture.filter(a=>a.layout.floors.length>0);
export function curiosityFloorBelow(x:number,z:number,y:number):number {
 let top=-Infinity;for(const a of raisedSites)top=Math.max(top,a.floorBelow(x,z,y));return top;
}
export function curiosityRaycast(a:Vec3,b:Vec3):Vec3|null {
 let best:Vec3|null=null,distance=Infinity;
 for(const c of curiosityArchitecture){const h=c.raycast(a,b);if(!h)continue;const d=(h.x-a.x)**2+(h.y-a.y)**2+(h.z-a.z)**2;if(d<distance){best=h;distance=d;}}
 return best;
}
export function resolveCuriosityMovement(a:Vec3,b:MoveState,r:number):MoveState {
 for(const c of curiosityArchitecture)b=c.resolve(a,b,r);return b;
}
/** Applied after scatter indices are assigned, preserving existing resource IDs.
 * Sky and roof curiosities do not remove scenery from the land far below. */
export function reservedForCuriosity(x:number,y:number,z:number):boolean {
 return CURIOSITIES.some(p=>Math.abs(y-p.pos.y)<8&&(x-p.pos.x)**2+(z-p.pos.z)**2<p.radius**2);
}
export function restoreCuriosities(raw:unknown):string[]{
 const known=new Set(CURIOSITIES.map(p=>p.id));return Array.isArray(raw)?[...new Set(raw.filter((id):id is string=>typeof id==='string'&&known.has(id)))]:[];
}
/** The prompt and F use the same visible, reachable target. No through-wall use. */
export function nearbyCuriosity(eye:Vec3,direction:Vec3,blocked:(a:Vec3,b:Vec3)=>Vec3|null):Curiosity|null {
 let best:Curiosity|null=null,nearest=4.8;
 for(const p of CURIOSITIES){
  const dx=p.focus.x-eye.x,dy=p.focus.y-eye.y,dz=p.focus.z-eye.z,d=Math.hypot(dx,dy,dz);
  if(d>nearest||d<.001||(dx*direction.x+dy*direction.y+dz*direction.z)/d<.55)continue;
  const hit=blocked(eye,p.focus);if(hit&&Math.hypot(hit.x-p.focus.x,hit.y-p.focus.y,hit.z-p.focus.z)>.3)continue;
  nearest=d;best=p;
 }return best;
}
