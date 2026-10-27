// 継続の数字の重なり確認：node work/game_demo/play/lcd_surface/tools/digits_check.mjs <out_dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('../../../../', import.meta.url)), out = process.argv[2] ?? '/tmp/digits_check';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try { const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))); if (!p.startsWith(root)) throw 0; const b = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/kabatan/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/game_demo/play/lcd_surface/tools/digits_check.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const cases = [
  ['offer_hold', [['chain_choice', { pending: 130, chain: 3, lamps: 3 }]], 20],
  ['offer', [['chain_choice', { pending: 0, chain: 2, lamps: 2 }]], 20],
  ['ng_lost', [['chain_choice', { pending: 240, chain: 4, lamps: 4 }], ['chain_continue', {}], ['fail', { chain: true, chainLost: 240 }]], 40],
  ['bank', [['chain_choice', { pending: 70, chain: 2, lamps: 2 }], ['chain_stop', { banked: 70, chain: 2 }]], 40],
];
for (const [name, events, steps] of cases) {
  const url = await page.evaluate(([e, s]) => window.__shot(e, s), [events, steps]);
  await writeFile(join(out, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(name);
  await page.reload(); await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
}
await browser.close(); server.close();
