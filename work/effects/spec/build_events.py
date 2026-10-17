#!/usr/bin/env python3
"""全イベント演出の台帳。events.json を生成する(唯一の正本)。
設計書(tools/make_design_doc.py)と、実行側(runtime/)が同じ events.json を読む。
trackは「どの機器が・いつ・何をするか」。lane: lcd/petal/edge/logo/pocket/seg/tray/btn/ambient。
pat は runtime/lightbus.mjs の光のパターン名。"""
import json, pathlib

def T(lane, t0, t1, label, pat=None, **p):
    d = {"lane": lane, "t0": t0, "t1": t1, "label": label}
    if pat: d["pat"] = pat
    if p: d["p"] = p
    return d

# 色のパレット(演出の意味と結びつける)
GOLD = "#ffc83a"; PINK = "#ff2f86"; SAKURA = "#ff7fb2"; CRIMSON = "#d0101e"; NAVY = "#1b2a6b"
WHITE = "#ffffff"; RAINBOW = "rainbow"; CYAN = "#46d6ff"

E = []
def ev(**k): E.append(k)

# ───────────────────────── A. 待機〜開始 ─────────────────────────
ev(id="attract", phase="A 待機〜開始", name="客引き(待機デモ)", tier=2, dur=18, loop=True, blocking=False,
   trigger="誰もプレイしていない間、ずっと(ゲーム終了後に次の客が来るまで)",
   feel="遠くから「なんだあれ」で足が止まる。近づいたら『玉を入れるとウパが増える、7つ揃えるとジャックポット』が見ただけで分かる。",
   precedent=[("ホールの客待ちデモ。タイトル動画とランプの派手な点滅を繰り返す(実機の定番)", "recall")],
   tutorial="ルールの予習。①玉が穴に入る→②ランプが灯る→③ウパが増える→④7つでJP、を4秒ずつの絵だけで見せる(文字は最小)。",
   devices=dict(
     lcd="タイトル(6s)→4コマ漫画のようなルール紹介(8s)→JPの虹ウパのチラ見せ(4s)。通常画面の海の背景は常に動かす。",
     petal="上3枚(P1→P2→P4)を順にピンクで走らせ、ときどき全体がパッと咲く(ちかちか華やかに)。",
     edge="虹Bを速め・明るめで周回。",
     logo="ロゴの宝石が約2秒周期でゆっくり脈打つ。",
     seg="持ち玉は『0』を点灯したまま、メーター(C B A S SS)を下から上へ順にスイープして景品の存在を見せる。",
     tray="なし(玉は無い)。",
     btn="なし"),
   tracks=[
     T("lcd",0,6,"タイトル+ウパの群泳"), T("lcd",6,14,"ルール紹介4コマ"), T("lcd",14,18,"JPの虹ウパ チラ見せ"),
     T("petal",0,18,"P1→P2→P4を順に点灯、ときどき全体が咲く","chase",color=SAKURA,targets="top3",speed=.6),
     T("edge",0,18,"桜色の彗星がゆっくり周回(虹はJPと大成功だけ)","comet",color=SAKURA,turns=8),
     T("logo",0,18,"ロゴの脈動","breathe",color=GOLD,period=2),
     T("seg",0,18,"メーターC→SSをスイープ","sweep",targets="meter",period=3)],
   snd=[(0,"attract_loop")],
   status=dict(lcd="todo", light="todo"))

ev(id="title", phase="A 待機〜開始", name="タイトル(ボタン待ち)", tier=2, dur=0, loop=True, blocking=False,
   trigger="お客がボタンに触れた/台の前に立った時から、ボタンが押されるまで",
   feel="「なんか面白そう、やってみたい」。お客をこのゲームの世界に引き込む入口。説明はしない。美しさとワクワクだけ。",
   precedent=[("実機のデモ画面は『大きなロゴ+世界観のキャラ+光る押下の指示』だけ。ルール説明は押した後(10/17 ディレクター指摘)", "verified")],
   tutorial="『ひかっている ボタンを おしてね』だけ(左下の矢印と一緒に)。ルール説明は押した後の『howto』で出す。",
   devices=dict(
     lcd="夜桜の世界にパチコマの大きな金のロゴがドンと出て、7色のウパが海の中を泳いで流れる。下に『ひかっている ボタンを おしてね』(枠なし)。",
     petal="45枚すべてを使う。全体が呼吸するようにピンクに光り、下から上へ光の波が3秒ごとに駆け上がる。",
     edge="ほんのりピンクの土台(虹は使わない)。",
     logo="明滅。", seg="『0』", tray="なし(皿は空)", btn="左ボタンが脈打つ"),
   tracks=[T("lcd",0,3,"ロゴ+ウパのパレード+『ボタンをおしてね』"), T("btn",0,3,"左の矢印が点滅","pulse",side="left"),
           T("petal",0,3,"全体がピンクで呼吸","breathe",color=SAKURA,period=3.0,targets="all"),
           T("petal",0,3,"下から上へ光の波","sweep",color="#ffffff",axis="up",period=3.0,targets="all"),
           T("edge",0,3,"ピンクの土台","baseTint",color=SAKURA,level=.9)],
   snd=[(0,"title_loop")], status=dict(lcd="todo", light="todo"))

ev(id="howto", phase="A 待機〜開始", name="あそびかた(3コマの基本説明)", tier=2, dur=8.0, blocking=True,
   trigger="タイトルでボタンが押された直後。チケットの玉が出る前",
   feel="「玉を穴に入れて灯を増やすんだな。7つでJP。同じ穴だとルーレット」。絵で一息に分かる。ボタンで飛ばせる。",
   precedent=[("実機の『遊び方』画面は、数秒の絵と一文だけで流す(ディレクター10/17: 玉を上から落として増やすゲーム、とだけ伝える)", "verified")],
   tutorial="4コマ(各3〜4秒): ①玉を落として穴に入れる→入った穴が光る ②ちがう穴に入るほど光が増え、7つでJP ③同じ穴に入るとルーレット(ランプが消えることも)。計8.0秒でボタンで飛ばせる(時計は止まる)。『しょうぶ』の説明は、はじめて4灯になった時に出す(tut_lamp4)。",
   devices=dict(
     lcd="『あそびかた』+番号①〜④。板の上から玉が釘を跳ねて落ち、7つの穴が光っていく。最後に同じ穴でルーレットが回りランプが消える。字幕は大きく2行。",
     petal="ゆっくりピンクで呼吸(全体)。", edge="ピンクの土台。", logo="控えめ。", seg="『0』", tray="なし(皿は空のまま)", btn="なし"),
   tracks=[T("lcd",0,8.0,"3コマの絵の説明(字幕2行)"),
           T("petal",0,8.0,"全体がピンクで呼吸","breathe",color=SAKURA,period=2.6,targets="all"),
           T("edge",0,8.0,"ピンクの土台","baseTint",color=SAKURA,level=.9)],
   snd=[(0.6,"ball_drop"),(2.15,"hole_in")], status=dict(lcd="todo", light="todo"))

ev(id="ticket", phase="A 待機〜開始", name="チケット受け取り〜玉の払い出し", tier=3, dur=2.8, blocking=True,
   trigger="スタッフがチケットを受け取り開始操作をした瞬間(18玉の払い出し開始)",
   feel="「あ、これ自分の玉だ」。玉への愛着の始まり。じゃらじゃら出てきて皿に積もる気持ちよさ。",
   precedent=[("実機の玉の払い出し(上皿へ玉が出る)に、盤ランプと液晶が連動して『GET』を見せる", "recall")],
   tutorial="『この玉で遊ぶ・玉は減る・増やせる』を伝える。玉1個ごとに7セグが+1。",
   devices=dict(
     lcd="チケットが手前に飛んで来て光る→弾けて『GET!』と数字(18)。数字は皿に玉が着くたびに増える。玉は液晶の外の皿にじゃらじゃら出る(液晶は下の皿を指す)。",
     petal="払い出し口の側(右下R4/R3)から上へ向かって、玉が出る間じゅう小刻みに光る(ちかちか)。",
     edge="玉1個ごとに右下から金色の波がゆっくり広がる(白は使わない。横長の縁が白く塗り潰されて『帯』に見えるため)。",
     logo="玉1個ごとにポン。", seg="玉1個ごとに+1(0→18)。メーターCの灯りがほんのり点く。",
     tray="右奥の払い出し口から18玉を物理で落とす(0.12秒間隔)。皿に自然に積もる。",
     btn="なし"),
   tracks=[T("lcd",0,0.7,"チケットが飛んで来る"), T("lcd",0.7,2.8,"GET! 18 たま"),
           T("tray",0.3,2.3,"18玉払い出し","payout",n=18,rate=9),
           T("seg",0.3,2.3,"0→18","count",to=18),
           T("petal",0.3,2.6,"払い出し口側から上へちかちか","chase",color=SAKURA,targets="lowerSides",speed=2.4,dir="up"),
           T("edge",0.3,2.3,"玉ごとに右下から金色の波が広がる","ripple",color=GOLD,origin="bottom-right"),
           T("logo",0.3,2.3,"ポンポン","pulse",color=GOLD,hz=3)],
   snd=[(0.3,"ball_pour_loop"),(2.3,"ball_pour_end")], status=dict(lcd="todo", light="todo"))

