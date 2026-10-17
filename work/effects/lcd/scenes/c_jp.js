/* JP(基準20秒。配当別の実時間倍率はホスト→sc.scaleに任せる)。10/17 作り直し。
 *  0.0-0.64  白飛び→深紅の爆発→ヒットストップ
 *  0.64-4.0  虹ウパ降臨+カットイン+立体JACKPOT(2.1にドン)
 *  4.0-11.2  立体の縦リール(円筒を行ごとに投影)。加速→減速→寸止め→ぐんと再加速→本気で減速→ピタ
 *  11.2-14.4 当選額が巨大に(虹の立体数字、虹ウパ)
 *  14.4-20   玉の爆発→通常へ
 * 色: 背景は深紅/紫(白っぽく褪せさせない)、金は #ffb000 付近。全面の虹は色相をなめらかに回す(白い強フラッシュは1秒3回以内)。
 * LCD.jpNeedle: リールの回転位置(0-1/周)を update ごとに公開。 */
(function () {
  const C = LCD.C, { TAU, clamp, smooth, easeOut, easeOutBack } = LCD;
  const PAYS = () => LCD.rules().jackpotAwards.slice(0, 5);
  // ---- リール(円筒)の寸法。前面の1面の高さ F = 2πR/N ----
  const N = 10, FH = 200, TW = 700, R = 290, F = TAU * R / N, CX = 640, CY = 420, HW = 350, HH = 235;
  const FACES = [40, 300, 80, 600, 150, 40, 300, 80, 600, 150];
  const PAL = { 40: ['#ff2a52', '#a00a30', '#32020f'], 80: ['#ff2bb8', '#8a0a6a', '#30021f'], 150: ['#9a4bff', '#4a14a8', '#160538'], 300: ['#2f86ff', '#0f3ca8', '#041340'], 600: ['#ff8a1a', '#b0200a', '#3a0508'] };
  // 速さ(面/秒)の折れ線。0=リール開始(t=4.0)。3.6-3.85が寸止め、4.35までに再加速、6.6で止まる。
  const KN = [[0, 0], [.45, 17], [2.1, 17], [3.1, 1.4], [3.6, .35], [3.85, .35], [4.35, 16], [5.0, 16], [5.8, 4], [6.3, 1], [6.6, 0]];
  const AREA = KN.slice(1).reduce((s, [t, v], i) => s + (t - KN[i][0]) * (v + KN[i][1]) / 2, 0);
  const T_STOP = 6.6;
  const reelMotion = (a, K) => {
    const sc = K / AREA; a = Math.max(0, a); let pos = 0, v = 0;
    for (let i = 1; i < KN.length; i++) {
      const [t0, v0] = KN[i - 1], [t1, v1] = KN[i], dt = t1 - t0, tau = clamp(a - t0, 0, dt);
      pos += v0 * tau + (v1 - v0) * tau * tau / (2 * dt);
      if (a >= t0 && a < t1) v = v0 + (v1 - v0) * (a - t0) / dt;
    }
    pos *= sc; v *= sc;
    // 止まる瞬間に、機械のようにカチッと小さく行き過ぎて戻る
    if (a > T_STOP) { const e = a - T_STOP; pos = K + .11 * Math.exp(-e * 9) * Math.sin(e * 24); v = 0; }
    return { pos, v };
  };
  const mod = (x, m) => ((x % m) + m) % m;
  let tex = null;
  function buildTex() {
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = FH * N * 2; const g = cv.getContext('2d');
    for (let k = 0; k < N * 2; k++) {
      const amt = FACES[k % N], y0 = k * FH, [c0, c1, c2] = PAL[amt];
      const bg = g.createLinearGradient(0, y0, 0, y0 + FH); bg.addColorStop(0, c2); bg.addColorStop(.3, c1); bg.addColorStop(.5, c0); bg.addColorStop(.7, c1); bg.addColorStop(1, c2);
      g.fillStyle = bg; g.fillRect(0, y0, TW, FH);
      const sh = g.createLinearGradient(0, y0, TW, y0 + FH); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.42, 'rgba(255,255,255,0)'); sh.addColorStop(.5, 'rgba(255,255,255,.22)'); sh.addColorStop(.58, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, y0, TW, FH);
      // 金のレール(上下)と暗い溝
      for (const [yy, dir] of [[y0, 1], [y0 + FH, -1]]) {
        g.fillStyle = '#12040a'; g.fillRect(0, yy + (dir > 0 ? 0 : -16), TW, 16);
        const gold = g.createLinearGradient(0, yy, 0, yy + dir * 10); gold.addColorStop(0, '#fff3b0'); gold.addColorStop(.5, '#ffb000'); gold.addColorStop(1, '#8a4a00');
        g.fillStyle = gold; g.fillRect(0, yy + (dir > 0 ? 6 : -16), TW, 10);
      }
      // 数字と「玉」
      const cy = y0 + FH / 2 + 2;
      C.number(g, amt, 300, cy, 124, amt === 600, { maxW: 430 });
      LCD.text(g, '玉', 586, cy + 24, { size: 72, fill1: '#fffbe0', fill2: '#ffb000', glow: '#ff7a00' });
      if (amt === 600) for (let s = 0; s < 6; s++) LCD.add(g, 'glint_1.png', 60 + s * 116 + (s % 2) * 20, cy + (s % 3 - 1) * 52, { w: 46, h: 46, a: .8 });
    }
    return cv;
  }
  // ---- 背景 ----
  function bgFor(c, t, phase) {
    if (phase === 'A') { C.deepBg(c, '#e0143c', '#30044a', 360, 900); C.sunburst(c, t, 640, 360, { a: .42, n: 24, rot: t * .3, hue: 330, light: 46 }); C.sunburst(c, t + 1, 640, 360, { a: .3, n: 24, rot: -t * .2, hue: 38, light: 46 }); return; }
    if (phase === 'B') { C.deepBg(c, '#e0124e', '#26044e', 340, 1000); C.sunburst(c, t, 640, 330, { a: .5, n: 24, spin: 160 }); LCD.add(c, 'rays_soft.png', 640, 330, { w: 1700, h: 1300, a: .35, rot: -t * .1, tint: '#ff4a8a' }); C.rainbowWash(c, t, .16, 300); return; }
    if (phase === 'C') {
      C.deepBg(c, '#a8103e', '#1c0233', 330, 1000);
      C.sunburst(c, t, 640, 420, { a: .42, n: 24, hue: 8, rot: t * .1, len: 1500 });
      C.sunburst(c, t + 3, 640, 420, { a: .22, n: 18, hue: 42, rot: -t * .07, len: 1500 });
      LCD.add(c, 'glow_soft.png', 640, 420, { w: 1500, h: 1000, a: .4, tint: '#ff2a60' });
      C.rainbowWash(c, t, .09, 150); return;
    }
    C.deepBg(c, '#d0126a', '#240052', 330, 1000);
    C.sunburst(c, t, 640, 340, { a: .55, n: 24, spin: 190, rot: t * .16, light: 46 });
    LCD.add(c, 'rays_soft.png', 640, 330, { w: 1800, h: 1400, a: .28, rot: t * .1, tint: '#ffb000' });
    C.rainbowWash(c, t, .2, 330);
  }
  // 一枚の背景に細い光の粒と花吹雪を足す
  function sparkle(c, t, n = 40) {
    const rnd = LCD.rng(55);
    for (let i = 0; i < n; i++) {
      const x = rnd() * 1280, y = (rnd() * 860 + t * (50 + rnd() * 80)) % 860 - 70, p = .5 + .5 * Math.sin(t * (3 + rnd() * 4) + i);
      LCD.add(c, i % 3 ? 'glint_1.png' : 'spark.png', x, y, { w: 18 + rnd() * 26, h: 18 + rnd() * 26, a: .35 + .5 * p, tint: ['#ffe27a', '#ff8ad0', '#9fe8ff', '#fff'][i % 4] });
    }
  }
  // ---- JACKPOT(立体)。位置は 2.1 ドン → 3.3-4.0 で左上へ ----
  function jackpotTitle(c, t) {
    const m = smooth((t - 3.1) / .6), slam = easeOutBack((t - 2.1) / .36);
    const x = 640 + (410 - 640) * m, y = 520 + (84 - 520) * m, w = 1180 + (620 - 1180) * m, h = 240 + (120 - 240) * m;
    const z = t < 2.1 ? 0 : (.55 + .45 * slam) * (1 + .012 * Math.sin(t * 6));
    if (t < 2.1 && t < 4) return;
    C.extrude(c, 'jackpot', 'JACKPOT', x, y + Math.sin(t * 3) * (1 - m) * 3, w, h, { zoom: z * (t >= 4 ? 1 : 1), near: '#9a1560', far: '#2a0640', rim: '#ffcf40', depth: .09 });
  }
  // ---- リール ----
  function housing(c, t, S, hot) {
    const x0 = CX - HW - 30, x1 = CX + HW + 30, y0 = CY - HH - 28, y1 = CY + HH + 28;
    c.save();
    LCD.add(c, 'glow_soft.png', CX, CY, { w: 1150, h: 840, a: .55 + hot * .3, tint: '#ffb000' });
    const g = c.createLinearGradient(x0, y0, x1, y1);
    [[0, '#fff0a8'], [.12, '#ffb000'], [.3, '#7a3a00'], [.45, '#ffd35a'], [.5, '#fff6c8'], [.6, '#a85a00'], [.8, '#ffb000'], [1, '#5a2400']].forEach(([p, col]) => g.addColorStop(p, col));
    c.fillStyle = '#12040a'; c.beginPath(); c.roundRect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16, 34); c.fill();
    c.fillStyle = g; c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, 28); c.fill();
    c.strokeStyle = 'rgba(255,255,230,.8)'; c.lineWidth = 2; c.beginPath(); c.roundRect(x0 + 5, y0 + 5, x1 - x0 - 10, y1 - y0 - 10, 24); c.stroke();
    c.fillStyle = '#0a0210'; c.fillRect(CX - HW - 6, CY - HH - 6, HW * 2 + 12, HH * 2 + 12);
    c.restore();
  }
  function reel(c, t, S) {
    if (!tex) tex = buildTex();
    const { pos, v } = S.m, blur = Math.min(120, v * FH / 60 * 1.6), fast = clamp(v / 8), settled = smooth((t - 10.6) / .25);
    c.save(); c.beginPath(); c.rect(CX - HW, CY - HH, HW * 2, HH * 2); c.clip();
    const step = 2;
    for (let y = CY - HH; y < CY + HH; y += step) {
      const d0 = y - CY, d1 = d0 + step, a0 = Math.asin(clamp(d0 / R, -.999, .999)), a1 = Math.asin(clamp(d1 / R, -.999, .999)), am = (a0 + a1) / 2, co = Math.cos(am);
      const srcH = (a1 - a0) * R * FH / F + blur, ty = pos * FH + FH / 2 + am * R * FH / F, sy = mod(ty - srcH / 2, FH * N);
      const wS = .8 + .2 * co, w = HW * 2 * wS;
      c.drawImage(tex, 0, sy, TW, srcH, CX - w / 2, y, w, step + .6);
    }
    // 円筒の陰影(上下で急に暗く)。色が褪せないよう黒と深紅で締める
    const sh = c.createLinearGradient(0, CY - HH, 0, CY + HH);
    [[0, 'rgba(10,0,20,.94)'], [.14, 'rgba(20,0,30,.62)'], [.3, 'rgba(20,0,30,.18)'], [.5, 'rgba(0,0,0,0)'], [.7, 'rgba(20,0,30,.18)'], [.86, 'rgba(20,0,30,.62)'], [1, 'rgba(10,0,20,.94)']].forEach(([p, col]) => sh.addColorStop(p, col));
    c.fillStyle = sh; c.fillRect(CX - HW, CY - HH, HW * 2, HH * 2);
    // 速いときの縦の筋(虹)
    if (fast > .05) for (let i = 0; i < 12; i++) {
      const x = CX - HW + 30 + (i * 59 + (t * 400) % 59), h = (t * 360 + i * 30) % 360;
      LCD.add(c, 'flare_streak.png', x, CY, { w: 460, h: 14, rot: Math.PI / 2, a: .22 * fast, tint: `hsl(${h},100%,60%)` });
    }
    // 斜めのガラスの反射
    const gl = c.createLinearGradient(CX - HW, CY - HH, CX + HW, CY + HH * .2); gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(.35, 'rgba(255,255,255,0)'); gl.addColorStop(.6, 'rgba(255,255,255,0)'); gl.addColorStop(.72, 'rgba(255,255,255,.1)'); gl.addColorStop(.78, 'rgba(255,255,255,0)');
    c.globalCompositeOperation = 'lighter'; c.fillStyle = gl; c.fillRect(CX - HW, CY - HH, HW * 2, HH * 2);
    c.restore();
    // 当たりのライン(中央の1面)。止まると脈打つ金の枠
    const pulse = .65 + .35 * Math.sin(t * 14), hot = settled * pulse;
    c.save(); c.strokeStyle = `rgba(255,214,72,${.55 + hot * .45})`; c.lineWidth = 5 + settled * 4; c.shadowColor = '#ffb000'; c.shadowBlur = 18 + settled * 26;
    c.strokeRect(CX - HW + 8, CY - F / 2 + 6, HW * 2 - 16, F - 12); c.restore();
    // 上下のキャップ(円筒の端の金属)
    for (const s of [-1, 1]) {
      const cy = CY + s * (HH - 14), g = c.createLinearGradient(0, cy - 16, 0, cy + 16);
      [[0, '#5a2400'], [.25, '#ffd35a'], [.5, '#fff7d0'], [.75, '#c87a10'], [1, '#3a1500']].forEach(([p, col]) => g.addColorStop(p, col));
      c.fillStyle = g; c.fillRect(CX - HW - 6, cy - 16, HW * 2 + 12, 32);
    }
    // 左右の三角(当たりを指す)
    for (const s of [-1, 1]) {
      c.save(); c.translate(CX + s * (HW + 56), CY); c.scale(-s, 1); c.shadowColor = '#ffb000'; c.shadowBlur = 20 + settled * 20;
      c.fillStyle = hot > .3 ? '#fff6c8' : '#ffb000'; c.strokeStyle = '#3a1000'; c.lineWidth = 6; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-34, -40); c.lineTo(34, 0); c.lineTo(-34, 40); c.closePath(); c.stroke(); c.fill(); c.restore();
    }
  }
  function bulbs(c, t, S) {
    const x0 = CX - HW - 30, x1 = CX + HW + 30, y0 = CY - HH - 28, y1 = CY + HH + 28, W2 = x1 - x0, H2 = y1 - y0, per = 2 * (W2 + H2), cnt = 40;
    const slow = 1 - clamp(S.m.v / 3), spin = (S.m.pos * 4 + t * .5) % cnt;
    for (let i = 0; i < cnt; i++) {
      let d = i / cnt * per, x, y;
      if (d < W2) { x = x0 + d; y = y0; } else if ((d -= W2) < H2) { x = x1; y = y0 + d; } else if ((d -= H2) < W2) { x = x1 - d; y = y1; } else { d -= W2; x = x0; y = y1 - d; }
      const chase = Math.exp(-mod(spin - i, cnt) * .35), blink = slow > .5 ? (Math.sin(t * 20 + i * 1.7) > 0 ? 1 : .3) : 1, hue = (i * 9 + t * 300) % 360;
      LCD.ball(c, x, y, 8.5, { gold: true });
      LCD.add(c, 'glow_soft.png', x, y, { w: 76, h: 76, a: (.3 + .6 * chase) * blink, tint: `hsl(${hue},100%,58%)` });
      LCD.add(c, 'glint_1.png', x, y, { w: 24 + chase * 26, h: 24 + chase * 26, a: (.4 + .6 * chase) * blink, tint: `hsl(${hue},100%,72%)` });
    }
  }
  // ---- 玉の爆発(左右の外側だけ。中央・告知・時間の表示を避ける) ----
  function ballBurst(c, t) {
    const rnd = LCD.rng(921), e = t - 14.4;
    const clear = [[250, 120, 1040, 650], [780, 0, 1280, 175], [90, 0, 760, 170]];
    for (let i = 0; i < 112; i++) {
      const side = i % 2 ? -1 : 1, burst = i < 40;
      const delay = burst ? rnd() * .35 : .3 + rnd() * 3.25, age = e - delay;
      const r = 13 + rnd() * 20;
      const x0 = burst ? 640 + side * (320 + rnd() * 170) : (side < 0 ? 40 : 1240) + side * rnd() * 22;
      const y0 = burst ? 555 + rnd() * 50 : -60 - rnd() * 170;
      const vx = burst ? side * (160 + rnd() * 260) : -side * (8 + rnd() * 22);
      const vy = burst ? -180 - rnd() * 190 : 80 + rnd() * 160;
      if (age < 0) continue;
      const x = x0 + vx * age, y = y0 + vy * age + (burst ? 380 : 260) * age * age;
      if (x + r < 0 || x - r > 1280 || y + r < 0 || y - r > 720) continue;
      if (clear.some(([l, top, right, bottom]) => x + r > l && x - r < right && y + r > top && y - r < bottom)) continue;
      LCD.ball(c, x, y, r, { gold: i % 9 === 0 });
    }
  }
  function reelGroup(c, t, S) {
    const enter = easeOutBack((t - 3.7) / .55), out = smooth((t - 11) / .25), zoom = (.7 + .3 * enter) * (1 + out * .35), a = clamp((t - 3.7) / .2) * (1 - out);
    c.save(); c.globalAlpha = a; c.translate(CX, CY + 34); c.scale(zoom, zoom); c.translate(-CX, -(CY + 34));
    const hot = smooth((t - 10.6) / .25);
    housing(c, t, S, hot); reel(c, t, S); bulbs(c, t, S);
    if (t >= 10.6) {
      const u = t - 10.6;
      LCD.add(c, 'flare_ring.png', CX, CY, { w: 400 + u * 1500, h: 250 + u * 900, a: .8 * (1 - smooth(u / .6)) });
      LCD.flip(c, 'shock_2', u, CX, CY, { s: 2.2, a: .5 });
    }
    if (S.m.v > 6) LCD.flip(c, 'speed_2', t * 2, CX, CY, { s: 2.6, a: .22 });
    // 再加速の瞬間: 光の輪と文字
    if (t >= 7.85 && t < 8.6) { const u = (t - 7.85) / .75; LCD.add(c, 'flare_ring.png', CX, CY, { w: 500 + u * 1100, h: 300 + u * 700, a: .85 * (1 - u) }); }
    c.restore();
    // 左上の立体JACKPOT。左右に虹ウパ
    if (t >= 4) jackpotTitle(c, t);
    LCD.add(c, 'glow_soft.png', 125, 440, { w: 330, h: 300, a: .5, tint: '#ff4aa0' }); C.rainbowHero(c, t, 125, 440, 4);
    LCD.add(c, 'glow_soft.png', 1155, 440, { w: 330, h: 300, a: .5, tint: '#4a9aff' }); LCD.upa(c, 1155, 440, { scale: 4, hue: LCD.HUES[1], mood: 'happy' });
    const near = S.m.v < 1.2 && t > 7.2 && t < 8.1;
    const say = near ? ['どうなる', '…!'] : ['いくつ', 'もらえる?']; say.forEach((ln, i) => LCD.text(c, ln, 125, 262 + i * 52, { size: 46, fill1: '#fff6d0', fill2: '#ffb000', glow: '#ff2a60', a: clamp((t - 4.2) / .3) }));
    if (t >= 4) C.jpFestival(c, t, S.m.pos / 12, .9);
  }
  const visT = t => t < .64 ? t : t < .8 ? .64 : t - .16;   // ヒットストップ: .64-.8 は絵を止める
  LCD.scene({ id: 'jp', dur: 20, cover: true,
    assets: [...C.assets, ...C.jpAssets, ...C.titleAssets('jackpot'), ...C.digitAssets(true), ...C.digitAssets(), 'flip:pillar_2', 'flip:shock_2', 'flip:speed_2', 'flip:digitburst_2', 'flip:impact_2', 'rl_shadow.png'],
    start(sc, p) {
      sc.S.pays = PAYS(); sc.S.index = Math.max(0, sc.S.pays.indexOf(Number(p.payout))); sc.S.payout = sc.S.pays[sc.S.index];
      // 当選額の面を、2つある同じ額の面のどちらかに決める
      const i0 = FACES.indexOf(sc.S.payout), ft = i0 + (sc.rand() < .5 ? 0 : 5);
      let K = Math.round(AREA / N) * N + ft; if (K > AREA + N / 2) K -= N; if (K < AREA - N / 2) K += N;
      sc.S.K = K; sc.S.m = { pos: 0, v: 0 }; LCD.jpNeedle = 0; LCD.shake(14, .28);
    },
    update(sc) {
      sc.S.m = reelMotion(sc.t - 4, sc.S.K); LCD.jpNeedle = mod(sc.S.m.pos / N, 1);
      C.cues(sc, [[.065, () => LCD.flash(.7, '#ffd890', .7 / (.48 * sc.scale))], [.8, () => { LCD.punch(.05); LCD.shake(18, .3); }], [2.1, () => { LCD.flash(.6, '#ffe8a0', 6); LCD.shake(20, .4); LCD.punch(.06); }],
        [4.0, () => { LCD.punch(.025); LCD.shake(8, .2); }], [7.85, () => { LCD.punch(.04); LCD.shake(9, .25); }], [10.6, () => { LCD.flash(.45, '#ffe0a0', 5); LCD.shake(14, .3); LCD.punch(.03); }],
        [11.2, () => { LCD.flash(.8, '#fff0c8', 5); LCD.shake(20, .5); LCD.punch(.065); }], [14.4, () => { LCD.flash(.6, '#ffe0a8', 5); LCD.shake(22, .5); LCD.punch(.055); }]]);
    },
    draw(c, t, sc) {
      const S = sc.S;
      C.fade(c, t, 20, 1.35, c => {
        const v = visT(t);
        if (t < .64) {
          bgFor(c, t, 'A');
          const u = t / .64;
          LCD.radial(c, 640, 360, 260 + u * 600, '255,190,90', .75 * (1 - u * .5));
          LCD.flip(c, 'impact_2', t, 640, 360, { s: 3.2, a: .6 });
          LCD.add(c, 'flare_ring.png', 640, 360, { w: 300 + u * 1500, h: 200 + u * 900, a: .8 * (1 - u) });
          sparkle(c, t, 50); C.hitBloom(c, t); return;
        }
        if (t < 4) {
          bgFor(c, t < 3.7 ? v : t, t < 3.7 ? 'B' : 'C'); sparkle(c, v, 50);
          const k = easeOut((v - .64) / .45), band = smooth((t - .8) / .3);
          // カットイン: 斜めの帯が左から走り込む(縁は虹)
          c.save(); c.translate(640, 300); c.rotate(-.06); c.globalAlpha = .88 * band;
          const bw = 1700 * easeOut((t - .8) / .3);
          c.fillStyle = 'rgba(30,0,40,.8)'; c.fillRect(-850, -165, bw, 330);
          for (const [yy, hh] of [[-168, 7], [161, 7]]) { const g = c.createLinearGradient(-850, 0, 850, 0); g.addColorStop(0, '#ff3a6a'); g.addColorStop(.33, '#ffd24a'); g.addColorStop(.66, '#4af0a0'); g.addColorStop(1, '#6a8aff'); c.fillStyle = g; c.fillRect(-850, yy, bw, hh); }
          c.restore();
          for (let i = 0; i < 7; i++) { const x = ((t * 1700 * (.7 + i * .07)) + i * 380) % 2200 - 400; LCD.add(c, 'flare_streak.png', x, 160 + i * 66, { w: 480, h: 10, a: .5 * band, tint: ['#ff6ab0', '#ffd24a', '#7affc0', '#7ab8ff'][i % 4] }); }
          LCD.flip(c, 'speed_2', t - .8, 640, 300, { s: 2.2, a: .4 });
          C.rainbowHero(c, v, 640, -220 + k * 520 + (t > .8 ? 0 : 0), 15, 1 - smooth((t - 3.1) / .5));
          LCD.add(c, 'flare_ring.png', 640, 300, { w: 1000, h: 560, a: .45 * band, rot: t });
          if (t < 3.6) C.team(c, v, 676, { n: 6, scale: 3, gap: 177, hop: 12, a: 1 - smooth((t - 3.1) / .4) });
          if (t >= 2.1) {
            const u = t - 2.1;
            LCD.flip(c, 'impact_2', u, 640, 520, { s: 3, a: .55 }); LCD.flip(c, 'shock_2', u, 640, 520, { s: 3.2, a: .5 });
            LCD.add(c, 'flare_streak.png', 640, 520, { w: 1500, h: 150, a: .6 * (1 - smooth(u / 1.4)) });
          }
          jackpotTitle(c, t);
          if (t >= 3.3) { /* 左右のウパが次のリールを見守る位置へ */ }
          if (t >= 3.7) reelGroup(c, t, S);
          C.jpFestival(c, v, v * .4, .9);
          return;
        }
        if (t >= 4 && t < 11.2) { bgFor(c, t, 'C'); sparkle(c, t, 40); reelGroup(c, t, S); return; }
        // ---- 11.2〜: 当選額 ----
        bgFor(c, t, 'D'); sparkle(c, t, 60);
        const payout = S.payout, u = easeOut((t - 11.2) / 2.65), count = LCD.landed(payout, Math.min(payout, Math.floor(payout * u)));
        LCD.flip(c, 'digitburst_2', t - 11.2, 640, 470, { s: 2.2, a: .75 });
        LCD.flip(c, 'shock_2', t - 11.2, 640, 470, { s: 3, a: .6 });
        if (t >= 14.4) { LCD.flip(c, 'shock_2', t - 14.4, 640, 470, { s: 3.2, a: .5 }); ballBurst(c, t); }
        C.rainbowHero(c, t, 640, 262, 14);
        jackpotTitle(c, t);
        const hit = .6 + .4 * easeOutBack((t - 11.2) / .4), nw = String(C.total(S.payout)).length * 152;
        LCD.add(c, 'flare_streak.png', 640, 490, { w: 1500, h: 190, a: .6 });
        c.save(); c.translate(640, 490); c.scale(hit, hit); c.translate(-640, -490);
        C.numberDepth(c, count, 640 - 70 + 0, 490, 230, true, { maxW: 800, depth: .09, near: '#6a1060', far: '#240040' });
        c.restore();
        LCD.text(c, '玉', 640 + nw / 2 + 20, 540, { size: 96, fill1: '#fffbd4', fill2: '#ffb000', glow: '#ff5a00', a: smooth((t - 11.3) / .3) });
        C.team(c, t, 676, { n: 6, rainbow: true, gap: 150, hop: 22 });
        const guide = LCD.env(t, 11.8, 19, .4, .5);
        LCD.text(c, 'さらへ', 1190, 565, { size: 42, a: guide, fill2: '#ffe27a' });
        LCD.arrow(c, 1190, 645, 'down', t, { s: .75, a: guide });
        C.jpFestival(c, t, t * .5, 1);
      });
      if (t < .64) C.hitBloom(c, t);
    }
  });
})();
