# R2 ソフトウェア描画の同一出力経路

通常GPUでは従来の描画経路とHalfFloat中間を使う。SwiftShader、llvmpipe等をGLの実デバイス名から検出した場合だけ、同じ画像をより安く作る経路を使う。解像度1440×2560、MSAA4、球の形、反射atlas、光源数、ネイティブ画素、補間と演出時間は変えない。

- `?reuse=reference`：従来経路を固定。
- `?reuse=exact`：同一出力の新経路を固定（比較用）。
- 引数なし：実デバイス名で自動選択。

新経路は、厳密なRGBゼロ領域の描画除外、同じ4サンプル内での奥と3Dの合成、Float32中間、同じ57格子・四面体のLUT係数表、環境光の同一基底のキャッシュ、反射の同一係数・参照行の再利用を使う。HalfFloatの丸め順との差は画素比較で検査する。品質を落とす段階はない。

`window.__play.hr.stats.renderReuse` に実デバイス名、自動検出結果と実際の経路が残る。追加の細かな統計は同じstatsのsparseLayers、floatTargets、mergedBack、affineLut、environmentBasis、probeReuse。

再配布は通常のmake_release.pyに続けてrelease_copy.pyを実行する。後者が追加モジュールとR2資産をコピーし、実配布ファイルのSHA256をrelease_receipt.jsonへ残す。大きな測定生データ・候補コピー・動画はソースGitに含めない。

試験・画素差・時間の根拠は `../perf/lowend_r2/`。固定166玉の短い描画診断と、実際の通しプレイを区別して報告する。

## 同じ盤面光の共用

GPUなしの表裏で同じ44灯の計算を1回へまとめ、Float32入力が変わるときだけ更新する。表裏のマスク・位置・色が異なる場合は元の式へ戻す。1440×2560、MSAA4、光の式と順序は維持。画素差・通し結果は `../perf/lowend_r2/INTEGRATED_RENDER.md` を参照。

## Surface向け・通常GPUの既定経路

GPUありでも、同じ出力の疎領域化、不要なMSAA resolveの削除、同一マッピングの合計アトラス、反射係数のFloat32 uniform化を使う。主RTは従来のRGBA16F/MSAA4、手前はRGBA16F、LUTも従来形式を保つ。環境光/盤面光の大きなFloat32キャッシュはGPUなしの経路で使う。

光の入力が同じbucketは属性を詰め直さない。GPU向けの疎矩形の重みは、元のFloat32配列を共有する11,616 bytesの表から同じ値を読む。位置・解像度・補間・加算順序・光の数・時刻は維持する。sum atlasは元のネイティブ画素をRGBA16Fへ同じ順序で加算し、入力が変わった矩形だけ更新する。

詳細と根拠・画素比較・再生成は `../perf/lowend_r2/SURFACE_PERF.md`。`?reuse=reference` で描画再利用を外し、`?reuse=exact` は従来どおりGPUなし用の同一出力経路を強制する。品質段階は設けない。
