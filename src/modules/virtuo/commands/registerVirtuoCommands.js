'use strict';

const logger = require('../../../config/logger');
const { isVirtuoEnabled } = require('../virtuoEnabled');
const { sendHome, dispatchVirtuoTextQuery } = require('../handlers/virtuoUiHandlers');
const { assertVirtuoCatalogAccess } = require('../virtuoAccess');
const { registerVirtuoAdminCommands } = require('./virtuoAdminCommands');

function parseNumerosArgs(text) {
    const rest = String(text || '')
        .replace(/^\/\w+(?:@\w+)?/i, '')
        .trim();
    if (!rest) return { mode: 'home' };
    return { mode: 'query', query: rest };
}

/** Comandos /sms, /numeros — callbacks virtuo:* ficam no CallbackRegistry. */
function registerVirtuoCommands(bot, deps) {
    if (!isVirtuoEnabled()) return;

    const { Msg, isAdmin, requirePrivate } = deps;

    logger.info('[Virtuo] Registrando comandos Telegram');

    registerVirtuoAdminCommands(bot, { isAdmin, Msg });

    async function guardPrivate(ctx) {
        if (requirePrivate && !(await requirePrivate(ctx))) return false;
        return true;
    }

    async function guardCatalog(ctx) {
        if (!(await guardPrivate(ctx))) return false;
        return assertVirtuoCatalogAccess(ctx, Msg, isAdmin);
    }

    async function dispatchNumeros(ctx) {
        if (!(await guardCatalog(ctx))) return;
        const args = parseNumerosArgs(ctx.message?.text);
        if (args.mode === 'query') {
            await dispatchVirtuoTextQuery(ctx, Msg, args.query, { mode: 'hub' });
            return;
        }
        await sendHome(ctx, Msg);
    }

    bot.command(['sms', 'numero', 'virtuo', 'numeros'], async (ctx) => {
        await dispatchNumeros(ctx);
    });
}

async function dispatchVirtuoFromText(ctx, Msg, query, isAdmin, requirePrivate) {
    if (requirePrivate && !(await requirePrivate(ctx))) return false;
    if (!assertVirtuoCatalogAccess(ctx, Msg, isAdmin)) return false;
    await dispatchVirtuoTextQuery(ctx, Msg, query, { mode: 'hub' });
    return true;
}

module.exports = { registerVirtuoCommands, parseNumerosArgs, dispatchVirtuoFromText };
