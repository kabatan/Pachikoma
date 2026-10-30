# JPチャンス・配当ルーレット・JP成功の迫力の底上げ(10/31)

## 目的(監督)
通常時の音は今のままで良い。JPチャンスと、JP成功後の配当ルーレットが地味。**通常時 << JPチャンス < JP成功**。脳に響く音を大音量で。声は入れない。

## 仕組み(`work/audio/runtime/audio_lift_1031.mjs`、`?audiolift=0` で読み込まない=従来どおり)
1. **経路**: JP系の音(jp_audio_v5・after_jp・r4_sfx)が入る専用出口 `hot`(圧縮機の後)を `master` から外し、
   `hot → 段の増幅(tierGain) →[素通し | 絞り(-12dB)→低域+2.5dB(110Hz)→2.6kHz+1.5dB→リミッター→経路利得を打ち消す→上乗せ]→ master` に挟む。
   - **通常時(段0)は素通し**(リミッターを通らない)。通常の音(玉・釘・点灯・通常BGM)の経路には一切触らない。
   - 段: 0=通常、1=JPメーター中(meterReady〜)、2=ルーレット(rouletteStart〜)、3=JP成功(rouletteStopped〜約10〜12秒)。
   - 段の増幅[dB]: 0 / +1 / +3 / +8。リミッターの後の上乗せ: 0 / 0 / +1 / +1.5(最後の天井 tanh 0.8 の手前いっぱいまで使って平均を上げる)。
   - リミッターの小信号利得は起動時に OfflineAudioContext で測って打ち消す(Chrome の自動メイクアップの違いに依存しない)。
2. **新しい音**(全部合成 `synth_lift.py`。実機の帯域配分に match_eq で寄せた。`REFERENCE.md`):
   - JPチャンス: 低い唸り `al_drone`(時間が減る/入るほど音量・ピッチ・明るさが上がる。甲高い常時層ではない)、脈動 `al_pulse1/2`(1.1秒間隔→0.36秒間隔)、残り約3.6秒でライザー `al_riser`、
     入賞ごとの衝撃 `al_hit_1..4`(満タンに近いほど重く厚く)、鎖が切れる時の爆発 `al_break`(b1,b2…)/`al_break_big`(最後)、扉が開く時の最大の衝撃 `al_door`。
   - 配当ルーレット: 回転中のドラムロール `al_roll`(自動停止へ向けて強く速く)、ボタンを叩く衝撃 `al_press`、配当の段(30/40/100/200/500)ごとの昇格音 `al_promo_0..4`。
   - JP成功: `al_win_first`(最初のJP)/`al_win_chain`(継続成功。A=D+5度)。衝撃+ブラスのファンファーレ+ティンパニ+金属の雨。8秒。
3. **ダッキング**: 衝撃の瞬間に JP曲(または通常BGM)を `bgm.userGain` 経由で沈める(JP中は jp_audio_v5 が JP曲側へ振り替える既存の仕組み)。入賞 -3〜-7dB/0.2〜0.4秒、ボタン -6dB/1.1秒、成功 -10dB/1.6秒。
4. 状態は `controller.onAction`(meterReady/Start/Land/End, rouletteStart/StopPress/Stopped)・`controller.game.meter/roulette`・`lcd.jp.where()` を読むだけ。規則・液晶は変更しない。

## 触っていないもの
通常時の音、jp_audio_v5.mjs、jp_start_1031(雷・ダッキング)、r4_sfx、after_jp。`engine.hot` の出口を付け替えるだけ(`hot.gain` へのほかの担当の操作はそのまま効く)。雷は master 入口へ直接なので影響なし。

## 測定の道具(再現)
`scratch_1031/audiolift/`: `lab.mjs`(常駐の実験台。ゲームを1度読み、cmd/*.js をページ内で実行。最終段 ceiling を AudioWorklet で常時録音)、`flow.js`(通常→6灯→JP→ルーレット→確定を自動で遊ぶ)、`loud.py`(BS.1770 LUFS)、`an.py`/`build_prev.py`(区間の統計・試聴 mp3)。
