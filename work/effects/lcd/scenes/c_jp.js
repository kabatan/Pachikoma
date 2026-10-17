/* JPは基準20秒。配当別の実時間倍率はホスト→sc.scaleに任せる。
 * 針は12時=0/時計回りの LCD.jpNeedle を update ごとに公開する。 */
(function () {
  const C = LCD.C, { TAU, clamp, smooth, easeOut, easeOutBack } = LCD;
  const PAYS = () => LCD.rules().jackpotAwards.slice(0, 5);
  // 角速度そのものを連続補間して積分する。止まりかけ→再加速も逆回転なし。
  // 4.0最高速 / 6.4減速 / 6.85寸止め / 7.3再加速 / 8.6〜10.6長いタメ。
  // 全区間の積分を当選区画への距離に正規化し、最後は必ず中央で停止する。
  const KNOTS = [[0, 9], [2.4, .12], [2.85, .035], [3.3, 4.5], [4.6, .11], [6.6, 0]];
  const area = KNOTS.slice(1).reduce((sum, [t, v], i) => sum + (t - KNOTS[i][0]) * (v + KNOTS[i][1]) / 2, 0);
  const motion = (t, index) => {
    const age = clamp(t - 4, 0, 6.6), scale = (16 + index / 5) / area;
    let pos = 0, speed = 0;
    for (let i = 1; i < KNOTS.length; i++) {
      const [t0, v0] = KNOTS[i - 1], [t1, v1] = KNOTS[i], dt = t1 - t0, u = clamp((age - t0) / dt);
      pos += dt * (v0 * u + (v1 - v0) * (u ** 3 - .5 * u ** 4));
      if (age >= t0 && age < t1) speed = v0 + (v1 - v0) * smooth(u);
    }
    return { pos: age >= 6.6 ? 16 + index / 5 : pos * scale, speed: t < 4 || age >= 6.6 ? 0 : speed * scale };
  };
  function ballBurst(c, t) {
    const rnd = LCD.rng(921), e = t - 14.4;
    // 鏡面球は不透明。左右から弾ける玉に、両端を降る玉を重ねる。
    // 半径込みで告知板・数字・中央のウパを避け、文字より奥に描く。
    const clear = [[265, -15, 1015, 115], [240, 390, 1120, 625]];
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
  function wheel(c, t, sc) {
    const pos = sc.S.needle, angle = pos * TAU - Math.PI / 2, settled = smooth((t - 10.6) / .2);
    const entered = easeOutBack((t - 4) / .55), r = 242;
    c.save(); c.translate(640, 375 + Math.sin(t * 1.3) * 2); c.scale(.75 + entered * .25, (.75 + entered * .25) * .96);
    LCD.add(c, 'glow_soft.png', 0, 0, { w: 960, h: 960, a: .36, tint: '#ffb048' });
    LCD.blit(c, 'rl_shadow.png', 0, 24, { w: 710, h: 710, a: .9 });
    // 厚い下側のリップ、切削された金属、鏡面の帯。黒い隙間を挟んで積層。
    const disk = (radius, y, stops) => { const g = c.createLinearGradient(-radius * .7, y - radius, radius * .6, y + radius); stops.forEach(([p, col]) => g.addColorStop(p, col)); c.fillStyle = g; c.beginPath(); c.arc(0, y, radius, 0, TAU); c.fill(); };
    const gold = [[0, '#fff0bd'], [.15, '#cf8d27'], [.29, '#593015'], [.40, '#ffe7a0'], [.46, '#fff9df'], [.54, '#7d4918'], [.75, '#e5aa43'], [1, '#4b2511']];
    disk(314, 16, [[0, '#1c1720'], [.45, '#573616'], [.7, '#ac7131'], [.87, '#f0b65f'], [1, '#321c12']]);
    disk(314, 0, gold); disk(306, 0, [[0, '#161a27'], [.5, '#0b0c17'], [1, '#4c3824']]); disk(300, 0, gold);
    disk(287, 0, [[0, '#10111b'], [.5, '#3c2519'], [1, '#090b13']]); disk(257, 0, gold); disk(249, 0, [[0, '#10101b'], [1, '#030714']]);
    LCD.blit(c, 'rl_rim.png', 0, 0, { w: 630, h: 630, a: .32, blend: 'screen' });
    const enamel = [['#7c183c', '#260c23'], ['#145c7d', '#08152f'], ['#256751', '#071e22'], ['#51367b', '#110f2d'], ['#9a6332', '#25131c']];
    for (let i = 0; i < 5; i++) {
      const mid = i / 5 * TAU - Math.PI / 2, a0 = mid - Math.PI / 5, a1 = mid + Math.PI / 5;
      c.save(); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a0, a1); c.closePath(); c.clip();
      const g = c.createLinearGradient(0, -r, 0, r); g.addColorStop(0, enamel[i][0]); g.addColorStop(.45, enamel[i][1]); g.addColorStop(.65, enamel[i][0]); g.addColorStop(1, '#080d1c');
      c.fillStyle = g; c.fillRect(-r, -r, r * 2, r * 2);
      LCD.blit(c, 'mist_tile.png', 0, 0, { w: 540, h: 540, blend: 'screen', a: .085 });
      // ドームの環境光が動く。盤面を平塗りにしない。
      c.save(); c.rotate(.23 * t); const shine = c.createLinearGradient(-270, 0, 270, 0); shine.addColorStop(0, 'rgba(225,242,255,0)'); shine.addColorStop(.38, 'rgba(225,242,255,0)'); shine.addColorStop(.47, 'rgba(255,242,203,.21)'); shine.addColorStop(.53, 'rgba(255,255,242,.02)'); shine.addColorStop(.72, 'rgba(225,242,255,0)'); c.fillStyle = shine; c.fillRect(-340, -340, 680, 680); c.restore();
      if (settled) { c.fillStyle = i === sc.S.index ? `rgba(255,198,75,${.14 + .06 * Math.sin(t * 5)})` : `rgba(3,7,19,${settled * .35})`; c.fillRect(-r, -r, r * 2, r * 2); }
      c.restore();
      // 溝の影と二本の反射で、区切りを金属の仕切りにする。
      c.save(); c.rotate(a0); c.strokeStyle = '#0a080e'; c.lineWidth = 9; c.beginPath(); c.moveTo(40, 2); c.lineTo(r, 2); c.stroke(); c.strokeStyle = '#bd8740'; c.lineWidth = 5; c.beginPath(); c.moveTo(40, 0); c.lineTo(r, 0); c.stroke(); c.strokeStyle = '#fff0b7'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(40, -2); c.lineTo(r, -2); c.stroke(); c.restore();
      const lx = Math.cos(mid) * 170, ly = Math.sin(mid) * 170;
      C.number(c, sc.S.pays[i], lx, ly, 67, false, { maxW: 142 }); LCD.text(c, '玉', lx, ly + 44, { size: 23 });
    }
    LCD.blit(c, 'rl_dome.png', 0, 0, { w: 493, h: 493, a: .32, blend: 'screen', rot: .04 * Math.sin(t * .8) });
    // 目盛り、金属球のビス、実体のあるランプ。追走点は公開針角と同一。
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU - Math.PI / 2, behind = ((pos - i / 60) % 1 + 1) % 1;
      c.save(); c.rotate(a); c.strokeStyle = i % 5 ? '#ba8d50' : '#fff0bf'; c.lineWidth = i % 5 ? 1 : 2; c.beginPath(); c.moveTo(294, 0); c.lineTo(i % 5 ? 300 : 305, 0); c.stroke(); c.restore();
      const lv = Math.exp(-behind * 27), x = Math.cos(a) * 274, y = Math.sin(a) * 274;
      LCD.ball(c, x, y, 5.5, { gold: true, a: .35 + lv * .65 });
      if (lv > .16) { LCD.add(c, 'glow_soft.png', x, y, { w: 40, h: 40, a: lv * .7, tint: `hsl(${i * 6 + t * 60},95%,74%)` }); LCD.add(c, 'glint_1.png', x, y, { w: 25, h: 25, a: lv, tint: `hsl(${i * 6 + t * 60},95%,78%)` }); }
    }
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU - Math.PI / 2, phase = ((pos - i / 30) % 1 + 1) % 1, chase = Math.exp(-phase * 22), blink = Math.sin(t * 16 + i) > 0 ? 1 : .35;
      LCD.add(c, 'glow_soft.png', Math.cos(a) * 313, Math.sin(a) * 313, { w: 47, h: 47, a: (.2 + chase * .65) * blink, tint: `hsl(${i * 12},95%,72%)` });
      LCD.add(c, 'glint_1.png', Math.cos(a) * 313, Math.sin(a) * 313, { w: 16 + chase * 9, h: 16 + chase * 9, a: (.3 + chase * .55) * blink, tint: `hsl(${i * 12},95%,80%)` });
    }
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + .19; LCD.ball(c, Math.cos(a) * 304, Math.sin(a) * 304, 5, { gold: true }); }
    if (settled) { const a = sc.S.index / 5 * TAU - Math.PI / 2; LCD.add(c, 'flare_ring.png', Math.cos(a) * 170, Math.sin(a) * 170, { w: 100 + (t - 10.6) * 230, h: 90 + (t - 10.6) * 210, a: .7 * (1 - smooth((t - 10.6) / .6)) }); }
    const speed = sc.S.speed;
    if (speed > .1) for (let j = 1; j <= 8; j++) { c.save(); c.rotate(angle - j * Math.min(.18, speed * .035)); c.strokeStyle = `rgba(255,218,118,${.09 * (1 - j / 9)})`; c.lineWidth = 11; c.beginPath(); c.moveTo(26, 0); c.lineTo(229, 0); c.stroke(); c.restore(); }
    c.save(); c.rotate(angle); c.shadowBlur = 14; c.shadowColor = '#ffe7a6'; const metal = c.createLinearGradient(0, -13, 0, 13); metal.addColorStop(0, '#633510'); metal.addColorStop(.3, '#e9b76d'); metal.addColorStop(.46, '#fffbe8'); metal.addColorStop(.57, '#b58c40'); metal.addColorStop(1, '#2c1e1d');
    c.fillStyle = metal; c.strokeStyle = '#ffefbc'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-26, -11); c.lineTo(209, -7); c.lineTo(236, 0); c.lineTo(209, 7); c.lineTo(-26, 11); c.closePath(); c.fill(); c.stroke(); c.restore();
    LCD.flip(c, 'shock_2', t - 7.3, 0, 0, { s: 1.45, a: .32 });
    LCD.ball(c, 0, 0, 32, { gold: true }); LCD.blit(c, 'rl_hub.png', 0, 0, { w: 43, h: 43 });
    LCD.flip(c, 'shock_2', t - 10.6, 0, 0, { s: 1.3, a: .27 }); c.restore();
  }
  LCD.scene({ id: 'jp', dur: 20, cover: true,
    assets: [...C.assets, ...C.jpAssets, ...C.titleAssets('jackpot'), ...C.digitAssets(true), ...C.digitAssets(), 'rl_rim.png', 'rl_dome.png', 'rl_shadow.png', 'rl_hub.png', 'flip:pillar_2', 'flip:shock_2', 'flip:speed_2'],
    start(sc, p) { sc.S.pays = PAYS(); sc.S.index = Math.max(0, sc.S.pays.indexOf(Number(p.payout))); sc.S.payout = sc.S.pays[sc.S.index]; sc.S.needle = 0; sc.S.speed = 0; LCD.jpNeedle = 0; LCD.shake(14, .28); },
    update(sc) {
      const m = motion(sc.t, sc.S.index); sc.S.needle = m.pos; sc.S.speed = m.speed; LCD.jpNeedle = ((sc.S.needle % 1) + 1) % 1;
      C.cues(sc, [[.065, () => LCD.flash(.86, '#fff9ee', .86 / (.48 * sc.scale))], [.64, () => { LCD.punch(.035); }], [2.1, () => { LCD.flash(.65, '#fff8d2', 6); LCD.shake(16, .35); LCD.punch(.06); }], [6.85, () => LCD.punch(.018)], [7.3, () => { LCD.shake(8, .2); LCD.punch(.03); }], [10.6, () => { LCD.flash(.38, '#ffe8b2', 5); LCD.shake(13, .25); LCD.punch(.025); }], [11.2, () => { LCD.flash(.8, '#fff4d0', 5); LCD.shake(18, .45); LCD.punch(.06); }], [14.4, () => { LCD.flash(.7, '#fff2c6', 5); LCD.shake(22, .5); LCD.punch(.055); }]]);
    },
    draw(c, t, sc) {
      // 19秒から通常画面へ透過。cover は下のシーンを隠すが通常土台は残る。
      C.fade(c, t, 20, 1.35, c => {
        C.jpBackdrop(c, t); C.spectrum(c, t, t < 4 || t >= 11.2 ? 1.15 : .7);
        C.jpFestival(c, t, t < 4 ? t * .4 : sc.S.needle, t >= 11.2 ? 1 : .78);
        C.confetti(c, t, 130, true, .8);
        if (t < .64) { C.jpAura(c, t, 640, 310, .65); LCD.flip(c, 'impact_2', t, 640, 310, { s: 2.8, a: .34 }); return; }
        if (t < 4) {
          const down = easeOut((t - .64) / 1.15), y = -310 + down * 620;
          LCD.add(c, 'rays_soft.png', 640, y, { w: 1550, h: 1100, a: .5, rot: t * .11, tint: '#ffe9ac' });
          LCD.flip(c, 'pillar_2', t - .64, 640, 250, { s: 2.4, a: .55 });
          C.jpAura(c, t, 640, y, .8);
          C.rainbowHero(c, t, 640, y, 22);
          C.team(c, t, 674, { n: 6, scale: 3, gap: 177, hop: 11 });
          if (t > 2.1) {
            const u = easeOutBack((t - 2.1) / .38);
            LCD.flip(c, 'impact_2', t - 2.1, 640, 535, { s: 2.5, a: .4 });
            LCD.add(c, 'flare_streak.png', 640, 535, { w: 1200, h: 160, a: .55 });
            C.title(c, 'jackpot', 'JACKPOT', 640, 535, 1140, 170, { zoom: .7 + .3 * u });
          }
        } else if (t < 11.2) {
          LCD.blit(c, 'plate_B6.png', 640, 48, { w: 620, h: 96 });
          C.title(c, 'jackpot', 'JACKPOT', 640, 46, 500, 68);
          // 小さな観客は盤の両脇。結果を先に強調しない。
          C.jpAura(c, t, 640, 355, .32); C.rainbowHero(c, t, 130, 315, 4);
          LCD.upa(c, 1135, 420, { scale: 3, hue: LCD.HUES[1], mood: 'happy' });
          wheel(c, t, sc);
        } else {
          const payout = sc.S.payout, u = easeOut((t - 11.2) / 2.65), count = LCD.landed(payout, Math.min(payout, Math.floor(payout * u)));
          LCD.add(c, 'rays_soft.png', 640, 340, { w: 1650, h: 1150, a: .48, rot: t * .09, tint: '#ffe9ac' });
          LCD.flip(c, 'digitburst_2', t - 11.2, 640, 335, { s: 1.75, a: .7 });
          LCD.flip(c, 'shock_2', t - 14.4, 640, 370, { s: 2.5, a: .5 });
          if (t >= 14.4) ballBurst(c, t);
          C.jpAura(c, t, 640, 270, .78);
          C.rainbowHero(c, t, 640, 252, 22);
          C.title(c, 'jackpot', 'JACKPOT', 640, 76, 670, 85);
          LCD.add(c, 'flare_streak.png', 640, 509, { w: 1250, h: 160, a: .45 });
          C.number(c, count, 605, 509, 210, true, { maxW: 875 });
          LCD.text(c, '玉', 1035, 557, { size: 66, fill1: '#fffbd4', fill2: '#ffc531', glow: '#ffaa20' });
          C.team(c, t, 674, { rainbow: true, gap: 164, hop: 23 });
          const guide = LCD.env(t, 11.5, 19, .4, .5);
          LCD.arrow(c, 1192, 650, 'down', t, { s: .65, a: guide });
        }
        // 大きい手前の花弁は端を流れ、顔や数字には重ならない。
        for (let i = 0; i < 4; i++) LCD.blit(c, 'petal_stream_1.png', i % 2 ? 1300 : -20, (t * 85 + i * 210) % 1100 - 150, { w: 420, h: 250, rot: i * .7, a: .35 });
      });
      if (t < .64) C.hitBloom(c, t);
    }
  });
})();
