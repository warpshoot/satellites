import { createIR } from './ir.js';
import { TUNING_DEFAULTS } from './music.js';

// AudioParam への直接代入はクリック音になる。変更は必ず engine.ramp() を通す。
const LOOKAHEAD_MS = 25;
const HORIZON = 0.1;

// 20Hz 以下は端末のスピーカーでは鳴らないのに、リミッタのヘッドルームだけ食う。
const RUMBLE_HZ = 30;

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.ready = false;
    this._timer = null;
    this.tuning = Object.assign({}, TUNING_DEFAULTS);
  }

  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    // 星8つ分が素通しで集まるとリミッタが常時 7dB 潰す羽目になる。
    // 先にヘッドルームを確保しておけば、リミッタは頭だけ押さえればよくなる。
    this.masterBus = ctx.createGain();
    this.masterBus.gain.value = 0.5;

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

    this.masterBus.connect(this.rumble);
    this.rumble.connect(this.limiter);
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

    this.delayReturn.connect(this.masterBus);

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

  // IR の再生成は音が途切れる。ドラッグ中は呼ばず、離したときに一度だけ。
  setReverbIR(length, decay) {
    if (!this.ctx) return;
    this.convolver.buffer = createIR(this.ctx, length, decay);
  }

  setDelayTime(ms) {
    const t = Math.min(2.0, ms / 1000);
    this.ramp(this.delayL.delayTime, t, 0.08);
    // 右は 1.5 倍。同じ長さにすると左右の打点が重なって幅が死ぬ。
    this.ramp(this.delayR.delayTime, Math.min(2.4, t * 1.5), 0.08);
  }

  // 襷掛けなので、一周の利得は片側の2乗になる。√を掛けて元の効き方に戻す。
  setDelayFeedback(v) {
    const f = Math.sqrt(Math.min(0.85, Math.max(0, v)));
    this.ramp(this.fbLR.gain, f, 0.05);
    this.ramp(this.fbRL.gain, f, 0.05);
  }

  setTuning(tuning) {
    this.tuning = Object.assign({}, TUNING_DEFAULTS, tuning || {});
    for (const v of this.voices) {
      if (v.retune) v.retune();
    }
  }

  applyMaster(master) {
    this.setMasterGain(master.gain);
    this.setDelayTime(master.delay.time);
    this.setDelayFeedback(master.delay.feedback);
    this.setTuning(master.tuning);
    this.setReverbIR(master.reverb.length, master.reverb.decay);
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
