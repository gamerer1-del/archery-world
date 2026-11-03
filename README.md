# アーチェリーワールド

スマホ横持ちで遊ぶ、本格3Dのオリジナル弓ゲームです（Android / Google Play 公開予定）。

- 左の丸: 体の向き（左右）と弓の角度（上下）
- 右の丸: 弦を引いて離すと、引いた反対方向へ矢が飛ぶ
- 5本で合計点。3Dモデルは Meshy で作る予定で、今は仮の箱

## 開発

```sh
npm install
npm run dev       # スマホから同じWi-FiでURLを開いて試せる
npm run build     # dist/index.html（1ファイル）
npm run artifact  # claude.ai に公開する artifact.html を作る
```

調整用の数値は `src/main.ts` の冒頭、カメラ位置は `src/world.ts` の `cameraHome` にあります。
