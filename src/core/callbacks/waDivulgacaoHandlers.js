'use strict';

const { Markup } = require('telegraf');
const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');
const WaDivulgacaoSubscriptionService = require('../waDivulgacaoSubscriptionService');
const {
    sendWaDivulgacaoHome,
    sendWaDivulgacaoPlans,
    sendStubSection,
    buyPlan,
    isWaDivulgacaoEnabled,
} = require('../handlers/waDivulgacaoUiHandlers');
const { waDivulgacaoPanel } = require('../helpers/waDivulgacaoPanelUi');
const { stubBackKeyboard, connectChoiceKeyboard, phonePromptKeyboard, pairingFlowKeyboard, qrFlowKeyboard, connectedSuccessKeyboard, formatPairCodeForCopy } = require('../keyboards/waDivulgacaoKeyboards');
const { getWaDivulgacaoLoginService } = require('../waDivulgacaoLoginService');
const { getWaDivulgacaoCampaignService } = require('../waDivulgacaoCampaignService');
const { requireBotContext } = require('../../../telegram/callbacks/BotContext');

function deps() {
    return requireBotContext(['Msg', 'prisma']);
}

function campKeyboard(panel) {
    if (!panel?.keyboard?.inline_keyboard) return stubBackKeyboard();
    return Markup.inlineKeyboard(panel.keyboard.inline_keyboard);
}

async function requireActiveSub(ctx) {
    const { prisma } = deps();
    const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
    if (!WaDivulgacaoSubscriptionService.findActive(user?.id)) {
        await sendWaDivulgacaoPlans(ctx);
        return null;
    }
    return user;
}

const SESSION_EXPIRED_MSG =
    '⏱ <b>Sessão expirada</b>\n\nAbra <b>📣 Campanhas</b> e comece novamente.';

async function showCampPanel(ctx, panel) {
    const { Msg } = deps();
    if (!panel) {
        return waDivulgacaoPanel(ctx, Msg, SESSION_EXPIRED_MSG, stubBackKeyboard('wadv:campaigns'));
    }
    return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
}

