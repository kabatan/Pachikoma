# 音源のライセンス記録(loud_fx_1101 / 2026-11-01)

| 区分 | ファイル | 由来 | ライセンス/扱い |
|---|---|---|---|
| 効果音(17本) | `sfx_ogg/*.ogg`(確認用の `sfx_wav/*.wav` は配布に含めない) | 100%自作の合成音。`src/synth_loud.py`(numpy/scipy)の数式から生成。乱数は名前から決めた固定シード | 外部の音源・サンプル・録音・配布素材は一切使っていない。権利はプロジェクトに帰属 |
| 実機の測定値 | `src/synth_loud.py` の `TARGET_WIN`(帯域配分9個の数字) | `work/audio/audiolift_1031/REFERENCE.md` の測定(実機の動画音声を BS.1770 で測った帯域配分の平均) | 数字だけを使用。実機の音のサンプル・旋律は写していない |
- 声・人の発話・AI音声・AI生成画像は使っていない。ダウンロード素材なし(記録する出典なし)。

## 書き起こし版(`lf_r_*`、2026-11-01)
| 区分 | ファイル | 由来 | 扱い |
|---|---|---|---|
| 効果音(20本) | `sfx_ogg/lf_r_*.ogg` | 100%自作の合成音(`src/synth_ref.py`)。音高・リズム・音色の「数字」だけを実機から書き起こした | 録音・サンプルは使っていない |
| 解析のみで参照した動画 | (リポジトリに含めない) | エヴァ確定音🎵 https://www.youtube.com/watch?v=F2IMn6JDnbk / エヴァ10　確定音 https://www.youtube.com/watch?v=IYX-qefiUWw / 【着信音】大当たり音 高音質 「CR戦姫絶唱シンフォギア」 https://www.youtube.com/watch?v=GF4bCyltSHw | 監督の確認用の切り出しを `scratch_1031/loud_sfx/ref_private/` にだけ置く。配布物に入れない |
