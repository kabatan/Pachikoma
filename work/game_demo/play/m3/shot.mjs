// R3-G: 確認用の静止画。node shot.mjs <out.png> '<query>' [秒=3] [js]
// python3 tools/gpu_run.py cabinet r3g-shot 2 -- systemd-run --user --scope --quiet --collect -p MemoryMax=6G -p MemorySwapMax=0 -- flock -x -w 900 work/game_demo/perf/lowend_r2/tmp/browser.lock node work/game_demo/play/m3/shot.mjs ...
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const [outPath, query = '', secs = '3', js = ''] = process.argv.slice(2);
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
let browser;
try {
  const { port } = await new Promise((r, j) => { server.once('message', r); server.once('error', j); });
  const gpu = process.env.CPU_RENDER ? ['--use-gl=angle', '--use-angle=swiftshader'] : ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: [...gpu, '--autoplay-policy=no-user-gesture-required', '--enable-webgl-draft-extensions'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2560 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html?seed=43&nolog&voice=off&${query}`);
  await page.waitForFunction(() => window.__ready || window.__startupError, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#serial-panel,#audio-panel,#start,#fullscreen{display:none!important}' });
  await page.evaluate(() => window.__play?.pause(true));
  if (js) console.log('js', JSON.stringify(await page.evaluate(js)));
  await page.evaluate((s) => window.__play?.tick(s), Number(secs));
  await page.screenshot({ path: resolve(outPath) });
  console.log(JSON.stringify({ errors: errors.slice(0, 20), startup: await page.evaluate(() => window.__startupError ?? null), render: await page.evaluate(() => window.__play?.pack?.render), layers: await page.evaluate(() => window.__play?.hr?.layerCount) }, null, 1).slice(0, 3000));
} finally { await browser?.close(); server.kill(); }
