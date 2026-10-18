// Experimental worker boundary for the R2-X4 physics prototype.
// This file is intentionally not connected to play.mjs. The main thread sends
// serializable adapter actions and receives transferable snapshots/events.
import RAPIER from './node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { PhysicsAdapter } from './adapter.mjs';
import { observeContacts } from '../../audio/runtime/contact_observer.mjs';

const CABINET = new URL('../../cabinet/', import.meta.url);
let pa = null;
let observer = null;
let pendingContacts = [];

async function readText(path) {
  const response = await fetch(new URL(path, CABINET));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

function copySnapshot(raw) {
  const positions = raw.positions.slice(0, raw.count * 3);
  const kinds = raw.kinds.slice(0, raw.count);
  return {
    snapshot: {
      coordinate_frame: raw.coordinate_frame,
      stage_transforms_revision: raw.stage_transforms_revision,
      tick: raw.tick,
      time: raw.time,
      count: raw.count,
      positions,
      kinds,
      ids: raw.ids.slice(),
      shuttle: { ...raw.shuttle, position_m: raw.shuttle.position_m.slice() },
      mech: { ...raw.mech },
      connections: raw.connections,
      ledger: { ...raw.ledger },
    },
    transfer: [positions.buffer, kinds.buffer],
  };
}

async function initialize(message) {
  if (pa) throw new Error('worker is already initialized');
  await RAPIER.init();
  const options = message.physicsOptions ?? {};
  pa = await PhysicsAdapter.create(RAPIER, {
    ...options,
    seed: message.seed ?? options.seed ?? 1,
    readText,
    importModule: path => import(new URL(path, CABINET).href),
  });
  observer = observeContacts(pa, contact => pendingContacts.push(contact), {
    onError: error => { throw error; },
  });

  const initial = message.initial ?? {};
  if (initial.beginGameBalls != null) pa.beginGame(initial.beginGameBalls);
  if (initial.stock != null) pa.stock = initial.stock;
  if (initial.payout) pa.payout(initial.payout.count, initial.payout.earned, initial.payout.rate);
  return { tick: pa.tick, snapshot: pa.snapshot() };
}

function applyAction(action) {
  switch (action.type) {
    case 'aim': pa.setAim(action.aim, action.dir ?? pa.dir); break;
    case 'launch': pa.launch(action.shotId); break;
    case 'payout': pa.payout(action.count, action.earned, action.rate); break;
    case 'count': pa.startCount(); break;
    case 'reserveForLoan': pa.reserveForLoan(action.count); break;
    default: throw new Error(`unsupported physics action: ${action.type}`);
  }
}

function stepBatch(message) {
  if (!pa) throw new Error('worker is not initialized');
  const count = message.steps;
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    throw new RangeError('steps must be an integer from 1 to 24');
  }
  const actions = message.actions ?? [];
  if (!Array.isArray(actions) || actions.length !== count) {
    throw new TypeError('actions must contain one action list per physics step');
  }

  const events = [];
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    for (const action of actions[i] ?? []) applyAction(action);
    pa.step();
    events.push(...pa.drainEvents());
  }
  const raw = pa.snapshot();
  const copied = copySnapshot(raw);
  const contacts = pendingContacts.splice(0);
  return {
    type: 'batchDone',
    requestId: message.requestId,
    events,
    contacts,
    snapshot: copied.snapshot,
    snapshotTransferBytes: copied.snapshot.positions.byteLength + copied.snapshot.kinds.byteLength,
    observerSteps: observer.metrics.steps,
    workerMs: performance.now() - started,
    transfer: copied.transfer,
  };
}

function dispose() {
  observer?.dispose();
  observer = null;
  if (pa) {
    pa.bw.free();
    pa.tw.free();
  }
  pa = null;
  pendingContacts = [];
}

self.addEventListener('message', async event => {
  const message = event.data ?? {};
  try {
    if (message.type === 'init') {
      const ready = await initialize(message);
      self.postMessage({ type: 'ready', requestId: message.requestId, tick: ready.tick });
    } else if (message.type === 'stepBatch') {
      const result = stepBatch(message);
      self.postMessage({
        type: result.type,
        requestId: result.requestId,
        events: result.events,
        contacts: result.contacts,
        snapshot: result.snapshot,
        snapshotTransferBytes: result.snapshotTransferBytes,
        observerSteps: result.observerSteps,
        workerMs: result.workerMs,
      }, result.transfer);
    } else if (message.type === 'dispose') {
      dispose();
      self.postMessage({ type: 'disposed', requestId: message.requestId });
    } else {
      throw new Error(`unsupported worker message: ${message.type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
  }
});
