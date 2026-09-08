import type { AmmoId } from './layout';

export class Sound {
  context?: AudioContext;
  muted = false;
  unlock() { this.context ??= new AudioContext(); void this.context.resume(); }
  tone(freq: number, end: number, length: number, volume = .08, type: OscillatorType = 'sine') {
    if (!this.context || this.muted) return;
    const c = this.context, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime); o.frequency.exponentialRampToValueAtTime(end, c.currentTime + length);
    g.gain.setValueAtTime(volume, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + length);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + length);
  }
  launch(kind: AmmoId) {
    this.tone(190, 65, .2, .09, 'triangle');
    if (kind === 'cow') { this.tone(145, 90, .75, .1, 'sawtooth'); this.tone(148, 95, .65, .06, 'sine'); }
  }
  impact(power: number) {
    if (!this.context || this.muted) return;
    const c = this.context, duration = .4 + power * .15;
    const buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 2);
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 700;
    gain.gain.value = .13 * Math.min(power, 1.5);
    source.connect(filter); filter.connect(gain); gain.connect(c.destination); source.start();
    this.tone(88, 25, duration, .12);
  }
}
