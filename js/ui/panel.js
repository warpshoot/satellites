import { ENV_PARAMS, MOTION_PARAMS, MIX_PARAMS, COMMON_DEFAULTS } from '../audio/voices/base.js';
import { ORBIT_PARAMS, LOOK_PARAM } from '../state.js';
import { VOICE_TYPES } from '../audio/voices/registry.js';
import { lookOf, LOOK_IDS } from './looks.js';
import { quantize, noteName } from '../audio/music.js';

const TYPE_PARAM = {
  key: 'type',
  label: '種類',
  type: 'select',
  options: VOICE_TYPES.map((V) => V.type),
  labels: VOICE_TYPES.reduce((m, V) => { m[V.type] = V.label; return m; }, {})
};

const VOL_PARAM = { key: 'vol', label: '音量', min: 0, max: 1, scale: 'lin', def: 0.85 };
const ORBIT_SWITCH = { key: 'orbit', label: '周回', type: 'select', options: ['OFF', 'ON'] };

import { renderMaster } from './master.js';
import { renderPatch } from './patch.js';

// 0 から始まるノブは log を通せない（log 0 が無い）。かといって lin だと、
// スライダの左半分がほぼ死ぬ。デチューン 2cent と 5cent はうなりの速さが
// 倍以上違うのに、0〜50 の lin では 1.5mm しか離れていない。
// べき乗カーブは 0 を出せて、下を細かく、上をざっくり刻む。
const GAMMA = 2;

function gammaOf(p) {
  return p.gamma || GAMMA;
}

export function toNorm(p, value) {
  if (p.scale === 'log') {
    return (Math.log(value) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min));
  }
  const n = (value - p.min) / (p.max - p.min);
  if (p.scale === 'pow') return Math.pow(Math.max(0, n), 1 / gammaOf(p));
  return n;
}

export function fromNorm(p, n) {
  let v;
  if (p.scale === 'log') {
    v = Math.exp(Math.log(p.min) + n * (Math.log(p.max) - Math.log(p.min)));
  } else if (p.scale === 'pow') {
    v = p.min + Math.pow(n, gammaOf(p)) * (p.max - p.min);
  } else {
    v = p.min + n * (p.max - p.min);
  }
  if (p.scale === 'int') v = Math.round(v);
  return v;
}

// ランダム用。刻み方に沿って振る。log のノブを lin で振ると毎回上限付近に寄って、
// 何度振っても同じ音しか出てこない。
export function randomFor(p) {
  if (p.type === 'select') return p.options[Math.floor(Math.random() * p.options.length)];
  return fromNorm(p, Math.random());
}

export function fmt(p, v) {
  const abs = Math.abs(v);
  const s = p.scale === 'int' || abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s + (p.unit ? ' ' + p.unit : '');
}

let ctrlSeq = 0;

// 形の選択だけは、記号（A〜F）ではなく形そのものを並べる。
// 押すまで何が起きるか分からない札に、意味のない名前を付けない。
function lookSwatch(id) {
  const mark = document.createElement('span');
  const look = lookOf(id);
  mark.className = 'star-mark';
  for (const l of LOOK_IDS) mark.classList.toggle('look-' + l, look.id === l);
  mark.style.setProperty('--c', look.c);
  return mark;
}

