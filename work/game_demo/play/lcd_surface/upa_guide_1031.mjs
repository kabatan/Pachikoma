// 10/31 うぱ接客：開始後のライブ案内の「頭脳」（描かない）。仕様は effects/upa_host/adaptive.json（人が読む表は ADAPTIVE.md）。
//   説明の手順 rule_hands → go_more → go_fire → go_six → go_dup を、プレイヤーの行動に合わせて出す・飛ばす・割り込ませる。
//   優先度は小さいほど強い（P1 JP … P5 手順）。新しい台詞は「今出ている台詞より強い」ときだけ割り込み、同じか弱いときは終わってから（待ちは2秒で捨てる）。
//   全体の決まり：台詞の間隔 1.2秒以上／同じ台詞は 20秒空ける／直近3件と同じは出さない。
//   黙る場面：JP演出（6灯揃い〜メーター）・メーター・ルーレット・結果／選択画面・継続。
//   実装した型：E01 手順／E02 速攻JP／E03 連打なし／E04 開始から押さない／E05 放置（約10秒ごとに言い換え）／E06 説明を飛ばす／E07 最初の入賞／E08 最初の消灯／E09 保護／
//               E10 5→4灯／E11 全消灯／E12 回復／E13 4・5灯／E14 速い連打／E15 残り10秒／E16 残り5秒／E20 2回目の客（手順なし）。
//               E17〜E19（JP中の声かけ）は既存のJP演出に任せて出さない（液晶の映像経路に重ねないため）。
//   数字は規則から読む：台詞の文字に数字は入れない（500・50秒は rule_prize の側）。時間は g.secondsLeft。
//
//   const G = createGuide({ game: () => controller.game, quiet: () => bool, log })
//   G.start({ repeat })   // 冒頭が終わって時計が動き出した瞬間（玉を撃てる）。rule_hands を出した扱いにする
//   G.press(now?)         // 通常時の 'fire' のたび（受け付けられない押下も）
//   G.event(id, p)        // lcd.onEvent と同じ id（lamp123/lamp4/lamp5/lamp6/dup_protect/roulette/warn10/start/attract…）
//   G.tick(dt)            // 毎フレーム。G.cur = いま出す台詞 { id, art, prio, dur, t0, small, tone } か null
//   G.introEnded()        // 冒頭の席の吹き出し（rule_hands）が終わった（最初のボタンか10秒）

export const PRIO = { E01: 5, E02: 1, E03: 3, E04: 3, E05: 3, E06: 4, E07: 4, E08: 2, E09: 4, E10: 4, E11: 4, E12: 4, E13: 4, E14: 4, E15: 3, E16: 3 };
export const GAP = 1.2, SAME = 20, LAST_N = 3, WAIT_DROP = 2.0, MIN_SHOW = 1.0;
const TONE = { go_more: 'joy', praise_first: 'joy', praise_4: 'joy', praise_5: 'joy', praise_fast: 'joy', praise_recover: 'joy', dup_safe: 'joy', skip_known: 'joy', go_six: 'joy', go_fire: 'joy',
  jp_early: 'surp', dup_first_reset: 'surp', dup_reset_5: 'surp', drop_all: 'surp', time_10: 'surp', time_10_close: 'surp', time_5: 'surp' };
export const IMPORTANT = new Set(['go_dup', 'dup_first_reset', 'dup_reset_5', 'drop_all', 'jp_early', 'time_10', 'time_10_close']), MIN_IMPORTANT = 3;   // 10/31 大事な説明：最低3秒は見せ、弱い一言で上書きしない。待ちでも捨てない
const SMALL = new Set(['idle_1', 'idle_2', 'idle_3', 'idle_4', 'idle_5', 'time_5']);   // 小さく出す（吹き出しの画像は同じ。描く倍率を下げる）

