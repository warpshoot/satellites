import { voiceClass } from './audio/voices/registry.js';
import { LOOK_IDS, LOOK_LABELS, SKY_STYLES, SKY_LABELS } from './ui/looks.js';
import { COMMON_DEFAULTS } from './audio/voices/base.js';
import { ROOTS, SCALE_IDS, SCALE_LABELS, TUNING_DEFAULTS } from './audio/music.js';

// 同時に置ける星の数。DRONE を 3 本重ねると残り 5 で、それだと
// 土台と質感と粒を同居させた時点で埋まる。実測のヘッドルームに余裕があるので
// 12 まで開けた（masterBus 側で 1dB ぶん下げてある）。
export const MAX_VOICES = 12;

const KEY = 'satellites.patch.v1';
const OLD_KEY = 'drift.patch.v1'; // DRIFT 時代の保存を引き継ぐ
const VERSION = 3;

// 周回するときだけ意味を持つ。周回 OFF でも並びからは消さず、触れなくするだけ。
// 消すと行数が変わってパネルが跳ね、何が隠れているかも分からなくなる。
export const ORBIT_PARAMS = [
  { key: 'orbitPeriod', label: '周期', min: 5, max: 600, scale: 'log', unit: 's', def: 60 },
  { key: 'orbitRadius', label: '半径', min: 0.02, max: 2, scale: 'log', def: 0.3 },
  { key: 'orbitEcc', label: '離心率', min: 0, max: 0.9, scale: 'pow', def: 0 },
  { key: 'orbitAngle', label: '向き', min: 0, max: 360, scale: 'lin', unit: '°', def: 0 },
  { key: 'orbitIncl', label: '傾斜', min: 0, max: 90, scale: 'lin', unit: '°', def: 0 },
  { key: 'orbitDir', label: '方向', type: 'select', options: ['prograde', 'retrograde'], labels: { prograde: '順行', retrograde: '逆行' } }
];

export const MASTER_DEFAULTS = {
  gain: 0.8,
  // 基音と音階は全ボイスで共有する。星がどこに置かれても音程は噛み合う。
  tuning: Object.assign({}, TUNING_DEFAULTS),
  reverb: { length: 3.0, decay: 2.5 },
  delay: { time: 420, feedback: 0.35, sync: true, tone: 0.5, wow: 0 },
  burn: 0,       // マスターの飽和。0 は曲線が恒等なので厳密に素通し。
  pulse: true,  // 音に合わせて星を動かすか
  sky: 'noise', // 背景の星の種類
  follow: false // 選んだ星を画面の中心に置くか
};

const ONOFF = { type: 'select', options: [true, false], labels: { true: 'ON', false: 'OFF' } };

