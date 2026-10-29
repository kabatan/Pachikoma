// 通常時の音(BGM録音・演出SE・玉の音)をr2音響エンジンへ差し込む。?pachi=0で無効。JP(大当たり)の音・曲だけr2のまま。
// SE: pachi_synth.mjs の合成音でr2の同名キューを置き換える(点灯・重複・ルーレット・昇格・発射・開始・勝負・成功・時間切れ・計数・結果・タイトル・遊び方ほか)。
// 玉の音: modalSynthとpayoutCacheを差し替える。
// BGM: 録音曲(bgm/user/normal_loop.ogg)を通常・4灯以降・勝負中(高域を絞る)・成功の間も流す。r2の旧BGM(normal/pink/focus/成功)は同じ長さの無音に差し替えて時計と切替をそのまま使う。JPの曲だけ旧のまま。
// バランス: SEは録音BGMの+4〜6dBに収め、r2のduck(灯4以降 -5dB / 成功 -11dB)を -2.5dB / -7dB に和らげる。
import { CUE_MAKERS, pachiContact, payoutBuffer, preparePachiContact } from './pachi_synth.mjs';
import { createPocket, pocketCue } from './bgm_pocket.mjs';
import { winPlan, createWinSound } from './win_sound.mjs';

function toBuffer(ctx, [L, R]) { const b = ctx.createBuffer(2, L.length, ctx.sampleRate); b.copyToChannel(L, 0); b.copyToChannel(R, 1); return b; }
const idle = () => new Promise(r => setTimeout(r));   // 合成は1音ずつ区切って、読み込み画面の描画を止めない

// One prefix-bank generation per engine; previous partial builds drain before allocation.
const contactBanks = new WeakMap();
function beginContactBank(engine) {
  const previous = contactBanks.get(engine);previous?.release('reinstalled');
  let resolveDone;const done = new Promise(resolve => { resolveDone = resolve; });
  const state = { bank: null, building: false, cancelled: false,
    stats: { ready: false, bytes: 0, entries: 0, hits: 0, fallbacks: 0, disposed: false, sampleRate: engine.ctx.sampleRate },
    previousDrain: previous?.drain ?? Promise.resolve(), finish: resolveDone };
  state.drain = Promise.all([state.previousDrain, done]).then(() => {});
  state.isDisposed = () => state.cancelled || contactBanks.get(engine) !== state || engine.ctx.state === 'closed';
  state.assertCurrent = () => { if (state.isDisposed()) throw Error('Pachi contact installation cancelled'); };
  const previousDispose = engine.dispose;
  const disposeHook = function(...args) { state.release('engine-disposed');return previousDispose.apply(this,args); };
  state.release = reason => {
    state.cancelled = true;state.stats.releaseReason ??= reason;
    if (state.bank) {
      const bank = state.bank;state.bank = null;
      if (engine.modalSynth === bank.synth) engine.modalSynth = pachiContact;
      bank.dispose();
    }
    state.stats.ready = false;state.stats.disposed = true;
    if (engine.dispose === disposeHook) engine.dispose = previousDispose;
    if (contactBanks.get(engine) === state) contactBanks.delete(engine);
    if (!state.building) state.finish();
  };
  contactBanks.set(engine,state);engine.dispose = disposeHook;
  return state;
}
async function prepareContactBank(engine,state,sr) {
  await state.previousDrain;state.assertCurrent();state.building = true;
  let prepared;
  try {
    prepared = await preparePachiContact(sr,{yield:idle,maxBytes:160*1024*1024,isDisposed:state.isDisposed});
    state.stats = prepared.stats;
    if (state.isDisposed()) throw Error('Pachi contact installation cancelled');
    if (!prepared.stats.ready) {
      state.stats.reason = 'prepare-skipped:'+String(prepared.stats.skipped ?? prepared.stats.cancelled ?? 'not-ready').slice(0,100);
      prepared.dispose();console.warn('[pachi-contact-bank]',state.stats.reason);return;
    }
    if (engine.modalSynth !== pachiContact) {
      state.stats.reason = 'modal-synth-replaced';prepared.dispose();return;
    }
    state.bank = prepared;engine.modalSynth = prepared.synth;
  } catch (error) {
    prepared?.dispose();
    if (state.isDisposed()) throw error;
    state.stats.reason = 'prepare-failed:'+String(error?.message ?? error).slice(0,120);
    console.warn('[pachi-contact-bank]',state.stats.reason);
  } finally { state.building = false;state.finish(); }
}

