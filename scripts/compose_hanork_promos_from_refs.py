#!/usr/bin/env python3
"""
DEPRECATED: não use fotos antigas como base literal.
Use generate_hanork_gothic_original.py para capas originais no estilo gótico.
"""
from __future__ import annotations

import json
import os
import textwrap

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ARCHIVE_FOTOS = os.path.join(
    os.path.expanduser('~'),
    'Downloads',
    'hanork-produtos-arquivo',
    '2026-06-14',
    'fotos',
)
if not os.path.isdir(ARCHIVE_FOTOS):
    ARCHIVE_FOTOS = '/mnt/c/Users/boots/Downloads/hanork-produtos-arquivo/2026-06-14/fotos'

FOTOS_OUT = os.path.join(ROOT, 'fotos')
WA_OUT = os.path.join(ROOT, 'zero-divu', 'src', 'media', 'hanork')
THEMES = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')

REF_POOL = [
    'Bot_Telegram_1.jpg',
    'Bot_Vendas_1.jpg',
    'Bot_WhatsApp_1.jpg',
    'Divulgador_1.jpg',
    'Consultas_Work_1.jpg',
    'Consultas_Mind7_1.jpg',
    'E-mail_com_IA_1.jpg',
]

TARGET = (1536, 1024)


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


def fit_ref(path: str) -> Image.Image:
    im = Image.open(path).convert('RGB')
    if im.size != TARGET:
        im = im.resize(TARGET, Image.Resampling.LANCZOS)
    return im


def draw_panel(draw, box, alpha=175):
    x0, y0, x1, y1 = box
    overlay = Image.new('RGBA', (x1 - x0, y1 - y0), (8, 4, 14, alpha))
    return overlay, box


def wrap_lines(text, font, max_w, max_lines=6):
    words = text.replace('\n', ' ').split()
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


def compose_one(theme: dict, idx: int) -> Image.Image:
    ref_name = theme.get('ref_base') or REF_POOL[idx % len(REF_POOL)]
    ref_path = os.path.join(ARCHIVE_FOTOS, ref_name)
    if not os.path.isfile(ref_path):
        ref_path = os.path.join(ARCHIVE_FOTOS, REF_POOL[0])

    base = fit_ref(ref_path).convert('RGBA')
    w, h = base.size

    # Vinheta e painéis para cobrir textos antigos das capas de referência
    vignette = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vd.rectangle([0, 0, int(w * 0.62), int(h * 0.72)], fill=(6, 3, 12, 150))
    vd.rectangle([0, int(h * 0.72), w, h], fill=(4, 2, 10, 175))
    base = Image.alpha_composite(base, vignette)

    panel = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rectangle([28, 48, 640, 720], fill=(8, 4, 16, 120))
    pd.rectangle([0, h - 132, w, h], fill=(10, 5, 18, 230))
    base = Image.alpha_composite(base, panel)

    draw = ImageDraw.Draw(base)
    title_font = load_font(72, bold=True)
    sub_font = load_font(34, bold=True)
    feat_font = load_font(26, bold=False)
    cta_font = load_font(40, bold=True)
    small_font = load_font(22, bold=False)

    accent = tuple(theme.get('accent', [180, 120, 255]))
    white = (240, 238, 245)
    muted = (200, 195, 210)

    title = theme.get('image_title', 'HANORK PRO')
    subtitle = theme.get('image_subtitle', 'Loja automática Telegram')
    features = theme.get('image_features') or []
    bottom = theme.get('image_bottom', 'VENDA AUTOMÁTICA NO TELEGRAM')
    price = theme.get('price', 'R$ 297,90')

    y = 72
    draw.text((56, y), title, font=title_font, fill=white, stroke_width=2, stroke_fill=(20, 10, 30))
    y += 82
    draw.text((56, y), subtitle, font=sub_font, fill=accent)
    y += 52

    for feat in features[:5]:
        line = f"• {feat}"
        for ln in wrap_lines(line, feat_font, 620, max_lines=2):
            draw.text((64, y), ln, font=feat_font, fill=muted)
            y += 34
        y += 4

    # Faixa inferior estilo capas antigas
    draw.rectangle([0, h - 118, w, h], fill=(12, 6, 20, 210))
    draw.text((w // 2, h - 78), bottom, font=cta_font, fill=accent, anchor='mm', stroke_width=1, stroke_fill=(0, 0, 0))
    draw.text((w // 2, h - 32), f"{price}  |  t.me/hanork_bot  |  buy_15", font=small_font, fill=white, anchor='mm')

    return base.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=3))


def main():
    with open(THEMES, encoding='utf-8') as f:
        themes = json.load(f)

    os.makedirs(FOTOS_OUT, exist_ok=True)
    os.makedirs(WA_OUT, exist_ok=True)

    for i, theme in enumerate(themes, start=1):
        img = compose_one(theme, i - 1)
        fname = theme.get('image_file') or f'hanork-promo-{i:02d}.jpg'
        out1 = os.path.join(FOTOS_OUT, fname)
        out2 = os.path.join(WA_OUT, fname)
        img.save(out1, 'JPEG', quality=94, optimize=True)
        img.save(out2, 'JPEG', quality=94, optimize=True)
        print(f'OK {fname} <- {theme.get("ref_base", "?")}')

    first = os.path.join(WA_OUT, themes[0]['image_file'])
    legacy = os.path.join(WA_OUT, 'auto-prod-15.jpg')
    if os.path.isfile(first):
        Image.open(first).save(legacy, 'JPEG', quality=94)

    print(f'\n{len(themes)} capas Hanork (estilo arquivo) em fotos/ e wa-media/')


if __name__ == '__main__':
    main()
