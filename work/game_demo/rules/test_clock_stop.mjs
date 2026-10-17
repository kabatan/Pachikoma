import assert from 'node:assert/strict';
import { MedalRules, MedalGame, winSeconds, JACKPOT_SECONDS } from './medal_rules.mjs';

const config = { LoanBalls: 40, JackpotAwards: [80], JackpotWeights: [100] };
for (const bad of [{ ClockStopOnReset: 1 }, { ClockStopOnJackpot: 'true' },
  { ResetEffectSeconds: -1 }, { ResetEffectSeconds: NaN }, { ResetEffectSecondsSingle: Infinity },
  { ResetEffectSecondsSingle: null }, { JackpotEffectSeconds: [NaN] }, { JackpotEffectSeconds: [-1] },
  { JackpotEffectSeconds: [] }, { JackpotEffectSeconds: '20' }]) assert.throws(() => new MedalRules({ ...config, ...bad }));
assert.equal(new MedalRules().ClockStopOnReset, false);
assert.equal(new MedalRules().ClockStopOnJackpot, false);
assert.equal(new MedalRules().ResetEffectSeconds, 1.4);
assert.equal(new MedalRules().ResetEffectSecondsSingle, .5);
assert.equal(new MedalRules().ResetEffectSecondsByLamps, null);
for (const value of [[], [0,.5,1,2,3], [0,.5,1,2,3,4,5], 'seconds',
  [0,.5,-1,2,3,4], [0,.5,NaN,2,3,4], [0,.5,1,2,3,Infinity],
  [0,.5,null,2,3,4], [0,.5,'1',2,3,4], new Array(6)])
  assert.throws(() => new MedalRules({ResetEffectSecondsByLamps:value}));
// 1..5灯は配列を優先する。0秒、時計停止の有無、RapidFireの両方を確認。
for (const rapid of [false,true]) for (const stop of [false,true]) {
  const times=[0,0,.5,2,8,12];
  for (let lamps=1;lamps<=5;lamps++) {
    const g=new MedalGame(MedalRules.fromJson(JSON.stringify({...config,RapidFire:rapid,
      ClockStopOnReset:stop,ResetEffectSeconds:99,ResetEffectSecondsSingle:88,
      ResetEffectSecondsByLamps:times})),1);
    g.start();g.advance(g.effectLeft);g._lamps=new Set(Array.from({length:lamps},(_,i)=>i+1));g.firstProtection=false;
    const shot=g.launch();assert.ok(g.resolve(shot.id,1));
    assert.equal(g.receipt.kind,'Reset');assert.equal(g.receipt.before.length,lamps);
    assert.equal(g.receipt.duration,times[lamps]);
    const before=g.secondsLeft;g.advance(times[lamps]);
    assert.equal(g.secondsLeft,before-(stop?0:times[lamps]));assert.equal(g.phase,'Ready');
    assert.equal(g.wallet,g.purchased+g.won-g.spent);
  }
}
for (const rapid of [false, true]) for (const stop of [false, true]) {
  const g = new MedalGame(new MedalRules({ ...config, RapidFire: rapid, ClockStopOnReset: stop,
    ClockStopOnJackpot: stop, ResetEffectSeconds: 12, JackpotEffectSeconds: [20] }), 1);
  const effect = (duration, paused) => {
    assert.equal(g.receipt.duration, duration);
    const before = g.secondsLeft;
    g.advance(duration / 2); assert.equal(g.secondsLeft, before - (paused ? 0 : duration / 2));
    g.advance(duration / 2); assert.ok(Math.abs(g.secondsLeft - (before - (paused ? 0 : duration))) < 1e-9);
    assert.equal(g.effectLeft, 0); assert.equal(g.phase, 'Ready');
  };
  const land = lane => { const s = g.launch(); assert.ok(s); const before = g.secondsLeft;
    g.advance(.25); assert.equal(g.secondsLeft, before - .25); assert.ok(g.resolve(s.id, lane)); };
  g.start(); effect(g.receipt.duration, false);
  land(1); assert.equal(g.canFire, rapid); effect(.45, false);
  land(1); assert.equal(g.receipt.kind, 'Protected'); effect(.45, false);
  for (const lane of [2, 3, 4]) { land(lane); effect(.45, false); }
  land(4); assert.equal(g.receipt.kind, 'Reset'); assert.equal(g.canFire, false); effect(12, stop);
  // 1灯Resetも停止対象だが、演出尺は短いまま。
  g._lamps = new Set([1]); g.firstProtection = false;
  land(1); effect(.5, stop);
  land(1); effect(.45, false); g.toggleChallenge(); land(7); effect(winSeconds(1), false);
  land(1); effect(.45, false); g.toggleChallenge(); land(1); effect(1.35, false);
  for (const lane of [1, 2, 3, 4, 5, 6]) { land(lane); effect(.45, false); }
  land(7); assert.equal(g.receipt.jackpot, 0); assert.equal(g.canFire, false); effect(20, stop);
  assert.equal(g.wallet, g.purchased + g.won - g.spent);
}
for (const flags of [{ ClockStopOnReset: true }, { ClockStopOnJackpot: true }, {}]) {
  const g = new MedalGame(new MedalRules({ ...config, ...flags }), 1);
  g.start(); g.advance(g.effectLeft);
  for (const lane of [1,2,3,4,5,6,7]) { const s = g.launch(); g.resolve(s.id,lane); g.advance(g.effectLeft); }
  assert.equal(g.receipt.duration, winSeconds(80) + JACKPOT_SECONDS);
  g.secondsLeft = 0; g.phase = 'Effect'; g.effectLeft = 1; g.advance(1);
  assert.equal(g.phase, 'Continue'); // 最後のJPも完了してから終端へ。
}
// フラグは独立。Resetを止めても非JPのWinは止めず、その逆も同様。
for (const reset of [false,true]) for (const jp of [false,true]) {
  const g = new MedalGame(new MedalRules({ ...config, ClockStopOnReset:reset, ClockStopOnJackpot:jp,
    ResetEffectSecondsSingle:0, JackpotEffectSeconds:[0] }),1);
  for (const [receipt,paused] of [[{kind:'Reset',jackpot:-1},reset],[{kind:'Win',jackpot:0},jp],[{kind:'Win',jackpot:-1},false]]) {
    g.phase='Effect';g.receipt=receipt;g.secondsLeft=10;g.effectLeft=2;g.wallet=1;
    g.advance(.5);assert.equal(g.secondsLeft,paused?10:9.5);assert.equal(g.effectLeft,1.5);
  }
}
console.log('PASS clock-stop validation, defaults, reset/single/JP, other clocks, RapidFire, terminal');

