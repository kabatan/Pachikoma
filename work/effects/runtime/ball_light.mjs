// (effects 用の写し: assembly/pack_envcheck/ball_light.mjs に setClip=囲いの内側だけ照らす、を足したもの)
// 玉に追従する点光源（盤の近傍だけ明るくなる）。web/src は触らず、envの全画面パスのシェーダーを実行時に拡張する。
// 使い方: import { installBallLights } from '.../ball_light.mjs'; const BL = installBallLights(hr);
//   BL.set([{ x, y, rgb:[r,g,b], radius:px, gain:0..8 }, ...])   // x,y=1440×2560 画面座標(px, 左上原点)。毎フレーム呼んでよい。最大 BL.max 個。空配列で消灯
// 式: env_pass += Σ_i rgb_i·gain_i·exp(-|p-p_i|²/r_i²) · refl(x)  （refl = 環境 A+B の明るさの代理。釘・枠・花びら・盤の実際の面だけが光る）
//  light_floor: 反射率の下限（暗い紺の盤も少し光る）。frame/ea/eb の駆動は変えない。既定で無効(0個)＝描画は従来とRGB8同一。
import * as THREE from '../../game_demo/web/vendor/three/three.module.js';
const KNOWN_ENV = "\n      uniform highp sampler2D uA, uB, uM0, uM1;\n      uniform vec4 uEaLo, uEaHi, uEbLo, uEbHi;\n      void main() {\n        ivec2 p = ivec2(gl_FragCoord.xy);\n        ivec2 q = ivec2(p.x, 2559 - p.y);               // 素材は行0=画像の上\n        vec4 m0 = texelFetch(uM0, q, 0), m1 = texelFetch(uM1, q, 0);\n        float wa = dot(m0, uEaLo) + dot(m1, uEaHi);\n        float wb = dot(m0, uEbLo) + dot(m1, uEbHi);\n        vec4 a = texelFetch(uA, q, 0), b = texelFetch(uB, q, 0);\n        gl_FragColor = vec4(wa * a.rgb + wb * b.rgb, 0.0);\n      }";
const frontProofs = new WeakMap();
const backProofs = new WeakMap();
const normal = (v, lo, hi) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) return false;
  const q = Math.fround(v);
  return Number.isFinite(q) && !Object.is(q, -0) && q >= lo && q <= hi;
};
const four = (v, lo, hi) => v?.constructor === THREE.Vector4 && v.set === THREE.Vector4.prototype.set && normal(v.x, lo, hi) && normal(v.y, lo, hi) && normal(v.z, lo, hi) && normal(v.w, lo, hi);
function smoothEdges(rect, soft, active = false) {
  if (!four(rect, -65536, 65536) || !normal(soft, 1 / 64, 4096)) return false;
  const s = Math.fround(soft), x = Math.fround(rect.x), y = Math.fround(rect.y), z = Math.fround(rect.z), w = Math.fround(rect.w);
  return (!active || (z > x && w > y)) && Math.fround(x - s) < Math.fround(x + s) && Math.fround(y - s) < Math.fround(y + s) && Math.fround(z - s) < Math.fround(z + s) && Math.fround(w - s) < Math.fround(w + s);
}
function stopFront(p) {
  if (!p) return;
  p.disabled = true; p.safe.value = 0;
  // Mutable normal uniform replacement is detected at the next setter.
  const actual = p.m.uniforms?.uBLEarlySafe;
  if (actual && actual !== p.safe) { try { actual.value = 0; } catch {} }
}
function boundFront(p) {
  const u = p.m.uniforms;
  return !p.disabled && p.hr.envFront === p.m && u === p.uniforms && p.m.fragmentShader === p.shader && p.m.vertexShader === p.vertex && p.m.precision === null && p.m.glslVersion === null && Object.keys(p.m.defines).length === 0 && Object.values(p.m.extensions).every(v => v === false) && p.m.onBeforeRender === THREE.Material.prototype.onBeforeRender && p.m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && p.m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey && u.uBLEarlySafe === p.safe && u.uBLp === p.pu && u.uBLc === p.cu && u.uBLn === p.nu && u.uBLr === p.ru && u.uBLk === p.ku && u.uBLi === p.iu && u.uBLis === p.su && p.pu.value === p.positions && p.cu.value === p.colors && p.ru.value === p.rect && p.ku.value === p.mask && p.iu.value === p.clip && p.positions.length === 44 && p.colors.length === 44;
}
function beginFront(p, kind) {
  if (!p) return;
  p.safe.value = 0; p[kind] = false; p.depth++;
  if (p.depth !== 1 || !boundFront(p)) stopFront(p);
}
function finishFront(p, kind, valid, completed) {
  if (!p) return;
  p.depth--;
  if (p.disabled) return;
  if (!completed) { p[kind] = false; p.safe.value = 0; return; }
  if (!boundFront(p)) { stopFront(p); return; }
  p[kind] = valid;
  p.safe.value = p.depth === 0 && p.lights && p.maskValid && p.clipValid ? 1 : 0;
}
function knownFront(m) {
  return m?.isShaderMaterial && m.fragmentShader === KNOWN_ENV && m.vertexShader === 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }' && m.precision === null && m.glslVersion === null && Object.keys(m.defines).length === 0 && Object.values(m.extensions).every(v => v === false) && m.onBeforeRender === THREE.Material.prototype.onBeforeRender && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
}
function installFrontProof(hr, m) {
  const before = m.fragmentShader;
  const maskAt = before.indexOf('          vec2 mlo = smoothstep(uBLr.xy');
  const tail = 'if (uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); acc *= ilo.x * ilo.y * ihi.x * ihi.y; }';
  const tailAt = before.indexOf('          ' + tail, maskAt);
  if (maskAt < 0 || tailAt < 0) return null;
  const prefix = `          float blEarlyClip = 1.0;
          if (uBLEarlySafe != 0 && uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); blEarlyClip = ilo.x * ilo.y * ihi.x * ihi.y; }
          if (uBLEarlySafe == 0 || blEarlyClip != 0.0) {
`;
  let shader = before.slice(0, maskAt) + prefix + before.slice(maskAt, tailAt) + '          }\n' + before.slice(tailAt);
  // Unsafe keeps the exact original tail after the exact original loop.
  shader = shader.replace(tail, `if (uBLEarlySafe != 0) { if (uBLi.z > uBLi.x) acc *= blEarlyClip; } else { ${tail} }`).replace('void main() {', 'uniform int uBLEarlySafe;\nvoid main() {');
  const u = m.uniforms, safe = { value: 0 };
  const p = { hr, m, uniforms: u, safe, shader, vertex: m.vertexShader, pu: u.uBLp, cu: u.uBLc, nu: u.uBLn, ru: u.uBLr, ku: u.uBLk, iu: u.uBLi, su: u.uBLis, positions: u.uBLp.value, colors: u.uBLc.value, rect: u.uBLr.value, mask: u.uBLk.value, clip: u.uBLi.value, lights: false, maskValid: false, clipValid: false, disabled: false, depth: 0 };
  u.uBLEarlySafe = safe; m.fragmentShader = shader; m.needsUpdate = true;
  m.addEventListener('dispose', () => stopFront(p)); frontProofs.set(m, p); return p;
}

