// USB serial bridge for the ESP32 cabinet controller. No serial port is trusted
// until it replies to PING with the Pachikoma protocol signature.
import { primaryButtonAction } from '../ui/input.mjs';

export function cabinetButtonAction(ctrl, name) {
  if (name === 'FIRE') return primaryButtonAction(ctrl);
  if (name === 'CHALLENGE') return ctrl.phase === 'Continue' ? 'add' : ctrl.phase === 'ChainChoice' ? 'chainStop' : 'challenge';
  return null;
}

export function parseCabinetLine(line) {
  if (line === 'PACHIKOMA,READY,1') return { type: 'ready' };
  if (line === 'BTN,FIRE') return { type: 'button', name: 'FIRE' };
  if (line === 'BTN,CHALLENGE') return { type: 'button', name: 'CHALLENGE' };
  return null;
}

export function buttonLeds(ctrl, now) {
  const g = ctrl.game;
  const playable = g.canFire && !ctrl.confirmFinish && !ctrl.freezeRules;
  const chainContinue = ctrl.phase === 'ChainChoice' && g.wallet > 0 && g.secondsLeft > 0 && !g.endPending;
  const primary = playable || chainContinue || ctrl.phase === 'Attract' || (ctrl.phase === 'Result' && ctrl.resultAge >= ctrl.replayAfter);
  const secondary = ctrl.phase === 'Continue' ? g.canAdd : ctrl.phase === 'ChainChoice' ? true : playable && g.lampCount > 0 && g.lampCount < 6;
  return [Number(primary), Number(secondary && (ctrl.phase === 'Continue' || ctrl.phase === 'ChainChoice' || !g.armed || Math.floor(now / 250) % 2 === 0))];
}

export class CabinetSerial {
  constructor({ serial, ctrl, button, status, onInput = null }) {
    this.serial = serial;
    this.ctrl = ctrl;
    this.button = button;
    this.status = status;
    this.onInput = onInput;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.ready = false;
    this.connecting = false;
    this.buffer = '';
    this.lastLeds = '';
    this.lastLedAt = 0;
    this.lastPingAt = 0;
    this.tx = Promise.resolve();
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  setStatus(message) {
    this.status.textContent = message;
    this.button.textContent = this.port ? 'ESP32 切断' : 'ESP32 接続';
    this.button.disabled = this.connecting;
  }

  async init() {
    if (!this.serial) {
      this.setStatus('ESP32: Chrome / Edge が必要です');
      this.button.disabled = true;
      return;
    }
    this.button.addEventListener('click', async () => {
      if (this.port) await this.disconnect();
      else await this.choosePort();
    });
    this.serial.addEventListener?.('disconnect', event => {
      if ((event.port ?? event.target) === this.port) this.disconnect();
    });
    this.setStatus('ESP32: 未接続');
    try {
      const ports = await this.serial.getPorts();
      if (ports.length === 1) await this.connect(ports[0]);
    } catch (error) {
      this.setStatus(`ESP32: ${error.message}`);
    }
  }

  async choosePort() {
    if (this.connecting) return;
    this.connecting = true;
    this.setStatus('ESP32: ポートを選択');
    try {
      // requestPort must be reached from the button's user gesture.
      const port = await this.serial.requestPort();
      this.connecting = false;
      await this.connect(port);
    } catch (error) {
      if (error.name !== 'NotFoundError') this.setStatus(`ESP32: ${error.message}`);
    } finally {
      this.connecting = false;
      this.button.disabled = false;
    }
  }

  async connect(port) {
    if (this.port || this.connecting) return;
    this.connecting = true;
    this.setStatus('ESP32: 接続中');
    try {
      await port.open({ baudRate: 115200 });
      this.port = port;
      this.writer = port.writable.getWriter();
      this.ready = false;
      this.buffer = '';
      this.lastLeds = '';
      this.readTask = this.readLoop();
      await this.send('PING');
    } catch (error) {
      this.setStatus(`ESP32: 接続失敗 (${error.message})`);
      if (this.port) await this.disconnect();
    } finally {
      this.connecting = false;
      this.button.disabled = false;
    }
  }

  send(message) {
    if (!this.writer) return Promise.resolve();
    const bytes = this.encoder.encode(message + '\n');
    this.tx = this.tx.then(() => this.writer?.write(bytes)).catch(error => {
      this.setStatus(`ESP32: 送信失敗 (${error.message})`);
      queueMicrotask(() => this.disconnect());
    });
    return this.tx;
  }

  accept(text) {
    const message = parseCabinetLine(text);
    if (message?.type === 'ready') {
      this.ready = true;
      this.setStatus('ESP32: 接続済み');
      this.tick(performance.now());
    } else if (this.ready && message?.type === 'button') {
      const action = cabinetButtonAction(this.ctrl, message.name);
      if (action) {
        const phase = this.ctrl.phase;
        const accepted = this.ctrl.dispatch(action);
        this.onInput?.({ source: 'cabinet', action, accepted, phase }, this.ctrl.game);
      }
    }
  }

  async readLoop() {
    try {
      this.reader = this.port.readable.getReader();
      while (this.port && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        if (this.buffer.length > 256) this.buffer = ''; // Ignore corrupt/verbose ports.
        let end;
        while ((end = this.buffer.indexOf('\n')) !== -1) {
          this.accept(this.buffer.slice(0, end).trim());
          this.buffer = this.buffer.slice(end + 1);
        }
      }
    } catch (error) {
      if (this.port) this.setStatus(`ESP32: 通信停止 (${error.message})`);
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
      await this.finishDisconnect();
    }
  }

  tick(now) {
    if (!this.port) return;
    if (!this.ready) {
      if (now - this.lastPingAt >= 1000) { this.lastPingAt = now; this.send('PING'); }
      return;
    }
    const leds = buttonLeds(this.ctrl, now).join(',');
    if (leds !== this.lastLeds || now - this.lastLedAt >= 1000) {
      this.lastLeds = leds;
      this.lastLedAt = now;
      this.send(`LED,${leds}`);
    }
  }

  async disconnect() {
    if (this.reader) {
      await this.reader.cancel().catch(() => {});
      await this.readTask;
    } else await this.finishDisconnect();
  }

  async finishDisconnect() {
    const port = this.port;
    if (!port) return;
    this.port = null;
    this.ready = false;
    await this.tx.catch(() => {});
    this.writer?.releaseLock();
    this.writer = null;
    await port.close().catch(() => {});
    this.setStatus('ESP32: 未接続');
  }
}
