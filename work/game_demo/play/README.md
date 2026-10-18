# 通しプレイ

**遊ぶだけなら**（プロジェクトルートで）:

```sh
./work/game_demo/play/start.sh
```

表示されるURL（既定 `http://127.0.0.1:8800/game_demo/play/index.html`）を開き、音の開始ボタンを押す。引数なしで本番構成（`work/game_tuning/proto/config.json` の盤・規則 ＋ stage2aの筐体環境）で開く。上書きは `?config=<パス>`、`?pack=<manifest>`（空文字で既定を無効＝従来のstage3・ダミー環境）。ルール説明は `?howto=0` で無効。

詳細:

プロジェクトルートから:

```sh
nice -n 10 node work/game_demo/play/serve.mjs 8792
```

`http://127.0.0.1:8792/game_demo/play/index.html?config=work/game_tuning/proto/config.json`を開く。音を有効にするボタンを押す。

Space / ESP32左ボタン: 開始・発射、ESP32右ボタン: 遊技中は挑戦・時間切れ画面では100円追加、C: 挑戦、A: 100円追加、B: 計数（もう一度Bで確定）、計数後R: 次のプレイ、F: 全画面、D: 設定表示の出し入れ（既定は非表示）。開始画面と画面内の「発射」「CHALLENGE」等もクリック／タップで操作できる。

## 本番モニタの表示切り替え

**K** を押すたびに **0 通常 → 1 縦置き（時計回り90°）→ 2 縦置き反転（270°）→ 0**。
Windows の解像度は横長の **2560×1440** のまま、モニタを物理的に縦置きにする。状態1・2では ESP32・音量/BGM・クレジット・デバッグ・全画面/音開始ボタンを隠し、Fullscreen API で全画面にする。状態0では元の UI の表示条件と盤の配置へ戻し、全画面を解除する。D で非表示にした情報等は、その設定を保つ。入力欄編集中・修飾キー併用・キーの長押しでは切り替えない。

表示状態は `localStorage` の `pachikoma.display` に保存する。URL の `?display=normal` / `?display=portrait` / `?display=portrait-flip` は保存値より優先し、その状態も保存する。再読み込み後は最初のキー入力（Esc以外）またはクリック/タップで全画面に戻る。ブラウザが全画面を許可しない場合も回転は有効で、次の操作で再試行する。Escで全画面を抜けても回転状態は保つ。

回転は `#stage` の CSS transform のみ。canvas の内部解像度 **1440×2560**、描画ループは変えない。2560×1440・DPR 1 の状態1・2では等倍で画面を埋める。それ以外の縦横比では盤を切らず、余白を付けて収める。チュートリアル・液晶・DOM のゲームボタンも同じ盤と一緒に回る。マウス/タッチ座標を直接使う処理はなし（DOM の `data-action` で判定）。ESP32 は CSS で表示を隠すだけで接続・入力を維持し、既存の自動接続（許可済みポートが1つなら PING で識別）も継続する。