// Back has a separate owned proof; front certification never authorizes back.
function stopBack(p) {
  if (!p) return;
  p.disabled = true; try { p.safe.value = 0; } catch {}
  // Mutable normal uniform replacement is detected at the next setter.
  try { const actual = p.m.uniforms?.uBLEarlySafe; if (actual && actual !== p.safe) actual.value = 0; } catch {}
}
function boundBack(p) {
  const u = p.m.uniforms;
  return !p.disabled && p.hr.envBack === p.m && u === p.uniforms && p.m.fragmentShader === p.shader && p.m.vertexShader === p.vertex && p.m.precision === null && p.m.glslVersion === null && Object.keys(p.m.defines).length === 0 && Object.values(p.m.extensions).every(v => v === false) && p.m.onBeforeRender === THREE.Material.prototype.onBeforeRender && p.m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && p.m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey && u.uBLEarlySafe === p.safe && u.uBLp === p.pu && u.uBLc === p.cu && u.uBLn === p.nu && u.uBLr === p.ru && u.uBLk === p.ku && u.uBLi === p.iu && u.uBLis === p.su && p.pu.value === p.positions && p.cu.value === p.colors && p.ru.value === p.rect && p.ku.value === p.mask && p.iu.value === p.clip && p.positions.length === 44 && p.colors.length === 44;
}
function beginBack(p, kind) {
  if (!p) return;
  try { p.safe.value = 0; p[kind] = false; p.depth++; if (p.depth !== 1 || !boundBack(p)) stopBack(p); } catch { stopBack(p); }
}
function finishBack(p, kind, valid, completed) {
  if (!p) return;
  try {
    p.depth--;
    if (p.disabled) return;
    if (!completed) { p[kind] = false; p.safe.value = 0; return; }
    if (!boundBack(p)) { stopBack(p); return; }
    p[kind] = valid;
    p.safe.value = p.depth === 0 && p.lights && p.maskValid && p.clipValid ? 1 : 0;
  } catch { stopBack(p); }
}
function knownBack(m) {
  try { return m?.isShaderMaterial && m.fragmentShader === KNOWN_ENV && m.vertexShader === 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }' && m.precision === null && m.glslVersion === null && Object.keys(m.defines).length === 0 && Object.values(m.extensions).every(v => v === false) && m.onBeforeRender === THREE.Material.prototype.onBeforeRender && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey; } catch { return false; }
}
function installBackProof(hr, m) {
  const before = m.fragmentShader;
  const maskAt = before.indexOf('          vec2 mlo = smoothstep(uBLr.xy');
  const tail = 'if (uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); acc *= ilo.x * ilo.y * ihi.x * ihi.y; }';
  const tailAt = before.indexOf('          ' + tail, maskAt);
  if (maskAt < 0 || tailAt < 0) return null;
  const prefix = `          float blEarlyClip = 1.0;
          if (uBLEarlySafe != 0 && uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); blEarlyClip = ilo.x * ilo.y * ihi.x * ihi.y; }
          if (uBLEarlySafe == 0 || blEarlyClip != 0.0) {
`;
  let shader = before.slice(0, maskAt) + prefix + before.slice(maskAt, tailAt) + '          }\n' + before.slice(tailAt);
  // Unsafe keeps the exact original tail after the exact original loop.
  shader = shader.replace(tail, `if (uBLEarlySafe != 0) { if (uBLi.z > uBLi.x) acc *= blEarlyClip; } else { ${tail} }`).replace('void main() {', 'uniform int uBLEarlySafe;\nvoid main() {');
  const u = m.uniforms, safe = { value: 0 };
  const p = { hr, m, uniforms: u, safe, shader, vertex: m.vertexShader, pu: u.uBLp, cu: u.uBLc, nu: u.uBLn, ru: u.uBLr, ku: u.uBLk, iu: u.uBLi, su: u.uBLis, positions: u.uBLp.value, colors: u.uBLc.value, rect: u.uBLr.value, mask: u.uBLk.value, clip: u.uBLi.value, lights: false, maskValid: false, clipValid: false, disabled: false, depth: 0 };
  u.uBLEarlySafe = safe; m.fragmentShader = shader; m.needsUpdate = true;
  m.addEventListener('dispose', () => stopBack(p)); backProofs.set(m, p); return p;
}

