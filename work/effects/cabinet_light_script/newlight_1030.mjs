// 10/30 新しい演出（冒頭チュートリアルv06・JPチュートリアルv04・継続告知v09・封印の扉JP通しv05/待機ループ）の筐体の光。
// 区画ごとの「絶対値」の台本（8区画 head,gills,logo,pillarL_up,pillarL_low,pillarR_up,pillarR_low,bottom ＋ 穴7つ ＋ ring4）。
// evalFx の登録文法として動く（flash_fx_20261029.mjs の registerGrammar）。毎フレームは数十回の四則演算のみ・確保なし。
// 規則：揺れ2〜3Hz／止めの間も動かす／4コマ未満（>7.5Hz）の周期点滅なし（MOTION_RULES.md）／紫の雷は囲いも紫（既存 'lightning'）。
import {registerGrammar, hsvTo} from './flash_fx_20261029.mjs';
const TAU = Math.PI * 2, frac = x => x - Math.floor(x), clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const sq = (x, d = .5) => frac(x) < d ? 1 : 0, pulse = (x, k) => Math.exp(-frac(x) * k);
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const HEAD = [0, 1, 2], LEFT = [3, 4], RIGHT = [5, 6];
const PH = [0, .04, .08, .80, .65, .20, .35, .50];        // 周回の位相（cabinet_light_script と同じ）
const GOLD = [1, .52, .02], AMBER = [1, .30, .02], RED = [1, .03, .04], PINK = [1, .08, .45], VIOLET = [.42, .04, 1], PBLK = [.32, .02, .66], PDEEP = [.22, .01, .46],
  BLUE = [.05, .30, 1], WHITE = [1, .93, .80], GREEN = [.10, 1, .30], CYAN = [.05, .8, 1];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const tmp = new Float32Array(3);
// helpers: write level L and colour col into region i / a group / all
const reg = (o, i, L, c) => { o.aK[i] = L; o.aC[i * 3] = c[0]; o.aC[i * 3 + 1] = c[1]; o.aC[i * 3 + 2] = c[2]; };
const grp = (o, g, L, c) => { for (const i of g) reg(o, i, L, c); };
const all = (o, L, c) => { for (let i = 0; i < 8; i++) reg(o, i, L, c); };
const rings = (o, v) => { for (let j = 0; j < 4; j++) o.aR[j] = v; };
// 走る光（区画ごとに位相をずらした山）0..1
const crest = (i, x, sharp = 2) => Math.pow(.5 + .5 * Math.cos(TAU * (x - PH[i])), sharp);
const rainbowAll = (o, L, hue, spread) => { for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, hue + spread * PH[i]); reg(o, i, L, tmp); } };
// 穴のLEDはゲームの状態（球が入った・灯の数・残りの穴）だけを表す（10/31 監督）。holes＝飾り（?holedeco=1 のときだけ光る）。
// lamp＝チュートリアルで実機のランプの見え方（灯った穴・残り1つの脈動）を見せる見本（遊技中ではない待機画面のみ。光らせる）。
const HOLEDECO = typeof location !== 'undefined' && /[?&]holedeco=1(&|$)/.test(location.search || '');
const holes = (o, i, L, c) => { o.holeOn = true; o.hv[i * 3] = c[0] * L; o.hv[i * 3 + 1] = c[1] * L; o.hv[i * 3 + 2] = c[2] * L; };
const lamp = (o, i, L, c) => { holes(o, i, L, c); o.holeDemo = true; };
const begin0 = o => { o.abs = true; o.holeOn = false; o.hv.fill(0); o.aK.fill(0); rings(o, 0); o.gain = 1; o.white = 0; o.floor = 0; };
const begin = begin0;
const FLASH = (t, at, d = .12) => t >= at ? Math.exp(-(t - at) / d) : 0;            // 立ち上がり一発・指数で落ちる白
const hit = (o, w) => { if (w > o.white) o.white = w; };