// セッション通算の予算。分割advance、境界跨ぎ、追加入金での非リセット。
assert.equal(new MedalRules().ClockStopBudget, null);
assert.equal(new MedalRules().ClockStopBudgetIncludesJackpot, false);
for (const value of [-1, NaN, Infinity, '10', true]) assert.throws(() => new MedalRules({ClockStopBudget:value}));
for (const value of [0, null, 'false']) assert.throws(() => new MedalRules({ClockStopBudgetIncludesJackpot:value}));
for (const rapid of [false,true]) for (const includesJP of [false,true]) {
  const g=new MedalGame(new MedalRules({...config,RapidFire:rapid,ClockStopOnReset:true,
    ClockStopOnJackpot:true,ClockStopBudget:3,ClockStopBudgetIncludesJackpot:includesJP}),1);
  g.start();g.advance(g.effectLeft);
  const fake=(kind,jackpot,duration)=>{g.phase='Effect';g.receipt={kind,jackpot};g.effectLeft=duration;};
  fake('Reset',-1,5);let t=g.secondsLeft;
  g.advance(2);assert.equal(g.secondsLeft,t);assert.equal(g.clockStopBudgetUsed,2);
  g.advance(2);assert.equal(g.secondsLeft,t-1);assert.equal(g.clockStopBudgetUsed,3);
  g.advance(1);assert.equal(g.secondsLeft,t-2);
  assert.ok(g.addCredit());g.advance(g.effectLeft);assert.equal(g.clockStopBudgetUsed,3);
  fake('Reset',-1,2);t=g.secondsLeft;g.advance(2);assert.equal(g.secondsLeft,t-2);
  fake('Win',0,4);t=g.secondsLeft;g.advance(4);assert.equal(g.secondsLeft,t-(includesJP?4:0));
  assert.equal(g.clockStopBudgetUsed,3);
}
// JP自身が予算を使う場合と、0秒予算、演出終端を跨ぐ大きなadvance。
for (const includesJP of [false,true]) {
  const g=new MedalGame(new MedalRules({...config,ClockStopOnJackpot:true,ClockStopBudget:2,
    ClockStopBudgetIncludesJackpot:includesJP}),1);
  g.phase='Effect';g.receipt={kind:'Win',jackpot:0};g.effectLeft=5;g.secondsLeft=20;g.wallet=1;
  g.advance(3);assert.equal(g.secondsLeft,includesJP?19:20);
  assert.equal(g.clockStopBudgetUsed,includesJP?2:0);
}
for (const budget of [0,2]) {
  const g=new MedalGame(new MedalRules({ClockStopOnReset:true,ClockStopBudget:budget}),1);
  g.phase='Effect';g.receipt={kind:'Reset',jackpot:-1};g.effectLeft=1;g.secondsLeft=10;g.wallet=1;
  g.advance(3);assert.equal(g.secondsLeft,budget?8:7);assert.equal(g.clockStopBudgetUsed,budget?1:0);
}
console.log('PASS ClockStopBudget: validation, cumulative cap, partial advance, extra credit, JP inclusion/exclusion, zero');

// ClockStartsAfterLoan: 貸玉の払い出し中(Loan演出)は残り時間が減らず、終わってから動く。追加100円も同じ。
{
  assert.equal(new MedalRules().ClockStartsAfterLoan, false);
  assert.throws(() => new MedalRules({ ClockStartsAfterLoan: 1 }));
  for (const after of [false, true]) {
    const g = new MedalGame(new MedalRules({ ClockStartsAfterLoan: after }), 1);
    g.start(); const d = g.receipt.duration; assert.ok(d > 1);
    for (let i = 0; i < 480; i++) g.advance(1 / 480);   // 1秒
    assert.ok(Math.abs(g.secondsLeft - (g.rules.InitialSeconds - (after ? 0 : 1))) < 1e-6, 'after=' + after + ' left=' + g.secondsLeft);
    g.advance(d - 1 + 0.5);   // 払い出しを終えて0.5秒進む
    assert.equal(g.phase, 'Ready');
    assert.ok(Math.abs(g.secondsLeft - (g.rules.InitialSeconds - (after ? 0.5 : d + 0.5 - 0))) < 1e-6 || !after, 'left after effect ' + g.secondsLeft);
  }
  console.log('PASS ClockStartsAfterLoan: default off, validation, loan effect does not consume the clock');
}