Windows でタスクバーを確実に隠す補助として、通常どおりサーバーを起動したあと、Edge をキオスクで起動できる（URL/ポートはサーバー表示に合わせる）:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --kiosk "http://127.0.0.1:8800/game_demo/play/index.html?display=portrait" --edge-kiosk-type=fullscreen
```

キオスクから終了する場合は Alt+F4。通常の起動手順と K の3状態切り替えも使用できる。

## 調整結果を載せる

`work/game_tuning/proto/config.json`を書き換えてページを再読込する。例は同じ場所の`config.example.json`（mix_n75_10、釘81本）。設定を指定しないURLも従来どおり動く。

```json
{
  "name": "ディレクター確認用",
  "stageDir": "work/game_tuning/lab/variants/mix_n75_10",
  "jitter": { "x_mm": 3, "vx_pct": 15, "vy_pct": 0 },
  "rules": "docs/handoff/reference/rules/medal_game.json",
  "seed": 1201201
}
```

省略時はstage3・揺らぎ0・`work/game_demo/rules/medal_game.json`。`{}`でもよい。`seed: null`または省略は従来のseed=1、整数は再現用固定seed（`?seed=`併記時はそちらが優先）。`name`はDで出る表示名。盤は`model3.json`と`layout3.json`の両方を含むディレクトリを指定する。

`?config=`はURL、`work/`始まりのプロジェクト相対パス、またはページ相対パス（例`../../game_tuning/proto/config.json`）を受け取る。設定内の`stageDir`と`rules`は`work/`・`docs/`始まりならプロジェクトルート基準、それ以外（例`./board`）は設定JSONのURL基準。外部URLは配信元のCORS許可が必要。付属サーバーは`work/`に加え規則正本の`docs/`も配信する。

揺らぎは独立正規分布の標準偏差。xはmm、vx/vyは速度に対する%。Box–Muller、seed XOR `0xa5a5f00d`の独立LCG32を用い、打切り・端点clampはしない。0の成分は乱数を消費しない。規則validate失敗はパスと理由を画面・コンソールへ表示し、プレイを開始しない。

各開始時の`physics_config`記録に設定URL・名前・実効seed・規則値・盤model/layout・釘数・揺らぎ値を保存し、各発射には`launchDelta`（x=m、v/y=速度比）を記録する。光層は従来のダミーのまま。

Nodeで同じ設定を通す場合（プロジェクトルートから、configはファイルパス／file URL）:

```sh
nice -n 10 node work/game_demo/physics/play_test.mjs
nice -n 10 node work/game_demo/physics/play_test.mjs --config work/game_tuning/proto/config.example.json
nice -n 10 node work/game_demo/physics/jitter_test.mjs
nice -n 10 node work/game_demo/play/config_test.mjs
python3 tools/gpu_run.py cabinet proto-config-manual 2 -- env PLAY_CONFIG=work/game_tuning/proto/config.example.json nice -n 10 node work/game_demo/play/qa.mjs /tmp/proto-config-manual 30
```

`play_test.mjs [秒=60] [seed] --config <パス>`。`PLAY_CONFIG`環境変数でも指定可能。QAのmanualは既存タップ操作・D表示・設定記録・規則エラー表示も確認する。

backingは1440×2560、DPR=1固定。縦横比を保って窓へ収める。隠れたタブは停止、50 msを超えた時間は規則・物理・演出の時計を一緒に停止して記録する。物理は480Hz、空間倍率10。

## 確認

同梱Chromiumを使う。`playwright install`は不要。

```sh
node work/game_demo/physics/integration_test.mjs
node work/game_demo/play/lighting_test.mjs
node work/game_demo/ui/session_log_test.mjs
python3 tools/gpu_run.py cabinet sol44-manual 2 -- node work/game_demo/play/qa.mjs /tmp/sol44-manual 30
python3 tools/gpu_run.py cabinet sol44-10min 2 -- env SCENARIO=realtime node work/game_demo/play/qa.mjs /tmp/sol44-10min 600
python3 tools/gpu_run.py cabinet sol44-jp600 2 -- env SCENARIO=jp node work/game_demo/play/qa.mjs /tmp/sol44-jp600 90
python3 tools/gpu_run.py cabinet sol44-pack 2 -- env SCENARIO=pack PACK_URL=./fixtures/dummy_pack/manifest.json node work/game_demo/play/qa.mjs /tmp/sol44-pack 2
```

QAは自身のHTTPサーバーを空きポートで起動し、終了時に停止する。1440×2560のヘッドレス全画面。manualは時間を明示的に進めた計測でfpsではない。realtimeはrAFを10分運転し、UI・音・HTTP記録を有効にする。JPは六灯のみを初期状態として設定し、着地はRapier、600の抽選は規則seed=43で進める。通常の来場者プレイで600が発生した確率の測定ではない。
`CPU_RENDER=1`はSwiftShaderで機能のみ確認する（GPU性能の測定には使わない）。`CHROMIUM_PATH`で既存のChromium実行ファイルを指定できる。

## 光層との接続（web/は変更しない）

`?pack=<ディレクトリまたはmanifest.jsonのURL>`を指定する。既存`web/src/layer_loader.mjs`のversion=1形式を読み、`image_size=[1440,2560]`とlinear Rec.709を要求する。
背景/プローブの係数は同じ`LightingDriver.frame()`の`{tick,time,ea,eb,q}`を`hr.setLightingFrame()`へ渡す。A/Bマスクも同じea/ebを使う。

環境のレコード名は`A_back,B_back,M0_back,M1_back,A_front,B_front,M0_front,M1_front,tau,occ`。欠けた環境レコードはダミーを保持し、`window.__play.pack`へ読込済みの名前を出す。occは球のview depthと比較するメートル値、素材の行0は上。遮蔽深度と透過tauは別に渡す。

manifestの追加フィールド:

```json
{
  "lighting": { "sources": {
    "source-id": { "lamp": 1, "receiver": "p1", "weight": 1, "rgb": [1, 0.8, 0.5], "gate_at4": 1 }
  }},
  "probes": {
    "file": "probes.f16.gz", "encoding": "gzip",
    "width": 396, "height": 858, "layers": 17,
    "source_ids": ["source-id"], "linear_space": "linear Rec.709"
  }
}
```

rgbは線形値。未割当のsource_idは点灯せず`unmapped`へ出す。ダミーだけ番号順に7灯を割り当てる。LEDは0.15秒後から0.5秒の二乗立上げ/逆遷移、環境は0.5秒の対数補間。モード利得はbase=1、reach=1.1、challenge=1.2、final=1.3（接続用の暫定値）。実基底の最終演出係数は別途確定する。

probeデータはlittle-endian RGBA16F、先に環境16層（各receiver A,Bの順）、その後source_ids順。1層396×858は6面×13点、各面64²+1 texelの縁。プローブatlasの行はWebGLテクスチャの行順で保存し、画像の上下反転を追加しない。sourceIdsは背景と同一IDを使う。既存ProbeSetが同一LightingFrameで線形合成し、玉は区域内の近い3点を補間する。`probes`が無ければダミーのまま。128²の鋭い追加基底や実基底の生成処理は含まない。

`python3 work/game_demo/play/make_fixture.py`でダミーfixtureを再生成できる。正式なカメラ/形状hashの照合や実基底の画質検査を代替するものではない。

## 記録と残件

物理イベントは`{tick,seq,ball_id,type,part_id}`付きでSessionLogへ保存する。初期seed/乱数状態・Rapier版・皿形状hashも記録する。サーバーの保存先は`ui/logs/YYYYMMDD.jsonl`。
`ISSUES.md`に、溢れ穴と払出口の数値、段間の座標差、取込/戻りの代用、計数の強制収納、実基底と描画補間の未実装部分を記載した。

## sol49 段間変換

`work/assembly/cfg/stage_transforms.json`がlocal→assembly変換の唯一の設定。Nodeはファイル、ブラウザは同じURLをfetchするため、配信時には`assembly/cfg/`も必要（既存serve.mjsはwork全体を配信）。mmの平行移動とXYZ Euler(rad)を使う。stage1の移動はparts.jsonのTRAY_UNITへ追加せず置換する。

物理世界は各段の軸で計算し、snapshotの盤・戻り・皿・昇降・シャトルをassembly座標mへ変換する。stage2から盤への射出位置・速度もstage3軸へ変換する。`connectAssemblyBalls(hr, pa.transforms)`がframe/revisionを検査して描画へ渡す。`physics_config`には変換JSON全体を保存する。段間の残差はconnectionsに残し、物理接続を実装済みとは扱わない。

```sh
python3 work/assembly/src/check_stage_transforms.py
node work/game_demo/physics/stage_transforms_test.mjs
node work/game_demo/physics/play_test.mjs 240 3
node work/game_demo/physics/integration_test.mjs
```

記録は`play/out/sol49_stage_transforms.json`。5種の座標・非ゼロ回転/移動・根変換の置換・描画の二重変換防止を確認した。600秒通しで台帳差0、lost 0、618玉計数一致。同じ入力を使う変更前コードと変更後コードの3行の試験結果が一致。今回のBlender描画・Chromium目視は未実施。
