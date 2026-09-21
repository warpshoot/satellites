// はじめから入っている配置。
//
// 音作りの知識が無い人にも、少し DTM をやる人にも、一番速く伝わるのは
// 「完成したものを先に鳴らして、あとから分解させる」こと。説明より速い。
// 形式は保存・リンクと同じ version 3 なので、読み込みは同じ関門を通せる。
//
// 5つで示したいのは「色々作れる」ことそのもの。だから5つが同じレシピを
// 使わないように、**性格の軸をずらして**選んである。
//
//   合唱  止まった和音・12点の分業     長調   厚い   起伏が小さい
//   白昼  高い音域・低音なし           リディア  明るい
//   砂    粒の密度が音色になる         なし（素通し）  ざらつき
//   点呼  正確な反復・短い減衰         単音   点が立つ
//   時計  軌道に同期した発音・転調     ドリア  起伏が大きい
//
// 前の5つは、どれも「止まった DRONE の土台 + NOISE の質感 + 主役1〜2」の
// 4〜5点で、アタック3秒以上・減衰4秒以上・ばらつき25%以上に固まっていた。
// 音色は散っていても、音楽としては同じ曲を5回弾いていたので組み直した。
//
// 音量は揃える。押し比べる道具なのに鳴る大きさが違うと、一番大きいものが
// 一番良い音に聞こえてしまう（作り直す前は 90 秒平均で 6.5dB 開いていた）。
// 測るのは masterGain の後ろ。リミッタから取るとマスター音量が効いていない
// 値を読むので、トリムを当てても数字が動かない。

function v(type, x, y, over) {
  return Object.assign({ type, x, y, orbit: false }, over || {});
}

