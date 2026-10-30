// 実機計測 (?perfprobe=1 のときだけ index.html が読む。付けなければ何も走らず負荷ゼロ)。
// 監督が実機(Surface・内蔵GPU)で ?perfprobe=1 を付けて普通に1プレイし、終わったら画面左下の「PERF保存」を押すと JSON が保存される。
// 記録: 場面ごとのフレーム時間(平均・p95・最大)、texImage/texSubImage2D・readPixels・2D drawImage の回数と時間、
//       GPU タイマー(EXT_disjoint_timer_query_webgl2 が使えれば framebuffer ごと＝pass ごと)、場面の切替ごとの最大フレーム、
//       長いフレーム上位、ヒープ推移、環境(GPU名・解像度・フラグ)。
// 注意: 計測の呼び出しの包みで少し重くなる(実測値は目安。比較は同じ計測同士で)。ゲームの動作・見た目は変えない。
(() => {
  if (!/[?&]perfprobe=1(&|$)/.test(location.search)) return;
  const nowMs = () => performance.now();
  const MAXF = 40000;   // 場面ごとに保持するフレーム時間の最大数(p95 用)
  const S = window.__perfprobe = { startedAt: new Date().toISOString(), scenes: {}, transitions: {}, timeline: [], slowFrames: [], slow2d: [], longtasks: [], heap: [], gpuInfo: null, ctxs: [], frames: 0, notes: [] };
  const newAgg = () => ({ n: 0, dtSum: 0, dtMax: 0, dt: [], cpuSum: 0, cpuMax: 0, over16: 0, over33: 0, over50: 0, upN: 0, upB: 0, upMs: 0, upMaxMs: 0, vidN: 0, vidMs: 0, rdN: 0, rdMs: 0, rdMaxMs: 0, d2N: 0, d2Ms: 0, d2MaxMs: 0, draws: 0, gpuN: 0, gpuSum: 0, gpuMax: 0, gpuFrames: [], gpu: {}, upBySize: {} });
  let cur = null, lastTs = -1, frameNo = 0;
  const zero = () => ({ upN: 0, upB: 0, upMs: 0, upMax: 0, vidN: 0, vidMs: 0, rdN: 0, rdMs: 0, rdMax: 0, d2N: 0, d2Ms: 0, d2Max: 0, draws: 0, gpuMs: 0, gpuPend: 0, closed: false, scene: null, cpu: 0 });
  cur = zero();

  // ---- 場面の名前 ----
  function sceneName() {
    try {
      const P = window.__play, L = window.__lcdSurface, ph = P?.app?.ctrl?.phase ?? '-';
      if (!L) return 'boot/' + ph;
      if (L.timeupSurface?.active) return (ph === 'StaffWait' ? 'staff' : 'timeup') + '/' + ph;
      if (L.choiceV20?.active || L.choiceV20?.holding) return 'choice/' + ph;
      if (L.finalResultSurface?.active) return 'final/' + ph;
      if (L.attractSurface?.active) return 'attract/' + ph;
      const m = L.jp?.model; if (m?.active) return 'jp:' + (m.name ?? '?') + '/' + ph;
      const c = L.current; const id = c?.mode?.id ?? (typeof c === 'string' ? c : c?.clip) ?? '-';
      return 'normal:' + id + '/' + ph;
    } catch { return 'unknown'; }
  }
  const coarse = (s) => { const a = s.split('/')[0]; return a.startsWith('normal:') ? 'normal' : a.startsWith('jp:') ? 'jp' : a; };

  // ---- GL / 2D の包み ----
  const fbIds = new WeakMap(); let fbCount = 0;
  const fbLabel = (fb) => { if (!fb) return 'screen'; let i = fbIds.get(fb); if (i === undefined) { i = ++fbCount; fbIds.set(fb, i); } return 'fb' + i; };
  let gpu = null;   // { gl, ext, pending:[], q, label }
  function gpuBegin(label) { if (!gpu || gpu.pending.length > 96) return; const { gl, ext } = gpu; gpu.q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, gpu.q); gpu.label = label; }
  function gpuEnd() { if (!gpu?.q) return; const { gl, ext } = gpu; gl.endQuery(ext.TIME_ELAPSED_EXT); gpu.pending.push({ q: gpu.q, label: gpu.label, frame: cur }); cur.gpuPend++; gpu.q = null; }
  function gpuPoll() {
    if (!gpu) return; const { gl, ext } = gpu;
    for (let i = 0; i < gpu.pending.length; i++) {
      const e = gpu.pending[i];
      if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const bad = gl.getParameter(ext.GPU_DISJOINT_EXT), ms = bad ? null : gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(e.q); gpu.pending.splice(i--, 1); const f = e.frame; f.gpuPend--;
      if (ms != null) { f.gpuMs += ms; const A = S.scenes[f.scene] ?? (S.scenes[f.scene] = newAgg()); const g = A.gpu[e.label] ?? (A.gpu[e.label] = { n: 0, sum: 0, max: 0 }); g.n++; g.sum += ms; if (ms > g.max) g.max = ms; }
      if (f.closed && f.gpuPend === 0 && f.gpuMs > 0) { const A = S.scenes[f.scene] ?? (S.scenes[f.scene] = newAgg()); A.gpuN++; A.gpuSum += f.gpuMs; if (f.gpuMs > A.gpuMax) A.gpuMax = f.gpuMs; if (A.gpuFrames.length < MAXF) A.gpuFrames.push(f.gpuMs); }
    }
  }
  let curLabel = 'screen';
  function wrapGL(gl, canvas) {
    const info = { id: S.ctxs.length, canvasId: canvas?.id ?? null, w: canvas?.width, h: canvas?.height, offscreen: !(canvas instanceof HTMLCanvasElement) };
    S.ctxs.push(info);
    const W = (name, fn) => { const o = gl[name]; if (typeof o !== 'function') return; gl[name] = function (...a) { return fn.call(this, o, a); }; };
    const main = canvas?.id === 'c';
    if (main && !gpu) {
      try { const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (ext) { gpu = { gl, ext, pending: [], q: null, label: 'screen' }; S.gpuInfo = { timer: true }; } else S.gpuInfo = { timer: false }; } catch { S.gpuInfo = { timer: false }; }
      try { const d = gl.getExtension('WEBGL_debug_renderer_info'); S.gpuInfo = { ...S.gpuInfo, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) }; } catch {}
    }
    const draw = function (o, a) {
      cur.draws++;
      if (main && gpu && gpu.gl === gl) { if (gpu.q && gpu.label !== curLabel) gpuEnd(); if (!gpu.q) gpuBegin(curLabel); }
      return o.apply(this, a);
    };
    for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) W(n, draw);
    W('bindFramebuffer', function (o, a) { if (main) curLabel = fbLabel(a[1]); return o.apply(this, a); });
    const up = function (o, a) {
      const t = nowMs(); try { return o.apply(this, a); } finally {
        const ms = nowMs() - t, s = a.at(-1); let b = 0, vid = false;
        if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) { b = s.videoWidth * s.videoHeight * 4; vid = true; }
        else if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) { b = s.displayWidth * s.displayHeight * 4; vid = true; }
        else if (s && typeof s === 'object' && ArrayBuffer.isView(s)) b = s.byteLength;
        else if (s && typeof s === 'object' && 'width' in s && 'height' in s) b = s.width * s.height * 4;
        else if (typeof a[3] === 'number' && typeof a[4] === 'number') b = a[3] * a[4] * 4;
        if (vid) { cur.vidN++; cur.vidMs += ms; } else { cur.upN++; cur.upB += b; cur.upMs += ms; if (ms > cur.upMax) cur.upMax = ms; if (b >= 1e6) { const A = S.scenes[sceneKeyNow] ?? (S.scenes[sceneKeyNow] = newAgg()); const k = (b / 1e6).toFixed(1) + 'MB'; const e = A.upBySize[k] ?? (A.upBySize[k] = { n: 0, ms: 0 }); e.n++; e.ms += ms; } }
      }
    };
    for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) W(n, up);
    const rd = function (o, a) { const t = nowMs(); try { return o.apply(this, a); } finally { const ms = nowMs() - t; cur.rdN++; cur.rdMs += ms; if (ms > cur.rdMax) cur.rdMax = ms; } };
    W('readPixels', rd); W('getBufferSubData', rd);
  }
  let sceneKeyNow = 'boot';
  const og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { const c = og.call(this, type, ...a); if (c && /webgl/.test(type) && !c.__pp) { c.__pp = 1; wrapGL(c, this); } return c; };
  if (typeof OffscreenCanvas !== 'undefined') { const oo = OffscreenCanvas.prototype.getContext; OffscreenCanvas.prototype.getContext = function (type, ...a) { const c = oo.call(this, type, ...a); if (c && /webgl/.test(type) && !c.__pp) { c.__pp = 1; wrapGL(c, this); } return c; }; }
  const od = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...a) {
    const t = nowMs(); try { return od.apply(this, a); } finally {
      const ms = nowMs() - t; cur.d2N++; cur.d2Ms += ms; if (ms > cur.d2Max) cur.d2Max = ms;
      if (ms > 3 && S.slow2d.length < 60) { const s = a[0]; S.slow2d.push({ at: Math.round(t), ms: +ms.toFixed(1), scene: sceneKeyNow, src: s?.constructor?.name, sw: s?.width ?? s?.videoWidth, sh: s?.height ?? s?.videoHeight, dw: this.canvas?.width, dh: this.canvas?.height }); }
    }
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (S.longtasks.length < 300) S.longtasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), scene: sceneKeyNow }); } }).observe({ type: 'longtask', buffered: true }); } catch {}

  // ---- フレームの区切り ----
  let prevScene = null, sinceChange = 99, changeInfo = null, lastHeapAt = 0;
  function closeFrame(ts, dt) {
    const c = cur, scene = c.scene ?? sceneKeyNow, A = S.scenes[scene] ?? (S.scenes[scene] = newAgg());
    if (c.gpuPend === 0 && c.gpuMs > 0) { A.gpuN++; A.gpuSum += c.gpuMs; if (c.gpuMs > A.gpuMax) A.gpuMax = c.gpuMs; if (A.gpuFrames.length < MAXF) A.gpuFrames.push(c.gpuMs); }
    c.closed = true;
    if (dt > 0 && dt < 2000) {
      A.n++; A.dtSum += dt; if (dt > A.dtMax) A.dtMax = dt; if (A.dt.length < MAXF) A.dt.push(dt);
      if (dt > 16.9) A.over16++; if (dt > 33.5) A.over33++; if (dt > 50) A.over50++;
      A.cpuSum += c.cpu; if (c.cpu > A.cpuMax) A.cpuMax = c.cpu;
      A.upN += c.upN; A.upB += c.upB; A.upMs += c.upMs; if (c.upMax > A.upMaxMs) A.upMaxMs = c.upMax; A.vidN += c.vidN; A.vidMs += c.vidMs; A.rdN += c.rdN; A.rdMs += c.rdMs; if (c.rdMax > A.rdMaxMs) A.rdMaxMs = c.rdMax;
      A.d2N += c.d2N; A.d2Ms += c.d2Ms; if (c.d2Max > A.d2MaxMs) A.d2MaxMs = c.d2Max; A.draws += c.draws;
      if (changeInfo && sinceChange < 12) { if (dt > changeInfo.maxDt) { changeInfo.maxDt = dt; changeInfo.maxCpu = c.cpu; changeInfo.rd = c.rdMs; changeInfo.up = c.upMs; changeInfo.d2 = c.d2Ms; } }
      if (dt > 33.5) { S.slowFrames.push({ at: Math.round(ts), dt: +dt.toFixed(1), cpu: +c.cpu.toFixed(1), scene, up: [c.upN, +c.upMs.toFixed(1), Math.round(c.upB / 1e6 * 10) / 10], rd: [c.rdN, +c.rdMs.toFixed(1)], d2: [c.d2N, +c.d2Ms.toFixed(1)], draws: c.draws }); if (S.slowFrames.length > 400) { S.slowFrames.sort((a, b) => b.dt - a.dt); S.slowFrames.length = 200; } }
    }
  }
  function tickStart(ts) {
    const dt = lastTs >= 0 ? ts - lastTs : 0;
    if (lastTs >= 0) closeFrame(lastTs, dt);
    gpuEnd(); gpuPoll();
    S.frames++; sinceChange++;
    cur = zero(); lastTs = ts; curLabel = 'screen';
    const sc = sceneName(); sceneKeyNow = sc; cur.scene = sc;
    if (sc !== prevScene) {
      if (prevScene !== null) {
        const key = coarse(prevScene) === coarse(sc) ? prevScene + ' -> ' + sc : coarse(prevScene) + ' -> ' + coarse(sc);
        const T = S.transitions[key] ?? (S.transitions[key] = { n: 0, maxDt: 0, maxCpu: 0, rd: 0, up: 0, d2: 0 }); changeInfo = { T, maxDt: 0, maxCpu: 0, rd: 0, up: 0, d2: 0 }; T.n++; sinceChange = 0;
        if (S.timeline.length < 4000) S.timeline.push([Math.round(ts), sc]);
        // 前の切替の結果を T に反映
      }
      prevScene = sc;
    }
    if (changeInfo && sinceChange === 12) { const T = changeInfo.T; if (changeInfo.maxDt > T.maxDt) { T.maxDt = +changeInfo.maxDt.toFixed(1); T.maxCpu = +changeInfo.maxCpu.toFixed(1); T.rd = +changeInfo.rd.toFixed(1); T.up = +changeInfo.up.toFixed(1); T.d2 = +changeInfo.d2.toFixed(1); } changeInfo = null; }
    if (ts - lastHeapAt > 5000) { lastHeapAt = ts; const m = performance.memory; if (m && S.heap.length < 2000) S.heap.push([Math.round(ts / 1000), Math.round(m.usedJSHeapSize / 1e6)]); }
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf((ts) => { if (ts !== lastTs) tickStart(ts); const t = nowMs(); try { cb(ts); } finally { cur.cpu += nowMs() - t; } });
  };

  // ---- 出力 ----
  const pct = (arr, p) => { if (!arr.length) return null; const a = Float64Array.from(arr).sort(); return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2); };
  const r1 = (x) => +x.toFixed(2);
  function summarize() {
    const out = { scenes: {}, coarse: {} };
    const coarseAcc = {};
    for (const [k, A] of Object.entries(S.scenes)) {
      if (A.n < 1) continue;
      const row = { frames: A.n, avgMs: r1(A.dtSum / A.n), p50Ms: pct(A.dt, .5), p95Ms: pct(A.dt, .95), p99Ms: pct(A.dt, .99), maxMs: r1(A.dtMax), over16: A.over16, over33: A.over33, over50: A.over50, cpuAvgMs: r1(A.cpuSum / A.n), cpuMaxMs: r1(A.cpuMax),
        texUpload: { callsPerFrame: r1(A.upN / A.n), MBperFrame: r1(A.upB / A.n / 1e6), msPerFrame: r1(A.upMs / A.n), maxCallMs: r1(A.upMaxMs), bigBySize: A.upBySize }, videoUpload: { callsPerFrame: r1(A.vidN / A.n), msPerFrame: r1(A.vidMs / A.n) },
        readPixels: { callsPerFrame: r1(A.rdN / A.n), msPerFrame: r1(A.rdMs / A.n), maxCallMs: r1(A.rdMaxMs) }, drawImage2d: { callsPerFrame: r1(A.d2N / A.n), msPerFrame: r1(A.d2Ms / A.n), maxCallMs: r1(A.d2MaxMs) }, drawCallsPerFrame: r1(A.draws / A.n) };
      if (A.gpuN) { row.gpu = { frames: A.gpuN, avgMs: r1(A.gpuSum / A.gpuN), p95Ms: pct(A.gpuFrames, .95), maxMs: r1(A.gpuMax), passes: Object.fromEntries(Object.entries(A.gpu).map(([l, g]) => [l, { avgMsPerFrame: r1(g.sum / A.gpuN), maxMs: r1(g.max), callsPerFrame: r1(g.n / A.gpuN) }])) }; }
      out.scenes[k] = row;
      const c = coarse(k); const C = coarseAcc[c] ?? (coarseAcc[c] = { n: 0, sum: 0, max: 0, dt: [], o33: 0 }); C.n += A.n; C.sum += A.dtSum; C.max = Math.max(C.max, A.dtMax); C.o33 += A.over33; for (const d of A.dt) if (C.dt.length < MAXF) C.dt.push(d);
    }
    for (const [c, C] of Object.entries(coarseAcc)) out.coarse[c] = { frames: C.n, avgMs: r1(C.sum / C.n), p95Ms: pct(C.dt, .95), maxMs: r1(C.max), over33: C.o33 };
    return out;
  }
  S.report = () => {
    const P = window.__play, env = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory ?? null, dpr: devicePixelRatio, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight], url: location.search, gpu: S.gpuInfo, ctxs: S.ctxs, now: new Date().toISOString() };
    let diag = null; try { diag = P?.loopDiagnostics?.() ?? null; } catch {}
    let ri = null; try { const i = P?.hr?.renderer?.info; if (i) ri = { calls: i.render?.calls, triangles: i.render?.triangles, programs: i.programs?.length, textures: i.memory?.textures, geometries: i.memory?.geometries }; } catch {}
    const trans = Object.entries(S.transitions).sort((a, b) => b[1].maxDt - a[1].maxDt).slice(0, 40);
    const slow = [...S.slowFrames].sort((a, b) => b.dt - a.dt).slice(0, 60);
    let tier = null; try { tier = { transitionPerf: P?.app?.transitionPerf?.snapshot?.() ?? null }; } catch {}
    return { kind: 'perfprobe-1030', startedAt: S.startedAt, durationSec: Math.round((lastTs) / 1000), frames: S.frames, env, loopDiagnostics: diag, rendererInfo: ri, tier, ...summarize(), transitionsTopByMaxDt: Object.fromEntries(trans), slowFramesTop: slow, slowDrawImage2d: S.slow2d, longtasksTop: [...S.longtasks].sort((a, b) => b.ms - a.ms).slice(0, 40), heapMBBySec: S.heap, timeline: S.timeline, notes: S.notes, readme: 'avgMs/p95Ms/maxMs は rAF の間隔(60fps=16.7)。cpuAvgMs は rAF コールバック内の主スレッド時間。gpu は EXT_disjoint_timer_query_webgl2 が使えた時だけ。passes のキーは framebuffer 番号(screen=最終)。' };
  };
  S.save = () => {
    const json = JSON.stringify(S.report(), null, 1), blob = new Blob([json], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'perfprobe_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return json.length;
  };
  const ui = () => {
    const b = document.createElement('button'); b.id = 'perfprobe-save'; b.textContent = 'PERF保存';
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;padding:10px 16px;font:600 16px sans-serif;background:#143;color:#bfe;border:2px solid #6c9;border-radius:6px;opacity:.85;cursor:pointer';
    const t = document.createElement('div'); t.style.cssText = 'position:fixed;left:8px;bottom:56px;z-index:99999;color:#bfe;font:12px monospace;background:#000a;padding:2px 6px;pointer-events:none'; t.textContent = 'perfprobe ON';
    b.addEventListener('click', (e) => { e.stopPropagation(); try { const n = S.save(); t.textContent = 'saved ' + Math.round(n / 1024) + 'KB'; } catch (err) { t.textContent = 'save failed: ' + err.message; } });
    for (const ev of ['keydown', 'keyup', 'pointerdown']) b.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(b, t);
    let n = 0; setInterval(() => { if (!/^saved/.test(t.textContent)) t.textContent = 'perfprobe ' + S.frames + 'f ' + sceneKeyNow; if (++n % 15 === 0) { try { localStorage.setItem('perfprobe_backup', JSON.stringify(S.report())); } catch {} } }, 2000);
  };
  if (document.body) ui(); else document.addEventListener('DOMContentLoaded', ui);
})();
