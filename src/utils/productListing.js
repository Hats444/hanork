'use strict';

const { resolveProductFormat } = require('./productFormat');
const { normalizeProductDescription } = require('./normalizeProductDescription');

const MIN_NAME_LEN = 4;
const MIN_DESC_LEN = 20;

const DESCRIPTION_HINTS = {
    file: 'O que vem no arquivo? Quantos itens? Entrega automática após o pagamento.',
    photo: 'Resolução, uso permitido e como o cliente recebe a imagem.',
    video: 'Duração, conteúdo do vídeo e formato do arquivo.',
    audio: 'Duração, qualidade e como usar o áudio.',
    text: 'O que o cliente recebe (código, licença, link) e validade, se houver.',
    service: 'O que está incluso, prazo de atendimento e como funciona após a compra.',
    subscription: 'Benefícios do plano, periodicidade e como renovar ou cancelar.',
};

/**
 * Valida rascunho do wizard antes de publicar.
 * @returns {{ ok: boolean, issues: string[] }}
 */
function validateListingDraft(data) {
    const issues = [];
    const name = String(data?.name || '').trim();
    const desc = String(data?.description || '').trim();

    if (name.length < MIN_NAME_LEN) {
        issues.push(`Nome muito curto (mín. ${MIN_NAME_LEN} caracteres).`);
    }
    if (desc.length < MIN_DESC_LEN) {
        issues.push(`Descrição curta (mín. ${MIN_DESC_LEN} caracteres — explique o que o cliente recebe).`);
    }
    if (!data?.price || Number(data.price) <= 0) {
        issues.push('Preço inválido.');
    }

    const type = data?.type;
    const isService = type === 'service' || type === 'subscription';
    const isText = type === 'text';
    if (!data?.file_url && !isService && !isText) {
        issues.push('Falta arquivo ou conteúdo de entrega.');
    }

    return { ok: issues.length === 0, issues };
}

/**
 * Texto da ficha como o comprador vê (Telegram / preview admin).
 */
function buildBuyerProductText(product, opts = {}) {
    const { showStock = true } = opts;
    const name = product.name || 'Produto';
    let desc = normalizeProductDescription(product.description);
    desc = desc.replace(/^WA_PLAN_DAYS=\d+\s*\n?/i, '').trim();
    const fmt = resolveProductFormat(product);
    const price = Number(product.price || 0);
    const hasStock = (product.stock ?? 999) > 0;

    let text = `<b>${name}</b>\n\n`;
    if (desc) text += `${desc}\n\n`;
    if (fmt) text += `📎 Entrega digital · <b>${fmt}</b>\n`;
    else text += `📎 Entrega digital\n`;
    text += `⚡ Liberado automaticamente após o pagamento\n`;
    text += `💰 <b>R$ ${price.toFixed(2)}</b>`;

    if (showStock && product.stock !== undefined && product.stock < 999) {
        text += hasStock ? `\n📦 Estoque: ${product.stock}` : '\n❌ <b>Esgotado</b>';
    }

    return text;
}

/**
 * Rótulo curto para botões do catálogo (preço no botão; detalhes na mensagem).
 */
function catalogButtonLabel(product, maxName = 14) {
    const { catalogProductBtn } = require('./buttonLabels');
    return catalogProductBtn(product, maxName);
}

function getDescriptionHint(type) {
    return DESCRIPTION_HINTS[type] || DESCRIPTION_HINTS.file;
}

module.exports = {
    MIN_NAME_LEN,
    MIN_DESC_LEN,
    validateListingDraft,
    buildBuyerProductText,
    catalogButtonLabel,
    getDescriptionHint,
};
