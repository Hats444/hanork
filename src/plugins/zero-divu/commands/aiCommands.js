'use strict';

const { Markup } = require('telegraf');
const HanorkInvoke = require('../../services/HanorkInvokeRouter');
const HanorkIntentEngine = require('../../services/hanork-ai/HanorkIntentEngine');
const HanorkRouterGuard = require('../../services/hanork-ai/HanorkRouterGuard');
const COPY = require('../../config/hanork-router-copy');
const groupGuard = require('../groupGuard');
const downloadsGuard = require('../downloadsGuard');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');

function hanorkAssistKeyboard() {
    return Markup.inlineKeyboard([
        [
            { text: '🛍️ Catálogo', callback_data: 'cat' },
            { text: '🛒 Carrinho', callback_data: 'cart' },
        ],
        [
            { text: '⬇️ Downloads', callback_data: 'downloads:open' },
            { text: '🎵 Como pedir música', callback_data: 'hanork:play_hint' },
        ],
        [{ text: '🎫 Ticket humano (equipe)', callback_data: 'hanork:ticket' }],
        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ]);
}

function registerAiCommands(bot, deps) {
    const {
        Msg,
        isAdmin,
        loadProducts,
        logger,
        hanorkAssistMode,
        botSession,
        sessionNote,
        activeChats,
        startSupportFlow,
        sendProductWithPhoto,
        openUserCatalog,
        showCart,
        commandLimiter,
    } = deps;

    const routerDeps = {
        Msg,
        logger,
        bot,
        loadProducts,
        sendProductWithPhoto,
        openUserCatalog,
        showCart,
        startSupportFlow,
        commandLimiter,
        isAdmin,
        groupGuard,
        supportMode: deps.supportMode,
        activeChats,
        hanorkAssistMode,
        hanorkRouterContext: deps.hanorkRouterContext,
        editProductMode: deps.editProductMode,
        productWizard: deps.productWizard,
        broadcastMode: deps.broadcastMode,
        getCart: deps.getCart,
        native: deps.native || {},
        resolveSupportGroupId: () => downloadsGuard.resolveDownloadsGroupId(),
        stateManager: deps.stateManager,
    };

    async function openHanorkAssistant(ctx) {
        if (ctx.callbackQuery) {
            await safeAnswerCbQuery(ctx);
        }

        const resolveGroup = () => downloadsGuard.resolveDownloadsGroupId();
        if (!HanorkRouterGuard.isHanorkAllowedChat(ctx, resolveGroup)) {
            return Msg.reply(ctx, COPY.privateOnly, null, { parse_mode: 'HTML' });
        }

        const existingChat = await activeChats?.get?.(ctx.chat.id);
        if (existingChat?.role === 'user') {
            const text = COPY.ticketOpen(existingChat.ticketId);
            const kb = Markup.inlineKeyboard([
                [{ text: '🔒 Encerrar ticket', callback_data: `tclose_${existingChat.ticketId}` }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ]);
            if (ctx.callbackQuery?.message) {
                return Msg.editCallbackPanel(ctx, text, kb);
            }
            return Msg.reply(ctx, text, kb, { parse_mode: 'HTML' });
        }

        const cleared = botSession ? await botSession.enterUserFlow(ctx, 'hanork') : {};
        await hanorkAssistMode?.delete?.(ctx.chat.id);

        let body = sessionNote ? sessionNote(COPY.introPanel, cleared) : COPY.introPanel;
        if (groupGuard.isGroupChat(ctx)) {
            body = sessionNote
                ? sessionNote(COPY.introPanelGroup, cleared)
                : COPY.introPanelGroup;
        }
        if (isAdmin(ctx.from?.id) && groupGuard.isPrivateChat(ctx)) {
            body += `\n\n${COPY.adminBroadcastHint}`;
        }
        const kb = hanorkAssistKeyboard();

        if (ctx.callbackQuery?.message) {
            return Msg.editCallbackPanel(ctx, body, kb);
        }
        return Msg.reply(ctx, body, kb, { parse_mode: 'HTML', useMenuPhoto: true });
    }

    async function tryInvokeMessage(ctx, rawText, options = {}) {
        const result = await HanorkInvoke.tryHandle(ctx, rawText, routerDeps, {
            escapeSupportMode: !!options.escapeSupportMode,
            fromCommand: !!options.fromCommand,
            commandArgs: options.commandArgs,
        });
        if (result.openMenu) {
            await openHanorkAssistant(ctx);
            return true;
        }
        if (!result.handled && String(options.commandArgs || rawText || '').trim()) {
            const addressed =
                typeof HanorkIntentEngine.isAddressedToHanork === 'function'
                    ? HanorkIntentEngine.isAddressedToHanork(rawText, {
                        fromCommand: !!options.fromCommand,
                        inPrivate: groupGuard.isPrivateChat(ctx),
                        inGroup: groupGuard.isGroupChat(ctx),
                    })
                    : false;
            if (addressed) {
                await HanorkInvoke.replyConversationalAi(ctx, rawText, routerDeps, {
                    fromCommand: !!options.fromCommand,
                });
                return true;
            }
        }
        return !!result.handled;
    }

    async function runHanorkCommand(ctx, question) {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const q = String(question || '').trim();
        if (!q) {
            return openHanorkAssistant(ctx);
        }
        return tryInvokeMessage(ctx, q, { fromCommand: true, commandArgs: q });
    }

    bot.command('hanork', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const args = (ctx.message?.text || '').replace(/^\/hanork(?:@\w+)?\s*/i, '').trim();
        await runHanorkCommand(ctx, args);
    });

    bot.command(['gpt', 'chatgpt', 'ia'], async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const args = (ctx.message?.text || '').replace(/^\/\w+(?:@\w+)?\s*/i, '').trim();
        await Msg.reply(ctx, COPY.legacyIaRedirect, hanorkAssistKeyboard(), { parse_mode: 'HTML' });
        if (args) await runHanorkCommand(ctx, args);
    });

    bot.action('hanork:open', async (ctx) => openHanorkAssistant(ctx));

    bot.action('hanork:human', async (ctx) => openHanorkAssistant(ctx));

    bot.action('hanork:play_hint', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        const hint =
            '<b>Música</b> — <code>/play</code> + nome ou link (só áudio)\n\n' +
            '<b>YouTube vídeo</b> — <code>/youtube</code> + link (watch, Shorts, live)\n\n' +
            'Exemplos:\n' +
            '• <i>quero ouvir paprika</i>\n' +
            '• <i>baixa esse vídeo do youtube</i> + link\n' +
            '• Cole link YouTube no grupo (vídeo) ou use /play para música';
        if (ctx.callbackQuery?.message) {
            return Msg.editCallbackPanel(ctx, hint, hanorkAssistKeyboard());
        }
        return Msg.reply(ctx, hint, hanorkAssistKeyboard(), { parse_mode: 'HTML' });
    });

    bot.action('hanork:ticket', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        await hanorkAssistMode?.delete?.(ctx.chat.id);
        if (typeof startSupportFlow === 'function') {
            return startSupportFlow(ctx);
        }
        return Msg.reply(ctx, COPY.supportFallback, hanorkAssistKeyboard(), { parse_mode: 'HTML' });
    });

    return {
        openHanorkAssistant,
        tryInvokeMessage,
        runHanorkCommand,
        hanorkAssistKeyboard,
    };
}

module.exports = { registerAiCommands };
