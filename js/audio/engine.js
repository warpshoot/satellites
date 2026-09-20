import { createIR } from './ir.js';
import { TUNING_DEFAULTS, keySteps } from './music.js';

// AudioParam への直接代入はクリック音になる。変更は必ず engine.ramp() を通す。
const LOOKAHEAD_MS = 25;
const HORIZON = 0.1;

// 20Hz 以下は端末のスピーカーでは鳴らないのに、リミッタのヘッドルームだけ食う。
const RUMBLE_HZ = 30;

// ---- 灼き（マスターの飽和）-------------------------------------------
// 演奏の帯から振る歪み。リミッタの手前に置くので、暴れても頭は押さえられる。
//
// ドライと混ぜる作りにはしない。WaveShaper は 4x オーバーサンプルで
// わずかに遅れるため、素の音と足すと端末のモノスピーカーで櫛状に穴が開く。
// 代わりに、曲線そのものを「効かないときは y = x」にしてある。
const BURN_N = 2048;
const BURN_STEPS = 24;      // 曲線はこの段数に丸めて使い回す
const BURN_REF = 0.3;       // この高さの信号の通り方を揃えて音量差を消す
const BURN_DRIVE = 8;       // 振り切ったときに何倍突っ込むか

// 膝は平方根で、突っ込む量は線形で降ろす。両方を線形にすると帯の左半分が
// 素通しのままで、右の端に来てからいきなり潰れる。実測の THD（入力 0.45）で
// 0 → 3.4 → 18.9 → 26.5 → 31.0 → 34.5 → 36.5%。

// |x| が膝 k を超えたところからだけ寝かせる。k = 1 なら素通し。
function burnAt(x, k) {
  const a = Math.abs(x);
  const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
  return x < 0 ? -y : y;
}

