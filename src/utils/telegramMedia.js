'use strict';

const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const logger = require('../config/logger');
const { resolveLocalFile } = require('./safeLocalPath');
const { extensionFromFileUrl } = require('./productFormat');

/** Limite configurável via MAX_FILE_SIZE no .env (ex: 1GB, 500MB) */
function parseMaxFileSizeBytes() {
    const raw = process.env.MAX_FILE_SIZE || '1GB';
    const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
    if (!m) return 1024 * 1024 * 1024;
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'B').toUpperCase();
    const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
    return Math.floor(n * mult);
}

const DEFAULT_MAX_BYTES = parseMaxFileSizeBytes();

const MIME_TO_EXT = {
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/vnd.rar': 'rar',
    'application/x-7z-compressed': '7z',
    'application/gzip': 'gz',
    'application/x-gzip': 'gz',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/html': 'html',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'application/vnd.android.package-archive': 'apk',
    'application/x-msdownload': 'exe',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpeg', 'mpg', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'wma', 'opus']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);

function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isImageMime(mime) {
    return /^image\//i.test(String(mime || ''));
}

function extFromMime(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (MIME_TO_EXT[m]) return MIME_TO_EXT[m];
    if (m.startsWith('image/')) return m.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    if (m.startsWith('video/')) return m.split('/')[1] || 'mp4';
    if (m.startsWith('audio/')) return m.split('/')[1] || 'mp3';
    if (m.startsWith('text/')) return 'txt';
    return null;
}

function extFromFileName(name) {
    const base = path.basename(String(name || ''));
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return null;
    const ext = base.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,12}$/i.test(ext) ? ext : null;
}

function sanitizeFileName(name, fallbackExt = 'bin') {
    const raw = path.basename(String(name || '').trim()) || `arquivo_${Date.now()}.${fallbackExt}`;
    let safe = raw.replace(/[^\w.\-()+ ]/g, '_').replace(/\s+/g, '_').slice(0, 120);
    if (!safe || safe === '.' || safe === '..') {
        safe = `arquivo_${Date.now()}.${fallbackExt}`;
    }
    if (!path.extname(safe)) {
        safe = `${safe}.${fallbackExt}`;
    }
    return safe;
}

function uniqueFileName(dir, fileName) {
    const full = path.join(dir, fileName);
    if (!fs.existsSync(full)) return fileName;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let n = 1;
    while (fs.existsSync(path.join(dir, `${base}_${n}${ext}`))) n += 1;
    return `${base}_${n}${ext}`;
}

/** Nome legível para capa de produto (sem acentos / caracteres inválidos). */
function slugifyProductName(name) {
    const raw = String(name || '')
        .trim()
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
    let safe = raw
        .replace(/[^\w.\-()+ ]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80);
    if (!safe) safe = 'produto';
    return safe;
}

/**
 * Gera nome de arquivo da capa a partir do nome do produto.
 * @param {string} productName
 * @param {{ fileName?: string, mimeType?: string }} media
 * @param {string} [targetDir] — se informado, garante nome único no diretório
 */
function buildProductPhotoFileName(productName, media = {}, targetDir = null) {
    const ext =
        extFromFileName(media.fileName) || extFromMime(media.mimeType) || 'jpg';
    const base = slugifyProductName(productName);
    const fileName = sanitizeFileName(`${base}.${ext}`, ext);
    return targetDir ? uniqueFileName(targetDir, fileName) : fileName;
}

function classifyExtension(ext) {
    const e = String(ext || '').toLowerCase();
    if (IMAGE_EXTS.has(e)) return 'image';
    if (VIDEO_EXTS.has(e)) return 'video';
    if (AUDIO_EXTS.has(e)) return 'audio';
    if (ARCHIVE_EXTS.has(e)) return 'archive';
    if (['txt', 'md', 'json', 'xml', 'csv', 'html', 'htm'].includes(e)) return 'text';
    return 'file';
}

function classifyMedia(media) {
    if (!media) return 'unknown';
    if (media.kind) return media.kind;
    const ext = extFromFileName(media.fileName) || extFromMime(media.mimeType);
    return classifyExtension(ext);
}

/**
 * Extrai mídia/arquivo de uma mensagem Telegram (todos os tipos comuns de entrega).
 * @returns {null|{ fileId, fileName, mimeType, fileSize, kind, isImage, label }}
 */
