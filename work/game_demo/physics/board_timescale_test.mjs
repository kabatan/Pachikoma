// node physics/board_timescale_test.mjs : boardTimeScale=k は玉の軌跡を変えず、見える時間だけ 1/k に伸ばす。
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { loadPlayConfig } from '../play/config.mjs';
import { PhysicsAdapter } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const config = await loadPlayConfig(new URL('../../game_tuning/proto/config.json', import.meta.url).href, async p => readFileSync(new URL(p), 'utf8'));
async function run(scale, N = 40) {
  const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 7, stageDir: config.stageDir, jitter: config.jitter, boardTimeScale: scale });
  pa.beginGame(15); const t0 = new Map(), res = []; let id = 0, rng = 12345; const r = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const gap = Math.round(480 * 6);
  for (let step = 0; step < gap * N; step++) {
    if (step % gap === 0 && id < N) { pa.stock = Math.max(pa.stock, 5); pa.shuttleHas = true; pa.setAim(r() * 2 - 1, r() < .5 ? 1 : -1); id++; pa.launch(id); t0.set(id, pa.t); }
    pa.step();
    for (const e of pa.drainEvents()) if (e.type === 'cup') res.push({ id: e.shotId, cup: e.cup, d: pa.t - t0.get(e.shotId) });
  }
  return res;
}
const a = await run(1), b = await run(0.35);
assert.equal(a.length, 40); assert.equal(b.length, 40);
assert.deepEqual(a.map(x => x.cup), b.map(x => x.cup), '入賞口は同じ');
const mean = (r) => r.reduce((s, x) => s + x.d, 0) / r.length, ratio = mean(b) / mean(a);
assert.ok(Math.abs(ratio - 1 / 0.35) < 0.08, 'ratio ' + ratio);
console.log(`PASS board time scale: same cups, flight ${mean(a).toFixed(2)}s -> ${mean(b).toFixed(2)}s (x${ratio.toFixed(2)})`);
