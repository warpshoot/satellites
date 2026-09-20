// Voice の共通インターフェース: start() / stop() / setParam() / dispose() / output

export const COMMON_PARAMS = [
  { key: 'attack', label: 'アタック', min: 0.01, max: 20, scale: 'log', unit: 's' },
  { key: 'release', label: 'リリース', min: 0.01, max: 30, scale: 'log', unit: 's' },
  { key: 'drift', label: 'ゆらぎ', min: 0, max: 1, scale: 'lin' },
  { key: 'reverbSend', label: 'リバーブ', min: 0, max: 1, scale: 'lin' },
  { key: 'delaySend', label: 'ディレイ', min: 0, max: 1, scale: 'lin' }
];

export const COMMON_DEFAULTS = {
  attack: 2.0,
  release: 4.0,
  drift: 0.3,
  reverbSend: 0.4,
  delaySend: 0.15
};

export const TONE_MIN = 100;
export const TONE_MAX = 16000;

const TAU = Math.PI * 2;

// 縦位置は音色の傾き。ローパス1本で塞ぐと、上に置いた星も下に置いた星も
// 「暗いか、もっと暗いか」でしかなくなる。低域と高域を逆向きに動かす。
export const TILT_DB = 9;

export function tiltFromY(y) {
  return Math.min(1, Math.max(0, y)) * 2 - 1;
}

// 面から浮いた分。距離にはすでに入っているが、方向としては何も言っていない。
// 円軌道を倒しても核からの距離は変わらないので、傾斜は音にほとんど出てこない。
// |z| で直接音を減らして送りを増やし（にじむ）、符号で前後を分ける（奥は暗い）。
export const LIFT_FULL = 0.5; // この高さで効きが振り切る

export function liftAmount(z) {
  return Math.min(1, Math.abs(z || 0) / LIFT_FULL);
}

export const LIFT_DRY = 0.35;   // 浮くほど直接音を削る
export const LIFT_WET = 0.9;    // 浮くほど送りを増やす
export const LIFT_PREDELAY = 0.03; // 送りだけを遅らせて面から剥がす（秒）
export const BACK_DB = -4.5;    // 奥は高域が落ちる
export const FRONT_DB = 1.5;    // 手前はわずかに前に出る

// 距離による空気の吸収。核から離れるほど高域が先に落ちる。
export function airHzFromNear(near) {
  const n = Math.min(1, Math.max(0, near));
  return 600 * Math.pow(20000 / 600, n);
}

// near は核への近さ（0 = 遠い / 1 = 核のすぐそば）。
// 床を持たせない。遠ざかった星が鳴り続けるのは嘘になる。
export function gainFromNear(near) {
  return Math.pow(Math.min(1, Math.max(0, near)), 1.3);
}

export function distanceSend(near) {
  return 0.55 * (1 - Math.min(1, Math.max(0, near)));
}

