// HybridRenderer: 方式C の描画骨組み（hybrid_spec §1,§5〜§7,§10〜§12）
//   奥の光層(加算) → 玉(InstancedMesh, 線形HDR, プローブ反射) → τ を掛けて手前の光層(加算) → PBR Neutral LUT(最後に1回) → canvas
// 公開 API: init / setLightingFrame / setBalls / setLayers / useDummyProbeBases / setEnvironment / render / dispose
import * as THREE from '../vendor/three/three.module.js';
import { WINDOW, makeWindowCamera } from './window_camera.mjs';
import { loadLut, lutGlsl } from './lut.mjs';
import { Gen } from './dummy.mjs';
import { ProbeSet, PROBES, N_PROBES, PROBE_FACE_GLSL, PROBE_T } from './probes.mjs';

const W = WINDOW.W_PX, H = WINDOW.H_PX;
export const RECEIVERS = ['p1', 'p2', 'p4', 'l1', 'r1', 'l2', 'r2', 'ext'];   // ea/eb の添字（hybrid_spec §3）

const FS_VERT = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };
const ADD_FRONT = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };   // F × (1 - 玉が手前の割合) を加算
const NOBLEND = { blending: THREE.NoBlending };
const NODEPTH = { depthTest: false, depthWrite: false };

function triGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

// 環境 A/B をマスクで重み付けして出す全画面パス。B_s(x) = Σ_r M_r(x) [ea_r A(x) + eb_r B(x)]
function envMaterial(blend) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */`
      uniform highp sampler2D uA, uB, uM0, uM1;
      uniform vec4 uEaLo, uEaHi, uEbLo, uEbHi;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        ivec2 q = ivec2(p.x, ${H - 1} - p.y);               // 素材は行0=画像の上
        vec4 m0 = texelFetch(uM0, q, 0), m1 = texelFetch(uM1, q, 0);
        float wa = dot(m0, uEaLo) + dot(m1, uEaHi);
        float wb = dot(m0, uEbLo) + dot(m1, uEbHi);
        vec4 a = texelFetch(uA, q, 0), b = texelFetch(uB, q, 0);
        gl_FragColor = vec4(wa * a.rgb + wb * b.rgb, 0.0);
      }`,
    uniforms: { uA: { value: null }, uB: { value: null }, uM0: { value: null }, uM1: { value: null },
      uEaLo: { value: new THREE.Vector4() }, uEaHi: { value: new THREE.Vector4() }, uEbLo: { value: new THREE.Vector4() }, uEbHi: { value: new THREE.Vector4() } },
    ...NODEPTH, ...blend,
  });
}

