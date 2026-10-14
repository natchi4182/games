// WebAudio で全部合成する効果音と BGM（音声ファイル不要）

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgmOn = true;
    this._voices = 0;
    this._bgmTimer = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.0;
      this.bgmGain.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.8 : 0;
  }

  get t() { return this.ctx.currentTime; }

  _ok() {
    if (!this.ctx || !this.enabled) return false;
    if (this._voices > 10) return false;
    this._voices++;
    setTimeout(() => this._voices--, 120);
    return true;
  }

  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noise(t, dur, freq, q, peak, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, 0.003, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  _tone(t, type, f0, f1, dur, peak, dest = this.master) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, 0.005, peak, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** ハンマーが当たった音。material: plant / wood / stone / metal / brick */
  hit(material = 'stone', big = false) {
    if (!this._ok()) return;
    const t = this.t, v = big ? 1.4 : 1;
    this._tone(t, 'sine', 170 * v, 45, 0.14, 0.55);
    switch (material) {
      case 'plant': this._noise(t, 0.12, 3200, 0.8, 0.35, 'highpass'); break;
      case 'wood': this._noise(t, 0.09, 900, 3, 0.5); this._tone(t, 'triangle', 420, 300, 0.08, 0.2); break;
      case 'metal':
        this._noise(t, 0.05, 2500, 2, 0.3);
        this._tone(t, 'square', 640 + Math.random() * 80, 620, 0.35, 0.06);
        this._tone(t, 'sine', 1310, 1300, 0.4, 0.08);
        break;
      case 'brick': this._noise(t, 0.14, 700, 1.4, 0.55); break;
      default: this._noise(t, 0.12, 520, 1.2, 0.6);
    }
  }

  smash() {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    this._tone(t, 'sine', 120, 35, 0.35, 0.8);
    this._noise(t, 0.45, 400, 0.7, 0.7);
    this._noise(t + 0.05, 0.3, 1800, 1, 0.25);
  }

  coin() {
    if (!this._ok()) return;
    const t = this.t;
    this._tone(t, 'square', 988, 988, 0.06, 0.08);
    this._tone(t + 0.06, 'square', 1319, 1319, 0.16, 0.08);
  }

  pop() {
    if (!this._ok()) return;
    const t = this.t;
    this._tone(t, 'sine', 500, 1100, 0.1, 0.3);
  }

  cheer() {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    [660, 880, 1100].forEach((f, i) => this._tone(t + i * 0.05, 'triangle', f, f * 1.3, 0.12, 0.18));
  }

  click() {
    if (!this.ctx || !this.enabled) return;
    this._tone(this.t, 'triangle', 700, 500, 0.06, 0.25);
  }

  shutter() {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    this._noise(t, 0.04, 3000, 1, 0.5);
    this._noise(t + 0.08, 0.05, 2200, 1, 0.4);
  }

  buy() {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) => this._tone(t + i * 0.06, 'square', f, f, 0.1, 0.07));
  }

  fanfare() {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.12, 'square', f, f, i === notes.length - 1 ? 0.6 : 0.14, 0.09);
      this._tone(t + i * 0.12, 'triangle', f / 2, f / 2, 0.14, 0.15);
    });
  }

  // --- BGM: ゆるいペンタトニックのループ ---
  startBgm() {
    if (!this.ctx || this._bgmTimer) return;
    this.bgmGain.gain.setTargetAtTime(this.bgmOn ? 0.5 : 0, this.t, 0.5);
    const bpm = 116, step = 60 / bpm / 2;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = [0, 2, 4, 2, 5, 4, 2, -1, 3, 4, 5, 7, 5, 4, 2, -1, 0, 2, 4, 5, 4, 2, 1, -1, 2, 1, 0, 1, 2, -1, 0, -1];
    const bass = [0, 0, 5, 5, 3, 3, 4, 4];
    let i = 0, next = this.t + 0.1;
    const base = 392; // G4
    const hz = (deg) => base * Math.pow(2, (scale[((deg % 8) + 8) % 8] + 12 * Math.floor(deg / 8)) / 12);
    this._bgmTimer = setInterval(() => {
      while (next < this.t + 0.3) {
        const m = mel[i % mel.length];
        if (m >= 0) this._tone(next, 'triangle', hz(m), hz(m), step * 0.9, 0.12, this.bgmGain);
        if (i % 4 === 0) {
          const b = bass[(i / 4) % bass.length];
          this._tone(next, 'sine', hz(b) / 4, hz(b) / 4, step * 3.5, 0.22, this.bgmGain);
        }
        if (i % 2 === 1) this._tone(next, 'square', 3000, 2000, 0.02, 0.015, this.bgmGain);
        i++; next += step;
      }
    }, 80);
  }

  setBgm(on) {
    this.bgmOn = on;
    if (this.bgmGain) this.bgmGain.gain.setTargetAtTime(on ? 0.5 : 0, this.t, 0.2);
  }
}
