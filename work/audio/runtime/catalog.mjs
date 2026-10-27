// R2-S: BGM・音声素材は含めない。max はバッファ単位でなく聴覚上の役割の上限。
const c = (cue, group, priority, max, cooldown, gain = 1, loop = false) => ({ cue, group, priority, max, cooldown, gain, loop });
const lamp6Cue = new URLSearchParams(globalThis.location?.search ?? '').get('lcd') === 'video' ? 'jp_chance_s1' : 'lamp6';
export const EVENTS = Object.freeze({
  attract: null, title: c('title','ui',2,1,.6,.6), howto: c('howto','ui',2,1,1,.55),
  ticket: c('ticket','ui',3,1,.3,.7), start: c('start','ui',3,1,.3,.7), ambient: null,
  launch: c('launch','launch',2,2,.045,.55),
  lamp123: c('lamp1','lamp',3,3,.045,.65), lamp4: c('lamp4','lamp',4,3,.1,.8),
  lamp5: c('lamp5','lamp',4,3,.1,.85), lamp6: c(lamp6Cue,'lamp',5,3,.2,.9),
  dup_protect: c('protect','duplicate',3,2,.08,.6),
  roulette: c('roulette_loop','roulette',3,1,.08,.65,true), ascend: c('ascend','ascend',3,2,.08,.7),
  challenge_declare: c('declare','focus',4,1,.15,.8), challenge_cancel: c('cancel','focus',3,1,.15,.5),
  challenge_wait: null, challenge_flight: c('focus_loop','focus',4,1,.1,.6,true),
  success_small: c('success_small','result',5,1,.15,.8), success_big: c('success_big','result',6,1,.2,.9),
  fail: c('fail','result',4,1,.15,.6), jp: c('jp','result',7,1,.5,1),
  tray_overflow: c('overflow','tray_ui',2,1,.5,.4), warn10: c('warn10','ui',3,1,1,.6),
  timeup: c('timeup','ui',4,1,.5,.65), add100: c('add100','ui',3,1,.3,.7),
  finish_count: c('count_loop','counter',2,1,.3,.4,true), result: c('result','result',5,1,.3,.8),
  // R3の継続：専用の音ができるまで既存の音を借りる（積み増しの払い出しは皿の payout が鳴る）
  chain_choice: c('declare','focus',4,1,.15,.75), chain_continue: c('lamp6','lamp',5,3,.2,.9), chain_stop: c('cancel','focus',3,1,.15,.55),
});
export const EXTRA_CUES = ['lamp2', 'lamp3', 'cup', 'payout', 'win_jp_head', 'win_jp_loop', 'win_jp_tail', 'win_number'];
export const CUES = [...new Set([...Object.values(EVENTS).filter(Boolean).map(x => x.cue), ...EXTRA_CUES])];
export const GROUP_CAPS = { ui:2, launch:2, lamp:3, duplicate:2, roulette:1, ascend:2, focus:1, result:1, tray_ui:1, counter:1, physical:8, voice:1, payout:2 };
export const GLOBAL_CAP = 20;
