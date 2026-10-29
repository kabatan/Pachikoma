// H_20261029（監督決定 10/29）: 「ボタンを押している時間」を増やす規則。G_20261028 を土台に、差分だけを足した新しい変種。
//   1. JPチャンス＝連打メーター（6灯が揃うと、制限時間内に連打。残り1穴に入った球の数がしきい値に届けば成功）
//   2. 連打中の球は無料（持ち玉を減らさない。shot.free=true。物理側は別の補給の球で撃つ）
//   3. ルーレットはボタンで止める（配当は重みで決まる。押す/押さないで確率は変わらない。8秒で自動停止）
//   4. 継続＝連打メーター（当たりの穴は7穴のうち3つ。成功率は連数によらず一定を狙う。失敗なら積み増し分が消える）
//   5. 重複（光った穴への再入）は時間で変える（序盤は消えやすく、終盤は消えにくく）
//   6. 時計は連打中も止めない（既定。ClockStopOnMeter / ClockStopOnRoulette で変えられる）
//   7. （10/29 夜・候補3の統合）穴ごとのJP秒数／しきい値、当たり穴の組ごとの継続しきい値、時計0の継続は100円の追加、重複の6灯目ガセ・JP後の割合補正
//   8. （10/30 監督決定）賞は「終了時の持ち玉（wallet）」で決める（PrizeBasis:'wallet'）。JPで得た玉・500配当の確保（DreamHit）では決めない。
// G は消さず、上書きもしない。物理（球の動き）・盤面・釘には触らない。詳細は work/game_tuning/H_1029/RULES_H.md・BALANCE.md §13。
import {MedalRules as GRules, MedalGame as GGame, MedalPhase, MedalEvent} from './medal_rules_g_20261028.mjs';
export {makeRng, MedalPhase, MedalEvent, loanSeconds, winSeconds, JACKPOT_SECONDS} from './medal_rules_g_20261028.mjs';

export const HPhase = Object.freeze({ Meter: 'Meter', Roulette: 'Roulette' });
const sum = (a) => a.reduce((x, y) => x + y, 0);
const isNum = (x) => Number.isFinite(x);
const LANES = [1, 2, 3, 4, 5, 6, 7];

