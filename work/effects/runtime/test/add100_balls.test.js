// 追加100円/チケットの皿の払い出し数は、イベントの値(規則側が載せる)を使う。貸玉(最初の玉数)を流用しない。
const Effects = require('../effects.js'), ev = require('../../spec/events.json'), geom = require('../../spec/geometry.json');
const assert = require('node:assert');
globalThis.LCD = { rules: () => ({ loanBalls: 60, extraSeconds: 25 }) };   // 貸玉60の規則でも、追加は ExtraLoanBalls(10)
const pay = (event, params) => { const fx = new Effects({ events: ev, geom }); fx.lcdOk = true; const got = []; fx.setTray({ award: (n) => { got.push(n); return null; } });
  fx._trayCue({ event, pat: 'payout', params, p: {}, t0: 0, t1: 2 }); return got[0]; };
assert.strictEqual(pay('add100', { balls: 10, seconds: 25 }), 10, 'add100 pays event.balls (ExtraLoanBalls), not loanBalls');
assert.strictEqual(pay('ticket', { balls: 15 }), 15, 'ticket pays event.balls');
assert.strictEqual(pay('ticket', {}), 60, 'ticket without a value falls back to the rule loanBalls');
console.log('add100_balls ok');
