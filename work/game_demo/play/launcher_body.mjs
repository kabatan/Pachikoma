// 射出器の見える本体（レール・スライダ・筒・ノズル）。シャトルの位置(盤の玉と同じ assembly 座標)を画面へ射影して、
// canvas の上にDOMで重ねる。物理・凍結の静止像は変えない。?nolauncher で無効。
export function createLauncherBody({ stage, canvas, camera, xRange }) {
  const W = canvas.width, H = canvas.height;           // 1440×2560 (canvas 内部座標)
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  const metal = 'linear-gradient(90deg,#15181e 0%,#8d939e 22%,#f1f4f9 46%,#9aa0ab 70%,#1b1e25 100%)';
  const part = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;box-sizing:border-box;' + css; el.appendChild(d); return d; };
  const rail = part(`background:linear-gradient(180deg,#1a1d23,#aeb4bf 40%,#e9edf3 55%,#3a3f49);border-radius:3px;box-shadow:0 2px 5px #000a`);
  const slider = part(`background:${metal};border:1px solid #0008;border-radius:6px;box-shadow:0 3px 8px #000b`);
  const tube = part(`background:${metal};border-radius:4px 4px 2px 2px;box-shadow:0 3px 8px #000b`);
  const collar = part(`background:${metal};border:1px solid #0008;border-radius:3px 3px 8px 8px`);
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
      const r = 26;                                    // 玉の半径(canvas px)
      box(rail, (rx0 + rx1) / 2, railY, Math.abs(rx1 - rx0) + 110, 9);
      box(slider, cx, railY - 9, 96, 30);
      box(tube, cx, railY + 18, 38, cy - r - 24 - railY - 18);
      box(collar, cx, cy - r - 24, 54, 24);
    },
  };
}
