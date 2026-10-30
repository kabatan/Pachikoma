#!/usr/bin/env python3
# 10/31 第2弾: 音の種類を増やす(東京喰種に寄らない)。有名な当たり音・演出音の「構成」(立ち上がり・音階・リズム・音色・長さ)だけを写した合成のパロディ。
# 旋律・録音は一切使わない。構成の出典は REFERENCE.md の表。  python3 synth_lift2.py [名前...]
import numpy as np, sys
from synth_lift import *
from scipy.signal import lfilter
_hz = hz
def hz(n): return float(n) if not isinstance(n, str) else _hz(n)
# ---- ラウドネス(BS.1770 の K 重み付け, 48k) ----
def lufs(x2):
    b1=[1.53512485958697,-2.69169618940638,1.19839281085285]; a1=[1,-1.69065929318241,0.73248077421585]; b2=[1,-2,1]; a2=[1,-1.99004745483398,0.99007225036621]
    k=lfilter(b2,a2,lfilter(b1,a1,x2,axis=-1),axis=-1); n=int(.4*SR); h=int(.1*SR); z=(k**2).sum(axis=0); cs=np.concatenate([[0],np.cumsum(z)]); idx=np.arange(0,max(1,len(z)-n+1),h)
    m=(cs[np.minimum(idx+n,len(z))]-cs[idx])/n; M=-.691+10*np.log10(m+1e-12); g=M>-70
    if not g.any(): return -70
    rel=-.691+10*np.log10((10**((M[g]+.691)/10)).mean())-10; g2=M>rel
    return -.691+10*np.log10((10**((M[g2]+.691)/10)).mean())
def finish(x2, target=TARGET_WIN, I=-9.5, peak=.98):
    # 帯域を手本へ寄せ、100Hz以下を絞り、ラウドネス I に揃えてから天井(.98)へソフトに収める。全部の素材の「実質の大きさ」を揃えて、場面の階段を設計しやすくする
    x2 = np.stack([hp(c, 50) for c in x2]); x2 = x2 - .6 * np.stack([lp(c, 100) for c in x2])
    if target is not None: x2 = match_eq(x2, target, .6)
    for _ in range(3):
        g = 10 ** ((I - lufs(x2)) / 20); x2 = sat(x2 * g, 1.0) / np.tanh(1.0) * .985 if False else np.tanh(x2 * g * .9) / np.tanh(.9)
        x2 = x2 / (np.abs(x2).max() + 1e-9) * peak
    return x2
# ---- 楽器 ----
def marimba(f, d=.6, g=1.0):
    t=T(d); y=np.sin(2*np.pi*f*t)*np.exp(-t/.28)+.4*np.sin(2*np.pi*f*4*t)*np.exp(-t/.07)+.15*np.sin(2*np.pi*f*10*t)*np.exp(-t/.02)
    y[:int(.002*SR)]*=np.linspace(0,1,int(.002*SR)); return y*g
def steel(f, d=.9, g=1.0):
    t=T(d); v=1+.004*np.sin(2*np.pi*5.5*t); return g*(np.sin(2*np.pi*f*v*t)+.5*np.sin(2*np.pi*f*2.01*t)*np.exp(-t/.3)+.25*np.sin(2*np.pi*f*3.02*t)*np.exp(-t/.15))*np.exp(-t/.5)
def pluckKS(f, d=.8, g=1.0, bright=.5, seed=1):
    n=int(d*SR); N=max(2,int(SR/f)); buf=np.random.default_rng(seed).uniform(-1,1,N)*bright+np.random.default_rng(seed+1).uniform(-1,1,N)*(1-bright)*.3; y=np.zeros(n)
    for i in range(n): j=i%N; y[i]=buf[j]; buf[j]=.5*(buf[j]+buf[(j+1)%N])*.9965
    return y*g
def flute(f, d=.5, g=1.0, vib=5.5):
    t=T(d); v=1+.006*np.sin(2*np.pi*vib*t)*np.minimum(1,t/.15); ph=2*np.pi*np.cumsum(f*v)/SR
    y=np.sin(ph)+.12*np.sin(2*ph)+.04*np.sin(3*ph); br=bp(noise(d,int(f)),f*.9,f*1.1)*.5+hp(noise(d,int(f)+1),f*3)*.03
    e=np.minimum(1,t/.04)*np.where(t<d-.06,1,np.maximum(0,(d-t)/.06)); return (y+br)*e*g
