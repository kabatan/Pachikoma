// 静的サーバ(loopback専用)。work/ を配信（game_demo と cabinet の両方が要る）。POST /api/medal-log は ui/logs に追記。
//   node play/serve.mjs [port=8792]   → http://127.0.0.1:8792/game_demo/play/index.html
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url))); const LOGS = join(ROOT, 'game_demo', 'ui', 'logs');
const DOCS = resolve(ROOT, '../docs');
const PORT = Number(process.argv[2] ?? 8792);
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.png': 'image/png', '.wasm': 'application/wasm', '.obj': 'text/plain; charset=utf-8', '.npy': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/medal-log') {
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
      await mkdir(LOGS, { recursive: true }); JSON.parse(body);
      await appendFile(join(LOGS, new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.jsonl'), body.replace(/\n/g, ' ') + '\n');
      res.writeHead(204).end(); return;
    }
    // 規則正本のdocs/も配信する。プロジェクト全体は公開しない。
    // 演出側(work/effects)はプロジェクトルート基準の絶対パス(/work/..., /anim/...)で素材を読む。
    if (process.env.SERVE_LOG) appendFile(process.env.SERVE_LOG, decodeURIComponent(url.pathname) + '\n').catch(() => {});   // 配布物の洗い出し用(読まれたファイルの記録)
    let pathname = decodeURIComponent(url.pathname);
    const anim = pathname.startsWith('/anim/'); if (pathname.startsWith('/work/')) pathname = pathname.slice(5);
    const docs = pathname.startsWith('/docs/');
    const root = docs ? DOCS : anim ? resolve(ROOT, '..') : ROOT;
    const path = normalize(join(root, docs ? pathname.slice(6) : pathname));
    const rel = relative(root, path); if (!rel || rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end(); return; }   // Windowsの区切り文字(\\)でも判定できる
    const data = await readFile(path); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message)); }
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
