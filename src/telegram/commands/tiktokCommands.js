'use strict';

const TikTokService = require('../../services/TikTokService');
const NL = require('../../services/hanork-ai/HanorkNlExtractors');
const tiktokUi = require('../tiktok/tiktokUi');
const downloadsGuard = require('../downloadsGuard');
const downloadsNav = require('../downloads/downloadsNav');
const { MENU_PANEL_OPTS } = downloadsNav;

function registerTikTokCommands(bot, deps) {
    const { Msg, CONFIG, logger, deferBackground, stateManager } = deps;

    const getApiKey = () => CONFIG.API_KEY_ZEROTWO || process.env.API_KEY_ZEROTWO || '';
    const getApiBase = () => CONFIG.ZEROTWO_API || process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

    const tiktokLog = (level, message, extra = {}) => {
        if (!logger) return;
        const payload = { category: 'TELEGRAM', module: 'TIKTOK', ...extra };
        const text = `[TIKTOK] ${message}`;
        if (level === 'warn' && typeof logger.warn === 'function') {
            logger.warn(text, payload);
        } else if (level === 'error' && typeof logger.error === 'function') {
            logger.error(text, payload);
        } else if (typeof logger.info === 'function') {
            logger.info(text, payload);
        }
    };

    /** Evita dois downloads do mesmo link/busca ao mesmo tempo */
    const activeJobs = new Map();

    function jobKey(uid, parsed) {
        if (!uid || !parsed) return null;
        if (parsed.type === 'url') return `${uid}:url:${parsed.value}`;
        if (parsed.type === 'search') return `${uid}:search:${String(parsed.value).toLowerCase()}`;
        return `${uid}:other`;
    }

    function runExclusiveTikTokJob(ctx, parsed, fn) {
        const uid = ctx.from?.id;
        const key = jobKey(uid, parsed);
        if (key && activeJobs.has(key)) {
            tiktokLog('info', 'job ignorado (já em andamento)', { uid, key: key.slice(0, 80) });
            return activeJobs.get(key);
        }

        const task = (async () => {
            try {
                await fn();
            } catch (e) {
                tiktokLog('error', 'job falhou', { uid, err: e.message });
                const panel = parsed?.type === 'search' && !parsed?.value?.startsWith('http')
                    ? tiktokUi.formatNotFound(e.message)
                    : tiktokUi.formatTikTokError(e.message);
                try {
                    await renderTikTok(ctx, panel, doneKeyboard());
                } catch { /* ignore */ }
            } finally {
                if (key && activeJobs.get(key) === task) activeJobs.delete(key);
            }
        })();

        if (key) activeJobs.set(key, task);

        if (typeof deferBackground === 'function') {
            deferBackground(`tiktok-${key || uid}`, () => task);
            return task;
        }
        return task;
    }

    const doneKeyboard = () => downloadsNav.doneKeyboard(downloadsNav.SECTION.TIKTOK);

    const appendNav = (keyboard, ...extraRows) =>
        downloadsNav.appendNav(keyboard, downloadsNav.SECTION.TIKTOK, ...extraRows);

    const searchKeyboard = (sessionId, results) =>
        appendNav(TikTokService.buildSearchKeyboard(sessionId, results));

    const panelOpts = (photoUrl) => {
        if (photoUrl) return { photoUrl, useMenuPhoto: false };
        return { useMenuPhoto: true };
    };

    async function renderTikTok(ctx, text, markup = null, { photoUrl } = {}) {
        const opts = panelOpts(photoUrl);
        if (ctx.callbackQuery) {
            return Msg.editCallbackPanel(ctx, text, markup, opts);
        }
        return Msg.edit(ctx, text, markup, opts);
    }

    const searchSafe = (query) =>
        TikTokService.searchVideos(getApiBase(), getApiKey(), query);

    async function sendDirectVideo(ctx, item, url, route) {
        tiktokLog('info', 'envio direto', { route, title: item.title });
        await ctx.telegram.sendVideo(ctx.chat.id, { url }, { supports_streaming: true });
    }

    async function sendBufferVideo(ctx, item, buffer, route, fileName) {
        tiktokLog('info', 'envio buffer', { route, title: item.title });
        await ctx.telegram.sendVideo(
            ctx.chat.id,
            { source: buffer, filename: fileName || TikTokService.safeFileName(item.title) },
            {
                supports_streaming: true,
                caption: tiktokUi.formatVideoCaption(item),
                parse_mode: 'HTML',
            }
        );
    }

    async function sendDirectPhoto(ctx, item, url, route) {
        tiktokLog('info', 'envio foto direto', { route, title: item.title });
        await ctx.telegram.sendPhoto(ctx.chat.id, { url }, { caption: tiktokUi.formatVideoCaption(item) });
    }

    async function sendBufferPhoto(ctx, item, buffer, route, fileName) {
        tiktokLog('info', 'envio foto buffer', { route, title: item.title });
        await ctx.telegram.sendPhoto(
            ctx.chat.id,
            { source: buffer, filename: fileName || TikTokService.safeImageFileName(item.title) },
            { caption: tiktokUi.formatVideoCaption(item) }
        );
    }

    async function sendMediaGroupPhotos(ctx, item, urlsOrBuffers, route, { buffered = false } = {}) {
        tiktokLog('info', 'envio album', { route, count: urlsOrBuffers.length, buffered });
        const media = urlsOrBuffers.map((entry, i) => ({
            type: 'photo',
            media: buffered ? { source: entry } : entry,
            caption: i === 0 ? tiktokUi.formatVideoCaption(item) : undefined,
            parse_mode: i === 0 ? 'HTML' : undefined,
        }));
        await ctx.telegram.sendMediaGroup(ctx.chat.id, media);
    }

    async function runDownloadJob(ctx, item) {
        const uid = ctx.from?.id;
        const t0 = Date.now();
        const photoUrl = item.thumbnail || null;

        tiktokLog('info', 'download iniciado', {
            uid,
            title: item.title,
            mediaType: item.mediaType || (item.imageUrls?.length ? 'image' : 'video'),
        });

        const onStatus = async (info) => {
            tiktokLog('info', 'rota', { uid, label: info.label, phase: info.phase, step: info.step });
        };

        const result = await TikTokService.deliverMediaItem(item, getApiBase(), getApiKey(), {
            onStatus,
            sendDirect: (url, label) => sendDirectVideo(ctx, item, url, label),
            sendBuffer: (buffer, label, fileName) => sendBufferVideo(ctx, item, buffer, label, fileName),
            sendDirectPhoto: (url, label) => sendDirectPhoto(ctx, item, url, label),
            sendBufferPhoto: (buffer, label, fileName) => sendBufferPhoto(ctx, item, buffer, label, fileName),
            sendMediaGroup: (urlsOrBuffers, label, opts) =>
                sendMediaGroupPhotos(ctx, item, urlsOrBuffers, label, opts),
        });

        await renderTikTok(
            ctx,
            tiktokUi.formatSuccessPanel(item, result),
            doneKeyboard(),
            MENU_PANEL_OPTS
        );

        tiktokLog('info', 'download OK', {
            uid,
            title: item.title,
            route: result.route,
            mode: result.mode,
            ms: Date.now() - t0,
        });
    }

    async function startDownload(ctx, item) {
        await runDownloadJob(ctx, item);
    }

    function markFreshForLink(ctx) {
        ctx.state = ctx.state || {};
        ctx.state.freshUi = true;
    }

    async function deliverVideo(ctx, item) {
        return startDownload(ctx, item);
    }

    async function showSearchResults(ctx, query, results) {
        const sessionId = TikTokService.storeSearchSession(ctx.from.id, query, results);
        const caption = TikTokService.buildSearchCaption(query, results);
        const keyboard = searchKeyboard(sessionId, results);
        const thumb = results.find((r) => r.thumbnail)?.thumbnail || null;

        await renderTikTok(ctx, caption, keyboard, { photoUrl: thumb });
        tiktokLog('info', 'busca listada', { uid: ctx.from?.id, query, count: results.length });
    }

    async function executeTikTokQuery(ctx, parsed, opts = {}) {
        const uid = ctx.from?.id;
        const sendIntent = !!opts.sendIntent;

        try {
            if (parsed.type === 'url') {
                tiktokLog('info', 'resolvendo link', { uid, url: parsed.value.slice(0, 80), sendIntent });
                const item = await TikTokService.fetchVideoFromUrl(
                    getApiBase(),
                    getApiKey(),
                    parsed.value
                );
                return deliverVideo(ctx, item);
            }

            tiktokLog('info', 'buscando', { uid, query: parsed.value, sendIntent });
            const results = await searchSafe(parsed.value);

            if (
                NL.shouldAutoPickMedia(parsed.value, results, { sendIntent }, ['title', 'author'])
            ) {
                const idx = NL.pickBestMediaIndex(parsed.value, results, ['title', 'author']);
                tiktokLog('info', 'auto-pick', { uid, query: parsed.value, index: idx, sendIntent });
                return deliverVideo(ctx, TikTokService.itemFromSearchHit(results[idx]));
            }

            return showSearchResults(ctx, parsed.value, results);
        } catch (e) {
            tiktokLog('warn', 'falha', { uid, err: e.message, input: parsed.value, type: parsed.type });
            throw e;
        }
    }

    function startTikTokJob(ctx, parsed, fn) {
        runExclusiveTikTokJob(ctx, parsed, fn);
    }

    function resolveTikTokParsed(input, options = {}) {
        const raw = String(input || '').trim();
        if (!raw) return null;
        const url = TikTokService.extractTiktokUrl(raw);
        if (url) return { type: 'url', value: url };
        if (options.fromCommand) {
            return TikTokService.parseTikTokQuery(`/tiktok ${raw}`);
        }
        const ttQ = NL.extractTiktokSearchQuery(raw, { allowBareReply: !!options.allowBareReply });
        if (ttQ) return { type: 'search', value: ttQ };
        return null;
    }

    async function handleTikTokQuery(ctx, rawInput, options = {}) {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const replied = ctx.message?.reply_to_message?.text?.trim();
        const input = String(rawInput || replied || '').trim();
        const parsed = resolveTikTokParsed(input, {
            fromCommand: !!options.fromCommand,
            allowBareReply: !!options.allowBareReply,
        });
        const fullText = String(options.sourceText || input).trim();
        const sendIntent =
            !!options.sendIntent ||
            NL.isSendTiktokIntent(fullText) ||
            NL.isSendVideoIntent(fullText);

        if (!parsed) {
            return Msg.reply(
                ctx,
                tiktokUi.formatHelpPanel(),
                doneKeyboard(),
                MENU_PANEL_OPTS
            );
        }

        tiktokLog('info', 'comando', {
            uid: ctx.from?.id,
            type: parsed.type,
            input: String(parsed.value).slice(0, 120),
            sendIntent,
        });

        startTikTokJob(ctx, parsed, () => executeTikTokQuery(ctx, parsed, { sendIntent }));
    }

    bot.command('tiktok', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const args = (ctx.message?.text || '').replace(/^\/tiktok(?:@\w+)?\s*/i, '').trim();
        const parsed = resolveTikTokParsed(args, { fromCommand: true });
        if (!parsed) {
            return Msg.reply(
                ctx,
                tiktokUi.formatHelpPanel(),
                doneKeyboard(),
                MENU_PANEL_OPTS
            );
        }
        tiktokLog('info', 'comando', {
            uid: ctx.from?.id,
            type: parsed.type,
            input: String(parsed.value).slice(0, 120),
            sendIntent: NL.isSendTiktokIntent(args) || NL.isSendVideoIntent(args),
        });
        startTikTokJob(ctx, parsed, () =>
            executeTikTokQuery(ctx, parsed, {
                sendIntent: NL.isSendTiktokIntent(args) || NL.isSendVideoIntent(args),
            })
        );
    });

    bot.hears(/(?:https?:\/\/)?(?:(?:www|vm|vt)\.)?tiktok\.com|(?:https?:\/\/)?(?:vm|vt)\.tiktok\.com/i, async (ctx, next) => {
        const { blockDownloadForSmmWizard } = require('../../modules/smm/smmWizardGuard');
        if (await blockDownloadForSmmWizard(ctx, stateManager)) return;
        if (!downloadsGuard.canUseDownloads(ctx)) return next();
        const text = (ctx.message?.text || '').trim();
        if (text.startsWith('/')) return next();
        const url = TikTokService.extractTiktokUrl(text);
        if (!url) return next();
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        markFreshForLink(ctx);
        const parsed = { type: 'url', value: url };
        tiktokLog('info', 'link tiktok colado', { uid: ctx.from?.id, url: url.slice(0, 80) });
        startTikTokJob(ctx, parsed, () => executeTikTokQuery(ctx, parsed));
    });

    bot.action(/^tiktok:scancel:(\w+)$/, async (ctx) => {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        await ctx.answerCbQuery('Cancelado').catch(() => {});
        const sessionId = ctx.match[1];
        if (!TikTokService.discardSearchSession(sessionId, ctx.from.id)) {
            return renderTikTok(ctx, tiktokUi.formatSessionExpired(), doneKeyboard());
        }
        tiktokLog('info', 'busca cancelada', { uid: ctx.from?.id, sessionId });
        return renderTikTok(ctx, tiktokUi.formatSearchCancelled(), doneKeyboard());
    });

    bot.action(/^tiktok:pick:(\w+):(\d+)$/, async (ctx) => {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const sessionId = ctx.match[1];
        const index = ctx.match[2];
        const hit = TikTokService.takeSearchResult(sessionId, index, ctx.from.id);

        if (!hit) {
            await ctx.answerCbQuery('Busca expirada — use /tiktok de novo', { show_alert: true }).catch(() => {});
            return renderTikTok(ctx, tiktokUi.formatSessionExpired(), doneKeyboard());
        }
        if (hit.forbidden) {
            await ctx.answerCbQuery('Esta busca não é sua', { show_alert: true }).catch(() => {});
            return;
        }

        await ctx.answerCbQuery('Enviando…').catch(() => {});
        tiktokLog('info', 'vídeo selecionado', { uid: ctx.from?.id, title: hit.title });

        const item = TikTokService.itemFromSearchHit(hit);
        startTikTokJob(ctx, { type: 'search', value: hit.title || 'pick' }, () => deliverVideo(ctx, item));
    });

    return { handleTikTokQuery };
}

module.exports = { registerTikTokCommands };
