import { createProductionLcd } from './normal_surface_confirm1029.mjs';
// 液晶を「動画を貼る面」にする（?lcd=video）。液晶の中身は焼いた映像で、ゲームは「いつ・どれを流すか」と、数の入る小さな字だけを決める。
// 弱い PC（内蔵 GPU のノート）向け：映像の復号は GPU の専用回路、こちらは 1 コマに 1 回 canvas へ貼るだけ（実測 0.1ms/コマ、1152×1268・60fps）。
//
//   const lcd = await createLcdSurface({ manifestUrl, getState })    // getState() → { secondsLeft, phase }（ゲームの状態）
//   connectPlayEffects({ ..., lcd })                                  // play_fx が毎フレーム lcd.frame(dt, F) を呼び、lcd.canvas を液晶の板に貼る
//
// 流す時刻は演出の管制（effects.js の Director）の液晶の合図（F.cues の lane 'lcd'）に従う。今の液晶の場面と同じ時刻に出る。
// 映像の一覧は clips/manifest.json（場面の id → ファイル）。無い場面は通常の映像（idle）のまま。
// 映像は起動時に全部読み込んで Blob にしておく（場面の頭で待たない。配信側の Range 対応も要らない）。
const W0 = 1240, H0 = 1510;   // m3 の液晶の面（lcd_window.json の panel）。見える範囲（visible）の外は枠と穴の部品に隠れる

import { createJpSeq } from './jp_seq.mjs';
import { createEndDigits } from './end_digits.mjs';

