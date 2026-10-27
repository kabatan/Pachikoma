# 10/26 本番ゲーム組み込み

**引数なしの既定を「R3＋m3筐体＋試作14由来の本番動画液晶」にした。通常演出22本を1152×1268で作り直して接続済み。JP映画は未接続で、未完成場面は仮表示。既定構成の通しプレイ・精算・連続再生は確認済み。**

## 開き方

プロジェクトルートで `./work/game_demo/play/start.sh` を実行し、表示されたURLをそのまま開く（通常 `http://127.0.0.1:8800/game_demo/play/index.html`）。左／Spaceで開始・発射・継続、右／Cで連チャン確定。Aは追加、Bは計数、Rは次のお客、Kはモニタ回転。

`?cabinet=r2` で旧筐体を残した。旧Canvas液晶の `?lcd=legacy` は残件があるため、通常は指定しない。

## 変えたこと

| 対象 | 実装・確認内容 |
|---|---|
| ルール | 既定の `work/game_tuning/r3/config_r3.json` → `rules_r3.json` を実ブラウザでも確認。任意の勝負廃止、6灯JP、継続ラッシュ、初回配当保持、時計継続を維持。72秒・80玉、追加22秒・10玉／最大4回。 |
| 10/24調整 | 配当30/40/100/200/500、重み700000/200000/50000/49996/4を確認。景品はJP確定配当でC30／B200／A320、Sは500配当確保時のみ。規則JSONの数値は変更していない。 |
| 筐体 | m3を既定化。[pack1026](m3/pack1026/manifest.json)を新設。物理R3盤を正に釘82本（PIN_0082を追加）、穴1・4・7の口幅20／20／42mmに合わせた。メーターをC/B/A/Sの4枠へ修正し、光の合成から混入する旧SSの絵も除いた。 |
| 通常映像 | 固定26秒の台本をゲームイベントで選ぶ22本へ分割。偽の発射時刻・未来の6灯を予知する助走を除去。実発射の反応、動画と同じフレームの筐体光、実際の穴LEDを接続。 |
| R3の重複 | 1〜3灯は保護。4灯以上到達後の保護2回を経て消灯。試作の3→2灯の昇天は使わず、4→3／5→4灯の映像に組み替えた。新しい入賞が来たら最新状態を優先する。 |
| イベント・払い出し | `paramsOf()`を共通化し、chain／lamps／pending／base／chainStage／chainLost／banked／paid等を中継。未確定の連勝配当は払い出さず、確定時に解放する。未確定配当を台帳検査が一瞬加算する不整合も修正。 |
| 説明・配信 | READMEと旧液晶のR3説明を更新し、旧「勝負で何玉」の表示を抑止。サーバーに動画MIMEとHTTP Rangeを追加。 |

## 本番画質と素材

背景・上レイヤ・花弁を **scale=1、1152×1268、96 samples** で再レンダー。雲も元の1152×1268素材から作り直した。半解像度の元レンダーとJPEG88中間画像は使わず、合成のPNGマスター2,551枚を保存した。ドット絵の整数倍表示は原作どおり。

| 場面 | 本数・接続 |
|---|---|
| 通常ループ | idle0〜idle6の7本。最終228フレーム＝7.6秒、継ぎ目12フレームを重ねる。 |
| 点灯 | 1〜6灯の8本（3灯・4灯は各2種）。実レシートの灯数で選択。 |
| 重複 | 保護1〜5灯の5本、消灯4→3／5→4灯の2本。 |
| 動画仕様 | 全22本、1152×1268・30fps、H.264 High／CRF12／yuv420p／BT.709、GOP30、faststart。実測32.75〜44.34Mbps、計387.6MB。 |

本番動画とマニフェストは [lcd_surface/production1026](lcd_surface/production1026/manifest.json)、PNG元レイヤとマスターは `work/effects/normal_fx/production1026/`。等倍比較で文字の崩れや目立つブロックノイズは見られなかった。動画は非可逆なので、可逆PNGも残している。[比較画像・全22本の検査](out/integration1026_quality/report.json)。

