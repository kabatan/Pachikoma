// 新ルールH（連打メーター・ボタンで止めるルーレット）の液晶接続。既存の液晶（jp_surface_confirm1029 のタイムライン・選択・失敗）は土台のまま、
// 「いつ・どれを流すか」と、重ねる部品（メーター・赤い警報・2/3）だけをここで足す。play.mjs・*_gpu_* には触れない。
//
//   play.mjs の差分（統括が適用。chain_connect と choice の attach の後ろ、cabinetlights の前でよい）:
//     if (lcd?.production && ctrl.game.rules.RuleVariant === 'H_20261029')
//       (await import('./lcd_surface/rules_h_20261029.mjs')).attachRulesH(lcd, { controller: ctrl, style: q.get('meter') ?? 'hokuto' });
//
// 既知の課題（記録のみ・10/29 統括：保留）：導入の映像（雷→JACKPOT CHANCE）は、機械が重い・初回の読み込みだと 3 秒以上遅れ、
//   規則の時計とずれる／stuckWatch（jp_surface_confirm1029）に打ち切られる。本番の事前読み込み（prewarm）の課題として扱う。
// JPチャンスのチュートリアル（10/30）：導入（雷→JACKPOT CHANCE）のあと、連打メーターが始まる前に「残った1つの穴に玉を入れろ」「封印はN個」の説明（tutorial_jp_n{N} → tutorial_jp_fin）を流す。
//   規則側が説明の間は時計を止める（制限時間を食わない。規則 H の JpTutorialSeconds。meterStatus.tutorialPlanned/tutorialActive）。回数は既定でその試合の最初のJPチャンスだけ（?jptutorial=all で毎回、?jptutorial=0 で無し）。
//   矢印・光柱・光の筋は映像に焼かず、残った穴(model.d)の真上に実行時に重ねる（tutorial_jp_overlay_1030.mjs）。封印の本数N＝その穴の連打のしきい値（穴1〜7で 3・4・4・2・4・3・5）。N ごとの映像は鎖がN本。
// 継続の「追加で継続」：規則側（統括が統合）が game.chainNeedsAdd=true を立てるか、lcd.rulesH.setContinueAdd(true) を呼べば、選択画面の継続の札に出る。
//
// 流れ（H）
//   6灯 → lamp6（G と同じ）→ 雷 1.0秒 → 黒背景＋字 1.8秒（dopamine/reach）→ JACKPOT CHANCE 3.5秒 → 狙いのループ ＋ メーター（規則の導入 6.3秒と一致させる。10/30 監督：黒背景と字は消さない）
//   連打中：メーター部品（あと◯個＋時計／+n とゲージ）、残り3秒以下でまだ足りなければ赤い警報
//   満タン(meterEnd 成功)：FULL CHARGE/MAX の叩きつけ 1.2秒 → jp_rush(2.0) → jp_bridge(2.6) → ルーレット(=規則の RouletteStartDelaySeconds 5.8)
//   ルーレット：最高速のコマを繰り返し、押した瞬間(rouletteStopPress)に白いブレーキ光で隠して停止コマの手前 1.2秒から滑って止まる → 止まった所で reveal/tray
//   失敗(meterEnd 失敗)：今のガラスが割れる演出（fail の Miss レシート → fail_first / fail_chain）。ここでは何も足さない
//   JP の 'jp'（Win レシート）は止まった後に来る：最初の JP はそのまま吸収して配当の映像へ、継続は chain_jp_land から継続成功へ
//   継続の告知枠「継続できるよ!」を、画面いっぱいの銀の「2/3」の叩きつけに置き換え、選択画面の上端に常時の小さな 2/3
import {createMeterH, alarmLevel, drawAlarm, ALARM, W, H} from './meter_h_20261029.mjs';
import {createMashHint, HINT, telop} from './hint_h_20261029.mjs';
import {loadTutorialOverlay} from './tutorial_jp_overlay_1030.mjs';

