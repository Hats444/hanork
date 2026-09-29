'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { escapeTelegramHtml } = require('../telegram/htmlEscape');

const PENDING_TTL_MS = 15 * 60 * 1000;
const pending = new Map();
const searchSessions = new Map();

/** Rotas de download — ordem de tentativa */
const METADATA_ROUTES = [{ id: 'ytmusic', path: '/api/dl/ytmusic', mode: 'json' }];
const STREAM_ROUTES = [
    { id: 'ytaudio', path: '/api/dl/ytaudio', label: 'ytaudio' },
    { id: 'ytaudio2', path: '/api/dl/ytaudio2', label: 'ytaudio2' },
    { id: 'ytaudio3', path: '/api/dl/ytaudio3', label: 'ytaudio3' },
];

const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const API_TIMEOUT_MS = 22000;
const BUFFER_TIMEOUT_MS = 45000;

function cleanupPending() {
    const now = Date.now();
    for (const [id, row] of pending) {
        if (!row?.expiresAt || row.expiresAt <= now) pending.delete(id);
    }
    for (const [id, row] of searchSessions) {
        if (!row?.expiresAt || row.expiresAt <= now) searchSessions.delete(id);
    }
}

setInterval(cleanupPending, 5 * 60 * 1000).unref?.();

function extractYoutubeUrl(text) {
    const raw = String(text || '');
    const m = raw.match(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/)|youtu\.be\/)[^\s<>"']+/i
    );
    if (!m) return null;
    let url = m[0].replace(/[.,;)]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url;
}

function parsePlayQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const withoutCmd = raw.replace(/^\/play(?:@\w+)?\s*/i, '').trim();
    const body = withoutCmd || raw;
    const url = extractYoutubeUrl(body);
    if (url) return { type: 'url', value: url };
    let query = body.replace(/\s+/g, ' ').trim();
    query = query.replace(/^(?:em|no|na|da)\s+/i, '').trim();
    if (query.length >= 2) return { type: 'search', value: query };
    return null;
}

function apiRoot(base) {
    return String(base || 'https://zero-two-apis.com.br').replace(/\/+$/, '');
}

function buildRouteUrl(base, path, youtubeUrl, apiKey) {
    const params = new URLSearchParams({ url: youtubeUrl, apikey: apiKey });
    return `${apiRoot(base)}${path}?${params.toString()}`;
}

function buildSearchApiUrl(base, query, apiKey) {
    const params = new URLSearchParams({ q: query, apikey: apiKey });
    return `${apiRoot(base)}/api/ytsrc/videos?${params.toString()}`;
}

function formatContactLink(contactUrl) {
    const u = String(contactUrl || '').trim();
    if (!u) return '📞 Suporte Hanork';
    const m = u.match(/t\.me\/(?:\+|joinchat\/)?([^/?]+)/i);
    const label = m && !u.includes('joinchat') && !u.includes('/+') ? `@${m[1]}` : 'Fale comigo';
    return `📞 <a href="${escapeTelegramHtml(u)}">${escapeTelegramHtml(label)}</a>`;
}

