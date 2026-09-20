import { Voice } from './base.js';
import { getNoiseBuffer } from '../noiseBuffer.js';

// 白色ノイズをバンドパスで削る。風、雨、ヒスなどの質感担当。
// バンドパスは帯域外を捨てるので、Q を上げるほど痩せる（実測で RMS はほぼ 1/√Q）。
// √Q で持ち上げると、Q を振っても音量が動かない。
function makeup(q) {
  return 2.2 * Math.sqrt(Math.max(0.1, q));
}

export class NoiseVoice extends Voice {
  static type = 'noise';
  static label = 'NOISE';
  static look = 'solid';
  static color = '#7fd6b5';
  static defaults = { center: 800, q: 2.0, swellDepth: 0.3, swellRate: 0.15, width: 0.8 };
  static params = [
    { key: 'center', label: '帯域中心', min: 20, max: 12000, scale: 'log', unit: 'Hz' },
    { key: 'q', label: '幅（Q）', min: 0.5, max: 30, scale: 'log' },
    { key: 'swellDepth', label: 'うねり深さ', min: 0, max: 1, scale: 'lin' },
    { key: 'swellRate', label: 'うねり速度', min: 0.02, max: 2, scale: 'log', unit: 'Hz' },
    { key: 'width', label: '広がり', min: 0, max: 1, scale: 'lin' }
  ];

  build() {
    const ctx = this.ctx;
    // 左右で同じ波形を読むとモノになる。共有バッファを別の位置から読んで相関を切る。
    const buf = getNoiseBuffer(ctx);
    this.srcs = [];
    this.pans = [];
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i === 0 ? -1 : 1) * this.params.width;
      src.connect(pan);
      this.srcs.push(src);
      this.pans.push(pan);
    }

    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = this.params.center;
    this.band.Q.value = this.params.q;

    this.makeup = ctx.createGain();
    this.makeup.gain.value = makeup(this.params.q);

    // うねりは振幅への LFO 変調（JS でループは回さない）
    this.trem = ctx.createGain();
    this.trem.gain.value = 1 - this.params.swellDepth * 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.swellRate;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = this.params.swellDepth * 0.5;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.trem.gain);

    for (const pan of this.pans) pan.connect(this.band);
    this.band.connect(this.makeup);
    this.makeup.connect(this.trem);
    this.trem.connect(this.envGain);
    const dur = getNoiseBuffer(ctx).duration;
    this.srcs[0].start(0, Math.random() * dur * 0.4);
    this.srcs[1].start(0, dur * 0.5 + Math.random() * dur * 0.4);
    this.lfo.start();
  }

  teardown() {
    for (const n of (this.srcs || []).concat([this.lfo])) {
      if (n) { try { n.stop(); n.disconnect(); } catch (e) { /* noop */ } }
    }
    for (const n of (this.pans || []).concat([this.band, this.makeup, this.trem, this.lfoGain])) {
      if (n) { try { n.disconnect(); } catch (e) { /* noop */ } }
    }
    this.srcs = this.pans = null;
    this.lfo = this.band = this.makeup = this.trem = this.lfoGain = null;
  }

  applyParam(key) {
    if (!this.band) return;
    if (key === 'center') this.engine.ramp(this.band.frequency, this.params.center, 0.05);
    if (key === 'q') {
      this.engine.ramp(this.band.Q, this.params.q, 0.05);
      this.engine.ramp(this.makeup.gain, makeup(this.params.q), 0.05);
    }
    if (key === 'swellRate') this.engine.ramp(this.lfo.frequency, this.params.swellRate, 0.05);
    if (key === 'width') {
      this.pans.forEach((p, i) => this.engine.ramp(p.pan, (i === 0 ? -1 : 1) * this.params.width, 0.05));
    }
    if (key === 'swellDepth') {
      this.engine.ramp(this.trem.gain, 1 - this.params.swellDepth * 0.5, 0.05);
      this.engine.ramp(this.lfoGain.gain, this.params.swellDepth * 0.5, 0.05);
    }
  }
}
