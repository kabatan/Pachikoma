// 計数・結果の縦の窓の版(end_v.js)を、最終ランクごとに数字なしで書き出す(1152×1268・30fps・mp4)。
// 数字の入る枠はコマごとに記録して clips/end_v_slots.json へ(液晶の面の end_digits.mjs が実際の値を重ねる)。
//   TMPDIR=~/.cache/pachikoma_tmp node render_end_v.mjs [名前,名前,...]   （http://127.0.0.1:8791 で work/ の親を配信していること）
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os'; import { join } from 'node:path'; import { fileURLToPath } from 'node:url';
const { chromium } = createRequire('/home/kabatan/work/Pachikoma/qa/')('playwright-core');
const here = fileURLToPath(new URL('.', import.meta.url)), clips = join(here, '../../clips');
const rules = JSON.parse(readFileSync(join(here, '../../../../../game_tuning/r3/rules_r3.json'), 'utf8'));
const TH = rules.PrizeThresholds.slice(1), PRIZE = rules.PrizeNames, LOAN = rules.LoanBalls, FPS = 30;
// ものさしの代表値(映像の中で数え上がる JP の合計)。ランクの境を越える時刻はこの値で決まり、重ねる数字はその時刻に境の値を指すように写す
const REP = [0, 120, 260, 400, 560];
// 「あと N玉で」は N≤27 の時だけ(元の場面と同じ)。R3 の JP は 30 からなので、参加賞と A(次の S は 500 を当てた時だけ)には出ない
const VARIANTS = [];
for (let r = 0; r <= 4; r++) for (const hint of [false, true]) {
  if (hint && !(r === 1 || r === 2)) continue;
  const h = hint ? r + 1 : null, suf = `r${r}${hint ? 'h' : ''}`;
  VARIANTS.push({ name: `finish_count_${suf}`, id: 'finish_count_v', dur: 6, params: { rank: r, rep: REP[r], thresholds: TH, hintRank: h } });
  VARIANTS.push({ name: `result_${suf}`, id: 'result_v', dur: 9, params: { rank: r, prize: PRIZE[r], hintRank: h, loanBalls: LOAN } });
}
const only = process.argv[2]?.split(',');
const b = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 700 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://127.0.0.1:8791/work/game_demo/play/lcd_surface/tools/end_v/end_v.html');
await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const slotsFile = join(clips, 'end_v_slots.json'), all = existsSync(slotsFile) ? JSON.parse(readFileSync(slotsFile, 'utf8')) : {};
for (const v of VARIANTS.filter((x) => !only || only.includes(x.name))) {
  await p.evaluate(([id, prm]) => H.play(id, prm), [v.id, v.params]);
  const file = join(clips, v.name + '.mp4');
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = [], n = Math.round(v.dur * FPS);
  for (let f = 0; f < n; f++) {
    const { slots, png } = await p.evaluate((f) => { const s = H.step(f === 0 ? 0 : 1 / 30); return { slots: s, png: H.png() }; }, f);
    frames.push(slots.map((s) => { const o = { k: s.key, y: +s.cy.toFixed(1), h: +s.h.toFixed(1), z: +s.z.toFixed(4), ox: +s.ox.toFixed(1), oy: +s.oy.toFixed(1) };
      if (s.right != null) o.r = +s.right.toFixed(1); else o.x = +s.cx.toFixed(1);
      if (s.a != null && s.a < 1) o.a = +s.a.toFixed(3); if (s.u != null) o.u = +s.u.toFixed(4); if (s.cv != null) o.cv = s.cv; return o; }));
    if (!ff.stdin.write(Buffer.from(png.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  all[v.name] = { fps: FPS, rank: v.params.rank, rep: v.params.rep ?? null, thresholds: TH, hint: v.params.hintRank != null, frames };
  writeFileSync(slotsFile, JSON.stringify(all));
  console.log(v.name, n, 'frames');
}
await b.close();
