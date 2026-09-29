#!/usr/bin/env python3
"""
Gera 20 capas Hanork PRO no estilo gótico das promos antigas.

Usa fotos do arquivo SOMENTE como referência visual (bordas, caveira, dashboard).
Cobre todo texto antigo e desenha copy atual do Hanork PRO.
Saída única: hanork/fotos/ (usado pelo broadcast TG e sync WA)
"""
from __future__ import annotations

import json
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
THEMES = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')
ARCHIVE_FOTOS = os.path.join(
    os.path.expanduser('~'), 'Downloads', 'hanork-produtos-arquivo', '2026-06-14', 'fotos',
)
if not os.path.isdir(ARCHIVE_FOTOS):
    ARCHIVE_FOTOS = '/mnt/c/Users/boots/Downloads/hanork-produtos-arquivo/2026-06-14/fotos'

MEDIA_OUT = os.environ.get('HANORK_PROMO_MEDIA_DIR', os.path.join(ROOT, 'fotos'))

REF_POOL = [
    'Bot_Telegram_1.jpg', 'Bot_Vendas_1.jpg', 'Bot_WhatsApp_1.jpg',
    'Divulgador_1.jpg', 'Consultas_Work_1.jpg', 'Consultas_Mind7_1.jpg',
    'E-mail_com_IA_1.jpg',
]
TARGET = (1536, 1024)


def load_font(size: int, bold: bool = False):
    for p in (
        ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf']
        if bold
        else ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
    ):
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


def lerp(a, b, t):
    return int(a + (b - a) * t)


def gradient_rect(w, h, top, bottom):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(lerp(top[i], bottom[i], t) for i in range(4))
        for x in range(w):
            px[x, y] = c
    return img


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


def mask_old_text(base: Image.Image, accent: tuple) -> Image.Image:
    w, h = base.size
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # Coluna esquerda: cobre 100% do texto antigo (mantém borda/caveira nas bordas)
    left = gradient_rect(760, 820, (5, 2, 12, 255), (5, 2, 12, 248))
    layer.paste(left, (0, 35))

    # Título do dashboard (ex.: BOT TELEGRAM)
    dash_title = Image.new('RGBA', (560, 110), (7, 3, 14, 255))
    layer.paste(dash_title, (748, 48))

    # Faixa inferior inteira — remove CTA antigo por completo
    bottom = gradient_rect(w, 155, (accent[0] // 3, accent[1] // 4, accent[2] // 2, 255),
                           (3, 1, 8, 255))
    layer.paste(bottom, (0, h - 155))

    return Image.alpha_composite(base.convert('RGBA'), layer)


def draw_feature_icon(draw, x, y, accent):
    draw.ellipse([x, y, x + 18, y + 18], outline=(accent[0], accent[1], accent[2], 200), width=2)
    draw.ellipse([x + 5, y + 5, x + 13, y + 13], fill=accent)


def compose_one(theme: dict, idx: int) -> Image.Image:
    ref_name = theme.get('ref_base') or REF_POOL[idx % len(REF_POOL)]
    ref_path = os.path.join(ARCHIVE_FOTOS, ref_name)
    if not os.path.isfile(ref_path):
        ref_path = os.path.join(ARCHIVE_FOTOS, REF_POOL[0])

    accent = tuple(theme.get('accent', [148, 110, 255]))
    base = mask_old_text(fit_ref(ref_path), accent)
    draw = ImageDraw.Draw(base)
    w, h = base.size

    # Pinta faixa inferior opaca (remove CTA antigo por completo)
    draw.rectangle([0, h - 145, w, h], fill=(6, 3, 12))

    title_font = load_font(70, bold=True)
    sub_font = load_font(32, bold=True)
    feat_font = load_font(24)
    cta_font = load_font(38, bold=True)
    small_font = load_font(20)

    white = (248, 246, 252)
    muted = (210, 205, 225)

    y = 78
    draw.text((52, y), theme.get('image_title', 'HANORK PRO'), font=title_font, fill=white,
              stroke_width=2, stroke_fill=(8, 4, 18))
    y += 78
    draw.text((52, y), theme.get('image_subtitle', ''), font=sub_font, fill=accent)
    y += 50

    for feat in (theme.get('image_features') or [])[:5]:
        draw_feature_icon(draw, 54, y + 2, accent)
        for ln in wrap_lines(feat, feat_font, 590, 2):
            draw.text((82, y), ln, font=feat_font, fill=muted)
            y += 30
        y += 6

    bottom = theme.get('image_bottom', 'HANORK PRO v3.0')
    price = theme.get('price', 'R$ 297,90')
    bar_y = h - 118
    draw.rectangle([0, bar_y - 4, w, bar_y], fill=accent)
    draw.rectangle([0, bar_y, w, h], fill=(8, 4, 16))
    draw.text((w // 2, bar_y + 36), bottom, font=cta_font, fill=white, anchor='mm',
              stroke_width=1, stroke_fill=(10, 5, 20))
    draw.text((w // 2, bar_y + 78), f"{price}   t.me/hanork_bot   buy_15",
              font=small_font, fill=(230, 225, 240), anchor='mm')

    return base.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.1, percent=90, threshold=2))


def main():
    with open(THEMES, encoding='utf-8') as f:
        themes = json.load(f)

    os.makedirs(MEDIA_OUT, exist_ok=True)

    for i, theme in enumerate(themes, start=1):
        img = compose_one(theme, i - 1)
        fname = theme.get('image_file') or f'hanork-promo-{i:02d}.jpg'
        out = os.path.join(MEDIA_OUT, fname)
        img.save(out, 'JPEG', quality=95, optimize=True)
        print(f'OK {fname} <- ref {theme.get("ref_base", "?")} -> {out}')

    first = os.path.join(MEDIA_OUT, themes[0]['image_file'])
    legacy = os.path.join(MEDIA_OUT, 'auto-prod-15.jpg')
    if os.path.isfile(first):
        Image.open(first).save(legacy, 'JPEG', quality=95)

    print(f'\n{len(themes)} capas em {MEDIA_OUT}')


if __name__ == '__main__':
    main()
