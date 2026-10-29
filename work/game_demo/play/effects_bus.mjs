import boardSync from '../../effects/spec/board_sync.mjs';
// 演出モジュール向けの通知専用バス。規則・物理を操作しない。
export const EFFECT_IDS = Object.freeze(('attract title howto ticket start ambient launch lamp123 lamp4 lamp5 lamp6 dup_protect roulette ascend challenge_declare challenge_wait challenge_flight success_small success_big fail jp tray_overflow warn10 timeup add100 finish_count result challenge_cancel chain_choice chain_continue chain_stop jp_heat jp_mouth').split(' '));
const FIRST = ['shot', 'light', 'duplicate', 'challenge', 'success', 'failure'];
const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export class EffectsBus {
  constructor({ context = () => ({}) } = {}) {
    this.context = context; this.handlers = new Map(); this.counts = {}; this.total = 0; this.last = null;
  }
  on(id, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this.handlers.has(id)) this.handlers.set(id, new Set());
    this.handlers.get(id).add(handler);
    return () => this.handlers.get(id)?.delete(handler);
  }
  emit(id, payload = {}) {
    const c = this.context();
    const event = freeze(copy({ id, t: payload.t ?? c.t ?? 0,
      state: { lit: 0, pockets: [], balls: 0, secondsLeft: 0, canLaunch: false, declared: false, ...c.state, ...payload.state,
        first: Object.fromEntries(FIRST.map(k => [k, !!payload.state?.first?.[k]])) }, data: payload.data ?? {} }));
    this.last = event; this.total++; this.counts[id] = (this.counts[id] ?? 0) + 1;
    // 一方の購読解除/追加は、今回の配送対象を変えない。
    const handlers = [...(this.handlers.get(id) ?? []), ...(this.handlers.get('*') ?? [])];
    for (const handler of handlers) {
      try { handler(event); } catch (error) { console.error(`[effects:${id}] handler failed`, error); }
    }
    return event;
  }
  snapshot() { return copy({ total: this.total, counts: this.counts, last: this.last, ...this.context() }); }
  // 描画側が読む時点の状態だけを独立複製する。診断用の件数・直近イベントはsnapshot()に残す。
  contextSnapshot() { return copy(this.context()); }
}

