'use strict';

const logger = require('../../../config/logger');
const { requireWadvAdmin } = require('../helpers/waDivulgacaoAdminGuard');
const AdminService = require('../waDivulgacaoAdminService');
const WaDivulgacaoConfig = require('../waDivulgacaoConfig');

const SUBS_PER_PAGE = 6;

function backKb() {
    return { inline_keyboard: [[{ text: '🔙 Hanork Div Admin', callback_data: 'a_wadv_menu' }]] };
}

function menuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '👥 Assinantes', callback_data: 'a_wadv_subs:0' },
                { text: '🗂 Revogados', callback_data: 'a_wadv_revoked:0' },
            ],
            [
                { text: '🔄 Atualizar', callback_data: 'a_wadv_menu' },
                { text: '📦 Sync planos', callback_data: 'a_wadv_sync' },
            ],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }],
        ],
    };
}

function formatSubscriberLine(d) {
    const wa = AdminService.readUserConnection(d.telegramId);
    const dot = d.status === 'active' && wa?.connected ? '🟢' : d.status === 'active' ? '🟡' : '🔴';
    const who = d.username
        ? `${d.displayName ? `${d.displayName} · ` : ''}${d.username}`
        : d.displayName || 'Cliente';
    const paid = `R$ ${d.totalPaid.toFixed(2)}`;
    const order = d.orderRef ? ` · pedido <code>#${d.orderRef}</code>` : '';
    return (
        `${dot} <b>#${d.subId}</b> · ${who}\n` +
        `   <code>${d.telegramId}</code>\n` +
        `   <b>${d.planName}</b> · ${paid} pago (${d.totalPayments}×)${order}\n` +
        `   Válido até <b>${d.validUntil}</b> · ${d.status}`
    );
}

function buildMenuMessage() {
    const st = AdminService.getGlobalStats();
    if (!st) return '❌ Banco indisponível.';
    const revoked = AdminService.listRevokedSubscriptions(1, 0).total;
    return (
        `📲 <b>Hanork Div — Admin</b>\n\n` +
        `✅ <b>Ativos:</b> ${st.active}\n` +
        `🗂 <b>Revogados (30d):</b> ${revoked}\n` +
        `💰 <b>MRR planos:</b> R$ ${st.mrr.toFixed(2)}\n` +
        `📈 <b>Total pago:</b> R$ ${st.paidTotal.toFixed(2)}\n` +
        `🟢 <b>Workers online:</b> ${st.workersOnline}\n` +
        `📱 <b>WA conectados:</b> ${st.workersConnected}\n\n` +
        `<b>Marca d'água:</b>\n<code>${st.watermark}</code>\n\n` +
        `<i>Comandos: /wadv_stats · /wadv_subs · /wadv_plans</i>`
    );
}

function buildSubsMessage(page = 0) {
    const pg = Math.max(0, Number(page) || 0);
    const { rows, total } = AdminService.listActiveSubscriptions(SUBS_PER_PAGE, pg * SUBS_PER_PAGE);
    if (!rows.length) {
        return { message: '👥 <b>Assinantes ativos</b>\n\nNenhum plano ativo no momento.', keyboard: backKb() };
    }

    const lines = rows.map((r) => formatSubscriberLine(AdminService.buildSubscriberDetail(r)));

    const kb = [];
    for (const r of rows) {
        const d = AdminService.buildSubscriberDetail(r);
        kb.push([
            { text: `➕7d #${r.id}`, callback_data: `a_wadv_ext:${r.id}` },
            { text: `⚠️ Revogar #${r.id}`, callback_data: `a_wadv_revoke:${r.id}` },
        ]);
        if (d.telegramId) {
            kb.push([
                {
                    text: `🔌 Desconectar ${String(d.telegramId).slice(-6)}`,
                    callback_data: `a_wadv_disc:${d.telegramId}`,
                },
            ]);
        }
    }

    const nav = [];
    if (pg > 0) nav.push({ text: '◀️', callback_data: `a_wadv_subs:${pg - 1}` });
    if ((pg + 1) * SUBS_PER_PAGE < total) nav.push({ text: '▶️', callback_data: `a_wadv_subs:${pg + 1}` });
    if (nav.length) kb.push(nav);
    kb.push([{ text: '🔙 Hanork Div Admin', callback_data: 'a_wadv_menu' }]);

    return {
        message:
            `👥 <b>Assinantes Hanork Div</b>\n` +
            `<i>${total} ativo(s) · página ${pg + 1}</i>\n\n` +
            lines.join('\n\n'),
        keyboard: { inline_keyboard: kb },
    };
}

