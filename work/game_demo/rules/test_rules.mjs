// node rules/test_rules.mjs  — tests/medal_game_csharp/Program.cs の全検査を移植 + 出荷JSONのJP分布。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MedalGame, MedalRules, MedalPhase, MedalEvent, makeRng } from './medal_rules.mjs';

let checks = 0;
const check = (c, name) => { if (!c) throw new Error('FAIL: ' + name); checks++; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const Game = (rules, seed = 42) => { const g = new MedalGame(rules, seed); g.start(); g.advance(g.effectLeft + .001); return g; };
const Shot = (g, lane) => { const s = g.launch(); check(s != null, 'Shot available'); check(g.resolve(s.id, lane), 'Receipt accepted'); g.advance(.001 + g.effectLeft); return s; };
const Ledger = (g) => check(g.wallet === g.purchased + g.won - g.spent, 'Wallet reconciles');

for (let k = 1; k <= 3; k++) {
  const g = Game(); const before = g.wallet;
  for (let i = 1; i <= k; i++) Shot(g, i);
  g.toggleChallenge(); Shot(g, k + 1);
  check(g.wallet === before - 1 && g.lampCount === 0, `Perfect ${k}-lamp cycle still loses a ball`); Ledger(g);
}
{
  const g = Game(); Shot(g, 1); Shot(g, 1);
  check(g.lampCount === 1 && g.wallet === 8 && g.firstProtection, 'Protection preserves lamp but spends ball');
  Shot(g, 2); Shot(g, 3); Shot(g, 4);
  check(!g.firstProtection && g.award === 10, 'Four lights end beginner protection');
  const before = g.lamps; const seconds = g.secondsLeft;
  check(g.addCredit() && !g.addCredit(), 'Extra credit only once');
  check(eq(g.lamps, before) && !g.firstProtection && g.secondsLeft === seconds + 50, 'Extra preserves board and adds time'); Ledger(g);
}
{
  const g = Game(); for (let i = 0; i < 9; i++) Shot(g, 1);
  g.toggleChallenge(); const s = g.launch();
  check(g.wallet === 0 && g.phase === MedalPhase.Flight, 'Zero does not terminate in-flight ball');
  check(!g.toggleChallenge() && !g.addCredit() && g.launch() == null, 'In-flight commands are rejected');
  check(!g.resolve(s.id + 1, 2), 'Wrong receipt rejected');
  check(g.resolve(s.id, 2) && !g.resolve(s.id, 2), 'Duplicate receipt cannot pay twice');
  g.advance(g.effectLeft + .001); check(g.wallet === 1 && g.phase === MedalPhase.Ready, 'Last-ball win keeps session alive'); Ledger(g);
}
{
  const g = Game(); Shot(g, 1); g.toggleChallenge(); const s = g.launch();
  g.advance(1000); check(g.phase === MedalPhase.Flight, 'Deadline waits for landing');
  g.resolve(s.id, 2); g.advance(g.effectLeft + .001);
  check(g.phase === MedalPhase.Continue && g.wallet === 9, 'Win settled before time offer');
  g.advance(9); check(g.phase === MedalPhase.Continue && g.secondsLeft === 0, 'Offer has its own clock');
  g.advance(1); check(g.phase === MedalPhase.Result && !g.addCredit(), 'Offer expires and cannot accept a late purchase');
}
{
  const g = Game(); for (let i = 0; i < 7; i++) Shot(g, 1); Shot(g, 2); Shot(g, 3); Shot(g, 4);
  check(g.phase === MedalPhase.Continue && g.lampCount === 4, 'Mid-board zero retains lamps');
  g.addCredit(); g.advance(g.effectLeft + .001); check(g.lampCount === 4 && g.wallet === 10, 'Continue resumes this board');
  g.advance(1000); check(g.phase === MedalPhase.Result, 'Second boundary ends without further purchase');
}
for (let bucket = 0; bucket < 4; bucket++) {
  const weights = [0, 0, 0, 0]; weights[bucket] = 100;
  const g = Game(new MedalRules({ ResetWeights: weights }));
  for (let i = 1; i <= 4; i++) Shot(g, i);
  Shot(g, 2);
  check(g.lampCount === 4 - (bucket === 3 ? 4 : bucket + 1) && !g.lamps.includes(2), 'Reset count, bounds and duplicated hole removal'); Ledger(g);
  check(g.receipt.resetChoice === bucket, 'Roulette display retains the actual selected outcome');
}
{
  const g = Game(); for (let i = 1; i <= 6; i++) Shot(g, i);
  check(g.armed && !g.toggleChallenge(), 'Six lamps force next Challenge');
  Shot(g, 7); check(g.wallet === 63 && g.bestAward === 60 && g.lampCount === 0, 'Six lamps pay and never create a seventh stored lamp'); Ledger(g);
}
{
  const g = Game(); Shot(g, 1); g.toggleChallenge(); Shot(g, 1);
  check(g.lampCount === 0 && g.won === 0 && !g.firstProtection, 'Failed early challenge consumes protection');
  const before = g.wallet; const s = g.launch(); g.resolve(s.id, 0, false);
  check(g.phase === MedalPhase.Fault && g.wallet === before, 'Unresolved physics refunds only the unjudged ball'); Ledger(g);
}
{
  const rng = makeRng(902); const next = (n) => Math.floor(rng() * n);
  for (let run = 0; run < 2000; run++) {
    const g = Game();
    for (let step = 0; step < 400 && g.phase !== MedalPhase.Result; step++) {
      if (g.phase === MedalPhase.Continue) { if (next(2) === 0) g.addCredit(); else g.finish(); }
      if (g.canFire) {
        if (next(4) === 0) g.toggleChallenge();
        const s = g.launch(); g.advance(rng() * 5);
        g.resolve(s.id, 1 + next(7));
      }
      g.advance(2); Ledger(g);
      check(g.wallet >= 0 && g.lampCount <= 6 && g.purchased <= 20, 'Fuzz resource invariants');
    }
    check(g.phase === MedalPhase.Result, 'Fuzz session is finite');
  }
}
{
  const rules = new MedalRules({ LoanBalls: 20, ResetWeightsByLamps: [null, null, null, null, null, [0, 0, 0, 100], null] });
  let g = Game(rules); for (const l of [1, 2, 3, 4, 5]) Shot(g, l);
  Shot(g, 3); check(g.lampCount === 0 && g.receipt.resetChoice === 3, 'Five-lamp duplicate uses its own roulette row');
  g = Game(rules); for (const l of [1, 2, 3, 4]) Shot(g, l);
  Shot(g, 2); check(g.lampCount === 3 && g.receipt.resetChoice === 0, 'Four-lamp duplicate falls back to the default row'); Ledger(g);
}
{
  const rules = new MedalRules({ LoanBalls: 20, JackpotAwards: [30, 80, 300], JackpotWeights: [50, 45, 5] });
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const g = Game(rules, seed);
    for (const l of [1, 2, 3, 4, 5, 6]) Shot(g, l);
    const before = g.wallet; Shot(g, 7); const r = g.receipt;
    check(r.kind === MedalEvent.Win && r.jackpot >= 0 && r.award === rules.JackpotAwards[r.jackpot] && g.wallet === before - 1 + r.award, 'Jackpot pays its drawn entry');
    seen.add(r.jackpot); Ledger(g);
  }
  check(seen.size === 3, 'Every jackpot entry is reachable');
  let bad = false; try { new MedalRules({ JackpotAwards: [5], JackpotWeights: [100] }); } catch { bad = true; }
  check(bad, 'Jackpot entries below the five-lamp award are rejected');
}
{
  const rules = MedalRules.fromJson(readFileSync(fileURLToPath(new URL('./medal_game.json', import.meta.url)), 'utf8'));
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const g = Game(rules, seed);
    check(g.wallet === rules.LoanBalls && g.purchased === rules.LoanBalls, 'Shipped credit rules are loaded');
    for (const l of [1, 2, 3, 4, 5, 6]) Shot(g, l);
    const before = g.wallet; Shot(g, 7); const r = g.receipt;
    check(r.jackpot >= 0 && r.award === rules.JackpotAwards[r.jackpot], 'Shipped six-lamp payout is a JP entry');
    check(g.wallet === before - 1 + r.award, 'Shipped JP is credited exactly once');
    seen.add(r.award); Ledger(g);
  }
  check(eq([...seen].sort((a, b) => a - b), [...rules.JackpotAwards].sort((a, b) => a - b)), 'All shipped JP awards are exercised');
  // 出荷設定の分布(JP 40/80/150/300/600 = 40/30/18/8/4%)を大きめの試行で確認(統計: ±3σ)
  const counts = new Map(); const N = 20000;
  for (let seed = 0; seed < N; seed++) { const g = Game(rules, 1000 + seed); for (const l of [1,2,3,4,5,6]) Shot(g, l); Shot(g, 7); counts.set(g.receipt.award, (counts.get(g.receipt.award) ?? 0) + 1); }
  rules.JackpotAwards.forEach((a, i) => { const p = rules.JackpotWeights[i] / 100, sd = Math.sqrt(N * p * (1 - p)); check(Math.abs((counts.get(a) ?? 0) - N * p) < 3.5 * sd, `JP ${a} frequency`); });
}
console.log(`PASS ${checks} checks (C# 試験の全移植 + 出荷JSON分布)`);
