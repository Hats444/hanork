'use strict';

const axios = require('axios');
const { escapeTelegramHtml } = require('../telegram/htmlEscape');
const { tryDeliverImageWithAudio } = require('./mediaImageAudioDelivery');

const API_TIMEOUT_MS = 45000;
const BUFFER_TIMEOUT_MS = 90000;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const MIN_MEDIA_BYTES = 8 * 1024;

const STREAM_VIDEO_ROUTES = [
    { id: 'ytvideo', path: '/api/dl/ytvideo', label: 'ytvideo', kind: 'video' },
    { id: 'ytvideo2', path: '/api/dl/ytvideo2', label: 'ytvideo2', kind: 'video' },
    { id: 'ytvideo3', path: '/api/dl/ytvideo3', label: 'ytvideo3', kind: 'video' },
];

const STREAM_AUDIO_ROUTES = [
    { id: 'ytaudio', path: '/api/dl/ytaudio', label: 'ytaudio', kind: 'audio' },
    { id: 'ytaudio2', path: '/api/dl/ytaudio2', label: 'ytaudio2', kind: 'audio' },
    { id: 'ytaudio3', path: '/api/dl/ytaudio3', label: 'ytaudio3', kind: 'audio' },
];

const SPECIAL_ROUTES = {
    shorts: { id: 'ytshorts', path: '/api/dl/ytshorts', label: 'ytshorts', kind: 'video' },
    live: { id: 'ytlive', path: '/api/dl/ytlive', label: 'ytlive', kind: 'video' },
};

const DOWNLOAD_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'video/mp4,audio/mpeg,video/*,audio/*,*/*',
};

function apiRoot(base) {
    return String(base || 'https://zero-two-apis.com.br').replace(/\/+$/, '');
}

function buildRouteUrl(base, path, youtubeUrl, apiKey) {
    const params = new URLSearchParams({ url: youtubeUrl, apikey: apiKey });
    return `${apiRoot(base)}${path}?${params.toString()}`;
}

function extractYoutubeUrl(text) {
    const raw = String(text || '');
    const m = raw.match(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[^\s<>"']+/i
    );
    if (!m) return null;
    let url = m[0].replace(/[.,;)]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url;
}

function detectYoutubeKind(url) {
    const u = String(url || '').toLowerCase();
    if (/\/shorts\//.test(u)) return 'shorts';
    if (/\/live\//.test(u)) return 'live';
    return 'video';
}

function parseYoutubeQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const withoutCmd = raw.replace(/^\/(?:youtube|yt)(?:@\w+)?\s*/i, '').trim();
    const body = withoutCmd || raw;
    const url = extractYoutubeUrl(body);
    if (url) return { type: 'url', value: url, kind: detectYoutubeKind(url) };
    return null;
}

function apiErrorText(data, fallback = 'Resposta inválida') {
    const raw = data?.message || data?.erro || data?.error || fallback;
    return String(raw).replace(/\s{2,}/g, ' ').trim() || fallback;
}

function firstUrl(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    if (typeof value === 'string') return value;
    return null;
}

function normalizeFromYtmusic(resultado, youtubeUrl) {
    const r = resultado || {};
    return {
        type: 'youtube',
        title: r.title || r.track || 'YouTube',
        author: r.artist || r.channel || '',
        thumbnail: r.thumbnail || null,
        duration_string: r.duration_string || '',
        sourceUrl: youtubeUrl,
        videoUrl: firstUrl(r.video_url || r.videoUrl || r.url),
        audioUrl: r.audio_url || r.audioUrl || null,
        fetchRoute: 'ytmusic',
    };
}

async function fetchYtmusicMeta(apiBase, apiKey, youtubeUrl) {
    const url = buildRouteUrl(apiBase, '/api/dl/ytmusic', youtubeUrl, apiKey);
    const { data } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
    });
    if (!data?.status || !data?.resultado) {
        throw new Error(apiErrorText(data, 'ytmusic: metadados indisponíveis'));
    }
    return normalizeFromYtmusic(data.resultado, youtubeUrl);
}

