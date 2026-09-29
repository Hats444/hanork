#!/usr/bin/env python3
"""
Gera 20 capas ORIGINAIS Hanork PRO no estilo gótico dark roxo.
Inspirado nas promos antigas (caveira, bordas filigree, dashboard neon).
NÃO reutiliza fotos de produtos antigos como base.
"""
from __future__ import annotations

import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FOTOS = os.path.join(ROOT, 'fotos')
WA_MEDIA = os.path.join(ROOT, 'zero-divu', 'src', 'media', 'hanork')  # deprecated — não usar
THEMES = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')
W, H = 1536, 1024


def load_font(size: int, bold: bool = False):
    paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
    ]
    for p in paths:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def stone_background(seed: int) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            n = rng.random()
            base = int(8 + n * 18 + math.sin(x * 0.02 + y * 0.015) * 6)
            px[x, y] = (base, base // 2, base + 4)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def add_circuits(img: Image.Image, accent: tuple, seed: int) -> Image.Image:
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rng = random.Random(seed + 7)
    for _ in range(55):
        x, y = rng.randint(0, W), rng.randint(0, H)
        length = rng.randint(40, 180)
        angle = rng.choice([0, 90, 45, -45])
        rad = math.radians(angle)
        x2 = int(x + math.cos(rad) * length)
        y2 = int(y + math.sin(rad) * length)
        d.line([(x, y), (x2, y2)], fill=(*accent, 35), width=rng.randint(1, 2))
        for _ in range(rng.randint(1, 3)):
            d.ellipse([x2 - 3, y2 - 3, x2 + 3, y2 + 3], fill=(*accent, 50))
    return Image.alpha_composite(img.convert('RGBA'), layer).convert('RGB')


def draw_corner_ornament(d: ImageDraw.ImageDraw, x: int, y: int, flip_x: int, flip_y: int, silver: tuple, accent: tuple):
    pts = []
    for i in range(12):
        t = i / 11
        px = x + flip_x * int(20 + t * 90)
        py = y + flip_y * int(8 + math.sin(t * math.pi) * 28)
        pts.append((px, py))
    if len(pts) > 1:
        d.line(pts, fill=silver, width=3)
    d.ellipse([x - 10, y - 10, x + 10, y + 10], outline=accent, width=2)
    d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=accent)


def draw_border(d: ImageDraw.ImageDraw, accent: tuple):
    silver = (175, 170, 185)
    m = 36
    d.rectangle([m, m, W - m, H - m], outline=silver, width=2)
    d.rectangle([m + 8, m + 8, W - m - 8, H - m - 8], outline=(*accent, ), width=1)
    corners = [(m, m), (W - m, m), (m, H - m), (W - m, H - m)]
    flips = [(-1, -1), (1, -1), (-1, 1), (1, 1)]
    for (x, y), (fx, fy) in zip(corners, flips):
        draw_corner_ornament(d, x, y, fx, fy, silver, accent)
    d.ellipse([W // 2 - 12, m - 4, W // 2 + 12, m + 20], fill=accent, outline=silver)


def draw_skull(d: ImageDraw.ImageDraw, cx: int, cy: int, accent: tuple, seed: int):
    rng = random.Random(seed)
    bone = (195, 188, 175)
    shadow = (90, 85, 80)
    d.ellipse([cx - 95, cy - 110, cx + 95, cy + 70], fill=shadow)
    d.ellipse([cx - 88, cy - 105, cx + 88, cy + 65], fill=bone)
    d.ellipse([cx - 62, cy - 35, cx - 18, cy + 8], fill=(25, 20, 30))
    d.ellipse([cx + 18, cy - 35, cx + 62, cy + 8], fill=(25, 20, 30))
    d.ellipse([cx - 50, cy - 28, cx - 28, cy - 6], fill=accent)
    d.ellipse([cx + 28, cy - 28, cx + 50, cy - 6], fill=accent)
    for i in range(-3, 4):
        d.rectangle([cx + i * 14 - 5, cy + 28, cx + i * 14 + 5, cy + 52], fill=(160, 150, 140))
    d.polygon([(cx - 70, cy + 55), (cx + 70, cy + 55), (cx + 50, cy + 95), (cx - 50, cy + 95)], fill=bone)
    for _ in range(8):
        x1, y1 = cx + rng.randint(-80, 80), cy + rng.randint(-90, 40)
        x2, y2 = x1 + rng.randint(-40, 40), y1 + rng.randint(-30, 30)
        d.line([(x1, y1), (x2, y2)], fill=(*accent, ), width=rng.randint(1, 2))


def draw_feature_icon(d: ImageDraw.ImageDraw, x: int, y: int, kind: int, accent: tuple):
    r = 14
    d.ellipse([x - r, y - r, x + r, y + r], outline=accent, width=2)
    if kind == 0:
        d.rectangle([x - 7, y - 2, x + 7, y + 6], outline=accent, width=2)
        d.line([(x - 9, y - 2), (x + 9, y - 2)], fill=accent, width=2)
    elif kind == 1:
        d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=accent, width=2)
        d.line([(x, y - 8), (x, y + 8)], fill=accent, width=2)
    elif kind == 2:
        d.polygon([(x, y - 8), (x + 7, y + 6), (x - 7, y + 6)], outline=accent)
    elif kind == 3:
        d.rectangle([x - 6, y - 6, x + 6, y + 6], outline=accent, width=2)
        d.line([(x - 3, y + 2), (x, y - 2), (x + 4, y + 4)], fill=accent, width=2)
    else:
        d.rectangle([x - 7, y - 5, x + 7, y + 5], outline=accent, width=2)
        d.line([(x - 4, y + 8), (x + 4, y + 8)], fill=accent, width=2)


def wrap(text: str, font, max_w: int, max_lines: int = 2) -> list[str]:
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if font.getlength(test) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
        if len(lines) >= max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return lines


def draw_dashboard(d: ImageDraw.ImageDraw, box: tuple, accent: tuple, seed: int):
    x0, y0, x1, y1 = box
    rng = random.Random(seed)
    d.rounded_rectangle(box, radius=16, fill=(14, 10, 22), outline=(accent[0], accent[1], accent[2], 180), width=2)
    sb_w = 130
    d.rectangle([x0, y0, x0 + sb_w, y1], fill=(10, 7, 16))
    labels = ['Dashboard', 'Pedidos', 'Produtos', 'Cupons', 'Clientes', 'Afiliados']
    lf = load_font(15)
    for i, lb in enumerate(labels):
        yy = y0 + 36 + i * 42
        d.ellipse([x0 + 18, yy - 6, x0 + 30, yy + 6], fill=accent if i == 0 else (60, 55, 75))
        d.text((x0 + 40, yy - 8), lb, font=lf, fill=(180, 175, 195))
    gx0, gy0 = x0 + sb_w + 24, y0 + 24
    gx1, gy1 = x1 - 24, y0 + 280
    d.rounded_rectangle([gx0, gy0, gx1, gy1], radius=10, fill=(18, 12, 28))
    d.text((gx0 + 16, gy0 + 10), 'VENDAS', font=load_font(18, True), fill=(220, 215, 235))
    pts = []
    steps = 10
    for i in range(steps + 1):
        t = i / steps
        px = gx0 + 20 + int(t * (gx1 - gx0 - 40))
        py = gy1 - 30 - int((math.sin(t * 4 + seed * 0.1) * 0.3 + t * 0.7) * (gy1 - gy0 - 70))
        pts.append((px, py))
    if len(pts) > 1:
        d.line(pts, fill=accent, width=3)
    for px, py in pts[::2]:
        d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(255, 255, 255))
    cards_y = gy1 + 20
    cw = (gx1 - gx0 - 30) // 3
    for i in range(3):
        cx = gx0 + i * (cw + 10)
        d.rounded_rectangle([cx, cards_y, cx + cw, cards_y + 70], radius=8, fill=(22, 16, 34))
        d.text((cx + 12, cards_y + 12), ['Pedidos', 'Clientes', 'Receita'][i], font=lf, fill=(150, 145, 165))
        d.text((cx + 12, cards_y + 36), str(rng.randint(120, 980)), font=load_font(22, True), fill=accent)
    list_y = cards_y + 90
    d.text((gx0 + 16, list_y), 'PEDIDOS RECENTES', font=load_font(16, True), fill=(200, 195, 215))
    for j in range(4):
        ry = list_y + 28 + j * 30
        d.text((gx0 + 16, ry), f'#{rng.randint(8000, 9999)}', font=lf, fill=(170, 165, 185))
        d.rounded_rectangle([gx1 - 110, ry, gx1 - 20, ry + 22], radius=6, fill=(30, 80, 120))
        d.text((gx1 - 88, ry + 2), 'Aprovado', font=load_font(13), fill=(200, 230, 255))


