# 物理の専用 Worker（`?physworker=1`）

遊技画面（`play/index.html`）の玉の物理（Rapier、盤 480Hz・皿 240Hz）を主スレッドから専用の Web Worker に移す試験モード。
URL に `physworker=1` を付けたときだけ有効。付けないときは従来どおり主スレッドで `PhysicsAdapter` を直接使う（`play/play.mjs` の分岐 1 か所のみ）。

- `physics_worker.mjs` … Worker 本体。中で本物の `PhysicsAdapter`（adapter.mjs、物理・規則・乱数・Hz は一切変えない）を作り、主スレッドから届いた呼び出し列を届いた順にそのまま再生する。音の接触監視（`audio/runtime/contact_observer.mjs`）も Worker の中で本物の world に掛ける。
- `worker_equiv_test.mjs` / `fake_worker_env.mjs` … Node で直接の adapter と代理の結果が一致するかを見る試験（擬似 Worker）。
- `physics_proxy.mjs` … 主スレッド側の代理 `PhysicsWorkerProxy`。`PhysicsAdapter` と同じ名前のメソッド・値を持つので、`runtime.mjs`・`tray_visual.mjs`・`m3_cabinet.mjs`・音（`connect_audio.mjs`）などの呼び出し側は変更なし。

## 仕組み（時間の扱い）

1. 主スレッドは今までどおり 1/480 秒ごとに `pa.setAim / payout / startCount / launch …` と `pa.step()` を呼ぶ。代理はそれを **呼ばれた順のまま** `['A',aim,dir] ['P',n,…] ['S',g] …` の列に積み、フレームの終わり（マイクロタスク）に 1 回 `postMessage` する（1 フレーム 1〜2 通）。
2. Worker は列を順に本物の adapter に流す。`S` ごとに `step()` → `drainEvents()`、その step の台帳（ledger・skipPayout・pendingLaunch 数・乱数状態など 19 個の数）を Float64Array の 1 行に記録。バッチの終わりに描画用の snapshot（玉の位置・種別・id、シャトル、フラップ、払出筒の中の玉）を作り、全部を transferable で返す。
3. 主スレッドは返事を受け取ると記録を溜め、次のフレームの `step()` ごとに **「直前のバッチの step 数」だけ遅らせて 1 step ずつ** 見せる（出来事のフレーム内の間隔を保つ）。見せた step の出来事を `drainEvents()` で 1 回ずつ順に返し、その step の接触を主スレッドの音の監視に再生する。
4. 物理の入力列は直接呼んだ場合と同じなので、同じ入力列（tick つき）なら Worker でも同じ結果になる。ずれるのは「規則が出来事を受け取る時刻」が約 1 フレーム遅れることだけ。

SharedArrayBuffer は使っていない（`play/serve.mjs` は COOP/COEP を出しておらず cross-origin isolated ではない）。返事は transferable（記録の Float64Array・位置・種別）＋構造化複製（出来事・接触・小さな物）。

## 各値の扱い

| 主スレッドでの使い方 | 扱い |
|---|---|
| `setAim` `launch` `payout`（m3 の速さ下限の包みも代理を包む） `startCount` `reserveForLoan` `beginGame` `reset` `setInput` `step` `advance` | Worker へ転送（呼ばれた順・step との前後関係もそのまま） |
| `drainEvents()`（cup / lost / peg / launch / returned / tray_ball / overflow / tray_lost / count / count_done / feed / reserve_return / stuck_nudge …） | Worker の各 step の出来事を、その step を見せるときに 1 回ずつ順に返す |
| `ledger()` `pendingPhysical()` `skipPayout` `payQueue` `pendingLaunch.length` `stock` `shuttleHas` | 見せた step の記録 ＋ まだ見せていない自分の呼び出し（launch / payout / reserveForLoan / beginGame / reset）の台帳への効果を予測で足す。台帳差（maxLedgerDrift）が 0 のまま、7 セグの持ち玉も 1 フレームのちらつきが出ない |
| `snapshot()`（位置・種別・id・シャトル・mech） | 最新のバッチの終わりの snapshot（1 フレーム遅れ）。`ledger` だけは予測値。`lagSteps` を追加 |
| `tick` `t` | 主スレッドで同じ規則で数える（step で +1、beginGame/reset で 0）。接触の再生中だけ `t` はその step の時刻 |
| `s`（乱数状態） `shots` `board.nudges` | 見せた step の記録の値 |
| `tray.activePayout`、`tray.activeBalls.get(id)`（払出筒の中の玉の `state` と `prev`）、`tray.mechBodies.get(id).body.translation()/rotation()`、`.value` | snapshot ごとに写す（`tray_visual.mjs` と m3 の口の手前の表示用） |
| `tray.payoutExited` | 皿の step を再生するときにその step の値を入れる（音の払出の数え） |
| `transforms`（StageTransforms）、`connections` `muzzle` `maxBalls` `seed` `stageDir` `jitter` `R.version()` `stock0`、`tray.S/T/hash/floorMesh/visualStatics/visualMechs/payoutStart`、`board.model/layout/launcher` | 初期化時に 1 回だけ写す読み取り専用の値 |
| `playConfig` | play.mjs が代理に直接書く（従来どおり） |