function buildStreamRoutes(kind) {
    const routes = [];
    if (kind === 'shorts' && SPECIAL_ROUTES.shorts) routes.push(SPECIAL_ROUTES.shorts);
    if (kind === 'live' && SPECIAL_ROUTES.live) routes.push(SPECIAL_ROUTES.live);
    routes.push(...STREAM_VIDEO_ROUTES);
    routes.push(...STREAM_AUDIO_ROUTES);
    return routes;
}

function buildDeliverySteps(item, apiBase, apiKey) {
    const youtubeUrl = item.sourceUrl;
    if (!youtubeUrl) throw new Error('URL YouTube ausente');

    const kind = item.kind || detectYoutubeKind(youtubeUrl);
    const steps = [];

    for (const route of buildStreamRoutes(kind)) {
        steps.push({
            label: route.label,
            kind: route.kind,
            url: buildRouteUrl(apiBase, route.path, youtubeUrl, apiKey),
            apiRoute: route.id,
        });
    }

    if (item.videoUrl) {
        steps.unshift({
            label: item.fetchRoute || 'cdn-video',
            kind: 'video',
            url: item.videoUrl,
            apiRoute: 'cdn',
        });
    }
    if (item.audioUrl) {
        steps.push({
            label: 'cdn-audio',
            kind: 'audio',
            url: item.audioUrl,
            apiRoute: 'cdn-audio',
        });
    }

    return steps;
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

async function downloadBufferFromUrl(url, { expectStream = false, maxBytes = MAX_VIDEO_BYTES } = {}) {
    const { data, headers, status } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: BUFFER_TIMEOUT_MS,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        headers: DOWNLOAD_HEADERS,
        maxRedirects: 5,
        validateStatus: (s) => s < 500,
    });

    if (status >= 400) throw new Error(`HTTP ${status}`);

    const buf = Buffer.from(data);
    const ct = String(headers['content-type'] || '').toLowerCase();

    if (expectStream && (ct.includes('json') || ct.includes('html') || isErrorPayloadBuffer(buf))) {
        let msg = 'Rota indisponível';
        try {
            const j = JSON.parse(buf.toString('utf8'));
            msg = apiErrorText(j, msg);
        } catch {
            /* ignore */
        }
        throw new Error(msg);
    }

    if (!buf.length || buf.length < MIN_MEDIA_BYTES) {
        throw new Error(buf.length ? 'Arquivo muito pequeno' : 'Arquivo vazio');
    }
    return { buffer: buf, contentType: ct };
}

function safeFileName(title, ext) {
    const base = String(title || 'youtube')
        .replace(/[^\w\s\-().]/gi, '')
        .trim()
        .slice(0, 80) || 'youtube';
    return `${base}.${ext}`;
}

function formatStatusLine({ step, total, label, phase }) {
    const icon = phase === 'direct' ? '📤' : phase === 'download' ? '⬇️' : '🔍';
    return `${icon} <b>Rota ${step}/${total}</b> — <code>${escapeTelegramHtml(label)}</code>`;
}

/**
 * Resolve metadados (opcional) e monta item para entrega.
 */
async function fetchItemFromUrl(apiBase, apiKey, youtubeUrl, { onStatus } = {}) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const kind = detectYoutubeKind(youtubeUrl);
    let item = {
        type: 'youtube',
        title: 'YouTube',
        author: '',
        thumbnail: null,
        duration_string: '',
        sourceUrl: youtubeUrl,
        videoUrl: null,
        audioUrl: null,
        fetchRoute: null,
        kind,
    };

    if (typeof onStatus === 'function') {
        await onStatus({ step: 1, total: 1, label: 'ytmusic', phase: 'meta' });
    }
    try {
        item = { ...item, ...(await fetchYtmusicMeta(apiBase, apiKey, youtubeUrl)) };
    } catch {
        /* metadados opcionais */
    }

    return item;
}