function buildRevokedMessage(page = 0) {
    const pg = Math.max(0, Number(page) || 0);
    const { rows, total } = AdminService.listRevokedSubscriptions(SUBS_PER_PAGE, pg * SUBS_PER_PAGE);
    if (!rows.length) {
        return {
            message: '🗂 <b>Revogados recentes</b>\n\nNenhuma assinatura revogada nos últimos 30 dias.',
            keyboard: backKb(),
        };
    }

    const lines = rows.map((r) => {
        const d = AdminService.buildSubscriberDetail(r);
        const who = d.username || d.displayName || 'Cliente';
        return (
            `🔴 <b>#${d.subId}</b> · ${who} · <code>${d.telegramId}</code>\n` +
            `   ${d.planName} · ${d.totalPaid > 0 ? `R$ ${d.totalPaid.toFixed(2)} pago` : 'sem histórico'}\n` +
            `   Revogado: <b>${d.cancelledAt || '—'}</b>`
        );
    });

    const kb = rows.map((r) => [
        { text: `♻️ Restaurar #${r.id}`, callback_data: `a_wadv_restore:${r.id}` },
    ]);
    const nav = [];
    if (pg > 0) nav.push({ text: '◀️', callback_data: `a_wadv_revoked:${pg - 1}` });
    if ((pg + 1) * SUBS_PER_PAGE < total) nav.push({ text: '▶️', callback_data: `a_wadv_revoked:${pg + 1}` });
    if (nav.length) kb.push(nav);
    kb.push([{ text: '🔙 Hanork Div Admin', callback_data: 'a_wadv_menu' }]);

    return {
        message:
            `🗂 <b>Revogados (30 dias)</b>\n` +
            `<i>${total} registro(s) · página ${pg + 1}</i>\n\n` +
            lines.join('\n\n'),
        keyboard: { inline_keyboard: kb },
    };
}

function buildRevokeConfirmMessage(subId) {
    const sub = AdminService.findSubscriptionById(subId);
    if (!sub) {
        return {
            message: '❌ Assinatura não encontrada.',
            keyboard: backKb(),
        };
    }
    const d = AdminService.buildSubscriberDetail(sub);
    const who = d.username
        ? `${d.displayName ? `${d.displayName} · ` : ''}${d.username}`
        : d.displayName || 'Cliente';
    return {
        message:
            `⚠️ <b>Confirmar revogação</b>\n\n` +
            `Assinatura <b>#${d.subId}</b>\n` +
            `👤 ${who}\n` +
            `📱 <code>${d.telegramId}</code>\n\n` +
            `📦 <b>Plano:</b> ${d.planName}\n` +
            `💰 <b>Total pago:</b> R$ ${d.totalPaid.toFixed(2)} (${d.totalPayments} pagamento(s))\n` +
            `📅 <b>Válido até:</b> ${d.validUntil}\n` +
            (d.orderRef ? `🧾 <b>Último pedido:</b> <code>#${d.orderRef}</code>\n` : '') +
            `\n<b>O cliente perde o acesso na hora.</b>\n` +
            `<i>Use "Revogados" para restaurar depois, se foi engano.</i>`,
        keyboard: {
            inline_keyboard: [
                [
                    { text: '✅ Sim, revogar', callback_data: `a_wadv_revoke_confirm:${subId}` },
                    { text: '❌ Cancelar', callback_data: 'a_wadv_subs:0' },
                ],
            ],
        },
    };
}

