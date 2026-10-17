# 演出のゲームへの組み込み方

演出は「データ(`spec/events.json`)+光バス(`runtime/lightbus.js`)+液晶(`lcd/`)」で、ゲームは
`runtime/effects.js` の `Effects` 1つだけを触ればよい。

```js
const fx = new Effects({ events, geom });      // spec/events.json と spec/geometry.json
await fx.initLcd({ root: '/' });               // ブラウザのみ。省略すると光だけ動く
fx.setState({ n, litPockets:[1,3], canLaunch, declared, rank, hold, sec, first:{firstShot, firstDeclare} });
fx.notify('lamp123', { pocket:3 });           // ゲームの出来事(events.json の id と同じ名前)
const F = fx.frame(dt);                       // 毎フレーム
// F.petal(45*3) F.edge F.logo F.pocket(7*3) F.btn(6) F.seg F.cues F.lcd(1280x720 canvas)
```

## イベントIDと params
id は events.json の25個(attract, title, ticket, start, ambient, launch, lamp123, lamp4, lamp5, lamp6,
dup_protect, roulette, ascend, challenge_declare, challenge_flight, success_small, success_big, fail, jp,
tray_overflow, warn10, timeup, add100, finish_count, result)。`stop(id)` で hold 型を止める。

| params | 使うイベント |
|---|---|
| payout | success_*(1/2/3/12/30), jp(40/80/150/300/600) |
| k, n_from | roulette / ascend(消える灯数 1〜3 または 'all'、重複時の灯数) |
| rank | result(0..5=参加賞/C/B/A/S/SS) |
| pocket / hit | lamp*, success_*, fail(口の番号 1..7) |
| total | tray_overflow, finish_count |
| reason | timeup('time'|'balls') |
| first | 初めてのとき true(dup_protect, challenge_declare, success_small 等の初回説明用) |
| weak | warn10(玉が少ないとき数字を出さない) |

## 時計
JP、ルーレット+昇天の間は**ゲーム時計を止める**(調整担当に反映済み)。`fx.clockStopped()` が
true の間は残り秒を進めない。演出の長さはプレイ時間を食わない。JPは配当別に14/16/20/24/28秒(40/80/150/300/600玉)。重複ルーレット+昇天で時計を止めるのは消える前の灯が4灯(6秒)・5灯(12秒)のときだけで、1〜3灯は0.5秒だけ操作を止め、昇天は液晶で約3秒続けて操作は可能(Effects.rouletteTargets と clockStopped が同じ表)。

## 重複ルーレット・昇天(既存の灯演出)
- `lamp123`(params `n`=灯数)/`lamp4`/`lamp5`/`lamp6`/`roulette`(params `k`,`n_from`)は既存の upa_swim 演出を
  iframe で液晶へ取り込んだもの。ルーレット約8.3秒の後、昇天は液晶が始めた瞬間に光が自動で始まる。
  したがって `notify('ascend')` は呼ばない(呼んでも -1 を返して何もしない)。
- Pixi は `anim/upa_swim/vendor/` に同梱。展示会場にネットが無くても動く。
- 液晶の確認は `LCD_CPU=1 work/effects/tools/lcd_sheet.sh <名前> <scene id> <秒> <列数> [params] [灯数] [枚数]`(GPU不要)。

## 光の使い方
- 花びら: `F.petal` はそのまま 45 区画の線形RGB。
- 縁LED: 虹B(基本)の上に `mul`(24)→`ovr/ovrA`(上書き)→`add`(72)の順。
- ボタン: `F.btn=[Lr,Lg,Lb,Rr,Rg,Rb]`。
- ロゴ/入賞口LED/7セグ: 値は出す。3Dモデル側が受けられるまでは `F.cues` を見て各自で。

## 確認
`work/effects/tools/ev_sheet.sh <id> <n0> <n1> <dur> <cols> [params]` で1イベントの絵を並べて見る(ステージ=3D筐体の複製+液晶)。

## 皿の玉(払い出し・回収)との同期(10/17追記)
- 皿の玉は実球(調整側の物理)。演出側は玉を作らず、`connectPlayEffects({..., tray})` で渡された関数を、光バスの `tray` トラック(`payout`/`collect`)が始まった瞬間に呼ぶだけ。
  - `tray.award(count, {eventId, duration, rate, origin:'payoutPort'})` → 任意で `{landed(), done()}` を返す。`landed()` は皿に着いた玉の数。
  - `tray.collect({eventId, duration})`(精算の回収)。
- 払い出し数: ticket/add100 は規則の `loanBalls`、成功/JP は `payout`。時間は光バスのトラックの長さ(`t1-t0`、`scale` 反映済み)。
- 液晶: 玉を液晶に積まない。下向きの矢印(`B.trayArrow`)で皿へ目を送り、数字は `LCD.landed(total, 時間の値)` で、着いた玉の数に合わせる(ハンドルが無ければ時間で進める)。
- 動画クリップ(3D筐体)には皿の物理が無いので、数字は時間で進み、玉は映らない。

## ゲーム時計の停止と、毎球の短い版(10/17追記・調整側と合意)
- `fxApi.clockStopped()` / `fxApi.clockStopReason()`(イベント名か null)。止めるのは合図の瞬間だけ: JPは全尺(ゲームのJP演出 receipt.duration=14/16/20/24/28秒。イベント内の時間で20)、4灯は0.8秒、大成功はリセット側の2.5秒、重複ルーレット+昇天は4灯以上で全編。数え上げ・皿の注ぎ・余韻は時計を動かしたまま。値は `Effects.CLOCK_STOP`。
- 毎球の演出は短い版(`Effects.COMPACT` = 映像の長さの倍率): 入賞0.8s・重複0.35s・5/6灯1.5s・失敗1.8s。入賞と重複は液晶を占有せず光と通常画面のウパだけ(`Effects.QUIET`)。初回(`first`)だけ説明つきで全編。
- 惜しい: `fail` に `near_miss===true` のときだけ、`target` の口に波紋1回(`when` つきトラック)。

## 10/17 夜: 入口の流れと縁LEDの土台(ディレクターの意見欄02〜08への対応)
- 新イベント `howto`(液晶シーン、5.2秒): タイトルのボタンの後、ticket の前。「玉を上から落として、穴に入れると増える」を一文ずつ。ticket の払い出し・時計はこの後に始める(調整担当へ依頼済み: EFFECT_IDS に howto を足し、start後 howto→dur待ち→ticket)。
- 縁LEDは虹を使わず、灯の数で土台の色が変わる(lightbus.edgeBase): 0〜3灯=紺(弱)、4・5灯=ピンク、6灯=金。イベントは `baseTint`(color, level)で上書き(重複ルーレット=赤)。虹は `rainbowB` を明示したイベントの間だけ(JP・大成功)。色は edge.add に足すので stage / LightAdapter / 本番で同じ式。
- 液晶: title(ロゴ+7色ウパのパレード)/ticket(チケットが飛んで来て光り、GET! と数字。玉は液晶の外の皿)/start(さあ、いこう!)/tut_first_lamp(3段階: 光る・ちがう穴・同じ穴はルーレット)を作り直し。文字素材 t_logo / t_get / t_ready は lcd/tools/gen_titles.py の TITLES に追加。