export const PRESETS = [
  {
    // 上限いっぱいまで置いて、1点に1つずつ役を持たせる。枠を 12 に開けたのは
    // 厚く重ねるためではなくこれをやるためなので、実演をひとつ置いておく。
    // 音程は全体で1組なので、DRONE を別の音度に置くだけで和音になる。
    name: '合唱',
    patch: {
      version: 3,
      master: {
        gain: 0.62,
        // ゆっくりだけ転調する。和音の形は変わらないまま、調だけ移る。
        tuning: { root: 'C', scale: 'major', drift: 0.15 },
        reverb: { length: 12, decay: 2.0 },
        delay: { time: 900, feedback: 0.3, sync: false, tone: 0.4, wow: 0.15 },
        burn: 0.3,
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        // 和音。下から C2 / G2 / C3 / E3 / G3。縦位置で明暗も分ける。
        v('drone', 0.5, 0.74, {
          vol: 0.72,
          common: { attack: 18, release: 12, drift: 0.25, tone: -0.5, reverbSend: 0.25, delaySend: 0 },
          params: { freq: 65, count: 2, detune: 4, wave: 'sine', width: 0.35 }
        }),
        v('drone', 0.5, 0.66, {
          vol: 0.59,
          common: { attack: 16, release: 10, drift: 0.3, tone: -0.3, reverbSend: 0.35, delaySend: 0 },
          params: { freq: 98, count: 2, detune: 7, wave: 'triangle', width: 0.6 }
        }),
        v('drone', 0.5, 0.58, {
          vol: 0.51,
          common: { attack: 20, release: 10, drift: 0.4, tone: -0.15, reverbSend: 0.45, delaySend: 0.05 },
          params: { freq: 131, count: 3, detune: 11, wave: 'triangle', width: 0.8 }
        }),
        v('drone', 0.36, 0.5, {
          vol: 0.42,
          common: { attack: 14, release: 10, drift: 0.5, reverbSend: 0.55, delaySend: 0.05 },
          params: { freq: 165, count: 2, detune: 18, wave: 'sine', width: 0.9 }
        }),
        // 1本だけユニゾン無し・デチューン 0・幅 0。厚い中に細い線が1本通る。
        // 見た目も変えてある（同じ種別でも選び直せる、という実演）。
        v('drone', 0.64, 0.42, {
          vol: 0.36, look: 'binary',
          common: { attack: 12, release: 8, drift: 0.2, tone: 0.1, reverbSend: 0.5, delaySend: 0.1 },
          params: { freq: 196, count: 1, detune: 0, wave: 'sine', width: 0 }
        }),
        // 一番下。軽く歪ませて、和音の足元だけ濁らせる。
        v('drive', 0.5, 0.82, {
          vol: 0.47,
          common: { attack: 12, release: 10, drift: 0.3, tone: -0.6, reverbSend: 0.2, delaySend: 0 },
          params: { freq: 33, drive: 0.28, filterPos: 'post', swellRate: 0.03, swellDepth: 6 }
        }),
        // Q を上げたノイズは質感ではなく音程として鳴る。和音の一員に混ぜてある。
        v('noise', 0.5, 0.5, {
          vol: 0.34, orbit: true, orbitPeriod: 150, orbitRadius: 0.3,
          orbitEcc: 0.2, orbitAngle: 40, orbitIncl: 30,
          common: { attack: 12, release: 8, drift: 0.5, tone: 0.1, reverbSend: 0.7, delaySend: 0.15 },
          params: { center: 523, q: 70, swellDepth: 0.25, swellRate: 0.06, width: 0.5 }
        }),
        // 空気。一番外側を一番遅く回る。
        v('noise', 0.5, 0.5, {
          vol: 0.26, orbit: true, orbitPeriod: 520, orbitRadius: 0.72,
          orbitEcc: 0.3, orbitAngle: 210, orbitIncl: 60,
          common: { attack: 20, release: 8, drift: 0.8, tone: 0.3, reverbSend: 0.95, delaySend: 0.1 },
          params: { center: 8200, q: 0.7, swellDepth: 0.45, swellRate: 0.09, width: 1 }
        }),
        v('grain', 0.5, 0.5, {
          vol: 0.38, orbit: true, orbitPeriod: 70, orbitRadius: 0.44,
          orbitEcc: 0.45, orbitAngle: 300, orbitIncl: 50,
          common: { attack: 8, release: 6, drift: 0.45, tone: 0.2, reverbSend: 0.8, delaySend: 0.4 },
          params: { interval: 2.6, jitter: 60, grainLen: 180, shape: 0.85, center: 1560, spread: 1200, wave: 'triangle', width: 0.85 }
        }),
        // 1周に1回だけ。つぶれた軌道の近点で鳴るので、3分に1回しか来ない。
        v('bell', 0.5, 0.5, {
          vol: 0.36, orbit: true, orbitPeriod: 190, orbitRadius: 0.6,
          orbitEcc: 0.6, orbitAngle: 150, orbitIncl: 70,
          common: { attack: 6, release: 8, drift: 0.4, tone: 0.25, reverbSend: 1, delaySend: 0.35 },
          params: { interval: 6, jitter: 20, center: 1046, spread: 200, ratio: '2',
            index: 1.8, decay: 6, width: 0.7, trigger: 'orbit', hits: 1 }
        }),
        v('pluck', 0.5, 0.5, {
          vol: 0.38, orbit: true, orbitPeriod: 44, orbitRadius: 0.34,
          orbitEcc: 0.3, orbitAngle: 80, orbitIncl: 35,
          common: { attack: 3, release: 4, drift: 0.35, reverbSend: 0.6, delaySend: 0.3 },
          params: { interval: 3, jitter: 35, center: 392, spread: 400, decay: 2.4,
            damp: 0.55, pick: 0.12, width: 0.8, trigger: 'orbit', hits: 2 }
        }),
        // 吸う形の長い粒。低いところで和音のあいだを埋める。
        v('grain', 0.5, 0.5, {
          vol: 0.34, orbit: true, orbitPeriod: 240, orbitRadius: 0.5,
          orbitEcc: 0.75, orbitAngle: 340, orbitIncl: 20,
          common: { attack: 12, release: 8, drift: 0.55, tone: -0.4, reverbSend: 0.6, delaySend: 0.15 },
          params: { interval: 5.5, jitter: 75, grainLen: 700, shape: 0.15, center: 262, spread: 300, wave: 'sawtooth', width: 0.5 }
        })
      ]
    }
  },
  {
    // 低いところに何も置かない配置。核の近く（＝明るい側）に寄せて、
    // 音階も増4度の入るものにしてある。暗い配置しか作れない道具に見せない。
    name: '白昼',
    patch: {
      version: 3,
      master: {
        gain: 1,
        tuning: { root: 'D', scale: 'lydian', drift: 0 },
        reverb: { length: 11, decay: 1.8 },
        delay: { time: 480, feedback: 0.42, sync: false, tone: 0.85, wow: 0.2 },
        burn: 0,
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        // 土台も高いところに置く。ここを 50Hz 台にすると配置の性格が消える。
        v('drone', 0.5, 0.34, {
          vol: 0.6,
          common: { attack: 12, release: 8, drift: 0.35, tone: 0.2, reverbSend: 0.5, delaySend: 0.05 },
          params: { freq: 392, count: 2, detune: 6, wave: 'sine', width: 0.75 }
        }),
        // ピッチ幅を絞った鐘。跳ばないので旋律ではなく点として並ぶ。
        v('bell', 0.5, 0.5, {
          vol: 0.55, orbit: true, orbitPeriod: 64, orbitRadius: 0.3,
          orbitEcc: 0.35, orbitAngle: 20, orbitIncl: 40,
          common: { attack: 2, release: 5, drift: 0.4, tone: 0.45, reverbSend: 0.75, delaySend: 0.4 },
          params: { interval: 4.5, jitter: 45, center: 1850, spread: 300, ratio: '1.41',
            index: 1.6, decay: 2.5, width: 0.65, trigger: 'free', hits: 2 }
        }),
        v('grain', 0.5, 0.5, {
          vol: 0.45, orbit: true, orbitPeriod: 110, orbitRadius: 0.5,
          orbitEcc: 0.25, orbitAngle: 250, orbitIncl: 25,
          common: { attack: 5, release: 4, drift: 0.5, tone: 0.55, reverbSend: 0.85, delaySend: 0.3 },
          params: { interval: 1.1, jitter: 55, grainLen: 120, shape: 0.72, center: 3200, spread: 1100, wave: 'triangle', width: 1 }
        }),
        // 速いトレモロ。ゆっくり息をするのとは別の揺れ方になる。
        v('noise', 0.5, 0.5, {
          vol: 0.3, orbit: true, orbitPeriod: 34, orbitRadius: 0.62,
          orbitEcc: 0.5, orbitAngle: 120, orbitIncl: 75,
          common: { attack: 8, release: 6, drift: 0.7, tone: 0.35, reverbSend: 0.9, delaySend: 0.1 },
          params: { center: 9500, q: 0.7, swellDepth: 0.3, swellRate: 0.9, width: 1 }
        })
      ]
    }
  },
  {
    // 粒を 1 秒に 8〜14 個撒くと、粒の連なりが1つの持続音として聞こえる。
    // 間隔のノブは 0.05 秒まで下りるのに、ここを使った配置が無かった。
    // 音量は密度で割ってあるので（GRAIN の _density）、詰めても土台は凹まない。
    name: '砂',
    patch: {
      version: 3,
      master: {
        gain: 0.4,
        // 吸着なし。1粒ごとの音程が素通りするので、音階ではなく帯として鳴る。
        tuning: { root: 'F', scale: 'off', drift: 0 },
        reverb: { length: 4.5, decay: 2.8 },
        delay: { time: 260, feedback: 0.72, sync: false, tone: 0.7, wow: 0.3 },
        burn: 0.22,
        pulse: true, sky: 'none', follow: false
      },
      voices: [
        // 正円・ばらつき 8%・幅 0.25。正確に細く、真ん中で鳴り続ける。
        // 正円は核からの距離が変わらないので音量は動かない。傾斜のぶんだけ、
        // にじみと前後が動く。
        v('grain', 0.5, 0.5, {
          vol: 0.31, orbit: true, orbitPeriod: 18, orbitRadius: 0.28,
          orbitEcc: 0, orbitAngle: 0, orbitIncl: 20, look: 'band',
          common: { attack: 0.5, release: 1.8, drift: 0.45, tone: 0.15, reverbSend: 0.5, delaySend: 0.2 },
          params: { interval: 0.07, jitter: 8, grainLen: 45, shape: 0.5, center: 2100, spread: 250, wave: 'sawtooth', width: 0.25 }
        }),
        // もう一枚、遅くて広くて低いほうを重ねる。2枚で奥行きが出る。
        v('grain', 0.5, 0.5, {
          vol: 0.28, orbit: true, orbitPeriod: 47, orbitRadius: 0.45,
          orbitEcc: 0.4, orbitAngle: 200, orbitIncl: 65,
          common: { attack: 1.2, release: 3, drift: 0.6, reverbSend: 0.7, delaySend: 0.15 },
          params: { interval: 0.13, jitter: 22, grainLen: 80, shape: 0.25, center: 620, spread: 700, wave: 'noise', width: 0.95 }
        }),
        // 歪みは浅く。DRIVE を「軽く潰した土台」として使う例がひとつも無かった。
        v('drive', 0.5, 0.76, {
          vol: 0.35,
          common: { attack: 7, release: 6, drift: 0.3, tone: -0.45, reverbSend: 0.2, delaySend: 0 },
          params: { freq: 44, drive: 0.12, filterPos: 'post', swellRate: 0.04, swellDepth: 8 }
        })
      ]
    }
  },
  {
    // ばらつき 0・ピッチ幅 0・正円で、同じ音程が正確な間隔で戻ってくる。
    // 減衰を 1 秒以下に詰めると、点が伸びずに立つ。
    // 時計（まばら・不揃い）の対極として置いてある。
    name: '点呼',
    patch: {
      version: 3,
      master: {
        gain: 1,
        // 単音。全部が同じ音度へ吸い付くので、音程の話が消えて律だけが残る。
        tuning: { root: 'G', scale: 'unison', drift: 0 },
        // 小さい部屋。尾が短いほうが、点が点として聞こえる。
        reverb: { length: 1.3, decay: 4.2 },
        delay: { time: 340, feedback: 0.25, sync: false, tone: 0.8, wow: 0 },
        burn: 0,
        pulse: true, sky: 'none', follow: false
      },
      voices: [
        // 周期 9 秒を 8 分割。1.125 秒ごとに、誤差なしで戻ってくる。
        v('pluck', 0.5, 0.5, {
          vol: 0.84, orbit: true, orbitPeriod: 9, orbitRadius: 0.26,
          orbitEcc: 0, orbitAngle: 0, orbitIncl: 15,
          common: { attack: 0.15, release: 1.5, drift: 0.15, tone: 0.1, reverbSend: 0.35, delaySend: 0.25 },
          params: { interval: 3, jitter: 0, center: 392, spread: 0, decay: 0.7,
            damp: 0.85, pick: 0.06, width: 0.35, trigger: 'orbit', hits: 8 }
        }),
        // 周期 21 秒を 3 分割。7 秒ごと。1.125 秒の列と噛み合うのは 63 秒ごと。
        v('bell', 0.5, 0.5, {
          vol: 0.53, orbit: true, orbitPeriod: 21, orbitRadius: 0.42,
          orbitEcc: 0, orbitAngle: 90, orbitIncl: 45,
          common: { attack: 0.6, release: 2, drift: 0.2, tone: 0.3, reverbSend: 0.5, delaySend: 0.3 },
          params: { interval: 6, jitter: 0, center: 1568, spread: 0, ratio: '2',
            index: 1.1, decay: 0.5, width: 0.6, trigger: 'orbit', hits: 3 }
        }),
        // ユニゾン1本・デチューン 0・幅 0。厚みのない、細いモノの土台。
        v('drone', 0.5, 0.7, {
          vol: 0.48,
          common: { attack: 4, release: 3, drift: 0.1, tone: -0.55, reverbSend: 0.2, delaySend: 0 },
          params: { freq: 98, count: 1, detune: 0, wave: 'square', width: 0 }
        })
      ]
    }
  },
  {
    // 軌道に同期させた発音だけで組む。打点の間隔は 23/3 = 7.67 秒、
    // 31/5 = 6.2 秒、53/2 = 26.5 秒。3本の最小公倍数は約 10.5 時間で、
    // しかも出発の位相がずれているので厳密には揃わない。
    // 間隔のノブとばらつきでは、この「いつまでも揃わない」は作れない。
    name: '時計',
    patch: {
      version: 3,
      master: {
        gain: 0.9,
        // 転調を入れてある。5 分ほどで調が動くので、同じ模様のまま景色が変わる。
        tuning: { root: 'A', scale: 'dorian', drift: 0.5 },
        reverb: { length: 9, decay: 2.0 },
        // 軌道に同期しているので、鳴っているのは一番速い周回（23 秒）から
        // 割り出した 719ms。下の 720 は、同期を切ったときの値。
        delay: { time: 720, feedback: 0.45, sync: true, tone: 0.28, wow: 0.45 },
        burn: 0.12,
        pulse: true, sky: 'noise', follow: false
      },
      voices: [
        // 1周に3回。刻みの原点は近点なので、3つのうち1つは必ず一番近づいた
        // 瞬間に鳴る。残りの2つは、その前後 120 度の対称な位置。
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
