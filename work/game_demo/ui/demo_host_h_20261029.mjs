// H_20261029 用の組込み配線。demo_host_g_20261028.mjs の createMedalApp と同じ配線で、規則の読込と操作を H 対応にしたもの（G／従来の規則もそのまま扱える）。
// play.mjs はこのファイルの createMedalApp と、../play/config_h_20261029.mjs の loadPlayConfig/loadPlayRules を使う。
import {loadPlayRules} from '../play/config_h_20261029.mjs';
import {MedalController as HController} from './controller_h_20261029.mjs';
import {MedalController as GController} from './controller_g_20261028.mjs';
import {attachCreditPanel} from './credit_panel_g_20261028.mjs';
import { MedalController } from './controller.mjs';
import { MedalPresenter } from './presenter.mjs';
import { MedalOverlay } from './overlay.mjs';
import { MedalAudio } from './audio.mjs';
import { attachInput } from './input.mjs';
import { SessionLog, Records } from './session_log.mjs';
import { HumanHistory } from './human_history.mjs';

/** 組込み用の一括配線。parent=重ねる先の要素。hooks は物理側が実装。 */
export async function createMedalApp(parent, { rulesUrl = '../rules/medal_game.json', audioBase = '../assets/audio/', fontBase = '../assets/fonts/', hooks = {}, seed, quiet = false, music = false, log = true, human = false, manual = false } = {}) {
  const rules = await loadPlayRules(rulesUrl,async url=>{const response=await fetch(url);if(!response.ok)throw Error(`規則HTTP ${response.status}: ${url}`);return response.text();});
  const audio = new MedalAudio(audioBase, { quiet });
  const Controller=rules.RuleVariant==='H_20261029'?HController:rules.RuleVariant==='G_20261028'?GController:MedalController;
  const ctrl = new Controller({ rules, seed, hooks });
  const records = Records.load(log);
  const presenter = new MedalPresenter(ctrl, { audio, quiet, music, records });
  const overlay = new MedalOverlay(parent, { fontBase });
  const slog = new SessionLog({ enabled: log });
  const history = human && log ? new HumanHistory() : null;
  presenter.onResult = (g) => { slog.write('result', { prize: g.prize, wallet: g.wallet, best: g.bestAward, maxLamps: g.maxLamps }, g); history?.finish(g); const r = Records.save(g, log); presenter.records = r; return r; };
  ctrl.onAction((a, c) => {
    if (a === 'howto' || a === 'start') history?.begin(c.game);
    if (a === 'start') slog.start(rules, { kind: human ? 'human' : 'simulation', playId: history?.active?.playId });
    if (a === 'fire' && c.game.shot) slog.write('shot', { id: c.game.shot.id, challenge: c.game.shot.challenge, award: c.game.shot.award, aim: c.aim }, c.game);
    if (a === 'add') slog.write('credit', { yen: 100 }, c.game);
    history?.action(a, c.game);
  });
  presenter.on((kind, d, g) => { if (kind === 'receipt') slog.write('receipt', d, g); if (kind === 'phase') slog.write('phase', d, g); history?.gameEvent(kind, d, g); });
  const onInput = (input, game) => { history?.input(input, game); if (human) slog.write('human_input', input, game); };
  const detach = attachInput(ctrl, { audio, overlayRoot: overlay.root, onInput });
  const disposeCredit=['G_20261028','H_20261029'].includes(rules.RuleVariant)?attachCreditPanel({parent,ctrl,overlay,onInput}):()=>{};
  let last = performance.now(), raf = 0;
  const tick = (dt) => { ctrl.update(dt); presenter.update(dt); overlay.render(presenter.view()); };
  const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; tick(dt); raf = requestAnimationFrame(loop); };
  if (!manual) raf = requestAnimationFrame(loop); else tick(0);
  audio.unlock().catch(() => {}); // 自動再生制限で止まっていれば、最初の入力で再開される(attachInput)
  const app = { rules, ctrl, presenter, overlay, audio, log: slog, history, onInput, tick, preload: () => audio.preload(), destroy() { cancelAnimationFrame(raf); disposeCredit(); detach(); audio.dispose(); } };
  return app;
}
