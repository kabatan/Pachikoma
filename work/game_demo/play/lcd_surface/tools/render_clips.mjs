// 仮の液晶の映像を、今の液晶の場面（work/effects/lcd、harness.html）から 1/60 秒ずつ書き出す（VP9 の webm）。
// 液晶の正式な映像は JP 演出の担当が作る。これは「動画を貼る面」の確認用の差し替え素材。
//   node render_clips.mjs <出力フォルダ> [id,id,...]   （http://127.0.0.1:8801 で work/ の親を配信していること）
// 2D の canvas は GPU を切って描く（GPU のままだと読み出しが真っ黒になる）。
// /tmp（tmpfs、利用者ごとの上限あり）が一杯だと Chromium が落ちる（10/22 夜〜）。TMPDIR をディスクへ向けて流す：TMPDIR=~/.cache/pachikoma_tmp node render_clips.mjs ...
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { homedir } from 'os'; import { join } from 'path'; import fs from 'fs';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
// id: 場面、dur: 秒、params: 場面の引数、n: 灯の数（通常画面のウパの数）。idle は場面なし（通常画面だけ）
const CLIPS = [
  { name: 'idle', id: null, dur: +(process.env.IDLE_DUR ?? 12), n: 2 },
  { name: 'title', id: 'title', dur: 10, n: 0 },
  { name: 'ticket', id: 'ticket', dur: 2.8, n: 0, params: { balls: 80 } },
  { name: 'start', id: 'start', dur: 1.9, n: 0 },
  { name: 'success_small', id: 'success_small', dur: 3.8, n: 0, params: { payout: 30 } },
  { name: 'fail', id: 'fail', dur: 2.6, n: 0 },
  { name: 'warn10', id: 'warn10', dur: 4, n: 2, params: { weak: false } },
  { name: 'timeup', id: 'timeup', dur: 4, n: 0 },
  { name: 'add100', id: 'add100', dur: 3, n: 0, params: { balls: 100, seconds: 60 } },
  { name: 'finish_count', id: 'finish_count', dur: 6, n: 0, params: { total: 60 } },
  { name: 'result', id: 'result', dur: 9, n: 0, params: { rank: 1, total: 60 } },
  { name: 'lamp4', id: 'lamp4', dur: 4.1, n: 4 },
  { name: 'lamp5', id: 'lamp5', dur: 3.4, n: 5 },
  { name: 'lamp6', id: 'lamp6', dur: 3.7, n: 6 },
  { name: 'roulette', id: 'roulette', dur: 8.3, n: 3, params: { n_from: 3, k: 1 } },
  { name: 'success_big', id: 'success_big', dur: 7, n: 0, params: { payout: 60 } },
].filter(c => !process.argv[3] || process.argv[3].split(',').includes(c.name));
const b = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-accelerated-2d-canvas', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])] });
for (const c of CLIPS) { for (let attempt = 0; attempt < 3; attempt++) { let ff = null; try {
  const p = await b.newPage({ viewport: { width: 1300, height: 760 } });
  p.on('pageerror', e => console.log(c.name, 'pageerror', e.message));
  await p.goto('http://127.0.0.1:8801/work/effects/lcd/harness.html?manual=1');
  await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  await p.evaluate((n) => LCD.setState({ n, nDisp: n, hudOn: false }), c.n);
  await p.evaluate(() => { LCD.reset(); for (let i = 0; i < 30; i++) H.step(1 / 60); }); console.log(c.name, JSON.stringify(await p.evaluate(() => ({ ready: LCD.ready, defs: Object.keys(LCD.defs).length, base: !!LCD.base }))));
  if (c.id) await p.evaluate(({ id, params }) => LCD.play(id, params), { id: c.id, params: c.params || {} });
  const file = join(out, c.name + '.webm');
  ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-g', '60', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(c.dur * 60);
  for (let f = 0; f < total; f++) {
    const u = await p.evaluate(() => { H.step(1 / 60); return document.getElementById('c').toDataURL('image/jpeg', 0.95); });
    if (!ff.stdin.write(Buffer.from(u.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  console.log(c.name, total, 'frames ->', file); await p.close(); break;
  } catch (e) { ff?.kill('SIGKILL'); console.log(c.name, 'attempt', attempt, 'failed:', e.message.split('\n')[0]); } } }
await b.close();
