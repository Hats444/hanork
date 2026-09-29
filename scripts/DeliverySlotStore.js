'use strict';

/**
 * Persistência de mensagens do bot por chat (SQLite).
 * Garante edit-after-restart para divulgações em grupos/canais/PV.
 */

const logger = require('../config/logger');
const { withSqliteRetryAsync } = require('../utils/sqliteRetry');
const { normalizeSlotChatId, slotMessageId } = require('../telegram/messageDelivery');

function parseSqliteTs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const s = String(value).trim();
    const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
    return Number.isFinite(t) ? t : 0;
}

class DeliverySlotStore {
    constructor(dbRaw) {
        this.dbRaw = dbRaw;
    }

    _menu() {
        const { prisma } = require('../config/database');
        return prisma.menuMessage;
    }

    /**
     * @returns {Promise<{ messageId, chatId, menuType, messageType, textPreview, updatedAt }|null>}
     */
    async get(chatId) {
        const key = normalizeSlotChatId(chatId);
        if (!key) return null;

        try {
            const row = this._menu().get(key);
            if (!row?.message_id) return null;
            return {
                messageId: Number(row.message_id),
                chatId: key,
                menuType: row.menu_type || 'promo',
                messageType: row.message_type || 'text',
                textPreview: row.text_preview || '',
                updatedAt: parseSqliteTs(row.updated_at),
            };
        } catch (e) {
            logger.warn('[DeliverySlot] get:', e.message);
            return null;
        }
    }

    async save(chatId, data) {
        const key = normalizeSlotChatId(chatId);
        const messageId = slotMessageId(data);
        if (!key || messageId == null) return;

        try {
            await withSqliteRetryAsync(() => {
                this._menu().set(key, messageId, data.menuType || data.menu_type || 'promo', {
                    message_type: data.messageType || data.message_type || 'text',
                    text_preview: (data.text || data.textPreview || '').slice(0, 400),
                });
            });
        } catch (e) {
            logger.warn('[DeliverySlot] save:', e.message);
        }
    }

    async delete(chatId) {
        const key = normalizeSlotChatId(chatId);
        if (!key) return;
        try {
            this._menu().delete(key);
        } catch (e) {
            logger.warn('[DeliverySlot] delete:', e.message);
        }
    }

    /** Contagem de slots persistidos (boot / diagnóstico) */
    count() {
        try {
            const db = this.dbRaw();
            return db.prepare('SELECT COUNT(*) AS c FROM last_menu_messages').get()?.c || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Migra slot volátil do Redis (legado) para SQLite uma vez.
     */
    async adoptFromRedis(chatId, redisSlot) {
        if (!redisSlot) return null;
        const existing = await this.get(chatId);
        if (existing?.messageId) return existing;
        const mid = slotMessageId(redisSlot);
        if (!mid) return null;
        const payload = {
            messageId: mid,
            menuType: 'promo',
            messageType: 'text',
            text: redisSlot.text || '',
            updatedAt: redisSlot.updatedAt || Date.now(),
        };
        await this.save(chatId, payload);
        return payload;
    }
}

let singleton = null;

function getDeliverySlotStore(dbRaw) {
    if (!singleton) {
        singleton = new DeliverySlotStore(dbRaw || (() => require('../config/database-sqlite').connect()));
    }
    return singleton;
}

module.exports = { DeliverySlotStore, getDeliverySlotStore, parseSqliteTs };
