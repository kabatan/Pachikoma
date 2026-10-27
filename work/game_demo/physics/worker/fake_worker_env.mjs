// Node 上で Worker を同じプロセスの中で真似る(構造化複製・非同期配送)。fetch(file:) も読めるようにする。
import { readFile } from 'node:fs/promises';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...a) => { const u = new URL(String(url)); if (u.protocol === 'file:') { const t = await readFile(u, 'utf8'); return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) }; } return realFetch(url, ...a); };
let loaded = null;
globalThis.Worker = class {
  constructor(url) {
    const me = this; this.latencyMs = 0;
    globalThis.self = globalThis; globalThis.postMessage = (d) => { const c = structuredClone(d); setTimeout(() => me.onmessage?.({ data: c }), 0); };   // 本物の Worker と同じく self は大域(Rapier の glue が self.performance 等を見る)
    this._ready = (loaded ??= import(url.href));
  }
  postMessage(d) { const c = structuredClone(d); this._ready.then(() => setTimeout(() => globalThis.self.onmessage({ data: c }), 0)); }
  terminate() {}
};
export const turn = () => new Promise((r) => setTimeout(r, 0));
