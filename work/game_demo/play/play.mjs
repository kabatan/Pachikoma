// 通しプレイ: 規則+480Hz Rapier+光層+DOM UI。
// ?seed=N &manual &nolog &quiet &debug &pack=<manifest URLまたはディレクトリ>
import RAPIER from '../physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { installRigidSyncGuard } from '../physics/rigid_sync_guard.mjs';
import { PhysicsAdapter, RAPID_SUPPLY } from '../physics/adapter.mjs';
import { attachTrayVisual } from '../physics/tray_visual.mjs';
import { createMedalApp } from '../ui/demo_host_h_20261029.mjs';   // G／従来の規則はそのまま(同じ配線)。?rules=h のときだけ H の操作・規則
import { HybridRenderer } from '../web/src/hybrid_renderer.mjs';
import { Gen } from '../web/src/dummy.mjs';
import { connectLayerPack, connectAssemblyBalls } from './render_bridge.mjs';
import { createRuntime } from './runtime.mjs';
import { EffectsBus } from './effects_bus.mjs';
import { loadPlayConfig, loadPlayRules } from './config_h_20261029.mjs';   // 既定は G の読み込みに渡す。?rules=h のときだけ H の設定(config_h_20261029.json)
import { prewarm } from './prewarm.mjs';
import { createLauncherBody } from './launcher_body.mjs';
import { CabinetSerial } from './cabinet_serial_r3_20261029.mjs';
import { createLedStrip } from './led_strip_20261029.mjs';
import { createLaunchLamp } from './launch_lamp_20261029.mjs';
import { winSeconds, JACKPOT_SECONDS } from '../rules/medal_rules.mjs';

