/* 終了の2場面。数値は開始時のLCD.rules()を使い、実際の最終結果だけを祝う。 */
(function () {
  const C = LCD.C, { smooth, clamp, easeOutBack, TAU } = LCD;
  const RANKS = ['参加賞', 'C', 'B', 'A', 'S', 'SS'];
  const KEYS = ['rank_sankasho', 'rank_c', 'rank_b', 'rank_a', 'rank_s', 'rank_ss'];
  const COLORS = ['#ffbad5', '#dba17b', '#d9efff', '#ffdb79', '#ffe39a', '#eab5ff'];
  const EXTRA = ['branch_bl.png', 'branch_br.png', 'edge_gold_h.png', 'ribbon_2.png', 'ribbon_3.png', 'plate_A.png', 'plate_S.png', 'plate_B6.png'];
  const countAt = (t, total) => Math.min(total, Math.floor(total * smooth((t - .5) / 4.5)));
  const prize = (rules, rank) => (rules.prizeNames || rules.PrizeNames || [])[rank] || (rank === 0 ? RANKS[rank] : RANKS[rank] + '賞');
  function hint(sc) {
    const { to_next: n, next_rank: r } = sc.params;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 && Number.isInteger(r) && r > (sc.S.rank ?? 0) && r < RANKS.length ? `あと ${n.toLocaleString('ja-JP')}玉で ${prize(sc.S.rules, r)}だった!` : '';
  }
  function fitText(c, str, x, y, size, width, o = {}) {
    c.save(); c.font = `900 ${size}px ${LCD.font}`; const w = c.measureText(str).width; c.restore();
    LCD.text(c, str, x, y, { size: Math.min(size, size * width / Math.max(1, w)), ...o });
  }
  function background(c, t, rank) {
    const color = COLORS[rank], warm = rank === 0, bronze = rank === 1, metal = rank >= 3;
    LCD.blit(c, warm ? 'bg_sakura.jpg' : rank === 5 ? 'bg_night_sakura.jpg' : bronze || metal ? 'bg_gold.jpg' : 'bg_night_sakura.jpg', 640 + Math.sin(t * .24) * 12, 360, { w: 1480, h: 880 });
    c.save(); c.fillStyle = warm ? 'rgba(77,14,43,.23)' : bronze ? 'rgba(68,26,18,.55)' : metal ? 'rgba(30,12,26,.35)' : 'rgba(12,26,56,.23)'; c.fillRect(-100, -100, 1480, 920); c.restore();
    LCD.add(c, 'rays_soft.png', 640, 290, { w: 1450, h: 1200, rot: t * .08, tint: color, a: .29 });
    LCD.add(c, 'glow_soft.png', 640, 290, { w: 1160, h: 760, tint: color, a: warm ? .3 : .38 });
    LCD.add(c, 'crest_glow.png', 640, 290, { w: 760, h: 760, rot: -t * .07, tint: color, a: .22 });
    for (const [name, x, y, ax, ay] of [['branch_tl.png', 0, 0, 0, 0], ['branch_tr.png', 1280, 0, 1, 0], ['branch_bl.png', 0, 720, 0, 1], ['branch_br.png', 1280, 720, 1, 1]]) LCD.blit(c, name, x, y, { w: 385, h: 270, ax, ay, a: .76 });
    if (!warm) for (const right of [false, true]) LCD.blit(c, right ? 'corner_gold_tr.png' : 'corner_gold_tl.png', right ? 1280 : 0, 0, { w: 210, h: 210, ax: right ? 1 : 0, ay: 0, a: metal || bronze ? .9 : .5, tint: bronze ? '#d8a284' : undefined });
    if (rank >= 4) C.spectrum(c, t, rank === 5 ? 1.15 : .5);
    if (metal || bronze) for (const y of [14, 706]) LCD.blit(c, 'edge_gold_h.png', 640, y, { w: 1320, h: 38, a: bronze ? .5 : .75, tint: bronze ? '#d8a284' : undefined });
  }
  function streams(c, t, color, inward, amount = 1) {
    const rnd = LCD.rng(209);
    for (let i = 0; i < 25; i++) {
      const angle = rnd() * TAU, phase = (t * .72 + rnd()) % 1, u = inward ? 1 - phase : phase, r = 40 + u * 760;
      LCD.add(c, 'flare_streak.png', 640 + Math.cos(angle) * r, 290 + Math.sin(angle) * r * .65, { w: 70 + u * 290, h: 7 + rnd() * 10, rot: angle, tint: color, a: Math.sin(phase * Math.PI) * .42 * amount });
    }
  }
  function celebration(c, t, rank) {
    const color = COLORS[rank]; C.confetti(c, t, rank === 0 ? 90 : 45 + rank * 22, rank >= 3, .68);
    const rnd = LCD.rng(374);
    for (let i = 0; i < 32 + rank * 7; i++) {
      const z = .4 + rnd(), x = rnd() * 1280, y = (rnd() * 950 + t * (38 + 45 * z)) % 950 - 100;
      LCD.add(c, i % 3 ? 'spark.png' : 'glint_1.png', x, y, { w: (i % 3 ? 15 : 36) * z, h: (i % 3 ? 15 : 36) * z, a: .3 + .25 * Math.sin(t * 2 + i) ** 2, tint: color });
    }
    if (rank >= 4) {
      const rainbow = ['#ff92b9', '#ffe397', '#98ffb8', '#91e4ff', '#baa4ff', '#f6a5ed', '#fff1c1'];
      for (let i = 0; i < 7; i++) {
        const a = t * .16 + i * TAU / 7;
        LCD.add(c, 'ribbon_' + (i % 3 + 1) + '.png', 640 + Math.cos(a) * 230, 300 + Math.sin(a) * 140, { w: rank === 5 ? 1540 : 1220, h: 380, rot: a, a: rank === 5 ? .38 : .24, tint: rainbow[i] });
      }
      streams(c, t, color, false, rank === 5 ? .8 : .45);
      for (const [i, x] of [160, 1120].entries()) LCD.flip(c, 'petals_1', (t - 2 - i * .4) % 1.9, x, 190 + i * 70, { s: rank === 5 ? 1.6 : 1.1, a: .35 });
    }
  }
  LCD.scene({ id: 'finish_count', dur: 6, cover: true, assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS), ...C.digitAssets()],
    start(sc, p) {
      sc.S.rules = LCD.rules(); sc.S.total = C.total(p.total);
      sc.S.thresholds = sc.S.rules.thresholds.slice(0, RANKS.length - 1);
      sc.S.rank = sc.S.thresholds.filter(v => sc.S.total >= v).length;
      sc.S.crossed = sc.S.thresholds.map(() => -99); sc.S.P = LCD.particles(180, 752);
    },
    update(sc, dt) {
      sc.S.P.step(dt); const count = countAt(sc.t, sc.S.total);
      sc.S.thresholds.forEach((v, i) => {
        if (count < v || sc.S.crossed[i] !== -99) return;
        sc.S.crossed[i] = sc.t;
        const x = 175 + 930 * i / Math.max(1, sc.S.thresholds.length - 1);
        for (let j = 0; j < 22; j++) { const angle = sc.rand() * TAU, v = 55 + sc.rand() * 150; sc.S.P.emit({ x, y: 423, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 70, ay: 90, life: .55 + sc.rand() * .45, s0: .16 + sc.rand() * .16, s1: 0, tint: COLORS[i + 1], img: j % 4 ? 'spark.png' : 'glint_1.png' }); }
      });
    },
    draw(c, t, sc) {
      const rank = sc.S.rank; background(c, t, rank); C.confetti(c, t, 45 + rank * 8, rank >= 3, .48);
      if (rank >= 4) celebration(c, t, rank);
      LCD.text(c, '玉を かぞえるよ', 640, 76, { size: 50, fill2: COLORS[rank], glow: COLORS[rank] });
      LCD.add(c, 'flare_streak.png', 640, 255, { w: 1150, h: 130, a: .42 });
      C.counter(c, sc.S.total * smooth((t - .5) / 4.5), 605, 249, 200, { maxW: 880 }); LCD.text(c, '玉', 1095, 297, { size: 47 });
      const count = countAt(t, sc.S.total), y = 423;
      c.save(); c.strokeStyle = '#c1c7db'; c.lineWidth = 3; c.beginPath(); c.moveTo(175, y); c.lineTo(1105, y); c.stroke(); c.restore();
      sc.S.thresholds.forEach((v, i) => {
        const x = 175 + 930 * i / Math.max(1, sc.S.thresholds.length - 1), since = t - sc.S.crossed[i], reached = count >= v;
        if (reached) {
          LCD.add(c, 'glow_soft.png', x, y, { w: 140 + 90 * (1 - smooth(since / .6)), h: 190, a: .43, tint: COLORS[i + 1] });
          LCD.add(c, 'glint_1.png', x, y, { w: 42 + 50 * (1 - smooth(since / .5)), h: 42 + 50 * (1 - smooth(since / .5)), a: .9 });
          LCD.add(c, 'flare_ring.png', x, y, { w: 40 + 130 * smooth(since / .7), h: 40 + 130 * smooth(since / .7), a: .55 * (1 - smooth(since / .8)) });
        }
        c.save(); c.strokeStyle = reached ? COLORS[i + 1] : '#a3b2cb'; c.lineWidth = reached ? 5 : 2; c.beginPath(); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke(); c.restore();
        C.title(c, KEYS[i + 1], RANKS[i + 1], x, y - 44, 92, 42, { a: reached ? 1 : .3, glowA: reached ? .8 : .12 });
        LCD.text(c, `${v.toLocaleString('ja-JP')}玉`, x, y + 40, { size: 26, fill1: reached ? '#fff2ce' : '#b2c3d7' });
      });
      sc.S.P.draw(c);
      // 従来の近い景品案内を維持。差はホストの実数だけで、計数中に作らない。
      const next = hint(sc), near = sc.S.rules.nearPrizeBalls;
      if (t >= 4.4 && next && (near === undefined || sc.params.to_next <= near)) LCD.text(c, next, 640, 523, { size: 37, a: smooth((t - 4.4) / .3), fill2: '#ffe0a1' });
      C.team(c, t * .65, 595, { scale: 3, hop: 6, gap: 160 });
      LCD.text(c, '玉は 下のさらへ', 900, 668, { size: 33, fill2: '#ffe5a8' });
      LCD.arrow(c, 640, 670, 'down', t, { s: .5 });
    }
  });
  LCD.scene({ id: 'result', dur: 9, cover: true,
    assets: [...C.assets, ...EXTRA, ...C.titleAssets(...KEYS, 'arigato'), 'flip:pillar_2', 'flip:shock_2'],
    start(sc, p) {
      sc.S.rules = LCD.rules(); sc.S.rank = clamp(Math.floor(Number(p.rank) || 0), 0, RANKS.length - 1);
      const passed = p.prize_name ?? p.prizeName;
      sc.S.prize = typeof passed === 'string' && passed.trim() ? passed.trim() : prize(sc.S.rules, sc.S.rank);
    },
    update(sc) { C.cues(sc, [[2, () => { const r = sc.S.rank; LCD.flash(r === 0 ? .3 : .43 + r * .045, r === 0 ? '#ffe9f0' : '#fff1cf', 5); LCD.shake(r === 0 ? 6 : 9 + r * 2, .35); LCD.punch(r === 0 ? .025 : .04 + r * .004); }]]); },
    draw(c, t, sc) {
      const rank = sc.S.rank, color = COLORS[rank];
      C.fade(c, t, 9, .35, c => {
        background(c, t, rank);
        if (t < 2) {
          const gather = smooth(t / 2); LCD.dim(c, .64 - gather * .18, '#0b081d');
          streams(c, t * (1 + gather), color, true, .6 + gather * .6);
          LCD.add(c, 'glow_soft.png', 640, 290, { w: 650 - gather * 440, h: 480 - gather * 310, a: .4 + .25 * gather, tint: color });
          LCD.add(c, 'flare_streak.png', 640, 290, { w: 1050 * gather, h: 65, a: .5 * gather });
          LCD.text(c, 'あなたの 景品は…', 640, 475, { size: 52, a: LCD.env(t, .1, 2, .2, .2), fill2: '#f4e9d8' });
          LCD.upa(c, 640 + Math.sin(t * 2) * 10, 604, { scale: 4, mood: 'smile' });
          return;
        }
        celebration(c, t, rank);
        if (rank === 5) C.jpFestival(c, t, t * .31, .72);
        const thanks = smooth((t - 7.05) / .35), rankA = 1 - smooth((t - 6.75) / .3), settle = smooth((t - 3.1) / .55), hit = .55 + .45 * easeOutBack((t - 2) / .34);
        LCD.flip(c, 'impact_2', t - 2, 640, 303, { s: rank === 0 ? 2.1 : 3.1, a: rank === 0 ? .3 : .43 });
        if (rank >= 4) LCD.flip(c, 'pillar_2', t - 2, 640, 300, { s: 2.8, a: .38 });
        LCD.add(c, 'flare_ring.png', 640, 300, { w: 900 + Math.sin(t * 2) * 25, h: 540, rot: t * .09, a: .3 });
        LCD.add(c, 'flare_streak.png', 640, 310 - settle * 36, { w: 1280, h: 150, a: .43 });
        const h = (rank === 0 ? 310 : 400) - settle * (rank === 0 ? 10 : 58);
        C.title(c, KEYS[rank], RANKS[rank], 640 + Math.sin(t * 1.6) * 5, 305 - settle * 38 - (1 - rankA) * 35, 1100, h, { a: rankA, zoom: hit * (1 + .012 * Math.sin(t * 2.7)), glowA: rank >= 4 ? 1.1 : .8 });
        if (t >= 3.5 && rankA > 0) {
          LCD.blit(c, rank === 0 ? 'plate_S.png' : rank < 3 ? 'plate_A.png' : 'plate_B6.png', 640, 492, { w: 1000, h: 90, a: smooth((t - 3.5) / .25) * rankA });
          fitText(c, sc.S.prize, 640, 490, 55, 880, { a: smooth((t - 3.5) / .25) * rankA, fill2: color });
          const next = hint(sc);
          if (rank < RANKS.length - 1 && next) fitText(c, next, 640, 560, 40, 1080, { a: smooth((t - 3.9) / .3) * rankA, fill2: '#fff0cf' });
        }
        C.team(c, t, 655, { scale: 3, gap: 166, hop: rank === 0 ? 12 : 18 + rank * 2, rainbow: rank >= 4 });
        if (thanks > 0) {
          C.title(c, 'arigato', 'ありがとう', 640, 285 + Math.sin(t * 2) * 4, 1100, 255, { a: thanks });
          LCD.text(c, 'また あそぼうね!', 640, 465, { size: 48, a: thanks, fill2: '#ffe4d7' });
        }
      });
    }
  });
})();