// ---------------------------------------------------------------- 1. 冒頭チュートリアル v06（15.3秒・7カット）
// 0 玉を増やせ(0-2.3) / 1 左のボタンで撃つ(-4.5) / 2 穴に入れてランプ(-6.9) / 3 6つでJACKPOT CHANCE(-9.9) / 4 おたのしみ(-11.7) / 5 玉大量獲得(-13.7) / 6 はじめよう(-15.3)
const TUT06 = [0, 2.3, 4.5, 6.9, 9.9, 11.7, 13.7, 15.3];
function tut06(o, c) {
  const t = c.t, ck = c.clock; begin(o);
  const cut = t < 2.3 ? 0 : t < 4.5 ? 1 : t < 6.9 ? 2 : t < 9.9 ? 3 : t < 11.7 ? 4 : t < 13.7 ? 5 : 6, u = t - TUT06[cut];
  switch (cut) {
    case 0: {   // 「玉」を増やせ！：金のゆっくりした波。字が叩きつけられる 0.15s に一発
      for (let i = 0; i < 8; i++) reg(o, i, .5 + .5 * crest(i, ck * .6, 1.5) * ease(u / .5), GOLD);
      rings(o, .12); hit(o, FLASH(u, .15, .14) * .6); break;
    }
    case 1: {   // 左のボタンで撃つ：左の柱だけが2.4Hzで金→白に脈打つ（指す）。ほかは暗い青
      const p = .5 + .5 * Math.sin(TAU * 2.4 * ck - 1.57), s = p * p * (3 - 2 * p);
      all(o, .22, BLUE); grp(o, LEFT, .8 + .85 * s, mixc(GOLD, WHITE, s * .7));
      reg(o, 7, .3 + .5 * crest(4, ck * 2.4, 3), GOLD);           // 柱の下から足元へ流れる
      rings(o, .08 + .1 * s); hit(o, FLASH(u, 0, .1) * .5); break;
    }
    case 2: {   // 穴に入れてランプを光らせよう：穴が1,2,..6 と順に点く（0.35s + 0.3s*k）。点く瞬間に白い閃き＋足元の閃き
      const n = clamp(Math.floor((u - .35) / .3) + 1, 0, 6);
      all(o, .3, BLUE); let flash = 0;
      for (let k = 0; k < 6; k++) { const at = .35 + .3 * k; if (u >= at) { lamp(o, k, 1.5, k < 4 ? [1, .82, .55] : k === 4 ? [1, .32, .02] : GOLD); const f = FLASH(u, at, .1); lamp(o, k, 1.5 + 9 * f, f > .3 ? WHITE : (k < 4 ? [1, .82, .55] : GOLD)); if (f > flash) flash = f; } }
      reg(o, 7, .4 + .9 * flash + .15 * n, mixc(GOLD, WHITE, flash * .5)); grp(o, LEFT, .3 + .25 * n * .3, PINK); grp(o, RIGHT, .3 + .25 * n * .3, PINK);
      rings(o, .06 * n); hit(o, flash * .3); break;
    }
    case 3: {   // 6つ光ったらJACKPOT CHANCE：頭の白→金赤交互（5Hz）。6つ点灯＋残りの穴（7）が金で脈打つ
      for (let k = 0; k < 6; k++) lamp(o, k, 1.6, k < 4 ? [1, .82, .55] : k === 4 ? [1, .32, .02] : GOLD);
      const pp = .5 + .5 * Math.sin(TAU * 2.4 * ck); lamp(o, 6, .6 + 1.6 * pp * pp, mixc(GOLD, WHITE, pp * .6));
      if (u < 1.4) { const a = sq(ck * 5, .55), col = a ? GOLD : RED; for (let i = 0; i < 8; i++) reg(o, i, (a ? 1.5 : .3) * (.6 + .4 * crest(i, ck * 3, 2)), col); rings(o, a ? .4 : .08); hit(o, a && frac(ck * 5) < .2 ? .35 : 0); }
      else { for (let i = 0; i < 8; i++) reg(o, i, .75 + .5 * crest(i, ck * 1.2, 2), GOLD); rings(o, .15); }
      hit(o, FLASH(u, 0, .12) * .9); break;
    }
    case 4: {   // 何が起こるかはおたのしみ：桃と青のゆるい交互（1.4Hz）。穴は6灯のまま
      for (let k = 0; k < 6; k++) lamp(o, k, 1.2, k < 4 ? [1, .82, .55] : k === 4 ? [1, .32, .02] : GOLD);
      const a = frac(ck * .7) < .5, col = a ? PINK : CYAN, w = .5 + .5 * Math.sin(TAU * 1.4 * ck - 1.57);
      grp(o, HEAD, .6 + .5 * w, col); grp(o, LEFT, a ? .85 : .45, PINK); grp(o, RIGHT, a ? .45 : .85, CYAN); reg(o, 7, .55, col); rings(o, .1); break;
    }
    case 5: {   // 「玉大量獲得」のチャンス？！：虹が段を上げて回る（3→7.5Hz の色替わり）、明るさも上がる
      const k = clamp(u / 2), hz = 3 + 4.5 * k, step = Math.floor(ck * hz) / 8;
      for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, step + .55 * PH[i]); reg(o, i, (.7 + .75 * k) * (.75 + .25 * crest(i, ck * (1.5 + 2 * k), 2)), tmp); }
      rings(o, .15 + .25 * k); hit(o, FLASH(u, 0, .1) * .5); break;
    }
    default: {   // さあ、はじめよう！：金の4点滅 → 金の定常＋走る光。終わりに向けて強く（ゲーム開始の 'start' へ）
      if (u < .5) { const a = sq(u * 7, .5); all(o, a ? 1.5 : .25, GOLD); o.white = a && frac(u * 7) < .25 ? .4 : 0; rings(o, a ? .4 : .05); }
      else { for (let i = 0; i < 8; i++) reg(o, i, (.9 + .35 * u / 1.6) * (.7 + .3 * crest(i, ck * 2.5, 2)), GOLD); rings(o, .2); }
      hit(o, FLASH(u, 0, .1) * .7); if (u > 1.4) hit(o, (u - 1.4) / .2 * .5);
    }
  }
}
// ---------------------------------------------------------------- 2. JPチャンスのチュートリアル v04
// scene tutorial_jp_nN（6.9秒＝カット0-2.2 残った穴を指す / -4.5 封印はN個 / -6.9 玉はタダ）＋ tutorial_jp_fin（1.8秒 大量獲得のチャンス）。c.x = {d: 残った穴1..7, N: 封印の本数, fin: bool}
const TJP_BURST = [.3, 1.1, 1.8];            // tutorial_jp_overlay_1030.mjs の光の筋と同じ時刻
const TJP_TICK = [.3, .45, .6, .75, .9];     // 「1」「2」「3」「4」の出る時刻（カット1の頭 2.2 からの相対）
function tutjp(o, c) {
  const t = c.t, ck = c.clock, x = c.x || {}, d = clamp(x.d | 0, 1, 7) - 1, N = clamp(x.N | 0 || 4, 2, 5); begin(o);
  const side = d <= 2 ? LEFT : d >= 4 ? RIGHT : null, sideReg = d <= 2 ? 0 : d >= 4 ? 1 : -1;
  const pp = f => { const p = .5 + .5 * Math.sin(TAU * f * ck - 1.57); return p * p * (3 - 2 * p); };
  if (x.fin) {   // 玉大量獲得のチャンス!?：金→虹へ。穴は強く脈打ったまま
    const k = clamp(t / 1.8); for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, ck * 1.6 + .5 * PH[i]); const r = clamp((k - .2) / .6); tmp[0] += (GOLD[0] - tmp[0]) * (1 - r); tmp[1] += (GOLD[1] - tmp[1]) * (1 - r); tmp[2] += (GOLD[2] - tmp[2]) * (1 - r); reg(o, i, (.8 + .6 * k) * (.7 + .3 * crest(i, ck * 3, 2)), tmp); }
    holes(o, d, .8 + 1.6 * pp(3), mixc(GOLD, WHITE, .5)); rings(o, .15 + .2 * k); hit(o, FLASH(t, 0, .1) * .6); return;
  }
  const cut = t < 2.2 ? 0 : t < 4.5 ? 1 : 2, u = t - (cut === 0 ? 0 : cut === 1 ? 2.2 : 4.5);
  if (cut === 0) {   // 残った「1つの穴」を指す：封印の紫の暗がりの中を、光が上から穴へ駆け下りる。光の筋の3回で足元と穴が白く弾ける
    all(o, .3 + .08 * pp(1.2), PBLK); const sweep = frac(t * 1.1);
    if (side) { const up = sideReg === 0 ? 3 : 5, low = up + 1; reg(o, up, .35 + 1.1 * Math.max(0, 1 - Math.abs(sweep - .25) * 4), GOLD); reg(o, low, .35 + 1.1 * Math.max(0, 1 - Math.abs(sweep - .5) * 4), GOLD); }
    else { grp(o, HEAD, .35 + 1.1 * Math.max(0, 1 - Math.abs(sweep - .15) * 4), GOLD); grp(o, LEFT, .35 + 1.0 * Math.max(0, 1 - Math.abs(sweep - .45) * 4), GOLD); grp(o, RIGHT, .35 + 1.0 * Math.max(0, 1 - Math.abs(sweep - .45) * 4), GOLD); }
    reg(o, 7, .35 + 1.1 * Math.max(0, 1 - Math.abs(sweep - .75) * 4), GOLD);
    let b = 0; for (const bt of TJP_BURST) b = Math.max(b, FLASH(t, bt, .13)); if (t >= 2.2) b = 0;
    if (b > 0) { reg(o, 7, 1.3, WHITE); if (side) grp(o, side, .9 + .5 * b, mixc(GOLD, WHITE, b)); else grp(o, HEAD, .9, mixc(GOLD, WHITE, b)); hit(o, b * .6); }
    const hp = t > .35 ? .9 + 1.7 * pp(2.4) : .6;   // 矢印が出る 0.35s から穴が強く脈打つ（連打メーターの強調と同じ金→白金）
    holes(o, d, hp + 9 * b, mixc(GOLD, WHITE, b > .2 ? 1 : .35 * pp(2.4)));
    rings(o, .1 + .1 * pp(2.4));
  } else if (cut === 1) {   // 封印は N つ！入るたびに1つ解ける：紫の鼓動＋「1」〜「N」が出るたびに区画が一つずつ弾ける（左上→右上→左下→右下→足元）
    const beat = pulse(ck * 1.0, 4) + .5 * pulse(ck * 1.0 + .28, 5); all(o, .22 + .28 * beat, PBLK); rings(o, .06);
    const order = [3, 5, 4, 6, 7];
    for (let k = 0; k < N; k++) { const at = TJP_TICK[k] + 0; const f = FLASH(u, at, .12); if (f > .02) { reg(o, order[k], .4 + 1.3 * f, mixc(PBLK, GOLD, clamp(f * 1.3))); hit(o, f * .35); } if (u >= at) o.aK[order[k]] = Math.max(o.aK[order[k]], .5); }
    if (u > 1.6) hit(o, FLASH(u, 1.6, .12) * .6);
    holes(o, d, .7 + .8 * pp(1.2), GOLD);
  } else {   // 玉はタダ！どんどん撃て：玉が飛ぶ 0.3s ごとに左右の柱が交互に金で弾ける（連打の拍）。穴は速めに脈打つ
    const ph = frac(u / .3), k = Math.floor(u / .3) & 1, e = Math.exp(-ph * 5);
    all(o, .35, PBLK); grp(o, LEFT, .35 + (k ? 0 : 1.1 * e), GOLD); grp(o, RIGHT, .35 + (k ? 1.1 * e : 0), GOLD); reg(o, 7, .45 + .6 * e, GOLD); grp(o, HEAD, .45 + .25 * e, AMBER);
    holes(o, d, .9 + 1.6 * pp(3.3), mixc(GOLD, WHITE, .4 * pp(3.3))); rings(o, .08 + .12 * e);
  }
}
// ---------------------------------------------------------------- 3. 継続告知 v09（first 17.2秒 / repeat 20.5秒）
// 0-1.2 紙吹雪+うぱ+白 / 1.2-6.8 200 OVER FEVER（3.63 白） / 6.77 白 → 継続チャンス!!!（-8.6 桃→紫） / 8.63- 左右に割れる：左＝失敗側（33%・JackPot継続終了）紫、右＝成功側（67%・もう一回ルーレット）金
//   first: 15.5 白 → 狙え!!（桃青）/ repeat: 15.5 白 → 2/3 の選択（左 確定=紫、右 継続=金）
const CH = { fever: 1.2, ch0: 6.77, split: 8.63, fail: 10.0, win: 11.33, rou: 12.0, calm: 13.0, out: 15.45 };
function chain(o, c) {
  const t = c.t, ck = c.clock, rep = !!(c.x && c.x.repeat); begin(o);
  const pp = f => { const p = .5 + .5 * Math.sin(TAU * f * ck - 1.57); return p * p * (3 - 2 * p); };
  if (t < CH.fever) { const a = sq(t * 7.5, .5); rainbowAll(o, 1.0 * (a ? 1 : .55), t * 3, .9); rings(o, a ? .35 : .1); hit(o, FLASH(t, .97, .1) * .9 + FLASH(t, .2, .08) * .5); }
  else if (t < CH.ch0) {   // FEVER：虹の全灯が回る（7.5Hz の色替わり＋走る光）。3.63 に白い一発
    const k = .5 + .5 * Math.sin(TAU * ck * .3); const sl = Math.floor(ck * 6) / 8;
    for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, sl + .6 * PH[i]); reg(o, i, (1.0 + .4 * sq(ck * 3.75, .5)) * (.7 + .3 * crest(i, ck * 2.5, 2)), tmp); }
    rings(o, .25 + .1 * k); hit(o, FLASH(t, 1.2, .12) * .7 + FLASH(t, 3.63, .14) * .9);
  } else if (t < CH.split) {   // 継続チャンス!!!：6.77 白 → 桃 → 紫の稲妻（雷と同じく囲いも紫で点滅）
    const u = t - CH.ch0, k = clamp(u / 1.2);
    if (k < 1) { const col = mixc(PINK, VIOLET, k); all(o, .8 + .5 * pp(2.5), col); } else { const a = (u > 1.3 && u < 1.36) || (u > 1.55 && u < 1.62); all(o, a ? 1.55 : .55 + .2 * pp(2.5), a ? VIOLET : PDEEP); hit(o, a ? .5 : 0); }
    rings(o, .15); hit(o, FLASH(u, 0, .16) * .95);
  } else {
    const u = t - CH.split, out = t >= CH.out;
    // 左＝失敗側（紫・暗く重い鼓動 0.6Hz）／右＝成功側（金・明るく速い 2.4Hz）／頭と足元は両方の中間
    const beatL = .5 + .5 * Math.sin(TAU * .6 * ck - 1.57), goldR = .55 + .45 * pp(2.4);
    let Lf = .3 + .3 * beatL, Rf = .9 + .6 * goldR, Hf = .55;
    const Lc = PBLK.slice(), Rc = GOLD.slice();
    if (t >= CH.fail) { const f = FLASH(t, CH.fail, .15), dip = t < CH.fail + .5 ? 1 : 0; Lf = Lf * (1 - .55 * dip); if (f > .05) { Lc[0] = .5; Lc[2] = .9; } }   // 「JackPot継続終了」：左だけ一瞬暗く沈む
    if (t >= CH.win) { const f = FLASH(t, CH.win, .16); Rf += 1.0 * f; hit(o, f * .7); }
    if (t >= CH.rou && t < CH.calm) { const ph = (t - CH.rou); const col = mixc(GOLD, [1, .85, .4], pp(2)); Rc[0] = col[0]; Rc[1] = col[1]; Rc[2] = col[2]; Rf += .25 * sq(ck * 3.75, .5); }
    if (t >= CH.calm) { Lf *= .85; Hf = .5; }
    grp(o, LEFT, Lf * (.75 + .25 * crest(4, ck * .6, 1.5)), Lc); grp(o, RIGHT, Rf * (.8 + .2 * crest(6, ck * 2.4, 2)), Rc);
    grp(o, HEAD, Hf + .15 * pp(1.2), mixc(Lc, Rc, .5)); reg(o, 7, .55 + .15 * pp(1.2), mixc(Lc, Rc, .5));
    if (rep && t >= CH.calm + 1.3) { // 2/3 の選択へ：左（確定）紫・右（継続）金が交互に強まる
      const a = frac(ck * 1.2) < .5; grp(o, LEFT, a ? 1.0 : .5, VIOLET); grp(o, RIGHT, a ? .5 : 1.2, GOLD);
    }
    rings(o, .1);
    if (out) { const f = FLASH(t, CH.out, .12); hit(o, f * .9); if (!rep) { all(o, .8 + .4 * pp(2.5), mixc(PINK, BLUE, pp(.8))); rings(o, .15); } }
  }
}
// ---------------------------------------------------------------- 4. 封印の扉 JP通し v05（24.07秒）
// 0-1.0 雷 / 1.0-3.8 黒背景の字 / 3.8-5.5 JACKPOT CHANCE / 5.5- 封印の扉（残り4）/ 鎖が切れる KB[] で閃光→段が上がる / 17.0 最後の鎖 → 17.9 解放!! → 19.4 扉が開く（白→虹の全灯）→ 20.2 RUSH → 22.0 配当ルーレット
const SEAL_KB = [7.33, 10.33, 13.33, 17.0];
const SEAL_T = { chance: 3.8, door: 5.5, open: 19.4, rush: 20.2, roul: 22.0 };
// 残り本数 rem（総数 N）の待機の光。rem>=3：紫黒の暗い禍々しい鼓動（ゆっくり）／rem==2：金・激しく・扉の光が漏れる／rem==1：金の高速（あと一歩）
function sealStage(o, ck, rem, N, since) {
  const lub = pulse(ck * 1.0, 4) + .5 * pulse(ck * 1.0 + .28, 5), slow = .5 + .5 * Math.sin(TAU * .5 * ck - 1.57);
  if (rem >= 3) {
    const g = (N - rem) / Math.max(1, N), L = (.16 + .28 * lub + .1 * slow) * (1 + .5 * g), hz = .5 + .35 * g;
    all(o, L, PBLK);
    // 禍々しい赤い目：頭が赤紫でゆっくり点滅
    reg(o, 0, L * 1.3 * (.6 + .6 * sq(ck * hz * 1.4, .35)), mixc(PBLK, RED, .55)); reg(o, 1, L * 1.15, mixc(PBLK, RED, .35)); reg(o, 2, L * 1.15, mixc(PBLK, RED, .35));
    for (let i = 3; i < 8; i++) o.aK[i] *= .7 + .5 * crest(i, ck * hz * .6, 2);
    rings(o, .02 + .05 * lub);
  } else if (rem === 2) {
    const L = .75 + .6 * crest(0, ck * 1.0, 2); all(o, L, GOLD);
    // 扉の光が漏れる：中央から外へ ring が鼓動、頭は強く
    grp(o, HEAD, L * 1.25, mixc(GOLD, WHITE, .25)); for (let i = 3; i < 8; i++) o.aK[i] = L * (.65 + .55 * crest(i, ck * 2.2, 2.5));
    rings(o, .25 + .3 * (.5 + .5 * Math.sin(TAU * 2.2 * ck))); o.white = Math.max(o.white, .12 * sq(ck * 2.2, .2));
  } else {   // rem===1：あと一歩
    const a = sq(ck * 4.5, .5), L = a ? 1.5 : .6; all(o, L, a ? mixc(GOLD, WHITE, .3) : AMBER);
    for (let i = 0; i < 8; i++) o.aK[i] *= .75 + .25 * crest(i, ck * 3.5, 2);
    rings(o, a ? .5 : .15); o.white = Math.max(o.white, a && frac(ck * 4.5) < .22 ? .35 : 0);
  }
}
function sealThrough(o, c) {
  const t = c.t, ck = c.clock; begin(o);
  if (t < 1.0) { const a = t >= .27 && t < .33 || (t > .45 && t < .5); all(o, a ? 1.55 : t < .27 ? .75 : .22, a ? VIOLET : PDEEP); rings(o, a ? .4 : .08); hit(o, a ? .35 : 0); return; }          // 紫の雷（既存 'lightning' と同じ）
  if (t < SEAL_T.chance) { all(o, .22 + .12 * (.5 + .5 * Math.sin(TAU * .8 * ck)), PDEEP); return; }                              // 黒背景の字：暗い紫で息をする
  if (t < SEAL_T.door) { const u = t - SEAL_T.chance; const a = sq(ck * 7, .5); rainbowAll(o, a ? 1.4 : .5, ck * 2.5, .8); rings(o, a ? .35 : .1); hit(o, FLASH(u, .15, .12) * .9); return; }   // JACKPOT CHANCE：虹の強い点滅
  // 鎖の段
  let k = 0; for (let i = 0; i < SEAL_KB.length; i++) if (t >= SEAL_KB[i]) k = i + 1;
  const N = 4;
  if (t < SEAL_KB[3]) {
    const rem = N - k, since = k > 0 ? t - SEAL_KB[k - 1] : 99;
    sealStage(o, ck, rem, N, since);
    if (k > 0) {   // 鎖が切れる瞬間：閃光（白）→0.5秒で段の色へ。最後の1本は金の光が強く漏れる
      const f = FLASH(since, 0, .1), g2 = FLASH(since, 0, .35); hit(o, f * 1.0); for (let i = 0; i < 8; i++) o.aK[i] = Math.max(o.aK[i], 1.6 * g2 * (rem <= 2 ? 1 : .7));
      if (g2 > .2) for (let i = 0; i < 8; i++) { o.aC[i * 3] += (1 - o.aC[i * 3]) * .6 * g2; o.aC[i * 3 + 1] += (1 - o.aC[i * 3 + 1]) * .6 * g2; o.aC[i * 3 + 2] += (1 - o.aC[i * 3 + 2]) * .5 * g2; }
      rings(o, Math.max(o.aR[0], .5 * g2));
    }
    return;
  }
  // 最後の鎖が切れた後
  const u = t - SEAL_KB[3];
  if (t < SEAL_T.open) {   // 17.0 閃光 → 解放!!（17.9）金が溢れる → 19.4 に向けて白金へ膨らむ
    const k2 = clamp((t - 17.9) / (SEAL_T.open - 17.9)), f = FLASH(u, 0, .15);
    for (let i = 0; i < 8; i++) reg(o, i, (1.0 + .6 * k2) * (.75 + .25 * crest(i, ck * 3, 2)), mixc(GOLD, WHITE, k2 * .8));
    rings(o, .35 + .25 * k2); hit(o, f * 1.0 + k2 * k2 * .5);
  } else if (t < SEAL_T.rush) {   // 扉が開く：白 → 虹の全灯（穴も7つ虹）
    const v = t - SEAL_T.open, a = v < .25 ? 1 : 1;
    if (v < .22) { all(o, 1.9, WHITE); o.white = 1; rings(o, .6); for (let h = 0; h < 7; h++) holes(o, h, 3, WHITE); }
    else { const sl = ck * 3.2; rainbowAll(o, 1.9 * (sq(ck * 6, .6) ? 1 : .75), sl, .9); rings(o, .6); o.white = .25 * pulse(v * 6, 3);
      for (let h = 0; h < 7; h++) { hsvTo(tmp, 0, sl + h / 7); holes(o, h, 2.2, tmp); } }
  } else if (t < SEAL_T.roul) {   // RUSH：虹の回転（7.5Hz 以下の色替わり）
    const v = t - SEAL_T.rush; rainbowAll(o, 1.15 + .4 * sq(ck * 4.5, .5), ck * 2.4, .7); rings(o, .3); hit(o, FLASH(v, 0, .12) * .6);
    for (let h = 0; h < 7; h++) { hsvTo(tmp, 0, ck * 2.4 + h / 7); holes(o, h, 1.6, tmp); }
  } else { const v = t - SEAL_T.roul; all(o, .8 + .5 * pulse(ck * 3, 2.5), GOLD); rings(o, .2); hit(o, FLASH(v, 0, .12) * .7); }
}
// 待機ループ（3秒）：JPの連打メーター中に流す。c.x = {rem 残り本数, N 総数}。鼓動は映像の 1Hz（3拍/3秒）に合わせる
function sealIdle(o, c) {
  const x = c.x || {}, N = clamp(x.N | 0 || 4, 2, 5), rem = clamp(x.rem | 0 || N, 1, N); begin(o);
  sealStage(o, c.clock, rem, N, 99);
}
registerGrammar('nl_tut06', tut06);
// ---------------------------------------------------------------- 1b. 冒頭チュートリアル v09（50.2秒・14カット。2回目向けの短い版は t+40 秒の位置から）
// 0 目標(0-4.0) / 1 残り時間(-6.8) / 2 ボタン(-10.6) / 3 玉→ランプ(-14.0) / 4 ついていない穴(-16.8) / 5 重複(-21.0) / 6 5灯→雷(-23.6) / 7 扉(-25.6) / 8 JACKPOT CHANCE(-27.3) / 9 連打・鎖(-30.7) / 10 解放(-33.3) / 11 玉がドッと(-36.7) / 12 継続(-40.0) / 13 まとめ(-47.4) / 14 はじめよう(-50.2)
// 注意：どの量も時間とともに増え続けない（v06 は終わりに白が増え続けて液晶が白く飛んだ）。最後の状態で止まる。
const TUT09 = [0, 4.0, 6.8, 10.6, 14.0, 16.8, 21.0, 23.6, 25.6, 27.3, 30.7, 33.3, 36.7, 40.0, 47.4, 50.2];
const LIT4 = [1, .82, .55];
function tut09(o, c) {
  const t = c.t, ck = c.clock; begin(o);
  let cut = 0; while (cut < 14 && t >= TUT09[cut + 1]) cut++;
  const u = t - TUT09[cut], pl = .5 + .5 * Math.sin(TAU * 2.4 * ck - 1.57), ps = pl * pl * (3 - 2 * pl);
  switch (cut) {
    case 0: for (let i = 0; i < 8; i++) reg(o, i, .5 + .5 * crest(i, ck * .6, 1.5) * ease(u / .5), GOLD); rings(o, .12); hit(o, FLASH(u, .15, .14) * .6); break;   // 目標：金のゆっくりした波
    case 1: all(o, .25, BLUE); grp(o, HEAD, .6 + .8 * ps, mixc(GOLD, WHITE, ps * .5)); rings(o, .1); hit(o, FLASH(u, .5, .1) * .3); break;   // 残り時間（上の表示器）を指す
    case 2: {   // ボタン：左の柱が金→白に脈打つ。押した瞬間(0.35s)に一発
      all(o, .22, BLUE); grp(o, LEFT, .8 + .85 * ps, mixc(GOLD, WHITE, ps * .7)); reg(o, 7, .3 + .5 * crest(4, ck * 2.4, 3), GOLD); rings(o, .08 + .1 * ps); hit(o, FLASH(u, .35, .12) * .55); break;
    }
    case 3: {   // 玉が穴に入ってランプが光る(1.6s)：穴が1つ白く閃いて点く
      all(o, .3, BLUE); if (u >= 1.55) { const f = FLASH(u, 1.55, .12); lamp(o, 0, 1.5 + 9 * f, f > .3 ? WHITE : LIT4); reg(o, 7, .4 + .9 * f, mixc(GOLD, WHITE, f * .5)); hit(o, f * .35); } rings(o, .1); break;
    }
    case 4: {   // ついていない穴をねらう：4つ点灯、残る2つが金で脈打つ
      all(o, .3, BLUE); for (let k = 0; k < 4; k++) lamp(o, k, 1.4, LIT4);
      for (let k = 4; k < 6; k++) lamp(o, k, .5 + 1.5 * ps, mixc(GOLD, WHITE, ps * .6)); rings(o, .1); break;
    }
    case 5: {   // 重複：赤く警告（2.4Hz）。「重複!!」(1.6s)で白、ランプが1つ消える(3.0s)
      const n = u < 3.0 ? 4 : 3; for (let k = 0; k < n; k++) lamp(o, k, 1.3, LIT4);
      const a = .35 + .65 * ps; all(o, (u < 1.5 ? .3 : .6 + .6 * a), RED); rings(o, .1 + .15 * a);
      hit(o, FLASH(u, 1.6, .12) * .5 + FLASH(u, 3.0, .12) * .4); break;
    }
    case 6: {   // 5灯→紫の雷：はじめ金の交互（5Hz）、1.2s から紫（雷は囲いも紫）
      for (let k = 0; k < 6; k++) lamp(o, k, 1.5, LIT4);
      if (u < 1.2) { const a = sq(ck * 5, .55); all(o, a ? 1.4 : .3, a ? GOLD : RED); rings(o, a ? .35 : .08); hit(o, FLASH(u, 0, .12) * .6); }
      else { const a = sq(ck * 5, .5); all(o, a ? 1.4 : .35, a ? VIOLET : PBLK); rings(o, a ? .35 : .1); hit(o, FLASH(u, 1.2, .1) * .7); }
      break;
    }
    case 7: for (let k = 0; k < 6; k++) lamp(o, k, 1.5, LIT4); for (let i = 0; i < 8; i++) reg(o, i, .6 + .5 * crest(i, ck * 1.2, 2), VIOLET); rings(o, .12); break;   // 扉へ近づく
    case 8: {   // JACKPOT CHANCE（題字）：金の強い脈動＋一発
      for (let k = 0; k < 6; k++) lamp(o, k, 1.5, LIT4); lamp(o, 6, .6 + 1.6 * ps, mixc(GOLD, WHITE, ps * .6));
      for (let i = 0; i < 8; i++) reg(o, i, 1.0 + .5 * crest(i, ck * 2.4, 2), GOLD); rings(o, .25); hit(o, FLASH(u, .1, .14) * .8); break;
    }
    case 9: {   // 連打・鎖：残った1つの穴が金で脈打つ。頭は紫
      for (let k = 0; k < 6; k++) lamp(o, k, 1.2, LIT4); lamp(o, 6, .6 + 1.8 * ps, mixc(GOLD, WHITE, ps * .7));
      for (let i = 0; i < 8; i++) reg(o, i, .55 + .45 * crest(i, ck * 2, 2), i < 3 ? VIOLET : PBLK); rings(o, .12); hit(o, FLASH(u, 1.7, .1) * .25); break;
    }
    case 10: {   // 解放：白金の一発→金
      for (let k = 0; k < 7; k++) holes(o, k, 1.6, GOLD); for (let i = 0; i < 8; i++) reg(o, i, 1.0 + .5 * crest(i, ck * 2.4, 2), GOLD); rings(o, .3); hit(o, FLASH(u, 0.3, .14) * .9); break;
    }
    case 11: {   // 玉がドッと：虹が回る
      const k = clamp(u / 1.5), hz = 3 + 2 * k, step = Math.floor(ck * hz) / 8;
      for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, step + .55 * PH[i]); reg(o, i, (.8 + .5 * k) * (.75 + .25 * crest(i, ck * 2, 2)), tmp); } rings(o, .25); hit(o, FLASH(u, 0, .1) * .4); break;
    }
    case 12: {   // 継続：赤と金の交互（2.4Hz）
      const a = frac(ck * 2.4) < .5; all(o, 1.0 + .3 * crest(2, ck * 2, 2), a ? RED : GOLD); rings(o, .2); hit(o, FLASH(u, 0, .1) * .5); break;
    }
    case 13: {   // まとめ：行が出るごと（0.2/2.2/4.3s）に穴が点く。落ち着いた青＋金
      all(o, .35 + .1 * ps, BLUE); const n = u < 2.2 ? 1 : u < 4.3 ? 2 : 3;
      for (let k = 0; k < 7; k++) if (k < (n === 1 ? 1 : n === 2 ? 6 : 7)) holes(o, k, 1.3, n === 3 ? GOLD : LIT4);
      grp(o, HEAD, .5 + .3 * ps, GOLD); if (!HOLEDECO) { const f = Math.max(FLASH(u, .2, .12), FLASH(u, 2.2, .12), FLASH(u, 4.3, .12)); grp(o, LEFT, .35 + .9 * f, GOLD); grp(o, RIGHT, .35 + .9 * f, GOLD); } hit(o, FLASH(u, .2, .1) * .3 + FLASH(u, 2.2, .1) * .3 + FLASH(u, 4.3, .1) * .3); rings(o, .1); break;
    }
    default: {   // はじめよう：金の定常＋走る光（増え続けない）
      if (u < .5) { const a = sq(u * 7, .5); all(o, a ? 1.5 : .25, GOLD); o.white = a && frac(u * 7) < .25 ? .4 : 0; rings(o, a ? .4 : .05); }
      else { for (let i = 0; i < 8; i++) reg(o, i, 1.0 * (.7 + .3 * crest(i, ck * 2.5, 2)), GOLD); rings(o, .2); }
      hit(o, FLASH(u, 0, .1) * .7);
    }
  }
}
registerGrammar('nl_tut09', tut09);

