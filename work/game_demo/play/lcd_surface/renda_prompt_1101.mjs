// 11/01 冒頭の説明の最後「ボタンを れんだ しよう！」で止まってしまう客への、行動の促し（監督の指摘）。
//   止まる理由の見立て：①それまでの場面は全部「読んで待てば次へ進む」ので、最後の台詞も読み物に見える ②液晶に「押す」の絵・動きが無い ③ボタンの位置が絵で出ない ④押して何が起きるか(玉が出る)が見えない。
//   手本（teacher_refs/rules_v4）：1A ガンダム逆襲のシャア「連打」（大きな PUSH ボタンの絵＋青い大字「連打」を点滅しながら保持）／1C キン肉マン「ボタン連打でマッスルパワーを放て！」（「連打!!」＋沈むボタンの絵）。
//   ここでは 左右2つのボタンの絵（実機と同じ左＝白〜青／右＝黄〜赤）が交互に高速に沈み続け、金の「連打」（カウントダウンと同じ Blender の字）が叩きつけられる。沈むたびに玉が上へ飛ぶ。
//   発射（どちらのボタンでも）で即消える。押さないまま 3.2 秒たつと「強い促し」：画面の揺れ・字の叩き直し・赤い警報の光・うぱの「ボタンを れんだ！」・音・左右ボタンの LED の速い交互点滅。
//   描くのは小さな2Dの層だけ（スプライトは起動時に1度作る・読み戻しなし）。?rendaprompt=0 で無効（旧のまま）。穴のランプは触らない。時計は最初の発射から（upa_host の仕組みのまま）。
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';

const PX = 34, PY = 28, W = 1152, H = 1268, TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
const easeBack = (x, c1 = 2.2) => { x = clamp(x); const c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(w)); c.height = Math.max(2, Math.ceil(h)); return c; };
export const rendaPromptOn = (search = globalThis.location?.search ?? '') => new URLSearchParams(search).get('rendaprompt') !== '0';

// 置き場所と秒数（試作の値。実画面で見て調整）
const LAYOUT = { btnY: 450, btnLX: 150, btnRX: 1002, btnD: 235, textY: 450, textW: 560, balls: 9, rise: 250 };   // 「連打」の左右に左右ボタンの絵（実機の左右と同じ並び）。真ん中下は席の吹き出し（ほぼ同じ大きさのまま、少し下げて縮める）
const BEAT = 0.1;            // 左右が交互に沈む間隔（秒）。合計で毎秒10回＝人が連打する速さ
const STRONG_AT = 3.2;       // 押さないまま強い促しへ（監督：3〜5秒）
const QUIT_AT = 30;          // これ以上は音と LED を止める（絵だけ残す）

