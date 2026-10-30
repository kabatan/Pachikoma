import { playEventParams } from '../../game_demo/play/effect_params.mjs';
/* 本番プレイ画面(game_demo/play)へ演出窓口(Effects)をつなぐ。演出側が持つ1ファイル。
 *
 *   const fx = await connectPlayEffects({ hr, bus: effects, getSnapshot, q })   // play.mjs の起動後に1回
 *   fx.frame(dt)                                                                 // 毎フレーム(描画の前)
 *
 * - 液晶: Effects の液晶キャンバス(1280x720)を、HybridRenderer の奥側シーンへ「ライブ映像の板」として差し込む
 *   (hybrid_spec §液晶: LCD映像はlive textureとして奥に差込む)。レンダラ内部は書き換えない。
 * - イベント: EffectsBus の id をそのまま Effects.notify へ渡す。params は EFFECTS_EVENTS.md の互換キー表どおり。
 * - 光(花びら/縁/ロゴ…)は本番の光層packの source_id との対応表が納品されたら fx.lights で渡す(今は液晶のみ)。
 */
import * as THREE from '../../game_demo/web/vendor/three/three.module.js';
import { Stage2cLightAdapter } from '../../assembly/sol61_v36_pack/stage2c/cabinet_adapter.mjs';   // LightAdapter + 筐体の7セグ/ロゴ/ボタン(setCabinet)
import { ballCountToDigits } from '../../assembly/pack_envcheck/seg_digits.mjs';
import { makeBoardWash } from './board_wash.mjs';
import { createSplitCompositor } from '../../game_demo/play/lcd_surface/lcd_split_1030.mjs';   // 液晶板の重ね合わせ描画(スタッフ待ち・継続の転送削減)
const WARM_ON = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('splitwarm') === '0');
const SPLIT_CHECK = new URLSearchParams(globalThis.location?.search ?? '').has('splitcheck');   // 検証用: 分割と全面canvasを同時に用意し、__splitAB で切り替えて比べる
import { installBallLights } from './ball_light.mjs';

const here = new URL('.', import.meta.url);
const RANKS = { participation: 0, C: 1, B: 2, A: 3, S: 4, SS: 5 };
const loadScript = (url) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('script ' + url)); document.head.append(s); });

// 本番画面(1440x2560)での液晶の枠(px)。geometry.json の lcd_rect_native と同じ
const LCD_RECT = [145.53, 758.4, 1340.43, 1429.77];

