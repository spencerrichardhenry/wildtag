// Author the two landmark layouts. Geometry, physics and discovery share this data.
// Run with Node's TypeScript stripping support from the repository root.
import { writeFileSync } from 'node:fs';
import { CASTLE, WARD, SPIRES, UNDERWATER } from '../../../src/core/constants.ts';
import { castleLayout } from '../../../src/castle/layout.ts';
import { wardLayout, nonRingRuns, extendedWallSpan } from '../../../src/castle/ward.ts';
import { WARD_MAP } from '../../../src/castle/wardMap.ts';

const round = n => Math.round(n * 10000) / 10000;
function author(id, center) {
  const d={id,center,floors:[],walls:[],arches:[],props:[],zones:[],relics:[],airbells:[],towers:[]};
  const floor=(id,x,z,w,depth,y=0,rise=0,axis='z',sector='court',thickness=.6)=>d.floors.push({id,x,z,w,d:depth,y,rise,axis,sector,thickness});
  const wall=(id,x,z,w,depth,y,h,sector='court',style='wall')=>d.walls.push({id,x,z,w,d:depth,y,h,sector,style});
  const arch=(x,z,y,w,h,sector,yaw=0)=>d.arches.push({x,z,y,w,h,sector,yaw});
  const prop=(kind,x,z,y,sector,s=1,yaw=0)=>d.props.push({kind,x,z,y,sector,s,yaw});
  const zone=(id,name,x,z,w,depth,y,h,story)=>d.zones.push({id,name,x,z,w,d:depth,y,h,story});
  const relic=(id,name,x,z,y,sector,story)=>{d.relics.push({id,name,x,z,y,story});prop('relic',x,z,y,sector);};
  const room=(id,x,z,w,depth,y,h,doors,sector=id)=>{
    floor(id+'-floor',x,z,w,depth,y,0,'z',sector);
    for(const side of ['north','south','west','east']){
      const horizontal=side==='north'||side==='south',mid=horizontal?x:z,len=horizontal?w:depth;
      const fixed=horizontal?z+(side==='north'?-1:1)*depth/2:x+(side==='west'?-1:1)*w/2;
      const door=doors[side], spans=door?[[mid-len/2,door.at-door.w/2],[door.at+door.w/2,mid+len/2]]:[[mid-len/2,mid+len/2]];
      spans.forEach(([a,b],i)=>{if(b>a)wall(`${id}-${side}-${i}`,horizontal?(a+b)/2:fixed,horizontal?fixed:(a+b)/2,horizontal?b-a:1.2,horizontal?1.2:b-a,y,h,sector);});
      if(door){wall(`${id}-${side}-lintel`,horizontal?door.at:fixed,horizontal?fixed:door.at,horizontal?door.w:1.2,horizontal?1.2:door.w,y+door.h,h-door.h,sector);arch(horizontal?door.at:fixed,horizontal?fixed:door.at,y,door.w,door.h,sector,horizontal?0:Math.PI/2);}
    }
  };
  return {d,floor,wall,arch,prop,zone,relic,room};
}