// スライダ1本。onInput は常時、onCommit は指を離したときだけ。
// opts.disabled で触れなくする（並びからは消さない）。
export function buildControl(p, value, onInput, onCommit, opts) {
  const o = opts || {};
  const def = o.def != null ? o.def : p.def;
  const row = document.createElement('div');
  row.className = 'ctrl' + (o.disabled ? ' disabled' : '');
  const head = document.createElement('div');
  head.className = 'ctrl-head';
  const name = document.createElement('label');
  name.textContent = p.label;
  const val = document.createElement('span');
  val.className = 'ctrl-val';
  head.appendChild(name);
  head.appendChild(val);
  row.appendChild(head);

  // 値の右に添える短い文字。いまのところ音名だけが使う。
  const show = (v) => fmt(p, v) + (o.suffix ? ' ' + o.suffix(v) : '');

  if (p.type === 'select') {
    val.textContent = '';
    const group = document.createElement('div');
    group.className = 'seg' + (p.look ? ' seg-look' : '');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', p.label);
    p.options.forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (p.look) {
        b.appendChild(lookSwatch(opt));
        b.setAttribute('aria-label', String(p.labels ? p.labels[opt] : opt));
      } else {
        b.textContent = p.labels ? p.labels[opt] : opt;
      }
      b.className = opt === value ? 'on' : '';
      b.disabled = !!o.disabled;
      b.setAttribute('aria-pressed', String(opt === value));
      b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((x) => {
          x.classList.remove('on');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('on');
        b.setAttribute('aria-pressed', 'true');
        onInput(opt);
        if (onCommit) onCommit(opt);
      });
      group.appendChild(b);
    });
    row.appendChild(group);
    return row;
  }

  const input = document.createElement('input');
  input.type = 'range';
  input.id = 'ctrl-' + (++ctrlSeq);
  name.setAttribute('for', input.id);
  input.min = 0;
  input.max = 1000;
  input.step = 1;
  input.disabled = !!o.disabled;
  input.value = Math.round(Math.min(1, Math.max(0, toNorm(p, value))) * 1000);
  val.textContent = show(value);
  input.setAttribute('aria-valuetext', val.textContent);
  input.addEventListener('input', () => {
    const v = fromNorm(p, input.value / 1000);
    val.textContent = show(v);
    input.setAttribute('aria-valuetext', val.textContent);
    onInput(v);
  });
  const commit = () => {
    if (onCommit) onCommit(fromNorm(p, input.value / 1000));
  };
  input.addEventListener('change', commit);

  // ダブルタップで既定値に戻す。一度動かしたノブを戻せないと、
  // 試しに動かすこと自体が怖くなる。
  if (def != null) {
    input.title = 'ダブルタップで既定値';
    let last = 0;
    input.addEventListener('pointerdown', () => {
      const t = performance.now();
      if (t - last < 320) {
        last = 0;
        // pointerdown の直後に届く input（押した位置の値）を上書きする
        setTimeout(() => {
          input.value = Math.round(Math.min(1, Math.max(0, toNorm(p, def))) * 1000);
          val.textContent = show(def);
          input.setAttribute('aria-valuetext', val.textContent);
          onInput(def);
          if (onCommit) onCommit(def);
        }, 0);
      } else {
        last = t;
      }
    });
  }
  row.appendChild(input);
  return row;
}

function section(title) {
  const s = document.createElement('div');
  s.className = 'section';
  const h = document.createElement('div');
  h.className = 'section-title';
  h.textContent = title;
  s.appendChild(h);
  return s;
}

// 画面の切り替えは常設のタブが持つ。点への操作とは並べない。
// 3枚はスコープの順。1点の音 → 全体の音 → 丸ごと入れ替える。
// 音色だけは状態を持たない（星を選んでいるかどうかで決まる）。
function buildTabs(app, onVoice) {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const tab = (label, on, disabled, onClick) => {
    const b = document.createElement('button');
    b.className = 'tab' + (on ? ' on' : '');
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    tabs.appendChild(b);
  };
  tab('音色', onVoice, !onVoice && !app.hasVoices(), () => app.focusVoice());
  tab('マスター', !onVoice && app.tab() === 'master', false, () => app.showTab('master'));
  tab('パッチ', !onVoice && app.tab() === 'patch', false, () => app.showTab('patch'));
  return tabs;
}

