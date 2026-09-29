#!/usr/bin/env python3
"""Gera capas de divulgação (25 slots) para smm, virtuo, wadv e hanork."""
from __future__ import annotations

import argparse
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA = os.path.join(ROOT, 'src', 'data')
FOTOS = os.path.join(ROOT, 'fotos')
W, H = 1536, 1024

STYLES = {
    'hanork': {
        'prefix': 'hanork',
        'themes': 'hanorkPromoThemes.json',
        'title': 'HANORK PRO',
        'top': (12, 6, 28),
        'bottom': (48, 18, 72),
        'accent': (148, 110, 255),
        'cta': 't.me/hanork_bot',
    },
    'smm': {
        'prefix': 'ssm',
        'themes': 'smmPromoThemes.json',
        'title': 'SMM HANORK',
        'top': (4, 24, 18),
        'bottom': (8, 42, 28),
        'accent': (34, 197, 94),
        'cta': 't.me/hanork_bot?start=smm',
    },
    'virtuo': {
        'prefix': 'virtuo',
        'themes': 'virtuoPromoThemes.json',
        'title': 'NÚMEROS SMS',
        'top': (6, 18, 42),
        'bottom': (10, 32, 58),
        'accent': (56, 189, 248),
        'cta': 't.me/hanork_bot?start=sms',
    },
    'wadv': {
        'prefix': 'wadv',
        'themes': 'wadvPromoThemes.json',
        'title': 'HANORK DIV VIP',
        'top': (28, 18, 6),
        'bottom': (58, 32, 10),
        'accent': (251, 191, 36),
        'cta': 't.me/hanork_bot?start=handiv',
    },
}


def load_font(size: int, bold: bool = False):
    candidates = [
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/segoeui.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for fp in candidates:
        if os.path.isfile(fp):
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                pass
    return ImageFont.load_default()


def lerp(a, b, t):
    return int(a + (b - a) * t)


def gradient_bg(top, bottom):
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        t = y / max(H - 1, 1)
        c = tuple(lerp(top[i], bottom[i], t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    return img


def wrap(text, font, max_w, max_lines=4):
    words = str(text or '').replace('\n', ' ').split()
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


def draw_cover(theme: dict, style: dict, idx: int) -> Image.Image:
    rng = random.Random(idx * 997 + len(style['prefix']))
    accent = tuple(theme.get('accent', style['accent']))
    img = gradient_bg(style['top'], style['bottom']).convert('RGBA')
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for _ in range(24):
        x, y = rng.randint(40, W - 40), rng.randint(40, H - 40)
        r = rng.randint(2, 6)
        od.ellipse([x - r, y - r, x + r, y + r], fill=(*accent, 40))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    m = 44
    draw.rectangle([m, m, W - m, H - m], outline=accent, width=3)

    title_font = load_font(64, bold=True)
    sub_font = load_font(34, bold=True)
    body_font = load_font(26)
    bar_font = load_font(32, bold=True)

    brand = theme.get('image_title') or style['title']
    subtitle = theme.get('image_subtitle') or theme.get('headline', '')[:72]
    bottom = theme.get('image_bottom') or style['cta']

    y = 72
    draw.text((64, y), brand, font=title_font, fill=(248, 246, 252))
    y += 78
    for ln in wrap(subtitle, sub_font, W - 140, 3):
        draw.text((64, y), ln, font=sub_font, fill=accent)
        y += 42

    body_src = theme.get('tgBody') or theme.get('waBody') or ''
    y += 12
    for ln in wrap(body_src, body_font, W - 140, 4):
        draw.text((64, y), ln, font=body_font, fill=(220, 218, 230))
        y += 34

    bar_y = H - 120
    draw.rectangle([0, bar_y, W, H], fill=(8, 6, 14, 240))
    draw.rectangle([0, bar_y - 4, W, bar_y], fill=accent)
    draw.text((W // 2, bar_y + 58), bottom, font=bar_font, fill=(255, 255, 255), anchor='mm')

    return img.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.0, percent=80, threshold=2))


def out_dirs(prefix: str):
    sub = 'ssm' if prefix == 'ssm' else prefix
    dirs = [
        os.path.join(FOTOS, sub),
        os.path.join(FOTOS, 'midias', sub),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
    return dirs


def generate_type(kind: str, limit: int = 25):
    cfg = STYLES[kind]
    path = os.path.join(DATA, cfg['themes'])
    if not os.path.isfile(path):
        print(f'SKIP {kind}: missing {path}')
        return 0
    with open(path, encoding='utf-8') as f:
        themes = json.load(f)
    n = 0
    for i, theme in enumerate(themes[:limit], start=1):
        pad = str(i).zfill(2)
        fname = theme.get('image_file') or f"{cfg['prefix']}_{pad}.jpg"
        img = draw_cover(theme, cfg, i)
        for d in out_dirs(cfg['prefix']):
            out = os.path.join(d, fname)
            img.save(out, 'JPEG', quality=92, optimize=True)
            print(f'OK {kind} -> {out}')
        n += 1
    return n


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--type', default='all', choices=['all', 'hanork', 'smm', 'virtuo', 'wadv'])
    parser.add_argument('--limit', type=int, default=25)
    args = parser.parse_args()
    kinds = list(STYLES.keys()) if args.type == 'all' else [args.type]
    total = 0
    for k in kinds:
        total += generate_type(k, args.limit)
    print(f'Done: {total} imagens')


if __name__ == '__main__':
    main()
