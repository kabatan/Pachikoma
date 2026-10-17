// WebAudio 版の音響バス（ExperienceAudioBus.Medal.cs の移植）。音源は assets/audio/ をそのまま再利用。
// - cue: 同時発音数・クールダウン・優先度・ピッチ揺らぎ・バリアント(name_1..n)を持つ
// - loop: medal_counter_loop など
// - music: Base/Reach/Challenge/Result/Attract をクロスフェード(0.4s)。Base/Reach/Challenge は同期(同じ再生位置)
// - duck: -14dB + ローパス 20.5kHz→1.1kHz（スロー/無音の瞬間）
// ブラウザの自動再生制限のため、最初の入力(unlock)で AudioContext を開始する。

const DB = (db) => Math.pow(10, db / 20);
// [name, gainDb, priority, maxVoices, cooldownMs, pitchJitter, stealOldest, quietExtraDb]
const CUE_TABLE = [
  ['medal_tray_drop', 0, 2, 10, 20, .06, true], ['medal_tray_clatter', -3, 1, 4, 80, .09, false],
  ['medal_rail', 0, 2, 2, 120, .03, true], ['medal_fire', 0, 3, 2, 100, .03, true],
  ['medal_lamp_1', 0, 3, 2, 60, 0, true], ['medal_lamp_2', 0, 3, 2, 60, 0, true], ['medal_lamp_3', 0, 3, 2, 60, 0, true],
  ['medal_lamp_4', 0, 4, 2, 60, 0, true, -1], ['medal_lamp_5', 0, 4, 2, 60, 0, true, -1], ['medal_lamp_6', 0, 4, 2, 60, 0, true, -2],
  ['medal_keep', 0, 3, 2, 80, .01, true], ['medal_roulette_tick', -1, 2, 4, 25, .03, true], ['medal_lamp_break', 0, 3, 2, 80, .03, true],
  ['medal_arm', 0, 4, 1, 300, 0, true, -2], ['medal_disarm', 0, 3, 1, 200, 0, true], ['medal_heartbeat', 0, 3, 2, 250, 0, true],
  ['medal_silence_hit', 0, 5, 1, 300, 0, true, -4], ['medal_win_small', 0, 4, 2, 200, 0, true], ['medal_win_mid', 0, 4, 2, 200, 0, true, -1],
  ['medal_win_big', 0, 5, 1, 300, 0, true, -3], ['medal_win_max', 0, 5, 1, 300, 0, true, -4], ['medal_miss', 0, 4, 1, 200, 0, true],
  ['medal_payout_ball', 0, 2, 8, 22, .02, true], ['medal_box_pour', 0, 3, 1, 300, 0, true, -2], ['medal_stamp', 0, 4, 1, 200, .02, true, -3],
  ['medal_cutin', 0, 5, 1, 300, 0, true, -4], ['medal_counter_loop', -3, 2, 1, 0, 0, true],
  // 盤の釘（元は合成音。ここでは sr_hit を音高違いで使う）
  ['sr_hit', -9, 1, 4, 45, .03, true],
].map(([name, gainDb, priority, maxVoices, cooldownMs, pitchJitter, steal, quietExtra = 0]) =>
  ({ name, gainDb, priority, maxVoices, cooldownMs, pitchJitter, steal, quietExtra }));

const MUSIC = {
  Base: { file: 'medal_bgm_base.ogg', db: -2, sync: true }, Reach: { file: 'medal_bgm_reach.ogg', db: -2, sync: true },
  Challenge: { file: 'medal_bgm_challenge.ogg', db: -2, sync: true }, Result: { file: 'medal_bgm_result.ogg', db: -2, sync: false },
  Attract: { file: 'sr_attract_loop.ogg', db: -18, sync: false },
};
const FADE = 0.4, QUIET_MUSIC_DB = -8, QUIET_CUE_DB = -3, DUCK_DB = -14, LP_OPEN = 20500, LP_CLOSED = 1100;