### 主スレッドで直接 Rapier の world に触っていた所（作り直したもの）

- **音の接触監視** `observeContacts(pa, …)`（`pa.bw` `pa.tw` `pa.board` `pa.tray` の world.step を巻き、`contactPairsWith` / `contactPair` で接触を読む）。
  本物の監視は Worker の中で本物の world に掛ける（主スレッドで監視が付いたのを代理が見つけたら `['O']` を送る）。主スレッドの `pa.bw` `pa.tw` は `step` だけの空の world で、接触 1 件ごとに「監視が同じ値を計算し直すだけ」の偽の物体・接触多様体を作って監視の包みを通す。音のエンジンに届く接触（t / region / material / speed / impulse / x / a / b / variant）と払出の数え（onPayout）は直接の場合と一致（下の検証）。`connect_audio.mjs` と `contact_observer.mjs` は変更なし。
- **皿の描画** `tray_visual.mjs`（`tray.floorMesh` などの形は初期化時の写し、フラップは snapshot ごとの写し）。
- **m3 の払出口の表示**（`tray.activeBalls.get(id).state/prev`）。

### 代理では使えないもの（道具だけ）

- `window.__play.tick(秒)` のように主スレッドを止めたまま何秒も進める使い方。Worker の返事を受け取れないので、その間は出来事が届かない（返事は次のタスクで届く）。録画（`m3/play_m3.mjs`）・`qa.mjs`・`capture.mjs` などの決定的な道具は既定（Worker なし）で使う。
- `pa.board.balls` `pa.st` などの中身を直接読む道具（`m3/jam_clip.mjs`、`qa.mjs`、`render_r2/followup_review.mjs`、`m3/probe_payout.mjs`）。

## 検証

### Node（擬似 Worker、同じプロセス内で構造化複製・非同期配送）

- 固定の呼び出し列（貸し 15、払出 40/25/30、0.6 秒ごとの発射、計数、reset → beginGame → 発射・払出、43,200 step、seed 43、本番の n81 盤・RAPID_SUPPLY・pscale 0.35）を直接の adapter と代理で比べた：
  出来事 717 件が完全一致（seq・tick 含む）、各 step の台帳・skipPayout・pendingLaunch 43,200 step 全一致、主スレッドの監視が受け取る接触 2,749 件一致（盤の釘・樹脂・玉どうし、皿の樹脂・玉どうし・フラップ全種）、払出の数え 107 回一致。既定の stage3 / seed 3 でも同様に一致。
- 規則＋presenter＋runtime を代理で通し（`effects_play_test.mjs` と同じ打ち方、通常・RapidFire）：Result まで進み、計数＝財布、台帳差 0、lost 0。物理は混沌系なので 1 フレームの遅れで打つ時刻がずれ、入賞の並びは直接の場合と変わる（遊技としては同じ流れ）。

再現: `node work/game_demo/physics/worker/worker_equiv_test.mjs`（約 40 秒、擬似 Worker は `fake_worker_env.mjs`）。

### ブラウザ（`perf/perf_run.mjs`、`?cabinet=m3&nofx`、seed 43、自動の打ち手、開発機 Ryzen 9950X3D + RTX 5090、2026-10-23）

1 フレームあたりの主スレッドの時間（ms、mean / p50 / p95 / p99）。「物理」は perf_run が包む `pa.step` の合計＝Worker 時は代理の手間（記録・出来事の受け渡し・接触の再生と音の監視）。Chrome の時計は 0.1ms 刻み。

