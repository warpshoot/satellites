import { Voice } from './base.js';
import { quantize } from '../music.js';
import { getNoiseBuffer } from '../noiseBuffer.js';

// 短い音がランダムな間隔で落ちる。唯一「音楽っぽさ」を作るパート。

// 粒の窓。直線の三角だと角が立って、短い粒ほどクリックに聞こえる。
// 立ち上がりと終わりだけ余弦で丸め、真ん中は平らに保つ。
const WINDOW_N = 128;
const WINDOW_EDGE = 0.35;

function makeWindow(scale) {
  const w = new Float32Array(WINDOW_N);
  for (let i = 0; i < WINDOW_N; i++) {
    const x = i / (WINDOW_N - 1);
    let a = 1;
    if (x < WINDOW_EDGE) a = 0.5 - 0.5 * Math.cos((Math.PI * x) / WINDOW_EDGE);
    else if (x > 1 - WINDOW_EDGE) a = 0.5 - 0.5 * Math.cos((Math.PI * (1 - x)) / WINDOW_EDGE);
    w[i] = a * scale;
  }
  w[0] = 0;
  w[WINDOW_N - 1] = 0;
  return w;
}

// noise 粒は Q=6 のバンドパスで痩せる。オシレータの粒と並べると音量が揃わない。
const WINDOW = makeWindow(1);
const WINDOW_NOISE = makeWindow(2.6);

export class GrainVoice extends Voice {
  static type = 'grain';
  static label = 'GRAIN';
  static look = 'ring';
  static color = '#f0c674';
  static defaults = {
    interval: 1.2, jitter: 40, grainLen: 300,
    center: 700, spread: 600, wave: 'sine', width: 0.7
  };
  static params = [
    // 放置して聴くものなので、上は「30 秒に 1 回ポーンと鳴る」まで開けてある。
    { key: 'interval', label: '間隔', min: 0.05, max: 30, scale: 'log', unit: 's' },
    { key: 'jitter', label: '間隔のばらつき', min: 0, max: 100, scale: 'pow', unit: '%' },
    { key: 'grainLen', label: '粒の長さ', min: 20, max: 2000, scale: 'log', unit: 'ms' },
    { key: 'center', label: '音程中心', min: 100, max: 4000, scale: 'log', unit: 'Hz' },
    { key: 'spread', label: '音程幅', min: 0, max: 2400, scale: 'pow', unit: 'cent' },
    { key: 'width', label: '定位のばらつき', min: 0, max: 1, scale: 'lin' },
    { key: 'wave', label: '波形', type: 'select', options: ['sine', 'triangle', 'noise'] }
  ];

  build() {
    this.mix = this.ctx.createGain();
    this._driftMul = 1;
    this.mix.gain.value = this._density();
    this.mix.connect(this.envGain);
    this.resetSchedule();
  }

  teardown() {
    this.nextTime = Infinity;
    if (this.mix) { try { this.mix.disconnect(); } catch (e) { /* noop */ } this.mix = null; }
  }

  // 間隔 0.05s で 2000ms の粒を撒くと 40 粒が重なる。粒ごとの音量を
  // そのままにすると密度がそのまま音量になり、リミッタが全部持っていく。
  _density() {
    const interval = Math.max(0.02, this.params.interval * (this._driftMul || 1));
    const overlap = Math.max(1, (this.params.grainLen / 1000) / interval);
    return 0.7 / Math.sqrt(overlap);
  }

  _applyDensity() {
    if (this.mix) this.engine.ramp(this.mix.gain, this._density(), 0.2);
  }

  // 撒く間隔そのものを超低速で動かす。密度が呼吸する。
  applyDrift(d, t) {
    this._driftMul = 1 + this.driftAt(2, t) * d * 0.35;
    this._applyDensity();
  }

  // 復帰時に過去時刻へ予約しないよう内部時刻を引き直す
  resetSchedule() {
    this.nextTime = this.ctx.currentTime + 0.05;
  }

  _step() {
    const j = this.params.jitter / 100;
    const f = 1 + (Math.random() * 2 - 1) * j;
    return Math.max(0.02, this.params.interval * (this._driftMul || 1) * f);
  }

  // lookahead scheduler から呼ばれる。AudioParam の絶対時刻で先に予約する。
  schedule(until) {
    if (!this.mix || this.disposed) return;
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.01;
    let guard = 0;
    while (this.nextTime < until && guard++ < 64) {
      this._spawn(this.nextTime);
      this.nextTime += this._step();
    }
  }

  _spawn(t) {
    const ctx = this.ctx;
    // 音程は中心 ± 幅/2 から連続値で選び、そのあと音階へ寄せる。
    // 吸着なし（scale = なし）ならここは素通りする。
    const cents = (Math.random() * 2 - 1) * this.params.spread / 2;
    const freq = quantize(this.params.center * Math.pow(2, cents / 1200), this.tuning);
    const len = this.params.grainLen / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(this.params.wave === 'noise' ? WINDOW_NOISE : WINDOW, t, len);
    // 粒ごとに定位を振る。全部同じ場所に落ちると線にしか聞こえない。
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * this.params.width;
    g.connect(pan);
    pan.connect(this.mix);

    let src;
    if (this.params.wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = getNoiseBuffer(ctx);
      const buf = src.buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 6;
      src.connect(bp);
      bp.connect(g);
      src.start(t, Math.random() * Math.max(0, buf.duration - len - 0.01));
      src.stop(t + len + 0.02);
      src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) { /* noop */ } };
    } else {
      src = ctx.createOscillator();
      src.type = this.params.wave;
      src.frequency.value = freq;
      src.connect(g);
      src.start(t);
      src.stop(t + len + 0.02);
      src.onended = () => { try { src.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) { /* noop */ } };
    }
  }

  applyParam(key) {
    if (key === 'interval' || key === 'grainLen') this._applyDensity();
  }
}
