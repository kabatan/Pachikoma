// R3-G：m3 の囲いの 3D（work/upa_frame3d/m3/）を play の既定筐体にする。旧筐体は ?cabinet=r2。
// HybridRenderer（web/src）は書き換えず、実行時に最後の表示のパスと液晶の板のシェーダーを差し替える（ball_light.mjs と同じやり方）。
//   1. 盤の窓と穴の段（画面 y < 2215）：stage2c の環境を消し（奥 0・手前 0・τ 1・遮蔽 50 m＝玉はすべて手前の印）、液晶と玉だけを描く。
//      皿（y ≥ 2215）の中は R3-M5 の皿の絵（pack T）を stage2c の上・球の下に敷く（皿の球は物理の球）。stage2c の光層（花びら・縁）は外す。
//   2. 最後のパス（表示の値、sRGB）：LUT(液晶＋玉) → 液晶にガラスの映り込み（screen）と盤面電飾（導光板 wash・ring、m3 の合成の式）、
//      穴の奥の板（球の後ろ）→ 盤の釘（v39 の前）→ 穴の前の部品と穴の LED → 縁の帯（zone）→ 枠（0 灯と 4 灯の間を区画ごとの色で）→ 得点表示板（7 セグとメーター）。
//      光は m3 の表示変換（露出 −1・PBR Neutral・desat 0）の逆で線形へ戻して足し、また表示へ（光が 0 なら元の絵と同じ）。
//   3. 既定の液晶：1240×1510 の面を等倍で貼る（映像の可視部分は1152×1268）。
// 素材：m3/pack1026/（旧packを残し、R3の82本の釘・穴幅・4段階の賞へ更新）。
import * as THREE from '../../web/vendor/three/three.module.js';
import { m3EnvironmentChannels, inheritM3EnvironmentChannels } from '../../web/src/layer_loader.mjs';
import { lutGlsl } from '../../web/src/lut.mjs';
import { installNativeMergedMain } from '../../web/src/native_merged_main.mjs';
import { makeBoardWash } from '../../../effects/runtime/board_wash.mjs';
import { installMainFrontFusion } from '../../web/src/main_front_fusion.mjs';

const W = 1440, H = 2560, ROW_M3 = 2215, ROW_TRAY = 2470;   // ROW_TRAY：R3-M5 の皿の絵の下の端（y 2209＋261）    // この行より上を m3 の筐体に（皿の窓は y 2225 から）
const PINK = [1, 0.02, 0.3];

