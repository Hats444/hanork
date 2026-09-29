'use strict';

const logger = require('../../../config/logger');
const { deferBackground } = require('../../../utils/defer');
const { getWaDivulgacaoCampaignService } = require('../waDivulgacaoCampaignService');
const { getWaDivulgacaoLoginService } = require('../waDivulgacaoLoginService');
const { waDivulgacaoPanel, deleteUserInputMessage } = require('../helpers/waDivulgacaoPanelUi');
const { campWizardNavKeyboard } = require('../keyboards/waDivulgacaoKeyboards');
const WaDivulgacaoSubscriptionService = require('../waDivulgacaoSubscriptionService');
const GrantSession = require('../waDivulgacaoAdminGrantSession');

function campKeyboard(panel, Markup) {
    if (!panel?.keyboard?.inline_keyboard) {
        return Markup.inlineKeyboard([[{ text: 'Painel', callback_data: 'wadv:home' }]]);
    }
    return Markup.inlineKeyboard(panel.keyboard.inline_keyboard);
}

function awaitTextKeyboard(Markup) {
    return campWizardNavKeyboard();
}

async function consumeInput(ctx) {
    await deleteUserInputMessage(ctx);
    return true;
}

/**
 * Trata texto PV do Hanork Div antes do catch-all / Hanork AI.
 * @returns {Promise<boolean>} true se consumiu o update
 */
