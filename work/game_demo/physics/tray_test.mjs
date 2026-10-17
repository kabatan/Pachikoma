// node physics/tray_test.mjs [N=100] : 払出口から1球ずつ落として山を作る試験（皿・払出トンネル・溢れ口）。
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { Stage1Tray } from './stage1_tray.mjs';
await RAPIER.init();
const BASE = new URL('../../cabinet/stage1/export/', import.meta.url);
const readText = async (p) => readFileSync(new URL(p, BASE), 'utf8');
const SC = +(process.env.SC ?? 10);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function run({ N = 100, overflow, hz = 480, seed = 1, restS = 6 }) {
  let s = seed >>> 0; const rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const w = new RAPIER.World({ x: -9.81 * SC * (+(process.env.TILT ?? 0.04)), y: -9.81 * SC, z: 0 }); w.timestep = 1 / hz; w.lengthUnit = 0.01 * SC;
  const tray = new Stage1Tray(RAPIER, w, { readText, overflow, rng, scale: SC }); await tray.load();
  let next = 0, spawned = 0; const ms = []; let steps = 0; let lastSpawnStep = 0;
  const total = Math.round(hz * (N * 0.15 * 1.1 + 30));
  while (steps < total) {
    if (spawned < N && steps >= next) { tray.spawnPayout(); spawned++; next = steps + Math.round(hz * 0.15 * (0.75 + 0.5 * rng())); lastSpawnStep = steps; }
    const t0 = performance.now(); if (process.env.IMPULSE) tray.beforeStep(1 / hz); w.step(); tray.afterStep(1 / hz); ms.push(performance.now() - t0); steps++;
    if (spawned >= N && steps - lastSpawnStep > hz * restS && steps % hz === 0) { const c = tray.counts(); if (c.outside === 0 || steps - lastSpawnStep > hz * 25) break; }
  }
  const c = tray.counts(); const frames = []; for (let i = 0; i + 8 <= ms.length; i += 8) frames.push(ms.slice(i, i + 8).reduce((a, b) => a + b, 0));
  const dish = [...tray.balls.values()].filter((b) => !b.stored).map((b) => tray.pos(b.body));
  const T = tray.T; const inD = dish.filter((t) => t.x > tray.trayBox.x[0] && t.x < tray.trayBox.x[1] && t.z > tray.trayBox.z[0] && t.z < tray.trayBox.z[1]);
  const ext = (k, i) => inD.length ? [Math.min(...inD.map((t) => t[k])) - T[i], Math.max(...inD.map((t) => t[k])) - T[i]].map((v) => +(v * 1000).toFixed(0)) : null;
  const lostEv = tray.events.filter((e) => e.sensor === 'LOST'); const lost = lostEv.length; globalThis.lostSample = tray.events.filter((e) => e.sensor === 'FELL').slice(0, 10).map((e) => [e.ball, e.at, (tray.balls.get(e.ball).hist ?? []).slice(0, 8).map((p) => p.join(',')).join(' ')]);
  const stuckOut = [...tray.balls.values()].filter((b) => !b.stored && !(tray.pos(b.body).x > tray.trayBox.x[0] && tray.pos(b.body).x < tray.trayBox.x[1] && tray.pos(b.body).z > tray.trayBox.z[0] && tray.pos(b.body).z < tray.trayBox.z[1])).map((b) => { const t = tray.pos(b.body); return [t.x - T[0], t.y - T[1], t.z - T[2]].map((v) => Math.round(v * 1000)); });
  return { overflow: overflow.type + (overflow.n ?? ''), paid: spawned, payoutExited: tray.payoutExited, in_dish: c.inDish, resting: c.resting, outside_dish_not_stored: c.outside - 0, stored_overflow: tray.stored.overflow, stored_count: tray.stored.count, lost,
    ledger_ok: spawned === c.inDish + c.outside + tray.stored.overflow + tray.stored.count + lost, sim_s: +(steps / hz).toFixed(1), x_mm: ext('x', 0), y_mm: ext('y', 1), z_mm: ext('z', 2),
    asleep: inD.length ? [...tray.balls.values()].filter((b) => !b.stored && b.body.isSleeping()).length : 0, ms_frame_mean: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(3), ms_frame_p99: +q(frames, 0.99).toFixed(3), lostSample: globalThis.lostSample, stuckOut: stuckOut.slice(0, 6) };
}
const N = +(process.argv[2] ?? 100);
const out = [];
for (const ov of (process.env.POL ?? 'closed,open').split(',')) out.push(await run({ N, overflow: { type: ov } }));
if (!process.env.POL) out.push(await run({ N: 50, overflow: { type: 'closed' } }));
for (const r of out) console.log(JSON.stringify(r));
// 参照: stage1 の python/Bullet 試験(layout_n50_s1.json)
const ref = JSON.parse(readFileSync(new URL('layout_n50_s1.json', BASE), 'utf8'));
const rb = ref.balls.filter((b) => b.in_dish).map((b) => b.center_design_mm);
const rg = (i) => [Math.min(...rb.map((b) => b[i])), Math.max(...rb.map((b) => b[i]))].map((v) => +v.toFixed(0));
console.log('参照(n=50 の皿内の球, 設計座標mm): x', rg(0), 'y', rg(1), 'z', rg(2), 'in_dish', ref.n_in_dish);
