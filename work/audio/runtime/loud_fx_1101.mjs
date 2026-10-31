// 11/1 超つくこまRUSH・継続の決めの音を「紫の雷」と同等の大きさにする(声なし)。監督「雷は迫力があるが、RUSHや継続の音は足りない」。
// 作り: 実機パチンコの決めの構成(低音の衝撃 → 金属の打撃+ひび → ブラスの太い和音+ティンパニ → シンバル・金属の雨、決めの前の溜め=上昇音と一瞬の静けさ)。
//   音は全部合成(work/audio/loud_fx_1101/src/synth_loud.py)。起動時にデコードするだけで、プレイ中の合成はしない。
// 鳴らし方は雷(jp_start_1031.mjs)と同じ: 新しい音は圧縮機の後(engine.master の入口、+6.3dB 固定)へ直接入れ、決めの前後だけ他の音(engine.mix と engine.hot)を絞る。
//   絞りは「その瞬間だけ」(決めの手前から沈め、保って、戻す)。常時鳴る層は作らない。新しい音は飽和・天井込みで作ってあるので、重なっても潰れない。
// 場面は lcd.jp.where()(name・serial・f=元の映像のコマ)を読むだけ。fx_trim の skip(飛ばすコマ)は場面の manifest から読んで差し引く。規則・液晶は変更しない。
// 無効化: ?fxloud=0(読み込まない=従来の音)。音量の目安は work/audio/loud_fx_1101/NOTES.md。
const dB = x => 10 ** (x / 20);
const JPMIX = new URLSearchParams(globalThis.location?.search ?? '').get('jpmix') !== '0';
const FPS = 30, AHEAD = 0.14;            // 4コマ先まで予約(決めの手前から絞るため)
// seal: メーターの進み(jp_aim_seal_dN_bK / _open)。jpmix のときだけ(cues に無い key は何もしない)。K=1→b1、K>=2→b2、open→open。継続(chainMode)は cseal_*
const sceneKey = (n, chain = false) => { let m;
  if (n === 'jp_rush') return 'jp_rush'; if (n === 'chain_announce_cutin') return 'chain_announce_cutin'; if (n === 'chain_success') return 'chain_success'; if (/^chain_jp_land_d\d$/.test(n)) return 'chain_jp_land';
  if (JPMIX && (m = /^jp_aim_seal_d\d_(?:b(\d)|(open))$/.exec(n))) return (chain ? 'cseal_' : 'seal_') + (m[2] ? 'open' : 'b' + Math.min(+m[1], 2));
  if (/^jp_chance_d\d$/.test(n)) return JPMIX ? 'jp_chance' : null; if (/^reward_(30|40|100|200|500)$/.test(n)) return JPMIX ? n : null;
  return null; };

