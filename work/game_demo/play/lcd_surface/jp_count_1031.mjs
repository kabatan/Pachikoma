// 10/31 JPチャンス・継続チャンスの連打メーターの前の「3 → 2 → 1 → 連打」。
//   監督：始まるタイミングを明示する。実機水準の金字（FONT_REF_1031_goldpachi.png：白縁＋黒縁＋金の面＋銀の押し出し）、手本は逆シャア系の「押せ！」（炎字の叩きつけ）。音つき。
//   カウントダウンの間は規則が止める（medal_rules_h の stage==='count'：メーターの制限時間も、全体の時計も、連打の数えも動かさない）。
//   うぱ（upa_host/upa_guide）との受け渡し：うぱの説明は規則の stage==='tutorial' の間。うぱが「それじゃあいくよ！」を言い終えて game.endJpTutorial() を呼ぶ（既存）と、
//     規則が自動で stage==='count' に入り、ここがカウントダウンを出す。うぱが無効・説明なしのときは、導入（題字）が終わった直後に始まる。うぱ側に追加の呼び出しは要らない。
//   ?jpcount=0 で戻す（規則の MeterCountdownSeconds=0 ＝従来どおり、この部品は何も出さない）。?jpcount_sec=3.0 で全体の秒数。
//   液晶の層：lcd.jpHud.splitLayers に小さな層を足す（GPU 経路・2D 経路どちらでも見える。読み戻し・全画面転送なし）。字は起動時に一度だけ作る。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';

