#!/usr/bin/env python3
"""Atualiza description no hanork.db com textos de productPromoTemplates.js."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'hanork.db'
TEMPLATES_JS = ROOT / 'src' / 'data' / 'productPromoTemplates.js'

text = TEMPLATES_JS.read_text(encoding='utf-8')
# Extrai pares id -> promoBody (strings com concatenação simples)
blocks = re.findall(
    r'(\d+):\s*\{\s*promoBody:\s*((?:\'[^\']*\'(?:\s*\+\s*)?)+)',
    text,
    re.DOTALL,
)
updates = {}
for pid, body_expr in blocks:
    parts = re.findall(r"'([^']*)'", body_expr)
    updates[int(pid)] = ''.join(parts)

conn = sqlite3.connect(DB)
cur = conn.cursor()
rows = cur.execute('SELECT id, name FROM products ORDER BY id').fetchall()
updated = 0
for pid, name in rows:
    body = updates.get(pid)
    if not body:
        print(f'skip id={pid} ({name}) — sem template')
        continue
    cur.execute('UPDATE products SET description = ? WHERE id = ?', (body, pid))
    updated += 1
    print(f'ok id={pid} ({name}) — {len(body)} chars')

conn.commit()
conn.close()
print(f'\n{updated}/{len(rows)} produtos atualizados em {DB}')
