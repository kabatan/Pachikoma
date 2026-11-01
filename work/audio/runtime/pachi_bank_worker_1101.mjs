// 11/1 起動修正：玉の衝突音の下ごしらえ（5632個・159MB・主スレッドで約10秒＋のべ数秒の譲り待ち）を別スレッドで作る。
// 主スレッドの pachi_sound.mjs が結果を preparePachiContact({prefilled}) へ渡す（作る関数は同じなので音は完全に同じ）。?pachibankworker=0 で従来（主スレッドで作る）。
import { preparePachiContact } from './pachi_synth.mjs';
self.onmessage = async (e) => {
  const { sr, maxBytes } = e.data ?? {};
  try {
    const api = await preparePachiContact(sr, { yield: () => Promise.resolve(), maxBytes });
    if (!api.stats.ready) { self.postMessage({ ok: false, error: 'not-ready:' + String(api.stats.skipped ?? 'unknown') }); return; }
    const { bank, transfers } = api.exportBank();
    self.postMessage({ ok: true, bank }, transfers);
  } catch (error) { self.postMessage({ ok: false, error: String(error?.message ?? error) }); }
};
