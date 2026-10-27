"""R3-G：m3 の囲いの 3D（work/upa_frame3d/m3/）の書き出し物から、play の筐体の素材（m3/pack1026/）を作る。読むだけ（m3・組立の出力は変えない）。
 python3 work/game_demo/play/m3/build_m3.py
出力は全部 8 bit の生の配列を gzip（*.u8.gz、行 0＝画像の上）＋ manifest.json。光の層は平方根で符号化（値＝(u8/255)^2 × scale）。
 A  1440x2560 RGBA ×8：枠 0・4 灯（窓の外、透明度＝窓でない所）、盤 0・4 灯（v39 の前＝釘・柵。上の 46 本の釘は下の釘の絵から補う）、ガラスの映り込み 0・4 灯、
    色なしの光の素材 B4（4 灯の部屋の明るさ、LED なし）・W4（B4＋LED の光を白で）（integration/frame_light、枠を演出の色で光らせる）
 C  1440x291  RGBA ×5：穴の段の front_off 0・4、back_off 0・4、LED の光（R 前の穴、G 後ろの穴、B 前の柱、A 後ろの柱）
 D  490x383   RGBA ×14：表示器の消灯 0・4、桁 28（4 つずつ）、メーター 5（色つき）
 E  720x782   RGBA ×5：盤面電飾（wash 8・ring 4・縁の帯 zone 8、半分の解像度、白の光の強さ）
 F  180x320   RGBA ×2：枠の LED の区画の重み（8 区画）
 T  1336x261  RGBA ×2：皿の中 0・4 灯（画面 x52 y2209、球と囲いの下）
"""
import gzip, json, os, sys, csv
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(HERE + '/../../..')
M3 = WORK + '/upa_frame3d/m3'
IG = M3 + '/integration'
V39 = WORK + '/assembly/out/v39_lcd_split'
OUT = HERE + '/pack1026'
HOLES = HERE + '/holes_r3_1026'
W, H = 1440, 2560
os.makedirs(OUT, exist_ok=True)
man = {'note': 'R3-G：m3 の囲いを play の筐体にする素材。build_m3.py が作る（作り直せるので git に入れない）', 'arrays': {}}


def save(name, arr, extra=None):
    arr = np.ascontiguousarray(arr.astype(np.uint8))
    n, h, w, c = arr.shape
    assert c == 4
    with gzip.open(f'{OUT}/{name}.u8.gz', 'wb', compresslevel=6) as f: f.write(arr.tobytes())
    man['arrays'][name] = dict(file=f'{name}.u8.gz', width=w, height=h, layers=n, **(extra or {}))
    print(name, arr.shape)


def rgba(p):
    return np.asarray(Image.open(p).convert('RGBA'), np.uint8)


def lin16(p, scale):
    a = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    a = a[..., ::-1] if a.ndim == 3 else a      # BGR → RGB
    return a.astype(np.float32) / 65535.0 * scale


# ── 表示変換（m3 の tm：露出 −1、Khronos PBR Neutral、desat 0）と、その逆 ──
S0 = 0.8 - 0.04; DD = 1 - S0
def srgb2lin(s): return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
def inv_T(s8):
    """sRGB（0..255）→ m3 の線形（表示前）。neutral(x/2) の逆。白に飛んだ所は 0.999 で止める"""
    o = srgb2lin(np.clip(np.asarray(s8, np.float32) / 255.0, 0, 0.999))
    np_ = o.max(-1, keepdims=True)
    peak = np.where(np_ >= S0, DD * DD / np.maximum(1 - np_, 1e-4) - DD + S0, np_)
    c = o * np.where(np_ > 0, peak / np.maximum(np_, 1e-6), 1)
    mn = c.min(-1, keepdims=True)                 # off：x<0.08 なら x−6.25x²（出力の最小 = 6.25x²）、それ以外 0.04
    x = np.where(mn < 0.04, np.sqrt(np.maximum(mn, 0) / 6.25), mn + 0.04)
    off = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    return (c + off) * 2.0


def enc(v, scale):     # 光の強さ → u8（平方根）
    return np.clip(np.sqrt(np.clip(v / scale, 0, 1)) * 255 + 0.5, 0, 255)


