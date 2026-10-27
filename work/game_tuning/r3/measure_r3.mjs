import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MedalRules, makeRng } from '../../game_demo/rules/medal_rules.mjs';
import { MedalController } from '../../game_demo/ui/controller.mjs';

const root = new URL('../../../', import.meta.url);
const readProject = path => readFileSync(new URL(path, root));
const baseRules = JSON.parse(readProject('work/game_tuning/r3/rules_r3.json'));
const configPath = process.env.R3_CONFIG_PATH ?? 'work/game_tuning/r3/config_r3.json';
const matrixPath = process.env.R3_MATRIX_PATH ?? 'work/game_tuning/r3/boards/cup1_4_wide20/matrix_new.json';
const samplesPath = process.env.R3_SAMPLES_PATH ?? 'work/game_tuning/r3/boards/cup1_4_wide20/shots.jsonl';
const layoutPath = process.env.R3_LAYOUT_PATH ?? 'work/game_tuning/r3/boards/cup1_4_wide20/layout3.json';
const modelPath = process.env.R3_MODEL_PATH ?? 'work/game_tuning/r3/boards/cup1_4_wide20/model3.json';
const matrix = JSON.parse(readProject(matrixPath));
const period = 5.5;
const wrap = value => ((value % period) + period) % period;
const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : null;
const maskOf = lamps => lamps.reduce((mask, lane) => mask | (1 << (lane - 1)), 0);
const phaseOf = (aim, direction) => (direction > 0 ? (aim >= 0 ? aim / 4 : 1 + aim / 4) : (2 - aim) / 4) * period;
const samples = Array.from({ length: matrix.dirs.length }, () => Array.from({ length: matrix.aims.length }, () => []));
for (const line of readProject(samplesPath).toString('utf8').split('\n')) {
  if (!line) continue;
  const shot = JSON.parse(line);
  samples[matrix.dirs.indexOf(shot.dir)][shot.aimIndex].push([shot.cup, shot.flightSeconds / 0.35, shot.approachX * 1000]);
}
const targets = Array.from({ length: 128 }, (_, mask) => matrix.probability.flatMap((rows, dirIndex) => rows.map((row, aimIndex) => ({
  phase: phaseOf(matrix.aims[aimIndex], matrix.dirs[dirIndex]),
  probability: row.reduce((total, value, lane) => total + ((mask >> lane & 1) ? 0 : value), 0),
}))));

function readHumanFit(logDir = join(homedir(), 'work/pachikoma_release/work/game_demo/ui/logs/human')) {
  if (!existsSync(logDir)) return null;
  const files = readdirSync(logDir, { withFileTypes: true }).flatMap(day => day.isDirectory()
    ? readdirSync(join(logDir, day.name)).filter(name => name.endsWith('.json')).map(name => join(logDir, day.name, name)) : []);
  const docs = files.map(path => JSON.parse(readFileSync(path, 'utf8')));
  const rows = docs.map(doc => {
    const events = doc.events ?? [];
    const jp = events.filter(event => event.kind === 'receipt' && ['Win', 'Miss'].includes(event.detail?.kind) && event.detail?.before?.length === 6);
    const fireInputs = events.filter(event => event.kind === 'input' && event.detail?.action === 'fire');
    const accepted = fireInputs.filter(event => event.detail?.accepted);
    return { jp: jp.length, wins: jp.filter(event => event.detail.kind === 'Win').length,
      awards: jp.filter(event => event.detail.kind === 'Win').map(event => event.detail.award),
      adds: !!doc.result?.addedCredit, acceptedAt: accepted.map(event => Date.parse(event.at) / 1000),
      rawFireAt: fireInputs.map(event => Date.parse(event.at) / 1000) };
  });
  const gaps = rows.flatMap(row => row.acceptedAt.slice(1).map((at, index) => at - row.acceptedAt[index]));
  const rawGaps = rows.flatMap(row => row.rawFireAt.slice(1).map((at, index) => at - row.rawFireAt[index]));
  const opportunities = rows.reduce((total, row) => total + row.jp, 0);
  return { plays: rows.length, completed: docs.filter(doc => doc.status === 'completed').length,
    jpOpportunityDistribution: Object.fromEntries([...new Set(rows.map(row => row.jp))].sort((a, b) => a - b).map(n => [n, rows.filter(row => row.jp === n).length])),
    jpOpportunities: opportunities, jpSuccesses: rows.reduce((n, row) => n + row.wins, 0),
    jpSuccessRate: opportunities ? rows.reduce((n, row) => n + row.wins, 0) / opportunities : 0,
    jpAwardDistribution: Object.fromEntries([...new Set(rows.flatMap(row => row.awards))].sort((a, b) => a - b).map(a => [a, rows.flatMap(row => row.awards).filter(x => x === a).length])),
    extraCreditPlays: rows.filter(row => row.adds).length, acceptedShotsPerPlayMean: mean(rows.map(row => row.acceptedAt.length)),
    acceptedShotGap: { n: gaps.length, mean: mean(gaps), p10: quantile(gaps, .1), median: quantile(gaps, .5), p90: quantile(gaps, .9) },
    rawFireInputGap: { n: rawGaps.length, mean: mean(rawGaps), p10: quantile(rawGaps, .1), median: quantile(rawGaps, .5), p90: quantile(rawGaps, .9) },
    inputBasis: 'rapid4 bootstraps raw fire inputs including rejected attempts; accepted-shot intervals are also reported for comparison' };
}

