> 第1段の資料です。統括からこのpatchの適用・`?audio=r2`起動確認済みの連絡を受けています。第2段は [INTEGRATION_ROUND2.md](INTEGRATION_ROUND2.md) を参照してください。

# 統括向け接続メモ

本体へは未適用。`INTEGRATION.patch` は index.html/play.mjs だけの差分。`effects_bus.mjs` は既に必要な28種と購読APIを持つため変更差分0。物理ファイルも直接変更しない。

```sh
git apply --check work/audio/runtime/INTEGRATION.patch
# 統括が差分レビュー後に適用
git apply work/audio/runtime/INTEGRATION.patch
```

適用後、`http://127.0.0.1:8800/game_demo/play/index.html?audio=r2` で試作を選択。通常URLは既存音響。失敗時はconsoleの `[r2-audio]` に理由が出る。準備は最初のruntimeイベントより前に終え、音はユーザー操作で再開。旧presenterの音響を外し、attachInputの解除口を新エンジンに向けて二重発音を避ける。右上に音量、初期45%。`?quiet` に自動連動はしていない（試作の音量スライダーを使う）。

別のホストから接続する最小形:

```js
import { connectAudio } from '../../audio/runtime/connect_audio.mjs';
const audio = await connectAudio({ pa, bus: effects, master: .45 });
// createRuntimeへeffectsを渡す前に購読。paの盤と皿はinit済みであること。
// 片付け
audio.dispose();
```

`audio.engine.handleEvent({id,state,data})`、`audio.engine.contact({region,material,speed,impulse,x,variant})` が独立入口。speedはm/s、impulseはNs。素材名はbrass/steel/resin/metal。音声素材を取得・実装するまでは声は鳴らない。`bgmInput` は将来のBGMを同じAudioContext内で接続する入口で、現在BGMは無音。別contextのAudioNodeは接続できないので、BGM担当にはengine.ctxを共有してもらう。

`audio.observer.metrics` は観測オーバーヘッド、`engine.stats` は発音/集約/脱落/最大発音数、`engine.analyser` は出力監視。`window.__r2Audio` から参照可。タブを隠すとループを止めcontextをsuspend、次の操作で再開。隠す前のループの状態復帰はしない。Faultでは毎フレーム全停止する差分を含む。

パッチ基準は `patch_baseline.json`。並行編集でcheckが失敗した場合、共有ファイルを巻き戻さず差分を手で合わせる。`qa/make_integration_patch.py` は現在ファイルから同じ変更の差分を再生成するための補助で、本体には書かない。

制限: `git apply --check` と独立試聴/実WebAudio/実Rapier検査まで。ゲーム本体への適用・ゲーム画面での通し確認は未実施。特に、既存の規則バスascend(早い通知)と液晶内部の昇天(後の通知)の時間差は未解決。試作はバス通知に従うため、ルーレットSEが液晶より早く止まる可能性がある。統括と演出担当が実際の映像cueへ接続するときに調整する。重複ルーレット映像や規則の尺はこの担当では変更しない。
