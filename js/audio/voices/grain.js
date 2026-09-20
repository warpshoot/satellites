import { Voice, triangular } from './base.js';
import { quantize } from '../music.js';
import { getNoiseBuffer } from '../noiseBuffer.js';

// 短い音がランダムな間隔で落ちる。唯一「音楽っぽさ」を作るパート。

// 粒の窓。直線の三角だと角が立って、短い粒ほどクリックに聞こえる。
// 立ち上がりと終わりだけ余弦で丸め、真ん中は平らに保つ。
//
// 窓を左右非対称にできるようにすると、同じ GRAIN が 3 つの別物になる。
// 立ち上がりが長く切れが速ければ息を吸う音、一瞬で立ち上がって減衰すれば
// マレットや鐘、対称ならいままで通りのパッド。音源を1つ足すより安い。
const WINDOW_N = 128;

// 形。0 = 吸う（立ち上がり 0.95 / 切れ 0.05）、1 = 弾く（0.02 / 0.95）。
// 足して 1 を超えると両端が食い合うので、超えない幅にしてある。
function edgesOf(shape) {
  const s = Math.min(1, Math.max(0, shape));
  return { a: 0.95 - 0.93 * s, r: 0.05 + 0.90 * s };
}

function windowAt(x, a, r) {
  if (x < a) return 0.5 - 0.5 * Math.cos((Math.PI * x) / a);
  if (x > 1 - r) return 0.5 - 0.5 * Math.cos((Math.PI * (1 - x)) / r);
  return 1;
}

// 形を変えると窓の抱えるエネルギーが変わる。弾く形は平らな部分が無いぶん痩せる。
// 二乗平均で揃えておかないと、形のノブが音量のノブになってしまう。
function windowRms(a, r) {
  let sum = 0;
  for (let i = 0; i < WINDOW_N; i++) {
    const v = windowAt(i / (WINDOW_N - 1), a, r);
    sum += v * v;
  }
  return Math.sqrt(sum / WINDOW_N);
}

const REF_RMS = windowRms(0.35, 0.35); // もとの対称な窓を基準にする

function makeWindow(shape, scale) {
  const e = edgesOf(shape);
  const g = (REF_RMS / (windowRms(e.a, e.r) || 1)) * scale;
  const w = new Float32Array(WINDOW_N);
  for (let i = 0; i < WINDOW_N; i++) {
    w[i] = windowAt(i / (WINDOW_N - 1), e.a, e.r) * g;
  }
  w[0] = 0;
  w[WINDOW_N - 1] = 0;
  return w;
}

// noise 粒は Q=6 のバンドパスで痩せる。オシレータの粒と並べると音量が揃わない。
const NOISE_MAKEUP = 2.6;

// 粒ごとに窓を組み直すのは無駄なので、形を 24 段に丸めて使い回す。
const SHAPE_STEPS = 24;
const windowCache = new Map();

function windowFor(shape, noise) {
  const q = Math.round(Math.min(1, Math.max(0, shape)) * SHAPE_STEPS);
  const key = q + (noise ? 'n' : 'o');
  let w = windowCache.get(key);
  if (!w) {
    w = makeWindow(q / SHAPE_STEPS, noise ? NOISE_MAKEUP : 1);
    windowCache.set(key, w);
  }
  return w;
}

