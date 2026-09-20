// 演奏レイヤー。いくつものパラメータを1ジェスチャで同時に動かす帯。
//
// ここで動かすのはパッチの値ではなく、位置と時間に掛かる「倍率」。
// 触っている間だけ効いて、離せば 1.0 に戻る。だから何をどう振っても
// 配置は壊れないし、保存もしない（ソロ・ミュートと同じ扱い）。
//
// 引力は軌道と座標をまとめて縮める。核に近づくほど音量・ドライ・高域が
// 上がるという既存の配線がそのまま動くので、ノブ1本で8点ぶんの
// ミックスが動く。時間は周回の進み方そのものを伸び縮みさせる。

export const RIBBONS = [
  // 対数で左右対称にしてある（min * max = 1）。真ん中がちょうど等倍。
  { key: 'time', label: '時間', min: 0.2, max: 5, lo: '遅い', hi: '速い' },
  { key: 'gravity', label: '引力', min: 0.4, max: 2.5, lo: '寄る', hi: '散る' }
];

const SPRING = 0.18;   // 1フレームあたり中央へ戻る割合
const SNAP = 0.004;    // これより近づいたら等倍に吸着させる

function toNorm(r, v) {
  return Math.log(v / r.min) / Math.log(r.max / r.min);
}

function fromNorm(r, n) {
  return r.min * Math.pow(r.max / r.min, Math.min(1, Math.max(0, n)));
}

export function createPerform(el, app) {
  const rows = new Map();
  let hold = false;
  let raf = null;

  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'perf-head';
  const title = document.createElement('span');
  title.className = 'perf-title';
  title.textContent = '演奏';
  head.appendChild(title);

  const holdBtn = document.createElement('button');
  holdBtn.type = 'button';
  holdBtn.className = 'chip';
  holdBtn.textContent = '固定';
  holdBtn.addEventListener('click', () => {
    hold = !hold;
    holdBtn.classList.toggle('on', hold);
    if (!hold) kick(); // 固定を解いたらその場で戻りはじめる
  });
  head.appendChild(holdBtn);
  el.appendChild(head);

  RIBBONS.forEach((r) => {
    const wrap = document.createElement('div');
    wrap.className = 'rib';

    const rh = document.createElement('div');
    rh.className = 'rib-head';
    const name = document.createElement('span');
    name.textContent = r.label;
    const val = document.createElement('span');
    val.className = 'rib-val';
    rh.appendChild(name);
    rh.appendChild(val);
    wrap.appendChild(rh);

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
    el.appendChild(wrap);

    const row = { r, track, fill, thumb, val, active: false };
    rows.set(r.key, row);

    function set(clientX) {
      const b = track.getBoundingClientRect();
      const n = b.width > 0 ? (clientX - b.left) / b.width : 0.5;
      app.setPerf(r.key, fromNorm(r, n));
      paint(row);
    }

    // 2本を別々の指で同時に掴める。ポインタごとに捕まえる。
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

  function paint(row) {
    const v = app.perf(row.r.key);
    const n = Math.min(1, Math.max(0, toNorm(row.r, v)));
    const pct = (n * 100).toFixed(2) + '%';
    row.thumb.style.left = pct;
    // 塗りは真ん中から現在地まで。等倍からどちらへ何割ずらしたかを見せる。
    const a = Math.min(0.5, n);
    const b = Math.max(0.5, n);
    row.fill.style.left = (a * 100).toFixed(2) + '%';
    row.fill.style.width = ((b - a) * 100).toFixed(2) + '%';
    row.val.textContent = '×' + v.toFixed(2);
    row.track.classList.toggle('off', Math.abs(n - 0.5) > 0.01);
  }

  // 指を離したぶんを中央へ戻す。ぱちんと戻すと音が段差になるので、寄せていく。
  function step() {
    raf = null;
    let moving = false;
    for (const row of rows.values()) {
      if (row.active || hold) continue;
      const r = row.r;
      const n = toNorm(r, app.perf(r.key));
      if (Math.abs(n - 0.5) < SNAP) {
        if (app.perf(r.key) !== 1) { app.setPerf(r.key, 1); paint(row); }
        continue;
      }
      app.setPerf(r.key, fromNorm(r, n + (0.5 - n) * SPRING));
      paint(row);
      moving = true;
    }
    if (moving) kick();
  }

  function kick() {
    if (raf == null) raf = requestAnimationFrame(step);
  }

  function render() {
    for (const row of rows.values()) paint(row);
  }

  render();
  return { render };
}
