import type { MoveState, Vec3 } from '../core/types.ts';
import { hitBox, type SkyBox } from '../sky/collision.ts';

export interface Floor {id:string;x:number;z:number;w:number;d:number;y:number;rise:number;axis:string;sector:string;thickness:number}
export interface Wall {id:string;x:number;z:number;w:number;d:number;y:number;h:number;sector:string;style:string}
export interface Arch {x:number;z:number;w:number;y:number;h:number;sector:string;yaw:number}
export interface Prop {kind:string;x:number;z:number;y:number;sector:string;s:number;yaw:number}
export interface Zone {id:string;name:string;x:number;z:number;w:number;d:number;y:number;h:number;story:string}
export interface Relic {id:string;name:string;x:number;z:number;y:number;story:string}
export interface Airbell {id:string;x:number;z:number;y:number;r:number}
export interface Tower {x:number;z:number;y:number;r:number;h:number;sector:string;spire?:boolean}
export interface LandmarkLayout {id:string;center:Vec3;floors:Floor[];walls:Wall[];arches:Arch[];props:Prop[];zones:Zone[];relics:Relic[];airbells:Airbell[];towers:Tower[]}
type Hit=NonNullable<ReturnType<typeof hitBox>>;
const CELL=16;
export function floorLevel(f:Floor,x:number,z:number):number {
  const t=f.axis==='x'?(x-f.x)/f.w+.5:f.axis==='-x'?.5-(x-f.x)/f.w:f.axis==='-z'?(z-f.z)/f.d+.5:.5-(z-f.z)/f.d;
  return f.y+f.rise*Math.max(0,Math.min(1,t));
}
/** Static spatial index shared by foot movement, swimming, roofs and projectiles.
 * Queries visit nearby cells rather than every wall of the castle's large ward. */