ev(id="start", phase="A 待機〜開始", name="開始(パッと暗転→スタート)", tier=3, dur=1.9, blocking=True,
   trigger="払い出し完了(皿に玉が着き終わった)のあと。順番は チケット→GET→皿が満ちる→スタート。ticket+start で4.5秒以内",
   feel="「はじまった!」。パッと暗くなって、ぱっと明るくなる切り替えの合図。迷わず最初の1球を撃ちたくなる。",
   precedent=[("暗転→タイトルコール→画面が開く。実機の演出の定石", "recall")],
   tutorial="T1: 暗転後に『左ボタンで玉をはなつ』を左下の矢印と一緒に出す。最初の1球を撃つまで残る。",
   devices=dict(
     lcd="暗転→花びらの風に乗って『さあ、いこう!』が来る→ウパ1匹が泳ぎ出す→下端に『ひかるボタンで うつ』(左下へ矢印)。",
     petal="一斉に消灯→0.4秒後に銀白の0灯状態へゆっくり戻る。",
     edge="一斉に消灯→虹Bが静かに戻る。",
     logo="暗転→金で一度光る。", seg="持ち玉18。", tray="なし", btn="左下の矢印(最初の発射まで)"),
   tracks=[T("ambient",0,0.45,"盤面を暗転","blackout",level=0.04),
           T("lcd",0.2,1.9,"さあ、いこう!"),
           T("petal",0,0.5,"一斉消灯","blackout"),
           T("petal",0.5,1.9,"銀白へ戻る","fade",to="n0"),
           T("edge",0,0.5,"一斉消灯","blackout"),
           T("logo",0.45,1.2,"金の一閃","pulse",color=GOLD,hz=1),
           T("btn",1.2,1.9,"左下の矢印","pulse",side="left")],
   snd=[(0.0,"blackout_whoosh"),(0.45,"start_call")], status=dict(lcd="todo", light="todo"))

# ───────────────────────── B. 通常プレイ ─────────────────────────
ev(id="ambient", phase="B 通常プレイ", name="通常時(灯の数で空気が変わる)", tier=1, dur=0, loop=True, blocking=False,
   trigger="ゲーム中、他の演出が無い間ずっと(灯の数nで変化)",
   feel="止まった画面にしない。灯が増えるほど、台が盛り上がる。3灯と4灯の間には断絶がある。",
   precedent=[("通常時も画面が動き、ランプで状態を示す(ディレクター『通常時もパチンコ寄り』)", "verified")],
   tutorial="灯の数=ウパの数=花びらの数、を常に見せる(ルールの読み取り役)。",
   devices=dict(
     lcd="通常画面の海+灯の数だけウパが泳ぐ(増えるほど騒がしい)+左上にランプ表示。",
     petal="0灯:銀白 / 1〜3灯:左上→右上→中央のハートの順にピンク / 4灯:全部ピンクでゆっくり呼吸 / 5灯:+稜線のきらめき / 6灯:金色+光が囲いを周回。",
     edge="虹は使わない。0〜3灯=消灯〜ごく弱い紺 / 4・5灯=ピンク / 6灯=金。灯が多いほど明るい。虹はJP・大成功・タイトルだけ。",
     logo="灯が多いほど輝きが増す。", seg="持ち玉とメーターを常時表示。", tray="玉が物理で積もる。", btn="なし"),
   tracks=[T("lcd",0,10,"海+ウパn匹","ambientLcd"),
           T("petal",0,10,"n灯の状態を保つ","stateN"),
           T("seg",0,10,"持ち玉とメーター","hold")],
   snd=[(0,"bgm_layer_by_n")], status=dict(lcd="existing", light="todo"))

ev(id="launch", phase="B 通常プレイ", name="発射(1球ごと)", tier=0, dur=0.25, blocking=False,
   trigger="発射ボタンで1球撃つたび(連射でも毎回。ただし重ねすぎない)",
   feel="1球ごとの軽い期待。手応え。",
   precedent=[("発射のたびに役物の電飾が走る程度の軽い反応", "recall")],
   tutorial="T2: 最初の1球の間だけ、7つの穴が順に光って『この穴に入れる』を教える(2.5秒、1回だけ)。",
   devices=dict(lcd="何も出さない(玉の落下から目を奪わない)。", petal="上中央(P2)の根元が0.1秒だけきらり。",
     edge="なし", logo="なし", pocket="最初の1球だけ、7口が1番→7番へ順に光る", seg="持ち玉−1", tray="皿の玉が1個減り、昇降管の玉が補充される", btn="なし"),
   tracks=[T("petal",0,0.15,"P2根元がきらり","pulse",color=WHITE,targets="P2.z0",hz=8),
           T("pocket",0,2.5,"【初回のみ】7口が順に点く","chase",color=GOLD,speed=2.8)],
   snd=[(0,"launch_tick")], status=dict(lcd="n/a", light="todo"))

ev(id="lamp123", phase="B 通常プレイ", name="新しい灯(1〜3灯)", tier=1, dur=2.4, blocking=True,
   trigger="灯っていない穴に玉が入り、灯が1〜3個目になった時",
   feel="積み上がる気持ちよさ。灯った事実を短く気持ちよく増幅する。1〜3灯はほぼ同格(ディレクター)。",
   precedent=[("上から新しいウパが落ちてぽよんと跳ね、『N灯』が大きく出る(ディレクター案)", "verified"),
              ("確定音集・エヴァ演出集で、太いゴシック+多重縁の文字が帯の上にスラムインするのを確認済み(前担当)", "verified")],
   tutorial="T3: 初めての点灯だけ、小さく『灯が増えるとウパが増える』を添える。",
   devices=dict(
     lcd="夜の金・紺の演出(点灯演出v12)。ウパが落下→ぽよん→『N灯』。約2.4秒。",
     petal="N番目の花びら(1=左上,2=右上,3=中央ハート)が白く咲いてピンクへ落ち着く。",
     edge="灯った穴に近い縁から白い光が走り、リングを半周して消える。",
     logo="ポンと金の一閃。", pocket="入った穴の口がきらりと白く光り、そのあとも白い基底で点き続ける。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,2.4,"ウパ落下→ぽよん→N灯(v12)"),
           T("petal",0.45,1.4,"N番目の花びらが咲く","bloom",color=SAKURA,targets="nth"),
           T("edge",0.35,1.4,"穴の近くから半周の桜色の彗星(白は帯がクリーム色に見えるので使わない)","comet",color=SAKURA,origin="pocket",turns=.5),
           T("logo",0.45,0.9,"金の一閃","pulse",color=GOLD,hz=2),
           T("pocket",0.2,1.4,"入った穴の口がきらりと白く(そのあとは白い基底が点き続ける)","pulse",color=WHITE,hz=3,targets="hit")],
   snd=[(0.45,"lamp_land"),(0.5,"lamp_chime_N")], status=dict(lcd="existing", light="todo"))

ev(id="lamp4", phase="B 通常プレイ", name="4灯(断絶:紺→桜)", tier=3, dur=3.6, blocking=True,
   trigger="灯が初めて4個になった時(その後の4灯到達でも同じだが矢印は初回のみ)",
   feel="3灯までと別世界。『来た!』と客の顔が上がる。勝負は1灯目からできるが、ここから勝負の賞(12玉・JP)が見えてくる、と体が理解する。",
   precedent=[("暗転→フラッシュ→画面全体の色が変わる『確定』系の切り替え(確定音集で確認済み)", "verified")],
   tutorial="T5: 初回のみ、画面下の右へ矢印と『右ボタンで勝負!』。勝負=灯っていない穴に入れば成功、を一行で。",
   devices=dict(
     lcd="ほぼ真っ暗→着地の一瞬の静止→桜色が着地点から画面を塗り替える(点灯演出v12の4灯)。『4灯』『満開!』。",
     petal="全45区画を一度0.3秒消灯→一斉に白く弾けて鮮やかなピンクへ→ゆっくり呼吸(以後ずっと)。",
     edge="全周が白く光ってから虹Bへ。",
     logo="虹色に一回光る。", pocket="灯った4口が赤、残り3口が金でゆっくり脈打つ(『ここを狙え』)。", seg="なし", tray="なし",
     btn="初回のみ右下へ矢印『勝負!』(押すと取り消せることは勝負宣言側で見せる)"),
   tracks=[T("ambient",0,0.8,"盤面を暗くして溜める","blackout",level=0.12),
           T("lcd",0,3.6,"溜め→桜に塗り替え→4灯(v12)"),
           T("petal",0.0,0.85,"点く前の桜色の明滅(消灯と点灯が入れ替わり、だんだん速く)","stutter",color=SAKURA,targets="all"),
           T("petal",0.8,1.1,"全消灯→弾ける","blackout"),
           T("petal",1.1,1.6,"白く弾ける","flash",color=WHITE,hz=1.5,limit=1,targets="all"),
           T("petal",1.6,3.6,"鮮やかなピンク→呼吸","breathe",color=PINK,period=3.2,targets="all"),
           T("edge",0.9,1.5,"全周が白","flash",color=WHITE,hz=1.5,limit=1),
           T("logo",1.0,1.6,"金の一閃","pulse",color=GOLD,hz=1),
           T("pocket",1.6,3.6,"未点灯の穴が金で脈打つ","pulse",color=GOLD,hz=1.2,targets="unlit"),
           T("btn",2.2,3.6,"【初回のみ】右下へ矢印","pulse",side="right")],
   snd=[(0.8,"impact_deep"),(1.1,"burst_big")], status=dict(lcd="existing", light="todo"))

