// 計数・結果の数字の重なりを、液晶の面のまま実時間で撮る：node work/game_demo/play/lcd_surface/tools/end_check.mjs <out_dir>
// finish_count(6秒)→ result の合図を渡し、決めた時刻の canvas を撮る
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('../../../../', import.meta.url)), out = process.argv[2] ?? '/tmp/end_check';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try { const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))); if (!p.startsWith(root)) throw 0; const b = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/kabatan/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/game_demo/play/lcd_surface/tools/end_check.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
// effects_bus が送る形(finish_count・result とも nextRank の値を持つ)
const v = { total: 64, balls: 64, score: 230, rankIndex: 2, to_next: 90, next_rank: 3 };
await page.evaluate((v) => window.__cue('finish_count', v), v);
for (const [t, tag] of [[2, 'fc_2s'], [5.5, 'fc_5.5s']]) { await wait(t - (tag === 'fc_2s' ? 0 : 2)); await writeFile(join(out, tag + '.jpg'), Buffer.from((await page.evaluate(() => window.__png())).split(',')[1], 'base64')); }
await wait(0.6);
await page.evaluate((v) => window.__cue('result', { ...v, rank: 2, prizeRank: 2 }), v);
await wait(7.5); await writeFile(join(out, 'res_7.5s.jpg'), Buffer.from((await page.evaluate(() => window.__png())).split(',')[1], 'base64'));
console.log(JSON.stringify(await page.evaluate(() => window.__stats().played)));
await browser.close(); server.close();
