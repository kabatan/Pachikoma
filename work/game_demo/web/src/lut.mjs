// 表示変換: PBR Neutral を 3D LUT で最後に 1 回。LUT は Blender(OCIO,CPU) でサンプリングしたもの（tools/make_lut.py）。
// three.js 標準のトーンマップ・出力色空間変換は使わない（ShaderMaterial が直接 canvas に符号化済みの値を書く）。
import * as THREE from '../vendor/three/three.module.js';

export const SHAPER_K = 512.0, SHAPER_MAX = 1024.0;
export const SHAPER_L = Math.log2(1 + SHAPER_K * SHAPER_MAX);

export async function loadLut(url) {
  const man = await (await fetch(url + '.json')).json();
  const buf = await (await fetch(url + '.f16')).arrayBuffer();
  const N = man.size;
  if (buf.byteLength !== N * N * N * 8) throw new Error('LUT size mismatch');
  const data = new Uint16Array(buf);
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;   // texelFetch で自前の四面体補間
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { texture: tex, size: N, manifest: man };
}

export function lutGlsl(man) {
  const kind = man.shaper_kind || 'log512', enc = man.encoding || 'srgb';
  const shaper = kind === 'lg2'
    ? `float shaperU(float c) { return clamp((log2(max(c, 1e-30)) + 9.0) / 19.0, 0.0, 1.0); }`
    : `float shaperU(float c) { return clamp(log2(1.0 + SH_K * c) / SH_L, 0.0, 1.0); }`;
  const post = enc === 'linear'
    ? `vec3 lutPost(vec3 l) { l = clamp(l, 0.0, 1.0); return mix(12.92 * l, 1.055 * pow(l, vec3(1.0/2.4)) - 0.055, step(0.0031308, l)); }`
    : `vec3 lutPost(vec3 e) { return e; }`;
  return LUT_GLSL_BASE.replace('//SHAPER', shaper).replace('//POST', post);
}

const LUT_GLSL_BASE = /* glsl */`
uniform highp sampler3D uLut;
uniform float uLutN;
const float SH_K = ${SHAPER_K.toFixed(1)};
const float SH_L = ${SHAPER_L.toFixed(9)};
//SHAPER
//POST
vec3 lutFetch(ivec3 i) { return texelFetch(uLut, i, 0).rgb; }
// シェーパ → 四面体補間。入力は線形 Rec.709 のシーン値(0..1024)。出力は sRGB 符号化済み(0..1)。
vec3 lutPbrNeutral(vec3 c) {
  c = vec3(isnan(c.x) ? 0.0 : c.x, isnan(c.y) ? 0.0 : c.y, isnan(c.z) ? 0.0 : c.z);
  c = clamp(c, 0.0, 1024.0);
  vec3 u = vec3(shaperU(c.x), shaperU(c.y), shaperU(c.z)) * (uLutN - 1.0);
  vec3 i0f = min(floor(u), vec3(uLutN - 2.0));
  vec3 f = u - i0f;
  ivec3 i0 = ivec3(i0f);
  vec3 c000 = lutFetch(i0), c111 = lutFetch(i0 + ivec3(1));
  vec3 r;
  if (f.x >= f.y) {
    if (f.y >= f.z)      r = (1.0-f.x)*c000 + (f.x-f.y)*lutFetch(i0+ivec3(1,0,0)) + (f.y-f.z)*lutFetch(i0+ivec3(1,1,0)) + f.z*c111;
    else if (f.x >= f.z) r = (1.0-f.x)*c000 + (f.x-f.z)*lutFetch(i0+ivec3(1,0,0)) + (f.z-f.y)*lutFetch(i0+ivec3(1,0,1)) + f.y*c111;
    else                 r = (1.0-f.z)*c000 + (f.z-f.x)*lutFetch(i0+ivec3(0,0,1)) + (f.x-f.y)*lutFetch(i0+ivec3(1,0,1)) + f.y*c111;
  } else {
    if (f.x >= f.z)      r = (1.0-f.y)*c000 + (f.y-f.x)*lutFetch(i0+ivec3(0,1,0)) + (f.x-f.z)*lutFetch(i0+ivec3(1,1,0)) + f.z*c111;
    else if (f.y >= f.z) r = (1.0-f.y)*c000 + (f.y-f.z)*lutFetch(i0+ivec3(0,1,0)) + (f.z-f.x)*lutFetch(i0+ivec3(0,1,1)) + f.x*c111;
    else                 r = (1.0-f.z)*c000 + (f.z-f.y)*lutFetch(i0+ivec3(0,0,1)) + (f.y-f.x)*lutFetch(i0+ivec3(0,1,1)) + f.x*c111;
  }
  return lutPost(r);
}
`;

const FS_VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** 入力テクスチャ(float, N×1 など)を LUT に通して float RT に書く検証用。 */
export function makeLutTestMaterial(lut, inputTex) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */`
      uniform highp sampler2D uIn;
      ${lutGlsl(lut.manifest)}
      void main() { vec3 c = texelFetch(uIn, ivec2(gl_FragCoord.xy), 0).rgb; gl_FragColor = vec4(lutPbrNeutral(c), 1.0); }`,
    uniforms: { uLut: { value: lut.texture }, uLutN: { value: lut.size }, uIn: { value: inputTex } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
}
