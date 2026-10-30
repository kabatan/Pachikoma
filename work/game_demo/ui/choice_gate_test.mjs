// 10/31 左右どちらのボタンでも同じ動作／選択画面の誤選択防止（出てから1.5秒＋連打が0.4秒止まるまで）。実機ボタンとキーボードの両経路。
// node work/game_demo/ui/choice_gate_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CabinetSerial } from '../play/cabinet_serial_r3_20261029.mjs';
import { attachInput } from './input.mjs';
import { MedalController } from './controller_g_20261028.mjs';
import { loadPlayConfig, loadPlayRules } from '../play/config_g_20261028.mjs';
import { fireButtonMode, resetFireButtonMode, r3ButtonAction, CHOICE_GUARD_SECONDS, MASH_QUIET_SECONDS } from './choice_gate_1031.mjs';

const read = async p => readFileSync(new URL(p), 'utf8');
const cfg = await loadPlayConfig('work/game_demo/play/config_g_20261028.json', read), rules = await loadPlayRules(cfg.rules, read);
assert.equal(CHOICE_GUARD_SECONDS, 1.5); assert.equal(MASH_QUIET_SECONDS, 0.4);
assert.equal(fireButtonMode('?firebtn=old'), 'old'); assert.equal(fireButtonMode('?firebtn=left'), 'old'); assert.equal(fireButtonMode(''), 'any');

const mk = () => {
  const flights = [];
  const ctrl = new MedalController({ rules, seed: 7, hooks: { launchBall(s) { flights.push(s.id); }, cancelFlights() { flights.length = 0; } } });
  ctrl.howtoSeconds = 0;
  return { ctrl, flights };
};
const toChain = (ctrl) => {   // 6灯を作って 継続の選択(ChainChoice)へ
  ctrl.dispatch('start'); const g = ctrl.game;
  for (let i = 0; i < 400 && !g.canFire; i++) ctrl.update(.05);
  g._lamps = new Set([1, 2, 3, 4, 5, 6]); g.armed = true;
  const shot = g.launch(); assert.ok(shot); ctrl.landing(shot.id, 7, true);
  for (let i = 0; i < 400 && g.phase !== 'ChainChoice'; i++) ctrl.update(.05);
  assert.equal(g.phase, 'ChainChoice');
};
const toContinue = (ctrl) => { ctrl.dispatch('start'); ctrl.update(6); ctrl.game.phase = 'Continue'; ctrl.game.offerLeft = rules.ContinueSeconds; ctrl.game.secondsLeft = 0; };
const bridgeFor = (ctrl) => { const b = new CabinetSerial({ serial: null, ctrl, button: {}, status: {}, clock: () => 0 }); b.ready = true; b.rgb = true; return b; };
const keyboard = (ctrl) => {
  const handlers = {}; const target = { addEventListener(t, f) { handlers[t] = f; }, removeEventListener() {} };
  attachInput(ctrl, { target });
  return code => handlers.keydown({ code, repeat: false, preventDefault() {} });
};

// ---- 1. 割り当て：選択画面以外は左右とも同じ ----
{
  const { ctrl } = mk(); ctrl.dispatch('start'); ctrl.update(6);
  assert.equal(r3ButtonAction(ctrl, 'FIRE'), 'fire'); assert.equal(r3ButtonAction(ctrl, 'CHALLENGE'), 'fire');
  const bridge = bridgeFor(ctrl), seen = []; bridge.onInput = i => seen.push(i.action);
  bridge.accept('BTN,FIRE'); ctrl.update(.7); bridge.accept('BTN,CHALLENGE');
  assert.deepEqual(seen, ['fire', 'fire'], '右ボタンでも発射');
  const key = keyboard(ctrl); ctrl.update(.7); key('Space'); ctrl.update(.7); key('KeyC');
  assert.ok(ctrl.game.shots.length >= 1);
}

