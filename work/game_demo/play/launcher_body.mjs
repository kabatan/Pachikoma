// 射出器の見える本体（レール・スライダ・筒・ノズル）。シャトルの位置(盤の玉と同じ assembly 座標)を画面へ射影して、
// canvas の上にDOMで重ねる。物理・凍結の静止像は変えない。?nolauncher で無効。
export function createLauncherBody({ stage, canvas, camera, xRange }) {
  const W = canvas.width, H = canvas.height;           // 1440×2560 (canvas 内部座標)
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  // 金属の色は、いま画面に出ている周りの光（canvasの射出器まわりの平均色）を拾って決める。浮いて見えないように。
  // 画面の読み戻しはGPUの完了待ちで10〜40ms止まるので、PBOへ非同期に読み、フェンスが立ってから(数フレーム後に)受け取る。
  const gl = canvas.getContext('webgl2');
  let pbo = null, fence = null, regionW = 0, regionH = 0;
  const GREY = [0.10, 0.50, 0.92, 0.58, 0.12], STOPS = [0, 22, 46, 70, 100];
  let tint = [0.7, 0.72, 0.78], lum = 0.3, frameNo = 0;
  const grad = (f, mult = 1) => 'linear-gradient(90deg,' + GREY.map((g, i) => `rgb(${tint.map(t => Math.round(255 * Math.min(1, f * mult * g * (0.5 + 0.5 * t)))).join(',')}) ${STOPS[i]}%`).join(',') + ')';
  const railGrad = (f) => 'linear-gradient(180deg,' + [[0.10, 0], [0.62, 40], [0.95, 55], [0.20, 100]].map(([g, o]) => `rgb(${tint.map(t => Math.round(255 * Math.min(1, f * g * (0.5 + 0.5 * t)))).join(',')}) ${o}%`).join(',') + ')';
  let metal = grad(0.5);
  const part = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;box-sizing:border-box;' + css; el.appendChild(d); return d; };
  const rail = part(`border-radius:3px;box-shadow:0 2px 5px #000a`);
  const slider = part(`border:1px solid #0008;border-radius:6px;box-shadow:0 3px 8px #000b`);
  const tube = part(`border-radius:4px 4px 2px 2px;box-shadow:0 3px 8px #000b`);
  const collar = part(`border:1px solid #0008;border-radius:3px 3px 8px 8px`);
  stage.appendChild(el);
  const v = camera.position.clone();
  const proj = (x, y, z) => { v.set(x, y, z).project(camera); return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H]; };
  const pct = (a, b) => `${a / b * 100}%`;
  const box = (d, x, y, w, h) => { d.style.left = pct(x - w / 2, W); d.style.top = pct(y, H); d.style.width = pct(w, W); d.style.height = pct(h, H); };
  return {
    update(shuttle) {
      if (!shuttle?.position_m) { el.style.display = 'none'; return; }
      el.style.display = '';
      const [x, y, z] = shuttle.position_m, [cx, cy] = proj(x, y, z);
      const [rx0] = proj(xRange[0], y, z), [rx1] = proj(xRange[1], y, z);
      const railY = cy - 168;
      if (gl) {
        try {
          if (fence) {   // 前回の読み出しが終わっていれば色を更新する（待たない）
            if (gl.clientWaitSync(fence, 0, 0) !== gl.TIMEOUT_EXPIRED) {
              gl.deleteSync(fence); fence = null;
              const buf = new Uint8Array(regionW * regionH * 4);
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
              let r = 0, g = 0, b = 0; const n = regionW * regionH;
              for (let i = 0; i < n; i++) { r += buf[4 * i]; g += buf[4 * i + 1]; b += buf[4 * i + 2]; }
              r /= 255 * n; g /= 255 * n; b /= 255 * n;
              const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, m = Math.max(r, g, b, 1e-3), k = 0.25;
              tint = tint.map((t, i) => t + k * ([r, g, b][i] / m - t)); lum += k * (L - lum);
              const f = 0.22 + 0.78 * Math.min(1, lum * 1.7);
              metal = 'linear-gradient(90deg,transparent 36%,rgba(255,255,255,.62) 43%,rgba(255,255,255,.12) 50%,transparent 56%),' + grad(f);
              for (const d2 of [slider, tube, collar]) d2.style.background = metal;
              rail.style.background = railGrad(f);
            }
          } else if (frameNo++ % 6 === 0) {   // 周りの色を6フレームに1回だけ読み始める（ゆっくり追従）
            const sx = Math.max(0, Math.min(W - 8, Math.round(cx - 130))), sw = Math.min(260, W - sx), sh = Math.max(4, Math.round(cy - railY));
            const sy = Math.max(0, Math.min(H - sh, Math.round(H - (railY - 20 + sh))));   // readPixelsは左下原点
            regionW = sw; regionH = sh;
            if (!pbo) pbo = gl.createBuffer();
            const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);   // three.jsの状態を乱さないよう、画面(null)から読んで元に戻す
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, sw * sh * 4, gl.STREAM_READ);
            gl.readPixels(sx, sy, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
            fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
          }
        } catch { /* 読めないときは前の色のまま */ }
      }
      const r = 26;                                    // 玉の半径(canvas px)
      box(rail, (rx0 + rx1) / 2, railY, Math.abs(rx1 - rx0) + 110, 9);
      box(slider, cx, railY - 9, 96, 30);
      box(tube, cx, railY + 18, 38, cy - r - 24 - railY - 18);
      box(collar, cx, cy - r - 24, 54, 24);
    },
  };
}