ev(id="lamp5", phase="B 通常プレイ", name="5灯(桜+金縁)", tier=3, dur=3.0, blocking=True,
   trigger="灯が5個になった時",
   feel="もう一歩で最終。『1〜3灯より明らかに豪華』。",
   precedent=[("段階的に豪華になる灯数別の格上げ(ディレクター『5,6は1から3より豪華』)", "verified")],
   tutorial="なし(既に勝負の矢印は教えてある)。",
   devices=dict(lcd="桜色の『5灯』に金縁・桜吹雪(点灯演出v12の5灯)。", petal="ピンク+稜線のきらめきが始まる。",
     edge="虹Bを一段速く。", logo="輝き増し。", pocket="未点灯の2口が金の鼓動。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,3.0,"桜色+金縁の5灯(v12)"),
           T("petal",0.4,1.2,"全体が強く咲く","bloom",color=PINK,targets="all"),
           T("petal",1.2,3.0,"ピンク+稜線のきらめき","sparkle",color=WHITE,density=.5,targets="all"),
           T("pocket",1.0,3.0,"未点灯2口が金","pulse",color=GOLD,hz=1.4,targets="unlit"),
           T("petal",0.2,3.0,"桜と金が交互にちかちか(最後まで続く。4灯は静かなピンク)","alt",color=PINK,color2=GOLD,hz=4,targets="all"),
           T("petal",1.0,3.0,"金の光が花びらを周回","orbit",color=GOLD,speed=.6,targets="all"),
           T("edge",0.2,1.0,"全周が金で一閃","flash",color=GOLD,hz=2.5,limit=2),
           T("edge",1.0,3.0,"金の彗星が2周","comet",color=GOLD,turns=2),
           T("logo",0.3,3.0,"金と桜で明滅","breathe",color=GOLD,period=.9)],
   snd=[(0.4,"burst_big")], status=dict(lcd="existing", light="todo"))

ev(id="lamp6", phase="B 通常プレイ", name="6灯(金+JPチャンスの知らせ)", tier=4, dur=3.6, blocking=True,
   trigger="灯が6個になった時(次の1球が自動で最終勝負になる)",
   feel="空気が変わる。『次の1球で全てが決まる』という覚悟を客に渡す。",
   precedent=[("リーチ入りの『ここから』演出。ただし煽らず、事実を知らせる(増幅器の原則)", "recall")],
   tutorial="『次の1球が自動で最終勝負!』を大きく、残り1つの穴だけ強調。ボタンは押さなくてよい、と一言。",
   devices=dict(lcd="金色の『6灯』→『次の1球で最終勝負!』(点灯演出v12の6灯に帯を追加)。",
     petal="金色に変わり、光が囲いをゆっくり周回し続ける。", edge="金の彗星が2周。", logo="金で明滅。",
     pocket="最後の1口だけ白金で強く脈打つ(残りは赤)。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,3.6,"金の6灯+最終勝負の知らせ"),
           T("petal",0.3,1.0,"金へ弾ける","bloom",color=GOLD,targets="all"),
           T("petal",1.0,3.6,"金+光が周回","orbit",color=GOLD,speed=.25,targets="all"),
           T("edge",0.3,3.0,"金の彗星が2周","comet",color=GOLD,turns=2),
           T("pocket",1.0,3.6,"最後の1口が白金で脈打つ","pulse",color="#fff0b0",hz=1.6,targets="unlit"),
           T("petal",0.2,1.8,"金と白が交互にちかちか","alt",color=GOLD,color2=WHITE,hz=6,targets="all"),
           T("edge",0.3,1.0,"全周が金で一閃","flash",color=GOLD,hz=2.5,limit=2)],
   snd=[(0.3,"burst_gold")], status=dict(lcd="existing", light="todo"))

# ───────────────────────── C. 重複・消灯 ─────────────────────────
ev(id="dup_protect", phase="C 重複・消灯", name="重複(保護中)", tier=1, dur=1.4, blocking=True,
   trigger="最初の4灯に届くまでの間に、灯っている穴へ玉が入った時",
   feel="『あ、ダメだったけど大丈夫』。損はしないと分かってほっとし、次は別の穴を狙う気になる。",
   precedent=[("キャラのカットイン(下から出て一言)。実機の定番の知らせ手段", "recall")],
   tutorial="T4: 初回のみ、ウパが『おなじ穴だよ! 4灯までは大丈夫』と短く伝える。2回目以降は『同じ穴!』のみ。",
   devices=dict(lcd="ウパのカットインが下から出て『同じ穴!』(初回は『4灯までは消えないよ』)。赤は使わない。",
     petal="淡い水色の波紋が一度だけ広がる。", edge="なし(白い帯はクリーム色に見えるので出さない)。", logo="なし",
     pocket="入った穴の赤い縁が2回きらっと光る(どの穴が重複か見せる)。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,1.4,"ウパのカットイン『同じ穴!』"),
           T("petal",0.1,0.9,"淡い水色の波紋(金は6灯の色なので使わない)","ripple",color=CYAN,targets="all"),
           T("pocket",0,1.0,"重複した穴が2回きらり","pulse",color=WHITE,hz=4,targets="hit")],
   snd=[(0,"dup_soft")], status=dict(lcd="todo", light="todo"))

ev(id="roulette", phase="C 重複・消灯", name="重複ルーレット(−1/−2/−3灯/全消灯)", tier=3, dur=5.0, blocking=True,
   trigger="保護が切れた後、灯っている穴へ玉が入った時",
   feel="玉への愛着を使った『失うかも』の緊張。危険は危険に見せる(華やかにしない)。最後の溜めで息を止める。",
   precedent=[("ミリオンルーレット等、盤が回って止まる抽選(実映像で前担当が確認)", "verified"),
              ("予告で暗転→赤の演出は実機でも『危険/激アツ』の記号", "recall")],
   tutorial="『重複すると灯が消えるかも』を、ルーレットの文字(重複→結果)だけで伝える。説明文は出さない。",
   devices=dict(
     lcd="通常画面→3拍の予兆→画面がガラスのように砕ける→3D『重複』→盤が奥から→針が回る(最初が最速→連続減速→最後2.7秒の溜め)→結果(−1灯等)→昇天へ。",
     petal="一度すべて消灯→赤い光が花びらを渡って回る(液晶の針と同じ角度。減速も同期)。",
     edge="消灯→深紅の光が1点だけ周回し、針と同じ速さで減速。止まる瞬間に白く一閃。",
     logo="消灯。", pocket="灯っている穴の縁が不安定に点滅。", seg="持ち玉の数字が低く点滅(玉を失うかも)", tray="なし", btn="なし"),
   tracks=[T("ambient",0,0.6,"盤面を暗転","blackout",level=0.05),
           T("lcd",0,1.4,"予兆→ガラスが砕ける→『重複』"), T("lcd",1.4,4.3,"盤が回る→溜め"), T("lcd",4.3,5.0,"停止→結果"),
           T("petal",0.6,4.3,"赤い光が針と同じ角度で周回・減速","needle",color=CRIMSON,targets="all"),
           T("edge",0.6,4.3,"深紅の1点が周回・減速","needle",color=CRIMSON),
           T("edge",4.3,4.5,"停止の白い一閃","flash",color=WHITE,hz=3,limit=1),
           T("pocket",0.3,4.3,"灯った穴が不安定に点滅","flicker",color=CRIMSON,targets="lit"),
           T("seg",0.6,4.3,"持ち玉が低く点滅","pulse",color=CRIMSON,hz=1.5)],
   snd=[(0.6,"roulette_riser"),(1.4,"title_slam"),(4.3,"roulette_stop")], status=dict(lcd="existing", light="todo"))