def taiko(g=1.0, f=95, d=.9):
    t=T(d); y=sweep(f*1.6,f,d,.05)*np.exp(-t/.25); n=bp(noise(.05,7),300,2500)*np.exp(-T(.05)/.012); y[:len(n)]+=n*.5; return y*g
def shime(g=1.0): d=.18; t=T(d); return (bp(noise(d,8),600,6000)*np.exp(-t/.03)+.5*np.sin(2*np.pi*330*t)*np.exp(-t/.05))*g
def kane(f=1500, d=.5, g=1.0): t=T(d); return g*sum(a*np.sin(2*np.pi*f*r*t)*np.exp(-t/(d/(2+r))) for r,a in ((1,1),(1.51,.7),(2.66,.5),(4.2,.3)))
def clack(g=1.0): d=.06; t=T(d); return (bp(noise(d,9),1200,4500)*np.exp(-t/.008)+.6*np.sin(2*np.pi*1800*t)*np.exp(-t/.012))*g
def conga(g=1.0, f=210): d=.25; t=T(d); return g*sweep(f*1.2,f,d,.03)*np.exp(-t/.08)
def chug(f, d=.16, g=1.0, dist=6):   # 歪んだギターのパワーコード(ミュート)
    t=T(d); y=sum(np.sin(2*np.pi*f*r*t+k)*np.sign(1)+0.0 for k,r in enumerate((1,1.5,2)))
    saw=sum(((2*((f*r*t)%1)-1)) for r in (1,1.5,2,3)); y=sat(lp(saw,2800)*3,dist/3); return y*np.minimum(1,t/.003)*np.exp(-t/(d*.45))*g
def lead(f0, f1, d, g=1.0):  # ギターのリード:ピッチベンド+ビブラート
    t=T(d); f=f0+(f1-f0)*np.minimum(1,t/(d*.35)); f=f*(1+.012*np.sin(2*np.pi*6*t)*np.clip(t-.15,0,1)); ph=2*np.pi*np.cumsum(f)/SR; y=sat(lp(2*((ph/(2*np.pi))%1)-1,3500)*2.5,1.5)
    return y*np.minimum(1,t/.02)*np.where(t<d-.08,1,np.maximum(0,(d-t)/.08))*g
def asaw(f, d=.18, g=1.0, cut=2800, att=.002):   # 電子アルペジオの音
    t=T(d); y=np.zeros(len(t))
    for det in (-.004,.004): y+=2*((f*(1+det)*t)%1)-1
    y=lp(y*.5,cut); return y*np.minimum(1,t/att)*np.exp(-t/(d*.55))*g
def myun(f0, d=.9, g=1.0, rate=22, depth=.5):    # 「ミュンミュン」:FMで揺れながら上がる
    t=T(d); f=f0*(1+1.2*(t/d)**1.5); m=np.sin(2*np.pi*rate*t)*depth*f*.15/rate*rate; ph=2*np.pi*np.cumsum(f)/SR+depth*3*np.sin(2*np.pi*rate*t)
    return np.sin(ph)*np.minimum(1,t/.02)*np.where(t<d-.05,1,np.maximum(0,(d-t)/.05))*g
def strings(f, d=1.5, g=1.0, att=.25):
    t=T(d); y=np.zeros(len(t))
    for det in (-.006,-.002,.002,.006): y+=2*((f*(1+det)*t)%1)-1
    y=lp(y*.25,2600)*(1+.06*np.sin(2*np.pi*6*t)); return y*np.minimum(1,t/att)*np.where(t<d-.2,1,np.maximum(0,(d-t)/.2))*g
def coin(g=1.0, f=3000): return bell(f,.4,g,(1,2.4,4.1),(1,.4,.2))
def bubble(f0=300, f1=1400, g=1.0): d=.09; t=T(d); return np.sin(2*np.pi*np.cumsum(f0+(f1-f0)*(t/d)**1.5)/SR)*np.exp(-t/.03)*g
def tom(f=110,g=1.0,d=.5): return kick(d,f*1.5,f,g,click=.15)
def at(y,x,t,g=1.0): add(y,x,t,g)
def stab(y,notes,t,d,g=.4,bright=4800,rel=.12,att=.01):
    for nt in notes: add(y,brass(hz(nt) if isinstance(nt,str) else nt,d,att,rel,bright),t,g)
