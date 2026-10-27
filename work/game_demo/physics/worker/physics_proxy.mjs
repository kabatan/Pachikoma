// ?physworker=1 の主スレッド側: PhysicsAdapter と同じ形の代理。物理は physics_worker.mjs の中の本物の PhysicsAdapter が回す。
//   const pa = await PhysicsWorkerProxy.create(options)   // options は PhysicsAdapter.create と同じ(readText/importModule は Worker 側で作り直す)
// 呼び出し(setAim/launch/payout/startCount/reserveForLoan/beginGame/reset/setInput/step)は呼ばれた順に記録し、フレームの終わり(マイクロタスク)に
// まとめて Worker へ送る。Worker は同じ順に本物の adapter を呼ぶので、物理の入力列は主スレッドで直接呼んだときと同じになる。
// 戻り(各 step の台帳・出来事・接触、最後の描画用 snapshot)は 1 フレーム遅れて届く。出来事は step ごとに「同じ間隔だけ遅らせて」1 回ずつ順に返す。
// 主スレッドが直接読む値(台帳・skipPayout・払出待ち)は「届いた最新の step の値 + まだ届いていない自分の呼び出しの効果」で予測する。
// 詳細と既知の違いは README.md。
import { StageTransforms } from '../stage_transforms.mjs';

const HZ = 480, DT = 1 / HZ;
// physics_worker.mjs の REC と同じ並び
const REC = { g: 0, tick: 1, t: 2, skip: 3, queue: 4, tunnel: 5, dish: 6, overflow: 7, stock: 8, travel: 9, shuttle: 10, counted: 11, pl: 12, s: 13, nudges: 14, shots: 15, bStep: 16, tStep: 17, peAt: 18 };
const F = 19;

// 接触監視(audio/runtime/contact_observer.mjs)を主スレッドで「再生」するための偽の Rapier 物体。
// Worker 内の本物の監視が出した接触 1 件ごとに、同じ値が再計算されるだけの最小の物体・接触多様体を作る。
function fakeBody(handle, vx, px) {
  return { handle, _vx: vx, _px: px, _col: null,
    linvel(o) { o.x = this._vx; o.y = 0; o.z = 0; return o; }, angvel(o) { o.x = 0; o.y = 0; o.z = 0; return o; },
    translation(o = {}) { o.x = this._px; o.y = 0; o.z = 0; return o; }, rotation() { return { x: 0, y: 0, z: 0, w: 1 }; },
    isSleeping() { return false; }, isFixed() { return false; }, numColliders() { return 1; }, collider() { return this._col; } };
}
class ReplayWorld {
  constructor() { this.colliders = new Map(); this.pairs = new Map(); this.scale = 10; }
  step() {}   // 監視(observeContacts)がこれを巻く。中身は無い
  getCollider(h) { return this.colliders.get(h) ?? null; }
  contactPairsWith(col, cb) { const p = this.pairs.get(col.handle); if (p) cb(p.other); }
  contactPair(a, b, cb) {
    const p = this.pairs.get(a.handle); if (!p) return; const c = p.c, s = this.scale;
    cb({ normal(o) { o.x = 1; o.y = 0; o.z = 0; return o; }, numContacts() { return 1; }, contactImpulse() { return c.impulse * s; },
      numSolverContacts() { return 1; }, solverContactPoint(i, o) { o.x = c.x * s; o.y = 0; o.z = 0; return o; } });
  }
}
// 皿の activeBalls の代わり: get(id) は払出筒の中の玉(tray_visual / m3 の口の表示が見る)、values() は接触再生中の偽の玉
class TrayBallsView {
  constructor() { this.pay = new Map(); this.replay = []; }
  get(id) { return this.pay.get(id); }
  has(id) { return this.pay.has(id); }
  values() { return this.replay.values(); }
  get size() { return this.pay.size; }
}

export class PhysicsWorkerProxy {
  static async create(options = {}) { const p = new PhysicsWorkerProxy(); await p._init(options); return p; }

