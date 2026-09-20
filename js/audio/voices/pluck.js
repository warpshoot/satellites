import { Voice, triangular } from './base.js';
import { quantize } from '../music.js';

// 撥弦。他の5種は「持続する塊」「その破片」「減衰する金属」で、
// 木と弦の質感 ——「弾いた瞬間だけ倍音が濃くて、すぐ痩せる」—— が丸ごと無かった。
//
// Karplus-Strong。1周期ぶんの遅延線を、1周ごとに隣と平均しながら戻すだけで弦になる。
// これを DelayNode の帰還で組むと、Web Audio の帰還路は 1 レンダリング量子
// （128 サンプル）より短くできないので、44.1kHz で 344Hz より上が出せない。
// 粒ごとに JS でバッファを組んで鳴らす。数千〜数万サンプルなので 1ms 掛からない。

const MAX_LEN = 8;     // 秒。これ以上は生成のほうが重くなる
// 揃える先は「頭 0.25 秒の二乗平均」。撥弦は頭で聞こえ方が決まるうえ、
// 全長で測ると減衰の長さがそのまま読みに乗って、減衰のノブが音量のノブになる。
const HEAD_SEC = 0.25;
const TARGET_RMS = 0.34;
// 頭は尖っていて当たり前なので、上限は 1 より上に置く。ここを 1 未満にすると
// 常に上限が効いてしまい、結局ピークで揃えたのと同じことになる
//（実測でピッチ 55Hz と 880Hz の二乗平均が 11.5dB ずれた）。
const PEAK_CEIL = 1.35;
const CACHE_MAX = 48;  // 音程は音階へ吸着するので、同じ波形が何度も出てくる
const cache = new Map();

// ピック位置は励起ノイズの櫛。端を弾けば倍音が濃く、真ん中なら偶数次が抜ける。
//
// 生の白ノイズをそのまま入れると、頭の一撃だけが突出して波高率が跳ね上がる。
// 平均で揃えると頭がリミッタに刺さり、ピークで揃えると胴が痩せる。
// 撥弦は「弦を引っ掛けて離す」ので、励起そのものが角の取れた形をしている。
function excite(n, pick, damp) {
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.random() * 2 - 1;
  const d = Math.max(1, Math.round(Math.min(0.5, pick) * n));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i] - raw[(i - d + n) % n];

  // 1極ローパスを輪にして2周。1周だけだと継ぎ目に段が残り、
  // それが1周期ごとのクリックとして聞こえる。
  const a = 0.25 + 0.6 * (1 - Math.min(1, Math.max(0, damp)));
  let lp = out[n - 1];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      lp += a * (out[i] - lp);
      out[i] = lp;
    }
  }

  // 直流が残ると、弾くたびにスピーカーが片側へ張り付く
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return out;
}

function render(sr, freq, decay, damp, pick) {
  const n = Math.max(2, Math.round(sr / freq));
  const len = Math.min(Math.round(sr * MAX_LEN), Math.ceil(sr * decay) + n);
  const line = excite(n, pick, damp);
  // 1サンプルあたりの減衰。decay 秒で -60dB に落ちるように取る。
  const r = Math.pow(0.001, 1 / Math.max(1, decay * sr));
  // 隣とどれだけ混ぜるか。0.5 が古典的な2点平均で、一番早く高域が死ぬ。
  // 下げるほど倍音が残って、弦というより張った針金に寄る。
  const b = 0.06 + 0.44 * Math.min(1, Math.max(0, damp));
  const out = new Float32Array(len);
  let idx = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = line[idx];
    const nx = line[(idx + 1) % n];
    out[i] = v;
    line[idx] = ((1 - b) * v + b * nx) * r;
    idx = (idx + 1) % n;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  // 尻尾を丸める。-60dB でも、切った瞬間が聞こえる端末がある。
  const fade = Math.min(len, Math.round(sr * 0.02));
  for (let i = 0; i < fade; i++) out[len - fade + i] *= 1 - i / fade;

  // 揃える。ピークで揃えると波高率のぶんだけ胴が痩せ、全長の二乗平均で
  // 揃えると減衰の長さが読みに乗る。頭だけを見るとどちらにも引きずられない。
  const head = Math.min(len, Math.round(sr * HEAD_SEC));
  let sum = 0;
  for (let i = 0; i < head; i++) sum += out[i] * out[i];
  const rms = Math.sqrt(sum / head);
  let k = rms > 0 ? TARGET_RMS / rms : 1;
  if (peak * k > PEAK_CEIL) k = PEAK_CEIL / peak;
  for (let i = 0; i < len; i++) out[i] *= k;
  return out;
}

