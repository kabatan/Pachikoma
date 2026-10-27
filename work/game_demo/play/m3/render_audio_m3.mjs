// R3-G：play_m3.mjs の audio_events.json（録画と同じ 1/60 秒の時計の音の出来事）から、配布版の音響エンジンを OfflineAudioContext で描いて wav に。
// R3-V の work/effects/catalog/render_audio.mjs と同じやり方（1 本の通しだけ）。 node render_audio_m3.mjs <out_dir>
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
const require = createRequire('/home/kabatan/work/Pachikoma/qa/');
const { chromium } = require('playwright-core');
const out = resolve(process.argv[2] ?? 'work/game_demo/play/out/m3_play');
const cap = JSON.parse(readFileSync(join(out, 'audio_events.json'), 'utf8'));
let lcdVideo = false;
try {
  const session = JSON.parse(readFileSync(join(out, 'session.json'), 'utf8'));
  lcdVideo = new URLSearchParams(session.extra ?? '').get('lcd') === 'video';
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const FPS = cap.fps, SR = 48000;
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
let browser;
try {
  const { port } = await new Promise((r, j) => { server.once('message', r); server.once('error', j); });
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const chunks = [];
  await page.exposeFunction('saveChunk', (b64) => { chunks.push(Buffer.from(b64, 'base64')); });
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/m3/audio_render.html${lcdVideo ? '?lcd=video' : ''}`);
  const report = await page.evaluate(async ({ events, frames, fps, sr }) => {
    const { AudioEngine } = await import('/audio/runtime/audio_engine.mjs');
    const context = new OfflineAudioContext(2, Math.ceil(frames * sr / fps), sr);
    const engine = new AudioEngine({ context, base: new URL('/audio/sfx/', location.origin), autoTick: false, voiceProvider: 'off', master: .45, bgmEnabled: true, bgmVolume: .65, bgmManifest: new URL('/audio/bgm/manifest.json', location.origin), getPhase: () => null });
    await Promise.all([engine.ready, engine.bgm.ready]);
    const tl = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
    const waits = Array.from({ length: frames }, (_, i) => context.suspend(i / fps));
    const rendering = context.startRendering(); let ei = 0;
    for (let i = 0; i < frames; i++) {
      await waits[i]; const now = context.currentTime;
      while (ei < tl.length && tl[ei].t <= now + 1e-7) {
        const e = tl[ei++];
        if (e.type === 'event') engine.handleEvent(e.event); else if (e.type === 'contact') engine.contact(e.contact); else if (e.type === 'payout') engine.payout(e.count);
      }
      engine.flush(); await context.resume();
    }
    const buf = await rendering, L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
    let peak = 0;
    for (let s0 = 0; s0 < n; s0 += sr * 10) {
      const m = Math.min(n, s0 + sr * 10), pcm = new Int16Array((m - s0) * 2);
      for (let i = s0; i < m; i++) { const a = L[i], b = R[i]; peak = Math.max(peak, Math.abs(a), Math.abs(b)); pcm[(i - s0) * 2] = Math.round(Math.max(-1, Math.min(1, a)) * 32767); pcm[(i - s0) * 2 + 1] = Math.round(Math.max(-1, Math.min(1, b)) * 32767); }
      const bytes = new Uint8Array(pcm.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await window.saveChunk(btoa(bin));
    }
    return { samples: n, seconds: n / sr, eventsApplied: ei, events: tl.length, peak };
  }, { events: cap.events, frames: cap.frames, fps: FPS, sr: SR });
  const pcm = Buffer.concat(chunks), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(join(out, 'audio.wav'), Buffer.concat([h, pcm]));
  writeFileSync(join(out, 'audio_report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
} finally { await browser?.close(); server.kill(); }
