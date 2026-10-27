// 盤(stage3: 釘・命釘・仕切り・7口)の Rapier 世界。入力は stage3/model3.json の phys、layout3.json、dims.json の launcher。
// 座標は m。外向きの座標は窓座標(X右・Y上・Z手前、窓面 z=0、玉の中心 z≈-0.055)。tubes の pts は (x,y,d) で d=-Z。
// Rapier 0.21 の凸包は mm 級の形を m 単位で作ると玉との接触が壊れる(素通り・横滑り)ため、物理空間は S=10 倍で扱う。
//   world の重力・lengthUnit も S 倍にすること(Board3.makeWorld を使う)。
const JP_LINES = [-.08,-.12,-.16];
export const S = 10;
export const R_BALL = 0.006, RHO = 7800, G = 9.81;

export class Board3 {
  static makeWorld(RAPIER, { hz = 480 } = {}) {
    const w = new RAPIER.World({ x: 0, y: -G * S, z: 0 }); w.timestep = 1 / hz; w.lengthUnit = 0.01 * S; return w;
  }
  constructor(RAPIER, world, { model, layout, dims, rng = Math.random, hz = 480, launchFrame = null }) {
    this.launchFrame = launchFrame;
    this.R = RAPIER; this.world = world; this.rng = rng; this.hz = hz; this.model = model; this.layout = layout; this.dims = dims;
    this.allowStuckNudge = true;
    this.allowJamKick = true; this.jamKicks = 0; this.jamKickUp = 0.45; this.jamKickIn = 0; this.jamStill = 0.2;   // 穴の中の 2 球の詰まり（下の _jamKick）
    this.collisionObservers = new Set();
    this.balls = new Map(); this.events = []; this.tick = 0; this.nudges = 0; this.pegOf = new Map();
    this.queue = new RAPIER.EventQueue(true); this.sensorY = model.phys.sensors[0].y;
    this.cups = layout.cups.map((c) => ({ n: c.n, x: c.xc / 1000, w: c.mouth_width / 1000 })); this.mouthY = layout.cups[0].ym / 1000;   // 口の入口線(仕切りの上端)
    const L = dims.launcher; this.launcher = { muzzleY: L.muzzle_y_m, xRange: L.x_range_m, period: L.sweep_period_s, speed: L.speed_m_s, depth: L.muzzle_depth_m };
    this._build();
  }
  _prism(p, i) {
    const R = this.R, pts = [], A = p.A, B = p.B, seg = 20;
    for (const [c, a0] of [[A, Math.atan2(B[1] - A[1], B[0] - A[0]) + Math.PI / 2], [B, Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.PI / 2]])
      for (let k = 0; k <= seg / 2; k++) { const a = a0 + (Math.PI * k) / (seg / 2); for (const z of [-p.d0, -p.d1]) pts.push((c[0] + p.r * Math.cos(a)) * S, (c[1] + p.r * Math.sin(a)) * S, z * S); }
    const desc = R.ColliderDesc.convexHull(new Float32Array(pts)); if (!desc) throw new Error('hull failed ' + p.id);
    desc.setFriction(0.12).setRestitution(0.45);
    if (p.id.startsWith('COL_PIN_')) desc.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    const c = this.world.createCollider(desc); if (p.id.startsWith('COL_PIN_')) this.pegOf.set(c.handle, +p.id.slice(8) - 1);
  }
  _plate(pl) {
    const R = this.R, xs = pl.poly.map((q) => q[0]), ys = pl.poly.map((q) => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const faceZ = pl.face_d * -1e-3 * (Math.abs(pl.face_d) > 1 ? 1 : 1000), half = 0.01; const z = pl.side === -1 ? faceZ + half : faceZ - half;
    this.world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2 * S, (y1 - y0) / 2 * S, half * S).setTranslation((x0 + x1) / 2 * S, (y0 + y1) / 2 * S, z * S).setFriction(0.12).setRestitution(0.30));
  }
  _build() { this.model.phys.prisms.forEach((p, i) => this._prism(p, i)); this.model.phys.plates.forEach((pl) => this._plate(pl)); }

  /** シャトルの位置 x(m)・速度 vx(m/s)。aim=-1..1(三角波)、dir=+1/-1(右へ/左へ)。 */
  shuttle(aim, dir) {
    const [a, b] = this.launcher.xRange; const vx = dir * 2 * (b - a) / this.launcher.period;
    return { x: (a + b) / 2 + aim * (b - a) / 2, vx };
  }
  /** 射出: ソレノイドでピンを引き、(vx_shuttle, -0.35, 0) で落とす(stage2 SOCKET_MUZZLE)。 */
  launch(shotId, aim, dir) {
    const R = this.R, sh = this.shuttle(aim, dir), j = (a) => (this.rng() * 2 - 1) * a;
    const z = -(this.launcher.depth + j(0.0007));
    let position = [sh.x, this.launcher.muzzleY, z], velocity = [sh.vx, -this.launcher.speed, 0], angular = [j(2), j(2), j(2)];
    if (this.launchFrame) { position = this.launchFrame.point(position); velocity = this.launchFrame.vector(velocity); angular = this.launchFrame.vector(angular); }
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...position.map(v => v * S)).setLinvel(...velocity.map(v => v * S)).setAngvel({ x: angular[0], y: angular[1], z: angular[2] }).setCcdEnabled(true).setCanSleep(true));
    const col = this.world.createCollider(R.ColliderDesc.ball(R_BALL * S).setDensity(RHO / S ** 3).setFriction(0.12).setRestitution(0.45).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body);
    this.balls.set(shotId, { id: shotId, body, col, born: this.tick, still: 0, _p: { x: 0, y: 0, z: 0 }, _v: { x: 0, y: 0, z: 0 } }); this.ballOf = this.ballOf ?? new Map(); this.ballOf.set(col.handle, shotId);
    return shotId;
  }
  pos(body, out = { x: 0, y: 0, z: 0 }) { const t = body.translation(out); out.x = t.x / S; out.y = t.y / S; out.z = t.z / S; return out; }
  _cupOf(x) { let best = this.cups[0], bd = 1e9; for (const c of this.cups) { const d = Math.abs(x - c.x); if (d < bd) { bd = d; best = c; } } return best.n; }

  /** 1 刻み。events に {type:'cup', shotId, cup, x, vy} / {type:'peg', index, speed} / {type:'stuck_nudge'} / {type:'lost', shotId} を積む。 */
  step() {
    this.world.step(this.queue); this.tick++;
    this.queue.drainCollisionEvents((h1, h2, started) => {
      for (const observer of this.collisionObservers) observer(h1, h2, started);
      if (!started) return; const pin = this.pegOf.get(h1) ?? this.pegOf.get(h2); if (pin === undefined) return;
      const sid = this.ballOf?.get(h1) ?? this.ballOf?.get(h2); const b = this.balls.get(sid); if (!b) return; const v = b.body.linvel(b._v);
      this.events.push({ type: 'peg', index: pin, speed: Math.hypot(v.x, v.y, v.z) / S, shotId: sid });
    });
    for (const [id, b] of this.balls) {
      const p = this.pos(b.body, b._p);
      for (let level=0;level<3;level++) if (p.y <= JP_LINES[level] && !(b.jpLines & (1 << level))) {
        const y=JP_LINES[level];
        b.jpLines = (b.jpLines ?? 0) | (1 << level);
        this.events.push({ type: 'jp_line', shotId: id, level, y, x: p.x, vx: b.body.linvel(b._v).x / S });
      }
      if (b.approach === undefined && p.y <= this.mouthY) {
        b.approach = { cup: this._cupOf(p.x), x: p.x };
        this.events.push({type:'jp_mouth',shotId:id,cup:b.approach.cup,x:p.x});
      }   // 入口線を通過した時の位置(惜しい判定: R-22)
      if (p.y < this.sensorY) { const v = b.body.linvel(b._v); const cup = this._cupOf(p.x), ap = b.approach ?? { cup, x: p.x }; this.events.push({ type: 'cup', shotId: id, cup, x: p.x, vy: v.y / S, approachCup: ap.cup, approachX: ap.x, crossed: ap.cup !== cup }); this._remove(id); continue; }
      if (p.y < -0.3 || (this.tick - b.born) / this.hz > 60) { this.events.push({ type: 'lost', shotId: id, at: [p.x, p.y, p.z] }); this._remove(id); continue; }
      // 山の頂点の釣り合い: 口の高さより上で 1.5 秒ほぼ静止していたら微小な横インパルス（実機では不安定平衡）
      if (this.tick % 8 === 0) {
        const v = b.body.linvel(b._v); const sp = Math.hypot(v.x, v.y, v.z) / S;
        if (sp < 0.01) b.still += 8 / this.hz; else b.still = 0;
        if (this.allowStuckNudge && b.still > 1.5) { b.still = 0; this.nudges++; const m = 0.007057, dv = 0.02 * (this.rng() < 0.5 ? -1 : 1); b.body.applyImpulse({ x: m * dv * S, y: 0, z: 0 }, true); this.events.push({ type: 'stuck_nudge', shotId: id }); }
      }
    }
    if (this.allowJamKick && this.tick % 8 === 0) this._jamKick();
  }
  /** 穴の中の 2 球の詰まり（R3-G 10/21）：口の幅 28mm（球 2 個ぶん）から 45° の漏斗で喉 14mm へ絞る穴に、2 球が並んで入ると、
   *  側の壁と漏斗の角で互いを壁へ押し付けて止まる（2 球のアーチ。摩擦が無くても釣り合う。stuck_nudge の 0.02m/s では外れない）。
   *  口の線より下で 0.2 秒ほぼ止まっている球が同じ穴に 2 つあれば、上の方を真上へ 0.45m/s 突く（穴の部品の小さなソレノイド。力積 3.2mN·s）。
   *  2 球を口の上から並べて落とす試し（jam2/jam_probe.mjs、太い穴 5 つ×288 通り）で詰まり 0、通るまで最長 0.68 秒（突きなしは約 8% が詰まる）。
   *  詰まっていない時は何もしない（乱数も使わない）。 */
  _jamKick() {
    const dt = 8 / this.hz, still = [];
    for (const [id, b] of this.balls) {
      const p = this.pos(b.body, b._p); if (p.y >= this.mouthY - 0.001) { b.jam = 0; continue; }
      const v = b.body.linvel(b._v); b.jam = Math.hypot(v.x, v.y, v.z) / S < 0.02 ? (b.jam ?? 0) + dt : 0;
      if (b.jam > this.jamStill) still.push({ id, b, x: p.x, y: p.y, cup: this._cupOf(p.x) });
    }
    for (const s of still) {
      const o = still.find((q) => q !== s && q.cup === s.cup); if (!o || s.y < o.y || (s.y === o.y && s.id < o.id)) continue;
      const c = this.cups.find((q) => q.n === s.cup), m = 0.007057, sx = s.x > c.x ? -1 : 1;
      s.b.body.applyImpulse({ x: m * this.jamKickIn * sx * S, y: m * this.jamKickUp * S, z: 0 }, true); s.b.jam = 0; o.b.jam = 0; this.jamKicks++;
      this.events.push({ type: 'jam_kick', shotId: s.id, cup: s.cup, other: o.id });
    }
  }
  _remove(id) { const b = this.balls.get(id); this.ballOf?.delete(b.col.handle); this.world.removeRigidBody(b.body); this.balls.delete(id); }
  clear() { for (const id of [...this.balls.keys()]) this._remove(id); }
  drain() { const e = this.events; this.events = []; return e; }
}
