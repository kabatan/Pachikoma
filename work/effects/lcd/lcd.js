/* 中心液晶の演出ランタイム(Canvas2D, 1280x720)。
 * - 通常画面(水中の桜 = NormalScreen)を土台に、イベントごとの「シーン」を重ねる。
 * - シーンは scenes/*.js が LCD.scene({id,dur,assets,start,draw}) で登録する。時間は events.json の基準秒(JPの配当別の倍率はランタイムが掛け戻す)。
 * - ホスト(ステージ/ゲーム)は LCD.init → LCD.cue(cue) / LCD.play(id,params) → 毎フレーム LCD.update(dt); LCD.render(ctx,w,h)。
 * DOM依存は init の素材読み込みだけ。文字・光は素材PNG(3層の文字、フリップブック)+Canvas2Dの加算合成で作る。
 */
(function (root) {
  'use strict';
  const W = 1280, H = 720, TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIn = (x) => clamp(x) * clamp(x);
  const easeOutBack = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeInOut = (x) => (x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const env = (t, a, b, inD = .2, outD = .3) => Math.min(smooth((t - a) / inD), smooth((b - t) / outD));
  function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const HUES = [0, 190, 70, 285, 140, 35, 235];   // ウパの色(ピンク,水色,黄,紫,緑,オレンジ,青)

  const LCD = { W, H, clamp, lerp, smooth, easeOut, easeIn, easeOutBack, easeInOut, env, rng, HUES, TAU,
    defs: {}, active: [], t: 0, uid: 1, seen: new Set(), img: {}, flipInfo: {}, flipImg: {}, index: null, rootUrl: '/', base: null, ready: false,
    state: { n: 0, nDisp: 0, rank: 2, hold: 18, sec: 100, first: {} }, cam: { shake: 0, shakeMax: 0, shakeT: 0, punch: 0, pv: 0 },
    flashA: 0, flashC: '#fff', flashLog: [], overlays: [] };
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (cv) { cv.width = W; cv.height = H; }
  LCD.cv = cv; LCD.ctx = cv && cv.getContext('2d');
  if (LCD.ctx && /[?&]lcdcanvas=1\b/.test(location.search)) LCD.ctx.imageSmoothingQuality = 'medium';   // (試験用)キャンバス素材は縮小時にミップが効かないため

  // ───────── 素材 ─────────
  // 素材は復号済みのキャンバスに焼いて持つ。<img> のままだと、素材全体(復号後 約0.7GB)がブラウザの復号キャッシュに収まらず、シーンが替わるたびに
  // 追い出された素材をPNGデコードし直して数十ms止まる(work/game_demo/perf/PERF_lcd_assets.md)。?lcdcanvas=1 で有効(試験用)。
  const KEEP_CANVAS = typeof location !== 'undefined' && /[?&]lcdcanvas=1\b/.test(location.search);   // 既定は従来どおり<img>(キャンバス保持は縮小描画の補間が変わるため、画の確認が済むまで選択式)
  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load ' + url)); im.src = url; })
      .then(async (im) => {
        if (!KEEP_CANVAS || im.naturalWidth * im.naturalHeight < 16384) return im;   // 小さい素材は<img>のまま
        try { await im.decode(); } catch {}
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
        return c;
      });
  }
  LCD.url = (name) => { const p = LCD.index.images[name]; if (!p) throw new Error('no asset ' + name); return LCD.rootUrl + p; };
  LCD.has = (name) => !!(LCD.index && LCD.index.images[name]);
  LCD.load = async (names) => {
    await Promise.all(names.map(async (n) => {
      if (n.startsWith('flip:')) { const id = n.slice(5); if (LCD.flipImg[id]) return; const f = LCD.index.flip[id]; if (!f) throw new Error('no flip ' + id); LCD.flipInfo[id] = f; LCD.flipImg[id] = await loadImage(LCD.rootUrl + f.url); return; }
      if (LCD.img[n]) return; if (!LCD.has(n)) { console.warn('missing asset', n); return; }
      LCD.img[n] = await loadImage(LCD.url(n));
    }));
  };
  LCD.init = async function (opt = {}) {
    LCD.rootUrl = opt.root || '/';
    LCD.index = await (await fetch(LCD.rootUrl + 'work/effects/lcd/asset_index.json')).json();
    const core = ['glow_soft.png', 'spark.png', 'sprite_calm.png', 'sprite_smile.png', 'sprite_happy.png', 'rays_soft.png', 'flare_ring.png', 'flare_streak.png', 'glint_1.png', 'glint_2.png', 'glint_3.png', 'bokeh_disc.png', 'petal_1.png', 'petal_2.png', 'petal_3.png', 'petal_4.png', 'ember.png'];
    await LCD.load(core);
    if (opt.base !== false && root.LCD_BASE) { try { LCD.base = await root.LCD_BASE(LCD.rootUrl + LCD.index.normal_manifest); } catch (e) { console.warn('base failed', e); } }
    const need = new Set(); for (const id of (opt.scenes || Object.keys(LCD.defs))) (LCD.defs[id]?.assets || []).forEach((a) => need.add(a));
    await LCD.load([...need]);
    for (const h of LCD.initHooks || []) { try { await h(opt); } catch (e) { console.warn('init hook failed', e); } }
    LCD.ready = true; return LCD;
  };

  // 色付き(乗算)の複製。素材は白〜灰の光が多いので、色を掛けて使う
  const tintCache = new Map();
  LCD.tinted = (name, color) => {
    const k = name + '|' + color; if (tintCache.has(k)) return tintCache.get(k);
    const im = LCD.img[name]; if (!im) return null;
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d');
    g.drawImage(im, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(im, 0, 0); tintCache.set(k, c); return c;
  };
  // 画像を描く。blend: 'add' | 'screen' | 'normal'。基準は中心。w,h省略時は画像の大きさ×s
  LCD.blit = (c, name, x, y, o = {}) => {
    const src = o.tint ? LCD.tinted(name, o.tint) : LCD.img[name]; if (!src) return;
    const s = o.s ?? 1, w = (o.w ?? src.width) * s, h = (o.h ?? src.height) * s, ax = o.ax ?? .5, ay = o.ay ?? .5;
    c.save(); c.globalAlpha = clamp(o.a ?? 1);
    c.globalCompositeOperation = o.blend === 'add' ? 'lighter' : o.blend === 'screen' ? 'screen' : 'source-over';
    c.translate(x, y); if (o.rot) c.rotate(o.rot); if (o.fx) c.scale(o.fx, o.fy ?? 1);
    c.drawImage(src, -w * ax, -h * ay, w, h); c.restore();
  };
  LCD.add = (c, name, x, y, o = {}) => LCD.blit(c, name, x, y, { ...o, blend: 'add' });
  // フリップブック(フレームは中心に描く。sは元の大きさに対する倍率)
  LCD.flip = (c, id, t, x, y, o = {}) => {
    const f = LCD.flipInfo[id], im = LCD.flipImg[id]; if (!f || !im || t < 0) return false;
    let fr = Math.floor(t * f.fps * (o.speed ?? 1)); if (f.loop || o.loop) fr %= f.frames; else if (fr >= f.frames) return false;
    const sx = (fr % f.cols) * f.fw, sy = Math.floor(fr / f.cols) * f.fh, s = o.s ?? 1;
    c.save(); c.globalAlpha = clamp(o.a ?? 1); c.globalCompositeOperation = o.blend === 'normal' ? 'source-over' : 'lighter';
    c.translate(x, y); if (o.rot) c.rotate(o.rot);
    c.drawImage(im, sx, sy, f.fw, f.fh, -f.fw * s * .5, -f.fh * s * .5, f.fw * s * (o.sx ?? 1), f.fh * s); c.restore(); return true;
  };
  LCD.flipDur = (id) => { const f = LCD.flipInfo[id]; return f ? f.frames / f.fps : 0; };

  // 3層の文字(影→外光→本体)。key='dup' なら t_dup_* を先に、無ければ rl_t_dup_* を使う
  LCD.title = (c, key, x, y, o = {}) => {
    const nm = (q) => (LCD.img['t_' + key + '_' + q + '.png'] ? 't_' : 'rl_t_') + key + '_' + q + '.png';
    const s = o.s ?? .6, a = o.a ?? 1, rot = o.rot ?? 0;
    if (o.shadowA !== 0) LCD.blit(c, nm('shadow'), x + (o.sx ?? 0), y + (o.sy ?? 10 * s), { s, a: a * (o.shadowA ?? .8), rot });
    LCD.blit(c, nm('glow'), x, y, { s: s * (o.glowS ?? 1), a: a * (o.glowA ?? 1), blend: 'add', rot });
    LCD.blit(c, nm('face'), x, y, { s, a, rot, fx: o.fx, fy: o.fy });
  };

  // 文字素材(t_<key>_*.png か rl_t_<key>_*.png)があればそれを、無ければ代わりの文字列を描く
  LCD.hasTitle = (key) => !!(LCD.img['t_' + key + '_face.png'] || LCD.img['rl_t_' + key + '_face.png']);
  LCD.titleOr = (c, key, fallback, x, y, o = {}) => {
    if (LCD.hasTitle(key)) return LCD.title(c, key, x, y, o);
    LCD.text(c, fallback, x, y, { size: (o.size ?? 150) * (o.s ?? .6) / .6, a: o.a, fill1: o.fill1 ?? '#fff6c8', fill2: o.fill2 ?? '#ffb21e', glow: o.glow ?? '#ff9a1a', stroke: o.stroke });
  };
  // ───────── 演出の部品 ─────────
  LCD.shake = (amp, dur = .4) => { const k = LCD.cam, cur = k.shakeT > 0 ? k.shake * (k.shakeT / Math.max(k.shakeMax, 1e-3)) : 0; if (amp >= cur) { k.shake = amp; k.shakeMax = dur; k.shakeT = dur; } };
  LCD.punch = (z = .05) => { LCD.cam.pv += z * 14; };
  // 全画面の強い明滅は1秒に3回まで(光過敏対策)。超える分は弱める
  LCD.flash = (a, color = '#fff', decay = 6) => {
    const now = LCD.t; LCD.flashLog = LCD.flashLog.filter((x) => now - x < 1);
    if (a > .55) { if (LCD.flashLog.length >= 3) a = .35; else LCD.flashLog.push(now); }
    if (a > LCD.flashA) { LCD.flashA = a; LCD.flashC = color; } LCD.flashDecay = decay;
  };
  LCD.vignette = (c, a = .5, color = '0,0,0') => {
    const g = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95); g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(1, `rgba(${color},${clamp(a)})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  };
  LCD.fill = (c, color, a = 1) => { c.save(); c.globalAlpha = clamp(a); c.fillStyle = color; c.fillRect(0, 0, W, H); c.restore(); };
  LCD.dim = (c, a, color = '#02040c') => LCD.fill(c, color, a);
  // 放射する光の筋
  LCD.rays = (c, x, y, o = {}) => {
    const n = o.n ?? 18, len = o.len ?? 1200, a = o.a ?? .5, rot = o.rot ?? 0, w = o.w ?? .12, col = o.color ?? '255,236,190';
    c.save(); c.globalCompositeOperation = 'lighter'; c.translate(x, y); c.rotate(rot);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, len); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    for (let i = 0; i < n; i++) { const an = i / n * TAU, hw = (TAU / n) * w * (.5 + .5 * Math.sin(i * 12.9898)); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, len, an - hw, an + hw); c.closePath(); c.fill(); }
    c.restore();
  };
  LCD.radial = (c, x, y, r, color = '255,255,255', a = 1, blend = 'lighter') => {
    c.save(); c.globalCompositeOperation = blend; const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(.4, `rgba(${color},${a * .35})`); g.addColorStop(1, `rgba(${color},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  };
  // 粒子
  LCD.particles = (max = 400, seed = 1) => {
    const P = { list: [], rand: rng(seed), max };
    P.emit = (o) => { if (P.list.length >= max) P.list.shift(); P.list.push({ x: o.x, y: o.y, vx: o.vx ?? 0, vy: o.vy ?? 0, ax: o.ax ?? 0, ay: o.ay ?? 0, drag: o.drag ?? 0, life: o.life ?? 1, age: 0, s0: o.s0 ?? 1, s1: o.s1 ?? o.s0 ?? 1, a0: o.a0 ?? 1, a1: o.a1 ?? 0, rot: o.rot ?? 0, vr: o.vr ?? 0, img: o.img ?? 'glow_soft.png', tint: o.tint, blend: o.blend ?? 'add', flutter: o.flutter ?? 0, ph: P.rand() * TAU }); };
    P.step = (dt) => { for (const p of P.list) { p.age += dt; p.vx += p.ax * dt; p.vy += p.ay * dt; if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; } p.x += p.vx * dt + (p.flutter ? Math.sin(p.age * 3 + p.ph) * p.flutter * dt : 0); p.y += p.vy * dt; p.rot += p.vr * dt; } P.list = P.list.filter((p) => p.age < p.life); };
    P.draw = (c) => { for (const p of P.list) { const u = p.age / p.life; LCD.blit(c, p.img, p.x, p.y, { s: lerp(p.s0, p.s1, u), a: lerp(p.a0, p.a1, u), rot: p.rot, blend: p.blend, tint: p.tint }); } };
    return P;
  };
  // ウパ(ドット絵。整数倍・最近傍・反転/回転なし・顔の向きは固定)。hue: 数値(度) | 'rainbow'
  const upaCache = new Map();
  function recolorPixels(src, hueFn) {
    const out = new Uint8ClampedArray(src.data);
    for (let i = 0, p = 0; i < out.length; i += 4, p++) {
      if (out[i + 3] === 0) continue;
      const x = p % src.w; const deg = hueFn(x); if (!deg) continue;
      let r = out[i] / 255, g = out[i + 1] / 255, b = out[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
      if (d < .05 || l < .16) continue;
      let h = 0; const s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h = (((h * 60 + deg) % 360) + 360) % 360 / 60; const cc = (1 - Math.abs(2 * l - 1)) * s, xx = cc * (1 - Math.abs(h % 2 - 1)), m = l - cc / 2;
      const rgb = [[cc, xx, 0], [xx, cc, 0], [0, cc, xx], [0, xx, cc], [xx, 0, cc], [cc, 0, xx]][Math.floor(h) % 6];
      out[i] = (rgb[0] + m) * 255; out[i + 1] = (rgb[1] + m) * 255; out[i + 2] = (rgb[2] + m) * 255;
    }
    return out;
  }
  function spriteData(mood) { const k = 'd' + mood; if (upaCache.has(k)) return upaCache.get(k); const im = LCD.img['sprite_' + mood + '.png']; const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = { data: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height }; upaCache.set(k, d); return d; }
  LCD.upaCanvas = (mood = 'calm', hue = 0, t = 0) => {
    const sd = spriteData(mood);
    if (hue === 'rainbow') { const c = document.createElement('canvas'); c.width = sd.w; c.height = sd.h; const g = c.getContext('2d'); const out = recolorPixels(sd, (x) => ((x * 7.5 + t * 140) % 360) || 1); g.putImageData(new ImageData(out, sd.w, sd.h), 0, 0); return c; }
    const k = mood + '|' + hue; if (upaCache.has(k)) return upaCache.get(k);
    const c = document.createElement('canvas'); c.width = sd.w; c.height = sd.h; const g = c.getContext('2d'); g.putImageData(new ImageData(recolorPixels(sd, () => hue), sd.w, sd.h), 0, 0); upaCache.set(k, c); return c;
  };
  LCD.upa = (c, x, y, o = {}) => {
    const sc = Math.max(1, Math.round(o.scale ?? 6)), src = LCD.upaCanvas(o.mood ?? 'calm', o.hue ?? 0, o.t ?? 0);
    c.save(); c.imageSmoothingEnabled = false; c.globalAlpha = clamp(o.a ?? 1);
    const w = src.width * sc, h = src.height * sc; c.drawImage(src, Math.round(x - w / 2), Math.round(y - h / 2), w, h); c.restore();
  };

  // ---- 通常画面のウパ: 色とりどりの大きなウパが灯の数だけ泳ぐ(元の計画 anim/upa_swim の動き: ひとかき→滑走、休み、ダッシュ、壁で反射、近づくと離れる) ----
  const swim = LCD.swim = { list: [], sc: 7, n: -1 };
  const swRnd = (a, b) => a + Math.random() * (b - a), swAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  function swimNew(i, enter) {
    const w = 46 * swim.sc, u = { i, w, h: 21 * swim.sc, x: swRnd(.2, .8) * W, y: swRnd(.3, .85) * H, ang: swRnd(0, TAU), tang: 0, sp: 0, base: swRnd(.85, 1.15), phase: Math.random(), freq: swRnd(.9, 1.1), mode: 'swim', t: 0, dur: swRnd(1, 3), kk: 0, wob: Math.random() * 10, sx: 1, sy: 1, tilt: 0, enter: 0, leaving: false };
    u.tang = u.ang;
    if (enter) { const side = Math.random() < .5 ? -1 : 1; u.x = side < 0 ? -w * .6 : W + w * .6; u.y = swRnd(.35, .8) * H; u.ang = u.tang = side < 0 ? swRnd(-.3, .3) : Math.PI + swRnd(-.3, .3); u.enter = 2.2; u.mode = 'swim'; u.dur = 2.2; }
    return u;
  }
  swim.sync = (n) => {
    const want = clamp(Math.round(n), 0, 6); swim.n = want;   // 0灯はウパ0匹(最初の1灯で1匹目が出る)
    const alive = swim.list.filter((u) => !u.leaving);
    for (let k = alive.length; k < want; k++) swim.list.push(swimNew(k, swim.list.length > 0));
    for (let k = alive.length - 1; k >= want; k--) { alive[k].leaving = true; alive[k].tang = alive[k].x < W / 2 ? Math.PI : 0; }
    alive.forEach((u, k) => { u.i = k; });
  };
  swim.update = (dt) => {
    const L = swim.list;
    for (const u of L) {
      u.t += dt; const calm = .5;
      if (!u.leaving && u.enter <= 0 && u.t >= u.dur) {
        const r = Math.random() * 1.1, wRest = .1 + .45 * calm, wDash = .02 + .18 * (1 - calm);
        u.t = 0;
        if (r < wRest) { u.mode = 'rest'; u.dur = swRnd(.8, 2.2) * (.6 + calm); }
        else if (r < wRest + wDash) { u.mode = 'dash'; u.dur = swRnd(.5, .9); u.tang = swRnd(0, TAU); }
        else { u.mode = 'swim'; u.dur = swRnd(1, 3) * (.6 + calm); if (r < wRest + wDash + .3) u.tang = swRnd(0, TAU); }
      }
      if (u.enter > 0) { u.enter -= dt; if (u.enter <= 0) u.dur = 0; }
      const hz = (.7 + .9 * (1 - calm)) * u.freq * (u.mode === 'dash' ? 1.6 : 1);
      if (u.mode !== 'rest') u.phase = (u.phase + dt * hz) % 1;
      const ph = u.phase, kick = ph < .3 ? Math.sin(Math.PI * ph / .3) : 0, glide = ph >= .3 ? Math.exp(-(ph - .3) * 2.2) : 1;
      const cruise = (60 + 140 * (1 - calm)) * u.base;
      const target = u.mode === 'rest' ? cruise * .04 : u.mode === 'dash' ? cruise * (2.4 + .8 * kick) : cruise * (.12 + 1.2 * Math.max(kick, glide * .5));
      u.sp += (target - u.sp) * Math.min(1, dt * (u.mode === 'dash' ? 8 : 4));
      if (u.leaving) { u.sp = Math.max(u.sp, 160); }
      u.ang += swAng(u.ang, u.tang) * Math.min(1, dt * (u.mode === 'dash' ? 9 : 3));
      // 近づいた子は離れる(やんわり)
      for (const o of L) if (o !== u && !u.leaving) { const dx = u.x - o.x, dy = u.y - o.y, d = Math.hypot(dx, dy) || 1, m = (u.w + o.w) * .48; if (d < m) { u.x += dx / d * (m - d) * Math.min(1, dt * 2.5); u.y += dy / d * (m - d) * Math.min(1, dt * 2.5); u.tang = Math.atan2(dy, dx) * .5 + u.tang * .5; } }
      const vx = Math.cos(u.ang) * u.sp, vy = Math.sin(u.ang) * u.sp; u.x += vx * dt; u.y += vy * dt;
      if (!u.leaving && u.enter <= 0) {   // 壁で反射(土台の水の領域: 左上の灯の表示と右上の残り時間を避けて少し内側)
        const mx = u.w * .5, my = u.h * .5 + 30, x0 = mx - 40, x1 = W - mx + 40, y0 = my + 90, y1 = H - my + 10;
        if (u.x < x0) { u.x = x0; u.tang = Math.PI - u.tang; u.ang = Math.PI - u.ang; } else if (u.x > x1) { u.x = x1; u.tang = Math.PI - u.tang; u.ang = Math.PI - u.ang; }
        if (u.y < y0) { u.y = y0; u.tang = -u.tang; u.ang = -u.ang; } else if (u.y > y1) { u.y = y1; u.tang = -u.tang; u.ang = -u.ang; }
      }
      u.kk += ((u.mode === 'rest' ? 0 : kick) - u.kk) * Math.min(1, dt * 18); u.wob += dt * (u.mode === 'rest' ? 1.6 : 4.5);
      const spn = clamp(u.sp / (cruise * 1.6 + 1), 0, 1.4), idle = Math.sin(u.wob) * .035 * (u.mode === 'rest' ? 1 : .4), hx = Math.abs(Math.cos(u.ang)), hy = Math.abs(Math.sin(u.ang));
      const s = .26 * u.kk * clamp(spn + .3, 0, 1) - .1 * (1 - u.kk) * spn + idle; u.sx = 1 + s * hx - .7 * s * hy; u.sy = 1 + s * hy - .7 * s * hx;
      u.tilt += (clamp(vx / (cruise * 2.4 + 1), -1, 1) * .2 + Math.sin(ph * TAU) * .04 * spn - u.tilt) * Math.min(1, dt * 8);
    }
    swim.list = L.filter((u) => !(u.leaving && (u.x < -u.w || u.x > W + u.w)));
  };
  swim.draw = (c) => {
    const L = [...swim.list].sort((a, b) => a.y - b.y);
    for (const u of L) { const src = LCD.upaCanvas('calm', HUES[u.i % 7]), w = Math.round(src.width * swim.sc * u.sx), h = Math.round(src.height * swim.sc * u.sy);
      c.save(); c.imageSmoothingEnabled = false; c.translate(Math.round(u.x), Math.round(u.y)); c.rotate(u.tilt); c.drawImage(src, -w / 2, -h / 2, w, h); c.restore(); }
  };
  // 日本語の短い文(ヒント)。縁取りと影で背景の上でも読める
  LCD.font = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
  LCD.text = (c, str, x, y, o = {}) => {
    c.save(); const px = o.size ?? 44; c.font = `${o.weight ?? 900} ${px}px ${LCD.font}`; c.textAlign = o.align ?? 'center'; c.textBaseline = 'middle'; c.globalAlpha = clamp(o.a ?? 1);
    c.lineJoin = 'round'; c.lineWidth = o.stroke ?? px * .22; c.strokeStyle = o.strokeColor ?? 'rgba(20,10,50,.92)';
    if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = px * .5; }
    c.strokeText(str, x, y); c.shadowBlur = 0;
    const g = c.createLinearGradient(0, y - px / 2, 0, y + px / 2); g.addColorStop(0, o.fill1 ?? '#ffffff'); g.addColorStop(1, o.fill2 ?? o.fill1 ?? '#ffe6f2');
    c.fillStyle = g; c.fillText(str, x, y); c.restore();
  };
  // 矢印(下向き既定。dir: 'down'|'left'|'right'|'up')。ボタンの方向を指す
  LCD.arrow = (c, x, y, dir = 'down', t = 0, o = {}) => {
    const s = o.s ?? 1, bob = Math.sin(t * 7) * 8 * s; const rot = { down: 0, left: Math.PI / 2, up: Math.PI, right: -Math.PI / 2 }[dir];
    c.save(); c.translate(x, y); c.rotate(rot); c.translate(0, bob); c.globalAlpha = clamp(o.a ?? 1);
    c.shadowColor = o.glow ?? 'rgba(255,230,120,.9)'; c.shadowBlur = 28 * s; c.fillStyle = o.color ?? '#fff3b0'; c.strokeStyle = 'rgba(40,20,60,.95)'; c.lineWidth = 7 * s; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-26 * s, -52 * s); c.lineTo(26 * s, -52 * s); c.lineTo(26 * s, -6 * s); c.lineTo(52 * s, -6 * s); c.lineTo(0, 46 * s); c.lineTo(-52 * s, -6 * s); c.lineTo(-26 * s, -6 * s); c.closePath(); c.stroke(); c.shadowBlur = 0; c.fill(); c.restore();
  };

  // 既存APIを変えずに追加。透明な余白を除いた文字の実寸をキャッシュ。
  const titleBounds = new WeakMap();
  LCD.titleBounds = (im) => {
    if (titleBounds.has(im)) return titleBounds.get(im);
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let l = im.width, r = -1, top = im.height, bottom = -1;
    for (let yy = 0; yy < im.height; yy++) for (let xx = 0; xx < im.width; xx++) if (d[(yy * im.width + xx) * 4 + 3] > 32) { l = Math.min(l, xx); r = Math.max(r, xx); top = Math.min(top, yy); bottom = Math.max(bottom, yy); }
    const b = r < l ? { l: 0, r: im.width - 1, top: 0, bottom: im.height - 1 } : { l, r, top, bottom };
    titleBounds.set(im, b); return b;
  };
  // 文字素材と仮文字を同じ矩形に収める(既存title/titleOrの寸法規約は変えない)。
  LCD.titleFit = (c, key, fallback, x, y, o = {}) => {
    const im = LCD.img['t_' + key + '_face.png'] || LCD.img['rl_t_' + key + '_face.png'];
    const w = o.w ?? 900, h = o.h ?? 260, a = o.a ?? 1;
    if (im) {
      const b = LCD.titleBounds(im), s = Math.min(w / (b.r - b.l + 1), h / (b.bottom - b.top + 1)) * (o.zoom ?? 1);
      return LCD.title(c, key, x + (im.width / 2 - (b.l + b.r) / 2) * s, y + (im.height / 2 - (b.top + b.bottom) / 2) * s, { ...o, s });
    }
    c.save(); c.font = `900 100px ${LCD.font}`;
    const size = Math.min(h * .72, w / Math.max(1, c.measureText(fallback).width) * 100);
    c.translate(x, y); c.scale(o.zoom ?? 1, o.zoom ?? 1);
    LCD.titleOr(c, key, fallback, 0, 0, { ...o, s: .6, size, a }); c.restore();
  };
  // 数字素材が揃えば3層で組版。未着時には全体を仮文字で出す。
  LCD.number = (c, value, x, y, o = {}) => {
    const str = String(value), keys = [...str].map(ch => ({ '+': 'dg_plus', ',': 'dg_comma', '×': 'dg_x' }[ch] || 'dg' + ch));
    if (!keys.every(LCD.hasTitle)) return LCD.titleFit(c, '_number_pending', str, x, y, { ...o, h: o.h ?? 190 });
    const glyphs = keys.map(key => {
      const name = (LCD.img['t_' + key + '_face.png'] ? 't_' : 'rl_t_') + key + '_face.png', im = LCD.img[name];
      return { key, im, b: LCD.titleBounds(im) };
    });
    const ref = Math.max(...glyphs.map(g => g.b.bottom - g.b.top + 1)), gap = ref * .065;
    const total = glyphs.reduce((n, g) => n + g.b.r - g.b.l + 1 + gap, -gap);
    const s = Math.min((o.h ?? 190) / ref, (o.w ?? 900) / total) * (o.zoom ?? 1);
    let dx = x - total * s / 2;
    for (const g of glyphs) {
      const width = g.b.r - g.b.l + 1;
      LCD.title(c, g.key, dx + (g.im.width / 2 - g.b.l) * s, y + (g.im.height / 2 - (g.b.top + g.b.bottom) / 2) * s, { ...o, s });
      dx += (width + gap) * s;
    }
  };
  // 画面より手前の操作卓を指す、斜め下の矢印。
  LCD.buttonArrow = (c, x, y, side, t, o = {}) => {
    c.save(); c.translate(x, y); c.rotate(side === 'left' ? Math.PI / 4 : -Math.PI / 4);
    LCD.arrow(c, 0, 0, 'down', t, o); c.restore();
  };
  // 鏡面の金属球。暗い映り込み、帯状の環境光、接地影を重ねる。
  LCD.ball = (c, x, y, r, o = {}) => {
    c.save(); c.globalAlpha = clamp(o.a ?? 1);
    const shadow = c.createRadialGradient(x, y + r * .9, 0, x, y + r * .9, r * 1.3);
    shadow.addColorStop(0, 'rgba(0,0,0,.65)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = shadow; c.beginPath(); c.ellipse(x, y + r, r * 1.3, r * .35, 0, 0, TAU); c.fill();
    const g = c.createLinearGradient(x - r * .8, y - r, x + r * .45, y + r);
    const gold = o.gold !== false;
    (gold ? [[0,'#fffbdc'],[.16,'#ffe798'],[.32,'#b27112'],[.44,'#36200d'],[.51,'#fff2b0'],[.60,'#e8ad3b'],[.83,'#8a510c'],[1,'#fff0ad']] : [[0,'#fff'],[.2,'#dce9f4'],[.43,'#293344'],[.5,'#f5faff'],[.7,'#788ca7'],[1,'#e4efff']]).forEach(([p,col]) => g.addColorStop(p,col));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.save(); c.clip(); const rim = c.createRadialGradient(x-r*.3,y-r*.35,r*.05,x,y,r);
    rim.addColorStop(0,'rgba(255,255,255,.65)');rim.addColorStop(.5,'rgba(255,255,255,0)');rim.addColorStop(.88,'rgba(0,0,0,.25)');rim.addColorStop(1,'rgba(255,239,175,.8)');
    c.fillStyle = rim;c.fillRect(x-r,y-r,r*2,r*2);
    c.strokeStyle='rgba(255,255,240,.86)';c.lineWidth=Math.max(1,r*.07);c.beginPath();c.ellipse(x-r*.22,y-r*.42,r*.42,r*.12,-.4,0,TAU);c.stroke();c.restore();
    c.strokeStyle=gold?'#f7d77f':'#d4e6ff';c.lineWidth=Math.max(1,r*.025);c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();c.restore();
  };

  // ───────── シーンの登録と進行 ─────────
  LCD.scene = (def) => { LCD.defs[def.id] = def; return def; };
  LCD.play = (id, params = {}) => {
    const def = LCD.defs[id];
    if (!def) { LCD.play('_unmade', { ...params, of: id }); return 0; }
    if (def.single !== false) LCD.active = LCD.active.filter((s) => s.id !== id);
    const sc = { id, def, params, uid: LCD.uid++, t: 0, scale: params.scale || 1, S: {}, rand: rng((params.seed ?? 7) + LCD.uid) };
    if (def.assets) LCD.load(def.assets);                  // 遅れて読む場合に備える(通常は init で先読み)
    if (def.start) def.start(sc, params); LCD.active.push(sc); return sc.uid;
  };
  LCD.stop = (id) => { LCD.active = LCD.active.filter((s) => s.id !== id && s.uid !== id); };
  // 光バスの合図(lane=lcd)を受ける。同じ実行(uid)で最初の1回だけシーンを始める
  LCD.cue = (cue) => { if (cue.lane !== 'lcd') return; const k = cue.uid + ':' + cue.event; if (LCD.seen.has(k)) return; LCD.seen.add(k); LCD.play(cue.event, { ...(cue.params || {}), scale: cue.scale || 1 }); };
  // ゲームの規則から来る数値(貸玉・追加秒・賞の境目・JP配当)。ゲームが Effects.setState({rules}) で上書きする。ここは未指定時の既定
  LCD.defaultRules = { awards: [0, 1, 2, 3, 12, 30, 80], loanBalls: 18, extraSeconds: 50, thresholds: [2, 21, 42, 150, 775], jackpotAwards: [40, 80, 150, 300, 600] };
  // 皿に実際に着いた玉の数(調整側のハンドルがあるときだけ)。無ければ時間で進める値 fallback を使う
  LCD.landed = (total, fallback) => (LCD.state.trayLanded === undefined ? fallback : Math.max(0, Math.min(total, Math.floor(LCD.state.trayLanded))));
  LCD.rules = () => Object.assign({}, LCD.defaultRules, LCD.state.rules || {});
  LCD.setState = (s) => { Object.assign(LCD.state, s); if (LCD.base && s.nDisp !== undefined) LCD.base.setLamps(clamp(Math.round(s.nDisp), 0, 6)); };

  LCD.update = (dt) => {
    LCD.t += dt; const k = LCD.cam;
    if (k.shakeT > 0) k.shakeT -= dt;
    k.pv += (-k.punch * 220 - k.pv * 16) * dt; k.punch += k.pv * dt;   // ばね
    LCD.flashA = Math.max(0, LCD.flashA - (LCD.flashDecay || 6) * dt);
    if (LCD.base) { LCD.base.update(dt); }
    if (LCD.state.swimOn !== false && LCD.base) { const sn = Math.max(0, Math.round(LCD.state.nDisp ?? LCD.state.n ?? 0)); if (swim.n !== sn) swim.sync(sn); swim.update(dt); }
    for (const sc of LCD.active) { sc.dt = dt / sc.scale; sc.t += sc.dt; if (sc.def.update) sc.def.update(sc, sc.dt); }
    LCD.active = LCD.active.filter((s) => s.def.hold || s.t <= s.def.dur + .05);
  };
  LCD.render = (target, tw, th) => {
    const c = LCD.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    // 土台
    if (LCD.base) { LCD.base.render(); c.drawImage(LCD.base.canvas, 0, 0, W, H); if (LCD.state.swimOn !== false && LCD.swim.list.length) LCD.swim.draw(c); }
    else { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a3a7a'); g.addColorStop(1, '#05173a'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    // カメラ(揺れとパンチ)
    const k = LCD.cam, sh = k.shakeT > 0 ? k.shake * (k.shakeT / Math.max(k.shakeMax, 1e-3)) : 0, z = 1 + k.punch;
    c.translate(W / 2 + (Math.random() - .5) * 2 * sh, H / 2 + (Math.random() - .5) * 2 * sh); c.scale(z, z); c.translate(-W / 2, -H / 2);
    // 覆うシーンより前は描かない
    let first = 0; LCD.active.forEach((s, i) => { if (s.def.cover && s.t > (s.def.coverFrom ?? 0)) first = i; });
    for (let i = first; i < LCD.active.length; i++) { const sc = LCD.active[i]; c.save(); sc.def.draw(c, sc.t, sc, LCD); c.restore(); }
    c.restore();
    // 残り時間は遊技中ずっと右上に。warn10 は自前で同じ位置に描くので重ねない。ホスト未接続(sec無し)なら出さない。
    if (LCD.state.hudOn && typeof LCD.hud === 'function' && !LCD.active.some((s) => s.id === 'warn10')) { c.save(); LCD.hud(c, { sec: LCD.state.sec }); c.restore(); }
    c.save();
    if (LCD.flashA > .005) { c.globalAlpha = clamp(LCD.flashA); c.fillStyle = LCD.flashC; c.fillRect(0, 0, W, H); }
    c.restore();
    if (target) target.drawImage(LCD.cv, 0, 0, W, H, 0, 0, tw, th);
  };
  LCD.reset = () => { LCD.active = []; LCD.seen.clear(); LCD.flashA = 0; LCD.cam.shakeT = 0; LCD.cam.punch = 0; LCD.cam.pv = 0; };

  // 未制作の場面の代わり(正直に「未制作」と出す。ステージの確認用)
  LCD.scene({ id: '_unmade', dur: 1.6, draw(c, t, sc) { const a = env(t, 0, 1.6, .1, .4); c.save(); c.globalAlpha = a * .8; c.fillStyle = 'rgba(8,10,30,.55)'; c.fillRect(W / 2 - 420, 40, 840, 70); c.restore(); LCD.text(c, `(液晶は未制作)  ${sc.params.of}`, W / 2, 75, { size: 34, a, fill1: '#ffd2d8', fill2: '#ff9aa8' }); } });

  if (typeof module !== 'undefined' && module.exports) module.exports = LCD; else root.LCD = LCD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