registerGrammar('nl_tutjp', tutjp);
registerGrammar('nl_chain', chain);
registerGrammar('nl_seal', sealThrough);
registerGrammar('nl_seal_idle', sealIdle);
export const NL_SCENES = { tutorial_v06: 'nl_tut06', tutorial_v09: 'nl_tut09', jp_through_v05: 'nl_seal', chain_flow_first: 'nl_chain', chain_flow_repeat: 'nl_chain', seal_idle: 'nl_seal_idle', tutorial_jp: 'nl_tutjp' };
export const NL_TIMES = { TUT06, TJP_BURST, TJP_TICK, CH, SEAL_KB, SEAL_T };

// ---------------------------------------------------------------- 5. 待機画面（attract / title）：囲い・盤面電飾・穴・外部LEDが常に虹色に点滅（10/30 監督）
// 虹が囲いを一周する（頭→右→下→左：PH の順、約3秒で一周）＋ 3.75Hz（8コマ周期）の明滅＋走る光。待機映像（20秒ループ）の切り替わりの拍（ATT_BEATS）で白い一発。
// 映像が差し替わったら ATT_BEATS を合わせ直す（work/effects/attract/v5）。遊技が始まれば attractSurface が止まり、通常の光へ戻る。
export const ATT_BEATS = [3.5, 5.83, 7.23, 8.47, 9.23, 13.63, 19.8];
function attract(o, c) {
  const t = c.t, ck = c.clock; begin(o);
  const hue = ck * .34, wave = .5 + .5 * Math.cos(TAU * 3.75 * ck), blink = .55 + .75 * Math.pow(wave, 1.4);
  for (let i = 0; i < 8; i++) { hsvTo(tmp, 0, hue + PH[i]); reg(o, i, blink * (.7 + .3 * crest(i, ck * 1.2, 2)), tmp); }
  let b = 0; for (const bt of ATT_BEATS) b = Math.max(b, FLASH(t % 20, bt, .14));
  if (b > .02) { hit(o, b * .55); for (let i = 0; i < 8; i++) o.aK[i] = Math.max(o.aK[i], 1.3 * b); }
  for (let j = 0; j < 4; j++) o.aR[j] = .1 + .3 * Math.pow(.5 + .5 * Math.cos(TAU * 3.75 * ck - j * .9), 2); o.ringOwn = true;
  for (let h = 0; h < 7; h++) { hsvTo(tmp, 0, hue * 1.0 + h / 7 * .9); holes(o, h, .9 + .9 * Math.pow(.5 + .5 * Math.cos(TAU * 3.75 * ck - h * .5), 2), tmp); }
  hsvTo(tmp, 0, hue); o.sOv = true; o.sc[0] = tmp[0]; o.sc[1] = tmp[1]; o.sc[2] = tmp[2];
}
registerGrammar('nl_attract', attract);
NL_SCENES.attract_rainbow = 'nl_attract';
