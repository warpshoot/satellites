import { Voice } from './base.js';

// 微妙にデチューンした複数オシレータを重ねた持続音。土台担当。
export class DroneVoice extends Voice {
  static type = 'drone';
  static label = 'DRONE';
  static look = 'band';
  static color = '#6f9dff';
  static defaults = { freq: 80, count: 3, detune: 12, wave: 'sawtooth', width: 0.6 };
  static params = [
    { key: 'freq', label: '基音', min: 20, max: 500, scale: 'log', unit: 'Hz' },
    { key: 'count', label: 'オシレータ数', min: 1, max: 5, scale: 'int' },
    { key: 'detune', label: 'デチューン', min: 0, max: 50, scale: 'lin', unit: 'cent' },
    { key: 'width', label: '広がり', min: 0, max: 1, scale: 'lin' },
    { key: 'wave', label: '波形', type: 'select', options: ['sawtooth', 'triangle', 'sine', 'square'] }
  ];

  // 1点で最大5ボイス相当を食う
  weight() { return Math.round(this.params.count); }

  build() {
    const ctx = this.ctx;
    const n = Math.max(1, Math.round(this.params.count));
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.8 / Math.sqrt(n);
    this.mix.connect(this.envGain);
    this.oscs = [];
    this.pans = [];
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = this.params.wave;
      osc.frequency.value = this._freqAt(i, n);
      // デチューンした本数を左右に散らす。点のままだと土台に幅が出ない。
      const pan = ctx.createStereoPanner();
      pan.pan.value = this._spread(i, n) * this.params.width;
      osc.connect(pan);
      pan.connect(this.mix);
      osc.start();
      this.oscs.push(osc);
      this.pans.push(pan);
    }
  }

  _spread(i, n) {
    if (n < 2) return 0;
    return (i - (n - 1) / 2) / ((n - 1) / 2);
  }

  _freqAt(i, n) {
    const cents = (i - (n - 1) / 2) * this.params.detune;
    return this.params.freq * Math.pow(2, cents / 1200);
  }

  teardown() {
    if (this.pans) {
      for (const n of this.pans) { try { n.disconnect(); } catch (e) { /* noop */ } }
      this.pans = null;
    }
    if (this.oscs) {
      for (const o of this.oscs) {
        try { o.stop(); o.disconnect(); } catch (e) { /* noop */ }
      }
      this.oscs = null;
    }
    if (this.mix) { try { this.mix.disconnect(); } catch (e) { /* noop */ } this.mix = null; }
  }

  applyParam(key) {
    if (!this.oscs) return;
    if (key === 'count') return this.rebuild(); // 本数の変更は作り直し
    if (key === 'wave') {
      for (const o of this.oscs) o.type = this.params.wave;
      return;
    }
    if (key === 'width') {
      const n = this.oscs.length;
      this.pans.forEach((p, i) => this.engine.ramp(p.pan, this._spread(i, n) * this.params.width, 0.05));
      return;
    }
    const n = this.oscs.length;
    this.oscs.forEach((o, i) => this.engine.ramp(o.frequency, this._freqAt(i, n), 0.05));
  }
}
