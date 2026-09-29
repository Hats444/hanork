'use strict';

/**
 * Persistência de auditoria de updates Telegram — colunas tipadas, sem JSON.
 */
function createTelegramEventAuditService(dbRaw) {
    const insertStmt = () =>
        dbRaw().prepare(`
            INSERT INTO telegram_event_audit (
                event_type, route, route_executed,
                chat_id, chat_type, chat_title,
                user_id, username, first_name,
                message_id, message_text, callback_data,
                skip_user_pipeline, is_real_user_message,
                is_private, is_group, is_supergroup, is_channel,
                is_debug, event_ts
            ) VALUES (
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?, ?, ?,
                ?, ?
            )
        `);

    function rowFromMeta(meta, extra = {}) {
        return {
            event_type: String(meta.eventType || 'other'),
            route: String(meta.route || 'system'),
            route_executed: String(extra.routeExecuted || meta.route || 'system'),
            chat_id: meta.chatId != null ? String(meta.chatId) : null,
            chat_type: meta.chatType || null,
            chat_title: meta.chatTitle || null,
            user_id: meta.userId != null ? String(meta.userId) : null,
            username: meta.username || null,
            first_name: meta.firstName || null,
            message_id: meta.messageId != null ? Number(meta.messageId) : null,
            message_text: meta.text ? String(meta.text).slice(0, 200) : null,
            callback_data: extra.callbackData ? String(extra.callbackData).slice(0, 80) : null,
            skip_user_pipeline: meta.skipUserPipeline ? 1 : 0,
            is_real_user_message: meta.isRealUserMessage ? 1 : 0,
            is_private: meta.isPrivate ? 1 : 0,
            is_group: meta.isGroup ? 1 : 0,
            is_supergroup: meta.isSuperGroup ? 1 : 0,
            is_channel: meta.isChannel ? 1 : 0,
            is_debug: extra.isDebug ? 1 : 0,
            event_ts: meta.timestamp != null ? Number(meta.timestamp) : Math.floor(Date.now() / 1000),
        };
    }

    function insert(meta, extra = {}) {
        const r = rowFromMeta(meta, extra);
        insertStmt().run(
            r.event_type,
            r.route,
            r.route_executed,
            r.chat_id,
            r.chat_type,
            r.chat_title,
            r.user_id,
            r.username,
            r.first_name,
            r.message_id,
            r.message_text,
            r.callback_data,
            r.skip_user_pipeline,
            r.is_real_user_message,
            r.is_private,
            r.is_group,
            r.is_supergroup,
            r.is_channel,
            r.is_debug,
            r.event_ts
        );
    }

    function recent(limit = 50) {
        return dbRaw()
            .prepare('SELECT * FROM telegram_event_audit ORDER BY id DESC LIMIT ?')
            .all(Math.min(Math.max(limit, 1), 500));
    }

    function byEventType(eventType, limit = 50) {
        return dbRaw()
            .prepare(
                'SELECT * FROM telegram_event_audit WHERE event_type = ? ORDER BY id DESC LIMIT ?'
            )
            .all(String(eventType), Math.min(Math.max(limit, 1), 500));
    }

    function byChatId(chatId, limit = 50) {
        return dbRaw()
            .prepare(
                'SELECT * FROM telegram_event_audit WHERE chat_id = ? ORDER BY id DESC LIMIT ?'
            )
            .all(String(chatId), Math.min(Math.max(limit, 1), 500));
    }

    function cleanupOld(days = 30) {
        const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
        return dbRaw()
            .prepare(
                `DELETE FROM telegram_event_audit WHERE created_at < datetime('now', '-${safeDays} days')`
            )
            .run().changes;
    }

    return { insert, rowFromMeta, recent, byEventType, byChatId, cleanupOld };
}

module.exports = { createTelegramEventAuditService };
