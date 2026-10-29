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

export const CARD_DURATIONS = { ticket: 1.9, add100: 1.8, reset_fallback: 1.6, guard: 1.1, timeup_call: 1.4 };

export async function createTempCards({warmContext = null} = {}) {
  const load = n => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('temp card asset ' + n)); i.src = new URL(n, DIR).href; });
  const names = ['start_main', 'start_sub', 'count_main', 'count_jp', 'more_main', 'more_sub', 'guard_main', 'guard_sub', 'dup_main', 'dup_sub', 'timeup_main', 'ballout_main'];
  const P = {}; await Promise.all(names.map(async n => { P[n] = await load(n + '.png'); }));
  const atlas = await load('digits_gold.png');
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

  const scenes = {
    ticket(ctx, p, t, s) {
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
      for (const image of [P.start_main, P.start_sub, P.count_main, P.count_jp, atlas]) await image.decode?.();
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
      glow(ctx, CX, 1000, 260, 'gold', .28 * e);
      telop(ctx, P.guard_main, CX, 975, 400, { t, alpha: e, dy: -20 * ease(t / dur), sheen: (t - .2) / .5 });
      telop(ctx, P.guard_sub, CX, 1085, 760, { t: t - .15, pop: false, alpha: e, dy: -20 * ease(t / dur) });   // 10/30 A1: 「耐えた！」だけでは意味が伝わらないので「セーフ！／同じ穴でも消えない」
      return true;
    },
    assets: { plates: P, atlas }, scenes,
  };
}

export async function attachTempCards(lcd) {
  if (!lcd?.production || lcd.tempCards || !lcd.setCards) return lcd;
  const cards = await createTempCards({warmContext: lcd.canvas.getContext('2d')}); lcd.setCards(cards); lcd.tempCards = cards; return lcd;
}
