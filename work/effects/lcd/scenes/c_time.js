(function () {
  const C = LCD.C, { smooth, easeOutBack, clamp, lerp, easeOut } = LCD;
  LCD.scene({ id: 'tray_overflow', dur: 2, assets: [...C.digitAssets(), 'glow_soft.png'],
    draw(c, t, sc) {
      const a = LCD.env(t, 0, 1.6, .15, .25);
      c.save(); c.globalAlpha = a;
      const g = c.createLinearGradient(0, 560, 0, 720); g.addColorStop(0, 'rgba(15,24,53,0)'); g.addColorStop(.4, 'rgba(15,24,53,.85)'); g.addColorStop(1, 'rgba(15,24,53,.4)'); c.fillStyle = g; c.fillRect(0, 560, 1280, 160); c.restore();
      LCD.text(c, 'ぜんぶ あなたの 玉!', 400, 640, { size: 48, a, fill2: '#ffe0a1' });
      LCD.text(c, 'ごうけい', 760, 641, { size: 42, a, fill2: '#ffdfb2' });
      C.number(c, C.total(sc.params.total), 930, 640, 68, false, { maxW: 190, a });
      LCD.text(c, '玉', 1050, 644, { size: 48, a, fill2: '#ffcf75' });
      // 右ボタンとは混同させず、筐体中央下の実際の皿を指す。
      LCD.arrow(c, 640, 690, 'down', t, { s: .4, a });
    }
  });
  LCD.scene({ id: 'warn10', dur: 10, assets: [...C.digitAssets(), ...LCD.hudAssets, 'flare_streak.png'],
    draw(c, t, sc) {
      const weak = sc.params.weak === true, last = t >= 5, sec = Math.max(0, 10 - Math.floor(t)), beat = Math.exp(-7 * (t % 1));
      const a = (weak ? .23 : .12) + beat * (weak ? .39 : .3) + (last ? .08 : 0), depth = weak ? 90 : 65;
      // 土台をそのまま見せ、四辺だけを赤く脈打たせる。少玉時は縁を強める。
      for (const [x0, y0, x1, y1, x, y, w, h] of [[0, 0, 0, depth, 0, 0, 1280, depth], [0, 720, 0, 720 - depth, 0, 720 - depth, 1280, depth], [0, 0, depth, 0, 0, 0, depth, 720], [1280, 0, 1280 - depth, 0, 1280 - depth, 0, depth, 720]]) {
        const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(244,28,61,${a})`); g.addColorStop(1, 'rgba(244,28,61,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
      }
      c.save(); c.strokeStyle = `rgba(255,91,100,${a})`; c.lineWidth = weak ? 9 : 5; c.strokeRect(3, 3, 1274, 714); c.restore();
      LCD.hud(c, { sec: Math.max(0, 10 - t) });
      const wa = LCD.env(t, .15, 4.2, .3, .6);
      if (wa > 0) { LCD.text(c, 'もうすぐ おわり!', 400, 175, { size: 72, a: wa, fill1: '#fff3ea', fill2: '#ff8a8a', glow: '#ff2a44' }); }
      if (last && sec > 0) {
        // 5→1だけ中央へ。各秒の後半で薄くして、プレイ中の視界を戻す。
        const age = t % 1, alpha = .88 * (1 - smooth((age - .55) / .32)), h = 250 + beat * 30;
        LCD.add(c, 'glow_soft.png', 640, 330, { w: 420, h: 300, a: .22 * alpha, tint: '#ff7a66' });
        LCD.add(c, 'flare_streak.png', 640, 337, { w: 500 - age * 160, h: 64, a: .27 * alpha });
        C.number(c, sec, 640, 340, h, false, { maxW: 340, a: alpha });
      }
    }
  });
  // 事実だけ。急かさない(赤い光・縮む筋・脈打つ警告は使わない)。選ぶ時間は静かな輪で見せる。
  function choiceRing(c, t, frac, sec) {
    const x = 1130, y = 262, r = 84;
    LCD.add(c, 'glow_soft.png', x, y, { w: 330, h: 330, a: .3, tint: '#ffc060' });
    c.save(); c.fillStyle = 'rgba(10,8,34,.78)'; c.beginPath(); c.arc(x, y, r + 12, 0, LCD.TAU); c.fill();
    c.strokeStyle = 'rgba(255,230,170,.28)'; c.lineWidth = 16; c.beginPath(); c.arc(x, y, r, 0, LCD.TAU); c.stroke();
    c.strokeStyle = '#ffd27a'; c.lineWidth = 16; c.lineCap = 'round'; c.shadowColor = '#ffb000'; c.shadowBlur = 16; c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + LCD.TAU * clamp(frac)); c.stroke(); c.restore();
    LCD.text(c, String(sec), x, y - 2, { size: 104, fill1: '#fffbe8', fill2: '#ffe0a0', glow: '#ffb000' });
    LCD.text(c, 'えらぶ じかん', x, y + 122, { size: 38, fill2: '#ffeec8' });
  }
  LCD.scene({ id: 'timeup', dur: 10, cover: true,
    assets: [...C.assets, ...C.benefitAssets, ...C.titleAssets('timeup', 'tamagire', 'tsuzukeru'), ...C.digitAssets(), 'flip:shock_1'],
    start() { LCD.shake(9, .35); LCD.flash(.22, '#ffd0c0', 3); },
    draw(c, t, sc) {
      C.field(c, t, { rank: 2 });
      LCD.dim(c, .25 * (1 - smooth(t / .6)));
      C.confetti(c, t, 24, true, .5);
      if (t < 1.6) {
        const balls = sc.params.reason === 'balls', env = LCD.env(t, 0, 1.6, .12, .3);
        // 衝撃: 赤い広がり、横に走る光の筋、衝撃波、ゆっくりした寄り
        LCD.add(c, 'glow_soft.png', 590, 330, { w: 1150, h: 470, a: .5 * env, tint: '#ff3a3a' });
        LCD.flip(c, 'shock_1', t, 590, 320, { s: 2.4, a: .55 * env });
        const sw = clamp((t - .15) / .7); LCD.add(c, 'flare_streak.png', lerp(-200, 1480, easeOut(sw)), 322, { w: 900, h: 90, a: .8 * (1 - sw) * env });
        LCD.add(c, 'flare_streak.png', lerp(1480, -200, easeOut(sw)), 392, { w: 700, h: 70, a: .55 * (1 - sw) * env });
        LCD.add(c, 'flare_streak.png', 590, 322, { w: 1250, h: 60, a: .35 * env });
        C.extrude(c, balls ? 'tamagire' : 'timeup', balls ? '玉切れ' : 'TIME UP', 590, 310, 1010, 250, { zoom: (.75 + .25 * easeOutBack(t / .4)) * (1 + .05 * t / 1.6), a: env, near: '#6a1018', far: '#240408', rim: '#ff9a8a' });
        if (!balls) LCD.text(c, 'じかんぎれ', 590, 500, { size: 78, a: env, fill1: '#fff0ea', fill2: '#ffb0a0', glow: '#ff4a4a' });
      } else {
        // 事実だけ: あと100円で つづけられる。3つの内容と、右のボタン。
        const age = t - 1.6, frac = clamp((10 - t) / 8.4), sec = Math.ceil(10 * frac);
        LCD.add(c, 'glow_soft.png', 560, 220, { w: 1250, h: 630, a: .24, tint: '#ffc486' });
        LCD.text(c, 'あと 100円で', 400, 98, { size: 76, fill1: '#fff9e1', fill2: '#ffce7b', glow: '#d08232', a: smooth(age / .3) });
        C.title(c, 'tsuzukeru', 'つづける?', 400, 232, 740, 150, { zoom: 1 });
        LCD.add(c, 'flare_streak.png', 400, 322, { w: 800, h: 50, a: .3 });
        C.continueBenefits(c, t, { age, y: 425, lamps: sc.params.n ?? LCD.state.nDisp });
        choiceRing(c, t, frac, sec);
        LCD.upa(c, 129, 645 + Math.sin(t * 2.5) * 5, { scale: 4, mood: 'smile' });
        c.save(); const g = c.createLinearGradient(0, 610, 0, 720); g.addColorStop(0, 'rgba(8,6,28,0)'); g.addColorStop(.3, 'rgba(8,6,28,.85)'); g.addColorStop(1, 'rgba(8,6,28,.92)'); c.fillStyle = g; c.fillRect(0, 610, 1280, 110); c.restore();
        LCD.text(c, '右の ボタンで つづける', 760, 668, { size: 56, fill1: '#fff9e1', fill2: '#ffd98a', glow: '#d08232' });
        LCD.radial(c, 1196, 705, 120, '255,193,74', .35);
        LCD.arrow(c, 1196, 652, 'down', t, { s: .72 });
      }
    }
  });
  // 押した後の画面: 「追加! +玉 +秒」だけ(選択画面の文言は出さない)。尺3.0秒。玉は皿へ注がれ、そのあと「スタート!」で時計が動く
  LCD.scene({ id: 'add100', dur: 9.5, cover: true,   // 払い出しが終わって start が引き継ぐまで画面を保つ(通常画面を1コマも出さない)
    assets: [...C.assets, ...C.digitAssets(), 'flip:shock_2'],
    start() { LCD.stop('timeup'); LCD.flash(.4, '#fff1bf', 5); LCD.shake(12, .3); LCD.punch(.04); },
    update(sc) { if (LCD.active.some((x) => x.id === 'start')) sc.t = 99; },
    draw(c, t, sc) {
      C.fade(c, Math.min(t, 2.7), 3, .3, c => {
        const R = LCD.rules(), balls = R.loanBalls || 15, sec = R.extraSeconds || 25;
        C.field(c, t, { rank: 3 }); LCD.dim(c, .08, '#420b1f');
        LCD.add(c, 'rays_soft.png', 640, 330, { w: 1540, h: 1100, a: .34, rot: t * .11, tint: '#ffd49a' }); C.confetti(c, t, 80, true);
        LCD.flip(c, 'shock_2', t, 640, 300, { s: 2.2, a: .4 });
        const hit = .7 + .3 * easeOutBack(t / .3);
        LCD.text(c, '追加!', 640 - 6, 170, { size: Math.round(190 * hit), fill1: '#fff9e1', fill2: '#ffd35a', glow: '#d08232', stroke: '#7a1a10' });
        const a2 = smooth((t - .3) / .25);
        c.save(); c.globalAlpha = a2;
        C.numberDepth(c, balls, 330, 430, 150, false, { maxW: 360 });
        LCD.text(c, '玉', 520, 460, { size: 76, fill1: '#fff9e1', fill2: '#ffe0a0', glow: '#d08232' });
        C.numberDepth(c, sec, 790, 430, 150, false, { maxW: 360 });
        LCD.text(c, '秒', 960, 460, { size: 76, fill1: '#fff9e1', fill2: '#ffe0a0', glow: '#d08232' });
        LCD.text(c, '+', 245, 440, { size: 100, fill1: '#fff9e1', fill2: '#ffd35a', glow: '#d08232' });
        LCD.text(c, '+', 705, 440, { size: 100, fill1: '#fff9e1', fill2: '#ffd35a', glow: '#d08232' });
        c.restore();
        LCD.text(c, '玉は 下の さらへ!', 640, 640, { size: 56, a: smooth((t - .8) / .3), fill1: '#fff9e1', fill2: '#ffe0a0', glow: '#d08232' });
      });
    }
  });
})();
