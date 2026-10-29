// 演出の配線（MedalGameHost.Presentation.cs の盤面描画を除いた部分）。規則の Receipt/フェーズに反応して
//   ・効果音(cue)  ・オーバーレイの view（HUD・バナー・ルーレット・JP リール・カットイン・結果）
//   ・照明入力 lightingInputs()（方式C の LightingFrame の元データ。灯の集合・モード・決着の瞬間）
// を作る。着地(レーン)は決めない: 決めるのは物理だけ。タイマーは全て update(dt) で進める(リプレイ/試験が決定的)。
//
// 物理側(皿・釘)が繋がるときの口:
//   presenter.externalTray = true にすると内蔵の「払い出し」(持ち玉の表示だけを1球ずつ増やす)を止め、
//   物理が presenter.setDisplayWallet(n) / setCounted(n) / countFinished() を呼ぶ。
//   釘ヒット: presenter.pegHit(index)  皿の玉: trayBall({earned, intoBox})  皿の衝突音: trayClatter(0..1)
import { MedalPhase, MedalEvent, JACKPOT_SECONDS } from '../rules/medal_rules.mjs';

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const tierOf = (lamps) => (lamps <= 3 ? 0 : lamps - 3);

export class MedalPresenter {
  constructor(ctrl, { audio = null, quiet = false, music = false, records = null } = {}) {
    this.ctrl = ctrl; this.audio = audio; this.quiet = quiet; this.music = music; this.records = records;
    this.externalTray = false; this.walletOverride = null;
    this.holdAwards = false; this.maxHold = 4;   // 演出が awardToTray() で払い出しを指揮するモード(既定は従来どおり即払い)
    this.clock = 0; this.listeners = new Set();
    this._reset();
  }
  _reset() {
    this._seen = -1; this._phase = null; this._prevLamps = 0; this._prevArmed = false;
    this.reveal = null; this.fx = { banner: null, roulette: null, jackpot: null, cutin: null };
    this.pending = 0; this.pour = { on: false, interval: 0.065, acc: 0, earned: false, rate: null };
    this._out = []; this._queued = 0; this._heldAt = null; this._heldEarned = true;
    this.count = { total: 0, counted: 0, running: false, dur: 0, t: 0, done: true };
    this.lastReceipt = null; this.recordsBefore = this.records;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(kind, detail) { for (const fn of this.listeners) fn(kind, detail, this.ctrl.game); }
  cue(name, pitch = 1, db = 0) { return this.audio?.playCue(name, pitch, db); }

  // ---- 物理(皿・釘)から呼ばれる ----
  pegHit(index) { this._pegCombo = (this.clock - (this._lastPeg ?? -9) > 0.45) ? 0 : Math.min((this._pegCombo ?? 0) + 1, 12); this._lastPeg = this.clock; this.audio?.playPeg(Math.pow(2, this._pegCombo / 12)); }
  trayBall({ earned = false, intoBox = false } = {}) { if (intoBox) this.cue('medal_box_pour', 1, -6); else if (earned) this.cue('medal_payout_ball', 0.9 + Math.random() * 0.25); else this.cue('medal_tray_drop'); }
  trayClatter(i) { this.cue('medal_tray_clatter', 1, -12 + 10 * Math.min(1, Math.max(0, i))); }
  /** externalTray 用: 払い出す予定の玉数を受け取って 0 にする(物理が皿へ1球ずつ落とす)。 */
  takePending() {
    if (!this.externalTray) return 0;
    if (this._out.length) { const b = this._out.shift(); this._queued -= b.n; const n = Math.min(b.n, this.pending); this.pending -= n; this.pour.earned = b.earned; this.pour.rate = b.rate; return n; }
    if (!this.pour.on) return 0; const n = Math.max(0, this.pending - this._queued); this.pending = this._queued; this.pour.on = false; this.pour.rate = null; return n;
  }
  /** 演出から: 付与済みで未払いの玉のうち count 玉を、払出口から皿へ rate(玉/秒, 既定=自然な払出, 上限40)で注ぐ。実際に注ぐ数を返す。
   *  玉の数は規則側の持ち玉と常に一致(7セグの表示は皿に着いた分だけ増える)。holdAwards=true のときは、これを呼ぶまで付与済みの玉は払い出されない。 */
  awardToTray(count, { rate = null, earned = true, origin = 'payout' } = {}) {
    const n = Math.min(Math.max(0, count | 0), this.trayStatus().releasable); if (n <= 0) return 0;
    this._out.push({ n, earned, rate: rate > 0 ? Math.min(40, Math.max(2, rate)) : null }); this._queued += n;
    if (this.trayStatus().releasable <= 0) this._heldAt = null;
    this._emit('tray_award', { count: n, rate, origin }); return n;
  }
  /** 残りを全部、既定の速さで払い出す。 */
  releaseAwards(opts = {}) { return this.awardToTray(this.trayStatus().releasable, opts); }
  setAwardHold(on, maxHold = 4) { this.holdAwards = !!on; this.maxHold = Math.max(0.5, maxHold); if (!on) this.releaseAwards(); }
  trayStatus() { return { pending: this.pending, queued: this._queued, releasable: Math.max(0, this.pending - this._queued), hold: this.holdAwards }; }
  setDisplayWallet(n) { this.walletOverride = n; }
  setCounted(n) { this.count.counted = n; }
  countFinished() { this.count.counted = this.count.total; this.count.running = false; this.count.done = true; this.audio?.stopLoop('medal_counter_loop'); this.cue('medal_stamp'); }

  // ---- 毎フレーム ----
  update(dt) {
    const c = this.ctrl, g = c.game; this.clock += dt;
    if (this._game !== g) { this._game = g; this._reset(); this.audio?.stopLoop('medal_counter_loop'); }
    if (this.reveal && this.clock >= this.reveal.at) { const r = this.reveal.r; this.reveal = null; this._reveal(r); }
    const r = g.receipt;
    if (r && r.id !== this._seen) { this._seen = r.id; this.lastReceipt = r; this._receipt(r); }
    if (this._phase !== g.phase) { this._phase = g.phase; this._phaseChange(g.phase); }
    // 状態遷移で出す一回の合図
    if (g.lampCount === 6 && this._prevLamps < 6) { this._cutin('最終勝負', g.rules.hasJackpot ? 'JP抽選' : '+' + g.rules.Awards[6]); this.cue('medal_cutin'); }
    if (g.armed !== this._prevArmed && g.lampCount < 6 && g.phase === MedalPhase.Ready) this.cue(g.armed ? 'medal_arm' : 'medal_disarm');
    this._prevLamps = g.lampCount; this._prevArmed = g.armed;
    this._advanceFx(dt); this._advancePour(dt); this._advanceCount(dt);
    this._audioState();
    if (g.phase === MedalPhase.Result && !this._recordSaved) { this._recordSaved = true; this.recordsSaved = this.onResult?.(g); }
    if (g.phase !== MedalPhase.Result) this._recordSaved = false;
  }

  // ---- レシート ----
  _receipt(r) {
    const g = this.ctrl.game;
    this._emit('receipt', r);
    switch (r.kind) {
      case MedalEvent.Loan: this.pending += r.award; this._startPour(0.065, false); break;
      case MedalEvent.Fresh:
        this._banner('fresh', `${r.after.length}灯`, `次の一球 +${g.rules.Awards[r.after.length]}玉`, 0.9);
        this.cue(`medal_lamp_${Math.min(6, Math.max(1, r.after.length))}`); break;
      case MedalEvent.Protected: this._banner('keep', 'キープ', '最初の4灯まで重複では消えません', 0.9); this.cue('medal_keep'); break;
      case MedalEvent.Reset:
        if (r.before.length > 1) this._roulette(r);
        else this._banner('reset', '消灯', '重複しました', 0.9);
        this.cue('medal_lamp_break', 1, -4); break;
      case MedalEvent.Win: case MedalEvent.Miss:
        if (r.kind === MedalEvent.Win && !(r.chain && !r.chainBanked)) this.pending += r.award;
        this.reveal = { r, at: this.clock + (this.quiet ? 0.05 : 0.22) }; break; // 決着の直前に短い無音
      case MedalEvent.Fault: this._banner('fault', '判定できませんでした', 'この1球は返しました', 2.5); this.cue('medal_miss'); break;
    }
  }
  _reveal(r) {
    const g = this.ctrl.game, tier = tierOf(r.before.length);
    if (r.kind === MedalEvent.Win && r.jackpot >= 0) {
      this._jackpot(r); this.cue('medal_cutin'); return;
    }
    if (r.kind === MedalEvent.Win) {
      this._banner('win', `成功! +${r.award}玉`, `${r.before.length}灯 / ${r.lane}番`, 1.8, tier);
      if (tier > 0) this.cue('medal_silence_hit');
      this.cue(['medal_win_small', 'medal_win_mid', 'medal_win_big', 'medal_win_max'][Math.min(3, tier)]);
      this._startPour(r.award <= 3 ? 0.1 : r.award <= 12 ? 0.06 : r.award <= 30 ? 0.045 : 0.034, true);
    } else {
      const unlit = [1, 2, 3, 4, 5, 6, 7].filter((l) => !r.before.includes(l));
      const near = unlit.some((l) => Math.abs(l - r.lane) === 1);
      this._banner('miss', near ? '惜しい！' : '失敗…', `${r.lane}番は点灯済み / ランプは全消灯`, 1.5);
      this.cue('medal_miss');
    }
  }
  _phaseChange(p) {
    this._emit('phase', { phase: p, reason: this.ctrl.game.endReason });
    if (p === MedalPhase.Result) {
      const g = this.ctrl.game; this.count = { total: g.wallet, counted: 0, running: false, dur: Math.min(3.2, Math.max(0.8, g.wallet * 0.03)), t: 0, done: g.wallet <= 0 };
      this.recordsBefore = this.records;
      if (g.wallet > 0) { this.count.running = !this.externalTray; if (!this.externalTray) { /* 内蔵の数え上げ */ } this.audio?.startLoop('medal_counter_loop', -6); }
      else this.cue('medal_stamp');
    }
    if (p === MedalPhase.Continue) this.cue('medal_stamp', 1, -6);
  }

  // ---- 演出タイムライン ----
  _banner(kind, title, sub, dur, tier = 0) { this.fx.banner = { kind, title, sub, t: 0, dur, tier }; }
  _cutin(title, sub) { this.fx.cutin = { title, sub, t: 0, dur: 1.4 }; }
  _roulette(r) {
    const w = this.ctrl.game.rules.resetWeightsFor(r.before.length);
    const k = 12 + r.resetChoice;
    this.fx.roulette = { items: ['1灯消灯', '2灯消灯', '3灯消灯', '全消灯'].map((label, i) => ({ label, pct: w[i] })), t: 0, dur: 1.1, kEnd: k, k: 0, chosen: r.resetChoice, removed: r.removed, lane: r.lane, before: r.before.length, after: r.after.length };
  }
  _jackpot(r) {
    const a = this.ctrl.game.rules.JackpotAwards;
    this.fx.jackpot = { awards: a, t: 0, dur: JACKPOT_SECONDS, kEnd: a.length * 3 + r.jackpot, k: -1, chosen: r.jackpot, award: r.award, pays: !r.chain, settled: false };
  }
  _advanceFx(dt) {
    const f = this.fx;
    for (const key of ['banner', 'cutin']) if (f[key]) { f[key].t += dt; if (f[key].t >= f[key].dur) f[key] = null; }
    if (f.roulette) {
      const x = f.roulette; x.t += dt; const k = Math.round(x.kEnd * ease(x.t / x.dur));
      if (k !== x.k) { x.k = k; this.cue('medal_roulette_tick'); }
      if (x.t >= x.dur + 0.9) f.roulette = null;
    }
    if (f.jackpot) {
      const x = f.jackpot; x.t += dt; const k = Math.round(x.kEnd * ease(x.t / x.dur));
      if (k !== x.k) { x.k = k; this.cue('medal_roulette_tick', 0.9 + (x.t / x.dur) * 0.5); }
      if (x.t >= x.dur && !x.settled) {
        x.settled = true; this.cue('medal_silence_hit'); this.cue('medal_win_max');
        if (x.pays) this._startPour(x.award > 100 ? 0.025 : 0.034, true);
      }
      if (x.t >= x.dur + 1.6) f.jackpot = null;
    }
  }
  _startPour(interval, earned) {
    if (this.holdAwards && this.externalTray) { this._heldAt ??= this.clock; this._heldEarned = earned; return; }
    this.pour = { on: true, interval, acc: 0, earned, rate: null };
  }
  _advancePour(dt) {
    if (this._heldAt !== null) {   // 演出が呼ばない/間に合わない時の安全弁: 一定時間かResult/Continueで残りを払い出す
      const ph = this.ctrl.game.phase;
      if (this.clock - this._heldAt >= this.maxHold || ph === MedalPhase.Result || ph === MedalPhase.Continue) { this.releaseAwards({ earned: this._heldEarned }); this._heldAt = null; }
    }
    if (this.externalTray || !this.pour.on || this.pending <= 0) { if (this.pending <= 0) this.pour.on = false; return; }
    this.pour.acc += dt;
    while (this.pour.acc >= this.pour.interval && this.pending > 0) {
      this.pour.acc -= this.pour.interval; this.pending--;
      this.trayBall({ earned: this.pour.earned });
    }
  }
  _advanceCount(dt) {
    const c = this.count; if (this.externalTray || !c.running) return;
    c.t += dt; c.counted = Math.min(c.total, Math.round(c.total * Math.min(1, c.t / c.dur)));
    if (c.t >= c.dur) this.countFinished();
  }
  _audioState() {
    if (!this.audio) return;
    const m = this.mode();
    this.audio.setDuck(this.reveal ? 1 : 0);
    if (this.music) {
      const p = this.ctrl.game.phase;
      this.audio.setMusic(p === 'Attract' ? 'Attract' : p === 'Result' ? 'Result' : m === 'challenge' || m === 'final' ? 'Challenge' : m === 'reach' ? 'Reach' : 'Base');
    }
  }

  // ---- 派生状態 ----
  mode() {
    const g = this.ctrl.game;
    if (this.reveal) return this.reveal.r.before.length === 6 ? 'final' : 'challenge';
    if (g.shot?.challenge) return g.shot.lamps.length === 6 ? 'final' : 'challenge';
    if (g.armed && (g.phase === MedalPhase.Ready || g.phase === MedalPhase.Effect)) return g.lampCount === 6 ? 'final' : 'challenge';
    return g.lampCount >= 4 ? 'reach' : 'normal';
  }
  displayWallet() { const g = this.ctrl.game; return this.walletOverride ?? Math.max(0, g.wallet - (this.externalTray ? 0 : this.pending)); }
  displayLamps() { return this.reveal ? this.reveal.r.before : this.ctrl.game.lamps; }
  /** 方式C の LightingFrame へ渡す元データ（係数への変換は描画側）。 */
  lightingInputs() {
    const g = this.ctrl.game, f = this.fx;
    return { mode: this.mode(), lamps: this.displayLamps(), armed: g.armed, phase: g.phase, tier: tierOf(this.displayLamps().length),
      reveal: !!this.reveal, jackpot: f.jackpot ? { t: f.jackpot.t / f.jackpot.dur, index: f.jackpot.chosen, settled: f.jackpot.settled } : null,
      roulette: f.roulette ? { t: f.roulette.t / f.roulette.dur } : null, clock: this.clock };
  }
  /** オーバーレイに渡す不変の描画データ。 */
  view() {
    const c = this.ctrl, g = c.game, rules = g.rules, f = this.fx;
    const lamps = this.displayLamps(), mode = this.mode(), wallet = this.displayWallet();
    // 景品は規則の判定(g.prize)に従う。R3 は JP の合計で決まり、S は 500 を当てた時だけなので A の次は出さない
    const th = rules.PrizeThresholds, score = g.prizeScore ?? (rules.R3Enabled ? g.jackpotEarnings : g.wallet), ti = Math.max(0, rules.PrizeNames.indexOf(g.prize));   // H(PrizeBasis:'wallet')は持ち玉で決まり、Sも持ち玉で届く
    const next = ti + 1 <= (rules.R3Enabled && rules.PrizeBasis !== 'wallet' ? th.length - 2 : th.length - 1) ? { name: rules.PrizeNames[ti + 1], need: th[ti + 1] - score } : null;
    const stake = this.reveal ? rules.Awards[this.reveal.r.before.length] : (g.shot?.challenge ? g.shot.award : g.award);
    return {
      phase: g.phase, mode, secondsLeft: g.secondsLeft, secondsTotal: rules.InitialSeconds + (rules.R3Enabled ? g.extraCreditsUsed : Number(g.addedCredit)) * rules.ExtraSeconds,
      addedCredit: g.addedCredit, extraCreditsUsed: g.extraCreditsUsed, wallet, lamps, lampCount: lamps.length, armed: g.armed,
      chain: g.chainStatus, challengeLive: mode === 'challenge' || mode === 'final',
      stake, stakeLabel: rules.hasJackpot && mode === 'final' ? 'JP' : '+' + stake, awards: rules.Awards, jackpotAwards: rules.JackpotAwards, hasJackpot: rules.hasJackpot,
      chipIndex: lamps.length - 1,
      prize: { name: g.prize, next }, prizeTable: rules.PrizeNames.map((n, i) => ({ name: n, from: th[i] })),
      canFire: (g.overlap ? g.canAim : g.canFire) && !c.confirmFinish, canAdd: g.canAdd, canChallenge: (g.overlap ? g.canArm || !!c.preBuffer : g.canFire) && g.lampCount > 0 && g.lampCount < 6,
      confirmFinish: c.confirmFinish, endReason: g.endReason, offerLeft: g.offerLeft, offerTotal: rules.ContinueSeconds,
      aim: c.aim, banner: f.banner, roulette: f.roulette, jackpot: f.jackpot, cutin: f.cutin,
      result: { prize: g.prize, wallet: g.wallet, counted: this.count.counted, total: this.count.total, done: this.count.done, best: g.bestAward, maxLamps: g.maxLamps,
        won: g.won, purchased: g.purchased, attempts: g.attempts, successes: g.successes },
      records: this.recordsBefore,
    };
  }
}
