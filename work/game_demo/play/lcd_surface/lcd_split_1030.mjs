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
  return u;
}

function splitShaderChunks() {
  const decl = 'uniform float uSplit; uniform vec2 uCv; uniform mat3 uLM[' + SPLIT_N + ']; uniform vec4 uLP[' + SPLIT_N + ']; ' + Array.from({ length: SPLIT_N }, (_, i) => 'uniform sampler2D uLt' + i + ';').join(' ');
  const body = Array.from({ length: SPLIT_N }, (_, i) => `
        { vec3 q = uLM[${i}] * vec3(p, 1.0);
          if (uLP[${i}].x > 0.0 && q.x >= 0.0 && q.y >= 0.0 && q.x <= uLP[${i}].z && q.y <= uLP[${i}].w) {
            vec4 s = texture2D(uLt${i}, vec2(q.x / uLP[${i}].z, 1.0 - q.y / uLP[${i}].w));
            if (uLP[${i}].y > 0.5) col += s.rgb * uLP[${i}].x; else col = col * (1.0 - s.a * uLP[${i}].x) + s.rgb * uLP[${i}].x;
          } }`).join('\n');
  return { decl, body: `vec3 splitColor(vec2 vU) { vec2 p = vec2(vU.x * uCv.x, (1.0 - vU.y) * uCv.y); vec3 col = vec3(0.0);${body}
        return min(col, vec3(1.0)); }` };
}

// layers: 上の仕様の配列 (長さ <= SPLIT_N) または null(分割描画を止める)
function setSplitLayers(u, layers) {
  if (!layers) { u.uSplit.value = 0; for (let i = 0; i < SPLIT_N; i++) { u.uLP.value[i].set(0, 0, 1, 1); u['uLt' + i].value = u.__dummy; } return; }
  u.uSplit.value = 1;
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
export function createSplitCompositor(T, renderer) {
  const u = splitUniforms(T), chunks = splitShaderChunks();
  const target = new T.WebGLRenderTarget(CANVAS_W, CANVAS_H, { format: T.RGBAFormat, type: T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
  target.texture.colorSpace = T.NoColorSpace; target.texture.name = 'lcd-split-composite';
  const mat = new T.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false, dithering: false,
    vertexShader: 'varying vec2 vU; void main(){ vU = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vU; ${chunks.decl}\n${chunks.body}\nvoid main(){ gl_FragColor = vec4(splitColor(vU), 1.0); }`,
  });
  const scene = new T.Scene(), camera = new T.Camera();
  scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), mat));
  let disposed = false;
  return {
    texture: target.texture,
    compose(layers) {
      if (disposed || !layers) return null;
      if (renderer.getRenderTarget() !== null) return null;   // フレーム境界(既定の描画先)でだけ
      setSplitLayers(u, layers);
      const state = { target: renderer.getRenderTarget(), viewport: renderer.getViewport(new T.Vector4()), scissor: renderer.getScissor(new T.Vector4()), test: renderer.getScissorTest(), color: renderer.getClearColor(new T.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear };
      try {
        renderer.autoClear = false; renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setViewport(0, 0, CANVAS_W, CANVAS_H);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(state.target); renderer.setViewport(state.viewport); renderer.setScissor(state.scissor); renderer.setScissorTest(state.test); renderer.setClearColor(state.color, state.alpha); renderer.autoClear = state.auto;
      }
      return target.texture;
    },
    dispose() { disposed = true; target.dispose(); mat.dispose(); },
  };
}