// マスターは機能ごとに束ねる。セクションの見出しが文脈を持つので、
// ラベル側で「リバーブ長さ」のように繰り返さない。
export const MASTER_GROUPS = [
  {
    title: '出力',
    params: [
      { path: 'gain', label: '音量', min: 0, max: 1, scale: 'lin', def: MASTER_DEFAULTS.gain },
      { path: 'burn', label: 'サチュレーション', min: 0, max: 1, scale: 'lin', def: MASTER_DEFAULTS.burn }
    ]
  },
  {
    title: 'キー',
    params: [
      { path: 'tuning.root', label: 'ルート', type: 'select', options: ROOTS },
      { path: 'tuning.scale', label: 'スケール', type: 'select', options: SCALE_IDS, labels: SCALE_LABELS },
      // 0 で動かない。上げるほど転調が速くなる。
      { path: 'tuning.drift', label: '転調', min: 0, max: 1, scale: 'pow', def: TUNING_DEFAULTS.drift }
    ]
  },
  {
    title: 'リバーブ',
    params: [
      // 「長さ」と「減衰」は意味が食い合っていた。長さ 15 秒にしても減衰 6 だと
      // 何も伸びない。前者は部屋の寸法、後者は尾の吸われ方なので、そう呼ぶ。
      { path: 'reverb.length', label: 'サイズ', min: 0.5, max: 15, scale: 'log', unit: 's', deferred: true, def: MASTER_DEFAULTS.reverb.length },
      { path: 'reverb.decay', label: '吸収', min: 1, max: 6, scale: 'lin', deferred: true, def: MASTER_DEFAULTS.reverb.decay }
    ]
  },
  {
    title: 'ディレイ',
    params: [
      { path: 'delay.time', label: 'タイム', min: 50, max: 2000, scale: 'log', unit: 'ms', def: MASTER_DEFAULTS.delay.time },
      { path: 'delay.feedback', label: 'フィードバック', min: 0, max: 0.85, scale: 'pow', def: MASTER_DEFAULTS.delay.feedback },
      { path: 'delay.tone', label: 'トーン', min: 0, max: 1, scale: 'lin', def: MASTER_DEFAULTS.delay.tone },
      { path: 'delay.wow', label: 'ドリフト', min: 0, max: 1, scale: 'pow', def: MASTER_DEFAULTS.delay.wow },
      Object.assign({ path: 'delay.sync', label: '軌道に同期' }, ONOFF)
    ]
  },
  {
    title: '表示',
    params: [
      Object.assign({ path: 'pulse', label: 'パルス' }, ONOFF),
      { path: 'sky', label: '背景', type: 'select', options: SKY_STYLES, labels: SKY_LABELS, visual: true },
      Object.assign({ path: 'follow', label: '追尾', visual: true }, ONOFF)
    ]
  }
];

export const MASTER_PARAMS = MASTER_GROUPS.flatMap((g) => g.params);

export const LOOK_PARAM = { key: 'look', label: '形', type: 'select', options: LOOK_IDS, labels: LOOK_LABELS, look: true };

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

let seq = 0;

export function newVoiceData(type, x, y) {
  const V = voiceClass(type);
  return {
    id: 'v' + (++seq) + '-' + Math.random().toString(36).slice(2, 7),
    type: V.type,
    x, y,
    look: V.look,  // 見た目。種類ごとの既定だが、あとから選び直せる。
    vol: 0.85,     // 星自身の音量。距離による減り方とは別。
    // 置いたら回りはじめる。止まっている星は「衛星」に見えない。
    // 半径と位相は置いた場所から app.add() が割り出す。
    orbit: true,
    orbitPeriod: Math.round(30 + Math.random() * 120), // 星ごとに散らす。揃うと動きが噛み合う
    orbitRadius: null, // 周回を入れたときに現在地から割り出す
    orbitPhase: 0,
    orbitEcc: 0,      // 0 = 正円
    orbitAngle: 0,    // 面の中での向き（昇交点、度）
    orbitIncl: 0,     // 面を奥へ倒す角度（軌道傾斜角、度）
    orbitDir: 'prograde',
    common: Object.assign({}, COMMON_DEFAULTS),
    params: Object.assign({}, V.defaults)
  };
}

function emptyPatch() {
  return {
    version: VERSION,
    voices: [],
    master: JSON.parse(JSON.stringify(MASTER_DEFAULTS))
  };
}