export function installBallLights(hr, { max = 8, floor = 0.02, ownedFrontEarlyClip = false, ownedBackEarlyClip = false } = {}) {
  const mats = [hr.envBack, hr.envFront];
  let proof = null, backProof = null;
  for (const m of mats) stopFront(frontProofs.get(m));
  for (const m of mats) stopBack(backProofs.get(m));
  const decl = `uniform int uBLn; uniform vec4 uBLp[${max}]; uniform vec4 uBLc[${max}]; uniform vec4 uBLr; uniform vec2 uBLk; uniform vec4 uBLi; uniform float uBLis;\n`;
  for (const m of mats) {
    if (m.userData.ballLights) continue;
    const backEligible = ownedBackEarlyClip === true && m === hr.envBack && m !== hr.envFront && max === 44 && floor === 0.02 && knownBack(m);
    const eligible = ownedFrontEarlyClip === true && m === hr.envFront && max === 44 && floor === 0.02 && knownFront(m);
    m.fragmentShader = m.fragmentShader.replace('void main() {', decl + 'void main() {')
      .replace('gl_FragColor = vec4(wa * a.rgb + wb * b.rgb, 0.0);', `
        vec3 col = wa * a.rgb + wb * b.rgb;
        if (uBLn > 0) {
          vec2 pp = vec2(float(p.x) + 0.5, float(${2560} - 1 - p.y) + 0.5);
          vec3 refl = max(a.rgb + b.rgb, vec3(${floor.toFixed(4)}));
          vec3 acc = vec3(0.0);
          vec2 mlo = smoothstep(uBLr.xy - uBLk.y, uBLr.xy + uBLk.y, pp), mhi = 1.0 - smoothstep(uBLr.zw - uBLk.y, uBLr.zw + uBLk.y, pp);
          float mk = mix(1.0, uBLk.x, mlo.x * mlo.y * mhi.x * mhi.y);   // 液晶の面は盤の洗いを弱める(液晶の絵の色を染めない)
          for (int i = 0; i < ${max}; i++) { if (i >= uBLn) break; vec2 d = pp - uBLp[i].xy; float g = exp(-dot(d, d) / (uBLp[i].z * uBLp[i].z)); acc += uBLc[i].rgb * g * mix(mk, 1.0, uBLp[i].w); }   // w=1: 玉の光は液晶の面でも弱めない(液晶の上端の玉が黒く沈まない)
          if (uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); acc *= ilo.x * ilo.y * ihi.x * ihi.y; }   // 盤の洗いは囲い(ガラス窓)の内側だけ。外の枠・花びらの周りは照らさない
          col += acc * refl;
        }
        gl_FragColor = vec4(col, 0.0);`);
    m.uniforms.uBLn = { value: 0 }; m.uniforms.uBLr = { value: new THREE.Vector4(0, 0, 0, 0) }; m.uniforms.uBLk = { value: new THREE.Vector2(1, 1) }; m.uniforms.uBLi = { value: new THREE.Vector4(0, 0, 0, 0) }; m.uniforms.uBLis = { value: 20 };
    m.uniforms.uBLp = { value: Array.from({ length: max }, () => new THREE.Vector4()) };
    m.uniforms.uBLc = { value: Array.from({ length: max }, () => new THREE.Vector4()) };
    m.userData.ballLights = true; m.needsUpdate = true;
    if (eligible) proof = installFrontProof(hr, m);
    if (backEligible) backProof = installBackProof(hr, m);
  }
  return {
    max,
    // Owned opt-in: stop permanently before external BL uniform/shader writes.
    disableFrontEarlyClip() { stopFront(proof); },
    disableBackEarlyClip() { stopBack(backProof); },
    // 液晶の矩形[x0,y0,x1,y1](1440x2560の画面px)では照射を k 倍にする(境界は soft px でなだらか)。k=1で無効
    setMask(rect, k = .15, soft = 30) {
      beginFront(proof, 'maskValid'); beginBack(backProof, 'maskValid'); let valid = false, backValid = false, completed = false;
      try {
      for (const m of mats) {
        m.uniforms.uBLr.value.set(rect[0], rect[1], rect[2], rect[3]); m.uniforms.uBLk.value.set(k, soft);
        if (proof && !proof.disabled && m === proof.m) { const r = m.uniforms.uBLr.value, v = m.uniforms.uBLk.value; valid = v?.constructor === THREE.Vector2 && v.set === THREE.Vector2.prototype.set && normal(v.x, 0, 1) && smoothEdges(r, v.y); }
        if (backProof && !backProof.disabled && m === backProof.m) { try { const r = m.uniforms.uBLr.value, v = m.uniforms.uBLk.value; backValid = v?.constructor === THREE.Vector2 && v.set === THREE.Vector2.prototype.set && normal(v.x, 0, 1) && smoothEdges(r, v.y); } catch { stopBack(backProof); } }
      }
      completed = true;
      } finally { try { finishFront(proof, 'maskValid', valid, completed); } finally { finishBack(backProof, 'maskValid', backValid, completed); } }
    },
    // 照射を矩形[x0,y0,x1,y1](画面px)の内側だけに限る(境界は soft px でなだらか)。囲いの外(枠・外側の花びら)は盤の洗いで光らない
    setClip(rect, soft = 20) {
      beginFront(proof, 'clipValid'); beginBack(backProof, 'clipValid'); let valid = false, backValid = false, completed = false;
      try {
      for (const m of mats) {
        m.uniforms.uBLi.value.set(rect[0], rect[1], rect[2], rect[3]); m.uniforms.uBLis.value = soft;
        if (proof && !proof.disabled && m === proof.m) valid = smoothEdges(m.uniforms.uBLi.value, m.uniforms.uBLis.value, true);
        if (backProof && !backProof.disabled && m === backProof.m) { try { backValid = smoothEdges(m.uniforms.uBLi.value, m.uniforms.uBLis.value, true); } catch { stopBack(backProof); } }
      }
      completed = true;
      } finally { try { finishFront(proof, 'clipValid', valid, completed); } finally { finishBack(backProof, 'clipValid', backValid, completed); } }
    },
    set(list = []) {
      beginFront(proof, 'lights'); beginBack(backProof, 'lights');
      let valid = false, backValid = false, completed = false;
      try {
      const n = Math.min(list.length, max);
      valid = Number.isInteger(n) && n >= 0 && n <= 44;
      backValid = Number.isInteger(n) && n >= 0 && n <= 44;
      for (const m of mats) {
        m.uniforms.uBLn.value = n;
        for (let i = 0; i < n; i++) {
          const L = list[i], c = L.rgb ?? [1, 1, 1], g = L.gain ?? 1;
          m.uniforms.uBLp.value[i].set(L.x, L.y, Math.max(1, L.radius ?? 160), L.nomask ? 1 : 0);
          m.uniforms.uBLc.value[i].set(c[0] * g, c[1] * g, c[2] * g, 0);
          if (proof && !proof.disabled && m === proof.m) { const pv = m.uniforms.uBLp.value[i], cv = m.uniforms.uBLc.value[i]; valid = valid && four(pv, -65536, 65536) && normal(pv.z, 1, 65536) && (pv.w === 0 || pv.w === 1) && four(cv, 0, 64); }
          if (backProof && !backProof.disabled && m === backProof.m) { try { const pv = m.uniforms.uBLp.value[i], cv = m.uniforms.uBLc.value[i]; backValid = backValid && four(pv, -65536, 65536) && normal(pv.z, 1, 65536) && (pv.w === 0 || pv.w === 1) && four(cv, 0, 64); } catch { stopBack(backProof); } }
        }
      }
      completed = true;
      } finally { try { finishFront(proof, 'lights', valid, completed); } finally { finishBack(backProof, 'lights', backValid, completed); } }
    },
  };
}
const H_PX = 2560;
