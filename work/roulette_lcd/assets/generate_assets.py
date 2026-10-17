#!/usr/bin/env python3
"""Deterministic CPU renderer for the roulette LCD assets.

Run: OPENBLAS_NUM_THREADS=1 python3 work/roulette_lcd/assets/generate_assets.py
No network, GPU, external writes, or .blend files. All output is beside this file.
Surfaces use height-field normals, reflected strip lights, Fresnel response,
machining/engraving and distance-field chamfers; PNGs contain straight RGBA.
"""
from pathlib import Path
import argparse, json, math, hashlib
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc'
F = np.float32
PI = np.pi
ADD = set()

def sat(x): return np.clip(x, 0, 1)
def smooth(a,b,x):
    t=sat((x-a)/(b-a)); return t*t*(3-2*t)
def gauss(x,c,s): return np.exp(-.5*((x-c)/s)**2)
def grid(w,h=None):
    h=h or w
    y,x=np.mgrid[:h,:w].astype(F)
    return (x-(w-1)/2)/(w/2), (y-(h-1)/2)/(w/2)
def polar(n):
    x,y=grid(n); r=np.hypot(x,y); a=np.arctan2(x,-y)
    return x,y,r,a
def rgb(c, shape): return np.broadcast_to(np.array(c,dtype=F),(*shape,3)).copy()
def composite(dst,src,mask): return dst*(1-mask[...,None])+src*mask[...,None]
def edgezero(a,k=2):
    a[:k]=0; a[-k:]=0; a[:,:k]=0; a[:,-k:]=0
    return a
def png(name,color,alpha=None,add=False):
    color=np.clip(color,0,255)
    # No palette conversion, no premultiplication. 7-bit RGB retains strip-light
    # gradation while keeping the complete delivery within the 16 MB budget.
    color=(np.rint(color/2)*2).clip(0,255).astype('uint8')
    h,w=color.shape[:2]
    if alpha is None: alpha=np.ones((h,w),F)
    aa=np.rint(sat(alpha)*255).astype('uint8'); edgezero(aa,1)
    if add:
        edgezero(color,2); ADD.add(name)
    color[aa==0]=0
    Image.fromarray(np.dstack([color,aa]),'RGBA').save(ROOT/name,optimize=True,compress_level=9)
    print(name,flush=True)
def normals(z,scale=1):
    # Integrate the height over a pixel footprint before differentiating. This
    # avoids staircase normals producing false bead-shaped chrome highlights.
    gy,gx=np.gradient(gaussian_filter(z.astype(F),.85))
    nx=-gx*scale; ny=-gy*scale
    nz=np.ones_like(nx); d=np.sqrt(nx*nx+ny*ny+1)
    return nx/d,ny/d,nz/d
def shade(z,base,scale=1,metal=.8,rough=.15):
    nx,ny,nz=normals(z,scale)
    # Reflection of the viewing vector in the actual surface normal.
    rx=2*nx*nz; ry=2*ny*nz; rz=2*nz*nz-1
    key=sat(-.43*nx-.57*ny+.69*nz)
    fill=sat(.65*nx+.25*ny+.42*nz)
    strip=gauss(rx+.38*ry,-.43,.035+rough*.15)*gauss(ry,-.2,.65)
    strip+=.48*gauss(rx-.2*ry,.67,.02+rough*.1)*gauss(ry,.35,.5)
    strip+=.16*gauss(ry,-.77,.04)*gauss(rx,0,.6)
    base=np.asarray(base,dtype=F)
    if base.ndim==1: base=rgb(base,z.shape)
    col=base*(.35+.65*key[...,None]+.13*fill[...,None])
    fres=.04+.96*(1-nz)**5
    col+=strip[...,None]*np.array([210,214,218],F)*(metal+.1)
    col+=fres[...,None]*np.array([47,52,59],F)
    return col
def mask_polygon(w,h,points,ss=3):
    im=Image.new('L',(w*ss,h*ss)); d=ImageDraw.Draw(im)
    d.polygon([(int(x*ss),int(y*ss)) for x,y in points],fill=255)
    return np.asarray(im.resize((w,h),Image.Resampling.LANCZOS),dtype=F)/255
