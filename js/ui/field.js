import { VOICE_TYPES } from '../audio/voices/registry.js';
import { MAX_VOICES } from '../state.js';
import { lookOf, skySvg, LOOK_IDS } from './looks.js';
import { Y_SPAN, clampPos } from '../world.js';

export const DOT_MIN = 2;
export const DOT_MAX = 11;
const HIT_MIN = 46;          // 星は小さいが、掴める大きさは別に確保する

// 星の大きさは距離。遠いほど小さく、淡く、奥に描く。
// k は画面の縮尺。2〜11px はスマホの盤面で決めた数字なので、広い画面では膨らませる。
export function dotRadius(z, k = 1) {
  return (DOT_MIN + z * (DOT_MAX - DOT_MIN)) * k;
}

// 真上から見た図。消失点を作らないので、中心は核だけを意味する。
// cam は画面の中心に置く座標。選んだ星を追うときだけ動く。
const cam = { x: 0.5, y: 0.5 };

// 縦も横も同じ縮尺で描く（world.js）。縮尺は「横 1、縦 Y_SPAN」が必ず収まる大きさで、
// 余った面積は拡大には使わず、宇宙の続きとして見せる。
// 横長の画面ではパネルが盤面に重なるので、中心は隠れていない部分の真ん中に取る。
function viewOf(w, h, inset) {
  const vw = Math.max(1, w - inset);
  const s = Math.min(vw, h / Y_SPAN);
  return { cx: vw / 2, cy: h / 2, s, vw, h };
}

export function project(x, y, view) {
  return { sx: view.cx + (x - cam.x) * view.s, sy: view.cy - (y - cam.y) * view.s };
}

export function unproject(sx, sy, view) {
  return { x: (sx - view.cx) / view.s + cam.x, y: -(sy - view.cy) / view.s + cam.y };
}

// 星の縮尺。スマホの盤面（横 390px）で 1。大きくしすぎると記号が主張しはじめる。
const BASE_S = 390;
function dotScale(view) {
  return Math.min(2.2, Math.max(1, view.s / BASE_S));
}

