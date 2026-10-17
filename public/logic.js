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

  const CELLS = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isCell(r, c)) continue;
      const i = r * SIZE + c;
      CELLS.push(i);
    }
  }

  // ペグの色番号（出身の区画で決まる。動かしても変わらない）
  const COLOR = { center: 1, top: 2, right: 3, bottom: 4, left: 5 };

  function newGame() {
    const board = new Array(SIZE * SIZE).fill(0);
    for (const i of CELLS) {
      board[i] = i === CENTER ? 0 : COLOR[regionOf(Math.floor(i / SIZE), i % SIZE)];
    }
    return { board, score: 0, moves: 0 };
  }

  function cloneState(s) {
    return { board: s.board.slice(), score: s.score, moves: s.moves };
  }

  function movesFrom(board, from) {
    if (!board[from]) return [];
    const r = Math.floor(from / SIZE), c = from % SIZE;
    const out = [];
    for (const [dr, dc] of DIRS) {
      const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
      if (!isCell(r2, c2)) continue;
      const over = r1 * SIZE + c1, to = r2 * SIZE + c2;
      if (board[over] && !board[to]) out.push({ from, over, to });
    }
    return out;
  }

  function legalMoves(board) {
    const out = [];
    for (const i of CELLS) out.push(...movesFrom(board, i));
    return out;
  }

  // 1手を適用して新しい状態を返す。元の状態は変更しない。
  function applyMove(state, move) {
    const s = cloneState(state);
    s.board[move.to] = s.board[move.from];
    s.board[move.from] = 0;
    s.board[move.over] = 0; // 飛び越えたペグを取る
    s.score += 1;
    s.moves += 1;

    return { state: s, gained: 1 };
  }

  const PegLogic = { SIZE, CENTER, CELLS, isCell, regionOf, COLOR, newGame, cloneState, movesFrom, legalMoves, applyMove };

  if (typeof module !== 'undefined' && module.exports) module.exports = PegLogic;
  else root.PegLogic = PegLogic;
})(typeof self !== 'undefined' ? self : this);
