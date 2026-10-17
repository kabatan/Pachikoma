// PhysicsAdapter (hybrid_spec §12 の最終形): 盤(stage3)・皿/払出/溢れ/計数(stage1)・戻り管・射出シャトル(stage2) を m/kg/s で所有する。
//   const pa = await PhysicsAdapter.create(RAPIER, { readText, importModule, seed });
//   pa.beginGame(loanBalls)                  新しいプレイ（皿・盤を空に、貸し玉のうち STOCK0 個は昇降管の予備球）
//   pa.setAim(aim, dir)                      毎フレーム: シャトルの位置(-1..1 の三角波)と動く向き(+1=右)
//   pa.launch(shotId)                        1球発射（シャトルの球が無ければ予備球が来るまで待つ）
//   pa.payout(n, earned)                     皿へ n 球を 1 球ずつ払い出す
//   pa.startCount()                          結果演出の終わり: 計数排出口を開けて皿の玉を収納へ
//   pa.advance(dtReal)                       実時間を進める(固定 480Hz で内部ステップ)
//   pa.drainEvents()                         {type:'cup'|'lost'|'peg'|'tray_ball'|'count'|'count_done'|'overflow'|'nudge'|'feed'...}
//   pa.snapshot()                            { tick, count, positions:Float32Array(xyz,assembly座標m), kinds:Uint8Array, shuttle:{x,hasBall}, mech:{...}, tray:{...}, ledger }
// 物理: 盤・皿とも Rapier 0.21 を S=10 倍の空間で（凸包の不具合回避）。皿は重力 x 成分で傾き 0.04（床は水平）、転がり抵抗は stage1 の参照実装。
// 代用（物理でない）部分: 皿の取込ゲート〜昇降管〜シャトル補充（s1sim.py の状態機械は未移植。皿の取込口に最も近い玉を時間差で予備球へ）、
//   戻り管（PATH_RETURN をなぞる 1 次元の転がり）、収納（溢れ・計数・戻りの先は個数の台帳）。
import { Board3, S as SB } from './board3.mjs';
import { JitterBoard, normalizeJitter } from './board3_jitter.mjs';
import { Stage1Tray } from './stage1_tray.mjs';
import { loadStageTransforms } from './stage_transforms.mjs';

export const KIND = { board: 0, ret: 1, tray: 2, lift: 3, shuttle: 4 };
const HZ = 480, DT = 1 / HZ;
export const STOCK0 = 5, STOCK_MAX = 4, DISH_CAP = 125;
/** 同時発射(MaxInFlight>1)用の補給: 装填・取込を0.45秒、昇降管を0.25m/s、予備球を最大9個。0.6秒間隔の連射でも射出待ちが出ない(physics/rapid_supply_test.mjs)。 */
export const RAPID_SUPPLY = Object.freeze({ reloadSeconds: 0.45, feedGap: 0.45, liftSpeed: 0.25, stockMax: 9 });

