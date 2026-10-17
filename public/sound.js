// 効果音（Web Audio でその場で合成。音声ファイルは使わない）
//
// 気持ちよさのために決めていること:
// - すぐ鳴らす：操作から音までの遅れは数十msでも気づかれるため、入力と同じタイミングで鳴らす。
// - 協和する音だけを使う：倍音が整数倍に並ぶ音（サイン波＋弱い倍音）と、
//   どの組み合わせでも濁らないメジャー・ペンタトニック（ド・レ・ミ・ソ・ラ）に限る。
// - 刺さる帯域を削る：不快さに最も効く 2〜4kHz を避け、基音を低めにし、全体にローパスをかける。
// - うなりを作らない：同時に鳴らす音をわずかにずらす「デチューン」はせず、ざらつきを避ける。
// - 達成感を音程で伝える：大きい数字ができるほど、また連続で合体するほど音が上がる。ただし上がりすぎは
//   耳障りなので上限を設け、間が空いたらリセットする。
// - 聞き飽きさせない：合体音などよく鳴る音は毎回わずかに音程を揺らす。補充やベスト更新の
//   「ごほうび」の音は毎回同じにして、覚えられる合図にする。
// - 失敗は責めない：動かせないときは、低く柔らかい下降2音を短く鳴らすだけにする。
(function (root) {
  'use strict';

  const MUTE_KEY = 'pegblock-muted';
  const PENTA = [0, 2, 4, 7, 9];
  const BASE = 392; // G4。ここからペンタトニックで上がっていく

  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* 保存できない環境 */ }

  function ensure() {
    if (muted) return false;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' });
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 2600;
      lowpass.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(lowpass).connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // ペンタトニックの step 番目の音（5音ごとに1オクターブ上がる）
  function penta(step) {
    const oct = Math.floor(step / 5);
    const i = ((step % 5) + 5) % 5;
    return BASE * Math.pow(2, (oct * 12 + PENTA[i]) / 12);
  }

  // ±cents だけ音程を揺らす
  function wobble(freq, cents) {
    return freq * Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200);
  }

  // 1音。partials は [倍数, 音量比] の並び（整数倍＝協和する倍音）
  function tone(freq, opts = {}) {
    const {
      at = 0, dur = 0.3, gain = 0.25, attack = 0.005, type = 'sine',
      partials = [[1, 1]], glideTo = null, glideTime = 0.08,
    } = opts;
    const t0 = ctx.currentTime + at;
    for (const [mult, amp] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * mult, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo * mult, t0 + glideTime);
      // 上の倍音ほど早く消える（鉄琴やマリンバのような丸い減衰）
      const d = dur / Math.sqrt(mult);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain * amp, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + d + 0.05);
    }
  }

  const BELL = [[1, 1], [2, 0.35], [3, 0.12], [4, 0.06]];
  const SOFT = [[1, 1], [2, 0.15]];

  const Sound = {
    unlock() { ensure(); },

    get muted() { return muted; },
    setMuted(v) {
      muted = v;
      try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* 無視 */ }
      if (ctx) (v ? ctx.suspend() : ctx.resume());
    },

    // 玉を選んだ：小さく上がる「ぽっ」
    select() {
      if (!ensure()) return;
      tone(wobble(440, 25), { dur: 0.09, gain: 0.16, glideTo: 660, glideTime: 0.05, partials: SOFT });
    },

    // 合体：着地の軽い「とん」＋ 上がる2音のベル。level は log2(できた数字)、combo は連続回数
    merge(level, combo) {
      if (!ensure()) return;
      tone(150, { dur: 0.12, gain: 0.22, glideTo: 70, glideTime: 0.1, partials: SOFT });
      const step = Math.min(level - 2 + Math.min(combo, 5), 11);
      const f1 = wobble(penta(step), 8);
      const f2 = wobble(penta(step + 2), 8);
      tone(f1, { at: 0.0, dur: 0.35, gain: 0.2, partials: BELL });
      tone(f2, { at: 0.07, dur: 0.5, gain: 0.22, partials: BELL });
    },

    // 補充：ブロックが落ちる間隔に合わせて上がるアルペジオ（毎回同じ＝覚えられる合図）
    refill(count, stagger) {
      if (!ensure()) return;
      const steps = [5, 7, 8, 9, 10, 12];
      for (let i = 0; i < count; i++) {
        tone(penta(steps[i % steps.length] + 5 * Math.floor(i / steps.length) - 2), {
          at: 0.05 + (i * stagger) / 1000, dur: 0.28, gain: 0.13, partials: BELL,
        });
      }
    },

    // 動かせない：低く柔らかい下降2音
    error() {
      if (!ensure()) return;
      tone(330, { dur: 0.12, gain: 0.13, partials: SOFT });
      tone(262, { at: 0.09, dur: 0.16, gain: 0.13, partials: SOFT });
    },

    // 玉が小さく弾んで盤に当たる「こつ」。strength は 0〜1（弾むたびに小さくなる）
    tick(strength) {
      if (!ensure()) return;
      const k = Math.max(0.15, Math.min(1, strength));
      tone(wobble(880, 30), { dur: 0.05, gain: 0.1 * k, partials: SOFT });
      tone(180, { dur: 0.06, gain: 0.12 * k, glideTo: 110, glideTime: 0.05, partials: SOFT });
    },

    // 新しいゲーム：ド・ミ・ソ
    start() {
      if (!ensure()) return;
      [0, 2, 3].forEach((s, i) => tone(penta(s + 5) / 1.5, { at: i * 0.07, dur: 0.3, gain: 0.14, partials: BELL }));
    },

    // 終了：ゆっくり下りて主音（ド）で落ち着く。責めない終わり方
    gameOver() {
      if (!ensure()) return;
      [8, 7, 6, 5].forEach((s, i) => tone(penta(s) / 1.5, { at: i * 0.16, dur: 0.6, gain: 0.14, partials: BELL }));
    },

    // ベスト更新：明るい和音で締める
    best() {
      if (!ensure()) return;
      [5, 7, 8, 10].forEach((s, i) => tone(penta(s) / 1.5, { at: 0.75 + i * 0.09, dur: 0.6, gain: 0.14, partials: BELL }));
      [5, 7, 8].forEach((s) => tone(penta(s) / 1.5, { at: 0.75 + 0.4, dur: 1.1, gain: 0.09, partials: BELL }));
    },
  };

  root.Sound = Sound;
})(typeof self !== 'undefined' ? self : this);
