// パッチのパネル。ここに並ぶのは全部「いまあるものを丸ごと入れ替える」操作で、
// マスターのノブとは性質が違う（ノブは連続で動かせて、押した先も予想がつく）。
// 同じタブに混ぜていたときは、プリセットとランダムがノブ 15 本の下に埋まっていて、
// 初めて触る人が唯一楽しめる2つに一番遠かった。
//
// 並びは触る回数の順。プリセット → ランダム → 持ち出しと持ち込み。

export function renderPatch(el, app, ui) {
  const head = document.createElement('div');
  head.className = 'panel-head';
  const name = document.createElement('span');
  name.className = 'panel-name';
  name.style.setProperty('--c', '#9aa4b2');
  name.textContent = 'PATCH';
  head.appendChild(name);
  const hint = document.createElement('span');
  hint.className = 'panel-hint';
  hint.textContent = '丸ごと入れ替える';
  head.appendChild(hint);
  el.appendChild(head);

  el.appendChild(presetSection(app, ui));
  el.appendChild(randomSection(app, ui));
  el.appendChild(patchSection(app, ui));
  el.appendChild(undoSection(app, ui));
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
// タブが「パッチ」なので、見出しでもう一度パッチと言わない。
function patchSection(app, ui) {
  const sec = ui.section('持ち出しと持ち込み');

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
  sec.appendChild(row(loadBtn));

  sec.appendChild(box);
  sec.appendChild(file);
  return sec;
}

// 最後に残す出口。「空にする」は何も無いところから始め直すためのもので、
// 「元に戻す」はここに並ぶ操作すべての受け皿（プリセットもランダムも
// 持ち込みも、上書きの前に退避を取っている）。だから一番下に置く。
function undoSection(app, ui) {
  const sec = ui.section('やり直し');
  const row = document.createElement('div');
  row.className = 'patch-row';
  const btn = (label, onClick) => {
    const b = document.createElement('button');
    b.className = 'chip danger';
    b.textContent = label;
    b.addEventListener('click', onClick);
    row.appendChild(b);
  };
  btn('空にする', () => app.clearAll());
  if (app.hasBackup()) btn('元に戻す', () => app.restoreBackup());
  sec.appendChild(row);
  return sec;
}
