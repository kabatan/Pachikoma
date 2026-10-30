# 紫の雷（JP チャンス導入）の音。手本＝東京喰種 先バレ音（監督提供 sakibare_01_tokyoghoul.wav）の「構造」だけを写した別物。
# 手本から取った構造：頭から全開（立ち上がりなし）／帯域は中域（300-1.5k）と高域の「ほどけた帯」が主で、下降する高い笛と揺れる低い倍音の和音が重なる／左右の逆相に近い広いステレオ（side/mid≈1.7）／
#   全体が -10dB 付近まで潰れて 0dBFS に張り付く／約2.1秒で突然切れ、その後 約0.33秒ごとの段で落ちるゲート残響が約2秒続く。
# 変えたところ：音高（手本の低音は約110/220Hz → こちらは根音 69.3Hz(C#2)＋5度）、音色（手本の笛 → 「裂ける」ノコギリ波のAM＋帯域が下がるノイズ）、
#   手本に無い低音の衝撃（サブの落下 110→34Hz）と頭の三連のひび割れ、雷の映像（1.0秒）に合わせて 1.0秒で切る、残響の段は 0.2秒ごと。素材（サンプル）は一切使わず、全部合成。
import numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, sys
SR=48000; rng=np.random.default_rng(31)
WALL=1.0; TAIL=1.1; N=int((WALL+TAIL)*SR); t=np.arange(N)/SR
def env_exp(t0,tau,att=0.002):
    e=np.zeros(N); i=t>=t0; x=t[i]-t0; e[i]=np.minimum(1,x/att)*np.exp(-x/tau); return e
def bp(x,lo,hi,o=4):
    sos=sg.butter(o,[lo,hi],'bandpass',fs=SR,output='sos'); return sg.sosfilt(sos,x)
def hp(x,f,o=4): return sg.sosfilt(sg.butter(o,f,'highpass',fs=SR,output='sos'),x)
def lp(x,f,o=4): return sg.sosfilt(sg.butter(o,f,'lowpass',fs=SR,output='sos'),x)
def noise(): return rng.standard_normal(N)
def saw(ph): return 2*(ph%1)-1
# --- 1. 低音の衝撃：サブの落下（110→34Hz）。頭から全開
f=34+(110-34)*np.exp(-t/0.11); ph=np.cumsum(f)/SR
boom=np.sin(2*np.pi*ph)*env_exp(0,0.42,0.003); boom=np.tanh(2.2*boom)*0.9
# --- 2. 頭のひび割れ（三連：0, 0.085, 0.21秒）：広帯域のバースト＋高い裂け目
crack=np.zeros(N)
for t0,g in ((0,1.0),(0.085,0.8),(0.21,0.7)):
    n=noise(); crack+=g*(hp(n,1800)*env_exp(t0,0.045,0.0008)+lp(n,600)*env_exp(t0,0.09,0.001)*0.9)
# --- 3. 下降する「裂ける」音：ノコギリ波を90HzでAMした帯域ノイズ。中心が 9kHz→1.4kHz へ下がる（手本の笛とは別の質感）
sweepc=1400+(9000-1400)*np.exp(-t/0.38); sweepn=noise()
tear=np.zeros(N)
# 時間変化の帯域通過：短い窓ごとに中心を動かす
blk=480
for i in range(0,N,blk):
    c=float(sweepc[min(i,N-1)]); lo=max(300,c*0.8); hi=min(20000,c*1.25)
    seg=sweepn[max(0,i-blk):i+2*blk]; y=bp(seg,lo,hi,2); off=min(i,blk)
    tear[i:i+blk]=y[off:off+blk][:len(tear[i:i+blk])]
am=0.55+0.45*saw(90*t)       # 90Hz のノコギリでAM＝電気的に引き裂く感じ
tear=tear*am*env_exp(0,0.55,0.001)*3.0
# --- 4. 持続する壁（0〜1.0秒）：C#2(69.3Hz)＋5度＋オクターブのノコギリ和音を強く歪ませ、3半音下がる。揺れ(ビブラート)付き
root=69.3*2**(-3/12*np.clip(t/WALL,0,1)); vib=1+0.006*np.sin(2*np.pi*5.7*t)
stack=np.zeros(N)
for mult,g,det in ((1,1.0,0.0),(1,0.7,0.011),(1.498,0.55,0.0),(2,0.6,-0.008),(3,0.35,0.0),(4.02,0.28,0.01)):
    ph=np.cumsum(root*vib*mult*(1+det))/SR; stack+=g*saw(ph)
