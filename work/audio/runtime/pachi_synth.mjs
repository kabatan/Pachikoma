// 通常演出のSEと玉の音をサンプル列で合成する(原音・録音は使わない)。
// 作り方: 実機の録音(YouTubeで公開されている実機音をブラウザで再生して測定。保存・再配布はしない)の
// 「帯域ごとのエネルギー配分・音の長さ・波形の密度(crest)」を測り、その数値へ自作音を寄せる。
// 測定値は TARGET_* に残す。音階はBGM録音(F major)に合わせる。乱数は固定シードで決定論。
const TAU = Math.PI * 2;
const EDGES = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 20000];   // tools/measure.mjs と同じ帯域
export const midi = n => 440 * 2 ** ((n - 69) / 12);
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const track = (sr, sec) => new Float32Array(Math.ceil(sr * sec));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- 実機の測定値(帯域: 50-100,100-200,200-400,400-800,800-1.6k,1.6-3.2k,3.2-6.4k,6.4-12.8k,12.8-20k Hz / 全エネルギーに対するdB) ----
// 電子SE(保留変化・先読み・昇格・レバー予告)5本の平均。800Hz〜3kHzが最大で、100〜800Hzに厚みがある。
export const TARGET_SE = [-17, -13, -10, -9, -6, -7, -11, -12, -17];
// BGM(bgm/user/normal_loop.ogg)は200Hz〜1.6kHzがほぼ平らに厚く、1.6kHz以上は薄い。実測どおりのSEをそのまま重ねると、1.6〜6.4kHzでBGMを大きく上回って覆う。
// BGMの帯域に隙間をあけるため、通常のSEは400Hz〜6.4kHz(特に1.6〜3.2kHz)を抑える(激アツの4〜6灯は半分だけ抑え、BGM側のduckと併用)。
const BGM_SPACE = [0, 0, 1, 3, 3, 6, 3, 0, 0];
export const TARGET_SE_BGM = TARGET_SE.map((v, i) => v - BGM_SPACE[i]);
export const TARGET_SE_HOT = TARGET_SE.map((v, i) => v - BGM_SPACE[i] / 2);
export const TARGET_ROLL =[-23, -16, -8, -6, -6, -8, -11, -17, -25];       // 先ローリング(倍音の多い鋸歯が滑り下りる)
export const TARGET_PAYOUT = [-25, -19, -13, -8, -8, -11, -5, -8, -17];      // 受け皿へ玉が出続ける音(重心 約5.5kHz、1秒に約6衝突)
export const TARGET_PILE = [-27, -17, -4, -5, -9, -10, -14, -20, -12];       // 玉の山に玉が当たる音(減衰 85〜360ms)
export const TARGET_GLASS = [-55, -59, -57, -58, -52, -38, -23, -2, -5];     // 玉がガラスに当たる音(重心 約11kHz)
export const TARGET_HAMMER = [-2, -4, -18, -28, -34, -37, -26, -16, -17];    // 発射ハンマーの打撃(50〜200Hzの低い衝撃+高域のクリック)