export class MedalRules extends GRules {
  constructor(o = {}) {
    super(o);
    this._hReady = false;
    // --- 連打メーター（JPチャンス） ---
    this.JpMeterThreshold = o.JpMeterThreshold ?? 3;          // 残り1穴に入った球がこの数に届いたら成功
    this.JpMeterSeconds = o.JpMeterSeconds ?? 9;              // 撃てる時間（導入の後、タイマーが動く間）
    this.JpMeterIntroSeconds = o.JpMeterIntroSeconds ?? 2;    // 6灯が揃ってから撃てるまでの導入（時計は進む。この間の押しは1回だけ保持）
    // --- 連打メーター（継続）。連数（0始まり）ごとの設定。足りない連数は最後の要素を使う ---
    this.ChainHitCount = o.ChainHitCount ?? 3;                // 当たりの穴の数（7穴のうち）。4も可
    this.ChainHitLaneMode = o.ChainHitLaneMode ?? 'random';   // 'random': 毎回乱数で選ぶ / 'order': JackpotChainLaneOrder の先頭から固定
    this.ChainIntroSeconds = o.ChainIntroSeconds ?? 1.2;
    this.ChainDisplayProbability = o.ChainDisplayProbability ?? '2/3';   // 選択画面に出す確率の表示（文字列）
    this.ChainMeterByStage = o.ChainMeterByStage ?? [{ Threshold: 5, Seconds: 9 }];   // 要素: { Threshold, Seconds, HitCount?, IntroSeconds?, Display? }
    // 候補3: 残り1穴ごとのJP（秒・しきい値）と、当たり穴の組ごとの継続しきい値。null なら単一値（JpMeterSeconds/JpMeterThreshold、ChainMeterByStage の Threshold）
    this.JpMeterByLane = o.JpMeterByLane ?? null;                 // { "1": { Seconds, Threshold }, ... "7": ... }
    this.ChainThresholdByHitSet = o.ChainThresholdByHitSet ?? null;   // { "123": 5, ... }（当たり穴を昇順に並べた数字）。無い組は ChainMeterByStage の Threshold
    // --- 連打中の発射（無料の球） ---
    this.MeterMaxInFlight = o.MeterMaxInFlight ?? 3;          // 連打中に同時に飛ぶ球の数
    this.MeterFireInterval = o.MeterFireInterval ?? 0.6;      // 連打中の発射間隔（秒）
    this.MeterAimSpeed = o.MeterAimSpeed ?? 1;                // 連打中の狙いのスイープ速度（1=通常、0.5=半分）
    this.MeterSettleSeconds = o.MeterSettleSeconds ?? 3;      // 時間切れの後、飛んでいる球の着地を待つ上限（待つ間も成功は有効）
    // --- 時計 ---
    this.ClockStopOnMeter = o.ClockStopOnMeter ?? false;      // 確定(10/29監督): 連打中も時計は止めない
    this.ClockStopOnRoulette = o.ClockStopOnRoulette ?? false;
    // --- ルーレット ---
    this.RouletteStartDelaySeconds = o.RouletteStartDelaySeconds ?? 0;  // 成功の瞬間から回転が始まる（押しを受ける／自動停止の時計が動く）までの待ち。液晶の「満タン→大当りのつなぎ」を見せる間（既定 0＝従来どおり）
    this.RouletteAutoStopSeconds = o.RouletteAutoStopSeconds ?? 8;      // 押されなければ自動で止める（仮 8 秒）
    this.RouletteStopAcceptAfter = o.RouletteStopAcceptAfter ?? 1.5;    // 回り始めてからこの秒数までの押しは無視（連打の押し残しで即止まるのを防ぐ）
    this.RouletteSlideSeconds = o.RouletteSlideSeconds ?? 1.2;          // 押されてから止まるまで（滑って止まる段階）
    this.RouletteResultSeconds = o.RouletteResultSeconds ?? [3.5, 3.8, 4.5, 5.5, 7];   // 止まった後の配当演出の長さ（配当の段ごと）
    // --- 重複（時間別） ---
    this.DuplicateBasis = o.DuplicateBasis ?? 'fraction';        // 'fraction': 経過の割合(0..1) / 'remaining': 残り秒
    this.DuplicateExtension = o.DuplicateExtension ?? 'natural'; // 延長(追加)時の扱い 'natural' | 'latch' | 'restart'
    this.DuplicateSegments = o.DuplicateSegments ?? [
      { Until: 0.45, ResetWeights: [50, 30, 15, 5], HighLampDuplicateProtectionCount: 0 },   // 序盤: 消えやすい
      { Until: 0.75, ResetWeights: [85, 12, 3, 0], HighLampDuplicateProtectionCount: 1 },
      { Until: null, ResetWeights: [100, 0, 0, 0], HighLampDuplicateProtectionCount: 3 },    // 終盤: 消えにくい
    ];
    // --- 重複の追加（候補3） ---
    this.DuplicateSixthLampClearUntil = o.DuplicateSixthLampClearUntil ?? 0;   // 経過割合（JP後は補正後）がこれ未満の間、5灯から6灯目の穴に入ったら6灯目を点けず全消灯（ガセ）。0で無効
    this.DuplicateRestartScaleAfterJp = o.DuplicateRestartScaleAfterJp ?? 1;   // JPチャンスが一度あった後は、重複区間とガセの判定に使う経過割合をこの倍にする（1で無効）
    // --- 6灯目の「点かない」（10/30 監督指摘で全消灯のガセの代わりに追加）。全消灯せず、灯は何も減らない。 ---
    this.DuplicateSixthLampTeaseUntil = o.DuplicateSixthLampTeaseUntil ?? 0;        // 経過割合（JP後は補正後）がこの値に届くと確率0。0で無効
    this.DuplicateSixthLampTeasePlateau = o.DuplicateSixthLampTeasePlateau ?? 0;    // この割合までは確率1、そこから Until まで直線で下がる
    this.DuplicateSixthLampTeaseMax = o.DuplicateSixthLampTeaseMax ?? null;         // 1プレイあたりの最大回数（null=無制限）
    // --- 時計0の継続（候補3） ---
    this.ChainContinueNeedsAddAtZero = o.ChainContinueNeedsAddAtZero ?? false; // true: 配当後に残り0以下なら、継続の選択は「100円追加で継続」のみ。追加で時間・玉が入り、そのまま継続の連打へ。払わなければ確定
    // --- 賞の判定（10/30）。'wallet': 終了（精算）の瞬間の持ち玉 wallet だけで決める。'earnings': 従来（JPで得た玉 jackpotEarnings、500配当の確保でS）
    this.PrizeBasis = o.PrizeBasis ?? 'earnings';
    // --- JP後の継続の告知（10/30）。ChainAnnounceSeconds>0: 継続の選択に入る前に告知を出す（その間は選択も確定も受けず、時計は止めない。選択の制限時間は告知のあとから）
    //     ChainFirstAuto: その試合で最初の継続判断（JP直後）は選択を出さず、告知のあと自動で継続する。2回目以降は告知のあと選択画面
    this.ChainAnnounceSeconds = o.ChainAnnounceSeconds ?? 0;
    this.ChainFirstAuto = o.ChainFirstAuto ?? false;
    this.RuleVariant = 'H_20261029';
    this._hReady = true;
    this.validate();
  }
  static fromJson(text) { return new MedalRules(typeof text === 'string' ? JSON.parse(text) : text); }
  chainMeterFor(stage) {
    const list = this.ChainMeterByStage, e = list[Math.min(stage, list.length - 1)];
    return { Threshold: e.Threshold, Seconds: e.Seconds, HitCount: e.HitCount ?? this.ChainHitCount,
      IntroSeconds: e.IntroSeconds ?? this.ChainIntroSeconds, Display: e.Display ?? this.ChainDisplayProbability };
  }
  /** 残り1穴 lane のJPチャンス（秒・しきい値）。表が無ければ単一値 */
  jpMeterFor(lane) {
    const e = this.JpMeterByLane?.[lane];
    return { Threshold: e?.Threshold ?? this.JpMeterThreshold, Seconds: e?.Seconds ?? this.JpMeterSeconds };
  }
  /** 当たり穴の組 hits に対する継続しきい値（組の表が優先、無ければ連数ごとの設定の値） */
  chainThresholdFor(hits, fallback) {
    const k = [...hits].sort((a, b) => a - b).join('');
    return this.ChainThresholdByHitSet?.[k] ?? fallback;
  }
  validate() {
    // G の検証は S賞の閾値=500 を求める。持ち玉で決める H では S の閾値を変えられるよう、G の検証の間だけ G の既定値に差し替える。
    const t = this.PrizeThresholds;
    const tOk = Array.isArray(t) && t.length === 5 && t[0] === 0 && t.every((v, i) => Number.isFinite(v) && v >= 0 && (i === 0 || v > t[i - 1]));
    if (tOk && t[4] !== 500) {
      this.PrizeThresholds = [0, 30, 200, 320, 500];
      try { super.validate(); } finally { this.PrizeThresholds = t; }
    } else super.validate();
    if (!this._hReady) return;
    if (!['earnings', 'wallet'].includes(this.PrizeBasis)) throw new Error('Invalid H PrizeBasis');
    if (this.PrizeBasis === 'earnings' && this.PrizeThresholds[4] !== 500) throw new Error('H PrizeBasis=earnings requires S threshold 500');   // 基底クラスの構築中に呼ばれる分は、H の項目がまだ無い
    const r = this;
    const posInt = (x) => Number.isInteger(x) && x >= 1;
    const w4 = (w) => Array.isArray(w) && w.length === 4 && w.every((x) => isNum(x) && x >= 0) && sum(w) === 100;
    const segs = r.DuplicateSegments;
    const segOk = Array.isArray(segs) && segs.length >= 1 && segs.every((s, i) => {
      const last = i === segs.length - 1;
      if (last ? s.Until != null : !isNum(s.Until)) return false;
      if (i > 0 && !last && (r.DuplicateBasis === 'fraction' ? s.Until <= segs[i - 1].Until : s.Until >= segs[i - 1].Until)) return false;
      if (r.DuplicateBasis === 'fraction' && !last && (s.Until <= 0 || s.Until >= 1)) return false;
      if (r.DuplicateBasis === 'remaining' && !last && s.Until < 0) return false;
      if (s.ResetWeights !== undefined && !w4(s.ResetWeights)) return false;
      if (s.ResetWeightsByLamps !== undefined && s.ResetWeightsByLamps !== null && (!Array.isArray(s.ResetWeightsByLamps) || s.ResetWeightsByLamps.length > 7 || s.ResetWeightsByLamps.some((w) => w != null && !w4(w)))) return false;
      if (s.HighLampDuplicateProtectionCount !== undefined && !(Number.isInteger(s.HighLampDuplicateProtectionCount) && s.HighLampDuplicateProtectionCount >= 0 && s.HighLampDuplicateProtectionCount <= 5)) return false;
      return true;
    });
    const stageOk = (e) => e && posInt(e.Threshold) && isNum(e.Seconds) && e.Seconds > 0 &&
      (e.HitCount === undefined || (posInt(e.HitCount) && e.HitCount <= 6)) &&
      (e.IntroSeconds === undefined || (isNum(e.IntroSeconds) && e.IntroSeconds >= 0));
    const laneOk = (t) => t === null || (typeof t === 'object' && !Array.isArray(t) && LANES.every((d) => t[d] && posInt(t[d].Threshold) && isNum(t[d].Seconds) && t[d].Seconds > 0) && Object.keys(t).length === 7);
    const setOk = (t) => t === null || (typeof t === 'object' && !Array.isArray(t) && Object.entries(t).every(([k, v]) => /^[1-7]{1,6}$/.test(k) && [...k].every((c, i, a) => i === 0 || c > a[i - 1]) && posInt(v)));
    const bad =
      !laneOk(r.JpMeterByLane) || !setOk(r.ChainThresholdByHitSet) ||
      !isNum(r.DuplicateSixthLampClearUntil) || r.DuplicateSixthLampClearUntil < 0 || r.DuplicateSixthLampClearUntil > 1 ||
      !isNum(r.DuplicateSixthLampTeaseUntil) || r.DuplicateSixthLampTeaseUntil < 0 || r.DuplicateSixthLampTeaseUntil > 1 ||
      !isNum(r.DuplicateSixthLampTeasePlateau) || r.DuplicateSixthLampTeasePlateau < 0 || r.DuplicateSixthLampTeasePlateau > r.DuplicateSixthLampTeaseUntil ||
      !(r.DuplicateSixthLampTeaseMax === null || (Number.isInteger(r.DuplicateSixthLampTeaseMax) && r.DuplicateSixthLampTeaseMax >= 0)) ||
      !isNum(r.DuplicateRestartScaleAfterJp) || r.DuplicateRestartScaleAfterJp <= 0 || r.DuplicateRestartScaleAfterJp > 1 ||
      typeof r.ChainContinueNeedsAddAtZero !== 'boolean' || typeof r.ChainFirstAuto !== 'boolean' || !isNum(r.ChainAnnounceSeconds) || r.ChainAnnounceSeconds < 0 || r.ChainAnnounceSeconds > 10 ||
      !posInt(r.JpMeterThreshold) || !isNum(r.JpMeterSeconds) || r.JpMeterSeconds <= 0 || !isNum(r.JpMeterIntroSeconds) || r.JpMeterIntroSeconds < 0 ||
      !posInt(r.ChainHitCount) || r.ChainHitCount > 6 || !['random', 'order'].includes(r.ChainHitLaneMode) ||
      !isNum(r.ChainIntroSeconds) || r.ChainIntroSeconds < 0 || typeof r.ChainDisplayProbability !== 'string' ||
      !Array.isArray(r.ChainMeterByStage) || r.ChainMeterByStage.length < 1 || !r.ChainMeterByStage.every(stageOk) ||
      (r.ChainHitLaneMode === 'order' && !Array.isArray(r.JackpotChainLaneOrder)) ||
      !Number.isInteger(r.MeterMaxInFlight) || r.MeterMaxInFlight < 1 || r.MeterMaxInFlight > 8 ||
      !isNum(r.MeterFireInterval) || r.MeterFireInterval < 0 || !isNum(r.MeterAimSpeed) || r.MeterAimSpeed <= 0 || r.MeterAimSpeed > 1 ||
      !isNum(r.MeterSettleSeconds) || r.MeterSettleSeconds < 0 ||
      typeof r.ClockStopOnMeter !== 'boolean' || typeof r.ClockStopOnRoulette !== 'boolean' ||
      !isNum(r.RouletteStartDelaySeconds) || r.RouletteStartDelaySeconds < 0 ||
      !isNum(r.RouletteAutoStopSeconds) || r.RouletteAutoStopSeconds <= 0 ||
      !isNum(r.RouletteStopAcceptAfter) || r.RouletteStopAcceptAfter < 0 || r.RouletteStopAcceptAfter >= r.RouletteAutoStopSeconds ||
      !isNum(r.RouletteSlideSeconds) || r.RouletteSlideSeconds < 0 ||
      !Array.isArray(r.RouletteResultSeconds) || r.RouletteResultSeconds.length !== r.JackpotAwards.length || r.RouletteResultSeconds.some((x) => !isNum(x) || x < 0) ||
      !r.hasJackpot ||
      !['fraction', 'remaining'].includes(r.DuplicateBasis) || !['natural', 'latch', 'restart'].includes(r.DuplicateExtension) || !segOk;
    if (bad) throw new Error('Invalid H meter/roulette/duplicate rules');
  }
}

