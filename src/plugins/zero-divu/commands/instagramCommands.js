'use strict';

const { Markup } = require('telegraf');
const InstagramService = require('../../services/InstagramService');
const NL = require('../../services/hanork-ai/HanorkNlExtractors');
const instagramUi = require('../instagram/instagramUi');
const downloadsGuard = require('../downloadsGuard');
const downloadsNav = require('../downloads/downloadsNav');
const { MENU_PANEL_OPTS } = downloadsNav;

function registerInstagramCommands(bot, deps) {
    const { Msg, CONFIG, logger, deferBackground, stateManager } = deps;

    const getApiKey = () => CONFIG.API_KEY_ZEROTWO || process.env.API_KEY_ZEROTWO || '';
    const getApiBase = () => CONFIG.ZEROTWO_API || process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

    const igLog = (level, message, extra = {}) => {
        if (!logger) return;
        const payload = { category: 'TELEGRAM', module: 'INSTAGRAM', ...extra };
        const text = `[INSTAGRAM] ${message}`;
        if (level === 'warn' && typeof logger.warn === 'function') logger.warn(text, payload);
        else if (level === 'error' && typeof logger.error === 'function') logger.error(text, payload);
        else if (typeof logger.info === 'function') logger.info(text, payload);
    };

    const doneKeyboard = (section) =>
        downloadsNav.doneKeyboard(section || downloadsNav.SECTION.INSTAGRAM);

    const panelOpts = (photoUrl) => {
        if (photoUrl) return { photoUrl, useMenuPhoto: false };
        return { useMenuPhoto: true };
    };

    async function renderIg(ctx, text, markup = null, { photoUrl } = {}) {
        const opts = panelOpts(photoUrl);
        if (ctx.callbackQuery) return Msg.editCallbackPanel(ctx, text, markup, opts);
        return Msg.edit(ctx, text, markup, opts);
    }

    function markFreshForLink(ctx) {
        ctx.state = ctx.state || {};
        ctx.state.freshUi = true;
    }

    async function sendDirect(ctx, item, url, type, label) {
        if (type === 'video') {
            await ctx.telegram.sendVideo(ctx.chat.id, { url }, { supports_streaming: true });
        } else {
            await ctx.telegram.sendPhoto(ctx.chat.id, { url });
        }
        igLog('info', 'envio direto', { route: label, type });
    }

    async function sendBuffer(ctx, item, buffer, type, label, fileName) {
        if (type === 'video') {
            await ctx.telegram.sendVideo(
                ctx.chat.id,
                { source: buffer, filename: fileName },
                { supports_streaming: true }
            );
        } else {
            await ctx.telegram.sendPhoto(
                ctx.chat.id,
                { source: buffer, filename: fileName }
            );
        }
        igLog('info', 'envio buffer', { route: label, type });
    }

    async function sendVideoBuffer(ctx, item, buffer, label, fileName) {
        await ctx.telegram.sendVideo(
            ctx.chat.id,
            { source: buffer, filename: fileName || InstagramService.safeFileName(item.title, 'video') },
            { supports_streaming: true }
        );
        igLog('info', 'envio vídeo composto', { route: label, title: item.title });
    }

    async function sendStoryAlbum(ctx, chunk) {
        const album = chunk.map((s) => {
            if (s.type === 'video') {
                return { type: 'video', media: { url: s.url } };
            }
            return { type: 'photo', media: { url: s.url } };
        });
        await ctx.telegram.sendMediaGroup(ctx.chat.id, album);
    }

    async function runDownloadJob(ctx, item) {
        const uid = ctx.from?.id;
        const t0 = Date.now();
        const statusPhoto = item.thumbnail || null;

        igLog('info', 'download iniciado', { uid, mode: item.mode, title: item.title });

        await InstagramService.deliverInstagramItem(item, getApiBase(), getApiKey(), {
            onStatus: (info) => {
                igLog('info', 'rota', { uid, label: info.label, step: info.step, phase: info.phase });
            },
            sendDirect: (url, type, label) => sendDirect(ctx, item, url, type, label),
            sendBuffer: (buffer, type, label, fileName) =>
                sendBuffer(ctx, item, buffer, type, label, fileName),
            sendVideoBuffer: (buffer, label, fileName) =>
                sendVideoBuffer(ctx, item, buffer, label, fileName),
            sendAlbum: (chunk) => sendStoryAlbum(ctx, chunk),
        });

        await renderIg(
            ctx,
            instagramUi.formatSuccessPanel(item),
            doneKeyboard(downloadsNav.instagramSectionFor(item)),
            MENU_PANEL_OPTS
        );
        igLog('info', 'download OK', { uid, mode: item.mode, ms: Date.now() - t0 });
    }

    async function startDownload(ctx, item) {
        await runDownloadJob(ctx, item);
    }

    async function resolveItem(parsed) {
        if (parsed.type === 'url') {
            return InstagramService.fetchPostFromUrl(getApiBase(), getApiKey(), parsed.value);
        }
        if (parsed.type === 'stories') {
            return InstagramService.fetchStories(getApiBase(), getApiKey(), parsed.value);
        }
        if (parsed.type === 'highlights') {
            return InstagramService.fetchHighlights(getApiBase(), getApiKey(), parsed.value);
        }
        throw new Error('Pedido inválido');
    }

    async function executeInstagram(ctx, parsed) {
        const item = await resolveItem(parsed);
        return startDownload(ctx, item);
    }

    function deferIgJob(label, ctx, fn) {
        const onFail = async (e) => {
            igLog('error', `${label} falhou`, { err: e.message, uid: ctx.from?.id });
            await renderIg(ctx, instagramUi.formatInstagramError(e.message), doneKeyboard());
        };

        if (typeof deferBackground !== 'function') {
            return fn().catch(onFail);
        }
        deferBackground(label, () =>
            fn().catch(async (e) => {
                try {
                    await onFail(e);
                } catch {
                    /* ignore */
                }
            })
        );
    }

    function resolveInstagramParsed(input, options = {}) {
        if (options.instagramParsed) return options.instagramParsed;
        const raw = String(input || '').trim();
        if (!raw) return null;
        const url = InstagramService.extractInstagramUrl(raw);
        if (url) return { type: 'url', value: url };
        if (options.fromCommand) {
            return InstagramService.parseInstagramQuery(`/instagram ${raw}`);
        }
        return NL.extractInstagramNLQuery(raw, { allowBareReply: !!options.allowBareReply });
    }

    async function handleInstagramQuery(ctx, rawInput, options = {}) {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const replied = ctx.message?.reply_to_message?.text?.trim();
        const input = String(rawInput || replied || '').trim();
        const parsed = resolveInstagramParsed(input, {
            fromCommand: !!options.fromCommand,
            allowBareReply: !!options.allowBareReply,
            instagramParsed: options.instagramParsed,
        });
        const fullText = String(options.sourceText || input).trim();
        const sendIntent = !!options.sendIntent || NL.isSendInstagramIntent(fullText);

        if (!parsed) {
            return Msg.reply(
                ctx,
                instagramUi.formatHelpPanel(),
                doneKeyboard(),
                MENU_PANEL_OPTS
            );
        }

        igLog('info', 'comando', {
            uid: ctx.from?.id,
            type: parsed.type,
            input: String(parsed.value).slice(0, 120),
            sendIntent,
        });

        deferIgJob(`instagram-${ctx.from?.id}`, ctx, () => executeInstagram(ctx, parsed));
    }

    bot.command('instagram', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const args = (ctx.message?.text || '').replace(/^\/instagram(?:@\w+)?\s*/i, '').trim();
        await handleInstagramQuery(ctx, args, { fromCommand: true });
    });

    bot.command('ig', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const args = (ctx.message?.text || '').replace(/^\/ig(?:@\w+)?\s*/i, '').trim();
        await handleInstagramQuery(ctx, args, { fromCommand: true });
    });

    bot.hears(/(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\//i, async (ctx, next) => {
        const { blockDownloadForSmmWizard } = require('../../modules/smm/smmWizardGuard');
        if (await blockDownloadForSmmWizard(ctx, stateManager)) return;
        if (!downloadsGuard.canUseDownloads(ctx)) return next();
        const text = (ctx.message?.text || '').trim();
        if (text.startsWith('/')) return next();
        const url = InstagramService.extractInstagramUrl(text);
        if (!url) return next();
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        markFreshForLink(ctx);
        igLog('info', 'link instagram colado', { uid: ctx.from?.id, url: url.slice(0, 80) });
        const parsed = { type: 'url', value: url };
        deferIgJob(`instagram-url-${ctx.from?.id}`, ctx, () => executeInstagram(ctx, parsed));
    });

    return { handleInstagramQuery };
}

module.exports = { registerInstagramCommands };
