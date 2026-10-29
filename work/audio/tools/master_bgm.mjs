// 録音曲(bgm/user/normal.m4a)をゲーム用に仕上げるブラウザ用ツール。ゲーム本体は読み込まない。
// 手順: ノイズ低減 → 低域カット/高域補正 → 音量合わせ → ループ接合の焼き込み → Ogg Opusで書き出し。
// 使い方: ブラウザで任意の同一オリジンのページから import('/work/audio/tools/master_bgm.mjs') し、master() の結果を encodeOggOpus() に渡す。
import { bands as measureBands } from './measure.mjs';
const TAU = Math.PI * 2;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
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

// スペクトル減算。雑音は各周波数ビンの下位パーセンタイルから推定(曲が常に鳴っているため無音区間に頼らない)
export function denoise(x, { N = 4096, floorDb = -9, over = 1.0, pct = .2, bias = 3.6, smooth = 3 } = {}) {
  const H = N / 4, frames = Math.floor((x.length - N) / H) + 1, bins = N / 2 + 1;
  const win = Float32Array.from({ length: N }, (_, i) => Math.sqrt(.5 - .5 * Math.cos(TAU * i / N)));
  const spec = [], power = new Float32Array(frames * bins);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f * H + i] * win[i];
    fft(re, im); spec.push([re, im]);
    for (let k = 0; k < bins; k++) power[f * bins + k] = re[k] * re[k] + im[k] * im[k];
  }
  const noise = new Float64Array(bins), col = new Float32Array(frames);
  for (let k = 0; k < bins; k++) { for (let f = 0; f < frames; f++) col[f] = power[f * bins + k]; noise[k] = [...col].sort((a, b) => a - b)[Math.floor(frames * pct)] * bias; }
  const nz = new Float64Array(bins);   // 周波数方向になめらかに
  for (let k = 0; k < bins; k++) { let s = 0, c = 0; for (let d = -8; d <= 8; d++) if (k + d >= 0 && k + d < bins) { s += noise[k + d]; c++; } nz[k] = s / c; }
  const gmin = 10 ** (floorDb / 20), out = new Float64Array(x.length), prevGain = new Float32Array(bins).fill(1);
  for (let f = 0; f < frames; f++) {
    const [re, im] = spec[f], gain = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      let p = 0, c = 0; for (let d = -smooth; d <= smooth; d++) if (k + d >= 0 && k + d < bins) { p += power[f * bins + k + d]; c++; } p /= c;
      let g = Math.sqrt(Math.max(gmin * gmin, 1 - over * nz[k] / (p + 1e-20)));
      g = Math.max(g, prevGain[k] * .6);   // 急に絞らない(ワサワサ感の抑制)
      gain[k] = g; prevGain[k] = g;
    }
    for (let k = 0; k < bins; k++) { re[k] *= gain[k]; im[k] *= gain[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } else if (k === 0 || k === N / 2) im[k] = 0; }
    // 逆FFT(共役→FFT→共役)
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < N; i++) out[f * H + i] += re[i] / N * win[i];
  }
  return Float32Array.from(out, v => v / 2);   // sqrt-Hann×2回=Hann、75%重ねの総和は2
}

// 低域カットと高域補正はOfflineAudioContextのBiquadで
export async function eq(x, sr, { hpHz = 70, shelfHz = 4500, shelfDb = 3.5, airHz = 9000, airDb = 2 } = {}) {
  const ctx = new OfflineAudioContext(1, x.length, sr), b = ctx.createBuffer(1, x.length, sr); b.copyToChannel(x, 0);
  const src = ctx.createBufferSource(); src.buffer = b;
  const mk = (type, f, q, g) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; if (g) n.gain.value = g; return n; };
  const chain = [mk('highpass', hpHz, .707), mk('highpass', hpHz, .707), mk('highshelf', shelfHz, 0, shelfDb), mk('highshelf', airHz, 0, airDb)];
  chain.reduce((a, n) => a.connect(n), src).connect(ctx.destination); src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

export function rmsDb(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20); }
export function peak(x) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; }

// 目標のRMSに合わせ、天井を超える所だけ柔らかく潰す
export function levelTo(x, targetDb, { ceiling = .89, from = 0, to = x.length } = {}) {
  const g = 10 ** ((targetDb - rmsDb(x, from, to)) / 20), k = ceiling;
  return Float32Array.from(x, v => { const y = v * g; return Math.abs(y) < k * .7 ? y : Math.sign(y) * (k * .7 + (k - k * .7) * Math.tanh((Math.abs(y) - k * .7) / (k - k * .7))); });
}