# ── 窓の形（m3 data/frame_open.json：盤の窓と皿の窓）──
J = json.load(open(M3 + '/data/frame_open.json'))
Mk = Image.new('L', (W * 4, H * 4), 0)
for O_ in J['opens']: ImageDraw.Draw(Mk).polygon([(x * W / 940 * 4, y * H / 1673 * 4) for x, y in O_], fill=255)
Mwin = np.asarray(Mk.resize((W, H), Image.LANCZOS), np.float32) / 255     # 1 = 窓（射出口の楕円は入れない＝枠を不透明のまま。台車は切り抜きの絵が上に載る）

# ── A：枠・盤・ガラス ──
A = []
for st in '04':
    F = np.asarray(Image.open(f'{M3}/out/full21/F{st}.png').convert('RGB'), np.uint8)
    A.append(np.dstack([F, ((1 - Mwin) * 255 + 0.5).astype(np.uint8)]))
pins = json.load(open(HERE + '/data/pins_px.json'))
old_pins = json.load(open(HERE + '/data/pins_px_pre1026.json'))
OLD49 = [(i, p) for i, p in zip(old_pins['ids'], old_pins['px']['-0.049']) if p[0] is not None]
P49 = [(i, p) for i, p in zip(pins['ids'], pins['px']['-0.049']) if p[0] is not None]


def brass_pin(st, R=10.5, ss=4):
    """釘の頭（真鍮、前から見た丸い頭）＋盤への小さな影。RGBA（まっすぐの透明度、sRGB）、中心＝釘の中心。
    上からの光：左上の白い点、頭の縁は暗く、影は右下へ。st='4' は囲いの灯の桃の照り返しを縁に少し。
    3D の担当の本物の絵が来たら data/pin_sprite_{0,4}.png（RGBA、正方形、中心＝釘の中心、等倍）を置けばそちらを使う。"""
    f = f'{HERE}/data/pin_sprite_{st}.png'
    if os.path.exists(f): return np.asarray(Image.open(f).convert('RGBA'), np.float32) / 255
    N = 2 * 16 + 1; n = N * ss
    yy, xx = (np.mgrid[0:n, 0:n] + 0.5) / ss - N / 2
    r = np.hypot(xx, yy) / R
    lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    srgb = lambda l: np.where(l <= 0.0031308, l * 12.92, 1.055 * np.clip(l, 0, None) ** (1 / 2.4) - 0.055)
    # 頭の形：平らに近い天面（傾き 0.22r）＋縁の面取り（r 0.68 から急に）。法線＝(傾き·方向, 1) を正規化
    sl = 0.22 * r + np.clip((r - 0.68) / 0.32, 0, 1) ** 1.5 * 2.6
    ux, uy = np.where(r > 1e-6, xx / np.maximum(np.hypot(xx, yy), 1e-6), 0), np.where(r > 1e-6, yy / np.maximum(np.hypot(xx, yy), 1e-6), 0)
    nn = np.sqrt(1 + sl * sl); nx, ny, nz = ux * sl / nn, uy * sl / nn, 1 / nn
    L = np.array([-0.42, -0.62, 0.66]); L /= np.linalg.norm(L)
    dif = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    H_ = L + np.array([0, 0, 1.0]); H_ /= np.linalg.norm(H_)
    spec = np.clip(nx * H_[0] + ny * H_[1] + nz * H_[2], 0, 1) ** 90 + 0.35 * np.clip(nx * H_[0] + ny * H_[1] + nz * H_[2], 0, 1) ** 12 * (r > 0.66)
    brass = lin(np.array([0.86, 0.66, 0.30]))
    col = brass[None, None, :] * (0.10 + 0.95 * dif[..., None])
    col = col * (1 - 0.45 * np.clip((r - 0.80) / 0.20, 0, 1))[..., None]          # 縁は暗く（面取りの陰）
    col += np.array([1.0, 0.92, 0.75])[None, None, :] * spec[..., None] * 1.6       # 上からの光の点
    col += brass[None, None, :] * 0.25 * np.clip(1 - np.hypot(nx - 0.35, ny - 0.55) / 0.45, 0, 1)[..., None] * nz[..., None]   # 下の照り返し
    if st == '4': col += lin(np.array([1.0, 0.25, 0.6]))[None, None, :] * 0.18 * np.clip((r - 0.6) / 0.4, 0, 1)[..., None] * (r <= 1)[..., None]
    head = np.clip((1 - r) * R * ss / ss * 1.0 + 0.5, 0, 1)                           # 縁 1px のなめらかさ
    sx, sy = xx - 2.2, yy - 3.4
    sh = np.exp(-np.clip(np.hypot(sx, sy) / (R * 1.05) - 0.55, 0, None) ** 2 / 0.18) * 0.55   # 盤への影（右下、やわらか）
    a = head + sh * (1 - head)
    rgb = np.where(a[..., None] > 1e-4, (srgb(np.clip(col, 0, 1)) * head[..., None]) / np.maximum(a[..., None], 1e-4), 0)
    out = np.dstack([rgb, a]).astype(np.float32)
    return cv2.resize(out, (N, N), interpolation=cv2.INTER_AREA)


