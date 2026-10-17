// ペグブロックの描画と操作（アイソメトリック表示）
(function () {
  'use strict';

  const L = window.PegLogic;
  const { SIZE } = L;

  const SAVE_KEY = 'pegblock-save-v1';
  const BEST_KEY = 'pegblock-best';
  const MOVE_MS = 300;
  const DROP_MS = 460;
  const DROP_STAGGER = 35;
  const SHAKE_MS = 320;

  // 数字ごとの色（2, 4, 8, … の順）
  const PALETTE = [
    '#ff5d73', '#ff8a3d', '#ffc93c', '#7bd34f', '#2ec4b6', '#3a86ff',
    '#7b5cff', '#c04cfd', '#ff4fa3', '#ff3b3b', '#00b4d8', '#3d3d6b',
  ];
  const REGION_TINT = {
    center: '#efeaff',
    top: '#c9f5e3',
    right: '#ffe0cc',
    bottom: '#cfe6ff',
    left: '#fff2b8',
  };

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('board-wrap');
  const el = (id) => document.getElementById(id);

  // ---------- 状態 ----------
  let state = L.newGame();
  let history = [];
  let undos = 0;
  let best = 0;
  let selected = -1;
  let dests = [];
  let anim = null; // { move, value, start }
  const drops = new Map(); // cell -> start time
  const shakes = new Map(); // cell -> start time
  let popups = [];
  let overShown = false;

  // ---------- 保存 ----------
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できない環境では無視 */ }
  }
  function save() {
    storageSet(SAVE_KEY, JSON.stringify({ state, undos }));
  }
  function load() {
    best = Number(storageGet(BEST_KEY)) || 0;
    try {
      const data = JSON.parse(storageGet(SAVE_KEY));
      if (data && data.state && Array.isArray(data.state.board) && data.state.board.length === SIZE * SIZE) {
        state = L.cloneState(data.state);
        undos = data.undos || 0;
      }
    } catch (e) { /* 壊れたデータは捨てて新規開始 */ }
  }

  // ---------- 色 ----------
  function colorFor(v) {
    const lvl = Math.max(1, Math.round(Math.log2(v)));
    return PALETTE[(lvl - 1) % PALETTE.length];
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f === 0) return hex;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // ---------- 投影 ----------
  let W = 0, H = 0, tw = 60, th = 30, ox = 0, oy = 0, dpr = 1;

  function resize() {
    const rect = wrap.getBoundingClientRect();
    W = Math.max(200, rect.width);
    H = Math.max(240, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    tw = Math.min(W / 5.6, H / 4.0);
    th = tw / 2;
    const total = 3.95 * tw;
    ox = W / 2;
    oy = (H - total) / 2 + 1.0 * tw - 0.5 * tw;
  }

  function proj(gr, gc, z) {
    return [ox + (gc - gr) * tw / 2, oy + (gc + gr) * th / 2 - z];
  }

  function pegHeight(v) {
    const lvl = Math.log2(v);
    return th * Math.min(0.55 + 0.12 * (lvl - 1), 1.2);
  }

  // 中心(cr,cc)・半幅hs・底z0・高さhの箱の頂点
  function boxPoints(cr, cc, hs, z0, h) {
    const corners = [[cr - hs, cc - hs], [cr - hs, cc + hs], [cr + hs, cc + hs], [cr + hs, cc - hs]]; // N E S W
    const top = corners.map(([r, c]) => proj(r, c, z0 + h));
    const bot = corners.map(([r, c]) => proj(r, c, z0));
    return { top, bot };
  }

  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function drawBox(cr, cc, hs, z0, h, color, opts = {}) {
    const { top, bot } = boxPoints(cr, cc, hs, z0, h);
    const tone = opts.tone || 0;
    const [N, E, S, Wp] = [0, 1, 2, 3];
    // 左面
    poly([top[Wp], top[S], bot[S], bot[Wp]]);
    ctx.fillStyle = shade(color, -0.22 + tone);
    ctx.fill();
    // 右面
    poly([top[S], top[E], bot[E], bot[S]]);
    ctx.fillStyle = shade(color, -0.4 + tone);
    ctx.fill();
    // 上面
    poly(top);
    const g = ctx.createLinearGradient(top[N][0], top[N][1], top[S][0], top[S][1]);
    g.addColorStop(0, shade(color, 0.28 + tone));
    g.addColorStop(1, shade(color, tone));
    ctx.fillStyle = g;
    ctx.fill();
    if (opts.edge !== false) {
      ctx.strokeStyle = shade(color, 0.45);
      ctx.lineWidth = Math.max(1, tw * 0.02);
      ctx.beginPath();
      ctx.moveTo(top[Wp][0], top[Wp][1]);
      ctx.lineTo(top[N][0], top[N][1]);
      ctx.lineTo(top[E][0], top[E][1]);
      ctx.stroke();
    }
    if (opts.outline) {
      ctx.strokeStyle = opts.outline;
      ctx.lineWidth = Math.max(2, tw * 0.05);
      ctx.lineJoin = 'round';
      poly([top[N], top[E], bot[E], bot[S], bot[Wp], top[Wp]]);
      ctx.stroke();
    }
    return top;
  }

  function drawLabel(top, v, scale = 1) {
    const cx = (top[0][0] + top[2][0]) / 2;
    const cy = (top[0][1] + top[2][1]) / 2;
    const text = String(v);
    const size = tw * 0.27 * scale * (text.length <= 2 ? 1 : text.length === 3 ? 0.82 : 0.66);
    ctx.font = `800 ${size}px 'M PLUS Rounded 1c', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.22);
    ctx.strokeStyle = shade(colorFor(v), -0.5);
    ctx.strokeText(text, cx, cy + size * 0.04);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, cy + size * 0.04);
  }

  // ---------- 描画 ----------
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBounce = (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };

  function drawFloor(now) {
    const slab = th * 0.55;
    const order = L.CELLS.slice().sort((a, b) => depth(a) - depth(b));
    for (const i of order) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const region = L.regionOf(r, c);
      const color = REGION_TINT[region];
      drawBox(r + 0.5, c + 0.5, 0.48, -slab, slab, color, { tone: (r + c) % 2 ? -0.06 : 0 });
    }
    // 移動先の目印
    if (selected >= 0 && !anim) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      const col = colorFor(state.board[selected] * 2);
      for (const m of dests) {
        const r = Math.floor(m.to / SIZE) + 0.5, c = (m.to % SIZE) + 0.5;
        const hs = 0.26 + 0.06 * pulse;
        const pts = [[r - hs, c - hs], [r - hs, c + hs], [r + hs, c + hs], [r + hs, c - hs]].map(([a, b]) => proj(a, b, 1));
        poly(pts);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.45 + 0.35 * pulse;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, tw * 0.04);
        ctx.stroke();
      }
    }
  }

  function depth(i) {
    return Math.floor(i / SIZE) + (i % SIZE);
  }

  function drawShadow(cr, cc, hs, alpha) {
    const pts = [[cr - hs, cc - hs], [cr - hs, cc + hs], [cr + hs, cc + hs], [cr + hs, cc - hs]].map(([a, b]) => proj(a + 0.06, b + 0.06, 0));
    poly(pts);
    ctx.fillStyle = `rgba(40,20,90,${alpha})`;
    ctx.fill();
  }

  // 描画対象の一覧（奥から順に並べる）
  function collectBlocks(now) {
    const items = [];
    const moving = anim ? Math.min(1, (now - anim.start) / MOVE_MS) : 1;
    for (const i of L.CELLS) {
      const v = state.board[i];
      if (!v) continue;
      if (anim && i === anim.move.to) continue;
      const r = Math.floor(i / SIZE), c = i % SIZE;
      let z = 0, alpha = 1;
      if (drops.has(i)) {
        const t = (now - drops.get(i)) / DROP_MS;
        if (t < 0) continue;
        z = (1 - easeOutBounce(Math.min(1, t))) * tw * 3;
        alpha = Math.min(1, t * 3);
      }
      let dc = 0;
      if (shakes.has(i)) {
        const t = (now - shakes.get(i)) / SHAKE_MS;
        dc = Math.sin(t * Math.PI * 6) * 0.06 * (1 - t);
      }
      if (i === selected && !anim) z += th * (0.18 + 0.06 * Math.sin(now / 160));
      items.push({ cr: r + 0.5 + dc * 0.5, cc: c + 0.5 + dc, v, z, alpha, sel: i === selected && !anim });
    }
    if (anim) {
      const { move, value } = anim;
      const e = easeInOut(moving);
      const fr = Math.floor(move.from / SIZE) + 0.5, fc = (move.from % SIZE) + 0.5;
      const tr = Math.floor(move.to / SIZE) + 0.5, tc = (move.to % SIZE) + 0.5;
      const or = Math.floor(move.over / SIZE) + 0.5, oc = (move.over % SIZE) + 0.5;
      // 飛び越えられて消えるペグ
      const squash = Math.max(0, 1 - moving * 1.6);
      if (squash > 0) items.push({ cr: or, cc: oc, v: value, z: 0, alpha: 1, hScale: squash, hs: 0.33 * (0.6 + 0.4 * squash) });
      // 飛ぶペグ
      const done = moving >= 0.85;
      const pop = done ? 1 + 0.18 * Math.sin(((moving - 0.85) / 0.15) * Math.PI) : 1;
      items.push({
        cr: fr + (tr - fr) * e,
        cc: fc + (tc - fc) * e,
        v: done ? value * 2 : value,
        z: Math.sin(moving * Math.PI) * tw * 0.9,
        alpha: 1,
        hs: 0.33 * pop,
      });
    }
    items.sort((a, b) => (a.cr + a.cc) - (b.cr + b.cc));
    return items;
  }

  let lastBlocks = [];

  function drawBlocks(now) {
    const items = collectBlocks(now);
    for (const it of items) drawShadow(it.cr, it.cc, (it.hs || 0.33) * Math.max(0.5, 1 - it.z / (tw * 3)), 0.18 * it.alpha);
    for (const it of items) {
      const hs = it.hs || 0.33;
      const h = pegHeight(it.v) * (it.hScale == null ? 1 : it.hScale);
      ctx.globalAlpha = it.alpha;
      const top = drawBox(it.cr, it.cc, hs, it.z, h, colorFor(it.v), { outline: it.sel ? '#fff' : null });
      if (h > th * 0.2) drawLabel(top, it.v, hs / 0.33);
      ctx.globalAlpha = 1;
    }
    lastBlocks = items;
  }

  // 四方の腕に残っているペグの数
  function drawArmCounts() {
    const spots = { top: [-1.0, 3.5, 1.3], bottom: [8.0, 3.5, -0.3], left: [3.5, -1.0, 1.3], right: [3.5, 8.0, -0.3] };
    ctx.font = `800 ${tw * 0.2}px 'M PLUS Rounded 1c', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const arm of Object.keys(L.ARMS)) {
      const left = L.ARMS[arm].filter((i) => state.board[i] && !drops.has(i)).length;
      const [r, c, z] = spots[arm];
      const [x, y] = proj(r, c, th * z);
      const text = left === 0 ? '補充!' : `あと${left}`;
      const w = ctx.measureText(text).width + tw * 0.2;
      const hgt = tw * 0.3;
      ctx.fillStyle = left <= 2 ? '#ff5d73' : 'rgba(255,255,255,0.85)';
      roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt / 2);
      ctx.fill();
      ctx.fillStyle = left <= 2 ? '#fff' : '#4b3c8c';
      ctx.fillText(text, x, y + 1);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPopups(now) {
    popups = popups.filter((p) => now - p.start < p.dur);
    for (const p of popups) {
      const t = (now - p.start) / p.dur;
      if (t < 0) continue;
      const [x, y] = proj(p.r, p.c, tw * (0.7 + t * 0.6));
      const size = tw * (p.big ? 0.32 : 0.3);
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `800 ${size}px 'M PLUS Rounded 1c', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = size * 0.25;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#fff';
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    if (anim && now - anim.start >= MOVE_MS) anim = null;
    for (const [i, t] of drops) if (now - t >= DROP_MS) drops.delete(i);
    for (const [i, t] of shakes) if (now - t >= SHAKE_MS) shakes.delete(i);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawFloor(now);
    drawBlocks(now);
    drawArmCounts();
    drawPopups(now);

    if (!busy() && !overShown && L.legalMoves(state.board).length === 0) showGameOver();
    requestAnimationFrame(frame);
  }

  function busy() {
    return anim !== null || drops.size > 0;
  }

  // ---------- 操作 ----------
  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function cellAt(x, y) {
    // 手前のブロックから順に調べる
    for (let k = lastBlocks.length - 1; k >= 0; k--) {
      const it = lastBlocks[k];
      const { top, bot } = boxPoints(it.cr, it.cc, 0.42, it.z, pegHeight(it.v));
      if (pointInPoly(x, y, [top[0], top[1], bot[1], bot[2], bot[3], top[3]])) {
        return { cell: Math.floor(it.cr) * SIZE + Math.floor(it.cc), peg: true };
      }
    }
    // 床：投影を逆算
    const a = (x - ox) / (tw / 2), b = (y - oy) / (th / 2);
    const gc = (a + b) / 2, gr = (b - a) / 2;
    const r = Math.floor(gr), c = Math.floor(gc);
    if (L.isCell(r, c)) return { cell: r * SIZE + c, peg: false };
    return null;
  }

  function destAt(x, y) {
    if (selected < 0) return null;
    const a = (x - ox) / (tw / 2), b = (y - oy) / (th / 2);
    const gc = (a + b) / 2, gr = (b - a) / 2;
    const idx = Math.floor(gr) * SIZE + Math.floor(gc);
    if (!L.isCell(Math.floor(gr), Math.floor(gc))) return null;
    return dests.find((m) => m.to === idx) || null;
  }

  function select(i) {
    selected = i;
    dests = i >= 0 ? L.movesFrom(state.board, i) : [];
  }

  function play(move) {
    const now = performance.now();
    const value = state.board[move.from];
    history.push(L.cloneState(state));
    const res = L.applyMove(state, move);
    state = res.state;
    anim = { move, value, start: now };
    select(-1);

    const tr = Math.floor(move.to / SIZE) + 0.5, tc = (move.to % SIZE) + 0.5;
    popups.push({ text: `+${res.gained}`, r: tr, c: tc, start: now + MOVE_MS * 0.8, dur: 900, color: shade(colorFor(res.merged), -0.25) });

    let k = 0;
    const base = now + MOVE_MS + 80;
    for (const ref of res.refilled) {
      for (const i of ref.cells) drops.set(i, base + k++ * DROP_STAGGER);
      const center = ref.cells.reduce((acc, i) => [acc[0] + Math.floor(i / SIZE) + 0.5, acc[1] + (i % SIZE) + 0.5], [0, 0]);
      popups.push({ text: `補充 ${ref.value}`, r: center[0] / 6, c: center[1] / 6, start: base, dur: 1200, color: colorFor(ref.value), big: true });
    }
    updateHud(true);
    save();
  }

  function onPointer(ev) {
    if (busy()) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;

    const dest = destAt(x, y);
    if (dest) { play(dest); return; }

    const hit = cellAt(x, y);
    if (!hit || !hit.peg) { select(-1); return; }
    if (hit.cell === selected) { select(-1); return; }
    const ms = L.movesFrom(state.board, hit.cell);
    if (ms.length === 0) {
      shakes.set(hit.cell, performance.now());
      select(-1);
      return;
    }
    select(hit.cell);
  }

  function undo() {
    if (!history.length) return;
    anim = null;
    drops.clear();
    popups = [];
    state = history.pop();
    undos += 1;
    select(-1);
    overShown = false;
    updateHud(false);
    save();
  }

  function newGame() {
    anim = null;
    drops.clear();
    popups = [];
    state = L.newGame();
    history = [];
    undos = 0;
    select(-1);
    overShown = false;
    updateHud(false);
    save();
  }

  // ---------- 表示 ----------
  function setText(id, value, bump) {
    const node = el(id);
    const text = String(value);
    if (node.textContent !== text) {
      node.textContent = text;
      if (bump) {
        node.classList.remove('bump');
        void node.offsetWidth;
        node.classList.add('bump');
      }
    }
  }

  function updateHud(bump) {
    setText('score', state.score, bump);
    setText('best', Math.max(best, 0), false);
    setText('moves', state.moves, false);
    setText('refills', state.refills, bump);
    const next = L.refillValue(state.board);
    const chip = el('next-refill');
    chip.textContent = next;
    chip.style.background = colorFor(next);
    el('btn-undo').disabled = history.length === 0;
  }

  function showGameOver() {
    overShown = true;
    const isBest = state.score > best;
    if (isBest) {
      best = state.score;
      storageSet(BEST_KEY, String(best));
    }
    el('best-badge').hidden = !isBest;
    el('r-score').textContent = state.score;
    el('r-moves').textContent = state.moves;
    el('r-refills').textContent = state.refills;
    el('r-max').textContent = state.maxTile;
    el('r-undos').textContent = undos;
    el('over-undo').disabled = history.length === 0;
    updateHud(false);
    openDialog(el('dlg-over'));
  }

  function openDialog(d) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  // ---------- 起動 ----------
  load();
  resize();
  updateHud(false);
  new ResizeObserver(resize).observe(wrap);
  canvas.addEventListener('pointerdown', onPointer);

  el('btn-undo').addEventListener('click', undo);
  el('btn-new').addEventListener('click', () => {
    if (state.moves === 0 || overShown || confirm('いまのゲームを終えて、新しく始めますか？')) newGame();
  });
  el('over-undo').addEventListener('click', () => { closeDialog(el('dlg-over')); undo(); });
  el('over-new').addEventListener('click', () => { closeDialog(el('dlg-over')); newGame(); });
  el('btn-rules').addEventListener('click', () => openDialog(el('dlg-rules')));
  el('rules-close').addEventListener('click', () => closeDialog(el('dlg-rules')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') select(-1);
    if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') { e.preventDefault(); undo(); }
  });

  if (!storageGet(SAVE_KEY + '-seen')) {
    storageSet(SAVE_KEY + '-seen', '1');
    openDialog(el('dlg-rules'));
  }
  save();
  // 自動テスト用（URL に ?debug を付けたときだけ）
  if (/[?&]debug\b/.test(location.search)) {
    const center = (i, z) => {
      const rect = canvas.getBoundingClientRect();
      const [x, y] = proj(Math.floor(i / SIZE) + 0.5, (i % SIZE) + 0.5, z);
      return [rect.left + x, rect.top + y];
    };
    window.__test = {
      info: () => ({ score: state.score, moves: state.moves, refills: state.refills, pegs: state.board.filter(Boolean).length }),
      playRandom: () => {
        const ms = L.legalMoves(state.board);
        if (!ms.length || busy()) return false;
        play(ms[Math.floor(Math.random() * ms.length)]);
        return true;
      },
      nextMovePoints: () => {
        const ms = L.legalMoves(state.board);
        if (!ms.length) return null;
        const m = ms[Math.floor(Math.random() * ms.length)];
        return { from: center(m.from, pegHeight(state.board[m.from])), to: center(m.to, 0) };
      },
    };
  }

  requestAnimationFrame(frame);
})();
