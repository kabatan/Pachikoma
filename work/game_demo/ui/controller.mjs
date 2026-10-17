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
    this.preBuffer = null; this.preWindow = 0.3; this.droppedInputs = [];   // R-04: 勝負ボタンの先押しを0.3秒だけ1回保持。捨てた押しは記録
    this.howtoSeconds = 0; this.howto = null; // ルール説明(開始前、時計に含めない)。0なら即開始
  }
  onAction(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get phase() { return this.game.phase; }

  /** 毎フレーム。dt は実時間秒。 */
  update(dt) {
    this.frame++;
    const g = this.game;
    if (this.howto) { this.howto.t += dt; if (this.howto.t >= this.howtoSeconds) this._startNow(); }
    if (!this.freezeRules) g.advance(dt);
    if (this.preBuffer) {
      this.preBuffer.left -= dt;
      if (g.canFire && !this.confirmFinish) { this.preBuffer = null; if (g.toggleChallenge()) for (const fn of this.listeners) fn('challenge', this); else this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'not-allowed-after-wait' }); }
      else if (this.preBuffer.left <= 0) { this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'expired' }); this.preBuffer = null; }
    }
    if (g.phase === MedalPhase.Continue || g.phase === MedalPhase.Result) this.confirmFinish = false;
    this.resultAge = g.phase === MedalPhase.Result ? (this.resultAge ?? 0) + dt : 0;   // 結果が出てからの秒(客の連打で飛ばさない)
    if (g.canFire && !this.confirmFinish) this.aimClock += dt; // 狙いのスイープは入力受付中だけ進む
    this.aim = triangle(this.aimClock / this.sweepPeriod);
    { const u = (this.aimClock / this.sweepPeriod) % 1; this.aimDir = (u < 0.25 || u >= 0.75) ? 1 : -1; } // +1: 右へ動いている
  }

  /** @returns {boolean} 受理されたか。1フレーム1操作(連打・キーリピートの二重処理を避ける)。 */
  dispatch(action) {   // action は howto 開始時に 'howto' へ置換される
    if (this._lastActionFrame === this.frame) return false;
    if (this.confirmFinish && !['cancelFinish', 'confirmFinish', 'quit'].includes(action)) return false;
    const g = this.game; let ok = false;
    switch (action) {
      case 'start':
        if (g.phase !== MedalPhase.Attract) break;
        if (this.howto) { if (this.howto.t >= 0.3) { this._startNow(); return true; } break; }   // 説明中の2度押しで飛ばす(誤タップ防止に0.3秒は無視)
        if (this.howtoSeconds > 0) { this.howto = { t: 0 }; ok = true; action = 'howto'; break; }
        this.hooks.cancelFlights?.(); ok = g.start(); this.sessionId++; break;
      case 'fire': ok = this._fire(); break;
      case 'challenge':
        ok = g.toggleChallenge();
        if (!ok && g.phase === MedalPhase.Effect && g.lampCount > 0 && g.lampCount < 6) {   // 演出中(次の発射可能が近い)の先押しだけ0.3秒保持(1回)
          if (this.preBuffer) this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: 'already-buffered' });
          else { this.preBuffer = { left: this.preWindow }; this._lastActionFrame = this.frame; return true; }   // 'challenge'の通知は適用時に出す
        } else if (!ok) this.droppedInputs.push({ action: 'challenge', frame: this.frame, reason: g.phase });
        break;
      case 'add': ok = g.addCredit(); break;
      case 'finish':
        if (g.phase === MedalPhase.Continue) ok = g.finish();
        else if (g.canFire) { this.confirmFinish = true; ok = true; }
        break;
      case 'confirmFinish': if (this.confirmFinish) { ok = g.finish(); this.confirmFinish = false; } break;
      case 'cancelFinish': if (this.confirmFinish) { this.confirmFinish = false; ok = true; } break;
      case 'settleFault': if (g.phase === MedalPhase.Fault) ok = g.finish(); break;
      case 'replay':   // 客用の「もう一度」: 結果が出て3秒後から。スタッフ用の 'reset'(R)は即時
        if ((this.resultAge ?? 0) < this.replayAfter) break;
        return this.dispatch('reset');
      case 'reset':
        if (g.phase === MedalPhase.Result && (this.hooks.canReset?.() ?? true)) { this.hooks.cancelFlights?.(); this.game = new MedalGame(this.rules, this.seed == null ? undefined : this.seed + 1 + this.sessionId); this.aimClock = 0; this.confirmFinish = false; ok = true; }
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
  _fire() {
    const shot = this.game.launch(); if (!shot) return false;
    this.lockedAim = this.aim; this.hooks.launchBall?.(shot, this.aim, this.aimDir);
    return true;
  }
  /** 物理の着地確定。reached=false は判定不能(故障): その1球だけ返金して Fault。 */
  landing(shotId, lane, reached = true) { return this.game.resolve(shotId, lane, reached); }
}
