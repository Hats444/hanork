'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_AUDIO_SEC = 60;
const COMPOSE_TIMEOUT_MS = 120000;
const MIN_OUTPUT_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

let ffmpegPathCache = null;
let ffmpegChecked = false;

function imageAsVideoEnabled() {
    if (process.env.MEDIA_IMAGE_AS_VIDEO === '0' || process.env.TIKTOK_IMAGE_AS_VIDEO === '0') {
        return false;
    }
    return true;
}

async function resolveFfmpegPath() {
    if (ffmpegChecked) return ffmpegPathCache;
    ffmpegChecked = true;

    const fromEnv = String(process.env.FFMPEG_PATH || '').trim();
    if (fromEnv) {
        ffmpegPathCache = fromEnv;
        return ffmpegPathCache;
    }

    try {
        const mod = require('ffmpeg-static');
        const staticPath = typeof mod === 'string' ? mod : mod?.path;
        if (staticPath) {
            ffmpegPathCache = staticPath;
            return ffmpegPathCache;
        }
    } catch {
        /* pacote opcional até npm install */
    }

    try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
        ffmpegPathCache = 'ffmpeg';
        return ffmpegPathCache;
    } catch {
        ffmpegPathCache = null;
        return null;
    }
}

function sniffImageExt(buf, fallback = 'jpg') {
    if (!buf || buf.length < 4) return fallback;
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }
    return fallback;
}

function sniffAudioExt(buf, fallback = 'mp3') {
    if (!buf || buf.length < 4) return fallback;
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3';
    if (buf.slice(0, 4).toString('ascii') === 'fLaC') return 'flac';
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'm4a';
    return fallback;
}

async function composeImageAudioVideo(
    imageBuffer,
    audioBuffer,
    { maxDurationSec = MAX_AUDIO_SEC } = {}
) {
    const ffmpeg = await resolveFfmpegPath();
    if (!ffmpeg) throw new Error('ffmpeg indisponível');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hanork-media-'));
    const imageExt = sniffImageExt(imageBuffer);
    const audioExt = sniffAudioExt(audioBuffer);
    const imagePath = path.join(tmpDir, `frame.${imageExt}`);
    const audioPath = path.join(tmpDir, `track.${audioExt}`);
    const outPath = path.join(tmpDir, 'out.mp4');

    try {
        await fs.writeFile(imagePath, imageBuffer);
        await fs.writeFile(audioPath, audioBuffer);

        const args = [
            '-y',
            '-loop',
            '1',
            '-framerate',
            '24',
            '-i',
            imagePath,
            '-i',
            audioPath,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            'scale=720:-2',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-shortest',
            '-t',
            String(maxDurationSec),
            '-movflags',
            '+faststart',
            outPath,
        ];

        await execFileAsync(ffmpeg, args, {
            timeout: COMPOSE_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
        });

        const out = await fs.readFile(outPath);
        if (!out.length || out.length < MIN_OUTPUT_BYTES) {
            throw new Error('Vídeo gerado inválido');
        }
        if (out.length > MAX_OUTPUT_BYTES) {
            throw new Error('Vídeo gerado grande demais');
        }
        return out;
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    composeImageAudioVideo,
    resolveFfmpegPath,
    imageAsVideoEnabled,
    MAX_AUDIO_SEC,
};