export function createPanel(el, app) {
  function render() {
    el.innerHTML = '';
    const v = app.selected();
    el.appendChild(buildTabs(app, !!v));
    if (!v) {
      const ui = { section, buildControl };
      if (app.tab() === 'patch') renderPatch(el, app, ui);
      else renderMaster(el, app, ui);
      return;
    }
    const V = app.typeOf(v);

    // ヘッダはこの点への操作だけ。画面の切り替えはタブが持つ。
    const head = document.createElement('div');
    head.className = 'panel-head';
    const name = document.createElement('span');
    name.className = 'panel-name';
    name.textContent = V.label;
    name.style.setProperty('--c', V.color);
    head.appendChild(name);

    const solo = document.createElement('button');
    solo.className = 'chip' + (app.isSoloed(v.id) ? ' solo' : '');
    solo.textContent = 'ソロ';
    solo.addEventListener('click', () => app.toggleSolo(v.id));
    head.appendChild(solo);

    const mute = document.createElement('button');
    mute.className = 'chip' + (app.isMuted(v.id) ? ' mute' : '');
    mute.textContent = 'ミュート';
    mute.addEventListener('click', () => app.toggleMute(v.id));
    head.appendChild(mute);

    // 音作りの当てが無くても手が動くように。刻み方に沿って振る。
    const dice = document.createElement('button');
    dice.className = 'chip';
    dice.textContent = 'ランダム';
    dice.addEventListener('click', () => app.randomize(v.id));
    head.appendChild(dice);

    const dup = document.createElement('button');
    dup.className = 'chip';
    dup.textContent = '複製';
    dup.addEventListener('click', () => app.duplicate(v.id));
    head.appendChild(dup);

    const del = document.createElement('button');
    del.className = 'chip danger';
    del.textContent = '削除';
    del.addEventListener('click', () => app.requestDelete(v.id));
    head.appendChild(del);
    el.appendChild(head);

    // 並びは信号の流れ。音源 → 音色 → エンベロープ → 動き → ミックス。
    // 一番よく触る種別固有のパラメータを最下段に置かない。
    const src = section('音源');
    src.appendChild(buildControl(TYPE_PARAM, v.type, (val) => app.setType(v.id, val)));
    src.appendChild(buildControl(LOOK_PARAM, v.look, (val) => app.setLook(v.id, val)));
    el.appendChild(src);

    const own = section(V.label);
    // 条件付きのパラメータは、周回の行と同じ扱い。消さずに disabled にする。
    // 消すと押すたびにパネルの高さが跳ねて、何が隠れたかも分からない。
    const gated = V.params.some((p) => p.when);
    V.params.forEach((p) => {
      const opts = { def: V.defaults[p.key], disabled: p.when ? !p.when(v) : false };
      // 音程のノブには、実際に鳴る音名を添える。吸着があるので、
      // ノブの Hz と鳴っている音は一致しない。
      if (p.note) opts.suffix = (val) => noteName(quantize(val, app.master().tuning));
      own.appendChild(
        buildControl(p, v.params[p.key], (val) => app.setParam(v.id, p.key, val), () => {
          app.commit();
          // 他の行の有効・無効を切り替えるノブは、押したら並びを引き直す
          if (gated && p.type === 'select') app.refreshPanel();
        }, opts)
      );
    });
    el.appendChild(own);

    const commonCtrl = (sec, p) => sec.appendChild(
      buildControl(p, v.common[p.key], (val) => app.setParam(v.id, p.key, val), () => app.commit(),
        { def: COMMON_DEFAULTS[p.key] })
    );

    const env = section('エンベロープ');
    ENV_PARAMS.forEach((p) => commonCtrl(env, p));
    el.appendChild(env);

    const motion = section('動き');
    MOTION_PARAMS.forEach((p) => commonCtrl(motion, p));
    // 周回するかしないか。他のパラメータと同じ顔をした選択行にしてある。
    motion.appendChild(
      buildControl(ORBIT_SWITCH, v.orbit ? 'ON' : 'OFF', (val) => {
        if ((val === 'ON') !== !!v.orbit) app.toggleOrbit(v.id);
      })
    );
    // 周回 OFF でも軌道の行は残す。消すと押すたびに高さが跳ねる。
    ORBIT_PARAMS.forEach((p) => {
      const value = p.key === 'orbitRadius' ? app.orbitRadiusOf(v) : v[p.key];
      motion.appendChild(
        buildControl(p, value, (val) => app.setOrbitParam(v.id, p.key, val), () => app.commit(),
          { def: p.def, disabled: !v.orbit })
      );
    });
    el.appendChild(motion);

    const mix = section('ミックス');
    mix.appendChild(
      buildControl(VOL_PARAM, v.vol, (val) => app.setVolume(v.id, val), () => app.commit(),
        { def: VOL_PARAM.def })
    );
    MIX_PARAMS.forEach((p) => commonCtrl(mix, p));
    el.appendChild(mix);
  }

  return { render };
}