const WaDivulgacaoHandlers = {
    'wadv:home': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!isWaDivulgacaoEnabled()) {
            const { Msg } = deps();
            return waDivulgacaoPanel(
                ctx,
                Msg,
                '📲 <b>Hanork Div</b>\n\nMódulo temporariamente indisponível.',
                stubBackKeyboard('subscription:view')
            );
        }
        return sendWaDivulgacaoHome(ctx);
    },

    'wadv:plans': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        return sendWaDivulgacaoPlans(ctx);
    },

    'wadv:buy:*': async (ctx, [productId]) => {
        await safeAnswerCbQuery(ctx, '💳 Preparando plano…');
        return buyPlan(ctx, productId);
    },

    'wadv:connect': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const login = getWaDivulgacaoLoginService();
        const r = await login.showConnectChoice(ctx.from.id, ctx);

        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message, stubBackKeyboard('wadv:home'));
        }
        if (r.alreadyConnected) {
            return sendWaDivulgacaoHome(ctx);
        }
        if (r.alreadyAwaiting) {
            return waDivulgacaoPanel(ctx, Msg, r.message, connectChoiceKeyboard());
        }
        return waDivulgacaoPanel(ctx, Msg, r.message || 'Escolha o método:', connectChoiceKeyboard());
    },

    'wadv:connect:qr': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const login = getWaDivulgacaoLoginService();
        const r = await login.startQr(ctx.from.id, ctx);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message, connectChoiceKeyboard());
        }
        if (r.alreadyConnected) {
            return sendWaDivulgacaoHome(ctx);
        }
        if (r.alreadyAwaiting) {
            return waDivulgacaoPanel(ctx, Msg, r.message, qrFlowKeyboard());
        }
        return waDivulgacaoPanel(ctx, Msg, r.message, qrFlowKeyboard());
    },

    'wadv:connect:pair': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const login = getWaDivulgacaoLoginService();
        const r = await login.promptPhone(ctx.from.id, ctx);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message, connectChoiceKeyboard());
        }
        if (r.alreadyConnected) {
            return sendWaDivulgacaoHome(ctx);
        }
        if (r.alreadyAwaiting) {
            const code = login.getLastPairCode(ctx.from.id);
            return waDivulgacaoPanel(
                ctx,
                Msg,
                r.message,
                code ? pairingFlowKeyboard(code) : phonePromptKeyboard()
            );
        }
        return waDivulgacaoPanel(ctx, Msg, r.message, phonePromptKeyboard());
    },

    'wadv:connect:retry_pair': async (ctx) => {
        await safeAnswerCbQuery(ctx, '🔄 Gerando novo código…');
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const login = getWaDivulgacaoLoginService();
        const r = await login.retryPairing(ctx.from.id, ctx);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message, connectChoiceKeyboard());
        }
        const code = login.getLastPairCode(ctx.from.id);
        return waDivulgacaoPanel(
            ctx,
            Msg,
            r.message,
            code ? pairingFlowKeyboard(code) : phonePromptKeyboard()
        );
    },

    'wadv:copy_pair': async (ctx) => {
        if (!(await requireActiveSub(ctx))) return;
        const login = getWaDivulgacaoLoginService();
        const raw = login.getLastPairCode(ctx.from.id);
        if (!raw) {
            return ctx.answerCbQuery('Código expirado — toque em Novo código', { show_alert: true }).catch(() => {});
        }
        const formatted = formatPairCodeForCopy(raw);
        const digits = String(formatted || '').replace(/\D/g, '');
        const toCopy = digits.length === 8 ? digits : formatted;
        await safeAnswerCbQuery(ctx, `📋 ${formatted}`);
        const { Msg } = deps();
        return Msg.reply(
            ctx,
            `📋 <b>Código WhatsApp</b>\n\n<code>${toCopy}</code>\n\n<i>Toque no código acima para copiar e cole no app.</i>`,
            pairingFlowKeyboard(raw, { useCallbackCopy: true })
        );
    },

    'wadv:disconnect': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const login = getWaDivulgacaoLoginService();
        await login.disconnect(ctx.from.id);
        return sendWaDivulgacaoHome(ctx);
    },

    'wadv:campaigns': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const camp = getWaDivulgacaoCampaignService();
        const panel = camp.buildCampaignEntryPanel();
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:camp:new': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const start = getWaDivulgacaoCampaignService().startWizard(ctx.from.id);
        return waDivulgacaoPanel(
            ctx,
            Msg,
            start.message,
            Markup.inlineKeyboard([
                [{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }],
                [{ text: '🏠 Painel', callback_data: 'wadv:home' }],
            ])
        );
    },

    'wadv:preset:*': async (ctx, [presetId]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const r = getWaDivulgacaoCampaignService().applyPreset(ctx.from.id, presetId);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', stubBackKeyboard('wadv:campaigns'));
        }
        return waDivulgacaoPanel(
            ctx,
            Msg,
            r.panel.message,
            Markup.inlineKeyboard([
                [{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }],
                [{ text: '🏠 Painel', callback_data: 'wadv:home' }],
            ])
        );
    },

    'wadv:history': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().buildHistoryPanel(ctx.from.id, 0);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:hist:pg:*': async (ctx, [page]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().buildHistoryPanel(ctx.from.id, page);
        return showCampPanel(ctx, panel);
    },

    'wadv:scheduled': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const panel = await getWaDivulgacaoCampaignService().buildScheduledPanel(ctx.from.id);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:sched:cancel:*': async (ctx, [jobId]) => {
        await safeAnswerCbQuery(ctx, '🚫 Cancelando…');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const r = await getWaDivulgacaoCampaignService().cancelScheduledCampaign(ctx.from.id, jobId);
        return waDivulgacaoPanel(ctx, Msg, r.message, campKeyboard(r.panel));
    },

    'wadv:camp:cancel': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        getWaDivulgacaoCampaignService().clearSession(ctx.from.id);
        getWaDivulgacaoLoginService().cancel(ctx.from.id).catch(() => {});
        return sendWaDivulgacaoHome(ctx);
    },

    'wadv:camp:all': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().selectAll(ctx.from.id, 'all');
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:none': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().selectAll(ctx.from.id, 'none');
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:pg:*': async (ctx, [page]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().setPage(ctx.from.id, page);
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:tg:*:*': async (ctx, [page, idx]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().toggleGroup(ctx.from.id, page, idx);
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:delay': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().buildDelayPanel(ctx.from.id);
        if (!panel?.keyboard) {
            return waDivulgacaoPanel(
                ctx,
                Msg,
                panel?.message || SESSION_EXPIRED_MSG,
                stubBackKeyboard('wadv:campaigns')
            );
        }
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:camp:delay:*': async (ctx, [ms]) => {
        await safeAnswerCbQuery(ctx, `⏱ ${Math.round(Number(ms) / 1000)}s`);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().setDelay(ctx.from.id, ms);
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:back': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().backToGroups(ctx.from.id);
        return showCampPanel(ctx, panel);
    },

    'wadv:camp:go': async (ctx) => {
        await safeAnswerCbQuery(ctx, '🚀 Disparando…');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const camp = getWaDivulgacaoCampaignService();
        const r = await camp.launch(ctx.from.id, ctx);
        const kb = r.ok ? stubBackKeyboard() : stubBackKeyboard('wadv:campaigns');
        return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', kb);
    },

    'wadv:camp:sched:*': async (ctx, [ms]) => {
        await safeAnswerCbQuery(ctx, '⏰ Agendando…');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const camp = getWaDivulgacaoCampaignService();
        const r = await camp.scheduleLaunch(ctx.from.id, ms, ctx);
        const kb = r.ok ? stubBackKeyboard() : stubBackKeyboard('wadv:campaigns');
        return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', kb);
    },

    'wadv:camp:save_list': async (ctx) => {
        await safeAnswerCbQuery(ctx, '💾');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const camp = getWaDivulgacaoCampaignService();
        const r = camp.saveCurrentGroupList(ctx.from.id);
        const panel = camp.buildGroupsPanel(ctx.from.id);
        if (panel?.keyboard) {
            return waDivulgacaoPanel(
                ctx,
                Msg,
                `${r.message}\n\n${panel.message}`,
                campKeyboard(panel)
            );
        }
        return waDivulgacaoPanel(ctx, Msg, r.message || SESSION_EXPIRED_MSG, stubBackKeyboard('wadv:campaigns'));
    },

    'wadv:grp:list:*': async (ctx, [listId]) => {
        await safeAnswerCbQuery(ctx, '👥 Carregando lista…');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const r = await getWaDivulgacaoCampaignService().applyGroupList(ctx.from.id, listId);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', stubBackKeyboard('wadv:settings'));
        }
        return waDivulgacaoPanel(ctx, Msg, r.panel.message, campKeyboard(r.panel));
    },

    'wadv:settings:pace:*': async (ctx, [pace]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().setSettingsPace(ctx.from.id, pace);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:settings:hours:*': async (ctx, [hours]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().setSettingsHours(ctx.from.id, hours);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:camp:save_tpl': async (ctx) => {
        await safeAnswerCbQuery(ctx, '💾');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const r = getWaDivulgacaoCampaignService().saveCurrentTemplate(ctx.from.id);
        const panel = r.ok ? getWaDivulgacaoCampaignService().buildModePanel(ctx.from.id) : null;
        if (panel?.keyboard) {
            return waDivulgacaoPanel(
                ctx,
                Msg,
                `${r.message}\n\n${panel.message}`,
                campKeyboard(panel)
            );
        }
        return waDivulgacaoPanel(ctx, Msg, r.message || SESSION_EXPIRED_MSG, stubBackKeyboard('wadv:campaigns'));
    },

    'wadv:camp:mode:*': async (ctx, [mode]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const r = await getWaDivulgacaoCampaignService().acceptMode(ctx.from.id, mode);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', stubBackKeyboard('wadv:campaigns'));
        }
        return waDivulgacaoPanel(ctx, Msg, r.panel.message, campKeyboard(r.panel));
    },

    'wadv:camp:cycles:*': async (ctx, [n]) => {
        await safeAnswerCbQuery(ctx, `${n}×`);
        if (!(await requireActiveSub(ctx))) return;
        const panel = getWaDivulgacaoCampaignService().setCycles(ctx.from.id, n);
        return showCampPanel(ctx, panel);
    },

    'wadv:stats': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const r = await getWaDivulgacaoCampaignService().statsPanel(ctx.from.id);
        return waDivulgacaoPanel(
            ctx,
            Msg,
            r.message || '❌ Erro.',
            Markup.inlineKeyboard([
                [{ text: '🔙 Painel', callback_data: 'wadv:home' }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ])
        );
    },

    'wadv:groups': async (ctx) => {
        await safeAnswerCbQuery(ctx, '👥 Sincronizando…');
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const r = await getWaDivulgacaoCampaignService().listGroupsPanel(ctx.from.id);
        return waDivulgacaoPanel(
            ctx,
            Msg,
            r.message || '❌ Erro.',
            Markup.inlineKeyboard([
                [{ text: '🔄 Atualizar', callback_data: 'wadv:groups' }],
                [{ text: '🔙 Painel', callback_data: 'wadv:home' }],
            ])
        );
    },

    'wadv:settings': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;

        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().buildSettingsPanel(ctx.from.id);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:settings:delay:*': async (ctx, [ms]) => {
        await safeAnswerCbQuery(ctx, `⏱ ${Math.round(Number(ms) / 1000)}s padrão`);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().setSettingsDelay(ctx.from.id, ms);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:settings:mode:*': async (ctx, [mode]) => {
        await safeAnswerCbQuery(ctx);
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const panel = getWaDivulgacaoCampaignService().setSettingsMode(ctx.from.id, mode);
        return waDivulgacaoPanel(ctx, Msg, panel.message, campKeyboard(panel));
    },

    'wadv:tpl:*': async (ctx, [index]) => {
        await safeAnswerCbQuery(ctx, '📄 Modelo aplicado');
        if (!(await requireActiveSub(ctx))) return;
        const { Msg } = deps();
        const r = getWaDivulgacaoCampaignService().applyTemplate(ctx.from.id, index);
        if (!r.ok) {
            return waDivulgacaoPanel(ctx, Msg, r.message || '❌ Erro.', stubBackKeyboard('wadv:settings'));
        }
        return waDivulgacaoPanel(ctx, Msg, r.panel.message, campKeyboard(r.panel));
    },

    'wadv:cancel': async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const { Msg, prisma } = deps();
        const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
        if (!user) {
            return waDivulgacaoPanel(ctx, Msg, '❌ Faça /start primeiro.', stubBackKeyboard('menu:home'));
        }

        const sub = WaDivulgacaoSubscriptionService.findActive(user.id);
        if (!sub || sub.status === 'cancelled') {
            return waDivulgacaoPanel(ctx, Msg, 'ℹ️ Não há renovação ativa para cancelar.', stubBackKeyboard());
        }

        WaDivulgacaoSubscriptionService.cancel(user.id);
        const next = sub.next_payment_date ? new Date(sub.next_payment_date).toLocaleDateString('pt-BR') : '—';
        return waDivulgacaoPanel(
            ctx,
            Msg,
            `✅ <b>Renovação cancelada</b>\n\nSeu Hanork Div continua até <b>${next}</b>.`,
            stubBackKeyboard()
        );
    },
};

module.exports = { WaDivulgacaoHandlers };