export class Architecture {
  readonly boxes:SkyBox[]=[];
  private readonly cells=new Map<string,Set<SkyBox>>();
  private readonly floorCells=new Map<string,Set<Floor>>();
  private readonly ramps:Floor[];
  readonly bounds={min:{x:Infinity,y:Infinity,z:Infinity},max:{x:-Infinity,y:-Infinity,z:-Infinity}};
  constructor(readonly layout:LandmarkLayout){
    const c=layout.center;
    const add=(id:string,x:number,y:number,z:number,w:number,h:number,d:number,floor=false)=>{
      if(w<=0||h<=0||d<=0)return;
      const b={id,floor,min:{x:c.x+x-w/2,y:c.y+y,z:c.z+z-d/2},max:{x:c.x+x+w/2,y:c.y+y+h,z:c.z+z+d/2}};
      this.boxes.push(b);this.index(this.cells,b,b.min.x,b.min.z,b.max.x,b.max.z);
      for(const k of ['x','y','z'] as const){this.bounds.min[k]=Math.min(this.bounds.min[k],b.min[k]);this.bounds.max[k]=Math.max(this.bounds.max[k],b.max[k]);}
    };
    for(const f of layout.floors){
      this.index(this.floorCells,f,c.x+f.x-f.w/2,c.z+f.z-f.d/2,c.x+f.x+f.w/2,c.z+f.z+f.d/2);
      if(!f.rise)add(f.id,f.x,f.y-f.thickness,f.z,f.w,f.thickness,f.d,true);
    }
    for(const w of layout.walls)add(w.id,w.x,w.y,w.z,w.w,w.h,w.d);
    for(const [i,a] of layout.arches.entries())for(const side of [-1,1])add(`arch-${i}-${side}`,a.x+Math.cos(a.yaw)*side*a.w/2,a.y,a.z-Math.sin(a.yaw)*side*a.w/2,.65,a.h*.6,.65);
    // Towers are solid octagonal bastions. Overlapping inscribed boxes approximate
    // their broad faces while the top slabs provide a real perch/landing surface.
    for(const [i,t] of layout.towers.entries()){
      add('tower-a-'+i,t.x,t.y,t.z,t.r*2,t.h,t.r*1.4);
      add('tower-b-'+i,t.x,t.y,t.z,t.r*1.4,t.h,t.r*2);
    }
    this.ramps=layout.floors.filter(f=>f.rise!==0);
  }
  private index<T>(map:Map<string,Set<T>>,item:T,x1:number,z1:number,x2:number,z2:number):void {
    for(let x=Math.floor(x1/CELL);x<=Math.floor(x2/CELL);x++)for(let z=Math.floor(z1/CELL);z<=Math.floor(z2/CELL);z++){
      const key=`${x},${z}`;let cell=map.get(key);if(!cell)map.set(key,cell=new Set());cell.add(item);
    }
  }
  contains(p:Vec3,margin=0):boolean {const b=this.bounds;return p.x>=b.min.x-margin&&p.x<=b.max.x+margin&&p.z>=b.min.z-margin&&p.z<=b.max.z+margin&&p.y>=b.min.y-margin;}
  private candidates(a:Vec3,b:Vec3,r=0,height=0):Set<SkyBox> {
    const out=new Set<SkyBox>(),lo=this.bounds.min,hi=this.bounds.max;
    if(Math.max(a.x,b.x)+r<lo.x||Math.min(a.x,b.x)-r>hi.x||Math.max(a.z,b.z)+r<lo.z||Math.min(a.z,b.z)-r>hi.z||Math.max(a.y,b.y)+height<lo.y||Math.min(a.y,b.y)>hi.y)return out;
    for(let x=Math.floor((Math.max(lo.x,Math.min(a.x,b.x)-r))/CELL);x<=Math.floor(Math.min(hi.x,Math.max(a.x,b.x)+r)/CELL);x++)for(let z=Math.floor(Math.max(lo.z,Math.min(a.z,b.z)-r)/CELL);z<=Math.floor(Math.min(hi.z,Math.max(a.z,b.z)+r)/CELL);z++)for(const box of this.cells.get(`${x},${z}`)??[])out.add(box);
    return out;
  }
  floorBelow(x:number,z:number,maxY:number):number {
    const c=this.layout.center;let top=-Infinity;
    for(const f of this.floorCells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]){
      if(Math.abs(x-c.x-f.x)>f.w/2||Math.abs(z-c.z-f.z)>f.d/2)continue;
      const y=c.y+floorLevel(f,x-c.x,z-c.z);if(y<=maxY+.0001)top=Math.max(top,y);
    }
    return top;
  }
  private hitRamp(a:Vec3,b:Vec3,radius=0,height=0):Hit|null {
    let best:Hit|null=null;const c=this.layout.center;
    for(const f of this.ramps){
      const ay=c.y+floorLevel(f,a.x-c.x,a.z-c.z),by=c.y+floorLevel(f,b.x-c.x,b.z-c.z);
      for(const underside of [false,true]){
        const da=a.y+(underside?height+f.thickness:0)-ay,db=b.y+(underside?height+f.thickness:0)-by;
        if(underside?!(da<-.0001&&db>=0):!(da>.0001&&db<=0))continue;
        const t=da/(da-db),point={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
        if(Math.abs(point.x-c.x-f.x)>f.w/2+radius||Math.abs(point.z-c.z-f.z)>f.d/2+radius)continue;
        if(!best||t<best.t)best={t,point,axis:'y',normal:underside?-1:1};
      }
    }
    return best;
  }
  raycast(a:Vec3,b:Vec3):Vec3|null {
    if(!this.contains(a,120)&&!this.contains(b,120))return null;
    let best=this.hitRamp(a,b);
    for(const box of this.candidates(a,b)){const h=hitBox(a,b,box);if(h&&(!best||h.t<best.t))best=h;}
    return best?.point??null;
  }
  resolve(previous:Vec3,next:MoveState,radius:number):MoveState {
    if(!this.contains(previous,4)&&!this.contains(next.pos,4))return next;
    let a={...previous},b={...next.pos},vel={...next.vel},grounded=next.grounded;
    const boxes=this.candidates(a,b,radius,1.72);
    for(let pass=0;pass<4;pass++){
      let best=this.hitRamp(a,b,radius,1.72);
      for(const box of boxes){
        if(next.mode!=='swim'&&box.floor&&previous.y>=box.max.y-.48&&(b.y>=box.max.y-.001||next.grounded&&b.y>=previous.y-.1))continue;
        const h=hitBox(a,b,box,radius,1.72);if(h&&(!best||h.t<best.t))best=h;
      }
      if(!best)break;
      const remaining={x:b.x-best.point.x,y:b.y-best.point.y,z:b.z-best.point.z};a={...best.point};a[best.axis]+=best.normal*.001;remaining[best.axis]=0;vel[best.axis]=0;
      if(best.axis==='y'&&best.normal>0)grounded=true;
      b={x:a.x+remaining.x,y:a.y+remaining.y,z:a.z+remaining.z};
    }
    return {...next,pos:b,vel,grounded};
  }
}