const gapPool = (() => {
  const human = readHumanFit();
  if (!human) return Array(200).fill(2.3);
  const dir = join(homedir(), 'work/pachikoma_release/work/game_demo/ui/logs/human');
  const gaps = readdirSync(dir, { withFileTypes: true }).flatMap(day => day.isDirectory()
    ? readdirSync(join(dir, day.name)).filter(name => name.endsWith('.json')).flatMap(name => {
      const doc = JSON.parse(readFileSync(join(dir, day.name, name), 'utf8'));
      const times = (doc.events ?? []).filter(event => event.kind === 'input' && event.detail?.action === 'fire').map(event => Date.parse(event.at) / 1000);
      return times.slice(1).map((at, index) => at - times[index]);
    }) : []);
  return gaps.filter(gap => Number.isFinite(gap) && gap >= 0.05 && gap <= 12);
})();

const challengeAimSpeedOverride = process.env.R3_CHALLENGE_AIM_SPEED === undefined
  ? null : Number(process.env.R3_CHALLENGE_AIM_SPEED);
if (challengeAimSpeedOverride !== null && !Number.isFinite(challengeAimSpeedOverride)) throw new Error('R3_CHALLENGE_AIM_SPEED must be numeric');
function rulesFor(overrides = {}, source = baseRules) {
  const speed = source === baseRules && challengeAimSpeedOverride !== null
    ? { ChallengeAimSpeed: challengeAimSpeedOverride } : {};
  return new MedalRules({ ...source, ...speed, ...overrides });
}

