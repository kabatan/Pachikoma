/* 計数(finish_count)と結果(result)を、動画の液晶の縦の窓(1152×1268)に配置し直した版。数字の入る所は空けて書き出し、
 * 液晶の面(lcd_surface/end_digits.mjs)が実際の値を重ねる。元の 16:9 の場面は effects/lcd/scenes/c_end.js(絵の作りはそれに合わせる)。
 * 安全範囲：字とものさしは x 32〜1120。上の縁 y 52〜122 は射出器の首と球が往復するので大事な物を置かない。
 * 数字の入る所(枠)は毎コマ sc.S.slots に積む。書き出し(render_end_v.mjs)がコマごとに記録して、重ね描きの位置と大きさにする。
 * 引数：rank(最終ランク 0〜4)、rep(映像の中でものさしが数え上がる JP の合計の代表値)、thresholds(C/B/A/S の境)、
 *       hintRank(「あと N玉で X ランク」の X。無ければ出さない)、prize(景品名)、loanBalls(もう一度遊ぶ時の玉) */
(function () {
  const C = LCD.C, { smooth, clamp, easeOut, TAU } = LCD;
  const VW = 1152, VH = 1268, CX = VW / 2;
  const RANKS = ['参加賞', 'C', 'B', 'A', 'S', 'SS'];
  const KEYS = ['rank_sankasho', 'rank_c', 'rank_b', 'rank_a', 'rank_s', 'rank_ss'];
  const COLORS = ['#ff4585', '#d97333', '#ccd9ff', '#ffa818', '#ff8a00', '#ff2a78'];
  const P = [
    { bg0: '#a02060', bg1: '#2a0618', hue: 335, near: '#8a2a5a', far: '#2a0a1e', rim: '#ffd0e4', conf: ['#ff7fb2', '#ffd0e4', '#fff', '#ffb0cc'] },
    { bg0: '#92340f', bg1: '#220a04', hue: 22, near: '#8a3a12', far: '#2a0e06', rim: '#ffc890', conf: ['#e0833c', '#ffb070', '#c4602a', '#ffd9b0'] },
    { bg0: '#2c4a90', bg1: '#08122e', hue: 218, near: '#5a6f90', far: '#1a2540', rim: '#ffffff', conf: ['#dfeaff', '#9ab8ff', '#ffffff', '#b8ccf0'] },
    { bg0: '#b02818', bg1: '#2a0808', hue: 36, near: '#a86a00', far: '#3a1500', rim: '#ffe27a', conf: ['#ffc030', '#ffe27a', '#ff9a10', '#fff2b0'] },
    { bg0: '#c04a08', bg1: '#2a0a04', hue: 30, near: '#b86a08', far: '#3a1000', rim: '#fff0a0', conf: ['#ffa010', '#ffd24a', '#ff6a00', '#fff2b0'] },
    { bg0: '#b01058', bg1: '#1c0214', hue: 345, near: '#a02050', far: '#2a0214', rim: '#fff0c0', conf: ['#ff2a78', '#ffd24a', '#ffffff', '#ff8aa8'] }
  ];
  const HUPA = [235, 35, 190, 70, 35, 0];
  const EXTRA = ['branch_bl.png', 'branch_br.png', 'edge_gold_h.png', 'ribbon_2.png', 'ribbon_3.png', 'plate_A.png', 'plate_S.png', 'plate_B6.png', 'rl_rim.png'];
  const countAt = (t, total) => Math.min(total, Math.floor(total * smooth((t - .5) / 3.9)));
  const slot = (sc, o) => { (sc.S.slots ||= []).push(o); };
  const measure = (str, size) => { const g = LCD.ctx; g.save(); g.font = LCD.fontFor(size); const w = g.measureText(str).width; g.restore(); return w; };

  // ---- 背景(ランクの深い色。縦の窓いっぱい) ----
  function background(c, t, rank, o = {}) {
    const p = P[rank], col = COLORS[rank], k = o.k ?? 1, cy = o.cy ?? 470;
    const g = c.createRadialGradient(CX, cy, 20, CX, cy, 1250); g.addColorStop(0, p.bg0); g.addColorStop(1, p.bg1); c.fillStyle = g; c.fillRect(-120, -120, VW + 240, VH + 240);
    C.sunburst(c, t, CX, cy, { a: (.34 + rank * .04) * k, n: 24, hue: p.hue, rot: t * (.1 + rank * .02), len: 1900, light: 50 });
    if (rank >= 3) C.sunburst(c, t + 2, CX, cy, { a: .22 * k, n: 18, hue: p.hue + 24, rot: -t * .08, len: 1900, light: 52 });
    LCD.add(c, 'glow_soft.png', CX, cy + 40, { w: 1300, h: 1300, a: (.34 + rank * .03) * k, tint: col });
    LCD.add(c, 'crest_glow.png', CX, cy, { w: 980, h: 980, rot: -t * .07, tint: col, a: .22 * k });
    // 枠の飾りは全ランク同じ金(色ごとに付けていた色味と薄さをやめる)
    for (const right of [false, true]) LCD.blit(c, right ? 'corner_gold_tr.png' : 'corner_gold_tl.png', right ? VW : 0, 0, { w: 230, h: 230, ax: right ? 1 : 0, ay: 0, a: .9 });
    for (const y of [14, VH - 14]) LCD.blit(c, 'edge_gold_h.png', CX, y, { w: VW + 40, h: 38, a: .8 });
  }
  function streams(c, t, color, inward, amount = 1, cy = 470) {
    const rnd = LCD.rng(209);
    for (let i = 0; i < 32; i++) {
      const angle = rnd() * TAU, phase = (t * .72 + rnd()) % 1, u = inward ? 1 - phase : phase, r = 40 + u * 900;
      LCD.add(c, 'flare_streak.png', CX + Math.cos(angle) * r, cy + Math.sin(angle) * r * .95, { w: 80 + u * 330, h: 8 + rnd() * 12, rot: angle, tint: color, a: Math.sin(phase * Math.PI) * .6 * amount });
    }
  }
  function confetti(c, t, rank, amount = 1) {
    const rnd = LCD.rng(374), cols = P[rank].conf, n = Math.round((30 + rank * 30) * amount);
    for (let i = 0; i < n; i++) {
      const z = .5 + rnd(), x = (rnd() * 1260 + Math.sin(t * 1.4 + i) * 60 - 60 + t * 20 * z) % 1260 - 54, y = ((rnd() * 1460 + t * (90 + 90 * z)) % 1460) - 110, ang = t * (2 + rnd() * 3) + i;
      c.save(); c.translate(x, y); c.rotate(rnd() * TAU + t * .5); c.scale(1, Math.cos(ang)); c.globalAlpha = .9; c.fillStyle = cols[i % cols.length];
      c.fillRect(-9 * z, -14 * z, 18 * z, 28 * z); c.restore();
    }
    for (let i = 0; i < 30 + rank * 10; i++) {
      const z = .4 + rnd(), x = rnd() * VW, y = (rnd() * 1500 + t * (38 + 45 * z)) % 1500 - 100;
      LCD.add(c, i % 3 ? 'spark.png' : 'glint_1.png', x, y, { w: (i % 3 ? 16 : 40) * z, h: (i % 3 ? 16 : 40) * z, a: (.35 + .35 * Math.sin(t * 3 + i) ** 2) * amount, tint: COLORS[rank] });
    }
  }
  function fireworks(sc, rank, now) {
    const s = sc.S, interval = rank >= 5 ? .32 : rank >= 4 ? .42 : rank >= 3 ? .6 : rank >= 2 ? .95 : 99;
    if (now - (s.lastFw ?? -9) < interval) return; s.lastFw = now;
    const x = 110 + sc.rand() * 930, y = 160 + sc.rand() * 420, n = 20 + rank * 6, cols = P[rank].conf;
    for (let j = 0; j < n; j++) { const a = j / n * TAU + sc.rand() * .2, v = 150 + sc.rand() * 170; s.P.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 130, drag: 1.6, life: .9 + sc.rand() * .5, s0: .28, s1: .05, tint: cols[j % cols.length], img: j % 5 ? 'spark.png' : 'glint_1.png' }); }
  }
  // 応援のウパ(元の C.team と同じ絵。縦の窓の中心で並べる)
  function team(c, t, y, o = {}) {
    const n = o.n ?? 5, scale = o.scale ?? 3;
    for (let i = 0; i < n; i++) { const x = CX + (i - (n - 1) / 2) * (o.gap ?? 175), hop = Math.max(0, Math.sin(t * 5.6 - i * .65)) * (o.hop ?? 15);
      LCD.radial(c, x, y + 32, 90, '255,199,127', .2 * (o.a ?? 1));
      LCD.upa(c, x, y - hop, { scale, hue: LCD.HUES[i], mood: 'happy', t, a: o.a ?? 1 });
      if (hop > 8) LCD.add(c, 'glint_1.png', x + 45, y - 34, { w: 25, h: 25, a: .65 * (o.a ?? 1) });
    }
  }
  // 「あと [数]玉で [X]ランク!」。数は空けて枠を積む(液晶の面が重ねる)。gap は 2 桁ぶん
  function hintLine(c, sc, t, x, y, r, size, a = 1) {
    const col = COLORS[r], A1 = 'あと', A2 = '玉で', B = 'ランク!', dh = size * 1.25, gap = dh * .78 * 2;
    const w1 = measure(A1, size), w2 = measure(A2, size), wB = measure(B, size), gl = size * 1.55, sp = 12;
    const total = w1 + sp + gap + sp + w2 + sp + gl + sp + wB;
    let left = x - total / 2;
    LCD.text(c, A1, left + w1 / 2, y, { size, a, fill1: '#fffbe8', fill2: '#ffe27a', glow: col }); left += w1 + sp;
    slot(sc, { key: 'to_next', cx: left + gap / 2, cy: y + size * .04, h: dh, a }); left += gap + sp;
    LCD.text(c, A2, left + w2 / 2, y, { size, a, fill1: '#fffbe8', fill2: '#ffe27a', glow: col }); left += w2 + sp;
    LCD.add(c, 'glow_soft.png', left + gl / 2, y, { w: gl * 1.9, h: gl * 1.6, a: .55 * a, tint: col });
    C.extrude(c, KEYS[r], RANKS[r], left + gl / 2, y, gl * (r === 0 ? 2.6 : 1), gl, { a, depth: .06, near: P[r].near, far: P[r].far, rim: P[r].rim });
    left += gl + sp;
    LCD.text(c, B, left + wB / 2, y, { size, a, fill1: '#fffbe8', fill2: '#ffe27a', glow: col });
  }
  function backing(c, x, y, w, h, a = 1) {
    c.save(); c.globalAlpha *= .62 * a; const g = c.createRadialGradient(x, y, 0, x, y, 1); g.addColorStop(0, 'rgba(14,4,22,1)'); g.addColorStop(.6, 'rgba(14,4,22,.75)'); g.addColorStop(1, 'rgba(14,4,22,0)');
    c.translate(x, y); c.scale(w / 2, h / 2); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore();
  }
  // 「玉」は本文の書体(M PLUS 1p)で縁を細く。見出し書体(Dela Gothic)の「玉」は点が下の横棒にくっつき「王」に見えた
  const unit = (c, x, y, size, o = {}) => LCD.text(c, '玉', x, y, { size, font: 'body', stroke: size * .085, fill1: '#fffbe0', fill2: '#ffc640', glow: '#ff7a00', ...o });
  function fitText(c, str, x, y, size, width, o = {}) { LCD.text(c, str, x, y, { size: Math.min(size, size * width / Math.max(1, measure(str, size))), ...o }); }
  const recolor = () => {
    if (LCD.img['t_rank_ss_g_face.png'] || !LCD.img['t_rank_ss_face.png']) return;
    for (const q of ['face', 'glow', 'shadow']) {
      const im = LCD.img[`t_rank_ss_${q}.png`]; if (!im) continue;
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d');
      g.filter = q === 'face' ? 'grayscale(1) sepia(1) saturate(4) hue-rotate(-18deg) brightness(1.15) contrast(1.1)' : q === 'glow' ? 'grayscale(1) sepia(1) saturate(4) hue-rotate(-30deg)' : 'none';
      g.drawImage(im, 0, 0); LCD.img[`t_rank_ss_g_${q}.png`] = cv;
    }
  };
  const MX0 = 128, MX1 = 1024, MY = 752;   // ランクのものさし(C〜S の 4 つの境)。字の外側まで x 60〜1092
  const tickX = (i, n) => MX0 + (MX1 - MX0) * i / Math.max(1, n - 1);

  LCD.scene({ id: 'finish_count_v', dur: 6, hold: true, cover: true, assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS), 'flip:impact_2'],
    start(sc, p) {
      recolor();
      sc.S.rank = clamp(Math.floor(p.rank ?? 0), 0, 4); sc.S.rep = C.total(p.rep ?? 0);
      sc.S.thresholds = (p.thresholds ?? [30, 200, 320, 500]).slice(0, 4);
      sc.S.crossed = sc.S.thresholds.map(() => -99); sc.S.P = LCD.particles(260, 752);
    },
    update(sc, dt) {
      sc.S.P.step(dt); const count = countAt(sc.t, sc.S.rep);
      sc.S.thresholds.forEach((v, i) => {
        if (count < v || i >= sc.S.rank || sc.S.crossed[i] !== -99) return;
        sc.S.crossed[i] = sc.t; LCD.shake(5 + i * 2, .22); LCD.punch(.012 + i * .004);
        const x = tickX(i, sc.S.thresholds.length);
        for (let j = 0; j < 30; j++) { const angle = sc.rand() * TAU, v = 80 + sc.rand() * 220; sc.S.P.emit({ x, y: MY, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 90, ay: 120, life: .6 + sc.rand() * .5, s0: .22 + sc.rand() * .2, s1: 0, tint: COLORS[i + 1], img: j % 4 ? 'spark.png' : 'glint_1.png' }); }
      });
    },
    draw(c, t, sc) {
      const S = sc.S; S.slots = [];
      const count = countAt(t, S.rep), cur = Math.min(S.rank, S.thresholds.filter(v => count >= v).length), col = COLORS[cur];
      background(c, t, cur); confetti(c, t, cur, .45);
      LCD.text(c, 'JPで もらった玉', CX, 214, { size: 72, font: 'body', stroke: 13, fill1: '#fffbe8', fill2: col === '#ccd9ff' ? '#dfe9ff' : '#ffe0a0', glow: col });
      // JP の合計(景品はこれで決まる)。数は右寄せで「玉」の左へ重ねる。ものさしはこの値で伸びる
      LCD.add(c, 'flare_streak.png', CX, 430, { w: 1250, h: 170, a: .45, tint: col });
      backing(c, CX - 10, 432, 880, 340);
      slot(sc, { key: 'score', right: 770, cy: 432, h: 250, cv: count });
      unit(c, 852, 484, 108);
      // ランクのものさし
      c.save(); c.strokeStyle = '#e6d9ff'; c.lineWidth = 6; c.globalAlpha = .75; c.beginPath(); c.moveTo(MX0, MY); c.lineTo(MX1, MY); c.stroke(); c.restore();
      S.thresholds.forEach((v, i) => {
        const x = tickX(i, S.thresholds.length), since = t - S.crossed[i], reached = count >= v && i < S.rank, cc = COLORS[i + 1];
        if (reached) {
          LCD.add(c, 'glow_soft.png', x, MY, { w: 210 + 120 * (1 - smooth(since / .6)), h: 280, a: .6, tint: cc });
          LCD.add(c, 'glint_1.png', x, MY, { w: 76 + 90 * (1 - smooth(since / .5)), h: 76 + 90 * (1 - smooth(since / .5)), a: .95 });
          LCD.add(c, 'flare_ring.png', x, MY, { w: 60 + 210 * smooth(since / .7), h: 60 + 210 * smooth(since / .7), a: .7 * (1 - smooth(since / .8)) });
        }
        c.save(); c.strokeStyle = reached ? cc : '#b6a8d8'; c.lineWidth = reached ? 8 : 4; c.beginPath(); c.moveTo(x, MY - 22); c.lineTo(x, MY + 22); c.stroke(); c.restore();
        C.extrude(c, KEYS[i + 1], RANKS[i + 1], x, MY - 78, 168, 94, { a: reached ? 1 : .42, depth: .05, near: P[i + 1].near, far: P[i + 1].far, rim: P[i + 1].rim, glowA: reached ? 1 : .2 });
        LCD.text(c, `${v.toLocaleString('ja-JP')}玉`, x, MY + 56, { size: 40, a: reached ? 1 : .75, fill1: reached ? '#fff6d0' : '#d6cdee' });
      });
      S.P.draw(c);
      const done = t >= 4.4, label = cur === 0 ? '参加賞' : `${RANKS[cur]}ランク`;
      LCD.text(c, done ? `けっか ${label}!` : `いまは ${label}`, CX, 906, { size: 66, fill1: '#fffbe8', fill2: col === '#ccd9ff' ? '#dfe9ff' : '#ffe27a', glow: col });
      if (done && sc.params.hintRank != null) hintLine(c, sc, t, CX, 992, sc.params.hintRank, 50, smooth((t - 4.4) / .3));
      // 脇：のこった 玉(持ち玉。景品には関係しない)。小さい札
      const bx = CX, by = 1120;
      c.save(); c.globalAlpha = .6; c.fillStyle = 'rgba(8,4,26,.85)'; c.strokeStyle = 'rgba(230,217,255,.55)'; c.lineWidth = 3; c.beginPath(); c.roundRect(bx - 275, by - 46, 550, 92, 22); c.fill(); c.stroke(); c.restore();
      LCD.text(c, 'のこった 玉', bx - 132, by, { size: 40, fill1: '#f2ecff', fill2: '#d6cdee' });
      slot(sc, { key: 'balls', right: bx + 186, cy: by + 2, h: 70, u: smooth((t - .5) / 2.2) });
      unit(c, bx + 220, by + 8, 40, { fill1: '#f2ecff', fill2: '#d6cdee', glow: undefined });
    }
  });

  LCD.scene({ id: 'result_v', dur: 9, cover: true,
    assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS, 'arigato'), 'flip:pillar_2', 'flip:shock_2', 'flip:impact_2', 'flip:digitburst_2'],
    start(sc, p) {
      recolor();
      sc.S.rank = clamp(Math.floor(p.rank ?? 0), 0, RANKS.length - 1);
      sc.S.prize = p.prize ?? (sc.S.rank === 0 ? RANKS[0] : RANKS[sc.S.rank] + '賞');
      sc.S.P = LCD.particles(400, 31);
    },
    update(sc, dt) {
      sc.S.P.step(dt);
      const r = sc.S.rank;
      C.cues(sc, [[2, () => {
        LCD.flash(r === 0 ? .4 : .5 + r * .05, r === 0 ? '#ffd0e4' : r === 1 ? '#ffd0a0' : r === 2 ? '#e8f0ff' : '#ffe8a0', 5); LCD.shake(8 + r * 3, .4 + r * .05); LCD.punch(.04 + r * .006);
        for (let j = 0; j < 40 + r * 14; j++) { const a = sc.rand() * TAU, v = 120 + sc.rand() * 520; sc.S.P.emit({ x: CX, y: 470, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 1.8, life: .8 + sc.rand() * .6, s0: .3 + sc.rand() * .2, s1: .05, tint: P[r].conf[j % 4], img: j % 4 ? 'spark.png' : 'glint_1.png' }); }
      }]]);
      if (sc.t > 2.3 && sc.t < 6.4) fireworks(sc, r, sc.t);
    },
    draw(c, t, sc) {
      const S = sc.S, rank = S.rank, col = COLORS[rank], p = P[rank]; S.slots = [];
      const fade = 1 - smooth((t - 8.65) / .35);
      if (fade <= 0) return;
      c.save(); c.globalAlpha = fade;   // 最後の 0.35 秒で消える(元の C.fade と同じ)
      if (t < 2) {
        const gather = smooth(t / 2); background(c, t, rank, { k: .6 }); c.save(); c.globalAlpha *= .55 - gather * .25; c.fillStyle = '#08041a'; c.fillRect(0, 0, VW, VH); c.restore();
        streams(c, t * (1 + gather), col, true, .7 + gather * .6);
        LCD.add(c, 'glow_soft.png', CX, 470, { w: 760 - gather * 440, h: 620 - gather * 360, a: .5 + .3 * gather, tint: col });
        LCD.add(c, 'flare_streak.png', CX, 470, { w: 1150 * gather, h: 70, a: .6 * gather, tint: col });
        LCD.text(c, 'あなたの 景品は…', CX, 720, { size: 74, a: LCD.env(t, .1, 2, .2, .2), fill1: '#fffbe8', fill2: '#ffe8c0', glow: col });
        LCD.upa(c, CX + Math.sin(t * 2) * 10, 900, { scale: 5, mood: 'smile' });
        c.restore(); return;
      }
      background(c, t, rank); confetti(c, t, rank); if (rank >= 3) streams(c, t, col, false, rank >= 5 ? .9 : .55);
      const u = t - 2, m = smooth((t - 6.1) / .6);
      LCD.flip(c, 'impact_2', u, CX, 470, { s: rank === 0 ? 2.6 : 3.6, a: .6 });
      LCD.flip(c, 'shock_2', u, CX, 470, { s: 3.2, a: .5 });
      if (rank >= 3) LCD.flip(c, 'pillar_2', u, CX, 460, { s: 3.2, a: .5 });
      LCD.add(c, 'flare_ring.png', CX, 470, { w: 1060 + Math.sin(t * 2) * 25, h: 620, rot: t * .09, a: .45, tint: col });
      LCD.add(c, 'flare_streak.png', CX, 470, { w: 1300, h: 170, a: .55, tint: col });
      // ランクの立体文字。ドンと近くから叩きつけ、軽く弾んで落ち着く。6.1 秒から上へ小さく退いて「もういちど」に場所を譲る
      const slam = u < .22 ? 2.2 + (.92 - 2.2) * (u / .22) ** 2 : .92 + .08 * easeOut((u - .22) / .3);
      const W0 = rank === 0 ? 980 : 760, H0 = rank === 0 ? 300 : 420, W1 = rank === 0 ? 700 : 470, H1 = rank === 0 ? 210 : 260;
      const tw = W0 + (W1 - W0) * m, th = H0 + (H1 - H0) * m, tx = CX, ty = 470 + (300 - 470) * m;
      C.extrude(c, KEYS[rank], RANKS[rank], tx, ty, tw, th, { zoom: slam * (1 + .012 * Math.sin(t * 2.7)), a: clamp(u / .08), glowA: rank >= 3 ? 1.2 : .9, near: p.near, far: p.far, rim: p.rim, depth: .085 });
      if (rank >= 3) LCD.add(c, 'glint_1.png', tx + 140 * Math.sin(t * 2), ty - th * .3, { w: 130, h: 130, a: .8 * clamp(u), tint: '#fff' });
      S.P.draw(c);
      // 景品名(札)と あと N玉
      const pa = smooth((t - 3.2) / .3), py = 760 + (520 - 760) * m, pw = 960 + (760 - 960) * m;
      if (pa > 0) {
        c.save(); c.globalAlpha *= pa * .75; c.fillStyle = 'rgba(8,4,26,.8)'; c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.roundRect(CX - pw / 2, py - 52, pw, 104, 22); c.fill(); c.stroke(); c.restore();
        // [JPで もらった玉][数(3 桁ぶん空ける)][玉] を札の中央へ
        const lw = measure('JPで もらった玉', 42), nw = 210, left = CX - (lw + 26 + nw + 12 + 56) / 2;
        LCD.text(c, 'JPで もらった玉', left + lw / 2, py, { size: 42, a: pa, fill1: '#fff6d0', fill2: '#ffd98a', glow: col });
        slot(sc, { key: 'score', right: left + lw + 26 + nw, cy: py + 2, h: 92, a: pa });
        unit(c, left + lw + 26 + nw + 12 + 28, py + 8, 56, { a: pa });
        if (sc.params.hintRank != null) hintLine(c, sc, t, CX, py + 118, sc.params.hintRank, 50, smooth((t - 3.7) / .3) * fade);
      }
      // ウパの祝福(両脇の大きなウパは A 以上)
      if (rank >= 3) for (const [x, k] of [[128, 0], [1024, 1]]) { const sa = 1 - m; if (sa <= 0) continue; LCD.add(c, 'glow_soft.png', x, 470, { w: 360, h: 330, a: .5 * sa, tint: col }); LCD.upa(c, x, 470 - Math.max(0, Math.sin(t * 5 - k)) * 16, { scale: 4, hue: HUPA[rank], mood: 'happy', a: sa }); }
      const gone = 1 - smooth((t - 6.1) / .3);
      if (gone > 0) team(c, t, 1150, { scale: 3, gap: 190, hop: rank === 0 ? 12 : 16 + rank * 2, a: gone });
      // 6.3〜 もういちど あそぶ?
      const ia = smooth((t - 6.3) / .35);
      if (ia > 0) {
        const beat = .5 + .5 * Math.sin((t - 6.3) * TAU / 1.4), z = 1 + .035 * beat, by = 850;
        c.save(); c.globalAlpha *= ia * .55; c.fillStyle = 'rgba(8,4,26,.85)'; c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.roundRect(CX - 440, by - 146, 880, 320, 30); c.fill(); c.stroke(); c.restore();
        c.save(); c.translate(CX, by - 10); c.scale(z, z); c.translate(-CX, -(by - 10));
        LCD.add(c, 'glow_soft.png', CX, by - 10, { w: 860, h: 340, a: .45 * ia * (.6 + .4 * beat), tint: '#ffb000' });
        LCD.text(c, 'もういちど', CX, by - 70, { size: 92, a: ia, fill1: '#fff9de', fill2: '#ffc030', glow: '#ff8a00' });
        LCD.text(c, 'あそぶ?', CX, by + 40, { size: 104, a: ia, fill1: '#fff9de', fill2: '#ffc030', glow: '#ff8a00' });
        c.restore();
        LCD.text(c, `すぐに ${sc.params.loanBalls ?? 80}玉 もらえる!`, CX, by + 128, { size: 50, a: ia, fill1: '#fffbe8', fill2: '#ffe0a0' });
        // 実物のボタン(筐体の左下)を指す
        c.save(); c.globalAlpha *= ia * .85; const g = c.createLinearGradient(0, 1040, 0, VH); g.addColorStop(0, 'rgba(6,4,24,0)'); g.addColorStop(.35, 'rgba(6,4,24,.88)'); g.addColorStop(1, 'rgba(6,4,24,.95)'); c.fillStyle = g; c.fillRect(0, 1040, VW, VH - 1040); c.restore();
        for (let r = 0; r < 2; r++) { const q = (t * .9 + r * .5) % 1; LCD.add(c, 'flare_ring.png', 40, 1236, { w: 90 + q * 200, h: 90 + q * 200, a: ia * (1 - q) * .85, tint: '#ffd24a' }); }
        LCD.buttonArrow(c, 120, 1176 + Math.sin(t * 6) * 4, 'left', t, { s: .85, a: ia * (.7 + .3 * beat) });
        LCD.text(c, 'ひかる 左の ボタンを おす', 640, 1180, { size: 56, a: ia, stroke: 9, fill1: '#fff4d9', fill2: '#ffcf98', glow: '#b46355' });
      }
      c.restore();
    }
  });
})();