async function main() {
const q = new URLSearchParams(location.search);
async function readText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); }
const DEFAULT_PLAY_CONFIG = 'work/game_demo/play/config_g_20261028.json', DEFAULT_PACK = '/assembly/sol61_v36_pack/stage2c/manifest.json';   // 引数なしで開いた時の本番構成(?config=&pack= で上書き、空文字で無効)
const M3_PROBE126_PACK = '/assembly/sol61_v36_pack/stage2c_probe126_rgb/manifest.json'; // Private default-M3 tail/bitset environment plus private RGB16F physical probes.
const config = await loadPlayConfig(q.has('config') ? q.get('config') : DEFAULT_PLAY_CONFIG, readText);
const seed = q.has('seed') ? Number(q.get('seed')) : config.seed ?? 1;
const playRules = await loadPlayRules(config.rules, readText);
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const paOptions = {
  readText: (p) => readText(new URL(p, CAB)), importModule: (p) => import(new URL(p, CAB).href), seed, stageDir: config.stageDir, jitter: config.jitter,
  ...(playRules.MaxInFlight > 1 ? RAPID_SUPPLY : {}),   // 同時発射なら玉の補給も連射に合わせる
  continuousSupply: playRules.ContinuousFire,
  boardTimeScale: Number(q.get('pscale') ?? 0.35),   // 盤上の玉の進み(1=実時間)。落下を目で追える速さ(平均0.72秒→約2秒)。?pscale=1 で実時間
};
// ?physworker=1: 物理を専用 Worker で回す試験モード(同じ API の代理。physics/worker/README.md)。指定なしは従来どおり主スレッドの PhysicsAdapter
const pa = q.get('physworker') === '1' ? await (await import('../physics/worker/physics_proxy.mjs')).PhysicsWorkerProxy.create(paOptions) : await PhysicsAdapter.create(RAPIER, paOptions);
if (config.naturalBoardMotion) { pa.board.allowJamKick = false; pa.board.allowStuckNudge = false; }
// 固定buildの独立file SHA証拠を前提とする。runtime認証ではない。?rigidsync=0で従来の同期。
const syncGuards = [];
if (!pa.isWorkerProxy && q.get('rigidsync') !== '0') {
  const sourceFingerprint = { packageVersion: '0.21.0', bundleSha256: '6ef5000c7200716131f6d008fa6cc947f18a38bb717ad3a36dfc9c3e1ba29b3a' };
  const rollbackSync = () => {
    while (syncGuards.length) {
      try { syncGuards.pop().dispose(); } catch (cleanupError) { console.error('[rigid-sync rollback]', cleanupError); }
    }
  };
  try {
    for (const world of [pa.bw, pa.tw]) {
      const guard = installRigidSyncGuard(world, RAPIER, { ownedNormalApi: true, sourceFingerprint, mode: 'skip' });
      if (!guard.installed) { rollbackSync(); break; }
      syncGuards.push(guard);
    }
  } catch (error) { rollbackSync(); throw error; }
}
pa.playConfig = { ...config, seed, pinCount: pa.board.layout.pins.length };
const M3 = q.get('cabinet') !== 'r2';   // m3が既定。?cabinet=r2で旧筐体を残す
const hr = new HybridRenderer({ canvas: document.getElementById('c'), maxBalls: 700, lutUrl: new URL('../web/assets/lut/pbrneutral_lg2_57_lin', import.meta.url).href, deferEnvironment: M3 && !q.has('pack'), deferProbeBases: M3 && !q.has('pack') });
await hr.init();
attachTrayVisual(hr, pa);
hr.setBallBounce(Number(q.get('ballbounce') ?? 0.5));   // 玉の下半球の照り返し（既定0.5で銀色に見える。?ballbounce=0 で従来）
const setAssemblyBalls = connectAssemblyBalls(hr, pa.transforms);
const renderQuery = new URLSearchParams(q); if (M3) renderQuery.set('render', 'legacy');   // m3 は stage2c の皿の環境とプローブだけを使う(R2の筐体の絵は使わない)
let initialEnvironment = M3 ? hr.env : null; // このplayがinitで生成した専有dummy RTだけを捕捉
const pack = await (await import('../render_r2/select_render.mjs')).connectRender(hr, renderQuery, M3 && !q.has('pack') ? M3_PROBE126_PACK : DEFAULT_PACK, { loadLayers: !M3, ownedM3Prefix: M3 && !q.has('pack') });   // m3は後で全光層を外すため、光源metadata・環境・probeのみ読む。R2は従来どおり
if (initialEnvironment) {
  const slots = e => [...Object.values(e.back), ...Object.values(e.front), e.tau, e.occ];
  const live = new Set(slots(hr.env).flatMap(x => [x, x?.texture]).filter(Boolean));
  for (const rt of new Set(slots(initialEnvironment))) {
    if (rt?.isWebGLRenderTarget && !live.has(rt) && !live.has(rt.texture)) rt.dispose();
  }
  initialEnvironment = null; // r2/未置換slotは保持し、捕捉した旧envへの参照だけを解放
}
// H(?rules=h): 連打中の無料の球(shot.free)。持ち玉は減らさないので、物理側の玉の台帳を合わせるため、撃つ前に予備球を1つ補給し、盤から消えた(外れて返らない)ときは取り消す。既定(G)では shot.free が無く何も起きない
const freeShotIds = new Set();
const app = await createMedalApp(document.getElementById('stage'), {
  hooks: { launchBall(shot, aim, dir) { if (shot.free && !pa.isWorkerProxy) { pa.stock++; freeShotIds.add(shot.id); } pa.setAim(aim, dir); pa.launch(shot.id); }, cancelFlights() { freeShotIds.clear(); pa.reset(); }, canReset() { return app.presenter.count.done; } },
  rulesUrl: config.rules, seed, quiet: q.has('quiet'), music: false, log: !q.has('nolog'), human: !q.has('nolog') && !q.has('qa') && !q.has('manual'), manual: true,
});
const { ctrl, presenter } = app, effects = new EffectsBus();
if (playRules.RuleVariant === 'H_20261029') {   // 無料の球が盤の外へ落ちた(lost)ときは、物理側が予備球に戻すので、その1球を取り消す(規則側は無料なので返金しない)
  const landing0 = ctrl.landing.bind(ctrl);
  ctrl.landing = (shotId, lane, reached = true) => { if (freeShotIds.delete(shotId) && !reached && !pa.isWorkerProxy) pa.stock = Math.max(0, pa.stock - 1); return landing0(shotId, lane, reached); };
}
app.history?.setContext({ configName: config.name, stageDir: config.stageDir, rulesUrl: config.rules, seed });
const cabinet = new CabinetSerial({ serial: navigator.serial, ctrl, button: document.getElementById('serial-connect'), status: document.getElementById('serial-status'), onInput: app.onInput, wake: () => { try { app.audio.unlock?.()?.catch?.(() => {}); } catch {} } });   // R3: 左右ボタンだけで進行(+ブラウザ音声の起こし)・LED帯の色もこの経路で送る
await cabinet.init();
const ledStrip = createLedStrip({ cabinet, getPhase: () => ctrl.game.phase, preview: q.get('ledpreview') === '1' }); window.__ledStrip = ledStrip.state;
const howtoDur = await fetch(new URL('../../effects/spec/events.json', import.meta.url)).then(r => r.json()).then(j => j.events.find(e => e.id === 'howto')?.dur).catch(() => null);   // 説明の長さは演出の仕様(events.json)に従う
const HOWTO_ENABLED = false;   // 10/29 遊び方(チュートリアル)は後で作り直す。コードは残し、true か ?howto=秒数 で戻る。
ctrl.howtoSeconds = Number(q.get('howto') ?? (!HOWTO_ENABLED ? 0 : playRules.R3Enabled ? 8 : howtoDur ?? 5.2));
if (playRules.R3Enabled) ctrl.howtoPanels = 3;   // 開始前のルール説明(時計に含めない・もう一度押すと飛ばせる)。?howto=0 で無効
window.__effects = effects;
if (q.get('effects_log') === '1') effects.on('*', e => console.log('[effects]', e));
// 公開音響はr2既定。?audio=legacyで従来音響。声は明示指定時のみ。読込失敗時は従来音響を維持する。
let r2Audio = null;
if (q.get('audio') !== 'legacy') {
  try {
    const { connectAudio } = await import('../../audio/runtime/connect_audio.mjs');
    // 固定build/file SHAの独立証拠を前提とする。pin定数はruntime認証ではない。
    // 本番M3/R3の所有main Worldだけ既定ON。?audioquery=0で元の一段query。
    const nativeQueryProof = M3 && playRules.R3Enabled && !pa.isWorkerProxy && q.get('audioquery') !== '0'
      ? (await import('../../audio/runtime/native_contact_query.mjs')).createOwnedNativeQueryProof(RAPIER, { ownedNativeReadOnly: true, sourcePin: { packageVersion: '0.21.0', bundleSha256: '6ef5000c7200716131f6d008fa6cc947f18a38bb717ad3a36dfc9c3e1ba29b3a' } }) : null;
    const bgmManifest = new URL('../../audio/bgm/manifest.json', import.meta.url);
    const bgmOverride = q.get('bgm');
    let releaseBgmOn = false;
    if (bgmOverride !== '1' && bgmOverride !== '0') {
      try {
        const response = await fetch(bgmManifest, { cache: 'no-store' });
        if (!response.ok) throw new Error(`BGM manifest HTTP ${response.status}`);
        releaseBgmOn = (await response.json()).release_default_on === true;
      } catch (error) { console.warn('[r2-bgm-default]', error); }
    }
    r2Audio = await connectAudio({ pa, bus: effects, nativeQueryProof,
      jpPrewarmEvents: app.rules.JackpotAwards.map((award,tier)=>({duration:app.rules.JackpotEffectSeconds!=null?app.rules.JackpotEffectSeconds[tier]:winSeconds(award)+JACKPOT_SECONDS,tier})),
      voiceProvider: q.get('voice') ?? 'off',
      bgmEnabled: bgmOverride === '1' || (bgmOverride !== '0' && releaseBgmOn),
      bgmManifest, getPhase: () => ctrl.game.phase,
    });
    const { bindBgmControls } = await import('../../audio/runtime/bgm_controls.mjs');
    bindBgmControls(r2Audio.engine, document.getElementById('audio-panel'));
    // 通常演出の録音BGM・実機風SE・玉の音。?pachi=0で従来の音
    if (q.get('pachi') !== '0') { try { window.__pachiSound = await (await import('../../audio/runtime/pachi_sound.mjs')).installPachiSound(r2Audio.engine); } catch (error) { console.error('[pachi-sound]', error); } }
    if (q.get('normalsfx') !== '0') { try { window.__normalAudio = await (await import('../../audio/runtime/normal_audio_1029.mjs')).installNormalAudio1029(r2Audio.engine); } catch (error) { console.error('[normal-audio]', error); } }   // 通常時(JP前)の効果音。映像のフラッシュに合わせた新しい音。?normalsfx=0 で従来音
    if (q.get('jpbgm') || q.get('jpaudio') === 'old') { try { window.__jpAudio = await (await import('../../audio/jp_proto_1029/runtime/jp_audio.mjs')).installJpAudio(r2Audio.engine, q.get('jpbgm') || 'A'); } catch (error) { console.error('[jp-audio]', error); } }   // 旧JP音(第1〜3版の試作)。?jpaudio=old または ?jpbgm=A|B|C のときだけ
    else if (q.get('jpaudio') === 'v4') { try { window.__jpAudio = await (await import('../../audio/jp_proto_1029/runtime/jp_audio_v4.mjs')).installJpAudioV4(r2Audio.engine); } catch (error) { console.error('[jp-audio]', error); } }   // 第4版のJP音。?jpaudio=v4 のときだけ(既定は第5版)
    else if (q.get('jpaudio') !== 'off') { try { window.__jpAudio = await (await import('../../audio/jp_proto_1029/runtime/jp_audio_v5.mjs')).installJpAudioV5(r2Audio.engine); } catch (error) { console.error('[jp-audio]', error); } }   // 既定のJP音(第5版)。?jpaudio=v4 で第4版、?jpaudio=off で無効
    const { VOICE_CREDITS } = await import('../../audio/runtime/voice_catalog.mjs');
    const voiceCredit = VOICE_CREDITS[r2Audio.engine.voiceProvider];
    document.getElementById('audio-credits').hidden = r2Audio.engine.voiceProvider === 'off' || !voiceCredit;
    document.getElementById('audio-voice-credit').textContent = voiceCredit ?? '';
    app.audio.dispose(); presenter.audio = null;  // 旧SE/釘/皿/計数ループの二重発音を止める
    app.audio.unlock = () => r2Audio.engine.unlock();  // attachInput が保持する旧オブジェクトの解除口
    document.getElementById('audio-panel').hidden = false;
    document.getElementById('audio-master').addEventListener('input', e => r2Audio.engine.setMaster(e.target.value));
  } catch (error) { console.error('[r2-audio]', error); }
}
let m3Clock = 0;
// 発射口の「打てる/打てない」表示と音(射出器のレンズの色・小さな音。液晶に字は出さない)。?launchlamp=0 で無効
const launchLamp = q.get('launchlamp') === '0' ? null : createLaunchLamp({ ctrl, getEngine: () => r2Audio?.engine, getExtraHold: () => !!(ctrl.game.chainStatus?.inChallenge && window.__lcdSurface?.choiceV20?.holding), now: () => m3Clock }); window.__launchLamp = launchLamp;
const runtime = createRuntime({ ctrl, presenter, pa, log: app.log, effects, onRecall: n => launchLamp?.noteRecall(n) });
// 演出側(work/effects)の液晶・光の接続。?nofx で無効。演出側の1ファイルだけを読む。
const lightState = { secondsLeft: Infinity, playing: false };   // R3: 囲いの電飾・LED帯の閃き用(残り秒数と遊技中か)
let fxApi = null;
if (!q.has('nofx')) {
  const { connectPlayEffects } = await import('../../effects/runtime/play_fx.mjs');
  // 動画液晶が既定。?lcd=legacyで旧Canvas液晶。m3ではpanelいっぱいに貼る
  // Native palace producer shares the cabinet GL. ?palacegpu=0 restores the original image path.
  const palaceImageFactory = M3 && q.get('palacegpu') !== '0' ? async o => (await import('./lcd_surface/palace_gpu_image_1029.mjs')).createPalaceGpuImage({...o, drawWarm:q.get('palacewarm')!=='0', renderer:hr.renderer, THREE:await import('../web/vendor/three/three.module.js')}) : null;
  // Result compositor uses the cabinet context; ?resultgpu=0 restores its separate GL/Canvas path.
  const fullPanelPrevious=M3&&q.get('finalresultgpu')!=='0'&&q.get('finalprevious')!=='0'&&q.get('lcd')!=='legacy'?(await import('./lcd_surface/fullpanel_previous_1029.mjs')).createFullPanelPreviousBridge({renderer:hr.renderer,THREE:await import('../web/vendor/three/three.module.js')}):null;
  const resultBoundaryGpu = M3 && q.get('resultlease') !== '0' && q.get('resultgpu') !== '0' && q.get('videogpu') !== '0' && q.get('lcd') !== 'legacy' ? (await import('./lcd_surface/result_snapshot_pool_1029.mjs')).createResultSnapshotPool({renderer:hr.renderer,THREE:await import('../web/vendor/three/three.module.js')}) : null;
  const resultImageFactory = M3 && q.get('resultgpu') !== '0' ? async o => (await import('./lcd_surface/result_gpu_image_1029.mjs')).createResultGpuImage({...o, boundaryGpu:resultBoundaryGpu, renderer:hr.renderer, THREE:await import('../web/vendor/three/three.module.js')}) : null;
  // Normal/plain-JP video shares the main context; ?videogpu=0 restores Canvas rendering.
  const videoImageFactory = M3 && q.get('videogpu') !== '0' ? async o => (await import(resultBoundaryGpu?'./lcd_surface/video_gpu_history_1029.mjs':'./lcd_surface/video_gpu_image_1029.mjs')).createVideoGpuImage({...o, renderer:hr.renderer, THREE:await import('../web/vendor/three/three.module.js')}) : null;
  let lcd;try{lcd = q.get('lcd') !== 'legacy' ? await (await import('./lcd_surface/lcd_surface_confirm1029.mjs')).createLcdSurface({ palaceImageFactory, resultImageFactory, videoImageFactory, resultBoundaryGpu, fullPanelPrevious, manifestUrl: new URL(q.get('lcdclips') ?? './lcd_surface/ryugu1028/manifest.json', import.meta.url).href, jpManifestUrl: q.get('jpclips') === 'off' ? null : new URL(q.get('jpclips') ?? './lcd_surface/jp1029/manifest_confirm1029.json', import.meta.url).href, onJpCue: c => { if(c.kind==='hold'){const rank=app.rules.PrizeNames.indexOf(runtime.getPrize());runtime.setJpHold(true);return rank;} if(c.kind==='reveal'){runtime.setJpHold(false);} if(c.kind==='tray')runtime.awardToTray(c.count==='payout'?c.payout:c.count,{rate:c.rate,origin:'jp_reveal'}); if(c.kind==='snd')window.dispatchEvent(new CustomEvent('jp-scene-cue',{detail:c})); if(c.kind==='end'&&runtime.jpHold){runtime.setJpHold(false);runtime.releaseAwards({rate:24});} }, getState: () => ({ ...effects.contextSnapshot().state, phase: ctrl.game.phase, howtoT: ctrl.howto?.t, prize: ctrl.game.prize, score: ctrl.game.jackpotEarnings, chain: ctrl.game.chainStatus, rules: app.rules }) }) : null;}catch(error){fullPanelPrevious?.dispose();resultBoundaryGpu?.dispose();throw error;}   // 全穴JP・継続。文言/熱さは jp_direction_allholes_v1.json。
  if(fullPanelPrevious){if(lcd){const dispose=lcd.dispose.bind(lcd);lcd.dispose=()=>{try{return dispose();}finally{fullPanelPrevious.dispose();}};}else fullPanelPrevious.dispose();}
  if(resultBoundaryGpu){if(lcd){const dispose=lcd.dispose.bind(lcd);lcd.dispose=()=>{try{return dispose();}finally{resultBoundaryGpu.dispose();}};}else resultBoundaryGpu.dispose();}
  if(lcd?.jp){   // 液晶の映像の長さ・状態を規則へ渡す(規則は映像を知らない): 外れ・確定の映像の最中に時間切れの画面が割り込まない/確定の映像の間の通常球の着地を静かにする
    const {man,model}=lcd.jp,sec=n=>man.scenes[n]?man.scenes[n].frames/man.fps:0;
    Object.defineProperty(app.rules,'FailFilmSeconds',{value:Math.max(sec('fail_first'),sec('fail_chain')),enumerable:false,configurable:true,writable:true});
    Object.defineProperty(app.rules,'ChainConfirmSeconds',{value:sec('chain_confirm'),enumerable:false,configurable:true,writable:true});
    Object.defineProperty(app.rules,'quietGate',{value:()=>!!(model.active&&model.name==='chain_confirm'),enumerable:false,configurable:true,writable:true});
  }
  if(lcd?.jp) Object.defineProperty(app.rules,'launchGate',{value:()=>lcd.jp.blocksChallengeLaunch,enumerable:false,configurable:true,writable:true});   // 最初のJPの導入・配当の映像の間は、勝負球の発射を待たせる(押しは保持され、解けた瞬間に出る)。映像を飛ばさず最後まで見せる
  if(lcd?.production) await (await import('./lcd_surface/temp_cards_20261029.mjs')).attachTempCards(lcd);   // 仮カード(スタート/まだまだ/計数中/重複/耐えた)の本番演出
  if(lcd?.production) await (await import('./lcd_surface/attract_surface_20261029.mjs')).attachAttractSurface(lcd,{getState:()=>({phase:ctrl.game.phase,howto:!!ctrl.howto})});
  const finalResultImageFactory=fullPanelPrevious?async o=>(await import('./lcd_surface/final_result_gpu_image_1029.mjs')).createFinalResultGpuImage({...o,actualWarm:q.get('finalwarm')!=='0',renderer:hr.renderer,THREE:await import('../web/vendor/three/three.module.js')}):null;
  if(lcd?.production) await (await import('./lcd_surface/final_result_surface_20261029.mjs')).attachFinalResultSurface(lcd,{controller:ctrl,finalResultImageFactory,fullPanelPrevious});
  if(lcd?.production) (await import('./lcd_surface/chain_connect_20261029.mjs')).attachChainConnect(lcd,{controller:ctrl});
  const choiceImageFactory = M3 && q.get('choicegpu') !== '0' ? async o => (await import('./lcd_surface/choice_gpu_image_1029.mjs')).createChoiceGpuImage({...o, renderer:hr.renderer, THREE:await import('../web/vendor/three/three.module.js')}) : null;
  if(lcd?.production) await (await import('./lcd_surface/choice_surface_v20_20261029.mjs')).attachChoiceSurface(lcd,{choiceImageFactory,getState:()=>({phase:ctrl.game.phase}),controller:ctrl,canvas:document.getElementById('c'),onInput:app.onInput,unlock:()=>app.audio.unlock()});
  if(lcd?.production && ctrl.game.rules.RuleVariant === 'H_20261029') await (await import('./lcd_surface/rules_h_20261029.mjs')).attachRulesH(lcd, { controller: ctrl, style: q.get('meter') ?? undefined, hint: q.get('hint') === '0' ? null : Object.fromEntries([...q].filter(([k]) => k.startsWith('hint_')).map(([k, v]) => [k.slice(5), Number.isNaN(+v) ? v : +v])) });   // 新ルールH(連打メーター・ボタンで止めるルーレット)の液晶。?rules=h のときだけ
  if(M3 && lcd?.production && q.get('cabinetlights')!=='off') await (await import('../../effects/cabinet_light_script/cabinet_light_script_20261029.mjs')).attachCabinetLightScript(lcd,{getLamps:()=>ctrl.game.lamps,getState:()=>{const g=ctrl.game,p=g.phase;lightState.secondsLeft=g.secondsLeft;lightState.playing=p==='Ready'||p==='Flight'||p==='Effect'||p==='Meter'||p==='Roulette';return lightState;}});
  if(lcd?.production) (await import('./lcd_surface/timer_display_20261029.mjs')).attachTimerDisplay(lcd,{getState:()=>({phase:ctrl.game.phase,secondsLeft:ctrl.game.secondsLeft,offerLeft:ctrl.game.offerLeft,howto:!!ctrl.howto})});
  if(lcd?.production) await (await import('./lcd_surface/timeup_surface_20261029.mjs')).attachTimeupSurface(lcd,{controller:ctrl,canvas:document.getElementById('c'),onInput:app.onInput,unlock:()=>app.audio.unlock()});
  if(lcd?.timeupSurface)document.getElementById('g-credit-panel')?.setAttribute('data-lcd','1');   // 液晶が追加画面を出すのでHTMLの箱は隠す
  // 新しいJP尺の音も起動時に作り、着地のフレームで長い音声バッファを生成しない。
  if(lcd?.jp && r2Audio){
    const {winPlan,createWinSound}=await import('../../audio/runtime/win_sound.mjs');const engine=r2Audio.engine;
    const durations=new Set([...Object.values(app.rules.FirstJackpotEffectSeconds??{}).flat(),...(app.rules.JackpotEffectSeconds??[])]);   // 継続成功の通し尺も起動時に作る
    for(const duration of durations){const plan=winPlan({id:'jp',data:{duration}},engine.winTiming),key='jp:'+plan.duration;if(!engine.winCache.has(key))engine.winCache.set(key,createWinSound(engine.ctx,engine.buffers,engine.winTiming,plan));}
  }
  if (lcd && M3 && !q.has('m3lcdfit')) q.set('m3lcdfit', 'panel');
  if (lcd) window.__lcdSurface = lcd;
  if (lcd?.production && r2Audio && q.get('afterjp') !== '0') { try { window.__afterJp = await (await import('../../audio/runtime/after_jp_sound_1029.mjs')).installAfterJpSound(r2Audio.engine, { lcd, controller: ctrl }); } catch (error) { console.error('[after-jp]', error); } }   // JP後(継続・確定・時間切れ・最終リザルト)の音。?afterjp=0 で無効
  fxApi = await connectPlayEffects({ hr, bus: effects, getSnapshot: () => effects.contextSnapshot(), lightingSources: pack.lighting.sources, rules: app.rules, lcdGain: Number(q.get('lcdgain') ?? 1), tray: q.has('notray') ? null : { ...runtime, get jpHold(){return runtime.jpHold;}, displayWallet: () => presenter.displayWallet() }, lcd, ownedFrontEarlyClip: M3, ownedBackEarlyClip: M3, ownedFrameSnapshot: M3 && !q.has('pack') && !q.has('fxjs') });
  app.overlay.fx.style.display = 'none';   // 旧ダミーの帯・カットイン・ルーレット・JPは液晶演出に置き換え
  if (!q.has('oldui')) app.overlay.setBare(true);   // 旧UI(上の帯・持ち玉・口の番号・キー表示・待機/時間切れ/結果の画面)は出さない。液晶と7セグが正式。?oldui で旧表示(デバッグ用)
}
let m3 = null;
if (M3) { m3 = await (await import('./m3/m3_cabinet.mjs')).installM3Cabinet({ hr, fxApi, presenter, pa, q, getLamps: () => ctrl.game.lamps, getPrize: () => runtime.getPrize(), prizeNames: app.rules?.PrizeNames, ownedInitialEnvironment: M3 && !q.has('pack') ? hr.env : null }); pack.info.cabinet = { name: 'm3', ...m3.info }; window.__m3 = m3; }
// 固定筐体の基底＋低解像度照明を合成。液晶は直接読み、球の輪郭は等倍/MSAA4。?prebake=0 で従来経路。
if (M3 && fxApi && !q.has('pack') && !q.has('fxjs') && q.get('prebake') !== '0') {
  try { window.__prebakeRelight = await (await import('./m3/prebake_relight_1029.mjs')).installPrebakeRelight(hr, { m3, getPlate: () => fxApi.plate }); }
  catch (error) { window.__prebakeError = error.message; console.warn('[prebake fallback]', error); }
}
// 初回だけ重い処理(画像デコード・GPUアップロード・シェーダ)を遊技の前に済ませる。?prewarm=0 で無効
if (q.get('prewarm') !== '0') window.__prewarm = await prewarm({ hr, pack, fxApi, rules: app.rules });
window.__r2Audio = r2Audio;
const stats = runtime.stats;
const launchMotion = M3 && q.get('launchanim') === '1' && !q.has('nolauncher') && !pa.isWorkerProxy ? (await import('./launcher_motion_1030.mjs')).createLauncherMotion({ getShots: () => pa.shots }) : null;   // 射出の見え方（球を落とす・爪が開閉・待ち球）。見た目だけ。?launchanim=0 で従来
const launcherArgs = M3 ? [(await import('./m3/launcher_body_m3.mjs')).createLauncherBody, { now: () => m3Clock, getLight: () => m3.state.k4, getLamp: () => launchLamp?.view, ...(launchMotion ? { getPose: () => launchMotion.pose } : {}) }] : [createLauncherBody, {}];
const launcherBody = q.has('nolauncher') ? null : launcherArgs[0]({ stage: document.getElementById('stage'), canvas: document.getElementById('c'), camera: hr.camera, xRange: pa.board.launcher.xRange.map(x => pa.transforms.point('stage2', [x, pa.muzzle[1], pa.muzzle[2]])[0]) }, launcherArgs[1]);   // 射出器の本体(レール・筒)。見た目だけ
function draw() {
  cabinet.tick(performance.now()); ledStrip.update(performance.now());
  const s = pa.snapshot(); setAssemblyBalls(launchMotion ? launchMotion.update(s).snapshot : s); if (fxApi) fxApi.ballLights(s);   // 勝負中の玉をピンポイントで照らす(演出側)
  const lf = pack.lighting.frame(presenter.lightingInputs(), pa.tick); if (fxApi) { try { fxApi.applyLights(lf); } catch (e) { if (!window.__lightError) { window.__lightError = e.message; console.error('[lights]', e); } } }   // 演出の光(花びら・縁)が最終の書き手。範囲外などの異常は、その場の光だけ飛ばして遊技を止めない
  hr.setLightingFrame(lf);
  m3?.update(m3Clock); launchLamp?.update();
  hr.render(); launcherBody?.update(s.shuttle); app.overlay.render(presenter.view());
  if (fxApi && !app.overlay.bare) app.overlay.screen.style.display = ctrl.howto ? 'none' : '';   // ルール説明(howto)中は待機画面のDOMを消して、液晶の説明を見せる
  return s;
}
function frame(dt, render = true) {
  const t0 = performance.now(), timing = runtime.advance(dt);
  if (fxApi) fxApi.frame(dt);
  m3Clock += dt;
  if (ctrl.phase === 'Fault') r2Audio?.engine.stopAll();
  let s = null; if (render) s = draw();
  window.__play.lastTiming = { ...timing, totalMs: performance.now() - t0 };
  return s;
}
let last = null, frames = 0, acc = 0, paused = false;
const hud = document.getElementById('hud'); if (q.has('debug')) hud.style.display = 'block';
const debugConfig = document.getElementById('config-debug');
debugConfig.textContent = `${config.name}\n釘 ${pa.board.layout.pins.length}本 / σx ${config.jitter.x_mm} mm / σvx ${config.jitter.vx_pct}% / σvy ${config.jitter.vy_pct}%`;
debugConfig.hidden = !q.has('debug');
const loop = (now) => {
  if (last === null) last = now;
  const elapsed = (now - last) / 1000; last = now;
  if (!paused && !document.hidden) {
    // 追い付けない時間は規則・物理・光を一緒に停止する。最大24step。
    if (elapsed > .05) app.log.write('clock_pause', { tick: pa.tick, droppedSeconds: elapsed - .05 });
    const s = frame(Math.min(.05, elapsed)); acc += window.__play.lastTiming.totalMs; frames++;
    if (frames % 30 === 0) { hud.textContent = `CPU ${(acc / 30).toFixed(2)} ms  balls ${s.count}\n${JSON.stringify(s.ledger)}`; acc = 0; }
  }
  requestAnimationFrame(loop);
};
window.__play = { app, pa, hr, stats, fxApi, runtime, cabinet, awardToTray: runtime.awardToTray, releaseAwards: runtime.releaseAwards, setAwardHold: runtime.setAwardHold, trayStatus: runtime.trayStatus, config: pa.playConfig, pack: pack.info, frame, draw, lastTiming: null,
  tick: (seconds, dt = 1 / 60) => { let left = seconds; while (left > 1e-10) { frame(Math.min(left, dt), false); left -= dt; } return draw(); },
  pause: (value) => { paused = value; last = null; },
};
document.addEventListener('visibilitychange', () => { last = null; app.log.write('visibility', { tick: pa.tick, hidden: document.hidden }); });
// 音: ブラウザは最初の操作まで鳴らせない。ボタンは見せず、最初のキー/クリックで有効にして読み込む(?oldui のときだけボタンも見せる)
let audioStarted = false;
async function startAudio() {
  if (audioStarted) return; audioStarted = true;
  if (r2Audio) { await r2Audio.engine.unlock(); document.getElementById('start')?.remove(); return; }
  await app.audio.unlock();
  const files = JSON.parse(await readText(new URL('./audio_files.json', import.meta.url)));
  await app.audio.preload({ files, music: false });
  document.getElementById('start')?.remove();
}
window.addEventListener('keydown', startAudio, { once: true }); window.addEventListener('pointerdown', startAudio, { once: true });
document.getElementById('start').addEventListener('click', startAudio);
if (q.has('oldui')) document.body.classList.add('oldui');
const fsButton = document.getElementById('fullscreen');
fsButton.addEventListener('click', async () => { await document.documentElement.requestFullscreen(); });
document.addEventListener('fullscreenchange', () => { fsButton.hidden = !!document.fullscreenElement; });
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyF') document.documentElement.requestFullscreen();
  if (e.code === 'KeyD') { debugConfig.hidden = !debugConfig.hidden; hud.style.display = debugConfig.hidden ? 'none' : 'block'; }
});
window.__ready = true; draw(); document.getElementById('loading')?.remove();
if (!q.has('manual')) requestAnimationFrame(loop);
}
main().catch((error) => {
  console.error(error);
  const box = document.getElementById('config-error');
  box.textContent = `起動できませんでした\n${error.message}`; box.hidden = false;
  window.__startupError = error.message;
});