async function runSession({ model, fixedAddCount, seed, ruleSet = baseRules }) {
  const random = makeRng(seed ^ 0xabc123);
  const rules = rulesFor({}, ruleSet);
  const out = { model, fixedAddCount, seed, shots: 0, presses: 0, blocked: 0, jpAwards: [], chainAwards: [],
    chainAttempts: 0, chainWins: 0, chainFailures: 0, chainRounds: 0, bankedChainDraws: 0,
    additions: 0, shotGaps: [],
    jpChances: 0, jpWins: 0, wallet: 0, prize: 0, seconds: 0,
    currentJpSequenceEarnings: 0, bestJpSequenceEarnings: 0 };
  let now = 0, nextPress = 0.1, nextAimed = null, aimKey = null, seenReceipt = -1;
  let chainOfferKey = null, addOfferKey = null, lastShotAt = null;
  const flights = [];
  const rapid = model === 'rapid4';
  const gap = model === 'ordinary' ? 1.1 : 0.6;
  const error = model === 'ordinary' ? 2 : 1;
  const controller = new MedalController({ rules, seed, hooks: { launchBall(shot, aim, direction) {
    out.shots++;
    if (shot.challenge && shot.lamps.length === 6 && !shot.chain) out.jpChances++;
    if (lastShotAt !== null) out.shotGaps.push(now - lastShotAt);
    lastShotAt = now;
    if (shot.chain) out.chainAttempts++;
    const position = Math.max(0, Math.min(matrix.aims.length - 1, (aim + 1) * (matrix.aims.length - 1) / 2));
    const index = Math.min(matrix.aims.length - 1, Math.floor(position) + (random() < position % 1 ? 1 : 0));
    const pool = samples[matrix.dirs.indexOf(direction)][index];
    const [lane, flightSeconds] = pool[Math.floor(random() * pool.length)];
    flights.push({ id: shot.id, lane, at: now + flightSeconds });
    flights.sort((a, b) => a.at - b.at);
  } } });
  const game = controller.game;
  controller.dispatch('start');
  while (game.phase !== 'Result' && now < 600) {
    now += 1 / 60; controller.update(1 / 60);
    while (flights.length && flights[0].at <= now + 1e-9) {
      const landing = flights.shift(); controller.landing(landing.id, landing.lane);
    }
    const receipt = game.receipt;
    if (receipt && receipt.id !== seenReceipt) {
      seenReceipt = receipt.id;
      if (receipt.kind === 'Win' && receipt.jackpot >= 0) {
        if (receipt.chain) { out.chainWins++; out.chainAwards.push(receipt.award); }
        else {
          out.jpWins++; out.jpAwards.push(receipt.award);
          out.currentJpSequenceEarnings = receipt.award;
          out.bestJpSequenceEarnings = Math.max(out.bestJpSequenceEarnings, receipt.award);
        }
      }
      if (receipt.chainBanked) {
        out.bankedChainDraws += receipt.chainStage ?? 0;
        out.bestJpSequenceEarnings = Math.max(out.bestJpSequenceEarnings,
          (receipt.chainBase ?? out.currentJpSequenceEarnings) + receipt.award);
        out.currentJpSequenceEarnings = 0;
      }
      if (receipt.kind === 'Miss' && receipt.chain) out.chainFailures++;
    }
    if (game.phase === 'ChainChoice') {
      const key = `${receipt?.id}:${game.chainStatus?.successes}`;
      if (key !== chainOfferKey) {
        chainOfferKey = key;
        const wins = game.chainStatus?.successes ?? 0;
        const continueChain = game.secondsLeft > 0 && game.wallet > 0 && (model === 'rapid4' || (wins === 0 && (model === 'skilled' || random() < 0.5)));
        controller.dispatch(continueChain ? 'chainContinue' : 'chainStop');
      }
      continue;
    }
    if (game.phase === 'Continue') {
      const key = `${game.extraCreditsUsed}`;
      if (game.extraCreditsUsed < fixedAddCount && key !== addOfferKey) {
        addOfferKey = key;
        if (controller.dispatch('add')) out.additions++;
      }
      continue;
    }
    addOfferKey = null;

    if (rapid) {
      const rapidPulse = Number(process.argv[4] ?? 0);
      if (now >= nextPress) {
        const accepted = controller.dispatch('fire');
        out.presses++; if (!accepted) out.blocked++;
        nextPress = now + (rapidPulse > 0 ? rapidPulse * (0.9 + random() * 0.2) : gapPool[Math.floor(random() * gapPool.length)]);
      }
    } else if (game.canAim && game.canFire && !controller.preBuffer && now >= nextPress) {
      const mask = maskOf(game.lamps), speed = game.challengeAimSpeed;
      const currentKey = `${mask}:${speed}:${game.armed}`;
      if (currentKey !== aimKey) { nextAimed = null; aimKey = currentKey; }
      if (nextAimed === null) {
        let best = -Infinity, target = controller.aimClock;
        for (const cell of targets[mask]) {
          const wait = wrap(cell.phase - wrap(controller.aimClock));
          const utility = cell.probability - 0.04 * wait / speed;
          if (utility > best) { best = utility; target = controller.aimClock + wait; }
        }
        nextAimed = target + (random() * 2 - 1) * error * 0.025 / (4 / period);
      }
      if (controller.aimClock + 1e-9 >= nextAimed) {
        out.presses++; if (!controller.dispatch('fire')) out.blocked++;
        nextPress = now + gap; nextAimed = null;
      }
    }
    if (game.phase === 'Fault') game.finish();
  }
  out.seconds = now + 11; // start前の既存how-to表示を加算
  out.wallet = game.wallet; out.jackpotEarnings = game.jackpotEarnings; out.prize = rules.PrizeNames.indexOf(game.prize);
  out.jackpotDreamHit = game.jackpotDreamHit;
  out.chainRounds = game.chainSuccesses;
  out.extraCreditsUsed = game.extraCreditsUsed;
  if (game.wallet !== game.purchased + game.won - game.spent) throw new Error(`wallet ledger drift: ${model}/${seed}`);
  if (game.phase !== 'Result') throw new Error(`session timeout: ${model}/${seed}/${game.phase}`);
  return out;
}

