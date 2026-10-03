export class TideAudio {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  muted = false;
  init() {
    if (!this.context) { this.context = new AudioContext(); this.bus = this.context.createGain(); this.bus.gain.value = this.muted ? 0 : .16; this.bus.connect(this.context.destination); }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }
  toggle() { this.muted = !this.muted; if (this.bus && this.context) this.bus.gain.setTargetAtTime(this.muted ? 0 : .16, this.context.currentTime, .04); }
  tone(frequency: number, start = 0, length = .14, type: OscillatorType = 'sine') {
    if (!this.context || !this.bus || this.muted) return;
    const now = this.context.currentTime + start, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(frequency * .7, now + length);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.5, now + .01); gain.gain.exponentialRampToValueAtTime(.001, now + length);
    osc.connect(gain); gain.connect(this.bus); osc.start(now); osc.stop(now + length + .02); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  bite(combo: number) { this.tone(420 + combo % 7 * 60, 0, .11); this.tone(760 + combo % 7 * 70, .04, .12); }
  evolve() { [0, 4, 7, 12, 16].forEach((note, i) => this.tone(330 * 2 ** (note / 12), i * .12, .4, 'triangle')); }
  hurt() { this.tone(150, 0, .2, 'sawtooth'); this.tone(110, .06, .24, 'triangle'); }
  faint() { [12, 7, 3, 0].forEach((note, i) => this.tone(220 * 2 ** (note / 12), i * .14, .35, 'triangle')); }
  found() { [0, 7, 12, 19].forEach((note, i) => this.tone(520 * 2 ** (note / 12), i * .07, .18)); }
  breach() { this.tone(190, 0, .22, 'triangle'); this.tone(570, .12, .25); }
  // Combat (spec §9.2): one sound per outcome, and the rising wind-up tone (a cue only: the telegraph never needs the sound).
  hit() { this.tone(300, 0, .08, 'square'); this.tone(180, .02, .1, 'triangle'); }
  block() { this.tone(900, 0, .06, 'triangle'); this.tone(620, .03, .1, 'triangle'); }
  counter() { [0, 7, 12].forEach((note, i) => this.tone(660 * 2 ** (note / 12), i * .04, .12, 'triangle')); }
  dash() { this.tone(420, 0, .12, 'sine'); this.tone(840, .03, .1, 'sine'); }
  grab() { this.tone(240, 0, .14, 'sawtooth'); }
  breakFree() { this.tone(520, 0, .08, 'triangle'); this.tone(780, .05, .12, 'triangle'); }
  /** A quiet tone that rises over `seconds` (the time left to the active start). */
  windup(seconds: number) {
    if (!this.context || !this.bus || this.muted || seconds <= 0) return;
    const now = this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(220, now); osc.frequency.exponentialRampToValueAtTime(520, now + seconds);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.18, now + seconds); gain.gain.linearRampToValueAtTime(0, now + seconds + .05);
    osc.connect(gain); gain.connect(this.bus); osc.start(now); osc.stop(now + seconds + .06); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
}
