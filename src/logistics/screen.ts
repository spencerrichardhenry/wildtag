import type { Inventory } from '../craft/inventory.ts';
import type { Roster } from '../critters/roster.ts';
import { speciesById } from '../critters/species.ts';
import type { Vec3 } from '../core/types.ts';
import type { ScreenDef, ScreenManager } from '../ui/screens.ts';
import { DEPOSITS, TECHNOLOGIES, SITE_COST, UPGRADE_COST, haulingTraits, routeLength, type Deposit, type EconomyState, type Technology } from './economy.ts';

export function createLogisticsScreen(deps:{
  manager:ScreenManager; state:()=>EconomyState; roster:()=>Roster; inventory:Inventory; deposits:Deposit[]; pos:()=>Vec3;
  action:(action:'gather'|'build'|'upgrade'|'collect'|'recall'|'survey',id:string)=>void;
  research:(id:Technology)=>void; assign:(id:string,worker:number)=>void;
}):ScreenDef {
  const style=document.createElement('style');
  style.textContent=`.wt-logistics{width:min(1040px,94vw);font-family:system-ui,sans-serif;background:#142827f5;padding:26px;border-color:#90bda750}.wt-logistics h1{font-size:30px;letter-spacing:-.04em}.wt-logistics h2{font-size:17px;margin:24px 0 12px;color:#e5d8aa}.wt-logistics p{font-size:13px;line-height:1.6;color:#b9cec1}.wt-log-summary{padding:12px 16px;background:#25403a;border-radius:8px;color:#d4e8c1}.wt-log-sites,.wt-log-tech{display:grid;grid-template-columns:repeat(auto-fit,minmax(275px,1fr));gap:12px}.wt-log-card{padding:16px;border:1px solid #57766760;border-radius:10px;background:#203631}.wt-log-card h3{font-size:17px;margin:0 0 6px}.wt-log-card small{color:#b7c7b1;line-height:1.6;display:block}.wt-log-card button,.wt-log-card select{font:inherit;font-size:12px;background:#d9dca3;color:#19362d;border:0;border-radius:5px;padding:8px 10px;margin:8px 5px 0 0;cursor:pointer}.wt-log-card button:disabled{opacity:.4;cursor:default}.wt-log-card select{max-width:100%;background:#c8dccd}.wt-log-stock{height:5px;background:#112522;border-radius:5px;overflow:hidden;margin-top:12px}.wt-log-stock span{display:block;height:100%;background:#cadd96}.wt-log-tag{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#dacc9d}`;
  document.head.appendChild(style);
  const text=(tag:string,value:string,parent:HTMLElement)=>{const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;};
  const button=(parent:HTMLElement,label:string,fn:()=>void,disabled=false)=>{const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.onclick=()=>{fn();deps.manager.refresh();};parent.append(b);};
  const cost=(value:object)=>Object.entries(value).map(([key,n])=>`${n} ${key}`).join(' · ');
  return {id:'logistics',render(root){
    const state=deps.state(), roster=deps.roster(), pos=deps.pos();
    const panel=document.createElement('div');panel.className='wt-panel wt-logistics';root.append(panel);
    const close=document.createElement('button');close.className='wt-close';close.textContent='Close · N / Esc';close.onclick=()=>deps.manager.close();panel.append(close);
    text('div','HAVEN FIELD OFFICE',panel).className='wt-log-tag';
    text('h1','A little help from the wild',panel);
    text('p','Gather, build, and give your companions a route home. Explore a deposit to survey it; gathering, construction, and hopper collection require being within 6 m. Built sites keep working while you explore. Menus pause the world.',panel);
    text('div',`${deps.inventory.rp} research · ${state.sites.filter(s=>s.surveyed).length}/${deps.deposits.length} surveyed · ${state.sites.filter(s=>s.worker!==null).length} haulers · ${state.delivered} delivered`,panel).className='wt-log-summary';
    text('p',`Stores: ${['wood','stone','fiber','resin','shard','spark'].map(k=>`${deps.inventory[k as 'wood']} ${k}`).join(' · ')}`,panel);
    text('h2','Your supply routes',panel);const sites=document.createElement('div');sites.className='wt-log-sites';panel.append(sites);
    for(const d of deps.deposits){
      const s=state.sites.find(s=>s.id===d.id)!;const def=DEPOSITS[d.kind];const near=Math.hypot(pos.x-d.pos.x,pos.z-d.pos.z)<=6;
      const card=document.createElement('article');card.className='wt-log-card';card.dataset.site=d.id;sites.append(card);
      text('div',`${Math.round(Math.hypot(pos.x-d.pos.x,pos.z-d.pos.z))} m away · ${Math.round(routeLength(d.route))} m route`,card).className='wt-log-tag';
      text('h3',def.name,card);
      if(!s.surveyed){text('small','Unsurveyed · follow the matching colored trail from Haven’s depot.',card);button(card,'Survey deposit',()=>deps.action('survey',d.id),!near);continue;}
      text('small',s.built?`${def.site} · Level ${s.level} · ${(60*s.level/def.interval).toFixed(1)} ${d.kind}/min`:`Renewable ${d.kind} · ${state.tech.includes('tools')?4:2} per hand gather`,card);
      button(card,s.cooldown>0?`Regrowing · ${Math.ceil(s.cooldown)}s`:'Gather by hand',()=>deps.action('gather',d.id),!near||s.cooldown>0);
      if(!s.built){text('small',`Build: ${cost(SITE_COST)}`,card);button(card,'Build extractor',()=>deps.action('build',d.id),!near||!state.tech.includes('fieldworks'));continue;}
      const bar=document.createElement('div');bar.className='wt-log-stock';const fill=document.createElement('span');fill.style.width=`${Math.min(100,s.stock/(s.level===2?64:32)*100)}%`;bar.append(fill);card.append(bar);
      text('small',`Hopper ${s.stock}/${s.level===2?64:32} · ${s.delivered} delivered${s.stock>=(s.level===2?64:32)?' · FULL: extraction paused':''}`,card);
      button(card,'Collect hopper',()=>deps.action('collect',d.id),!near||s.stock===0);
      if(s.level===1){text('small',`Upgrade: ${cost(UPGRADE_COST)}`,card);button(card,'Upgrade extractor',()=>deps.action('upgrade',d.id),!near||!state.tech.includes('extraction'));}
      const worker=roster.find(e=>e.id===s.worker);
      if(worker){
        const traits=haulingTraits(worker.speciesId,d.kind);text('p',`${worker.nickname} · ${speciesById(worker.speciesId)?.name} · ${s.blocked?'Trail blocked — clear player-built walls or cubes':s.phase==='loading'?'Waiting for cargo':s.phase==='homebound'?'Returning to Haven':'Heading to deposit'} · ${s.cargo}/${traits.capacity*(state.tech.includes('cargo')?2:1)} cargo`,card);
        button(card,'Recall to roster',()=>deps.action('recall',d.id));
      }else{
        const idle=roster.filter(e=>e.status.kind==='idle');
        const select=document.createElement('select');select.setAttribute('aria-label',`Hauler for ${def.name}`);
        for(const e of idle){const t=haulingTraits(e.speciesId,d.kind);const option=document.createElement('option');option.value=String(e.id);option.textContent=`${e.nickname} (${speciesById(e.speciesId)?.name}) · ${t.capacity*(state.tech.includes('cargo')?2:1)} cargo · ${(t.speed*(state.tech.includes('trailcraft')?1.5:1)).toFixed(1)} m/s${t.specialist?' · specialist':''}`;select.append(option);}
        if(idle.length)card.append(select);else text('small','Link and bond a creature, then keep it idle in your roster (B).',card);
        button(card,'Assign hauler',()=>deps.assign(d.id,Number(select.value)),!idle.length||!state.tech.includes('harness'));
      }
    }
    text('h2','Field technology',panel);text('p','Research comes from linking creatures and is never spent. Materials pay for each technology once.',panel);
    const techs=document.createElement('div');techs.className='wt-log-tech';panel.append(techs);
    for(const t of TECHNOLOGIES){const card=document.createElement('article');card.className='wt-log-card';card.dataset.tech=t.id;techs.append(card);text('h3',t.name,card);text('p',t.effect,card);text('small',`${t.rp} RP · ${cost(t.cost)}`,card);if(t.needs)text('small',`Requires ${TECHNOLOGIES.find(n=>n.id===t.needs)!.name}`,card);const owned=state.tech.includes(t.id);button(card,owned?'Researched':'Research',()=>deps.research(t.id),owned||deps.inventory.rp<t.rp||!!(t.needs&&!state.tech.includes(t.needs))||Object.entries(t.cost).some(([k,n])=>deps.inventory[k as keyof typeof t.cost]<n));}
  }};
}
