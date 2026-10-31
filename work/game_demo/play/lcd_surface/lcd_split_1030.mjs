// 液晶の板(plate)を「1枚の大きな canvas を毎回 GPU へ送る」代わりに、
// 動かない絵(一度だけ送る)＋動く絵(行列だけ毎フレーム更新)＋小さい動的 canvas の重ね合わせで描く。
// 画面ごと(スタッフ待ち・継続)の層の作り方は各モジュールが持ち、ここは合成器だけ。?staffsplit=0 / ?timeupvideo=0 で各画面を従来(canvas 全面転送)へ戻す。
// 層の順は下から上。各層: { tex, w, h, ax, ay, x, y, rot, sc, alpha, add }
//   tex: THREE.Texture (premultiplyAlpha=true, flipY=true の canvas/動画)。w,h: テクスチャの画素寸法。
//   (ax,ay): テクスチャ内の基準点(画素, 左上原点)。(x,y): 液晶 canvas 座標(画素, 左上原点)での配置先。
//   rot: 時計回り(ラジアン、canvas の rotate と同じ向き)。sc: 拡大。alpha: 不透明度。add: true なら加算('lighter')。
export const SPLIT_N = 12;
export const CANVAS_W = 1240, CANVAS_H = 1510;

function splitUniforms(T) {
  const dummy = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, T.RGBAFormat, T.UnsignedByteType); dummy.needsUpdate = true;
  const u = { uSplit: { value: 0 }, uCv: { value: new T.Vector2(CANVAS_W, CANVAS_H) }, uLM: { value: Array.from({ length: SPLIT_N }, () => new T.Matrix3()) }, uLP: { value: Array.from({ length: SPLIT_N }, () => new T.Vector4()) } };
  for (let i = 0; i < SPLIT_N; i++) u['uLt' + i] = { value: dummy };
  u.__dummy = dummy;
  // 10/31 パネルの合成を重ね合わせの最下層に取り込む（?lcdfuse=0 で従来）。層 0 の texture を映像の生の絵(raw)として読み、窓の位置への配置・overlay・HUD・フラッシュを式で足す。
  u.uFuse = { value: 0 }; u.uFOv = { value: new T.Vector4() }; u.uFRect = { value: new T.Vector4() }; u.uFFlash = { value: new T.Vector3() }; u.uFOverlay = { value: dummy }; u.uFHud = { value: dummy };
  return u;
}

