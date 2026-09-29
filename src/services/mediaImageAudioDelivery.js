'use strict';

const photoVideo = require('./mediaPhotoVideo');

/**
 * Tenta montar imagem + áudio em MP4 e entregar via sendVideoBuffer.
 * Retorna { route, mode } ou null se não aplicável / ffmpeg ausente.
 */
async function tryDeliverImageWithAudio(
    { imageUrl, musicUrl, label, fileName, onStatus, sendVideoBuffer, downloadImage, downloadAudio } = {}
) {
    if (!imageUrl || !musicUrl || !photoVideo.imageAsVideoEnabled()) return null;
    if (typeof sendVideoBuffer !== 'function') return null;
    if (typeof downloadImage !== 'function' || typeof downloadAudio !== 'function') {
        return null;
    }

    const ffmpeg = await photoVideo.resolveFfmpegPath();
    if (!ffmpeg) return null;

    if (typeof onStatus === 'function') {
        await onStatus({
            step: 1,
            total: 1,
            label: `${label} (foto+áudio)`,
            phase: 'compose',
        });
    }

    const imageBuf = await downloadImage(imageUrl);
    const audioBuf = await downloadAudio(musicUrl);
    const videoBuf = await photoVideo.composeImageAudioVideo(imageBuf, audioBuf);
    await sendVideoBuffer(videoBuf, `${label}+audio`, fileName);
    return { route: `${label}+audio`, mode: 'photo-video' };
}

function collectMusicUrl(...sources) {
    for (const obj of sources) {
        if (!obj || typeof obj !== 'object') continue;
        const candidates = [
            obj.musicUrl,
            obj.music_url,
            obj.audioUrl,
            obj.audio_url,
            obj.audio,
            obj.music,
            obj.playUrl,
            obj.play_url,
        ];
        for (const c of candidates) {
            const url = Array.isArray(c) ? c.find(Boolean) : c;
            if (typeof url === 'string' && url.startsWith('http')) return url;
        }
    }
    return null;
}

module.exports = {
    tryDeliverImageWithAudio,
    collectMusicUrl,
    photoVideo,
};
