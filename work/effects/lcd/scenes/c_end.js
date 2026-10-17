/* 終了の2場面(計数 finish_count 4-6秒 / 結果 result 5-9秒)。10/17 作り直し。
 * 数値は開始時のLCD.rules()を使い、実際の最終結果だけを祝う。虹はJPと大成功だけ(ここでは使わない)。
 * ランクの主色(筐体の電飾と合わせる): 参加賞=桜ピンク #ff4585 / C=銅 #d97333 / B=銀青 #ccd9ff / A=金 #ffa818 / S=濃い金橙 #ff8a00 / SS=マゼンタ寄りの赤金 #ff2a78+金。 */
(function () {
  const C = LCD.C, { smooth, clamp, easeOut, easeOutBack, TAU } = LCD;
  const RANKS = ['参加賞', 'C', 'B', 'A', 'S', 'SS'];
  const KEYS = ['rank_sankasho', 'rank_c', 'rank_b', 'rank_a', 'rank_s', 'rank_ss'];
  const TITLE_KEYS = KEYS.slice();   // SS は後で金に塗り替えた rank_ss_g を使う
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
  const LIMIT = 27;   // 「あと N 玉」は N≤27 のときだけ
  const countAt = (t, total) => Math.min(total, Math.floor(total * smooth((t - .5) / 3.9)));
  const prize = (rules, rank) => (rules.prizeNames || rules.PrizeNames || [])[rank] || (rank === 0 ? RANKS[rank] : RANKS[rank] + '賞');
  // SS の虹の文字を金/赤金に塗り替えた別名素材(虹はJPと大成功だけ)
  const recolor = () => {
    if (LCD.img['t_rank_ss_g_face.png'] || !LCD.img['t_rank_ss_face.png']) return;
    for (const q of ['face', 'glow', 'shadow']) {
      const im = LCD.img[`t_rank_ss_${q}.png`]; if (!im) continue;
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d');
      g.filter = q === 'face' ? 'grayscale(1) sepia(1) saturate(4) hue-rotate(-18deg) brightness(1.15) contrast(1.1)' : q === 'glow' ? 'grayscale(1) sepia(1) saturate(4) hue-rotate(-30deg)' : 'none';
      g.drawImage(im, 0, 0); LCD.img[`t_rank_ss_g_${q}.png`] = cv;
    }
  };
  const nextHint = sc => {
    const { to_next: n, next_rank: r } = sc.params;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= LIMIT && Number.isInteger(r) && r > (sc.S.rank ?? 0) && r < RANKS.length ? { n, r } : null;
  };
  // 「あと N玉で [S]ランク!」(次のランクの色の立体文字つき)
  function hintLine(c, t, x, y, h, size, a = 1) {
    const { n, r } = h, col = COLORS[r], pulse = 1 + .035 * Math.sin(t * 6);
    const A = `あと ${n}玉で`, B = 'ランク!';
    c.save(); c.font = LCD.fontFor(size); const wA = c.measureText(A).width, wB = c.measureText(B).width; c.restore();
    const key = r === 5 ? 'rank_ss_g' : KEYS[r], gl = size * 1.55, gap = 12, total = wA + gap + gl + gap + wB;
    c.save(); c.translate(x, y); c.scale(pulse, pulse); c.translate(-x, -y);
    let left = x - total / 2;
    LCD.text(c, A, left + wA / 2, y, { size, a, fill1: '#fffbe8', fill2: '#ffe27a', glow: col }); left += wA + gap;
    LCD.add(c, 'glow_soft.png', left + gl / 2, y, { w: gl * 1.9, h: gl * 1.6, a: .55 * a, tint: col });
    C.extrude(c, key, RANKS[r], left + gl / 2, y, gl * (r === 0 ? 2.6 : 1), gl, { a, depth: .06, near: P[r].near, far: P[r].far, rim: P[r].rim });
    left += gl + gap;
    LCD.text(c, B, left + wB / 2, y, { size, a, fill1: '#fffbe8', fill2: '#ffe27a', glow: col });
    c.restore();
  }
  function fitText(c, str, x, y, size, width, o = {}) {
    c.save(); c.font = LCD.fontFor(size); const w = c.measureText(str).width; c.restore();
    LCD.text(c, str, x, y, { size: Math.min(size, size * width / Math.max(1, w)), ...o });
  }
  // ---- 背景(ランクの深い色。光の筋はランク色の単色。虹は使わない) ----
  function background(c, t, rank, o = {}) {
    const p = P[rank], col = COLORS[rank], k = o.k ?? 1;
    C.deepBg(c, p.bg0, p.bg1, 300, 980);
    C.sunburst(c, t, 640, 320, { a: (.34 + rank * .04) * k, n: 24, hue: p.hue, rot: t * (.1 + rank * .02), len: 1500, light: 50 });
    if (rank >= 3) C.sunburst(c, t + 2, 640, 320, { a: .22 * k, n: 18, hue: p.hue + 24, rot: -t * .08, len: 1500, light: 52 });
    LCD.add(c, 'glow_soft.png', 640, 330, { w: 1300, h: 860, a: (.34 + rank * .03) * k, tint: col });
    LCD.add(c, 'crest_glow.png', 640, 320, { w: 780, h: 780, rot: -t * .07, tint: col, a: .22 * k });
    if (rank === 0) for (const [name, x, y, ax, ay] of [['branch_tl.png', 0, 0, 0, 0], ['branch_tr.png', 1280, 0, 1, 0], ['branch_bl.png', 0, 720, 0, 1], ['branch_br.png', 1280, 720, 1, 1]]) LCD.blit(c, name, x, y, { w: 385, h: 270, ax, ay, a: .6 });
    else for (const right of [false, true]) LCD.blit(c, right ? 'corner_gold_tr.png' : 'corner_gold_tl.png', right ? 1280 : 0, 0, { w: 210, h: 210, ax: right ? 1 : 0, ay: 0, a: rank === 1 ? .55 : .9, tint: rank === 1 ? '#e0a070' : rank === 2 ? '#cfe0ff' : undefined });
    if (rank >= 1) for (const y of [14, 706]) LCD.blit(c, 'edge_gold_h.png', 640, y, { w: 1320, h: 38, a: rank === 1 ? .5 : .8, tint: rank === 1 ? '#d8a284' : rank === 2 ? '#cfe0ff' : undefined });
  }
  function streams(c, t, color, inward, amount = 1) {
    const rnd = LCD.rng(209);
    for (let i = 0; i < 28; i++) {
      const angle = rnd() * TAU, phase = (t * .72 + rnd()) % 1, u = inward ? 1 - phase : phase, r = 40 + u * 760;
      LCD.add(c, 'flare_streak.png', 640 + Math.cos(angle) * r, 300 + Math.sin(angle) * r * .65, { w: 80 + u * 330, h: 8 + rnd() * 12, rot: angle, tint: color, a: Math.sin(phase * Math.PI) * .6 * amount });
    }
  }
  // 色紙の花吹雪(紙片がひらひら回る)。ランクが上がるほど多く、光る粒も足す
  function confetti(c, t, rank, amount = 1) {
    const rnd = LCD.rng(374), cols = P[rank].conf, n = Math.round((24 + rank * 24) * amount);
    for (let i = 0; i < n; i++) {
      const z = .5 + rnd(), x = (rnd() * 1400 + Math.sin(t * 1.4 + i) * 60 - 60 + t * 20 * z) % 1400 - 60, y = ((rnd() * 900 + t * (90 + 90 * z)) % 900) - 110, ang = t * (2 + rnd() * 3) + i;
      c.save(); c.translate(x, y); c.rotate(rnd() * TAU + t * .5); c.scale(1, Math.cos(ang)); c.globalAlpha = .9; c.fillStyle = cols[i % cols.length];
      c.fillRect(-9 * z, -14 * z, 18 * z, 28 * z); c.restore();
    }
    for (let i = 0; i < 24 + rank * 8; i++) {
      const z = .4 + rnd(), x = rnd() * 1280, y = (rnd() * 950 + t * (38 + 45 * z)) % 950 - 100;
      LCD.add(c, i % 3 ? 'spark.png' : 'glint_1.png', x, y, { w: (i % 3 ? 16 : 40) * z, h: (i % 3 ? 16 : 40) * z, a: (.35 + .35 * Math.sin(t * 3 + i) ** 2) * amount, tint: COLORS[rank] });
    }
  }
  function fireworks(sc, rank, now) {
    // 花火: ランクが高いほど頻繁・大きい。位置は時計(液晶右上=残り時間)を避ける。
    const s = sc.S, interval = rank >= 5 ? .32 : rank >= 4 ? .42 : rank >= 3 ? .6 : rank >= 2 ? .95 : 99;
    if (now - (s.lastFw ?? -9) < interval) return; s.lastFw = now;
    const x = 120 + sc.rand() * 1000, y = 120 + sc.rand() * 330;
    if (x > 760 && y < 170) return;
    const n = 20 + rank * 6, cols = P[rank].conf;
    for (let j = 0; j < n; j++) { const a = j / n * TAU + sc.rand() * .2, v = 150 + sc.rand() * 170; s.P.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 130, drag: 1.6, life: .9 + sc.rand() * .5, s0: .28, s1: .05, tint: cols[j % cols.length], img: j % 5 ? 'spark.png' : 'glint_1.png' }); }
    s.P.emit({ x, y, life: .35, s0: .3, s1: 1.4, a0: .7, img: 'flare_ring.png', tint: cols[0] });
  }
  LCD.scene({ id: 'finish_count', dur: 6, hold: true, cover: true, assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS), ...C.digitAssets(), 'flip:impact_2'],
    start(sc, p) {
      recolor();
      sc.S.rules = LCD.rules(); sc.S.total = C.total(p.total);
      sc.S.thresholds = sc.S.rules.thresholds.slice(0, RANKS.length - 1);
      sc.S.rank = sc.S.thresholds.filter(v => sc.S.total >= v).length;
      sc.S.crossed = sc.S.thresholds.map(() => -99); sc.S.P = LCD.particles(260, 752);
    },
    update(sc, dt) {
      sc.S.P.step(dt); const count = countAt(sc.t, sc.S.total);
      sc.S.thresholds.forEach((v, i) => {
        if (count < v || sc.S.crossed[i] !== -99) return;
        sc.S.crossed[i] = sc.t; LCD.shake(5 + i * 2, .22); LCD.punch(.012 + i * .004);
        const x = 175 + 930 * i / Math.max(1, sc.S.thresholds.length - 1);
        for (let j = 0; j < 30; j++) { const angle = sc.rand() * TAU, v = 80 + sc.rand() * 220; sc.S.P.emit({ x, y: 470, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 90, ay: 120, life: .6 + sc.rand() * .5, s0: .22 + sc.rand() * .2, s1: 0, tint: COLORS[i + 1], img: j % 4 ? 'spark.png' : 'glint_1.png' }); }
      });
    },
    draw(c, t, sc) {
      const S = sc.S, count = countAt(t, S.total), cur = S.thresholds.filter(v => count >= v).length;
      background(c, t, cur); confetti(c, t, cur, .45);
      LCD.text(c, 'たまを かぞえるよ', 395, 76, { size: 62, fill1: '#fffbe8', fill2: COLORS[cur] === '#ccd9ff' ? '#dfe9ff' : '#ffe0a0', glow: COLORS[cur] });
      LCD.add(c, 'flare_streak.png', 640, 238, { w: 1250, h: 150, a: .5, tint: COLORS[cur] });
      const nd = String(S.total).length, cw = nd * 150, cx = 640 - 50;
      C.counter(c, S.total * smooth((t - .5) / 3.9), cx, 238, 190, { maxW: 800 });
      LCD.text(c, '玉', cx + cw / 2 + 62, 282, { size: 76, fill1: '#fffbe0', fill2: '#ffb000', glow: '#ff7a00' });
      // ランクのものさし
      const y = 478;
      c.save(); c.strokeStyle = '#e6d9ff'; c.lineWidth = 5; c.globalAlpha = .75; c.beginPath(); c.moveTo(175, y); c.lineTo(1105, y); c.stroke(); c.restore();
      S.thresholds.forEach((v, i) => {
        const x = 175 + 930 * i / Math.max(1, S.thresholds.length - 1), since = t - S.crossed[i], reached = count >= v, col = COLORS[i + 1];
        if (reached) {
          LCD.add(c, 'glow_soft.png', x, y, { w: 190 + 110 * (1 - smooth(since / .6)), h: 250, a: .6, tint: col });
          LCD.add(c, 'glint_1.png', x, y, { w: 70 + 80 * (1 - smooth(since / .5)), h: 70 + 80 * (1 - smooth(since / .5)), a: .95 });
          LCD.add(c, 'flare_ring.png', x, y, { w: 60 + 190 * smooth(since / .7), h: 60 + 190 * smooth(since / .7), a: .7 * (1 - smooth(since / .8)) });
        }
        c.save(); c.strokeStyle = reached ? col : '#b6a8d8'; c.lineWidth = reached ? 7 : 3; c.beginPath(); c.moveTo(x, y - 20); c.lineTo(x, y + 20); c.stroke(); c.restore();
        const key = i + 1 === 5 ? 'rank_ss_g' : KEYS[i + 1], lit = reached ? 1 : .42;
        C.extrude(c, key, RANKS[i + 1], x, y - 68, 150, 84, { a: lit, depth: .05, near: P[i + 1].near, far: P[i + 1].far, rim: P[i + 1].rim, glowA: reached ? 1 : .2 });
        LCD.text(c, `${v.toLocaleString('ja-JP')}玉`, x, y + 48, { size: 36, a: reached ? 1 : .75, fill1: reached ? '#fff6d0' : '#d6cdee' });
      });
      S.P.draw(c);
      // いまのランク(数えながら変わる)→数え終わったら結果の一言+あと N玉
      const done = t >= 4.4, label = cur === 0 ? '参加賞' : `${RANKS[cur]}ランク`;
      LCD.text(c, done ? `けっか ${label}!` : `いまは ${label}`, 640, 568, { size: 54, fill1: '#fffbe8', fill2: COLORS[cur] === '#ccd9ff' ? '#dfe9ff' : '#ffe27a', glow: COLORS[cur] });
      const hint = nextHint(sc);
      if (done && hint) hintLine(c, t, 640, 628, hint, 46, smooth((t - 4.4) / .3));
      C.team(c, t * .65, 686, { scale: 3, hop: 6, gap: 150, n: 5 });
      LCD.text(c, 'さらへ', 1190, 590, { size: 40, fill2: '#ffe5a8' });
      LCD.arrow(c, 1190, 654, 'down', t, { s: .5 });
    }
  });
  LCD.scene({ id: 'result', dur: 9, cover: true,
    assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS, 'arigato'), 'flip:pillar_2', 'flip:shock_2', 'flip:impact_2', 'flip:digitburst_2'],
    start(sc, p) {
      LCD.stop('finish_count');   // 計数の画面は、結果の画面が重なる瞬間に畳む
      recolor();
      sc.S.rules = LCD.rules(); sc.S.rank = clamp(Math.floor(Number(p.rank) || 0), 0, RANKS.length - 1);
      const passed = p.prize_name ?? p.prizeName;
      sc.S.prize = typeof passed === 'string' && passed.trim() ? passed.trim() : prize(sc.S.rules, sc.S.rank);
      sc.S.P = LCD.particles(400, 31);
    },
    update(sc, dt) {
      sc.S.P.step(dt);
      const r = sc.S.rank;
      C.cues(sc, [[2, () => {
        LCD.flash(r === 0 ? .4 : .5 + r * .05, r === 0 ? '#ffd0e4' : r === 1 ? '#ffd0a0' : r === 2 ? '#e8f0ff' : '#ffe8a0', 5); LCD.shake(8 + r * 3, .4 + r * .05); LCD.punch(.04 + r * .006);
        for (let j = 0; j < 40 + r * 14; j++) { const a = sc.rand() * TAU, v = 120 + sc.rand() * 480; sc.S.P.emit({ x: 600, y: 330, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 1.8, life: .8 + sc.rand() * .6, s0: .3 + sc.rand() * .2, s1: .05, tint: P[r].conf[j % 4], img: j % 4 ? 'spark.png' : 'glint_1.png' }); }
      }]]);
      if (sc.t > 2.3 && sc.t < 6.4) fireworks(sc, r, sc.t);
    },
    draw(c, t, sc) {
      const S = sc.S, rank = S.rank, col = COLORS[rank], p = P[rank];
      C.fade(c, t, 9, .35, c => {
        if (t < 2) {
          const gather = smooth(t / 2); background(c, t, rank, { k: .6 }); LCD.dim(c, .55 - gather * .25, '#08041a');
          streams(c, t * (1 + gather), col, true, .7 + gather * .6);
          LCD.add(c, 'glow_soft.png', 600, 330, { w: 700 - gather * 420, h: 520 - gather * 300, a: .5 + .3 * gather, tint: col });
          LCD.add(c, 'flare_streak.png', 600, 330, { w: 1100 * gather, h: 70, a: .6 * gather, tint: col });
          LCD.text(c, 'あなたの 景品は…', 640, 470, { size: 70, a: LCD.env(t, .1, 2, .2, .2), fill1: '#fffbe8', fill2: '#ffe8c0', glow: col });
          LCD.upa(c, 640 + Math.sin(t * 2) * 10, 610, { scale: 5, mood: 'smile' });
          return;
        }
        background(c, t, rank); confetti(c, t, rank); if (rank >= 3) streams(c, t, col, false, rank >= 5 ? .9 : .55);
        const u = t - 2, m = smooth((t - 6.1) / .6);
        LCD.flip(c, 'impact_2', u, 600, 330, { s: rank === 0 ? 2.4 : 3.4, a: .6 });
        LCD.flip(c, 'shock_2', u, 600, 330, { s: 3, a: .5 });
        if (rank >= 3) LCD.flip(c, 'pillar_2', u, 600, 320, { s: 3, a: .5 });
        LCD.add(c, 'flare_ring.png', 600, 330, { w: 1000 + Math.sin(t * 2) * 25, h: 560, rot: t * .09, a: .45, tint: col });
        LCD.add(c, 'flare_streak.png', 600, 330, { w: 1400, h: 170, a: .55, tint: col });
        // ランクの立体文字。ドンと近くから叩きつけ、軽く弾んで落ち着く
        const slam = u < .22 ? 2.2 + (.92 - 2.2) * (u / .22) ** 2 : .92 + .08 * easeOut((u - .22) / .3);
        const key = rank === 5 ? 'rank_ss_g' : KEYS[rank], tw = (rank === 0 ? 900 : 700) + (520 - (rank === 0 ? 900 : 700)) * m;
        const th = (rank === 0 ? 290 : 340) + ((rank === 0 ? 190 : 330) - (rank === 0 ? 290 : 340)) * m;
        const tx = 600 + (310 - 600) * m, ty = 300 + (270 - 300) * m;
        C.extrude(c, key, RANKS[rank], tx, ty, tw, th, { zoom: slam * (1 + .012 * Math.sin(t * 2.7)), a: clamp(u / .08), glowA: rank >= 3 ? 1.2 : .9, near: p.near, far: p.far, rim: p.rim, depth: .085 });
        if (rank >= 3) LCD.add(c, 'glint_1.png', tx + 120 * Math.sin(t * 2), ty - th * .3, { w: 120, h: 120, a: .8 * clamp(u), tint: '#fff' });
        S.P.draw(c);
        // 景品名(札)と あと N玉
        const pa = smooth((t - 3.2) / .3), hint = nextHint(sc), px = 640 + (310 - 640) * m, py = 515 + (490 - 515) * m, pw = 1000 + (560 - 1000) * m;
        if (pa > 0) {
          c.save(); c.globalAlpha = pa * .75; c.fillStyle = 'rgba(8,4,26,.8)'; c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.roundRect(px - pw / 2, py - 48, pw, 96, 20); c.fill(); c.stroke(); c.restore();
          fitText(c, S.prize, px, py, 70, pw - 60, { a: pa, fill1: '#fffbe8', fill2: rank === 2 ? '#dfe9ff' : '#ffd77a', glow: col });
          if (hint) hintLine(c, t, px, py + 86 - m * 6, hint, 48, smooth((t - 3.7) / .3));
        }
        // ウパの祝福(両脇の大きなウパは A 以上)
        if (rank >= 3) for (const [x, k] of [[150, 0], [1130, 1]]) { const sa = 1 - m; if (sa <= 0) continue; LCD.add(c, 'glow_soft.png', x, 330, { w: 380, h: 330, a: .5 * sa, tint: col }); LCD.upa(c, x, 330 - Math.max(0, Math.sin(t * 5 - k)) * 16, { scale: 5, hue: HUPA[rank], mood: 'happy', a: sa }); }
        const gone = 1 - smooth((t - 6.1) / .3);
        if (gone > 0) C.team(c, t, 676, { scale: 3, gap: 166, hop: rank === 0 ? 12 : 16 + rank * 2, a: gone });
        // 6.2〜 もういちど あそぶ?
        const ia = smooth((t - 6.3) / .35);
        if (ia > 0) {
          const beat = .5 + .5 * Math.sin((t - 6.3) * TAU / 1.4), z = 1 + .035 * beat, cx = 905;
          c.save(); c.globalAlpha = ia * .55; c.fillStyle = 'rgba(8,4,26,.85)'; c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.roundRect(cx - 330, 225, 660, 285, 28); c.fill(); c.stroke(); c.restore();
          c.save(); c.translate(cx, 330); c.scale(z, z); c.translate(-cx, -330);
          LCD.add(c, 'glow_soft.png', cx, 330, { w: 700, h: 300, a: .45 * ia * (.6 + .4 * beat), tint: '#ffb000' });
          LCD.text(c, 'もういちど', cx, 290, { size: 84, a: ia, fill1: '#fff9de', fill2: '#ffc030', glow: '#ff8a00' });
          LCD.text(c, 'あそぶ?', cx, 388, { size: 96, a: ia, fill1: '#fff9de', fill2: '#ffc030', glow: '#ff8a00' });
          c.restore();
          LCD.text(c, `玉が ${S.rules.loanBalls}こ すぐ もらえる!`, cx, 468, { size: 46, a: ia, fill1: '#fffbe8', fill2: '#ffe0a0' });
          // 実物のボタン(筐体の左下)を指す
          c.save(); c.globalAlpha = ia * .85; const g = c.createLinearGradient(0, 580, 0, 720); g.addColorStop(0, 'rgba(6,4,24,0)'); g.addColorStop(.35, 'rgba(6,4,24,.88)'); g.addColorStop(1, 'rgba(6,4,24,.95)'); c.fillStyle = g; c.fillRect(0, 580, 1280, 140); c.restore();
          for (let r = 0; r < 2; r++) { const q = (t * .9 + r * .5) % 1; LCD.add(c, 'flare_ring.png', 34, 706, { w: 90 + q * 200, h: 90 + q * 200, a: ia * (1 - q) * .85, tint: '#ffd24a' }); }
          LCD.buttonArrow(c, 128, 650 + Math.sin(t * 6) * 4, 'left', t, { s: .85, a: ia * (.7 + .3 * beat) });
          LCD.text(c, 'ひかる 左の ボタンを おす', 640, 665, { size: 54, a: ia, stroke: 9, fill1: '#fff4d9', fill2: '#ffcf98', glow: '#b46355' });
        }
      });
    }
  });
})();
