// 継続選択(確定の窓)と時間切れ(左の札)の「TOTAL 桁」と「連×N」を、焼き込みでなく実行時に重ねる。
// 映像側は桁を抜いた版(選択: 05_choice/r2/stills/v21_nodigit、時間切れ: timeup_total_plates_20261029 の板)。
// 桁・連の字は確定の本番映像と同じ部品(07_confirm/v30/prod/parts)。値は決まった確定額で、桁は流さない。
const PARTS = new URL('../../../effects/jp_teacher/07_confirm/v30/prod/parts/', import.meta.url);
const NV21 = new URL('../../../effects/jp_teacher/05_choice/r2/stills/v21_nodigit/', import.meta.url);
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const loadImage = (url) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error('image unavailable: ' + url)); im.src = url; });

// 確定の映像の座標(1152×1268)での配置(07_confirm/v30/prod/parts/layout.json と comp30.py)
const L = { digit: { x0: 115, cell: 164, cy: 787.5, n: 5 }, chain: { x0: 562.5, cell: 88, cy: 465 }, ren: { cx: 457.5, cy: 476 }, x: { cx: 533, cy: 485 } };
const T_CH = 84, T_ROW2 = 96, LOOP = 176, XF = 14;
const SLAM_CHAIN = [2.4, 1.55, 1.12, 0.93, 1.04, 1];

export async function loadTotalParts() {
  const d = await Promise.all([...Array(10).keys()].map((i) => loadImage(new URL(`d${i}.png`, PARTS).href)));
  const c = await Promise.all([...Array(10).keys()].map((i) => loadImage(new URL(`c${i}.png`, PARTS).href)));
  const [ren, x] = await Promise.all([loadImage(new URL('ren.png', PARTS).href), loadImage(new URL('x.png', PARTS).href)]);
  return { d, c, ren, x };
}

// 字に影と光を付けた板を作る(確定の映像の comp30.frame と同じ向き: 暗い影を右下へ、橙の光を周りへ)。pad は板の余白。
function lit(draw, w, h, pad, k = 1) {
  const T = mk(w + 2 * pad, h + 2 * pad), t = T.getContext('2d');
  t.translate(pad, pad); draw(t); t.setTransform(1, 0, 0, 1, 0, 0);
  const out = mk(T.width, T.height), o = out.getContext('2d');
  o.filter = `blur(${14 * k}px) brightness(0)`; o.globalAlpha = .6; o.drawImage(T, 4 * k, 10 * k);
  const g = mk(T.width, T.height), gc = g.getContext('2d');
  gc.filter = `blur(${22 * k}px)`; gc.drawImage(T, 0, 0); gc.filter = 'none';
  gc.globalCompositeOperation = 'source-in'; gc.fillStyle = 'rgb(255,110,45)'; gc.fillRect(0, 0, g.width, g.height);
  o.filter = 'none'; o.globalAlpha = .42; o.drawImage(g, 0, 0);
  o.globalAlpha = 1; o.drawImage(T, 0, 0);
  return out;
}
const pad2 = (v, n) => String(Math.max(0, Math.min(10 ** n - 1, Math.round(v)))).padStart(n, '0');

// 確定の映像座標の板: 桁の行 / 連の行。値が変わった時だけ作り直す。
function rowPlate(draw, box, pad) {   // box: 確定の映像座標 {x,y,w,h}。板の左上 = (box.x - pad, box.y - pad)
  const plate = lit((c) => { c.translate(-box.x, -box.y); draw(c); }, box.w, box.h, pad);
  return { canvas: plate, ox: box.x - pad, oy: box.y - pad };
}
function buildTotal(parts, value) {
  const s = pad2(value, L.digit.n), box = { x: L.digit.x0 - 6, y: L.digit.cy - 135, w: L.digit.cell * L.digit.n + 12, h: 270 };
  return rowPlate((c) => { for (let j = 0; j < s.length; j++) { const im = parts.d[+s[j]]; c.drawImage(im, L.digit.x0 + j * L.digit.cell + L.digit.cell / 2 - im.width / 2, L.digit.cy - im.height / 2); } }, box, 70);
}
function buildChain(parts, chain) {
  const s = pad2(chain, 2), box = { x: 400, y: 380, w: 380, h: 190 };
  return rowPlate((c) => {
    c.drawImage(parts.ren, L.ren.cx - parts.ren.width / 2, L.ren.cy - parts.ren.height / 2); c.drawImage(parts.x, L.x.cx - parts.x.width / 2, L.x.cy - parts.x.height / 2);
    for (let i = 0; i < s.length; i++) { const im = parts.c[+s[i]]; c.drawImage(im, L.chain.x0 + i * L.chain.cell + L.chain.cell / 2 - im.width / 2, L.chain.cy - im.height / 2); }
  }, box, 70);
}

