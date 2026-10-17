# 公開版の音響統合（2026-10-18）

統括適用用。**本体へ未適用・pushなし。** 承認済みS4 runtime（6800052）に対応する。対象は `work/game_demo/play/index.html` と `play.mjs` の2ファイルだけ。

## 適用

リポジトリルートで以下を実行する。**S4パッチと第2段パッチは重ねず、この公開用パッチだけを適用する。** S4のBGM操作欄・Faultの読み取り接続を内包する。

```sh
git apply --check work/audio/runtime/INTEGRATION_RELEASE.patch
git apply work/audio/runtime/INTEGRATION_RELEASE.patch
```

適用・CPU検査で確認した入力は [INTEGRATION_RELEASE_BASE.json](INTEGRATION_RELEASE_BASE.json)。R2-Rの `?render=r2` と皿の接続を含め、音響ブロックの前後をバイト単位で維持した。適用前に本体が更新されてcheckが通らなくなったら、担当内の [build_release_patch.py](build_release_patch.py) で現状から再生成し、下記検査を再実行する。本体への書込はしないスクリプト。

## 公開時の既定と上書き

| URL指定 | 動作 |
|---|---|
| 音響指定なし／`audio=r2` | 新しいr2のSE・物理音 |
| `audio=legacy` | 従来音響へ戻す。BGM・声・クレジットのr2操作欄は出さない |
| 声指定なし／`voice=off` | 声なし、声クレジットも非表示 |
| `voice=amitaro`／`voice=hau`等 | voice_catalog登録providerだけを有効化し、そのproviderのクレジットを表示。未登録値はoffへ |
| BGM指定なし | `audio/bgm/manifest.json` の `release_default_on === true` のときだけON |
| `bgm=1`／`bgm=0` | manifestの既定より優先してON／OFF |

現行manifestには `release_default_on` が未記載なので、**今の公開既定はOFF**。未指定・真偽値以外もfalseとして扱う。作曲担当が更新するmanifestでは、ルートに次の真偽値を追加できる。

```json
"release_default_on": false
```

完成曲を既定ONにする際は `true` とする。既定フラグはページ起動時に `cache:'no-store'` で読む。起動済みページの手動ON/OFFは維持し、「BGM再読込」は曲の差替えに使う。既定方針の変更を反映するにはページを再読込する。

BGMのBPM・ファイル名・尺・ループ点・復帰小節はS4のmanifestに従う。コードへのテンポ埋込みはない。曲の差替え／再検査は [S4_HANDOFF.md](../S4_HANDOFF.md) を参照。BGM既定の読込に失敗した場合はOFFで進み、r2音源読込全体の失敗時は既存のlegacyフォールバックを保つ。

声OFFの公開ではクレジット表示要素をhiddenのままにし、内容も空にする。声を明示した場合だけ現在の `VOICE_CREDITS` にある対応表記を出す。声のprovider／素材自体は変更していない。

Fault停止は `getPhase: () => ctrl.game.phase` を渡し、S4 runtimeの20ms flushから判定する。既存のフレーム側の停止口も維持している。

## 検査

```sh
node work/audio/qa/check_release_patch.mjs
```

現在の作業ツリーで `git apply --check` を実施し、2ファイルの一時コピーに実際に `git apply` したものをCPU Chromium（`--disable-gpu`、SwiftShader）へ配信する。残りの依存資産は現ワークツリーから読み取りで配信し、本体は変更しない。一時コピーは検査後に削除する。

通し検査は実際の本番config／規則・480Hz Rapier・描画・皿・演出を利用する。`manual&nolog&howto=0&prewarm=0&seed=3` は検査用で、ゲーム時刻だけを既存のframe APIで進める。発射・計数操作はSpace/Bの入力経路。着地結果の注入や規則値の変更は行わない。CPU性能・実時間の同期・会場スピーカーの聴感はこの検査の対象外。

検査結果は [release_browser_report.json](../qa/release_browser_report.json) に保存する。r2既定、声OFF、manifest既定ON、URL上書き、声明示時クレジット、legacy復帰、`render=r2` の併用を検査する。全ケースでconsole/page errorとHTTP errorを記録する。音はAudioContextがrunningで、非空バッファのsource.start活動があることを確認する。

### 確定結果

6ケースすべて成功。`git apply --check` と一時コピーへの実適用を確認。本体2ファイルの作成前後hashは一致し、未適用。

既定の通しプレイ：実発射4球、Resultまで到達。計数11玉／財布11玉、強制収納0。AudioContext `running`、結果前のBufferSource開始29件、結果までのSE等発音35件。声の発音ログ0件、声クレジットhiddenかつ空文字。

明示したあみたろ声は実発音1件、対応クレジット表示。明示BGMは3sourceを再生予約。manifest未指定／false／trueとURL上書き、legacy復帰、`render=r2` 併用を確認。

全ケースで **console/page error 0、HTTP error 0**。全ケースのGL rendererはSwiftShader。ReadPixelsのCPU描画警告・Three.jsの多重import警告は削除せずJSONに記録した。

声ありケースの手動早送りは0.1秒ごとにイベントループへ制御を返し、実際の音声予約タイマーを進める。音声エンジンの開始間隔・予約期限は変更していない。
