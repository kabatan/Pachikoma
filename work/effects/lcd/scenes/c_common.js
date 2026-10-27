/* グループC専用。lcd.js の公開APIだけを使う。素材待ちの文字は titleOr。
 * このファイルを c_*.js より先に読み込む。光バス/ゲームの状態は変更しない。 */
(function () {
  const { clamp, smooth, TAU } = LCD;
  const C = LCD.C = {};
  C.titleAssets = (...keys) => keys.flatMap(k => ['face', 'glow', 'shadow'].map(q => `t_${k}_${q}.png`));
  C.digitAssets = (rainbow = false) => C.titleAssets(...Array.from({ length: 10 }, (_, i) => `${rainbow ? 'dr' : 'dg'}${i}`), rainbow ? 'dr_plus' : 'dg_plus');
  C.assets = ['bg_gold.jpg', 'bg_night_sakura.jpg', 'bg_sakura.jpg', 'branch_tl.png', 'branch_tr.png', 'corner_gold_tl.png', 'corner_gold_tr.png', 'crest_sakura.png', 'crest_glow.png', 'petal_5.png', 'petal_6.png', 'petal_stream_1.png', 'ribbon_1.png', 'flip:impact_2', 'flip:digitburst_2', 'flip:petals_1'];
  C.total = v => Math.min(999999, Math.max(0, Math.floor(Number(v) || 0)));
  // lcd.js scans both alpha cutoffs (32 and 48) once and caches the pair per image.
  C.bounds = im => LCD.measureAlphaBounds(im).common;
  C.title = (c, key, fallback, x, y, w, h, o = {}) => {
    const im = LCD.img[`t_${key}_face.png`];
    const b = im && C.bounds(im), s = (im ? Math.min(w / b.w, h / b.h) : .6) * (o.zoom ?? 1);
    LCD.titleOr(c, key, fallback, x + (im ? (im.width / 2 - b.cx) * s : 0), y + (im ? (im.height / 2 - b.cy) * s : 0), { size: Math.min(h * .75, w / Math.max(2, fallback.length) * 1.5), ...o, s });
  };
  C.number = (c, n, x, y, height, rainbow = false, o = {}) => {
    const str = String(C.total(n)), prefix = rainbow ? 'dr' : 'dg';
    if (![...str].every(d => LCD.hasTitle(prefix + d))) {
      LCD.text(c, str, x, y, { size: Math.min(height * .8, (o.maxW || 900) / str.length * 1.5), fill1: '#fffef0', fill2: rainbow ? '#ff9fdc' : '#ffca48', glow: rainbow ? '#b55bff' : '#ffad25', ...o }); return;
    }
    const ims = [...str].map(d => LCD.img[`t_${prefix + d}_face.png`]);
    const bs = ims.map(C.bounds), rawW = bs.reduce((v, b) => v + (b.w / b.h + .045) * height, 0);
    const fit = Math.min(1, (o.maxW || 900) / rawW), widths = bs.map(b => (b.w / b.h + .045) * height * fit);
    let left = x - widths.reduce((v, w) => v + w, 0) / 2;
    [...str].forEach((d, i) => { const s = height / bs[i].h * fit; LCD.title(c, prefix + d, left + widths[i] / 2 + (ims[i].width / 2 - bs[i].cx) * s, y + (ims[i].height / 2 - bs[i].cy) * s, { s, a: o.a, glowA: .65 }); left += widths[i]; });
  };
  C.counter = (c, value, x, y, height, o = {}) => {
    const n = C.total(value), str = String(n);
    if (![...str].every(d => LCD.hasTitle('dg' + d))) { C.number(c, n, x, y, height, false, o); return; }
    // ドラムは整数に近い時間を長く取り、繰り上がる直前だけ次の数字へ送る。
    const cell = height * .79, fit = Math.min(1, (o.maxW || 900) / (cell * str.length)), h = height * fit, w = cell * fit;
    [...str].forEach((digit, i) => {
      const divisor = Math.pow(10, str.length - i - 1), phase = value % divisor;
      const f = divisor === 1 ? value % 1 : clamp(phase - (divisor - 1));
      const roll = smooth((f - .65) / .35), cx = x + (i - (str.length - 1) / 2) * w;
      c.save(); c.beginPath(); c.rect(cx - w / 2, y - h * .55, w, h * 1.1); c.clip();
      const draw = (d, cy) => { const im = LCD.img[`t_dg${d}_face.png`], b = C.bounds(im), s = h / b.h; LCD.title(c, 'dg' + d, cx + (im.width / 2 - b.cx) * s, cy + (im.height / 2 - b.cy) * s, { s, glowA: .55 }); };
      draw(digit, y - roll * h * 1.14);
      if (roll > 0) draw((Number(digit) + 1) % 10, y + (1 - roll) * h * 1.14);
      c.restore();
    });
  };
  // 全画面フラッシュは start/update の一回限りの合図だけ。draw は純粋描画。
  C.cues = (sc, cues) => { for (let i = 0; i < cues.length; i++) if (!sc.S.cues?.[i] && sc.t >= cues[i][0]) { (sc.S.cues ||= {})[i] = true; cues[i][1](); } };
  C.field = (c, t, o = {}) => {
    const rank = o.rank ?? 3, a = o.a ?? 1;
    c.save(); c.globalAlpha = a;
    LCD.blit(c, rank === 0 ? 'bg_sakura.jpg' : rank < 3 ? 'bg_night_sakura.jpg' : 'bg_gold.jpg', 640, 360, { w: 1480, h: 880 });
    // 揺れの間も背景と暗幕を画面外まで敷き、土台の細い帯を露出させない。
    c.save(); c.globalAlpha = rank === 0 ? .28 : .56; c.fillStyle = rank === 0 ? '#591937' : '#10071e'; c.fillRect(-100, -100, 1480, 920); c.restore();
    LCD.add(c, 'rays_soft.png', 640, 300, { w: 1300, h: 1000, rot: t * .065, a: rank === 0 ? .15 : .24 });
    LCD.add(c, 'crest_glow.png', 640, 300, { w: 630, h: 630, a: .3, rot: -t * .07 });
    LCD.blit(c, 'crest_sakura.png', 640, 300, { w: 500, h: 500, a: .11, rot: t * .04 });
    if (rank >= 4) C.rainbow(c, t, .2);
    LCD.blit(c, 'branch_tl.png', 0, 0, { w: 420, h: 315, ax: 0, ay: 0, a: .75 });
    LCD.blit(c, 'branch_tr.png', 1280, 0, { w: 420, h: 315, ax: 1, ay: 0, a: .75 });
    if (rank > 0) for (const right of [false, true]) LCD.blit(c, right ? 'corner_gold_tr.png' : 'corner_gold_tl.png', right ? 1280 : 0, 0, { w: 220, h: 220, ax: right ? 1 : 0, ay: 0, a: rank < 3 ? .45 : .9 });
    LCD.vignette(c, .5); c.restore();
  };
  C.rainbow = (c, t, a = .5) => {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const rot = t * .13 + i * .19, hue = i * 51 + t * 12;
      const g = c.createLinearGradient(140, 50, 1140, 630); g.addColorStop(0, `hsla(${hue},95%,70%,0)`); g.addColorStop(.3, `hsla(${hue},95%,70%,${a * .8})`); g.addColorStop(.75, `hsla(${hue + 60},95%,75%,${a})`); g.addColorStop(1, `hsla(${hue + 110},95%,75%,0)`);
      c.strokeStyle = g; c.lineWidth = i % 2 ? 8 : 3; c.beginPath(); c.ellipse(640, 340, 340 + i * 34, 240 + i * 24, Math.sin(t * .2) * .08, rot, rot + TAU * .76); c.stroke();
    } c.restore();
  };
  // 奥と手前の花吹雪・金粉。固定seedなので同じ時刻を再現できる。
  C.confetti = (c, t, n = 70, gold = false, a = 1) => {
    const rand = LCD.rng(824);
    for (let i = 0; i < n; i++) {
      const z = .3 + rand(), x = (rand() * 1500 + Math.sin(t * .9 + i) * 65 + t * (gold ? 18 : 32) * z) % 1500 - 110;
      const y = ((rand() * 1000 + t * (35 + z * 75)) % 1000) - 140;
      LCD.blit(c, gold && i % 3 ? 'spark.png' : `petal_${i % 6 + 1}.png`, x, y, { w: (gold && i % 3 ? 20 : 44) * z, h: (gold && i % 3 ? 20 : 32) * z, rot: t * (i % 2 ? .6 : -.4) + i, a: a * (.45 + .35 * z), blend: gold && i % 3 ? 'add' : 'normal', tint: gold && i % 3 ? '#ffda75' : undefined });
    }
  };
  C.ball = (c, x, y, r, a = 1) => {
    c.save(); c.globalAlpha = clamp(a); const g = c.createRadialGradient(x - r * .35, y - r * .4, r * .03, x, y, r);
    g.addColorStop(0, '#fff'); g.addColorStop(.22, '#ecfaff'); g.addColorStop(.48, '#adc4d9'); g.addColorStop(.7, '#465775'); g.addColorStop(.9, '#cadbe9'); g.addColorStop(1, '#59677c');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore();
  };
  C.team = (c, t, y, o = {}) => {
    const n = o.n ?? 7, scale = o.scale ?? 3;
    for (let i = 0; i < n; i++) { const x = 640 + (i - (n - 1) / 2) * (o.gap ?? 163), hop = Math.max(0, Math.sin(t * 5.6 - i * .65)) * (o.hop ?? 15);
      LCD.radial(c, x, y + 32, 90, '255,199,127', .2);
      LCD.upa(c, x, y - hop, { scale, hue: i === 6 && o.rainbow ? 'rainbow' : LCD.HUES[i], mood: 'happy', t, a: o.a ?? 1 });
      // 拍手の小さな金の光(ドット絵本体は一切変形しない)。
      if (hop > 8) LCD.add(c, 'glint_1.png', x + 45, y - 34, { w: 25, h: 25, a: .65 });
    }
  };
  // JP専用の重ね素材。通常のfield/timeup/resultの描き方は変えない。
  C.jpAssets = ['branch_bl.png', 'branch_br.png', 'edge_gold_h.png', 'ribbon_2.png', 'ribbon_3.png', 'mist_tile.png', 'plate_B6.png'];
  C.jpBackdrop = (c, t) => {
    LCD.blit(c, 'bg_gold.jpg', 640 + Math.sin(t * .23) * 14, 360, { w: 1530, h: 930 });
    c.save(); c.fillStyle = 'rgba(15,6,25,.64)'; c.fillRect(-150, -150, 1580, 1020); c.restore();
    LCD.add(c, 'rays_soft.png', 640, 310, { w: 1680, h: 1350, rot: t * .075, a: .29 });
    LCD.add(c, 'crest_glow.png', 640, 320, { w: 790, h: 790, rot: -t * .08, a: .24 });
    for (const [name, x, y, ax, ay] of [['branch_tl.png', 0, 0, 0, 0], ['branch_tr.png', 1280, 0, 1, 0], ['branch_bl.png', 0, 720, 0, 1], ['branch_br.png', 1280, 720, 1, 1]]) LCD.blit(c, name, x, y, { w: 410, h: 290, ax, ay, a: .8 });
    for (const right of [false, true]) LCD.blit(c, right ? 'corner_gold_tr.png' : 'corner_gold_tl.png', right ? 1280 : 0, 0, { w: 235, h: 235, ax: right ? 1 : 0, ay: 0 });
    for (const y of [12, 708]) LCD.blit(c, 'edge_gold_h.png', 640, y, { w: 1320, h: 40, a: .65 });
  };
  C.jpAura = (c, t, x, y, a = 1) => {
    const colors = ['#ff8cb8', '#ffc572', '#fff1a5', '#83f4b4', '#87e5ff', '#b6a1ff', '#f1a4ff'];
    const pulse = .82 + .18 * Math.sin(t * 2.3);
    for (let i = 0; i < 7; i++) {
      const angle = t * .17 + i * TAU / 7;
      LCD.add(c, 'ribbon_' + (i % 3 + 1) + '.png', x + Math.cos(angle) * 170, y + Math.sin(angle) * 125, { w: 1170, h: 360, rot: angle, a: .22 * a * pulse, tint: colors[i] });
    }
    LCD.add(c, 'flare_ring.png', x, y + 45, { w: 1150, h: 540 + pulse * 45, rot: .08 * Math.sin(t), a: .27 * a });
    const rnd = LCD.rng(74);
    for (let i = 0; i < 18; i++) {
      const angle = rnd() * TAU, u = (t * .36 + rnd()) % 1, r = 210 + u * 590;
      LCD.add(c, 'flare_streak.png', x + Math.cos(angle) * r, y + Math.sin(angle) * r * .68, { w: 180 + u * 310, h: 8 + rnd() * 9, rot: angle, a: Math.sin(u * Math.PI) * .25 * a, tint: colors[i % 7] });
    }
  };
  C.rainbowHero = (c, t, x, y, scale, a = 1) => {
    // 身体は整数倍のまま。ゆっくり浮遊し、過去位置の虹を後ろに残す。
    const point = at => [x + Math.sin(at * 1.55) * 32, y + Math.sin(at * 2.05) * 18];
    for (const lag of [.36, .23, .12]) { const p = point(t - lag); LCD.upa(c, p[0] - lag * 95, p[1] + lag * 38, { scale, mood: 'happy', hue: 'rainbow', t: t - lag, a: a * .16 }); }
    const p = point(t); LCD.upa(c, p[0], p[1], { scale, mood: 'happy', hue: 'rainbow', t, a });
  };
  C.hitBloom = (c, t) => {
    // カメラの寄り/揺れから独立した全面露光。白い板の境界を作らない。
    // 弱い立ち上がりの後、強い頂点と減衰はLCD.flashの回数制限に任せる。
    if (t >= .065) return;
    const a = .5 * smooth(t / .065);
    if (a <= 0) return;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = a;
    const g = c.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, '#fff7e7'); g.addColorStop(.5, '#fffefd'); g.addColorStop(1, '#eef5ff'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720); c.restore();
  };
  const reliefCache = new WeakMap();
  C.reliefTitle = (c, key, fallback, x, y, w, h, o = {}) => {
    const im = LCD.img[`t_${key}_face.png`];
    if (!im) { C.title(c, key, fallback, x, y, w, h, o); return; }
    let masks = reliefCache.get(im);
    if (!masks) {
      masks = ['#071521', '#d9f4ff'].map(color => { const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, cv.width, cv.height); return cv; });
      reliefCache.set(im, masks);
    }
    const b = C.bounds(im), s = Math.min(w / b.w, h / b.h), ox = (im.width / 2 - b.cx) * s, oy = (im.height / 2 - b.cy) * s;
    c.save(); c.translate(x, y); c.rotate(o.rot || 0); c.globalAlpha = o.a ?? 1;
    for (let d = 16; d > 0; d -= 2) c.drawImage(masks[0], ox - im.width * s / 2 + d * .5, oy - im.height * s / 2 + d, im.width * s, im.height * s);
    const rim = s * 1.025; c.drawImage(masks[1], ox - im.width * rim / 2, oy - im.height * rim / 2, im.width * rim, im.height * rim);
    C.title(c, key, fallback, 0, 0, w, h, { a: o.a, glowA: .65 });
    LCD.blit(c, `t_${key}_face.png`, ox, oy, { s, a: (o.a ?? 1) * .21, blend: 'screen', tint: '#a1d6f6' }); c.restore();
  };
  // ---- 10/17 作り直し用の共通部品(JP・結果) ----
  const maskCache = new WeakMap();
  const tintMask = (im, color) => {
    let per = maskCache.get(im); if (!per) maskCache.set(im, per = new Map()); if (per.has(color)) return per.get(color);
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d');
    g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, cv.width, cv.height); per.set(color, cv); return cv;
  };
  // 立体の文字(奥行き)。面素材を濃色で斜め下へ積み、金の縁を回す。o: depth, near, far, rim, dir(-1..1 横ずれ)
  C.extrude = (c, key, fallback, x, y, w, h, o = {}) => {
    const im = LCD.img[`t_${key}_face.png`];
    if (!im) { C.title(c, key, fallback, x, y, w, h, o); return; }
    const b = C.bounds(im), s = Math.min(w / b.w, h / b.h) * (o.zoom ?? 1), ox = (im.width / 2 - b.cx) * s, oy = (im.height / 2 - b.cy) * s;
    const depth = (o.depth ?? .075) * b.h * s, steps = Math.max(4, Math.round(depth / 2)), dir = o.dir ?? .28;
    const near = tintMask(im, o.near || '#8a2a10'), far = tintMask(im, o.far || '#2a0612'), rimM = tintMask(im, o.rim || '#ffd35a');
    c.save(); c.translate(x, y); c.rotate(o.rot || 0); c.globalAlpha = o.a ?? 1;
    for (let i = steps; i >= 1; i--) {
      const d = i / steps * depth, m = i > steps * .45 ? far : near;
      c.drawImage(m, ox - im.width * s / 2 + d * dir, oy - im.height * s / 2 + d, im.width * s, im.height * s);
    }
    const rs = s * 1.03; c.drawImage(rimM, ox - im.width * rs / 2, oy - im.height * rs / 2, im.width * rs, im.height * rs);
    C.title(c, key, fallback, 0, 0, w, h, { a: 1, zoom: o.zoom, glowA: o.glowA ?? .9 });
    LCD.blit(c, `t_${key}_face.png`, ox, oy, { s, a: .16, blend: 'screen' });
    c.restore();
  };
  // 数字(3層)に奥行きを足す。rainbow=true で虹数字。
  C.numberDepth = (c, n, x, y, height, rainbow, o = {}) => {
    const str = String(C.total(n)), prefix = rainbow ? 'dr' : 'dg';
    if (![...str].every(d => LCD.hasTitle(prefix + d))) { C.number(c, n, x, y, height, rainbow, o); return; }
    const ims = [...str].map(d => LCD.img[`t_${prefix + d}_face.png`]), bs = ims.map(C.bounds);
    const rawW = bs.reduce((v, b) => v + (b.w / b.h + .045) * height, 0), fit = Math.min(1, (o.maxW || 900) / rawW), depth = height * fit * (o.depth ?? .07);
    const widths = bs.map(b => (b.w / b.h + .045) * height * fit), total = widths.reduce((v, w) => v + w, 0);
    c.save(); c.globalAlpha = o.a ?? 1;
    for (let k = 10; k >= 1; k--) {
      let left = x - total / 2; const d = k / 10 * depth;
      [...str].forEach((ch, i) => { const s = height / bs[i].h * fit, im = ims[i], m = tintMask(im, k > 4 ? (o.far || '#2a0612') : (o.near || '#8a2a10'));
        c.drawImage(m, left + widths[i] / 2 + (im.width / 2 - bs[i].cx) * s - im.width * s / 2 + d * .3, y + (im.height / 2 - bs[i].cy) * s - im.height * s / 2 + d, im.width * s, im.height * s); left += widths[i]; });
    }
    c.restore();
    C.number(c, n, x, y, height, rainbow, o);
  };
  // 高彩度の放射(白っぽくしない)。hue: 数値(度)なら単色、null なら虹が回る
  C.sunburst = (c, t, cx, cy, o = {}) => {
    const n = o.n ?? 20, len = o.len ?? 1500, a = o.a ?? .5, rot = o.rot ?? t * .12, sat = o.sat ?? 100, light = o.light ?? 52;
    c.save(); c.globalCompositeOperation = o.blend ?? 'lighter'; c.translate(cx, cy); c.rotate(rot);
    for (let i = 0; i < n; i += 2) {
      const hue = o.hue == null ? (i * 360 / n + t * (o.spin ?? 110)) % 360 : (o.hue + (i % 4 ? 14 : -14));
      const g = c.createRadialGradient(0, 0, 40, 0, 0, len); g.addColorStop(0, `hsla(${hue},${sat}%,${light}%,${a})`); g.addColorStop(1, `hsla(${hue},${sat}%,${light - 14}%,0)`);
      c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, len, i / n * TAU, (i + 1) / n * TAU); c.closePath(); c.fill();
    }
    c.restore();
  };
  // 画面全体を虹に染める(色相をなめらかに回す。強い白フラッシュではない)。
  C.rainbowWash = (c, t, a = .3, speed = 260, y0 = 0, y1 = 720) => {
    const h = (t * speed) % 360; c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(0, y0, 1280, y1); g.addColorStop(0, `hsla(${h},100%,48%,${a})`); g.addColorStop(.5, `hsla(${h + 70},100%,48%,${a * .85})`); g.addColorStop(1, `hsla(${h + 140},100%,48%,${a})`);
    c.fillStyle = g; c.fillRect(-60, -60, 1400, 840); c.restore();
  };
  // 深い色の全面背景。内側が c0、外側が c1。
  C.deepBg = (c, c0, c1, cy = 330, r = 980) => { const g = c.createRadialGradient(640, cy, 20, 640, cy, r); g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g; c.fillRect(-120, -120, 1520, 960); };
  // 常設用。ホストが毎フレーム LCD.hud(ctx, {sec}) を呼ぶ。未接続時に時刻を捏造しない。
  // LCD.initのシーン絞り込み時には、この配列も LCD.load する。
  LCD.hudAssets = ['plate_A.png', 'glow_soft.png'];
  // 常設の札の置き場(液晶 1280x720)。位置はここ1か所。外接矩形は LCD.layoutRects() で取れる(R2-TU の字幕の帯が重ならないことの検査用)。
  //   mochi/nokori: 板 470x150 の中心。chip: 左上の角。caption: 字幕の帯(R2-TU 案。ここは札を置かない)
  LCD.LAYOUT = LCD.LAYOUT || { mochi: { x: 285, y: 84, w: 470, h: 150 }, nokori: { x: 1030, y: 84, w: 470, h: 150 }, chip: { x: 24, y: 176, w: 400, h: 150 }, caption: { x: 24, y: 430, w: 616, h: 260 } };
  LCD.layoutRects = () => { const L = LCD.LAYOUT, r = (o, centre) => centre ? { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h } : { x: o.x, y: o.y, w: o.w, h: o.h };
    return { mochi: r(L.mochi, 1), nokori: r(L.nokori, 1), chip: r(L.chip), caption: r(L.caption) }; };
  LCD.hud = (c, params = {}) => {
    if (typeof params.sec !== 'number' || !Number.isFinite(params.sec)) return;
    const sec = Math.ceil(Math.max(0, params.sec)), danger = sec <= 10, x = params.x ?? LCD.LAYOUT.nokori.x, y = params.y ?? LCD.LAYOUT.nokori.y;
    // 遠くからでも読める大きさ(27型の縦画面では液晶全体が小さい。筐体全体の画で「のこり」まで読めること): 板 470x150、数字 112px
    LCD.blit(c, 'plate_A.png', x, y, { w: 470, h: 150, a: .96 });
    if (danger) LCD.add(c, 'glow_soft.png', x, y, { w: 520, h: 210, a: .3 + .14 * Math.sin((LCD.t || 0) * 12), tint: '#ff4260' });
    LCD.text(c, 'のこり', x - 160, y + 4, { size: 40, stroke: 4, fill1: '#ffffff', fill2: danger ? '#ffb3bd' : '#d9ebfa' });
    LCD.text(c, String(sec), x + 30, y - 2, { size: 114, weight: 900, stroke: 6, fill1: danger ? '#fff0e8' : '#f4fbff', fill2: danger ? '#ff5265' : '#c8e9ff', glow: danger ? '#de1c47' : '#5c9ccf' });
    LCD.text(c, '秒', x + 160, y + 20, { size: 52, stroke: 4, fill2: danger ? '#ffa1ad' : '#d9ebfa' });
    C.prizeChip(c);
  };
  // 常設: 持ち玉(手元で使える玉)。「のこり」と左右対称の同じ大きさの板を左上に。数字は筐体の7セグと同じ値(LCD.state.ballsShown = 皿に着いた分だけ増え、撃つと減る)。
  // 増えた時は数字が跳ねて金色に、減る時はわずかに沈む。少ない時(3玉以下)はだいだいに脈打ち、0は赤。玉が液晶へ飛び込む表現はしない(物理にできない動きは禁止)。数字の変化だけで見せる。
  LCD.hudMochi = (c, params = {}) => {
    const v = LCD.state.ballsShown;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return;
    const M = LCD.hudMochiS || (LCD.hudMochiS = { v, t: -9, d: 0, from: v });
    if (M.v !== v) { M.d = v > M.v ? 1 : -1; M.from = M.v; M.v = v; M.t = LCD.t || 0; }
    const age = (LCD.t || 0) - M.t, x = params.x ?? LCD.LAYOUT.mochi.x, y = params.y ?? LCD.LAYOUT.mochi.y, low = v <= 3, empty = v <= 0;
    // JACKPOT の題が左上に収まる間は、板を小さくして左の端へ寄せる(題と重ねない)
    const cdt = Math.min(.1, Math.max(0, (LCD.t || 0) - (M.lt ?? (LCD.t || 0)))); M.lt = LCD.t || 0;
    const ctg = LCD.active.some((sc) => sc.id === 'jp') ? 1 : 0; if (!Number.isFinite(M.cs)) M.cs = 0; M.cs = M.cs + (ctg - M.cs) * Math.min(1, cdt * 9); const cs = M.cs < .01 ? 0 : M.cs;
    const pop = M.d > 0 ? Math.exp(-age * 7) : 0, dip = M.d < 0 ? Math.exp(-age * 9) : 0;
    const warn = empty ? '#ff5265' : low ? '#ffb347' : null, pulse = low ? .5 + .5 * Math.sin((LCD.t || 0) * (empty ? 9 : 6)) : 0;
    if (cs > 0) { const k = 1 - .48 * cs; c.translate(50 + (18 - 50) * cs, 9 + (14 - 9) * cs); c.scale(k, k); c.translate(-50, -9); }
    LCD.blit(c, 'plate_A.png', x, y, { w: 470, h: 150, a: .96 });
    if (pop > .02) LCD.add(c, 'glow_soft.png', x + 30, y, { w: 460, h: 200, a: .5 * pop, tint: '#ffd96b' });
    if (low) LCD.add(c, 'glow_soft.png', x, y, { w: 520, h: 210, a: .18 + .22 * pulse, tint: empty ? '#ff4260' : '#ffa23c' });
    LCD.text(c, 'もちだま', x - 150, y + 4, { size: 36, stroke: 4, fill1: '#ffffff', fill2: warn ? (empty ? '#ffb3bd' : '#ffd9a0') : '#d9ebfa' });
    const big = v >= 1000, size = (big ? 84 : 114) * (1 + .22 * pop - .08 * dip);
    c.save(); c.translate(x + 62, y - 2 + 6 * dip);
    LCD.text(c, String(v), 0, 0, { size, weight: 900, stroke: 6, fill1: pop > .1 ? '#fffbe0' : warn ? '#fff0e8' : '#f4fbff', fill2: pop > .1 ? '#ffd24a' : warn ? (empty ? '#ff5265' : '#ffa23c') : '#c8e9ff', glow: pop > .1 ? '#ff9a1a' : warn ? (empty ? '#de1c47' : '#e8761a') : '#5c9ccf' });
    c.restore();
    LCD.text(c, '玉', x + 190, y + 20, { size: 52, stroke: 4, fill2: warn ? (empty ? '#ffa1ad' : '#ffd9a0') : '#d9ebfa' });
  };
  // 常設: いま勝負で当たると何玉か(灯の数ごと。数は規則から)と、いまの灯の数。旧UIの賞玉パネルの代わり(左側に小さく)。0灯と時間切れ後は出さない
  C.prizeChip = (c) => {
    if (LCD.rules().r3Enabled) return;   // R3に任意の勝負・小配当はない
    const n = clamp(Math.floor(LCD.state.nDisp ?? LCD.state.n ?? 0), 0, 7), AW = LCD.rules().awards || [0, 1, 2, 3, 12, 30, 80];
    if (n < 1 || LCD.state.hudChip === false) return;
    if (LCD.state.chipWait) return;   // 最初の「しょうぶ」の案内が済むまで出さない(effects.js が tutorial.js の済みの記録で決める)
    if (LCD.active.some((sc) => /^(challenge_|success|jp|fail|lamp[456]|dup_protect|roulette|ascend|timeup|add100|finish|result|ticket|start|howto|title|attract|warn10)/.test(sc.id))) return;   // 勝負・当たり・結果などの演出中は、その演出の邪魔をしない
    const x = LCD.LAYOUT.chip.x, y = LCD.LAYOUT.chip.y, w = LCD.LAYOUT.chip.w, h = LCD.LAYOUT.chip.h, jp = n >= 6, big = n >= 4;
    c.save();
    c.fillStyle = 'rgba(6,20,52,.74)'; c.strokeStyle = jp ? '#ffe27a' : big ? '#ffb347' : '#9fd0ff'; c.lineWidth = 4;
    c.beginPath(); c.roundRect(x, y, w, h, 20); c.fill(); c.stroke();
    LCD.text(c, 'しょうぶで あたると', x + w / 2, y + 30, { size: 42, stroke: 4, fill1: '#ffffff', fill2: '#cfe6ff' });
    LCD.text(c, jp ? 'JP!' : `+${AW[Math.min(n, 5)]}玉`, x + w / 2, y + 88, { size: 84, stroke: 7, fill1: '#fff6c8', fill2: jp ? '#ffd04a' : big ? '#ffb21e' : '#bfe3ff', glow: jp ? '#ff9a1a' : big ? '#ff8a1a' : '#5c9ccf' });
    for (let i = 0; i < 7; i++) { const dx = x + 38 + i * 54, on = i < Math.min(n, 7); c.fillStyle = on ? (jp ? '#ffd04a' : big ? '#ff9ac0' : '#ffe27a') : 'rgba(255,255,255,.22)'; c.beginPath(); c.arc(dx, y + h - 15, 11, 0, TAU); c.fill(); }
    c.restore();
  };
  C.benefitAssets = ['rl_rim.png', 'rl_dome.png', 'rl_lamp_on.png', 'rl_lamp_off.png', ...LCD.hudAssets];
  // 継続の価値をひとつのまとまりに。玉の山はこの小さな説明アイコンの中だけ。
  // 実際の払い出しは筐体の皿。画面を玉で埋めたり獲得を先出ししたりしない。
  C.continueBenefits = (c, t, o = {}) => {
    const rules = LCD.rules(), y = o.y ?? 448, xs = [354, 640, 926], age = o.age ?? t;
    const n = clamp(Math.floor(o.lamps ?? LCD.state.nDisp ?? LCD.state.n ?? 0), 0, 7);
    xs.forEach((x, i) => {
      const enter = easeBenefit((age - i * .09) / .34), cy = y + (1 - enter) * 28;
      c.save(); c.translate(x, cy); c.scale(Math.max(.01, enter), Math.max(.01, enter));
      LCD.add(c, 'glow_soft.png', 0, 0, { w: 250, h: 200, a: .26, tint: i === 2 ? '#ff9bbd' : '#ffc46b' });
      const g = c.createLinearGradient(-72, -72, 75, 82); [[0, '#fff0bf'], [.2, '#94653e'], [.42, '#ffe0a3'], [.54, '#3e2843'], [.8, '#bf8a49'], [1, '#fff6d4']].forEach(([a, col]) => g.addColorStop(a, col));
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.fill();
      const face = c.createRadialGradient(-18, -25, 0, 0, 0, 74); face.addColorStop(0, '#35405b'); face.addColorStop(1, '#10182d'); c.fillStyle = face; c.beginPath(); c.arc(0, 0, 73, 0, TAU); c.fill();
      LCD.blit(c, 'rl_rim.png', 0, 0, { w: 165, h: 165, a: .42, blend: 'screen' });
      if (i === 0) {
        // 皿に載った鏡面球。白い丸/泡を使わない。
        for (const [bx, by, r] of [[-40, 27, 20], [0, 28, 21], [40, 27, 20], [-21, -5, 21], [22, -5, 21], [0, -38, 20]]) LCD.ball(c, bx, by + Math.sin(t * 2) * 2, r, { gold: false });
        LCD.add(c, 'glint_1.png', -23 + Math.sin(t * 1.8) * 34, -18, { w: 26, h: 26, a: .58 });
      } else if (i === 1) {
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * TAU - Math.PI / 2; c.strokeStyle = '#f9dda2'; c.lineWidth = k % 3 ? 2 : 4; c.beginPath(); c.moveTo(Math.cos(a) * 53, Math.sin(a) * 53); c.lineTo(Math.cos(a) * 62, Math.sin(a) * 62); c.stroke();
        }
        LCD.text(c, '12', 0, -40, { size: 20, stroke: 2, fill2: '#fff1d3' });
        const hand = (angle, len, width, col) => { c.save(); c.rotate(angle); c.strokeStyle = '#121522'; c.lineWidth = width + 4; c.beginPath(); c.moveTo(-8, 2); c.lineTo(0, -len); c.stroke(); c.strokeStyle = col; c.lineWidth = width; c.stroke(); c.restore(); };
        hand(.8, 32, 7, '#f3d096'); hand(t * .9, 48, 4, '#fff8db'); LCD.ball(c, 0, 0, 7, { gold: true });
      } else {
        for (let k = 0; k < 7; k++) {
          const a = (k - 3) * .37, px = Math.sin(a) * 53, py = 20 - Math.cos(a) * 40;
          LCD.blit(c, 'rl_lamp_off.png', px, py, { w: 45, h: 65, rot: a * .65 });
          if (k < n) { LCD.add(c, 'rl_lamp_on.png', px, py, { w: 45, h: 65, rot: a * .65, a: .95 }); LCD.add(c, 'glow_soft.png', px, py, { w: 45, h: 65, a: .2, tint: '#ff7ba6' }); }
        }
        LCD.add(c, 'glint_1.png', Math.sin(t) * 45, -43, { w: 27, h: 27, a: .65 });
      }
      LCD.blit(c, 'rl_dome.png', 0, 0, { w: 149, h: 149, blend: 'screen', a: .22, rot: Math.sin(t * .7) * .08 });
      c.restore();
      const a = smooth((age - i * .09) / .25);
      if (i < 2) {
        LCD.number(c, '+' + (i ? rules.extraSeconds : rules.loanBalls), x - 30, y + 132, { h: 88, w: 200, a });
        LCD.text(c, i ? '秒' : '玉', x + 92, y + 146, { size: 58, a, fill2: '#fff0c6' });
      } else { LCD.text(c, 'あかりは', x, y + 112, { size: 48, a, fill2: '#ffd7e3' }); LCD.text(c, 'そのまま', x, y + 164, { size: 54, a, fill2: '#ffeebf' }); }
    });
  };
  const easeBenefit = x => LCD.easeOutBack(clamp(x));
  // 白い発光素材を使う色の幕。金の背景でも青/紫の発色を保つ。
  C.spectrum = (c, t, strength = 1) => {
    const colors = ['#ff5caa', '#ffb864', '#fff293', '#6fffba', '#66d8ff', '#a58aff', '#ed80ee'];
    for (let i = 0; i < 7; i++) {
      const a = t * .17 + i * TAU / 7;
      LCD.add(c, 'glow_soft.png', 640 + Math.cos(a) * 540, 330 + Math.sin(a) * 240, { w: 620, h: 900, a: .28 * strength, tint: colors[i] });
      LCD.add(c, 'flare_streak.png', 640 + Math.cos(a) * 310, 330 + Math.sin(a) * 175, { w: 1370, h: 65, rot: a, a: .17 * strength, tint: colors[i] });
    }
  };
  // JPだけの宝飾フレーム。小領域を追走点灯し、全面フラッシュに頼らず密度を出す。
  C.jpFestival = (c, t, pos = 0, intensity = 1) => {
    const colors = ['#ff73b7', '#ffc26a', '#fff2a0', '#91ffc4', '#7fdcff', '#bba5ff', '#f4a1ff'];
    const edge = [];
    for (let i = 0; i < 16; i++) edge.push([43 + i * 79.6, 26], [43 + i * 79.6, 694]);
    for (let i = 0; i < 8; i++) edge.push([27, 91 + i * 76.5], [1253, 91 + i * 76.5]);
    edge.forEach(([x, y], i) => {
      const col = colors[i % 7], angle = ((Math.atan2(y - 360, x - 640) / TAU + .25) % 1 + 1) % 1, phase = ((pos - angle) % 1 + 1) % 1;
      const chase = Math.exp(-phase * 14), blink = Math.sin(t * 16 + i * .65) > -.2 ? 1 : .23;
      LCD.ball(c, x, y, 7, { gold: true });
      LCD.add(c, 'glow_soft.png', x, y, { w: 54, h: 54, a: (.16 + .38 * chase) * blink * intensity, tint: col });
      LCD.add(c, 'glint_1.png', x, y, { w: 21 + chase * 14, h: 21 + chase * 14, a: (.22 + .63 * chase) * blink * intensity, tint: col });
    });
    for (let i = 0; i < 12; i++) {
      const p = (t * .28 + i / 12) % 1, side = i % 2 ? -1 : 1;
      LCD.add(c, 'flare_streak.png', 640 + side * (470 + p * 170), 720 - p * 900, { w: 180 + p * 170, h: 10, rot: -side * .7, a: Math.sin(p * Math.PI) * .46 * intensity, tint: colors[i % 7] });
    }
  };
  // 各LCD部品はglobalAlphaを設定するので、一枚に合成してからフェードする。
  let fadeCanvas;
  C.fade = (c, t, end, span, draw) => {
    const a = 1 - smooth((t - (end - span)) / span);
    if (a >= 1) { draw(c); return; }
    if (a <= 0) return;
    if (!fadeCanvas) { fadeCanvas = document.createElement('canvas'); fadeCanvas.width = 1280; fadeCanvas.height = 720; }
    const g = fadeCanvas.getContext('2d'); g.clearRect(0, 0, 1280, 720); g.save(); draw(g); g.restore();
    c.save(); c.globalAlpha = a; c.drawImage(fadeCanvas, 0, 0); c.restore();
  };
})();