ev(id="ascend", phase="C 重複・消灯", name="昇天(減った灯の数だけウパが昇る)", tier=3, dur=3.8, blocking=True,
   trigger="ルーレットの結果が出た直後(減灯数kだけウパk匹が昇る)",
   feel="喪失感。ただし理不尽でなく、どこか温かく『次こそ』へ。何が起きたかは絵で分かる(『−1灯』の文字+昇るウパ)。",
   precedent=[("にゃんこ大戦争の昇天(白く光り天使の輪と羽を付けて真上へ昇る)。総集編で確認済み", "verified")],
   tutorial="ランプとウパが1:1だと、この場面で分かる。",
   devices=dict(
     lcd="k匹が白く光って止まり、天使の輪と光の柱で昇る。HUDのランプがその都度1つ消える。",
     petal="昇るたびに、その数の花びらが根元から先へ消え、白金の光が下から上へ走る。",
     edge="昇天の柱に合わせて下から上へ白金が走り、最後に消える。",
     logo="一度暗く。", pocket="消えた灯の穴の縁が1つずつ消える。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,3.8,"k匹が昇天・HUDの灯が消える"),
           T("petal",0.4,3.2,"昇天ごとに白金が下→上、花びらが1つずつ消灯","ascendPetals",color="#ffe9a8"),
           T("edge",0.4,3.2,"下→上へ白金の柱","sweep",color="#ffe9a8",axis="up",speed=1.2),
           T("pocket",0.8,3.2,"消えた灯の穴の縁が消える","drainLit")],
   snd=[(0.4,"ascend_choir")], status=dict(lcd="existing", light="todo"))

# ───────────────────────── D. 勝負 ─────────────────────────
ev(id="challenge_declare", phase="D 勝負", name="勝負の宣言", tier=3, dur=1.6, blocking=True,
   trigger="右ボタンで勝負を宣言した瞬間(もう一度押すと取り消し)",
   feel="「押した」という覚悟。緊張。ただし盤面の玉に注目を戻す準備をする。",
   precedent=[("ボタンPUSH演出の『決まった』瞬間。大きな文字が叩きつけられる(実機の定番)", "recall"),
              ("緊張したキャラの顔のカット(ディレクター指定)", "verified")],
   tutorial="T6: 初回のみ、『灯っていない穴に入れば成功! もう一度押すと取り消し』を宣言後に小さく添える。",
   devices=dict(
     lcd="緊張したウパの顔のアップ→超豪華な『勝負!!』(3D)→すぐ『次の1球』表示へ縮む。",
     petal="一斉にほぼ消灯→上の中央(P2)にだけ金の鼓動。", edge="ほぼ消灯→上辺に金の鼓動。", logo="暗くなる。",
     pocket="未点灯の穴(当たりの口)が一斉に金で光り、以後脈打ち続ける。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,1.0,"緊張ウパ+『勝負!!』"), T("lcd",1.0,1.6,"『次の1球』へ縮む"),
           T("ambient",0,0.5,"盤面を暗く","blackout",level=0.18),
           T("petal",0,0.4,"ほぼ消灯","blackout"), T("petal",0.4,1.6,"P2に金の鼓動","heartbeat",color=GOLD,targets="P2",bpm=84),
           T("edge",0,0.4,"ほぼ消灯","blackout"), T("edge",0.4,1.6,"上辺に金の鼓動","heartbeat",color=GOLD,targets="top",bpm=84),
           T("pocket",0.3,1.6,"当たりの穴が金で点滅(白でなく濃い金)","pulse",color=GOLD,hz=3,depth=3.2,targets="unlit"),
           T("pocket",0.3,1.6,"外れの穴は白い基底を消して深紅に沈む","solid",color=CRIMSON,level=.55,targets="lit"),
           T("petal",0.4,1.6,"点いている花びらが赤く脈打つ","recolor",color=CRIMSON,bpm=96),
           T("edge",0,1.6,"縁は深紅の土台","baseTint",color=CRIMSON,level=.9)],
   snd=[(0,"challenge_slam")], status=dict(lcd="todo", light="todo"))

ev(id="challenge_flight", phase="D 勝負", name="勝負の玉が落ちている間", tier=2, dur=0, loop=True, blocking=False,
   trigger="勝負状態で玉を発射してから、入賞または回収されるまで(スローにしない)",
   feel="視線を玉に戻す。『入れ!』と息をのむ。液晶に目を奪われない。",
   precedent=[("ディレクター: 勝負の最中は当たりの穴をずっと強調。実際の物理に近い動き", "verified")],
   tutorial="なし。",
   devices=dict(lcd="液晶は暗くして、『ここに入れば成功』だけを簡潔に出す。通常画面は映さない(10/17ディレクター)。", petal="点いている花びらが赤く脈打つ(緊張)。", edge="深紅の土台で暗い。",
     logo="消灯", pocket="当たりの穴(灯のない穴)は金で強く脈打ち、外れの穴(灯っている穴)は赤で不安定に点滅する。成功と失敗の穴が一目で分かる。玉の位置のピンポイント照明は光層側の対応待ち。",
     seg="なし", tray="なし", btn="なし"),
   tracks=[T("ambient",0,6,"盤面を暗いまま保つ","hold",level=0.18),
           T("lcd",0,6,"『勝負中』の小さな印"),
           T("petal",0,6,"P2の金の鼓動","heartbeat",color=GOLD,targets="P2",bpm=84),
           T("pocket",0,6,"当たり(灯のない)穴が濃い金で点滅","pulse",color=GOLD,hz=3,depth=3.2,targets="unlit"),
           T("pocket",0,6,"外れ(灯っている)穴は白い基底を消して深紅に沈む","solid",color=CRIMSON,level=.55,targets="lit"),
           T("petal",0,6,"点いている花びらが赤く脈打つ","recolor",color=CRIMSON,bpm=96),
           T("edge",0,6,"縁は深紅の土台","baseTint",color=CRIMSON,level=.9)],
   snd=[(0,"tension_bed")], status=dict(lcd="todo", light="todo"))

ev(id="success_small", phase="D 勝負", name="成功(1〜3灯・回収)", tier=2, dur=3.8, blocking=True,
   trigger="1〜3灯で勝負が成功し、賞玉(1〜3玉)が決まった時",
   feel="ちゃんと報われた。ただし祝いすぎない。ウパが玉に変わって自分の皿に戻ってくる。",
   precedent=[("小当たりの回収演出(短いカットインと玉の払い出し)", "recall")],
   tutorial="『成功すると玉が増える。4灯以上だともっと増える』を、増えた玉の数で体感させる。",
   devices=dict(
     lcd="『成功!』のカットイン→ウパたちが玉に変わって皿へ飛ぶ→『+N玉』。約3.8秒。",
     petal="全体がピンクと金で3回ちかちか→ゆっくり銀白へ戻る。", edge="虹が一回りして消える。", logo="金の一閃。",
     pocket="入った穴が金で光り、残りは消える。", seg="持ち玉が+N。", tray="N玉を払い出す。", btn="なし"),
   tracks=[T("lcd",0,1.0,"『成功!』カットイン"), T("lcd",1.0,3.8,"ウパ→玉→+N玉"),
           T("petal",0.1,2.4,"ピンク/金のちかちか3回","flash",color=GOLD,hz=2.5,limit=3,targets="all"),
           T("petal",2.4,3.8,"銀白へ戻る","fade",to="n0"),
           T("edge",0.1,2.4,"金が1周","comet",color=GOLD,turns=1),
           T("pocket",0,2.4,"入った穴が金","solid",color=GOLD,targets="hit"),
           T("seg",1.4,2.6,"持ち玉+N","count",to="+N"),
           T("tray",1.4,2.6,"N玉払い出し","payout",n="N",rate=6)],
   snd=[(0,"success_small"),(1.4,"ball_pour_loop")], status=dict(lcd="todo", light="todo"))

ev(id="success_big", phase="D 勝負", name="成功(4・5灯:画面全体が燃え上がる)", tier=4, dur=7.0, blocking=True,
   trigger="4灯・5灯で勝負が成功した時(12玉/30玉)",
   feel="この台の一番の見せ場。『やった!!』と叫ぶ。後ろで見ていた人も足を止める。玉がじゃらじゃら入る。",
   precedent=[("当たり確定演出の『画面全体が燃える』『全ランプが虹で点滅』『玉が出る』(確定音集・エヴァ演出集で確認済み)", "verified")],
   tutorial="成功すると玉がたくさん増える、が、皿に積もる玉の量で分かる。",
   devices=dict(
     lcd="全画面の炎と虹の光→ウパが全員跳ねる→3D『大成功!』→『+12玉』または『+30玉』の巨大数字→ウパが玉に変わって皿へ。",
     petal="虹が全体を流れ、稜線がきらめく(4・5灯の成功用)。最後に虹のまま少し残す。", edge="虹Bを最大。強い点滅は1秒3回まで。",
     logo="虹色に輝く。", pocket="全7口が順に金→虹で走る。", seg="持ち玉が数えるように増え続け、数字が光る。",
     tray="12/30玉をジャラジャラ払い出す(30玉は速く)。", btn="なし"),
   tracks=[T("lcd",0,1.4,"炎+虹のバースト"), T("lcd",1.4,3.4,"大成功!(3D)"), T("lcd",3.4,7.0,"+N玉の巨大数字→ウパ→玉"),
           T("petal",0.1,7.0,"虹が流れ稜線がきらめく","rainbowFlow",targets="all",speed=.5),
           T("edge",0.1,6.0,"虹B最大","rainbowB",amount=2.0,speed=2.4),
           T("logo",0.3,7.0,"虹で輝く","breathe",color=RAINBOW,period=1.2),
           T("pocket",0.2,3.0,"全7口が金→虹で走る","chase",color=RAINBOW,speed=3.0),
           T("petal",0.1,3.4,"虹と白が交互にちかちか(実機の当たり)","alt",color=RAINBOW,color2=WHITE,hz=7,targets="all"),
           T("edge",0.1,1.6,"全周が白金で3連発","flash",color=WHITE,hz=3,limit=4),
           T("edge",3.4,4.4,"数字が叩きつく瞬間に全周が一閃","flash",color=GOLD,hz=3,limit=2),
           T("seg",3.4,6.4,"持ち玉が増え続ける","count",to="+N"),
           T("tray",3.4,6.4,"12/30玉払い出し","payout",n="N",rate=10)],
   snd=[(0,"success_big_hit"),(3.4,"ball_pour_loop")], status=dict(lcd="todo", light="todo"))

