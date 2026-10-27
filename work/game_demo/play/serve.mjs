// 静的サーバ(loopback専用)。work/ を配信（game_demo と cabinet の両方が要る）。POST /api/medal-log は ui/logs に追記。
//   node play/serve.mjs [port=8792]   → http://127.0.0.1:8792/game_demo/play/index.html
import { createServer } from 'node:http';
import { createMp4Pacer } from './mp4_pacer.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, appendFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url))); const LOGS = join(ROOT, 'game_demo', 'ui', 'logs');
const DOCS = resolve(ROOT, '../docs');
const PORT = Number(process.argv[2] ?? 8792);
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.obj': 'text/plain; charset=utf-8', '.npy': 'application/octet-stream' };
const mp4Pacer=createMp4Pacer({audit:process.env.MP4_PACING_AUDIT==='1'});
process.on('message',async m=>{if(m?.kind==='pacing-snapshot')process.send?.({kind:'pacing-snapshot',id:m.id,snapshot:mp4Pacer.snapshot()});if(m?.kind==='pacing-close')process.send?.({kind:'pacing-close',id:m.id,snapshot:await mp4Pacer.close()});});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/medal-log') {
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
      await mkdir(LOGS, { recursive: true }); JSON.parse(body);
      await appendFile(join(LOGS, new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.jsonl'), body.replace(/\n/g, ' ') + '\n');
      res.writeHead(204).end(); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/human-play') {
      if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const doc = JSON.parse(Buffer.concat(chunks).toString());
      if (doc.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doc.playId) ||
          !['in_progress', 'completed'].includes(doc.status) || !Number.isSafeInteger(doc.revision) || doc.revision < 1 ||
          typeof doc.startedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(doc.startedAt) || !Number.isFinite(Date.parse(doc.startedAt)) ||
          !Array.isArray(doc.events) || doc.events.length > 2000 || !doc.result || typeof doc.result !== 'object') {
        res.writeHead(400).end(); return;
      }
      const day = doc.startedAt.slice(0, 10).replace(/-/g, '');
      const dir = join(LOGS, 'human', day), path = join(dir, `${doc.playId}.json`);
      await mkdir(dir, { recursive: true });
      let prior = null;
      try { prior = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!prior || prior.revision <= doc.revision) {
        const temp = join(dir, `.${doc.playId}.${randomUUID()}.tmp`);
        try { await writeFile(temp, JSON.stringify(doc) + '\n'); await rename(temp, path); }
        finally { await unlink(temp).catch(() => {}); }
      }
      res.writeHead(204).end(); return;
    }
    // 規則正本のdocs/も配信する。プロジェクト全体は公開しない。
    // 演出側(work/effects)はプロジェクトルート基準の絶対パス(/work/..., /anim/...)で素材を読む。
    if (process.env.SERVE_LOG) appendFile(process.env.SERVE_LOG, decodeURIComponent(url.pathname) + '\n').catch(() => {});   // 配布物の洗い出し用(読まれたファイルの記録)
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/game_demo/ui/logs/') || pathname.startsWith('/work/game_demo/ui/logs/')) { res.writeHead(403).end(); return; }
    const anim = pathname.startsWith('/anim/'); if (pathname.startsWith('/work/')) pathname = pathname.slice(5);
    const docs = pathname.startsWith('/docs/');
    const root = docs ? DOCS : anim ? resolve(ROOT, '..') : ROOT;
    const path = normalize(join(root, docs ? pathname.slice(6) : pathname));
    const rel = relative(root, path); if (!rel || rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end(); return; }   // Windowsの区切り文字(\\)でも判定できる
    const logRel = relative(LOGS, path);
    if (!logRel.startsWith('..') && !isAbsolute(logRel)) { res.writeHead(403).end(); return; }
    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    const headers = { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    let start = 0, end = info.size - 1;
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'content-length': info.size });
    }
    if (req.method === 'HEAD' || info.size === 0) { res.end(); return; }
    // Range分だけ読む。動画の切替・シークで全映像を読み直さず、切断時は読み込みも停止する。
    if(req.method==='GET'&&extname(path)==='.mp4')await mp4Pacer.send(req,res,{path,start,end});
    else await pipeline(createReadStream(path, { start, end }), res);
  } catch (e) {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message));
  }
});
let tries = 0, listenPort = PORT;
server.on('error', (e) => { if (e.code === 'EADDRINUSE' && PORT !== 0 && tries++ < 20) server.listen(++listenPort, '127.0.0.1'); else { console.error(e.message); process.exit(1); } });
server.on('listening', () => {
  const port = server.address().port, url = `http://127.0.0.1:${port}/game_demo/play/index.html`;
  console.log(url);
  process.send?.({port});
  if (process.argv.includes('--open')) {   // 既定のブラウザで開く(Windows/macOS/Linux)
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});
server.listen(PORT, '127.0.0.1');
