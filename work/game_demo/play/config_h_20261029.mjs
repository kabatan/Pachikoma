// H_20261029 の入口。G の入口（config_g_20261028.mjs）の上位互換: RuleVariant が H なら H の規則を、それ以外は G／従来の読み込みに渡す。
// G → H の切替は URL の ?rules=h（既定は G のまま。既定を H にするのは監督の確認後）。?config= を明示した時はそちらを優先する。
import {MedalRules as HRules} from '../rules/medal_rules_h_20261029.mjs';
import {loadPlayRules as loadGRules,loadPlayConfig as loadGConfig} from './config_g_20261028.mjs';
export {resolveConfigPath,DEFAULT_CONFIG} from './config_g_20261028.mjs';
export const H_PLAY_CONFIG='work/game_demo/play/config_h_20261029.json';
/** URL の rules= を小文字で返す（無ければ null）。 */
export function rulesSwitch(search=globalThis.location?.search??''){const v=new URLSearchParams(search).get('rules');return v?v.toLowerCase():null;}
export async function loadPlayConfig(path,readText,{search=globalThis.location?.search??''}={}){
 if(rulesSwitch(search)==='h'&&!new URLSearchParams(search).has('config'))path=H_PLAY_CONFIG;
 return loadGConfig(path,readText);
}
export async function loadPlayRules(path,readText){
 const text=await readText(path);let raw;
 try{raw=JSON.parse(text);}catch{return loadGRules(path,async()=>text);}
 if(raw.RuleVariant!=='H_20261029')return loadGRules(path,async()=>text);
 try{return HRules.fromJson(raw);}catch(e){throw new Error(`規則JSON ${path}: ${e.message}`,{cause:e});}
}