function sanitize(raw) {
  const patch = emptyPatch();
  if (!raw || !(raw.version >= 1 && raw.version <= VERSION)) return patch;
  const rt = (raw.master && raw.master.tuning) || {};
  patch.master = {
    gain: num(raw.master && raw.master.gain, MASTER_DEFAULTS.gain),
    tuning: {
      root: ROOTS.includes(rt.root) ? rt.root : TUNING_DEFAULTS.root,
      scale: SCALE_IDS.includes(rt.scale) ? rt.scale : TUNING_DEFAULTS.scale,
      drift: clamp01(num(rt.drift, TUNING_DEFAULTS.drift))
    },
    reverb: {
      length: num(raw.master && raw.master.reverb && raw.master.reverb.length, MASTER_DEFAULTS.reverb.length),
      decay: num(raw.master && raw.master.reverb && raw.master.reverb.decay, MASTER_DEFAULTS.reverb.decay)
    },
    delay: {
      time: num(raw.master && raw.master.delay && raw.master.delay.time, MASTER_DEFAULTS.delay.time),
      feedback: Math.min(0.85, num(raw.master && raw.master.delay && raw.master.delay.feedback, MASTER_DEFAULTS.delay.feedback)),
      tone: clamp01(num(raw.master && raw.master.delay && raw.master.delay.tone, MASTER_DEFAULTS.delay.tone)),
      wow: clamp01(num(raw.master && raw.master.delay && raw.master.delay.wow, MASTER_DEFAULTS.delay.wow)),
      // 旧版のパッチはディレイ時間を自分で決めているので、勝手に周回へ合わせない
      sync: raw.master && raw.master.delay && raw.master.delay.sync != null
        ? !!raw.master.delay.sync
        : raw.version >= 3 && MASTER_DEFAULTS.delay.sync
    },
    // 旧いパッチには無いので 0（素通し）に落ちる
    burn: Math.min(1, Math.max(0, num(raw.master && raw.master.burn, MASTER_DEFAULTS.burn))),
    pulse: raw.master && raw.master.pulse != null ? !!raw.master.pulse : true,
    sky: raw.master && SKY_STYLES.includes(raw.master.sky) ? raw.master.sky : 'noise',
    follow: !!(raw.master && raw.master.follow)
  };
  const voices = Array.isArray(raw.voices) ? raw.voices.slice(0, MAX_VOICES) : [];
  for (const v of voices) {
    const V = voiceClass(v.type);
    if (!v.type || V.type !== v.type) continue;
    patch.voices.push({
      id: v.id || newVoiceData(v.type, 0.5, 0.5).id,
      type: v.type,
      x: clamp01(num(v.x, 0.5)),
      y: clamp01(num(v.y, 0.5)),
      look: LOOK_IDS.includes(v.look) ? v.look : V.look,
      vol: clamp01(num(v.vol != null ? v.vol : v.lum, 0.85)),
      // 旧版の「ゆらぎ」は周回として読み替える
      orbit: !!(v.orbit != null ? v.orbit : v.drift),
      orbitPeriod: Math.min(600, Math.max(5, num(v.orbitPeriod, 30 + Math.random() * 120))),
      orbitRadius: v.orbitRadius == null ? null : Math.min(2, Math.max(0.02, num(v.orbitRadius, 0.3))),
      orbitPhase: num(v.orbitPhase, 0),
      orbitDir: v.orbitDir === 'retrograde' ? 'retrograde' : 'prograde',
      orbitEcc: Math.min(0.9, Math.max(0, num(v.orbitEcc, 0))),
      orbitAngle: ((num(v.orbitAngle, 0) % 360) + 360) % 360,
      orbitIncl: Math.min(90, Math.max(0, num(v.orbitIncl, 0))),
      common: Object.assign({}, COMMON_DEFAULTS, v.common || {}),
      params: Object.assign({}, V.defaults, v.params || {})
    });
  }
  return patch;
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export const state = {
  patch: emptyPatch(),
  selectedId: null
};

export function loadPatch() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    state.patch = sanitize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    state.patch = emptyPatch();
  }
  return state.patch;
}

let timer = null;

export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.patch));
    } catch (e) { /* 容量超過などは黙って諦める */ }
  }, 500);
}

// ---- 持ち込み／退避 --------------------------------------------------
const BACKUP_KEY = 'satellites.patch.backup';

// 外から来たパッチを state に載せる。中身の検査は保存の読み込みと同じ関門を通す。
export function setPatch(raw) {
  state.patch = sanitize(raw);
  state.selectedId = null;
  return state.patch;
}

// リンクで上書きする前に、いま保存されているものを退避する
export function backupCurrent() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(BACKUP_KEY, cur);
  } catch (e) { /* 使えなければ諦める */ }
}

export function hasBackup() {
  try {
    return !!localStorage.getItem(BACKUP_KEY);
  } catch (e) {
    return false;
  }
}

// 戻したら退避は消す。2つ前には戻れない、という約束にしておく。
export function takeBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    localStorage.removeItem(BACKUP_KEY);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function findVoice(id) {
  return state.patch.voices.find((v) => v.id === id) || null;
}
