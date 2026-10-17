// ペグブロックの描画と操作（上から見た盤・スワイプ操作・数字の玉の動き）
//
// 玉は本物のビー玉のように動かす。位置はマス単位（マスの中心が整数 + 0.5）、高さ z もマス単位。
// - 跳ぶ: 重力の放物線で飛び（水平は等速）、着地で反発係数ぶんだけ小さく何度か弾んでから、穴の中で揺れて止まる
// - 取られる: 指でつまみ上げるように持ち上がって消え、着地した玉の数字が2倍になる
// - 補充: 上から落ちてきて弾み、穴に収まる
// 上から見た盤なので、高さは「少し大きく・少し上に・影が離れて薄くなる」で表す（光は左上から）。
(function () {
  'use strict';

  const L = window.PegLogic;
  const S = window.Sound;
  const { SIZE } = L;

  const SAVE_KEY = 'pegblock-save-v4';
  const BEST_KEY = 'pegblock-best-v3';
  const COMBO_WINDOW = 2500;
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  // 物理（単位: マス, ミリ秒）
  const G = 66e-6;            // 重力加速度
  const FLIGHT_MS = 340;      // 2マス跳ぶのにかかる時間
  const RESTITUTION = 0.32;   // 着地の反発係数（盤の穴なのであまり弾まない）
  const MIN_BOUNCE_V = 1.4e-3;
  const WOBBLE = { amp: 0.07, period: 170, decay: 110, dur: 460 }; // 穴の中での揺れ
  const DROP_Z = 2.6;         // 補充の玉が落ちてくる高さ
  const DROP_STAGGER = 60;

  const el = (id) => document.getElementById(id);
  const boardEl = el('board');

  // ---------- 状態 ----------
  let state = L.newGame();
  let best = 0;
  let selected = -1;
  let dests = [];
  let lockedUntil = 0;
  let overShown = false;
  let combo = 0;
  let lastMoveAt = 0;
  let cellPx = 48;

  // ---------- 保存 ----------
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できない環境では無視 */ }
  }
  function save() {
    storageSet(SAVE_KEY, JSON.stringify({ state }));
  }
  function load() {
    best = Number(storageGet(BEST_KEY)) || 0;
    try {
      const data = JSON.parse(storageGet(SAVE_KEY));
      if (data && data.state && Array.isArray(data.state.board) && data.state.board.length === SIZE * SIZE) {
        state = L.cloneState(data.state);
      }
    } catch (e) { /* 壊れたデータは捨てて新規開始 */ }
  }

  // ---------- 盤の組み立て ----------
  const cellEls = new Array(SIZE * SIZE).fill(null);

  for (const i of L.CELLS) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    const d = document.createElement('div');
    d.className = 'cell';
    d.style.setProperty('--r', r);
    d.style.setProperty('--c', c);
    // 十字の外側の角だけ丸める
    const open = (dr, dc) => !L.isCell(r + dr, c + dc);
    if (open(-1, 0) && open(0, -1)) d.classList.add('tl');
    if (open(-1, 0) && open(0, 1)) d.classList.add('tr');
    if (open(1, 0) && open(0, -1)) d.classList.add('bl');
    if (open(1, 0) && open(0, 1)) d.classList.add('br');
    const mark = document.createElement('span');
    mark.className = 'mark';
    d.appendChild(mark);
    boardEl.appendChild(d);
    cellEls[i] = d;
  }

  // 数字の色（CSS の .marble[data-c] から読む）: col = 玉の色、ink = 数字の色
  const colorCache = new Map();
  function paletteOf(v) {
    if (colorCache.has(v)) return colorCache.get(v);
    const probe = document.createElement('div');
    probe.className = 'marble';
    setBallValue({ root: probe, label: document.createElement('span') }, v);
    probe.style.display = 'none';
    boardEl.appendChild(probe);
    const cs = getComputedStyle(probe);
    const pal = { col: cs.getPropertyValue('--col').trim() || '#ffffff', ink: cs.getPropertyValue('--ink').trim() || '#ffffff' };
    probe.remove();
    colorCache.set(v, pal);
    return pal;
  }
  const colorOf = (v) => paletteOf(v).col;

  // ---------- 玉 ----------
  const balls = new Array(SIZE * SIZE).fill(null); // マス -> 玉
  const loose = new Set();                          // マスに属さない玉（取られて消えていく途中）

  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;

  function makeBall(i, v) {
    const root = document.createElement('div');
    root.className = 'marble';
    const shadow = document.createElement('div');
    shadow.className = 'm-shadow';
    const body = document.createElement('div');
    body.className = 'm-body';
    const tex = document.createElement('div');
    tex.className = 'm-tex';
    const label = document.createElement('span');
    label.className = 'm-label';
    body.append(tex, label);
    root.append(shadow, body);
    boardEl.appendChild(root);
    const b = {
      root, shadow, body, tex, label,
      pop: 0,                   // 合体した瞬間にふくらむ量（ばねのように戻る）
      popAt: 0,
      x: colOf(i) + 0.5, y: rowOf(i) + 0.5, z: 0, alpha: 1,
      ox: 0, oy: 0,             // 穴の中での揺れ・押し込みのずれ
      roll: [0, 0],             // 転がった量（模様をずらして回転に見せる）
      hold: 0, holdTarget: 0,   // 選んだときにつまみ上げる高さ
      push: [0, 0], pushTarget: [0, 0],
      motion: null,
    };
    setBallValue(b, v);
    balls[i] = b;
    return b;
  }

  // 数字と色。128 より大きい数字は色を巡回させる（CSS の data-c）
  function setBallValue(b, v) {
    const lvl = Math.round(Math.log2(v));
    b.root.dataset.v = v;
    b.root.dataset.c = ((lvl - 1) % 10) + 1;
    b.label.textContent = v;
    const digits = String(v).length;
    b.root.style.setProperty('--k', digits <= 1 ? 0.5 : digits === 2 ? 0.42 : digits === 3 ? 0.33 : 0.26);
  }

  function clearBalls() {
    for (let i = 0; i < balls.length; i++) {
      if (balls[i]) { balls[i].root.remove(); balls[i] = null; }
    }
    for (const b of loose) b.root.remove();
    loose.clear();
    boardEl.querySelectorAll('.popup').forEach((n) => n.remove());
  }

  function startMotion(b, dur, step, done) {
    b.motion = { start: performance.now(), dur, step, done };
  }

  // 着地のあと何回か弾む高さの列。v は着地の速さ（下向き）
  function bounceTrack(v) {
    const segs = [];
    let t = 0;
    let u = v * RESTITUTION;
    while (u > MIN_BOUNCE_V) {
      const d = (2 * u) / G;
      segs.push({ t, d, v: u });
      t += d;
      u *= RESTITUTION;
    }
    return {
      segs,
      dur: t,
      z(tau) {
        for (const s of segs) {
          if (tau < s.t + s.d) { const k = tau - s.t; return Math.max(0, s.v * k - 0.5 * G * k * k); }
        }
        return 0;
      },
    };
  }

  // 穴のくぼみの中で転がって揺れ、止まる（減衰する振動）
  function wobble(tau, amp) {
    return amp * Math.exp(-tau / WOBBLE.decay) * Math.sin((2 * Math.PI * tau) / WOBBLE.period);
  }

  // 落ちてきて弾み、穴に収まる（補充・ゲーム開始）
  function dropIn(b, delay, z0, onLand) {
    const fall = Math.sqrt((2 * z0) / G);
    const track = bounceTrack(G * fall);
    const dir = Math.random() * Math.PI * 2;
    const wx = Math.cos(dir), wy = Math.sin(dir);
    b.z = z0;
    b.alpha = 0;
    let landed = false;
    startMotion(b, delay + fall + track.dur + WOBBLE.dur, (t) => {
      const tau = t - delay;
      if (tau < 0) { b.alpha = 0; return; }
      if (tau < fall) {
        b.z = z0 - 0.5 * G * tau * tau;
        b.alpha = Math.min(1, tau / (fall * 0.35));
        return;
      }
      if (!landed) { landed = true; if (onLand) onLand(); }
      b.alpha = 1;
      const tb = tau - fall;
      b.z = track.z(tb);
      const tw = tb - track.dur;
      const w = tw > 0 ? wobble(tw, 0.04) : 0;
      b.ox = wx * w;
      b.oy = wy * w;
    });
  }

  // ---------- 描画ループ ----------
  function render(now) {
    const all = [];
    for (const b of balls) if (b) all.push(b);
    for (const b of loose) all.push(b);
    for (const b of all) {
      if (b.motion) {
        const t = now - b.motion.start;
        b.motion.step(Math.min(t, b.motion.dur));
        if (t >= b.motion.dur) {
          const done = b.motion.done;
          b.motion = null;
          b.ox = 0; b.oy = 0;
          if (done) done();
        }
      }
      // つまみ上げ・指での押し込みは、目標へなめらかに近づける
      b.hold += (b.holdTarget - b.hold) * 0.25;
      b.push[0] += (b.pushTarget[0] - b.push[0]) * 0.3;
      b.push[1] += (b.pushTarget[1] - b.push[1]) * 0.3;
      const hover = b.holdTarget > 0 ? Math.sin(now / 260) * 0.03 : 0;
      const z = Math.max(0, b.z + b.hold + hover);
      const x = b.x + b.ox + b.push[0];
      const y = b.y + b.oy + b.push[1];
      const zc = Math.min(z, 2.5);
      const pt = now - b.popAt;
      const pop = b.pop && pt < 600 ? b.pop * Math.exp(-pt / 110) * Math.cos(pt / 48) : 0;
      b.root.style.transform = `translate(${(x - 0.5) * cellPx}px, ${(y - 0.5) * cellPx}px)`;
      b.root.style.zIndex = z > 0.03 ? 6 : 3;
      b.root.style.opacity = b.alpha;
      b.body.style.transform = `translate(0, ${-z * 0.16 * cellPx}px) scale(${(1 + zc * 0.26) * (1 + pop)})`;
      b.shadow.style.transform = `translate(${(0.05 + z * 0.2) * cellPx}px, ${(0.07 + z * 0.28) * cellPx}px) scale(${1 - zc * 0.16})`;
      b.shadow.style.opacity = Math.max(0, 1 - zc * 0.32);
      // 模様は転がった向きへ流す（1周 = 円周 π マスぶんで一巡）
      const px = ((b.roll[0] / Math.PI) % 1) * 100, py = ((b.roll[1] / Math.PI) % 1) * 100;
      b.tex.style.transform = `translate(${px}%, ${py}%)`;
    }
    requestAnimationFrame(render);
  }

  function popup(text, r, c, color, wide) {
    const p = document.createElement('div');
    p.className = 'popup' + (wide ? ' wide' : '');
    p.textContent = text;
    p.style.setProperty('--r', r);
    p.style.setProperty('--c', c);
    p.style.setProperty('--col', color);
    p.addEventListener('animationend', () => p.remove());
    boardEl.appendChild(p);
  }

  // ---------- 選択 ----------
  function select(i) {
    if (selected >= 0 && balls[selected]) balls[selected].holdTarget = 0;
    for (const m of dests) cellEls[m.to].classList.remove('dest');
    selected = i;
    dests = i >= 0 ? L.movesFrom(state.board, i) : [];
    if (i >= 0) {
      balls[i].holdTarget = 0.22; // 指でつまみ上げる
      const col = colorOf(state.board[i] * 2);
      for (const m of dests) {
        cellEls[m.to].classList.add('dest');
        cellEls[m.to].style.setProperty('--dest', col);
      }
    }
  }

  // 動かせない: 押した向きへ少し転がり、くぼみに戻って揺れる
  function reject(i, dir) {
    const b = balls[i];
    S.error();
    if (!b || b.motion) return;
    const [dy, dx] = dir ? DIRS[dir] : [0, Math.random() < 0.5 ? -1 : 1];
    const out = 140;
    startMotion(b, out + WOBBLE.dur, (t) => {
      const w = t < out ? 0.12 * Math.sin((Math.PI * t) / out) : wobble(t - out, -0.05);
      b.ox = dx * w;
      b.oy = dy * w;
    });
  }

  // ---------- 1手 ----------
  function play(move) {
    const now = performance.now();
    combo = now - lastMoveAt < COMBO_WINDOW ? combo + 1 : 0;
    lastMoveAt = now;

    select(-1);
    const res = L.applyMove(state, move);
    state = res.state;

    const mover = balls[move.from];
    const victim = balls[move.over];
    balls[move.from] = null;
    balls[move.over] = null;
    balls[move.to] = mover;

    // 跳ぶ玉: 放物線 → 弾む → 穴の中で揺れて止まる
    const fx = colOf(move.from) + 0.5, fy = rowOf(move.from) + 0.5;
    const tx = colOf(move.to) + 0.5, ty = rowOf(move.to) + 0.5;
    const ux = Math.sign(tx - fx), uy = Math.sign(ty - fy);
    const vz = (G * FLIGHT_MS) / 2;
    const track = bounceTrack(vz);
    const roll0 = mover.roll.slice();
    mover.z = 0; mover.ox = 0; mover.oy = 0;
    startMotion(mover, FLIGHT_MS + track.dur + WOBBLE.dur, (t) => {
      if (t < FLIGHT_MS) {
        const k = t / FLIGHT_MS;
        mover.x = fx + (tx - fx) * k;
        mover.y = fy + (ty - fy) * k;
        mover.z = vz * t - 0.5 * G * t * t;
        // 空中ではあまり回らない（指ではじいたぶんだけ）
        mover.roll[0] = roll0[0] + ux * 0.6 * 2 * k;
        mover.roll[1] = roll0[1] + uy * 0.6 * 2 * k;
        return;
      }
      mover.x = tx; mover.y = ty;
      const tb = t - FLIGHT_MS;
      mover.z = track.z(tb);
      const tw = tb - track.dur;
      const w = tw > 0 ? wobble(tw, WOBBLE.amp) : 0;
      mover.ox = ux * w;
      mover.oy = uy * w;
      mover.roll[0] = roll0[0] + ux * (1.2 + w);
      mover.roll[1] = roll0[1] + uy * (1.2 + w);
    });

    // 取られる玉: 跳ぶ玉が真上を越えたら、つまみ上げられて消える
    if (victim) {
      loose.add(victim);
      victim.ox = 0; victim.holdTarget = 0;
      const lift = 380, startAt = FLIGHT_MS * 0.5;
      startMotion(victim, startAt + lift, (t) => {
        const k = Math.max(0, (t - startAt) / lift);
        const e = 1 - Math.pow(1 - k, 3);
        victim.z = 1.5 * e;
        victim.oy = -0.35 * e;
        victim.alpha = 1 - Math.max(0, (k - 0.25) / 0.75);
      }, () => { victim.root.remove(); loose.delete(victim); });
    }

    // 音は当たった瞬間に合わせる: 着地の「とん」＋ベル、そのあとの小さな弾み
    setTimeout(() => {
      // 着地した瞬間に数字が2倍になり、玉がふくらんで戻る
      setBallValue(mover, res.merged);
      mover.pop = 0.24;
      mover.popAt = performance.now();
      S.merge(Math.log2(res.merged), combo);
    }, FLIGHT_MS);
    for (const s of track.segs) {
      setTimeout(() => S.tick(s.v / vz), FLIGHT_MS + s.t + s.d);
    }
    setTimeout(() => {
      if (navigator.vibrate && !S.muted) navigator.vibrate(12);
      popup(`+${res.gained}`, rowOf(move.to), colOf(move.to), colorOf(res.merged));
    }, FLIGHT_MS);

    lockedUntil = now + FLIGHT_MS + 40;

    // 補充: 着地のあと、玉が順に落ちてくる
    if (res.refilled.length) {
      setTimeout(() => {
        let k = 0;
        for (const ref of res.refilled) {
          for (const i of ref.cells) {
            if (balls[i]) balls[i].root.remove();
            dropIn(makeBall(i, ref.value), k++ * DROP_STAGGER, DROP_Z);
          }
          const cs = ref.cells.map((i) => [rowOf(i), colOf(i)]);
          const mr = cs.reduce((a, x) => a + x[0], 0) / cs.length;
          const mc = cs.reduce((a, x) => a + x[1], 0) / cs.length;
          popup(`補充 ${ref.value}`, mr, mc, colorOf(ref.value), true);
        }
        const fall = Math.sqrt((2 * DROP_Z) / G);
        setTimeout(() => S.refill(k, DROP_STAGGER), Math.max(0, fall - 50));
        updateArms();
      }, FLIGHT_MS + 120);
      lockedUntil = now + FLIGHT_MS + 160;
    }

    updateHud(true);
    save();
    setTimeout(checkOver, FLIGHT_MS + 700);
  }

  // ---------- 入力 ----------
  let gesture = null;

  function cellFromPoint(x, y) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * SIZE);
    const r = Math.floor(((y - rect.top) / rect.height) * SIZE);
    return L.isCell(r, c) ? r * SIZE + c : -1;
  }

  function releasePush() {
    if (gesture && gesture.idx >= 0 && balls[gesture.idx]) balls[gesture.idx].pushTarget = [0, 0];
  }

  function onDown(e) {
    S.unlock();
    if (performance.now() < lockedUntil) return;
    gesture = { x: e.clientX, y: e.clientY, idx: cellFromPoint(e.clientX, e.clientY), id: e.pointerId, done: false };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
  }

  function onMove(e) {
    if (!gesture || gesture.done || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    const threshold = Math.max(14, cellPx * 0.3);
    const b = gesture.idx >= 0 ? balls[gesture.idx] : null;
    if (Math.hypot(dx, dy) < threshold) {
      // しきい値までは、指に押されて玉がくぼみの中で少し寄る
      if (b) b.pushTarget = [Math.max(-0.1, Math.min(0.1, dx / cellPx * 0.3)), Math.max(-0.1, Math.min(0.1, dy / cellPx * 0.3))];
      return;
    }
    releasePush();
    gesture.done = true;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    swipe(gesture.idx, dir);
  }

  function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    releasePush();
    const g = gesture;
    gesture = null;
    if (!g.done) tap(g.idx);
  }

  function swipe(idx, dir) {
    if (idx < 0 || !state.board[idx] || performance.now() < lockedUntil) return;
    const [dr, dc] = DIRS[dir];
    const move = L.movesFrom(state.board, idx).find((m) => m.to === idx + 2 * (dr * SIZE + dc));
    if (move) play(move);
    else { select(-1); reject(idx, dir); }
  }

  function tap(idx) {
    if (performance.now() < lockedUntil) return;
    if (selected >= 0) {
      const move = dests.find((m) => m.to === idx);
      if (move) { play(move); return; }
    }
    if (idx < 0 || !state.board[idx] || idx === selected) { select(-1); return; }
    if (L.movesFrom(state.board, idx).length === 0) { select(-1); reject(idx); return; }
    select(idx);
    S.select();
  }

  // ---------- 表示 ----------
  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function setText(id, value, bump) {
    const node = el(id);
    const text = String(value);
    if (node.textContent !== text) {
      node.textContent = text;
      if (bump) retrigger(node, 'bump');
    }
  }

  function updateArms() {
    for (const label of document.querySelectorAll('.arm-label')) {
      const left = L.ARMS[label.dataset.arm].filter((i) => state.board[i]).length;
      label.textContent = left;
      label.classList.toggle('low', left <= 2);
    }
  }

  function updateHud(bump) {
    setText('score', state.score, bump);
    setText('best', best, false);
    setText('left', L.CELLS.filter((i) => state.board[i]).length, false);
    setText('refills', state.refills, bump);
    const next = L.refillValue(state.board);
    const chip = el('next-refill');
    chip.textContent = next;
    chip.style.background = paletteOf(next).col;
    chip.style.color = paletteOf(next).ink;
    updateArms();
  }

  function resize() {
    cellPx = boardEl.getBoundingClientRect().width / SIZE || cellPx;
    boardEl.style.setProperty('--cell', `${cellPx}px`);
  }

  function checkOver() {
    if (overShown || L.legalMoves(state.board).length) return;
    overShown = true;
    const isBest = state.score > best;
    if (isBest) {
      best = state.score;
      storageSet(BEST_KEY, String(best));
    }
    S.gameOver();
    if (isBest) S.best();
    el('best-badge').hidden = !isBest;
    el('r-score').textContent = state.score;
    el('r-left').textContent = L.CELLS.filter((i) => state.board[i]).length;
    el('r-refills').textContent = state.refills;
    el('r-max').textContent = state.maxTile;
    updateHud(false);
    openDialog(el('dlg-over'));
  }

  // 盤に玉を並べる。animate なら中央から外へ順に落としていく
  function setupBoard(animate) {
    clearBalls();
    const cells = L.CELLS.filter((i) => state.board[i]);
    const dist = (i) => Math.abs(rowOf(i) - 3) + Math.abs(colOf(i) - 3);
    for (const i of cells) {
      const b = makeBall(i, state.board[i]);
      if (animate) dropIn(b, dist(i) * 55 + Math.random() * 30, 1.6);
    }
  }

  function newGame() {
    state = L.newGame();
    combo = 0;
    overShown = false;
    lockedUntil = performance.now() + 500;
    select(-1);
    setupBoard(true);
    updateHud(false);
    save();
    S.start();
  }

  function openDialog(d) {
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function updateSoundButton() {
    el('btn-sound').classList.toggle('off', S.muted);
    el('btn-sound').setAttribute('aria-pressed', String(!S.muted));
  }

  // ---------- 起動 ----------
  load();
  resize();
  setupBoard(true);
  updateHud(false);
  updateSoundButton();
  el('brand-url').textContent = location.host;
  new ResizeObserver(resize).observe(boardEl);
  requestAnimationFrame(render);

  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', () => { releasePush(); gesture = null; });

  el('btn-new').addEventListener('click', () => {
    if (state.moves === 0 || overShown || confirm('いまのゲームを終えて、新しく始めますか？')) newGame();
  });
  el('over-new').addEventListener('click', () => { closeDialog(el('dlg-over')); newGame(); });
  el('btn-rules').addEventListener('click', () => openDialog(el('dlg-rules')));
  el('rules-close').addEventListener('click', () => { S.unlock(); closeDialog(el('dlg-rules')); });
  el('btn-sound').addEventListener('click', () => {
    S.setMuted(!S.muted);
    updateSoundButton();
    S.select();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') select(-1);
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (dir && selected >= 0) { e.preventDefault(); S.unlock(); swipe(selected, dir); }
  });

  if (!storageGet(SAVE_KEY + '-seen')) {
    storageSet(SAVE_KEY + '-seen', '1');
    openDialog(el('dlg-rules'));
  }
  save();
  setTimeout(checkOver, 800);

  // 自動テスト用（URL に ?debug を付けたときだけ）
  if (/[?&]debug\b/.test(location.search)) {
    window.__test = {
      info: () => ({ score: state.score, moves: state.moves, refills: state.refills, pegs: state.board.filter(Boolean).length }),
      // 合法手を1つ選び、スワイプの始点（画面座標）と方向を返す
      nextSwipe: () => {
        const ms = L.legalMoves(state.board);
        if (!ms.length) return null;
        const m = ms[Math.floor(Math.random() * ms.length)];
        const rect = boardEl.getBoundingClientRect();
        const u = rect.width / SIZE;
        const d = m.to - m.from;
        const dir = d === -2 * SIZE ? 'up' : d === 2 * SIZE ? 'down' : d === -2 ? 'left' : 'right';
        return { x: rect.left + ((m.from % SIZE) + 0.5) * u, y: rect.top + (Math.floor(m.from / SIZE) + 0.5) * u, dir, u, to: m.to };
      },
    };
  }
})();
