// 通常時、連打していなさそうな客へ、うぱ（upa_source.png のドット絵を整数倍）が出て「おすすめは連打だよ！」と字で言う。声はなし。
// 目的：慎重に打ちすぎてJPチャンスにたどり着けない客を、連打へ誘ってJPに導く。JPチャンス中・継続中には出さない（呼び出し側が通常時だけ ns を渡す）。
// 発動の条件は調整担当が決める：HINT の数値（またはコンストラクタの引数）だけで差し替えられる。
//
//   const h = createMashHint({ img: upaImage, cfg: {...HINT} });
//   h.press(now)                  // 通常時のボタンの押下のたびに呼ぶ（'fire' 操作。受け付けられなかった押下も含む）
//   h.draw(ctx, dt, ns, now)      // 毎フレーム。ns = { normal: 通常時か, elapsed: 通常時が始まってからの秒（通常時だけ数える）}（通常時以外は null / normal=false）
//   h.reset()                     // プレイの始まり（'start'）で呼ぶ
//
// 判定（調整担当の仮案）：通常時が始まって atSeconds（約20秒）の時点で、直近 lastPresses 回の押下の間隔の平均が avgInterval 秒を超えていれば出す。
//   ・間隔は押下どうしの差（lastPresses=3 なら 2 つ）。押下が lastPresses 回に満たなければ「連打していない」。
//   ・最後の押下から今までの経過も間隔の1つとして末尾に足す（押すのをやめている客を拾う）。
//   ・1プレイで1回だけ判定する（連打していれば出さずにそのまま）。atSeconds に通常時でなければ、graceSeconds までは通常時に戻るのを待つ。
import { fancy } from './meter_h_20261029.mjs';

export const HINT = {
  atSeconds: 20,          // 通常時が始まってからこの秒数の時点で判定する（約20秒）
  graceSeconds: 8,        // その時点で通常時でなければ、さらにこの秒数まで通常時に戻るのを待つ
  lastPresses: 3,         // 直近この回数の押下の間隔を見る
  avgInterval: 0.8,       // その平均がこれ（秒）を超えたら「連打していない」
  showSeconds: 3.2,       // 表示の長さ
  scale: 8,               // うぱの整数倍（46x21 → 368x168）
  fontSize: 168,          // 字の大きさ（2 行）
  lines: ['おすすめは', '連打だよ！'],
  textY: 410,             // 1 行目の中心 y。通常時の避ける枠（上端 y52〜122、右上/右下の残り時間）を守る
  lineGap: 168,
  upaX: 748, upaY: 725,   // うぱの左上（液晶面の座標）
};

const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
// 押下の記録（秒の配列）から平均間隔を出す
export function meanInterval(presses, now, cfg = HINT, idle = true) {
  const p = presses.slice(-cfg.lastPresses);
  const gaps = []; for (let i = 1; i < p.length; i++) gaps.push(p[i] - p[i - 1]);
  if (idle && p.length) gaps.push(now - p[p.length - 1]);
  const g = gaps.slice(-(cfg.lastPresses - 1)); return g.length ? g.reduce((a, b) => a + b, 0) / g.length : Infinity;
}
export function hintWanted(ns, presses, now, state, cfg = HINT) {
  if (state.decided || !ns?.normal) return false;
  return ns.elapsed >= cfg.atSeconds;
}
export function isMashing(presses, now, cfg = HINT) { return presses.length >= cfg.lastPresses && meanInterval(presses, now, cfg) <= cfg.avgInterval; }

