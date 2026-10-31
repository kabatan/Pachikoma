// 11/1 球を解析式で描く（?ballfn=1、既定オフ）。内蔵GPU向けの試験。
//
// 従来：球 1 個＝正二十面体の三角形メッシュ（頂点シェーダ＋ラスタライズ＋MSAA＋解決）で「球バッファ」へ描き、最終合成が読む。
// これ：球を「中心と半径の球」として扱い、画素ごとにレイと球の交点を解く。MSAA も頂点処理も解決も要らない。
//   ・皿（trayVisual）は従来どおり球 0 個の状態で球バッファに描く（変わった時だけ描き直す。既存の ballskip の仕組みのまま）
//     ＋ 皿の深度を別の 1 枚に描く（皿が変わった時だけ）
//   ・球は CPU で 32 画素のタイルに振り分け（手前の球が先）、全画面 1 回の合成パスで「球バッファ」と同じ形（rgb=F·env、a=前景より手前）を
//     画素ごとに front-to-back で重ねて 1 枚の RGBA16F に書く。最終合成は今までどおりこれを uD として読む
//   ・陰影は従来の球フラグメントシェーダの式そのまま（プローブ 3 点の補間・視差補正・フレネル・studioEnv・前景の奥行き判定）
//   ・タイルあたりの球が多すぎる（K 個超）フレームだけ、従来の描画へ戻す（stats.overflow）
// 最終合成のシェーダにはサンプラーの余裕が無い（16 個の上限）ので、最終合成の中ではなく、手前の 1 パスにした。
import { lodTextures } from './final_region_1101.mjs';
const TILE = 32, K = 32, W = 1440, H = 2560;

