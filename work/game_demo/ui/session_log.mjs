// セッション記録（JSONL）と今日の記録。ブラウザにはファイルシステムが無いので sink を差し替え可能にする。
//  既定 sink: ① POST /api/medal-log （ui/serve.mjs が受けて ui/logs/*.jsonl に追記）→ 失敗時 ② localStorage のリング(最新2000行)
// QA(?qa)では記録しない。

const LS_KEY = 'medal-session-log', LS_MAX = 2000;
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
// 11/1 不具合修正：送信が1回でも失敗すると httpOk が二度と戻らず、以後の全記録行で localStorage の最大2000行を JSON.parse→push→JSON.stringify→setItem（同期・数ms〜十数ms）していた
// （連打で毎秒数行 → 客が増えて行が溜まるほど重くなる）。①リング（最新2000行）はメモリに持ち、localStorage への書き出しは 2 秒に 1 回にまとめる（pagehide／非表示では即書く）
// ②送信は失敗から 10 秒たったら再挑戦する（成功すれば通常に戻る）。?logcap=0 で従来。
const CAP = (() => { try { return new URLSearchParams(globalThis.location?.search ?? '').get('logcap') !== '0'; } catch { return true; } })();
const RETRY_MS = 10000, FLUSH_MS = 2000;

export class SessionLog {
  constructor({ sink = null, enabled = true, endpoint = '/api/medal-log' } = {}) {
    this.enabled = enabled; this.endpoint = endpoint; this.sink = sink; this.id = null; this.lines = []; this.httpOk = true;
    this.queue = Promise.resolve(); this.stats = { httpWrites:0,httpFailures:0,localWrites:0,pending:0 };
    this.retryAt = 0; this.ring = null; this.ringTimer = null;
    if (CAP) safe(() => { const leave = () => this._flushRing(); globalThis.addEventListener?.('pagehide', leave); globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document.visibilityState === 'hidden') leave(); }); });
  }
  start(rules, { kind = 'simulation', playId = null } = {}) {
    this.id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}-${Math.random().toString(16).slice(2, 10)}`;
    this.write('start', { rules, kind, playId, creditInput: kind === 'human' ? 'ESP32 or operator input' : 'PC simulation' });
  }
  /** game: MedalGame（台帳のスナップショットを一緒に残す） */
  write(kind, detail, game = null) {
    if (!this.enabled) return;
    const row = { session: this.id, kind, detail, at: new Date().toISOString() };
    if (game) Object.assign(row, { wallet: game.wallet, purchased: game.purchased, won: game.won, spent: game.spent, secondsLeft: +game.secondsLeft.toFixed(2), lamps: game.lamps, attempts: game.attempts, successes: game.successes });
    this.lines.push(row);
    if (this.lines.length > LS_MAX) this.lines.splice(0, this.lines.length - LS_MAX);
    if (this.sink) { safe(() => this.sink(row)); return; }
    if (typeof fetch === 'function') {
      this.stats.pending++;
      this.queue = this.queue.then(async () => {
        try {
          if (!this.httpOk && !(CAP && Date.now() >= this.retryAt)) { this._ls(row); return; }
          const r = await fetch(this.endpoint, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(row) });
          if (!r.ok) throw new Error(r.status);
          await r.text(); // 応答を読み切ってから次の行を送る。
          this.stats.httpWrites++; this.httpOk = true;
        } catch { this.httpOk = false; this.retryAt = Date.now() + RETRY_MS; this.stats.httpFailures++; this._ls(row); }
        finally { this.stats.pending--; }
      });
    } else this._ls(row);
  }
  _flushRing() {
    if (this.ringTimer !== null) { clearTimeout(this.ringTimer); this.ringTimer = null; }
    if (this.ring) safe(() => localStorage.setItem(LS_KEY, JSON.stringify(this.ring)));
  }
  _ls(row) {
    this.stats.localWrites++;
    if (CAP) {
      if (!this.ring) this.ring = safe(() => JSON.parse(localStorage.getItem(LS_KEY) || '[]'), []);
      this.ring.push(row); if (this.ring.length > LS_MAX) this.ring.splice(0, this.ring.length - LS_MAX);
      if (this.ringTimer === null) this.ringTimer = setTimeout(() => { this.ringTimer = null; this._flushRing(); }, FLUSH_MS);
      return;
    }
    safe(() => {
      const cur = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); cur.push(row);
      localStorage.setItem(LS_KEY, JSON.stringify(cur.slice(-LS_MAX)));
    });
  }
  flush() { this._flushRing(); return this.queue; }
  /** 手動回収用: localStorage に溜まった記録を JSONL で取り出す。 */
  static exportJsonl() { return safe(() => JSON.parse(localStorage.getItem(LS_KEY) || '[]').map((r) => JSON.stringify(r)).join('\n'), ''); }
}

/** 今日の記録（来場者の自己ベスト表示用）。日付ごとに localStorage へ。 */
export class Records {
  static key(d = new Date()) { return `medal-records-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
  static load(enabled = true) {
    if (!enabled) return null;
    return safe(() => JSON.parse(localStorage.getItem(Records.key()) || 'null'), null);
  }
  /** 結果確定時に1回。以前のプレイの最高値だけを表示に使う(今のプレイは含めない)ため、呼出し前の load() を表示に使う。 */
  static save(game, enabled = true) {
    if (!enabled) return null;
    const r = Records.load() ?? { todayBestWallet: 0, todayBestAward: 0, todayMaxLamps: 0, plays: 0 };
    const next = { todayBestWallet: Math.max(r.todayBestWallet, game.wallet), todayBestAward: Math.max(r.todayBestAward, game.bestAward), todayMaxLamps: Math.max(r.todayMaxLamps, game.maxLamps), plays: r.plays + 1 };
    safe(() => localStorage.setItem(Records.key(), JSON.stringify(next)));
    return next;
  }
}
