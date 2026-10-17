// 持ち玉チャレンジ 規則コア（MedalGameRuntime.cs の JS 移植）。表示・物理・入出力に依存しない。
// 規則の正本: docs/handoff/reference/rules/medal_README.md と medal_game.json。
// RapidFireとReset/JP演出時計停止はユーザー承認のオプション（既定false）。
//
// 移植元と同じ点: 状態遷移・台帳(Wallet == Purchased + Won - Spent)・重複ルーレット・JP抽選。
// 外れ(外れ溝・アウト口)の規則は無い: 口の間の仕切りは山形で、玉は必ず7口のどれかに入る（確定 2026-10-16）。
// 皿の満杯は規則に持たない（物理で溜め、溢れ口へ実際に届いた玉が溢れる）。

export const MedalPhase = Object.freeze({ Attract: 'Attract', Ready: 'Ready', Flight: 'Flight', Effect: 'Effect', Continue: 'Continue', Result: 'Result', Fault: 'Fault' });
export const MedalEvent = Object.freeze({ Loan: 'Loan', Fresh: 'Fresh', Protected: 'Protected', Reset: 'Reset', Win: 'Win', Miss: 'Miss', Fault: 'Fault' });

const sum = (a) => a.reduce((x, y) => x + y, 0);
const sortedEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const isAscending = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

