// JP の液晶映像の切り替え（?lcd=video）。JP 演出の担当が場面ごとに書き出した映像（effects/jp_film/tmp/export、pub/export_scenes.py）を、ゲームの出来事に合わせてつなぐ。
//   S1 JPチャンス開始（1回）→ S2 狙え（ループ）→ S3 発射〜着地待ち（ループ）→ S4a 入賞〜大当り（1回）／S4b 外れ（1回）→ S5 配当の昇格（1回ずつ）→ 段の「獲得!!」（ループ、JP の全尺が終わるまで）
// manifest.json：[{ name, file, frames, loop, next: [場面], cut_frames: [コマ番号], ... }]（30fps）
// 切り替えの決まり：1 回の場面は最後のコマまで流す。ループの場面は「切ってよいコマ」に来た時に次へ。行きたい場面が next に無い時（例：S1 の途中で球が入った）は、その場面の区切りで直接そこへ飛ぶ。
const FPS = 30;

// 配当から段ごとの結果を決めてから、煽りの強弱だけを引く。必要な素材・規則がなければ null＝今までの next の道
export function planPayout(payout, rule, has, rand = Math.random) {
  payout = Number(payout);
  if (![30, 40, 100, 200, 500].includes(payout)) return null;
  const scenes = ['S4a_hit', 'S5_30'], steps = [];
  for (const [from, to] of [[30, 40], [40, 100], [100, 200]]) {
    const step = `${from}to${to}`, result = payout >= to ? 'up' : 'stay';
    const weight = rule?.steps?.[step]?.[`strong_weight_if_${result}`], name = `S5_${step}_${result}`;
    if (!Number.isFinite(weight) || weight < 0 || weight > 1 || (!has(`${name}_S`) && !has(`${name}_W`))) return null;
    steps.push({ name, weight });
    if (result === 'stay') break;
  }
  const tail = payout === 500 ? ['S5_fake500', 'S5_500_get'] : [`S5_${payout}_get`];
  if (![...scenes, ...tail].every(has)) return null;
  for (const { name, weight } of steps) {
    const strong = rand() < weight, chosen = `${name}_${strong ? 'S' : 'W'}`;
    scenes.push(has(chosen) ? chosen : `${name}_${strong ? 'W' : 'S'}`);
  }
  return [...scenes, ...tail];
}

