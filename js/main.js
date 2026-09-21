import { engine } from './audio/engine.js';
import { createVoice, voiceClass, VOICE_TYPES } from './audio/voices/registry.js';
import { state, loadPatch, save, newVoiceData, findVoice, MAX_VOICES,
  setPatch, backupCurrent, hasBackup, takeBackup, MASTER_PARAMS, setPath } from './state.js';
import { patchLink, patchText, parseIncoming, copyText,
  savePatchFile, readPatchFile } from './patchio.js';
import { PRESETS } from './presets.js';
import { COMMON_PARAMS } from './audio/voices/base.js';
import { ROOTS, SCALE_IDS } from './audio/music.js';
import { createField } from './ui/field.js';
import { createPanel, randomFor } from './ui/panel.js';
import { createStrip } from './ui/strip.js';

const fieldEl = document.getElementById('field');
const panelEl = document.getElementById('panel');
const starsEl = document.getElementById('stars');
const gateEl = document.getElementById('gate');
const noticeEl = document.getElementById('notice');
const transportEl = document.getElementById('transport');

const live = new Map();   // id -> Voice
const muted = new Set();  // 保存しない。次に開いて無音だと壊れたように見える。
// ソロは同時に1つだけ。どれを鳴らすかは別に覚えず、選んでいる星から引く。
// 別の場所に「ソロ中の星」を持つと、選択と二重管理になって必ずずれる。
let soloOn = false;
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
  return { x: p.x, y: p.y, z: p.z, rho: g.rho, theta };
}

