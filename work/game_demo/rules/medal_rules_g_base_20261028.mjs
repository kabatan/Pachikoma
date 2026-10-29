// 持ち玉チャレンジ 規則コア（MedalGameRuntime.cs の JS 移植）。表示・物理・入出力に依存しない。
// 規則の正本: docs/handoff/reference/rules/medal_README.md と medal_game.json。
// RapidFireとReset/JP演出時計停止はユーザー承認のオプション（既定false）。
//
// 移植元と同じ点: 状態遷移・台帳(Wallet == Purchased + Won - Spent)・重複ルーレット・JP抽選。
// 外れ(外れ溝・アウト口)の規則は無い: 口の間の仕切りは山形で、玉は必ず7口のどれかに入る（確定 2026-10-16）。
// 皿の満杯は規則に持たない（物理で溜め、溢れ口へ実際に届いた玉が溢れる）。

export const MedalPhase = Object.freeze({ Attract: 'Attract', Ready: 'Ready', Flight: 'Flight', Effect: 'Effect', ChainChoice: 'ChainChoice', Continue: 'Continue', Result: 'Result', Fault: 'Fault' });
export const MedalEvent = Object.freeze({ Loan: 'Loan', Fresh: 'Fresh', Protected: 'Protected', Reset: 'Reset', Win: 'Win', Miss: 'Miss', ChainStop: 'ChainStop', Fault: 'Fault' });

const sum = (a) => a.reduce((x, y) => x + y, 0);
const sortedEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const isAscending = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

