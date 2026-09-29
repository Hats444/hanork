#!/usr/bin/env python3
"""Aplica textos Hanork sobre fundos gerados (IA ou manual)."""
from __future__ import annotations

import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
THEMES = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')
BG_DIR = os.path.join(ROOT, 'fotos', 'hanork-bg')
FOTOS_OUT = os.path.join(ROOT, 'fotos')
WA_OUT = os.path.join(ROOT, 'zero-divu', 'src', 'media', 'hanork')
TARGET = (1536, 1024)


def load_font(size: int, bold: bool = False):
    for p in ([
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def wrap_lines(text, font, max_w, max_lines=2):
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


def overlay_text(img: Image.Image, theme: dict) -> Image.Image:
    base = img.convert('RGBA')
    w, h = base.size

    shade = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.rectangle([0, 0, int(w * 0.58), int(h * 0.78)], fill=(4, 2, 10, 80))
    sd.rectangle([0, int(h * 0.78), w, h], fill=(4, 2, 10, 160))
    base = Image.alpha_composite(base, shade)

    draw = ImageDraw.Draw(base)
    accent = tuple(theme.get('accent', [148, 110, 255]))
    white = (245, 243, 250)
    muted = (210, 205, 225)

    title_font = load_font(64, bold=True)
    sub_font = load_font(30, bold=True)
    feat_font = load_font(23)
    cta_font = load_font(34, bold=True)
    small_font = load_font(19)

    y = 95
    draw.text((56, y), theme.get('image_title', 'HANORK PRO'), font=title_font, fill=white,
              stroke_width=2, stroke_fill=(8, 4, 16))
    y += 74
    draw.text((56, y), theme.get('image_subtitle', ''), font=sub_font, fill=accent)
    y += 48

    for feat in (theme.get('image_features') or [])[:5]:
        for ln in wrap_lines(feat, feat_font, 620, 2):
            draw.text((64, y), f"• {ln}", font=feat_font, fill=muted)
            y += 30
        y += 4

    bottom = theme.get('image_bottom', 'HANORK PRO v3.0')
    price = theme.get('price', 'R$ 297,90')
    draw.rectangle([0, h - 118, w, h], fill=(8, 4, 16, 235))
    draw.rectangle([0, h - 120, w, h - 118], fill=accent)
    draw.text((w // 2, h - 70), bottom, font=cta_font, fill=white, anchor='mm')
    draw.text((w // 2, h - 28), f"{price}   t.me/hanork_bot   buy_15", font=small_font, fill=muted, anchor='mm')

    return base.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1, percent=85, threshold=2))


def find_bg(idx: int) -> str | None:
    for ext in ('png', 'jpg', 'webp'):
        for name in (f'hanork-bg-{idx:02d}.{ext}', f'hanork-bg-{idx}.{ext}'):
            p = os.path.join(BG_DIR, name)
            if os.path.isfile(p):
                return p
    return None


def main():
    with open(THEMES, encoding='utf-8') as f:
        themes = json.load(f)
    os.makedirs(FOTOS_OUT, exist_ok=True)
    os.makedirs(WA_OUT, exist_ok=True)

    for i, theme in enumerate(themes, start=1):
        bg_path = find_bg(i)
        if not bg_path:
            print(f'SKIP {i:02d} sem fundo em hanork-bg/')
            continue
        bg = Image.open(bg_path).convert('RGB').resize(TARGET, Image.Resampling.LANCZOS)
        out = overlay_text(bg, theme)
        fname = theme.get('image_file') or f'hanork-promo-{i:02d}.jpg'
        out.save(os.path.join(FOTOS_OUT, fname), 'JPEG', quality=95, optimize=True)
        out.save(os.path.join(WA_OUT, fname), 'JPEG', quality=95, optimize=True)
        print(f'OK {fname} <- {os.path.basename(bg_path)}')

    first = themes[0].get('image_file', 'hanork-promo-01.jpg')
    p1 = os.path.join(WA_OUT, first)
    if os.path.isfile(p1):
        Image.open(p1).save(os.path.join(WA_OUT, 'auto-prod-15.jpg'), 'JPEG', quality=95)


if __name__ == '__main__':
    main()
