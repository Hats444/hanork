'use strict';

const { Markup } = require('telegraf');
const { prisma } = require('../config/database');
const dbRaw = require('../config/database-sqlite').connect;
const logger = require('../config/logger');

const KV_PREFIX = 'rating:';

function kvKey(orderId) {
    return `${KV_PREFIX}${orderId}`;
}

function starsLabel(n) {
    const r = Math.min(5, Math.max(1, Number(n) || 1));
    return '⭐'.repeat(r) + '☆'.repeat(5 - r);
}

async function findReviewByOrder(orderId) {
    try {
        return (await prisma.review?.findByOrder?.(orderId)) || null;
    } catch {
        return null;
    }
}

function getKvRating(orderId) {
    try {
        const row = dbRaw().prepare('SELECT value FROM kv_store WHERE key = ?').get(kvKey(orderId));
        if (!row?.value) return null;
        try {
            const parsed = JSON.parse(row.value);
            if (parsed?.stars != null) return parsed;
        } catch {
            /* valor legado */
        }
        const n = parseInt(row.value, 10);
        return Number.isFinite(n) ? { stars: n, at: null } : null;
    } catch {
        return null;
    }
}

function setKvRating(orderId, stars) {
    dbRaw().prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(
        kvKey(orderId),
        JSON.stringify({ stars, at: Date.now() })
    );
}

async function isOrderReviewed(orderId) {
    if (!orderId) return false;
    const existing = await findReviewByOrder(orderId);
    if (existing) return true;
    return !!getKvRating(orderId);
}

function buildReviewKeyboard(orderId) {
    const id = String(orderId);
    return Markup.inlineKeyboard([
        [
            { text: '⭐⭐⭐⭐⭐', callback_data: `rate_${id}_5` },
            { text: '⭐⭐⭐⭐', callback_data: `rate_${id}_4` },
        ],
        [
            { text: '⭐⭐⭐', callback_data: `rate_${id}_3` },
            { text: '⭐⭐', callback_data: `rate_${id}_2` },
            { text: '⭐', callback_data: `rate_${id}_1` },
        ],
    ]);
}

function buildPromptText(orderId) {
    const short = orderId ? String(orderId).slice(-8) : '????';
    return (
        `<b>🌟 Como foi sua experiência?</b>\n\n` +
        `Pedido #${short}\n` +
        `<i>Escolha uma nota — só é possível avaliar uma vez.</i>`
    );
}

async function sendReviewRequest(telegram, chatId, orderId) {
    if (!telegram || !chatId || !orderId) return false;
    if (await isOrderReviewed(orderId)) return false;
    try {
        await telegram.sendMessage(chatId, buildPromptText(orderId), {
            parse_mode: 'HTML',
            ...buildReviewKeyboard(orderId),
        });
        return true;
    } catch (e) {
        logger.warn('[REVIEW] sendReviewRequest', { orderId, message: e?.message });
        return false;
    }
}

async function finalizeMessage(ctx, stars) {
    const label = starsLabel(stars);
    const text =
        `<b>✅ Avaliação registrada</b>\n\n` +
        `Obrigado pelo feedback!\n` +
        `Sua nota: ${label} <b>(${stars}/5)</b>`;
    try {
        if (ctx.callbackQuery?.message) {
            const Msg = require('../telegram/Msg');
            await Msg.editCallbackPanel(ctx, text);
            return;
        }
    } catch (_) { /* mensagem antiga ou igual */ }
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) { /* ignore */ }
}

async function submitFromCallback(ctx, orderId, stars) {
    const rating = Math.min(5, Math.max(1, parseInt(stars, 10) || 0));
    if (!rating) {
        await ctx.answerCbQuery('❌ Nota inválida', { show_alert: true });
        return { ok: false, reason: 'invalid' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
    if (!order || !user || order.user_id !== user.id) {
        await ctx.answerCbQuery('❌ Pedido inválido', { show_alert: true });
        return { ok: false, reason: 'forbidden' };
    }

    if (order.status !== 'DELIVERED') {
        await ctx.answerCbQuery('❌ Só é possível avaliar pedidos entregues', { show_alert: true });
        return { ok: false, reason: 'not_delivered' };
    }

    const existing = await findReviewByOrder(orderId);
    const kv = getKvRating(orderId);
    if (existing || kv) {
        const prev = existing?.rating ?? kv?.stars ?? rating;
        if (existing) setKvRating(orderId, existing.rating);
        await ctx.answerCbQuery('✅ Você já avaliou este pedido.', { show_alert: true });
        await finalizeMessage(ctx, prev);
        return { ok: false, reason: 'duplicate' };
    }

    try {
        await prisma.review.create({
            data: {
                user_id: user.id,
                order_id: orderId,
                rating,
                comment: '',
            },
        });
    } catch (e) {
        const dup = await findReviewByOrder(orderId);
        if (dup) {
            setKvRating(orderId, dup.rating);
            await ctx.answerCbQuery('✅ Você já avaliou este pedido.', { show_alert: true });
            await finalizeMessage(ctx, dup.rating);
            return { ok: false, reason: 'duplicate' };
        }
        logger.error('[REVIEW] submit', { orderId, message: e?.message });
        await ctx.answerCbQuery('❌ Não foi possível salvar. Tente de novo.', { show_alert: true });
        return { ok: false, reason: 'error' };
    }

    setKvRating(orderId, rating);
    await ctx.answerCbQuery(`⭐ Obrigado! (${rating}/5)`);
    await finalizeMessage(ctx, rating);
    logger.info('[REVIEW] saved', { orderId, userId: user.id, rating });
    return { ok: true, rating };
}

module.exports = {
    isOrderReviewed,
    sendReviewRequest,
    submitFromCallback,
    buildReviewKeyboard,
    buildPromptText,
    starsLabel,
};
