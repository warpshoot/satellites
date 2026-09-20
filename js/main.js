import { engine } from './audio/engine.js';
import { createVoice, voiceClass } from './audio/voices/registry.js';
import { state, loadPatch, save, newVoiceData, findVoice, MAX_VOICES } from './state.js';
import { createField } from './ui/field.js';
import { createPanel } from './ui/panel.js';
import { createStrip } from './ui/strip.js';

const fieldEl = document.getElementById('field');
const panelEl = document.getElementById('panel');
const starsEl = document.getElementById('stars');
const gateEl = document.getElementById('gate');
const noticeEl = document.getElementById('notice');
const transportEl = document.getElementById('transport');

const live = new Map();   // id -> Voice
const muted = new Set();  // 保存しない。次に開いて無音だと壊れたように見える。
const soloed = new Set();
let started = false;
let noticeTimer = null;
let lastVoiceId = null;
let paused = false;   // 意図的な停止。自動復帰の対象外にする。
let pauseTimer = null;

const TAU = Math.PI * 2;

// 盤面は正方形ではないので、正円に「見える」軌道を描くには縦横比が要る。
let aspect = 1;
export function setAspect(a) {
  if (a > 0) aspect = a;
}

// 面から浮く量。盤面の横幅 1 に対してどれだけ動かすか。
const Z_GAIN = 0.85;

// 距離の減衰の基準。この距離で音量がおよそ半分になる。
const HALF = 0.32;

// 軌道上の一点を、正規化座標の差分として返す。半径 rho は画面の横幅を 1 とした長さ。
// 実際の軌道要素と同じ組み立て: 面の中で楕円を描き、傾斜で面ごと奥へ倒し、
// 最後に向き（昇交点）で面の中を回す。
function ellipsePoint(rho, ecc, angleDeg, inclDeg, theta) {
  const a = rho;
  const b = rho * Math.sqrt(1 - ecc * ecc);
  const ph = (angleDeg * Math.PI) / 180;
  const ic = (inclDeg * Math.PI) / 180;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const px = a * ct;
  const py = b * st * Math.cos(ic);
  const pz = b * st * Math.sin(ic);
  return {
    x: px * Math.cos(ph) - py * Math.sin(ph),
    y: (px * Math.sin(ph) + py * Math.cos(ph)) * aspect,
    z: pz * Z_GAIN
  };
}

// 置いた位置から、半径と開始角を逆算する
function orbitSeed(dx, dy, angleDeg) {
  const u = dx;
  const w = dy / aspect;
  const ph = (angleDeg * Math.PI) / 180;
  const ur = u * Math.cos(ph) + w * Math.sin(ph);
  const wr = -u * Math.sin(ph) + w * Math.cos(ph);
  return { rho: Math.hypot(ur, wr), theta: Math.atan2(wr, ur) };
}

// 周回の半径と位相はパラメータとして持つ。まだ無ければ現在地から割り出す。
export function orbitGeom(v) {
  if (v.orbitRadius != null) return { rho: v.orbitRadius, phase: v.orbitPhase || 0 };
  const seed = orbitSeed(v.x - CENTER.x, v.y - CENTER.y, v.orbitAngle || 0);
  return { rho: seed.rho, phase: seed.theta };
}

// いまの見えている位置から、半径と位相を逆算する
export function orbitFromPoint(v, x, y, t) {
  const seed = orbitSeed(x - CENTER.x, y - CENTER.y, v.orbitAngle || 0);
  const period = Math.max(1, v.orbitPeriod || 60);
  const dir = v.orbitDir === 'retrograde' ? -1 : 1;
  return {
    rho: Math.min(2, Math.max(0.02, seed.rho)),
    phase: seed.theta - ((TAU * t) / period) * dir
  };
}

