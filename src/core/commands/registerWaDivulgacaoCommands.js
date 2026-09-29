'use strict';

const logger = require('../../../config/logger');
const { sendWaDivulgacaoHome } = require('../handlers/waDivulgacaoUiHandlers');
const { getWaDivulgacaoCampaignService } = require('../waDivulgacaoCampaignService');
const { getWaDivulgacaoLoginService } = require('../waDivulgacaoLoginService');
const { waDivulgacaoPanel } = require('../helpers/waDivulgacaoPanelUi');
const { extractMedia } = require('../waDivulgacaoMediaHelper');

function registerWaDivulgacaoCommands(bot, deps = {}) {
    const { requirePrivate, Msg, Markup, prisma } = deps;

    async function guard(ctx) {
        if (requirePrivate && !(await requirePrivate(ctx))) return false;
        return true;
    }

    bot.on('text', async (ctx, next) => {
        if (ctx.telegramEvent?.skipUserPipeline) return next();
        try {
            const { handleWaDivulgacaoPrivateText } = require('../handlers/waDivulgacaoPrivateText');
            const handled = await handleWaDivulgacaoPrivateText(ctx, { Msg, Markup, prisma });
            if (handled) return;
        } catch (e) {
            logger.warn('[WaDivulgacao] early text handler', { uid: ctx.from?.id, error: e?.message });
        }
        return next();
    });

    bot.command(['handiv', 'zap', 'wadiv', 'zappro'], async (ctx) => {
        if (!(await guard(ctx))) return;
        return sendWaDivulgacaoHome(ctx);
    });

    async function tryCampaignMedia(ctx) {
        if (ctx.chat?.type !== 'private') return false;
        const camp = getWaDivulgacaoCampaignService();
        if (!camp.isAwaitingText(ctx.from?.id)) return false;
        if (!extractMedia(ctx.message)) return false;

        const r = await camp.acceptMedia(ctx.from.id, ctx, ctx.message);
        const MsgSvc = Msg || require('../../../telegram/Msg');
        const MarkupKb = Markup || require('telegraf').Markup;
        if (!r.ok) {
            await waDivulgacaoPanel(
                ctx,
                MsgSvc,
                r.message || '❌ Não foi possível usar essa mídia.',
                MarkupKb.inlineKeyboard([[{ text: '🔙 Painel', callback_data: 'wadv:home' }]])
            );
            return true;
        }
        if (r.deferAcceptMode) {
            await waDivulgacaoPanel(
                ctx,
                MsgSvc,
                '✅ <b>Mídia recebida!</b>\n\n⏳ Sincronizando grupos do WhatsApp…',
                MarkupKb.inlineKeyboard([[{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }]])
            );
            const { deferBackground } = require('../../../utils/defer');
            const tid = ctx.from.id;
            deferBackground(`wadv-preset-media-${tid}`, async () => {
                const modeR = await camp.acceptMode(tid, r.mode);
                const panel = modeR.panel || {
                    message: modeR.message || '❌ Não foi possível carregar os grupos.',
                };
                const kb = panel.keyboard?.inline_keyboard
                    ? MarkupKb.inlineKeyboard(panel.keyboard.inline_keyboard)
                    : MarkupKb.inlineKeyboard([
                          [{ text: '📱 Conectar WhatsApp', callback_data: 'wadv:connect' }],
                          [{ text: '🔙 Campanhas', callback_data: 'wadv:campaigns' }],
                      ]);
                await waDivulgacaoPanel(
                    { telegram: ctx.telegram, chat: ctx.chat, from: ctx.from },
                    MsgSvc,
                    panel.message,
                    kb
                ).catch(() => {});
            });
            return true;
        }
        const kb = r.panel?.keyboard?.inline_keyboard
            ? MarkupKb.inlineKeyboard(r.panel.keyboard.inline_keyboard)
            : MarkupKb.inlineKeyboard([[{ text: '🔙 Painel', callback_data: 'wadv:home' }]]);
        await waDivulgacaoPanel(ctx, MsgSvc, r.panel.message, kb);
        return true;
    }

    for (const type of ['photo', 'video', 'document', 'animation']) {
        bot.on(type, async (ctx, next) => {
            try {
                if (await tryCampaignMedia(ctx)) return;
            } catch (e) {
                logger.warn('[WaDivulgacao] campaign media failed', {
                    uid: ctx.from?.id,
                    type,
                    error: e?.message,
                });
                const MsgSvc = Msg || require('../../../telegram/Msg');
                const MarkupKb = Markup || require('telegraf').Markup;
                await waDivulgacaoPanel(
                    ctx,
                    MsgSvc,
                    '❌ Falha ao processar mídia. Tente outra imagem ou só texto.',
                    MarkupKb.inlineKeyboard([[{ text: '🔙 Painel', callback_data: 'wadv:home' }]])
                ).catch(() => {});
                return;
            }
            return next();
        });
    }
}

module.exports = { registerWaDivulgacaoCommands };
