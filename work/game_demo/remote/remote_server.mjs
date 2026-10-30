// 司令塔サーバー: スマホ(スタッフ)から、複数台のゲームを一括/個別に操作する。追加の依存なし(Node標準のみ)。
//   node remote_server.mjs [--port 8900] [--pin 1234] [--stations 3]
//   環境変数 REMOTE_PORT / REMOTE_PIN / REMOTE_STATIONS でも指定できる。
// ・ゲーム側(remote_client.mjs)が ws://<このPC>:<port>/game?station=1 へつなぎに来る(ゲーム→司令塔の向きなので、ゲーム側のserve.mjsは変更不要)。
// ・スマホは http://<このPC>:<port>/ を開く。暗証番号(PIN)を入れた端末にだけ状態を送り、操作を受け付ける。
// ・どちらかが落ちても、もう一方は固まらない(ゲームは自動で再接続する/司令塔が落ちてもゲームは普通に続く)。
import { createServer } from 'node:http';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, env, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : (process.env[env] ?? fallback); };
const PORT = Number(arg('port', 'REMOTE_PORT', 8900));
const STATION_COUNT = Math.max(0, Math.min(12, Number(arg('stations', 'REMOTE_STATIONS', 3))));
const STALE_MS = 6000;            // ゲームから状態が6秒来なければ「応答なし」(接続は切れていないが固まっている)
const ACK_TIMEOUT_MS = 2500;      // 命令への返事の待ち時間
const MAX_PAYLOAD = 256 * 1024;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---- PIN: 引数/環境変数 → なければ remote_pin.txt(初回に乱数4桁を作って保存。再起動しても同じ) ----
function resolvePin() {
  const given = arg('pin', 'REMOTE_PIN', '');
  if (given) return String(given);
  const file = join(HERE, 'remote_pin.txt');
  try { const t = readFileSync(file, 'utf8').trim(); if (t) return t; } catch { /* 初回 */ }
  const pin = String(randomInt(0, 10000)).padStart(4, '0');
  try { writeFileSync(file, pin + '\n'); } catch { /* 書けなくても今回は使える */ }
  return pin;
}
const PIN = resolvePin();
const pinOk = (text) => { const a = Buffer.from(String(text ?? '')), b = Buffer.from(PIN); return a.length === b.length && timingSafeEqual(a, b); };

// ---- WebSocket(RFC 6455の必要最小限: テキスト/ping/pong/close、断片化、最大256KB) ----
function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  return Buffer.concat([head, body]);
}
class Peer {
  constructor(socket, kind, remoteAddress) {
    this.socket = socket; this.kind = kind; this.addr = remoteAddress; this.buf = Buffer.alloc(0); this.frag = null; this.alive = true;
    this.onmessage = () => {}; this.onclose = () => {}; this.closed = false; this.lastRx = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => { try { this.buf = Buffer.concat([this.buf, d]); this.parse(); } catch { this.close(); } });
    socket.on('close', () => this.finish()); socket.on('error', () => this.finish());
  }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 15, masked = (b[1] & 0x80) !== 0; let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_PAYLOAD)) return this.close(); len = Number(big); off = 10; }
      if (len > MAX_PAYLOAD || !masked) return this.close();   // クライアント→サーバーは必ずマスク付き
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len); this.lastRx = Date.now();
      if (op === 8) return this.close();
      if (op === 9) { this.raw(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) { this.frag = { op, parts: [data] }; } else if (op === 0 && this.frag) { this.frag.parts.push(data); } else return this.close();
      if (fin) { const f = this.frag; this.frag = null; if (f.op === 1) this.deliver(Buffer.concat(f.parts).toString('utf8')); }
    }
  }
  deliver(text) { let m; try { m = JSON.parse(text); } catch { return; } try { this.onmessage(m); } catch (e) { console.error('[remote] message error:', e.message); } }
  raw(buf) { if (!this.closed && this.socket.writable) { try { this.socket.write(buf); } catch { /* 切れた */ } } }
  send(obj) { this.raw(frame(1, JSON.stringify(obj))); }
  ping() { this.raw(frame(9, '')); }
  close() { if (this.closed) return; try { this.socket.write(frame(8, Buffer.from([0x03, 0xe8]))); } catch { /* */ } this.socket.end(); setTimeout(() => this.socket.destroy(), 500).unref(); this.finish(); }
  finish() { if (this.closed) return; this.closed = true; try { this.onclose(); } catch (e) { console.error('[remote] close error:', e.message); } }
}