stack=np.tanh(2.8*stack/3)  # 歪み
stack=lp(stack,4200)
# 帯域ノイズの壁（中域 300-1.5k と高域のほどけ帯）。20Hz前後でゲートが粗く揺れる
n1=noise(); wallnoise=bp(n1,300,1500)*2.6+bp(noise(),1500,6000)*1.5+hp(noise(),6000)*1.1
gate=0.65+0.35*np.sign(np.sin(2*np.pi*(17+4*np.sin(2*np.pi*0.9*t))*t))
wallnoise=wallnoise*gate
# 電気的なパチパチ（疎なインパルス）
imp=(rng.random(N)<70/SR).astype(float)*rng.choice([-1,1],N)*rng.uniform(0.5,1,N); crackle=bp(sg.lfilter([1,0.6,0.2],[1],imp),2500,11000,2)*6
wall_env=np.where(t<WALL,1.0-0.12*(t/WALL),0.0); wall_env=wall_env*(1-np.exp(-t/0.004))
# 手本の全開の立ち上がり：頭の 0.15秒は壁を強め、その後わずかに落ちる
wall_env=wall_env*(1+0.25*np.exp(-t/0.15))
# --- ステレオ：中央（低音・和音）と広がり（ノイズ・笛を左右で別系列／逆相寄せ）
def decor(x,k):
    y=sg.lfilter([k,1],[1,k],x); return y
mid=boom*0.42+stack*wall_env*0.95
side_src=[ (wallnoise*wall_env*0.75+tear*1.6+crack*1.4+crackle*wall_env*0.7),
           (np.roll(wallnoise,1700)*wall_env*0.75+np.roll(tear,260)*1.6+crack*1.4+np.roll(crackle,997)*wall_env*0.7)]
L=mid+side_src[0]; R=mid+side_src[1]
# 逆相の成分を少し足して手本のように広げる
w=wallnoise*wall_env*0.6; L+=w; R-=w
# --- 5. 切る（1.0秒で突然切れる）
cut=np.where(t<WALL,1.0,0.0); cutfade=np.clip((WALL-t)/0.004,0,1)*cut
Lw=L*cutfade; Rw=R*cutfade
# --- 6. 段になって落ちるゲート残響：壁の中高域を、疑似IR（0.2秒ごとの段で -7dB ずつ）にかける。切れた後の約1.1秒
irlen=int(1.2*SR); tt=np.arange(irlen)/SR
steps=np.floor(tt/0.2); ir_env=10**(-(7*steps)/20)*np.exp(-tt/1.6)
irL=rng.standard_normal(irlen)*ir_env; irR=rng.standard_normal(irlen)*ir_env
def lpmid(x): return lp(hp(x,200),7000,2)
srcL=lpmid(Lw); srcR=lpmid(Rw)
wetL=sg.fftconvolve(srcL[:int(WALL*SR)+10],irL)[:N]*0.03; wetR=sg.fftconvolve(srcR[:int(WALL*SR)+10],irR)[:N]*0.03
Lo=Lw+wetL; Ro=Rw+wetR
# --- 7. 潰して張り付かせる（手本は -10dB 平均・最大 0dB）：ゆるいコンプ＋ソフトクリップ→最大 -0.3dBFS
out=np.stack([Lo,Ro],1)
def soft(x,drive): return np.tanh(drive*x)/np.tanh(drive)
pk0=np.abs(out).max(); out=out/pk0
out=soft(out,2.4)
# 長い尾は小さいまま残す（tanh が持ち上げすぎた分を戻す）
tailmask=np.clip((t-WALL)/0.02,0,1)
out=out*(1-tailmask[:,None]*0.0)
out=out/np.abs(out).max()*0.966    # -0.3 dBFS
# 先頭 1 サンプルから全開（立ち上がりなし）。末尾は 20ms でゼロへ
out[-int(0.02*SR):]*=np.linspace(1,0,int(0.02*SR))[:,None]
np.save('thunder_new.npy',out.astype(np.float32))
wf.write('jp_thunder_new_1031.wav',SR,(out*32767).astype(np.int16))
rms=20*np.log10(np.sqrt((out**2).mean())); rms_wall=20*np.log10(np.sqrt((out[:int(WALL*SR)]**2).mean()))
print('peak',20*np.log10(np.abs(out).max()),'rms all',rms,'rms wall',rms_wall, 'side/mid', np.sqrt(((out[:,0]-out[:,1])**2).mean())/np.sqrt((((out[:,0]+out[:,1])/2)**2).mean()))
