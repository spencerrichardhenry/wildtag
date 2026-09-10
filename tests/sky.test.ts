import { describe, expect, it } from 'vitest';
import { SKY, skyFloorBelow, skyWorld } from '../src/sky/layout.ts';
import { hitBox, raycastSky, resolveSkyMovement, SKY_SOLIDS } from '../src/sky/collision.ts';
import { restoreSkyProgress } from '../src/sky/progress.ts';
import { initialMoveState, stepMovement } from '../src/player/movement.ts';
import { GRAPPLE, MOVE } from '../src/core/constants.ts';
import type { CritterState, GroundQuery, MoveInput, Vec3 } from '../src/core/types.ts';
import { constrainSkyWildlife } from '../src/sky/wildlife.ts';
const ground:GroundQuery={heightAt:()=>0,normalAt:()=>({x:0,y:1,z:0}),heightBelow:(x,z,y)=>Math.max(0,skyFloorBelow(x,z,y))};
const idle:MoveInput={forward:0,strafe:0,yaw:0,sprint:false,jump:false,jumpHeld:false,dash:false,rocket:false};
it('keeps sky wildlife in its habitat and slowing darts reduce its circuit speed',()=>{
  const start:CritterState={id:-88004,species:'seraphlet',pos:{x:229,y:158,z:-239},home:{x:229,y:158,z:-239},vel:{x:0,y:0,z:0},yaw:0,state:'idle',stateTime:0,stateDur:3,targetYaw:0,tagged:true,linked:false,trackProgress:4,flightHeight:0,farTime:0};
  const normal=constrainSkyWildlife(start,start,1/60),slow=constrainSkyWildlife(start,{...start,slowFor:20},1/60);
  expect(slow.flightHeight).toBeCloseTo(normal.flightHeight*.8);
  expect(Math.hypot(normal.vel.x,normal.vel.z)).toBeLessThan(2);
  expect(constrainSkyWildlife(start,start,0)).toEqual(start);
  let s=start;
  for(let i=0;i<3600;i++){
    s=constrainSkyWildlife(s,s,1/60);
    expect(Math.hypot(s.pos.x-start.home.x,s.pos.z-start.home.z)).toBeLessThan(2.81);
    expect(Math.abs(s.pos.y-start.home.y)).toBeLessThan(.23);
  }
  expect(s.trackProgress).toBe(4);expect(s.tagged).toBe(true);
});
function movement(a:Vec3,b:Vec3){return resolveSkyMovement(a,{...initialMoveState(a),pos:b,vel:{x:b.x-a.x,y:b.y-a.y,z:b.z-a.z}},.35);}
describe('layered sky architecture',()=>{
  it('keeps terrain under the kingdom reachable without snapping to its roof',()=>{
    let s=initialMoveState(skyWorld(-2,-143,2));
    for(let i=0;i<180;i++)s=stepMovement(s,idle,1/60,ground);
    expect(s.pos.y).toBe(0);
    expect(skyFloorBelow(218,-208,148)).toBe(147);
    expect(skyFloorBelow(218,-208,155)).toBe(154);
  });
  it('stops fast falls at the first roof, and rising heads beneath that roof',()=>{
    const down=movement({x:218,y:180,z:-208},{x:218,y:120,z:-208});
    expect(down.pos.y).toBeCloseTo(154.001,3);expect(down.grounded).toBe(true);
    const up=movement({x:218,y:147,z:-208},{x:218,y:160,z:-208});
    expect(up.pos.y).toBeCloseTo(151.279,3);expect(up.vel.y).toBe(0);
  });
  it('slides along a wall and lets the same body walk through its doorway',()=>{
    const hit=movement({x:212,y:147,z:-208},{x:200,y:147,z:-206});
    expect(hit.pos.x).toBeGreaterThan(209.34);expect(hit.pos.z).toBeCloseTo(-206,2);
    const door=movement({x:220,y:147,z:-197},{x:220,y:147,z:-204});
    expect(door.pos.z).toBe(-204);
  });
  it('walks a complete loop through rooms, three gallery turns, the sanctuary and eagle nests',()=>{
    let s=initialMoveState(skyWorld(-36,0,60));
    const route=[[184,-184],[184,-191],[211,-191],[220,-197],[220,-207],[220,-217],[203,-217],[203,-210],[184,-210],[177,-220],[177,-234],[177,-244],[205,-244],[205,-261],[205,-274],[229,-274],[229,-238],[248,-240],[251,-245],[256,-245],[256,-223],[265,-223],[265,-215],[241,-215]];
    for(const [x,z] of route){
      for(let i=0;i<1600 && Math.hypot(s.pos.x-x!,s.pos.z-z!)>.6;i++){
        const prev=s,yaw=Math.atan2(s.pos.x-x!,s.pos.z-z!);
        s=stepMovement(s,{...idle,yaw,forward:1},1/60,ground);s=resolveSkyMovement(prev.pos,s,.35);
      }
      expect(Math.hypot(s.pos.x-x!,s.pos.z-z!),`Blocked walking to ${x},${z} at ${JSON.stringify(s.pos)}`).toBeLessThan(.7);
      expect(s.pos.y).toBeGreaterThan(140);
    }
  });
  it('makes physical surfaces hookable from both sides',()=>{
    expect(raycastSky({x:218,y:135,z:-208},{x:218,y:150,z:-208})?.y).toBe(146);
    expect(raycastSky({x:218,y:180,z:-208},{x:218,y:150,z:-208})?.y).toBe(154);
    const box=SKY_SOLIDS.find(b=>b.id==='observatory-west')!;
    expect(hitBox({x:200,y:148,z:-208},{x:215,y:148,z:-208},box)).not.toBeNull();
  });
  it('lets a walker climb from the landing into the city without jump assistance',()=>{
    let s=initialMoveState(skyWorld(-36,0,60));
    for(let i=0;i<650;i++){
      const prev=s;s=stepMovement(s,{...idle,forward:1},1/60,ground);s=resolveSkyMovement(prev.pos,s,.35);
      if(s.pos.z<-186)break;
    }
    expect(s.pos.z).toBeLessThan(-185);expect(s.pos.y).toBeCloseTo(147,1);
  });
});
describe('ascent and progress contracts',()=>{
  it('puts the beacon above the unbounced drone hook reach but within the bounced hook reach',()=>{
    const maxHookRise=GRAPPLE.hookSpeed*GRAPPLE.hookMaxFlight+.5*GRAPPLE.hookGravity*GRAPPLE.hookMaxFlight**2;
    expect(SKY.launch.anchor.y-SKY.launch.drone.y-1.3).toBeGreaterThan(maxHookRise);
    expect(SKY.launch.anchor.y-(SKY.launch.drone.y+37.5)-1.3).toBeLessThan(maxHookRise-10);
    expect(MOVE.gravity).toBeLessThan(0);
  });
  it('sanitizes progress and preserves collected chimes without duplicating them',()=>{
    expect(restoreSkyProgress({chimes:[0,0,2,9,-1],discovered:['market','market','fake'],glassCooldowns:[Infinity,-10,20],ascent:true})).toEqual({chimes:[0,2],discovered:['market'],glassCooldowns:[0,0,20],ascent:true});
    expect(restoreSkyProgress(null).chimes).toEqual([]);
  });
});
