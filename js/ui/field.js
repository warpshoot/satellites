import { VOICE_TYPES } from '../audio/voices/registry.js';
import { lookOf, skySvg, LOOK_IDS } from './looks.js';

export const DOT_MIN = 2;
export const DOT_MAX = 11;
const HIT_MIN = 46;          // 星は小さいが、掴める大きさは別に確保する

// 星の大きさは距離。遠いほど小さく、淡く、奥に描く。
export function dotRadius(z) {
  return DOT_MIN + z * (DOT_MAX - DOT_MIN);
}

// 真上から見た図。消失点を作らないので、中心は核だけを意味する。
// cam は画面の中心に置く座標。選んだ星を追うときだけ動く。
const cam = { x: 0.5, y: 0.5 };

export function project(x, y, w, h) {
  return { sx: (x - cam.x + 0.5) * w, sy: (1 - (y - cam.y + 0.5)) * h };
}

export function unproject(sx, sy, w, h) {
  return { x: sx / w + cam.x - 0.5, y: 1 - sy / h + cam.y - 0.5 };
}

export function createField(el, app) {
  // 選んだ星を中心に寄せる。飛ばさずに寄せたいので少しずつ近づける。
  function cameraTarget() {
    const v = app.cameraFollow() ? app.selected() : null;
    if (!v) return { x: 0.5, y: 0.5 };
    const p = app.effectivePos(v);
    return { x: p.x, y: p.y };
  }

  function stepCamera() {
    const t = cameraTarget();
    const dx = t.x - cam.x;
    const dy = t.y - cam.y;
    if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) {
      cam.x = t.x;
      cam.y = t.y;
      return false;
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
    const rect = el.getBoundingClientRect();
    const p = app.effectivePos(v);
    const pt = project(p.x, p.y, rect.width, rect.height);
    const aw = ask.offsetWidth;
    const ah = ask.offsetHeight;
    const mx = aw / 2 + 6;
    ask.style.left = Math.min(Math.max(pt.sx, mx), Math.max(mx, rect.width - mx)) + 'px';
    ask.style.top = Math.min(Math.max(pt.sy - dotRadius(app.apparentOf(v)) - ah, 6), Math.max(6, rect.height - ah - 6)) + 'px';
  }

  function hideAsk() {
    ask._id = null;
    ask.classList.add('hidden');
  }

  // ソロ中は全体が黙って見えるので、解除の出口を常に見せておく
  const soloBar = document.createElement('button');
  soloBar.className = 'solo-bar hidden';
  soloBar.type = 'button';
  soloBar.textContent = 'ソロ中 · すべて解除';
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
    const r = el.getBoundingClientRect();
    const pw = picker.offsetWidth;
    const ph = picker.offsetHeight;
    const mx = pw / 2 + 6;
    const my = ph / 2 + 6;
    const pt = project(x, y, r.width, r.height);
    const px = Math.min(Math.max(pt.sx, mx), Math.max(mx, r.width - mx));
    const py = Math.min(Math.max(pt.sy - ph * 0.9, my), Math.max(my, r.height - my));
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

  function bindDot(dot, id) {
    const v0 = () => app.find(id);
    let mode = null;
    let moved = false;
    let longTimer = null;
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
      longTimer = setTimeout(() => {
        longTimer = null;
        mode = null;
        askDelete(id);
      }, 620);
    });

    dot.addEventListener('pointermove', (e) => {
      if (!mode) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 7) {
        moved = true;
        clearTimeout(longTimer);
        longTimer = null;
      }
      if (!moved) return;
      const v = v0();
      if (!v || v.orbit) return; // 周回中の位置は軌道が決める
      const rect = el.getBoundingClientRect();
      const u = unproject(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      app.moveTo(id, u.x, u.y);
    });

    const finish = (e) => {
      dot.classList.remove('grabbing');
      clearTimeout(longTimer);
      longTimer = null;
      if (!mode) return;
      mode = null;
      const rect = el.getBoundingClientRect();
      const out =
        e.clientX < rect.left - 4 || e.clientX > rect.right + 4 ||
        e.clientY < rect.top - 4 || e.clientY > rect.bottom + 4;
      const vv = v0();
      if (moved && out && vv && !vv.orbit) {
        app.remove(id); // 盤面外に投げたら削除。周回中は指に付いてこないので対象外。
        return;
      }
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
    const rect = el.getBoundingClientRect();
    const u = unproject(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const x = Math.min(1, Math.max(0, u.x));
    const y = Math.min(1, Math.max(0, u.y));
    app.select(null);
    if (!app.canAdd()) {
      app.notice('星は8つまで');
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
    const rect = el.getBoundingClientRect();
    app.setAspect(rect.width / rect.height);
    for (const v of app.voices()) {
      const d = dots.get(v.id);
      if (!d) continue;
      const pos = app.effectivePos(v);
      const r = dotRadius(app.apparentOf(v));
      const hit = Math.max(HIT_MIN, r * 2 + 18);
      d.el.style.width = hit + 'px';
      d.el.style.height = hit + 'px';
      // 重なり順は見かけの明るさではなく実際の距離で決める
      d.el.style.zIndex = String(2 + Math.round(app.nearOf(v) * 100));
      d.body.style.width = r * 2 + 'px';
      d.body.style.height = r * 2 + 'px';
      d.body.style.opacity = (0.4 + 0.58 * app.nearOf(v)).toFixed(3);
      const pt = project(pos.x, pos.y, rect.width, rect.height);
      d.el.style.transform = 'translate(' + (pt.sx - hit / 2) + 'px,' + (pt.sy - hit / 2) + 'px)';
    }
    layoutLinks();
  }

  // 周回の軌道。傾斜で面が倒れるため、点列を追って描く。
  // 奥側を薄く、手前側を濃くすることで立体に見せる。
  function layoutLinks() {
    const rect = el.getBoundingClientRect();
    links.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
    // 核も投影を通す。素の画面中心に描くと、カメラを動かしたとき核まで付いてくる。
    const core = project(0.5, 0.5, rect.width, rect.height);
    const cx = core.sx;
    const cy = core.sy;
    // 中心もただの星。目立たせる飾りは置かない。
    const parts = ['<g class="hub">' +
      '<circle class="halo1" r="5" cx="' + cx + '" cy="' + cy + '"/>' +
      '<circle class="core" r="2" cx="' + cx + '" cy="' + cy + '"/></g>'];
    for (const v of app.voices()) {
      const pts = app.orbitPath(v);
      if (!pts) continue;
      const sel = app.selectedId() === v.id ? ' on' : '';
      let far = '';
      let near = '';
      let prevBehind = null;
      for (const pt of pts) {
        const p = project(pt.x, pt.y, rect.width, rect.height);
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
