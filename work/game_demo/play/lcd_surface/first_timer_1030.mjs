// 10/30 初めてプレイする客への「プレイ中の小さな配慮」（監督方針：説明なしで分かり、また来たくなる）。規則は変えない。演出・文・見せ方だけ。
//   ?ft1=0 JPの失敗の「あと◯本だった！」（jp_seal_1030 の失敗の経路が lcd.firstTimer.nearMiss を呼ぶ。割れた演出のあと 1.5 秒、宝石の数字で残りの本数）
//   ?ft2=0 初めての入賞（その回の1灯目）を大きく褒める（0.8秒・囲いと穴が虹色・専用の音・「ナイス！」）
//   ?ft3=0 最初の10秒の迷い対策：開始直後に7つの穴のLEDを左から右へ流す／5秒押さなければうぱが「左のボタンを押してね」
//   ?ft4=0 5灯で「あと1つ！」：灯っていない穴のLEDを速く点滅＋上の帯に「あと1つで JACKPOT CHANCE！」
//   ?ft5=0 初めての重複で理由を見せる：入った穴のLEDを赤く3回点滅＋「光ってる穴だった！」
// すべて液晶の重ね描き＋穴/囲いの光＋音だけ。時計も発射も止めない（撃ちながら出る）。字は激アツ風（hint_h_20261029 の telop）。
// 穴を指す情報は穴のLED（cabinet_light_script の holeOverlay）で出し、液晶には穴の位置を出さない。
// 避ける枠（液晶 1152x1268）：上端 y52〜122・右下の残り時間。
import { telop } from './hint_h_20261029.mjs';
import * as fx from './first_timer_fx_1030.mjs';

const PX = 34, PY = 28, W = 1152, H = 1268;
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const frac = (x) => x - Math.floor(x);
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
export const FT = { praise: 0.8, five: 3.0, dup: 2.4, near: 1.5, promptMax: 10, promptAfter: 5, sweepPasses: 2, sweepGap: 0.13, sweepPass: 1.25 };

