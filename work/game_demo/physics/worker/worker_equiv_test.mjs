// 固定の呼び出し列で、直接の PhysicsAdapter と Worker 代理(同一プロセスの擬似 Worker)の出来事・接触・払出の数え・各 step の台帳を比べる。
//   node work/game_demo/physics/worker/worker_equiv_test.mjs   (SEED=43 FRAMES=2100、DEF=1 で既定の stage3)
import { turn } from './fake_worker_env.mjs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = fileURLToPath(new URL('../../../', import.meta.url));
const RAPIER = (await import(W + 'game_demo/physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs')).default;
const { PhysicsAdapter, RAPID_SUPPLY } = await import(W + 'game_demo/physics/adapter.mjs');
const { PhysicsWorkerProxy } = await import(W + 'game_demo/physics/worker/physics_proxy.mjs');
const { observeContacts } = await import(W + 'audio/runtime/contact_observer.mjs');
await RAPIER.init();
const CAB = new URL('file://' + W + 'cabinet/');
const config = JSON.parse(readFileSync(W + 'game_tuning/proto/config.json', 'utf8'));
const SEED = +(process.env.SEED ?? 43), FRAMES = +(process.env.FRAMES ?? 2100);
const opts = process.env.DEF ? { seed: SEED } : { seed: SEED, stageDir: config.stageDir, jitter: config.jitter, ...RAPID_SUPPLY, boardTimeScale: 0.35 };
const direct = await PhysicsAdapter.create(RAPIER, { ...opts, readText: async p => readFileSync(new URL(p, CAB), 'utf8'), importModule: p => import(new URL(p, CAB).href) });
const run = { direct: { ev: [], ct: [], pay: [], led: [] }, proxy: { ev: [], ct: [], pay: [], led: [] } };
observeContacts(direct, c => run.direct.ct.push(c), { onPayout: e => run.direct.pay.push(e), onError: e => { throw e; } });
// 呼び出し列: tick ごとに決まる(出来事に反応しない)
let shot = 0;
function script(pa, f, i) {   // f: フレーム, i: フレーム内の step
  const tick = f * 8 + i;
  if (tick === 0) pa.beginGame(15);
  if (tick === 30 * 480) pa.reserveForLoan(15);
  if (tick === 2 * 480) pa.payout(40, false, 40);
  if (tick === 9 * 480) pa.payout(25, true);
  if (tick === 14 * 480) pa.payout(30, true, 12);
  const ph = (tick % 960) / 960; pa.setAim(ph < .5 ? -1 + 4 * ph : 3 - 4 * ph, ph < .5 ? 1 : -1);
  if (tick % 288 === 100 && tick < 24 * 480) pa.launch(++shot);
  if (tick === 25 * 480) pa.startCount();
  if (tick === 30 * 480 - 50) pa.reset();
  if (tick === 30 * 480 - 20) pa.beginGame(15);
  if (tick > 30 * 480 && tick % 300 === 7) pa.launch(++shot);
  if (tick === 33 * 480) pa.payout(20, true, 40);
}
// 直接
for (let f = 0; f < FRAMES; f++) for (let i = 0; i < 8; i++) {
  script(direct, f, i); direct.step(); run.direct.ev.push(...direct.drainEvents()); run.direct.led.push(JSON.stringify(direct.ledger()) + direct.skipPayout + '/' + direct.pendingLaunch.length);
}
shot = 0;
// 同じプロセスの擬似 Worker は RAPIER.init() をやり直す(WASM の作り直し)ので、直接の分を全部終えてから作る
const proxy = await PhysicsWorkerProxy.create({ ...opts, readText: () => { throw 1; } });
observeContacts(proxy, c => run.proxy.ct.push(c), { onPayout: e => run.proxy.pay.push(e), onError: e => { throw e; } });
// 代理: 1 フレーム 8 step、フレームの間に Worker の返事を待つ。release された step の台帳を記録して比べる
const origRelease = proxy._release.bind(proxy);
proxy._release = (target) => { while (proxy.recQ.length && proxy.recQ[0].r[0] <= target) { const g = proxy.recQ[0].r[0]; origRelease(g); const r = proxy.shownRec; run.proxy.led[g - 1] = JSON.stringify({ dish: r[6], tunnel: r[5], queue: r[4], overflow: r[7], stock: r[8], travel: r[9], shuttle: r[10], counted: r[11] }) + r[3] + '/' + r[12]; } };
for (let f = 0; f < FRAMES; f++) { for (let i = 0; i < 8; i++) { script(proxy, f, i); proxy.step(); run.proxy.ev.push(...proxy.drainEvents()); } await turn(); await turn(); }
for (let k = 0; k < 4; k++) { proxy.step(); run.proxy.ev.push(...proxy.drainEvents()); await turn(); await turn(); }   // 残りを出す(余分の step は比較から外す)
const n = FRAMES * 8;
const lastDirectSeq = run.direct.ev.length;
assert.deepEqual(run.proxy.ev.slice(0, lastDirectSeq), run.direct.ev, 'events');
let ledBad = 0; for (let g = 0; g < n; g++) if (run.proxy.led[g] !== run.direct.led[g]) { if (ledBad++ < 3) console.log('ledger diff at', g + 1, run.proxy.led[g], run.direct.led[g]); }
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
let ctBad = 0; const ctD = run.direct.ct, ctP = run.proxy.ct.slice(0, ctD.length);
for (let i = 0; i < ctD.length; i++) { const a = ctP[i], b = ctD[i]; const ok = a && a.t === b.t && a.region === b.region && a.material === b.material && a.a === b.a && a.b === b.b && a.variant === b.variant && close(a.speed, b.speed) && close(a.impulse, b.impulse) && close(a.x, b.x); if (!ok && ctBad++ < 3) console.log('contact diff', i, a, b); }
assert.deepEqual(run.proxy.pay.slice(0, run.direct.pay.length), run.direct.pay, 'payout notifications');
const cnt = { cup: 0, lost: 0, tray_ball: 0, count_done: 0, launch: 0 }; for (const e of run.direct.ev) if (e.type in cnt) cnt[e.type]++;
console.log(JSON.stringify({ steps: n, events: run.direct.ev.length, proxyEvents: run.proxy.ev.length, contacts: ctD.length, proxyContacts: run.proxy.ct.length, payoutNotes: run.direct.pay.length, ledgerMismatch: ledBad, contactMismatch: ctBad, counts: cnt, maxLagSteps: proxy.workerStats.maxLagSteps }));
assert.equal(ledBad, 0); assert.equal(ctBad, 0);
const mat = {}; for (const c of ctD) mat[c.region + ':' + c.material] = (mat[c.region + ':' + c.material] ?? 0) + 1; console.log(JSON.stringify(mat));
console.log('OK exact');
process.exit(0);
