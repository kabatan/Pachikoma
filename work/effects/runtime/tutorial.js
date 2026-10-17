/* 初見向けヒントの判定と「済み」の記録(R2-TU)。effects.js の notify から1行で呼ばれる:
 *     if (this.lcdOk && this.tutorial && root.Tutorial) root.Tutorial.notify(this, id, params);
 * 設計は work/effects/r2/tutorial/DESIGN.md。
 *
 * 約束:
 *   ・各ヒントは1セッション1回。出した時点で「済み」。主役の演出に消されても出し直さない。
 *     ただし読めた秒数が MIN_SEEN 未満(ほとんど見えていない)なら、次の機会に1回だけ出し直す。
 *   ・ヒントは同時に1つ。優先順で並べ、前のが終わって GAP 秒あけてから次を出す。
 *   ・主役の演出(SUPER)が来たら、まだ出ていない予約は取り消し(次の機会に回す)、出ているものは畳む。
 *   ・字幕は液晶の左下のレーン(b_tutorial.js の LCD.tut.LANE)。穴・ボタンを指すのは盤面側のLED:
 *     fx.hint(name, params) があれば呼ぶ(R2-E の呼び出し口。無ければ何もしない)。
 *   ・ticket(開始)でセッションごとの記録を初期化する。
 * 状態は effects インスタンスの _tut(テストから fx._tut で読める)。 */
