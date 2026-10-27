// R3-G: 払い出しの見え方を調べる。node probe_payout.mjs <out_dir> [query]
// 遊技開始後に pa.payout(N) し、1/30 秒ごとに皿を撮り、新しく見えた玉の画面位置を記録する
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const out = resolve(process.argv[2]); const query = process.argv[3] ?? 'cabinet=m3'; const N = +(process.env.N ?? 30);
mkdirSync(out, { recursive: true });
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
let browser;
try {
  const { port } = await new Promise((r, j) => { server.once('message', r); server.once('error', j); });
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2560 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('err', e.message));
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html?seed=43&nolog&voice=off&${query}`);
  await page.waitForFunction(() => window.__ready || window.__startupError, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#serial-panel,#audio-panel,#start,#fullscreen{display:none!important}' });
  await page.evaluate(() => window.__play.pause(true));
  await page.evaluate(() => window.__play.tick(4));
  const info = await page.evaluate((N) => {
    const P = window.__play, pa = P.pa, hr = P.hr;
    window.__seen = new Map(); pa.payout(N, true);
    const T = pa.tray, p = T.payoutStart;
    const proj = (w) => { const v = pa.transforms.point('stage1', [w[0] / 1 - 0, w[1], w[2]]); return v; };
    return { start: p, ballsNow: T.activeBalls.size, cam: !!hr.camera };
  }, N);
  console.log(JSON.stringify(info));
  const rows = [];
  for (let f = 0; f < 30 * (+(process.env.SECS ?? 5)); f++) {
    const r = await page.evaluate(() => {
      const P = window.__play, pa = P.pa, T = pa.tray, hr = P.hr; P.frame(1 / 30, true);
      const res = [];
      for (const [id, b] of T.activeBalls) {
        if (b.stored) continue; const t = b.prev;
        const w = pa.transforms.point('stage1', [t.x - T.T[0], t.y - T.T[1], t.z - T.T[2]]);
        const v = new hr.camera.position.constructor(...w).project(hr.camera);
        const px = [(v.x + 1) / 2 * 1440, (1 - v.y) / 2 * 2560];
        if (!window.__seen.has(id)) window.__seen.set(id, { first: b.state, px: px.map(Math.round), z: +t.z.toFixed(4), y: +t.y.toFixed(4) });
        if (b.state === 'dish' && !window.__seen.get(id).dish) { window.__seen.get(id).dish = px.map(Math.round); window.__seen.get(id).dz = +t.z.toFixed(4); }
      }
      return { n: T.activeBalls.size, tunnel: T.activePayout, q: pa.payQueue };
    });
    rows.push(r);
    if (f % 2 === 0 && f < 60) await page.screenshot({ path: join(out, `p${String(f).padStart(3, '0')}.png`), clip: { x: 0, y: 2100, width: 1440, height: 460 } });
  }
  const seen = await page.evaluate(() => [...window.__seen.entries()].filter(([, v]) => v.first === 'payout').slice(0, 40));
  writeFileSync(join(out, 'probe.json'), JSON.stringify({ rows, seen }, null, 1));
  console.log(JSON.stringify(seen.slice(0, 8)));
} finally { await browser?.close(); server.kill(); }
