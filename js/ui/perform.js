// 演奏レイヤー。触っている間だけ効いて、離すと効かない側へ寄り戻る帯。
//
// パッチの値には触らないので、何度振っても配置は壊れないし保存もしない
// （ソロ・ミュートと同じ扱い）。
//
// はじめは「時間」と「引力」も並べていたが外した。どちらも既にあるものを
// 一様に拡大縮小するだけで、速いか遅いか・大きいか小さいかしか起きない。
// 振っても音の性格が変わらないので、動かして面白くなかった。
// ここに足すなら、量ではなく質を変えるものにすること。
//
// 常時開いていると盤面を食うので、既定では閉じておく。

export const RIBBONS = [
  { key: 'burn', label: '灼く', min: 0, max: 1, scale: 'lin', rest: 0, lo: '澄む', hi: '焦げる' }
];

const SPRING = 0.18;   // 1フレームあたり戻る割合
const SNAP = 0.004;    // これより近づいたら戻り先に吸着させる

function toNorm(r, v) {
  if (r.scale === 'log') return Math.log(v / r.min) / Math.log(r.max / r.min);
  return (v - r.min) / (r.max - r.min);
}

function fromNorm(r, n) {
  const t = Math.min(1, Math.max(0, n));
  if (r.scale === 'log') return r.min * Math.pow(r.max / r.min, t);
  return r.min + t * (r.max - r.min);
}

export function createPerform(el, app) {
  const rows = new Map();
  let hold = false;
  let open = false;
  let raf = null;

  el.innerHTML = '';

  // 見出しそのものが開閉のボタン。細い帯なので、掴む幅は行いっぱいに取る。
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'perf-head';
  const title = document.createElement('span');
  title.className = 'perf-title';
  title.textContent = '演奏';
  const mark = document.createElement('span');
  mark.className = 'perf-mark';
  head.appendChild(title);
  head.appendChild(mark);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'perf-body';
  el.appendChild(body);

  const holdBtn = document.createElement('button');
  holdBtn.type = 'button';
  holdBtn.className = 'chip perf-hold';
  holdBtn.textContent = '固定';
  holdBtn.addEventListener('click', () => {
    hold = !hold;
    holdBtn.classList.toggle('on', hold);
    if (!hold) kick(); // 固定を解いたらその場で戻りはじめる
  });

  RIBBONS.forEach((r) => {
    const wrap = document.createElement('div');
    wrap.className = 'rib';

    const name = document.createElement('span');
    name.className = 'rib-name';
    name.textContent = r.label;
    const val = document.createElement('span');
    val.className = 'rib-val';
    wrap.appendChild(name);

    const track = document.createElement('div');
    track.className = 'rib-track';
    const fill = document.createElement('div');
    fill.className = 'rib-fill';
    const mid = document.createElement('div');
    mid.className = 'rib-mid';
    const thumb = document.createElement('div');
    thumb.className = 'rib-thumb';
    const lo = document.createElement('span');
    lo.className = 'rib-end lo';
    lo.textContent = r.lo;
    const hi = document.createElement('span');
    hi.className = 'rib-end hi';
    hi.textContent = r.hi;
    track.appendChild(mid);
    track.appendChild(fill);
    track.appendChild(thumb);
    track.appendChild(lo);
    track.appendChild(hi);
    wrap.appendChild(track);
    wrap.appendChild(val);
    body.appendChild(wrap);

    // 戻る先の目印。ここが見えていないと、どこが「効いていない」か分からない。
    const restN = Math.min(1, Math.max(0, toNorm(r, r.rest)));
    mid.style.left = (restN * 100).toFixed(2) + '%';

    const row = { r, track, fill, thumb, val, restN, wrap, active: false };
    rows.set(r.key, row);

    function set(clientX) {
      const b = track.getBoundingClientRect();
      const n = b.width > 0 ? (clientX - b.left) / b.width : 0;
      app.setPerf(r.key, fromNorm(r, n));
      paint(row);
    }

    // リボンごとにポインタを捕まえる。複数本でも別々の指で掴める。
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      row.active = true;
      row.pid = e.pointerId;
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      track.classList.add('held');
      set(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (row.active && e.pointerId === row.pid) set(e.clientX);
    });
    const release = (e) => {
      if (!row.active || e.pointerId !== row.pid) return;
      row.active = false;
      track.classList.remove('held');
      kick();
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
  });

  body.appendChild(holdBtn);

  function paint(row) {
    const v = app.perf(row.r.key);
    const n = Math.min(1, Math.max(0, toNorm(row.r, v)));
    row.thumb.style.left = (n * 100).toFixed(2) + '%';
    // 塗りは戻る先から現在地まで。効いていない場所からどれだけ離れたかを見せる。
    const a = Math.min(row.restN, n);
    const b = Math.max(row.restN, n);
    row.fill.style.left = (a * 100).toFixed(2) + '%';
    row.fill.style.width = ((b - a) * 100).toFixed(2) + '%';
    row.val.textContent = row.r.scale === 'log' ? '×' + v.toFixed(2) : v.toFixed(2);
    row.wrap.classList.toggle('on', Math.abs(n - row.restN) > 0.01);
  }

  // 指を離したぶんを戻す。ぱちんと戻すと音が段差になるので、寄せていく。
  function step() {
    raf = null;
    let moving = false;
    for (const row of rows.values()) {
      if (row.active || hold) continue;
      const r = row.r;
      const n = toNorm(r, app.perf(r.key));
      if (Math.abs(n - row.restN) < SNAP) {
        if (app.perf(r.key) !== r.rest) { app.setPerf(r.key, r.rest); paint(row); }
        continue;
      }
      app.setPerf(r.key, fromNorm(r, n + (row.restN - n) * SPRING));
      paint(row);
      moving = true;
    }
    if (moving) kick();
  }

  function kick() {
    if (raf == null) raf = requestAnimationFrame(step);
  }

  // 閉じたら演奏はやめる。畳んだまま固定が効いていると、音だけ灼けたまま
  // 戻す手が画面から消える。
  function setOpen(next) {
    open = !!next;
    el.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    mark.textContent = open ? '閉じる' : '開く';
    if (!open) {
      hold = false;
      holdBtn.classList.remove('on');
      for (const row of rows.values()) {
        row.active = false;
        row.track.classList.remove('held');
      }
      kick();
    }
  }

  head.addEventListener('click', () => setOpen(!open));

  function render() {
    for (const row of rows.values()) paint(row);
  }

  setOpen(false);
  render();
  return { render, setOpen };
}
