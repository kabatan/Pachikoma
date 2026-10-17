// キー/ポインタ入力 → controller.dispatch。キーリピートは無視。最初の入力で音声を unlock する。
// Space: 開始(待機)/1球発射  C: Challenge  A: 100円追加  B: 計数(確認後に確定)  R: 次のお客さま(結果から)  Esc: 戻る/終了
export const KEY_ACTIONS = (ctrl) => ({
  Space: () => (ctrl.phase === 'Attract' ? 'start' : 'fire'),
  KeyC: () => 'challenge', KeyA: () => 'add',
  KeyB: () => (ctrl.confirmFinish ? 'confirmFinish' : 'finish'),
  KeyR: () => 'reset',
  Escape: () => (ctrl.confirmFinish ? 'cancelFinish' : 'quit'),
});

export function attachInput(ctrl, { target = window, audio = null, overlayRoot = null } = {}) {
  const map = KEY_ACTIONS(ctrl);
  const wake = () => { audio?.unlock?.(); };
  const onKey = (e) => {
    if (e.repeat || !(e.code in map)) return;
    e.preventDefault(); wake();
    if (ctrl.phase === 'Fault' && e.code === 'Space') { ctrl.dispatch('settleFault'); return; }
    ctrl.dispatch(map[e.code]());
  };
  target.addEventListener('keydown', onKey);
  const onClick = (e) => {
    const el = e.target.closest?.('[data-action]'); if (!el) return;
    wake(); ctrl.dispatch(el.dataset.action);
  };
  overlayRoot?.addEventListener('pointerdown', onClick);
  return () => { target.removeEventListener('keydown', onKey); overlayRoot?.removeEventListener('pointerdown', onClick); };
}
