# STAR DIGGERS

タブレット1台を2人でシェアして遊ぶ、上下分割の協力ゲーム。
中央のブロック畑を上下から掘り進めて、隠れたスターを探します。

## 遊び方

- 画面下半分＝PLAYER 1、上半分＝PLAYER 2（表示は上下反転済み）
- **自分側のエリアを指でなぞる** → 機体が指に追従して移動
- **触れている間は自動で連射**（2人が同時にタップ／ドラッグしてもOK）
- まんなかのブロックを壊して、隠された **★** を探す
- **★ の近くを掘ると光の粒**が出るので、それを頼りに探す
- ★ をすべて見つけるとステージクリア。進むほど硬いブロックとスターが増える
- 赤い **ばくだんブロック** は壊すと周囲ごと吹き飛ぶ（掘るのが速くなる）
- 掘るとチャージが溜まり、満タンで一気に貫通する大ビーム
- やられる要素はありません。時間制限もなし

## 遊ぶ

**https://twin-game.ikk-dev.jp/** — タブレットのブラウザで開くだけ。
（`https://twin-game.pages.dev/` でも同じものが動きます）
横向き・縦向きどちらでも動作します（縦向き推奨）。

## ローカルで動かす

ビルド不要。`index.html` を開くだけです。

## デプロイ

Cloudflare Pages（プロジェクト名 `twin-game`）で配信しています。

```bash
cp index.html dist/
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  npx wrangler pages deploy dist --project-name twin-game --branch main
```

## テスト

```bash
node test/input.test.js   # 入力まわりの回帰テスト
node test/play.test.js    # 掘削とステージ進行の通しテスト
node test/fuzz.js         # 画面外・不正座標を含むランダム操作30万回
```

## 技術メモ

- 依存ゼロ / 単一HTML（Canvas 2D + Pointer Events）
- マルチタッチは `pointerId → プレイヤー` の Map で管理し、
  指ごとに独立して移動・射撃を処理（同時操作で取り合いにならない）
- `touch-action: none` とデフォルト動作の抑止で、
  ドラッグ中のスクロール・ダブルタップズーム・引っぱり更新を無効化
- DPR対応（最大2倍）でRetina系タブレットでも輪郭がぼけない
- タブ復帰時の巨大 `dt` を 50ms でクランプし、すり抜けを防止
