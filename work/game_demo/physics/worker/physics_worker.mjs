// 物理専用 Worker（?physworker=1）。本物の PhysicsAdapter をこの中で作り、主スレッドの呼び出し列を届いた順にそのまま再生する。
// 物理の中身（Rapier・480Hz/240Hz・規則・乱数）は adapter.mjs のまま。ここは「呼び出しを順に流す」「結果を返す」だけ。
// 主スレッド側の代理は physics_proxy.mjs。やりとりの形は README.md。
import RAPIER from '../node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { PhysicsAdapter } from '../adapter.mjs';
import { observeContacts } from '../../../audio/runtime/contact_observer.mjs';
import { installRigidSyncGuard, SOURCE_PIN } from '../rigid_sync_guard.mjs';
import { createOwnedNativeQueryProof } from '../../../audio/runtime/native_contact_query.mjs';
import { warmPhysicsRuntime } from '../startup_warm_1030.mjs';
import { warmDensePhysics } from '../dense_startup_warm_1030.mjs';

const CAB = new URL('../../../cabinet/', import.meta.url);
async function readText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); }

// 1 step ごとの記録（Float64Array の 1 行）。physics_proxy.mjs の REC と同じ並び。
const REC = { g: 0, tick: 1, t: 2, skip: 3, queue: 4, tunnel: 5, dish: 6, overflow: 7, stock: 8, travel: 9, shuttle: 10, counted: 11, pl: 12, s: 13, nudges: 14, shots: 15, bStep: 16, tStep: 17, peAt: 18, refillAt: 19 };
const F = 20;

let pa = null, observer = null, g = 0, nativeQuery = false;
const guards = [], warmInfo = {};
let bStep = 0, tStep = 0, peAt = 0;   // この step で盤/皿の world.step が走ったか、皿の step を呼んだ時点の payoutExited
let contactsB = [], contactsT = [];

function wrapStep(world, mark) {   // world.step の前に印を付けるだけ（物理には触らない）。接触監視(observeContacts)はこの外側に巻かれる
  const original = world.step;
  world.step = function (...args) { mark(); return original.apply(this, args); };
}

async function init(rawOptions) {
  // 主スレッドの play.mjs が従来の経路で行う起動時の処理を、Worker の中の Rapier にも同じ順で掛ける(いずれも物理の結果は変えない)
  const { warm = {}, ...options } = rawOptions;
  await RAPIER.init();
  const adapterOptions = { ...options, readText: (p) => readText(new URL(p, CAB)), importModule: (p) => import(new URL(p, CAB).href) };
  pa = await PhysicsAdapter.create(RAPIER, adapterOptions);
  nativeQuery = !!warm.nativeQuery;
  if (warm.naturalBoardMotion) { pa.board.allowJamKick = false; pa.board.allowStuckNudge = false; }
  if (warm.startup) warmInfo.startup = warmPhysicsRuntime(RAPIER, [['tray', pa.tw], ['board', pa.bw]]);
  if (warm.dense) { try { warmInfo.dense = await warmDensePhysics(RAPIER, adapterOptions, { naturalBoardMotion: !!warm.naturalBoardMotion }); } catch (e) { warmInfo.denseError = String(e?.message ?? e); } }
  if (warm.rigidsync) {
    try {
      for (const world of [pa.bw, pa.tw]) { const guard = installRigidSyncGuard(world, RAPIER, { ownedNormalApi: true, sourceFingerprint: SOURCE_PIN, mode: 'skip' }); if (!guard.installed) { while (guards.length) guards.pop().dispose(); warmInfo.rigidsync = 'rejected:' + guard.reason; break; } guards.push(guard); }
      if (guards.length) warmInfo.rigidsync = 'on';
    } catch (e) { while (guards.length) { try { guards.pop().dispose(); } catch {} } warmInfo.rigidsync = 'error:' + String(e?.message ?? e); }
  }
  wrapStep(pa.bw, () => { bStep = 1; });
  wrapStep(pa.tw, () => { tStep = 1; peAt = pa.tray.payoutExited; });
  const T = pa.tray, B = pa.board;
  return {
    type: 'ready',
    version: RAPIER.version(), seed: pa.seed, s: pa.s, stageDir: pa.stageDir, jitter: pa.jitter, maxBalls: pa.maxBalls, muzzle: pa.muzzle, connections: pa.connections,
    transformsDocument: pa.transforms.document, stock0: pa.stock0, boardTimeScale: pa.boardTimeScale,
    tray: { S: T.S, T: T.T, hash: T.hash, floorMesh: T.floorMesh, visualStatics: T.visualStatics, visualMechs: T.visualMechs, payoutStart: T.payoutStart, mechIds: [...T.mechBodies.keys()] },
    board: { model: B.model, layout: B.layout, launcher: { ...B.launcher } },
    snap: snap(), rec: record(new Float64Array(F), 0, 0), warmInfo,
  };
}

