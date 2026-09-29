'use strict';

/**
 * Dispara comandos e callbacks nativos do Telegraf sem duplicar handlers.
 * Usado pelo Hanork AI Router para cobrir todo o catálogo (/help, /admin, etc.).
 */
async function dispatchSlash(bot, ctx, slashCmd, args = '') {
    if (!bot?.handleUpdate || !ctx?.chat?.id) return { ok: false, reason: 'no_bot' };

    const cmd = String(slashCmd || '').trim().replace(/^\//, '');
    if (!cmd) return { ok: false, reason: 'empty_cmd' };

    const username = bot.botInfo?.username;
    const mention = username ? `@${username}` : '';
    const firstToken = cmd.split(/\s+/)[0];
    const text = `/${cmd}${mention}${args ? ` ${args}` : ''}`.trim();

    const entityLen = 1 + firstToken.length;

    ctx.state = ctx.state || {};
    ctx.state.hanorkDispatch = true;
    ctx.state.commandHandled = true;

    try {
        await bot.handleUpdate({
            update_id: Math.floor(Math.random() * 1e9),
            message: {
                message_id: (ctx.message?.message_id || 0) + 900000,
                date: Math.floor(Date.now() / 1000),
                chat: ctx.chat,
                from: ctx.from,
                text,
                entities: [{ offset: 0, length: entityLen, type: 'bot_command' }],
            },
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    } finally {
        delete ctx.state.hanorkDispatch;
    }
}

async function dispatchCallback(bot, ctx, callbackData, caption) {
    const data = String(callbackData || '').trim();
    if (!data || !ctx?.chat?.id) return { ok: false, reason: 'empty_cb' };

    const { Markup } = require('telegraf');
    const { Msg } = require('../../telegram/Msg');

    await Msg.reply(
        ctx,
        caption || '<b>Hanork</b>\n\nToque para abrir o painel nativo.',
        Markup.inlineKeyboard([[{ text: '▶️ Abrir', callback_data: data }]]),
        { parse_mode: 'HTML' }
    );
    return { ok: true, needsTap: true };
}

module.exports = { dispatchSlash, dispatchCallback };
