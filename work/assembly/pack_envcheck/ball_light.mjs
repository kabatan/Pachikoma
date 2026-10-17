// 玉に追従する点光源（盤の近傍だけ明るくなる）。web/src は触らず、envの全画面パスのシェーダーを実行時に拡張する。
// 使い方: import { installBallLights } from '.../ball_light.mjs'; const BL = installBallLights(hr);
//   BL.set([{ x, y, rgb:[r,g,b], radius:px, gain:0..8 }, ...])   // x,y=1440×2560 画面座標(px, 左上原点)。毎フレーム呼んでよい。最大 BL.max 個。空配列で消灯
// 式: env_pass += Σ_i rgb_i·gain_i·exp(-|p-p_i|²/r_i²) · refl(x)  （refl = 環境 A+B の明るさの代理。釘・枠・花びら・盤の実際の面だけが光る）
//  light_floor: 反射率の下限（暗い紺の盤も少し光る）。frame/ea/eb の駆動は変えない。既定で無効(0個)＝描画は従来とRGB8同一。
import * as THREE from '../../game_demo/web/vendor/three/three.module.js';
export function installBallLights(hr, { max = 8, floor = 0.02 } = {}) {
  const mats = [hr.envBack, hr.envFront];
  const decl = `uniform int uBLn; uniform vec4 uBLp[${max}]; uniform vec4 uBLc[${max}];\n`;
  for (const m of mats) {
    if (m.userData.ballLights) continue;
    m.fragmentShader = m.fragmentShader.replace('void main() {', decl + 'void main() {')
      .replace('gl_FragColor = vec4(wa * a.rgb + wb * b.rgb, 0.0);', `
        vec3 col = wa * a.rgb + wb * b.rgb;
        if (uBLn > 0) {
          vec2 pp = vec2(float(p.x) + 0.5, float(${2560} - 1 - p.y) + 0.5);
          vec3 refl = max(a.rgb + b.rgb, vec3(${floor.toFixed(4)}));
          vec3 acc = vec3(0.0);
          for (int i = 0; i < ${max}; i++) { if (i >= uBLn) break; vec2 d = pp - uBLp[i].xy; float g = exp(-dot(d, d) / (uBLp[i].z * uBLp[i].z)); acc += uBLc[i].rgb * g; }
          col += acc * refl;
        }
        gl_FragColor = vec4(col, 0.0);`);
    m.uniforms.uBLn = { value: 0 };
    m.uniforms.uBLp = { value: Array.from({ length: max }, () => new THREE.Vector4()) };
    m.uniforms.uBLc = { value: Array.from({ length: max }, () => new THREE.Vector4()) };
    m.userData.ballLights = true; m.needsUpdate = true;
  }
  return {
    max,
    set(list = []) {
      const n = Math.min(list.length, max);
      for (const m of mats) {
        m.uniforms.uBLn.value = n;
        for (let i = 0; i < n; i++) {
          const L = list[i], c = L.rgb ?? [1, 1, 1], g = L.gain ?? 1;
          m.uniforms.uBLp.value[i].set(L.x, L.y, Math.max(1, L.radius ?? 160), 0);
          m.uniforms.uBLc.value[i].set(c[0] * g, c[1] * g, c[2] * g, 0);
        }
      }
    },
  };
}
const H_PX = 2560;
