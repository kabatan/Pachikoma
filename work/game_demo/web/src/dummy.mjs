// ダミー素材の GPU 生成。実素材（Blender の光層 PNG16+scale 等）が来るまでの代替で、
// 形式（RGBA16F・行0=画像の上・premultiplied）は本番と同じ。生成は 1 回だけ。
import * as THREE from '../vendor/three/three.module.js';
import { WINDOW } from './window_camera.mjs';

const W = WINDOW.W_PX, H = WINDOW.H_PX;

const NAIL_GLSL = /* glsl */`
// 釘頭のダミー: 球 r=2.8mm、中心 z=-50mm、格子(0.03,0.04)m。窓上の点 w(m) を通る目からの視線との交点。
const float NAIL_Z = -0.050, NAIL_R = 0.0028;
bool nailHit(vec2 w, out float s, out vec3 n) {
  vec3 E = vec3(0.0, -0.0598, 0.55);
  vec3 D = vec3(w.x, w.y + 0.0598, -0.55);               // 目 → 窓上の点（z 方向に -0.55）
  float s0 = 0.55 - NAIL_Z;
  vec2 pl = vec2(E.x + D.x * s0 / 0.55, E.y + D.y * s0 / 0.55);   // 釘の平面での視線位置
  vec2 pitch = vec2(0.03, 0.04);
  vec2 cxy = floor(pl / pitch + 0.5) * pitch;
  if (abs(cxy.x) > 0.125 || abs(cxy.y) > 0.25) return false;
  vec3 C = vec3(cxy, NAIL_Z);
  vec3 oc = E - C;
  float a = dot(D, D), b = dot(oc, D), c = dot(oc, oc) - NAIL_R * NAIL_R;
  float disc = b * b - a * c;
  if (disc < 0.0) return false;
  float t = (-b - sqrt(disc)) / a;               // t=1 で窓面
  vec3 P = E + D * t;
  s = 0.55 - P.z;                                // 目からの線形奥行き
  n = normalize(P - C);
  return true;
}
`;