/** medal_game.json のキー(PascalCase)をそのまま受け取る。未指定は C# 既定値。 */
export class MedalRules {
  constructor(o = {}) {
    this.RapidFire = o.RapidFire ?? false;
    this.ResetWhileShooting = o.ResetWhileShooting ?? false;
    this.ResetVisualSecondsByLamps = o.ResetVisualSecondsByLamps ?? null;
    this.R2Enabled = o.R2Enabled ?? false;
    this.R3Enabled = o.R3Enabled ?? false;
    this.ContinuousFire = o.ContinuousFire ?? false;
    this.MaxExtraCredits = o.MaxExtraCredits ?? 4;
    this.JackpotChainLamps = o.JackpotChainLamps ?? [5, 6];
    this.ChallengePrepareSeconds = o.ChallengePrepareSeconds ?? 0;
    this.ChallengeAimSpeed = o.ChallengeAimSpeed ?? 1;
    this.PrepareForcedChallenge = o.PrepareForcedChallenge ?? false;
    this.EndGraceSeconds = o.EndGraceSeconds ?? 1.5;
    this.ExtraLoanBalls = o.ExtraLoanBalls ?? null;
    // 同時発射: MaxInFlight>1 のとき、玉が落ちている間も次を撃てる(既定1=従来の1球ずつ)。FireInterval=発射の最短間隔(秒)。
    // 勝負(と6灯の最終球)は盤上が空のときだけ撃て、その間は他の玉を撃てない。灯の数+盤上の通常球が6を超える発射は受け付けない。
    this.MaxInFlight = o.MaxInFlight ?? 1;
    this.FireInterval = o.FireInterval ?? 0;
    this.ClockStopOnReset = o.ClockStopOnReset === undefined ? false : o.ClockStopOnReset;
    this.ClockStopOnJackpot = o.ClockStopOnJackpot === undefined ? false : o.ClockStopOnJackpot;
    this.ClockStartsAfterLoan = o.ClockStartsAfterLoan === undefined ? false : o.ClockStartsAfterLoan;   // true: 貸玉の払い出し演出(Loan)が終わってから時計を動かす
    // 秒。null/省略は従来の無制限。追加入金でも予算はリセットしない。
    this.ClockStopBudget = o.ClockStopBudget === undefined ? null : o.ClockStopBudget;
    this.ClockStopBudgetIncludesJackpot = o.ClockStopBudgetIncludesJackpot === undefined ? false : o.ClockStopBudgetIncludesJackpot;
    this.ResetEffectSeconds = o.ResetEffectSeconds === undefined ? 1.4 : o.ResetEffectSeconds;
    this.ResetEffectSecondsSingle = o.ResetEffectSecondsSingle === undefined ? 0.5 : o.ResetEffectSecondsSingle;
    // 添字=重複前の灯数。0は未使用（JSONでは0を設定）、1..5を使用する。
    this.ResetEffectSecondsByLamps = o.ResetEffectSecondsByLamps ?? null;
    this.JackpotEffectSeconds = o.JackpotEffectSeconds ?? null;
    this.LoanBalls = o.LoanBalls ?? 10;
    this.InitialSeconds = o.InitialSeconds ?? 100;
    this.ExtraSeconds = o.ExtraSeconds ?? 50;
    this.ContinueSeconds = o.ContinueSeconds ?? 10;
    this.ChainChoiceSeconds = o.ChainChoiceSeconds ?? 12;
    this.ChainContinueMinSeconds = o.ChainContinueMinSeconds ?? 7;   // 残りがこれ未満なら継続を出さず確定へ直行(時計は止めない)
    this.Awards = o.Awards ?? [0, 1, 2, 3, 10, 25, 60];
    this.ResetWeights = o.ResetWeights ?? [80, 15, 4, 1];
    this.ResetWeightsByLamps = o.ResetWeightsByLamps ?? null;
    this.HighLampDuplicateProtectionCount = o.HighLampDuplicateProtectionCount ?? 0;
    this.JackpotAwards = o.JackpotAwards ?? [];
    this.JackpotWeights = o.JackpotWeights ?? [];
    this.PrizeThresholds = o.PrizeThresholds ?? [0, 20, 60, 120];
    this.PrizeNames = o.PrizeNames ?? ['参加賞', '小景品', '中景品', '上位景品'];
    this.validate();
  }
  static fromJson(text) { return new MedalRules(typeof text === 'string' ? JSON.parse(text) : text); }
  resetWeightsFor(lamps) { return this.ResetWeightsByLamps?.[lamps] ?? this.ResetWeights; }
  get hasJackpot() { return this.JackpotAwards.length > 0; }
  validate() {
    const r = this;
    const bad =
      typeof r.RapidFire !== 'boolean' || typeof r.ResetWhileShooting !== 'boolean' ||
      (r.ResetVisualSecondsByLamps !== null && (!Array.isArray(r.ResetVisualSecondsByLamps) || r.ResetVisualSecondsByLamps.length !== 6 ||
        Array.from(r.ResetVisualSecondsByLamps).some(value => !Number.isFinite(value) || value < 0))) ||
      !Number.isInteger(r.MaxInFlight) || r.MaxInFlight < 1 || r.MaxInFlight > 6 || !Number.isFinite(r.FireInterval) || r.FireInterval < 0 ||
      typeof r.R2Enabled !== 'boolean' || typeof r.PrepareForcedChallenge !== 'boolean' ||
      typeof r.R3Enabled !== 'boolean' || typeof r.ContinuousFire !== 'boolean' || (r.ContinuousFire && (!r.R3Enabled || r.MaxInFlight <= 1)) || !Number.isInteger(r.MaxExtraCredits) || r.MaxExtraCredits < 1 || r.MaxExtraCredits > 10 ||
      !Array.isArray(r.JackpotChainLamps) || r.JackpotChainLamps.length < 1 || r.JackpotChainLamps.some(x => !Number.isInteger(x) || x < 1 || x > 6) ||
      !isAscending(r.JackpotChainLamps) || r.JackpotChainLamps.at(-1) !== 6 ||
      !Number.isInteger(r.HighLampDuplicateProtectionCount) || r.HighLampDuplicateProtectionCount < 0 || r.HighLampDuplicateProtectionCount > 5 ||
      !Number.isFinite(r.ChallengePrepareSeconds) || r.ChallengePrepareSeconds < 0 || r.ChallengePrepareSeconds > 5 ||
      !Number.isFinite(r.ChallengeAimSpeed) || r.ChallengeAimSpeed <= 0 || r.ChallengeAimSpeed > 1 ||
      !Number.isFinite(r.ChainChoiceSeconds) || r.ChainChoiceSeconds <= 0 ||
      !Number.isFinite(r.EndGraceSeconds) || r.EndGraceSeconds < 0 || r.EndGraceSeconds > 5 ||
      (r.ExtraLoanBalls !== null && (!Number.isInteger(r.ExtraLoanBalls) || r.ExtraLoanBalls < 5)) ||
      typeof r.ClockStopOnReset !== 'boolean' || typeof r.ClockStopOnJackpot !== 'boolean' || typeof r.ClockStartsAfterLoan !== 'boolean' ||
      typeof r.ClockStopBudgetIncludesJackpot !== 'boolean' ||
      (r.ClockStopBudget !== null && (!Number.isFinite(r.ClockStopBudget) || r.ClockStopBudget < 0)) ||
      [r.ResetEffectSeconds, r.ResetEffectSecondsSingle].some(x => !Number.isFinite(x) || x < 0) ||
      (r.ResetEffectSecondsByLamps != null && (!Array.isArray(r.ResetEffectSecondsByLamps) ||
        r.ResetEffectSecondsByLamps.length !== 6 ||
        Array.from(r.ResetEffectSecondsByLamps).some(x => !Number.isFinite(x) || x < 0))) ||
      (r.JackpotEffectSeconds != null && (!Array.isArray(r.JackpotEffectSeconds) ||
        r.JackpotEffectSeconds.length !== r.JackpotAwards.length ||
        r.JackpotEffectSeconds.some(x => !Number.isFinite(x) || x < 0))) ||
      r.LoanBalls < 5 || r.InitialSeconds <= 0 || r.ExtraSeconds <= 0 || r.ContinueSeconds <= 0 ||
      r.InitialSeconds + r.ExtraSeconds + r.ContinueSeconds > 165 || r.Awards.length !== 7 || r.Awards[0] !== 0 ||
      r.Awards.some((x) => x < 0) || !isAscending(r.Awards) ||
      [1, 2, 3].some((k) => r.Awards[k] > k) || r.ResetWeights.length !== 4 ||
      r.ResetWeights.some((x) => x < 0) || sum(r.ResetWeights) !== 100 ||
      (r.ResetWeightsByLamps != null && (r.ResetWeightsByLamps.length > 7 ||
        r.ResetWeightsByLamps.some((w) => w != null && (w.length !== 4 || w.some((x) => x < 0) || sum(w) !== 100)))) ||
      r.JackpotAwards.length !== r.JackpotWeights.length || r.JackpotWeights.some((x) => !Number.isFinite(x) || x < 0) ||
      (r.hasJackpot && (![100, 1_000_000].includes(sum(r.JackpotWeights)) || r.JackpotAwards.some((x) => x < r.Awards[5]))) ||
      r.PrizeThresholds.length !== r.PrizeNames.length || r.PrizeNames.length === 0 || r.PrizeThresholds[0] !== 0 ||
      !sortedEq(r.PrizeThresholds, [...new Set(r.PrizeThresholds)].sort((a, b) => a - b)) ||
      (r.R3Enabled && (r.PrizeThresholds.length !== 5 || r.PrizeThresholds[1] !== 30 || r.PrizeThresholds[4] !== 500 ||
        !sortedEq(r.PrizeNames, ['参加賞', 'C賞', 'B賞', 'A賞', 'S賞'])));
    if (bad) throw new Error('Invalid medal rules (including low-lamp economy and session duration)');
  }
}

