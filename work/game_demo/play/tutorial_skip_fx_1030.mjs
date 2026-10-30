// 10/30 説明の長押しスキップの「音」と「囲いの電飾」。ゲージの絵は lcd_surface/tutorial_skip_overlay_1030.mjs。
//  音: 押している間は上昇音(約1秒で満ちる)、離したら止め、満ちきったら確定音(短い上昇アルペジオ＋空気の抜ける音)。
//  電飾: 押している間、左ボタンのあたり(囲いの左下区画 idx4、下 idx7 は半分、左上 idx3 はわずか)を白く光らせ、満ちるほど強く。確定で全体が一瞬白く閃く。
//  cabinet_light_script の after フックを、他の使い手(staff_call_1030 の呼び出し中の点滅)と共存する形で使う。
//  ?tutskipfx=0 で音と電飾だけ無効(ゲージと長押しは残る)。
export function attachTutorialSkipFx({ ctrl, getEngine, query = new URLSearchParams(globalThis.location?.search ?? '') }) {
  if (query.get('tutskipfx') === '0') return { dispose() {} };
  let raf = 0, tone = null, wasCompleting = false, disposed = false;
  const engine = () => { try { return getEngine?.(); } catch { return null; } };
  function startTone(e) {
    const ctx = e.ctx; if (!ctx || ctx.state !== 'running') return null;
    const now = ctx.currentTime, osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    osc.type = 'triangle'; osc2.type = 'sine'; lp.type = 'lowpass'; lp.frequency.value = 3200;
    const T = ctrl.tutSkipHoldSeconds;
    osc.frequency.setValueAtTime(260, now); osc.frequency.exponentialRampToValueAtTime(1040, now + T);
    osc2.frequency.setValueAtTime(520, now); osc2.frequency.exponentialRampToValueAtTime(2080, now + T);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(.07, now + .05); g.gain.linearRampToValueAtTime(.16, now + T);
    const g2 = ctx.createGain(); g2.gain.value = .35; osc2.connect(g2).connect(g); osc.connect(g); g.connect(lp).connect(e.mix ?? e.master ?? ctx.destination);
    osc.start(now); osc2.start(now);
    return { ctx, osc, osc2, g };
  }
  function stopTone(fade = .06) {
    const t = tone; tone = null; if (!t) return; const now = t.ctx.currentTime;
    try { t.g.gain.cancelScheduledValues(now); t.g.gain.setValueAtTime(t.g.gain.value, now); t.g.gain.linearRampToValueAtTime(0, now + fade); t.osc.stop(now + fade + .02); t.osc2.stop(now + fade + .02); } catch { /* 止まっていれば何もしない */ }
  }
  function confirmSound(e) {
    const ctx = e.ctx; if (!ctx || ctx.state !== 'running') return; const now = ctx.currentTime, out = e.mix ?? e.master ?? ctx.destination;
    [1046.5, 1568, 2093, 3136].forEach((f, i) => {   // C6 G6 C7 G7 の短い上昇
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), t0 = now + i * .045;
      o.type = 'square'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.09, t0 + .006); g.gain.exponentialRampToValueAtTime(.0008, t0 + .32);
      const g2 = ctx.createGain(); g2.gain.value = .3; o2.connect(g2).connect(g); o.connect(g); g.connect(out); o.start(t0); o2.start(t0); o.stop(t0 + .34); o2.stop(t0 + .34);
    });
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .25), ctx.sampleRate), d = n.getChannelData(0);   // しゅわっと抜ける空気音
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), gn = ctx.createGain(); s.buffer = n; bp.type = 'highpass'; bp.frequency.value = 4200; gn.gain.value = .12;
    s.connect(bp).connect(gn).connect(out); s.start(now);
  }
  function tick() {
    if (disposed) return; raf = requestAnimationFrame(tick);
    const u = ctrl.tutSkip, e = engine();
    if (e) {
      if (u.holding && !tone) tone = startTone(e);
      else if (!u.holding && tone) stopTone(u.completing > 0 ? .02 : .06);
      if (u.completing > 0 && !wasCompleting) confirmSound(e);
    }
    wasCompleting = u.completing > 0;
  }
  raf = requestAnimationFrame(tick);

  // ---- 囲いの電飾 ----
  let userAfter = null;
  const active = () => ctrl.tutSkipEnabled && !!ctrl.howto && (ctrl.tutSkip.level > 0.01 || ctrl.tutSkip.flash > 0);
  function mine(row, strip) {
    const u = ctrl.tutSkip, lv = Math.min(1, u.level), fl = u.flash;
    const gains = [[4, 1], [7, .55], [3, .3]];
    for (const [i, w] of gains) {
      const k = Math.min(1.9, Math.max(row.K[i], (.25 + 1.35 * lv) * w + 1.2 * fl)), c = row.Kc[i];
      const tint = .12 * (1 - lv);   // 満ちるほど真っ白に(最初はわずかに青白い)
      row.K[i] = k; c[0] = 1 - tint; c[1] = 1 - tint * .5; c[2] = 1;
      for (const key of ['wash', 'zone']) { const q = row[key][i]; q[0] = c[0] * k * .42; q[1] = c[1] * k * .42; q[2] = c[2] * k * .42; }
    }
    if (fl > 0) for (let i = 0; i < 8; i++) { row.K[i] = Math.min(1.9, row.K[i] + fl * 1.1); const c = row.Kc[i]; c[0] += (1 - c[0]) * fl; c[1] += (1 - c[1]) * fl; c[2] += (1 - c[2]) * fl; }
    if (strip) { strip[0] = Math.max(strip[0], lv + fl); strip[1] = Math.max(strip[1], lv + fl); strip[2] = Math.max(strip[2], lv + fl); }
  }
  const composed = (row, strip, clock) => { userAfter?.(row, strip, clock); if (active()) mine(row, strip); };
  let lightApi = null, off = false;
  const hook = () => {
    const api = globalThis.__cabinetLightScript; if (!api || lightApi === api || off) return; lightApi = api;
    Object.defineProperty(api, 'after', { configurable: true, enumerable: true, get: () => (userAfter || active() ? composed : undefined), set: (fn) => { userAfter = fn; } });
  };
  hook(); const hookTimer = setInterval(() => { hook(); if (lightApi) clearInterval(hookTimer); }, 500);
  return { dispose() { disposed = true; cancelAnimationFrame(raf); stopTone(.01); clearInterval(hookTimer); off = true; try { if (lightApi) Object.defineProperty(lightApi, 'after', { configurable: true, enumerable: true, writable: true, value: userAfter ?? undefined }); } catch { /* */ } } };
}
