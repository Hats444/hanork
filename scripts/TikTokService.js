'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { escapeTelegramHtml } = require('../telegram/htmlEscape');

const PENDING_TTL_MS = 15 * 60 * 1000;
const searchSessions = new Map();

const DOWNLOAD_ROUTES = [
    { id: 'v1', path: '/api/download/tiktok', label: 'tiktok/v1' },
    { id: 'v4', path: '/api/download/tiktok/v4', label: 'tiktok/v4' },
    { id: 'v2', path: '/api/download/tiktok/v2', label: 'tiktok/v2' },
];

const MIN_VIDEO_BYTES = 32 * 1024;
const DOWNLOAD_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://www.tiktok.com/',
    Accept: 'video/mp4,video/*,*/*',
};

/** CDN que o Telegram não consegue puxar direto (retorna vazio) */
function shouldBufferFirst(url) {
    const u = String(url || '').toLowerCase();
    return (
        u.includes('tikcdn.io') ||
        u.includes('ssstik') ||
        u.includes('snaptik') ||
        u.includes('douyin') ||
        u.includes('/obj/tos-')
    );
}

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const API_TIMEOUT_MS = 45000;
const BUFFER_TIMEOUT_MS = 60000;

function cleanupPending() {
    const now = Date.now();
    for (const [id, row] of searchSessions) {
        if (!row?.expiresAt || row.expiresAt <= now) searchSessions.delete(id);
    }
}

setInterval(cleanupPending, 5 * 60 * 1000).unref?.();

function extractTiktokUrl(text) {
    const raw = String(text || '');
    const m = raw.match(
        /(?:https?:\/\/)?(?:(?:www|vm|vt)\.)?tiktok\.com(?:\/[^\s<>"']+)?|(?:https?:\/\/)?(?:vm|vt)\.tiktok\.com\/[^\s<>"']+/i
    );
    if (!m) return null;
    let url = m[0].replace(/[.,;)]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url;
}

function parseTikTokQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const withoutCmd = raw.replace(/^\/tiktok(?:@\w+)?\s*/i, '').trim();
    const body = withoutCmd || raw;
    const url = extractTiktokUrl(body);
    if (url) return { type: 'url', value: url };
    let query = body.replace(/\s+/g, ' ').trim();
    if (query.startsWith('@')) query = query.slice(1);
    if (query.length >= 2) return { type: 'search', value: query };
    return null;
}

function apiRoot(base) {
    return String(base || 'https://zero-two-apis.com.br').replace(/\/+$/, '');
}

/** Mensagem de erro da API — ignora campo criador e branding de terceiros */
function apiErrorText(data, fallback = 'Resposta inválida') {
    const raw = data?.message || data?.erro || data?.error || fallback;
    return String(raw)
        .replace(/@?lucas_mod_domina/gi, '')
        .replace(/\bcriador\b\s*:?\s*@?\w+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || fallback;
}

function buildDownloadApiUrl(base, path, tiktokUrl, apiKey) {
    const params = new URLSearchParams({ url: tiktokUrl, apikey: apiKey });
    return `${apiRoot(base)}${path}?${params.toString()}`;
}

function buildSearchApiUrl(base, query, apiKey) {
    const params = new URLSearchParams({ username: query, apikey: apiKey });
    return `${apiRoot(base)}/download/tiktoksearch?${params.toString()}`;
}

function firstUrl(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    if (typeof value === 'string') return value;
    return null;
}

function formatDurationMs(ms) {
    const s = Math.floor(Number(ms) / 1000);
    if (!s) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function pickStats(obj) {
    if (!obj || typeof obj !== 'object') return {};
    return {
        likes: obj.likes ?? obj.likeCount ?? obj.curtidas ?? null,
        comments: obj.comments ?? obj.commentCount ?? obj.comentários ?? obj.comentarios ?? null,
        shares: obj.shares ?? obj.shareCount ?? obj.compartilhamentos ?? null,
        views: obj.views ?? obj.playCount ?? null,
    };
}

function normalizeFromSearch(resultado, routeId = 'tiktoksearch') {
    if (!resultado) return null;
    const author = String(resultado.author || '').replace(/^@/, '');
    return {
        type: 'tiktok',
        title: resultado.title || 'TikTok',
        author,
        thumbnail: resultado.cover || resultado.origin_cover || null,
        videoUrl: resultado.no_watermark || resultado.watermark || null,
        musicUrl: resultado.music || null,
        sourceUrl: null,
        fetchRoute: routeId,
        ...pickStats({}),
    };
}

function normalizeFromV4(resultado, sourceUrl, routeId = 'v4') {
    const det = resultado?.detalhes || {};
    const desc = det.descrição || det.descricao || det.desc || 'TikTok';
    return {
        type: 'tiktok',
        title: desc,
        author: det.autor || '',
        thumbnail: det.avatar || null,
        videoUrl: firstUrl(resultado?.video?.playAddr),
        musicUrl: firstUrl(resultado?.audio?.playUrl),
        sourceUrl,
        fetchRoute: routeId,
        ...pickStats(det),
    };
}

function normalizeFromV2(resultado, sourceUrl, routeId = 'v2') {
    const stats = resultado?.statistics || {};
    return {
        type: 'tiktok',
        title: resultado?.desc || 'TikTok',
        author: resultado?.author?.nickname || resultado?.author?.uniqueId || '',
        thumbnail: resultado?.author?.avatar || null,
        videoUrl: firstUrl(resultado?.video?.playAddr),
        musicUrl: firstUrl(resultado?.music?.playUrl),
        sourceUrl,
        fetchRoute: routeId,
        ...pickStats(stats),
    };
}

function normalizeFromV1(resultado, sourceUrl, routeId = 'v1') {
    const stats = resultado?.statistics || {};
    const durationMs = resultado?.video?.duration;
    return {
        type: 'tiktok',
        title: resultado?.desc || 'TikTok',
        author: resultado?.author?.nickname || resultado?.author?.uniqueId || '',
        thumbnail: firstUrl(resultado?.video?.cover) || firstUrl(resultado?.author?.avatarThumb) || null,
        videoUrl: firstUrl(resultado?.video?.playAddr) || firstUrl(resultado?.video?.downloadAddr),
        musicUrl: firstUrl(resultado?.music?.playUrl),
        sourceUrl,
        fetchRoute: routeId,
        duration_string: formatDurationMs(durationMs),
        ...pickStats(stats),
    };
}

function ensureVideoUrl(track) {
    if (!track?.videoUrl) throw new Error('Link de vídeo indisponível');
    return track;
}

async function fetchDownloadRoute(apiBase, apiKey, tiktokUrl, route) {
    const url = buildDownloadApiUrl(apiBase, route.path, tiktokUrl, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });

    if (!data?.status || !data?.resultado) {
        throw new Error(apiErrorText(data, `${route.label}: resposta inválida`));
    }

    let track;
    if (route.id === 'v4') track = normalizeFromV4(data.resultado, tiktokUrl, route.label);
    else if (route.id === 'v2') track = normalizeFromV2(data.resultado, tiktokUrl, route.label);
    else track = normalizeFromV1(data.resultado, tiktokUrl, route.label);

    return ensureVideoUrl(track);
}

async function fetchVideoFromUrl(apiBase, apiKey, tiktokUrl, { onStatus } = {}) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const errors = [];

    for (let i = 0; i < DOWNLOAD_ROUTES.length; i++) {
        const route = DOWNLOAD_ROUTES[i];
        if (typeof onStatus === 'function') {
            await onStatus({ step: i + 1, total: DOWNLOAD_ROUTES.length, label: route.label });
        }
        try {
            return await fetchDownloadRoute(apiBase, apiKey, tiktokUrl, route);
        } catch (e) {
            errors.push(`${route.label}: ${e.message}`);
        }
    }

    throw new Error(errors.join(' · ') || 'Nenhuma rota de download respondeu');
}

async function searchVideos(apiBase, apiKey, query) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const url = buildSearchApiUrl(apiBase, query, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });

    if (!data?.status || !data?.resultado) {
        throw new Error(
            apiErrorText(data, 'Nenhum TikTok encontrado para esta busca.')
        );
    }

    const hit = normalizeFromSearch(data.resultado);
    if (!hit?.videoUrl) throw new Error('Busca retornou vídeo sem link de download');
    return [hit];
}

