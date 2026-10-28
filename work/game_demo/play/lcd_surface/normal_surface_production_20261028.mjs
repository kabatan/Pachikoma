import {createClipPlayer} from './clip_player.mjs';
import {createJpSurface,jpEffectSeconds} from './jp_surface_production_20261028.mjs';
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

export async function createProductionLcd({ manifestUrl, man, getState, jpManifestUrl, onJpCue }) {
  const base = new URL('.', manifestUrl);
  const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1510;
  const ctx = canvas.getContext('2d', { alpha: false });
  const transition = document.createElement('canvas'); transition.width=canvas.width;transition.height=canvas.height;
  const previous = transition.getContext('2d',{alpha:false});let fadeLeft=0,lastJpSerial=-1;
  const bridge=()=>{previous.drawImage(canvas,0,0);fadeLeft=.12;};
  const blend=dt=>{if(fadeLeft<=0)return;fadeLeft=Math.max(0,fadeLeft-dt);ctx.globalAlpha=fadeLeft/.12;ctx.drawImage(transition,0,0);ctx.globalAlpha=1;};
  const held = document.createElement('canvas'); held.width = W; held.height = H;
  const hold = held.getContext('2d', { alpha: false });
  hold.fillStyle = '#052a57'; hold.fillRect(0, 0, W, H);
  const stats = { lifecycle: [], frames: 0, played: [], errors: [], switches: 0, maxDrawMs: 0, placeholders: [] };
  const fail = (message) => { stats.errors.push(message); console.error('[normal1026]', message); };
  const clips = createClipPlayer({base, files:man.files, onError:fail, record:e=>{stats.lifecycle.push(e);if(stats.lifecycle.length>2000)stats.lifecycle.shift();}});
  const shown = {get name(){return clips.name;},get time(){return clips.time;}};
  const jp = jpManifestUrl ? await createJpSurface({manifestUrl:jpManifestUrl,onCue:onJpCue,getState,log:n=>stats.played.push([+clock.toFixed(3),n])}).catch(e=>{stats.errors.push('JP: '+e.message);console.warn('[jp1029]',e.message);return null;}) : null;
  if(jp){const r=getState().rules;r.FirstJackpotEffectSeconds=Object.fromEntries(jp.man.digits.map(d=>[d,r.JackpotAwards.map(p=>jpEffectSeconds(jp.man,p))]));}
  const lightFrames = man.lights ? await (await fetch(new URL(man.lights, base))).json() : {};
  const font = new FontFace('Dela1026', `url(${new URL('../../../effects/lcd/fonts/DelaGothicOne-Regular.ttf', import.meta.url).href})`);
  await font.load(); document.fonts.add(font);
  let clock = 0, manual = false, shotOn = false, jpOwns = false, lastEvent = null;
  let mode = { id: 'attract', p: {}, at: 0, until: Infinity }, guard = null;
  let variants = {}, normalN = 0, launchPulses = [];
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
      case 'finish_count': card('計数中', [`JPの合計 ${p.score ?? s.score ?? 0}玉`], '#b8e8ff', `${p.total ?? p.balls ?? s.balls}玉`); break;
      case 'result': card(s.prize || ['参加賞','C賞','B賞','A賞','S賞'][p.rankIndex ?? p.rank ?? 0], ['ありがとうございました！'], '#ffe198', `JP合計 ${p.score ?? s.score ?? 0}玉`); break;
      case 'reset_fallback': card('重複！', ['ランプが消えた… もう一度！'], '#ffb0ba'); break;
    }
  }
  function onEvent(id, p = {}) {
    lastEvent = { id, p, at: clock };
    const wasClaimed=jp?.claimed, handled=jp?.onEvent(id,p);
    if(wasClaimed&&!jp?.claimed)bridge();
    if (handled) return;
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
      if (clip) play(clip); else temporary('reset_fallback', p, 1.3);
      return;
    }
    if (id === 'ascend') return; // reset動画内の昇天を二重起動しない。
    if (id === 'launch') { launchPulses.push(clock); launchPulses = launchPulses.slice(-3); return; }
    if (id === 'start') { if(mode)bridge();mode = null; shotOn = false; return; }
    if (['attract','title','howto','ticket','timeup','finish_count','result','add100','challenge_wait','challenge_declare','challenge_flight','jp','chain_choice','chain_continue','chain_stop','fail'].includes(id)) {
      if (id === 'attract' || id === 'ticket') { variants = {}; normalN = 0; guard = null; }
      const ttl = id === 'jp' ? Math.max(.5, p.duration ?? 6.3) : id === 'fail' ? Math.max(1.35, p.duration ?? 0) : id === 'chain_stop' ? 1.8 : id === 'add100' ? 1.5 : Infinity;
      temporary(id, p, ttl);
    }
    if (id === 'challenge_cancel') {bridge();mode = null;}
  }
  return {
    canvas, stats, production: true, jp,
    get current() { return { mode: jp?.active ? 'jp1029' : mode?.id ?? null, clip: jp?.active ? jp.where()?.name : shown.name, shot: shotOn, time: shown.time, normalN, lastEvent }; },
    onEvent,
    setManual(on) { manual = !!on; clips.setManual(on); jp?.setManual(on); },
    async prepare(dt) { if(jp?.active){await jp.prepare(dt);return;} await clips.prepare(dt); },
    frame(dt, F) {
      const t0 = performance.now(); clock += dt;
      const s = getState();
      if (jp?.claimed) {
        const v=jp.frame(dt);
        if(!jp.active&&lastJpSerial>=0){bridge();lastJpSerial=-1;}
        if (jp.active) {
          if(jp.where()?.serial!==lastJpSerial){if(!jp.layered)bridge();lastJpSerial=jp.where()?.serial;}if(jp.layered)fadeLeft=0;
          if(!jpOwns){clips.suspend();jpOwns=true;}
          clips.pause();
          if(v?.readyState>=2)hold.drawImage(v,0,0,W,H);
          if(jp.transition?.video?.readyState>=2){hold.globalAlpha=jp.transition.alpha;hold.drawImage(jp.transition.video,0,0,W,H);hold.globalAlpha=1;}
          ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(PX,PY);const w=jp.where();ctx.filter=w?.dim&&!jp.layered?'brightness(.5) saturate(.6)':'none';ctx.drawImage(held,0,0);ctx.filter='none';jp.drawDigits(ctx);
          if(w?.flash>0){ctx.globalAlpha=w.flash;ctx.fillStyle=w.flashColor==='hit'?'#fff':'#736099';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;}
          if(s.secondsLeft>=0){text(Math.ceil(s.secondsLeft),1096,1149,67,'#fff5cf','right',210);text('残り',1096,1071,29,'#fff4df','right',200);}
          ctx.restore();blend(dt);stats.frames++;stats.maxDrawMs=Math.max(stats.maxDrawMs,performance.now()-t0);return;
        }
      }
      jpOwns=false;
      normalN = clamp(s.lit ?? normalN, 0, 6);
      if (mode && clock >= mode.until) {bridge();mode = null;}
      // 液晶のcueが無いchain_*もonEventで確実に届く。cueはここでは映像を二重起動しない。
      if (s.phase === 'ChainChoice' && mode?.id !== 'chain_choice') temporary('chain_choice', { ...s.chain }, Infinity);
      clips.setIdle(`idle${normalN}`);
      clips.frame(dt, hold, W, H);
      shotOn = !!clips.shot || clips.pending > 0;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.translate(PX, PY); ctx.drawImage(held, 0, 0);
      // 固定SHOTSの偽の軌道を焼かず、実際の発射で水面の光輪を出す。
      launchPulses = launchPulses.filter(t => clock - t < .8);
      for (const at of launchPulses) {
        const a = (clock - at) / .8;
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .32 * (1-a)**1.4;
        ctx.strokeStyle = '#adf6ff'; ctx.lineWidth = 9*(1-a)+2;
        ctx.beginPath(); ctx.ellipse(W/2, 300, 30+410*(1-(1-a)**3), 18+240*(1-(1-a)**3), 0, 0, 2*Math.PI); ctx.stroke(); ctx.restore();
      }
      if (mode) drawTemporary(s);
      if (guard && clock < guard.until && !mode) {
        const k = 1 - (clock - guard.at) / 1.1;
        ctx.globalAlpha = Math.min(1, k * 3); text('耐えた！', W/2, 1050, 65, '#fff2a6'); ctx.globalAlpha = 1;
      }
      if (!['Attract','Result'].includes(s.phase) && mode?.id !== 'howto' && s.secondsLeft >= 0) {
        text(Math.ceil(s.secondsLeft), 1096, 1149, 67, s.secondsLeft <= 10 ? '#ff8f9f' : '#fff5cf', 'right', 210);
        text('残り', 1096, 1071, 29, '#fff4df', 'right', 200);
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
    diagnostics() { return clips.diagnostics().concat(jp?.diagnostics()??[]); },
    dispose() { clips.dispose(); jp?.dispose(); },
  };
}