// video_gpu_history の VIDEO_PANEL_FRAGMENT と同じ式（窓 (34,28) 1152x1268 に raw、overlay は screen 合成、フラッシュ、HUD (690,130) 496x410）。
// 従来は 1240x1510 の 8bit の面に書いてから層 0 として読んでいたので、書いたときの 8bit への丸めを floor(c*255+.5)/255 で同じにする。
const FUSE_FN = `
vec3 fusedBase(vec2 p) {
  vec2 s = (p - vec2(34., 28.)) / vec2(1152., 1268.);
  vec3 c = vec3(0.);
  if (all(greaterThanEqual(s, vec2(0.))) && all(lessThan(s, vec2(1.)))) {
    c = texture2D(uLt0, vec2(s.x, 1. - s.y)).rgb;
    vec2 u = (p - vec2(34., 28.) - uFRect.xy) / uFRect.zw;
    if (uFOv.x > .5 && all(greaterThanEqual(u, vec2(0.))) && all(lessThan(u, vec2(1.)))) { vec4 o = texture2D(uFOverlay, vec2(u.x, 1. - u.y)); c += o.rgb * o.a * (vec3(1.) - c); }
    c = mix(c, uFFlash, uFOv.z);
  }
  vec2 h = (p - vec2(690., 130.)) / vec2(496., 410.);
  if (uFOv.y > .5 && all(greaterThanEqual(h, vec2(0.))) && all(lessThan(h, vec2(1.)))) { vec4 t = texture2D(uFHud, vec2(h.x, 1. - h.y)); c = mix(c, t.rgb, t.a); }
  return floor(clamp(c, 0., 1.) * 255. + .5) / 255.;
}`;
function splitShaderChunks(front = false) {
  const decl = 'uniform float uSplit; uniform vec2 uCv; uniform mat3 uLM[' + SPLIT_N + ']; uniform vec4 uLP[' + SPLIT_N + ']; uniform float uFuse; uniform vec4 uFOv, uFRect; uniform vec3 uFFlash; uniform sampler2D uFOverlay, uFHud; ' + Array.from({ length: SPLIT_N }, (_, i) => 'uniform sampler2D uLt' + i + ';').join(' ') + FUSE_FN;
  const SAMPLE = (i) => i === 0 ? `uFuse > .5 ? vec4(fusedBase(q.xy), 1.) : texture2D(uLt0, vec2(q.x / uLP[0].z, 1.0 - q.y / uLP[0].w))` : `texture2D(uLt${i}, vec2(q.x / uLP[${i}].z, 1.0 - q.y / uLP[${i}].w))`;
  const body = Array.from({ length: SPLIT_N }, (_, i) => `
        { vec3 q = uLM[${i}] * vec3(p, 1.0);
          if (uLP[${i}].x > 0.0 && q.x >= 0.0 && q.y >= 0.0 && q.x <= uLP[${i}].z && q.y <= uLP[${i}].w) {
            vec4 s = ${SAMPLE(i)};
            if (uLP[${i}].y > 0.5) col += s.rgb * uLP[${i}].x; else col = col * (1.0 - s.a * uLP[${i}].x) + s.rgb * uLP[${i}].x;
          } }`).join('\n');
  // 10/31 上の層から順に重ねる版（?splitfront=0 で従来）：下の層から重ねる式 col = col*(1-a)+c は、上から見ると
  //  各層の寄与 c×（その上の「不透明度つき」層の (1-a) の積 T）の和と同じ。T が 0（全面を覆う不透明な層）になったら、その下の層の
  //  texture 読みと計算を省いて終わる。加算の層は T を変えない。浮動小数の丸めの順が変わるだけで、8bit の結果は同等。
  if (front) {
    const blocks = Array.from({ length: SPLIT_N }, (_, k) => { const i = SPLIT_N - 1 - k; return `
        { vec3 q = uLM[${i}] * vec3(p, 1.0);
          if (uLP[${i}].x > 0.0 && q.x >= 0.0 && q.y >= 0.0 && q.x <= uLP[${i}].z && q.y <= uLP[${i}].w) {
            vec4 s = ${SAMPLE(i)};
            col += s.rgb * uLP[${i}].x * T;
            if (uLP[${i}].y <= 0.5) { T *= 1.0 - s.a * uLP[${i}].x; if (T <= 0.0) return min(col, vec3(1.0)); }
          } }`; }).join('\n');
    return { decl, body: `vec3 splitColor(vec2 vU) { vec2 p = vec2(vU.x * uCv.x, (1.0 - vU.y) * uCv.y); vec3 col = vec3(0.0); float T = 1.0;${blocks}
        return min(col, vec3(1.0)); }` };
  }
  return { decl, body: `vec3 splitColor(vec2 vU) { vec2 p = vec2(vU.x * uCv.x, (1.0 - vU.y) * uCv.y); vec3 col = vec3(0.0);${body}
        return min(col, vec3(1.0)); }` };
}

// layers: 上の仕様の配列 (長さ <= SPLIT_N) または null(分割描画を止める)
function setSplitLayers(u, layers) {
  if (!layers) { u.uSplit.value = 0; for (let i = 0; i < SPLIT_N; i++) { u.uLP.value[i].set(0, 0, 1, 1); u['uLt' + i].value = u.__dummy; } return; }
  u.uSplit.value = 1;
  const fz = layers[0]?.fuse;
  if (fz) {
    u.uFuse.value = 1; u.uFOv.value.set(fz.overlayOn ? 1 : 0, fz.hudOn ? 1 : 0, fz.flashA ?? 0, 0); u.uFRect.value.copy(fz.rect); u.uFFlash.value.copy(fz.flashRGB);
    u.uFOverlay.value = fz.overlay ?? u.__dummy; u.uFHud.value = fz.hud ?? u.__dummy;
  } else u.uFuse.value = 0;
  for (let i = 0; i < SPLIT_N; i++) {
    const L = layers[i];
    if (!L) { u.uLP.value[i].set(0, 0, 1, 1); u['uLt' + i].value = u.__dummy; continue; }
    // 配置: p = (x,y) + R(rot) * sc * (q - (ax,ay)) の逆 → q = (ax,ay) + R(-rot)(p - (x,y)) / sc
    const c = Math.cos(L.rot ?? 0), s = Math.sin(L.rot ?? 0), k = 1 / (L.sc ?? 1);
    const a = c * k, b = s * k, d = -s * k, e = c * k;   // q.x = a*dx + b*dy + ax ; q.y = d*dx + e*dy + ay
    const dx0 = -(L.x ?? 0), dy0 = -(L.y ?? 0);
    const tx = a * dx0 + b * dy0 + (L.ax ?? 0), ty = d * dx0 + e * dy0 + (L.ay ?? 0);
    // three の Matrix3.set は行優先
    u.uLM.value[i].set(a, b, tx, d, e, ty, 0, 0, 1);
    u.uLP.value[i].set(L.alpha ?? 1, L.add ? 1 : 0, L.w, L.h);
    u['uLt' + i].value = L.tex;
  }
}

