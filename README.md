# Hanork

[![CI](https://github.com/Hats444/hanork/actions/workflows/ci.yml/badge.svg)](https://github.com/Hats444/hanork/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18--25-brightgreen.svg)](package.json)

Bot de vendas e operação no **Telegram**, com ponte **WhatsApp** (divulgação / dual WA), pagamentos e painel admin.

`hanork-bot` v3 · Node.js 18–25 · repositório público

## O que faz

- Catálogo, carrinho, checkout e entrega automática
- PIX / cartão via Mercado Pago
- Divulgação WhatsApp (worker `zero-divu`)
- Painel admin, afiliados, cashback, CRM
- Filas (Bull/Redis), health e observabilidade

## Stack

| Item | Valor |
|------|--------|
| Entrada | `src/bot.js` → `npm start` |
| Telegram | bot + notify opcional |
| WhatsApp | Baileys / `zero-divu` |
| Pagamentos | Mercado Pago |
| Dados | SQLite (+ Redis opcional) |
| CI | `.github/workflows/ci.yml` |

## Estrutura

```
src/             bot Telegram, módulos, gateway
zero-divu/       worker WhatsApp / divulgação
hanork_panel/    painel auxiliar
marketing/       textos de divulgação (operacional)
scripts/         boot, testes, helpers
observability/   métricas / compose
.env.example     template — nunca commitar .env
```

## Setup

```bash
npm install
cp .env.example .env
# TOKEN_TELEGRAM, ID_DONO, TOKEN_MP, …
npm start
```

```bash
npm run test:unit   # suite do CI
npm run smoke       # boot smoke
```

## Segurança

- Secrets só no `.env` / host
- Sem `.env` real, sessões WA, bancos ou logs no Git
- Documentação pública do repo: só este `README.md`

## Relacionados

- [hanork-beta](https://github.com/Hats444/hanork-beta) — linha beta WA multissessão
- [Hats444.github.io](https://github.com/Hats444/Hats444.github.io) — portfolio
