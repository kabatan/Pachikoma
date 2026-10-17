# 10/18：r2録画クラッシュの調査・対策

公開版が適用済みの本体は編集せず、runtime/audio_engine.mjsだけを修正した。BGMは現代寄りg4、168BPM、release_default_on:trueのまま。声既定OFF、getPhaseによるFault停止、20ms flush、出力リミッタ、voice providerは維持。

## 確認した障害と因果の限界

元コード＋指定rec_r2.mjsで失敗を再現。30秒表示後、録画起動から約130.2壁秒で `Unable to capture screenshot`。直前のChromeログに `VALIDATION_ERROR_DESERIALIZATION_FAILED`、`viz.mojom.CopyOutputResultSender`、GPUプロセスのexit code 9を記録した。renderer RSS最大2769.3MiB。今回の再現で直接確認できた故障箇所はChromeのGPUコピー出力／IPC。Target crashedの全ケースが同じ原因だったとは断定していない。

BGMを無効にした統括のiso_dも60秒表示後にscreenshot失敗しており、BGMの再生は失敗の必要条件ではない。計測を加えた元コードは60秒成功した。したがって、r2との相関だけからBGMデコード・メモリリーク・20ms処理をクラッシュの単独原因と決めつけない。

元コードの計測付き成功時はBGM source最大3、SE等最大10、物理バッファcache最大96。JS heapは約1059〜1143MiBで、単調な増大は確認していない。現BGMの8本の展開後見込みは約62.9MiB。声はoff、Fault中の停止経路を通っていない場面でも障害が起きており、これらを原因とする証拠は得られなかった。

## runtimeで直した処理

20msのflushで `bgm.tick → setBgmPlaying → _duck` と末尾の `_duck` が重複し、さらに発音ごとにも、同じgain目標をAudioParamへ再予約していた。

- BGM再生中フラグが変わらない場合はsetterからduckを再実行しない。
- win／SE／物理／BGMの4 gainは目標値を比較し、変化時だけ予約する。
- 変化時はcancelAndHoldAtTimeで現在の補間値を保持してから新しい目標へ。JP冒頭の正確な無音は4ms直線フェードを維持。

不要なJS→WebAudio呼出しを減らす安定化対策。これだけがGPU内部障害の根本原因を除去した、という結論ではない。BGM／声を消す、音量を落とす、Fault監視を外す、といった回避は採用していない。

## 検証

実AudioContextで定常flush 10,000回に対しnative setTargetAtTimeは4回、同値抑制39,996回。4灯のgainは0.562451、声中はBGM 0.123825／SE 0.600000、JP冒頭0、解除後0.999750。共存値を維持した。[CPU結果](../qa/duck_stability_report.json)。

修正後は追加の計測コードをrec本体に挿さず、**指定の元rec_r2.mjs** をgpu_run.py経由で実行。1440×2560 headless、元のautoplayフラグ、MODE=slow、seed61、同じconfig、BGM ON。

```sh
python3 tools/gpu_run.py cabinet s-fixed120 3 -- env MODE=slow MAXSEC=120 QS='&config=work/game_tuning/playtest_1018/config.json' python3 work/audio/qa/profile_audio_rec.py work/audio/tmp/crash_1018/fixed120
```

**120.0秒／7,200フレーム完走、終了code0、page error0、GPU異常終了0。** 壁時間約382.1秒。renderer RSS最大2726.7MiB。録画はffprobeでも120秒／60fps／7,200フレームを確認（配信用の出力はrec仕様で720×1280）。ダッキング自体を無効にした対照録画も別途保存しているが、これは公開修正ではない。

- [120秒録画](../tmp/crash_1018/fixed120/master.mp4)
- [Chromeログ](../tmp/crash_1018/fixed120/chrome.log) ／ [RSS時系列](../tmp/crash_1018/fixed120/rss.jsonl)
- [全ケースの要約・元コード失敗時のGPUログ](../qa/crash_1018_report.json)
- 元コードのログ・録画は ../tmp/crash_1018/before/、計測付き元コードは instrumented/、duck無効対照は no_duck/ に保持。

CPU再検査：`node work/audio/qa/check_duck_stability.mjs`。録画には `tools/gpu_run.py` を使う。GPU IPC障害が再発した場合は、同じprofileラッパーでChromeログとRSSを残す。この120秒成功は、あらゆる条件での再発ゼロや根本原因の確定を保証するものではない。