function buildPreviewCaption(track, contactUrl) {
    const title = escapeTelegramHtml(track.title || track.track || 'Sem título');
    const artist = escapeTelegramHtml(track.artist || '—');
    const album = escapeTelegramHtml(track.album || '—');
    const genre = escapeTelegramHtml(track.genre || '—');
    const duration = escapeTelegramHtml(track.duration_string || '—');
    const routeHint = track.fetchRoute
        ? `\n🔌 <i>Fonte: ${escapeTelegramHtml(track.fetchRoute)}</i>\n`
        : '';

    return (
        `🎵 <b>Música encontrada</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `▶️ <b>${title}</b>\n` +
        `👤 ${artist}\n` +
        `💿 ${album}\n` +
        `🎼 ${genre}\n` +
        `⏱ ${duration}\n` +
        routeHint +
        `\n<i>Toque em <b>Baixar áudio</b> para receber a faixa aqui no chat.</i>\n\n` +
        formatContactLink(contactUrl)
    );
}

function normalizeTrackFromYtmusic(r, youtubeUrl, routeId = 'ytmusic') {
    return {
        type: r.type || 'music',
        title: r.title || r.track || 'Música',
        artist: r.artist || '',
        album: r.album || '',
        track: r.track || r.title || '',
        genre: r.genre || '',
        thumbnail: r.thumbnail || null,
        duration: Number(r.duration) || 0,
        duration_string: r.duration_string || '',
        youtubeUrl,
        audio_url: r.audio_url || null,
        fetchRoute: routeId,
    };
}

function buildTrackFromMeta(meta, youtubeUrl) {
    return {
        type: 'music',
        title: meta?.title || 'Música',
        artist: meta?.artist || meta?.author?.name || '',
        album: meta?.album || '',
        track: meta?.title || 'Música',
        genre: meta?.genre || '',
        thumbnail: meta?.thumbnail || meta?.image || null,
        duration: Number(meta?.seconds || meta?.duration?.seconds) || 0,
        duration_string: meta?.duration_string || meta?.timestamp || meta?.duration?.timestamp || '',
        youtubeUrl,
        audio_url: null,
        fetchRoute: meta ? 'ytsrc' : null,
    };
}

function trackFromSearchHit(hit) {
    if (!hit?.url) throw new Error('URL YouTube ausente');
    return buildTrackFromMeta(hit, hit.url);
}

function trackFromYoutubeUrl(youtubeUrl) {
    return buildTrackFromMeta(null, youtubeUrl);
}

async function fetchYtmusicRoute(apiBase, apiKey, youtubeUrl) {
    const url = buildRouteUrl(apiBase, '/api/dl/ytmusic', youtubeUrl, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });

    if (!data?.status || !data?.resultado) {
        throw new Error(
            data?.message || data?.erro || data?.error || 'ytmusic: resposta inválida'
        );
    }

    const track = normalizeTrackFromYtmusic(data.resultado, youtubeUrl, 'ytmusic');
    if (!track.audio_url) {
        throw new Error('ytmusic: sem link de áudio');
    }
    return track;
}

async function fetchMetadataFromUrl(apiBase, apiKey, youtubeUrl) {
    const url = buildSearchApiUrl(apiBase, youtubeUrl, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });
    if (!data?.status || !Array.isArray(data.resultado) || !data.resultado.length) {
        throw new Error('ytsrc: metadados não encontrados');
    }
    return normalizeSearchHit(data.resultado[0]);
}

async function fetchTrackWithFallback(apiBase, apiKey, youtubeUrl, opts = {}) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const { hintMeta, onStatus } = opts;
    const totalSteps = 1 + (hintMeta?.title ? 0 : 1);
    let step = 0;

    const status = async (label) => {
        step += 1;
        if (typeof onStatus === 'function') {
            await onStatus({ step, total: Math.max(totalSteps, step), label });
        }
    };

    await status('ytmusic');
    try {
        return await fetchYtmusicRoute(apiBase, apiKey, youtubeUrl);
    } catch (e) {
        /* tenta metadados alternativos */
    }

    let meta = hintMeta;
    if (!meta?.title) {
        await status('ytsrc (metadados)');
        try {
            meta = await fetchMetadataFromUrl(apiBase, apiKey, youtubeUrl);
        } catch {
            meta = null;
        }
    }

    return buildTrackFromMeta(meta, youtubeUrl);
}

async function fetchTrack(apiBase, apiKey, youtubeUrl) {
    return fetchTrackWithFallback(apiBase, apiKey, youtubeUrl);
}

function storePending(userId, track) {
    cleanupPending();
    const id = crypto.randomBytes(4).toString('hex');
    pending.set(id, {
        userId: String(userId),
        track,
        expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return id;
}

function peekPending(id, userId) {
    const row = pending.get(id);
    if (!row) return null;
    if (String(row.userId) !== String(userId)) return { forbidden: true };
    if (row.expiresAt <= Date.now()) {
        pending.delete(id);
        return null;
    }
    return row;
}

function takePending(id, userId) {
    const row = peekPending(id, userId);
    if (!row || row.forbidden) return row;
    pending.delete(id);
    return row;
}

function discardPending(id, userId) {
    const row = pending.get(id);
    if (!row || String(row.userId) !== String(userId)) return false;
    pending.delete(id);
    return true;
}

function normalizeSearchHit(item) {
    if (!item) return null;
    const url =
        item.url ||
        (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : null);
    if (!url) return null;
    return {
        url,
        videoId: item.videoId || null,
        title: item.title || 'Sem título',
        artist: item.author?.name || item.channel || '',
        thumbnail: item.thumbnail || item.image || null,
        duration_string: item.timestamp || item.duration?.timestamp || '',
        seconds: item.seconds || item.duration?.seconds,
        views: item.views ?? null,
    };
}

async function searchVideos(apiBase, apiKey, query) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const url = buildSearchApiUrl(apiBase, query, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });

    if (!data?.status || !Array.isArray(data.resultado) || !data.resultado.length) {
        throw new Error(
            data?.message || data?.erro || data?.error || 'Nenhuma música encontrada para esta busca.'
        );
    }

    return data.resultado.map(normalizeSearchHit).filter(Boolean).slice(0, 5);
}

const NL = require('./hanork-ai/HanorkNlExtractors');

function pickBestSearchIndex(query, results = []) {
    return NL.pickBestSearchIndex(query, results);
}

function shouldAutoPickSearch(query, results, opts = {}) {
    return NL.shouldAutoPickSearch(query, results, opts);
}

function storeSearchSession(userId, query, results) {
    cleanupPending();
    const id = crypto.randomBytes(4).toString('hex');
    searchSessions.set(id, {
        userId: String(userId),
        query,
        results,
        expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return id;
}

function takeSearchResult(sessionId, index, userId) {
    const row = searchSessions.get(sessionId);
    if (!row) return null;
    if (String(row.userId) !== String(userId)) return { forbidden: true };
    if (row.expiresAt <= Date.now()) {
        searchSessions.delete(sessionId);
        return null;
    }
    const hit = row.results[Number(index)];
    if (!hit) return null;
    searchSessions.delete(sessionId);
    return hit;
}

function discardSearchSession(sessionId, userId) {
    const row = searchSessions.get(sessionId);
    if (!row || String(row.userId) !== String(userId)) return false;
    searchSessions.delete(sessionId);
    return true;
}

function buildSearchCaption(query, results) {
    const playUi = require('../telegram/play/playUi');
    return playUi.formatSearchCaption(query, results);
}

function buildSearchKeyboard(sessionId, results) {
    const playUi = require('../telegram/play/playUi');
    return playUi.buildSearchKeyboard(sessionId, results);
}

function isErrorPayloadBuffer(buf) {
    if (!buf || buf.length < 2) return false;
    const head = buf.slice(0, Math.min(buf.length, 512)).toString('utf8').trim();
    if (head.startsWith('{') || head.startsWith('<!DOCTYPE') || head.startsWith('<html')) {
        try {
            const j = JSON.parse(head);
            if (j?.status === false || j?.message) return j.message || true;
        } catch {
            return true;
        }
        return true;
    }
    return false;
}

async function downloadBufferFromUrl(url, { expectStream = false, timeout = BUFFER_TIMEOUT_MS } = {}) {
    const { data, headers, status } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxContentLength: MAX_AUDIO_BYTES,
        maxBodyLength: MAX_AUDIO_BYTES,
        validateStatus: (s) => s < 500,
    });

    if (status >= 400) {
        throw new Error(`HTTP ${status}`);
    }

    const buf = Buffer.from(data);
    const ct = String(headers['content-type'] || '').toLowerCase();

    if (expectStream && (ct.includes('json') || ct.includes('html') || isErrorPayloadBuffer(buf))) {
        let msg = 'Rota indisponível';
        try {
            const j = JSON.parse(buf.toString('utf8'));
            msg = j.message || j.erro || j.error || msg;
        } catch {
            /* ignore */
        }
        throw new Error(msg);
    }

    if (!buf.length) throw new Error('Arquivo vazio');
    return buf;
}

function buildDownloadPlan(track, apiBase, apiKey) {
    const youtubeUrl = track.youtubeUrl || track.sourceUrl;
    if (!youtubeUrl) throw new Error('URL YouTube ausente no track');

    const steps = [];
    // Rotas ZeroTwo (stream MP3) — Telegram consegue baixar direto; googlevideo CDN é IP-bound
    for (const route of STREAM_ROUTES) {
        steps.push({
            kind: 'stream',
            label: route.label,
            url: buildRouteUrl(apiBase, route.path, youtubeUrl, apiKey),
        });
    }
    if (track.audio_url) {
        steps.push({ kind: 'cdn', label: 'CDN (ytmusic)', url: track.audio_url });
    }
    return steps;
}

function getStreamDownloadUrls(track, apiBase, apiKey) {
    const youtubeUrl = track.youtubeUrl || track.sourceUrl;
    if (!youtubeUrl) return [];
    return STREAM_ROUTES.map((route) => ({
        label: route.label,
        url: buildRouteUrl(apiBase, route.path, youtubeUrl, apiKey),
    }));
}

/**
 * Entrega áudio: URL direta pro Telegram primeiro (rápido), buffer só se falhar.
 * @param {object} handlers.sendDirect — async (url, label) => void
 * @param {object} handlers.sendBuffer — async (buffer, label, fileName) => void
 */
async function deliverAudioTrack(track, apiBase, apiKey, { onStatus, sendDirect, sendBuffer } = {}) {
    const steps = buildDownloadPlan(track, apiBase, apiKey);
    const errors = [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (typeof onStatus === 'function') {
            await onStatus({
                step: i + 1,
                total: steps.length,
                label: step.label,
                phase: 'direct',
            });
        }
        if (typeof sendDirect !== 'function') continue;
        try {
            await sendDirect(step.url, step.label);
            return { route: step.label, mode: 'direct' };
        } catch (e) {
            errors.push(`${step.label}: ${e.message}`);
        }
    }

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (typeof onStatus === 'function') {
            await onStatus({
                step: i + 1,
                total: steps.length,
                label: `${step.label} (buffer)`,
                phase: 'download',
            });
        }
        if (typeof sendBuffer !== 'function') continue;
        try {
            const buffer = await downloadBufferFromUrl(step.url, {
                expectStream: step.kind === 'stream',
            });
            const fileName = safeFileName(track.title || track.track);
            await sendBuffer(buffer, step.label, fileName);
            return { route: step.label, mode: 'buffer', buffer, fileName };
        } catch (e) {
            errors.push(`${step.label}: ${e.message}`);
        }
    }

    throw new Error(errors.join(' · ') || 'Todas as rotas de download falharam');
}

/** @deprecated use deliverAudioTrack */
async function downloadAudioWithFallback(track, apiBase, apiKey, onStatus) {
    return deliverAudioTrack(track, apiBase, apiKey, {
        onStatus,
        sendBuffer: async (buffer, label, fileName) => ({ buffer, route: label, fileName }),
    });
}

async function downloadAudioBuffer(audioUrl) {
    return downloadBufferFromUrl(audioUrl);
}

function safeFileName(title) {
    const base = String(title || 'musica')
        .replace(/[^\w\s\-().]/gi, '')
        .trim()
        .slice(0, 80) || 'musica';
    return `${base}.mp3`;
}

function formatStatusLine({ step, total, label, phase }) {
    const icon = phase === 'direct' ? '📤' : phase === 'download' ? '⬇️' : '🔍';
    return `${icon} <b>Rota ${step}/${total}</b> — <code>${escapeTelegramHtml(label)}</code>`;
}

module.exports = {
    extractYoutubeUrl,
    parsePlayQuery,
    fetchTrack,
    fetchTrackWithFallback,
    searchVideos,
    pickBestSearchIndex,
    shouldAutoPickSearch,
    trackFromSearchHit,
    trackFromYoutubeUrl,
    buildPreviewCaption,
    buildSearchCaption,
    buildSearchKeyboard,
    storePending,
    storeSearchSession,
    peekPending,
    takePending,
    takeSearchResult,
    discardPending,
    discardSearchSession,
    deliverAudioTrack,
    downloadAudioWithFallback,
    downloadAudioBuffer,
    API_TIMEOUT_MS,
    BUFFER_TIMEOUT_MS,
    getStreamDownloadUrls,
    safeFileName,
    formatStatusLine,
    STREAM_ROUTES,
    METADATA_ROUTES,
};
