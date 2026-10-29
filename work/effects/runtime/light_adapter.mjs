/* 演出の光(花びら45区画・縁LED24区画)を、本番の光層packが読む LightingFrame.q へ書き込む変換。
 *   const ad = new LightAdapter({ geom, sources: manifest.lighting.sources });
 *   ad.apply(F, lightingFrame, time)   // play の draw 内で、hr.setLightingFrame の直前に1回だけ呼ぶ(最終の書き手)
 * 光層の source_id との対応(どれか1つで指定できる):
 *   - manifest.lighting.sources[id] = { petal: 0..44 } | { edge: 0..23 }
 *   - もしくは source_id が geometry.json の名前(PETAL_P1_Z0 / EDGE_TOP_00 …)と一致(大文字小文字・-/_ は区別しない)
 * 対応のない source_id は触らない(従来の LightingDriver の値がそのまま残る)。
 */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const hsv = (h, s, v) => {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  // Only the selected RGB triple escapes; do not allocate the other five.
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p]; case 1: return [q, v, p];
    case 2: return [p, v, t]; case 3: return [p, q, v];
    case 4: return [t, p, v]; case 5: return [v, p, q];
  }
};
const toLin = (c) => (c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4));

/** 合成後の7穴×RGBを、色の比率を保ったまま各口の最大成分が上限(筐体側は0..8を超えると例外)以下になるよう縮める。上限以下の値は変えない */
function clampTriples(a, max) {
  for (let i = 0; i + 2 < a.length; i += 3) { const m = Math.max(a[i], a[i + 1], a[i + 2]); if (m > max) { const f = max / m; a[i] *= f; a[i + 1] *= f; a[i + 2] *= f; } }
  return a;
}

export class LightAdapter {
  constructor({ geom, sources = {}, rainbowGain = 1 }) {
    this.geom = geom; this.rainbowGain = rainbowGain; this.map = new Map(); this.unmapped = [];
    const byName = new Map();
    geom.petals.forEach((p, i) => byName.set(norm(p.name), { petal: i }));
    geom.edge.forEach((e, i) => byName.set(norm(e.name), { edge: i }));
    this.byName = byName; this.setSources(sources);
  }
  /** manifest.lighting.sources を渡して対応表を作り直す。戻り値: 対応が付いた数 */
  setSources(sources) {
    this.map.clear(); this.unmapped = []; (this._missingIds ||= new Set()).clear();
    for (const [id, spec] of Object.entries(sources || {})) {
      let m = null;
      if (spec && Number.isInteger(spec.petal)) m = { petal: spec.petal };
      else if (spec && Number.isInteger(spec.edge)) m = { edge: spec.edge };
      else if (spec && spec.name && this.byName.has(norm(spec.name))) m = this.byName.get(norm(spec.name));
      else if (this.byName.has(norm(id))) m = this.byName.get(norm(id));
      if (m) this.map.set(id, m); else this.unmapped.push(id);
    }
    return this.map.size;
  }
  /** id を直接渡す形(sources の無い層でも、名前が合えば使える) */
  mapId(id) { if (this.map.has(id)) return this.map.get(id); if (this._missingIds.has(id)) return null; const m = this.byName.get(norm(id)); if (m) this.map.set(id, m); else this._missingIds.add(id); return m || null; }
  /** 縁LEDの1区画の色(線形RGB): 虹B → 乗算 → 上書き → 加算。stage(3Dデモ)と同じ順序 */
  edgeColor(F, i, t) {
    const e = F.edge, pf = this.geom.edge[i].pf, base = e.base || { amount: 1, speed: 1 };
    const hue = ((pf - t * .12 * (base.speed || 1)) % 1 + 1) % 1, c = hsv(hue, 1, 1).map(toLin);
    const g = (base.amount ?? 1) * this.rainbowGain, a = e.ovrA[i], m = e.mul[i], A = F.ambient ?? 1;
    const k = this.geom.edge[i].name.startsWith('EDGE_BOTTOM') ? (this.bottomK ?? 1) : 1;   // 皿の縁(下辺)の縁LEDは、囲いの内側だけ照らす指示のため弱められる
    return [0, 1, 2].map((q) => ((c[q] * g * m) * (1 - a) + e.ovr[i * 3 + q] * a + e.add[i * 3 + q]) * A * k);
  }
  /** 定常E(ロゴ・入賞口7・7セグ5・ボタン2)の目標値。花びら/縁の q とは独立の受け口。
   *  stage2a の env は0灯の常時E(口の赤LED・ロゴ・表示)をAに折り込み済みで、灯数で ea/eb が下がると一緒に暗くなる。
   *  光層が個別のE sourceを持てば、これを「絶対量(線形RGB)」として足し、envからは同量を引く。
   *  それまでは lf.steadyE に置くだけで描画は変えない(消費側が無ければ無害)。 */
  steadyE(F) {
    const A = F.ambient ?? 1, k = (v) => v * A;
    if (!F.logo || !F.pocket || !F.btn || !F.seg) return null;   // 光の無い最小フレーム(接続確認など)
    return {
      mode: 'absolute-linear-rgb',
      logo: F.logo.map(k),
      pocket: clampTriples(Float32Array.from(F.pocket, (v) => v * Math.max(A, .8)), 7.9),   // 7穴 × RGB。入った穴の口の灯は、演出の暗転(ambient)で消えないようにする(レビューe07)
      btn: Float32Array.from(F.btn, k),         // 左・右 × RGB
      seg: { meter: F.seg.meter.slice(), blink: F.seg.blink, mode: F.seg.mode },
    };
  }
  /** lf.q の該当 source を演出の値で書き換える。lf は LightingDriver.frame の戻り値 */
  apply(F, lf, t, ids) {
    if (!F || !lf) return lf; const q = lf.q || (lf.q = {}), A = F.ambient ?? 1;
    lf.steadyE = this.steadyE(F);
    for (const id of ids || (this._ids ||= [...Object.keys(q)])) {
      const m = this.mapId(id); if (!m) continue;
      if (m.petal !== undefined) { const o = m.petal * 3; q[id] = { rgb: [F.petal[o] * A, F.petal[o + 1] * A, F.petal[o + 2] * A] }; }
      else q[id] = { rgb: this.edgeColor(F, m.edge, t) };
    }
    return lf;
  }
}
export default LightAdapter;
