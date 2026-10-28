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
    this.droppedInputs = [];   // R-04: 勝負ボタンの先押しを0.3秒だけ1回保持。捨てた押しは記録
    this.inputLog = [];
    this.howtoSeconds = 0; this.howtoMinDwell = 0.5; this.howtoPanels = 5; this.howto = null; // ルール説明(開始前、時計に含めない)。0なら即開始
  }
  onAction(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get phase() { return this.game.phase; }

  /** 毎フレーム。dt は実時間秒。 */
  update(dt) {
    this.frame++;
    const g = this.game;
    if (this.howto) { this.howto.t += dt; if (this.howto.t >= this.howtoSeconds) this._startNow(); }
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
    if (this.fireBuffer) {
      this.fireBuffer.left -= dt;
      if (g.canFire && !this.confirmFinish && !this.preBuffer) { const b = this.fireBuffer; this.fireBuffer = null; if (this._fire(b.aim, b.dir)) for (const fn of this.listeners) fn('fire', this); }
      else if ((!g.rules.ContinuousFire && this.fireBuffer.left <= 0) || !g.canAim) { this.droppedInputs.push({ action: 'fire', frame: this.frame, reason: 'expired' }); this.fireBuffer = null; }
    }
    if (g.phase === MedalPhase.Continue || g.phase === MedalPhase.ChainChoice || g.phase === MedalPhase.Result) this.confirmFinish = false;
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
    const reason=ok?'accepted':queued?'buffered':action==='fire'&&before&&this.fireBuffer===before?'coalesced':sameFrame?'same-frame':this.confirmFinish?'finish-confirmation':
      g.shots.length>=g.rules.MaxInFlight?'in-flight-limit':g._sinceFire+1e-9<g.rules.FireInterval?'fire-interval':intent??phase;
    this.inputLog.push({action,frame:this.frame,phase,reason,queued:!!queued,fired:action==='fire'&&g.shot?.id!==shotId});
    if(this.inputLog.length>512)this.inputLog.shift();
    return ok || !!(g.rules.ContinuousFire && queued);
  }
  _dispatch(action) {   // action は howto 開始時に 'howto' へ置換される
    if (this._lastActionFrame === this.frame) {
      if(action==='fire'&&this.game.rules.ContinuousFire&&this.game.canAim&&!this.confirmFinish&&!this.fireBuffer)this.fireBuffer={aim:this.aim,dir:this.aimDir,left:Infinity};
      return false;
    }
    if (this.confirmFinish && !['cancelFinish', 'confirmFinish', 'quit'].includes(action)) return false;
    const g = this.game; let ok = false;
    switch (action) {
      case 'start':
        if (g.phase !== MedalPhase.Attract) break;
        if (this.howto) {   // 説明は howtoPanels コマ(等分)。押すと次のコマへ、最後のコマで押すと開始。各コマ最低 howtoMinDwell 秒(0.5秒)は押しても進まない(タイトルからの二度押しや連打で一気に飛ばさない)
          const h = this.howto, per = this.howtoSeconds / this.howtoPanels, dwell = Math.min(this.howtoMinDwell, per * 0.6);
          const k = Math.min(this.howtoPanels - 1, Math.floor(h.t / per));
          if (h.t - k * per >= dwell) { if (k >= this.howtoPanels - 1) { this._startNow(); return true; } h.t = (k + 1) * per; this._lastActionFrame = this.frame; return true; }
          break;   // 読ませている間の押下は無視
        }
        if (this.howtoSeconds > 0) { this.howto = { t: 0 }; ok = true; action = 'howto'; break; }
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
        return this.dispatch('reset');
      case 'reset':
        if (g.phase === MedalPhase.Result && (this.hooks.canReset?.() ?? true)) { this.hooks.cancelFlights?.(); this.game = new MedalGame(this.rules, this.seed == null ? undefined : this.seed + 1 + this.sessionId); this.aimClock = 0; this.confirmFinish = false; this.fireBuffer = this.preBuffer = null; ok = true; }
        break;
      case 'quit': ok = true; break;
    }
    if (ok) { this._lastActionFrame = this.frame; for (const fn of this.listeners) fn(action, this); }
    return ok;
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
