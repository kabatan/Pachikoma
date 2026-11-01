// 11/1 不具合修正：起動時に読み込んだ長寿命の <video>（時間切れ・最終結果・継続/確定の選択）は、PIPELINE_ERROR_DECODE 等で一度 error になると、
// src を読み直さない限り二度と再生できない。何度も遊ぶうちにその画面の映像が以後ずっと出なくなる。error で src を読み直して再生を戻す
// （最大3回。失敗が続けば10秒おいてもう一度。5秒再生できたら回数を戻す）。?videorevive=0 で無し（従来）。
export function reviveVideo(v, { label = 'video', max = 3, coolMs = 10000 } = {}) {
  if (!v || new URLSearchParams(globalThis.location?.search ?? '').get('videorevive') === '0') return null;
  const st = { label, tries: 0, revived: 0, failed: false, pending: false, coolAt: 0, cooldowns: 0 };
  const reload = () => {
    if (st.pending) return;
    const now = performance.now();
    if (st.failed) { if (now < st.coolAt) return; st.tries = 0; st.failed = false; st.coolAt = 0; st.cooldowns++; }
    if (st.tries >= max) {
      st.failed = true; st.coolAt = now + coolMs;
      setTimeout(() => { if (v.error) reload(); }, coolMs + 50);
      return;
    }
    const src = v.currentSrc || v.src;
    if (!src) return;
    st.tries++; st.pending = true;
    const resume = Number.isFinite(v.currentTime) ? v.currentTime : 0, was = !v.paused;
    setTimeout(() => {
      st.pending = false;
      const ok = () => {
        v.removeEventListener('loadeddata', ok); st.revived++; st.failed = false; st.coolAt = 0;
        try { if (resume > 0 && Number.isFinite(v.duration)) v.currentTime = Math.min(resume, Math.max(0, v.duration - 0.05)); } catch { /* 先頭のまま */ }
        if (was) v.play().catch(() => {});
      };
      v.addEventListener('loadeddata', ok, { once: true });
      try { v.removeAttribute('src'); v.load(); v.src = src; v.load(); } catch (e) { console.warn('[video-revive]', label, e); }
    }, 150 * st.tries);
  };
  v.addEventListener('error', reload);
  v.addEventListener('playing', () => { setTimeout(() => { if (!v.paused && !v.error) st.tries = 0; }, 5000); });
  return st;
}
