#!/usr/bin/env python3
from pathlib import Path

HANORK_NOTE = """
> **Hanork (26/06/2026):** Base URL validada em produção: `https://api.virtuoesim.com/v1` (sem `/api`).
> O Hanork resolve `countryId` via `GET /v1/prices` — nunca usar o `id` interno de `virtuo_services` como `country` na API.
> Comando admin no bot: `/virtuo_docs` · arquivo espelho: `docs/virtuo/virtuo-esim-api-docs.md`.
"""

GAPS_OLD = (
    "- **Base URL inconsistente:** os exemplos cURL usam `https://api.virtuoesim.com/v1/...`, "
    "mas o exemplo Python de polling usa `https://api.virtuoesim.com/api/v1/...`. "
    "Não há indicação de qual é a base URL correta/oficial — recomenda-se testar ambas ou confirmar com o suporte."
)
GAPS_NEW = (
    "- **Base URL inconsistente (doc oficial):** os exemplos cURL usam `https://api.virtuoesim.com/v1/...`, "
    "mas o exemplo Python de polling usa `https://api.virtuoesim.com/api/v1/...`. "
    "**Hanork validou em produção:** usar `https://api.virtuoesim.com/v1` (path `/api/v1` não é necessário)."
)

paths = [
    Path('/mnt/c/Users/boots/Downloads/hanork/docs/virtuo/virtuo-esim-api-docs.md'),
    Path('/home/vendetta/hanork/docs/virtuo/virtuo-esim-api-docs.md'),
]

for p in paths:
    if not p.exists():
        print('skip', p)
        continue
    text = p.read_text(encoding='utf-8')
    if 'Hanork (26/06/2026)' not in text:
        text = text.replace(
            '> Fonte: documentação oficial extraída do painel/site Virtuo (sms.virtuoesim.com).\n',
            '> Fonte: documentação oficial extraída do painel/site Virtuo (sms.virtuoesim.com).\n' + HANORK_NOTE + '\n',
            1,
        )
    text = text.replace(GAPS_OLD, GAPS_NEW)
    text = text.replace(
        'BASE = "https://api.virtuoesim.com/api/v1"',
        'BASE = "https://api.virtuoesim.com/v1"',
    )
    p.write_text(text, encoding='utf-8')
    print('ok', p)