// ---- 状態 ----
const games = new Map();       // station id -> { peer, state, hello, connectedAt, lastSeen }
const phones = new Set();      // 認証済みのスマホ Peer
const failures = new Map();    // IP -> { count, lockedUntil }
let nextCmd = 1; const pending = new Map();   // 命令id -> { phone, cmd, wanted:Set, results:{}, timer }

const stationOrder = () => {
  const ids = new Set(); for (let i = 1; i <= STATION_COUNT; i++) ids.add(String(i));
  for (const id of games.keys()) ids.add(id);
  return [...ids].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
};
function snapshot() {
  const now = Date.now();
  return {
    type: 'snapshot', now,
    stations: stationOrder().map((id) => {
      const g = games.get(id);
      if (!g) return { id, online: false };
      return { id, online: true, stale: now - g.lastSeen > STALE_MS, ageMs: now - g.lastSeen, connectedMs: now - g.connectedAt, state: g.state ?? null, ua: g.hello?.ua ?? '' };
    }),
  };
}
let broadcastTimer = null;
function broadcastSoon() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => { broadcastTimer = null; const s = snapshot(); for (const p of phones) p.send(s); }, 120);
}
setInterval(() => { const s = snapshot(); for (const p of phones) p.send(s); }, 1000).unref?.();   // 時間の経過(ageMs)も1秒ごとに見せる
setInterval(() => {   // 死んだ接続の掃除(ping送信、30秒無音は切る)
  const now = Date.now();
  for (const p of [...phones, ...[...games.values()].map(g => g.peer)]) { if (now - p.lastRx > 30000) p.close(); else p.ping(); }
}, 10000).unref?.();

function sendCommand(phone, msg) {
  const cmd = String(msg.cmd);
  if (!['reset', 'reload', 'pause', 'resume', 'staff', 'staffcancel'].includes(cmd)) return phone.send({ type: 'result', cmd, ok: false, error: '未対応の操作です' });
  const all = msg.targets === 'all';
  const targets = (all ? stationOrder() : Array.isArray(msg.targets) ? msg.targets.map(String) : []);
  if (!targets.length) return phone.send({ type: 'result', cmd, ok: false, error: '対象の台がありません' });
  const id = nextCmd++, entry = { phone, cmd, results: {}, wanted: new Set() };
  for (const st of targets) {
    const g = games.get(st);
    if (!g || g.peer.closed) { entry.results[st] = { ok: false, msg: 'つながっていません' }; continue; }
    entry.wanted.add(st); g.peer.send({ type: 'cmd', id, cmd });
  }
  entry.timer = setTimeout(() => finishCommand(id, true), ACK_TIMEOUT_MS);
  pending.set(id, entry);
  if (!entry.wanted.size) finishCommand(id, false);
  console.log(`[remote] ${new Date().toLocaleTimeString()} ${phone.addr} -> ${cmd} [${targets.join(',')}]`);
}
function finishCommand(id, timeout) {
  const e = pending.get(id); if (!e) return; pending.delete(id); clearTimeout(e.timer);
  for (const st of e.wanted) if (!e.results[st]) e.results[st] = { ok: false, msg: timeout ? '返事がありません' : '不明' };
  if (!e.phone.closed) e.phone.send({ type: 'result', cmd: e.cmd, results: e.results, ok: Object.values(e.results).every(r => r.ok) });
}
function onAck(station, m) {
  const e = pending.get(m.id); if (!e || !e.wanted.has(station)) return;
  e.results[station] = { ok: !!m.ok, msg: String(m.msg ?? '').slice(0, 80) };
  if ([...e.wanted].every(st => e.results[st])) finishCommand(m.id, false);
}

