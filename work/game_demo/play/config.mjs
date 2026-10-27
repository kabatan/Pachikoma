import { normalizeJitter } from '../physics/board3_jitter.mjs';
import { MedalRules } from '../rules/medal_rules.mjs';

const WORK = new URL('../../', import.meta.url);
const PROJECT = new URL('../', WORK);
export const DEFAULT_CONFIG = Object.freeze({ name: '本番 stage3', stageDir: 'work/cabinet/stage3',
  jitter: Object.freeze({ x_mm: 0, vx_pct: 0, vy_pct: 0 }), rules: 'work/game_demo/rules/medal_game.json', seed: null });

// work/・docs/始まりはプロジェクトルート基準。それ以外は設定JSONのURL基準。
export function resolveConfigPath(path, base = import.meta.url) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('設定のパスには空でない文字列が必要です');
  if (path.startsWith('work/')) return new URL(path.slice(5), WORK).href;
  if (path.startsWith('docs/')) return new URL(path, PROJECT).href;
  return new URL(path, base).href;
}

export async function loadPlayConfig(path, readText) {
  const source = path ? resolveConfigPath(path) : null;
  const raw = source ? JSON.parse(await readText(source)) : {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('configはJSONオブジェクトで指定してください');
  const c = { ...DEFAULT_CONFIG, ...raw, jitter: normalizeJitter(raw.jitter) };
  if (typeof c.name !== 'string') throw new Error('config.nameは文字列で指定してください');
  if (c.seed !== null && (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff)) throw new Error('config.seedはnullまたは0〜4294967295の整数で指定してください');
  return { ...c, source, stageDir: resolveConfigPath(c.stageDir, source ?? import.meta.url).replace(/\/$/, ''),
    rules: resolveConfigPath(c.rules, source ?? import.meta.url) };
}

export async function loadPlayRules(path, readText) {
  let raw;
  try { raw = JSON.parse(await readText(path)); return MedalRules.fromJson(raw); }
  catch (error) {
    const reasons = [];
    // 合否は規則コアに任せ、失敗時だけ編集者向けに制約を説明する。
    try { if (raw && typeof raw === 'object') {
      const r = Object.assign(new MedalRules(), raw);
      if (r.LoanBalls < 5) reasons.push('LoanBallsは5以上');
      if (r.InitialSeconds <= 0 || r.ExtraSeconds <= 0 || r.ContinueSeconds <= 0) reasons.push('各Secondsは正数');
      if (r.InitialSeconds + r.ExtraSeconds + r.ContinueSeconds > 165) reasons.push('InitialSeconds + ExtraSeconds + ContinueSecondsは165以下');
      if (!Array.isArray(r.Awards) || r.Awards.length !== 7 || r.Awards[0] !== 0 || r.Awards.some((v, i, a) => v < 0 || (i && v < a[i-1])) || [1,2,3].some(k => r.Awards[k] > k)) reasons.push('Awardsは7要素・先頭0・非負昇順、1〜3灯は灯数以下');
      const weightsOk = w => Array.isArray(w) && w.length === 4 && w.every(v => v >= 0) && w.reduce((a,b) => a+b, 0) === 100;
      if (!weightsOk(r.ResetWeights)) reasons.push('ResetWeightsは非負4要素・合計100');
      if (r.ResetWeightsByLamps != null && (!Array.isArray(r.ResetWeightsByLamps) || r.ResetWeightsByLamps.length > 7 || r.ResetWeightsByLamps.some(w => w != null && !weightsOk(w)))) reasons.push('ResetWeightsByLampsは最大7行、各行はnullまたは非負4要素・合計100');
      const jackpotTotal = Array.isArray(r.JackpotWeights) ? r.JackpotWeights.reduce((a,b) => a+b,0) : 0;
      if (!Array.isArray(r.JackpotAwards) || !Array.isArray(r.JackpotWeights) || r.JackpotAwards.length !== r.JackpotWeights.length || r.JackpotWeights.some(v => !Number.isFinite(v) || v < 0) || (r.JackpotAwards.length && (![100, 1_000_000].includes(jackpotTotal) || r.JackpotAwards.some(v => v < r.Awards[5])))) reasons.push('JackpotAwards/Weightsは同じ要素数、重みは非負・合計100または1,000,000、配当は5灯配当以上');
      if (!Array.isArray(r.PrizeThresholds) || !Array.isArray(r.PrizeNames) || !r.PrizeNames.length || r.PrizeThresholds.length !== r.PrizeNames.length || r.PrizeThresholds[0] !== 0 || r.PrizeThresholds.some((v,i,a) => i && v <= a[i-1])) reasons.push('PrizeThresholds/Namesは同じ要素数、閾値は先頭0・重複なしの昇順');
    } } catch { /* 不正な型も元のvalidate/parse例外を画面へ返す。 */ }
    throw new Error(`規則JSON ${path}: ${error.message}${reasons.length ? '\n' + reasons.join('\n') : ''}`, { cause: error });
  }
}
