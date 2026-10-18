// ペグブロックのルール本体（描画から独立。ブラウザと Node の両方で動く）
(function (root) {
  'use strict';

  const SIZE = 7;
  const CENTER = 3 * SIZE + 3;
  const DIRS = [['up', -1, 0], ['down', 1, 0], ['left', 0, -1], ['right', 0, 1]];

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

  // from のコマが動ける先。上下左右それぞれの向きで、すぐ隣から同じ数字のコマがいくつか連続して並び（1 個以上、何個でもよい）、
  // その次が空きマスなら、そこへ飛び越えて動ける。途中に違う数字のコマや盤の外が来たら、その向きには動けない。
  // 返す手: { from, over: 飛び越えるコマのマス（近い順）, to, dir: 'up' | 'down' | 'left' | 'right' }
  function movesFrom(board, from) {
    const v = board[from];
    if (!v) return [];
    const r = Math.floor(from / SIZE), c = from % SIZE;
    const out = [];
    for (const [dir, dr, dc] of DIRS) {
      const over = [];
      for (let k = 1; ; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!isCell(rr, cc)) break;
        const i = rr * SIZE + cc;
        if (board[i] === 0) {
          if (over.length) out.push({ from, over, to: i, dir });
          break;
        }
        if (board[i] !== v) break;
        over.push(i);
      }
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
    const merged = v * 2;   // 何個飛び越えても、数字は 1 回だけ 2 倍になる
    s.board[move.from] = 0;
    for (const i of move.over) s.board[i] = 0;
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