function itemFromSearchHit(hit) {
    if (!hit?.videoUrl) throw new Error('Vídeo indisponível na busca');
    return { ...hit };
}

function itemFromTiktokUrl(tiktokUrl) {
    return {
        type: 'tiktok',
        title: 'TikTok',
        author: '',
        thumbnail: null,
        videoUrl: null,
        musicUrl: null,
        sourceUrl: tiktokUrl,
        fetchRoute: null,
    };
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
    const tiktokUi = require('../telegram/tiktok/tiktokUi');
    return tiktokUi.formatSearchCaption(query, results);
}

function buildSearchKeyboard(sessionId, results) {
    const tiktokUi = require('../telegram/tiktok/tiktokUi');
    return tiktokUi.buildSearchKeyboard(sessionId, results);
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

async function downloadBufferFromUrl(url, { timeout = BUFFER_TIMEOUT_MS } = {}) {
    const { data, headers, status } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxContentLength: MAX_VIDEO_BYTES,
        maxBodyLength: MAX_VIDEO_BYTES,
        headers: DOWNLOAD_HEADERS,
        maxRedirects: 5,
        validateStatus: (s) => s < 500,
    });

    if (status >= 400) throw new Error(`HTTP ${status}`);

    const buf = Buffer.from(data);
    const ct = String(headers['content-type'] || '').toLowerCase();

    if (ct.includes('json') || ct.includes('html') || isErrorPayloadBuffer(buf)) {
        let msg = 'Rota indisponível';
        try {
            const j = JSON.parse(buf.toString('utf8'));
            msg = j.message || j.erro || j.error || msg;
        } catch {
            /* ignore */
        }
        throw new Error(msg);
    }

    if (!buf.length || buf.length < MIN_VIDEO_BYTES) {
        throw new Error(buf.length ? 'Arquivo muito pequeno (link expirado?)' : 'Arquivo vazio');
    }
    return buf;
}