// 外接矩形つき光層。1 draw = 1 バンク（同サイズのテクスチャ配列）× 全インスタンス。
function layerMaterial(tex, bank, sumTarget, blend = ADD) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec4 aRect;   // bbox x,y,w,h（出力ピクセル, y は上から）
      attribute vec4 aTex;    // 層番号, 解像度 w, h, 未使用
      attribute vec4 aTile;   // 蓄積配列の層番号（aTex.x < 0 のとき）
      attribute vec4 aW;      // rgb = q[source_id].rgb * rgb_scale
      varying vec2 vT; flat varying vec4 vTex; flat varying vec3 vW; flat varying vec2 vTile;
      void main() {
        vec2 c = position.xy;
        vec2 px = aRect.xy + c * aRect.zw;
        gl_Position = vec4(px.x / ${W}.0 * 2.0 - 1.0, 1.0 - px.y / ${H}.0 * 2.0, 0.0, 1.0);
        vT = c; vTex = aTex; vW = aW.rgb; vTile = aTile.xy;
      }`,
    fragmentShader: /* glsl */`
      uniform highp sampler2DArray uTex; uniform vec2 uBank;
      uniform highp sampler2DArray uSum; uniform vec2 uSumSize;
      varying vec2 vT; flat varying vec4 vTex; flat varying vec3 vW; flat varying vec2 vTile;
      void main() {
        vec2 res = vTex.yz;
        vec2 p = clamp(vT * res, vec2(0.5), res - 0.5);   // 解像度が bbox と違えばバイリニアで拡大
        vec4 t = vTex.x < 0.0 ? texture(uSum, vec3(p / uSumSize, vTile.x)) : texture(uTex, vec3(p / uBank, vTex.x));
        gl_FragColor = vec4(t.rgb * vW, 0.0);                      // premultiplied。加算（alpha は「玉が静的前景より手前」のフラグ用に空ける）
      }`,
    uniforms: { uTex: { value: tex }, uBank: { value: bank }, uSum: { value: sumTarget.texture }, uSumSize: { value: new THREE.Vector2(sumTarget.width, sumTarget.height) } },
    side: THREE.DoubleSide, ...NODEPTH, ...blend,
  });
}

// 基準と同じ POT 正方形・原点・sampler2DArray で補間する。整数テクセルを拡大前に加算。
function sumMaterial(tex, width, height) {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec4 aRect, aTex, aW;
      uniform float uLayer;
      flat varying vec4 vRect, vTex; flat varying vec3 vW;
      void main() {
        vec2 p = aRect.xy + position.xy * aRect.zw;
        gl_Position = aTex.w == uLayer ? vec4(p / vec2(${width}.0, ${height}.0) * 2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);
        vRect = aRect; vTex = aTex; vW = aW.rgb;
      }`,
    fragmentShader: `
      uniform highp sampler2DArray uTex;
      flat varying vec4 vRect, vTex; flat varying vec3 vW;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy) - ivec2(vRect.xy);
        gl_FragColor = vec4(texelFetch(uTex, ivec3(p, int(vTex.x)), 0).rgb * vW, 0.0);
      }`,
    uniforms: { uTex: { value: tex }, uLayer: { value: 0 } }, side: THREE.DoubleSide, ...NODEPTH, ...ADD,
  });
}

function layerGeometry(n, tile = false) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0,1,1,0]),3));
  geo.setIndex([0,1,2,2,1,3]);
  for (const name of tile ? ['aRect','aTex','aW','aTile'] : ['aRect','aTex','aW']) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n*4),4);
    a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name,a);
  }
  return geo;
}

// GPU に送るのは実際に変わった、使用中の属性範囲だけ。
function putAttribute(a, i, x = 0, y = 0, z = 0, w = 0) {
  const o = i * 4;
  putComponent(a, o, x); putComponent(a, o + 1, y);
  putComponent(a, o + 2, z); putComponent(a, o + 3, w);
}
function putComponent(a, o, value) {
  const v = Math.fround(value);
  if (a.array[o] !== v) {
    a.array[o] = v;
    a._lo = Math.min(a._lo ?? Infinity, o);
    a._hi = Math.max(a._hi ?? 0, o + 1);
  }
}

function uploadGeometry(geo, n) {
  let changed = false;
  for (const a of Object.values(geo.attributes)) {
    if (a._lo !== undefined) {
      a.addUpdateRange(a._lo, a._hi-a._lo); a.needsUpdate = true;
      delete a._lo; delete a._hi; changed = true;
    }
  }
  changed ||= geo.instanceCount !== n; geo.instanceCount = n;
  return changed;
}

export class HybridRenderer {
  constructor({ canvas = null, msaa = 4, lutUrl = './assets/lut/pbrneutral_lg2_57_lin', maxBalls = 512, preserveDrawingBuffer = false, dither = 0 } = {}) {
    this.opts = { canvas, msaa, lutUrl, maxBalls, preserveDrawingBuffer, dither };
    this.frame = { tick: 0, ea: new Array(8).fill(0), eb: new Array(8).fill(0), q: {} };
    this.stats = { activeLayers: 0, activeBalls: 0 };
    this.lutEnabled = true; this.viewMode = 0;
  }

