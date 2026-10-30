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
const BASE = { sc: 0.95, dx: -247 };         // 札の置き場所：左寄せ・0.78倍（右上の全体の時計 x656〜1152・y102〜512 を避ける）               // 吊りの支点（札の揺れ・弾みの中心）
const TX = { x: 0, y: 650, w: 1152, h: 270 }, MT = { x: 0, y: 905, w: 1152, h: 360 };   // 時間・個数の字の canvas／矢印メーターの canvas（液晶座標）   // 数字の canvas の置き場所（液晶座標）
const FX = { x: 0, y: 0, w: 1152, h: 1268, k: 0.4 };   // 炎・火花の canvas（0.4倍の解像度で作り、伸ばす。入賞・カウントの間だけ更新）
const CK = { x: 196, y: 880, w: 760, h: 300 };    // 巨大な残り時間の canvas（4A の手本のように画面の1割超の高さ。札とも右上の全体の時計とも重ならない画面下）
// 札の中の数字の置き方（札 1x 座標。jp3/card/src/v05/compose.py と同じ。液晶座標は 2 倍）
const LAY = { a: [150, 106, .86], to: [190, 106, .86], count: [236, 134, 1.02], ko: [282, 152, .86], clock: { c: [371, 130], s: .88, adv: 29, dadv: 15 } };
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
  for (let i = 0; i < 8; i++) { const sweep = .5 + .5 * Math.cos(TAU * (c.clock * (.9 + .3 * lv) - [0, .04, .08, .8, .65, .2, .35, .5][i])); reg(o, i, (.08 + 1.0 * pw * h + .3 * pw * sweep) * (globalThis.__jpLedGain ?? 1), col); }
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
  globalThis.__jpLedGain = qs.get('jphud_ledg') ? +qs.get('jphud_ledg') : 0.35;   // 囲いの赤が液晶の扉を桃色にくすませないよう弱める（0.35。測定 10/31）
  const SND = qs.get('jphud_snd') !== '0', LED = qs.get('jphud_led') !== '0';
  const A = new URL('./jp_hud_assets_1031/', import.meta.url);
  const FIRE = await img(new URL('fx/fire_9049.jpg', A).href).catch(() => null);   // 実写の炎（Pixabay 9049, chris2far・黒地・加算で使う）。6x3 の 384x335 のコマ
  const A2 = new URL('./jp_hud2_assets_1031/', import.meta.url), H2 = {};
  try {
    const names = ['chev_off', 'chev_on', 'chev_glow', 'tube', 'lab_a', 'lab_to', 'lab_ko', 'lab_colon', 'lab_dot']; for (const v of 'nw') for (let d = 0; d < 10; d++) names.push(`d${d}_${v}`);
    await Promise.all(names.map(async (n) => { H2[n] = await img(new URL(n + '.png', A2).href); }));
    H2.meta = await (await fetch(new URL('meta.json', A2))).json();
  } catch (e) { console.warn('[jp-hud] assets', e); return lcd; }
  const model = lcd.jp.model;
  // 10/31 制限時間・「あと◯個」の字：北斗無双 第5章（4A）の作りで焼いた画像（hud3_timer/src/bake_t2.py）。?jptimer=old で旧版の字へ
  let NEWT = qs.get('jptimer') !== 'old'; const T2 = {};
  if (NEWT) try {
    const names = ['a', 'to', 'ko', 'colon_n', 'colon_w']; for (let d = 0; d < 10; d++) names.push(`c${d}`, `d${d}_n`, `d${d}_w`);
    await Promise.all(names.map(async (n) => { T2[n] = await img(new URL(`t2_${n}.png`, A2).href); }));
    T2.meta = await (await fetch(new URL('t2_meta.json', A2))).json(); Object.assign(TX, { y: TX.y - 40, h: 330 });   // 字が大きく傾くので canvas を縦に広げる（下端の位置は変えない）
  } catch (e) { console.warn('[jp-hud] timer2 assets', e); NEWT = false; }
  let CD = null;   // 残り3・2・1秒の巨大な数字（ember 面の立体数字・Blender SCALE=8）
  try { const d = new URL('count_digits/', A), meta = await (await fetch(new URL('glyphs.json', d))).json(); CD = { meta, imgs: {} }; for (const k of ['1', '2', '3']) CD.imgs[k] = await img(new URL(meta.glyphs[k].file, d).href); } catch (e) { CD = null; console.warn('[jp-hud] countdown assets', e); }
  const S = { on: false, t: 0, show: 0, enterAt: -9, exitAt: -9, clock: 0, lastCount: 0, countChange: null, hitAt: -9, missAt: -9, lvl: 0, beatT: 0, beatIdx: -1, dubDone: true, cue: false, fx: [], shownKey: null, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 60) S.events.shift(); log('jphud:' + k, d); };

  // ---- 動かない絵の texture ----
  const T = {};
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // 縁の赤（中は透明・縁へ向かって濃く）
  const vigC = mk(288, 317); { const x = vigC.getContext('2d'); x.save(); x.translate(144, 158.5); x.scale(1, 317 / 288); const g = x.createRadialGradient(0, 0, 20, 0, 0, 150);
    g.addColorStop(0, 'rgba(160,0,8,0)'); g.addColorStop(0.76, 'rgba(170,0,10,0.0)'); g.addColorStop(0.9, 'rgba(225,8,16,0.38)'); g.addColorStop(0.97, 'rgba(235,10,16,0.85)'); g.addColorStop(1, 'rgba(170,0,8,1.0)'); x.fillStyle = g; x.fillRect(-150, -170, 300, 340); x.restore(); }   // 縁へ向かって赤くなる（四辺とも。中央は透明）
  T.vig = layerTexture(THREE, vigC);
  // 警告灯の光束（回転灯。光源のにじみ＋にじんだ扇形の光）
  const beamC = mk(900, 900); { const x = beamC.getContext('2d'), tmp = mk(900, 900), t = tmp.getContext('2d');
    const g = t.createRadialGradient(450, 450, 10, 450, 450, 430); g.addColorStop(0, 'rgba(255,90,60,0.95)'); g.addColorStop(0.35, 'rgba(255,40,30,0.55)'); g.addColorStop(1, 'rgba(255,20,10,0)');
    t.fillStyle = g; t.beginPath(); t.moveTo(450, 450); t.arc(450, 450, 430, -0.36, 0.36); t.closePath(); t.fill(); t.beginPath(); t.moveTo(450, 450); t.arc(450, 450, 430, Math.PI - 0.36, Math.PI + 0.36); t.closePath(); t.fill();   // 二灯の回転灯（180°反対に光束が出る）
    x.filter = 'blur(26px)'; x.drawImage(tmp, 0, 0); x.filter = 'none';
    const lg = x.createRadialGradient(450, 450, 0, 450, 450, 120); lg.addColorStop(0, 'rgba(255,230,210,0.95)'); lg.addColorStop(0.3, 'rgba(255,70,50,0.7)'); lg.addColorStop(1, 'rgba(255,20,10,0)'); x.fillStyle = lg; x.fillRect(330, 330, 240, 240); }
  T.beam = layerTexture(THREE, beamC);
  // 数字・火花の動く canvas
  const tC = mk(TX.w, TX.h), tx = tC.getContext('2d'); T.txt = layerTexture(THREE, tC);
  const mC = mk(MT.w, MT.h), mt = mC.getContext('2d'); T.met = layerTexture(THREE, mC);
  const fC = mk(FX.w * FX.k, FX.h * FX.k), fx = fC.getContext('2d'); T.fx = layerTexture(THREE, fC);
  if (CD) for (const k of ['1', '2', '3']) T['cd' + k] = layerTexture(THREE, CD.imgs[k]);
  // 火花のにじみ素材（輪郭を持たない柔らかい点）
  const spr = {}; for (const [k, c] of Object.entries({ w: '255,250,230', y: '255,210,90', o: '255,130,30', r: '255,50,20' })) {
    const s = mk(64, 64), x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(0.35, `rgba(${c},0.55)`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.fillRect(0, 0, 64, 64); spr[k] = s; }

  // ---- 数字・メーターを描く（北斗無双「無双チャージ」の並び：上段=あと◯個＋SS:cc、下段=矢印メーター）----
  const timeText = (st) => { const tl = Math.max(0, st.timeLeft), ss = Math.min(99, Math.floor(tl)), cc = Math.floor((tl - Math.floor(tl)) * 100) % 100; return String(ss).padStart(2, '0') + ':' + String(cc).padStart(2, '0'); };
  const dg = (c, im, x, y, sc, al = 1, shadow = 10) => { const w = im.width * sc, h = im.height * sc; c.save(); c.globalAlpha = al; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = shadow; c.shadowOffsetY = 4; c.drawImage(im, x - w / 2, y - h / 2, w, h); c.restore(); };
  const DS = 0.80, ADV = 0.80;
  const drawTextNew = (st, lvl, heartV, pw) => {   // 4A「5個チャージしろ 05:90」：右へ約5.5°上がる並び、数字は白地＋黄緑＋赤の染み／黒縁＋右下の押し出し、ラベルと個数は暗い赤の面
    tx.clearRect(0, 0, TX.w, TX.h);
    const cy = TX.h * 0.52, k = 1 + (lvl >= 2 ? (0.06 + 0.06 * (lvl - 2)) * heartV * pw : lvl === 1 ? 0.012 * Math.sin(S.clock * TAU * 0.9) : 0);
    tx.save(); tx.translate(TX.w / 2, cy); tx.rotate(-0.096);
    { tx.save(); tx.scale(1, 0.3); const hg = tx.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.6)'); hg.addColorStop(0.6, 'rgba(14,0,22,.36)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); tx.fillStyle = hg; tx.fillRect(-600, -600, 1200, 1200); tx.restore(); }   // 字の後ろの柔らかい暗がり（縁なし）
    const m = T2.meta, v = lvl >= 2 ? 'w' : 'n', DS = 1.03, FOX = (m.cw - m.dx) / 2 + 1, FOY = 12 + m.hf / 2;   // 面の中心（画像内）
    const put = (im, x, y, sc, ox, oy, al = 1) => { tx.globalAlpha = al; tx.drawImage(im, x - ox * sc, y - oy * sc, im.width * sc, im.height * sc); tx.globalAlpha = 1; };
    // 右：SS:cc（右端で揃える）
    { const adv = 118 * DS, cwid = 72 * DS, tot = 4 * adv + cwid + 6; let x = TX.w / 2 - 46 - tot;
      const txt = timeText(st);
      for (let i = 0, di = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (ch === ':') { const sc = DS * k; put(T2['colon_' + v], x + cwid / 2, 0, sc, (m.colon[0] - m.dx) / 2, FOY); x += cwid; }
        else { const sc = DS * k * (1 + 0.035 * (di - 1.5)); put(T2['d' + ch + '_' + v], x + adv / 2, 0, sc, FOX, FOY); x += adv; di++; }
      } }
    // 左：あと ◯ 個
    { const need = Math.max(0, st.threshold - st.count), cc = S.countChange, a = cc ? S.clock - cc.at : 9, LS = 0.74, CS = 0.86, ly = 32;
      let lx = -TX.w / 2 + 34; const ctr = (im, w, y) => put(im, lx + w / 2, y, LS, im.width / 2, im.height / 2);
      for (const n of ['a', 'to']) { const im = T2[n], w = im.width * LS; put(im, lx + w / 2, ly, LS, im.width / 2, im.height / 2); lx += w * 0.9; }
      lx += 6; const nw = 118 * CS, ox = (m.cw - m.dx) / 2, oy = FOY, cyn = ly - 6;
      if (cc && a < 0.35) {
        const old = T2['c' + cc.from], f = clamp(a / 0.12); if (old && f < 1) put(old, lx + nw / 2, cyn + f * 50, CS * 1.08, ox, oy, 1 - f);
        const pop = a < 0.1 ? 2.1 - 1.1 * (a / 0.1) ** 2 : 1 + 0.16 * Math.exp(-(a - 0.1) * 12) * Math.cos((a - 0.1) * 34);
        put(T2['c' + need], lx + nw / 2, cyn, CS * 1.08 * pop, ox, oy, clamp(a / 0.05));
      } else put(T2['c' + need], lx + nw / 2, cyn, CS * 1.08 * (1 + (lvl >= 2 ? 0.07 * pw * heartV : 0)), ox, oy);
      lx += nw + 6; { const im = T2.ko, w = im.width * LS; put(im, lx + w / 2, ly, LS, im.width / 2, im.height / 2); } }
    tx.restore(); T.txt.needsUpdate = true;
  };
  const drawTextOld = (st, lvl, heartV, pw) => {
    tx.clearRect(0, 0, TX.w, TX.h);
    { tx.save(); tx.translate(TX.w / 2, TX.h * 0.52); tx.scale(1, 0.34); const hg = tx.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.66)'); hg.addColorStop(0.6, 'rgba(14,0,22,.4)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); tx.fillStyle = hg; tx.fillRect(-600, -600, 1200, 1200); tx.restore(); }   // 字の後ろの柔らかい暗がり（縁なし）。白飛びでも読める
    const v = lvl >= 2 ? 'w' : 'n', cy = TX.h * 0.52, k = 1 + (lvl >= 2 ? (0.06 + 0.06 * (lvl - 2)) * heartV * pw : lvl === 1 ? 0.012 * Math.sin(S.clock * TAU * 0.9) : 0);
    // 右：SS:cc（右端で揃える）
    const dw = H2.d0_n.width * DS * ADV, cw = H2.lab_colon.width * DS * 0.62, tot = 4 * dw + cw; let x = TX.w - 46 - tot * k;
    for (const ch of timeText(st)) {
      if (ch === ':') { dg(tx, H2.lab_colon, x + cw * k / 2, cy + 6, DS * 0.95 * k); x += cw * k; }
      else { dg(tx, H2['d' + ch + '_' + v], x + dw * k / 2, cy, DS * k); x += dw * k; }
    }
    // 左：あと ◯ 個
    const need = Math.max(0, st.threshold - st.count), cc = S.countChange, a = cc ? S.clock - cc.at : 9, LS = 0.66;
    let lx = 40;
    dg(tx, H2.lab_a, lx + H2.lab_a.width * LS / 2, cy + 34, LS); lx += H2.lab_a.width * LS * 0.92;
    dg(tx, H2.lab_to, lx + H2.lab_to.width * LS / 2, cy + 34, LS); lx += H2.lab_to.width * LS + 16;
    const nw = H2.d0_n.width * DS * 1.08;
    if (cc && a < 0.35) {
      const old = H2['d' + cc.from + '_' + v]; const f = clamp(a / 0.12); if (old && f < 1) dg(tx, old, lx + nw / 2, cy + f * 50, DS * 1.08, 1 - f);
      const pop = a < 0.1 ? 2.1 - 1.1 * (a / 0.1) ** 2 : 1 + 0.16 * Math.exp(-(a - 0.1) * 12) * Math.cos((a - 0.1) * 34);
      dg(tx, H2['d' + need + '_' + v], lx + nw / 2, cy, DS * 1.08 * pop, clamp(a / 0.05));
    } else dg(tx, H2['d' + need + '_' + v], lx + nw / 2, cy, DS * 1.08 * (1 + (lvl >= 2 ? 0.07 * pw * heartV : 0)));
    lx += nw + 12;
    dg(tx, H2.lab_ko, lx + H2.lab_ko.width * LS / 2, cy + 34, LS);
    T.txt.needsUpdate = true;
  };
  const drawText = (st, lvl, heartV, pw) => (NEWT ? drawTextNew(st, lvl, heartV, pw) : drawTextOld(st, lvl, heartV, pw));
  const meterLayout = (N) => { const s = clamp(1040 / ((N - 1) * 184 + 260), 0.7, 1.3), adv = 184 * s, w = (N - 1) * adv + 260 * s, x0 = (MT.w - w) / 2; return { s, adv, w, x0, cy: MT.h / 2 + 4 }; };
  const chevC = (i, N) => { const L = meterLayout(N); return { x: MT.x + L.x0 + i * L.adv + 130 * L.s, y: MT.y + L.cy }; };
  const drawMeter = (st, lvl, heartV, pw) => {
    mt.clearRect(0, 0, MT.w, MT.h);
    { mt.save(); mt.translate(MT.w / 2, MT.h * 0.52); mt.scale(1, 0.4); const hg = mt.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.6)'); hg.addColorStop(0.65, 'rgba(14,0,22,.34)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); mt.fillStyle = hg; mt.fillRect(-600, -600, 1200, 1200); mt.restore(); }
    const N = clamp(st.threshold | 0, 1, 6), fill = clamp(st.count | 0, 0, N), L = meterLayout(N), h2 = 0.5 * H2.chev_on.width / H2.meta.chev[0];   // 画像は 2x
    const cvw = H2.chev_on.width * 0.5 * L.s, cvh = H2.chev_on.height * 0.5 * L.s, ck = S.clock;
    // 上の鋼管
    { const tw = L.w + 70 * L.s, th = 30 * L.s; mt.save(); mt.shadowColor = 'rgba(0,0,0,.6)'; mt.shadowBlur = 12; mt.shadowOffsetY = 5; mt.drawImage(H2.tube, L.x0 - 35 * L.s, L.cy - cvh / 2 + 26 * L.s - th * 0.5, tw, th); mt.restore(); }
    const cc = S.countChange, a = cc ? ck - cc.at : 9;
    for (let i = 0; i < N; i++) {
      const lit = i < fill, cx = L.x0 + i * L.adv + 130 * L.s, cyy = L.cy;
      const pop = lit && i === fill - 1 && a < 0.5 ? 1 + 0.16 * Math.exp(-a * 9) * Math.cos(a * 30) : 1;
      mt.save(); mt.translate(cx, cyy); mt.scale(pop, pop); mt.shadowColor = 'rgba(0,0,0,.6)'; mt.shadowBlur = 14; mt.shadowOffsetY = 6;
      mt.drawImage(lit ? H2.chev_on : H2.chev_off, -cvw / 2, -cvh / 2, cvw, cvh); mt.restore();
      if (lit) {
        const fl = 0.8 + 0.2 * Math.sin(ck * 23 + i * 1.7) + 0.1 * Math.sin(ck * 41 + i);
        mt.save(); mt.globalCompositeOperation = 'lighter'; mt.translate(cx, cyy); mt.scale(pop, pop);
        mt.globalAlpha = 0.45 * fl; mt.drawImage(H2.chev_glow, -cvw / 2, -cvh / 2, cvw, cvh);
        if (i === fill - 1 && a < 0.35) { mt.globalAlpha = 0.9 * (1 - a / 0.35); mt.drawImage(H2.chev_on, -cvw / 2, -cvh / 2, cvw, cvh); }
        mt.restore();
      } else if (lvl >= 2) {   // まだ灯っていない矢印が、心拍に合わせて赤く脈打つ（早く灯せ）
        mt.save(); mt.globalCompositeOperation = 'lighter'; mt.translate(cx, cyy); mt.globalAlpha = clamp(0.5 * pw * (0.3 + 0.7 * heartV)); mt.drawImage(H2.chev_glow, -cvw / 2, -cvh / 2, cvw, cvh); mt.restore();
      }
    }
    T.met.needsUpdate = true;
  };

  // ---- 火花・炎（入賞・カウント） ----
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const plateXY = (lx, ly) => ({ x: PIVOT.x + (lx - PIVOT.x) * BASE.sc + BASE.dx, y: PIVOT.y + (ly - PIVOT.y) * BASE.sc });
  const burst = () => {
    const N = clamp((S.st?.threshold | 0) || 4, 1, 6), o = chevC(clamp((S.st?.count | 0) - 1, 0, N - 1), N), top = { x: o.x, y: o.y - 20 };
    S.fx.push({ k: 'F', at: S.clock, x: top.x, y: top.y + 60, size: 1300, life: 0.9, al: 1.0 });   // 実写の炎が画面いっぱいに噴き上がる（北斗無双の入賞の手本）
    S.fx.push({ k: 'F', at: S.clock + 0.06, x: W * 0.22, y: top.y + 90, size: 1000, life: 0.85, al: 0.85 }); S.fx.push({ k: 'F', at: S.clock + 0.1, x: W * 0.78, y: top.y + 90, size: 1000, life: 0.85, al: 0.85 });
    S.fx.push({ k: 'F', at: S.clock + 0.03, x: W / 2, y: H * 0.78, size: 1500, life: 1.0, al: 0.75 });
    for (let i = 0; i < 46; i++) { const a = R() * TAU, v = 240 + R() * 620; S.fx.push({ k: 's', at: S.clock, x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: .45 + R() * .5, r: 7 + R() * 12 }); }
    S.fx.push({ k: 'b', at: S.clock, x: o.x, y: o.y, life: .4, r: 150 });
  };
  const tickFx = (n) => {   // 3→2→1：叩きつけの光と炎
    S.tickAt = S.clock;
    S.fx.push({ k: 'F', at: S.clock, x: W / 2, y: 760, size: 1250, life: 0.6, al: 0.7 });
    S.fx.push({ k: 'b', at: S.clock, x: W / 2, y: 700, life: .45, r: 460 });
    for (let i = 0; i < 40; i++) { const a = R() * TAU, v = 400 + R() * 800; S.fx.push({ k: 's', at: S.clock, x: W / 2, y: 700, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .4 + R() * .5, r: 8 + R() * 14 }); }
  };
  const fm = mk(384, 335), fmx = fm.getContext('2d');
  const fireFrame = (u, size, al) => {   // 実写の炎のコマを、縁をなじませて fx へ
    if (!FIRE) return;
    const idx = 1 + Math.min(14, Math.floor(u * 15)), cx0 = (idx % 6) * 384, cy0 = Math.floor(idx / 6) * 335;
    fmx.globalCompositeOperation = 'source-over'; fmx.clearRect(0, 0, 384, 335); fmx.drawImage(FIRE, cx0, cy0, 384, 335, 0, 0, 384, 335);
    fmx.globalCompositeOperation = 'destination-in'; const g = fmx.createRadialGradient(192, 167, 40, 192, 167, 190); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.65, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)'); fmx.fillStyle = g; fmx.fillRect(0, 0, 384, 335);
    return { al, size };
  };
  const drawFx = () => {
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, fC.width, fC.height); fx.globalCompositeOperation = 'lighter'; fx.setTransform(FX.k, 0, 0, FX.k, 0, 0);
    S.fx = S.fx.filter((p) => S.clock - p.at < p.life);
    for (const p of S.fx) {
      const a = S.clock - p.at, u = a / p.life, x = p.x - FX.x, y = p.y - FX.y;
      if (p.k === 'F') { const r = fireFrame(u, p.size, p.al); if (r) { const w = p.size, h = p.size * 335 / 384; fx.globalAlpha = p.al * Math.min(1, u * 10) * (1 - u) ** 0.8; fx.drawImage(fm, x - w / 2, y - h * 0.62, w, h); } }
      else if (p.k === 'b') { const r = p.r * (0.6 + .9 * easeOut(u)); fx.globalAlpha = (1 - u) ** 2 * .95; fx.drawImage(spr.w, x - r, y - r, r * 2, r * 2); fx.globalAlpha = (1 - u) * .6; fx.drawImage(spr.o, x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8); }
      else if (p.k === 's') { const px = x + p.vx * a * (1 - .35 * u), py = y + p.vy * a * (1 - .35 * u) + 500 * a * a, r = p.r * (1 - .7 * u); const c = u < .3 ? spr.w : u < .65 ? spr.y : spr.o;
        fx.globalAlpha = (1 - u) * .95; fx.drawImage(c, px - r, py - r, r * 2, r * 2); fx.globalAlpha = (1 - u) * .4; fx.drawImage(c, px - p.vx * .02 - r, py - p.vy * .02 - r, r * 2, r * 2); }
    }
    { const st = S.st; if (st && S.on) {   // 灯った矢印から実写の炎がゆらめく
      const N = clamp(st.threshold | 0, 1, 6), fill = clamp(st.count | 0, 0, N), L = meterLayout(N);
      for (let i = 0; i < fill; i++) { const c = chevC(i, N), u = frac(S.clock * 1.25 + i * 0.37), r = fireFrame(u, 1, 1); if (!r) continue; const w = 330 * L.s, h = w * 335 / 384;
        fx.globalAlpha = 0.5 + 0.12 * Math.sin(S.clock * 19 + i * 2); fx.drawImage(fm, c.x - FX.x - w / 2, c.y - FX.y - h * 0.78, w, h); } } }
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
      { const n = lvl >= 3 ? Math.ceil(st.timeLeft - 1e-6) : 0; if (n >= 1 && n <= 3 && n !== S.lastCd) { S.lastCd = n; tickFx(n); note('tick', { n }); } else if (!n) S.lastCd = 0; }
      // 心拍
      if (lvl >= 1) {
        const P = PANIC.period[lvl]; S.beatT += dt; if (S.beatT >= P) { S.beatT -= P; S.dubDone = false; if (lvl >= 2 && SND) { sfx(eng(), 'lub'); if (lvl >= 3) sfx(eng(), 'buon', -13); } }
        if (!S.dubDone && S.beatT >= 0.26 * P) { S.dubDone = true; if (lvl >= 2 && SND) sfx(eng(), 'dub'); }
      } else { S.beatT = 0; S.dubDone = true; }
      if (LED && lvl >= 2) setCue(true, { lvl, beat: S.beatT + 0 }); else setCue(false);
    }
    // 数字・火花の canvas
    const st2 = S.st; if (st2) { const lvl = S.lvl, P = PANIC.period[lvl] || 1, h = lvl >= 1 ? heart(S.beatT, P) : 0; drawText(st2, lvl, h, PANIC.power[lvl]); drawMeter(st2, lvl, h, PANIC.power[lvl]); }
    if (S.fx.length || S.fxDirty || (S.on && (S.st?.count | 0) > 0)) { drawFx(); S.fxDirty = S.fx.length > 0; }
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
    const grp = { dx: 0, dy: 0, rot: 0.006 * Math.sin(ck * 1.3), sc: BASE.sc };   // 右上の「残り◯秒」（ゲーム全体の時計）に重ならない位置へ寄せる
    let vis = 1;
    if (S.on) {
      const u = ck - S.enterAt, T1 = 0.32;
      if (u < T1) { vis = clamp(u / 0.08); }   // 10/31 札は最初から定位置（下から競り上がらない）。出だしは0.08秒の淡入りだけ
      else { const v = u - T1; grp.dy = 16 * Math.exp(-v * 8) * Math.cos(v * 26); grp.rot += 0.05 * Math.exp(-v * 3) * Math.sin(v * 9); }
    } else { const v = clamp((ck - S.exitAt) / 0.35); grp.dy = -440 * v * v; vis = 1 - v * v; }
    const ha = ck - S.hitAt; if (ha < 0.4) grp.dy += 12 * Math.exp(-ha * 14) * Math.cos(ha * 40);   // 入賞：札が弾む
    const ma = ck - S.missAt; if (ma < 0.45) { grp.dx += Math.sin(ma * 85) * 12 * Math.exp(-ma * 9); grp.rot += Math.sin(ma * 60) * 0.02 * Math.exp(-ma * 9); }   // 外れ：小さく揺れる
    grp.sc *= 1 + (lvl >= 1 ? 0.05 * pw * h + (lvl === 1 ? 0.012 * (.5 + .5 * Math.sin(ck * TAU * 0.9)) : 0) : 0);
    { const ta = ck - (S.tickAt ?? -9); if (ta < 0.45) { const e = Math.exp(-ta * 10); grp.dx += Math.sin(ta * 95) * 16 * e; grp.dy += Math.cos(ta * 80) * 12 * e; } }
    if (lvl >= 3) { grp.dx += Math.sin(ck * 53) * 3 * pw; grp.dy += Math.cos(ck * 47) * 2 * pw; }
    // 縁の赤・警告灯（前面のみ。背景は染めない）
    if (lvl >= 1 && S.on) {
      const va = lvl === 1 ? 0.28 + 0.25 * Math.sin(ck * TAU * 0.9) ** 2 : clamp(0.3 + 0.8 * pw * h + 0.25 * pw);
      out.push({ tex: T.vig, w: 288, h: 317, ax: 0, ay: 0, x: PX, y: PY, rot: 0, sc: 4, alpha: clamp(va), add: false });
      if (lvl >= 2) {
        const al = clamp(0.8 + 0.5 * pw * (0.4 + 0.6 * h)), rot = ck * TAU * (0.8 + 0.25 * lvl);
        out.push({ tex: T.beam, w: 900, h: 900, ax: 450, ay: 450, x: PX + 20, y: PY + 1010, rot, sc: 1.9, alpha: al, add: true });
        out.push({ tex: T.beam, w: 900, h: 900, ax: 450, ay: 450, x: PX + W - 20, y: PY + 1010, rot: rot + Math.PI * 0.9, sc: 1.9, alpha: al, add: true });
      }
    }
    if (S.fx.length || (S.on && (S.st?.count | 0) > 0)) out.push({ tex: T.fx, w: fC.width, h: fC.height, ax: 0, ay: 0, x: PX + FX.x, y: PY + FX.y, rot: 0, sc: 1 / FX.k, alpha: 1, add: true });   // 炎・火花は字とメーターの下（白飛びや炎で字が読めなくならないように）
    // 札はやめた：上段（あと◯個・SS:cc）と下段（矢印メーター）。下から競り上がり、入賞で弾み、外れで揺れる
    { const ty = -grp.dy, ta = ck - (S.tickAt ?? -9), sh = ta < 0.5 ? Math.exp(-ta * 9) : 0;
      out.push({ tex: T.txt, w: TX.w, h: TX.h, ax: 0, ay: 0, x: PX + TX.x + grp.dx + Math.sin(ck * 61) * 7 * sh, y: PY + TX.y + ty * 0.8 + Math.cos(ck * 53) * 6 * sh, rot: 0, sc: 1, alpha: vis });
      out.push({ tex: T.met, w: MT.w, h: MT.h, ax: 0, ay: 0, x: PX + MT.x + grp.dx + Math.sin(ck * 59) * 6 * sh, y: PY + MT.y + ty + Math.cos(ck * 47) * 6 * sh, rot: 0, sc: 1, alpha: vis }); }
    // 残り3秒から：巨大な数字が毎秒叩きつけられる（心拍と同じ拍で脈打つ）
    if (CD && S.on && S.st && lvl >= 3) {
      const n = Math.ceil(S.st.timeLeft - 1e-6), tx = T['cd' + n];
      if (tx && n >= 1 && n <= 3) {
        const u = n - S.st.timeLeft, g = CD.meta.glyphs[String(n)], hh = 640 / g.h, slam = u < 0.12 ? 1.8 - 0.8 * (u / 0.12) ** 2 : 1 + 0.06 * h * pw - 0.05 * clamp((u - .12) / .8);
        out.push({ tex: tx, w: g.w, h: g.h, ax: g.w / 2, ay: g.h / 2, x: PX + W / 2 + Math.sin(u * 90) * 10 * Math.exp(-u * 12), y: PY + 700, rot: 0, sc: hh * slam, alpha: Math.min(1, u / 0.02), add: false });
      }
    }
    return out;
  };
  (lcd.splitWarmers ??= []).push({ name: 'jphud', done: false, step(r) { for (const t of Object.values(T)) { try { r.initTexture(t); } catch { } } return (this.done = true); } });
  lcd.jpHud = { splitLayers, state: S, get active() { return !!S.show; }, panicLevel, dispose() { offAct?.(); lcd.frame = baseFrame; setCue(false); lcd.jpHud = null; } };
  note('attached');
  return lcd;
}