// ---- 接続 ----
function attachGame(peer, station, ua) {
  const old = games.get(station);
  if (old) { old.peer.send({ type: 'replaced' }); old.peer.close(); }   // 同じ台番号が来たら新しい方を採用(古い方は再接続せず静かに止まる)
  const rec = { peer, state: null, hello: { ua }, connectedAt: Date.now(), lastSeen: Date.now() };
  games.set(station, rec);
  console.log(`[remote] game connected: ${station}号機 (${peer.addr})`);
  peer.send({ type: 'welcome', station });
  peer.onmessage = (m) => {
    rec.lastSeen = Date.now();
    if (m.type === 'state' && m.state && typeof m.state === 'object') { rec.state = m.state; broadcastSoon(); }
    else if (m.type === 'ack') onAck(station, m);
  };
  peer.onclose = () => { if (games.get(station) === rec) { games.delete(station); console.log(`[remote] game disconnected: ${station}号機`); broadcastSoon(); } };
  broadcastSoon();
}
function attachPhone(peer) {
  let authed = false;
  peer.onmessage = (m) => {
    if (m.type === 'auth') {
      const f = failures.get(peer.addr) ?? { count: 0, lockedUntil: 0 }, now = Date.now();
      if (now < f.lockedUntil) return peer.send({ type: 'auth', ok: false, error: `しばらく待ってからもう一度（あと${Math.ceil((f.lockedUntil - now) / 1000)}秒）` });
      if (!pinOk(m.pin)) {
        f.count++; if (f.count >= 5) { f.count = 0; f.lockedUntil = now + 60000; }
        failures.set(peer.addr, f);
        return peer.send({ type: 'auth', ok: false, error: '暗証番号が違います' });
      }
      failures.delete(peer.addr); authed = true; phones.add(peer);
      peer.send({ type: 'auth', ok: true, stations: STATION_COUNT }); peer.send(snapshot());
      return;
    }
    if (!authed) return;
    if (m.type === 'cmd') sendCommand(peer, m);
  };
  peer.onclose = () => { phones.delete(peer); };
  setTimeout(() => { if (!authed) peer.close(); }, 60000).unref?.();
}

const HTML_FILE = join(HERE, 'control.html');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(readFileSync(HTML_FILE)); }
    catch (e) { res.writeHead(500).end(String(e.message)); }
    return;
  }
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok'); return; }   // 暗証番号なしで答えるのは「生きている」だけ
  res.writeHead(404).end();
});
server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url, 'http://x'), key = req.headers['sec-websocket-key'];
    const kind = url.pathname === '/game' ? 'game' : url.pathname === '/ws' ? 'phone' : null;
    if (!kind || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const addr = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const peer = new Peer(socket, kind, addr);
    if (kind === 'game') {
      const station = String(url.searchParams.get('station') ?? '').slice(0, 16).replace(/[^\w.-]/g, '') || `x${addr}`;
      attachGame(peer, station, String(req.headers['user-agent'] ?? '').slice(0, 120));
    } else attachPhone(peer);
  } catch (e) { console.error('[remote] upgrade error:', e.message); try { socket.destroy(); } catch { /* */ } }
});
process.on('uncaughtException', (e) => console.error('[remote] uncaught:', e));   // 1つの接続の不具合で司令塔を落とさない
process.on('unhandledRejection', (e) => console.error('[remote] unhandled:', e));
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `ポート${PORT}はすでに使われています。--port で別の番号を指定してください。` : e.message); process.exit(1); });
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  const hosts = ips.length ? ips : ['127.0.0.1'];
  const line = '='.repeat(64);
  console.log(`\n${line}\n  パチコマ 司令塔（ポート ${PORT}）\n${line}`);
  console.log('\n  スマホで開くURL（同じWi-Fiにつなぐ）:');
  for (const h of hosts) console.log(`      http://${h}:${PORT}/`);
  console.log(`\n  暗証番号(PIN): ${PIN}`);
  console.log('\n  各PCのゲームのURL（?station=台番号&remote=この司令塔）:');
  for (const h of hosts) for (let i = 1; i <= Math.max(1, STATION_COUNT); i++) console.log(`      ...index.html?station=${i}&remote=${h}:${PORT}`);
  console.log('\n  止めるときはこの窓を閉じる(Ctrl+C)。止めてもゲームは普通に続き、再開すると自動でつながり直す。\n' + line + '\n');
});