| | 物理（主スレッド） | advance（規則＋物理） | JS 合計/フレーム | rAF 間隔 p95 / >33ms | 60 秒のフレーム数 | 長タスク |
|---|---|---|---|---|---|---|
| 従来 CPU×1 | 2.37 / 2.7 / 5.6 / 7.1 | 2.42 / 2.7 / 5.8 / 7.2 | 2.98 / 3.1 / 6.4 / 8.3 | 16.7 / 0 | 3600 | 0 |
| Worker CPU×1 | 0.05 / 0.0 / 0.2 / 0.2 | 0.11 / 0.1 / 0.2 / 0.5 | 0.66 / 0.6 / 1.3 / 2.5 | 16.7 / 0 | 3600 | 0 |
| 従来 CPU×4 | 13.1 / 1.7 / 66.8 / 82.6 | 13.5 / 1.8 / 67.8 / 83.8 | 16.0 / 4.4 / 71.7 / 87.0 | 83.3 / 421 | 2165 | 354 |
| Worker CPU×4 | 0.16 / 0.1 / 0.7 / 1.0 | 0.31 / 0.1 / 1.0 / 2.1 | 2.23 / 2.0 / 4.4 / 7.2 | 16.7 / 3 | 3586 | 0 |

- 従来の CPU×4 は、重い step で 1 フレームが 50ms を超える→次のフレームで 24 step まとめて進める、の悪循環に入り 60fps を保てない（60 秒で 2165 フレーム）。Worker では主スレッドから物理が消えるので 60fps のまま。
- Worker 側のバッチ時間（1 フレーム分、接触監視込み）: CPU×1 で p50 1.2 / p95 5.7 / p99 7.1ms（170 秒の通しで 1.6 / 5.2 / 6.8）。**CDP の CPU_THROTTLE は Worker を遅くしない**（×4 でも p50 1.3 / p95 7.7）ので、×4 の表は「主スレッドだけ遅い機種」の模擬。Surface で Worker のコアが 2〜3 倍遅いと p95 で 11〜17ms、p99 で 14〜21ms の見込み。平均（約 4ms/16.7ms）は追い付くが、重いフレームでは遅れ（lagSteps）が一時的に伸びる（主スレッドは止まらない）。
- 受信処理（onmessage、`perf_run` の区間外）: p95 0.1ms、最大 2〜5ms。
- 通し 170 秒（CPU×1 Worker / 従来、CPU×4 Worker）: どれも 1 回の遊技が Result→計数→次の遊技まで進み、ページの例外 0、台帳差 0、lost 0。入賞数（cup 0〜7）は Worker ×1 `[0,7,13,10,1,17,5,18]`、従来 `[0,6,19,16,1,9,9,14]`（打つ時刻のずれによる違い）。
- 注意: 計測時は /tmp（tmpfs）が 80% 埋まっており、Chromium の一時プロファイルが /tmp だと m3 の読み込みが `ERR_INSUFFICIENT_RESOURCES` で失敗した（従来モードでも同じ）。`TMPDIR` をディスク上に向けて計測した。

## 既知の違い・注意

- 規則が出来事（入賞・皿着・計数）を受け取るのが約 1 フレーム（60Hz で 8 step ≒ 17ms）遅れる。描画される玉の位置も同じだけ遅れるので、見た目と出来事は揃っている。発射の入力→玉が出るまでも 1 フレーム遅れる。
- そのため同じ seed・同じ人の操作でも、直接の場合と打つ瞬間が 1 フレームずれて結果は変わる。Worker の中の物理は「届いた入力列」に対して決定的（入力は tick 順に並ぶ）。
- `reserveForLoan` の戻り値と、届く前の台帳は予測（物理で決まる変化、例えば補充・着地は Worker の記録が届いた時点で反映）。
- ログの `physics_config.rng_state`（`pa.s`）は見せた step の値（約 1 フレーム前）。
- Worker が実時間より遅れ続けると遅れ（`pa.workerStats.maxLagSteps`）が伸びる（主スレッドは待たない）。通常は 1 フレーム分＋数 step。
- 診断値は `window.__play.pa.workerStats`（バッチ数、Worker 側のバッチ時間 workerMs[]、主スレッドの受信処理 msgMs[]、最大遅れ）。