def shower(y,t0,t1,n,g=.2,seed=3,lo=1800):
    r=np.random.default_rng(seed)
    for _ in range(n): add(y,coin(1.0,lo*2**(r.random()*2.2)),t0+r.random()*(t1-t0),g*(.5+.5*r.random()))
def out(y,wide=.8,t60=1.8,wet=.22,target=TARGET_WIN,I=-11.2):
    x=st(y,wide); x=rev(x,t60,wet); return finish(x,target,I)
# ================= JP成功 (家族 × 変種) =================
def win_P(v):   # ジャグラー/パチスロの「ペカ」:二音の光り+ピロリロリン+ガコッ+陽気なファンファーレ(短い)  5s
    y=np.zeros(int(5.2*SR)); r=np.random.default_rng(100+v)
    for i,(nt,t0) in enumerate((('C6',0),('G6',.12))): add(y,steel(hz(nt),.5,1),t0+0,.5); add(y,asaw(hz(nt),.5,.5,5000),t0,.3)
    add(y,kick(.35,170,70,click=1),.3,.9); add(y,snare(.25),.3,.7)   # ガコッ
    scale=[['C5','E5','G5','C6','E6','G6','C7'],['D5','F#5','A5','D6','F#6','A6','D7'],['F5','A5','C6','F6','A6','C7','F7']][v]
    for k,nt in enumerate(scale*2): add(y,marimba(hz(nt),.4,1),.55+k*.065,.55*np.exp(-k*.02))   # ピロリロリン
    base=[('C4','E4','G4','C5'),('D4','F#4','A4','D5'),('F4','A4','C5','F5')][v]
    for k,t0 in enumerate((1.5,1.84,2.18)): stab(y,base,t0,.22,.38,5500,.1); add(y,kick(.3,120,60,click=.5),t0,.7); add(y,shaker(.15) if False else snare(.15),t0+.17,.3)
    stab(y,base,2.55,1.6,.45,6500,.7); add(y,crash(2.6,.7,120+v),2.55,.6); shower(y,2.55,4.8,40,.22,200+v,2200)
    return out(y,.9,1.6,.2)
def win_M(v):   # 海物語風:マリンバ/スチールパンの陽気な上昇→大きな和音→波・泡。 6s
    y=np.zeros(int(6.2*SR)); bpm=[168,150,184][v]; b=60/bpm/2; key=[0,2,-2][v]; sh=lambda nt: hz(nt)*2**(key/12)
    penta=['A3','C#4','E4','F#4','A4','C#5','E5','F#5','A5','C#6','E6']
    if v==0:
        for k,nt in enumerate(penta+penta[-3::-1]): add(y,marimba(sh(nt),.5,1),k*b,.6); 
        add(y,kick(.3,130,60,click=.4),0,.8)
    elif v==1:
        pat=[0,2,3,5,3,2,0,-1, 0,2,3,5,7,5,3,2]
        for k,p in enumerate(pat): add(y,steel(sh(penta[3+p-(-1)] if 0<=3+p+1<len(penta) else 'A4'),.5,1),k*b,.55); 
        for k in range(0,16,2): add(y,conga(1.0,200+10*(k%4)),k*b,.5)
    else:
        for k,nt in enumerate(penta[::-1]): add(y,marimba(sh(nt),.6,1),k*b*.8,.55)
        for k in range(12): add(y,bubble(300+40*k,1400+100*k),.2+k*.09,.4)
    t1=len(penta)*b if v!=1 else 16*b; t1=min(t1+.1,3.2)
    stab(y,[sh(n) for n in ('A3','E4','A4','C#5','E5')],t1,1.2,.42,6000,.6); add(y,crash(3,.75,130+v),t1,.7); add(y,kick(.5,130,60,click=.8),t1,1.0); add(y,snare(.3),t1,.6)
    for k in range(7): add(y,steel(sh(['A5','C#6','E6','A6','E6','C#6','A5'][k]),.8,1),t1+.25+k*.11,.4)
    shower(y,t1+.2,5.8,60,.25,300+v,1800)
    nw=lp(noise(2.5,40+v),1800)*np.sin(np.pi*T(2.5)/2.5)**2; add(y,nw,t1,.5)   # 波
    return out(y,1.0,2.0,.22)