// 極太の明朝×虹グラデ×白銀の縁＋黒縁（テロップの様式）
const RAINBOW = [[0, '#fff7a8'], [0.28, '#ffb64a'], [0.5, '#ff5aa6'], [0.52, '#7a1a6a'], [0.72, '#9a6bff'], [1, '#5fd2ff']];
const SILVER = [[0, '#ffffff'], [0.45, '#e9eaf5'], [0.5, '#9fa2c4'], [1, '#ffffff']];
export const TELOP_FONT = '"Kaisei Tokumin", "Noto Serif CJK JP", serif';
export function telop(ctx, str, x, y, size, { glow = 'rgba(255,100,190,.9)' } = {}) {
  ctx.save();
  ctx.font = `800 ${size}px ${TELOP_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.translate(x, y);
  const grad = (stops) => { const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
  ctx.shadowColor = glow; ctx.shadowBlur = size * 0.22;
  ctx.strokeStyle = '#12020e'; ctx.lineWidth = size * 0.30; ctx.strokeText(str, 0, 0);          // 黒縁（外）
  ctx.shadowBlur = 0;
  ctx.strokeStyle = grad(SILVER); ctx.lineWidth = size * 0.19; ctx.strokeText(str, 0, 0);       // 白銀縁
  ctx.strokeStyle = '#1a0420'; ctx.lineWidth = size * 0.085; ctx.strokeText(str, 0, 0);         // 縁の内側の黒
  ctx.strokeStyle = grad(RAINBOW); ctx.lineWidth = size * 0.045; ctx.strokeText(str, 0, 0);     // 字をさらに太らせる
  ctx.fillStyle = grad(RAINBOW); ctx.fillText(str, 0, 0);
  ctx.restore();
}

export function createMashHint({ img, cfg = {} } = {}) {
  const c = { ...HINT, ...cfg };
  const S = { presses: [], decided: false, shows: 0, showAt: -1, active: false, total: 0, endAt: -1, decidedAt: null };
  return {
    cfg: c, state: S,
    reset() { S.presses = []; S.decided = false; S.shows = 0; S.showAt = -1; S.active = false; S.endAt = -1; S.decidedAt = null; },
    press(now) {
      S.presses.push(now); if (S.presses.length > 40) S.presses.shift();
      // 促している最中に連打を始めたら、間隔が基準以内に戻った時点で引っ込める
      if (S.active && S.presses.length >= c.lastPresses && meanInterval(S.presses, now, c, false) <= c.avgInterval && S.endAt < 0) S.endAt = now + 0.35;
    },
    draw(ctx, dt, ns, now) {
      if (!S.decided && ns?.normal && ns.elapsed >= c.atSeconds) {
        S.decided = true; const mash = isMashing(S.presses, now, c);
        S.decidedAt = { now, elapsed: ns.elapsed, mean: +meanInterval(S.presses, now, c).toFixed(2), presses: S.presses.length, mash };
        if (!mash) { S.active = true; S.showAt = now; S.shows++; S.total++; S.endAt = -1; }
      } else if (!S.decided && ns && ns.elapsed >= c.atSeconds + c.graceSeconds) { S.decided = true; S.decidedAt = { now, skipped: true }; }
      if (!S.active) return;
      const t = now - S.showAt, endT = S.endAt >= 0 ? Math.min(S.endAt - S.showAt, c.showSeconds) : c.showSeconds;
      if (t > endT || !ns?.normal) { S.active = false; return; }
      const inK = easeOut(t / 0.3), outK = Math.min(1, Math.max(0, (endT - t) / 0.3)), a = Math.min(inK, outK);
      const sc = c.scale, w = img.width * sc, h = img.height * sc;
      ctx.save(); ctx.globalAlpha = a;
      // 字の後ろは、縁のないやわらかい暗がり（枠は使わない）
      const cy = c.textY + c.lineGap * (c.lines.length - 1) / 2;
      ctx.save(); ctx.translate(576, cy + 40); ctx.scale(4.6, 1.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 250); g.addColorStop(0, 'rgba(18,0,36,.52)'); g.addColorStop(0.6, 'rgba(18,0,36,.28)'); g.addColorStop(1, 'rgba(18,0,36,0)');
      ctx.fillStyle = g; ctx.fillRect(-260, -260, 520, 520); ctx.restore();
      // 字：出るときにドンと大きく入り（1.25→1）、少し揺れて止まる
      const pop = 1 + 0.25 * (1 - easeOut(t / 0.22)) ** 2, shk = t > 0.18 ? Math.sin(t * 70) * 5 * Math.exp(-(t - 0.18) * 14) : 0;
      c.lines.forEach((ln, i) => {
        ctx.save(); ctx.translate(576 + shk, c.textY + i * c.lineGap); ctx.scale(pop, pop);
        telop(ctx, ln, 0, 0, c.fontSize); ctx.restore();
      });
      // うぱ：最近傍で整数倍（にじませない）。右の縁から 1 ドット単位で滑り込み、弾んで止まる
      const bob = t > 0.35 ? -Math.abs(Math.sin((t - 0.35) * 5.2)) * 1.5 * sc : 0;
      const X = Math.round((c.upaX + (1 - inK) * (w + 60)) / sc) * sc, Y = Math.round((c.upaY + bob) / sc) * sc;
      ctx.imageSmoothingEnabled = false; ctx.drawImage(img, X, Y, w, h);
      ctx.restore();
    },
  };
}
