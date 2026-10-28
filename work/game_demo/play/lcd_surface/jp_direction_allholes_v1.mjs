// Data-only selection; no RNG and no changes to game outcomes.
export function matches(value, condition) {
  if (condition === null || typeof condition !== 'object') return value === condition;
  return Object.entries(condition).every(([op, n]) => ({
    eq: () => value === n, lt: () => Number.isFinite(value) && value < n,
    lte: () => Number.isFinite(value) && value <= n, gt: () => Number.isFinite(value) && value > n,
    gte: () => Number.isFinite(value) && value >= n, in: () => n.includes(value),
  }[op]?.() ?? false));
}
export function chooseDirection(table, event, context) {
  const out = {...table.defaults, matched: []};
  for (const rule of table.rules ?? []) {
    if (rule.events && !rule.events.includes(event)) continue;
    if (!Object.entries(rule.when ?? {}).every(([k, v]) => matches(context[k], v))) continue;
    Object.assign(out, rule.set); out.matched.push(rule.id);
  }
  out.text = String(out.text ?? '').replace(/\{(\w+)\}/g, (_, k) => context[k] ?? '');
  out.minHeat = Math.min(3, Math.max(0, out.minHeat | 0));
  return out;
}
export function targetDigit(p = {}, s = {}, fallback = 4) {
  const pockets = p.after ?? p.pockets ?? (Array.isArray(p.lamps) ? p.lamps : null) ?? s.pockets;
  const unlit = p.unlit && Array.isArray(p.unlit) ? p.unlit : pockets ? [1,2,3,4,5,6,7].filter(d => !pockets.includes(d)) : [];
  const explicit = p.d ?? p.target;
  return [1,2,3,4,5,6,7].includes(explicit) && (!unlit.length || unlit.includes(explicit)) ? explicit : unlit[0] ?? fallback;
}
