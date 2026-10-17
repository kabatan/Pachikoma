# 演出イベントの接続

`effects_bus.mjs` は通知専用。`window.__effects.on('lamp4', e => ...)`、全件は
`on('*', e => ...)`。戻り値の関数で購読解除。`emit(id, payload)` は待機画面などの
外部入力用。`?effects_log=1` で全件をコンソール表示する。
同期配送で例外はconsole.errorに出し、残りの購読者へ配送する。payloadはコピー・再帰freeze
するため、他の購読者や規則の状態を書き換えない。snapshot()は `{total,counts,last,t,state}` のコピー。
履歴は無制限に保持しない。必要なら購読者で保存する。

共通: `{id,t,state:{lit,pockets,balls,secondsLeft,canLaunch,declared,first:{shot,light,duplicate,challenge,success,failure}},data}`。
tはruntimeの480Hz経過秒（タブ停止中は進まない）。規則時計停止中もtは進む。ballsは表示待ち払出を含む規則財布。
firstは今回のイベントがカテゴリ初回ならtrue、無関係なカテゴリはfalse。shot=実発射、
light=新灯、duplicate=保護/消灯共通、challenge=手動宣言、success=成功/JP共通、failure=勝負失敗。
追加では初回をリセットせず、新規セッションでリセットする。各灯数の初到達はdata.firstAtLevel。
`challenge_flight`は自動6灯勝負も通知する（宣言とは区別）。

ボタン点灯は描画フレームごとに `const {state} = window.__effects.snapshot()` を呼び、
`state.canLaunch` と `state.declared` を使う。snapshotは呼び出した瞬間の状態を返すので、
過去イベントの `last.state` を参照しない。snapshotは通知回数を増やさない。
canLaunchは規則のcanFireかつ計数確認/規則凍結中でないこと。発射受付から物理着地確定までfalse。
RapidFire=trueではFresh/ProtectedのEffect中もtrue（玉/残り秒がある場合）。
Reset、勝負成功/失敗、JPのEffect中はfalse。declaredはarmedと同じで、6灯自動宣言も含む。

演出側の呼び名と互換キー（全てdata内）:

| 演出の呼び名 | バスのキー | 互換キー・意味 |
|---|---|---|
| payout | payout | JPのawardと同値 |
| k | k | removedCount（実際に消える灯数） |
| n_from | n_from | before.length（Reset前の灯数） |
| rank | rank | prizeRank（participation/C/B/A/S/SS） |
| pocket | pocket | lane（着地口1..7、receipt系） |
| total | total | balls（finish_count/resultの最終財布、overflow時はその時点） |
| reason | reasonCode | time/balls。既存data.reasonは日本語のため互換維持。演出関数へは `{reason: e.data.reasonCode}` と渡す。任意計数はnull |
| first | first | state.firstの該当カテゴリ。カテゴリなしはfalse。灯数別の初回は従来のfirstAtLevel |

以下の「規則秒」は入力ロックの現行値。「仕様秒」はread-onlyの
`work/effects/spec/events.json` のdur。仕様のblockingやtracksから入力ロックを変更しない。
receipt系のdataにはreceiptId/lane/award/duration/before/afterを含める。