export class MedalGame extends GGame {
  constructor(rules, seed) {
    super(rules, seed);
    this.meter = null; this.roulette = null;
    this._events = []; this._eventListeners = new Set();
    this._dupUsed = 0; this.teases = 0; this._dupIdx = 0; this._extensions = 0; this._epoch = { start: 0, length: rules.InitialSeconds };
    this.meterSuccesses = 0; this.meterFailures = 0; this.freeShots = 0; this.meterHits = 0;
  }

  // ---------- イベント ----------
  /** type: meterReady / meterStart / meterFire / meterLand / meterEnd / rouletteStart / rouletteStopPress / rouletteStopped */
  _emit(type, data = {}) {
    const ev = { type, t: this._displayClock, secondsLeft: this.secondsLeft, ...data };
    this._events.push(ev); if (this._events.length > 256) this._events.shift();
    for (const fn of this._eventListeners) { try { fn(ev, this); } catch { /* 購読側の例外で規則を止めない */ } }
  }
  onEvent(fn) { this._eventListeners.add(fn); return () => this._eventListeners.delete(fn); }
  takeEvents() { const e = this._events; this._events = []; return e; }

  // ---------- 液晶・照明が読む状態 ----------
  get meterStatus() {
    const m = this.meter; if (!m) return null;
    return { kind: m.kind, stage: m.stage, targets: [...m.targets], threshold: m.threshold, count: m.count, seconds: m.seconds,
      timeLeft: m.timeLeft, introLeft: m.introLeft, settleLeft: m.settleLeft, fired: m.fired, landed: m.landed, lastLane: m.lastLane,
      inFlight: this._meterInFlight(), chainStage: m.chainStage, free: true };
  }
  get rouletteStatus() {
    const r = this.roulette; if (!r) return null;
    return { kind: r.kind, stage: r.stage, age: r.age, autoLeft: r.autoLeft, slideLeft: r.slideLeft, canStop: r.stage === 'spinning' && r.age + 1e-9 >= this.rules.RouletteStopAcceptAfter,
      stopAcceptAfter: this.rules.RouletteStopAcceptAfter, autoStopSeconds: this.rules.RouletteAutoStopSeconds, slideSeconds: this.rules.RouletteSlideSeconds,
      startDelay: this.rules.RouletteStartDelaySeconds, introLeft: Math.max(0, -r.age), pressedBy: r.pressedBy, tier: r.tier, award: r.award, chainStage: r.chainStage };   // tier/award は決定済み。止まるまで客に見せない
  }
  get chainStatus() {
    const base = super.chainStatus; if (!base) return null;
    const cfg = this.rules.chainMeterFor(this.jackpotChain.stage);
    return { ...base, nextLamps: 7 - cfg.HitCount, hitCount: cfg.HitCount, nextThreshold: cfg.Threshold, nextSeconds: cfg.Seconds,
      displayProbability: cfg.Display, meter: this.meterStatus && this.meter.kind === 'chain' ? this.meterStatus : null, needsAdd: this.chainNeedsAdd, addPending: this.phase === 'StaffWait' && !!this._autoChain };
  }
  /** 継続の選択が出ているが、時計が0以下で、続けるには100円の追加が要る（液晶は「追加で継続」を出す） */
  get chainNeedsAdd() {
    return !!this.rules.ChainContinueNeedsAddAtZero && this.phase === MedalPhase.ChainChoice && !!this.jackpotChain?.choicePending && this.secondsLeft <= 0;
  }
  get endStatus() {
    const s = super.endStatus; if (!s) return s;
    if (this.meter || this.phase === HPhase.Roulette) return { ...s, state: 'playing', possibleSupply: true, meterActive: !!this.meter, rouletteActive: !!this.roulette };
    return s;
  }
  get challengeAimSpeed() { return this.meter ? this.rules.MeterAimSpeed : 1; }