// ループ(176 コマ)の中での「その要素が映像に出ている度合い」と、映像の進み(コマ)。
// 先頭 14 コマは、末尾(162〜175)と頭(0〜13)の溶け合い。末尾は字が出きっているので、頭に向けて消える。
function clipPhase(tau) {
  if (tau < XF) return { f: LOOP - XF + tau, tail: 1 - (tau + 1) / (XF + 1) };
  return { f: tau, tail: 1 };
}

// ── 継続選択 ──────────────────────────────────────────────
// 窓の写像(v21_nodigit/mapping.json の su, 窓中心, 帯の上端)。確定の窓の確定映像座標(sx,sy) → 完成フレーム座標。
const CHOICE_MAP = {
  neutral: { su: 0.3742283950617284, cx: 252.0, y0: 463.1435185185185, top: 253.6, box: [58, 205, 446, 1006] },
  left: { su: 0.5237268518518519, cx: 351.5, y0: 424.77430555555554, top: 253.6, box: [80, 196, 623, 1052] },
  right: { su: 0.36747685185185186, cx: 252.5, y0: 647.7118055555555, top: 253.6, box: [62, 552, 443, 1023] },
};
export async function createChoiceTotal({ ctx, PX, PY, getValues, parts = null }) {
  parts ??= await loadTotalParts();
  const occ = {}, rect = {};
  for (const state of Object.keys(CHOICE_MAP)) {
    const m = CHOICE_MAP[state], fy = (sy) => m.y0 + (sy - m.top) * m.su;
    const x = Math.max(0, Math.floor(m.box[0] - 6)), y = Math.max(0, Math.floor(fy(360))), r = { x, y, w: Math.ceil(m.box[2] - m.box[0] + 12), h: Math.ceil(fy(960) - y) };
    rect[state] = r;
    // 手前の層(字・額縁・うぱ)の写し。白=手前で隠す。範囲だけ切り出して、アルファへ
    const im = await loadImage(new URL(`occluder_${state}.png`, NV21).href);
    const g = mk(r.w, r.h), gc = g.getContext('2d', { willReadFrequently: true }); gc.drawImage(im, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const px = gc.getImageData(0, 0, r.w, r.h), d = px.data;
    for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; }
    gc.putImageData(px, 0, 0); occ[state] = g;
  }
  const U = { x: Math.min(...Object.values(rect).map((r) => r.x)), y: Math.min(...Object.values(rect).map((r) => r.y)) };
  U.w = Math.max(...Object.values(rect).map((r) => r.x + r.w)) - U.x; U.h = Math.max(...Object.values(rect).map((r) => r.y + r.h)) - U.y;
  const saved = mk(U.w, U.h), sctx = saved.getContext('2d', { alpha: false });
  const ov = mk(U.w, U.h), octx = ov.getContext('2d');
  const overlayCanvas=mk(U.w,U.h),overlayCtx=overlayCanvas.getContext('2d');let overlayMode=false,overlayRevision=0;
  let savedValid = false, key = null, total = null, chain = null, last = { total: 0, chain: 1 };
  const refresh = () => {
    const v = getValues(); if (!v) return false;
    const k = v.total + ':' + v.chain; last = v;
    if (k !== key) { key = k; total = buildTotal(parts, v.total); chain = v.chain >= 2 ? buildChain(parts, v.chain) : null; }
    return true;
  };
  // 1 つの状態の分を ov に描き、手前の層で抜いて、アルファ付きで液晶へ
  const layer = (state, tau, alpha) => {
    const m = CHOICE_MAP[state], r = rect[state], { f, tail } = clipPhase(tau);
    octx.clearRect(0, 0, ov.width, ov.height);
    const place = (row, pivot, pop, a) => {
      if (!row || a <= 0) return;
      const s = m.su * pop, pfx = m.cx + (pivot.x - 576) * m.su - r.x + 0, pfy = m.y0 + (pivot.y - m.top) * m.su - r.y;
      octx.save(); octx.globalAlpha = Math.min(1, a); octx.translate(pfx, pfy); octx.scale(s, s); octx.translate(row.ox - pivot.x, row.oy - pivot.y);
      octx.imageSmoothingQuality = 'high'; octx.drawImage(row.canvas, 0, 0); octx.restore();
    };
    // 連: 84 コマから叩きつけ(2.4→1)。TOTAL: 96 コマから 1.5→1 で出る
    const tc = f - T_CH, a1 = Math.min(1, (tc + 1) / 2) * tail;
    if (tc >= 0 || tau < XF) place(chain, { x: 576, y: 470 }, tc >= 0 && tc < 6 ? SLAM_CHAIN[tc] : 1, a1);
    const tt = f - T_ROW2, u = tt / 5, a2 = Math.min(1, u * 3) * tail;
    if (tt >= 0 || tau < XF) place(total, { x: 576, y: 780 }, u < 1 ? 1.5 - 0.5 * ease(u) : 1, a2);
    octx.globalCompositeOperation = 'destination-out'; octx.drawImage(occ[state], 0, 0); octx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(ov, 0, 0, r.w, r.h, PX + r.x, PY + r.y, r.w, r.h); ctx.restore();
  };
  const visible = (tau) => { const { f } = clipPhase(tau); return tau < XF || f >= T_CH; };
  const api={
    invalidate() { savedValid = false; },     // 映像を描き直した(下の絵は元に戻った)
    clear() { if (savedValid) { ctx.drawImage(saved, PX + U.x, PY + U.y); savedValid = false; } },
    // state: 選んでいる状態、blend: {from,to,alpha}(from が null のときは直前の絵が残っている)
    draw(state, blend, tau) {
      if (!visible(tau) || !refresh()) return;
      if(!overlayMode){sctx.drawImage(ctx.canvas, PX + U.x, PY + U.y, U.w, U.h, 0, 0, U.w, U.h); savedValid = true;}
      if (blend) { if (blend.from) layer(blend.from, tau, 1 - blend.alpha); layer(state === blend.to ? blend.to : state, tau, blend.from ? blend.alpha : Math.max(.001, blend.alpha)); }
      else layer(state, tau, 1);
    },
    renderOverlay(state,blend,tau){
      const previous=ctx;overlayCtx.clearRect(0,0,U.w,U.h);overlayCtx.save();overlayCtx.translate(-PX-U.x,-PY-U.y);ctx=overlayCtx;overlayMode=true;
      try{api.draw(state,blend,tau);}finally{ctx=previous;overlayMode=false;overlayCtx.restore();savedValid=false;}
      return {canvas:overlayCanvas,x:PX+U.x,y:PY+U.y,width:U.w,height:U.h,revision:++overlayRevision};
    },
    get value() { return last; },
    get plateKey() { return key; },
  };return api;
}

