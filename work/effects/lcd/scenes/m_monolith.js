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
    // 時間の倍率は一度だけ。sc.dt は LCD.update が実時間 dt を sc.scale で割ったもの(=実時間×rate)なので、ルーレットは実時間に戻して rate を掛け直す。
    // (以前は sc.dt に rate をもう一度掛けて rate² 倍で進み、3灯のルーレットが目標3.4秒でなく0.9秒で終わり、1コマで約5回の全描画をしていた: R2-X/R2-E 調査)
    // 実時間の1コマは 0.05 秒を上限にする(遅れたフレームでまとめて進めて更に遅れる増幅を断つ)。
    const real = Math.min(.05, dt * (sc.scale || 1));
    api.step(sc.rate ? real * sc.rate : real / (sc.scale || 1)); const st = api.state(); M.needle = st.needle; M.phase = st.phase; M.kind = st.kind;
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
    const { smooth, easeOut, lerp, clamp } = LCD, B = LCD.B, q = clamp((t - .95) / .3), a = smooth(q), d = smooth(clamp((t - .75) / .15));
    if (d <= 0) return;
    // 下の「6灯」の映像を深い琥珀色に先に沈め(0.75〜0.9秒)、沈みきってから文字を出す(0.95秒〜)。「6灯」とJPチャンスが同じコマに写らない
    c.save(); c.globalAlpha = .9 * d; c.fillStyle = '#1c0a00'; c.fillRect(0, 0, W, H); c.restore();
    if (a <= 0) return;
    LCD.rays(c, 640, 300, { n: 28, a: .2 * a, rot: t * .25, color: '255,176,0', len: 900 });
    LCD.add(c, 'glow_soft.png', 640, 300, { w: 1300 * a, h: 460 * a, a: .36 * a, tint: '#ffa800' });   // 金は #ffb000 付近の高彩度のまま。足し算を強くすると白く飛ぶので控える
    const z = t < 1.1 ? lerp(1.9, 1, easeOut(q)) : 1 + .05 * Math.sin((t - 1.1) * 9) * Math.exp(-(t - 1.1) * 2);
    LCD.titleFit(c, 'jpchance', 'JPチャンス!', 640, 280, { w: 1120, h: 240, zoom: z, a, glowA: .9 + .5 * Math.sin(t * 10) });
    if (B && B.shine) B.shine(c, t, (gg) => LCD.titleFit(gg, 'jpchance', 'JPチャンス!', 640, 280, { w: 1120, h: 240, zoom: z, shadowA: 0, glowA: 0 }), { a: .8 * a, speed: 1.1 });
    const sa = smooth((t - 1.35) / .3);
    if (sa > 0) {   // 盤の穴の並びは液晶に写さない(最後の穴は穴のLEDが白金で脈打つ)。液晶は言葉と数だけ
      LCD.text(c, 'あと 1つ そろえば JP!', 640, 500, { size: 66, a: sa, fill1: '#fff9e0', fill2: '#ffd24a', stroke: 11, strokeColor: '#6e3f18', glow: '#d98a3a' });
      const JA = LCD.rules().jackpotAwards || [], lo = Math.min(...JA), hi = Math.max(...JA);   // JPの配当は規則から読む(固定値にしない)
      if (JA.length) LCD.text(c, `JPで ${lo}〜${hi}玉!`, 640, 600, { size: 60, a: smooth((t - 1.6) / .3), fill1: '#fff9e0', fill2: '#ffe08a', stroke: 10, strokeColor: '#6e3f18', glow: '#d98a3a' });
    }
  };
  const lampScene = (id, fixed, dur) => LCD.scene({ id, dur, hold: false, cover: true, assets: fixed === 6 ? ['t_jpchance_face.png', 't_jpchance_glow.png', 't_jpchance_shadow.png', 'flare_streak.png', 'rays_soft.png'] : [],
    start(sc, p) { const n = fixed || Math.max(1, Math.min(3, p.n || LCD.state.n || 1)); if (M.api) { M.api.reset(); M.api.setLamps(Math.max(0, n - 1)); M.api.lamp(n); skipFall(M.api); } },
    update(sc, dt) { if (M.api) finish(sc, M.api, dt); else sc.t = 1e9; }, draw: fixed === 6 ? (c, t, sc) => { lampDraw(c, t, sc); jpNotice(c, t); } : lampDraw });
  lampScene('lamp123', 0, 3.2); lampScene('lamp4', 4, 4.7); lampScene('lamp5', 5, 4.0); lampScene('lamp6', 6, 4.3);
  // ───────── ルーレットの並走(最大3枚) ─────────
  // iframe の映像(ヒーロー)は1枚しか持てないので、最初のルーレットだけがそれを使い、後から来たものは同じ見た目の2D盤(サテライト)で並べる。
  // 1枚だけの時は従来どおり全画面。2枚以上になると上の板(のこり・もちだま)の下に横並びの枠に縮み、各枠の下に「何灯からいくつ消えるか」と結果を出し続ける。
  // 時間はどちらも sc.t(=自然な秒。実時間×再生倍率)。ヒーローの iframe と同じ時間割(盤が出るのは1.9、針が回り始めるのは2.05、止まるのは6.8、昇天は8.3〜)で動く。
  const RLN = { off: .8, ramp0: 1.25, ramp1: 1.5, dec0: 3.3, W0: 1700, Wc: 280, T: 6.0, asc0: 7.5 };
  const RL_FALLBACK = { c1: { probs: [['m1', .90], ['m2', .08], ['m3', .02]], frac: .8 }, c2: { probs: [['m1', .75], ['all', .03], ['m3', .07], ['m2', .15]], frac: .55 }, c3: { probs: [['m1', .50], ['all', .15], ['m3', .10], ['m2', .25]], frac: .5 } };
  const RL_TXT = { m1: '−1', m2: '−2', m3: '−3', all: '全消灯' }, RL_TIERN = { m1: 1, m2: 2, m3: 3, all: 4 };
  const RL_ASSETS = ['rl_rim.png', 'rl_dome.png', 'rl_hub.png', 'rl_face_1.png', 'rl_face_2.png', 'rl_face_3.png', 'rl_face_4.png', 'rl_needle.png', 'rl_needle_glow.png', 'rl_lamp_on.png', 'rl_lamp_off.png', 'glow_soft.png', 'flare_ring.png'];
  const rlSm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
  const rlOmega = (t) => { const T = RLN; if (t < T.ramp0) return 0; if (t < T.ramp1) return T.W0 * rlSm((t - T.ramp0) / (T.ramp1 - T.ramp0)); if (t < T.dec0) return T.W0 * Math.pow(T.Wc / T.W0, (t - T.ramp1) / (T.dec0 - T.ramp1)); if (t < T.T) { const u = (t - T.dec0) / (T.T - T.dec0); return T.Wc * Math.pow(1 - u, 2.3); } return 0; };
  let rlCum = null;
  const rlCumAt = (x) => { if (!rlCum) { const N = Math.round(RLN.T * 2000); rlCum = new Float64Array(N + 1); for (let i = 1; i <= N; i++) rlCum[i] = rlCum[i - 1] + rlOmega((i - .5) / 2000) / 2000; } return rlCum[Math.min(rlCum.length - 1, Math.max(0, Math.round(x * 2000)))]; };
  const rlTheta = (sc, u) => { const tt = Math.min(u, RLN.T); let th = sc.target - (rlCumAt(RLN.T) - rlCumAt(tt)); if (u > RLN.T) { const d = u - RLN.T; th += 1.1 * Math.exp(-d * 14) * Math.sin(d * 70); } return th; };
  const rlSetup = (sc, n, k) => {
    const cases = (M.frame && M.frame.contentWindow && M.frame.contentWindow.__rl && M.frame.contentWindow.__rl.cases) || RL_FALLBACK, out = k === 'all' ? 'all' : 'm' + k;
    const near = cases[n <= 3 ? 'c1' : n === 4 ? 'c2' : 'c3'], tpl = near.probs.some(([id]) => id === out) ? near : cases.c2;
    const segs = []; let a = 270 - tpl.probs[0][1] * 360 / 2; for (const [id, p] of tpl.probs) { const w = p * 360; segs.push({ k: id, a0: a, a1: a + w, w, mid: a + w / 2 }); a += w; }
    sc.segs = segs; sc.out = out; sc.n = n; sc.kk = k; const hit = segs.find((x) => x.k === out); sc.target = hit.a0 + hit.w * tpl.frac;
    sc.nAsc = k === 'all' ? n : Math.min(n, k); sc.ascGap = (k === 'all' && n >= 2) ? .09 : .38;
    sc.endU = Math.max(RLN.asc0 + (sc.nAsc - 1) * sc.ascGap + 2.45, RLN.T + 1.5 * (sc.rate || 1));   // 昇天が終わったあと、止まってから実時間で1.5秒は結果を残す
  };
  M.roul = []; M.heroSc = null;
  const rlPurge = () => { M.roul = M.roul.filter((s) => !s.over && (!s.live || LCD.active.includes(s))); if (M.heroSc && (M.heroSc.over || (M.heroSc.live && !LCD.active.includes(M.heroSc)))) M.heroSc = null; };
  // 光バス側の問い合わせ: いま動いているルーレットの枚数と、まだ結果が出ていない枚数(空き枠の判断に使う)
  M.rlCount = () => { rlPurge(); return M.roul.length; };
  M.rlPending = () => { rlPurge(); return M.roul.filter((s) => s.t - RLN.off < RLN.T + .3).length; };
  const rlEnd = (sc) => { sc.over = true; sc.t = 1e9; if (M.heroSc === sc) { M.heroSc = null; M.needle = null; M.phase = null; M.kind = null; } M.roul = M.roul.filter((s) => s !== sc); };
  const rlTarget = (sc) => {
    const n = M.roul.length, i = Math.max(0, M.roul.indexOf(sc));
    if (n <= 1) return { x: 0, y: 0, w: W, h: H };
    const top = 168, m = 18, gap = 12, w = (W - 2 * m - (n - 1) * gap) / n;
    return { x: m + i * (w + gap), y: top, w, h: H - 4 - top };
  };
  const rlStep = (sc, dt) => {
    const real = dt * (sc.scale || 1), tg = rlTarget(sc), e = 1 - Math.exp(-real * 12);
    if (!sc.rect) sc.rect = { ...tg }; else for (const q of ['x', 'y', 'w', 'h']) sc.rect[q] += (tg[q] - sc.rect[q]) * e;
  };
  // 枠の中の盤の大きさ・位置(全画面のときは従来の位置と大きさ)
  const rlGeom = (sc) => {
    const r = sc.rect, chrome = LCD.clamp((1180 - r.w) / 500), k = Math.min(1, (r.w - 24) / 530, (r.h - 130) / 530);
    const kk = LCD.lerp(1, Math.max(.4, k), chrome), cx = r.x + r.w / 2, cyP = r.y + 10 + 265 * kk, cy = LCD.lerp(r.y + r.h / 2, cyP, chrome);
    return { r, chrome, k: kk, cx, cy, bandY: r.y + r.h - 112 };
  };
  const rlFrame = (c, g) => {   // 枠の台(暗い赤)と縁
    const { r, chrome } = g; if (chrome <= 0) return;
    c.save(); c.globalAlpha = chrome; c.fillStyle = 'rgba(8,0,6,.96)'; c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 22); c.fill();
    c.strokeStyle = 'rgba(255,70,80,.55)'; c.lineWidth = 3; c.stroke(); c.restore();
  };
  // 結果の札と、消えていく灯(枠の下)。ヒーローの映像にも重ねるので、結果は枠ごとに出し続ける
  const rlResult = (c, sc, u, g, alpha) => {
    const { smooth, easeOutBack, clamp, lerp } = LCD, rate = sc.rate || 1, hit = sc.out, txt = hit === 'all' ? '全消灯' : `${RL_TXT[hit]}灯`;
    const tr = (u - RLN.T - .12) / (.22 * rate), q = clamp(tr);
    const mid = lerp(g.bandY + 28, g.cy, 1 - g.chrome), sz = lerp(58, 150, 1 - g.chrome);
    c.save(); c.globalAlpha = alpha;
    // 灯の並び(昇天のたびに1つずつ上へ消える)
    const n = sc.n, sp = Math.min(46, (g.r.w - 60) / Math.max(1, n)), py = g.chrome > .02 ? g.bandY + 84 : g.r.y + g.r.h - 52, px0 = g.cx - (n - 1) * sp / 2;
    for (let i = 0; i < n; i++) {
      const j = n - 1 - i, gone = j < sc.nAsc, t0 = RLN.asc0 + j * sc.ascGap, pr = gone ? clamp((u - t0) / (1.0 * rate)) : 0, x = px0 + i * sp, ls = 40;
      LCD.blit(c, 'rl_lamp_off.png', x, py, { w: ls, h: ls, a: .9 });
      const on = gone ? 1 - smooth(clamp((u - t0) / (.25 * rate))) : 1;
      if (on > 0) { LCD.add(c, 'rl_lamp_on.png', x, py, { w: ls, h: ls, a: on }); LCD.add(c, 'glow_soft.png', x, py, { w: ls * 2, h: ls * 2, a: .5 * on, tint: '#ffb0c8' }); }
      if (gone && pr > 0 && pr < 1) { const y = py - 70 * LCD.easeOut(pr); LCD.add(c, 'glow_soft.png', x, y, { w: 70, h: 70, a: .9 * (1 - pr), tint: '#ffe8a0' }); LCD.add(c, 'rl_lamp_on.png', x, y, { w: ls * .8, h: ls * .8, a: 1 - pr }); }
    }
    if (q > 0) {
      const z = easeOutBack(q);
      const col = { m1: '#ff6a5a', m2: '#ff3a3a', m3: '#ff8a3a', all: '#ffb0b0' }[hit];
      LCD.text(c, txt, g.cx, mid, { size: sz * (.7 + .3 * z), font: 'head', a: smooth(q * 1.6), fill1: '#fff8f0', fill2: col, stroke: sz * .16, strokeColor: '#3a0008', glow: '#ff2030' });
    }
    c.restore();
  };
  const satWheel = (c, sc, u, g, alpha) => {
    const { smooth, clamp, lerp } = LCD, rate = sc.rate || 1, r = 216 * g.k, D = 2 * r / .8, fs = 2 * r / .99, cx = g.cx, cy = g.cy, A = (d) => d * Math.PI / 180 - Math.PI / 2;
    const stopK = clamp((u - RLN.T - .12) / (.2 * rate)), th = rlTheta(sc, Math.max(0, u)), na = th * Math.PI / 180;
    const wa = smooth((u - .9) / (.5)), zoom = lerp(.78, 1, wa), a = alpha * wa;
    if (a <= 0) return;
    const heat = LCD.clamp((u - 1.9) / 1.2);
    LCD.radial(c, cx, cy, r * 1.9, '255,50,60', .5 * a);
    c.save(); c.translate(cx, cy); c.scale(zoom, zoom);
    for (const s of sc.segs) {
      const hitSeg = s.k === sc.out, dim = hitSeg ? 1 : 1 - .65 * stopK;
      c.save(); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r * 1.002, A(s.a0), A(s.a1)); c.closePath(); c.clip();
      LCD.blit(c, `rl_face_${RL_TIERN[s.k]}.png`, 0, 0, { w: fs, h: fs, a: a * dim }); c.restore();
    }
    c.strokeStyle = `rgba(160,170,190,${.8 * a})`; c.lineWidth = Math.max(1.5, r * .025);
    for (const s of sc.segs) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(A(s.a0)) * r, Math.sin(A(s.a0)) * r); c.stroke(); }
    for (const s of sc.segs) {
      if (s.w < 12) continue;
      const rr = s.w > 120 ? r * .62 : r * .66, x = Math.cos(A(s.mid)) * rr, y = Math.sin(A(s.mid)) * rr, sz = (s.w > 60 ? 64 : 40) * g.k * 1.1;
      LCD.text(c, RL_TXT[s.k], x, y, { size: sz, font: 'head', a: a * (s.k === sc.out ? 1 : 1 - .5 * stopK), fill1: '#fff', fill2: '#ffe0d8', stroke: 8 * g.k, strokeColor: 'rgba(0,0,0,.65)' });
    }
    c.restore();
    c.save(); c.translate(cx, cy); c.scale(zoom, zoom); c.translate(-cx, -cy);
    LCD.blit(c, 'rl_rim.png', cx, cy, { w: D, h: D, a });
    LCD.blit(c, 'rl_needle.png', cx, cy, { w: D / 2, h: D, rot: na, a });
    LCD.add(c, 'rl_needle_glow.png', cx, cy, { w: D / 2, h: D, rot: na, a: a * (.5 + .5 * clamp(rlOmega(Math.min(u, RLN.T)) / 500)) });
    LCD.blit(c, 'rl_hub.png', cx, cy, { w: r * .36, h: r * .36, a });
    LCD.add(c, 'rl_dome.png', cx, cy, { w: D, h: D, a: .5 * a });
    c.restore();
    // 始まりの閃光と、止まった瞬間の輪
    const fl = Math.max(0, 1 - Math.abs(u - 1.0) / (.5 * rate)) * .5; if (fl > 0) LCD.add(c, 'glow_soft.png', cx, cy, { w: r * 3, h: r * 3, a: fl * alpha, tint: '#ff5a50' });
    const ring = (u - RLN.T) / (.4 * rate); if (ring > 0 && ring < 1) LCD.add(c, 'flare_ring.png', cx, cy, { w: r * (1 + 1.6 * ring) * 2, h: r * (1 + 1.6 * ring) * 2, a: .8 * (1 - ring) * alpha });
  };
  LCD.scene({ id: 'roulette', dur: 20, cover: true, single: false, assets: RL_ASSETS,
    start(sc, p) {
      sc.rate = Math.max(.5, Math.min(6, p.rate || 1));   // 賭けた灯が少ないときは短縮版(映像を速く進める)
      const n = Math.max(1, Math.min(5, p.n_from || LCD.state.n || 3)); let k = p.k ?? 1; if (k !== 'all') k = Math.max(1, Math.min(3, n, k));
      rlPurge(); if (M.roul.length >= 3) rlEnd(M.roul.find((s) => s.t - RLN.off > RLN.T + .3) || M.roul[0]);   // 4枚目が来たら、結果が出終わった枠(無ければいちばん古い枠)を畳む。通常は光バス側が空きを待つ
      rlSetup(sc, n, k);
      const hero = M.api && !M.heroSc;
      if (hero) { M.heroSc = sc; M.api.reset(); M.api.setLamps(n); if (!M.api.roulette({ n_from: n, k })) console.warn('roulette refused', n, k); }
      else { sc.def = LCD.defs.roulette_sat; }
      sc.hero = !!hero; M.roul.push(sc); sc.rect = { ...rlTarget(sc) };
    },
    update(sc, dt) {
      sc.live = true; rlStep(sc, dt);
      // 覆う場面(cover)は後ろのものだけが描かれるので、後から来たヒーローは先に来ていたサテライトより前に並べ直す
      if (sc.hero && !sc.ordered) { sc.ordered = true; const arr = LCD.active.filter((x) => x !== sc), i = arr.findIndex((x) => x.def === LCD.defs.roulette_sat); if (i >= 0) { arr.splice(i, 0, sc); LCD.active = arr; } }
      if (M.api) finish(sc, M.api, dt); else sc.t = 1e9;
      if (sc.t > 1e8) rlEnd(sc);
    },
    draw(c, t, sc) {
      if (!sc.segs) return;   // 先読み(prewarm)の仮の場面は start が走っていない
      const g = rlGeom(sc), u = t - RLN.off;
      if (g.chrome <= .004 && M.roul.length <= 1) { draw(c); ascendGlow(c, t); return; }
      rlFrame(c, g);
      c.save(); c.beginPath(); c.rect(g.r.x, g.r.y, g.r.w, g.chrome > .02 ? g.bandY - g.r.y : g.r.h); c.clip();
      if (M.api) { c.translate(g.cx - 640 * g.k, g.cy - 360 * g.k); c.scale(g.k, g.k); c.drawImage(M.api.canvas, 0, 0, W, H); ascendGlow(c, t); }
      c.restore();
      if (g.chrome > .02) rlResult(c, sc, u, g, g.chrome);
    } });
  // 後から来たルーレット(2D盤)。ヒーローが使っている間の2枚目・3枚目
  LCD.scene({ id: 'roulette_sat', dur: 20, cover: false, single: false, assets: [],
    update(sc, dt) {
      sc.live = true; rlStep(sc, dt);
      if (sc.t - RLN.off >= sc.endU) rlEnd(sc);
    },
    draw(c, t, sc) {
      const g = rlGeom(sc), u = t - RLN.off;
      if (g.chrome <= .02) { c.fillStyle = '#05000a'; c.fillRect(0, 0, W, H); } else rlFrame(c, g);
      c.save(); c.beginPath(); c.rect(g.r.x, g.r.y, g.r.w, g.r.h); c.clip();
      satWheel(c, sc, u, g, 1); c.restore();
      rlResult(c, sc, u, g, 1);
    } });
  // 段階アップ(4→5→6灯が続いた時): 灯の場面を切らずに、上の中央に「いま何灯まで来たか」を重ねる。連打して続けて灯る時ほど、数字が駆け上がって派手になる。
  //   params: { from, to, chain: ['4','5',...] }。同じidは1つだけ(次の段が来たら作り直し)。灯の場面(cover)の上に描く。
  LCD.scene({ id: 'ladder', dur: 1.9, assets: ['glow_soft.png', 'flare_ring.png', 'glint_1.png'],
    draw(c, t, sc) {
      const { smooth, clamp, easeOutBack, easeOut, lerp } = LCD, to = sc.params.to || 5, from = sc.params.from || to - 1, a = smooth(t / .12) * (1 - smooth((t - 1.55) / .35));
      if (a <= 0) return;
      const cx = 640, y = 58, q = easeOutBack(clamp(t / .32)), hot = to >= 6, col = hot ? '#ffd24a' : to >= 5 ? '#ff9ac0' : '#ffe27a';
      c.save(); c.globalAlpha = a;
      LCD.add(c, 'glow_soft.png', cx, y + 30, { w: 520 * q, h: 250 * q, a: .42 * a, tint: hot ? '#ffb000' : '#ff7aa8' });
      // 6つの丸(下の灯の数と同じ並び)。これまでの段は金、新しい段は弾んで光る
      for (let i = 1; i <= 6; i++) {
        const x = cx + (i - 3.5) * 46, on = i <= to, fresh = i > from && i <= to, k = fresh ? 1 + .55 * Math.max(0, 1 - (t - (i - from) * .1) * 3) : 1;
        c.fillStyle = on ? (fresh ? '#fff3a0' : '#ffd24a') : 'rgba(255,255,255,.2)'; c.strokeStyle = on ? '#6e3f18' : 'rgba(255,255,255,.4)'; c.lineWidth = 4;
        c.beginPath(); c.arc(x, y, 15 * k, 0, LCD.TAU); c.fill(); c.stroke();
        if (fresh) LCD.add(c, 'glow_soft.png', x, y, { w: 90 * k, h: 90 * k, a: .7 * Math.max(0, 1 - (t - (i - from) * .1) * 1.6), tint: '#ffe08a' });
      }
      LCD.text(c, `ランプ ${from}つ → ${to}つ!`, cx, y + 62, { size: 54 * lerp(1.35, 1, easeOut(clamp(t / .3))), stroke: 9, fill1: '#fff9e0', fill2: col, strokeColor: '#6e3f18', glow: hot ? '#ff9a1a' : '#d9578a' });
      c.restore();
    } });
  LCD.scene({ id: 'ascend', dur: .05, draw() {} });   // ルーレットの映像の中で進む(何もしない)
})();
