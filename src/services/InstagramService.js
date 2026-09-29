'use strict';

const axios = require('axios');
const { escapeTelegramHtml } = require('../telegram/htmlEscape');
const { tryDeliverImageWithAudio, collectMusicUrl } = require('./mediaImageAudioDelivery');

const API_TIMEOUT_MS = 55000;
const BUFFER_TIMEOUT_MS = 90000;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const STORIES_ALBUM_CHUNK = 10;
const MIN_AUDIO_BYTES = 512;

const DOWNLOAD_ROUTES = [
    { id: 'dl', path: '/api/dl/instagram', label: 'ig/dl' },
    { id: 'post', path: '/api/instagram/post', label: 'ig/post' },
];

const DOWNLOAD_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://www.instagram.com/',
    Accept: 'video/mp4,video/*,image/*,*/*',
};

function apiRoot(base) {
    return String(base || 'https://zero-two-apis.com.br').replace(/\/+$/, '');
}

function apiErrorText(data, fallback = 'Resposta inválida') {
    const raw = data?.message || data?.mensagem || data?.erro || data?.error || fallback;
    return String(raw)
        .replace(/@?lucas_mod_domina/gi, '')
        .replace(/\bcriador\b\s*:?\s*@?\w+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || fallback;
}

function buildUrl(base, path, params) {
    const qs = new URLSearchParams(params);
    return `${apiRoot(base)}${path}?${qs.toString()}`;
}

function extractInstagramUrl(text) {
    const raw = String(text || '');
    const m = raw.match(
        /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"']+/i
    );
    if (!m) return null;
    let url = m[0].replace(/[.,;)]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url;
}

function normalizeUsername(input) {
    let u = String(input || '').trim().replace(/^@/, '').toLowerCase();
    u = u.split(/\s+/)[0];
    return u.length >= 1 && /^[a-z0-9._]+$/.test(u) ? u : null;
}

/**
 * /instagram URL | stories @user | highlights @user | @user (stories)
 */
function parseInstagramQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const body = raw.replace(/^\/instagram(?:@\w+)?\s*/i, '').trim() || raw;

    const url = extractInstagramUrl(body);
    if (url) return { type: 'url', value: url };

    const storiesM = body.match(/^stories?\s+(@?\S+)/i);
    if (storiesM) {
        const user = normalizeUsername(storiesM[1]);
        if (user) return { type: 'stories', value: user };
    }

    const highlightsM = body.match(/^highlights?\s+(@?\S+)/i);
    if (highlightsM) {
        const user = normalizeUsername(highlightsM[1]);
        if (user) return { type: 'highlights', value: user };
    }

    if (body.startsWith('@')) {
        const user = normalizeUsername(body);
        if (user) return { type: 'stories', value: user };
    }

    const bare = normalizeUsername(body);
    if (bare && !body.includes('://')) return { type: 'stories', value: bare };

    return null;
}

function firstUrl(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value.find(Boolean) || null;
    if (typeof value === 'string') return value;
    return null;
}

function pickStats(obj) {
    if (!obj || typeof obj !== 'object') return {};
    return {
        likes: obj.likes ?? obj.likeCount ?? obj.like ?? null,
        comments: obj.comments ?? obj.comment_count ?? obj.comment ?? null,
        views: obj.views ?? obj.playCount ?? null,
    };
}