function mergeItemMeta(target, source) {
    if (!source) return target;
    return {
        ...target,
        title: source.title || target.title,
        author: source.author || target.author,
        thumbnail: source.thumbnail || target.thumbnail,
        videoUrl: source.videoUrl || target.videoUrl,
        musicUrl: source.musicUrl || target.musicUrl,
        fetchRoute: source.fetchRoute || target.fetchRoute,
        duration_string: source.duration_string || target.duration_string,
        likes: source.likes ?? target.likes,
        comments: source.comments ?? target.comments,
        shares: source.shares ?? target.shares,
        views: source.views ?? target.views,
    };
}

/** Um passo por URL resolvida — sem repetir chamadas à API */
function buildDeliverySteps(item) {
    if (!item?.videoUrl) {
        throw new Error('Link de vídeo indisponível');
    }
    return [
        {
            label: item.fetchRoute || 'video',
            url: item.videoUrl,
            bufferFirst: shouldBufferFirst(item.videoUrl),
        },
    ];
}

async function trySendDirect(sendDirect, url, label) {
    if (typeof sendDirect !== 'function') return false;
    await sendDirect(url, label);
    return true;
}

async function trySendBuffer(sendBuffer, url, label, item) {
    if (typeof sendBuffer !== 'function') return false;
    const buffer = await downloadBufferFromUrl(url);
    const fileName = safeFileName(item.title);
    await sendBuffer(buffer, label, fileName);
    return true;
}

/**
 * Entrega vídeo: buffer primeiro em CDNs problemáticos; senão URL direta → buffer.
 */
async function deliverVideoItem(item, apiBase, apiKey, { onStatus, sendDirect, sendBuffer } = {}) {
    let current = { ...item };
    const errors = [];

    const attemptDeliver = async (videoItem) => {
        const steps = buildDeliverySteps(videoItem);
        const step = steps[0];
        const phases = step.bufferFirst
            ? [{ phase: 'download', mode: 'buffer' }, { phase: 'direct', mode: 'direct' }]
            : [{ phase: 'direct', mode: 'direct' }, { phase: 'download', mode: 'buffer' }];

        for (let i = 0; i < phases.length; i++) {
            const { phase, mode } = phases[i];
            if (typeof onStatus === 'function') {
                await onStatus({
                    step: i + 1,
                    total: phases.length,
                    label: mode === 'buffer' ? `${step.label} (buffer)` : step.label,
                    phase,
                });
            }
            try {
                if (mode === 'direct') {
                    await trySendDirect(sendDirect, step.url, step.label);
                } else {
                    await trySendBuffer(sendBuffer, step.url, step.label, videoItem);
                }
                return { route: step.label, mode };
            } catch (e) {
                errors.push(`${step.label}${mode === 'buffer' ? ' (buffer)' : ''}: ${e.message}`);
            }
        }
        return null;
    };

    let result = await attemptDeliver(current);
    if (result) return result;

    if (current.sourceUrl && apiKey) {
        for (const route of DOWNLOAD_ROUTES) {
            if (typeof onStatus === 'function') {
                await onStatus({
                    step: 1,
                    total: 1,
                    label: route.label,
                    phase: 'resolve',
                });
            }
            try {
                const resolved = await fetchDownloadRoute(apiBase, apiKey, current.sourceUrl, route);
                current = mergeItemMeta(current, resolved);
                result = await attemptDeliver(current);
                if (result) return result;
            } catch (e) {
                errors.push(`${route.label}: ${e.message}`);
            }
        }
    }

    throw new Error(errors.join(' · ') || 'Todas as rotas de download falharam');
}

function safeFileName(title) {
    const base = String(title || 'tiktok')
        .replace(/[^\w\s\-().]/gi, '')
        .trim()
        .slice(0, 80) || 'tiktok';
    return `${base}.mp4`;
}

function formatStatusLine({ step, total, label, phase }) {
    const icon = phase === 'direct' ? '📤' : phase === 'download' ? '⬇️' : '🔍';
    return `${icon} <b>Rota ${step}/${total}</b> — <code>${escapeTelegramHtml(label)}</code>`;
}

module.exports = {
    extractTiktokUrl,
    parseTikTokQuery,
    fetchVideoFromUrl,
    searchVideos,
    itemFromSearchHit,
    itemFromTiktokUrl,
    buildSearchCaption,
    buildSearchKeyboard,
    storeSearchSession,
    takeSearchResult,
    discardSearchSession,
    deliverVideoItem,
    safeFileName,
    formatStatusLine,
    shouldBufferFirst,
    mergeItemMeta,
    DOWNLOAD_ROUTES,
    API_TIMEOUT_MS,
    BUFFER_TIMEOUT_MS,
};
