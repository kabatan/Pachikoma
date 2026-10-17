// UI/入力/音/記録の動作確認用ホスト。**物理は偽物**（ランダムに口を返す）。実機の組込みは web/ 側が
// 同じ配線(createMedalApp)に本物の物理(hooks.launchBall → controller.landing)と描画(lightingInputs)を繋ぐ。
//   ?seed=N        規則の乱数seed   ?lanes=3,3,5  着地の台本(使い切ったらランダム)  ?manual  rAFではなく __medal.tick(秒) で進める
//   ?quiet         低刺激プロファイル  ?music  BGM有効  ?nolog  記録しない
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from './controller.mjs';
import { MedalPresenter } from './presenter.mjs';
import { MedalOverlay } from './overlay.mjs';
import { MedalAudio } from './audio.mjs';
import { attachInput } from './input.mjs';
import { SessionLog, Records } from './session_log.mjs';

/** 組込み用の一括配線。parent=重ねる先の要素。hooks は物理側が実装。 */
export async function createMedalApp(parent, { rulesUrl = '../rules/medal_game.json', audioBase = '../assets/audio/', fontBase = '../assets/fonts/', hooks = {}, seed, quiet = false, music = false, log = true, manual = false } = {}) {
  const rules = MedalRules.fromJson(await (await fetch(rulesUrl)).text());
  const audio = new MedalAudio(audioBase, { quiet });
  const ctrl = new MedalController({ rules, seed, hooks });
  const records = Records.load(log);
  const presenter = new MedalPresenter(ctrl, { audio, quiet, music, records });
  const overlay = new MedalOverlay(parent, { fontBase });
  const slog = new SessionLog({ enabled: log });
  presenter.onResult = (g) => { slog.write('result', { prize: g.prize, wallet: g.wallet, best: g.bestAward, maxLamps: g.maxLamps }, g); const r = Records.save(g, log); presenter.records = r; return r; };
  ctrl.onAction((a, c) => { if (a === 'start') slog.start(rules); if (a === 'fire' && c.game.shot) slog.write('shot', { id: c.game.shot.id, challenge: c.game.shot.challenge, award: c.game.shot.award, aim: c.aim }, c.game); if (a === 'add') slog.write('credit', { yen: 100 }, c.game); });
  presenter.on((kind, d, g) => { if (kind === 'receipt') slog.write('receipt', d, g); if (kind === 'phase') slog.write('phase', d, g); });
  const detach = attachInput(ctrl, { audio, overlayRoot: overlay.root });
  let last = performance.now(), raf = 0;
  const tick = (dt) => { ctrl.update(dt); presenter.update(dt); overlay.render(presenter.view()); };
  const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; tick(dt); raf = requestAnimationFrame(loop); };
  if (!manual) raf = requestAnimationFrame(loop); else tick(0);
  audio.unlock().catch(() => {}); // 自動再生制限で止まっていれば、最初の入力で再開される(attachInput)
  const app = { rules, ctrl, presenter, overlay, audio, log: slog, tick, preload: () => audio.preload(), destroy() { cancelAnimationFrame(raf); detach(); audio.dispose(); } };
  return app;
}

if (typeof document !== 'undefined' && document.body?.dataset.demo !== undefined) {
  const q = new URLSearchParams(location.search);
  const stage = document.getElementById('stage');
  const script = (q.get('lanes') ?? '').split(',').filter(Boolean).map(Number);
  let s = Number(q.get('seed') ?? 7) >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let app;
  const hooks = {
    launchBall(shot) {   // 偽の物理: 1秒後にランダムな口へ
      const lane = script.length ? script.shift() : 1 + Math.floor(rnd() * 7);
      setTimeout(() => app.ctrl.landing(shot.id, lane, true), q.has('manual') ? 0 : 1000);
    },
    cancelFlights() {},
  };
  app = await createMedalApp(stage, { hooks, seed: q.has('seed') ? Number(q.get('seed')) : undefined, quiet: q.has('quiet'), music: q.has('music'), log: !q.has('nolog'), manual: q.has('manual') });
  window.__medal = app;
  document.getElementById('start')?.addEventListener('click', async () => { await app.audio.unlock(); await app.audio.preload(); document.getElementById('start').remove(); });
}