const PX = 34, PY = 28;                    // 液晶の面(1240x1510)の中の見える範囲(1152x1268)の左上
// ルーレットの回転ループ（10/31 修正）：旧は全配当共通の 26→38（0.4秒・つなぎの差が通常の2.4倍）を巻き戻すシークで、GOP30・76Mbps の映像では毎回 約8コマ固まった（かくかく）。
//   H 専用の映像 production_20261028/h_roulette_{配当}.mp4 は、回転の区間 [始め,終わり) を継ぎ目をなだらかにして M(=5) 回ぶん並べてあり、押されるまで巻き戻さず前へ流す
//   （シークは押した瞬間だけ＝白いブレーキ光の裏）。コマ数は (M-1)×区間 だけ延びるので、場面の frames / stop_frame / cue.f(終わり以降)を実行時にその分ずらす。G は元の映像のまま。
//   万一並べた分を使い切ったら、従来どおり始めへ巻き戻す。?roulooploop=old で旧(26→38・元の映像)。
const LOOPS = { roulette_30: [33, 78], roulette_40: [24, 62], roulette_100: [30, 75], roulette_200: [35, 82], roulette_500: [32, 77] };
const LOOP_M = 5;
const LOOP_OLD = new URLSearchParams(globalThis.location?.search ?? '').get('roulooploop') === 'old';
const loopOf = (name, sc) => (LOOP_OLD || !sc?.hLoop ? [26, 38] : [sc.hLoop.a, sc.hLoop.b + sc.hLoop.shift]);
const SLIDE_FRAMES = 36;                   // 停止コマの手前のこの数のコマから滑って止まる（= RouletteSlideSeconds 1.2秒 × 30fps）
// 選択画面の「継続」の札（右の札）の位置。字の幅は札の幅(枠いっぱい)の 90%。札の上半分（「続」の絵の上）に置く。
//   cx,cy = 字の中心、w = 字の幅（枠の幅 × BADGE_RATIO）。3 状態の実測（1152x1268 の面）。切り替え中は choiceV20.transition の重みで補間する。
const BADGE_RATIO = 0.9, BADGE_GLYPH = 625;   // BADGE_GLYPH = odds_badge_card.png の字の見える幅(px)
const CARD = { neutral: { cx: 819, cy: 445, frame: 618 }, right: { cx: 800, cy: 420, frame: 630 }, left: { cx: 897, cy: 655, frame: 443 } };
const BADGE_DELAY = 0.25;                       // 選択画面が出てから叩きつけるまで
const BRAKE = { hold: 0.12, fade: 0.58 };   // ルーレットの押した瞬間の白いブレーキ光：全面の白を 0.12 秒保ち、0.58 秒でほどく（つなぎの二重像を隠す。短くすると見える）
const FINISH_SECONDS = 1.2;                // 満タンの叩きつけ
const OFFER_SECONDS = 1.6;
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