ev(id="fail", phase="D 勝負", name="失敗", tier=2, dur=2.6, blocking=True,
   trigger="勝負の玉が灯っている穴に入った(重複)、または灯のない穴へ入らなかった時",
   feel="喪失感を味わう。ただし理不尽でなく『次こそ』が残る。ここで人が帰る/背景の人が反応するのは不可(ディレクター)。",
   precedent=[("画面がガラスのように割れるカットイン(ディレクター『液晶の映像の中で』)", "verified")],
   tutorial="『灯が全部消えた→また最初から』を、ウパが消えた画面で見せる。",
   devices=dict(
     lcd="液晶のガラスが割れる→『失敗…』→小さな『次こそ!』→ウパ1匹だけが残る(以後の通常画面0灯へ戻る)。2〜2.5秒。",
     petal="ピンクが上から抜けて銀白へ。", edge="金→消灯。最後に冷たい青白が一瞬。", logo="暗くなる。",
     pocket="当たりだった穴を1秒だけ示す(自由。偽の軌道は出さない)。", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,1.0,"ガラスが割れる"), T("lcd",1.0,2.6,"『失敗…』→『次こそ!』"),
           T("petal",0.2,2.2,"ピンクが上から抜ける","drain",targets="all",dir="down"),
           T("petal",0.5,2.4,"白金の光が下から上へ昇っていく(全員昇天)","sweep",color="#ffe9a8",axis="up",targets="all"),
           T("edge",0.5,2.4,"白金の柱が下から上へ","sweep",color="#ffe9a8",axis="up"),
           T("edge",0.2,1.0,"金→消灯","fade",to="off"),
           T("edge",1.0,1.3,"冷たい青白の一瞬","flash",color=CYAN,hz=3,limit=1),
           {**T("pocket",0.0,0.4,"惜しかった口に波紋1回","pulse",color=GOLD,targets="target",hz=2.5), "when": {"near_miss": True}},
           {**T("edge",0.0,0.4,"その口の下から波紋1回","ripple",color=GOLD,origin="pocket"), "when": {"near_miss": True}}],
   snd=[(0,"glass_break"),(1.0,"fail_sigh")], status=dict(lcd="todo", light="todo"))

ev(id="jp", phase="E JP・精算", name="JP(7灯:虹ウパと配当ルーレット)", tier=5, dur=25, blocking=True,
   trigger="6灯で最後の1口に勝負球が入った時(Q2の回答で長さを調整。既定25秒)",
   feel="この台で一番ドキドキして、一番嬉しい。景品だけでなく玉の爆発に没入する。虹ウパを見た人が必ず声を出す。",
   precedent=[("JPの確定演出集(ディレクター手本)。全ランプの虹点滅、数字がせり上がる配当抽選(確定音集で確認済み)", "verified")],
   tutorial="なし(ここまで来た人に説明は不要)。",
   devices=dict(
     lcd="①白飛びのヒットストップ→②虹色のウパが空から降臨(他色6匹が整列して拍手)→③3D『JACKPOT』→④配当ルーレット(40/80/150/300/600の5区画、本気で減速して止まる)→⑤当選額が巨大に→⑥玉の爆発→通常画面。",
     petal="金と白の強い明滅+虹の周回(この台で一番明るい)。ルーレット中は針の角度の花びらだけが金で光り、止まる瞬間に全花びらが咲く。",
     edge="虹B最大+彗星。ルーレット中は針と同じ速度で金の1点が周回→止まる。", logo="虹色の最大輝度。",
     pocket="全7口が虹で順に走り続ける。", seg="当選額を数えるように7セグが増える(最大600)。",
     tray="当選額を加速しながら払い出す(600でも8秒以内)。皿があふれたら合計を7セグに表示。", btn="なし"),
   tracks=[T("lcd",0,0.8,"白飛びヒットストップ"), T("lcd",0.8,5.0,"虹ウパ降臨+JACKPOT"), T("lcd",5.0,14.0,"配当ルーレット(溜め含む)"),
           T("lcd",14.0,18.0,"当選額が巨大に"), T("lcd",18.0,25.0,"玉の爆発→通常へ"),
           T("ambient",0,0.8,"白飛び","flash",color=WHITE,hz=1.2,limit=1),
           T("petal",0.8,5.0,"金/白の強い明滅+虹周回","orbit",color=RAINBOW,speed=.6,targets="all"),
           T("petal",5.0,14.0,"針の角度の花びらだけが金","needle",color=GOLD,targets="all"),
           T("petal",14.0,25.0,"全花びらが咲き続ける→虹","rainbowFlow",targets="all",speed=.8),
           T("edge",0.8,5.0,"虹B最大+彗星","rainbowB",amount=2.0,speed=3.0),
           T("edge",5.0,14.0,"金の1点が針と同速で周回→停止","needle",color=GOLD),
           T("edge",14.0,25.0,"虹B最大","rainbowB",amount=2.0,speed=2.4),
           T("petal",0.8,5.0,"虹と白が交互に高速ちかちか","alt",color=RAINBOW,color2=WHITE,hz=8,targets="all"),
           T("edge",0.8,2.4,"全周が白金で連発","flash",color=WHITE,hz=3,limit=6),
           T("petal",14.0,18.0,"当選額の間は金と虹が交互に","alt",color=RAINBOW,color2=GOLD,hz=6,targets="all"),
           T("edge",14.0,15.5,"数字が叩きつく瞬間の一閃","flash",color=GOLD,hz=3,limit=4),
           T("logo",0.8,25.0,"虹の最大輝度","breathe",color=RAINBOW,period=.9),
           T("pocket",0.8,25.0,"全7口が虹で走る","chase",color=RAINBOW,speed=3.0),
           T("seg",14.0,22.0,"当選額が増える","count",to="+N"),
           T("tray",14.0,22.0,"当選額を払い出す","payout",n="N",rate="fast")],
   snd=[(0,"jp_hit"),(0.8,"jp_choir"),(5.0,"jp_roulette_riser"),(14.0,"jp_number_hit")], status=dict(lcd="todo", light="todo"))

ev(id="tray_overflow", phase="E JP・精算", name="皿あふれ(合計表示)", tier=1, dur=2.0, blocking=False,
   trigger="玉が皿から溢れ、隠し貯留へ流れ始めた時",
   feel="『こんなに増えた!』という満足。溢れても自分の玉は失われていないと分かる(合計が7セグに出る)。",
   precedent=[("ドル箱が満杯になるような『出てる感』", "recall")],
   tutorial="7セグが合計を示す、で『溢れた分も自分の玉』と伝える。",
   devices=dict(lcd="画面隅に小さく『玉いっぱい! 合計NNN』(1.5秒)。", petal="なし", edge="右下が金で一瞬。", logo="なし",
     pocket="なし", seg="合計を数字で点灯(溢れた間ずっと)。", tray="溢れ口から物理で隠し貯留へ。", btn="なし"),
   tracks=[T("lcd",0,1.5,"隅に『玉いっぱい!』"), T("edge",0,0.6,"右下が金","ripple",color=GOLD,origin="bottom-right"),
           T("seg",0,2.0,"合計を表示","hold")],
   snd=[(0,"overflow_chime")], status=dict(lcd="todo", light="todo"))

# ───────────────────────── F. 時間・お金・終了 ─────────────────────────
ev(id="warn10", phase="F 時間・お金・終了", name="残り10秒", tier=2, dur=10, blocking=False,
   trigger="残り時間が10秒を切った時(玉が残り少ない場合は残り3球で同様の弱い版)",
   feel="『急がなきゃ』。慌てさせすぎず、でも終わりが近いと分かる。",
   precedent=[("制限時間の残りカウントダウン(音と色でじわじわ)", "recall")],
   tutorial="時間の概念を教える(時間が無いと遊べなくなる)。",
   devices=dict(lcd="上端の時間バーが赤くなり、カウントを1秒ごとに脈打たせる(小さめ)。", petal="1秒ごとに全体が一瞬だけ弱く暗くなる。",
     edge="縁が時計のように1秒ごとに1/10ずつ短くなる(10→0)。", logo="なし", pocket="なし", seg="なし", tray="なし", btn="なし"),
   tracks=[T("lcd",0,10,"時間バーが赤く脈打つ"),
           T("edge",0,10,"縁が時計のように短くなる","countdown",color=CRIMSON,n=10),
           T("petal",0,10,"1秒ごとに弱く暗転","pulse",color=CRIMSON,hz=1,depth=.25,targets="all"),
           T("edge",0,10,"縁は深紅の土台","baseTint",color=CRIMSON,level=.8)],
   snd=[(0,"countdown_tick")], status=dict(lcd="todo", light="todo"))

