// Voice の共通インターフェース: start() / stop() / setParam() / dispose() / output

export const COMMON_PARAMS = [
  { key: 'attack', label: 'アタック', min: 0.01, max: 20, scale: 'log', unit: 's' },
  { key: 'release', label: 'リリース', min: 0.01, max: 30, scale: 'log', unit: 's' },
  { key: 'reverbSend', label: 'リバーブ', min: 0, max: 1, scale: 'lin' },
  { key: 'delaySend', label: 'ディレイ', min: 0, max: 1, scale: 'lin' }
];

export const COMMON_DEFAULTS = {
  attack: 2.0,
  release: 4.0,
  reverbSend: 0.4,
  delaySend: 0.15
};

export const TONE_MIN = 100;
export const TONE_MAX = 16000;

export function cutoffFromY(y) {
  return TONE_MIN * Math.pow(TONE_MAX / TONE_MIN, Math.min(1, Math.max(0, y)));
}

// near は核への近さ（0 = 遠い / 1 = 核のすぐそば）。
// 床を持たせない。遠ざかった星が鳴り続けるのは嘘になる。
export function gainFromNear(near) {
  return Math.pow(Math.min(1, Math.max(0, near)), 1.3);
}

export function distanceSend(near) {
  return 0.55 * (1 - Math.min(1, Math.max(0, near)));
}

export function airFactor(near) {
  return 0.45 + 0.55 * Math.min(1, Math.max(0, near));
}

export class Voice {
  constructor(engine, data) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.id = data.id;
    this.type = data.type;
    this.common = Object.assign({}, COMMON_DEFAULTS, data.common || {});
    this.params = Object.assign({}, this.constructor.defaults, data.params || {});
    this.near = 0.5;
    this.vol = data.vol != null ? data.vol : 0.85;
    this.disposed = false;

    const ctx = this.ctx;
    this.envGain = ctx.createGain();
    this.envGain.gain.value = 0;

    // ソロ・ミュート用。音量とは別の段にしておかないと値を奪い合う。
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = 1;

    // 実測用。距離で音量が変わる前の、このボイス自身の出音を見る。
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 256;
    this.meter.smoothingTimeConstant = 0;
    this._meterBuf = new Float32Array(this.meter.fftSize);
    this._lvl = 0;

    this.levelGain = ctx.createGain();
    this.levelGain.gain.value = this.vol * gainFromNear(this.near);

    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 1000;
    this.toneFilter.Q.value = 0.7;

    this.panner = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : null;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1.0; // dry は常に 1.0 固定。send はパラレル送り。
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = Math.min(1, this.common.reverbSend + distanceSend(this.near));
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = this.common.delaySend;

    this.envGain.connect(this.muteGain);
    this.muteGain.connect(this.levelGain);
    this.muteGain.connect(this.meter);
    this.levelGain.connect(this.toneFilter);
    const tail = this.panner || this.toneFilter;
    if (this.panner) this.toneFilter.connect(this.panner);
    tail.connect(this.dryGain);
    tail.connect(this.reverbSend);
    tail.connect(this.delaySend);

    this.dryGain.connect(engine.masterBus);
    this.reverbSend.connect(engine.reverbInput);
    this.delaySend.connect(engine.delayInput);

    // サブクラスが音源を差し込む先
    this.input = this.envGain;
    this.output = this.dryGain;
  }

  // --- サブクラスが実装する ---
  build() {}
  teardown() {}
  weight() { return 1; }

  start() {
    this.build();
    const g = this.envGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + this.common.attack);
    this.started = true;
  }

  // release をかけ、終わってから disconnect する（即 disconnect はプツッと鳴る）
  stop(onDone) {
    const g = this.envGain.gain;
    const t = this.ctx.currentTime;
    const rel = this.common.release;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + rel);
    setTimeout(() => {
      this.dispose();
      if (onDone) onDone();
    }, rel * 1000 + 60);
  }

  // オシレータ数の変更など、作り直しが必要なときのフェード差し替え
  rebuild() {
    if (!this.started) return;
    const g = this.envGain.gain;
    const t = this.ctx.currentTime;
    const cur = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(0, t + 0.05);
    setTimeout(() => {
      if (this.disposed) return;
      this.teardown();
      this.build();
      const t2 = this.ctx.currentTime;
      const g2 = this.envGain.gain;
      g2.cancelScheduledValues(t2);
      g2.setValueAtTime(0, t2);
      g2.linearRampToValueAtTime(1, t2 + 0.08);
    }, 60);
  }

  // 立ち上がりは即、減衰はゆっくり。目で追える速さにする。
  getLevel() {
    if (!this.meter || this.disposed) return 0;
    this.meter.getFloatTimeDomainData(this._meterBuf);
    let peak = 0;
    for (let i = 0; i < this._meterBuf.length; i++) {
      const a = Math.abs(this._meterBuf[i]);
      if (a > peak) peak = a;
    }
    this._lvl = Math.max(peak, this._lvl * 0.88);
    return Math.min(1, this._lvl);
  }

  setMuted(muted) {
    this.engine.ramp(this.muteGain.gain, muted ? 0 : 1, 0.04);
  }

  // 核への近さ。リバーブと高域の落ち方、それに音量の減り方が決まる。
  setDistance(near) {
    this.near = near;
    this.applyLevel();
    this.applySend();
    this.setPosition(this._x, this._y);
  }

  // その星自身の音量。距離による減り方とは別に掛かる。
  setVolume(vol) {
    this.vol = vol;
    this.applyLevel();
  }

  applyLevel() {
    this.engine.ramp(this.levelGain.gain, this.vol * gainFromNear(this.near));
  }

  applySend() {
    this.engine.ramp(this.reverbSend.gain, Math.min(1, this.common.reverbSend + distanceSend(this.near)));
  }

  setPosition(x, y) {
    if (x == null || y == null) return;
    this._x = x;
    this._y = y;
    if (this.panner) this.engine.ramp(this.panner.pan, Math.min(1, Math.max(-1, x * 2 - 1)));
    this.applyTone(cutoffFromY(y) * airFactor(this.near));
  }

  applyTone(hz) {
    this.engine.ramp(this.toneFilter.frequency, hz);
  }

  setCommon(key, value) {
    this.common[key] = value;
    if (key === 'reverbSend') this.applySend();
    if (key === 'delaySend') this.engine.ramp(this.delaySend.gain, value);
  }

  setParam(key, value) {
    if (key in this.common) return this.setCommon(key, value);
    this.params[key] = value;
    this.applyParam(key, value);
  }

  applyParam() {}

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
    try {
      this.envGain.disconnect();
      this.muteGain.disconnect();
      this.meter.disconnect();
      this.levelGain.disconnect();
      this.toneFilter.disconnect();
      if (this.panner) this.panner.disconnect();
      this.dryGain.disconnect();
      this.reverbSend.disconnect();
      this.delaySend.disconnect();
    } catch (e) { /* noop */ }
    this.engine.removeVoice(this);
  }
}