function histogram(values) {
  return Object.fromEntries([...new Set(values)].sort((a, b) => a - b).map(value => [value, values.filter(item => item === value).length]));
}
function rankForScore(score, secured500, thresholds = baseRules.PrizeThresholds) {
  if (secured500) return 4;
  let rank = 0;
  for (let index = 0; index <= 3; index++) if (thresholds[index] <= score) rank = index;
  return rank;
}
function awardRates(runs, rankOf) {
  const ranks = runs.map(rankOf);
  return Object.fromEntries([['CplusPct', 1], ['BplusPct', 2], ['AplusPct', 3]]
    .map(([key, minimum]) => [key, 100 * ranks.filter(rank => rank >= minimum).length / runs.length]));
}
const fixedJackpotHitProbability = baseRules.JackpotWeights.at(-1) / baseRules.JackpotWeights.reduce((total, weight) => total + weight, 0);
const additionThresholdScale = 0.125;
function summarize(runs) {
  const jpAttempts = runs.reduce((n, run) => n + run.jpChances, 0);
  const jpWins = runs.reduce((n, run) => n + run.jpWins, 0);
  const wallets = runs.map(run => run.wallet);
  const jackpotEarnings = runs.map(run => run.jackpotEarnings);
  const paidWheelDraws = runs.map(run => run.jpAwards.length + run.bankedChainDraws);
  const prizeCounts = Array.from({ length: 5 }, (_, rank) => runs.filter(run => run.prize === rank).length);
  const cumulativeRates = awardRates(runs, run => run.prize);
  const maxSequenceRates = awardRates(runs, run => rankForScore(run.bestJpSequenceEarnings, run.jackpotDreamHit));
  const additionScaledRates = awardRates(runs, run => {
    const scale = 1 + additionThresholdScale * run.extraCreditsUsed;
    const thresholds = baseRules.PrizeThresholds.map((value, index) => index <= 3 ? value * scale : value);
    return rankForScore(run.jackpotEarnings, run.jackpotDreamHit, thresholds);
  });
  return { sessions: runs.length, jpOpportunityDistribution: histogram(runs.map(run => run.jpChances)),
    jpOpportunitiesPerPlay: mean(runs.map(run => run.jpChances)), jpAtLeastOnePct: 100 * runs.filter(run => run.jpChances > 0).length / runs.length,
    jpSuccessRatePct: jpAttempts ? 100 * jpWins / jpAttempts : 0,
    chainAttemptsPerPlay: mean(runs.map(run => run.chainAttempts)), chainSuccessesPerPlay: mean(runs.map(run => run.chainRounds)),
    chainFailurePerPlay: mean(runs.map(run => run.chainFailures)), chainRoundsDistribution: histogram(runs.map(run => run.chainRounds)),
    prizeDistributionPct: prizeCounts.map(count => 100 * count / runs.length),
    prizeCounts: Object.fromEntries(['参加賞', 'C賞', 'B賞', 'A賞', 'S賞'].map((name, rank) => [name, prizeCounts[rank]])),
    awardThresholdModes: {
      cumulativeJpAndBankedChain: cumulativeRates,
      highestSingleJpAndBankedChainSequence: maxSequenceRates,
      cumulativeWithAdditionScaledThresholds: additionScaledRates },
    meanFinalWallet: mean(wallets), meanJpEarningsPerPlay: mean(runs.map(run => run.jackpotEarnings)),
    jackpotEarningsQuantiles: Object.fromEntries([0.5, 0.9, 0.95, 0.98, 0.99, 0.995, 1]
      .map(q => [`p${String(q * 100).replace('.', '_')}`, quantile(jackpotEarnings, q)])),
    meanPaidJackpotWheelDrawsPerPlay: mean(paidWheelDraws),
    estimatedSChancePerPlayPct: 100 * mean(paidWheelDraws.map(draws => 1 - (1 - fixedJackpotHitProbability) ** draws)),
    estimatedSFrequencyPerMillionPlays: 1_000_000 * mean(paidWheelDraws.map(draws => 1 - (1 - fixedJackpotHitProbability) ** draws)),
    observedSHits: runs.filter(run => run.jackpotDreamHit).length,
    finalWalletQuantiles: Object.fromEntries([0.25, 0.4, 0.5, 0.65, 0.8, 0.9, 0.95, 0.98, 0.99, 1]
      .map(q => [`p${Math.round(q * 100)}`, quantile(wallets, q)])),
    meanShotsPerPlay: mean(runs.map(run => run.shots)), meanPlaySeconds: mean(runs.map(run => run.seconds)),
    meanAdditions: mean(runs.map(run => run.additions)), meanAcceptedShotGap: mean(runs.flatMap(run => run.shotGaps)),
    jpAwardDistribution: histogram(runs.flatMap(run => run.jpAwards)), chainWheelDistribution: histogram(runs.flatMap(run => run.chainAwards)),
    fiveHundredPerPlayPct: 100 * runs.filter(run => run.jackpotDreamHit).length / runs.length };
}

