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
const TX = { x: 0, y: 560, w: 1152, h: 270 }, MT = { x: 0, y: 748, w: 1152, h: 520 };   // 時間・個数の字の canvas／矢印メーターの canvas（液晶座標）   // 数字の canvas の置き場所（液晶座標）
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
  const OLD = qs.get('jphud') === 'v04';
  const FLOOR = !OLD && qs.get('jphud_floor') === '1';   // 試作：メーターを HUD でなく扉の場面の床にする（扉の映像を上へ、床の奥の縁をぼかす・霧・影）   // ?jphud=v04 で旧メーター（Blender で個別に描いた矢印）へ戻す
  if (OLD) { Object.assign(TX, { y: 650 }); Object.assign(MT, { y: 905, h: 360 }); }
  if (FLOOR) Object.assign(MT, { y: 738, h: 530 });
  const SEAL = !OLD && qs.get('jphud') === 'seal';   // 試作：矢印の帯をやめ、封印の扉の錠（宝玉）を残り回数ぶん並べる。入るたびに1個が光って砕ける
  if (SEAL) Object.assign(MT, { y: 200, h: 560 });
  const SIDE = !OLD && !FLOOR && (qs.get('jphud') ?? 'side') === 'side';   // 10/31 監督の決定で既定にした
    // 試作：矢印の帯をやめ、液晶の左右の端に封印の扉の柱に見える細長いメーターを1本ずつ（Blender 描画）。入るたびに区切りが下から満ちる
  if (SIDE) Object.assign(MT, { x: 0, y: 0, w: 1152, h: 1268 });
  const ARROW = !SEAL && !SIDE && qs.get('jpmeter') === 'arrow', METER = ARROW || SEAL || SIDE;   // 10/31 矢印メーターは既定で出さない（監督）。?jpmeter=arrow で戻す。サイドメーター(?jphud=side)・扉の錠(?jphud=seal)は別
  if (!lcd?.production || lcd.jpHud || !lcd.jp) return lcd;
  globalThis.__jpLedGain = qs.get('jphud_ledg') ? +qs.get('jphud_ledg') : 0.35;   // 囲いの赤が液晶の扉を桃色にくすませないよう弱める（0.35。測定 10/31）
  const SND = qs.get('jphud_snd') !== '0', LED = qs.get('jphud_led') !== '0';
  const A = new URL('./jp_hud_assets_1031/', import.meta.url);
  const FIRE = await img(new URL('fx/fire_9049.jpg', A).href).catch(() => null);   // 実写の炎（Pixabay 9049, chris2far・黒地・加算で使う）。6x3 の 384x335 のコマ
  const A2 = new URL('./jp_hud2_assets_1031/', import.meta.url), H2 = {};
  try {
    const names = [...(OLD ? ['chev_off', 'chev_on', 'chev_glow', 'tube'] : []), 'lab_a', 'lab_to', 'lab_ko', 'lab_colon', 'lab_dot']; for (const v of 'nw') for (let d = 0; d < 10; d++) names.push(`d${d}_${v}`);
    await Promise.all(names.map(async (n) => { H2[n] = await img(new URL(n + '.png', A2).href); }));
    H2.meta = await (await fetch(new URL('meta.json', A2))).json();
  } catch (e) { console.warn('[jp-hud] assets', e); return lcd; }
  // 矢印メーター：Blender で北斗無双の手本のカメラに合わせて描いた 3D（N=1..6、全消灯/全点灯/点灯の光）。セルの多角形で点灯を切り替える
  const M3 = { meta: null, off: {}, on: {}, glow: {} };
  const M4 = { meta: null, off: {}, on: {} };
  if (SIDE) try {
    const A4 = new URL('./jp_hud_side_assets_1031/', import.meta.url); M4.meta = await (await fetch(new URL('meta.json', A4))).json();
    await Promise.all(Object.keys(M4.meta).flatMap((n) => ['off', 'on'].map(async (k) => { M4[k][n] = await img(new URL(`${k}_${n}.webp`, A4).href); })));
  } catch (e) { console.warn('[jp-hud] side assets', e); return lcd; }
  if (!OLD && ARROW) try {
    const A3 = new URL(FLOOR ? './jp_hud3f_assets_1031/' : './jp_hud3_assets_1031/', import.meta.url); M3.meta = await (await fetch(new URL('meta.json', A3))).json();
    await Promise.all(Object.keys(M3.meta).map(Number).flatMap((n) => [...['off', 'on'].map(async (k) => { M3[k][n] = await img(new URL(`${k}_${n}.webp`, A3).href); }), ...Array.from({ length: n }, async (_, i) => { (M3.glow[n] ??= [])[i] = await img(new URL(`glow_${n}_${i}.webp`, A3).href); })]));
  } catch (e) { console.warn('[jp-hud] meter3d assets', e); return lcd; }
  const model = lcd.jp.model;
  // 10/31 制限時間・「あと◯個」の字：北斗無双 第5章（4A）の作りで焼いた画像（hud3_timer/src/bake_t2.py）。?jptimer=old で旧版の字へ
  let NEWT = qs.get('jptimer') !== 'old'; const T2 = {};
  if (NEWT) try {
    const names = ['a', 'to', 'ko', 'colon_n', 'colon_w']; for (let d = 0; d < 10; d++) names.push(`c${d}`, `d${d}_n`, `d${d}_w`);
    await Promise.all(names.map(async (n) => { T2[n] = await img(new URL(`t2_${n}.png`, A2).href); }));
    T2.meta = await (await fetch(new URL('t2_meta.json', A2))).json(); Object.assign(TX, { y: TX.y - 40, h: 330 });   // 字が大きく傾くので canvas を縦に広げる（下端の位置は変えない）
  } catch (e) { console.warn('[jp-hud] timer2 assets', e); NEWT = false; }
  // 10/31 ?jptimer=v3：制限時間と「あと◯個」を、本番の「48秒」と同じ工程・同じ字（太いセリフの斜体・銀青のパール面・橙金の二重縁。timer_hud/bake → hud5_timer48）で大きく出す
  let V3 = NEWT && (qs.get('jptimer') ?? 'v3') === 'v3';   // 10/31 監督の決定で既定にした。?jptimer=new で北斗版
  const T5 = {};
  if (V3) try {
    const names = ['colon_n', 'colon_w', 'a', 'to', 'ko']; for (let d = 0; d < 10; d++) names.push(`d${d}_n`, `d${d}_w`);
    await Promise.all(names.map(async (n) => { T5[n] = await img(new URL(`t5_${n}.png`, A2).href); }));
    Object.assign(TX, { y: 480, h: 500 });   // 大きな時計は液晶の中ほど下寄り（扉の錠の下）。字の行は左右の縦長メーターの内側(x130〜1022)に収める
  } catch (e) { console.warn('[jp-hud] timer v3 assets', e); V3 = false; }
  if (SEAL || SIDE) TX.y += 110;   // 字の行は画面の下へ下ろす（扉の全体を見せる）
  let CD = null;   // 残り3・2・1秒の巨大な数字（ember 面の立体数字・Blender SCALE=8）
  try { const d = new URL('count_digits/', A), meta = await (await fetch(new URL('glyphs.json', d))).json(); CD = { meta, imgs: {} }; for (const k of ['1', '2', '3']) CD.imgs[k] = await img(new URL(meta.glyphs[k].file, d).href); } catch (e) { CD = null; console.warn('[jp-hud] countdown assets', e); }
  const S = { brokeAt: [], on: false, t: 0, show: 0, enterAt: -9, exitAt: -9, clock: 0, lastCount: 0, countChange: null, hitAt: -9, missAt: -9, lvl: 0, beatT: 0, beatIdx: -1, dubDone: true, cue: false, fx: [], shownKey: null, events: [] };
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
    { const adv = 110 * DS, cwid = 70 * DS, tot = 4 * adv + cwid + 6; let x = TX.w / 2 - 46 - tot;
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
  const drawTextV3 = (st, lvl, heartV, pw) => {   // 中央：大きな SS:cc（48秒と同じ金属字）／その下：あと ◯ 個（同じ字）
    tx.clearRect(0, 0, TX.w, TX.h);
    const k = 1 + (lvl >= 2 ? (0.05 + 0.05 * (lvl - 2)) * heartV * pw : lvl === 1 ? 0.01 * Math.sin(S.clock * TAU * 0.9) : 0), cy = 280;
    { tx.save(); tx.translate(TX.w / 2, cy + 70); tx.scale(1, 0.4); const hg = tx.createRadialGradient(0, 0, 0, 0, 0, 480); hg.addColorStop(0, 'rgba(14,0,22,.5)'); hg.addColorStop(0.6, 'rgba(14,0,22,.28)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); tx.fillStyle = hg; tx.fillRect(-480, -480, 960, 960); tx.restore(); }
    const v = lvl >= 2 ? 'w' : 'n', SC = 1.0 * k, txt = timeText(st), gi = (ch) => (ch === ':' ? T5['colon_' + v] : T5['d' + ch + '_' + v]);
    { const adv = (ch, im) => im.width * SC * (ch === ':' ? 0.74 : 0.84); let tot = 0; for (const ch of txt) tot += adv(ch, gi(ch)); let x = TX.w / 2 - tot / 2;
      for (const ch of txt) { const im = gi(ch), a = adv(ch, im); tx.drawImage(im, x + a / 2 - im.width * SC / 2, cy - im.height * SC / 2, im.width * SC, im.height * SC); x += a; } }
    { const need = Math.max(0, st.threshold - st.count), cc = S.countChange, a = cc ? S.clock - cc.at : 9, LS = 0.62, ND = 0.66, ly = cy + 175, im1 = T5.a, im2 = T5.to, im3 = T5.ko, dn = T5['d' + need + '_n'];
      const w1 = im1.width * LS * 0.92, w2 = im2.width * LS * 0.92, w3 = im3.width * LS, wn = Math.max(...Array.from({ length: 10 }, (_, d) => T5['d' + d + '_n'].width)) * ND * 0.9, tot = w1 + w2 + wn + w3 + 14; let lx = TX.w / 2 - tot / 2;
      const put = (im, x, y, sc, al = 1) => { tx.globalAlpha = al; tx.drawImage(im, x - im.width * sc / 2, y - im.height * sc / 2, im.width * sc, im.height * sc); tx.globalAlpha = 1; };
      put(im1, lx + w1 / 2, ly, LS); lx += w1; put(im2, lx + w2 / 2, ly, LS); lx += w2 + 7;
      if (cc && a < 0.35) { const old = T5['d' + cc.from + '_n'], f = clamp(a / 0.12); if (old && f < 1) put(old, lx + wn / 2, ly + f * 40, ND * 1.08, 1 - f);
        const pop = a < 0.1 ? 2.1 - 1.1 * (a / 0.1) ** 2 : 1 + 0.16 * Math.exp(-(a - 0.1) * 12) * Math.cos((a - 0.1) * 34); put(dn, lx + wn / 2, ly, ND * 1.08 * pop, clamp(a / 0.05));
      } else put(dn, lx + wn / 2, ly, ND * 1.08);
      lx += wn + 7; put(im3, lx + w3 / 2, ly, LS); }
    T.txt.needsUpdate = true;
  };
  const drawTextOld = (st, lvl, heartV, pw) => {
    tx.clearRect(0, 0, TX.w, TX.h);
    { tx.save(); tx.translate(TX.w / 2, TX.h * 0.52); tx.scale(1, OLD ? 0.34 : 0.2); const hg = tx.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.66)'); hg.addColorStop(0.6, 'rgba(14,0,22,.4)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); tx.fillStyle = hg; tx.fillRect(-600, -600, 1200, 1200); tx.restore(); }   // 字の後ろの柔らかい暗がり（縁なし）。白飛びでも読める
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
  const drawText = (st, lvl, heartV, pw) => (V3 ? drawTextV3(st, lvl, heartV, pw) : NEWT ? drawTextNew(st, lvl, heartV, pw) : drawTextOld(st, lvl, heartV, pw));
  const NKEYS = OLD || SEAL ? [1] : SIDE ? Object.keys(M4.meta).map(Number) : M3.meta ? Object.keys(M3.meta).map(Number) : [2, 3, 4, 5, 6, 7], NMIN = Math.min(...NKEYS), NMAX = Math.max(...NKEYS), clampN = (n) => OLD ? clamp(n, 1, 6) : SEAL ? clamp(n, 1, 7) : SIDE ? clamp(n, NMIN, NMAX) : clamp(n, NMIN, NMAX);
  const meterLayoutNew = (N) => { N = clampN(N); const m = M3.meta?.[N]; if (!m) return { s: 1, w: MT.w, h: MT.h, x0: 0, y0: 0, cells: [] }; return { s: m.s, w: m.w, h: m.h, x0: 0, y0: MT.h - m.h, cells: m.cells }; };   // 全幅：液晶の左右いっぱい、下端は液晶の一番下
  const cellBox = (c) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, sx = 0, sy = 0; for (const [x, y] of c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y; } return { x0, x1, y0, y1, cx: sx / c.length, cy: sy / c.length }; };
  const chevCNew = (i, N) => { const L = meterLayoutNew(N); if (!L.cells.length) return { x: MT.x + MT.w / 2, y: MT.y + MT.h * 0.8 }; const b = cellBox(L.cells[Math.min(i, L.cells.length - 1)]); return { x: MT.x + L.x0 + b.cx, y: MT.y + L.y0 + b.cy }; };
  const drawMeterNew = (st, lvl, heartV, pw) => {
    mt.clearRect(0, 0, MT.w, MT.h);
    if (0) { mt.save(); mt.translate(MT.w / 2, MT.h * 0.52); mt.scale(1, 0.36); const hg = mt.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.6)'); hg.addColorStop(0.65, 'rgba(14,0,22,.34)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); mt.fillStyle = hg; mt.fillRect(-600, -600, 1200, 1200); mt.restore(); }
    const N = clampN(st.threshold | 0), fill = clamp(st.count | 0, 0, N), L = meterLayoutNew(N), ck = S.clock, cc = S.countChange, a = cc ? ck - cc.at : 9;
    mt.drawImage(M3.off[N], L.x0, L.y0);
    const poly = (c) => { mt.beginPath(); c.forEach(([x, y], j) => (j ? mt.lineTo(L.x0 + x, L.y0 + y) : mt.moveTo(L.x0 + x, L.y0 + y))); mt.closePath(); };
    const slice = (i, al) => { mt.globalAlpha = clamp(al); mt.drawImage(M3.glow[N][i], L.x0, L.y0); };
    for (let i = 0; i < N; i++) {
      const lit = i < fill;
      if (lit) {
        mt.save(); poly(L.cells[i]); mt.clip(); mt.drawImage(M3.on[N], L.x0, L.y0);
        if (i === fill - 1 && a < 0.35) { mt.globalCompositeOperation = 'lighter'; mt.globalAlpha = 0.8 * (1 - a / 0.35); mt.drawImage(M3.on[N], L.x0, L.y0); }
        mt.restore();
        const fl = 0.8 + 0.2 * Math.sin(ck * 23 + i * 1.7) + 0.1 * Math.sin(ck * 41 + i);
        mt.save(); mt.globalCompositeOperation = 'lighter'; slice(i, 0.5 * fl + (i === fill - 1 && a < 0.5 ? 0.9 * Math.exp(-a * 8) : 0)); mt.restore();
      } else if (lvl >= 2) {   // まだ灯っていない矢印が、心拍に合わせて赤く脈打つ（早く灯せ）
        mt.save(); mt.globalCompositeOperation = 'lighter'; slice(i, 0.55 * pw * (0.3 + 0.7 * heartV)); mt.restore();
      }
    }
    if (FLOOR) {   // 床として場面になじませる：奥の縁をぼかす・接地の影・光の段階・霧
      const far = M3.meta[clampN(N)].far, c0 = L.cells[0][0], c1 = L.cells[N - 1][1], P0 = far ? [L.x0 + far[0][0], L.y0 + far[0][1]] : [L.x0 + c0[0], L.y0 + c0[1] - 55], P1 = far ? [L.x0 + far[1][0], L.y0 + far[1][1]] : [L.x0 + c1[0], L.y0 + c1[1] - 55], ang = Math.atan2(P1[1] - P0[1], P1[0] - P0[0]), br = 0.25 + 0.75 * (fill / N);
      const band = (y0, y1, stops, mode) => { mt.save(); mt.globalCompositeOperation = mode; mt.translate(P0[0], P0[1]); mt.rotate(ang); const g = mt.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) g.addColorStop(o, c); mt.fillStyle = g; mt.fillRect(-120, Math.min(y0, y1), 1500, Math.abs(y1 - y0)); mt.restore(); };
      band(8, 120, [[0, 'rgba(6,0,18,0.55)'], [1, 'rgba(6,0,18,0)']], 'source-atop');                         // 扉の足元から床へ落ちる接地の影
      mt.save(); mt.globalCompositeOperation = 'source-atop'; mt.fillStyle = `rgba(255,205,120,${(0.05 + 0.13 * br).toFixed(3)})`; mt.fillRect(0, 0, MT.w, MT.h); mt.restore();   // 場面の光（解けるごとに明るく）の映り込み
      band(0, 58, [[0, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']], 'destination-out');                           // 奥の縁を消す（斜めの直線の縁をなくす）
      band(-80, 40, [[0, 'rgba(150,110,230,0)'], [0.65, `rgba(160,120,235,${(0.05 + 0.06 * br).toFixed(3)})`], [1, 'rgba(255,215,150,0)']], 'lighter');   // 奥の霧と光（弱く・紫寄り）
      // 手前を横切る火の粉と泡
      mt.save(); mt.globalCompositeOperation = 'lighter'; for (let q = 0; q < 26; q++) { const sp = 0.25 + 0.55 * ((q * 37) % 11) / 11, ph = ((q * 0.137 + S.clock * sp * 0.35) % 1), x = ((q * 211.7) % MT.w + Math.sin(S.clock * (0.8 + sp) + q) * 26 + MT.w) % MT.w, y = MT.h - ph * (MT.h * 0.9), r = 2.2 + ((q * 13) % 5), al = Math.sin(ph * Math.PI) * (0.5 + 0.4 * br);
        const g = mt.createRadialGradient(x, y, 0, x, y, r * 3.2); g.addColorStop(0, `rgba(255,${190 + (q % 3) * 20},110,${al.toFixed(3)})`); g.addColorStop(1, 'rgba(255,120,40,0)'); mt.fillStyle = g; mt.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4); }
      for (let q = 0; q < 9; q++) { const ph = ((q * 0.23 + S.clock * 0.09) % 1), x = ((q * 331.3) % MT.w + Math.sin(S.clock * 0.7 + q * 2) * 18 + MT.w) % MT.w, y = MT.h - ph * MT.h, r = 7 + (q % 4) * 5; mt.strokeStyle = `rgba(215,200,255,${(Math.sin(ph * Math.PI) * 0.35).toFixed(3)})`; mt.lineWidth = 1.6; mt.beginPath(); mt.arc(x, y, r, 0, 6.2832); mt.stroke(); }
      mt.restore();
    }
    T.met.needsUpdate = true;
  };

  const meterLayoutOld = (N) => { const s = clamp(1040 / ((N - 1) * 184 + 260), 0.7, 1.3), adv = 184 * s, w = (N - 1) * adv + 260 * s, x0 = (MT.w - w) / 2; return { s, adv, w, x0, cy: MT.h / 2 + 4 }; };
  const chevCOld = (i, N) => { const L = meterLayoutOld(N); return { x: MT.x + L.x0 + i * L.adv + 130 * L.s, y: MT.y + L.cy }; };
  const drawMeterOld = (st, lvl, heartV, pw) => {
    mt.clearRect(0, 0, MT.w, MT.h);
    { mt.save(); mt.translate(MT.w / 2, MT.h * 0.52); mt.scale(1, 0.4); const hg = mt.createRadialGradient(0, 0, 0, 0, 0, 600); hg.addColorStop(0, 'rgba(14,0,22,.6)'); hg.addColorStop(0.65, 'rgba(14,0,22,.34)'); hg.addColorStop(1, 'rgba(14,0,22,0)'); mt.fillStyle = hg; mt.fillRect(-600, -600, 1200, 1200); mt.restore(); }
    const N = clamp(st.threshold | 0, 1, 6), fill = clamp(st.count | 0, 0, N), L = meterLayoutOld(N), h2 = 0.5 * H2.chev_on.width / H2.meta.chev[0];   // 画像は 2x
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

  // ---- 封印の扉の錠（宝玉）：扉の中央の円環のまわりに残り回数ぶん並べる。入るたびに1個が光って砕ける（鎖切れの演出と同時）----
  const SEAL_C = { x: 576, y: 470, r: 222 };
  const gemPos = (i, N) => { const a0 = -2.62, a1 = -0.52, a = N === 1 ? -1.57 : a0 + (a1 - a0) * i / (N - 1); return { x: SEAL_C.x + Math.cos(a) * SEAL_C.r, y: SEAL_C.y + Math.sin(a) * SEAL_C.r * 0.92 }; };
  const meterLayoutSeal = (N) => ({ s: 1, w: MT.w, h: MT.h, x0: 0, y0: 0, cells: [] });
  const chevCSeal = (i, N) => { const q = gemPos(clamp(i, 0, N - 1), N); return { x: MT.x + q.x, y: MT.y + q.y }; };
  const drawGem = (c, x, y, r, t, heartV, pw, lvl, isNext) => {   // 暗い紫の宝玉に金の輪（錠）。次に砕ける1個は脈打つ
    const pul = isNext ? 0.5 + 0.5 * Math.sin(S.clock * 5.5) : 0, redL = lvl >= 2 ? clamp(0.5 * pw * (0.3 + 0.7 * heartV)) : 0;
    c.save(); c.globalCompositeOperation = 'lighter'; let g = c.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6); g.addColorStop(0, `rgba(${150 + redL * 100 | 0},${70 - redL * 30 | 0},${255 - redL * 150 | 0},${0.30 + 0.25 * pul + 0.3 * redL})`); g.addColorStop(1, 'rgba(120,40,220,0)'); c.fillStyle = g; c.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2); c.restore();
    g = c.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.08, x, y, r); g.addColorStop(0, 'rgba(240,215,255,0.98)'); g.addColorStop(0.28, 'rgba(160,90,235,0.97)'); g.addColorStop(0.75, 'rgba(70,20,140,0.98)'); g.addColorStop(1, 'rgba(25,6,60,0.98)');
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 10; c.shadowOffsetY = 4; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore();
    const rg = c.createLinearGradient(x - r, y - r, x + r, y + r); rg.addColorStop(0, '#fff3b0'); rg.addColorStop(0.45, '#d89a1c'); rg.addColorStop(0.6, '#7a4a05'); rg.addColorStop(1, '#ffd45a'); c.strokeStyle = rg; c.lineWidth = r * 0.26; c.beginPath(); c.arc(x, y, r * 1.12, 0, TAU); c.stroke();
  };
  const drawSeal = (st, lvl, heartV, pw) => {
    mt.clearRect(0, 0, MT.w, MT.h); const N = clampN(st.threshold | 0), rad = N <= 5 ? 40 : 33, ck = S.clock, next = st.count | 0;
    for (let i = 0; i < N; i++) {
      const q = gemPos(i, N), x = q.x - MT.x, y = q.y - MT.y, ba = S.brokeAt[i];
      if (ba == null && i >= (st.count | 0)) { drawGem(mt, x, y, rad, 0, heartV, pw, lvl, i === next); continue; }
      const t = ck - (ba ?? ck - 9); if (t > 1.0) continue;
      if (t < 0.22) { drawGem(mt, x, y, rad * (1 + 0.25 * (t / 0.22)), t, 0, 0, 0, false);   // 光る：金白に燃える
        mt.save(); mt.globalCompositeOperation = 'lighter'; const k = t / 0.22, g = mt.createRadialGradient(x, y, 0, x, y, rad * (1.6 + 2.6 * k)); g.addColorStop(0, `rgba(255,245,200,${0.95})`); g.addColorStop(0.4, 'rgba(255,190,80,0.6)'); g.addColorStop(1, 'rgba(255,120,30,0)'); mt.fillStyle = g; mt.fillRect(x - rad * 5, y - rad * 5, rad * 10, rad * 10); mt.restore(); continue; }
      const u = (t - 0.22) / 0.78;   // 砕ける：破片が飛び、衝撃の輪が広がる
      mt.save(); mt.globalCompositeOperation = 'lighter'; mt.strokeStyle = `rgba(255,225,140,${((1 - u) * 0.8).toFixed(3)})`; mt.lineWidth = 6 * (1 - u) + 1; mt.beginPath(); mt.arc(x, y, rad * (1.2 + 3.4 * easeOut(u)), 0, TAU); mt.stroke(); mt.restore();
      for (let q2 = 0; q2 < 12; q2++) { const a = (q2 / 12) * TAU + i, v = (90 + (q2 * 53 % 70)) * easeOut(u), px = x + Math.cos(a) * v, py = y + Math.sin(a) * v + 140 * u * u, sz = (rad * 0.5) * (1 - u * 0.7), rot = a + u * 6;
        mt.save(); mt.translate(px, py); mt.rotate(rot); mt.globalAlpha = (1 - u) * 0.95; mt.fillStyle = q2 % 3 === 0 ? '#ffe9a0' : q2 % 3 === 1 ? '#b070f0' : '#ffb540'; mt.beginPath(); mt.moveTo(0, -sz); mt.lineTo(sz * 0.7, sz * 0.5); mt.lineTo(-sz * 0.45, sz * 0.7); mt.closePath(); mt.fill(); mt.restore(); }
    }
    T.met.needsUpdate = true;
  };
  // ---- サイドメーター：左右の端に1本ずつ（同期）。柱の鉄枠・金・鎖はBlenderで描いた画像、点灯は区切りごとに下から満ちる ----
  const SIDE_Y = 332, SIDE_X = 4;   // 右上の「残り◯秒」（y≈160〜325）より下から始める
  const meterLayoutSide = (N) => ({ s: 1, w: MT.w, h: MT.h, x0: 0, y0: 0, cells: [] });
  const chevCSide = (i, N) => { const m = M4.meta?.[clampN(N)], c = m?.cells[clamp(i, 0, (m?.cells.length || 1) - 1)]; const y = c ? SIDE_Y + (c[0][1] + c[2][1]) / 2 : 600; return { x: MT.x + SIDE_X + (m ? (m.left + m.right) / 2 : 75), y: MT.y + y }; };
  const drawSide = (st, lvl, heartV, pw) => {
    mt.clearRect(0, 0, MT.w, MT.h); const N = clampN(st.threshold | 0), m = M4.meta[N]; if (!m) return; const ck = S.clock, cnt = st.count | 0;
    for (let side = 0; side < 2; side++) {
      mt.save(); if (side) { mt.translate(MT.w, 0); mt.scale(-1, 1); }
      const x0 = SIDE_X, y0 = SIDE_Y, ix = x0 + m.right;
      let g = mt.createLinearGradient(ix - 6, 0, ix + 90, 0); g.addColorStop(0, 'rgba(8,0,20,0.5)'); g.addColorStop(1, 'rgba(8,0,20,0)'); mt.fillStyle = g; mt.fillRect(ix - 6, y0 + 30, 96, m.h - 60);   // 柱が場面に落とす影
      mt.save(); mt.globalCompositeOperation = 'lighter'; g = mt.createLinearGradient(ix - 20, 0, ix + 70, 0); g.addColorStop(0, 'rgba(140,70,255,0.30)'); g.addColorStop(1, 'rgba(140,70,255,0)'); mt.fillStyle = g; mt.fillRect(ix - 20, y0 + 40, 90, m.h - 80); mt.restore();   // 紫の光が場面へにじむ
      let lit = 0;
      for (let k = 0; k < N; k++) { const ba = S.brokeAt[k]; if (k < cnt || ba != null) lit++; }
      for (let k = 0; k < N; k++) { const ba = S.brokeAt[k]; if (k < cnt || ba != null) { const a = clamp((ck - (ba ?? ck - 9)) / 0.5), c = m.cells[k], yb = c[2][1], yt = c[0][1], ye = yb - (yb - yt) * easeOut(a);
        mt.save(); mt.globalCompositeOperation = 'lighter'; const fl = 0.55 + 0.2 * Math.sin(ck * 9 + k * 1.7); g = mt.createRadialGradient(x0 + (c[0][0] + c[1][0]) / 2 + 40, y0 + (yt + yb) / 2, 4, x0 + (c[0][0] + c[1][0]) / 2 + 40, y0 + (yt + yb) / 2, 150); g.addColorStop(0, `rgba(255,110,30,${(0.30 * fl * easeOut(a)).toFixed(3)})`); g.addColorStop(1, 'rgba(255,60,10,0)'); mt.fillStyle = g; mt.fillRect(x0 + m.left - 20, y0 + yt - 70, 260, yb - yt + 140); mt.restore(); } }
      mt.drawImage(M4.off[N], x0, y0);
      for (let k = 0; k < N; k++) { const ba = S.brokeAt[k]; if (!(k < cnt || ba != null)) continue; const a = clamp((ck - (ba ?? ck - 9)) / 0.5), c = m.cells[k], yb = c[2][1], yt = c[0][1], ye = yb - (yb - yt) * easeOut(a);
        mt.save(); mt.beginPath(); mt.rect(x0 + c[0][0] - 2, y0 + ye, c[1][0] - c[0][0] + 4, yb - ye + 1); mt.clip(); mt.drawImage(M4.on[N], x0, y0);
        if (a < 0.6) { mt.globalCompositeOperation = 'lighter'; mt.globalAlpha = 0.7 * (1 - a / 0.6); mt.drawImage(M4.on[N], x0, y0); } mt.restore();
        if (a < 1) { mt.save(); mt.globalCompositeOperation = 'lighter'; g = mt.createLinearGradient(0, y0 + ye - 14, 0, y0 + ye + 8); g.addColorStop(0, 'rgba(255,230,160,0)'); g.addColorStop(0.7, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,200,100,0)'); mt.fillStyle = g; mt.fillRect(x0 + c[0][0], y0 + ye - 14, c[1][0] - c[0][0], 22); mt.restore(); } }
      if (lit < N) { const c = m.cells[lit], pu = 0.5 + 0.5 * Math.sin(S.clock * 5.5), red = lvl >= 2 ? clamp(0.5 * pw * (0.3 + 0.7 * heartV)) : 0;   // 次に光る区切りは脈打つ（残り少ないと赤い警報）
        mt.save(); mt.globalCompositeOperation = 'lighter'; mt.fillStyle = `rgba(${150 + red * 105 | 0},${60 - red * 40 | 0},${220 - red * 170 | 0},${(0.10 + 0.14 * pu + 0.3 * red).toFixed(3)})`; mt.fillRect(x0 + c[0][0], y0 + c[0][1], c[1][0] - c[0][0], c[2][1] - c[0][1]); mt.restore(); }
      mt.restore();
    }
    T.met.needsUpdate = true;
  };
  const meterLayout = OLD ? meterLayoutOld : SEAL ? meterLayoutSeal : SIDE ? meterLayoutSide : meterLayoutNew, chevC = OLD ? chevCOld : SEAL ? chevCSeal : SIDE ? chevCSide : chevCNew, drawMeter = OLD ? drawMeterOld : SEAL ? drawSeal : SIDE ? drawSide : drawMeterNew;

  // ---- 火花・炎（入賞・カウント） ----
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const plateXY = (lx, ly) => ({ x: PIVOT.x + (lx - PIVOT.x) * BASE.sc + BASE.dx, y: PIVOT.y + (ly - PIVOT.y) * BASE.sc });
  const burst = () => {
    const N = clampN((S.st?.threshold | 0) || 4), o = chevC(clamp((S.st?.count | 0) - 1, 0, N - 1), N), top = { x: o.x, y: o.y - 20 };
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
    { const st = S.st; if (ARROW && st && S.on) {   // 灯った矢印から実写の炎がゆらめく
      const N = OLD ? clamp(st.threshold | 0, 1, 6) : clampN(st.threshold | 0), fill = clamp(st.count | 0, 0, N), L = meterLayout(N);
      if (!SEAL && !SIDE) for (let i = 0; i < fill; i++) { const c = chevC(i, N), u = frac(S.clock * 1.25 + i * 0.37), r = fireFrame(u, 1, 1); if (!r) continue; const bb = OLD ? null : cellBox(L.cells[Math.min(i, L.cells.length - 1)]), w = OLD ? 330 * L.s : Math.min(560, (bb.x1 - bb.x0) * 1.7), h = w * 335 / 384;
        fx.globalAlpha = 0.5 + 0.12 * Math.sin(S.clock * 19 + i * 2); fx.drawImage(fm, c.x - FX.x - w / 2, c.y - FX.y - h * 0.78, w, h); } } }
    fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over'; T.fx.needsUpdate = true;
  };

  // ---- 状態の更新（毎フレーム。lcd.frame の後ろ）----
  const eng = () => globalThis.__r2Audio?.engine;
  const baseFrame = lcd.frame.bind(lcd);
  const offAct = controller.onAction((action) => {
    const e = controller.lastGameEvent ?? {};
    if (action === 'meterLand' && e.hit === false) { S.missAt = S.clock; note('miss'); }
    else if (action === 'meterReady') { S.brokeAt = []; S.lastCount = 0; S.countChange = null; S.fx.length = 0; S.beatIdx = -1; }
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
    if (want && !S.on) { S.on = true; S.enterAt = S.clock; S.exitAt = -9; S.brokeAt = []; S.lastCount = st.count | 0; S.countChange = null; S.fx.length = 0; note('enter', { name }); }
    else if (!want && S.on) { S.on = false; S.exitAt = S.clock; note('exit', { name, count: st?.count }); setCue(false); }
    S.name = name; S.cutT = !OLD && /_b\d+$/.test(name) ? (model.time ?? 0) : -1;   // 鎖が切れるカットイン（緑の帯「あと◯本」）の間は、字の行を一時的に消す（同じ「あと」が二重に出ない）
    if (!S.on && S.clock - S.exitAt > 0.4) { S.show = 0; S.st = null; S.lvl = 0; setCue(false); return; }
    S.show = 1;
    if (S.on) {
      S.st = { threshold: st.threshold, count: st.count, timeLeft: st.timeLeft };
      const c = st.count | 0;
      if (c > S.lastCount) { for (let q = S.lastCount; q < c; q++) S.brokeAt[q] = S.clock; S.countChange = { at: S.clock, from: Math.max(0, st.threshold - S.lastCount) }; S.hitAt = S.clock; burst(); note('hit', { count: c }); }
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
    const st2 = S.st; if (st2) { const lvl = S.lvl, P = PANIC.period[lvl] || 1, h = lvl >= 1 ? heart(S.beatT, P) : 0; drawText(st2, lvl, h, PANIC.power[lvl]); if (METER) drawMeter(st2, lvl, h, PANIC.power[lvl]); }
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
    if (S.fx.length || (ARROW && S.on && (S.st?.count | 0) > 0)) out.push({ tex: T.fx, w: fC.width, h: fC.height, ax: 0, ay: 0, x: PX + FX.x, y: PY + FX.y, rot: 0, sc: 1 / FX.k, alpha: 1, add: true });   // 炎・火花は字とメーターの下（白飛びや炎で字が読めなくならないように）
    // 札はやめた：上段（あと◯個・SS:cc）と下段（矢印メーター）。下から競り上がり、入賞で弾み、外れで揺れる
    { const ty = -grp.dy, ta = ck - (S.tickAt ?? -9), sh = ta < 0.5 ? Math.exp(-ta * 9) : 0;
      const ct = S.cutT, cutA = ct < 0 ? 1 : clamp(1 - clamp((ct - 0.7) / 0.12) + clamp((ct - 2.05) / 0.15));
      if (SEAL || SIDE) out.push({ tex: T.met, w: MT.w, h: MT.h, ax: 0, ay: 0, x: PX + MT.x + grp.dx, y: PY + MT.y + ty, rot: 0, sc: 1, alpha: vis * (SIDE ? 0.45 + 0.55 * cutA : cutA) });
      out.push({ tex: T.txt, w: TX.w, h: TX.h, ax: 0, ay: 0, x: PX + TX.x + grp.dx + Math.sin(ck * 61) * 7 * sh, y: PY + TX.y + ty * 0.8 + Math.cos(ck * 53) * 6 * sh, rot: 0, sc: 1, alpha: vis * cutA });
      if (ARROW) out.push({ tex: T.met, w: MT.w, h: MT.h, ax: 0, ay: 0, x: PX + MT.x + grp.dx + Math.sin(ck * 59) * 6 * sh, y: PY + MT.y + ty + Math.cos(ck * 47) * 6 * sh, rot: 0, sc: 1, alpha: vis }); }
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
  const baseXform = () => { if (!FLOOR || !S.show) return null; const k = S.on ? clamp((S.clock - S.enterAt) / 0.6) : 1 - clamp((S.clock - S.exitAt) / 0.35); return k > 0 ? { y: -50 * k * k * (3 - 2 * k) } : null; };   // 床の奥の縁に扉の足元が接するよう、扉の映像を上へ
  lcd.jpHud = { splitLayers, baseXform, state: S, get active() { return !!S.show; }, panicLevel, dispose() { offAct?.(); lcd.frame = baseFrame; setCue(false); lcd.jpHud = null; } };
  note('attached');
  return lcd;
}