  // ---------- 発射 ----------
  _meterInFlight() { return this.shots.filter((s) => s.free && this.meter && s.meterId === this.meter.id).length; }
  get canFire() {
    const m = this.meter;
    if (m) return m.stage === 'firing' && this._meterInFlight() < this.rules.MeterMaxInFlight && this._sinceFire + 1e-9 >= this.rules.MeterFireInterval;
    if (this.phase === HPhase.Roulette) return false;
    return super.canFire;
  }
  get canAim() {
    const m = this.meter;
    if (m) return m.stage === 'intro' || m.stage === 'firing';   // 導入中の押しも1回保持できる
    if (this.phase === HPhase.Roulette) return false;
    return super.canAim;
  }
  launch() {
    const m = this.meter;
    if (!m) return super.launch();
    if (!this.canFire) return null;
    // 無料の球: wallet / spent / cycleSpent に触れない。challenge ではない（勝負球の概念は廃止）。
    const shot = { id: ++this._sequence, challenge: false, chain: false, free: true, meterId: m.id, meterKind: m.kind, award: 0, lamps: this.lamps };
    m.fired++; this.freeShots++;
    this.shots.push(shot); this.shot = shot; this._sinceFire = 0;
    this._emit('meterFire', { shotId: shot.id, kind: m.kind, fired: m.fired, inFlight: this._meterInFlight() });
    return shot;
  }
  _recallOrdinary(keep = null) {   // 無料の球は取り消さない（返す持ち玉が無い）
    const free = this.shots.filter((s) => s.free);
    this.shots = this.shots.filter((s) => !s.free);
    const n = super._recallOrdinary(keep);
    this.shots.push(...free); this.shot = this.shots[this.shots.length - 1] ?? null;
    return n;
  }
  resolve(shotId, lane, reachedReceiver = true) {
    const shot = this.shots.find((x) => x.id === shotId);
    if (shot?.free) return this._landFree(shot, lane, reachedReceiver);
    return super.resolve(shotId, lane, reachedReceiver);
  }
  _landFree(shot, lane, reached) {
    this.shots = this.shots.filter((x) => x !== shot); this.shot = this.shots[this.shots.length - 1] ?? null;
    const m = this.meter;
    // 故障（着地なし）や、メーターが終わった後に着いた球: 無料なので返金も記録も要らない。
    if (!reached || lane < 1 || lane > 7 || !m || shot.meterId !== m.id) return true;
    m.landed++; m.lastLane = lane;
    const hit = m.targets.includes(lane);
    if (hit) { m.count++; this.meterHits++; }
    this._emit('meterLand', { shotId: shot.id, lane, hit, count: m.count, threshold: m.threshold, kind: m.kind });
    if (m.count >= m.threshold) this._endMeter(true);
    else if (m.stage === 'settling' && this._meterInFlight() === 0) this._endMeter(false);
    return true;
  }