function lcdMesh(hr, canvas, { rect = LCD_RECT, gain = 1 } = {}) {
  const W = 1440, H = 2560, [x0, y0, x1, y1] = rect;
  const nx = (x) => x / W * 2 - 1, ny = (y) => 1 - y / H * 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([nx(x0), ny(y0), 0, nx(x1), ny(y0), 0, nx(x1), ny(y1), 0, nx(x0), ny(y1), 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D uT; uniform float uGain; varying vec2 vU;
      vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main(){ gl_FragColor = vec4(lin(texture2D(uT, vU).rgb) * uGain, 0.0); }`,
    uniforms: { uT: { value: tex }, uGain: { value: gain } },
    depthTest: false, depthWrite: false, transparent: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 50;   // 奥の環境(NoBlendで上書き)より後
  hr.sBack.add(mesh);
  return { mesh, tex, mat };
}

// 調整側の皿API(runtime: awardToTray / releaseAwards / setAwardHold / trayStatus)を、光バスの tray トラックから呼ぶ形に包む。
// 玉の物理は調整側。ここは「いつ・どの速さで注ぐか」だけ。付与が演出の注ぎ始めまで保留されるよう、最大保留をイベントごとに伸ばす。
const HOLD = { ticket: 5, add100: 5, success_small: 5, success_big: 7, jp: 14 };   // 注ぎ始め(秒)+余裕
function trayAdapter(rt, now, fired = () => 0) {
  if (!rt || !rt.awardToTray) return null;
  rt.setAwardHold(true, 4);
  return {
    holdFor(id) { rt.setAwardHold(true, HOLD[id] || 4); },
    bank() { rt.releaseAwards({ rate: 12, earned: true, origin: 'chain_stop' }); },
    award(count, { eventId, rate }) {
      if (rt.jpHold && eventId === 'jp') return {poured:0,landed:()=>0,done:()=>true};
      const r = Math.max(2, Math.min(40, rate || 12)), t0 = now(), w0 = rt.displayWallet ? rt.displayWallet() : null, f0 = fired();
      const poured = rt.awardToTray(count, { rate: r, origin: eventId }) || 0;
      (window.__awards || (window.__awards = [])).push({ eventId, count, poured, w0, t0, rate: r });
      // 皿に着いた数 = いま表示している持ち玉(7セグ)の増え + 払い出し中に撃って減らした分。
      // (撃った分を足さないと、払い出し中に連打した時に「着いた数」が減り、払い出しが終わらず、7セグ・液晶の数字がずれたままになった: R2-E 調査 10/17)
      const landed = () => (w0 === null ? Math.min(poured, Math.max(0, now() - t0 - .5) * r) : Math.max(0, Math.min(poured, rt.displayWallet() - w0 + (fired() - f0))));
      // 規則の払い出し数(count)のうち物理側に最初からある予備球(昇降管)は注がれない。7セグ・液晶は count 基準で見せるため、その分を最初から数える
      const reserve = eventId === 'ticket' ? Math.max(0, count - poured) : 0;
      return { poured: poured + reserve, landed: () => reserve + landed(), done: () => (landed() >= poured && now() - t0 > .5) || now() - t0 > poured / r + 6 };
    },
    collect() { /* 回収(精算)の物理は調整側のカウントが担当。演出は数字・光だけ */ },
  };
}

// lcd：液晶の面。null＝今の液晶（lcd.js の場面を描く）。{ canvas, frame(dt, F) } を渡すと lcd.js は読まず、その canvas（動画を貼る面、game_demo/play/lcd_surface）を液晶の板に貼る
export async function connectPlayEffects({ hr, bus, getSnapshot, lightingSources = [], rules = null, root = '/', lcdGain = 1, tutorial = true, tray = null, lcd = null, ownedFrontEarlyClip = false, ownedBackEarlyClip = false, ownedFrameSnapshot = false }) {
  const R = (p) => root + p;
  if (!lcd) {
    await loadScript(new URL('../lcd/lcd.js', here).href);
    await loadScript(new URL('../lcd/load_scenes.js', here).href);
    await import(new URL('../lcd/base_normal.mjs', here).href);
    await new Promise((r) => (window.LCD_BASE ? r() : addEventListener('lcd-base-ready', r, { once: true })));
  }
  await loadScript(new URL('./lightbus.js', here).href);
  { const alt = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('fxjs') : null; await loadScript(alt ? new URL(alt, location.href).href : new URL('./effects.js', here).href); }   // ?fxjs=... は前後比較の確認用(旧版の effects.js を差し替えて録画する)
  const [events, geom] = await Promise.all(['work/effects/spec/events.json', 'work/effects/spec/geometry.json'].map(async (p) => (await fetch(R(p))).json()));
  const fx = new window.Effects({ events, geom });
  fx.overlapLandingLights = !!rules?.ContinuousFire;
  fx.tutorial = tutorial && !rules?.R3Enabled;   // R3では旧「勝負」チュートリアルを起動しない
  if (!lcd) { const ok = await fx.initLcd({ root }); if (!ok) throw new Error('LCD init failed'); }
  if (rules) fx.setState({ rules: { r3Enabled: rules.R3Enabled, awards: rules.Awards, loanBalls: rules.LoanBalls, extraSeconds: rules.ExtraSeconds, thresholds: (rules.PrizeThresholds || []).slice(1), jackpotAwards: rules.JackpotAwards } });   // 数値は規則から(固定値にしない)
  let firedTotal = 0, prevBalls = null;   // 撃って減った持ち玉の累計(皿に着いた数の判定に使う)
  const trayA = trayAdapter(tray, () => clock, () => firedTotal); fx.setTray(trayA);   // 調整側の皿関数: { award(count,{eventId,duration,rate,origin}) -> {landed(),done()}?, collect({eventId,duration}) }。無ければ液晶と光だけ
  const adapter = new Stage2cLightAdapter({ geom, sources: Object.fromEntries(lightingSources.map((x) => [x.id, x])) });
  let seen = { shot: false, challenge: false }, clock = 0, bankPending = false;
  const lcd30=new URLSearchParams(globalThis.location?.search??'').get('lcd30')!=='0';
  let lcdElapsed=0,lcdDirty=true;
  const sync = () => {
    const s = getSnapshot().state;
    fx.setState({ n: s.lit, litPockets: s.pockets, canLaunch: s.canLaunch, declared: s.declared, sec: s.secondsLeft,
      first: { firstShot: seen.shot, firstDeclare: seen.challenge } });   // true = もう済んだ(false の間は発射ボタンを強く呼吸させ、tut_launch を出す)
  };
  const paramsOf = (e) => playEventParams(e, RANKS);
  bus.on('*', (e) => {
    lcdDirty=true;
    if (lcd?.onEvent) lcd.onEvent(e.id, paramsOf(e));   // 動画の液晶：ゲームの出来事で場面をつなぐ（JP の場面の切り替え、game_demo/play/lcd_surface/jp_seq.mjs）
    if (['jp_heat','jp_mouth'].includes(e.id)) return;
    if (e.id === 'launch') seen.shot = true;
    if (e.id === 'challenge_declare') seen.challenge = true;
    if (e.id === 'challenge_cancel') { fx.stop('challenge_declare'); return; }
    sync();
    if (trayA && HOLD[e.id] && e.data?.paid !== false) trayA.holdFor(e.id);
    // バスの通知はPresenterがpendingへ加算する直前にも届くので、次の描画フレームで解放。
    if (e.id === 'chain_stop') bankPending = true;
    try { fx.notify(e.id, paramsOf(e)); } catch (err) { console.warn('effects notify', e.id, err.message); }
  });
  // 勝負の玉をピンポイントで照らす(盤の釘・枠だけが光る点光源。勝負中の飛行中だけ)。玉の位置を画面座標へ射影して渡す
  let BL = null; try { BL = installBallLights(hr, { max: 44, ownedFrontEarlyClip, ownedBackEarlyClip }); } catch (err) { console.warn('ballLights', err.message); }
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  if (BL && BL.setMask) BL.setMask([150, 760, 1330, 1445], Number(qs.get('lcdmask') ?? .12), 30);   // 液晶の面は盤面の照射を弱める(通常画面の純青を紫・ピンクに染めない。点検 新e09)
  if (BL && BL.setClip && !qs.has('noclip')) BL.setClip([140, 650, 1345, 2020], Number(qs.get('clipsoft') ?? 22));   // 盤の洗いは囲い(ガラス窓の内側)だけ。外の枠・花びら周りは照らさない(10/17 ディレクター)
  if (qs.has('ebk')) adapter.bottomK = Number(qs.get('ebk'));   // 皿の縁(下辺)の縁LEDの強さ(0〜1)。省略=1
  const wash = BL && !qs.has('nowash') ? makeBoardWash(geom, adapter, { gain: Number(qs.get('washgain') ?? 2.2) }) : null;   // 盤面全体の電飾(花びら・縁の色を盤へ)
  const POCKET_X = [169, 355, 539, 722, 903, 1084, 1261], POCKET_Y = 1985;   // 7つの穴の口の画面座標(1440x2560。録画の口の位置から実測)
  const _v = new THREE.Vector3();
  const trail = new Map(), TRAIL = [[.05, .5], [.1, .4], [.17, .28], [.26, .17], [.38, .09]], BALL_R = Number(qs.get('ballr') ?? 34), BALL_G = Number(qs.get('ballg') ?? 3.5);
  const ballLights = (snap) => {
    if (!BL) return;
    const act = (last && last.active) || [], nl = last ? last.n ?? fx.dir.state.n : 0;
    if (!qs.has('ebk')) adapter.bottomK = act.some((id) => id === 'result' || id === 'finish_count') ? Number(qs.get('ebkr') ?? .3) : 1;   // 結果の頭で皿の縁まで光らない(ディレクター: 囲いの内側のみ)
    const hot = act.some((id) => /^(roulette|ascend|challenge_|success|jp|fail|lamp[456]|warn10|timeup|add100|finish_count|result|attract|title|howto|ticket|start)/.test(id));
    const redHot = act.some((id) => /^(roulette|challenge_declare|challenge_flight)$/.test(id));
    const list = last?.m3?.reflections ? last.m3.reflections.slice() : wash && last ? wash.compute(last, clock, { ambientMin: redHot ? .8 : 0, red: redHot ? 1 : 0, navy: nl <= 3 && !hot ? 1 : 0, k: act.some((id) => id === 'jp' || id === 'success_big') ? .85 : act.includes('fail') ? .6 : act.includes('timeup') ? .45 : act.some((id) => id === 'lamp4' || id === 'lamp5' || id === 'lamp6') ? .7 : act.some((id) => id === 'result' || id === 'finish_count') ? .55 : 1, rainbow: act.includes('jp') ? Number(qs.get('jprb') ?? .85) : 0, sat: act.some((id) => id === 'result' || id === 'finish_count') ? Number(new URLSearchParams(location.search).get('sat') ?? 2.4) : act.includes('lamp6') ? 2.1 : act.includes('lamp5') ? 1.7 : act.includes('lamp4') ? 1.5 : 1 }) : [];   // 大成功・JPは液晶が主役。盤面の照射が液晶をかすませないよう半分に
    // 重複ルーレット: 針の位置(花びらの輪)に追従する赤いスポット
    if (!last?.m3?.script1029 && act.includes('roulette') && last && last.__needle != null) {
      const th = last.__needle, P = fx.dir.pAng, G = geom.petals; let sx = 0, sy = 0, sw = 0;
      for (let i = 0; i < P.length; i++) { const d = Math.abs(P[i] - th), dd = Math.min(d, 1 - d), w = Math.exp(-Math.pow(dd / .05, 2)); sx += G[i].u * w; sy += G[i].v * w; sw += w; }
      if (sw > .01) list.push({ x: sx / sw * 1440, y: sy / sw * 2560, rgb: [1, .05, .07], radius: 460, gain: 3.4 });
    }
    // 盤の上の玉すべてに「玉を照らす光」: 玉の位置の小さな暖色の光(縁の反射が立つ)と、直前の位置に淡い尾。暗い紺の盤で黒い輪に沈まない
    if (snap && snap.count > 0 && !qs.has('noballglow')) {
      hr.camera.updateMatrixWorld(); const seen = new Set(); let nb = 0;
      for (let i = 0; i < snap.count && nb < 4; i++) {
        if (snap.kinds && snap.kinds[i] !== 0) continue;
        _v.set(snap.positions[i * 3], snap.positions[i * 3 + 1], snap.positions[i * 3 + 2]).project(hr.camera);
        const x = (_v.x * .5 + .5) * 1440, y = (.5 - _v.y * .5) * 2560, id = snap.ids ? snap.ids[i] : i;
        seen.add(id); let h = trail.get(id); if (!h) trail.set(id, h = []);
        if (!h.length || clock - h[h.length - 1].t >= .025) { h.push({ x, y, t: clock }); if (h.length > 24) h.shift(); }
        list.push({ x, y, rgb: [1, .86, .62], radius: BALL_R, gain: BALL_G, nomask: true });
        for (const [age, k] of TRAIL) {   // 尾: age秒前の位置(今の位置とほぼ同じなら出さない)
          let q = null; for (let j = h.length - 1; j >= 0; j--) if (clock - h[j].t >= age) { q = h[j]; break; }
          if (q && Math.hypot(q.x - x, q.y - y) > 14) list.push({ x: q.x, y: q.y, rgb: [1, .8, .55], radius: BALL_R * .75, gain: BALL_G * k, nomask: true });
        }
        nb++;
      }
      for (const id of trail.keys()) if (!seen.has(id)) trail.delete(id);
    }
    const on = last && last.active && last.active.includes('challenge_flight') && snap && snap.count > 0;
    if (on) {
      hr.camera.updateMatrixWorld(); let nb = 0;
      for (let i = 0; i < snap.count && nb < 3; i++) {
        if (snap.kinds && snap.kinds[i] !== 0) continue;   // 盤の上の玉だけ(皿・昇降管・シャトルは除く)
        _v.set(snap.positions[i * 3], snap.positions[i * 3 + 1], snap.positions[i * 3 + 2]).project(hr.camera);
        list.push({ x: (_v.x * .5 + .5) * 1440, y: (.5 - _v.y * .5) * 2560, rgb: [1, .74, .3], radius: 190, gain: 2.4 }); nb++;
      }
    }
    // 穴のLEDの照り返し: 7つの穴の口(U字の受け皿)の灯の強さに合わせて、口の真上の盤(釘・仕切り・ガラス)をその色で照らす。
    // 穴の真上に液晶の絵を置く代わりに(10/18 監督: 液晶の位置は実際の穴とずれて気持ち悪い)、穴そのものの光で当たり・外れ・入った穴を見せる。実機のLEDリングが口の周りを照らす想定。
    if (last && last.pocket && !qs.has('nopockethalo')) {
      for (let i = 0; i < 7; i++) {
        const r = last.pocket[i * 3], g = last.pocket[i * 3 + 1], b = last.pocket[i * 3 + 2], m = Math.max(r, g, b);
        if (m < 1.2) continue;
        const k = Math.min(1, m / 7.9) ** 1.2;
        list.push({ x: POCKET_X[i], y: POCKET_Y, rgb: [r / m, g / m, b / m], radius: 130 + 170 * k, gain: Number(qs.get('pgain') ?? 12) * k, nomask: true });
      }
    }
    BL.set(list);
  };
  // 筐体の7セグ(持ち玉)。タイトル〜ticketの前は消灯。払い出し中は皿に着いた数に合わせて増える。凍結像の「15」は誰も駆動しないと残る
  let digitsOn = false, digitsShown = null;
  bus.on('*', (e) => { if (e.id === 'ticket') digitsOn = true; else if (e.id === 'attract' || e.id === 'title' || e.id === 'howto') digitsOn = false; });
  const driveDigits = (frameState = null) => {
    const s = frameState ?? getSnapshot().state, L = window.LCD && window.LCD.state, th = fx._trayHandle;
    // 筐体の7セグ(と液晶の持ち玉の板)は「いま手元で使える玉」= 調整側の表示持ち玉(displayWallet: 皿に着いた分だけ増え、撃つと減る)に合わせる。
    // 以前は「財布 - (払い出し数 - 着いた数)」で見ていたため、払い出し中に撃つと払い出しが終わった判定にならず、数字が数玉小さいまま残った(R2-E 調査)。
    // 払い出しが始まる前(付与済みで皿に注がれていない玉がある間)は財布の増えた値を出さない(pending を引く)。
    const waiting = tray && tray.trayStatus ? tray.trayStatus().pending : 0;
    const dw = tray && tray.displayWallet ? tray.displayWallet() : null;
    const base = Math.max(0, s.balls - waiting);
    const v = !digitsOn ? -1 : dw !== null ? Math.max(0, Math.min(dw, base)) : (th && th.landed && fx._trayPay && L && L.trayLanded !== undefined ? Math.max(0, s.balls - Math.max(0, (fx._trayTotal || 0) - Math.floor(L.trayLanded))) : base);
    if (v === digitsShown) return; digitsShown = v;
    try { adapter.setCabinet({ display: { digits: ballCountToDigits(Math.max(0, v), { blank: v < 0 }) } }); } catch (err) { console.warn('digits', err.message); }
  };
  // LCD板: 最初のフレームで中身ができてから作る
  lcd?.attractSurface?.connectGpu({THREE,renderer:hr.renderer});
  let plate = null, splitComp = null, warmFrames = 0, last = null,uploadCanvas=null,uploadTexture=null,uploadRevision;
  const api = {
    get BL() { return BL; },
    get digitsShown() { return digitsShown; },
    fx, get frameData() { return last; }, get plate() { return plate; },
    frame(dt) {
      sync();
      if (bankPending) { trayA?.bank(); bankPending = false; }
      const frameState = getSnapshot().state;
      { const b = frameState.balls; if (prevBalls !== null && b < prevBalls && digitsOn) firedTotal += prevBalls - b; prevBalls = b; }
      clock += dt; driveDigits(ownedFrameSnapshot === true && typeof dt === 'number' ? frameState : null); if (!lcd) window.LCD.setState({ ballsShown: digitsShown }); last = fx.frame(dt);
      if (lcd) {
        lcdElapsed+=dt;
        // Effects/awards/lighting above still tick each frame. Only LCD painting
        // and its GPU composition run at the source-video cadence (30fps).
        if(lcd30&&dt>0&&!lcdDirty&&lcdElapsed<1/30-0.001){lcd.applyLights?.(last);last.lcd=lcd.canvas;return last;}
        const lcdDt=lcdElapsed;lcdElapsed=0;lcdDirty=false;
        lcd.frame(lcdDt,last);lcd.applyLights?.(last);last.lcd=lcd.canvas;
      }
      if (last.lcd) {
        if (!plate) plate = lcdMesh(hr, last.lcd, { gain: lcdGain });
        if (WARM_ON && lcd?.splitWarmers && lcd.attractSurface?.active && ++warmFrames > 60) { const w = lcd.splitWarmers.find(x => !x.done); if (w) { try { const t0 = performance.now(); w.step(hr.renderer); if (window.__perfprobe) (window.__warmLog ??= []).push([w.name, +(performance.now() - t0).toFixed(1)]); } catch (e) { w.done = true; console.warn('[splitwarm] 事前準備を止めます', w.name, e); } } }   // 待機(attract)中の空き時間に、1フレームに1手だけ
        {   // 重ね合わせ描画: 動かない絵は一度だけ送り、動く絵は行列だけ更新する。小さな render target へ合成して uT に渡す(液晶 canvas 7.5MB の毎回転送を省く)。層を出す画面だけ(?staffsplit=0 等で各画面が無効化)
          let layers = null;
          if (!lcd?.displayRecoveryActive && lcd?.splitSources?.length) for (const f of lcd.splitSources) { layers = f(); if (layers) break; }
          if (layers) {
            let tex = null;
            try { tex = (splitComp ??= createSplitCompositor(THREE, hr.renderer)).compose(layers); } catch (e) { lcd.splitBroken = true; console.warn('[lcdsplit] 合成に失敗。従来の全面 canvas に戻します', e); }
            if (tex) { window.__splitTexture = tex; if (!SPLIT_CHECK) { plate.mat.uniforms.uT.value = tex; uploadRevision = undefined; uploadCanvas = null; return last; } }
          }
        }
        const choice=lcd?.choiceV20;
        if(!lcd?.displayRecoveryActive&&lcd?.attractSurface?.directActive){
          const texture=lcd.attractSurface.compose();
          if(texture){plate.mat.uniforms.uT.value=texture;uploadRevision=undefined;return last;}
          lcd.attractSurface.materialize();
        }
        const gpu=lcd?.gpuPanelSource,covered=((choice?.active||choice?.holding)&&gpu?.owner!=='choice')||lcd?.attractSurface?.active||(lcd?.finalResultSurface?.active&&gpu?.owner!=='final-result')||lcd?.timeupSurface?.active;
        if(gpu&&!covered){
          const texture=gpu.backend.compose();
          if(texture){
            let outTex=texture;
            {   // 初見向けの重ね描き(ナイス！等)は、GPU の映像の上に小さい層で重ねる(液晶 canvas へ落とさない)。?ftsplit=0 で従来
              const fl=!lcd?.displayRecoveryActive&&!lcd?.splitBroken?((h,f)=>h||f?[...(h??[]),...(f??[])]:null)(lcd?.jpHud?.splitLayers?.(),lcd?.firstTimer?.splitLayers?.()):null;   // JPチャンスの札・焦り(jp_hud_1031)＋初見向けの重ね描き
              if(fl){try{const t2=(splitComp??=createSplitCompositor(THREE,hr.renderer)).compose([{tex:texture,w:1240,h:1510,ax:0,ay:0,x:0,y:0,rot:0,sc:1,alpha:1,add:false,...(lcd?.jpStart?.baseXform?.()??null)},...fl]);if(t2){outTex=t2;window.__ftSplitTexture=t2;}}catch(e){lcd.splitBroken=true;console.warn('[lcdsplit] 重ね描きの合成に失敗。従来へ戻します',e);}}
            }
            plate.mat.uniforms.uT.value=outTex;gpu.published=true;uploadRevision=undefined;return last;
          }
          lcd.materializeGpuLcd?.('compose-failed',true);
        }
        plate.mat.uniforms.uT.value=plate.tex;

        const revision=ownedFrameSnapshot===true&&lcd?.canvas===last.lcd&&!choice?.active&&!choice?.holding?lcd.uploadRevision:undefined;
        const stable=Number.isSafeInteger(revision)&&revision>=0&&plate.tex.image===last.lcd;
        if(!stable||uploadCanvas!==last.lcd||uploadTexture!==plate.tex||plate.tex.image!==last.lcd||uploadRevision!==revision)plate.tex.needsUpdate=true;
        uploadCanvas=last.lcd;uploadTexture=plate.tex;uploadRevision=stable?revision:undefined;
        {   // 時計(残り時間)は液晶 canvas に描かず小さい層で重ねる: 液晶 canvas の保存・復元(読み戻し)を無くす。?timersplit=0 で従来
          const tl0=!lcd?.displayRecoveryActive&&!lcd?.splitBroken?lcd?.timerSplit?.layer():null,jh=!lcd?.displayRecoveryActive&&!lcd?.splitBroken?lcd?.jpHud?.splitLayers?.():null,tl=jh?[...(tl0?(Array.isArray(tl0)?tl0:[tl0]):[]),...jh]:tl0;   // 2D 面の経路でも JPチャンスの札を重ねる
          if(tl&&last.lcd.width===1240&&last.lcd.height===1510){
            let tex=null;
            try{tex=(splitComp??=createSplitCompositor(THREE,hr.renderer)).compose([{tex:plate.tex,w:1240,h:1510,ax:0,ay:0,x:0,y:0,rot:0,sc:1,alpha:1,add:false,...(lcd?.jpStart?.baseXform?.()??null)},...(Array.isArray(tl)?tl:[tl])]);}catch(e){lcd.splitBroken=true;console.warn('[lcdsplit] 時計の合成に失敗。従来へ戻します',e);}
            if(tex){window.__timerSplitTexture=tex;plate.mat.uniforms.uT.value=tex;}
          }
        }
      }
      return last;
    },
    // play の draw 内で、hr.setLightingFrame の直前に1回だけ呼ぶ(光の最終の書き手)。光層の source_id との対応が付いたものだけ書き換える
    applyLights(lf) { return adapter.apply(last, lf, clock); }, adapter, ballLights,
    clockStopped: () => fx.clockStopped(), clockStopReason: () => fx.clockStopReason(), clockStopStats: () => fx.clockStopStats(),
    setLcdGain(g) { if (plate) plate.mat.uniforms.uGain.value = g; },
  };
  return api;
}
