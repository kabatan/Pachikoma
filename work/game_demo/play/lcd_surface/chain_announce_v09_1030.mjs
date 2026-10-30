// 継続告知 v09（10/30 監督承認）の本番。JP・継続成功の配当の映像が終わったところから、告知の映像（1152×1268・30fps、焼いた映像）を流す。
//   1回目（JP直後・ChainFirstAuto）: chain_announce_first（「JackPot 継続終了」、選択なしで継続のチャレンジへ）
//   2回目以降: chain_announce_repeat（「継続で得た配当 ○○玉 没収」→ 選択画面）。○○ は映像に焼かず、ここで実行時に重ねる。
// 失う玉数 = 規則の chainAnnounce の atRisk（= 告知の時点の jackpotChain.pendingAward。継続の失敗でこの額が没収され、最初のJPの配当は残る）。
// 映像は jp1029/manifest_confirm1029.json の場面（pinned: 起動時に専用スロットへ読み込み・復号）。再生は jp の場面と同じ経路（normal_surface の JP 映像の経路）。
// 告知の秒数は規則（ChainAnnounceSecondsFirst / ChainAnnounceSeconds）。映像は白飛びのあと白を保つ（規則の告知が終われば次の場面へ）。
// ?chainannounce=old で旧（仮カード・2.5秒）。rules_h_20261029.mjs の attachRulesH から呼ぶ。
const W = 1152, H = 1268;
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
// make_video_v07.slam：2.4倍→0.92（0.12秒）→揺れて1.0
const slam = (q, t0, s0 = 2.4, dur = .12, settle = .22) => {
  if (q < t0) return null; const x = (q - t0) / dur;
  if (x < 1) return s0 + (.92 - s0) * x * x;
  const y = (q - t0 - dur) / settle; return 1 - .08 * Math.exp(-4.2 * y) * Math.cos(6.5 * y);
};
export const ANNOUNCE_SCENES = { first: 'chain_announce_first', repeat: 'chain_announce_repeat' };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
// 字（RGBA）から、影・板・外光・白・衝撃光の部品を作る（make_video_v07.paste_spr と同じ式。ぼかしは等倍 S=1 の値）
function effectSet(sprite, fx, glowSigma) {
  const M = 110, w = sprite.width + 2 * M, h = sprite.height + 2 * M;
  const blurred = (sigma, dy = 0) => { const c = canvas(w, h), x = c.getContext('2d'); x.filter = `blur(${sigma}px)`; x.drawImage(sprite, M, M + dy); x.filter = 'none'; return c; };
  const tint = (c, rgb) => { const x = c.getContext('2d'); x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${rgb.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over'; return c; };
  const shadow = tint(blurred(fx.shadow_sigma, fx.shadow_dy), [0, 0, 0]);
  // 板：clip(blur(a)*2.2) の黒
  const pb = tint(blurred(fx.plate_sigma), [0, 0, 0]), plate = canvas(w, h), px = plate.getContext('2d');
  px.globalCompositeOperation = 'lighter'; for (let g = fx.plate_gain; g > 0; g -= 1) { px.globalAlpha = Math.min(1, g); px.drawImage(pb, 0, 0); } px.globalAlpha = 1; px.globalCompositeOperation = 'source-over';
  const glow = tint(blurred(glowSigma), fx.glow_col), ring = tint(blurred(fx.ring_sigma), fx.ring_col);
  const white = canvas(w, h), wx = white.getContext('2d'); wx.drawImage(sprite, M, M); tint(white, [1, 1, 1]);
  const body = canvas(w, h); body.getContext('2d').drawImage(sprite, M, M);
  return { M, w, h, shadow, plate, glow, ring, white, body };
}
// 加算（強さが 1 を超える分は重ねて描く）
function addDraw(ctx, c, x, y, strength) { if (!(strength > 0)) return; ctx.globalCompositeOperation = 'lighter'; for (let s = strength; s > 1e-3; s -= 1) { ctx.globalAlpha = Math.min(1, s); ctx.drawImage(c, x, y); } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }

export async function createAnnounceNumber(baseUrl) {
  const u = (p) => new URL(p, baseUrl).href;
  const [meta, atlas, tamaImg] = await Promise.all([fetch(u('digits.json')).then((r) => r.json()), img(u('digits.png')), img(u('tama.png'))]);
  const fx = meta.fx, [cw, chh] = meta.cell, NL = meta.layers, fA = meta.f_atlas;
  const tamaFx = effectSet(tamaImg, fx, fx.glow_sigma_tama);
  const cache = new Map();
  // 数字の字（still_v07.label('num', N, 128, 'silver', lx=28, cy=465, maxw=270) と同じ置き場・大きさ）
  function build(value) {
    const str = String(Math.max(0, Math.round(value)));
    if (cache.has(str)) return cache.get(str);
    const ds = [...str].map((c) => meta.digits[c]);
    const t0 = Math.min(...ds.map((d) => d.ink_ss[0])), b0 = Math.max(...ds.map((d) => d.ink_ss[1]));
    const sS = meta.height / (b0 - t0), r = sS / fA;
    let pen = 0; const pos = ds.map((d) => { const X = pen + d.bb0_ss * sS - (d.pad + meta.margin_ss * fA) * r, Y = (meta.top_ss - t0) * sS - d.pad * r; pen += d.adv_ss * (1 + meta.track) * sS; return [X, Y]; });
    const x0 = Math.min(...pos.map(([X]) => X)), wAll = Math.max(...pos.map(([X], i) => X + ds[i].w * r)) - x0, hAll = chh * r + 2;
    const c = canvas(wAll + 2, hAll), x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    // 押し出し → 外縁 → … → 字面 の順に、全部の字を重ねる（字の間で縁がつながる）
    for (let j = 0; j < NL; j++) ds.forEach((d, i) => x.drawImage(atlas, d.cell[0], j * chh, cw, chh, pos[i][0] - x0 + 1, pos[i][1] + 1, cw * r, chh * r));
    // alpha>.5 の箱（各字の箱の和）
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    ds.forEach((d, i) => { const X = pos[i][0] - x0 + 1, Y = pos[i][1] + 1; bx0 = Math.min(bx0, X + d.bbox[0] * r); by0 = Math.min(by0, Y + d.bbox[1] * r); bx1 = Math.max(bx1, X + d.bbox[2] * r); by1 = Math.max(by1, Y + d.bbox[3] * r); });
    const bw = bx1 - bx0, k = Math.min(1, meta.place.num.maxw / bw);   // 幅が maxw を超えたら横だけ縮める（label と同じ）
    let spr = c;
    if (k < 1) { spr = canvas(c.width * k, c.height); const sx = spr.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(c, 0, 0, spr.width, spr.height); }
    const box = { x0: bx0 * k, y0: by0, x1: bx1 * k, y1: by1 };
    const P = meta.place, left = P.num.lx, cx = left + (box.x1 - box.x0) / 2, cy = P.num.cy;
    const num = { fx: effectSet(spr, fx, fx.glow_sigma_num), cx, cy, ox: left - box.x0, oy: cy - (box.y0 + box.y1) / 2 };
    // 玉：数字の右端 − 6 から
    const tb = meta.tama.bbox, tl = left + (box.x1 - box.x0) + P.tama.dx, tcx = tl + (tb[2] - tb[0]) / 2, tcy = P.tama.cy;
    const tama = { fx: tamaFx, cx: tcx, cy: tcy, ox: tl - tb[0], oy: tcy - (tb[1] + tb[3]) / 2 };
    const out = { str, num, tama };
    cache.clear(); cache.set(str, out);
    return out;
  }
  // 没収の字は数字より後に着地して数字の上に重なる（v07 の paste の順）。数字の層はこの字の形で抜く（没収は映像のほう）
  const BM = meta.boshu_mask, boshu = BM ? await img(u('boshu_mask.png')) : null;
  const RX = 0, RY = 250, RW = 700, RH = 560;                 // 数字・玉とその影の範囲（見える範囲の座標）
  const ov = canvas(RW, RH), ox = ov.getContext('2d');
  const params = (s, q, t0, TXT) => {
    const kk = slam(q, t0); if (kk === null) return null;
    const k = kk * (1 + .04 * TXT.white), al = sm((q - t0) / .06) * TXT.alpha; if (al <= 0) return null;
    const wh = q > t0 + .12 ? Math.exp(-(q - t0 - .12) * 9) : (q - t0) / .12, white = Math.max(wh * .9, TXT.white);
    return { s, k, al, white, dt: q - t0, X: s.ox - s.fx.M - s.cx, Y: s.oy - s.fx.M - s.cy };
  };
  const at = (c, P, dx = 0, dy = 0) => { c.save(); c.translate(P.s.cx - dx, P.s.cy - dy); c.scale(P.k, P.k); };
  const masked = (ctx, list, paint, q, TXT, op = 'source-over') => {
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.globalAlpha = 1; ox.globalCompositeOperation = 'source-over'; ox.clearRect(0, 0, RW, RH);
    for (const P of list) { at(ox, P, RX, RY); paint(ox, P); ox.restore(); }
    const B = boshu ? params({ cx: BM.cx, cy: BM.cy, ox: 0, oy: 0, fx: { M: 0 } }, q, BM.t0, TXT) : null;
    if (B) { ox.save(); ox.globalCompositeOperation = 'destination-out'; ox.globalAlpha = B.al; ox.translate(BM.cx - RX, BM.cy - RY); ox.scale(B.k, B.k); ox.drawImage(boshu, BM.x0 - BM.cx, BM.y0 - BM.cy); ox.restore(); }
    ctx.globalCompositeOperation = op; ctx.drawImage(ov, RX, RY); ctx.globalCompositeOperation = 'source-over';
  };
  // 数字と玉を q（秒、make_video_v07.choice の q）で描く。TXT=終わりの光って消える溜め。順は paste_spr と同じ（影・板 → 外光 → 字 → 白 → 衝撃光）
  function draw(ctx, n, q, tNum, tTama, TXT) {
    const list = [params(n.num, q, tNum, TXT), params(n.tama, q, tTama, TXT)].filter(Boolean); if (!list.length) return;
    masked(ctx, list, (c, P) => { c.globalAlpha = fx.shadow_k * P.al; c.drawImage(P.s.fx.shadow, P.X, P.Y); c.globalAlpha = fx.plate_k * P.al; c.drawImage(P.s.fx.plate, P.X, P.Y); c.globalAlpha = 1; }, q, TXT);
    masked(ctx, list, (c, P) => addDraw(c, P.s.fx.glow, P.X, P.Y, fx.glow_k * 1.25 * (1 + 2.5 * P.white) * P.al), q, TXT, 'lighter');   // 加算。1.25 ≒ 明るさの圧縮(post)の暗部の傾き
    masked(ctx, list, (c, P) => { c.globalAlpha = P.al; c.drawImage(P.s.fx.body, P.X, P.Y); if (P.white > 0) { c.globalAlpha = P.al * Math.min(1, P.white); c.drawImage(P.s.fx.white, P.X, P.Y); } c.globalAlpha = 1; }, q, TXT);
    const rl = list.filter((P) => P.dt < .35); if (rl.length) masked(ctx, rl, (c, P) => addDraw(c, P.s.fx.ring, P.X, P.Y, fx.ring_k * 1.2 * Math.exp(-P.dt * 8) * P.al), q, TXT, 'lighter');
  }
  return { build, draw, meta };
}

export async function attachChainAnnounceV09(lcd, { controller, log = () => {} } = {}) {
  const jp = lcd?.jp; if (!lcd?.production || !jp || lcd.chainAnnounceV09) return lcd;
  const man = jp.man, model = jp.model;
  if (!man.scenes[ANNOUNCE_SCENES.first] || !man.scenes[ANNOUNCE_SCENES.repeat]) { console.warn('[chain-announce-v09] scenes missing'); return lcd; }
  const base = new URL('./chain_announce_v09/', import.meta.url);
  const metaOf = {};
  for (const k of ['first', 'repeat']) metaOf[k] = await (await fetch(new URL(`announce_${k}_1152.json`, base))).json();
  const number = await createAnnounceNumber(base);
  const S = { pending: null, shown: null, key: null, starts: 0, overlays: 0, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +(performance.now() / 1000).toFixed(3), ...d }); if (S.events.length > 100) S.events.shift(); log(k, d); };
  const rulesH = () => lcd.rulesH?.state;
  // 10/31 告知の「もう流した」印は試合をまたいで残るので、試合（MedalGame）ごとの番号を鍵に入れる。
  //   以前は _chainSerial（試合ごとに 1 から）だけで、前の客と同じ鍵「1:0」の初回JPでは告知の映像が出ず（継続の説明が飛ばされる）、規則の告知の数えも止まったまま固まった。
  const gameIds = new WeakMap(); let gameSeq = 0;
  const gameId = (g) => { if (!g || typeof g !== 'object') return 0; if (!gameIds.has(g)) gameIds.set(g, ++gameSeq); return gameIds.get(g); };
  const isAnnounce = (n = model.name) => n === ANNOUNCE_SCENES.first || n === ANNOUNCE_SCENES.repeat;
  // 規則の告知（chainAnnounce）。数字の字はここで作っておく（場面の頭で作らない）
  const off = controller.onAction((action) => {
    if (action !== 'chainAnnounce') return;
    const e = controller.lastGameEvent ?? {}, first = !!e.first || !(e.atRisk > 0);
    S.pending = { first, atRisk: first ? 0 : Math.round(e.atRisk), stage: e.stage ?? null, key: `${gameId(controller.game)}:${controller.game?._chainSerial ?? 0}:${e.stage ?? 0}` };
    if (!first) number.build(S.pending.atRisk);
    note('chainAnnounce', S.pending);
  });
  const start = (why) => {
    const p = S.pending; if (!p || S.key === p.key || !controller.game?.chainAnnouncing) return false;
    S.key = p.key; S.shown = p; S.pending = null; S.starts++;
    model.payout = 0; model.pending = null; model.delay = 0; model.dim = false; model.flashAt = -Infinity; model.result = null;
    model.start(p.first ? ANNOUNCE_SCENES.first : ANNOUNCE_SCENES.repeat);
    const st = rulesH(); if (st) st.announceOn = true;   // 規則の告知の秒数はここから数える（chain_connect）
    note('start', { why, first: p.first, atRisk: p.atRisk });
    return true;
  };
  // 配当・継続成功の映像が終わった瞬間に、間を空けず告知へ（通常の画面を 1 コマも挟まない）
  const stop0 = model.stop.bind(model);
  model.stop = (reason) => {
    const was = model.name, r = stop0(reason);
    if (/^(reward_|chain_success|chain_jp_land_)/.test(was ?? '')) note('stop', { was, reason: reason ?? 'end', pending: !!S.pending, phase: controller.game?.phase });
    if (/^(reward_|chain_success|chain_jp_land_)/.test(was ?? '') && S.pending) start('after:' + was + ':' + (reason ?? 'end'));   // 10/31 終わり方を問わない（watchdog・video_error で切れても告知へ。以前は 'end' だけで、切れると告知が出ず規則の告知の数えも止まったまま固まった）
    return r;
  };
  // 旧の「継続できるよ」案内（chain_offer、rules_h が紫の暗幕＋2/3 を重ねる）は v09 では出さない：告知があれば告知へ、無ければ止める
  const start0 = model.start.bind(model);
  model.start = (name) => {
    // v09 では旧の案内（紫の暗幕・2/3・白い閃光）を一切出さない（10/30 監督 NG「チャンス中に背景を染めない」）
    if (name === 'chain_offer') { note('skip-offer', { pending: !!S.pending }); if (S.pending && start('offer')) return; stop0('v09-no-offer'); return; }
    return start0(name);
  };
  // 場面の出来事：rules_h が液晶の空いたときに渡す chain_announce、告知が終わったときの chain_choice / chain_continue
  const on0 = model.onEvent.bind(model);
  model.onEvent = (id, p = {}) => {
    if (id === 'chain_announce') {
      if (isAnnounce() && model.active) return true;                     // もう流れている
      if (!S.pending && S.key) return true;                               // この告知は流し終えた（仮カードを出さない）
      if (model.active && model.payout > 0) return true;                  // 配当の途中（終わった瞬間に model.stop から入る）。仮カードは出さない
      if (model.active) stop0('chain-announce');
      start('event'); return true;                                        // 仮の四角いパネル（旧の仮カード）は v09 では出さない
    }
    if (isAnnounce() && model.active && ['chain_choice', 'chain_continue', 'chain_stop', 'fail', 'timeup', 'finish_count', 'result', 'ticket', 'attract', 'challenge_cancel', 'challenge_wait', 'lamp6'].includes(id)) {
      stop0('announce-' + id); note('end', { id });
      if (id === 'chain_choice') return false;                             // 通常の面 → 選択画面
    }
    return on0(id, p);
  };
  // 数字を重ねる（JP 映像の経路で、映像のコマを描いた直後に呼ばれる。ctx は見える範囲 1152×1268 の座標）
  const dd0 = jp.drawDigits.bind(jp);
  jp.drawDigits = (ctx) => {
    dd0(ctx);
    const w = jp.where(); if (!w || w.name !== ANNOUNCE_SCENES.repeat || !S.shown || S.shown.first) return;
    const m = metaOf.repeat, f = w.f;
    if (f < m.choice_from || f >= m.fade.start + m.fade.frames) return;
    const TXT = { white: 0, alpha: 1 };
    if (f >= m.fade.start) { const x = (f - m.fade.start + 1) / m.fade.frames; TXT.white = .9 * Math.min(1, x * 1.6); TXT.alpha = 1 - sm((x - .45) / .55); }
    const q = f / m.fps - m.T0, n = number.build(S.shown.atRisk);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    number.draw(ctx, n, q, m.num.num, m.num.tama, TXT);
    ctx.restore(); S.overlays++;
  };
  // 告知の時間が終わったら、映像の最後の白いコマを残さない（最初の告知は選択画面が無く次の場面まで白が居残っていた。10/30 検査B）
  const up0 = model.update.bind(model);
  model.update = (...a) => {
    const r = up0(...a);
    if (model.active && isAnnounce() && !controller.game?.chainAnnouncing) { stop0('announce-over'); note('end', { id: 'over', phase: controller.game?.phase }); }
    return r;
  };
  // 数字を重ねるコマの間だけ、映像の GPU 直行経路（重ね描きできない）を断って 2D 経路（drawDigits を呼ぶ）へ回す
  const pv0 = jp.plainVideoSnapshot?.bind(jp);
  const overlayNow = () => { const w = jp.where(); if (!w || w.name !== ANNOUNCE_SCENES.repeat || !S.shown || S.shown.first) return false; const m = metaOf.repeat; return !!m && w.f >= m.choice_from - 1 && w.f < m.fade.start + m.fade.frames; };
  if (pv0) jp.plainVideoSnapshot = (v) => overlayNow() ? null : pv0(v);
  // 10/31 保険：告知の待ちが続いたとき（映像の読み込み遅れ・途中で切れた等）に、いま告知を出す。出せなければ規則の数えだけ進める（固まらない）
  const force = (why) => {
    if (!controller.game?.chainAnnouncing) return false;
    if (isAnnounce() && model.active) return true;
    if (!S.pending && !S.key) return false;
    if (model.active && !isAnnounce()) stop0('announce-force');
    if (S.pending && start('force:' + why)) return true;
    const st = rulesH(); if (st) st.announceOn = true; note('force-count', { why });
    return false;
  };
  lcd.chainAnnounceV09 = { state: S, number, metaOf, force, dispose() { off?.(); model.start = start0; model.stop = stop0; model.onEvent = on0; jp.drawDigits = dd0; if (pv0) jp.plainVideoSnapshot = pv0; } };
  return lcd;
}
