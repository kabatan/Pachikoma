// 皿の床の転がり抵抗の参照実装（Rapier 用）。parts.json の physics.rolling_resistance / physics.floor_model を読む。
// 使い方:
//   const rr = new RollingResistance(parts.physics, T /*TRAY_UNIT の移動 m [x,y,z]*/, rng);
//   球を作ったら rr.attach(id, body);        // 角減衰の初期値と球ごとの倍率 dfac
//   固定刻みで 1/60 s ごとに rr.update(balls /*Map id->{body,stored}*/, 1/60, S /*物理倍率 10*/);
// 重力の傾き（x 成分 grav_tilt）は呼び出し側（world.gravity.x = -9.81*S*grav_tilt）。
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class RollingResistance {
  constructor(physics, T, rng = Math.random) {
    this.p = physics.rolling_resistance; this.f = physics.floor_model; this.T = T; this.rng = rng; this.dfac = new Map(); this.prev = new Map(); this.scale = 1; // scale=0 で加振（転がり抵抗を実効 0）
    this.maxDamp = 200; this.seed = 1;
  }
  randn() { let u = 0, v = 0; while (u === 0) u = this.rng(); v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  attach(id, body) { const d = Math.exp(this.p.per_ball_lognormal_sigma * this.randn()); this.dfac.set(id, d); body.setAngularDamping(this.p.base_angular_damping * d); }
  crr(x) { const p = this.p, [x0, x1] = p.ramp_x_mm; const u = clamp((x - x0) / (x1 - x0), 0, 1); return p.crr_intake_side + (p.crr_payout_side - p.crr_intake_side) * u; }
  floorY(x, z) { // 設計座標 mm
    const f = this.f; let r = 0; const d = x - f.XL;
    if (d <= f.ramp_x[0]) r = f.ramp_h[0]; else if (d >= f.ramp_x[f.ramp_x.length - 1]) r = f.ramp_h[f.ramp_h.length - 1];
    else for (let i = 0; i < f.ramp_x.length - 1; i++) if (d >= f.ramp_x[i] && d <= f.ramp_x[i + 1]) { const u = (d - f.ramp_x[i]) / (f.ramp_x[i + 1] - f.ramp_x[i]); r = f.ramp_h[i] + u * (f.ramp_h[i + 1] - f.ramp_h[i]); }
    const w = f.wave; let wv = 0;
    if (w.A !== 0) { const e = clamp((x - w.fade_x[0]) / (w.fade_x[1] - w.fade_x[0]), 0, 1) * Math.sin(Math.PI * clamp((z - f.ZB) / (f.ZF - f.ZB), 0, 1)); wv = w.A * e * Math.sin(2 * Math.PI * (x - f.XL) / w.LX + w.PH) * Math.cos(2 * Math.PI * (z - f.ZB) / w.LZ); }
    const b = f.bowl; const bw = b && b.D ? -b.D * Math.exp(-0.5 * (((x - b.xc) / b.sx) ** 2 + ((z - b.zc) / b.sz) ** 2)) : 0;
    return f.F0 + r + f.front_raise * (z - f.z_ref) / (f.ZF - f.ZB) + wv + bw;
  }
  update(balls, dt, S) {
    const f = this.f, T = this.T;
    for (const [id, b] of balls) {
      if (b.stored) continue; const t = b.body.translation();
      const x = (t.x / S - T[0]) * 1000, y = (t.y / S - T[1]) * 1000, z = (t.z / S - T[2]) * 1000;
      const inside = x >= f.XL - 1 && x <= f.XR + 1 && z > f.ZB && z <= f.ZF + f.ARC_BUL + 1;
      const hh = y - this.floorY(x, z) - f.ball_r; const q0 = this.prev.get(id); const vy = q0 ? Math.abs(y - q0[2]) / 1000 / dt : 9;
      // 床に接している球（床より 3 mm 以上下＝穴・排出路の中の球は対象外）、または球の上に載って静止的な球（落下・跳ね中でない：|vy|<0.08 m/s、高さ 3 層まで）にも転がり抵抗を与える
      const onfl = inside && hh > -3 && (hh < 0.6 || (this.p.apply_to_stacked !== false && hh < 3 * 2 * f.ball_r * 0.9 && vy < 0.08));
      let lam = 0; const q = this.prev.get(id);
      if (onfl && q) {
        const v = Math.hypot(x - q[0], z - q[1]) / 1000 / dt; const ar = this.crr(x) * (this.dfac.get(id) ?? 1) * this.scale * 9.81;
        if (v <= ar * dt) {
          const fx = (this.floorY(x + 1, z) - this.floorY(x - 1, z)) / 2, fz = (this.floorY(x, z + 1) - this.floorY(x, z - 1)) / 2;
          const asl = 9.81 * Math.hypot(f.grav_tilt + fx, fz); lam = asl > ar ? 0 : this.maxDamp;
        } else lam = Math.min(this.maxDamp, ar / v);
      }
      b.body.setLinearDamping(lam); this.prev.set(id, [x, z, y]);
    }
  }
}