  async _init(options) {
    const plain = {}; for (const [k, v] of Object.entries(options)) if (typeof v !== 'function') plain[k] = v;   // readText/importModule/loadTransforms は Worker 側の既定を使う
    this.worker = new Worker(new URL('./physics_worker.mjs', import.meta.url), { type: 'module' });
    const ready = await new Promise((resolve, reject) => {
      this.worker.onmessage = (ev) => { if (ev.data.type === 'ready') resolve(ev.data); else if (ev.data.type === 'error') reject(new Error('physworker: ' + ev.data.message)); };
      this.worker.onerror = (ev) => reject(new Error('physworker: ' + (ev.message ?? 'worker error')));
      this.worker.postMessage({ type: 'init', options: plain });
    });
    this.worker.onmessage = (ev) => this._receive(ev.data);
    this.worker.onerror = (ev) => { this.workerStats.errors++; console.error('[physworker]', ev.message ?? ev); };
    this.isWorkerProxy = true;
    // 初期化時に一度だけ写す読み取り専用の値
    this.R = { version: () => ready.version };
    this.seed = ready.seed; this.stageDir = ready.stageDir; this.jitter = ready.jitter; this.maxBalls = ready.maxBalls; this.muzzle = ready.muzzle; this.connections = ready.connections;
    this.transforms = new StageTransforms(ready.transformsDocument); this.stock0 = ready.stock0; this.boardTimeScale = ready.boardTimeScale;
    const tr = ready.tray;
    this.trayReplay = new ReplayWorld(); this.boardReplay = new ReplayWorld();
    this.trayReplay.scale = tr.S; this.boardReplay.scale = 10;   // contact_observer の盤の倍率は 10 固定
    this.tw = this.trayReplay; this.bw = this.boardReplay;   // 本物の world は Worker の中。監視が巻く step だけを持つ
    this._twStep0 = this.tw.step; this._bwStep0 = this.bw.step;
    this.tray = { S: tr.S, T: tr.T, hash: tr.hash, floorMesh: tr.floorMesh, visualStatics: tr.visualStatics, visualMechs: tr.visualMechs, payoutStart: tr.payoutStart,
      activeBalls: new TrayBallsView(), activePayout: 0, payoutExited: 0, mechBodies: new Map(), pegOf: new Map(), isWorkerMirror: true };
    let h = 1;
    for (const id of tr.mechIds) {   // 可動部(フラップ・針)の位置と角度は snapshot ごとに写す
      const m = { value: 0, _t: { x: 0, y: 0, z: 0 }, _r: { x: 0, y: 0, z: 0, w: 1 } };
      m.body = { handle: -(h++), translation: (o) => (o ? Object.assign(o, m._t) : { ...m._t }), rotation: () => ({ ...m._r }), linvel: (o) => { o.x = 0; o.y = 0; o.z = 0; return o; }, angvel: (o) => { o.x = 0; o.y = 0; o.z = 0; return o; }, isSleeping: () => true, isFixed: () => false, numColliders: () => 0 };
      this.tray.mechBodies.set(id, m);
    }
    this.board = { model: ready.board.model, layout: ready.board.layout, launcher: ready.board.launcher, balls: new Map(), pegOf: new Map(), nudges: 0, isWorkerMirror: true };
    // 主スレッドの状態
    this.tick = 0; this.acc = 0; this.aim = 0; this.dir = 1; this._replayT = null;
    this.g = 0;            // 送った step の通し番号(beginGame/reset でも戻らない)
    this.cmds = []; this._posting = false;
    this.pending = [];     // まだ「見えて」いない自分の呼び出し {g, op, a, b}（予測に使う）
    this.recQ = [];        // 届いたがまだ見せていない step の記録
    this.shownRec = ready.rec.slice(0, F); this.shownG = 0; this.latestG = 0; this.lagK = 8;
    this.outbox = []; this._pred = null; this._observeSent = false; this._fakeH = 1 << 30;
    this._snap = ready.snap; this._applySnapMirror(ready.snap);
    this.workerStats = { batches: 0, steps: 0, workerMs: [], msgMs: [], maxLagSteps: 0, maxQueued: 0, errors: 0, warnings: 0 };
  }

  // ---- 読み値(予測込み) ----
  get t() { return this._replayT ?? this.tick * DT; }
  get s() { return this.shownRec[REC.s]; }
  get shots() { return this.shownRec[REC.shots]; }
  get skipPayout() { return this._predict().skip; }
  get payQueue() { return this._predict().queue; }
  get stock() { return this._predict().stock; }
  get shuttleHas() { return !!this._predict().shuttle; }
  get pendingLaunch() { const n = this._predict().pl; return (this._plArr && this._plArr.length === n) ? this._plArr : (this._plArr = Object.freeze(new Array(n).fill(null))); }
  ledger() { const p = this._predict(); return { dish: p.dish, tunnel: p.tunnel, queue: p.queue, overflow: p.overflow, stock: p.stock, travel: p.travel, shuttle: p.shuttle, counted: p.counted }; }
  pendingPhysical() { const p = this._predict(); return p.queue + p.tunnel; }

