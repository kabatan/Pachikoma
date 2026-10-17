/* 失敗は2.6秒。全員が光になって昇る。電飾の制御はホストに任せる。 */
(function () {
  const C = LCD.C, { smooth, clamp } = LCD;
  const ascent = age => 525 - 710 * Math.pow(clamp((age - .22) / 1.42), 2);
  LCD.scene({ id: 'fail', dur: 2.6, assets: [...C.assets, ...C.titleAssets('shippai')],
    start(sc) {
      LCD.shake(5, .2); LCD.flash(.22, '#cceeff', 4);
      const src = LCD.upaCanvas('calm'), data = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, rnd = LCD.rng(811);
      sc.S.dots = []; sc.S.sw = src.width; sc.S.sh = src.height;
      for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (data[(y * src.width + x) * 4 + 3] > 90) {
        sc.S.dots.push({ x, y, at: .48 + rnd() * .57, vx: (rnd() - .5) * 52, vy: -90 - rnd() * 150, life: .5 + rnd() * .38, gold: rnd() < .24 });
      }
    },
    draw(c, t, sc) {
      C.fade(c, t, 2.6, .38, c => {
        LCD.dim(c, .72 * smooth(t / .12), '#07182d');
        // 青白い天井光と、淡い金の入口。割れ物/放電ではなく、別れの光。
        LCD.add(c, 'glow_soft.png', 640, -60, { w: 1550, h: 650, a: .32 * LCD.env(t, 0, 2.35, .12, .4), tint: '#b9edff' });
        LCD.add(c, 'flare_streak.png', 640, 70 - t * 34, { w: 1170, h: 90, a: .28 * LCD.env(t, .25, 2.2, .3, .4), tint: '#fff1cb' });
        for (let i = 0; i < 7; i++) {
          const x = 640 + (i - 3) * 156, delay = Math.abs(i - 3) * .045, age = t - delay, y = ascent(age), body = 1 - smooth((age - .65) / .62);
          const beam = LCD.env(age, .15, 1.95, .25, .4);
          LCD.add(c, 'glow_soft.png', x, 260, { w: 100, h: 780, a: beam * .2, tint: i % 3 ? '#bcecff' : '#fff0c7' });
          if (body > 0) {
            LCD.add(c, 'glow_soft.png', x, y, { w: 210, h: 150, a: body * .33, tint: '#d0efff' });
            LCD.add(c, 'flare_ring.png', x, y - 56, { w: 100, h: 25, a: smooth((age - .2) / .2) * body * .65, tint: '#fff0c1' });
            LCD.upa(c, x, y, { scale: 3, hue: LCD.HUES[i], mood: 'calm', a: body });
          }
          // 体と同じ画素位置からほどけ、真上へ流れる。飛散/落下させない。
          for (const p of sc.S.dots) {
            const e = age - p.at;
            if (e < 0 || e >= p.life) continue;
            const alpha = smooth(e / .06) * (1 - smooth((e - p.life * .55) / (p.life * .45)));
            const px = x + (p.x - sc.S.sw / 2) * 3 + p.vx * e + Math.sin(e * 3 + i) * 4;
            const py = ascent(p.at) + (p.y - sc.S.sh / 2) * 3 + p.vy * e - 145 * e * e;
            c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = alpha * .85; c.fillStyle = p.gold ? '#ffedbc' : '#d7f5ff'; c.fillRect(Math.round(px), Math.round(py), 3, 3); c.restore();
          }
          // 小さな上昇する星だけを最後まで残す。
          for (let k = 0; k < 5; k++) {
            const e = t - .36 - k * .09 - delay;
            if (e < 0 || e > 1.65) continue;
            LCD.add(c, k % 2 ? 'spark.png' : 'glint_1.png', x + Math.sin(e * 2 + k) * 36, 530 - e * (170 + k * 35), { w: k % 2 ? 12 : 23, h: k % 2 ? 12 : 23, a: .46 * LCD.env(e, 0, 1.65, .15, .5), tint: k % 2 ? '#bdeaff' : '#ffedc1' });
          }
        }
        LCD.add(c, 'glow_soft.png', 640, 215, { w: 1000, h: 360, a: .42 * LCD.env(t, .03, 1.6, .12, .3), tint: '#9fc6ff' });
        LCD.text(c, '失敗', 640, 235 + (1 - LCD.easeOut((t - .05) / .26)) * -57, { size: 190, a: LCD.env(t, .03, 1.5, .12, .3), fill1: '#f4f7ff', fill2: '#92a8ff', glow: '#4a6cff' });
        LCD.text(c, '次こそ!', 640, 430, { size: 96, a: LCD.env(t, 1.68, 2.6, .2, .3), fill1: '#fff7e5', fill2: '#ffdfb2', glow: '#c8e9ff' });
      });
    }
  });
})();