const GEN_FRAG = /* glsl */`
precision highp float;
uniform int uMode;
uniform vec4 uP;           // mode 9: x=seed, y=layer index, z=res w, w=res h
uniform highp sampler2D uSrc;
${NAIL_GLSL}
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec2 ip = gl_FragCoord.xy - 0.5;                 // 整数ピクセル。ip.y は画像の行（上から）
  vec2 w = vec2((ip.x + 0.5) / ${W}.0 * 0.336 - 0.168, 0.299 - (ip.y + 0.5) / ${H}.0 * 0.598);
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
  if (uMode == 0 || uMode == 1) {            // 背景の環境 A / B（奥）
    float r = length(w * vec2(1.0, 0.7));
    vec3 base = uMode == 0 ? vec3(0.010, 0.016, 0.040) : vec3(0.030, 0.012, 0.010);
    float glow = exp(-r * r / 0.012) * (uMode == 0 ? 0.9 : 0.5);
    float lines = step(0.94, fract(w.x / 0.021)) + step(0.96, fract(w.y / 0.021));
    o.rgb = base + vec3(0.9, 0.7, 0.4) * glow * (uMode == 0 ? 1.0 : 0.6) + 0.08 * lines * vec3(0.4, 0.5, 0.9);
    o.rgb += 0.02 * hsv(w.y * 3.0 + float(uMode) * 0.4, 0.6, 1.0);
  } else if (uMode == 2 || uMode == 3) {     // 前面の F（反射・発光。透過像は含めない）
    float s; vec3 n; vec3 col = vec3(0.0);
    vec3 L = normalize(uMode == 2 ? vec3(-0.4, 0.7, 0.6) : vec3(0.5, -0.3, 0.8));
    if (nailHit(w, s, n)) {
      float d = max(dot(n, L), 0.0);
      col = vec3(0.75, 0.74, 0.78) * (0.15 + 0.85 * d) + pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0) * 3.0;
    }
    if (ip.x < 24.0 || ip.x > ${W - 25}.0) col = vec3(0.10, 0.09, 0.12) * (uMode == 2 ? 1.0 : 0.4);
    if (ip.y > 1100.0 && ip.y < 1500.0) col += vec3(0.8, 0.9, 1.0) * 0.04 * smoothstep(0.0, 1.0, sin(ip.x / 60.0 + ip.y / 90.0) * 0.5 + 0.5) * (uMode == 2 ? 1.0 : 0.5);
    o.rgb = col;
  } else if (uMode == 4 || uMode == 5) {     // 受光物マスク（RGBA8）。奥/手前は別の所有（x でゆらす）。uP.x=side
    int side = int(uP.x + 0.5); int lo = uMode == 4 ? 0 : 1;
    float yy = ip.y + (side == 1 ? 40.0 * sin(ip.x / 150.0) : 0.0);
    float t = clamp(yy / 320.0, 0.5, 7.5);
    for (int k = 0; k < 4; k++) { int kk = k + (lo == 1 ? 4 : 0); o[k] = max(0.0, 1.0 - abs(t - (float(kk) + 0.5))); }
  } else if (uMode == 6) {                   // τ（RGB 透過率）: 不透明な前面=0、薄い色ガラス、釘頭=0
    vec3 tau = vec3(1.0);
    float s; vec3 n;
    if (ip.y > 1100.0 && ip.y < 1500.0) tau = vec3(0.75, 0.88, 1.0);
    if (ip.x < 24.0 || ip.x > ${W - 25}.0) tau = vec3(0.0);
    if (nailHit(w, s, n)) tau = vec3(0.0);
    o = vec4(tau, 1.0);
  } else if (uMode == 7) {                   // 静的な前景の線形奥行き（釘頭の前面。なければ 100m）
    float s; vec3 n; float d = 100.0;
    if (nailHit(w, s, n)) d = s;
    o = vec4(d, 0.0, 0.0, 1.0);
  } else if (uMode == 9) {                   // 光層のダミー。層テクスチャの 0..res を [0,1]² として楕円のにじみ
    float seed = uP.x;
    vec2 uv = (ip + 0.5) / uP.zw;
    vec2 c = vec2(0.5) + 0.12 * vec2(hash(seed + 1.0) - 0.5, hash(seed + 2.0) - 0.5);
    float asp = 0.6 + 0.8 * hash(seed + 3.0);
    vec2 d = (uv - c) * vec2(asp, 1.0 / asp);
    float r2 = dot(d, d);
    float fall = exp(-r2 / (0.04 + 0.08 * hash(seed + 4.0)));
    float edge = smoothstep(0.5, 0.35, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));   // 外接矩形の縁で 0
    float ring = 0.35 * exp(-pow(sqrt(r2) - 0.25, 2.0) / 0.004);
    float peak = 2.0 + 14.0 * hash(seed + 5.0);
    vec3 col = hsv(hash(seed), 0.35 + 0.5 * hash(seed + 6.0), 1.0);
    float a = clamp((fall + ring) * edge, 0.0, 1.0);
    o = vec4(col * peak * (fall + ring) * edge, a);
  } else if (uMode == 10) {                  // 実データ層のコピー（DataTexture → 配列層）
    o = texelFetch(uSrc, ivec2(ip), 0);
  }
  gl_FragColor = o;
}
`;

