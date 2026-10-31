// 11/01 継続/確定の選択画面で「継続のどこが嬉しいか」を一目で伝える（監督：継続の嬉しさの説明は追加に直結する。端的に）。
//   ・継続の札に、実機風の大きな字で得を短く：「せいこうで ／ B賞！（または +30こ！）／ しっぱいでも 玉は そのまま」。極太明朝×虹グラデ×白銀縁＋黒縁（テロップの様式）。背景は染めない。
//   ・うぱの一言（upa_flow_1031 の ch16_*）も同じ事実で言う。うぱの吹き出しが出ている間は字を引っ込め、終わったら戻る（決める直前にもう一度見える）。
//   ・数字は規則と状態から読む（直書きしない）：継続に成功すると、ルーレットで JackpotAwards の配当（最小 30 玉、確率は JackpotWeights）が今の玉に足される。
//     今の玉（prizeScore＝持ち玉＋積み増し）に最小の配当を足して次の賞（PrizeThresholds）に届くなら「その賞」、届かないなら「ぜったい +30こ」と言う（嘘にならない側）。
//     失敗したとき：最初のJPの配当と今の持ち玉は残る。失うのは継続で積み増した分（jackpotChain.pendingAward）だけ。JP直後の最初の継続は積み増しが 0 なので「玉はそのまま」。
//   ・選択の秒は増やさない（既存の選択画面の秒に重ねる）。自動で決めない。H 規則のときだけ（G は出さない）。?chainwhy=0 で旧（字なし・旧の台詞）。
//   ・軽さ：小さい層（lcd.jpHud.splitLayers に足す。読み戻し・全画面転送なし）。絵は内容ごとに1度だけ作って使い回す（最大でも 数枚の 600×300 級の canvas）。動き（叩きつけ・脈動）は行列と不透明度だけ。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';

export const chainWhyOn = (search = globalThis.location?.search ?? '') => new URLSearchParams(search).get('chainwhy') === '1';   // 11/01 監督の指示で既定オフ（うぱの台詞そのものを改善した）。?chainwhy=1 で字と台詞の試作

const PX = 34, PY = 28, W_PANEL = 1152;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const easeOut = (u) => 1 - (1 - clamp(u)) ** 3;
const FONT = '"Kaisei Tokumin","Noto Serif CJK JP",serif';
export async function loadWhyFont() {
  try { if (document.fonts.check('800 20px "Kaisei Tokumin"')) return true; const f = new FontFace('Kaisei Tokumin', `url(${new URL('../../../effects/jp_teacher/05_choice/r2/src/fonts_dl/KaiseiTokumin-ExtraBold.ttf', import.meta.url).href})`, { weight: '800' }); await f.load(); document.fonts.add(f); return true; } catch (e) { console.warn('[chain-why] font', e); return false; }
}
const RAINBOW = [[0, '#fff7a8'], [0.28, '#ffb64a'], [0.5, '#ff5aa6'], [0.52, '#7a1a6a'], [0.72, '#9a6bff'], [1, '#5fd2ff']];
const SILVER = [[0, '#ffffff'], [0.45, '#e9eaf5'], [0.5, '#9fa2c4'], [1, '#ffffff']];
const WHITE = [[0, '#ffffff'], [0.55, '#efe9ff'], [1, '#b9b0e6']];
const GOLD = [[0, '#fff7c0'], [0.35, '#ffd23a'], [0.62, '#ff9a12'], [1, '#d4410a']];
const CYAN = [[0, '#f4ffff'], [0.5, '#9defff'], [1, '#4fb4ee']];

// ---- 事実：規則と今の状態から（直書きしない）。H 規則でなければ null ----
export function chainWhyFacts(game) {
  const r = game?.rules; if (!r || r.RuleVariant !== 'H_20261029') return null;
  const chain = game.jackpotChain; if (!chain) return null;
  const th = r.PrizeThresholds ?? [], names = r.PrizeNames ?? [], awards = r.JackpotAwards ?? [];
  const minAward = Math.min(...awards), maxAward = Math.max(...awards);
  const score = Math.max(0, Math.floor(game.prizeScore ?? ((game.wallet ?? 0) + (chain.pendingAward ?? 0))));
  let rank = 0; for (let i = 0; i < th.length; i++) if (score >= th[i]) rank = i;
  const next = rank < th.length - 1 ? rank + 1 : null, need = next == null ? 0 : th[next] - score;
  const certain = next != null && need <= minAward;   // 成功すれば（最小の配当でも）必ず次の賞に届く
  const risk = chain.pendingAward ?? 0;
  return { stage: chain.stage ?? 0, score, rank, next, need, minAward, maxAward, certain, rankName: certain ? names[next] : null, rankIdx: certain ? next : -1, risk, free: risk <= 0 };
}
// うぱの台詞の id（upa_flow_1031 が使う）。noclock＝時計0で100円（チケット）が要る選択
export function chainWhyLineId(facts, { noclock = false } = {}) {
  if (!facts) return null;
  return `ch16${noclock ? 'n' : ''}_${facts.free ? 'a' : 'b'}_${facts.certain ? 'rank' : 'gain'}`;
}

