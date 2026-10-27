import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MedalEvent, MedalGame, MedalPhase, MedalRules } from './medal_rules.mjs';
import { loadPlayConfig, loadPlayRules } from '../play/config.mjs';

const config = JSON.parse(readFileSync(new URL('../../game_tuning/r3/rules_r3.json', import.meta.url), 'utf8'));
const readText = url => readFileSync(new URL(url), 'utf8');
const playConfig = await loadPlayConfig('work/game_tuning/r3/config_r3.json', readText);
const playRules = await loadPlayRules(playConfig.rules, readText);
assert.equal(playConfig.name, 'R3-T 72秒 Cup1/4・20mm + Cup7・42mm');
assert.equal(playRules.R3Enabled, true);
assert.deepEqual(playRules.PrizeThresholds, [0, 30, 200, 320, 500]);
assert.deepEqual(playRules.JackpotChainLamps, [1, 2, 3, 4, 5, 6]);
assert.deepEqual(playRules.PrizeNames, ['参加賞', 'C賞', 'B賞', 'A賞', 'S賞']);
assert.equal(playRules.InitialSeconds, 72);
const r3Layout = JSON.parse(readFileSync(new URL('../../game_tuning/r3/boards/cup1_4_wide20/layout3.json', import.meta.url), 'utf8'));
assert.equal(r3Layout.cups[0].mouth_width, 20);
assert.equal(r3Layout.cups[3].mouth_width, 20);
assert.equal(r3Layout.cups[6].mouth_width, 42);
assert.equal(r3Layout.pins.length, 82);
assert.equal(config.R3Enabled, true);
assert.deepEqual(config.Awards, [0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual(config.JackpotAwards, [30, 40, 100, 200, 500]);
assert.deepEqual(config.JackpotWeights, [700000, 200000, 50000, 49996, 4]);
assert.deepEqual(config.JackpotChainLamps, [1, 2, 3, 4, 5, 6]);
assert.equal(config.MaxExtraCredits, 4);

function makeGame(overrides = {}) {
  const rules = new MedalRules({
    R2Enabled: true, R3Enabled: true, MaxExtraCredits: 4, JackpotChainLamps: [5, 6],
    LoanBalls: 20, ExtraLoanBalls: 10, InitialSeconds: 90, ExtraSeconds: 22, ContinueSeconds: 5,
    Awards: [0, 0, 0, 0, 0, 0, 0], ResetWeights: [100, 0, 0, 0],
    PrizeThresholds: [0, 30, 100, 200, 500],
    PrizeNames: ['参加賞', 'C賞', 'B賞', 'A賞', 'S賞'],
    JackpotAwards: [30, 40, 100, 200, 500], JackpotWeights: [100, 0, 0, 0, 0],
    JackpotEffectSeconds: [0, 0, 0, 0, 0], EndGraceSeconds: 0, ...overrides,
  });
  const game = new MedalGame(rules, 17);
  assert.equal(game.start(), true);
  game.advance(2); // initial loan effect has ended
  game.secondsLeft = 90;
  return game;
}

function forceChallenge(game, lampCount) {
  game._lamps = new Set(Array.from({ length: lampCount }, (_, index) => index + 1));
  game.armed = true;
  game.challengeIntent = null;
  game.phase = MedalPhase.Ready;
}

function shoot(game, lane) {
  const shot = game.launch();
  assert.ok(shot?.challenge);
  assert.equal(game.resolve(shot.id, lane), true);
  return game.receipt;
}

function settle(game) {
  if (game.phase === MedalPhase.Effect) game.advance(game.effectLeft + 0.01);
}

// A six-lamp win pays the base JP immediately, then a successful chain adds unbanked JP.
{
  const game = makeGame();
  forceChallenge(game, 6);
  const base = shoot(game, 7);
  assert.equal(base.kind, MedalEvent.Win);
  assert.equal(base.award, 30);
  assert.equal(game.jackpotChances, 1);
  settle(game);
  assert.equal(game.phase, MedalPhase.ChainChoice);
  const walletAfterBase = game.wallet;

  assert.equal(game.chooseChain(true), true);
  assert.equal(game.lampCount, 5);
  const first = shoot(game, 6);
  assert.equal(first.chain, true);
  assert.equal(first.award, 30);
  assert.equal(game.wallet, walletAfterBase - 1); // pending chain award is not yet credited
  settle(game);
  assert.equal(game.phase, MedalPhase.ChainChoice);

  assert.equal(game.chooseChain(true), true);
  assert.equal(game.lampCount, 6);
  const second = shoot(game, 7);
  assert.equal(second.chain, true);
  settle(game);
  assert.equal(game.phase, MedalPhase.ChainChoice);
  assert.equal(game.chainStatus.pendingAward, 60);
  assert.equal(game.chooseChain(false), true);
  assert.equal(game.receipt.chainBanked, true);
  assert.equal(game.receipt.award, 60);
  assert.equal(game.wallet, walletAfterBase - 2 + 60);
  assert.equal(game.chainSuccesses, 2);
  assert.equal(game.chainBanked, 60);
  assert.equal(game.wallet, game.purchased + game.won - game.spent);
}

// A failed chain loses its accumulated bonus while preserving the base JP.
{
  const game = makeGame();
  forceChallenge(game, 6);
  shoot(game, 7);
  settle(game);
  const baseWallet = game.wallet;
  game.chooseChain(true);
  const first = shoot(game, 6); // lane 6 is the first unlit lane
  assert.equal(first.kind, MedalEvent.Win);
  settle(game);
  assert.equal(game.chainStatus.pendingAward, 30);
  game.chooseChain(true);
  const lost = shoot(game, 1); // six-lamp stage fails
  assert.equal(lost.kind, MedalEvent.Miss);
  assert.equal(lost.chainLost, 30);
  assert.equal(game.jackpotChain, null);
  assert.equal(game.wallet, baseWallet - 2);
  assert.equal(game.chainLost, 30);
  assert.equal(game.wallet, game.purchased + game.won - game.spent);
}

// Jackpot effects consume time in R3 even when the legacy stop flag is on.
{
  const game = makeGame({ ClockStopOnJackpot: true, JackpotEffectSeconds: [10, 10, 10, 10, 10] });
  forceChallenge(game, 6);
  shoot(game, 7);
  const before = game.secondsLeft;
  game.advance(2);
  assert.equal(game.secondsLeft, before - 2);
  assert.equal(game.phase, MedalPhase.Effect);
}

// R3 permits four additional credits of +22 seconds; R2 mode retains its one-credit limit.
{
  const game = makeGame();
  const initialWallet = game.wallet;
  for (let i = 0; i < 4; i++) {
    assert.equal(game.addCredit(), true);
    assert.equal(game.extraCreditsUsed, i + 1);
    assert.equal(game.wallet, initialWallet + 10 * (i + 1));
    settle(game);
  }
  game.phase = MedalPhase.Continue;
  assert.equal(game.canAdd, false);
  assert.equal(game.addCredit(), false);

  const legacyRules = new MedalRules({ R2Enabled: true, LoanBalls: 20, ExtraLoanBalls: 10,
    InitialSeconds: 90, ExtraSeconds: 22, ContinueSeconds: 5 });
  const legacy = new MedalGame(legacyRules, 18);
  legacy.start(); legacy.advance(2); legacy.phase = MedalPhase.Ready;
  assert.equal(legacy.addCredit(), true);
  legacy.advance(2); legacy.phase = MedalPhase.Ready;
  assert.equal(legacy.addCredit(), false);
  assert.equal(legacy.chooseChain(true), false);
}

// Voluntary one-to-five-lamp challenges are disabled in R3.
{
  const game = makeGame();
  game._lamps = new Set([1, 2]);
  game.phase = MedalPhase.Ready;
  assert.equal(game.canArm, false);
  assert.equal(game.toggleChallenge(), false);
}

// R3 prize rank uses only JP and banked chain payouts, not unused loan balls.
{
  const game = makeGame({
    LoanBalls: 80,
    PrizeThresholds: [0, 30, 100, 200, 500],
    PrizeNames: ['参加賞', 'C賞', 'B賞', 'A賞', 'S賞'],
  });
  assert.equal(game.wallet, 80);
  assert.equal(game.jackpotEarnings, 0);
  assert.equal(game.prize, '参加賞');

  forceChallenge(game, 6);
  shoot(game, 7);
  assert.equal(game.jackpotEarnings, 30);
  assert.equal(game.prize, 'C賞');
  settle(game);
  game.chooseChain(true);
  shoot(game, 6);
  settle(game);
  assert.equal(game.jackpotEarnings, 30);
  assert.equal(game.prize, 'C賞');
  game.chooseChain(false);
  assert.equal(game.jackpotEarnings, 60);
  assert.equal(game.prize, 'C賞');
}

// C/B/A are cumulative JP thresholds at 30/100/200; the 500 threshold itself is not enough for S.
{
  const game = makeGame();
  for (const [score, expected] of [[0, '参加賞'], [29, '参加賞'], [30, 'C賞'], [99, 'C賞'],
    [100, 'B賞'], [199, 'B賞'], [200, 'A賞'], [499, 'A賞'], [500, 'A賞']]) {
    game.jackpotEarnings = score;
    game.jackpotDreamHit = false;
    assert.equal(game.prize, expected, `score ${score}`);
  }
}

// S needs a secured 500 JP result; cumulative smaller awards stop at A.
{
  const game = makeGame({ JackpotWeights: [0, 0, 0, 0, 100] });
  game.jackpotEarnings = 600;
  assert.equal(game.jackpotDreamHit, false);
  assert.equal(game.prize, 'A賞');

  game.jackpotEarnings = 0;
  forceChallenge(game, 6);
  shoot(game, 7);
  assert.equal(game.jackpotDreamHit, true);
  assert.equal(game.jackpotEarnings, 500);
  assert.equal(game.prize, 'S賞');
}

// A 500 chain wheel result counts as S only after the chain payout is banked.
{
  const game = makeGame();
  forceChallenge(game, 6);
  shoot(game, 7); // base JP is 30
  settle(game);
  game.chooseChain(true);
  game.rules.JackpotWeights = [0, 0, 0, 0, 100];
  shoot(game, 6); // pending chain draw is 500
  assert.equal(game.jackpotEarnings, 30);
  assert.equal(game.jackpotDreamHit, false);
  settle(game);
  game.chooseChain(false);
  assert.equal(game.jackpotEarnings, 530);
  assert.equal(game.jackpotDreamHit, true);
  assert.equal(game.prize, 'S賞');
}

{
  const game = makeGame();
  forceChallenge(game, 6);
  shoot(game, 7);
  settle(game);
  game.chooseChain(true);
  game.rules.JackpotWeights = [0, 0, 0, 0, 100];
  shoot(game, 6);
  settle(game);
  game.chooseChain(true);
  shoot(game, 1); // fail and lose the unbanked 500
  assert.equal(game.jackpotDreamHit, false);
  assert.equal(game.jackpotEarnings, 30);
  assert.equal(game.prize, 'C賞');
}

// Reject the superseded six-tier configuration in R3 mode.
assert.throws(() => new MedalRules({ R3Enabled: true, PrizeThresholds: [0, 30, 100, 200, 300, 500],
  PrizeNames: ['参加賞', 'C賞', 'B賞', 'A賞', 'S賞', 'SS賞'] }), /Invalid medal rules/);

// A one-lamp reset in R3 grants protection until a fresh lane restores the previous count.
{
  const game = makeGame();
  game._lamps = new Set([1, 2, 3, 4]);
  game.firstProtection = false;
  game.phase = MedalPhase.Ready;
  const resetShot = game.launch();
  assert.equal(game.resolve(resetShot.id, 1), true);
  assert.equal(game.receipt.kind, MedalEvent.Reset);
  assert.equal(game.receipt.removed, 1);
  assert.equal(game.lampCount, 3);
  assert.equal(game.firstProtection, true);
  settle(game);
  const protectedShot = game.launch();
  assert.equal(game.resolve(protectedShot.id, game.lamps[0]), true);
  assert.equal(game.receipt.kind, MedalEvent.Protected);
  assert.equal(game.lampCount, 3);
}

console.log('R3 rules tests passed');
