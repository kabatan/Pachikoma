// DOM オーバーレイ（HUD・各画面）。1080×1920 の設計座標で組み、親要素に合わせて拡縮する。
// 筐体の3D描画(web/)の上に重ねる前提: HUD は半透明で、盤の中央窓は空ける。
// 見た目の部品は CSS 変数(--mint/--gold/--coral...)と各 section の class で差し替え可能。
// render(view) は presenter.view() だけを入力とし、同じ view なら DOM を触らない。
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = (fontBase) => `
@font-face{font-family:"DelaGothic";src:url("${fontBase}DelaGothicOne-Regular.ttf")}
@font-face{font-family:"MPlus";src:url("${fontBase}MPLUS1p-ExtraBold.ttf");font-weight:800}
.medal-ui{--navy:#0f0e29;--slate:#1d1c47;--edge:#2c2961;--mint:#62e0c8;--mint-d:#2a9886;--gold:#ffc93c;--gold-d:#a97a0e;--coral:#ef4558;--paper:#f4f1ea;--grey:#7c7398;
 position:absolute;left:0;top:0;width:1080px;height:1920px;transform-origin:0 0;font-family:"MPlus","Noto Sans CJK JP",sans-serif;font-weight:800;color:var(--paper);overflow:hidden;user-select:none;pointer-events:none}
.medal-ui *{box-sizing:border-box}
.medal-ui .big{font-family:"DelaGothic","MPlus",sans-serif;font-weight:400}
.medal-ui [data-action]{pointer-events:auto;cursor:pointer}
.medal-ui .hud{position:absolute;left:0;top:0;width:100%}
.medal-ui .timebar{position:absolute;left:230px;top:44px;width:620px;height:46px;background:rgba(15,14,41,.8);border:4px solid var(--edge);display:flex;gap:6px;padding:6px;transform:skewX(-8deg)}
.medal-ui .timebar i{flex:1;background:var(--mint)}.medal-ui .timebar i.off{background:#252050}.medal-ui .timebar.low i:not(.off){background:var(--coral)}
.medal-ui .secs{position:absolute;right:36px;top:14px;font-size:104px;line-height:1;text-align:right}
.medal-ui .secs small{font-size:32px;margin-left:8px;color:var(--mint)}
.medal-ui .plan{position:absolute;right:40px;top:126px;font-size:30px;color:var(--mint);text-align:right}
.medal-ui .brand{position:absolute;left:34px;top:30px;font-size:46px;color:var(--gold);letter-spacing:2px}
.medal-ui .stake{position:absolute;left:30px;top:180px;width:740px;height:270px;background:rgba(98,224,200,.94);color:#0f0e29;padding:20px 30px;clip-path:polygon(0 0,100% 0,100% 82%,94% 100%,0 100%)}
.medal-ui .stake.challenge{background:rgba(255,201,60,.95)}.medal-ui .stake.final{background:rgba(239,69,88,.95);color:#fff}
.medal-ui .stake .lead{font-size:40px}.medal-ui .stake .amt{font-size:140px;line-height:1.05}.medal-ui .stake .amt small{font-size:48px}
.medal-ui .dots{position:absolute;right:34px;top:34px;display:grid;grid-template-columns:repeat(3,70px);gap:16px 20px}
.medal-ui .dots b{width:70px;height:70px;border-radius:50%;background:#0f0e29}.medal-ui .dots b.off{background:rgba(15,14,41,.18);border:6px solid rgba(15,14,41,.35)}
.medal-ui .chips{position:absolute;left:30px;bottom:12px;display:flex;gap:10px}
.medal-ui .chips span{width:104px;height:52px;line-height:52px;text-align:center;font-size:34px;background:rgba(15,14,41,.35);color:rgba(15,14,41,.7)}
.medal-ui .chips span.on{background:#0f0e29;color:var(--gold)}
.medal-ui .lanes{position:absolute;left:30px;right:30px;bottom:240px;display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.medal-ui .lane{height:84px;background:rgba(15,14,41,.82);border:4px solid var(--edge);text-align:center;font-size:48px;line-height:76px;color:var(--grey)}
.medal-ui .lane.lit{background:var(--mint);color:#0f0e29;border-color:var(--mint-d)}.medal-ui .lane.target{box-shadow:0 0 0 6px var(--gold) inset}
.medal-ui .wallet{position:absolute;left:30px;bottom:96px;width:520px;height:132px;background:rgba(15,14,41,.88);border:4px solid var(--edge);padding:8px 20px}
.medal-ui .wallet .n{font-size:84px;color:var(--gold);line-height:1;display:inline-block;min-width:150px}.medal-ui .wallet .l{font-size:26px;color:var(--grey);margin-left:10px}
.medal-ui .wallet .next{font-size:28px;color:var(--mint)}
.medal-ui .keys{position:absolute;left:0;bottom:0;width:100%;display:grid;grid-template-columns:1.5fr 1.2fr 1fr 1fr;gap:10px;padding:0 30px 16px}
.medal-ui .key{height:78px;line-height:78px;text-align:center;font-size:34px;background:var(--mint);color:#0f0e29;clip-path:polygon(4% 0,100% 0,96% 100%,0 100%)}
.medal-ui .key.dim{background:#3a3559;color:#7c7398}.medal-ui .key.gold{background:var(--gold)}.medal-ui .key.coral{background:var(--coral);color:#fff}
.medal-ui .key small{font-size:24px;margin-right:8px;opacity:.7}
.medal-ui .banner{position:absolute;left:0;right:0;top:760px;text-align:center}
.medal-ui .banner .t{display:inline-block;padding:14px 60px;font-size:104px;background:rgba(15,14,41,.9);border:6px solid var(--mint);color:var(--mint);transform:skewX(-6deg)}
.medal-ui .banner .s{margin-top:14px;font-size:38px;color:var(--paper);text-shadow:0 2px 6px #000}
.medal-ui .banner.win .t{border-color:var(--gold);color:var(--gold)}.medal-ui .banner.win.tier2 .t,.medal-ui .banner.win.tier3 .t{font-size:140px;background:rgba(169,122,14,.92);color:#fff}
.medal-ui .banner.miss .t,.medal-ui .banner.reset .t,.medal-ui .banner.fault .t{border-color:var(--coral);color:var(--coral)}
.medal-ui .banner.keep .t{border-color:var(--paper);color:var(--paper)}
.medal-ui .cutin{position:absolute;left:0;right:0;top:620px;height:230px;background:rgba(239,69,88,.94);text-align:center;transform:skewY(-3deg)}
.medal-ui .cutin .t{font-size:110px;line-height:150px}.medal-ui .cutin .s{font-size:44px;margin-top:-10px}
.medal-ui .roul{position:absolute;left:120px;right:120px;top:640px;background:rgba(15,14,41,.94);border:6px solid var(--coral);padding:24px 30px}
.medal-ui .roul h3{margin:0 0 14px;font-size:44px;color:var(--coral);text-align:center}
.medal-ui .roul .cells{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.medal-ui .roul .cell{height:140px;background:#252050;text-align:center;padding-top:22px;font-size:36px;color:var(--grey)}
.medal-ui .roul .cell b{display:block;font-size:30px;color:#6a6390;font-weight:800}
.medal-ui .roul .cell.cur{background:var(--coral);color:#fff}.medal-ui .roul .cell.cur b{color:#fff}.medal-ui .roul .res{margin-top:16px;text-align:center;font-size:40px;color:var(--paper)}
.medal-ui .jp{position:absolute;left:60px;right:60px;top:560px;background:rgba(15,14,41,.96);border:8px solid var(--gold);padding:26px 30px}
.medal-ui .jp h3{margin:0 0 16px;font-size:64px;color:var(--gold);text-align:center}
.medal-ui .jp .reel{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.medal-ui .jp .c{height:170px;background:#252050;text-align:center;font-size:62px;line-height:170px;color:var(--grey)}
.medal-ui .jp .c.cur{background:var(--gold);color:#0f0e29}.medal-ui .jp .c.won{background:var(--coral);color:#fff}
.medal-ui .screen{position:absolute;inset:0;background:rgba(10,9,32,.9);text-align:center;pointer-events:auto}
.medal-ui .screen h1{font-size:150px;margin:260px 0 10px;color:var(--gold);letter-spacing:6px}
.medal-ui .screen .sub{font-size:48px;color:var(--mint)}
.medal-ui .screen .cta{display:inline-block;margin-top:70px;padding:26px 80px;font-size:68px;background:var(--mint);color:#0f0e29;clip-path:polygon(3% 0,100% 0,97% 100%,0 100%);animation:pulse 1.2s infinite alternate}
@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.05)}}
.medal-ui .tiers{margin:70px auto 0;width:720px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:34px}
.medal-ui .tiers div{background:var(--slate);padding:10px}.medal-ui .tiers small{display:block;font-size:24px;color:var(--grey)}
.medal-ui .rec{margin-top:40px;font-size:36px;color:var(--paper)}.medal-ui .rec b{color:var(--gold)}
.medal-ui .rules{margin-top:36px;font-size:30px;color:var(--grey);line-height:1.5}
.medal-ui .box{margin:240px auto 0;width:820px;padding:50px;background:var(--slate);border:8px solid var(--edge)}
.medal-ui .box h2{margin:0 0 20px;font-size:76px;color:var(--gold)}.medal-ui .box p{font-size:44px;margin:14px 0}
.medal-ui .box .btns{display:flex;gap:20px;justify-content:center;margin-top:40px}.medal-ui .box .btns .key{width:340px;font-size:44px}
.medal-ui .res-prize{font-size:210px;color:var(--gold);margin-top:140px;line-height:1.1}
.medal-ui .res-balls{font-size:120px}.medal-ui .res-balls small{font-size:50px;color:var(--mint)}
.medal-ui .res-stats{margin-top:30px;font-size:40px;color:var(--paper);line-height:1.6}
`;