def win_J(v):   # ルパン風ビッグバンド:シンコペのブラスの決め→ベース・ボンゴ→フォール  6s
    y=np.zeros(int(6.4*SR)); bpm=[138,126,150][v]; q=60/bpm; root=['F2','C3','G2'][v]; sc=[hz(root)*2**(k/12) for k in (0,7,12,15 if v!=1 else 16,19)]
    ch=[hz(root)*2*2**(k/12) for k in (0,3 if v!=1 else 4,7,10,14)]
    rhythm=[(0,.25),(.75,.25),(1.5,.25),(2.0,.25),(2.75,.25),(3.5,.6)] if v!=1 else [(0,.2),(.67,.2),(1.0,.2),(1.67,.2),(2.0,.2),(2.67,.2),(3.0,.8)]
    for k,(bt,dd) in enumerate(rhythm): stab(y,ch,bt*q,dd*q,.42,5200,.06,.006); add(y,kick(.3,120,55,click=.5),bt*q,.7); 
    for k in range(32): add(y,pluckKS(hz(root)*2**([0,4,7,9][k%4]/12),.3,1,.4,k),k*q/2,.5); add(y,conga(1.0,190+30*(k%3)),k*q/2+q/4,.35)
    for k in range(16): add(y,hp(noise(.3,50+k),6000)*np.exp(-T(.3)/.08),k*q/2,.18)   # ライド
    tf=4.1*q
    stab(y,ch,tf,.5*q,.48,6500,.7); add(y,crash(3.0,.8,140+v),tf,.7); add(y,kick(.5,130,60,click=.8),tf,1.0); add(y,snare(.3),tf,.7)
    # フォール(音が滑り落ちる)
    for n_ in ch[:4]: tt=T(1.2); ph=2*np.pi*np.cumsum(n_*(1-.5*(tt/1.2)**1.4))/SR; s=sum(np.sin(ph*h)/h for h in range(1,9)); add(y,lp(s,3500)*np.exp(-tt/.7)*np.minimum(1,tt/.01),tf+.5*q,.25)
    shower(y,tf,tf+1.8,25,.14,400+v,3000)
    return out(y,.8,1.4,.18)
def win_T(v):   # 和・祭(源さん/慶次風):太鼓の連打→拍子木→祭り囃子(鉦・締太鼓)→笛・三味線→大太鼓の締め  7s
    y=np.zeros(int(7.2*SR)); r=np.random.default_rng(500+v)
    if v==0: sc=['D5','D#5','G5','A5','A#5','D6']; sh=['D3','A3','D4']     # 都節(陰旋法)
    else: sc=['D5','E5','G5','A5','B5','D6']; sh=['D3','A3','D4']           # 民謡/祭り(陽旋法)
    n=14
    for k in range(n): add(y,taiko(.5+.5*k/n,95+k),k*(.17-.0045*k),.8)       # 加速する連打
    tc=n*.15+.15
    for i in range(4): add(y,clack(1.0),tc+i*.14,.9)                             # 拍子木
    t0=tc+.7
    pat=[0,1,0,1,1,0,1,0] if v==0 else [1,0,1,1,0,1,1,0]
    for k in range(16):
        add(y,kane(1500 if k%2==0 else 1900,.25,1),t0+k*.14,.35)
        if pat[k%8]: add(y,shime(1.0),t0+k*.14,.45)
        if k%4==0: add(y,taiko(1.0,90),t0+k*.14,.8)
    mel=([0,2,4,2,1,0,1,3,5,3] if v==0 else [0,1,2,3,2,1,0,2,4,5])
    for k,mi in enumerate(mel): add(y,flute(hz(sc[mi%6])*(2 if mi>4 else 1),.28 if k<9 else .8,1),t0+.2+k*.28,.5)
    for k,tt in enumerate((0,.56,1.12,1.68,2.24)): 
        for j,ns in enumerate(sh): add(y,pluckKS(hz(ns)*(2 if j==2 else 1),.9,1,.7,k*3+j),t0+tt,.45)
    te=t0+3.0
    add(y,taiko(1.5,80,1.5),te,1.4); add(y,kane(1000,1.5,1),te,.5); add(y,crash(2.5,.7,150+v),te,.55); add(y,kick(.6,100,55,click=.3),te,1.0)
    stab(y,['D3','A3','D4','F#4' if v else 'F4','A4'],te,1.8,.3,3500,.9,.02)
    shower(y,te,te+2.5,18,.12,600+v,2500)
    return out(y,.9,1.8,.2)