const sessions = Number(process.argv[2] ?? 500);
const seedBase = Number(process.argv[3] ?? 20261019);
const results = [];
for (const model of ['rapid4', 'ordinary', 'skilled']) for (let fixedAddCount = 0; fixedAddCount <= 4; fixedAddCount++) {
  const runs = [];
  for (let index = 0; index < sessions; index++) runs.push(await runSession({ model, fixedAddCount,
    seed: seedBase + index * 7919 }));
  if (runs.some(run => run.extraCreditsUsed !== fixedAddCount)) {
    throw new Error(`fixed addition target not reached: ${model}/${fixedAddCount}`);
  }
  const summary = summarize(runs);
  results.push({ model, fixedAddCount, summary });
  console.log(JSON.stringify({ model, fixedAddCount, ...summary }));
}
const humanFit = readHumanFit();
const hashes = Object.fromEntries([matrixPath, samplesPath, layoutPath, modelPath, configPath,
  'work/game_tuning/r3/rules_r3.json'].map(path =>
  [path, createHash('sha256').update(readProject(path)).digest('hex')]));
const artifact = { seed: seedBase, sessionsPerModel: sessions, model: {
  rapid4: 'bootstrap raw fire-input intervals, accepted and rejected, from the 73 human logs; random aim sweep',
  ordinary: '1.1s aimed shots, matrix-maximizing target with ±2 aim error; first chain continuation coin flip',
  skilled: '0.6s aimed shots, matrix-maximizing target with ±1 aim error; tries the first continuation and banks after a win',
  challengeAimSpeed: challengeAimSpeedOverride ?? baseRules.ChallengeAimSpeed,
  fixedAdditions: 'A run accepts exactly the requested number (0-4) of extra credits, each adding 22 seconds.',
  awardScoring: 'Current score sums immediate JP awards and only banked chain awards; loan balls are excluded. S requires a secured 500.',
  mitigationScoring: `Max-sequence mode uses the highest single base JP plus its banked chain; scaled-threshold mode raises C/B/A thresholds by ${additionThresholdScale * 100}% per accepted extra credit.`,
  sProbabilityCalculation: `S uses a secured 500 award. The per-draw weight is ${baseRules.JackpotWeights.at(-1)} / ${baseRules.JackpotWeights.reduce((total, weight) => total + weight, 0)}; per-play probability is estimated analytically from the number of base and banked chain wheel draws, since direct hits are too rare to sample reliably.` },
  board: { configPath, layoutPath, modelPath, matrixPath, samplesPath },
  humanFit, hashes, results };
const outputPath = process.env.R3_OUTPUT_PATH ?? new URL('measurement_r3.json', import.meta.url);
writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n');
