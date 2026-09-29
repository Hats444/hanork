'use strict';

const { normalizeProductDescription } = require('../utils/normalizeProductDescription');

/**
 * Textos de ficha do produto — catálogo Hanork-only (produto #1).
 */
const BY_ID = {
  1: {
    promoBody: `Hanork PRO v3.0 — loja automática no Telegram com PIX, entrega e divulgação inteligente.

O que você recebe:
• Loja completa: catálogo, carrinho, cupons e checkout no PV
• PIX e cartão via Mercado Pago (confirmação automática)
• Entrega automática de arquivos, links e digitais
• Divulgação que edita a mensagem (anti-flood em grupos)
• Painel /admin + dashboard web + CRM e afiliados
• Plugin WhatsApp Status (Zero Divu) opcional
• ZIP limpo — sem tokens nem dados de outro vendedor
• Bônus: DIVULGAÇÃO-HANORK-PRO.txt com 20 textos góticos de venda
• Guia CLIENTE.md em português

Você configura: token BotFather, ID_DONO e Mercado Pago no .env.`,
  },
};

function getProductPromoBody(product) {
  if (!product) return '';
  const id = Number(product.id);
  if (Number.isFinite(id) && BY_ID[id]?.promoBody) {
    return normalizeProductDescription(BY_ID[id].promoBody);
  }
  return '';
}

function withPromoTemplate(product) {
  if (!product) return product;
  const body = getProductPromoBody(product);
  if (!body) return product;
  return { ...product, description: body };
}

function hasPromoTemplate(product) {
  return !!getProductPromoBody(product);
}

module.exports = {
  BY_ID,
  getProductPromoBody,
  withPromoTemplate,
  hasPromoTemplate,
};
