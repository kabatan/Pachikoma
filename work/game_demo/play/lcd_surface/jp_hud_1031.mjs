// 10/31 JPチャンス（連打メーター中）の「残り個数＋残り時間の札」と「焦りの演出」。計画（jp_plan ③④）の部品を、GPU の液晶経路に乗る小さな層で出す。
//   ?jphud=0 で無し（旧：液晶 canvas への重ね描き＝GPU の映像経路では見えない）。?jphud_snd=0 で音（心拍）無し。?jphud_led=0 で囲いの赤い光無し。
//
// 札（jp3/card：吊り鎖の金縁の札・Blender 2x）：「あと◯個」＋「SS.cc」。上から鎖で降りて弾む。入賞のたびに数字が替わり、火花が散る。外れの穴では小さく揺れる。
// 焦り（meterStatus.timeLeft・まだ足りないとき）：
//   10秒以下 ……札がゆっくり脈打つ・縁が橙
//    5秒以下 ……心拍（ドクン・ドクン）に合わせて札が赤く脈動、数字が赤橙、画面の縁が赤く脈打ち、左右の警告灯（回転灯）が回り始める、囲いが赤く脈打つ、低い鼓動音
//    3秒以下 ……心拍が速くなる、警告灯が強く、札が震える、「ブオン」の警報音
//  1.5秒以下 ……さらに速く・最大
//   背景（竜宮・封印の扉）は染めない。前面の札・縁・警告灯だけ。穴のLEDには一切触れない（監督 10/31）。
// 層は lcd.jpHud.splitLayers() が返し、play_fx が lcd_split_1030 の合成器へ渡す（液晶 canvas へは描かない・全面転送なし）。動かない絵は一度だけ送り、動きは行列だけ。
//   動く小さな canvas は 数字（650x230）と 火花（380x240、入賞の間だけ）。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
import { registerGrammar, hsvTo } from '../../../effects/cabinet_light_script/flash_fx_20261029.mjs';
import { NL_SCENES } from '../../../effects/cabinet_light_script/newlight_1030.mjs';
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';

const PX = 34, PY = 28, W = 1152, H = 1268;
const TAU = Math.PI * 2, clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const frac = (x) => x - Math.floor(x);
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
const PLATE_OFS = { x: 240, y: 0 };          // 札の画像の左上（液晶 1152x1268 の座標）
const PIVOT = { x: 580, y: 0 };
const BASE = { sc: 0.78, dx: -209 };         // 札の置き場所：左寄せ・0.78倍（右上の全体の時計 x656〜1152・y102〜512 を避ける）               // 吊りの支点（札の揺れ・弾みの中心）
const GR = { x: 250, y: 130, w: 650, h: 230 };   // 数字の canvas の置き場所（液晶座標）
const FX = { x: 200, y: 20, w: 760, h: 500, k: 0.5 };   // 火花の canvas（半分の解像度で作り、2倍に伸ばす）
// 札の中の数字の置き方（札 1x 座標。jp3/card/src/v05/compose.py と同じ。液晶座標は 2 倍）
const LAY = { a: [152, 104, .68], to: [184, 104, .68], count: [226, 132, .84], ko: [262, 150, .74], clock: { c: [371, 130], s: .88, adv: 29, dadv: 15 } };
// 焦りの段（残り秒）。心拍の周期（秒）と強さ
export const PANIC = { l1: 10, l2: 5, l3: 3, l4: 1.5, period: [0, 1.2, 0.9, 0.62, 0.5], power: [0, 0.22, 0.6, 0.9, 1.0] };
export function panicLevel(st) {
  if (!st || st.stage !== 'firing' || !(st.threshold > 0) || st.count >= st.threshold) return 0;
  const t = st.timeLeft;
  return t <= PANIC.l4 ? 4 : t <= PANIC.l3 ? 3 : t <= PANIC.l2 ? 2 : t <= PANIC.l1 ? 1 : 0;
}
// 心拍：拍の頭から tL 秒の「ドクン(強)・ドクン(弱)」。0..1.4
export function heart(tL, P) {
  const dubAt = 0.26 * P, a = Math.min(1, tL / 0.025);
  return a * Math.exp(-tL / 0.12) + (tL >= dubAt ? 0.65 * Math.min(1, (tL - dubAt) / 0.025) * Math.exp(-(tL - dubAt) / 0.12) : 0);
}

