// 10/31 JPチャンスの「始まり」を、ぬるっとした入りから「ようやく始まった」に（ルールH・6灯目の着地〜連打の開始）。
//   ?jpstart=0 で今まで通り（このファイルは何もしない）。?jpblack=1 で黒背景＋文字（dopamine/reach）を戻す（溜め・扉の短縮は残る）。
//   ?jpstart_hold=秒（既定0.50）揃い＋止めの長さ。?jpstart_open=コマ（既定30）扉の寄りの頭を飛ばすコマ数。?jpstart_snd=0 で鼓動の音なし。
//   ?jpstart_shake=0 で画面の揺れなし。?jpstart_cut=0 で連打のカットインの層（GPU経路）なし（旧：液晶 canvas のみ）。
//
// 流れ（旧 → 新）                                           旧(fxtrim後)  新
//   6灯目の着地：揃い（6つの灯が一斉に強く光る・寄る・止まる）→ 画面が中心へ沈む → 囲いが落ちる・鼓動   0.0    0.5   ← 新設の「溜め」。風のうなり（jp_audio_v5 の v3_pre_swell）は model.delay の間に鳴る既存の仕組み
//   紫の雷（映像は不変。落ちた瞬間に画面が揺れる）                                                       1.0    1.0   ← 解放①
//   黒背景＋文字                                                                                        1.4    0     ← 削除（?jpblack=1 で戻す）
//   扉の寄り（雷の光で扉が浮かぶ・JP曲が全開で入る・最後に扉の継ぎ目から光の筋）                          2.0    1.0   ← 解放②。頭の遠景を飛ばす。JP曲はここで入る（旧は黒背景の頭）
//   JACKPOT CHANCE の題字（映像は不変。直前に約0.17秒の暗転→叩きつけで揺れ・破片が飛ぶ）                  1.5    1.5   ← 解放③
//   計                                                                                                  5.9    4.0   → 規則の導入秒数（JpMeterIntroSeconds）も同じだけ短くする
//   そのあと「封印解除!!」の叩きつけ＝連打の開始（揺れ・囲いが紫白で爆発）。連打のカットイン（連打→押せ！）は GPU 経路で見えていなかったので、ここの小さい層で出す。
//   手本：ハーデス実機（YouTube 3npJc1FIA7Y、揃い→白飛び→扉→光の筋→題字直前の暗転→題字）。
//
// 作り方：既存ファイルは触れない（rules_h に attach 1行、play_fx の基底層に揺れの差し込み口）。manifest の scenes を書き換え（雷の next・扉の skip・dopamine.frames）、lcd.onEvent / frame / applyLights / prepare を包む。
//   層は lcd_split_1030 の小さい層（jp_hud_1031 と同じ。lcd.jpHud.splitLayers を包んで足す）。揺れは lcd.jpStart.baseXform()（play_fx が基底の層の位置に足す）＋自分の層に同じ分。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';
import { CUT } from './meter_h_20261029.mjs';

const PX = 34, PY = 28, WW = 1152, HH = 1268;
const DIP = 0.10, DIP_T = 0.07;   // 題字の直前の暗転（秒）。扉の最後の0.10秒＋題字の頭の扉のコマ（約0.07秒）＝約0.17秒
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const easeIn = (x) => clamp(x) ** 2.2;
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;

