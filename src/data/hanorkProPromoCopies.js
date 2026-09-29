'use strict';

/**
 * Copies de divulgação — Hanork PRO (#1) por nicho.
 * Uso: broadcast admin, WA status, grupos.
 */

const BUY_LINK = 't.me/hanork_bot?start=buy_1';
const PRICE = 'R$ 297,90';

const BY_NICHE = {
    infoproduto: `📚 Vende curso, pack ou método no Telegram?

O Hanork PRO monta sua loja completa no PV:
• Cliente escolhe → paga PIX → recebe na hora
• Cupom, carrinho e entrega automática
• Divulgação que edita a mensagem (sem flood no grupo)

Código v3.0 profissional — painel /admin + dashboard web.

💰 ${PRICE} — entrega automática após pagar
🛒 ${BUY_LINK}`,

    bot: `🤖 Quer seu próprio bot de vendas no Telegram?

Hanork PRO v3.0 — não é script solto:
✅ Catálogo + checkout PIX/cartão (Mercado Pago)
✅ Entrega automática de arquivos e links
✅ Admin, flash sale, afiliados, CRM
✅ WhatsApp Status opcional (Zero Divu)
✅ ZIP limpo — só você coloca seu token

💰 ${PRICE}
🛒 ${BUY_LINK}`,

    grupo: `👥 Tem grupo ou canal e vende no manual?

Automatize com Hanork PRO:
→ Promo no grupo sem spammar (edita 1 mensagem)
→ Venda no PV 24h com PIX confirmando sozinho
→ Você só cadastra produto e acompanha pedidos

Loja automática Telegram — código completo v3.0.

💰 ${PRICE} · entrega na hora
🛒 ${BUY_LINK}`,

    afiliado: `💸 Quer ganhar indicando ferramenta que vende de verdade?

Hanork PRO — loja automática Telegram:
• PIX + entrega automática (cliente compra sozinho)
• Painel admin + dashboard
• Sistema de afiliados já dentro do bot
• Divulgação inteligente (anti-flood)

Produto digital ${PRICE} — comissão na primeira venda do indicado.

🛒 ${BUY_LINK}`,

    revenda: `🏪 Monta loja pra cliente ou revende bot?

Hanork PRO v3.0 entrega:
• Código-fonte completo + guia em português
• Multi-loja (SaaS) opcional
• MP, entrega, cupom, relatório — tudo integrado
• Pacote limpo: sem tokens, sem banco de outro dono

${PRICE} — licença para sua operação.

🛒 ${BUY_LINK}`,
};

const WA_SHORT = `Hanork PRO — loja Telegram 24h
PIX automático + entrega + divulgação inteligente
${PRICE} → ${BUY_LINK}`;

function getCopy(niche) {
    return BY_NICHE[niche] || BY_NICHE.bot;
}

function getAllCopies() {
    return { ...BY_NICHE, wa_short: WA_SHORT };
}

function formatBonusFile() {
  const { formatAllVariantsBonusFile } = require('./hanorkBroadcastVariants');
  return formatAllVariantsBonusFile();
}

module.exports = {
    BY_NICHE,
    WA_SHORT,
    BUY_LINK,
    PRICE,
    getCopy,
    getAllCopies,
    formatBonusFile,
};