export function createGuide({ game, quiet = () => false, log = () => {}, rand = Math.random } = {}) {
  const S = { t: 0, playT: 0, on: false, repeat: false, stepsDone: false, steps: [], stepIdx: 0, hands: false,
    presses: [], firstPressAt: null, lastInputAt: null, firstWin: false, firstDup: false, jp: false, lamps: 0, lampsPrev: 0, lastLampAt: 0, drop: null,
    cnt: { slow: 0, safe: 0, fast: 0, idle: 0 }, once: {}, lastSpokenAt: {}, hist: [], lastEnd: -9, queue: [], resetN: 0, variantI: 0, pressesDuringStep: [], startIdle: { a: false, b: false }, log: [] };
  const out = { S, cur: null };
  const g = () => game();

  // ---- 台詞を出す要求 ----
  const REACT = new Set([PRIO.E07, PRIO.E09, PRIO.E10, PRIO.E12, PRIO.E13, PRIO.E14]);   // 一言の反応の上限（companion.frequency_caps）：8秒以上あけ・1プレイ8回。手順と、割り込みで出す強い台詞は別枠
  const speak = (id, prio, opt = {}) => {
    const now = S.t;
    if (!opt.force && REACT.has(prio) && !IMPORTANT.has(id)) { if ((S.reactN ?? 0) >= 8 || now - (S.reactAt ?? -99) < 8) return false; S.reactN = (S.reactN ?? 0) + 1; S.reactAt = now; }
    if (!opt.force) {
      if (S.hist.slice(-LAST_N).includes(opt.key ?? id)) return false;
      const last = S.lastSpokenAt[opt.key ?? id]; if (last !== undefined && now - last < SAME && !opt.noCooldown) return false;
    }
    S.queue.push({ id, key: opt.key ?? id, prio, at: now, expire: now + (IMPORTANT.has(id) ? 10 : opt.wait ?? WAIT_DROP), dur: IMPORTANT.has(id) ? Math.max(MIN_IMPORTANT + 0.2, opt.dur ?? 0) : opt.dur ?? null, step: opt.step ?? null, hold: opt.hold ?? 0, art: opt.art ?? id });
    return true;
  };
  const begin = (q) => {
    const now = S.t; S.queue = S.queue.filter((x) => x !== q);
    out.cur = { id: q.id, key: q.key, art: q.art, prio: q.prio, t0: now, dur: q.dur ?? 2.5, small: SMALL.has(q.id), tone: TONE[q.id] ?? 'normal', step: q.step, hold: q.hold };
    S.lastSpokenAt[q.key] = now; S.hist.push(q.key); if (S.hist.length > 12) S.hist.shift();
    S.log.push({ t: +now.toFixed(2), id: q.id, prio: q.prio }); if (S.log.length > 80) S.log.shift(); log('upa:say', { id: q.id, t: +now.toFixed(1) });
    if (q.step) S.stepSaid(q.step);
  };
  const end = () => { if (!out.cur) return; S.lastEnd = S.t; out.cur = null; };

  // ---- 手順（E01） ----
  const STEP_ORDER = ['go_more', 'go_dup'];   // 10/31 go_fire・go_six の中身は冒頭の台本（rule_jp・rule_lamp・rule_hands）へ移した
  S.stepSaid = (id) => { S.stepIdx = Math.max(S.stepIdx, STEP_ORDER.indexOf(id) + 1); if (id === 'go_dup') S.stepsDone = true; };
  const skipSteps = (upto) => { for (const id of STEP_ORDER) { if (STEP_ORDER.indexOf(id) < STEP_ORDER.indexOf(upto) || upto === 'all') S.stepIdx = Math.max(S.stepIdx, STEP_ORDER.indexOf(id) + 1); } if (upto === 'all') S.stepsDone = true; };
  const pressesIn = (sec) => { let n = 0; for (let i = S.presses.length - 1; i >= 0 && S.t - S.presses[i] <= sec; i--) n++; return n; };
  const stepDue = () => {   // いま出すべき手順（なければ null）
    if (S.stepsDone || S.jp || !S.hands) return null;
    const lamps = g()?.lampCount ?? 0, id = STEP_ORDER[S.stepIdx]; if (!id) return null;
    if (id === 'go_more') {
      if (S.presses.length < 2) return null;
      if (pressesIn(3) >= 8) { S.stepIdx++; return stepDue(); }   // もう連打している：飛ばす
      return id;
    }
    if (id === 'go_fire') {
      if (S.firstWin && lamps >= 2 && S.once.firstHitSaidAt !== undefined && S.t - S.once.firstHitSaidAt > 0.01) { S.stepIdx++; return stepDue(); }
      if (S.firstWin || S.playT >= 8) return id;
      return null;
    }
    if (id === 'go_six') { if (lamps >= 4) { S.stepIdx++; return stepDue(); } return id; }
    if (id === 'go_dup') { return S.firstDup ? id : null; }
    return null;
  };

  // ---- 出来事 ----
  out.start = ({ repeat = false } = {}) => {
    Object.assign(S, { on: true, repeat, playT: 0, stepsDone: repeat, stepIdx: 0, hands: !repeat, firstPressAt: null, lastInputAt: 0, presses: [], firstWin: false, firstDup: false, jp: false, lamps: g()?.lampCount ?? 0, lampsPrev: 0, drop: null, once: {}, queue: [], resetN: 0 });
    S.cnt = { slow: 0, safe: 0, fast: 0, idle: 0 }; S.startIdle = { a: false, b: false }; S.pressesDuringStep = []; S.idleAcc = 0; S.idleI = S.idleI ?? 0;
    log('upa:guide-start', { repeat });
  };
  out.pending = () => S.queue.length > 0;   // 次に言いたい台詞がある（冒頭の席が残っていたら降りてもらう）
  out.introEnded = () => { if (S.on && !S.handsDone) { S.handsDone = true; S.lastEnd = S.t; } };
  out.press = () => {
    if (!S.on) return; const now = S.t; S.presses.push(now); if (S.presses.length > 60) S.presses.shift();
    if (S.firstPressAt === null) S.firstPressAt = now; S.lastInputAt = now; S.idleAcc = 0;
    // E06：説明の台詞が出ている最中に素早く5回
    if ((out.cur?.prio === PRIO.E01 || S.introShowing) && !S.stepsDone && !S.once.skip) { if (pressesIn(2) >= 5) { S.once.skip = true; skipSteps('all'); end(); S.queue = S.queue.filter((x) => x.prio !== PRIO.E01); speak('skip_known', PRIO.E06, { dur: 2.8, force: true }); } }
    // E14：3秒に18回
    if (S.cnt.fast < 1 && pressesIn(3) >= 18) { if (speak('praise_fast', PRIO.E14, { dur: 2.2 })) S.cnt.fast++; }
  };
  const lampsNow = () => g()?.lampCount ?? 0;
  out.event = (id, p = {}) => {
    if (!S.on) return;
    const n = p.after?.length ?? lampsNow();
    if (id === 'lamp123' || id === 'lamp4' || id === 'lamp5') {
      const before = S.lamps; S.lamps = n;
      if (!S.firstWin) { S.firstWin = true; S.once.firstHitSaidAt = S.t; if (!S.repeat || true) speak('praise_first', PRIO.E07, { dur: 1.5, wait: 4 }); }
      if (S.drop && S.t - S.drop.at <= 10 && n >= S.drop.n) { speak('praise_recover', PRIO.E12, { dur: 2.9 }); S.drop = null; }
      if (id === 'lamp4') speak('praise_4', PRIO.E13, { dur: 2.3 });
      if (id === 'lamp5') speak('praise_5', PRIO.E13, { dur: 2.0 });
    } else if (id === 'lamp6') {
      S.lamps = 6;
      if (!S.stepsDone) { skipSteps('all'); S.stepsDone = true; end(); S.queue = []; S.jpEarlyReshow = true; }   // JP の映像は6灯目の瞬間から始まり、字に重ねられない。JP が終わって通常に戻ったら言う
      S.jp = true;
    } else if (id === 'dup_protect') {
      S.pointLanes = p.lane ? [p.lane] : [];
      if (!S.stepsDone && !S.firstDup) { S.firstDup = true; skipSteps('go_dup'); }
      else if (!S.firstDup) S.firstDup = true;
      if (!S.stepsDone && S.stepIdx >= 3) { /* go_dup は stepDue で出る */ }
      else if (S.cnt.safe < 3 && S.stepsDone && speak('dup_safe', PRIO.E09, { dur: 2.3 })) S.cnt.safe++;
    } else if (id === 'roulette') {   // 規則の Reset（ランプが消える）
      S.pointLanes = p.removed ?? [];
      const from = p.n_from ?? S.lamps, k = p.k ?? p.removedCount ?? 1, to = Math.max(0, from - k); S.resetN++;
      const first = !S.firstDup; if (first) { S.firstDup = true; }
      S.lamps = to;
      if (first && !S.once.dupReset) { S.once.dupReset = true; if (!S.stepsDone) { skipSteps('all'); S.stepsDone = true; } end(); S.queue = S.queue.filter((x) => x.prio >= 3); speak('dup_first_reset', PRIO.E08, { dur: 4.4, force: true, art: 'dup_first_reset' }); }
      else if (from === 5 && to === 4) speak('dup_reset_5', PRIO.E10, { dur: 2.9, art: 'dup_reset_5' + (S.variantI++ % 3 === 0 ? '' : `_v${(S.variantI % 2)}`) });
      if (from >= 3 && to === 0 && !S.once.dropAll) { S.once.dropAll = true; speak('drop_all', PRIO.E11, { dur: 2.0 }); }
      S.drop = { at: S.t, n: from };
    } else if (id === 'warn10') {
      if (!S.once.t10) { S.once.t10 = true; const l = lampsNow(); l >= 5 ? speak('time_10_close', PRIO.E15, { dur: 2.2, key: 'time_10' }) : speak('time_10', PRIO.E15, { dur: 2.2 }); }
    } else if (id === 'attract' || id === 'start' || id === 'ticket') { out.reset(); }
  };
  out.pointing = () => (['go_dup', 'dup_first_reset', 'dup_reset_5', 'dup_safe'].includes(out.cur?.id) ? S.pointLanes ?? [] : []);   // 消えたランプ（保護なら入った穴）を指す
  out.reset = () => { S.on = false; S.queue = []; out.cur = null; S.handsDone = false; };

  // ---- 毎フレーム ----
  out.tick = (dt) => {
    S.t += dt; if (!S.on) return;
    const G = g(); if (!G) return;
    const q = quiet();
    if (S.on && !controllerFrozen()) S.playT += dt;
    // JP 中・結果などは黙る。表示中の台詞も即消す
    if (q) { if (out.cur) { if (out.cur.id === 'jp_early' && S.t - out.cur.t0 < 1.0 && !S.once.jpEarlyShown) S.jpEarlyReshow = true; S.lastEnd = S.t; out.cur = null; } S.queue = []; S.jpQuietAt = S.t; return; }
    if (S.jp && lampsNow() < 6) { S.jp = false; }
    // 速攻JPの台詞が黙らされて1秒も見えていなかったら、JP が終わって通常に戻ったあとに出し直す（一度だけ）
    if (S.jpEarlyReshow && S.t - (S.jpQuietAt ?? -9) > 0.6) { S.jpEarlyReshow = false; S.once.jpEarlyShown = true; speak('jp_early', PRIO.E02, { dur: 4.0, force: true, wait: 4 }); }
    // 手順（rule_hands は冒頭が出した。終わってから次を出す）
    if (S.hands && !S.handsDone && out.cur === null && S.playT > 0.2 && S.on && !S.introExt) { /* 席の吹き出しは冒頭の側 */ }
    const sd = stepDue(); if (sd && S.handsDone && !S.queue.some((x) => x.id === sd) && !(out.cur?.id === sd)) speak(sd, PRIO.E01, { dur: DUR[sd], step: sd, wait: 6, noCooldown: true });
    // E04：開始から押さない
    if (S.firstPressAt === null && !S.repeat) {
      if (!S.startIdle.a && S.playT >= 4) { S.startIdle.a = true; speak('adlib_start_idle', PRIO.E04, { dur: 2.3 }); }
      if (S.startIdle.a && !S.startIdle.b && S.playT >= 10) { S.startIdle.b = true; S.idleAcc = 0; speak('adlib_start_idle2', PRIO.E04, { dur: 3.2 }); }
      else if (S.startIdle.b && S.idleAcc >= IDLE_EVERY && out.cur?.prio !== PRIO.E05 && !S.queue.some((x) => x.prio === PRIO.E05)) { S.idleAcc = 0; const id = IDLE_POOL[S.idleI++ % IDLE_POOL.length]; speak(id, PRIO.E05, { dur: IDLE_DUR[id], force: true, wait: 3 }); }
    }
    // E03：最初の押下のあと、直近6秒が3回未満（連打していない）。25秒空け・1プレイ2回
    if (S.firstPressAt !== null && S.t - S.firstPressAt > 6 && pressesIn(6) < 3 && pressesIn(6) >= 1 && S.cnt.slow < 2 && (S.once.slowAt === undefined || S.t - S.once.slowAt > 25) && S.t - S.lastInputAt < 20) { if (speak('adlib_slow', PRIO.E03, { dur: 2.0 })) { S.cnt.slow++; S.once.slowAt = S.t; } }
    // E05：放置。最初の押下のあと入力が約10秒止まったら1回目、入力が戻るまで約10秒ごとに台詞を変える（idle_1〜5 を順に・一巡するまで同じ台詞なし）。黙る間はタイマーも止まる（上の quiet で return）
    S.idleAcc = (S.idleAcc ?? 0) + dt;
    if (S.firstPressAt !== null && S.idleAcc >= IDLE_EVERY && !S.queue.some((x) => x.prio === PRIO.E05) && out.cur?.prio !== PRIO.E05) { S.idleAcc = 0; const id = IDLE_POOL[S.idleI++ % IDLE_POOL.length]; speak(id, PRIO.E05, { dur: IDLE_DUR[id], force: true, wait: 3 }); }
    // E11 の保険（イベントが来なかったとき）と E16
    if (!S.once.t5 && G.secondsLeft <= 5 && G.secondsLeft > 0) { S.once.t5 = true; speak('time_5', PRIO.E16, { dur: 1.4 }); }
    if (!S.once.t10 && G.secondsLeft <= 10 && G.secondsLeft > 5.5) { S.once.t10 = true; const l = lampsNow(); l >= 5 ? speak('time_10_close', PRIO.E15, { dur: 2.2, key: 'time_10' }) : speak('time_10', PRIO.E15, { dur: 2.2 }); }
    // 台詞の調停
    const c = out.cur;
    if (c && S.t - c.t0 >= c.dur) end();
    S.queue = S.queue.filter((x) => x.expire > S.t);
    if (S.queue.length) {
      S.queue.sort((a, b) => (IMPORTANT.has(b.id) - IMPORTANT.has(a.id)) || a.prio - b.prio || a.at - b.at); const nx = S.queue[0], cc = out.cur;
      if (!cc) { if ((S.t - S.lastEnd >= GAP || nx.prio <= PRIO.E02) && (S.handsDone || !S.hands)) begin(nx); }
      else if (nx.prio < cc.prio && S.t - cc.t0 >= (IMPORTANT.has(cc.id) ? (IMPORTANT.has(nx.id) ? MIN_SHOW : MIN_IMPORTANT) : Math.min(MIN_SHOW, cc.hold || MIN_SHOW))) begin(nx);
    }
  };
  const IDLE_POOL = ['idle_1', 'idle_2', 'idle_3', 'idle_4', 'idle_5'], IDLE_DUR = { idle_1: 2.2, idle_2: 3.2, idle_3: 2.4, idle_4: 2.8, idle_5: 2.6 }, IDLE_EVERY = 10;
  const DUR = { go_more: 3.2, go_fire: 5.1, go_six: 3.7, go_dup: 4.5 };
  let frozen = () => false; out.setFrozen = (f) => { frozen = f; }; const controllerFrozen = () => frozen();
  return out;
}
