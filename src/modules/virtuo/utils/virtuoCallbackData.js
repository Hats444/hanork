'use strict';

const CB = {
    HOME: 'virtuo:home',
    confirmPay: 'virtuo:confirm',
    sync: 'virtuo:sync',
    orders: 'virtuo:orders',
    service(code) {
        return `virtuo:svc:${code}`;
    },
    country(serviceId, page = 0) {
        const id = Number(serviceId);
        const p = Math.max(0, Number(page) || 0);
        return p > 0 ? `virtuo:cty:${id}:${p}` : `virtuo:cty:${id}`;
    },
    countriesPage(serviceCode, page = 0) {
        return `virtuo:ctyp:${serviceCode}:${Math.max(0, Number(page) || 0)}`;
    },
    countrySearch(serviceCode) {
        return `virtuo:srch:${String(serviceCode || 'hub').toLowerCase()}`;
    },
    buy(serviceCode, serviceId) {
        const code = String(serviceCode || '').toLowerCase();
        const id = Number(serviceId);
        return `virtuo:buy:${code}:${id}`;
    },
    orderView(id) {
        return `virtuo:ord:${id}`;
    },
    orderRefresh(virtuoOrderId) {
        return `virtuo:ordrf:${Number(virtuoOrderId)}`;
    },
    orderCopyPhone(virtuoOrderId) {
        return `virtuo:ordcp:${Number(virtuoOrderId)}`;
    },
    orderCopyCode(virtuoOrderId) {
        return `virtuo:ordcc:${Number(virtuoOrderId)}`;
    },
};

const PATTERNS = {
    service: /^virtuo:svc:([a-z0-9_]+)$/i,
    country: /^virtuo:cty:(\d+)(?::(\d+))?$/i,
    countriesPage: /^virtuo:ctyp:([a-z0-9_]+):(\d+)$/i,
    countrySearch: /^virtuo:srch:([a-z0-9_]+)$/i,
    buy: /^virtuo:buy:(?:([a-z0-9_]+):)?(\d+)$/i,
    order: /^virtuo:ord:(\d+)$/i,
    orderRefresh: /^virtuo:ordrf:(\d+)$/i,
    orderCopyPhone: /^virtuo:ordcp:(\d+)$/i,
    orderCopyCode: /^virtuo:ordcc:(\d+)$/i,
};

module.exports = { CB, PATTERNS };