// 位相そのものを音の時計として渡す。ボイス側はこれを 100ms ぶん外挿して、
// 刻み目を踏む時刻を先に予約する。周回していなければ null。
export function orbitClock(v, t) {
  if (!v.orbit) return null;
  const period = Math.max(1, v.orbitPeriod || 60);
  const dir = v.orbitDir === 'retrograde' ? -1 : 1;
  return { theta: orbitState(v, t).theta, t, omega: (dir * TAU) / period };
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


// ディレイ時間を周回と噛み合わせる。一番速い星の1周を、聞こえる長さに入るまで
// 半分に割っていく。周回と同じ拍で反射が返るので、動きと反射が喧嘩しない。
// 周回している星が無ければノブの値のまま。
const DELAY_SYNC_MAX = 1.2; // 秒。これより長いと反射が拍として聞こえない

function orbitDelayMs(master) {
  let fastest = Infinity;
  for (const v of state.patch.voices) {
    if (!v.orbit) continue;
    const p = Math.max(1, v.orbitPeriod || 60);
    if (p < fastest) fastest = p;
  }
  if (!isFinite(fastest)) return master.delay.time;
  let t = fastest;
  let guard = 0;
  while (t > DELAY_SYNC_MAX && guard++ < 24) t /= 2;
  return Math.min(2000, Math.max(50, t * 1000));
}

function delayMs(master) {
  return master.delay.sync ? orbitDelayMs(master) : master.delay.time;
}

// 全体のサイコロで引く音階。「なし」と「半音」は吸着しないのと同じで、
// 引いた瞬間に調の話が消える。出口として置いてあるものを出口から外す。
const DICE_SCALES = SCALE_IDS.filter((id) => id !== 'off' && id !== 'chromatic');

// 全体のサイコロが触るマスターのノブ。音量・見た目・軌道同期は含めない。
const DICE_MASTER = [
  'tuning.drift', 'reverb.length', 'reverb.decay',
  'delay.time', 'delay.feedback', 'delay.tone', 'delay.wow'
];

// マスターのノブを振る。音のサイコロと配置ごとのサイコロで同じものを使う。
function rollMaster() {
  const m = state.patch.master;
  m.tuning.root = ROOTS[Math.floor(Math.random() * ROOTS.length)];
  m.tuning.scale = DICE_SCALES[Math.floor(Math.random() * DICE_SCALES.length)];
  for (const p of MASTER_PARAMS) {
    if (!DICE_MASTER.includes(p.path)) continue;
    setPath(m, p.path, randomFor(p));
  }
  // 飽和だけは一様に振らない。上半分はどの配置でも同じ顔になる。
  m.burn = Math.pow(Math.random(), 2) * 0.7;
}

// 種別は引き直すたびに山を切り直す。毎回 6 種から独立に引くと、
// 5 点でも半分が同じ種別になることがよくあり、何が作れる道具なのか見えない。
function typeDeck() {
  const deck = VOICE_TYPES.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 星を1つ、でたらめな軌道に作る。置き場所ではなく軌道要素のほうを引く。
// 半径は 0.5 までにしておく。それ以上は逆二乗でほとんど聞こえなくなる。
function rollNewVoice(V) {
  const data = newVoiceData(V.type, CENTER.x, CENTER.y);
  data.orbitRadius = 0.06 + Math.random() * 0.44;
  data.orbitPhase = Math.random() * TAU;
  data.orbitPeriod = Math.round(15 * Math.pow(16, Math.random())); // 15〜240 秒を log で
  data.orbitEcc = Math.pow(Math.random(), 2) * 0.9; // 0 から始まるノブは pow で振る
  data.orbitAngle = Math.random() * 360;
  data.orbitIncl = Math.random() * 90;
  data.orbitDir = Math.random() < 0.25 ? 'retrograde' : 'prograde';
  rollVoice(data);
  // 何本かは止めておく。全部が回っていると、動きの速さの差が読めない。
  if (Math.random() < 0.25) {
    const p = orbitState(data, engine.now());
    data.x = clamp01(CENTER.x + p.x);
    data.y = clamp01(CENTER.y + p.y);
    data.orbit = false;
  }
  return data;
}

// 1つの星の音だけを振る。アタックとリリースは振らない
// （20 秒のアタックを引くと「押したのに何も起きない」になる）。
function rollVoice(v) {
  const V = voiceClass(v.type);
  const voice = live.get(v.id);
  for (const p of V.params) {
    v.params[p.key] = randomFor(p);
    if (voice) voice.setParam(p.key, v.params[p.key]);
  }
  for (const p of COMMON_PARAMS) {
    if (p.key !== 'drift' && p.key !== 'tone' && p.key !== 'reverbSend' && p.key !== 'delaySend') continue;
    v.common[p.key] = randomFor(p);
    if (voice) voice.setParam(p.key, v.common[p.key]);
  }
}

// いま鳴っているルート。転調で動くので、名前だけは画面に出しておく。
function soundingKey() {
  const t = engine.tuning || state.patch.master.tuning;
  const off = t.offset || 0;
  const i = ROOTS.indexOf(t.root);
  const name = ROOTS[(((i < 0 ? 0 : i) + off) % 12 + 12) % 12];
  return off ? name + '（' + (off > 0 ? '+' : '') + off + '）' : name;
}

const app = {
  soundingKey,
  // 同期していると、ディレイのタイムはノブではなく一番速い周回が決める。
  soundingDelay: () => Math.round(delayMs(state.patch.master)),
  voices: () => state.patch.voices,
  master: () => state.patch.master,
  find: (id) => findVoice(id),
  typeOf: (v) => voiceClass(v.type),
  selectedId: () => state.selectedId,
  selected: () => (state.selectedId ? findVoice(state.selectedId) : null),
  canAdd: () => state.patch.voices.length < MAX_VOICES,

  resolved(v) {
    return resolve(v, engine.now());
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
  isSoloed: (id) => soloTargetId() === id,
  soloActive: () => soloTargetId() != null,

  // ソロ中に鳴るのは1つだけ。鳴るのは選んでいる星。
  audible(id) {
    if (muted.has(id)) return false;
    const solo = soloTargetId();
    return solo == null || solo === id;
  },

  toggleMute(id) {
    if (muted.has(id)) muted.delete(id);
    else muted.add(id);
    applyAudible();
  },

  // ソロの入口はいつも選んでいる星のパネルなので、id は選択と一致する。
  toggleSolo(id) {
    soloOn = !(soloOn && soloTargetId() === id);
    applyAudible();
  },

  clearSolo() {
    soloOn = false;
    applyAudible();
  },


  select(id) {
    state.selectedId = id;
    if (id) lastVoiceId = id;
    // ソロは選んだ星に付いて回る。applyAudible が描き直しまでやる。
    if (soloOn) applyAudible();
    else redraw();
  },

  // タブから音色パネルに戻るとき、直前に見ていた点を開く
  focusVoice() {
    const v = findVoice(lastVoiceId) || state.patch.voices[0];
    if (v) this.select(v.id);
  },

  add(type, x, y) {
    if (!this.canAdd()) return this.notice('星は' + MAX_VOICES + '個まで');
    const data = newVoiceData(type, clamp01(x), clamp01(y));
    // 置いた場所から半径と位相を割り出す。位相は時刻を引いておかないと、
    // 置いた瞬間に軌道上の別の場所へ飛ぶ。
    if (data.orbit) {
      const g = orbitFromPoint(data, data.x, data.y, engine.now());
      data.orbitRadius = g.rho;
      data.orbitPhase = g.phase;
    }
    state.patch.voices.push(data);
    if (started) spawn(data);
    state.selectedId = lastVoiceId = data.id;
    this.syncDelay();
    if (soloOn) applyAudible(); // 置いたばかりの星がソロの対象になる
    else redraw();
    save();
  },

  duplicate(id) {
    const src = findVoice(id);
    if (!src) return;
    if (!this.canAdd()) return this.notice('星は' + MAX_VOICES + '個まで');
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
    if (soloOn) applyAudible();
    else redraw();
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
    if (state.selectedId === id) state.selectedId = null;
    if (lastVoiceId === id) lastVoiceId = null;
    // 消したのがソロ中の星で、引き継ぐ先も無いならソロ自体を降ろす。
    // 残したままだと、どれも鳴らないのにソロの札だけ出ていることになる。
    if (soloOn && !findVoice(state.selectedId || lastVoiceId)) soloOn = false;
    this.syncDelay();
    applyAudible();
    save();
  },

  // 周回中は指の位置から半径と位相を書き換える。止まっていれば座標をそのまま動かす。
  moveTo(id, x, y) {
    const v = findVoice(id);
    if (!v) return;
    if (v.orbit) {
      const g = orbitFromPoint(v, x, y, engine.now());
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
    if (key === 'orbitPeriod') this.syncDelay();
    field.layout();
  },

  // 周回の顔ぶれが変わったらディレイを引き直す（合わせる設定のときだけ動く）
  syncDelay() {
    if (!engine.ready || !state.patch.master.delay.sync) return;
    engine.setDelayTime(orbitDelayMs(state.patch.master));
  },

  toggleOrbit(id) {
    const v = findVoice(id);
    if (!v) return;
    const t = engine.now();
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
    this.syncDelay();
    redraw();
    save();
  },

  // ---- プリセット ----------------------------------------------------
  presets: () => PRESETS.map((x) => x.name),

  loadPreset(i) {
    const preset = PRESETS[i];
    if (!preset) return;
    backupCurrent(); // 読む前に退避。押し間違えても帰ってこられる。
    setPatch(JSON.parse(JSON.stringify(preset.patch)));
    save();
    swapVoices();
    this.notice(preset.name + ' を読み込んだ');
  },

  // 音作りの当てが無いときの出口。置いた場所と周回は触らない。
  // 動かすのはその星の音そのものだけ。
  randomize(id) {
    const v = findVoice(id);
    if (!v) return;
    rollVoice(v);
    redraw();
    save();
  },

  // 音作りの当てがまったく無いときの出口。星ごとのサイコロと同じで、
  // 置いた場所と周回には触らない。マスターは音楽に効くところだけ振る。
  // 見た目（背景・追尾・パルス）と音量は、聴き方の設定なので動かさない。
  randomizeAll() {
    backupCurrent(); // 1回だけ戻れるようにしてから振る
    rollMaster();
    for (const v of state.patch.voices) rollVoice(v);
    this.applyMaster(true);
    redraw();
    save();
    this.notice('音をランダムにした');
  },

  // 何から作ればいいのか分からないときの出口。音のサイコロと違って、
  // 星の数・種類・軌道まで引き直す。いま置いてあるものは残らない。
  scatterAll() {
    backupCurrent();
    rollMaster();
    const n = 3 + Math.floor(Math.random() * 5); // 3〜7。埋めきると分解して読めない
    const deck = typeDeck();
    const voices = [];
    for (let i = 0; i < n; i++) voices.push(rollNewVoice(deck[i % deck.length]));
    state.patch.voices = voices;
    state.selectedId = null;
    save();
    swapVoices(); // 鳴っている音は release で消して、新しい配置を散らして立ち上げる
    this.notice('配置ごとランダムにした');
  },

  // 盤面を空にする。マスターは聴き方の設定なので残す。
  // 退避を取ってあるので、押し間違えても「元に戻す」で帰ってこられる。
  clearAll() {
    if (!state.patch.voices.length) return this.notice('もう空');
    backupCurrent();
    state.patch.voices = [];
    state.selectedId = null;
    save();
    swapVoices();
    this.notice('空にした');
  },

  // ---- 持ち出しと持ち込み -------------------------------------------
  hasBackup: () => hasBackup(),

  async copyPatch() {
    const text = patchText(state.patch);
    const ok = await copyText(text);
    this.notice(ok ? 'コピーした' : 'コピーできない');
    return ok ? null : text; // 失敗したら呼んだ側が手で選ばせる
  },

  async copyLink() {
    try {
      const url = await patchLink(state.patch);
      const ok = await copyText(url);
      this.notice(ok ? 'リンクをコピーした' : 'コピーできない');
      return ok ? null : url;
    } catch (e) {
      this.notice('リンクを作れない');
      return null;
    }
  },

  // 貼り付けられた文字列を読む。リンクでも JSON でも受ける。
  async loadText(text) {
    let raw;
    try {
      raw = await parseIncoming(text);
    } catch (e) {
      this.notice('読めない');
      return false;
    }
    backupCurrent();
    setPatch(raw);
    swapVoices();
    save();
    this.notice('読み込んだ');
    return true;
  },

  saveFile() {
    try {
      const name = savePatchFile(state.patch);
      this.notice(name + ' を書き出した');
    } catch (e) {
      this.notice('書き出せない');
    }
  },

  async loadFile(file) {
    let raw;
    try {
      raw = await readPatchFile(file);
    } catch (e) {
      this.notice('ファイルを読めない');
      return false;
    }
    backupCurrent();
    setPatch(raw);
    swapVoices();
    save();
    this.notice((file.name || 'ファイル') + ' を読み込んだ');
    return true;
  },

  restoreBackup() {
    const raw = takeBackup();
    if (!raw) return this.notice('戻す先がない');
    setPatch(raw);
    swapVoices();
    save();
    this.notice('元に戻した');
  },

  sky: () => state.patch.master.sky,
  cameraFollow: () => state.patch.master.follow,

  applyMaster(withIR) {
    if (!engine.ready) return;
    const m = state.patch.master;
    if (!paused) engine.setMasterGain(m.gain); // 停止中に音量を触っても鳴り出さない
    engine.setBurn(m.burn);
    engine.setDelayTime(delayMs(m));
    engine.setDelayFeedback(m.delay.feedback);
    engine.setDelayTone(m.delay.tone);
    engine.setDelayWow(m.delay.wow);
    engine.setTuning(m.tuning);
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

// ソロ中に鳴らす星。選んでいる星、選択を外していれば最後に見ていた星。
// 指しているものが消えていたらソロは掛かっていない扱いにする。
function soloTargetId() {
  if (!soloOn) return null;
  const id = state.selectedId || lastVoiceId;
  return findVoice(id) ? id : null;
}

function applyAudible() {
  for (const v of state.patch.voices) {
    const voice = live.get(v.id);
    if (voice) voice.setMuted(!app.audible(v.id));
  }
  redraw();
}

// パッチを丸ごと入れ替える。鳴っている音は release で消し、新しい配置を立ち上げる。
function swapVoices() {
  for (const voice of live.values()) voice.stop();
  live.clear();
  muted.clear();
  soloOn = false;
  lastVoiceId = null;
  if (started) {
    app.applyMaster(true);
    stagger(0.45); // 一斉に立ち上げると「全部同時に開いた」と聞こえる
  }
  redraw();
  field.layout();
}

// 配置を丸ごと入れ替えたときの立ち上げ。同じ瞬間に揃って開くと、
// 勝手に集まってきたようには聞こえない。アタックが長い点ほど遅れても気づかれない。
// 起動は待たされていないので広く、プリセットは押した直後なので狭く散らす。
function stagger(scale) {
  state.patch.voices.forEach((data, i) => {
    const wait = i === 0 ? 0 : (900 * i + Math.random() * 4000) * scale;
    setTimeout(() => {
      if (!started || paused) return;
      if (live.has(data.id) || !findVoice(data.id)) return;
      spawn(data);
    }, wait);
  });
}

function applyPos(v) {
  const voice = live.get(v.id);
  if (!voice) return;
  const t = engine.now();
  const p = resolve(v, t);
  voice.setVolume(v.vol != null ? v.vol : 0.85);
  voice.setDistance(nearFromDistance(coreDistance(p)));
  voice.setPosition(p.x, p.y);
  voice.setElevation(p.zOff); // 面からの浮き。距離には入っているが、方向としては別口
  voice.setOrbitClock(orbitClock(v, t));
}

function spawn(data) {
  const voice = createVoice(engine, data);
  engine.addVoice(voice);
  live.set(data.id, voice);
  const t = engine.now();
  const p = resolve(data, t);
  voice.setDistance(nearFromDistance(coreDistance(p)));
  voice.setPosition(p.x, p.y);
  voice.setElevation(p.zOff);
  voice.setOrbitClock(orbitClock(data, t));
  voice.setMuted(!app.audible(data.id));
  voice.start();
  return voice;
}

const field = createField(fieldEl, app);
const panel = createPanel(panelEl, app);
const strip = createStrip(starsEl, app);

loadPatch();
// 保存が1つも無い最初の1回だけ、プリセットを1つ引いて置いておく。
// 空の盤面から始めさせると、何が起きる道具なのか分からないまま終わる。
// ここでは保存しない。触った時点で保存されるので、何もせず閉じれば次は別の1つ。
if (state.fresh && PRESETS.length) {
  const pick = PRESETS[Math.floor(Math.random() * PRESETS.length)];
  setPatch(JSON.parse(JSON.stringify(pick.patch)));
}
redraw();

// リンクで開かれたときは、そちらに乗り換える。前の配置は退避しておく。
// 展開は非同期なので、先に保存ぶんを出してから差し替える。
async function loadFromHash() {
  const m = location.hash.match(/^#p=([A-Za-z0-9\-_]+)$/);
  if (!m) return;
  // 読んだらハッシュは落とす。読み込み直すたびに編集が巻き戻るのを避ける。
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const raw = await parseIncoming(m[1]);
    backupCurrent();
    setPatch(raw);
    save();
    swapVoices();
    app.notice('リンクを読み込んだ');
  } catch (e) {
    app.notice('リンクを読めない');
  }
}

loadFromHash();
// 開いたままのタブにリンクを流し込まれた場合、ハッシュだけが変わって再読み込みは起きない
window.addEventListener('hashchange', loadFromHash);

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
    gateText.textContent = '音が止まっている';
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
  stagger(1);
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
