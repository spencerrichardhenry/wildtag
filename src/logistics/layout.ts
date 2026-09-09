import { heightAt } from '../world/terrain.ts';
import { villageLayout } from '../village/layout.ts';
import { MATERIALS, type Deposit } from './economy.ts';

/** Dedicated foot trails are reserved by scatter so carts have continuous clearance. */
export const DEPOT = (() => { const c=villageLayout().center; return { x:c.x+28, y:heightAt(c.x+28,c.z+12), z:c.z+12 }; })();
let cache: Deposit[] | undefined;
export function resourceDeposits(): Deposit[] {
  if (cache) return cache;
  cache=MATERIALS.map((kind,i)=>{
    // The first two groves sit just outside Haven; rarer seams pull expeditions outward.
    const offsets=[[23,14],[10,34],[48,4],[45,-36],[79,29],[105,-25]];
    const [dx,dz]=offsets[i]!;
    const x=DEPOT.x+dx!, z=DEPOT.z+dz!;
    const route=[];
    const count=Math.ceil(Math.hypot(dx!,dz!)/2);
    for (let j=0;j<=count;j++) {
      // Loading bays sit beside the dressing, so companions never walk into
      // the depot's crates or finish a trip inside the grove/mine itself.
      const t=j/count, px=DEPOT.x+3.2+(dx!-6.2)*t, pz=DEPOT.z+1.4+(dz!-1.4)*t+Math.sin(t*Math.PI)*3;
      route.push({x:px,y:heightAt(px,pz),z:pz});
    }
    return { id:`haven-${kind}`, kind, pos:{x,y:heightAt(x,z),z}, route };
  });
  return cache;
}
export function inLogisticsCorridor(x:number,z:number): boolean {
  if (Math.hypot(x-DEPOT.x,z-DEPOT.z)>150) return false;
  if (Math.hypot(x-DEPOT.x,z-DEPOT.z)<6) return true;
  return resourceDeposits().some(d=>Math.hypot(x-d.pos.x,z-d.pos.z)<5 || d.route.some(p=>Math.hypot(x-p.x,z-p.z)<2.8));
}