| id | 発行する瞬間・data | 規則秒 / 仕様秒 | 状態・差異 |
|---|---|---|---|
| attract | 接続時とreset成功後。data={} | なし / 18(loop) | 開始待ちフェーズを利用。客引き動画は未実装 |
| title | `bridge.enterTitle(data)` またはbus.emit | なし / 0 | 接近検出と独立タイトル画面なし。自動発行不可、発行口のみ |
| ticket | controllerのstart成功直後。balls,duration | loanSeconds(18)=1.87 / 4.5 | 開始操作に対応 |
| start | 初回貸玉EffectからReadyへ。duration=0 | 独立ロックなし / 2.2 | 物理払出完了+0.3秒とは異なる。規則時計は貸玉Effectから既に進むため、時計変更はしない |
| ambient | Readyかつ既存presenterの個別fx/revealが無い状態への入口 | なし / 0(loop) | 連射中の並行演出の終了管理は購読者側 |
| launch | 物理launch。shotId,aim,dir | 飛行終了まで / .25 | 受付から実発射待ちの間は発行しない |
| lamp123 | Freshのafterが1〜3灯。lane,award=次の勝負配当,firstAtLevel | .45 / 2.4 | RapidFire有効なら待たず次発射可 |
| lamp4 | Freshのafterが4灯。同上 | .45 / 3.6 | 初回の矢印はfirstAtLevelを利用 |
| lamp5 | Freshのafterが5灯。同上 | .45 / 3.0 | 同上 |
| lamp6 | Freshのafterが6灯。同上 | .45 / 3.6 | 次球は自動勝負 |
| dup_protect | Protected受領。lane,award=0 | .45 / 1.4 | RapidFire有効なら待たず次発射可 |
| roulette | Reset受領。result=resetChoice(0..3),removed=[口],removedCount,k,n_from | 1灯=ResetEffectSecondsSingle(既定.5)、他=ResetEffectSeconds(既定1.4) / 5.0 | ClockStopOnReset=trueなら規則時計停止。Protectedには適用しない。resultは選択肢番号、kは実数 |
| ascend | 現行針停止1.1秒後。rouletteと同じdata | 独立ロックなし / 3.8 | 1灯時は針なしで即通知。仕様の5秒待ちは適用しない |
| challenge_declare | challenge操作成功でarmed=true。award | なし / 1.6 | 1〜5灯で既存規則が許可。6灯自動宣言はlamp6で表す |
| challenge_cancel | challenge操作成功でarmed=false。award | なし / 規定なし | 追加イベント |
| challenge_flight | 勝負球の物理launch直後。shotId,pockets(勝負前) | 飛行終了まで / 0 | 自動6灯を含む |
| success_small | Win受領、勝負前1〜3灯。lane,award | winSeconds=1.32 / 3.8 | 既存presenterの表示は.22秒後。通知は確定時 |
| success_big | Win受領、勝負前4〜5灯。lane,award | 12玉=2.12、30玉=2.82 / 7.0 | 入力ロック維持 |
| fail | Miss受領。lane,award=0 | 1.35 / 2.6 | 判定不能Faultは返球・故障であり失敗演出に偽装しない |
| jp | 6灯Win受領。payout,tier(抽選index)、receipt情報 | JackpotEffectSeconds[index]、省略時40玉以上=6.62 / 20(配当別14〜28) | ClockStopOnJackpot=trueかつreceipt.jackpot>=0なら規則時計停止。JPロック維持 |
| tray_overflow | 各物理overflow。元イベント情報,balls | なし / 2.0 | 自然溢れと安全弁をvalveで区別。まとめ表示は購読者側 |
| warn10 | プレイ中に残り<=10秒となった最初のtick | なし / 10 | 1回。追加で時間増加したら再武装。残り3玉版は未実装 |
| timeup | advanceでContinueに入った時。reason=endReason,duration | ContinueSeconds=10 / 10 | 最後の着地・結果の規則Effect終了後のみ。玉切れ/時間切れをreasonで区別 |
| add100 | add操作成功直後。balls,seconds,duration | loanSeconds=1.87 / 4.0 | 灯と財布を維持。追加は一度 |
| finish_count | Resultフェーズへの入口。reason,balls | 物理計数終了まで / 6.0 | 継続辞退/期限、追加後の2回目は直接ここへ |
| result | 物理count_done後。prizeRank,balls,counted | 独立ロックなし / 9.0 | 規則Result入口とは区別。ゼロ財布も計数完了後に一度 |

各イベントは確定値を保持する。次球がreceiptを更新しても、購読済みのlamp*や
roulette/ascendデータは失われない。演出のtracks/devices実行や素材ロードは演出モジュール側。
初期attractを受けたい場合はbusを先に作り購読してからcreateRuntimeへ渡す。

```js
const off = window.__effects.on('lamp4', ({ t, state, data }) => {
  // state.pockets: 点灯口、data.lane: 今入った口、data.award: 次の勝負配当
  effectsModule.play('lamp4', { t, ...state, ...data });
});
// off(); // 画面/モジュールを片付ける時
window.__effects.on('*', event => recorder.push(event));
```

自動通知は仕様25種のうち24種とchallenge_cancelに対応する。titleだけは検出元が無く手動。
attractは既存Attractフェーズの通知のみであり、待機動画そのものは作らない。
cupの規則resolve直後に通知し、次tickのPresenter receiptはidで二重配送を防ぐ。
灯数・財布は通知時点の確定状態。JP/成功のstateは規則どおり消灯後で、勝負前はdata.before。
途中で故障した球にはlamp/failを発行せず、既存のFault表示と記録へ渡す。

## 検証

以下は順番に実行する。GPU/ブラウザは使わない。