// hint: 連打していなさそうな客へのうぱの声かけ（字のみ）の条件。HINT の項目を上書きする（null で無効）。alarm は meter_h_20261029.mjs の ALARM。
export async function attachRulesH(lcd, { controller, style = 'gundam_tetsuya', hint = {}, log = () => {} } = {}) {
  if (!lcd?.production || lcd.rulesH || !lcd.jp) return lcd;
  const ctx = lcd.canvas.getContext('2d');
  try { const f = new FontFace('Kaisei Tokumin', `url(${new URL('../../../effects/jp_teacher/05_choice/r2/src/fonts_dl/KaiseiTokumin-ExtraBold.ttf', import.meta.url).href})`, { weight: '800' }); await f.load(); document.fonts.add(f); } catch (e) { console.warn('[rules-h] kaisei', e); }
  try { const f = new FontFace('Dela Gothic One', `url(${new URL('../../../effects/lcd/fonts/DelaGothicOne-Regular.ttf', import.meta.url).href})`); await f.load(); document.fonts.add(f); } catch (e) { console.warn('[rules-h] font', e); }
  const [slam, badge, upa] = await Promise.all([img(new URL('./rules_h_assets/odds_slam_576.png', import.meta.url).href), img(new URL('./rules_h_assets/odds_badge_card.png', import.meta.url).href), img(new URL('./rules_h_assets/upa_source.png', import.meta.url).href)]);
  // 慎重すぎる客への助言（10/30）：?carefulhint=0 なら従来（重ね表示だけ）。判定が通ったら時計と発射を 3 秒止め、液晶・囲いの光・音を助言の場面にする
  let carefulFx = null;
  const useCareful = !!hint && new URLSearchParams(globalThis.location?.search ?? '').get('carefulhint') !== '0';
  let mash;
  if (useCareful) {
    try {
      const ch = await import('./careful_hint_1030.mjs'); carefulFx = await import('./careful_hint_fx_1030.mjs');
      const sprites = await ch.loadSprites(new URL('./rules_h_assets/careful/', import.meta.url));
      const gameProxy = { get lampCount() { return controller.game.lampCount; }, beginAdvice: (s) => controller.game.beginAdvice?.(s) ?? false, get adviceStatus() { return controller.game.adviceStatus ?? null; } };
      mash = ch.createCarefulHint({ game: gameProxy, sprites, cfg: hint, onStart: (d) => { try { log('careful:start', d); carefulFx.playAdviceSfx(globalThis.__r2Audio?.engine); } catch {} }, onEnd: () => { try { lcd.cabinetLightScript?.cue?.(null); } catch {} } });
    } catch (e) { console.warn('[rules-h] careful hint', e); mash = createMashHint({ img: upa, cfg: hint }); }
  } else mash = hint ? createMashHint({ img: upa, cfg: hint }) : null;
  const gem = await Promise.all(['1', '2', '3', '4', '5', '6', '7', 'max'].map((k) => img(new URL(`./rules_h_assets/gem_${k}.png`, import.meta.url).href)));
  const meter = createMeterH({ style, sprites: { digits: gem.slice(0, 7), max: gem[7] } });
  const model = lcd.jp.model, man = lcd.jp.man;
  if (!LOOP_OLD) for (const [nm, [a, b]] of Object.entries(LOOPS)) {   // H 専用の回転ループ映像に差し替え（G は触らない）
    const sc0 = man.scenes[nm]; if (!sc0 || sc0.hLoop || !/production_20261028\/roulette_\d+\.mp4$/.test(sc0.file)) continue;
    const shift = (LOOP_M - 1) * (b - a);
    sc0.hLoop = { a, b, shift }; sc0.file = sc0.file.replace(/roulette_(\d+)\.mp4$/, 'h_roulette_$1.mp4'); sc0.frames += shift; sc0.stop_frame += shift;
    for (const c of sc0.cues ?? []) if (c.f >= b) c.f += shift;
  }
  // ---- JPチャンスのチュートリアル ----
  const tq = new URLSearchParams(globalThis.location?.search ?? '').get('jptutorial');
  const TUT = { on: tq !== '0' && tq !== 'off', every: tq === 'all', fin: 'tutorial_jp_fin', secs: 0 };
  let tutOverlay = null;
  if (TUT.on && [2, 3, 4, 5].every((n) => man.scenes[`tutorial_jp_n${n}`]) && man.scenes[TUT.fin]) {
    try {
      tutOverlay = await loadTutorialOverlay(new URL('./jp1029/', import.meta.url));
      TUT.secs = Math.max(...[2, 3, 4, 5].map((n) => man.scenes[`tutorial_jp_n${n}`].frames)) / man.fps + man.scenes[TUT.fin].frames / man.fps;
      const rr = controller.game.rules; rr.JpTutorialSeconds = TUT.secs; rr.JpTutorialEvery = TUT.every;
    } catch (e) { console.warn('[rules-h] tutorial overlay', e); tutOverlay = null; }
  }
  const S = { wall: 0, normalT: 0, presses: 0, addContinue: false, clock: 0, plan: null, press: null, flashAt: -9, jpVideo: null, roulette: null, events: [], loops: 0, absorbed: 0, introFixes: 0 };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 200) S.events.shift(); log(k, d); };

  // ---- ゲームの出来事（規則 H の action 名。本体は controller.lastGameEvent）----
  let baseOnRef = null, heldAnnounce = null;
  const off = controller.onAction((action) => {
    const e = controller.lastGameEvent ?? {};
    if (action === 'chainAnnounce') {   // JP後の継続の告知（規則 H: ChainAnnounceSeconds）。専用の映像があれば lcd 側が受ける。無ければ normal_surface の仮カード
      const p = { first: !!e.first, atRisk: e.atRisk ?? 0, rate: e.rate ?? '2/3', seconds: e.seconds ?? 2.5 };
      heldAnnounce = p;   // 配当・継続成功の映像が終わって液晶が空いてから出す（frame で）
    } else if (action === 'meterReady') {
      meter.reset(); note('meterReady', { kind: e.kind });
      // 10/31 検証：6灯が時計0で揃い、追加入金のあとに規則がJPメーターを始めた場合は 'lamp6' の合図が来ず、導入の映像が出ない（約4秒、通常の画面のまま）。
      // 着地での開始（直前の受け取りが6灯目のFresh）なら 'lamp6' が来るので何もしない。そうでなければ frame で、映像が無いときだけ 'lamp6' を補う
      { const rc = controller.game.receipt; S.jpResume = e.kind === 'jp' && !(rc?.kind === 'Fresh' && rc.after?.length === 6) ? { at: S.wall, targets: e.targets ?? [] } : null; }
    }
        else if (action === 'meterLand') { if (e.hit) meter.hit(e.lane); }
    else if (action === 'meterEnd') { note('meterEnd', { success: e.success, count: e.count }); if (e.success) meter.end(true); }
    else if (action === 'rouletteStart') {
      // 回転の始まりは規則側で 5.8 秒遅らせてある。その間に、満タン → jp_rush → jp_bridge → roulette_{配当} を流す
      const payout = e.award;
      S.roulette = { payout, kind: e.kind, startedAt: S.clock, delay: e.startDelay ?? 0 };
      if (model.active && man.roulette[String(payout)]) {
        S.plan = { at: S.clock + FINISH_SECONDS, payout, done: false };
        model.payout = payout; model.revealedAt = null;
        model.priorRank = model.cue({ kind: 'hold', payout }) ?? 0;   // 配当の払い出しを reveal まで保留（G の 'jp' の入口と同じ合図）
      }
      note('rouletteStart', { payout, delay: e.startDelay });
    } else if (action === 'rouletteStopPress') {
      S.press = { at: S.clock, byAuto: !!e.byAuto, applied: false };
      note('press', { byAuto: !!e.byAuto, scene: model.name });
    } else if (action === 'rouletteStopped') { note('stopped', { payout: e.payout, award: e.award }); S.roulette = null; }
  });

  // ボタンの押下（'fire' の操作）。連打中の押下を、受け付けられたかどうかに関わらず数える（うぱの声かけの判定用）
  const dispatch0 = controller.dispatch.bind(controller);
  // 通常時（連打メーター・ルーレット・JP演出・選択の外）のプレイ中か
  const isNormal = () => { const g = controller.game; return ['Ready', 'Flight', 'Effect'].includes(g.phase) && !g.meterStatus && !g.rouletteStatus && !model.active && !lcd.choiceV20?.active; };
  controller.dispatch = (action, ...r) => { if (action === 'fire' && isNormal()) { S.presses++; mash?.press(S.wall); } return dispatch0(action, ...r); };

  // ---- チュートリアルの進行（毎フレーム jp.frame の頭で）----
  const isTut = (n) => /^tutorial_jp/.test(n ?? '');
  const tutRestore = () => {
    const T = S.tut; if (!T?.patched) return;
    man.scenes[T.patched.name].next = T.patched.next; man.scenes[TUT.fin].next = T.patched.finNext; man.scenes[T.scene].next = T.patched.sceneNext; T.patched = null;
  };
  const tutTick = () => {
    if (!tutOverlay) return;
    const g = controller.game, st = g.meterStatus, T = S.tut;
    if (!st?.tutorialPlanned || st.kind !== 'jp') { if (T) { tutRestore(); S.tut = null; } return; }
    const id = g.meter?.id;
    if (!T || T.meterId !== id) {
      tutRestore();
      S.tut = { meterId: id, scene: `tutorial_jp_n${st.threshold}`, born: S.clock, patched: null, started: false, acked: false, skip: false };
      if (!man.scenes[S.tut.scene]) { S.tut.skip = true; g.endJpTutorial?.(); note('tutorial:skip', { n: st.threshold }); }
      return;
    }
    if (T.skip || T.acked) return;
    const ack = (why) => { T.acked = true; g.endJpTutorial?.(); note('tutorial:end', { why }); };
    // 導入（雷 → JACKPOT CHANCE）の間に、チャンス題字の次を説明の映像へ差し替える（読み込みも先に始まる）
    if (!T.patched && !T.started && model.active && !model.chainMode && /^jp_(intro|chance)/.test(model.name ?? '')) {
      const cn = `jp_chance_d${model.d}`, cs = man.scenes[cn];
      if (cs) {
        T.patched = { name: cn, next: cs.next, finNext: man.scenes[TUT.fin].next, sceneNext: man.scenes[T.scene].next };
        cs.next = T.scene; man.scenes[T.scene].next = TUT.fin; man.scenes[TUT.fin].next = `jp_aim_d${model.d}`; note('tutorial:patched', { scene: T.scene, d: model.d });
      }
    }
    if (isTut(model.name)) {
      if (!T.started) { T.started = true; T.t0 = S.clock; note('tutorial:start', { scene: model.name }); tutRestore(); }
      if (st.stage === 'firing') { model.start(`jp_aim_d${model.d}`); ack('firing'); return; }     // 規則が先に終えた（打ち切り）：説明を切って狙いへ
      if (model.name === TUT.fin && (model.time ?? 0) >= man.scenes[TUT.fin].frames / man.fps - 0.12) ack('done');
    } else if (T.started || (!model.active && S.clock - T.born > 2) || (st.tutorialActive && /^jp_aim/.test(model.name ?? ''))) { ack(T.started ? 'left' : 'unplayed'); tutRestore(); }
  };

  // 救済：説明の段なのに映像が止まっている（JPの映像が途中で終わり、jp.frame が呼ばれなくなった）ときは、説明の映像をここから直接始める。2回やっても流れなければ説明を打ち切る（時計は止めたままにしない）
  const tutRescue = () => {
    if (tutOverlay && !model.active) tutTick();   // 映像が止まっていると jp.frame が呼ばれないので、状態の読み取り（計画・確認）はここでも行う
    const T = S.tut; if (!tutOverlay || !T || T.skip || T.acked) return;
    const g = controller.game, st = g.meterStatus;
    if (!st?.tutorialPlanned || st.kind !== 'jp' || st.stage !== 'tutorial') { T.idleAt = null; return; }
    if (model.active) { T.idleAt = null; return; }
    const nowMs = performance.now(); T.idleAt ??= nowMs;
    if (nowMs - T.idleAt < 250) return;
    T.idleAt = null; T.rescues = (T.rescues ?? 0) + 1;
    if (T.rescues > 2 || !man.scenes[T.scene]) { T.acked = true; g.endJpTutorial?.(); tutRestore(); note('tutorial:end', { why: 'rescue-fail' }); return; }
    const d = model.d || 4; tutRestore();
    man.scenes[T.scene].next = TUT.fin; man.scenes[TUT.fin].next = `jp_aim_d${d}`; T.started = true; T.t0 = S.clock; T.patched = null;
    model.delay = 0; model.pending = null; model.start(T.scene); note('tutorial:rescue', { scene: T.scene, d });
  };

  // ---- 映像の流れ（lcd.jp.frame を包む：毎フレーム、描く映像を返す関数）----
  const jp = lcd.jp, jpFrame = jp.frame.bind(jp);
  const stopFrame = () => man.scenes[model.name]?.stop_frame ?? 121;
  jp.frame = (dt) => {
    S.clock += dt;
    const g = controller.game;
    tutTick();
    // 満タンの叩きつけの後、つなぎの映像へ
    if (S.plan && !S.plan.done && S.clock >= S.plan.at && model.active) {
      S.plan.done = true; model.delay = 0; model.pending = null; model.start('jp_rush'); note('plan:jp_rush');
    }
    const v = jpFrame(dt);
    S.jpVideo = v;
    const name = model.name ?? '';
    if (/^roulette_\d+$/.test(name) && v?.tagName === 'VIDEO') {
      const sc = man.scenes[name], t = v.currentTime * man.fps;
      const ro = g.rouletteStatus;
      if (S.press && !S.press.applied) {
        // 押した瞬間：停止コマの手前 36 コマへ。ここから 1.2 秒で止まる。つなぎは白いブレーキ光で隠す
        S.press.applied = true; S.flashAt = S.clock; v.currentTime = Math.max(0, (sc.stop_frame - SLIDE_FRAMES) / man.fps); note('slide', { from: sc.stop_frame - SLIDE_FRAMES });
      } else if (!S.press && (!ro || ro.stage === 'spinning')) {
        const [la, lb] = loopOf(name, sc);
        if (t >= lb) {
          // 回転を繰り返す（押されるまで）。行き過ぎた分(最大 4 コマ)は始めに足して位相を保つ。タイムラインの時刻も同時に合わせ、jp_surface 側の巻き戻し検出による 2 度目のシークを防ぐ
          const to = (la + Math.min(4, Math.max(0, t - lb))) / man.fps;
          v.currentTime = to; model.time = to; model.lastF = Math.floor(to * man.fps + 1e-6) - 1; S.loops++;
        }
      }
    } else if (!/^(roulette|jp_rush|jp_bridge)/.test(name) && S.press && !S.roulette) S.press = null;
    return v;
  };

  // ---- 映像のイベント（lcd.onEvent を包む）----
  const baseOn = lcd.onEvent.bind(lcd); baseOnRef = baseOn;
  let heldChoice = null;   // 告知中に届いた chain_choice（告知が終わって選択になるときに流す。最初の自動継続では捨てる）
  lcd.onEvent = (id, p = {}) => {
    if (id === 'chain_choice' && controller.game.chainAnnouncing) { heldChoice = p; return true; }
    if (id === 'start') { mash?.reset(); S.normalT = 0; S.presses = 0; }   // プレイの始まり：うぱの促しの判定を最初から
    if (id === 'lamp6') {
      S.jpResume = null;
      const handled = baseOn(id, p);
      // 導入は 雷 → 黒背景＋字 → JACKPOT CHANCE（字は G と同じく dopamine/reach を等確率。10/30 監督：消さない）。映像は 6灯目の瞬間から（規則の導入 6.3秒と同じ）
      if (model.active && !model.chainMode) { model.delay = 0; S.introFixes++; }
      return handled;
    }
    if (id === 'jp') {
      // H の 'jp' は止まった後に来る
      if (!p.chain && model.active && model.payout > 0) { S.absorbed++; note('jp:absorbed'); return true; }   // 配当の映像は roulette → reward のまま続ける
      if (p.chain && model.chainMode) model.payout = 0;                                                   // 継続は chain_jp_land → 継続成功 → 配当
    }
    return baseOn(id, p);
  };

  // ---- 重ねる絵 ----
  const base = lcd.frame.bind(lcd);
  const ofs = { offerT: 0 };
  lcd.frame = (dt, F) => {
    tutRescue();
    const r = base(dt, F);
    if (S.jpResume && S.wall - S.jpResume.at > 0.3) {   // 追加入金後のJP開始：導入の映像（上の meterReady の注）
      const J = S.jpResume; S.jpResume = null;
      if (controller.game.meterStatus?.kind === 'jp' && !model.active && !lcd.choiceV20?.active) { const after = [1, 2, 3, 4, 5, 6, 7].filter((x) => !J.targets.includes(x)); note('jp:lamp6-resume', { after }); lcd.onEvent('lamp6', { after, pockets: after }); }
    }
    if (heldAnnounce && !lcd.jp.claimed) { const p0 = heldAnnounce; heldAnnounce = null; S.announceOn = true; note('chain_announce', p0); baseOnRef('chain_announce', p0); }
    if (S.announceOn && !controller.game.chainAnnouncing) { S.announceOn = false; heldAnnounce = null; }
    if (heldChoice) { const g0 = controller.game; if (g0.phase !== 'ChainChoice') heldChoice = null; else if (!g0.chainAnnouncing) { const p0 = heldChoice; heldChoice = null; baseOn('chain_choice', p0); } }
    S.wall += dt; if (isNormal()) S.normalT += dt;
    S.choiceT = lcd.choiceV20?.active ? (S.choiceT ?? 0) + dt : 0;
    const g = controller.game, st = g.meterStatus, name = model.active ? model.name : null;
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    // 赤い警報（連打中だけ。メーター部品の下）
    // 10/31 JPチャンスの札・焦り(jp_hud_1031)が出ている間は、旧の液晶 canvas への警報・メーターは描かない（GPU の映像経路では見えず、2D の経路に落ちたときに二重になる）。?jphud=0 で旧
    const hudOwned = !!lcd.jpHud?.active;
    const lv = hudOwned ? 0 : alarmLevel(st);
    if (lv) drawAlarm(ctx, lv, S.clock);
    // メーター部品は、狙いの映像（jp_aim / chain_jp_aim、または JACKPOT CHANCE の終盤）が見えている間だけ出す。導入の雷・題字に重ねない
    const hudOk = !!name && (/^(jp_aim|chain_jp_aim)/.test(name) || (/^jp_chance/.test(name) && (model.time ?? 0) >= 2.4) || meter.finishing || (st?.stage === 'firing' && st.count > 0 && /^(jp_|chain_jp)/.test(name)));   // 1個でも入れば、映像が遅れていても HUD と入賞の演出は出す
    S.hudOk = hudOk;
    // チュートリアルが計画されている間は、導入〜説明の間ずっと「連打」の出番の前の状態にする（説明のあと、撃てるときに連打のカットインが出る）
    const stD = st?.tutorialPlanned && (st.stage === 'intro' || st.stage === 'tutorial') ? { ...st, stage: 'intro', introLeft: 9 } : st;
    if (tutOverlay && /^tutorial_jp_n\d$/.test(name ?? '')) tutOverlay.draw(ctx, model.time ?? 0, model.d);   // 残った穴の上に矢印・光柱・光の筋
    meter.draw(ctx, dt, (hudOk && !hudOwned) || meter.finishing ? stD : null);
    // 連打のカットイン（ガンダム逆シャア）：雷の導入の間は出さない。それ以外の場面なら、HUD の条件を待たずに出す
    if (name && !/^jp_intro/.test(name) && /^(jp_|chain_jp)/.test(name)) meter.drawCut(ctx, stD);
    // 通常時、連打していなさそうな客へ、うぱの声かけ（字）。通常時だけ（JPチャンス中・継続中は出さない）
    if (mash) mash.draw(ctx, dt, { normal: isNormal(), elapsed: S.normalT }, S.wall);
    if (mash?.state.active && mash.state.t !== undefined && carefulFx) lcd.cabinetLightScript?.cue?.('careful_hint', mash.state.t);   // 助言の間、囲いはやさしい光
    // 時計0：JPチャンス中に切れても連打は最後まで（規則側が進める）。液晶は途中で切らず、記録だけ残す
    if (g.secondsLeft <= 0 && (st || g.rouletteStatus) && !S.zeroNoted) { S.zeroNoted = true; note('clockZero', { meter: st?.stage ?? null, roulette: g.rouletteStatus?.stage ?? null }); }
    else if (g.secondsLeft > 0) S.zeroNoted = false;
    // ルーレットの押した瞬間：白いブレーキ光（つなぎの二重像を隠す）。全面の白を保ってからほどく
    const fa = S.clock - S.flashAt;
    if (fa >= 0 && fa < BRAKE.hold + BRAKE.fade) {
      const k = fa < BRAKE.hold ? 1 : 1 - (fa - BRAKE.hold) / BRAKE.fade, gr = ctx.createRadialGradient(W / 2, H * 0.5, 40, W / 2, H * 0.5, 620);
      gr.addColorStop(0, `rgba(255,255,255,${0.95 * k})`); gr.addColorStop(0.5, `rgba(255,236,200,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,255,255,${(fa < BRAKE.hold ? 0.95 : 0.95 * k * k)})`; ctx.fillRect(0, 0, W, H);
    }
    // 継続の告知枠「継続できるよ!」を、画面いっぱいの 2/3 の叩きつけに置き換える
    if (name === 'chain_offer') {
      const t = model.time ?? 0;
      const bg = jp.palace?.video;
      if (bg) { try { ctx.drawImage(bg, 0, 0, W, H); } catch {} }
      ctx.fillStyle = 'rgba(8,0,24,.45)'; ctx.fillRect(0, 0, W, H);
      const sc = 1 + 0.45 * (1 - easeOut(t / 0.22)) ** 2 + (t > 0.22 ? 0.012 * Math.sin(t * 6) : 0), sh = t > 0.22 ? Math.sin(t * 90) * 10 * Math.exp(-(t - 0.22) * 18) : 0;
      const fade = Math.min(1, t / 0.06) * Math.min(1, Math.max(0, (OFFER_SECONDS - t) / 0.18));
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(W / 2 + sh, H / 2); ctx.scale(sc * 2, sc * 2); ctx.drawImage(slam, -slam.width / 2, -slam.height / 2); ctx.restore();
      const fl = Math.max(0, 1 - t / 0.14); if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl ** 1.5})`; ctx.fillRect(0, 0, W, H); }
    }
    // 選択画面：「継続」の札の上半分に、札の幅いっぱい(90%)の銀の 2/3（黒縁）。出るときに強く叩きつける。継続を選ぶと成功率 2/3、と結びつけて見せる
    if (lcd.choiceV20?.active) {
      const cv = lcd.choiceV20, sel = cv.selected, tr = cv.transition, gs = CARD[sel] ?? CARD.neutral;
      let G = gs; if (tr?.from && CARD[tr.from]) { const a0 = CARD[tr.from], k = tr.alpha; G = { cx: a0.cx + (gs.cx - a0.cx) * k, cy: a0.cy + (gs.cy - a0.cy) * k, frame: a0.frame + (gs.frame - a0.frame) * k }; }
      const t = S.choiceT - BADGE_DELAY, u = t - 0.14;
      if (t >= 0) {
        const m = u < 0 ? 3.0 - 2.0 * (t / 0.14) ** 2 : 1 + 0.10 * Math.exp(-9 * u) * Math.cos(u * 38), sh = u >= 0 ? Math.sin(u * 100) * 14 * Math.exp(-u * 16) : 0, sv = u >= 0 ? Math.cos(u * 83) * 9 * Math.exp(-u * 16) : 0;
        const sc = (G.frame * BADGE_RATIO / BADGE_GLYPH) * m;
        ctx.save(); ctx.globalAlpha = Math.min(1, t / 0.04); ctx.translate(G.cx + sh, G.cy + sv); ctx.scale(sc, sc); ctx.drawImage(badge, -badge.width / 2, -badge.height / 2); ctx.restore();
        if (u >= 0 && u < 0.3) {   // 着いた瞬間の白い閃光（札の上だけ。にじみのみ）
          const f = (1 - u / 0.3) ** 2, gr = ctx.createRadialGradient(G.cx, G.cy, 10, G.cx, G.cy, G.frame * 0.75);
          gr.addColorStop(0, `rgba(255,255,255,${0.85 * f})`); gr.addColorStop(0.45, `rgba(255,230,170,${0.35 * f})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(G.cx - G.frame, G.cy - G.frame, G.frame * 2, G.frame * 2); ctx.globalCompositeOperation = 'source-over';
        }
      }
      // 時間切れ後の継続：札の上に「追加で継続」（受け口は lcd.rulesH.setContinueAdd）。字(2/3)と重ならないよう、札の絵の下半分（「継続」の文字の上）／小さい札では札の上
      if (S.addContinue || g.chainNeedsAdd) {
        const left = sel === 'left', cx = left ? 905 : 800, cy = left ? 520 : 745;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(2.4, 0.5); const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
        gg.addColorStop(0, 'rgba(20,0,30,.7)'); gg.addColorStop(1, 'rgba(20,0,30,0)'); ctx.fillStyle = gg; ctx.fillRect(-210, -210, 420, 420); ctx.restore();
        // 時計0の継続は100円の追加が要る：客が気づくよう「100円で継続」と出す（?chainaddlabel=0 で旧の「追加で継続」）
        const label = new URLSearchParams(globalThis.location?.search ?? '').get('chainaddlabel') === '0' ? '追加で継続' : '100円で継続';
        telop(ctx, label, cx, cy, label.length > 5 ? (left ? 56 : 78) : (left ? 64 : 92), { glow: 'rgba(255,170,40,.9)' });
      }
    }
    ctx.restore();
    return r;
  };
  // 毎フレーム変わる重ね描きがあるので、液晶面の「更新なし」判定を外す（他の attach と同じ作法）
  const rev = Object.getOwnPropertyDescriptor(lcd, 'uploadRevision')?.get;
  if (rev) Object.defineProperty(lcd, 'uploadRevision', { configurable: true, enumerable: true, get: () => (/^tutorial_jp/.test(model.name ?? '') || controller.game.meterStatus || controller.game.rouletteStatus || mash?.state.active || meter.finishing || (S.clock - S.flashAt < BRAKE.hold + BRAKE.fade + 0.05) || model.name === 'chain_offer' || lcd.choiceV20?.active) ? undefined : rev.call(lcd) });
  lcd.rulesH = { state: S, meter, hint: mash, setContinueAdd(on) { S.addContinue = !!on; }, alarmLevel: () => alarmLevel(controller.game.meterStatus), ALARM, dispose() { off?.(); controller.dispatch = dispatch0; jp.frame = jpFrame; lcd.onEvent = baseOn; lcd.frame = base; } };
  // 継続告知 v09（10/30）：配当の後の告知を本番の映像に（失う玉数は実行時に重ねる）。?chainannounce=old で旧（仮カード・2.5秒）
  if (new URLSearchParams(location.search).get('chainannounce') === 'old') {
    const old = () => { const r = controller.game?.rules; if (r) { r.ChainAnnounceSeconds = 2.5; r.ChainAnnounceSecondsFirst = 2.5; } };
    old(); controller.onAction((action) => { if (action === 'reset') old(); });
  } else await (await import('./chain_announce_v09_1030.mjs')).attachChainAnnounceV09(lcd, { controller, log });
  await (await import('./fx_trim_1030.mjs')).attachFxTrim(lcd, { controller, log });   // 10/30 演出の短縮（溜めと間）。?fxtrim=0 で無し
  await (await import('./jp_seal_1030.mjs')).attachJpSeal(lcd, { controller, log });
  try { await (await import('./jp_start_1031.mjs')).attachJpStart(lcd, { controller, log }); } catch (e) { console.warn('[jp-start]', e); }   // 10/31 JPチャンスの始まり（止め→雷→扉→題字。黒背景＋文字を外す）。?jpstart=0 で旧、?jpblack=1 で黒背景＋文字を戻す
  try { await (await import('./jp_hud_1031.mjs')).attachJpHud(lcd, { controller, log }); } catch (e) { console.warn('[jp-hud]', e); }   // 10/31 JPチャンス中の残り個数＋残り時間の札・焦り（心拍・赤い縁・警告灯・囲いの赤）。?jphud=0 で無し   // 10/30 JPチャンス中の映像を封印の扉に。?jpseal=0 で旧（jp_aim）
  if (new URLSearchParams(globalThis.location?.search ?? '').get('ft') !== '0') { try { await (await import('./first_timer_1030.mjs')).attachFirstTimer(lcd, { controller, log }); } catch (e) { console.warn('[first-timer]', e); } }   // 10/30 初見の客向けの小さな配慮（?ft1〜ft5=0 で個別に、?ft=0 で全部無し）
  if (new URLSearchParams(globalThis.location?.search ?? '').get('chainseal') === 'v02') await (await import('./chain_seal_1030.mjs')).attachChainSeal(lcd, { controller, log });   // 10/30 継続チャレンジも封印の扉に（JPと同じ経路）。?chainseal=v02 で旧の独自実装、?chainseal=0 で旧（chain_jp_aim）。既定は jp_seal_1030 が継続も担当
  return lcd;
}