async function handleWaDivulgacaoPrivateText(ctx, deps = {}) {
    if (ctx.chat?.type !== 'private') return false;
    const { canAccessWaDivulgacao } = require('../waDivulgacaoAccess');
    if (!canAccessWaDivulgacao(ctx, deps.isAdmin)) return false;
    const txt = String(ctx.message?.text || '');
    if (!txt || txt.startsWith('/')) return false;

    const Msg = deps.Msg || require('../../../telegram/Msg');
    const Markup = deps.Markup || require('telegraf').Markup;
    const prisma = deps.prisma;
    const tid = ctx.from?.id;
    if (!tid) return false;

    // Admin aguardando Telegram ID no painel — não consumir como telefone WA
    if (GrantSession.isAwaitingInput(tid)) return false;

    const camp = getWaDivulgacaoCampaignService();
    const login = getWaDivulgacaoLoginService();
    const cancelTxt = txt.trim().toLowerCase();
    const hasCamp = camp.hasActiveSession(tid);
    const awaitingPhone = login.isAwaitingPhone(tid);
    const awaitingInvite = camp.isAwaitingInvite(tid);
    const inLoginFlow = login.isInLoginFlow(tid);
    const inPairWait = login.isInPairWait(tid);

    if (!hasCamp && !awaitingPhone && !awaitingInvite && !inLoginFlow) {
        const digits = txt.replace(/\D/g, '');
        const looksLikePhone = digits.length >= 10 && digits.length <= 15;
        if (!looksLikePhone) return false;
        if (!prisma) return false;
        const user = await prisma.user.findUnique({ where: { telegram_id: String(tid) } });
        if (!user || !WaDivulgacaoSubscriptionService.findActive(user.id)) return false;
    }

    try {
        if (
            (hasCamp || awaitingInvite || inLoginFlow) &&
            (cancelTxt === 'cancelar' || cancelTxt === 'cancel')
        ) {
            camp.clearSession(tid);
            camp.cancelInviteInput(tid);
            await login.cancel(tid).catch(() => {});
            await waDivulgacaoPanel(
                ctx,
                Msg,
                ' Operação cancelada.\n\nAbra <b> Campanhas</b> ou <b> Conectar</b> quando quiser.',
                Markup.inlineKeyboard([[{ text: 'Hanork Div', callback_data: 'wadv:home' }]])
            );
            logger.info('[WaDivulgacao] cancelled via text', { telegramId: tid });
            return consumeInput(ctx);
        }

        if (awaitingInvite) {
            const r = await camp.acceptInviteLink(tid, txt);
            if (!r.ok) {
                const kb = r?.keyboard?.inline_keyboard
                    ? campKeyboard(r, Markup)
                    : Markup.inlineKeyboard([
                          [{ text: 'Voltar', callback_data: 'wadv:join' }],
                          [{ text: 'Cancelar', callback_data: 'wadv:join:cancel' }],
                      ]);
                await waDivulgacaoPanel(ctx, Msg, r.message || ' Link inválido.', kb);
                return consumeInput(ctx);
            }
            const kb = campKeyboard(r.panel, Markup);
            await waDivulgacaoPanel(ctx, Msg, `${r.message}\n\n${r.panel.message}`, kb);
            return consumeInput(ctx);
        }

        if (inPairWait) {
            const Copy = require('../waDivulgacaoCopy');
            const { pairingFlowKeyboard } = require('../keyboards/waDivulgacaoKeyboards');
            await waDivulgacaoPanel(ctx, Msg, Copy.pairInProgressMessage(), pairingFlowKeyboard(null));
            return consumeInput(ctx);
        }

        if (camp.isAwaitingVariationEdit(tid)) {
            const r = await camp.acceptVariationText(tid, txt);
            if (!r.ok) {
                if (r.reason === 'empty') {
                    await waDivulgacaoPanel(
                        ctx,
                        Msg,
                        ' Envie o <b>texto</b> da mensagem.\n\n<i>Digite <code>cancelar</code> para voltar.</i>',
                        awaitTextKeyboard(Markup)
                    );
                    return consumeInput(ctx);
                }
                await waDivulgacaoPanel(
                    ctx,
                    Msg,
                    r.message || ' Não foi possível salvar.',
                    Markup.inlineKeyboard([[{ text: 'Painel', callback_data: 'wadv:home' }]])
                );
                return consumeInput(ctx);
            }
            const kb = campKeyboard(r.panel, Markup);
            await waDivulgacaoPanel(ctx, Msg, `${r.message}\n\n${r.panel.message}`, kb);
            return consumeInput(ctx);
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
                        ' Envie o <b>texto</b> da campanha.\n\n<i>Digite <code>cancelar</code> para sair.</i>',
                        awaitTextKeyboard(Markup)
                    );
                    return consumeInput(ctx);
                }
                await waDivulgacaoPanel(
                    ctx,
                    Msg,
                    r.message || ' Não foi possível usar esse texto.',
                    Markup.inlineKeyboard([[{ text: 'Painel', callback_data: 'wadv:home' }]])
                );
                return consumeInput(ctx);
            }
            if (r.deferAcceptMode) {
                await waDivulgacaoPanel(
                    ctx,
                    Msg,
                    ' <b>Texto recebido!</b>\n\n⏳ Sincronizando grupos do WhatsApp…',
                    Markup.inlineKeyboard([[{ text: 'Cancelar', callback_data: 'wadv:camp:cancel' }]])
                );
                deferBackground(`wadv-preset-mode-${tid}`, async () => {
                    try {
                        const modeR = await camp.acceptMode(tid, r.mode);
                        const panel = modeR.panel || {
                            message:
                                modeR.message || ' Não foi possível carregar os grupos.',
                            keyboard: modeR.ok
                                ? null
                                : {
                                      inline_keyboard: [
                                          [{ text: 'Conectar WhatsApp', callback_data: 'wadv:connect' }],
                                          [{ text: 'Campanhas', callback_data: 'wadv:campaigns' }],
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
                            ' Falha ao carregar grupos. Conecte o WhatsApp e tente de novo.',
                            Markup.inlineKeyboard([
                                [{ text: 'Conectar', callback_data: 'wadv:connect' }],
                                [{ text: 'Campanhas', callback_data: 'wadv:campaigns' }],
                            ])
                        ).catch(() => {});
                    }
                });
                return consumeInput(ctx);
            }
            const kb = campKeyboard(r.panel, Markup);
            await waDivulgacaoPanel(ctx, Msg, r.panel.message, kb);
            return consumeInput(ctx);
        }

        const digitsOnly = txt.replace(/\D/g, '');
        const looksLikePhone = digitsOnly.length >= 10 && digitsOnly.length <= 15;
        if (looksLikePhone && !camp.isAwaitingText(tid)) {
            if (awaitingPhone && (await login.tryPhoneInput(tid, ctx, txt))) {
                return true;
            }
            if (await login.tryPhoneInputDirect(tid, ctx, txt)) return true;
        }
    } catch (e) {
        logger.warn('[WaDivulgacao] private text handler failed', { uid: tid, error: e?.message });
        await waDivulgacaoPanel(
            ctx,
            Msg,
            ' Erro no Hanork Div. Tente de novo pelo painel ou use <code>/handiv</code>.',
            Markup.inlineKeyboard([[{ text: 'Hanork Div', callback_data: 'wadv:home' }]])
        ).catch(() => {});
        return consumeInput(ctx);
    }

    return false;
}

module.exports = { handleWaDivulgacaoPrivateText };
