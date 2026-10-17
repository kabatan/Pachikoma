import assert from 'node:assert/strict';
import { HumanHistory } from './human_history.mjs';

const saved = new Map();
const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
const docs = [];
let clock = 0;
const now = () => new Date(1_700_000_000_000 + clock++ * 1000);
const makeId = () => '11111111-1111-4111-8111-111111111111';
const game = {
  phase: 'Attract', wallet: 0, purchased: 0, spent: 0, won: 0,
  attempts: 0, successes: 0, lamps: [], maxLamps: 0, bestAward: 0,
  addedCredit: false, secondsLeft: 0, prize: '参加賞', endReason: '',
};
const transport = async (_url, options) => {
  docs.push(JSON.parse(options.body));
  return { ok: true, text: async () => '' };
};
const history = new HumanHistory({ storage, transport, now, makeId });
history.setContext({ configName: 'test' });
history.begin(game);
history.input({ source: 'cabinet', action: 'start', accepted: true, phase: 'Attract' }, game);
game.phase = 'Ready'; game.wallet = 14; game.purchased = 15; game.secondsLeft = 70;
history.action('start', game);
history.input({ source: 'keyboard', action: 'fire', accepted: true, phase: 'Ready' }, game);
game.wallet = 13; game.spent = 1;
history.gameEvent('receipt', { kind: 'fresh', lane: 3 }, game);
game.phase = 'Result'; game.endReason = '時間になりました';
history.finish(game);
await history.flush();
const final = docs.at(-1);
assert.equal(final.status, 'completed');
assert.equal(final.playId, makeId());
assert.equal(final.context.configName, 'test');
assert.equal(final.result.wallet, 13);
assert.equal(final.result.spent, 1);
assert.deepEqual(final.inputCounts, { cabinet: 1, keyboard: 1, pointer: 0 });
assert.deepEqual(final.events.map(event => event.kind), ['input', 'action', 'input', 'receipt', 'result']);
assert.equal(JSON.parse(saved.get('pachikoma-human-play-pending'))[makeId()], undefined);

const failed = new HumanHistory({ storage, transport: async () => ({ ok: false }), now, makeId });
failed.begin(game);
await failed.flush();
assert.ok(JSON.parse(saved.get('pachikoma-human-play-pending'))[makeId()]);
const recovered = new HumanHistory({ storage, transport, now, makeId });
await recovered.flush();
assert.equal(JSON.parse(saved.get('pachikoma-human-play-pending'))[makeId()], undefined);
console.log('PASS anonymous human play snapshots, input sources and retry');
