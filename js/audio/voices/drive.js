import { Voice } from './base.js';
import { quantize } from '../music.js';

function makeCurve(amount) {
  const k = amount * 100;
  const n = 2048;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const y = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    curve[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  if (peak > 0) for (let i = 0; i < n; i++) curve[i] /= peak;
  return curve;
}

// のこぎり波は [-1, 1] を一様に舐めるので、曲線を同じ範囲で平均すれば
// 通過後の RMS がそのまま出る。歪ませるほど波形が矩形に寄って RMS が
// 上がるため、これで割らないと「歪み量」がそのまま音量ノブになる。
// 実測で、補正前は歪み 0 → 0.25 の間だけで 3.9dB 跳ねていた。
function curveRms(curve, pre) {
  const n = curve.length;
  const M = 512;
  let sum = 0;
  for (let i = 0; i < M; i++) {
    const u = ((i + 0.5) / M) * 2 - 1;
    const x = Math.min(1, Math.max(-1, u * pre));
    const y = curve[Math.round(((x + 1) / 2) * (n - 1))];
    sum += y * y;
  }
  return Math.sqrt(sum / M);
}

// 揃える先。同じ場所に置いた DRONE の実測に合わせてある。
// 補正前の DRIVE は他の種別より 4.6〜7.3dB 上に出ていて、1つ置くと
// 他の星が全部引っ込んで聞こえていた。
// この式は実測と ±0.85dB で一致する（歪み 0〜1 を 9 点で突き合わせ）。
const TARGET = 0.27;

// WaveShaper を通した歪んだ唸り。
export class DriveVoice extends Voice {
  static type = 'drive';
  static label = 'DRIVE';
  static look = 'crescent';
  static color = '#e0776f';
  static defaults = { freq: 55, drive: 0.5, filterPos: 'post', swellRate: 0.08, swellDepth: 30 };
  static params = [
    { key: 'freq', label: '基音', min: 20, max: 300, scale: 'log', unit: 'Hz' },
    { key: 'drive', label: '歪み量', min: 0, max: 1, scale: 'pow' },
    { key: 'filterPos', label: 'フィルタ位置', type: 'select', options: ['pre', 'post'] },
    { key: 'swellRate', label: 'うねり速度', min: 0.02, max: 1, scale: 'log', unit: 'Hz' },
    { key: 'swellDepth', label: 'うねり深さ', min: 0, max: 100, scale: 'pow', unit: 'cent' }
  ];

  build() {
    const ctx = this.ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = quantize(this.params.freq, this.tuning);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.swellRate;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = this.params.swellDepth;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc.detune);

    this.preGain = ctx.createGain();
    this.preGain.gain.value = 0.4 + this.params.drive * 0.6;

    this.shaper = ctx.createWaveShaper();
    this._curve = makeCurve(this.params.drive);
    this.shaper.curve = this._curve;
    this.shaper.oversample = '4x'; // 指定を落とすとエイリアスが不快に出る

    // フィルタは盤面 Y のカットオフを共有し、pre/post で位置だけ入れ替える
    this.inner = ctx.createBiquadFilter();
    this.inner.type = 'lowpass';
    this.inner.frequency.value = this.toneFilter.frequency.value;
    this.inner.Q.value = 0.7;

    this.out = ctx.createGain();
    this.out.gain.value = this._outGain(this._curve);

    if (this.params.filterPos === 'pre') {
      this.osc.connect(this.preGain);
      this.preGain.connect(this.inner);
      this.inner.connect(this.shaper);
      this.shaper.connect(this.out);
    } else {
      this.osc.connect(this.preGain);
      this.preGain.connect(this.shaper);
      this.shaper.connect(this.inner);
      this.inner.connect(this.out);
    }
    this.out.connect(this.envGain);
    this.osc.start();
    this.lfo.start();
  }

  // 曲線と突っ込む量から、通過後の音量を打ち消す係数を出す
  _outGain(curve) {
    const pre = 0.4 + this.params.drive * 0.6;
    const rms = curveRms(curve || makeCurve(this.params.drive), pre);
    return rms > 0 ? TARGET / rms : 1;
  }

  teardown() {
    for (const n of [this.osc, this.lfo]) {
      if (n) { try { n.stop(); n.disconnect(); } catch (e) { /* noop */ } }
    }
    for (const n of [this.preGain, this.shaper, this.inner, this.out, this.lfoGain]) {
      if (n) { try { n.disconnect(); } catch (e) { /* noop */ } }
    }
    this.osc = this.lfo = this.preGain = this.shaper = this.inner = this.out = this.lfoGain = null;
  }

  // 内側のフィルタが音色を決めるので、共通の toneFilter は開けておく
  applyTone(hz) {
    this._tone = hz;
    this.engine.ramp(this.toneFilter.frequency, 18000);
    if (this.inner) this.engine.ramp(this.inner.frequency, hz);
  }

  retune() {
    if (this.osc) this.engine.ramp(this.osc.frequency, quantize(this.params.freq, this.tuning), 0.4);
  }

  // 歪みの深さを超低速で動かす。カーブの作り直しは重いので、突っ込む量で振る。
  applyDrift(d, t) {
    if (!this.preGain) return;
    const m = 1 + this.driftAt(2, t) * d * 0.18;
    this.engine.ramp(this.preGain.gain, (0.4 + this.params.drive * 0.6) * m, 0.4);
  }

  applyParam(key) {
    if (!this.osc) return;
    if (key === 'filterPos') return this.rebuild(); // 配線の変更は作り直し
    if (key === 'freq') this.retune();
    if (key === 'swellRate') this.engine.ramp(this.lfo.frequency, this.params.swellRate, 0.05);
    if (key === 'swellDepth') this.engine.ramp(this.lfoGain.gain, this.params.swellDepth, 0.05);
    if (key === 'drive') {
      this._curve = makeCurve(this.params.drive);
      this.shaper.curve = this._curve;
      this.engine.ramp(this.preGain.gain, 0.4 + this.params.drive * 0.6, 0.05);
      this.engine.ramp(this.out.gain, this._outGain(this._curve), 0.05);
    }
  }
}
