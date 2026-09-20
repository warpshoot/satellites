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
  hint.textContent = '星をタップすると音色';
  head.appendChild(hint);
  el.appendChild(head);

  // 機能ごとに切る。音の設定と見た目の設定を同じ列に並べない。
  MASTER_GROUPS.forEach((g) => {
    const sec = ui.section(g.title);
    if (g.title === 'キー') sec.appendChild(keyReadout(app));
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
          }
        )
      );
    });
    el.appendChild(sec);
  });
  el.appendChild(randomSection(app, ui));
  el.appendChild(presetSection(app, ui));
  el.appendChild(patchSection(app, ui));
}

// 転調があると、選んだルートと鳴っているルートがずれる。ずれたまま
// どこにも出ないと、キーの欄が嘘をついていることになる。
function keyReadout(app) {
  const row = document.createElement('div');
  row.className = 'readout';
  const paint = () => { row.textContent = 'いま ' + app.soundingKey(); };
  paint();
  const t = setInterval(() => {
    if (!row.isConnected) return clearInterval(t);
    paint();
  }, 1000);
  return row;
}

// 音作りの当てがまったく無いときの出口。押す前に退避を取るので、
// 気に入らなければ「元に戻す」で帰ってこられる。
// 星ごとのチップと同じ「ランダム」で通す。同じ機能に2つ名前を付けない。
function randomSection(app, ui) {
  const sec = ui.section('ランダム');
  const row = document.createElement('div');
  row.className = 'patch-row';
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = '全部ランダム';
  b.addEventListener('click', () => app.randomizeAll());
  row.appendChild(b);
  const hint = document.createElement('span');
  hint.className = 'readout';
  hint.textContent = '置いた場所と周回は動かない';
  row.appendChild(hint);
  sec.appendChild(row);
  return sec;
}

// プリセット。上書きの前に必ず退避を取るので、
// 押し間違えても「前の配置に戻す」で帰ってこられる。
function presetSection(app, ui) {
  const sec = ui.section('プリセット');
  const row = document.createElement('div');
  row.className = 'patch-row';
  app.presets().forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = name;
    b.addEventListener('click', () => app.loadPreset(i));
    row.appendChild(b);
  });
  sec.appendChild(row);
  return sec;
}

// パッチの持ち出しと持ち込み。ファイルが主、リンクとクリップボードが従。
function patchSection(app, ui) {
  const sec = ui.section('パッチ');

  // 開いたままの入れ物。貼り付け先にもなるし、コピーに失敗したときの逃げ道にもなる。
  const box = document.createElement('textarea');
  box.className = 'patch-box hidden';
  box.setAttribute('spellcheck', 'false');
  box.placeholder = 'リンクか JSON を貼り付け';

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
    btn('書き出す', '', () => app.saveFile()),
    btn('読み込む', '', () => file.click())
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

  const loadBtn = btn('貼り付けを読む', '', async () => {
    if (box.classList.contains('hidden') || !box.value.trim()) {
      return showBox('', 'リンクか JSON を貼り付け');
    }
    if (await app.loadText(box.value)) box.value = '';
  });
  const kids = [loadBtn];
  if (app.hasBackup()) {
    kids.push(btn('元に戻す', 'danger', () => app.restoreBackup()));
  }
  sec.appendChild(row.apply(null, kids));

  sec.appendChild(box);
  sec.appendChild(file);
  return sec;
}
