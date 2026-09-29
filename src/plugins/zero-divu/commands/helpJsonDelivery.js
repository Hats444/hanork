'use strict';

const {
    buildHelpJson,
    getHelpJsonFilename,
    buildHelpJsonCaption,
    getHelpKeyboard,
    getAdminCommandsKeyboard,
} = require('./botCommandsCatalog');

const ADMIN_ONLY_SECTIONS = new Set([
    'admin',
    'produtos',
    'divulgacao',
    'grupos',
    'canais',
    'painel',
    'saas',
    'whatsapp',
]);

/**
 * Envia /help e /comandos como arquivo JSON categorizado.
 * @param {object} ctx — contexto Telegraf
 * @param {object} opts
 * @param {string} opts.section — all | user | admin | …
 * @param {boolean} opts.isAdmin
 * @param {boolean} opts.adminPanel — teclado do painel /admin (📖 Comandos)
 */
async function sendHelpJson(ctx, { section = 'all', isAdmin = false, adminPanel = false } = {}) {
    if (ADMIN_ONLY_SECTIONS.has(section) && !isAdmin) {
        section = 'user';
    }

    const payload = buildHelpJson(isAdmin, section);
    const json = JSON.stringify(payload, null, 2);
    const filename = getHelpJsonFilename(section);
    const caption = buildHelpJsonCaption(isAdmin, section, adminPanel);
    const kb = adminPanel ? getAdminCommandsKeyboard(section) : getHelpKeyboard(isAdmin, section);
    const chatId = ctx.chat?.id;
    const telegram = ctx.telegram || ctx.tg;

    if (!chatId || !telegram) return null;

    if (ctx.callbackQuery?.message?.message_id) {
        try {
            await telegram.deleteMessage(chatId, ctx.callbackQuery.message.message_id);
        } catch { /* ignore */ }
    }

    return telegram.sendDocument(
        chatId,
        { source: Buffer.from(json, 'utf8'), filename },
        {
            caption,
            parse_mode: 'HTML',
            reply_markup: kb?.reply_markup,
        }
    );
}

module.exports = { sendHelpJson };