ev(id="timeup", phase="F 時間・お金・終了", name="タイムアップ/玉切れ→追加100円の提示", tier=3, dur=10, blocking=True,
   trigger="最初の玉切れ・時間切れで(10秒の継続選択)",
   feel="『えっ、もう終わり?…まだやりたい!』。残念さと『あと一歩』を同時に感じさせる。説教しない。",
   precedent=[("コンティニュー画面(アーケードの『CONTINUE? 9,8,7…』)", "recall")],
   tutorial="『あと100円で18玉+50秒。灯と持ち玉は引き継ぐ』を一文で。ボタンの指示は左右どちらかを明示。",
   devices=dict(
     lcd="『TIME UP』/『玉切れ』のカットイン→10秒のカウントダウン付き『あと100円で続ける?』(18玉+50秒・灯は引き継ぎ)。ウパが期待の目で見つめる。",
     petal="一度暗くなってから、金の穏やかな脈動(『まだやりたい』)。", edge="10秒のカウントダウン:縁の区画が1秒ごとに2〜3個ずつ消える。",
     logo="なし", pocket="なし", seg="持ち玉を表示し続ける。", tray="なし", btn="右下へ矢印(『続ける』を押す側)"),
   tracks=[T("lcd",0,1.6,"TIME UP/玉切れ"), T("lcd",1.6,10,"追加100円の提示+カウントダウン"),
           T("ambient",0,0.6,"一度暗く","blackout",level=0.2),
           T("petal",0.6,10,"金の穏やかな脈動","breathe",color=GOLD,period=2.4,targets="all"),
           T("edge",1.6,10,"縁がカウントダウン","countdown",color=GOLD,n=10),
           T("btn",1.6,10,"右下へ矢印","pulse",side="right"),
           T("edge",0.6,10,"縁は金の土台","baseTint",color=GOLD,level=1.0)],
   snd=[(0,"timeup_drop"),(1.6,"continue_loop")], status=dict(lcd="todo", light="todo"))

ev(id="add100", phase="F 時間・お金・終了", name="追加100円(ラストチャンス)", tier=3, dur=4.0, blocking=True,
   trigger="追加の100円が入った瞬間(18玉の払い出し+50秒、灯と持ち玉は引き継ぐ)",
   feel="『もう失敗できない』。気持ちがこもる。玉がまた自分の皿に来る嬉しさ。",
   precedent=[("ラストチャンス/再挑戦演出(アーケードのコンティニュー後)", "recall")],
   tutorial="追加は1回だけ、をここで『LAST CHANCE』の言葉で伝える。",
   devices=dict(
     lcd="『LAST CHANCE』の3D→『18玉+50秒』→ウパが拳を握る。以後の通常画面の右上に小さく『LAST』。",
     petal="一度消灯→灯の数の状態へ戻りつつ、少しだけ赤みを足す。", edge="縁が一周して、ほんの少し深い色になる(以後LAST中ずっと)。",
     logo="一度強く光る。", pocket="なし", seg="玉が+18。", tray="18玉払い出し(通常のチケットより速い)。", btn="なし"),
   tracks=[T("lcd",0,1.8,"LAST CHANCE(3D)"), T("lcd",1.8,4.0,"18玉+50秒"),
           T("petal",0,0.4,"一度消灯","blackout"), T("petal",0.4,2.5,"灯の数へ戻る(少し赤み)","fade",to="stateN"),
           T("edge",0.2,2.0,"一周","comet",color=CRIMSON,turns=1),
           T("tray",1.8,3.2,"18玉払い出し","payout",n=18,rate=12),
           T("seg",1.8,3.2,"+18","count",to="+18")],
   snd=[(0,"last_chance"),(1.8,"ball_pour_loop")], status=dict(lcd="todo", light="todo"))

ev(id="finish_count", phase="F 時間・お金・終了", name="終了:精算(玉を数える)", tier=2, dur=6.0, blocking=True,
   trigger="追加後の玉切れ・時間切れ、または継続を選ばずに終えた時",
   feel="自分の玉を数える。『これだけ増えた/残った』。ここも結果演出の一部で、愛着の締め。",
   precedent=[("リザルト画面で獲得数を数え上げる(実機の終了後の獲得表示)", "recall")],
   tutorial="なし。",
   devices=dict(
     lcd="『精算』→皿の玉が1つずつ数えられる→合計がカウントアップ。ウパが並んで見守る。",
     petal="銀白に戻り、数が増えるたびに根元から少しずつピンクを点す(ゲージのように)。", edge="虹Bを静かに。",
     logo="なし", pocket="なし", seg="合計(皿+溢れ)を点灯してカウントアップ。メーターCから順に点いていく。",
     tray="皿の玉を回収口へ吸い込む(物理)。", btn="なし"),
   tracks=[T("lcd",0,6.0,"精算→カウントアップ"),
           T("petal",0,6.0,"根元から少しずつピンク(ゲージ)","gauge",color=SAKURA,targets="all"),
           T("seg",0,6.0,"合計カウントアップ+メーター","count",to="total"),
           T("tray",0.5,5.0,"皿の玉を回収","collect"),
           T("edge",0,6.0,"縁は桜の土台。数が増えるたびに一閃","baseTint",color=SAKURA,level=1.0),
           T("edge",0.4,6.0,"桜の彗星が周回","comet",color=SAKURA,turns=3),
           T("logo",0.4,6.0,"金で明滅","breathe",color=GOLD,period=1.2)],
   snd=[(0,"count_loop")], status=dict(lcd="todo", light="todo"))

ev(id="result", phase="F 時間・お金・終了", name="景品の発表(参加賞/C/B/A/S/SS)", tier=4, dur=9.0, blocking=True,
   trigger="精算が終わった時(最終の持ち玉で景品が決まる)",
   feel="どの結果でも『100円の価値があった』。ランクが上がるほど、周りの人も振り向く。『もっとこうしてれば…』の次回への火種を残す。",
   precedent=[("リザルトでランク別に演出が格上げされる(実機・アーケード共通の定番)", "recall")],
   tutorial="『次の人へ。ありがとう』で締めて待機デモへ。景品の受け取り方はスタッフの案内に任せる。",
   devices=dict(
     lcd="ランクの発表(参加賞は温かく、Cは銅、Bは銀、Aは金、Sは金+虹、SSはJP級)→ウパが全員で祝う→『ありがとう』。",
     petal="ランクの色で咲く(銅→銀→金→金+虹→虹の最大)。参加賞も必ず一度は優しいピンクで咲く。",
     edge="ランクに応じた彗星の周回数(1〜5周)。", logo="ランクの色。", pocket="なし",
     seg="メーター(C B A S SS)が下から順にスイープして、ランクの所で光が止まる。7セグは最終の玉数。", tray="なし", btn="なし"),
   tracks=[T("lcd",0,2.0,"溜め→ランク発表"), T("lcd",2.0,7.0,"ウパが祝う/景品名"), T("lcd",7.0,9.0,"ありがとう→待機へ"),
           T("petal",0.6,9.0,"ランクの色で咲く","rankBloom",targets="all"),
           T("edge",0.6,7.0,"ランクに応じた周回(ランクの色。虹はJPと大成功だけ)","comet",color="rank",turns="rank"),
           T("petal",1.0,9.0,"ランクの色が囲いの花びらを周回","orbit",color="rank",speed=.45,targets="all"),
           T("seg",0,2.0,"メーターがスイープして止まる","sweep",targets="meter",period=2),
           T("logo",0.6,9.0,"ランクの色","breathe",color="rank",period=1.6),
           T("petal",0.6,3.6,"ランクの色と白が交互にちかちか","alt",color="rank",color2=WHITE,hz=5,targets="all"),
           T("edge",0.6,9.0,"ランク色の土台","baseTint",color="rank",level=1.1)],
   snd=[(0,"rank_riser"),(2.0,"rank_hit")], status=dict(lcd="todo", light="todo"))