async function gunzip(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function loadArray(base, rec) {
  const r = await fetch(new URL(rec.file, base)); if (!r.ok) throw new Error(`${rec.file}: HTTP ${r.status}`);
  const data = await gunzip(await r.arrayBuffer());
  if (data.byteLength !== rec.width * rec.height * rec.layers * 4) throw new Error(rec.file + ': size mismatch');
  const t = new THREE.DataArrayTexture(data, rec.width, rec.height, rec.layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.unpackAlignment = 4; t.needsUpdate = true;
  return t;
}

// 環境（stage2c の DataTexture、RGBA16F、行 0＝上）の y < ROW_M3 を書き換えた複製
const HALF = { zero: 0, one: 0x3c00, fifty: 0x5240 };
function patchedTexture(src, value) {
  const compact = m3EnvironmentChannels(src);
  if (compact) {
    const image = src.image, input = image?.data;
    // A marked compact source may have a normally replaced buffer; never apply oldRGBA strides.
    if (src.type !== THREE.HalfFloatType || src.format !== (compact === 1 ? THREE.RedFormat : THREE.RGBFormat)
      || image.width !== W || image.height !== H || !ArrayBuffer.isView(input) || Object.getPrototypeOf(input) !== Uint16Array.prototype
      || input.length !== W * H * compact || input.byteOffset !== 0 || input.byteLength !== input.length * 2
      || !(input.buffer instanceof ArrayBuffer) || input.buffer.resizable || input.byteLength !== input.buffer.byteLength) throw new Error('invalid M3 compact environment texture');
    const channels = value === 'occ' ? 1 : 3, d = new Uint16Array(W * H * channels);
    if (channels === compact) d.set(input);
    else if (channels === 1) for (let i = 0; i < W * H; i++) d[i] = input[i * 3];
    else for (let i = 0; i < W * H; i++) d[i * 3] = input[i]; // RED samples have zero G/B.
    const rows = value === 0 ? ROW_M3 : ROW_TRAY, prefix = value === 'tau' ? HALF.one : value === 'occ' ? HALF.fifty : 0;
    d.fill(prefix, 0, rows * W * channels);
    const t = new THREE.DataTexture(d, W, H, channels === 1 ? THREE.RedFormat : THREE.RGBFormat, THREE.HalfFloatType);
    t.internalFormat = channels === 1 ? 'R16F' : 'RGB16F';
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    inheritM3EnvironmentChannels(src, t, channels);
    return t;
  }
  const img = src.image, input = img.data;
  const tail = value === 0 ? ROW_M3 : value === 'occ' ? ROW_TRAY : null;
  const copyTail = tail !== null && ArrayBuffer.isView(input) && input instanceof Uint16Array && Object.getPrototypeOf(input) === Uint16Array.prototype
    && input.length === W * H * 4 && Object.getOwnPropertyDescriptor(img, 'width')?.value === W && Object.getOwnPropertyDescriptor(img, 'height')?.value === H;
  const d = copyTail ? new Uint16Array(input.length) : new Uint16Array(input), n = ROW_M3 * img.width * 4;
  if (copyTail) { const start = tail * W * 4; d.set(Uint16Array.prototype.subarray.call(input, start), start); }
  const nT = Math.min(ROW_TRAY, img.height) * img.width * 4;        // 皿も：球をいつも手前に（皿の縁は m3 の囲いが上に載る）。球の覆い（alpha）で皿の絵の下に球を出す
  if (value === 'tau') { for (let i = 0; i < nT; i += 4) { d[i] = d[i + 1] = d[i + 2] = HALF.one; } }
  else if (value === 'occ') { if (copyTail) d.fill(HALF.fifty, 0, nT); else for (let i = 0; i < nT; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = HALF.fifty; } }
  else if (!copyTail) d.fill(0, 0, n);
  const t = new THREE.DataTexture(d, img.width, img.height, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

function patchedEnvironment(env) {
  const nenv = {
    back: { ...env.back, A: patchedTexture(env.back.A, 0), B: patchedTexture(env.back.B, 0) },
    front: { ...env.front, A: patchedTexture(env.front.A, 0), B: patchedTexture(env.front.B, 0) },
    tau: patchedTexture(env.tau, 'tau'), occ: patchedTexture(env.occ, 'occ'),
  };
  return nenv;
}

// This is an ownership opt-in from the private default-play startup, not alias inference for public callers.
function ownedEnvironmentInputs(env) {
  try {
    const textures = [env.back.A, env.back.B, env.front.A, env.front.B, env.tau, env.occ];
    const keep = [env.back.M0, env.back.M1, env.front.M0, env.front.M1];
    const normal = (t, type, ArrayType, format = THREE.RGBAFormat, channels = 4) => Object.getPrototypeOf(t) === THREE.DataTexture.prototype && t.type === type && t.format === format
      && t.image.width === W && t.image.height === H && ArrayBuffer.isView(t.image.data) && t.image.data instanceof ArrayType
      && Object.getPrototypeOf(t.image.data) === ArrayType.prototype
      && t.image.data.buffer instanceof ArrayBuffer && !t.image.data.buffer.resizable && t.image.data.byteOffset === 0
      && t.image.data.length === W * H * channels && t.image.data.byteLength === t.image.data.length * ArrayType.BYTES_PER_ELEMENT
      && t.image.data.byteLength === t.image.data.buffer.byteLength
      && Object.getOwnPropertyDescriptor(t, 'version')?.writable && Object.getOwnPropertyDescriptor(t.source, 'version')?.writable;
    const normalHalf = t => normal(t, THREE.HalfFloatType, Uint16Array);
    const normalKeep = t => normalHalf(t) || normal(t, THREE.UnsignedByteType, Uint8Array);
    const channels = textures.map(t => m3EnvironmentChannels(t) || 4);
    if (!textures.every((t, i) => channels[i] === 4 ? normalHalf(t)
      : channels[i] === (i === 5 ? 1 : 3) && normal(t, THREE.HalfFloatType, Uint16Array, channels[i] === 1 ? THREE.RedFormat : THREE.RGBFormat, channels[i]))
      || !keep.every(normalKeep) || new Set(textures).size !== 6) return null;
    const data = textures.map(t => t.image.data), buffers = new Set(data.map(d => d.buffer));
    if (buffers.size !== 6 || keep.some(t => textures.includes(t) || buffers.has(t.image.data.buffer))) return null;
    return { textures, data, channels };
  } catch { return null; }
}
function patchOwnedEnvironment(owned) {
  const { textures, data, channels } = owned;
  for (let i = 0; i < 4; i++) data[i].fill(0, 0, ROW_M3 * W * channels[i]);
  if (channels[4] === 3) data[4].fill(HALF.one, 0, ROW_TRAY * W * 3);
  else for (let i = 0; i < ROW_TRAY * W * 4; i += 4) data[4][i] = data[4][i + 1] = data[4][i + 2] = HALF.one;
  data[5].fill(HALF.fifty, 0, ROW_TRAY * W * channels[5]);
  for (const t of textures) t.needsUpdate = true;
}

const GLSL_TM = /* glsl */`
vec3 s2l(vec3 s) { return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s)); }
vec3 l2s(vec3 l) { l = clamp(l, 0.0, 1.0); return mix(12.92 * l, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
vec3 neutralM3(vec3 c) {
  c = max(c, 0.0); float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
  float pk = max(c.r, max(c.g, c.b)); if (pk < 0.76) return c;
  float np = 1.0 - 0.0576 / (pk + 0.24 - 0.76); return c * (np / pk);
}
vec3 Tm(vec3 x) { return l2s(neutralM3(x * 0.5)); }
vec3 invTm(vec3 s) {
  vec3 o = s2l(clamp(s, 0.0, 0.999)); float m = max(o.r, max(o.g, o.b));
  float pk = m >= 0.76 ? 0.0576 / max(1.0 - m, 1e-4) - 0.24 + 0.76 : m;
  vec3 c = m > 0.0 ? o * (pk / max(m, 1e-6)) : o;
  float mn = min(c.r, min(c.g, c.b)); float x = mn < 0.04 ? sqrt(max(mn, 0.0) / 6.25) : mn + 0.04;
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04; return (c + off) * 2.0;
}
float lumi(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

function finalShader(lut, man) {
  const C = man.arrays.C, D = man.arrays.D, E = man.arrays.E, T = man.arrays.T;
  return /* glsl */`
uniform highp sampler2D uC, uD; uniform int uView; uniform int uUseLut; uniform float uDither;
uniform highp sampler2DArray uMA, uMC, uMD, uME, uMF, uMT;
uniform float uK[8]; uniform vec3 uKc[8]; uniform float uK4, uRecolor[8], uScriptTint;
uniform vec3 uHole[7], uPil[7]; uniform vec2 uHoleX[7], uPilX[7];
uniform float uSeg[28]; uniform vec3 uSegC; uniform float uMet[5];
uniform vec3 uWash[8], uRing[4], uZone[8]; uniform float uWashGain, uZoneGain, uGlass, uGlassK;
uniform vec4 uEs[5]; uniform int uM3Off; uniform int uBW; uniform float uWashCap; uniform vec4 uMouth; uniform float uMouthK; uniform float uGlowK;
${lutGlsl(lut.manifest)}
${GLSL_TM}
vec3 frameLit(vec3 s0, vec3 s4, float kk, vec3 col, float rc) {
  vec3 l0 = s2l(s0), d = s2l(s4) - l0, pos = max(d, 0.0), neg = min(d, 0.0);
  float m = max(pos.r, max(pos.g, pos.b));
  return l2s(l0 + min(kk, 1.0) * neg + kk * mix(pos, m * col, rc));
}
// ロゴ（パチコマ）：文字の下の青・赤の焼き込み映り込みと、文字そのものの照らされ方（1030 ロゴ・得点板の質感）
float logoBox(vec2 uv) { vec2 q = abs(uv * vec2(1440.0, 2560.0) - vec2(461.0, 330.0)) - vec2(340.0, 185.0); return 1.0 - smoothstep(-40.0, 0.0, max(q.x, q.y)); }
float chroma3(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
float logoLetter(vec2 uv) {
  if (logoBox(uv) <= 0.0) return 0.0;
  vec2 d = vec2(4.0 / 1440.0, 4.0 / 2560.0);
  float c = chroma3(texture(uMA, vec3(uv, 0.0)).rgb);
  c = max(c, chroma3(texture(uMA, vec3(uv + vec2(d.x, 0.0), 0.0)).rgb)); c = max(c, chroma3(texture(uMA, vec3(uv - vec2(d.x, 0.0), 0.0)).rgb));
  c = max(c, chroma3(texture(uMA, vec3(uv + vec2(0.0, d.y), 0.0)).rgb)); c = max(c, chroma3(texture(uMA, vec3(uv - vec2(0.0, d.y), 0.0)).rgb));
  c = max(c, chroma3(texture(uMA, vec3(uv + d, 0.0)).rgb)); c = max(c, chroma3(texture(uMA, vec3(uv - d, 0.0)).rgb));
  return smoothstep(0.25, 0.5, c) * logoBox(uv);
}
// 文字は塗り（拡散）と艶（白い映り込み）に分け、部屋の色を塗りへ薄く・艶へ強く。部屋が暗いと塗りも沈む
vec3 logoRelight(vec3 lit, float m, float kk, vec3 col) {
  if (m <= 0.0) return lit;
  vec3 L = s2l(lit), cn = col / max(max(col.r, max(col.g, col.b)), 1e-4);
  float e = min(kk, 1.0), sp = min(L.r, min(L.g, L.b));
  vec3 dif = L - sp, spec = vec3(sp);
  dif = dif * mix(vec3(1.0), cn, 0.38 * e) * mix(0.6, 1.0, e) + cn * lumi(dif) * 0.22 * e;
  vec3 coloredSpec = spec * mix(vec3(1.0), cn * 1.1, 0.8 * e);
  return mix(lit, l2s(dif + coloredSpec), m);
}
// 枠の光（3D 担当の色なしの素材 B4・W4、pack A の 6・7 層）：線形で F0 + k·(B4 − F0) + k·LED·色。めっきは部屋の明るさに沈み、LED の光だけが演出の色になる
vec3 frameLitBW(vec3 s0, vec2 uv, float kk, vec3 col) {
  vec3 l0 = s2l(s0), b4 = s2l(texture(uMA, vec3(uv, 6.0)).rgb), w4 = s2l(texture(uMA, vec3(uv, 7.0)).rgb);
  b4 = mix(b4, vec3(lumi(b4)), logoBox(uv) * (1.0 - logoLetter(uv)) * 0.9);   // 文字の下の青・赤の焼き込み映り込みは部屋の色に任せる
  vec3 dl = max(w4 - b4, 0.0); float led = max(dl.r, max(dl.g, dl.b));
  vec3 cn = col / max(max(col.r, max(col.g, col.b)), 1e-4);
  return l2s(l0 + min(kk, 1.0) * (b4 - l0) + kk * led * cn);
}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec4 dec(vec4 e) { return e * e; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 px = vec2(gl_FragCoord.x, ${H}.0 - gl_FragCoord.y);          // 画面 px（左上原点、画素の中心）
  vec2 uvA = px / vec2(${W}.0, ${H}.0);
  vec4 f0 = uM3Off == 0 ? texture(uMA, vec3(uvA, 0.0)) : vec4(0.0);
  vec3 o = vec3(0.0);
  // 枠のalphaが厳密に1の画素では、この下の全合成は最後に完全に覆われる。
  // 半透明の縁を含む他の画素は、元と同じ順番・精度・サンプルで計算する。
  if (f0.a < 1.0 || uM3Off != 0) {
  vec4 cc = uView == 1 ? texelFetch(uD, p, 0) : texelFetch(uC, p, 0);
  vec3 dyn = uUseLut == 1 ? lutPbrNeutral(cc.rgb) : clamp(cc.rgb, 0.0, 1.0);
  o = dyn;
  if (uM3Off == 0 && px.y < ${ROW_M3}.0) {
    float b = clamp(1.0 - cc.a, 0.0, 1.0);                           // 玉の覆い（遮蔽 50 m で玉はすべて手前の印）
    vec3 l = dyn;
    // ガラスの映り込みと黒の浮き（screen）
    vec3 g = mix(texture(uMA, vec3(uvA, 4.0)).rgb, texture(uMA, vec3(uvA, 5.0)).rgb, uGlass);
    l = 1.0 - (1.0 - l) * (1.0 - g * uGlassK);
    // 盤面電飾の導光板（wash・ring）：明るさを保って光の色に染め、足す
    float ey = (px.y - ${E.y}.0) / ${E.h}.0;
    vec3 zoneL = vec3(0.0);
    if (ey > 0.0 && ey < 1.0) {
      vec2 ue = vec2(uvA.x, ey);
      vec4 w0 = dec(texture(uME, vec3(ue, 0.0))) * uEs[0], w1 = dec(texture(uME, vec3(ue, 1.0))) * uEs[1], r0 = dec(texture(uME, vec3(ue, 2.0))) * uEs[2];
      vec3 Cw = w0.x * uWash[0] + w0.y * uWash[1] + w0.z * uWash[2] + w0.w * uWash[3] + w1.x * uWash[4] + w1.y * uWash[5] + w1.z * uWash[6] + w1.w * uWash[7]
              + r0.x * uRing[0] + r0.y * uRing[1] + r0.z * uRing[2] + r0.w * uRing[3];
      float mx = max(Cw.r, max(Cw.g, Cw.b));
      if (mx > 1e-4) {
        vec3 v = invTm(l), n = Cw / mx;
        float a = min(uWashGain * ${E.wash_mix.tint.toFixed(3)} * mx, min(uWashCap, ${E.wash_mix.tint_max.toFixed(3)}));   // 山場の閃きでも液晶・球が読める上限（NOTES §5）
        v = v * (1.0 - a) + a * lumi(v) * n / max(lumi(n), 0.05);
        v += uWashGain * ${E.wash_mix.add.toFixed(3)} * Cw;
        l = Tm(v);
      }
      vec4 z0 = dec(texture(uME, vec3(ue, 3.0))) * uEs[3], z1 = dec(texture(uME, vec3(ue, 4.0))) * uEs[4];
      zoneL = uZoneGain * (z0.x * uZone[0] + z0.y * uZone[1] + z0.z * uZone[2] + z0.w * uZone[3] + z1.x * uZone[4] + z1.y * uZone[5] + z1.z * uZone[6] + z1.w * uZone[7]);
    }
    // 穴の段：LED の色（x の範囲で穴・柱を決める）
    float sy = (px.y - ${C.y}.0) / ${C.height}.0;
    vec3 hc = vec3(0.0), pc = vec3(0.0); vec4 hl = vec4(0.0);
    bool strip = sy > 0.0 && sy < 1.0;
    vec2 us = vec2(uvA.x, sy);
    if (strip) {
      hl = dec(texture(uMC, vec3(us, 4.0))) * ${C.scale.toFixed(2)};
      for (int i = 0; i < 7; i++) { if (px.x >= uHoleX[i].x && px.x < uHoleX[i].y) hc = uHole[i]; if (px.x >= uPilX[i].x && px.x < uPilX[i].y) pc = uPil[i]; }
      vec4 bk = mix(texture(uMC, vec3(us, 2.0)), texture(uMC, vec3(us, 3.0)), uK4);      // 穴の奥の黒の板（球の後ろ）
      vec3 bpm = Tm(invTm(bk.rgb * bk.a) + hl.g * hc + hl.a * pc);
      l = l * (1.0 - bk.a) + bpm;
    }
    o = mix(l, dyn, b);
    // 盤の釘・柵（v39 の前、球の上）
    vec4 bd = mix(texture(uMA, vec3(uvA, 2.0)), texture(uMA, vec3(uvA, 3.0)), uK4);
    o = mix(o, bd.rgb, bd.a);
    // 穴のランプのにじみ：灯った穴・入った瞬間の光が、穴の口の上の盤（と球）を照らす
    if (uGlowK > 0.0 && px.y > ${C.y}.0 - 190.0 && px.y < ${C.y}.0 + 60.0) {
      vec3 gl = vec3(0.0);
      for (int i = 0; i < 7; i++) {
        float cx = 0.5 * (uHoleX[i].x + uHoleX[i].y), hw = 0.5 * (uHoleX[i].y - uHoleX[i].x);
        float dx = max(abs(px.x - cx) - hw * 0.55, 0.0), dy = max(${C.y}.0 + 40.0 - px.y, 0.0);
        gl += uHole[i] * exp(-dx * dx / (2.0 * 38.0 * 38.0)) * exp(-dy / 62.0);
      }
      o = Tm(invTm(o) + uGlowK * gl);
    }
    if (strip) {                                                        // 穴の前の部品と窓の LED
      vec4 fo = mix(texture(uMC, vec3(us, 0.0)), texture(uMC, vec3(us, 1.0)), uK4);
      vec3 fpm = Tm(invTm(fo.rgb * fo.a) + hl.r * hc + hl.b * pc);
      o = o * (1.0 - fo.a) + fpm;
    }
    if (max(zoneL.r, max(zoneL.g, zoneL.b)) > 1e-4) o = Tm(invTm(o) + zoneL);
  }
  if (uM3Off == 0) {
    // 皿の中（R3-M5 項目 7）：stage2c の皿の代わりに、球の下・囲いの下へ敷く
    vec2 ut = (px - vec2(${T.x}.0, ${T.y}.0)) / vec2(${T.width}.0, ${T.height}.0);
    if (ut.x > 0.0 && ut.y > 0.0 && ut.x < 1.0 && ut.y < 1.0) {
      vec4 tr = mix(texture(uMT, vec3(ut, 0.0)), texture(uMT, vec3(ut, 1.0)), uK4);
      o = mix(mix(o, tr.rgb, tr.a), dyn, clamp(1.0 - cc.a, 0.0, 1.0));
    }
  }
  if (uM3Off == 0 && uMouthK > 0.0) {
    // 皿の払い出し口の庇（玉の上）：口の上と左右の縁。玉は口の奥から縁の内側を通って転がり出る
    vec2 mq = px - uMouth.xy, ms = uMouth.zw - uMouth.xy;
    float T0 = -8.0, T1 = 10.0, SW = 11.0;                                   // 庇の厚み（上）と縁の幅（左右）
    float inx = step(-SW, mq.x) * step(mq.x, ms.x + SW);
    float top = step(T0, mq.y) * step(mq.y, T1) * inx;
    float side = step(T1, mq.y) * step(mq.y, ms.y + 2.0) * (step(-SW, mq.x) * step(mq.x, 0.0) + step(ms.x, mq.x) * step(mq.x, ms.x + SW));
    float rim = clamp(top + side, 0.0, 1.0);
    // 庇の下の影（壁と口の中）
    float sh = (1.0 - rim) * inx * smoothstep(T1 + 22.0, T1, mq.y) * step(T1, mq.y) * step(mq.y, ms.y + 8.0);
    o *= 1.0 - 0.45 * sh * uMouthK;
    if (rim > 0.0) {
      float u = top > 0.0 ? (mq.y - T0) / (T1 - T0) : (mq.x < 0.0 ? (mq.x + SW) / SW : (ms.x + SW - mq.x) / SW);   // 0 外側 → 1 内側
      vec3 pinkL = vec3(0.95, 0.05, 0.40);
      vec3 rc = pinkL * mix(0.55, 0.18, smoothstep(0.55, 1.0, u)) + vec3(1.0, 0.75, 0.88) * exp(-pow((u - 0.28) * 6.0, 2.0)) * 0.55 + vec3(0.6) * exp(-pow((u - 0.08) * 14.0, 2.0)) * 0.25;
      rc *= mix(0.8, 1.15, uK4);
      o = mix(o, l2s(rc), rim * uMouthK);
    }
    // 口の奥：上から下へ少し明るい（中の玉の輪郭が見える）
    if (mq.x > 0.0 && mq.x < ms.x && mq.y > T1 && mq.y < ms.y) o = mix(o, o + vec3(0.035, 0.02, 0.03) * (mq.y / ms.y), uMouthK);
  }
  } // 不透明な枠の下の計算
  if (uM3Off == 0) {
    // 枠（0 灯と 4 灯の差のうち増える光を、区画ごとの色と強さで）
    vec2 scoreUv = (px - vec2(${D.x}, ${D.y})) / vec2(${D.width}.0, ${D.height}.0);
    if (f0.a > 0.001 || (scoreUv.x > 0.0 && scoreUv.y > 0.0 && scoreUv.x < 1.0 && scoreUv.y < 1.0)) {
    vec4 ra = texture(uMF, vec3(uvA, 0.0)), rb = texture(uMF, vec3(uvA, 1.0));
    ra *= ra; rb *= rb;
    float wsum = ra.x + ra.y + ra.z + ra.w + rb.x + rb.y + rb.z + rb.w + 1e-4;
    float kk = (ra.x * uK[0] + ra.y * uK[1] + ra.z * uK[2] + ra.w * uK[3] + rb.x * uK[4] + rb.y * uK[5] + rb.z * uK[6] + rb.w * uK[7]) / wsum;
    vec3 col = (ra.x * uK[0] * uKc[0] + ra.y * uK[1] * uKc[1] + ra.z * uK[2] * uKc[2] + ra.w * uK[3] * uKc[3] + rb.x * uK[4] * uKc[4] + rb.y * uK[5] * uKc[5] + rb.z * uK[6] * uKc[6] + rb.w * uK[7] * uKc[7]) / max(kk * wsum, 1e-4);
    float rc = (ra.x * uRecolor[0] + ra.y * uRecolor[1] + ra.z * uRecolor[2] + ra.w * uRecolor[3] + rb.x * uRecolor[4] + rb.y * uRecolor[5] + rb.z * uRecolor[6] + rb.w * uRecolor[7]) / wsum;
    if (f0.a > 0.001) {
      vec3 f4 = texture(uMA, vec3(uvA, 1.0)).rgb;
      vec3 lit = uBW == 1 ? frameLitBW(f0.rgb, uvA, kk, col) : frameLit(f0.rgb, f4, kk, col, rc);
      // 案B：頭・エラはF4の明るさ模様を濃く染める。区画を増やさず銀のしわを抑える。
      if (uScriptTint > 0.0) {
        vec3 l4 = s2l(f4); float pattern = max(l4.r, max(l4.g, l4.b));
        vec3 hue = mix(col, vec3(1.0), pow(pattern, 16.0) * 0.12);
        vec3 dyed = l2s(mix(s2l(f0.rgb), pattern * hue * kk, 1.0));
        lit = mix(lit, dyed, (ra.x + ra.y) / wsum);
      }
      lit = logoRelight(lit, logoLetter(uvA), kk, col);   // ロゴの文字：部屋の色を塗りと艶に受ける
      o = mix(o, lit, f0.a);
    }
    // 得点表示板：消灯の絵 ＋ 点ける区画（線形の光）
    vec2 ud = (px - vec2(${D.x}, ${D.y})) / vec2(${D.width}.0, ${D.height}.0);
    if (ud.x > 0.0 && ud.y > 0.0 && ud.x < 1.0 && ud.y < 1.0) {
      // 得点板はR3専用のD0/D4を使う。全体のB4/W4には旧SSの文字が焼かれている。
      vec3 off = frameLit(texture(uMD, vec3(ud, 0.0)).rgb, texture(uMD, vec3(ud, 1.0)).rgb, kk, col, rc);
      float sg = 0.0;
      for (int j = 0; j < 7; j++) { vec4 s = dec(texture(uMD, vec3(ud, float(2 + j)))); sg += s.x * uSeg[j * 4] + s.y * uSeg[j * 4 + 1] + s.z * uSeg[j * 4 + 2] + s.w * uSeg[j * 4 + 3]; }
      vec3 add = sg * ${D.scale.toFixed(2)} * uSegC;
      for (int j = 0; j < 5; j++) if (uMet[j] > 0.0) add += dec(texture(uMD, vec3(ud, float(9 + j)))).rgb * ${D.scale.toFixed(2)} * uMet[j];
      // 得点板の絵は周りの枠まで含むので、枠の光（F0/F4）と色がずれて四角く見える。窓（ガラスと C/B/A/S の皿）の内側だけを差し替え、縁のめっきと周りは枠（B4/W4）に任せる
      vec2 dp = ud * vec2(${D.width}.0, ${D.height}.0), bc = vec2(246.0, 186.0), bh = vec2(184.0, 126.0);
      vec2 bq = abs(dp - bc) - bh + 12.0;
      float bd = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0) - 12.0;
      float fade = 1.0 - smoothstep(-3.0, 1.0, bd);
      // 窓の中：C/B/A/S の板は部屋の色を薄く受け、ガラスは部屋の色を斜めに映す
      vec3 cnS = mix(col / max(max(col.r, max(col.g, col.b)), 1e-4), vec3(1.0), 0.25); float eS = min(kk, 1.0);
      off = l2s(s2l(off) * mix(vec3(1.0), cnS, 0.3 * eS));
      float gl = smoothstep(0.0, 1.0, 1.0 - ((dp.x - 62.0) / 368.0 * 0.6 + (dp.y - 60.0) / 252.0 * 0.8));
      add += cnS * eS * (0.012 + 0.05 * gl) * (dp.y < 236.0 ? 1.0 : 0.5);
      o = mix(o, Tm(invTm(off) + add), fade);
    }
  }
    } // 枠または得点板の画素
  o += uDither * (h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy + 17.0) - 1.0);
  gl_FragColor = vec4(o, 1.0);
}`;
}

// 液晶の板：盤全体の液晶の面へ。uRectでpanelの等倍動画と旧16:9映像の両方を扱う。
function lcdShader() {
  return {
    vertexShader: 'varying vec2 vP; uniform vec4 uPanel; void main(){ vP = mix(uPanel.xy, uPanel.zw, vec2(uv.x, 1.0 - uv.y)); gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`uniform sampler2D uT; uniform float uGain; uniform vec4 uRect; uniform float uExt, uLod; varying vec2 vP;
      vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main(){
        vec2 q = (vP - uRect.xy) / uRect.zw;                        // 0..1 が映像（上が 0）
        // 既定panelでは等倍。旧液晶のcoverでは左右を切る。鏡写しは無し。
        vec3 c = lin(texture(uT, vec2(clamp(q.x, 0.0, 1.0), 1.0 - clamp(q.y, 0.0, 1.0))).rgb);
        gl_FragColor = vec4(c * uGain, 0.0);
      }`,
  };
}

// Only complete owned script rows can replace every legacy region output.
function regionNumbers(a,n) {
  if(a?.length!==n)return false;
  for(let i=0;i<n;i++)if(!Number.isFinite(a[i]))return false;
  return true;
}
function regionTriples(a,n) {
  if(a?.length!==n)return false;
  for(let i=0;i<n;i++)if(!regionNumbers(a[i],3))return false;
  return true;
}
function completeScriptRegions(s) {
  return s?.script1029===true&&regionNumbers(s.K,8)&&regionNumbers(s.recolor,8)&&regionTriples(s.Kc,8)&&regionTriples(s.wash,8)&&regionTriples(s.zone,8)&&regionTriples(s.ring,4);
}

export async function installM3Cabinet({ hr, fxApi, presenter, pa = null, getLamps = null, getMeter = null, onMeterLand = null, getPrize = null, prizeNames = null, ownedInitialEnvironment = null, packUrl = new URL('./pack1026/manifest.json', import.meta.url).href, q = new URLSearchParams() }) {
  const t0 = performance.now();
  const man = await (await fetch(packUrl)).json();
  const base = new URL('.', packUrl);
  const [tA, tC, tD, tE, tF, tT] = await Promise.all(['A', 'C', 'D', 'E', 'F', 'T'].map(k => loadArray(base, man.arrays[k])));
  // 1. 環境：盤の窓と穴の段は液晶と玉だけ。皿は stage2c のまま
  const env = hr.env;
  const owned = ownedInitialEnvironment === env ? ownedEnvironmentInputs(env) : null;
  if (!owned) hr.setEnvironment(patchedEnvironment(env));
  hr.setLayers([]);
  // 2. 最後のパス
  const fm = hr.finalMat, C = man.arrays.C;
  fm.fragmentShader = finalShader(hr.lut, man);
  const v3 = (n) => Array.from({ length: n }, () => new THREE.Vector3());
  Object.assign(fm.uniforms, {
    uMA: { value: tA }, uMC: { value: tC }, uMD: { value: tD }, uME: { value: tE }, uMF: { value: tF }, uMT: { value: tT },
    uK: { value: new Array(8).fill(0) }, uKc: { value: v3(8) }, uK4: { value: 0 }, uRecolor: { value: new Array(8).fill(0) }, uScriptTint: { value: 0 },
    uHole: { value: v3(7) }, uPil: { value: v3(7) },
    uHoleX: { value: C.holes.map(h => new THREE.Vector2(h.x, h.x + h.w)) }, uPilX: { value: C.pillars.map(p => new THREE.Vector2(p.x, p.x + p.w)) },
    uSeg: { value: new Array(28).fill(0) }, uSegC: { value: new THREE.Vector3(...man.arrays.D.digit_on) }, uMet: { value: new Array(5).fill(0) },
    uWash: { value: v3(8) }, uRing: { value: v3(4) }, uZone: { value: v3(8) },
    uWashGain: { value: Number(q.get('m3wash') ?? man.arrays.E.wash_gain) }, uZoneGain: { value: Number(q.get('m3zone') ?? man.arrays.E.zone_gain) }, uGlass: { value: 0 }, uGlassK: { value: Number(q.get('m3glass') ?? 0.3) },
    uEs: { value: Array.from({ length: 5 }, (_, i) => new THREE.Vector4(...man.arrays.E.scales.slice(i * 4, i * 4 + 4))) },
    uM3Off: { value: 0 }, uWashCap: { value: Number(q.get('m3washcap') ?? 0.3) },
    uBW: { value: (man.arrays.A.layers >= 8 && q.get('m3bw') !== '0') ? 1 : 0 },   // 枠の光を B4・W4 で（?m3bw=0 で元の 0・4 灯の差の塗り替え）
    uMouth: { value: new THREE.Vector4(...(q.get('m3mouth') ?? '1046,2224,1190,2296').split(',').map(Number)) }, uMouthK: { value: Number(q.get('m3mouthk') ?? 1) }, uGlowK: { value: Number(q.get('m3glow') ?? 0.22) },
  });
  fm.needsUpdate = true;

  // 3. 液晶の板（play_fx が最初のフレームで作る板を、盤全体の液晶の窓へ）
  const LW = man.lcd_window, panel = LW.panel, vis = LW.visible;
  // 液晶の映像の置き方（m3lcdfit）：cover＝窓の高さに合わせて拡大し左右を切る（既定、案 A）／width＝幅に合わせる（16:9 の小窓、上の端は m3lcdy）
  const FIT = q.get('m3lcdfit') ?? 'cover';
  // panel＝液晶の面いっぱい（?lcd=video の映像は面の比で作る。play/lcd_surface）
  const lcdRect = FIT === 'panel' ? [panel.x, panel.y, panel.w, panel.h] : FIT === 'width' ? [vis.x, Number(q.get('m3lcdy') ?? 870), vis.w, vis.w * 720 / 1280]
    : (() => { const h = vis.h, w = h * 1280 / 720; return [vis.x + vis.w / 2 - w / 2, vis.y, w, h]; })();
  let platePatched = false;
  const patchPlate = () => {
    const plate = fxApi?.plate; if (!plate || platePatched) return;
    const [x0, y0, x1, y1] = [panel.x, panel.y, panel.x + panel.w, panel.y + panel.h];
    const nx = (x) => x / W * 2 - 1, ny = (y) => 1 - y / H * 2;
    plate.mesh.geometry.attributes.position.array.set([nx(x0), ny(y0), 0, nx(x1), ny(y0), 0, nx(x1), ny(y1), 0, nx(x0), ny(y1), 0]);
    plate.mesh.geometry.attributes.position.needsUpdate = true;
    const sh = lcdShader();
    plate.mat.vertexShader = sh.vertexShader; plate.mat.fragmentShader = sh.fragmentShader;
    Object.assign(plate.mat.uniforms, { uPanel: { value: new THREE.Vector4(x0, y0, x1, y1) }, uRect: { value: new THREE.Vector4(...lcdRect) } });
    plate.mat.needsUpdate = true;
    plate.tex.generateMipmaps = false; plate.tex.minFilter = THREE.LinearFilter; plate.tex.needsUpdate = true;
    if (q.has('m3lcdoff')) plate.mesh.visible = false;   // 確認用：液晶を消す（盤の釘・穴の段を見る）
    platePatched = true;
  };

  // 4. 光：演出のフレーム（花びら 45・縁 24・穴 7・メーター）から m3 の区画へ
  const geom = fxApi?.fx?.geom ?? await (await fetch('/work/effects/spec/geometry.json')).json();
  const adapter = fxApi?.adapter;
  const petalPx = geom.petals.map(p => [p.u * W, p.v * H]);
  const edgePx = geom.edge.map(e => [742.5 + ((e.x - 0.006) / 0.151) * 597, 1094 - ((e.y + 0.015) / 0.169) * 336]);
  // 枠の 8 区画の中心（画面 px）と、近い花びら・縁の重み
  const REG = [[720, 330], [720, 200], [480, 250], [70, 1050], [70, 1850], [1370, 1050], [1370, 1850], [720, 2450]];
  const gw = (pts, c, s) => { const w = pts.map(([x, y]) => Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / (2 * s * s))); const t = w.reduce((a, b) => a + b, 0) || 1; return w.map(v => v / t); };
  const regPW = REG.map(c => gw(petalPx, c, 420)), regEW = REG.map(c => gw(edgePx, c, 420));
  const wash = adapter ? makeBoardWash(geom, adapter, { gain: 1 }) : null;
  // m3 の導光板の区画（時計回り 0 上の左 … 7 左の上）← board_wash の 8 か所（左上/右上/上/左/右/左下/右下/下）
  const ZMAP = [[0, 2], [1, 2], [1, 4], [4, 6], [6, 7], [5, 7], [3, 5], [0, 3]];
  let digits = new Array(28).fill(0), segRGB = null;
  if (adapter?.setCabinet) {
    const orig = adapter.setCabinet.bind(adapter);
    adapter.setCabinet = (patch) => { const r = orig(patch); if (patch?.display?.digits) { digits = r.display.digits.map(d => d.gain * Math.max(...d.rgb)); segRGB = r.display.digits.find(d => d.gain * Math.max(...d.rgb) > 0)?.rgb ?? segRGB; } return r; };
  }
  const REF = Number(q.get('m3ref') ?? 0.9), SATP = Number(q.get('m3sat') ?? 2.2);     // 演出の花びら・縁の色の強さ → m3 の 4 灯（1）
  const ec = new Float32Array(geom.edge.length * 3);
  const U = fm.uniforms;
  const st = { k4: 0, regions: [], lastF: null };
  const mixT = (a, b, w) => a.map((v, i) => v * (1 - w) + b[i] * w);
  // 盤面電飾の表（NOTES §5）：[出来事の中の時刻(秒、JP は配当で伸びる), 長さ(秒), 色, 波]
  const FLASH = {
    lamp4: [[1.1, 0.5, 'sakura']], lamp6: [[0.3, 0.7, 'gold']], success_big: [[0.1, 0.8, 'rainbow', 1]],
    jp: [[0.0, 1.0, 'rainbow', 1], [11.2, 0.8, 'rainbow', 1]], roulette: [[6.8, 0.35, 'redwhite']],
  };
  const FCOL = { sakura: [1, .3, .55], gold: [1, .55, .08], redwhite: [1, .35, .3] };
  const hsv = (h) => { const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
  const FLASH_PEAK = Number(q.get('m3flash') ?? 0.5), WS = Number(q.get('m3washref') ?? 4.0), ZONEK = Number(q.get('m3zonek') ?? 0.5);
  const HOLE_BASE = Number(q.get('m3hole') ?? 2.0), HOLE_HIT = Number(q.get('m3hit') ?? 12);   // 10/21 夜：監督「光り方が甘い」→ 強く（元 0.9・6）
  const hitAt = new Array(7).fill(-99), pendingHit = [];
  // 「点かない」(receipt.tease): 入ったのに6灯目が点かない。白い閃きは出さず、その穴だけ弱く短く（約0.35秒）明滅する
  const teaseAt = new Array(7).fill(-99), pendingTease = [];
  presenter?.on?.((type, d) => { if (type === 'receipt' && d.lane >= 1 && d.lane <= 7 && d.kind !== 'Loan') (d.tease ? pendingTease : pendingHit).push(d.lane - 1); });
  // JPチャンス（連打メーター）中の「入れる穴」強調：当たりの穴だけを速く脈打たせ、ほかの灯を落とし、入った瞬間に強く閃かせる。?jpholehl=0 で旧挙動（メーター中も穴は通常のまま）
  // 確保なし：状態は固定長の配列と数値だけ。meter はゲームの生の状態（targets=まだ光っていない穴、stage=intro|firing|settling）
  const JPHL = q.get('jpholehl') !== '0', hlMask = new Uint8Array(7), sealAt = new Array(7).fill(-99), pendingSeal = [];
  let hlK = 0, hlClock = 0;
  if (JPHL && onMeterLand) onMeterLand((lane) => { if (lane >= 1 && lane <= 7) pendingSeal.push(lane - 1); });
  // 払い出しの速さ：1 秒に 10 個より遅い払い出し（演出の JP 30 個＝n÷長さで 4.7 個/秒、速さの指定なし＝物理の既定 0.15 秒に 1 個）を 10 個/秒に（統括の目安 10〜15）。
  // 速いもの（開始の貸し玉 80 個＝40 個/秒の指定）はそのまま。指定なしは 12 個/秒。?m3payrate=0 で元のまま
  const PAYMIN = Number(q.get('m3payrate') ?? 10);
  if (pa?.payout && PAYMIN > 0) { const orig = pa.payout.bind(pa); pa.payout = (n, earned = true, rate = null) => orig(n, earned, rate > 0 ? Math.max(rate, PAYMIN) : PAYMIN * 1.2); }
  // 払い出し：筒の中の玉は、口の手前 1 球ぶんから見せる（口の奥から転がり出る）。物理・台帳は触らない
  const tv = hr.trayVisualHandle;
  if (pa && tv?.visibleBalls && q.get('m3mouthk') !== '0') {
    const T = pa.tray, exitZ = -0.14 + T.T[2], REVEAL = Number(q.get('m3reveal') ?? 0.012);
    let buf = null;
    tv.visibleBalls = (data) => {
      if (!T.activePayout || !data.ids) return data;
      buf ??= new Float32Array(pa.maxBalls * 3); let n = 0;
      for (let i = 0; i < data.count; i++) {
        const b = T.activeBalls.get(data.ids[i]);
        if (b?.state === 'payout' && !(b.prev.z > exitZ - REVEAL && b.prev.y < T.T[1] - 0.232)) continue;
        for (let j = 0; j < 3; j++) buf[n * 3 + j] = data.positions[i * 3 + j]; n++;
      }
      return { count: n, positions: buf };
    };
  }
  function update(clock) {
    patchPlate();
    const F = fxApi?.frameData;
    if (!F || !F.petal) return;
    const A = F.ambient ?? 1, act = F.active || [];
    // Complete 1029 script rows overwrite all these region outputs below.
    if (!(U.uScriptTint && completeScriptRegions(F.m3))) {
    for (let i = 0; i < geom.edge.length; i++) { const c = adapter.edgeColor(F, i, clock); ec[i * 3] = c[0]; ec[i * 3 + 1] = c[1]; ec[i * 3 + 2] = c[2]; }
    let ksum = 0;
    for (let r = 0; r < 8; r++) {
      let R = 0, G = 0, B = 0;
      const pw = regPW[r], ew = regEW[r];
      for (let i = 0; i < pw.length; i++) { R += F.petal[i * 3] * pw[i]; G += F.petal[i * 3 + 1] * pw[i]; B += F.petal[i * 3 + 2] * pw[i]; }
      let eR = 0, eG = 0, eB = 0;
      for (let i = 0; i < ew.length; i++) { eR += ec[i * 3] * ew[i]; eG += ec[i * 3 + 1] * ew[i]; eB += ec[i * 3 + 2] * ew[i]; }
      // 頭・エラ・ロゴは花びら、柱と下は縁の LED
      const pf = r <= 2 ? 0.85 : 0.35;
      R = R * pf + eR * (1 - pf); G = G * pf + eG * (1 - pf); B = B * pf + eB * (1 - pf);
      if (r === 2 && F.logo) { R = R * 0.5 + F.logo[0] * 0.5; G = G * 0.5 + F.logo[1] * 0.5; B = B * 0.5 + F.logo[2] * 0.5; }
      const m = Math.max(R, G, B);
      const k = Math.min(1.6, m / REF);
      U.uK.value[r] = k; ksum += Math.min(1, k);
      if (m > 1e-5) { const c = [R / m, G / m, B / m].map(v => v ** SATP); const mm = Math.max(...c); U.uKc.value[r].set(c[0] / mm, c[1] / mm, c[2] / mm); } else U.uKc.value[r].set(...PINK);
      const kc = U.uKc.value[r], dp = Math.hypot(kc.x - PINK[0], kc.y - PINK[1], kc.z - PINK[2]);
      U.uRecolor.value[r] = Math.min(1, dp * 2.5);
    }
    st.k4 = ksum / 8; U.uK4.value = Math.min(1, st.k4); U.uGlass.value = Math.min(1, st.k4);
    }
    // 縁の帯（zone、窓の縁の bz）：ふだんの演出の色はここと囲いの 4 灯・枠で出す（弱め）。盤の中（wash）は山場の閃きだけ（NOTES §5 の表）
    const jpOn = act.includes('jp');
    if (wash && !F.m3) {
      const red = act.some((id) => /^(roulette|challenge_declare|challenge_flight)$/.test(id)), hot = act.some((id) => /^(roulette|ascend|challenge_|success|jp|fail|lamp[456]|warn10|timeup|add100|finish_count|result|attract|title|howto|ticket|start)/.test(id));
      const nl = F.n ?? 0;
      const list = wash.compute(F, clock, { ambientMin: red ? .8 : 0, red: red ? 1 : 0, navy: nl <= 3 && !hot ? 1 : 0, k: 1, rainbow: jpOn ? .85 : 0, sat: act.includes('lamp6') ? 2.1 : act.includes('lamp5') ? 1.7 : act.includes('lamp4') ? 1.5 : 1 });
      for (let z = 0; z < 8; z++) {
        const [a, b] = ZMAP[z]; const c = list.length ? mixT(list[a].rgb, list[b].rgb, 0.5).map(v => v / WS * ZONEK) : [0, 0, 0];
        U.uZone.value[z].set(...c);
      }
    }
    // 山場の閃き（wash・ring）：表の出来事の決まった時刻に 0.2〜1.0 秒だけ
    const dir = fxApi?.fx?.dir;
    let fl = 0, flCol = null, flRing = false;
    if (dir) for (const inst of dir.inst) {
      const keys = FLASH[inst.id]; if (!keys) continue;
      for (const [k, dur, col, ring] of keys) {
        const d = (dir.t - inst.t0) - k * (inst.scale || 1); if (d < 0 || d > dur) continue;
        const e = Math.min(1, d / 0.05) * (1 - d / dur) ** 2; if (e > fl) { fl = e; flCol = col; flRing = !!ring; }
      }
    }
    if (!F.m3) {
    for (let z = 0; z < 8; z++) {
      let c = [0, 0, 0];
      if (fl > 0) { const cc = flCol === 'rainbow' ? hsv((z / 8 + clock * 0.6) % 1) : FCOL[flCol]; c = cc.map(v => v * fl * FLASH_PEAK); }
      U.uWash.value[z].set(...c);
    }
    for (let j = 0; j < 4; j++) {   // 縁 → 中央への波（JP の閃きの間だけ）
      const w = flRing ? fl * Math.max(0, Math.sin(2 * Math.PI * (clock * 2 - j * 0.25))) ** 2 * 1.2 : 0;
      const cc = hsv((j / 4 + clock * 0.6) % 1);
      U.uRing.value[j].set(cc[0] * w * FLASH_PEAK, cc[1] * w * FLASH_PEAK, cc[2] * w * FLASH_PEAK);
    }
    } // 本番m3光で上書きされるwash/ringを計算しない
    st.flash = +fl.toFixed(2);
    // 1026: 試作14の動画と同じフレームの光（8区画・縁・盤面）。
    // 穴のLEDはこの後、実物理の灯と着地だけで駆動する。
    U.uScriptTint.value = F.m3?.script1029 ? 1 : 0;
    if (F.m3) {
      for (let r = 0; r < 8; r++) {
        U.uK.value[r] = F.m3.K[r]; U.uKc.value[r].set(...F.m3.Kc[r]);
        if (F.m3.recolor) U.uRecolor.value[r] = F.m3.recolor[r];
        U.uWash.value[r].set(...F.m3.wash[r]); U.uZone.value[r].set(...F.m3.zone[r]);
      }
      for (let r = 0; r < 4; r++) U.uRing.value[r].set(...F.m3.ring[r]);
      st.k4 = F.m3.K.reduce((a,b) => a + b, 0) / 8;
      U.uK4.value = U.uGlass.value = Math.min(1, st.k4);
    }
    // JP の追いかけは穴でなく囲い（柱と下の区画）へ：下から上へ流れる
    if (jpOn && !F.m3?.jp1029) for (const [r, ph] of [[7, 0], [4, .2], [6, .2], [3, .45], [5, .45]]) {
      const w = Math.max(0, Math.sin(2 * Math.PI * (clock * 1.5 - ph))) ** 4 * 0.8;
      U.uK.value[r] = Math.min(1.6, U.uK.value[r] + w);
    }
    // 穴の LED：意味は「球が入った」と「穴の状態」だけ。演出の色（F.pocket）は使わない
    if (pendingHit.length) { for (const i of pendingHit) hitAt[i] = clock; pendingHit.length = 0; }
    if (pendingTease.length) { for (const i of pendingTease) teaseAt[i] = clock; pendingTease.length = 0; }
    const lamps = getLamps ? [...getLamps()] : [], nn = Math.min(6, lamps.length);
    // 灯った穴の色（灯の数で：〜3 灯は暖かい白、4 灯は桃、5 灯は橙、6 灯は金）。白っぽく褪せないよう濃く
    const PC = [[1, .82, .55], [1, .82, .55], [1, .82, .55], [1, .82, .55], [1, .06, .38], [1, .32, .02], [1, .58, 0]][nn];
    const hint = dir?.state?.hint?.holes, hph = hint ? Math.max(0, (dir.t - hint.t0)) : 0;
    const flashOf = new Array(7).fill(0);
    for (let i = 0; i < 7; i++) {
      const lit = lamps.includes(i + 1);
      let c = lit ? PC.map(v => v * HOLE_BASE) : [0, 0, 0];
      if (!lit && lamps.length >= 6 && lamps.length < 7) { const w = HOLE_BASE * (.55 + .35 * Math.sin(2 * Math.PI * 1.1 * clock)); c = [1 * w, .58 * w, 0]; }   // 6 灯：残りの 1 つ＝狙う穴（ゲームの状態）
      if (hint && !lit && (hint.pockets === 'unlit' || (hint.pockets || []).includes(i + 1))) { const w = HOLE_BASE * (.25 + .5 * (.5 + .5 * Math.sin(2 * Math.PI * .8 * hph - Math.PI / 2))); c = c.map((v, q) => Math.max(v, [.5, .82, 1][q] * w)); }   // 説明の「ここを狙う」（チュートリアル）
      const hc=F.m3?.hole;
      if(hc?.mode==='target_pulse'&&!lit&&lamps.length===6){const gain=HOLE_BASE*(hc.level??((hc.gain??1)*(.55+.35*Math.sin(2*Math.PI*(hc.hz??1.7)*clock))));c=(hc.rgb??[1,.58,0]).map(v=>v*gain);}
      if(hc?.mode==='script'&&hc.v){const a=hc.v;c=[Math.max(c[0],a[i*3]*HOLE_BASE),Math.max(c[1],a[i*3+1]*HOLE_BASE),Math.max(c[2],a[i*3+2]*HOLE_BASE)];}   // 10/30 newlight：場面の台本が穴ごとの色を渡す（?newlight=0 では来ない）
      if(hc?.mode==='near_miss'&&hc.cup===i+1){c=c.map((v,q)=>Math.max(v,(hc.rgb??[.45,.35,.6])[q]*HOLE_BASE*(hc.gain??0)));}
      const dt = clock - teaseAt[i];
      if (dt >= 0 && dt < 0.35) { const k = Math.sin(Math.PI * dt / 0.35) ** 2 * 0.5 * HOLE_BASE; c = [Math.max(c[0], k), Math.max(c[1], .58 * k), c[2]]; }
      const d = clock - hitAt[i];
      if (d >= 0 && d < 0.6) {   // 入った瞬間：白い閃き → 穴の色
        // 0〜0.06 秒は白、そのあと濃い穴の色が強く残り（0.5 秒で状態の明るさへ）
        const w = Math.exp(-d / 0.06), after = 1 + 1.6 * Math.exp(-d / 0.22), hue = lit || lamps.length ? (lit ? PC : [1, .58, 0]) : PC;
        c = c.map((v, q) => (Math.max(v, hue[q] * HOLE_BASE) * after) * (1 - w) + HOLE_HIT * w); flashOf[i] = Math.max(w, (after - 1) / 1.6);
      }
      U.uHole.value[i].set(...c);
    }
    for (let j = 0; j < 7; j++) {   // 柱：入った穴の閃きのにじみだけ（ふだんは消灯）
      const w = Math.max(flashOf[j], flashOf[Math.min(6, j + 1)]) * HOLE_HIT * 0.25;
      U.uPil.value[j].set(w, w, w);
    }
    if (JPHL && getMeter) {   // JPチャンス中の強調（上の穴の灯を後から上書き）
      const jm = getMeter(), on = !!jm && jm.targets.length > 0;
      const dtc = Math.min(0.1, Math.max(0, clock - hlClock)); hlClock = clock;
      if (on) { for (let i = 0; i < 7; i++) hlMask[i] = jm.targets.includes(i + 1) ? 1 : 0; hlK = Math.min(1, hlK + dtc / 0.2); }
      else if (hlK > 0) hlK = Math.max(0, hlK - dtc / 0.35);
      if (pendingSeal.length) { for (const i of pendingSeal) if (on && hlMask[i]) sealAt[i] = clock; pendingSeal.length = 0; }
      if (hlK > 0) {
        const hz = on && jm.stage !== 'intro' ? 4.4 : 2.4, ph = 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * clock), s = ph * ph * (3 - 2 * ph);   // 速い脈動（なめらかな山）
        const gain = HOLE_BASE * (1.3 + 1.9 * s) * hlK;                                                                                       // 暗い谷でも通常の灯より明るい
        const dim = 1 - 0.78 * hlK;
        for (let i = 0; i < 7; i++) {
          const v = U.uHole.value[i];
          if (hlMask[i]) {
            let gx = gain, gy = gain * (0.68 + 0.27 * s), gz = gain * (0.10 + 0.5 * s * s);   // 金（谷）→ 白金（山）
            const d = clock - sealAt[i];
            if (d >= 0 && d < 0.9) { const k = Math.exp(-d / 0.3), w = Math.exp(-d / 0.05); gx += HOLE_HIT * (0.5 * k + 0.5 * w); gy += HOLE_HIT * (0.42 * k + 0.55 * w); gz += HOLE_HIT * (0.18 * k + 0.55 * w); }   // 入った瞬間：白→金の強い閃光
            v.set(Math.max(v.x * (1 - hlK), gx), Math.max(v.y * (1 - hlK), gy), Math.max(v.z * (1 - hlK), gz));
            // 柱：当たりの穴の両脇の縁もにじませる
            if (i > 0) { const p = U.uPil.value[i - 1]; p.set(p.x + gx * 0.2, p.y + gy * 0.17, p.z + gz * 0.1); }
            const p2 = U.uPil.value[i]; p2.set(p2.x + gx * 0.2, p2.y + gy * 0.17, p2.z + gz * 0.1);
          } else v.set(v.x * dim, v.y * dim, v.z * dim);
        }
      }
    }
    // 得点表示板：7 セグ（setCabinet の桁）とメーター（演出の seg.meter）
    for (let i = 0; i < 28; i++) U.uSeg.value[i] = digits[i] * (F.m3?.displayGain ?? A);
    if (segRGB) { const m = Math.max(...segRGB, 1e-5); U.uSegC.value.set(segRGB[0] / m, segRGB[1] / m, segRGB[2] / m); }
    const met = F.seg?.meter || [0, 0, 0, 0, 0];
    // メーター：今の賞（JP の配当の合計で決まる。C＝1 段目 … SS＝5 段目）まで点ける。演出のメーターの流しはその上に
    const prizeRank = getPrize && prizeNames ? prizeNames.indexOf(getPrize()) : 0;
    const rank = Math.min(prizeRank,F.m3?.meterLimit??5);
    for (let i = 0; i < 5; i++) U.uMet.value[i] = Math.max(Math.max(0, met[i]), i < rank ? 0.9 : 0) * (F.m3?.meterGain ?? A);
    st.lastF = F; st.k = [...U.uK.value].map(v => +v.toFixed(2)); st.wash = U.uWash.value.map(v => +Math.max(v.x, v.y, v.z).toFixed(2)); st.pocket = Array.from(F.pocket, v => +v.toFixed(1));
  }
  hr.rtMain.resolveDepthBuffer = false;
  installNativeMergedMain(hr, { getLCDMesh: () => fxApi?.plate?.mesh ?? null });
  const info = { ms: Math.round(performance.now() - t0), layers: Object.fromEntries(Object.entries(man.arrays).map(([k, v]) => [k, v.layers])) };
  const result = { info, update, state: st, uniforms: U, man, setOff: (v) => { U.uM3Off.value = v ? 1 : 0; } };
  if (owned) {
    const current = hr.env === env ? ownedEnvironmentInputs(env) : null;
    if (current && current.textures.every((t, i) => t === owned.textures[i] && current.data[i] === owned.data[i])) patchOwnedEnvironment(owned);
    else hr.setEnvironment(patchedEnvironment(env)); // Revoked/changed ownership never mutates the supplied input.
    info.ms = Math.round(performance.now() - t0);
  }
  result.frontFusion = installMainFrontFusion(hr, { expectedFinalShader: finalShader(hr.lut, man) });
  result.frontFusion?.setEnabled(q.get('frontfusion') !== '0');
  return result;
}
