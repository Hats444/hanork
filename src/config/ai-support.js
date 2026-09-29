'use strict';

/**
 * Assistente de vendas e suporte — API Zero Two GPT (mesma chave do bot).
 */
const logger = require('./logger');
const ZeroTwoAi = require('../services/ZeroTwoAiService');
const localAiPolicy = require('./localAiPolicy');
const OllamaAi = require('../services/OllamaAiService');

const KNOWLEDGE_BASE = {
    pix: 'Pagamento via PIX pelo Mercado Pago. Após confirmar, a entrega é automática no Telegram.',
    entrega: 'Entrega automática assim que o pagamento é confirmado.',
    catálogo: 'Use /cat ou o botão Catálogo no menu para ver produtos e preços.',
    carrinho: 'Adicione itens pelo catálogo e finalize com /checkout ou pelo carrinho no menu.',
    suporte: 'Para falar com a equipe: /suporte abre um ticket no privado.',
    garantia: 'Garantia de 7 dias. Problemas com o pedido: /suporte com o número do pedido.',
    cupom: 'Cupons de desconto: /cupom no privado antes do checkout.',
};

function matchKnowledge(message) {
    const raw = String(message || '').trim();
    const lower = raw.toLowerCase();
    // Texto longo (ex.: colar descrição de produto no PV) — não usar FAQ por substring.
    if (raw.length > 180 || raw.split(/\n/).filter((l) => l.trim()).length > 3) {
        return null;
    }
    for (const [keyword, response] of Object.entries(KNOWLEDGE_BASE)) {
        if (lower.includes(keyword)) {
            return {
                type: 'knowledge',
                response: `<b>${keyword.charAt(0).toUpperCase() + keyword.slice(1)}</b>\n\n${response}`,
                confidence: 0.95,
            };
        }
    }
    return null;
}

async function processMessage(message, userContext = {}) {
    const kb = matchKnowledge(message);
    if (kb) {
        logger.info('[AI Support] knowledge hit');
        return kb;
    }

    const result = await ZeroTwoAi.askSalesAssistant(message, {
        botName: userContext.botName,
        shopTagline: userContext.shopTagline,
        productCount: userContext.productCount,
        firstName: userContext.firstName,
    });

    if (result.type === 'off_topic') {
        return { type: 'off_topic', response: result.text, confidence: 1 };
    }
    if (result.ok) {
        return { type: 'gpt', response: result.text, confidence: 0.85 };
    }

    const localGate = localAiPolicy.allowsLocalAi();
    if (localGate.ok) {
        const ollama = await OllamaAi.ask(message, userContext);
        if (ollama.ok) {
            const footer =
                '\n\n<i>Use /cat para comprar · /suporte para atendimento humano</i>';
            return { type: 'ollama', response: ollama.text + footer, confidence: 0.7 };
        }
        logger.warn('[AI Support] ollama fallback failed', { reason: ollama.type });
    }

    return { type: 'error', response: result.text, confidence: 0 };
}

function needsHumanSupport(message, aiConfidence) {
    const lower = String(message || '').toLowerCase();
    const urgent = ['reclamação', 'reclamar', 'fraude', 'roubo', 'polícia', 'denunciar', 'processo', 'advogado'];
    if (urgent.some((k) => lower.includes(k))) return true;
    if (aiConfidence < 0.4) return true;
    if (message.length > 400) return true;
    return false;
}

module.exports = {
    processMessage,
    needsHumanSupport,
    isEnabled: () => ZeroTwoAi.isConfigured() || localAiPolicy.allowsLocalAi().ok,
    getConfig: () => ZeroTwoAi.getConfig(),
    describeMode: () => localAiPolicy.describeMode(),
};
