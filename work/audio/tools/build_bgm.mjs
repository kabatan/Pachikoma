// BGMを bgm/user/normal_loop.ogg にする手順(ブラウザで実行)。
// 使い方: 任意の同一オリジンのページで
//   const { buildBgmClean } = await import('/audio/tools/build_bgm.mjs');
//   const r = await buildBgmClean();
//   const enc = await (await import('/audio/tools/master_bgm.mjs')).encodeOggOpus([r.L, r.R], { bitrate: 192000 });
// enc.bytes をファイルへ保存する(loop_start/loop_endは r.loopStart / r.loopEnd)。
import * as B from './master_bgm.mjs';
import * as M from './measure.mjs';

// (A) パソコンの内部で録音したクリーンな音源(record_system_audio.html の normal_clean.wav)から。
// 録音由来の補正(雑音除去・低域カット・帯域整形)は不要なので、曲には触らず、ループと音量だけ整える。
// テンポ・小節線は音源から測定した値(160.18BPM、0小節目=4.9548秒)。ループは曲の区切り(10・26・42・58・74小節)に合わせた10〜58小節の48小節。
export async function buildBgmClean({ src = '/audio/bgm/user/normal_clean.wav', bpm = 160.18, bar0 = 4.9548, loopStartBar = 10, loopBars = 48, headSec = 5.0, rmsDb = -22.5, xfadeSec = .75, sr = 48000 } = {}) {
  const buf = await new OfflineAudioContext(2, sr, sr).decodeAudioData(await (await fetch(src)).arrayBuffer());
  const bar = 4 * 60 / bpm, head = Math.round(headSec * sr), loopStartAbs = Math.round((bar0 + loopStartBar * bar) * sr), loopLen = Math.round(loopBars * bar * sr);
  const loopStart = loopStartAbs - head, loopEnd = loopStart + loopLen;
  // 低域の直流成分・可聴外だけ除く(曲の音には触れない)
  const [L0, R0] = await Promise.all([0, 1].map(c => B.eq(buf.getChannelData(c).slice(head), sr, { hpHz: 25, shelfDb: 0, airDb: 0 })));
  // 音量: ループ区間(ステレオ平均)のRMSを揃える。ピークが超える分だけ柔らかく潰す
  const mid = L0.map((v, i) => (v + R0[i]) / 2), g = 10 ** ((rmsDb - B.rmsDb(mid, loopStart, loopEnd)) / 20);
  const soft = v => { const y = v * g, k = .95; return Math.abs(y) < k * .7 ? y : Math.sign(y) * (k * .7 + (k - k * .7) * Math.tanh((Math.abs(y) - k * .7) / (k - k * .7))); };
  const bake = c => { const o = B.bakeLoop(Float32Array.from(c, soft), { loopStart, loopEnd, xfade: Math.round(xfadeSec * sr) }); for (let i = 0; i < 240; i++) o[i] *= i / 240; return o; };
  const L = bake(L0), R = bake(R0), midOut = L.map((v, i) => (v + R[i]) / 2);
  return { L, R, loopStart, loopEnd, bands: M.bands(midOut, sr, 12, 70), levels: M.levels(midOut.subarray(loopStart, loopEnd)) };
}

// (B) 旧: スマホでスピーカーから録った音(normal.m4a)から。録音の劣化を補正する手順(雑音除去・200Hz以下カット・帯域整形など)。クリーンな音源がある場合は使わない。
export async function buildBgmFromPhone({ src = '/audio/bgm/user/normal.m4a', lowCutHz = 200, denoiseOpts = { floorDb: -12, over: 1.2 }, sr = 48000 } = {}) {
  const x = (await new OfflineAudioContext(1, sr, sr).decodeAudioData(await (await fetch(src)).arrayBuffer())).getChannelData(0);
  let y = B.denoise(x, denoiseOpts);
  y = await B.eq(y, sr, { hpHz: lowCutHz, shelfDb: 0, airDb: 0 });
  y = (await B.eqToTarget(y, sr, B.TARGET_BGM, { maxBoost: [0, 0, 6, 6, 0, 0, 8, 10, 6], maxCut: 10, passes: 3, from: 20 * sr, to: 120 * sr })).y;
  const head = 4800, barS = 72000, loopStart = Math.round((16 * 1.5 - .022) * sr) - head, loopEnd = loopStart + 48 * barS;
  y = B.exciter(y, sr, { fromHz: 3500, highHz: 7000, drive: 3, mix: .18 }).slice(head);
  y = B.levelTo(y, -22.5, { from: loopStart, to: loopEnd, ceiling: .98 }); y = B.compress(y, sr, { thDb: -26, ratio: 3, attack: .008, release: .15 }); y = B.levelTo(y, -22.5, { from: loopStart, to: loopEnd, ceiling: .98 });
  const bake = c => { const o = B.bakeLoop(c, { loopStart, loopEnd, xfade: Math.round(.75 * sr) }); for (let i = 0; i < 240; i++) o[i] *= i / 240; return o; };
  const [L, R] = B.widen(y, sr, { amount: .5 }).map(bake);
  return { L, R, loopStart, loopEnd, bands: M.bands(L.map((v, i) => (v + R[i]) / 2), sr, 25, 90) };
}
