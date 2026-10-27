// R3-G：確認の動画（2 球が同時に同じ穴へ入る場面と、穴のランプの光り方）。?cabinet=m3、1/60 秒ずつ進めて撮る。音なし。
//   node jam_clip.mjs <out.mp4> [seed=43]
// 2 球の場面は試験の仕掛け：撃った 2 球を、口の上 35mm の左右に並べ直して同時に落とす（ゲームの受付はふつうに数える）。
//   前＝詰まりの突き（board3 の _jamKick）を止めて 3.5 秒 → 突きを入れる。今＝最初から突きあり。
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork, spawn } from 'node:child_process';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const out = resolve(process.argv[2]); const seed = process.argv[3] ?? '43';
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', 'pipe:0', '-vf', 'scale=540:960:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '60', out], { stdio: ['pipe', 'inherit', 'inherit'] });
let browser;
try {
  const { port } = await new Promise((r, j) => { server.once('message', r); server.once('error', j); });
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2560 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html?seed=${seed}&nolog&voice=off&howto=0&cabinet=m3`);
  await page.waitForFunction(() => window.__ready || window.__startupError, null, { timeout: 180000 });
  await page.addStyleTag({ content: '#serial-panel,#audio-panel,#fullscreen{display:none!important} #jamlab{position:fixed;left:40px;right:40px;top:40px;padding:18px 26px;font:bold 54px sans-serif;color:#fff;background:rgba(0,0,0,.72);border-radius:14px;z-index:99;white-space:pre-line}' });
  await page.click('#start'); await page.waitForFunction(() => !document.getElementById('start'), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__play.pause(true);
    const lab = document.createElement('div'); lab.id = 'jamlab'; document.body.appendChild(lab);
    const P = window.__play, c = P.app.ctrl, B = P.pa.board, Q = window.__J = { t: 0, T0: null, step: 0, done: false, log: [] };
    const say = (s) => { lab.textContent = s; lab.style.display = s ? '' : 'none'; };
    say('');
    const cupX = (n) => B.cups.find(q => q.n === n).x, S = 10;
    const newest = (k) => [...B.balls.values()].sort((a, b) => b.born - a.born).slice(0, k);
    const place = (n) => { const bs = newest(2); if (bs.length < 2) return false; const x = cupX(n), y = B.mouthY + 0.035;
      bs.forEach((b, i) => { const z = b.body.translation().z; b.body.setTranslation({ x: (x + (i ? 0.0065 : -0.0065)) * S, y: y * S, z }, true); b.body.setLinvel({ x: 0, y: -0.5 * S, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }); return true; };
    var kickAt = -9; const origDrain = B.drain.bind(B); B.drain = () => { const e = origDrain(); for (const x of e) { if (x.type === 'jam_kick' || x.type === 'cup') Q.log.push([+Q.t.toFixed(2), x.type, x.cup]); if (x.type === 'jam_kick') kickAt = Q.t; } return e; };
    // 穴の中は穴の段の前の部品に隠れて見えないので、物理の断面を右下に拡大して描く（×9、穴 3、壁・漏斗・喉と球、突きの瞬間は赤）
    const cv = document.createElement('canvas'); cv.width = 560; cv.height = 620; cv.style.cssText = 'position:fixed;left:440px;top:1280px;z-index:98;border-radius:12px;background:rgba(6,10,20,.88);border:3px solid #ff3d8b';
    document.body.appendChild(cv); const cx = cv.getContext('2d');
    const walls = B.model.phys.prisms.filter(p => /^COL_CUP_0[34]_|^COL_CUP_02_.*_R|^COL_LIFE_04|^COL_GUARD_04/.test(p.id));
    Q.inset = () => {
      const n = 3, x0 = cupX(n), y0 = B.mouthY, K = 9000, ox = 280, oy = 150, X = (x) => ox + (x - x0) * K, Y = (y) => oy - (y - y0) * K;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.fillStyle = '#fff'; cx.font = 'bold 30px sans-serif'; cx.fillText('穴 3 の中（物理の断面 ×9）', 18, 40);
      cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.setLineDash([8, 8]); cx.lineWidth = 2; cx.beginPath(); cx.moveTo(0, Y(y0)); cx.lineTo(cv.width, Y(y0)); cx.stroke(); cx.setLineDash([]);
      cx.fillStyle = 'rgba(255,255,255,.55)'; cx.font = '22px sans-serif'; cx.fillText('口の線', 8, Y(y0) - 8); cx.fillText('受付のセンサー', 8, Y(B.sensorY) - 8);
      cx.strokeStyle = 'rgba(80,220,255,.6)'; cx.beginPath(); cx.moveTo(0, Y(B.sensorY)); cx.lineTo(cv.width, Y(B.sensorY)); cx.stroke();
      cx.strokeStyle = '#c9d3e0'; cx.lineCap = 'round';
      for (const w of walls) { cx.lineWidth = w.r * 2 * K; cx.beginPath(); cx.moveTo(X(w.A[0]), Y(w.A[1])); cx.lineTo(X(w.B[0]), Y(w.B[1])); cx.stroke(); }
      const kicked = Q.t - kickAt < 0.25;
      for (const b of B.balls.values()) { const t = b.body.translation(), x = t.x / S, y = t.y / S; if (Math.abs(x - x0) > 0.032 || y > y0 + 0.016 || y < B.sensorY - 0.03) continue;
        cx.beginPath(); cx.arc(X(x), Y(y), 0.006 * K, 0, Math.PI * 2); cx.fillStyle = kicked && (b.jam ?? 0) === 0 ? '#ff4a4a' : '#e8edf5'; cx.fill(); cx.strokeStyle = '#7d8796'; cx.lineWidth = 3; cx.stroke(); }
      if (kicked) { cx.fillStyle = '#ff6a6a'; cx.font = 'bold 34px sans-serif'; cx.fillText('突き！', 400, 600); }
    };
    let pend = null, nextFire = 0;
    Q.drive = () => {
      const t = Q.t, g = c.game;
      if (g.phase === 'Attract') { if (t > 1.2 && !Q.started) { Q.started = true; c.dispatch('start'); } return; }
      if (Q.T0 === null) { if (g.canFire && t > 3) Q.T0 = t + 1.0; return; }
      const r = t - Q.T0;
      const fire2 = (at, cup) => { if (r >= at && Q.step === at) { if (g.canFire) { c.dispatch('fire'); Q.step = at + 0.001; } } if (Q.step === at + 0.001 && r >= at + 0.65 && g.canFire) { c.dispatch('fire'); Q.step = at + 0.002; } if (Q.step === at + 0.002 && r >= at + 0.75 && place(cup)) Q.step = at + 0.003; };
      if (r < 0) return;
      if (Q.step === 0) { B.allowJamKick = false; say('前：2 球が同時に同じ穴（3 番）へ\n→ 漏斗の角で止まる（突きなし）'); }
      fire2(0, 3);
      if (Q.step === 0.003 && r > 5.0) { B.allowJamKick = true; say('今：詰まりを検出して小さく突く\n（穴の部品のソレノイド）'); Q.step = 1; }
      if (Q.step === 1 && r > 8.5) { say('今：2 球が同時に同じ穴（3 番）へ\n→ 0.2 秒で検出・突いて通す'); Q.step = 9; }
      if (Q.step >= 9 && Q.step < 10) fire2(9, 3);
      if (Q.step === 9.003 && r > 13.5) { cv.style.display = 'none'; say('穴のランプ：入った瞬間は白く強く→穴の色\n灯った穴は灯の数の色で濃く'); Q.step = 20; nextFire = t; }
      if (Q.step === 20) { if (t >= nextFire && g.canFire) { c.dispatch('fire'); nextFire = t + 0.65; } if (r > 30) { Q.done = true; } }
    };
  });
  let frames = 0;
  while (frames < 60 * 70) {
    const r = await page.evaluate(() => { const Q = window.__J; Q.drive(); window.__play.frame(1 / 60, true); Q.inset(); Q.t += 1 / 60; return { done: Q.done, rec: Q.T0 !== null && Q.t > Q.T0 - 0.5 }; });
    if (r.rec) { const buf = await page.screenshot({ type: 'jpeg', quality: 92 }); if (!ff.stdin.write(buf)) await new Promise(res => ff.stdin.once('drain', res)); }
    frames++; if (r.done) break;
  }
  console.log(JSON.stringify(await page.evaluate(() => ({ log: window.__J.log, lamps: window.__play.app.ctrl.game.lamps, phase: window.__play.app.ctrl.game.phase }))), 'errors', errors);
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
} finally { await browser?.close(); server.kill(); }
