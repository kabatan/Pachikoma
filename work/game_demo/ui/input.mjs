// キー/ポインタ入力 → controller.dispatch。キーリピートは無視。最初の入力で音声を unlock する。
// Space(右ボタン)／C(左ボタン): どちらも 開始(待機)/1球発射/結果からもう一度/故障時の計数（10/31 左右どちらでも同じ。選択画面だけ C=左の意味・Space=右の意味）。?firebtn=old で従来(C=Challenge)  A: 100円追加  B: 計数(確認後に確定)  R: 次のお客さま(結果から、スタッフ用で即時)  Esc: 戻る/終了
import { entryGuard, r3ButtonAction, fireButtonMode, registerPress } from './choice_gate_1031.mjs';   // 依存なしの module（実機ブリッジとの循環 import を避ける）   // 出現直後の押しを捨てる保護（実機ボタンと同じ秒数。QA10/30 E）
export function primaryButtonAction(ctrl) {
  if (ctrl.phase === 'Attract') return 'start';
  if (ctrl.phase === 'Result') return 'replay';
  if (ctrl.phase === 'Fault') return 'settleFault';
  if (ctrl.phase === 'ChainChoice') return 'chainContinue';
  return 'fire';
}

// 10/31 Space=右ボタン、C(と←)=左ボタン、→=右ボタン。実機の r3ButtonAction と同じ対応（選択画面は 左=終わる/確定・右=追加/継続、それ以外はどちらも発射など）。?firebtn=old は従来。
const keyButton = (ctrl, name) => {
  if (ctrl.phase === 'StaffWait') return name === 'FIRE' ? 'cancelExtra' : 'fire';   // スタッフ待ち: 左=取り消し(従来のCと同じ)、右は何も起きない
  return r3ButtonAction(ctrl, name);
};
// ?firebtn=old は従来：Space=左ボタン(primaryButtonAction)、C=右ボタン(勝負。継続の選択では確定)
const oldMode = () => fireButtonMode() === 'old';
export const KEY_ACTIONS = (ctrl) => ({
  Space: () => (oldMode() ? primaryButtonAction(ctrl) : ctrl.confirmFinish ? 'fire' : keyButton(ctrl, 'CHALLENGE')),   // 終了の確認はSpace連打で確定させない(従来どおり)。→ で確定、C/← で取消
  ArrowRight: () => (oldMode() ? 'fire' : keyButton(ctrl, 'CHALLENGE')),
  KeyC: () => (oldMode() ? (ctrl.phase === 'ChainChoice' ? 'chainStop' : 'challenge') : keyButton(ctrl, 'FIRE')),
  ArrowLeft: () => (oldMode() ? 'fire' : keyButton(ctrl, 'FIRE')), KeyA: () => 'add',
  KeyB: () => (ctrl.phase === 'ChainChoice' ? 'chainStop' : ctrl.confirmFinish ? 'confirmFinish' : 'finish'),
  KeyR: () => 'reset',
  Escape: () => (ctrl.confirmFinish ? 'cancelFinish' : 'quit'),
});

export function attachInput(ctrl, { target = window, audio = null, overlayRoot = null, onInput = null } = {}) {
  const map = KEY_ACTIONS(ctrl);
  const wake = () => { audio?.unlock?.(); };
  const onKey = (e) => {
    if (e.repeat || !(e.code in map)) return;
    e.preventDefault(); wake();
    const phase = ctrl.phase, action = map[e.code]();
    if (action === 'start') ctrl.pressDown?.('key:' + e.code);   // 説明の長押しスキップ(tutSkip)。短い押下は dispatch 側で無視される
    const blocked = entryGuard(ctrl); if (blocked) registerPress(ctrl);   // 捨てた押しも連打として数える
    const accepted = blocked ? false : ctrl.dispatch(action);
    onInput?.({ source: 'keyboard', action, accepted, phase }, ctrl.game);
  };
  target.addEventListener('keydown', onKey);
  const onKeyUp = (e) => { if (e.code in map) ctrl.pressUp?.('key:' + e.code); };
  const onBlur = () => ctrl.pressUp?.(null);
  target.addEventListener('keyup', onKeyUp); target.addEventListener?.('blur', onBlur);
  const onClick = (e) => {
    const el = e.target.closest?.('[data-action]'); if (!el) return;
    const phase = ctrl.phase, action = el.dataset.action;
    wake(); if (action === 'start') ctrl.pressDown?.('pointer');
    const blocked = entryGuard(ctrl); if (blocked) registerPress(ctrl);
    const accepted = blocked ? false : ctrl.dispatch(action);
    onInput?.({ source: 'pointer', action, accepted, phase }, ctrl.game);
  };
  overlayRoot?.addEventListener('pointerdown', onClick);
  const onPointerUp = () => ctrl.pressUp?.('pointer');
  overlayRoot?.addEventListener('pointerup', onPointerUp); overlayRoot?.addEventListener('pointercancel', onPointerUp);
  return () => { target.removeEventListener('keydown', onKey); target.removeEventListener('keyup', onKeyUp); target.removeEventListener?.('blur', onBlur); overlayRoot?.removeEventListener('pointerdown', onClick); overlayRoot?.removeEventListener('pointerup', onPointerUp); overlayRoot?.removeEventListener('pointercancel', onPointerUp); };
}