/** 再現できる乱数（試験・リプレイ用）。seed 省略時は Math.random。 */
export function makeRng(seed) {
  if (seed == null) return Math.random;
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const JACKPOT_SECONDS = 2.8;
export const loanSeconds = (balls) => 0.7 + balls * 0.065;
export const winSeconds = (award) => 0.22 + (award <= 3 ? 1.1 : award <= 12 ? 1.9 : award <= 30 ? 2.6 : 3.6);

export class MedalGame {
  constructor(rules = new MedalRules(), seed = undefined) {
    this.rules = rules; rules.validate();
    this._rng = makeRng(seed);
    this.phase = MedalPhase.Attract;
    this.wallet = 0; this.purchased = 0; this.won = 0; this.spent = 0; this.cycleSpent = 0;
    this.maxLamps = 0; this.bestAward = 0; this.attempts = 0; this.successes = 0;
    this.addedCredit = false; this.firstProtection = true; this.armed = false;
    this.extraCreditsUsed = 0;
    this.jackpotEarnings = 0;
    this.jackpotDreamHit = false;
    this.highLampDuplicateProtectionLeft = 0;
    this.jackpotChances = 0; this.jackpotSuccesses = 0;
    this.chainAttempts = 0; this.chainSuccesses = 0; this.chainFailures = 0;
    this.chainBanked = 0; this.chainLost = 0;
    this.jackpotChain = null; this._resumeAfterLoan = null;
    this.secondsLeft = 0; this.offerLeft = 0; this.effectLeft = 0; this.choiceLeft = 0;
    this.clockStopBudgetUsed = 0; this.clockStoppedSeconds = 0;
    this.receipt = null; this.shot = null; this.endReason = '';
    this.challengeIntent = null; this.endPending = false; this.endGraceLeft = 0;
    this._displayClock = 0; this._resetDisplays = [];
    this._lamps = new Set(); this._sequence = 0;
    this.shots = []; this._pendingLandings = []; this._now = 0; this._sinceFire = Infinity; this._receiptAt = -1;   // 同時発射(MaxInFlight>1)用
    this._settlementLeft = 0; this._loanLeft = 0;
  }
  get lamps() { return [...this._lamps].sort((a, b) => a - b); }
  get lampCount() { return this._lamps.size; }
  get award() { return this.rules.Awards[this.lampCount]; }
  get overlap() { return this.rules.MaxInFlight > 1; }
  get resetDisplays() {
    return this._resetDisplays.map(display => ({ ...display, secondsLeft: Math.max(0, display.expiresAt - this._displayClock) }));
  }
  get challengeAimSpeed() {
    return this.rules.R2Enabled && this.armed && (!this.challengeIntent?.forced || this.rules.PrepareForcedChallenge)
      ? this.rules.ChallengeAimSpeed : 1;
  }
  get challengeStatus() {
    if (!this.rules.R2Enabled || !this.challengeIntent) return null;
    return { ...this.challengeIntent, aimSpeed: this.challengeAimSpeed };
  }
  get chainStatus() {
    const chain = this.jackpotChain;
    if (!this.rules.R3Enabled || !chain) return null;
    return { choicePending: chain.choicePending, inChallenge: chain.inChallenge, baseAward: chain.baseAward,
      pendingAward: chain.pendingAward, successes: chain.stage,
      nextLamps: this.rules.JackpotChainLamps[Math.min(chain.stage, this.rules.JackpotChainLamps.length - 1)] };
  }
  get endStatus() {
    if (!this.rules.R2Enabled) return null;
    const pending = this.overlap ? this.shots.length : Number(!!this.shot);
    const payout = this.phase === MedalPhase.Effect && [MedalEvent.Win, MedalEvent.Loan].includes(this.receipt?.kind) &&
      !(this.receipt?.chain && !this.receipt?.chainBanked);
    const state = this.phase === MedalPhase.Result ? 'result' : this.phase === MedalPhase.Continue ? 'continue'
      : this.phase === MedalPhase.ChainChoice ? 'chainChoice'
      : (this.wallet === 0 || this.secondsLeft === 0) && pending ? 'judging'
      : payout ? 'payout' : this.endPending ? 'ending'
      : (this.wallet === 0 || this.secondsLeft === 0) && this.phase === MedalPhase.Effect ? 'settling'
      : this.wallet > 0 && this.wallet <= 3 ? 'lastBalls' : 'playing';
    return { state, balls: this.wallet, pending, possibleSupply: pending > 0 || payout,
      graceLeft: this.endGraceLeft, canContinue: this.rules.R3Enabled ? this.extraCreditsUsed < this.rules.MaxExtraCredits : !this.addedCredit };
  }
  /** 狙いのスイープを進めてよいか(同時発射では、間隔待ちや盤上の玉数に関わらず、入力を受ける局面なら進める)。 */
  get canAim() {
    if (this.rules.R2Enabled && this.endPending) return false;
    if (!this.overlap) return this.canFire;
    return this._acceptingPhase() && this.wallet > 0 && this.secondsLeft > 0;
  }
  _acceptingPhase() {
    if (this.rules.ContinuousFire) return [MedalPhase.Ready, MedalPhase.Flight, MedalPhase.Effect].includes(this.phase);
    if (this.phase === MedalPhase.Ready) return true;
    if ((this.rules.R2Enabled || this.rules.ResetWhileShooting) && this.phase === MedalPhase.Effect && this.receipt?.kind === MedalEvent.Reset) return true;
    // 演出の入力ロックが短い(点灯・保護・低灯の重複)間は次を撃てる。長いロック(勝負・払い出し・4/5灯の重複・JP)は撃てない。
    return this.phase === MedalPhase.Effect && !!this.receipt && this.receipt.duration <= 0.6 &&
      [MedalEvent.Fresh, MedalEvent.Protected, MedalEvent.Reset].includes(this.receipt.kind);
  }
  get canFire() {
    if (this.rules.ContinuousFire) return this._acceptingPhase() && !this.endPending && this.wallet > 0 && this.secondsLeft > 0 &&
      this.shots.length < this.rules.MaxInFlight && this._sinceFire + 1e-9 >= this.rules.FireInterval;
    if (this.rules.R2Enabled && (this.endPending || (this.challengeIntent && this.challengeIntent.stage !== 'ready'))) return false;
    if (this.overlap) {
      if (!this._acceptingPhase() || this.wallet <= 0 || this.secondsLeft <= 0) return false;
      if (this.shots.length >= this.rules.MaxInFlight || this._sinceFire < this.rules.FireInterval) return false;
      if (this.shots.some((x) => x.challenge)) return false;
      if (this.armed || this.lampCount === 6) return this.shots.length === 0;   // 勝負と最終球は盤上が空のときだけ
      return this.lampCount + this.shots.length < 6;
    }
    const normalEffect = this.phase === MedalPhase.Effect &&
      ((this.rules.RapidFire && [MedalEvent.Fresh, MedalEvent.Protected].includes(this.receipt?.kind)) ||
       (this.rules.ResetWhileShooting && this.receipt?.kind === MedalEvent.Reset));
    return (this.phase === MedalPhase.Ready || normalEffect) && this.wallet > 0 && this.secondsLeft > 0;
  }
  /** 勝負を宣言できるか(同時発射: 盤上が空で、入力を受ける局面)。 */
  get canArm() {
    if (this.rules.R3Enabled) return false;
    if (!this.overlap) return this.canFire && this.lampCount > 0 && this.lampCount < 6;
    return this._acceptingPhase() && this.wallet > 0 && this.secondsLeft > 0 && this.shots.length === 0 && this.lampCount > 0 && this.lampCount < 6;
  }
  get canAdd() {
    const phaseOk = this.phase === MedalPhase.Ready || this.phase === MedalPhase.Continue;
    return phaseOk && (this.rules.R3Enabled ? this.extraCreditsUsed < this.rules.MaxExtraCredits : !this.addedCredit);
  }
  get prize() {
    const t = this.rules.PrizeThresholds; let i = 0;
    if (this.rules.R3Enabled && this.jackpotDreamHit) return this.rules.PrizeNames.at(-1);
    const score = this.rules.R3Enabled ? this.jackpotEarnings : this.wallet;
    // R3 has five ranks, but cumulative winnings can reach only A. S requires a secured 500.
    const lastRank = this.rules.R3Enabled ? t.length - 2 : t.length - 1;
    for (let k = 0; k <= lastRank; k++) if (t[k] <= score) i = k;
    return this.rules.PrizeNames[i];
  }

  /** 入金入力(クレジット)の後だけ呼ぶ。タイマーや演出から呼ばない。 */
  start() {
    if (this.phase !== MedalPhase.Attract) return false;
    this.secondsLeft = this.rules.InitialSeconds;
    this._loan(); return true;
  }
  _loan() {
    const before = this.wallet;
    const balls = this.addedCredit ? (this.rules.ExtraLoanBalls ?? this.rules.LoanBalls) : this.rules.LoanBalls;
    this._resumeAfterLoan = this.rules.R3Enabled && this.jackpotChain
      ? (this.jackpotChain.choicePending ? MedalPhase.ChainChoice : MedalPhase.Ready) : null;
    this.endPending = false; this.endGraceLeft = 0;
    this.wallet += balls; this.purchased += balls;
    this.receipt = this._receipt(MedalEvent.Loan, 0, balls, 0, this.lamps, this.lamps, before, loanSeconds(balls));
    this._beginEffect();
  }
  _receipt(kind, lane, award, removed, before, after, walletBefore, duration, cost = 0, resetChoice = -1, jackpot = -1) {
    return { id: ++this._sequence, kind, lane, award, removed, before, after, walletBefore, walletAfter: this.wallet, duration, cost, resetChoice, jackpot };
  }
  addCredit() {
    if (!this.canAdd) return false;
    this.addedCredit = true;
    if (this.rules.R3Enabled) this.extraCreditsUsed++;
    this.secondsLeft += this.rules.ExtraSeconds;
    this._loan(); return true;
  }
  toggleChallenge() {
    if (this.rules.R3Enabled) return false;
    if (this.rules.R2Enabled) {
      if (this.armed || !this._acceptingPhase() || this.endPending || this.wallet <= 0 || this.secondsLeft <= 0 ||
        this.lampCount === 0 || this.lampCount >= 6 || this.shots.some(shot => shot.challenge)) return false;
      this.armed = true;
      this.challengeIntent = { stage: 'draining', forced: false, left: 0 };
      this._prepareChallenge();
      return true;
    }
    if (this.overlap) { if (this.armed) { this.armed = false; return true; } if (!this.canArm) return false; this.armed = true; return true; }
    if (!this.canFire || this.lampCount === 0 || this.lampCount === 6) return false;
    this.armed = !this.armed; return true;
  }
  chooseChain(continueChain) {
    if (!this.rules.R3Enabled || this.phase !== MedalPhase.ChainChoice || !this.jackpotChain?.choicePending) return false;
    const chain = this.jackpotChain;
    if (!continueChain) {
      this.choiceLeft = 0;
      this.jackpotChain = null;
      if (chain.pendingAward > 0) {
        const before = this.lamps, walletBefore = this.wallet;
        this.wallet += chain.pendingAward; this.won += chain.pendingAward; this.chainBanked += chain.pendingAward;
        this.jackpotEarnings += chain.pendingAward;
        if (chain.pendingDreamHit) this.jackpotDreamHit = true;
        this.receipt = this._receipt(MedalEvent.Win, 0, chain.pendingAward, 0, before, before, walletBefore, winSeconds(chain.pendingAward));
        this.receipt.chainBanked = true; this.receipt.chainStage = chain.stage; this.receipt.chainBase = chain.baseAward;
        this._beginEffect();
      } else {
        this.receipt = this._receipt(MedalEvent.ChainStop, 0, 0, 0, this.lamps, this.lamps, this.wallet, 0);
        this.receipt.chainBase = chain.baseAward; this.phase = MedalPhase.Ready;
      }
      return true;
    }
    if (this.secondsLeft <= 0 || this.endPending || this.wallet <= 0) return false;
    const lampCount = this.rules.JackpotChainLamps[Math.min(chain.stage, this.rules.JackpotChainLamps.length - 1)];
    this._lamps = new Set(Array.from({ length: lampCount }, (_, index) => index + 1));
    this.choiceLeft = 0;
    chain.choicePending = false; chain.inChallenge = true;
    this.armed = true; this.phase = MedalPhase.Ready;
    const prepare = this.rules.R2Enabled && this.rules.PrepareForcedChallenge ? this.rules.ChallengePrepareSeconds : 0;
    this.challengeIntent = { stage: prepare > 0 ? 'preparing' : 'ready', forced: true, chain: true, left: prepare };
    return true;
  }
  _bankChainAward() {
    this.choiceLeft = 0;
    const chain = this.jackpotChain;
    this.jackpotChain = null;
    if (!chain?.pendingAward) return 0;
    const before = this.lamps, walletBefore = this.wallet;
    this.wallet += chain.pendingAward; this.won += chain.pendingAward; this.chainBanked += chain.pendingAward;
    this.jackpotEarnings += chain.pendingAward;
    if (chain.pendingDreamHit) this.jackpotDreamHit = true;
    this.receipt = this._receipt(MedalEvent.Win, 0, chain.pendingAward, 0, before, before, walletBefore, winSeconds(chain.pendingAward));
    this.receipt.chainBanked = true; this.receipt.chainStage = chain.stage; this.receipt.chainBase = chain.baseAward;
    return chain.pendingAward;
  }
  launch() {
    if (!this.canFire) return null;
    this.wallet--; this.spent++; this.cycleSpent++;
    // A following ball is ordinary while a challenge is awaiting judgement.
    // The challenge keeps the lamp snapshot taken at its own launch.
    const challenge = (this.armed || this.lampCount === 6) && (!this.rules.ContinuousFire ||
      (!this.shots.some(s=>s.challenge) && !this.jackpotChain?.choicePending));
    const chainShot = challenge && this.rules.R3Enabled && !!this.jackpotChain?.inChallenge;
    const shot = { id: ++this._sequence, challenge, chain: chainShot, award: this.award, lamps: this.lamps };
    this.shot = shot;
    if (shot.challenge) {
      this.attempts++;
      if (chainShot) this.chainAttempts++;
      else if (this.rules.R3Enabled && shot.lamps.length === 6) this.jackpotChances++;
      this.firstProtection = false; this.challengeIntent = null;
    }
    if (this.overlap) { this.shots.push(shot); this._sinceFire = 0; if (shot.challenge) this.phase = MedalPhase.Flight; }
    else this.phase = MedalPhase.Flight;
    return shot;
  }
  /** 物理の着地結果。lane は 1..7(口)。reachedReceiver=false は判定不能(故障: その1球だけ返す)。 */
  resolve(shotId, lane, reachedReceiver = true) {
    if (this.overlap) {
      const shot = this.shots.find((x) => x.id === shotId);
      if (!shot || this._pendingLandings.some((x) => x.shotId === shotId)) return false;
      // 長い入力ロックの演出(勝負結果・払い出し・4/5灯の重複・JP)の間に着いた玉は、演出が終わってから反映する。
      if (this.phase === MedalPhase.Effect && !this._acceptingPhase()) { this._pendingLandings.push({ shotId, lane, reachedReceiver }); return true; }
      return this._land(shot, lane, reachedReceiver);
    }
    if (this.phase !== MedalPhase.Flight || !this.shot || this.shot.id !== shotId) return false;
    return this._land(this.shot, lane, reachedReceiver);
  }
  _land(shot, lane, reachedReceiver) {
    const before = this.lamps; const walletBefore = this.wallet;
    if (!reachedReceiver || lane < 1 || lane > 7) {
      // 物理の着地が無いのは故障であり、捏造した負けではない。
      this.wallet++; this.spent--; this.cycleSpent--;
      this.receipt = this._receipt(MedalEvent.Fault, 0, 0, 0, before, before, walletBefore, 0);
      this.phase = MedalPhase.Fault; this.endReason = '玉の判定を確認してください'; this.shot = null;
      this.challengeIntent = null;
      for (const o of this.shots) if (o !== shot) { this.wallet++; this.spent--; this.cycleSpent--; }   // 盤上のほかの玉も返す
      this.shots = []; this._pendingLandings = [];
      return true;
    }
    let kind, award = 0, removed = 0, cost = 0, resetChoice = -1, jackpot = -1, duration;
    let chainLost = 0, chainStage = -1, chainBase = 0;
    if (shot.challenge) {
      cost = this.cycleSpent; this.cycleSpent = 0;
      const win = !shot.lamps.includes(lane);
      if (shot.chain && this.rules.R3Enabled) {
        const chain = this.jackpotChain;
        chainBase = chain?.baseAward ?? 0;
        if (win && chain) {
          jackpot = this._pick(this.rules.JackpotWeights); award = this.rules.JackpotAwards[jackpot];
          chain.pendingAward += award; chain.pendingDreamHit ||= award === 500; chain.stage++; chain.inChallenge = false; chain.choicePending = true;
          chainStage = chain.stage; this.chainSuccesses++;
        } else {
          chainLost = chain?.pendingAward ?? 0; this.chainLost += chainLost; this.chainFailures++;
          this.jackpotChain = null;
        }
      } else {
        award = win ? shot.award : 0;
        if (win && shot.lamps.length === 6 && this.rules.hasJackpot) {
          jackpot = this._pick(this.rules.JackpotWeights); award = this.rules.JackpotAwards[jackpot];
        }
        this.wallet += award; this.won += award;
        if (this.rules.R3Enabled && win && jackpot >= 0) {
          this.jackpotEarnings += award;
          if (award === 500) this.jackpotDreamHit = true;
          this.jackpotSuccesses++;
          this.jackpotChain = { baseAward: award, pendingAward: 0, pendingDreamHit: false, stage: 0, choicePending: true, inChallenge: false };
        }
      }
      if (win) { this.successes++; this.bestAward = Math.max(this.bestAward, award); }
      kind = win ? MedalEvent.Win : MedalEvent.Miss;
      duration = win ? winSeconds(award) + (jackpot >= 0 ? JACKPOT_SECONDS : 0) : 1.35;
      if (jackpot >= 0 && this.rules.JackpotEffectSeconds != null) duration = this.rules.JackpotEffectSeconds[jackpot];
      const firstJpSeconds = !shot.chain && jackpot >= 0 ? this.rules.FirstJackpotEffectSeconds?.[[1,2,3,4,5,6,7].find(d=>!shot.lamps.includes(d))]?.[jackpot] : null;
      if (firstJpSeconds != null) duration = firstJpSeconds;
      this._lamps.clear(); this.armed = false; this.challengeIntent = null;
      if (this.rules.R3Enabled) { this.firstProtection = true; this.highLampDuplicateProtectionLeft = 0; }
    } else if (this.rules.R3Enabled && this.jackpotChain?.choicePending && !this._lamps.has(lane) && this.lampCount >= 5) {
      // 継続の選択が保留されている間は6灯目を点けない(6灯の勝負・JP導入を始めない)。選択が済んでから集める。
      kind = MedalEvent.Protected; duration = 0.45;
    } else if (!this._lamps.has(lane) && (!this.rules.ContinuousFire || this.lampCount < 6)) {
      this._lamps.add(lane);
      kind = MedalEvent.Fresh; duration = 0.45;
      this.maxLamps = Math.max(this.maxLamps, this.lampCount);
      if (this.lampCount >= 4) {
        this.firstProtection = false;
        this.highLampDuplicateProtectionLeft = this.rules.HighLampDuplicateProtectionCount;
      }
      if (this.lampCount === 6) {
        this.armed = true;
        if (this.rules.R2Enabled && !this.challengeIntent) this.challengeIntent = { stage: 'draining', forced: true, left: 0 };
      }
    } else if (this.firstProtection || (this.rules.ContinuousFire && this.lampCount === 6) || (this.rules.R3Enabled && this.lampCount >= 4 && this.highLampDuplicateProtectionLeft > 0)) {
      kind = MedalEvent.Protected; duration = 0.45;
      if (this.rules.R3Enabled && !this.firstProtection && this.lampCount >= 4 && this.highLampDuplicateProtectionLeft > 0) this.highLampDuplicateProtectionLeft--;
    }
    else {
      kind = MedalEvent.Reset;
      const index = this._pick(this.rules.resetWeightsFor(before.length));
      resetChoice = index;
      removed = Math.min(this.lampCount, index === 3 ? this.lampCount : index + 1);
      this._lamps.delete(lane);
      while (before.length - this.lampCount < removed) {
        const rest = this.lamps; this._lamps.delete(rest[Math.floor(this._rng() * rest.length)]);
      }
      // R3: after a reset, protect duplicate hits until one fresh lane restores the prior progress.
      if (this.rules.R3Enabled) { this.firstProtection = true; this.highLampDuplicateProtectionLeft = 0; }
      duration = this.rules.ResetEffectSecondsByLamps?.[before.length] ??
        (before.length === 1 ? this.rules.ResetEffectSecondsSingle : this.rules.ResetEffectSeconds);
    }
    const resetVisualDuration = kind === MedalEvent.Reset && this.rules.ResetWhileShooting
      ? this.rules.ResetVisualSecondsByLamps?.[before.length] ?? duration : null;
    if (resetVisualDuration !== null) duration = 0;
    this.receipt = this._receipt(kind, lane, award, removed, before, this.lamps, walletBefore, duration, cost, resetChoice, jackpot);
    if (shot.chain) {
      this.receipt.chain = true; this.receipt.chainStage = chainStage; this.receipt.chainBase = chainBase;
      this.receipt.chainPending = this.jackpotChain?.pendingAward ?? 0; this.receipt.chainLost = chainLost;
    }
    if (resetVisualDuration !== null) this._startResetDisplay(this.receipt, resetVisualDuration);
    this.shots = this.shots.filter((x) => x !== shot); this.shot = this.shots[this.shots.length - 1] ?? null;
    this._beginEffect();
    this._prepareChallenge();
    return true;
  }
  _prepareChallenge() {
    const intent = this.challengeIntent;
    if (!this.rules.R2Enabled || !intent || intent.stage !== 'draining' || this.shots.length || !this._acceptingPhase()) return;
    intent.left = !intent.forced || this.rules.PrepareForcedChallenge ? this.rules.ChallengePrepareSeconds : 0;
    intent.stage = intent.left > 0 ? 'preparing' : 'ready';
  }
  _pick(weights) {
    let roll = this._rng() * sum(weights), index = 0;
    while (roll >= weights[index]) roll -= weights[index++];
    return index;
  }
  _beginEffect() {
    this.phase = MedalPhase.Effect; this.effectLeft = this.receipt.duration;
    if (this.rules.ContinuousFire) {
      if ([MedalEvent.Win,MedalEvent.Miss,MedalEvent.Loan].includes(this.receipt.kind)) this._settlementLeft = Math.max(this._settlementLeft,this.receipt.duration);
      if (this.receipt.kind === MedalEvent.Loan) this._loanLeft = this.receipt.duration;
    }
  }
  _startResetDisplay(receipt, duration) {
    const replaced = this._resetDisplays.length === 3 ? this._resetDisplays.shift() : null;
    const used = new Set(this._resetDisplays.map(display => display.slot));
    const slot = replaced?.slot ?? [0, 1, 2].find(candidate => !used.has(candidate));
    receipt.visualDuration = duration; receipt.resetSlot = slot; receipt.resetReplaces = replaced?.receiptId ?? null;
    if (duration > 0) this._resetDisplays.push({ receiptId: receipt.id, slot, startedAt: this._displayClock, expiresAt: this._displayClock + duration });
  }

  get chainTooLate() { return this.rules.R3Enabled && this.secondsLeft < (this.rules.ChainContinueMinSeconds ?? 0); }
  _enterChainChoice() {
    if (this.phase !== MedalPhase.ChainChoice) this.choiceLeft = this.rules.ChainChoiceSeconds;
    this.phase = MedalPhase.ChainChoice;
    // 続ける時間が残っていない: 選択画面を出さず、そのまま確定する。
    if (this.chainTooLate) this.chooseChain(false);
  }
  _advanceChainChoice(seconds) {
    if (this.phase !== MedalPhase.ChainChoice) return false;
    if (this.chainTooLate) return this.chooseChain(false);
    this.choiceLeft = Math.max(0, this.choiceLeft - seconds);
    if (this.choiceLeft > 1e-9) return false;
    return this.chooseChain(false);
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds');
    this._displayClock += seconds;
    this._resetDisplays = this._resetDisplays.filter(display => display.expiresAt > this._displayClock);
    if (this.phase === MedalPhase.Continue) {
      this.offerLeft = Math.max(0, this.offerLeft - seconds);
      if (this.offerLeft <= 0) this.finish();
      return;
    }
    if (this.phase !== MedalPhase.Ready && this.phase !== MedalPhase.Flight && this.phase !== MedalPhase.Effect && this.phase !== MedalPhase.ChainChoice) return;
    if (this.rules.ContinuousFire) {this._advanceContinuous(seconds);return;}
    this._sinceFire += seconds;
    if (this.rules.R2Enabled && this.challengeIntent?.stage === 'preparing') {
      this.challengeIntent.left = Math.max(0, this.challengeIntent.left - seconds);
      if (this.challengeIntent.left <= 1e-9) this.challengeIntent.stage = 'ready';
    }
    if (this.phase === MedalPhase.Effect && this.rules.ClockStartsAfterLoan && this.receipt?.kind === MedalEvent.Loan) {
      const used = Math.min(seconds, this.effectLeft);   // 払い出し中は残り時間を減らさない
      this.effectLeft -= used; seconds -= used;
      if (this.effectLeft <= 0) {
        if (this._resumeAfterLoan === MedalPhase.ChainChoice) this._enterChainChoice();
        else this.phase = this._resumeAfterLoan ?? MedalPhase.Ready;
        this._resumeAfterLoan = null;
      }
      if (seconds <= 0) return;
    }
    const stopped = this.phase === MedalPhase.Effect &&
      ((this.rules.ClockStopOnReset && !this.rules.R2Enabled && !this.rules.ResetWhileShooting && this.receipt?.kind === MedalEvent.Reset) ||
       (this.rules.ClockStopOnJackpot && !this.rules.R3Enabled && this.receipt?.jackpot >= 0));
    let paused = stopped ? seconds : 0;
    const budgeted = stopped && (!(this.receipt?.jackpot >= 0) || this.rules.ClockStopBudgetIncludesJackpot);
    if (budgeted && this.rules.ClockStopBudget !== null) {
      paused = Math.min(seconds, this.effectLeft, Math.max(0, this.rules.ClockStopBudget - this.clockStopBudgetUsed));
    }
    if (budgeted) this.clockStopBudgetUsed += paused;
    this.clockStoppedSeconds += paused;
    this.secondsLeft = Math.max(0, this.secondsLeft - (seconds - paused));
    if (this._advanceChainChoice(seconds)) return;
    this._prepareChallenge();
    if (this.phase === MedalPhase.Flight) return; // 最後の1球は期限・玉切れでも必ず着地まで待つ
    if (this.phase === MedalPhase.Effect) {
      this.effectLeft = Math.max(0, this.effectLeft - seconds);
      if (this.effectLeft > 0) return;
      if (this.rules.R3Enabled && this.jackpotChain?.choicePending) this._enterChainChoice();
      else this.phase = MedalPhase.Ready;
    }
    if (this.overlap) {
      // 待たされていた着地を1つずつ反映する(反映するとまた演出に入る)。盤上に玉がある間は終了判定をしない。
      if (this._pendingLandings.length) {
        const q = this._pendingLandings.shift(), shot = this.shots.find((x) => x.id === q.shotId);
        if (shot) this._land(shot, q.lane, q.reachedReceiver);
        return;
      }
      if (this.shots.length) return;
    }
    if (this.wallet > 0 && this.secondsLeft > 0) { this.endPending = false; this.endGraceLeft = 0; return; }
    if (this.rules.R2Enabled && this.rules.EndGraceSeconds > 0) {
      if (!this.endPending) { this.endPending = true; this.endGraceLeft = this.rules.EndGraceSeconds; return; }
      this.endGraceLeft = Math.max(0, this.endGraceLeft - seconds);
      if (this.endGraceLeft > 1e-9) return;
    }
    this.endReason = this.wallet === 0 ? '持ち玉を使いきりました' : '時間になりました';
    if (this.rules.R3Enabled ? this.extraCreditsUsed >= this.rules.MaxExtraCredits : this.addedCredit) this.finish();
    else { this.phase = MedalPhase.Continue; this.offerLeft = this.rules.ContinueSeconds; }
  }
  _advanceContinuous(seconds) {
    this._sinceFire += seconds;
    const loan = this.rules.ClockStartsAfterLoan ? Math.min(seconds,this._loanLeft) : 0;
    this._loanLeft = Math.max(0,this._loanLeft-seconds);
    this.secondsLeft = Math.max(0,this.secondsLeft-seconds+loan);
    this._settlementLeft = Math.max(0,this._settlementLeft-seconds);
    this.effectLeft = Math.max(this._settlementLeft,Math.max(0,this.effectLeft-seconds));
    if (this.challengeIntent) {this.challengeIntent.stage='ready';this.challengeIntent.left=0;}
    if (this.phase === MedalPhase.ChainChoice) {
      if (this._advanceChainChoice(seconds)) return;
    } else if (this.effectLeft > 1e-9) this.phase = MedalPhase.Effect;
    else if (this.jackpotChain?.choicePending) this._enterChainChoice();
    else this.phase = MedalPhase.Ready;
    if (this.shots.length || this._settlementLeft > 1e-9) return;
    if (this.wallet > 0 && this.secondsLeft > 0) {this.endPending=false;this.endGraceLeft=0;return;}
    if (!this.endPending) {this.endPending=true;this.endGraceLeft=this.rules.EndGraceSeconds;}
    else this.endGraceLeft=Math.max(0,this.endGraceLeft-seconds);
    if (this.endGraceLeft>1e-9)return;
    this.endReason=this.wallet===0?'持ち玉を使いきりました':'時間になりました';
    if(this.extraCreditsUsed>=this.rules.MaxExtraCredits)this.finish();
    else {this.phase=MedalPhase.Continue;this.offerLeft=this.rules.ContinueSeconds;}
  }
  finish() {
    if(this.rules.ContinuousFire&&this._settlementLeft>1e-9)return false;
    if (this.shots.length) return false;
    if (![MedalPhase.Ready, MedalPhase.ChainChoice, MedalPhase.Continue, MedalPhase.Fault].includes(this.phase) && !this.canFire) return false;
    if (!this.endReason) this.endReason = 'ここで計数';
    this._bankChainAward();
    this.phase = MedalPhase.Result; this.armed = false;
    this.challengeIntent = null;
    return true;
  }
}