// ---- 発音の部品 ----
export function bell(o, sr, at, f, { gain = .3, dur = .6, decay = 5, ratio = 3.5, index = 2.2, attack = .001 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(dur * sr);
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr, env = Math.min(1, t / attack) * Math.exp(-decay * t) * Math.min(1, (dur - t) / .012);
    o[s0 + i] += gain * env * Math.sin(TAU * f * t + index * Math.exp(-decay * 1.6 * t) * Math.sin(TAU * f * ratio * t));
  }
}
export function mallet(o, sr, at, f, { gain = .3, dur = .35, decay = 9 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(dur * sr);
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr, env = Math.min(1, t / .0008) * Math.min(1, (dur - t) / .01);
    o[s0 + i] += gain * env * (Math.sin(TAU * f * t) * Math.exp(-decay * t) + .35 * Math.sin(TAU * f * 3.97 * t) * Math.exp(-decay * 4.5 * t) + .12 * Math.sin(TAU * f * 9.2 * t) * Math.exp(-90 * t));
  }
}
// ソー波シンセ。f0→f1のグライド、カットオフも開閉。実機の電子SEの主役(倍音が多く、音程が滑る)
export function saw(o, sr, at, dur, f0, f1 = f0, { gain = .2, voices = 3, detune = .012, cut0 = 2500, cut1 = cut0, attack = .006, release = .05, decay = 0, vib = 0, trem = 0, sub = 0 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(dur * sr), ph = new Float64Array(voices); let lp = 0, sp = 0;
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr, x = t / dur, f = f0 * (f1 / f0) ** x * (1 + vib * Math.sin(TAU * 5.5 * t)), cut = cut0 + (cut1 - cut0) * x;
    const a = 1 - Math.exp(-TAU * clamp(cut, 80, sr * .45) / sr), env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release) * Math.exp(-decay * t) * (1 - trem + trem * Math.sin(TAU * 6 * t) ** 2);
    let v = 0; for (let k = 0; k < voices; k++) { ph[k] = (ph[k] + f * (1 + (k - (voices - 1) / 2) * detune) / sr) % 1; v += 2 * ph[k] - 1; }
    lp += a * (v / voices - lp); sp += f * .5 / sr; o[s0 + i] += gain * env * (lp + sub * Math.sin(TAU * sp));
  }
}
export function noiseBand(o, sr, at, dur, f0, f1 = f0, { gain = .2, q = 2, env = 'fall', seed = 1, decay = 8 } = {}) {
  // TPT型のSVF(どの周波数でも安定)。以前のChamberlin型は約6kHz以上で発散することがあった
  const r = rng(seed), s0 = Math.round(at * sr), n = Math.round(dur * sr), k = 1 / q; let ic1 = 0, ic2 = 0;
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr, x = t / dur, f = f0 * (f1 / f0) ** x, g = Math.tan(Math.PI * clamp(f, 40, sr * .4) / sr), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const w = r() * 2 - 1, v3 = w - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    const e = env === 'rise' ? x ** 1.6 * Math.min(1, (dur - t) / .02) : Math.min(1, t / .002) * Math.exp(-decay * t);
    o[s0 + i] += gain * e * v1 * k * 2.4;
  }
}
const midiHz = (f0, f1, t, k) => f1 + (f0 - f1) * Math.exp(-t / k);
export function boom(o, sr, at, { gain = .5, f0 = 150, f1 = 38, dur = .55, decay = 6 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(dur * sr); let ph = 0;
  for (let i = 0; i < n && s0 + i < o.length; i++) { const t = i / sr; ph += midiHz(f0, f1, t, .12) / sr; o[s0 + i] += gain * Math.min(1, t / .002) * Math.exp(-decay * t) * Math.sin(TAU * ph); }
}
export function clank(o, sr, at, base, { gain = .3, decay = 14, partials = [1, 1.52, 2.31, 3.17, 4.4], weights = [1, .7, .5, .32, .18], seed = 7 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(Math.min(.6, 5 / decay) * sr);
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr; let v = 0;
    for (let k = 0; k < partials.length; k++) v += weights[k] * Math.sin(TAU * base * partials[k] * t + k) * Math.exp(-decay * (1 + k * .45) * t);
    o[s0 + i] += gain * Math.min(1, t / .0004) * v;
  }
  noiseBand(o, sr, at, .02, 4200, 4200, { gain: gain * .8, q: .8, decay: 160, seed: seed + 1 });
}
// 減衰する白色雑音の粒(玉の衝突の素。スペクトルは matchEQ で実測へ寄せる)
export function burst(o, sr, at, r, { gain = .3, tau = .004, len = .06 } = {}) {
  const s0 = Math.round(at * sr), n = Math.round(len * sr);
  for (let i = 0; i < n && s0 + i < o.length; i++) { const t = i / sr; o[s0 + i] += gain * (r() * 2 - 1) * Math.exp(-t / tau) * Math.min(1, t / .0002); }
}

// ---- 実機のスペクトルへ寄せる(matchEQ) ----
// 信号の帯域配分(測定と同じ9帯域)を測り、目標との差を帯域の中心周波数間で補間した利得で補正する。
function fftInPlace(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? TAU : -TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
export function bandProfile(chs, sr) {
  const len = chs[0].length; let N = 1024; while (N < len * 2) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < len; i++) { let s = 0; for (const c of chs) s += c[i]; re[i] = s / chs.length; }
  fftInPlace(re, im); const e = new Float64Array(EDGES.length - 1);
  for (let k = 1; k < N / 2; k++) { const f = k * sr / N; for (let b = 0; b < e.length; b++) if (f >= EDGES[b] && f < EDGES[b + 1]) { e[b] += re[k] * re[k] + im[k] * im[k]; break; } }
  const tot = e.reduce((a, b) => a + b) || 1; return Array.from(e, v => 10 * Math.log10(v / tot + 1e-12));
}
export function matchEQ(chs, sr, target, { maxBoost = 14, maxCut = 24, passes = 2, strength = 1 } = {}) {
  const len = chs[0].length; let N = 1024; while (N < len * 2) N <<= 1;
  const centers = Array.from({ length: EDGES.length - 1 }, (_, i) => Math.sqrt(EDGES[i] * EDGES[i + 1]));
  let work = chs.map(c => Float32Array.from(c));
  for (let p = 0; p < passes; p++) {
    const cur = bandProfile(work, sr), gains = centers.map((_, b) => cur[b] < -55 ? 0 : clamp((target[b] - cur[b]) * strength, -maxCut, maxBoost));
    const curve = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) {
      const f = Math.max(k * sr / N, 1e-3); let g;
      if (f <= centers[0]) g = gains[0]; else if (f >= centers[centers.length - 1]) g = gains[gains.length - 1];
      else { let b = 0; while (f > centers[b + 1]) b++; const x = Math.log(f / centers[b]) / Math.log(centers[b + 1] / centers[b]); g = gains[b] * (1 - x) + gains[b + 1] * x; }
      curve[k] = 10 ** (g / 20);
    }
    work = work.map(c => {
      const re = new Float64Array(N), im = new Float64Array(N); re.set(c); fftInPlace(re, im);
      for (let k = 0; k <= N / 2; k++) { re[k] *= curve[k]; im[k] *= curve[k]; if (k > 0 && k < N / 2) { re[N - k] *= curve[k]; im[N - k] *= curve[k]; } }
      fftInPlace(re, im, true); return Float32Array.from(re.subarray(0, len), v => v / N);
    });
  }
  return work;
}

