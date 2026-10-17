(function () {
  const C = LCD.C, { smooth, easeOutBack, clamp, lerp, easeOut } = LCD;
  LCD.scene({ id: 'tray_overflow', dur: 2, assets: [...C.digitAssets(), 'glow_soft.png'],
    draw(c, t, sc) {
      const a = LCD.env(t, 0, 1.6, .15, .25);
      c.save(); c.globalAlpha = a;
      const g = c.createLinearGradient(0, 592, 0, 720); g.addColorStop(0, 'rgba(15,24,53,0)'); g.addColorStop(.45, 'rgba(15,24,53,.72)'); g.addColorStop(1, 'rgba(15,24,53,0)'); c.fillStyle = g; c.fillRect(0, 592, 1280, 128); c.restore();
      LCD.text(c, 'ぜんぶ あなたの玉!', 460, 632, { size: 27, a, fill2: '#ffe0a1' });
      LCD.text(c, '合計', 745, 633, { size: 25, a, fill2: '#ffdfb2' });
      C.number(c, C.total(sc.params.total), 869, 630, 41, false, { maxW: 150, a });
      LCD.text(c, '玉', 985, 633, { size: 27, a, fill2: '#ffcf75' });
      // 右ボタンとは混同させず、筐体中央下の実際の皿を指す。
      LCD.arrow(c, 640, 685, 'down', t, { s: .4, a });
    }
  });
  // 光の筋は刻々と短くなる。全画面の点滅を使わず、締め切りを見せる。
  function urgency(c, t, pressure) {
    const rnd = LCD.rng(911);
    LCD.add(c, 'glow_soft.png', 820, 370, { w: 1350, h: 850, a: .13 + pressure * .27, tint: '#ff704a' });
    for (let i = 0; i < 22; i++) {
      const angle = rnd() * LCD.TAU, phase = (rnd() + t * (.28 + pressure * .12)) % 1, r = 180 + 750 * (1 - phase);
      LCD.add(c, 'flare_streak.png', 630 + Math.cos(angle) * r, 290 + Math.sin(angle) * r * .65, { w: (270 - pressure * 175) * (1 - phase * .45), h: 8 + rnd() * 12, rot: angle, a: Math.sin(phase * Math.PI) * (.18 + pressure * .22), tint: '#ffd1a0' });
    }
    for (let i = 0; i < 2; i++) LCD.add(c, 'ribbon_1.png', 640, 360, { w: 1450, h: 700, rot: t * .07 * (i ? 1 : -1) + i * 2, a: .1 + pressure * .05, tint: i ? '#ffb24e' : '#ff7594' });
  }
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
      if (last && sec > 0) {
        // 5→1だけ中央へ。各秒の後半で薄くして、プレイ中の視界を戻す。
        const age = t % 1, alpha = .88 * (1 - smooth((age - .55) / .32)), h = 174 + beat * 23;
        LCD.add(c, 'glow_soft.png', 640, 330, { w: 420, h: 300, a: .22 * alpha, tint: '#ff7a66' });
        LCD.add(c, 'flare_streak.png', 640, 337, { w: 500 - age * 160, h: 64, a: .27 * alpha });
        C.number(c, sec, 640, 330, h, false, { maxW: 235, a: alpha });
      }
    }
  });
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
        C.title(c, balls ? 'tamagire' : 'timeup', balls ? '玉切れ' : 'TIME UP', 590, 320, 1010, 250, { zoom: (.75 + .25 * easeOutBack(t / .4)) * (1 + .05 * t / 1.6), a: env, fill2: '#9db8e2', glow: '#83bbff' });
      } else {
        // ひとつの問いと、その直下に並ぶ3つの価値。返答の操作だけを右下へ。
        const remaining = clamp((10 - t) / 8.4), pressure = 1 - remaining, sec = Math.ceil(10 * remaining), beat = Math.exp(-7 * ((pressure * 10) % 1));
        urgency(c, t, pressure); C.confetti(c, t, 28 + Math.floor(pressure * 35), true, .45);
        LCD.add(c, 'glow_soft.png', 640, 220, { w: 1250, h: 630, a: .2 + pressure * .12, tint: '#ffc486' });
        LCD.text(c, 'あと 100円で', 640, 103, { size: 63, fill1: '#fff9e1', fill2: '#ffce7b', glow: '#d08232' });
        C.title(c, 'tsuzukeru', 'つづける?', 640, 242 + Math.sin(t * 2) * 3, 1030, 182, { zoom: 1 + beat * .014 });
        LCD.add(c, 'flare_streak.png', 640, 339, { w: 1040 - pressure * 190, h: 62, a: .32 + beat * .08 });
        C.continueBenefits(c, t, { age: t - 1.6, y: 438, lamps: sc.params.n ?? LCD.state.nDisp });
        LCD.hud(c, { sec });
        LCD.upa(c, 129, 613 + Math.sin(t * 2.5) * 6, { scale: 4, mood: 'smile' });
        LCD.add(c, 'glint_1.png', 174, 560, { w: 27, h: 27, a: .65 });
        LCD.text(c, '右ボタン', 1115, 598, { size: 30, fill2: '#ffe4a9' });
        LCD.radial(c, 1144, 705, 155, '255,193,74', .3 + .15 * beat);
        LCD.arrow(c, 1144, 655, 'down', t, { s: .8 + beat * .05 });
      }
    }
  });
  LCD.scene({ id: 'add100', dur: 4, cover: true,
    assets: [...C.assets, ...C.benefitAssets, ...C.titleAssets('lastchance'), ...C.digitAssets(), 'flip:shock_2'],
    start() { LCD.flash(.45, '#fff1bf', 5); LCD.shake(14, .35); LCD.punch(.045); },
    update(sc) { C.cues(sc, [[.55, () => { LCD.flash(.28, '#ffdfb5', 6); LCD.shake(7, .2); }]]); },
    draw(c, t, sc) {
      C.fade(c, t, 4, .3, c => {
        C.field(c, t, { rank: 3 }); LCD.dim(c, .08, '#420b1f'); urgency(c, t, .8);
        LCD.add(c, 'rays_soft.png', 640, 320, { w: 1540, h: 1100, a: .38, rot: t * .11, tint: '#ffd49a' }); C.confetti(c, t, 105, true);
        LCD.flip(c, 'impact_2', t, 640, 220, { s: 2.7, a: .5 });
        LCD.flip(c, 'shock_2', t - .55, 640, 448, { s: 2.2, a: .4 });
        const hit = .72 + .28 * easeOutBack(t / .34);
        C.title(c, 'lastchance', 'LAST CHANCE', 640, 180 + Math.sin(t * 3) * 3, 1040, 170, { zoom: hit });
        LCD.text(c, 'まだ いける!', 640, 291, { size: 49, a: smooth(t / .3), fill2: '#ffe7b3' });
        C.continueBenefits(c, t, { age: t - .42, y: 424, lamps: sc.params.n ?? LCD.state.nDisp });
        for (const x of [142, 1138]) LCD.upa(c, x, 606 - Math.max(0, Math.sin(t * 5)) * 13, { scale: 4, mood: 'happy' });
        LCD.text(c, '玉は 下のさらへ!', 640, 620, { size: 35, a: smooth((t - .6) / .25), fill2: '#ffe9b7' });
        LCD.add(c, 'glow_soft.png', 640, 740, { w: 740, h: 290, a: .45, tint: '#ffb658' });
        if (t >= .55) LCD.arrow(c, 640, 668, 'down', t, { s: .66 });
      });
    }
  });
})();