// ---- 録音っぽさを取る仕上げ(実機BGM3本の測定値へ寄せる。測定は REFERENCE_MEASUREMENTS.md) ----
// 実機BGMの帯域配分(平均): 50-100 / 100-200 / 200-400 / 400-800 / 800-1.6k / 1.6-3.2k / 3.2-6.4k / 6.4-12.8k / 12.8-20k Hz
export const TARGET_BGM = [-6, -7, -8, -10, -13, -12, -13, -18, -30];
// 帯域ごとの利得を測って、ピーキングのBiquad9本で整える(長い曲でも軽い)。maxBoostは帯域ごとに指定できる
export async function eqToTarget(x, sr, target, { maxBoost = 8, maxCut = 14, passes = 3, from = 0, to = x.length, q = .9 } = {}) {
  const centers = EDGES.slice(0, -1).map((lo, i) => Math.sqrt(lo * EDGES[i + 1])), gains = new Float64Array(centers.length);
  let y = x;
  for (let p = 0; p < passes; p++) {
    const cur = bandsDb(y, sr, from, to);
    centers.forEach((_, b) => { const lim = Array.isArray(maxBoost) ? maxBoost[b] : maxBoost; gains[b] = Math.max(-maxCut, Math.min(lim, gains[b] + (target[b] - cur[b]) * .8)); });
    const ctx = new OfflineAudioContext(1, x.length, sr), buf = ctx.createBuffer(1, x.length, sr); buf.copyToChannel(x, 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const nodes = centers.map((f, b) => { const n = ctx.createBiquadFilter(); n.type = b === 0 ? 'lowshelf' : b === centers.length - 1 ? 'highshelf' : 'peaking'; n.frequency.value = b === 0 ? EDGES[1] : b === centers.length - 1 ? EDGES[b] : f; n.Q.value = q; n.gain.value = gains[b]; return n; });
    nodes.reduce((a, n) => a.connect(n), src).connect(ctx.destination); src.start();
    y = (await ctx.startRendering()).getChannelData(0);
  }
  return { y, gains: Array.from(gains, g => +g.toFixed(1)), bands: bandsDb(y, sr, from, to) };
}
const EDGES = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 20000];
function bandsDb(x, sr, from, to) { return measureBands(x, sr, from / sr, to / sr, 2048); }
// 高域の倍音を足して空気感を戻す(くぐもり対策)。fromHz以上を飽和させて生じた倍音のうち、highHz以上だけを混ぜる
export function exciter(x, sr, { fromHz = 3500, highHz = 7000, drive = 3, mix = .18 } = {}) {
  const hp = (src, fc) => { const a = Math.exp(-2 * Math.PI * fc / sr), out = new Float32Array(src.length); let lp1 = 0, lp2 = 0; for (let i = 0; i < src.length; i++) { lp1 = (1 - a) * src[i] + a * lp1; lp2 = (1 - a) * lp1 + a * lp2; out[i] = src[i] - 2 * lp1 + lp2; } return out; };   // 2次相当
  const band = hp(x, fromHz), sat = Float32Array.from(band, v => Math.tanh(drive * v) / drive), air = hp(sat, highHz), out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + mix * air[i] * 4; return out;
}
// 軽いコンプ(波形の密度を実機BGM並みに)。しきい値・比率はdB
export function compress(x, sr, { thDb = -20, ratio = 2.2, attack = .012, release = .18, makeup = 0 } = {}) {
  const th = 10 ** (thDb / 20), ca = Math.exp(-1 / (attack * sr)), cr = Math.exp(-1 / (release * sr)), out = new Float32Array(x.length); let env = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); env = a > env ? ca * env + (1 - ca) * a : cr * env + (1 - cr) * a; const g = env > th ? (th * (env / th) ** (1 / ratio)) / env : 1; out[i] = x[i] * g * 10 ** (makeup / 20); }
  return out;
}
// モノラル→擬似ステレオ。中域以上をオールパスで位相を回した成分を左右逆相で足す(L+Rは元のモノラルのまま)
export function widen(x, sr, { amount = .5, fromHz = 450 } = {}) {
  const a = Math.exp(-2 * Math.PI * fromHz / sr), hp = new Float32Array(x.length); let lp = 0; for (let i = 0; i < x.length; i++) { lp = (1 - a) * x[i] + a * lp; hp[i] = x[i] - lp; }
  const ap = (src, c) => { const o = new Float32Array(src.length); let xp = 0, yp = 0; for (let i = 0; i < src.length; i++) { yp = -c * src[i] + xp + c * yp; xp = src[i]; o[i] = yp; } return o; };
  const side = ap(ap(ap(hp, .62), -.45), .83), L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { L[i] = x[i] + amount * side[i]; R[i] = x[i] - amount * side[i]; }
  return [L, R];
}
export function stereoStats(L, R) { let sl = 0, sr_ = 0, slr = 0, em = 0, es = 0; for (let i = 0; i < L.length; i++) { sl += L[i] ** 2; sr_ += R[i] ** 2; slr += L[i] * R[i]; const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2; em += m * m; es += s * s; } return { corr: +(slr / Math.sqrt(sl * sr_ + 1e-20)).toFixed(2), sideDb: +(10 * Math.log10(es / (em + 1e-20) + 1e-12)).toFixed(1) }; }

