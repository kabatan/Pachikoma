/* 光バス: events.json の機器別トラックを、毎フレームの光の値にする。DOMなし。ブラウザ(globalThis.LightBus)とNode(module.exports)の両方で使う。
 *
 * 出力 frame:
 *  edge  : {base:{amount,speed}, mul[24], add[72], ovr[72], ovrA[24]}  (虹Bの上に: 乗算→上書き→加算)
 *  petal : Float32Array(45*3)  区画ごとの最終RGB(線形。既定のピンクは[1,.08,.38]、強さ込み)
 *  logo  : [r,g,b]            pocket: Float32Array(7*3)           seg: {meter[5], blink, mode}
 *  ambient: 盤面の明るさ係数(1=通常。暗転で小さく)
 *  cues  : このフレームで発火した合図 [{lane,id,type,t,...}]   (lcd/tray/seg/btn/snd/ambient)
 *  active: 実行中のイベントID
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const hash = (i, k = 0) => { let x = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const hsv = (h) => { const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
  const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const hexColorCache = new Map();
  function color(c) {
    if (Array.isArray(c)) return c;
    if (c === 'rainbow') return null;
    if (typeof c === 'string' && c[0] === '#') {
      const cached = hexColorCache.get(c); if (cached) return cached;
      const v = [1, 3, 5].map((i) => srgb2lin(parseInt(c.slice(i, i + 2), 16) / 255));
      const m = Math.max(...v, 1e-6), result = v.map((x) => x / m); hexColorCache.set(c, result); return result;
    }
    return [1, .08, .38];
  }
  const COL = { pink: [1, .08, .38], sakura: [1, .27, .52], gold: [1, .36, .012], white: [1, 1, 1], crimson: [1, .012, .03], cyan: [.08, .62, 1], paleGold: [1, .62, .22] };
  // ランクの色(0参加賞 1C 2B 3A 4S 5SS): 虹はJPと大成功だけなので、S・SSも虹にしない(Sは濃い金橙、SSはマゼンタ寄りの赤金)
  const RK = [COL.sakura, [.85, .45, .2], [.1, .4, 1], COL.gold, [1, .5, .01], [1, .06, .4]];

  class Director {
    constructor({ events, geom, seed = 1 }) {
      this.events = new Map(events.events.map((e) => [e.id, e]));
      this.G = geom; this.seed = seed;
      this.nE = geom.edge.length; this.nP = geom.petals.length;
      this.cx = 0.5; this.cy = 0.43;           // 花びら全体の中心(K3の正規化座標)
      // 花びらの角度(中心から見て。12時=0、時計回り)と、縁LEDの周回位置
      this.pAng = geom.petals.map((p) => ((Math.atan2(p.u - this.cx, -(p.v - this.cy)) / TAU) + 1) % 1);
      this.eS = geom.edge.map((e) => e.pf);
      this.eAng = geom.edge.map((e) => e.pf);   // 周回は周長の割合で扱う
      this.petalIds = geom.petals.map((p) => p.petal);
      this.state = { n: 0, litPockets: [], hitPocket: -1, rank: 0, lcdBusyUntil: 0, lastN: 0, extra: {} };
      this.t = 0; this.inst = []; this.cues = []; this.nextId = 1;
      this.dispN = null;   // 昇天中に灯の表示数を一時的に変える
    }
    setState(s) { Object.assign(this.state, s); }
    start(id, params = {}) {
      const def = this.events.get(id); if (!def) throw new Error('unknown event ' + id);
      const dur = def.dur || Math.max(...def.tracks.map((t) => t.t1));
      const scale = params.scale || (def.variants && def.variants[String(params.payout)]) || 1;
      const inst = { id, def, params, scale, t0: this.t, dur: params.dur || dur, loop: !!def.loop && !params.once, n0: this.state.n, fired: new Set(), uid: this.nextId++ };
      if (params.replace !== false) this.inst = this.inst.filter((x) => x.id !== id);
      this.inst.push(inst);
      return inst.uid;
    }
    stop(id) { this.inst = this.inst.filter((x) => x.id !== id && x.uid !== id); }
    isActive(id) { return this.inst.some((x) => x.id === id); }

    // ---- 要素の選択 ----
    petalSel(targets, params) {
      const P = this.G.petals, n = this.nP, a = new Float32Array(n);
      const set = (f) => { for (let i = 0; i < n; i++) if (f(P[i], i)) a[i] = 1; };
      const t = targets || 'all';
      if (t === 'all') set(() => true);
      else if (t === 'top3') set((p) => ['p1', 'p2', 'p4'].includes(p.petal));
      else if (t === 'lowerSides') set((p) => ['l3', 'l4', 'r3', 'r4'].includes(p.petal));
      else if (t === 'sides') set((p) => /^[lr]/.test(p.petal));
      else if (t === 'nth') { const k = params.n || this.state.n; const pid = ({ 1: 'p1', 2: 'p4', 3: 'p2' })[k] || 'p2'; set((p) => p.petal === pid); }
      else if (/^P\d$/.test(t)) set((p) => p.petal === t.toLowerCase());
      else if (/^P\d\.z\d$/.test(t)) { const [pp, z] = t.split('.'); set((p) => p.petal === pp.toLowerCase() && p.zone === +z[1]); }
      else set(() => true);
      return a;
    }
    edgeSel(targets) {
      const E = this.G.edge, a = new Float32Array(this.nE);
      for (let i = 0; i < this.nE; i++) {
        const nm = E[i].name; const t = targets || 'ring';
        a[i] = t === 'ring' || t === 'all' ? 1 : nm.includes(t.toUpperCase()) ? 1 : 0;
      }
      return a;
    }
    // 灯数nの花びらの定常状態(0=銀白 ... 4=全ピンク呼吸 5=+きらめき 6=金+周回)
    petalStateN(n, t, out) {
      const P = this.G.petals;
      const onSet = n >= 4 ? null : new Set(({ 0: [], 1: ['p1'], 2: ['p1', 'p4'], 3: ['p1', 'p4', 'p2'] })[n]);
      const prev = this.pPrev || (this.pPrev = new Uint8Array(this.nP)), born = this.pBorn || (this.pBorn = new Float32Array(this.nP).fill(-9));
      for (let i = 0; i < this.nP; i++) {
        const p = P[i]; let on = n >= 4 ? 1 : onSet.has(p.petal) ? 1 : 0;
        if (on && !prev[i]) born[i] = t - (this.pFirst ? 0 : 99);   // 新しく点いた花びら: 最初は点滅して落ち着く(パッとつかない)
        prev[i] = on; if (!on) continue;
        let c, k = 1;
        if (n === 6) { c = COL.gold; const d = ((this.pAng[i] - t * .22) % 1 + 1) % 1; k = .55 + .85 * Math.exp(-14 * Math.min(d, 1 - d) ** 2); }
        else { c = [1, .08, .38]; if (n >= 4) k = lerp(.75, 1.15, .5 + .5 * Math.sin(TAU * t / 3.2 - p.zone * .35)); }
        if (n === 5) {   // 5灯: 4灯より明らかに豪華(明るい桜+金の光が2本周回+きらめき)
          k *= 1.25;
          for (let h = 0; h < 2; h++) { const d = ((this.pAng[i] - t * .35 - h * .5) % 1 + 1) % 1, w = Math.exp(-18 * Math.min(d, 1 - d) ** 2); c = [c[0] + COL.gold[0] * w * .9, c[1] + COL.gold[1] * w * 1.4, c[2] + COL.gold[2] * w]; k += w * .5; }
          const r = hash(i, Math.floor(t * 7 + i)) > .8 ? 1 : 0; c = r ? [1, .7, .85] : c; k *= r ? 1.6 : 1;
        }
        const age = t - born[i];
        if (age >= 0 && age < .9) { const f = Math.floor(age * 16), on2 = f % 2 === 0 || hash(i, f) > .7; k *= age < .12 ? 0 : on2 ? 1.6 : .12; if (age > .65) k = lerp(k, 1, (age - .65) / .25); }
        out[i * 3] += c[0] * k; out[i * 3 + 1] += c[1] * k; out[i * 3 + 2] += c[2] * k;
      }
      this.pFirst = true;
    }

    // ---- 1フレーム ----
    step(dt) {
      this.t += dt; const t = this.t;
      const nE = this.nE, nP = this.nP;
      const F = {
        t, n: this.state.n, nDisp: this.dispN != null ? this.dispN : this.state.n, active: [], cues: [],
        edge: { base: { amount: .7, speed: 1 }, mul: new Float32Array(nE).fill(1), add: new Float32Array(nE * 3), ovr: new Float32Array(nE * 3), ovrA: new Float32Array(nE) },
        petal: new Float32Array(nP * 3), logo: [0, 0, 0], pocket: new Float32Array(21), btn: [0, 0, 0, 0, 0, 0], seg: { meter: [0, 0, 0, 0, 0], blink: 0, mode: 'hold' },
        ambient: 1, ambientBase: 1,
      };
      let n = this.dispN != null ? this.dispN : this.state.n;
      // 定常
      const nn = clamp(Math.round(n), 0, 6);
      // 暗転(ambientのblackout/hold)は『通常の光(土台)』を落とす。イベント自身の光は落とさない
      let tgt = 1;
      for (const inst of this.inst) { const lt0 = (t - inst.t0) / inst.scale; for (const tr of inst.def.tracks) if (tr.lane === 'ambient' && (tr.pat === 'blackout' || tr.pat === 'hold') && lt0 >= tr.t0 && lt0 <= tr.t1) tgt = Math.min(tgt, tr.p && tr.p.level !== undefined ? tr.p.level : 0); }
      this.dimV = this.dimV === undefined ? 1 : this.dimV; const rate = tgt < this.dimV ? 14 : 3.5; this.dimV += (tgt - this.dimV) * Math.min(1, rate * dt);
      this.petalStateN(nn, t, F.petal);
      for (let i = 0; i < F.petal.length; i++) F.petal[i] *= this.dimV;
      F.edge.base.amount = [.55, .65, .75, .85, 1.0, 1.15, 1.3][nn]; F.edge.base.speed = [.9, 1, 1.05, 1.1, 1.3, 1.6, 1.9][nn];
      F.edge.base.amount *= Math.max(.04, this.dimV);
      const gl = [0.15, .25, .4, .55, .8, 1, 1.25][nn] * this.dimV; F.logo = nn >= 6 ? [1 * gl, .5 * gl, .03 * gl] : [gl * 1, gl * .55, gl * .06];
      for (let i = 0; i < 7; i++) {
        const lit = this.state.litPockets.includes(i + 1);
        if (lit) { const pc = [[1, .86, .72], [1, .86, .72], [1, .86, .72], [1, .86, .72], [1, .62, .7], [1, .72, .36], [1, .6, .12]][nn]; F.pocket[i * 3] = 2.5 * pc[0]; F.pocket[i * 3 + 1] = 2.5 * pc[1]; F.pocket[i * 3 + 2] = 2.5 * pc[2]; }   // 灯った穴の定常色は灯の数で変わる(〜4灯=白、4灯=ピンク、5灯=金橙、6灯=濃い金)。穴の色だけで何灯かが分かる   // 入った穴の口は、白い基底(stage2cのpocket source。推奨ヒット値4)で点く。レビューe07
      }
      if (this.state.hint) this.hintLights(F, t);   // 初見ヒント(R2-TU): 穴・ボタンのLEDだけで場所を示す
      F.seg.meter = [0, 0, 0, 0, 0];
      // ボタンの定常: 押せる時だけ光り、いま押すボタンが一番強い
      this.btnAmbient(F, t, nn);
      // イベントの重ね合わせ
      const keep = [];
      for (const inst of this.inst) {
        let lt = (t - inst.t0) / inst.scale;
        if (inst.loop && lt >= inst.dur) { lt = lt % inst.dur; }
        if (!inst.loop && lt > inst.dur + .05) { continue; }
        keep.push(inst); F.active.push(inst.id);
        for (let ti = 0; ti < inst.def.tracks.length; ti++) {
          const tr = inst.def.tracks[ti];
          if (tr.when && !Object.entries(tr.when).every(([k, v]) => !!inst.params[k] === !!v)) continue;   // 条件つきトラック(例: near_miss のときだけ)
          const s = tr.t0, e = tr.t1; if (lt < s) continue;
          const key = ti; const ended = lt > e;
          // 合図(開始時に一度)
          if (!inst.fired.has(key)) {
            inst.fired.add(key);
            if (['lcd', 'tray', 'seg', 'snd'].includes(tr.lane) || ['count', 'payout', 'collect'].includes(tr.pat)) F.cues.push({ lane: tr.lane, event: inst.id, pat: tr.pat, label: tr.label, t0: s * inst.scale, t1: e * inst.scale, p: tr.p, params: inst.params, uid: inst.uid, scale: inst.scale });
          }
          if (ended) continue;
          this.applyTrack(F, inst, tr, lt, nn);
        }
        for (const sn of inst.def.snd) { const key = 's' + sn.cue + sn.t; if (lt >= sn.t && !inst.fired.has(key)) { inst.fired.add(key); F.cues.push({ lane: 'snd', event: inst.id, cue: sn.cue }); } }
        if (inst.loop && lt < dt / inst.scale) inst.fired.clear();
      }
      this.inst = keep;
      this.edgeBase(F, nn, dt);
      // 非ループで終わったイベントの firing を覚える必要はない。
      for (let i = 0; i < nP; i++) {   // 明るさの揃え: 金や白は輝度が高いので、ピンクの鮮やかさに合わせて圧縮する
        const r = Math.max(0, F.petal[i * 3]), g = Math.max(0, F.petal[i * 3 + 1]), b = Math.max(0, F.petal[i * 3 + 2]);
        const L = .2126 * r + .7152 * g + .0722 * b, k = L > .27 ? Math.pow(.27 / L, .62) : 1;
        F.petal[i * 3] = r * k; F.petal[i * 3 + 1] = g * k; F.petal[i * 3 + 2] = b * k;
      }
      return F;
    }

    /** 縁LEDの土台の色。虹は JP・大成功・タイトルなど「虹Bを明示したイベント」の間だけ。
     *  それ以外は灯の数で決まる色(0〜3灯=紺・ごく弱く / 4・5灯=ピンク / 6灯=金)で、イベントが baseTint で上書きできる(重複ルーレット=赤)。
     *  虹との切り替えはなめらかに混ぜる。色は add に足すので、stage(3Dデモ)・LightAdapter・本番のどれでも同じ式で出る。 */
    edgeBase(F, nn, dt) {
      const E = F.edge, ov = E.tintOv;
      const T = ov || ([[.02, .06, .45, .06], [.02, .06, .45, .22], [.03, .08, .5, .3], [.04, .1, .55, .4], [1, .08, .38, .85], [1, .2, .15, 1.15], [1, .36, .012, 1.1]][nn]);
      const rbT = E.rbOn ? 1 : 0, k = Math.min(1, dt * 3.5);
      this.rbMix = (this.rbMix ?? rbT) + (rbT - (this.rbMix ?? rbT)) * k;
      const tc = this.tintC || (this.tintC = T.slice()); for (let q = 0; q < 4; q++) tc[q] += (T[q] - tc[q]) * Math.min(1, dt * 4);
      const rb = this.rbMix, dim = Math.max(.04, this.dimV ?? 1), breathe = .88 + .12 * Math.sin(TAU * this.t / 3.4);
      E.base.amount = E.base.amount * rb;   // dim は上流で掛かっている
      const lv = tc[3] * (1 - rb) * dim * breathe;
      if (lv > .001) for (let i = 0; i < this.nE; i++) for (let q = 0; q < 3; q++) E.add[i * 3 + q] += tc[q] * lv;
    }

    applyTrack(F, inst, tr, lt, n) {
      const p = tr.p || {}, u = clamp((lt - tr.t0) / Math.max(tr.t1 - tr.t0, 1e-6)), lt0 = lt - tr.t0, dur = tr.t1 - tr.t0;
      const lane = tr.lane, pat = tr.pat; if (!pat) return;
      const isP = lane === 'petal', isE = lane === 'edge';
      if (!(isP || isE || lane === 'pocket' || lane === 'logo' || lane === 'ambient' || lane === 'seg' || lane === 'btn')) return;
      // These patterns emit their cue in step(), but never write a light value.
      if (pat === 'hold' || pat === 'stateN' || pat === 'drainLit' || pat === 'shimmer' || pat === 'count' || pat === 'payout' || pat === 'collect' || pat === 'ambientLcd') return;
      const N = isP ? this.nP : isE ? this.nE : lane === 'pocket' ? 7 : lane === 'btn' ? 2 : 1;
      const sel = isP ? this.petalSel(p.targets, { ...inst.params, ...p }) : isE ? this.edgeSel(p.targets) : lane === 'pocket' ? this.pocketSel(p.targets) : lane === 'btn' ? Float32Array.from([p.side === 'right' ? 0 : 1, p.side === 'left' ? 0 : 1]) : new Float32Array(1).fill(1);
      const pos = isP ? this.pAng : isE ? this.eS : Array.from({ length: N }, (_, i) => i / N);   // 0..1 周回位置
      let col = p.color === 'rainbow' ? null : p.color === 'rank' ? RK[Math.max(0, Math.min(5, this.state.rank || 0))] : (Array.isArray(p.color) ? p.color : p.color ? color(p.color) : COL.white);
      const colAt = (i, extra = 0) => col || hsv(((pos ? pos[i] : i / N) - lt * .35 + extra) % 1 + (((pos ? pos[i] : i / N) - lt * .35 + extra) % 1 < 0 ? 1 : 0));
      // 書き込みヘルパ(laneごとの出力先)
      const add = (i, c, k) => {
        if (isP) { F.petal[i * 3] += c[0] * k; F.petal[i * 3 + 1] += c[1] * k; F.petal[i * 3 + 2] += c[2] * k; }
        else if (isE) { F.edge.add[i * 3] += c[0] * k; F.edge.add[i * 3 + 1] += c[1] * k; F.edge.add[i * 3 + 2] += c[2] * k; }
        else if (lane === 'pocket') { F.pocket[i * 3] += c[0] * k; F.pocket[i * 3 + 1] += c[1] * k; F.pocket[i * 3 + 2] += c[2] * k; }
        else if (lane === 'logo') { F.logo[0] += c[0] * k; F.logo[1] += c[1] * k; F.logo[2] += c[2] * k; }
        else if (lane === 'btn') { F.btn[i * 3] += c[0] * k; F.btn[i * 3 + 1] += c[1] * k; F.btn[i * 3 + 2] += c[2] * k; }
      };
      const over = (i, c, k) => {   // 現在の値を c*強さ で置き換える(aは混合率)
        const a = clamp(k.a === undefined ? 1 : k.a), v = k.v === undefined ? 1 : k.v;
        if (isP) { for (let q = 0; q < 3; q++) F.petal[i * 3 + q] = lerp(F.petal[i * 3 + q], c[q] * v, a); }
        else if (isE) { for (let q = 0; q < 3; q++) F.edge.ovr[i * 3 + q] = lerp(F.edge.ovrA[i] > 0 ? F.edge.ovr[i * 3 + q] : 0, c[q] * v, a); F.edge.ovrA[i] = Math.max(F.edge.ovrA[i], a); }
        else if (lane === 'pocket') { for (let q = 0; q < 3; q++) F.pocket[i * 3 + q] = lerp(F.pocket[i * 3 + q], c[q] * v, a); }
        else if (lane === 'logo') { for (let q = 0; q < 3; q++) F.logo[q] = lerp(F.logo[q], c[q] * v, a); }
        else if (lane === 'btn') { for (let q = 0; q < 3; q++) F.btn[i * 3 + q] = lerp(F.btn[i * 3 + q], c[q] * v, a); }
      };
      const mulAll = (f, selI) => {
        for (let i = 0; i < N; i++) { const w = selI ? selI[i] : 1; const ff = lerp(1, f, w);
          if (isP) { F.petal[i * 3] *= ff; F.petal[i * 3 + 1] *= ff; F.petal[i * 3 + 2] *= ff; }
          else if (isE) { F.edge.mul[i] *= ff; F.edge.add[i * 3] *= ff; F.edge.add[i * 3 + 1] *= ff; F.edge.add[i * 3 + 2] *= ff; F.edge.ovrA[i] *= ff; }
          else if (lane === 'pocket') { F.pocket[i * 3] *= ff; F.pocket[i * 3 + 1] *= ff; F.pocket[i * 3 + 2] *= ff; }
          else { F.logo[0] *= ff; F.logo[1] *= ff; F.logo[2] *= ff; } }
      };
      const fadeEnv = (a = .12, b = .2) => Math.min(smooth(lt0 / a), smooth((dur - lt0) / b));
      const headDist = (i, head, wrap = true) => { let d = Math.abs(pos[i] - head); if (wrap) d = Math.min(d, 1 - d); return d; };
      const cc = p.color === 'rainbow';

      switch (pat) {
        case 'blackout': {
          const lv = p.level === undefined ? 0 : p.level; const f = lerp(1, lv, smooth(lt0 / .12));
          if (lane !== 'ambient') mulAll(f, sel); break; }
        case 'hold': break;
        case 'fade': {
          const to = p.to; if (to === 'off' || to === 'n0') mulAll(1 - smooth(u), sel);
          else if (to === 'stateN') mulAll(smooth(u), sel); break; }
        case 'solid': {
          const e = fadeEnv(.12, .25); for (let i = 0; i < N; i++) if (sel[i]) over(i, colAt(i), { a: e, v: p.level || 1 }); break; }
        case 'pburst': {   // 穴のLED: 入った/外れた瞬間の強い閃光。最大値で立ち上がり、数回ちかちかしながら減る(R2-E 10/18: 穴の入賞が地味)
          const peak = p.peak === undefined ? 4.4 : p.peak, dec = p.decay === undefined ? 2.4 : p.decay, hz = p.hz || 7;
          const hold = p.hold === undefined ? .3 : p.hold, lh = Math.max(0, lt0 - hold);   // 入った直後 hold 秒は最大で保つ(10/18 監督: 入賞の光が地味。一瞬では見えない)
          const w = Math.exp(-lh * dec) * (lt0 < hold ? 1 : .4 + .6 * (.5 + .5 * Math.cos(TAU * hz * lh))) * (1 - Math.exp(-lt0 * 90)) * smooth((dur - lt0) / .2);
          for (let i = 0; i < N; i++) if (sel[i]) add(i, colAt(i), w * peak); break; }
        case 'pbeat': {   // 穴のLED: 狙う穴へ誘う脈打ち。穴ごとに位相をずらして端から端へ波が走る(wave=穴1つぶんの位相のずれ)。floor=谷の明るさ
          const hz = p.hz || 2, wave = p.wave || 0, sharp = p.sharp || 1, floor = p.floor === undefined ? .15 : p.floor, peak = p.peak === undefined ? 5 : p.peak;
          for (let i = 0; i < N; i++) if (sel[i]) {
            const sv = .5 + .5 * Math.sin(TAU * (hz * lt0 - wave * i) - Math.PI / 2), w = floor + (1 - floor) * Math.pow(sv, sharp);
            add(i, colAt(i), w * peak * fadeEnv(.08, .2));
          } break; }
        case 'pulse': case 'flicker': {
          const hz = p.hz || 2, depth = p.depth === undefined ? 1 : p.depth;
          for (let i = 0; i < N; i++) if (sel[i]) {
            let w = pat === 'flicker' ? (hash(i, Math.floor(lt * 14)) > .55 ? 1 : .15) : .5 + .5 * Math.sin(TAU * hz * lt0 - Math.PI / 2);
            add(i, colAt(i), w * depth * fadeEnv(.06, .15) * (isP ? .9 : isE ? 1.6 : 1.2));
          } break; }
        case 'stutter': {   // 点く前の明滅: 花びらが勝手にチカチカ(消灯と点灯が入れ替わる。だんだん速く)。一斉に点く前の予感
          const rate = 5 + 7 * u, bin = Math.floor(lt0 * rate), e = smooth(lt0 / .06), allOff = hash(77, bin) > .55;   // 離れた塊ごと(6枚単位)に消灯/点灯が入れ替わり、ときどき全消灯。映像でも消えたと分かる
          for (let i = 0; i < N; i++) if (sel[i]) over(i, colAt(i), { a: e, v: allOff ? .02 : hash(Math.floor(i / 6), bin + 5) > .45 ? 1.4 : .02 }); break; }
        case 'blinkN': {   // 全体がはっきり消えて点く、を times 回(4灯前の予告。回を重ねるごとに強く)
          const n = p.times || 3, cyc = dur / n, k = Math.min(n - 1, Math.floor(lt0 / cyc)), ph = (lt0 - k * cyc) / cyc, on = ph < .55;
          for (let i = 0; i < N; i++) if (sel[i]) over(i, colAt(i), { a: 1, v: on ? 1.1 + .35 * k : .02 }); break; }
        case 'breathe': {
          const per = p.period || 3; const w = lerp(.55, 1.15, .5 + .5 * Math.sin(TAU * lt0 / per - Math.PI / 2)) * smooth(lt0 / .25);
          for (let i = 0; i < N; i++) if (sel[i]) over(i, colAt(i), { a: smooth(lt0 / .25) * fadeEnv(.25, .3), v: w * (isE ? 1.4 : 1) }); break; }
        case 'flash': {
          const hz = Math.min(p.hz || 2, 3), lim = p.limit || 99; const k = Math.floor(lt0 * hz);
          if (k < lim) { const ph = lt0 * hz - k; const w = Math.exp(-ph * 5.5) * (1 - Math.exp(-ph * 16));   // 立ち上がりを数フレームに(暗→一気に白、の1コマを作らない)
            for (let i = 0; i < N; i++) if (sel[i]) add(i, colAt(i), w * (isP ? 1.6 : isE ? 3.2 : 1.8)); }
          break; }
        case 'bloom': {
          const w = (1 - Math.exp(-lt0 * 40)) * Math.exp(-lt0 * 2.6);
          for (let i = 0; i < N; i++) if (sel[i]) add(i, colAt(i), w * (isP ? 1.8 : 3)); break; }
        case 'chase': case 'orbit': {
          const spd = p.speed || .5, dirv = p.dir === 'up' || p.dir === 'ccw' ? -1 : 1, wid = p.width || (pat === 'orbit' ? .28 : .16);
          if (pat === 'chase' && isP && p.targets === 'lowerSides') {
            // 払い出し口側(下)から上へ: 縦位置で進む
            const head = 1 - ((lt0 * spd * .6) % 1);
            for (let i = 0; i < N; i++) if (sel[i]) { const v = this.G.petals[i].v; const d = Math.abs(v - lerp(.2, .95, head)); add(i, colAt(i), Math.exp(-Math.pow(d / .12,2)) * 1.6 * fadeEnv()); }
            break; }
          if (pat === 'chase' && lane === 'pocket') { const head = (lt0 * spd) % 8; for (let i = 0; i < 7; i++) { const d = Math.abs(i - head); add(i, colAt(i), Math.exp(-d * d * 1.5) * 1.4 * fadeEnv(.1, .2)); } break; }
          const head = ((dirv * lt0 * spd) % 1 + 1) % 1;
          if (isP && p.targets === 'top3') {
            const order = { p1: 0, p2: 1, p4: 2 }; const h2 = (lt0 * spd * 3) % 3;
            for (let i = 0; i < N; i++) if (sel[i]) { const d = Math.abs(order[this.petalIds[i]] - h2); add(i, colAt(i), Math.exp(-d * d * 1.8) * 1.5 * fadeEnv(.1, .2)); }
            break; }
          for (let i = 0; i < N; i++) if (sel[i]) { const d = headDist(i, head); const w = Math.exp(-Math.pow(d / wid,2) * 2); add(i, colAt(i, -head), w * (isP ? (pat === 'orbit' ? 1.1 : 1.5) : 3.0) * fadeEnv(.15, .3)); }
          break; }
        case 'comet': {
          const turns = typeof p.turns === 'number' ? p.turns : (p.turns === 'rank' ? Math.max(1, this.state.rank) : 1);
          let o = 0; if (p.origin === 'pocket') o = this.pocketOriginS(inst.params.target ?? inst.params.pocket);
          const head = (o + turns * u) % 1;
          for (let i = 0; i < N; i++) if (sel[i]) { const d = ((head - pos[i]) % 1 + 1) % 1; const w = d < .3 ? Math.exp(-d * 11) : 0; const w0 = Math.exp(-Math.pow(Math.min(d, 1 - d) / .03,2));
            add(i, colAt(i, -head), (w + w0) * (isP ? 1 : 3.2) * fadeEnv(.04, .2)); }
          break; }
        case 'needle': {
          const th = (this.state.needle != null && inst.id === 'roulette') ? this.state.needle : this.needleTheta(inst, lt - 0, tr);   // 0..1 周回位置(12時=0,時計回り)
          F.__needle = th;
          const wid = isP ? .075 : .045; for (let i = 0; i < N; i++) if (sel[i]) { const d = headDist(i, th); const w = Math.exp(-Math.pow(d / wid,2)); add(i, colAt(i, -th), w * (isP ? 1.7 : 3.4) * smooth(lt0 / .12)); const d2 = headDist(i, (th + .5) % 1), w2 = Math.exp(-Math.pow(d2 / (wid * 1.4), 2)); add(i, colAt(i, -th), w2 * (isP ? .42 : .8) * smooth(lt0 / .12)); }   // 反対側にも淡い灯(左右の釣り合い)
          if (isP) { const f = lerp(1, .0, smooth(lt0 / .2)); /* 他の花びらは暗い(赤の1点だけを見せる) */ }
          break; }
        case 'ripple': {
          const o = p.origin === 'bottom-right' ? .5 : p.origin === 'pocket' ? this.pocketOriginS(inst.params.target ?? inst.params.pocket) : 0;
          const r = u * 1.1; for (let i = 0; i < N; i++) if (sel[i]) { const d = isE ? headDist(i, o) * 2 : Math.hypot(this.G.petals[i].u - .5, this.G.petals[i].v - .7) * 1.4; const w = Math.exp(-Math.pow((d - r) / .13,2)) * (1 - u); add(i, colAt(i), w * (isP ? 1.1 : 2.8)); }
          break; }
        case 'sweep': {
          const dirv = p.axis === 'up' ? -1 : 1; if (lane === 'seg') { const q = lt0 / (p.period || 2) * 6 - .5; for (let m = 0; m < 5; m++) F.seg.meter[m] = Math.exp(-((m + .5 - q * .85) ** 2)); F.seg.mode = 'sweep'; break; }
          const head = dirv > 0 ? u * 1.5 - .25 : 1.25 - u * 1.5;
          for (let i = 0; i < N; i++) if (sel[i]) { const v = isE ? 1 - this.G.edge[i].by : this.G.petals[i].v; const d = Math.abs(v - head); add(i, colAt(i), Math.exp(-Math.pow(d / .14,2)) * (isP ? 1.5 : 3)); }
          break; }
        case 'heartbeat': {
          const bp = 60 / (p.bpm || 80), ph = (lt0 % bp) / bp; const w = Math.exp(-Math.pow((ph - .08) / .05,2)) + .55 * Math.exp(-Math.pow((ph - .3) / .06,2));
          for (let i = 0; i < N; i++) if (sel[i]) add(i, colAt(i), (.1 + w) * (isP ? 1.5 : 3) * smooth(lt0 / .3)); break; }
        case 'sparkle': {
          const dens = p.density || .4, bin = Math.floor(lt0 * 9);
          for (let i = 0; i < N; i++) if (sel[i] && hash(i, bin + 77) < dens * .35) { const ph = (lt0 * 9) % 1; add(i, [1, .75, .9], Math.exp(-ph * 4) * (isP ? 1.2 : 2.4)); } break; }
        case 'rainbowB': { F.edge.base.amount = (p.amount === 'n' ? F.edge.base.amount : p.amount) || 1; F.edge.base.speed = p.speed || 1; F.edge.rbOn = true; break; }
        case 'baseTint': { const c = p.color === 'rank' ? RK[Math.max(0, Math.min(5, this.state.rank || 0))] : color(p.color || '#ff2f86'); F.edge.tintOv = [c[0], c[1], c[2], p.level ?? 1]; break; }
        case 'rainbowFlow': {
          for (let i = 0; i < N; i++) if (sel[i]) { const c = hsv(((this.pAng[i] * 1 - lt0 * (p.speed || .5)) % 1 + 1) % 1); const e = smooth(lt0 / .3) * fadeEnv(.1, .6); over(i, c, { a: e, v: 1.1 + .35 * Math.sin(TAU * (lt0 * 1.4 - this.pAng[i] * 2)) }); } break; }
        case 'countdown': {
          const nn = p.n || 10; const lit = Math.ceil(this.nE * (1 - u)); const c = colAt(0);
          for (let i = 0; i < this.nE; i++) { const rank = (i + this.nE * .5) % this.nE; /* 上辺中央から時計回りに消える */ const on = rank < lit; const secF = (lt0 * 1) % 1;
            if (on) add(i, c, 1.2 + .8 * Math.exp(-secF * 5)); } break; }
        case 'drain': {
          for (let i = 0; i < N; i++) { const v = this.G.petals[i].v; const th = u * 1.3 - .15 + 0; const w = smooth((th - (v - .0)) / .18); const f = 1 - clamp(w); F.petal[i * 3] *= f; F.petal[i * 3 + 1] *= f; F.petal[i * 3 + 2] *= f; } break; }
        case 'ascendPetals': {
          const k = Math.max(1, Number(inst.params.k) || 1), from = Math.max(inst.params.n_from || this.state.lastN || 1, k);
          const slot = dur / (k + .2); const idx = Math.min(k, Math.floor(lt0 / slot)); this.dispN = Math.max(0, from - idx);
          const ph = (lt0 % slot) / slot; const head = 1.15 - ph * 1.4;
          for (let i = 0; i < N; i++) { const v = this.G.petals[i].v; const d = Math.abs(v - head); add(i, COL.paleGold, Math.exp(-Math.pow(d / .13,2)) * 1.3); }
          break; }
        case 'recolor': {   // いま点いている花びらを c に塗り替えて脈打たせる(勝負・赤)
          const bp = 60 / (p.bpm || 96), ph = (lt0 % bp) / bp, w = .55 + .75 * Math.exp(-Math.pow((ph - .1) / .09, 2)) + .4 * Math.exp(-Math.pow((ph - .32) / .07, 2));
          for (let i = 0; i < N; i++) { const L = F.petal[i * 3] * .2126 + F.petal[i * 3 + 1] * .7152 + F.petal[i * 3 + 2] * .0722; if (isP && L > .01) over(i, colAt(i), { a: smooth(lt0 / .3), v: Math.min(1.6, (L * 1.4 + .35)) * w }); } break; }
        case 'alt': {   // 2グループが交互に点滅(全体の明るさはほぼ一定。実機の電飾の「チカチカ」。hzは交互の速さ)
          const hz = p.hz || 6, ph = Math.floor(lt0 * hz * 2), c2 = p.color2 ? color(p.color2) : COL.white;
          for (let i = 0; i < N; i++) if (sel[i]) { const g = ((isP ? this.petalOrder(i) + (this.G.petals[i].zone || 0) : i) + ph) % 2; add(i, g ? (cc ? hsv(((pos[i] - lt0 * .5) % 1 + 1) % 1) : colAt(i)) : c2, (isP ? 1.2 : 2.4) * fadeEnv(.08, .2)); } break; }
        case 'stateN': break;
        case 'gauge': {
          const total = inst.params.progress === undefined ? u : inst.params.progress; const c = colAt(0);
          for (let i = 0; i < N; i++) { const rank = (this.G.petals[i].zone * 12 + this.petalOrder(i)) / 48; if (rank < total) add(i, c, .95); } break; }
        case 'rankBloom': {
          const rk = Math.max(0, Math.min(5, this.state.rank || 0)); const c = RK[rk];
          for (let i = 0; i < N; i++) { const e = smooth(lt0 / .4) * (1 - Math.exp(-lt0 * 2)); const cc2 = c || hsv(((this.pAng[i] - lt0 * .5) % 1 + 1) % 1); over(i, cc2, { a: e, v: 1.0 + .3 * Math.sin(TAU * (lt0 * 1.2 - this.pAng[i])) }); } break; }
        case 'drainLit': { const k = inst.params.k || 1; const gone = clamp(Math.floor(lt0 / (dur / (k + .2)))); /* ポケット側は状態更新で消える */ break; }
        case 'shimmer': break;
        case 'count': case 'payout': case 'collect': case 'ambientLcd': break;
        default: break;
      }
    }
    // 初見ヒントのLED(R2-TU の依頼)。Effects.hint が state.hint にセットする。holes: ランプの無い穴をやわらかく呼吸(soft) / 1つの穴を強く(steady)。button: ボタンを呼吸。
    hintLights(F, t) {
      const H = this.state.hint; if (!H) return;
      const lit = this.state.litPockets;
      if (H.holes) {
        const h = H.holes; if (h.until > 0 && t > h.until) H.holes = null; else {
          const ph = Math.max(0, t - h.t0), ramp = Math.min(smooth(ph / .3), h.until > 0 ? smooth((h.until - t) / .3) : 1);
          for (let i = 0; i < 7; i++) {
            const on = h.pockets === 'unlit' ? !lit.includes(i + 1) : (h.pockets || []).includes(i + 1); if (!on) continue;
            if (h.mode === 'red') { const w = ramp * 5.4; F.pocket[i * 3] += 1 * w; F.pocket[i * 3 + 1] += .04 * w; F.pocket[i * 3 + 2] += .07 * w; }
            else if (h.mode === 'steady') { const w = (.65 + .35 * (.5 + .5 * Math.sin(TAU * 2.2 * ph))) * ramp * 5; F.pocket[i * 3] += 1 * w; F.pocket[i * 3 + 1] += .8 * w; F.pocket[i * 3 + 2] += .2 * w; }
            else { const w = (.3 + .7 * (.5 + .5 * Math.sin(TAU * (.8 * ph - .1 * i) - Math.PI / 2))) * ramp * 2.6; F.pocket[i * 3] += .5 * w; F.pocket[i * 3 + 1] += .82 * w; F.pocket[i * 3 + 2] += 1 * w; }
          }
        }
      }
      if (H.button) {
        const b = H.button; if (b.until > 0 && t > b.until) H.button = null; else {
          const ph = Math.max(0, t - b.t0), ramp = Math.min(smooth(ph / .25), b.until > 0 ? smooth((b.until - t) / .3) : 1), w = (.35 + .65 * (.5 + .5 * Math.sin(TAU * 1.3 * ph - Math.PI / 2))) * ramp * 1.5;
          const c = b.side === 'right' ? [1, .62, .06] : [1, .32, .6], o = b.side === 'right' ? 3 : 0;
          for (let q = 0; q < 3; q++) F.btn[o + q] += c[q] * w;
        }
      }
      if (!H.holes && !H.button) this.state.hint = null;
    }
    btnAmbient(F, t, n) {
      const S = this.state, tut = S.tut || {}, act = (id) => this.inst.some((x) => x.id === id);
      const MUTE = ['roulette', 'ascend', 'fail', 'jp', 'finish_count', 'result', 'timeup', 'challenge_declare'];
      if (MUTE.some(act)) return;
      const L = [1, .32, .6], R = [1, .62, .06], br = (hz, lo, hi) => lo + (hi - lo) * (.5 + .5 * Math.sin(TAU * hz * t - Math.PI / 2));
      let l = 0, r = 0;
      if (S.canLaunch !== false) l = tut.firstShot === false ? br(1.6, .35, 1.0) : br(.45, .22, .4);
      if (S.declared) { r = br(3.0, .5, 1.0); l = Math.max(l, br(2.0, .4, .9)); this.rCol = [1, .35, .05]; }
      else { this.rCol = R; if (n >= 2 && n <= 5) r = tut.firstDeclare === false ? br(1.4, .45, 1.0) : n >= 4 ? br(1.8, .45, .95) : br(.5, .2, .38); }
      if (act('timeup')) { l = 0; }
      for (let q = 0; q < 3; q++) { F.btn[q] += L[q] * l; F.btn[3 + q] += this.rCol[q] * r; }
    }
    petalOrder(i) { const id = this.petalIds[i]; const order = ['p1', 'p2', 'p4', 'l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'l4', 'r4']; return order.indexOf(id); }
    pocketSel(targets) {
      const a = new Float32Array(7), lit = this.state.litPockets;
      for (let i = 0; i < 7; i++) { const t = targets || 'all'; a[i] = t === 'all' ? 1 : t === 'lit' ? (lit.includes(i + 1) ? 1 : 0) : t === 'unlit' ? (lit.includes(i + 1) ? 0 : 1) : t === 'hit' ? (this.state.hitPocket === i + 1 ? 1 : 0) : t === 'target' ? (this.state.targetPocket === i + 1 ? 1 : 0) : 1; }
      return a;
    }
    pocketOriginS(k) { /* 穴の番号(1..7)から縁の周回位置の近似: 下辺の左→右が逆時計回りなので 0.53..0.72 */ const x = ((k || 4) - 1) / 6; return 0.72 - x * .19; }
    // 重複ルーレットの針の角度(液晶と同じ曲線にそろえる): 最初に最高速→連続減速→最後に長いため
    needleTheta(inst, lt, tr) {
      const u = clamp((lt - tr.t0) / (tr.t1 - tr.t0)); const w0 = 5.0; // 周/秒の最高速
      const total = inst.params.turns || 3.6; // 全周回数
      // 減速曲線: 角度 = total * (1-(1-u)^3.2)。最後の速度は0へ
      const ang = total * (1 - Math.pow(1 - u, 3.2));
      return ((inst.params.stopAt === undefined ? .33 : inst.params.stopAt) + (ang - total)) % 1 + 1;
    }
  }

  const api = { Director, COL, hsv, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LightBus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
