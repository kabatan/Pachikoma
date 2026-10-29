import {createFullPanelPreviousOwner} from './fullpanel_previous_1029.mjs';
import {createResultHistoryOwner} from './result_history_owner_1029.mjs';
import {withRestored2D} from './startup_warm.mjs';
import {createClipPlayer,drawClipSnapshot} from './clip_player.mjs';
import {createJpSurface,jpEffectSeconds,chainEffectSeconds} from './jp_surface_confirm1029.mjs';
// 通常演出：本番動画。最初のJPは指定manifestへ委譲し、継続の既存表示を保持する。
// jp_filmのmanifest/映像は一切読み込まない。規則を止めたり書き換えたりしない。
const W = 1152, H = 1268, PX = 34, PY = 28;
const tier = [[.12,.4,1],[.12,.4,1],[.6,.15,1],[1,.08,.45],[1,.08,.12],[1,.4,.02],[1,.7,.1]];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// 素材選択を純関数にして、実ルールのレシートとの対応を試験する。
export function normalClipFor(id, p, variant = 0) {
  const n = clamp(p.after?.length ?? p.n ?? p.lit ?? 0, 0, 6);
  if (['lamp123','lamp4','lamp5','lamp6'].includes(id)) {
    return n === 3 && variant % 2 ? 'lamp3b' : n === 4 && variant % 2 ? 'lamp4b' : `lamp${n}`;
  }
  if (id === 'dup_protect') return `protect${clamp(p.before?.length ?? n, 1, 5)}`;
  // R3の通常経路では4/5灯→1灯消灯。低灯数の昇天は映像選択自体を拒む。
  if (id === 'roulette' && [4,5].includes(p.before?.length ?? p.n_from) && (p.removedCount ?? p.k) === 1) return `reset${p.before?.length ?? p.n_from}`;
  return null;
}

