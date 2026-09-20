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
  el.appendChild(patchSection(app, ui));
}

// パッチの持ち出しと持ち込み。ファイルが主、リンクとクリップボードが従。
function patchSection(app, ui) {
  const sec = ui.section('パッチ');

  // 開いたままの入れ物。貼り付け先にもなるし、コピーに失敗したときの逃げ道にもなる。
  const box = document.createElement('textarea');
  box.className = 'patch-box hidden';
  box.setAttribute('spellcheck', 'false');
  box.placeholder = 'ここにリンクか JSON を貼り付ける';

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.className = 'patch-file';
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (f) app.loadFile(f);
    file.value = ''; // 同じファイルをもう一度選べるようにする
  });

  const showBox = (text, placeholder) => {
    box.classList.remove('hidden');
    if (text != null) box.value = text;
    if (placeholder) box.placeholder = placeholder;
    box.focus();
    if (text) box.select();
  };

  const btn = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.className = 'chip' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  const row = (...kids) => {
    const r = document.createElement('div');
    r.className = 'patch-row';
    kids.forEach((k) => r.appendChild(k));
    return r;
  };

  sec.appendChild(row(
    btn('ファイルに書き出す', '', () => app.saveFile()),
    btn('ファイルから読む', '', () => file.click())
  ));

  sec.appendChild(row(
    btn('リンクをコピー', '', async () => {
      const fallback = await app.copyLink();
      if (fallback) showBox(fallback); // コピーできなければ手で選んでもらう
    }),
    btn('JSON をコピー', '', async () => {
      const fallback = await app.copyPatch();
      if (fallback) showBox(fallback);
    })
  ));

  const loadBtn = btn('貼り付けたものを読む', '', async () => {
    if (box.classList.contains('hidden') || !box.value.trim()) {
      return showBox('', 'ここにリンクか JSON を貼り付ける');
    }
    if (await app.loadText(box.value)) box.value = '';
  });
  const kids = [loadBtn];
  if (app.hasBackup()) {
    kids.push(btn('前の配置に戻す', 'danger', () => app.restoreBackup()));
  }
  sec.appendChild(row.apply(null, kids));

  sec.appendChild(box);
  sec.appendChild(file);
  return sec;
}
