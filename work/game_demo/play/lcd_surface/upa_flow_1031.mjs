// 10/31 うぱ接客：JP・継続の説明（台本 8〜15。effects/upa_host/adaptive.json の jp_flow）。?upahost=0 で付かない。
//   説明は規則の stage==='tutorial' の間（時計もメーターの秒も止まる既存の段）。「それじゃあ いくよ！」のあと game.endJpTutorial() を呼ぶと、規則がカウントダウン（jp_count_1031）へ進める。
//   JP は JpTutorialSeconds/JpTutorialEvery を入れるだけ。継続は規則が段を作らないので、メーターの導入の間に meter.tutorial を足す（_endIntro は kind を見ない）。規則のファイルは変えない。
//   数字は規則と状態から読む：秒・回数＝meterStatus（jpMeterFor / chainThresholdFor の結果）、{AWARD_MAX}＝JackpotAwards、{RATE_TEXT}＝ChainDisplayProbability、{AT_RISK}{FIRST}＝jackpotChain。
//   10/31 監督（継続の流れ。?upahost=0 で旧の告知＋最初の自動継続）：配当の見せ場 → 選択画面（初回から客が選ぶ。問いなしで毎回：初回も2回目以降も1セリフ。しゃべりは選択を止めない）→ 継続チャンスのカットイン（chain_announce_cutin）→ 継続の盤面 →「ルール、きく？」→ JP と同じ。規則のファイルは変えず、実行時に ChainFirstAuto=false・ChainAnnounceSeconds=0 を入れる。
//   台詞を出してよい時間は adaptive.json の jp_flow.speak_windows（見せ場は showpiece() で吹き出しを止め、表情だけ）。
//   ルーレットの結果は止まるまで読まない（rouletteStatus.award は止まったあとだけ使う）。液晶へは層で重ねる（lcd.jpHud.splitLayers。2D・GPU どちらの経路でも出る）。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
import { HOLE_X } from './tutorial_jp_overlay_1030.mjs';

const PX = 34, PY = 28, W = 1152, GROUND = 1262, CELL = 6, MG = 8 * CELL, BROWN = '#30180a', GOLD = '#f0b840', CREAM = '#fff6de';
const TIP_Y = 1176;   // しっぽの先（穴の少し上。穴のLEDを隠さない）
const ASK_SEC = 4, ASK_GATE = 1.5, ASK_MAX = 2, EXPRS = ['idle', 'joy', 'big_joy', 'surprise', 'oshii', 'sad', 'cheer', 'panic'];
const LINE_EXPR = { time_start: 'surprise', jp8_wow: 'surprise', jp8_come: 'big_joy', jp8_last: 'joy', jp8_award: 'big_joy', jp8_hole: 'cheer', jp8_free: 'joy', jp8_go: 'cheer', jp8s: 'cheer', ch15_how: 'cheer', ch15s: 'cheer', jp9_go: 'cheer', jp9_good: 'big_joy', jp9_slow: 'cheer', jp9_half: 'cheer', jp9_close: 'panic', jp9_oshii: 'oshii', rl11_how: 'cheer', rl11_short: 'cheer', jp12_clock: 'cheer', jp12_noclock: 'oshii', ch13_next: 'joy', ch13_a: 'big_joy', ch13_safe: 'joy', ch13_pick: 'idle', ch13_noclock: 'surprise', ch14_rate: 'joy', ch14_again: 'panic', ch14_keep: 'joy', ask_jp: 'idle', ask_chain: 'idle' };
const JP_SEC = 22, CH_SEC = 16, GRACE = 8, SKIP_GAP = 0.4, SKIP_AGE = 0.8;
const UPA_N = 12, UPA_FOOT = 1170, ARROW_W = 200, ARROW_H = 300, ARROW_AT = 0.35, HOLE_LINE = /^(jp8_hole|jp8s|ch15_how|ch15s)$/, CUT = 'chain_announce_cutin', CUT_SEC = 2.8;   // 説明の主役のうぱは大きく。穴を指す文は穴の横へ歩いて、大きな矢印で実際の穴を指す
const SHOWPIECE = /^(roulette_|reward_|chain_success|chain_jp_land|jp_rush|jp_bridge|jp_land|fail|chain_announce_)/;
const CHOICE_LINE_AT = 1.6;   // 選択画面の入りの映像が終わってから台詞
const FIRST_CHOICE = true;   // 10/31 監督訂正：33%/67%の告知は本編から外す（旧は ?upahost=0 だけ）
const TONE = { jp8_praise: 'joy', jp8_go: 'joy', jp8s: 'joy', jp9_go: 'joy', jp9_close: 'joy', jp10_ok: 'joy', rl11_big: 'joy', rl11_ok: 'joy', ch15_head: 'joy', ch15s: 'joy', jp9_slow: 'surp', jp9_oshii: 'surp', rl11_dokidoki: 'surp', ch13_noclock: 'surp' };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeBack = (x) => { const c = 1.7, u = clamp(x, 0, 1) - 1; return 1 + (c + 1) * u ** 3 + c * u ** 2; };

