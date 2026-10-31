// 11/1 最終合成の整理（final_region_1101.mjs）の実機確認用。?shaderinfo=1（または ?finalbench=1）のときだけ読まれる。
// 画面左下の「SHADER比較」を押すと、次の 1 コマで次の 3 つを自動で行い、結果を画面に出して JSON を保存する。
//   1. 変換後シェーダ（WEBGL_debug_shaders。Surface では ANGLE が出す HLSL）の中身の比較：texture 系の呼び出し・分岐の指定・微分の数
//   2. 4 つのモード（lr=従来／Lr=textureLod化／LR=textureLod化＋領域別／lR=領域別のみ）で同じコマを描いた画素の比較
//   3. 同じ 4 モードの GPU 時間（EXT_disjoint_timer_query_webgl2。無ければ gl.finish 付きの時計）。同じコマを K 回描く増幅
// 戻すには ?lodtex=0&finalregion=0（両方 0 が従来）。
export function installFinalBench({ hr, r, api, THREE, pq }) {
  const gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_shaders'), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), dri = gl.getExtension('WEBGL_debug_renderer_info');
  const MODES = [[0, 0, 0, 'lrf'], [1, 0, 0, 'Lrf'], [1, 1, 0, 'LRf'], [0, 1, 0, 'lRf'], [0, 0, 1, 'lrF'], [1, 1, 1, 'LRF'], [1, 1, 2, 'LRG']];   // 大文字=有効：L=textureLod化 R=領域別 F=トーンマップを閉じた解析式に G=格子点だけ式（LUT と同じ補間）
  let K = +(pq.get('benchk') ?? 0); const ROUNDS = +(pq.get('benchrounds') ?? 6);   // K=1 回の計測で同じコマを描く回数（0=1 回あたり約 80ms になるよう自動）
  const S = window.__finalBench = { armed: null, last: null, text: '' };
  const orig = (scene, cam) => r.render(scene, cam);

  const readTarget = () => {
    const t = r.getRenderTarget();
    if (t) { const ty = t.texture.type; const A = ty === 1016 ? new Uint16Array(t.width * t.height * 4) : ty === 1015 ? new Float32Array(t.width * t.height * 4) : new Uint8Array(t.width * t.height * 4); r.readRenderTargetPixels(t, 0, 0, t.width, t.height, A); return { A, dim: [t.width, t.height], type: ty }; }
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, A = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A); return { A, dim: [w, h], type: 'canvas' };
  };

  const countOf = (src, re) => (src.match(re) || []).length;
  const analyse = (src) => {
    const calls = {}; for (const m of src.matchAll(/\b(gl_(?:texture|texelFetch|textureLod|textureSize)\w*|texture\w*|SampleLevel|SampleGrad|Sample|Load|GetDimensions)\s*\(/g)) calls[m[1]] = (calls[m[1]] ?? 0) + 1;
    return {
      chars: src.length, lines: src.split('\n').length, calls,
      sample: countOf(src, /\.Sample\(/g), sampleLevel: countOf(src, /\.SampleLevel\(/g), sampleGrad: countOf(src, /\.SampleGrad\(/g), load: countOf(src, /\.Load\(/g),
      ddx: countOf(src, /\bddx(?:_coarse|_fine)?\(/g), ddy: countOf(src, /\bddy(?:_coarse|_fine)?\(/g), branch: countOf(src, /\[branch\]/g), flatten: countOf(src, /\[flatten\]/g), loop: countOf(src, /\[loop\]/g), unroll: countOf(src, /\[unroll\]/g),
      ifs: countOf(src, /\bif\s*\(/g), discard: countOf(src, /\bdiscard\b|\bclip\(/g),
    };
  };
  // three は link 後にシェーダ object を捨てるので、link の直後に変換後のソースを控える（この確認を始めてから作られるプログラムだけが対象＝比較用の組は全部入る）
  const srcOf = new WeakMap();
  if (dbg) { const lp = gl.linkProgram.bind(gl); gl.linkProgram = (prog) => { lp(prog); try { for (const sh of gl.getAttachedShaders(prog)) if (gl.getShaderParameter(sh, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) srcOf.set(prog, dbg.getTranslatedShaderSource(sh)); } catch {} }; }
  const translated = (material) => {
    const prog = r.properties.get(material)?.currentProgram?.program;
    return prog ? (srcOf.get(prog) ?? null) : null;
  };

  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  const fmt = (x, d = 3) => x == null ? '-' : x.toFixed(d);

  const log = (m) => { if (pq.get('benchlog') !== '0') console.warn('[finalbench] ' + m + ' +' + Math.round(performance.now() - T0) + 'ms'); };
  let T0 = 0;
  const run = (cam) => {
    T0 = performance.now(); log('start');
    const t0 = performance.now(), keep = api.finalKey();
    const out = { kind: 'finalbench-1101', now: new Date().toISOString(), ua: navigator.userAgent, gpu: dri ? gl.getParameter(dri.UNMASKED_RENDERER_WEBGL) : null, url: location.search, K, ROUNDS, timer: !!ext, debugShaders: !!dbg, modes: {}, regions: api.finalSet(1, 1).info };
    const sets = MODES.map(([lod, reg, lut, name]) => ({ name, lod, reg, lut, st: api.finalSet(lod, reg, lut) }));
    log('sets built');
    // 1) 画素：lr を基準に比べる（等しい=全画素一致）
    let base = null;
    const dec = (v, ty) => ty === 1016 ? h2f(v) : ty === 1015 ? v : v / 255;
    const h2f = (h) => { const e = (h >> 10) & 31, f = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : sg * Infinity) : sg * (1 + f / 1024) * 2 ** (e - 15); };
    const s2l = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const lab = (r, g, b) => { const R = s2l(Math.min(1, Math.max(0, r))), G = s2l(Math.min(1, Math.max(0, g))), B = s2l(Math.min(1, Math.max(0, b)));
      const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
      const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; const fx = f(X), fy = f(Y), fz = f(Z); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
    let baseF = false;
    for (const m of sets) {
      log('render ' + m.name); orig(m.st.scene, cam); orig(m.st.scene, cam); log('read ' + m.name);
      const shot = readTarget(); out.dim = shot.dim; out.targetType = shot.type;
      if (!base) { base = shot.A; baseF = true; }
      let differ = 0, maxd = 0, first = -1; const A = shot.A;
      for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - base[i]), Math.abs(A[i + 1] - base[i + 1]), Math.abs(A[i + 2] - base[i + 2])); if (d) { differ++; if (d > maxd) maxd = d; if (first < 0) first = i >> 2; } }
      out.modes[m.name] = { pixelsDiffer: differ, maxRawDiff: maxd, firstDiffPixel: first };
      if (differ && baseF) {   // 数値が違うモードは色差（sRGB 符号化の値として CIE76 ΔE）も出す
        const hist = [0, 0, 0, 0, 0]; let sumE = 0, maxE = 0, maxCode = 0; const px = A.length / 4, E = new Float32Array(Math.min(px, 1 << 22));
        let n = 0;
        for (let i = 0; i < A.length; i += 4) {
          if (A[i] === base[i] && A[i + 1] === base[i + 1] && A[i + 2] === base[i + 2]) { n++; continue; }
          const a = lab(dec(A[i], shot.type), dec(A[i + 1], shot.type), dec(A[i + 2], shot.type)), b = lab(dec(base[i], shot.type), dec(base[i + 1], shot.type), dec(base[i + 2], shot.type));
          const e = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); sumE += e; if (e > maxE) maxE = e;
          const cd = Math.max(Math.abs(dec(A[i], shot.type) - dec(base[i], shot.type)), Math.abs(dec(A[i + 1], shot.type) - dec(base[i + 1], shot.type)), Math.abs(dec(A[i + 2], shot.type) - dec(base[i + 2], shot.type))) * 255; if (cd > maxCode) maxCode = cd;
          if (e > 0.5) hist[0]++; if (e > 1) hist[1]++; if (e > 2) hist[2]++; if (e > 4) hist[3]++;
        }
        out.modes[m.name].dE76 = { mean: +(sumE / px).toFixed(5), max: +maxE.toFixed(3), maxCode8: +maxCode.toFixed(2), over0_5: hist[0], over1: hist[1], over2: hist[2], over4: hist[3], fracOver0_5: +(hist[0] / px).toExponential(2) };
      }
    }
    log('pixels done');
    // 2) 変換後シェーダ
    for (const m of sets) {
      const mats = m.st.materials ?? [m.st.material]; const srcs = mats.map(translated);
      out.modes[m.name].materials = mats.length;
      out.modes[m.name].translated = srcs.map((s, i) => s ? { name: m.st.scene.children[i]?.name ?? ('m' + i), ...analyse(s) } : null);
      if (pq.get('shadersrc') === '1') out.modes[m.name].sources = srcs;
    }
    log('shaders done');
    // 3) 時間：交互に K 回描く増幅。ラウンドごとに順序を回す
    let KK = K;
    if (!KK) { const a0 = sets.find((x) => x.name === 'lrf'); gl.finish(); const q0 = performance.now(); for (let k = 0; k < 6; k++) orig(a0.st.scene, cam); gl.finish(); KK = Math.max(4, Math.min(400, Math.ceil(80 / Math.max((performance.now() - q0) / 6, 0.01)))); }
    out.K = KK;
    const pend = [], wall = {};
    for (let round = 0; round < ROUNDS; round++) {
      const order = sets.slice(); for (let i = 0; i < round % order.length; i++) order.push(order.shift());
      for (const m of order) {
        if (ext) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); for (let k = 0; k < KK; k++) orig(m.st.scene, cam); gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push([m.name, q]); }
        else { gl.finish(); const a = performance.now(); for (let k = 0; k < KK; k++) orig(m.st.scene, cam); gl.finish(); (wall[m.name] ??= []).push((performance.now() - a) / KK); }
      }
    }
    log('timing issued');
    api.setFinalMode(keep.includes('L') ? 1 : 0, keep.includes('R') ? 1 : 0, keep.includes('G') ? 2 : keep.includes('F') ? 1 : 0);   // 元のモードへ
    return new Promise((resolve) => {
      let tries = 0;
      const fin = () => {
        const ms = {};
        if (ext) {
          if (!pend.every(([, q]) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) && tries++ < 200) return setTimeout(fin, 50);
          out.disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
          for (const [n, q] of pend) if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) (wall[n] ??= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / KK);
        }
        for (const n of Object.keys(wall)) { ms[n] = { n: wall[n].length, p50: med(wall[n]), min: Math.min(...wall[n]) }; out.modes[n].ms = ms[n]; }
        out.benchWallMs = Math.round(performance.now() - t0);
        const b = out.modes.lrf.ms?.p50;
        for (const n of Object.keys(out.modes)) if (b && out.modes[n].ms) out.modes[n].vsLr = +(out.modes[n].ms.p50 / b).toFixed(3);
        S.last = out; resolve(out);
      };
      fin();
    });
  };

  const summarize = (o) => {
    const L = ['final bench  ' + (o.gpu ?? '?') + '  timer=' + o.timer + ' debugShaders=' + o.debugShaders + '  ' + (o.dim ?? []).join('x')];
    for (const n of MODES.map((x) => x[3])) {
      const m = o.modes[n]; if (!m) continue;
      const tr = (m.translated ?? []).filter(Boolean);
      const tot = (k) => tr.reduce((a, t) => a + (t[k] ?? 0), 0);
      L.push(n.padEnd(3) + ' px差 ' + m.pixelsDiffer + (m.dE76 ? ' dE76 mean ' + m.dE76.mean + ' max ' + m.dE76.max + ' >0.5:' + m.dE76.over0_5 : '') + ' (最大 ' + m.maxRawDiff + ')  ' + (m.ms ? 'p50 ' + fmt(m.ms.p50) + 'ms (' + (m.vsLr ?? '-') + 'x lrf) min ' + fmt(m.ms.min) : 'ms -') + '  Sample ' + tot('sample') + ' Level ' + tot('sampleLevel') + ' branch ' + tot('branch') + ' flatten ' + tot('flatten') + ' ddx ' + tot('ddx') + ' ddy ' + tot('ddy') + ' chars ' + tot('chars'));
    }
    return L.join('\n');
  };

  const save = (o) => {
    const json = JSON.stringify(o, null, 1), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = 'finalbench_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  let box = null;
  S.start = () => new Promise((resolve) => { S.armed = resolve; api.invalidate(); });
  api.finalHook = (cam) => {
    if (!S.armed) return;
    const done = S.armed; S.armed = null;
    let p; try { p = run(cam); } catch (e) { p = Promise.resolve({ error: String(e && e.stack || e) }); }
    p.then((o) => { S.text = o.error ? 'ERROR ' + o.error : summarize(o); if (box) box.textContent = S.text; try { save(o); } catch {} done(o); });
  };

  const ui = () => {
    const b = document.createElement('button'); b.id = 'finalbench-run'; b.textContent = 'SHADER比較';
    b.style.cssText = 'position:fixed;left:130px;bottom:8px;z-index:99999;padding:10px 16px;font:600 16px sans-serif;background:#314;color:#ebf;border:2px solid #a6c;border-radius:6px;opacity:.85;cursor:pointer';
    box = document.createElement('pre'); box.style.cssText = 'position:fixed;left:8px;bottom:56px;z-index:99999;margin:0;max-width:95vw;color:#ebf;font:12px monospace;background:#000c;padding:4px 8px;white-space:pre-wrap;pointer-events:none'; box.textContent = 'finalbench ready';
    b.addEventListener('click', (e) => { e.stopPropagation(); box.textContent = '計測中…（数秒）'; S.start(); });
    for (const ev of ['keydown', 'keyup', 'pointerdown']) b.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(b, box);
  };
  if (document.body) ui(); else document.addEventListener('DOMContentLoaded', ui);
}
