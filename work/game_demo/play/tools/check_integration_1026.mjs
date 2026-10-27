// GPU実行は tools/gpu_run.py 経由。引数なしURLの既定を検査し、実入賞のfixtureで全分岐を通す。
// fixtureでは支払い済みの実Rapier球を口の上へ移すだけ。resolve/配当/規則は偽造しない。
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire('/home/kabatan/work/Pachikoma/qa/')('playwright-core');
const out = resolve(process.argv[2] ?? 'work/game_demo/play/out/integration1026');
mkdirSync(out, { recursive: true });
const server = fork(new URL('../serve.mjs', import.meta.url), ['0'], { stdio: ['ignore','pipe','inherit','ipc'] });
const { port } = await new Promise((r,j) => { server.once('message',r); server.once('error',j); });
let browser, page;
const errors = [], warnings = [], failed = [], requests = [], receipts = [], images = [];
const report = { fixture: 'URLは引数なし。以後、発射した実球を口の上へ置く。最後の残り時間のみ短縮。規則・配当抽選・入賞受付は本物。', passed: false };
try {
  browser = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--enable-webgl-draft-extensions'] });
  page = await browser.newPage({ viewport: { width:1440, height:2560 }, deviceScaleFactor:1 });
  page.on('console', m => { if (m.type()==='error') errors.push(m.text()); else if(m.type()==='warning') warnings.push(m.text()); });
  page.on('pageerror', e => errors.push(e.stack));
  page.on('response', r => { if(r.status()>=400) failed.push([r.status(),r.url()]); });
  page.on('requestfailed', r => failed.push([r.failure()?.errorText,r.url()]));
  page.on('request', r => requests.push(r.url()));
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html`);
  await page.waitForFunction(() => window.__ready || window.__startupError, null, { timeout:180000 });
  assert.equal(await page.evaluate(() => window.__startupError), undefined);
  report.loadMs = Date.now()-t0;
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => !document.getElementById('start'));
  report.defaults = await page.evaluate(() => ({ config:window.__play.config, cabinet:window.__play.pack.cabinet,
    lcd:window.__lcdSurface.production, renderer:window.__play.hr.gl.getParameter(window.__play.hr.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
    rules:window.__play.app.rules }));
  report.mediaCapabilities = await page.evaluate(async()=>{
    if(!navigator.mediaCapabilities) return null;
    try { return await navigator.mediaCapabilities.decodingInfo({type:'file',video:{
      contentType:'video/mp4; codecs="avc1.640028"',width:1152,height:1268,bitrate:40000000,framerate:30}}); }
    catch(e) { return {error:e.message}; }
  });
  assert.equal(report.defaults.config.pinCount,82); assert.ok(report.defaults.lcd);
  assert.deepEqual(report.defaults.rules.PrizeThresholds,[0,30,200,320,500]);
  assert.ok(report.defaults.cabinet);
  await page.evaluate(() => {
    const P=window.__play; P.pause(true); window.__lcdSurface.setManual(true);
    P.app.log.enabled=false; // テストの操作履歴を来場者記録へ混ぜない。
    window.__auditEvents=[];
    window.__effects.on('*',e=>window.__auditEvents.push(structuredClone(e)));
    window.__auditStep=async(seconds,dt=.05)=>{
      for(let t=0;t<seconds-1e-8;t+=dt){const d=Math.min(dt,seconds-t);P.frame(d,false);await window.__lcdSurface.prepare(d);P.draw();}
    };
  });
  const step = seconds => page.evaluate(s => window.__auditStep(s), seconds);
  const state = () => page.evaluate(() => { const P=window.__play,g=P.app.ctrl.game;return {phase:g.phase,lamps:g.lamps,wallet:g.wallet,receipt:g.receipt,chain:g.chainStatus,score:g.jackpotEarnings,prize:g.prize,lcd:window.__lcdSurface.current,drift:P.stats.maxLedgerDrift}; });
  async function shotAt(lane, label, settle=.4) {
    for(let i=0;i<200;i++){
      const ready=await page.evaluate(()=>window.__play.app.ctrl.game.canFire && window.__play.pa.shuttleHas);
      if(ready)break; await step(.1);
    }
    await page.keyboard.press('Space');
    const shot=await page.evaluate((lane)=>{
      const P=window.__play,g=P.app.ctrl.game,b=P.pa.board,paid=g.shot;
      const ball=b.balls.get(paid?.id);if(!ball)throw new Error('paid physical ball is missing');
      const cup=b.layout.cups.find(c=>c.n===lane), S=10, z=ball.body.translation().z;
      ball.body.setTranslation({x:cup.xc/1000*S,y:(cup.ym/1000+.025)*S,z},true);
      ball.body.setLinvel({x:0,y:-2*S,z:0},true);
      return {id:paid.id,before:g.lamps};
    },lane);
    for(let i=0;i<100;i++){
      await step(.05);
      const done=await page.evaluate(id=>window.__play.app.ctrl.game.receipt?.lane>0 && !window.__play.pa.board.balls.has(id),shot.id);
      if(done)break;
    }
    const s=await state();assert.equal(s.receipt.lane,lane,label);assert.equal(s.drift,0,label+' ledger');
    receipts.push({label,lane,receipt:s.receipt,score:s.score,chain:s.chain});
    await step(settle);return state();
  }
  async function snap(name) {
    const s=await state();
    await page.screenshot({path:join(out,name+'.png')});
    await page.evaluate(()=>{ const c=window.__lcdSurface.canvas;window.__lcdImage=c.toDataURL('image/png'); });
    const data=await page.evaluate(()=>window.__lcdImage);
    writeFileSync(join(out,name+'_lcd.png'),Buffer.from(data.split(',')[1],'base64'));
    images.push({name,state:s});console.log('screenshot',name,s.phase,s.lamps,s.lcd.clip,s.lcd.mode);
  }
  await step(.2);await snap('00_attract');
  await page.keyboard.press('Space');await step(.8);await snap('01_howto');
  await step(8.0);await snap('02_start');
  for(let i=0;i<150;i++) {if((await state()).phase==='Ready')break;await step(.1);}
  await step(.3);await snap('03_normal0');
  await shotAt(1,'lamp1',.7);await snap('04_lamp1');
  await shotAt(1,'protect1',.5);await snap('05_protect1');
  await shotAt(2,'lamp2',.9);await snap('06_lamp2');
  await shotAt(3,'lamp3',1.2);await snap('07_lamp3');
  await shotAt(3,'protect3',.4);await snap('08_protect3');
  await shotAt(4,'lamp4',.7);await snap('09_lamp4');
  await shotAt(4,'protect4a',.1);await shotAt(4,'protect4b',.1);
  const reset=await shotAt(4,'reset4',1.4);assert.equal(reset.lamps.length,3);await snap('10_reset4');
  await shotAt(4,'restore4',.7);
  await shotAt(5,'lamp5',2.2);await snap('11_lamp5');
  await shotAt(6,'lamp6',.2);await snap('12_lamp6');
  // 入賞の機会を作るだけ。初回JPの配当値は現R3の乱数が決める。
  await shotAt(7,'jp',.5);await snap('13_jp_placeholder');
  for(let i=0;i<160;i++){if((await state()).phase==='ChainChoice')break;await step(.1);}
  assert.equal((await state()).phase,'ChainChoice');await snap('14_choice');
  await page.keyboard.press('Space');await step(.7);await snap('15_chain_aim');
  const unlit=await page.evaluate(()=>[1,2,3,4,5,6,7].find(n=>!window.__play.app.ctrl.game.lamps.includes(n)));
  await shotAt(unlit,'chain_success',.5);await snap('16_chain_payout');
  for(let i=0;i<160;i++){if((await state()).phase==='ChainChoice')break;await step(.1);}
  const offer=await state();assert.ok(offer.chain.pendingAward>0);await snap('17_choice_pending');
  await page.keyboard.press('KeyC');await step(.3);await snap('18_banked');
  for(let i=0;i<180;i++){if((await state()).phase==='Ready')break;await step(.1);}
  await page.evaluate(()=>{window.__play.app.ctrl.game.secondsLeft=.2;});
  for(let i=0;i<80;i++){if((await state()).phase==='Continue')break;await step(.1);}
  assert.equal((await state()).phase,'Continue');await snap('19_timeup');
  await page.keyboard.press('KeyA');await step(.4);await snap('20_extra');
  for(let i=0;i<80;i++){if((await state()).phase==='Ready')break;await step(.1);}
  await page.evaluate(()=>{window.__play.app.ctrl.game.secondsLeft=.2;});
  for(let i=0;i<80;i++){if((await state()).phase==='Continue')break;await step(.1);}
  await page.keyboard.press('KeyB');await step(.3);await snap('21_count');
  for(let i=0;i<1800;i++){
    const done=await page.evaluate(()=>window.__play.stats.countDone && window.__lcdSurface.current.mode==='result');
    if(done)break;await step(.1);
  }
  await snap('22_result');
  report.end=await page.evaluate(()=>({wallet:window.__play.app.ctrl.game.wallet,counted:window.__play.stats.countDone?.counted,
    drift:window.__play.stats.maxLedgerDrift,lost:window.__play.stats.lost,lcd:window.__lcdSurface.stats}));
  assert.equal(report.end.wallet,report.end.counted);assert.equal(report.end.drift,0);
  assert.equal(report.end.lost,0);assert.deepEqual(report.end.lcd.errors,[]);
  const events=await page.evaluate(()=>window.__auditEvents);
  writeFileSync(join(out,'events.json'),JSON.stringify(events,null,2));
  for(const id of ['ticket','start','lamp123','lamp4','lamp5','lamp6','dup_protect','roulette','ascend','jp','chain_choice','chain_continue','chain_stop','timeup','finish_count','result']) assert.ok(events.some(e=>e.id===id),'missing '+id);
  assert.equal(requests.filter(u=>u.includes('/jp_film/')).length,0,'JP videos must not be loaded');
  // 引数なし・通常のrAFで計測。画質や描画寸法は変更しない。
  await page.keyboard.press('KeyR');await step(.3);
  await page.evaluate(()=>{
    window.__lcdSurface.setManual(false);window.__play.pause(false);
    const frames=[];window.__auditPerf={frames,at:performance.now()};let previous=performance.now();
    function sample(t){frames.push(t-previous);previous=t;if(t-window.__auditPerf.at<45000)requestAnimationFrame(sample);}
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(9000);
  await page.evaluate(()=>{window.__auditFire=setInterval(()=>{const c=window.__play.app.ctrl;if(c.game.canFire)c.dispatch('fire');},600);});
  await page.waitForTimeout(37000);
  report.performance=await page.evaluate(()=>{
    clearInterval(window.__auditFire);const a=window.__auditPerf.frames.slice(10).sort((a,b)=>a-b),q=p=>a[Math.min(a.length-1,Math.floor(a.length*p))];
    return {frames:a.length,meanMs:a.reduce((s,v)=>s+v,0)/a.length,p50:q(.5),p95:q(.95),p99:q(.99),over33:a.filter(x=>x>33.4).length,
      lcd:window.__lcdSurface.diagnostics(),maxDrawMs:window.__lcdSurface.stats.maxDrawMs,canvas:[window.__play.hr.renderer.domElement.width,window.__play.hr.renderer.domElement.height]};
  });
  await snap('23_realtime');
  await page.evaluate(()=>{window.__play.pause(true);window.__lcdSurface.setManual(true);});
  await page.setViewportSize({width:2560,height:1440});
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(300);
  report.monitor=await page.evaluate(()=>{
    const b=document.getElementById('c').getBoundingClientRect();
    return {mode:document.documentElement.dataset.display,viewport:[innerWidth,innerHeight],
      backing:[document.getElementById('c').width,document.getElementById('c').height],
      screen:[b.width,b.height],nativeLCD:[1152,1268]};
  });
  assert.equal(report.monitor.mode,'portrait');assert.deepEqual(report.monitor.screen,[2560,1440]);
  await page.screenshot({path:join(out,'24_wqhd_rotated.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  report.defaultPassed=true;
  // 互換経路はcheck_legacy_1026.mjsで別に検査。旧Canvasの起動失敗を既定ゲームの結果と混ぜない。
  report.passed=true;
} catch(e) {
  errors.push(e.stack);
  if(page) report.failureState=await page.evaluate(()=>{
    const P=window.__play;if(!P)return null;
    return {phase:P.app.ctrl.phase,receipt:P.app.ctrl.game.receipt,wallet:P.app.ctrl.game.wallet,
      ledger:P.pa.ledger(),pending:P.app.presenter.pending,tray:P.trayStatus(),stats:P.stats,lcd:window.__lcdSurface?.current};
  }).catch(()=>null);
  if(page) await page.screenshot({path:join(out,'error.png')}).catch(()=>{});
} finally {
  writeFileSync(join(out,'report.json'),JSON.stringify({...report,errors,warnings,failed,receipts,images},null,2));
  console.log(JSON.stringify({passed:report.passed,errors,failed,performance:report.performance,out}));
  await browser?.close();server.kill();
}
process.exitCode=report.passed?0:1;