function normalizePostItem(payload, sourceUrl, routeLabel) {
    const root = payload?.resultado?.links?.length ? payload.resultado : payload;
    const medias = [];
    let title = 'Instagram';
    let author = '';
    let thumbnail = null;
    const stats = {};

    if (root.links?.length) {
        title = root.caption?.slice(0, 80) || root.name || title;
        author = root.username || '';
        thumbnail = root.links[0]?.url || null;
        Object.assign(stats, pickStats(root));
        const postMusic = collectMusicUrl(root, root.caption ? { music: root.music } : null);
        for (const link of root.links) {
            if (!link?.url) continue;
            medias.push({
                type: link.type === 'video' ? 'video' : 'image',
                url: link.url,
                musicUrl: collectMusicUrl(link) || postMusic,
            });
        }
    } else {
        const ig = root.Instagram || root;
        const data = ig?.resultados?.data || ig?.resultado?.data || ig?.resultado;
        if (data) {
            title = data.title || data.description || title;
            author =
                data.username ||
                ig?.resultado?.username ||
                root.username ||
                payload?.username ||
                '';
            thumbnail = firstUrl(data.thumb) || firstUrl(data.images) || null;
            const mediaType = String(data.media_type || '').toLowerCase();
            const videoUrl = firstUrl(data.video) || firstUrl(data.video_url);
            const imageUrl =
                firstUrl(data.images) || firstUrl(data.thumb) || firstUrl(data.image);
            const postMusic = collectMusicUrl(data, ig?.resultado, root, payload);
            if (videoUrl) {
                medias.push({ type: 'video', url: videoUrl, musicUrl: postMusic });
            } else if (imageUrl) {
                medias.push({ type: 'image', url: imageUrl, musicUrl: postMusic });
            }
            if (mediaType !== 'video' && Array.isArray(data.images)) {
                for (const img of data.images) {
                    if (img && !medias.some((m) => m.url === img)) {
                        medias.push({ type: 'image', url: img, musicUrl: postMusic });
                    }
                }
            }
            if (ig?.resultado?.url) {
                const urls = Array.isArray(ig.resultado.url) ? ig.resultado.url : [ig.resultado.url];
                if (!medias.length && urls[0]) {
                    medias.push({ type: 'video', url: urls[0] });
                    author = ig.resultado.username || author;
                    Object.assign(stats, pickStats(ig.resultado));
                }
            }
            Object.assign(stats, pickStats(data));
        }
    }

    const unique = [];
    const seen = new Set();
    for (const m of medias) {
        if (!m.url || seen.has(m.url)) continue;
        seen.add(m.url);
        unique.push(m);
    }

    if (!unique.length) return null;

    return {
        type: 'instagram',
        mode: 'post',
        title,
        author,
        thumbnail,
        sourceUrl,
        fetchRoute: routeLabel,
        musicUrl: unique.find((m) => m.musicUrl)?.musicUrl || null,
        medias: unique,
        ...stats,
    };
}

async function fetchJsonRoute(apiBase, apiKey, path, params) {
    const url = buildUrl(apiBase, path, { ...params, apikey: apiKey });
    const { data, status } = await axios.get(url, {
        timeout: API_TIMEOUT_MS,
        validateStatus: () => true,
    });
    if (status >= 502 || (status >= 500 && !data)) {
        throw new Error(`HTTP ${status}`);
    }
    return data;
}

async function fetchPostFromUrl(apiBase, apiKey, instagramUrl, { onStatus } = {}) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');
    const errors = [];

    for (let i = 0; i < DOWNLOAD_ROUTES.length; i++) {
        const route = DOWNLOAD_ROUTES[i];
        if (typeof onStatus === 'function') {
            await onStatus({ step: i + 1, total: DOWNLOAD_ROUTES.length, label: route.label });
        }
        try {
            const data = await fetchJsonRoute(apiBase, apiKey, route.path, { url: instagramUrl });
            const igBlock = data?.Instagram;
            const ok =
                data?.status === true ||
                igBlock?.status === true ||
                (Boolean(data?.resultado?.links?.length) && data.status !== false);
            if (!ok) {
                throw new Error(apiErrorText(data?.Instagram || data, `${route.label}: falhou`));
            }
            const payload = igBlock?.resultados
                ? { Instagram: igBlock }
                : data?.resultado
                  ? data
                  : data;
            const item = normalizePostItem(payload, instagramUrl, route.label);
            if (item) return item;
            throw new Error(`${route.label}: sem mídia`);
        } catch (e) {
            errors.push(`${route.label}: ${e.message}`);
        }
    }

    throw new Error(errors.join(' · ') || 'Nenhuma rota respondeu');
}

