// 固定窓カメラ（hybrid_spec §1）。lookAt なし、回転なし、frustum 直指定。単位は m。
import * as THREE from '../vendor/three/three.module.js';

export const WINDOW = Object.freeze({
  W_PX: 1440, H_PX: 2560,           // 描画ピクセル（DPR=1 固定）
  W_M: 0.336, H_M: 0.598,           // 窓の実寸
  EYE: Object.freeze([0, -0.0598, 0.55]),  // 目（窓の下端から 40% の高さ、窓の手前 550mm）
  NEAR: 0.010, FAR: 2.0,
});

/** near 面での frustum (left,right,bottom,top)。窓の端と目から幾何的に導く（契約 JSON と一致することをテストする）。 */
export function frustumAtNear(w = WINDOW) {
  const k = w.NEAR / w.EYE[2];
  return {
    left: (-w.W_M / 2 - w.EYE[0]) * k,
    right: (w.W_M / 2 - w.EYE[0]) * k,
    bottom: (-w.H_M / 2 - w.EYE[1]) * k,
    top: (w.H_M / 2 - w.EYE[1]) * k,
  };
}

/** THREE.Camera（PerspectiveCamera ではない: updateProjectionMatrix が行列を上書きしないように）。 */
export function makeWindowCamera(w = WINDOW) {
  const cam = new THREE.Camera();
  cam.position.set(w.EYE[0], w.EYE[1], w.EYE[2]);
  cam.rotation.set(0, 0, 0);
  const f = frustumAtNear(w);
  cam.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, w.NEAR, w.FAR);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  cam.updateMatrixWorld(true);
  cam.userData.frustum = f;
  return cam;
}

/** 世界座標(m, Z手前) → 出力ピクセル（上端原点, ピクセル中心が i+0.5）。three の行列経由。 */
export function projectToPixel(cam, x, y, z, w = WINDOW) {
  const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return [(v.x + 1) / 2 * w.W_PX, (1 - v.y) / 2 * w.H_PX];
}

/** 解析解（行列を使わない）。窓面 z=0 の点は窓の寸法そのまま、奥(z<0)は 0.55/(0.55-z) 倍に縮む。 */
export function projectAnalytic(x, y, z, w = WINDOW) {
  const s = w.EYE[2] - z;                  // 目からの奥行き
  const k = w.EYE[2] / s;
  const xw = w.EYE[0] + (x - w.EYE[0]) * k;
  const yw = w.EYE[1] + (y - w.EYE[1]) * k;
  return [(xw + w.W_M / 2) / w.W_M * w.W_PX, (w.H_M / 2 - yw) / w.H_M * w.H_PX];
}