  async init() {
    const o = this.opts;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas || undefined, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: o.preserveDrawingBuffer });
    r.setPixelRatio(1); r.setSize(W, H, false);                 // backing 1440×2560 固定、DPR=1
    r.toneMapping = THREE.NoToneMapping; r.autoClear = false; r.info.autoReset = true;
    this.gl = r.getContext();
    this._restoreLayerSums = () => {
      for (const side of ['back','front']) for (const b of this.layerBuckets?.[side] || []) for (const m of b.mappings) m.dirty = true;
      this._sumDirty = true;
    };
    r.domElement.addEventListener('webglcontextrestored', this._restoreLayerSums);
    this.camera = makeWindowCamera();
    this.fsCam = new THREE.Camera();
    this.gen = new Gen(r);

    const rtOpt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rtMain = new THREE.WebGLRenderTarget(W, H, { ...rtOpt, samples: o.msaa, depthBuffer: true });
    this.rtC = new THREE.WebGLRenderTarget(W, H, { ...rtOpt, depthBuffer: false });

    this.lut = await loadLut(o.lutUrl);
    this._buildScenes();
    this.setEnvironment(this.gen.makeEnvironment());
    this.probes = new ProbeSet(r);
    this.ballMat.uniforms.uAtlas.value = this.probes.atlas.texture;
    this.useDummyProbeBases([]);
    return this;
  }

  _buildScenes() {
    const tri = triGeometry();
    const mk = (mat, order) => { const m = new THREE.Mesh(tri, mat); m.frustumCulled = false; m.renderOrder = order; return m; };
    // 奥: 環境 → 光層（加算）
    this.sBack = new THREE.Scene();
    this.envBack = envMaterial(NOBLEND); this.sBack.add(mk(this.envBack, 0));
    // 玉
    this.sBalls = new THREE.Scene();
    this._buildBalls();
    // 手前: τ·D（上書き）→ 環境F → 光層F（加算）
    this.sFront = new THREE.Scene();
    this.composeMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform highp sampler2D uD, uTau;
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          vec4 d = texelFetch(uD, p, 0);                // a = 玉が静的な前景より手前にいる割合（MSAA 解決後）
          vec3 tau = texelFetch(uTau, ivec2(p.x, ${H - 1} - p.y), 0).rgb;
          gl_FragColor = vec4(mix(tau, vec3(1.0), d.a) * d.rgb, 1.0 - d.a);   // C = (1-a)·F + mix(τ,1,a)·D 。F は後から × alpha(=1-a) で加算
        }`,
      uniforms: { uD: { value: this.rtMain.texture }, uTau: { value: null } }, ...NODEPTH, ...NOBLEND,
    });
    this.sFront.add(mk(this.composeMat, 0));
    this.envFront = envMaterial(ADD_FRONT); this.sFront.add(mk(this.envFront, 1));
    // 最終: LUT → canvas
    this.sFinal = new THREE.Scene();
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform highp sampler2D uC, uD; uniform int uView; uniform int uUseLut; uniform float uDither;
        ${lutGlsl(this.lut.manifest)}
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          vec3 c = uView == 1 ? texelFetch(uD, p, 0).rgb : texelFetch(uC, p, 0).rgb;
          vec3 o = uUseLut == 1 ? lutPbrNeutral(c) : clamp(c, 0.0, 1.0);
          o += uDither * (h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy + 17.0) - 1.0);    // 三角ディザ（既定 0）
          gl_FragColor = vec4(o, 1.0);
        }`,
      uniforms: { uC: { value: this.rtC.texture }, uD: { value: this.rtMain.texture }, uView: { value: 0 }, uUseLut: { value: 1 },
        uDither: { value: this.opts.dither / 255 }, uLut: { value: this.lut.texture }, uLutN: { value: this.lut.size } },
      ...NODEPTH, ...NOBLEND,
    });
    this.sFinal.add(mk(this.finalMat, 0));
    this.layerBuckets = { back: [], front: [] };
    this._tri = tri; this._mk = mk;
  }

  _buildBalls() {
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const mat = this.ballMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        uniform vec3 uPPos[${N_PROBES}]; uniform float uPZone[${N_PROBES}];
        varying vec3 vN; varying vec3 vWorld; varying float vViewDepth;
        flat varying vec3 vPI; flat varying vec3 vPW;
        void main() {
          mat4 im = instanceMatrix;
          vec4 wp = modelMatrix * im * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(im) * position);     // 一様スケール前提で球の法線 = 位置
          vWorld = wp.xyz;
          vec4 vp = viewMatrix * wp;
          vViewDepth = -vp.z;
          gl_Position = projectionMatrix * vp;
          // プローブ選択: 玉の中心に最も近いプローブの区域だけを使い、その区域内の近い 3 点を逆二乗距離で補間（区域をまたいで混ぜない）
          vec3 c = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float best = 1e9; int bi = 0;
          for (int i = 0; i < ${N_PROBES}; i++) { vec3 d = c - uPPos[i]; float dd = dot(d, d); if (dd < best) { best = dd; bi = i; } }
          float zone = uPZone[bi];
          vec3 idx = vec3(-1.0), wt = vec3(0.0);
          for (int s = 0; s < 3; s++) {
            float bd = 1e9; int bj = -1;
            for (int i = 0; i < ${N_PROBES}; i++) {
              if (uPZone[i] != zone) continue;
              if (s > 0 && float(i) == idx.x) continue;
              if (s > 1 && float(i) == idx.y) continue;
              vec3 d = c - uPPos[i]; float dd = dot(d, d);
              if (dd < bd) { bd = dd; bj = i; }
            }
            if (bj >= 0) { idx[s] = float(bj); wt[s] = 1.0 / (bd + 1e-5); }
          }
          vPI = idx; vPW = wt / max(wt.x + wt.y + wt.z, 1e-12);
        }`,
      fragmentShader: /* glsl */`
        uniform highp sampler2D uAtlas; uniform vec3 uPPos[${N_PROBES}];
        uniform vec3 uBoxMin, uBoxMax, uF0; uniform float uFill, uBounce;
        uniform highp sampler2D uOcc; uniform int uOccOn;
        varying vec3 vN; varying vec3 vWorld; varying float vViewDepth;
        flat varying vec3 vPI; flat varying vec3 vPW;
        ${PROBE_FACE_GLSL}
        vec3 probeRadiance(int i, vec3 R) {
          vec3 t1 = (uBoxMin - vWorld) / R, t2 = (uBoxMax - vWorld) / R;      // 固定箱へのレイ交差（視差補正）
          vec3 tf = max(t1, t2); float t = min(min(tf.x, tf.y), tf.z);
          vec3 d = vWorld + R * t - uPPos[i];
          return texture(uAtlas, dirToAtlasPx(i, d) / vec2(6.0 * PT, ${N_PROBES}.0 * PT)).rgb;
        }
        // 玉の見た目の下限：暗い盤でも銀玉は白い映り込みとハイライトで銀に見える。観測できない周囲（観客側の室内・液晶の光・天井）の弱い一定の環境。
        // 座標は筐体の右手系（X右 Y上 Z手前）。観測した色（probe）にそのまま足す＝色のかぶりは probe が持つ。uFill=0 で無効。
        vec3 studioEnv(vec3 R) {
          vec3 col = mix(vec3(0.012, 0.016, 0.040), vec3(0.20, 0.22, 0.30), smoothstep(-0.40, 0.95, R.y));   // 暗い床 → 明るい天井
          col += vec3(1.5, 1.5, 1.6) * smoothstep(0.80, 0.93, dot(R, normalize(vec3(-0.30, 0.75, 0.60))));    // 左上手前の大きな面光源（液晶・照明）
          col += vec3(0.7, 0.7, 0.75) * smoothstep(0.90, 0.965, dot(R, normalize(vec3(0.75, 0.25, 0.55))));   // 右の細い面光源
          col += vec3(0.18) * exp(-pow((R.y + 0.05) / 0.12, 2.0)) * (R.z > 0.0 ? 1.0 : 0.3);                 // 水平の帯
          col += vec3(0.30, 0.31, 0.34) * smoothstep(0.35, 1.0, R.z);                                       // 観客側の室内（玉の中心に映る面）
          return col;
        }
        void main() {
          vec3 N = normalize(vN), V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, N);
          vec3 env = vec3(0.0);
          for (int k = 0; k < 3; k++) { if (vPW[k] > 0.0) env += vPW[k] * probeRadiance(int(vPI[k] + 0.5), R); }
          env += uFill * studioEnv(R) + uBounce * vec3(0.9, 0.92, 1.0) * smoothstep(0.0, -0.85, R.y);   // 下半球の照り返し(床の反射)。既定0=従来どおり
          float cs = clamp(dot(N, V), 0.0, 1.0);
          vec3 F = uF0 + (1.0 - uF0) * pow(1.0 - cs, 5.0);
          // 静的な前景（釘頭など）の奥行きより手前なら alpha=1: 合成で前景 F と τ をこの画素では使わない（玉が上に出る）。奥なら通常どおり τ で隠れる
          float front = 0.0;
          if (uOccOn == 1) {
            float occ = texelFetch(uOcc, ivec2(int(gl_FragCoord.x), ${H - 1} - int(gl_FragCoord.y)), 0).r;
            front = (occ < 99.0 && vViewDepth <= occ + 0.00005) ? 1.0 : 0.0;
          }
          gl_FragColor = vec4(F * env, front);                         // 線形HDR のまま書く
        }`,
      uniforms: { uAtlas: { value: null }, uPPos: { value: PROBES.map(q => new THREE.Vector3(...q.pos)) }, uPZone: { value: PROBES.map(q => q.zone) },
        uBoxMin: { value: new THREE.Vector3(-0.17, -0.30, -0.12) }, uBoxMax: { value: new THREE.Vector3(0.17, 0.30, 0.05) },
        uF0: { value: new THREE.Vector3(0.95, 0.93, 0.88) }, uFill: { value: 1.0 }, uBounce: { value: 0.0 }, uOcc: { value: null }, uOccOn: { value: 1 } },
      ...NOBLEND, depthTest: true, depthWrite: true,
    });
    this.balls = new THREE.InstancedMesh(geo, mat, this.opts.maxBalls);
    this.balls.frustumCulled = false; this.balls.count = 0;
    this.balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sBalls.add(this.balls);
  }

  /** 玉の環境の下限（studioEnv）の強さ。0=無効、既定1。 */
  setBallFill(v) { this.ballMat.uniforms.uFill.value = v; }
  /** 玉の下半球の照り返しの強さ。0=無効(既定)。 */
  setBallBounce(v) { this.ballMat.uniforms.uBounce.value = v; }

  /** プローブ基底（既定はダミー）。sourceIds の各 source_id に基底を 1 つ割り当て、環境 16 基底と合わせて線形合成する。 */
  useDummyProbeBases(sourceIds) { this.probes.makeDummyBases(sourceIds); }

  /** env = { back:{A,B,M0,M1}, front:{A,B,M0,M1}, tau, occ }（各 RT か Texture。素材は行0=画像の上） */
  setEnvironment(env) {
    const t = (x) => (x && x.texture) ? x.texture : x;
    this.env = env;
    for (const [m, e] of [[this.envBack, env.back], [this.envFront, env.front]]) {
      m.uniforms.uA.value = t(e.A); m.uniforms.uB.value = t(e.B); m.uniforms.uM0.value = t(e.M0); m.uniforms.uM1.value = t(e.M1);
    }
    this.composeMat.uniforms.uTau.value = t(env.tau);
    this.ballMat.uniforms.uOcc.value = t(env.occ);
  }

  /** entries: [{source_id, side:'back'|'front', bbox:[x,y,w,h], resolution:[w,h], rgb_scale:[r,g,b]|number, pixels?: Uint16Array(half)|Float32Array (RGBA, 行0=上, premultiplied), dummy_seed?}] */
  setLayers(entries) {
    for (const side of ['back', 'front']) {
      for (const b of this.layerBuckets[side]) { (side === 'back' ? this.sBack : this.sFront).remove(b.mesh); b.mesh.geometry.dispose(); b.mat.dispose(); b.rt.dispose(); b.sumGeo?.dispose(); b.sumMat?.dispose(); b.sumRT?.dispose(); }
      this.layerBuckets[side] = [];
    }
    this.layerSums = [];
    const groups = new Map();
    for (const e of entries) {
      const bank = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(e.resolution[0], e.resolution[1]))));
      const k = e.side + ':' + bank;
      if (!groups.has(k)) groups.set(k, { side: e.side, bank, list: [] });
      groups.get(k).list.push(e);
    }
    for (const g of groups.values()) {
      g.width = this._layerDiagnostics?.potBanks ? g.bank : Math.max(...g.list.map(e => e.resolution[0]));
      g.height = this._layerDiagnostics?.potBanks ? g.bank : Math.max(...g.list.map(e => e.resolution[1]));
    }
    // 同一マッピングだけを統合。補間を変えないため、蓄積は元の POT 配列の原点に置く。
    for (const g of groups.values()) {
      const map = new Map();
      g.list.forEach((e,i) => {
        const key = [...e.bbox,...e.resolution].join(',');
        if (!map.has(key)) { const m = { entry:e, indices:[], sumLayer:-1, sumActive:false, dirty:true }; map.set(key,m); }
        map.get(key).indices.push(i);
      });
      g.mappings = [...map.values()];
      g.records = g.list.map(e => {
        const sc = e.rgb_scale;
        return { id: e.source_id, s0: sc.length ? sc[0] : sc, s1: sc.length ? sc[1] : sc,
          s2: sc.length ? sc[2] : sc, w0: 0, w1: 0, w2: 0, active: false };
      });
      let layer = 0;
      for (const m of g.mappings) if (m.indices.length > 1) m.sumLayer = layer++;
      g.sumLayers = layer;
    }
    this._sumDirty=true;
    let order = 2;
    for (const g of groups.values()) {
      const n = g.list.length;
      const rt = new THREE.WebGLArrayRenderTarget(g.width, g.height, n, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      g.list.forEach((e, i) => {
        const [rw, rh] = e.resolution;
        if (e.pixels) {
          const half = e.pixels instanceof Uint16Array;
          const dt = new THREE.DataTexture(e.pixels, rw, rh, THREE.RGBAFormat, half ? THREE.HalfFloatType : THREE.FloatType);
          dt.minFilter = dt.magFilter = THREE.NearestFilter; dt.needsUpdate = true;
          this.gen.draw(10, rt, { layer: i, src: dt, size: [rw, rh] }); dt.dispose();
        } else {
          this.gen.draw(9, rt, { layer: i, p: [e.dummy_seed ?? i, i, rw, rh], size: [rw, rh] });
        }
      });
      const geo = layerGeometry(n,true);
      const { aRect,aTex,aW } = geo.attributes;
      const sumBank = g.sumLayers ? g.bank : 1;
      const sumRT = new THREE.WebGLArrayRenderTarget(sumBank, sumBank, Math.max(1, g.sumLayers), {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter, depthBuffer: false });
      this.layerSums.push(sumRT);
      const mat = layerMaterial(rt.texture, new THREE.Vector2(g.width, g.height), sumRT, g.side === 'front' ? ADD_FRONT : ADD);
      const sumGeo = layerGeometry(n), sumMat = sumMaterial(rt.texture, sumBank, sumBank);
      const sumMesh = new THREE.Mesh(sumGeo,sumMat); sumMesh.frustumCulled=false; sumMesh.renderOrder=order;
      const sumScene = new THREE.Scene(); sumScene.add(sumMesh);
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order++;
      (g.side === 'back' ? this.sBack : this.sFront).add(mesh);
      this.layerBuckets[g.side].push({ mesh, mat, rt, geo, aRect, aTex, aW, list: g.list, n, mappings:g.mappings, records:g.records, sumGeo, sumMat, sumMesh, sumRT, sumScene });
    }
    this.layerCount = { back: this.layerBuckets.back.reduce((s, b) => s + b.n, 0), front: this.layerBuckets.front.reduce((s, b) => s + b.n, 0) };
  }

  /** frame = {tick, ea[8], eb[8], q: {source_id: {rgb:[r,g,b]} | [r,g,b]}} */
  setLightingFrame(frame) { this.frame = frame; }

  /** positions: Float32Array xyz(m)。count 個。radius(m) 既定 6mm。 */
  setBalls({ count, positions, radius = 0.006 }) {
    const n = Math.min(count, this.opts.maxBalls), a = this.balls.instanceMatrix.array;
    let lo = Infinity, hi = 0;
    const put = (o, value) => { const v = Math.fround(value); if (a[o] !== v) { a[o] = v; lo = Math.min(lo, o); hi = Math.max(hi, o + 1); } };
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      put(o, radius); put(o + 1, 0); put(o + 2, 0); put(o + 3, 0);
      put(o + 4, 0); put(o + 5, radius); put(o + 6, 0); put(o + 7, 0);
      put(o + 8, 0); put(o + 9, 0); put(o + 10, radius); put(o + 11, 0);
      put(o + 12, positions[3 * i]); put(o + 13, positions[3 * i + 1]); put(o + 14, positions[3 * i + 2]); put(o + 15, 1);
    }
    if (hi > lo) { this.balls.instanceMatrix.addUpdateRange(lo, hi - lo); this.balls.instanceMatrix.needsUpdate = true; }
    this.balls.count = n; this.stats.activeBalls = n;
  }

  _updateEnvUniforms() {
    const f = this.frame, ea = f.ea || [], eb = f.eb || [];
    for (const m of [this.envBack, this.envFront]) {
      const u = m.uniforms;
      u.uEaLo.value.set(ea[0] || 0, ea[1] || 0, ea[2] || 0, ea[3] || 0); u.uEaHi.value.set(ea[4] || 0, ea[5] || 0, ea[6] || 0, ea[7] || 0);
      u.uEbLo.value.set(eb[0] || 0, eb[1] || 0, eb[2] || 0, eb[3] || 0); u.uEbHi.value.set(eb[4] || 0, eb[5] || 0, eb[6] || 0, eb[7] || 0);
    }
  }

  _updateLayers() {
    const q = this.frame.q || {};
    let active = 0;
    for (const side of ['back', 'front']) {
      for (const b of this.layerBuckets[side]) {
        let k = 0, sk = 0;
        const packKey=(this._layerDiagnostics?.direct?1:0)|(this._layerDiagnostics?.groupOrder?2:0);
        let repack=b._packedKey!==packKey;
        const out = b.geo.attributes, sum = b.sumGeo.attributes;
        for (const rec of b.records) {
          const v = q[rec.id], rgb = v && (v.rgb || v);
          const w0 = rgb ? rgb[0] * rec.s0 : 0, w1 = rgb ? rgb[1] * rec.s1 : 0, w2 = rgb ? rgb[2] * rec.s2 : 0;
          const on = !!v && !(w0 + w1 + w2 < 1e-6);
          rec.changed = rec.active !== on || Math.fround(rec.w0) !== Math.fround(w0) || Math.fround(rec.w1) !== Math.fround(w1) || Math.fround(rec.w2) !== Math.fround(w2);
          repack ||= rec.changed;
          rec.w0 = w0; rec.w1 = w1; rec.w2 = w2; rec.active = on;
          if (rec.active) active++;
        }
        if(!repack) continue;
        b._packedKey=packKey;
        if (this._layerDiagnostics?.direct) {
          const indices = this._layerDiagnostics.groupOrder ? b.mappings.flatMap(m => m.indices) : b.records.keys();
          for (const i of indices) {
            const rec = b.records[i]; if (!rec.active) continue;
            const e = b.list[i];
            putAttribute(out.aRect, k, ...e.bbox);
            putAttribute(out.aTex, k, i, ...e.resolution);
            putAttribute(out.aW, k, rec.w0, rec.w1, rec.w2);
            putAttribute(out.aTile, k); k++;
          }
          for (const m of b.mappings) m.sumActive = false;
          uploadGeometry(b.geo, k); b.mesh.visible = k > 0;
          if (uploadGeometry(b.sumGeo, 0)) this._sumDirty = true;
          b.sumMesh.visible = false;
          continue;
        }
        for (const m of b.mappings) {
          m.sumActive = false;
          let count = 0, first = -1;
          for (const i of m.indices) {
            if (b.records[i].changed) m.dirty = true;
            if (b.records[i].active) { count++; if (first < 0) first = i; }
          }
          if (!count) continue;
          const e = m.entry, [rw, rh] = e.resolution;
          putAttribute(out.aRect, k, ...e.bbox);
          if (count === 1) {
            const rec = b.records[first];
            putAttribute(out.aTex, k, first, rw, rh);
            putAttribute(out.aW, k, rec.w0, rec.w1, rec.w2);
            putAttribute(out.aTile, k);
          } else {
            m.sumActive = true;
            for (const i of m.indices) {
              const rec = b.records[i]; if (!rec.active) continue;
              putAttribute(sum.aRect, sk, 0, 0, rw, rh);
              putAttribute(sum.aTex, sk, i, 0, 0, m.sumLayer);
              putAttribute(sum.aW, sk, rec.w0, rec.w1, rec.w2);
              sk++;
            }
            putAttribute(out.aTex, k, -1, rw, rh);
            putAttribute(out.aW, k, 1, 1, 1);
            putAttribute(out.aTile, k, m.sumLayer);
          }
          k++;
        }
        uploadGeometry(b.geo, k); b.mesh.visible = k > 0;
        if (uploadGeometry(b.sumGeo, sk)) this._sumDirty = true;
        b.sumMesh.visible = sk > 0;
      }
    }
    this.stats.activeLayers = active;
  }

  /** 1 フレーム描く。canvas（符号化済み sRGB）へ。 */
  render() {
    const r = this.renderer;
    this._updateEnvUniforms(); this._updateLayers();
    if(this._sumDirty) {
      for (const side of ['back', 'front']) for (const b of this.layerBuckets[side]) {
        for (const m of b.mappings) if (m.sumActive && (m.dirty || this._layerDiagnostics?.uncachedSums)) {
          b.sumMat.uniforms.uLayer.value = m.sumLayer;
          r.setRenderTarget(b.sumRT, m.sumLayer); r.setViewport(0, 0, b.sumRT.width, b.sumRT.height);
          r.setClearColor(0x000000, 0); r.clear(true, false, false);
          r.render(b.sumScene, this.fsCam);
          m.dirty = false;
        }
      }
      this._sumDirty = false;
    }
    // 1) 奥 + 玉（MSAA、線形HDR）
    r.setRenderTarget(this.rtMain); r.setViewport(0, 0, W, H);
    r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(this.sBack, this.fsCam);
    if (this.balls.count > 0 || this.trayVisual) { this.probes.compose(this.frame); r.setRenderTarget(this.rtMain); r.setViewport(0, 0, W, H); r.render(this.sBalls, this.camera); }
    // 2) 手前: τ⊙D + F（線形HDR）
    r.setRenderTarget(this.rtC); r.setViewport(0, 0, W, H);
    r.render(this.sFront, this.fsCam);
    // 3) LUT（最後に 1 回）→ canvas
    r.setRenderTarget(null); r.setViewport(0, 0, W, H);
    this.finalMat.uniforms.uView.value = this.viewMode;
    this.finalMat.uniforms.uUseLut.value = this.lutEnabled ? 1 : 0;
    r.render(this.sFinal, this.fsCam);
  }

  /** デバッグ/試験用: 線形HDRの中間結果を float で読む。which='C'(手前合成後, LUT前) | 'D'(奥+玉)。戻りは行0=画像の上の Float32Array RGBA (w*h*4)。 */
  readLinear(which = 'C', x = 0, y = 0, w = W, h = H) {
    const r = this.renderer;
    if (!this._rtF) {
      this._rtF = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this._cpMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: 'uniform highp sampler2D uS; void main(){ gl_FragColor = texelFetch(uS, ivec2(gl_FragCoord.xy), 0); }',
        uniforms: { uS: { value: null } }, ...NODEPTH, ...NOBLEND });
      this._cpScene = new THREE.Scene(); this._cpScene.add(this._mk(this._cpMat, 0));
    }
    this._cpMat.uniforms.uS.value = (which === 'D' ? this.rtMain : this.rtC).texture;
    r.setRenderTarget(this._rtF); r.setViewport(0, 0, W, H); r.render(this._cpScene, this.fsCam);
    const gy = H - y - h, buf = new Float32Array(w * h * 4);
    r.readRenderTargetPixels(this._rtF, x, gy, w, h, buf);
    r.setRenderTarget(null);
    const out = new Float32Array(w * h * 4);
    for (let j = 0; j < h; j++) out.set(buf.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4);
    return out;
  }

  dispose() {
    for (const side of ['back', 'front']) for (const b of this.layerBuckets[side]) {
      b.geo.dispose(); b.mat.dispose(); b.rt.dispose(); b.sumGeo.dispose(); b.sumMat.dispose(); b.sumRT.dispose();
    }
    this.renderer.domElement.removeEventListener('webglcontextrestored', this._restoreLayerSums);
    this.renderer.dispose();
  }
}
