// ブラウザ/Node 共通の規則・演出・物理の接続。全て同じ480Hzで進める。
import { connectEffects } from './effects_bus.mjs';
const DT = 1 / 480;
export function createRuntime({ ctrl, presenter, pa, log = null, effects, onRecall = null }) {
  presenter.externalTray = true;
  const effectsBridge = connectEffects({ ctrl, presenter, bus: effects });
  const stats = { cups: Array(8).fill(0), lost: 0, trayLost: 0, nudge: 0, peg: 0, overflow: 0, valve: 0, reserve: 0, countDone: null, maxLedgerDrift: 0, recalled: 0 };
  let acc = 0, countStarted = false, jpHold = false;
  // 景品の灯。H(PrizeBasis:'wallet')は持ち玉で賞が決まり撃つたびに上下するので、灯は「その試合で一度でも届いた最高の賞」まで点けて下げない。G／従来は game.prize のまま
  let litGame = null, litIdx = 0;
  const litPrize = () => {
    const g = ctrl.game, r = g.rules;
    if (r.PrizeBasis !== 'wallet') return g.prize;
    if (g !== litGame) { litGame = g; litIdx = 0; }
    for (let k = r.PrizeThresholds.length - 1; k > litIdx; k--) if (r.PrizeThresholds[k] <= g.wallet) { litIdx = k; break; }
    return r.PrizeNames[litIdx];
  };
  let shownPrize = litPrize();
  ctrl.onAction((action) => {
    if (action === 'start') {
      pa.beginGame(ctrl.rules.LoanBalls); countStarted = false; acc = 0; stats.countDone = null;
      log?.write('physics_config', { hz:480,scale:pa.tray.S,seed:pa.seed,rng_state:pa.s,tray_hash:pa.tray.hash,rapier:pa.R.version(),connections:pa.connections,stage_transforms:pa.transforms.document,
        config:pa.playConfig ?? null, stageDir:pa.stageDir, pinCount:pa.board.layout.pins.length, jitter:pa.jitter, rules:ctrl.rules,
        board:{ model:pa.board.model, layout:pa.board.layout } });
    }
    if (action === 'add') pa.reserveForLoan(ctrl.game.receipt.award);   // 追加100円: 最初の1球を待たせない(貸しの予備球を直ちに用意)
    log?.write('input', { tick: pa.tick + 1, action, aim: ctrl.aim, dir: ctrl.aimDir }, ctrl.game);
  });
  // 規則側が取り消した通常球(JPチャンス・継続の挑戦に入る瞬間に回収。手持ちへ戻し済み)を、物理側の盤から外す。
  const flushRecall = () => { const ids = ctrl.game.takeRecalled?.(); if (ids?.length) { pa.recall?.(ids); stats.recalled += ids.length; try { onRecall?.(ids.length); } catch {} log?.write('recall', { tick: pa.tick, ids }, ctrl.game); } };
  function advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('invalid frame duration');
    acc += dt;
    let physicsMs = 0, steps = 0;
    while (acc + 1e-12 >= DT) {
      acc = Math.max(0, acc - DT);
      effectsBridge.advance(DT);
      ctrl.update(DT); flushRecall(); presenter.update(DT); pa.setAim(ctrl.aim, ctrl.aimDir);
      effectsBridge.sync();
      // The JP film may hold the visible payout while its wallet is spendable.
      // Move one credited ball into the same loan reserve when the lift is dry;
      // takePending/payout below deduct it once, including while jpHold is set.
      if (ctrl.rules.ContinuousFire && !pa.shuttleHas && pa.stock === 0 && pa.payQueue === 0 && pa.stored?.overflow === 0 &&
          pa.refillAt !== null && pa.t >= pa.refillAt) {
        const available=presenter.trayStatus().releasable;
        if(available>0){const k=pa.reserveForLoan(1);if(k>0)presenter.awardToTray(k,{origin:'launcher-reserve'});}
      }
      if (!jpHold && presenter.holdAwards && pa.skipPayout > 0) { const r = presenter.trayStatus().releasable; if (r > 0) presenter.awardToTray(Math.min(pa.skipPayout, r)); }   // 昇降管の予備球は最初から物理側にある
      const n = presenter.takePending(); if (n) pa.payout(n, presenter.pour.earned, presenter.pour.rate);
      if (ctrl.game.phase !== 'Result') countStarted = false;
      // Resultの財布0もシャトルを含めて物理側を空にする。
      // JP演出が払い出す前にはResultへ進まない（規則側の時間枠）。
      if (ctrl.game.phase === 'Result' && !countStarted) { countStarted = true; pa.startCount(); }
      const t0 = performance.now(); pa.step(); physicsMs += performance.now() - t0; steps++;
      for (const e of pa.drainEvents()) {
        if (e.type === 'cup') { stats.cups[e.cup]++; ctrl.landing(e.shotId, e.cup, true); }
        else if (e.type === 'lost') { stats.lost++; ctrl.landing(e.shotId, 0, false); }
        else if (e.type === 'peg') { stats.peg++; presenter.pegHit(e.index); }
        else if (e.type === 'tray_ball') presenter.trayBall({ earned: e.earned });
        else if (e.type === 'stuck_nudge') stats.nudge++;
        else if (e.type === 'overflow') { stats.overflow++; if (e.valve) stats.valve++; }
        else if (e.type === 'reserve_return') stats.reserve++;
        else if (e.type === 'tray_lost') { stats.trayLost++; stats.valve++; }
        else if (e.type === 'count') presenter.setCounted(e.counted);
        else if (e.type === 'count_done') {
          stats.countDone = e; presenter.setCounted(e.counted); presenter.countFinished();
          if (e.counted !== ctrl.game.wallet) log?.write('count_mismatch', { physical: e.counted, wallet: ctrl.game.wallet, tick: pa.tick }, ctrl.game);
        }
        effectsBridge.physics(e);
        // Publish each receipt before another same-tick landing can replace it.
        // physics() first supplies the actual approach/crossing for near-miss cues.
        if (e.type === 'cup' || e.type === 'lost') {presenter.update(0);effectsBridge.sync();flushRecall();}
        if (['cup', 'lost', 'stuck_nudge', 'overflow', 'reserve_return', 'tray_lost', 'count_done', 'launch', 'returned'].includes(e.type)) log?.write('physics', e, ctrl.game);
      }
      if (!jpHold) shownPrize = litPrize();
      const L = pa.ledger();
      // 未受領の配当と飛行中の1球も追跡。Result中は数えた玉を含める。
      const physical = L.dish + L.tunnel + L.queue + L.overflow + L.stock + L.travel + L.shuttle + L.counted;
      const receipt = ctrl.game.receipt;
      // 継続成功の積み増しは確定前には財布にも物理にも入らない（Presenterと同じ条件）。
      const unobserved = receipt && receipt.id !== presenter._seen && !(receipt.chain && !receipt.chainBanked) ? receipt.award : 0;
      const drift = physical + presenter.pending + unobserved - pa.pendingLaunch.length - ctrl.game.wallet;
      stats.maxLedgerDrift = Math.max(stats.maxLedgerDrift, Math.abs(drift));
    }
    presenter.setDisplayWallet(Math.max(0, ctrl.game.wallet - pa.pendingPhysical() - presenter.pending));
    return { physicsMs, steps };
  }
  const awardToTray = (count, opts = {}) => jpHold && opts.origin !== 'jp_reveal' ? 0 : presenter.awardToTray(count, opts);
  const setJpHold = on => { jpHold=!!on; if(on) presenter.setAwardHold(true,14); else shownPrize=litPrize(); };
  // 10/31 軟らかいリセット: 客をまたいで持ち越す内部の状態（進めた端数の時間・計数の開始印・JP演出の保留・払い出しの保留・景品の灯）を空にする。物理側は controller の cancelFlights（pa.reset）で空になる
  const reset = () => {
    acc = 0; countStarted = false; jpHold = false; litGame = null; litIdx = 0; shownPrize = litPrize(); stats.countDone = null;
    presenter.holdAwards = false; presenter.maxHold = 4; presenter.update(0); presenter.setDisplayWallet(0);   // update(0): 新しい game を見て presenter の払い出し待ち・演出・計数を空にする（次のフレームを待たない）
  };
  return { stats, advance, reset, setJpHold, getPrize: () => shownPrize, get jpHold() {return jpHold;}, effects: effectsBridge.bus, effectsBridge, awardToTray, releaseAwards: (o) => jpHold ? 0 : presenter.releaseAwards(o), setAwardHold: (on, maxHold) => presenter.setAwardHold(on, maxHold), trayStatus: () => presenter.trayStatus() };
}