// ---- 字：極太明朝×虹/金/白グラデ×白銀縁＋黒縁（hint_h の telop と同じ作り。色だけ選べる。小さい字は縁を細くして潰れを防ぐ）----
function metalText(ctx, str, x, y, size, { fill = RAINBOW, glow = 'rgba(255,100,190,.9)', align = 'center' } = {}) {
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.translate(x, y);
  const small = size < 100, kb = small ? 0.2 : 0.30, ks = small ? 0.11 : 0.19, ki = small ? 0.05 : 0.085;
  const grad = (stops) => { const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
  ctx.shadowColor = glow; ctx.shadowBlur = size * 0.22;
  ctx.strokeStyle = '#12020e'; ctx.lineWidth = size * kb; ctx.strokeText(str, 0, 0);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = grad(SILVER); ctx.lineWidth = size * ks; ctx.strokeText(str, 0, 0);
  ctx.strokeStyle = '#1a0420'; ctx.lineWidth = size * ki; ctx.strokeText(str, 0, 0);
  ctx.strokeStyle = grad(fill); ctx.lineWidth = size * 0.045; ctx.strokeText(str, 0, 0);
  ctx.fillStyle = grad(fill); ctx.fillText(str, 0, 0);
  ctx.globalCompositeOperation = 'lighter'; const hl = ctx.createLinearGradient(0, -size * 0.5, 0, -size * 0.05); hl.addColorStop(0, 'rgba(255,255,255,.38)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hl; ctx.fillText(str, 0, 0);
  ctx.restore();
}
const fit = (ctx, str, size, maxW) => { ctx.save(); ctx.font = `800 ${size}px ${FONT}`; const w = ctx.measureText(str).width + size * 0.32; ctx.restore(); return w > maxW ? Math.floor(size * maxW / w) : size; };
const bigText = (f) => (f.certain ? `${f.rankName}！` : `+${f.minAward}こ！`);
const riskText = (f) => (f.free ? 'しっぱいでも 玉は そのまま' : `しっぱいすると ${f.risk}こ なくなる`);

// 継続の札に載せる小さな字（tag）：「せいこうで ／ B賞！」。決める直前（うぱの吹き出しが引いたあと）に見える。
export const TAG_W = 600, TAG_H = 236;
export function drawTag(ctx, facts) {
  ctx.clearRect(0, 0, TAG_W, TAG_H); const cx = TAG_W / 2, maxW = TAG_W - 20;
  metalText(ctx, 'せいこうで', cx, 30, fit(ctx, 'せいこうで', 56, maxW), { fill: WHITE, glow: 'rgba(150,110,255,.8)' });
  metalText(ctx, bigText(facts), cx, 138, fit(ctx, bigText(facts), facts.certain ? 168 : 148, maxW), { fill: RAINBOW });
}
// 入りの大きな字（big）：選択画面が出た直後に、画面の幅いっぱいで叩きつける（うぱの吹き出しが出るまでの間）。「せいこうで ／ B賞！ ／ しっぱいでも 玉は そのまま」
export const BIG_W = 1040, BIG_H = 460;
export function drawBig(ctx, facts) {
  ctx.clearRect(0, 0, BIG_W, BIG_H); const cx = BIG_W / 2, maxW = BIG_W - 24;
  metalText(ctx, 'せいこうで', cx, 56, fit(ctx, 'せいこうで', 100, maxW), { fill: WHITE, glow: 'rgba(150,110,255,.85)' });
  metalText(ctx, bigText(facts), cx, 218, fit(ctx, bigText(facts), facts.certain ? 290 : 250, maxW), { fill: RAINBOW });
  const t3 = riskText(facts);
  metalText(ctx, t3, cx, 414, fit(ctx, t3, 64, maxW), { fill: facts.free ? CYAN : WHITE, glow: facts.free ? 'rgba(80,200,255,.85)' : 'rgba(255,90,90,.85)' });
}

// ---- 札の位置（rules_h_20261029 の CARD と同じ実測：継続の札の中心と枠の幅）。切り替え中は choiceV20.transition の重みで補間 ----
const CARD = { neutral: { cx: 819, cy: 650, frame: 556 }, right: { cx: 800, cy: 650, frame: 556 }, left: { cx: 897, cy: 655, frame: 443 } };
const NORMAL = { dy: 70, ratio: 0.9 };         // 札の中の、PUSH ボタンの下〜「継続」の字の上に収める
const ADD = { dy: -30, ratio: 0.64 };            // 100円の追加が要るとき：「100円で継続」の字が下(y745)にあるので上へ寄せて小さく
export function whyPlace(sel, tr, add) {
  const gs = CARD[sel] ?? CARD.neutral; let G = gs;
  if (tr?.from && CARD[tr.from]) { const a = CARD[tr.from], k = clamp(tr.alpha ?? 1); G = { cx: a.cx + (gs.cx - a.cx) * k, cy: a.cy + (gs.cy - a.cy) * k, frame: a.frame + (gs.frame - a.frame) * k }; }
  const P = add ? ADD : NORMAL;
  return { x: G.cx, y: G.cy + P.dy, sc: G.frame * P.ratio / TAG_W };
}
const BIG_AT = { x: 576, y: 520 };   // 大きな字の中心（液晶の面の座標）

// ---- 取り付け ----
const BIG_FROM = 0.25, BIG_HOLD = 1.35, BIG_OUT = 0.2;   // 大きな字：選択画面が出て 0.25 秒で叩きつけ、1.35 秒まで保ち、0.2 秒で引く（うぱの吹き出しは 1.6 秒から）
export async function attachChainWhy(lcd, { controller, log = () => {} } = {}) {
  if (!lcd?.production || lcd.chainWhy || !chainWhyOn()) return lcd;
  const g = () => controller.game, base = { frame: lcd.frame.bind(lcd) };
  await loadWhyFont();
  const cache = new Map();   // 内容ごとに 1 度だけ作る
  const keyOf = (f) => `${f.certain ? 'r' + f.rankName : 'g' + f.minAward}|${f.free ? 'f' : 'k' + f.risk}`;
  const texFor = (kind, f) => {
    const k = kind + '|' + (kind === 'tag' ? keyOf(f).split('|')[0] : keyOf(f)); let e = cache.get(k);
    if (!e) {
      const c = document.createElement('canvas'); c.width = kind === 'tag' ? TAG_W : BIG_W; c.height = kind === 'tag' ? TAG_H : BIG_H;
      (kind === 'tag' ? drawTag : drawBig)(c.getContext('2d'), f); e = { tex: layerTexture(THREE, c) }; cache.set(k, e); try { lcd.gpuPanelSource?.backend?.initTexture?.(e.tex); } catch {}
    }
    return e;
  };
  const glowC = document.createElement('canvas'); glowC.width = 256; glowC.height = 256;   // 着いた瞬間の白い閃光（にじみのみ）
  { const x = glowC.getContext('2d'), gr = x.createRadialGradient(128, 128, 6, 128, 128, 126); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,230,170,.45)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); }
  const glowTex = layerTexture(THREE, glowC);
  (lcd.splitWarmers ??= []).push({ name: 'chainwhy', done: false, step(r) { try { r.initTexture(glowTex); } catch {} return (this.done = true); } });
  const S = { t: null, cur: null, key: null, drawn: 0, bigDone: false, busy: false, backAt: null };
  const flowBusy = () => { const f = lcd.upaHost?.flow?.state; return !!(f && (f.cur || f.seq || f.ask)); };   // うぱの吹き出しが出ている間は引っ込める
  lcd.frame = (dt, F) => {
    base.frame(dt, F);
    const game = g(), cv = lcd.choiceV20, on = game.phase === 'ChainChoice' && (game.choiceLeft ?? 0) > 0 && !!cv?.active && !!game.jackpotChain?.choicePending;
    const facts = on ? chainWhyFacts(game) : null;
    if (!facts) { S.t = null; S.cur = null; S.key = null; S.backAt = null; S.busy = false; return; }
    S.t = (S.t ?? 0) + dt;
    const busy = flowBusy(); if (S.busy && !busy) S.backAt = S.t; if (busy) S.backAt = null; S.busy = busy;
    S.cur = { facts, add: !!game.chainNeedsAdd, sel: cv.selected ?? 'neutral', tr: cv.transition, busy };
    S.drawn++;
  };
  const layers = (room) => {
    const c = S.cur; if (!c || S.t == null || room < 1) return null;
    const t = S.t, f = c.facts, out = [];
    // (1) 大きな字：入りの 0.25〜1.55 秒。吹き出しが先に出たら引く。2 回目の選択（連が増えた）でも毎回出る
    const t0 = t - BIG_FROM, endAt = BIG_FROM + BIG_HOLD;
    if (t0 >= 0 && t < endAt + BIG_OUT && !c.busy && room >= 1) {
      const u = t0 - 0.14, slam = u < 0 ? 2.4 - 1.4 * (t0 / 0.14) ** 2 : 1 + 0.07 * Math.exp(-9 * u) * Math.cos(u * 38);
      const sh = u >= 0 && u < 0.5 ? Math.sin(u * 100) * 12 * Math.exp(-u * 16) : 0, sv = u >= 0 && u < 0.5 ? Math.cos(u * 83) * 8 * Math.exp(-u * 16) : 0;
      const alpha = clamp(t0 / 0.04) * (t > endAt ? 1 - (t - endAt) / BIG_OUT : 1);
      const e = texFor('big', f), x = PX + BIG_AT.x + sh, y = PY + BIG_AT.y + sv, sc = Math.min(1, (W_PANEL - 8) / BIG_W) * slam * (1 + 0.01 * Math.sin(t * 5));
      if (u >= 0 && u < 0.3 && room >= 2) out.push({ tex: glowTex, w: 256, h: 256, ax: 128, ay: 128, x: PX + BIG_AT.x, y: PY + BIG_AT.y, rot: 0, sc: 5.2, alpha: 0.8 * (1 - u / 0.3) ** 2, add: true });
      out.push({ tex: e.tex, w: BIG_W, h: BIG_H, ax: BIG_W / 2, ay: BIG_H / 2, x, y, rot: 0, sc, alpha, add: false });
      return out;
    }
    // (2) 札の小さな字：大きな字が終わり、吹き出しが出ていないとき（吹き出しが引いたあとにも戻る＝決める直前）
    if (t < endAt || c.busy) return null;
    const p = whyPlace(c.sel, c.tr, c.add), leftK = c.sel === 'left' ? (c.tr?.from && c.tr.from !== 'left' ? 1 - clamp(c.tr.alpha ?? 1) : 0) : 1;   // 確定側を触っている間は PUSH ボタンと重なるので引く
    const inK = clamp((t - (S.backAt ?? endAt + BIG_OUT * 0.5)) / 0.2), pop = S.backAt != null && t - S.backAt < 0.25 ? 1 + 0.16 * (1 - (t - S.backAt) / 0.25) ** 2 : 1;
    const alpha = Math.max(clamp((t - endAt) / BIG_OUT), inK) * leftK;
    if (alpha <= 0.01) return null;
    const e = texFor('tag', f);
    out.push({ tex: e.tex, w: TAG_W, h: TAG_H, ax: TAG_W / 2, ay: TAG_H / 2, x: PX + p.x, y: PY + p.y, rot: 0, sc: p.sc * pop * (1 + 0.012 * Math.sin(t * 5)), alpha, add: false });
    return out;
  };
  // 選択：choice_btn と同じ。lcd.jpHud.splitLayers に足す（play_fx が GPU の映像の上へ小さな層として重ねる）
  const hasHost = () => typeof lcd.jpHud?.splitLayers === 'function';
  let hooked = false;
  const hook = () => { if (hooked || !hasHost()) return; hooked = true; const o = lcd.jpHud.splitLayers.bind(lcd.jpHud); lcd.jpHud.splitLayers = () => { const a = o(); if (!S.cur) return a; const b = layers(12 - (a?.length ?? 0)); return a && b ? [...a, ...b] : (a ?? b); }; };
  hook(); const fr = lcd.frame; lcd.frame = (dt, F) => { hook(); return fr(dt, F); };
  lcd.chainWhy = { state: S, layerHost: hasHost, facts: () => chainWhyFacts(g()), get drawn() { return S.drawn; }, get cached() { return cache.size; } };
  return lcd;
}
