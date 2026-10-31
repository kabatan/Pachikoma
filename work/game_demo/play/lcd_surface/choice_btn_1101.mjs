// 11/01 継続/確定・追加の選択画面に「どちらのボタンを押すか」を示す試作（監督：継続/追加＝右ボタン、確定/やめる＝左ボタンを初見でも一目で）。
//   ?choicebtn=1（既定）…各札の中の上に、実物のボタンを模した丸い押しボタン（立体・色つき・PUSH）。押せる周期で沈み、輪が広がる。
//   ?choicebtn=2 …札の外の下の端に、手元のボタンの位置を指す大きな立体の矢印（左=白〜青、右=黄〜赤）と、ボタンの絵。
//   ?choicebtn=0 …出さない（従来）。無指定は案1。枠・構図・文言は変えない（札の外・中の空いた所に重ねるだけ）。説明の札（継続=…）は足さない。
// 色：左ボタン=白〜青、右ボタン=黄〜赤（btn_color_1101）。座標は液晶の 1152×1268（PX=34,PY=28）。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
import { btnPalette } from './btn_color_1101.mjs';

export const choiceBtnMode = (search = globalThis.location?.search ?? '') => { const v = new URLSearchParams(search).get('choicebtn'); return v === '0' ? 0 : v === '2' ? 2 : 1; };   // 11/01 監督決定：案1が既定。?choicebtn=0 で出さない、=2 で矢印（案2）
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, x) => a + (b - a) * x;
const rgb = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;
const FONT = '"Dela Gothic One","MPLUS1p-ExtraBold","Noto Sans JP",sans-serif';

// ---- 押せる周期：1.7 秒ごとに 0.18 秒で沈み、0.25 秒保ち、0.25 秒で戻る。沈んだ瞬間に輪が広がる ----
const PERIOD = 1.7;
export function pressPhase(t, side) {
  const u = ((t + (side ? 0 : 0)) % PERIOD + PERIOD) % PERIOD, A = 1.0, D = 0.18, H = 0.25, R = 0.25;
  const depth = u < A ? 0 : u < A + D ? (u - A) / D : u < A + D + H ? 1 : u < A + D + H + R ? 1 - (u - A - D - H) / R : 0;
  const ring = u >= A ? clamp((u - A) / 0.7) : 0;   // 沈んだ瞬間からの輪の広がり 0..1
  return { depth: depth * depth * (3 - 2 * depth), ring, glow: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 5.2)) };
}

// 11/01 ボタンの面：上下にはっきり塗り分ける（左=白/青、右=赤/黄。実機の色がどちらでも合う）。?btnsplit=0 で旧のグラデーション
const BTN_SPLIT = new URLSearchParams(globalThis.location?.search ?? '').get('btnsplit') !== '0', SPLIT_COL = [[[250, 252, 255], [28, 88, 232]], [[226, 30, 40], [255, 214, 36]]];
function domeFill(ctx, r, pal, side, k) {
  const g = ctx.createLinearGradient(0, -r, 0, r);
  if (BTN_SPLIT) { const [a, b] = SPLIT_COL[side ? 1 : 0]; g.addColorStop(0, rgb(a, k)); g.addColorStop(0.5, rgb(a, k)); g.addColorStop(0.5, rgb(b, k)); g.addColorStop(1, rgb(b, k)); }
  else { g.addColorStop(0, rgb(pal.top, k)); g.addColorStop(0.5, rgb(pal.mid, k)); g.addColorStop(1, rgb(pal.bot, k)); }
  return g;
}