// ---- 響き・密度・仕上げ ----
export function room(mono, sr, { mix = .16, size = 1, tail = .35 } = {}) {
  const len = mono.length + Math.round(tail * sr), L = new Float32Array(len), R = new Float32Array(len);
  const combs = (delays, fb) => { const out = new Float32Array(len); for (const d of delays) { const dl = Math.round(d * size * sr), buf = new Float32Array(len); for (let i = 0; i < len; i++) { const x = i < mono.length ? mono[i] : 0; buf[i] = x + (i >= dl ? fb * buf[i - dl] : 0); out[i] += buf[i] / delays.length; } } return out; };
  const wl = combs([.0297, .0371, .0411, .0437], .52), wr = combs([.0313, .0359, .0421, .0453], .52);
  for (let i = 0; i < len; i++) { const x = i < mono.length ? mono[i] : 0; L[i] = x + mix * wl[i]; R[i] = x + mix * wr[i]; }
  return [L, R];
}
// 実機のSEは波形が詰まっている(測定したcrestは8〜16dB。自作の素の波形は16〜20dB)。コンプ+飽和で密度を上げる
export function glue(chs, sr, { threshDb = -26, ratio = 5, attack = .002, release = .12, drive = 1.5 } = {}) {
  const len = chs[0].length, th = 10 ** (threshDb / 20), ca = Math.exp(-1 / (attack * sr)), cr = Math.exp(-1 / (release * sr)); let env = 0;
  const g = new Float32Array(len);
  for (let i = 0; i < len; i++) { let m = 0; for (const c of chs) m = Math.max(m, Math.abs(c[i])); env = m > env ? ca * env + (1 - ca) * m : cr * env + (1 - cr) * m; g[i] = env > th ? (th * (env / th) ** (1 / ratio)) / env : 1; }
  const k = Math.tanh(drive); return chs.map(c => Float32Array.from(c, (v, i) => Math.tanh(drive * v * g[i] * 2.2) / k));
}
// 密度の調整: crest(ピーク/RMS)が目標以下になるまで飽和(tanh)を強め、RMSを一定にそろえる。実機の電子SEはcrest 8〜16dB
export function squash(chs, { crest = 12.5, rmsDb = -18, ceiling = .95 } = {}) {
  let base = 0; for (const c of chs) for (const v of c) base = Math.max(base, Math.abs(v)); if (!base) return chs;
  const rms = a => { let s = 0, n = 0; for (const c of a) for (const v of c) { s += v * v; n += 1; } return Math.sqrt(s / n) || 1e-9; };
  const peak = a => { let m = 0; for (const c of a) for (const v of c) m = Math.max(m, Math.abs(v)); return m; };
  let out = chs;
  for (let k = .2; k <= 14; k += k < 2 ? .4 : .5) {
    out = chs.map(c => Float32Array.from(c, v => Math.tanh(k * v / base) / Math.tanh(k)));
    if (20 * Math.log10(peak(out) / rms(out)) <= crest) break;
  }
  const g = Math.min(10 ** (rmsDb / 20) / rms(out), ceiling / peak(out));
  return out.map(c => c.map(v => v * g));
}
export function normalize(chs, peakDb) { let m = 0; for (const c of chs) for (const v of c) m = Math.max(m, Math.abs(v)); const g = m > 0 ? 10 ** (peakDb / 20) / m : 1; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; return chs; }
export function fadeEnds(chs, sr, inMs = 1, outMs = 12) { const a = Math.round(inMs / 1000 * sr), b = Math.round(outMs / 1000 * sr); for (const c of chs) { for (let i = 0; i < a; i++) c[i] *= i / a; for (let i = 0; i < b; i++) c[c.length - 1 - i] *= i / b; } return chs; }
function trimSilence(chs, thr = 1e-4) { let end = chs[0].length; while (end > 1 && Math.abs(chs[0][end - 1]) < thr && Math.abs(chs[1][end - 1]) < thr) end--; return chs.map(c => c.slice(0, end)); }
// 仕上げ: 響き → 実機のスペクトルへ → 密度 → 余白を詰める → 音量
function finish(o, sr, { target = TARGET_SE_BGM, mix = .16, size = 1, tail = .35, eq = {}, glueOpts = {}, crest = 12.5, rmsDb = -23.5, fadeIn = 1, fadeOut = 15 } = {}) {
  const [shaped] = target ? matchEQ([o], sr, target, eq) : [o];   // 響きの前に整える(モノラル1本で済み軽い)
  const chs = glue(normalize(room(shaped, sr, { mix, size, tail }), -6), sr, glueOpts);
  return squash(fadeEnds(trimSilence(chs), sr, fadeIn, fadeOut), { crest, rmsDb });
}
// 太い層: 低〜中域の厚み(100〜800Hz)を担うデチューンしたソーのパッド+サブ
function pad(o, sr, at, dur, notes, { gain = .08, cut0 = 2200, cut1 = 900, release = .25, attack = .02, decay = 0, trem = 0 } = {}) {
  notes.forEach(m => saw(o, sr, at, dur, midi(m), midi(m), { gain, voices: 5, detune: .016, cut0, cut1, attack, release, decay, trem, sub: .5 }));
}

