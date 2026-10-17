/* 演出の窓口(ゲーム側が使う1つの入口)。光バス(Director)と液晶(LCD)をまとめる。
 *
 *   const fx = new Effects({ events, geom });            // events.json / geometry.json を読んだもの
 *   await fx.initLcd({ root: '/' });                      // 液晶を使うとき(ブラウザ)。省略可(光だけ動く)
 *   fx.setState({ n, litPockets:[1,3], canLaunch, declared, first:{...}, hold, sec });
 *   fx.notify('lamp123', { pocket: 3 });                  // ゲームの出来事(events.json の id)
 *   const f = fx.frame(dt);                               // 毎フレーム。光の値と液晶キャンバスを返す
 *   f.petal  Float32Array(45*3)  花びら45区画の線形RGB(強さ込み)
 *   f.edge   {base:{amount,speed}, mul[24], add[72], ovr[72], ovrA[24]}  縁LED(虹Bの上に乗算→上書き→加算)
 *   f.logo [r,g,b]  f.pocket Float32Array(7*3)  f.btn [Lr,Lg,Lb,Rr,Rg,Rb]  f.seg {meter[5],blink}
 *   f.cues  この1フレームで始まった合図(tray/seg/snd など。皿の玉や7セグの動きはゲーム側が受ける)
 *   f.lcd   液晶キャンバス(1280x720)。ゲームは毎フレームこれをテクスチャへ貼る
 */
