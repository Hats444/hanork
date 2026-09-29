#!/usr/bin/env python3
"""
Pipeline Hanork PRO — capas ORIGINAIS estilo gótico dark roxo/caveira.

As fotos antigas (hanork-produtos-arquivo) são REFERÊNCIA DE ESTILO apenas.
Não reutiliza pixels dos produtos antigos.

Passos:
  1. Gerar fundos com IA (Cursor GenerateImage) usando referências do arquivo
     Salvar em fotos/hanork-bg/hanork-bg-01.png ... hanork-bg-20.png
  2. python3 scripts/overlay_hanork_promo_text.py
     Aplica textos atuais do Hanork (hanorkPromoThemes.json)
  3. node -e "require('./src/data/hanorkBroadcastVariants').writeHanorkOnlyCatalogFile(...)"

Fallback procedural (sem IA): python3 scripts/generate_hanork_gothic_promos.py

DEPRECATED: compose_hanork_promos_from_refs.py (colava em cima das fotos antigas)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BG_DIR = os.path.join(ROOT, 'fotos', 'hanork-bg')


def count_backgrounds() -> int:
    if not os.path.isdir(BG_DIR):
        return 0
    n = 0
    for i in range(1, 21):
        for ext in ('png', 'jpg', 'webp'):
            if os.path.isfile(os.path.join(BG_DIR, f'hanork-bg-{i:02d}.{ext}')):
                n += 1
                break
    return n


def main():
    bg_count = count_backgrounds()
    if bg_count < 20:
        print(f'Aviso: {bg_count}/20 fundos em fotos/hanork-bg/')
        print('Gere os fundos com IA (referência gótica) antes do overlay.')
        if bg_count == 0:
            print('Rodando fallback procedural...')
            subprocess.check_call([sys.executable, os.path.join(ROOT, 'scripts', 'generate_hanork_gothic_promos.py')])
            return

    overlay = os.path.join(ROOT, 'scripts', 'overlay_hanork_promo_text.py')
    subprocess.check_call([sys.executable, overlay])
    print('Capas finais em fotos/ e zero-divu/src/media/hanork/')


if __name__ == '__main__':
    main()
