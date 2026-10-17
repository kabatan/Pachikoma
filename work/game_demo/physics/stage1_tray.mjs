// 皿ユニット(stage1)の Rapier 変換。入力は work/cabinet/stage1/export/{parts.json, col_all.obj}（読むだけ）。
//  - 静的衝突: parts.json の role=collision のうち親が TRAY_UNIT のもの → col_all.obj の凸包(単位m・設計座標) + 根の移動 = 世界座標
//  - 可動部: 親が MECH_* の衝突 → kinematic 剛体(凸包は部品原点=mech.origin_m の局所座標。体は origin+根の移動に置く)。ヒンジ(range_deg)/スライダ(stroke)を setMech で動かす
//  - センサー: parts.json の sensors(plane)を球中心の線分交差で判定。球IDごとに1回ラッチ(逆向きは別記録)
//  - 払出: PATH_PAYOUT の中心線の始点から1球ずつ落とす（トンネルの衝突を通る）
//  - 溢れ: 溢れ口の蓋(MECH_OVF_FLAP)の開閉方針を差し替え可能(下記)。蓋が開いて穴に落ち、収納入口センサーを通った玉が「溢れた」玉
//  - 再読込: reload() はファイルの SHA256 が変わったときだけ静的部を全部作り直す(玉の剛体は残す)。son11 の更新に追従する。
// 単位 m・kg・s。玉: 半径6mm、摩擦.25/反発.35（parts.json の physics）。world.lengthUnit は 0.01 にすること(盤の試験で判明)。
// Web Crypto は loopback Chromium と Node の両方で使える。
async function geometryHash(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

const mul = (q, v) => { // クォータニオン(x,y,z,w)でベクトルを回す
  const { x, y, z, w } = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const axisQuat = (axis, rad) => { const n = Math.hypot(...axis), s = Math.sin(rad / 2) / n; return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(rad / 2) }; };

export function parseObj(text) {
  const objs = new Map(); let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('o ')) { cur = line.slice(2).trim(); objs.set(cur, []); }
    else if (line.startsWith('v ') && cur) { const [, a, b, c] = line.trim().split(/\s+/); objs.get(cur).push(+a, +b, +c); }
  }
  return objs;
}

/** 溢れ蓋の方針。
 *  count: 皿の球数(途中の球を含む)が n 以上で開く(stage1 の元の方針。n 既定 50)。n は規則ではなく試験用の仮値。
 *  reach: 皿の中で静止した球が「溢れ口の手前の到達域」に積み上がったら開く（満杯数を決めず、物理で届いたら）。
 *  open:  常に開く(試験用)   closed: 常に閉じる(試験用) */
export const OVERFLOW_POLICIES = ['count', 'reach', 'open', 'closed', 'mouth'];

