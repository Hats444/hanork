'use strict';

const { BroadcastService } = require('../../../services/BroadcastService');
const { JoinChatService, extractJoinTargets, isPrivateInviteLink, parseTelegramTarget } = require('../../../services/JoinChatService');
const { deferBackground } = require('../../../utils/defer');
const { normalizeSlotChatId } = require('../../messageDelivery');
const { kb2, normalizeReplyMarkup } = require('../../menus/twoColKeyboard');
const Msg = require('../../Msg');

/** Painel de progresso — edita callback com foto de menu no PV (sem slot de menu). */
async function sendProgressPanel(telegram, chatId, callbackMessageId, text, keyboard) {
    if (!chatId) return null;
    const key = normalizeSlotChatId(chatId);
    const slot = callbackMessageId ? { messageId: callbackMessageId, chatId: key } : null;
    try {
        const r = await Msg.deliverToChat(telegram, key, text, keyboard, {
            withMenuPhoto: true,
            messageIsPhoto: true,
        });
        return r?.messageId || callbackMessageId || null;
    } catch {
        return callbackMessageId || null;
    }
}

/** Atualiza painel admin após broadcast — edita ou envia nova com foto de menu. */
async function updateAdminPanelMessage(telegram, chatId, messageId, text, keyboard) {
    return sendProgressPanel(telegram, chatId, messageId, text, keyboard);
}

function entrarNeedsBridge(text) {
    const bridge = require('../../../services/TelegramUserBridge');
    if (!bridge.canUseBridge() || bridge.isConfigured()) return false;
    const links = extractJoinTargets(text);
    return links.some((l) => {
        if (isPrivateInviteLink(l)) return true;
        try {
            return parseTelegramTarget(l).kind === 'invite';
        } catch {
            return /t\.me\/\+/i.test(l);
        }
    });
}

function fullDivulgacaoDeps(deps) {
    return {
        autoBroadcastService: deps.autoBroadcastService,
        broadcastService: deps.broadcastService,
        CONFIG: deps.CONFIG,
        loadProducts: deps.loadProducts,
        prisma: deps.prisma,
        logger: deps.logger,
    };
}

/** TG completo + sync WA — anti-spam: um ciclo por vez */
function startFullDivulgacaoBackground(ctx, deps, source) {
    const {
        isDivulgacaoBusy,
        runFullDivulgacaoCycle,
    } = require('../../../plugins/zero-divu/fullDivulgacao');
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) return Promise.resolve({ skipped: true, reason: 'busy' });

    const { notifyBroadcastComplete } = require('../../broadcastNotify');
    const panelMsg = ctx.callbackQuery?.message;
    const panelRef = {
        chatId: panelMsg?.chat?.id ?? ctx.chat?.id,
        messageId: panelMsg?.message_id,
        isPhoto: !!(panelMsg?.photo?.length),
        userId: ctx.from?.id,
    };
    const backKb = kb2(deps.Markup, [[{ text: '🔙 Broadcast', callback_data: 'a_bcast' }]]);
    const bcastNotifyOpts = {
        adminIds: deps.CONFIG?.ID_DONO || [ctx.from.id],
        userId: ctx.from?.id,
    };

    const progressText =
        '⏳ <b>Divulgação em andamento...</b>\n\n' +
        '👤 PV · 👥 Grupos · 📡 Canais · 📱 Ponte MTProto' +
        (require('../../../plugins/zero-divu/config').isZeroDivuEnabled()
            ? ' · WhatsApp Status (fila anti-rajada)'
            : '') +
        '\n\n<i>Esta mensagem atualiza ao terminar.</i>';

    return notifyBroadcastComplete(
        ctx.telegram,
        panelRef,
        progressText,
        backKb,
        { ...bcastNotifyOpts, adminIds: [] }
    ).then(() => {
        const t0 = Date.now();
        return runFullDivulgacaoCycle(fd, source)
            .then(async (r) => {
                let txt =
                    r?.success !== false && BroadcastService
                        ? BroadcastService.formatFullResult(r)
                        : '❌ Não foi possível concluir (verifique logs).';
                if (r?.productName) {
                    txt = `📦 <b>${r.productName}</b>${r.productId ? ` (#${r.productId})` : ''}\n\n` + txt;
                }
                const sec = Math.round((Date.now() - t0) / 1000);
                txt = `✅ <b>Divulgação finalizada</b> (${sec}s)\n\n${txt}`;
                if (r?.bridgePromo && !r.bridgePromo.skipped) {
                    txt += `\n\n📱 Ponte: ${r.bridgePromo.sent ?? 0} envio(s)`;
                }
                await notifyBroadcastComplete(ctx.telegram, panelRef, txt, backKb, bcastNotifyOpts);
                return r;
            })
            .catch(async (e) => {
                deps.logger.error('[Broadcast] full divulgacao:', e.message);
                await notifyBroadcastComplete(
                    ctx.telegram,
                    panelRef,
                    `❌ <b>Erro na divulgação</b>\n\n${e.message}`,
                    backKb,
                    bcastNotifyOpts
                );
                throw e;
            });
    });
}

async function replyEntrarBatch(ctx, batch, Msg, Markup) {
    const summary = JoinChatService.formatSummary(batch);
    await Msg.reply(
        ctx,
        summary.text,
        kb2(Markup, JoinChatService.getReplyKeyboardRows(summary))
    );
    return summary;
}

module.exports = {
    sendProgressPanel,
    updateAdminPanelMessage,
    entrarNeedsBridge,
    fullDivulgacaoDeps,
    startFullDivulgacaoBackground,
    replyEntrarBatch,
};