再生成は `tools/render_sources_1026.py`（**GPUは必ずルートのtools/gpu_run.py経由**）→ `tools/export_normal_1026.py`（CPU合成・x264）。筐体の生成スクリプトは `m3/project_holes_r3_1026.mjs`、`fit_holes_r3_1026.py`、`proj_pins.mjs`、`build_m3.py`。

## 確認結果

| 確認 | 結果 |
|---|---|
| 引数なしの実ブラウザ | 待機→説明→開始→通常→点灯→保護→リセット→6灯→JP→継続→連勝→確定→払い出し→時間切れ→追加→計数→結果。財布136玉＝計数136玉、台帳差0、lost 0。既定ゲームのコンソール・ページ・HTTPエラー0。JP映画へのリクエスト0。 |
| 操作fixtureの範囲 | キーで発射した支払い済みの実Rapier球だけを穴の上へ移動。入賞受付・抽選・規則は本物。最後の時間切れ2回は残り時間を0.2秒へ短縮した。通常速度45秒の試験はこの操作補助を使わない。 |
| 既存QA | `qa.mjs` manual 30秒、pack 2秒とも合格。manualの89玉計数一致・強制回収0。packは定数光の検査なので筐体合成・動画・演出光・室内補光を除外し、元の期待値を維持した。 |
| ルール・物理テスト | `test_r3`、`test_rules`、`config_test`、`effects_test`、`effects_play_test`、`howto_test`、`lighting_test`、`session_log_test`、既存物理`integration_test`、R3盤の`play_test`が合格。追加の`integration_1026_test`と`r3_chain_physics_1026_test`で保護・未確定配当・確定・計数を回帰確認。 |
| 旧筐体・画面寸法 | `?cabinet=r2`＋動画液晶の起動も合格。2560×1440・DPR1・K回転で画面を等倍充填、内部1440×2560、液晶可視部1152×1268を確認。 |

検査の集約は [integration1026_verification.json](out/integration1026_verification.json)。生記録の `integration1026_v4/report.json` は **defaultPassed=true**。その後に追加した旧Canvas互換検査だけがクラッシュし全体のpassedがfalseになっているため、集約では区別した。生記録は改変していない。

スクリーンショットは [out/integration1026_v4](out/integration1026_v4/)。[待機](out/integration1026_v4/00_attract.png)、[4灯](out/integration1026_v4/09_lamp4.png)、[4→3灯](out/integration1026_v4/10_reset4.png)、[継続選択](out/integration1026_v4/17_choice_pending.png)、[結果](out/integration1026_v4/22_result.png)、[WQHD回転表示](out/integration1026_v4/24_wqhd_rotated.png)等を保存し、画像を開いて目視した。

## 性能・仮の箇所・残件

**Linux／RTX 5090／同梱Chromiumの45秒連続再生**：rAF平均16.666ms、p95 16.7ms、p99 16.8ms、33.4ms超0／2,691フレーム。計測終了時の両動画のdropped/corruptedは0、液晶Canvas描画の最大5.6ms。起動約3.7秒。画質を下げる対処はしていない。MediaCapabilitiesはsupported/smooth=true、powerEfficient=false。本番Windows機・Edge・ESP32実機での性能と操作は未確認。

- **仮**：待機、開始前説明、貸玉、JP挑戦／JP配当、連チャン選択・確定・失敗、時間切れ、追加、計数、結果は海のループに題字と実数を重ねる簡単な表示。`normal_surface_1026.mjs`とmanifestにも「仮／temporary」を明記。専用ルーレット映画はなく、通常重複は上記のP14消灯映像で扱う。JP映画の接続は行っていない。
- **旧Canvas互換経路の不具合**：`?lcd=legacy`は起動中にChromiumのTarget crashedを複数回再現。原因は未確定。旧筐体＋動画液晶は正常なので、旧筐体利用時も動画液晶を使う。
- **配布**：今回は作業ツリーのローカル起動まで。既存`tools/make_release.py`は変更ファイルをHEAD版へ戻し未追跡ファイルを除外するため、この未コミット構成の配布にはそのまま使えない。配布ZIPは作成していない。

変更した既存ファイルの元版は同じ場所の `*_pre1026.*` に保存。[バックアップ一覧](integration1026_backups.json)16件の存在・SHA-256一致を確認。旧素材・旧packは削除せず保持。gitコミット、`pkill -f`の使用はしていない。
