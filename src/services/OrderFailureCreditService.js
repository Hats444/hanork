'use strict';

const logger = require('../config/logger');
const { prisma } = require('../config/database-sqlite');
const UserService = require('../modules/user/UserService');
const UserWalletService = require('./UserWalletService');
const { formatMoney } = require('../modules/virtuo/utils/virtuoTextFormat');

const KV_CREDIT_PREFIX = 'wallet_credit:';
const KV_NOTIFY_PREFIX = 'wallet_credit_notify:';

function wasCreditHandled(orderId) {
    try {
        const db = require('../config/database-sqlite').connect();
        return !!db.prepare('SELECT key FROM kv_store WHERE key = ?').get(`${KV_CREDIT_PREFIX}${orderId}`);
    } catch {
        return false;
    }
}

function markCreditHandled(orderId) {
    const db = require('../config/database-sqlite').connect();
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(`${KV_CREDIT_PREFIX}${orderId}`, String(Date.now()));
}

function reasonLabel(reason, module = 'order') {
    if (reason === 'out_of_stock') return 'Sem estoque / números indisponíveis';
    if (reason === 'order_failed') return 'Pedido não concluído a tempo';
    if (reason === 'no_viable_service' || reason === 'service_not_found') {
        return 'Serviço indisponível no momento';
    }
    if (reason === 'provider_rejected') return 'Fornecedor rejeitou o pedido';
    if (reason === 'all_providers_failed') return 'API do fornecedor indisponível';
    if (reason === 'provider_error' || reason === 'fulfill_job_crash') return 'Erro técnico ao enviar o pedido';
    if (reason === 'stuck_fulfill_timeout') return 'Pedido não foi enviado ao fornecedor a tempo';
    if (reason === 'order_canceled') return 'Pedido cancelado pelo fornecedor';
    if (reason === 'insufficient_provider_balance') return 'Alta demanda — fila temporária';
    if (module === 'smm') return 'Falha na entrega SMM';
    if (module === 'virtuo') return 'Falha na reserva do número SMS';
    return 'Não foi possível concluir a entrega';
}

function userCreditLine(creditResult, total) {
    if (!creditResult?.ok || creditResult.skipped) return '';
    if (creditResult.method === 'affiliate_balance') {
        return `\n\n💰 <b>Saldo afiliado devolvido:</b> ${formatMoney(total)}`;
    }
    const bal = creditResult.balanceAfter != null ? formatMoney(creditResult.balanceAfter) : null;
    return (
        `\n\n💳 <b>Valor creditado na sua carteira Hanork:</b> ${formatMoney(total)}` +
        (bal ? `\n💵 <b>Saldo disponível:</b> ${bal}` : '') +
        `\n\n<i>Use no checkout de produtos, SMM ou números SMS — botão «Carteira».</i>`
    );
}