def render(theme: dict, idx: int) -> Image.Image:
    accent = tuple(theme.get('accent', [148, 110, 255]))
    seed = idx * 131 + 17

    img = stone_background(seed)
    img = add_circuits(img, accent, seed)
    base = img.convert('RGBA')
    d = ImageDraw.Draw(base)

    draw_border(d, accent)
    draw_skull(d, 175, H // 2 - 40, accent, seed)

    title_f = load_font(64, True)
    sub_f = load_font(30, True)
    feat_f = load_font(22)
    white = (238, 234, 245)
    muted = (195, 190, 205)

    title = theme.get('image_title', 'HANORK PRO')
    subtitle = theme.get('image_subtitle', 'Loja automática no Telegram')
    features = theme.get('image_features') or []
    bottom = theme.get('image_bottom', 'AUTOMAÇÃO DE VENDAS NO TELEGRAM')
    price = theme.get('price', 'R$ 297,90')

    d.text((68, 78), title, font=title_f, fill=white, stroke_width=2, stroke_fill=(15, 8, 25))
    d.text((68, 152), subtitle, font=sub_f, fill=accent)

    y = 210
    for i, feat in enumerate(features[:5]):
        draw_feature_icon(d, 82, y + 10, i, accent)
        for ln in wrap(feat, feat_f, 520, 2):
            d.text((108, y), ln, font=feat_f, fill=muted)
            y += 28
        y += 10

    draw_dashboard(d, (780, 100, 1490, 780), accent, seed)

    d.rectangle([0, H - 130, W, H], fill=(12, 6, 20, 245))
    d.text((W // 2, H - 82), bottom, font=load_font(36, True), fill=accent, anchor='mm')
    d.text((W // 2, H - 36), f'{price}   t.me/hanork_bot   buy_15', font=load_font(20), fill=white, anchor='mm')

    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([40, 200, 360, 720], fill=(*accent, 18))
    out = Image.alpha_composite(base, glow).convert('RGB')
    return out.filter(ImageFilter.UnsharpMask(radius=1.1, percent=85, threshold=3))


def main():
    with open(THEMES, encoding='utf-8') as f:
        themes = json.load(f)
    os.makedirs(FOTOS, exist_ok=True)

    for i, theme in enumerate(themes, 1):
        fname = theme.get('image_file') or f'hanork-promo-{i:02d}.jpg'
        img = render(theme, i)
        img.save(os.path.join(FOTOS, fname), 'JPEG', quality=94, optimize=True)
        print(f'OK {fname} -> hanork/fotos/')

    print(f'\n{len(themes)} capas em hanork/fotos/')


if __name__ == '__main__':
    main()