// ---- 通常演出のSE ----
// F major: F3=53 A3=57 C4=60 F4=65 A4=69 C5=72 F5=77 A5=81 C6=84 E6=88 F6=89 A6=93 C7=96 F7=101
// 点灯1〜3: 保留入賞の「ピロリン」。灯が増えるほど音数と高さが上がる。ベルの下に低〜中域のパッドを敷く
function lamp(sr, n) {
  const o = track(sr, 1.4), notes = [[84, 89], [84, 89, 93], [84, 89, 93, 96]][n - 1], step = n === 1 ? .08 : .065;
  notes.forEach((m, i) => { bell(o, sr, i * step, midi(m), { gain: .18, decay: 4.5 - n * .3, dur: .8 }); mallet(o, sr, i * step, midi(m - 12), { gain: .22, decay: 9 }); mallet(o, sr, i * step, midi(m - 24), { gain: .24, decay: 7, dur: .5 }); });
  pad(o, sr, 0, .7 + n * .15, [[53, 60, 65], [57, 60, 65, 69], [57, 65, 69, 72]][n - 1], { gain: .07, release: .35, cut0: 2600, cut1: 1100 });
  if (n === 3) { bell(o, sr, notes.length * step, midi(101), { gain: .12, decay: 3.5, dur: .8 }); bell(o, sr, notes.length * step + .05, midi(108), { gain: .06, decay: 6, dur: .5 }); }
  noiseBand(o, sr, 0, .05, 5000, 5000, { gain: .12, q: 1, decay: 60, seed: n });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .2});
}
// 4・5・6灯: ピンク昇格〜リーチ目前の「キュイーン→ジャキーン→持続」。実機の激アツ系は2.5〜3.5秒、包絡がほぼ平らに続く(測定: 金レバー3.3秒)
function lampHot(sr, n) {
  const rise = [.35, .5, .7][n - 4], hold = [1.5, 2.0, 2.6][n - 4], o = track(sr, rise + hold + .6), r = rng(40 + n);
  saw(o, sr, 0, rise, 300 + n * 40, 2600 + n * 300, { gain: .2, voices: 5, detune: .02, cut0: 500, cut1: 7000, attack: .02, release: .03, sub: .3 });
  noiseBand(o, sr, 0, rise, 600, 6500, { gain: .18, q: 3, env: 'rise', seed: n });
  const stab = (at, chord, g) => {
    chord.forEach(m => saw(o, sr, at, 1.0, midi(m), midi(m), { gain: g, voices: 5, detune: .016, cut0: 6500, cut1: 1400, attack: .002, release: .08, decay: 2.2, sub: .4 }));
    noiseBand(o, sr, at, .35, 3000, 9000, { gain: g * 1.2, q: .8, decay: 9, seed: 90 + n });
    boom(o, sr, at, { gain: .34 + (n - 4) * .06, f0: 160, f1: 42, dur: .5 });
    bell(o, sr, at, midi(chord[chord.length - 1] + 12), { gain: .16, decay: 3, dur: 1.2, index: 3 });
  };
  stab(rise, [65, 77, 81, 84, 89], .13);
  if (n >= 5) stab(rise + .15, [67, 79, 84, 88, 91], .13);
  // 持続: 和音が揺れながら続く(中域が厚い) + きらめき
  pad(o, sr, rise + .1, hold, n === 6 ? [53, 57, 60, 65, 69, 72] : [53, 57, 60, 65, 69], { gain: .07, cut0: 3200, cut1: 1500, attack: .12, release: .6, trem: .35 });
  for (let i = 0; i < 6 + (n - 4) * 4; i++) bell(o, sr, rise + .25 + i * (hold / (7 + (n - 4) * 4)) + r() * .02, midi(96 + [0, 4, 7, 12, 5][i % 5]), { gain: .06, decay: 6, dur: .3 });
  return finish(o, sr, { target: TARGET_SE_HOT, mix: .26, size: 1.3, tail: .7, fadeOut: 25, rmsDb: -24 });
}
// 重複(保護): 盾で弾く「ガキーン」。エンジンが再生速度を1/2/0.5倍に振る
function protect(sr) {
  const o = track(sr, .6);
  clank(o, sr, 0, 1240, { gain: .38, decay: 11 }); clank(o, sr, .004, 2860, { gain: .22, decay: 16, partials: [1, 1.7, 2.6], weights: [1, .5, .3], seed: 12 });
  boom(o, sr, 0, { gain: .5, f0: 320, f1: 90, dur: .2, decay: 18 });
  bell(o, sr, .09, midi(96), { gain: .12, dur: .3, decay: 10 }); bell(o, sr, .13, midi(101), { gain: .1, dur: .3, decay: 10 });
  pad(o, sr, 0, .3, [53, 60, 65], { gain: .06, release: .15, decay: 6 });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .14, size: .7, tail: .15, eq: { maxBoost: 10 }});
}
// ルーレット(継ぎ目なしループ): 倍音の多い鋸歯が滑り下りる(測定: 先ローリング)+ 回転の刻み。0.5秒で1周
function roulette(sr) {
  const period = .5, steps = 8, step = period / steps, o = track(sr, period * 2), r = rng(5), pat = [89, 93, 96, 93, 89, 93, 96, 101];
  for (let c = 0; c < 2; c++) saw(o, sr, c * period, period, 520, 210, { gain: .24, voices: 5, detune: .018, cut0: 4200, cut1: 1800, attack: .004, release: .004, sub: .4 });
  for (let i = 0; i < steps; i++) { mallet(o, sr, i * step, midi(pat[i]), { gain: .22 - (i % 2) * .05, dur: .14, decay: 22 }); burst(o, sr, i * step, r, { gain: .1, tau: .002, len: .02 }); }
  const [L, R] = matchEQ([o, o], sr, TARGET_ROLL, { maxBoost: 10 }), len = Math.round(period * sr), a = new Float32Array(len), b = new Float32Array(len);
  for (let i = 0; i < L.length; i++) { a[i % len] += L[i]; b[i % len] += R[i]; }
  return squash(glue(normalize([a, b], -6), sr, { threshDb: -20, ratio: 3, release: .05 }), { crest: 11.5, rmsDb: -23 });
}
// 昇格: 針が止まって灯が上がる「ヒュルル→ピロピロピロ→キラーン」
function ascend(sr) {
  const o = track(sr, 2), r = rng(9);
  noiseBand(o, sr, 0, .5, 500, 7000, { gain: .13, q: 4, env: 'rise', seed: 3 });
  saw(o, sr, 0, .5, 200, 1400, { gain: .14, voices: 5, detune: .02, cut0: 800, cut1: 5000, attack: .02, release: .02, sub: .4 });
  [77, 81, 84, 89, 93, 96, 101, 105].forEach((m, i) => { mallet(o, sr, .06 + i * .05, midi(m), { gain: .2, dur: .2, decay: 14 }); bell(o, sr, .06 + i * .05, midi(m), { gain: .08, dur: .25, decay: 10 }); });
  bell(o, sr, .5, midi(108), { gain: .16, dur: 1, decay: 3.2, index: 3 }); bell(o, sr, .5, midi(101), { gain: .1, dur: 1, decay: 3.2 });
  pad(o, sr, .45, 1.0, [53, 57, 60, 65, 69], { gain: .07, attack: .03, release: .5, cut0: 3000, cut1: 1400 });
  for (let i = 0; i < 9; i++) bell(o, sr, .55 + i * .07 + r() * .03, midi(100 + Math.floor(r() * 12)), { gain: .045, dur: .25, decay: 9 });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .22, tail: .5, fadeOut: 20 });
}
// 発射: ハンマーが玉を打つ。測定: 50〜200Hzの低い衝撃+高域のクリック(40ms程度で減衰)
function launch(sr) {
  const o = track(sr, .12), r = rng(2);
  burst(o, sr, 0, r, { gain: .8, tau: .006, len: .08 }); boom(o, sr, 0, { gain: .9, f0: 130, f1: 70, dur: .1, decay: 45 }); burst(o, sr, .001, r, { gain: .2, tau: .0015, len: .01 });
  const [L, R] = matchEQ([o, o.slice()], sr, TARGET_HAMMER, { maxBoost: 34, passes: 4 });
  return normalize(fadeEnds(trimSilence([L, R]), sr, .2, 8), -8);   // 低域の衝撃が主体なので、飽和させず測定した配分のまま使う
}
// 入賞口: 玉が落ちて灯る手前の「コッ→ポロン」
function cup(sr) {
  const o = track(sr, .25), r = rng(11);
  burst(o, sr, 0, r, { gain: .5, tau: .008, len: .06 }); boom(o, sr, 0, { gain: .5, f0: 260, f1: 150, dur: .06, decay: 40 });
  mallet(o, sr, .02, midi(96), { gain: .3, dur: .16, decay: 20 }); bell(o, sr, .02, midi(101), { gain: .08, dur: .16, decay: 20 });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .1, size: .5, tail: .08, eq: { maxBoost: 8 }, glueOpts: { threshDb: -16 }, fadeIn: .3, fadeOut: 8 });
}
// 受け皿へ玉が落ちる「ジャラッ」。測定(200〜1600Hzに厚み)の帯域に寄せつつ3kHz以上を丸め、玉ごとにペンタトニックの小さな「チン」を散らして気持ちよく
export function payoutBuffer(sr, count) {
  const n = clamp(Math.round(count), 1, 8), o = track(sr, .35), r = rng(100 + n), tones = track(sr, .35);
  for (let j = 0; j < n; j++) {
    const at = j === 0 ? 0 : (.012 + j * .1 / n) * (.7 + r() * .6), g = 1 / Math.sqrt(Math.max(1, n / 3));
    for (let k = 0, m = 1 + (r() < .6); k < m; k++) burst(o, sr, at + k * (.006 + r() * .01), r, { gain: (.85 - k * .3) * g, tau: .003 + r() * .004, len: .1 });
    plink(tones, sr, at, PENTA[3 + Math.floor(r() * 6)], { gain: .22 * g, tau: .04 + r() * .03, upper: .2 });
  }
  const [mono] = matchEQ([o], sr, TARGET_PAYOUT_SOFT, { maxBoost: 16 });
  for (let i = 0; i < mono.length; i++) mono[i] += tones[i] * .5;
  soften(mono, sr, 8500);
  return normalize(fadeEnds(trimSilence(room(mono, sr, { mix: .08, size: .5, tail: .12 })), sr, .2, 6), -13);
}
// 貸し玉・追加: クレジットの「ピロリロリン」と玉を皿に出す「ジャララ…」
function loan(sr, big) {
  const o = track(sr, 1.6), r = rng(77 + big);
  [84, 89, 93, 96, 101].forEach((m, i) => { bell(o, sr, i * .065, midi(m + (big ? 2 : 0)), { gain: .17, dur: .7, decay: 4.5 }); mallet(o, sr, i * .065, midi(m - 12 + (big ? 2 : 0)), { gain: .16, dur: .3, decay: 10 }); mallet(o, sr, i * .065, midi(m - 24 + (big ? 2 : 0)), { gain: .2, dur: .4, decay: 7 }); });
  pad(o, sr, 0, .8, [57, 60, 65, 69], { gain: .06, release: .4 });
  // 皿へ玉が落ちる(払い出し流の帯域)
  const pour = track(sr, 1.6), n = 28 + big * 12; for (let i = 0; i < n; i++) burst(pour, sr, .2 + i / n * (.55 + big * .15) + r() * .015, r, { gain: .25 + r() * .2, tau: .003 + r() * .004, len: .1 });
  const [pl] = matchEQ([pour], sr, TARGET_PAYOUT_SOFT, { maxBoost: 16 }), [bells] = matchEQ([o], sr, TARGET_SE_BGM, { maxBoost: 10 });   // ベルはBGMの隙間へ、玉は測定の帯域へ
  const peakOf = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0), kb = .6 / (peakOf(bells) || 1), kp = .5 / (peakOf(pl) || 1);
  for (let i = 0; i < o.length; i++) o[i] = bells[i] * kb + pl[i] * kp;
  return finish(o, sr, { target: null, mix: .18, tail: .4, glueOpts: { threshDb: -20 }, fadeOut: 15 });
}
function start(sr) {
  const o = track(sr, 1.3);
  saw(o, sr, 0, .12, midi(65), midi(65), { gain: .14, voices: 5, detune: .014, cut0: 3000, release: .02, sub: .4 });
  [[.0, [65, 77, 81, 84]], [.14, [67, 79, 84, 88]], [.28, [69, 81, 84, 89, 93]]].forEach(([at, ch], i) => { ch.forEach(m => saw(o, sr, at, i === 2 ? .8 : .12, midi(m), midi(m), { gain: .09, voices: 5, detune: .016, cut0: 4500, cut1: 1500, release: i === 2 ? .3 : .02, decay: i === 2 ? 2.2 : 0, sub: .3 })); bell(o, sr, at, midi(ch[ch.length - 1] + 12), { gain: .13, dur: i === 2 ? .9 : .14, decay: i === 2 ? 3 : 16 }); });
  boom(o, sr, .28, { gain: .3, f0: 140, f1: 45, dur: .4 });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .2, tail: .45, fadeOut: 20 });
}
// 残り10秒: 「ピッ・ピッ・ピーッ」。警告音は意図的に細いが、実機のSE帯域へ軽く寄せる
function warn(sr) {
  const o = track(sr, .75);
  [[0, .09, 93], [.2, .09, 93], [.4, .24, 100]].forEach(([at, d, m]) => { saw(o, sr, at, d, midi(m), midi(m), { gain: .16, voices: 1, cut0: 6000, attack: .002, release: .02 }); bell(o, sr, at, midi(m), { gain: .12, dur: d, decay: 8, ratio: 2 }); saw(o, sr, at, d, midi(m - 24), midi(m - 24), { gain: .1, voices: 3, cut0: 1500, attack: .002, release: .02, sub: .5 }); });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .1, tail: .15, eq: { maxBoost: 10, strength: .7 }});
}
// 外れ: 「ヒュゥゥゥ…ボフッ」と下がる
function fail(sr) {
  const o = track(sr, 1.1);
  saw(o, sr, 0, .55, midi(81), midi(57), { gain: .16, voices: 3, detune: .02, cut0: 2600, cut1: 400, attack: .005, release: .15, sub: .4 });
  [81, 77, 74].forEach((m, i) => bell(o, sr, i * .12, midi(m), { gain: .11, dur: .45, decay: 5, ratio: 2, index: 1.2 }));
  boom(o, sr, .38, { gain: .35, f0: 120, f1: 40, dur: .4, decay: 8 }); noiseBand(o, sr, .38, .1, 400, 400, { gain: .15, q: 1, decay: 30, seed: 8 });
  return finish(o, sr, { target: TARGET_SE_BGM, mix: .16, eq: { maxBoost: 8, maxCut: 12, strength: .6 }, fadeOut: 20 });
}
// 皿がいっぱい: 「ガシャッ」と玉があふれる(玉の山の帯域)
function overflow(sr) {
  const o = track(sr, .4), r = rng(31);
  for (let i = 0; i < 16; i++) burst(o, sr, i * .011 * (.6 + r() * .8), r, { gain: .4 + r() * .3, tau: .008 + r() * .01, len: .15 });
  boom(o, sr, 0, { gain: .3, f0: 220, f1: 100, dur: .12, decay: 25 });
  const [L, R] = matchEQ([o, o.slice()], sr, TARGET_PILE, { maxBoost: 16 });
  return squash(fadeEnds(trimSilence(glue(normalize([L, R], -6), sr, { threshDb: -16 })), sr, .3, 10), { crest: 12, rmsDb: -22 });
}

