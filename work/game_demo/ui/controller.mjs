// 入力→規則の橋渡し（MedalGameHost.cs の Dispatch/_Process/FireAsync 相当、描画・物理に依存しない）。
// 物理側とのやり取りは hooks だけ:
//   hooks.launchBall(shot, aim)  玉を1球発射する(aim = -1..1、射出器の位置/角度は物理側で決める)。
//   hooks.cancelFlights()        飛行中の玉を全て片付ける(待機に戻る/新規開始時)。
//   controller.landing(shotId, lane, reached=true)  物理が口(1..7)への着地を確定したら呼ぶ(一回だけ)。
import { MedalGame, MedalPhase } from '../rules/medal_rules.mjs';

/** 三角波(0..1周期) -1..1。PortraitPreviewGeometry.BoardSweep の triangle。 */
export function triangle(phase) { const u = phase - Math.floor(phase); return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4; }

export class MedalController {
  constructor({ rules, seed, hooks = {}, sweepPeriod = 5.5 } = {}) {
    this.rules = rules; this.seed = seed; this.hooks = hooks; this.sweepPeriod = sweepPeriod;
    this.game = new MedalGame(rules, seed);
    this.confirmFinish = false; this.aimClock = 0; this.aim = 0; this.aimDir = 1;
    this.frame = 0; this._lastActionFrame = -1; this.freezeRules = false;
    this.listeners = new Set(); this.sessionId = 0; this.resultAge = 0; this.replayAfter = 3;
    this.preBuffer = null; this.preWindow = 0.3; this.preWindowDrain = 5;
    this.fireBuffer = null; this.fireWindow = 0.3;   // 同時発射: 間隔待ち(残り0.3秒以内)に押された発射は、狙いを押した瞬間に固定して解禁と同時に撃つ
    // 射出の入口の一括判定(?firegate=0 で fireGateEnabled=false → 従来)。fireGate は液晶側(映像・切替)の事情を返す関数(play.mjs が付ける)
    this.fireGateEnabled = true; this.fireGate = null; this.lastFireGate = null; this.fireGateDrops = 0;
    this.droppedInputs = [];   // R-04: 勝負ボタンの先押しを0.3秒だけ1回保持。捨てた押しは記録
    this.inputLog = [];
    this.howtoSeconds = 0; this.howtoSecondsFull = null; this.howtoSecondsShort = null; this.repeatVisit = false; /* 10/30 2回目の客(結果の「もう一度」経由)は短い説明。play.mjs が Full/Short を設定 */ this.howtoMinDwell = 0.5; this.howtoPanels = 5; this.howto = null; // ルール説明(開始前、時計に含めない)。0なら即開始
    // 説明(howto)の長押しスキップ(10/30。?tutskip=0 で従来=押すと0.5秒後から飛ばせる)。play.mjs が液晶のゲージを付けたときだけ true にする。
    // 短い押下(連打)では飛ばさず、押している間 holdSeconds 満ちたら飛ばす。説明が始まって graceSeconds 以内の押下(開始ボタンの余韻の連打)は長押しの数に入れない。
    this.tutSkipEnabled = false; this.tutSkipHoldSeconds = 1.0; this.tutSkipGraceSeconds = 0.8;
    this.tutSkip = { holding: false, holdT: 0, src: null, level: 0, tap: 0, flash: 0, completing: 0, taps: 0 };
  }
  /** 説明中の長押しスキップが効いているか(入力側が押下/離しを渡すかの判定に使う)。 */
  get tutSkipActive() { return this.tutSkipEnabled && !!this.howto && this.game.phase === MedalPhase.Attract; }
  /** 液晶の表示用。active=ゲージを出す、level=リング(0..1)、tap=押した瞬間の光、flash=満ちた閃光、done=SKIP確定中。 */
  tutSkipView() { const u = this.tutSkip, t = this.howto?.t ?? 0; return { active: this.tutSkipActive, t, level: u.level, holding: u.holding, tap: u.tap, flash: u.flash, done: u.completing > 0 }; }
  /** 主ボタンの押下(キー/ボタン/ポインタ共通)。長押しの開始。説明の外・無効のときは何もしない。 */
  pressDown(src = 'key') {
    if (!this.tutSkipActive) return false;
    const u = this.tutSkip; u.tap = 1; u.taps++;
    if (u.completing > 0 || u.holding) return true;
    u.level = Math.max(u.level, 0.18);   // 押した合図：リングが少し満ちて、離すとすぐ戻る(連打でも「長押しだ」と気づける)
    if (this.howto.t < this.tutSkipGraceSeconds) return true;   // 余韻の連打は反応だけ見せて数えない
    u.holding = true; u.holdT = 0; u.src = src; return true;
  }
  pressUp(src = 'key') { const u = this.tutSkip; if (u.holding && (u.src === src || src == null)) { u.holding = false; u.holdT = 0; u.src = null; } }
  _tutSkipTick(dt) {
    const u = this.tutSkip;
    if (!this.howto || this.game.phase !== MedalPhase.Attract) { if (u.holding || u.level || u.completing || u.flash || u.tap) this.tutSkip = { holding: false, holdT: 0, src: null, level: 0, tap: 0, flash: 0, completing: 0, taps: u.taps }; return; }
    u.tap = Math.max(0, u.tap - dt * 5); u.flash = Math.max(0, u.flash - dt * 3);
    if (u.completing > 0) { u.completing -= dt; u.level = 1; if (u.completing <= 0) { u.completing = 0; this._startNow(); } return; }
    if (u.holding) {
      u.holdT += dt; const p = Math.min(1, u.holdT / this.tutSkipHoldSeconds);
      u.level = Math.max(u.level, 0.18 + 0.82 * p);
      if (p >= 1) { u.holding = false; u.completing = 0.3; u.flash = 1; u.level = 1; for (const fn of this.listeners) fn('tutSkip', this); }
    } else u.level = Math.max(0, u.level - dt * 1.3);
  }
  onAction(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get phase() { return this.game.phase; }

  /** 射出の入口の一括判定。今の場面で球を撃ってはいけない理由(文字列)を返す。撃ってよければ null。
   *  撃ってよい: 通常遊技(Ready/Flight/Effect の通常・導入)と連打メーター中(Meter。細かい可否は規則の canFire)。
   *  撃てない: 開始前・結果・故障・継続選択・時間切れ・追加・ルーレット(ボタンは停止用)・失敗/確定/配当の演出中・液晶の映像中(fireGate)。 */
  fireBlockedReason() {
    if (!this.fireGateEnabled) return null;
    const g = this.game, p = g.phase;
    if (p === 'Meter') return null;
    if (p !== MedalPhase.Ready && p !== MedalPhase.Flight && p !== MedalPhase.Effect) return p;
    if (p === MedalPhase.Effect) { const k = g.receipt?.kind; if (k === 'Win' || k === 'Miss' || k === 'ChainStop' || k === 'Fault') return 'effect-' + k; }
    if (g.meter) return null;
    if (typeof this.fireGate === 'function') { try { const r = this.fireGate(this); if (r) return String(r); } catch { /* 判定の不具合で遊技を止めない */ } }
    return null;
  }
  _fireGated() {   // 撃てない場面なら押しを捨てる(保持中の先押しも)。true=捨てた
    const why = this.fireBlockedReason(); if (!why) return false;
    if (this.fireBuffer) { this.fireBuffer = null; this.fireGateDrops++; }
    this.lastFireGate = { frame: this.frame, reason: why };
    this.droppedInputs.push({ action: 'fire', frame: this.frame, reason: 'fire-gate:' + why });
    if (this.droppedInputs.length > 256) this.droppedInputs.shift();
    return true;
  }

  /** 毎フレーム。dt は実時間秒。 */
  update(dt) {
    this.frame++;
    const g = this.game;
    if (this.howto) { this.howto.t += dt; if (this.howto.t >= this.howtoSeconds) this._startNow(); }
    if (this.tutSkipEnabled) this._tutSkipTick(dt);
    if (!this.freezeRules) g.advance(dt);
    if (!g.rules.ContinuousFire && g.rules.R2Enabled && g.challengeIntent && this.fireBuffer) {
      this.droppedInputs.push({ action: 'fire', frame: this.frame, reason: 'challenge-clears-buffer' });
      this.fireBuffer = null;
    }
    if (this.preBuffer) {
      this.preBuffer.left -= dt;
      if ((g.overlap ? g.canArm : g.canFire) && !this.confirmFinish) { this.preBuffer = null; if (g.toggleChallenge()) for (const fn of this.listeners) fn('challenge', this); else this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'not-allowed-after-wait' }); }
      else if (this.preBuffer.left <= 0) { this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'expired' }); this.preBuffer = null; }
    }
    if (this.fireBuffer && this.fireBlockedReason()) { this.fireBuffer = null; this.fireGateDrops++; }   // 演出の間に溜まった押しは捨てる(終わった直後にまとめて撃たない)
    if (this.fireBuffer) {
      this.fireBuffer.left -= dt;
      if (g.canFire && !this.confirmFinish && !this.preBuffer) { const b = this.fireBuffer; this.fireBuffer = null; if (this._fire(b.aim, b.dir)) for (const fn of this.listeners) fn('fire', this); }
      else if ((!g.rules.ContinuousFire && this.fireBuffer.left <= 0) || !g.canAim) { this.droppedInputs.push({ action: 'fire', frame: this.frame, reason: 'expired' }); this.fireBuffer = null; }
    }
    if (g.phase === MedalPhase.Continue || g.phase === MedalPhase.ChainChoice || g.phase === MedalPhase.Result || g.phase === MedalPhase.Fault || g.phase === 'Meter' || g.phase === 'Roulette' || g.meter) this.confirmFinish = false;   // 10/31 検証: 連打メーター(H)・ルーレット・故障に入ったら「ここで計数しますか」の確認待ちを消す（持ち越すと連打の発射を止める）
    this.resultAge = g.phase === MedalPhase.Result ? (this.resultAge ?? 0) + dt : 0;   // 結果が出てからの秒(客の連打で飛ばさない)
    if (g.canAim && !this.confirmFinish) this.aimClock += dt * g.challengeAimSpeed; // 狙いのスイープは入力受付中だけ進む
    this.aim = triangle(this.aimClock / this.sweepPeriod);
    { const u = (this.aimClock / this.sweepPeriod) % 1; this.aimDir = (u < 0.25 || u >= 0.75) ? 1 : -1; } // +1: 右へ動いている
  }

  /** @returns {boolean} 受理されたか。1フレーム1操作(連打・キーリピートの二重処理を避ける)。 */
  dispatch(action) {
    const g=this.game, before=this.fireBuffer, shotId=g.shot?.id, sameFrame=this._lastActionFrame===this.frame;
    const phase=g.phase, intent=g.challengeIntent?.stage;
    const ok=this._dispatch(action);
    const queued=action==='fire' && this.fireBuffer && this.fireBuffer!==before;
    const reason=ok?'accepted':action==='fire'&&this.lastFireGate?.frame===this.frame?'fire-gate:'+this.lastFireGate.reason:queued?'buffered':action==='fire'&&before&&this.fireBuffer===before?'coalesced':sameFrame?'same-frame':this.confirmFinish?'finish-confirmation':
      g.shots.length>=g.rules.MaxInFlight?'in-flight-limit':g._sinceFire+1e-9<g.rules.FireInterval?'fire-interval':intent??phase;
    this.inputLog.push({action,frame:this.frame,phase,reason,queued:!!queued,fired:action==='fire'&&g.shot?.id!==shotId});
    if(this.inputLog.length>512)this.inputLog.shift();
    return ok || !!(g.rules.ContinuousFire && queued);
  }
  _dispatch(action) {   // action は howto 開始時に 'howto' へ置換される
    if (this._lastActionFrame === this.frame) {
      if(action==='fire'&&this.game.rules.ContinuousFire&&this.game.canAim&&!this.confirmFinish&&!this.fireBuffer&&!this.fireBlockedReason())this.fireBuffer={aim:this.aim,dir:this.aimDir,left:Infinity};
      return false;
    }
    if (this.confirmFinish && !['cancelFinish', 'confirmFinish', 'quit'].includes(action)) return false;
    const g = this.game; let ok = false;
    switch (action) {
      case 'start':
        if (g.phase !== MedalPhase.Attract) break;
        if (this.howto && this.tutSkipEnabled) { if (!this.tutSkip.holding) { this.tutSkip.tap = 1; this.tutSkip.level = Math.max(this.tutSkip.level, 0.18); } break; }   // 長押しスキップ有効：短い押下では飛ばさない
        if (this.howto) {   // 説明は howtoPanels コマ(等分)。押すと次のコマへ、最後のコマで押すと開始。各コマ最低 howtoMinDwell 秒(0.5秒)は押しても進まない(タイトルからの二度押しや連打で一気に飛ばさない)
          const h = this.howto, per = this.howtoSeconds / this.howtoPanels, dwell = Math.min(this.howtoMinDwell, per * 0.6);
          const k = Math.min(this.howtoPanels - 1, Math.floor(h.t / per));
          if (h.t - k * per >= dwell) { if (k >= this.howtoPanels - 1) { this._startNow(); return true; } h.t = (k + 1) * per; this._lastActionFrame = this.frame; return true; }
          break;   // 読ませている間の押下は無視
        }
        if (this.howtoSeconds > 0) { if (this.howtoSecondsFull != null) this.howtoSeconds = this.repeatVisit && this.howtoSecondsShort != null ? this.howtoSecondsShort : this.howtoSecondsFull; this.howto = { t: 0 }; ok = true; action = 'howto'; break; }
        this.hooks.cancelFlights?.(); ok = g.start(); this.sessionId++; break;
      case 'fire': ok = this._fire(); break;
      case 'challenge':
        ok = g.toggleChallenge();
        if (g.rules.R2Enabled) {
          if (ok) this.fireBuffer = this.preBuffer = null;
          break;
        }
        // 演出中(次の発射可能が近い)の先押しだけ0.3秒保持(1回)。同時発射では、盤上の玉が着いて空になるまで(最大 preWindowDrain 秒)保持し、その間は新しい玉を撃たない
        if (!ok && (g.phase === MedalPhase.Effect || (g.overlap && g.shots.length > 0 && g.phase !== MedalPhase.Flight)) && g.lampCount > 0 && g.lampCount < 6) {
          if (this.preBuffer) this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'already-buffered' });
          else { this.preBuffer = { left: g.overlap ? this.preWindowDrain : this.preWindow }; this._lastActionFrame = this.frame; if (g.overlap) for (const fn of this.listeners) fn('challengeWait', this); return true; }   // 同時発射では、先押しを受け付けた合図を出す(宣言は盤が空になってから)   // 'challenge'の通知は適用時に出す
        } else if (!ok) this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: g.phase });
        break;
      case 'add': ok = g.addCredit(); break;
      case 'chainContinue': ok = g.chooseChain(true); break;
      case 'chainStop': ok = g.chooseChain(false); break;
      case 'finish':
        if (g.phase === MedalPhase.Continue) ok = g.finish();
        else if (g.overlap ? (g.canAim && g.shots.length === 0) : g.canFire) { this.confirmFinish = true; ok = true; }
        break;
      case 'confirmFinish': if (this.confirmFinish) { ok = g.finish(); this.confirmFinish = false; } break;
      case 'cancelFinish': if (this.confirmFinish) { this.confirmFinish = false; ok = true; } break;
      case 'settleFault': if (g.phase === MedalPhase.Fault) ok = g.finish(); break;
      case 'replay':   // 客用の「もう一度」: 結果が出て3秒後から。スタッフ用の 'reset'(R)は即時
        if ((this.resultAge ?? 0) < this.replayAfter) break;
        { const r = this.dispatch('reset'); if (r) this.repeatVisit = true; return r; }   // 10/30 客用の「もう一度」だけ 2回目扱い(スタッフの 'reset' は新しい客)
      case 'reset':
        if (g.phase === MedalPhase.Result && (this.hooks.canReset?.() ?? true)) { this.repeatVisit = false; this.hooks.cancelFlights?.(); this.game = new MedalGame(this.rules, this.seed == null ? undefined : this.seed + 1 + this.sessionId); this.aimClock = 0; this.confirmFinish = false; this.fireBuffer = this.preBuffer = null; ok = true; }
        break;
      case 'quit': ok = true; break;
    }
    if (ok) { this._lastActionFrame = this.frame; for (const fn of this.listeners) fn(action, this); }
    return ok;
  }
  /** 10/31 軟らかいリセット（管理画面のリセット。タブを再読み込みしない）: どの局面からでも新しい客の待機（Attract）へ戻す。
   *  'reset'（Result 限定・canReset あり）と同じ後始末と通知（listeners に 'reset' → 演出は 'attract'）を、局面を問わず行う。
   *  盤上・皿の玉は hooks.cancelFlights（物理 reset）で消える。戻り値は新しい game。 */
  softReset() {
    this.hooks.cancelFlights?.();
    this.howto = null; this.fireBuffer = this.preBuffer = null; this.confirmFinish = false;
    this.game = new this.game.constructor(this.rules, this.seed == null ? undefined : this.seed + 1 + this.sessionId);
    this.aimClock = 0; this.aim = 0; this.aimDir = 1; this.resultAge = 0; this._resultAutoAt = null; this.repeatVisit = false; this.lastGameEvent = null;
    this.lockedAim = undefined; this.lastFireGate = null; this._lastActionFrame = -1;
    this.tutSkip = { holding: false, holdT: 0, src: null, level: 0, tap: 0, flash: 0, completing: 0, taps: this.tutSkip?.taps ?? 0 };
    for (const fn of this.listeners) fn('reset', this);
    this.freezeRules = false;   // うぱ接客の冒頭などが止めていた時計を、通知のあとも必ず動く状態へ
    this._lastActionFrame = -1; this.fireBuffer = this.preBuffer = null;
    return this.game;
  }
  /** ルール説明を終えて(または飛ばして)実際に開始する。 */
  _startNow() {
    this.howto = null; const g = this.game;
    if (g.phase !== MedalPhase.Attract) return false;
    this.hooks.cancelFlights?.(); const ok = g.start(); this.sessionId++;
    if (ok) { this._lastActionFrame = this.frame; for (const fn of this.listeners) fn('start', this); }
    return ok;
  }
  _fire(aim = this.aim, dir = this.aimDir) {
    const g = this.game;
    if (this._fireGated()) return false;
    if (g.rules.ContinuousFire && !g.canFire) {
      if (g.canAim) {if(!this.fireBuffer)this.fireBuffer={aim,dir,left:Infinity};return false;}
      this.droppedInputs.push({action:'fire',frame:this.frame,reason:g.phase});return false;
    }
    if (!g.rules.ContinuousFire && g.rules.R2Enabled && g.challengeIntent && g.challengeIntent.stage !== 'ready') {
      this.fireBuffer = null;
      this.droppedInputs.push({ action: 'fire', frame: this.frame, reason: g.challengeIntent.stage });
      return false;
    }
    if (this.preBuffer && g.overlap) return false;   // 勝負待ちの間は盤を空にする
    if (g.overlap && !g.canFire && g.canAim && !g.armed && !this.fireBuffer && g.shots.length < g.rules.MaxInFlight && g.rules.FireInterval - g._sinceFire <= this.fireWindow) {
      this.fireBuffer = { aim, dir, left: this.fireWindow }; return false;   // 間隔待ちの先押しを保持(通知は撃った時に出す)
    }
    const shot = g.launch(); if (!shot) return false;
    this.lockedAim = aim; this.hooks.launchBall?.(shot, aim, dir);
    return true;
  }
  /** 物理の着地確定。reached=false は判定不能(故障): その1球だけ返金して Fault。 */
  landing(shotId, lane, reached = true) { return this.game.resolve(shotId, lane, reached); }
}