function polyline(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])); return { pts, L, len: L[L.length - 1] }; }
function at(poly, s) {
  const { pts, L } = poly; if (s <= 0) return pts[0]; if (s >= poly.len) return pts[pts.length - 1];
  let i = 1; while (L[i] < s) i++; const u = (s - L[i - 1]) / (L[i] - L[i - 1]); const a = pts[i - 1], b = pts[i];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export class PhysicsAdapter {
  static async create(RAPIER, opts) { const pa = new PhysicsAdapter(RAPIER, opts); await pa.init(); return pa; }
  constructor(RAPIER, { readText, importModule, seed = 1, overflow = 'open', maxBalls = 700, loadTransforms = loadStageTransforms, stageDir = 'stage3', jitter = {}, boardTimeScale = 1, reloadSeconds = 1.0, feedGap = 0.9, liftSpeed = 0.09, stockMax = STOCK_MAX } = {}) {
    this.stageDir = (stageDir.startsWith('work/') ? new URL('../../' + stageDir.slice(5), import.meta.url).href : stageDir).replace(/\/$/, ''); this.jitter = normalizeJitter(jitter);
    this.loadTransforms = loadTransforms;
    this.R = RAPIER; this.readText = readText; this.importModule = importModule; this.maxBalls = maxBalls; this.overflowPolicy = overflow;
    this.seed = seed >>> 0; this.s = this.seed; this.rng = () => { this.s = (this.s + 0x6D2B79F5) >>> 0; let t = this.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.reloadSeconds = reloadSeconds; this.feedGap = feedGap; this.liftSpeed = liftSpeed; this.stockMax = stockMax;   // 連射用: 射出器の装填間隔 / 皿から昇降管への取込間隔 / 昇降管の速さ(m/s)
    this.events = []; this.acc = 0; this.tick = 0; this.boardAcc = 0; this.boardTimeScale = Math.min(1, Math.max(0.05, Number(boardTimeScale) || 1));
  }
  async init() {
    const R = this.R, J = async (p) => JSON.parse(await this.readText(p));
    const [model, layout, dims, s2, transforms] = await Promise.all([J(`${this.stageDir}/model3.json`), J(`${this.stageDir}/layout3.json`), J('dims/dims.json'), J('stage2/export/parts.json'), this.loadTransforms()]);
    this.transforms = transforms;
    this.bw = Board3.makeWorld(R, { hz: HZ });
    this.board = new JitterBoard(R, this.bw, { model, layout, dims, rng: this.rng, seed: this.seed, jitter: this.jitter, hz: HZ, launchFrame: {
      point: p => transforms.pointBetween('stage2', 'stage3', p),
      vector: p => transforms.vectorBetween('stage2', 'stage3', p),
    } });
    this.returns = new Map(); for (const t of model.phys.tubes) this.returns.set(t.n, polyline(t.pts.map((p) => [p[0], p[1], -p[2]])));
    const { RollingResistance } = await this.importModule('stage1/export/rolling_resistance.mjs');
    this.tw = new R.World({ x: -9.81 * SB * 0.04, y: -9.81 * SB, z: 0 }); this.tw.timestep = DT; this.tw.lengthUnit = 0.01 * SB;
    this.tray = new Stage1Tray(R, this.tw, { readText: (p) => this.readText('stage1/export/' + p), overflow: { type: this.overflowPolicy }, rng: this.rng, scale: SB, RollingResistance, translation_m: transforms.get('stage1').translation });
    await this.tray.load();
    const path = (id) => s2.paths.find((p) => p.id === id), drop = path('PATH_DROP');
    const dropPoints = drop.centerline_m.map((p) => [p[0] + (drop.parent ? drop.refill_shuttle_x_m ?? 0 : 0), p[1], p[2]]);
    this.liftPath = polyline([...path('PATH_LIFT').centerline_m, ...path('PATH_GUTTER').centerline_m, ...dropPoints]);
    const intake = this.tray.parts.connections.find((c) => c.id === 'SOCKET_LIFT_IN').center_m;
    const intakeAssembly = transforms.point('stage1', intake);
    const foot = transforms.point('stage2', s2.connections.find((c) => c.id === 'SOCKET_FOOT').center_m);
    this.connections = { coordinate_frame: transforms.frame, revision: transforms.revision, intake_m: intakeAssembly, lift_foot_m: foot, delta_m: foot.map((v, i) => v - intakeAssembly[i]), path_start_m: transforms.point('stage2', this.liftPath.pts[0]), physical_feed: false, physical_return: false };
    this.muzzle = s2.connections.find(c => c.id === 'SOCKET_MUZZLE').center_m;
    this.board.launcher.muzzleY = this.muzzle[1];
    this.board.launcher.depth = -this.muzzle[2];
    this.reset();
  }
  /** 状態を空にする。rules を新規プレイにするとき呼ぶ。 */
  reset() {
    this.board.clear(); for (const [id, b] of this.tray.balls) if (!b.stored) this.tray.world.removeRigidBody(b.body);
    this.board.tick = 0; this.board.nudges = 0; this.board.events.length = 0; this._lastPeg = -9999;
    this.tray.balls.clear(); this.tray.events.length = 0; this.tray.stored = { overflow: 0, count: 0 }; this.tray.payoutExited = 0; this.tray.latched.clear(); this.tray.nextBall = 0; this.tray.countOpen = false; if (this.tray.rr) { this.tray.rr.scale = 1; this.tray.rr.prev.clear(); }
    this.transit = []; this.travel = []; this.payQueue = 0; this.payRate = null; this.payTimer = 0; this.payEarned = false; this.skipPayout = 0; this.stock = 0; this.shuttleHas = false; this.refillAt = null; this.feedAt = 0;
    this.pendingLaunch = []; this.pendingAim?.clear(); this.aim = 0; this.dir = 1; this.counting = null; this.stored = { overflow: 0, count: 0, returned: 0 }; this.evIdx = 0; this.t = 0; this.tick = 0; this.acc = 0; this.boardAcc = 0; this.seq = 0; this.events = []; this.inputs = new Map(); this.dryFor = 0; this.shots = 0; this.valve = 0;
    this.tray.tick = 0; this.tray.blockSince = this.tray.idleSince = null; this.tray.ovfWant = false;
  }
  beginGame(loanBalls) { this.reset(); this.stock = STOCK0 - 1; this.shuttleHas = true; this.skipPayout = Math.min(STOCK0, loanBalls); this.stockOnTray = 0; }

  /** 追加の貸し玉: 昇降管の予備球(最大 STOCK0 個)を最初の貸しと同じく物理側へ直ちに用意し、その分は払い出しで二重に数えない。
   *  皿から昇降管を上る玉は遅く、持ち玉が尽きた直後の追加では最初の1球が6秒以上待たされる(実測)。 */
  reserveForLoan(n) {
    const have = (this.shuttleHas ? 1 : 0) + this.stock + this.travel.length;
    const k = Math.max(0, Math.min(n | 0, STOCK0 - have)); if (!k) return 0;
    let r = k; if (!this.shuttleHas) { this.shuttleHas = true; this.refillAt = null; r--; }
    this.stock += r; this.skipPayout += k; return k;
  }
  setAim(aim, dir) { this.aim = aim; this.dir = dir; }
  launch(shotId) {
    if (this.shuttleHas) this._release(shotId); else { this.pendingLaunch.push(shotId); (this.pendingAim ??= new Map()).set(shotId, { aim: this.aim, dir: this.dir }); }   // 待たされる玉は押した瞬間の狙いで出す
  }
  _release(shotId) {
    const held = this.pendingAim?.get(shotId); if (held) { this.pendingAim.delete(shotId); this.aim = held.aim; this.dir = held.dir; }
    this.board.launch(shotId, this.aim, this.dir); this.shuttleHas = false; this.shots++; this.refillAt = this.t + this.reloadSeconds;
    const delta = this.board.launchDelta;
    const event = { type: 'launch', tick: this.tick + (this._stepping ? 0 : 1), shotId, part_id: 'SOCKET_MUZZLE', x: this.transforms.point('stage2', [this.board.shuttle(this.aim, this.dir).x + delta.x, this.muzzle[1], this.muzzle[2]])[0], launchDelta: { ...delta } }; this._stamp(event); this.events.push(event);
  }
  payout(n, earned = true, rate = null) { n = Math.max(0, n | 0); if (n > 0) this.payRate = rate > 0 ? Math.min(40, rate) : (this.payQueue > 0 ? this.payRate : null); const k = Math.min(n, this.skipPayout); this.skipPayout -= k; n -= k; this.payQueue += n; this.payEarned = earned; }
  startCount() { if (this.counting) return; this.counting = { t0: this.t, emptyFor: 0, counted: 0, drainedAt: null }; this.tray.countOpen = true; if (this.tray.rr) this.tray.rr.scale = 0; }

  /** tick は次の物理刻み以降。再生入力を描画間隔から分離する。 */
  setInput(tick, input) {
    if (!Number.isInteger(tick) || tick <= this.tick) throw new Error('input tick must be in the future');
    const list = this.inputs.get(tick) ?? []; list.push({ ...input }); this.inputs.set(tick, list);
  }
  step() { this._step(); }

  advance(dtReal) { this.acc += Math.min(dtReal, 0.1); while (this.acc >= DT) { this.acc -= DT; this._step(); } }
  _step() {
    this._stepping = true;
    this.tick++; this.t = this.tick * DT;
    for (const input of this.inputs.get(this.tick) ?? []) {
      if (input.aim != null) this.setAim(input.aim, input.dir ?? this.dir);
      if (input.type === 'launch') this.launch(input.shotId);
      else if (input.type === 'payout') this.payout(input.n, input.earned);
      else if (input.type === 'count') this.startCount();
    }
    this.inputs.delete(this.tick);
    const eventStart = this.events.length;
    // 盤。boardTimeScale<1 のとき盤上の玉だけ実時間より遅く進める(物理の中身・軌跡は同一。見える時間だけ伸びる)。
    // 発射器・戻り管・皿・規則の時計は実時間のまま。
    this.boardAcc += this.boardTimeScale;
    const boardSteps = this.boardAcc >= 1 - 1e-9 ? (this.boardAcc -= 1, 1) : 0;
    if (boardSteps) this.board.step();
    for (const e of boardSteps ? this.board.drain() : []) {
      if (e.type === 'cup') { this.events.push(e); this._startTransit(e); }
      else if (e.type === 'peg') { if (this.tick - (this._lastPeg ?? -9999) > 12) { this._lastPeg = this.tick; this.events.push(e); } }
      else { if (e.type === 'lost') this.stock++; this.events.push(e); }
    }
    // 戻り管: PATH_RETURN をなぞって落ちる(1次元。回転して転がる球の加速 = 5/7 g sinθ)
    for (let i = this.transit.length - 1; i >= 0; i--) {
      const q = this.transit[i]; const a = at(q.poly, q.s), b = at(q.poly, q.s + 0.002); const ds = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; const slope = Math.max(0, -(b[1] - a[1]) / ds);
      q.v = Math.min(2.5, Math.max(0.15, q.v + (5 / 7) * 9.81 * slope * DT)); q.s += q.v * DT;
      if (q.s >= q.poly.len) { this.transit.splice(i, 1); this.stored.returned++; this.events.push({ type: 'returned', shotId: q.shotId }); }
    }
    // 皿
    this._payoutSchedule();
    this.tw.step(); this.tray.afterStep(DT);
    for (; this.evIdx < this.tray.events.length; this.evIdx++) {
      const e = this.tray.events[this.evIdx];
      if (e.sensor === 'SENSOR_PAYOUT_EXIT') this.events.push({ type: 'tray_ball', ball: e.ball, part_id: e.sensor, earned: this.payEarned });
      else if (e.sensor === 'SENSOR_RES_OVERFLOW_ENTRANCE') { this.stored.overflow++; this.events.push({ type: 'overflow', ball: e.ball, part_id: e.sensor, n: this.stored.overflow }); }
      else if (e.sensor === 'SENSOR_RES_COUNT_ENTRANCE') { this.stored.count++; if (this.counting) this.counting.counted++; }
      else if (e.sensor === 'LOST') { this.stored.overflow++; this.events.push({ type: 'tray_lost', ball: e.ball, valve: true }); }
    }
    this.tray.payoutActive = this.payQueue > 0 || this._tunnelBalls() > 0;
    if (this.evIdx > 1024) { this.tray.events.splice(0, this.evIdx); this.evIdx = 0; }
    this._feed(); this._shuttle(); this._count();
    for (let i = eventStart; i < this.events.length; i++) this._stamp(this.events[i]);
    this._stepping = false;
  }
  _startTransit(e) { const poly = this.returns.get(e.cup); if (poly) this.transit.push({ shotId: e.shotId, poly, s: 0, v: Math.min(1.5, Math.abs(e.vy) + 0.2) }); }
  _tunnelBalls() { let n = 0; for (const b of this.tray.balls.values()) if (!b.stored && b.state === 'payout') n++; return n; }
  _payoutSchedule() {
    if (this.tick % 48 === 0) this._unjam();
    if (this.payQueue <= 0) return; this.payTimer -= DT; if (this.payTimer > 0) return;
    if (this.tray.dishCount() >= DISH_CAP) { this.payQueue--; this.stored.overflow++; this.valve++; this.events.push({ type: 'overflow', n: this.stored.overflow, valve: true }); this.payTimer = 0.04; return; } // 性能の上限: 皿が満杯なら払出は直接収納へ
    const p = this.tray.payoutStart, T = this.tray;
    for (const b of T.balls.values()) { if (b.stored) continue; const t = T.pos(b.body); if (Math.hypot(t.x - p[0], t.y - p[1], t.z - p[2]) < 0.013) return; } // 出口が空くまで待つ
    T.spawnPayout(); this.payQueue--; if (this.payQueue <= 0) this.payRate = null;
    const base = this.payRate ? 1 / this.payRate : this.payQueue > 30 ? Math.max(0.04, 0.15 * 30 / this.payQueue) : 0.15; this.payTimer = base * (0.75 + 0.5 * this.rng());
  }
  // 払出トンネルの球が 4 秒動かない(山が出口をふさいだまま)なら、その球は収納へ逃がす(安全弁。件数を数える)
  _unjam() {
    for (const [id, b] of this.tray.balls) {
      if (b.stored || b.state !== 'payout') continue; const v = b.body.linvel(); const sp = Math.hypot(v.x, v.y, v.z) / SB;
      if (sp < 0.02) { b.stillSince ??= this.t; if (this.t - b.stillSince > 4) { b.stored = 'valve'; this.tray.world.removeRigidBody(b.body); this.stored.overflow++; this.valve++; this.events.push({ type: 'overflow', n: this.stored.overflow, valve: true }); } } else b.stillSince = null;
    }
  }
  // 取込ゲート〜昇降管〜シャトル(代用): 予備球が STOCK_MAX 未満なら、0.9 秒ごとに皿の取込口に最も近い玉を 1 つ昇降管へ
  _feed() {
    if (this.counting) return;
    const inPipe = this.travel.length; for (let i = this.travel.length - 1; i >= 0; i--) { const q = this.travel[i]; q.s += this.liftSpeed * DT; if (q.s >= this.liftPath.len * 0.999) { this.travel.splice(i, 1); this.stock++; } }
    if (this.t >= this.feedAt && this.stock + inPipe < this.stockMax && this.tray.dishCount() > 0) {
      const id = this.tray.takeNearestIntake(); this.feedAt = this.t + this.feedGap;
      if (id) { this.travel.push({ id, s: 0 }); this.events.push({ type: 'feed' }); }
    }
  }
  _shuttle() {
    if (this.counting) return;
    if (!this.shuttleHas && this.refillAt !== null && this.t >= this.refillAt && this.stock > 0) { this.stock--; this.shuttleHas = true; this.refillAt = null; }
    if (this.shuttleHas && this.pendingLaunch.length) this._release(this.pendingLaunch.shift());
    // 予備球も皿・払出も尽きたのに発射待ちがある(玉が溢れ収納へ落ちている)なら、収納から予備球へ戻す
    const dry = this.pendingLaunch.length && !this.shuttleHas && this.stock === 0 && this.travel.length === 0 && this.tray.dishCount() === 0 && this._tunnelBalls() === 0 && this.payQueue === 0;
    this.dryFor = dry ? (this.dryFor ?? 0) + DT : 0;
    if (this.dryFor > 1.5 && this.stored.overflow > 0) { this.stored.overflow--; this.stock++; this.dryFor = 0; this.events.push({ type: 'reserve_return' }); }
  }
  _count() {
    const c = this.counting; if (!c) return;
    const n = [...this.tray.balls.values()].filter((b) => !b.stored).length;
    if (this.payQueue === 0) c.drainedAt ??= this.t;
    if (n === 0 && this.payQueue === 0) c.emptyFor += DT; else c.emptyFor = 0;
    if (c.lastN !== c.counted) { c.lastN = c.counted; this.events.push({ type: 'count', counted: c.counted + this.stored.overflow }); }
    if (c.emptyFor > 0.5 || (c.drainedAt !== null && this.t - c.drainedAt > 8)) {
      if (n > 0) { for (const [id, b] of this.tray.balls) if (!b.stored) { b.stored = 'count'; this.tray.world.removeRigidBody(b.body); c.counted++; } }
      const counted = c.counted + this.stored.overflow + this.stock + this.travel.length + (this.shuttleHas ? 1 : 0);
      this.stored.count = counted; this.stored.overflow = 0;
      this.tray.countOpen = false; this.counting = null; this.events.push({ type: 'count_done', counted, forced: n });
      this.stock = 0; this.travel.length = 0; this.shuttleHas = false; this.refillAt = null;
    }
  }
  _stamp(e) { if (e.seq != null) return; e.tick ??= this.tick; e.seq = this.seq++; e.ball_id = e.shotId ?? e.ball ?? null; e.part_id ??= e.cup ? `CUP_${e.cup}` : e.index != null ? `COL_PIN_${e.index + 1}` : null; }
  drainEvents() { const e = this.events; for (const row of e) this._stamp(row); this.events = []; return e; }

  /** HUD の持ち玉に使う、物理側で「まだ皿に着いていない」玉(払出待ち+トンネル内)。 */
  pendingPhysical() { return this.payQueue + this._tunnelBalls(); }
  ledger() { let dish = 0; for (const b of this.tray.balls.values()) if (!b.stored && b.state !== 'payout') dish++; return { dish, tunnel: this._tunnelBalls(), queue: this.payQueue, overflow: this.stored.overflow, stock: this.stock, travel: this.travel.length, shuttle: this.shuttleHas ? 1 : 0, counted: this.stored.count }; }

  snapshot() {
    const pos = new Float32Array(this.maxBalls * 3), kind = new Uint8Array(this.maxBalls), ids = [];
    let n = 0; const put = (x, y, z, k, id) => { if (n >= this.maxBalls) return; pos[3 * n] = x; pos[3 * n + 1] = y; pos[3 * n + 2] = z; kind[n] = k; ids.push(id); n++; };
    for (const b of this.board.balls.values()) { const p = this.board.pos(b.body); put(...this.transforms.point('stage3', [p.x, p.y, p.z]), KIND.board, b.id); }
    for (const q of this.transit) { const p = at(q.poly, q.s); put(...this.transforms.point('stage3', p), KIND.ret, q.shotId); }
    for (const [id, b] of this.tray.balls) { if (b.stored) continue; const p = this.tray.pos(b.body); put(...this.transforms.point('stage1', [p.x, p.y, p.z].map((v, i) => v - this.tray.T[i])), KIND.tray, id); }
    for (const q of this.travel) { const p = at(this.liftPath, q.s); put(...this.transforms.point('stage2', p), KIND.lift, q.id); }
    const sh = this.board.shuttle(this.aim, this.dir); const shuttleAssembly = this.transforms.point('stage2', [sh.x, this.muzzle[1], this.muzzle[2]]);
    if (this.shuttleHas) put(...shuttleAssembly, KIND.shuttle, 'shuttle');
    const T = this.tray;
    return { coordinate_frame: this.transforms.frame, stage_transforms_revision: this.transforms.revision, tick: this.tick, time: this.t, count: n, positions: pos, kinds: kind, ids, shuttle: { x: shuttleAssembly[0], position_m: shuttleAssembly, hasBall: this.shuttleHas },
      mech: { overflowFlap: T.mechBodies.get('MECH_OVF_FLAP')?.value ?? 0, countFlap: T.mechBodies.get('MECH_CNT_FLAP')?.value ?? 0 }, connections: this.connections, ledger: this.ledger() };
  }
}
