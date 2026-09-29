'use strict';

require('dotenv').config();
const TikTokService = require('../src/services/TikTokService');
const photoVideo = require('../src/services/mediaPhotoVideo');

const URL = process.argv[2] || 'https://vt.tiktok.com/ZSCRTonch/';
const apiKey = process.env.API_KEY_ZEROTWO || '';
const apiBase = process.env.ZEROTWO_API || 'https://zero-two-apis.com.br';

(async () => {
    const ffmpeg = await photoVideo.resolveFfmpegPath();
    console.log('ffmpeg', ffmpeg || 'MISSING');
    if (!ffmpeg) {
        console.error('FAIL: ffmpeg não encontrado — rode npm install');
        process.exit(1);
    }

    const item = await TikTokService.fetchVideoFromUrl(apiBase, apiKey, URL);
    console.log('mediaType', item.mediaType);
    console.log('musicUrl', item.musicUrl ? 'yes' : 'no');
    console.log('imageUrls', item.imageUrls?.length || 0);

    if (!item.imageUrls?.length || !item.musicUrl) {
        console.error('FAIL: post sem imagem ou áudio');
        process.exit(1);
    }

    const axios = require('axios');
    const { data: imgData } = await axios.get(item.imageUrls[0], {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
    });
    const { data: audData } = await axios.get(item.musicUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
    });

    const t0 = Date.now();
    const video = await photoVideo.composeImageAudioVideo(Buffer.from(imgData), Buffer.from(audData));
    console.log('videoBytes', video.length, 'ms', Date.now() - t0);
    console.log('PASS');
})().catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
});
