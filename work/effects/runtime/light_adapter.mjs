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
// 11/1 毎コマの一時配列を省く版(値は同じ演算順)。?allocfix=0 で従来。
const ALLOCFIX = (() => { try { return new URLSearchParams(globalThis.location?.search ?? '').get('allocfix') !== '0'; } catch { return true; } })();
const hsvLinInto = (h, out) => {
  const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f * 1, t = 1 - (1 - f) * 1;   // s=1, v=1 (hsv と同じ式)
  let r, g, b;
  switch (((i % 6) + 6) % 6) {
    case 0: r = 1; g = t; b = 0; break; case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = t; break; case 3: r = 0; g = q; b = 1; break;
    case 4: r = t; g = 0; b = 1; break; default: r = 1; g = 0; b = q; break;
  }
  out[0] = toLin(r); out[1] = toLin(g); out[2] = toLin(b); return out;
};

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
  /** edgeColor の一時配列なし版。結果は同じ値(同じ演算順)。out(長さ3)へ書いて返す */
  edgeColorInto(F, i, t, out) {
    const e = F.edge, ge = this.geom.edge[i], base = e.base || { amount: 1, speed: 1 };
    const hue = ((ge.pf - t * .12 * (base.speed || 1)) % 1 + 1) % 1;
    hsvLinInto(hue, out);
    const g = (base.amount ?? 1) * this.rainbowGain, a = e.ovrA[i], m = e.mul[i], A = F.ambient ?? 1;
    const k = ge.name.startsWith('EDGE_BOTTOM') ? (this.bottomK ?? 1) : 1;
    for (let c = 0; c < 3; c++) out[c] = ((out[c] * g * m) * (1 - a) + e.ovr[i * 3 + c] * a + e.add[i * 3 + c]) * A * k;
    return out;
  }
  steadyE(F) {
    const A = F.ambient ?? 1, k = (v) => v * A;
    if (!F.logo || !F.pocket || !F.btn || !F.seg) return null;   // 光の無い最小フレーム(接続確認など)
    if (ALLOCFIX) {   // 持ち回りの入れ物へ書く(毎コマ新しい配列を作らない)。値と演算順は同じ
      let se = this._se;
      if (!se || se.logo.length !== F.logo.length || se.pocket.length !== F.pocket.length || se.btn.length !== F.btn.length || se.seg.meter.length !== F.seg.meter.length) {
        se = this._se = { mode: 'absolute-linear-rgb', logo: new Array(F.logo.length).fill(0), pocket: new Float32Array(F.pocket.length), btn: new Float32Array(F.btn.length), seg: { meter: new Array(F.seg.meter.length).fill(0), blink: 0, mode: '' } };
      }
      for (let i = 0; i < F.logo.length; i++) se.logo[i] = F.logo[i] * A;
      const pk = Math.max(A, .8);
      for (let i = 0; i < F.pocket.length; i++) se.pocket[i] = F.pocket[i] * pk;
      clampTriples(se.pocket, 7.9);
      for (let i = 0; i < F.btn.length; i++) se.btn[i] = F.btn[i] * A;
      for (let i = 0; i < F.seg.meter.length; i++) se.seg.meter[i] = F.seg.meter[i];
      se.seg.blink = F.seg.blink; se.seg.mode = F.seg.mode;
      return se;
    }
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
      if (ALLOCFIX) {   // 対応ごとに持ち回りの {rgb} を書き換える(毎コマ新しい物を作らない)。同じ対応を指すidは同じ値なので共有してよい
        const o = m._q || (m._q = { rgb: [0, 0, 0] }), r = o.rgb;
        if (m.petal !== undefined) { const j = m.petal * 3; r[0] = F.petal[j] * A; r[1] = F.petal[j + 1] * A; r[2] = F.petal[j + 2] * A; }
        else this.edgeColorInto(F, m.edge, t, r);
        q[id] = o; continue;
      }
      if (m.petal !== undefined) { const o = m.petal * 3; q[id] = { rgb: [F.petal[o] * A, F.petal[o + 1] * A, F.petal[o + 2] * A] }; }
      else q[id] = { rgb: this.edgeColor(F, m.edge, t) };
    }
    return lf;
  }
}
export default LightAdapter;
