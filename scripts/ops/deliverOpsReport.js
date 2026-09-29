'use strict';

const logger = require('../../config/logger');
const { getMenuPhotoInput } = require('../../telegram/menuPhoto');
const { truncateTelegramHtml } = require('../../telegram/telegramLimits');
const { deliverMessage, resolvePhotoInput } = require('../../telegram/messageDelivery');

const CAPTION_MAX = 980;
const SLOT_PREFIX = 'ops_report_slot:';

function getDb() {
    try {
        return require('../../config/database-sqlite').connect();
    } catch {
        return null;
    }
}

function loadReportSlot(chatId) {
    const db = getDb();
    if (!db || chatId == null) return null;
    try {
        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(`${SLOT_PREFIX}${chatId}`);
        if (!row?.value) return null;
        const parsed = JSON.parse(row.value);
        const messageId = Number(parsed?.messageId);
        if (!Number.isFinite(messageId)) return null;
        return {
            messageId,
            messageType: parsed.messageType === 'text' ? 'text' : 'photo',
        };
    } catch {
        return null;
    }
}

function saveReportSlot(chatId, messageId, messageType = 'photo') {
    const db = getDb();
    if (!db || chatId == null || messageId == null) return;
    try {
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(
            `${SLOT_PREFIX}${chatId}`,
            JSON.stringify({
                messageId: Number(messageId),
                messageType: messageType === 'text' ? 'text' : 'photo',
                updatedAt: Date.now(),
            })
        );
    } catch (e) {
        logger.warn('[OpsReport] slot save:', e.message);
    }
}

/** @deprecated Relatórios usam só infos/ — mantido por compat. de chamadas antigas. */
function resolveOpsPhotoDirs() {
    return [];
}

function fitCaption(html, max = CAPTION_MAX) {
    let body = truncateTelegramHtml(String(html || ''));
    if (body.length <= max) return body;
    return truncateTelegramHtml(`${body.slice(0, max - 14)}\n<i>…</i>`);
}

/**
 * Relatório ops no PV do admin — foto de infos/menu*.jpg + slot próprio.
 */
async function deliverOpsReport(telegram, chatId, html, opts = {}) {
    const menuPhoto = getMenuPhotoInput(chatId, `ops-report:${chatId}`);
    const photo = resolvePhotoInput(menuPhoto);
    const requirePhoto = opts.requirePhoto !== false;
    const body = fitCaption(html, opts.maxCaption || CAPTION_MAX);
    const singleMessage = opts.singleMessage !== false;

    if (requirePhoto && !photo) {
        logger.warn('[OpsReport] sem foto menu — coloque infos/menu.jpg, menu2.jpg, etc.', { chatId });
    }

    const slot = loadReportSlot(chatId);
    const messageIsPhoto = slot ? slot.messageType === 'photo' : true;

    try {
        const r = await deliverMessage(telegram, chatId, slot, body, { parse_mode: 'HTML' }, {
            photo,
            requirePhoto: requirePhoto && !!photo,
            pvPromo: true,
            messageIsPhoto,
        });

        if (r?.messageId && r.action !== 'blocked') {
            saveReportSlot(chatId, r.messageId, photo ? 'photo' : 'text');
            logger.info(`[OpsReport] ${r.action} chat=${chatId} foto=${!!photo}`);
            return {
                ok: true,
                mode: photo ? 'photo' : 'text',
                action: r.action,
                messageId: r.messageId,
            };
        }

        if (r?.action === 'blocked') {
            return { ok: false, mode: 'blocked' };
        }
    } catch (e) {
        logger.warn('[OpsReport] slot deliver:', e.message);
        if (!singleMessage) throw e;
    }

    if (photo) {
        try {
            const input = typeof photo === 'object' && photo.source != null ? photo.source : photo;
            const sent = await telegram.sendPhoto(chatId, input, { caption: body, parse_mode: 'HTML' });
            saveReportSlot(chatId, sent.message_id, 'photo');
            return { ok: true, mode: 'photo', action: 'sent', messageId: sent.message_id };
        } catch (e) {
            logger.warn('[OpsReport] sendPhoto fallback:', e.message);
            if (!singleMessage) throw e;
        }
    }

    if (singleMessage) {
        await telegram.sendMessage(chatId, body, { parse_mode: 'HTML' });
        return { ok: true, mode: photo ? 'text_fallback' : 'text' };
    }

    const chunks = body.match(/[\s\S]{1,3800}/g) || [body];
    for (const chunk of chunks) {
        await telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
    }
    return { ok: true, mode: 'text' };
}

module.exports = {
    deliverOpsReport,
    resolveOpsPhotoDirs,
    fitCaption,
    loadReportSlot,
    saveReportSlot,
};
