// R3-G：m3 の筐体（?cabinet=m3）で通しを遊んで撮る。1/60 秒ずつゲームの時計を進め、1 コマずつ撮る（R3-V の playthrough.mjs と同じやり方）。
// 起動 → 説明（飛ばさない）→ 連打 → 狙い撃ち → JP チャンス（6 灯。届かなければ capture の fixture で 6 灯に）→ JP → その後も狙い撃ち（重複ルーレット）→ 時間切れ → 結果。
//   node play_m3.mjs <out_dir> [seed=43] [query]
//   環境：MODE=video（既定、master_1440.mp4 と audio_events.json）／MODE=stills（動画なし、印のときだけ PNG）。MAXSEC、STILLS='秒,秒,…'
// python3 tools/gpu_run.py cabinet r3g-rec 3 -- systemd-run --user --scope ... -- flock -x -w 1800 work/game_demo/perf/lowend_r2/tmp/browser.lock node work/game_demo/play/m3/play_m3.mjs ...
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork, spawn } from 'node:child_process';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const out = resolve(process.argv[2] ?? 'work/game_demo/play/out/m3_play'); const seed = process.argv[3] ?? '43'; const extra = process.argv[4] ?? 'cabinet=m3';
const MODE = process.env.MODE ?? 'video', MAXSEC = +(process.env.MAXSEC ?? 240), FPS = 60;
const STILLS = (process.env.STILLS ?? '').split(',').filter(Boolean).map(Number);
const matrix = JSON.parse(readFileSync(resolve(process.env.MATRIX ?? 'work/game_tuning/lab/results/local_pool_1200/matrix_new.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
process.on('exit', () => server.kill());
let ff = null;
if (MODE === 'video') {
  ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), join(out, 'master_1440_noaudio.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
}
let browser; const errors = [];
try {
  const { port } = await new Promise((r, j) => { server.once('message', r); server.once('error', j); });
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true,
    args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-webgl-draft-extensions'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2560 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html?seed=${seed}&nolog&voice=off&${extra}`);
  await page.waitForFunction(() => window.__ready || window.__startupError, null, { timeout: 180000 });
  const se = await page.evaluate(() => window.__startupError ?? null); if (se) throw new Error('startup: ' + se);
  await page.addStyleTag({ content: '#serial-panel,#audio-panel,#fullscreen{display:none!important}' });
  await page.click('#start'); await page.waitForFunction(() => !document.getElementById('start'), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__play.pause(true);
    window.__lcdSurface?.setManual(true);   // ?lcd=video：液晶の映像もゲームの時計で 1 コマずつ（lcd_surface）
    const q = window.__cap = { clock: 0, audioEvents: [] };
    const engine = window.__r2Audio?.engine;
    if (engine) {
      engine.handleEvent = event => q.audioEvents.push({ t: q.clock, type: 'event', event });
      engine.contact = contact => q.audioEvents.push({ t: q.clock, type: 'contact', contact });   // contact.t は物理の時計（球の物理を作った時が 0）で録画の時計と原点が違う（約 26 秒前にずれた）。録画の時計に揃える
      engine.payout = count => q.audioEvents.push({ t: q.clock, type: 'payout', count });
      engine.flush = () => {};
    }
  });
  await page.evaluate(({ matrix, seed }) => {
    const P = window.__play, c = P.app.ctrl, presenter = P.app.presenter, C = window.__cap;
    const Q = window.__session = { log: [], done: false, resultAt: null, jpAt: null, marks: [], fixture: false };
    const now = () => C.clock;
    const mark = (type, d = {}) => Q.log.push({ t: +now().toFixed(3), type, ...d });
    presenter.on((type, detail) => {
      if (type === 'receipt') {
        mark('receipt', { kind: detail.kind, lane: detail.lane, award: detail.award, jackpot: detail.jackpot, after: detail.after });
        if (detail.jackpot && Q.jpAt === null) { Q.jpAt = now(); mark('jp_win', { award: detail.award }); }
      }
      if (type === 'phase') mark('phase', { phase: detail });
    });
    window.__effects.on('*', e => { if (!['launch', 'ambient'].includes(e.id)) mark('fx', { id: e.id }); });
    c.onAction(a => mark('input', { action: a, aim: +c.aim.toFixed(2), dir: c.aimDir, lamps: [...c.game.lamps] }));
    const aims = matrix.aims, dirs = matrix.dirs, P3 = matrix.probability;
    const idx = a => Math.max(0, Math.min(aims.length - 1, Math.round((a + 1) / 2 * (aims.length - 1))));
    const score = (aim, dir, target) => { const p = P3[dirs.indexOf(dir)][idx(aim)]; return target.reduce((s, n) => s + p[n - 1], 0); };
    const best = (target) => Math.max(...aims.map((a, i) => Math.max(...dirs.map((d, di) => target.reduce((s, n) => s + P3[di][i][n - 1], 0)))));
    let st = (+seed | 0) || 1; const rnd = () => { st = st + 0x6D2B79F5 | 0; let x = Math.imul(st ^ st >>> 15, 1 | st); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const rand = (a, b) => a + rnd() * (b - a);
    let next = 0, phaseT0 = null, lastPhase = null, added = false, confirmAt = null;
    Q.drive = () => {
      const t = now(), g = c.game;
      if (confirmAt !== null && t >= confirmAt) { confirmAt = null; c.dispatch('confirmFinish'); }
      if (g.phase !== lastPhase) { lastPhase = g.phase; mark('phase_seen', { phase: g.phase, lamps: [...g.lamps] }); }
      if (g.phase === 'Attract') { if (t > 1.2 && !c.howto && !Q.started) { Q.started = true; c.dispatch('start'); } return; }
      if (g.phase === 'Continue') { if (!added && g.canAdd) { added = true; c.dispatch('add'); } else if (t > next) { c.dispatch('finish'); if (c.confirmFinish) confirmAt = t + 0.1; next = t + 1; } return; }
      if (!(g.overlap ? g.canAim : g.canFire) || c.confirmFinish || t < next) return;
      if (phaseT0 === null) phaseT0 = t;
      const tp = t - phaseT0, lit = [...g.lamps], unlit = [1, 2, 3, 4, 5, 6, 7].filter(n => !lit.includes(n));
      // JP チャンスの fixture：狙い撃ちの区間で 6 灯に届かなければ（R3-V の capture と同じ：灯を 6 にして武装、最後の球と JP の抽選は実ゲーム）
      if (!Q.fixture && Q.jpAt === null && tp > 34 && lit.length < 6 && g.phase === 'Ready' && g.shots.length === 0 && !P.pa.pendingPhysical()) {
        const cand = [1, 2, 3, 4, 5, 6, 7].sort((a, b) => best([b]) - best([a]))[0];
        g._lamps = new Set([1, 2, 3, 4, 5, 6, 7].filter(n => n !== cand)); g.armed = true; Q.fixture = cand; mark('fixture_six_lamps', { unlit: cand }); next = t + 0.8; return;
      }
      if (tp < 12) { c.dispatch('fire'); next = t + (g.overlap ? rand(.62, .8) : rand(.22, .5)); return; }   // 連打
      const target = unlit.length ? unlit : [1, 2, 3, 4, 5, 6, 7];
      const sc = score(c.aim, c.aimDir, target), bs = best(target), six = lit.length >= 6;
      const th = six ? .97 : .8;
      if (sc >= th * bs || t > next + (six ? 9 : 3.5)) { c.dispatch('fire'); mark('aim_fire', { aim: +c.aim.toFixed(2), score: +sc.toFixed(2), best: +bs.toFixed(2) }); next = t + (six ? 1.2 : rand(.8, 1.5)); }
      if (g.phase === 'Result' && Q.resultAt === null) Q.resultAt = t;
    };
    Q.tick = () => { const g = c.game; if (g.phase === 'Result' && Q.resultAt === null) { Q.resultAt = now(); mark('result', { balls: g.wallet, prize: g.prize, bestAward: g.bestAward }); } if (Q.resultAt !== null && now() > Q.resultAt + 9) Q.done = true; };
  }, { matrix, seed });
  const dt = 1 / FPS; let frames = 0; const t0 = Date.now(); let si = 0;
  const stillsDir = join(out, 'stills'); mkdirSync(stillsDir, { recursive: true });
  while (frames < MAXSEC * FPS) {
    const r = await page.evaluate(async dt => { await window.__lcdSurface?.prepare(dt); const Q = window.__session, C = window.__cap; Q.drive(); window.__play.frame(dt, true); C.clock += dt; Q.tick(); return { done: Q.done, t: C.clock }; }, dt);
    if (ff) { const buf = await page.screenshot({ type: 'jpeg', quality: 93 }); if (!ff.stdin.write(buf)) await new Promise(res => ff.stdin.once('drain', res)); }
    while (si < STILLS.length && r.t >= STILLS[si]) { await page.screenshot({ path: join(stillsDir, `t${String(STILLS[si]).padStart(5, '0')}.png`) }); console.log('still', STILLS[si], JSON.stringify(await page.evaluate(() => { const s = window.__m3?.state; return s ? { k: s.k, k4: +s.k4.toFixed(2), wash: s.wash, pocket: s.pocket, act: s.lastF?.active } : null; }))); si++; }
    frames++;
    if (r.done) break;
    if (frames % 600 === 0) console.log('frames', frames, 'sim', r.t.toFixed(0), 'wall', ((Date.now() - t0) / 1000).toFixed(0));
  }
  const res = await page.evaluate(() => ({ log: window.__session.log, audioEvents: window.__cap.audioEvents, final: { phase: window.__play.app.ctrl.game.phase, balls: window.__play.app.ctrl.game.wallet, prize: window.__play.app.ctrl.game.prize }, pack: window.__play.pack?.cabinet ?? null }));
  if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
  writeFileSync(join(out, 'session.json'), JSON.stringify({ seed, extra, frames, fps: FPS, errors, final: res.final, pack: res.pack, log: res.log }, null, 1));
  writeFileSync(join(out, 'audio_events.json'), JSON.stringify({ frames, fps: FPS, events: res.audioEvents }));
  console.log('done frames', frames, JSON.stringify(res.final), 'errors', errors.length, errors.slice(0, 5));
} finally { await browser?.close(); server.kill(); }
