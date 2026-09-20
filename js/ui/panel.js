import { COMMON_PARAMS } from '../audio/voices/base.js';
import { ORBIT_PARAMS, LOOK_PARAM } from '../state.js';
import { VOICE_TYPES } from '../audio/voices/registry.js';

const TYPE_PARAM = {
  key: 'type',
  label: '音源',
  type: 'select',
  options: VOICE_TYPES.map((V) => V.type),
  labels: VOICE_TYPES.reduce((m, V) => { m[V.type] = V.label; return m; }, {})
};
import { renderMaster } from './master.js';

export function toNorm(p, value) {
  if (p.scale === 'log') {
    return (Math.log(value) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min));
  }
  return (value - p.min) / (p.max - p.min);
}

export function fromNorm(p, n) {
  let v;
  if (p.scale === 'log') {
    v = Math.exp(Math.log(p.min) + n * (Math.log(p.max) - Math.log(p.min)));
  } else {
    v = p.min + n * (p.max - p.min);
  }
  if (p.scale === 'int') v = Math.round(v);
  return v;
}

export function fmt(p, v) {
  const abs = Math.abs(v);
  const s = p.scale === 'int' || abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s + (p.unit ? ' ' + p.unit : '');
}

// スライダ1本。onInput は常時、onCommit は指を離したときだけ。
export function buildControl(p, value, onInput, onCommit) {
  const row = document.createElement('div');
  row.className = 'ctrl';
  const head = document.createElement('div');
  head.className = 'ctrl-head';
  const name = document.createElement('span');
  name.textContent = p.label;
  const val = document.createElement('span');
  val.className = 'ctrl-val';
  head.appendChild(name);
  head.appendChild(val);
  row.appendChild(head);

  if (p.type === 'select') {
    val.textContent = '';
    const group = document.createElement('div');
    group.className = 'seg';
    p.options.forEach((opt) => {
      const b = document.createElement('button');
      b.textContent = p.labels ? p.labels[opt] : opt;
      b.className = opt === value ? 'on' : '';
      b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
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
  input.min = 0;
  input.max = 1000;
  input.step = 1;
  input.value = Math.round(Math.min(1, Math.max(0, toNorm(p, value))) * 1000);
  val.textContent = fmt(p, value);
  input.addEventListener('input', () => {
    const v = fromNorm(p, input.value / 1000);
    val.textContent = fmt(p, v);
    onInput(v);
  });
  const commit = () => {
    if (onCommit) onCommit(fromNorm(p, input.value / 1000));
  };
  input.addEventListener('change', commit);
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

// 音色とマスターの切り替えは常設のタブが持つ。点への操作とは並べない。
function buildTabs(app, onVoice) {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const voiceTab = document.createElement('button');
  voiceTab.className = 'tab' + (onVoice ? ' on' : '');
  voiceTab.textContent = '音色';
  voiceTab.disabled = !onVoice && !app.hasVoices();
  voiceTab.addEventListener('click', () => app.focusVoice());
  const masterTab = document.createElement('button');
  masterTab.className = 'tab' + (onVoice ? '' : ' on');
  masterTab.textContent = 'マスター';
  masterTab.addEventListener('click', () => app.select(null));
  tabs.appendChild(voiceTab);
  tabs.appendChild(masterTab);
  return tabs;
}

export function createPanel(el, app) {
  function render() {
    el.innerHTML = '';
    const v = app.selected();
    el.appendChild(buildTabs(app, !!v));
    if (!v) {
      renderMaster(el, app, { section, buildControl });
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

    const common = section('共通');

    common.appendChild(
      buildControl(TYPE_PARAM, v.type, (val) => app.setType(v.id, val))
    );
    common.appendChild(
      buildControl(LOOK_PARAM, v.look, (val) => app.setLook(v.id, val))
    );
    common.appendChild(
      buildControl(
        { key: 'vol', label: '音量', min: 0, max: 1, scale: 'lin' },
        v.vol,
        (val) => app.setVolume(v.id, val),
        () => app.commit()
      )
    );

    // 周回するかしないか。他のパラメータと同じ顔をした選択行にしてある。
    common.appendChild(
      buildControl(
        { key: 'orbit', label: '周回', type: 'select', options: ['OFF', 'ON'] },
        v.orbit ? 'ON' : 'OFF',
        (val) => {
          if ((val === 'ON') !== !!v.orbit) app.toggleOrbit(v.id);
        }
      )
    );
    if (v.orbit) {
      ORBIT_PARAMS.forEach((p) => {
        const value = p.key === 'orbitRadius' ? app.orbitRadiusOf(v) : v[p.key];
        common.appendChild(
          buildControl(p, value, (val) => app.setOrbitParam(v.id, p.key, val), () => app.commit())
        );
      });
    }
    COMMON_PARAMS.forEach((p) => {
      common.appendChild(
        buildControl(p, v.common[p.key], (val) => app.setParam(v.id, p.key, val), () => app.commit())
      );
    });
    el.appendChild(common);

    const own = section(V.label);
    V.params.forEach((p) => {
      own.appendChild(
        buildControl(p, v.params[p.key], (val) => app.setParam(v.id, p.key, val), () => app.commit())
      );
    });
    el.appendChild(own);
  }

  return { render };
}
