// node work/game_demo/play/export_human_history.mjs > human_play_history.csv
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../ui/logs/human/', import.meta.url));
const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const columns = [
  'playId', 'startedAt', 'endedAt', 'status', 'configName', 'wallet', 'spent',
  'purchased', 'won', 'attempts', 'successes', 'maxLamps', 'bestAward',
  'prize', 'addedCredit', 'cabinetInputs', 'keyboardInputs', 'pointerInputs',
];
const rows = [];
let days = [];
try { days = await readdir(root, { withFileTypes: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const day of days.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = join(root, day.name);
  const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  for (const file of files) {
    const doc = JSON.parse(await readFile(join(dir, file), 'utf8'));
    rows.push({
      playId: doc.playId, startedAt: doc.startedAt, endedAt: doc.endedAt,
      status: doc.status, configName: doc.context?.configName,
      wallet: doc.result?.wallet, spent: doc.result?.spent,
      purchased: doc.result?.purchased, won: doc.result?.won,
      attempts: doc.result?.attempts, successes: doc.result?.successes,
      maxLamps: doc.result?.maxLamps, bestAward: doc.result?.bestAward,
      prize: doc.result?.prize, addedCredit: doc.result?.addedCredit,
      cabinetInputs: doc.inputCounts?.cabinet, keyboardInputs: doc.inputCounts?.keyboard,
      pointerInputs: doc.inputCounts?.pointer,
    });
  }
}
console.log(columns.join(','));
for (const row of rows) console.log(columns.map(column => csv(row[column])).join(','));