async function fetchStories(apiBase, apiKey, username) {
    const data = await fetchJsonRoute(apiBase, apiKey, '/api/instagram/stories', {
        username,
    });
    if (!data?.status || !data?.resultado) {
        throw new Error(apiErrorText(data, 'Stories indisponíveis'));
    }
    const r = data.resultado;
    const stories = (r.stories || [])
        .filter((s) => s?.url && (s.type === 'image' || s.type === 'video'))
        .map((s) => ({
            ...s,
            musicUrl: collectMusicUrl(s) || null,
        }));
    if (!stories.length) {
        throw new Error(`Nenhum story ativo para @${username}`);
    }
    return {
        type: 'instagram',
        mode: 'stories',
        title: `Stories de @${r.username || username}`,
        author: r.username || username,
        thumbnail: r.graphql?.user?.profile_pic_url || stories[0]?.url || null,
        storiesCount: r.stories_count || stories.length,
        stories,
        fetchRoute: 'ig/stories',
    };
}

async function fetchHighlights(apiBase, apiKey, username) {
    const data = await fetchJsonRoute(apiBase, apiKey, '/api/instagram/highlights', {
        username,
    });
    if (!data?.status || !data?.resultado) {
        throw new Error(apiErrorText(data, 'Destaques indisponíveis'));
    }
    const r = data.resultado;
    const list = Array.isArray(r.data) ? r.data : Array.isArray(r.highlights) ? r.highlights : [];
    const highlights = list
        .map((h) => ({
            title: h.title || 'Destaque',
            type: h.type === 'video' ? 'video' : 'image',
            url: h.url || h.cover,
            media_count: h.media_count,
            highlights_id: h.highlights_id,
        }))
        .filter((h) => h.url);
    if (!highlights.length) {
        throw new Error(`Nenhum destaque para @${r.username || username}`);
    }
    return {
        type: 'instagram',
        mode: 'highlights',
        title: `Destaques de @${r.username || username}`,
        author: r.username || username,
        thumbnail: list[0]?.owner?.profile_pic_url || highlights[0]?.url || null,
        highlightsCount: r.highlights_count || highlights.length,
        highlights,
        fetchRoute: 'ig/highlights',
    };
}

function isErrorPayloadBuffer(buf) {
    if (!buf || buf.length < 2) return false;
    const head = buf.slice(0, Math.min(buf.length, 400)).toString('utf8').trim();
    if (head.startsWith('{') || head.startsWith('<!')) {
        try {
            const j = JSON.parse(head);
            if (j?.status === false || j.message) return true;
        } catch {
            return true;
        }
        return true;
    }
    return false;
}

async function downloadBufferFromUrl(url, { maxBytes = MAX_VIDEO_BYTES } = {}) {
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
    if (ct.includes('json') || ct.includes('html') || isErrorPayloadBuffer(buf)) {
        throw new Error('Link expirado ou bloqueado');
    }
    if (!buf.length) throw new Error('Arquivo vazio');
    return buf;
}

function deliveryPhases(url) {
    const u = String(url || '').toLowerCase();
    // CDN do Instagram bloqueia muitos IPs de servidor — Telegram busca direto melhor.
    if (u.includes('cdninstagram') || u.includes('fbcdn')) {
        return ['direct', 'buffer'];
    }
    return ['direct', 'buffer'];
}

async function downloadAudioBufferFromUrl(url) {
    const { data, headers, status } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: BUFFER_TIMEOUT_MS,
        maxContentLength: MAX_VIDEO_BYTES,
        maxBodyLength: MAX_VIDEO_BYTES,
        headers: { ...DOWNLOAD_HEADERS, Accept: 'audio/*,application/octet-stream,*/*' },
        maxRedirects: 5,
        validateStatus: (s) => s < 500,
    });
    if (status >= 400) throw new Error(`HTTP ${status}`);
    const buf = Buffer.from(data);
    const ct = String(headers['content-type'] || '').toLowerCase();
    if (ct.includes('json') || ct.includes('html') || isErrorPayloadBuffer(buf)) {
        throw new Error('Áudio indisponível');
    }
    if (!buf.length || buf.length < MIN_AUDIO_BYTES) throw new Error('Áudio vazio');
    return buf;
}

