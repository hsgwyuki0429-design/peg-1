// ペグブロックのルール本体（描画から独立。ブラウザと Node の両方で動く）
(function (root) {
  'use strict';

  const SIZE = 7;
  const CENTER = 3 * SIZE + 3;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function isCell(r, c) {
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
    return (r >= 2 && r <= 4) || (c >= 2 && c <= 4);
  }

  function regionOf(r, c) {
    if (r < 2) return 'top';
    if (r > 4) return 'bottom';
    if (c < 2) return 'left';
    if (c > 4) return 'right';
    return 'center';
  }

  // 補充の対象になる四方の 2×3
  const ARMS = { top: [], right: [], bottom: [], left: [] };
  const CELLS = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isCell(r, c)) continue;
      const i = r * SIZE + c;
      CELLS.push(i);
      const region = regionOf(r, c);
      if (ARMS[region]) ARMS[region].push(i);
    }
  }

  function newGame() {
    const board = new Array(SIZE * SIZE).fill(0);
    for (const i of CELLS) board[i] = i === CENTER ? 0 : 2;
    return { board, score: 0, moves: 0, refills: 0, maxTile: 2 };
  }

  function cloneState(s) {
    return { board: s.board.slice(), score: s.score, moves: s.moves, refills: s.refills, maxTile: s.maxTile };
  }

  function movesFrom(board, from) {
    const v = board[from];
    if (!v) return [];
    const r = Math.floor(from / SIZE), c = from % SIZE;
    const out = [];
    for (const [dr, dc] of DIRS) {
      const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
      if (!isCell(r2, c2)) continue;
      const over = r1 * SIZE + c1, to = r2 * SIZE + c2;
      if (board[over] === v && board[to] === 0) out.push({ from, over, to });
    }
    return out;
  }

  function legalMoves(board) {
    const out = [];
    for (const i of CELLS) out.push(...movesFrom(board, i));
    return out;
  }

  // 補充される数字：盤上にある一番小さい数字（2が無ければ4、4も無ければ8…）
  function refillValue(board) {
    let min = Infinity;
    for (const i of CELLS) if (board[i] && board[i] < min) min = board[i];
    return min === Infinity ? 2 : min;
  }

  // 1手を適用して新しい状態を返す。元の状態は変更しない。
  function applyMove(state, move) {
    const s = cloneState(state);
    const v = s.board[move.from];
    const merged = v * 2;
    s.board[move.from] = 0;
    s.board[move.over] = 0;
    s.board[move.to] = merged;
    s.score += merged;
    s.moves += 1;
    if (merged > s.maxTile) s.maxTile = merged;

    // 合体と得点のあとに補充。同時に空いた区画はすべて同じ数字で埋める。
    const emptied = Object.keys(ARMS).filter((k) => ARMS[k].every((i) => s.board[i] === 0));
    const refilled = [];
    if (emptied.length) {
      const value = refillValue(s.board);
      for (const arm of emptied) {
        for (const i of ARMS[arm]) s.board[i] = value;
        refilled.push({ arm, cells: ARMS[arm].slice(), value });
        s.refills += 1;
      }
    }
    return { state: s, merged, gained: merged, refilled };
  }

  const PegLogic = { SIZE, CENTER, CELLS, ARMS, isCell, regionOf, newGame, cloneState, movesFrom, legalMoves, refillValue, applyMove };

  if (typeof module !== 'undefined' && module.exports) module.exports = PegLogic;
  else root.PegLogic = PegLogic;
})(typeof self !== 'undefined' ? self : this);
