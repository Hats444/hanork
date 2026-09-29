'use strict';

require('dotenv').config();
const TikTokService = require('../src/services/TikTokService');

const URL = process.argv[2] || 'https://vt.tiktok.com/ZSCRTonch/';
const apiKey = process.env.API_KEY_ZEROTWO || '';
const apiBase = process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

(async () => {
    const item = await TikTokService.fetchVideoFromUrl(apiBase, apiKey, URL, {
        onStatus: ({ label }) => console.log('route', label),
    });
    console.log('mediaType', item.mediaType);
    console.log('videoUrl', item.videoUrl ? 'yes' : 'no');
    console.log('imageUrls', item.imageUrls?.length || 0);
    console.log('title', item.title);
    if (!item.videoUrl && !item.imageUrls?.length) {
        console.error('FAIL: sem mídia');
        process.exit(1);
    }
    console.log('PASS');
})().catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
});
