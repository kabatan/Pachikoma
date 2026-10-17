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
function trayAdapter(rt, now) {
  if (!rt || !rt.awardToTray) return null;
  rt.setAwardHold(true, 4);
  return {
    holdFor(id) { rt.setAwardHold(true, HOLD[id] || 4); },
    award(count, { eventId, rate }) {
      const r = Math.max(2, Math.min(40, rate || 12)), t0 = now(), w0 = rt.displayWallet ? rt.displayWallet() : null;
      const poured = rt.awardToTray(count, { rate: r, origin: eventId }) || 0;
      (window.__awards || (window.__awards = [])).push({ eventId, count, poured, w0, t0, rate: r });
      // 皿に着いた数は、調整側の「いま表示している持ち玉(7セグ)」の増えで見る。取れない時だけ時間で見積もる。
      const landed = () => (w0 === null ? Math.min(poured, Math.max(0, now() - t0 - .5) * r) : Math.max(0, Math.min(poured, rt.displayWallet() - w0)));
      // 規則の払い出し数(count)のうち物理側に最初からある予備球(昇降管)は注がれない。7セグ・液晶は count 基準で見せるため、その分を最初から数える
      const reserve = eventId === 'ticket' ? Math.max(0, count - poured) : 0;
      return { poured: poured + reserve, landed: () => reserve + landed(), done: () => landed() >= poured && now() - t0 > .5 };
    },
    collect() { /* 回収(精算)の物理は調整側のカウントが担当。演出は数字・光だけ */ },
  };
}