export async function installPachiSound(engine, { bgmUrl = new URL('../bgm/user/normal_loop.ogg', import.meta.url), metaUrl = new URL('../bgm/user/normal_loop.json', import.meta.url) } = {}) {
  const ctx = engine.ctx, bgm = engine.bgm, sr = ctx.sampleRate, contactBank = beginContactBank(engine);
  try {
  for (const [name, make] of Object.entries(CUE_MAKERS)) { engine.buffers.set(name, toBuffer(ctx, make(sr))); await idle(); contactBank.assertCurrent(); }
  // 玉・釘・部品の接触。実機の玉の音は200〜1600Hzにも厚みがある(測定)ので、物理側の高域通過を3kHzから下げて残す
  contactBank.assertCurrent();engine.modalSynth = pachiContact; engine.cache.clear();
  await prepareContactBank(engine,contactBank,sr);contactBank.assertCurrent();
  engine.physicalHP.frequency.value = 120;
  for (let n = 1; n <= 8; n++) { engine.payoutCache.set(n, toBuffer(ctx, payoutBuffer(sr, n))); await idle(); contactBank.assertCurrent(); }

  const [meta, buffer] = await Promise.all([
    fetch(metaUrl).then(r => r.json()),
    fetch(bgmUrl).then(async r => { if (!r.ok) throw new Error('BGM HTTP ' + r.status); return ctx.decodeAudioData(await r.arrayBuffer()); }),
  ]);
  contactBank.assertCurrent();
  const loopStart = meta.loop_start_samples / meta.sample_rate, loopEnd = meta.loop_end_samples / meta.sample_rate;
  const out = ctx.createGain(); out.gain.value = 0;
  const tilt = ctx.createBiquadFilter(); tilt.type = 'highshelf'; tilt.frequency.value = 3500; tilt.gain.value = 0;   // 4灯以降は少し明るく
  const pocket = createPocket(ctx);
  // 勝負中は緊張感: 高域を絞って少し下げる(旧BGMのfocusに切り替えず、同じ曲を続ける)
  const focusLP = ctx.createBiquadFilter(); focusLP.type = 'lowpass'; focusLP.frequency.value = 22000; focusLP.Q.value = .6;
  const focusGain = ctx.createGain();
  out.connect(focusLP).connect(focusGain).connect(pocket.node).connect(tilt).connect(bgm.userGain);   // BGM音量・ミュート・SEのduckに従う
  // r2の旧BGM(normal/pink/focus/成功)は同じ長さの無音に差し替え、時計・切替・復帰の予定はそのまま使う。JPの曲(jp_*)は新しい曲ができるまで旧のまま
  const OLD = ['normal', 'pink', 'focus', 'success', 'success_short'];
  const silence = () => { for (const name of OLD) { const b = bgm.buffers.get(name); if (b && !b.__silent) { const s = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate); s.__silent = true; bgm.buffers.set(name, s); } } };
  await bgm.ready.catch(() => {});contactBank.assertCurrent();silence();

  // 効果音とBGMのバランス: r2のduckは灯4以降・ルーレットでBGMを-5dB下げる。録音BGMでは長い効果音の間ほぼ聞こえなくなるので-2.5dBに和らげる
  // (成功・JPのduck、声のduckはそのまま)
  const duckTarget = engine._duckTarget.bind(engine), SOFT_DUCK = 10 ** (-2.5 / 20), R2_DUCK = 10 ** (-5 / 20), WIN_DUCK = .28, SOFT_WIN = 10 ** (-7 / 20);
  const duckHook = (param, value, ...rest) => {
    if (param === engine.bgmInput.gain) {
      if (Math.abs(value - R2_DUCK) < 1e-6) value = SOFT_DUCK;   // 灯4以降・ルーレット
      else if (Math.abs(value - WIN_DUCK) < 1e-6 && !bgm.jpPlan) value = SOFT_WIN;   // 成功(小・大): -11dBは録音曲が消えるので-7dB
    }
    return duckTarget(param, value, ...rest);
  };
  engine._duckTarget = duckHook;
  // 成功(小・大)の勝ち音: r2が起動時に旧の音から組んだキャッシュを捨て、新しい音から組み直す(払い出し開始までの長さに合わせる処理はr2のまま)
  for (const key of [...engine.winCache.keys()]) if (key.startsWith('success_')) engine.winCache.delete(key);
  for (const id of ['success_small', 'success_big']) { const plan = winPlan({ id }, engine.winTiming); if (plan) engine.winCache.set(plan.id + ':' + plan.duration, createWinSound(ctx, engine.buffers, engine.winTiming, plan)); }

  let src = null, on = false, headNext = true, hot = false, focused = false;
  // 通常・4灯以降に加えて、勝負中(focus)と成功の間も録音曲を続ける。JP(大当たり)の間だけ旧のJPの曲に任せる
  const wanted = () => bgm.enabled && (['normal', 'pink', 'focus', 'success'].includes(bgm.mode) || bgm.mode === 'tutorial' && !bgm.manifest?.files.tutorial) && !bgm.jpPlan && ctx.state === 'running';
  const play = () => {
    src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.loopStart = loopStart; src.loopEnd = loopEnd; src.connect(out);
    src.start(ctx.currentTime + .01, headNext ? 0 : loopStart); headNext = false;   // 通常に戻ったときは導入を飛ばして本編から
    const mine = src; mine.onended = () => { mine.disconnect(); if (src === mine) src = null; };
  };
  // 新しいゲームの開始(タイトル・チケット)では導入から
  const handle = engine.handleEvent.bind(engine);
  const handleHook = e => {
    if (['attract', 'title', 'ticket', 'howto'].includes(e.id)) headNext = true;
    const cue = on && pocketCue(e), buf = cue && engine.buffers.get(cue);
    if (buf) pocket.duck(buf.duration);   // 通常のSEの間だけBGMの中域をあける
    return handle(e);
  };
  engine.handleEvent = handleHook;
  const timer = setInterval(() => {
    silence();   // BGM再読込で差し戻された場合
    const want = wanted(), now = ctx.currentTime;
    if (want && !src) play();
    if (want !== on) {
      on = want; out.gain.cancelScheduledValues(now); out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(want ? 1 : 0, now + (want ? .4 : .25));
      if (!want && src) { src.stop(now + .26); src = null; }
    }
    const focus = want && bgm.mode === 'focus';
    if (focus !== focused) { focused = focus; focusLP.frequency.cancelScheduledValues(now); focusLP.frequency.setTargetAtTime(focus ? 1700 : 22000, now, focus ? .3 : .15); focusGain.gain.cancelScheduledValues(now); focusGain.gain.setTargetAtTime(focus ? .75 : 1, now, .3); }
    const pink = want && bgm.baseTarget === 'pink';
    if (pink !== hot) { hot = pink; tilt.gain.cancelScheduledValues(now); tilt.gain.setTargetAtTime(pink ? 3 : 0, now, .25); }
  }, 50);
  let disposed = false;
  return { engine, buffer, loopStart, loopEnd, contactBank: contactBank.stats, dispose() {
    if (disposed) return;disposed = true;contactBank.release('installation-disposed');clearInterval(timer);
    if (engine.handleEvent === handleHook) engine.handleEvent = handle;
    if (engine._duckTarget === duckHook) engine._duckTarget = duckTarget;
    src?.stop();out.disconnect();focusLP.disconnect();focusGain.disconnect();pocket.node.disconnect();tilt.disconnect();
  } };
  } catch (error) { contactBank.release('install-failed');throw error; }
}