```sh
nice -n 10 node --v8-pool-size=1 work/game_demo/play/effects_test.mjs
nice -n 10 node --v8-pool-size=1 work/game_demo/play/effects_play_test.mjs
nice -n 10 node --v8-pool-size=1 work/game_demo/rules/test_rules.mjs
nice -n 10 node --v8-pool-size=1 work/game_demo/rules/test_rapid_fire.mjs
nice -n 10 node --v8-pool-size=1 work/game_tuning/econ/test_econ.mjs
nice -n 10 node --v8-pool-size=1 work/game_tuning/econ/test_rapid_fire.mjs
```

effects_testは規則コアへ明示的な口を渡すfixture（物理測定ではない）。全26種を発行し、
購読者例外の分離、payload不変、初回フラグ、1押し1発/キーrepeat無視、連射中のreceipt、
消灯抽選、最後の玉/時間切れ/追加後の直結/10秒再武装/計数順序を検査する。

effects_play_testは本番と同じruntimeと実Rapierで、着地口を指定せず追加まで通す。
[種類別回数と全順序の記録](out/effects_test.json)。seed=3、4灯で勝負する押下方策では
falseで25種中19種、trueで18種（それぞれ48球）。希少なlamp5/6・JP、早期勝負の
success_small、玉切れで未到達のwarn10、手動titleはこの自然プレイでは発生しない。
tray_overflowはfalseで2回、trueでは0回。challenge_cancelは専用fixtureのみ。
launch→灯/保護/消灯/勝負結果が各1回、同時飛行なし、finish_count→物理count_done→result、
台帳差0、判定不能0、物理計数=規則財布をassertする。26種すべてを自然入賞で観測したという意味ではない。

既存rulesは374,613件、econは4,836件がPASS。既存600秒統合試験も台帳差0・判定不能0、
618玉計数と同tick再生が一致。設定読み込み試験もPASS。ブラウザ画面での新しい演出素材の
目視確認は今回の対象に含めず、バス利用側の素材統合後に実施する。

## 玉を皿へ注ぐ（演出から呼べる）

玉の付与（チケット購入の貸し玉・勝負成功・JP）は、規則側が持ち玉を先に増やし、物理が払出口から皿へ玉を1球ずつ落とします。
演出は「いつ・どの速さで注ぐか」を指揮できます（玉の数は規則の持ち玉と常に一致。右上の7セグは皿に着いた分だけ増える）。

```js
const P = window.__play;                 // 演出側が受け取る口(runtime と同じ関数)
P.setAwardHold(true, 4);                 // true: 付与された玉を、演出が注ぐまで保留(最大4秒で自動的に残りを払出)。false: 従来どおり即払出
P.trayStatus();                          // {pending, queued, releasable, hold}  pending=付与済みで未払の玉数
P.awardToTray(count, { rate, origin });  // count玉を払出口から注ぐ。rate=玉/秒(2〜40、省略=自然な払出)。実際に注いだ数を返す
P.releaseAwards({ rate });               // 保留中の残りを全部注ぐ
```

- 数をカウントアップする演出に合わせて分割して呼べる（例: JP 600玉を、数字が増える間に `awardToTray(40,{rate:30})` を繰り返す）。
- 付与済みの玉以上は注がない(戻り値で確認)。保留は Result/Continue に入るか maxHold 秒で自動解除（玉が皿に届かないまま計数に進むことはない）。
- 皿が満杯(DISH_CAP)の間は自動で収納へ落ち、物理の性能は保たれる。`origin` は現状ラベルのみ(イベント `tray_award` で presenter.on から観測可)。
- 保留しない既定では、従来どおり決着の演出の直後に自動で払出され、速さは賞玉に応じた既定値（最大約25玉/秒）。

## 「惜しい」と「あと○玉」（実測に基づく付加情報）

- `fail`（勝負の失敗）に `unlit`(灯のなかった口)・`near_miss`(R-22: 玉が灯のない口の入口線を内向きに通過してから仕切りの上端を跨いで別の口へ落ちた時だけ true)・`target`(その灯のない口、near_miss時のみ)・`gap`(口番号の差) を追加。物理イベントに基づく値で、偽の惜しいは作らない。画面全体の「惜しい!」は出さず、その口に波紋1回(約0.4秒、音なし)が研究の推奨。near_miss===false の外れは淡く短く終える。頻度の目標は全勝負球の25〜35%（現行盤での実測はsolが測定中）。
- `finish_count` と `result` に `rankIndex`(0..5)・`next_rank`(次の景品index/最上位ならnull)・`to_next`(次の景品まであと何玉)・`next_threshold` を追加。「あと○玉でA賞」を実数で出せる。

