'use strict';

const axios = require('axios');
const SmmConfig = require('../smmConfig');
const logger = require('../../../config/logger');

const API_URL = () => SmmConfig.apiUrl;
const TIMEOUT = () => SmmConfig.apiTimeoutMs;

function maskKey(key) {
    if (!key || key.length < 8) return '(empty)';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function isTransientNetworkError(err) {
    const msg = String(err?.message || err?.code || '');
    return /eai_again|enotfound|etimedout|econnrefused|enetunreach|socket hang up|getaddrinfo/i.test(msg);
}

async function apiRequest(payload, attempt = 0) {
    const key = SmmConfig.providerKey;
    if (!key) {
        return { error: true, message: 'FORNECEDOR_BRASIL_API_KEY não configurada' };
    }
    try {
        const response = await axios.post(
            API_URL(),
            new URLSearchParams({ key, ...payload }),
            {
                timeout: TIMEOUT(),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
        );
        return response.data;
    } catch (err) {
        if (attempt < 2 && isTransientNetworkError(err)) {
            await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
            return apiRequest(payload, attempt + 1);
        }
        const raw = err.response?.data;
        const msg =
            typeof raw === 'object' && raw?.message
                ? raw.message
                : typeof raw === 'string'
                  ? raw
                  : err.message || err.code || 'network_error';
        if (!isTransientNetworkError(err)) {
            logger.warn('[SMM:FB] API error', { action: payload.action, detail: String(msg).slice(0, 200) });
        }
        return { error: true, message: msg };
    }
}

const FornecedorBrasilProvider = {
    name: 'fornecedorbrasil',

    async getBalance() {
        const data = await apiRequest({ action: 'balance' });
        if (data?.error === true || (typeof data?.error === 'string' && data.error)) {
            return data;
        }
        if (typeof data === 'string' || typeof data === 'number') {
            return { balance: data, currency: 'BRL' };
        }
        if (data && typeof data === 'object' && data.balance != null) {
            return { balance: data.balance, currency: data.currency || 'BRL' };
        }
        return data;
    },

    async getServices() {
        const data = await apiRequest({ action: 'services' });
        return Array.isArray(data) ? data : [];
    },

    async createOrder({ serviceId, link, quantity, comments }) {
        const payload = {
            action: 'add',
            service: String(serviceId),
            link: String(link),
            quantity: String(quantity),
        };
        if (comments) payload.comments = String(comments);
        return apiRequest(payload);
    },

    async getOrderStatus(providerOrderId) {
        return apiRequest({
            action: 'status',
            order: String(providerOrderId),
        });
    },

    async createRefill(providerOrderId) {
        return apiRequest({
            action: 'refill',
            order: String(providerOrderId),
        });
    },

    async getRefillStatus(refillId) {
        return apiRequest({
            action: 'refill_status',
            refill: String(refillId),
        });
    },

    async cancelOrder(providerOrderId) {
        return apiRequest({
            action: 'cancel',
            orders: String(providerOrderId),
        });
    },

    keyFingerprint() {
        return maskKey(SmmConfig.providerKey);
    },
};

module.exports = FornecedorBrasilProvider;
