// 10/30 時間切れ〜追加の受付で「初めての人に、いま何が起きていて何をすればよいか」を文で伝える重ね描き。
// 戻す: ?timeuphelp=0（何も付けない＝従来）。規則・秒数・入力は変えない。液晶の字と指し示しだけを足す。
// 重ねる先: 追加の受付（Continue・timeup_surface が全面を描いている間）。スタッフ待ち／再開の字は staff_call_1030.mjs 側。
// 座標は timeup_surface と同じ 1152×1268（PX=34,PY=28）。良しとされた構図（左の札・右の砂時計・終わる／続ける）は動かさない。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
const W = 1152, PX = 34, PY = 28;

export function timeupHelpMode(search = globalThis.location?.search ?? '') { return new URLSearchParams(search).get('timeuphelp') === '0' ? 'old' : 'new'; }

const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const fontFor = sz => sz <= 52 ? `${sz}px "MPLUS1p-ExtraBold","Dela Gothic One","Noto Sans JP",sans-serif` : `${sz}px "Dela Gothic One","MPLUS1p-ExtraBold","Noto Sans JP",sans-serif`;   // 小さい字は縁に潰れにくい太ゴシック
export function textPath(ctx, text, x, y, size, { fill, silver = true, glow = null, align = 'center' }) {   // 激アツ風: 黒縁 + 白銀縁 + グラデ塗り + 上の照り
  ctx.save();
  ctx.font = fontFor(size);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * .25; }
  const small = size <= 52; ctx.lineWidth = size * (small ? .17 : .24); ctx.strokeStyle = '#08020f'; ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  if (silver && !small) { const g = ctx.createLinearGradient(0, y - size, 0, y); g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#aeb6d6'); g.addColorStop(1, '#f4f6ff'); ctx.lineWidth = size * .15; ctx.strokeStyle = g; ctx.strokeText(text, x, y); }
  const g = ctx.createLinearGradient(0, y - size * .85, 0, y + size * .05);
  for (const [o, c] of fill) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillText(text, x, y);
  ctx.globalCompositeOperation = 'lighter'; const hl = ctx.createLinearGradient(0, y - size * .85, 0, y - size * .35);
  hl.addColorStop(0, 'rgba(255,255,255,.5)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hl; ctx.fillText(text, x, y);
  ctx.restore();
}
export const GOLD = [[0, '#fff7c0'], [.35, '#ffd23a'], [.62, '#ff9a12'], [1, '#d4410a']];
export const WHITE = [[0, '#ffffff'], [.55, '#e8e0ff'], [1, '#a9a0d8']];
export const CYAN = [[0, '#f0ffff'], [.5, '#8fe8ff'], [1, '#3aa8e8']];

// 色の違う語を1行に並べる（地の文は白、大事な語だけ金）
export function richLine(ctx, parts, cx, y, size, maxWidth = 0, opt = {}) {
  const meas = sz => { ctx.save(); ctx.font = fontFor(sz); const w = parts.map(p => ctx.measureText(p[0]).width); ctx.restore(); return w; };
  let ws = meas(size), total = ws.reduce((a, b) => a + b, 0);
  if (maxWidth && total > maxWidth) { size = Math.floor(size * maxWidth / total); ws = meas(size); total = ws.reduce((a, b) => a + b, 0); }   // 枠からはみ出さない
  let x = cx - total / 2;
  parts.forEach((p, i) => { textPath(ctx, p[0], x, y, size, { fill: p[1] ?? WHITE, glow: p[2] ?? null, align: 'left', silver: opt.silver ?? true }); x += ws[i]; });
  return total;
}
function plate(ctx, x, y, w, h, r = 26, edge = 'rgba(255,205,90,.95)', a = .84) {
  const pg = ctx.createLinearGradient(0, y, 0, y + h); pg.addColorStop(0, `rgba(30,8,58,${a})`); pg.addColorStop(1, `rgba(70,14,78,${a})`);
  ctx.fillStyle = pg; ctx.strokeStyle = edge; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
}

// 今の状態から、追加の受付で見せる「続きから」の一文を決める（規則は読むだけ）
export function continueFacts(game) {
  const r = game.rules ?? {}, lamps = game.lampCount ?? 0, extra = r.ExtraSeconds ?? 20;
  const th = r.PrizeThresholds ?? [], names = r.PrizeNames ?? [], value = Math.max(0, Math.floor(game.prizeScore ?? game.wallet ?? 0));
  let rank = 0; for (let i = 0; i < th.length; i++) if (value >= th[i]) rank = i;
  const next = rank < th.length - 1 ? rank + 1 : null, need = next == null ? 0 : Math.max(0, th[next] - value);
  const chain = game.jackpotChain ?? null, pending = chain?.pendingAward ?? 0;
  let ctx;
  if (lamps >= 6 || chain) ctx = { kind: 'jp', lines: [[['JACKPOT CHANCE の', WHITE]], [['続きから！', GOLD]]], sub: pending > 0 ? `積み増し ${pending}玉 もそのまま` : '' };
  else if (lamps === 5) ctx = { kind: 'l5', lines: [[['5灯のまま 続きから！', WHITE]], [['あと1灯で', GOLD]], [['JACKPOT CHANCE！', GOLD]]] };
  else if (lamps >= 1) ctx = { kind: 'ln', lines: [[[`いま ${lamps}灯 のまま`, WHITE]], [[`${extra}秒で あと${6 - lamps}灯`, GOLD]], [['JACKPOT CHANCE！', GOLD]]] };
  else ctx = { kind: 'l0', lines: [[['いまの玉のまま', WHITE]], [[`${extra}秒 もう一勝負！`, GOLD]]] };
  return { lamps, extra, value, rankName: next == null ? null : names[next], need, top: next == null, ctx };
}

export async function attachTimeupHelp(lcd, { controller } = {}) {
  if (!lcd?.production || !lcd.timeupSurface || lcd.timeupHelp || timeupHelpMode() === 'old') return lcd;
  const ctx = lcd.canvas.getContext('2d'), g = () => controller.game, mainCtx = ctx;
  const st = { since: null, drawn: 0 };
  const base = { frame: lcd.frame.bind(lcd) };
  const revision = Object.getOwnPropertyDescriptor(lcd, 'uploadRevision')?.get;
  let drawing = false;

  function draw(now, ctx = mainCtx, only = 0, tFixed = null, tx = PX, ty = PY) {   // only: 0=全部 1=上の札 2=それ以外。tFixed: 時刻を固定(入りが終わった絵)。tx,ty: 原点(分割描画では小さい canvas の左上)
    const game = g(), f = continueFacts(game), t = tFixed ?? (now - st.since) / 1000, left = Math.ceil(game.offerLeft ?? 0);
    ctx.save(); ctx.translate(tx, ty);
    // 1) 上の札: いま何が起きているか（時間切れ）と、できること（100円で20秒）
    if (!only || only === 1) { const k = ease(t / .35); ctx.save(); ctx.globalAlpha = k; ctx.translate(0, (1 - k) * -40);
      plate(ctx, 60, 4, 1016, 126, 30);
      richLine(ctx, [['時間切れ！ ', WHITE, '#8a5cff'], [`100円で${f.extra}秒`, GOLD, '#ff9a20'], [' 追加できます', WHITE]], 540, 68, 60, 930);
      richLine(ctx, [['押さないと あと', WHITE], [`${left}秒`, GOLD], [' で おしまい', WHITE]], 540, 116, 46, 930);
      ctx.restore(); }
    // 2) 左の札の上: あと少しで届く賞（あと◯玉）を見せる。TOTAL の上に載せ、「いまの玉」と読ませる
    if (!only || only === 2) { const k = ease((t - .25) / .35); ctx.save(); ctx.globalAlpha = k; ctx.translate(0, (1 - k) * 30);
      plate(ctx, 78, 290, 366, 216, 26);
      textPath(ctx, 'いまの玉で賞が決まる', 261, 334, 34, { fill: WHITE, silver: false });
      if (f.top) { textPath(ctx, '最高賞！', 261, 410, 66, { fill: GOLD, glow: '#ffb030' }); textPath(ctx, 'すごい！', 261, 478, 52, { fill: GOLD }); }
      else { textPath(ctx, `${f.rankName}まで`, 261, 396, 52, { fill: WHITE, glow: '#8a5cff' }); textPath(ctx, `あと${f.need}玉！`, 261, 476, 74, { fill: GOLD, glow: '#ff9a20' }); }
      ctx.restore(); }
    // 3) 右の札の上: 100円で今の続きから（灯の数・あと1灯）
    if (!only || only === 2) { const k = ease((t - .5) / .35), c = f.ctx; ctx.save(); ctx.globalAlpha = k; ctx.translate((1 - k) * 40, 0);
      const h = 52 + c.lines.length * 44 + (c.sub ? 36 : 0); plate(ctx, 690, 232, 380, h, 24, 'rgba(255,220,120,.95)', .88);
      let y = 232 + 58; c.lines.forEach((ln, i) => { richLine(ctx, ln.map(p => [p[0], p[1]]), 880, y, i === 0 ? 36 : 40); y += 46; });
      if (c.sub) textPath(ctx, c.sub, 880, y - 2, 28, { fill: CYAN, silver: false });
      ctx.restore(); }
    // 4) 砂時計の数字の上: これが「100円で入る分」
    if (!only || only === 2) { const k = ease((t - .8) / .3); ctx.save(); ctx.globalAlpha = k; textPath(ctx, '100円で', 965, 430, 40, { fill: GOLD, glow: '#ff9a20' }); ctx.restore(); }
    // 5) ボタンの指し示し（絵は動かさず、ボタンの字のすぐ上に札で）
    if (!only || only === 2) { const k = ease((t - 1) / .3); ctx.save(); ctx.globalAlpha = k;
      plate(ctx, 60, 728, 404, 70, 20, 'rgba(200,210,255,.95)', .94); textPath(ctx, '左ボタンで 終わる', 262, 778, 46, { fill: WHITE, silver: false });
      plate(ctx, 566, 728, 480, 70, 20, 'rgba(255,205,90,.95)', .94); textPath(ctx, '右ボタンで 続ける', 806, 778, 48, { fill: GOLD, silver: false });
      ctx.restore(); }
    ctx.restore();
  }

  lcd.frame = (dt, F) => {
    base.frame(dt, F);
    const now = performance.now(), on = g().phase === 'Continue' && lcd.timeupSurface.active && (g().offerLeft ?? 0) > 0;
    if (!on) { st.since = null; drawing = false; sp.on = false; return; }
    if (st.since == null) st.since = now;
    if (SPLIT_ON && lcd.timeupSurface.splitActive && !sp.fail) {   // 継続の分割描画中: 液晶 canvas へは描かず、小さい層(字・板)を必要な時だけ描き直す
      try { buildSplit(); sp.on = true; drawing = false; if (!SPLIT_CHECK) return; } catch (e) { sp.fail = true; sp.on = false; console.warn('[timeuphelp] 分割描画を止めて従来へ戻します', e); }
    } else sp.on = false;
    drawing = true; st.drawn++; draw(now);
  };
  // ---- 分割描画 ----
  const SPLIT_ON = new URLSearchParams(globalThis.location?.search ?? '').get('timeupvideo') !== '0';
  const SPLIT_CHECK = new URLSearchParams(globalThis.location?.search ?? '').has('splitcheck');
  const sp = { on: false, fail: false, c1: null, c2: null, t1: null, t2: null, key1: null, key2: null };
  const R1 = [20, 0, 1100, 160], R2 = [20, 220, 1100, 620], T_SETTLED = 10;
  function buildSplit() {
    const game = g(), f = continueFacts(game), left = Math.ceil(game.offerLeft ?? 0), k2 = JSON.stringify([f.top, f.rankName, f.need, f.ctx, f.lamps, f.extra]);
    if (!sp.c1) { sp.c1 = document.createElement('canvas'); sp.c1.width = R1[2]; sp.c1.height = R1[3]; sp.c2 = document.createElement('canvas'); sp.c2.width = R2[2]; sp.c2.height = R2[3]; sp.t1 = layerTexture(THREE, sp.c1); sp.t2 = layerTexture(THREE, sp.c2); }
    if (sp.key1 !== left) { const x = sp.c1.getContext('2d'); x.clearRect(0, 0, R1[2], R1[3]); draw(0, x, 1, T_SETTLED, -R1[0], -R1[1]); sp.t1.needsUpdate = true; sp.key1 = left; }
    if (sp.key2 !== k2) { const x = sp.c2.getContext('2d'); x.clearRect(0, 0, R2[2], R2[3]); draw(0, x, 2, T_SETTLED, -R2[0], -R2[1]); sp.t2.needsUpdate = true; sp.key2 = k2; }
  }
  const splitLayers = () => (sp.on && !sp.fail ? [{ tex: sp.t1, w: R1[2], h: R1[3], ax: 0, ay: 0, x: PX + R1[0], y: PY + R1[1], rot: 0, sc: 1, alpha: 1, add: false }, { tex: sp.t2, w: R2[2], h: R2[3], ax: 0, ay: 0, x: PX + R2[0], y: PY + R2[1], rot: 0, sc: 1, alpha: 1, add: false }] : null);
  if (revision) Object.defineProperty(lcd, 'uploadRevision', { configurable: true, enumerable: true, get: () => drawing ? undefined : revision.call(lcd) });
  lcd.timeupHelp = { splitLayers, state: st, get drawing() { return drawing; }, continueFacts: () => continueFacts(g()) };
  return lcd;
}