async function tryThumbnailAudioFallback(item, handlers, errors) {
    const thumb = item.thumbnail;
    const audio = item.audioUrl;
    if (!thumb || !audio) return null;

    try {
        const composed = await tryDeliverImageWithAudio({
            imageUrl: thumb,
            musicUrl: audio,
            label: 'yt/thumb+audio',
            fileName: safeFileName(item.title, 'mp4'),
            onStatus: handlers.onStatus,
            sendVideoBuffer: handlers.sendVideoBuffer,
            downloadImage: async (u) => {
                const { buffer } = await downloadBufferFromUrl(u, {
                    maxBytes: 12 * 1024 * 1024,
                    expectStream: false,
                });
                return buffer;
            },
            downloadAudio: async (u) => {
                const { buffer } = await downloadBufferFromUrl(u, {
                    maxBytes: MAX_AUDIO_BYTES,
                    expectStream: true,
                });
                return buffer;
            },
        });
        if (composed) return composed;
    } catch (e) {
        errors.push(`thumb+audio: ${e.message}`);
    }
    return null;
}

async function deliverYoutubeItem(item, apiBase, apiKey, { onStatus, sendVideo, sendAudio, sendVideoBuffer, sendAudioBuffer } = {}) {
    const steps = buildDeliverySteps(item, apiBase, apiKey);
    const errors = [];
    const handlers = { onStatus, sendVideoBuffer };

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const phases = [
            { phase: 'direct', mode: 'direct' },
            { phase: 'download', mode: 'buffer' },
        ];

        for (let pi = 0; pi < phases.length; pi++) {
            const { phase, mode } = phases[pi];
            if (typeof onStatus === 'function') {
                await onStatus({
                    step: i + 1,
                    total: steps.length,
                    label: mode === 'buffer' ? `${step.label} (buffer)` : step.label,
                    phase,
                    kind: step.kind,
                });
            }

            try {
                if (mode === 'direct') {
                    if (step.kind === 'audio') {
                        if (typeof sendAudio !== 'function') continue;
                        await sendAudio(step.url, step.label);
                    } else {
                        if (typeof sendVideo !== 'function') continue;
                        await sendVideo(step.url, step.label);
                    }
                } else {
                    const max = step.kind === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
                    const { buffer } = await downloadBufferFromUrl(step.url, {
                        expectStream: step.apiRoute !== 'cdn' && step.apiRoute !== 'cdn-audio',
                        maxBytes: max,
                    });
                    const ext = step.kind === 'audio' ? 'mp3' : 'mp4';
                    const fileName = safeFileName(item.title, ext);
                    if (step.kind === 'audio') {
                        if (typeof sendAudioBuffer !== 'function') continue;
                        await sendAudioBuffer(buffer, step.label, fileName);
                    } else {
                        if (typeof sendVideoBuffer !== 'function') continue;
                        await sendVideoBuffer(buffer, step.label, fileName);
                    }
                }
                return { route: step.label, mode, kind: step.kind };
            } catch (e) {
                errors.push(`${step.label}${mode === 'buffer' ? ' (buffer)' : ''}: ${e.message}`);
            }
        }
    }

    const fallback = await tryThumbnailAudioFallback(item, handlers, errors);
    if (fallback) return fallback;

    throw new Error(errors.slice(0, 6).join(' · ') || 'Todas as rotas de download falharam');
}

module.exports = {
    extractYoutubeUrl,
    detectYoutubeKind,
    parseYoutubeQuery,
    fetchYtmusicMeta,
    fetchItemFromUrl,
    deliverYoutubeItem,
    buildRouteUrl,
    buildStreamRoutes,
    safeFileName,
    formatStatusLine,
    API_TIMEOUT_MS,
    BUFFER_TIMEOUT_MS,
    STREAM_VIDEO_ROUTES,
    STREAM_AUDIO_ROUTES,
};
