// ゲーム側の受け口。?remote=<司令塔のIP>:<ポート> が付いたときだけ働く（無ければ何もしない＝今までどおり）。
//   ?station=1 … 台番号（1号機〜）。 ?remote_overlay=0 … 一時停止中の「一時停止中」表示を出さない。
// play.mjs からは `import '../remote/remote_client.mjs';` の1行だけで使える（window.__play が出来るのを待つので、読み込み順は問わない）。
// 使うもの: window.__play.pause(bool) / .cabinet.input('staffActivate') / .app.ctrl / window.__lcdSurface.setManual / window.__r2Audio.engine.ctx
// 司令塔が落ちても、ゲームは今までどおり動き続け、裏で自動的につなぎ直す。
const q = new URLSearchParams(location.search);
const remoteParam = q.get('remote');

function parseRemote(text) {
  let t = String(text ?? '').trim().replace(/^(wss?|https?):\/\//, '').replace(/\/.*$/, '');
  if (!t) return null;
  if (!/:\d+$/.test(t)) t += ':8900';
  return t;
}

export function startRemoteClient() {
  const host = parseRemote(remoteParam);
  if (!host) return null;
  let station = q.get('station');
  if (!station) { try { station = sessionStorage.getItem('pachikoma.remote.id'); } catch { /* */ } }
  if (!station) { station = 'u' + Math.random().toString(16).slice(2, 6); try { sessionStorage.setItem('pachikoma.remote.id', station); } catch { /* */ } }
  station = String(station).replace(/[^\w.-]/g, '').slice(0, 16);
  const url = `ws://${host}/game?station=${encodeURIComponent(station)}`;
  const bornAt = performance.now();
  let ws = null, retry = 0, stopped = false, paused = false, bypass = false, wrapped = null, lastSent = '', lastSentAt = 0;
  let frames = 0, fps = 0, fpsAt = performance.now();
  let overlay = null;

  const play = () => window.__play ?? null;
  const ctrlOf = () => play()?.app?.ctrl ?? null;

  // fps（描画が止まっていないかの目安。一時停止中は0）
  const tickFps = () => {
    frames++; const now = performance.now();
    if (now - fpsAt >= 1000) { fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; }
    requestAnimationFrame(tickFps);
  };
  requestAnimationFrame(tickFps);

  // 一時停止中は、筐体のボタン/キーの入力も受け付けない（物理が止まったまま玉を撃たせない）。スタッフ操作(bypass)だけ通す。
  function wrapDispatch() {
    const ctrl = ctrlOf(); if (!ctrl || wrapped === ctrl) return;
    const orig = ctrl.dispatch.bind(ctrl);
    ctrl.dispatch = (action) => (paused && !bypass ? false : orig(action));
    wrapped = ctrl;
  }

  function setOverlay(on) {
    if (q.get('remote_overlay') === '0') return;
    if (!on) { overlay?.remove(); overlay = null; return; }
    if (overlay) return;
    const parent = document.getElementById('stage') ?? document.body;
    overlay = document.createElement('div');
    overlay.textContent = 'ただいま一時停止中';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,.45);color:#fff;font:700 clamp(20px,5vw,64px) system-ui,sans-serif;letter-spacing:.15em;text-shadow:0 2px 12px #000';
    parent.appendChild(overlay);
  }

  function applyPause(on) {
    const p = play(); if (!p) return false;
    wrapDispatch();
    paused = !!on;
    try { p.pause(paused); } catch (e) { console.error('[remote] pause', e); }
    try { window.__lcdSurface?.setManual?.(paused); } catch (e) { console.error('[remote] lcd', e); }   // 液晶の映像も止める／戻す
    try {
      const ctx = window.__r2Audio?.engine?.ctx;
      if (ctx) (paused ? ctx.suspend() : ctx.resume())?.catch?.(() => {});
    } catch (e) { console.error('[remote] audio', e); }
    setOverlay(paused);
    return true;
  }

  function readState() {
    const p = play(), ctrl = ctrlOf(), s = {
      loading: !p, error: window.__startupError ?? null, paused, fps: paused ? 0 : fps,
      hidden: document.hidden, uptime: Math.round((performance.now() - bornAt) / 1000),
    };
    if (!ctrl) return s;
    const g = ctrl.game, r = g.rules ?? {};
    s.phase = g.phase; s.howto = !!ctrl.howto;
    s.secondsLeft = Number.isFinite(g.secondsLeft) ? Math.ceil(g.secondsLeft) : null;
    s.wallet = g.wallet ?? null; s.earnings = g.jackpotEarnings ?? null;
    s.extraUsed = g.extraCreditsUsed ?? 0; s.extraMax = Number.isFinite(r.MaxExtraCredits) && r.MaxExtraCredits < 1e6 ? r.MaxExtraCredits : null;
    if (g.phase === 'StaffWait') s.staffWait = Math.floor(g.staffWaitSeconds ?? 0);
    if (g.phase === 'StaffWait') { s.extraSeconds = r.ExtraSeconds ?? null; s.extraBalls = r.ExtraLoanBalls ?? null; s.addPending = !!g._autoChain; }   // 追加で再開するときに増える秒・玉（管理画面の確認文用）
    if (g.phase === 'Continue') s.offerLeft = Math.ceil(g.offerLeft ?? 0);
    if (g.phase === 'ChainChoice') s.choiceLeft = Math.ceil(g.choiceLeft ?? 0);
    s.serial = !!p.cabinet?.ready;
    return s;
  }

  function runCommand(cmd) {
    if (cmd === 'reset') {
      setTimeout(() => { stopped = true; try { ws?.close(); } catch { /* */ } location.reload(); }, 200);   // 返事が届いてから再読み込み
      return { ok: true, msg: '最初からやり直します' };
    }
    const p = play(), ctrl = ctrlOf();
    if (!p || !ctrl) return { ok: false, msg: '起動中です' };
    if (cmd === 'pause') { if (paused) return { ok: true, msg: 'すでに停止中' }; applyPause(true); return { ok: true, msg: '停止しました' }; }
    if (cmd === 'resume') { if (!paused) return { ok: true, msg: 'すでに動いています' }; applyPause(false); return { ok: true, msg: '再開しました' }; }
    if (cmd === 'staff') {
      if (ctrl.game.phase !== 'StaffWait') return { ok: false, msg: 'スタッフ待ちではありません' };
      wrapDispatch();
      bypass = true;
      let ok = false;
      try { ok = p.cabinet?.input ? p.cabinet.input('staffActivate') : ctrl.dispatch('staffActivate'); } finally { bypass = false; }   // 筐体の両ボタン長押し(1.5秒)と同じ入り口
      return ok ? { ok: true, msg: 'チケット追加OKを送りました' } : { ok: false, msg: '受け付けられませんでした。もう一度押してください' };
    }
    if (cmd === 'staffcancel') {   // 取消（客が追加をやめる・押し間違いの受領ではない）: 追加しないで終了へ。左ボタン単独と同じ入口
      if (ctrl.game.phase !== 'StaffWait') return { ok: false, msg: 'スタッフ待ちではありません' };
      wrapDispatch();
      bypass = true;
      let ok = false;
      try { ok = ctrl.dispatch('cancelExtra'); } finally { bypass = false; }
      return ok ? { ok: true, msg: '追加を取り消して終了にしました' } : { ok: false, msg: '受け付けられませんでした。もう一度押してください' };
    }
    return { ok: false, msg: '未対応の操作' };
  }

  function send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); return true; } catch { /* */ } } return false; }

  function pushState(force) {
    const state = readState(), now = performance.now();
    const key = JSON.stringify({ ...state, uptime: 0, fps: 0 });   // 変化があったときは即送る。変化がなくても1秒ごとに送る（生存確認を兼ねる）
    if (!force && key === lastSent && now - lastSentAt < 1000) return;
    if (send({ type: 'state', state })) { lastSent = key; lastSentAt = now; }
  }

  function connect() {
    if (stopped) return;
    let opened = false;
    try { ws = new WebSocket(url); } catch { scheduleRetry(); return; }
    const mine = ws, giveUp = setTimeout(() => { if (!opened) try { mine.close(); } catch { /* */ } }, 5000);   // つながらないままぶら下がらせない
    mine.onopen = () => { opened = true; retry = 0; clearTimeout(giveUp); lastSent = ''; pushState(true); };
    mine.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'replaced') { stopped = true; console.warn('[remote] 同じ台番号の別のページに置き換えられました'); return; }
      if (m.type === 'cmd') {
        let r; try { r = runCommand(m.cmd); } catch (e) { r = { ok: false, msg: String(e.message ?? e).slice(0, 60) }; }
        send({ type: 'ack', id: m.id, ok: r.ok, msg: r.msg });
        setTimeout(() => pushState(true), 50);
      }
    };
    mine.onclose = () => { clearTimeout(giveUp); if (ws === mine) ws = null; scheduleRetry(); };
    mine.onerror = () => { /* oncloseで再試行 */ };
  }
  function scheduleRetry() { if (stopped) return; retry = Math.min(retry + 1, 5); setTimeout(connect, 1000 * retry); }

  connect();
  setInterval(() => { try { pushState(false); } catch (e) { console.error('[remote] state', e); } }, 500);
  window.__remote = { station, url, get paused() { return paused; }, get connected() { return ws?.readyState === 1; }, readState, applyPause };
  return window.__remote;
}

startRemoteClient();
