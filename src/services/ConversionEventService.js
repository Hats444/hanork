'use strict';

const { connect } = require('../config/database-sqlite');
const logger = require('../config/logger');

const VALID_EVENTS = new Set([
    'user_started',
    'menu_opened',
    'catalog_opened',
    'product_viewed',
    'cart_created',
    'checkout_started',
    'payment_pending',
    'payment_approved',
    'delivery_completed',
    'subscription_activated',
]);

/**
 * Grava evento de conversão de forma assíncrona — falha nunca derruba o bot.
 * @param {number|null} userId
 * @param {string} eventName
 * @param {object} [eventData]
 * @param {number|null} [tenantId]
 */
function trackConversionEvent(userId, eventName, eventData = {}, tenantId = null) {
    if (!eventName || !VALID_EVENTS.has(eventName)) return;
    const uid = userId != null ? Number(userId) : null;
    if (!uid || !Number.isFinite(uid)) return;

    setImmediate(() => {
        try {
            const db = connect();
            const payload = eventData && typeof eventData === 'object' ? eventData : {};
            db.prepare(
                `INSERT INTO conversion_events (user_id, event_name, event_data, tenant_id, created_at)
                 VALUES (?, ?, ?, ?, datetime('now'))`
            ).run(uid, eventName, JSON.stringify(payload), tenantId != null ? Number(tenantId) : null);
        } catch (e) {
            logger.debug('[CONVERSION] track skip:', { event: eventName, detail: e.message });
        }
    });
}

function trackFromTelegramId(telegramId, eventName, eventData = {}, tenantId = null) {
    if (!telegramId) return;
    setImmediate(async () => {
        try {
            const { prisma } = require('../config/database-sqlite');
            const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
            if (user?.id) trackConversionEvent(user.id, eventName, eventData, tenantId ?? user.tenant_id);
        } catch (_) { /* ignore */ }
    });
}

module.exports = { trackConversionEvent, trackFromTelegramId, VALID_EVENTS };