export function createRendaPrompt({ eng, palette, log = () => {} } = {}) {
  const A = new URL('./count_1031/crenda.png', import.meta.url);
  const S = { on: false, t: 0, leave: null, strong: false, strongAt: 0, tickN: -1, warnN: -1, slamAt: 0, shown: 0, ledOn: false, balls: [] };
  const out = { S, ready: false, failed: null };
  let G = null;   // 素材

  // ---------------- 素材（起動時に一度） ----------------
  const build = async () => {
    const im = new Image(); im.src = A.href; await im.decode();
    const bb = { x: 317, y: 180, w: 1135, h: 645 }, tw = LAYOUT.textW, th = Math.round(tw * bb.h / bb.w), pad = 70;
    const txt = mk(tw + pad * 2, th + pad * 2), tx = txt.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(im, bb.x, bb.y, bb.w, bb.h, pad, pad, tw, th);
    const glow = (col, blur, al = 1) => { const c = mk(txt.width, txt.height), x = c.getContext('2d'); x.filter = `blur(${blur}px)`; x.drawImage(txt, 0, 0); x.filter = 'none'; x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return c; };
    const D = LAYOUT.btnD, M = 70, bw = D + M * 2;
    const button = (col, pressed) => {   // 実機のボタン：暗い縁の台＋ドーム。上が白/黄・下が青/赤のグラデーション（btn_color_1101 の色）
      const c = mk(bw, bw), x = c.getContext('2d'), m = bw / 2, r = D / 2, rgb = (a, q) => `rgb(${Math.min(255, a[0] * q) | 0},${Math.min(255, a[1] * q) | 0},${Math.min(255, a[2] * q) | 0})`;
      x.fillStyle = 'rgba(0,0,10,.35)'; x.beginPath(); x.ellipse(m + 6, m + r * 0.28, r * 1.28, r * 1.18, 0, 0, TAU); x.fill();
      const ring = x.createLinearGradient(0, m - r * 1.2, 0, m + r * 1.2); ring.addColorStop(0, 'rgb(112,110,134)'); ring.addColorStop(0.5, 'rgb(58,56,74)'); ring.addColorStop(1, 'rgb(26,24,36)'); x.fillStyle = ring; x.beginPath(); x.arc(m, m + r * 0.06, r * 1.2, 0, TAU); x.fill();
      x.fillStyle = 'rgb(18,16,26)'; x.beginPath(); x.arc(m, m + r * 0.06, r * 1.07, 0, TAU); x.fill();
      const q = pressed ? 0.8 : 1, cy = m - (pressed ? r * 0.015 : r * 0.1);
      if (!pressed) { x.fillStyle = rgb(col.bot, 0.45); x.beginPath(); x.arc(m, m + r * 0.0, r * 1.0, 0, TAU); x.fill(); }   // ドームの側面（浮いている高さ）
      const lg = x.createLinearGradient(0, cy - r, 0, cy + r); lg.addColorStop(0, rgb(col.top, q)); lg.addColorStop(0.5, rgb(col.mid ?? col.top, q)); lg.addColorStop(1, rgb(col.bot, q));
      x.fillStyle = lg; x.beginPath(); x.arc(m, cy, r * 0.97, 0, TAU); x.fill();
      const sh = x.createRadialGradient(m - r * 0.2, cy - r * 0.25, r * 0.3, m, cy, r * 0.97); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.72, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = sh; x.beginPath(); x.arc(m, cy, r * 0.97, 0, TAU); x.fill();
      x.fillStyle = `rgba(255,255,255,${pressed ? 0.45 : 0.8})`; x.beginPath(); x.ellipse(m - r * 0.36, cy - r * 0.46, r * 0.27, r * 0.15, -0.6, 0, TAU); x.fill();
      return c;
    };
    const halo = (rgb) => { const s = 900, c = mk(s, s), x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, s * 0.14, s / 2, s / 2, s * 0.5); g.addColorStop(0, `rgba(${rgb},.95)`); g.addColorStop(0.5, `rgba(${rgb},.38)`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, s, s); return c; };
    const ball = (() => { const d = 64, c = mk(d, d), x = c.getContext('2d'), g = x.createRadialGradient(d * 0.38, d * 0.34, d * 0.04, d / 2, d / 2, d * 0.5); g.addColorStop(0, 'rgb(255,255,255)'); g.addColorStop(0.45, 'rgb(205,214,232)'); g.addColorStop(1, 'rgb(86,96,128)'); x.fillStyle = g; x.beginPath(); x.arc(d / 2, d / 2, d * 0.47, 0, TAU); x.fill(); return c; })();
    const pal = [palette?.(0) ?? { top: [250, 252, 255], mid: [190, 214, 255], bot: [40, 100, 235], glow: '150,190,255' }, palette?.(1) ?? { top: [255, 228, 70], mid: [255, 152, 40], bot: [220, 30, 40], glow: '255,132,36' }];
    const flat = (c) => c.flat ? { top: c.top, mid: c.top, bot: c.top } : c;
    const vign = (() => { const c = mk(1152, 900), x = c.getContext('2d'), g = x.createRadialGradient(576, 450, 60, 576, 450, 600); g.addColorStop(0, 'rgba(12,2,28,.62)'); g.addColorStop(0.6, 'rgba(12,2,28,.4)'); g.addColorStop(1, 'rgba(12,2,28,0)'); x.fillStyle = g; x.fillRect(0, 0, 1152, 900); return c; })();
    const arrow = (() => { const c = mk(120, 120), x = c.getContext('2d'); x.lineJoin = 'round'; const p = () => { x.beginPath(); x.moveTo(34, 18); x.lineTo(86, 18); x.lineTo(86, 56); x.lineTo(108, 56); x.lineTo(60, 106); x.lineTo(12, 56); x.lineTo(34, 56); x.closePath(); }; p(); x.lineWidth = 16; x.strokeStyle = '#2a1408'; x.stroke(); x.fillStyle = '#ffd84a'; x.fill(); x.lineWidth = 5; x.strokeStyle = '#fff6c0'; p(); x.stroke(); return c; })();
    return { txt, glowY: glow('rgba(255,190,60,1)', 26), glowR: glow('rgba(255,60,30,1)', 30), btn: pal.map((p) => { const c = flat(p); return [button(c, false), button(c, true)]; }), halo: pal.map((p) => halo(p.glow ?? '255,200,100')), ball, vign, arrow, pad, M, pal };
  };
  out.loading = build().then((g) => { G = g; out.ready = true; }).catch((e) => { out.failed = e; console.warn('[renda-prompt] 素材を作れませんでした（促しは出しません）', e); });

  // ---------------- 音（WebAudio 合成） ----------------
  const o0 = (vol = -9) => { const ctx = eng?.()?.ctx; if (!ctx) return null; const g = ctx.createGain(); g.gain.value = 10 ** (vol / 20); g.connect(hotBus(eng())); setTimeout(() => { try { g.disconnect(); } catch { } }, 3000); return { ctx, g, t0: ctx.currentTime + 0.01 }; };
  const tone = (o, f, f2, at, dur, { type = 'sine', gain = 1, atk = 0.003 } = {}) => {
    const os = o.ctx.createOscillator(), e = o.ctx.createGain(); os.type = type; os.frequency.setValueAtTime(f, o.t0 + at); if (f2 && f2 !== f) os.frequency.exponentialRampToValueAtTime(f2, o.t0 + at + dur * 0.9);
    e.gain.setValueAtTime(0, o.t0 + at); e.gain.linearRampToValueAtTime(gain, o.t0 + at + atk); e.gain.exponentialRampToValueAtTime(0.0008, o.t0 + at + dur); os.connect(e).connect(o.g); os.start(o.t0 + at); os.stop(o.t0 + at + dur + 0.05); os.onended = () => { try { os.disconnect(); e.disconnect(); } catch { } };
  };
  const noise = (o, at, dur, { f = 3000, q = 0.8, gain = 0.5 } = {}) => {
    const n = Math.max(1, Math.floor(o.ctx.sampleRate * dur)), b = o.ctx.createBuffer(1, n, o.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-4 * i / n);
    const s = o.ctx.createBufferSource(), bp = o.ctx.createBiquadFilter(), e = o.ctx.createGain(); s.buffer = b; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; e.gain.value = gain; s.connect(bp).connect(e).connect(o.g); s.start(o.t0 + at); s.onended = () => { try { s.disconnect(); bp.disconnect(); e.disconnect(); } catch { } };
  };
  const safe = (fn) => (...a) => { try { fn(...a); } catch (e) { console.warn('[renda-prompt-sfx]', e); } };
  const sfx = {
    slam: safe((k = 1) => { const o = o0(-4 - (k < 1 ? 4 : 0)); if (!o) return; tone(o, 110, 42, 0, 0.45, { gain: 1 }); noise(o, 0, 0.16, { f: 1400, gain: 0.7 * k }); tone(o, 880, 1760, 0.02, 0.18, { gain: 0.3 * k, type: 'triangle' }); tone(o, 1320, 2640, 0.07, 0.22, { gain: 0.22 * k }); }),
    tick: safe((side, strong) => { const o = o0(strong ? -6 : -9); if (!o) return; noise(o, 0, 0.035, { f: side ? 4200 : 3100, gain: strong ? 0.9 : 0.7 }); tone(o, side ? 1480 : 1110, side ? 1180 : 880, 0, 0.07, { gain: strong ? 0.55 : 0.42, type: 'triangle' }); tone(o, side ? 220 : 180, 90, 0, 0.06, { gain: 0.5 }); }),
    warn: safe((hi) => { const o = o0(-8); if (!o) return; tone(o, hi ? 1568 : 1175, hi ? 1568 : 1175, 0, 0.11, { gain: 0.3, type: 'square', atk: 0.006 }); tone(o, hi ? 1175 : 1568, hi ? 1175 : 1568, 0.12, 0.11, { gain: 0.3, type: 'square', atk: 0.006 }); }),
    out: safe(() => { const o = o0(-10); if (!o) return; tone(o, 900, 1500, 0, 0.1, { gain: 0.3, type: 'triangle' }); }),
  };

  // ---------------- LED（左右ボタンの交互点滅）。3D筐体の光＝fx.hint('button', {side:'both', hz})（effects.js/lightbus.js）、実機のESP32 LED＝controller.ledOverride（cabinet_serial.mjs の buttonLeds が読む） ----------------
  const led = (on) => { try { const fx = globalThis.__play?.fxApi?.fx; if (!fx?.hint) { S.ledOn = on; return; } if (on) fx.hint('button', { side: 'both', hz: 1 / (BEAT * 2), secs: QUIT_AT }); else fx.hint('button_off'); S.ledOn = on; } catch (e) { console.warn('[renda-prompt] led', e); } };

  // ---------------- 状態 ----------------
  out.begin = () => { if (!rendaPromptOn() || !out.ready) return false; Object.assign(S, { on: true, t: 0, leave: null, strong: false, strongAt: 0, tickN: -1, warnN: -1, slamAt: 0, balls: [], shown: 0 }); sfx.slam(1); led(true); log('renda:begin'); return true; };
  out.press = () => { if (!S.on || S.leave) return false; S.leave = { t0: S.t }; led(false); sfx.out(); log('renda:press', { t: +S.t.toFixed(2), strong: S.strong }); return true; };
  out.reset = () => { if (S.on && S.ledOn) led(false); S.on = false; S.leave = null; S.strong = false; S.balls = []; };
  Object.defineProperty(out, 'vis', { get: () => S.on });
  Object.defineProperty(out, 'strong', { get: () => S.on && S.strong && !S.leave });
  out.t = () => S.t;
  out.leds = (nowMs) => (S.on && !S.leave && S.ledOn ? (Math.floor(nowMs / (BEAT * 1000)) & 1 ? [0, 1] : [1, 0]) : null);   // 絵と同じ周期で左右が交互（絵が沈む側のLEDを消す＝押した感じ。どちらでも同じ動作）

  out.tick = (dt, { quiet = false } = {}) => {
    if (!S.on) return;
    if (quiet) { out.reset(); return; }
    S.t += dt;
    if (S.leave) { if (S.t - S.leave.t0 > 0.12) out.reset(); return; }
    if (!S.strong && S.t >= STRONG_AT) { S.strong = true; S.strongAt = S.t; S.slamAt = S.t; sfx.slam(1); log('renda:strong'); }
    if (S.strong && S.t - S.slamAt >= 0.9) { S.slamAt = S.t; if (S.t < QUIT_AT) sfx.slam(0.7); }
    // 連打音：交互に BEAT ごと（絵が沈む瞬間に合わせる）
    const n = Math.floor((S.t - 0.25) / BEAT);
    if (S.t > 0.25 && n > S.tickN && S.t < QUIT_AT) { S.tickN = n; sfx.tick(n & 1, S.strong); const side = n & 1, cx = side ? LAYOUT.btnRX : LAYOUT.btnLX; S.balls.push({ t0: S.t, x: cx, y: LAYOUT.btnY - 30, side, vx: (576 - cx) * 0.35 + (Math.random() - 0.5) * 40 }); if (S.balls.length > LAYOUT.balls) S.balls.shift(); }
    if (S.strong && S.t < QUIT_AT) { const w = Math.floor((S.t - S.strongAt) / 0.5); if (w > S.warnN) { S.warnN = w; sfx.warn(w & 1); } }
    if (S.t >= QUIT_AT && S.ledOn) led(false);
  };

  // ---------------- 描画（液晶 canvas の座標。呼び出し側が translate(PX,PY)・clip を済ませる必要はない：ここでやる） ----------------
  out.draw = (ctx) => {
    if (!S.on || !G) return;
    const t = S.t, lv = S.leave ? clamp((t - S.leave.t0) / 0.12) : 0, A = 1 - lv, strong = S.strong;
    const st = strong ? t - S.strongAt : 0, shake = strong ? Math.min(1, st / 0.15) * 9 * (S.t < QUIT_AT ? 1 : 0.2) : 0, ox = shake * Math.sin(t * 83), oy = shake * Math.cos(t * 71);
    const inK = easeBack((t - 0.0) / 0.28), fade = clamp(t / 0.1);
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.translate(ox, oy);
    ctx.globalAlpha = A * fade; ctx.drawImage(G.vign, 0, 40);   // 場面を少し暗くして絵を立てる（強いときは赤みを足す）
    if (strong) { const k = 0.5 + 0.5 * Math.sin(st * TAU * 2.0); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * (0.16 + 0.26 * k); ctx.fillStyle = 'rgb(255,36,16)'; ctx.fillRect(-20, 40, W + 40, 900); ctx.restore(); }
    // ボタン2つ：交互に沈む
    const beatPhase = (side) => { const u = ((t - 0.25) / (BEAT * 2) - (side ? 0.5 : 0)); return t < 0.25 ? 1 : u - Math.floor(u); };   // 0..0.5 が沈んでいる
    for (const side of [0, 1]) {
      const cx = side ? LAYOUT.btnRX : LAYOUT.btnLX, cy = LAYOUT.btnY, ph = beatPhase(side), down = ph < 0.5, depth = down ? 16 * Math.sin(Math.PI * Math.min(1, ph * 2)) ** 0.5 : 0;
      const sc = inK * (strong ? 1.12 : 1) * (down ? 0.97 : 1.0);
      ctx.save(); ctx.translate(cx, cy + depth); ctx.scale(sc, sc);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * (down ? 0.95 : 0.5) * fade; const hs = 1.0 + (down ? 0.08 : 0); ctx.drawImage(G.halo[side], -450 * hs, -450 * hs, 900 * hs, 900 * hs);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A * fade; const b = G.btn[side][down ? 1 : 0]; ctx.drawImage(b, -b.width / 2, -b.height / 2);
      ctx.restore();
      // 押した瞬間の輪
      if (down && ph < 0.25) { const k = ph / 0.25; ctx.save(); ctx.translate(cx, cy + depth); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * (1 - k) * 0.7; const rs = 1.0 + k * 0.6; ctx.drawImage(G.halo[side], -450 * rs * inK, -450 * rs * inK, 900 * rs * inK, 900 * rs * inK); ctx.restore(); }
      // 下向きの矢印（実機のボタンはこの下にある）
      const ay = cy + 175 + 10 * Math.sin(t * TAU * 3 - side), al = A * fade * Math.min(1, inK), az = strong ? 84 : 70; ctx.globalAlpha = al; ctx.drawImage(G.arrow, cx - az / 2, ay - az / 2, az, az); ctx.globalAlpha = 1;   // 実機のボタンは液晶のこの下
    }
    // 玉：沈むたびに上へ飛ぶ（押すと玉が出る）
    for (const b of S.balls) { const u = (S.t - b.t0) / 0.55; if (u < 0 || u > 1) continue; const e = easeOut(u), x = b.x + b.vx * e, y = b.y - LAYOUT.rise * e, s = 1 - 0.35 * u; ctx.globalAlpha = A * (u > 0.7 ? (1 - u) / 0.3 : 1); ctx.drawImage(G.ball, x - 32 * s, y - 32 * s, 64 * s, 64 * s); } ctx.globalAlpha = 1;
    // 「連打」：叩きつけ（大→等倍、ゆれ）。強いときは0.9秒ごとに叩き直し、赤い光を足す
    const slamT = strong ? (t - S.slamAt) : t, k0 = clamp(slamT / 0.2), sl = 1 + (1 - easeOut(k0)) * (strong && S.slamAt > S.strongAt ? 0.35 : 1.4), beat = 1 + 0.035 * Math.sin(Math.PI * clamp(beatPhase(0) * 2) % Math.PI) * (t > 0.3 ? 1 : 0);
    const tw = G.txt.width, th = G.txt.height, tsc = Math.max(0.05, sl * beat * (strong ? 1.08 : 1)), flash = clamp(1 - slamT / 0.18);
    ctx.save(); ctx.translate(576, LAYOUT.textY); ctx.rotate(-0.05 * (1 - easeOut(k0))); ctx.scale(tsc, tsc);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * fade * (0.55 + 0.35 * (strong ? 0.5 + 0.5 * Math.sin(st * TAU * 3) : 0.5 + 0.5 * Math.sin(t * TAU * 1.4))); ctx.drawImage(strong ? G.glowR : G.glowY, -tw / 2, -th / 2);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A * fade * Math.min(1, t / 0.06 + 0.001); ctx.drawImage(G.txt, -tw / 2, -th / 2);
    if (flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * flash * 0.8; ctx.drawImage(G.glowY, -tw / 2, -th / 2); ctx.drawImage(G.txt, -tw / 2, -th / 2); }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.restore();
  };
  out.dispose = () => { out.reset(); };
  return out;
}
