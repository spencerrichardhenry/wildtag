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
  breach() { this.tone(190, 0, .22, 'triangle'); this.tone(570, .12, .25); }
}
