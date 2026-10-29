// JPチャンスのチュートリアル（10/30）の「穴を指す部品」：下向きの矢印・穴から立つ光柱・光の筋（爆発）。
// 映像には焼かず、残った1つの穴(d=1〜7)の真上に実行時に重ねる。穴の位置は HOLE_X（液晶の下端の7区画。1152 幅の座標）。
//   使い方: const ov = await loadTutorialOverlay(baseUrl); ov.draw(ctx, t, d, {holeX});   ctx は 1152x1268 の液晶面の座標（translate 済み）
//   t は場面（tutorial_jp_n*）の経過秒。矢印は 0.35〜2.2 秒、光柱は 0〜2.2 秒、光の筋は 0.3・1.1・1.8 秒（v04 のカット1と同じ）。
// 素材: tutorial_jp/arrow.png（300x400 の矢印）、tutorial_jp/burst_atlas.jpg（576x634 を 6x4、光の筋 24 コマ。中心が穴）。
export const HOLE_X = [46, 214, 394, 576, 746, 924, 1104];
export const OVERLAY = {
  W: 1152, H: 1268,
  arrow: { t0: 0.35, t1: 2.2, cy: 880, w: 300, h: 400, minX: 150, maxX: 1002 },
  beam: { t0: 0, t1: 2.2, w: 60, h: 600, y: 1268 },
  bursts: [{ t: 0.3, dur: 0.8, op: 0.4 }, { t: 1.1, dur: 0.8, op: 0.4 }, { t: 1.8, dur: 0.6, op: 0.4 }],
  burstR: 120,
};
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });

export async function loadTutorialOverlay(base) {
  const [arrow, atlas] = await Promise.all([img(new URL('tutorial_jp/arrow.png', base).href), img(new URL('tutorial_jp/burst_atlas.jpg', base).href)]);
  return createTutorialOverlay({ arrow, atlas });
}

export function createTutorialOverlay({ arrow, atlas, holeX = HOLE_X, cfg = OVERLAY }) {
  const A = cfg.arrow, B = cfg.beam;
  function draw(ctx, t, d, opt = {}) {
    const hx = (opt.holeX ?? holeX)[Math.min(6, Math.max(0, (d | 0) - 1))];
    ctx.save();
    // 光の筋（背後）
    for (const b of cfg.bursts) {
      const u = (t - b.t) / b.dur;
      if (u < 0 || u >= 1 || t > A.t1) continue;
      const env = (1 - u) ** 2 * Math.min(1, u / 0.08), j = Math.min(23, Math.floor(u * 24));
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, b.op * 1.15 * env);
      ctx.drawImage(atlas, (j % 6) * 576, Math.floor(j / 6) * 634, 576, 634, hx - cfg.W, B.y - cfg.H, cfg.W * 2, cfg.H * 2);   // 光の筋の中心＝穴
      ctx.globalAlpha = 1;
      const r = cfg.burstR * 2.2, g = ctx.createRadialGradient(hx, B.y, 0, hx, B.y, r);
      g.addColorStop(0, `rgba(255,217,128,${0.55 * env})`); g.addColorStop(0.5, `rgba(255,217,128,${0.2 * env})`); g.addColorStop(1, 'rgba(255,217,128,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - r, B.y - r, r * 2, r * 2);
    }
    // 穴の光（やわらかい縦の光柱＋にじみ）
    if (t >= B.t0 && t <= B.t1) {
      const u = t - B.t0, pulse = 0.65 + 0.35 * Math.sin(u * 9), env = Math.min(1, u / 0.15) * Math.min(1, (B.t1 - t) / 0.15);
      ctx.globalCompositeOperation = 'lighter';
      ctx.save(); ctx.translate(hx, B.y); ctx.scale(B.w * 1.6, B.h * 1.05);   // 縦長の楕円の光（中心＝穴）
      let g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,209,89,${0.95 * pulse * env})`); g.addColorStop(0.35, `rgba(255,209,89,${0.55 * pulse * env})`); g.addColorStop(0.7, `rgba(255,190,70,${0.18 * pulse * env})`); g.addColorStop(1, 'rgba(255,190,70,0)');
      ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      const hr = B.w * 2.6 * 1.7;
      g = ctx.createRadialGradient(hx, B.y, 0, hx, B.y, hr);
      g.addColorStop(0, `rgba(255,209,89,${0.85 * pulse * env})`); g.addColorStop(0.5, `rgba(255,209,89,${0.3 * pulse * env})`); g.addColorStop(1, 'rgba(255,209,89,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - hr, B.y - hr, hr * 2, hr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // 下向きの矢印（穴の方向を示す）。端の穴では矢印が画面から出ないよう中心を内側へ寄せ、穴の方へ傾ける
    if (t >= A.t0 && t <= A.t1) {
      const u = t - A.t0, env = Math.min(1, u / 0.15) * Math.min(1, (A.t1 - t) / 0.15), bob = 32 * Math.abs(Math.sin(u * 6));
      const ax = Math.min(A.maxX, Math.max(A.minX, hx)), ay = A.cy + bob, sc = 1 + 0.05 * Math.sin(u * 12);
      const tipY = ay + A.h / 2, ang = Math.atan2(ax - hx, Math.max(60, cfg.H - tipY));
      ctx.globalCompositeOperation = 'lighter';
      ctx.save(); ctx.translate(ax, ay); ctx.scale(140, 220);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,191,77,${0.55 * env})`); g.addColorStop(0.5, `rgba(255,191,77,${0.2 * env})`); g.addColorStop(1, 'rgba(255,191,77,0)');
      ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.scale(sc, sc);
      ctx.shadowColor = `rgba(0,0,0,${0.5 * env})`; ctx.shadowBlur = 22; ctx.globalAlpha = env;
      ctx.drawImage(arrow, -A.w / 2, -A.h / 2, A.w, A.h);
      ctx.restore();
    }
    ctx.restore();
  }
  return { draw, HOLE_X: holeX, cfg };
}
