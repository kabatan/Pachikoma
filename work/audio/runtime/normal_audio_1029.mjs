// 通常時(JPより前)の効果音の差し替え(2026-10-29 R3)。?normalsfx=0 で無効(従来の合成音に戻る)。
// 仕組み: sfx/n_*.wav(game_sfx_1029/normal が原本)を起動時に読み、engine.buffers の同名キュー(lamp1〜6・protect・launch・ticket・start・warn10・overflow)を差し替える。
// catalog.mjs のイベント→キュー対応・gain・cooldownはそのまま使う(JP・成功・失敗・勝負・結果などは触らない)。
// 映像の出来事に音の頭を合わせるため、各wavの頭に「穴入りのコッ→ため」を焼き込み、映像のフラッシュのコマに一撃が来る(meta.json の hit)。
//   映像側が2種類ある灯3・灯4は、映像と同じ数え方(灯数ごとの発生回数、attract/ticketで0に戻る)で音の種類も選ぶ。
//   重複(保護)はengineが再生速度を1/2/0.5倍に振るため時刻がずれる。sequenceを0に戻して等倍に固定し、音の高さの違いは3種のwavで出す。
//   発射は4種を巡回(連打で機械的にならない)。
const NAMES = ['n_lamp1','n_lamp2','n_lamp3','n_lamp3b','n_lamp4','n_lamp4b','n_lamp5','n_lamp6','n_protect0','n_protect1','n_protect2','n_launch0','n_launch1','n_launch2','n_launch3','n_ticket','n_start','n_warn10','n_overflow','n_attract_loop'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export async function installNormalAudio1029(engine, { base = new URL('../sfx/', import.meta.url) } = {}) {
  const ctx = engine.ctx, B = {};
  await Promise.all(NAMES.map(async name => {
    const r = await fetch(new URL(name + '.wav', base)); if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
    B[name] = await ctx.decodeAudioData(await r.arrayBuffer());
  }));
  for (const [cue, name] of [['lamp1','n_lamp1'],['lamp2','n_lamp2'],['lamp3','n_lamp3'],['lamp4','n_lamp4'],['lamp5','n_lamp5'],['lamp6','n_lamp6'],['protect','n_protect0'],['launch','n_launch0'],['ticket','n_ticket'],['start','n_start'],['warn10','n_warn10'],['overflow','n_overflow']]) engine.buffers.set(cue, B[name]);
  // 待機(タイトル)の曲。r2のBGMには待機の曲が無く、起動直後のattractイベントはこの接続より前に出てしまうため、
  // 取り込み時の局面(Attract)と、あとから来る attract/title イベント(リセット後を含む)で鳴らし、ticket/howto/start で止める。BGMの音量・消音(bgm.userGain)に従う。
  const wait = ctx.createGain(); wait.gain.value = 0; wait.connect(engine.bgm.userGain);
  let waitSrc = null;
  const waitOn = () => { if (waitSrc) return; const s = ctx.createBufferSource(); s.buffer = B.n_attract_loop; s.loop = true; s.connect(wait); s.start(ctx.currentTime + .01); waitSrc = s; wait.gain.cancelScheduledValues(ctx.currentTime); wait.gain.setTargetAtTime(1, ctx.currentTime, .25); st.log.push([+ctx.currentTime.toFixed(3), 'wait_on']); };
  const waitOff = () => { if (!waitSrc) return; const s = waitSrc; waitSrc = null; wait.gain.cancelScheduledValues(ctx.currentTime); wait.gain.setTargetAtTime(0, ctx.currentTime, .12); try { s.stop(ctx.currentTime + .6); } catch {} s.onended = () => s.disconnect(); st.log.push([+ctx.currentTime.toFixed(3), 'wait_off']); };
  const st = { variants: {}, launch: 0, protect: 0, log: [] };
  const use = (cue, name, e) => { engine.buffers.set(cue, B[name]); st.log.push([+ctx.currentTime.toFixed(3), e.id, name]); if (st.log.length > 300) st.log.shift(); };
  const prev = engine.handleEvent.bind(engine);
  const hook = e => {
    switch (e.id) {
      case 'attract': st.variants = {}; waitOn(); break;
      case 'title': waitOn(); break;
      case 'ticket': st.variants = {}; waitOff(); break;
      case 'howto': case 'start': waitOff(); break;
      case 'lamp123': case 'lamp4': case 'lamp5': case 'lamp6': {
        const n = e.data?.after?.length ?? e.data?.n ?? e.state?.lit ?? 1, count = st.variants[n] ?? 0; st.variants[n] = count + 1;   // 映像(normal_surface)と同じ数え方
        if (e.id === 'lamp123') { const k = clamp(e.state?.lit || e.data?.n || 1, 1, 3); use('lamp' + k, k === 3 && count % 2 ? 'n_lamp3b' : 'n_lamp' + k, e); }
        else if (e.id === 'lamp4') use('lamp4', count % 2 ? 'n_lamp4b' : 'n_lamp4', e);
        break;
      }
      case 'dup_protect': engine.sequence = 0; use('protect', 'n_protect' + (st.protect++ % 3), e); break;
      case 'launch': use('launch', 'n_launch' + (st.launch++ % 4), e); break;
    }
    return prev(e);
  };
  engine.handleEvent = hook;
  let phase = null; try { phase = engine.getPhase(); } catch {}
  if (phase == null || phase === 'Attract') waitOn();   // 起動直後(最初のattractは取りこぼす)
  return { buffers: B, state: st, dispose() { waitOff(); if (engine.handleEvent === hook) engine.handleEvent = prev; } };
}
