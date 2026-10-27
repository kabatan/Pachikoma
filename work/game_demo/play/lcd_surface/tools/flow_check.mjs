// JP の通しを液晶の面（映像＋灯の柱＋揃いの札＋数字）のまま 30fps で撮る：
//   node work/game_demo/play/lcd_surface/tools/flow_check.mjs <out.mp4> [payout=30] [flight秒=2.2] [撃つ秒=4.0]
// lamp6 → 撃つ（challenge_flight）→ 着地（jp）の順に出来事を渡し、1/30 秒ずつ進めて canvas を撮る。
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [out = '/tmp/flow_check.mp4', payout = '30', flight = '2.2', shoot = '4.0'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try { const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))); if (!p.startsWith(root)) throw 0; const b = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/kabatan/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/game_demo/play/lcd_surface/tools/digits_check.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-r', '30', '-i', '-', '-vf', 'scale=620:-2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const T = { lamp6: 0, shoot: +shoot, land: +shoot + +flight };
let fired = new Set(), n = 0;
for (let i = 0; i < 30 * (T.land + 9); i++) {
  const t = i / 30, ev = [];
  if (t >= T.lamp6 && !fired.has('l')) { fired.add('l'); ev.push(['lamp6', {}]); }
  if (t >= T.shoot && !fired.has('s')) { fired.add('s'); ev.push(['challenge_flight', {}]); }
  if (t >= T.land && !fired.has('j')) { fired.add('j'); ev.push(['jp', { payout: +payout }]); }
  const url = await page.evaluate(([e]) => window.__shot(e, 1), [ev]);
  ff.stdin.write(Buffer.from(url.split(',')[1], 'base64')); n++;
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r));
await browser.close(); server.close();
console.log(out, n, 'frames');