export async function createJpSeq({ manifestUrl, teaseRuleUrl = new URL('../../../effects/jp_film/review/payout_tease_rule.json', import.meta.url), rand = Math.random, log = () => {} }) {
  let man;
  try { const r = await fetch(manifestUrl); if (!r.ok) throw new Error(`HTTP ${r.status}`); man = await r.json(); }
  catch (e) { console.warn('jp scenes', manifestUrl, e.message); return null; }
  let teaseRule = null;
  try { const r = await fetch(teaseRuleUrl); if (!r.ok) throw new Error(`HTTP ${r.status}`); teaseRule = await r.json(); }
  catch (e) { console.warn('jp tease rule', teaseRuleUrl, e.message); }
  const base = new URL('.', new URL(manifestUrl, location.href)), S = {};
  for (const s of man) {
    if (!s.file) continue;   // まだ作っていない場面（S4b 外れなど）は飛ばす
    const r = await fetch(new URL(s.file, base)); if (!r.ok) { console.warn(`jp scene ${s.file}: HTTP ${r.status}`); continue; }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = !!s.loop;
    v.src = URL.createObjectURL(await r.blob());
    S[s.name] = { ...s, v, cut: new Set(s.cut_frames ?? []), dur: s.frames / FPS };
  }
  const has = (n) => !!S[n];
  // 配当 → S4a から「獲得!!」までの道（next をたどる最短の道）
  const pathTo = (from, to) => {
    const prev = { [from]: null }, q = [from];
    while (q.length) { const n = q.shift(); if (n === to) break; for (const m of S[n]?.next ?? []) if (has(m) && !(m in prev)) { prev[m] = n; q.push(m); } }
    if (!(to in prev)) return null;
    const p = []; for (let n = to; n != null; n = prev[n]) p.unshift(n); return p;
  };
  let active = false, goal = null, cur = null, t = 0, lastF = -1, manual = false, endAt = Infinity, clock = 0, ready = false;
  // 継続（連チャン）の値。場面には数字を焼かず、lcd_surface が slots に従って重ねる（effects/chain/scenes_chain.json）
  const chain = { on: false, chain: 0, pending: 0, lamps: 1, lost: 0, total: 0, bumpAt: -1 };
  const lampsOf = () => Math.min(6, Math.max(1, Math.round(chain.lamps) || 1));
  // 選択の場面：積み増しがあれば次の灯の数の版（C1_offer_hold_L）、無ければ C1_offer
  const offer = () => (chain.pending > 0 ? [`C1_offer_hold_${lampsOf()}`, 'C1_offer_hold'].find(has) ?? 'C1_offer' : 'C1_offer');
  let lastPayout = 30;
  // 継続の流れは決まった並び（plan）で進める。止まっている時（JP の全尺が終わった後など）はすぐ頭から始める
  const goChain = (plan) => {
    plan = plan.filter(has); if (!plan.length) return false;
    chain.on = true; goal = { plan }; endAt = Infinity;
    if (!active || !cur) { active = true; start(plan[0]); }
    return true;
  };
  const start = (name) => {
    const s = S[name]; if (!s) return;
    if (cur && cur !== s) cur.v.pause();
    cur = s; t = 0; lastF = -1; ready = false;
    s.v.currentTime = 0; if (!manual) s.v.play().catch(() => {});
    log(name);
  };
  // 場面の名前の頭（S1・S2・S3…）で探す。variant_of の付いた場面（穴ごとの外れ）は除く
  // 流れ第2版（FLOW_DESIGN.md §4）：6 灯でリールが自動で回る S2_intro から始め、JPチャンス S1 → 狙え S2_aim → カットイン S3
  const entryScene = () => (has('S2_intro') ? 'S2_intro' : 'S1_jpchance');
  // 割り込み：JPチャンスの題字の 0.5 秒以降と狙えの間は、発射で 0.15 秒の白を挟んでカットインの入りへ（撃てない時間を作らない）
  const INTERRUPT_AFTER = 0.5, FLASH = 0.15;
  let flashAt = -1;
  const canInterrupt = () => cur && ((cur.name.startsWith('S1') && t >= INTERRUPT_AFTER) || cur.name === byPrefix('S2').find((n) => S[n].loop));
  const interrupt = () => { const s3 = byPrefix('S3')[0]; if (!s3 || !canInterrupt()) return false; flashAt = clock; start(s3); return true; };
  // 当たりの後：大当り → ルーレット（S6_roul_{配当}、30 は 3 回に 1 回「惜しい止まり」S6_roul_30_near）。無ければ今までの昇格の道
  const hitPlan = (payout) => {
    const r = `S6_roul_${payout}`, near = `${r}_near`;
    if (has(r)) return [byPrefix('S4a')[0], payout === 30 && has(near) && rand() < 1 / 3 ? near : r].filter(Boolean);
    return planPayout(payout, teaseRule, has, rand);
  };
  const byPrefix = (p) => Object.keys(S).filter((n) => n.startsWith(p) && !S[n].variant_of).sort();
  const missOf = (hole) => has(`S4b_miss_${hole}`) ? `S4b_miss_${hole}` : has('S4b_miss') ? 'S4b_miss' : Object.keys(S).find((n) => S[n].variant_of === 'S4b_miss');
  // 目標の場面（そこで止まる・ループする）と、今の場面から行けない時の入口
  const target = () => {
    if (goal === 'chance') return { to: byPrefix('S2')[0], entry: entryScene() };
    if (goal === 'flight') { const s3 = byPrefix('S3'); return { to: s3.find((n) => S[n].loop) ?? s3[0], entry: s3[0] }; }   // S3a 入り → S3b ループで待つ（S3c 抜けは結果が出てから）
    if (goal?.miss) { const m = missOf(goal.hole); return { to: m, entry: m }; }   // 外れは入った穴の番号の 1 本、そのあと通常の映像へ
    if (goal?.hit) { const to = has(`S5_${goal.payout}_get`) ? `S5_${goal.payout}_get` : 'S5_30_get'; return { to, entry: byPrefix('S4a')[0] }; }
    return {};
  };
  // 区切りに来た時の次の場面：今の場面から目標までの next の道をたどる（S3b → S3c → S4a …）。途中のループの場面はすぐ抜けるので飛ばす（S1 の終わりに球が入っていたら S2 を挟まない）
  const nextOf = () => {
    if (goal?.plan) {
      const i = goal.plan.indexOf(cur?.name);
      if (i >= 0) return goal.plan[i + 1] ?? (cur.loop ? cur.name : null);
      const to = goal.plan[0], path = cur && pathTo(cur.name, to);
      return path?.slice(1).find((n) => n === to || !S[n].loop) ?? to;
    }
    const { to, entry } = target(); if (!to) return null;
    if (cur?.name === to) return cur.loop ? to : null;
    const path = (cur && pathTo(cur.name, to)) ?? (entry && pathTo(entry, to) && [null, ...pathTo(entry, to)]);
    if (!path) return has(to) ? to : null;
    return path.slice(1).find((n) => n === to || !S[n].loop) ?? to;
  };
  const stop = () => { chain.on = false; active = false; goal = null; if (cur) cur.v.pause(); cur = null; endAt = Infinity; };
  return {
    get active() { return active; },
    // 今の場面とコマ、継続の値（数字を重ねる側が使う）。数字の差し替えは bump（秒）で弾ませる
    where() {
      if (!active || !cur) return null;
      const tl = cur.loop ? t % cur.dur : t;
      return { name: cur.name, f: Math.min(cur.frames - 1, Math.floor(tl * FPS + 1e-6)), slots: cur.slots ?? null, values: chain, bump: chain.bumpAt >= 0 ? clock - chain.bumpAt : Infinity, flash: flashAt >= 0 ? 1 - (clock - flashAt) / FLASH : 0 };
    },
    onEvent(id, p = {}) {
      if (id === 'chain_choice') {
        const before = chain.pending;
        Object.assign(chain, { chain: p.chain ?? chain.chain, pending: p.pending ?? chain.pending, lamps: p.lamps ?? chain.lamps });
        if (chain.on && cur?.name === offer()) { if (before !== chain.pending) chain.bumpAt = clock; return true; }   // 同じ選択の場面のままなら戻さず、数字だけ差し替える
        // 最初の JP のルーレットの後は、門が閉じて光るつなぎ（C9_gate_{配当}）を挟む
        const gate = !chain.on && `C9_gate_${lastPayout}`;
        return goChain([...(gate && has(gate) ? [gate] : []), offer()]);
      }
      if (id === 'chain_continue') { if (p.lamps != null) chain.lamps = p.lamps; return goChain([`C2_enter_${lampsOf()}`, `C3_aim_${lampsOf()}`]); }
      if (id === 'challenge_flight' && p.chain) { if (p.lamps != null) chain.lamps = p.lamps; return goChain([`C4_fly_${lampsOf()}`]); }
      if (id === 'jp' && p.chain) {
        Object.assign(chain, { chain: p.chainStage ?? chain.chain + 1, pending: p.pending ?? chain.pending });
        const pay = [30, 40, 100, 200, 500].includes(p.payout ?? p.award) ? p.payout ?? p.award : 30;
        if (p.lamps != null) chain.lamps = p.lamps;
        // 成功 → 短いルーレット（R-add、担当D。無ければ焼いた加算 C5_add）→ 合計 → 次の選択
        const add = [`S6_radd_${pay}`, `C5_add_${pay}`].find(has);
        return goChain([`C5_ok_${lampsOf()}`, ...(add ? [add] : []), 'C5_total', offer()]);
      }
      if (id === 'fail' && p.chain) {
        chain.lost = p.chainLost ?? 0;
        if (!goChain([chain.lost > 0 ? 'C6_ng_lost' : 'C6_ng_free'])) stop();
        chain.on = false; return active;   // 1 回の場面が終わったら通常の映像へ
      }
      if (id === 'chain_stop') {
        chain.total = p.banked ?? p.total ?? 0;
        const go = chain.total > 0 && goChain(['C7_bank']); chain.on = false;
        if (!go) stop();
        return go;
      }
      if (id === 'add100' && p.chain) { if (p.chainPending != null) chain.pending = p.chainPending; return goChain(['C8_add', offer()]); }
      if (id === 'lamp6') { active = true; goal = 'chance'; endAt = Infinity; start(entryScene()); return true; }
      if (!active) return false;
      if (id === 'challenge_flight') { if (!goal?.hit && !goal?.miss) { goal = 'flight'; interrupt(); } return true; }
      if (id === 'jp') { const payout = p.payout ?? 30; lastPayout = payout; goal = { hit: true, payout, plan: hitPlan(payout) }; endAt = clock + (p.duration > 0 ? p.duration : 20); return true; }
      if (id === 'fail') { goal = { miss: true, hole: p.pocket }; endAt = clock + 15; if (!missOf(p.pocket)) stop(); return active; }   // 15 秒は念のための上限（ふつうは外れの映像の終わりで通常へ戻る）
      if ((id === 'finish_count' || id === 'result') && cur?.name === 'C7_bank') return true;   // 時間切れの確定（reason 'finish'）は finish_count より先に来る。確定!! を流しきってから通常へ
      if (id === 'challenge_cancel' || ['timeup', 'finish_count', 'result', 'attract', 'ticket'].includes(id)) { stop(); return false; }
      return true;   // JP の間は、他の出来事の液晶の映像を出さない（光と音だけ）
    },
    setManual(on) { manual = !!on; if (cur) { if (manual) cur.v.pause(); else cur.v.play().catch(() => {}); } },
    // manual（撮影）のとき、毎コマの前に：映像をこの場面の時刻へ
    async prepare(dt) {
      if (!manual || !cur) return;
      const v = cur.v, tt = cur.loop ? t % cur.dur : Math.min(t, cur.dur - 0.5 / FPS);
      await new Promise((res) => { const to = setTimeout(done, 2000); function done() { clearTimeout(to); v.removeEventListener('seeked', done); ready = true; res(); } v.addEventListener('seeked', done); v.currentTime = tt; });
    },
    // 1 コマ進めて、貼る映像を返す（まだ最初のコマが出ていなければ null＝前の絵のまま）
    frame(dt) {
      clock += dt;
      if (!active || !cur) return null;
      if (clock >= endAt) { stop(); return null; }
      if (manual) t += dt; else { t = cur.v.currentTime; if (cur.v.readyState >= 2 && !cur.v.paused) ready = true; }
      const tl = cur.loop ? t % cur.dur : t, f = Math.min(cur.frames - 1, Math.floor(tl * FPS + 1e-6));
      const want = nextOf();
      if (goal === 'flight' && cur.name.startsWith('S1') && canInterrupt()) { const v = cur.v; interrupt(); return v; }   // 題字の 0.5 秒前に撃っていたら、0.5 秒で割り込む
      if (want && want !== cur.name) {
        const atEnd = !cur.loop && (f >= cur.frames - 1 || (!manual && cur.v.ended));
        let cut = false;
        if (cur.loop) { for (let k = lastF + 1; k !== f + 1; k = (k + 1) % cur.frames) { if (cur.cut.has(k)) { cut = true; break; } if (k === f) break; } }
        if (atEnd || cut) { const v = cur.v; start(want); return v; }   // このコマは前の場面の絵、次のコマから新しい場面
      } else if (!want && !cur.loop && f >= cur.frames - 1) { const v = cur.v; stop(); return v; }
      lastF = f;
      return ready ? cur.v : null;
    },
    dispose() { for (const s of Object.values(S)) { URL.revokeObjectURL(s.v.src); s.v.src = ''; } },
  };
}