function castle(){
  const A=author('castle',{...CASTLE.center,y:CASTLE.padHeight}),{d,floor,wall,arch,prop,zone,relic}=A;
  const l=castleLayout(),ward=wardLayout(),local=p=>({x:round(p.x-CASTLE.center.x),z:round(p.z-CASTLE.center.z)});
  for(let row=0;row<WARD_MAP.length;row++)for(let col=0;col<WARD_MAP[row].length;col++)if('.G'.includes(WARD_MAP[row][col]))floor(`ward-paving-${col}-${row}`,(col-17.5)*5,(row-17.5)*5,5,5,.08,0,'z',row<18?'ward_north':'ward_south',.14);
  // Retain the original authored ward routes, creature perches and crystal location.
  for(const [i,run] of nonRingRuns().entries()){
    const s=extendedWallSpan(run),p=local({x:(s.x1+s.x2)/2,z:(s.z1+s.z2)/2});
    wall('ward-'+i,p.x,p.z,Math.max(WARD.wallT*2,Math.abs(s.x2-s.x1)),Math.max(WARD.wallT*2,Math.abs(s.z2-s.z1)),0,WARD.wallH,p.z<0?'ward_north':'ward_south','masonry');
  }
  wall('curtain-north',0,-90,180,4.8,0,8,'ramparts','curtain');
  wall('curtain-south',0,90,180,4.8,0,8,'ramparts','curtain');
  wall('curtain-west',-90,0,4.8,180,0,8,'ramparts','curtain');
  for(const z of [-47.25,47.25])wall('curtain-east-'+z,90,z,4.8,85.5,0,8,'ramparts','curtain');
  wall('gate-lintel',90,0,4.8,9,7,1,'ramparts');arch(92.6,0,0,9,7,'ramparts',Math.PI/2);
  // Broad parapet loop. The exposed stair is reachable directly beside the main gate.
  for(const z of [-90,90])floor('rampart-z'+z,0,z,188,6,8,0,'z','ramparts',.55);
  for(const x of [-90,90])floor('rampart-x'+x,x,0,6,180,8,0,'z','ramparts',.55);
  for(const z of [-93,93])wall('parapet-z'+z,0,z,188,.5,8,1.05,'ramparts','crenel');
  wall('parapet-west',-93,0,.5,188,8,1.05,'ramparts','crenel');
  wall('parapet-east-north',93,-35.5,.5,117,8,1.05,'ramparts','crenel');
  wall('parapet-east-south',93,61.5,.5,65,8,1.05,'ramparts','crenel');
  floor('gate-stair',102,12,5,24,0,8,'-z','gate');
  floor('gate-stair-head',96,26,17,4,8,0,'z','gate');
  floor('gate-stair-foot',102,-3,8,6,.08,0,'z','gate');
  prop('banner',98,0,0,'gate',1.5,Math.PI/2);prop('brazier',99,-5,0,'gate');
  arch(102,-1,0,5.8,5,'gate');
  for(const t of l.towers){const p=local(t);d.towers.push({...p,y:0,r:5,h:18,sector:'ramparts'});floor('tower-top-'+p.x+'-'+p.z,p.x,p.z,8,8,18,0,'z','ramparts');floor('tower-bypass-'+p.x+'-'+p.z,Math.sign(p.x)*84,Math.sign(p.z)*84,12,12,8,0,'z','ramparts');}
  for(const [i,s] of SPIRES.list.entries())d.towers.push({x:s.dx,z:s.dz,y:0,r:SPIRES.obstacleR,h:s.h,sector:'spires',spire:true,index:i});
  // Familiar ground rooms become furnished, vaulted destinations with roof galleries.
  for(const [i,h] of ward.halls.entries()){
    const p=local(h.center),w=(Math.max(...h.cells.map(c=>c.x))-Math.min(...h.cells.map(c=>c.x)))+5,depth=(Math.max(...h.cells.map(c=>c.z))-Math.min(...h.cells.map(c=>c.z)))+5;
    const sector=i===0?'library':'forge';
    floor(sector+'-paving',p.x,p.z,w,depth,.08,0,'z',sector,.2);
    floor(sector+'-roof',p.x,p.z,w+3,depth+3,8,0,'z',sector,.65);
    // Raised clerestory frieze fills the space above the old ward perimeter.
    for(const z of [p.z-depth/2-1.25,p.z+depth/2+1.25])wall(sector+'-clerestory-z'+z,p.x,z,w+2.5,1.1,5.5,2.5,sector,'frieze');
    for(const x of [p.x-w/2-1.25,p.x+w/2+1.25])wall(sector+'-clerestory-x'+x,x,p.z,1.1,depth+2.5,5.5,2.5,sector,'frieze');
    if(i===0){
      for(const x of [p.x-8,p.x+8])prop('shelf',x,p.z,0,sector,1.35,Math.PI/2);
      prop('reading_table',p.x+6,p.z+3,0,sector);prop('chandelier',p.x,p.z,6.7,sector);
      for(const z of [p.z-5,p.z+5])arch(p.x,z,0,19,7.6,sector);
      relic('library','The Keeper’s Ledger',p.x+7,p.z-3,0,sector,'The ward was built as a refuge. Its roof galleries still connect the keep to both great halls.');
      zone('library','Lantern Library',p.x,p.z,w,depth,0,7,'Weathered books, reading tables and a vaulted ceiling. The northern doorway rejoins the winding ward.');
    }else{
      prop('forge',p.x,p.z-7,0,sector,1.2);prop('war_table',p.x+3,p.z+5,0,sector);prop('barrels',p.x-4,p.z+6,0,sector);
      for(const x of [p.x-4,p.x+4])arch(x,p.z,0,19,7.6,sector,Math.PI/2);
      relic('forge','The Warden’s Mark',p.x+4,p.z-6,0,sector,'The smiths marked every repaired gate. Search above the keep for the watch captain’s last seal.');
      zone('forge','Ember Hall',p.x,p.z,w,depth,0,7,'A sheltered forge, stores and the wardens’ planning table. Two doors lead back into the maze.');
    }
  }
  for(const [i,pz] of ward.plazas.entries()){
    const p=local(pz.center),sector=i===0?'garden':i===1?'market':'court';
    floor(sector+'-paving',p.x,p.z,25,25,.08,0,'z',sector,.2);
    for(const dx of [-9,9])for(const dz of [-9,9])prop(i===0?'planter':'banner',p.x+dx,p.z+dz,0,sector,1,i%2?Math.PI:0);
    if(i===0){prop('memorial',p.x,p.z,0,sector);prop('bench',p.x+6,p.z+4,0,sector,1,Math.PI/2);}
    else if(i===1){prop('market_stall',p.x-6,p.z-6,0,sector);prop('barrels',p.x+8,p.z-6,0,sector);prop('market_stall',p.x+6,p.z+6,0,sector,1,Math.PI);}
    else {prop('war_table',p.x,p.z,0,sector,1.4);prop('brazier',p.x+8,p.z-8,0,sector);}
    zone(sector,['Mossheart Cloister','Provisioners’ Court','Banner Court'][i],p.x,p.z,25,25,0,6,['A memorial garden sheltered by old stone. Ivy returns when the curse is lifted.','The market stores tell the story of the castle’s last long winter.','A broad meeting court where the watch once assembled.'][i]);
  }
  // Raised links cross the old maze without changing its ground-level routes.
  floor('west-gallery',-57,-2.5,66,4,8,0,'z','galleries');
  floor('gallery-turn',-24,-4.75,4,8.5,8,0,'z','galleries');
  floor('keep-west-bridge',-17,-7,16,4,8,0,'z','galleries');
  floor('north-gallery',-2.5,-49.5,4,81,8,0,'z','galleries');
  // Keep: a clear crystal chamber, two turn-back stair flights, a high roof walk.
  floor('keep-ground',0,0,20,20,.08,0,'z','keep',.2);
  wall('keep-east-north',10,-5.75,2.8,8.5,0,20,'keep');wall('keep-east-south',10,5.75,2.8,8.5,0,20,'keep');wall('keep-east-lintel',10,0,2.8,3,3.5,16.5,'keep');
  wall('keep-south',0,10,20,2.8,0,20,'keep');
  // Western and northern doors are on the gallery level only.
  wall('keep-west-lower',-10,0,2.8,20,0,8,'keep');wall('keep-west-upper',-10,0,2.8,20,12.5,7.5,'keep');
  wall('keep-west-door-north',-10,-9.5,2.8,1,8,4.5,'keep');wall('keep-west-door-south',-10,2.5,2.8,15,8,4.5,'keep');
  wall('keep-north-lower',0,-10,20,2.8,0,8,'keep');wall('keep-north-upper',0,-10,20,2.8,12.5,7.5,'keep');
  wall('keep-north-door-west',-7.25,-10,5.5,2.8,8,4.5,'keep');wall('keep-north-door-east',4.75,-10,10.5,2.8,8,4.5,'keep');
  arch(10,0,0,3.1,3.5,'keep',Math.PI/2);arch(-10,-7,8,4.1,4.5,'keep',Math.PI/2);arch(-2.5,-10,8,4.1,4.5,'keep');
  floor('keep-stair-one',0,6,10,3,0,4,'-x','keep');floor('keep-stair-one-turn',-7,6,4,3,4,0,'z','keep');
  floor('keep-stair-two',-7,-.25,3,9.5,4,4,'z','keep');
  floor('keep-mezzanine',0,-7,18,4,8,0,'z','keep');
  floor('keep-stair-three',7,0,3,10,8,6,'-z','keep');floor('keep-stair-three-turn',7,7,4,4,14,0,'z','keep');
  floor('keep-stair-four',0,7,10,3,14,6,'-x','keep');floor('keep-stair-four-head',-7,7,4,4,20,0,'z','keep');
  floor('keep-roof',-2.5,-2.5,15,15,20,0,'z','keep');floor('keep-se-perch',8,8,4,4,20,0,'z','keep');
  prop('throne',0,-6,0,'keep',1.25);prop('banner',4,-8,0,'keep');prop('banner',-4,-8,0,'keep');
  prop('brazier',6,-3,0,'keep');prop('brazier',-4,2,0,'keep');
  relic('watch','The Watch Captain’s Seal',-3,-2,20,'keep','From the highest watch, three records make a history: the library, the forge and this final lookout.');
  zone('gate','The Lantern Gate',98,0,28,22,0,7,'Enter the ward below, or take the broad stair beside the gate to the battlements.');
  zone('ramparts','The High Watch',0,0,195,195,8,3,'The curtain walls are a complete walking loop. Two roof galleries lead inward toward the keep.');
  zone('keep','The Crystal Keep',0,0,20,20,0,7,'The corruption crystal remains below the throne. Stairs turn up through the keep to the roof.');
  zone('galleries','The Wardens’ Galleries',-35,-30,115,120,8,4,'Raised stone bridges connect the halls, battlements and keep. Look down to read the maze beneath you.');
  zone('watch','The Crown Walk',0,0,23,23,19,8,'The castle’s highest walk looks back over every district. Gargoyles still haunt the old perches.');
  // Wayfinding lamps sit in open room corners rather than choking ward corridors.
  for(const [x,z] of [[84,-3],[6,2],[-65,-9],[-10,-62],[56,64],[-60,-63],[-6,60]])prop('brazier',x,z,0,'court',.7);
  d.routeHints={keepEntry:{x:8,z:0,y:.1},roofPath:[[6,6],[5,6],[-7,6],[-7,-7],[7,-7],[7,7],[-7,7],[-3,-2]],galleryPath:[[-3,-7],[-17,-7],[-24,-7],[-24,-2.5],[-62.5,-2.5],[-90,-2.5]],gateStair:[[102,-3],[102,26],[90,26],[90,-82],[82,-82],[82,-90],[-2.5,-90],[-2.5,-63]]};
  return d;
}

