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
  el.appendChild(randomSection(app, ui));
  el.appendChild(presetSection(app, ui));
  el.appendChild(patchSection(app, ui));
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

// 音作りの当てがまったく無いときの出口。押す前に退避を取るので、
// 気に入らなければ「元に戻す」で帰ってこられる。
// 星ごとのチップと同じ「ランダム」で通す。同じ機能に2つ名前を付けない。
//
// 2枚あるのは、触る範囲が違うから。「音」はいま置いてある星の音だけを振り、
// 「配置ごと」は星の数から引き直す。どちらが何を壊すかは添え書きで出す。
function randomSection(app, ui) {
  const sec = ui.section('ランダム');
  const line = (label, hint, onClick) => {
    const row = document.createElement('div');
    row.className = 'patch-row';
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', onClick);
    row.appendChild(b);
    const note = document.createElement('span');
    note.className = 'note'; // 動かない添え書き。生きている readout とは別物。
    note.textContent = hint;
    row.appendChild(note);
    return row;
  };
  sec.appendChild(line('音', '置いた場所と周回は動かない', () => app.randomizeAll()));
  sec.appendChild(line('配置ごと', '星の数から引き直す', () => app.scatterAll()));
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

  // 空にするのも持ち込みと同じで、いまの配置を丸ごと入れ替える操作。
  // 退避を取ってから消すので、直後なら「元に戻す」が出る。
  sec.appendChild(row(btn('空にする', 'danger', () => app.clearAll())));

  sec.appendChild(box);
  sec.appendChild(file);
  return sec;
}
