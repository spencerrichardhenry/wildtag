import { describe, it, expect } from 'vitest';
import { CASTLE_DEPTH as C, ATLANTIS_DEPTH as A, castleArchitecture as castle, atlantisArchitecture as sea, breathingAirbell, landmarkWorld as world } from '../src/landmarks/world.ts';
import { initialMoveState, stepMovement } from '../src/player/movement.ts';
import { landmarkZone, nearbyRecord, readRecord, restoreLandmarkProgress } from '../src/landmarks/progress.ts';
import { createInventory } from '../src/craft/inventory.ts';
import type { GroundQuery, MoveInput, Vec3 } from '../src/core/types.ts';
import { clamSpawns } from '../src/underwater/layout.ts';
import { WARD_MAP } from '../src/castle/wardMap.ts';
import { heightAt } from '../src/world/terrain.ts';
const idle:MoveInput={forward:0,strafe:0,yaw:0,sprint:false,jump:false,jumpHeld:false,dash:false,rocket:false};
const ground:GroundQuery={heightAt:()=>C.center.y,normalAt:()=>({x:0,y:1,z:0}),heightBelow:(x,z,y)=>Math.max(C.center.y,castle.floorBelow(x,z,y))};
const cp=(x:number,y:number,z:number)=>world(C,{x,y,z});
const ap=(x:number,y:number,z:number)=>world(A,{x,y,z});
function walk(start:Vec3,route:number[][]){
  let s=initialMoveState(start);
  for(const [x,z] of route){
    const goal=cp(x!,0,z!);
    for(let i=0;i<3000&&Math.hypot(s.pos.x-goal.x,s.pos.z-goal.z)>.25;i++){
      const prev=s;s=stepMovement(s,{...idle,forward:1,yaw:Math.atan2(s.pos.x-goal.x,s.pos.z-goal.z)},1/60,ground);s=castle.resolve(prev.pos,s,.4);
    }
    expect(Math.hypot(s.pos.x-goal.x,s.pos.z-goal.z),`Blocked toward ${x},${z}: ${JSON.stringify({x:s.pos.x-C.center.x,y:s.pos.y-C.center.y,z:s.pos.z-C.center.z})}`).toBeLessThan(.3);
  }return s;
}
function swim(a:Vec3,b:Vec3){return sea.resolve(a,{...initialMoveState(a),mode:'swim',pos:b,vel:{x:b.x-a.x,y:b.y-a.y,z:b.z-a.z}},.4);}
describe('castle exploration routes',()=>{
  it('retains walking access from the gate through the ward to both halls and all three courts',()=>{
    const queue=[[35,17]],seen=new Map<string,number[][]>([['35,17',[[35,17]]]]);
    for(let i=0;i<queue.length;i++){
      const [x,z]=queue[i]!;
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const a=x!+dx!,b=z!+dz!,key=`${a},${b}`;
        if(!'.GHP'.includes(WARD_MAP[b]?.[a]??'#')||seen.has(key))continue;
        seen.set(key,[...seen.get(`${x},${z}`)!,[a,b]]);queue.push([a,b]);
      }
    }
    for(const [x,z] of [[17,5],[5,17],[6,6],[17,29],[29,29]]){
      const path=seen.get(`${x},${z}`);expect(path).toBeDefined();
      const route=path!.map(([a,b])=>[(a!-17.5)*5,(b!-17.5)*5]);
      // The original market spire stands at its corner entrance. Walk around
      // its south face within the open plaza rather than aiming at its centre.
      const detour=route.findIndex(([x,z])=>x===-12.5&&z===47.5);
      if(detour>=0)route.splice(detour,1,[-17.5,49.7],[-12.5,49.7],[-7.5,49.7]);
      walk(cp(87.5,.08,-2.5),route);
    }
  });
  it('climbs all four keep stair flights on foot, without jump assistance',()=>{
    const s=walk(cp(7,.08,0),[[6,6],[5,6],[-7,6],[-7,-7],[7,-7],[7,7],[-7,7],[-3,-2]]);
    expect(s.pos.y-C.center.y).toBeCloseTo(20,1);
  });
  it('walks the gate stair, battlement corner bypass, library roof and north keep door',()=>{
    const s=walk(cp(102,0,-3),[[102,26],[90,26],[90,-82],[82,-82],[82,-90],[-2.5,-90],[-2.5,-63],[-2.5,-7]]);
    expect(s.pos.y-C.center.y).toBeCloseTo(8,1);
  });
  it('connects the keep to the forge roof and western battlement',()=>{
    const s=walk(cp(-3,8,-7),[[-17,-7],[-24,-7],[-24,-2.5],[-62.5,-2.5],[-90,-2.5]]);
    expect(s.pos.y-C.center.y).toBeCloseTo(8,1);
  });
  it('keeps the ground chamber below the mezzanine and catches falls at the roof',()=>{
    expect(castle.floorBelow(C.center.x,C.center.z, C.center.y+1)-C.center.y).toBeCloseTo(.08);
    const a=cp(0,40,0),b=cp(0,0,0),s=castle.resolve(a,{...initialMoveState(a),pos:b},.35);
    expect(s.pos.y-C.center.y).toBeCloseTo(20.001,3);
  });
});
describe('Atlantis rooms and breathing refuges',()=>{
  it('seats lower buildings in the seabed and keeps the crown underpass open',()=>{
    for(const f of A.floors.filter(f=>f.y+f.rise<=4)){
      for(const dx of [-.5,0,.5])for(const dz of [-.5,0,.5]){
        const x=A.center.x+f.x+f.w*dx,z=A.center.z+f.z+f.d*dz;
        const highestBase=A.center.y+f.y+f.rise-f.thickness;
        expect(highestBase,`${f.id} reaches the seabed`).toBeLessThan(heightAt(x,z)-.2);
      }
    }
    // The nave's underside is now solid masonry, including at its open door.
    expect(sea.raycast(ap(-22,.3,12),ap(-10,.3,12))).not.toBeNull();
    expect(swim(ap(-22,.3,12),ap(-10,.3,12)).pos.x).toBeLessThan(A.center.x-17);
    // Four supports carry the upper observatory without closing the back road.
    expect(sea.raycast(ap(-20,6,44),ap(20,6,44))).toBeNull();
    expect(sea.raycast(ap(-20,6,52.5),ap(0,6,52.5))).not.toBeNull();
  });
  it('lets a swimmer enter the nave doorway while its adjacent wall blocks movement and darts',()=>{
    // The exterior stair reaches the doorway continuously, without a buried
    // ramp ending behind the raised palace foundation.
    for(let z=-22;z<=-10;z++)expect(sea.floorBelow(A.center.x,A.center.z+z,A.center.y+5)-A.center.y).toBeCloseTo(1.2+(z+22)*2.8/12);
    expect(swim(ap(24,6,12),ap(0,6,12)).pos).toEqual(ap(0,6,12));
    const door=swim(ap(0,6,-15),ap(0,6,5));expect(door.pos.z).toBeCloseTo(A.center.z+5);
    const wall=swim(ap(13,6,-15),ap(13,6,5));expect(wall.pos.z).toBeLessThan(A.center.z-10);
    expect(sea.raycast(ap(13,7,-15),ap(13,7,5))).not.toBeNull();
    expect(sea.raycast(ap(0,7,-15),ap(0,7,5))).toBeNull();
  });
  it('traverses the arcade turns, archive and pearl crypt through real doors',()=>{
    let p=ap(-25,3,-25);
    for(const [x,z] of [[-25,-14],[-47,-14],[-47,14],[-31,14],[-31,38],[-35,40],[-55,40],[-35,40],[-35,42],[-18,42]]){
      const target=ap(x!,3,z!),s=swim(p,target);expect(s.pos,`Blocked at ${x},${z}`).toEqual(target);p=s.pos;
    }
  });
  it('blocks swimming upward through an archive ceiling, but allows the nave oculus',()=>{
    const roof=swim(ap(-35,3,45),ap(-35,15,45));expect(roof.pos.y-A.center.y).toBeLessThan(9);
    expect(swim(ap(0,6,12),ap(0,21,12)).pos.y).toBe(A.center.y+21);
    // Rise beside the crown airbell, through the open observatory oculus.
    expect(swim(ap(4,12,46),ap(4,25,46)).pos.y).toBe(A.center.y+25);
  });
  it('provides fourteen bounded air refuges with room to enter beneath each bell',()=>{
    expect(A.airbells).toHaveLength(14);
    for(const a of A.airbells){
      const eye=world(A,a);expect(breathingAirbell(eye)).toBe(a.id);
      expect(breathingAirbell({...eye,x:eye.x+a.r+.01})).toBeNull();
      expect(breathingAirbell({...eye,y:eye.y-1.71})).toBeNull();
      const feet={...eye,y:eye.y-1.65};expect(swim({...feet,y:feet.y-1},feet).pos).toEqual(feet);
    }
  });
  it('preserves clam identities and places interior guards above the room floors',()=>{
    expect(clamSpawns().map(s=>s.id)).toEqual([2000,2001,2002,2003,2004,2005,2006,2007]);
    for(const id of [2003,2005,2007]){const s=clamSpawns().find(s=>s.id===id)!;expect(sea.floorBelow(s.x,s.z,A.center.y+5)).toBeGreaterThan(A.center.y);}
  });
});
describe('landmark records and persistence',()=>{
  it('sanitizes old saves and prevents duplicate rewards after reloading',()=>{
    expect(restoreLandmarkProgress(null)).toEqual({discovered:[],records:[]});
    const inv=createInventory();let p=restoreLandmarkProgress({discovered:['castle:library','castle:library','bad'],records:['bad']});
    expect(p.discovered).toEqual(['castle:library']);
    for(const layout of [C,A])for(const r of layout.relics){expect(readRecord(p,layout,r,inv)).toBe(true);p=restoreLandmarkProgress(JSON.parse(JSON.stringify(p)));expect(readRecord(p,layout,r,inv)).toBe(false);}
    expect(inv.rp).toBe(72);expect(inv.spark).toBe(6);expect(inv.shell).toBe(6);expect(inv.stone).toBe(12);expect(inv.shard).toBe(10);expect(inv.scale).toBe(3);
  });
  it('distinguishes upstairs discoveries from the chamber underneath',()=>{
    expect(landmarkZone(cp(0,0,0))?.zone.id).toBe('keep');expect(landmarkZone(cp(0,20,0))?.zone.id).toBe('watch');
    for(const layout of [C,A])for(const r of layout.relics)expect(nearbyRecord(world(layout,r))?.relic.id).toBe(r.id);
    expect(nearbyRecord(cp(-3,0,-2))).toBeNull();
  });
});
