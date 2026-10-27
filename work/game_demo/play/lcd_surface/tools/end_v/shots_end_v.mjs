// 数字を重ねた計数・結果の静止画（レビュー用）。TMPDIR=~/.cache/pachikoma_tmp node shots_end_v.mjs <出力先>（8791 で配信していること）
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { homedir } from 'node:os'; import { join } from 'node:path';
const { chromium } = createRequire('/home/kabatan/work/Pachikoma/qa/')('playwright-core');
const clips = fileURLToPath(new URL('../../clips/', import.meta.url)), out = process.argv[2]; mkdirSync(out, { recursive: true });
// 実際の値の例：持ち玉・JP の合計・ランク（rankIndex）・あと N玉
const CASES = [
  ['r0', { total: 41, balls: 41, score: 0, rankIndex: 0, to_next: 30, next_rank: 1 }],
  ['r1h', { total: 64, balls: 64, score: 182, rankIndex: 1, to_next: 18, next_rank: 2 }],
  ['r2', { total: 87, balls: 87, score: 230, rankIndex: 2, to_next: 90, next_rank: 3 }],
  ['r2h', { total: 23, balls: 23, score: 305, rankIndex: 2, to_next: 15, next_rank: 3 }],
  ['r3', { total: 112, balls: 112, score: 410, rankIndex: 3 }],
  ['r4', { total: 150, balls: 150, score: 640, rankIndex: 4 }],
];
const TIMES = { finish_count: [1.5, 3.0, 5.5], result: [7.5] };
const b = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1152, height: 1268 } });
p.on('pageerror', (e) => console.log('pageerror', e.message)); p.on('console', (m) => m.type() !== 'log' && console.log(m.text()));
await p.goto('http://127.0.0.1:8791/work/game_demo/play/lcd_surface/tools/end_v/preview.html');
await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
const only = process.argv[3]?.split(',');
for (const [tag, vals] of CASES) for (const [ev, ts] of Object.entries(TIMES)) for (const t of ts) {
  if (only && !only.includes(tag)) continue;
  const name = await p.evaluate(([ev, vals]) => H.pick(ev, vals), [ev, vals]), fr = Math.round(t * 30);
  const png = execFileSync('ffmpeg', ['-v', 'error', '-i', join(clips, name + '.mp4'), '-vf', `select=eq(n\\,${fr})`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 64 << 20 });
  const r = await p.evaluate(([name, t, u]) => H.shot(name, t, u), [name, (fr + 0.5) / 30, 'data:image/png;base64,' + png.toString('base64')]);
  const f = join(out, `${tag}_${ev}_${t.toFixed(1)}.png`); writeFileSync(f, Buffer.from(r.split(',')[1], 'base64')); console.log(name, f);
}
await b.close();