export class MedalOverlay {
  /** @param {HTMLElement} parent 位置決めされた親(position:relative 等)。fontBase は assets/fonts/ への相対URL。 */
  constructor(parent, { fontBase = '../assets/fonts/', designW = 1080, designH = 1920 } = {}) {
    this.parent = parent; this.dw = designW; this.dh = designH; this.cache = new Map();
    const style = document.createElement('style'); style.textContent = CSS(fontBase); document.head.appendChild(style);
    this.root = document.createElement('div'); this.root.className = 'medal-ui'; parent.appendChild(this.root);
    for (const k of ['hud', 'fx', 'screen']) { const d = document.createElement('div'); d.dataset.sec = k; d.style.cssText = 'position:absolute;inset:0;pointer-events:none'; this.root.appendChild(d); this[k] = d; }
    this.fit(); this._ro = new ResizeObserver(() => this.fit()); this._ro.observe(parent);
  }
  fit() { const s = Math.min(this.parent.clientWidth / this.dw, this.parent.clientHeight / this.dh); this.root.style.transform = `scale(${s})`; this.scale = s; }
  _set(key, el, html) { if (this.cache.get(key) !== html) { this.cache.set(key, html); el.innerHTML = html; } }

  render(v) {
    const playing = !['Attract', 'Result'].includes(v.phase);
    this._set('hud', this.hud, playing ? this._hud(v) : '');
    this._set('fx', this.fx, playing ? this._fx(v) : '');
    this._set('screen', this.screen, this._screen(v));
  }
  _hud(v) {
    const cells = 25, on = Math.round((v.secondsLeft / v.secondsTotal) * cells);
    const bar = Array.from({ length: cells }, (_, i) => `<i class="${i < on ? '' : 'off'}"></i>`).join('');
    const live = v.challengeLive, cls = v.mode === 'final' ? 'final' : live ? 'challenge' : '';
    const dots = Array.from({ length: 6 }, (_, i) => `<b class="${i < v.lampCount ? '' : 'off'}"></b>`).join('');
    const chips = ['1', '2', '3', '12', '30', 'JP'].map((t, i) => `<span class="${i === v.chipIndex ? 'on' : ''}">${t}</span>`).join('');
    const lead = live ? `CHALLENGE中 当たりで` : v.lampCount === 0 ? '違う穴に入れて点灯!' : '次の一球が当たれば';
    const lanes = [1, 2, 3, 4, 5, 6, 7].map((n) => `<div class="lane ${v.lamps.includes(n) ? 'lit' : ''} ${live && !v.lamps.includes(n) ? 'target' : ''}">${n}</div>`).join('');
    const need = v.prize.next ? `${esc(v.prize.next.name)}まで あと${v.prize.next.need}玉` : `${esc(v.prize.name)}到達`;
    const fire = v.canFire, chal = v.canChallenge;
    const bkey = v.phase === 'Continue' ? 'finish' : (v.confirmFinish ? 'confirmFinish' : 'finish');
    return `<div class="hud"><div class="brand big">パチコマ</div><div class="timebar ${v.secondsLeft < 15 ? 'low' : ''}">${bar}</div>
 <div class="secs big">${Math.ceil(v.secondsLeft)}<small>秒</small></div><div class="plan">${v.addedCredit ? '200円プレイ' : '100円プレイ'}</div></div>
 <div class="stake ${cls}"><div class="lead">${lead}</div><div class="amt big">${v.stake === 0 && !live ? '—' : v.stakeLabel + (v.mode === 'final' ? '' : '<small>玉</small>')}</div>
 <div class="dots">${dots}</div><div class="chips">${chips}</div></div>
 <div class="lanes">${lanes}</div>
 <div class="wallet"><span class="n big">${v.wallet}</span><span class="l">持ち玉</span><div class="next">${need}</div></div>
 <div class="keys">
  <div class="key ${fire ? '' : 'dim'}" data-action="fire"><small>SPACE</small>発射</div>
  <div class="key ${v.armed ? 'coral' : chal ? 'gold' : 'dim'}" data-action="challenge"><small>C</small>${v.armed ? 'CHALLENGE中' : 'CHALLENGE'}</div>
  <div class="key ${v.canAdd ? '' : 'dim'}" data-action="add"><small>A</small>100円追加</div>
  <div class="key ${v.phase === 'Ready' || v.phase === 'Continue' ? 'coral' : 'dim'}" data-action="${bkey}"><small>B</small>計数</div></div>`;
  }
  _fx(v) {
    let h = '';
    if (v.banner) { const b = v.banner; h += `<div class="banner ${b.kind} tier${b.tier}"><div class="t big">${esc(b.title)}</div><div class="s">${esc(b.sub)}</div></div>`; }
    if (v.cutin) h += `<div class="cutin"><div class="t big">${esc(v.cutin.title)}</div><div class="s">${esc(v.cutin.sub)}</div></div>`;
    if (v.roulette) {
      const r = v.roulette, cur = r.k % 4, done = r.t >= r.dur;
      h += `<div class="roul"><h3>消灯ルーレット(${r.before}灯)</h3><div class="cells">${r.items.map((it, i) => `<div class="cell ${i === cur ? 'cur' : ''}">${it.label}<b>${it.pct}%</b></div>`).join('')}</div>${done ? `<div class="res">${r.lane}番が重複 → ${r.removed >= r.before ? '全消灯' : r.removed + '灯消灯'} (${r.after}灯)</div>` : ''}</div>`;
    }
    if (v.jackpot) {
      const j = v.jackpot, cur = j.k < 0 ? -1 : j.k % j.awards.length;
      h += `<div class="jp"><h3 class="big">JACKPOT</h3><div class="reel">${j.awards.map((a, i) => `<div class="c big ${j.settled && i === j.chosen ? 'won' : i === cur ? 'cur' : ''}">${a}</div>`).join('')}</div></div>`;
    }
    return h;
  }
  _screen(v) {
    const recs = v.records ? `<div class="rec">今日の最高 <b>${v.records.todayBestWallet}玉</b> / 最大 <b>${v.records.todayMaxLamps}灯</b> / 賞玉 <b>${v.records.todayBestAward}玉</b>(${v.records.plays}人)</div>` : '';
    if (v.phase === 'Attract') {
      const tiers = v.prizeTable.map((t) => `<div>${esc(t.name)}<small>${t.from}玉〜</small></div>`).join('');
      return `<div class="screen" data-action="start"><h1 class="big">パチコマ</h1><div class="sub">持ち玉チャレンジ</div>
  <div class="cta big">SPACE で 100円スタート</div>${recs}<div class="tiers">${tiers}</div>
  <div class="rules">違う穴に入れて点灯 → 欲張ると重複で消える<br>CHALLENGE: 消えている穴に入れば賞玉 / 6灯でJP</div></div>`;
    }
    if (v.confirmFinish) return `<div class="screen"><div class="box"><h2 class="big">ここで計数しますか?</h2><p>持ち玉 ${v.wallet}玉 → ${esc(v.prize.name)}</p><div class="btns"><div class="key coral" data-action="confirmFinish"><small>B</small>計数する</div><div class="key" data-action="cancelFinish"><small>Esc</small>続ける</div></div></div></div>`;
    if (v.phase === 'Continue') return `<div class="screen"><div class="box"><h2 class="big">${esc(v.endReason)}</h2><p>100円追加で もう一度続けられます(一度だけ)</p><p style="color:var(--mint)">あと ${Math.ceil(v.offerLeft)} 秒</p><div class="btns"><div class="key" data-action="add"><small>A</small>100円追加</div><div class="key coral" data-action="finish"><small>B</small>ここで計数</div></div></div></div>`;
    if (v.phase === 'Fault') return `<div class="screen"><div class="box"><h2 class="big">係員をお呼びください</h2><p>${esc(v.endReason)}</p><div class="btns"><div class="key" data-action="settleFault">計数へ</div></div></div></div>`;
    if (v.phase === 'Result') {
      const r = v.result;
      return `<div class="screen"><div class="sub" style="margin-top:130px">${esc(v.endReason)}</div><div class="res-prize big">${r.done ? esc(r.prize) : '計数中…'}</div>
  <div class="res-balls big">${r.counted}<small>玉</small></div>
  ${r.done && v.prize.next ? `<div class="res-next" style="font-size:44px;color:var(--mint);margin-top:18px">${esc(v.prize.next.name)}まで あと${v.prize.next.need}玉</div>` : ''}
  <div class="res-stats">最大 ${r.maxLamps}灯 / 最高賞玉 ${r.best}玉<br>CHALLENGE ${r.successes}/${r.attempts} 成功 / 獲得 ${r.won}玉</div>
  ${recs}${r.done ? '<div class="cta big" data-action="reset" style="font-size:52px">R 次のお客さまへ</div>' : '<p style="font-size:40px">計数が終わるまでお待ちください</p>'}</div>`;
    }
    return '';
  }
}
