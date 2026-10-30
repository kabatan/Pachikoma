// 10/31 ボタンの割り当て（左右どちらでも同じ）と、選択画面の誤選択防止。依存なし。
//
// ■ 割り当て：選択画面（追加 Continue／継続 ChainChoice／スタッフ StaffWait／終了の確認 confirmFinish／うぱ冒頭の きく|きかない）以外は、
//   左右どちらのボタンでも同じ動作（開始・発射・連打・ルーレット停止・スキップ・もう一度）。
//   ?firebtn=old で従来（左=発射、右=challenge）に戻る。
// ■ 誤選択防止：連打したまま選択画面に入ると「追加」「継続」を押してしまう。選択画面（Continue / ChainChoice）では、
//   画面が出てから CHOICE_GUARD_SECONDS 秒たち、かつ（どちらのボタンでも）直前の押下から MASH_QUIET_SECONDS 秒たつまで、
//   左右の押下を受け付けない。止まるまでの押下は「押されたが無視」（演出なし）で、止まるまでの待ちを延ばす。
//   時間切れ・放置は従来どおり（規則側が確定／終了を決める。追加は自動で決めない）。

export const CHOICE_GUARD_SECONDS = 1.5;   // 選択画面が出てからの待ち
export const MASH_QUIET_SECONDS = 0.4;     // 連打（どちらのボタンでも）が止まってからの待ち

let _mode = null;
/** 'any'（既定：左右どちらでも）または 'old'（?firebtn=old：従来の左=発射・右=challenge）。 */
export function fireButtonMode(search) {
  if (search === undefined) { if (_mode) return _mode; try { search = globalThis.location?.search ?? ''; } catch { search = ''; } }
  const v = String(new URLSearchParams(search).get('firebtn') ?? '').toLowerCase();
  const mode = v === 'old' || v === 'left' ? 'old' : 'any';
  if (arguments.length === 0) _mode = mode;
  return mode;
}
export function resetFireButtonMode() { _mode = null; }

/** 選択画面（誤選択防止の対象）で、押された入力が変えるもの。 */
export const BUTTON_ACTIONS = new Set(['fire', 'challenge', 'start', 'replay', 'settleFault', 'add', 'requestExtra', 'finish', 'chainContinue', 'chainStop', 'cancelFinish', 'confirmFinish']);

export function uiNow(ctrl) { return typeof ctrl.uiTime === 'number' ? ctrl.uiTime : performance.now() / 1000; }

/** 選択画面が出てからの秒。選択画面でなければ null。告知中（規則側がまだ選ばせない）は 0。 */
export function choiceAge(ctrl) {
  const g = ctrl.game, r = ctrl.rules ?? g?.rules;
  if (!g || !r) return null;
  if (ctrl.phase === 'Continue' && typeof g.offerLeft === 'number' && typeof r.ContinueSeconds === 'number') return r.ContinueSeconds - g.offerLeft;
  if (ctrl.phase === 'ChainChoice' && typeof g.choiceLeft === 'number' && typeof r.ChainChoiceSeconds === 'number') {
    if (g.chainAnnouncing) return 0;
    // 時計0の「100円で継続」の選択は ContinueSeconds(30秒)。実際の長さ(_chainChoiceSeconds)で測る
    const full = typeof g._chainChoiceSeconds === 'function' ? g._chainChoiceSeconds() : r.ChainChoiceSeconds;
    return Math.max(full, r.ChainChoiceSeconds) - g.choiceLeft;
  }
  return null;
}

/** 押してよい状態か。false を返したら無視する。押下は（無視したものも）連打として数える（register=false で数えない）。 */
export function choiceBlocked(ctrl, register = true) {
  const age = choiceAge(ctrl);
  const now = uiNow(ctrl), since = now - (ctrl._lastPressAt ?? -Infinity);
  if (register) ctrl._lastPressAt = now;
  if (age === null) return false;
  return age < CHOICE_GUARD_SECONDS || since < MASH_QUIET_SECONDS;
}

/** 入口（実機ボタン・キーボード）が自前で捨てた押下も、連打として数える。 */
export function registerPress(ctrl) { ctrl._lastPressAt = uiNow(ctrl); }

let _staffGate = null;
/** ?staffgate=0 で従来（出てから0.7秒だけ捨てる）に戻る。 */
export function staffGateOn() { if (_staffGate === null) { let q = ''; try { q = globalThis.location?.search ?? ''; } catch {} _staffGate = new URLSearchParams(q).get('staffgate') !== '0'; } return _staffGate; }
export function resetStaffGate() { _staffGate = null; }
export const GUARD_SECONDS = 0.7;   // StaffWait: スタッフ画面が出た直後の押しを捨てる秒

/** Pure mapping used by tests and the bridge. StaffWait is handled by the bridge (chord rules); here it returns null. */
export function r3ButtonAction(ctrl, name) {
  const left = name === 'FIRE', phase = ctrl.phase, g = ctrl.game;
  if (phase === 'Attract') return 'start';
  if (phase === 'Result') return 'replay';
  if (phase === 'Fault') return 'settleFault';
  if (phase === 'ChainChoice') return left ? 'chainStop' : 'chainContinue';
  if (phase === 'Continue') return left ? 'finish' : (ctrl.rules?.RuleVariant === 'G_20261028' ? 'requestExtra' : 'add');
  if (phase === 'StaffWait') return null;
  if (ctrl.confirmFinish) return left ? 'cancelFinish' : 'confirmFinish';
  if (fireButtonMode() === 'old' || ctrl.sideChoice) return left ? 'fire' : 'challenge';   // sideChoice: うぱ冒頭の きく|きかない の間だけ左右を分ける
  return 'fire';   // 10/31 左右どちらでも発射（連打・ルーレット停止も同じ 'fire'）
}

/** True while a decision screen has only just appeared. */
export function entryGuard(ctrl) {
  const age = choiceAge(ctrl);   // 追加(Continue)・継続(ChainChoice)。告知中は 0
  if (age !== null) return age < CHOICE_GUARD_SECONDS;
  const g = ctrl.game;
  if (ctrl.phase === 'StaffWait' && typeof g.staffWaitSeconds === 'number') {
    if (!staffGateOn()) return g.staffWaitSeconds < GUARD_SECONDS;
    // 10/31 スタッフ待ちも選択画面と同じ：出てから1.5秒、かつ連打（捨てた押しを含む）が0.4秒止まるまで取り消せない
    return g.staffWaitSeconds < CHOICE_GUARD_SECONDS || uiNow(ctrl) - (ctrl._lastPressAt ?? -Infinity) < MASH_QUIET_SECONDS;
  }
  return false;
}