/** medal_game.json のキー(PascalCase)をそのまま受け取る。未指定は C# 既定値。 */
export class MedalRules {
  constructor(o = {}) {
    this.RapidFire = o.RapidFire ?? false;
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
    this.Awards = o.Awards ?? [0, 1, 2, 3, 10, 25, 60];
    this.ResetWeights = o.ResetWeights ?? [80, 15, 4, 1];
    this.ResetWeightsByLamps = o.ResetWeightsByLamps ?? null;
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
      typeof r.RapidFire !== 'boolean' || !Number.isInteger(r.MaxInFlight) || r.MaxInFlight < 1 || r.MaxInFlight > 6 || !Number.isFinite(r.FireInterval) || r.FireInterval < 0 ||
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
      r.JackpotAwards.length !== r.JackpotWeights.length || r.JackpotWeights.some((x) => x < 0) ||
      (r.hasJackpot && (sum(r.JackpotWeights) !== 100 || r.JackpotAwards.some((x) => x < r.Awards[5]))) ||
      r.PrizeThresholds.length !== r.PrizeNames.length || r.PrizeNames.length === 0 || r.PrizeThresholds[0] !== 0 ||
      !sortedEq(r.PrizeThresholds, [...new Set(r.PrizeThresholds)].sort((a, b) => a - b));
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
    this.secondsLeft = 0; this.offerLeft = 0; this.effectLeft = 0;
    this.clockStopBudgetUsed = 0; this.clockStoppedSeconds = 0;
    this.receipt = null; this.shot = null; this.endReason = '';
    this._lamps = new Set(); this._sequence = 0;
    this.shots = []; this._pendingLandings = []; this._now = 0; this._sinceFire = Infinity; this._receiptAt = -1;   // 同時発射(MaxInFlight>1)用
  }
  get lamps() { return [...this._lamps].sort((a, b) => a - b); }
  get lampCount() { return this._lamps.size; }
  get award() { return this.rules.Awards[this.lampCount]; }
  get overlap() { return this.rules.MaxInFlight > 1; }
  /** 狙いのスイープを進めてよいか(同時発射では、間隔待ちや盤上の玉数に関わらず、入力を受ける局面なら進める)。 */
  get canAim() {
    if (!this.overlap) return this.canFire;
    return this._acceptingPhase() && this.wallet > 0 && this.secondsLeft > 0;
  }
  _acceptingPhase() {
    if (this.phase === MedalPhase.Ready) return true;
    // 演出の入力ロックが短い(点灯・保護・低灯の重複)間は次を撃てる。長いロック(勝負・払い出し・4/5灯の重複・JP)は撃てない。
    return this.phase === MedalPhase.Effect && !!this.receipt && this.receipt.duration <= 0.6 &&
      [MedalEvent.Fresh, MedalEvent.Protected, MedalEvent.Reset].includes(this.receipt.kind);
  }
  get canFire() {
    if (this.overlap) {
      if (!this._acceptingPhase() || this.wallet <= 0 || this.secondsLeft <= 0) return false;
      if (this.shots.length >= this.rules.MaxInFlight || this._sinceFire < this.rules.FireInterval) return false;
      if (this.shots.some((x) => x.challenge)) return false;
      if (this.armed || this.lampCount === 6) return this.shots.length === 0;   // 勝負と最終球は盤上が空のときだけ
      return this.lampCount + this.shots.length < 6;
    }
    const normalEffect = this.rules.RapidFire && this.phase === MedalPhase.Effect &&
      [MedalEvent.Fresh, MedalEvent.Protected].includes(this.receipt?.kind);
    return (this.phase === MedalPhase.Ready || normalEffect) && this.wallet > 0 && this.secondsLeft > 0;
  }
  /** 勝負を宣言できるか(同時発射: 盤上が空で、入力を受ける局面)。 */
  get canArm() {
    if (!this.overlap) return this.canFire && this.lampCount > 0 && this.lampCount < 6;
    return this._acceptingPhase() && this.wallet > 0 && this.secondsLeft > 0 && this.shots.length === 0 && this.lampCount > 0 && this.lampCount < 6;
  }
  get canAdd() { return !this.addedCredit && (this.phase === MedalPhase.Ready || this.phase === MedalPhase.Continue); }
  get prize() {
    const t = this.rules.PrizeThresholds; let i = 0;
    for (let k = 0; k < t.length; k++) if (t[k] <= this.wallet) i = k;
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
    this.wallet += this.rules.LoanBalls; this.purchased += this.rules.LoanBalls;
    this.receipt = this._receipt(MedalEvent.Loan, 0, this.rules.LoanBalls, 0, this.lamps, this.lamps, before, loanSeconds(this.rules.LoanBalls));
    this._beginEffect();
  }
  _receipt(kind, lane, award, removed, before, after, walletBefore, duration, cost = 0, resetChoice = -1, jackpot = -1) {
    return { id: ++this._sequence, kind, lane, award, removed, before, after, walletBefore, walletAfter: this.wallet, duration, cost, resetChoice, jackpot };
  }
  addCredit() {
    if (!this.canAdd) return false;
    this.addedCredit = true; this.secondsLeft += this.rules.ExtraSeconds;
    this._loan(); return true;
  }
  toggleChallenge() {
    if (this.overlap) { if (this.armed) { this.armed = false; return true; } if (!this.canArm) return false; this.armed = true; return true; }
    if (!this.canFire || this.lampCount === 0 || this.lampCount === 6) return false;
    this.armed = !this.armed; return true;
  }
  launch() {
    if (!this.canFire) return null;
    this.wallet--; this.spent++; this.cycleSpent++;
    const shot = { id: ++this._sequence, challenge: this.armed || this.lampCount === 6, award: this.award, lamps: this.lamps };
    this.shot = shot;
    if (shot.challenge) { this.attempts++; this.firstProtection = false; }
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
      for (const o of this.shots) if (o !== shot) { this.wallet++; this.spent--; this.cycleSpent--; }   // 盤上のほかの玉も返す
      this.shots = []; this._pendingLandings = [];
      return true;
    }
    let kind, award = 0, removed = 0, cost = 0, resetChoice = -1, jackpot = -1, duration;
    if (shot.challenge) {
      cost = this.cycleSpent; this.cycleSpent = 0;
      const win = !shot.lamps.includes(lane);
      award = win ? shot.award : 0;
      if (win && shot.lamps.length === 6 && this.rules.hasJackpot) {
        jackpot = this._pick(this.rules.JackpotWeights); award = this.rules.JackpotAwards[jackpot];
      }
      this.wallet += award; this.won += award;
      if (win) { this.successes++; this.bestAward = Math.max(this.bestAward, award); }
      kind = win ? MedalEvent.Win : MedalEvent.Miss;
      duration = win ? winSeconds(award) + (jackpot >= 0 ? JACKPOT_SECONDS : 0) : 1.35;
      if (jackpot >= 0 && this.rules.JackpotEffectSeconds != null) duration = this.rules.JackpotEffectSeconds[jackpot];
      this._lamps.clear(); this.armed = false;
    } else if (!this._lamps.has(lane)) {
      this._lamps.add(lane);
      kind = MedalEvent.Fresh; duration = 0.45;
      this.maxLamps = Math.max(this.maxLamps, this.lampCount);
      if (this.lampCount >= 4) this.firstProtection = false;
      if (this.lampCount === 6) this.armed = true;
    } else if (this.firstProtection) { kind = MedalEvent.Protected; duration = 0.45; }
    else {
      kind = MedalEvent.Reset;
      const index = this._pick(this.rules.resetWeightsFor(before.length));
      resetChoice = index;
      removed = Math.min(this.lampCount, index === 3 ? this.lampCount : index + 1);
      this._lamps.delete(lane);
      while (before.length - this.lampCount < removed) {
        const rest = this.lamps; this._lamps.delete(rest[Math.floor(this._rng() * rest.length)]);
      }
      duration = this.rules.ResetEffectSecondsByLamps?.[before.length] ??
        (before.length === 1 ? this.rules.ResetEffectSecondsSingle : this.rules.ResetEffectSeconds);
    }
    this.receipt = this._receipt(kind, lane, award, removed, before, this.lamps, walletBefore, duration, cost, resetChoice, jackpot);
    this.shots = this.shots.filter((x) => x !== shot); this.shot = this.shots[this.shots.length - 1] ?? null;
    this._beginEffect();
    return true;
  }
  _pick(weights) {
    let roll = Math.floor(this._rng() * 100), index = 0;
    while (roll >= weights[index]) roll -= weights[index++];
    return index;
  }
  _beginEffect() { this.phase = MedalPhase.Effect; this.effectLeft = this.receipt.duration; }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds');
    if (this.phase === MedalPhase.Continue) {
      this.offerLeft = Math.max(0, this.offerLeft - seconds);
      if (this.offerLeft <= 0) this.finish();
      return;
    }
    if (this.phase !== MedalPhase.Ready && this.phase !== MedalPhase.Flight && this.phase !== MedalPhase.Effect) return;
    this._sinceFire += seconds;
    if (this.phase === MedalPhase.Effect && this.rules.ClockStartsAfterLoan && this.receipt?.kind === MedalEvent.Loan) {
      const used = Math.min(seconds, this.effectLeft);   // 払い出し中は残り時間を減らさない
      this.effectLeft -= used; seconds -= used;
      if (this.effectLeft <= 0) this.phase = MedalPhase.Ready;
      if (seconds <= 0) return;
    }
    const stopped = this.phase === MedalPhase.Effect &&
      ((this.rules.ClockStopOnReset && this.receipt?.kind === MedalEvent.Reset) ||
       (this.rules.ClockStopOnJackpot && this.receipt?.jackpot >= 0));
    let paused = stopped ? seconds : 0;
    const budgeted = stopped && (!(this.receipt?.jackpot >= 0) || this.rules.ClockStopBudgetIncludesJackpot);
    if (budgeted && this.rules.ClockStopBudget !== null) {
      paused = Math.min(seconds, this.effectLeft, Math.max(0, this.rules.ClockStopBudget - this.clockStopBudgetUsed));
    }
    if (budgeted) this.clockStopBudgetUsed += paused;
    this.clockStoppedSeconds += paused;
    this.secondsLeft = Math.max(0, this.secondsLeft - (seconds - paused));
    if (this.phase === MedalPhase.Flight) return; // 最後の1球は期限・玉切れでも必ず着地まで待つ
    if (this.phase === MedalPhase.Effect) {
      this.effectLeft = Math.max(0, this.effectLeft - seconds);
      if (this.effectLeft > 0) return;
      this.phase = MedalPhase.Ready;
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
    if (this.wallet > 0 && this.secondsLeft > 0) return;
    this.endReason = this.wallet === 0 ? '持ち玉を使いきりました' : '時間になりました';
    if (this.addedCredit) this.finish();
    else { this.phase = MedalPhase.Continue; this.offerLeft = this.rules.ContinueSeconds; }
  }
  finish() {
    if (this.shots.length) return false;
    if (![MedalPhase.Ready, MedalPhase.Continue, MedalPhase.Fault].includes(this.phase) && !this.canFire) return false;
    if (!this.endReason) this.endReason = 'ここで計数';
    this.phase = MedalPhase.Result; this.armed = false;
    return true;
  }
}