const PX = 34, PY = 28, WW = 1152, HH = 1268, TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---- 字：金の押し出し字（手本 FONT_REF_1031_goldpachi.png）。stops は面の縦グラデ。 ----
const GOLD = [[0, '#fffbd8'], [0.22, '#ffe45a'], [0.46, '#f3a30a'], [0.5, '#8a4a00'], [0.54, '#ffcb2e'], [0.82, '#ffb000'], [1, '#fff0a0']];
const HOT = [[0, '#fff6d0'], [0.25, '#ffd23a'], [0.46, '#ff7a14'], [0.5, '#7a1000'], [0.55, '#ff4a10'], [0.82, '#ff8a1c'], [1, '#ffe090']];
function glyph(str, size, stops, { font, depth = 0.085, pad = 0.35, skew = 0 } = {}) {
  const m = mk(8, 8).getContext('2d'); m.font = `${size}px ${font}`; const tw = m.measureText(str).width;
  const w = Math.ceil(tw + size * pad * 2), h = Math.ceil(size * (1 + pad * 1.6)), c = mk(w, h), x = c.getContext('2d');
  x.font = `${size}px ${font}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.translate(w / 2, h / 2 - size * 0.04); if (skew) x.transform(1, 0, skew, 1, 0, 0);
  // 押し出し（右下へ。銀と黒の縞＝クロームの光沢）
  const n = Math.round(size * depth), g = x.createLinearGradient(0, -size * 0.5, 0, size * 0.62);
  for (const [o, col] of [[0, '#1a1a1a'], [0.35, '#f2f2f2'], [0.5, '#5a5a5a'], [0.62, '#ffffff'], [0.8, '#3a3a3a'], [1, '#101010']]) g.addColorStop(o, col);
  for (let i = n; i >= 1; i--) { x.save(); x.translate(i * 0.55, i * 1.0); x.strokeStyle = g; x.lineWidth = size * 0.2; x.strokeText(str, 0, 0); x.restore(); }
  // 黒の外縁 → 白の縁 → 黒の細縁 → 金の面
  x.strokeStyle = '#0c0408'; x.lineWidth = size * 0.26; x.strokeText(str, 0, 0);
  x.strokeStyle = '#fbfbff'; x.lineWidth = size * 0.17; x.strokeText(str, 0, 0);
  x.strokeStyle = '#150808'; x.lineWidth = size * 0.07; x.strokeText(str, 0, 0);
  const f = x.createLinearGradient(0, -size * 0.5, 0, size * 0.5); for (const [o, col] of stops) f.addColorStop(o, col);
  x.fillStyle = f; x.fillText(str, 0, 0);
  // 面の上の縁の白い艶（細く、にじませる）
  x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.35; x.strokeStyle = '#fff6c8'; x.lineWidth = size * 0.014; x.filter = `blur(${Math.max(1, size * 0.006)}px)`; x.translate(-size * 0.012, -size * 0.016); x.strokeText(str, 0, 0); x.restore();
  return c;
}
const glow = (src, color, blurPx) => { const c = mk(src.width, src.height), x = c.getContext('2d'); x.filter = `blur(${blurPx}px)`; x.drawImage(src, 0, 0); x.filter = 'none'; x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); return c; };

export async function attachJpCount(lcd, { controller, log = () => {} } = {}) {
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  const SEC = qs.get('jpcount') === '0' ? 0 : Math.min(6, Math.max(1.2, +(qs.get('jpcount_sec') ?? 2.0)));
  if (!controller?.rules || lcd?.jpCount) return lcd;
  const setRules = () => { for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) r.MeterCountdownSeconds = SEC; };
  setRules();
  const offAct = controller.onAction?.((a) => { if (a === 'reset') setRules(); });
  if (SEC <= 0) { lcd.jpCount = { off: true, dispose() { offAct?.(); } }; return lcd; }

  // 4拍：3, 2, 1, 連打。割り当て（SEC=2.0 のとき 0.45/0.45/0.45/0.65。10/31 監督「もっとテンポ良く」で 3.0→2.0。3.0 秒版は ?jpcount_sec=3）
  const BEAT = [0, 0.45, 0.9, 1.35].map((v) => v * SEC / 2.0), BEND = SEC;
  const S = { seekPs: [], fxBeat: -1, manual: false, on: false, e: 0, beat: -1, fired: new Set(), clock: 0, frameN: 0, id: -1, events: [], spark: null, plays: 0 };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 40) S.events.shift(); log('jpcount:' + k, d); };

  // ---- 字と光の素材（起動時に一度） ----
  try { await document.fonts.load('200px "Dela Gothic One"'); } catch {}
  const FONT = '"Dela Gothic One", "Noto Sans CJK JP", sans-serif';
  const G = {};
  G.d3 = glyph('3', 560, GOLD, { font: FONT }); G.d2 = glyph('2', 560, GOLD, { font: FONT }); G.d1 = glyph('1', 560, GOLD, { font: FONT });
  G.go = glyph('連打', 330, HOT, { font: FONT, depth: 0.075, skew: -0.1 });
  // 10/31 Blender の金字（待機映像の字と同じ作り、work/effects/r4_h_fx/jp_start_1031/count_letters）。無ければ上の平らな字のまま
  const K = { d3: 0.95, d2: 0.95, d1: 0.95, go: 1.0 }; let GB = 40;
  if (qs.get('jpcount_flat') !== '1') {
    const bbox = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let y0 = c.height, y1 = 0, x0 = c.width, x1 = 0; for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 40) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; } return { w: x1 - x0, h: y1 - y0 }; };
    const load = async (n) => { try { const im = new Image(); im.src = new URL(`./count_1031/${n}.png`, import.meta.url).href; await im.decode(); const c = mk(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); return c; } catch { return null; } };
    const S3 = await load('c3'), S2 = await load('c2'), S1 = await load('c1'), SG = await load('crenda');
    if (S3 && S2 && S1 && SG) {
      // 数字は幅 820（液晶の幅 1152 の 7 割強。3 の幅で揃え、字の板の大きさは全部同じ）、開始は幅 1050。k は字の板の幅（窓の幅 WW に対する比）
      const b3 = bbox(S3), f = 820 / b3.w, fitW = (c, tw) => (tw / bbox(c).w) * c.width / WW;
      G.d3 = S3; G.d2 = S2; G.d1 = S1; G.go = SG; K.d3 = K.d2 = K.d1 = f * S3.width / WW; K.go = fitW(SG, 1050);
      GB = 44 / f;
    }
  }
  const GL = { d3: glow(G.d3, 'rgba(255,200,60,1)', GB), d2: glow(G.d2, 'rgba(255,190,50,1)', GB), d1: glow(G.d1, 'rgba(255,170,40,1)', GB), go: glow(G.go, 'rgba(255,90,20,1)', GB * 1.2) };
  // 光の溜まり・輪・筋（すべてにじませた柔らかい光）
  const flashC = mk(288, 317); { const x = flashC.getContext('2d'), g = x.createRadialGradient(144, 150, 4, 144, 150, 190); g.addColorStop(0, 'rgba(255,252,235,1)'); g.addColorStop(0.3, 'rgba(255,215,110,0.75)'); g.addColorStop(1, 'rgba(255,140,30,0)'); x.fillStyle = g; x.fillRect(0, 0, 288, 317); }
  const ringC = mk(256, 256); { const x = ringC.getContext('2d'); x.filter = 'blur(5px)'; const g = x.createRadialGradient(128, 128, 70, 128, 128, 116); g.addColorStop(0, 'rgba(255,210,110,0)'); g.addColorStop(0.7, 'rgba(255,235,170,0.9)'); g.addColorStop(1, 'rgba(255,160,50,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
  const rayC = mk(256, 256); { const t = mk(256, 256), x = t.getContext('2d'); x.translate(128, 128); let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU + (r() - 0.5) * 0.1, len = 90 + r() * 38, w = 0.012 + r() * 0.03; x.save(); x.rotate(a); const g = x.createLinearGradient(8, 0, len, 0); g.addColorStop(0, 'rgba(255,255,240,0.95)'); g.addColorStop(0.35, 'rgba(255,215,120,0.55)'); g.addColorStop(1, 'rgba(255,150,40,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(8, 0); x.lineTo(len, -len * w); x.lineTo(len, len * w); x.closePath(); x.fill(); x.restore(); }
    const bx = rayC.getContext('2d'); bx.filter = 'blur(1.6px)'; bx.drawImage(t, 0, 0); }
  const SPW = 576, SPH = 634, spC = mk(SPW, SPH), spx = spC.getContext('2d');
  // 実写の炎・光の筋・火の粉（CC-BY の配布素材、出典は count_1031/CREDITS.txt）。黒地を加算で重ねる。無ければ出さない。
  const loadVid = async (n) => { try { const r = await fetch(new URL(`./count_1031/${n}.mp4`, import.meta.url)); if (!r.ok) return null; const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = true; v.src = URL.createObjectURL(await r.blob()); await new Promise((res) => { const d = () => res(); v.addEventListener('loadeddata', d, { once: true }); v.addEventListener('error', d, { once: true }); setTimeout(d, 3000); v.load(); }); return v.readyState >= 2 ? v : null; } catch { return null; } };
  const V = qs.get('jpcount_fx') === '0' ? {} : { fl: await loadVid('fx_flame'), fr: await loadVid('fx_flare'), em: await loadVid('fx_embers') };
  const solid = (c) => { const x = mk(8, 8); const g = x.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8); return x; };
  const flameC = mk(576, 634), flx = flameC.getContext('2d');
  const FXT = { dark: layerTexture(THREE, solid('#000')), white: layerTexture(THREE, solid('#fff')), fl: layerTexture(THREE, flameC) };
  if (V.fr) FXT.fr = layerTexture(THREE, V.fr); if (V.em) FXT.em = layerTexture(THREE, V.em);
  const flMask = (() => { const c = mk(576, 634), x = c.getContext('2d'), g = x.createRadialGradient(288, 317, 40, 288, 317, 300); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 576, 634); return c; })();
  const driveFx = (b, t) => {   // 拍ごとに素材の頭から。manual（試験の手送り）は時刻へ seek、実機は拍の頭で再生し直す
    for (const [key, v] of Object.entries(V)) {
      if (!v) continue; const tv = Math.min(t, (v.duration || 2) - 0.05);
      if (S.manual) { if (Math.abs(v.currentTime - tv) > 1e-4) { try { v.currentTime = tv; } catch {} S.seekPs.push(new Promise((res) => { v.addEventListener('seeked', res, { once: true }); setTimeout(res, 400); })); } }
      else if (S.fxBeat !== b) { try { v.currentTime = 0; v.play().catch(() => {}); } catch {} }
    }
    S.fxBeat = b;
    if (V.fl) { flx.globalCompositeOperation = 'source-over'; flx.clearRect(0, 0, 576, 634); const vw = V.fl.videoWidth || 448, vh = V.fl.videoHeight || 448; flx.drawImage(V.fl, 0, 0, vw, vh, -40, 0, 656, 634); flx.globalCompositeOperation = 'destination-in'; flx.drawImage(flMask, 0, 0); FXT.fl.needsUpdate = true; }
  };
  const T = { d3: layerTexture(THREE, G.d3), d2: layerTexture(THREE, G.d2), d1: layerTexture(THREE, G.d1), go: layerTexture(THREE, G.go), g3: layerTexture(THREE, GL.d3), g2: layerTexture(THREE, GL.d2), g1: layerTexture(THREE, GL.d1), gg: layerTexture(THREE, GL.go),
    flash: layerTexture(THREE, flashC), ring: layerTexture(THREE, ringC), ray: layerTexture(THREE, rayC), sp: layerTexture(THREE, spC) };
  (lcd.splitWarmers ??= []).push({ name: 'jpcount', done: false, step(r) { for (const t of [...Object.values(T), ...Object.values(FXT)]) { try { r.initTexture(t); } catch {} } return (this.done = true); } });

  // ---- 音（hotBus。3拍は金のベルの上昇、開始は大きな衝撃＋明るい和音＋空気を切る音） ----
  const eng = () => globalThis.__r2Audio?.engine;
  const tone = (ctx, out, t, f, g, dur, type = 'sine') => { const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.004); e.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(e).connect(out); o.start(t); o.stop(t + dur + 0.02); o.onended = () => { try { o.disconnect(); e.disconnect(); } catch {} }; };
  const noiseBuf = (ctx) => { if (!S.nb) { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; S.nb = b; } return S.nb; };
  const sound = (k) => {
    try {
      const e = eng(), ctx = e?.ctx; if (!ctx) return; const t = ctx.currentTime + 0.012, out = ctx.createGain(); out.gain.value = 10 ** ((k === 3 ? -1.8 : -3) / 20);
      // JP曲・他の音（hotBus）を拍ごとに絞り、カウントダウンの音は絞られない出口（master の入口）へ直接入れる
      const hot = hotBus(e); if (!e.__jpcDirect) { const g = ctx.createGain(); g.gain.value = hot.gain.value; g.connect(e.master); e.__jpcDirect = g; e.__jpcBase = hot.gain.value; }
      out.connect(e.__jpcDirect); setTimeout(() => { try { out.disconnect(); } catch {} }, 2500);
      { const hg = hot.gain, base = e.__jpcBase; hg.cancelScheduledValues(t); hg.setValueAtTime(hg.value, t); hg.linearRampToValueAtTime(base * (k === 3 ? 0.3 : 0.45), t + 0.01); hg.linearRampToValueAtTime(base * (k === 3 ? 0.3 : 0.45), t + (k === 3 ? 0.35 : 0.12)); hg.linearRampToValueAtTime(base, t + (k === 3 ? 0.8 : 0.4)); }
      // 低い落下（ドン）
      const o = ctx.createOscillator(), env = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(k === 3 ? 120 : 100, t); o.frequency.exponentialRampToValueAtTime(34, t + (k === 3 ? 0.35 : 0.22));
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(k === 3 ? 1.0 : 0.8, t + 0.004); env.gain.exponentialRampToValueAtTime(0.001, t + (k === 3 ? 0.55 : 0.3)); o.connect(env).connect(out); o.start(t); o.stop(t + 0.6);
      // 打ち込みの高い面（短い広帯域の叩き）
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf(ctx); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; const ne = ctx.createGain(); ne.gain.setValueAtTime(k === 3 ? 0.7 : 0.45, t); ne.gain.exponentialRampToValueAtTime(0.001, t + (k === 3 ? 0.5 : 0.12)); ns.connect(hp).connect(ne).connect(out); ns.start(t, Math.random() * 0.5); ns.stop(t + 0.6);
      if (k < 3) { const f = [392, 440, 523.25][k]; tone(ctx, out, t, f * 2, 0.5, 0.42); tone(ctx, out, t, f * 3, 0.25, 0.3); tone(ctx, out, t + 0.02, f * 4.01, 0.12, 0.22); }   // 3 → 2 → 1 は金のベルが上がる
      else {   // 開始：大きな和音（完全5度＋オクターブ）と空気を切る上昇音
        [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => tone(ctx, out, t + i * 0.012, f, 0.42 - i * 0.07, 0.9, 'sawtooth'));
        const sw = ctx.createBufferSource(); sw.buffer = noiseBuf(ctx); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(600, t - 0.0); bp.frequency.exponentialRampToValueAtTime(9000, t + 0.35); const se = ctx.createGain(); se.gain.setValueAtTime(0.5, t); se.gain.exponentialRampToValueAtTime(0.001, t + 0.5); sw.connect(bp).connect(se).connect(out); sw.start(t, 0.1); sw.stop(t + 0.55);
        // 10/31 音付け：連打は最後にいちばん大きく。地を揺らす低音、長く尾を引くシンバル（広帯域のノイズ）、連打を促す小刻みな打音（約 25 回/秒 × 10）
        { const bo = ctx.createOscillator(), be = ctx.createGain(); bo.type = 'sine'; bo.frequency.setValueAtTime(58, t); bo.frequency.exponentialRampToValueAtTime(28, t + 0.9); be.gain.setValueAtTime(0, t); be.gain.linearRampToValueAtTime(0.9, t + 0.006); be.gain.exponentialRampToValueAtTime(0.001, t + 1.0); bo.connect(be).connect(out); bo.start(t); bo.stop(t + 1.05); }
        { const cn = ctx.createBufferSource(); cn.buffer = noiseBuf(ctx); const ch = ctx.createBiquadFilter(); ch.type = 'highpass'; ch.frequency.value = 3800; const ce = ctx.createGain(); ce.gain.setValueAtTime(0.5, t + 0.01); ce.gain.exponentialRampToValueAtTime(0.001, t + 1.7); cn.connect(ch).connect(ce).connect(out); cn.start(t, 0.2); cn.stop(t + 1.75); }
        for (let i = 0; i < 10; i++) { const tt = t + 0.3 + i * 0.04; tone(ctx, out, tt, 1760 + (i % 2) * 220, 0.22, 0.03, 'square'); }
      }
      S.plays++;
    } catch (err) { console.warn('[jpcount-snd]', err); }
  };

  // ---- 場面の追跡：規則の meterStatus.stage==='count' の間だけ ----
  const track = (dt) => {
    S.clock += dt; S.frameN++;
    const st = controller.game?.meterStatus, on = !!st && st.stage === 'count';
    if (on) {
      const e = clamp(st.countSeconds - st.countLeft, 0, st.countSeconds || SEC);
      if (!S.on) { S.on = true; S.fired = new Set(); S.spark = null; note('start', { kind: st.kind, sec: st.countSeconds }); }
      S.e = e * (SEC / (st.countSeconds || SEC));
      let b = 0; for (let i = 0; i < 4; i++) if (S.e >= BEAT[i] - 1e-6) b = i; S.beat = b;
      if (!S.fired.has(b)) { S.fired.add(b); sound(b === 3 ? 3 : b); note('beat', { b }); if (b === 3) S.sparkAt = S.frameN; }
    } else if (S.on) {
      // 開始の字は、規則が撃てるようにした後も 0.4秒だけ余韻として残す
      if (!S.out) { S.out = S.frameN; S.outT = 0; }
      S.outT += dt; if (S.outT > 0.45) { S.on = false; S.out = 0; S.beat = -1; }
    }
  };

  // ---- 揺れ・層 ----
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const win = (tex, w, h, wx, wy, k, alpha, add, ox = 0, oy = 0, rot = 0) => { const s = WW / w; return { tex, w, h, ax: w / 2, ay: h / 2, x: PX + wx + ox, y: PY + wy + oy, rot, sc: s * k, alpha, add }; };
  const CY = 560;   // 字の中心（窓座標。右上の全体の時計・下の札と重ならない画面の中央）
  const drawSparks = (tt) => {
    if (!S.spark) { let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; S.spark = Array.from({ length: 70 }, () => ({ a: r() * TAU, v: 500 + r() * 1400, l: 0.25 + r() * 0.4, w: 2.5 + r() * 6, g: r() < 0.3, c: r() < 0.5 ? '255,214,100' : r() < 0.5 ? '255,250,230' : '255,140,50' })); }
    spx.clearRect(0, 0, SPW, SPH); spx.globalCompositeOperation = 'lighter'; spx.lineCap = 'round';
    for (const p of S.spark) { if (tt > p.l) continue; const pos = (u) => { const d = p.v * (1 - Math.exp(-u * 6)) / 6; return [(576 + Math.cos(p.a) * d) / 2, (CY + Math.sin(p.a) * d * 0.8 + 380 * u * u) / 2]; };
      const [x1, y1] = pos(tt), [x0, y0] = pos(Math.max(0, tt - 0.035)), k = 1 - tt / p.l;
      if (p.g) { const r = (12 + p.w * 3) * k + 3, g = spx.createRadialGradient(x1, y1, 0, x1, y1, r); g.addColorStop(0, `rgba(${p.c},${0.95 * k})`); g.addColorStop(1, `rgba(${p.c},0)`); spx.fillStyle = g; spx.fillRect(x1 - r, y1 - r, r * 2, r * 2); }
      else { spx.strokeStyle = `rgba(${p.c},${0.9 * k})`; spx.shadowColor = `rgba(${p.c},0.9)`; spx.shadowBlur = 8; spx.lineWidth = p.w * 0.5 * (0.4 + 0.6 * k); spx.beginPath(); spx.moveTo(x0, y0); spx.lineTo(x1, y1); spx.stroke(); spx.shadowBlur = 0; } }
    T.sp.needsUpdate = true;
  };
  const shakeXY = () => {
    if (!S.on || S.beat < 0) return [0, 0];
    const t = S.e - BEAT[S.beat], amp = (S.beat === 3 ? 30 : 14) * Math.exp(-t / 0.12); if (S.out) return [0, 0];
    return amp > 0.3 ? [(hash(S.frameN) - 0.5) * 2 * amp, (hash(S.frameN + 977) - 0.5) * 1.4 * amp] : [0, 0];
  };
  const splitLayers = () => {
    if (!S.on || S.beat < 0) return null;
    const out = [], [dx, dy] = shakeXY(), b = S.beat, t = S.e - BEAT[b], dur = (b === 3 ? BEND : BEAT[b + 1]) - BEAT[b];
    const tail = S.out ? S.outT : 0;   // 規則が撃てるようにした後（開始の余韻）
    const A = (tex, w, h, k, al, add, rot = 0, wy = CY, wx = 576) => { if (tex && al > 0.01) out.push(win(tex, w, h, wx, wy, k, al, add, dx, dy, rot)); };
    driveFx(b, Math.max(0, t));
    const pulse = 0.82 + 0.18 * Math.sin(t * 24);
    if (b < 3) {
      // 拍ごとに画面が瞬間で切り替わる（暗幕＋白閃）。数字は 1.9 倍から 0.07 秒で叩きつけ、少し傾いて収まる。実写の炎を後ろ、光の筋を後ろ、火の粉を手前に重ねる
      const key = ['d3', 'd2', 'd1'][b], gk = ['g3', 'g2', 'g1'][b], tex = T[key], img = G[key], ww = img.width, hh = img.height;
      const slam = t < 0.07 ? 1.9 - 0.9 * easeOut(t / 0.07) : 1 + 0.05 * Math.exp(-(t - 0.07) * 10) * Math.cos((t - 0.07) * 34);
      const rot = t < 0.07 ? -0.07 * (1 - t / 0.07) : 0.012 * Math.exp(-(t - 0.07) * 8) * Math.sin((t - 0.07) * 30);
      const lastU = clamp((t - (dur - 0.07)) / 0.07), al = clamp(t / 0.012) * (1 - lastU), k = K[key] * slam * (1 + 0.012 * Math.sin(t * 5));
      const heat = [0.55, 0.75, 0.95][b];
      A(FXT.dark, 8, 8, 1.3, (0.8 - 0.07 * b) * clamp(t / 0.012) * (1 - lastU * 0.6), false);
      A(FXT.white, 8, 8, 1.3, 0.85 * Math.exp(-t / 0.035), true);                         // 白閃（2 コマ）
      A(FXT.fr, 448, 448, 1.35 + 0.15 * b, 0.9 * Math.exp(-t / 0.5) * heat, true, t * 0.25 * (b % 2 ? -1 : 1));   // 光の筋（実写）
      A(FXT.fl, 576, 634, 1.7, heat * al * pulse, true, 0, CY + 60);                      // 炎（実写）
      A(T[gk], ww, hh, K[key], 0.5 * al * pulse, true, rot);                              // 字の後ろの発光
      A(tex, ww, hh, k, al, false, rot);
      A(FXT.em, 640, 360, 1.8, 0.9 * al, true, 0, CY - 40);                               // 火の粉（実写・手前）
      const ru = clamp(t / 0.3); if (ru > 0 && ru < 1) A(T.ring, 256, 256, 2.2 + 4.6 * easeOut(ru), 0.8 * (1 - ru) ** 1.6, true);
    } else {
      // 開始：画面全体の白閃 → 大きく叩きつけ（3.4 倍→1）、炎・光の筋・火の粉・衝撃の輪二つ・放射の筋が最大、揺れも最大
      const img = G.go, ww = img.width, hh = img.height;
      const slam = t < 0.12 ? 3.4 - 2.4 * easeOut(t / 0.12) : 1 + 0.07 * Math.exp(-(t - 0.12) * 7) * Math.cos((t - 0.12) * 26);
      const rot = t < 0.12 ? 0.1 * (1 - t / 0.12) : -0.015 * Math.exp(-(t - 0.12) * 6) * Math.sin((t - 0.12) * 24);
      const hold = tail > 0 ? tail / 0.45 : 0, al = clamp(t / 0.01) * (1 - hold * hold), k = K.go * slam * (1 + 0.5 * hold * hold) * (1 + 0.012 * Math.sin(t * 6));
      A(FXT.dark, 8, 8, 1.3, 0.7 * clamp(t / 0.01) * (1 - hold), false);
      A(FXT.white, 8, 8, 1.3, 1.0 * Math.exp(-t / 0.12), true);                            // 画面全体の閃光
      A(T.flash, 288, 317, 3.6, 1.0 * Math.exp(-t / 0.25), true);
      A(FXT.fr, 448, 448, 2.4, 1.0 * Math.exp(-t / 0.7), true, t * 0.3);
      A(FXT.fr, 448, 448, 1.5, 0.8 * Math.exp(-t / 0.9), true, -t * 0.45);
      if (t < 0.9) { A(T.ray, 256, 256, 2.6 + 4.2 * easeOut(clamp(t / 0.6)), 1.0 * (1 - clamp(t / 0.9)) ** 1.4, true, t * 0.3); A(T.ray, 256, 256, 1.8 + 3 * easeOut(clamp(t / 0.6)), 0.8 * (1 - clamp(t / 0.9)) ** 1.4, true, -t * 0.5 + 0.4); }
      A(FXT.fl, 576, 634, 1.95, 1.0 * al * pulse, true, 0, CY + 60);
      A(T.gg, ww, hh, K.go, 0.8 * al * pulse, true, rot);
      A(T.go, ww, hh, k, al, false, rot);
      A(FXT.em, 640, 360, 2.2, 1.0 * al, true, 0, CY - 40);
      const ru = clamp(t / 0.6); if (ru < 1) A(T.ring, 256, 256, 2.0 + 7.5 * easeOut(ru), 1.0 * (1 - ru) ** 1.3, true);
      const r2 = clamp((t - 0.1) / 0.6); if (r2 > 0 && r2 < 1) A(T.ring, 256, 256, 1.5 + 6 * easeOut(r2), 0.8 * (1 - r2) ** 1.3, true);
      if (t < 0.6) { if (S.sparkT !== S.frameN) { S.sparkT = S.frameN; drawSparks(t); } out.push({ tex: T.sp, w: SPW, h: SPH, ax: 0, ay: 0, x: PX + dx, y: PY + dy, rot: 0, sc: 2, alpha: 1, add: true }); }
    }
    return out;
  };
  let hooked = false;
  const hook2 = () => {
    if (hooked || !lcd.jpHud?.splitLayers) return;
    const o = lcd.jpHud.splitLayers.bind(lcd.jpHud);
    lcd.jpHud.splitLayers = () => { const a = o(), b = splitLayers(); return a && b ? [...a, ...b] : (a ?? b); };
    hooked = true;
  };
  const man0 = lcd.setManual?.bind(lcd), prep0 = lcd.prepare?.bind(lcd);
  if (man0) lcd.setManual = (on) => { S.manual = !!on; if (on) for (const v of Object.values(V)) { try { v?.pause(); } catch {} } return man0(on); };
  if (prep0) lcd.prepare = async (dt) => { const r = await prep0(dt); if (S.manual && S.seekPs.length) { const a = S.seekPs; S.seekPs = []; await Promise.all(a); } return r; };
  const frame0 = lcd.frame.bind(lcd);
  lcd.frame = (dt, F) => { hook2(); const r = frame0(dt, F); track(dt); return r; };
  // 揺れ：jp_start の baseXform に足す（無ければ単独）
  const prev = lcd.jpStart?.baseXform;
  const base = () => { const [sx, sy] = shakeXY(), p = prev?.() ?? null; return sx || sy ? { x: (p?.x ?? 0) + sx, y: (p?.y ?? 0) + sy } : p; };
  if (lcd.jpStart) lcd.jpStart.baseXform = base; else lcd.jpCountBase = base;
  lcd.jpCount = { state: S, splitLayers, sec: SEC, dispose() { offAct?.(); lcd.frame = frame0; for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) r.MeterCountdownSeconds = 0; if (lcd.jpStart) lcd.jpStart.baseXform = prev; lcd.jpCount = null; } };
  note('attached', { sec: SEC });
  return lcd;
}
