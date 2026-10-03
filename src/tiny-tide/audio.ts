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
  guardBreak() { this.tone(560, 0, .05, 'square'); this.tone(240, .03, .16, 'sawtooth'); }
  /** The rising wind-up tones (a cue only: the telegraph never needs the sound), one per action. */
  private readonly windups = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  /** This frame's wind-ups at the player, by action id and fill (0–1). A tone starts with its action, its pitch and volume follow the fill
   *  (so a later director extension slows it), and it stops when the action is not in the list (active, interrupted or gone). */
  windupTones(fills: ReadonlyMap<string, number>) {
    for (const [id, w] of this.windups) if (!fills.has(id)) { this.stopTone(w); this.windups.delete(id); }
    if (!this.context || !this.bus || this.muted) { for (const w of this.windups.values()) this.stopTone(w); this.windups.clear(); return; }
    const now = this.context.currentTime;
    for (const [id, fill] of fills) {
      let w = this.windups.get(id);
      if (!w) {
        const osc = this.context.createOscillator(), gain = this.context.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(220, now); gain.gain.setValueAtTime(0, now);
        osc.connect(gain); gain.connect(this.bus); osc.start(now); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        w = { osc, gain }; this.windups.set(id, w);
      }
      const f = Math.max(0, Math.min(1, fill));
      w.osc.frequency.setTargetAtTime(220 * (520 / 220) ** f, now, .03); w.gain.gain.setTargetAtTime(.18 * f, now, .03);
    }
  }
  private stopTone(w: { osc: OscillatorNode; gain: GainNode }) {
    if (!this.context) return;
    const now = this.context.currentTime; w.gain.gain.cancelScheduledValues(now); w.gain.gain.setTargetAtTime(0, now, .015); w.osc.stop(now + .08);
  }
}
