// 仮カードの本番差し替え（2026-10-29）。スタート／まだまだ／計数中／重複／耐えた。
// 背景は通常のryugu1028動画（normal_surface側が描く）。ここは題字・光・数字だけを重ねる。
// 題字は jp_teacher/08_chain の字の部品（極太明朝×虹×白銀縁＋黒縁）で焼いたPNG。AI画像・立体うぱ・くっきりした図形は使わない。
// 光はにじむ円形グラデーション（スプライト）のみ。ライセンスが要る外部素材は無し。
import {withRestored2D} from './startup_warm.mjs';
const DIR = new URL('./temp_cards_20261029/', import.meta.url);
const CX = 576;
const ease = k => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
const back = k => { k = Math.min(1, Math.max(0, k)); const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
const clamp01 = v => Math.min(1, Math.max(0, v));

// 10/31 新スタート(軽い版・50コマ=1.67秒)。?startfx=0 で旧版(1.9秒)に戻す。
export const NEW_START = typeof location === 'undefined' || new URLSearchParams(location.search).get('startfx') !== '0';
export const CARD_DURATIONS = { ticket: NEW_START ? 50 / 30 : 1.9, add100: 1.8, reset_fallback: 1.6, guard: 1.1, timeup_call: 1.4 };

export async function createTempCards({warmContext = null} = {}) {
  const load = n => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('temp card asset ' + n)); i.src = new URL(n, DIR).href; });
  const names = ['start_main', 'start_sub', 'count_main', 'count_jp', 'more_main', 'more_sub', 'guard_main', 'guard_sub', 'dup_main', 'dup_sub', 'timeup_main', 'ballout_main'];
  const P = {}; await Promise.all(names.map(async n => { P[n] = await load(n + '.png'); }));
  const atlas = await load('digits_gold.png');
  // 新スタート用の素材（題字＋影／光の帯のマスク／副題／数字の面と太い黒縁）。build_ticket_assets.py で焼いたもの。
  let V4 = null; const N4 = {};
  if (NEW_START) {
    V4 = await (await fetch(new URL('ticket_v4.json', DIR))).json();
    await Promise.all([['title', 'start_main_v4'], ['face', 'start_main_face'], ['sub', 'start_sub_v4'], ['numf', 'num_face'], ['numo', 'num_ol']].map(async ([k, n]) => { N4[k] = await load(n + '.png'); }));
  }
  const receipt = await (await fetch(new URL('plates_receipt.json', DIR))).json();
  const meta = receipt.digits.meta, cell = receipt.digits.cell;
  // やわらかい光のスプライト（金・白・水）
  const sprite = (r, g, b) => { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); const gr = x.createRadialGradient(48, 48, 0, 48, 48, 48); gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(.25, `rgba(${r},${g},${b},.45)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); x.fillStyle = gr; x.fillRect(0, 0, 96, 96); return c; };
  const S = { gold: sprite(255, 214, 120), white: sprite(255, 255, 245), aqua: sprite(170, 235, 255), dusk: sprite(120, 90, 160) };
  const scratch = document.createElement('canvas'); scratch.width = 1152; scratch.height = 700; const sx = scratch.getContext('2d');

  const glow = (ctx, x, y, r, sp, a) => { if (a <= 0) return; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(S[sp], x - r, y - r, r * 2, r * 2); ctx.restore(); };
  const sparkles = (ctx, t, n, y0, rise, spread, a, sp = 'white', seed = 1) => {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const h = Math.sin((i + 1) * 91.7 + seed * 13.1) * 43758.5453, f = h - Math.floor(h), h2 = Math.sin((i + 3) * 47.3 + seed) * 2754.1, f2 = h2 - Math.floor(h2);
      const ph = (t * (.35 + .4 * f2) + f2 * 3 + i / n) % 1, x = CX + (f - .5) * 2 * spread + Math.sin(t * 2 + i) * 14, y = y0 - ph * rise;
      const r = 14 + 26 * f2, al = Math.sin(Math.PI * ph) * a * (.5 + .5 * Math.sin(t * 7 + i * 2));
      ctx.globalAlpha = Math.max(0, al); ctx.drawImage(S[sp], x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  };
  // 題字。pop: 弾んで出る。sheen: 光の帯が文字の上だけを走る。
  const telop = (ctx, img, cx, cy, w, { t = 1, pop = true, alpha = 1, dx = 0, dy = 0, sheen = -1 } = {}) => {
    const k = pop ? (.62 + .38 * back(t / .22)) : 1, ww = w * k, hh = ww * img.height / img.width;
    const a = alpha * clamp01(t / .1);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    if (sheen >= 0 && sheen <= 1) {
      sx.clearRect(0, 0, 1152, 700); const x0 = 0, y0 = 0, bw = Math.ceil(ww), bh = Math.ceil(hh);
      sx.globalCompositeOperation = 'source-over'; sx.drawImage(img, x0, y0, ww, hh);
      sx.globalCompositeOperation = 'source-atop';
      const bx = -bw * .3 + (bw * 1.6) * sheen, gr = sx.createLinearGradient(bx - bw * .12, 0, bx + bw * .12, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sx.fillStyle = gr; sx.fillRect(0, 0, bw, bh); sx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0, bw, bh, cx + dx - ww / 2, cy + dy - hh / 2, ww, hh);
    } else ctx.drawImage(img, cx + dx - ww / 2, cy + dy - hh / 2, ww, hh);
    ctx.restore();
  };
  // 金の数字。str は 0-9＋玉秒。高さ h、中心 (cx,cy)、最大幅 maxW に収める。
  const number = (ctx, str, cx, cy, h, { alpha = 1, maxW = 1000, scale = 1 } = {}) => {
    const chars = [...str], unit = h / cell[1], adv = c => (meta[c].adv * .94) * unit;
    let w = chars.reduce((s, c) => s + adv(c), 0), fit = Math.min(1, maxW / w) * scale;
    w *= fit; let x = cx - w / 2; ctx.save(); ctx.globalAlpha = alpha;
    for (const c of chars) { const m = meta[c], aw = adv(c) * fit, dw = cell[0] * unit * fit, dh = cell[1] * unit * fit; ctx.drawImage(atlas, m.x, 0, m.w, cell[1], x + aw / 2 - dw / 2, cy - dh / 2, dw, dh); x += aw; }
    ctx.restore();
  };
  const env = (t, dur, out = .25) => clamp01(Math.min(t / .08, (dur - t) / out));

    // ---------------------------------------------------------------- 新スタート（v4）：旧版の字を土台に、速い入り・着地の小さな弾み・光の帯・「玉」の数上がり・副題。1.67秒。
  const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  const eOut = (u, pw) => 1 - (1 - clamp01(u)) ** pw;
  const plate4 = (ctx, img, core, cx, cy, w, { s = 1, rot = 0, a = 1 } = {}) => {
    const k = w / core[0], dw = img.width * k, dh = img.height * k;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); if (rot) ctx.rotate(rot * Math.PI / 180); if (s !== 1) ctx.scale(s, s);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
  };
  const sheen4 = (ctx, img, core, cx, cy, w, sh, { s = 1, rot = 0, a = 1 } = {}) => {   // 光の帯：面の上だけ
    if (sh < 0 || sh > 1) return;
    const k = w / core[0], dw = Math.ceil(img.width * k), dh = Math.ceil(img.height * k);
    sx.clearRect(0, 0, 1152, 700); sx.globalCompositeOperation = 'source-over'; sx.drawImage(img, 0, 0, dw, dh);
    sx.globalCompositeOperation = 'source-in';
    const bx = -dw * .25 + dw * 1.5 * sh, gr = sx.createLinearGradient(bx - dw * .08, 0, bx + dw * .08, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    sx.fillStyle = gr; sx.fillRect(0, 0, dw, dh); sx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); if (rot) ctx.rotate(rot * Math.PI / 180); if (s !== 1) ctx.scale(s, s);
    ctx.drawImage(scratch, 0, 0, dw, dh, -dw / 2, -dh / 2, dw, dh); ctx.restore();
  };
  const numRow4 = (ctx, str, cx, cy, h, maxW, { s = 1, a = 1 } = {}) => {
    const d = V4.digits, chars = [...str], unit = h / d.orig[1], adv = c => d.meta[c].adv * .94 * unit;
    let w = chars.reduce((q, c) => q + adv(c), 0); const fit = Math.min(1, maxW / w); w *= fit;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); if (s !== 1) ctx.scale(s, s);
    for (const img of [N4.numo, N4.numf]) {           // 太い黒縁を先に全部、面を後に（隣の字の縁が面にかぶらない）
      let x = -w / 2;
      for (const c of chars) { const m = d.meta[c], aw = adv(c) * fit, dw = d.cell[0] * unit * fit, dh = d.cell[1] * unit * fit; ctx.drawImage(img, m.x, 0, m.w, d.cell[1], x + aw / 2 - dw / 2, -dh / 2, dw, dh); x += aw; }
    }
    ctx.restore();
  };
  const ticketNew = (ctx, p, t, s) => {
    const balls = p.balls ?? s.rules?.LoanBalls ?? 18, f = t * 30;
    const outK = sstep(43, 49.5, f), aOut = 1 - sstep(47.2, 49.4, f), lift = -14 * outK, scOut = 1 + .04 * outK;
    // 泡のしぶき（控えめ）：着地の少し前に中心から広がり、あとは薄い泡が上がる
    const sp = sstep(1, 4, f) * (1 - sstep(8, 18, f));
    if (sp > .01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const h = Math.sin((i + 1) * 91.7 + 3.1) * 43758.5453, r1 = h - Math.floor(h), h2 = Math.sin((i + 3) * 47.3 + 1) * 2754.1, r2 = h2 - Math.floor(h2);
        const ang = -Math.PI / 2 + (r1 - .5) * 3.0, sp_ = 260 + 420 * r2, tt = Math.max(0, t - .03), x = CX + Math.cos(ang) * sp_ * tt * .9, y = 500 + Math.sin(ang) * sp_ * tt - 60 * tt, rad = 9 + 20 * r2;
        ctx.globalAlpha = Math.min(1, sp * .55); ctx.drawImage(S.aqua, x - rad, y - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    if (f >= 6) sparkles(ctx, t, 8, 880, 600, 430, .5 * sstep(6, 12, f) * aOut, 'aqua', 6);
    // 題字
    if (f >= 2) {
      let sc, rot = 0;
      if (f < 6) { const u = (f - 2) / 4; sc = .93 + .6 * (1 - eOut(u, 2)); rot = -3 * (1 - eOut(u, 2)); }
      else { const d = f - 6; sc = 1 - .07 * Math.exp(-d / 3) * Math.cos(.85 * d); }
      const o = { s: sc * scOut, rot, a: aOut };
      plate4(ctx, N4.title, V4.title, CX, 470 + lift, 920, o);
      sheen4(ctx, N4.face, V4.title, CX, 470 + lift, 920, (f - 10) / 14, o);
    }
    // 「60玉」（LoanBalls）：弾んで出て、数が上がる
    if (f >= 9) {
      const u = (f - 9) / 5, shown = Math.round(balls * Math.min(1, (f - 9) / 12));
      const sc = u < 1 ? .7 + .3 * back(u) : 1 + .035 * Math.exp(-(f - 14) / 3) * Math.sin(1.1 * (f - 14));
      numRow4(ctx, `${shown}玉`, CX, 690 + lift, 200, 780, { s: sc * scOut, a: aOut });
    }
    // 副題（読める大きさ・太い黒縁）
    if (f >= 16) plate4(ctx, N4.sub, V4.sub, CX, 870 + lift + 22 * (1 - eOut((f - 16) / 6, 3)), 960, { s: scOut, a: aOut });
    // 着地の輪と火花、玉の出の小さな閃き
    const dl = f - 6;
    if (dl >= 0 && dl < 9) {
      const u = dl / 8, R = (.10 + .55 * (1 - (1 - Math.min(u, 1)) ** 2.2)) * 1268 * .9, w = (.012 + .03 * u) * 1268, al = .5 * (1 - Math.min(u, 1)) ** 1.5;   // 10/31 検証: dl が 8〜9 のとき u>1 で負の累乗→NaN→addColorStop が例外→液晶が復旧モードに落ち以後の映像が全部消える
      const gr = ctx.createRadialGradient(CX, 470, Math.max(0, R - w), CX, 470, R + w);
      gr.addColorStop(0, 'rgba(200,240,255,0)'); gr.addColorStop(.5, `rgba(210,245,255,${al})`); gr.addColorStop(1, 'rgba(200,240,255,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(0, 0, 1152, 1268); ctx.restore();
    }
    if (f >= 6 && f < 24) {
      const tt = (f - 6) / 30; ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const h = Math.sin((i + 1) * 12.9898 + 4.7) * 43758.5453, r1 = h - Math.floor(h), h2 = Math.sin((i + 5) * 78.233) * 2754.1, r2 = h2 - Math.floor(h2);
        const ang = r1 * Math.PI * 2, dist = (80 + 380 * r2) * (1 - Math.exp(-tt * 5)), life = 1 - tt / .6; if (life <= 0) continue;
        const rad = 8 + 12 * r2; ctx.globalAlpha = Math.min(1, life * .8); ctx.drawImage(S.gold, CX + Math.cos(ang) * dist - rad, 470 + Math.sin(ang) * dist * .7 - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    const dn = f - 14; if (dn >= 0 && dn < 8) glow(ctx, CX, 690 + lift, 150 * (.7 + .5 * dn / 8), 'gold', .55 * (1 - dn / 8) * aOut);
    return true;
  };

  const scenes = {
    ticket(ctx, p, t, s) { return NEW_START ? ticketNew(ctx, p, t, s) : scenes.ticketOld(ctx, p, t, s); },
    ticketOld(ctx, p, t, s) {
      const dur = CARD_DURATIONS.ticket, e = env(t, dur), balls = p.balls ?? s.rules?.LoanBalls ?? 18;
      glow(ctx, CX, 560, 620, 'gold', .5 * e * (.8 + .2 * Math.sin(t * 6)));
      glow(ctx, CX, 520, 360, 'white', .35 * e * Math.max(0, 1 - t * 1.6));   // 出た瞬間の閃き
      telop(ctx, P.start_main, CX, 470, 900, { t, alpha: e, sheen: (t - .35) / .8 });
      const k = ease((t - .3) / .75); number(ctx, `${Math.round(balls * k)}玉`, CX, 690, 190, { alpha: e * clamp01((t - .2) / .15), maxW: 700 });
      telop(ctx, P.start_sub, CX, 860, 880, { t: t - .5, pop: false, alpha: e, dy: 18 * (1 - ease((t - .5) / .3)) });
      sparkles(ctx, t, 14, 800, 520, 470, .8 * e, 'gold', 2);
    },
    add100(ctx, p, t, s) {
      const dur = CARD_DURATIONS.add100, e = env(t, dur);
      const g = ctx.createLinearGradient(0, 1268, 0, 700); g.addColorStop(0, `rgba(255,190,90,${.38 * e})`); g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 700, 1152, 568); ctx.restore();
      glow(ctx, CX, 540, 560, 'gold', .42 * e);
      telop(ctx, P.more_main, CX, 500, 900, { t, alpha: e, dy: -16 * ease(t / .5), sheen: (t - .3) / .7 });
      number(ctx, `＋${p.seconds ?? s.rules?.extraSeconds ?? 0}秒`, CX, 710, 180, { alpha: e * clamp01((t - .22) / .15), maxW: 620, scale: .9 + .1 * back((t - .22) / .25) });
      telop(ctx, P.more_sub, CX, 905, 780, { t: t - .45, pop: false, alpha: e, dy: 16 * (1 - ease((t - .45) / .3)) });
      sparkles(ctx, t, 16, 1000, 760, 480, .85 * e, 'gold', 5);
    },
    // 時間切れ(0秒)・玉切れの瞬間の一言。追加画面の前の猶予(EndGraceSeconds)の間だけ出す(10/30 D6)
    timeup_call(ctx, p, t, s) {
      const dur = Math.max(.6, p.duration ?? CARD_DURATIONS.timeup_call), e = env(t, dur, .25);
      if (e <= 0) return true;
      glow(ctx, CX, 560, 700, p.reasonCode === 'balls' ? 'aqua' : 'gold', .55 * e * (.85 + .15 * Math.sin(t * 9)));
      glow(ctx, CX, 560, 380, 'white', .4 * e * Math.max(0, 1 - t * 2.2));
      telop(ctx, p.reasonCode === 'balls' ? P.ballout_main : P.timeup_main, CX, 560, 940, { t, pop: true, alpha: e, dx: 12 * Math.exp(-t * 9) * Math.sin(t * 50), sheen: (t - .15) / .6 });
      sparkles(ctx, t, 14, 800, 480, 440, .8 * e, 'white', 4);
    },
    finish_count(ctx, p, t, s) {
      const total = p.total ?? p.balls ?? s.balls ?? 0, score = p.score ?? s.score ?? 0, e = clamp01(t / .3);
      const k = clamp01(t / 1.6), rise = clamp01(t / 7);                  // 時間とともに期待を溜める
      glow(ctx, CX, 640, 620 + 120 * rise, 'gold', (.28 + .3 * rise) * e * (.85 + .15 * Math.sin(t * 3.2)));
      glow(ctx, CX, 640, 880, 'aqua', .14 * e);
      telop(ctx, P.count_main, CX, 450, 700, { t, pop: true, alpha: 1, dy: 6 * Math.sin(t * 2.4), sheen: ((t * (.45 + .25 * rise)) % 1.6) / 1.4 });
      // 大きな数字は筐体右上の7セグ(s.shownBalls)を超えない。払い出しが終わるまで7セグと同じ値で上がり、最後は同じ値で止まる。
      const live = Number.isFinite(s.shownBalls) ? Math.min(total, s.shownBalls) : total;
      const shown = Math.min(Math.round(total * ease(k)), live), rolling = k < 1 || live < total;
      number(ctx, `${shown}玉`, CX, 700, 230, { alpha: e, maxW: 980, scale: rolling ? 1 : 1 + .03 * Math.max(0, Math.sin(t * 5)) });
      if (!rolling) glow(ctx, CX, 640, 440, 'white', .16 * (.5 + .5 * Math.sin(t * 5)));
      // 持ち玉で賞が決まる規則(basis='wallet')では、大きい数字がそのまま賞の数字。「JPの合計」の行は出さない(字と数字の食い違い、10/30 D1)
      if (p.basis !== 'wallet' && s.rules?.PrizeBasis !== 'wallet') {
        telop(ctx, P.count_jp, CX - 170, 900, 440, { t: t - .5, pop: false, alpha: e });
        number(ctx, `${Math.round(score * ease(clamp01((t - .5) / 1.2)))}玉`, CX + 190, 900, 110, { alpha: e * clamp01((t - .5) / .2), maxW: 420 });
      }
      sparkles(ctx, t, 10 + Math.round(12 * rise), 1020, 700, 480, (.45 + .5 * rise) * e, 'white', 7);
    },
    reset_fallback(ctx, p, t, s) {
      const dur = CARD_DURATIONS.reset_fallback, e = env(t, dur, .3);
      const g = ctx.createRadialGradient(CX, 600, 160, CX, 600, 860); g.addColorStop(0, 'rgba(50,30,80,0)'); g.addColorStop(1, `rgba(40,24,70,${.42 * e})`);
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, 1152, 1268); ctx.restore();
      glow(ctx, CX, 520, 360, 'dusk', .35 * e);
      telop(ctx, P.dup_main, CX, 500, 520, { t, alpha: e, dx: 14 * Math.exp(-t * 7) * Math.sin(t * 44), sheen: (t - .3) / .7 });
      telop(ctx, P.dup_sub, CX, 720, 620, { t: t - .3, pop: false, alpha: e, dy: 12 * (1 - ease((t - .3) / .3)) });
    },
  };

  // Factory-only: no card/model/event clock exists yet. Keep no extra resource.
  if (warmContext) {
    try {
      for (const image of [P.start_main, P.start_sub, P.count_main, P.count_jp, atlas, ...Object.values(N4)]) await image.decode?.();
      await withRestored2D(warmContext, async () => {
        sx.save();
        try {
          const samples = [
            {id: 'ticket', times: [.05, .8, 1.25], params: {balls: 18}, state: {rules: {LoanBalls: 18}}},
            {id: 'finish_count', times: [1 / 60, .75, 1.8], params: {total: 38, score: 70}, state: {balls: 38, score: 70}},
          ];
          for (const sample of samples) for (const t of sample.times) {
            warmContext.save();
            try { warmContext.translate(34, 28); scenes[sample.id](warmContext, sample.params, t, sample.state); }
            finally { warmContext.restore(); }
            // Materialize before another sample/restore can discard queued draws.
            const painted = await createImageBitmap(warmContext.canvas, 34, 28, 1152, 1268,
              {premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
            painted.close();
          }
        } finally {
          sx.restore(); sx.clearRect(0, 0, scratch.width, scratch.height);
        }
      });
    } catch (error) { console.warn('[temp-cards] startup warm', error.message); }
  }

  return {
    ttl: (id, p) => CARD_DURATIONS[id],
    draw(ctx, id, p, t, s) { const f = scenes[id]; if (!f) return false; f(ctx, p, t, s); return true; },
    guard(ctx, t) {
      const dur = CARD_DURATIONS.guard, e = env(t, dur, .3); if (e <= 0) return true;
      glow(ctx, CX, 1030, 420, 'gold', .34 * e);
      telop(ctx, P.guard_main, CX, 990, 620, { t, alpha: e, dy: -20 * ease(t / dur), sheen: (t - .2) / .5 });   // 10/30 C8：字が小さくゲージ・泡と重なる→大きく
      telop(ctx, P.guard_sub, CX, 1130, 1040, { t: t - .15, pop: false, alpha: e, dy: -20 * ease(t / dur) });   // 10/30 A1: 「耐えた！」だけでは意味が伝わらないので「セーフ！／同じ穴でも消えない」
      return true;
    },
    assets: { plates: P, atlas }, scenes,
  };
}

export async function attachTempCards(lcd) {
  if (!lcd?.production || lcd.tempCards || !lcd.setCards) return lcd;
  const cards = await createTempCards({warmContext: lcd.canvas.getContext('2d')}); lcd.setCards(cards); lcd.tempCards = cards; return lcd;
}
