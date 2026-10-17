// node physics/stress_test.mjs [N=300] [policy=mouth] : 払出 N 球→溢れ→計数排出 の通し（規則なし）と1フレーム(8step)時間。
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { PhysicsAdapter } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url); const N = +(process.argv[2] ?? 300), POL = process.argv[3] ?? 'mouth';
const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 5, overflow: POL });
pa.beginGame(18); pa.payout(N, true);
const ms = []; let t = 0; const ev = { count: 0, overflow: 0, tray_ball: 0 };
const frame = () => { const t0 = performance.now(); pa.advance(1 / 60); ms.push(performance.now() - t0); t += 1 / 60; for (const e of pa.drainEvents()) { if (ev[e.type] !== undefined) ev[e.type]++; if (e.type === 'count_done') ev.done = e; } };
while (t < N * 0.15 + 40 && (pa.payQueue > 0 || pa._tunnelBalls() > 0 || t < 5)) frame();
const settle = t; for (let i = 0; i < 60 * 8; i++) frame();
const L1 = pa.ledger(); const spawnMs = ms.slice(); 
pa.startCount(); let tc = 0; while (pa.counting && tc < 40) { frame(); tc += 1 / 60; }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(JSON.stringify({ N, POL, payout_done_s: +settle.toFixed(1), ledger_before_count: L1, count_s: +tc.toFixed(1), ev, ledger_after: pa.ledger(), frame_ms_mean: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), frame_ms_p99: +q(ms, 0.99).toFixed(2), frame_ms_max: +Math.max(...ms).toFixed(1) }));
