// ペグブロックのルール本体（描画から独立。ブラウザと Node の両方で動く）
//
// 盤面は 1 列に並んだマス。ブロックは隣のブロックを飛び越えて、その先の空きマスへ移る（飛び越えたブロックは取られる）。
// board[i] は 0 = 空き、1 以上 = ブロック（数字はブロックの色番号で、最初にいた列の番号。動かしても変わらない）。
// ステージは「最初の並び」と「クリアの条件（残すブロックの数）」で決まる。
(function (root) {
  'use strict';

  // ステージの一覧。layout は先頭から順に、O = ブロック、. = 空きマス。
  const STAGES = [
    {
      id: 1,
      name: 'STAGE 1',
      // 1〜18 列が埋まっていて、19 列が空き、20 列が埋まっている（20 マス）
      layout: 'OOOOOOOOOOOOOOOOOO.O',
      goal: 1,        // 残りが goal 個になればクリア
      bestMoves: 18,  // 最短の手数（探索で確認済み）
    },
  ];

  function newBoard(stage) {
    return Array.from(stage.layout, (ch, i) => (ch === 'O' ? i + 1 : 0));
  }

  function count(board) {
    let n = 0;
    for (const v of board) if (v) n += 1;
    return n;
  }

  // from のブロックが動ける先。左右（-1 / +1）のどちらにも、隣にブロックがあり 2 つ先が空きなら動ける。
  function movesFrom(board, from) {
    if (!board[from]) return [];
    const out = [];
    for (const d of [-1, 1]) {
      const over = from + d, to = from + 2 * d;
      if (to < 0 || to >= board.length) continue;
      if (board[over] && !board[to]) out.push({ from, over, to });
    }
    return out;
  }

  function legalMoves(board) {
    const out = [];
    for (let i = 0; i < board.length; i++) out.push(...movesFrom(board, i));
    return out;
  }

  // 1 手を適用して新しい盤面を返す。元の盤面は変更しない。
  function applyMove(board, move) {
    const next = board.slice();
    next[move.to] = next[move.from];
    next[move.from] = 0;
    next[move.over] = 0;
    return next;
  }

  // 'playing' | 'cleared' | 'stuck'
  function status(board, stage) {
    const left = count(board);
    if (left <= stage.goal) return 'cleared';
    return legalMoves(board).length ? 'playing' : 'stuck';
  }

  const PegLine = { STAGES, newBoard, count, movesFrom, legalMoves, applyMove, status };

  if (typeof module !== 'undefined' && module.exports) module.exports = PegLine;
  else root.PegLine = PegLine;
})(typeof self !== 'undefined' ? self : this);