export async function attachJpStart(lcd, { controller, log = () => {} } = {}) {
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  if (qs.get('jpstart') === '0' || qs.get('jpstart') === 'off') return lcd;
  const rh = lcd?.rulesH, jp = lcd?.jp;
  if (!rh || !jp || lcd.jpStart || !jp.man || !jp.model) return lcd;
  const man = jp.man, model = jp.model, fps = man.fps ?? 30;
  const L = man.scenes.jp_intro_lightning, OPEN = man.scenes.jp_chance_open_d4, TITLE = man.scenes.jp_chance_d4;
  if (!L || !OPEN || !TITLE) return lcd;   // 封印の扉の導入（jp_seal_1030 の jpOpen）が無いときは今のまま
  const black = qs.get('jpblack') === '1';
  const HOLD = clamp(+(qs.get('jpstart_hold') ?? 0.5), 0.1, 1.2);
  const SKIP = Math.round(clamp(+(qs.get('jpstart_open') ?? 30), 0, 50));
  const SND = qs.get('jpstart_snd') !== '0', SHAKE = qs.get('jpstart_shake') !== '0', CUTL = qs.get('jpstart_cut') !== '0';
  const S = { clock: 0, hold: HOLD, black, skip: SKIP, ph: null, name: '', serial: -1, t0: 0, audioKicked: -1, thumps: 0, frameN: 0, cutOn: false, cutFrames: 0, events: [], manual: false };
  const note = (k, d = {}) => { S.events.push({ k, at: +S.clock.toFixed(2), ...d }); if (S.events.length > 60) S.events.shift(); log('jpstart:' + k, d); };

  // ---- manifest ----
  const orig = { lNext: L.next, dFrames: man.scenes.jp_intro_dopamine?.frames, openSkip: {} };
  for (let d = 1; d <= 7; d++) { const s = man.scenes[`jp_chance_open_d${d}`]; if (s) { orig.openSkip[d] = s.skip; if (SKIP > 0) s.skip = [[0, SKIP]]; } }
  const openPlayed = (OPEN.frames - SKIP) / fps;
  if (!black) {
    L.next = 'jp_chance_open_d4';                                  // 雷の次を扉の寄りへ（実行時に _d{d} へ置き換わる）
    if (man.scenes.jp_intro_dopamine) man.scenes.jp_intro_dopamine.frames = OPEN.frames - SKIP;   // jp_audio_v5 の「導入の長さ」（JP曲の入りから題字までのコマ数）を、扉の寄りの長さに
  }
  const skipSec = (n) => (man.scenes[n]?.skip ?? []).reduce((a, [x, y]) => a + (y - x), 0) / fps;
  const blackSec = black ? ((man.scenes.jp_intro_dopamine?.frames ?? 54) / fps - skipSec('jp_intro_dopamine')) : 0;
  const INTRO = +(HOLD + L.frames / fps + blackSec + openPlayed + TITLE.frames / fps).toFixed(3);
  S.intro = INTRO; S.parts = { hold: HOLD, lightning: L.frames / fps, black: +blackSec.toFixed(3), open: +openPlayed.toFixed(3), title: TITLE.frames / fps };

  // 規則の導入秒数（fx_trim が reset のたびに入れ直すので、reset の後にもう一度。onAction は登録順）
  const setRules = () => { for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) r.JpMeterIntroSeconds = INTRO; };
  setRules();
  const offAct = controller.onAction?.((action) => { if (action === 'reset') setRules(); });

  // ---- 音（鼓動。風のうなり・雷・JP曲は jp_audio_v5 の既存） ----
  const eng = () => globalThis.__r2Audio?.engine;
  // 雷の音（監督の手本＝東京喰種の先バレ音の構造を写した別物の合成音。work/audio/jp_start_1031/NOTES.md）。
  // 通常の音（engine.mix：BGM・SE・玉の音）と JP の出口（hotBus）を、6灯目で絞り、雷で一気に落として、雷だけを最大で鳴らす。
  // 雷は圧縮機の「後」（master の入口）へ直接入れる（hotBus は絞るため通さない）。
  const direct = () => { const e = eng(); if (!e) return null; if (!e.__jpsDirect) { const g = e.ctx.createGain(); g.gain.value = 10 ** (6.3 / 20); g.connect(e.master); e.__jpsDirect = g; } return e.__jpsDirect; };
  const thump = (at, g = 1) => {
    try {
      const e = eng(), ctx = e?.ctx, d = direct(); if (!ctx || !d) return;
      const out = ctx.createGain(); out.gain.value = 10 ** (-11 / 20); out.connect(d);
      const t = ctx.currentTime + 0.02 + at, o = ctx.createOscillator(), env = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.2);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + 0.006); env.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(env).connect(out); o.start(t); o.stop(t + 0.3); o.onended = () => { try { o.disconnect(); env.disconnect(); out.disconnect(); } catch {} };
      S.thumps++;
    } catch (err) { console.warn('[jpstart-snd]', err); }
  };
  const TH = { buf: null, loading: false, silenced: false, plays: 0 };
  const loadThunder = async () => {
    if (TH.buf || TH.loading) return; const e = eng(); if (!e?.ctx) return; TH.loading = true;
    try { const r = await fetch(new URL('../../../audio/jp_start_1031/jp_thunder_new_1031.wav', import.meta.url)); TH.buf = await e.ctx.decodeAudioData(await r.arrayBuffer()); note('thunder:loaded', { dur: +TH.buf.duration.toFixed(2) }); }
    catch (err) { console.warn('[jpstart-thunder]', err); TH.loading = false; }
  };
  // jp_audio_v5 の既存の雷・前触れ（通常の音に埋もれていた）を、無音の素材に差し替える（?jpstart_snd=0 で触らない）
  const silenceOld = () => {
    if (TH.silenced) return; const A5 = window.__jpAudio, e = eng(); if (!A5?.bufs || !e?.ctx) return;
    TH.old = {}; const sil = e.ctx.createBuffer(1, 8, e.ctx.sampleRate);
    for (const n of ['v3_thunder', 'v3_thunder_flash', 'zap_flash', 'v3_pre_swell']) if (n in A5.bufs) { TH.old[n] = A5.bufs[n]; A5.bufs[n] = sil; }
    TH.silenced = true; note('thunder:oldSilenced', { n: Object.keys(TH.old).length });
  };
  const restoreOld = () => { const A5 = window.__jpAudio; if (!TH.silenced || !A5?.bufs) return; for (const [n, b] of Object.entries(TH.old)) A5.bufs[n] = b; TH.silenced = false; };
  const duckTo = (param, t, v, ramp) => { try { const cur = param.value; param.cancelScheduledValues(t); param.setValueAtTime(cur, t); param.linearRampToValueAtTime(v, t + ramp); } catch {} };
  // 6灯目の瞬間から、雷（HOLD 秒後）とその後の戻りまでを、音の時計で一度に予約する
  const scheduleSound = () => {
    const e = eng(), ctx = e?.ctx; if (!ctx || !TH.buf) return false; silenceOld();
    const t0 = ctx.currentTime, T = t0 + HOLD + 0.012, hot = e.hot?.gain, mix = e.mix?.gain, ps = [mix, hot].filter(Boolean);
    TH.base ??= new Map(ps.map((p) => [p, p.value]));   // 元の音量（mix は 1、hot は +6.3dB）。絞りはその倍率で、最後に必ず元へ戻す
    for (const p of ps) {
      const base = TH.base.get(p) ?? p.value, cur = p.value, at = (k) => base * k;
      p.cancelScheduledValues(t0); p.setValueAtTime(cur, t0);
      p.linearRampToValueAtTime(at(0.5), t0 + 0.04);                   // 揃いの一撃は残す
      p.linearRampToValueAtTime(at(0.5), t0 + 0.12);
      p.linearRampToValueAtTime(at(0.06), t0 + 0.24);                  // 止め：通常の音を絞って静かに
      p.linearRampToValueAtTime(at(0.06), T - 0.03);
      p.linearRampToValueAtTime(0, T - 0.004);                         // 雷の直前は無音
      p.setValueAtTime(0, T + 0.7);                                    // 雷の間は通常の音を落としきる
      p.linearRampToValueAtTime(base, T + 1.05);                       // 雷が切れるころ（JP曲の入り）に戻す
    }
    const src = ctx.createBufferSource(); src.buffer = TH.buf; const gn = ctx.createGain(); gn.gain.value = 1.0;
    src.connect(gn).connect(direct()); src.start(T); src.onended = () => { try { src.disconnect(); gn.disconnect(); } catch {} };
    TH.plays++; TH.lastAt = T; note('thunder:scheduled', { in: +(T - t0).toFixed(3) });
    return true;
  };

  // ---- 絵（動かないものは一度だけ作る。柔らかい光とにじみだけ。くっきりした枠・線は作らない） ----
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const W4 = 288, H4 = 317;   // 液晶 1152x1268 の 1/4
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const blackC = mk(124, 151); { const x = blackC.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 124, 151); }   // 液晶 canvas 全体（1240x1510）を覆う
  const darkC = mk(W4, H4); { const x = darkC.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W4, H4); }          // 液晶の窓
  // 中心が透けて縁へ向かって黒（枠でなく、中心へ絞る暗がり）
  const vigC = mk(W4, H4); { const x = vigC.getContext('2d'), g = x.createRadialGradient(144, 158, 0, 144, 158, 215); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.28, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0.7)'); g.addColorStop(0.8, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = g; x.fillRect(0, 0, W4, H4); }
  const flashC = mk(W4, H4); { const x = flashC.getContext('2d'), g = x.createRadialGradient(144, 150, 6, 144, 150, 230); g.addColorStop(0, 'rgba(255,248,255,1)'); g.addColorStop(0.35, 'rgba(225,190,255,0.8)'); g.addColorStop(1, 'rgba(120,60,230,0.45)'); x.fillStyle = g; x.fillRect(0, 0, W4, H4); }
  const coreC = mk(160, 160); { const x = coreC.getContext('2d'), g = x.createRadialGradient(80, 80, 0, 80, 80, 80); g.addColorStop(0, 'rgba(255,245,255,1)'); g.addColorStop(0.2, 'rgba(220,170,255,0.8)'); g.addColorStop(0.55, 'rgba(120,50,230,0.35)'); g.addColorStop(1, 'rgba(70,10,190,0)'); x.fillStyle = g; x.fillRect(0, 0, 160, 160); }
  // 6つの灯（lamp6 の映像の泡の位置）の光の溜まり。窓座標 x=108+184k, y=860
  const LAMP = { y: 860, xs: [108, 292, 476, 660, 844, 1028], cols: ['255,150,200', '150,240,240', '255,210,140', '190,255,130', '210,180,255', '255,190,140'] };
  const lampC = mk(W4, H4); { const x = lampC.getContext('2d'); x.globalCompositeOperation = 'lighter';
    LAMP.xs.forEach((wx, i) => { const cx = wx / 4, cy = LAMP.y / 4, g = x.createRadialGradient(cx, cy, 0, cx, cy, 52); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, `rgba(${LAMP.cols[i]},0.75)`); g.addColorStop(1, `rgba(${LAMP.cols[i]},0)`); x.fillStyle = g; x.fillRect(cx - 56, cy - 56, 112, 112); }); }
  // 扉の光の筋（にじませた細い筋。扉の継ぎ目から放射）
  const DOOR = { x: 576, y: 640 };
  const beamC = mk(W4, H4); { const t = mk(W4, H4), x = t.getContext('2d'); x.translate(DOOR.x / 4, DOOR.y / 4);
    for (let i = 0; i < 46; i++) { const a = (i / 46) * TAU + (rnd() - 0.5) * 0.12, len = 240 + rnd() * 260, w = 0.006 + rnd() * 0.022, c = ['255,255,255', '255,225,150', '190,230,255', '255,190,230'][Math.floor(rnd() * 4)];
      x.save(); x.rotate(a); const g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.25, `rgba(${c},0.6)`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(len, -len * w); x.lineTo(len, len * w); x.closePath(); x.fill(); x.restore(); }
    const bx = beamC.getContext('2d'); bx.filter = 'blur(1.4px)'; bx.drawImage(t, 0, 0); bx.filter = 'none'; }
  const seamC = mk(64, 192); { const x = seamC.getContext('2d'); x.translate(32, 96); x.scale(0.16, 1); const g = x.createRadialGradient(0, 0, 0, 0, 0, 96); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,215,130,0.85)'); g.addColorStop(0.6, 'rgba(255,120,30,0.3)'); g.addColorStop(1, 'rgba(255,90,10,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 96, 0, TAU); x.fill(); }
  // 題字の破片（動く。窓の 1/2 の解像度）と、連打のカットイン（動く。窓の 3/4）
  const SPW = 576, SPH = 634, spC = mk(SPW, SPH), spx = spC.getContext('2d');
  const CK = 0.75, CW = Math.round(WW * CK), CH = Math.round(HH * CK), cutC = mk(CW, CH), cx2 = cutC.getContext('2d');
  const T = { black: layerTexture(THREE, blackC), dark: layerTexture(THREE, darkC), vig: layerTexture(THREE, vigC), flash: layerTexture(THREE, flashC), core: layerTexture(THREE, coreC), lamp: layerTexture(THREE, lampC), beam: layerTexture(THREE, beamC), seam: layerTexture(THREE, seamC), sp: layerTexture(THREE, spC), cut: layerTexture(THREE, cutC) };

  // 揃いの映像（通常時の lamp6：6つ目の灯が点く閃き）。手元の <video> を層に使う（GPU の映像経路は変えない）
  let vid = null, vidTex = null, vidOk = false;
  try {
    const r = await fetch(new URL('./ryugu1028/lamp6.mp4', import.meta.url));
    if (r.ok) {
      vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.loop = false; vid.src = URL.createObjectURL(await r.blob());
      await new Promise((res) => { const done = () => res(); vid.addEventListener('loadeddata', done, { once: true }); vid.addEventListener('error', done, { once: true }); setTimeout(done, 3000); vid.load(); });
      vidOk = vid.readyState >= 2; if (vidOk) vidTex = layerTexture(THREE, vid);
    }
  } catch (e) { console.warn('[jpstart] lamp6', e); }
  note('lamp6video', { ok: vidOk });
  (lcd.splitWarmers ??= []).push({ name: 'jpstart', done: false, step(r) { for (const t of [...Object.values(T), vidTex].filter(Boolean)) { try { r.initTexture(t); } catch {} } return (this.done = true); } });

  // ---- 場面の追跡 ----
  const phaseOf = () => {
    if (!model.active || model.chainMode) return null;
    const n = model.name ?? '', t = S.clock - S.t0;
    if (n === 'jp_intro_lightning') return model.delay > 0 ? { k: 'hold', t: clamp(HOLD - model.delay, 0, HOLD) } : { k: 'light', t };
    if (/^jp_chance_open_d\d$/.test(n)) return { k: 'open', t, left: openPlayed - t };
    if (/^jp_chance_d\d$/.test(n)) return { k: 'title', t };
    if (/^jp_aim_seal_d\d_in$/.test(n)) return { k: 'in', t };
    return null;
  };
  // 揃いの映像の時刻：0.1秒で閃きの頂点（3コマ）まで → 0.1秒止まる（止め）→ 続き
  const vt = (t) => (t < 0.1 ? t : t < 0.2 ? 0.1 : t - 0.1);
  const driveVideo = (ph) => {
    if (!vidOk) return;
    const on = ph?.k === 'hold';
    if (!on) { if (S.vidOn) { try { vid.pause(); } catch {} S.vidOn = false; } return; }
    if (!S.vidOn) { S.vidOn = true; S.vidPlay = false; try { vid.currentTime = 0; } catch {} }
    if (S.manual) { const tv = vt(ph.t); if (Math.abs(vid.currentTime - tv) > 1e-4) { try { vid.currentTime = tv; } catch {} S.seekP = new Promise((res) => { vid.addEventListener('seeked', res, { once: true }); setTimeout(res, 400); }); } }
    else { const playing = ph.t < 0.1 || ph.t >= 0.2; if (playing && !S.vidPlay) { vid.play().catch(() => {}); S.vidPlay = true; } else if (!playing && S.vidPlay) { try { vid.pause(); } catch {} S.vidPlay = false; } }
  };
  const track = (dt) => {
    S.clock += dt; S.frameN++;
    const ser = model.active ? model.serial : -1, n = model.active ? (model.name ?? '') : '';
    const prev = S.name;
    if (ser !== S.serial || n !== S.name) {
      S.serial = ser; S.name = n; S.t0 = S.clock;
      if (/^jp_chance_open_d\d$/.test(n) && !black && S.audioKicked !== ser) {   // 雷のあと：JP曲を入れる（旧は黒背景＋文字の頭で startJp）
        S.audioKicked = ser;
        try { window.__jpAudio?.trigger?.('jp_intro_dopamine'); note('audio:startJp'); } catch (e) { console.warn('[jpstart-audio]', e); }
      }
      if (/^jp_chance_d\d$/.test(n)) S.spark = null;
      if (n) note('scene', { name: n });
    }
    S.ph = phaseOf();
    driveVideo(S.ph);
  };

  // ---- 6灯目：揃い＋止めを入れる ----
  const on0 = lcd.onEvent.bind(lcd);
  lcd.onEvent = (id, p = {}) => {
    const r = on0(id, p);
    if (id === 'lamp6' && model.active && !model.chainMode && model.name === 'jp_intro_lightning' && !(model.delay > 0)) {
      model.delay = HOLD; S.holdAt = S.clock; note('hold', { sec: HOLD });
      if (SND) { thump(0, 1); thump(0.34, 0.7); loadThunder(); if (!scheduleSound()) note('thunder:notready'); }
    }
    return r;
  };

  const frame0 = lcd.frame.bind(lcd);
  lcd.frame = (dt, F) => { const r = frame0(dt, F); track(dt); return r; };
  const prep0 = lcd.prepare?.bind(lcd);
  if (prep0) lcd.prepare = async (dt) => { const r = await prep0(dt); if (S.manual && S.seekP) { await S.seekP; S.seekP = null; } return r; };
  const man0 = lcd.setManual?.bind(lcd);
  if (man0) lcd.setManual = (on) => { S.manual = !!on; if (on) { try { vid?.pause(); } catch {} S.vidPlay = false; } return man0(on); };

  // ---- 揺れ（フレームごとの乱数。叩きつけの瞬間だけ大きく、すぐ収まる） ----
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const shakeAmp = (ph) => {
    if (!SHAKE || !ph) return 0;
    switch (ph.k) {
      case 'hold': return ph.t >= 0.09 && ph.t < 0.4 ? 11 * Math.exp(-(ph.t - 0.09) / 0.09) : 0;   // 揃いの閃き
      case 'light': return ph.t < 0.5 ? 14 * Math.exp(-ph.t / 0.12) : 0;                             // 雷が落ちた瞬間
      case 'title': return ph.t >= DIP_T && ph.t < 0.7 ? 18 * Math.exp(-(ph.t - DIP_T) / 0.13) : 0;  // 題字の叩きつけ
      case 'in': return ph.t < 0.5 ? 14 * Math.exp(-ph.t / 0.1) : 0;                                 // 封印解除!!＝連打の開始
      default: return 0;
    }
  };
  const shakeXY = () => { const a = shakeAmp(S.ph); return a > 0.3 ? [(hash(S.frameN) - 0.5) * 2 * a, (hash(S.frameN + 977) - 0.5) * 1.4 * a] : [0, 0]; };

  // ---- 囲いの電飾：揃いで一斉に強く光り、止めで落ちる。題字・封印解除の叩きつけで爆発 ----
  let al0 = null;   // 囲いの光台本（cabinet_light_script）が後から applyLights を包んで F.m3 を差し替えるので、最初の frame で一番外に包み直す
  const dim8 = (v) => Array.from({ length: 8 }, () => v);
  const lightsMine = (F, r) => {
    const ph = S.ph;
    if (!ph || !F) return r;
    if (ph.k === 'hold') {
      const t = ph.t, flare = t < 0.3 ? 1 - 0.3 * clamp((t - 0.1) / 0.2) : 0, fall = easeIn(clamp((t - 0.3) / 0.12));
      const k = t < 0.3 ? 0.9 + 2.3 * flare * (0.6 + 0.4 * Math.exp(-(t - 0.04) / 0.1)) : 3.2 * (1 - fall) * 0.7 + 0.02 + 0.03 * fall;
      const col = t < 0.3 ? [1, 0.9, 0.62] : [0.35 + 0.65 * (1 - fall), 0.08 + 0.8 * (1 - fall), 0.9 * (1 - 0.1 * fall) + 0.1 * (1 - fall)];
      F.m3 = { K: dim8(k), Kc: dim8(0).map(() => col), wash: dim8(0).map(() => [0, 0, 0]), ring: [0, 1, 2, 3].map(() => [0, 0, 0]), zone: dim8(0).map(() => [0.002, 0.004, 0.02]), hole: { cup: model.d }, jp1029: true };
      return true;
    }
    if (((ph.k === 'open' && ph.left < DIP) || (ph.k === 'title' && ph.t < DIP_T)) && F.m3?.K) { F.m3 = { ...F.m3, K: F.m3.K.map((k) => k * 0.1) }; return r; }   // 題字の直前：囲いも一瞬落とす
    const burst = ph.k === 'title' ? Math.exp(-ph.t / 0.14) * (ph.t >= DIP_T && ph.t < 0.5 ? 1 : 0) : ph.k === 'in' ? Math.exp(-ph.t / 0.12) * (ph.t < 0.4 ? 1 : 0) : ph.k === 'open' ? Math.exp(-ph.t / 0.1) * (ph.t < 0.4 ? 0.7 : 0) : 0;
    if (burst > 0.01 && F.m3?.K) {
      const col = ph.k === 'title' ? [1, 0.82, 0.4] : [0.8, 0.5, 1];
      F.m3 = { ...F.m3, K: F.m3.K.map((k) => Math.min(3.2, k + 2.0 * burst)), Kc: F.m3.Kc.map((c) => c.map((v, i) => v + (col[i] - v) * clamp(burst))) };
    }
    return r;
  };

  // ---- 題字の破片（窓の 1/2 解像度の動く canvas。叩きつけから約0.55秒だけ更新） ----
  const initSparks = () => {
    S.spark = Array.from({ length: 78 }, () => ({ x: 576 + (rnd() - 0.5) * 560, y: 560 + (rnd() - 0.5) * 240, a: rnd() * TAU, v: 500 + rnd() * 1500, l: 0.22 + rnd() * 0.4, w: 2.5 + rnd() * 6, g: rnd() < 0.3, c: rnd() < 0.5 ? '255,214,100' : rnd() < 0.5 ? '255,250,230' : '255,150,60' }));
  };
  const drawSparks = (tt) => {
    spx.clearRect(0, 0, SPW, SPH); spx.globalCompositeOperation = 'lighter'; spx.lineCap = 'round';
    for (const p of S.spark) {
      const a = tt; if (a > p.l) continue;
      const pos = (u) => { const d = p.v * (1 - Math.exp(-u * 6)) / 6; return [(p.x + Math.cos(p.a) * d) / 2, (p.y + Math.sin(p.a) * d + 420 * u * u) / 2]; };
      const [x1, y1] = pos(a), [x0, y0] = pos(Math.max(0, a - 0.035)), k = 1 - a / p.l;
      if (p.g) { const r = (14 + p.w * 3) * k + 3, g = spx.createRadialGradient(x1, y1, 0, x1, y1, r); g.addColorStop(0, `rgba(${p.c},${0.95 * k})`); g.addColorStop(1, `rgba(${p.c},0)`); spx.fillStyle = g; spx.fillRect(x1 - r, y1 - r, r * 2, r * 2); }
      else { spx.strokeStyle = `rgba(${p.c},${0.9 * k})`; spx.shadowColor = `rgba(${p.c},0.9)`; spx.shadowBlur = 8; spx.lineWidth = p.w * 0.5 * (0.4 + 0.6 * k); spx.beginPath(); spx.moveTo(x0, y0); spx.lineTo(x1, y1); spx.stroke(); spx.shadowBlur = 0; }
    }
    T.sp.needsUpdate = true;
  };

  // ---- 連打のカットイン（連打→押せ！）：GPU 経路では見えていなかった旧の 2D 描きを、同じ関数で小さい層へ ----
  const dc0 = rh.meter?.drawCut?.bind(rh.meter);
  if (dc0 && CUTL) rh.meter.drawCut = (ctx, st) => (S.cutOn ? undefined : dc0(ctx, st));   // 層で出している間は液晶 canvas へ二重に描かない
  const cutLayer = (dx, dy) => {
    S.cutOn = false;
    if (!dc0 || !CUTL || lcd.displayRecoveryActive || lcd.splitBroken) return null;
    const g = controller.game, st0 = g?.meterStatus, name = model.active ? (model.name ?? '') : '';
    if (!st0 || !name || /^jp_intro/.test(name) || !/^(jp_|chain_jp)/.test(name)) return null;
    const st = st0.tutorialPlanned && (st0.stage === 'intro' || st0.stage === 'tutorial') ? { ...st0, stage: 'intro', introLeft: 9 } : st0;
    const elapsed = st.stage === 'firing' ? st.seconds - st.timeLeft : -(st.introLeft ?? 9), age = elapsed + CUT.pre;
    if (!(age >= 0 && age <= CUT.pre + CUT.hold)) return null;
    S.cutOn = true; S.cutFrames++;
    cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.clearRect(0, 0, CW, CH); cx2.setTransform(CK, 0, 0, CK, 0, 0);
    try { dc0(cx2, st); } catch (e) { console.warn('[jpstart] cutin', e); }
    cx2.setTransform(1, 0, 0, 1, 0, 0); T.cut.needsUpdate = true;
    return { tex: T.cut, w: CW, h: CH, ax: 0, ay: 0, x: PX + dx, y: PY + dy, rot: 0, sc: 1 / CK, alpha: 1, add: false };
  };

  // ---- 液晶の層 ----
  const win = (tex, w, h, wx, wy, k, alpha, add, ox = 0, oy = 0) => { const s = WW / w; return { tex, w, h, ax: wx / s, ay: wy / s, x: PX + wx + ox, y: PY + wy + oy, rot: 0, sc: s * k, alpha, add }; };
  const splitLayers = () => {
    const ph = S.ph, [dx, dy] = shakeXY(), out = [];
    S.cutOn = false;
    if (ph?.k === 'hold') {
      const t = ph.t;
      // ① 揃い：6つの灯が一斉に強く光り、寄り、止まる（t=0.1〜0.2 は閃きの頂点で止める）
      const zoom = 1 + 0.10 * easeOut(t / 0.2);
      if (vidOk && vidTex) out.push(win(vidTex, WW, HH, 576, LAMP.y, zoom, 1, false, dx, dy));
      const flare = t < 0.04 ? t / 0.04 : t < 0.2 ? 1 : 1 - clamp((t - 0.2) / 0.2);
      out.push(win(T.lamp, W4, H4, 576, LAMP.y, zoom, 0.5 * flare, true, dx, dy));                                       // 6つの灯が一斉に強く光る
      if (t >= 0.05 && t < 0.24) out.push(win(T.flash, W4, H4, 576, 634, 1, 0.5 * (1 - (t - 0.05) / 0.19) ** 1.5, true, dx, dy));   // 閃きの白
      // ② 止め：画面が中心へ沈む（枠を作らない。中心が透けた暗がりが寄りきって全面の黒に）
      const s = clamp((t - 0.28) / (HOLD - 0.28));
      if (s > 0) {
        out.push(win(T.vig, W4, H4, 576, 634, 2.2 - 1.2 * easeOut(s), 1, false));
        out.push({ tex: T.black, w: 124, h: 151, ax: 0, ay: 0, x: 0, y: 0, rot: 0, sc: 10, alpha: clamp(s * 2.2), add: false });
        if (s > 0.35) out.push(win(T.core, 160, 160, 576, 634, 0.30 + 0.32 * s, 0.9 * clamp((s - 0.35) / 0.5), true));        // 雷の芯が中心に灯る
      }
    } else if (ph?.k === 'open') {
      if (ph.t < 0.24) out.push(win(T.flash, W4, H4, 576, 634, 1, 0.85 * (1 - ph.t / 0.24) ** 2, true, dx, dy));              // 雷の光で扉が浮かぶ
      // 扉の継ぎ目から光の筋（約0.3秒）：扉の最後の 0.40〜0.10 秒前
      const u = clamp((0.4 - ph.left) / 0.3);
      if (u > 0 && ph.left > 0.02) { out.push(win(T.seam, 64, 192, DOOR.x, DOOR.y, 1 + 0.5 * u, easeOut(u) * 0.95, true)); out.push(win(T.beam, W4, H4, DOOR.x, DOOR.y, 0.55 + 1.1 * easeOut(u), u * u * 0.9, true)); }
      // 手本：題字の直前に一瞬だけ暗く落ちて（約0.17秒）、白い爆発で題字が出る。扉の寄りの最後の0.10秒＋題字の頭（まだ扉のコマ）を暗く
      if (ph.left < DIP) out.push(win(T.dark, W4, H4, 576, 634, 1, 0.92 * clamp((DIP - ph.left) / 0.04), false));
    } else if (ph?.k === 'title') {
      if (ph.t < DIP_T) out.push(win(T.dark, W4, H4, 576, 634, 1, 0.92, false));
      else if (ph.t < 0.65) {   // 叩きつけの破片
        if (!S.spark) initSparks();
        const tt = ph.t - DIP_T; if (S.sparkT !== S.frameN) { S.sparkT = S.frameN; drawSparks(tt); }
        out.push({ tex: T.sp, w: SPW, h: SPH, ax: 0, ay: 0, x: PX + dx, y: PY + dy, rot: 0, sc: 2, alpha: 1, add: true });
      }
    }
    const cl = cutLayer(dx, dy); if (cl) out.push(cl);
    if (!out.length && (dx || dy)) out.push(win(T.dark, W4, H4, 576, 634, 1, 0, false));   // 揺れだけでも合成を通す（基底の層を動かすため）
    return out.length ? out : null;
  };
  let hooked = false;
  const hook = () => {
    if (hooked || !lcd.jpHud?.splitLayers) return;
    const o = lcd.jpHud.splitLayers.bind(lcd.jpHud);
    lcd.jpHud.splitLayers = () => { const a = o(), b = splitLayers(); return a && b ? [...a, ...b] : (a ?? b); };
    hooked = true;
    if (lcd.applyLights) { al0 = lcd.applyLights; const outer = al0.bind(lcd); lcd.applyLights = (F) => lightsMine(F, outer(F)); }
  };
  const f1 = lcd.frame; lcd.frame = (dt, F) => { hook(); return f1(dt, F); };
  // play_fx が基底の層（液晶 canvas 全体）の位置に足す。揺れていないときは null
  const baseXform = () => { const [dx, dy] = shakeXY(); return dx || dy ? { x: dx, y: dy } : null; };

  lcd.jpStart = { state: S, splitLayers, baseXform, intro: INTRO, dispose() {
    offAct?.(); lcd.onEvent = on0; lcd.frame = frame0; if (al0) lcd.applyLights = al0; if (prep0) lcd.prepare = prep0; if (man0) lcd.setManual = man0; if (dc0) rh.meter.drawCut = dc0;
    restoreOld(); L.next = orig.lNext; if (orig.dFrames != null) man.scenes.jp_intro_dopamine.frames = orig.dFrames;
    for (const d of Object.keys(orig.openSkip)) { const s = man.scenes[`jp_chance_open_d${d}`]; if (s) { if (orig.openSkip[d]) s.skip = orig.openSkip[d]; else delete s.skip; } }
    try { vid?.pause(); vid?.removeAttribute('src'); } catch {}
    lcd.jpStart = null;
  } };
  if (SND) { const kick = () => { if (!eng()) return setTimeout(kick, 500); loadThunder(); }; kick(); }
  note('attached', { intro: INTRO, black, parts: S.parts });
  return lcd;
}
