// 10/30 慎重すぎる客への「ワンポイントアドバイス」：開始20秒前後で「ゆっくり慎重に押している」客を見分け、ゲームを2.5〜3秒だけ中断して、
// うぱ（ドット絵 upa_pixel の全身・整数倍・最近傍）が「連打がおすすめだよ！」と字で助言する。声はなし。
// 誤検知（連打している客を止める）を最優先で避ける：押下の「数」（直近12秒）と「間隔の中央値」の両方がゆっくりのときだけ出す。1プレイ1回。
//
//   const h = createCarefulHint({ game, sprites, cfg })   // hint_h_20261029.mjs の createMashHint と同じ口（press/draw/reset/state.active）
//   h.press(now)            // 通常時の 'fire' のたび（受け付けられない押下も）
//   h.draw(ctx, dt, ns, now)// 毎フレーム。ns = { normal, elapsed }（通常時の経過秒）。出す瞬間に game.beginAdvice() で時計と発射を止める
//   h.reset()
// 見た目は drawAdvice(ctx, t, A)（t は 0〜SECONDS の純関数）。規則側の中断時間 game.adviceStatus.t に同期する（時計を止めた秒は持ち時間から引かない）。
// 避ける枠（液晶 1152x1268）：上端 y52〜122・右下の残り時間は使わない。
import { telop } from './hint_h_20261029.mjs';