export function orbitState(v, t) {
  const ang = v.orbitAngle || 0;
  const period = Math.max(1, v.orbitPeriod || 60);
  const dir = v.orbitDir === 'retrograde' ? -1 : 1;
  const g = orbitGeom(v);
  const theta = g.phase + ((TAU * t) / period) * dir;
  const p = ellipsePoint(g.rho, v.orbitEcc || 0, ang, v.orbitIncl || 0, theta);
  return { x: p.x, y: p.y, z: p.z, rho: g.rho };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 核は盤面のど真ん中に固定。動かないので、周回は常にここを回る。
export const CENTER = { x: 0.5, y: 0.5 };

function resolve(v, t) {
  if (v.orbit) {
    // 半径はノブではなく「核からどれだけ離して置いたか」で決まる。
    // 盤面の外へ出る軌道もあるので、ここでは丸めない。丸めると距離が頭打ちになる。
    const o = orbitState(v, t);
    return { x: CENTER.x + o.x, y: CENTER.y + o.y, zOff: o.z };
  }
  return { x: v.x, y: v.y, zOff: 0 };
}

// 核からの3次元距離。盤面は正方形でないので縦は縦横比で割って揃える。
export function coreDistance(pos) {
  const dx = pos.x - CENTER.x;
  const dy = (pos.y - CENTER.y) / aspect;
  const dz = pos.zOff || 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 0 = 遠い / 1 = 核のすぐそば。逆二乗で落とすので、
// 盤面の外へ出てもそのまま減り続け、底打ちしない。
export function nearFromDistance(d) {
  const r = d / HALF;
  return 1 / (1 + r * r);
}


const app = {
  voices: () => state.patch.voices,
  master: () => state.patch.master,
  find: (id) => findVoice(id),
  typeOf: (v) => voiceClass(v.type),
  selectedId: () => state.selectedId,
  selected: () => (state.selectedId ? findVoice(state.selectedId) : null),
  canAdd: () => state.patch.voices.length < MAX_VOICES,

  resolved(v) {
    return resolve(v, engine.ctx ? engine.ctx.currentTime : 0);
  },

  effectivePos(v) {
    return this.resolved(v);
  },

  nearOf(v) {
    return nearFromDistance(coreDistance(this.resolved(v)));
  },

  // 星の見た目の大きさ。音量と近さの積。
  apparentOf(v) {
    return this.nearOf(v) * (0.25 + 0.75 * (v.vol != null ? v.vol : 0.85));
  },

  // 種類の差し替え。古い音は release で消えていき、新しい音が
  // アタックで立ち上がるので、切り替わりは自然につながる。
  setType(id, type) {
    const v = findVoice(id);
    if (!v || v.type === type) return;
    const OldV = voiceClass(v.type);
    const V = voiceClass(type);
    v.type = type;
    v.params = Object.assign({}, V.defaults); // 固有パラメータは引き継げない
    if (v.look === OldV.look) v.look = V.look; // 触っていない見た目は種類に追従させる
    const old = live.get(id);
    if (old) {
      live.delete(id);
      old.stop();
    }
    if (started) spawn(v);
    redraw();
    save();
  },

  setLook(id, look) {
    const v = findVoice(id);
    if (!v) return;
    v.look = look;
    field.render();
    strip.render();
    save();
  },

  setVolume(id, vol) {
    const v = findVoice(id);
    if (!v) return;
    v.vol = vol;
    const voice = live.get(id);
    if (voice) voice.setVolume(vol);
    field.layout();
  },

  setAspect: (a) => setAspect(a),

  // 軌道の道筋。傾斜で面が倒れるので点列で返す。
  orbitPath(v, n) {
    if (!v.orbit) return null;
    const g = orbitGeom(v);
    if (g.rho < 0.004) return null;
    const pts = [];
    const steps = n || 96;
    for (let i = 0; i <= steps; i++) {
      const p = ellipsePoint(g.rho, v.orbitEcc || 0, v.orbitAngle || 0, v.orbitIncl || 0, (TAU * i) / steps);
      pts.push({ x: CENTER.x + p.x, y: CENTER.y + p.y, dz: p.z });
    }
    return pts;
  },

  hasVoices: () => state.patch.voices.length > 0,
  isMuted: (id) => muted.has(id),
  isSoloed: (id) => soloed.has(id),
  soloActive: () => soloed.size > 0,

  // ソロが1つでも立っていれば、それ以外は黙る
  audible(id) {
    if (muted.has(id)) return false;
    return soloed.size === 0 || soloed.has(id);
  },

  toggleMute(id) {
    if (muted.has(id)) muted.delete(id);
    else muted.add(id);
    applyAudible();
  },

  toggleSolo(id) {
    if (soloed.has(id)) soloed.delete(id);
    else soloed.add(id);
    applyAudible();
  },

  clearSolo() {
    soloed.clear();
    applyAudible();
  },


  select(id) {
    state.selectedId = id;
    if (id) lastVoiceId = id;
    redraw();
  },

  // タブから音色パネルに戻るとき、直前に見ていた点を開く
  focusVoice() {
    const v = findVoice(lastVoiceId) || state.patch.voices[0];
    if (v) this.select(v.id);
  },

  add(type, x, y) {
    if (!this.canAdd()) return this.notice('星は8つまで');
    const data = newVoiceData(type, clamp01(x), clamp01(y));
    state.patch.voices.push(data);
    if (started) spawn(data);
    state.selectedId = lastVoiceId = data.id;
    redraw();
    save();
  },

  duplicate(id) {
    const src = findVoice(id);
    if (!src) return;
    if (!this.canAdd()) return this.notice('星は8つまで');
    const data = newVoiceData(src.type, clamp01(src.x + 0.07), clamp01(src.y - 0.07));
    data.orbit = src.orbit;
    data.vol = src.vol;
    data.look = src.look;
    data.orbitPeriod = src.orbitPeriod;
    data.orbitDir = src.orbitDir;
    data.orbitRadius = src.orbitRadius;
    data.orbitPhase = src.orbitPhase;
    data.orbitEcc = src.orbitEcc;
    data.orbitAngle = src.orbitAngle;
    data.orbitIncl = src.orbitIncl;
    data.common = Object.assign({}, src.common);
    data.params = Object.assign({}, src.params);
    state.patch.voices.push(data);
    if (started) spawn(data);
    state.selectedId = lastVoiceId = data.id;
    redraw();
    save();
  },

  remove(id) {
    const i = state.patch.voices.findIndex((v) => v.id === id);
    if (i < 0) return;
    state.patch.voices.splice(i, 1);
    const voice = live.get(id);
    if (voice) {
      live.delete(id);
      voice.stop(); // release をかけてから切る
    }
    muted.delete(id);
    soloed.delete(id);
    applyAudible();
    if (state.selectedId === id) state.selectedId = null;
    redraw();
    save();
  },

  // 周回中は指の位置から半径と位相を書き換える。止まっていれば座標をそのまま動かす。
  moveTo(id, x, y) {
    const v = findVoice(id);
    if (!v) return;
    if (v.orbit) {
      const g = orbitFromPoint(v, x, y, engine.ctx ? engine.ctx.currentTime : 0);
      v.orbitRadius = g.rho;
      v.orbitPhase = g.phase;
      applyPos(v);
      field.layout();
      return;
    }
    v.x = clamp01(x);
    v.y = clamp01(y);
    applyPos(v);
    field.layout();
  },

  setParam(id, key, value) {
    const v = findVoice(id);
    if (!v) return;
    if (key in v.common) v.common[key] = value;
    else v.params[key] = value;
    const voice = live.get(id);
    if (voice) voice.setParam(key, value);
  },

  // 古いパッチでは半径が未設定なので、そのときは現在地から割り出した値を見せる
  orbitRadiusOf(v) {
    return orbitGeom(v).rho;
  },

  setOrbitParam(id, key, value) {
    const v = findVoice(id);
    if (!v) return;
    v[key] = value;
    applyPos(v);
    field.layout();
  },

  toggleOrbit(id) {
    const v = findVoice(id);
    if (!v) return;
    const t = engine.ctx ? engine.ctx.currentTime : 0;
    if (!v.orbit) {
      // 入れた瞬間に飛ばないよう、いまの場所から半径と位相を割り出す
      const g = orbitFromPoint(v, v.x, v.y, t);
      v.orbitRadius = g.rho;
      v.orbitPhase = g.phase;
      v.orbit = true;
    } else {
      // 外すときは、いま見えている場所に置いていく
      const pos = this.resolved(v);
      v.x = clamp01(pos.x);
      v.y = clamp01(pos.y);
      v.orbit = false;
    }
    applyPos(v);
    redraw();
    save();
  },

  sky: () => state.patch.master.sky,
  cameraFollow: () => state.patch.master.follow,

  applyMaster(withIR) {
    if (!engine.ready) return;
    const m = state.patch.master;
    if (!paused) engine.setMasterGain(m.gain); // 停止中に音量を触っても鳴り出さない
    engine.setDelayTime(m.delay.time);
    engine.setDelayFeedback(m.delay.feedback);
    if (withIR) engine.setReverbIR(m.reverb.length, m.reverb.decay);
  },

  commit() { save(); },

  refreshPanel() { panel.render(); },

  refreshField() { field.render(); strip.render(); },


  requestDelete(id) { field.askDelete(id); },

  notice(text) {
    noticeEl.textContent = text;
    noticeEl.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => noticeEl.classList.remove('show'), 1600);
  }
};

// ソロは全体に効くので、1つ変わったら全ボイスに掛け直す
// 盤面・パネル・星の帯をまとめて描き直す
function redraw() {
  field.render();
  panel.render();
  strip.render();
}

function applyAudible() {
  for (const v of state.patch.voices) {
    const voice = live.get(v.id);
    if (voice) voice.setMuted(!app.audible(v.id));
  }
  redraw();
}

function applyPos(v) {
  const voice = live.get(v.id);
  if (!voice) return;
  const p = app.resolved(v);
  voice.setVolume(v.vol != null ? v.vol : 0.85);
  voice.setDistance(nearFromDistance(coreDistance(p)));
  voice.setPosition(p.x, p.y);
}

function spawn(data) {
  const voice = createVoice(engine, data);
  engine.addVoice(voice);
  live.set(data.id, voice);
  const p = app.resolved(data);
  voice.setDistance(nearFromDistance(coreDistance(p)));
  voice.setPosition(p.x, p.y);
  voice.setMuted(!app.audible(data.id));
  voice.start();
  return voice;
}

const field = createField(fieldEl, app);
const panel = createPanel(panelEl, app);
const strip = createStrip(starsEl, app);

loadPatch();
redraw();

// 周回の計算は 10Hz で十分。毎フレームは回さない。
setInterval(() => {
  const orbiting = state.patch.voices.some((v) => v.orbit);
  const camMoving = field.stepCamera();
  if (!orbiting && !camMoving) return;
  if (orbiting) for (const v of state.patch.voices) applyPos(v);
  field.layout();
}, 100);

// 出音に合わせた膨らみ。見た目だけなので毎フレームでいい。
let pulseWasOn = true;

function meterLoop() {
  requestAnimationFrame(meterLoop);
  if (!started || !engine.ctx || engine.ctx.state !== 'running') return;
  if (!state.patch.master.pulse) {
    if (pulseWasOn) {
      for (const id of live.keys()) field.setPulse(id, 0); // 切った瞬間に静止させる
      pulseWasOn = false;
    }
    return;
  }
  pulseWasOn = true;
  for (const [id, voice] of live) field.setPulse(id, voice.getLevel());
}
requestAnimationFrame(meterLoop);

window.addEventListener('resize', () => field.layout());

// iOS Safari はロックやバックグラウンドで suspend される
// ---- 中断と復帰 -------------------------------------------------------
// iOS はバックグラウンドやシステムダイアログで AudioContext を止める。
// resume() はユーザー操作の中でしか通らないので、必ず出口を出しておく。
const gateTitle = gateEl.querySelector('h1');
const gateText = gateEl.querySelector('p');
const gateCta = gateEl.querySelector('.gate-cta');

function running() {
  return !!engine.ctx && engine.ctx.state === 'running';
}

function showGate(mode) {
  if (mode === 'resume') {
    gateTitle.textContent = 'SATELLITES';
    gateText.innerHTML = '音が止まっている<br>バックグラウンドに回ると止まる';
    gateCta.textContent = 'タップして再開';
  }
  gateEl.classList.remove('gone');
}

function hideGate() {
  gateEl.classList.add('gone');
}

async function ensureRunning() {
  if (!started || paused) return; // 自分で止めたものを勝手に鳴らし直さない
  try {
    await engine.resume();
  } catch (e) {
    /* ジェスチャの外からは弾かれる。ゲートを出して待つ。 */
  }
  if (running()) {
    engine.resetSchedulers(); // 過去時刻に予約して暴発させない
    hideGate();
  } else {
    showGate('resume');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  ensureRunning();
});

// ジェスチャの中でもう一度試す。ゲートを踏み損ねても復帰できるように。
document.addEventListener('pointerdown', () => {
  if (started && !running()) ensureRunning();
}, true);

async function begin() {
  if (started) {
    ensureRunning();
    return;
  }
  started = true;
  engine.init();
  engine.ctx.addEventListener('statechange', () => {
    if (!started || paused) return;
    if (running()) hideGate();
    else showGate('resume');
  });
  await engine.resume();
  app.applyMaster(true);
  for (const data of state.patch.voices) spawn(data); // 復帰した点は一斉にフェードイン
  hideGate();
  setTransport();
  redraw();
}

// ---- 停止／再生 -------------------------------------------------------
// suspend をそのまま割り当てるとブツッと切れる。フェードを挟む。
function setTransport() {
  transportEl.classList.toggle('playing', started && !paused);
  transportEl.classList.toggle('visible', started);
}

async function togglePlay() {
  if (!started) return;
  clearTimeout(pauseTimer);
  if (paused) {
    paused = false;
    setTransport();
    try {
      await engine.resume();
    } catch (e) { /* noop */ }
    if (running()) {
      engine.resetSchedulers();
      engine.setMasterGain(state.patch.master.gain);
      hideGate();
    } else {
      showGate('resume');
    }
  } else {
    paused = true;
    setTransport();
    engine.ramp(engine.masterGain.gain, 0, 0.25);
    pauseTimer = setTimeout(() => {
      if (paused && engine.ctx) engine.ctx.suspend();
    }, 900);
  }
}

transportEl.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

gateEl.addEventListener('click', begin);