function walletNotifyKeyboard() {
    const { Markup } = require('telegraf');
    const { CB } = require('../telegram/callbacks/constants');
    return Markup.inlineKeyboard([
        [{ text: '💳 Minha carteira', callback_data: 'user:wallet' }],
        [{ text: '🛍️ Catálogo', callback_data: CB.CATALOG_VIEW }],
        [{ text: '📱 Serviços SMM', callback_data: CB.SMM_HOME }],
        [{ text: '📞 Números SMS', callback_data: CB.VIRTUO_HOME }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
    ]);
}

async function notifyUserCredit(hanorkOrderId, creditResult, { reason, module, telegramId: tgOverride }) {
    if (!creditResult?.ok || creditResult.skipped) return false;
    try {
        const db = require('../config/database-sqlite').connect();
        const key = `${KV_NOTIFY_PREFIX}${hanorkOrderId}`;
        if (db.prepare('SELECT key FROM kv_store WHERE key = ?').get(key)) return false;

        const order = await prisma.order.findUnique({ where: { id: hanorkOrderId } });
        let telegramId = tgOverride;
        if (!telegramId && order?.user_id) {
            const user = await prisma.user.findUnique({ where: { id: order.user_id } });
            telegramId = user?.telegram_id;
        }
        if (!telegramId) return false;

        const ref = `#${String(hanorkOrderId).slice(-8)}`;
        const total = Number(order?.total ?? creditResult.amount ?? 0);
        const modLabel =
            module === 'virtuo' ? 'Números SMS' : module === 'smm' ? 'Serviços SMM' : 'Hanork';

        const text =
            `<b>💳 Crédito na carteira — ${modLabel}</b>\n\n` +
            `Pedido <b>${ref}</b>\n` +
            `${reasonLabel(reason, module)}.` +
            userCreditLine(creditResult, total);

        const kb = walletNotifyKeyboard();
        const bot = global.botInstance;
        const token = process.env.BOT_TOKEN || process.env.TOKEN_TELEGRAM;
        if (bot?.telegram) {
            await bot.telegram.sendMessage(Number(telegramId), text, {
                parse_mode: 'HTML',
                ...kb,
            });
        } else if (token) {
            const { Telegraf } = require('telegraf');
            await new Telegraf(token).telegram.sendMessage(Number(telegramId), text, {
                parse_mode: 'HTML',
                ...kb,
            });
        } else return false;

        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(key, String(Date.now()));
        logger.info('[Wallet:credit] usuário notificado', { orderId: hanorkOrderId, telegramId });
        return true;
    } catch (e) {
        logger.warn('[Wallet:credit] notify falhou', { orderId: hanorkOrderId, detail: e.message });
        return false;
    }
}

/**
 * Converte falha pós-pagamento em crédito na carteira (sem reembolso PIX).
 */
async function creditOnFailure(hanorkOrderId, reason = 'fulfill_failed', opts = {}) {
    const module = opts.module || 'order';
    const telegramId = opts.telegramId || null;
    const notifyUser = opts.notifyUser !== false;

    if (wasCreditHandled(hanorkOrderId)) {
        return { ok: true, skipped: true, reason: 'already_handled' };
    }

    const order = await prisma.order.findUnique({ where: { id: hanorkOrderId } });
    if (!order) return { ok: false, reason: 'order_not_found' };
    if (['REFUNDED', 'FAILED', 'CREDITED'].includes(order.status)) {
        markCreditHandled(hanorkOrderId);
        return { ok: true, skipped: true, reason: 'already_terminal' };
    }

    const creditableForModule =
        module === 'smm' || module === 'virtuo'
            ? ['PAID', 'DELIVERING', 'DELIVERED']
            : ['PAID', 'DELIVERING'];
    if (!creditableForModule.includes(order.status)) {
        return { ok: false, reason: 'order_not_paid', status: order.status };
    }

    const total = Number(order.total);
    const errMsg = String(reason || 'fulfill_failed').slice(0, 180);

    try {
        let result;

        if (order.payment_method === 'affiliate_balance') {
            await UserService.cancelAffiliateReserve(order.user_id, total);
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: { status: 'REFUNDED', error_message: `${errMsg} (affiliate_restore)` },
            });
            markCreditHandled(hanorkOrderId);
            result = { ok: true, method: 'affiliate_balance', amount: total };
        } else if (order.payment_method === 'wallet_balance') {
            UserWalletService.credit(order.user_id, total, {
                orderId: hanorkOrderId,
                reason: `restore:${reason}`,
                idempotencyKey: `${KV_CREDIT_PREFIX}${hanorkOrderId}`,
            });
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: { status: 'REFUNDED', error_message: `${errMsg} (wallet_restore)` },
            });
            markCreditHandled(hanorkOrderId);
            const bal = UserWalletService.getBalance(order.user_id);
            result = { ok: true, method: 'wallet_balance', amount: total, balanceAfter: bal };
        } else {
            const credit = UserWalletService.credit(order.user_id, total, {
                orderId: hanorkOrderId,
                reason: `${module}:${reason}`,
                idempotencyKey: `${KV_CREDIT_PREFIX}${hanorkOrderId}`,
            });
            if (!credit.ok) {
                return credit;
            }
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: {
                    status: 'REFUNDED',
                    error_message: `${errMsg} (wallet_credit)`,
                },
            });
            markCreditHandled(hanorkOrderId);
            logger.info('[Wallet:credit] PIX → carteira', {
                orderId: hanorkOrderId,
                total,
                reason,
                module,
            });
            result = {
                ok: true,
                method: 'wallet_credit',
                amount: total,
                balanceAfter: credit.balanceAfter,
            };
        }

        if (notifyUser) {
            await notifyUserCredit(hanorkOrderId, result, { reason, module, telegramId });
        }
        return result;
    } catch (e) {
        logger.error('[Wallet:credit] falha', { orderId: hanorkOrderId, detail: e.message });
        try {
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: {
                    status: 'FAILED',
                    error_message: `${errMsg}; credit_error: ${e.message}`.slice(0, 240),
                },
            });
        } catch {
            /* ignore */
        }
        return { ok: false, reason: 'credit_error', detail: e.message };
    }
}

module.exports = {
    creditOnFailure,
    userCreditLine,
    walletNotifyKeyboard,
    notifyUserCredit,
    reasonLabel,
    wasCreditHandled,
};
