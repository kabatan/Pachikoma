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
    makeId = () => globalThis.crypto.randomUUID(), saveDelayMs = 2000,
    setTimer = globalThis.setTimeout?.bind(globalThis), clearTimer = globalThis.clearTimeout?.bind(globalThis),
    lifecycle = globalThis } = {}) {
    this.endpoint = endpoint; this.storage = storage; this.transport = transport;
    this.now = now; this.makeId = makeId; this.context = {};
    this.active = null; this.queue = Promise.resolve();
    // 10/31 検証: 保存（全体の複製＋localStorage＋送信）は1000件で約7ms・2000件で約16msかかり、プレイ中に毎イベント同期で走ると描画をかくつかせる。
    // イベントは即座に積み、保存は最大 saveDelayMs 遅らせてまとめる。開始・結果の確定・flush()・pagehide/非表示では即座に保存する
    this.saveDelayMs = saveDelayMs; this._setTimer = setTimer; this._clearTimer = clearTimer;
    this._timer = null; this._dirty = false; this._game = null; this._keepalive = false;
    const leave = () => { this._keepalive = true; try { this._commit(); } finally { this._keepalive = false; } };
    try {
      lifecycle?.addEventListener?.('pagehide', leave);
      lifecycle?.addEventListener?.('visibilitychange', () => { if (globalThis.document?.visibilityState === 'hidden') leave(); });
    } catch { /* ブラウザ以外では何もしない */ }
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
    this._save(game, true);
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
    this._event('result', { prize: game.prize }, game, true);
  }

  _event(kind, detail, game, immediate = false) {
    const doc = this.active;
    if (doc.events.length < MAX_EVENTS) {
      doc.events.push({ at: this.now().toISOString(), kind, detail, ...snapshot(game) });
    } else doc.omittedEvents++;
    this._save(game, immediate);
  }

  /** 保存の予約。immediate なら今すぐ、でなければ最初の予約から saveDelayMs 以内にまとめて保存する（延ばし続けない） */
  _save(game, immediate = false) {
    this._game = game; this._dirty = true;
    if (immediate || !this._setTimer || !(this.saveDelayMs > 0)) { this._commit(); return; }
    if (this._timer === null) this._timer = this._setTimer(() => { this._timer = null; this._commit(); }, this.saveDelayMs);
  }

  _commit() {
    if (this._timer !== null) { this._clearTimer?.(this._timer); this._timer = null; }
    if (!this._dirty || !this.active) return;
    this._dirty = false;
    const game = this._game, doc = this.active;
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
    const keepalive = this._keepalive;   // ページを離れる間際の送信（本文が64KBを超えると keepalive は使えないので、その場合は localStorage の再送に任せる）
    this.queue = this.queue.then(async () => {
      if (!this.transport) return;
      try {
        const body = JSON.stringify(doc);
        const response = await this.transport(this.endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body, ...(keepalive && body.length < 60000 ? { keepalive: true } : {}),
        });
        if (!response.ok) return;
        await response.text();
        if (this.pending[doc.playId]?.revision === doc.revision) {
          delete this.pending[doc.playId]; this._persist();
        }
      } catch { /* localStorage の最新スナップショットを次回起動で再送 */ }
    });
  }

  flush() { this._commit(); return this.queue; }
}
