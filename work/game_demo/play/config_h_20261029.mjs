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
// 10/31 監督決定（work/game_tuning/H_1031）: 持ち時間50秒・貸玉60、「6灯目が点かない」をやめ重複の消え方を N3（序盤は時々2〜3灯）に、追加は持ち玉60以上なら時間だけ・上限10回、
//   ルーレットの重み 200=0.03%・500=100万分の0.03、賞 C80/B120/A155/S500。?tune1031=0 で 10/30 の値（70秒・80玉・点かない・45/85/150/400・追加無制限）に全部戻す。
export const TUNE1031_OLD=Object.freeze({"PrizeThresholds":[0,45,85,150,400],"InitialSeconds":70,"LoanBalls":80,"MaxExtraCredits":null,"JackpotWeights":[750000,241000,5500,3498.8,1.2],"DuplicateSegments":[{"Until":0.35,"ResetWeights":[100,0,0,0],"HighLampDuplicateProtectionCount":0},{"Until":0.55,"ResetWeights":[100,0,0,0],"HighLampDuplicateProtectionCount":1},{"Until":0.75,"ResetWeights":[100,0,0,0],"HighLampDuplicateProtectionCount":2},{"Until":null,"ResetWeights":[100,0,0,0],"HighLampDuplicateProtectionCount":3}],"DuplicateSixthLampTeaseUntil":0.6,"DuplicateSixthLampTeasePlateau":0.4,"ExtraLoanWalletCap":null});
export function tune1031Old(search=globalThis.location?.search??''){return new URLSearchParams(search).get('tune1031')==='0';}
export async function loadPlayRules(path,readText){
 const text=await readText(path);let raw;
 try{raw=JSON.parse(text);}catch{return loadGRules(path,async()=>text);}
 if(raw.RuleVariant!=='H_20261029')return loadGRules(path,async()=>text);
 if(tune1031Old())Object.assign(raw,TUNE1031_OLD);
 if(timePlanOld())Object.assign(raw,TIMEPLAN_OLD);
 try{return HRules.fromJson(raw);}catch(e){throw new Error(`規則JSON ${path}: ${e.message}`,{cause:e});}
}