export async function createLcdSurface({ manifestUrl, jpManifestUrl = null, onJpCue = () => {}, getState = () => ({}), width = W0, height = H0, palaceImageFactory = null, resultImageFactory = null, videoImageFactory = null, resultBoundaryGpu = null, fullPanelPrevious = null } = {}) {
  const man = await (await fetch(manifestUrl)).json();
  if (man.version === 1026) return createProductionLcd({ manifestUrl, man, getState, jpManifestUrl, onJpCue, palaceImageFactory, resultImageFactory, videoImageFactory, resultBoundaryGpu, fullPanelPrevious });   // jp_filmは接続しない
  const base = new URL('.', manifestUrl);
  const urls = {};
  for (const [name, file] of Object.entries(man.files)) {   // 1 本ずつ（同時に読むと起動時の他の読み込みと合わせて ERR_INSUFFICIENT_RESOURCES になった）
    const r = await fetch(new URL(file, base)); if (!r.ok) { console.warn(`lcd clip ${file}: HTTP ${r.status}`); continue; }   // 無い映像は通常の映像のまま
    urls[name] = URL.createObjectURL(await r.blob());
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const mk = (loop) => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.loop = loop; v.preload = 'auto'; return v; };
  // 通常（くり返し）と場面（1 回）の 2 つ。場面の映像に最初のコマが出るまでは前の映像を出し続ける（黒を挟まない）
  const idle = mk(true), shot = mk(false);
  let idleName = null, shotName = null, shotReady = false;
  // 撮影（1/60 秒ずつ進めて撮る）のときは manual：映像を再生せず、prepare(dt) で時刻へ合わせる（ゲームの時計と同じコマを出す）
  let manual = false, idleT = 0, shotT = 0;
  const setIdle = (name) => {
    if (!urls[name] || idleName === name) return; idleName = name; idleT = 0;
    idle.src = urls[name]; idle.currentTime = 0; if (!manual) idle.play().catch(() => {});
  };
  const playShot = (name) => {
    if (!urls[name]) return false;
    shotName = name; shotReady = false; shotT = 0;
    shot.src = urls[name]; shot.currentTime = 0; if (!manual) shot.play().catch(() => {});
    return true;
  };
  shot.addEventListener('playing', () => { shotReady = true; });
  shot.addEventListener('seeked', () => { if (manual && shotName) shotReady = true; });
  shot.addEventListener('ended', () => { shotName = null; shotReady = false; });
  const seek = (v, t) => new Promise((res) => {
    if (!(v.duration > 0)) { const on = () => { v.removeEventListener('loadedmetadata', on); res(seek(v, t)); }; v.addEventListener('loadedmetadata', on); setTimeout(res, 2000); return; }
    const to = setTimeout(done, 2000); function done() { clearTimeout(to); v.removeEventListener('seeked', done); res(); }
    v.addEventListener('seeked', done); v.currentTime = t;
  });
  setIdle(man.idle.attract);
  const stats = { played: [], frames: 0 }, seen = new Set();
  // JP の場面（JP 演出の担当の書き出し）。無ければ今までどおり 'jp' の 1 本
  const jp = jpManifestUrl ? await createJpSeq({ manifestUrl: jpManifestUrl, log: (n) => stats.played.push([+(performance.now() / 1000).toFixed(2), 'jp:' + n]) }) : null;
  // 場面 → 通常の映像（待機中は title、遊技中は idle）
  const IDLE_OF = man.idle.byEvent || {};
  // fit：'cover'＝面いっぱいに切り抜き（16:9 の仮の映像）、'visible'＝窓の見える範囲（visible、1152×1268 の比）にそのまま。半分の 576×634 も同じ所へ拡大
  const VIS = man.visible ?? { x: 34, y: 28, w: 1152, h: 1268 };   // panel の中の visible（lcd_window の visible − panel）
  const fitOf = (name, vw, vh) => man.fit?.[name] ?? (Math.abs(vw / vh - VIS.w / VIS.h) < 0.02 ? 'visible' : man.fit?.default ?? 'cover');   // 窓の比（1152×1268）の映像は切り抜かない
  const drawCover = (v, name) => {
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return false;
    if (fitOf(name, vw, vh) === 'visible') {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);   // visible の外は枠と穴の部品に隠れる
      ctx.drawImage(v, VIS.x, VIS.y, VIS.w, VIS.h); return true;
    }
    const s = Math.max(width / vw, height / vh), dw = vw * s, dh = vh * s;
    ctx.drawImage(v, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return true;
  };
  // 継続の数字（連チャン数・積み増し・確定額・失った数）。場面の slots（effects/chain/scenes_chain.json）に従って映像の上に重ねる
  // 部品は effects/chain/tmp/export/digits/{face}/{字}_{k}.png（k＝照り 0〜3）。中心揃え、送りは字の幅の 0.92 倍
  const digits = await loadDigits(new URL('../../../effects/chain/tmp/export/digits/', import.meta.url));
  const drawSlots = (w) => {
    if (!w?.slots || !digits) return;
    const sx = VIS.w / 1152, sy = VIS.h / 1268, v = w.values;
    const VAL = { chain: v.chain, pending: v.pending, lost: v.lost, total: v.total };
    const bump = w.bump < 4 / 30 ? 1 + 0.15 * (1 - w.bump * 30 / 4) : 1;   // 数字が変わった瞬間に 4 コマ弾ませる
    for (const sl of w.slots) {
      const n = VAL[sl.id]; if (!(n > 0) || w.f < (sl.from_frame ?? 0)) continue;
      const face = digits[sl.face] ?? digits.gold;
      const glyphs = [...(sl.prefix ? [sl.prefix] : []), ...String(Math.round(n)), ...(sl.suffix ? [sl.suffix] : [])].map((c) => ({ c, key: { '-': 'minus', '+': 'plus', '/': 'slash' }[c] ?? c }));
      const k = Math.floor(w.f / 3) % 4, H = sl.h * sy * bump;
      const items = glyphs.map((g, i) => {
        const im = (face[g.key] ?? digits.gold[g.key])?.[(k + i) % 4]; if (!im) return null;
        const small = /[^0-9]/.test(g.c) && g.c !== '-' && g.c !== '+' ? 0.62 : 1;   // 接尾の字（連・枚）は小さく
        const h = H * small * (im.naturalHeight / 350), w2 = im.naturalWidth * h / im.naturalHeight;
        return { im, w: w2, h, small };
      }).filter(Boolean);
      const total = items.reduce((a, it, i) => a + it.w * (i < items.length - 1 ? 0.92 : 1), 0);
      let x = VIS.x + sl.cx * sx - total / 2; const cy = VIS.y + sl.cy * sy;
      for (const it of items) { ctx.drawImage(it.im, x, cy - it.h / 2 + (it.small < 1 ? H * 0.18 : 0), it.w, it.h); x += it.w * 0.92; }
    }
  };
  // 計数・結果：最終ランクごとの数字なしの映像（finish_count_r0〜r4・result_r0〜r4、「あと N玉」付きは …h）を選び、持ち玉・JP の合計・「あと N玉」を重ねる（end_digits.mjs）
  const endDg = digits ? await createEndDigits({ slotsUrl: new URL('end_v_slots.json', base).href, digits }) : null;
  // 残り時間（右上）。遊技中だけ。字の正式な見た目は演出の担当（テロップの層）が決める。ここは仮の簡素な表示
  let hudOn = false, jpLast = null;
  const JP_ENDS = new Set(['timeup', 'finish_count', 'result', 'attract', 'ticket']);
  const HUD_ON = new Set(['start', 'add100']), HUD_OFF = new Set(['attract', 'title', 'howto', 'ticket', 'timeup', 'finish_count', 'result']);
  try { const f = new FontFace('Dela Gothic One', `url(${new URL('../../../effects/lcd/fonts/DelaGothicOne-Regular.ttf', import.meta.url).href})`); document.fonts.add(f); await f.load(); } catch (e) { console.warn('lcd font', e.message); }
  const drawHud = () => {
    const s = getState(); if (!hudOn || !(s.secondsLeft >= 0)) return;
    const sec = Math.ceil(s.secondsLeft), x = width - 90, y = 1195;   // visible の右下（窓の中で x 880〜1120・y 1050〜1182 の枠、穴の段の上）。上の縁 y 52〜122 は射出器の首と球が全幅を往復するので避ける
    ctx.save(); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.font = '64px "Dela Gothic One"';
    ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(10,20,60,0.85)'; ctx.fillStyle = sec <= 10 ? '#ff5a7a' : '#ffffff';
    ctx.strokeText(String(sec), x, y); ctx.fillText(String(sec), x, y);
    ctx.font = '28px "Dela Gothic One"'; ctx.lineWidth = 6; ctx.strokeText('残り', x - 4, y - 70); ctx.fillText('残り', x - 4, y - 70);
    ctx.restore();
  };
  return {
    canvas, stats,
    setManual(on) { manual = !!on; jp?.setManual(on); if (manual) { idle.pause(); shot.pause(); } else { idle.play().catch(() => {}); if (shotName) shot.play().catch(() => {}); } },
    // ゲームの出来事（play_fx が全部渡す）。JP の場面が受け持つ間は、液晶の合図の映像を出さない
    onEvent(id, p) { endDg?.onEvent(id, p); if (jp && jp.onEvent(id, p)) { if (shotName) { shot.pause(); shotName = null; shotReady = false; } } },
    async prepare(dt) {   // manual のとき、毎コマの前に呼ぶ（映像をゲームの時計の時刻へ）
      if (!manual) return;
      if (jp?.active) await jp.prepare(dt);
      idleT += dt; const jobs = [];
      if (idle.duration > 0) jobs.push(seek(idle, idleT % idle.duration));
      if (shotName) { shotT += dt; if (shot.duration > 0 && shotT >= shot.duration) { shotName = null; shotReady = false; } else jobs.push(seek(shot, Math.min(shotT, (shot.duration || 1e9) - 1e-3))); }
      await Promise.all(jobs);
    },
    frame(dt, F) {
      for (const c of F?.cues ?? []) {
        if (c.lane !== 'lcd' || seen.has(c.uid)) continue;   // 1 つの場面に液晶の合図が複数あるので、最初の 1 回だけ
        seen.add(c.uid); if (seen.size > 500) seen.clear();
        if (jp?.active && !JP_ENDS.has(c.event)) continue;   // JP の間は JP の場面だけ
        if (HUD_ON.has(c.event)) hudOn = true; else if (HUD_OFF.has(c.event)) hudOn = false;
        if (IDLE_OF[c.event]) setIdle(IDLE_OF[c.event]);
        const v = endDg?.pick(c.event), clip = v && urls[v] ? v : man.events[c.event];
        if (clip && playShot(clip)) stats.played.push([+(performance.now() / 1000).toFixed(2), c.event]);
      }
      const jv = jp ? jp.frame(dt) : null;
      if (jv) jpLast = jv; else if (!jp?.active) jpLast = null;   // JP の次の場面の最初のコマが出るまでは前の場面の絵（黒を挟まない）
      const drew = (jpLast && drawCover(jpLast, 'jp')) || (shotName && shotReady && drawCover(shot, shotName)) || drawCover(idle, idleName);
      if (!drew) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); }
      if (jpLast && jp) { const w = jp.where(); drawSlots(w); if (w?.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, w.flash)})`; ctx.fillRect(0, 0, width, height); } }
      if (shotName && shotReady && !jpLast) endDg?.draw(ctx, shotName, shot.currentTime, VIS.x, VIS.y, VIS.w / 1152);
      drawHud(); stats.frames++;
    },
    dispose() { for (const u of Object.values(urls)) URL.revokeObjectURL(u); idle.src = shot.src = ''; jp?.dispose(); },
  };
}

// 継続の数字の部品を読む（無ければ null、数字は出さない）
async function loadDigits(base) {
  try {
    const sheet = await (await fetch(new URL('sheet.json', base))).json(), out = {};
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    for (const [face, glyphs] of Object.entries(sheet)) {
      if (!glyphs || typeof glyphs !== 'object') continue;
      out[face] = {};
      for (const g of Object.keys(glyphs)) out[face][g] = await Promise.all([0, 1, 2, 3].map((k) => load(new URL(`${face}/${encodeURIComponent(g)}_${k}.png`, base).href)));
    }
    return out;
  } catch (e) { console.warn('chain digits', e.message); return null; }
}
