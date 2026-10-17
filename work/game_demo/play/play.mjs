// 通しプレイ: 規則+480Hz Rapier+光層+DOM UI。
// ?seed=N &manual &nolog &quiet &debug &pack=<manifest URLまたはディレクトリ>
import RAPIER from '../physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { PhysicsAdapter, RAPID_SUPPLY } from '../physics/adapter.mjs';
import { createMedalApp } from '../ui/demo_host.mjs';
import { HybridRenderer } from '../web/src/hybrid_renderer.mjs';
import { Gen } from '../web/src/dummy.mjs';
import { connectLayerPack, connectAssemblyBalls } from './render_bridge.mjs';
import { createRuntime } from './runtime.mjs';
import { EffectsBus } from './effects_bus.mjs';
import { loadPlayConfig, loadPlayRules } from './config.mjs';
import { prewarm } from './prewarm.mjs';
import { createLauncherBody } from './launcher_body.mjs';
import { CabinetSerial } from './cabinet_serial.mjs';

async function main() {
const q = new URLSearchParams(location.search);
async function readText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); }
const DEFAULT_PLAY_CONFIG = 'work/game_tuning/proto/config.json', DEFAULT_PACK = '/assembly/sol61_v36_pack/stage2c/manifest.json';   // 引数なしで開いた時の本番構成(?config=&pack= で上書き、空文字で無効)
const config = await loadPlayConfig(q.has('config') ? q.get('config') : DEFAULT_PLAY_CONFIG, readText);
const seed = q.has('seed') ? Number(q.get('seed')) : config.seed ?? 1;
const playRules = await loadPlayRules(config.rules, readText);
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const pa = await PhysicsAdapter.create(RAPIER, {
  readText: (p) => readText(new URL(p, CAB)), importModule: (p) => import(new URL(p, CAB).href), seed, stageDir: config.stageDir, jitter: config.jitter,
  ...(playRules.MaxInFlight > 1 ? RAPID_SUPPLY : {}),   // 同時発射なら玉の補給も連射に合わせる
  boardTimeScale: Number(q.get('pscale') ?? 0.35),   // 盤上の玉の進み(1=実時間)。落下を目で追える速さ(平均0.72秒→約2秒)。?pscale=1 で実時間
});
pa.playConfig = { ...config, seed, pinCount: pa.board.layout.pins.length };
const hr = new HybridRenderer({ canvas: document.getElementById('c'), maxBalls: 700, lutUrl: new URL('../web/assets/lut/pbrneutral_lg2_57_lin', import.meta.url).href });
await hr.init();
hr.setBallBounce(Number(q.get('ballbounce') ?? 0));   // 玉の下半球の照り返し（0=従来。0.4〜0.6で銀色に見える）
const setAssemblyBalls = connectAssemblyBalls(hr, pa.transforms);
const pack = await connectLayerPack(hr, q.has('pack') ? q.get('pack') : DEFAULT_PACK, { dummyEntries: Gen.makeLayerManifest(12, { seed: 1 }) });
const app = await createMedalApp(document.getElementById('stage'), {
  hooks: { launchBall(shot, aim, dir) { pa.setAim(aim, dir); pa.launch(shot.id); }, cancelFlights() { pa.reset(); }, canReset() { return app.presenter.count.done; } },
  rulesUrl: config.rules, seed, quiet: q.has('quiet'), music: false, log: !q.has('nolog'), manual: true,
});
const { ctrl, presenter } = app, effects = new EffectsBus();
const cabinet = new CabinetSerial({ serial: navigator.serial, ctrl, button: document.getElementById('serial-connect'), status: document.getElementById('serial-status') });
await cabinet.init();
const howtoDur = await fetch(new URL('../../effects/spec/events.json', import.meta.url)).then(r => r.json()).then(j => j.events.find(e => e.id === 'howto')?.dur).catch(() => null);   // 説明の長さは演出の仕様(events.json)に従う
ctrl.howtoSeconds = Number(q.get('howto') ?? howtoDur ?? 5.2);   // 開始前のルール説明(時計に含めない・もう一度押すと飛ばせる)。?howto=0 で無効
window.__effects = effects;
if (q.get('effects_log') === '1') effects.on('*', e => console.log('[effects]', e));
const runtime = createRuntime({ ctrl, presenter, pa, log: app.log, effects });
// 演出側(work/effects)の液晶・光の接続。?nofx で無効。演出側の1ファイルだけを読む。
let fxApi = null;
if (!q.has('nofx')) {
  const { connectPlayEffects } = await import('../../effects/runtime/play_fx.mjs');
  fxApi = await connectPlayEffects({ hr, bus: effects, getSnapshot: () => effects.snapshot(), lightingSources: pack.lighting.sources, rules: app.rules, lcdGain: Number(q.get('lcdgain') ?? 1), tray: q.has('notray') ? null : { ...runtime, displayWallet: () => presenter.displayWallet() } });
  app.overlay.fx.style.display = 'none';   // 旧ダミーの帯・カットイン・ルーレット・JPは液晶演出に置き換え
  if (!q.has('oldui')) app.overlay.setBare(true);   // 旧UI(上の帯・持ち玉・口の番号・キー表示・待機/時間切れ/結果の画面)は出さない。液晶と7セグが正式。?oldui で旧表示(デバッグ用)
}
// 初回だけ重い処理(画像デコード・GPUアップロード・シェーダ)を遊技の前に済ませる。?prewarm=0 で無効
if (q.get('prewarm') !== '0') window.__prewarm = await prewarm({ hr, pack, fxApi });
const stats = runtime.stats;
const launcherBody = q.has('nolauncher') ? null : createLauncherBody({ stage: document.getElementById('stage'), canvas: document.getElementById('c'), camera: hr.camera, xRange: pa.board.launcher.xRange.map(x => pa.transforms.point('stage2', [x, pa.muzzle[1], pa.muzzle[2]])[0]) });   // 射出器の本体(レール・筒)。見た目だけ
function draw() {
  cabinet.tick(performance.now());
  const s = pa.snapshot(); setAssemblyBalls(s); if (fxApi) fxApi.ballLights(s);   // 勝負中の玉をピンポイントで照らす(演出側)
  const lf = pack.lighting.frame(presenter.lightingInputs(), pa.tick); if (fxApi) { try { fxApi.applyLights(lf); } catch (e) { if (!window.__lightError) { window.__lightError = e.message; console.error('[lights]', e); } } }   // 演出の光(花びら・縁)が最終の書き手。範囲外などの異常は、その場の光だけ飛ばして遊技を止めない
  hr.setLightingFrame(lf);
  hr.render(); launcherBody?.update(s.shuttle); app.overlay.render(presenter.view());
  if (fxApi && !app.overlay.bare) app.overlay.screen.style.display = ctrl.howto ? 'none' : '';   // ルール説明(howto)中は待機画面のDOMを消して、液晶の説明を見せる
  return s;
}
function frame(dt, render = true) {
  const t0 = performance.now(), timing = runtime.advance(dt);
  if (fxApi) fxApi.frame(dt);
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
