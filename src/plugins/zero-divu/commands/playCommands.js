'use strict';

const PlayMusicService = require('../../services/PlayMusicService');
const playUi = require('../play/playUi');
const downloadsGuard = require('../downloadsGuard');
const downloadsNav = require('../downloads/downloadsNav');
const { MENU_PANEL_OPTS } = downloadsNav;
const NL = require('../../services/hanork-ai/HanorkNlExtractors');

function registerPlayCommands(bot, deps) {
    const { Msg, CONFIG, logger, deferBackground, stateManager } = deps;

    const getApiKey = () => CONFIG.API_KEY_ZEROTWO || process.env.API_KEY_ZEROTWO || '';
    const getApiBase = () => CONFIG.ZEROTWO_API || process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

    const playLog = (level, message, extra = {}) => {
        if (!logger) return;
        const payload = { category: 'TELEGRAM', module: 'PLAY', ...extra };
        const text = `[PLAY] ${message}`;
        if (level === 'warn' && typeof logger.warn === 'function') {
            logger.warn(text, payload);
        } else if (level === 'error' && typeof logger.error === 'function') {
            logger.error(text, payload);
        } else if (typeof logger.info === 'function') {
            logger.info(text, payload);
        }
    };

    const doneKeyboard = () => downloadsNav.doneKeyboard(downloadsNav.SECTION.PLAY);

    const appendNav = (keyboard, ...extraRows) =>
        downloadsNav.appendNav(keyboard, downloadsNav.SECTION.PLAY, ...extraRows);

    const searchKeyboard = (sessionId, results) =>
        appendNav(PlayMusicService.buildSearchKeyboard(sessionId, results));

    const playPanelOpts = (photoUrl) => {
        if (photoUrl) return { photoUrl, useMenuPhoto: false };
        return { useMenuPhoto: true };
    };

    async function renderPlay(ctx, text, markup = null, { photoUrl } = {}) {
        const opts = playPanelOpts(photoUrl);
        if (ctx.callbackQuery) {
            return Msg.editCallbackPanel(ctx, text, markup, opts);
        }
        return Msg.edit(ctx, text, markup, opts);
    }

    const searchSafe = (query) =>
        PlayMusicService.searchVideos(getApiBase(), getApiKey(), query);

    function audioMeta(track) {
        const title = playUi.truncate(track.title || track.track || 'Música', 64);
        const performer = playUi.truncate(track.artist || '', 64);
        return { title, performer };
    }

    async function sendDirectAudio(ctx, track, url, route) {
        const { title, performer } = audioMeta(track);
        playLog('info', 'envio direto', { route, title: track.title });
        await ctx.telegram.sendAudio(
            ctx.chat.id,
            { url },
            {
                title,
                performer,
                duration: track.duration || undefined,
            }
        );
    }

    async function sendBufferAudio(ctx, track, buffer, route, fileName) {
        const { title, performer } = audioMeta(track);
        playLog('info', 'envio buffer', { route, title: track.title });
        await ctx.telegram.sendAudio(
            ctx.chat.id,
            { source: buffer, filename: fileName || PlayMusicService.safeFileName(title) },
            {
                title,
                performer,
                duration: track.duration || undefined,
            }
        );
    }

    async function runDownloadJob(ctx, track) {
        const uid = ctx.from?.id;
        const t0 = Date.now();
        const statusPhoto = track.thumbnail || null;

        playLog('info', 'download iniciado', { uid, title: track.title });

        const onStatus = async (info) => {
            playLog('info', 'rota', { uid, label: info.label, phase: info.phase, step: info.step });
        };

        const result = await PlayMusicService.deliverAudioTrack(track, getApiBase(), getApiKey(), {
            onStatus,
            sendDirect: (url, label) => sendDirectAudio(ctx, track, url, label),
            sendBuffer: (buffer, label, fileName) => sendBufferAudio(ctx, track, buffer, label, fileName),
        });

        await renderPlay(
            ctx,
            playUi.formatSuccessPanel(track),
            doneKeyboard(),
            MENU_PANEL_OPTS
        );
        playLog('info', 'download OK', {
            uid,
            title: track.title,
            route: result.route,
            mode: result.mode,
            ms: Date.now() - t0,
        });
    }

    async function startDownload(ctx, track) {
        await runDownloadJob(ctx, track);
    }

    function markFreshForLink(ctx) {
        ctx.state = ctx.state || {};
        ctx.state.freshUi = true;
    }

    async function showSearchResults(ctx, query, results) {
        const sessionId = PlayMusicService.storeSearchSession(ctx.from.id, query, results);
        const caption = PlayMusicService.buildSearchCaption(query, results);
        const keyboard = searchKeyboard(sessionId, results);
        const thumb = results.find((r) => r.thumbnail)?.thumbnail || null;

        await renderPlay(ctx, caption, keyboard, { photoUrl: thumb });
        playLog('info', 'busca listada', { uid: ctx.from?.id, query, count: results.length });
    }

    async function executePlayQuery(ctx, parsed, opts = {}) {
        const uid = ctx.from?.id;
        const sendIntent = !!opts.sendIntent;

        try {
            if (parsed.type === 'url') {
                const track = PlayMusicService.trackFromYoutubeUrl(parsed.value);
                return startDownload(ctx, track);
            }

            playLog('info', 'buscando', { uid, query: parsed.value, sendIntent });
            const results = await searchSafe(parsed.value);

            const autoPick =
                results.length === 1 ||
                PlayMusicService.shouldAutoPickSearch(parsed.value, results, { sendIntent });

            if (autoPick && results.length > 0) {
                const idx = PlayMusicService.pickBestSearchIndex(parsed.value, results);
                const hit = results[idx];
                playLog('info', 'auto-pick', {
                    uid,
                    query: parsed.value,
                    index: idx,
                    title: hit?.title,
                    sendIntent,
                });
                return startDownload(ctx, PlayMusicService.trackFromSearchHit(hit));
            }

            return showSearchResults(ctx, parsed.value, results);
        } catch (e) {
            playLog('warn', 'falha na busca', { uid, err: e.message, input: parsed.value, type: parsed.type });
            return renderPlay(ctx, playUi.formatNotFound(e.message), doneKeyboard());
        }
    }

    function deferPlayJob(label, ctx, fn) {
        const onFail = async (e) => {
            playLog('error', `${label} falhou`, { err: e.message, uid: ctx.from?.id });
            await renderPlay(ctx, playUi.formatPlayError(e.message), doneKeyboard());
        };

        if (typeof deferBackground !== 'function') {
            return fn().catch(onFail);
        }
        deferBackground(label, () => fn().catch(async (e) => {
            try {
                await onFail(e);
            } catch { /* ignore */ }
        }));
    }

    async function handlePlayQuery(ctx, rawInput, options = {}) {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const replied = ctx.message?.reply_to_message?.text?.trim();
        const input = String(rawInput || replied || '').trim();
        const parsed = PlayMusicService.parsePlayQuery(input ? `/play ${input}` : '');
        const fullText = String(options.sourceText || input).trim();
        const sendIntent = !!options.sendIntent || NL.isSendMusicIntent(fullText);

        if (!parsed) {
            return Msg.reply(
                ctx,
                playUi.formatHelpPanel(),
                doneKeyboard(),
                MENU_PANEL_OPTS
            );
        }

        playLog('info', 'comando', {
            uid: ctx.from?.id,
            type: parsed.type,
            input: String(parsed.value).slice(0, 120),
            sendIntent,
        });

        deferPlayJob(`play-query-${ctx.from?.id}`, ctx, () =>
            executePlayQuery(ctx, parsed, { sendIntent })
        );
    }

    bot.command('play', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const args = (ctx.message?.text || '').replace(/^\/play(?:@\w+)?\s*/i, '').trim();
        await handlePlayQuery(ctx, args);
    });

    bot.hears(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/|youtu\.be\/)/i, async (ctx, next) => {
        const { blockDownloadForSmmWizard } = require('../../modules/smm/smmWizardGuard');
        if (await blockDownloadForSmmWizard(ctx, stateManager)) return;
        if (!downloadsGuard.canUseDownloads(ctx)) return next();
        const text = (ctx.message?.text || '').trim();
        if (text.startsWith('/')) return next();
        if (!/\b(toca|tocar|ouvir|play|m[uú]sica|musica|mp3)\b/i.test(text)) return next();
        const url = PlayMusicService.extractYoutubeUrl(text);
        if (!url) return next();
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        markFreshForLink(ctx);
        playLog('info', 'link youtube colado', { uid: ctx.from?.id, url: url.slice(0, 80) });
        const parsed = { type: 'url', value: url };
        deferPlayJob(`play-url-${ctx.from?.id}`, ctx, () => executePlayQuery(ctx, parsed));
    });

    bot.action(/^play:scancel:(\w+)$/, async (ctx) => {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        await ctx.answerCbQuery('Cancelado').catch(() => {});
        const sessionId = ctx.match[1];
        if (!PlayMusicService.discardSearchSession(sessionId, ctx.from.id)) {
            return renderPlay(ctx, playUi.formatSessionExpired(), doneKeyboard());
        }
        playLog('info', 'busca cancelada', { uid: ctx.from?.id, sessionId });
        return renderPlay(ctx, playUi.formatSearchCancelled(), doneKeyboard());
    });

    bot.action(/^play:pick:(\w+):(\d+)$/, async (ctx) => {
        if (!(await downloadsGuard.enforceDownloadsAccess(ctx))) return;
        const sessionId = ctx.match[1];
        const index = ctx.match[2];
        const hit = PlayMusicService.takeSearchResult(sessionId, index, ctx.from.id);

        if (!hit) {
            await ctx.answerCbQuery('Busca expirada — use /play de novo', { show_alert: true }).catch(() => {});
            return renderPlay(ctx, playUi.formatSessionExpired(), doneKeyboard());
        }
        if (hit.forbidden) {
            await ctx.answerCbQuery('Esta busca não é sua', { show_alert: true }).catch(() => {});
            return;
        }

        await ctx.answerCbQuery('Enviando…').catch(() => {});
        playLog('info', 'música selecionada', { uid: ctx.from?.id, title: hit.title, url: hit.url?.slice(0, 80) });

        const track = PlayMusicService.trackFromSearchHit(hit);
        deferPlayJob(`play-pick-${sessionId}-${index}`, ctx, () => startDownload(ctx, track));
    });

    return { handlePlayQuery };
}

module.exports = { registerPlayCommands };
