// 旧筐体の互換経路だけを別プロセスで起動。GPUはgpu_run.py経由。
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
const {chromium}=createRequire('/home/kabatan/work/Pachikoma/qa/')('playwright-core');
const query=process.argv[2]??'cabinet=r2&howto=0&nolog';
const out=resolve(process.argv[3]??'work/game_demo/play/out/integration1026_legacy');mkdirSync(out,{recursive:true});
const server=fork(new URL('../serve.mjs',import.meta.url),['0'],{stdio:['ignore','pipe','inherit','ipc']});
const {port}=await new Promise(r=>server.once('message',r));let browser,page;const errors=[],warnings=[];let report={passed:false,query};
try {
  browser=await chromium.launch({executablePath:join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),headless:true,
    args:['--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--enable-webgl-draft-extensions']});
  page=await browser.newPage({viewport:{width:1440,height:2560},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());else if(m.type()==='warning')warnings.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}/game_demo/play/index.html?${query}`);
  await page.waitForFunction(()=>window.__ready||window.__startupError,null,{timeout:180000});
  report.state=await page.evaluate(()=>({error:window.__startupError??null,m3:!!window.__m3,
    production:!!window.__lcdSurface?.production,r3:window.__play?.app.rules.R3Enabled,render:window.__play?.pack.render}));
  if(report.state.error)throw new Error(report.state.error);
  await page.keyboard.press('KeyF');await page.keyboard.press('Space');await page.waitForTimeout(3500);
  await page.screenshot({path:join(out,'legacy.png')});
  report.passed=errors.length===0&&!report.state.m3&&report.state.r3;
}catch(e){errors.push(e.stack);}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({...report,errors,warnings},null,2));
  console.log(JSON.stringify({...report,errors,warnings}));await browser?.close();server.kill();
}
process.exitCode=report.passed?0:1;