for st in '04':
    B = rgba(f'{V39}/front_{st}.png').astype(np.float32) / 255
    B[2215:] = 0                                   # 皿（凍結の皿の球）は使わない。皿は物理の球
    # 釘は R3 の82本を物理の位置へ描く（10/21 夜：黒い点に見える → 真鍮の頭＋影）。v39 の釘の絵（暗い円）は消してから、物理の位置へ小数の位置まで置く
    yy0, xx0 = np.mgrid[0:H, 0:W]
    for i, (x, y) in OLD49:
        x0, y0 = int(x) - 16, int(y) - 17
        d = np.hypot(xx0[y0:y0 + 34, x0:x0 + 34] - x, yy0[y0:y0 + 34, x0:x0 + 34] - (y - 1))
        B[y0:y0 + 34, x0:x0 + 34, 3] *= np.clip((d - 12.5) / 2.0, 0, 1)
    spr = brass_pin(st); R2 = spr.shape[0] // 2
    # R3-M5 項目 6：目からの高さ別の釘の絵（integration/pins/manifest.json）があれば、釘ごとに近い dy の絵を使う（焼き込みなので実行時の重さは同じ）
    PM = f'{IG}/pins/manifest.json'
    if os.path.exists(PM):
        pm = json.load(open(PM)); var = {int(k): v for k, v in pm['variants'][st].items()}
        sprs = {k: np.asarray(Image.open(f'{IG}/pins/{v}').convert('RGBA'), np.float32) / 255 for k, v in var.items()}
        pick = lambda y: sprs[min(sprs, key=lambda k: abs(k - (pm['eye_y_px'] - y) * pm['mm_per_px']))]
    else: pick = lambda y: spr
    n_add = 0
    for i, (x, y) in P49:
        spr = pick(y)
        xx, yy = int(round(x)), int(round(y)); X0, Y0_ = xx - 2 * R2, yy - 2 * R2; S_ = 4 * R2 + 1
        M2 = np.float32([[1, 0, x - R2 - X0], [0, 1, y - R2 - Y0_]])
        big = cv2.warpAffine(spr, M2, (S_, S_), flags=cv2.INTER_LINEAR)
        T_ = B[Y0_:Y0_ + S_, X0:X0 + S_]
        al = big[..., 3:]
        col = big[..., :3] * al + T_[..., :3] * T_[..., 3:] * (1 - al)
        T_[..., 3:] = al + T_[..., 3:] * (1 - al)
        T_[..., :3] = col / np.maximum(T_[..., 3:], 1e-6); n_add += 1
    print('pins', st, n_add, 'sprite', 'dy' if os.path.exists(PM) else 'file' if os.path.exists(f'{HERE}/data/pin_sprite_{st}.png') else 'brass')
    A.append((B * 255 + 0.5).clip(0, 255).astype(np.uint8))
for st in '04':
    G = np.asarray(Image.open(f'{IG}/lcd/glass_add_{st}.png').convert('RGB'), np.uint8)
    A.append(np.dstack([G, np.full((H, W), 255, np.uint8)]))
for n in ('B4', 'W4'):
    G = np.asarray(Image.open(f'{IG}/frame_light/{n}.png').convert('RGB'), np.uint8)
    A.append(np.dstack([G, np.full((H, W), 255, np.uint8)]))
save('A', np.stack(A))

# ── T：皿の中（R3-M5 項目 7、integration/tray/）。球の下・囲いの下に、stage2c の皿の代わりに敷く ──
TM = json.load(open(IG + '/tray/manifest.json'))
save('T', np.stack([rgba(f"{IG}/tray/{TM['files'][st]}") for st in '04']), dict(x=TM['x'], y=TM['y']))

