# ペグブロック

十字盤のペグソリティアに 2048 の合体ルールを組み合わせた、1人用の得点パズル。
3D アイソメトリックのカラフルな盤で遊べます。ビルド不要の静的サイトです。

## ルール

- 7×7 のうち 33 マスを使う英国式の十字盤。開始時は中央だけが空きで、残り 32 マスは「2」。
- ペグを選び、縦か横に隣り合う**同じ数字**のペグを飛び越えて、その先の空きマスへ着地させる。
- 飛び越えられたペグは消え、動かしたペグは 2 倍になる。できた数字がそのまま得点。
- 四方の 2×3（腕）のどれかでペグが 1 個もなくなったら、その腕の 6 マスがまるごと補充される。中央の 3×3 は補充されない。
- **補充される数字は、そのとき盤上にあるいちばん小さい数字**。2 が 1 個もなければ 4、4 もなければ 8…と上がっていく。
  同時に複数の腕が空いたら、すべて同じ数字で補充される。補充は合体と得点の処理のあとに起きる。
- どのペグにも合法な手がなくなったら終了。得点・手数・補充回数・最大の数字・戻した回数を表示し、ベストは得点で記録する。
- 「戻す」は回数無制限。ヒント機能はない。

## ファイル構成

```
public/          公開するファイル一式（Cloudflare Pages の出力ディレクトリ）
  index.html
  style.css
  logic.js       ルール本体（描画から独立。Node からも読み込める）
  game.js        アイソメトリック描画と操作
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

### Git 連携（おすすめ）

1. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → 「Connect to Git」でこのリポジトリを選ぶ。
2. ビルド設定:
   - Framework preset: `None`
   - Build command: （空欄）
   - Build output directory: `public`
3. 「Save and Deploy」。以降は `main` に push するたびに自動で公開されます。

### コマンドで直接アップロード

```sh
npx wrangler pages deploy public --project-name peg-block
```
