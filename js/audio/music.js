// 音程の吸着。基音と音階はマスターに1組だけ置いて、全ボイスで共有する。
// 「置いた場所で音が決まる」という筋は変えない。決まった音を、鳴らす直前に
// 一番近い音度へ寄せるだけ。off ならそのまま素通りする。

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  off: null,
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentaMinor: [0, 3, 5, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  fifths: [0, 7]
};

export const SCALE_IDS = Object.keys(SCALES);

export const SCALE_LABELS = {
  off: 'なし',
  chromatic: '半音',
  major: '長',
  minor: '短',
  dorian: 'ドリア',
  pentaMinor: 'ペンタ',
  wholeTone: '全音',
  fifths: '5度'
};

export const TUNING_DEFAULTS = { root: 'C', scale: 'pentaMinor' };

// C4 を基準にとる。吸着はオクターブをまたいで効くので、どの高さで数えても同じ。
export function rootHz(name) {
  const i = ROOTS.indexOf(name);
  return 440 * Math.pow(2, ((i < 0 ? 0 : i) - 9) / 12);
}

export function scaleSet(tuning) {
  if (!tuning) return null;
  return SCALES[tuning.scale] || null;
}

// 一番近い音度へ寄せる。オクターブの継ぎ目をまたぐので、12 も候補に入れる。
export function quantize(hz, tuning) {
  if (!hz || !isFinite(hz) || hz <= 0) return hz;
  const set = scaleSet(tuning);
  if (!set) return hz;
  const base = rootHz(tuning.root);
  const semis = 12 * Math.log2(hz / base);
  const oct = Math.floor(semis / 12);
  const within = semis - oct * 12;
  let best = set[0];
  let bestD = Infinity;
  for (let k = 0; k <= set.length; k++) {
    const s = k === set.length ? 12 : set[k];
    const d = Math.abs(s - within);
    if (d < bestD) { bestD = d; best = s; }
  }
  return base * Math.pow(2, (oct * 12 + best) / 12);
}
