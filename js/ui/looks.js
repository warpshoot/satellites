// 星の見た目。半径 2〜11px では陰影も質感も載らないので、
// 疑似的な球体をやめて、形で見分ける記号にしてある。
// 呼称は記号的に A〜F。中身の名前は形を表す。
export const LOOKS = [
  { id: 'solid', label: 'A', c: '#7d90ad' },  // 実体
  { id: 'ring', label: 'B', c: '#c6ad7e' },   // 環
  { id: 'hollow', label: 'C', c: '#93a0ab' }, // 中空
  { id: 'crescent', label: 'D', c: '#b06a51' },// 欠け
  { id: 'band', label: 'E', c: '#bc9a74' },   // 帯
  { id: 'binary', label: 'F', c: '#9484ad' }  // 伴星
];

export const LOOK_LABELS = LOOKS.reduce((m, l) => { m[l.id] = l.label; return m; }, {});
export const LOOK_IDS = LOOKS.map((l) => l.id);

export function lookOf(id) {
  return LOOKS.find((l) => l.id === id) || LOOKS[0];
}

// 背景の星。ノイズは一様に細かく、まばらは粒が大きく数が少ない。
export const SKY_STYLES = ['noise', 'sparse', 'none'];
export const SKY_LABELS = { noise: 'ノイズ', sparse: 'まばら', none: 'なし' };

export function skySvg(style) {
  if (style === 'none') return '<svg class="sky" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>';
  const sparse = style === 'sparse';
  const n = sparse ? 90 : 460;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (Math.random() * 1000).toFixed(1);
    const y = (Math.random() * 1000).toFixed(1);
    const r = sparse
      ? (0.8 + Math.pow(Math.random(), 2) * 1.6).toFixed(2)
      : (0.35 + Math.pow(Math.random(), 3) * 0.9).toFixed(2);
    const o = sparse
      ? (0.16 + Math.random() * 0.48).toFixed(2)
      : (0.07 + Math.random() * 0.38).toFixed(2);
    out.push('<circle cx="' + x + '" cy="' + y + '" r="' + r + '" opacity="' + o + '"/>');
  }
  return '<svg class="sky" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    out.join('') + '</svg>';
}
