// 数字を重ねた計数→結果の通しの動画(レビュー用、数え上げの減速を見る)。TMPDIR=~/.cache/pachikoma_tmp node clip_end_v.mjs <out.mp4> [r2h]（8791 で配信していること）
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process'; import { homedir } from 'node:os'; import { join } from 'node:path'; import { fileURLToPath } from 'node:url';
const { chromium } = createRequire('/home/kabatan/work/Pachikoma/qa/')('playwright-core');
const clips = fileURLToPath(new URL('../../clips/', import.meta.url)), [out, tag = 'r2h'] = process.argv.slice(2);
const VALS = { r0: { total: 41, score: 0, rankIndex: 0 }, r1h: { total: 64, score: 182, rankIndex: 1, to_next: 18, next_rank: 2 }, r2: { total: 87, score: 230, rankIndex: 2, to_next: 90, next_rank: 3 },
  r2h: { total: 23, score: 305, rankIndex: 2, to_next: 15, next_rank: 3 }, r3: { total: 112, score: 410, rankIndex: 3 }, r4: { total: 150, score: 640, rankIndex: 4 } }[tag];
const b = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true });
const p = await b.newPage({ viewport: { width: 1152, height: 1268 } });
await p.goto('http://127.0.0.1:8791/work/game_demo/play/lcd_surface/tools/end_v/preview.html');
await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-vf', 'scale=576:-2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (const ev of ['finish_count', 'result']) {
  const name = await p.evaluate(([ev, v]) => H.pick(ev, v), [ev, VALS]);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(clips, name + '.mp4'), '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-'], { maxBuffer: 1 << 30 });
  const frames = []; for (let i = 0, s = -1; i < raw.length - 1; i++) { if (raw[i] === 0xff && raw[i + 1] === 0xd8 && s < 0) s = i; if (raw[i] === 0xff && raw[i + 1] === 0xd9 && s >= 0) { frames.push(raw.subarray(s, i + 2)); s = -1; } }
  for (let f = 0; f < frames.length; f++) {
    const png = await p.evaluate(([n, t, u]) => H.shot(n, t, u), [name, (f + 0.5) / 30, 'data:image/jpeg;base64,' + frames[f].toString('base64')]);
    if (!ff.stdin.write(Buffer.from(png.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  console.log(name, frames.length);
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await b.close();
