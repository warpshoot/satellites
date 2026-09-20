import { voiceClass } from './audio/voices/registry.js';
import { LOOK_IDS, LOOK_LABELS, SKY_STYLES, SKY_LABELS } from './ui/looks.js';
import { COMMON_DEFAULTS } from './audio/voices/base.js';

const KEY = 'satellites.patch.v1';
const OLD_KEY = 'drift.patch.v1'; // DRIFT 時代の保存を引き継ぐ
const VERSION = 2;

// 周回するときだけ意味を持つ
export const ORBIT_PARAMS = [
  { key: 'orbitPeriod', label: '周期', min: 5, max: 600, scale: 'log', unit: 's' },
  { key: 'orbitRadius', label: '軌道の大きさ', min: 0.02, max: 2, scale: 'log' },
  { key: 'orbitEcc', label: 'つぶれ具合（0 = 正円）', min: 0, max: 0.9, scale: 'lin' },
  { key: 'orbitAngle', label: '軌道の向き', min: 0, max: 360, scale: 'lin', unit: '°' },
  { key: 'orbitIncl', label: '軌道の傾斜（倒すと立体になる）', min: 0, max: 90, scale: 'lin', unit: '°' },
  { key: 'orbitDir', label: '回り方', type: 'select', options: ['prograde', 'retrograde'], labels: { prograde: '順行', retrograde: '逆行' } }
];

export const MASTER_DEFAULTS = {
  gain: 0.8,
  reverb: { length: 3.0, decay: 2.5 },
  delay: { time: 420, feedback: 0.35 },
  pulse: true,  // 音に合わせて星を動かすか
  sky: 'noise', // 背景の星の種類
  follow: false // 選んだ星を画面の中心に置くか
};

export const MASTER_PARAMS = [
  { path: 'gain', label: 'マスター音量', min: 0, max: 1, scale: 'lin' },
  { path: 'reverb.length', label: 'リバーブ長さ', min: 0.5, max: 8, scale: 'lin', unit: 's', deferred: true },
  { path: 'reverb.decay', label: 'リバーブ減衰', min: 1, max: 6, scale: 'lin', deferred: true },
  { path: 'delay.time', label: 'ディレイ時間', min: 50, max: 2000, scale: 'log', unit: 'ms' },
  { path: 'delay.feedback', label: 'フィードバック', min: 0, max: 0.85, scale: 'lin' },
  { path: 'pulse', label: '音に合わせて星を動かす', type: 'select', options: [true, false], labels: { true: 'ON', false: 'OFF' } },
  { path: 'sky', label: '背景の星', type: 'select', options: SKY_STYLES, labels: SKY_LABELS, visual: true },
  { path: 'follow', label: '選んだ星を中心に置く', type: 'select', options: [true, false], labels: { true: 'ON', false: 'OFF' }, visual: true }
];

export const LOOK_PARAM = { key: 'look', label: '見た目', type: 'select', options: LOOK_IDS, labels: LOOK_LABELS };

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
    orbit: false,
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
  if (!raw || (raw.version !== 1 && raw.version !== 2)) return patch;
  patch.master = {
    gain: num(raw.master && raw.master.gain, MASTER_DEFAULTS.gain),
    reverb: {
      length: num(raw.master && raw.master.reverb && raw.master.reverb.length, MASTER_DEFAULTS.reverb.length),
      decay: num(raw.master && raw.master.reverb && raw.master.reverb.decay, MASTER_DEFAULTS.reverb.decay)
    },
    delay: {
      time: num(raw.master && raw.master.delay && raw.master.delay.time, MASTER_DEFAULTS.delay.time),
      feedback: Math.min(0.85, num(raw.master && raw.master.delay && raw.master.delay.feedback, MASTER_DEFAULTS.delay.feedback))
    },
    pulse: raw.master && raw.master.pulse != null ? !!raw.master.pulse : true,
    sky: raw.master && SKY_STYLES.includes(raw.master.sky) ? raw.master.sky : 'noise',
    follow: !!(raw.master && raw.master.follow)
  };
  const voices = Array.isArray(raw.voices) ? raw.voices.slice(0, 8) : [];
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

export const MAX_VOICES = 8;

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

export function findVoice(id) {
  return state.patch.voices.find((v) => v.id === id) || null;
}