// 送りはドライほど落とさない。距離の手がかりは絶対量ではなく
// ウェットとドライの比なので、同じ落ち方をさせると遠い星はただ消える。
export function wetFromNear(near) {
  return Math.pow(Math.min(1, Math.max(0, near)), 0.35);
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
    this._airHz = 1000;
    this._panBase = 0;
    this._tilt = 0;
    this._lift = 0;
    this._backDb = 0;
    this._lastEvolve = -1e9;
    this._driftWasOn = false;
    this._initDrift();

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

    // 距離の減衰。送りより手前に置くと、遠い星はウェットごと消える。
    // ここはドライの枝の中だけに効かせる。
    this.levelGain = ctx.createGain();
    this.levelGain.gain.value = this.vol * gainFromNear(this.near);

    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 1000;
    this.toneFilter.Q.value = 0.7;

    this.loShelf = ctx.createBiquadFilter();
    this.loShelf.type = 'lowshelf';
    this.loShelf.frequency.value = 320;
    this.loShelf.gain.value = 0;

    this.hiShelf = ctx.createBiquadFilter();
    this.hiShelf.type = 'highshelf';
    this.hiShelf.frequency.value = 2600;
    this.hiShelf.gain.value = 0;

    this.panner = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : null;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1.0; // dry は常に 1.0 固定。send はパラレル送り。
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this._wetGain(this.common.reverbSend, true);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = this._wetGain(this.common.delaySend, false);

    // 浮いた星の送りだけを遅らせる。ドライには掛けない。
    // ドライを片側だけずらすとモノで合わせたときに櫛状に穴が開く。
    this.liftDelay = ctx.createDelay(0.1);
    this.liftDelay.delayTime.value = 0;

    this.envGain.connect(this.muteGain);
    this.muteGain.connect(this.meter);
    this.muteGain.connect(this.toneFilter);
    this.toneFilter.connect(this.loShelf);
    this.loShelf.connect(this.hiShelf);
    const tail = this.panner || this.hiShelf;
    if (this.panner) this.hiShelf.connect(this.panner);
    tail.connect(this.levelGain);
    tail.connect(this.reverbSend);
    tail.connect(this.delaySend);
    this.levelGain.connect(this.dryGain);

    this.dryGain.connect(engine.masterBus);
    this.reverbSend.connect(this.liftDelay);
    this.liftDelay.connect(engine.reverbInput);
    this.delaySend.connect(engine.delayInput);

    // サブクラスが音源を差し込む先
    this.input = this.envGain;
    this.output = this.dryGain;
  }

  // --- サブクラスが実装する ---
  build() {}
  teardown() {}
  weight() { return 1; }
  applyDrift() {}
  retune() {}

  get tuning() {
    return this.engine.tuning;
  }

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
    this.applySend(); // 送りはドライの段を通らないので、ここでも掛け直す
  }

  applyLevel() {
    const lift = 1 - LIFT_DRY * this._lift;
    this.engine.ramp(this.levelGain.gain, this.vol * gainFromNear(this.near) * lift);
  }

  _wetGain(knob, withDistance) {
    const amount = withDistance ? Math.min(1, knob + distanceSend(this.near)) : knob;
    return amount * this.vol * wetFromNear(this.near) * (1 + LIFT_WET * this._lift);
  }

  applySend() {
    this.engine.ramp(this.reverbSend.gain, this._wetGain(this.common.reverbSend, true));
    this.engine.ramp(this.delaySend.gain, this._wetGain(this.common.delaySend, false));
  }

  setPosition(x, y) {
    if (x == null || y == null) return;
    this._x = x;
    this._y = y;
    this._panBase = Math.min(1, Math.max(-1, x * 2 - 1));
    if (this.panner) this.engine.ramp(this.panner.pan, this._panBase);
    this._tilt = tiltFromY(y);
    this.applyShelves();
    this._airHz = airHzFromNear(this.near);
    this.applyTone(this._airHz);
  }

  // 縦位置の傾きと、面の前後を同じシェルフで受ける。
  // 低域は前後で動かさない。奥に行くほど落ちるのは高域だけ。
  applyShelves() {
    this.engine.ramp(this.loShelf.gain, -this._tilt * TILT_DB, 0.05);
    this.engine.ramp(this.hiShelf.gain, this._tilt * TILT_DB + this._backDb, 0.05);
  }

  // 面からの浮き。距離とは別に、にじみ方と前後を決める。
  setElevation(z) {
    this._z = z || 0;
    this._lift = liftAmount(this._z);
    this._backDb = (this._z < 0 ? BACK_DB : FRONT_DB) * this._lift;
    this.applyLevel();
    this.applySend();
    this.applyShelves();
    this.engine.ramp(this.liftDelay.delayTime, LIFT_PREDELAY * this._lift, 0.2);
  }

  applyTone(hz) {
    this.engine.ramp(this.toneFilter.frequency, hz);
  }

  // ---- ゆらぎ --------------------------------------------------------
  // 周期が噛み合わない正弦を重ねる。乱数を毎回引くとノイズになるし、
  // 単一の LFO だと周期が読めてしまう。戻ってこない揺れが欲しい。
  _initDrift() {
    const periods = [37.3, 53.7, 71.1, 97.3];
    this._dr = periods.map((p) => {
      const w = (TAU / p) * (0.8 + Math.random() * 0.4);
      return { w1: w, w2: w * 1.618, p1: Math.random() * TAU, p2: Math.random() * TAU };
    });
  }

  driftAt(i, t) {
    const a = this._dr[i % this._dr.length];
    return Math.sin(t * a.w1 + a.p1) * 0.62 + Math.sin(t * a.w2 + a.p2) * 0.38;
  }

  // scheduler から呼ばれる。4Hz で足りる速さの変化しか扱わない。
  evolve(t) {
    if (this.disposed || !this.started) return;
    if (t - this._lastEvolve < 0.25) return;
    this._lastEvolve = t;
    const d = this.common.drift || 0;
    if (d <= 0) {
      if (!this._driftWasOn) return;
      this._driftWasOn = false;
      this.applyTone(this._airHz);
      if (this.panner) this.engine.ramp(this.panner.pan, this._panBase, 0.3);
      this.applyDrift(0, t);
      return;
    }
    this._driftWasOn = true;
    this.applyTone(this._airHz * Math.pow(2, this.driftAt(0, t) * d * 0.5));
    if (this.panner) {
      const pan = Math.min(1, Math.max(-1, this._panBase + this.driftAt(1, t) * d * 0.18));
      this.engine.ramp(this.panner.pan, pan, 0.3);
    }
    this.applyDrift(d, t);
  }

  setCommon(key, value) {
    this.common[key] = value;
    if (key === 'reverbSend' || key === 'delaySend') this.applySend();
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
      this.loShelf.disconnect();
      this.hiShelf.disconnect();
      if (this.panner) this.panner.disconnect();
      this.dryGain.disconnect();
      this.reverbSend.disconnect();
      this.liftDelay.disconnect();
      this.delaySend.disconnect();
    } catch (e) { /* noop */ }
    this.engine.removeVoice(this);
  }
}