export class Gen {
  constructor(renderer) {
    this.r = renderer;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: GEN_FRAG,
      uniforms: { uMode: { value: 0 }, uP: { value: new THREE.Vector4() }, uSrc: { value: null } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const m = new THREE.Mesh(g, this.mat); m.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(m);
    this.cam = new THREE.Camera();
  }
  /** target に mode で 1 回描く。layer: 配列 RT の層。size: ビューポート（既定は target 全体）。 */
  draw(mode, target, { layer = 0, p = [0, 0, 0, 0], src = null, size = null, clear = true } = {}) {
    const r = this.r, prev = r.getRenderTarget();
    this.mat.uniforms.uMode.value = mode; this.mat.uniforms.uP.value.set(...p); this.mat.uniforms.uSrc.value = src;
    r.setRenderTarget(target, layer);
    if (clear) { r.setClearColor(0x000000, 0); r.clear(true, false, false); }
    const w = size ? size[0] : target.width, h = size ? size[1] : target.height;
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
  makeRT(w, h, { type = THREE.HalfFloatType } = {}) {
    return new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }
  /** 環境ダミー一式（奥/手前の A,B、マスク 2 枚ずつ、τ、静的前景奥行き） */
  makeEnvironment() {
    const lin = (rt) => { rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter; return rt; };
    const env = { back: {}, front: {} };
    env.back.A = lin(this.makeRT(W, H)); this.draw(0, env.back.A);
    env.back.B = lin(this.makeRT(W, H)); this.draw(1, env.back.B);
    env.front.A = lin(this.makeRT(W, H)); this.draw(2, env.front.A);
    env.front.B = lin(this.makeRT(W, H)); this.draw(3, env.front.B);
    for (const [k, side] of [['back', 0], ['front', 1]]) {
      env[k].M0 = this.makeRT(W, H, { type: THREE.UnsignedByteType }); this.draw(4, env[k].M0, { p: [side, 0, 0, 0] });
      env[k].M1 = this.makeRT(W, H, { type: THREE.UnsignedByteType }); this.draw(5, env[k].M1, { p: [side, 0, 0, 0] });
    }
    env.tau = this.makeRT(W, H); this.draw(6, env.tau);
    env.occ = this.makeRT(W, H); this.draw(7, env.occ);
    return env;
  }
  /** 光層のダミー manifest（bbox は盤面にばらまく。texture は resTex² の RGBA16F）。 */
  static makeLayerManifest(nPerSide, { seed = 1, resTex = 256, bboxMin = 200, bboxMax = 600 } = {}) {
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const out = [];
    for (const side of ['back', 'front']) {
      for (let i = 0; i < nPerSide; i++) {
        const w = Math.round(bboxMin + rnd() * (bboxMax - bboxMin)), h = Math.round(bboxMin + rnd() * (bboxMax - bboxMin));
        const x = Math.round(rnd() * (W - w)), y = Math.round(rnd() * (H - h));
        out.push({ source_id: 'L' + i, side, bbox: [x, y, w, h], resolution: [resTex, resTex], rgb_scale: [1, 1, 1], dummy_seed: i * 7 + (side === 'front' ? 1000 : 0) + 1 });
      }
    }
    return out;
  }
  /** ダミープローブ（128² のキューブ、HDR、ミップ付き）。 */
  makeProbe(size = 128) {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        varying vec3 vD;
        vec3 rect(vec3 d, vec3 c, vec3 u, float hw, float hh, vec3 col) {
          float f = dot(d, c); if (f < 0.2) return vec3(0.0);
          vec3 p = d / f - c; float x = dot(p, u), y = dot(p, cross(c, u));
          return col * (smoothstep(hw, hw * 0.9, abs(x)) * smoothstep(hh, hh * 0.9, abs(y)));
        }
        void main() {
          vec3 d = normalize(vD);
          vec3 c = mix(vec3(0.02, 0.025, 0.05), vec3(0.08, 0.07, 0.10), d.y * 0.5 + 0.5);
          c += rect(d, normalize(vec3(0.6, 0.7, 0.7)), vec3(1.0, 0.0, 0.0), 0.35, 0.18, vec3(30.0, 22.0, 8.0));    // 金
          c += rect(d, normalize(vec3(-0.7, 0.3, 0.6)), vec3(0.0, 1.0, 0.0), 0.2, 0.4, vec3(20.0, 20.0, 22.0));     // 白
          c += rect(d, normalize(vec3(0.0, -0.8, 0.5)), vec3(1.0, 0.0, 0.0), 0.5, 0.1, vec3(8.0, 2.0, 12.0));       // 紫
          c += rect(d, normalize(vec3(0.0, 0.1, 1.0)), vec3(1.0, 0.0, 0.0), 0.8, 0.5, vec3(0.4, 0.45, 0.6));        // 手前の面光源
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50), mat));
    const cc = new THREE.CubeCamera(0.1, 100, rt); cc.position.set(0, 0, 0); scene.add(cc);
    const prev = this.r.getRenderTarget(); cc.update(this.r, scene); this.r.setRenderTarget(prev);
    return rt;
  }
}
