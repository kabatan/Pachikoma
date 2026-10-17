// Stage1 reservoir.open_rule numeric contract. Attach after Stage1Tray.load().
// Position, speed and timing use world metres / seconds; no ball-count threshold.
export function attachOverflowPolicy(tray) {
  const port = tray.parts.reservoir.find(r => r.id === 'RES_OVERFLOW');
  const rule = port.open_rule;
  if (!rule?.timing_s || !rule?.speed_m_s) throw new Error('stage1 numeric overflow contract missing');
  const z = rule.sensors_zone, T = tray.T;
  let blockSince = null, clearSince = null, want = false;
  const inside = (p, x, z) => p.x > x[0] + T[0] && p.x < x[1] + T[0] && p.z > z[0] + T[2] && p.z < z[1] + T[2];
  tray._overflowWantsOpen = function () {
    const now = this.tick / (this.hz ?? 480);
    let blocked = false, occupied = false;
    for (const b of this.balls.values()) {
      if (b.stored) continue;
      const p = this.pos(b.body), v = Math.hypot(...Object.values(b.body.linvel())) / this.S;
      if (b.state === 'payout' && inside(p, z.blocked_x_m, z.blocked_z_m) && v < rule.speed_m_s.blocked) blocked = true;
      if (b.state !== 'payout' && inside(p, z.clear_x_m, z.clear_z_m) && v < rule.speed_m_s.clear) occupied = true;
    }
    if (blocked) { blockSince ??= now; if (now - blockSince >= rule.timing_s.blocked) want = true; }
    else blockSince = null;
    if (occupied) clearSince = null;
    else { clearSince ??= now; if (want && now - clearSince >= rule.timing_s.clear) want = false; }
    return want;
  };
  tray.overflow = {type: port.default_policy};
  return {type: port.default_policy, timings: rule.timing_s, hole_x_m: port.hole_x_m, hole_z_m: port.hole_z_m};
}