  _predict() {
    if (this._pred) return this._pred;
    const r = this.shownRec;
    const p = { skip: r[REC.skip], queue: r[REC.queue], tunnel: r[REC.tunnel], dish: r[REC.dish], overflow: r[REC.overflow], stock: r[REC.stock], travel: r[REC.travel], shuttle: r[REC.shuttle], counted: r[REC.counted], pl: r[REC.pl] };
    for (const c of this.pending) this._applyPred(p, c);
    return (this._pred = p);
  }
  // adapter.mjs の該当メソッドの「台帳への効果」だけを写したもの。物理で決まる変化(着地・補充など)は Worker の記録で上書きされる
  _applyPred(p, c) {
    switch (c.op) {
      case 'L': if (p.shuttle) p.shuttle = 0; else p.pl++; break;
      case 'P': { const n = Math.max(0, c.a | 0), k = Math.min(n, p.skip); p.skip -= k; p.queue += n - k; break; }
      case 'V': { const have = p.shuttle + p.stock + p.travel, k = Math.max(0, Math.min(c.a | 0, this.stock0 - have)); c.k = k; if (!k) break; let r = k; if (!p.shuttle) { p.shuttle = 1; r--; } p.stock += r; p.skip += k; break; }
      case 'R': case 'B':
        p.skip = 0; p.queue = 0; p.tunnel = 0; p.dish = 0; p.overflow = 0; p.stock = 0; p.travel = 0; p.shuttle = 0; p.counted = 0; p.pl = 0;
        if (c.op === 'B') { p.stock = this.stock0 - 1; p.shuttle = 1; p.skip = Math.min(this.stock0, c.a); }
        break;
    }
  }

  // ---- 呼び出し(記録して Worker へ) ----
  _cmd(arr, predOp = null, a = null) {
    this.cmds.push(arr);
    if (predOp) { this.pending.push({ g: this.g + 1, op: predOp, a }); this._pred = null; }
    if (!this._posting) { this._posting = true; queueMicrotask(() => this._flush()); }
  }
  setAim(aim, dir) { this.aim = aim; this.dir = dir; this._cmd(['A', aim, dir]); }
  launch(shotId) { this._cmd(['L', shotId], 'L'); }
  payout(n, earned = true, rate = null) { this._cmd(['P', n, earned, rate], 'P', n); }
  startCount() { this._cmd(['C']); }
  reserveForLoan(n) { this._cmd(['V', n], 'V', n); const c = this.pending[this.pending.length - 1]; this._predict(); return c.k ?? 0; }   // 戻り値は予測(本物の数は Worker が決める)
  beginGame(loanBalls) { this._resetLocal(); this._cmd(['B', loanBalls], 'B', loanBalls); }
  reset() { this._resetLocal(); this._cmd(['R'], 'R'); }
  _resetLocal() { this.tick = 0; this.acc = 0; this.aim = 0; this.dir = 1; }
  setInput(tick, input) {
    if (!Number.isInteger(tick) || tick <= this.tick) throw new Error('input tick must be in the future');
    this._cmd(['I', tick, { ...input }]);
  }
  advance(dtReal) { this.acc += Math.min(dtReal, 0.1); while (this.acc >= DT) { this.acc -= DT; this.step(); } }
  step() {
    if (!this._observeSent && (this.bw.step !== this._bwStep0 || this.tw.step !== this._twStep0)) { this._observeSent = true; this._cmd(['O']); }   // 音の接触監視が付いたら Worker 側でも監視を始める
    this.g++; this.tick++;
    this._cmd(['S', this.g]);
    // 届いた記録を「lagK step 遅れ」で 1 step ずつ見せる(フレームの中の出来事の間隔を保つ)。遅れて届いた分はまとめて見せる
    const target = Math.min(this.latestG, this.g - this.lagK);
    if (target > this.shownG) this._release(target);
    const lag = this.g - this.shownG; if (lag > this.workerStats.maxLagSteps) this.workerStats.maxLagSteps = lag;
  }
  drainEvents() { const e = this.outbox; this.outbox = []; return e; }

  snapshot() {
    const s = this._snap;
    return { coordinate_frame: this.transforms.frame, stage_transforms_revision: this.transforms.revision, tick: s.tick, time: s.time, count: s.count, positions: s.positions, kinds: s.kinds, ids: s.ids,
      shuttle: s.shuttle, mech: s.mech, connections: this.connections, ledger: this.ledger(), lagSteps: this.g - this.latestG };
  }
  dispose() { this.worker.terminate(); }