  // ---------- 重複（時間別） ----------
  _elapsed() { return Math.max(0, this.rules.InitialSeconds + this._extensions * this.rules.ExtraSeconds - this.secondsLeft); }
  /** いま有効な重複の区間 { index, ...設定 } */
  /** 重複の区間・ガセの判定に使う経過割合（0..1）。JPチャンスが一度あった後は DuplicateRestartScaleAfterJp 倍（序盤並みに戻す） */
  _dupFraction() {
    const r = this.rules, total = r.InitialSeconds + this._extensions * r.ExtraSeconds;
    const p = r.DuplicateExtension === 'restart' ? (this._elapsed() - this._epoch.start) / Math.max(1e-9, this._epoch.length) : this._elapsed() / total;
    return Math.min(1, p) * (this.jackpotChances > 0 ? r.DuplicateRestartScaleAfterJp : 1);
  }
  duplicateSegment() {
    const r = this.rules, segs = r.DuplicateSegments;
    let idx = 0;
    if (r.DuplicateBasis === 'remaining') {
      idx = segs.findIndex((s, i) => s.Until == null || this.secondsLeft > s.Until);
    } else {
      const p = this._dupFraction();
      idx = segs.findIndex((s) => s.Until == null || p < s.Until);
    }
    if (idx < 0) idx = segs.length - 1;
    if (r.DuplicateExtension === 'latch') idx = this._dupIdx = Math.max(this._dupIdx, idx);
    return { index: idx, ...segs[idx] };
  }
  activateExtra(requestId = this.extraRequestId) {
    const elapsedBefore = this._elapsed();
    const ok = super.activateExtra(requestId);
    if (ok) { this._extensions++; this._epoch = { start: elapsedBefore, length: Math.max(1e-9, this.secondsLeft) }; }
    return ok;
  }

  // ---------- 着地（通常球） ----------
  _land(shot, lane, reached) {
    if (shot.free) return this._landFree(shot, lane, reached);
    const r = this.rules;
    if (!reached || lane < 1 || lane > 7) {   // 故障: 無料の球は返金の対象にしない
      const free = this.shots.filter((s) => s.free);
      this.shots = this.shots.filter((s) => !s.free);
      try { return super._land(shot, lane, reached); } finally { this.shots.push(...free); }
    }
    // 序盤のガセ: 5灯から6灯目の穴に入ったら、6灯目を点けず全消灯（継続の選択が保留の間は6灯目を点けない決まりが先）
    if (r.DuplicateSixthLampClearUntil > 0 && this.lampCount === 5 && !this._lamps.has(lane) && !this.jackpotChain?.choicePending && this._dupFraction() < r.DuplicateSixthLampClearUntil)
      return this._fakeSixth(shot, lane);
    // 序盤の「点かない」: 5灯から6灯目の穴に入っても6灯目を点けない（灯は減らさない）。確率は plateau まで1、Until まで直線で0へ。
    if (r.DuplicateSixthLampTeaseUntil > 0 && this.lampCount === 5 && !this._lamps.has(lane) && !this.jackpotChain?.choicePending &&
        (r.DuplicateSixthLampTeaseMax === null || (this.teases ?? 0) < r.DuplicateSixthLampTeaseMax)) {
      const p = this._dupFraction(), a = r.DuplicateSixthLampTeasePlateau, b = r.DuplicateSixthLampTeaseUntil;
      const prob = p < a ? 1 : p >= b ? 0 : 1 - (p - a) / (b - a);
      if (prob >= 1 || (prob > 0 && this._rng() < prob)) return this._teaseSixth(shot, lane);
    }
    const seg = this.duplicateSegment();
    const keep = { w: r.ResetWeights, wl: r.ResetWeightsByLamps, p: r.HighLampDuplicateProtectionCount };
    if (seg.ResetWeights !== undefined) r.ResetWeights = seg.ResetWeights;
    if (seg.ResetWeightsByLamps !== undefined) r.ResetWeightsByLamps = seg.ResetWeightsByLamps;
    else if (seg.ResetWeights !== undefined) r.ResetWeightsByLamps = null;   // 区間が ResetWeights を持つなら、灯数別の全体設定は引き継がない
    if (seg.HighLampDuplicateProtectionCount !== undefined) r.HighLampDuplicateProtectionCount = seg.HighLampDuplicateProtectionCount;
    // 保護は「最後に新しい穴が点いてから使った回数」を数え、いまの区間の回数との差を残りにする（区間が変わっても追従）
    this.highLampDuplicateProtectionLeft = Math.max(0, r.HighLampDuplicateProtectionCount - this._dupUsed);
    const leftBefore = this.highLampDuplicateProtectionLeft;
    let ok;
    try { ok = super._land(shot, lane, reached); } finally { r.ResetWeights = keep.w; r.ResetWeightsByLamps = keep.wl; r.HighLampDuplicateProtectionCount = keep.p; }
    const kind = this.receipt?.kind;
    if (kind === MedalEvent.Protected && this.highLampDuplicateProtectionLeft < leftBefore) this._dupUsed++;
    else if (kind === MedalEvent.Fresh || kind === MedalEvent.Reset) this._dupUsed = 0;
    if (this.receipt) this.receipt.duplicateSegment = seg.index;
    if (kind === MedalEvent.Fresh && this.lampCount === 6) {
      this.armed = false; this.challengeIntent = null;   // 勝負球は無い。連打メーターに入る
      if (this.secondsLeft > 0) this._startJpMeter();
    }
    return ok;
  }

  /** 点かない: 6灯目が点かず、灯は何も減らない（種別は Protected。receipt.tease=true）。 */
  _teaseSixth(shot, lane) {
    const walletBefore = this.wallet, before = this.lamps;
    this.receipt = this._receipt(MedalEvent.Protected, lane, 0, 0, before, this.lamps, walletBefore, 0.45);
    this.receipt.tease = true; this.receipt.duplicateSegment = this.duplicateSegment().index;
    const quiet = typeof this.rules.quietGate === 'function' && !!this.rules.quietGate(this);
    if (quiet) { this.receipt.quiet = true; this.receipt.uncounted = true; }
    this.teases = (this.teases ?? 0) + 1;
    this.shots = this.shots.filter((x) => x !== shot); this.shot = this.shots[this.shots.length - 1] ?? null;
    this._beginEffect();
    this._prepareChallenge();
    return true;
  }

