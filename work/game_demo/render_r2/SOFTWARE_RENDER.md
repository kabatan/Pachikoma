# R2 ソフトウェア描画の同一出力経路

通常GPUでは従来の描画経路とHalfFloat中間を使う。SwiftShader、llvmpipe等をGLの実デバイス名から検出した場合だけ、同じ画像をより安く作る経路を使う。解像度1440×2560、MSAA4、球の形、反射atlas、光源数、ネイティブ画素、補間と演出時間は変えない。

- `?reuse=reference`：従来経路を固定。
- `?reuse=exact`：同一出力の新経路を固定（比較用）。
- 引数なし：実デバイス名で自動選択。

新経路は、厳密なRGBゼロ領域の描画除外、同じ4サンプル内での奥と3Dの合成、Float32中間、同じ57格子・四面体のLUT係数表、環境光の同一基底のキャッシュ、反射の同一係数・参照行の再利用を使う。HalfFloatの丸め順との差は画素比較で検査する。品質を落とす段階はない。

`window.__play.hr.stats.renderReuse` に実デバイス名、自動検出結果と実際の経路が残る。追加の細かな統計は同じstatsのsparseLayers、floatTargets、mergedBack、affineLut、environmentBasis、probeReuse。

再配布は通常のmake_release.pyに続けてrelease_copy.pyを実行する。後者が追加モジュールとR2資産をコピーし、実配布ファイルのSHA256をrelease_receipt.jsonへ残す。大きな測定生データ・候補コピー・動画はソースGitに含めない。

試験・画素差・時間の根拠は `../perf/lowend_r2/`。固定166玉の短い描画診断と、実際の通しプレイを区別して報告する。