// canvas を重ね合わせ用の texture にする(premultiplied、flipY)
export function layerTexture(T, source, { nearest = false } = {}) {
  const t = source instanceof HTMLVideoElement ? new T.VideoTexture(source) : source instanceof HTMLImageElement ? Object.assign(new T.Texture(source), { needsUpdate: true }) : new T.CanvasTexture(source);
  t.colorSpace = T.NoColorSpace; t.minFilter = t.magFilter = nearest ? T.NearestFilter : T.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.flipY = true; t.premultiplyAlpha = true;
  return t;
}

// 層を小さな render target(液晶 canvas と同じ 1240x1510, 8bit, sRGB 符号のまま)へ合成して、その texture を返す。
// 返した texture は液晶の板の uT へそのまま渡せる(他の GPU 面 compose() と同じ向き: 原点左下・上が v=1)。
// 10/31 変化のないコマの合成を省く（?splitskip=0 で従来、?splitskip=check は省ける場面でも描いて前回の中身と読み比べ、食い違いを stats.mismatch に数える検証用）。
// 層の見た目を決めるもの（各層の texture の id・version・source.version と、位置・拡大・回転・透明度・加算・大きさ）が前回の合成と同じなら、
// target の中身は前回のまま（target は合成器だけが描く）。texture が render target の絵（version が絵の更新を表さない）のときは常に描く。
// コンテキストの復帰・最初の 1 回も描く。
const splitParam = (k) => { try { return new URLSearchParams(globalThis.location?.search ?? '').get(k); } catch { return null; } };
const SPLIT_SKIP = splitParam('splitskip');
// 10/31 試験：?splitalt=1 は低性能時（照明の半頻度に入った／画質の段が low 以下）だけ、液晶の層の合成を 2 フレームに 1 回にする（動く層は 30Hz 更新）。
//  ?splitalt=2 は性能に関係なく常にそうする（確認用）。既定は無効。層の数・texture の id が変わったとき（画面の切り替わり）は省かず描く。
const SPLIT_ALT = splitParam('splitalt'), SPLIT_FRONT = splitParam('splitfront') !== '0';
// 11/1 描く範囲の限定（試験。既定は無効＝従来。?splitscissor=1 で有効、?splitscissor=check は限定した結果と全面描画を読み比べる検証用。効果は描く画素 -6〜9% に対し外側の消去が 3 割のコマで要るため採用せず）：層の外接矩形の外は黒のまま（描かない）。画素は全面描画と同じ。
const SPLIT_SCISSOR = splitParam('splitscissor');
// 層 i（位置・回転・拡大つき）の外接矩形。パネルを式に取り込んだ層 0 は窓 (34,28,1152,1268) の外が黒なので窓だけ。
function splitBounds(layers) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < SPLIT_N; i++) {
    const L = layers[i]; if (!L || !(((L.alpha ?? 1)) > 0)) continue;
    let qx0 = 0, qy0 = 0, qx1 = L.w, qy1 = L.h;
    if (i === 0 && L.fuse) { qx0 = 34; qy0 = 28; qx1 = 34 + 1152; qy1 = 28 + 1268; }
    const c = Math.cos(L.rot ?? 0), s = Math.sin(L.rot ?? 0), k = L.sc ?? 1, ax = L.ax ?? 0, ay = L.ay ?? 0, X = L.x ?? 0, Y = L.y ?? 0;
    for (const [qx, qy] of [[qx0, qy0], [qx1, qy0], [qx1, qy1], [qx0, qy1]]) {
      const dx = (qx - ax) * k, dy = (qy - ay) * k, px = X + c * dx - s * dy, py = Y + s * dx + c * dy;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2); x1 = Math.min(CANVAS_W, Math.ceil(x1) + 2); y1 = Math.min(CANVAS_H, Math.ceil(y1) + 2);
  return (x1 > x0 && y1 > y0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}
const SPLIT_FUSE = splitParam('lcdfuse');   // '0' で従来、'check' は新旧を両方描いて読み比べる（検証用）
const lowPerf = () => { const q = globalThis.window?.__prebakeRelight?.quality; return !!q && (q.lightHalf || q.index >= 2); };
export function createSplitCompositor(T, renderer, opts = {}) {
  const front = opts.front ?? SPLIT_FRONT, altMode = opts.alt ?? SPLIT_ALT;
  const u = splitUniforms(T), chunks = splitShaderChunks(front);
  const fuseOK = SPLIT_FUSE !== '0' && (renderer.capabilities?.maxTextures ?? 16) >= 15;   // 層 12 + overlay + HUD = 14 枚（WebGL の最小は 16）
  const skipMode = SPLIT_SKIP === '0' ? 'off' : SPLIT_SKIP === 'check' ? 'check' : 'on';
  const stats = { composed: 0, skipped: 0, checked: 0, mismatch: 0, mode: skipMode, front, alt: altMode ?? 'off', altSkipped: 0, stepN: 0, stepSum: 0, stepMax: 0, diffAt: {} };   // diffAt: 変化した項目の番号（1 + 13*層 + 0:id 1:version 2:source.version 3:alpha 4:add 5:w 6:h 7:rot 8:sc 9:ax 10:ay 11:x 12:y）の回数
  if (typeof window !== 'undefined') window.__splitSkipStats = stats;
  const prev = new Float64Array(SPLIT_N * 13 + 2); let prevValid = false, forceDraw = true, structural = true, lastAltSkip = false, backupValid = false;
  const prevBackup = new Float64Array(prev.length);
  const unchanged = (layers) => {   // prev を今の値に更新しながら、前回と同じか返す
    let i = 0, same = prevValid && !forceDraw, drawable = true;
    structural = !prevValid;
    const put = (v, st) => { if (prev[i] !== v) { prev[i] = v; same = false; if (st) structural = true; stats.diffAt[i] = (stats.diffAt[i] ?? 0) + 1; } i++; };
    put(layers.length, true);
    for (let k = 0; k < SPLIT_N; k++) {
      const L = layers[k], t = L?.tex;
      if (!L) { for (let j = 0; j < 13; j++) put(0, j === 0); continue; }
      if (!t || t.isRenderTargetTexture || typeof t.version !== 'number') { drawable = false; stats.undrawable = (stats.undrawable ?? 0) + 1; }
      if (prevValid && prev[i] === (t?.id ?? -1)) { const dx = (L.x ?? 0) - prev[i + 11], dy = (L.y ?? 0) - prev[i + 12], d = Math.hypot(dx, dy); if (d > 0) { stats.stepN++; stats.stepSum += d; if (d > stats.stepMax) stats.stepMax = d; } }   // 動く層の 1 回の更新での移動量（px）：隔フレームだと約 2 倍
      put(t?.id ?? -1, true); put(t?.version ?? -1); put(t?.source?.version ?? -1);
      put(L.alpha ?? 1); put(L.add ? 1 : 0); put(L.w ?? 0); put(L.h ?? 0); put(L.rot ?? 0); put(L.sc ?? 1); put(L.ax ?? 0); put(L.ay ?? 0); put(L.x ?? 0); put(L.y ?? 0);
    }
    prevValid = true;
    return same && drawable;
  };
  try { renderer.domElement?.addEventListener('webglcontextrestored', () => { forceDraw = true; }); } catch {}
  const target = new T.WebGLRenderTarget(CANVAS_W, CANVAS_H, { format: T.RGBAFormat, type: T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
  target.texture.colorSpace = T.NoColorSpace; target.texture.name = 'lcd-split-composite';
  const mat = new T.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false, dithering: false,
    vertexShader: 'varying vec2 vU; void main(){ vU = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vU; ${chunks.decl}\n${chunks.body}\nvoid main(){ gl_FragColor = vec4(splitColor(vU), 1.0); }`,
  });
  const scene = new T.Scene(), camera = new T.Camera();
  scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), mat));
  let disposed = false, before = null, lastBox = '';
  // 検証用：省ける場面で、描く前の target の中身(before)と描いた後を読み比べる
  const readTarget = () => { const a = new Uint8Array(CANVAS_W * CANVAS_H * 4); renderer.readRenderTargetPixels(target, 0, 0, CANVAS_W, CANVAS_H, a); return a; };
  const checkBefore = () => { try { before = readTarget(); } catch (e) { before = null; stats.checkError = String(e?.message ?? e); } };
  const checkAfter = () => {
    try {
      const after = readTarget(); stats.checked++;
      if (before) { let bad = 0; for (let j = 0; j < after.length; j++) if (after[j] !== before[j]) { bad++; if (bad > 50) break; } if (bad) { stats.mismatch++; (stats.samples ??= []).push(bad); } }
      before = null;
    } catch (e) { stats.checkError = String(e?.message ?? e); }
  };
  return {
    stats, fuseOK, fuseMode: SPLIT_FUSE ?? 'on',
    readBack: () => readTarget(),
    texture: target.texture,
    compose(layers) {
      if (disposed || !layers) return null;
      if (renderer.getRenderTarget() !== null) return null;   // フレーム境界(既定の描画先)でだけ
      if (altMode) { prevBackup.set(prev); backupValid = prevValid; }   // 隔フレームで省いたコマの値は「描いた内容」として覚えない
      const same = skipMode !== 'off' || altMode ? unchanged(layers) : false;
      if (same && skipMode === 'on') { stats.skipped++; lastAltSkip = false; return target.texture; }
      // 低性能時の隔フレーム合成（試験）：前回が描いたコマで、画面の切り替わり（層の数・texture の違い）でなければ、このコマは省く。連続で省かない。
      if (altMode && !structural && !forceDraw && !lastAltSkip && (altMode === '2' || (altMode === '1' && lowPerf()))) { stats.altSkipped++; lastAltSkip = true; prev.set(prevBackup); prevValid = backupValid; return target.texture; }
      lastAltSkip = false;
      if (same) checkBefore();
      setSplitLayers(u, layers);
      const state = { target: renderer.getRenderTarget(), viewport: renderer.getViewport(new T.Vector4()), scissor: renderer.getScissor(new T.Vector4()), test: renderer.getScissorTest(), color: renderer.getClearColor(new T.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear };
      try {
        renderer.autoClear = false; renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setViewport(0, 0, CANVAS_W, CANVAS_H);
        const bb = SPLIT_SCISSOR === '1' || SPLIT_SCISSOR === 'check' ? splitBounds(layers) : null, key = bb ? bb.join(',') : '';
        if (bb && (key !== lastBox || forceDraw)) {   // 範囲が変わったら全面を黒で消す（範囲が同じなら外側は前回から黒のまま）
          renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false); stats.scissorClears = (stats.scissorClears ?? 0) + 1;
        }
        lastBox = key;
        if (bb) { target.scissor.set(bb[0], CANVAS_H - bb[1] - bb[3], bb[2], bb[3]); target.scissorTest = true; renderer.setRenderTarget(target); stats.scissorPx = (stats.scissorPx ?? 0) + bb[2] * bb[3]; }
        renderer.render(scene, camera);
        target.scissorTest = false;
        if (bb && SPLIT_SCISSOR === 'check') {   // 検証：全面描画と読み比べる
          const a = readTarget(); lastBox = '';
          renderer.setRenderTarget(target); renderer.setViewport(0, 0, CANVAS_W, CANVAS_H); renderer.render(scene, camera); const f = readTarget();
          let bad = 0, mx = 0; for (let j = 0; j < a.length; j++) { const d = Math.abs(a[j] - f[j]); if (d) { bad++; if (d > mx) mx = d; } }
          stats.scissorChecked = (stats.scissorChecked ?? 0) + 1; if (bad) { stats.scissorMismatch = (stats.scissorMismatch ?? 0) + 1; stats.scissorBad = Math.max(stats.scissorBad ?? 0, bad); stats.scissorMax = Math.max(stats.scissorMax ?? 0, mx); }
        }
        stats.composed++; forceDraw = false;
      } finally {
        renderer.setRenderTarget(state.target); renderer.setViewport(state.viewport); renderer.setScissor(state.scissor); renderer.setScissorTest(state.test); renderer.setClearColor(state.color, state.alpha); renderer.autoClear = state.auto;
      }
      if (same) checkAfter();
      return target.texture;
    },
    dispose() { disposed = true; target.dispose(); mat.dispose(); },
  };
}