// ---- 2. 継続の選択：右連打のまま入っても選ばれない。止まって 0.4 秒＋1.5 秒後から受け付ける（実機ボタン・キーボード両方） ----
for (const [via, name] of [['cabinet', 'CHALLENGE'], ['cabinet', 'FIRE'], ['key', 'Space'], ['key', 'KeyC']]) {
  const { ctrl } = mk(); toChain(ctrl);
  const g = ctrl.game;
  const press = via === 'cabinet' ? (() => { const b = ctrl._b ??= bridgeFor(ctrl); b.accept('BTN,' + name); }) : (() => { (ctrl._k ??= keyboard(ctrl))(name); });
  // 出てから 3 秒間、0.2 秒ごとに連打（画面が出てから1.5秒を過ぎても連打中は受け付けない）
  for (let t = 0; t < 3; t += .2) { ctrl.update(.2); if (g.chainAnnouncing) continue; press(); assert.equal(g.phase, 'ChainChoice', `${via}/${name}: 連打中(${t.toFixed(1)}s)は選ばれない`); }
  assert.ok(ctrl.droppedInputs.some(d => d.reason === 'choice-gate') || g.chainAnnouncing !== undefined);
  ctrl.update(.3); press(); assert.equal(g.phase, 'ChainChoice', `${via}/${name}: 止まって0.3秒ではまだ`);   // この押しも連打として数える
  ctrl.update(.45); press(); assert.notEqual(g.phase, 'ChainChoice', `${via}/${name}: 0.45秒止まったあとの押しは受け付ける`);
}

// ---- 3. 追加の選択（Continue）：出てすぐ・連打中は受けず、客が止めて押したときだけ。左=終わる／右=追加 ----
for (const [via, name, expect] of [['cabinet', 'CHALLENGE', 'StaffWait'], ['cabinet', 'FIRE', 'Result'], ['key', 'Space', 'StaffWait'], ['key', 'KeyC', 'Result']]) {
  const { ctrl } = mk(); toContinue(ctrl);
  const g = ctrl.game;
  const press = via === 'cabinet' ? (() => (ctrl._b ??= bridgeFor(ctrl)).accept('BTN,' + name)) : (() => (ctrl._k ??= keyboard(ctrl))(name));
  for (let t = 0; t < 3; t += .2) { ctrl.update(.2); g.offerLeft = Math.min(g.offerLeft, rules.ContinueSeconds - t - .2); press(); assert.equal(ctrl.phase, 'Continue', `${via}/${name}: 連打中は追加も終了も決まらない`); }
  ctrl.update(.5); press(); assert.equal(ctrl.phase, expect, `${via}/${name}: 止めたあと ${expect}`);
}

// ---- 4. 放置は従来どおり：押さずに待つと時間切れで規則が決める（追加は自動で決めない） ----
{
  const { ctrl } = mk(); toContinue(ctrl); for (let i = 0; i < 700 && ctrl.phase === 'Continue'; i++) ctrl.update(.05);
  assert.notEqual(ctrl.phase, 'Continue'); assert.notEqual(ctrl.phase, 'StaffWait', '放置で追加にならない');
}

// ---- 5. ?firebtn=old：従来（左=発射、右=challenge）。選択画面の左右は同じ ----
{
  const { ctrl } = mk(); ctrl.dispatch('start'); ctrl.update(6);
  assert.equal(fireButtonMode('?firebtn=old'), 'old');
  // 既定のモードは起動時の location で決まるので、ここでは検証用に明示
  globalThis.location = { search: '?firebtn=old' }; resetFireButtonMode();
  assert.equal(r3ButtonAction(ctrl, 'FIRE'), 'fire'); assert.equal(r3ButtonAction(ctrl, 'CHALLENGE'), 'challenge');
  const { ctrl: c2 } = mk(); toChain(c2); c2.update(3);
  assert.equal(r3ButtonAction(c2, 'FIRE'), 'chainStop'); assert.equal(r3ButtonAction(c2, 'CHALLENGE'), 'chainContinue');
  // キーボードも従来どおり：Space=左ボタン(開始・発射)、C=右(challenge)
  const { KEY_ACTIONS } = await import('./input.mjs'); const { ctrl: c3 } = mk(); const km = KEY_ACTIONS(c3);
  assert.equal(km.Space(), 'start'); c3.dispatch('start'); c3.update(6); assert.equal(km.Space(), 'fire'); assert.equal(km.KeyC(), 'challenge');
  delete globalThis.location; resetFireButtonMode();
}
console.log('PASS choice gate: either button fires, no wrong pick when mashing into 追加/継続 (cabinet + keyboard), idle unchanged, firebtn=old');
