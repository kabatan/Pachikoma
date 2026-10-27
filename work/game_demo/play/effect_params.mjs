// ゲームのレシートを失わずに液晶へ渡す。規則や金額はここでは変更しない。
export function playEventParams(e, ranks = {}) {
  const d = e.data ?? {}, first = Object.values(e.state?.first ?? {}).some(Boolean);
  const p = { ...d, first, lit: e.state?.lit ?? 0, pockets: [...(e.state?.pockets ?? [])] };
  if (d.payout !== undefined) p.payout = d.payout;
  else if (d.award !== undefined) p.payout = d.award;
  if (d.rank !== undefined) p.rank = typeof d.rank === 'number' ? d.rank : (ranks[d.rank] ?? 0);
  const lane = d.pocket ?? d.lane;
  if (lane !== undefined) p.pocket = p.hit = lane;
  if (d.total === undefined && d.balls !== undefined && ['finish_count', 'result', 'tray_overflow'].includes(e.id)) p.total = d.balls;
  if (d.reasonCode) p.reason = d.reasonCode;
  if (e.id === 'lamp123') p.n = e.state.lit;
  if (e.id === 'roulette' && p.n_from === undefined) p.n_from = d.before?.length ?? e.state.lit;
  if (e.id === 'warn10') p.weak = e.state.balls < 6;
  return p;
}
