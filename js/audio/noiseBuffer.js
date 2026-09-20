// ホワイトノイズは全ボイスで共有する。ボイスごとに作らない。
let shared = null;

export function getNoiseBuffer(ctx) {
  if (shared && shared.sampleRate === ctx.sampleRate) return shared;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  shared = buf;
  return shared;
}