export class Stage1Tray {
  constructor(RAPIER, world, { readText, base = '', overflow = { type: 'open' }, rng = Math.random, scale = 10, RollingResistance = null, translation_m = null } = {}) {
    this.RollingResistanceClass = RollingResistance; this.rr = null; this.payoutActive = false; this.countOpen = false; this.countEmptySince = null; this.blockSince = null; this.idleSince = null; this.ovfWant = false;
    this.translationOverride = translation_m;
    this.S = scale; // 物理空間の倍率(m→物理単位)。Rapier の凸包は mm 級の形をメートルで作ると玉との接触が壊れる(素通り・横滑り)ため、10倍にして使う。world の重力と lengthUnit も同倍率にすること
    this.R = RAPIER; this.world = world; this.readText = readText; this.base = base; this.overflow = overflow; this.rng = rng;
    this.statics = []; this.mechBodies = new Map(); this.balls = new Map(); this.events = []; this.hash = null;
    this.mech = {}; this.sensors = []; this.latched = new Map(); this.tick = 0; this.nextBall = 0;
    this.stored = { overflow: 0, count: 0 }; this.payoutExited = 0;
  }
  async load() { return this.reload(true); }
  /** @returns {Promise<boolean>} 作り直したか */
  async reload(force = false) {
    const [pj, obj] = await Promise.all([this.readText(this.base + 'parts.json'), this.readText(this.base + 'col_all.obj')]);
    const hash = await geometryHash(pj + obj);
    if (!force && hash === this.hash) return false;
    for (const c of this.statics) this.world.removeCollider(c, false);
    for (const b of this.mechBodies.values()) this.world.removeRigidBody(b.body);
    this.statics = []; this.mechBodies.clear(); this.hash = hash;
    const parts = JSON.parse(pj); const hulls = parseObj(obj); this.parts = parts;
    const T = this.translationOverride ?? parts.roots.find((r) => r.id === 'TRAY_UNIT').transform.translation_m; this.T = T;
    const world = (v, i) => v + T[i % 3];
    const R = this.R; const mechDef = Object.fromEntries(parts.mechs.map((m) => [m.id, m]));
    for (const p of parts.parts) {
      if (p.role !== 'collision') continue;
      const raw = hulls.get(p.mesh.object); if (!raw) throw new Error('missing hull ' + p.mesh.object);
      const isStatic = p.parent === 'TRAY_UNIT'; // 可動部の凸包は可動部の原点(part.transform)基準の局所座標、静的部は設計座標
      const wp = isStatic ? raw.map(world) : raw;
      // Rapier 0.21 の convexHull は原点から離れた点群だと接触が壊れる(玉が素通りする)ため、重心を引いて setTranslation で戻す
      const c = [0, 1, 2].map((k) => { let a = 0, n = 0; for (let i = k; i < wp.length; i += 3) { a += wp[i]; n++; } return a / n; });
      const S = this.S; const pts = new Float32Array(wp.map((v, i) => (v - c[i % 3]) * S));
      const desc = R.ColliderDesc.convexHull(pts); if (!desc) throw new Error('hull failed ' + p.id);
      desc.setTranslation(c[0] * S, c[1] * S, c[2] * S);
      desc.setFriction(p.collision.friction_assumed ?? 0.25).setRestitution(p.collision.restitution_assumed ?? 0.35);
      if (p.parent === 'TRAY_UNIT') { const c2 = this.world.createCollider(desc); c2.partId = p.id; this.statics.push(c2); }
      else {
        let m = this.mechBodies.get(p.parent);
        if (!m) { const o0 = mechDef[p.parent].origin_m.map((v, i) => v + T[i]); const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(o0[0] * S, o0[1] * S, o0[2] * S)); m = { body, def: mechDef[p.parent], value: 0 }; this.mechBodies.set(p.parent, m); }
        this.world.createCollider(desc, m.body);
      }
    }
    this.sensors = parts.sensors.filter((s) => s.kind === 'plane').map((s) => ({ ...s, center: s.center_m.map((v, i) => v + T[i]), normal: s.normal }));
    // 払出の中心線(設計座標→世界)
    const path = parts.paths.find((x) => x.id === 'PATH_PAYOUT'); this.payoutStart = path.centerline_m[0].map((v, i) => v + T[i]);
    const ovf = parts.reservoir.find((r) => r.id === 'RES_OVERFLOW'); this.ovfHole = { x: ovf.hole_x_m.map((v) => v + T[0]), z: ovf.hole_z_m.map((v) => v + T[2]) };
    const cnt = parts.reservoir.find((r) => r.id === 'RES_COUNT'); this.cntHole = { x: cnt.hole_x_m.map((v) => v + T[0]), z: cnt.hole_z_m.map((v) => v + T[2]) };
    this.trayBox = { x: [-0.173 + T[0], 0.0855 + T[0]], z: [-0.140 + T[2], -0.064 + T[2]], y: [-0.30 + T[1], -0.236 + T[1]] }; // 皿の内側体積（col_all.obj の皿壁の範囲）
    for (const k of this.mechBodies.keys()) this.setMech(k, 0);
    if (this.RollingResistanceClass) { this.rr = new this.RollingResistanceClass(parts.physics, T, this.rng); for (const [id, b] of this.balls) if (!b.stored) this.rr.attach(id, b.body); }
    return true;
  }

  /** ヒンジ: value=角度(rad) / スライダ: value=変位(m)。 */
  setMech(id, value) {
    const m = this.mechBodies.get(id); if (!m) return; m.value = value; const d = m.def;
    const o = d.origin_m.map((v, i) => v + this.T[i]);
    if (d.axis) { m.body.setNextKinematicRotation(axisQuat(d.axis, value)); m.body.setNextKinematicTranslation({ x: o[0] * this.S, y: o[1] * this.S, z: o[2] * this.S }); }
    else if (d.slide_axis) m.body.setNextKinematicTranslation({ x: (o[0] + d.slide_axis[0] * value) * this.S, y: (o[1] + d.slide_axis[1] * value) * this.S, z: (o[2] + d.slide_axis[2] * value) * this.S });
  }

  /** 払出口(トンネル始点)から1球落とす。ばらつき: 位置 x±2mm z±1.5mm(parts.json の payout jitter)。 */
  spawnPayout(opts = {}) {
    const R = this.R, j = (a) => (this.rng() * 2 - 1) * a, p = this.payoutStart;
    const S = this.S;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((p[0] + j(0.002)) * S, p[1] * S, (p[2] + j(0.0015)) * S).setCcdEnabled(true));
    const f = 1 + j(0.08), e = 1 + j(0.10);
    this.world.createCollider(R.ColliderDesc.ball(0.006 * S).setDensity(7800 / S ** 3).setFriction(0.25 * f).setRestitution(Math.min(0.9, 0.35 * e)), body);
    const id = opts.id ?? `B${String(this.nextBall++).padStart(3, '0')}`;
    if (this.rr) this.rr.attach(id, body);
    this.balls.set(id, { id, body, prev: { x: p[0], y: p[1], z: p[2] }, state: 'payout' }); return id;
  }
  pos(body) { const t = body.translation(), S = this.S; return { x: t.x / S, y: t.y / S, z: t.z / S }; }
  /** 皿の中の球(中心が皿の内側体積)と、途中(トンネル内)の球。 */
  counts() {
    const b = this.trayBox; let inDish = 0, tunnel = 0, resting = 0;
    for (const x of this.balls.values()) { if (x.stored) continue; const t = this.pos(x.body); if (t.x > b.x[0] && t.x < b.x[1] && t.z > b.z[0] && t.z < b.z[1] && t.y > b.y[0] && t.y < b.y[1] + 0.03) { inDish++; if (x.body.isSleeping() || Math.hypot(...Object.values(x.body.linvel())) < 0.02 * this.S) resting++; } else tunnel++; }
    return { inDish, outside: tunnel, resting };
  }
  _overflowWantsOpen() {
    const o = this.overflow; if (o.type === 'open') return true; if (o.type === 'closed') return false;
    if (o.type === 'mouth') { // 払出口の出口が詰まった(トンネル最後の12mmに球が0.5秒動かない)ら開き、払出が終わって1秒で閉じる
      const PX = 0.0263 + this.T[0], ZB = -0.137 + this.T[2]; let blocked = false;
      for (const x of this.balls.values()) { if (x.stored || x.state !== 'payout') continue; const t = this.pos(x.body); const v = x.body.linvel();
        if (Math.abs(t.x - PX) < 0.014 && t.z > ZB - 0.012 && t.z < ZB + 0.002 && Math.hypot(v.x, v.y, v.z) < 0.02 * this.S) blocked = true; }
      const now = this.tick / (this.hz ?? 480);
      if (blocked) { this.blockSince ??= now; if (now - this.blockSince >= 0.5) this.ovfWant = true; } else this.blockSince = null;
      if (!this.payoutActive) { this.idleSince ??= now; if (now - this.idleSince >= 1.0) this.ovfWant = false; } else this.idleSince = null;
      return this.ovfWant;
    }
    const c = this.counts();
    if (o.type === 'count') return c.inDish + this._inFlightToDish() >= o.n;
    // reach: 溢れ口の手前(x±22mm, z±20mm)に、静止した球が2層以上(中心高さが床+9mm超)で届いたら開く
    const h = this.ovfHole, floor = this.floorY ?? (-0.2686 + this.T[1]); let reach = false;
    for (const x of this.balls.values()) { if (x.stored) continue; const t = this.pos(x.body); const v = x.body.linvel(); /* 物理単位/s */
      if (t.x > h.x[0] - 0.022 && t.x < h.x[1] + 0.022 && t.z > h.z[0] - 0.02 && t.z < h.z[1] + 0.02 && t.y > floor + 0.009 + 0.006 && Math.hypot(v.x, v.y, v.z) < 0.05 * this.S) reach = true; }
    return reach;
  }
  _inFlightToDish() { let n = 0; for (const x of this.balls.values()) if (!x.stored && x.state === 'payout') { const t = this.pos(x.body); if (!(t.z > this.trayBox.z[0])) n++; } return n; }

  /** 1step の前に呼ぶ。皿の傾き(床は水平のまま、重力のx成分 GRAV_TILT で取込側=-x へ)を皿の中の球に与える。 */
  beforeStep(dt) {
    const b = this.trayBox, g = this.tilt ?? 0.04, F = 0.00706 * 9.81 * this.S * g * dt;
    for (const x of this.balls.values()) { if (x.stored) continue; const t = this.pos(x.body);
      if (t.x > b.x[0] && t.x < b.x[1] && t.z > b.z[0] && t.z < b.z[1] && t.y > b.y[0] && t.y < b.y[1] + 0.03) x.body.applyImpulse({ x: -F, y: 0, z: 0 }, true); }
  }
  /** 480Hz などの固定刻みの1step後に呼ぶ。蓋の開閉・センサー・球の収納を処理。 */
  afterStep(dt) {
    this.tick++;
    // 蓋(溢れ・計数): 0.25s で 0→-90°。穴の上に沈みかけた球がいる間は閉じない(parts.json の interlock)
    this.hz = 1 / dt;
    for (const [fid, want, hole] of [['MECH_OVF_FLAP', this._overflowWantsOpen(), 'ovf'], ['MECH_CNT_FLAP', this.countOpen, 'cnt']]) {
      const m = this.mechBodies.get(fid); if (!m) continue;
      const speed = (Math.PI / 2) / 0.25 * dt; let v = m.value;
      if (want) v = Math.max(-Math.PI / 2, v - speed); else if (!this._ballOnHole(hole)) v = Math.min(0, v + speed);
      if (v !== m.value) this.setMech(fid, v);
      if (hole === 'ovf') this.flapOpen = v < -Math.PI / 4; else this.cntFlapOpen = v < -Math.PI / 4;
    }
    if (this.rr && this.tick % Math.max(1, Math.round(this.hz / 60)) === 0) this.rr.update(this.balls, 1 / 60, this.S);
    for (const [id, b] of this.balls) {
      if (b.stored) continue; const t = this.pos(b.body);
      for (const s of this.sensors) {
        const key = s.id + '|' + id; if (this.latched.has(key)) continue;
        const n = s.normal, d0 = (b.prev.x - s.center[0]) * n[0] + (b.prev.y - s.center[1]) * n[1] + (b.prev.z - s.center[2]) * n[2];
        const d1 = (t.x - s.center[0]) * n[0] + (t.y - s.center[1]) * n[1] + (t.z - s.center[2]) * n[2];
        if (d0 < 0 && d1 >= 0) {
          const k = -d0 / (d1 - d0), hx = b.prev.x + (t.x - b.prev.x) * k, hy = b.prev.y + (t.y - b.prev.y) * k, hz = b.prev.z + (t.z - b.prev.z) * k;
          const ok = s.radius_m != null ? Math.hypot(hx - s.center[0], hy - s.center[1], hz - s.center[2]) <= s.radius_m
            : Math.abs(hx - s.center[0]) <= (s.half_x_m ?? 1e9) && Math.abs(hy - s.center[1]) <= (s.half_y_m ?? 1e9);
          if (ok) { this.latched.set(key, this.tick); this.events.push({ tick: this.tick, ball: id, sensor: s.id }); this._onSensor(s.id, id, b); }
        }
      }
      if (this.tick % 24 === 0) b.last = [t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0));
      b.prev = { x: t.x, y: t.y, z: t.z };
      if (!b.fell && t.y < this.T[1] - 0.34) { b.fell = true; this.events.push({ tick: this.tick, ball: id, sensor: 'FELL', at: [t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0)), prev: b.prevLog }); }
      if (this.tick % 12 === 0) { const p = b.hist ??= []; p.push([t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0))); if (p.length > 12) p.shift(); }
      if (t.y < -0.6) { this.events.push({ tick: this.tick, ball: id, sensor: 'LOST', last: b.last }); b.stored = true; this.world.removeRigidBody(b.body); }
    }
  }
  _ballOnHole(which = 'ovf') { const h = which === 'ovf' ? this.ovfHole : this.cntHole, floor = -0.2686 + this.T[1]; for (const x of this.balls.values()) { if (x.stored) continue; const t = this.pos(x.body); if (t.x > h.x[0] && t.x < h.x[1] && t.z > h.z[0] && t.z < h.z[1] && t.y < floor + 0.012) return true; } return false; }
  /** 取込口(皿の左)に最も近い、皿の中の球を取り除いて返す(取込ゲート〜昇降の物理は未移植、台帳＋時間差で代用)。 */
  takeNearestIntake() {
    let best = null, bx = 1e9;
    for (const [id, b] of this.balls) { if (b.stored || b.state !== 'dish') continue; const t = this.pos(b.body); if (t.x > this.trayBox.x[0] && t.x < this.trayBox.x[1] && t.z > this.trayBox.z[0] && t.z < this.trayBox.z[1] && t.x < bx) { bx = t.x; best = id; } }
    if (best == null) return null; const b = this.balls.get(best); b.stored = 'feed'; this.world.removeRigidBody(b.body); this.stored.feed = (this.stored.feed ?? 0) + 1; return best;
  }
  dishCount() { let n = 0; for (const b of this.balls.values()) { if (b.stored) continue; const t = this.pos(b.body); if (t.x > this.trayBox.x[0] && t.x < this.trayBox.x[1] && t.z > this.trayBox.z[0] && t.z < this.trayBox.z[1] && t.y < this.trayBox.y[1] + 0.03) n++; } return n; }
  _onSensor(sid, id, b) {
    if (sid === 'SENSOR_PAYOUT_EXIT') { this.payoutExited++; b.state = 'dish'; }
    else if (sid === 'SENSOR_RES_OVERFLOW_ENTRANCE') { this.stored.overflow++; b.stored = 'overflow'; this.world.removeRigidBody(b.body); }
    else if (sid === 'SENSOR_RES_COUNT_ENTRANCE') { this.stored.count++; b.stored = 'count'; this.world.removeRigidBody(b.body); }
  }
}
