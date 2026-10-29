// Drives the monitor-surround RGB strip from the cabinet light script (window.__cabinetLightScript.strip, same flash layer as the 3D cabinet).
// Called once per rendered frame; allocation-free apart from the tiny serial line (<= 50/s, only on change). ?ledpreview=1 shows a swatch.
const FALLBACK = { Attract: [.1, .25, 1], Ready: [1, .1, .5], Flight: [1, .1, .5], Effect: [1, .1, .5], Meter: [1, .1, .5], Roulette: [1, .1, .5], Continue: [1, .5, .05], StaffWait: [1, .5, .05], ChainChoice: [1, .5, .05], Result: [1, .5, .05], Fault: [1, .02, .03] };

export function createLedStrip({ cabinet, getScript = () => globalThis.__cabinetLightScript, getPhase = () => 'Attract', preview = false, doc = globalThis.document } = {}) {
  const state = { r: 0, g: 0, b: 0, source: 'none', frames: 0 };
  let swatch = null, label = null, lastCss = -1;
  if (preview && doc) {
    swatch = doc.createElement('div');
    swatch.id = 'led-preview';
    swatch.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:20;width:150px;padding:6px;border-radius:6px;background:#111c;color:#fff;font:11px monospace;pointer-events:none';
    const box = doc.createElement('div'); box.style.cssText = 'height:48px;border-radius:4px;border:2px solid #555;margin-bottom:4px';
    label = doc.createElement('div'); label.textContent = 'LED帯';
    swatch.append(box, label); swatch.box = box; doc.body.append(swatch);
  }
  const q8 = v => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
  return {
    state,
    update(now) {
      const script = getScript(), s = script?.strip;
      let r, g, b;
      if (s) { r = q8(s[0]); g = q8(s[1]); b = q8(s[2]); state.source = 'script'; }
      else {   // cabinet light script off / not loaded: a plain phase colour with a slow breath, so the strip is never dead
        const f = FALLBACK[getPhase()] ?? FALLBACK.Attract, k = .55 + .35 * Math.sin(now / 1000 * 2.4);
        r = q8(f[0] * k); g = q8(f[1] * k); b = q8(f[2] * k); state.source = 'fallback';
      }
      state.r = r; state.g = g; state.b = b; state.frames++;
      cabinet?.setLed?.(r, g, b, now);
      if (swatch) {
        const key = (r << 16) | (g << 8) | b;
        if (key !== lastCss) { lastCss = key; swatch.box.style.background = `rgb(${r},${g},${b})`; label.textContent = `LED帯 ${r},${g},${b}`; }
      }
    },
  };
}
