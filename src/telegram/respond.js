'use strict';

/**
 * Resposta unificada ao usuário — PV via Msg (edit), grupos via MsgService slot (edit).
 */

const Msg = require('./Msg');

function isGroupChat(ctx) {
    const t = ctx.chat?.type;
    return t === 'group' || t === 'supergroup';
}

/**
 * @param {object} ctx - Telegraf context
 * @param {string} text
 * @param {object|null} markup - Markup.inlineKeyboard(...)
 */
async function respond(ctx, text, markup = null) {
    let kb = markup;
    const opts = { parse_mode: 'HTML' };
    if (markup && !markup.reply_markup && !markup.inline_keyboard) {
        Object.assign(opts, markup);
        kb = null;
    }

    if (isGroupChat(ctx)) {
        const MsgService = require('./MsgService');
        const svc = MsgService.get();
        const sendOpts = { ...opts };
        if (kb) sendOpts.reply_markup = kb.reply_markup || kb;
        return svc.sendToGroup(ctx.chat.id, text, sendOpts);
    }
    return Msg.replaceMenu(ctx, text, kb, { useMenuPhoto: true });
}

module.exports = { respond, isGroupChat };