export class MedalAudio {
  /** @param {string} baseUrl 音源フォルダ(末尾 /)。 */
  constructor(baseUrl = '../assets/audio/', { quiet = false } = {}) {
    this.base = baseUrl; this.quiet = quiet;
    this.ctx = null; this.buffers = new Map(); this.variants = new Map(); this.specs = new Map(CUE_TABLE.map((s) => [s.name, s]));
    this.voices = []; this.lastStart = new Map(); this.lastVariant = new Map(); this.loops = new Map();
    this.musicTier = 'None'; this.music = [null, null]; // {src,gain,tier,startedAt,target,level}
    this.duck = 0; this.duckTarget = 0; this.loaded = false; this.warned = new Set();
    this.log = []; // 発音ログ(QA用): [timeMs, cue]
  }
  /** ユーザー操作の中で呼ぶ。 */
  async unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain(); this.master.gain.value = 1;
      this.musicBus = this.ctx.createGain(); this.lp = this.ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = LP_OPEN; this.lp.Q.value = 0.5;
      this.musicBus.connect(this.lp).connect(this.master); this.master.connect(this.ctx.destination);
      this._tick = setInterval(() => this._update(0.03), 30);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return true;
  }
  async _fetchDecode(file) {
    const r = await fetch(this.base + file); if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return this.ctx.decodeAudioData(await r.arrayBuffer());
  }
  /** 全 cue とBGMを先読み(開始操作の前に完了させる)。存在しないファイルは警告のみ。 */
  async preload({ files = null, music = true } = {}) {
    if (!this.ctx) throw new Error('call unlock() inside a user gesture first');
    const jobs = [];
    for (const spec of CUE_TABLE) jobs.push((async () => {
      const list = [];
      if (files) {
        const names = files.filter((f) => f === spec.name + '.wav' || new RegExp('^' + spec.name + '_[1-8]\\.wav$').test(f));
        for (const name of names) { try { list.push(await this._fetchDecode(name)); } catch { this._warn(name); } }
      } else {
        for (let i = 1; i <= 8; i++) { try { list.push(await this._fetchDecode(`${spec.name}_${i}.wav`)); } catch { break; } }
        if (!list.length) { try { list.push(await this._fetchDecode(`${spec.name}.wav`)); } catch { this._warn(spec.name); } }
      }
      if (!list.length) this._warn(spec.name);
      if (list.length) this.variants.set(spec.name, list);
    })());
    if (music) for (const [tier, m] of Object.entries(MUSIC)) jobs.push(this._fetchDecode(m.file).then((b) => this.buffers.set(tier, b), () => this._warn(m.file)));
    await Promise.all(jobs); this.loaded = true;
  }
  _warn(n) { if (!this.warned.has(n)) { this.warned.add(n); console.warn('audio missing:', n); } }
  has(name) { return this.variants.has(name); }
  setQuiet(q) { this.quiet = q; }

  /** @returns {boolean} 発音したか(クールダウン・同時数で落ちたら false) */
  playCue(name, pitch = 1, volumeDb = 0) {
    const spec = this.specs.get(name), vars = this.variants.get(name);
    if (!this.ctx || !spec || !vars) { if (!spec || (this.loaded && !vars)) this._warn(name); return false; }
    const nowMs = performance.now();
    if (spec.cooldownMs > 0 && nowMs - (this.lastStart.get(name) ?? -1e9) < spec.cooldownMs) return false;
    this.voices = this.voices.filter((v) => v.end > nowMs);
    const same = this.voices.filter((v) => v.cue === name);
    if (same.length >= spec.maxVoices) {
      if (!spec.steal) return false;
      const oldest = same.reduce((a, b) => (a.start <= b.start ? a : b)); try { oldest.src.stop(); } catch {} this.voices.splice(this.voices.indexOf(oldest), 1);
    }
    if (this.voices.length >= 20) {
      const victim = this.voices.reduce((a, b) => (a.prio < b.prio || (a.prio === b.prio && a.start < b.start) ? a : b));
      if (spec.priority < victim.prio) return false;
      try { victim.src.stop(); } catch {} this.voices.splice(this.voices.indexOf(victim), 1);
    }
    let index = 0;
    if (vars.length > 1) { const prev = this.lastVariant.get(name) ?? 0; index = Math.floor(Math.random() * (vars.length - 1)); if (index >= prev) index++; this.lastVariant.set(name, index); }
    const jitter = spec.pitchJitter > 0 ? 1 + (Math.random() * 2 - 1) * spec.pitchJitter : 1;
    const src = this.ctx.createBufferSource(); src.buffer = vars[index];
    src.playbackRate.value = Math.min(4, Math.max(0.25, pitch * jitter));
    const g = this.ctx.createGain();
    g.gain.value = DB(spec.gainDb + volumeDb + (this.quiet ? QUIET_CUE_DB + spec.quietExtra : 0));
    src.connect(g).connect(this.master); src.start();
    const dur = vars[index].duration / src.playbackRate.value * 1000;
    this.voices.push({ cue: name, prio: spec.priority, start: nowMs, end: nowMs + dur, src });
    this.lastStart.set(name, nowMs); this.log.push([Math.round(nowMs), name]);
    return true;
  }
  /** 釘ヒット: 連続ヒットで半音ずつ上がる(音高は呼び出し側)。 */
  playPeg(pitch = 1) { return this.playCue('sr_hit', pitch); }

  startLoop(name, volumeDb = 0) {
    const spec = this.specs.get(name), vars = this.variants.get(name);
    if (!this.ctx || !spec || !vars) return;
    const target = DB(spec.gainDb + volumeDb + (this.quiet ? QUIET_CUE_DB : 0));
    let l = this.loops.get(name);
    if (l) { l.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04); return; }
    const src = this.ctx.createBufferSource(); src.buffer = vars[0]; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    src.connect(gain).connect(this.master); src.start(); this.loops.set(name, { src, gain });
  }
  stopLoop(name) {
    const l = this.loops.get(name); if (!l || !this.ctx) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); const src = l.src; setTimeout(() => { try { src.stop(); } catch {} }, 200); this.loops.delete(name);
  }

  /** tier: 'None'|'Base'|'Reach'|'Challenge'|'Result'|'Attract' */
  setMusic(tier) {
    if (tier === this.musicTier) return;
    const prevTier = this.musicTier; this.musicTier = tier;
    for (const m of this.music) if (m && m.tier !== tier) m.target = 0; // 旧BGMをフェードアウト
    if (tier === 'None' || !this.ctx) return;
    const buf = this.buffers.get(tier); if (!buf) { this._warn('music ' + tier); return; }
    const spec = MUSIC[tier];
    const cur = this.music.find((m) => m && m.tier === prevTier && m.target === 0);
    let offset = 0;
    if (cur && spec.sync && MUSIC[prevTier]?.sync) offset = (this.ctx.currentTime - cur.startedAt) % buf.duration; // 同期系は再生位置を引き継ぐ
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0; src.connect(gain).connect(this.musicBus);
    src.start(0, offset);
    const slot = { src, gain, tier, level: 0, target: 1, startedAt: this.ctx.currentTime - offset, db: spec.db };
    const free = this.music.findIndex((m) => !m); this.music[free >= 0 ? free : this.music.findIndex((m) => m.target === 0 || m === this.music[0])] = slot;
  }
  /** 0..1。スローや結果直前の無音で BGM を沈める。 */
  setDuck(a) { this.duckTarget = Math.min(1, Math.max(0, a)); }
  _update(dt) {
    if (!this.ctx) return;
    this.duck += (this.duckTarget - this.duck) * Math.min(1, dt / (this.duckTarget > this.duck ? 0.12 : 0.35));
    this.lp.frequency.value = LP_OPEN + (LP_CLOSED - LP_OPEN) * this.duck * this.duck;
    for (let i = 0; i < 2; i++) {
      const m = this.music[i]; if (!m) continue;
      const step = dt / FADE; m.level += Math.sign(m.target - m.level) * Math.min(Math.abs(m.target - m.level), step);
      const db = m.db + (this.quiet ? QUIET_MUSIC_DB : 0) + DUCK_DB * this.duck;
      m.gain.gain.value = DB(db) * m.level;
      if (m.target === 0 && m.level <= 0) { try { m.src.stop(); } catch {} this.music[i] = null; }
    }
  }
  stopAll() {
    for (const n of [...this.loops.keys()]) this.stopLoop(n);
    this.setMusic('None'); this.duckTarget = 0;
    for (const v of this.voices) { try { v.src.stop(); } catch {} } this.voices = [];
  }
  dispose() { clearInterval(this._tick); this.stopAll(); this.ctx?.close(); }
}