  /** ガセ: 6灯目が点かず、5灯がすべて消える（種別は「全部消える重複」と同じ Reset。receipt.fake=true）。 */
  _fakeSixth(shot, lane) {
    const r = this.rules, before = this.lamps, walletBefore = this.wallet;
    this._lamps.clear();
    this.firstProtection = true; this.highLampDuplicateProtectionLeft = 0; this._dupUsed = 0;
    let duration = r.ResetEffectSecondsByLamps?.[before.length] ?? r.ResetEffectSeconds;
    const visual = r.ResetWhileShooting ? r.ResetVisualSecondsByLamps?.[before.length] ?? duration : null;
    if (visual !== null) duration = 0;
    this.receipt = this._receipt(MedalEvent.Reset, lane, 0, before.length, before, this.lamps, walletBefore, duration, 0, 3, -1);
    this.receipt.fake = true; this.receipt.duplicateSegment = this.duplicateSegment().index;
    const quiet = typeof r.quietGate === 'function' && !!r.quietGate(this);
    if (quiet) this.receipt.quiet = true;
    if (visual !== null && !quiet) this._startResetDisplay(this.receipt, visual);
    this.fakes = (this.fakes ?? 0) + 1;
    this.shots = this.shots.filter((x) => x !== shot); this.shot = this.shots[this.shots.length - 1] ?? null;
    this._beginEffect();
    this._prepareChallenge();
    return true;
  }

  // ---------- 連打メーター ----------
  _startMeter(kind, { targets, threshold, seconds, intro, chainStage = -1, display = null }) {
    this.meter = { id: ++this._sequence, kind, stage: 'intro', targets: [...targets], threshold, seconds, timeLeft: seconds,
      introLeft: intro, introSeconds: intro, settleLeft: 0, count: 0, fired: 0, landed: 0, lastLane: 0, chainStage };
    this.phase = HPhase.Meter; this.effectLeft = 0;
    this.attempts++; this.firstProtection = false;
    if (kind === 'jp') this.jackpotChances++;
    else this.chainAttempts++;
    this._emit('meterReady', { kind, targets: [...targets], threshold, seconds, introSeconds: intro, chainStage, display });
    if (intro <= 1e-9) this._beginFiring();
  }
  _beginFiring() {
    const m = this.meter; m.stage = 'firing'; this._sinceFire = Infinity;
    this._emit('meterStart', { kind: m.kind, targets: [...m.targets], threshold: m.threshold, seconds: m.seconds });
  }
  _advanceMeter(dt) {
    const m = this.meter;
    if (m.stage === 'intro') { m.introLeft = Math.max(0, m.introLeft - dt); if (m.introLeft <= 1e-9) this._beginFiring(); return; }
    if (m.stage === 'firing') {
      m.timeLeft = Math.max(0, m.timeLeft - dt);
      if (m.timeLeft > 1e-9) return;
      m.timeLeft = 0; m.stage = 'settling'; m.settleLeft = this.rules.MeterSettleSeconds;
      if (this._meterInFlight() === 0 || m.settleLeft <= 0) this._endMeter(false);
      return;
    }
    m.settleLeft = Math.max(0, m.settleLeft - dt);
    if (m.settleLeft <= 1e-9 || this._meterInFlight() === 0) this._endMeter(false);
  }
  _endMeter(success) {
    const m = this.meter; this.meter = null;
    const before = this.lamps, cost = this.cycleSpent; this.cycleSpent = 0;
    this._lamps.clear(); this.armed = false; this.challengeIntent = null;
    this.firstProtection = true; this.highLampDuplicateProtectionLeft = 0; this._dupUsed = 0;
    this._emit('meterEnd', { kind: m.kind, success, count: m.count, threshold: m.threshold, fired: m.fired, chainStage: m.chainStage });
    const lane = m.lastLane || m.targets[0] || 0;
    if (success) {
      this.meterSuccesses++;
      const tier = this._pick(this.rules.JackpotWeights);   // 配当は重みで決める。押す/押さないで変わらない
      this.roulette = { kind: m.kind, tier, award: this.rules.JackpotAwards[tier], stage: 'spinning', age: -this.rules.RouletteStartDelaySeconds, autoLeft: this.rules.RouletteAutoStopSeconds + this.rules.RouletteStartDelaySeconds,
        slideLeft: 0, pressedBy: null, chainStage: m.chainStage, lane, before, cost };
      this.phase = HPhase.Roulette; this.effectLeft = 0;
      this._emit('rouletteStart', { kind: m.kind, tier, award: this.rules.JackpotAwards[tier], autoStopSeconds: this.rules.RouletteAutoStopSeconds,
        stopAcceptAfter: this.rules.RouletteStopAcceptAfter, startDelay: this.rules.RouletteStartDelaySeconds, chainStage: m.chainStage });
      return;
    }
    // 失敗: 今のJPチャンス失敗と同じ扱い（灯は全部消える・Miss・1.35秒）。継続なら積み増し分が消える（最初の配当は残る）。
    this.meterFailures++;
    const walletBefore = this.wallet; let chainLost = 0, chainBase = 0;
    if (m.kind === 'chain') {
      const chain = this.jackpotChain; chainBase = chain?.baseAward ?? 0; chainLost = chain?.pendingAward ?? 0;
      this.chainLost += chainLost; this.chainFailures++; this.jackpotChain = null;
    }
    this.receipt = this._receipt(MedalEvent.Miss, lane, 0, 0, before, this.lamps, walletBefore, 1.35, cost, -1, -1);
    if (m.kind === 'chain') { this.receipt.chain = true; this.receipt.chainStage = -1; this.receipt.chainBase = chainBase; this.receipt.chainPending = 0; this.receipt.chainLost = chainLost; }
    this.receipt.meter = { kind: m.kind, count: m.count, threshold: m.threshold, fired: m.fired };
    this._beginEffect();
  }