# ---- チュートリアル(初見向けに作り直し 10/17 03:40) ----
TUT_OVERRIDE = {
 "attract": "後回し(待機デモは今回は作らない)。前の人のプレイが見えること自体が教材になる。",
 "title": "T1: 『ひかっている ボタンを おしてね』だけ。ルール説明は押した後の『howto』で一言(玉を上から落として穴に入れると増える)。",
 "howto": "T1b: 一文ずつ。『うえから たまを おとして』→『あなに いれると ふえるよ!』→『あそびながら おぼえよう』。詳しい決まりは最初に灯った時(T5)。",
 "ticket": "T2: ウパが『この玉であそぶよ』と玉を指さす。玉が1個出るたびに7セグが+1。『玉は使うと減る。でも、ふやせる』は絵(減る→ふえる)だけで。",
 "start": "T3: 暗転後、左ボタンが脈打ち、ウパが指さして『ひかっているボタンで うつ』。最初の1球を撃つまで残る。12秒撃たないとウパが大きくなって、もう一度指さす。",
 "launch": "T3b: 最初の1球だけ、7つの穴が順に光って『あなに いれよう』。外れても責めず『もういっかい!』。",
 "lamp123": "T5: 最初の灯だけ、下の7つの穴で3段階(各約2秒): ①『はいった あなが ひかる!』②『ちがう あなを ねらおう』(光っていない穴が脈打つ)③『おなじ あなは ルーレット! ひかりが きえる』(赤い印)。2個目以降は文字なし。",
 "lamp4": "T9: 4灯の初回だけ『ここから 玉がたくさん ふえる!』。重複で灯が消える怖さはルーレット自体が見せるので、説明文は出さない。",
 "dup_protect": "T7: 初回のみウパが『おなじあな! 4つまでは だいじょうぶ』。安心させてから、4灯で保護が切れる。",
 "challenge_declare": "T8: 初回のみ『つぎの1球が しょうぶ! あかりのない あなに いれよう』。灯のない穴がやさしく脈動して狙う先を示す。『もういちど おすと やめる』は小さく。",
 "success_small": "T9: 初回のみ『玉が ふえた!』。増えた玉が皿に出る音と7セグの+で体感させる。",
 "fail": "T9: 初回のみ『ざんねん。また あつめよう』。灯が消えるのはウパが昇る絵で見せ、責めない。",
}
for e in E:
    if e["id"] in TUT_OVERRIDE: e["tutorial"] = TUT_OVERRIDE[e["id"]]
    if e["id"] == "attract": e["status"] = dict(lcd="postponed", light="postponed")

# ---- ボタンの発光(ボタンは光る: 10/17 03:31 回答) ----
LEFT_PINK = "#ff5a9a"; RIGHT_GOLD = GOLD
BTN_TEXT = {
 "attract": "左右ともゆっくり呼吸(待機デモは後回し)。",
 "title": "左ボタンが強く脈打つ。『光っているボタンをおす』を体で覚えさせる。",
 "start": "左ボタンが強く脈打ち続ける(最初の1球まで)。右は消灯。",
 "launch": "撃った瞬間に左が一瞬明るく→玉が落ち着くまで暗く(撃てない時間が光で分かる)→また呼吸。",
 "lamp123": "2灯目から、右ボタンが金でゆっくり呼吸し始める(勝負できる合図)。初回は強く脈打つ。",
 "lamp4": "右ボタンが金で強く脈打つ(勝負の見せ場)。",
 "lamp5": "右ボタンが金で強く脈打つ。",
 "lamp6": "右ボタンは2回だけ光って消える(『もう押さなくていい。次が自動』)。左だけ呼吸。",
 "dup_protect": "変化なし。",
 "roulette": "左右とも暗く(結果を見守る)。",
 "ascend": "左右とも暗いまま、終わりに左が戻る。",
 "challenge_declare": "右ボタンが赤金で速く脈打つ(宣言済み。もう一度押すと取り消し)。左が『撃て』と脈打つ。",
 "challenge_flight": "右は赤金の脈動のまま、左は暗い(もう撃った)。",
 "success_small": "左右とも金で一瞬弾けて、通常へ。",
 "success_big": "左右とも金→虹で弾ける。",
 "fail": "左右とも一瞬で消える(ガラスが割れる瞬間)。",
 "jp": "左右とも虹で走り続ける。",
 "timeup": "右ボタンが金で脈打つ(『つづける』を押す側)。左は暗い。",
 "add100": "押した右ボタンが一度強く光り、左に戻る。",
 "finish_count": "左右とも消灯。",
 "result": "最後に左が呼吸(『次の人へ』)。",
}
BTN_TRACKS = {
 "title": [("btn",0,3,"左ボタンが脈打つ","pulse",dict(side="left",color=LEFT_PINK,hz=1.4))],
 "start": [("btn",1.2,2.2,"左ボタンが強く脈打つ","pulse",dict(side="left",color=LEFT_PINK,hz=1.6))],
 "lamp4": [("btn",2.2,3.6,"右ボタンが金で脈打つ","pulse",dict(side="right",color=RIGHT_GOLD,hz=1.8))],
 "lamp6": [("btn",0.3,2.4,"右ボタンが2回光る","flash",dict(side="right",color=RIGHT_GOLD,hz=1.5,limit=2))],
 "challenge_declare": [("btn",0,1.6,"右ボタンが赤金で速く脈打つ","pulse",dict(side="right",color="#ff7a1c",hz=3.0)),
                       ("btn",0.8,1.6,"左ボタンが脈打つ","pulse",dict(side="left",color=LEFT_PINK,hz=2.0))],
 "success_small": [("btn",0.3,1.2,"左右が金で弾ける","bloom",dict(side="both",color=GOLD))],
 "success_big": [("btn",0.5,2.0,"左右が金で弾ける","bloom",dict(side="both",color=GOLD)),
                 ("btn",2.0,6.0,"左右が虹で走る","chase",dict(side="both",color=RAINBOW,speed=1.2))],
 "jp": [("btn",0.8,20.0,"左右が虹で走る","chase",dict(side="both",color=RAINBOW,speed=2.0))],
 "result": [("btn",7.0,9.0,"左ボタンが呼吸","breathe",dict(side="left",color=LEFT_PINK,period=1.6))],
}
for e in E:
    if e["id"] in BTN_TEXT: e["devices"]["btn"] = BTN_TEXT[e["id"]]
    if e["id"] == "timeup":
        e["tracks"] = [t for t in e["tracks"] if t["lane"] != "btn"]
        e["tracks"].append(T("btn",1.6,10,"右ボタンが金で脈打つ","pulse",side="right",color=RIGHT_GOLD,hz=1.6))
    if e["id"] == "lamp4":
        e["tracks"] = [t for t in e["tracks"] if t["lane"] != "btn"]
    if e["id"] == "add100":
        e["tracks"].append(T("btn",0,1.0,"右ボタンが一度強く光る","flash",side="right",color=RIGHT_GOLD,hz=1,limit=1))
    for (lane,t0,t1,label,pat,pp) in BTN_TRACKS.get(e["id"], []):
        e["tracks"].append(T(lane,t0,t1,label,pat,**pp))


# ---- 既存モノリス(重複ルーレット+昇天)の実測の時間割(lcd/monolith_timing.json): 予兆0〜2.05、針2.05〜6.8、結果6.93、昇天8.3〜(k=1で12.75終了、+0.38/匹) ----
for e in E:
    if e["id"] == "roulette":
        e["dur"] = 8.3
        e["name"] = "重複ルーレット(−1/−2/−3灯/全消灯)"
        e["length_note"] = "既存の演出の実測(予兆2.05秒→針が回る4.75秒→結果)で、昇天の前まで8.3秒。ゲームの時計は止める(合意済み)。"
        e["tracks"] = [T("ambient",0.3,8.3,"盤面を暗転","blackout",level=0.05),
           T("lcd",0,2.05,"予兆→ガラスが砕ける→『重複』"), T("lcd",2.05,6.8,"盤が回る→溜め"), T("lcd",6.8,8.3,"停止→結果"),
           T("petal",1.2,2.05,"赤い閃光(『重複』のドン)","flash",color=CRIMSON,hz=2,limit=1,targets="all"),
           T("petal",2.05,6.8,"赤い光が針と同じ角度で周回・減速","needle",color=CRIMSON,targets="all"),
           T("edge",0,8.3,"縁は深い赤の土台(結果を見守る)","baseTint",color="#d0101e",level=.7),
           T("edge",2.05,6.8,"深紅の1点が周回・減速","needle",color=CRIMSON),
           T("edge",6.8,7.0,"停止の白い一閃","flash",color=WHITE,hz=3,limit=1),
           T("pocket",0.3,8.3,"灯った穴が不安定に点滅","flicker",color=CRIMSON,targets="lit"),
           T("seg",0.6,6.8,"持ち玉が低く点滅","pulse",color=CRIMSON,hz=1.5)]
        e["snd"] = [(0.6,"roulette_riser"),(1.5,"title_slam"),(6.8,"roulette_stop"),(6.93,"result_title")]
    if e["id"] == "ascend":
        e["dur"] = 5.0
        e["length_note"] = "ルーレットの結果の直後、実測で昇天1匹なら約4.45秒(1匹増えるごとに+0.38秒)。液晶の昇天の合図でホスト(Effects)が自動で始める。"
        e["tracks"] = [T("ambient",0,4.4,"盤面は暗いまま","blackout",level=0.05),
           T("lcd",0,5.0,"k匹が昇天・HUDの灯が消える"),
           T("petal",0.2,4.4,"昇天ごとに白金が下→上、花びらが1つずつ消灯","ascendPetals",color="#ffe9a8"),
           T("edge",0.2,4.4,"下→上へ白金の柱","sweep",color="#ffe9a8",axis="up",speed=1.2),
           T("pocket",0.5,4.4,"消えた灯の穴の縁が消える","drainLit")]
        e["snd"] = [(0.2,"ascend_choir")]