/** presenter/controller/physics の通知を演出idへ翻訳。tはruntimeの経過秒（規則の時計停止中も進む）。 */
export function connectEffects({ ctrl, presenter, bus = new EffectsBus() }) {
  let clock = 0, game = ctrl.game, phase = game.phase, warned = false, started = false, resultSent = false;
  let seen = new Set(), levels = new Set(), shots = new Map(), pending = [], receiptSeen = -1, chainTry = 0, choiceSent = null;
  bus.context = () => ({ t: clock, state: { lit: ctrl.game.lampCount, pockets: ctrl.game.lamps,
    balls: ctrl.game.wallet, secondsLeft: ctrl.game.secondsLeft,
    canLaunch: (ctrl.game.rules.R2Enabled || ctrl.game.rules.ResetWhileShooting ? ctrl.game.canFire : ctrl.game.overlap ? ctrl.game.canAim : ctrl.game.canFire) && !ctrl.confirmFinish && !ctrl.freezeRules,
    declared: ctrl.game.armed, ...(ctrl.game.rules.ResetWhileShooting ? { resetDisplays: ctrl.game.resetDisplays } : {}),
    ...(ctrl.game.rules.R2Enabled ? { challenge: ctrl.game.challengeStatus, end: ctrl.game.endStatus, aim: ctrl.aim } : {}) } });
  // 次の景品までの実数(結果画面・計数の「あと○玉でA賞」用)。景品は規則の判定(g.prize)に従う:
  // R3 は持ち玉でなく JP の合計(継続の積み増しを含む)で決まり、S は 500 を当てた時だけ(合計では A まで)なので、A の次は出さない
  const nextRank = g => {
    const rules = g.rules, th = rules.PrizeThresholds, score = rules.R3Enabled ? g.jackpotEarnings : g.wallet;
    const rank = Math.max(0, rules.PrizeNames.indexOf(g.prize)), last = rules.R3Enabled ? th.length - 2 : th.length - 1;
    return rank + 1 <= last ? { rankIndex: rank, score, next_rank: rank + 1, to_next: th[rank + 1] - score, next_threshold: th[rank + 1] } : { rankIndex: rank, score, next_rank: null, to_next: 0, next_threshold: null };
  };
  const send = (id, data = {}, category) => {
    const first = category ? !seen.has(category) : false;
    if (category) seen.add(category);
    return bus.emit(id, { state: { first: { [category]: first } }, data: { ...data, first } });
  };
  const reset = () => { jpFlight = null; game = ctrl.game; seen = new Set(); levels = new Set(); shots = new Map(); pending = []; receiptSeen = -1; chainTry = 0; choiceSent = null; warned = false; started = false; resultSent = false; };
  const offAction = ctrl.onAction(action => {
    const g = ctrl.game;
    if (action === 'howto') { reset(); send('howto', { seconds: ctrl.howtoSeconds }); }
    if (action === 'start') { reset(); send('ticket', { balls: g.rules.LoanBalls, duration: g.receipt.duration }); }
    if (action === 'add') { warned = false; send('add100', { balls: g.receipt.award, seconds: g.rules.ExtraSeconds, duration: g.receipt.duration, chain: !!g.jackpotChain, chainPending: g.jackpotChain?.pendingAward ?? 0 }); }
    if (action === 'challengeWait') send('challenge_wait', { award: g.award, onBoard: g.shots.length });
    if (action === 'challenge') send(g.armed ? 'challenge_declare' : 'challenge_cancel', { award: g.award }, g.armed ? 'challenge' : undefined);
    if (action === 'fire') {
      // 継続の挑戦は何連目か(1から)。外れのレシートには段が残らないので撃った時に覚える
      const chainStage = g.shot.chain ? (g.jackpotChain?.stage ?? 0) + 1 : 0;
      if (g.shot.chain) chainTry = chainStage;
      shots.set(g.shot.id, { shotId: g.shot.id, aim: ctrl.lockedAim, dir: ctrl.aimDir, challenge: g.shot.challenge, chain: !!g.shot.chain, chainStage, lamps: [...g.shot.lamps] });
    }
    if (action === 'chainContinue' && g.chainStatus) { const c = g.chainStatus; send('chain_continue', { chain: c.successes, lamps: g.lampCount, pending: c.pendingAward, base: c.baseAward }); }   // 灯がL個まとめて点く
    if (action === 'reset') { reset(); phase = g.phase; send('attract'); }
    sync();
  });
  function receipt(r) {
    if (!r || r.id === receiptSeen) return;
    receiptSeen = r.id;
    const g = ctrl.game;
    const data = { jackpotEarnings:g.jackpotEarnings, receiptId: r.id, lane: r.lane, pocket: r.lane, award: r.award, duration: r.duration, before: r.before, after: r.after };
    if (r.kind === 'Fresh') {
      const n = r.after.length, firstAtLevel = !levels.has(n); levels.add(n);
      send(n <= 3 ? 'lamp123' : `lamp${n}`, { ...data, award: g.rules.Awards[n], firstAtLevel }, 'light');
    } else if (r.kind === 'Protected') send('dup_protect', data, 'duplicate');
    else if (r.kind === 'Reset') {
      const removed = r.before.filter(l => !r.after.includes(l));
      const d = { ...data, result: r.resetChoice, removed, removedCount: r.removed, k: r.removed, n_from: r.before.length,
        ...(r.visualDuration !== undefined ? { duration: r.visualDuration, ruleDuration: r.duration, resetSlot: r.resetSlot, resetReplaces: r.resetReplaces, maxConcurrent: 3 } : {}) };
      if (r.resetReplaces != null) pending = pending.filter(event => event.data.receiptId !== r.resetReplaces);
      send('roulette', d, 'duplicate');
      // 現行Presenterの針停止(1.1秒)。1灯時は針がなく即決。
      pending.push({ at: clock + (r.before.length > 1 ? 1.1 : 0), id: 'ascend', data: d });
    } else if (r.kind === 'ChainStop' || (r.kind === 'Win' && r.chainBanked)) {
      // 継続をやめた・計数に入った：積み増し(banked)をここで払い出す。積み増しが0ならChainStopのレシート
      const banked = r.kind === 'Win' ? r.award : 0, base = r.chainBase ?? 0;
      send('chain_stop', { ...data, banked, chain: r.chainStage > 0 ? r.chainStage : 0, base, total: base + banked, reason: g.phase === 'Result' ? 'finish' : 'stop', duration: r.duration });
    } else if (r.kind === 'Win') {
      if (!r.chain) choiceSent = null;   // 新しいJP：同じ配当・段でも resumed にしない
      if (r.chain || r.before.length === 6) send('jp', { ...data, payout: r.award, tier: r.jackpot, chain: !!r.chain, chainStage: r.chain ? r.chainStage : 0, chainLost: 0,
        pending: r.chain ? r.chainPending : 0, base: r.chain ? r.chainBase : r.award, paid: !r.chain }, 'success');
      else send(r.before.length <= 3 ? 'success_small' : 'success_big', data, 'success');
    } else if (r.kind === 'Miss') {
      // 「惜しい」(R-22): 勝負球が外れ、かつ玉が灯のない口の入口線を内向きに通過してから仕切りを跨いで別の口へ落ちた時だけ(物理イベント)。
      const unlit = [1, 2, 3, 4, 5, 6, 7].filter(l => !r.before.includes(l));
      const L = landing && landing.cup === r.lane ? landing : null;
      const near = !!(L && L.crossed && unlit.includes(L.approachCup));
      send('fail', { ...data, unlit, target: near ? L.approachCup : null, gap: near ? Math.abs(L.approachCup - r.lane) : null, near_miss: near,
        chain: !!r.chain, chainStage: r.chain ? chainTry : 0, chainLost: r.chain ? r.chainLost : 0, base: r.chain ? r.chainBase : 0 }, 'failure');
    }
  }
  const offPresenter = presenter.on((kind, detail) => { if (kind === 'receipt') receipt(detail); });
  function sync() {
    const g = ctrl.game;
    if (game !== g) reset();
    // 継続の決着(やめる・計数)は操作の直後に出す。Presenterの次の通知を待つと finish_count より後になる
    if (g.receipt && (g.receipt.kind === 'ChainStop' || g.receipt.chainBanked)) receipt(g.receipt);
    if (g.secondsLeft > 10) warned = false;
    if (!warned && g.secondsLeft <= 10 && ['Ready', 'Flight', 'Effect'].includes(g.phase)) { warned = true; send('warn10'); }
    if (phase !== g.phase) {
      phase = g.phase;
      if (phase === 'Ready' && !started) { started = true; send('start', { duration: 0 }); }
      if (phase === 'ChainChoice' && g.chainStatus) {
        // 継続するか選ぶ画面。積み増し(pending)は未払い。追加の払い出しから戻った時は resumed
        const c = g.chainStatus, key = `${c.baseAward}:${c.successes}`;
        send('chain_choice', { pending: c.pendingAward, chain: c.successes, lamps: c.nextLamps, base: c.baseAward, resumed: choiceSent === key, secondsLeft: g.secondsLeft });
        choiceSent = key;
      }
      if (phase === 'Continue') send('timeup', { reason: g.endReason, reasonCode: g.wallet === 0 ? 'balls' : 'time', duration: g.rules.ContinueSeconds });
      if (phase === 'Result') send('finish_count', { reason: g.endReason, reasonCode: g.wallet === 0 ? 'balls' : g.secondsLeft <= 0 ? 'time' : null, balls: g.wallet, total: g.wallet, ...nextRank(g) });
    }
    const readyAmbient = g.phase === 'Ready' && !presenter.reveal && !Object.values(presenter.fx).some(Boolean);
    if (readyAmbient && !ambient) send('ambient');
    ambient = readyAmbient;
    // Most physics ticks have no delayed cue; avoid two empty arrays per sync.
    if (pending.length) {
      const due = pending.filter(p => p.at <= clock + 1e-9); pending = pending.filter(p => p.at > clock + 1e-9);
      for (const p of due) send(p.id, p.data);
    }
  }
  let ambient = false, landing = null, jpFlight = null;
  function physics(e) {
    if (e.type === 'jp_line' && jpFlight?.shotId === e.shotId) {
      const bins=boardSync.levels[String(Math.round(e.y*1000))];
      const cell=bins?.[`${Math.floor(e.x*1000/4)}:${e.vx>=0?1:-1}`];
      const p=cell ? jpFlight.unlit.reduce((sum,d)=>sum+cell.p[d-1],0) : 0;
      const tier=p>=.6?3:p>=.4?2:p>=.2?1:0;
      jpFlight.tier=Math.max(jpFlight.tier,tier);
      // 中図柄用: 盤の各穴の見込み(cell.p)・位置/速さ・口までの予測時間(自由落下。ピンの反射は見込めない)
      let eta = null;
      if (Number.isFinite(e.vy) && Number.isFinite(e.mouthY) && e.y > e.mouthY) { const g = 9.81, disc = e.vy * e.vy + 2 * g * (e.y - e.mouthY); eta = Math.max(0, (e.vy + Math.sqrt(disc)) / g); }
      send('jp_heat',{shotId:e.shotId,level:e.level,tier:jpFlight.tier,p,chain:jpFlight.chain,y:e.y,x:e.x,vx:e.vx,vy:e.vy,probs:cell?[...cell.p]:null,eta,unlit:jpFlight.unlit});
    }
    if (e.type === 'jp_mouth' && jpFlight?.shotId === e.shotId)
      send('jp_mouth',{shotId:e.shotId,cup:e.cup,unlit:jpFlight.unlit.includes(e.cup),chain:jpFlight.chain});
    if (e.type === 'cup' && jpFlight?.shotId===e.shotId) send('jp_mouth',{shotId:e.shotId,cup:e.cup,unlit:jpFlight.unlit.includes(e.cup),chain:jpFlight.chain,phase:'cup'});   // 中図柄を実際に入った穴で止め直す(口から入れ替わった時用)
    if (['cup','lost'].includes(e.type) && jpFlight?.shotId===e.shotId) jpFlight=null;
    if (e.type === 'cup') landing = { cup: e.cup, approachCup: e.approachCup, crossed: !!e.crossed };
    // runtimeではlanding直後に呼ぶ。次の入力が来る前に確定receiptを通知する。
    // Presenterの次tickの同じreceipt通知はidで除外する。
    if (e.type === 'cup' && ctrl.game.receipt?.lane === e.cup) receipt(ctrl.game.receipt);
    else if (e.type === 'launch') {
      const shot = shots.get(e.shotId); // aimは入力受付時、通知時刻は実際の物理発射時。
      if (!shot) return;
      shots.delete(e.shotId);
      send('launch', { shotId: shot.shotId, aim: shot.aim, dir: shot.dir }, 'shot');
      if (shot.challenge) { jpFlight={...shot, tier:0, unlit:[1,2,3,4,5,6,7].filter(d=>!shot.lamps.includes(d))}; send('challenge_flight', { shotId: shot.shotId, pockets: shot.lamps, lamps: shot.lamps.length, chain: shot.chain, chainStage: shot.chainStage }); }
    } else if (e.type === 'overflow') send('tray_overflow', { ...e, balls: ctrl.game.wallet, total: ctrl.game.wallet });
    else if (e.type === 'count_done' && ctrl.game.phase === 'Result' && !resultSent) {
      resultSent = true;
      const g = ctrl.game, next = nextRank(g);
      const prizeRank = ['participation', 'C', 'B', 'A', 'S', 'SS'][next.rankIndex];
      send('result', { prizeRank, rank: prizeRank, balls: g.wallet, total: g.wallet, counted: e.counted, ...next });
    }
  }
  // Attractフェーズは既存の開始待ち画面に対応。titleは接近/タッチ検出未実装のため呼出し口のみ。
  send('attract');
  return { bus, physics, advance(dt) { clock += dt; sync(); }, sync,
    enterTitle(data = {}) { send('title', data); }, dispose() { offAction(); offPresenter(); } };
}
