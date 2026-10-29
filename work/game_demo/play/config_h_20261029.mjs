// H_20261029 の入口。G の入口（config_g_20261028.mjs）の上位互換: RuleVariant が H なら H の規則を、それ以外は G／従来の読み込みに渡す。
// 10/30 監督の指示で既定を H にした。?rules=g で G に戻す。?config= を明示した時はそちらを優先する。
import {MedalRules as HRules} from '../rules/medal_rules_h_20261029.mjs';
import {loadPlayRules as loadGRules,loadPlayConfig as loadGConfig} from './config_g_20261028.mjs';
export {resolveConfigPath,DEFAULT_CONFIG} from './config_g_20261028.mjs';
export const H_PLAY_CONFIG='work/game_demo/play/config_h_20261029.json';
/** URL の rules= を小文字で返す（無ければ既定の 'h'）。 */
export function rulesSwitch(search=globalThis.location?.search??''){const v=new URLSearchParams(search).get('rules');return v?v.toLowerCase():'h';}
export async function loadPlayConfig(path,readText,{search=globalThis.location?.search??''}={}){
 if(rulesSwitch(search)==='h'&&!new URLSearchParams(search).has('config'))path=H_PLAY_CONFIG;
 return loadGConfig(path,readText);
}
// 10/30 遊技時間の計画（work/game_tuning/timeplan_1030/REPORT.md）: H の持ち時間70秒・追加20秒（規則JSON。監督の決定、追加画面は30秒のまま）。?timeplan=old で従来の72・22・30に戻す。
export const TIMEPLAN_OLD=Object.freeze({InitialSeconds:72,ExtraSeconds:22,ContinueSeconds:30});
export function timePlanOld(search=globalThis.location?.search??''){return (new URLSearchParams(search).get('timeplan')??'').toLowerCase()==='old';}
export async function loadPlayRules(path,readText){
 const text=await readText(path);let raw;
 try{raw=JSON.parse(text);}catch{return loadGRules(path,async()=>text);}
 if(raw.RuleVariant!=='H_20261029')return loadGRules(path,async()=>text);
 if(timePlanOld())Object.assign(raw,TIMEPLAN_OLD);
 try{return HRules.fromJson(raw);}catch(e){throw new Error(`規則JSON ${path}: ${e.message}`,{cause:e});}
}
