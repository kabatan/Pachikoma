/* 既存の演出(1〜6灯の点灯・重複ルーレット・昇天)を、見えない iframe の LCDAPI(anim/upa_swim ?embed=1)で動かして液晶に描く。
 * 昇天はルーレットの続きとして同じ映像の中で進む(LCD.mono.phase が 'ascend' になった瞬間を光バス側が拾う)。
 * 針の位置は LCD.mono.needle(0..1, 12時=0, 時計回り)。 */
(function () {
  'use strict';
  const { W, H } = LCD;
  const M = LCD.mono = { api: null, ready: false, needle: null, phase: null, kind: null };
  (LCD.initHooks = LCD.initHooks || []).push(async (opt) => {
    if (opt.mono === false || typeof document === 'undefined') return;
    const root = opt.root || '/';
    // 展示会場で外のネットが無くても動くよう、Pixi は同梱のコピーに差し替えた同一オリジンの Blob で読む
    let html = await (await fetch(root + 'anim/upa_swim/index.html')).text();
    html = html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pixi\.js\/7\.4\.2\/pixi\.min\.js/, location.origin + root + 'anim/upa_swim/vendor/pixi.min.js')
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@pixi\/unsafe-eval@7\.4\.2\/dist\/unsafe-eval\.min\.js/, location.origin + root + 'anim/upa_swim/vendor/unsafe-eval.min.js')
      .replace(/<link[^>]*fonts\.googleapis[^>]*>/, '')
      .replace('new URLSearchParams(location.search)', `new URLSearchParams('embed=1&res=${opt.monoRes || 0.5}')`);
    const f = document.createElement('iframe');
    f.src = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1280px;height:720px;border:0;visibility:hidden';
    document.body.append(f); M.frame = f;
    await new Promise((r) => f.addEventListener('load', r));
    await f.contentWindow.LCDAPI.whenReady(); M.api = f.contentWindow.LCDAPI; M.ready = true;
  });
  const finish = (sc, api, dt) => {
    api.step(dt * (sc.rate || 1)); const st = api.state(); M.needle = st.needle; M.phase = st.phase; M.kind = st.kind;
    if (!api.busy() && sc.t > .3) { sc.t = 1e9; M.needle = null; M.phase = null; M.kind = null; }
  };
  // 玉が口に入った後に落下の0.55秒を待たせない(液晶は実際の結果の後すぐ反応する)。着地は約0.1秒後
  const skipFall = (api) => { for (let i = 0; i < 11; i++) api.step(.05); };
  const draw = (c) => { if (M.api) c.drawImage(M.api.canvas, 0, 0, W, H); };
  // 灯の演出: 背景が止まって見えないよう、桜の花びらを流し、中央から光の筋をゆっくり回す
  const lampDraw = (c, t, sc) => {
    draw(c);
    if (LCD.B && LCD.B.drift) LCD.B.drift(c, t, 30, { a: .8 * LCD.smooth((t - .5) / .5) });
    const a = LCD.smooth((t - .5) / .6) * .22; c.save(); c.globalCompositeOperation = 'lighter'; c.translate(640, 330); c.rotate(t * .18);
    for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); const g = c.createLinearGradient(0, 0, 0, -760); g.addColorStop(0, 'rgba(255,236,190,' + a + ')'); g.addColorStop(1, 'rgba(255,236,190,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(-14, 0); c.lineTo(14, 0); c.lineTo(46, -760); c.lineTo(-46, -760); c.fill(); }
    c.restore();
  };
  // 昇天の間は画面が暗いので、天へ昇る光の柱を左右対称に重ねる
  const ascendGlow = (c, t) => {
    const ph = M.phase; if (ph !== 'ascend' && ph !== 'return') return;
    const k = ph === 'ascend' ? 1 : .45; c.save(); c.globalCompositeOperation = 'lighter';
    // 天から降りる光の柱(外側ほど淡い3重)。中央が最も強く、左右対称
    for (const [x, w, a] of [[640, 150, .5], [300, 105, .3], [980, 105, .3], [90, 75, .16], [1190, 75, .16]]) {
      const aa = a * k * (.85 + .15 * Math.sin(t * 4.5 + x * .01));
      for (let n = 0; n < 3; n++) {
        const ww = w * (1 - n * .3), al = aa * (.35 + n * .3);
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,244,214,' + al + ')'); g.addColorStop(.7, 'rgba(255,226,160,' + al * .35 + ')'); g.addColorStop(1, 'rgba(255,214,140,0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(x - ww * .35, 0); c.lineTo(x + ww * .35, 0); c.lineTo(x + ww, H); c.lineTo(x - ww, H); c.closePath(); c.fill();
      }
    }
    c.restore();
  };
  // 6灯: 「JPチャンス!」の知らせ。タイトル→あと1つでJP(7つ目の穴が金に脈打つ)。灯が増えた映像の上に重ねる
  const jpNotice = (c, t) => {
    const { smooth, easeOut, lerp, clamp } = LCD, B = LCD.B, q = clamp((t - .75) / .35), a = smooth(q);
    if (a <= 0) return;
    // 下の「6灯」の映像を深い琥珀色に沈めてから文字を出す(6灯の大きな「6」とJPチャンスが重ならないように)
    c.save(); c.globalAlpha = .9 * a; c.fillStyle = '#1c0a00'; c.fillRect(0, 0, W, H); c.restore();
    LCD.rays(c, 640, 300, { n: 28, a: .2 * a, rot: t * .25, color: '255,176,0', len: 900 });
    LCD.add(c, 'glow_soft.png', 640, 300, { w: 1300 * a, h: 460 * a, a: .22 * a, tint: '#ff9a00' });   // 金は #ffb000 付近の高彩度のまま。足し算を強くすると白く飛ぶので控える
    const z = t < 1.1 ? lerp(1.9, 1, easeOut(q)) : 1 + .05 * Math.sin((t - 1.1) * 9) * Math.exp(-(t - 1.1) * 2);
    LCD.titleFit(c, 'jpchance', 'JPチャンス!', 640, 280, { w: 1120, h: 240, zoom: z, a, glowA: .9 + .5 * Math.sin(t * 10) });
    if (B && B.shine) B.shine(c, t, (gg) => LCD.titleFit(gg, 'jpchance', 'JPチャンス!', 640, 280, { w: 1120, h: 240, zoom: z, shadowA: 0, glowA: 0 }), { a: .8 * a, speed: 1.1 });
    const sa = smooth((t - 1.35) / .3);
    if (sa > 0 && B && B.holes) {
      B.holes(c, 640, 470, t, { lit: [1, 2, 3, 4, 5, 6] }, { step: 100, r: 28, a: sa });
      const beat = .5 + .5 * Math.sin(t * 9); LCD.add(c, 'glow_soft.png', 640 + 300, 470, { w: 170 + 60 * beat, h: 170 + 60 * beat, a: sa * (.4 + .5 * beat), tint: '#ffd24a' });
      LCD.text(c, 'あと 1つ そろえば JP!', 640, 560, { size: 56, weight: 900, a: sa, fill1: '#fff9e0', fill2: '#ffd24a', stroke: 10, strokeColor: '#6e3f18', glow: '#d98a3a' });
    }
  };
  const lampScene = (id, fixed, dur) => LCD.scene({ id, dur, hold: false, cover: true, assets: fixed === 6 ? ['t_jpchance_face.png', 't_jpchance_glow.png', 't_jpchance_shadow.png', 'flare_streak.png', 'rays_soft.png'] : [],
    start(sc, p) { const n = fixed || Math.max(1, Math.min(3, p.n || LCD.state.n || 1)); if (M.api) { M.api.reset(); M.api.setLamps(Math.max(0, n - 1)); M.api.lamp(n); skipFall(M.api); } },
    update(sc, dt) { if (M.api) finish(sc, M.api, dt); else sc.t = 1e9; }, draw: fixed === 6 ? (c, t, sc) => { lampDraw(c, t, sc); jpNotice(c, t); } : lampDraw });
  lampScene('lamp123', 0, 3.2); lampScene('lamp4', 4, 4.7); lampScene('lamp5', 5, 4.0); lampScene('lamp6', 6, 4.3);
  LCD.scene({ id: 'roulette', dur: 20, cover: true, assets: [],
    start(sc, p) {
      sc.rate = Math.max(.5, Math.min(6, p.rate || 1));   // 賭けた灯が少ないときは短縮版(映像を速く進める)
      const n = Math.max(1, Math.min(5, p.n_from || LCD.state.n || 3)); let k = p.k ?? 1; if (k !== 'all') k = Math.max(1, Math.min(3, n, k));
      if (M.api) { M.api.reset(); M.api.setLamps(n); if (!M.api.roulette({ n_from: n, k })) console.warn('roulette refused', n, k); }
    },
    update(sc, dt) { if (M.api) finish(sc, M.api, dt); else sc.t = 1e9; }, draw(c, t) { draw(c); ascendGlow(c, t); } });
  LCD.scene({ id: 'ascend', dur: .05, draw() {} });   // ルーレットの映像の中で進む(何もしない)
})();
