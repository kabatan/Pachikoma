// node physics/rapid_supply_test.mjs [interval] : 一定間隔で連射したとき、発射要求から実際の射出までの待ちを測る(玉の補給が連射に追いつくか)。
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { loadPlayConfig } from '../play/config.mjs';
import { PhysicsAdapter } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const config = await loadPlayConfig(new URL('../../game_tuning/proto/config.json', import.meta.url).href, async p => readFileSync(new URL(p), 'utf8'));
export async function supply({ interval, seconds = 40, reloadSeconds, feedGap, liftSpeed, stockMax, stock0, balls = 15 }) {
  const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 7, stageDir: config.stageDir, jitter: config.jitter, boardTimeScale: 0.35, reloadSeconds, feedGap, liftSpeed, stockMax, stock0 });
  pa.beginGame(balls); pa.payout(balls, true);
  const req = new Map(), waits = []; let id = 0, next = 0, landed = 0, aim = 0;
  for (let i = 0; i < 480 * seconds; i++) {
    if (pa.t >= next && id < balls + 200) { pa.setAim(Math.sin(id * 1.7), id % 2 ? 1 : -1); id++; pa.launch(id); req.set(id, pa.t); next = pa.t + interval; }
    pa.step();
    for (const e of pa.drainEvents()) { if (e.type === 'launch') waits.push(pa.t - req.get(e.shotId)); if (e.type === 'cup') landed++; }
  }
  waits.sort((a, b) => a - b); const q = (p) => waits[Math.floor(p * (waits.length - 1))];
  return { interval, balls, reloadSeconds, feedGap, liftSpeed, stockMax, requested: id, launched: waits.length, landed, waitMean: +(waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(2), waitP90: +q(.9).toFixed(2), waitMax: +waits.at(-1).toFixed(2) };
}
if (import.meta.url === process.argv[1] || process.argv[1]?.endsWith('rapid_supply_test.mjs')) {
  const iv = Number(process.argv[2] ?? 0.6);
  for (const o of [{ balls: 40 }, { balls: 40, reloadSeconds: 0.45, feedGap: 0.45, liftSpeed: 0.25, stockMax: 9 }, { balls: 15, reloadSeconds: 0.45, feedGap: 0.45, liftSpeed: 0.25, stockMax: 9 }]) console.log(JSON.stringify(await supply({ interval: iv, ...o })));
}
