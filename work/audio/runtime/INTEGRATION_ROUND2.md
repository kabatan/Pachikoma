# 第2段の統合

第1段patchは統括が適用済み、`?audio=r2`で起動確認済み。ゲーム側正本はこの担当では編集していない。第2段では `work/audio/` のruntime・素材・voiceを更新した。

既存接続のまま新版SEと既定あみたろが読み込まれる。第2段patchは、話者の明示選択と音量パネル有効時のクレジット表示を追加する。`git apply --check`を実施済みで、適用自体は統括が行う。基準hashは [round2_patch_baseline.json](round2_patch_baseline.json)。

```sh
git apply --check work/audio/runtime/INTEGRATION_ROUND2.patch
git apply work/audio/runtime/INTEGRATION_ROUND2.patch
```

第1段patchを再適用しない。起動URL:

- `?audio=r2` または `?audio=r2&voice=amitaro`：あみたろ
- `?audio=r2&voice=hau`：VOICEVOX:雨晴はう
- `?audio=r2&voice=off`：声なし

HTMLの音声クレジットと、筐体横の [掲示文](../voice/CREDITS.md) を両方引き継ぐ。あみたろの利用規約リンクを公開物のReadme等に含め、利用開始から約1か月以内の事後報告は統括側で行う。この作業で外部への連絡はしていない。

声は同時1・実開始時刻の間隔12秒。予約は1件、高優先度で置換し、遅れすぎた予約を捨てる。JPは告知の後1.75秒で「やったぁ」を候補にするが、直前の声から12秒未満なら省略する。待機復帰/停止で予約も停止し、勝負球飛行/ルーレット/失敗/時間切れ時には予約を破棄する。購入催促・near_miss声は追加していない。

払い出し補助音は `SENSOR_PAYOUT_EXIT` の累積 `payoutExited` の差を次の物理tickで観測し、120msごとにまとめて鳴らす。払出命令の枚数をそのまま音へ変換しない。実接触1531件と実着玉55件の保存ログを使って新旧比較した。

音の上限は全体20・物理8・声1・着玉補助2。BGM担当は既存の `engine.bgmInput` へ接続できる（今回BGM側は編集していない）。声中のゲインはSE0.6、物理0.4、BGM入口0.22。声がないときも主要演出に応じて物理/BGMをダックする。

検証は [browser_report.json](../qa/browser_report.json) と [sequence_report.json](../qa/sequence_report.json)。CPUブラウザのOfflineAudioContextによる競合・発音制御・出力検査で、本体へ第2段patchを適用した通しプレイではない。統合後は声の選択とクレジット表示、停止/非表示復帰、BGMと同時の音量、実スピーカーでの高域量を確認する。
