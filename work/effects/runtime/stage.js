/* ステージ: 3D筐体の複製ページ(window.CAB)に、光バスとLCDを流し込む確認用UI。 */
(function () {
  'use strict';
  const fx = new Effects({ events: EVENTS, geom: GEOM }); const dir = fx.dir;   // ゲームと同じ窓口(Effects)を通す
  const ST = { n: 0, rank: 2, payout: 150, k: 1, showLcd: true, firstTime: true, last: 0 };
  const ORDER = ['p1', 'p2', 'p4'];
  window.STAGE = { fx, dir, ST, advance, start, setN, ready: false };
  function setN(n) {
    ST.n = n; dir.dispN = null;
    dir.setState({ n, lastN: n, litPockets: Array.from({ length: n }, (_, i) => i + 1), tut: ST.firstTime ? { firstShot: n > 0, firstDeclare: false } : { firstShot: true, firstDeclare: true } });
  }
  function start(id, extra) {
    const params = Object.assign({ payout: ST.payout, k: ST.k, n_from: ST.n, pocket: 5, rank: ST.rank, once: true }, extra || {});
    dir.setState({ rank: ST.rank, hitPocket: 5 });
    fx.tutorial = ST.firstTime; fx.first = { firstShot: !ST.firstTime || ST.n > 0 };
    return fx.notify(id, params);
  }
  let LCD_OK = false;
  function advance(dt) {
    const F = fx.frame(dt); ST.last = F;
    CAB.setFrame(F);
    if (LCD_OK && F.lcd) CAB.lcdCtx.drawImage(F.lcd, 0, 0, F.lcd.width, F.lcd.height, 0, 0, CAB.lcd.width, CAB.lcd.height);
    else placeholder(CAB.lcdCtx, CAB.lcd.width, CAB.lcd.height, F);
    CAB.uploadLcd(); CAB.drawNow();
    info(F);
  }
  function placeholder(c, w, h, F) {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#13204a'); g.addColorStop(1, '#2a0f3a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = `${Math.round(h * .09)}px sans-serif`; c.textAlign = 'center';
    c.fillText('LCD', w / 2, h * .3); c.font = `${Math.round(h * .06)}px sans-serif`;
    c.fillText(F.active.join(' + ') || '(通常)', w / 2, h * .55); c.fillText('灯 ' + F.n, w / 2, h * .75);
    // 向きの確認用: 左上に三角
    c.fillStyle = '#ffd24a'; c.beginPath(); c.moveTo(8, 8); c.lineTo(8 + h * .12, 8); c.lineTo(8, 8 + h * .12); c.fill();
  }
  const infoEl = () => document.getElementById('stageInfo');
  function info(F) { const e = infoEl(); if (!e) return; e.textContent = `t=${F.t.toFixed(2)}  灯=${F.n}  実行中: ${F.active.join(', ') || '-'}\nボタン L[${[0, 1, 2].map((i) => F.btn[i].toFixed(2))}] R[${[3, 4, 5].map((i) => F.btn[i].toFixed(2))}]`; }
  function buildUI() {
    const P = document.getElementById('stagePanel'); P.innerHTML = '';
    const h = (t) => { const e = document.createElement('h2'); e.textContent = t; P.append(e); };
    const row = () => { const r = document.createElement('div'); r.className = 'row'; P.append(r); return r; };
    const btn = (r, label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = () => fn(b); r.append(b); return b; };
    h('灯の数(定常状態)');
    let r = row(); const nb = [];
    for (let n = 0; n <= 6; n++) nb.push(btn(r, String(n), () => { setN(n); nb.forEach((x, i) => x.classList.toggle('on', i === n)); }, n === 0 ? 'on' : ''));
    setN(0);
    h('条件');
    r = row();
    btn(r, '初見モード', (b) => { ST.firstTime = !ST.firstTime; b.classList.toggle('on', ST.firstTime); setN(ST.n); }, 'on');
    btn(r, '液晶を表示', (b) => { ST.showLcd = !ST.showLcd; b.classList.toggle('on', ST.showLcd); CAB.state.lcdOn = ST.showLcd; }, 'on');
    r = row(); r.append(document.createTextNode('景品ランク '));
    ['参加賞', 'C', 'B', 'A', 'S', 'SS'].forEach((t, i) => btn(r, t, (b) => { ST.rank = i; [...r.querySelectorAll('button')].forEach((x, j) => x.classList.toggle('on', j === i)); }, i === 2 ? 'on' : ''));
    r = row(); r.append(document.createTextNode('JP配当 '));
    [40, 80, 150, 300, 600].forEach((v) => btn(r, String(v), (b) => { ST.payout = v; [...r.querySelectorAll('button')].forEach((x) => x.classList.toggle('on', x.textContent === String(v))); }, v === 150 ? 'on' : ''));
    r = row(); r.append(document.createTextNode('昇天・消える灯 '));
    [1, 2, 3, 4].forEach((v) => btn(r, String(v), () => { ST.k = v; [...r.querySelectorAll('button')].forEach((x) => x.classList.toggle('on', x.textContent === String(v))); }, v === 1 ? 'on' : ''));
    const phases = EVENTS.phases;
    for (const ph of phases) {
      h(ph); r = row();
      for (const e of EVENTS.events.filter((x) => x.phase === ph)) btn(r, e.name.replace(/\(.*$/, ''), () => start(e.id));
    }
    h('停止');
    r = row(); btn(r, '全部止める', () => { dir.inst.length = 0; dir.dispN = null; }); btn(r, 'ステージを止める/動かす', () => { CAB.manual = !CAB.manual; });
    const i = document.createElement('div'); i.id = 'stageInfo'; P.append(i);
  }
  async function initLcd() {
    if (!window.LCD) return;
    try {
      await new Promise((r) => (window.LCD_BASE ? r() : addEventListener('lcd-base-ready', r)));
      LCD_OK = await fx.initLcd({ root: '/' });
    } catch (e) { console.warn('LCD init failed', e); }
  }
  async function boot() {
    await initLcd();
    CAB.useLcd(true); CAB.state.lcdOn = true; CAB.state.playing = true;
    CAB.onTick = (dt) => advance(dt);
    buildUI(); STAGE.ready = true;
  }
  if (window.CAB && window.CAB.ready) boot(); else window.addEventListener('cab-ready', boot);
})();
