import { CONFIG } from '../config';

/**
 * Musica di sottofondo del volo. Se CONFIG.flight.musicUrl indica un file (MP3/OGG) lo suona in loop;
 * altrimenti genera dal vivo un tappeto sonoro evocativo (accordi lenti con riverbero e qualche nota
 * di campana). Durante il parlato si abbassa fino quasi al silenzio.
 */
export class AmbientMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private el: HTMLAudioElement | null = null;
  private timer = 0;
  private step = 0;
  private ducked = false;
  private on = false;

  start() {
    if (this.on) return;
    this.on = true;
    const F = CONFIG.flight;
    if (F.musicUrl) {
      this.el = new Audio(F.musicUrl);
      this.el.loop = true;
      this.el.volume = this.ducked ? F.musicDuck : F.musicVolume;
      this.el.play().catch(() => {});
      return;
    }
    try {
      this.ctx ??= new AudioContext();
      this.ctx.resume().catch(() => {});
    } catch { this.on = false; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.ducked ? F.musicDuck : F.musicVolume, ctx.currentTime + 4);
    // riverbero: risposta all'impulso generata (rumore che decade in ~4 s)
    const rev = ctx.createConvolver();
    const len = ctx.sampleRate * 4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    rev.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.45;
    rev.connect(wet).connect(this.master);
    dry.connect(this.master);
    this.master.connect(ctx.destination);
    const bus = ctx.createGain();
    bus.connect(rev); bus.connect(dry);
    this.step = 0;
    const tick = () => { if (this.on && this.ctx === ctx) this.chord(ctx, bus); };
    tick();
    this.timer = window.setInterval(tick, 8000);
  }

  /** Un accordo della progressione (Re maggiore: I – vi – IV – V con none), più una nota di campana. */
  private chord(ctx: AudioContext, out: AudioNode) {
    const prog = [[50, 57, 62, 66, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 64], [45, 52, 57, 61, 64]];
    const notes = prog[this.step++ % prog.length];
    const t0 = ctx.currentTime + 0.05, dur = 9.5;
    const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 0.7;
    filt.frequency.setValueAtTime(500, t0);
    filt.frequency.linearRampToValueAtTime(1400, t0 + 4);
    filt.frequency.linearRampToValueAtTime(600, t0 + dur);
    filt.connect(out);
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = m < 52 ? 'triangle' : 'sawtooth';
        o.frequency.value = hz(m); o.detune.value = det;
        const peak = (m < 52 ? 0.05 : 0.018);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 3);
        g.gain.setValueAtTime(peak, t0 + dur - 4);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(g).connect(filt);
        o.start(t0); o.stop(t0 + dur + 0.1);
      }
    }
    // campana: una nota della scala pentatonica, ogni tanto
    const penta = [74, 76, 78, 81, 83, 86];
    for (let k = 0; k < 2; k++) {
      if (Math.random() < 0.35) continue;
      const tb = t0 + 1.5 + Math.random() * 5, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = hz(penta[Math.floor(Math.random() * penta.length)]);
      g.gain.setValueAtTime(0, tb); g.gain.linearRampToValueAtTime(0.035, tb + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tb + 3.5);
      o.connect(g).connect(out); o.start(tb); o.stop(tb + 3.6);
    }
  }

  /** Abbassa (durante il parlato) o riporta su la musica, con una dissolvenza. */
  duck(on: boolean) {
    if (on === this.ducked) return;
    this.ducked = on;
    const F = CONFIG.flight, v = on ? F.musicDuck : F.musicVolume;
    if (this.el) this.el.volume = v;
    if (this.master && this.ctx) {
      const g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + (on ? 0.6 : 2.5));
    }
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    clearInterval(this.timer);
    if (this.el) { this.el.pause(); this.el = null; }
    if (this.master && this.ctx) {
      const m = this.master, t = this.ctx.currentTime;
      m.gain.cancelScheduledValues(t); m.gain.setValueAtTime(m.gain.value, t); m.gain.linearRampToValueAtTime(0, t + 1.5);
      setTimeout(() => m.disconnect(), 1800);
      this.master = null;
    }
  }
}
