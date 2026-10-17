// 実際の来場者プレイだけを、匿名の1プレイ1ファイルとして保存する。
// 各更新を localStorage に先に残し、サーバーへ送る。通信失敗分は次回起動時に再送する。
const STORAGE_KEY = 'pachikoma-human-play-pending';
const MAX_EVENTS = 2000;

function snapshot(game) {
  return {
    phase: game.phase, wallet: game.wallet, purchased: game.purchased,
    spent: game.spent, won: game.won, attempts: game.attempts,
    successes: game.successes, lamps: game.lamps, maxLamps: game.maxLamps,
    bestAward: game.bestAward, addedCredit: game.addedCredit,
    secondsLeft: +game.secondsLeft.toFixed(2), prize: game.prize,
    endReason: game.endReason,
  };
}

export class HumanHistory {
  constructor({ endpoint = '/api/human-play', storage = globalThis.localStorage,
    transport = globalThis.fetch?.bind(globalThis), now = () => new Date(),
    makeId = () => globalThis.crypto.randomUUID() } = {}) {
    this.endpoint = endpoint; this.storage = storage; this.transport = transport;
    this.now = now; this.makeId = makeId; this.context = {};
    this.active = null; this.queue = Promise.resolve();
    try { this.pending = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'); }
    catch { this.pending = {}; }
    for (const doc of Object.values(this.pending)) this._enqueue(doc);
  }

  setContext(context) { this.context = { ...context }; }

  begin(game) {
    if (this.active?.status === 'in_progress') return;
    const at = this.now().toISOString();
    this.active = {
      schemaVersion: 1, playId: this.makeId(), status: 'in_progress',
      startedAt: at, updatedAt: at, endedAt: null, revision: 0,
      context: { ...this.context }, inputCounts: { cabinet: 0, keyboard: 0, pointer: 0 },
      events: [], omittedEvents: 0, result: snapshot(game),
    };
    this._save(game);
  }

  input({ source, action, accepted, phase }, game) {
    if (this.active?.status !== 'in_progress') return;
    this.active.inputCounts[source] = (this.active.inputCounts[source] || 0) + 1;
    this._event('input', { source, action, accepted, phase }, game);
  }

  action(action, game) {
    if (this.active?.status !== 'in_progress') return;
    this._event('action', { action }, game);
  }

  gameEvent(kind, detail, game) {
    if (this.active?.status !== 'in_progress' || !['receipt', 'phase'].includes(kind)) return;
    this._event(kind, detail, game);
  }

  finish(game) {
    if (this.active?.status !== 'in_progress') return;
    this.active.status = 'completed';
    this.active.endedAt = this.now().toISOString();
    this._event('result', { prize: game.prize }, game);
  }

  _event(kind, detail, game) {
    const doc = this.active;
    if (doc.events.length < MAX_EVENTS) {
      doc.events.push({ at: this.now().toISOString(), kind, detail, ...snapshot(game) });
    } else doc.omittedEvents++;
    this._save(game);
  }

  _save(game) {
    const doc = this.active;
    doc.updatedAt = this.now().toISOString(); doc.result = snapshot(game); doc.revision++;
    const copy = JSON.parse(JSON.stringify(doc));
    this.pending[doc.playId] = copy;
    this._persist();
    this._enqueue(copy);
  }

  _persist() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.pending)); } catch { /* サーバー送信は続ける */ }
  }

  _enqueue(doc) {
    this.queue = this.queue.then(async () => {
      if (!this.transport) return;
      try {
        const response = await this.transport(this.endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc),
        });
        if (!response.ok) return;
        await response.text();
        if (this.pending[doc.playId]?.revision === doc.revision) {
          delete this.pending[doc.playId]; this._persist();
        }
      } catch { /* localStorage の最新スナップショットを次回起動で再送 */ }
    });
  }

  flush() { return this.queue; }
}
