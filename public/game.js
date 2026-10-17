// ペグブロックの描画と操作（上から見た2D盤・スワイプ操作）
(function () {
  'use strict';

  const L = window.PegLogic;
  const S = window.Sound;
  const { SIZE } = L;

  const SAVE_KEY = 'pegblock-save-v2';
  const BEST_KEY = 'pegblock-best-v2';
  const MOVE_MS = 200;
  const SPAWN_STAGGER = 45;
  const COMBO_WINDOW = 2500;
  const DIRS = { up: -SIZE, down: SIZE, left: -1, right: 1 };

  const el = (id) => document.getElementById(id);
  const boardEl = el('board');

  // ---------- 状態 ----------
  let state = L.newGame();
  let history = [];
  let undos = 0;
  let best = 0;
  let selected = -1;
  let dests = [];
  let lockedUntil = 0;
  let overShown = false;
  let combo = 0;
  let lastMoveAt = 0;

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

  // ---------- 盤の組み立て ----------
  const cellEls = new Array(SIZE * SIZE).fill(null);
  const tileEls = new Array(SIZE * SIZE).fill(null);

  for (const i of L.CELLS) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.region = L.regionOf(r, c);
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

  const colorCache = new Map();
  function colorOf(v) {
    if (colorCache.has(v)) return colorCache.get(v);
    const probe = document.createElement('div');
    probe.className = 'tile';
    probe.dataset.v = v;
    probe.style.display = 'none';
    boardEl.appendChild(probe);
    const col = getComputedStyle(probe).getPropertyValue('--col').trim() || '#ffffff';
    probe.remove();
    colorCache.set(v, col);
    return col;
  }

  function setTileValue(t, v) {
    t.dataset.v = v;
  }

  function placeTile(t, i) {
    t.style.setProperty('--r', Math.floor(i / SIZE));
    t.style.setProperty('--c', i % SIZE);
  }

  function makeTile(i, v) {
    const t = document.createElement('div');
    t.className = 'tile';
    const face = document.createElement('div');
    face.className = 'face';
    t.appendChild(face);
    setTileValue(t, v);
    placeTile(t, i);
    boardEl.appendChild(t);
    tileEls[i] = t;
    return t;
  }

  function renderAll() {
    for (let i = 0; i < tileEls.length; i++) {
      if (tileEls[i]) { tileEls[i].remove(); tileEls[i] = null; }
    }
    boardEl.querySelectorAll('.tile, .popup').forEach((n) => n.remove());
    for (const i of L.CELLS) if (state.board[i]) makeTile(i, state.board[i]);
  }

  function retrigger(t, cls) {
    t.classList.remove(cls);
    void t.offsetWidth;
    t.classList.add(cls);
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
    if (selected >= 0 && tileEls[selected]) tileEls[selected].classList.remove('selected');
    for (const m of dests) cellEls[m.to].classList.remove('dest');
    selected = i;
    dests = i >= 0 ? L.movesFrom(state.board, i) : [];
    if (i >= 0) {
      tileEls[i].classList.add('selected');
      const col = colorOf(state.board[i]);
      for (const m of dests) {
        cellEls[m.to].classList.add('dest');
        cellEls[m.to].style.setProperty('--dest', col);
      }
    }
  }

  function reject(i) {
    if (tileEls[i]) retrigger(tileEls[i], 'shake');
    S.error();
  }

  // ---------- 1手 ----------
  function play(move) {
    const now = performance.now();
    combo = now - lastMoveAt < COMBO_WINDOW ? combo + 1 : 0;
    lastMoveAt = now;

    select(-1);
    history.push(L.cloneState(state));
    const res = L.applyMove(state, move);
    state = res.state;

    // 飛ぶペグ
    const mover = tileEls[move.from];
    tileEls[move.from] = null;
    tileEls[move.to] = mover;
    mover.classList.remove('landed', 'shake');
    retrigger(mover, 'moving');
    placeTile(mover, move.to);

    // 飛び越えられたペグ
    const victim = tileEls[move.over];
    tileEls[move.over] = null;
    if (victim) {
      victim.classList.add('vanish');
      setTimeout(() => victim.remove(), 220);
    }

    S.jump(combo);
    if (navigator.vibrate && !S.muted) navigator.vibrate(12);

    const tr = Math.floor(move.to / SIZE), tc = move.to % SIZE;
    setTimeout(() => {
      mover.classList.remove('moving');
      retrigger(mover, 'landed');
      popup(`+${res.gained}`, tr, tc, colorOf(state.board[move.to]));
    }, MOVE_MS - 30);

    lockedUntil = now + MOVE_MS;

    // 補充：ジャンプのあとにブロックが順に湧いてくる
    if (res.refilled.length) {
      lockedUntil = now + MOVE_MS + 80;
      setTimeout(() => {
        let k = 0;
        for (const ref of res.refilled) {
          for (const i of ref.cells) {
            if (tileEls[i]) tileEls[i].remove();
            const t = makeTile(i, ref.value);
            t.style.setProperty('--delay', `${k++ * SPAWN_STAGGER}ms`);
            t.classList.add('spawn');
            t.addEventListener('animationend', () => t.classList.remove('spawn'), { once: true });
          }
          const cs = ref.cells.map((i) => [Math.floor(i / SIZE), i % SIZE]);
          const mr = cs.reduce((a, x) => a + x[0], 0) / cs.length;
          const mc = cs.reduce((a, x) => a + x[1], 0) / cs.length;
          popup('補充！', mr, mc, colorOf(ref.value), true);
        }
        S.refill(k, SPAWN_STAGGER);
        updateArms();
      }, MOVE_MS);
    }

    updateHud(true);
    save();
    setTimeout(checkOver, MOVE_MS + 400);
  }

  // ---------- 入力 ----------
  let gesture = null;

  function cellFromPoint(x, y) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * SIZE);
    const r = Math.floor(((y - rect.top) / rect.height) * SIZE);
    return L.isCell(r, c) ? r * SIZE + c : -1;
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
    const threshold = Math.max(14, (boardEl.getBoundingClientRect().width / SIZE) * 0.3);
    if (Math.hypot(dx, dy) < threshold) return;
    gesture.done = true;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    swipe(gesture.idx, dir);
  }

  function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (!g.done) tap(g.idx);
  }

  function swipe(idx, dir) {
    if (idx < 0 || !state.board[idx] || performance.now() < lockedUntil) return;
    const move = L.movesFrom(state.board, idx).find((m) => m.to === idx + 2 * DIRS[dir]);
    if (move) play(move);
    else { select(-1); reject(idx); }
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
    el('btn-undo').disabled = history.length === 0;
    updateArms();
  }

  function resize() {
    boardEl.style.setProperty('--cell', `${boardEl.getBoundingClientRect().width / SIZE}px`);
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
    el('r-undos').textContent = undos;
    el('over-undo').disabled = history.length === 0;
    updateHud(false);
    openDialog(el('dlg-over'));
  }

  function undo() {
    if (!history.length) return;
    state = history.pop();
    undos += 1;
    combo = 0;
    overShown = false;
    lockedUntil = 0;
    select(-1);
    renderAll();
    updateHud(false);
    save();
    S.undo();
  }

  function newGame() {
    state = L.newGame();
    history = [];
    undos = 0;
    combo = 0;
    overShown = false;
    lockedUntil = 0;
    select(-1);
    renderAll();
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
  renderAll();
  updateHud(false);
  updateSoundButton();
  el('brand-url').textContent = location.host;
  resize();
  new ResizeObserver(resize).observe(boardEl);

  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', () => { gesture = null; });

  el('btn-undo').addEventListener('click', undo);
  el('btn-new').addEventListener('click', () => {
    if (state.moves === 0 || overShown || confirm('いまのゲームを終えて、新しく始めますか？')) newGame();
  });
  el('over-undo').addEventListener('click', () => { closeDialog(el('dlg-over')); undo(); });
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
    if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') { e.preventDefault(); undo(); }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (dir && selected >= 0) { e.preventDefault(); S.unlock(); swipe(selected, dir); }
  });

  if (!storageGet(SAVE_KEY + '-seen')) {
    storageSet(SAVE_KEY + '-seen', '1');
    openDialog(el('dlg-rules'));
  }
  save();
  checkOver();

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
