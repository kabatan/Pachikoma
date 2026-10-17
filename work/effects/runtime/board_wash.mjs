// 盤面全体を照らす電飾(演出側)。花びら45枚と縁LED24区画の「いまの色」を、盤の8か所の面光源に集めて、
// 環境パスの反射(釘・枠・ガラス・花びらの面)へ足す。ball_light.mjs の点光源と同じ口(BL.set)を使う。
// 灯数ごとの色(紺/ピンク/金)・重複ルーレットの赤・勝負の赤・JP/大成功の虹は、花びらと縁の色がそのまま盤面へ出る。
const SW = 1440, SH = 2560;
const SPOTS = [[240, 430], [1200, 430], [720, 300], [150, 1100], [1290, 1100], [230, 1800], [1210, 1800], [720, 2120]];   // 画面px: 左上/右上/上中央/左/右/左下/右下/下中央
export function makeBoardWash(geom, adapter, { radius = 640, gain = 2.2, sigma = 560 } = {}) {
  const ep = geom.edge.map((e) => [742.5 + ((e.x - 0.006) / 0.151) * 597, 1094 - ((e.y + 0.015) / 0.169) * 336]);
  const pp = geom.petals.map((p) => [p.u * SW, p.v * SH]);
  const wE = SPOTS.map((s) => ep.map((q) => Math.exp(-((q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2) / (2 * sigma * sigma))));
  const wP = SPOTS.map((s) => pp.map((q) => Math.exp(-((q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2) / (2 * sigma * sigma))));
  const sE = wE.map((w) => w.reduce((a, b) => a + b, 0) || 1), sP = wP.map((w) => w.reduce((a, b) => a + b, 0) || 1);
  const ec = new Float32Array(geom.edge.length * 3);
  return {
    SPOTS,
    /** F: Director のフレーム、t: 秒。戻り: BL.set 用の配列(盤面照射) */
    compute(F, t, { k = 1, navy = 0, ambientMin = 0, red = 0, sat = 1 } = {}) {
      if (!F || !F.edge || !F.petal) return [];
      for (let i = 0; i < geom.edge.length; i++) { const c = adapter.edgeColor(F, i, t); ec[i * 3] = c[0]; ec[i * 3 + 1] = c[1]; ec[i * 3 + 2] = c[2]; }
      const A = Math.max(F.ambient ?? 1, ambientMin), out = [];   // ambientMin: 重複ルーレット・勝負の暗転中も、盤面は深紅に照らす
      for (let s = 0; s < SPOTS.length; s++) {
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < ec.length / 3; i++) { const w = wE[s][i] / sE[s]; r += ec[i * 3] * w; g += ec[i * 3 + 1] * w; b += ec[i * 3 + 2] * w; }
        let pr = 0, pg = 0, pb = 0;
        for (let i = 0; i < pp.length; i++) { const w = wP[s][i] / sP[s]; pr += F.petal[i * 3] * w; pg += F.petal[i * 3 + 1] * w; pb += F.petal[i * 3 + 2] * w; }
        const m = gain * k * A;
        let R = (r * .9 + pr * .7) * m, G = (g * .9 + pg * .7) * m, Bc = (b * .9 + pb * .7) * m;
        // 0〜3灯は「照らさない/紺ベース」(監督 10/17): 色の明るさだけ残して紺へ寄せ、灰色の膜にならないよう弱める
        if (navy > 0) { const lum = (R + G + Bc) / 3 * .35; R = R * (1 - navy) + lum * .18 * navy; G = G * (1 - navy) + lum * .45 * navy; Bc = Bc * (1 - navy) + lum * 1.5 * navy; }
        if (sat !== 1) { const lum = (R + G + Bc) / 3; R = Math.max(0, lum + (R - lum) * sat); G = Math.max(0, lum + (G - lum) * sat); Bc = Math.max(0, lum + (Bc - lum) * sat); }   // 白っぽく褪せる場面は、色を濃く(彩度を上げる)
        { const mx = Math.max(R, G, Bc), mn = Math.min(R, G, Bc); if (mx > 1.15) { const f = 1 - (mn / mx) * (1 - 1.15 / mx); R *= f; G *= f; Bc *= f; } }   // 白い閃光で盤面全体が白飛びして玉と釘を隠さない: 白に近い成分だけ上限を設ける(彩度のある色は変えない)
        if (red > 0) { const lum = (R + G + Bc) / 3, m2 = Math.min(1, red); R = R * (1 - m2) + lum * 2.3 * m2; G = G * (1 - m2) + lum * .08 * m2; Bc = Bc * (1 - m2) + lum * .22 * m2; }   // 赤の場面は、色をクリムゾンへ寄せる(紫に濁らせない)
        out.push({ x: SPOTS[s][0], y: SPOTS[s][1], rgb: [R, G, Bc], radius, gain: 1 });
      }
      return out;
    },
  };
}
