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
      this.rouletteTargets = { 1: 3.0, 2: 3.2, 3: 3.4, 4: 4.5, 5: 6 };   // 1〜3灯は再生倍率が高いと開始の山で33msを超える(最適化担当の実測: 倍率8.5→63ms, 2.1→9ms)ため約3秒。操作ロック(0.5秒)はこの長さに関係しない。4灯6秒、5灯12秒
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
      return this.dir.inst.some((x) => x.id === 'ticket' || x.id === 'add100') || !!(th && this._trayPay && th.done && !th.done());
    }
    // ───── 演出の管制(R2-E): 液晶の「見せ場」の割り込みを整理する ─────
    // 灯4/5/6・ルーレットは同じ映像(iframe 1個)を使うので、新しい着地が来ると古い場面は一瞬で消えていた。
    //   ・光(盤・花びら・口)と数字は着地した瞬間に必ず出す(真実の層)。液晶の見せ場(見せ場の層)だけ、着地の順に並べ、いま出ている場面が最低表示時間に届くまで待たせる。
    //   ・待ちは1件あたり最大 GATE_MAXWAIT 秒(超えたら前の場面を畳んで次へ)。
    //   ・遅れて動く予約(_later)は、ゲームが終わる/新しく始まる/タグが失効したら取り消す。
    _monoActive() { const L = root.LCD; return L && L.active ? L.active.filter((s) => Effects.MONO[s.id]) : []; }
    _claim(id, uid) {
      if (!Effects.MONO[id] || id === 'lamp123') return; const q = (this._claims || (this._claims = [])), lv = Effects.LADDER[id];
      // まだ液晶の合図が来ていない前の灯(4灯の液晶は着地の約0.5秒後に始まる)があれば、その段から駆け上がる表示にする(前の灯の光と数字は出ている)
      let fromLv = 0; if (lv) for (const x of q) if (Effects.LADDER[x.id] && Effects.LADDER[x.id] < lv && this.dir.t - x.t < 1.6) fromLv = Math.max(fromLv, Effects.LADDER[x.id]);
      q.push({ id, uid, t: this.dir.t, fromLv }); while (q.length > 8) q.shift();
    }
    _gateCue(c) {
      const L = root.LCD, M = Effects.MONO[c.event];
      if (!M) { L.cue(c); return; }
      this._gq = this._gq || []; this.gateLog = this.gateLog || [];
      if (L.seen.has(c.uid + ':' + c.event)) return;   // 同じ実行の次の区間の合図(場面はもう始まっている)
      if (this._gq.some((x) => x.cue.uid === c.uid && x.cue.event === c.event)) return;   // 待っている最中
      const claim = (this._claims || []).find((x) => x.uid === c.uid);
      this._gq.push({ cue: c, rank: M.rank, claimT: claim ? claim.t : this.dir.t, t0: this.dir.t });
      this._gq.sort((a, b) => a.claimT - b.claimT);
      this._gateStep();
    }
    _gateStep() {
      const q = this._gq; if (!q || !q.length) return;
      const now = this.dir.t, head = q[0], inc = this._monoActive();
      const LAD = Effects.LADDER, toLv = LAD[head.cue.event];
      // 灯が続けて増える時(4→5→6)は、前の灯の場面を短い最低表示(LADDER_MIN)で次へ進め、上に「4灯→5灯!」の段階表示を重ねる(切れずに駆け上がる)
      // ルーレットは3枠まで並走(2球目以降を待たせない)。ルーレットの合図は、ほかの場面(灯4など)にだけ道を譲らせ、すでに回っているルーレットは止めない。枠が3つ埋まっていたら最大 GATE_MAXWAIT 秒待ち、液晶側が結果の出終わった枠(無ければ最古)を畳む
      const isRl = head.cue.event === 'roulette', LM = root.LCD.mono, rlBusy = isRl && LM && LM.rlPending ? LM.rlPending() >= 3 : false;
      const incW = isRl ? inc.filter((s) => s.id !== 'roulette') : inc;
      const left = rlBusy ? 1 : incW.reduce((w, s) => Math.max(w, (toLv && LAD[s.id] && LAD[s.id] < toLv ? Effects.LADDER_MIN : Effects.MONO[s.id].min) - s.t * s.scale), 0);
      // 先に着地して、まだ液晶の合図が来ていない場面(灯4は着地の約0.5秒後に始まる)があれば、その順を守って待つ(最大 GATE_MAXWAIT 秒)
      const early = (this._claims || []).some((x) => x.t < head.claimT - 1e-6 && now - x.t < Effects.GATE_MAXWAIT && this.dir.inst.some((i) => i.uid === x.uid) && !root.LCD.seen.has(x.uid + ':' + x.id));
      if (!early && head.tClear === undefined) head.tClear = now;   // 先に着地した場面の合図を待った時間は、待ちの上限に数えない
      const waited = now - Math.max(head.t0, head.tClear ?? now), forced = waited >= Effects.GATE_MAXWAIT;
      if ((left <= 0 && !early) || forced) {
        q.shift(); this.gateLog.push({ t: +now.toFixed(2), what: now - head.t0 > .02 ? 'play_after_wait' : 'play', ev: head.cue.event, waited: +(now - head.t0).toFixed(2), forced: forced && (left > 0 || early) });
        if (head.cue.event !== 'roulette' && inc.some((s) => s.id === 'roulette')) { this.dir.stop('roulette'); this.dir.stop('ascend'); }   // 違う場面が液晶のルーレットに代わったら、ルーレットの光も畳む
        const prev = toLv ? inc.filter((s) => LAD[s.id] && LAD[s.id] < toLv && s.t * s.scale < 3.2).sort((a, b) => LAD[b.id] - LAD[a.id])[0] : null;
        for (const s of incW) root.LCD.stop(s.uid);   // 同じ映像(iframe)を使う前の場面は片付ける。残すと隠れたまま毎フレーム映像を進め、3倍重くなっていた(R2-X 計測: lamp4+lamp5+roulette が同時に更新)
        root.LCD.cue(head.cue);
        const cl = (this._claims || []).find((x) => x.uid === head.cue.uid), fromLv = Math.max(prev ? LAD[prev.id] : 0, cl ? cl.fromLv : 0);
        if (toLv && fromLv) root.LCD.play('ladder', { from: fromLv, to: toLv });
      }
    }
    // 初見ヒントのLED(R2-TU): fx.hint('holes', {pockets:'unlit'|[..], mode:'soft'|'steady', secs}) / fx.hint('button', {side:'left'|'right', secs}) / fx.hint('clear')。
    // notify('hint_holes'|'hint_button'|'hint_clear') でも同じ。secs 0 は clear まで。液晶に穴やボタンの絵は出さない(盤面のLEDだけ)
    hint(name, p = {}) {
      const d = this.dir, S = d.state; name = String(name).replace(/^hint_/, '');
      if (name === 'clear') { S.hint = null; return; }
      const H = S.hint || (S.hint = {}), until = p.secs > 0 ? d.t + p.secs : 0;
      if (name === 'holes') H.holes = { pockets: p.pockets || 'unlit', mode: p.mode === 'steady' || p.mode === 'red' ? p.mode : 'soft', t0: d.t, until };
      else if (name === 'button') H.button = { side: p.side === 'right' ? 'right' : 'left', t0: d.t, until };
    }
    _clearLater(tag) { if (this._laterQ) this._laterQ = tag ? this._laterQ.filter((q) => q.tag !== tag) : []; }
    _ended() { return !!this._endedFlag; }

    notify(id, params = {}) {
      if (/^hint_/.test(id)) return this.hint(id, params);
      if (id === 'ticket') this.dir.state.hint = null;
      if (id === 'tray_overflow' && (this._ticketBusy() || this.dir.isActive('start') || this.dir.isActive('ticket'))) return -1;   // 払い出しの最中・スタート表示中は『皿のあふれ』を重ねない
      if (id === 'start' && !params.__late && this._ticketBusy()) { this._pendingStart = { params, t: this.dir.t }; return; }
      const d = this.dir;
      if (['timeup', 'finish_count', 'result', 'attract', 'title'].includes(id)) { this._endedFlag = true; this._clearLater('game'); this._gq = []; }
      if (['ticket', 'start', 'add100'].includes(id)) { this._endedFlag = false; this._clearLater('game'); }
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
        this._asc = false; this._k = k; this._rate = rate; this._block = n >= 4;   // 時計を止めるのは4灯以上
      }
      // 同時に複数の玉が落ちる時(最大3球・0.6秒間隔): 着地の演出は新しい着地を優先して上書きする。前の着地の演出(別の種類)は途中で畳み、1.0秒の山場を重ねない(調整担当メモ 10/17)
      // 同時に着地が続いた時: 光は新しい着地を優先して前の着地の光を畳む。液晶の場面は管制(_gateCue)が最低表示時間を守って順に出すので、ここでは液晶を止めない(以前はここで前の液晶を即座に消し、途中で切れた: R2-E 調査)
      const landingBurst = ['lamp123', 'dup_protect', 'lamp4', 'lamp5', 'lamp6', 'roulette', 'ascend'].includes(id);
      if (this.overlapLandingLights && landingBurst) params = Object.assign({}, params, {replace:false});
      if (!this.overlapLandingLights && ['lamp123', 'dup_protect', 'lamp4', 'lamp5'].includes(id)) for (const o of ['lamp123', 'dup_protect', 'lamp4', 'lamp5']) if (o !== id) this.dir.stop(o);
      if (this.lcdOk && ['lamp123', 'dup_protect', 'lamp4', 'lamp5', 'lamp6'].includes(id)) { root.LCD.stop('lamp123'); root.LCD.stop('dup_protect'); }   // 初回の説明つき『1灯』などは、次の着地で畳む(新しい灯の数と食い違う絵を残さない)。灯4以上の液晶は管制が順に出す
      if (this.lcdOk) {                                  // 残り時間(右上)は start から timeup/結果まで常設
        if (id === 'start' || id === 'add100') root.LCD.setState({ hudOn: true });
        if (id === 'add100') this._pendingStart = { params: { duration: 0 }, t: this.dir.t };   // 追加も ticket と同じ順: 玉が皿に注がれたあと「スタート!」(時計が動く)
        else if (['attract', 'title', 'howto', 'ticket', 'timeup', 'finish_count', 'result'].includes(id)) root.LCD.setState({ hudOn: false });
      }
      if (typeof params.rank === 'number') d.state.rank = params.rank;   // 結果・計数の光(ランク色)は、通知のランクで決める
      if (params.hit !== undefined) d.state.hitPocket = params.hit;
      if (params.target !== undefined) d.state.targetPocket = params.target;
      if ((id === 'howto' || id === 'ticket' || id === 'start') && this.lcdOk) { this.stop('title'); this.stop('attract'); }   // 入口の待機画面は、遊技が始まったら止める
      if (id === 'ticket' && this.lcdOk) this.stop('howto');   // ルール説明を飛ばした時も、チケットへすぐ移る
      if (this.lcdOk && this.tutorial && root.Tutorial) root.Tutorial.notify(this, id, params);   // 初見ヒント(判定と済みの記録は runtime/tutorial.js)
      // 勝負の暗い液晶・赤い花びらは、宣言(1.6秒)のあとも発射して入賞するまで保つ。結果が出たら外す。
      if ((!this.overlapLandingLights || !landingBurst) && ['success_small', 'success_big', 'jp', 'fail', 'lamp123', 'lamp4', 'lamp5', 'lamp6', 'dup_protect', 'roulette', 'challenge_cancel', 'timeup', 'finish_count', 'result', 'attract', 'ticket'].includes(id)) this.stop('challenge_flight');
      if (id === 'add100' || id === 'finish_count') this.stop('timeup');   // 継続の選択が済んだら、TIME UP の金の電飾(最大10秒)を続けない。追加後は ticket と同じ紺の盤に戻す
      // 6灯は次の1球が自動でJPチャンス(ゲーム側は armed のまま宣言の合図を出さない)。灯の演出(JPチャンスの知らせ)のあと、自分で宣言を出して暗い液晶・赤い花びらの保持へつなぐ
      if (id === 'lamp6') this._later(3.3, () => { if (!this._ended() && d.state.declared && !d.isActive('challenge_declare') && !d.isActive('challenge_flight')) this.notify('challenge_declare', { jp: true }); }, 'game');
      if (id === 'challenge_flight') {
        if (d.isActive('challenge_flight')) return -1;   // 宣言の続きで既に出ている。発射の合図で作り直さない
        params = Object.assign({}, params, { once: false });
      }
      if (id === 'jp' && params.scale === undefined) {   // JPの実時間=ゲームのJP演出の全尺(receipt.duration、無ければ段ごとの既定)。基準は20秒
        const tbl = [14, 16, 20, 24, 28], full = params.duration > 0 ? params.duration : tbl[Math.max(0, Math.min(4, params.tier ?? 2))];
        params = Object.assign({}, params, { scale: full / 20 });
      }
      if (id === 'challenge_declare') this._later(1.4, () => { if (!this._ended() && d.state.declared && !d.isActive('challenge_flight')) this.notify('challenge_flight', { jp: d.state.n >= 6, armed: true }); }, 'game');
      if (id === 'challenge_declare' && d.state.n >= 6) params = Object.assign({}, params, { jp: true });   // 6灯の勝負は『JPチャンス』
      if ((id === 'timeup_call' || id === 'offer_tick') && !d.events.has(id)) return -1;   // 音声・液晶だけの通知(電飾の定義なし)。警告を出さず何もしない
      const uid = d.start(id, Object.assign({ once: true }, params));
      this._claim(id, uid);
      return uid;
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
    _later(dly, fn, tag) { (this._laterQ || (this._laterQ = [])).push({ at: this.dir.t + dly, fn, tag }); }
    stop(id) { this.dir.stop(id); if (this.lcdOk) root.LCD.stop(id); }
    // 皿の玉(実球・物理)の払い出し/回収は調整側の関数を呼ぶだけ。演出側は玉を作らない。
    //   h = { award(count, {eventId, duration, rate, origin}) -> handle?, collect({eventId, duration}) -> handle? }
    //   handle は任意: landed() = 皿に着いた玉の数(液晶の数字をこれに合わせる)、done() = 払い出し完了
    setTray(h) { this.trayHandler = h || null; this._trayHandle = null; }
    _trayCue(c) {
      const h = this.trayHandler, p = c.p || {}, par = c.params || {}, dur = Math.max(.1, (c.t1 - c.t0) || 1);
      // R3：連チャンの未確定配当は映像上の数字だけ。確定時のchain_stopで払い出す。
      if (c.pat === 'payout' && par.paid === false) return;
      const R = this.lcdOk ? root.LCD.rules() : {};
      let n = typeof p.n === 'number' ? p.n : Number(par.payout ?? par.total ?? 0) || 0;
      if (c.event === 'ticket' || c.event === 'add100') n = Number.isFinite(par.balls) ? par.balls : (R.loanBalls || n);     // 払い出し数はイベントの値(規則側が載せる。add100 は ExtraLoanBalls)。無ければ規則の貸玉
      this.trayLog = (this.trayLog || []).concat([{ pat: c.pat, event: c.event, n, dur }]).slice(-20);
      if (!h) return;
      try {
        if (c.pat === 'payout' && h.award) this._trayHandle = h.award(n, { eventId: c.event, duration: dur, rate: n / dur, origin: 'payoutPort' }) || null;
        else if (c.pat === 'collect' && h.collect) this._trayHandle = h.collect({ eventId: c.event, duration: dur }) || null;
        this._trayTotal = n; this._trayPay = c.pat === 'payout'; this._trayJustDone = false;
      } catch (e) { console.warn('tray handler', e.message); }
    }
    frame(dt) {
      if (this._pendingStart && (!this._ticketBusy() || this.dir.t - this._pendingStart.t > 4)) { const q = this._pendingStart; this._pendingStart = null; this.notify('start', Object.assign({}, q.params, { __late: true })); }
      const F = this.dir.step(dt); this._last = F;
      if (this._laterQ && this._laterQ.length) { const due = this._laterQ.filter((q) => q.at <= this.dir.t); this._laterQ = this._laterQ.filter((q) => q.at > this.dir.t); for (const q of due) { try { q.fn(); } catch (e) { console.warn('later', e.message); } } }
      { const why = this.clockStopReason(); if (why) { const S = this.clockStats; S.total += dt; S.byReason[why] = (S.byReason[why] || 0) + dt; } }   // 止めた累積秒(最終検証用)
      for (const c of F.cues) if (c.lane === 'tray') this._trayCue(c);   // 液晶が無くても皿の合図は出す
      if (this.lcdOk) {
        const M = root.LCD.mono;                           // 既存の重複ルーレットの針・昇天の合図を光へ渡す
        this.dir.state.needle = M && M.kind === 'roulette' && M.needle != null ? M.needle : null;
        if (M && M.phase === 'ascend' && !this._asc) { this._asc = true; this.dir.start('ascend', { once: true, k: this._k, scale: 1 / (this._rate || 1) }); }
        const th = this._trayHandle;                       // 皿に着いた玉の数 → 液晶の数字
        if (th && th.landed) { root.LCD.setState({ trayLanded: th.landed() }); if (th.done && th.done()) { this._trayHandle = null; this._trayJustDone = true; } } else if (root.LCD.state.trayLanded !== undefined) root.LCD.setState({ trayLanded: undefined });
        this._gateStep();
        for (const c of F.cues) if (c.lane === 'lcd' && root.LCD.defs[c.event] && !(Effects.QUIET.has(c.event) && c.scale < 1)) this._gateCue(c);   // 毎球の入賞/重複は、液晶を占有せず光と通常画面のウパだけ(初回は説明つきで全編)   // 液晶シーンの無いイベント(ambient等)は土台のまま
        root.LCD.setState({ n: F.n, nDisp: F.nDisp, chipWait: !!(this.tutorial && root.Tutorial && !(this.first || {}).firstDeclare && !(this._tut && this._tut.state && this._tut.state.chal === 'shown')) }); root.LCD.update(dt); root.LCD.render(null, 0, 0);
        F.lcd = root.LCD.cv;
      }
      return F;
    }
  }
  Effects.CLOCK_STOP = { jp: 20, lamp4: .8, success_big: 2.5 };   // 調整側と合意(10/17): JPは最初の11s、4灯は合図0.8s、大成功はリセット側2.5sまで。howto はゲーム側(ctrl.howtoSeconds)が時計に含めない   // 調整側と合意(10/17): JPは最初の11s、4灯は合図0.8s、大成功はリセット側2.5sまで
  Effects.QUIET = new Set(['lamp123', 'dup_protect']);
  // 同じ映像(iframe)を使う液晶の場面と、その最低表示時間(実秒)・格。連打で次が来ても、ここまでは出し切る。待ちは最大 GATE_MAXWAIT 秒。
  Effects.MONO = { lamp123: { rank: 1, min: .6 }, lamp4: { rank: 4, min: 1.0 }, lamp5: { rank: 5, min: 1.0 }, lamp6: { rank: 6, min: 1.4 }, roulette: { rank: 7, min: 2.4 } };
  Effects.GATE_MAXWAIT = 1.0;
  Effects.LADDER = { lamp4: 4, lamp5: 5, lamp6: 6 }; Effects.LADDER_MIN = .6;
  Effects.COMPACT = { lamp123: .42, dup_protect: .4, lamp4: .73, lamp5: .6, lamp6: .75, fail: .7 };   // 映像の長さの倍率(2.6s→1.1s, 1.4s→0.56s, 4.1→3.0s, 3.4→2.0s, 3.7→2.8s)。調整担当メモの最短〜最長に収める
  if (typeof module !== 'undefined' && module.exports) module.exports = Effects; else root.Effects = Effects;
})(typeof globalThis !== 'undefined' ? globalThis : this);