function burnShape(amount) {
  const k = 1 - 0.98 * Math.sqrt(amount);
  const drive = 1 + BURN_DRIVE * amount;
  const curve = new Float32Array(BURN_N);
  for (let i = 0; i < BURN_N; i++) {
    curve[i] = burnAt((i * 2) / (BURN_N - 1) - 1, k);
  }
  // 基準の高さだけは前後で揃える。揃えないと歪みのノブが音量のノブになる。
  const ref = burnAt(Math.min(1, drive * BURN_REF), k);
  return { curve, drive, out: ref > 0 ? BURN_REF / ref : 1 };
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.ready = false;
    this._timer = null;
    this.tuning = Object.assign({}, TUNING_DEFAULTS, { offset: 0 });
    this._keyAt = 0;
  }

  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    // 星が素通しで集まるとリミッタが常時 7dB 潰す羽目になる。
    // 先にヘッドルームを確保しておけば、リミッタは頭だけ押さえればよくなる。
    // 上限を 8 点から 12 点へ上げたぶん、ここも 1dB ぶん下げてある。
    this.masterBus = ctx.createGain();
    this.masterBus.gain.value = 0.45;

    // 聞こえない低域を先に捨ててからリミッタへ入れる
    this.rumble = ctx.createBiquadFilter();
    this.rumble.type = 'highpass';
    this.rumble.frequency.value = RUMBLE_HZ;
    this.rumble.Q.value = 0.7;

    // ドローン複数本で容易にクリップする。リミッタは飾りではない。
    // ただし常時 5dB も潰れていると、粒が落ちるたびに土台が凹んで聞こえる。
    // 深く速く掛けず、浅く遅く。アンビエントでは呼吸のほうが大事。
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.ratio.value = 12;
    this.limiter.knee.value = 4;
    this.limiter.attack.value = 0.006;
    this.limiter.release.value = 0.8;

    // マスター音量はリミッタの後ろ。前に置くと、音量を絞るほど
    // 潰れ方まで変わって、フェードのたびに音色が動く。
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // 灼き段。曲線は amount 0 のとき y = x なので、既定では何もしない。
    this.burnIn = ctx.createGain();
    this.burnIn.gain.value = 1;
    this.burnShaper = ctx.createWaveShaper();
    this.burnShaper.oversample = '4x'; // 落とすとエイリアスが不快に出る
    this.burnOut = ctx.createGain();
    this.burnOut.gain.value = 1;
    this._burnStep = -1;
    this._burnCache = new Map();
    this.setBurn(0);

    this.masterBus.connect(this.rumble);
    this.rumble.connect(this.burnIn);
    this.burnIn.connect(this.burnShaper);
    this.burnShaper.connect(this.burnOut);
    this.burnOut.connect(this.limiter);
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // リバーブ（マスターに1系統だけ）
    this.reverbInput = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbReturn = ctx.createGain();
    this.reverbInput.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterBus);

    // ディレイ（マスターに1系統だけ）。左右を交互に打つ。
    // 1本の DelayNode だと反射が左右同じ位置に出て、幅に一切寄与しない。
    // 入力は両側に入れ、右だけ時間をずらす。片側にしか入れないと
    // 1発目が必ず左から出て、動きと無関係な癖になる。
    this.delayInput = ctx.createGain();
    this.delayL = ctx.createDelay(2.5);
    this.delayR = ctx.createDelay(2.5);
    this.panL = ctx.createStereoPanner();
    this.panL.pan.value = -0.85;
    this.panR = ctx.createStereoPanner();
    this.panR.pan.value = 0.85;
    this.delayReturn = ctx.createGain();

    // 帰還は襷掛け。低域は溜まると濁るので、高域と一緒に両端を削る。
    // フィルタは左右で分ける。1本に集めると帰還がモノに潰れて幅が消える。
    this.fbLR = ctx.createGain();
    this.fbRL = ctx.createGain();
    this.fbFilters = ['L', 'R'].map(() => {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 160;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4000;
      hp.connect(lp);
      return { hp, lp };
    });

    this.delayInput.connect(this.delayL);
    this.delayInput.connect(this.delayR);
    this.delayL.connect(this.panL);
    this.delayR.connect(this.panR);
    this.panL.connect(this.delayReturn);
    this.panR.connect(this.delayReturn);

    this.delayL.connect(this.fbFilters[0].hp);
    this.fbFilters[0].lp.connect(this.fbLR);
    this.fbLR.connect(this.delayR);
    this.delayR.connect(this.fbFilters[1].hp);
    this.fbFilters[1].lp.connect(this.fbRL);
    this.fbRL.connect(this.delayL);

    // テープの揺れ。ディレイ時間そのものを超低速で動かす。周期の噛み合わない
    // 2本を足すので、往復が読めない。深さは時間に対する比で持つ（短い設定で
    // 絶対量のまま掛けると、そこだけ音程が跳ねる）。
    this.wowGain = ctx.createGain();
    this.wowGain.gain.value = 0;
    this.wowLfos = [0.13, 0.29].map((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.62 : 0.38;
      o.connect(g);
      g.connect(this.wowGain);
      o.start();
      return o;
    });
    this.wowGain.connect(this.delayL.delayTime);
    this.wowGain.connect(this.delayR.delayTime);

    this.delayReturn.connect(this.masterBus);

    this._delaySec = 0.42;
    this._wow = 0;
    this.ready = true;
    this._startScheduler();
    return ctx;
  }

  async resume() {
    if (!this.ctx) this.init();
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  ramp(param, value, tc = 0.02) {
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  // ---- master -------------------------------------------------------
  setMasterGain(v) {
    this.ramp(this.masterGain.gain, v, 0.05);
  }

  // 灼きの深さ 0〜1。曲線の差し替えは段が変わったときだけ。
  // 突っ込む量と戻す量はランプで動かす（直接代入はクリックになる）。
  setBurn(amount) {
    if (!this.ctx) return;
    const a = Math.min(1, Math.max(0, amount || 0));
    const step = Math.round(a * BURN_STEPS);
    let shape = this._burnCache.get(step);
    if (!shape) {
      shape = burnShape(step / BURN_STEPS);
      this._burnCache.set(step, shape);
    }
    if (step !== this._burnStep) {
      this._burnStep = step;
      this.burnShaper.curve = shape.curve;
    }
    this.ramp(this.burnIn.gain, shape.drive, 0.05);
    this.ramp(this.burnOut.gain, shape.out, 0.05);
  }

  // IR の再生成は音が途切れる。ドラッグ中は呼ばず、離したときに一度だけ。
  setReverbIR(length, decay) {
    if (!this.ctx) return;
    this.convolver.buffer = createIR(this.ctx, length, decay);
  }

  setDelayTime(ms) {
    const t = Math.min(2.0, ms / 1000);
    this._delaySec = t;
    this.ramp(this.delayL.delayTime, t, 0.08);
    // 右は 1.5 倍。同じ長さにすると左右の打点が重なって幅が死ぬ。
    this.ramp(this.delayR.delayTime, Math.min(2.4, t * 1.5), 0.08);
    this._applyWow();
  }

  // 帰還のローパス。暗いテープエコーと明るいデジタルの差はここだけで出る。
  // ハイパスは動かさない。低域は溜まると濁るだけで、明暗には効かない。
  setDelayTone(v) {
    if (!this.fbFilters) return;
    const t = Math.min(1, Math.max(0, v));
    const hz = 600 * Math.pow(14000 / 600, t);
    for (const f of this.fbFilters) this.ramp(f.lp.frequency, hz, 0.08);
  }

  setDelayWow(v) {
    this._wow = Math.min(1, Math.max(0, v || 0));
    this._applyWow();
  }

  // 深さは時間の 0.6% まで。テープの実機もこの程度で、これ以上はビブラートに聞こえる。
  _applyWow() {
    if (!this.wowGain) return;
    this.ramp(this.wowGain.gain, this._delaySec * 0.006 * this._wow, 0.2);
  }

  // 襷掛けなので、一周の利得は片側の2乗になる。√を掛けて元の効き方に戻す。
  setDelayFeedback(v) {
    const f = Math.sqrt(Math.min(0.85, Math.max(0, v)));
    this.ramp(this.fbLR.gain, f, 0.05);
    this.ramp(this.fbRL.gain, f, 0.05);
  }

  // ルートか音階が変わったときだけ転調ぶんを捨てる。マスターの別のノブを
  // 触るたびに 0 へ戻すと、音量を動かしただけで調が飛ぶ。
  setTuning(tuning) {
    const prev = this.tuning;
    const next = Object.assign({}, TUNING_DEFAULTS, tuning || {});
    const sameKey = prev && prev.root === next.root && prev.scale === next.scale;
    next.offset = sameKey ? (prev.offset || 0) : 0;
    if (!sameKey) this._keyAt = 0;
    this.tuning = next;
    for (const v of this.voices) {
      if (v.retune) v.retune();
    }
  }

  // ---- 転調 ----------------------------------------------------------
  // 数分に一度、音階の音度ぶんだけルートをずらす。アンビエントで一番効くのは
  // 「気づかないうちにコードが変わっていた」ことで、固定のキーだと構造的に起きない。
  // 移るときは 4 秒の時定数で滑らせる。切り替えると「別の曲が始まった」に聞こえる。
  _stepKey(now) {
    const d = this.tuning.drift || 0;
    if (d <= 0) {
      if (this.tuning.offset) {
        this.tuning.offset = 0;
        this._retuneKey();
      }
      this._keyAt = 0;
      return;
    }
    const period = 90 + (1 - d) * 510;
    if (!this._keyAt) {
      this._keyAt = now + period;
      return;
    }
    if (now < this._keyAt) return;
    this._keyAt = now + period;
    const steps = keySteps(this.tuning).filter((s) => s !== (this.tuning.offset || 0));
    if (!steps.length) return;
    this.tuning.offset = steps[Math.floor(Math.random() * steps.length)];
    this._retuneKey();
  }

  _retuneKey() {
    for (const v of this.voices) {
      if (v.retune) v.retune(4);
    }
  }

  // ---- voices -------------------------------------------------------
  addVoice(voice) {
    this.voices.push(voice);
  }

  removeVoice(voice) {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  // オシレータ実数での見積もり（DRONE 1点が最大5本食う）
  oscCount() {
    return this.voices.reduce((n, v) => n + (v.weight ? v.weight() : 1), 0);
  }

  // ---- GRAIN 用 lookahead scheduler ----------------------------------
  // ゆらぎの更新も同じ心拍に相乗りさせる。専用のタイマは増やさない。
  _startScheduler() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const until = now + HORIZON;
      this._stepKey(now);
      for (const v of this.voices) {
        if (v.schedule) v.schedule(until);
        if (v.evolve) v.evolve(now);
      }
    }, LOOKAHEAD_MS);
  }

  // 復帰時に過去時刻へ予約して暴発しないようリセットする
  resetSchedulers() {
    for (const v of this.voices) {
      if (v.resetSchedule) v.resetSchedule();
    }
  }
}

export const engine = new Engine();