function extractTelegramMedia(msg) {
    if (!msg) return null;

    if (msg.document) {
        const d = msg.document;
        const mime = d.mime_type || '';
        let fileName = d.file_name || '';
        let ext = extFromFileName(fileName) || extFromMime(mime) || 'bin';
        if (!fileName) fileName = `documento_${Date.now()}.${ext}`;
        else if (!extFromFileName(fileName) && ext) fileName = `${fileName}.${ext}`;
        return {
            fileId: d.file_id,
            fileName: sanitizeFileName(fileName, ext),
            mimeType: mime,
            fileSize: d.file_size,
            kind: classifyExtension(ext),
            isImage: isImageMime(mime) || IMAGE_EXTS.has(ext),
            label: `📄 ${ext.toUpperCase()}`,
        };
    }

    if (msg.photo?.length) {
        const best = msg.photo[msg.photo.length - 1];
        return {
            fileId: best.file_id,
            fileName: sanitizeFileName(`foto_${Date.now()}.jpg`, 'jpg'),
            mimeType: 'image/jpeg',
            fileSize: best.file_size,
            kind: 'image',
            isImage: true,
            label: '🖼️ JPG',
        };
    }

    if (msg.video) {
        const v = msg.video;
        const ext = extFromFileName(v.file_name) || extFromMime(v.mime_type) || 'mp4';
        const fileName = v.file_name ? sanitizeFileName(v.file_name, ext) : sanitizeFileName(`video_${Date.now()}.${ext}`, ext);
        return {
            fileId: v.file_id,
            fileName,
            mimeType: v.mime_type || 'video/mp4',
            fileSize: v.file_size,
            kind: 'video',
            isImage: false,
            label: '🎬 Vídeo',
        };
    }

    if (msg.video_note) {
        const v = msg.video_note;
        return {
            fileId: v.file_id,
            fileName: sanitizeFileName(`video_note_${Date.now()}.mp4`, 'mp4'),
            mimeType: 'video/mp4',
            fileSize: v.file_size,
            kind: 'video',
            isImage: false,
            label: '🎬 Video note',
        };
    }

    if (msg.animation) {
        const a = msg.animation;
        const ext = extFromFileName(a.file_name) || (a.mime_type?.includes('gif') ? 'gif' : 'mp4');
        const fileName = a.file_name
            ? sanitizeFileName(a.file_name, ext)
            : sanitizeFileName(`animacao_${Date.now()}.${ext}`, ext);
        return {
            fileId: a.file_id,
            fileName,
            mimeType: a.mime_type || 'video/mp4',
            fileSize: a.file_size,
            kind: a.mime_type?.includes('gif') ? 'image' : 'video',
            isImage: !!a.mime_type?.includes('gif'),
            label: a.mime_type?.includes('gif') ? '🖼️ GIF' : '🎬 Animação',
        };
    }

    if (msg.audio) {
        const a = msg.audio;
        const ext = extFromFileName(a.file_name) || extFromMime(a.mime_type) || 'mp3';
        const fileName = a.file_name ? sanitizeFileName(a.file_name, ext) : sanitizeFileName(`audio_${Date.now()}.${ext}`, ext);
        return {
            fileId: a.file_id,
            fileName,
            mimeType: a.mime_type || 'audio/mpeg',
            fileSize: a.file_size,
            kind: 'audio',
            isImage: false,
            label: '🎵 Áudio',
        };
    }

    if (msg.voice) {
        const v = msg.voice;
        return {
            fileId: v.file_id,
            fileName: sanitizeFileName(`voz_${Date.now()}.ogg`, 'ogg'),
            mimeType: v.mime_type || 'audio/ogg',
            fileSize: v.file_size,
            kind: 'audio',
            isImage: false,
            label: '🎤 Voz',
        };
    }

    return null;
}

/** Compat — nome antigo usado em bot.js */
function extractMediaFromMessage(msg) {
    return extractTelegramMedia(msg);
}

/**
 * Baixa arquivo do Telegram para disco local (stream + gravação atômica).
 * @returns {Promise<{ fileName: string, bytes: number, ext: string|null }>}
 */
async function downloadTelegramFile(ctx, fileId, originalName, targetDir, options = {}) {
    const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    if (!fileId) throw new Error('file_id ausente');

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const file = await ctx.telegram.getFile(fileId);
    const remotePath = file.file_path || '';
    if (!remotePath) throw new Error('Telegram não retornou caminho do arquivo');

    const tgSize = Number(file.file_size) || 0;
    if (tgSize > maxBytes) {
        throw new Error(`Arquivo grande demais (${formatBytes(tgSize)}). Máximo: ${formatBytes(maxBytes)}. Comprima ou envie link https://`);
    }

    let ext = extFromFileName(originalName) || extFromMime(options.mimeType);
    if (!ext && remotePath.includes('.')) {
        ext = extFromFileName(remotePath);
    }
    const safe = uniqueFileName(targetDir, sanitizeFileName(originalName, ext || 'bin'));
    const dest = resolveLocalFile(targetDir, safe, { checkExists: false });
    if (!dest) throw new Error('Caminho de destino inválido');

    const token = process.env.TOKEN_TELEGRAM;
    if (!token) throw new Error('TOKEN_TELEGRAM não configurado');

    const url = `https://api.telegram.org/file/bot${token}/${remotePath}`;
    const tmp = `${dest}.part`;

    try {
        const res = await axios.get(url, {
            responseType: 'stream',
            timeout: options.timeoutMs || (maxBytes > 100 * 1024 * 1024 ? 1800000 : 300000),
            maxContentLength: maxBytes,
            maxBodyLength: maxBytes,
            validateStatus: (s) => s === 200,
        });

        await pipeline(res.data, fs.createWriteStream(tmp));

        const stat = fs.statSync(tmp);
        if (stat.size === 0) {
            throw new Error('Arquivo vazio após download');
        }
        if (tgSize > 0 && stat.size !== tgSize) {
            logger.warn('[telegramMedia] size mismatch', { expected: tgSize, got: stat.size, file: safe });
        }
        if (stat.size > maxBytes) {
            throw new Error(`Download excedeu limite (${formatBytes(stat.size)})`);
        }

        fs.renameSync(tmp, dest);
        return {
            fileName: safe,
            bytes: stat.size,
            ext: extensionFromFileUrl(safe) || ext || null,
        };
    } catch (e) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch { /* ignore */ }
        throw e;
    }
}

module.exports = {
    DEFAULT_MAX_BYTES,
    formatBytes,
    extractTelegramMedia,
    extractMediaFromMessage,
    downloadTelegramFile,
    sanitizeFileName,
    slugifyProductName,
    buildProductPhotoFileName,
    classifyMedia,
    isImageMime,
    extFromMime,
    extFromFileName,
};
