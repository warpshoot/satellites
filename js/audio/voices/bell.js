import { Voice, triangular } from './base.js';
import { quantize } from '../music.js';

// 減衰する金属音。他の4種は「持続する塊」か「その破片」で、
// 鳴って消えるものが丸ごと無かった。
//
// 2オペレータの FM。キャリアとモジュレータの比を整数から外すと、
// 倍音が音程からずれて金属になる。比を選択式にしてあるのは、連続値だと
// 「正解の比を知っている人だけが当てられるノブ」になるため。

// ラベルは比そのもの。1 は整数比なので、これだけ倍音が音程に乗る。
// 比だけ並べる。一部にだけ「（鐘）」のような添え書きを付けていたが、
// 5つ中3つという中途半端が一番読みにくい。音の性格は押せば分かる。
const RATIOS = ['1', '1.41', '2', '2.76', '3.5'];

export class BellVoice extends Voice {
  static type = 'bell';
  static label = 'BELL';
  static look = 'binary';
  static color = '#c3a6ff';
  static defaults = {
    interval: 4, jitter: 50, center: 440, spread: 1200,
    ratio: '2.76', index: 3, decay: 4, width: 0.6,
    trigger: 'free', hits: 2
  };
  static params = [
    // 鳴る時刻を何に従わせるか。先に決まらないと「間隔」と「分割」の
    // どちらが生きているか分からないので、2本より上に置く。
    { key: 'trigger', label: 'タイミング', type: 'select', options: ['free', 'orbit'],
      labels: { free: 'フリー', orbit: '軌道' }, when: (v) => !!v.orbit },
    // 軌道に従うときは位相から時刻を取る。刻み目の原点は近点なので、
    // つぶれた軌道なら一番近づいた瞬間に鳴る。
    { key: 'interval', label: '間隔', min: 0.2, max: 30, scale: 'log', unit: 's',
      when: (v) => !(v.orbit && v.params.trigger === 'orbit') },
    { key: 'hits', label: '分割', min: 1, max: 8, scale: 'int', def: 2,
      when: (v) => !!v.orbit && v.params.trigger === 'orbit' },

    { key: 'jitter', label: 'ばらつき', min: 0, max: 100, scale: 'pow', unit: '%' },
    { key: 'center', label: 'ピッチ', min: 80, max: 2000, scale: 'log', unit: 'Hz', note: true },
    { key: 'spread', label: 'ピッチ幅', min: 0, max: 2400, scale: 'pow', unit: 'cent' },
    { key: 'ratio', label: 'モジュレータ比', type: 'select', options: RATIOS },
    { key: 'index', label: 'モジュレーション', min: 0, max: 10, scale: 'pow' },
    { key: 'decay', label: '減衰', min: 0.2, max: 12, scale: 'log', unit: 's' },
    { key: 'width', label: 'ステレオ幅', min: 0, max: 1, scale: 'lin' }
  ];

  // 1発あたりオシレータ2本。長い減衰と短い間隔で簡単に重なる。
  weight() { return 2; }

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

  // 減衰 12s を 0.2s 間隔で撒くと 60 発が重なる。GRAIN と同じ考えで、
  // 重なった数の平方根で割って密度が音量にならないようにする。
  _density() {
    const interval = Math.max(0.1, this._effInterval());
    const overlap = Math.max(1, this.params.decay / interval);
    return 0.7 / Math.sqrt(overlap);
  }

  _applyDensity() {
    if (this.mix) this.engine.ramp(this.mix.gain, this._density(), 0.2);
  }

  _effInterval() {
    const locked = this.params.trigger === 'orbit' && this.tickInterval(this.params.hits);
    return locked || this.params.interval * (this._driftMul || 1);
  }

  applyClock() {
    this._applyDensity();
  }

  // 撒く間隔を超低速で動かす。鳴る頻度が呼吸する。
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
    const ratio = parseFloat(this.params.ratio) || 1;
    const decay = this.params.decay;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * ratio;

    // 変調の深さは周波数の振れ幅で渡す。深さ I に対して振れ幅 = I × 変調周波数。
    const modGain = ctx.createGain();
    const peak = this.params.index * freq * ratio;
    modGain.gain.setValueAtTime(peak, t);
    // 倍音のほうが速く消える。これをやらないと最後まで金属質が残って、
    // 鐘ではなくただの歪んだサイン波に聞こえる。
    modGain.gain.setTargetAtTime(0, t, Math.max(0.02, decay * 0.18));
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.004); // 頭を 4ms 丸める。0 からの即時はクリックになる
    g.gain.setTargetAtTime(0, t + 0.004, decay * 0.25);

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * this.params.width;

    carrier.connect(g);
    g.connect(pan);
    pan.connect(this.mix);

    // setTargetAtTime は 0 に届かないので、十分小さくなったところで切る
    const life = t + decay + 0.3;
    mod.start(t);
    carrier.start(t);
    mod.stop(life);
    carrier.stop(life);
    carrier.onended = () => {
      try { carrier.disconnect(); mod.disconnect(); modGain.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) { /* noop */ }
    };
  }

  applyParam(key) {
    if (key === 'interval' || key === 'decay') this._applyDensity();
  }
}
