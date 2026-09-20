// はじめから入っている配置。
//
// 音作りの知識が無い人にも、少し DTM をやる人にも、一番速く伝わるのは
// 「完成したものを先に鳴らして、あとから分解させる」こと。説明より速い。
// 形式は保存・リンクと同じ version 3 なので、読み込みは同じ関門を通せる。

function v(type, x, y, over) {
  return Object.assign({ type, x, y, orbit: false }, over || {});
}

export const PRESETS = [
  {
    name: '夜明け',
    patch: {
      version: 3,
      master: {
        gain: 0.8,
        tuning: { root: 'D', scale: 'pentaMinor' },
        reverb: { length: 8, decay: 2.2 },
        delay: { time: 620, feedback: 0.4, sync: true },
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        // 土台は近くに置いて動かさない。ここが揺れると全部が波打つ。
        v('drone', 0.5, 0.62, {
          vol: 0.9,
          common: { attack: 12, release: 8, drift: 0.35, reverbSend: 0.35, delaySend: 0.05 },
          params: { freq: 73, count: 4, detune: 7, wave: 'triangle', width: 0.7 }
        }),
        v('drone', 0.5, 0.42, {
          vol: 0.6,
          common: { attack: 16, release: 8, drift: 0.5, reverbSend: 0.55, delaySend: 0.1 },
          params: { freq: 220, count: 3, detune: 14, wave: 'sine', width: 0.9 }
        }),
        // 息。遠くをゆっくり回らせて、近づくたびに風向きが変わって聞こえる
        v('noise', 0.5, 0.5, {
          vol: 0.5, orbit: true, orbitPeriod: 240, orbitRadius: 0.42,
          orbitEcc: 0.5, orbitAngle: 30, orbitIncl: 35,
          common: { attack: 14, release: 8, drift: 0.6, reverbSend: 0.8, delaySend: 0.1 },
          params: { center: 1400, q: 1.2, swellDepth: 0.5, swellRate: 0.07, width: 0.95 }
        }),
        // 弾く形の粒をまばらに。これだけが拍を作る
        v('grain', 0.5, 0.5, {
          vol: 0.7, orbit: true, orbitPeriod: 95, orbitRadius: 0.26,
          orbitEcc: 0.4, orbitAngle: 200, orbitIncl: 60,
          common: { attack: 8, release: 6, drift: 0.4, reverbSend: 0.7, delaySend: 0.45 },
          params: { interval: 3.5, jitter: 70, grainLen: 260, shape: 0.9, center: 880, spread: 1400, wave: 'sine', width: 0.8 }
        })
      ]
    }
  },
  {
    name: '鐘楼',
    patch: {
      version: 3,
      master: {
        gain: 0.78,
        tuning: { root: 'A', scale: 'inSen' },
        reverb: { length: 13, decay: 1.6 },
        delay: { time: 900, feedback: 0.5, sync: false },
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        v('bell', 0.5, 0.5, {
          vol: 0.85, orbit: true, orbitPeriod: 150, orbitRadius: 0.2,
          orbitEcc: 0.55, orbitAngle: 0, orbitIncl: 70,
          common: { attack: 3, release: 8, drift: 0.4, reverbSend: 0.8, delaySend: 0.3 },
          params: { interval: 6, jitter: 80, center: 520, spread: 1900, ratio: '2.76', index: 2.4, decay: 8, width: 0.7 }
        }),
        v('bell', 0.5, 0.5, {
          vol: 0.55, orbit: true, orbitPeriod: 420, orbitRadius: 0.55,
          orbitEcc: 0.2, orbitAngle: 120, orbitIncl: 20,
          common: { attack: 6, release: 8, drift: 0.6, reverbSend: 1, delaySend: 0.5 },
          params: { interval: 13, jitter: 90, center: 1200, spread: 2400, ratio: '3.5', index: 4.5, decay: 11, width: 1 }
        }),
        // 鐘だけだと足元が無い。低いところに1本だけ敷く
        v('drone', 0.5, 0.68, {
          vol: 0.62,
          common: { attack: 20, release: 10, drift: 0.3, reverbSend: 0.45, delaySend: 0 },
          params: { freq: 55, count: 3, detune: 4, wave: 'sine', width: 0.5 }
        }),
        v('noise', 0.28, 0.3, {
          vol: 0.3,
          common: { attack: 18, release: 8, drift: 0.7, reverbSend: 0.9, delaySend: 0.1 },
          params: { center: 5200, q: 0.8, swellDepth: 0.6, swellRate: 0.04, width: 1 }
        })
      ]
    }
  },
  {
    name: '潮',
    patch: {
      version: 3,
      master: {
        gain: 0.82,
        tuning: { root: 'C', scale: 'off' },
        reverb: { length: 6.5, decay: 3.2 },
        delay: { time: 300, feedback: 0.25, sync: true },
        pulse: true, sky: 'none', follow: false
      },
      voices: [
        // つぶれた軌道。近日点で寄って大きく鳴り、遠日点で風呂場の奥へ退く
        v('noise', 0.5, 0.5, {
          vol: 0.85, orbit: true, orbitPeriod: 42, orbitRadius: 0.4,
          orbitEcc: 0.78, orbitAngle: 0, orbitIncl: 15,
          common: { attack: 6, release: 6, drift: 0.55, reverbSend: 0.6, delaySend: 0.15 },
          params: { center: 620, q: 0.9, swellDepth: 0.7, swellRate: 0.11, width: 1 }
        }),
        v('noise', 0.5, 0.5, {
          vol: 0.6, orbit: true, orbitPeriod: 67, orbitRadius: 0.3,
          orbitEcc: 0.7, orbitAngle: 180, orbitIncl: 80,
          common: { attack: 9, release: 6, drift: 0.8, reverbSend: 0.75, delaySend: 0.2 },
          params: { center: 3400, q: 3.5, swellDepth: 0.85, swellRate: 0.23, width: 0.9 }
        }),
        // 吸う形の粒。立ち上がりが遅いので、波が引く音に聞こえる
        v('grain', 0.5, 0.5, {
          vol: 0.55, orbit: true, orbitPeriod: 130, orbitRadius: 0.48,
          orbitEcc: 0.3, orbitAngle: 90, orbitIncl: 45,
          common: { attack: 10, release: 6, drift: 0.5, reverbSend: 0.85, delaySend: 0.25 },
          params: { interval: 2.2, jitter: 85, grainLen: 900, shape: 0.05, center: 300, spread: 900, wave: 'noise', width: 1 }
        }),
        v('drone', 0.44, 0.72, {
          vol: 0.5,
          common: { attack: 14, release: 8, drift: 0.4, reverbSend: 0.4, delaySend: 0 },
          params: { freq: 49, count: 2, detune: 3, wave: 'triangle', width: 0.4 }
        })
      ]
    }
  },
  {
    name: '地鳴り',
    patch: {
      version: 3,
      master: {
        gain: 0.7,
        tuning: { root: 'E', scale: 'fifths' },
        reverb: { length: 4, decay: 4.5 },
        delay: { time: 180, feedback: 0.6, sync: true },
        burn: 0.45,
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        v('drive', 0.5, 0.78, {
          vol: 1,
          common: { attack: 8, release: 6, drift: 0.5, reverbSend: 0.2, delaySend: 0.1 },
          params: { freq: 41, drive: 0.62, filterPos: 'post', swellRate: 0.05, swellDepth: 22 }
        }),
        v('drive', 0.5, 0.5, {
          vol: 0.75, orbit: true, orbitPeriod: 28, orbitRadius: 0.24,
          orbitEcc: 0.6, orbitAngle: 45, orbitIncl: 85,
          common: { attack: 10, release: 6, drift: 0.7, reverbSend: 0.5, delaySend: 0.35 },
          params: { freq: 110, drive: 0.85, filterPos: 'pre', swellRate: 0.3, swellDepth: 48 }
        }),
        v('drone', 0.5, 0.6, {
          vol: 0.75,
          common: { attack: 16, release: 8, drift: 0.45, reverbSend: 0.35, delaySend: 0 },
          params: { freq: 82, count: 5, detune: 26, wave: 'sawtooth', width: 1 }
        }),
        // Q を上げたノイズは、もう質感ではなく音程として鳴る
        v('noise', 0.5, 0.5, {
          vol: 0.55, orbit: true, orbitPeriod: 190, orbitRadius: 0.6,
          orbitEcc: 0.15, orbitAngle: 270, orbitIncl: 40,
          common: { attack: 12, release: 8, drift: 0.9, reverbSend: 0.9, delaySend: 0.2 },
          params: { center: 165, q: 46, swellDepth: 0.4, swellRate: 0.5, width: 0.8 }
        })
      ]
    }
  },
  {
    // 軌道に同期させた発音だけで組む。周期 23 / 31 / 53 秒は噛み合わないので、
    // 3 本の打点が揃うのは 6 時間に一度しかない。間隔のノブでは作れない模様。
    name: '時計',
    patch: {
      version: 3,
      master: {
        gain: 0.8,
        // 転調を入れてある。5 分ほどで調が動くので、同じ模様のまま景色が変わる。
        tuning: { root: 'A', scale: 'dorian', drift: 0.5 },
        reverb: { length: 9, decay: 2.0 },
        // トーンを絞って、ゆれを入れるとテープのエコーになる
        delay: { time: 700, feedback: 0.45, sync: true, tone: 0.28, wow: 0.45 },
        burn: 0.12,
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        // 1周に3回。つぶれた軌道なので、刻み目のうち2つは近点で鳴る
        v('pluck', 0.5, 0.5, {
          vol: 0.85, orbit: true, orbitPeriod: 23, orbitRadius: 0.24,
          orbitEcc: 0.5, orbitAngle: 0, orbitIncl: 25,
          common: { attack: 4, release: 6, drift: 0.3, tone: 0.15, reverbSend: 0.55, delaySend: 0.35 },
          params: { interval: 3, jitter: 25, center: 294, spread: 1200, decay: 4,
            damp: 0.4, pick: 0.18, width: 0.7, trigger: 'orbit', hits: 3 }
        }),
        // 1周に5回。こちらは逆行させて、追い越しが左右で分かるようにする
        v('pluck', 0.5, 0.5, {
          vol: 0.6, orbit: true, orbitPeriod: 31, orbitRadius: 0.4,
          orbitEcc: 0.25, orbitAngle: 110, orbitIncl: 55, orbitDir: 'retrograde',
          common: { attack: 6, release: 6, drift: 0.45, tone: -0.2, reverbSend: 0.75, delaySend: 0.2 },
          params: { interval: 3, jitter: 40, center: 147, spread: 700, decay: 6,
            damp: 0.7, pick: 0.42, width: 0.9, trigger: 'orbit', hits: 5 }
        }),
        // 1周に2回。遅い軌道の近点でだけ鳴るので、たまにしか来ない
        v('bell', 0.5, 0.5, {
          vol: 0.5, orbit: true, orbitPeriod: 53, orbitRadius: 0.62,
          orbitEcc: 0.65, orbitAngle: 230, orbitIncl: 70,
          common: { attack: 8, release: 8, drift: 0.5, tone: 0.3, reverbSend: 1, delaySend: 0.45 },
          params: { interval: 6, jitter: 30, center: 1170, spread: 1400, ratio: '2.76',
            index: 2.2, decay: 9, width: 0.8, trigger: 'orbit', hits: 2 }
        }),
        // 土台。ここが動くと打点の噛み合いが聞こえなくなるので、止めて暗く敷く
        v('drone', 0.5, 0.66, {
          vol: 0.72,
          common: { attack: 18, release: 10, drift: 0.35, tone: -0.35, reverbSend: 0.3, delaySend: 0 },
          params: { freq: 73, count: 3, detune: 9, wave: 'triangle', width: 0.6 }
        }),
        v('noise', 0.5, 0.5, {
          vol: 0.32, orbit: true, orbitPeriod: 310, orbitRadius: 0.5,
          orbitEcc: 0.4, orbitAngle: 60, orbitIncl: 45,
          common: { attack: 20, release: 8, drift: 0.8, tone: 0.25, reverbSend: 0.95, delaySend: 0.1 },
          params: { center: 4200, q: 1.4, swellDepth: 0.55, swellRate: 0.05, width: 1 }
        })
      ]
    }
  }
];
