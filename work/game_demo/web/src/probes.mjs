// プローブ 13 点（hybrid_spec §3）と、基底の線形合成。
//   P_i(ω,t) = Σ_r [ea_r(t) E_i,r,A(ω) + eb_r(t) E_i,r,B(ω)] + Σ_j q_j(t) ⊙ P_i,j(ω)    ← 背景層と同じ LightingFrame の係数
// 保存形式: 基底ごとに 1 層の 2D 配列テクスチャ。1 層 = アトラス（横 6 面 × 縦 13 プローブ、各タイル (S+2)² で 1 テクセルの縁つき）。
// 合成は 1 draw: 出力アトラスの各テクセル = Σ_active w_k · basis_k(texel)。玉は最寄り区域の最大 3 プローブを逆二乗距離で補間して読む。
import * as THREE from '../vendor/three/three.module.js';

export const PROBE_S = 64;                 // 面解像度（縁を除く）
export const PROBE_T = PROBE_S + 2;        // タイル一辺（縁 1 テクセル）
export const N_PROBES = 13;
// 位置(m)・区域: hybrid_spec §3 の提案値。皿の Y・昇降管の Y はダミー（実形状から決める）。
export const PROBES = [
  { pos: [-0.12, -0.20, -0.03], zone: 0 }, { pos: [0.0, -0.20, -0.03], zone: 0 }, { pos: [0.12, -0.20, -0.03], zone: 0 },        // 皿 3
  { pos: [0.0, 0.0, -0.055], zone: 1 }, { pos: [-0.10, 0.07, -0.055], zone: 1 }, { pos: [0.10, 0.07, -0.055], zone: 1 }, { pos: [0.0, -0.15, -0.055], zone: 1 },   // 盤中央 + 釘付近 3
  { pos: [-0.18, -0.10, -0.115], zone: 2 }, { pos: [-0.18, 0.0, -0.115], zone: 2 }, { pos: [-0.18, 0.10, -0.115], zone: 2 },      // 昇降管 3
  { pos: [-0.135651, 0.12256, -0.055], zone: 3 }, { pos: [0.005898, 0.12256, -0.055], zone: 3 }, { pos: [0.147447, 0.12256, -0.055], zone: 3 },   // 射出器 3
];
export const N_ENV_BASES = 16;              // 受光物 8 × (A,B)

const FACE_GLSL = /* glsl */`
const float PS = ${PROBE_S}.0, PT = ${PROBE_T}.0;
// 面 f ∈ {+x,-x,+y,-y,+z,-z}, s ∈ [-1,1]² → 方向（縁のテクセルは |s| が 1 を少し超え、隣の面へ連続）
vec3 faceDir(int f, vec2 s) {
  if (f == 0) return vec3( 1.0, -s.y, -s.x);
  if (f == 1) return vec3(-1.0, -s.y,  s.x);
  if (f == 2) return vec3( s.x,  1.0,  s.y);
  if (f == 3) return vec3( s.x, -1.0, -s.y);
  if (f == 4) return vec3( s.x, -s.y,  1.0);
  return vec3(-s.x, -s.y, -1.0);
}
// 方向 → アトラス上の画素座標（プローブ i）
vec2 dirToAtlasPx(int i, vec3 d) {
  vec3 a = abs(d); int f; vec2 s; float m;
  if (a.x >= a.y && a.x >= a.z) { m = a.x; if (d.x > 0.0) { f = 0; s = vec2(-d.z, -d.y); } else { f = 1; s = vec2(d.z, -d.y); } }
  else if (a.y >= a.z)          { m = a.y; if (d.y > 0.0) { f = 2; s = vec2(d.x, d.z); }  else { f = 3; s = vec2(d.x, -d.z); } }
  else                          { m = a.z; if (d.z > 0.0) { f = 4; s = vec2(d.x, -d.y); } else { f = 5; s = vec2(-d.x, -d.y); } }
  s = s / m * 0.5 + 0.5;
  return vec2(float(f) * PT + 1.0 + s.x * PS, float(i) * PT + 1.0 + s.y * PS);
}
`;
export const PROBE_FACE_GLSL = FACE_GLSL;

const FS_VERT = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const triGeo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); return g; };