(function (root) {
  'use strict';
  const SUPER = ['dup_protect', 'roulette', 'lamp4', 'lamp5', 'lamp6', 'success_small', 'success_big', 'jp', 'fail', 'timeup', 'finish_count', 'result', 'add100', 'challenge_cancel'];
  const SCENE = { goal: 'tut_goal', lamp: 'tut_first_lamp', aim: 'tut_aim', dup: 'tut_dup1', chal: 'tut_challenge', win: 'tut_win', lose: 'tut_lose', l4: 'tut_lamp4', roul: 'tut_roul', end: 'tut_end' };
  const PRIO = ['dup', 'win', 'lose', 'lamp', 'goal', 'aim', 'chal', 'roul', 'l4', 'end'];   // 同時に待っていたら、前にあるものから出す
  const DUR = { goal: 2.8, lamp: 2.2, aim: 2.8, dup: 2.6, chal: 3.6, win: 2.6, lose: 3.2, l4: 2.8, roul: 3.0, end: 3.4 };
  const GAP = 0.7;            // ヒントとヒントの間(読む間)
  const MIN_SEEN = 1.2;       // これ未満しか読めていなければ1回だけ出し直す
  const WAIT = { default: 6, win: 14, lose: 14, l4: 10, roul: 24, goal: 16 };   // 主役に譲って待つ上限(超えたら予約を落として次の機会に回す)

  const fresh = () => ({ gen: 0, state: {}, retried: {}, queue: [], nextOk: 0, log: [] });
  const Tutorial = {
    SUPER, SCENE, DUR,
    state(fx) { return fx._tut || (fx._tut = fresh()); },
    _active() { const L = root.LCD; return L && L.active && L.tut ? L.active.filter((s) => L.tut.HINTS.includes(s.id)) : []; },
    _busy() { const L = root.LCD; return !!(L && L.active && L.tut && L.active.some((s) => L.tut.MAIN.test(s.id))); },
    // 盤面のLED(R2-E の口)。無ければ何もしない
    _led(fx, name, p) { try { if (typeof fx.hint === 'function') fx.hint(name, p || {}); } catch (e) { /* LED の失敗で字幕を止めない */ } },
    // 主役が来た: 予約を取り消し、出ているヒントを畳む。読めた秒数が少ないものは「未済」に戻す(1回だけ)
    _cancel(fx, T) {
      T.gen++;
      for (const q of T.queue) if (T.state[q.key] === 'queued') T.state[q.key] = false;
      T.queue = [];
      const L = root.LCD;
      for (const sc of this._active()) {
        if (sc.id === 'tut_launch') continue;
        const key = Object.keys(SCENE).find((k) => SCENE[k] === sc.id);
        if (key && sc.rec && sc.rec.vis < MIN_SEEN && !T.retried[key]) { T.retried[key] = true; T.state[key] = false; }
        L.stop(sc.uid);
      }
      this._led(fx, 'clear');
    },
    // key のヒントを、いまから after 秒後以降に出す予約をする
    offer(fx, key, after, params) {
      const T = this.state(fx);
      if (T.state[key]) return false;   // queued / shown
      T.state[key] = 'queued';
      T.queue.push({ key, params: params || {}, due: fx.dir.t + after, expire: fx.dir.t + after + (WAIT[key] || WAIT.default), gen: T.gen });
      T.queue.sort((a, b) => PRIO.indexOf(a.key) - PRIO.indexOf(b.key));
      this._arm(fx, after);
      return true;
    },
    _arm(fx, dly) {
      const T = this.state(fx), gen = T.gen;
      fx._later(Math.max(.05, dly), () => this._pump(fx, gen), 'game');
    },
    _pump(fx, gen) {
      const T = this.state(fx);
      if (gen !== T.gen || fx._ended() || !T.queue.length) return;
      const now = fx.dir.t, st = fx.dir.state;
      T.queue = T.queue.filter((q) => { if (now > q.expire) { T.state[q.key] = false; return false; } return true; });   // 期限切れは次の機会に
      const q = T.queue.find((x) => now >= x.due);
      if (!q) { if (T.queue.length) this._arm(fx, Math.min(...T.queue.map((x) => x.due)) - now); return; }
      const wait = this._active().some((s) => s.id !== 'tut_launch') || this._busy() || now < T.nextOk;
      if (wait) { this._arm(fx, .3); return; }
      T.queue.splice(T.queue.indexOf(q), 1);
      // 条件が変わっていたら出さない(次の機会に回す)
      const skip = ((q.key === 'chal' || q.key === 'aim') && (st.declared || st.n >= 6)) || (q.key === 'chal' && st.n < 2);
      if (skip) { T.state[q.key] = false; if (T.queue.length) this._arm(fx, .05); return; }
      const p = Object.assign({}, q.params);
      if (q.key === 'aim') { p.lamps = (st.litPockets || []).slice(); this._led(fx, 'holes', { mode: 'soft', pockets: 'unlit', secs: DUR.aim }); }
      if (q.key === 'chal') this._led(fx, 'button', { side: 'right', secs: DUR.chal });
      T.state[q.key] = 'shown'; T.nextOk = now + DUR[q.key] + GAP;
      T.log.push({ t: +now.toFixed(2), key: q.key });
      root.LCD.play(SCENE[q.key], p);
      if (T.queue.length) this._arm(fx, DUR[q.key] + GAP);
    },
    // 途中の字幕は出さない(監督判断: 演出に隠れて読めない)。盤面のLEDだけ:
    //   最初の数球 … 光っていない穴の淡い呼吸(狙いの促し) / 勝負できる間 … 右ボタンの呼吸 / 勝負中 … 光っていない穴を点灯
    notify(fx, id, params) {
      const L = root.LCD; if (!L) return;
      if (id === 'ticket') { fx._tut = fresh(); return; }
      const T = this.state(fx), d = fx.dir, f = fx.first || {}, st = d.state;
      if (id === 'start') { T.led = { aim: 0, btn: 0 }; if (!f.firstShot && !T.launched) this._later_launch(fx, T); }
      if (id === 'launch') { if (!T.launched) this._led(fx, 'clear'); T.launched = true; L.stop('tut_launch'); }
      if (SUPER.includes(id)) this._cancel(fx, T);
      const led = T.led || (T.led = { aim: 0, btn: 0 });
      if (id === 'lamp123') {
        if (st.n < 2 && led.aim < 3) { led.aim++; fx._later(1.2, () => { if (!fx._ended() && !st.declared) this._led(fx, 'holes', { mode: 'soft', pockets: 'unlit', secs: 2.6 }); }, 'game'); }
        if (st.n >= 2 && led.btn < 4) { led.btn++; fx._later(1.5, () => { if (!fx._ended() && !st.declared) this._led(fx, 'button', { side: 'right', secs: 5 }); }, 'game'); }
      }
      if (id === 'challenge_declare') { this._led(fx, 'clear'); this._led(fx, 'holes', { mode: 'steady', pockets: 'unlit', secs: 0 }); }
    },
    // スタート!の後に左ボタンの案内。goal が先に出る間は少し待つ
    _later_launch(fx, T) {
      const gen = T.gen;
      fx._later(2.4 + DUR.goal + GAP, () => { const L = root.LCD; if (T.launched || (fx.first || {}).firstShot || fx._ended()) return; if (!L.active.some((s) => s.id === 'tut_launch')) { L.play('tut_launch'); this._led(fx, 'button', { side: 'left', secs: 0 }); } }, 'game');
    },
  };
  root.Tutorial = Tutorial;
  if (typeof module !== 'undefined') module.exports = Tutorial;
})(typeof window !== 'undefined' ? window : globalThis);