# ---- 既存の1〜6灯の演出の実測(着地まで落下0.67秒のうち0.55秒を省く): busy解除まで 2.5/4.0/3.3/3.6秒 ----
for e in E:
    d = {"lamp123": 2.6, "lamp4": 4.1, "lamp5": 3.4, "lamp6": 3.7}.get(e["id"])
    if d: e["dur"] = d

# ---- 暗転は「通常の光(土台)」を落とす。イベントの間じゅう落としたままにするものは、トラックを伸ばす ----
for e in E:
    for t in e["tracks"]:
        if t["lane"] == "ambient" and t.get("pat") == "blackout":
            if e["id"] == "roulette": t["t0"] = 0.3; t["t1"] = 8.3; t["p"] = dict(level=0.05)
            if e["id"] == "ascend": t["t1"] = 4.4; t["p"] = dict(level=0.05)
            if e["id"] == "challenge_declare": t["t1"] = 1.6; t["p"] = dict(level=0.16)

# ---- JPの長さ: プレイ時間(100秒+50秒)から逆算 ----
for e in E:
    if e["id"] == "jp":
        e["dur"] = 20
        e["trigger"] = "6灯で最後の1口に勝負球が入った時。配当(40/80/150/300/600)で長さが変わる"
        e["variants"] = {"40": 0.7, "80": 0.8, "150": 1.0, "300": 1.2, "600": 1.4}
        e["length_note"] = ("調整担当の確定表: 玉40/80/150/300/600で14/16/20/24/28秒。JP中はゲーム時計を止めるので、プレイ時間は食わない。"
                            "ボタンで飛ばせるようにはしない。実機の大当たり告知は10〜20秒級が多い(一般的な印象。映像確認はこれから)。")
        # 時間軸を20秒に詰める(元は25秒)
        k = 20/25
        for t in e["tracks"]:
            t["t0"] = round(t["t0"]*k, 2); t["t1"] = round(t["t1"]*k, 2)
        e["snd"] = [(round(a*k,2), b) for a,b in e["snd"]]

TUTORIAL = dict(
 principles=[
  ("一度にひとつだけ", "いま押せるボタンにだけ結びつけて教える。その動作をしたら、ヒントはすぐ消える。"),
  ("絵が先、文字は後", "ウパが指さす、矢印、光る穴で伝える。文字は10文字前後のひらがな中心。読めなくても動作は分かる。"),
  ("最初に目的を一言", "『玉をうって、ふやそう!』。玉が増える絵と一緒に、一番最初に見せる。ここが超基礎。"),
  ("勝負は『玉がふえる方法』として出す", "『勝負』という言葉だけを出さず、灯のない穴に入れると玉が山になる、という絵の後に右ボタンを指す。"),
  ("光っているボタンを押す", "ボタンが光る。押せる時だけ光り、いま押すボタンが一番強く光る。文字が読めなくても何を押すか分かる。待機デモは後回しなので、列の人は前の人のプレイを見て学ぶ。"),
  ("待たせない", "ゲーム開始までに足した待ち時間は0秒。ヒントは全部遊びながら出し、各ヒントは1セッションに1回だけ、通算の表示は約25秒。"),
  ("迷った人を助ける", "12秒撃たなければウパが大きく指さす。灯が2つ以上たまっても勝負を知らなければ、右ボタンの矢印を出す。"),
 ],
 steps=[
  dict(id="T1", when="タイトル(ボタン待ち)", say="玉をうって、ふやそう!/ひだりのボタンでスタート", how="玉が増える絵。光っている左ボタンを指す。", dur="押すまで", once=True, need="左ボタン"),
  dict(id="T2", when="玉の払い出し(4.5秒)", say="この玉であそぶよ", how="ウパが玉を指さす。玉1個ごとに7セグが+1。", dur="4.5秒(元からある待ち)", once=True, need="なし"),
  dict(id="T3", when="開始〜最初の1球", say="ひだりのボタンで うつ", how="左ボタンが脈打ち、ウパが指さし、7つの穴が順に光る。撃つまで残る。12秒撃たなければウパが大きくなる。", dur="最初の1球まで", once=True, need="左ボタン"),
  dict(id="T5", when="最初の灯", say="ともった! ウパがふえたよ/あかりを あつめよう", how="ウパが落ちてくる。光る穴を数える。", dur="2.6秒", once=True, need="なし"),
  dict(id="T6", when="2灯目(または最初の灯から8秒)", say="みぎのボタン しょうぶ!/あかりのない あなに いれると 玉がふえる", how="暗い穴に玉が入ってぴかっ→玉の山、の2.8秒の小さな絵。右ボタンが金で脈打つ。勝負するまで右ボタンが強めに光り続ける。", dur="2.8秒+小矢印", once=True, need="右ボタン"),
  dict(id="T7", when="最初の重複(4灯まで)", say="おなじあな! 4つまでは だいじょうぶ", how="ウパのカットイン。", dur="1.6秒", once=True, need="なし"),
  dict(id="T8", when="最初の勝負宣言", say="つぎの1球が しょうぶ!/あかりのない あなに いれよう", how="灯のない穴がやさしく脈動。『もういちど おすと やめる』は小さく。", dur="2.4秒", once=True, need="なし"),
  dict(id="T9", when="最初の成功/失敗/4灯", say="玉が ふえた!/ざんねん。また あつめよう/ここから 玉がたくさん ふえる!", how="成功は皿と7セグで、失敗はウパが昇る絵で、4灯は断絶の演出で伝える。", dur="各1.5秒", once=True, need="なし"),
  dict(id="T10", when="残り10秒", say="のこり 10", how="縁のLEDの輪が時計のように減っていく。数字が液晶に出る。", dur="10秒(元からある)", once=False, need="なし"),
 ],
 refs=[
  ("Learning From Games: Onboarding and Mario", "https://medium.com/@daverage/learning-from-games-onboarding-and-mario-53334c7576f1", "広い安全な場所から始め、最初の敵で必ずジャンプを試させる。遊びの中で教える定番。検索結果の要約で確認(本文は未精読)。"),
  ("Lessons in onboarding from Plants vs Zombies", "https://uxdesign.cc/lessons-in-onboarding-from-plants-vs-zombies-d936d58c10c", "一度にひとつの概念を、実際に操作させながら足していく。検索結果の要約で確認(本文は未精読)。"),
  ("パチンコの初心者向け案内(画面のナビに従う方式)", "https://nana-press.com/post/1570105", "実機は『ハンドルを右に回して打ち出す』『画面の案内に従う』『左打ちに戻して』など、液晶と音声の短い指示で導く。検索結果の要約で確認(本文は未精読)。"),
 ],
 questions=[
  dict(id="Q4", q="列で並んでいる時やチケットを渡す時に、スタッフが『左ボタンで玉を打つ』程度のひと言を言えますか?", default="言えない前提で、画面だけで全部分かるように作る。"),
 ],
 wait_budget="開始までに足す待ち時間: 0秒(払い出し4.5秒と開始2.2秒の中に収める)/ヒントの通算表示: 約25秒 / 各ヒントは1セッション1回",
)

# 順番を整える
phases = []
for e in E:
    if e["phase"] not in phases: phases.append(e["phase"])
# 10/17朝時点の制作状況(液晶=Canvas2Dシーンと既存モノリス、光=光バスで全部動く。待機デモだけ後回し)
for e in E:
    st = e["status"]
    if e["id"] == "attract": st["lcd"] = "postponed"; st["light"] = "postponed"; continue
    if st["lcd"] in ("todo", "existing"): st["lcd"] = "built"
    if st["light"] == "todo": st["light"] = "built"
out = dict(
  version=1,
  device_note="機器: LCD 16:9(2560x1440) / 花びら11枚=45区画 / 縁LED24区画(上4・右8・下4・左8) / ロゴ / 入賞口LED7 / 7セグ+メーター(C B A S SS) / 皿の玉(物理) / ボタン2つ(光る。左=発射、右=勝負)",
  palette=dict(gold=GOLD, pink=PINK, sakura=SAKURA, crimson=CRIMSON, navy=NAVY, cyan=CYAN),
  phases=phases, tutorial_flow=TUTORIAL,
  events=[{**e, "precedent":[{"t":t,"src":s} for t,s in e["precedent"]], "snd":[{"t":t,"cue":c} for t,c in e["snd"]]} for e in E])
pathlib.Path(__file__).with_name("events.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(len(E), "events;", sum(len(e["tracks"]) for e in E), "tracks")