def sdf(mask):
    d=cv2.distanceTransform((mask>.5).astype('uint8'),cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    return gaussian_filter(d,.65)
def bezier(p0,p1,p2,p3,n=60):
    t=np.linspace(0,1,n)[:,None]; return (1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3
def petal_points(cx,cy,size,angle=0):
    seg=[((0,-.69),(-.23,-1.06),(-.66,-.70),(-.52,-.12)),
         ((-.52,-.12),(-.39,.28),(-.12,.64),(0,.95)),
         ((0,.95),(.12,.64),(.39,.28),(.52,-.12)),
         ((.52,-.12),(.66,-.70),(.23,-1.06),(0,-.69))]
    p=np.concatenate([bezier(*[np.array(v) for v in s]) for s in seg])
    c,s=np.cos(angle),np.sin(angle)
    return np.c_[cx+size*(p[:,0]*c-p[:,1]*s),cy+size*(p[:,0]*s+p[:,1]*c)]
def engraving(n, count=5, ring=.62, size=.13, rotation=0):
    ss=3; im=Image.new('L',(n*ss,n*ss)); d=ImageDraw.Draw(im)
    for j in range(count):
        a=rotation+2*PI*j/count
        cx=n/2+np.sin(a)*ring*n/2; cy=n/2-np.cos(a)*ring*n/2
        for k in range(5):
            q=2*PI*k/5
            pts=petal_points(cx+np.sin(q)*size*n*.27,cy-np.cos(q)*size*n*.27,size*n*.18,q)
            d.line([tuple(p*ss) for p in pts],fill=255,width=max(2,round(n*ss/1100)))
    return np.asarray(im.resize((n,n),Image.Resampling.LANCZOS),dtype=F)/255

def rim():
    n=2048; x,y,r,a=polar(n)
    # Turned cross section: outer rolled lip, recessed channel, raised inner lip.
    z=18*smooth(.800,.818,r)-5*smooth(.826,.84,r)
    z-=7*smooth(.849,.86,r); z+=4*smooth(.91,.925,r)
    z+=10*smooth(.952,.965,r)-19*smooth(.978,.997,r)
    z-=1.1*gauss(r,.971,.0011)+1.4*gauss(r,.945,.0014)
    z-=1.0*gauss(r,.842,.0014)+.6*gauss(r,.929,.0007)
    z+=.005*np.sin(r*2100)+.002*np.sin(r*3000+a*3)
    base=rgb([19,22,26],r.shape)
    base+=((.5+.5*np.sin(a*2-1))*.8)[...,None]
    col=shade(z,base,1.0,metal=.80,rough=.12)
    # Broad, interrupted studio reflections across the rolled steel edges.
    env=gauss(np.sin(a+.64),0,.16)+.3*gauss(np.sin(a-1.55),0,.10)
    col+=env[...,None]*gauss(r,.979,.008)[...,None]*np.array([125,132,141])
    col-=gauss(r,.946,.002)[...,None]*9
    # Deep red glass inlay with a hot razor edge inside the protective inner lip.
    band=gauss(r,.8235,.0024)
    col+=band[...,None]*np.array([145,3,15])
    col+=gauss(r,.8215,.00065)[...,None]*np.array([85,30,27])*(.55+.45*env[...,None])
    # Exactly fifty engraved graduations, zero at twelve o'clock, clockwise.
    mark=np.zeros((n,n),F)
    for i in range(50):
        t=i*2*PI/50; da=np.arctan2(np.sin(a-t),np.cos(a-t))
        lo=.858 if i%5==0 else .876; hi=.906
        width=.0018 if i%5==0 else .0009
        m=(1-smooth(width,width+.0006,np.abs(da)))*smooth(lo,lo+.001,r)*(1-smooth(hi,hi+.001,r))
        mark=np.maximum(mark,m)
    col*=1-.80*mark[...,None]
    hi=np.roll(mark,1,axis=1)-mark
    col+=sat(hi)[...,None]*np.array([95,93,90])
    # Five recessed sakura-petal seats at exactly 72 degree spacing.
    holes=np.zeros((n,n),F)
    for i in range(5):
        t=i*2*PI/5
        p=petal_points(n/2+np.sin(t)*.932*n/2,n/2-np.cos(t)*.932*n/2,n*.010,t)
        holes=np.maximum(holes,mask_polygon(n,n,p,ss=1))
    d=sdf(holes); zhole=-3*smooth(0,3,d)
    hc=shade(zhole,[7,5,7],1.4,metal=.35)
    col=composite(col,hc,holes)
    col+=sat(np.roll(holes,2,axis=0)-holes)[...,None]*30
    alpha=smooth(.7995,.8005,r)*(1-smooth(.997,.9988,r))
    png('rl_rim.png',col,alpha)

def faces():
    n=1024; x,y,r,a=polar(n)
    eng=engraving(n,10,.65,.20,.25)+.4*engraving(n,5,.30,.12)
    eng=np.clip(eng,0,1)
    # Broad lacquer waviness underneath a polished clear coat, never white noise.
    wav=.5*np.sin(8*x+7*y)+.25*np.sin(23*x-17*y)+.12*np.sin(64*x+48*y)
    lines=.045*np.sin(1700*r+.2*np.sin(a*8))+.025*np.sin(3200*r)
    z=2.5*(1-r*r)+.09*wav+.025*lines-.24*gaussian_filter(eng,.65)
    coat=gauss(x+.34*y,-.46,.040)*gauss(y,-.32,.65)
    coat+=.4*gauss(x-.2*y,.66,.028)*gauss(y,.14,.43)
    sharp=(1-smooth(.009,.016,np.abs(x+.34*y+.485)))*gauss(y,-.44,.32)
    palettes=[[58,10,18],[179,0,27],[255,59,31],[8,9,12]]
    for i,base in enumerate(palettes,1):
        tone=.53+.43*r+.035*wav+.012*lines
        col=rgb(base,r.shape)*tone[...,None]
        col+=shade(z,[0,0,0],1.5,metal=.0,rough=.16)*.15
        col+=coat[...,None]*np.array([77,65,61])*(.25+.75*r[...,None])
        col+=sharp[...,None]*np.array([32,31,30])
        col+=(.38*np.sin(r*1700)+.18*np.sin(r*2700))[...,None]
        col+=gauss(r,.975,.002)[...,None]*np.array([43,26,28])
        if i==4:
            col+=eng[...,None]*np.array([32,33,37])
            col+=sat(np.roll(eng,1,0)-eng)[...,None]*29
            col+=gauss(r,.91,.001)[...,None]*np.array([17,19,23])
        else:
            col*=1-.10*eng[...,None]
            col+=sat(np.roll(eng,1,0)-eng)[...,None]*np.array([9,4,4])
        alpha=1-smooth(.988,.991,r)
        png(f'rl_face_{i}.png',col,alpha)

def dome():
    n=2048; x,y,r,a=polar(n)
    # Curved lightbox images reflected by a shallow spherical glass dome.
    arc=gauss(np.hypot(x+.02,(y+.02)*.98),.72,.008)
    arc*=gauss(a,-.62,.53)
    arc2=gauss(np.hypot(x+.02,y+.015),.691,.0025)*gauss(a,-.62,.49)
    soft=gauss(x+.43*y,-.52,.06)*gauss(y,-.25,.4)*(1-smooth(.69,.78,r))
    refr=gauss(r,.786,.0025)*(.12+.25*gauss(a,-.7,.8)+.12*gauss(a,2.2,.5))
    weak=gauss(r,.735,.009)*gauss(a,2.30,.35)
    col=rgb([0,0,0],r.shape)
    col+=(arc*.8+arc2*.3+soft*.1)[...,None]*np.array([188,199,210])
    col+=refr[...,None]*np.array([142,153,173])+weak[...,None]*np.array([29,21,24])
    rng=np.random.default_rng(272)
    dust=Image.new('L',(n,n)); d=ImageDraw.Draw(dust)
    for _ in range(130):
        px,py=rng.uniform(-.73,.73,2)
        if px*px+py*py>.74**2: continue
        xx=n/2+px*n/2; yy=n/2+py*n/2
        d.line((xx,yy,xx+rng.uniform(3,15),yy+rng.uniform(-2,2)),fill=int(rng.uniform(2,10)),width=1)
    col+=np.asarray(dust,dtype=F)[...,None]
    col*= (1-smooth(.791,.799,r))[...,None]
    png('rl_dome.png',col,add=True)

def hub():
    n=512; x,y,r,a=polar(n)
    z=48*np.sqrt(sat(1-(r/.91)**2))+3*gauss(r,.84,.025)-2*gauss(r,.78,.009)
    engr=engraving(n,1,0,.65)
    z-=1.4*gaussian_filter(engr,1)
    col=shade(z,[24,27,32],1.3,metal=.9,rough=.08)
    col+=gauss(r,.875,.006)[...,None]*np.array([65,64,67])
    col*=1-.65*engr[...,None]
    # A low-cut ruby: angular pavilion facets, dark girdle, tiny white reflections.
    sides=10; sector=np.floor((a+PI)*sides/(2*PI))
    gem=smooth(.268,.257,r)
    v=.3+.55*(1-r/.28)+.18*np.sin(sector*1.9)
    gc=rgb([171,2,25],r.shape)*v[...,None]
    gc+=gauss(r,.255,.007)[...,None]*np.array([100,8,25])
    gc+=gauss(x,-.085,.02)[...,None]*gauss(y,-.10,.065)[...,None]*np.array([240,204,193])
    gc+=gauss(x+y,-.1,.008)[...,None]*(r<.17)[...,None]*np.array([70,21,24])
    col=composite(col,gc,gem)
    png('rl_hub.png',col,1-smooth(.918,.925,r))

def needle():
    w,h=1024,2048; yy,xx=np.mgrid[:h,:w].astype(F)
    p=[(512,27),(581,723),(558,930),(512,1021),(466,930),(443,723)]
    mask=mask_polygon(w,h,p); dist=sdf(mask)
    z=5*smooth(0,9,dist)+.035*np.abs(xx-512)
    col=shade(z,[58,63,71],1.8,metal=1,rough=.055)
    side=np.where(xx<512,1,.0)
    col+=side[...,None]*np.array([56,60,66])
    col+=gauss(dist,3.4,1.1)[...,None]*np.array([105,103,99])
    brushed=(np.sin(yy*.55+xx*.02)+np.sin(yy*1.8+xx*.03))*1.1
    col+=brushed[...,None]
    taper=sat((yy-28)/140)*(1-smooth(930,1019,yy))
    line=gauss(xx,512,1.8)*taper
    col+=line[...,None]*np.array([198,7,24])
    col+=gauss(xx,512,5)[...,None]*taper[...,None]*np.array([44,0,5])
    # Small machined root fitting entirely above the image's pivot.
    socket=mask_polygon(w,h,[(472,936),(552,936),(546,1016),(478,1016)])
    sd=sdf(socket); sc=shade(5*smooth(0,4,sd),[32,36,42],1.8,metal=.9)
    col=composite(col,sc,socket)
    mask=np.maximum(mask,socket); mask[1024:]=0
    png('rl_needle.png',col,mask)
    tip=np.exp(-((xx-512)/12)**2-((yy-31)/18)**2)
    halo=np.exp(-((xx-512)/35)**2-((yy-42)/48)**2)
    glow=tip[...,None]*np.array([255,240,220])+halo[...,None]*np.array([129,1,12])
    glow+=gauss(xx,512,8)[...,None]*taper[...,None]*np.array([22,0,2])
    glow*=smooth(3,20,yy)[...,None]*(1-smooth(1005,1024,yy))[...,None]
    png('rl_needle_glow.png',glow,add=True)

def divider_shadow_lamps():
    w,h=64,1024; y,x=np.mgrid[:h,:w].astype(F)
    taper=smooth(0,65,1023-y)
    mask=(1-smooth(8*taper,10*taper+1,np.abs(x-31.5)))*smooth(0,4,y)*smooth(0,5,1023-y)
    d=sdf(mask); z=3*smooth(0,4,d)
    col=shade(z,[67,70,76],1.8,metal=.95,rough=.05)
    col+=gauss(x,28,1)[...,None]*np.array([90,86,83])
    col*= (.4+.6*gauss(y,260,380))[...,None]
    png('rl_divider.png',col,mask)
    n=2560; x,y,r,a=polar(n); center=np.hypot(x,y-.038)
    shadow=.57*gauss(center,.77,.093)
    red=.20*gauss(r,.808,.052)*(.4+.6*gauss(a,2,.8))
    aa=(shadow+red)*(1-smooth(.93,.997,r))
    color=rgb([0,0,0],r.shape)
    color[...,0]=np.divide(red*98,aa,out=np.zeros_like(aa),where=aa>.001)
    color[...,2]=np.divide(red*15,aa,out=np.zeros_like(aa),where=aa>.001)
    png('rl_shadow.png',color,aa)
    n=128; x,y,r,a=polar(n)
    m=mask_polygon(n,n,petal_points(64,65,52,PI),ss=4)
    d=sdf(m); z=3*smooth(0,4,d)+3*smooth(0,18,d)
    col=shade(z,[22,5,10],2,metal=.3,rough=.08)
    col+=gauss(x+.3*y,-.12,.04)[...,None]*np.array([57,37,40])*(d>2)[...,None]
    col*=.65+.35*smooth(0,4,d)[...,None]
    png('rl_lamp_off.png',col,m)
    bulb=gauss(x,0,.24)*gauss(y,-.02,.45)*m
    on=bulb[...,None]*np.array([410,225,168])+m[...,None]*np.array([112,1,13])
    on+=gaussian_filter(m,4)[...,None]*np.array([44,0,4])
    on*=smooth(0,8,np.minimum.reduce([np.broadcast_to(np.arange(n)[:,None],(n,n)),np.broadcast_to(np.arange(n)[None,:],(n,n)),np.broadcast_to((n-1-np.arange(n))[:,None],(n,n)),np.broadcast_to((n-1-np.arange(n))[None,:],(n,n))]))[...,None]
    png('rl_lamp_on.png',on,add=True)

def trail():
    n=2048; x,y,r,a=polar(n)
    behind=np.mod(-a,2*PI); span=np.deg2rad(160)
    age=behind/span; sector=(behind<=span)*smooth(0,.03,behind)*(1-smooth(.82,1,age))
    strength=(1-age.clip(0,1))**1.5*sector
    radial=smooth(.55,.62,r)*(1-smooth(.987,.992,r))
    streak=(.28+.4*(.5+.5*np.sin(r*1350+np.sin(a*9)*3))**8)*smooth(.65,.99,r)
    streak+=1.3*gauss(r,.978,.002)+.65*gauss(r,.954,.001)
    col=(strength*radial*(.10+streak))[...,None]*np.array([210,23,20])
    col+=(strength**8*radial*(.15+streak))[...,None]*np.array([140,192,167])
    # Deterministic fine hot grains scattered along the swept outer annulus.
    rng=np.random.default_rng(711); im=Image.new('RGB',(n,n)); d=ImageDraw.Draw(im)
    for _ in range(850):
        t=rng.uniform(.015,span); rr=rng.uniform(.59,.985)
        power=(1-t/span)**2*(rr-.55)/.44
        px=n/2-np.sin(t)*rr*n/2; py=n/2-np.cos(t)*rr*n/2
        color=tuple(int(v*power) for v in [240,75,43])
        d.line((px,py,px+np.cos(t)*rng.uniform(1,7),py-np.sin(t)*rng.uniform(1,7)),fill=color,width=1)
    col+=np.asarray(im,dtype=F)
    col*=(radial*sector)[...,None]
    png('rl_arc_trail.png',col,add=True)

def text_asset(key,text):
    w,h=1800,640
    # Fit the actual ink box and reserve room for sidewalls and the glow.
    font=ImageFont.truetype(FONT,420,index=0)
    box=font.getbbox(text); sw,sh=box[2]-box[0],box[3]-box[1]
    im=Image.new('L',(sw+8,sh+8)); ImageDraw.Draw(im).text((4-box[0],4-box[1]),text,font=font,fill=255,stroke_width=1)
    scale=min(1480/im.width,410/im.height)
    im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
    im=im.crop(im.getbbox())
    # Move the face up-left by half the extrusion, keeping the whole object centered.
    mask=np.zeros((h,w),F); px=(w-im.width)//2-10; py=(h-im.height)//2-14
    mask[py:py+im.height,px:px+im.width]=np.asarray(im,dtype=F)/255
    d=sdf(mask); outer=cv2.dilate((mask>.5).astype('uint8'),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(19,19))).astype(F)
    od=sdf(outer)
    # Extruded 28 px sidewall built from successive silhouettes, with hard seams.
    ext=np.zeros_like(mask); depth=np.zeros_like(mask)
    for j in range(28,-1,-1):
        shift=np.roll(np.roll(outer,round(j*.73),1),j,0)
        idx=shift>.5; ext[idx]=1; depth[idx]=j/28
    xx,yy=grid(w,h)
    wall=rgb([26,4,10] if key!='all' else [18,20,25],mask.shape)
    wall*= (.5+.9*gauss(depth,.45,.20)+.3*np.sin(depth*34))[...,None]
    wall+=(gauss(depth,.92,.035)+gauss(depth,.13,.035))[...,None]*np.array([77,36,37] if key!='all' else [66,68,73])
    # Double chamfer: dark external steel, then a narrow bone-white/silver bevel.
    z=6*smooth(0,5,od)+7*smooth(0,9,d)
    base=rgb([139,4,24] if key!='all' else [12,14,19],mask.shape)
    gradient=.57+.28*(1-yy)+.10*np.sin(yy*14+xx*2)
    base*=gradient[...,None]
    bevel=(1-smooth(3.5,10,d))*mask
    base=composite(base,rgb([178,168,153] if key!='all' else [99,106,119],mask.shape),bevel)
    face=shade(z,base,1.3,metal=.7,rough=.085)
    # Crisp reflected lightbox across the upper letter faces and irregular dark red reflections.
    strip=gauss(yy+.09*xx,-.14,.023)
    face+=strip[...,None]*np.array([72,40,38] if key!='all' else [59,64,73])
    inner=gauss(d,12,1.2)*mask
    face+=inner[...,None]*np.array([45,2,9] if key!='all' else [28,31,37])
    outside=(outer-mask).clip(0,1)
    face=composite(face,shade(5*smooth(0,4,od),[31,29,31],1.5,metal=.85),outside)
    color=composite(wall,face,outer)
    # Hairline glint: only surfaces facing the upper-left key light catch it.
    gx=cv2.Sobel(z,cv2.CV_32F,1,0,ksize=3)/8; gy=cv2.Sobel(z,cv2.CV_32F,0,1,ksize=3)/8
    keyedge=sat((gx+gy)*.7)*gauss(d,4,2)
    color+=keyedge[...,None]*np.array([98,82,70] if key!='all' else [112,116,125])
    png(f'rl_t_{key}_face.png',color,ext)
    blur=gaussian_filter(ext,13)*.8+gaussian_filter(ext,32)*.45
    shift=np.roll(np.roll(blur,12,1),21,0)
    png(f'rl_t_{key}_shadow.png',rgb([0,0,0],mask.shape),sat(shift*.83))
    edge=(outer-cv2.erode(outer,np.ones((5,5),np.uint8))).clip(0,1)
    glow=gaussian_filter(edge,6)*2.0+gaussian_filter(edge,20)*1.3+gaussian_filter(edge,45)*.7
    gc=glow[...,None]*np.array([210,7,26] if key!='all' else [88,95,113])
    png(f'rl_t_{key}_glow.png',gc,add=True)

def light_strokes(core,red_gain=1):
    c=core.astype(F)/255
    hot=c[...,None]*np.array([255,231,205],F)
    hot+=gaussian_filter(c,1.4)[...,None]*np.array([215,48,34],F)
    hot+=gaussian_filter(c,5)[...,None]*np.array([265,4,22],F)*red_gain
    hot+=gaussian_filter(c,13)[...,None]*np.array([104,0,9],F)*red_gain
    return hot

def crack_frames(seed):
    rng=np.random.default_rng(seed); branches=[]
    # Jagged radial trunks; child cracks fork from existing vertices and keep
    # their parent's arrival time, so the reveal propagates rather than fades in.
    for j in range(8):
        angle=j*2*PI/8+rng.uniform(-.24,.24); length=rng.uniform(132,217)
        pos=np.array([256.,256.]); points=[pos.copy()]; arrivals=[0.]
        for k in range(1,15):
            d=angle+rng.normal(0,.37)
            pos=pos+np.array([np.cos(d),np.sin(d)])*length/14
            points.append(pos.copy()); arrivals.append(k/14*length/220)
        branches.append((np.array(points),np.array(arrivals),1.55))
        for k in [4,7,10]:
            pos=points[k].copy(); pts=[pos.copy()]; ts=[arrivals[k]]
            turn=angle+rng.choice([-1,1])*rng.uniform(.5,1.1)
            for q in range(1,6):
                d=turn+rng.normal(0,.35)
                pos=pos+np.array([np.cos(d),np.sin(d)])*rng.uniform(6,12)
                pts.append(pos.copy()); ts.append(arrivals[k]+q*.042)
            branches.append((np.array(pts),np.array(ts),.75))
    result=[]
    for f in range(24):
        t=f/23; reach=min(1.3,t/.38)
        envelope=smooth(0,.055,t)*(1-smooth(.55,.76,t))
        flicker=(.88+.12*np.sin(f*2.3)) if f<15 else 1
        im=np.zeros((1024,1024),np.uint8)
        for pts,times,width in branches:
            for k in range(1,len(pts)):
                if reach<times[k-1]: continue
                amount=sat((reach-times[k-1])/max(.001,times[k]-times[k-1]))
                end=pts[k-1]+(pts[k]-pts[k-1])*amount
                power=envelope*flicker*(.58+.42*sat(1-times[k]))
                # The advancing tip flashes hotter than the trailing fracture.
                power*=1+.35*gauss(times[k],reach,.13)
                cv2.line(im,tuple(np.rint(pts[k-1]*2).astype(int)),tuple(np.rint(end*2).astype(int)),int(min(255,power*235)),max(1,round(width*2)),cv2.LINE_AA)
        core=cv2.resize(im,(512,512),interpolation=cv2.INTER_AREA)
        col=light_strokes(core,1.45)
        x,y=grid(512); col+=np.exp(-(x*x+y*y)/.007)[...,None]*np.array([170,49,38])*envelope
        result.append(col)
    return result

def sweep_frames():
    w,h=1280,360; yy,xx=np.mgrid[:h,:w].astype(F); frames=[]
    for f in range(16):
        t=f/15; cx=-400+2080*t; cy=210-45*t
        u=xx-cx; v=yy-cy+.12*u
        env=np.sin(PI*t)**1.4
        line=gauss(v,0,1.1)*gauss(u,0,235)
        body=gauss(v,0,3.2)*gauss(u,0,175)
        red=gauss(v,0,12)*gauss(u,0,260)
        star=gauss(u,0,2.0)*gauss(v,0,55)
        col=line[...,None]*np.array([430,359,310])+body[...,None]*np.array([206,31,24])
        col+=red[...,None]*np.array([50,0,4])+star[...,None]*np.array([165,55,38])
        for offset in [-57,-23,35,71]:
            col+=gauss(v,offset,1)[...,None]*gauss(u,-offset*2,100)[...,None]*np.array([24,3,5])
        col*=env
        frames.append(col)
    return frames

def ember_frames():
    rng=np.random.default_rng(919); count=137; frames=[]
    a=rng.uniform(-PI,PI,count); speed=rng.uniform(70,211,count)
    vx=np.cos(a)*speed; vy=np.sin(a)*speed-70
    size=rng.choice([.55,.85,1.2,1.6,2.3],count,p=[.25,.31,.24,.15,.05])
    life=rng.uniform(.46,1.13,count); delay=rng.uniform(.00,.1,count)
    for f in range(24):
        t=f/23; im=np.zeros((1024,1024),np.uint8)
        for i in range(count):
            age=t-delay[i]
            if age<0 or age>life[i]: continue
            energy=smooth(0,.06,age)*(1-smooth(life[i]*.55,life[i],age))
            x=256+vx[i]*age/(1+.40*age)
            y=246+vy[i]*age+142*age*age
            if not (24<x<488 and 24<y<488): continue
            for k in range(9):
                old=max(0,age-k*.005*size[i])
                ox=256+vx[i]*old/(1+.40*old); oy=246+vy[i]*old+142*old*old
                pwr=energy*np.exp(-k*.32)
                cv2.circle(im,(round(ox*2),round(oy*2)),max(1,round(size[i]*2)),int(min(255,pwr*255)),thickness=-1,lineType=cv2.LINE_AA)
        core=cv2.resize(im,(512,512),interpolation=cv2.INTER_AREA)
        col=light_strokes(core,.7)
        frames.append(col)
    return frames

def effects():
    manifest={"version":1,"format":"WebP lossy","quality":94,"color_mode":"RGB","background":"black","blend":"ONE, ONE","fps_default":24,"black_gutter_pixels":20,"sampling":"Clamp to frame rectangle; half-texel inset; disable atlas mipmaps.","sheets":[]}
    generators=[('fb_crack_1',lambda:crack_frames(410),'中心から枝分かれして走る赤白の亀裂',1),('fb_crack_2',lambda:crack_frames(882),'別形状の赤白の亀裂',2),('fb_sweep_1',sweep_frames,'左から右へ横切る斜めのアナモルフィック光芒',1),('fb_ember_1',ember_frames,'中心から散って重力で落ちる軌跡付き火の粉',1)]
    for name,fn,purpose,variant in generators:
        frames=fn(); h,w=frames[0].shape[:2]; count=len(frames); cols=6 if count==24 else 4; rows=4
        sheet=Image.new('RGB',(w*cols,h*rows))
        yy,xx=np.mgrid[:h,:w].astype(F)
        boundary=np.minimum(np.minimum(xx,w-1-xx),np.minimum(yy,h-1-yy))
        gate=smooth(20,34,boundary)
        for f,frame in enumerate(frames):
            frame=np.uint8(np.clip(frame*gate[...,None],0,255))
            # Exactly black first/last frames for reliable one-shot scheduling.
            if f==0 or f==count-1: frame[:]=0
            sheet.paste(Image.fromarray(frame),(f%cols*w,f//cols*h))
        sheet.save(ROOT/f'{name}.webp','WEBP',quality=94,method=6)
        manifest['sheets'].append({"id":name,"file":f'{name}.webp',"frame_width":w,"frame_height":h,"cols":cols,"rows":rows,"frame_count":count,"fps":24,"purpose":purpose,"loop":False,"blend":"additive","variant":variant,"ray_count":None,"frame_order":"row-major, top-left first","loop_note":None})
        print(name,flush=True)
    (ROOT/'fb_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

def load(name): return Image.open(ROOT/name).convert('RGBA')
def over(base,name,xy=(0,0),size=None,blend='normal'):
    src=load(name)
    if size: src=src.resize(size,Image.Resampling.LANCZOS)
    if blend=='add':
        layer=Image.new('RGBA',base.size); layer.alpha_composite(src,xy)
        b=np.asarray(base,dtype=F); s=np.asarray(layer,dtype=F)
        b[...,:3]=np.clip(b[...,:3]+s[...,:3]*(s[...,3:4]/255),0,255)
        return Image.fromarray(b.astype('uint8'),'RGBA')
    base.alpha_composite(src,xy); return base

def assembly():
    n=2048; base=Image.new('RGBA',(n,n),(5,6,9,255))
    base=over(base,'rl_shadow.png',(-256,-256))
    x,y,r,a=polar(n); face=np.zeros((n,n,4),np.uint8)
    sector=np.floor(np.mod(a+PI/4,2*PI)/(PI/2)).astype(int)
    for i in range(4):
        src=load(f'rl_face_{i+1}.png').resize((1655,1655),Image.Resampling.LANCZOS)
        layer=Image.new('RGBA',(n,n)); layer.alpha_composite(src,((n-src.width)//2,(n-src.height)//2))
        arr=np.asarray(layer); hit=sector==i; face[hit]=arr[hit]
    base.alpha_composite(Image.fromarray(face,'RGBA'))
    # Preserve the divider's bottom-edge pivot when rotating.
    div=load('rl_divider.png').resize((52,819),Image.Resampling.LANCZOS)
    for j in range(4):
        layer=Image.new('RGBA',(n,n)); layer.alpha_composite(div,(n//2-div.width//2,n//2-div.height))
        layer=layer.rotate(-45-j*90,resample=Image.Resampling.BICUBIC,center=(1024,1024))
        base.alpha_composite(layer)
    base=over(base,'rl_dome.png',blend='add'); base=over(base,'rl_rim.png')
    for i in range(50):
        t=i*2*PI/50; px=1024+np.sin(t)*955; py=1024-np.cos(t)*955
        # Off glass is a normal layer; on is a separate ONE/ONE layer.
        lamp=load('rl_lamp_off.png').resize((29,29),Image.Resampling.LANCZOS).rotate(-i*7.2,resample=Image.Resampling.BICUBIC,expand=True)
        base.alpha_composite(lamp,(round(px-lamp.width/2),round(py-lamp.height/2)))
        if i in [47,48,49,0,1,2,3]:
            glow=load('rl_lamp_on.png').resize((29,29),Image.Resampling.LANCZOS).rotate(-i*7.2,resample=Image.Resampling.BICUBIC,expand=True)
            layer=Image.new('RGBA',base.size); layer.alpha_composite(glow,(round(px-glow.width/2),round(py-glow.height/2)))
            aa=np.asarray(base,dtype=F); bb=np.asarray(layer,dtype=F)
            aa[...,:3]=np.clip(aa[...,:3]+bb[...,:3]*(bb[...,3:4]/255),0,255)
            base=Image.fromarray(aa.astype('uint8'),'RGBA')
    base=over(base,'rl_needle.png',(512,0)); base=over(base,'rl_needle_glow.png',(512,0),blend='add')
    base=over(base,'rl_hub.png',(874,874),(300,300))
    return base

def label(d,xy,s,size=23,fill=(168,172,184)):
    d.text(xy,s,font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size),fill=fill)
def flatten(im,bg=(9,10,14)):
    out=Image.new('RGBA',im.size,(*bg,255)); out.alpha_composite(im); return out.convert('RGB')

def review():
    ass=assembly(); ass.convert('RGB').save(ROOT/'assembly.jpg',quality=94,subsampling=0)
    # Every delivered PNG and every decoded animation frame is included in QA.
    names=sorted(p.name for p in ROOT.glob('rl_*.png'))
    board=Image.new('RGB',(2560,3060),(7,8,12)); d=ImageDraw.Draw(board)
    label(d,(50,24),'ROULETTE / BLACK CHROME + CRIMSON LACQUER',29,(218,216,211))
    board.paste(ass.resize((1240,1240),Image.Resampling.LANCZOS).convert('RGB'),(20,80))
    label(d,(55,1335),'ASSEMBLY / FOUR WEDGES / 50 GRADUATIONS / 50 LAMPS',22)
    for j,key in enumerate(['dup','m1','m2','m3','all']):
        im=Image.new('RGBA',(1800,640),(7,8,12,255))
        im=over(im,f'rl_t_{key}_shadow.png'); im=over(im,f'rl_t_{key}_glow.png',blend='add'); im=over(im,f'rl_t_{key}_face.png')
        thumb=im.resize((1125,400),Image.Resampling.LANCZOS).convert('RGB')
        board.paste(thumb,(1350,75+j*430)); label(d,(1365,75+j*430),f'TYPE / {key.upper()}',18)
    component=[n for n in names if not n.startswith('rl_t_')]
    for j,name in enumerate(component):
        cx=20+(j%5)*250; cy=1435+(j//5)*247
        im=flatten(load(name)); im.thumbnail((230,205),Image.Resampling.LANCZOS)
        board.paste(im,(cx+(230-im.width)//2,cy+(205-im.height)//2)); label(d,(cx,cy+210),name,15)
    manifest=json.loads((ROOT/'fb_manifest.json').read_text())
    label(d,(45,2470),'ADDITIVE FRAME SEQUENCES / DECODED WEBP / FRAME 07',24)
    for j,s in enumerate(manifest['sheets']):
        fw,fh=s['frame_width'],s['frame_height']; f=7; col=f%s['cols']; row=f//s['cols']
        sheet=Image.open(ROOT/s['file']).convert('RGB')
        im=sheet.crop((col*fw,row*fh,(col+1)*fw,(row+1)*fh)); im.thumbnail((585,450),Image.Resampling.LANCZOS)
        ox=30+j*630; board.paste(im,(ox+(585-im.width)//2,2520+(450-im.height)//2))
        label(d,(ox,2990),f"{s['id']} / {s['frame_count']} f",20)
    board.save(ROOT/'preview.jpg',quality=91,subsampling=0)
    # Full-size PNG review tiles include all assets, with a one-third view and an
    # unscaled crop. Crops are selected at geometry/surface features, not blank centers.
    crops={'rl_rim.png':(240,100,590,400),'rl_dome.png':(350,180,700,480),'rl_needle.png':(350,340,700,640),'rl_needle_glow.png':(337,5,687,305),'rl_arc_trail.png':(90,220,440,520),'rl_divider.png':(0,200,64,500)}
    for start in range(0,len(names),8):
        page=Image.new('RGB',(1600,4*460),(10,11,15)); pd=ImageDraw.Draw(page)
        for j,name in enumerate(names[start:start+8]):
            im=flatten(load(name)); ox=(j%2)*800; oy=(j//2)*460
            label(pd,(ox+12,oy+7),name,20)
            thumb=im.resize((max(1,im.width//3),max(1,im.height//3)),Image.Resampling.LANCZOS); thumb.thumbnail((390,380))
            page.paste(thumb,(ox+8+(390-thumb.width)//2,oy+48+(380-thumb.height)//2))
            if name in crops: box=crops[name]
            elif '_t_' in name: box=(max(0,im.width//2-175),130,im.width//2+175,430)
            elif 'face_' in name: box=(120,80,470,380)
            else: box=(max(0,im.width//2-150),max(0,im.height//2-150),min(im.width,im.width//2+150),min(im.height,im.height//2+150))
            crop=im.crop(box)
            page.paste(crop,(ox+405,oy+80)); label(pd,(ox+405,oy+420),'1:1 PIXELS',16)
        page.save(ROOT/f'qa_png_{start//8+1}.jpg',quality=92,subsampling=0)
    manifest=json.loads((ROOT/'fb_manifest.json').read_text())
    for s in manifest['sheets']:
        sheet=Image.open(ROOT/s['file']).convert('RGB'); fw,fh=s['frame_width'],s['frame_height']
        tw=256 if fw==512 else 384; th=round(fh*tw/fw)
        contact=Image.new('RGB',(s['cols']*tw,s['rows']*(th+25)),(6,7,10)); cd=ImageDraw.Draw(contact)
        for f in range(s['frame_count']):
            col=f%s['cols']; row=f//s['cols']; frame=sheet.crop((col*fw,row*fh,(col+1)*fw,(row+1)*fh))
            contact.paste(frame.resize((tw,th),Image.Resampling.LANCZOS),(col*tw,row*(th+25))); label(cd,(col*tw+8,row*(th+25)+th+2),f'{f:02d}',15)
        contact.save(ROOT/f"qa_{s['id']}.jpg",quality=91,subsampling=0)
    preview_html(names,manifest)
    audit()

def preview_html(names,manifest):
    cards=''
    for name in names:
        w,h=Image.open(ROOT/name).size
        cards+=f'<article><h3><a href="{name}">{name}</a> <small>{w} × {h}</small></h3><div class="image"><img loading="lazy" src="{name}" alt="{name}" style="width:calc({w}px / var(--scale))"></div></article>\n'
    spec=json.dumps(manifest['sheets'],ensure_ascii=False)
    html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>重複ルーレット 素材確認</title>
<style>:root{color-scheme:dark;--scale:3}*{box-sizing:border-box}body{margin:0;background:#08090d;color:#deddd8;font:15px/1.6 system-ui,sans-serif}header,main{max-width:1480px;margin:auto;padding:24px}header{position:sticky;top:0;background:#101116f5;z-index:1;border-bottom:1px solid #3d1821}h1{font-size:24px;margin:0 0 12px}h2{margin:36px 0 12px;font-size:20px}h3{font-size:15px;margin:0 0 10px}small{color:#9899a3;font-weight:400}button,input{accent-color:#b3001b}button{cursor:pointer;padding:8px 16px;margin-right:10px;background:#301018;color:#f3ecdf;border:1px solid #722134;border-radius:5px}a{color:#d6a8ad}article{padding:18px;background:#101116;border:1px solid #27232a;border-radius:8px;margin:16px 0}.image{overflow:auto;background:repeating-conic-gradient(#090a0d 0 25%,#121319 0 50%) 0/28px 28px;max-height:85vh}.image img{display:block;max-width:none}.fx{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px}.fx article{margin:0}canvas{display:block;width:100%;background:#000}label{display:flex;gap:12px;align-items:center;margin-top:10px}input{width:100%}.assembly{width:min(100%,1000px);display:block;background:#050609}</style>
<header><h1>重複ルーレット / 素材確認</h1><button id="scale">表示：1/3 → 等倍に切替</button><button id="play">エフェクト：停止</button><small>黒・深紅・暗い銀 ／ ファイルをクリックすると原寸画像</small></header><main>
<h2>試し組み</h2><a href="assembly.jpg"><img class="assembly" src="assembly.jpg" alt="4種の漆面、リム、仕切り、ガラス、ランプ、針、ハブの組み合わせ"></a>
<h2>連番 / 24 fps</h2><div class="fx" id="fx"></div><h2>PNG 全29点 / 透過確認</h2>CARDS
<p><a href="preview.jpg">一覧画像</a> · <a href="fb_manifest.json">連番マニフェスト</a> · <a href="qa_report.json">数値検査</a> · <a href="README.md">合成・再生成手順</a></p></main>
<script>const specs=SPECS;let playing=true,epoch=performance.now();const entries=[];
for(const s of specs){const card=document.createElement('article');const title=document.createElement('h3');title.textContent=s.id+' / '+s.frame_count+' コマ';const canvas=document.createElement('canvas');canvas.width=s.frame_width;canvas.height=s.frame_height;const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=s.frame_count-1;slider.value=0;slider.setAttribute('aria-label',s.id+' フレーム');const value=document.createElement('span');value.textContent='00';const label=document.createElement('label');label.append(slider,value);card.append(title,canvas,label);document.querySelector('#fx').append(card);const im=new Image();im.src=s.file;const e={s,canvas,slider,value,im,frame:-1};entries.push(e);slider.oninput=()=>{playing=false;document.querySelector('#play').textContent='エフェクト：再生';draw(e,+slider.value)}}
function draw(e,f){if(!e.im.complete||!e.im.naturalWidth)return;const s=e.s,c=e.canvas.getContext('2d');c.clearRect(0,0,s.frame_width,s.frame_height);c.drawImage(e.im,f%s.cols*s.frame_width,Math.floor(f/s.cols)*s.frame_height,s.frame_width,s.frame_height,0,0,s.frame_width,s.frame_height);e.slider.value=f;e.value.textContent=String(f).padStart(2,'0');e.frame=f}
function tick(now){for(const e of entries){const f=playing?Math.min(e.s.frame_count-1,Math.floor(((now-epoch)/1000%1.8)*24)):+e.slider.value;if(f!==e.frame)draw(e,f)}requestAnimationFrame(tick)}requestAnimationFrame(tick);
document.querySelector('#play').onclick=()=>{playing=!playing;epoch=performance.now();document.querySelector('#play').textContent=playing?'エフェクト：停止':'エフェクト：再生'};let full=false;document.querySelector('#scale').onclick=()=>{full=!full;document.documentElement.style.setProperty('--scale',full?1:3);document.querySelector('#scale').textContent=full?'表示：等倍 → 1/3に切替':'表示：1/3 → 等倍に切替'};</script></html>'''
    (ROOT/'preview.html').write_text(html.replace('CARDS',cards).replace('SPECS',spec))

def audit():
    additive=[p.name for p in ROOT.glob('*.png') if any(q in p.stem for q in ['glow','dome','trail','lamp_on'])]
    rows=[]; failures=[]
    expected={'rl_rim.png':(2048,2048),'rl_dome.png':(2048,2048),'rl_hub.png':(512,512),'rl_needle.png':(1024,2048),'rl_needle_glow.png':(1024,2048),'rl_divider.png':(64,1024),'rl_shadow.png':(2560,2560),'rl_lamp_off.png':(128,128),'rl_lamp_on.png':(128,128),'rl_arc_trail.png':(2048,2048)}
    expected.update({f'rl_face_{i}.png':(1024,1024) for i in range(1,5)})
    expected.update({f'rl_t_{key}_{layer}.png':(1800,640) for key in ['dup','m1','m2','m3','all'] for layer in ['face','glow','shadow']})
    for name in expected:
        if not (ROOT/name).is_file(): failures.append('missing: '+name)
    for p in sorted(ROOT.glob('rl_*.png')):
        im=Image.open(p); a=np.asarray(im)
        edges=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]])
        row={'file':p.name,'size':list(im.size),'mode':im.mode,'bytes':p.stat().st_size,'edge_alpha_max':int(edges[:,3].max()),'alpha_zero_rgb_max':int(a[a[...,3]==0,:3].max()) if np.any(a[...,3]==0) else 0}
        if p.name not in expected or im.size!=expected[p.name]: failures.append('dimensions: '+p.name)
        if p.stem.startswith('rl_t_') and p.stem.endswith('_face'):
            yy,xx=np.nonzero(a[...,3]); row['alpha_bbox_center']=[float((xx.min()+xx.max())/2),float((yy.min()+yy.max())/2)]
        if p.name in additive: row['additive_edge_rgb_max']=int(edges[:,:3].max())
        if im.mode!='RGBA' or row['edge_alpha_max']!=0: failures.append(p.name)
        if p.name in additive and row['additive_edge_rgb_max']>3: failures.append(p.name)
        rows.append(row)
    effects=[]
    manifest=json.loads((ROOT/'fb_manifest.json').read_text())
    for s in manifest['sheets']:
        im=Image.open(ROOT/s['file']); a=np.asarray(im); fw,fh=s['frame_width'],s['frame_height']; maxima=[]
        for f in range(s['frame_count']):
            x=f%s['cols']*fw; y=f//s['cols']*fh; fr=a[y:y+fh,x:x+fw]
            maxima.append(int(max(fr[0].max(),fr[-1].max(),fr[:,0].max(),fr[:,-1].max())))
        effects.append({'file':s['file'],'sheet_size':list(im.size),'frames':s['frame_count'],'decoded_frame_edge_rgb_max':max(maxima),'frame_edge_maxima':maxima,'first_frame_max':int(a[:fh,:fw].max()),'last_frame_max':int(a[-fh:,-fw:].max())})
        if max(maxima)>3: failures.append(s['file'])
    pixels=np.asarray(load('rl_needle.png'))
    checks={'needle_lower_half_alpha_max':int(pixels[1024:,:,3].max()),'tick_count':50,'tick_interval_degrees':7.2,'major_tick_indices':list(range(0,50,5)),'petal_recess_degrees':[0,72,144,216,288],'rim_inner_radius_pixels':819.2,'rim_nominal_outer_radius_pixels':1024,'rim_outer_guard_pixels':1.23,'webp_quality':94,'png_count':len(rows),'effect_frame_count':sum(s['frame_count'] for s in manifest['sheets'])}
    # Independently sample all fifty actual incisions, versus adjacent metal.
    rim_rgb=np.asarray(load('rl_rim.png'),dtype=F)[...,:3]; aa=np.arange(50)*2*PI/50
    def sample(offset):
        xx=(1023.5+np.sin(aa+offset)*.891*1024).astype(F)[None,:]
        yy=(1023.5-np.cos(aa+offset)*.891*1024).astype(F)[None,:]
        return cv2.remap(rim_rgb,xx,yy,cv2.INTER_LINEAR)[0].mean(1)
    incision=sample(0); surrounding=(sample(np.deg2rad(.4))+sample(-np.deg2rad(.4)))/2
    checks['measured_visible_tick_count']=int((incision<surrounding*.83).sum())
    checks['measured_tick_min_contrast_255']=float((surrounding-incision).min())
    if checks['measured_visible_tick_count']!=50: failures.append('visible_tick_count')
    if checks['needle_lower_half_alpha_max']!=0: failures.append('needle_lower_half')
    delivery=sum(p.stat().st_size for p in ROOT.iterdir() if p.is_file() and p.name!='qa_report.json')
    report={'renderer':'deterministic CPU height-field + distance-field bevel / reflected strip lights','alpha':'straight / RGB zero when alpha zero','png':rows,'effects':effects,'geometry':checks,'total_bytes_excluding_report':delivery,'limit_bytes':16000000,'failures':failures,'review_evidence':['preview.jpg','assembly.jpg','qa_png_1.jpg','qa_png_2.jpg','qa_png_3.jpg','qa_png_4.jpg','qa_fb_crack_1.jpg','qa_fb_crack_2.jpg','qa_fb_sweep_1.jpg','qa_fb_ember_1.jpg'],'final_coordinator_visual_QA':'not performed in this task'}
    if delivery>16000000: report['failures'].append('total_size')
    (ROOT/'qa_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'bytes':delivery,'failures':report['failures'],'png':len(rows),'frames':checks['effect_frame_count']},ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--part',choices=['all','parts','text','fx','review'],default='all'); a=p.parse_args()
    if a.part in ['all','parts']:
        rim(); faces(); dome(); hub(); needle(); divider_shadow_lamps(); trail()
    if a.part in ['all','text']:
        for key,s in [('dup','おなじ あな'),('m1','−1灯'),('m2','−2灯'),('m3','−3灯'),('all','全消灯')]: text_asset(key,s)
    if a.part in ['all','fx']: effects()
    if a.part in ['all','review']: review()

if __name__=='__main__': main()