async function deliverOneMedia(url, type, handlers, meta = {}) {
    const label = meta.label || 'ig';
    const musicUrl = meta.musicUrl || null;

    if (type === 'image' && musicUrl) {
        try {
            const composed = await tryDeliverImageWithAudio({
                imageUrl: url,
                musicUrl,
                label,
                fileName: meta.fileName || safeFileName(meta.title || 'instagram', 'video'),
                onStatus: handlers.onStatus,
                sendVideoBuffer: handlers.sendVideoBuffer,
                downloadImage: (u) => downloadBufferFromUrl(u, { maxBytes: MAX_IMAGE_BYTES }),
                downloadAudio: downloadAudioBufferFromUrl,
            });
            if (composed) return composed;
        } catch {
            /* fallback foto/vídeo normal */
        }
    }

    const phases = deliveryPhases(url);

    for (const phase of phases) {
        try {
            if (phase === 'direct' && handlers.sendDirect) {
                await handlers.sendDirect(url, type, label);
                return { mode: 'direct', label };
            }
            if (phase === 'buffer' && handlers.sendBuffer) {
                const max = type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
                const buffer = await downloadBufferFromUrl(url, { maxBytes: max });
                const ext = type === 'video' ? '.mp4' : '.jpg';
                await handlers.sendBuffer(buffer, type, label, meta.fileName || `instagram${ext}`);
                return { mode: 'buffer', label };
            }
        } catch (e) {
            if (phase === phases[phases.length - 1]) throw e;
        }
    }
    throw new Error('Falha ao enviar mídia');
}

async function deliverPostItem(item, handlers = {}) {
    const errors = [];
    for (let i = 0; i < item.medias.length; i++) {
        const m = item.medias[i];
        try {
            await deliverOneMedia(m.url, m.type, handlers, {
                label: item.fetchRoute,
                fileName: safeFileName(item.title, m.type),
                musicUrl: m.musicUrl || item.musicUrl,
                title: item.title,
            });
        } catch (e) {
            errors.push(e.message);
        }
    }
    if (errors.length === item.medias.length) {
        throw new Error(errors.join(' · '));
    }
    return { sent: item.medias.length - errors.length, errors };
}

async function deliverStoriesItem(item, handlers = {}) {
    const { stories } = item;
    const chunks = [];
    for (let i = 0; i < stories.length; i += STORIES_ALBUM_CHUNK) {
        chunks.push(stories.slice(i, i + STORIES_ALBUM_CHUNK));
    }
    let sent = 0;
    for (const chunk of chunks) {
        if (handlers.sendAlbum) {
            await handlers.sendAlbum(chunk, item);
            sent += chunk.length;
        } else {
            for (const s of chunk) {
                await deliverOneMedia(s.url, s.type === 'video' ? 'video' : 'image', handlers, {
                    label: 'ig/story',
                    musicUrl: s.musicUrl,
                    title: item.title,
                    fileName: safeFileName(item.title, s.type === 'video' ? 'video' : 'image'),
                });
                sent++;
            }
        }
    }
    return { sent, total: stories.length };
}

async function deliverHighlightsItem(item, handlers = {}) {
    let sent = 0;
    for (const h of item.highlights) {
        try {
            await deliverOneMedia(h.url, h.type, handlers, {
                label: 'ig/highlight',
                fileName: safeFileName(h.title, h.type),
            });
            sent++;
        } catch {
            /* próximo */
        }
    }
    if (!sent) throw new Error('Não foi possível enviar os destaques');
    return { sent, total: item.highlights.length };
}

async function deliverInstagramItem(item, apiBase, apiKey, handlers = {}) {
    if (item.mode === 'post') return deliverPostItem(item, handlers);
    if (item.mode === 'stories') return deliverStoriesItem(item, handlers);
    if (item.mode === 'highlights') return deliverHighlightsItem(item, handlers);
    throw new Error('Modo Instagram desconhecido');
}

function safeFileName(title, type = 'video') {
    const base =
        String(title || 'instagram')
            .replace(/[^\w\s\-().]/gi, '')
            .trim()
            .slice(0, 60) || 'instagram';
    return `${base}.${type === 'video' ? 'mp4' : 'jpg'}`;
}

module.exports = {
    extractInstagramUrl,
    parseInstagramQuery,
    fetchPostFromUrl,
    fetchStories,
    fetchHighlights,
    deliverInstagramItem,
    deliverPostItem,
    deliverStoriesItem,
    deliverHighlightsItem,
    safeFileName,
    STORIES_ALBUM_CHUNK,
    API_TIMEOUT_MS,
};
