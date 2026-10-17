# パチコマ (Pachikoma)

筑駒文化祭向けの、ブラウザで遊べるメダルゲーム（パチンコ風）の試作です。縦長 1440×2560 / 60fps を想定しています。

## 遊び方（Windows）

1. このリポジトリを **Code → Download ZIP** でダウンロードして展開します（`git clone` でも可）。
2. `Pachikoma-Play.bat` をダブルクリックします。ブラウザが自動で開いてゲームが始まります。
3. 遊び終わったら、黒いウィンドウを閉じると止まります。

- Node.js が入っていればそれを使い、無ければ Windows 標準の PowerShell で動く簡易サーバー（`work/game_demo/play/serve.ps1`）に切り替わります。
- ブラウザは Chrome / Edge の最新版を推奨します。WebGL2 が使えるGPUが必要です。
- 展開先のパスに日本語やスペースがあっても動くように作ってありますが、Windows 実機での動作は未確認です。
- 画面が重いときは、ブラウザの「ハードウェアアクセラレーションを使用する」が有効か確認してください。

## 遊び方（macOS / Linux）

```bash
node work/game_demo/play/serve.mjs 8800 --open
```

## 中身

- `work/game_demo/` … 規則・操作・物理（Rapier 480Hz）・描画の接続
- `work/effects/` … 演出（LCD・ライト・音）
- `work/game_tuning/proto/` … 最終規則（`rules_final.json`）と設計メモ
- 3Dモデルのソース(Blender)や大きなレンダリング画像は含めていません。

## ライセンスについて

フォント（M PLUS 1p / Dela Gothic One）は SIL Open Font License 1.1 です（同梱のOFLテキスト参照）。画像・音声・ソースコードの利用条件は未設定です。再利用する場合は作者にご確認ください。