(function (root) {
  'use strict';
  const LB = root.LightBus || (typeof require !== 'undefined' ? require('./lightbus.js') : null);
  class Effects {
    constructor({ events, geom, seed = 1 }) {
      this.dir = new LB.Director({ events, geom, seed });
      this.events = events; this.lcdOk = false;
      // 重複ルーレット+昇天の目標秒(消える前の灯数別。調整担当の確定表: 1〜3灯は0.5秒だけ操作を止め、昇天は液晶で約3秒続く(操作は可能)、4灯6秒、5灯12秒で時計停止)
      this.rouletteTargets = { 1: 1.4, 2: 1.5, 3: 2.1, 4: 6, 5: 12 };   // 調整担当メモ(10/17): 1〜2灯1.0〜1.5s, 3灯1.5〜2.2s, 4灯6s, 5灯12s
       this.first = {}; this.tutorial = true;
      this.setState({ n: 0, litPockets: [], canLaunch: true, declared: false, first: { firstShot: false, firstDeclare: false } });
    }
    async initLcd(opt = {}) {
      if (!root.LCD) return false;
      try {
        if (root.LCD.loadScenes) await root.LCD.loadScenes(opt.root || '/');
        await root.LCD.init(opt); this.lcdOk = true;
      } catch (e) { console.warn('LCD init failed', e); }
      return this.lcdOk;
    }
    get clockStats() { return this._cs || (this._cs = { total: 0, byReason: {} }); }
    set clockStats(v) { this._cs = v; }
    setState(s) {
      const d = this.dir;
      if (s.n !== undefined) { d.state.n = s.n; d.state.lastN = s.n; }
      if (s.litPockets) d.state.litPockets = s.litPockets;
      if (s.canLaunch !== undefined) d.state.canLaunch = s.canLaunch;
      if (s.declared !== undefined) d.state.declared = s.declared;
      if (s.rank !== undefined) d.state.rank = s.rank;
      if (s.first) { this.first = { ...this.first, ...s.first }; d.state.tut = this.tutorial ? { firstShot: !!this.first.firstShot, firstDeclare: !!this.first.firstDeclare } : { firstShot: true, firstDeclare: true }; }
      if (this.lcdOk) root.LCD.setState({ hold: s.hold, sec: s.sec, rank: s.rank, ...(s.rules ? { rules: s.rules } : {}) });   // rules: {loanBalls, extraSeconds, thresholds, jackpotAwards}
    }
    // ゲームの出来事を通知。params: payout,k,n_from,rank,pocket,total,reason,first
    // 払い出し(ticket)が終わるまで「スタート!」を出さない(チケット→GET→皿が満ちる→スタート。点検 △11)。上限6秒で出す
    _ticketBusy() {
      const th = this._trayHandle;
      return this.dir.inst.some((x) => x.id === 'ticket') || !!(th && this._trayPay && th.done && !th.done());
    }
    notify(id, params = {}) {
      if (id === 'start' && !params.__late && this._ticketBusy()) { this._pendingStart = { params, t: this.dir.t }; return; }
      const d = this.dir;
      const M = this.lcdOk && root.LCD.mono && root.LCD.mono.ready ? root.LCD.mono : null;
      // 毎球の演出は短い版で出す(調整側の尺の上限: 入賞0.6s/重複0.3s/5〜6灯1.5s)。初回(first)だけ説明つきの通常の長さ。
      const k = Effects.COMPACT[id]; if (k && !params.first && params.scale === undefined) params = Object.assign({}, params, { scale: k });
      if (id === 'ticket') this._tutDone = {}; if (id === 'ticket') this.clockStats = { total: 0, byReason: {} };
      if (id === 'ascend' && M) return -1;              // 昇天は液晶(既存の演出)が始めた瞬間に光バスが自動で始める
      if (id === 'roulette') {                           // 賭けた灯数に応じた短縮版: 少ない灯は短く、多い灯は全編
        const n = params.n_from || d.state.lastN || 3, k = params.k === 'all' ? n : (params.k || 1);
        const natural = 12.75 + .38 * (Math.max(1, Math.min(3, k)) - 1);
        const want = params.target || this.rouletteTargets[Math.max(1, Math.min(5, n))];
        const rate = params.rate || (want ? Math.max(1, natural / want) : 1);
        params = Object.assign({}, params, { rate, scale: 1 / rate });
        this._asc = false; this._k = params.k; this._rate = rate; this._block = n >= 4;   // 時計を止めるのは4灯以上
      }
      if (this.lcdOk) {                                  // 残り時間(右上)は start から timeup/結果まで常設
        if (id === 'start' || id === 'add100') root.LCD.setState({ hudOn: true });
        else if (['attract', 'title', 'howto', 'ticket', 'timeup', 'finish_count', 'result'].includes(id)) root.LCD.setState({ hudOn: false });
      }
      if (params.hit !== undefined) d.state.hitPocket = params.hit;
      if (params.target !== undefined) d.state.targetPocket = params.target;
      if ((id === 'howto' || id === 'ticket' || id === 'start') && this.lcdOk) { this.stop('title'); this.stop('attract'); }   // 入口の待機画面は、遊技が始まったら止める
      if (id === 'ticket' && this.lcdOk) this.stop('howto');   // ルール説明を飛ばした時も、チケットへすぐ移る
      if (this.lcdOk && this.tutorial) {                 // 初見向けのヒント(1セッション1回)
        const f = this.first;
        if (id === 'start' && !f.firstShot) root.LCD.play('tut_launch');
        if (id === 'launch') root.LCD.stop('tut_launch');
        if (id === 'challenge_declare') root.LCD.stop('tut_challenge');
        // 初見向けの案内(各1回)。灯の演出が終わってから、液晶の下側に小さく出す。1つ出したら次の案内は前のが終わってから
        // 案内は別の演出(同じ穴・ルーレット・4灯以上・勝負・結果)が割り込んだら引っ込める。遅れて出る予定のものは取り消し、次の機会にもう一度出す
        const SUPER = ['dup_protect', 'roulette', 'lamp4', 'lamp5', 'lamp6', 'challenge_declare', 'success_small', 'success_big', 'jp', 'fail', 'timeup', 'finish_count', 'result', 'add100'];
        if (SUPER.includes(id)) { this._tutGen = (this._tutGen || 0) + 1; for (const tid of ['tut_first_lamp', 'tut_challenge', 'tut_lamp4']) root.LCD.stop(tid); if (this._tutDone) { this._tutDone.lamp = false; } }
        const T = this._tutDone || (this._tutDone = {}), lit = d.state.n, gen = this._tutGen || 0, at = (dly, tid, pp, key) => this._later(dly, () => { if ((this._tutGen || 0) !== gen) { if (key) T[key] = false; return; } root.LCD.play(tid, pp || {}); });
        if (id === 'lamp123' && !T.lamp) { T.lamp = true; at(2.5, 'tut_first_lamp', { pocket: params.pocket }, 'lamp'); }
        if (id === 'lamp123' && lit >= 1 && !T.chal) {   // 勝負の案内は1灯目から(序盤で成功まで届かない客を減らす)。1灯目は最初の灯の案内(約9秒)のあとに出す
          T.chal = true; const dly = lit === 1 ? 9.4 : (T.lamp && lit === 2 && this._tutLampT > d.t - 7 ? 7.2 : 2.6);
          this._later(dly, () => { if (!d.state.declared) root.LCD.play('tut_challenge', {}); });
        }
        if (id === 'lamp123') this._tutLampT = d.t;
        if (id === 'lamp4' && !T.l4) { T.l4 = true; at(3.8, 'tut_lamp4', {}, 'l4'); }
        if (id === 'dup_protect' && !T.dup) { T.dup = true; }
      }
      // 勝負の暗い液晶・赤い花びらは、宣言(1.6秒)のあとも発射して入賞するまで保つ。結果が出たら外す。
      if (['success_small', 'success_big', 'jp', 'fail', 'lamp123', 'lamp4', 'lamp5', 'lamp6', 'dup_protect', 'roulette', 'challenge_cancel', 'timeup', 'finish_count', 'result', 'attract', 'ticket'].includes(id)) this.stop('challenge_flight');
      // 6灯は次の1球が自動でJPチャンス(ゲーム側は armed のまま宣言の合図を出さない)。灯の演出(JPチャンスの知らせ)のあと、自分で宣言を出して暗い液晶・赤い花びらの保持へつなぐ
      if (id === 'lamp6') this._later(3.3, () => { if (d.state.declared && !d.isActive('challenge_declare') && !d.isActive('challenge_flight')) this.notify('challenge_declare', { jp: true }); });
      if (id === 'challenge_flight') {
        if (d.isActive('challenge_flight')) return -1;   // 宣言の続きで既に出ている。発射の合図で作り直さない
        params = Object.assign({}, params, { once: false });
      }
      if (id === 'jp' && params.scale === undefined) {   // JPの実時間=ゲームのJP演出の全尺(receipt.duration、無ければ段ごとの既定)。基準は20秒
        const tbl = [14, 16, 20, 24, 28], full = params.duration > 0 ? params.duration : tbl[Math.max(0, Math.min(4, params.tier ?? 2))];
        params = Object.assign({}, params, { scale: full / 20 });
      }
      if (id === 'challenge_declare') this._later(1.6, () => { if (d.state.declared && !d.isActive('challenge_flight')) this.notify('challenge_flight', { jp: d.state.n >= 6, armed: true }); });
      if (id === 'challenge_declare' && d.state.n >= 6) params = Object.assign({}, params, { jp: true });   // 6灯の勝負は『JPチャンス』
      return d.start(id, Object.assign({ once: true }, params));
    }
    // ゲームの時計を止める区間(JP・重複ルーレット+昇天)。true の間、残り秒を進めない
    // ゲームの時計を止める区間。止めるのは「合図の瞬間」だけで、余韻や数え上げ・皿の注ぎは時計を動かしたまま(調整側の予算)。
    //   Effects.CLOCK_STOP = { イベントid: 止める秒(イベント開始から) }。roulette/ascend は4灯以上のとき全編。
    clockStopped() { return !!this.clockStopReason(); }
    // 1セッション内の累積。ticket(開始)で0に戻る。追加100円をまたいで数える。
    clockStopStats() { const S = this.clockStats; return { total: +S.total.toFixed(3), byReason: Object.fromEntries(Object.entries(S.byReason).map(([k, v]) => [k, +v.toFixed(3)])) }; }
    clockStopReason() {
      const d = this.dir, a = this._last ? this._last.active : [];
      if (this._block && (a.includes('roulette') || a.includes('ascend'))) return a.includes('ascend') ? 'ascend' : 'roulette';
      for (const inst of d.inst) { const lim = Effects.CLOCK_STOP[inst.id]; if (lim === undefined) continue; if ((d.t - inst.t0) / inst.scale < lim) return inst.id; }
      return null;
    }
    _later(dly, fn) { (this._laterQ || (this._laterQ = [])).push({ at: this.dir.t + dly, fn }); }
    stop(id) { this.dir.stop(id); if (this.lcdOk) root.LCD.stop(id); }
    // 皿の玉(実球・物理)の払い出し/回収は調整側の関数を呼ぶだけ。演出側は玉を作らない。
    //   h = { award(count, {eventId, duration, rate, origin}) -> handle?, collect({eventId, duration}) -> handle? }
    //   handle は任意: landed() = 皿に着いた玉の数(液晶の数字をこれに合わせる)、done() = 払い出し完了
    setTray(h) { this.trayHandler = h || null; this._trayHandle = null; }
    _trayCue(c) {
      const h = this.trayHandler, p = c.p || {}, par = c.params || {}, dur = Math.max(.1, (c.t1 - c.t0) || 1);
      const R = this.lcdOk ? root.LCD.rules() : {};
      let n = typeof p.n === 'number' ? p.n : Number(par.payout ?? par.total ?? 0) || 0;
      if (c.event === 'ticket' || c.event === 'add100') n = R.loanBalls || n;     // 払い出し数は規則から
      this.trayLog = (this.trayLog || []).concat([{ pat: c.pat, event: c.event, n, dur }]).slice(-20);
      if (!h) return;
      try {
        if (c.pat === 'payout' && h.award) this._trayHandle = h.award(n, { eventId: c.event, duration: dur, rate: n / dur, origin: 'payoutPort' }) || null;
        else if (c.pat === 'collect' && h.collect) this._trayHandle = h.collect({ eventId: c.event, duration: dur }) || null;
        this._trayTotal = n; this._trayPay = c.pat === 'payout';
      } catch (e) { console.warn('tray handler', e.message); }
    }
    frame(dt) {
      if (this._pendingStart && (!this._ticketBusy() || this.dir.t - this._pendingStart.t > 6)) { const q = this._pendingStart; this._pendingStart = null; this.notify('start', Object.assign({}, q.params, { __late: true })); }
      const F = this.dir.step(dt); this._last = F;
      if (this._laterQ && this._laterQ.length) { const due = this._laterQ.filter((q) => q.at <= this.dir.t); this._laterQ = this._laterQ.filter((q) => q.at > this.dir.t); for (const q of due) { try { q.fn(); } catch (e) { console.warn('later', e.message); } } }
      { const why = this.clockStopReason(); if (why) { const S = this.clockStats; S.total += dt; S.byReason[why] = (S.byReason[why] || 0) + dt; } }   // 止めた累積秒(最終検証用)
      for (const c of F.cues) if (c.lane === 'tray') this._trayCue(c);   // 液晶が無くても皿の合図は出す
      if (this.lcdOk) {
        const M = root.LCD.mono;                           // 既存の重複ルーレットの針・昇天の合図を光へ渡す
        this.dir.state.needle = M && M.kind === 'roulette' && M.needle != null ? M.needle : null;
        if (M && M.phase === 'ascend' && !this._asc) { this._asc = true; this.dir.start('ascend', { once: true, k: this._k, scale: 1 / (this._rate || 1) }); }
        const th = this._trayHandle;                       // 皿に着いた玉の数 → 液晶の数字
        if (th && th.landed) { root.LCD.setState({ trayLanded: th.landed() }); if (th.done && th.done()) this._trayHandle = null; } else if (root.LCD.state.trayLanded !== undefined) root.LCD.setState({ trayLanded: undefined });
        for (const c of F.cues) if (c.lane === 'lcd' && root.LCD.defs[c.event] && !(Effects.QUIET.has(c.event) && c.scale < 1)) root.LCD.cue(c);   // 毎球の入賞/重複は、液晶を占有せず光と通常画面のウパだけ(初回は説明つきで全編)   // 液晶シーンの無いイベント(ambient等)は土台のまま
        root.LCD.setState({ n: F.n, nDisp: F.nDisp }); root.LCD.update(dt); root.LCD.render(null, 0, 0);
        F.lcd = root.LCD.cv;
      }
      return F;
    }
  }
  Effects.CLOCK_STOP = { jp: 20, lamp4: .8, success_big: 2.5 };   // 調整側と合意(10/17): JPは最初の11s、4灯は合図0.8s、大成功はリセット側2.5sまで。howto はゲーム側(ctrl.howtoSeconds)が時計に含めない   // 調整側と合意(10/17): JPは最初の11s、4灯は合図0.8s、大成功はリセット側2.5sまで
  Effects.QUIET = new Set(['lamp123', 'dup_protect']);
  Effects.COMPACT = { lamp123: .42, dup_protect: .4, lamp4: .73, lamp5: .6, lamp6: .75, fail: .7 };   // 映像の長さの倍率(2.6s→1.1s, 1.4s→0.56s, 4.1→3.0s, 3.4→2.0s, 3.7→2.8s)。調整担当メモの最短〜最長に収める
  if (typeof module !== 'undefined' && module.exports) module.exports = Effects; else root.Effects = Effects;
})(typeof globalThis !== 'undefined' ? globalThis : this);
