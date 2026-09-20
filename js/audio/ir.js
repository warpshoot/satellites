// リバーブ用インパルス応答の手続き生成。外部ファイルは読まない。
// 素の白ノイズを減衰させただけだと、高域が最後まで残って金属質になる。
// プリディレイ → 初期反射 → 時間とともに暗くなる拡散、の順に組む。

const PRE_DELAY = 0.018;   // 直接音と残響の間。これが無いと音像が張り付く
const CH_OFFSET = 0.007;   // L/R をずらして相関を切る

export function createIR(ctx, length, decay) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * length));
  const buf = ctx.createBuffer(2, len, sr);
  let peak = 0;

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const pre = Math.floor(sr * (PRE_DELAY + ch * CH_OFFSET));
    // 左右で長さをわずかに変える。同じ長さだと尾が中央で固まる。
    const tail = Math.max(1, Math.floor(len * (ch === 0 ? 1 : 0.97)) - pre);
    let lp = 0;

    for (let i = 0; i < tail; i++) {
      const t = i / tail;
      // 1極ローパスの係数を時間で動かす。尾に向かって高域が失われていく。
      const a = 0.62 - 0.46 * t;
      lp += a * ((Math.random() * 2 - 1) - lp);
      // 指数減衰。(1-t) の冪だけだと後半が直線的に痩せて不自然に途切れる。
      const env = Math.exp(-decay * 1.6 * t) * Math.pow(1 - t, 0.9);
      const s = lp * env;
      data[pre + i] = s;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
    }

    // 初期反射。数発の疎なスパイクで部屋の大きさが決まる。
    let rt = 0.006 + ch * 0.003;
    let amp = 0.55;
    while (rt < 0.075) {
      const idx = pre + Math.floor(rt * sr);
      if (idx >= len) break;
      const s = (Math.random() < 0.5 ? -1 : 1) * amp;
      data[idx] += s;
      const abs = Math.abs(data[idx]);
      if (abs > peak) peak = abs;
      rt += 0.007 + Math.random() * 0.013;
      amp *= 0.72;
    }
  }

  // 正規化は両チャンネル同じ係数で。別々に掛けると定位が動く。
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] *= k;
    }
  }
  return buf;
}
