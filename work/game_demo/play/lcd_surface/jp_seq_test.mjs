// Node だけで、配当の並び・煽りの抽選・場面の区切りを確かめる（外部ライブラリ・ブラウザ不要）
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJpSeq, planPayout } from './jp_seq.mjs';

const ruleUrl = new URL('../../../effects/jp_film/review/payout_tease_rule.json', import.meta.url);
const manifestUrl = new URL('../../../effects/jp_film/tmp/export/manifest.json', import.meta.url);
const [rule, manifest] = await Promise.all([ruleUrl, manifestUrl].map(async (url) => JSON.parse(await readFile(url, 'utf8'))));
const payouts = [30, 40, 100, 200, 500], steps = ['30to40', '40to100', '100to200'];
const names = new Set(manifest.map((s) => s.name));
const teaseNames = steps.flatMap((step) => ['up', 'stay'].flatMap((result) => ['S', 'W'].map((strength) => `S5_${step}_${result}_${strength}`)));
// 流れ第2版（10/24）で昇格の場面は書き出しから外した。planPayout の単体の確かめは、昇格の素材がある前提の名前で続ける
const legacyNames = ['S4a_hit', 'S5_30', 'S5_fake500', ...payouts.map((p) => `S5_${p}_get`)];
const allNames = new Set([...names, ...teaseNames, ...legacyNames]), has = (name) => allNames.has(name);
const expected = [
  ['S4a_hit', 'S5_30', 'S5_30to40_stay_S', 'S5_30_get'],
  ['S4a_hit', 'S5_30', 'S5_30to40_up_S', 'S5_40to100_stay_S', 'S5_40_get'],
  ['S4a_hit', 'S5_30', 'S5_30to40_up_S', 'S5_40to100_up_S', 'S5_100to200_stay_S', 'S5_100_get'],
  ['S4a_hit', 'S5_30', 'S5_30to40_up_S', 'S5_40to100_up_S', 'S5_100to200_up_S', 'S5_200_get'],
  ['S4a_hit', 'S5_30', 'S5_30to40_up_S', 'S5_40to100_up_S', 'S5_100to200_up_S', 'S5_fake500', 'S5_500_get'],
];
const intro = [...(names.has('S2_intro') ? ['S2_intro'] : []), 'S1_jpchance', 'S3a_intro', 'S3c_exit'];   // 流れ第2版：6 灯でリールが回る S2_intro が最初、次に JPチャンス
const legacy = payouts.map((payout) => names.has('S5_30') ? ['S4a_hit', 'S5_30', ...[40, 100, 200].filter((n) => payout >= n).map((n) => `S5_up${n}`), ...(payout === 500 ? ['S5_fake500'] : []), `S5_${payout}_get`] : ['S4a_hit', `S5_${payout}_get`]);   // 昇格を外した書き出しでは大当りから獲得の止めへ（ルーレットが届くまでの仮）
const rows = [], rates = [];
async function test(name, run) {
  try { await run(); rows.push({ 試験: name, 結果: 'PASS' }); }
  catch (e) { rows.push({ 試験: name, 結果: 'FAIL' }); console.error(`${name}:`, e.stack); process.exitCode = 1; }
}
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
const weak = (path) => path.map((name) => name.replace(/_S$/, '_W'));

for (const [i, payout] of payouts.entries()) await test(`配当 ${payout} の並び（強・弱）`, () => {
  assert.deepEqual(planPayout(payout, rule, has, () => 0), expected[i]);
  assert.deepEqual(planPayout(payout, rule, has, () => 0.999999), weak(expected[i]));
});

for (const [i, step] of steps.entries()) for (const result of ['up', 'stay']) await test(`${step} ${result} の強の割合（10万回）`, () => {
  const payout = (result === 'up' ? [40, 100, 200] : [30, 40, 100])[i];
  const weight = rule.steps[step][`strong_weight_if_${result}`], rand = seeded(20261024 + i * 2 + (result === 'up' ? 1 : 0));
  let strong = 0;
  for (let n = 0; n < 100000; n++) {
    const path = planPayout(payout, rule, has, rand);
    assert.ok(path.includes(`S5_${step}_${result}_S`) || path.includes(`S5_${step}_${result}_W`));
    if (path.includes(`S5_${step}_${result}_S`)) strong++;
  }
  const actual = strong / 100000;
  rates.push({ 段: step, 結果: result, 回数: 100000, 規則: `${(weight * 100).toFixed(2)}%`, 実測: `${(actual * 100).toFixed(2)}%` });
  assert.ok(Math.abs(actual - weight) <= 0.01, `${actual} / ${weight}`);
});