// ---- 通常時の残りのSE: 当たり(成功)・勝負・時間切れ・計数・結果・タイトル・遊び方 ----
// 当たり音の測定(実機の大当たり音3本の平均。からくりサーカス/超電磁砲2/ユニコーン2): 100Hz〜12.8kHzがほぼ均等で低音が厚く、
// 包絡が最後まで平らに続いて最後だけ短く減衰する。crestは12〜14dB。BGMの隙間のため、SEと同様に中域を半分だけ抑える。
export const TARGET_WIN = [-17, -9, -9, -9, -9, -12, -11, -13, -23];
const TARGET_WIN_BGM = TARGET_WIN.map((v, i) => v - BGM_SPACE[i] / 2);
// 長さをそろえる(ゲームの勝ち音は払い出し開始までの長さに合わせるため、既定の長さで作っておく)。足りなければ無音、長ければ末尾を滑らかに切る
function fit(chs, sr, seconds, fadeSec = .25) {
  const n = Math.round(seconds * sr), out = chs.map(c => { const o = new Float32Array(n); o.set(c.subarray(0, Math.min(n, c.length))); return o; });
  if (chs[0].length > n) fadeEnds(out, sr, 0, fadeSec * 1000);
  return out;
}
const chord = (o, sr, at, notes, dur, { gain = .1, cut0 = 6500, cut1 = 1500, decay = 1.6, release = .12, sub = .4 } = {}) =>
  notes.forEach(m => saw(o, sr, at, dur, midi(m), midi(m), { gain, voices: 5, detune: .016, cut0, cut1, attack: .003, release, decay, sub }));