export const SECONDS = 3.0;
export const CAREFUL = {
  atSeconds: 20,        // 通常時が始まってからこの秒数で判定（約20秒）
  graceSeconds: 8,      // 撃てない場面（飛行中・Effect）にいる間、この秒数まで撃てるのを待つ。過ぎたら出さない
  windowSeconds: 12,    // 見る範囲（直近）
  maxPresses: 12,       // この範囲の押下がこれ以下（≒1秒に1回以下）
  minMedianGap: 0.85,   // 押下間隔（末尾の「押していない時間」を含む）の中央値がこれ以上
  recentSeconds: 5, recentMax: 5,   // 直近5秒の押下は5回以下（いま連打しているなら出さない）
  // 重複（ランプが消えた）のあとで間隔が伸びた客は、基準を少し緩める
  dupMaxPresses: 16, dupMinMedianGap: 0.7, dupSlowRatio: 1.5, dupSlowAbs: 0.9,
  seconds: SECONDS,
};
const median = (a) => { if (!a.length) return Infinity; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
const gapsOf = (p) => { const g = []; for (let i = 1; i < p.length; i++) g.push(p[i] - p[i - 1]); return g; };
/** 判定。presses = 押下の時刻（秒・昇順）、dupAts = ランプが消えた（重複）時刻 */
export function analyze(presses, now, dupAts = [], cfg = CAREFUL) {
  const w = presses.filter((t) => t > now - cfg.windowSeconds && t <= now);
  const n12 = w.length, n5 = presses.filter((t) => t > now - cfg.recentSeconds && t <= now).length;
  const last = w.slice(-8), gaps = gapsOf(last);
  if (last.length && now - last[last.length - 1] > 0.05) gaps.push(now - last[last.length - 1]);   // 押すのをやめている時間も間隔の1つ
  const med = median(gaps);
  // 重複のあとに間隔が伸びたか：重複の前の中央値 → あとの中央値（それぞれ最大3間隔）
  let dupSlow = false;
  for (const d of dupAts) {
    if (d < now - cfg.windowSeconds || d > now) continue;
    const before = gapsOf(presses.filter((t) => t <= d).slice(-4)), afterP = presses.filter((t) => t > d).slice(0, 4), after = gapsOf([d, ...afterP]).slice(1);
    if (afterP.length >= 2 && after.length >= 1) {
      const mb = before.length ? median(before) : 0, ma = median(after);
      if (ma >= cfg.dupSlowAbs && ma >= cfg.dupSlowRatio * mb) { dupSlow = true; break; }
    } else if (!afterP.length && now - d >= cfg.dupSlowAbs * 1.3) { dupSlow = true; break; }   // 重複のあと、しばらく押していない
  }
  const calm = n5 <= cfg.recentMax;
  const careful = calm && ((n12 <= cfg.maxPresses && med >= cfg.minMedianGap) || (dupSlow && n12 <= cfg.dupMaxPresses && med >= cfg.dupMinMedianGap));
  return { careful, n12, n5, median: Number.isFinite(med) ? +med.toFixed(2) : null, dupSlow };
}

// ------------------------------------------------------------------ 場面
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const backOut = (x) => { x = Math.min(1, Math.max(0, x)); const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const W = 1152, H = 1268, SC = 7;
// 場面の時刻（秒）
export const BEAT = { title: 0.14, up: 0.18, line1: 0.62, line2: 0.98, smash: 1.34 };
export const sceneAlpha = (t, T = SECONDS) => Math.min(1, t / 0.2) * Math.min(1, Math.max(0, (T - t) / 0.28));

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const BUB = (() => { const r = rng(7); return Array.from({ length: 26 }, () => ({ x: r(), y: r(), s: 0.4 + r() * 1.1, sp: 0.03 + r() * 0.05, ph: r() * 6.28, hue: r() })); })();

/** 背景：やさしい水色→藤色→桃色の竜宮の光。くっきりした図形なし（にじむ光の玉と光の筋だけ） */
function drawBackdrop(ctx, t, a) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1f86b4'); g.addColorStop(0.5, '#6a50c8'); g.addColorStop(1, '#c4529c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  // 上から差す光の筋（ゆっくり揺れる）
  for (let i = 0; i < 5; i++) {
    const x0 = 120 + i * 230 + Math.sin(t * 0.9 + i * 1.7) * 40, w0 = 90 + 40 * Math.sin(t * 0.7 + i);
    const lg = ctx.createLinearGradient(x0, 0, x0 - 200, H * 0.85);
    lg.addColorStop(0, 'rgba(255,255,255,.30)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(x0 - w0, 0); ctx.lineTo(x0 + w0, 0); ctx.lineTo(x0 - 200 + w0 * 2.4, H * 0.85); ctx.lineTo(x0 - 200 - w0 * 2.4, H * 0.85); ctx.closePath(); ctx.fill();
  }
  // 泡のにじみ（ぼかした光の玉）
  for (const b of BUB) {
    const y = H - ((b.y + t * b.sp) % 1.1) * H * 1.1 + 60, x = b.x * W + Math.sin(t * 1.3 + b.ph) * 26, r = 40 + 90 * b.s;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = b.hue < 0.5 ? '200,250,255' : '255,220,240';
    rg.addColorStop(0, `rgba(${c},.34)`); rg.addColorStop(0.55, `rgba(${c},.12)`); rg.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = rg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 中央のやわらかな後光（うぱの後ろ）
  const hg = ctx.createRadialGradient(W / 2, 960, 40, W / 2, 960, 620);
  hg.addColorStop(0, `rgba(255,244,214,${0.42 * ease((t - 0.1) / 0.5)})`); hg.addColorStop(0.5, 'rgba(255,214,235,.10)'); hg.addColorStop(1, 'rgba(255,200,230,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, 300, W, H - 300);
  ctx.globalCompositeOperation = 'source-over';
  // 周辺の落ち（ふち暗く）
  const vg = ctx.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 900);
  vg.addColorStop(0, 'rgba(40,10,70,0)'); vg.addColorStop(1, 'rgba(40,10,70,.38)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

/** うぱ。frame 配列は Image。足元（地面）を bottomY にそろえる */
function drawUpa(ctx, t, A, bottomY) {
  const S = A.sprites; let img, bob = 0;
  const rise = backOut((t - BEAT.up) / 0.5);
  const smash = t >= BEAT.smash;
  if (smash) { const f = Math.floor((t - BEAT.smash) * 12) % 4; img = S.smash[f]; bob = 0; }
  else if (t < BEAT.line1 - 0.1) { img = S.idle[0]; }
  else { const f = Math.floor(t * 6) % 4; img = S.idle[f]; bob = -Math.abs(Math.sin((t - BEAT.line1) * 7)) * 1.2 * SC * Math.exp(-(t - BEAT.line1) * 1.3); }
  const w = img.width * SC, h = img.height * SC;
  const slide = (1 - rise) * (h + 60);
  const X = Math.round((W / 2 - w / 2) / SC) * SC, Y = Math.round((bottomY - h + slide + bob) / SC) * SC;
  ctx.imageSmoothingEnabled = false; ctx.drawImage(img, X, Y, w, h);
  return { X, Y, w, h };
}

function glow(ctx, x, y, r, rgb, k) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${k})`); g.addColorStop(0.5, `rgba(${rgb},${k * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// きらめき：にじむ光の玉＋やわらかい十字（線ではなく細長い光のにじみ）
function glint(ctx, x, y, r, k) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, x, y, r, '255,246,200', k);
  ctx.translate(x, y);
  for (const rot of [0, Math.PI / 2]) { ctx.save(); ctx.rotate(rot); const g = ctx.createLinearGradient(-r * 1.6, 0, r * 1.6, 0); g.addColorStop(0, 'rgba(255,250,220,0)'); g.addColorStop(0.5, `rgba(255,252,235,${k * 0.9})`); g.addColorStop(1, 'rgba(255,250,220,0)'); ctx.fillStyle = g; ctx.fillRect(-r * 1.6, -r * 0.06, r * 3.2, r * 0.12); ctx.restore(); }
  ctx.restore();
}

/** 場面の全体（t = 0〜SECONDS）。ctx は液晶の面（1152x1268）。a = 全体の不透明度（呼び出し側が決める。既定は sceneAlpha） */
export function drawAdvice(ctx, t, A, a = sceneAlpha(t)) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  drawBackdrop(ctx, t, a);
  // 出だしの白いにじみ（場面が切り替わったことを一瞬で伝える）
  const f0 = Math.max(0, 1 - t / 0.22); if (f0 > 0) { ctx.fillStyle = `rgba(255,255,255,${f0 * f0 * 0.8})`; ctx.fillRect(0, 0, W, H); }
  const bottom = 1236;
  // 足元のやわらかい影
  ctx.save(); ctx.translate(W / 2, bottom + 6); ctx.scale(4.2, 0.5); const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 100); sg.addColorStop(0, `rgba(60,20,90,${0.45 * ease((t - 0.2) / 0.4)})`); sg.addColorStop(1, 'rgba(60,20,90,0)'); ctx.fillStyle = sg; ctx.fillRect(-110, -110, 220, 220); ctx.restore();
  const up = drawUpa(ctx, t, A, bottom);
  // 連打の波紋：PUSH ボタンのあたりからやわらかい輪が広がる（拍に合わせて）
  if (t >= BEAT.smash) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cx = W / 2, cy = bottom - 36;
    for (let k = 0; k < 3; k++) {
      const u = (((t - BEAT.smash) * 3.2 + k / 3) % 1), r = 120 + u * 380, al = (1 - u) ** 1.6 * 0.5;
      const rg = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r); rg.addColorStop(0, 'rgba(255,240,190,0)'); rg.addColorStop(0.75, `rgba(255,236,190,${al})`); rg.addColorStop(1, 'rgba(255,200,230,0)');
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.42); ctx.translate(-cx, -cy); ctx.fillStyle = rg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.restore();
    }
    ctx.restore();
  }
  // 「ワンポイントアドバイス」：左から滑り込む小さめの題字（下にやわらかい金の光）
  const tk = easeOut((t - BEAT.title) / 0.32);
  if (tk > 0) {
    ctx.save(); ctx.globalAlpha = a * Math.min(1, tk * 1.4);
    glow(ctx, 576, 262, 420, '255,226,150', 0.5 * tk);
    telop(ctx, 'ワンポイントアドバイス', 576 - (1 - tk) * 380, 218, 80, { glow: 'rgba(255,190,90,.9)' });
    ctx.restore();
  }
  // 助言の字：ドンと入って少し揺れて止まる（1行目「連打が」・2行目「おすすめだよ！」）
  const slam = (str, at, y, size, glowC) => {
    const u = t - at; if (u < 0) return;
    const pop = 1 + 0.5 * (1 - easeOut(u / 0.2)) ** 2, shk = u > 0.16 ? Math.sin(u * 80) * 7 * Math.exp(-(u - 0.16) * 13) : 0, shv = u > 0.16 ? Math.cos(u * 67) * 5 * Math.exp(-(u - 0.16) * 13) : 0;
    const beat = t >= BEAT.smash ? 1 + 0.03 * Math.max(0, Math.sin((t - BEAT.smash) * 12 * 3.1416 / 2)) : 1;   // 連打の拍で少し脈打つ
    ctx.save(); ctx.globalAlpha = a * Math.min(1, u / 0.05); glow(ctx, 576, y, size * 3.2, '255,246,214', 0.32);
    ctx.translate(576 + shk, y + shv); ctx.scale(pop * beat, pop * beat); telop(ctx, str, 0, 0, size, { glow: glowC }); ctx.restore();
    if (u < 0.3) { const k = (1 - u / 0.3) ** 2; ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, 576, y, size * 3, '255,255,255', 0.7 * k); ctx.restore(); }
  };
  slam('連打が', BEAT.line1, 440, 250, 'rgba(255,120,200,.95)');
  slam('おすすめだよ！', BEAT.line2, 630, 132, 'rgba(255,150,100,.95)');
  // うぱの頭の上のひらめき（出てきた瞬間と、字が出た瞬間）
  const gl = (at, x, y, r) => { const u = t - at; if (u >= 0 && u < 0.5) glint(ctx, x, y, r * (0.6 + 0.6 * easeOut(u / 0.2)), (1 - u / 0.5) ** 1.5); };
  gl(0.55, up.X + 20, up.Y + 30, 90); gl(BEAT.line1 + 0.04, 150, 520, 110); gl(BEAT.line2 + 0.04, 1010, 660, 90); gl(BEAT.smash + 0.02, up.X + up.w - 10, up.Y + 20, 80);
  // 連打の間の小さなきらめき
  if (t >= BEAT.smash + 0.2) for (let k = 0; k < 3; k++) { const u = ((t - BEAT.smash) * 2.4 + k * 0.33) % 1, x = 200 + k * 380 + Math.sin(k * 5 + t) * 40, y = 1100 - u * 380; glint(ctx, x, y, 38, Math.sin(u * 3.14) * 0.7); }
  ctx.restore();
}

