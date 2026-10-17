// 依存なしの静的サーバ(loopback専用)。work/game_demo を配信し、POST /api/medal-log を ui/logs/YYYYMMDD.jsonl に追記する。
//   node ui/serve.mjs [port=8790]
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))); const LOGS = join(ROOT, 'ui', 'logs');
const PORT = Number(process.argv[2] ?? 8790);
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.png': 'image/png', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/medal-log') {
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
      await mkdir(LOGS, { recursive: true }); JSON.parse(body);
      await appendFile(join(LOGS, new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.jsonl'), body.replace(/\n/g, ' ') + '\n');
      res.writeHead(204).end(); return;
    }
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(path); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message)); }
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/ui/demo.html`));
