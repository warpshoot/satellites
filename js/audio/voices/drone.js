import { Voice } from './base.js';
import { quantize } from '../music.js';

// 微妙にデチューンした複数オシレータを重ねた持続音。土台担当。
// 散らし方は等間隔にしない。左右対称に並べると、うなりの周期まで揃って
// 「重ねた」ではなく「ずらした1本」に聞こえる。
const SPREAD = [0, 1, -0.79, 1.62, -1.41];

export class DroneVoice extends Voice {
  static type = 'drone';
  static label = 'DRONE';
  static look = 'band';
  static color = '#6f9dff';
  static defaults = { freq: 80, count: 3, detune: 12, wave: 'sawtooth', width: 0.6 };
  static params = [
    { key: 'freq', label: '基音', min: 20, max: 2000, scale: 'log', unit: 'Hz' },
    { key: 'count', label: 'オシレータ数', min: 1, max: 5, scale: 'int' },
    // 100cent = 半音。振り切ると崩れる手前まで行ける。下は 1cent 刻みで効く。
    { key: 'detune', label: 'デチューン', min: 0, max: 100, scale: 'pow', unit: 'cent' },
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
      osc.frequency.value = this._freqAt(i);
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
    const max = Math.max.apply(null, SPREAD.slice(0, n).map(Math.abs));
    return SPREAD[i] / (max || 1);
  }

  // 基音だけ音階に吸着させる。デチューンは吸着させない（潰れて意味が消える）
  _freqAt(i, mul) {
    const base = quantize(this.params.freq, this.tuning);
    const cents = SPREAD[i % SPREAD.length] * this.params.detune * (mul == null ? 1 : mul);
    return base * Math.pow(2, cents / 1200);
  }

  _retuneAll(tc) {
    if (!this.oscs) return;
    const mul = this._driftMul || 1;
    this.oscs.forEach((o, i) => this.engine.ramp(o.frequency, this._freqAt(i, mul), tc));
  }

  retune() {
    this._retuneAll(0.4);
  }

  // デチューン量そのものを超低速で動かす。うなりの速さが呼吸する。
  applyDrift(d, t) {
    this._driftMul = 1 + this.driftAt(2, t) * d * 0.4;
    this._retuneAll(0.4);
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
    this._retuneAll(0.05);
  }
}