export function createUpaFlow(lcd, { controller, base, labels, liveVisible = () => false, sfx, log = () => {} }) {
  const game = () => controller.game;
  const R = { meta: null, img: {}, ready: false };
  const bigC = mk(W + 2 * MG, 760), smallC = mk(W + 2 * MG, 560);
  const arrowC = mk(ARROW_W, ARROW_H);
  { const x = arrowC.getContext('2d'), cx = ARROW_W / 2;   // 下向きの大きな矢印（ドットの段）
    const arrow = (pad, c) => { x.fillStyle = c; x.fillRect(cx - 48 + pad, pad, 96 - 2 * pad, 170); for (let i = 0; i < 14; i++) { const hw = (ARROW_W / 2 - pad) * (1 - i / 14) - pad * 0.4; if (hw > 0) x.fillRect(Math.round(cx - hw), 150 + i * 10, Math.round(hw * 2), 11); } };
    arrow(0, BROWN); arrow(8, GOLD); arrow(18, '#ff4a30'); }
  const dimC = mk(4, 4); { const x = dimC.getContext('2d'); x.fillStyle = 'rgb(8,4,24)'; x.fillRect(0, 0, 4, 4); }
  const clkC = mk(520, 84);
  const T = { big: layerTexture(THREE, bigC), small: layerTexture(THREE, smallC), arrow: layerTexture(THREE, arrowC), dim: layerTexture(THREE, dimC), clk: layerTexture(THREE, clkC), comp: {} };
  const F = { heard: { jp: false, chain: false, choice: false }, asked: { jp: 0, chain: 0, choice: 0 }, ch: null, chKey: null, cutNext: null, cutKey: null, ux: null, uy: null, repeat: false, ask: null, on: false, react: [], annFirst: true, rlFirst: true, mid: null, kind: null, seq: null, i: 0, lineT: 0, cur: null, said: new Set(), t: 0, lastPress: -9, pendFail: false, rl: null, annKey: null, log: [], tutAt: null, clockAtTut: null };
  const setRules = () => { if (!R.ready) return; for (const r of new Set([controller.rules, game()?.rules].filter(Boolean))) { r.JpTutorialSeconds = JP_SEC; r.JpTutorialEvery = true; r.JpTutorialGraceSeconds = GRACE; if (FIRST_CHOICE) { r.ChainFirstAuto = false; r.ChainAnnounceSeconds = 0; r.ChainAnnounceSecondsFirst = 0; r.ChainIntroSeconds = CUT_SEC; } } };   // fx_trim が reset で入れ直すので毎コマ
  const img = (u) => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = u; });
  const ready = (async () => {
    const meta = await (await fetch(new URL('flow.json', base))).json();
    await Promise.all(Object.keys(meta.runs).map(async (k) => { R.img[k] = await img(new URL(`txt_f_${k}.webp`, base).href); }));
    R.meta = meta; R.ready = true; setRules();
    R.comp = await (await fetch(new URL('comp.json', base))).json();
    await Promise.all(EXPRS.flatMap((k) => [0, 1, 2].map(async (i) => { T.comp[`${k}${i}`] = layerTexture(THREE, await img(new URL(`comp_${k}_${i}.png`, base).href), { nearest: true }); })));
    (lcd.splitWarmers ??= []).push({ name: 'upaflow', done: false, step(r) { for (const t of [T.big, T.small, T.arrow, T.dim, T.clk, ...Object.values(T.comp)]) { try { r.initTexture(t); } catch {} } return (this.done = true); } });
  })().catch((e) => { console.warn('[upa-flow] 素材を読めません。説明なしで続けます', e); });
  const offAct = controller.onAction?.((a) => { if (a === 'reset') setRules(); });

  // ---- 数字 ----
  const vals = () => {
    const g = game(), r = g.rules, m = g.meterStatus, c = g.jackpotChain, [num, den] = String(r.ChainDisplayProbability ?? '2/3').split('/');
    return { CLOCK: Math.round(g.secondsLeft), SEC: m ? Math.round(m.seconds) : 0, N: m?.threshold ?? 0, HOLE_COUNT: m?.targets?.length ?? 0, AWARD_MAX: Math.max(...r.JackpotAwards), AT_RISK: c?.pendingAward ?? 0, FIRST: c?.baseAward ?? 0, RATE_TEXT: { den, num }, PCT: Math.round((+num / +den) * 100) };
  };
  // ---- 字を並べる ----
  const lineItems = (toks, sk, V) => {
    const out = [], gl = (d, rb) => out.push(R.meta.glyph[sk + (rb ? 'r' : '') + d]);
    for (const t of toks) {
      if (t.r) out.push(t.r);
      else if (t.v === 'RATE_TEXT') { for (const d of V.RATE_TEXT.den) gl(d, true); out.push(R.meta.rate[sk].kai); for (const d of V.RATE_TEXT.num) gl(d, true); out.push(R.meta.rate[sk].kai2); }
      else if (t.word && V[t.v] === 500) out.push(t.word);
      else for (const d of String(V[t.v])) gl(d, t.rb);
    }
    return out;
  };
  /** 吹き出しを c に描く。tails=[{x, up}]（x は液晶の座標）。left は液晶での左端。返り値 {w,h,left} */
  const r0h = (id) => { const L = R.meta.lines[id]; return (Math.floor((L.l.length * Math.round(L.sz * 1.32) + 2 * Math.round(L.sz * 0.55)) / CELL) + 1) * CELL; };
  const compose = (c, id, { tails = [], minw = 0, minh = 0, leftAt = null, plates = false } = {}) => {
    const L = R.meta.lines[id], V = vals(), sz = L.sz, lead = Math.round(sz * (F.ch ? 1.32 : 1.25)), pad = Math.round(sz * 0.55);
    const rows = L.l.map((t) => lineItems(t, L.s, V)), ws = rows.map((r) => r.reduce((a, k) => a + R.meta.runs[k].adv, 0));
    let w = Math.max(minw, Math.max(...ws) + pad * 2), h = Math.max(minh, rows.length * lead + pad * 2 + (plates ? 150 : 0)); w = (Math.floor(w / CELL) + 1) * CELL; h = (Math.floor(h / CELL) + 1) * CELL;
    w = Math.min(w, W - 2 * MG + 2 * MG - 12);
    const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
    const left = leftAt ?? clamp(Math.round((W - w) / 2), 6, W - w - 6), ox = MG, oy = MG;   // canvas の (MG,MG) が枠の左上。液晶では left-MG に置く
    const rect = (a, b, cc, d, col) => { x.fillStyle = col; x.fillRect(ox + a * CELL, oy + b * CELL, (cc - a + 1) * CELL, (d - b + 1) * CELL); };
    const gw = Math.round(w / CELL), gh = Math.round(h / CELL);
    x.save(); x.globalAlpha = 0.4; x.translate(CELL, CELL);
    const shape = (i, col) => { const a = i, b = i, cc = gw - 1 - i, d = gh - 1 - i; rect(a + 3, b, cc - 3, d, col); rect(a, b + 3, cc, d - 3, col); rect(a + 1, b + 1, cc - 1, d - 1, col); rect(a + 2, b, cc - 2, d, col); rect(a, b + 2, cc, d - 2, col); };
    shape(0, 'rgb(10,0,20)'); x.restore();
    shape(0, BROWN); shape(1, GOLD); shape(2, BROWN); shape(3, CREAM); rect(6, 3, gw - 7, 3, '#fff');
    const ROWS = ['BGBCCCCCCBGB', '.BGBCCCCBGB.', '..BGBCCBGB..', '...BGBBGB...', '....BGGB....', '.....BB.....'], COL = { B: BROWN, G: GOLD, C: CREAM };
    let tip = null;
    for (const tl of tails) {
      const cx = tl.x - left, near = Math.min(cx, w - cx), dirn = near < 8 * CELL ? (cx < w / 2 ? -1 : 1) : 0;
      const x0 = Math.round(clamp(cx - (6 + dirn * 5) * CELL, 4 * CELL, w - 16 * CELL) / CELL) * CELL, up = !!tl.up;
      x.fillStyle = CREAM; if (up) x.fillRect(ox + x0 + 3 * CELL, oy, 6 * CELL, 4 * CELL); else x.fillRect(ox + x0 + 3 * CELL, oy + h - 4 * CELL, 6 * CELL, 4 * CELL);
      ROWS.forEach((row, r) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.') continue; x.fillStyle = COL[ch]; x.fillRect(ox + x0 + (i + dirn * r) * CELL, up ? oy - (r + 1) * CELL : oy + h + r * CELL, CELL, CELL); } });
      if (!up) tip = { x: left + x0 + (6 + dirn * 5) * CELL, dy: h + 6 * CELL };
      else tip ??= { x: left + x0 + (6 + dirn * 5) * CELL, dy: -6 * CELL };
    }
    x.imageSmoothingEnabled = true;
    rows.forEach((items, li) => {
      let px = ox + (w - ws[li]) / 2; const py = oy + (minh ? (h - rows.length * lead) / 2 + 22 : pad) + li * lead;
      for (const k of items) { const m = R.meta.runs[k]; x.drawImage(R.img[k], px - m.pad, py - m.pad); px += m.adv; }
    });
    if (plates) [[0, '#d83030', '#ff7a7a'], [1, '#2f62d8', '#86aeff']].forEach(([side, col, hi]) => {   // 左=きかない（赤）／右=きく（青）。冒頭と同じ色と役割
      const pw = 300, ph = 118, px = ox + (side ? w - pw - 40 : 40), py = oy + h - ph - 26, lab = labels?.(side);
      x.fillStyle = BROWN; x.fillRect(px - 6, py - 6, pw + 12, ph + 12); x.fillStyle = col; x.fillRect(px, py, pw, ph); x.fillStyle = hi; x.fillRect(px, py, pw, 8);
      if (lab) { const k = Math.min(1, Math.min((pw - 24) / lab.width, (ph - 16) / lab.height)); x.drawImage(lab, px + (pw - lab.width * k) / 2, py + (ph - lab.height * k) / 2, lab.width * k, lab.height * k); }
    });
    return { w, h, left, tip };
  };
  // ---- 相棒の居場所：字・メーター・ルーレットを隠さない隅。ライブの案内（upa_host の Lv）や説明の吹き出しに出ている間は、そちらの1匹だけ ----
  const showpiece = () => !!lcd.jp?.model?.active && SHOWPIECE.test(lcd.jp.model.name ?? '');
  const place = () => {
    const g = game(), m = g.meterStatus, c = F.cur, hide = lcd.jpIdleFx?.state?.cur?.kind;
    if (!F.on) return null;
    if (c && !c.edge) { const far = Math.abs((F.ux ?? c.upaX) - c.upaX) > 10; return { x: F.ux ?? c.upaX, y: (F.uy ?? c.upaY) - (far ? Math.abs(Math.sin(F.t * 13)) * 34 : 0), n: c.upaN ?? UPA_N }; }
    if (g.phase === 'ChainChoice') return null;   // 説明のあとの選択画面は映像側のうぱ1匹だけ
    if (liveVisible()) return null;
    if (m) { if (m.stage === 'intro' || m.stage === 'count') return null; return { x: 200, y: 500, n: 4 }; }   // 「あと N 個」の行の上（矢印メーターと下の穴の帯を避ける）
    if (g.rouletteStatus || g.phase === 'ChainChoice' || (showpiece() && lcd.jp?.model?.name !== CUT && F.react.some((x) => F.t < x.to))) return lcd.jp?.model?.name === CUT ? null : { x: 100, y: GROUND, n: 4 };   // 見せ場は隅で表情だけ
    if ((g.lampCount ?? 0) >= 6 && lcd.jp?.model?.active) return null;
    return { x: 124, y: GROUND, n: 5 };
  };
  const react = (...steps) => { let t = F.t; F.react = steps.map(([e, d]) => { const r = { e, from: t, to: t + d }; t += d; return r; }); };
  const expr = () => {
    const r = F.react.find((x) => F.t >= x.from && F.t < x.to); if (r) return r.e;
    return F.cur ? (LINE_EXPR[F.cur.id] ?? 'idle') : 'idle';
  };

  // ---- 台詞を出す ----
  const show = (id, edge) => {
    const L = R.meta.lines[id]; if (!L) return;
    const g = game(), m = g.meterStatus, holes = !edge && HOLE_LINE.test(id) && m ? m.targets.map((d) => HOLE_X[clamp(d - 1, 0, 6)]) : [];
    if (edge) {
      const p = place() ?? { x: 124, y: GROUND, n: 5 }, c = smallC, r = compose(c, id, { tails: [{ x: p.x, up: false }], leftAt: 130 });
      const tipY = p.y - 21 * p.n - 10;
      T.small.needsUpdate = true; F.cur = { id, edge: true, t: 0, dur: L.dur, tex: T.small, cw: c.width, ch: c.height, x: 130 - MG, y: tipY - r.tip.dy - MG, tipX: p.x - 130 + MG, tipY: r.tip.dy + MG, r };
    } else {
      const c = bigC, plates = /^ask_/.test(id), tall = 23 * UPA_N;
      if (holes.length) {   // 穴の横まで歩く。吹き出しはうぱの上
        const hx = holes.reduce((a, b) => (Math.abs(b - 576) < Math.abs(a - 576) ? b : a)), upaX = clamp(hx < 576 ? hx + 300 : hx - 300, 200, W - 200), r = compose(c, id, { tails: [{ x: upaX, up: false }], minw: 700 }), y = UPA_FOOT - tall - 6 * CELL - r.h;
        T.big.needsUpdate = true; F.cur = { id, edge: false, t: 0, dur: L.dur, tex: T.big, cw: c.width, ch: c.height, x: r.left - MG, y: y - MG, tipX: 576 - (r.left - MG), tipY: r.h + MG, upaX, upaY: UPA_FOOT, holes, r };
      } else {
        const onChoice = !!F.ch, upaX = onChoice ? 560 : F.cur?.upaX && !F.cur.edge && !F.cur.holes ? F.cur.upaX : 252, r = compose(c, id, { tails: [{ x: upaX, up: true }], minw: onChoice ? W - 24 : plates ? 800 : 700, plates }), y = onChoice ? 785 - r0h(id) : TIP_Y - 6 * CELL - r.h;   // 選択画面：残り時間の下〜「確定」「継続」の上（選択肢と時間を隠さない）
        T.big.needsUpdate = true; F.cur = { id, edge: false, t: 0, dur: L.dur, tex: T.big, cw: c.width, ch: c.height, x: r.left - MG, y: y - MG, tipX: 576 - (r.left - MG), tipY: r.h + MG, upaX, upaY: y - 6 * CELL + 2, holes: null, upaN: onChoice ? 8 : UPA_N, r };
      }
      if (/^ask_/.test(id)) { F.ask = { sc: { ask_jp: 'jp', ask_chain: 'chain' }[id], at: F.t }; F.cur.dur = ASK_SEC; }
    }
    sfx?.pop?.(LINE_EXPR[id] === 'surprise' ? 520 : 760, 0.25);
    F.log.push({ t: +F.t.toFixed(2), id, clock: +game().secondsLeft.toFixed(2), stage: m?.stage ?? null, text: id }); if (F.log.length > 200) F.log.shift(); log('upa:flow', { id });
  };
  const say = (id, force) => { if (F.seq || (!force && showpiece())) return; show(id, true); };

  const shortSeq = (sc) => (sc === 'jp' ? ['jp8s'] : ['ch15s']);
  const fullSeq = (sc) => (sc === 'jp' ? ['jp8_award', 'jp8_hole', 'jp8_free', 'jp8_go'] : ['ch15_how', 'jp8_free', 'jp8_go']);
  const answer = (side, why) => {   // 左=きかない／右=きく。答えなしは「きく」
    const a = F.ask; if (!a) return; F.ask = null; const yes = side === 'R'; if (yes) F.heard[a.sc] = true;
    F.log.push({ t: +F.t.toFixed(2), id: `ask:${a.sc}:${yes ? 'きく' : 'きかない'}:${why}`, clock: +game().secondsLeft.toFixed(2) }); sfx?.click?.();
    startSeq(yes ? fullSeq(a.sc) : shortSeq(a.sc));
  };
  const startSeq = (ids) => { F.seq = ids; F.i = 0; show(ids[0], false); };
  const seqNext = () => { F.i++; if (F.i < F.seq.length) show(F.seq[F.i], false); else seqFinish('done'); };
  const seqFinish = (why) => { if (F.ch) { F.ch = null; F.seq = null; F.cur = null; F.log.push({ t: +F.t.toFixed(2), id: `choice-end:${why}`, clock: +game().secondsLeft.toFixed(2) }); } else { F.seqDone = true; endSeq(why); } };
  const endSeq = (why) => { F.seq = null; F.cur = null; const g = game(); g.endJpTutorial?.(); const clockLost = F.clockAtTut === null ? null : +(F.clockAtTut - g.secondsLeft).toFixed(3); F.log.push({ t: +F.t.toFixed(2), id: `end:${why}`, sec: +(F.t - F.tutAt).toFixed(2), clockLost, meterLeft: g.meterStatus?.timeLeft }); log('upa:flow-end', { why, clockLost }); };

  const tick = (dt) => {
    F.t += dt; const g = game(); if (!g) return;
    if (!R.ready) { if (g.meterStatus?.stage === 'tutorial') g.endJpTutorial?.(); return; }
    const m = g.meterStatus, mid = g.meter?.id ?? null;
    if (FIRST_CHOICE) setRules();
    if (F.cur) { F.cur.t += dt; }
    if (F.cur && !F.cur.edge) { const k = 1 - Math.exp(-dt * 5); if (F.ux === null) { const p0 = F.cur.holes ? null : 1; F.ux = p0 ? F.cur.upaX : 124; F.uy = p0 ? F.cur.upaY : GROUND; } F.ux += (F.cur.upaX - F.ux) * k; F.uy += (F.cur.upaY - F.uy) * k; } else F.ux = F.uy = null;
    if (F.pendTime && (g.meterStatus || g.rouletteStatus || lcd.jp?.model?.active)) F.pendTime = false;   // 開始の案内はJPに入ったら出さない（JP明けに「あと◯個」の行へ被る）
    if (F.pendTime && !F.cur && !g.meterStatus && !liveVisible()) { F.pendTime = false; show('time_start', true); }
    // ---- 新しいメーター ----
    if (m && mid !== F.mid) {
      F.mid = mid; F.kind = m.kind; F.said = new Set(); F.lastMs = null; F.pressAt = F.t; F.seqDone = false; F.pendFail = false;
      if (m.kind === 'chain' && m.stage === 'intro' && g.meter && !g.meter.tutorial) g.meter.tutorial = { seconds: CH_SEC, left: CH_SEC + GRACE, acked: false };
      if (!F.seq && F.cur) F.cur = null;
    }
    if (m) {
      F.lastMs = { kind: m.kind };
      if (m.stage === 'tutorial' && !F.seqDone) {
        if (!F.seq && /^(jp_(intro|chance)|chain_announce_)|_in$/.test(lcd.jp?.model?.name ?? '') && lcd.jp?.model?.active) { /* JACKPOT CHANCE の題字・継続チャンスのカットインが終わってから（時計は止まっている） */ }
        else if (!F.seq) {
          F.tutAt = F.t; F.clockAtTut = g.secondsLeft; const sc = m.kind === 'jp' ? 'jp' : 'chain';
          if (!F.repeat && !F.heard[sc] && F.asked[sc] < (sc === 'jp' ? ASK_MAX : 1)) { F.asked[sc]++; startSeq([sc === 'jp' ? 'ask_jp' : 'ask_chain']); }   // 止まっている間にほめ言葉は出さない（メーター中へ）。継続は2回目以降聞かない
          else startSeq(shortSeq(sc));
        } else if (F.ask) {
          if (F.t - F.ask.at >= ASK_SEC) answer('R', 'timeout');
        } else if (F.cur && F.cur.t >= F.cur.dur) {
          seqNext();
        }
      } else if (F.seq) { F.seq = null; F.cur = null; }   // 打ち切り（規則が先に進めた）
      if (m.stage === 'firing' && !F.seq) {
        if (m.count === m.threshold - 1 && !F.said.has('f_close')) { F.said.add('f_close'); react(['panic', 2]); }
        if (m.timeLeft <= 3 && m.count < m.threshold && !F.said.has('f_o')) { F.said.add('f_o'); react(['oshii', 3]); }
        const el = m.seconds - m.timeLeft, line = (id, ok) => { if (ok && !F.said.has(id) && (!F.cur || F.cur.t > 0.8)) { F.said.add(id); say(id); } };   // 10/31 ほめ言葉はプレイ中に。時計の行（y520〜）より上に小さく
        line('jp9_close', m.count === m.threshold - 1);
        line('jp9_oshii', m.timeLeft <= 3 && m.count < m.threshold);
        line('jp9_half', el >= m.seconds / 2 && m.count < m.threshold / 2);
        line('jp9_slow', el > 1.5 && F.t - F.lastPress >= 1.5 && m.count < m.threshold);
        line('jp9_good', m.count >= 1);
        line('jp9_go', el >= 0.6);
      } else if (m.stage !== 'tutorial' && F.cur && !F.cur.edge) F.cur = null;
      if (m.stage === 'count' && F.cur) F.cur = null;
    } else if (F.mid !== null) {   // メーターが終わった
      const ok = !!g.rouletteStatus; F.mid = null; F.seq = null; F.cur = null; react([ok ? 'big_joy' : 'sad', 3]); if (!ok && F.kind === 'jp') F.pendFail = true;
    }
    // ---- ルーレット ----
    const rs = g.rouletteStatus;
    if (rs) {
      F.rl = { stage: rs.stage };
      if (rs.stage === 'spinning' && rs.canStop && !F.rlHow) { F.rlHow = true; say(F.rlFirst ? 'rl11_how' : 'rl11_short', true); F.rlFirst = false; }
      if (rs.stage !== 'spinning' && /^rl11_/.test(F.cur?.id ?? '')) F.cur = null;   // 押したら吹き出しを消す（結果の数字は見せ場）
      if (rs.stage === 'slowing' && !F.rlDoki) { F.rlDoki = true; react(['panic', 0.7], ['surprise', 2]); F.rlAward = rs.award; }   // award は決定済みだが、止まるまで使わない
      if (rs.stage === 'spinning') F.rlAwardHidden = rs.award;
    } else if (F.rl) {
      const award = F.rlAward ?? F.rlAwardHidden ?? 0; F.rl = null; F.rlHow = F.rlDoki = false; F.rlAward = F.rlAwardHidden = undefined; react([award >= 200 ? 'big_joy' : 'joy', 3]);
    }
    // ---- 失敗のあと ----
    if (F.pendFail && !F.cur && !m && !rs) {
      const normal = ['Ready', 'Flight', 'Effect'].includes(g.phase) && !lcd.jp?.model?.active && !lcd.choiceV20?.active;
      if (g.secondsLeft <= 0) { F.pendFail = false; say('jp12_noclock'); } else if (normal) { F.pendT = (F.pendT ?? 0) + dt; if (F.pendT > 2.6) { F.pendFail = false; F.pendT = 0; say('jp12_clock'); } }   // 灯の「あと N 本」のテロップが引いてから
    }
    // ---- 継続の選択画面（配当の見せ場のあと）。説明の間は時計と選択の秒を止める。選ぶのは客。時間切れは今の決まりのまま ----
    F.choiceAge = FIRST_CHOICE && g.phase === 'ChainChoice' && lcd.choiceV20?.active ? (F.choiceAge ?? 0) + dt : 0;
    if (FIRST_CHOICE && g.phase === 'ChainChoice' && g.jackpotChain?.choicePending && F.choiceAge >= CHOICE_LINE_AT && !F.ch && !F.seq) {
      const key = `${g._chainSerial ?? 0}:${g.jackpotChain.stage ?? 0}`;
      if (F.chKey !== key) {
        F.chKey = key; F.ch = { t: 0 }; F.tutAt = F.t; const stage = g.jackpotChain.stage ?? 0;
        const say2 = stage > 0 ? ['ch14_again'] : ['ch13_a'];
        startSeq(g.chainNeedsAdd ? ['ch13_noclock'] : say2);
      }
    }
    if (F.ch) {
      F.ch.t += dt;
      if (g.phase !== 'ChainChoice' || !F.seq) { F.ch = null; F.seq = null; F.cur = null; F.ask = null; }
      else {
        if (F.cur && F.cur.t >= F.cur.dur) seqNext();
      }
    }
    if (!FIRST_CHOICE && g.chainAnnouncing) {   // ?firstchoice=0：旧の告知の映像の間
      const key = `${g._chainSerial ?? 0}:${g.jackpotChain?.stage ?? 0}`;
      if (F.annKey !== key) { F.annKey = key; say('ch13_a', true); }
    }
    if (F.cur && !F.seq && F.cur.t >= F.cur.dur) F.cur = null;
  };

  // ---- 層 ----
  const drawClk = () => {
    const n = Math.max(0, Math.ceil(game().secondsLeft)); if (F.clkN === n) return; F.clkN = n;
    const x = clkC.getContext('2d'), M = R.meta, ks = [M.clk.a, ...String(n).split('').map((d) => M.glyph['S' + d]), M.clk.b], w = ks.reduce((a, k) => a + M.runs[k].adv, 0) + 36;
    x.clearRect(0, 0, 520, 84); x.fillStyle = BROWN; x.fillRect(520 - w - 6, 2, w + 6, 80); x.fillStyle = CREAM; x.fillRect(520 - w, 8, w - 6, 68);
    let px = 520 - w + 15; for (const k of ks) { const m = M.runs[k]; x.drawImage(R.img[k], px - m.pad, 42 - m.h / 2); px += m.adv; }
    T.clk.needsUpdate = true;
  };
  const layers = () => {
    if (!R.ready) return null;
    const c = F.cur, p = place(), out = [];
    if (F.ch) {   // 選択画面の説明：背景を沈める。時計は吹き出しの下に隠れるので札で出す
      out.push({ tex: T.dim, w: W, h: 1268, ax: 0, ay: 0, x: PX, y: PY, rot: 0, sc: 1, alpha: 0.42 * clamp(F.ch.t / 0.2, 0, 1), add: false });
    }
    if (p && R.comp) {
      const e = expr(), lively = e !== 'idle', fr = lively ? Math.floor(F.t * 5) % 2 : (F.t % 3.2 < 0.14 ? 2 : 0), tex = T.comp[`${e}${fr}`];
      if (tex) out.push({ tex, w: R.comp.w, h: R.comp.h, ax: R.comp.cx, ay: R.comp.bottom, x: PX + p.x, y: PY + p.y, rot: 0, sc: p.n, alpha: 1, add: false });
    }
    if (c?.holes && c.t >= ARROW_AT) for (const hx of c.holes) {   // 大きな矢印で実際の穴を指す（先が穴の少し上）
      const u = c.t - ARROW_AT, bob = Math.abs(Math.sin(u * 5)) * 26, k = Math.max(0.05, easeBack(u / 0.2));
      out.push({ tex: T.arrow, w: ARROW_W, h: ARROW_H, ax: ARROW_W / 2, ay: ARROW_H, x: PX + hx, y: PY + TIP_Y - bob, rot: 0, sc: k, alpha: 1, add: false });
    }
    if (c) { const k = F.ch ? 1 : Math.max(0.05, easeBack(c.t / 0.22)), a = clamp(c.t / 0.08, 0, 1), b = { tex: c.tex, w: c.cw, h: c.ch, ax: c.tipX, ay: c.tipY, x: PX + c.x + c.tipX, y: PY + c.y + c.tipY, rot: 0, sc: k, alpha: a, add: false }; if (F.ch) { out.splice(out.length - 1, 0, b); if (c.y + MG < 335 && game().secondsLeft > 0) { drawClk(); out.push({ tex: T.clk, w: 520, h: 84, ax: 520, ay: 0, x: PX + W - 30, y: PY + c.y + MG - 90, rot: 0, sc: 1, alpha: a, add: false }); } } else out.push(b); }
    return out.length ? out : null;
  };
  let hooked = false;
  const hook = () => {
    if (hooked || !lcd.jpHud?.splitLayers) return;
    const o = lcd.jpHud.splitLayers.bind(lcd.jpHud);
    lcd.jpHud.splitLayers = () => { const a = o(), b = layers(); return a && b ? [...a, ...b] : (a ?? b); };
    hooked = true;
    const M = lcd.jp?.model;
    if (FIRST_CHOICE && M?.man?.scenes?.[CUT]) {   // 継続を選んだら、盤面の前に継続チャンスのカットイン。chain_seal／jp_seal の差し替えより外側（カットインのあとで元の場面名を渡す）
      const st = M.start.bind(M), sp = M.stop.bind(M);
      M.start = (name) => { const g = game(), id = g?.meter?.id; if (/^chain_jp_aim_d\d$/.test(name ?? '') && g?.meterStatus?.kind === 'chain' && F.cutKey !== id) { F.cutKey = id; F.cutNext = name; F.log.push({ t: +F.t.toFixed(2), id: 'cutin', clock: +g.secondsLeft.toFixed(2) }); return st(CUT); } return st(name); };
      M.stop = (r) => { const was = M.name, x = sp(r), n = F.cutNext; if (was === CUT && n) { F.cutNext = null; if ((r === undefined || r === 'end') && game()?.meterStatus?.kind === 'chain') st(n); } return x; };
    }
  };
  return {
    state: F, ready, tick: (dt) => { hook(); tick(dt); },
    get busy() { return !!F.cur || !!F.pendTime; },
    timeStart() { F.pendTime = true; },
    get asking() { return !!F.ask; },
    get holding() { return false; },
    begin({ repeat = false } = {}) { Object.assign(F, { on: true, repeat, heard: { jp: false, chain: false, choice: false }, asked: { jp: 0, chain: 0, choice: 0 }, ch: null, chKey: null, cutNext: null, cutKey: null, ux: null, uy: null, ask: null, react: [], annFirst: !repeat, rlFirst: !repeat, mid: null, seq: null, cur: null, pendFail: false, rl: null, annKey: null, seqDone: false }); },
    reset() { Object.assign(F, { pendTime: false, on: false, ch: null, cutNext: null, ask: null, mid: null, seq: null, cur: null, pendFail: false, rl: null }); },
    /** 問いの答え。選択画面と同じゲート：出てから1.5秒は受けない＋連打が0.4秒止まるまで受けない */
    answerPress(side) { const a = F.ask; if (!a) return; const gap = F.t - F.lastPress; F.lastPress = F.t; if (F.t - a.at < ASK_GATE || gap < SKIP_GAP) return; answer(side, 'press'); },
    event(id) {   // 顔だけの反応（吹き出しなし。回数は数えない）
      if (id === 'lamp123' || id === 'lamp4' || id === 'lamp5') react(['joy', 1.4]);
      else if (id === 'roulette') react(['surprise', 0.5], ['oshii', 1.6]);
      else if (id === 'lamp6') react(['surprise', 0.6], ['big_joy', 3]);
    },
    press() {
      F.prevPress = F.lastPress; const gap = F.t - F.lastPress; F.lastPress = F.t;
      const m = game()?.meterStatus; if (!F.seq || (m?.stage !== 'tutorial' && !F.ch) || F.t - F.tutAt < SKIP_AGE || gap < SKIP_GAP) return;   // 連打のまま流れ込んだ押しでは飛ばさない（手を止めてから押すと飛ばす）
      const last = F.seq.length - 1;
      if (F.i < last) { F.i = last; show(F.seq[last], false); }
      else if (F.seq.length === 1 || F.ch) seqFinish('skip');
    },
    dispose() { offAct?.(); },
  };
}
