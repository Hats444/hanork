'use strict';

const { Markup } = require('telegraf');
const { prisma } = require('../config/database');
const dbRaw = require('../config/database-sqlite').connect;
const logger = require('../config/logger');
const { withLockOrSkip } = require('../infrastructure/DistributedStateManager');

const RESEND_COOLDOWN_MS = 86400000;
const KV_PREFIX = 'resend_ts_';

function getLastResendAt(orderId) {
    try {
        const row = dbRaw().prepare('SELECT value FROM kv_store WHERE key = ?').get(`${KV_PREFIX}${orderId}`);
        if (!row?.value) return null;
        const n = parseInt(row.value, 10);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

function setLastResendAt(orderId) {
    dbRaw().prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(
        `${KV_PREFIX}${orderId}`,
        String(Date.now())
    );
}

function getCooldownInfo(orderId) {
    const last = getLastResendAt(orderId);
    if (!last) return { onCooldown: false, msLeft: 0, availableAt: null };
    const msLeft = RESEND_COOLDOWN_MS - (Date.now() - last);
    if (msLeft <= 0) return { onCooldown: false, msLeft: 0, availableAt: null };
    return {
        onCooldown: true,
        msLeft,
        availableAt: new Date(last + RESEND_COOLDOWN_MS),
    };
}

function formatCooldownMessage(msLeft, availableAt) {
    const hLeft = Math.floor(msLeft / 3600000);
    const mLeft = Math.ceil((msLeft % 3600000) / 60000);
    const dispAt = availableAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `⏳ Disponível em ${hLeft}h${mLeft > 0 ? `${mLeft}min` : ''} (${dispAt}). Limite: 1x por 24h.`;
}

async function getOrderItems(orderId) {
    const ois = await prisma.orderItem.findMany({ where: { order_id: orderId } });
    return Promise.all(ois.map(async (oi) => {
        const prod = await prisma.product.findUnique({ where: { id: oi.product_id } });
        return {
            product_id: oi.product_id,
            quantity: oi.quantity,
            price: oi.price,
            name: prod?.name || 'Produto',
            file_url: prod?.file_url || '',
            is_subscription: !!prod?.is_subscription,
        };
    }));
}

function buildResendListKeyboard(orders) {
    const rows = orders.map((o) => {
        const cd = getCooldownInfo(o.id);
        const short = o.id.slice(-8);
        const date = new Date(o.created_at).toLocaleDateString('pt-BR');
        if (cd.onCooldown) {
            return [{ text: `#${short} — ⏳ aguarde 24h`, callback_data: `resend_cd_${o.id}` }];
        }
        return [{
            text: `#${short} — R$ ${o.total.toFixed(2)} (${date})`,
            callback_data: `resend_${o.id}`,
        }];
    });
    rows.push([{ text: '🔙 Minha Conta', callback_data: 'menu:minha_conta' }, { text: '🏠 Menu', callback_data: 'home' }]);
    return Markup.inlineKeyboard(rows);
}

const LIST_TEXT =
    '<b>🔄 Reenviar produto</b>\n\n' +
    'Escolha o pedido:\n\n' +
    '<i>Limite: 1 reenvio por pedido a cada 24h</i>';

async function finalizeResendMessage(ctx, orderId, itemNames = []) {
    const short = String(orderId).slice(-8);
    const list = itemNames.length ? itemNames.join(', ') : 'seus produtos';
    const text =
        `<b>✅ Produto reenviado</b>\n\n` +
        `Pedido #${short}\n` +
        `📦 ${list}\n\n` +
        `<i>Próximo reenvio deste pedido em 24h.</i>`;
    try {
        if (ctx.callbackQuery?.message) {
            const Msg = require('../telegram/Msg');
            await Msg.editCallbackPanel(ctx, text);
            return;
        }
    } catch (_) { /* ignore */ }
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) { /* ignore */ }
}

async function submitFromCallback(ctx, orderId, deliverFn) {
    const cd = getCooldownInfo(orderId);
    if (cd.onCooldown) {
        await ctx.answerCbQuery(formatCooldownMessage(cd.msLeft, cd.availableAt), { show_alert: true });
        await finalizeResendMessage(ctx, orderId);
        return { ok: false, reason: 'cooldown' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
    if (!order || !user || order.user_id !== user.id) {
        await ctx.answerCbQuery('❌ Pedido inválido', { show_alert: true });
        return { ok: false, reason: 'forbidden' };
    }
    if (order.status !== 'DELIVERED') {
        await ctx.answerCbQuery('❌ Só é possível reenviar pedidos entregues', { show_alert: true });
        return { ok: false, reason: 'not_delivered' };
    }

    const result = await withLockOrSkip(`resend:${orderId}`, 120000, async () => {
        const cd2 = getCooldownInfo(orderId);
        if (cd2.onCooldown) {
            return { ok: false, reason: 'cooldown', cooldown: cd2 };
        }
        const items = await getOrderItems(orderId);
        if (!items.length) {
            return { ok: false, reason: 'no_items' };
        }
        try {
            await deliverFn(ctx, ctx.chat.id, items);
            setLastResendAt(orderId);
            return { ok: true, items };
        } catch (e) {
            logger.error('[Resend] deliver failed', { orderId, message: e?.message });
            return { ok: false, reason: 'deliver_error', error: e };
        }
    });

    if (result === null) {
        await ctx.answerCbQuery('⏳ Reenvio já em andamento…', { show_alert: true });
        return { ok: false, reason: 'lock' };
    }

    if (result.reason === 'cooldown' && result.cooldown) {
        await ctx.answerCbQuery(
            formatCooldownMessage(result.cooldown.msLeft, result.cooldown.availableAt),
            { show_alert: true }
        );
        await finalizeResendMessage(ctx, orderId);
        return { ok: false, reason: 'cooldown' };
    }

    if (!result.ok) {
        const msg = result.reason === 'no_items'
            ? '❌ Pedido sem itens'
            : `❌ Erro: ${result.error?.message || 'falha no reenvio'}`;
        await ctx.answerCbQuery(msg, { show_alert: true });
        return result;
    }

    await ctx.answerCbQuery('✅ Produto reenviado!');
    await finalizeResendMessage(ctx, orderId, result.items.map((i) => i.name));
    logger.info('[Resend] ok', { orderId, userId: user.id });
    return { ok: true };
}

async function handleCooldownTap(ctx, orderId) {
    const cd = getCooldownInfo(orderId);
    if (cd.onCooldown) {
        await ctx.answerCbQuery(formatCooldownMessage(cd.msLeft, cd.availableAt), { show_alert: true });
    } else {
        await ctx.answerCbQuery('✅ Este pedido já pode ser reenviado. Toque de novo na lista.', { show_alert: true });
    }
}

module.exports = {
    RESEND_COOLDOWN_MS,
    getCooldownInfo,
    formatCooldownMessage,
    buildResendListKeyboard,
    LIST_TEXT,
    submitFromCallback,
    handleCooldownTap,
    getOrderItems,
};
