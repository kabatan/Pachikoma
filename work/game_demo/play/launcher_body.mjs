// 射出器の見える本体（レール・スライダ・筒・ノズル）。シャトルの位置(盤の玉と同じ assembly 座標)を画面へ射影して、
// canvas の上にDOMで重ねる。物理・凍結の静止像は変えない。?nolauncher で無効。
export function createLauncherBody({ stage, canvas, camera, xRange }) {
  const W = canvas.width, H = canvas.height;           // 1440×2560 (canvas 内部座標)
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  // 金属の色は、いま画面に出ている周りの光（canvasの射出器まわりの平均色）を拾って決める。浮いて見えないように。
  const probe = document.createElement('canvas'); probe.width = 4; probe.height = 2;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
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
      if (frameNo++ % 3 === 0) {   // 周りの色を3フレームに1回だけ拾う（ゆっくり追従）
        try {
          pctx.drawImage(canvas, Math.max(0, cx - 130), railY - 20, 260, cy - railY, 0, 0, 4, 2);
          const d = pctx.getImageData(0, 0, 4, 2).data; let r = 0, g = 0, b = 0;
          for (let i = 0; i < 8; i++) { r += d[4 * i]; g += d[4 * i + 1]; b += d[4 * i + 2]; }
          r /= 2040; g /= 2040; b /= 2040;
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, m = Math.max(r, g, b, 1e-3), k = 0.25;
          tint = tint.map((t, i) => t + k * ([r, g, b][i] / m - t)); lum += k * (L - lum);
          const f = 0.22 + 0.78 * Math.min(1, lum * 1.7);
          metal = 'linear-gradient(90deg,transparent 36%,rgba(255,255,255,.62) 43%,rgba(255,255,255,.12) 50%,transparent 56%),' + grad(f);
          for (const d2 of [slider, tube, collar]) d2.style.background = metal;
          rail.style.background = railGrad(f);
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
