import type { Inventory } from '../craft/inventory.ts';
import { spend } from '../craft/inventory.ts';
import type { Roster } from '../critters/roster.ts';
import type { Vec3 } from '../core/types.ts';

export const MATERIALS = ['wood', 'stone', 'fiber', 'resin', 'shard', 'spark'] as const;
export type DepositKind = typeof MATERIALS[number];
export const DEPOSITS: Record<DepositKind, { name: string; site: string; color: number; interval: number }> = {
  wood: { name: 'Timber grove', site: 'Forester lodge', color: 0x9dc37b, interval: 5 },
  stone: { name: 'Stone outcrop', site: 'Stone quarry', color: 0xaab8bd, interval: 5 },
  fiber: { name: 'Flax meadow', site: 'Flax garden', color: 0xc8d895, interval: 4 },
  resin: { name: 'Amber stand', site: 'Resin tap', color: 0xe9ab51, interval: 7 },
  shard: { name: 'Crystal seam', site: 'Crystal mine', color: 0x84cdd6, interval: 8 },
  spark: { name: 'Storm geode', site: 'Spark collector', color: 0xc7b3ee, interval: 12 },
};
export const TECHNOLOGIES = [
  { id: 'fieldworks', name: 'Field engineering', rp: 25, cost: { wood: 6, stone: 6 }, needs: null, effect: 'Build renewable extractors at surveyed deposits.' },
  { id: 'harness', name: 'Creature cart harness', rp: 25, cost: { fiber: 8, wood: 5, resin: 3 }, needs: 'fieldworks', effect: 'Assign bonded critters to carry cargo home.' },
  { id: 'tools', name: 'Surveyor tools', rp: 25, cost: { stone: 5, resin: 4 }, needs: null, effect: 'Hand gathering yields 4 instead of 2.' },
  { id: 'extraction', name: 'Precision extraction', rp: 75, cost: { stone: 14, shard: 8, resin: 6 }, needs: 'fieldworks', effect: 'Unlock individual site upgrades: 2× output, 64 storage.' },
  { id: 'cargo', name: 'Roomy carts', rp: 75, cost: { wood: 16, fiber: 12, shard: 4 }, needs: 'harness', effect: 'Every creature carries twice as much cargo.' },
  { id: 'trailcraft', name: 'Trailcraft', rp: 180, cost: { wood: 20, shard: 12, spark: 8 }, needs: 'cargo', effect: 'All haulers travel 50% faster.' },
] as const;
export type Technology = typeof TECHNOLOGIES[number]['id'];
export const SITE_COST = { wood: 4, stone: 4, fiber: 2 };
export const UPGRADE_COST = { stone: 8, wood: 6, shard: 3 };

/** All creatures can help; specialists have a tangible advantage. */
export function haulingTraits(species: string, kind: DepositKind) {
  const heavy = ['bellowbuck', 'prismhorse', 'bumblewhale', 'cragdrake'].includes(species);
  const fast = ['skitterling', 'emberpup', 'zephyrfinch', 'skywyvern'].includes(species);
  const specialist = (species === 'timberchomp' && kind === 'wood') ||
    (species === 'pebbleshrew' && kind === 'stone') || (species === 'craghorn' && kind === 'shard');
  return { capacity: specialist ? 14 : heavy ? 12 : 6, speed: fast ? 5 : heavy ? 3 : 3.8, specialist };
}

