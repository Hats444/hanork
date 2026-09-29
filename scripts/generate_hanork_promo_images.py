#!/usr/bin/env python3
"""Gera 20 capas góticas/dark Hanork PRO (1536x1024) — estilo promos antigas."""
from __future__ import annotations

import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FOTOS = os.path.join(ROOT, 'fotos')
WA_MEDIA = os.path.join(ROOT, 'zero-divu', 'src', 'media', 'hanork')
VARIANTS_JSON = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')

W, H = 1536, 1024


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
    ]
    for fp in candidates:
        if os.path.isfile(fp):
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                pass
    return ImageFont.load_default()


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_bg(draw: ImageDraw.ImageDraw, top: tuple, bottom: tuple) -> None:
    for y in range(H):
        t = y / max(H - 1, 1)
        c = tuple(lerp(top[i], bottom[i], t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)


def add_vignette(img: Image.Image, strength: float = 0.55) -> Image.Image:
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    cx, cy = W // 2, H // 2
    for r in range(max(W, H), 0, -8):
        alpha = int(255 * strength * (1 - r / max(W, H)) ** 1.6)
        if alpha <= 0:
            continue
        od.ellipse([cx - r, cy - r, cx + r, cy - r], fill=(0, 0, 0, alpha))
    return Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')


def draw_gothic_frame(d: ImageDraw.ImageDraw, accent: tuple) -> None:
    m = 48
    d.rectangle([m, m, W - m, H - m], outline=accent, width=3)
    d.rectangle([m + 10, m + 10, W - m - 10, H - m - 10], outline=(accent[0] // 2, accent[1] // 2, accent[2] // 2), width=1)
    corners = [(m, m), (W - m, m), (m, H - m), (W - m, H - m)]
    s = 36
    for x, y in corners:
        dx = 1 if x < W // 2 else -1
        dy = 1 if y < H // 2 else -1
        d.line([(x, y), (x + dx * s, y)], fill=accent, width=4)
        d.line([(x, y), (x, y + dy * s)], fill=accent, width=4)


def draw_ornament(d: ImageDraw.ImageDraw, accent: tuple, seed: int) -> None:
    rng = random.Random(seed)
    for _ in range(18):
        x = rng.randint(80, W - 80)
        y = rng.randint(80, H - 80)
        r = rng.randint(2, 5)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(accent[0], accent[1], accent[2], 120) if len(accent) > 3 else accent)
    # arco gótico sugerido
    d.arc([W // 2 - 280, 120, W // 2 + 280, 520], start=200, end=340, fill=accent, width=2)


def wrap_text(text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if font.getlength(test) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:4]


def render_one(theme: dict, idx: int) -> Image.Image:
    top = tuple(theme['bg_top'])
    bottom = tuple(theme['bg_bottom'])
    accent = tuple(theme['accent'])

    img = Image.new('RGB', (W, H), top)
    d = ImageDraw.Draw(img)
    gradient_bg(d, top, bottom)
    draw_ornament(d, accent, seed=idx * 97 + 13)
    draw_gothic_frame(d, accent)

    title_font = load_font(78, bold=True)
    sub_font = load_font(40, bold=False)
    badge_font = load_font(34, bold=True)
    small_font = load_font(28, bold=False)

    title = theme.get('image_title', 'HANORK PRO')
    subtitle = theme.get('image_subtitle', 'Loja automática Telegram')
    tag = theme.get('image_tag', 'v3.0')

    d.text((W // 2, 200), title, font=title_font, fill=(235, 230, 245), anchor='mm', stroke_width=2, stroke_fill=(20, 10, 30))
    d.text((W // 2, 290), subtitle, font=sub_font, fill=accent, anchor='mm')

    y = 380
    for line in wrap_text(theme.get('image_line', 'PIX automático · entrega na hora'), sub_font, W - 220):
        d.text((W // 2, y), line, font=sub_font, fill=(210, 205, 220), anchor='mm')
        y += 48

    # badge preço
    price = theme.get('price', 'R$ 297,90')
    bw, bh = 420, 72
    bx, by = W // 2 - bw // 2, H - 250
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=18, fill=(30, 12, 22), outline=accent, width=2)
    d.text((W // 2, by + bh // 2), price, font=badge_font, fill=(255, 240, 245), anchor='mm')

    d.text((W // 2, H - 160), 't.me/hanork_bot · buy_15', font=small_font, fill=(180, 170, 190), anchor='mm')
    d.text((W // 2, H - 110), tag.upper(), font=small_font, fill=accent, anchor='mm')

    img = add_vignette(img, 0.45)
    # leve glow no centro
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W // 2 - 420, H // 2 - 260, W // 2 + 420, H // 2 + 260], fill=(accent[0], accent[1], accent[2], 28))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=90, threshold=3))


def main() -> int:
    if not os.path.isfile(VARIANTS_JSON):
        print('Missing', VARIANTS_JSON)
        return 1
    with open(VARIANTS_JSON, encoding='utf-8') as f:
        themes = json.load(f)

    os.makedirs(FOTOS, exist_ok=True)
    os.makedirs(WA_MEDIA, exist_ok=True)

    made = 0
    for i, theme in enumerate(themes, start=1):
        num = f'{i:02d}'
        fname = theme.get('image_file') or f'hanork-promo-{num}.jpg'
        img = render_one(theme, i)
        out_fotos = os.path.join(FOTOS, fname)
        out_wa = os.path.join(WA_MEDIA, fname)
        img.save(out_fotos, 'JPEG', quality=92, optimize=True)
        img.save(out_wa, 'JPEG', quality=92, optimize=True)
        print(f'OK {fname} -> fotos + wa-media')
        made += 1

    # fallback legado
    legacy = os.path.join(WA_MEDIA, 'auto-prod-15.jpg')
    first = os.path.join(WA_MEDIA, themes[0].get('image_file', 'hanork-promo-01.jpg'))
    if os.path.isfile(first):
        Image.open(first).save(legacy, 'JPEG', quality=92)

    print(f'\n{made} imagens góticas Hanork geradas.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