export class GrainVoice extends Voice {
  static type = 'grain';
  static label = 'GRAIN';
  static look = 'ring';
  static color = '#f0c674';
  static defaults = {
    interval: 1.2, jitter: 40, grainLen: 300, shape: 0.5,
    center: 700, spread: 600, wave: 'sine', width: 0.7,
    trigger: 'free', hits: 2
  };
  static params = [
    // 放置して聴くものなので、上は「30 秒に 1 回ポーンと鳴る」まで開けてある。
    { key: 'interval', label: '間隔', min: 0.05, max: 30, scale: 'log', unit: 's',
      when: (v) => !(v.orbit && v.params.trigger === 'orbit') },
    // 鳴る時刻を軌道の位相から取る。刻み目の原点は近点なので、つぶれた軌道なら
    // 一番近づいた瞬間に鳴る。周回していない星では「間隔」へ落ちる。
    { key: 'trigger', label: 'タイミング', type: 'select', options: ['free', 'orbit'],
      labels: { free: '間隔', orbit: '軌道' }, when: (v) => !!v.orbit },
    { key: 'hits', label: '1周の回数', min: 1, max: 8, scale: 'int', def: 2,
      when: (v) => !!v.orbit && v.params.trigger === 'orbit' },

    { key: 'jitter', label: 'ばらつき', min: 0, max: 100, scale: 'pow', unit: '%' },
    { key: 'grainLen', label: '粒の長さ', min: 20, max: 2000, scale: 'log', unit: 'ms' },
    { key: 'shape', label: '粒の形', min: 0, max: 1, scale: 'lin' },
    { key: 'center', label: 'ピッチ', min: 100, max: 4000, scale: 'log', unit: 'Hz', note: true },
    { key: 'spread', label: 'ピッチ幅', min: 0, max: 2400, scale: 'pow', unit: 'cent' },
    { key: 'width', label: 'ステレオ幅', min: 0, max: 1, scale: 'lin' },
    // のこぎりが無いと倍音の濃い粒が作れない。3 択だと「柔らかいか、もっと柔らかいか」になる。
    { key: 'wave', label: '波形', type: 'select', options: ['sine', 'triangle', 'sawtooth', 'noise'] }
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
    const interval = Math.max(0.02, this._effInterval());
    const overlap = Math.max(1, (this.params.grainLen / 1000) / interval);
    return 0.7 / Math.sqrt(overlap);
  }

  _applyDensity() {
    if (this.mix) this.engine.ramp(this.mix.gain, this._density(), 0.2);
  }

  // 軌道に同期しているときは、撒く間隔もそちらが決める。
  _effInterval() {
    const locked = this.params.trigger === 'orbit' && this.tickInterval(this.params.hits);
    return locked || this.params.interval * (this._driftMul || 1);
  }

  applyClock() {
    this._applyDensity();
  }

  // 撒く間隔そのものを超低速で動かす。密度が呼吸する。
  applyDrift(d, t) {
    this._driftMul = 1 + this.driftAt(2, t) * d * 0.35;
    this._applyDensity();
  }

  // 復帰時に過去時刻へ予約しないよう内部時刻を引き直す
  resetSchedule() {
    this.nextTime = this.ctx.currentTime + 0.05;
    this._lastTick = 0;
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
    if (this.params.trigger === 'orbit' && this._clock) return this._scheduleOrbit(now, until);
    if (this.nextTime < now) this.nextTime = now + 0.01;
    let guard = 0;
    while (this.nextTime < until && guard++ < 64) {
      this._spawn(this.nextTime);
      this.nextTime += this._step();
    }
  }

  // 先読みの窓は重なるので、通過済みの刻み目をもう一度拾わないようにする。
  _scheduleOrbit(now, until) {
    const gap = this.tickInterval(this.params.hits) || 1;
    for (const t of this.orbitTicks(Math.max(now, this._lastTick || 0), until, this.params.hits)) {
      if (t <= (this._lastTick || 0)) continue;
      this._lastTick = t;
      this._spawn(Math.max(now + 0.005, t + this.tickJitter(gap)));
    }
  }

  _spawn(t) {
    const ctx = this.ctx;
    // 音程は中心 ± 幅/2 から連続値で選び、そのあと音階へ寄せる。
    // 吸着なし（scale = なし）ならここは素通りする。
    const cents = triangular() * this.params.spread / 2;
    const freq = quantize(this.params.center * Math.pow(2, cents / 1200), this.tuning);
    const len = this.params.grainLen / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(windowFor(this.params.shape, this.params.wave === 'noise'), t, len);
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