export interface Deposit {
  id: string; kind: DepositKind; pos: Vec3; route: Vec3[];
}
export interface SiteState {
  id: string; surveyed: boolean; built: boolean; level: number; stock: number;
  production: number; cooldown: number; worker: number | null;
  phase: 'outbound' | 'loading' | 'homebound'; distance: number; cargo: number;
  delivered: number;
  blocked?: boolean;
}
export interface EconomyState { tech: Technology[]; sites: SiteState[]; gathered: number; delivered: number }
export function createEconomy(deposits: readonly Deposit[]): EconomyState {
  return { tech: [], gathered: 0, delivered: 0, sites: deposits.map(d => ({
    id: d.id, surveyed: false, built: false, level: 1, stock: 0, production: 0,
    cooldown: 0, worker: null, phase: 'outbound', distance: 0, cargo: 0, delivered: 0,
  })) };
}
export function routeLength(route: readonly Vec3[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++) { const a = route[i - 1]!, b = route[i]!; length += Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z); }
  return length;
}
export function routePoint(route: readonly Vec3[], distance: number): { pos: Vec3; yaw: number } {
  for (let i=1; i<route.length; i++) {
    const a=route[i-1]!, b=route[i]!, length=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    if (distance <= length || i===route.length-1) {
      const t=Math.max(0,Math.min(1,distance/(length || 1)));
      return { pos: {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}, yaw: Math.atan2(b.x-a.x,b.z-a.z) };
    }
    distance-=length;
  }
  return {pos: route[0] ?? {x:0,y:0,z:0}, yaw:0};
}
export function buyTechnology(state: EconomyState, id: Technology, inv: Inventory): string {
  const tech=TECHNOLOGIES.find(t=>t.id===id);
  if (!tech || state.tech.includes(id)) return 'Already researched';
  if (tech.needs && !state.tech.includes(tech.needs)) return 'Research the preceding technology first';
  if (inv.rp < tech.rp) return `Link more creatures: ${tech.rp} RP required`;
  const paid=spend(inv,tech.cost); if (!paid) return 'Gather the required materials';
  Object.assign(inv,paid); state.tech.push(id); return `${tech.name} researched`;
}
export function buildSite(state: EconomyState, site: SiteState, inv: Inventory, upgrade=false): string {
  if (!site.surveyed) return 'Survey this deposit in the field first';
  if (!state.tech.includes(upgrade?'extraction':'fieldworks')) return 'Research the required field technology first';
  if (upgrade ? !site.built || site.level >= 2 : site.built) return 'Site already at this stage';
  const paid=spend(inv,upgrade?UPGRADE_COST:SITE_COST); if (!paid) return 'Gather the required materials';
  Object.assign(inv,paid); site.built=true; if (upgrade) site.level=2;
  return upgrade?'Extractor upgraded':'Extractor built — collect its hopper or assign a hauler';
}
export function gather(state: EconomyState, site: SiteState, deposit: Deposit, inv: Inventory): string {
  site.surveyed=true;
  if (site.cooldown>0) return `Regrowing · ${Math.ceil(site.cooldown)}s`;
  const amount=state.tech.includes('tools')?4:2;
  inv[deposit.kind]+=amount; state.gathered+=amount; site.cooldown=8;
  return `+${amount} ${deposit.kind} · ${DEPOSITS[deposit.kind].name} surveyed`;
}
export function collectSite(site: SiteState, deposit: Deposit, inv: Inventory): number {
  const amount=site.stock; inv[deposit.kind]+=amount; site.stock=0; return amount;
}
export function assignHauler(state: EconomyState, site: SiteState, roster: Roster, id: number): string {
  const entry=roster.find(e=>e.id===id);
  if (!site.built || !state.tech.includes('harness')) return 'Build an extractor and research the cart harness first';
  if (site.worker!==null || !entry || entry.status.kind!=='idle') return 'Choose an idle creature and a site without a hauler';
  if (state.sites.some(s=>s.worker===id)) return 'Creature already has a route';
  entry.status={kind:'haul',siteId:site.id}; site.worker=id; site.phase='outbound'; site.distance=0; site.cargo=0;
  return `${entry.nickname} is hauling to Haven`;
}
/** Recall returns cargo to the site, never grants a remote inventory delivery. */
export function recallHauler(site: SiteState, roster: Roster): void {
  const entry=roster.find(e=>e.id===site.worker);
  if (entry?.status.kind==='haul') entry.status={kind:'idle'};
  site.stock+=site.cargo; site.cargo=0; site.worker=null; site.distance=0; site.phase='outbound';
}
/** Simulation uses gameplay seconds only. No offline production or unloaded-world dependency. */
export function tickEconomy(state: EconomyState, deposits: readonly Deposit[], roster: Roster, inv: Inventory, dt: number, blockedAt?: (pos:Vec3)=>boolean): void {
  if (!Number.isFinite(dt) || dt<=0) return;
  // Bounded substeps keep large time advances equivalent to fixed-step play.
  let remaining=Math.min(dt,3600);
  while (remaining>1e-8) {
    const step=Math.min(remaining,0.25); remaining-=step;
    for (const site of state.sites) {
      site.cooldown=Math.max(0,site.cooldown-step);
      const deposit=deposits.find(d=>d.id===site.id); if (!deposit || !site.built) continue;
      const cap=site.level===2?64:32;
      if (site.stock<cap) {
        site.production+=step;
        const interval=DEPOSITS[deposit.kind].interval/site.level;
        while (site.production>=interval && site.stock<cap) { site.production-=interval; site.stock++; }
      } else site.production=0;
      if (site.worker===null) continue;
      const worker=roster.find(e=>e.id===site.worker && e.status.kind==='haul' && e.status.siteId===site.id);
      if (!worker) { recallHauler(site,roster); continue; }
      const traits=haulingTraits(worker.speciesId,deposit.kind);
      const capacity=traits.capacity*(state.tech.includes('cargo')?2:1);
      const speed=traits.speed*(state.tech.includes('trailcraft')?1.5:1);
      const length=routeLength(deposit.route);
      site.blocked=false;
      if(site.phase!=='loading' && blockedAt) {
        const next=Math.max(0,Math.min(length,site.distance+(site.phase==='outbound'?1:-1)*speed*step));
        if(blockedAt(routePoint(deposit.route,next).pos)){site.blocked=true;continue;}
      }
      if (site.phase==='loading') {
        if (site.stock>=Math.min(4,capacity)) {
          site.cargo=Math.min(capacity,site.stock); site.stock-=site.cargo; site.phase='homebound';
        }
      } else if (site.phase==='outbound') {
        site.distance=Math.min(length,site.distance+speed*step);
        if (site.distance>=length) site.phase='loading';
      } else {
        site.distance=Math.max(0,site.distance-speed*step);
        if (site.distance<=0) {
          inv[deposit.kind]+=site.cargo; site.delivered+=site.cargo; state.delivered+=site.cargo;
          site.cargo=0; site.phase='outbound';
        }
      }
    }
  }
}
/** Strict field-level recovery: damaged routes never erase an unrelated save. */
export function restoreEconomy(raw: unknown, deposits: readonly Deposit[], roster: Roster): EconomyState {
  const state=createEconomy(deposits);
  if (raw && typeof raw==='object') {
    const data=raw as Partial<EconomyState>;
    state.tech=TECHNOLOGIES.filter(t=>Array.isArray(data.tech)&&data.tech.includes(t.id)).map(t=>t.id);
    const nonnegative=(n:unknown,max=1e9)=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(max,n)):0;
    state.gathered=nonnegative(data.gathered); state.delivered=nonnegative(data.delivered);
    for (const site of state.sites) {
      const value=Array.isArray(data.sites)?data.sites.find(s=>s && s.id===site.id):null;
      if (!value) continue;
      site.surveyed=value.surveyed===true; site.built=site.surveyed&&value.built===true;
      site.level=value.level===2?2:1; site.stock=Math.floor(nonnegative(value.stock,128));
      site.production=nonnegative(value.production,12); site.cooldown=nonnegative(value.cooldown,8);
      site.delivered=nonnegative(value.delivered);
      const entry=roster.find(e=>e.id===value.worker && e.status.kind==='haul'&&e.status.siteId===site.id);
      if (site.built&&entry) {
        site.worker=entry.id; site.cargo=Math.floor(nonnegative(value.cargo,28));
        site.phase=['outbound','loading','homebound'].includes(value.phase)?value.phase:'outbound';
        site.distance=nonnegative(value.distance,routeLength(deposits.find(d=>d.id===site.id)!.route));
      } else site.stock+=Math.floor(nonnegative(value.cargo,28));
    }
  }
  for (const entry of roster) if (entry.status.kind==='haul'&&!state.sites.some(s=>s.worker===entry.id)) entry.status={kind:'idle'};
  return state;
}
