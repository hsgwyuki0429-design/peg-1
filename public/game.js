// ペグブロックの描画と操作（1 列の盤・スワイプ操作・ステージ制）
(function () {
  'use strict';

  const P = window.PegLine;
  const S = window.Sound;

  const SAVE_KEY = 'pegblock-stages-v1';
  const MOVE_MS = 240;
  const COMBO_WINDOW = 2500;

  const el = (id) => document.getElementById(id);
  const boardEl = el('board');
  const areaEl = el('area');

  // ---------- 状態 ----------
  let stageIdx = 0;
  let board = [];
  let moves = 0;
  let selected = -1;
  let dests = [];
  let lockedUntil = 0;
  let finished = false;   // クリアか詰みが出て、ダイアログが開いている間
  let vertical = false;
  let size = 40;
  let combo = 0;
  let lastMoveAt = 0;
  let progress = { cleared: {} };  // ステージの番号 -> 最短手数

  const stage = () => P.STAGES[stageIdx];

  // ---------- 保存 ----------
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できない環境では無視 */ }
  }
  function loadProgress() {
    try {
      const data = JSON.parse(storageGet(SAVE_KEY));
      if (data && data.cleared && typeof data.cleared === 'object') progress = { cleared: data.cleared };
      if (data && Number.isInteger(data.stageIdx) && P.STAGES[data.stageIdx]) stageIdx = data.stageIdx;
    } catch (e) { /* 壊れたデータは捨てる */ }
  }
  function saveProgress() {
    storageSet(SAVE_KEY, JSON.stringify({ cleared: progress.cleared, stageIdx }));
  }

  // ---------- 盤の組み立て ----------
  let trackEl = null;
  const slotEls = [];
  const tileEls = [];

  function colorIndex(v) { return (v - 1) % 9; }

  function buildBoard() {
    boardEl.textContent = '';
    slotEls.length = 0;
    tileEls.length = 0;
    trackEl = document.createElement('div');
    trackEl.className = 'track';
    boardEl.appendChild(trackEl);
    const n = board.length;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'slot' + (i % 2 ? ' alt' : '');
      s.dataset.n = i + 1;
      s.style.setProperty('--i', i);
      trackEl.appendChild(s);
      slotEls.push(s);
    }
    for (let i = 0; i < n; i++) {
      tileEls.push(board[i] ? makeTile(i, board[i]) : null);
    }
  }

  function makeTile(i, v) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.c = colorIndex(v);
    t.dataset.v = v;
    const face = document.createElement('div');
    face.className = 'face';
    t.appendChild(face);
    t.style.setProperty('--i', i);
    trackEl.appendChild(t);
    return t;
  }

  // 色の取得（移動先の目印と得点の表示に使う）
  const colorCache = new Map();
  function colorOf(v) {
    const c = colorIndex(v);
    if (colorCache.has(c)) return colorCache.get(c);
    const probe = document.createElement('div');
    probe.className = 'tile';
    probe.dataset.c = c;
    probe.style.display = 'none';
    boardEl.appendChild(probe);
    const col = getComputedStyle(probe).getPropertyValue('--lo').trim() || '#ff3d77';
    probe.remove();
    colorCache.set(c, col);
    return col;
  }

  // 画面に合わせて向きと大きさを決める。細い縦長の画面では、盤を縦にして押しやすい大きさにする。
  function layout() {
    const n = board.length;
    const rect = areaEl.getBoundingClientRect();
    const w = Math.max(100, rect.width - 4), h = Math.max(100, rect.height - 4);
    const hSize = (w - 16) / n;
    vertical = h > w && hSize < 38;
    size = vertical ? Math.min((h - 16) / n, 56, w - 16) : Math.min(hSize, 64);
    size = Math.max(12, Math.floor(size));
    boardEl.classList.toggle('v', vertical);
    boardEl.classList.toggle('h', !vertical);
    boardEl.classList.toggle('small', size < 26);
    boardEl.style.setProperty('--size', `${size}px`);
  }

  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function popup(text, i, color) {
    const p = document.createElement('div');
    p.className = 'popup';
    p.textContent = text;
    p.style.setProperty('--col', color);
    const c = (i + 0.5) * size;
    p.style.left = vertical ? `${size / 2}px` : `${c}px`;
    p.style.top = vertical ? `${c}px` : `${size * 0.3}px`;
    p.addEventListener('animationend', () => p.remove());
    trackEl.appendChild(p);
  }

  // ---------- 選択 ----------
  function select(i) {
    if (selected >= 0 && tileEls[selected]) tileEls[selected].classList.remove('selected');
    for (const m of dests) slotEls[m.to].classList.remove('dest');
    selected = i;
    dests = i >= 0 ? P.movesFrom(board, i) : [];
    if (i >= 0) {
      tileEls[i].classList.add('selected');
      const col = colorOf(board[i]);
      for (const m of dests) {
        slotEls[m.to].classList.add('dest');
        slotEls[m.to].style.setProperty('--dest', col);
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

    board = P.applyMove(board, move);
    moves += 1;

    const mover = tileEls[move.from];
    const victim = tileEls[move.over];
    tileEls[move.from] = null;
    tileEls[move.over] = null;
    tileEls[move.to] = mover;
    mover.classList.remove('landed', 'shake');
    retrigger(mover, 'moving');
    mover.style.setProperty('--i', move.to);
    if (victim) {
      victim.classList.add('vanish');
      setTimeout(() => victim.remove(), 240);
    }

    S.jump(combo);
    if (navigator.vibrate && !S.muted) navigator.vibrate(12);
    setTimeout(() => {
      mover.classList.remove('moving');
      retrigger(mover, 'landed');
      popup('+1', move.to, colorOf(board[move.to]));
    }, MOVE_MS - 30);

    lockedUntil = now + MOVE_MS;
    updateHud(true);
    setTimeout(checkEnd, MOVE_MS + 200);
  }

  function checkEnd() {
    if (finished) return;
    const st = P.status(board, stage());
    if (st === 'playing') return;
    finished = true;
    if (st === 'cleared') {
      const prev = progress.cleared[stage().id];
      const bestNow = prev === undefined ? moves : Math.min(prev, moves);
      progress.cleared[stage().id] = bestNow;
      saveProgress();
      updateHud(false);
      el('clear-stage').textContent = stage().name;
      el('c-moves').textContent = moves;
      el('c-best').textContent = bestNow;
      el('c-badge').hidden = moves > stage().bestMoves;
      const hasNext = !!P.STAGES[stageIdx + 1];
      const next = el('clear-next');
      next.disabled = !hasNext;
      next.textContent = hasNext ? '次のステージ' : '次は準備中';
      S.clear();
      openDialog(el('dlg-clear'));
    } else {
      el('s-left').textContent = P.count(board);
      S.gameOver();
      openDialog(el('dlg-stuck'));
    }
  }

  // ---------- 入力 ----------
  let gesture = null;

  function indexFromPoint(x, y) {
    const rect = trackEl.getBoundingClientRect();
    const pos = vertical ? y - rect.top : x - rect.left;
    const i = Math.floor(pos / size);
    return i >= 0 && i < board.length ? i : -1;
  }

  function onDown(e) {
    S.unlock();
    if (finished || performance.now() < lockedUntil) return;
    gesture = { x: e.clientX, y: e.clientY, idx: indexFromPoint(e.clientX, e.clientY), id: e.pointerId, done: false };
    try { areaEl.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
  }

  function onMove(e) {
    if (!gesture || gesture.done || e.pointerId !== gesture.id) return;
    const along = vertical ? e.clientY - gesture.y : e.clientX - gesture.x;
    if (Math.abs(along) < Math.max(10, size * 0.35)) return;
    gesture.done = true;
    swipe(gesture.idx, along > 0 ? 1 : -1);
  }

  function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (!g.done) tap(g.idx);
  }

  function swipe(idx, dir) {
    if (idx < 0 || !board[idx] || finished || performance.now() < lockedUntil) return;
    const move = P.movesFrom(board, idx).find((m) => m.to === idx + 2 * dir);
    if (move) play(move);
    else { select(-1); reject(idx); }
  }

  function tap(idx) {
    if (finished || performance.now() < lockedUntil) return;
    if (selected >= 0) {
      const move = dests.find((m) => m.to === idx);
      if (move) { play(move); return; }
    }
    if (idx < 0 || !board[idx] || idx === selected) { select(-1); return; }
    if (P.movesFrom(board, idx).length === 0) { select(-1); reject(idx); return; }
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

  function updateHud(bump) {
    const best = progress.cleared[stage().id];
    setText('left', P.count(board), bump);
    setText('moves', moves, false);
    setText('best', best === undefined ? '-' : best, false);
    el('stage-name').textContent = stage().name;
    const goal = stage().goal;
    el('goal').innerHTML = `ブロックを <b>${goal}個</b> だけ残そう`;
  }

  function openDialog(d) {
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function startStage(idx, withSound) {
    stageIdx = idx;
    board = P.newBoard(stage());
    moves = 0;
    combo = 0;
    finished = false;
    selected = -1;
    dests = [];
    lockedUntil = 0;
    saveProgress();
    buildBoard();
    layout();
    updateHud(false);
    if (withSound) S.start();
  }

  function updateSoundButton() {
    el('btn-sound').classList.toggle('off', S.muted);
    el('btn-sound').textContent = S.muted ? '🔇' : '🔊';
  }

  // ---------- 起動 ----------
  loadProgress();
  startStage(stageIdx, false);
  updateSoundButton();
  new ResizeObserver(layout).observe(areaEl);

  // 細い盤でも押しやすいよう、盤のまわりの空きも含めた領域全体で受け付ける（盤の長い方向の位置だけで判定する）
  areaEl.addEventListener('pointerdown', onDown);
  areaEl.addEventListener('pointermove', onMove);
  areaEl.addEventListener('pointerup', onUp);
  areaEl.addEventListener('pointercancel', () => { gesture = null; });

  el('btn-reset').addEventListener('click', () => startStage(stageIdx, true));
  el('clear-again').addEventListener('click', () => { closeDialog(el('dlg-clear')); startStage(stageIdx, true); });
  el('clear-next').addEventListener('click', () => {
    closeDialog(el('dlg-clear'));
    if (P.STAGES[stageIdx + 1]) startStage(stageIdx + 1, true);
  });
  el('stuck-again').addEventListener('click', () => { closeDialog(el('dlg-stuck')); startStage(stageIdx, true); });
  el('btn-rules').addEventListener('click', () => openDialog(el('dlg-rules')));
  el('rules-close').addEventListener('click', () => { S.unlock(); closeDialog(el('dlg-rules')); });
  el('btn-sound').addEventListener('click', () => {
    S.setMuted(!S.muted);
    updateSoundButton();
    S.select();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') select(-1);
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (dir && selected >= 0) { e.preventDefault(); S.unlock(); swipe(selected, dir); }
  });

  if (!storageGet(SAVE_KEY + '-seen')) {
    storageSet(SAVE_KEY + '-seen', '1');
    openDialog(el('dlg-rules'));
  }

  // 自動テスト用（URL に ?debug を付けたときだけ）
  if (/[?&]debug\b/.test(location.search)) {
    window.__test = {
      info: () => ({ left: P.count(board), moves, finished, vertical, size, stage: stage().id }),
      // i 番目（0 始まり）のマスの中心（画面座標）と、スワイプの向きの単位ベクトル
      point: (i) => {
        const rect = trackEl.getBoundingClientRect();
        const c = (i + 0.5) * size;
        return vertical
          ? { x: rect.left + size / 2, y: rect.top + c, ax: [0, 1], size }
          : { x: rect.left + c, y: rect.top + size / 2, ax: [1, 0], size };
      },
    };
  }
})();
