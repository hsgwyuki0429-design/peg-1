# ペグブロック

1 列に並んだブロックを飛び越えて、最後の 1 個まで減らす、ステージ制のパズルです。ビルド不要の静的サイトです。

## ルール

- ブロックをスワイプすると、その方向に隣り合うブロックを 1 つ飛び越えて、その先の空きマスへ着地する（タップで選んでから移動先をタップしても動かせる）。
- 飛び越えられたブロックは盤から取られる。
- 残りのブロックがステージの目標の数（ステージ 1 は 1 個）になればクリア。動かせるブロックがなくなったら、はじめからやり直し。
- ブロックの色は最初にいた列で決まり、動かしても変わらない。
- 画面が縦長で狭いときは、盤を縦向きにして押しやすい大きさで表示する。

## ステージ

| ステージ | 盤 | 最初の並び | クリア条件 | 最短手数 |
|---|---|---|---|---|
| 1 | 1×20 | 1〜18 列が埋まっていて、19 列が空き、20 列が埋まっている | 1 個だけ残す | 18 |

ステージは `public/logic.js` の `STAGES` に、最初の並び（`O` = ブロック、`.` = 空き）とクリア条件を書くだけで増やせる。

## ファイル構成

```
public/          公開するファイル一式（Cloudflare Pages の出力ディレクトリ）
  index.html
  style.css
  logic.js       ルールとステージの定義（描画から独立。Node からも読み込める）
  game.js        盤の描画・スワイプ操作・ステージの進行
  sound.js       効果音（Web Audio で合成）
  favicon.svg
  _headers       Cloudflare Pages 用のレスポンスヘッダー
wrangler.toml    Cloudflare Pages の設定（出力ディレクトリ = public）
```

## ローカルで動かす

```sh
npx http-server public -p 8787
# → http://localhost:8787/
```

## Cloudflare Pages で公開する

Workers & Pages → Create → Pages → 「Connect to Git」でこのリポジトリを選び、Framework preset は `None`、Build command は空欄、Build output directory は `public` にする。
コマンドで出す場合は `npx wrangler pages deploy public --project-name peg-block`。