export function createField(el, app) {
  // 選んだ星を中心に寄せる。飛ばさずに寄せたいので少しずつ近づける。
  function cameraTarget() {
    const v = app.cameraFollow() ? app.selected() : null;
    if (!v) return { x: 0.5, y: 0.5 };
    const p = app.effectivePos(v);
    return { x: p.x, y: p.y };
  }

  // 横長の画面では、パネルが盤面の右に重なる。その幅だけ中心を左へ寄せる。
  // 畳んだら 0 へ寄せていき、核がゆっくり画面の真ん中へ戻る。
  const side = document.getElementById('side');
  let inset = null;
  function insetTarget(width) {
    if (!side || side.classList.contains('closed')) return 0;
    if (getComputedStyle(side).position !== 'absolute') return 0;
    return Math.max(0, width - side.offsetLeft);
  }

  // いまの画面での投影。盤面の左上の画面座標も一緒に持つ。
  function frame() {
    const r = el.getBoundingClientRect();
    if (inset == null) inset = insetTarget(r.width);
    const f = viewOf(r.width, r.height, inset);
    f.left = r.left;
    f.top = r.top;
    f.width = r.width;
    return f;
  }

  function stepInset() {
    const t = insetTarget(el.clientWidth);
    if (inset == null || Math.abs(t - inset) < 0.5) {
      inset = t;
      return false;
    }
    inset += (t - inset) * 0.35;
    return true;
  }

  function stepCamera() {
    const sliding = stepInset();
    const t = cameraTarget();
    const dx = t.x - cam.x;
    const dy = t.y - cam.y;
    if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) {
      cam.x = t.x;
      cam.y = t.y;
      return sliding;
    }
    cam.x += dx * 0.25;
    cam.y += dy * 0.25;
    return true;
  }

  const dots = new Map();
  let skyStyle = null;
  function renderSky() {
    if (skyStyle === app.sky()) return;
    skyStyle = app.sky();
    const old = el.querySelector('.sky');
    if (old) old.remove();
    // 「なし」は星を消すだけでなく星雲と縁の陰も落とす。中途半端に暗いより真っ黒。
    el.classList.toggle('sky-none', skyStyle === 'none');
    el.insertAdjacentHTML('afterbegin', skySvg(skyStyle));
  }
  renderSky();

  // 周回の軌道と、錨への結び。関係が見えないと群れに見えない。
  const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  links.setAttribute('class', 'links');
  el.appendChild(links);

  // 削除の確認。confirm() はシステムダイアログで、iOS だと音声を持っていかれる。
  const ask = document.createElement('div');
  ask.className = 'ask hidden';
  const askText = document.createElement('span');
  askText.textContent = '削除する？';
  const askYes = document.createElement('button');
  askYes.type = 'button';
  askYes.className = 'ask-yes';
  askYes.textContent = '削除';
  const askNo = document.createElement('button');
  askNo.type = 'button';
  askNo.className = 'ask-no';
  askNo.textContent = 'やめる';
  ask.appendChild(askText);
  ask.appendChild(askNo);
  ask.appendChild(askYes);
  el.appendChild(ask);
  askYes.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = ask._id;
    hideAsk();
    if (id) app.remove(id);
  });
  askNo.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAsk();
  });

  function askDelete(id) {
    const v = app.find(id);
    if (!v) return;
    ask._id = id;
    ask.classList.remove('hidden');
    const f = frame();
    const p = app.effectivePos(v);
    const pt = project(p.x, p.y, f);
    const aw = ask.offsetWidth;
    const ah = ask.offsetHeight;
    const mx = aw / 2 + 6;
    // パネルが重なっている部分には出さない。見えている幅の中に収める。
    ask.style.left = Math.min(Math.max(pt.sx, mx), Math.max(mx, f.vw - mx)) + 'px';
    ask.style.top = Math.min(Math.max(pt.sy - dotRadius(app.apparentOf(v), dotScale(f)) - ah, 6), Math.max(6, f.h - ah - 6)) + 'px';
  }

  function hideAsk() {
    ask._id = null;
    ask.classList.add('hidden');
  }

  // ソロ中は全体が黙って見えるので、解除の出口を常に見せておく
  const soloBar = document.createElement('button');
  soloBar.className = 'solo-bar hidden';
  soloBar.type = 'button';
  soloBar.textContent = 'ソロ解除';
  soloBar.addEventListener('click', (e) => {
    e.stopPropagation();
    app.clearSolo();
  });
  el.appendChild(soloBar);

  const picker = document.createElement('div');
  picker.className = 'picker hidden';
  el.appendChild(picker);

  VOICE_TYPES.forEach((V) => {
    const b = document.createElement('button');
    b.className = 'picker-btn';
    b.type = 'button';
    b.textContent = V.label;
    b.style.setProperty('--c', lookOf(V.look).c);
    b.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (performance.now() - picker._shownAt < 220) return; // 同じタップの pointerup を拾わない
      hidePicker();
      app.add(V.type, picker._x, picker._y);
    });
    picker.appendChild(b);
  });

  function showPicker(x, y) {
    picker._x = x;
    picker._y = y;
    picker._shownAt = performance.now();
    picker.classList.remove('hidden');
    // 実寸を測ってから寄せる。決め打ちの余白だと盤面の端で種別が切れる。
    // 幅は CSS 側で固定してある（成り行きにすると、寄せた先の残り幅で
    // 折り返し直されて、ここで測った寸法が当てにならなくなる）。
    const r = frame();
    const pw = picker.offsetWidth;
    const ph = picker.offsetHeight;
    const mx = pw / 2 + 6;
    const my = ph / 2 + 6;
    const pt = project(x, y, r);
    const px = Math.min(Math.max(pt.sx, mx), Math.max(mx, r.vw - mx));
    let py = Math.min(Math.max(pt.sy - ph * 0.9, my), Math.max(my, r.h - my));

    // 停止ボタンは盤面の左上に居座っていて、ピッカーより手前に描かれる。
    // 重なったままだと、左上の角をタップしたとき1つ目の種別が押せない。
    // 手前に出すのではなく下へ逃がす。停止ボタンを塞がないほうが筋が通る。
    const stop = el.querySelector('#transport');
    if (stop && stop.classList.contains('visible')) {
      const tb = stop.getBoundingClientRect();
      const tx = tb.left - r.left;
      const ty = tb.top - r.top;
      const hits = px - pw / 2 < tx + tb.width + 6 && px + pw / 2 > tx - 6
        && py - ph / 2 < ty + tb.height + 6 && py + ph / 2 > ty - 6;
      if (hits) py = Math.min(ty + tb.height + 6 + ph / 2, Math.max(my, r.h - my));
    }

    picker.style.left = px + 'px';
    picker.style.top = py + 'px';
  }

  function hidePicker() {
    picker.classList.add('hidden');
  }

  function makeDot(v) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.dataset.id = v.id;
    const body = document.createElement('span');
    body.className = 'dot-body';
    dot.appendChild(body);
    bindDot(dot, v.id);
    el.appendChild(dot);
    return { el: dot, body };
  }

  // 星に対する指の操作は、選ぶことと動かすことだけ。削除はパネルの「削除」が持つ。
  // 盤面に見えない操作（長押し、盤面外へ投げる）は置かない。
  function bindDot(dot, id) {
    const v0 = () => app.find(id);
    let mode = null;
    let moved = false;
    let wasSelected = false;
    let startX = 0;
    let startY = 0;

    dot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      hidePicker();
      hideAsk();
      const v = app.find(id);
      if (!v) return;
      dot.setPointerCapture(e.pointerId);
      mode = 'move';
      moved = false;
      wasSelected = app.selectedId() === id; // 押した時点で選ばれていたか
      dot.classList.add('grabbing'); // 掴んでいる間は補間を切る。指から遅れる。
      startX = e.clientX;
      startY = e.clientY;
      app.select(id);
    });

    dot.addEventListener('pointermove', (e) => {
      if (!mode) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 7) moved = true;
      if (!moved) return;
      const v = v0();
      if (!v || v.orbit) return; // 周回中の位置は軌道が決める
      // 見えている範囲の外（パネルの下や画面の外）へは連れていかない
      const f = frame();
      const sx = Math.min(f.vw, Math.max(0, e.clientX - f.left));
      const sy = Math.min(f.h, Math.max(0, e.clientY - f.top));
      const u = unproject(sx, sy, f);
      app.moveTo(id, u.x, u.y);
    });

    const finish = () => {
      dot.classList.remove('grabbing');
      if (!mode) return;
      mode = null;
      // 動かさずに離したとき、既に選ばれていた星なら選択を外す。
      // 核を中心に全体を眺める状態へ戻れるようにする。
      if (!moved && wasSelected) app.select(null);
      app.commit();
    };

    dot.addEventListener('pointerup', finish);
    dot.addEventListener('pointercancel', finish);
  }

  el.addEventListener('pointerup', (e) => {
    if (e.target !== el) return;
    if (!ask.classList.contains('hidden')) {
      hideAsk();
      return;
    }
    if (!picker.classList.contains('hidden')) {
      hidePicker();
      return;
    }
    // 盤面のどこを触っても、そこに置ける。広い画面では横に続く宇宙にも置ける。
    const f = frame();
    const u = unproject(e.clientX - f.left, e.clientY - f.top, f);
    const x = clampPos(u.x);
    const y = clampPos(u.y);
    app.select(null);
    if (!app.canAdd()) {
      app.notice('星は' + MAX_VOICES + '個まで');
      return;
    }
    showPicker(x, y);
  });

  function render() {
    renderSky();
    const seen = new Set();
    for (const v of app.voices()) {
      seen.add(v.id);
      if (!dots.has(v.id)) dots.set(v.id, makeDot(v));
    }
    for (const [id, d] of dots) {
      if (!seen.has(id)) {
        d.el.remove();
        dots.delete(id);
      }
    }
    for (const v of app.voices()) {
      const d = dots.get(v.id);
      const look = lookOf(v.look);
      d.el.style.setProperty('--c', look.c);
      for (const l of LOOK_IDS) d.el.classList.toggle('look-' + l, look.id === l);
      d.el.classList.toggle('selected', app.selectedId() === v.id);
      d.el.classList.toggle('muted', !app.audible(v.id));
      d.el.classList.toggle('soloed', app.isSoloed(v.id));
    }
    if (ask._id && !app.find(ask._id)) hideAsk();
    soloBar.classList.toggle('hidden', !app.soloActive());
    layout();
  }

  function layout() {
    const f = frame();
    const k = dotScale(f);
    soloBar.style.left = f.cx + 'px';
    for (const v of app.voices()) {
      const d = dots.get(v.id);
      if (!d) continue;
      const pos = app.effectivePos(v);
      const r = dotRadius(app.apparentOf(v), k);
      const hit = Math.max(HIT_MIN, r * 2 + 18);
      d.el.style.width = hit + 'px';
      d.el.style.height = hit + 'px';
      // 重なり順は見かけの明るさではなく実際の距離で決める
      d.el.style.zIndex = String(2 + Math.round(app.nearOf(v) * 100));
      d.body.style.width = r * 2 + 'px';
      d.body.style.height = r * 2 + 'px';
      d.body.style.opacity = (0.4 + 0.58 * app.nearOf(v)).toFixed(3);
      const pt = project(pos.x, pos.y, f);
      d.el.style.transform = 'translate(' + (pt.sx - hit / 2) + 'px,' + (pt.sy - hit / 2) + 'px)';
    }
    layoutLinks(f, k);
  }

  // 周回の軌道。傾斜で面が倒れるため、点列を追って描く。
  // 奥側を薄く、手前側を濃くすることで立体に見せる。
  function layoutLinks(f, k) {
    links.setAttribute('viewBox', '0 0 ' + f.width + ' ' + f.h);
    // 核も投影を通す。素の画面中心に描くと、カメラを動かしたとき核まで付いてくる。
    const core = project(0.5, 0.5, f);
    const cx = core.sx;
    const cy = core.sy;
    // 中心もただの星。目立たせる飾りは置かない。
    const parts = ['<g class="hub">' +
      '<circle class="halo1" r="' + 5 * k + '" cx="' + cx + '" cy="' + cy + '"/>' +
      '<circle class="core" r="' + 2 * k + '" cx="' + cx + '" cy="' + cy + '"/></g>'];
    for (const v of app.voices()) {
      const pts = app.orbitPath(v);
      if (!pts) continue;
      const sel = app.selectedId() === v.id ? ' on' : '';
      let far = '';
      let near = '';
      let prevBehind = null;
      for (const pt of pts) {
        const p = project(pt.x, pt.y, f);
        const behind = pt.dz < 0;
        const seg = (behind === prevBehind ? 'L' : 'M') + p.sx.toFixed(1) + ' ' + p.sy.toFixed(1);
        if (behind) far += seg; else near += seg;
        prevBehind = behind;
      }
      if (far) parts.push('<path class="orbit far' + sel + '" d="' + far + '"/>');
      if (near) parts.push('<path class="orbit' + sel + '" d="' + near + '"/>');
    }
    links.innerHTML = parts.join('');
  }

  // 出音の実測から丸を膨らませる
  function setPulse(id, level) {
    const d = dots.get(id);
    if (!d) return;
    d.body.style.setProperty('--pulse', (1 + level * 0.3).toFixed(3));
    d.body.style.setProperty('--lift', (1 + level * 0.22).toFixed(3));
  }

  return { render, layout, hidePicker, setPulse, askDelete, stepCamera };
}