// 成功(小): 「ジャーン」。衝撃+F→Cの和音+きらめき。払い出し開始(1.4秒)で終わる
function successSmall(sr) {
  const o = track(sr, 2), r = rng(61);
  boom(o, sr, 0, { gain: .55, f0: 170, f1: 45, dur: .5 }); noiseBand(o, sr, 0, .45, 2500, 9000, { gain: .26, q: .8, decay: 7, seed: 61 });
  chord(o, sr, .02, [53, 65, 69, 72, 77, 81], 1.2, { gain: .1 }); chord(o, sr, .2, [55, 67, 72, 76, 79, 84], 1.0, { gain: .09 });
  bell(o, sr, .02, midi(101), { gain: .16, decay: 3, dur: 1.2, index: 3 });
  for (let i = 0; i < 8; i++) bell(o, sr, .3 + i * .09 + r() * .02, midi(96 + [0, 4, 7, 12, 5][i % 5]), { gain: .07, decay: 6, dur: .35 });
  pad(o, sr, .15, 1.0, [53, 57, 60, 65, 69], { gain: .06, attack: .05, release: .4, trem: .3 });
  return fit(finish(o, sr, { target: TARGET_WIN_BGM, mix: .22, tail: .5, rmsDb: -18, fadeOut: 20 }), sr, 1.4, .3);
}
// 成功(大): 「ジャジャーン」。短い上昇→衝撃(.2秒)→和音の3連→持続するパッドときらめき。払い出し開始(3.4秒)で終わる
function successBig(sr) {
  const o = track(sr, 4.2), r = rng(62);
  saw(o, sr, 0, .2, 400, 2600, { gain: .16, voices: 5, detune: .02, cut0: 600, cut1: 7000, attack: .02, release: .02 }); noiseBand(o, sr, 0, .2, 700, 6000, { gain: .16, q: 3, env: 'rise', seed: 8 });
  const hit = (at, notes, g, bass) => { boom(o, sr, at, { gain: bass, f0: 180, f1: 42, dur: .55 }); noiseBand(o, sr, at, .4, 2500, 9500, { gain: .22, q: .8, decay: 8, seed: 70 + Math.round(at * 10) }); chord(o, sr, at, notes, 1.3, { gain: g }); };
  hit(.2, [53, 65, 69, 72, 77, 81], .1, .32); hit(.7, [55, 67, 72, 76, 79, 84], .095, .24); hit(1.2, [57, 69, 72, 77, 81, 89], .1, .26);
  bell(o, sr, .2, midi(101), { gain: .16, decay: 2.5, dur: 1.6, index: 3 }); bell(o, sr, 1.2, midi(108), { gain: .12, decay: 2.5, dur: 1.4, index: 3 });
  pad(o, sr, .5, 2.6, [53, 57, 60, 65, 69, 72], { gain: .065, attack: .12, release: .6, trem: .35, cut0: 3400, cut1: 1500 });
  for (let i = 0; i < 22; i++) bell(o, sr, .45 + i * .12 + r() * .03, midi(96 + [0, 4, 7, 12, 5, 9][i % 6]), { gain: .06, decay: 6, dur: .35 });
  return fit(finish(o, sr, { target: TARGET_WIN_BGM, mix: .26, size: 1.3, tail: .7, rmsDb: -17, fadeOut: 25 }), sr, 3.4, .3);
}
// 勝負の宣言: 「ドン→キュイーン→ジャキッ」。短い溜めのあとに決意の和音
function declare(sr) {
  const o = track(sr, 1.3);
  boom(o, sr, 0, { gain: .5, f0: 150, f1: 48, dur: .35 });
  saw(o, sr, .05, .35, 320, 2800, { gain: .17, voices: 5, detune: .02, cut0: 500, cut1: 7000, attack: .02, release: .03, sub: .3 }); noiseBand(o, sr, .05, .35, 700, 7000, { gain: .15, q: 3, env: 'rise', seed: 12 });
  chord(o, sr, .4, [53, 65, 69, 72, 77], .8, { gain: .1 }); bell(o, sr, .4, midi(101), { gain: .15, decay: 4, dur: .8, index: 3 }); noiseBand(o, sr, .4, .25, 3000, 9000, { gain: .2, q: .8, decay: 12, seed: 13 });
  return finish(o, sr, { target: TARGET_SE_HOT, mix: .2, tail: .35, rmsDb: -21, fadeOut: 20 });
}
// 勝負の取消: 下がる「ヒュン」
function cancel(sr) {
  const o = track(sr, .45);
  saw(o, sr, 0, .28, 900, 190, { gain: .2, voices: 3, detune: .02, cut0: 3500, cut1: 500, attack: .004, release: .1, sub: .4 }); boom(o, sr, .1, { gain: .3, f0: 150, f1: 60, dur: .2, decay: 14 });
  return finish(o, sr, { mix: .1, size: .5, tail: .15, rmsDb: -25 });
}
// 勝負中のループ(1.2秒、継ぎ目なし): 低い持続音の脈動(0.6秒ごとの「ドクン」)と、うねる高域の緊張感
function focusLoop(sr) {
  const period = 1.2, o = track(sr, period * 2);
  for (let c = 0; c < 2; c++) {
    [43, 50].forEach(m => saw(o, sr, c * period, period, midi(m + 12), midi(m + 12), { gain: .1, voices: 4, detune: .01, cut0: 500, cut1: 500, attack: .001, release: .001, sub: .5 }));
    for (let k = 0; k < 2; k++) boom(o, sr, c * period + k * .6, { gain: .34 - k * .1, f0: 120, f1: 48, dur: .3, decay: 10 });
    noiseBand(o, sr, c * period, period, 1400, 3600, { gain: .06, q: 3, env: 'rise', seed: 16 + c });
  }
  // うねり: 2サイクルの振幅変調(周期は1.2秒の約数)で継ぎ目を作らない
  for (let i = 0; i < o.length; i++) o[i] *= .75 + .25 * Math.sin(TAU * 2 * (i / sr) / period);
  const len = Math.round(period * sr), a = new Float32Array(len); for (let i = 0; i < o.length; i++) a[i % len] += o[i];
  return squash(glue(normalize([a, a.slice()], -6), sr, { threshDb: -22, ratio: 3, release: .08 }), { crest: 12, rmsDb: -26 });
}
// 時間切れ: 下降する3音と低い「ブゥン」
function timeup(sr) {
  const o = track(sr, 1.4);
  [86, 81, 77].forEach((m, i) => { bell(o, sr, i * .2, midi(m), { gain: .16, dur: .6, decay: 5, ratio: 2, index: 1.4 }); mallet(o, sr, i * .2, midi(m - 12), { gain: .2, dur: .35, decay: 8 }); });
  saw(o, sr, .55, .6, 220, 110, { gain: .15, voices: 3, detune: .02, cut0: 1200, cut1: 400, attack: .01, release: .2, sub: .5 }); boom(o, sr, .55, { gain: .3, f0: 120, f1: 45, dur: .5 });
  return finish(o, sr, { mix: .2, tail: .4, rmsDb: -22, fadeOut: 20 });
}
// 計数中のループ(0.8秒、継ぎ目なし): 玉を数える小さな「チャラララ」。ペンタトニックを上がっていく
function countLoop(sr) {
  const period = .8, steps = 8, step = period / steps, o = track(sr, period * 2), r = rng(17), pat = [84, 86, 89, 91, 93, 96, 98, 101];
  for (let c = 0; c < 2; c++) for (let i = 0; i < steps; i++) { const t = c * period + i * step; mallet(o, sr, t, midi(pat[i]), { gain: .22, dur: .16, decay: 16 }); burst(o, sr, t, r, { gain: .12, tau: .003, len: .03 }); }
  const [m] = matchEQ([o], sr, TARGET_SE_BGM, { maxBoost: 10 }), len = Math.round(period * sr), a = new Float32Array(len);
  for (let i = 0; i < m.length; i++) a[i % len] += m[i];
  return squash(glue(normalize([a, a.slice()], -6), sr, { threshDb: -22, ratio: 3, release: .06 }), { crest: 12, rmsDb: -21 });
}
// 結果: 「ジャジャン」。和音→上行アルペジオ→持続
function result(sr) {
  const o = track(sr, 2.2);
  boom(o, sr, 0, { gain: .4, f0: 150, f1: 48, dur: .4 }); chord(o, sr, 0, [53, 65, 69, 72, 77], .7, { gain: .09 });
  [77, 81, 84, 89, 93, 96].forEach((m, i) => { bell(o, sr, .3 + i * .09, midi(m), { gain: .15, dur: .6, decay: 4.5 }); mallet(o, sr, .3 + i * .09, midi(m - 12), { gain: .16, dur: .3, decay: 9 }); });
  chord(o, sr, .9, [53, 57, 60, 65, 69, 72], 1.1, { gain: .08, decay: 1.8 }); bell(o, sr, .9, midi(101), { gain: .14, decay: 3, dur: 1.1, index: 3 });
  return finish(o, sr, { target: TARGET_SE_HOT, mix: .24, tail: .5, rmsDb: -20, fadeOut: 25 });
}
// タイトル: ふわっと広がる和音と、きらめく3音
function title(sr) {
  const o = track(sr, 1.7);
  pad(o, sr, 0, 1.2, [53, 57, 60, 65, 69], { gain: .07, attack: .15, release: .6, cut0: 2600, cut1: 1200 });
  [84, 89, 93].forEach((m, i) => { bell(o, sr, .1 + i * .13, midi(m), { gain: .16, dur: .9, decay: 3.5 }); mallet(o, sr, .1 + i * .13, midi(m - 12), { gain: .14, dur: .4, decay: 8 }); });
  bell(o, sr, .5, midi(101), { gain: .1, dur: 1, decay: 3 });
  return finish(o, sr, { mix: .26, size: 1.2, tail: .6, rmsDb: -23, fadeOut: 30 });
}
// 遊び方(ページ送り): 軽い2音の「ポポッ」
function howto(sr) {
  const o = track(sr, .6), r = rng(19);
  mallet(o, sr, 0, midi(89), { gain: .26, dur: .2, decay: 14 }); mallet(o, sr, .09, midi(96), { gain: .26, dur: .25, decay: 14 }); burst(o, sr, 0, r, { gain: .1, tau: .002, len: .02 });
  return finish(o, sr, { mix: .12, size: .6, tail: .2, rmsDb: -25, fadeOut: 15 });
}

