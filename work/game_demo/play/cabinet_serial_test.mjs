import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CabinetSerial, buttonLeds, cabinetButtonAction, parseCabinetLine } from './cabinet_serial.mjs';
import { KEY_ACTIONS } from '../ui/input.mjs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';

assert.deepEqual(parseCabinetLine('PACHIKOMA,READY,1'), { type: 'ready' });
assert.deepEqual(parseCabinetLine('BTN,FIRE'), { type: 'button', name: 'FIRE' });
assert.deepEqual(parseCabinetLine('BTN,CHALLENGE'), { type: 'button', name: 'CHALLENGE' });
assert.equal(parseCabinetLine('BTN,RESET'), null);

const actions = [], sent = [];
const ctrl = { phase: 'Ready', game: { canFire: true, canAdd: false, lampCount: 2, armed: false }, confirmFinish: false,
  dispatch(action) { actions.push(action); return true; } };
for (const [phase, left, right] of [
  ['Attract', 'start', 'challenge'],
  ['Ready', 'fire', 'challenge'],
  ['Flight', 'fire', 'challenge'],
  ['Continue', 'fire', 'add'],
  ['Result', 'replay', 'challenge'],
  ['Fault', 'settleFault', 'challenge'],
]) {
  ctrl.phase = phase;
  assert.equal(cabinetButtonAction(ctrl, 'FIRE'), left);
  assert.equal(KEY_ACTIONS(ctrl).Space(), left);
  assert.equal(cabinetButtonAction(ctrl, 'CHALLENGE'), right);
}
assert.equal(cabinetButtonAction(ctrl, 'UNKNOWN'), null);
ctrl.phase = 'Ready';
assert.deepEqual(buttonLeds(ctrl, 0), [1, 1]);
ctrl.freezeRules = true;
assert.deepEqual(buttonLeds(ctrl, 0), [0, 0]);
ctrl.freezeRules = false;
ctrl.game.armed = true;
assert.deepEqual(buttonLeds(ctrl, 250), [1, 0]);
ctrl.game.armed = false;
ctrl.phase = 'Attract'; ctrl.game.canFire = false;
assert.deepEqual(buttonLeds(ctrl, 0), [1, 0]);
ctrl.phase = 'Continue'; ctrl.game.canAdd = true;
assert.deepEqual(buttonLeds(ctrl, 0), [0, 1]);
ctrl.game.canAdd = false;
assert.deepEqual(buttonLeds(ctrl, 0), [0, 0]);
ctrl.phase = 'Result'; ctrl.resultAge = 3; ctrl.replayAfter = 3;
assert.deepEqual(buttonLeds(ctrl, 0), [1, 0]);
ctrl.phase = 'Ready'; ctrl.game.canFire = true;

let incoming;
const port = {
  readable: new ReadableStream({ start(controller) { incoming = controller; } }),
  writable: new WritableStream({ write(bytes) { sent.push(new TextDecoder().decode(bytes)); } }),
  async open() {}, async close() {},
};
const serial = { async getPorts() { return []; }, async requestPort() { return port; }, addEventListener() {} };
const button = { textContent: '', disabled: false, addEventListener() {} };
const status = { textContent: '' };
const bridge = new CabinetSerial({ serial, ctrl, button, status });
await bridge.init();
await bridge.choosePort();
assert.ok(sent.includes('PING\n'));
incoming.enqueue(new TextEncoder().encode('boot noise\nBTN,FIRE\nPACHIKOMA,READY,1\nBTN,FIRE\nBTN,CHALLENGE\n'));
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(actions, ['fire', 'challenge']);
ctrl.phase = 'Continue';
bridge.accept('BTN,CHALLENGE');
ctrl.phase = 'Attract';
bridge.accept('BTN,FIRE');
assert.deepEqual(actions, ['fire', 'challenge', 'add', 'start']);
bridge.tick(2000);
await bridge.tx;
assert.ok(sent.includes('LED,1,1\n'));
assert.equal(status.textContent, 'ESP32: 接続済み');
await bridge.disconnect();
assert.equal(status.textContent, 'ESP32: 未接続');
const unsupportedButton = { textContent: '', disabled: false };
const unsupportedStatus = { textContent: '' };
await new CabinetSerial({ serial: null, ctrl, button: unsupportedButton, status: unsupportedStatus }).init();
assert.equal(unsupportedButton.disabled, true);
const rules = MedalRules.fromJson(readFileSync(new URL('../rules/medal_game.json', import.meta.url), 'utf8'));
const gameCtrl = new MedalController({ rules, seed: 1 });
const gameBridge = new CabinetSerial({ serial: null, ctrl: gameCtrl, button: {}, status: {} });
gameBridge.ready = true;
gameBridge.accept('BTN,FIRE');
assert.notEqual(gameCtrl.phase, 'Attract', 'left button starts a real game');
const continueCtrl = new MedalController({ rules, seed: 1 });
continueCtrl.game.phase = 'Continue';
const continueBridge = new CabinetSerial({ serial: null, ctrl: continueCtrl, button: {}, status: {} });
continueBridge.ready = true;
continueBridge.accept('BTN,CHALLENGE');
assert.equal(continueCtrl.game.addedCredit, true, 'right button buys the continue credit');
assert.equal(continueCtrl.game.wallet, rules.LoanBalls);
console.log('PASS cabinet serial handshake, button dispatch and LED state');
