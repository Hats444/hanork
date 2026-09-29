'use strict';

/**
 * B3 — fluxo de abertura de ticket via callback (move-only de bot.js).
 */
function createStartSupportFlow(deps) {
    const { Msg, Markup, activeChats, botSession, supportMode, sessionNote } = deps;

    return async function startSupportFlow(ctx) {
        const existingChat = await activeChats.get(ctx.chat.id);
        if (existingChat?.role === 'user') {
            await Msg.editCallbackPanel(
                ctx,
                `💬 <b>Você já tem o Ticket #${existingChat.ticketId} aberto.</b>\n\nContinue digitando ou encerre abaixo:`,
                Markup.inlineKeyboard([
                    [{ text: '🔴 Encerrar Ticket', callback_data: `tclose_${existingChat.ticketId}` }],
                    [{ text: '🏠 Menu', callback_data: 'menu:home' }],
                ])
            );
            return;
        }
        const cleared = await botSession.enterUserFlow(ctx, 'support');
        await supportMode.set(ctx.chat.id, { _ts: Date.now() });
        await Msg.editCallbackPanel(
            ctx,
            sessionNote(
                '<b>🎫 Suporte</b>\n\nDescreva seu problema ou dúvida abaixo. Nossa equipe responde aqui no chat.\n\n<i>/cancelar para sair</i>',
                cleared
            ),
            Markup.inlineKeyboard([
                [{ text: '❌ Cancelar', callback_data: 'menu:home' }],
            ])
        );
    };
}

module.exports = { createStartSupportFlow };