  // ---- 送受信 ----
  _flush() {
    this._posting = false; if (!this.cmds.length) return;
    const cmds = this.cmds; this.cmds = [];
    this.worker.postMessage({ type: 'batch', cmds });
    this.workerStats.batches++;
    const q = this.g - this.latestG; if (q > this.workerStats.maxQueued) this.workerStats.maxQueued = q;
  }
  _receive(m) {
    if (m.type === 'error') { this.workerStats.errors++; console.error('[physworker]', m.message, m.stack ?? ''); return; }
    if (m.type === 'warn') { this.workerStats.warnings++; console.warn('[physworker]', m.message); return; }
    if (m.type !== 'batch') return;
    const t0 = performance.now(), W = this.workerStats;
    if (m.steps) {
      const rec = m.rec;
      let ei = 0, bi = 0, ti = 0;
      for (let i = 0; i < m.steps; i++) {
        const r = rec.subarray(i * F, (i + 1) * F), g = r[REC.g], item = { r, events: null, cB: null, cT: null };
        while (ei < m.evG.length && m.evG[ei] === g) (item.events ??= []).push(m.events[ei++]);
        while (bi < m.cBG.length && m.cBG[bi] === g) (item.cB ??= []).push(m.cB[bi++]);
        while (ti < m.cTG.length && m.cTG[ti] === g) (item.cT ??= []).push(m.cT[ti++]);
        this.recQ.push(item);
      }
      this.latestG = rec[(m.steps - 1) * F + REC.g];
      this.lagK = m.steps;
      this._snap = m.snap; this._applySnapMirror(m.snap);
      W.steps += m.steps;
      if (W.workerMs.length < 100000) W.workerMs.push(+m.workerMs.toFixed(3));
    }
    if (W.msgMs.length < 100000) W.msgMs.push(+(performance.now() - t0).toFixed(3));
  }
  _applySnapMirror(s) {
    const T = this.tray; T.activePayout = s.activePayout;
    const pay = T.activeBalls.pay; pay.clear();
    for (let i = 0; i < s.payIds.length; i++) pay.set(s.payIds[i], { id: s.payIds[i], state: 'payout', stored: false, prev: { x: s.payPrev[3 * i], y: s.payPrev[3 * i + 1], z: s.payPrev[3 * i + 2] } });
    for (const [id, value, tx, ty, tz, rx, ry, rz, rw] of s.mechs) { const m = T.mechBodies.get(id); if (!m) continue; m.value = value; m._t.x = tx; m._t.y = ty; m._t.z = tz; m._r.x = rx; m._r.y = ry; m._r.z = rz; m._r.w = rw; }
  }
  // 記録を target まで見せる: 台帳の基準を進め、出来事を outbox へ、接触を主スレッドの監視へ再生する
  _release(target) {
    while (this.recQ.length && this.recQ[0].r[REC.g] <= target) {
      const it = this.recQ.shift(), r = it.r, g = r[REC.g];
      this.shownRec = r; this.shownG = g;
      this.board.nudges = r[REC.nudges];
      if (r[REC.bStep] || r[REC.tStep]) {
        this._replayT = r[REC.t];
        try {
          if (r[REC.bStep]) this._replayStep(this.bw, this.boardReplay, this.board, it.cB, false);
          if (r[REC.tStep]) { this.tray.payoutExited = r[REC.peAt]; this._replayStep(this.tw, this.trayReplay, this.tray, it.cT, true); }
        } finally { this._replayT = null; }
      }
      if (it.events) for (const e of it.events) this.outbox.push(e);
    }
    let k = 0; while (k < this.pending.length && this.pending[k].g <= this.shownG) k++;
    if (k) this.pending.splice(0, k);
    this._pred = null;
  }
  _replayStep(world, rw, owner, contacts, isTray) {
    if (!contacts) { world.step(); return; }   // 接触なし: 監視の前後処理(皿の払出の数え・接触の組の片付け)だけ走らせる
    rw.colliders.clear(); rw.pairs.clear(); owner.pegOf.clear();
    const fakes = isTray ? owner.activeBalls.replay : (owner.balls = new Map(), null);
    if (isTray) fakes.length = 0;
    {
      const s = rw.scale;
      for (const c of contacts) {
        // 速さ: 監視は (源の速度 − 相手の速度)·法線 / 倍率 を使う。玉どうしは両方に 1 を足して、相手の玉を「静止した玉」(quietFrames)に数えさせない
        const steel = c.material === 'steel', sb = fakeBody(++this._fakeH, c.speed * s + (steel ? 1 : 0), c.x * s), sc = { handle: ++this._fakeH, partId: undefined, parent: () => sb }; sb._col = sc;
        const add = (id, body) => { const e = { id, stored: false, state: 'dish', body }; if (isTray) fakes.push(e); else owner.balls.set(body.handle, e); };
        add(c.a, sb);
        let other;
        if (steel) { const ob = fakeBody(++this._fakeH, 1, c.x * s); other = { handle: ++this._fakeH, partId: undefined, parent: () => ob }; ob._col = other; add(c.b, ob); }
        else { other = { handle: ++this._fakeH, partId: c.material === 'brass' ? undefined : c.b, parent: () => null }; if (c.material === 'brass') owner.pegOf.set(other.handle, c.variant); }
        rw.colliders.set(sc.handle, sc); rw.colliders.set(other.handle, other); rw.pairs.set(sc.handle, { other, c });
      }
    }
    try { world.step(); }
    finally { if (isTray) fakes.length = 0; else owner.balls = new Map(); rw.colliders.clear(); rw.pairs.clear(); owner.pegOf.clear(); }
  }
}
