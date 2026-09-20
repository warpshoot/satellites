// リバーブ用インパルス応答の手続き生成。外部ファイルは読まない。
export function createIR(ctx, length, decay) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * length));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
