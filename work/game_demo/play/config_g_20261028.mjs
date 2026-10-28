// G default entry; legacy JSON still uses the unchanged legacy parser.
import {MedalRules as GRules} from '../rules/medal_rules_g_20261028.mjs';
import {loadPlayRules as loadLegacyRules} from './config.mjs';
export {loadPlayConfig,resolveConfigPath,DEFAULT_CONFIG} from './config.mjs';
export async function loadPlayRules(path,readText){
 const text=await readText(path);let raw;
 try{raw=JSON.parse(text);}catch{return loadLegacyRules(path,async()=>text);}
 if(raw.RuleVariant!=='G_20261028')return loadLegacyRules(path,async()=>text);
 try{return GRules.fromJson(raw);}catch(e){throw new Error(`規則JSON ${path}: ${e.message}`,{cause:e});}
}
