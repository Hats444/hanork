'use strict';

const { normalizeReplyMarkup } = require('../telegram/menus/twoColKeyboard');

/** Substitui teclado inline por estado "processando" (evita cliques duplos). */
async function lockCallbackKeyboard(ctx, label = '⏳ Processando...') {
    try {
        if (ctx.callbackQuery?.message?.message_id) {
            await ctx.editMessageReplyMarkup(
                normalizeReplyMarkup({
                    inline_keyboard: [[{ text: label, callback_data: 'noop' }]],
                })
            );
        }
    } catch (_) { /* mensagem antiga ou sem teclado */ }
}

module.exports = {
    lockCallbackKeyboard,
};