export async function createProductionLcd({ manifestUrl, man, getState, jpManifestUrl, onJpCue, palaceImageFactory = null, resultImageFactory = null, videoImageFactory = null, resultBoundaryGpu = null, fullPanelPrevious = null }) {
  const base = new URL('.', manifestUrl);
  const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1510;
  const ctx = canvas.getContext('2d', { alpha: false });
  const transition = document.createElement('canvas'); transition.width=canvas.width;transition.height=canvas.height;
  const previous = transition.getContext('2d',{alpha:false});let fadeLeft=0,lastJpSerial=-1;
  let paintedResult=null,resultUploadRevision=0,stableResult=false;
  const invalidateResult=()=>{paintedResult=null;stableResult=false;};
  // V2 opt-in: choice still owns active frames; GPU handoff may borrow the new
  // base source, while its wrapper composes both the inner and outer fades.
  const gpuChoiceHold=lcd=>{const c=lcd?.choiceV20;return !!(c?.holding&&!c.active&&c.gpuHoldActive&&typeof c.captureGpuBridgeLease==='function'&&typeof c.materializeGpuBridgeFallback==='function');};
  const choiceWrites=lcd=>!!(lcd?.choiceV20?.active||lcd?.choiceV20?.holding&&!gpuChoiceHold(lcd));
  let surfaceOwner=null,choiceBridge=null;
  const choiceBridgeStats={captures:0,releases:0,cpuFallbacks:0,failures:[]};
  const releaseChoiceBridge=()=>{if(!choiceBridge)return;const old=choiceBridge;choiceBridge=null;try{old.lease.release();choiceBridgeStats.releases++;}catch(error){choiceBridgeStats.failures.push(String(error?.message??error));}};
  const bridgeLeaseValid=lease=>{try{return !!(lease?.live&&lease.width===1240&&lease.height===1510&&lease.texture&&typeof lease.release==='function');}catch{return false;}};
  let gpuFrame=null,resultHistory=null,fullPrevious=null,palaceBoundary=null;
  const palaceFrame=()=>({owner:'palace-boundary',backend:palaceBoundary,get published(){return palaceBoundary.published;},set published(v){palaceBoundary.published=v;}});
  if(fullPanelPrevious){fullPanelPrevious.warmup({sourceCanvas:canvas});fullPrevious=createFullPanelPreviousOwner({manager:fullPanelPrevious,ctx,previous,blocked:()=>!!(surfaceOwner?.choiceV20?.active||surfaceOwner?.choiceV20?.holding||choiceBridge||resultHistory?.active)});}
  const materializeGpu=(reason,force=false)=>{if(!gpuFrame)return false;const dest=gpuFrame.published||force?ctx:null;if(resultHistory?.active&&gpuFrame.backend===videoBackend){if(!resultHistory.fallback(reason,{panelCtx:dest,heldCtx:hold,includeBridge:true}))return false;}else{gpuFrame.backend.materializeTo({panelCtx:dest,heldCtx:hold,previousCtx:previous,reason});if(gpuFrame.backend===palaceBoundary)palaceBoundary.abandon();resultHistory?.clearPublished();}gpuFrame=null;return true;};
  const bridge=()=>{
    const external=fullPrevious?.begin();if(external==='gpu'){gpuFrame=null;invalidateResult();fadeLeft=.12;return;}if(external==='cpu'){gpuFrame=null;releaseChoiceBridge();invalidateResult();previous.drawImage(canvas,0,0);fadeLeft=.12;return;}
    const route=resultHistory?.begin({blocked:!!(surfaceOwner?.choiceV20?.active||surfaceOwner?.choiceV20?.holding||choiceBridge)});
    if(route==='gpu'){gpuFrame=null;invalidateResult();fadeLeft=.12;return;}if(route==='cpu')gpuFrame=null;
    if(palaceBoundary&&jp?.active&&!jp.layered&&!choiceWrites(surfaceOwner)&&gpuFrame&&(gpuFrame.backend===jp.palace.imageBackend||gpuFrame.backend===palaceBoundary)&&palaceBoundary.begin(gpuFrame.backend)){gpuFrame=null;invalidateResult();fadeLeft=.12;return;}
    if(gpuChoiceHold(surfaceOwner)||choiceBridge&&typeof surfaceOwner?.choiceV20?.captureGpuBridgeLease==='function'&&typeof surfaceOwner.choiceV20.materializeGpuBridgeFallback==='function'){
      let lease=null;try{lease=surfaceOwner.choiceV20.captureGpuBridgeLease();}catch(error){choiceBridgeStats.failures.push(String(error?.message??error));}
      if(bridgeLeaseValid(lease)){
        // The hook returns one owned handle. Complete the replacement before
        // releasing the old handle, and never read a stale base GPU source.
        releaseChoiceBridge();choiceBridge={lease,alpha:1};choiceBridgeStats.captures++;gpuFrame=null;invalidateResult();fadeLeft=.12;return;
      }
      try{lease?.release?.();}catch{}
      if(!surfaceOwner.choiceV20.materializeGpuBridgeFallback())throw Error('GPU choice bridge has neither a completed native lease nor CPU fallback');
      choiceBridgeStats.cpuFallbacks++;gpuFrame=null;
    }else materializeGpu('bridge');
    releaseChoiceBridge();invalidateResult();previous.drawImage(canvas,0,0);fadeLeft=.12;
  };
  const blend=dt=>{if(fadeLeft<=0)return;fadeLeft=Math.max(0,fadeLeft-dt);
    if(fullPrevious?.blend(fadeLeft/.12))return;
    if(palaceBoundary?.setAlpha(fadeLeft/.12))return;
    if(choiceBridge){choiceBridge.alpha=fadeLeft/.12;if(fadeLeft<=0)releaseChoiceBridge();return;}
    ctx.globalAlpha=fadeLeft/.12;ctx.drawImage(transition,0,0);ctx.globalAlpha=1;
  };
  const held = document.createElement('canvas'); held.width = W; held.height = H;
  const hold = held.getContext('2d', { alpha: false });
  hold.fillStyle = '#052a57'; hold.fillRect(0, 0, W, H);
  const stats = { lifecycle: [], frames: 0, played: [], errors: [], switches: 0, maxDrawMs: 0, placeholders: [] };
  const fail = (message) => { stats.errors.push(message); console.error('[normal1026]', message); };
  // One exclusive normal/plain-JP backend. Existing players keep media ownership.
  let videoBackend=null,videoFailed=false,ringCanvas=null,ringCtx=null;
  const videoStats={requested:!!videoImageFactory,mode:'legacy',frames:0,fallbacks:0,failures:[]};
  if(videoImageFactory)try{
    videoBackend=await videoImageFactory({width:canvas.width,height:canvas.height,visible:{x:PX,y:PY,w:W,h:H}});
    if(!videoBackend?.render||!videoBackend?.compose||!videoBackend?.setFlash||!videoBackend?.setHudCanvas||!videoBackend?.materializeTo)throw Error('Invalid video image factory API');
    videoStats.mode='injected';if(resultBoundaryGpu&&videoBackend.warmHistory)videoStats.historyWarm=videoBackend.warmHistory();
  }catch(error){try{videoBackend?.dispose?.();}catch{}videoBackend=null;videoStats.mode='factory-fallback';videoStats.failures.push(String(error?.message??error));}
  const publishVideo=(snapshot,w=null,bridgeDt=0)=>{
    if(!videoBackend||videoFailed||!snapshot||!resultHistory?.active&&(!snapshot.layers.length||snapshot.layers[0].alpha!==1)||snapshot.layers.some(l=>!l.drawable||l.video.videoWidth!==W||l.video.videoHeight!==H))return false;
    if(gpuFrame&&gpuFrame.backend!==videoBackend&&gpuFrame.backend!==palaceBoundary)materializeGpu('video-owner-entry');
    try{
      const output=videoBackend.render(snapshot);
      if(!output){videoStats.fallbacks++;const d=videoBackend.diagnostics?.();if(d?.failed){videoFailed=true;videoStats.mode='render-fallback';videoStats.failures.push(String(d.reason??'GPU video image failed'));}return false;}
      videoBackend.setFlash(w?.flash,w?.flashColor);if(palaceBoundary?.active){palaceBoundary.setFrame({kind:'backend',backend:videoBackend});blend(bridgeDt);gpuFrame=palaceFrame();}else{if(gpuFrame?.backend===palaceBoundary)palaceBoundary.abandon();if(choiceBridge)blend(bridgeDt);gpuFrame={backend:videoBackend,published:false,owner:snapshot.owner};}videoStats.frames++;return true;
    }catch(error){videoFailed=true;videoStats.failures.push(String(error?.message??error));videoStats.mode='render-fallback';return false;}
  };
  if(resultBoundaryGpu&&videoBackend?.seedResultHistory&&videoBackend?.materializeHistoryTo)resultHistory=createResultHistoryOwner({manager:resultBoundaryGpu,backend:videoBackend,ctx,hold,previous});
  const finishFrame=t0=>{stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);};

  const clips = createClipPlayer({base, files:man.files, onError:fail, record:e=>{stats.lifecycle.push(e);if(stats.lifecycle.length>2000)stats.lifecycle.shift();}});
  const shown = {get name(){return clips.name;},get time(){return clips.time;}};
  const jp = jpManifestUrl ? await createJpSurface({manifestUrl:jpManifestUrl,palaceImageFactory,resultImageFactory,onResultBeforeReuse:next=>{if(resultHistory?.beforeReuse(next)?.cpu)gpuFrame=null;},onCue:onJpCue,getState,log:n=>stats.played.push([+clock.toFixed(3),n])}).catch(e=>{stats.errors.push('JP: '+e.message);console.warn('[jp1029]',e.message);return null;}) : null;
  palaceBoundary=jp?.palace?.imageBackend?.palaceBoundary??null;
  if(jp){const r=getState().rules;r.FirstJackpotEffectSeconds=Object.fromEntries(jp.man.digits.map(d=>[d,r.JackpotAwards.map(p=>jpEffectSeconds(jp.man,p))]));
    // 継続成功の演出時間: 着地+継続成功v4+配当の通しの長さ(初回JPと同様に映像へ合わせる)。映像が無い場合は規則の既定のまま。
    const chainSeconds=r.JackpotAwards.map(p=>chainEffectSeconds(jp.man,p));if(chainSeconds.every(Number.isFinite))r.JackpotEffectSeconds=chainSeconds;}
  const lightFrames = man.lights ? await (await fetch(new URL(man.lights, base))).json() : {};
  const font = new FontFace('Dela1026', `url(${new URL('../../../effects/lcd/fonts/DelaGothicOne-Regular.ttf', import.meta.url).href})`);
  await font.load(); document.fonts.add(font);
  let clock = 0, manual = false, shotOn = false, jpOwns = false, lastEvent = null;
  let mode = { id: 'attract', p: {}, at: 0, until: Infinity }, guard = null;
  let variants = {}, normalN = 0, launchPulses = [], cards = null;   // cards: temp_cards_20261029 の本番差し替え(未接続なら従来の仮カード)
  const play = (name) => {
    if (!name || !man.files[name]) return;
    clips.request(name); shotOn = true; stats.switches++;
    stats.played.push([+clock.toFixed(3), name]); if (stats.played.length > 500) stats.played.shift();
  };
  const temporary = (id, p, seconds = Infinity) => {
    // 仮：JP・連チャン等が完成するまで、同じ海の上に題字・実数を出す。
    bridge(); mode = { id, p: { ...p }, at: clock, until: clock + seconds };
    shotOn = false; stats.placeholders.push(id);
    if (stats.placeholders.length > 300) stats.placeholders.shift();
  };
  await clips.init();
  clips.prefetch(['lamp1','lamp2','idle1']);
  clips.frame(0, hold, W, H);

  const text = (s, x, y, size, color = '#fff2ca', align = 'center', max = 1040) => {
    ctx.save(); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.font = `${size}px Dela1026`;
    const width = ctx.measureText(String(s)).width;
    if (width > max) ctx.font = `${Math.floor(size * max / width)}px Dela1026`;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size * .08); ctx.strokeStyle = '#102450';
    ctx.strokeText(String(s), x, y); ctx.fillStyle = color; ctx.fillText(String(s), x, y); ctx.restore();
  };
  function card(title, lines, color = '#ffdb83', value = null) {
    ctx.fillStyle = 'rgba(1,12,41,.60)'; ctx.fillRect(0, 130, W, 640);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(42, 153, 1068, 580);
    text(title, W/2, 278, 94, color);
    if (value !== null) text(value, W/2, 423, 140, '#fff6cc');
    lines.forEach((line, i) => text(line, W/2, (value !== null ? 566 : 442) + i * 88, 43, '#fff5e6'));
  }
  function drawTemporary(s) {
    const p = mode.p, c = s.chain ?? {}, elapsed = clock - mode.at;
    if (cards?.draw(ctx, mode.id, p, elapsed, s)) return;
    switch (mode.id) {
      case 'attract': case 'title':
        ctx.fillStyle = 'rgba(2,15,52,.25)'; ctx.fillRect(0, 150, W, 600);
        text('パチコマ', W/2, 360 + 8 * Math.sin(clock * 1.8), 158, '#ffb9db');
        text('左のボタンで スタート！', W/2, 590, 60 + 3 * Math.sin(clock * 3), '#fff2a8');
        break;
      case 'howto': {
        const k = clamp(Math.floor((s.howtoT ?? elapsed) / (p.seconds || 8) * 3), 0, 2);
        const steps = [['左のボタンで 玉をうつ', '穴に入ると ランプがつく'],
                       ['ランプを６つ集めよう', '６つで JPチャンス！'],
                       ['光っていない穴へ！', '入れば 大当り！']];
        card('あそびかた', steps[k], '#b0efff', `${k+1} / 3`); break;
      }
      case 'ticket': card('スタート！', ['ランプを６つ集めよう'], '#ffdb83', `${p.balls ?? s.rules.LoanBalls}玉`); break;
      case 'challenge_wait': case 'challenge_declare': case 'lamp6':
        card('JPチャンス！', ['光っていない穴へ！', '左のボタンで 玉をうつ'], '#ffda69'); break;
      case 'challenge_flight': card(p.chain ? '連チャンの挑戦！' : '入れぇ！！', ['光っていない穴に 入れば成功！'], '#ffca78'); break;
      case 'jp':
        card('大当り！', [p.chain ? '積み増し！ 確定まで大切に' : '最初の配当は もう確定！'], '#ffe093', `${p.payout ?? p.award ?? 0}玉`); break;
      case 'chain_announce':   // JP後の継続の告知（差し込み口。専用の映像ができるまでの仮カード）。first=最初の継続（選択なしで自動継続）／2回目以降は選択画面の前に出る
        if (p.first) card('継続チャンス!!!', ['2/3でJP継続', 'もう一度ルーレット'], '#ffe093');
        else card('継続チャンス!!!', ['継続で得た', `${p.atRisk ?? 0}玉を失う可能性あり`], '#ff9fb8', `${p.atRisk ?? 0}玉`); break;
      case 'chain_choice': {
        const pending = c.pendingAward ?? p.pending ?? 0, baseAward = c.baseAward ?? p.base ?? 0;
        const next = c.nextLamps ?? p.lamps ?? 1;
        card('連チャンチャンス！', [`左：つづける（次は${next}灯）`, '右：積み増しを確定'], '#ffb4dc', `＋${pending}玉`);
        text(`最初の ${baseAward}玉 は残る`, W/2, 802, 36, '#fff2bf'); break;
      }
      case 'chain_continue': card('もう一度！', ['光っていない穴へ！', '左のボタンで 玉をうつ'], '#ffb4dc', `${p.lamps ?? 1}灯`); break;
      case 'chain_stop': card('確定！', ['積み増しを獲得！'], '#fff2a0', `${p.banked ?? p.total ?? 0}玉`); break;
      case 'fail': card('また挑戦しよう！', [p.chain ? `最初の ${p.base ?? 0}玉 は残ります` : 'ランプを集めて もう一度！'], '#c5d9ff', p.chainLost > 0 ? `積み増し −${p.chainLost}玉` : null); break;
      case 'timeup': card('時間です', ['追加で ＋22秒・10玉', '追加しないと 計数へ進みます'], '#ffccac'); break;
      case 'add100': card('まだまだ！', ['続きを楽しもう！'], '#ffdb92', `＋${p.seconds ?? 22}秒`); break;
      case 'finish_count': card('計数中', [p.basis === 'wallet' ? '持ち玉の数で賞が決まります' : `JPの合計 ${p.score ?? s.score ?? 0}玉`], '#b8e8ff', `${p.total ?? p.balls ?? s.balls}玉`); break;
      case 'result': card(s.prize || ['参加賞','C賞','B賞','A賞','S賞'][p.rankIndex ?? p.rank ?? 0], ['ありがとうございました！'], '#ffe198', p.basis === 'wallet' ? `持ち玉 ${p.balls ?? p.score ?? s.score ?? 0}玉` : `JP合計 ${p.score ?? s.score ?? 0}玉`); break;
      case 'reset_fallback': card('重複！', ['ランプが消えた… もう一度！'], '#ffb0ba'); break;
    }
  }
  function drawLaunchRings(ctx, ages=launchPulses.map(at=>(clock-at)/.8)) {
      for (const a of ages) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .32 * (1-a)**1.4;
        ctx.strokeStyle = '#adf6ff'; ctx.lineWidth = 9*(1-a)+2;
        ctx.beginPath(); ctx.ellipse(W/2, 300, 30+410*(1-(1-a)**3), 18+240*(1-(1-a)**3), 0, 0, 2*Math.PI); ctx.stroke(); ctx.restore();
      }
  }
  function ringOverlay() {
    if(!launchPulses.length)return null;
    if(!ringCanvas){ringCanvas=document.createElement('canvas');ringCanvas.width=912;ringCanvas.height=552;ringCtx=ringCanvas.getContext('2d');}
    const ages=Object.freeze(launchPulses.map(at=>(clock-at)/.8));
    ringCtx.clearRect(0,0,912,552);ringCtx.save();ringCtx.translate(-120,-24);drawLaunchRings(ringCtx,ages);ringCtx.restore();
    return {canvas:ringCanvas,x:120,y:24,width:912,height:552,blend:'screen',revision:clock,replay:target=>drawLaunchRings(target,ages)};
  }
  function onEvent(id, p = {}) {
    invalidateResult();
    lastEvent = { id, p, at: clock };
    const wasClaimed=jp?.claimed, handled=jp?.onEvent(id,p);
    if(wasClaimed&&!jp?.claimed)bridge();
    if (handled) {if(['chain_stop','fail'].includes(id))mode=null;return;}
    if (['lamp123','lamp4','lamp5','lamp6'].includes(id)) {
      const n = p.after?.length ?? p.n ?? p.lit;
      const variant = variants[n] ?? 0; variants[n] = variant + 1;
      if(mode)bridge();mode = null; normalN = n;
      play(normalClipFor(id, p, variant));
      const nextN=Math.min(6,n+1),nextVariant=variants[nextN]??0;
      clips.prefetch([nextN===3&&nextVariant%2?'lamp3b':nextN===4&&nextVariant%2?'lamp4b':`lamp${nextN}`,...([4,5].includes(n)?[`reset${n}`]:[])]);
      return;
    }
    if (id === 'dup_protect') {
      // 点灯の大きな演出を連打の保護で消さない。保護は独立した小さな反応にも出す。
      guard = { at: clock, until: clock + 1.1 };
      if (!shotOn && !mode) play(normalClipFor(id, p));
      return;
    }
    if (id === 'roulette') {
      const clip = normalClipFor(id, p);
      if(mode)bridge();mode = null;
      if (clip) play(clip); else temporary('reset_fallback', p, cards?.ttl?.('reset_fallback') ?? 1.3);
      return;
    }
    if (id === 'ascend') return; // reset動画内の昇天を二重起動しない。
    if (id === 'launch') { launchPulses.push(clock); launchPulses = launchPulses.slice(-3); return; }
    if (id === 'start') { if(mode)bridge();mode = null; shotOn = false; return; }
    if (['attract','title','howto','ticket','timeup','finish_count','result','add100','challenge_wait','challenge_declare','challenge_flight','jp','chain_choice','chain_announce','chain_continue','chain_stop','fail'].includes(id)) {
      if (id === 'attract' || id === 'ticket') { variants = {}; normalN = 0; guard = null; }
      const ttl = id === 'jp' ? Math.max(.5, p.duration ?? 6.3) : id === 'fail' ? Math.max(1.35, p.duration ?? 0) : id === 'chain_stop' ? 1.8 : id === 'chain_announce' ? Math.max(.5, p.seconds ?? 2.5) : id === 'add100' ? (cards?.ttl?.('add100') ?? 1.5) : id === 'ticket' ? (cards?.ttl?.('ticket') ?? Infinity) : Infinity;
      temporary(id, p, ttl);
    }
    if (id === 'challenge_cancel') {bridge();mode = null;}
  }
  const api={
    canvas, stats, production: true, jp,
    get uploadRevision(){return stableResult&&!choiceWrites(this)?resultUploadRevision:undefined;},
    get current() { return { mode: jp?.active ? 'jp1029' : mode?.id ?? null, clip: jp?.active ? jp.where()?.name : shown.name, shot: shotOn, time: shown.time, normalN, lastEvent }; },
    async warmJpRush(){
      if(clock!==0||jpOwns||lastJpSerial!==-1||jp?.claimed)throw Error('JP rush warm is boot-only');
      if(!jp?.warmStartupRush)return {skipped:true,reason:'no-jp-warm-api'};
      const afterDraw=()=>{
        ctx.filter='none';ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(held,PX,PY);
      };
      const rush=await withRestored2D(ctx,()=>jp.warmStartupRush(hold,W,H,{afterDraw}));
      // 継続成功v4と配当の先読み・復号（起動時のみ）。
      const chain=jp.warmStartupChain?await withRestored2D(ctx,()=>jp.warmStartupChain(hold,W,H,{afterDraw})):null;
      return chain?{...rush,chain}:rush;
    },
    onEvent, setCards(c) { cards = c; },
    get gpuPanelSource(){return fullPrevious?.wrap(gpuFrame)??gpuFrame;},
    withFullPanelPreviousSource(source,fn){return fullPrevious?fullPrevious.withSource(source,fn):fn();},
    get fullPanelPreviousManager(){return fullPanelPrevious;},
    get fullPanelPreviousRawHeld(){return held;},
    fullPanelPreviousDiagnostics(){return {...(fullPrevious?.diagnostics()??{enabled:false}),rawHeld:{width:held.width,height:held.height,finalSeeds:0},clip:{name:clips.name,time:clips.time},normalFrameCount:stats.frames};},
    get choiceGpuBridge(){return choiceBridge?{lease:choiceBridge.lease,alpha:choiceBridge.alpha}:null;},
    choiceGpuBridgeDiagnostics(){return {...choiceBridgeStats,failures:[...choiceBridgeStats.failures],active:!!choiceBridge,alpha:choiceBridge?.alpha??0};},
    get videoImageBackend(){return videoBackend;},
    materializeGpuLcd(reason='consumer',force=false){if(fullPrevious?.active){fullPrevious.materialize(reason);gpuFrame=null;return true;}return materializeGpu(reason,force);},
    async warm(){if(clock!==0||jpOwns)throw Error('normal warm is boot-only');return clips.warm(hold,W,H);},
    setManual(on) { manual = !!on; clips.setManual(on); jp?.setManual(on); },
    async prepare(dt) { if(jp?.active){await jp.prepare(dt);return;} await clips.prepare(dt); },
    frame(dt, F) {
      const t0 = performance.now(); clock += dt;stableResult=false;
      if(choiceWrites(this)){paintedResult=null;resultHistory?.clearPublished();if(gpuFrame?.backend===palaceBoundary)materializeGpu('palace-choice-owner');}
      const s = getState();
      if (jp?.claimed) {
        if(fullPrevious?.active){fullPrevious.fallback('final-previous-jp-owner');gpuFrame=null;}
        if(resultHistory?.active){resultHistory.fallback('jp-owner',{includeBridge:true});gpuFrame=null;}
        jp.palace?.imageBackend?.setLegacyMode(choiceWrites(this));
        let v=jp.frame(dt);
        if(!jp.active&&lastJpSerial>=0){bridge();lastJpSerial=-1;}
        // 映像の最初のコマがまだ読めていない間は、前の映像の最後(失敗の灰色＋扉など)を出さず、通常の画面のままにする。
        if (jp.active && (jpOwns || v?.readyState>=2)) {
          if(jp.where()?.serial!==lastJpSerial){if(!jp.layered)bridge();lastJpSerial=jp.where()?.serial;}if(jp.layered){fadeLeft=0;fullPrevious?.abandon();releaseChoiceBridge();if(palaceBoundary?.ownsFrame){if(gpuFrame?.backend===palaceBoundary)gpuFrame=null;palaceBoundary.abandon();}}if(resultHistory?.active){resultHistory.fallback('jp-serial-bridge',{includeBridge:false});gpuFrame=null;}
          if(!jpOwns){clips.suspend();jpOwns=true;}
          if(v?.gpuPalaceImage&&jp.layered&&!choiceWrites(this)){
            const w=jp.where(),backend=v.gpuPalaceImage;if(gpuFrame?.backend!==backend)materializeGpu('gpu-owner-change');backend.setFlash(w?.flash,w?.flashColor);
            gpuFrame={backend,published:false};stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);return;
          }
          const palaceImage=!choiceWrites(this)?jp.palaceBoundarySnapshot?.(v):null;
          if(palaceImage&&palaceBoundary&&(fadeLeft<=0||palaceBoundary.active)){
            if(gpuFrame&&gpuFrame.backend!==palaceBoundary&&gpuFrame.backend!==jp.palace.imageBackend)materializeGpu('palace-boundary-entry');
            palaceBoundary.setFrame(palaceImage);blend(dt);gpuFrame=palaceFrame();finishFrame(t0);return;
          }
          const resultBackend=v?.gpuResultImage,rw=resultBackend?jp.where():null;
          // Preserve the existing 2D dim/fade/choice ownership at unsafe seams.
          if(resultBackend&&(fadeLeft<=0||choiceBridge||palaceBoundary?.active)&&!rw?.dim&&!jp.transition&&!choiceWrites(this)){
            if(palaceBoundary?.active){resultBackend.setFlash(rw?.flash,rw?.flashColor);palaceBoundary.setFrame({kind:'backend',backend:resultBackend});blend(dt);gpuFrame=palaceFrame();finishFrame(t0);return;}
            if(gpuFrame?.backend===palaceBoundary){palaceBoundary.abandon();gpuFrame=null;}else if(gpuFrame?.backend!==resultBackend)materializeGpu('gpu-owner-change');
            resultBackend.setFlash(rw?.flash,rw?.flashColor);if(choiceBridge)blend(dt);
            gpuFrame=resultHistory?resultHistory.resultFrame(resultBackend):{backend:resultBackend,published:false};stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);return;
          }
          if(videoBackend&&(fadeLeft<=0||choiceBridge||palaceBoundary?.active)&&!choiceWrites(this)){
            const image=jp.plainVideoSnapshot?.(v);
            if(publishVideo(image,jp.where(),dt)){finishFrame(t0);return;}
          }
          materializeGpu('jp-video-legacy');
          if(resultBackend)v=resultBackend.rawCanvas('legacy-result-owner-frame');
          if(v?.gpuPalaceImage)v=v.gpuPalaceImage.rawCanvas('legacy-owner-frame');
          gpuFrame=null;
          // A result revision certifies only the compositor's completed immutable pixels.
          // Video/timeline/light processing above still runs on every frame.
          const w=jp.where(),revision=v?.resultRevision;
          const cacheable=Number.isSafeInteger(revision)&&revision>=0&&v?.readyState>=2&&fadeLeft<=0&&!jp.layered&&!jp.transition&&!choiceWrites(this);
          const key=cacheable?[revision,w?.serial,w?.name,w?.dim,w?.flash,w?.flashColor,s.secondsLeft>=0?Math.ceil(s.secondsLeft):null,v.width,v.height,canvas.width,canvas.height]:null;
          if(cacheable&&paintedResult?.canvas===v&&key.every((x,i)=>Object.is(x,paintedResult.key[i]))){stableResult=true;stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);return;}
          if(!cacheable)paintedResult=null;
          // suspend() already paused the entire pool; no clip is advanced while JP owns it.
          if(v?.readyState>=2)hold.drawImage(v,0,0,W,H);
          if(jp.transition?.video?.readyState>=2){hold.globalAlpha=jp.transition.alpha;hold.drawImage(jp.transition.video,0,0,W,H);hold.globalAlpha=1;}
          ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(PX,PY);ctx.filter=w?.dim&&!jp.layered?'brightness(.5) saturate(.6)':'none';ctx.drawImage(held,0,0);ctx.filter='none';jp.drawDigits(ctx);
          if(w?.flash>0){ctx.globalAlpha=w.flash;ctx.fillStyle=w.flashColor==='hit'?'#fff':'#736099';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;}
          ctx.restore();blend(dt);if(cacheable){paintedResult={canvas:v,key};resultUploadRevision++;stableResult=true;}stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);return;
        }
      }
      if(resultHistory?.active)gpuFrame=null;else if(gpuFrame?.owner!=='normal')materializeGpu('normal-return');invalidateResult();jpOwns=false;
      normalN = clamp(s.lit ?? normalN, 0, 6);
      if (mode && clock >= mode.until) {bridge();mode = null;}
      // 液晶のcueが無いchain_*もonEventで確実に届く。cueはここでは映像を二重起動しない。
      if (s.phase === 'ChainChoice' && mode?.id !== 'chain_choice') temporary('chain_choice', { ...s.chain }, Infinity);
      clips.setIdle(`idle${normalN}`);
      if(resultHistory?.active&&(mode||guard&&clock<guard.until||choiceWrites(this))){resultHistory.fallback('normal-overlay-or-choice',{includeBridge:false});gpuFrame=null;}
      const historyEligible=!!resultHistory?.active;
      const videoEligible=historyEligible||!!videoBackend&&!videoFailed&&(fadeLeft<=0||choiceBridge)&&!mode&&!(guard&&clock<guard.until)&&!choiceWrites(this);
      if(!videoEligible)materializeGpu('normal-overlay-owner');
      const videoSnapshot=clips.frame(dt,videoEligible?null:hold,W,H);
      shotOn = !!clips.shot || clips.pending > 0;
      // Keep the original pulse lifetime and render equations; only its target changes.
      launchPulses = launchPulses.filter(t => clock - t < .8);
      if(videoEligible){
        videoSnapshot.overlay=ringOverlay();
        if(publishVideo(videoSnapshot,null,dt)){if(historyEligible){fadeLeft=Math.max(0,fadeLeft-dt);resultHistory.afterRender(fadeLeft/.12);}finishFrame(t0);return;}
        if(resultHistory?.active){resultHistory.fallback('normal-video-fallback',{includeBridge:false});gpuFrame=null;}materializeGpu('normal-video-fallback');drawClipSnapshot(videoSnapshot,hold,W,H);
      }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.translate(PX, PY); ctx.drawImage(held, 0, 0);
      // 固定SHOTSの偽の軌道を焼かず、実際の発射で水面の光輪を出す。
      drawLaunchRings(ctx);
      if (mode) drawTemporary(s);
      if (guard && clock < guard.until && !mode) {
        const k = 1 - (clock - guard.at) / 1.1;
        if (!cards?.guard(ctx, clock - guard.at)) { ctx.globalAlpha = Math.min(1, k * 3); text('耐えた！', W/2, 1050, 65, '#fff2a6'); ctx.globalAlpha = 1; }
      }
      ctx.restore(); blend(dt);stats.frames++; stats.maxDrawMs = Math.max(stats.maxDrawMs, performance.now() - t0);
    },
    applyLights(F) {
      if (!F) return;
      if(jp?.applyLights(F))return;
      const frames = lightFrames[shown.name];
      if (frames?.length && !mode) {
        const f = Math.floor(shown.time * 30) % frames.length;
        F.m3 = frames[f];
      } else {
        // 仮の未完成場面の光。通常場面の動画画質には触れない。
        const col = mode?.id === 'jp' ? [1,.6,.12] : tier[normalN];
        F.m3 = { K: Array.from({length:8}, (_,i) => .4 + .5 * Math.max(0, Math.sin(clock * 3 - i * .5))),
          Kc: Array.from({length:8}, () => col), wash: Array.from({length:8}, () => [0,0,0]),
          ring: Array.from({length:4}, () => [0,0,0]), zone: Array.from({length:8}, () => col.map(v => v*.2)) };
      }
    },
    palaceBoundaryDiagnostics(){return palaceBoundary?.diagnostics()??{enabled:false};},
    resultBoundaryDiagnostics(){return {...(resultHistory?.diagnostics()??{enabled:false}),pool:resultBoundaryGpu?.diagnostics?.()??null};},
    videoImageDiagnostics(){return {...videoStats,failures:[...videoStats.failures],backend:videoBackend?.diagnostics?.()??null};},
    diagnostics() { return clips.diagnostics().concat(jp?.diagnostics()??[]); },
    dispose() { try{fullPrevious?.dispose();releaseChoiceBridge();try{resultHistory?.dispose();}finally{videoBackend?.dispose?.();}}finally{try{clips.dispose();}finally{jp?.dispose();}} },
  };surfaceOwner=api;return api;
}
