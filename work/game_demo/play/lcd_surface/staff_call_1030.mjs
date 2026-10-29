// 10/30 追加（チケット100円）の流れ：StaffWait の液晶「スタッフにチケットを渡してください」＋呼び出し音＋囲いの呼び出し電飾＋再開の「+20秒 再開！」＋再開直後の誤発射の保護。
// 戻す: ?staffflow=old（何も付けない＝従来の流れ）。規則（ゲームの進行）は変えない。液晶の絵・音・電飾・入力の保護だけを足す。
// 液晶: lcd.frame の後ろに重ねて描く（timeup_surface が先に付いている前提）。下の液晶座標は timeup_surface と同じ 1152×1268（PX=34,PY=28）。
const W = 1152, H = 1268, PX = 34, PY = 28;
const RESUME_SECONDS = 1.9, GUARD_SECONDS = 1.0;

export function staffFlowMode(search = globalThis.location?.search ?? '') { return new URLSearchParams(search).get('staffflow') === 'old' ? 'old' : 'new'; }

const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
function textPath(ctx, text, x, y, size, { fill, silver = true, glow = null, spacing = 0 }) {   // 激アツ風: 黒縁 + 白銀縁 + グラデ塗り + 上の照り
  ctx.save();
  ctx.font = `${size}px "Dela Gothic One","MPLUS1p-ExtraBold","Noto Sans JP",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (spacing) ctx.letterSpacing = spacing + 'px';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * .28; }
  ctx.lineWidth = size * .26; ctx.strokeStyle = '#08020f'; ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  if (silver) { const g = ctx.createLinearGradient(0, y - size, 0, y); g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#aeb6d6'); g.addColorStop(1, '#f4f6ff'); ctx.lineWidth = size * .17; ctx.strokeStyle = g; ctx.strokeText(text, x, y); }
  const g = ctx.createLinearGradient(0, y - size * .85, 0, y + size * .05);
  for (const [o, c] of fill) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillText(text, x, y);
  ctx.globalCompositeOperation = 'lighter'; const hl = ctx.createLinearGradient(0, y - size * .85, 0, y - size * .35);
  hl.addColorStop(0, 'rgba(255,255,255,.55)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hl; ctx.fillText(text, x, y);
  ctx.restore();
}
const GOLD = [[0, '#fff7c0'], [.35, '#ffd23a'], [.62, '#ff9a12'], [1, '#d4410a']];
const WHITE = [[0, '#ffffff'], [.55, '#e8e0ff'], [1, '#a9a0d8']];

function makeRays() {   // 放射状の光の筋（一度だけ作ってにじませる。毎フレームはこれを回すだけ）
  const c = document.createElement('canvas'); c.width = c.height = 1400; const x = c.getContext('2d');
  x.filter = 'blur(10px)'; x.translate(700, 700);
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, w = .09 + .04 * ((i * 7) % 3);
    const g = x.createRadialGradient(0, 0, 40, 0, 0, 700); g.addColorStop(0, 'rgba(255,190,60,.55)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 700, a - w / 2, a + w / 2); x.closePath(); x.fill();
  }
  return c;
}
function makeTicket() {   // チケット（半券の切れ込み・縁の飾り・100円）。やわらかい影つき
  const c = document.createElement('canvas'); c.width = 560; c.height = 300; const x = c.getContext('2d');
  const w = 520, h = 250, r = 26, ox = 20, oy = 14;
  x.shadowColor = 'rgba(255,200,80,.9)'; x.shadowBlur = 26;
  const body = () => { x.beginPath(); x.moveTo(ox + r, oy); x.arcTo(ox + w, oy, ox + w, oy + h, r); x.arcTo(ox + w, oy + h, ox, oy + h, r); x.arcTo(ox, oy + h, ox, oy, r); x.arcTo(ox, oy, ox + w, oy, r); x.closePath(); };
  body(); const g = x.createLinearGradient(0, oy, 0, oy + h); g.addColorStop(0, '#fff3c4'); g.addColorStop(.5, '#ffd24a'); g.addColorStop(1, '#e8901a'); x.fillStyle = g; x.fill();
  x.shadowBlur = 0; x.save(); body(); x.clip();
  x.globalCompositeOperation = 'destination-out'; for (const sx of [ox + 372]) for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(sx, oy + 18 + i * 27, 7, 0, 7); x.fill(); }   // 切り取り線の穴
  x.beginPath(); x.arc(ox, oy + h / 2, 30, 0, 7); x.arc(ox + w, oy + h / 2, 30, 0, 7); x.fill();
  x.globalCompositeOperation = 'source-over'; x.restore();
  body(); x.lineWidth = 7; x.strokeStyle = '#7a2a08'; x.stroke();
  x.save(); x.translate(ox + 180, oy + 100); x.textAlign = 'center'; x.font = '84px "Dela Gothic One","MPLUS1p-ExtraBold",sans-serif'; x.fillStyle = '#7a2a08'; x.fillText('チケット', 0, 6);
  x.font = '66px "Dela Gothic One","MPLUS1p-ExtraBold",sans-serif'; x.fillStyle = '#c4300a'; x.fillText('100円', 0, 92); x.restore();
  x.save(); x.translate(ox + 446, oy + h / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.font = '44px "Dela Gothic One",sans-serif'; x.fillStyle = '#7a2a08'; x.fillText('ONE PLAY', 0, 14); x.restore();
  return c;
}

export async function attachStaffCall(lcd, { controller, canvas = null } = {}) {
  if (!lcd?.production || !lcd.timeupSurface || lcd.staffCall || staffFlowMode() === 'old') return lcd;
  const ctx = lcd.canvas.getContext('2d'), rays = makeRays();
  for (const [f, file] of [['Dela Gothic One', 'DelaGothicOne-Regular.ttf'], ['MPLUS1p-ExtraBold', 'MPLUS1p-ExtraBold.ttf']]) {   // 字体は自前で読む（ページ側の宣言に頼らない）
    try { if (![...document.fonts].some(x => x.family.replace(/"/g, '') === f && x.status !== 'error')) { const ff = new FontFace(f, `url(${new URL('../../assets/fonts/' + file, import.meta.url).href})`); await ff.load(); document.fonts.add(ff); } await document.fonts.load(`40px "${f}"`, 'チケット'); } catch { /* 無くても代替の字で出る */ }
  }
  const ticket = makeTicket();
  const upa = new Image(); upa.src = new URL('./rules_h_assets/upa_source.png', import.meta.url).href; try { await upa.decode(); } catch { /* うぱ無しでも出る */ }
  const g = () => controller.game;
  const st = { waitingSince: null, resumeAt: -1, guardUntil: 0, chimeAt: -1, chimes: 0, events: [], active: false };
  const note = (kind, d = {}) => { st.events.push({ kind, at: performance.now(), ...d }); if (st.events.length > 60) st.events.shift(); };
  const audioCtx = () => { const c = globalThis.__r2Audio?.engine?.ctx; return c && c.state === 'running' ? c : null; };

  // ---- 音: 呼び出しチャイム（ピンポーン）と、再開の上がる音。どちらも WebAudio で短く作る（素材なし）----
  function tone(c, t, f, len, vol, type = 'sine') {
    const o = c.createOscillator(), a = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(vol, t + .012); a.gain.exponentialRampToValueAtTime(.0008, t + len);
    o.connect(a).connect(c.destination); o.start(t); o.stop(t + len + .05);
  }
  function chime(strong) {
    const c = audioCtx(); if (!c) return; const t = c.currentTime + .02, v = strong ? .34 : .26;
    tone(c, t, 1318.5, .55, v); tone(c, t, 2637, .4, v * .35, 'triangle');          // ピン
    tone(c, t + .34, 987.8, .8, v); tone(c, t + .34, 1975.5, .6, v * .3, 'triangle'); // ポーン
    if (strong) { tone(c, t + .9, 1318.5, .5, v * .9); tone(c, t + 1.24, 987.8, .8, v * .9); }
  }
  function resumeSound() {
    const c = audioCtx(); if (!c) return; const t = c.currentTime + .01;
    [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => { tone(c, t + i * .07, f, .5, .26, 'triangle'); tone(c, t + i * .07, f * 2, .35, .08); });
    tone(c, t + .42, 2093, .9, .14);
  }

  // ---- 入力の保護: 再開の直後は撃てない（客がボタンを押しっぱなしでも球が出ない）。押しは捨てる ----
  const prevGate = controller.fireGate;
  controller.fireGate = (c) => { if (performance.now() < st.guardUntil) return 'staff-resume-guard'; return typeof prevGate === 'function' ? prevGate(c) : null; };
  const onAction = (action) => {
    if (action === 'add') { const now = performance.now(); st.resumeAt = now; st.guardUntil = now + GUARD_SECONDS * 1000; controller.fireBuffer = controller.preBuffer = null; resumeSound(); note('resume', { phase: g().phase, wallet: g().wallet, seconds: g().secondsLeft }); }
    else if (action === 'requestExtra') { st.chimes = 0; st.chimeAt = performance.now() + 250; note('call'); }
  };
  controller.listeners.add?controller.listeners.add(onAction):controller.listeners.push(onAction);

  // ---- 囲いの電飾: 呼び出し中は琥珀と赤の追いかけ点滅、再開の瞬間は金の閃光（cabinet_light_script の後付けフックへ）----
  function lightOverride(row, strip, clock) {
    const now = performance.now(), waiting = g().phase === 'StaffWait', since = (now - st.resumeAt) / 1000;
    if (!waiting && !(since >= 0 && since < 1.3)) return;
    const hz = waiting ? 2.2 : 0;
    for (let i = 0; i < 8; i++) {
      let k, r, gg, b;
      if (waiting) { const ph = (now / 1000 * hz + i / 8) % 1, on = ph < .5 ? 1 : .18; const alt = (i & 1) ? 0 : 1; k = .35 + 1.2 * on; r = 1; gg = alt ? .55 : .06; b = alt ? .02 : .04; }
      else { const f = Math.pow(1 - since / 1.3, 1.6); k = .5 + 1.2 * f; r = 1; gg = .78; b = .25; }
      row.K[i] = k; const c = row.Kc[i]; c[0] = r; c[1] = gg; c[2] = b;
      for (const key of ['wash', 'zone']) { const q = row[key][i]; q[0] = r * k * .4; q[1] = gg * k * .4; q[2] = b * k * .4; }
    }
    for (const q of row.ring) { q[0] = .5; q[1] = waiting ? .2 : .4; q[2] = .02; }
    strip[0] = 1; strip[1] = waiting ? (Math.sin(now / 1000 * 4.4) > 0 ? .5 : .05) : .8; strip[2] = waiting ? .02 : .25;
  }
  const hookLights = () => { const api = globalThis.__cabinetLightScript; if (api && !api.after) api.after = lightOverride; };

  // ---- 液晶の絵 ----
  function drawCall(now) {
    const t = (now - st.waitingSince) / 1000, pulse = .5 + .5 * Math.sin(t * 5.2);
    ctx.save(); ctx.translate(PX, PY);
    // 地: 前の画面（続けますか？）を完全に覆う。紫の闇＋中心の琥珀の光
    const bg = ctx.createRadialGradient(W / 2, 560, 80, W / 2, 620, 900); bg.addColorStop(0, '#5a1456'); bg.addColorStop(.55, '#2a0a3e'); bg.addColorStop(1, '#0a0216');
    ctx.globalAlpha = ease(t / .25); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 + .2 * pulse; ctx.translate(W / 2, 560); ctx.rotate(t * .22); ctx.drawImage(rays, -700, -700); ctx.restore();
    // 呼び出しの札（上）: 「お呼び出し中」が点滅
    const bandY = 150, bandIn = ease(t / .35);
    ctx.save(); ctx.globalAlpha = bandIn; ctx.translate(W / 2, bandY + (1 - bandIn) * -60);
    const bg2 = ctx.createLinearGradient(-300, 0, 300, 0); bg2.addColorStop(0, 'rgba(160,10,30,.0)'); bg2.addColorStop(.2, `rgba(${170 + 70 * pulse},20,40,.95)`); bg2.addColorStop(.8, `rgba(${170 + 70 * pulse},20,40,.95)`); bg2.addColorStop(1, 'rgba(160,10,30,0)');
    ctx.fillStyle = bg2; ctx.fillRect(-460, -50, 920, 100);
    textPath(ctx, '係員をお呼びします', 0, 30, 62, { fill: WHITE, glow: '#ff3050' });
    ctx.restore();
    // ほんぶん: 「スタッフに」「チケットを」「渡してください」
    const rise = (d, y) => { const k = ease((t - d) / .4); return [y + (1 - k) * 70, k]; };
    let [y, k] = rise(.15, 395); ctx.globalAlpha = k; textPath(ctx, 'スタッフに', W / 2, y, 120, { fill: WHITE, glow: '#8a5cff' });
    [y, k] = rise(.3, 600); ctx.globalAlpha = k; const sc = 1 + .025 * pulse; ctx.save(); ctx.translate(W / 2, y - 80); ctx.scale(sc, sc); textPath(ctx, 'チケットを', 0, 80, 210, { fill: GOLD, glow: '#ff9a20' }); ctx.restore();
    [y, k] = rise(.45, 760); ctx.globalAlpha = k; textPath(ctx, '渡してください', W / 2, y, 136, { fill: GOLD, glow: '#ff9a20' });
    ctx.globalAlpha = 1;
    // チケット＋うぱ（渡す絵）: チケットがゆれて、右の「スタッフの手」へ向かう矢じりが動く
    const bob = Math.sin(t * 3.1) * 12, tk = ease((t - .5) / .5);
    ctx.save(); ctx.globalAlpha = tk; ctx.translate(360, 925 + bob + (1 - tk) * 80); ctx.rotate(-.07 + Math.sin(t * 2.4) * .035); ctx.drawImage(ticket, -280, -150); ctx.restore();
    if (upa.naturalWidth) { const s = Math.max(1, Math.floor(260 / upa.naturalWidth)), uw = upa.naturalWidth * s, uh = upa.naturalHeight * s; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = tk; ctx.drawImage(upa, 850 - uw / 2, 890 - uh / 2 + Math.sin(t * 4.1) * 10, uw, uh); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = tk * (.55 + .45 * Math.abs(Math.sin(t * 4.6))); ctx.translate(655, 935);
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = tk * ((t * 3 - i) % 3 < 1 ? 1 : .3); ctx.fillStyle = '#ffd23a'; ctx.shadowColor = '#ff9a20'; ctx.shadowBlur = 24; ctx.beginPath(); ctx.moveTo(i * 52 - 20, -34); ctx.lineTo(i * 52 + 20, 0); ctx.lineTo(i * 52 - 20, 34); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // 下の説明板: 止まっていて損しない
    const info = ease((t - .8) / .4), r = g().rules ?? {};
    ctx.save(); ctx.globalAlpha = info; ctx.translate(W / 2, 1160 + (1 - info) * 50);
    const pg = ctx.createLinearGradient(0, -80, 0, 80); pg.addColorStop(0, 'rgba(20,6,40,.9)'); pg.addColorStop(1, 'rgba(60,14,70,.9)');
    ctx.fillStyle = pg; ctx.strokeStyle = 'rgba(255,205,90,.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(-500, -88, 1000, 176, 30); ctx.fill(); ctx.stroke();
    textPath(ctx, '時間も玉も止まっています', 0, -14, 54, { fill: WHITE, silver: false });
    textPath(ctx, `受け取り後に +${r.ExtraSeconds ?? 20}秒  +${r.ExtraLoanBalls ?? 10}玉 で再開`, 0, 62, 54, { fill: GOLD, silver: false });
    ctx.restore();
    ctx.restore();
  }
  function drawResume(now) {
    const t = (now - st.resumeAt) / 1000; if (t < 0 || t >= RESUME_SECONDS) return false;
    const r = g().rules ?? {}, a = t < .15 ? t / .15 : t > RESUME_SECONDS - .5 ? (RESUME_SECONDS - t) / .5 : 1, pop = 1 + .35 * Math.pow(Math.max(0, 1 - t / .25), 2);
    ctx.save(); ctx.translate(PX, PY); ctx.globalAlpha = a * .85; ctx.globalCompositeOperation = 'lighter';
    ctx.translate(W / 2, 560); ctx.save(); ctx.rotate(t * .5); ctx.globalAlpha = a * .6; ctx.drawImage(rays, -700, -700); ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a;
    // 既存の追加演出（20秒の銀の数字・玉）はそのまま見せる。ここは「再開！」の一言だけを下に重ねる
    const k2 = 1 + .1 * Math.pow(Math.max(0, 1 - (t - .12) / .25), 2); ctx.translate(0, 330); ctx.scale(pop * k2, pop * k2);
    textPath(ctx, '再開！', 0, 0, 190, { fill: GOLD, glow: '#ffb030' });
    ctx.restore(); return true;
  }

  // ---- lcd へ重ねる（timeup_surface のあと）----
  const base = { frame: lcd.frame.bind(lcd) };
  const revision = Object.getOwnPropertyDescriptor(lcd, 'uploadRevision')?.get;
  let drawing = false;
  lcd.frame = (dt, F) => {
    base.frame(dt, F); hookLights();
    const now = performance.now(), waiting = g().phase === 'StaffWait';
    if (waiting) {
      if (st.waitingSince == null) { st.waitingSince = now; if (st.chimeAt < 0) st.chimeAt = now + 250; }
      if (now >= st.chimeAt) { chime(st.chimes >= 8); st.chimes++; st.chimeAt = now + (st.chimes >= 8 ? 2200 : 3000); }
      st.active = true; drawing = true; drawCall(now);
    } else {
      st.waitingSince = null; st.chimeAt = -1; st.chimes = 0;
      drawing = drawResume(now); st.active = drawing;
    }
  };
  if (revision) Object.defineProperty(lcd, 'uploadRevision', { configurable: true, enumerable: true, get: () => drawing ? undefined : revision.call(lcd) });
  lcd.staffCall = { state: st, get drawing() { return drawing; }, chime, resumeSound, GUARD_SECONDS, RESUME_SECONDS, dispose() { if (controller.listeners.delete) controller.listeners.delete(onAction); else controller.listeners.splice(controller.listeners.indexOf(onAction), 1); controller.fireGate = prevGate; const a = globalThis.__cabinetLightScript; if (a?.after === lightOverride) a.after = null; } };
  return lcd;
}