function glow(ctx, x, y, r, rgb, k) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${k})`); g.addColorStop(0.5, `rgba(${rgb},${k * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// 字の後ろのやわらかい暗がり（縁なし）
function dim(ctx, cx, cy, sx, sy, a) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
  g.addColorStop(0, `rgba(18,0,36,${0.55 * a})`); g.addColorStop(0.6, `rgba(18,0,36,${0.3 * a})`); g.addColorStop(1, 'rgba(18,0,36,0)'); ctx.fillStyle = g; ctx.fillRect(-100, -100, 200, 200); ctx.restore();
}

export async function attachFirstTimer(lcd, { controller, log = () => {} } = {}) {
  if (!lcd?.production || lcd.firstTimer) return lcd;
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  const on = (n) => { const v = qs.get('ft' + n); return v !== '0' && v !== 'off'; };
  const F = { 1: on(1), 2: on(2), 3: on(3), 4: on(4), 5: on(5) };
  if (!Object.values(F).some(Boolean)) return lcd;
  const ctx = lcd.canvas.getContext('2d');
  const base = new URL('./rules_h_assets/', import.meta.url);
  const [upa, ...gem] = await Promise.all([img(new URL('upa_source.png', base).href), ...['1', '2', '3', '4', '5', '6', '7'].map((k) => img(new URL(`gem_${k}.png`, base).href))]);
  const S = { clock: 0, startAt: -1, pressed: false, promptDone: false, prompt: null, praised: false, praise: null, five: null, dupDone: false, dup: null, near: null, sweepAt: -99, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 60) S.events.shift(); log('ft:' + k, d); };
  const eng = () => globalThis.__r2Audio?.engine;
  const game = () => controller.game;
  const resetSession = () => { S.startAt = -1; S.pressed = false; S.promptDone = false; S.prompt = null; S.praised = false; S.praise = null; S.five = null; S.dupDone = false; S.dup = null; S.near = null; S.sweepAt = -99; lcd.cabinetLightScript?.cue?.(null); };

  // ---- 出来事 ----
  const base0 = lcd.onEvent.bind(lcd);
  lcd.onEvent = (id, p = {}) => {
    try {
      if (id === 'ticket' || id === 'attract') resetSession();
      else if (id === 'start') { S.startAt = S.clock; S.pressed = false; S.promptDone = false; if (F[3]) { S.sweepAt = S.clock; note('sweep'); } }
      else if (id === 'lamp123' || id === 'lamp4' || id === 'lamp5' || id === 'lamp6') {
        let justPraised = false;
        if (F[2] && !S.praised) { S.praised = true; justPraised = true; S.praise = { at: S.clock }; fx.playPraiseSfx(eng()); note('praise', { id }); }
        if (id === 'lamp5' && F[4]) { S.five = { at: S.clock }; if (!justPraised) fx.playOneMoreSfx(eng()); note('five'); }
      } else if (id === 'dup_protect' || id === 'roulette') {
        if (id === 'roulette') S.five = null;
        if (F[5] && !S.dupDone) { S.dupDone = true; S.dup = { at: S.clock, lane: p.lane ?? p.pocket ?? null }; fx.playDupSfx(eng()); note('dup', { lane: S.dup.lane, id }); }
      }
    } catch (e) { console.warn('[first-timer] event', e); }
    return base0(id, p);
  };
  // 押下（'fire'）：通常時の最初の押下で、うぱの声かけを引っ込める
  const dispatch0 = controller.dispatch.bind(controller);
  controller.dispatch = (action, ...r) => { if (action === 'fire') S.pressed = true; return dispatch0(action, ...r); };

  // ---- 穴のLED（cabinet_light_script が毎フレーム呼ぶ。v = 穴7つ×rgb、1.0 ≒ 灯った穴の明るさの半分。戻り値 true で採用）----
  const holeFn = (v, ck) => {
    let any = false;
    const set = (h, r, g, b, L) => { v[h * 3] = Math.max(v[h * 3], r * L); v[h * 3 + 1] = Math.max(v[h * 3 + 1], g * L); v[h * 3 + 2] = Math.max(v[h * 3 + 2], b * L); any = true; };
    if (F[3] && S.sweepAt > -90) {
      const u = ck - S.sweepAt;
      if (u < FT.sweepPass * FT.sweepPasses + 0.9) for (let pass = 0; pass < FT.sweepPasses; pass++) for (let h = 0; h < 7; h++) {
        const d = u - pass * FT.sweepPass - h * FT.sweepGap; if (d < 0 || d > 0.7) continue;
        const L = Math.exp(-d / 0.2) * (1 + 0.8 * Math.exp(-d / 0.05)); set(h, 1, .86, .5, 1.1 * L);
      }
      else S.sweepAt = -99;
    }
    if (F[4] && S.five && game().lamps) {
      const lamps = game().lamps, on = frac(ck * 3.5) < 0.5;   // 約3.5Hz（4コマ以上）
      if (lamps.length === 5) { if (on) for (let h = 0; h < 7; h++) if (!lamps.includes(h + 1)) set(h, 1, .72, .12, 1.5); }
    }
    if (F[5] && S.dup && S.dup.lane >= 1 && S.dup.lane <= 7) {
      const u = ck - S.dup.at;
      if (u >= 0 && u < 0.9 && (u % 0.3) < 0.15) set(S.dup.lane - 1, 1, .02, .02, 5);   // 赤く3回
    }
    return any;
  };
  let hooked = false;

  // ---- 重ね描き ----
  const drawPraise = (u) => {
    const a = clamp(u / 0.05) * clamp((FT.praise - u) / 0.2), sc = 1 + 0.5 * (1 - easeOut(u / 0.16)) ** 2 + 0.025 * Math.sin(u * 30);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hues = ['255,120,160', '255,210,90', '120,230,255', '190,150,255'];
    for (let k = 0; k < 12; k++) { const ang = k / 12 * 6.283 + 0.4, r = 120 + 560 * easeOut(u / 0.7) * (0.6 + 0.4 * ((k * 7) % 5) / 4); glow(ctx, 576 + Math.cos(ang) * r, 560 + Math.sin(ang) * r * 0.7, 46 + (k % 3) * 14, hues[k % 4], 0.8 * a * (1 - u / FT.praise * 0.4)); }
    glow(ctx, 576, 560, 560, '255,240,200', 0.5 * a); ctx.restore();
    dim(ctx, 576, 580, 5.5, 2.0, a);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(576 + Math.sin(u * 90) * 6 * Math.exp(-u * 8), 640); ctx.scale(sc, sc); telop(ctx, 'ナイス！', 0, 0, 240, { glow: 'rgba(255,90,180,.95)' }); ctx.restore();
    if (u < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - u / 0.12) ** 2})`; ctx.fillRect(0, 0, W, H); }
  };
  const drawBand = (u) => {   // 5灯：上寄りの帯（y 380〜680。上端の射出器 y52〜122・右上の残り時間 y100〜340 は避ける）
    const a = clamp(u / 0.25) * clamp((FT.five - u) / 0.35), slide = (1 - easeOut(u / 0.3)) * -60;
    ctx.save(); ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(0, 380, 0, 680); g.addColorStop(0, 'rgba(24,4,48,0)'); g.addColorStop(0.2, 'rgba(24,4,48,.62)'); g.addColorStop(0.8, 'rgba(24,4,48,.62)'); g.addColorStop(1, 'rgba(24,4,48,0)'); ctx.fillStyle = g; ctx.fillRect(0, 380, W, 300);
    const pop = 1 + 0.18 * (1 - easeOut(u / 0.2)) ** 2;
    ctx.save(); ctx.translate(576, 480 + slide); ctx.scale(pop, pop); telop(ctx, 'あと1つで', 0, 0, 118, { glow: 'rgba(255,170,60,.95)' }); ctx.restore();
    ctx.save(); ctx.translate(576, 595 + slide); ctx.scale(pop, pop); telop(ctx, 'JACKPOT CHANCE！', 0, 0, 92, { glow: 'rgba(255,90,190,.95)' }); ctx.restore();
    ctx.restore();
  };
  const drawDup = (u) => {
    const a = clamp(u / 0.15) * clamp((FT.dup - u) / 0.3), pop = 1 + 0.2 * (1 - easeOut(u / 0.2)) ** 2;
    dim(ctx, 576, 790, 4.6, 0.8, a);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(576, 790); ctx.scale(pop, pop); telop(ctx, '光ってる穴だった！', 0, 0, 92, { glow: 'rgba(255,60,60,.95)' }); ctx.restore();
  };
  const drawNear = (u, rem) => {
    const a = clamp(u / 0.06) * clamp((FT.near - u) / 0.28), im = gem[clamp(rem - 1, 0, 6)], pop = 1 + 0.9 * (1 - easeOut(u / 0.16)) ** 2 + 0.02 * Math.sin(u * 20);
    ctx.save(); ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(576, 620, 80, 576, 620, 760); g.addColorStop(0, 'rgba(14,0,30,.5)'); g.addColorStop(1, 'rgba(14,0,30,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(576, 610); const s = 0.72 * pop; ctx.scale(s, s); ctx.drawImage(im, -im.width / 2, -im.height / 2); ctx.restore();
    const sh = Math.sin(u * 80) * 5 * Math.exp(-u * 9);
    ctx.save(); ctx.translate(205 + sh, 650); ctx.scale(pop, pop); telop(ctx, 'あと', 0, 0, 150, { glow: 'rgba(160,90,255,.95)' }); ctx.restore();
    ctx.save(); ctx.translate(925 + sh, 650); ctx.scale(pop, pop); telop(ctx, '本！', 0, 0, 150, { glow: 'rgba(160,90,255,.95)' }); ctx.restore();
    ctx.save(); ctx.translate(576, 960); ctx.scale(pop, pop); telop(ctx, rem === 1 ? '惜しい！' : 'もう少し！', 0, 0, 120, { glow: 'rgba(255,170,60,.95)' }); ctx.restore();
    ctx.restore();
  };
  const drawPrompt = (u, fade) => {
    const a = Math.min(easeOut(u / 0.3), fade), sc = 8, w = upa.width * sc, h = upa.height * sc, pop = 1 + 0.25 * (1 - easeOut(u / 0.22)) ** 2, shk = u > 0.18 ? Math.sin(u * 70) * 5 * Math.exp(-(u - 0.18) * 14) : 0;
    ctx.save(); ctx.globalAlpha = a;
    dim(ctx, 576, 480, 4.6, 2.0, 1);
    ['左のボタンを', '押してね！'].forEach((ln, i) => { ctx.save(); ctx.translate(576 + shk, 410 + i * 150); ctx.scale(pop, pop); telop(ctx, ln, 0, 0, 140); ctx.restore(); });
    const bob = u > 0.35 ? -Math.abs(Math.sin((u - 0.35) * 5.2)) * 1.5 * sc : 0;
    const X = Math.round((748 + (1 - easeOut(u / 0.3)) * (w + 60)) / sc) * sc, Y = Math.round((725 + bob) / sc) * sc;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(upa, X, Y, w, h);
    ctx.restore();
  };
  const normalPhase = () => ['Ready', 'Flight', 'Effect'].includes(game().phase) && !game().meterStatus && !game().rouletteStatus && !lcd.jp?.model?.active && !lcd.choiceV20?.active;
  const activeNow = () => !!(S.praise || S.five || S.dup || S.near?.start >= 0 || S.prompt);

  const frame0 = lcd.frame.bind(lcd);
  lcd.frame = (dt, Fr) => {
    const r = frame0(dt, Fr);
    S.clock += dt;
    if (!hooked && lcd.cabinetLightScript) { lcd.cabinetLightScript.holeOverlay = holeFn; hooked = true; }
    const g = game();
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (S.praise) {   // 囲いを虹色に（cue）と字
      const u = S.clock - S.praise.at;
      if (u >= FT.praise) { S.praise = null; lcd.cabinetLightScript?.cue?.(null); } else { lcd.cabinetLightScript?.cue?.('first_lamp', u); drawPraise(u); }
    }
    if (S.five) {
      if (g.lampCount !== 5 || g.meterStatus) S.five = null;
      else { const u = S.clock - S.five.at; if (u < FT.five) drawBand(u); }
    }
    if (S.dup) { const u = S.clock - S.dup.at; if (u >= FT.dup) S.dup = null; else drawDup(u); }
    if (S.near) {
      const N = S.near, m = lcd.jp?.model, failing = !!m?.active && /^fail_/.test(m.name ?? '');
      if (failing) N.seen = true;
      if (N.start < 0) {
        if ((N.seen && !failing) || (!N.seen && S.clock - N.armed > 6)) {
          if (g.secondsLeft > 0 && ['Ready', 'Flight', 'Effect'].includes(g.phase) && !m?.active) { N.start = S.clock; fx.playNearMissSfx(eng()); note('near', { rem: N.rem }); } else S.near = null;
        } else if (S.clock - N.armed > 12) S.near = null;
      }
      if (S.near && N.start >= 0) { const u = S.clock - N.start; if (u >= FT.near) S.near = null; else drawNear(u, N.rem); }
    }
    // うぱの声かけ：開始から5秒押していなければ。最初の押下で引っ込める（最大10秒）
    if (F[3] && S.startAt >= 0 && !S.promptDone) {
      if (!S.prompt) {
        if (S.pressed) S.promptDone = true;
        else if (S.clock - S.startAt >= FT.promptAfter && normalPhase() && !g.chainAnnouncing) { S.prompt = { at: S.clock, endAt: -1 }; fx.playChimeSfx(eng()); note('prompt'); }
      }
      if (S.prompt) {
        if (S.pressed && S.prompt.endAt < 0) S.prompt.endAt = S.clock;
        const u = S.clock - S.prompt.at, fade = S.prompt.endAt >= 0 ? 1 - (S.clock - S.prompt.endAt) / 0.3 : 1 - Math.max(0, u - FT.promptMax + 0.4) / 0.4;
        if (fade <= 0 || !normalPhase() && g.meterStatus) { S.prompt = null; S.promptDone = true; } else drawPrompt(u, fade);
      }
    }
    ctx.restore();
    return r;
  };
  // 毎フレーム変わる重ね描きがあるので、液晶面の「更新なし」判定を外す（他の attach と同じ作法）
  const rev = Object.getOwnPropertyDescriptor(lcd, 'uploadRevision')?.get;
  if (rev) Object.defineProperty(lcd, 'uploadRevision', { configurable: true, enumerable: true, get: () => (activeNow() ? undefined : rev.call(lcd)) });
  const nearMiss = ({ rem = 1, kind = 'jp' } = {}) => { if (!F[1]) return; S.near = { rem: clamp(Math.round(rem), 1, 7), kind, armed: S.clock, seen: false, start: -1 }; note('nearArm', { rem, kind }); };
  lcd.overlayHold = activeNow;   // normal_surface が見る：重ね描き中はGPUの映像経路を使わない
  lcd.firstTimer = { state: S, flags: F, nearMiss, holeFn, FT, dispose() { if (lcd.overlayHold === activeNow) lcd.overlayHold = null; controller.dispatch = dispatch0; lcd.onEvent = base0; lcd.frame = frame0; if (lcd.cabinetLightScript?.holeOverlay === holeFn) lcd.cabinetLightScript.holeOverlay = null; } };
  return lcd;
}