// ── 時間切れ(左の札) ─────────────────────────────────────
// 札の内容座標(576×1188、桁は 5 桁・中心 y=560・字の大きさ 0.49)→ 完成フレームは build_production の M。
const TU = { M: [0.6753472, 58, 0.6753472, 204.84375], scale: 0.49, cy: 560, n: 5 };
export async function createTimeupTotal({ ctx, PX, PY, getValues, parts = null, base = new URL('./timeup_total_plates_20261029/', import.meta.url) }) {
  parts ??= await loadTotalParts();
  const meta = await (await fetch(new URL('plates.json', base))).json(), [rx, ry, rw, rh] = meta.rect;
  const plates = await Promise.all([...Array(meta.period).keys()].map((k) => loadImage(new URL(`plate_${String(k).padStart(2, '0')}.png`, base).href)));
  const s = TU.M[0] * TU.scale, cellF = 82 * TU.M[0];   // 完成フレームでの字の拡大と桁の送り
  let key = null, row = null, since = 0;
  const build = (value) => {   // 完成フレーム座標での板(桁だけ)。中心は札の内容座標 (98.5+82j, 560) を M で写した所
    const str = pad2(value, TU.n), bx = TU.M[1] + TU.M[0] * 98.5 - 50, by = TU.M[3] + TU.M[2] * TU.cy - 60, bw = cellF * (TU.n - 1) + 100, bh = 120, pad = 40;
    const plate = lit((c) => {
      for (let j = 0; j < str.length; j++) { const im = parts.d[+str[j]], cx = TU.M[1] + TU.M[0] * (98.5 + 82 * j) - bx; c.drawImage(im, cx - im.width * s / 2, bh / 2 - im.height * s / 2, im.width * s, im.height * s); }
    }, bw, bh, pad, s);
    return { canvas: plate, w: plate.width, h: plate.height, ox: bx - pad, oy: by - pad };
  };
  return {
    enter() { since = 0; },
    // idx: 映像に出ているコマの絶対番号。dt: 経過秒
    draw(idx, dt) {
      since += Math.max(0, dt);
      const v = getValues(); if (!v) return;
      const k = String(v.total); if (k !== key) { key = k; row = build(v.total); }
      const plate = plates[((Math.round(idx) % meta.period) + meta.period) % meta.period];
      ctx.drawImage(plate, PX + rx, PY + ry);    // 焼き込みの流れる桁を、桁のない板で隠す
      const t = since / .2, pop = t < 1 ? 1.35 - .35 * ease(t) : 1, a = Math.min(1, since / .15);
      const cx = row.ox + row.w / 2, cy = row.oy + row.h / 2;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(PX + cx, PY + cy); ctx.scale(pop, pop); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(row.canvas, -row.w / 2, -row.h / 2); ctx.restore();
    },
  };
}
