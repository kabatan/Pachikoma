// R3-G の写し（元：work/upa_frame3d/m3/integration/launcher_body.mjs、R3-M4 m95）。足したのは 2 つだけ：
//  opts.now()：反動の時計をゲームの時計に（決定論の録画で R1・R2 のコマが正しく出る）。opts.getLight()：0〜4 灯のまぜを筐体の区画の強さから直接（canvas を読まない）。
// 射出器の動く部分（台車・レンズ・筒・首・爪）を、3D で描いた切り抜きの絵で重ねる（R3-M4 m95、work/game_demo/play/launcher_body.mjs の置き換え）。
// レール・端の台・ベルトは枠の絵に入っているので、ここでは描かない。呼び方は前と同じ：createLauncherBody({ stage, canvas, camera, xRange }).update(shuttle)
//  ・位置：シャトルの射出口（shuttle.position_m）を画面へ射影し、その x に絵の anchor_x、y に muzzle_y を合わせる。
//  ・見る角度：x の違う 5 か所で描いた絵のうち、近い 2 枚を不透明度でまぜる。
//  ・0 灯／4 灯：射出器のまわりの canvas の色（桃の強さ）を非同期に読み、4 灯の絵の不透明度にする（読めないときは opts.light か 0）。
//  ・状態：hasBall=true で L（爪が球をつかむ）。true→false の瞬間（撃った）に R1（0.05 秒、首が縮む・LED が光る）→ R2（0.06 秒）→ E（空）。
// ?nolauncher で無効（play.mjs 側のまま）。物理と凍結の静止像は変えない。
const STATES = ['L', 'E', 'R1', 'R2'], LIGHTS = ['0', '4'];
const T_R1 = 0.05, T_R2 = 0.06;
export function createLauncherBody({ stage, canvas, camera, xRange }, opts = {}) {
  const W = canvas.width, H = canvas.height;   // 1440×2560（canvas 内部座標）
  const base = opts.assetBase ?? new URL('../../../upa_frame3d/m3/integration/launcher_sprites/', import.meta.url).href;
  const el = document.createElement('div');
  el.dataset.launcher = 'm3';
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  stage.appendChild(el);
  const pct = (a, b) => `${a / b * 100}%`;
  let man = null, pos = [];                     // pos[i] = { p, box, img: {L:{0,4},...}, lay4: {L,...} }
  fetch(base + 'manifest.json').then(r => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}: ${base}`); return r.json(); }).then(m => {
    man = m;
    pos = m.positions.map(p => {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;display:none;width:${pct(p.w, W)};height:${pct(p.h, H)}`;
      const img = {};
      for (const s of STATES) {
        img[s] = {};
        for (const l of LIGHTS) {
          const im = new Image(); im.decoding = 'async'; im.src = `${base}p${p.i}_${s}_${l}.png`;
          im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
          box.appendChild(im); img[s][l] = im;
        }
      }
      el.appendChild(box);
      return { p, box, img };
    });
  }).catch(e => console.warn('[launcher] 絵を読めない', e));

  // まわりの桃の強さ（0 灯 ≈ 0、4 灯 ≈ 0.8）。前の版と同じく PBO へ非同期に読み、数フレーム後に受け取る（GPU 待ちで止めない）
  const gl = canvas.getContext('webgl2');
  let pbo = null, fence = null, rw = 0, rh = 0, frameNo = 0, light = opts.light ?? 0;
  const readLight = (cx, cy) => {
    if (opts.getLight) { light = Math.min(1, Math.max(0, opts.getLight())); return; }
    if (!gl || opts.light != null) return;
    try {
      if (fence) {
        if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
        gl.deleteSync(fence); fence = null;
        const buf = new Uint8Array(rw * rh * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        let r = 0, g = 0, b = 0; const n = rw * rh;
        for (let i = 0; i < n; i++) { r += buf[4 * i]; g += buf[4 * i + 1]; b += buf[4 * i + 2]; }
        const pink = (r - g) / Math.max(r, g, b, 1);
        const k = Math.min(1, Math.max(0, pink / 0.8));
        light += 0.35 * (k - light);
      } else if (frameNo++ % 4 === 0) {
        // 射出器の上と左右の枠（画面 y = 射出口 − 226 … −66、x = ±160）
        const sx = Math.max(0, Math.min(W - 8, Math.round(cx - 160))), sw = Math.min(320, W - sx);
        const top = Math.max(0, Math.round(cy - 226)), sh = Math.max(4, Math.min(160, H - top));
        const sy = Math.max(0, H - (top + sh));   // readPixels は左下が原点
        rw = sw; rh = sh;
        if (!pbo) pbo = gl.createBuffer();
        const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, sw * sh * 4, gl.STREAM_READ);
        gl.readPixels(sx, sy, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      }
    } catch { /* 読めないときは前の値のまま */ }
  };

  const v = camera.position.clone();
  const proj = (x, y, z) => { v.set(x, y, z).project(camera); return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H]; };
  let had = null, tFire = -1, shown = [];
  const setState = (P, s, op) => {
    for (const st of STATES) for (const l of LIGHTS) {
      const im = P.img[st][l], on = st === s && (l === '0' || light > 0.01);
      im.style.display = on ? '' : 'none';
      if (on && l === '4') im.style.opacity = light.toFixed(3);
    }
    P.box.style.opacity = op.toFixed(3);
  };
  return {
    update(shuttle) {
      if (!shuttle?.position_m || !man || !pos.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      const now = opts.now ? opts.now() : performance.now() / 1000;
      const has = !!shuttle.hasBall;
      if (had === true && !has) tFire = now;
      had = has;
      const dt = tFire < 0 ? 1e9 : now - tFire;
      const s = has ? 'L' : dt < T_R1 ? 'R1' : dt < T_R1 + T_R2 ? 'R2' : 'E';
      const [x, y, z] = shuttle.position_m, [cx, cy] = proj(x, y, z);
      readLight(cx, cy);
      // 近い 2 枚：下に a を不透明で、上に b を t で重ねる
      const xs = man.positions.map(p => p.x_px);
      let i = 0; while (i < xs.length - 2 && cx > xs[i + 1]) i++;
      const t = Math.min(1, Math.max(0, (cx - xs[i]) / (xs[i + 1] - xs[i])));
      const use = t < 0.02 ? [[i, 1]] : t > 0.98 ? [[i + 1, 1]] : [[i, 1], [i + 1, t]];
      for (const P of shown) if (!use.some(([j]) => pos[j] === P)) P.box.style.display = 'none';
      shown = [];
      use.forEach(([j, op], n) => {
        const P = pos[j], p = P.p;
        P.box.style.display = ''; P.box.style.zIndex = String(n);
        P.box.style.left = pct(cx - p.anchor_x, W);
        P.box.style.top = pct(cy - (man.muzzle_y - man.y0), H);
        setState(P, s, op); shown.push(P);
      });
    },
  };
}
