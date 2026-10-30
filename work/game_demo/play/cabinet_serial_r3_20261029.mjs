// R3 cabinet bridge (10/29 night): the two buttons alone run the whole game, and the same USB serial line carries the RGB strip colour.
// 10/31: 選択画面（追加・継続・スタッフ・終了の確認）以外は、左右どちらのボタンでも同じ動作（開始・発射・連打・ルーレット停止・スキップ）。?firebtn=old で従来（左=発射、右=challenge）。
// Left button = left side of the LCD, right button = right side (終わる|続ける, 確定|継続) — 選択画面だけ左右に意味がある。
//   Attract / Result / Fault : either button            Play : either button = fire   (?firebtn=old: left = fire, right = challenge)
//   選択画面(Continue/ChainChoice)は、出てから1.5秒かつ直前の押下から0.4秒たつまで、どちらのボタンも受け付けない(ui/choice_gate_1031.mjs。コントローラの dispatch で一括)
//   ChainChoice (確定|継続)   : left = 確定(stop), right = 継続   Continue (終わる|続ける): left = finish, right = ask for +100 yen
//   StaffWait                : staff holds BOTH buttons ~1.5 s (firmware sends BTN,STAFF). Left alone = cancel (on release), right alone = nothing.
// The firmware (hardware/pachikoma_controller_r3) announces PACHIKOMA,RGB,1; only then does this class send "L,r,g,b" lines and stop sending the old "LED,x,y" lines.
import {CabinetSerial as GSerial} from './cabinet_serial_g_20261028.mjs';
import {parseCabinetLine} from './cabinet_serial.mjs';
import {registerPress, r3ButtonAction, entryGuard, GUARD_SECONDS as _GUARD} from '../ui/choice_gate_1031.mjs';

export const GUARD_SECONDS = _GUARD;      // StaffWait: after the staff screen appears, ignore presses briefly. 追加・継続の選択画面は CHOICE_GUARD_SECONDS(1.5) と連打停止0.4秒（choice_gate_1031）
export const LED_MIN_INTERVAL_MS = 20; // <= 50 lines/s (~14 bytes each): far below the 11.5 kB/s of 115200 baud
export const LED_KEEPALIVE_MS = 500;   // firmware falls back to its own animation after ~2 s of silence

export function parseR3Line(line) {
  const base = parseCabinetLine(line);
  if (base) return base;
  if (line === 'PACHIKOMA,RGB,1') return { type: 'rgb' };
  if (line === 'BTN,STAFF') return { type: 'staff' };
  if (line === 'REL,FIRE') return { type: 'release', name: 'FIRE' };
  if (line === 'REL,CHALLENGE') return { type: 'release', name: 'CHALLENGE' };
  return null;
}

// r3ButtonAction / entryGuard / GUARD_SECONDS は ui/choice_gate_1031.mjs（依存なし。input.mjs との循環 import を避けるため移した）。ここから再公開する。
export { r3ButtonAction, entryGuard };

export class CabinetSerial extends GSerial {
  constructor(options) {
    super(options);
    this.wake = options.wake ?? null;
    this.clock = options.clock ?? (() => performance.now());
    this.rgb = false;
    this.down = { FIRE: -Infinity, CHALLENGE: -Infinity };
    this.pendingCancel = false;
    this.led = { r: -1, g: -1, b: -1, at: -Infinity, busy: false, sent: 0, skipped: 0, maxGap: 0 };
  }

  input(action) {
    const phase = this.ctrl.phase, accepted = this.ctrl.dispatch(action);
    this.onInput?.({ source: 'cabinet', action, accepted, phase }, this.ctrl.game);
    return accepted;
  }

