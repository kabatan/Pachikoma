// 音の特徴量の測定(実機の録音と自作音を同じ物差しで比べるためのもの)。ブラウザ/Nodeどちらでも動く。
// 帯域: 50-100, 100-200, 200-400, 400-800, 800-1.6k, 1.6-3.2k, 3.2-6.4k, 6.4-12.8k, 12.8-20k Hz。値は全エネルギーに対する各帯域の割合(dB)。
export const EDGES = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 20000];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export function mag(x, off, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[off + i] || 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / N));
  fft(re, im);
  const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]); return m;
}
export function bands(x, sr, t0 = 0, t1 = x.length / sr, N = 2048) {
  const acc = new Float64Array(N / 2); let c = 0;
  for (let o = Math.floor(t0 * sr); o + N <= Math.max(Math.floor(t1 * sr), Math.floor(t0 * sr) + N); o += N / 2) { const m = mag(x, o, N); for (let k = 0; k < N / 2; k++) acc[k] += m[k] * m[k]; c++; }
  const out = EDGES.slice(0, -1).map((lo, i) => { let s = 0; for (let k = 0; k < N / 2; k++) { const f = k * sr / N; if (f >= lo && f < EDGES[i + 1]) s += acc[k] / Math.max(c, 1); } return s; });
  const tot = out.reduce((a, b) => a + b) || 1; return out.map(v => Math.round(10 * Math.log10(v / tot + 1e-12)));
}
export function centroid(x, sr, t0 = 0, t1 = x.length / sr, N = 2048) {
  let sw = 0, s = 0;
  for (let o = Math.floor(t0 * sr); o + N <= Math.max(Math.floor(t1 * sr), Math.floor(t0 * sr) + N); o += N / 2) { const m = mag(x, o, N); for (let k = 1; k < N / 2; k++) { sw += m[k] * k * sr / N; s += m[k]; } }
  return Math.round(sw / Math.max(s, 1e-9));
}
export function levels(x) { let pk = 0, s = 0; for (const v of x) { pk = Math.max(pk, Math.abs(v)); s += v * v; } const rms = 10 * Math.log10(s / x.length + 1e-12), peak = 20 * Math.log10(pk + 1e-12); return { rmsDb: +rms.toFixed(1), peakDb: +peak.toFixed(1), crestDb: +(peak - rms).toFixed(1) }; }
// 無音を除いた音の長さ(最大値から-40dBを下回るまで)
export function duration(x, sr, floorDb = -40) {
  const w = Math.round(.005 * sr), env = []; for (let i = 0; i + w <= x.length; i += w) { let s = 0; for (let k = 0; k < w; k++) s += x[i + k] ** 2; env.push(10 * Math.log10(s / w + 1e-12)); }
  const mx = Math.max(...env); let first = env.findIndex(v => v > mx + floorDb), last = env.length - 1; while (last > 0 && env[last] < mx + floorDb) last--;
  return +((last - first + 1) * .005).toFixed(2);
}
export function describe(x, sr) { return { ...levels(x), dur: duration(x, sr), cent: centroid(x, sr), bands: bands(x, sr).join(',') }; }
// 帯域プロファイルの差(各帯域dBの二乗平均平方根)。小さいほど実機に近い
export function bandDistance(a, b) { const A = typeof a === 'string' ? a.split(',').map(Number) : a, B = typeof b === 'string' ? b.split(',').map(Number) : b; let s = 0, n = 0; for (let i = 0; i < Math.min(A.length, B.length); i++) { if (A[i] < -60 && B[i] < -60) continue; s += (A[i] - B[i]) ** 2; n++; } return +Math.sqrt(s / Math.max(n, 1)).toFixed(1); }
