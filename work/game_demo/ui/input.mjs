// キー/ポインタ入力 → controller.dispatch。キーリピートは無視。最初の入力で音声を unlock する。
// Space/左ボタン: 開始(待機)/1球発射/結果からもう一度/故障時の計数  C: Challenge  A: 100円追加  B: 計数(確認後に確定)  R: 次のお客さま(結果から、スタッフ用で即時)  Esc: 戻る/終了
import { entryGuard } from '../play/cabinet_serial_r3_20261029.mjs';   // 出現直後の押しを捨てる保護（実機ボタンと同じ秒数。QA10/30 E）
export function primaryButtonAction(ctrl) {
  if (ctrl.phase === 'Attract') return 'start';
  if (ctrl.phase === 'Result') return 'replay';
  if (ctrl.phase === 'Fault') return 'settleFault';
  if (ctrl.phase === 'ChainChoice') return 'chainContinue';
  return 'fire';
}

export const KEY_ACTIONS = (ctrl) => ({
  Space: () => primaryButtonAction(ctrl),
  KeyC: () => (ctrl.phase === 'ChainChoice' ? 'chainStop' : 'challenge'), KeyA: () => 'add',
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
    const accepted = entryGuard(ctrl) ? false : ctrl.dispatch(action);
    onInput?.({ source: 'keyboard', action, accepted, phase }, ctrl.game);
  };
  target.addEventListener('keydown', onKey);
  const onClick = (e) => {
    const el = e.target.closest?.('[data-action]'); if (!el) return;
    const phase = ctrl.phase, action = el.dataset.action;
    wake(); const accepted = entryGuard(ctrl) ? false : ctrl.dispatch(action);
    onInput?.({ source: 'pointer', action, accepted, phase }, ctrl.game);
  };
  overlayRoot?.addEventListener('pointerdown', onClick);
  return () => { target.removeEventListener('keydown', onKey); overlayRoot?.removeEventListener('pointerdown', onClick); };
}