  accept(text) {
    const message = parseR3Line(text);
    if (!message) return;
    if (message.type === 'ready') { this.ready = true; this.setStatus('ESP32: 接続済み'); this.tick(this.clock()); return; }
    if (message.type === 'rgb') { this.rgb = true; this.led.at = -Infinity; this.led.r = -1; return; }
    if (!this.ready) return;
    const now = this.clock();
    if (this.ctrl.phase !== 'StaffWait') this.pendingCancel = false;
    if (message.type === 'release') {
      this.down[message.name] = -Infinity;
      this.ctrl.pressUp?.('cabinet:' + message.name);   // 説明の長押しスキップ(tutSkip)
      if (message.name === 'FIRE' && this.pendingCancel) { this.pendingCancel = false; if (this.ctrl.phase === 'StaffWait') this.input('cancelExtra'); }
      return;
    }
    if (message.type === 'staff') {            // both buttons held ~1.5 s: the staff member has the ticket
      this.pendingCancel = false;
      if (this.ctrl.phase === 'StaffWait') this.input('staffActivate');
      return;
    }
    if (message.type !== 'button') return;
    this.down[message.name] = now;
    this.wake?.();
    const ctrl = this.ctrl;
    if (this.rgb) ctrl.pressDown?.('cabinet:' + message.name);   // 離しの通知(REL)がある新ファームのときだけ長押しを数える(古い版は短押し扱い=説明は最後まで流れる)
    else if (ctrl.tutSkipActive) { ctrl.tutSkip.tap = 1; }
    if (ctrl.phase === 'StaffWait') {
      if (entryGuard(ctrl)) { registerPress(ctrl); return; }
      const other = message.name === 'FIRE' ? 'CHALLENGE' : 'FIRE';
      if (now - this.down[other] < 8000) { this.pendingCancel = false; return; }   // other button is down: staff chord in progress
      if (message.name === 'FIRE') { if (this.rgb) this.pendingCancel = true; else this.input('cancelExtra'); }
      return;
    }
    if (entryGuard(ctrl)) { registerPress(ctrl); return; }   // 捨てた押しも連打として数える(止まるまで選べない)
    const action = r3ButtonAction(ctrl, message.name);
    if (action) this.input(action);
  }

  async finishDisconnect() {
    this.rgb = false; this.pendingCancel = false; this.down.FIRE = this.down.CHALLENGE = -Infinity;   // the next firmware may be the old one
    return super.finishDisconnect();
  }

  tick(now) {
    if (!this.port) return;
    if (!this.ready || !this.rgb) return super.tick(now);   // old firmware: button LEDs as before. R3 firmware has no button LEDs.
  }

  /** r,g,b: integers 0..255 (linear; the ESP32 applies gamma). Sends only on change, at most every 20 ms, never queues more than one line. */
  setLed(r, g, b, now = this.clock()) {
    const led = this.led;
    if (!this.rgb || !this.writer) return false;
    const same = Math.abs(r - led.r) + Math.abs(g - led.g) + Math.abs(b - led.b) <= 1;
    const age = now - led.at;
    if ((same && age < LED_KEEPALIVE_MS) || age < LED_MIN_INTERVAL_MS) return false;
    if (led.busy) { led.skipped++; return false; }
    const bytes = new Uint8Array(14);   // "L,255,255,255\n": tiny, <=50/s
    let n = 0;
    bytes[n++] = 76; bytes[n++] = 44;
    for (let c = 0; c < 3; c++) {
      const v = c === 0 ? r : c === 1 ? g : b;
      if (v >= 100) bytes[n++] = 48 + ((v / 100) | 0);
      if (v >= 10) bytes[n++] = 48 + (((v / 10) | 0) % 10);
      bytes[n++] = 48 + (v % 10);
      bytes[n++] = 44;
    }
    bytes[n - 1] = 10;
    led.busy = true; led.r = r; led.g = g; led.b = b;
    if (led.at > -Infinity && now - led.at > led.maxGap) led.maxGap = now - led.at;
    led.at = now; led.sent++;
    this.tx = this.tx.then(() => this.writer?.write(bytes.subarray(0, n))).catch(error => {
      this.setStatus(`ESP32: 送信失敗 (${error.message})`);
      queueMicrotask(() => this.disconnect());
    }).then(() => { led.busy = false; });
    return true;
  }
}
