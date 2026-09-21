import { MASTER_GROUPS, getPath, setPath } from '../state.js';

export function renderMaster(el, app, ui) {
  const head = document.createElement('div');
  head.className = 'panel-head';
  const name = document.createElement('span');
  name.className = 'panel-name';
  name.style.setProperty('--c', '#9aa4b2');
  name.textContent = 'MASTER';
  head.appendChild(name);
  const hint = document.createElement('span');
  hint.className = 'panel-hint';
  hint.textContent = '全体の音';
  head.appendChild(hint);
  el.appendChild(head);

  // 機能ごとに切る。音の設定と見た目の設定を同じ列に並べない。
  MASTER_GROUPS.forEach((g) => {
    const sec = ui.section(g.title);
    if (g.title === 'キー') sec.appendChild(readout(() => 'いま ' + app.soundingKey()));
    // 同期しているとタイムのノブは寝るので、実際の間隔をここに出す。
    if (g.title === 'ディレイ') sec.appendChild(readout(() => 'いま ' + app.soundingDelay() + 'ms'));
    // 他の行を寝かせる選択行があるかどうか。あれば押したあとに並びを引き直す。
    const gated = g.params.some((p) => p.when);
    g.params.forEach((p) => {
      const value = getPath(app.master(), p.path);
      sec.appendChild(
        ui.buildControl(
          p,
          value,
          (val) => {
            setPath(app.master(), p.path, val);
            if (p.visual) return app.refreshField(); // 音ではなく見た目の設定
            // IR の再生成は音が途切れる。ドラッグ中は触らない。
            if (!p.deferred) app.applyMaster();
          },
          (val) => {
            setPath(app.master(), p.path, val);
            if (p.visual) app.refreshField();
            else app.applyMaster(p.deferred);
            app.commit();
            if (gated && p.type === 'select') app.refreshPanel();
          },
          { disabled: p.when ? !p.when(app.master()) : false }
        )
      );
    });
    el.appendChild(sec);
  });
}

// ノブの値と鳴っているものがずれる欄には、鳴っているほうを1行出す。
// 転調はルートをずらし、軌道への同期はディレイのタイムを乗っ取る。
// ずれたまま出口が無いと、その欄が嘘をつく。
function readout(text) {
  const row = document.createElement('div');
  row.className = 'readout';
  const paint = () => { row.textContent = text(); };
  paint();
  const t = setInterval(() => {
    if (!row.isConnected) return clearInterval(t);
    paint();
  }, 1000);
  return row;
}