await test('強弱の境界・抽選回数・up_prob は使わない', () => {
  const altered = { steps: Object.fromEntries(steps.map((step) => [step, { ...rule.steps[step], up_prob: 0 }])) };
  for (const [i, payout] of payouts.entries()) {
    let draws = 0;
    assert.deepEqual(planPayout(payout, altered, has, () => { draws++; return 0; }), expected[i]);
    assert.equal(draws, expected[i].filter((name) => teaseNames.includes(name)).length);
  }
  for (const [i, step] of steps.entries()) for (const result of ['up', 'stay']) {
    const payout = (result === 'up' ? [40, 100, 200] : [30, 40, 100])[i], weight = rule.steps[step][`strong_weight_if_${result}`];
    assert.ok(planPayout(payout, rule, has, () => weight).includes(`S5_${step}_${result}_W`));
    assert.ok(planPayout(payout, rule, has, () => weight - 1e-6).includes(`S5_${step}_${result}_S`));
  }
});

await test('引いた素材がない時は反対の強弱', () => {
  for (const [i, payout] of payouts.entries()) {
    assert.deepEqual(planPayout(payout, rule, (n) => has(n) && !n.endsWith('_W'), () => 0.99), expected[i]);
    assert.deepEqual(planPayout(payout, rule, (n) => has(n) && !n.endsWith('_S'), () => 0), weak(expected[i]));
  }
});

await test('必要な段の素材が両方なければ従来の道（抽選なし）', () => {
  for (const step of steps) assert.equal(planPayout(200, rule, (n) => has(n) && !n.startsWith(`S5_${step}_`), () => assert.fail('不要な抽選')), null);
  assert.deepEqual(planPayout(30, rule, (n) => has(n) && !n.startsWith('S5_40to100_'), () => 0), expected[0]);
  assert.deepEqual(planPayout(30, rule, (n) => has(n) && !n.startsWith('S5_30to40_up_'), () => 0), expected[0]);
});

await test('規則なし・不正な重み・必要素材なしは従来の道', () => {
  for (const invalid of [null, {}, { steps: {} }, { steps: { '30to40': { strong_weight_if_stay: 2 } } }]) assert.equal(planPayout(30, invalid, has, () => assert.fail('不要な抽選')), null);
  for (const missing of ['S4a_hit', 'S5_30', 'S5_fake500', 'S5_500_get']) assert.equal(planPayout(500, rule, (n) => has(n) && n !== missing, () => assert.fail('不要な抽選')), null);
});

await test('現在の manifest は全配当で null（抽選なし）', () => {
  for (const payout of payouts) assert.equal(planPayout(payout, rule, (n) => names.has(n), () => assert.fail('不要な抽選')), null);
});

