// 30 Hz precomputed physical light script; the LCD's displayed media time is the clock.
// R3 (10/29 night): flash_fx adds pachinko-style strobes on top of the table and derives the RGB strip colour (api.strip).
import {createFx,evalFx,hsvTo,stripFrom,ledBoost} from './flash_fx_20261029.mjs';
import {NL_SCENES} from './newlight_1030.mjs';   // 10/30 新しい演出の光（?newlight=0 で無効）
const cw=new Float32Array(8).fill(1);
const triples=n=>Array.from({length:n},()=>[0,0,0]);
const COPY=[['Kc',8,8],['wash',32,8],['zone',56,8],['ring',80,4]];
const SPOTS=[[240,430],[1200,430],[720,300],[150,1100],[1290,1100],[230,1800],[1210,1800],[720,2120]];
const ZONES=[[7,0],[1,2],[0,1],[6,7],[2,3],[5,6],[3,4],[4,5]];
const POCKET_COLORS=[[1,.82,.55],[1,.82,.55],[1,.82,.55],[1,.82,.55],[1,.06,.38],[1,.32,.02],[1,.58,0]];
const PH=[0,.04,.08,.80,.65,.20,.35,.50];
const LAND_EVENTS=new Set(['lamp123','lamp4','lamp5','lamp6','dup_protect','roulette','jp','success_small','success_big','fail']);
// v4: video-clock scenes (index.sources.media). While the scene's surface is displayed (surface.active), its video time is the clock.
function mediaClock(lcd,index,c){
 const m=index.sources.media;if(!m)return null;
 for(const [name,spec] of Object.entries(m)){const s=lcd[spec.surface];if(s?.active)return {name,time:Math.max(0,s.time)};}
 return null;
}
const RING_REG=[1,4,6,7];
const NLQ=typeof location!=='undefined'?location.search||'':'';
const NLON=!/[?&]newlight=0(&|$)/.test(NLQ),SEALIGHT=/[?&]sealight=1(&|$)/.test(NLQ);
export async function attachCabinetLightScript(lcd,{getLamps=()=>[],getState=()=>null}={}){
 if(!lcd?.production||lcd.cabinetLightScript)return lcd;
 const base=new URL('./compiled_v4/',import.meta.url);
 const [index,data]=await Promise.all([
   fetch(new URL('index.json',base)).then(r=>{if(!r.ok)throw Error('Cabinet light index '+r.status);return r.json();}),
   fetch(new URL('timeline.u16',base)).then(r=>{if(!r.ok)throw Error('Cabinet light table '+r.status);return r.arrayBuffer();}),
 ]);
 const table=new Uint16Array(data),scale=1/index.scale;
 if(table.length!==index.rowCount*index.stride)throw Error('Cabinet light table length');
 const row={K:new Array(8).fill(0),Kc:triples(8),wash:triples(8),zone:triples(8),ring:triples(4),recolor:new Array(8).fill(1),jp1029:true,script1029:true,displayGain:1,meterGain:1};
 const hole={mode:'target_pulse',rgb:[1,.58,0],level:.6};
 const holeOv=new Float32Array(21);
 row.reflections=SPOTS.map(([x,y])=>({x,y,rgb:[0,0,0],radius:640,gain:1}));
 const current={source:null,name:null,time:0,frame:0,grammar:null,flash:0,tableBytes:data.byteLength};
 let clock=0,modeKey=null,modeAt=0,lastOffset=-1,lastSource='normal',lastName='idle0',lastTime=0;
 const eventAt=new Map(),meter=new Array(5).fill(0);
 const hitAt=new Array(7).fill(-Infinity),pendingHits=[];let lastReceipt=-1,lastHit=-Infinity,wasFx=false;
 const fx=createFx(),fxCtx={grammar:'',name:'',source:'',t:0,clock:0,lampN:0,hitAge:Infinity,secondsLeft:Infinity,playing:false,x:null},strip=new Float32Array(3),sc=new Float32Array(3);
 const shade=(c,gain,mix,mode,h)=>{const m=Math.max(c[0],c[1],c[2]);if(m<=0)return;
   if(mode===1){c[0]+=(fx.r*m-c[0])*mix;c[1]+=(fx.g*m-c[1])*mix;c[2]+=(fx.b*m-c[2])*mix;}
   else if(mode===2){hsvTo(sc,0,h);for(let j=0;j<3;j++)c[j]+=(sc[j]*m-c[j])*mix;}
   for(let j=0;j<3;j++)c[j]*=gain;};
 const modulateAbs=()=>{   // newlight: absolute per-region levels/colours (aK,aC) from the scene script; fx.gain/white = global hit flick
   const gn=Math.min(ledBoost()?1.9:1.55,fx.gain);
   for(let i=0;i<8;i++){
     const L=Math.min(1.9,fx.aK[i]*gn+fx.white*.45),c=row.Kc[i];
     const r=fx.aC[i*3]+(1-fx.aC[i*3])*fx.white*.35,g=fx.aC[i*3+1]+(1-fx.aC[i*3+1])*fx.white*.35,b=fx.aC[i*3+2]+(1-fx.aC[i*3+2])*fx.white*.35;
     row.K[i]=L;c[0]=r;c[1]=g;c[2]=b;
     const w=row.wash[i],z=row.zone[i];w[0]=r*L*.42;w[1]=g*L*.42;w[2]=b*L*.42;z[0]=r*L*.34;z[1]=g*L*.34;z[2]=b*L*.34;
   }
   // rings: tinted by the mean region colour, one layer each
   let mr=0,mg=0,mb=0,ms=1e-4;for(let i=0;i<8;i++){const k=fx.aK[i];ms+=k;mr+=k*fx.aC[i*3];mg+=k*fx.aC[i*3+1];mb+=k*fx.aC[i*3+2];}
   for(let j=0;j<4;j++){const v=Math.min(.6,fx.aR[j]*gn),c=row.ring[j],q=RING_REG[j];
     if(fx.ringOwn){c[0]=fx.aC[q*3]*v;c[1]=fx.aC[q*3+1]*v;c[2]=fx.aC[q*3+2]*v;}else{c[0]=mr/ms*v;c[1]=mg/ms*v;c[2]=mb/ms*v;}}
 };
 const modulate=()=>{
   if(fx.abs)return modulateAbs();
   const g0=Math.min(ledBoost()?1.8:1.5,fx.gain),mode=fx.mode,mix=fx.mix,d=fx.cDepth;
   // running light: a cosine crest travels around the frame (phase PH per region); dips by up to d, no allocation
   for(let i=0;i<8;i++)cw[i]=d>0?1-d+d*Math.pow(.5+.5*Math.cos(6.283185307*(clock*fx.cHz-PH[i])),fx.cSharp):1;
   cw[1]=cw[2]=cw[0];
   if(fx.aDepth>0){ // R5 alternation: left pillar / right pillar swap places; head group steady-ish, bottom follows the left
     const a=fx.aWave,L=1-fx.aDepth*(1-a),R=1-fx.aDepth*a;
     cw[3]*=L;cw[4]*=L;cw[5]*=R;cw[6]*=R;cw[7]*=R;
   } // head, gills and logo (with the score board) are one lit group: they must dim and brighten together
   for(let i=0;i<8;i++){
     const g=g0*cw[i];
     row.K[i]=Math.min(ledBoost()?1.9:1.55,Math.max(row.K[i]*fx.gain+fx.white*.45,fx.floor*1.1))*cw[i];
     const c=row.Kc[i];
     if(mode===1){c[0]+=(fx.r-c[0])*mix;c[1]+=(fx.g-c[1])*mix;c[2]+=(fx.b-c[2])*mix;}
     else if(mode===2){hsvTo(sc,0,fx.hue+fx.spread*PH[i]);for(let j=0;j<3;j++)c[j]+=(sc[j]-c[j])*mix;}
     if(fx.white>0)for(let j=0;j<3;j++)c[j]+=(1-c[j])*fx.white*.35;
     shade(row.wash[i],g,mix,mode,fx.hue+fx.spread*PH[i]);shade(row.zone[i],g,mix,mode,fx.hue+fx.spread*i/8);
   }
   for(let i=0;i<4;i++)shade(row.ring[i],g0*(1-d*(1-fx.cWave)*.6),mix,mode,fx.hue+fx.spread*i*.2);
 };
 const reflect=()=>{for(let s=0;s<8;s++){const [a,b]=ZONES[s];for(let j=0;j<3;j++)row.reflections[s].rgb[j]=(row.zone[a][j]+row.zone[b][j])*.35+(row.wash[a][j]+row.wash[b][j])*.45;}};
 // ---- newlight (10/30): scenes made today. cue(name,time,x) lets the scene owner drive a light scene by hand (cue(null) releases); autodetected: tutorial v06, tutorial_jp_*, jp_through*/chain_flow_* names.
 let ext=null;const nlSpec={},baseAt=index.sources.normal.idle4.offset,hole7={mode:'script',v:null,rgb:[1,.58,0],level:0},nlx={d:4,N:4,fin:false,rem:4,repeat:false};
 const specFor=(name)=>nlSpec[name]??=(NL_SCENES[name]?{offset:baseAt,frames:1,loop:true,tailFrom:null,grammar:NL_SCENES[name]}:null);
 const resolveNew=(w,shown)=>{
   if(ext)return ext;
   const as=lcd.attractSurface;if(as?.active&&as.kind==='tutorial'&&NL_SCENES.tutorial_v06){ext0.name='tutorial_v06';ext0.time=Math.max(0,as.time);ext0.x=null;return ext0;}
   if(as?.active&&as.kind==='attract'){ext0.name='attract_rainbow';ext0.time=Math.max(0,as.time);ext0.x=null;return ext0;}
   if(!w&&!lcd.choiceV20?.active&&(lcd.current?.mode==='attract'||lcd.current?.mode==='title')){ext0.name='attract_rainbow';ext0.time=clock%20;ext0.x=null;return ext0;}
   const nm=shown?.name??w?.name;if(!nm)return null;
   const tm=Math.max(0,shown?.time??w?.time??0);let m;
   if((m=/^tutorial_jp_(?:n(\d)|fin)$/.exec(nm))){nlx.d=w?.d??4;nlx.N=m[1]?+m[1]:4;nlx.fin=!m[1];ext0.name='tutorial_jp';ext0.time=tm;ext0.x=nlx;return ext0;}
   if(/flow_v09_first|chain_flow_first|chain_announce_first/.test(nm)){nlx.repeat=false;ext0.name='chain_flow_first';ext0.time=tm;ext0.x=nlx;return ext0;}
   if(/flow_v09_repeat|chain_flow_repeat|chain_announce_repeat/.test(nm)){nlx.repeat=true;ext0.name='chain_flow_repeat';ext0.time=tm;ext0.x=nlx;return ext0;}
   if(/jp_through|seal_through/.test(nm)){ext0.name='jp_through_v05';ext0.time=tm;ext0.x=null;return ext0;}
   if(SEALIGHT||/seal_idle|^seal/.test(nm)){const ms=globalThis.__play?.app?.ctrl?.game?.meterStatus;if(ms&&ms.threshold>0&&ms.stage!=='settling'){nlx.N=ms.threshold;nlx.rem=Math.max(1,ms.threshold-ms.count);ext0.name='seal_idle';ext0.time=tm;ext0.x=nlx;return ext0;}}
   return null;
 };
 const ext0={name:null,time:0,x:null};
 const original={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),applyLights:lcd.applyLights?.bind(lcd)};
 lcd.onEvent=(id,p={})=>{eventAt.set(id,clock);if(LAND_EVENTS.has(id)&&p.receiptId!==undefined&&p.receiptId!==lastReceipt&&p.pocket>=1&&p.pocket<=7){pendingHits.push(p.pocket-1);lastReceipt=p.receiptId;}return original.onEvent(id,p);};
 lcd.frame=(dt,F)=>{clock+=dt;for(const i of pendingHits){hitAt[i]=clock;lastHit=clock;}pendingHits.length=0;return original.frame(dt,F);};
 lcd.applyLights=F=>{
   original.applyLights?.(F);if(!F)return;
   const old=F.m3,w=lcd.jp?.where(),choice=lcd.choiceV20,c=lcd.current;
   let source,name,time,media;
   if(choice?.active){source='choice';name=choice.selected;time=choice.time;}
   else if(choice?.holding&&lastSource==='choice'){source=lastSource;name=lastName;time=lastTime;}
   else if(w){
     const shown=lcd.jp.lightingCurrent;
     if(shown){source='jp';name=shown.name;time=shown.time;}
     else {source=lastSource;name=lastName;time=lastTime;}
   } else if((media=mediaClock(lcd,index,c))){source='media';name=media.name;time=media.time;}
   else if(c.mode){
     source='modes';name=c.mode==='reset_fallback'?'roulette':c.mode;
     if(modeKey!==name){modeKey=name;modeAt=eventAt.get(name)??clock;}
     time=Math.max(0,clock-modeAt);
   } else {source='normal';name=c.clip;time=c.time;modeKey=null;}
   let nlScene=null;
   if(NLON&&index.sources.normal.idle4){nlScene=resolveNew(w,lcd.jp?.lightingCurrent);if(nlScene&&specFor(nlScene.name)){source='nl';name=nlScene.name;time=nlScene.time;}else nlScene=null;}
   const spec=nlScene?specFor(name):index.sources[source]?.[name];
   if(!spec)return;
   let f=Math.max(0,Math.floor(time*index.fps+1e-5));
   if(spec.loop)f%=spec.frames;
   else if(spec.tailFrom!==null&&f>=spec.frames)f=spec.tailFrom+(f-spec.tailFrom)%(spec.frames-spec.tailFrom);
   else f=Math.min(spec.frames-1,f);
   const at=spec.offset+f*index.stride;
   // Flashy layer: evaluate first, so a modulated (or just-released) row is always rebuilt from the table.
   const lamps=getLamps(),st=getState();
   fxCtx.grammar=spec.grammar;fxCtx.name=name;fxCtx.source=source;fxCtx.t=time;fxCtx.clock=clock;fxCtx.lampN=Math.min(6,lamps.length);
   fxCtx.x=nlScene?nlScene.x:null;fxCtx.hitAge=clock-lastHit;fxCtx.secondsLeft=st?st.secondsLeft:Infinity;fxCtx.playing=!!st?.playing;
   evalFx(fx,fxCtx);
   if(fx.active||wasFx)lastOffset=-1;
   if(lastOffset!==at){
     for(let i=0;i<8;i++)row.K[i]=table[at+i]*scale;
     for(const [key,offset,n] of COPY)for(let i=0;i<n;i++)for(let j=0;j<3;j++)row[key][i][j]=table[at+offset+i*3+j]*scale;
     row.displayGain=table[at+99]*scale;row.meterGain=1+table[at+98]*scale*.08;
     hole.level=table[at+97]*scale;lastOffset=at;
     stripFrom(strip,fx,row.K,row.Kc);   // RGB strip = the unmodified table colour/level plus the same flash layer
     if(fx.active)modulate();
     reflect();
   }
   wasFx=fx.active;
   // A duplicate can land over an ongoing lamp movie. Its factual hole flash is
   // handled by m3; the small 'held!' LCD overlay gets a single local gold lift.
   const guardAge=clock-(eventAt.get('dup_protect')??-Infinity);
   if(source==='normal'&&!name.startsWith('protect')&&guardAge>=0&&guardAge<.6){
     const gain=.22*(1-guardAge/.6);
     row.K[2]=Math.min(1.55,row.K[2]+gain);row.Kc[2][0]=1;row.Kc[2][1]=.48;row.Kc[2][2]=.012;
     lastOffset=-1; // The next row starts from the table, never accumulates the overlay.
   }
   // TimeUp can dim the live JP aim film instead of changing its clip name.
   // Keep its media phase, reduce decoration, and leave factual holes/digits legible.
   if(source==='jp'&&w?.dim){
     for(let i=0;i<8;i++)row.K[i]*=.38;
     for(const key of ['zone','wash','ring'])for(const c of row[key])for(let j=0;j<3;j++)c[j]*=.38;
     for(const light of row.reflections)for(let j=0;j<3;j++)light.rgb[j]*=.38;
     for(let j=0;j<3;j++)strip[j]*=.38;
     lastOffset=-1;
   }
   row.meterLimit=old?.meterLimit??5;
   if(api.after){api.after(row,strip,clock);lastOffset=-1;}   // 10/30 staff flow: 呼び出し中の電飾を外から上書きする（外すと次の行で表から作り直す）
   // Only actual unlit targets at six lights breathe. A miss never points at an unhit hole.
   const n=Math.min(6,lamps.length),pc=POCKET_COLORS[n];
   row.hole=lamps.length===6?hole:null;
   if(fx.holeOn){hole7.v=fx.hv;row.hole=hole7;}   // newlight: scripted hole LEDs (m3_cabinet 'script' mode)
   if(api.holeOverlay){   // 10/30 first-timer: hole-LED-only cues (sweep / 5-lamp blink / duplicate red) laid over the base light; returns true when it wrote something
     holeOv.fill(0);
     if(api.holeOverlay(holeOv,clock)){if(fx.holeOn)for(let i=0;i<21;i++)if(fx.hv[i]>holeOv[i])holeOv[i]=fx.hv[i];hole7.v=holeOv;row.hole=hole7;}
   }
   // Reflections follow the factual mouth LEDs; C-pack LEDs remain receipt-driven.
   if(F.pocket)for(let i=0;i<7;i++){
     const lit=lamps.includes(i+1),age=clock-hitAt[i],hit=age>=0&&age<.6,white=hit?Math.exp(-age/.06):0,after=hit?1+1.6*Math.exp(-age/.22):1;
     for(let j=0;j<3;j++){
       let v=lit?pc[j]*2:lamps.length===6?hole.rgb[j]*hole.level*2:0;
       if(fx.holeOn&&fx.hv[i*3+j]>0)v=Math.max(v,fx.hv[i*3+j]*2);
       if(hit){const hue=lit||lamps.length===0?pc[j]:hole.rgb[j];v=Math.max(v,hue*2)*after*(1-white)+12*white;}
       F.pocket[i*3+j]=v;
     }
   }
   if(F.seg){meter.fill(0);F.seg.meter=meter;}
   F.m3=row;
   current.source=source;current.name=name;current.time=time;current.frame=f;current.grammar=spec.grammar;current.flash=table[at+98]*scale;current.dim=source==='jp'&&!!w?.dim;
   lastSource=source;lastName=name;lastTime=time;
 };
 const api={current,index,bytes:data.byteLength,strip,fx,cue:(name,time=0,x=null)=>{ext=name?{name,time,x}:null;},get hitAge(){return clock-lastHit;}};lcd.cabinetLightScript=api;
 if(typeof window!=='undefined')window.__cabinetLightScript=api;
 return lcd;
}
