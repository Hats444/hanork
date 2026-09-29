'use strict';

/**
 * Smoke test das rotas Zero Two YouTube (requer API_KEY_ZEROTWO no .env).
 * node scripts/test-youtube-routes.js
 */

require('dotenv').config();
const axios = require('axios');
const YouTubeService = require('../src/services/YouTubeService');

const key = process.env.API_KEY_ZEROTWO;
const base = process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';
const sample = 'https://youtu.be/qI5-mU9SqrM';

if (!key) {
    console.error('API_KEY_ZEROTWO ausente no .env');
    process.exit(1);
}

async function probeRoute(route, url) {
    const apiUrl = YouTubeService.buildRouteUrl(base, route.path, url, key);
    try {
        const r = await axios.get(apiUrl, {
            timeout: 20000,
            responseType: 'arraybuffer',
            maxContentLength: 300000,
            maxBodyLength: 300000,
            validateStatus: () => true,
        });
        const ct = String(r.headers['content-type'] || '');
        const buf = Buffer.from(r.data);
        if (ct.includes('json') || buf[0] === 0x7b) {
            let j;
            try {
                j = JSON.parse(buf.toString('utf8'));
            } catch {
                j = {};
            }
            return {
                ok: !!j.status,
                type: 'json',
                status: r.status,
                api: j.status,
                msg: j.message || j.erro || '',
            };
        }
        return { ok: r.status < 400 && buf.length > 1000, type: 'stream', status: r.status, bytes: buf.length, ct };
    } catch (e) {
        return { ok: false, type: 'err', msg: e.message };
    }
}

(async () => {
    console.log('URL:', sample);
    console.log('--- ytmusic (metadados) ---');
    try {
        const meta = await YouTubeService.fetchYtmusicMeta(base, key, sample);
        console.log('OK', meta.title, meta.audioUrl ? 'audio_url' : 'sem audio');
    } catch (e) {
        console.log('FAIL', e.message);
    }

    const routes = [
        ...YouTubeService.buildStreamRoutes('video'),
    ];
    console.log('--- rotas stream ---');
    for (const route of routes) {
        const r = await probeRoute(route, sample);
        console.log(route.label, JSON.stringify(r));
    }
    console.log('\nOrdem de entrega:', routes.map((x) => x.label).join(' → '));
})();