// 映像は時刻と再生状態だけのオブジェクトに置き換える。frame() の切り替えと log は実物を使う
const enriched = [...manifest, ...[...teaseNames, ...legacyNames.filter((n) => !names.has(n))].map((name) => ({ name, file: `${name}.mp4`, frames: 9, loop: false, next: [], cut_frames: [0] }))];
async function withSeq(scenes, options, run) {
  const saved = Object.fromEntries(['fetch', 'document', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const warn = console.warn, warnings = [], requests = [], logs = [];
  const source = 'https://jp.test/export/manifest.json', customRule = 'https://jp.test/custom-rule.json';
  let seq;
  try {
    console.warn = (...args) => warnings.push(args);
    globalThis.location = { href: 'https://jp.test/' };
    globalThis.document = { createElement(tag) {
      assert.equal(tag, 'video');
      return { currentTime: 0, readyState: 2, paused: true, ended: false, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
    } };
    globalThis.fetch = async (url) => {
      const href = String(url); requests.push(href);
      if (href === source) return { ok: true, json: async () => scenes };
      if (href === (options.customRule ? customRule : ruleUrl.href)) {
        if (options.ruleFailure === 'network') throw new Error('offline');
        return { ok: options.ruleFailure !== 'http', status: 404, json: async () => {
          if (options.ruleFailure === 'json') throw new SyntaxError('invalid json');
          return rule;
        } };
      }
      assert.ok(href.startsWith('https://jp.test/export/'), `想定外の URL: ${href}`);
      return { ok: true, blob: async () => new Blob([]) };
    };
    seq = await createJpSeq({ manifestUrl: source, log: (name) => logs.push(name), rand: options.rand ?? (() => 0), ...(options.customRule ? { teaseRuleUrl: customRule } : {}) });
    assert.ok(seq);
    assert.ok(requests.includes(options.customRule ? customRule : ruleUrl.href));
    assert.equal(warnings.length, options.ruleFailure ? 1 : 0);
    seq.setManual(true); seq.onEvent('lamp6');
    await run(seq, logs);
  } finally {
    seq?.dispose(); console.warn = warn;
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}
function frames(seq, count) { for (let i = 0; i < count; i++) seq.frame(1 / 30); }
function until(seq, logs, name) {
  for (let i = 0; i < 6000 && logs.at(-1) !== name && seq.active; i++) frames(seq, 1);
  assert.equal(logs.at(-1), name);
}

await test('現在の manifest の実再生順は従来どおり（全5配当）', async () => {
  for (const [i, payout] of payouts.entries()) await withSeq(manifest, { rand: () => assert.fail('不要な抽選') }, (seq, logs) => {
    seq.onEvent('jp', { payout, duration: 200 });
    until(seq, logs, `S5_${payout}_get`);
    assert.deepEqual(logs, [...intro, ...legacy[i]]);
    const count = logs.length; frames(seq, 180);
    assert.equal(logs.length, count); assert.equal(seq.active, true);
  });
});

await test('煽りの実再生順・log・最後のループ（全5配当）', async () => {
  for (const [i, payout] of payouts.entries()) await withSeq(enriched, { customRule: true }, (seq, logs) => {
    seq.onEvent('jp', { payout, duration: 200 });
    until(seq, logs, `S5_${payout}_get`);
    assert.deepEqual(logs, [...intro, ...expected[i]]);
    const count = logs.length; frames(seq, 180);
    assert.equal(logs.length, count); assert.equal(seq.active, true);
  });
});

await test('S3b は切ってよいコマ、1回の場面は最後のコマ', async () => {
  await withSeq(enriched, {}, (seq, logs) => {
    seq.onEvent('challenge_flight'); until(seq, logs, 'S3b_loop');
    frames(seq, 2); seq.onEvent('jp', { payout: 100, duration: 200 });
    frames(seq, 5); assert.equal(logs.at(-1), 'S3b_loop');
    frames(seq, 1); assert.equal(logs.at(-1), 'S3c_exit');
    frames(seq, 6); assert.equal(logs.at(-1), 'S3c_exit');
    frames(seq, 1); assert.equal(logs.at(-1), 'S4a_hit');
    until(seq, logs, 'S5_100to200_stay_S');
    frames(seq, 7); assert.equal(logs.at(-1), 'S5_100to200_stay_S');
    frames(seq, 1); assert.equal(logs.at(-1), 'S5_100_get');
    assert.deepEqual(logs.slice(logs.indexOf('S4a_hit')), expected[2]);
  });
});

await test('S3c の途中で JP が来ても入口まで next をたどる', async () => {
  await withSeq(enriched, {}, (seq, logs) => {
    seq.onEvent('challenge_flight'); until(seq, logs, 'S3b_loop');
    seq.onEvent('jp', { payout: 30, duration: 200 }); until(seq, logs, 'S3c_exit');
    frames(seq, 2); seq.onEvent('jp', { payout: 40, duration: 200 });
    until(seq, logs, 'S5_40_get');
    assert.deepEqual(logs.slice(logs.indexOf('S4a_hit')), expected[1]);
  });
});

await test('最後の場面がループでなければ最後のコマで終了', async () => {
  const scenes = enriched.map((s) => s.name === 'S5_30_get' ? { ...s, loop: false } : s);
  await withSeq(scenes, {}, (seq, logs) => {
    seq.onEvent('jp', { payout: 30, duration: 200 }); until(seq, logs, 'S5_30_get');
    frames(seq, 10); assert.equal(seq.active, true);
    frames(seq, 1); assert.equal(seq.active, false);
  });
});

await test('規則の取得・JSON 読み込み失敗時は従来の道', async () => {
  for (const ruleFailure of ['network', 'http', 'json']) await withSeq(enriched, { ruleFailure, rand: () => assert.fail('不要な抽選') }, (seq, logs) => {
    seq.onEvent('jp', { payout: 500, duration: 200 }); until(seq, logs, 'S5_500_get');
    assert.deepEqual(logs, [...intro, ...legacy[4]]);
  });
});

await test('途中の段の素材がない時も実再生は全体を従来の道へ戻す', async () => {
  await withSeq(enriched.filter((s) => !s.name.startsWith('S5_40to100_')), {}, (seq, logs) => {
    seq.onEvent('jp', { payout: 200, duration: 200 }); until(seq, logs, 'S5_200_get');
    assert.deepEqual(logs, [...intro, ...legacy[3]]);
  });
});

// 継続(R3)の出来事の並び：本物の規則・Presenter・演出のバスをつなぎ、JP→継続の選択→継続の挑戦→決着 で出る演出の出来事を確かめる
{
  const { MedalRules } = await import('../../rules/medal_rules.mjs');
  const { MedalController } = await import('../../ui/controller.mjs');
  const { MedalPresenter } = await import('../../ui/presenter.mjs');
  const { EffectsBus, connectEffects } = await import('../effects_bus.mjs');
  const r3 = JSON.parse(await readFile(new URL('../../../game_tuning/r3/rules_r3.json', import.meta.url), 'utf8'));
  const CHAIN = ['jp', 'fail', 'chain_choice', 'chain_continue', 'chain_stop', 'challenge_flight', 'add100', 'timeup', 'finish_count', 'success_small', 'success_big'];
  const session = () => {
    const ctrl = new MedalController({ rules: new MedalRules({ ...r3, JackpotWeights: [100, 0, 0, 0, 0] }), seed: 3 });
    ctrl.howtoSeconds = 0;
    const presenter = new MedalPresenter(ctrl), bus = new EffectsBus(), events = [];
    bus.on('*', (e) => { if (CHAIN.includes(e.id)) events.push(e); });
    const bridge = connectEffects({ ctrl, presenter, bus });
    const tick = (dt) => { bridge.advance(dt); ctrl.update(dt); presenter.update(dt); bridge.sync(); };
    const act = (name) => { ctrl.update(0); assert.ok(ctrl.dispatch(name), name); presenter.update(0); bridge.sync(); };
    const g = () => ctrl.game;
    const settle = () => { for (let i = 0; i < 400 && g().phase === 'Effect'; i++) tick(0.1); tick(0.1); };
    const shoot = (lane) => {   // 盤が空のときに 1 球（勝負の構えの 0.6 秒を待つ）
      for (let i = 0; i < 40 && !g().canFire; i++) tick(0.05);
      act('fire'); const id = g().shot.id;
      bridge.physics({ type: 'launch', shotId: id }); tick(0.1);
      assert.ok(ctrl.landing(id, lane)); bridge.physics({ type: 'cup', cup: lane, shotId: id }); presenter.update(0); bridge.sync();
    };
    const unlit = () => [1, 2, 3, 4, 5, 6, 7].find((l) => !g().lamps.includes(l));
    const jackpot = () => { g()._lamps = new Set([1, 2, 3, 4, 5, 6]); g().armed = true; g().challengeIntent = { stage: 'ready', forced: true, left: 0 }; shoot(7); settle(); };
    act('start'); settle();
    return { ctrl, g, events, tick, act, settle, shoot, unlit, jackpot, ids: () => events.map((e) => e.id) };
  };
  const pick = (e, keys) => Object.fromEntries(keys.map((k) => [k, e.data[k]]));

  await test('継続：JP→継続2回→時間切れで追加→外れで積み増しを失う', () => {
    const s = session();
    s.jackpot();
    const L1 = s.g().chainStatus.nextLamps;
    assert.deepEqual(s.ids(), ['challenge_flight', 'jp', 'chain_choice']);
    assert.deepEqual(pick(s.events[0], ['chain', 'chainStage', 'lamps']), { chain: false, chainStage: 0, lamps: 6 });
    assert.deepEqual(pick(s.events[1], ['payout', 'chain', 'chainStage', 'chainLost', 'pending', 'base', 'paid']), { payout: 30, chain: false, chainStage: 0, chainLost: 0, pending: 0, base: 30, paid: true });
    assert.deepEqual(pick(s.events[2], ['pending', 'chain', 'lamps', 'base', 'resumed']), { pending: 0, chain: 0, lamps: L1, base: 30, resumed: false });
    s.events.length = 0;
    s.act('chainContinue'); assert.equal(s.g().lampCount, L1); s.shoot(s.unlit()); s.settle();
    const L2 = s.g().chainStatus.nextLamps;
    assert.deepEqual(s.ids(), ['chain_continue', 'challenge_flight', 'jp', 'chain_choice']);
    assert.deepEqual(pick(s.events.shift(), ['chain', 'lamps', 'pending', 'base']), { chain: 0, lamps: L1, pending: 0, base: 30 });
    assert.deepEqual(pick(s.events[0], ['chain', 'chainStage', 'lamps']), { chain: true, chainStage: 1, lamps: L1 });
    assert.deepEqual(pick(s.events[1], ['payout', 'chain', 'chainStage', 'pending', 'base', 'paid']), { payout: 30, chain: true, chainStage: 1, pending: 30, base: 30, paid: false });
    assert.deepEqual(pick(s.events[2], ['pending', 'chain', 'lamps', 'resumed']), { pending: 30, chain: 1, lamps: L2, resumed: false });
    s.events.length = 0;
    s.g().secondsLeft = 0; for (let i = 0; i < 20; i++) s.tick(0.1);   // 継続の選択中に時間切れ（猶予1.5秒）→ 追加の受付
    assert.equal(s.g().phase, 'Continue');
    s.act('add'); s.settle();
    assert.deepEqual(s.ids(), ['timeup', 'add100', 'chain_choice']);
    assert.deepEqual(pick(s.events[1], ['chain', 'chainPending']), { chain: true, chainPending: 30 });
    assert.deepEqual(pick(s.events[2], ['pending', 'chain', 'lamps', 'resumed']), { pending: 30, chain: 1, lamps: L2, resumed: true });
    s.events.length = 0;
    s.act('chainContinue'); s.shoot(s.g().lamps[0]); s.settle();
    assert.deepEqual(s.ids(), ['chain_continue', 'challenge_flight', 'fail']);
    assert.deepEqual(pick(s.events.shift(), ['chain', 'lamps', 'pending']), { chain: 1, lamps: L2, pending: 30 });
    assert.deepEqual(pick(s.events[0], ['chain', 'chainStage', 'lamps']), { chain: true, chainStage: 2, lamps: L2 });
    assert.deepEqual(pick(s.events[1], ['chain', 'chainStage', 'chainLost', 'base']), { chain: true, chainStage: 2, chainLost: 30, base: 30 });
    assert.equal(s.g().phase, 'Ready');
    s.events.length = 0; s.jackpot();   // 同じ遊びの2回目のJPは新しい選択（resumed にならない）
    assert.deepEqual(pick(s.events.find((e) => e.id === 'chain_choice'), ['chain', 'resumed']), { chain: 0, resumed: false });
  });

  await test('景品は持ち玉でなくJPの合計で決まる（R3、計数・結果の「次まで」）', () => {
    const s = session(), th = s.g().rules.PrizeThresholds;
    s.jackpot(); s.act('chainStop'); s.settle(); s.events.length = 0;
    s.g().extraCreditsUsed = s.g().rules.MaxExtraCredits; s.g().secondsLeft = 0;
    for (let i = 0; i < 20; i++) s.tick(0.1);
    const fc = s.events.find((e) => e.id === 'finish_count');
    assert.equal(s.g().prize, 'C賞');
    assert.deepEqual(pick(fc, ['rankIndex', 'score', 'next_rank', 'to_next', 'next_threshold']), { rankIndex: 1, score: 30, next_rank: 2, to_next: th[2] - 30, next_threshold: th[2] });
    assert.notEqual(fc.data.balls, 30);   // 持ち玉(数十玉)とは別
  });

  await test('継続：1回成功してやめる・すぐやめる・計数で払い出し', () => {
    const a = session();
    a.jackpot(); a.act('chainContinue'); a.shoot(a.unlit()); a.settle(); a.events.length = 0;
    a.act('chainStop');
    assert.deepEqual(a.ids(), ['chain_stop']);
    assert.deepEqual(pick(a.events[0], ['banked', 'chain', 'base', 'total', 'reason']), { banked: 30, chain: 1, base: 30, total: 60, reason: 'stop' });
    a.settle(); assert.deepEqual(a.ids(), ['chain_stop']);   // 払い出しのレシートで jp・success を重ねて出さない
    const b = session();
    b.jackpot(); b.events.length = 0; b.act('chainStop');
    assert.deepEqual(b.ids(), ['chain_stop']);
    assert.deepEqual(pick(b.events[0], ['banked', 'chain', 'base', 'total', 'reason']), { banked: 0, chain: 0, base: 30, total: 30, reason: 'stop' });
    const c = session();
    c.g().extraCreditsUsed = c.g().rules.MaxExtraCredits;
    c.jackpot(); c.act('chainContinue'); c.shoot(c.unlit()); c.settle(); c.events.length = 0;
    c.g().secondsLeft = 0; for (let i = 0; i < 20; i++) c.tick(0.1);   // 追加を使い切って時間切れ → 計数で積み増しを払う
    assert.equal(c.g().phase, 'Result');
    assert.deepEqual(c.ids(), ['chain_stop', 'finish_count']);
    assert.deepEqual(pick(c.events[0], ['banked', 'chain', 'reason']), { banked: 30, chain: 1, reason: 'finish' });
  });
}

// 流れ第2版：6 灯 → リール S2_intro → JPチャンス S1 → 狙え。題字の 0.5 秒以降と狙えの間は、発射で 0.15 秒の白を挟んでカットインへ
await test('流れ第2版：割り込み（題字の0.5秒前は待つ・後と狙えはすぐ）と白', async () => {
  if (!names.has('S2_intro')) return;
  await withSeq(manifest, {}, (seq, logs) => {   // リールの最中に撃つ → JPチャンスの 0.5 秒で割り込み
    seq.onEvent('challenge_flight', {});
    until(seq, logs, 'S3a_intro');
    assert.deepEqual(logs, ['S2_intro', 'S1_jpchance', 'S3a_intro']);
    assert.ok(seq.where().flash > 0.5, '割り込みの直後は白');
    frames(seq, 6); assert.ok(seq.where().flash <= 0, '0.15 秒で白が消える');
  });
  await withSeq(manifest, {}, (seq, logs) => {   // 狙えのループ中に撃つ → その場で割り込み
    until(seq, logs, 'S2_aim'); frames(seq, 7);
    seq.onEvent('challenge_flight', {});
    assert.equal(logs.at(-1), 'S3a_intro'); assert.equal(seq.where().f, 0);
  });
});

await test('継続：数字を重ねる口（場面・コマ・値・弾み）', async () => {
  if (!names.has('C1_offer_hold')) return;
  await withSeq(manifest, {}, (seq, logs) => {
    seq.onEvent('chain_choice', { pending: 30, chain: 1, lamps: 2 });
    until(seq, logs, 'C1_offer_hold');
    let w = seq.where();
    assert.equal(w.name, 'C1_offer_hold'); assert.ok(w.slots?.some((s) => s.id === 'pending'));
    assert.equal(w.values.pending, 30); assert.equal(w.bump, Infinity);
    seq.onEvent('chain_choice', { pending: 70, chain: 2, lamps: 3 });   // 積み増しが変わっても場面は戻さない
    w = seq.where(); assert.equal(w.name, 'C1_offer_hold'); assert.equal(w.values.pending, 70); assert.ok(w.bump < 0.05);
    seq.onEvent('chain_continue', {}); until(seq, logs, 'C2_enter_3');
    seq.onEvent('fail', { chain: true, chainLost: 70 }); until(seq, logs, 'C6_ng_lost');
    assert.equal(seq.where().values.lost, 70);
  });
});

console.table(rows);
console.table(rates);
console.log(`${rows.filter((r) => r.結果 === 'PASS').length}/${rows.length} 件成功`);