// ---- 囲いの光（8区画 head,gills,logo,pillarL_up,pillarL_low,pillarR_up,pillarR_low,bottom）。穴のLEDには触れない（holeOn=false のまま） ----
const RED = [1, .03, .04], AMB = [1, .3, .02], WHITE = [1, .85, .75];
const reg = (o, i, L, c) => { o.aK[i] = L; o.aC[i * 3] = c[0]; o.aC[i * 3 + 1] = c[1]; o.aC[i * 3 + 2] = c[2]; };
function panicLamp(o, c) {
  const x = c.x || {}, lv = x.lvl | 0 || 1, P = PANIC.period[lv] || 1, pw = PANIC.power[lv];
  o.abs = true; o.holeOn = false; o.hv.fill(0); o.aK.fill(0); for (let j = 0; j < 4; j++) o.aR[j] = 0; o.gain = 1; o.white = 0; o.floor = 0;
  const h = heart(frac((x.beat ?? c.clock) / P) * P, P);
  const col = lv === 1 ? AMB : RED;
  // 頭と足は心拍に合わせて強く、左右の柱は回転灯のように上下へ流れる
  for (let i = 0; i < 8; i++) { const sweep = .5 + .5 * Math.cos(TAU * (c.clock * (.9 + .3 * lv) - [0, .04, .08, .8, .65, .2, .35, .5][i])); reg(o, i, (.08 + 1.0 * pw * h + .3 * pw * sweep), col); }
  // 液晶の見える範囲へ回り込む光(rings・white)は出さない：背景（竜宮）を染めない
  for (let j = 0; j < 4; j++) o.aR[j] = 0;
  o.white = 0;
}
registerGrammar('nl_jp_panic', panicLamp);
NL_SCENES.jp_panic = 'nl_jp_panic';

// ---- 音（心拍の低い音・警報の「ブオン」）。r2 エンジンの hotBus へ WebAudio で合成（素材なし） ----
function sfx(engine, kind, vol = -9) {
  try {
    const ctx = engine?.ctx; if (!ctx) return;
    const out = ctx.createGain(); out.gain.value = 10 ** (vol / 20); out.connect(hotBus(engine));
    const t0 = ctx.currentTime + 0.01;
    const tone = (f0, f1, dur, g, type = 'sine') => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * .8);
      e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(g, t0 + 0.006); e.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      o.connect(e).connect(out); o.start(t0); o.stop(t0 + dur + 0.05); o.onended = () => { try { o.disconnect(); e.disconnect(); } catch { } };
    };
    if (kind === 'lub') { tone(70, 38, .22, 1.0); tone(140, 60, .09, .35, 'triangle'); }
    else if (kind === 'dub') { tone(58, 34, .2, .7); }
    else if (kind === 'buon') { tone(150, 88, .3, .32, 'sawtooth'); tone(75, 55, .3, .5); }
    setTimeout(() => { try { out.disconnect(); } catch { } }, 1200);
  } catch { }
}

