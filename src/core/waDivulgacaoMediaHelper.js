'use strict';

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { getWaDivulgacaoClient } = require('./waDivulgacaoClient');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function getTelegramToken() {
    let token = process.env.TOKEN_TELEGRAM;
    if (!token) {
        try {
            token = require('../../config/config').TOKEN_TELEGRAM;
        } catch {
            /* ignore */
        }
    }
    return token || null;
}

function extractMedia(msg) {
    if (!msg) return null;
    if (msg.photo?.length) {
        const p = msg.photo[msg.photo.length - 1];
        return { fileId: p.file_id, kind: 'photo', ext: '.jpg' };
    }
    if (msg.video) {
        return { fileId: msg.video.file_id, kind: 'video', ext: '.mp4' };
    }
    if (msg.document) {
        const mime = String(msg.document.mime_type || '');
        if (/^image\//.test(mime)) {
            const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
            return { fileId: msg.document.file_id, kind: 'photo', ext };
        }
        if (/^video\//.test(mime)) {
            return { fileId: msg.document.file_id, kind: 'video', ext: '.mp4' };
        }
    }
    if (msg.animation) {
        return { fileId: msg.animation.file_id, kind: 'video', ext: '.mp4' };
    }
    return null;
}

function httpsGetBuffer(url, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { family: 4, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                httpsGetBuffer(res.headers.location, timeoutMs).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Download HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
                total += chunk.length;
                if (total > 16 * 1024 * 1024) {
                    req.destroy(new Error('Arquivo grande demais (máx 16 MB)'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Download timeout')));
    });
}

async function downloadTelegramMedia(telegram, fileId) {
    let file;
    let getFileErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            file = await telegram.getFile(fileId);
            break;
        } catch (err) {
            getFileErr = err;
            if (attempt < 2) await sleep(800 * (attempt + 1));
        }
    }
    if (!file) throw getFileErr || new Error('Falha ao obter arquivo do Telegram');

    const remotePath = file?.file_path;
    if (!remotePath) throw new Error('Telegram não retornou file_path');

    const token = getTelegramToken();
    if (!token) throw new Error('TOKEN_TELEGRAM não configurado');

    const url = `https://api.telegram.org/file/bot${token}/${remotePath}`;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await httpsGetBuffer(url);
        } catch (err) {
            lastErr = err;
            if (attempt < 2) await sleep(700 * (attempt + 1));
        }
    }
    throw lastErr;
}

async function stageToUserInbox(telegramId, buf, ext) {
    const { client } = getWaDivulgacaoClient(telegramId);
    client.ensureDir();
    const stagingName = `wadv-${Date.now()}${ext || '.jpg'}`;
    const inbox = path.join(client.ipcDir, 'inbox');
    await fs.ensureDir(inbox);
    await fs.writeFile(path.join(inbox, stagingName), buf);
    return stagingName;
}

async function stageMessageMedia(telegramId, ctx, message) {
    const media = extractMedia(message);
    if (!media) return { ok: false, reason: 'no_media' };
    const buf = await downloadTelegramMedia(ctx.telegram, media.fileId);
    const stagingName = await stageToUserInbox(telegramId, buf, media.ext);
    return { ok: true, stagingName, mediaKind: media.kind };
}

module.exports = {
    extractMedia,
    stageMessageMedia,
};
