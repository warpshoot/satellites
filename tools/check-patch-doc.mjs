// docs/PATCH_AUTHORING.md が現物と合っているか確かめる。
//
// あの説明書は「AI にリポジトリを読ませない」ために値域を転記してある。転記は
// 必ず腐るので、腐ったことが分かる手を用意してある。実際に2回腐った——
// BELL を足したとき種別の表だけ4種のまま残り、座標を画面の形から切り離したとき
// 明暗の向きが逆のまま残った。
//
// 照合はパラメータ定義そのものから回す。ここに項目を書き並べないこと。
// 書き並べると、種別を足した人がこのファイルも直さないと網が広がらない。
//
//   node tools/check-patch-doc.mjs
//
// 合っていれば何も言わずに終わる。食い違えば行ごとに出して 1 で落ちる。

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/PATCH_AUTHORING.md';
const PORT = 8137;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const srv = createServer(async (req, res) => {
  try {
    const u = req.url.split('?')[0].split('#')[0];
    const p = join(ROOT, u === '/' ? '/index.html' : u);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch (e) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => srv.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:' + PORT + '/');

// 現物の申告を集める。値域を持つものは params、綴りだけのものは words。
const live = await page.evaluate(async () => {
  const reg = await import('/js/audio/voices/registry.js');
  const base = await import('/js/audio/voices/base.js');
  const music = await import('/js/audio/music.js');
  const looks = await import('/js/ui/looks.js');
  const st = await import('/js/state.js');

  const params = [];
  const push = (owner, defs, keyOf) => {
    for (const d of defs) {
      params.push({
        owner, key: keyOf(d),
        min: d.min, max: d.max,
        options: d.type === 'select' ? d.options.map(String) : null
      });
    }
  };
  for (const V of reg.VOICE_TYPES) push(V.type, V.params, (d) => d.key);
  push('common', base.COMMON_PARAMS, (d) => d.key);
  push('orbit', st.ORBIT_PARAMS, (d) => d.key);
  push('master', st.MASTER_PARAMS, (d) => d.path);

  return {
    params,
    // 表の行として載っているべき語。どれも定義から引くので、足したら自動で網に入る。
    words: {
      type: reg.VOICE_TYPES.map((V) => V.type),
      look: looks.LOOK_IDS,
      sky: looks.SKY_STYLES
    },
    scales: music.SCALE_IDS,
    roots: music.ROOTS,
    maxVoices: st.MAX_VOICES
  };
});
await browser.close();
srv.close();

if (errs.length) {
  console.error('モジュールの読み込みで例外が出た:\n  ' + errs.join('\n  '));
  process.exit(1);
}

const doc = await readFile(join(ROOT, DOC), 'utf8');
const lines = doc.split('\n');
const bad = [];

// 表の行を鍵で引く。`key` を先頭のセルに持つ行だけを見る。
function rowsFor(key) {
  const head = new RegExp('^\\s*\\|\\s*`' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s*\\|');
  return lines.filter((l) => head.test(l));
}

// 3.5 と 3.50 を同じに見る。整数は小数点を付けずに書いてあることが多い。
function shows(rows, v) {
  const forms = new Set([String(v)]);
  if (Number.isInteger(v)) forms.add(String(Math.trunc(v)));
  return rows.some((r) => [...forms].some((f) => r.includes(f)));
}

for (const p of live.params) {
  const rows = rowsFor(p.key);
  if (!rows.length) {
    bad.push(`${p.owner}.${p.key}: 表に行が無い`);
    continue;
  }
  if (p.options) {
    // 選択肢が多い行は、別の表へ逃がして「下の13種」と書いてある。逃がしている
    // 行は本文ぜんたいから探す。逃がしていない行は、その行の中に無ければ落とす
    // （綴りが他の種別の行にあるだけでは、この種別で使えるとは読めない）。
    const away = rows.some((r) => /下の|後述/.test(r));
    const hit = (o) => (away ? doc.includes('`' + o + '`') : rows.some((r) => r.includes(o)));
    const missing = p.options.filter((o) => !hit(o));
    if (missing.length) bad.push(`${p.owner}.${p.key}: 選択肢が抜けている → ${missing.join(' ')}`);
    continue;
  }
  if (p.min === undefined) continue;
  if (!shows(rows, p.min) || !shows(rows, p.max)) {
    bad.push(`${p.owner}.${p.key}: 現物は ${p.min}〜${p.max} / 説明書は ${rows[0].trim()}`);
  }
}

// 値域を持たない語。種別の取りこぼしがここで出る（表がパラメータ定義に無いので、
// 上の網では拾えない。実際に BELL がこの穴から抜けた）。
for (const [key, want] of Object.entries(live.words)) {
  const rows = rowsFor(key);
  if (!rows.length) {
    bad.push(`${key}: 表に行が無い`);
    continue;
  }
  const missing = want.filter((w) => !rows.some((r) => r.includes('`' + w + '`')));
  if (missing.length) bad.push(`${key}: 表に載っていない → ${missing.join(' ')}`);
}

for (const s of live.scales) {
  if (!doc.includes('`' + s + '`')) bad.push(`音階 ${s}: 説明書に無い`);
}
for (const r of live.roots) {
  if (!doc.includes('`' + r + '`')) bad.push(`ルート ${r}: 説明書に無い`);
}
for (const V of live.words.type) {
  // 種別ごとの節があるか。表に名前だけあって節が無いと、AI は使い方を知らない。
  if (!new RegExp('^###\\s.*`' + V + '`', 'm').test(doc)) bad.push(`種別 ${V}: 専用の節が無い`);
}
if (!doc.includes(String(live.maxVoices))) bad.push(`同時発音 ${live.maxVoices} 点: 説明書に無い`);

const n = live.params.length + Object.keys(live.words).length + live.scales.length + live.roots.length;
if (bad.length) {
  console.error(`${DOC} が現物と食い違っている（${n} 項目を照合）:\n` + bad.map((b) => '  - ' + b).join('\n'));
  process.exit(1);
}
console.log(`${DOC} は現物と一致（${n} 項目を照合）`);