export async function attachJpHud(lcd, { controller, log = () => { } } = {}) {
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  if (qs.get('jphud') === '0' || qs.get('jphud') === 'off') return lcd;
  if (!lcd?.production || lcd.jpHud || !lcd.jp) return lcd;
  const SND = qs.get('jphud_snd') !== '0', LED = qs.get('jphud_led') !== '0';
  const A = new URL('./jp_hud_assets_1031/', import.meta.url);
  const sets = {};
  const loadSet = async (style, size) => {
    const d = new URL(`glyphs/${style}/${size}/`, A), meta = await (await fetch(new URL('glyphs.json', d))).json();
    const imgs = {}; await Promise.all(Object.entries(meta.glyphs).map(async ([ch, g]) => { imgs[ch] = await img(new URL(g.file, d).href); }));
    return { meta, imgs };
  };
  let plateI, warnI, emitI;
  try {
    [plateI, warnI, emitI] = await Promise.all(['plate', 'plate_warn', 'plate_emit'].map((n) => img(new URL(n + '.png', A).href)));
    for (const st of ['gold', 'ember']) for (const sz of ['big', 'clk']) (sets[st] ??= {})[sz] = await loadSet(st, sz);
  } catch (e) { console.warn('[jp-hud] assets', e); return lcd; }
  const model = lcd.jp.model;
  let CD = null;   // 残り3・2・1秒の巨大な数字（ember 面の立体数字・Blender SCALE=8）
  try { const d = new URL('count_digits/', A), meta = await (await fetch(new URL('glyphs.json', d))).json(); CD = { meta, imgs: {} }; for (const k of ['1', '2', '3']) CD.imgs[k] = await img(new URL(meta.glyphs[k].file, d).href); } catch (e) { CD = null; console.warn('[jp-hud] countdown assets', e); }
  const S = { on: false, t: 0, show: 0, enterAt: -9, exitAt: -9, clock: 0, lastCount: 0, countChange: null, hitAt: -9, missAt: -9, lvl: 0, beatT: 0, beatIdx: -1, dubDone: true, cue: false, fx: [], shownKey: null, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 60) S.events.shift(); log('jphud:' + k, d); };

  // ---- 動かない絵の texture ----
  const T = { plate: layerTexture(THREE, plateI), warn: layerTexture(THREE, warnI), emit: layerTexture(THREE, emitI) };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // 縁の赤（中は透明・縁へ向かって濃く）
  const vigC = mk(288, 317); { const x = vigC.getContext('2d'), g = x.createRadialGradient(144, 158, 40, 144, 158, 215);
    g.addColorStop(0, 'rgba(160,0,8,0)'); g.addColorStop(0.6, 'rgba(170,0,10,0.0)'); g.addColorStop(0.82, 'rgba(210,6,14,0.62)'); g.addColorStop(1, 'rgba(130,0,6,0.97)'); x.fillStyle = g; x.fillRect(0, 0, 288, 317); }
  T.vig = layerTexture(THREE, vigC);
  // 警告灯の光束（回転灯。光源のにじみ＋にじんだ扇形の光）
  const beamC = mk(900, 900); { const x = beamC.getContext('2d'), tmp = mk(900, 900), t = tmp.getContext('2d');
    const g = t.createRadialGradient(450, 450, 10, 450, 450, 430); g.addColorStop(0, 'rgba(255,90,60,0.95)'); g.addColorStop(0.35, 'rgba(255,40,30,0.55)'); g.addColorStop(1, 'rgba(255,20,10,0)');
    t.fillStyle = g; t.beginPath(); t.moveTo(450, 450); t.arc(450, 450, 430, -0.36, 0.36); t.closePath(); t.fill();
    x.filter = 'blur(26px)'; x.drawImage(tmp, 0, 0); x.filter = 'none';
    const lg = x.createRadialGradient(450, 450, 0, 450, 450, 120); lg.addColorStop(0, 'rgba(255,230,210,0.95)'); lg.addColorStop(0.3, 'rgba(255,70,50,0.7)'); lg.addColorStop(1, 'rgba(255,20,10,0)'); x.fillStyle = lg; x.fillRect(330, 330, 240, 240); }
  T.beam = layerTexture(THREE, beamC);
  // 数字・火花の動く canvas
  const gC = mk(GR.w, GR.h), gx = gC.getContext('2d'); T.glyph = layerTexture(THREE, gC);
  const fC = mk(FX.w * FX.k, FX.h * FX.k), fx = fC.getContext('2d'); T.fx = layerTexture(THREE, fC);
  if (CD) for (const k of ['1', '2', '3']) T['cd' + k] = layerTexture(THREE, CD.imgs[k]);
  // 火花のにじみ素材（輪郭を持たない柔らかい点）
  const spr = {}; for (const [k, c] of Object.entries({ w: '255,250,230', y: '255,210,90', o: '255,130,30', r: '255,50,20' })) {
    const s = mk(64, 64), x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(0.35, `rgba(${c},0.55)`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.fillRect(0, 0, 64, 64); spr[k] = s; }

  // ---- 数字を描く ----
  const putGlyph = (set, size, ch, cx, cy, s, k = 1, al = 1, dy = 0) => {
    const m = sets[set][size], g = m.meta.glyphs[ch], im = m.imgs[ch]; if (!g || !im) return;
    const sc = m.meta.scale || 1, w = g.w * s * 2 / sc, h = g.h * s * 2 / sc;
    const ccx = cx * 2 - GR.x, ccy = cy * 2 - GR.y + dy;                          // 文字の中心(原点)の液晶座標
    const x = (g.ox * s) * 2, y = (g.oy * s) * 2;
    gx.save(); gx.globalAlpha = al; gx.translate(ccx, ccy); gx.scale(k, k);
    gx.shadowColor = 'rgba(0,0,0,.55)'; gx.shadowBlur = 8 * k; gx.shadowOffsetY = 3;
    gx.drawImage(im, x, y, w, h); gx.restore();
  };
  const drawGlyphs = (st, lvl, heartV, pw) => {
    gx.clearRect(0, 0, GR.w, GR.h);
    const set = lvl >= 2 ? 'ember' : 'gold', need = Math.max(0, st.threshold - st.count);
    putGlyph(set, 'big', 'あ', LAY.a[0], LAY.a[1], LAY.a[2]); putGlyph(set, 'big', 'と', LAY.to[0], LAY.to[1], LAY.to[2]);
    // 個数：替わった直後 0.35 秒は、古い数字が下へ落ち、新しい数字が大きく叩きつけられる
    const cc = S.countChange, a = cc ? S.clock - cc.at : 9;
    if (cc && a < 0.35) {
      const u = clamp(a / 0.35);
      putGlyph(set, 'big', String(cc.from), LAY.count[0], LAY.count[1], LAY.count[2], 1, 1 - clamp(a / 0.12), clamp(a / 0.12) * 40);
      const pop = a < 0.1 ? 2.2 - 1.2 * (a / 0.1) ** 2 : 1 + 0.18 * Math.exp(-(a - 0.1) * 12) * Math.cos((a - 0.1) * 34);
      putGlyph(set, 'big', String(need), LAY.count[0], LAY.count[1], LAY.count[2], pop, clamp(a / 0.05));
    } else putGlyph(set, 'big', String(need), LAY.count[0], LAY.count[1], LAY.count[2], 1 + (lvl >= 2 ? 0.07 * pw * heartV : 0));
    putGlyph(set, 'big', '個', LAY.ko[0], LAY.ko[1], LAY.ko[2]);
    // 時計 SS.cc
    const tl = Math.max(0, st.timeLeft), ss = Math.min(99, Math.floor(tl)), cc2 = Math.floor((tl - Math.floor(tl)) * 100) % 100;
    const txt = String(ss).padStart(2, '0') + '.' + String(cc2).padStart(2, '0'), C = LAY.clock, adv = C.adv * C.s, dadv = C.dadv * C.s, tot = 4 * adv + dadv;
    const ks = 1 + (lvl >= 2 ? (0.1 + 0.08 * (lvl - 2)) * heartV * pw : 0);
    let x = C.c[0] - tot / 2;
    for (const ch of txt) {
      if (ch === '.') { putGlyph(set, 'clk', '.', x + dadv / 2, C.c[1], C.s, ks); x += dadv; }
      else { putGlyph(set, 'clk', ch, x + adv / 2, C.c[1], C.s, ks); x += adv; }
    }
    T.glyph.needsUpdate = true;
  };

  // ---- 火花（入賞） ----
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const burst = () => {
    const ox = LAY.count[0] * 2, oy = LAY.count[1] * 2;
    for (let i = 0; i < 46; i++) { const a = R() * TAU, v = 240 + R() * 620; S.fx.push({ k: 's', at: S.clock, x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: .45 + R() * .5, r: 7 + R() * 12 }); }
    for (let i = 0; i < 16; i++) S.fx.push({ k: 'f', at: S.clock, x: 330 + R() * 360, y: 400 + R() * 12, vx: (R() - .5) * 90, vy: -(140 + R() * 220), life: .7 + R() * .5, r: 36 + R() * 40 });
    S.fx.push({ k: 'b', at: S.clock, x: ox, y: oy, life: .5, r: 190 });
  };
  const drawFx = () => {
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, fC.width, fC.height); fx.globalCompositeOperation = 'lighter'; fx.setTransform(FX.k, 0, 0, FX.k, 0, 0);
    S.fx = S.fx.filter((p) => S.clock - p.at < p.life);
    for (const p of S.fx) {
      const a = S.clock - p.at, u = a / p.life, x = p.x - FX.x, y = p.y - FX.y;
      if (p.k === 'b') { const r = p.r * (0.6 + .9 * easeOut(u)); fx.globalAlpha = (1 - u) ** 2 * .95; fx.drawImage(spr.w, x - r, y - r, r * 2, r * 2); fx.globalAlpha = (1 - u) * .6; fx.drawImage(spr.o, x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8); }
      else if (p.k === 's') { const px = x + p.vx * a * (1 - .35 * u), py = y + p.vy * a * (1 - .35 * u) + 500 * a * a, r = p.r * (1 - .7 * u); const c = u < .3 ? spr.w : u < .65 ? spr.y : spr.o;
        fx.globalAlpha = (1 - u) * .95; fx.drawImage(c, px - r, py - r, r * 2, r * 2); fx.globalAlpha = (1 - u) * .4; fx.drawImage(c, px - p.vx * .02 - r, py - p.vy * .02 - r, r * 2, r * 2); }
      else { const px = x + p.vx * a + Math.sin(a * 9 + p.x) * 14, py = y + p.vy * a, r = p.r * (1 - .5 * u) * (0.8 + .2 * Math.sin(a * 30 + p.x)); fx.globalAlpha = Math.min(1, u * 8) * (1 - u) * .7; fx.drawImage(u < .35 ? spr.y : u < .7 ? spr.o : spr.r, px - r, py - r * 1.3, r * 2, r * 2.6); }
    }
    fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over'; T.fx.needsUpdate = true;
  };

  // ---- 状態の更新（毎フレーム。lcd.frame の後ろ）----
  const eng = () => globalThis.__r2Audio?.engine;
  const baseFrame = lcd.frame.bind(lcd);
  const offAct = controller.onAction((action) => {
    const e = controller.lastGameEvent ?? {};
    if (action === 'meterLand' && e.hit === false) { S.missAt = S.clock; note('miss'); }
    else if (action === 'meterReady') { S.lastCount = 0; S.countChange = null; S.fx.length = 0; S.beatIdx = -1; }
  });
  const setCue = (on, x) => { const api = lcd.cabinetLightScript; if (!api?.cue) return; if (on) { api.cue('jp_panic', 0, x); S.cue = true; } else if (S.cue) { api.cue(null); S.cue = false; } };
  lcd.frame = (dt, F) => {
    const r = baseFrame(dt, F);
    try { update(dt); } catch (e) { console.warn('[jp-hud]', e); S.on = false; S.show = 0; }
    return r;
  };
  const update = (dt) => {
    S.clock += dt;
    const g = controller.game, st = g.meterStatus, name = model.active ? (model.name ?? '') : '';
    let want = !!st && (st.kind === 'jp' || st.kind === 'chain') && st.stage === 'firing' && st.count < st.threshold && /^(jp_aim|chain_jp_aim)/.test(name) && !/_open$/.test(name);
    if (want && /_in$/.test(name) && (model.time ?? 0) < 1.5) want = false;   // 「封印解除!!」の叩きつけが済んでから札が降りる
    if (want && !S.on) { S.on = true; S.enterAt = S.clock; S.exitAt = -9; S.lastCount = st.count | 0; S.countChange = null; S.fx.length = 0; note('enter', { name }); }
    else if (!want && S.on) { S.on = false; S.exitAt = S.clock; note('exit', { name, count: st?.count }); setCue(false); }
    S.name = name;
    if (!S.on && S.clock - S.exitAt > 0.4) { S.show = 0; S.st = null; S.lvl = 0; setCue(false); return; }
    S.show = 1;
    if (S.on) {
      S.st = { threshold: st.threshold, count: st.count, timeLeft: st.timeLeft };
      const c = st.count | 0;
      if (c > S.lastCount) { S.countChange = { at: S.clock, from: Math.max(0, st.threshold - S.lastCount) }; S.hitAt = S.clock; burst(); note('hit', { count: c }); }
      S.lastCount = c;
      const lvl = panicLevel(st); if (lvl !== S.lvl) { note('level', { lvl, t: +st.timeLeft.toFixed(2) }); }
      S.lvl = lvl;
      // 心拍
      if (lvl >= 1) {
        const P = PANIC.period[lvl]; S.beatT += dt; if (S.beatT >= P) { S.beatT -= P; S.dubDone = false; if (lvl >= 2 && SND) { sfx(eng(), 'lub'); if (lvl >= 3) sfx(eng(), 'buon', -13); } }
        if (!S.dubDone && S.beatT >= 0.26 * P) { S.dubDone = true; if (lvl >= 2 && SND) sfx(eng(), 'dub'); }
      } else { S.beatT = 0; S.dubDone = true; }
      if (LED && lvl >= 2) setCue(true, { lvl, beat: S.beatT + 0 }); else setCue(false);
    }
    // 数字・火花の canvas
    const st2 = S.st; if (st2) { const lvl = S.lvl, P = PANIC.period[lvl] || 1, h = lvl >= 1 ? heart(S.beatT, P) : 0; drawGlyphs(st2, lvl, h, PANIC.power[lvl]); }
    if (S.fx.length || S.fxDirty) { drawFx(); S.fxDirty = S.fx.length > 0; }
  };

  // ---- 層（下から）：縁の赤・左右の警告灯・札（札・赤い札・発光・数字）・火花 ----
  const place = (tex, w, h, lx, ly, grp, extra = {}) => {   // 札の座標 (lx,ly)=画像の左上（液晶座標）を、支点まわりの動き grp で置く
    const c = Math.cos(grp.rot), s = Math.sin(grp.rot), dx = (lx - PIVOT.x) * grp.sc, dy = (ly - PIVOT.y) * grp.sc;
    return { tex, w, h, ax: 0, ay: 0, x: PX + PIVOT.x + c * dx - s * dy + grp.dx, y: PY + PIVOT.y + s * dx + c * dy + grp.dy, rot: grp.rot, sc: grp.sc, alpha: 1, add: false, ...extra };
  };
  const splitLayers = () => {
    if (!S.show) return null;
    const ck = S.clock, lvl = S.lvl, P = PANIC.period[lvl] || 1, pw = PANIC.power[lvl], h = lvl >= 1 ? heart(S.beatT, P) : 0;
    const out = [];
    // 札の動き：降りてきて弾む／上へ引き上がる
    const grp = { dx: BASE.dx, dy: 0, rot: 0.006 * Math.sin(ck * 1.3), sc: BASE.sc };   // 右上の「残り◯秒」（ゲーム全体の時計）に重ならない位置へ寄せる
    let vis = 1;
    if (S.on) {
      const u = ck - S.enterAt, T1 = 0.32;
      if (u < T1) { grp.dy = -440 * (1 - (u / T1) ** 2); grp.rot += 0.03 * (1 - u / T1); }
      else { const v = u - T1; grp.dy = 16 * Math.exp(-v * 8) * Math.cos(v * 26); grp.rot += 0.05 * Math.exp(-v * 3) * Math.sin(v * 9); }
    } else { const v = clamp((ck - S.exitAt) / 0.35); grp.dy = -440 * v * v; vis = 1 - v * v; }
    const ha = ck - S.hitAt; if (ha < 0.4) grp.dy += 12 * Math.exp(-ha * 14) * Math.cos(ha * 40);   // 入賞：札が弾む
    const ma = ck - S.missAt; if (ma < 0.45) { grp.dx += Math.sin(ma * 85) * 12 * Math.exp(-ma * 9); grp.rot += Math.sin(ma * 60) * 0.02 * Math.exp(-ma * 9); }   // 外れ：小さく揺れる
    grp.sc *= 1 + (lvl >= 1 ? 0.05 * pw * h + (lvl === 1 ? 0.012 * (.5 + .5 * Math.sin(ck * TAU * 0.9)) : 0) : 0);
    if (lvl >= 3) { grp.dx += Math.sin(ck * 53) * 3 * pw; grp.dy += Math.cos(ck * 47) * 2 * pw; }
    // 縁の赤・警告灯（前面のみ。背景は染めない）
    if (lvl >= 1 && S.on) {
      const va = lvl === 1 ? 0.2 + 0.2 * Math.sin(ck * TAU * 0.9) ** 2 : clamp(0.12 + 0.85 * pw * h + 0.2 * pw);
      out.push({ tex: T.vig, w: 288, h: 317, ax: 0, ay: 0, x: PX, y: PY, rot: 0, sc: 4, alpha: clamp(va), add: false });
      if (lvl >= 2) {
        const al = clamp(0.55 + 0.6 * pw * (0.4 + 0.6 * h)), rot = ck * TAU * (0.8 + 0.25 * lvl);
        out.push({ tex: T.beam, w: 900, h: 900, ax: 450, ay: 450, x: PX + 20, y: PY + 1010, rot, sc: 1.5, alpha: al, add: true });
        out.push({ tex: T.beam, w: 900, h: 900, ax: 450, ay: 450, x: PX + W - 20, y: PY + 1010, rot: rot + Math.PI * 0.9, sc: 1.5, alpha: al, add: true });
      }
    }
    // 札
    out.push(place(T.plate, 684, 416, PLATE_OFS.x, PLATE_OFS.y, grp, { alpha: vis }));
    const wa = lvl >= 2 ? clamp(0.25 + 0.75 * pw * (0.4 + 0.6 * h)) : lvl === 1 ? 0.12 * (.5 + .5 * Math.sin(ck * TAU * 0.9)) : 0;
    if (wa > 0.01) out.push(place(T.warn, 684, 416, PLATE_OFS.x, PLATE_OFS.y, grp, { alpha: wa * vis }));
    const ea = clamp(0.12 + 0.9 * Math.exp(-(ck - S.hitAt) * 6) + (lvl >= 2 ? 0.5 * pw * h : 0));
    out.push(place(T.emit, 684, 416, PLATE_OFS.x, PLATE_OFS.y, grp, { alpha: ea * vis, add: true }));
    out.push(place(T.glyph, GR.w, GR.h, GR.x, GR.y, grp, { alpha: vis }));
    // 残り3秒から：巨大な数字が毎秒叩きつけられる（心拍と同じ拍で脈打つ）
    if (CD && S.on && S.st && lvl >= 3) {
      const n = Math.ceil(S.st.timeLeft - 1e-6), tx = T['cd' + n];
      if (tx && n >= 1 && n <= 3) {
        const u = n - S.st.timeLeft, g = CD.meta.glyphs[String(n)], hh = 640 / g.h, slam = u < 0.12 ? 1.8 - 0.8 * (u / 0.12) ** 2 : 1 + 0.06 * h * pw - 0.05 * clamp((u - .12) / .8);
        out.push({ tex: tx, w: g.w, h: g.h, ax: g.w / 2, ay: g.h / 2, x: PX + W / 2 + Math.sin(u * 90) * 10 * Math.exp(-u * 12), y: PY + 700, rot: 0, sc: hh * slam, alpha: 0.9 * Math.min(1, u / 0.03) * (0.85 + 0.15 * h), add: false });
      }
    }
    if (S.fx.length) out.push({ tex: T.fx, w: fC.width, h: fC.height, ax: 0, ay: 0, x: PX + FX.x, y: PY + FX.y, rot: 0, sc: 1 / FX.k, alpha: 1, add: true });
    return out;
  };
  (lcd.splitWarmers ??= []).push({ name: 'jphud', done: false, step(r) { for (const t of Object.values(T)) { try { r.initTexture(t); } catch { } } return (this.done = true); } });
  lcd.jpHud = { splitLayers, state: S, get active() { return !!S.show; }, panicLevel, dispose() { offAct?.(); lcd.frame = baseFrame; setCue(false); lcd.jpHud = null; } };
  note('attached');
  return lcd;
}
