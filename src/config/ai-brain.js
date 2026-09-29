'use strict';

const logger = require('./logger');
const ZeroTwoAi = require('../services/ZeroTwoAiService');

let _cache = { data: null, time: 0 };

function getCached() {
    return Date.now() - _cache.time < 30000 ? _cache.data : null;
}
function setCache(d) {
    _cache = { data: d, time: Date.now() };
}

async function fetchRealTimeData(db) {
    const cached = getCached();
    if (cached) return cached;
    try {
        const users = db.prepare('SELECT COUNT(*) as c FROM users').get();
        const prods = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get();
        const today = db
            .prepare(
                "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE date(created_at)=date('now') AND status IN ('PAID','COMPLETED')"
            )
            .get();
        const month = db
            .prepare(
                "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now') AND status IN ('PAID','COMPLETED')"
            )
            .get();
        const pend = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('WAITING_PAYMENT','PENDING')").get();
        const data = {
            users: { total: users?.c || 0 },
            products: { total: prods?.c || 0 },
            sales: {
                today: { amount: today?.t || 0, count: today?.c || 0 },
                month: { amount: month?.t || 0, count: month?.c || 0 },
            },
            pendingOrders: pend?.c || 0,
        };
        setCache(data);
        return data;
    } catch (e) {
        logger.error('fetchRealTimeData:', e.message);
        return (
            _cache.data || {
                users: { total: 0 },
                products: { total: 0 },
                sales: { today: { amount: 0, count: 0 }, month: { amount: 0, count: 0 } },
                pendingOrders: 0,
            }
        );
    }
}

function getQuickResponse(message, data, isAdmin, db) {
    const lower = message.toLowerCase().trim();
    if (isAdmin) {
        if (/estatistica|venda|numero|numeros|hoje/.test(lower)) {
            return {
                type: 'admin_stats',
                response:
                    `<b>Estatísticas</b>\n\n` +
                    `Hoje: R$ ${data.sales.today.amount.toFixed(2)} (${data.sales.today.count} pedidos)\n` +
                    `Mês: R$ ${data.sales.month.amount.toFixed(2)} (${data.sales.month.count} pedidos)\n` +
                    `Usuários: ${data.users.total}\n` +
                    `Produtos: ${data.products.total}\n` +
                    `Pendentes: ${data.pendingOrders}`,
                action: null,
            };
        }
        if (/top|mais.?vendido|ranking/.test(lower)) {
            try {
                const top = db
                    .prepare(
                        'SELECT p.name, COUNT(o.id) as s FROM orders o JOIN products p ON o.product_id=p.id WHERE o.status IN ("PAID","COMPLETED") GROUP BY p.id ORDER BY s DESC LIMIT 5'
                    )
                    .all();
                let r = '<b>Top produtos</b>\n\n';
                top.forEach((p, i) => {
                    r += `${i + 1}. ${p.name} (${p.s} vendas)\n`;
                });
                return { type: 'admin_top', response: top.length ? r : 'Sem vendas ainda.', action: null };
            } catch (e) {
                logger.error('top:', e.message);
            }
        }
    }
    if (/^(oi|olá|ola|oii|hey)$/.test(lower)) {
        return {
            type: 'instant',
            response: 'Olá. Sou o assistente da loja. Pergunte sobre produtos, PIX ou use /cat.',
            action: null,
        };
    }
    return null;
}

async function processWithBrain(message, userContext, db, isAdmin = false) {
    const t = Date.now();
    const data = await fetchRealTimeData(db);
    const quick = getQuickResponse(message, data, isAdmin, db);
    if (quick) {
        logger.info('Resposta rapida em ' + (Date.now() - t) + 'ms');
        return quick;
    }

    const aiSupport = require('./ai-support');
    const r = await aiSupport.processMessage(message, {
        ...userContext,
        productCount: data.products.total,
    });
    if (r?.response) {
        return { type: r.type || 'brain', response: r.response, action: null };
    }
    return {
        type: 'error',
        response: 'Assistente indisponível. Use <code>/suporte</code>.',
        action: null,
    };
}

async function generateBroadcastText(theme, db) {
    await fetchRealTimeData(db);
    const { generateThemePromoHtml } = require('../utils/broadcastAiCopy');
    const fromVariation = await generateThemePromoHtml(theme, {
        dbRaw: () => db,
    });
    if (fromVariation) return fromVariation;
    return ZeroTwoAi.askBroadcastCopy(theme, {
        botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
    });
}

module.exports = {
    processWithBrain,
    fetchRealTimeData,
    generateBroadcastText,
    isEnabled: () => ZeroTwoAi.isConfigured(),
};