# ── C：穴の段 ──
HB = json.load(open(HOLES + '/manifest.json')); HY, HH = HB['y'], HB['h']
C = [rgba(f'{HOLES}/{n}.png') for n in ('front_off_0', 'front_off_4', 'back_off_0', 'back_off_4')]
light = np.zeros((HH, W, 4), np.float32)
def led(state_png, off_png, x):
    on = rgba(state_png); off = rgba(off_png)[:, x:x + on.shape[1]]
    pm = lambda a: a[..., :3].astype(np.float32) * (a[..., 3:] / 255.0)       # 透明度で暗くした色（後ろの黒の板の上）
    d = inv_T(pm(on)) - inv_T(pm(off))
    return np.maximum(d[..., 0], 0) / 3.0          # 点灯は 3.0×桃 [1,.02,.3]：R ÷ 3 ＝ 白の LED 1 単位
LS = 4.0
for h in HB['holes']:
    n, x = h['n'], h['x']; w_ = rgba(f'{HOLES}/hole{n}_on_0.png').shape[1]
    light[:, x:x + w_, 0] = np.maximum(light[:, x:x + w_, 0], led(f'{HOLES}/hole{n}_on_0.png', f'{HOLES}/front_off_0.png', x))
    light[:, x:x + w_, 1] = np.maximum(light[:, x:x + w_, 1], led(f'{HOLES}/back_hole{n}_on_0.png', f'{HOLES}/back_off_0.png', x))
for p in HB['pillars']:
    j, x = p['j'], p['x']; w_ = rgba(f'{HOLES}/pillar{j}_on_0.png').shape[1]
    light[:, x:x + w_, 2] = np.maximum(light[:, x:x + w_, 2], led(f'{HOLES}/pillar{j}_on_0.png', f'{HOLES}/front_off_0.png', x))
print('hole light max', light.reshape(-1, 4).max(0))
C.append(enc(light, LS))
save('C', np.stack(C), dict(y=HY, scale=LS, holes=HB['holes'], pillars=HB['pillars']))

# ── D：表示器 ──
DM = json.load(open(IG + '/disp_A/manifest.json')); cx, cy = DM['crop']['x'], DM['crop']['y']; dw, dh = DM['off']['w'], DM['off']['h']
D = [np.dstack([np.asarray(Image.open(f'{IG}/disp_A/{f}').convert('RGB'), np.uint8), np.full((dh, dw), 255, np.uint8)]) for f in DM['off']['files']]
DS = 16.0
seg = np.zeros((28, dh, dw), np.float32); met = np.zeros((5, dh, dw, 3), np.float32)
for L_ in DM['layers']:
    v = lin16(f'{IG}/disp_A/{L_["file"]}', L_['scale']); ox, oy = int(round(L_['x'] - cx)), int(round(L_['y'] - cy))
    k, i = L_['key'].split(':'); i = int(i); h_, w_ = v.shape[:2]
    if k == 'seg': seg[i, oy:oy + h_, ox:ox + w_] += v.max(-1)
    else: met[i, oy:oy + h_, ox:ox + w_] += v
for g in range(7): D.append(enc(np.moveaxis(seg[g * 4:g * 4 + 4], 0, -1), DS))
for i in range(5): D.append(np.dstack([enc(met[i], DS), np.full((dh, dw), 255, np.uint8)]))
# 1026: R3はC/B/A/Sの4賞。旧SSの印刷と5段の光を4段の銘板へ置換。
# 元の印刷・素材はintegrationに保存し、このpackにだけ反映する。
mx0, my0, mx1, my1 = 69, 244, 423, 300
palette = [(60,150,255), (40,235,110), (255,215,30), (255,110,20)]
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 27 * 4)
for st in range(2):
    image = Image.fromarray(D[st]).resize((dw * 4, dh * 4), Image.Resampling.NEAREST)
    dr = ImageDraw.Draw(image)
    dr.rounded_rectangle((mx0*4, my0*4, mx1*4, my1*4), radius=8*4, fill=(14,18,26,255))
    for i, (letter, col) in enumerate(zip('CBAS', palette)):
        x0 = mx0+5+i*86; x1 = x0+80
        dr.rounded_rectangle((x0*4,(my0+4)*4,x1*4,(my1-4)*4),radius=5*4,fill=tuple(int(v*.28) for v in col)+(255,))
        dr.text(((x0+x1)*2,(my0+my1)*2),letter,font=font,anchor='mm',fill=(14,16,20,255))
    D[st] = np.asarray(image.resize((dw,dh),Image.Resampling.LANCZOS))
