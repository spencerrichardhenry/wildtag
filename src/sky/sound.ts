/** A single quiet wind bed, filtered by shelter; no per-frame audio allocations. */
export class SkySound {
  private context:AudioContext|null=null;
  private gain:GainNode|null=null;
  private filter:BiquadFilterNode|null=null;
  private last=-1;
  constructor(){document.addEventListener('visibilitychange',()=>{if(document.hidden)this.update(false,false);});}
  update(active:boolean,sheltered:boolean):void {
    const target=active?(sheltered?.004:.015):0;
    if(target===this.last)return;
    if(!this.context){
      if(!active||!document.pointerLockElement)return;
      const Ctor=window.AudioContext;if(!Ctor)return;
      this.context=new Ctor();
      const buffer=this.context.createBuffer(1,this.context.sampleRate*3,this.context.sampleRate),samples=buffer.getChannelData(0);
      let value=0,seed=8801;
      for(let i=0;i<samples.length;i++){seed=(seed*1664525+1013904223)>>>0;value=(value+(seed/4294967296-.5)*.13)/1.02;samples[i]=value*3;}
      const source=this.context.createBufferSource();source.buffer=buffer;source.loop=true;
      this.filter=this.context.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=950;
      this.gain=this.context.createGain();this.gain.gain.value=0;source.connect(this.filter).connect(this.gain).connect(this.context.destination);source.start();
    }
    this.last=target;this.gain!.gain.setTargetAtTime(target,this.context.currentTime,.8);this.filter!.frequency.setTargetAtTime(sheltered?300:950,this.context.currentTime,.8);
    if(this.context.state==='suspended'&&active)void this.context.resume();
  }
}
