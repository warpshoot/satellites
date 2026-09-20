import { MASTER_PARAMS, getPath, setPath } from '../state.js';

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
  hint.textContent = '盤面の点をタップすると音色';
  head.appendChild(hint);
  el.appendChild(head);

  const sec = ui.section('マスターFX');
  MASTER_PARAMS.forEach((p) => {
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
        }
      )
    );
  });
  el.appendChild(sec);
}