  // ---------- ルーレット ----------
  /** 客がボタンを押した（by='button'）、または自動停止（by='auto'）。回転中だけ受け付ける。ボタンは回り始めて RouletteStopAcceptAfter 秒後から。 */
  stopRoulette(by = 'button') {
    const r = this.roulette;
    if (!r || r.stage !== 'spinning') return false;
    if (by === 'button' && r.age + 1e-9 < this.rules.RouletteStopAcceptAfter) return false;
    r.stage = 'slowing'; r.pressedBy = by; r.slideLeft = this.rules.RouletteSlideSeconds;
    this._emit('rouletteStopPress', { kind: r.kind, byAuto: by === 'auto', age: r.age, slideSeconds: r.slideLeft });
    if (r.slideLeft <= 1e-9) this._finishRoulette();
    return true;
  }
  _advanceRoulette(dt) {
    const r = this.roulette; r.age += dt;
    if (r.stage === 'spinning') {
      r.autoLeft = Math.max(0, r.autoLeft - dt);
      if (r.autoLeft <= 1e-9) this.stopRoulette('auto');
      return;
    }
    r.slideLeft = Math.max(0, r.slideLeft - dt);
    if (r.slideLeft <= 1e-9) this._finishRoulette();
  }
  _finishRoulette() {
    const r = this.roulette; this.roulette = null;
    const { tier, award } = r, walletBefore = this.wallet;
    let chainBase = 0, chainStage = -1, chain = null;
    if (r.kind === 'jp') {
      this.wallet += award; this.won += award; this.jackpotEarnings += award;
      if (award === 500) this.jackpotDreamHit = true;
      this.jackpotSuccesses++;
      this._chainSerial = (this._chainSerial ?? 0) + 1;
      this.jackpotChain = { baseAward: award, pendingAward: 0, pendingDreamHit: false, stage: 0, choicePending: true, inChallenge: false };
    } else {
      chain = this.jackpotChain; chainBase = chain?.baseAward ?? 0;
      if (chain) { chain.pendingAward += award; chain.pendingDreamHit ||= award === 500; chain.stage++; chain.inChallenge = false; chain.choicePending = true; chainStage = chain.stage; }
      this.chainSuccesses++;
    }
    this.successes++; this.bestAward = Math.max(this.bestAward, award);
    this.receipt = this._receipt(MedalEvent.Win, r.lane, award, 0, r.before, this.lamps, walletBefore, this.rules.RouletteResultSeconds[tier], r.cost, -1, tier);
    if (r.kind === 'chain') { this.receipt.chain = true; this.receipt.chainStage = chainStage; this.receipt.chainBase = chainBase; this.receipt.chainPending = chain?.pendingAward ?? 0; this.receipt.chainLost = 0; }
    this._emit('rouletteStopped', { kind: r.kind, tier, award, byAuto: r.pressedBy === 'auto', chainStage, payout: r.kind === 'jp' ? award : 0, pending: chain?.pendingAward ?? 0 });
    this._beginEffect();
  }

  // ---------- 継続 ----------
  /** 継続の告知中（選択を出す前）。液晶は選択画面を出さず告知を出す。 */
  get chainAnnouncing() { return this.phase === MedalPhase.ChainChoice && (this.announceLeft ?? 0) > 1e-9; }
  chooseChain(continueChain) {
    if (this.chainAnnouncing) return false;   // 告知中は選べない（ボタンの押し残しで確定・継続が走らない）
    if (!continueChain) return super.chooseChain(false);
    if (!this.rules.R3Enabled || this.phase !== MedalPhase.ChainChoice || !this.jackpotChain?.choicePending) return false;
    if (this.endPending && !this.rules.ChainContinueNeedsAddAtZero) return false;   // （追加の仕組みでは、選択が出ている間は終了待ちを無視する）
    if (this.secondsLeft <= 0) return this._requestChainAdd();   // 時計0: 続けるには100円の追加（スタッフの確認）が要る
    const chain = this.jackpotChain, cfg = this.rules.chainMeterFor(chain.stage);
    this._recallOrdinary();
    const targets = this._pickChainTargets(cfg.HitCount);
    this._lamps = new Set(LANES.filter((d) => !targets.includes(d)));   // 灯は「外れの穴」（点灯=外れ、消灯=当たり）。JPと同じ向き
    this.choiceLeft = 0; chain.choicePending = false; chain.inChallenge = true;
    this._startMeter('chain', { targets, threshold: this.rules.chainThresholdFor(targets, cfg.Threshold), seconds: cfg.Seconds, intro: cfg.IntroSeconds, chainStage: chain.stage, display: cfg.Display });
    return true;
  }
  /** 時計0で継続を選んだ: 追加（100円）の確認待ちへ。スタッフが確認すれば時間・玉が入り、そのまま継続の連打へ進む。払わない（取り消し）なら確定。 */
  _requestChainAdd() {
    const r = this.rules;
    if (!r.ChainContinueNeedsAddAtZero || !r.R3Enabled || this.extraCreditsUsed >= r.MaxExtraCredits) return false;
    this.phase = 'StaffWait'; this.choiceLeft = 0; this.offerLeft = 0; this.staffWaitSeconds = 0; this.staffReminder = false;
    this.extraRequestId = (this._requestSequence = (this._requestSequence ?? 0) + 1);
    this._autoChain = true; this.chainAddRequests = (this.chainAddRequests ?? 0) + 1;
    return true;
  }
  cancelExtra() { this._autoChain = false; return super.cancelExtra(); }
  /** 継続の選択が出ている間は、時計が0でも終了へ進めない（基底は残り0で終了の猶予に入り、選択を打ち切ってしまう）。選択の制限時間（ChainChoiceSeconds）が尽きれば確定。 */
  _advanceContinuous(seconds) {
    if (!(this.rules.ChainContinueNeedsAddAtZero && this.phase === MedalPhase.ChainChoice && this.jackpotChain?.choicePending)) return super._advanceContinuous(seconds);
    const r = this.rules, grace = r.EndGraceSeconds;
    r.EndGraceSeconds = Math.max(grace, 1);
    try { super._advanceContinuous(seconds); } finally { r.EndGraceSeconds = grace; }
    if (this.phase === MedalPhase.ChainChoice) { this.endPending = false; this.endGraceLeft = 0; }
  }
  /** 追加の払い出しのあと選択画面に戻る所で、追加で来た継続ならそのまま連打へ入る（選択を二度出さない）。 */
  _enterChainChoice() {
    if (this._autoChain && this.secondsLeft > 0) {
      this._autoChain = false; this.phase = MedalPhase.ChainChoice; this.choiceLeft = this.rules.ChainChoiceSeconds;
      if (this.chooseChain(true)) { this.chainAdds = (this.chainAdds ?? 0) + 1; return; }
    }
    super._enterChainChoice();
    const r = this.rules, chain = this.jackpotChain;
    if (r.ChainAnnounceSeconds > 0 && this.phase === MedalPhase.ChainChoice && chain?.choicePending) {
      const key = `${this._chainSerial ?? 0}:${chain.stage}`;
      if (this._announcedKey !== key) {
        this._announcedKey = key;
        const first = chain.stage === 0 && r.ChainFirstAuto;
        this.announceLeft = r.ChainAnnounceSeconds; this._announceFirst = first;
        this._emit('chainAnnounce', { first, atRisk: first ? 0 : chain.pendingAward, rate: '2/3', seconds: r.ChainAnnounceSeconds, stage: chain.stage });
      }
    } else if (r.ChainFirstAuto && this.phase === MedalPhase.ChainChoice && chain?.choicePending && chain.stage === 0) {
      this.chooseChain(true);   // 告知なしでも最初は選択を出さない
    }
  }
  /** 告知の間は選択の制限時間を減らさない。告知が終わったら、最初の継続は自動で継続、2回目以降は選択画面へ。 */
  _advanceChainChoice(seconds) {
    if (this.phase === MedalPhase.ChainChoice && (this.announceLeft ?? 0) > 0) {
      if (this.chainTooLate) { this.announceLeft = 0; return super._advanceChainChoice(seconds); }
      this.announceLeft = Math.max(0, this.announceLeft - seconds);
      if (this.announceLeft > 1e-9) return false;
      this.announceLeft = 0; this.choiceLeft = this.rules.ChainChoiceSeconds;
      if (this._announceFirst) return this.chooseChain(true);
      return false;
    }
    return super._advanceChainChoice(seconds);
  }
  _pickChainTargets(count) {
    if (this.rules.ChainHitLaneMode === 'order') return [...this.rules.JackpotChainLaneOrder.slice(0, count)].sort((a, b) => a - b);
    const pool = [...LANES], out = [];
    for (let i = 0; i < count; i++) out.push(...pool.splice(Math.floor(this._rng() * pool.length), 1));
    return out.sort((a, b) => a - b);
  }

