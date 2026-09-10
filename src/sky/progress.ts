import type { Vec3 } from '../core/types.ts';
import { SKY, skyWorld } from './layout.ts';
export interface SkyProgress { discovered:string[]; chimes:number[]; glassCooldowns:number[]; ascent:boolean }
export function createSkyProgress():SkyProgress { return {discovered:[],chimes:[],glassCooldowns:[0,0,0],ascent:false}; }
export function restoreSkyProgress(raw:unknown):SkyProgress {
  const state=createSkyProgress();if(!raw || typeof raw!=='object')return state;
  const r=raw as Partial<SkyProgress>;
  state.discovered=Array.isArray(r.discovered)?[...new Set(r.discovered.filter(x=>SKY.zones.some(z=>z.id===x)))]:[];
  state.chimes=Array.isArray(r.chimes)?[...new Set(r.chimes.filter(x=>Number.isInteger(x)&&x>=0&&x<3))]:[];
  state.glassCooldowns=Array.from({length:3},(_,i)=>Math.max(0,Math.min(45,Number.isFinite(r.glassCooldowns?.[i])?r.glassCooldowns![i]!:0)));
  state.ascent=r.ascent===true;return state;
}
export const SKY_CHIMES=SKY.props.filter(p=>p.kind==='chime').map(p=>skyWorld(p.x,p.y,p.z));
export const SKY_GLASS=SKY.props.filter(p=>p.kind==='skyglass').map(p=>skyWorld(p.x,p.y,p.z));
export function nearbySkyPoint(pos:Vec3,points:readonly Vec3[],range=3):number {
  return points.findIndex(p=>Math.hypot(pos.x-p.x,pos.z-p.z)<range && Math.abs(pos.y-p.y)<3);
}
