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
  lydian: [0, 2, 4, 6, 7, 9, 11],      // 増4度。浮いたまま着地しない
  harmMinor: [0, 2, 3, 5, 7, 8, 11],   // 短調に導音。長2度の跳びが不穏に鳴る
  pentaMinor: [0, 3, 5, 7, 10],
  inSen: [0, 1, 5, 7, 8],              // 陰旋法。半音が2つ入るだけで景色が変わる
  wholeTone: [0, 2, 4, 6, 8, 10],
  fourths: [0, 5],
  fifths: [0, 7],
  unison: [0]                          // 全部ユニゾン。ドローンを厚くするとき効く
};

export const SCALE_IDS = Object.keys(SCALES);

export const SCALE_LABELS = {
  off: 'なし',
  chromatic: '半音',
  major: '長',
  minor: '短',
  dorian: 'ドリア',
  lydian: 'リディア',
  harmMinor: '和声短',
  pentaMinor: 'ペンタ',
  inSen: '陰旋',
  wholeTone: '全音',
  fourths: '4度',
  fifths: '5度',
  unison: '単音'
};

// drift は転調の速さ。0 で動かない。実際に何半音ずらすかは engine が持つ
// （パッチに焼くと、開くたびに違う調で始まって「保存した音」でなくなる）。
export const TUNING_DEFAULTS = { root: 'C', scale: 'pentaMinor', drift: 0 };

// C4 を基準にとる。吸着はオクターブをまたいで効くので、どの高さで数えても同じ。
export function rootHz(name) {
  const i = ROOTS.indexOf(name);
  return 440 * Math.pow(2, ((i < 0 ? 0 : i) - 9) / 12);
}

// いま鳴っているルートの周波数。転調ぶんはここでだけ効かせる。
export function baseHz(tuning) {
  return rootHz(tuning.root) * Math.pow(2, (tuning.offset || 0) / 12);
}

// 転調の行き先。音階の音度そのものを候補にする。ここを半音の自由歩行に
// すると、数分ごとに関係のない調へ飛んで「別の曲が始まった」に聞こえる。
// 上下 7 半音に収めて、積み上がって遠くへ行ってしまわないようにする。
export function keySteps(tuning) {
  const set = scaleSet(tuning);
  if (!set) return [0];
  const out = [];
  for (const s of set) {
    for (const v of [s, s - 12]) {
      if (Math.abs(v) <= 7 && !out.includes(v)) out.push(v);
    }
  }
  return out.length ? out : [0];
}

// 周波数を音名にする。A4 = 440Hz。ぴったりでなければセントを添える。
// 画面のどこにも「いま何の音か」が出ていないのは、キーを持つアプリとしては片手落ち。
export function noteName(hz) {
  if (!hz || !isFinite(hz) || hz <= 0) return '';
  const semis = 12 * Math.log2(hz / 440) + 69;
  const n = Math.round(semis);
  const cents = Math.round((semis - n) * 100);
  const name = ROOTS[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  if (cents === 0) return name;
  return name + (cents > 0 ? '+' : '') + cents;
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
  const base = baseHz(tuning);
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
