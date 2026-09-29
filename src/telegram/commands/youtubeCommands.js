'use strict';

const YouTubeService = require('../../services/YouTubeService');
const NL = require('../../services/hanork-ai/HanorkNlExtractors');
const youtubeUi = require('../youtube/youtubeUi');
const downloadsGuard = require('../downloadsGuard');
const downloadsNav = require('../downloads/downloadsNav');
const { MENU_PANEL_OPTS } = downloadsNav;

function registerYoutubeCommands(bot, deps) {
    const { Msg, CONFIG, logger, deferBackground, stateManager } = deps;

    const getApiKey = () => CONFIG.API_KEY_ZEROTWO || process.env.API_KEY_ZEROTWO || '';
    const getApiBase = () => CONFIG.ZEROTWO_API || process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

    const ytLog = (level, message, extra = {}) => {
        if (!logger) return;
        const payload = { category: 'TELEGRAM', module: 'YOUTUBE', ...extra };
        const text = `[YOUTUBE] ${message}`;
        if (level === 'warn' && typeof logger.warn === 'function') logger.warn(text, payload);
        else if (level === 'error' && typeof logger.error === 'function') logger.error(text, payload);
        else if (typeof logger.info === 'function') logger.info(text, payload);
    };

    const activeJobs = new Map();

    function jobKey(uid, url) {
        if (!uid || !url) return null;
        return `${uid}:${url}`;
    }

    function runExclusiveJob(ctx, url, fn) {
        const uid = ctx.from?.id;
        const key = jobKey(uid, url);
        if (key && activeJobs.has(key)) {
            ytLog('info', 'job ignorado (já em andamento)', { uid });
            return activeJobs.get(key);
        }
        const task = (async () => {
            try {
                await fn();
            } catch (e) {
                ytLog('error', 'job falhou', { uid, err: e.message });
                try {
                    await renderYoutube(ctx, youtubeUi.formatYoutubeError(e.message), doneKeyboard());
                } catch {
                    /* ignore */
                }
            } finally {
                if (key && activeJobs.get(key) === task) activeJobs.delete(key);
            }
        })();
        if (key) activeJobs.set(key, task);
        if (typeof deferBackground === 'function') {
            deferBackground(`youtube-${key || uid}`, () => task);
            return task;
        }
        return task;
    }

    const doneKeyboard = () => downloadsNav.doneKeyboard(downloadsNav.SECTION.YOUTUBE);

    const panelOpts = (photoUrl) => {
        if (photoUrl) return { photoUrl, useMenuPhoto: false };
        return { useMenuPhoto: true };
    };

    async function renderYoutube(ctx, text, markup = null, { photoUrl } = {}) {
        const opts = panelOpts(photoUrl);
        if (ctx.callbackQuery) return Msg.editCallbackPanel(ctx, text, markup, opts);
        return Msg.edit(ctx, text, markup, opts);
    }

    async function sendDirectVideo(ctx, item, url, route) {
        ytLog('info', 'envio direto vídeo', { route, title: item.title });
        await ctx.telegram.sendVideo(ctx.chat.id, { url }, { supports_streaming: true });
    }

    async function sendDirectAudio(ctx, item, url, route) {
        ytLog('info', 'envio direto áudio', { route, title: item.title });
        await ctx.telegram.sendAudio(ctx.chat.id, { url }, { title: youtubeUi.truncate(item.title, 64) });
    }

    async function sendBufferVideo(ctx, item, buffer, route, fileName) {
        ytLog('info', 'envio buffer vídeo', { route, title: item.title });
        await ctx.telegram.sendVideo(
            ctx.chat.id,
            { source: buffer, filename: fileName || YouTubeService.safeFileName(item.title, 'mp4') },
            { supports_streaming: true }
        );
    }

    async function sendBufferAudio(ctx, item, buffer, route, fileName) {
        ytLog('info', 'envio buffer áudio', { route, title: item.title });
        await ctx.telegram.sendAudio(
            ctx.chat.id,
            { source: buffer, filename: fileName || YouTubeService.safeFileName(item.title, 'mp3') }
        );
    }

    async function runDownloadJob(ctx, item) {
        const uid = ctx.from?.id;
        const t0 = Date.now();
        const photoUrl = item.thumbnail || null;

        ytLog('info', 'download iniciado', { uid, title: item.title, kind: item.kind });

        const onStatus = async (info) => {
            ytLog('info', 'rota', {
                uid,
                label: info.label,
                phase: info.phase,
                step: info.step,
                kind: info.kind,
            });
        };

        const result = await YouTubeService.deliverYoutubeItem(item, getApiBase(), getApiKey(), {
            onStatus,
            sendVideo: (url, label) => sendDirectVideo(ctx, item, url, label),
            sendAudio: (url, label) => sendDirectAudio(ctx, item, url, label),
            sendVideoBuffer: (buffer, label, fileName) =>
                sendBufferVideo(ctx, item, buffer, label, fileName),
            sendAudioBuffer: (buffer, label, fileName) =>
                sendBufferAudio(ctx, item, buffer, label, fileName),
        });

        await renderYoutube(ctx, youtubeUi.formatSuccessPanel(item, result), doneKeyboard(), MENU_PANEL_OPTS);

        ytLog('info', 'download OK', {
            uid,
            title: item.title,
            route: result.route,
            mode: result.mode,
            kind: result.kind,
            ms: Date.now() - t0,
        });
    }

    async function executeYoutubeQuery(ctx, parsed) {
        const uid = ctx.from?.id;
        ytLog('info', 'resolvendo link', { uid, url: parsed.value.slice(0, 100), kind: parsed.kind });

        const item = await YouTubeService.fetchItemFromUrl(getApiBase(), getApiKey(), parsed.value, {
            onStatus: (info) => ytLog('info', 'meta', { uid, label: info.label }),
        });
        item.kind = parsed.kind || item.kind;

        await renderYoutube(ctx, youtubeUi.formatProcessingPanel(item), null, {
            photoUrl: item.thumbnail,
        });
        return runDownloadJob(ctx, item);
    }

    async function handleYoutubeQuery(ctx, rawInput, options = {}) {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const replied = ctx.message?.reply_to_message?.text?.trim();
        const input = String(rawInput || replied || '').trim();
        const parsed = YouTubeService.parseYoutubeQuery(input ? `/youtube ${input}` : '');
        const fullText = String(options.sourceText || input).trim();
        const sendIntent = !!options.sendIntent || NL.isSendVideoIntent(fullText);

        if (!parsed) {
            return Msg.reply(ctx, youtubeUi.formatHelpPanel(), doneKeyboard(), MENU_PANEL_OPTS);
        }

        ytLog('info', 'comando', {
            uid: ctx.from?.id,
            kind: parsed.kind,
            url: String(parsed.value).slice(0, 120),
            sendIntent,
        });

        runExclusiveJob(ctx, parsed.value, () => executeYoutubeQuery(ctx, parsed));
    }

    function markFreshForLink(ctx) {
        ctx.state = ctx.state || {};
        ctx.state.freshUi = true;
    }

    bot.command(['youtube', 'yt'], async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const args = (ctx.message?.text || '').replace(/^\/(?:youtube|yt)(?:@\w+)?\s*/i, '').trim();
        await handleYoutubeQuery(ctx, args);
    });

    bot.hears(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/|youtu\.be\/)/i, async (ctx, next) => {
        const { blockDownloadForSmmWizard } = require('../../modules/smm/smmWizardGuard');
        if (await blockDownloadForSmmWizard(ctx, stateManager)) return;
        if (!downloadsGuard.canUseDownloads(ctx)) return next();
        const text = (ctx.message?.text || '').trim();
        if (text.startsWith('/')) return next();
        if (/\b(toca|tocar|ouvir|play|m[uú]sica|musica|mp3)\b/i.test(text)) return next();
        const url = YouTubeService.extractYoutubeUrl(text);
        if (!url) return next();
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        markFreshForLink(ctx);
        ytLog('info', 'link youtube colado', { uid: ctx.from?.id, url: url.slice(0, 100) });
        const parsed = { type: 'url', value: url, kind: YouTubeService.detectYoutubeKind(url) };
        runExclusiveJob(ctx, url, () => executeYoutubeQuery(ctx, parsed));
    });

    return { handleYoutubeQuery };
}

module.exports = { registerYoutubeCommands };