export class ProbeSet {
  constructor(renderer, { maxBases = 512, deferInitialBases = false } = {}) {
    this.r = renderer; this.maxBases = maxBases; this.deferInitialBases = deferInitialBases === true;
    this.W = 6 * PROBE_T; this.H = N_PROBES * PROBE_T;
    this.atlas = new THREE.WebGLRenderTarget(this.W, this.H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.atlas.texture.wrapS = this.atlas.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.wData = new Float32Array(maxBases * 4);
    this.wTex = new THREE.DataTexture(this.wData, maxBases, 1, THREE.RGBAFormat, THREE.FloatType);
    this.wTex.minFilter = this.wTex.magFilter = THREE.NearestFilter;
    this.bases = null; this.sourceIndex = new Map(); this.nActive = 0;
    const g = triGeo();
    this.composeMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform highp sampler2DArray uBases; uniform highp sampler2D uW; uniform int uN;
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          vec3 acc = vec3(0.0);
          for (int k = 0; k < uN; k++) {
            vec4 w = texelFetch(uW, ivec2(k, 0), 0);                 // rgb = 重み, a = 基底の層番号
            acc += w.rgb * texelFetch(uBases, ivec3(p, int(w.a + 0.5)), 0).rgb;
          }
          gl_FragColor = vec4(acc, 1.0);
        }`,
      uniforms: { uBases: { value: null }, uW: { value: this.wTex }, uN: { value: 0 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const m = new THREE.Mesh(g, this.composeMat); m.frustumCulled = false;
    this.sCompose = new THREE.Scene(); this.sCompose.add(m); this.cam = new THREE.Camera();
  }

  /** ダミー基底: 環境 16 個 + 光源ごと 1 個。光源は盤の手前に点在する発光面（プローブごとに視差が出る）。 */
  makeDummyBases(sourceIds) {
    const n = N_ENV_BASES + sourceIds.length;
    if (n > this.maxBases) throw new Error('too many bases');
    if (this.bases) this.bases.dispose();
    this.bases = new THREE.WebGLArrayRenderTarget(this.W, this.H, n, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.sourceIndex = new Map(sourceIds.map((id, i) => [id, N_ENV_BASES + i]));
    const mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        ${FACE_GLSL}
        uniform vec3 uPP[${N_PROBES}]; uniform float uK;  // uK: 基底番号
        float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          int f = p.x / ${PROBE_T}, i = p.y / ${PROBE_T};
          vec2 t = vec2(float(p.x - f * ${PROBE_T}) + 0.5 - 1.0, float(p.y - i * ${PROBE_T}) + 0.5 - 1.0);
          vec3 d = normalize(faceDir(f, t / PS * 2.0 - 1.0));
          vec3 pp = uPP[i];
          vec3 c = vec3(0.0);
          if (uK < ${N_ENV_BASES}.0) {                       // 環境基底: 受光物 r の方向にゆるい面光源（A は暖色、B は寒色）
            float r = floor(uK * 0.5); bool B = mod(uK, 2.0) > 0.5;
            vec3 n = normalize(vec3(sin(r * 0.9 + 0.3), cos(r * 1.7), 0.6));
            c = (B ? vec3(0.25, 0.30, 0.45) : vec3(0.45, 0.35, 0.22)) * (0.04 + 0.5 * pow(max(dot(d, n), 0.0), 3.0));
          } else {                                            // 光源基底: 盤の手前の点光源（白で焼いて、色は q で後から掛ける）
            float s = uK;
            vec3 L = vec3((hash(s + 1.0) - 0.5) * 0.30, (hash(s + 2.0) - 0.5) * 0.54, -0.02 - 0.04 * hash(s + 3.0));
            vec3 v = L - pp; float dist = length(v);
            float cs = dot(d, v / dist);
            float sig = 0.025 / dist;                         // 発光面の見かけの半径（rad）
            c = vec3(6.0) * exp(-(1.0 - cs) / (sig * sig * 0.5 + 1e-5)) + vec3(0.15) * exp(-(1.0 - cs) * 3.0) / (1.0 + 40.0 * dist * dist);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { uPP: { value: PROBES.map(q => new THREE.Vector3(...q.pos)) }, uK: { value: 0 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const m = new THREE.Mesh(triGeo(), mat); m.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(m);
    const prev = this.r.getRenderTarget();
    for (let k = 0; k < n; k++) { mat.uniforms.uK.value = k; this.r.setRenderTarget(this.bases, k); this.r.setViewport(0, 0, this.W, this.H); this.r.render(sc, this.cam); }
    this.r.setRenderTarget(prev); mat.dispose(); m.geometry.dispose();
    this.composeMat.uniforms.uBases.value = this.bases.texture;
    this.nBases = n;
  }

  /** frame = {ea[8], eb[8], q}。背景層と同じ q を使う。 */
  compose(frame) {
    if (!this.bases) {
      if (!this.deferInitialBases) return 0;
      this.makeDummyBases([]); // An early render/compose keeps the original16 fallback.
    }
    const w = this.wData; let k = 0;
    const ea = frame.ea || [], eb = frame.eb || [];
    for (let r = 0; r < 8; r++) {
      if (ea[r] > 1e-6) { w[4*k] = ea[r]; w[4*k+1] = ea[r]; w[4*k+2] = ea[r]; w[4*k+3] = 2 * r; k++; }
      if (eb[r] > 1e-6) { w[4*k] = eb[r]; w[4*k+1] = eb[r]; w[4*k+2] = eb[r]; w[4*k+3] = 2 * r + 1; k++; }
    }
    const q = frame.q || {};
    for (const [id, layer] of this.sourceIndex) {
      const v = q[id]; if (!v) continue; const c = v.rgb || v;
      if (c[0] + c[1] + c[2] < 1e-6) continue;
      w[4*k] = c[0]; w[4*k+1] = c[1]; w[4*k+2] = c[2]; w[4*k+3] = layer; k++;
    }
    this.wTex.needsUpdate = true; this.composeMat.uniforms.uN.value = k; this.nActive = k;
    const r = this.r, prev = r.getRenderTarget();
    r.setRenderTarget(this.atlas); r.setViewport(0, 0, this.W, this.H); r.render(this.sCompose, this.cam); r.setRenderTarget(prev);
    return k;
  }
}