export const CUE_MAKERS = { lamp1: sr => lamp(sr, 1), lamp2: sr => lamp(sr, 2), lamp3: sr => lamp(sr, 3), lamp4: sr => lampHot(sr, 4), lamp5: sr => lampHot(sr, 5), lamp6: sr => lampHot(sr, 6),
  protect, roulette_loop: roulette, ascend, launch, cup, start, ticket: sr => loan(sr, 0), add100: sr => loan(sr, 1), warn10: warn, fail, overflow,
  success_small: successSmall, success_big: successBig, declare, cancel, focus_loop: focusLoop, timeup, count_loop: countLoop, result, title, howto };
export function synthCues(sr = 48000) { const out = {}; for (const [k, make] of Object.entries(CUE_MAKERS)) out[k] = make(sr); return out; }

// ---- 玉・釘・部品の接触音(AudioEngine.modalSynthの差し替え) ----
// 聴いていて気持ちいいことを優先した作り(ASMR寄り)。実機の測定(玉がガラスや玉の山に当たる音)の雑音のクリックを土台にしつつ、
// 当たるたびにBGM(F major)のペンタトニックの音が短く鳴る「チン」を重ねる。測定どおりの高域(6〜20kHz)はきつくなるので抑え、胴鳴りを足す。
const PENTA = [77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101, 103, 105, 108, 110, 113];   // F5 G5 A5 C6 D6 F6 G6 A6 C7 D7 F7 G7 A7 C8 D8 F8(F majorのペンタトニック)
// 柔らかい金属・ガラスの「チン」: 基音+非整数倍の倍音。高い音ほど短い
function plink(o, sr, at, m, { gain = .3, tau = .06, ratio = 2.76, upper = .28, attack = .0006 } = {}) {
  const f = midi(m), s0 = Math.round(at * sr), n = Math.round(Math.min(.5, tau * 8) * sr);
  for (let i = 0; i < n && s0 + i < o.length; i++) { const t = i / sr, env = Math.min(1, t / attack); o[s0 + i] += gain * env * (Math.sin(TAU * f * t) * Math.exp(-t / tau) + upper * Math.sin(TAU * f * ratio * t) * Math.exp(-t / (tau * .45)) + upper * .35 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t / (tau * .2))); }
}
// 一次LPFで高域のきつさを抑える
function soften(x, sr, fc) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } return x; }
const TARGET_PIN_SOFT = [-45, -40, -30, -22, -16, -10, -4, -3, -14];   // ガラス測定よりも胴(中高域)を残して、8kHz以上を抑えた釘の「チッ」
const TARGET_BALL_SOFT = [-30, -20, -8, -6, -9, -9, -12, -18, -30];    // 玉どうし: 玉の山の測定から高域を落として丸く
const TARGET_PAYOUT_SOFT = [-25, -19, -12, -8, -8, -10, -7, -12, -24]; // 払い出し: 測定から3kHz以上を少し落とす
const SOFT = {
  brass: { target: TARGET_PIN_SOFT, tau: .0035, len: .04, note: [10, 15], plink: .75, ptau: .05, click: .55, lp: 9500 },    // 釘: 高いペンタの音
  steel: { target: TARGET_BALL_SOFT, tau: .007, len: .09, note: [3, 8], plink: .55, ptau: .09, click: .6, lp: 7500, upper: .18 },   // 玉どうし: 中高域の丸い音
  metal: { target: TARGET_BALL_SOFT, tau: .012, len: .3, note: [3, 7], plink: .9, ptau: .16, click: .35, lp: 8000, upper: .4 },     // ゲート/ガード: 余韻のある「チリン」
  resin: { target: [-14, -9, -6, -7, -12, -20, -30, -40, -45], tau: .009, len: .16, note: [0, 2], plink: .5, ptau: .07, click: .5, lp: 3500, upper: .05, low: 1 },   // 樹脂・板: 低めの「トン」
};
export function pachiContact(contact, sr = 48000) {
  const p = SOFT[contact.material] ?? SOFT.resin, speed = clamp(Number(contact.speed) || .05, .02, 5), impulse = clamp(Number(contact.impulse) || 0, 0, .05);
  const amp = .6 * clamp(.12 * Math.sqrt(speed) + Math.sqrt(impulse) * 1.7, .03, .6), v = (contact.variant ?? 0) % 7;
  const r = rng(1000 + v * 97 + Math.round(speed * 10) * 13 + Math.round(impulse * 4000)), o = track(sr, p.len);
  // 雑音のクリックを実測寄りの帯域に整える
  const click = track(sr, p.len); burst(click, sr, 0, r, { gain: 1, tau: p.tau * (.85 + .3 * r()), len: p.len });
  let [c] = matchEQ([click], sr, p.target.map(b => b + (r() - .5) * 3), { maxBoost: 20, maxCut: 30 });
  let pk = 0; for (const s of c) pk = Math.max(pk, Math.abs(s)); for (let i = 0; i < c.length; i++) o[i] += c[i] / (pk || 1) * p.click;
  // 当たった強さと変種で、ペンタトニックの音を選ぶ(強いほど高く)
  const lo = p.note[0], hi = p.note[1], idx = Math.min(hi, lo + Math.floor(((v * 3 + Math.floor(speed * 2.5)) % (hi - lo + 1)))), m = PENTA[idx] - (p.low ? 36 : 0);
  plink(o, sr, 0, m, { gain: p.plink, tau: p.ptau * (m > 90 ? .7 : 1), upper: p.upper ?? .28 });
  soften(o, sr, p.lp);
  let top = 0; for (const s of o) top = Math.max(top, Math.abs(s)); const g = top ? amp / top : 0;
  for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * g * 1.3) * .82;
  const fade = Math.round(.01 * sr); for (let i = 0; i < fade; i++) o[o.length - 1 - i] *= i / fade;
  return o;
}
export function pachiPayout(count, sr = 48000) { const [L, R] = payoutBuffer(sr, count); return [L, R]; }