function record(rec, i, gi) {
  const L = pa.ledger(), o = i * F;
  rec[o + REC.g] = gi; rec[o + REC.tick] = pa.tick; rec[o + REC.t] = pa.t; rec[o + REC.skip] = pa.skipPayout; rec[o + REC.queue] = L.queue; rec[o + REC.tunnel] = L.tunnel; rec[o + REC.dish] = L.dish;
  rec[o + REC.overflow] = L.overflow; rec[o + REC.stock] = L.stock; rec[o + REC.travel] = L.travel; rec[o + REC.shuttle] = L.shuttle; rec[o + REC.counted] = L.counted; rec[o + REC.pl] = pa.pendingLaunch.length;
  rec[o + REC.s] = pa.s; rec[o + REC.nudges] = pa.board.nudges; rec[o + REC.shots] = pa.shots; rec[o + REC.bStep] = bStep; rec[o + REC.tStep] = tStep; rec[o + REC.peAt] = peAt; rec[o + REC.refillAt] = pa.refillAt === null ? -1 : pa.refillAt;
  return rec;
}

// 描画用: 玉の位置・種別・id、シャトル、皿の可動部、払出筒の中の玉（tray_visual / m3 の口の手前の表示が使う）
function snap() {
  const s = pa.snapshot(), n = s.count, T = pa.tray;
  const positions = s.positions.slice(0, n * 3), kinds = s.kinds.slice(0, n);
  const payIds = [], payPrev = [];
  if (T.activePayout) for (const [id, b] of T.activeBalls) if (!b.stored && b.state === 'payout') { payIds.push(id); payPrev.push(b.prev.x, b.prev.y, b.prev.z); }
  const mechs = [];
  for (const [id, m] of T.mechBodies) { const t = m.body.translation(), r = m.body.rotation(); mechs.push([id, m.value ?? 0, t.x, t.y, t.z, r.x, r.y, r.z, r.w]); }
  return { tick: s.tick, time: s.time, shots: pa.shots, count: n, positions, kinds, ids: s.ids.slice(), shuttle: { x: s.shuttle.x, position_m: s.shuttle.position_m.slice(), hasBall: s.shuttle.hasBall },
    mech: { ...s.mech }, activePayout: T.activePayout, payIds, payPrev, mechs, payoutExited: T.payoutExited };
}

function runBatch(cmds) {
  const t0 = performance.now();
  let steps = 0; for (const c of cmds) if (c[0] === 'S') steps++;
  const rec = new Float64Array(Math.max(1, steps) * F), events = [], evG = [], cB = [], cBG = [], cT = [], cTG = [];
  let i = 0;
  for (const c of cmds) {
    switch (c[0]) {
      case 'S': {
        bStep = 0; tStep = 0; contactsB.length = 0; contactsT.length = 0;
        pa.step(); g++;
        if (g !== c[1]) throw new Error(`physworker: step order ${g} != ${c[1]}`);
        for (const e of pa.drainEvents()) { events.push(e); evG.push(g); }
        for (const x of contactsB) { cB.push(x); cBG.push(g); }
        for (const x of contactsT) { cT.push(x); cTG.push(g); }
        record(rec, i++, g);
        break;
      }
      case 'A': pa.setAim(c[1], c[2]); break;
      case 'L': pa.launch(c[1]); break;
      case 'D': pa.recall(c[1]); break;
      case 'P': pa.payout(c[1], c[2], c[3]); break;
      case 'C': pa.startCount(); break;
      case 'V': pa.reserveForLoan(c[1]); break;
      case 'B': pa.beginGame(c[1]); break;
      case 'R': pa.reset(); break;
      case 'I': pa.setInput(c[1], c[2]); break;
      case 'K': pa.stock = Math.max(0, pa.stock + c[1]); break;   // 規則側が予備球を直接足し引きする(H の無料球: 撃つ前に +1、外れて返らなければ -1)
      case 'F': pa.board.allowJamKick = !!c[1]; pa.board.allowStuckNudge = !!c[2]; break;   // naturalBoardMotion(穴の詰まりの突き・止まった玉の押しを切る)
      case 'O': if (!observer) observer = observeContacts(pa, (x) => (x.region === 'board' ? contactsB : contactsT).push(x), { nativeQueryProof: nativeQuery ? createOwnedNativeQueryProof(RAPIER, { ownedNativeReadOnly: true, sourcePin: SOURCE_PIN }) : null, onError: (e) => self.postMessage({ type: 'warn', message: 'contact observer: ' + (e?.message ?? e) }) }); break;
      default: throw new Error('physworker: unknown command ' + c[0]);
    }
  }
  const out = { type: 'batch', steps, rec, events, evG, cB, cBG, cT, cTG, snap: steps ? snap() : null, workerMs: 0 };
  out.workerMs = performance.now() - t0;
  return out;
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') self.postMessage(await init(m.options));
    else if (m.type === 'batch') {
      const out = runBatch(m.cmds), tr = [out.rec.buffer];
      if (out.snap) tr.push(out.snap.positions.buffer, out.snap.kinds.buffer);
      self.postMessage(out, tr);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `${error?.message ?? String(error)} (step ${g})`, stack: error?.stack ?? null });
  }
};
