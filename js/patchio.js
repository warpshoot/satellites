// パッチの持ち出しと持ち込み。文字列にして渡すだけで、外部ライブラリは使わない。
//
// リンクは #p=<タグ><base64url>。タグは圧縮の有無:
//   d = deflate-raw（CompressionStream がある環境）
//   r = 生の JSON
// 圧縮できない環境でも読めるように、タグで分岐する。

const B64_CHUNK = 0x8000;

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('この環境では展開できない');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePatch(patch) {
  const bytes = new TextEncoder().encode(JSON.stringify(patch));
  const packed = await deflate(bytes);
  return packed && packed.length < bytes.length ? 'd' + toB64url(packed) : 'r' + toB64url(bytes);
}

export async function decodePatch(code) {
  const tag = code[0];
  const bytes = fromB64url(code.slice(1));
  const raw = tag === 'd' ? await inflate(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

export async function patchLink(patch) {
  const code = await encodePatch(patch);
  const base = location.href.split('#')[0];
  return base + '#p=' + code;
}

export function patchText(patch) {
  return JSON.stringify(patch);
}

// 貼り付けられた文字列を受ける。リンクでも、JSON そのままでも、どちらでも読む。
export async function parseIncoming(text) {
  const s = (text || '').trim();
  if (!s) throw new Error('からっぽ');
  const m = s.match(/#p=([A-Za-z0-9\-_]+)/);
  if (m) return decodePatch(m[1]);
  if (s[0] === '{') return JSON.parse(s);
  if (/^[dr][A-Za-z0-9\-_]+$/.test(s)) return decodePatch(s);
  throw new Error('読めない文字列');
}

// ---- ファイル --------------------------------------------------------
// 置き場所はブラウザに任せる。File System Access API は iOS に無いので使わない。

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

export function patchFilename(patch) {
  const n = (patch && patch.voices && patch.voices.length) || 0;
  return 'satellites-' + stamp() + '-' + n + 'stars.json';
}

// 読みやすさを優先して整形して書き出す。手で開いて直せるほうがファイルらしい。
export function savePatchFile(patch) {
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = patchFilename(patch);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 即 revoke すると保存前に切れる端末がある
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

export function readPatchFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        resolve(JSON.parse(String(fr.result)));
      } catch (e) {
        reject(new Error('JSON として読めない'));
      }
    };
    fr.onerror = () => reject(new Error('ファイルを読めない'));
    fr.readAsText(file);
  });
}

// クリップボードは環境で落ちる。失敗したら呼んだ側が手で選ばせる。
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 次の手を試す */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}
