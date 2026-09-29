'use strict';

const logger = require('../../../config/logger');
const { deferBackground } = require('../../../utils/defer');
const { getWaDivulgacaoCampaignService } = require('../waDivulgacaoCampaignService');
const { getWaDivulgacaoLoginService } = require('../waDivulgacaoLoginService');
const { waDivulgacaoPanel } = require('../helpers/waDivulgacaoPanelUi');
const WaDivulgacaoSubscriptionService = require('../waDivulgacaoSubscriptionService');

function campKeyboard(panel, Markup) {
    if (!panel?.keyboard?.inline_keyboard) {
        return Markup.inlineKeyboard([[{ text: '🔙 Painel', callback_data: 'wadv:home' }]]);
    }
    return Markup.inlineKeyboard(panel.keyboard.inline_keyboard);
}

function awaitTextKeyboard(Markup) {
    return Markup.inlineKeyboard([
        [{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }],
        [{ text: '🏠 Painel', callback_data: 'wadv:home' }],
    ]);
}

/**
 * Trata texto PV do Hanork Div antes do catch-all / Hanork AI.
 * @returns {Promise<boolean>} true se consumiu o update
 */
async function handleWaDivulgacaoPrivateText(ctx, deps = {}) {
    if (ctx.chat?.type !== 'private') return false;

    const txt = String(ctx.message?.text || '');
    if (!txt || txt.startsWith('/')) return false;

    const Msg = deps.Msg || require('../../../telegram/Msg');
    const Markup = deps.Markup || require('telegraf').Markup;
    const prisma = deps.prisma;
    const tid = ctx.from?.id;
    if (!tid) return false;

    const camp = getWaDivulgacaoCampaignService();
    const login = getWaDivulgacaoLoginService();
    const cancelTxt = txt.trim().toLowerCase();

    const hasCamp = camp.hasActiveSession(tid);
    const awaitingPhone = login.isAwaitingPhone(tid);
    if (!hasCamp && !awaitingPhone) {
        const digits = txt.replace(/\D/g, '');
        const looksLikePhone = digits.length >= 10 && digits.length <= 15;
        if (!looksLikePhone) return false;
        if (!prisma) return false;
        const user = await prisma.user.findUnique({ where: { telegram_id: String(tid) } });
        if (!user || !WaDivulgacaoSubscriptionService.findActive(user.id)) return false;
    }

    try {
        if (hasCamp && (cancelTxt === 'cancelar' || cancelTxt === 'cancel')) {
            camp.clearSession(tid);
            await login.cancel(tid).catch(() => {});
            await Msg.reply(
                ctx,
                '❌ Campanha/conexão cancelada.\n\nAbra <b>📣 Campanhas</b> ou <b>📱 Conectar</b> quando quiser.',
                Markup.inlineKeyboard([[{ text: '🏠 Hanork Div', callback_data: 'wadv:home' }]])
            );
            logger.info('[WaDivulgacao] campaign cancelled via text', { telegramId: tid });
            return true;
        }

        if (camp.isAwaitingText(tid)) {
            logger.info('[WaDivulgacao] campaign text input', {
                telegramId: tid,
                chars: txt.length,
                preset: camp.getSession(tid)?.presetId || null,
            });

            const r = await camp.acceptText(tid, txt);
            if (!r.ok) {
                if (r.reason === 'empty') {
                    await waDivulgacaoPanel(
                        ctx,
                        Msg,
                        '📝 Envie o <b>texto</b> da campanha.\n\n<i>Digite <code>cancelar</code> para sair.</i>',
                        awaitTextKeyboard(Markup)
                    );
                    return true;
                }
                await waDivulgacaoPanel(
                    ctx,
                    Msg,
                    r.message || '❌ Não foi possível usar esse texto.',
                    Markup.inlineKeyboard([[{ text: '🔙 Painel', callback_data: 'wadv:home' }]])
                );
                return true;
            }

            if (r.deferAcceptMode) {
                await waDivulgacaoPanel(
                    ctx,
                    Msg,
                    '✅ <b>Texto recebido!</b>\n\n⏳ Sincronizando grupos do WhatsApp…',
                    Markup.inlineKeyboard([[{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }]])
                );
                deferBackground(`wadv-preset-mode-${tid}`, async () => {
                    try {
                        const modeR = await camp.acceptMode(tid, r.mode);
                        const panel = modeR.panel || {
                            message: modeR.message || '❌ Não foi possível carregar os grupos.',
                            keyboard: modeR.ok
                                ? null
                                : {
                                      inline_keyboard: [
                                          [{ text: '📱 Conectar WhatsApp', callback_data: 'wadv:connect' }],
                                          [{ text: '🔙 Campanhas', callback_data: 'wadv:campaigns' }],
                                      ],
                                  },
                        };
                        const kb = campKeyboard(panel, Markup);
                        await waDivulgacaoPanel(
                            { telegram: ctx.telegram, chat: ctx.chat, from: ctx.from },
                            Msg,
                            panel.message,
                            kb
                        );
                    } catch (e) {
                        logger.warn('[WaDivulgacao] preset acceptMode failed', {
                            telegramId: tid,
                            error: e?.message,
                        });
                        await waDivulgacaoPanel(
                            { telegram: ctx.telegram, chat: ctx.chat, from: ctx.from },
                            Msg,
                            '❌ Falha ao carregar grupos. Conecte o WhatsApp e tente de novo.',
                            Markup.inlineKeyboard([
                                [{ text: '📱 Conectar', callback_data: 'wadv:connect' }],
                                [{ text: '🔙 Campanhas', callback_data: 'wadv:campaigns' }],
                            ])
                        ).catch(() => {});
                    }
                });
                return true;
            }

            const kb = campKeyboard(r.panel, Markup);
            await waDivulgacaoPanel(ctx, Msg, r.panel.message, kb);
            return true;
        }

        if (awaitingPhone && (await login.tryPhoneInput(tid, ctx, txt))) {
            return true;
        }

        if (!hasCamp && !awaitingPhone) {
            if (await login.tryPhoneInputDirect(tid, ctx, txt)) return true;
        }
    } catch (e) {
        logger.warn('[WaDivulgacao] private text handler failed', {
            uid: tid,
            error: e?.message,
        });
        await Msg.reply(
            ctx,
            '⚠️ Erro no Hanork Div. Tente de novo pelo painel ou use <code>/handiv</code>.',
            { parse_mode: 'HTML' }
        ).catch(() => {});
        return true;
    }

    return false;
}

module.exports = { handleWaDivulgacaoPrivateText };
