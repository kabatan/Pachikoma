const STORAGE_KEY='pachikoma.result.dailyBest.v1';
const finiteInt=v=>Math.max(0,Math.floor(Number.isFinite(v)?v:0));
export function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function createDailyResultBest({storage,now=()=>new Date()}={}){
 let memory={day:localDay(now()),best:0};
 const read=()=>{const day=localDay(now());let value=memory;try{const raw=storage?.getItem(STORAGE_KEY);if(raw){const x=JSON.parse(raw);if(x.day===day&&Number.isSafeInteger(x.best)&&x.best>=0)value=x;}}catch{}if(value.day!==day)value={day,best:0};memory=value;return {...value};};
 return {record(value){const previous=read(),score=finiteInt(value);memory={day:previous.day,best:Math.max(previous.best,score)};try{storage?.setItem(STORAGE_KEY,JSON.stringify(memory));}catch{}return {day:memory.day,best:previous.best,newRecord:score>previous.best,savedBest:memory.best};},read};
}
// Positions remain proportional to the live G thresholds. Keep neighboring
// milestone badges separate when the approved game tuning puts them close.
export function resultMeterSteps(thresholds){
 const marks=thresholds.slice(1).map((value,i)=>({rankIndex:i+1,value,x:140+720*value/thresholds.at(-1),width:420*.19}));
 for(let i=0;i<marks.length-1;i++){const left=marks[i],right=marks[i+1],limit=2*(right.x-left.x-6),sum=left.width+right.width;if(sum>limit){const fit=Math.max(0,limit)/sum;left.width*=fit;right.width*=fit;}}
 return marks.map(m=>Object.freeze({...m,scale:m.width/420}));
}
export function finalResultState(game,daily){
 const rules=game.rules,thresholds=rules.PrizeThresholds.slice(),names=rules.PrizeNames.slice(),value=finiteInt(game.jackpotEarnings);
 let rankIndex=Math.max(0,names.indexOf(game.prize));
 // A cumulative total cannot manufacture a 500-JP receipt.
 if(!game.jackpotDreamHit)rankIndex=Math.min(rankIndex,3);
 const nextIndex=rankIndex<4?rankIndex+1:null,dreamRequired=nextIndex===4&&!game.jackpotDreamHit;
 const best=daily.record(value);
 const need=nextIndex==null?0:Math.max(0,thresholds[nextIndex]-value),nextMessage=rankIndex===4?'最高賞！':dreamRequired?`${thresholds[4]}玉のJP確定でS賞！`:`次の${names[nextIndex]}まであと${need}玉！`;
 return Object.freeze({value,totalText:String(Math.min(99999,value)).padStart(5,'0'),rankIndex,prize:names[rankIndex],thresholds,meterSteps:resultMeterSteps(thresholds),jp:finiteInt(game.jackpotSuccesses),jackpotDreamHit:!!game.jackpotDreamHit,nextIndex,need,dreamRequired,nextMessage,...best});
}