for i in range(5):
    emission = Image.new('RGB',(dw*4,dh*4),(0,0,0)); draw = ImageDraw.Draw(emission)
    if i < 4:
        x0 = mx0+5+i*86; x1=x0+80
        draw.rounded_rectangle((x0*4,(my0+4)*4,x1*4,(my1-4)*4),radius=5*4,fill=palette[i])
        draw.text(((x0+x1)*2,(my0+my1)*2),'CBAS'[i],font=font,anchor='mm',fill=(0,0,0))
    rgb = np.asarray(emission.resize((dw,dh),Image.Resampling.LANCZOS)).astype(np.float32)/255
    D[9+i] = np.dstack([enc(srgb2lin(rgb)*2.0,DS),np.full((dh,dw),255,np.uint8)])
save('D', np.stack(D), dict(x=cx, y=cy, scale=DS, digit_on=[1, 0.015, 0.065]))

# ── E：盤面電飾（半分の解像度）──
BM = json.load(open(IG + '/board_light/manifest.json'))
EY0, EH = 673, 1563; ES = 2
def place(L_):
    v = lin16(f'{IG}/board_light/{L_["file"]}', L_['scale']).max(-1)
    o = np.zeros((EH, W), np.float32); ox, oy = int(round(L_['x'])), int(round(L_['y'] - EY0)); h_, w_ = v.shape
    h_ = min(h_, EH - oy); w_ = min(w_, W - ox); o[oy:oy + h_, ox:ox + w_] = v[:h_, :w_]
    return cv2.resize(o, (W // ES, (EH + 1) // ES), interpolation=cv2.INTER_AREA)
wash = [place(L_) for L_ in BM['wash']]; ring = [place(L_) for L_ in BM['ring']]; zone = [place(L_) for L_ in BM['layers']]
E_l = wash + ring + zone; scales = [float(max(v.max(), 1e-3)) for v in E_l]
E = []
for g in range(5):
    grp = E_l[g * 4:g * 4 + 4]; sc = scales[g * 4:g * 4 + 4]
    E.append(np.dstack([enc(v, s) for v, s in zip(grp, sc)]))
save('E', np.stack(E), dict(y=EY0, h=EH, down=ES, scales=scales, order='wash0-7, ring0-3, zone0-7', wash_gain=BM['wash_gain'], wash_mix=BM['wash_mix'], zone_gain=BM['gain'], pink=BM['pink']))

# ── F：枠の LED の区画（0 頭 1 エラ 2 ロゴ 3 左の柱の上 4 左の柱の下 5 右の柱の上 6 右の柱の下 7 下と皿）──
fw, fh = 180, 320; yy, xx = (np.mgrid[0:fh, 0:fw] + 0.5) * 8.0
g = lambda cx_, cy_, sx_, sy_: np.exp(-(((xx - cx_) / sx_) ** 2 + ((yy - cy_) / sy_) ** 2))
logo = ((xx > 170) & (xx < 800) & (yy > 140) & (yy < 350)).astype(np.float32)
logo = cv2.GaussianBlur(logo, (0, 0), 3)
reg = [g(720, 330, 420, 220), g(140, 220, 200, 220) + g(1300, 220, 200, 220), logo * 3,
       g(60, 1050, 140, 420), g(60, 1850, 140, 420), g(1380, 1050, 140, 420), g(1380, 1850, 140, 420), g(720, 2450, 700, 180)]
reg = np.stack(reg, -1); reg[..., 0] *= (1 - logo); reg[..., 1] *= (1 - logo)
reg = reg / np.maximum(reg.sum(-1, keepdims=True), 1e-6)
save('F', np.stack([enc(reg[..., :4], 1), enc(reg[..., 4:], 1)]), dict(cell=8, regions=['head', 'gills', 'logo', 'pillarL_up', 'pillarL_low', 'pillarR_up', 'pillarR_low', 'bottom']))

man['physics'] = dict(config='work/game_tuning/r3/config_r3.json', pin_count=len(pins['ids']), pins=pins['ids'], holes=json.load(open(HOLES + '/manifest.json'))['physics'], meter=['C','B','A','S'])
man['lcd_window'] = json.load(open(IG + '/lcd_window.json'))
man['launcher'] = json.load(open(IG + '/launcher_sprites/manifest.json'))
json.dump(man, open(OUT + '/manifest.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
