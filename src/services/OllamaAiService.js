'use strict';

const axios = require('axios');
const logger = require('../config/logger');
const localAiPolicy = require('../config/localAiPolicy');

const TIMEOUT_MS = Math.min(20000, Math.max(5000, Number(process.env.OLLAMA_TIMEOUT_MS) || 12000));

function ollamaRoot() {
    return String(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
}

async function isReachable() {
    try {
        await axios.get(`${ollamaRoot()}/api/tags`, { timeout: 2000 });
        return true;
    } catch {
        return false;
    }
}

async function ask(userMessage, context = {}) {
    const gate = localAiPolicy.allowsLocalAi();
    if (!gate.ok) {
        return { ok: false, type: 'blocked', reason: gate.reason };
    }

    const model = localAiPolicy.getRecommendedModel();
    const botName = context.botName || process.env.BOT_DISPLAY_NAME || 'Hanork';
    const prompt =
        `Você é o assistente ${botName} no Telegram. Responda em português BR, tom profissional, sem emojis. ` +
        `Máximo 3 frases sobre catálogo, PIX, entrega e suporte. Sem links.\n\n` +
        `Cliente: ${String(userMessage || '').trim()}`;

    try {
        const { data } = await axios.post(
            `${ollamaRoot()}/api/generate`,
            {
                model,
                prompt,
                stream: false,
                options: {
                    num_predict: Math.min(160, Number(process.env.OLLAMA_NUM_PREDICT) || 120),
                    num_ctx: Math.min(1024, Number(process.env.OLLAMA_NUM_CTX) || 512),
                    temperature: 0.4,
                },
            },
            { timeout: TIMEOUT_MS }
        );

        const text = String(data?.response || '').trim();
        if (!text || text.length < 4) {
            return { ok: false, type: 'empty' };
        }

        logger.info('[Ollama] ok', { model, len: text.length });
        return {
            ok: true,
            type: 'ollama',
            text: text.slice(0, 900),
        };
    } catch (e) {
        logger.warn('[Ollama] fail', { model, message: e.message });
        return { ok: false, type: 'error', message: e.message };
    }
}

module.exports = {
    ask,
    isReachable,
};
