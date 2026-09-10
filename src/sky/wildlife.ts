import type { CritterState } from '../core/types.ts';
/** Territorial flight circuits keep the new wildlife in its authored habitat.
 * Tags quicken the circuit; slowing darts, tracking and linking retain their usual systems. */
export function constrainSkyWildlife(previous:CritterState,next:CritterState,dt:number):CritterState {
  const angel=next.species==='seraphlet';
  if(!angel&&next.species!=='suncresteagle')return next;
  if(dt<=0)return previous;
  const tagged=next.tagged&&!next.linked;
  const rate=angel?(tagged?.48:.22):(tagged?.62:.34);
  const angularSpeed=rate*(next.slowFor?.8:1);
  const phase=previous.flightHeight+dt*angularSpeed;
  const angle=phase+(Math.abs(next.id)%7),radius=angel?(next.home.y>153?2.8:2.1):8+(Math.abs(next.id)%3);
  const pos={x:next.home.x+Math.cos(angle)*radius,y:next.home.y+Math.sin(angle*1.7)*(angel?.22:1.1),z:next.home.z+Math.sin(angle)*radius};
  // Analytic velocity avoids a one-frame animation spike when the slot streams in.
  return {...next,pos,flightHeight:phase,yaw:Math.atan2(-Math.sin(angle),Math.cos(angle)),vel:{x:-Math.sin(angle)*radius*angularSpeed,y:Math.cos(angle*1.7)*1.7*(angel?.22:1.1)*angularSpeed,z:Math.cos(angle)*radius*angularSpeed}};
}