function registerWaDivulgacaoAdminPanel(bot, deps) {
    const { isAdmin, Msg, editAdminPanel } = deps;
    if (!WaDivulgacaoConfig.enabled) return;

    async function showPanel(ctx, text, keyboard) {
        if (editAdminPanel) {
            return editAdminPanel(ctx, text, keyboard, { parse_mode: 'HTML' });
        }
        return Msg.reply(ctx, text, keyboard, { parse_mode: 'HTML' });
    }

    async function showMenu(ctx) {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery?.().catch(() => {});
        return showPanel(ctx, buildMenuMessage(), menuKeyboard());
    }

    bot.action('a_wadv_menu', showMenu);

    bot.action(/^a_wadv_subs:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery?.().catch(() => {});
        const page = parseInt(ctx.match[1], 10) || 0;
        const panel = buildSubsMessage(page);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_revoked:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery?.().catch(() => {});
        const page = parseInt(ctx.match[1], 10) || 0;
        const panel = buildRevokedMessage(page);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_ext:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        const subId = parseInt(ctx.match[1], 10);
        const ok = AdminService.extendSubscription(subId, 7);
        await ctx.answerCbQuery?.(ok ? '➕ +7 dias' : '❌ Falhou', { show_alert: !ok }).catch(() => {});
        const panel = buildSubsMessage(0);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_revoke:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery?.().catch(() => {});
        const subId = parseInt(ctx.match[1], 10);
        const panel = buildRevokeConfirmMessage(subId);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_revoke_confirm:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        const subId = parseInt(ctx.match[1], 10);
        const before = AdminService.buildSubscriberDetail(AdminService.findSubscriptionById(subId));
        const ok = AdminService.revokeSubscription(subId);
        if (ok && before) {
            logger.warn('[WaDivulgacao] Assinatura revogada por admin', {
                subId,
                adminId: ctx.from?.id,
                telegramId: before.telegramId,
                planName: before.planName,
                totalPaid: before.totalPaid,
                orderId: before.orderId,
            });
        }
        await ctx.answerCbQuery?.(ok ? '🚫 Revogado' : '❌ Falhou', { show_alert: !ok }).catch(() => {});
        const panel = buildSubsMessage(0);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_restore:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        const subId = parseInt(ctx.match[1], 10);
        const before = AdminService.buildSubscriberDetail(AdminService.findSubscriptionById(subId));
        const r = AdminService.restoreSubscription(subId);
        if (r.ok && before) {
            logger.info('[WaDivulgacao] Assinatura restaurada por admin', {
                subId,
                adminId: ctx.from?.id,
                telegramId: before.telegramId,
                days: r.days,
            });
        }
        await ctx
            .answerCbQuery?.(r.ok ? `♻️ Restaurado (+${r.days}d)` : '❌ Falhou', { show_alert: !r.ok })
            .catch(() => {});
        const panel = buildRevokedMessage(0);
        return showPanel(ctx, panel.message, panel.keyboard);
    });

    bot.action(/^a_wadv_disc:(\d+)$/, async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        const tg = ctx.match[1];
        await ctx.answerCbQuery?.('🔌 Desconectando…').catch(() => {});
        const r = await AdminService.forceDisconnect(tg);
        const txt = r.ok ? `✅ ${r.message}` : `❌ ${r.message || 'Falha'}`;
        return showPanel(ctx, `${txt}\n\n${buildMenuMessage()}`, menuKeyboard());
    });

    bot.action('a_wadv_sync', async (ctx) => {
        if (!requireWadvAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery?.('📦 Sincronizando…').catch(() => {});
        const r = AdminService.syncPlans();
        const note = `✅ Planos sincronizados: <b>${r.upserted || 0}</b>`;
        return showPanel(ctx, `${note}\n\n${buildMenuMessage()}`, menuKeyboard());
    });
}

module.exports = { registerWaDivulgacaoAdminPanel, buildMenuMessage, buildSubsMessage };
