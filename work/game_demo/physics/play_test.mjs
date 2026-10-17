// node physics/play_test.mjs [seconds=60] [seed=1] : 規則+コントローラ+Presenter(externalTray)+PhysicsAdapter の通し(UIなし)。
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadPlayConfig, loadPlayRules } from '../play/config.mjs';
import { PhysicsAdapter, RAPID_SUPPLY } from './adapter.mjs';
import { MedalPhase } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { MedalPresenter } from '../ui/presenter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const args = process.argv.slice(2), configIndex = args.indexOf('--config');
const configPath = configIndex >= 0 ? args.splice(configIndex, 2)[1] : process.env.PLAY_CONFIG;
if (configIndex >= 0 && !configPath) throw new Error('--configには設定ファイルのパスが必要です');
const config = await loadPlayConfig(configPath ? (/^[a-z]+:/i.test(configPath) ? configPath : pathToFileURL(configPath).href) : null, async p => readFileSync(new URL(p), 'utf8'));
const SECS = +(args[0] ?? 60), SEED = +(args[1] ?? config.seed ?? 1);
const rules = await loadPlayRules(config.rules, async p => readFileSync(new URL(p), 'utf8'));
const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: SEED, ...(rules.MaxInFlight > 1 ? RAPID_SUPPLY : {}), stageDir:config.stageDir, jitter:config.jitter });
const log = { cups: [0, 0, 0, 0, 0, 0, 0, 0], lost: 0, peg: 0, launched: 0, nudge: 0, overflow: 0, mism: 0 };
const ctrl = new MedalController({ rules, seed: SEED, hooks: { launchBall(shot, aim, dir) { pa.setAim(aim, dir); pa.launch(shot.id); log.launched++; }, cancelFlights() { pa.reset(); } } });
const pres = new MedalPresenter(ctrl, {}); pres.externalTray = true;
const HOLD = process.env.HOLD === '1'; if (HOLD) pres.setAwardHold(true, 2);
let counted = 0, countDone = false, countStarted = false;
const DT = 1 / 60; const maxDrift = { v: 0, at: 0 }; let firstReady = null; const wallets = [];
ctrl.dispatch('start'); pa.beginGame(rules.LoanBalls);
for (let f = 0, t = 0; t < SECS; f++, t += DT) {
  ctrl.update(DT); pres.update(DT); pa.setAim(ctrl.aim, ctrl.aimDir);
  if (HOLD && pa.skipPayout > 0) { const r = pres.trayStatus().releasable; if (r > 0) pres.awardToTray(Math.min(pa.skipPayout, r)); }
  const n = pres.takePending(); if (n) { pa.payout(n, true, pres.pour.rate); log.poured = (log.poured ?? 0) + n; if (pres.pour.rate) log.rated = (log.rated ?? 0) + n; }
  if (HOLD) { const st = pres.trayStatus(); if (st.releasable > 0 && f % 90 === 0) pres.awardToTray(Math.ceil(st.releasable / 2), { rate: 12 }); }
  const g0 = ctrl.game;
  if ((g0.overlap ? g0.canAim : g0.canFire) && f % 7 === 0) { if (g0.lampCount > 0 && g0.lampCount < 6 && !g0.armed && process.env.ARM !== '0') ctrl.dispatch('challenge'); else ctrl.dispatch('fire'); }
  if (g0.canAdd && g0.wallet === 0 && g0.phase === MedalPhase.Continue) ctrl.dispatch('add');
  if (ctrl.game.phase === MedalPhase.Continue) ctrl.dispatch('finish');
  if (ctrl.game.phase === MedalPhase.Result && !countStarted) { countStarted = true; pa.startCount(); }
  pa.advance(DT);
  for (const e of pa.drainEvents()) {
    if (e.type === 'cup') { log.cups[e.cup]++; ctrl.landing(e.shotId, e.cup, true); }
    else if (e.type === 'lost') { log.lost++; ctrl.landing(e.shotId, 0, false); }
    else if (e.type === 'peg') log.peg++;
    else if (e.type === 'stuck_nudge') log.nudge++;
    else if (e.type === 'overflow') log.overflow++;
    else if (e.type === 'count') pres.setCounted(e.counted);
    else if (e.type === 'count_done') { countDone = true; pres.setCounted(e.counted); pres.countFinished(); log.countDone = e; }
  }
  pres.setDisplayWallet(Math.max(0, ctrl.game.wallet - pa.pendingPhysical()));
  const L = pa.ledger(); const phys = Object.values(L).reduce((a, b) => a + b, 0);
  const unobserved = ctrl.game.receipt && ctrl.game.receipt.id !== pres._seen ? ctrl.game.receipt.award : 0;
  const drift = phys + pres.pending + unobserved - pa.pendingLaunch.length - ctrl.game.wallet; if (Math.abs(drift) > Math.abs(maxDrift.v)) { maxDrift.v = drift; maxDrift.at = +t.toFixed(1); if (process.env.DBG && !maxDrift.dbg) { maxDrift.dbg = 1; console.error("DRIFT", f, drift, JSON.stringify({phys, L, pend: pres.pending, q: pres._queued, unobserved, pl: pa.pendingLaunch.length, w: ctrl.game.wallet})); } }
  if (f % 600 === 0) wallets.push([+t.toFixed(0), ctrl.game.phase, ctrl.game.wallet, L.dish, L.tunnel, L.queue, L.overflow, L.stock + L.shuttle, L.travel]);
  if (ctrl.game.phase === MedalPhase.Result && countDone) break;
}
assert.equal(maxDrift.v, 0, `inventory drift at ${maxDrift.at}s`);
const g = ctrl.game;
console.log(JSON.stringify({ config, pinCount:pa.board.layout.pins.length, seed:SEED, log, phase: g.phase, wallet: g.wallet, prize: g.prize, shots: g.attempts, maxLedgerDrift: maxDrift, finalLedger: pa.ledger(), tick: pa.tick, nudges: pa.board.nudges }));
console.log('t,phase,wallet,dish,tunnel,queue,overflow,stock+shuttle,travel'); for (const w of wallets) console.log(w.join(','));
