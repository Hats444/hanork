'use strict';

/**
 * Wrapper aditivo sobre fornecedorBrasilProvider — não altera o client original.
 * Expõe aliases unificados (addOrder, getStatus, getMultiStatus) para o ProviderManager.
 */
const FornecedorBrasilProvider = require('./fornecedorBrasilProvider');

const ORIGIN = 'SSM';

function normalizeServices(services) {
    if (!Array.isArray(services)) return [];
    return services.map((raw) => ({
        providerServiceId: Number(raw.service),
        name: String(raw.name || ''),
        rate: Number(raw.rate),
        min: Number(raw.min),
        max: Number(raw.max),
        origin: ORIGIN,
        provider: FornecedorBrasilProvider.name,
        raw,
    }));
}

const SsmProviderAdapter = {
    name: FornecedorBrasilProvider.name,
    origin: ORIGIN,

    getBalance: FornecedorBrasilProvider.getBalance.bind(FornecedorBrasilProvider),
    getServices: FornecedorBrasilProvider.getServices.bind(FornecedorBrasilProvider),
    createOrder: FornecedorBrasilProvider.createOrder.bind(FornecedorBrasilProvider),
    getOrderStatus: FornecedorBrasilProvider.getOrderStatus.bind(FornecedorBrasilProvider),
    createRefill: FornecedorBrasilProvider.createRefill.bind(FornecedorBrasilProvider),
    getRefillStatus: FornecedorBrasilProvider.getRefillStatus.bind(FornecedorBrasilProvider),
    cancelOrder: FornecedorBrasilProvider.cancelOrder.bind(FornecedorBrasilProvider),
    keyFingerprint: FornecedorBrasilProvider.keyFingerprint.bind(FornecedorBrasilProvider),

    async addOrder(serviceId, link, quantity, options = {}) {
        return FornecedorBrasilProvider.createOrder({
            serviceId,
            link,
            quantity,
            ...options,
        });
    },

    async getStatus(orderId) {
        return FornecedorBrasilProvider.getOrderStatus(orderId);
    },

    async getMultiStatus(orderIds) {
        const ids = (Array.isArray(orderIds) ? orderIds : [orderIds])
            .map((id) => String(id))
            .filter(Boolean);
        if (!ids.length) return [];
        if (ids.length === 1) {
            const one = await FornecedorBrasilProvider.getOrderStatus(ids[0]);
            return [{ orderId: ids[0], ...((one && typeof one === 'object') ? one : { raw: one }) }];
        }
        const axios = require('axios');
        const SmmConfig = require('../smmConfig');
        const key = SmmConfig.providerKey;
        if (!key) return ids.map((orderId) => ({ orderId, error: true, message: 'missing_key' }));
        try {
            const response = await axios.post(
                SmmConfig.apiUrl,
                new URLSearchParams({ key, action: 'status', orders: ids.join(',') }),
                {
                    timeout: SmmConfig.apiTimeoutMs,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                }
            );
            const data = response.data;
            if (Array.isArray(data)) {
                return data.map((row, i) => ({ orderId: ids[i], ...row }));
            }
            if (data && typeof data === 'object') {
                return ids.map((orderId) => ({ orderId, ...(data[orderId] || data) }));
            }
            return ids.map((orderId) => ({ orderId, raw: data }));
        } catch (err) {
            return ids.map((orderId) => ({
                orderId,
                error: true,
                message: err.message || 'network_error',
            }));
        }
    },

    normalizeServices,
};

module.exports = SsmProviderAdapter;