function bufferFor(ctx, freq, decay, damp, pick) {
  const sr = ctx.sampleRate;
  const key = [sr, Math.round(freq * 2), Math.round(decay * 10),
    Math.round(damp * 16), Math.round(pick * 16)].join('|');
  let buf = cache.get(key);
  if (!buf) {
    const data = render(sr, freq, decay, damp, pick);
    buf = ctx.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, buf);
  }
  return buf;
}

export class PluckVoice extends Voice {
  static type = 'pluck';
  static label = 'PLUCK';
  static look = 'hollow';
  static color = '#b9cf7a';
  static defaults = {
    interval: 3, jitter: 60, center: 220, spread: 1200,
    decay: 3, damp: 0.5, pick: 0.2, width: 0.6,
    trigger: 'free', hits: 2
  };
  static params = [
    // 鳴る時刻を何に従わせるか。先に決まらないと「間隔」と「分割」の
    // どちらが生きているか分からないので、2本より上に置く。
    { key: 'trigger', label: 'タイミング', type: 'select', options: ['free', 'orbit'],
      labels: { free: 'フリー', orbit: '軌道' }, when: (v) => !!v.orbit },
    { key: 'interval', label: '間隔', min: 0.2, max: 30, scale: 'log', unit: 's',
      when: (v) => !(v.orbit && v.params.trigger === 'orbit') },
    { key: 'hits', label: '分割', min: 1, max: 8, scale: 'int', def: 2,
      when: (v) => !!v.orbit && v.params.trigger === 'orbit' },
    { key: 'jitter', label: 'ばらつき', min: 0, max: 100, scale: 'pow', unit: '%' },
    { key: 'center', label: 'ピッチ', min: 40, max: 2000, scale: 'log', unit: 'Hz', note: true },
    { key: 'spread', label: 'ピッチ幅', min: 0, max: 2400, scale: 'pow', unit: 'cent' },
    { key: 'decay', label: '減衰', min: 0.2, max: 8, scale: 'log', unit: 's' },
    { key: 'damp', label: 'ダンプ', min: 0, max: 1, scale: 'lin' },
    { key: 'pick', label: 'ピック位置', min: 0.02, max: 0.5, scale: 'lin' },
    { key: 'width', label: 'ステレオ幅', min: 0, max: 1, scale: 'lin' }
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

  // BELL と同じ考え。重なった数の平方根で割って、密度が音量にならないようにする。
  _density() {
    const interval = Math.max(0.1, this._effInterval());
    const overlap = Math.max(1, this.params.decay / interval);
    return 0.62 / Math.sqrt(overlap);
  }

  _effInterval() {
    const locked = this.params.trigger === 'orbit' && this.tickInterval(this.params.hits);
    return locked || this.params.interval * (this._driftMul || 1);
  }

  _applyDensity() {
    if (this.mix) this.engine.ramp(this.mix.gain, this._density(), 0.2);
  }

  applyClock() {
    this._applyDensity();
  }

  // 弾く頻度が呼吸する
  applyDrift(d, t) {
    this._driftMul = 1 + this.driftAt(2, t) * d * 0.3;
    this._applyDensity();
  }

  resetSchedule() {
    this.nextTime = this.ctx.currentTime + 0.1;
    this._lastTick = 0;
  }

  _step() {
    const j = this.params.jitter / 100;
    const f = 1 + (Math.random() * 2 - 1) * j;
    return Math.max(0.1, this.params.interval * (this._driftMul || 1) * f);
  }

  schedule(until) {
    if (!this.mix || this.disposed) return;
    const now = this.ctx.currentTime;
    if (this.params.trigger === 'orbit' && this._clock) return this._scheduleOrbit(now, until);
    if (this.nextTime < now) this.nextTime = now + 0.01;
    let guard = 0;
    while (this.nextTime < until && guard++ < 32) {
      this._spawn(this.nextTime);
      this.nextTime += this._step();
    }
  }

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
    const cents = triangular() * this.params.spread / 2;
    const freq = quantize(this.params.center * Math.pow(2, cents / 1200), this.tuning);
    const src = ctx.createBufferSource();
    src.buffer = bufferFor(ctx, freq, this.params.decay, this.params.damp, this.params.pick);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * this.params.width;
    src.connect(pan);
    pan.connect(this.mix);
    src.start(t);
    src.onended = () => {
      try { src.disconnect(); pan.disconnect(); } catch (e) { /* noop */ }
    };
  }

  applyParam(key) {
    if (key === 'interval' || key === 'decay') this._applyDensity();
  }
}
