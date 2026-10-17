import assert from 'node:assert/strict';
import { CabinetSerial, buttonLeds, parseCabinetLine } from './cabinet_serial.mjs';

assert.deepEqual(parseCabinetLine('PACHIKOMA,READY,1'), { type: 'ready' });
assert.deepEqual(parseCabinetLine('BTN,FIRE'), { type: 'button', name: 'FIRE' });
assert.deepEqual(parseCabinetLine('BTN,CHALLENGE'), { type: 'button', name: 'CHALLENGE' });
assert.equal(parseCabinetLine('BTN,RESET'), null);

const actions = [], sent = [];
const ctrl = { game: { canFire: true, lampCount: 2, armed: false }, confirmFinish: false,
  dispatch(action) { actions.push(action); return true; } };
assert.deepEqual(buttonLeds(ctrl, 0), [1, 1]);
ctrl.freezeRules = true;
assert.deepEqual(buttonLeds(ctrl, 0), [0, 0]);
ctrl.freezeRules = false;
ctrl.game.armed = true;
assert.deepEqual(buttonLeds(ctrl, 250), [1, 0]);
ctrl.game.armed = false;

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
console.log('PASS cabinet serial handshake, button dispatch and LED state');
