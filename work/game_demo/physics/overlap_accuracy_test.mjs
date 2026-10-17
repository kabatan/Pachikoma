// node physics/overlap_accuracy_test.mjs [n=120] : 同時に複数の玉が盤にあると、玉どうしがぶつかって着地の分布が変わるか。
// 同じ狙いを、(a) 1球ずつ(間隔4.2秒) (b) 0.6秒間隔で連射 で撃ち、口別の割合・平均飛行時間を比べる。
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { loadPlayConfig } from '../play/config.mjs';
import { PhysicsAdapter, RAPID_SUPPLY } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const config = await loadPlayConfig(new URL('../../game_tuning/proto/config.json', import.meta.url).href, async p => readFileSync(new URL(p), 'utf8'));
const N = +(process.argv[2] ?? 120);
async function run(aim, gap, seed) {
  const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed, stageDir: config.stageDir, jitter: config.jitter, boardTimeScale: 0.35, ...RAPID_SUPPLY });
  const lanes = Array(8).fill(0), t0 = new Map(), fl = []; let id = 0, next = 0, conc = 0, concN = 0;
  const live = new Set();
  for (let i = 0; id < N || live.size; i++) {
    if (id < N && pa.t >= next) { pa.stock = Math.max(pa.stock, 5); pa.shuttleHas = true; pa.setAim(aim, 1); id++; pa.launch(id); t0.set(id, pa.t); live.add(id); next = pa.t + gap; conc += live.size; concN++; }
    pa.step();
    for (const e of pa.drainEvents()) if (e.type === 'cup') { lanes[e.cup]++; fl.push(pa.t - t0.get(e.shotId)); live.delete(e.shotId); } else if (e.type === 'lost') live.delete(e.shotId);
    if (i > 480 * (N * gap + 60)) break;
  }
  const n = lanes.reduce((a, b) => a + b, 0);
  return { aim, gap, n, lanes: lanes.slice(1).map((v) => +(v / n * 100).toFixed(0)), meanFlight: +(fl.reduce((a, b) => a + b, 0) / fl.length).toFixed(2), meanInFlightAtLaunch: +(conc / concN).toFixed(2) };
}
const out = [];
for (const aim of [-0.6, 0, 0.5]) for (const gap of [4.2, 0.6]) { const r = await run(aim, gap, 11); out.push(r); console.log(JSON.stringify(r)); }
const tv = (a, b) => a.lanes.reduce((s, v, i) => s + Math.abs(v - b.lanes[i]), 0) / 2;
for (let k = 0; k < out.length; k += 2) console.log('aim', out[k].aim, 'total-variation lanes %', tv(out[k], out[k + 1]).toFixed(0), 'flight', out[k].meanFlight, '->', out[k + 1].meanFlight);