def win_E(v):   # 電子(エヴァ/とある/シンフォギア風):ミュンミュン・アルペジオ・グリッチ・ビーム・ピアノ  6s
    y=np.zeros(int(6.4*SR))
    if v==0:    # アルペジオの上昇(190BPM 16分)
        add(y,myun(300,.9,1),0,.5); s=190; b=60/s/4; sc=[hz(n) for n in ('E3','G3','B3','D4','E4','G4','B4','D5','E5','G5','B5','D6','E6')]
        for k in range(26): add(y,asaw(sc[min(k//2,12)],.14,1,1500+k*220),.8+k*b,.55)
        for k in range(8): add(y,tom(120+5*k,.8,.2),.8+k*b*3,.6)
        tf=.8+26*b+.05
    elif v==1:  # レールガン:充電の唸り→一瞬の無音→ビーム
        t=T(1.5); u=t/1.5; ph=2*np.pi*np.cumsum(300+3500*u**2.2)/SR; add(y,(np.sin(ph)+.3*np.sin(2*ph))*u**1.5*np.minimum(1,t/.1),0,.45)
        for k in range(12): add(y,coin(1.0,2500+300*k),.2+k*.1,.1)
        tf=1.65
        z=bp(noise(1.2,70),400,9000)*np.exp(-T(1.2)/.4); add(y,z,tf,1.0); add(y,sweep(2500,300,.5,.1)*np.exp(-T(.5)/.2),tf,.7)
    else:       # ピアノ(下降グリッサンド)+金属のクラッシュ+パッド(シンフォギア風)
        add(y,kane(900,1.5,1),0,.6); add(y,crash(1.5,.7,160),0,.5); 
        for k in range(14): add(y,pianoish(hz('E6')*2**(-k*[2,2,1,2,2,2,1][k%7]/12),.9),.15+k*.075,.5)
        tf=1.4
        for k in range(9): add(y,asaw(hz(['E4','G4','B4','E5','G5','B5','E6','G6','B6'][k]),.12,1,4500),tf+k*.045,.4)
        tf+=.5
    for n_ in ('E3','B3','E4','G4','B4'): add(y,strings(hz(n_),3.5,.25,.05),tf,1.0)
    stab(y,['E2','E3','B3','E4','G4','B4'],tf,2.0,.38,6500,.9,.01); add(y,crash(3,.8,170+v),tf,.7); add(y,kick(.6,130,58,click=.9),tf,1.1); add(y,snare(.35),tf,.7)
    shower(y,tf,min(6.0,tf+3),28,.16,700+v,2800)
    return out(y,1.0,1.8,.2)
def pianoish(f,d=.9,g=1.0):
    t=T(d); return g*sum(a*np.sin(2*np.pi*f*h*t*(1+.0004*h*h))*np.exp(-t/(d/(1.5+h*.6))) for h,a in ((1,1),(2,.5),(3,.3),(4,.2),(5,.1)))*np.minimum(1,t/.002)
def win_R(v):   # ロック(北斗風):パームミュートのリフ→ダブルキック→ギターのベンド→パワーコード  6.5s
    y=np.zeros(int(6.8*SR)); root=[hz('E2')*2,hz('A2')*2][v]; bpm=[172,160][v]; b=60/bpm/2
    riff=[0,0,3,0,0,5,0,3,0,0,3,0,5,3,2,0] if v==0 else [0,0,0,3,0,0,5,3, 0,0,0,7,5,3,2,0]
    for k,s_ in enumerate(riff): add(y,chug(root*2**(s_/12),b*.9,1),k*b,.7); add(y,kick(.2,120,55,click=.7),k*b,.7 if k%2==0 else .4)
    for k in range(4,16,4): add(y,snare(.2),k*b,.8)
    tf=len(riff)*b
    for k in range(16): add(y,kick(.18,120,52,click=.7),tf-1.0+k*.0625,.6)     # ダブルキック
    for k in range(8): add(y,snare(.12),tf-.5+k*.0625,.4+.05*k)
    add(y,lead(hz('B4'),hz('E5') if v==0 else hz('A5'),1.6,.5),tf,.55)
    for r_ in (1,1.5,2,3,4): add(y,chug(root*r_,1.8,1,8),tf,.45)
    stab(y,[root*2,root*3,root*4,root*6],tf,1.8,.28,5000,.9,.01); add(y,crash(3.2,.9,180+v),tf,.7); add(y,kick(.6,125,55,click=.9),tf,1.1)
    shower(y,tf+.3,tf+2.5,16,.1,800+v,2600)
    return out(y,.9,1.2,.15)
def win_O(v):   # オーケストラ壮大(牙狼/ガンダムUC風):ティンパニ・ロール→ブラスのコラール→ハープ→シンバル  9s
    y=np.zeros(int(10.0*SR))
    n=24
    for k in range(n): add(y,tom(85,.4+.9*(k/n)**1.3,.4),k*.075,.7)
    t1=1.9
    prog=[('D3','A3','D4','F#4','A4'),('B2','F#3','B3','D4','F#4'),('G2','D3','G3','B3','D4'),('A2','E3','A3','C#4','E4')] if v==0 else [('D3','A3','D4','F4','A4'),('A#2','F3','A#3','D4','F4'),('C3','G3','C4','E4','G4'),('D3','A3','D4','F#4','A4')]
    for i,ch in enumerate(prog):
        ti=t1+i*1.0; stab(y,ch,ti,.95,.35+.05*i,3200+900*i,.15,.08); 
        for n_ in ch[1:]: add(y,strings(hz(n_)*2,1.0,.22+.04*i,.12),ti,1.0)
        add(y,tom(80,1.0+.1*i,.5),ti,.7)
    t2=t1+4.0
    for k in range(18): add(y,pianoish(hz(['D5','F#5','A5','D6','F#6','A6'][k%6])*(2 if k>11 else 1),.8),t2-.4+k*.055,.35)   # ハープ風グリッサンド
    stab(y,['D2','D3','A3','D4','F#4','A4','D5'],t2,3.5,.5,6800,2.0,.03); add(y,crash(4.5,1.0,190+v),t2,.8); add(y,kick(.8,120,52,click=.8),t2,1.2); add(y,tom(70,1.5,.9),t2,1.0)
    for n_ in ('D4','A4','D5','F#5'): add(y,strings(hz(n_),4.5,.3,.05),t2,1.0)
    for k in range(10): add(y,tom(85,.5,.4),t2+1.0+k*.2,.7*np.exp(-k*.08))
    shower(y,t2,t2+4,24,.12,900+v,2000)
    return out(y,1.0,2.6,.3)
# ================= JPチャンス:入賞の衝撃 / 鎖の爆発 / ルーレットの回転(テーマ別) =================
def hit_B(stage):   # マリンバ+鉦+ベル (陽気だが強い)
    d=1.2+.1*stage; y=np.zeros(int(d*SR)); notes=['D5','F#5','A5','D6'][stage-1]; add(y,kick(.35,140,60,click=.7),0,.9); add(y,snare(.2),0,.5)
    for k in range(stage): add(y,marimba(hz(notes)*2**(k*4/12),.5,1),k*.05,.55)
    add(y,kane(1800,.9,1),0,.35); add(y,bell(hz(notes)*2,1.0),0,.2)
    if stage>=3: stab(y,[hz('D4'),hz('A4'),hz('D5')],0,.3,.3,5000,.2); add(y,crash(1.2,.5,210+stage),0,.4)
    return out(y,.6,1.0,.16,TARGET_CHANCE,-13)
def hit_C(stage):   # 和太鼓+鉦(ドン!)
    d=1.2+.1*stage; y=np.zeros(int(d*SR)); add(y,taiko(1.0+.1*stage,100-3*stage),0,1.0); add(y,shime(1.0),0,.5); add(y,kane(1100+150*stage,1.0,1),0,.4)
    if stage>=2: add(y,taiko(.8,130),.09,.6)
    if stage>=3: add(y,clack(1.0),.0,.5); add(y,clack(1.0),.12,.5)
    if stage>=4: add(y,crash(1.6,.7,220),0,.5); add(y,taiko(1.3,80),.18,1.0)
    return out(y,.5,.9,.12,TARGET_CHANCE,-13)
def hit_D(stage):   # 電子:ビーム/ザップ+アルペジオ
    d=1.0+.1*stage; y=np.zeros(int(d*SR)); add(y,sweep(4000,200,.25,.06)*np.exp(-T(.25)/.1),0,.7); add(y,kick(.3,150,60,click=.9),0,.9)
    for k in range(stage+2): add(y,asaw(hz('E4')*2**(([0,3,7,12,15,19][k])/12),.12,1,4000),.03+k*.045,.5)
    add(y,coin(1.0,3500),0,.3)
    if stage>=3: stab(y,['E3','B3','E4','G4'],0,.4,.28,6000,.2); add(y,crash(1.2,.6,230+stage),0,.4)
    return out(y,.8,.9,.14,TARGET_CHANCE,-13)
def break_B(big=False):  # 和:拍子木が割れ+太鼓+金属の鎖
    y=np.zeros(int((2.4 if big else 1.8)*SR)); add(y,taiko(1.6,80,1.2),0,1.0); add(y,clack(1.0),0,.8)
    for k in range(18): add(y,bp(noise(.2,300+k),1500,6500)*np.exp(-T(.2)/.02)+kane(2200+120*k,.2,.3),.02+k*.03,.5*np.exp(-k*.06))
    add(y,crash(1.6,.8,240),0,.6)
    if big: add(y,taiko(1.6,70,1.5),.25,1.0); stab(y,['D3','A3','D4'],.1,.6,.3,3500,.6)
    return out(y,.9,1.3,.18,TARGET_CHANCE,-12)
def break_D(big=False):  # 電子:ガラス割れ+ビーム+グリッチ
    y=np.zeros(int((2.4 if big else 1.8)*SR)); add(y,hp(noise(.8,250),3000)*np.exp(-T(.8)/.18),0,1.0); add(y,sweep(6000,150,.7,.12)*np.exp(-T(.7)/.25),0,.8); add(y,kick(.7,150,50,click=1),0,1.2)
    r=np.random.default_rng(9)
    for k in range(20): add(y,coin(1.0,1500+3000*r.random()),.05+r.random()*.9,.25)
    for k in range(6): add(y,asaw(hz('E3')*2**(k*3/12),.1,1,3000),.5+k*.05,.35)
    add(y,crash(1.8,.8,250),0,.5)
    if big: stab(y,['E2','B2','E3','G3','B3'],.1,.8,.3,5000,.7); add(y,tom(70,1.4,.9),.1,1.0)
    return out(y,1.0,1.4,.2,TARGET_CHANCE,-12)
def roll_C(L=2.0):   # 太鼓ロール(ドコドコ)
    y=np.zeros(int(L*SR)); n=20
    for k in range(n): add(y,taiko(.8 if k%2==0 else .55,100 if k%2==0 else 130,.35),k*L/n,1.0); 
    return finish(st(y,.4),TARGET_CHANCE,-13.5,.95)
def roll_E(L=2.0):   # 電子:16分のパルス+上がるノイズ
    y=np.zeros(int(L*SR)); n=32
    for k in range(n): add(y,asaw(hz('E3')*2**(([0,0,7,0,12,0,7,0][k%8])/12),L/n*1.2,1,1800+60*k),k*L/n,.8)
    nz=bp(noise(L,60),500,6000)*(np.arange(int(L*SR))/(L*SR))**1.2; add(y,nz,0,.3)
    return finish(st(y,.5),TARGET_CHANCE,-13.5,.95)
JOBS2={}
for v in range(3): JOBS2[f'al_win_P{v}']=(lambda v=v: win_P(v)); JOBS2[f'al_win_M{v}']=(lambda v=v: win_M(v)); JOBS2[f'al_win_J{v}']=(lambda v=v: win_J(v)); JOBS2[f'al_win_E{v}']=(lambda v=v: win_E(v))
for v in range(2): JOBS2[f'al_win_T{v}']=(lambda v=v: win_T(v)); JOBS2[f'al_win_R{v}']=(lambda v=v: win_R(v)); JOBS2[f'al_win_O{v}']=(lambda v=v: win_O(v))
for s_ in range(1,5): JOBS2[f'al_hitB_{s_}']=(lambda s_=s_: hit_B(s_)); JOBS2[f'al_hitC_{s_}']=(lambda s_=s_: hit_C(s_)); JOBS2[f'al_hitD_{s_}']=(lambda s_=s_: hit_D(s_))
JOBS2.update({'al_breakB':lambda: break_B(False),'al_breakB_big':lambda: break_B(True),'al_breakD':lambda: break_D(False),'al_breakD_big':lambda: break_D(True),'al_rollC':roll_C,'al_rollE':roll_E})
if __name__=='__main__':
    for k in (sys.argv[1:] or list(JOBS2)): write(k,JOBS2[k]())
