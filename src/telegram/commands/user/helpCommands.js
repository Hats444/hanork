'use strict';

const { sendHelpJson } = require('../helpJsonDelivery');
const { denySilent } = require('../../../utils/silencedAccess');

function registerHelpCommands(bot, deps) {
    const { isGroupChat, groupGuard, CONFIG, isAdmin, bot: telegramBot } = deps;

    async function sendHelpMessage(ctx, section = 'all') {
        const admin = isAdmin(ctx.from.id);
        const adminOnly = ['admin', 'produtos', 'divulgacao', 'grupos', 'canais', 'painel', 'saas', 'whatsapp'];
        if (adminOnly.includes(section) && !admin) {
            if (ctx.callbackQuery) denySilent('help_admin', ctx);
            return sendHelpJson(ctx, { section: 'user', isAdmin: false });
        }
        await sendHelpJson(ctx, { section, isAdmin: admin });
    }

    bot.command('help', async (ctx) => {
        if (isGroupChat(ctx)) {
            return groupGuard.sendGroupWelcome(ctx, telegramBot, { supportUrl: CONFIG.CONTATO_ESPECIALISTA });
        }
        await sendHelpMessage(ctx, 'all');
    });

    bot.command('comandos', async (ctx) => {
        if (isGroupChat(ctx)) {
            return groupGuard.sendGroupWelcome(ctx, telegramBot, { supportUrl: CONFIG.CONTATO_ESPECIALISTA });
        }
        await sendHelpMessage(ctx, 'all');
    });

    const HELP_SECTION_MAP = {
        help_sec_user: 'user',
        help_sec_admin: 'admin',
        help_sec_produtos: 'produtos',
        help_sec_divulgacao: 'divulgacao',
        help_sec_grupos: 'grupos',
        help_sec_canais: 'canais',
        help_sec_painel: 'painel',
        help_sec_saas: 'saas',
        help_sec_whatsapp: 'whatsapp',
        help_sec_all: 'all',
    };

    for (const [cb, sec] of Object.entries(HELP_SECTION_MAP)) {
        bot.action(cb, async (ctx) => {
            const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');
            await safeAnswerCbQuery(ctx);
            const admin = isAdmin(ctx.from.id);
            if (['admin', 'produtos', 'divulgacao', 'grupos', 'canais', 'painel', 'saas', 'whatsapp'].includes(sec) && !admin) {
                denySilent('help_admin', ctx);
                return sendHelpJson(ctx, { section: 'user', isAdmin: false });
            }
            await sendHelpMessage(ctx, sec);
        });
    }

    return { sendHelpMessage };
}

module.exports = { registerHelpCommands };