export async function connectPlayEffects({ hr, bus, getSnapshot, lightingSources = [], rules = null, root = '/', lcdGain = 1, tutorial = true, tray = null }) {
  const R = (p) => root + p;
  await loadScript(new URL('../lcd/lcd.js', here).href);
  await loadScript(new URL('../lcd/load_scenes.js', here).href);
  await import(new URL('../lcd/base_normal.mjs', here).href);
  await new Promise((r) => (window.LCD_BASE ? r() : addEventListener('lcd-base-ready', r, { once: true })));
  await loadScript(new URL('./lightbus.js', here).href);
  await loadScript(new URL('./effects.js', here).href);
  const [events, geom] = await Promise.all(['work/effects/spec/events.json', 'work/effects/spec/geometry.json'].map(async (p) => (await fetch(R(p))).json()));
  const fx = new window.Effects({ events, geom });
  fx.tutorial = tutorial;
  const ok = await fx.initLcd({ root });
  if (!ok) throw new Error('LCD init failed');
  if (rules) fx.setState({ rules: { awards: rules.Awards, loanBalls: rules.LoanBalls, extraSeconds: rules.ExtraSeconds, thresholds: (rules.PrizeThresholds || []).slice(1), jackpotAwards: rules.JackpotAwards } });   // 数値は規則から(固定値にしない)
  const trayA = trayAdapter(tray, () => clock); fx.setTray(trayA);   // 調整側の皿関数: { award(count,{eventId,duration,rate,origin}) -> {landed(),done()}?, collect({eventId,duration}) }。無ければ液晶と光だけ
  const adapter = new Stage2cLightAdapter({ geom, sources: Object.fromEntries(lightingSources.map((x) => [x.id, x])) });
  let seen = { shot: false, challenge: false }, clock = 0;
  const sync = () => {
    const s = getSnapshot().state;
    fx.setState({ n: s.lit, litPockets: s.pockets, canLaunch: s.canLaunch, declared: s.declared, sec: s.secondsLeft,
      first: { firstShot: seen.shot, firstDeclare: seen.challenge } });   // true = もう済んだ(false の間は発射ボタンを強く呼吸させ、tut_launch を出す)
  };
  const paramsOf = (e) => {
    const d = e.data || {}, f = e.state.first || {};
    const first = f.shot || f.light || f.duplicate || f.challenge || f.success || f.failure || false;
    const p = { first };
    if (d.payout !== undefined) p.payout = d.payout; else if (d.award) p.payout = d.award;
    if (d.k !== undefined) p.k = d.k; if (d.n_from !== undefined) p.n_from = d.n_from;
    if (d.rank !== undefined) p.rank = typeof d.rank === 'number' ? d.rank : (RANKS[d.rank] ?? 0);
    const lane = d.pocket ?? d.lane; if (lane !== undefined) { p.pocket = lane; p.hit = lane; }
    if (d.near_miss !== undefined) p.near_miss = !!d.near_miss; if (d.target !== undefined) p.target = d.target;   // 惜しい: 物理で実際に近かった時だけ
    if (d.to_next !== undefined) { p.to_next = d.to_next; p.next_rank = d.next_rank; }   // 次の景品まで(実数)
    if (d.total !== undefined) p.total = d.total; else if (d.balls !== undefined && (e.id === 'finish_count' || e.id === 'result' || e.id === 'tray_overflow')) p.total = d.balls;
    if (e.id === 'jp') { if (d.tier !== undefined) p.tier = d.tier; if (d.duration > 0) p.duration = d.duration; }   // JP全尺はゲームが決める(14/16/20/24/28秒)
    if (d.reason !== undefined) p.reason = d.reason; if (d.reasonCode) p.reason = d.reasonCode;
    if (e.id === 'lamp123') p.n = e.state.lit;
    if (e.id === 'roulette' && p.n_from === undefined) p.n_from = d.before?.length ?? e.state.lit;
    p.weak = e.id === 'warn10' ? (e.state.balls < 6) : undefined;
    return p;
  };
  bus.on('*', (e) => {
    if (e.id === 'launch') seen.shot = true;
    if (e.id === 'challenge_declare') seen.challenge = true;
    if (e.id === 'challenge_cancel') { fx.stop('challenge_declare'); return; }
    sync();
    if (trayA && HOLD[e.id]) trayA.holdFor(e.id);
    try { fx.notify(e.id, paramsOf(e)); } catch (err) { console.warn('effects notify', e.id, err.message); }
  });
  // 勝負の玉をピンポイントで照らす(盤の釘・枠だけが光る点光源。勝負中の飛行中だけ)。玉の位置を画面座標へ射影して渡す
  let BL = null; try { BL = installBallLights(hr, { max: 36 }); } catch (err) { console.warn('ballLights', err.message); }
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  if (BL && BL.setMask) BL.setMask([150, 760, 1330, 1445], Number(qs.get('lcdmask') ?? .12), 30);   // 液晶の面は盤面の照射を弱める(通常画面の純青を紫・ピンクに染めない。点検 新e09)
  if (BL && BL.setClip && !qs.has('noclip')) BL.setClip([140, 650, 1345, 2020], Number(qs.get('clipsoft') ?? 22));   // 盤の洗いは囲い(ガラス窓の内側)だけ。外の枠・花びら周りは照らさない(10/17 ディレクター)
  if (qs.has('ebk')) adapter.bottomK = Number(qs.get('ebk'));   // 皿の縁(下辺)の縁LEDの強さ(0〜1)。省略=1
  const wash = BL && !qs.has('nowash') ? makeBoardWash(geom, adapter, { gain: Number(qs.get('washgain') ?? 2.2) }) : null;   // 盤面全体の電飾(花びら・縁の色を盤へ)
  const _v = new THREE.Vector3();
  const trail = new Map(), TRAIL = [[.05, .5], [.1, .4], [.17, .28], [.26, .17], [.38, .09]], BALL_R = Number(qs.get('ballr') ?? 34), BALL_G = Number(qs.get('ballg') ?? 3.5);
  const ballLights = (snap) => {
    if (!BL) return;
    const act = (last && last.active) || [], nl = last ? last.n ?? fx.dir.state.n : 0;
    if (!qs.has('ebk')) adapter.bottomK = act.some((id) => id === 'result' || id === 'finish_count') ? Number(qs.get('ebkr') ?? .3) : 1;   // 結果の頭で皿の縁まで光らない(ディレクター: 囲いの内側のみ)
    const hot = act.some((id) => /^(roulette|ascend|challenge_|success|jp|fail|lamp[456]|warn10|timeup|add100|finish_count|result|attract|title|howto|ticket|start)/.test(id));
    const redHot = act.some((id) => /^(roulette|challenge_declare|challenge_flight)$/.test(id));
    const list = wash && last ? wash.compute(last, clock, { ambientMin: redHot ? .8 : 0, red: redHot ? 1 : 0, navy: nl <= 3 && !hot ? 1 : 0, k: act.some((id) => id === 'jp' || id === 'success_big') ? .85 : act.includes('fail') ? .6 : act.includes('timeup') ? .45 : act.some((id) => id === 'lamp4' || id === 'lamp5' || id === 'lamp6') ? .7 : act.some((id) => id === 'result' || id === 'finish_count') ? .55 : 1, rainbow: act.includes('jp') ? Number(qs.get('jprb') ?? .85) : 0, sat: act.some((id) => id === 'result' || id === 'finish_count') ? Number(new URLSearchParams(location.search).get('sat') ?? 2.4) : act.includes('lamp6') ? 2.1 : act.includes('lamp5') ? 1.7 : act.includes('lamp4') ? 1.5 : 1 }) : [];   // 大成功・JPは液晶が主役。盤面の照射が液晶をかすませないよう半分に
    // 重複ルーレット: 針の位置(花びらの輪)に追従する赤いスポット
    if (act.includes('roulette') && last && last.__needle != null) {
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
    BL.set(list);
  };
  // 筐体の7セグ(持ち玉)。タイトル〜ticketの前は消灯。払い出し中は皿に着いた数に合わせて増える。凍結像の「15」は誰も駆動しないと残る
  let digitsOn = false, digitsShown = null;
  bus.on('*', (e) => { if (e.id === 'ticket') digitsOn = true; else if (e.id === 'attract' || e.id === 'title' || e.id === 'howto') digitsOn = false; });
  const driveDigits = () => {
    const s = getSnapshot().state, L = window.LCD && window.LCD.state, th = fx._trayHandle;
    // 払い出し中(ticket・成功・追加100円)は、財布の玉数のうち「まだ皿に着いていない分」を引いて、皿に着くたびに増やす
    // 払い出しが始まる前(付与済みで皿に注がれていない玉がある間)は、財布の増えた値を出さない。皿に着いた分だけ増える
    const waiting = !th && tray && tray.trayStatus ? tray.trayStatus().pending : 0;
    const v = !digitsOn ? -1 : (th && th.landed && fx._trayPay && L && L.trayLanded !== undefined ? Math.max(0, s.balls - Math.max(0, (fx._trayTotal || 0) - Math.floor(L.trayLanded))) : Math.max(0, s.balls - waiting));
    if (v === digitsShown) return; digitsShown = v;
    try { adapter.setCabinet({ display: { digits: ballCountToDigits(Math.max(0, v), { blank: v < 0 }) } }); } catch (err) { console.warn('digits', err.message); }
  };
  // LCD板: 最初のフレームで中身ができてから作る
  let plate = null, last = null;
  const api = {
    get BL() { return BL; },
    get digitsShown() { return digitsShown; },
    fx, get frameData() { return last; }, get plate() { return plate; },
    frame(dt) {
      sync();
      clock += dt; last = fx.frame(dt);
      driveDigits();
      if (last.lcd) { if (!plate) plate = lcdMesh(hr, last.lcd, { gain: lcdGain }); plate.tex.needsUpdate = true; }
      return last;
    },
    // play の draw 内で、hr.setLightingFrame の直前に1回だけ呼ぶ(光の最終の書き手)。光層の source_id との対応が付いたものだけ書き換える
    applyLights(lf) { return adapter.apply(last, lf, clock); }, adapter, ballLights,
    clockStopped: () => fx.clockStopped(), clockStopReason: () => fx.clockStopReason(), clockStopStats: () => fx.clockStopStats(),
    setLcdGain(g) { if (plate) plate.mat.uniforms.uGain.value = g; },
  };
  return api;
}