// ---- 丸い押しボタン（実機の PUSH ボタン表示を手本）：金属の縁・影・ドーム・艶・字。d = ボタン面の直径 ----
export function drawPushButton(ctx, cx, cy, d, side, t, { alpha = 1, label = 'PUSH' } = {}) {
  const pal = btnPalette(side, true), ph = pressPhase(t, side), r = d / 2, dep = ph.depth;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy);
  // 押す瞬間に広がる光の輪（ぼかしのやわらかい輪）
  if (ph.ring > 0) {
    const k = ph.ring, a = (1 - k) ** 1.5 * 0.85, rr = r * (1.05 + 0.9 * k);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, rr * 0.7, 0, 0, rr * 1.12); g.addColorStop(0, `rgba(${pal.glow},0)`); g.addColorStop(0.55, `rgba(${pal.glow},${a})`); g.addColorStop(1, `rgba(${pal.glow},0)`);
    ctx.fillStyle = g; ctx.fillRect(-rr * 1.2, -rr * 1.2, rr * 2.4, rr * 2.4); ctx.restore();
  }
  // 常時のやわらかい発光（押せる合図）
  { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.7); g.addColorStop(0, `rgba(${pal.glow},${0.42 * ph.glow})`); g.addColorStop(1, `rgba(${pal.glow},0)`); ctx.fillStyle = g; ctx.fillRect(-r * 1.8, -r * 1.8, r * 3.6, r * 3.6); ctx.restore(); }
  // 床の影
  { const g = ctx.createRadialGradient(0, r * 0.42, r * 0.3, 0, r * 0.42, r * 1.3); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 1.3, r * 0.9, 0, 0, 7); ctx.fill(); }
  // 金属の縁（上が明るく下が暗い）＋内側の溝
  const bz = r * 1.2;
  let g = ctx.createLinearGradient(0, -bz, 0, bz); g.addColorStop(0, '#f4f7fc'); g.addColorStop(0.35, '#a9b2c4'); g.addColorStop(0.7, '#4a5164'); g.addColorStop(1, '#1d212c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, bz, 0, 7); ctx.fill();
  g = ctx.createLinearGradient(0, bz, 0, -bz); g.addColorStop(0, '#e9edf5'); g.addColorStop(0.5, '#59606f'); g.addColorStop(1, '#14171f'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, bz * 0.93, 0, 7); ctx.fill();
  ctx.fillStyle = '#06070b'; ctx.beginPath(); ctx.arc(0, bz * 0.03, bz * 0.86, 0, 7); ctx.fill();
  // ドーム：沈むと小さく下がり、暗くなる
  const sc = 1 - 0.07 * dep, dy = r * 0.1 * dep + r * 0.0, k = 1 - 0.24 * dep;
  ctx.save(); ctx.translate(0, dy); ctx.scale(sc, sc);
  ctx.fillStyle = domeFill(ctx, r, pal, side, k); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  const sh = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.3, 0, 0, r); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.6, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.62)');
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  // 面の字（PUSH）：彫り込み風（下に暗い影、上に明るい縁）
  if (label) {
    const fs = Math.round(d * (label.length > 3 ? 0.3 : 0.5)); ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const ty = r * 0.06, dk = side ? '#5a0608' : '#0a2466';
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(label, 0, ty + d * 0.035);
    ctx.lineWidth = d * 0.095; ctx.strokeStyle = dk; ctx.strokeText(label, 0, ty);
    const tg = ctx.createLinearGradient(0, ty - fs / 2, 0, ty + fs / 2); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, side ? '#ffe9b0' : '#d6e6ff'); ctx.fillStyle = tg; ctx.fillText(label, 0, ty);
  }
  // 艶（上の斜め楕円）と下の反射光
  ctx.fillStyle = `rgba(255,255,255,${0.62 - 0.3 * dep})`; ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.62, r * 0.36, r * 0.12, -0.5, 0, 7); ctx.fill();
  const rf = ctx.createRadialGradient(0, r * 0.95, r * 0.05, 0, r * 0.95, r * 0.7); rf.addColorStop(0, 'rgba(255,255,255,.16)'); rf.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = rf; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.restore();
  // 押した瞬間の白い閃光
  if (dep > 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${0.16 * dep})`; ctx.beginPath(); ctx.arc(0, dy, r * sc, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.restore();
}

// ---- 立体の大きな下向き矢印（案2）：縁・面・ふくらみ・艶。w = 幅。tip = 先端の y（中心から）。ふわふわ上下する ----
export function drawArrow(ctx, cx, cy, w, side, t, { alpha = 1, label = side ? '右' : '左', still = false } = {}) {   // still: 層用の静止した絵（上下・発光は行列で動かす）
  const pal = btnPalette(side, true), bob = still ? 0 : Math.sin(t * 6.2) * w * 0.045, ph = pressPhase(t, side), pulse = still ? 1 : 1 + 0.05 * ph.depth;
  const asp = 1.45, hw = w / 2, sw = w * 0.34, hh = w * 0.62 * asp, sh = w * 0.52 * asp;   // 半幅・軸の幅・頭の高さ・軸の高さ
  const path = (inset = 0) => { const a = inset; ctx.beginPath(); ctx.moveTo(-sw / 2 + a, -sh - hh / 2 + a); ctx.lineTo(sw / 2 - a, -sh - hh / 2 + a); ctx.lineTo(sw / 2 - a, -hh / 2 + a * 0.3); ctx.lineTo(hw - a * 1.6, -hh / 2 + a * 0.3); ctx.lineTo(0, hh / 2 + sh * 0.0 - a * 1.1 + hh * 0.0); ctx.lineTo(-hw + a * 1.6, -hh / 2 + a * 0.3); ctx.lineTo(-sw / 2 + a, -hh / 2 + a * 0.3); ctx.closePath(); };
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy + bob); ctx.scale(pulse, pulse); ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  // 発光
  if (!still) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g0 = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, w * 1.0); g0.addColorStop(0, `rgba(${pal.glow},${0.45 * ph.glow})`); g0.addColorStop(1, `rgba(${pal.glow},0)`); ctx.fillStyle = g0; ctx.fillRect(-w * 1.1, -w * 1.1, w * 2.2, w * 2.2); ctx.restore(); }
  // 影・黒縁・銀縁
  ctx.save(); ctx.translate(w * 0.03, w * 0.05); path(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill(); ctx.lineWidth = w * 0.13; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke(); ctx.restore();
  path(); ctx.lineWidth = w * 0.13; ctx.strokeStyle = '#0a0612'; ctx.stroke();
  let g = ctx.createLinearGradient(0, -sh - hh / 2, 0, hh / 2); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#aab3c8'); g.addColorStop(1, '#eef2fb'); path(); ctx.lineWidth = w * 0.085; ctx.strokeStyle = g; ctx.stroke();
  // 面（上=明るい→下=濃い）
  g = ctx.createLinearGradient(0, -sh - hh / 2, 0, hh / 2); g.addColorStop(0, rgb(pal.top)); g.addColorStop(0.5, rgb(pal.mid)); g.addColorStop(1, rgb(pal.bot)); path(); ctx.fillStyle = g; ctx.fill();
  // ふくらみ（縁に向かう影）と、内側の明暗の縁取り
  ctx.save(); path(); ctx.clip();
  const bv = ctx.createLinearGradient(-hw, 0, hw, 0); bv.addColorStop(0, 'rgba(0,0,0,.28)'); bv.addColorStop(0.3, 'rgba(255,255,255,.18)'); bv.addColorStop(0.7, 'rgba(255,255,255,0)'); bv.addColorStop(1, 'rgba(0,0,0,.34)');
  ctx.fillStyle = bv; ctx.fillRect(-hw, -sh - hh, w, sh + hh * 2);
  path(w * 0.05); ctx.lineWidth = w * 0.06; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
  const gl = ctx.createLinearGradient(0, -sh - hh / 2, 0, -sh * 0.2); gl.addColorStop(0, 'rgba(255,255,255,.75)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(-hw, -sh - hh / 2, w, sh * 0.8);
  ctx.restore();
  // 短い字（左／右）：頭の中
  if (label) { const fs = Math.round(w * 0.36); ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const ty = -hh * 0.12; ctx.lineWidth = fs * 0.2; ctx.strokeStyle = '#0a0612'; ctx.strokeText(label, 0, ty); const tg = ctx.createLinearGradient(0, ty - fs / 2, 0, ty + fs / 2); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, side ? '#ffe9a8' : '#d8e6ff'); ctx.fillStyle = tg; ctx.fillText(label, 0, ty); }
  ctx.restore();
}

// ---- 札の位置（液晶 1152×1268 の座標）：各状態の「札の中の上」。切り替え中は重みで補間する ----
//   実測：選択画面の 3 状態（v21）。cx,cy = ボタンの中心、d = 直径。
const CHOICE_IN = {   // 案1：札の中。11/01 選択画面の 2/3 を消したので、右の札は中央寄り（上の窓の中ほど）へ。左は「連×N／TOTAL」(y440〜)の上
  neutral: { L: { cx: 258, cy: 345, d: 172 }, R: { cx: 806, cy: 480, d: 230 } },
  left: { L: { cx: 352, cy: 370, d: 214 }, R: { cx: 900, cy: 700, d: 120 } },
  right: { L: { cx: 255, cy: 668, d: 116 }, R: { cx: 800, cy: 450, d: 262 } },
};
const CHOICE_OUT = {   // 案2：札の外・下の端（矢印の頭の中心、幅）。右は「8」の右の細い隙間
  neutral: { L: { cx: 172, cy: 1128, d: 92, by: 1212, bd: 92 }, R: { cx: 1112, cy: 1128, d: 70, by: 1214, bd: 70 } },
  left: { L: { cx: 172, cy: 1140, d: 92, by: 1218, bd: 92 }, R: { cx: 1112, cy: 1128, d: 70, by: 1214, bd: 70 } },
  right: { L: { cx: 172, cy: 1128, d: 92, by: 1212, bd: 92 }, R: { cx: 1112, cy: 1128, d: 70, by: 1214, bd: 70 } },
};
const TIMEUP_IN = { L: { cx: 247, cy: 290, d: 144 }, R: { cx: 811, cy: 290, d: 144 } };   // 11/01 左右とも札の上辺から同じ高さ・札の左右中央・同じ大きさに
//   // 追加：左の札は TOTAL(y510〜)の上、右は砂時計の上の空き。文字・札に重ならない範囲で大きく
const TIMEUP_OUT = { L: { cx: 172, cy: 1040, d: 90 }, R: { cx: 1106, cy: 1200, d: 78 } };

const mixPos = (a, b, k) => ({ ...b, cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), d: lerp(a.d, b.d, k), by: b.by == null ? undefined : lerp(a.by ?? b.by, b.by, k) });
export function choiceLayout(mode, sel, tr) {
  const T = mode === 2 ? CHOICE_OUT : CHOICE_IN, s = T[sel] ?? T.neutral;
  let L = s.L, R = s.R;
  if (tr?.from && T[tr.from]) { const a = T[tr.from], k = clamp(tr.alpha ?? 1); L = mixPos(a.L, s.L, k); R = mixPos(a.R, s.R, k); }
  return { L, R };
}
export const timeupLayout = (mode) => mode === 2 ? TIMEUP_OUT : TIMEUP_IN;

// 1 組（左・右）を描く。mode 1 = ボタンの絵、mode 2 = 矢印（＋小さなボタン）。a = 全体の不透明度（出現のはずみ付き）
export function drawPair(ctx, mode, lay, t, a = 1, pop = 1) {
  for (const [side, p] of [[0, lay.L], [1, lay.R]]) {
    if (mode === 2) {
      ctx.save(); ctx.translate(p.cx, p.cy); ctx.scale(pop, pop); ctx.translate(-p.cx, -p.cy);
      drawArrow(ctx, p.cx, p.cy, p.d, side, t, { alpha: a }); if (p.by) drawPushButton(ctx, p.cx, p.by, p.bd * 0.8, side, t, { alpha: a, label: '' });
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(p.cx, p.cy); ctx.scale(pop, pop); ctx.translate(-p.cx, -p.cy);
      drawPushButton(ctx, p.cx, p.cy, p.d, side, t, { alpha: a });
      ctx.restore();
    }
  }
}

// ---- 小さな層（GPU 経路）：絵は起動時に一度だけ作って一度だけ送り、動き（沈み・輪・発光・ふわふわ・出現）は行列と不透明度だけで出す ----
// 層の順は下から：発光 → 輪 → 縁（影・金属の縁・溝）→ ドーム（面・PUSH・艶）。1 つのボタンで 4 層、矢印は 発光 → 矢印 → 縁 → ドーム。左右で 8 層（SPLIT_N=12）。
const REF = 200;   // 層の絵を作る基準の直径。実際の大きさは sc = d / REF
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function buildParts(side, withLabel) {
  const pal = btnPalette(side, true), r = REF / 2, out = {};
  { const S = 340, c = mk(S, S), x = c.getContext('2d'); x.translate(S / 2, S / 2); const g = x.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.65); g.addColorStop(0, `rgba(${pal.glow},1)`); g.addColorStop(1, `rgba(${pal.glow},0)`); x.fillStyle = g; x.fillRect(-S / 2, -S / 2, S, S); out.glow = c; }
  { const S = 460, c = mk(S, S), x = c.getContext('2d'); x.translate(S / 2, S / 2); const rr = r * 1.0, g = x.createRadialGradient(0, 0, rr * 0.7, 0, 0, rr * 1.12); g.addColorStop(0, `rgba(${pal.glow},0)`); g.addColorStop(0.55, `rgba(${pal.glow},1)`); g.addColorStop(1, `rgba(${pal.glow},0)`); x.fillStyle = g; x.fillRect(-S / 2, -S / 2, S, S); out.ring = c; }
  { const S = 300, c = mk(S, S), x = c.getContext('2d'); x.translate(S / 2, S / 2 - 10);
    const sh = x.createRadialGradient(0, r * 0.42, r * 0.3, 0, r * 0.42, r * 1.3); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = sh; x.beginPath(); x.ellipse(0, r * 0.45, r * 1.3, r * 0.9, 0, 0, 7); x.fill();
    const bz = r * 1.2; let g = x.createLinearGradient(0, -bz, 0, bz); g.addColorStop(0, '#f4f7fc'); g.addColorStop(0.35, '#a9b2c4'); g.addColorStop(0.7, '#4a5164'); g.addColorStop(1, '#1d212c'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, bz, 0, 7); x.fill();
    g = x.createLinearGradient(0, bz, 0, -bz); g.addColorStop(0, '#e9edf5'); g.addColorStop(0.5, '#59606f'); g.addColorStop(1, '#14171f'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, bz * 0.93, 0, 7); x.fill(); x.fillStyle = '#06070b'; x.beginPath(); x.arc(0, bz * 0.03, bz * 0.86, 0, 7); x.fill(); out.base = c; out.baseOY = 10; }
  { const S = 230, c = mk(S, S), x = c.getContext('2d'); x.translate(S / 2, S / 2); drawDomeFace(x, REF, side, withLabel ? 'PUSH' : ''); out.dome = c; }
  { const w = 120, W = 240, H = 300, c = mk(W, H), x = c.getContext('2d'); drawArrow(x, W / 2, 170, w, side, 0, { still: true }); out.arrow = c; out.arrowAx = [W / 2, 170]; }
  { const S = 300, c = mk(S, S), x = c.getContext('2d'); x.translate(S / 2, S / 2); const g = x.createRadialGradient(0, 0, 120 * 0.2, 0, 0, 120 * 1.0); g.addColorStop(0, `rgba(${pal.glow},1)`); g.addColorStop(1, `rgba(${pal.glow},0)`); x.fillStyle = g; x.fillRect(-S / 2, -S / 2, S, S); out.aglow = c; }
  return out;
}
// ドームの面（drawPushButton と同じ絵。沈みなし）
function drawDomeFace(ctx, d, side, label) {
  const pal = btnPalette(side, true), r = d / 2;
  ctx.fillStyle = domeFill(ctx, r, pal, side, 1); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  const sh = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.3, 0, 0, r); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.6, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.62)'); ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  if (label) {
    const fs = Math.round(d * (label.length > 3 ? 0.3 : 0.5)); ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const ty = r * 0.06, dk = side ? '#5a0608' : '#0a2466';
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(label, 0, ty + d * 0.035); ctx.lineWidth = d * 0.095; ctx.strokeStyle = dk; ctx.strokeText(label, 0, ty);
    const tg = ctx.createLinearGradient(0, ty - fs / 2, 0, ty + fs / 2); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, side ? '#ffe9b0' : '#d6e6ff'); ctx.fillStyle = tg; ctx.fillText(label, 0, ty);
  }
  ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.62, r * 0.36, r * 0.12, -0.5, 0, 7); ctx.fill();
  const rf = ctx.createRadialGradient(0, r * 0.95, r * 0.05, 0, r * 0.95, r * 0.7); rf.addColorStop(0, 'rgba(255,255,255,.16)'); rf.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = rf; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
}

const W = 1152, H = 1268, PX = 34, PY = 28;
const easeIn3 = (u) => 1 - (1 - clamp(u)) ** 3;
// 1 組（左右）の層を作る。lay = {L,R}（面の座標）、t = 出てからの秒、a = 全体の不透明度、pop = 出現の拡大
function pairLayers(parts, tex, mode, lay, t, a, pop, withBtn) {
  const out = [];
  for (const side of [0, 1]) {
    const p = side ? lay.R : lay.L, P = parts[side], T = tex[side], ph = pressPhase(t, side), x = PX + p.cx, y = PY + p.cy;
    if (mode === 2) {
      const sc = p.d / 120 * pop, bob = Math.sin((t + side * 0.35) * 6.2) * p.d * 0.045, pulse = 1 + 0.05 * ph.depth;
      out.push({ tex: T.aglow, w: 300, h: 300, ax: 150, ay: 150, x, y: y + bob, rot: 0, sc: p.d / 120 * pop * 1.0, alpha: 0.45 * ph.glow * a, add: true });
      out.push({ tex: T.arrow, w: 240, h: 300, ax: P.arrowAx[0], ay: P.arrowAx[1], x, y: y + bob, rot: 0, sc: sc * pulse, alpha: a, add: false });
      if (withBtn && p.by) {
        const bs = p.bd * 0.8 / REF * pop, by = PY + p.by, dep = ph.depth;
        out.push({ tex: T.base, w: 300, h: 300, ax: 150, ay: 150 - P.baseOY, x, y: by, rot: 0, sc: bs, alpha: a, add: false });
        out.push({ tex: T.domeNoLabel, w: 230, h: 230, ax: 115, ay: 115, x, y: by + REF * 0.5 * 0.1 * dep * bs, rot: 0, sc: bs * (1 - 0.07 * dep), alpha: a, add: false });
      }
    } else {
      const sc = p.d / REF * pop, dep = ph.depth, r = REF / 2;
      out.push({ tex: T.glow, w: 340, h: 340, ax: 170, ay: 170, x, y, rot: 0, sc, alpha: 0.42 * ph.glow * a, add: true });
      if (ph.ring > 0) { const k = ph.ring; out.push({ tex: T.ring, w: 460, h: 460, ax: 230, ay: 230, x, y, rot: 0, sc: sc * (1.05 + 0.9 * k), alpha: (1 - k) ** 1.5 * 0.85 * a, add: true }); }
      out.push({ tex: T.base, w: 300, h: 300, ax: 150, ay: 150 - P.baseOY, x, y, rot: 0, sc, alpha: a, add: false });
      out.push({ tex: T.dome, w: 230, h: 230, ax: 115, ay: 115, x, y: y + r * 0.1 * dep * sc, rot: 0, sc: sc * (1 - 0.07 * dep), alpha: a, add: false });
    }
  }
  return out;
}

// ---- 液晶への取り付け ----
// 選択（ChainChoice）・追加（Continue）とも、GPU 経路では小さな層だけを渡す（lcd.jpHud.splitLayers／追加は splitSources）。全面の canvas は作らない・送らない。
// 2D 経路（GPU 合成でないとき）だけ、液晶 canvas に直接描く（従来の方法）。
export async function attachChoiceBtn(lcd, { controller } = {}) {
  const mode = choiceBtnMode();
  if (!mode || !lcd?.production || lcd.choiceBtn) return lcd;
  const g = () => controller.game, base = { frame: lcd.frame.bind(lcd) };
  const parts = [buildParts(0, true), buildParts(1, true)], partsNL = [buildParts(0, false), buildParts(1, false)];
  const tex = [0, 1].map((i) => ({ glow: layerTexture(THREE, parts[i].glow), ring: layerTexture(THREE, parts[i].ring), base: layerTexture(THREE, parts[i].base), dome: layerTexture(THREE, parts[i].dome), domeNoLabel: layerTexture(THREE, partsNL[i].dome), arrow: layerTexture(THREE, parts[i].arrow), aglow: layerTexture(THREE, parts[i].aglow) }));
  let since = null, drawn = 0, where = null, cur = null, layerSeen = 0;
  const popOf = (t) => { const u = clamp((t - 0.35) / 0.35); return u < 1 ? 1 + 0.84 * (1 - u) ** 3 * 0.35 : 1; };
  const alphaOf = (t) => clamp((t - 0.3) / 0.25);
  const hasLayerHost = () => typeof lcd.jpHud?.splitLayers === 'function';
  lcd.frame = (dt, F) => {
    base.frame(dt, F);
    const game = g(), cv = lcd.choiceV20, inChoice = game.phase === 'ChainChoice' && (game.choiceLeft ?? 0) > 0 && !!cv?.active, inAdd = game.phase === 'Continue' && !!lcd.timeupSurface?.active && (game.offerLeft ?? 0) > 0;
    if (!inChoice && !inAdd) { since = null; where = null; cur = null; return; }
    const now = performance.now(); if (since == null) since = now; const t = (now - since) / 1000, a = alphaOf(t), pop = popOf(t); if (a <= 0) { cur = null; return; }
    const gpuLayers = inChoice ? (!!lcd.gpuPanelSource?.backend && hasLayerHost()) : !!lcd.timeupSurface.splitActive;
    where = inChoice ? 'choice' : 'add'; const lay = inChoice ? choiceLayout(mode, cv.selected ?? 'neutral', cv.transition) : timeupLayout(mode);
    if (gpuLayers) { cur = { t, a, pop, lay, withBtn: inChoice }; drawn++; return; }
    cur = null; const c = lcd.canvas.getContext('2d'); c.save(); c.translate(PX, PY); drawPair(c, mode, lay, t, a, pop); c.restore(); drawn++;
  };
  const myLayers = (room) => {
    if (!cur) return null;
    if (where === 'choice' && lcd.chainWhy?.state?.bigOn) return null;   // 11/01 継続の大きな字（choice_why_1101）が出ている間は重ならないよう引っ込める
    let L = pairLayers(parts, tex, mode, cur.lay, cur.t, cur.a, cur.pop, cur.withBtn);
    if (L.length > room) L = L.filter((l) => !l.add).slice(0, room);   // 層が足りないときは発光・輪を落とす
    layerSeen = L.length; return L.length ? L : null;
  };
  // 選択：jp_count と同じ。lcd.jpHud.splitLayers に足す（play_fx が GPU の映像の上へ小さな層として重ねる）
  if (hasLayerHost()) { const o = lcd.jpHud.splitLayers.bind(lcd.jpHud); lcd.jpHud.splitLayers = () => { const a = o(); if (where !== 'choice') return a; const b = myLayers(12 - (a?.length ?? 0) - 1); return a && b ? [...a, ...b] : (a ?? b); }; }
  // 追加：先に返す層（timeup_surface など）の後ろへ足す（play_fx は最初に null でない源だけを使うので、既存の源を包む）
  lcd.splitSources = (lcd.splitSources ?? []).map((f) => () => { const a = f(); if (!a || where !== 'add') return a; const b = myLayers(12 - a.length - 1); return b ? [...a, ...b] : a; });
  lcd.choiceBtn = { mode, get drawn() { return drawn; }, get where() { return where; }, get layers() { return layerSeen; }, get layerHost() { return hasLayerHost(); } };
  return lcd;
}
