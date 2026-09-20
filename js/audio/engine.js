import { createIR } from './ir.js';

// AudioParam への直接代入はクリック音になる。変更は必ず engine.ramp() を通す。
const LOOKAHEAD_MS = 25;
const HORIZON = 0.1;

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.ready = false;
    this._timer = null;
    this._irPending = null;
  }

  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.masterBus = ctx.createGain();
    this.masterBus.gain.value = 1;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // ドローン複数本で容易にクリップする。リミッタは飾りではない。
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 20;
    this.limiter.knee.value = 0;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.masterBus.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // リバーブ（マスターに1系統だけ）
    this.reverbInput = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbReturn = ctx.createGain();
    this.reverbInput.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterBus);

    // ディレイ（マスターに1系統だけ）。左右を交互に打つピンポン。
    // 1本の DelayNode だと反射が左右同じ位置に出て、幅に一切寄与しない。
    this.delayInput = ctx.createGain();
    this.delayL = ctx.createDelay(2.5);
    this.delayR = ctx.createDelay(2.5);
    this.panL = ctx.createStereoPanner();
    this.panL.pan.value = -0.85;
    this.panR = ctx.createStereoPanner();
    this.panR.pan.value = 0.85;
    this.feedback = ctx.createGain();
    this.feedbackFilter = ctx.createBiquadFilter();
    this.feedbackFilter.type = 'lowpass';
    this.feedbackFilter.frequency.value = 4000;
    this.delayReturn = ctx.createGain();

    this.delayInput.connect(this.delayL);
    this.delayL.connect(this.panL);
    this.panL.connect(this.delayReturn);
    this.delayL.connect(this.delayR);
    this.delayR.connect(this.panR);
    this.panR.connect(this.delayReturn);
    this.delayR.connect(this.feedbackFilter);
    this.feedbackFilter.connect(this.feedback);
    this.feedback.connect(this.delayL);
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
    this.ramp(this.delayR.delayTime, t, 0.08);
  }

  setDelayFeedback(v) {
    this.ramp(this.feedback.gain, Math.min(0.85, Math.max(0, v)), 0.05);
  }

  applyMaster(master) {
    this.setMasterGain(master.gain);
    this.setDelayTime(master.delay.time);
    this.setDelayFeedback(master.delay.feedback);
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
  _startScheduler() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const until = this.ctx.currentTime + HORIZON;
      for (const v of this.voices) {
        if (v.schedule) v.schedule(until);
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