function atlantis(){
  const A=author('atlantis',{...UNDERWATER.center,y:UNDERWATER.floorY}),{d,floor,wall,arch,prop,zone,relic,room}=A;
  floor('causeway',0,-64,12,44,1.2,0,'z','gate');
  floor('shell-market',0,-28,70,34,1.2,0,'z','market');
  arch(0,-46,1.2,12,10,'gate');arch(0,-68,1.2,10,8,'gate');
  for(const x of [-29,29]){wall('gate-fragment'+x,x,-45,14,2,1.2,6,'gate','ruin');prop('coral_spire',x,-45,1.2,'gate',1.4);}
  for(const x of [-22,22]){prop('shell_stall',x,-25,1.2,'market',1,x<0?Math.PI/2:-Math.PI/2);prop('amphora',x,-38,1.2,'market',1.4);}
  floor('hall-approach',0,-16,10,12,1.2,2.8,'-z','hall');
  room('hall',0,12,34,44,4,12,{north:{at:0,w:10,h:9},south:{at:0,w:12,h:9},west:{at:12,w:8,h:8},east:{at:12,w:8,h:8}});
  // Hollow roof with a real central oculus and an upper viewing gallery.
  floor('hall-roof-west',-12,12,10,44,16,0,'z','hall');floor('hall-roof-east',12,12,10,44,16,0,'z','hall');
  floor('hall-roof-front',0,-2,14,16,16,0,'z','hall');floor('hall-roof-back',0,28,14,12,16,0,'z','hall');
  floor('upper-gallery-west',-13.5,12,7,44,11,0,'z','gallery');floor('upper-gallery-east',13.5,12,7,44,11,0,'z','gallery');
  floor('upper-gallery-back',0,30,20,8,11,0,'z','gallery');
  for(const z of [-3,18,28])arch(0,z,4,23,11.5,'hall');
  prop('tidal_throne',0,29,11,'gallery',1.6);prop('astrolabe',0,12,4,'hall',1.5);
  for(const x of [-12,12])for(const z of [0,23])prop('coral_planter',x,z,4,'hall',1.1);
  // The western covered route turns three times before reaching the sunken archive.
  floor('arcade-entry',-39,-14,20,8,1.2,0,'z','arcade');floor('arcade-west',-47,0,8,36,1.2,0,'z','arcade');
  floor('arcade-turn',-39,14,24,8,1.2,0,'z','arcade');floor('arcade-exit',-31,24,8,20,1.2,0,'z','arcade');
  for(const [id,x,z,w,depth] of [['entry',-39,-14,20,8],['west',-47,0,8,36],['turn',-39,14,24,8],['exit',-31,24,8,20]])floor('arcade-roof-'+id,x,z,w,depth,9.2,0,'z','arcade',.55);
  wall('arcade-west-wall',-51,0,1,36,1.2,8,'arcade');wall('arcade-north-wall',-39,-18,25,1,1.2,8,'arcade');
  wall('arcade-inner-one',-43,0,1,20,1.2,8,'arcade');wall('arcade-inner-two',-37,10,12,1,1.2,8,'arcade');
  wall('arcade-turn-south',-43,18,16,1,1.2,8,'arcade');wall('arcade-exit-east',-27,26,1,24,1.2,8,'arcade');
  wall('arcade-exit-west',-35,24,1,12,1.2,8,'arcade');
  for(const z of [-10,4])arch(-47,z,1.2,7,7.6,'arcade');arch(-31,25,1.2,7,7.6,'arcade');
  room('archive',-35,42,24,24,1.2,9,{north:{at:-31,w:8,h:7},east:{at:42,w:7,h:7},west:{at:40,w:5,h:6}},'archive');floor('archive-roof',-35,42,25,25,10.2,0,'z','archive');
  for(const x of [-43,-27])prop('tablet_shelf',x,46,1.2,'archive',1.1,Math.PI/2);
  prop('chart_table',-35,46,1.2,'archive');
  room('crypt',-55,40,16,14,.9,7,{east:{at:40,w:5,h:6}},'crypt');floor('crypt-roof',-55,40,17,15,7.9,0,'z','crypt');
  prop('pearl_cache',-59,42,.9,'crypt',1.6);prop('amphora',-59,36,.9,'crypt',1.6);
  floor('archive-back-road',-12,42,22,8,1.2,2.8,'x','roads');floor('back-road',13,42,32,8,4,0,'z','roads');
  floor('east-crossing',22,12,10,8,4,0,'z','roads');
  room('tideworks',37,13,22,30,3,11,{north:{at:37,w:7,h:8},south:{at:37,w:8,h:8},west:{at:12,w:8,h:8}},'tideworks');
  floor('tideworks-roof',37,13,23,31,14,0,'z','tideworks');
  floor('tideworks-approach',37,-6,8,8,1.2,1.8,'-z','roads');floor('tideworks-south-road',37,33,8,12,1.2,1.8,'z','roads');
  prop('tide_engine',39,16,3,'tideworks',1.6);prop('tablet_shelf',44,6,3,'tideworks',1.3,Math.PI/2);
  floor('conservatory',38,47,30,26,1.2,0,'z','reef');
  for(const x of [25,51])for(const z of [36,58])prop('coral_spire',x,z,1.2,'reef',1.2);
  for(const [x,z,s] of [[31,53,1.5],[45,40,1.4],[48,53,1.8]])prop('coral_planter',x,z,1.2,'reef',s);
  arch(38,58,1.2,18,10,'reef');arch(50,46,1.2,18,10,'reef',Math.PI/2);
  // An upper room looks back into the nave and out over the coral gardens.
  room('observatory',0,44,26,20,11,9,{north:{at:0,w:12,h:8},east:{at:44,w:8,h:7},west:{at:44,w:8,h:7}},'observatory');
  floor('observatory-roof-west',-10,44,7,21,20,0,'z','observatory');floor('observatory-roof-east',10,44,7,21,20,0,'z','observatory');
  floor('observatory-roof-north',0,36,13,5,20,0,'z','observatory');floor('observatory-roof-south',0,52,13,5,20,0,'z','observatory');
  prop('astrolabe',0,49,11,'observatory',1.3);prop('pearl_cache',-8,49,11,'observatory');
  // Refuges are explicitly placed away from dart targets and main doorways.
  for(const [id,x,z,y,sector] of [['approach',-64,-76,12,'gate'],['gate',6,-55,8,'gate'],['market',-5,-32,7,'market'],['entry',-30,-14,6,'arcade'],['arcade',-47,-7,6,'arcade'],['turn',-31,20,6,'arcade'],['crypt',-53,40,5,'crypt'],['road',-5,42,6.5,'roads'],['crossing',22,12,7.5,'roads'],['nave',4,9,10,'hall'],['archive',-34,38,6.2,'archive'],['tideworks',34,7,9,'tideworks'],['reef',38,46,7,'reef'],['crown',0,42,16,'observatory']]){
    d.airbells.push({id,x,z,y,r:2.4});prop('airbell',x,z,y,sector);wall('airbell-cap-'+id,x,z,5.2,5.2,y+2.1,.35,sector,'hidden');
  }
  relic('archive','Chart of the Lost Tides',-40,49,1.2,'archive','A folded coast map marks safe airbells through the city. The pearl crypt lies beyond the low western doorway.');
  relic('tideworks','The Tidekeeper’s Record',43,22,3,'tideworks','The city once timed its gates to the moon. Follow the palace’s open water shaft to the crown gallery.');
  relic('crown','The Last Star Chart',7,48,11,'observatory','Three records preserve the city’s memory. The open oculus above this room is a direct route back to daylight.');
  zone('gate','The Drowned Causeway',0,-60,22,50,0,20,'Follow the lantern road beneath the arches. Brass airbells replenish your breath.');
  zone('market','Shellmarket',0,-28,70,34,0,14,'Shell stalls, fallen amphorae and old guardians. A covered passage turns west; the palace rises ahead.');
  zone('hall','The Tidal Nave',0,12,34,44,1,9,'Swim through the vaulted palace or rise through its open center to the royal galleries.');
  zone('arcade','The Kelp Arcade',-39,7,28,58,0,10,'Three sheltered turns lead toward the archive. Blue lamps and airbells mark the route.');
  zone('archive','The Sunken Archive',-35,42,24,24,0,10,'Stone tablets survived where paper could not. The low western doorway conceals a pearl cache.');
  zone('crypt','The Pearl Crypt',-55,40,16,14,0,8,'A quiet side chamber, hidden beyond the archive. Light catches on the old pearl coffers.');
  zone('tideworks','The Tideworks',37,13,22,30,1,12,'The old tide engine is still turning. Two outer doors make a loop through the coral gardens.');
  zone('reef','The Coral Conservatory',38,47,30,26,0,18,'Corals have reclaimed the colonnades. This open garden provides an easy route to the surface.');
  zone('gallery','The Royal Galleries',0,12,34,44,10,6,'A high balcony surrounds the nave. Follow it south toward the crown observatory.');
  zone('observatory','The Crown Observatory',0,44,26,20,10,13,'The city’s final star chart waits below an open oculus. Rise here to return to the sea above.');
  for(const [x,z] of [[-5,-78],[5,-65],[-10,-41],[12,-19],[-38,-14],[-47,13],[-31,26],[-42,41],[-20,42],[23,12],[37,-5],[37,32],[47,47],[8,36]])prop('reef_lantern',x,z,1.2,'roads');
  // Lamps stand on the road at their own location, including its raised ramps.
  for(const p of d.props.filter(p=>p.kind==='reef_lantern'))for(const f of d.floors){
    if(Math.abs(p.x-f.x)>f.w/2||Math.abs(p.z-f.z)>f.d/2)continue;
    const t=f.axis==='x'?(p.x-f.x)/f.w+.5:f.axis==='-x'?.5-(p.x-f.x)/f.w:f.axis==='-z'?(p.z-f.z)/f.d+.5:.5-(p.z-f.z)/f.d;
    const y=f.y+f.rise*Math.max(0,Math.min(1,t));if(y<=5)p.y=Math.max(p.y,y);
  }
  for(const [i,s] of [[-60,-28],[-60,15],[57,-12],[58,28],[-16,61],[13,-70]].entries())prop('coral_planter',s[0],s[1],0,'reef',1.2+(i%3)*.3);
  // The lower city is built on masonry plinths sunk below the entire rippled
  // seabed, not thin suspended slabs. Upper floors/roofs remain open below.
  const foundationBase=-1.2;
  for(const f of d.floors)if(f.y+f.rise<=4)f.thickness=round(f.y+f.rise-foundationBase);
  // The crown projects above the back road: piers support it while leaving
  // the east/west swimming passage beneath the observatory open.
  for(const x of [-11.5,11.5])for(const z of [35.5,52.5]){
    wall(`observatory-foundation-${x}-${z}`,x,z,3,3,foundationBase,11-foundationBase,'observatory','foundation');
  }
  d.routeHints={lower:[[0,-55],[0,-32],[-25,-32],[-25,-14],[-47,-14],[-47,14],[-31,14],[-31,38],[-40,49],[-35,40],[-55,40],[-35,40],[-35,42],[-18,42],[0,42],[24,42],[37,42],[38,47],[37,30],[37,13],[43,22],[37,12],[20,12],[0,12]],upper:[[0,12],[13.5,12],[13.5,30],[0,30],[0,44],[7,48]]};
  return d;
}
for(const data of [castle(),atlantis()]){
  writeFileSync(new URL(`../../../src/landmarks/${data.id}.json`,import.meta.url),JSON.stringify(data,(_,v)=>typeof v==='number'?round(v):v,2)+'\n');
  console.log(`${data.id}: ${data.floors.length} floors, ${data.walls.length} wall sections, ${data.zones.length} places, ${data.props.length} props`);
}
