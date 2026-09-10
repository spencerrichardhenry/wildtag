import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {heightAt} from '../../../src/world/terrain.ts';
const castle=JSON.parse(readFileSync(new URL('../../../src/landmarks/castle.json',import.meta.url)));
const sky=JSON.parse(readFileSync(new URL('../../../src/sky/layout-data.json',import.meta.url)));
const sea=JSON.parse(readFileSync(new URL('../../../src/landmarks/atlantis.json',import.meta.url)));
const items=[];
function add(id,region,name,x,z,action,story,theme,shape,options={}){
 const center=options.center;
 const pos={x:(center?.x??0)+x,z:(center?.z??0)+z,y:center?(center.y+(options.y??0)):heightAt(x,z)};
 const samples=[];for(const a of [-3,0,3])for(const b of [-3,0,3])samples.push(heightAt(pos.x+a,pos.z+b));
 const floors=[],walls=[];
 const wall=(id,x,z,w,d,y,h)=>walls.push({id,x,z,w,d,y,h,sector:'curiosity',style:'wall'});
 if(options.plinth){
  pos.y=Math.max(...samples)+.1;
  floors.push({id:'plinth',x:0,z:0,w:6,d:6,y:0,rise:0,axis:'z',thickness:pos.y-Math.min(...samples)+.6,sector:'curiosity'});
  const low=heightAt(pos.x,pos.z+7)-pos.y+.08;
  floors.push({id:'approach',x:0,z:5,w:3,d:4,y:low,rise:-low,axis:'z',thickness:2.8,sector:'curiosity'});
 }
 if(shape==='hollow'){
  wall('left-root',-1.8,0,1.2,4.8,-.4,2.9);wall('right-root',1.8,0,1.2,4.8,-.4,2.9);wall('canopy',0,0,4.5,4.8,2.9,.7);
 }else if(shape==='shelter'){
  for(const a of [-2.2,2.2])for(const b of [-1.8,1.8])wall('post-'+a+'-'+b,a,b,.3,.3,-.5,3.8);
  wall('roof',0,0,5.4,4.8,3.3,.4);wall('bench',0,-1.5,3.2,.7,0,.7);
 }else if(shape==='harp'){
  wall('harp-left',-1.8,0,.7,1,-.3,3.8);wall('harp-right',1.8,0,.7,1,-.3,3.8);
 }else if(shape==='laundry'){
  for(const x of [-2.2,2.2])wall('line-post-'+x,x,0,.22,.3,0,3.3);
 }else wall('body',0,-.3,shape==='skiff'?3.8:2,shape==='skiff'?2.2:1.4,-.25,shape==='cairn'?2.6:1.5);
 const radius=options.plinth?8:shape==='hollow'||shape==='shelter'?7:6;
 const approach={x:pos.x,y:center?pos.y:heightAt(pos.x,pos.z+4),z:pos.z+4};
 if(options.plinth)approach.y=pos.y+floors[1].y+floors[1].rise*.75;
 items.push({id,region,name,action,story,theme,shape,pos,radius,approach,focus:{x:pos.x,y:pos.y+1.4,z:pos.z+1},floors,walls});
}
add('bumblepost','meadow','The Bumblepost',-61,114,'Open the tiny mailbox','Letters smell of clover here. The little brass bee sends its visitors home with pollen on their feet.','meadow','mailbox');
add('tea-circle','meadow','The Unfinished Tea Party',197,130,'Warm the teapot','Three cups, four stools, and a kettle that never quite cools. Someone is always expected back.','meadow','tea');
add('rootlight','forest','Rootlight Hollow',106,-306,'Wake the fireflies','The fallen tree shelters a whole miniature night sky. Its lights settle back into the mushrooms when you leave.','forest','hollow');
add('woodpecker','forest','The Woodpecker’s Workshop',270,-168,'Wind the acorn wheel','A patient wooden bird has been making the same acorn into a masterpiece for years.','forest','workshop');
add('reed-organ','wetland','The Reed Organ',-34,279,'Play the reed pipes','A forgotten foot pump gives the marsh its own small orchestra. Even the frog-shaped keys join in.','wetland','organ');
add('moss-ferry','wetland','The Moss Ferry',-100,352,'Light the ferry lanterns','The water left this little ferry behind. Moss took the seats; someone still tends its lamps.','wetland','skiff');
add('windbone','crags','Windbone Harp',-122,211,'Strum the wind strings','The weathered ribs catch every passing gust. No two storms ever play exactly the same song.','crags','harp',{plinth:true});
add('prospector','crags','The Prospector’s Pocket',-241,56,'Turn the old winch','A cart of blue stone waits beneath the last beam. The winch still works, though its owner has gone wandering.','crags','mine',{plinth:true});
add('star-cairn','highlands','The Stargazer’s Cairn',-210,-266,'Turn the star mirror','The stones remember where the constellations rise. A bronze mirror turns a little daylight into a star.','highlands','cairn');
add('shepherd','highlands','The Bell Shepherd’s Shelter',-220,-349,'Ring the little bells','A dry bench, a spare cup, and bells tuned to carry through fog. It is still a good place to wait out the weather.','highlands','shelter');
add('bottle-post','coast','The Tide Post',216.2375,754.1098,'Uncork a sea letter','The tide delivers slowly. Every bottle contains a folded paper boat, ready for another voyage.','coast','bottles');
add('driftwatch','coast','Driftwood Lookout',709.8899,377.4551,'Turn the lookout glass','A patchwork telescope watches the offshore ruins. Tiny tin gulls wheel above its weather vane.','coast','lookout',{plinth:true});
add('rookery','castle','The Clockwork Rookery',-66,4,'Wind the brass rook','The watch kept a mechanical bird for days when the real ones refused to fly. It still checks its nest.','castle','rookery',{center:castle.center,y:8});
add('moon-garden','castle','The Midnight Potting Bench',6,-64,'Open the moonflower lantern','A warden grew flowers above the maze. Their pale moths still return to the little rooftop garden.','castle','garden',{center:castle.center,y:8});
add('shell-choir','atlantis','The Whale-song Shell',-74,-10,'Listen to the shell','Someone carved a listening seat into an enormous shell. The sea answers with a voice too deep to belong to anything nearby.','atlantis','shell',{center:sea.center,y:heightAt(sea.center.x-74,sea.center.z-10)-sea.center.y});
add('glassfin','atlantis','The Glassfin Nursery',68,42,'Ring the nursery chime','Small glassfins shelter in the coral rings. A soft note brings them together before they scatter among the fronds.','atlantis','nursery',{center:sea.center,y:heightAt(sea.center.x+68,sea.center.z+42)-sea.center.y});
add('cloud-laundry','sky','The Cloudkeeper’s Laundry',-42.5,23,'Give the line a gust','Cloudkeepers dry their scarves on the western terrace. Every cloth carries the shape of a different wind.','sky','laundry',{center:sky.center,y:4});
add('kite-garden','sky','The Weatherwright’s Kite Garden',14,-7,'Turn the weather wheel','Paper cranes circle a little wind machine. They have crossed more sky than their strings will ever allow.','sky','kites',{center:sky.center,y:4});
const out=new URL('../../../src/discoveries/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('data.json',out),JSON.stringify(items,(_,v)=>typeof v==='number'?Math.round(v*10000)/10000:v,2)+'\n');
console.log(`${items.length} standalone discoveries across ${new Set(items.map(p=>p.region)).size} regions`);