export async function installLoudFx(engine, { lcd, controller, cuesUrl: cuesUrl0 = new URL('../loud_fx_1101/cues.json', import.meta.url) } = {}) {
  const q = new URLSearchParams(globalThis.location?.search ?? ''); let cuesUrl = cuesUrl0;
  // ?loudkind=a|b|m: a=キュイン+高速アルペジオ(既定) b=サイレン+高音の持続キメ m=金属の打撃+ブラス(11/1 昼の版)。素材名 lf_x → lf_<kind>_x(m は lf_x のまま)
  // 11/1 ?jpmix=0 で今の音(kind r・cues.json)へ戻す。既定(jpmix)は kind j(JP曲の調=D/A長調に合わせた和音+共通の残響+絞りの型を実機に寄せた版・cues_j.json)
  // 既定=RUSHは今のまま(kind r)+JPチャンス・継続の封印・配当獲得の音を足す(cues_mix.json)。kind j は ?loudkind=j の試作(調に合わせた版)
  const KIND = ['a', 'b', 'm', 'r', 'j'].includes(q.get('loudkind')) ? q.get('loudkind') : 'r', fileOf = n => KIND === 'm' ? n : n.replace(/^lf_/, `lf_${KIND}_`);
  if (KIND === 'j') cuesUrl = new URL('cues_j.json', cuesUrl);
  const cues = await (await fetch(cuesUrl)).json();
  if (JPMIX && KIND === 'r') { try { const mix = await (await fetch(new URL('cues_mix.json', cuesUrl))).json(); Object.assign(cues.scenes, mix.scenes); cues.mix = mix.version; } catch (e) { console.warn('[loud-fx] cues_mix', e.message); } }
  const meta = await (await fetch(new URL('meta.json', cuesUrl))).json();
  const ctx = engine.ctx, now = () => ctx.currentTime;
  const used = new Set(); for (const list of Object.values(cues.scenes)) for (const c of list) if (c.s) used.add(c.s);
  const buffers = {}, missing = [];
  await Promise.all([...used].map(async n => { try { const r = await fetch(new URL(`sfx_ogg/${fileOf(n)}.ogg`, cuesUrl)); if (!r.ok) throw Error('HTTP ' + r.status); buffers[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { missing.push(n); } }));

  // 出口: 雷と同じ(+6.3dB 固定 → master)。絞りの対象にならない
  const out = ctx.createGain(); out.gain.value = dB(6.3 + (cues.out_db ?? 0)); out.connect(engine.master);
  const mixP = engine.mix?.gain, hotP = engine.hot?.gain;
  const base = new Map([[mixP, mixP?.value ?? 1], [hotP, hotP?.value ?? dB(6.3)]]);
  const api = { enabled: true, version: '1101.3', kind: KIND, jpmix: JPMIX, log: [], missing, played: 0, ducks: 0, buffers, cues, base, nodes: { out } };
  const sources = new Set();

  // ---- 絞り: 区間の重なりは深い方。区分線形で予約し直す(jp_audio_v5 と同じ方式。曲線イベントは重なると例外になるので使わない) ----
  const segs = [];
  const depthAt = x => { let m = 0; for (const s of segs) { if (x < s.a || x >= s.d) continue; const v = x < s.b ? s.depth * (x - s.a) / (s.b - s.a || 1e-6) : x < s.c ? s.depth : s.depth * (1 - (x - s.c) / (s.d - s.c)); if (v > m) m = v; } return m; };
  function duck(t, { d, pre = 0, hold = .2, rel = .4 }) {
    segs.push({ a: t - pre - .01, b: t - pre + .012, c: t + hold, d: t + hold + rel, depth: d });   // 沈みきるまで約0.02秒(決めの前に静かにする)
    const n = now(); for (let i = segs.length - 1; i >= 0; i--) if (segs[i].d < n) segs.splice(i, 1);
    const t0 = n + .003, t1 = Math.max(...segs.map(s => s.d)) + .02; if (t1 <= t0 + .01) return;
    const steps = Math.min(1200, Math.ceil((t1 - t0) / .005)), dt = (t1 - t0) / steps;
    for (const p of [mixP, hotP]) {
      if (!p) continue; const b = base.get(p);
      p.cancelScheduledValues(t0); p.setValueAtTime(b * dB(-depthAt(t0)), t0);
      let lastV, lastT, pending = false;
      for (let i = 1; i <= steps; i++) {
        const v = b * dB(-(i === steps ? 0 : depthAt(t0 + dt * i))), tt = t0 + dt * i;
        if (i > 1 && v === lastV) { lastT = tt; pending = true; continue; }
        if (pending) p.linearRampToValueAtTime(lastV, lastT);
        p.linearRampToValueAtTime(v, tt); lastV = v; lastT = tt; pending = false;
      }
      if (pending) p.linearRampToValueAtTime(lastV, lastT);
    }
    api.ducks++;
  }

  // ---- 発音 ----
  function play(name, start, db = 0) {
    const b = buffers[name]; if (!b || !api.enabled) return null;
    let at = start, off = 0; const nw = now() + .003;
    if (at < nw) { off = nw - at; at = nw; if (off >= b.duration - .03) return null; }
    const s = ctx.createBufferSource(); s.buffer = b; const g = ctx.createGain(); g.gain.value = dB(db); s.connect(g).connect(out); s.start(at, off);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { } sources.delete(s); }; sources.add(s); api.played++;
    api.log.push({ t: +at.toFixed(3), s: name, db, cut: off ? +off.toFixed(3) : undefined }); if (api.log.length > 300) api.log.shift(); return s;
  }

  // ---- 場面の見張り ----
  let cur = { key: null, id: null, fired: new Set(), name: null };
  const skipsOf = (name) => lcd?.jp?.man?.scenes?.[name]?.skip ?? [];
  const eff = (skips, f) => { let e = f; for (const [a, b] of skips) { if (f >= b) e -= b - a; else if (f > a) e -= f - a; } return e; };
  function tick() {
    const jp = lcd?.jp; const w = jp?.active ? jp.where() : null;
    if (!w || w.delay > 0) { if (!w) cur = { key: null, id: null, fired: new Set(), name: null }; return; }
    const key = sceneKey(w.name, !!jp.model?.chainMode); const id = w.name + '#' + w.serial;
    if (cur.id !== id) { cur = { key, id, fired: new Set(), name: w.name, lastF: -1 }; }
    if (!key) return;
    const list = cues.scenes[key], skips = skipsOf(w.name), t = now();
    const fcur = Number.isFinite(w.time) ? w.time * FPS : (w.f ?? 0), fe = eff(skips, fcur);   // 映像の時刻(コマ。小数)
    list.forEach((c, i) => {
      if (cur.fired.has(i)) return;
      if (skips.some(([a, b]) => c.f >= b && fcur < Math.min(c.f, b + 2) - .01)) return;   // 飛ばす区間の向こうの出来事は、映像が飛び先に着いて2コマ進んでから(飛んだ直後の止まりに音が先走らない)
      const T = t + (eff(skips, c.f) - fe) / FPS;                                  // その出来事の時刻(音の時計)
      const dur = c.s ? (buffers[c.s]?.duration ?? meta[fileOf(c.s)]?.dur ?? 0) : 0, anchor = c.s ? (meta[fileOf(c.s)]?.anchor ?? 0) : 0;
      const start = c.s ? (c.pre ? T - dur : T - anchor) : T;
      const lead = Math.min(start, T - (c.duck?.pre ?? 0) - .01);
      if (lead - t > AHEAD) return;
      cur.fired.add(i);
      if (T < t - .15) return;                                                      // 場面の途中から検知した古い出来事は鳴らさない
      if (!api.enabled) return;                                                    // api.enabled=false で一時的に従来の音へ(比較用)
      if (c.s) play(c.s, start, c.dbk?.[KIND] ?? c.db ?? 0);
      if (c.duck) duck(T, c.duck);
    });
  }
  const timer = setInterval(() => { if (ctx.state !== 'running') return; try { tick(); } catch (e) { if (!api.error) { api.error = e.message; console.error('[loud-fx]', e); } } }, 8);
  api.dispose = () => { clearInterval(timer); for (const s of sources) try { s.stop(); } catch { } try { out.disconnect(); } catch { } for (const p of [mixP, hotP]) if (p) { p.cancelScheduledValues(0); p.setValueAtTime(base.get(p), now()); } };
  console.info('[loud-fx] ready', Object.keys(buffers).length, 'sfx', missing.length ? 'MISSING ' + missing.join(',') : '');
  return api;
}