// ------------------------------------------------------------------ 素材
const loadImg = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
export async function loadSprites(base) {
  const set = async (n, c) => Promise.all(Array.from({ length: c }, (_, i) => loadImg(new URL(`${n}_${String(i).padStart(2, '0')}.png`, base).href)));
  const [idle, smash, surprise, joy] = await Promise.all([set('pose_front_idle', 4), set('pose_smash', 4), set('close_surprise', 3), set('close_joy', 4)]);
  return { idle, smash, surprise, joy };
}

// ------------------------------------------------------------------ ゲームへの接続（createMashHint と同じ口）
export function createCarefulHint({ game, sprites, cfg = {}, onStart = null, onEnd = null } = {}) {
  const c = { ...CAREFUL, ...cfg };
  const S = { presses: [], dupAts: [], decided: false, decidedAt: null, shows: 0, active: false, lastLamps: 0, last: null, t: 0, nowOf: 0 };
  const A = { sprites };
  return {
    cfg: c, state: S,
    reset() { S.presses = []; S.dupAts = []; S.decided = false; S.decidedAt = null; S.active = false; S.lastLamps = 0; S.last = null; S.t = 0; },
    press(now) { S.presses.push(now); if (S.presses.length > 60) S.presses.shift(); },
    draw(ctx, dt, ns, now) {
      const lc = game.lampCount ?? 0; if (lc < S.lastLamps && !S.active) { S.dupAts.push(now); if (S.dupAts.length > 20) S.dupAts.shift(); } S.lastLamps = lc;
      if (!S.decided && ns?.normal && ns.elapsed >= c.atSeconds) {
        const r = analyze(S.presses, now, S.dupAts, c); S.last = r;
        if (!r.careful) { S.decided = true; S.decidedAt = { now, elapsed: ns.elapsed, ...r, shown: false }; }   // 連打している（または基準より速い）客は出さない
        else if (game.beginAdvice?.(c.seconds)) { S.decided = true; S.active = true; S.shows++; S.t = 0; S.decidedAt = { now, elapsed: ns.elapsed, ...r, shown: true }; onStart?.(S.decidedAt); }
        else if (ns.elapsed >= c.atSeconds + c.graceSeconds) { S.decided = true; S.decidedAt = { now, elapsed: ns.elapsed, ...r, shown: false, skipped: true }; }
      } else if (!S.decided && ns && ns.elapsed >= c.atSeconds + c.graceSeconds) { S.decided = true; S.decidedAt = { now, skipped: true, shown: false }; }
      if (!S.active) return;
      const st = game.adviceStatus;
      if (!st) { S.active = false; onEnd?.(); return; }
      S.t = st.t; drawAdvice(ctx, st.t, A, sceneAlpha(st.t, st.total));
    },
  };
}