export function createAnalyticBalls({ THREE, hr, r, ballMaterial, selPI, selPW, vertexShader, uPBK, nProbes }) {
  const fs = ballMaterial.fragmentShader;
  const a = fs.indexOf('flat varying vec3 vPW;'), b = fs.lastIndexOf('void main() {');
  if (a < 0 || b < a) throw Error('ball_analytic: ball fragment shader changed');
  const chunk = fs.slice(a + 'flat varying vec3 vPW;'.length, b);   // PROBE_FACE_GLSL・probeRadiance・studioEnv（vWorld は下でグローバルに）
  const TX = Math.ceil(W / TILE), TY = Math.ceil(H / TILE);
  const stats = { composes: 0, overflow: 0, maxPerTile: 0, trayDepthDraws: 0, skippedNear: 0, tilesAvg: 0, trayRows: 0 };
  const tilesArr = new Uint16Array(TX * K * TY), tiles = new THREE.DataTexture(tilesArr, TX * K, TY, THREE.RedIntegerFormat, THREE.UnsignedShortType);
  tiles.minFilter = tiles.magFilter = THREE.NearestFilter; tiles.generateMipmaps = false; tiles.flipY = false; tiles.unpackAlignment = 1;
  const cnt = new Uint8Array(TX * TY);
  let maxBalls = hr.balls.instanceMatrix.count;
  const dataArr = new Float32Array(maxBalls * 12), data = new THREE.DataTexture(dataArr, 3, maxBalls, THREE.RGBAFormat, THREE.FloatType);
  data.minFilter = data.magFilter = THREE.NearestFilter; data.generateMipmaps = false; data.flipY = false;
  const order = new Uint32Array(maxBalls), dist = new Float32Array(maxBalls);
  let depthGen = -1;
  let out = null, depthRT = null, depthKey = '', outKey = '', trayGenSeen = -1;
  const prevFlag = new Uint8Array(TX * TY), dirtyIdx = new Uint16Array(TX * TY);
  const U = ballMaterial.uniforms;
  const uniforms = {
    uPBK, uTrayC: { value: null }, uTrayD: { value: null }, uBallTex: { value: data }, uTiles: { value: tiles }, uCam: { value: new THREE.Vector3() },
    uInvVP: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() }, uPixAng: { value: 0 },
    uAtlas: U.uAtlas, uPPos: U.uPPos, uBoxMin: U.uBoxMin, uBoxMax: U.uBoxMax, uF0: U.uF0, uFill: U.uFill, uBounce: U.uBounce, uOcc: U.uOcc, uOccOn: U.uOccOn,
  };
  const frag = `
uniform vec2 uPBK;
uniform highp sampler2D uTrayC, uTrayD, uBallTex;
uniform highp usampler2D uTiles;
uniform vec3 uCam; uniform mat4 uInvVP, uView; uniform float uPixAng;
uniform highp sampler2D uAtlas; uniform vec3 uPPos[${nProbes}];
uniform vec3 uBoxMin, uBoxMax, uF0; uniform float uFill, uBounce;
uniform highp sampler2D uOcc; uniform int uOccOn;
vec3 vWorld;
${chunk}
void main() {
  ivec2 pd = ivec2(gl_FragCoord.xy);
  vec2 fc = gl_FragCoord.xy * uPBK;
  vec4 tray = pd.y < textureSize(uTrayC, 0).y ? texelFetch(uTrayC, pd, 0) : vec4(0.0);
  ivec2 tile = ivec2(fc / ${TILE}.0);
  vec3 rgb = vec3(0.0); float fr = 0.0, acc = 0.0;
  if (tile.x < ${TX} && tile.y < ${TY}) {
    float td = pd.y < textureSize(uTrayD, 0).y ? texelFetch(uTrayD, pd, 0).r : 0.0;
    vec2 ndc = fc / vec2(${W}.0, ${H}.0) * 2.0 - 1.0;
    vec4 w4 = uInvVP * vec4(ndc, 1.0, 1.0);
    vec3 dir = normalize(w4.xyz / w4.w - uCam);
    for (int k = 0; k < ${K}; k++) {
      int id = int(texelFetch(uTiles, ivec2(tile.x * ${K} + k, tile.y), 0).r);
      if (id == 0) break;
      id -= 1;
      vec4 s0 = texelFetch(uBallTex, ivec2(0, id), 0);
      vec3 oc = s0.xyz - uCam; float rad = s0.w;
      float bb = dot(oc, dir);
      float d2 = dot(oc, oc) - bb * bb;
      float h = sqrt(max(d2, 0.0));
      float pp = max(bb, 1e-4) * uPixAng;
      float cov = clamp(0.5 + (rad - h) / pp, 0.0, 1.0);
      if (cov <= 0.0 || bb <= 0.0) continue;
      float t = bb - sqrt(max(rad * rad - d2, 0.0));
      vec3 P = uCam + dir * t;
      float vd = -(uView * vec4(P, 1.0)).z;
      if (td > 0.0 && vd > td) continue;                       // 皿の手前の面に隠れる
      vec3 N = normalize(P - s0.xyz);
      vec3 pi = texelFetch(uBallTex, ivec2(1, id), 0).xyz, pw = texelFetch(uBallTex, ivec2(2, id), 0).xyz;
      vWorld = P;
      vec3 V = normalize(uCam - P);
      vec3 R = reflect(-V, N);
      vec3 env = vec3(0.0);
      for (int j = 0; j < 3; j++) { if (pw[j] > 0.0) env += pw[j] * probeRadiance(int(pi[j] + 0.5), R); }
      env += uFill * studioEnv(R) + uBounce * vec3(0.9, 0.92, 1.0) * smoothstep(0.0, -0.85, R.y);
      float cs = clamp(dot(N, V), 0.0, 1.0);
      vec3 F = uF0 + (1.0 - uF0) * pow(1.0 - cs, 5.0);
      float front = 0.0;
      if (uOccOn == 1) {
        float occ = texelFetch(uOcc, ivec2(int(fc.x), ${H - 1} - int(fc.y)), 0).r;
        front = (occ < 99.0 && vd <= occ + 0.00005) ? 1.0 : 0.0;
      }
      float wgt = (1.0 - acc) * cov;
      rgb += wgt * F * env; fr += wgt * front; acc += wgt;
      if (acc > 0.9995) break;
    }
  }
  gl_FragColor = vec4(rgb, fr) + (1.0 - acc) * tray;
}`;
  // D3D11（ANGLE）は、可変回数のループの中で暗黙の微分を使う texture() をコンパイルできない／展開に失敗することがある。ミップなしなので textureLod(,0) と同じ
  const fragL = lodTextures(frag).src;
  const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader: fragL, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(hr._tri, mat); mesh.frustumCulled = false; scene.add(mesh);   // 全画面 1 枚（皿の行の写しだけに使う）
  // 球があるタイルと前回あったタイルだけを描く：1 タイル 1 つの四角（インスタンス）。それ以外の画素は前の内容のまま（0 または皿）
  const matT = new THREE.ShaderMaterial({
    vertexShader: `attribute vec2 aTile; void main() { vec2 q = (aTile + position.xy) * ${TILE}.0 / vec2(${W}.0, ${H}.0); gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: fragL, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, side: THREE.DoubleSide });
  const tileGeo = new THREE.InstancedBufferGeometry();
  tileGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  const tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(TX * TY * 2), 2); tileAttr.setUsage(THREE.DynamicDrawUsage); tileGeo.setAttribute('aTile', tileAttr);
  const sceneT = new THREE.Scene(), meshT = new THREE.Mesh(tileGeo, matT); meshT.frustumCulled = false; sceneT.add(meshT);
  const depthMat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vD; void main() { vec4 vp = modelViewMatrix * vec4(position, 1.0); vD = -vp.z; gl_Position = projectionMatrix * vp; }',
    fragmentShader: 'varying float vD; void main() { gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }',
    side: THREE.DoubleSide, depthTest: true, depthWrite: true, blending: THREE.NoBlending,
  });

  function ensureOut(RW, RH) {
    const key = RW + 'x' + RH;
    if (out && outKey === key) return;
    out?.dispose();
    out = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    r.initRenderTarget?.(out); outKey = key; trayGenSeen = -1; prevFlag.fill(0);   // 作った直後は 0 に消して、皿の行を写し直す
    r.setRenderTarget(out); r.setClearColor(0x000000, 0); r.clear(true, false, false);
  }

  // 皿の深度（皿が描き直された時と、球バッファの大きさが変わった時だけ）。クリア値 0 ＝ 皿なし
  function trayDepth(trayTarget, drew, RW, RH) {
    const key = trayTarget.width + 'x' + trayTarget.height;
    if (!drew && depthRT && depthKey === key) return;
    if (!depthRT || depthKey !== key) {
      depthRT?.dispose();
      depthRT = new THREE.WebGLRenderTarget(trayTarget.width, trayTarget.height, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      r.initRenderTarget?.(depthRT); depthKey = key;
    }
    const old = hr.sBalls.overrideMaterial, hidden = [], ballsVisible = hr.balls.visible; hr.balls.visible = false;
    const g = hr.trayVisualHandle?.group;
    if (g) for (const m of g.children) if (m.visible && m.material?.transparent) { m.visible = false; hidden.push(m); }   // ほぼ透明のガラス（深度に入れない）
    try {
      hr.sBalls.overrideMaterial = depthMat;
      r.setRenderTarget(depthRT); r.setViewport(0, 0, RW, RH); r.setClearColor(0x000000, 0); r.clear(true, true, false);
      if (hr.trayVisual) r.render(hr.sBalls, hr.camera);
    } finally { hr.sBalls.overrideMaterial = old; hr.balls.visible = ballsVisible; for (const m of hidden) m.visible = true; }
    stats.trayDepthDraws++;
  }

  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  // 球の数だけ CPU で振り分けて合成パスを 1 回描く。戻り値＝最終合成が読む RT（タイルあふれ時は null）
  function compose({ count, trayTarget, trayGen, RW, RH }) {
    const cam = hr.camera; cam.updateMatrixWorld(true);
    const mesh0 = hr.balls, mw = mesh0.matrixWorld.elements, im = mesh0.instanceMatrix.array, view = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    cnt.fill(0); tilesArr.fill(0);
    let n = 0, overflow = false, topRow = 0;
    const px0 = P[0] * 0.5 * W, py1 = P[5] * 0.5 * H;
    for (let k = 0; k < count; k++) {
      const o = k * 16, tx = im[o + 12], ty = im[o + 13], tz = im[o + 14], tw = im[o + 15];
      const cx = mw[0] * tx + mw[4] * ty + mw[8] * tz + mw[12] * tw, cy = mw[1] * tx + mw[5] * ty + mw[9] * tz + mw[13] * tw, cz = mw[2] * tx + mw[6] * ty + mw[10] * tz + mw[14] * tw;
      const ax = mw[0] * im[o] + mw[4] * im[o + 1] + mw[8] * im[o + 2], ay = mw[1] * im[o] + mw[5] * im[o + 1] + mw[9] * im[o + 2], az = mw[2] * im[o] + mw[6] * im[o + 1] + mw[10] * im[o + 2];
      const rad = Math.hypot(ax, ay, az);
      const vx = view[0] * cx + view[4] * cy + view[8] * cz + view[12], vy = view[1] * cx + view[5] * cy + view[9] * cz + view[13], vz = view[2] * cx + view[6] * cy + view[10] * cz + view[14];
      if (!(vz < -rad)) { stats.skippedNear++; continue; }
      const iw = 1 / -vz;
      const sx = ((P[0] * vx + P[8] * vz) * iw * 0.5 + 0.5) * W, sy = ((P[5] * vy + P[9] * vz) * iw * 0.5 + 0.5) * H;
      const rp = rad * iw * Math.max(px0, py1) * 1.35 + 3;
      const d = n * 12;
      dataArr[d] = cx; dataArr[d + 1] = cy; dataArr[d + 2] = cz; dataArr[d + 3] = rad;
      dataArr[d + 4] = selPI.array[k * 3]; dataArr[d + 5] = selPI.array[k * 3 + 1]; dataArr[d + 6] = selPI.array[k * 3 + 2]; dataArr[d + 7] = 0;
      dataArr[d + 8] = selPW.array[k * 3]; dataArr[d + 9] = selPW.array[k * 3 + 1]; dataArr[d + 10] = selPW.array[k * 3 + 2]; dataArr[d + 11] = 0;
      // 画面上の範囲（元の 1440×2560 の画素、y は下から）を scr に
      dist[n] = -vz; order[n] = n;
      scr[n * 3] = sx; scr[n * 3 + 1] = sy; scr[n * 3 + 2] = rp;
      if (sy + rp > topRow) topRow = sy + rp;
      n++;
    }
    const idx = order.subarray(0, n); idx.sort((p, q) => dist[p] - dist[q]);
    for (let s = 0; s < n && !overflow; s++) {
      const i = idx[s], sx = scr[i * 3], sy = scr[i * 3 + 1], rp = scr[i * 3 + 2];
      const x0 = Math.max(0, Math.floor((sx - rp) / TILE)), x1 = Math.min(TX - 1, Math.floor((sx + rp) / TILE)), y0 = Math.max(0, Math.floor((sy - rp) / TILE)), y1 = Math.min(TY - 1, Math.floor((sy + rp) / TILE));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const t = ty * TX + tx, c = cnt[t];
        if (c >= K) { overflow = true; break; }
        tilesArr[ty * TX * K + tx * K + c] = i + 1; cnt[t] = c + 1; if (c + 1 > stats.maxPerTile) stats.maxPerTile = c + 1;
      }
    }
    if (overflow) { stats.overflow++; return null; }
    // 球のデータの並びは、手前の順（idx）ではなく到着順 i で置いてあるので、タイル内の番号 i+1 で引ける。
    trayDepth(trayTarget, trayGen !== depthGen, RW, RH); depthGen = trayGen;
    ensureOut(RW, RH);
    data.needsUpdate = true; tiles.needsUpdate = true;
    uniforms.uTrayC.value = trayTarget.texture; uniforms.uTrayD.value = depthRT.texture;
    uniforms.uCam.value.setFromMatrixPosition(cam.matrixWorld);
    m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); uniforms.uInvVP.value.copy(m4).invert();
    uniforms.uView.value.copy(cam.matrixWorldInverse);
    uniforms.uPixAng.value = 2 / (H * P[5]);
    // 描く所：皿の行（皿が描き直された時だけ全幅）＋ 球があるタイルと前回あったタイル
    const scale = RH / H;
    r.setRenderTarget(out); r.setViewport(0, 0, RW, RH);
    if (trayGen !== trayGenSeen) {
      r.setScissorTest(true); r.setScissor(0, 0, RW, Math.min(RH, trayTarget.height + 2));
      try { r.render(scene, hr.fsCam); } finally { r.setScissorTest(false); }
      trayGenSeen = trayGen; stats.trayRows = (stats.trayRows ?? 0) + 1;
    }
    let nd = 0;
    for (let t = 0; t < TX * TY; t++) {
      if (cnt[t] > 0 || prevFlag[t]) { const o2 = nd * 2; tileAttr.array[o2] = t % TX; tileAttr.array[o2 + 1] = (t / TX) | 0; nd++; }
      prevFlag[t] = cnt[t] > 0 ? 1 : 0;
    }
    if (nd) {
      tileGeo.instanceCount = nd; tileAttr.clearUpdateRanges(); tileAttr.addUpdateRange(0, nd * 2); tileAttr.needsUpdate = true;
      r.render(sceneT, hr.fsCam);
    }
    stats.tilesAvg += (nd / (TX * TY) - stats.tilesAvg) * 0.05;
    stats.composes++;
    return out;
  }
  const scr = new Float32Array(maxBalls * 3);

  return { compose, stats, dispose() { out?.dispose(); depthRT?.dispose(); tiles.dispose(); data.dispose(); mat.dispose(); matT.dispose(); tileGeo.dispose(); depthMat.dispose(); } };
}