// loopEnd直前をloopStart直前の音へ等パワーでつなぎ、loopEnd→loopStartを継ぎ目なしにする。
// loopEndの後ろにはループ先頭の続きを tail サンプル足す(コーデックの終端処理がループ点に掛からないように)
export function bakeLoop(x, { loopStart, loopEnd, xfade, tail = 4096 }) {
  const out = new Float32Array(loopEnd + tail); out.set(x.subarray(0, loopEnd));
  for (let i = 0; i < xfade; i++) {
    const t = (i + .5) / xfade, a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
    out[loopEnd - xfade + i] = x[loopEnd - xfade + i] * a + x[loopStart - xfade + i] * b;
  }
  for (let i = 0; i < tail; i++) out[loopEnd + i] = x[loopStart + i];
  return out;
}

// ---- Ogg Opus 書き出し(WebCodecs AudioEncoder) ----
const crcTable = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
function oggPage(serial, seq, flags, granule, packets, partialLast = false) {
  const segs = []; packets.forEach(p => { let n = p.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); });
  const body = packets.reduce((s, p) => s + p.length, 0), buf = new Uint8Array(27 + segs.length + body), dv = new DataView(buf.buffer);
  buf.set([0x4f, 0x67, 0x67, 0x53, 0, flags]); dv.setBigUint64(6, BigInt(granule), true); dv.setUint32(14, serial, true); dv.setUint32(18, seq, true); buf[26] = segs.length; buf.set(segs, 27);
  let o = 27 + segs.length; for (const p of packets) { buf.set(p, o); o += p.length; }
  let c = 0; for (const b of buf) c = ((c << 8) ^ crcTable[((c >>> 24) ^ b) & 255]) >>> 0; dv.setUint32(22, c, true);
  return buf;
}
// samples: Float32Array(モノラル) か [L, R]
export async function encodeOggOpus(samples, { sampleRate = 48000, bitrate = 96000, preSkip = 312 } = {}) {
  const chans = Array.isArray(samples) ? samples : [samples], channels = chans.length;
  const frame = 960, total = chans[0].length, padded = Math.ceil(total / frame) * frame, chunks = [];
  let head = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); chunks.push(d); if (meta?.decoderConfig?.description) head = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description); }, error: e => { throw e; } });
  enc.configure({ codec: 'opus', sampleRate, numberOfChannels: channels, bitrate, opus: { application: 'audio', frameDuration: 20000, complexity: 10 } });
  for (let o = 0; o < padded; o += frame) {
    const d = new Float32Array(frame * channels); chans.forEach((c, k) => d.set(c.subarray(o, Math.min(total, o + frame)), k * frame));
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: frame, numberOfChannels: channels, timestamp: Math.round(o / sampleRate * 1e6), data: d }));
  }
  await enc.flush(); enc.close();
  if (!head || String.fromCharCode(...head.slice(0, 8)) !== 'OpusHead') {
    head = new Uint8Array(19); head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, channels]); new DataView(head.buffer).setUint16(10, preSkip, true); new DataView(head.buffer).setUint32(12, sampleRate, true);
  }
  const skip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
  const vendor = new TextEncoder().encode('pachikoma'), tags = new Uint8Array(8 + 4 + vendor.length + 4); tags.set(new TextEncoder().encode('OpusTags')); new DataView(tags.buffer).setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const serial = 0x5043484b, pages = [oggPage(serial, 0, 2, 0, [head]), oggPage(serial, 1, 0, 0, [tags])];
  let seq = 2;
  for (let i = 0; i < chunks.length; i += 25) {
    const group = chunks.slice(i, i + 25), last = i + 25 >= chunks.length;
    const granule = last ? skip + total : skip + (i + group.length) * frame;
    pages.push(oggPage(serial, seq++, last ? 4 : 0, granule, group));
  }
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of pages) { out.set(p, o); o += p.length; }
  return { bytes: out, preSkip: skip, packets: chunks.length };
}
export async function put(url, bytes) { const r = await fetch(url, { method: 'PUT', body: bytes }); if (!r.ok) throw new Error('PUT ' + url + ' ' + r.status); }
