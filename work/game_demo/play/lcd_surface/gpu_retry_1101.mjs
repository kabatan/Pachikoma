// 11/1 不具合修正：GPU 画像（palace / choice）が一度でも例外で failed になると、その旗が二度と戻らず CPU 経路のまま「遊ぶほど重く」なる。
// 各 GPU 画像が retryAfterFailure() を登録し、待機（attract）に戻ったときに frame_fault_boundary_1030 が runGpuRetry() で戻して再挑戦する。?gpuretry=0 で従来（戻さない）。
const hooks = new Set();
export const gpuRetryStats = { runs: 0, retried: 0 };
export function registerGpuRetry(fn) { hooks.add(fn); return () => hooks.delete(fn); }
export function runGpuRetry() {
  if (new URLSearchParams(globalThis.location?.search ?? '').get('gpuretry') === '0') return 0;
  let n = 0; gpuRetryStats.runs++;
  for (const fn of [...hooks]) { try { if (fn()) n++; } catch (e) { console.warn('[gpu-retry]', e); } }
  gpuRetryStats.retried += n; return n;
}
