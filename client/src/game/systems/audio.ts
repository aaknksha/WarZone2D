// Tiny WebAudio synth: no audio files needed. Starts on the first user gesture (browser autoplay rules).
class AudioFx {
  private ctx: AudioContext | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("wz2d-muted") === "1";
    } catch {
      /* storage unavailable: default unmuted */
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem("wz2d-muted", m ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const c = this.muted ? null : this.ensure();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    const c = this.muted ? null : this.ensure();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(c.destination);
    s.start();
  }

  /** `v` is 0..1 loudness (distance falloff). */
  shoot(v = 1): void {
    this.noise(0.12, 0.35 * v, 2600);
    this.tone(220, 60, 0.1, "square", 0.12 * v);
  }
  hit(v = 1): void {
    this.tone(180, 90, 0.09, "sawtooth", 0.18 * v);
  }
  kill(v = 1): void {
    this.noise(0.4, 0.4 * v, 900);
    this.tone(140, 30, 0.45, "sawtooth", 0.2 * v);
  }
  /** Countdown tick (3-2-1). */
  beep(): void {
    this.tone(520, 520, 0.14, "square", 0.1);
  }
  /** "FIGHT!" air-horn. */
  fight(): void {
    this.tone(220, 220, 0.55, "sawtooth", 0.16);
    this.tone(330, 330, 0.55, "sawtooth", 0.11);
    this.tone(440, 440, 0.6, "square", 0.07);
    this.noise(0.3, 0.14, 1800);
  }
  respawn(): void {
    this.tone(300, 900, 0.25, "sine", 0.14);
    this.tone(600, 1200, 0.2, "triangle", 0.08, 0.12);
  }
  victory(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.24, "square", 0.1, i * 0.15));
  }
  defeat(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.3, "sawtooth", 0.08, i * 0.22));
  }
  draw(): void {
    [440, 440].forEach((f, i) => this.tone(f, f, 0.3, "triangle", 0.1, i * 0.25));
  }
  click(): void {
    this.tone(520, 700, 0.05, "square", 0.08);
  }
}

export const audio = new AudioFx();
