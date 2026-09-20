import { Voice } from './base.js';
import { getNoiseBuffer } from '../noiseBuffer.js';

// 短い音がランダムな間隔で落ちる。唯一「音楽っぽさ」を作るパート。
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
    { key: 'interval', label: '間隔', min: 0.05, max: 5, scale: 'log', unit: 's' },
    { key: 'jitter', label: '間隔のばらつき', min: 0, max: 100, scale: 'lin', unit: '%' },
    { key: 'grainLen', label: '粒の長さ', min: 20, max: 2000, scale: 'log', unit: 'ms' },
    { key: 'center', label: '音程中心', min: 100, max: 4000, scale: 'log', unit: 'Hz' },
    { key: 'spread', label: '音程幅', min: 0, max: 2400, scale: 'lin', unit: 'cent' },
    { key: 'width', label: '定位のばらつき', min: 0, max: 1, scale: 'lin' },
    { key: 'wave', label: '波形', type: 'select', options: ['sine', 'triangle', 'noise'] }
  ];

  build() {
    this.mix = this.ctx.createGain();
    this.mix.gain.value = 0.7;
    this.mix.connect(this.envGain);
    this.resetSchedule();
  }

  teardown() {
    this.nextTime = Infinity;
    if (this.mix) { try { this.mix.disconnect(); } catch (e) { /* noop */ } this.mix = null; }
  }

  // 復帰時に過去時刻へ予約しないよう内部時刻を引き直す
  resetSchedule() {
    this.nextTime = this.ctx.currentTime + 0.05;
  }

  _step() {
    const j = this.params.jitter / 100;
    const f = 1 + (Math.random() * 2 - 1) * j;
    return Math.max(0.02, this.params.interval * f);
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
    // 音程は中心 ± 幅/2 から連続値で選ぶ。スケール吸着はしない。
    const cents = (Math.random() * 2 - 1) * this.params.spread / 2;
    const freq = this.params.center * Math.pow(2, cents / 1200);
    const len = this.params.grainLen / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + Math.min(len * 0.3, 0.05));
    g.gain.linearRampToValueAtTime(0, t + len);
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
}
