// 11/1 起動修正：起動中は <video preload="auto"> の先読みを控えめ（metadata）にし、「準備完了」の後に裏で少しずつ auto へ戻す。
//   preload="auto" は最初のコマが出た後も映像ファイルを丸ごと読み続ける（約25本・数百MB）。接続6本・回線・メモリを占有して、
//   筐体データやモジュールの読み込みが後回しになり、遅い回線では起動が終わらず、メモリが小さい機種では ERR_INSUFFICIENT_RESOURCES で
//   「Failed to fetch dynamically imported module」になる恐れがあった。metadata でも loadeddata は同じ速さで届く（idle0 4.8ms・読むのは1.3MB）。
//   play() した映像はその場で auto（再生中の読みは従来どおり）。準備完了後は止まっている映像も 0.3 秒おきに1本ずつ auto へ戻し、プレイ中は従来と同じ先読みになる。画は変わらない。
//   ?bootlazy=0 で無効（従来）。?bootlazy=秒数 で再開の間隔。
const q = new URLSearchParams(globalThis.location?.search ?? '');
if (typeof window !== 'undefined' && typeof HTMLMediaElement !== 'undefined' && q.get('bootlazy') !== '0') {
  const proto = HTMLMediaElement.prototype, desc = Object.getOwnPropertyDescriptor(proto, 'preload'), play = proto.play;
  if (desc?.set && desc?.get && typeof play === 'function') {
    const held = new Set(), booted = () => !!(window.__ready || window.__startupError);
    const state = (window.__bootMediaLazy = { held: 0, released: 0, resumed: false });
    Object.defineProperty(proto, 'preload', { configurable: true, enumerable: desc.enumerable,
      get() { return held.has(this) ? 'auto' : desc.get.call(this); },
      set(v) { if (String(v) === 'auto' && !booted()) { if (!held.has(this)) { held.add(this); state.held++; } desc.set.call(this, 'metadata'); } else { held.delete(this); desc.set.call(this, v); } } });
    proto.play = function () { if (held.delete(this)) { try { desc.set.call(this, 'auto'); } catch {} } return play.apply(this, arguments); };
    const interval = Math.max(0, Number(q.get('bootlazy') && q.get('bootlazy') !== '1' ? q.get('bootlazy') : 0.3)) * 1000;
    const wait = setInterval(() => {
      if (!booted()) return;
      clearInterval(wait); state.resumed = true;
      const step = () => {
        const el = held.values().next().value;
        if (!el) return;
        held.delete(el);
        try { desc.set.call(el, 'auto'); state.released++; } catch {}
        setTimeout(step, interval);
      };
      setTimeout(step, 1000);
    }, 250);
  }
}