  // ---------- 進行 ----------
  advance(dt) {
    if (this.phase === 'StaffWait') return super.advance(dt);
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('seconds');
    let left = dt;
    while (left > 1e-12 && (this.meter || this.phase === HPhase.Roulette)) {
      const s = Math.min(left, 0.05); left -= s;
      this._displayClock += s; this._resetDisplays = this._resetDisplays.filter((d) => d.expiresAt > this._displayClock);
      this._sinceFire += s; this._settlementLeft = Math.max(0, this._settlementLeft - s); this._loanLeft = Math.max(0, this._loanLeft - s);
      this.endPending = false; this.endGraceLeft = 0;
      if (this.meter ? this.rules.ClockStopOnMeter : this.rules.ClockStopOnRoulette) this.clockStoppedSeconds += s;
      else this.secondsLeft = Math.max(0, this.secondsLeft - s);
      if (this.meter) this._advanceMeter(s); else this._advanceRoulette(s);
    }
    if (left > 1e-12 || dt === 0) super.advance(left);
    this._resumeJpMeter();
  }
  /** 6灯が揃ったのに時間切れで始められなかった場合（追加入金で時間が戻った後）、払い出しが終わったらJPチャンスを始める。 */
  _resumeJpMeter() {
    if (this.meter || this.roulette || this.lampCount !== 6 || this.phase !== MedalPhase.Ready || this.secondsLeft <= 0 || this.jackpotChain) return;
    this._startJpMeter();
  }
  _startJpMeter() {
    const r = this.rules, targets = LANES.filter((d) => !this._lamps.has(d)), cfg = r.jpMeterFor(targets[0]);   // 残りは1穴。穴ごとの秒・しきい値
    this._startMeter('jp', { targets, threshold: cfg.Threshold, seconds: cfg.Seconds, intro: r.JpMeterIntroSeconds });
  }
  /** 賞。PrizeBasis='wallet' なら、終了（精算）の瞬間の持ち玉 wallet（払い出し待ち・継続の積み増しの確定分を含む。飛行中の玉は無い）だけで決める。
   *  500配当の確保（jackpotDreamHit）による S賞の上書きはしない。'earnings'（既定）は G と同じ従来の判定。 */
  get prize() {
    if (this.rules.PrizeBasis !== 'wallet') return super.prize;
    const t = this.rules.PrizeThresholds; let i = 0;
    const score = this.prizeScore;
    for (let k = 0; k < t.length; k++) if (t[k] <= score) i = k;
    return this.rules.PrizeNames[i];
  }
  /** 賞の判定に使う値（結果画面・「あと○玉」の表示用）。wallet 基準なら持ち玉（まだ確定していない継続の積み増しは、計数すると持ち玉に入るので足す。
   *  精算(finish)後は積み増しが wallet に入り 0 になるので二重には数えない）。従来は JPで得た玉 jackpotEarnings */
  get prizeScore() { return this.rules.PrizeBasis === 'wallet' ? this.wallet + (this.jackpotChain?.pendingAward ?? 0) : this.jackpotEarnings; }
  finish() {
    if (this.meter || this.phase === HPhase.Roulette) return false;   // 連打・ルーレットの途中では精算しない
    return super.finish();
  }
}
