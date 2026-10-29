// JP(大当たり)系の音の専用出口 (2026-10-29 音の修正)。
// r2エンジンの最終段は mix → hp → lp → DynamicsCompressor(閾値 -12dB・比 8:1) → master → 天井(tanh) で、
// 圧縮機を通ると -12dB を超える強い音がどれも同じ大きさ(最終ピーク -6〜-8 dBFS)に潰れ、「最大レベルの段差」が作れない。
// JPと、その後(継続・確定・結果)の音はこの出口へ入れ、圧縮機の「後」(master の入口)で合流させる。
//   - 音量の自動調整は一切しない(固定ゲインのみ)。master のゲイン(音量つまみ)と最後の天井(tanh: 静的な飽和でクリップ防止)は通常時と共通。
//   - 通常時の音(玉・釘・点灯のSE・通常BGM)の経路は変えない。
// 出口のゲインは +6.3dB の固定。圧縮機を通る経路は、弱い音(閾値 -16dB 以下)に自動のメイクアップ +6.3dB が付くので、
// 小さい音は従来と同じ大きさのまま、強い音だけ圧縮されずに伸びる。
// 使い方: const hot = hotBus(engine); node.connect(hot);
const buses = new WeakMap();
export function hotBus(engine) {
  let g = buses.get(engine);
  if (!g) { g = engine.ctx.createGain(); g.gain.value = 10 ** (6.3 / 20); g.connect(engine.master); buses.set(engine, g); engine.hot = g; }
  return g;
}
