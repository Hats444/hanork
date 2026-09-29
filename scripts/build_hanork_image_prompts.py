#!/usr/bin/env python3
"""Monta prompts IA para capas Hanork (estilo gótico, texto atual). Saída: hanork/fotos/"""
from __future__ import annotations

import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
THEMES = os.path.join(ROOT, 'src', 'data', 'hanorkPromoThemes.json')
OUT = os.path.join(ROOT, 'src', 'data', 'hanorkPromoImagePrompts.json')

STYLE = (
    'ORIGINAL new promotional banner landscape 3:2. Match ONLY the visual STYLE of the reference: '
    'cyber-gothic dark aesthetic, ornate silver Victorian filigree border with small skulls and purple gems, '
    'hyper-realistic weathered human skull on left with purple glowing cybernetic circuit lines in eye sockets, '
    'black stone texture background with purple neon circuit board traces, '
    'dark-mode admin dashboard UI mockup on right with purple neon line graph sales chart order panels, '
    'large metallic white and purple gradient Portuguese title, purple circular feature icons with white text, '
    'large purple textured CTA banner at bottom, ultra polished high-end Brazilian digital product marketing. '
    'DO NOT copy old product names from reference. All text must be Portuguese for Hanork PRO.'
)

ARCHIVE = r'C:\Users\boots\Downloads\hanork-produtos-arquivo\2026-06-14\fotos'
REFS = [
    'Bot_Telegram_1.jpg', 'Bot_Vendas_1.jpg', 'Bot_WhatsApp_1.jpg', 'Divulgador_1.jpg',
    'Consultas_Work_1.jpg', 'Consultas_Mind7_1.jpg', 'E-mail_com_IA_1.jpg',
]


def build_prompt(t: dict) -> str:
    feats = '\n'.join(f'• {f}' for f in (t.get('image_features') or [])[:5])
    return (
        f'{STYLE}\n\n'
        f'Title: {t.get("image_title", "HANORK PRO")}\n'
        f'Subtitle: {t.get("image_subtitle", "")}\n'
        f'Features:\n{feats}\n'
        f'Bottom banner: {t.get("image_bottom", "")}\n'
        f'Footer small text: {t.get("price", "R$ 297,90")}  t.me/hanork_bot  buy_15'
    )


def main():
    with open(THEMES, encoding='utf-8') as f:
        themes = json.load(f)
    variants = []
    for i, t in enumerate(themes):
        ref = REFS[i % len(REFS)]
        variants.append({
            'id': t['id'],
            'image_file': t['image_file'],
            'ref': os.path.join(ARCHIVE, ref),
            'prompt': build_prompt(t),
        })
    payload = {
        'output_dir': 'fotos',
        'style_base': STYLE,
        'variants': variants,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f'{len(variants)} prompts -> {OUT}')


if __name__ == '__main__':
    main()
