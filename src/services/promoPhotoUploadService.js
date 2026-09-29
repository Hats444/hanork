'use strict';

const fs = require('fs');
const path = require('path');
const { promoSubdirs, promoDirName, isPromoImageFile } = require('../utils/promoMediaPaths');

const PROMO_TYPES = Object.freeze({
    hanork: {
        label: 'Hanork PRO',
        prefix: 'hanork',
        themesFile: 'hanorkPromoThemes.json',
        waSession: 'wa_a',
        heroSlot: 1,
    },
    smm: {
        label: 'SMM / SSM',
        prefix: 'ssm',
        themesFile: 'smmPromoThemes.json',
        waSession: 'wa_b',
        heroSlot: 1,
    },
    virtuo: {
        label: 'Números SMS',
        prefix: 'virtuo',
        themesFile: 'virtuoPromoThemes.json',
        waSession: 'wa_a',
        heroSlot: 1,
    },
});

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function getPhotosDir() {
    try {
        const { CONFIG } = require('../config/config');
        if (CONFIG?.CAMINHO_FOTOS) return path.normalize(CONFIG.CAMINHO_FOTOS);
    } catch {
        /* ignore */
    }
    return path.join(__dirname, '../../fotos');
}

function getHanorkRoot() {
    const photos = getPhotosDir();
    const base = path.basename(photos).toLowerCase();
    if (base === 'fotos') return path.dirname(photos);
    return path.resolve(__dirname, '../..');
}

function loadThemes(type) {
    const meta = PROMO_TYPES[type];
    if (!meta) return [];
    const fp = path.join(__dirname, '../data', meta.themesFile);
    try {
        const list = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function slotFileName(type, slot, ext = '.jpg') {
    const meta = PROMO_TYPES[type];
    const n = Math.max(1, Math.min(99, Number(slot) || 1));
    const pad = String(n).padStart(2, '0');
    const safeExt = IMAGE_EXT.has(String(ext).toLowerCase()) ? String(ext).toLowerCase() : '.jpg';
    return `${meta.prefix}_${pad}${safeExt === '.jpeg' ? '.jpg' : safeExt}`;
}

function allStorageDirs(type) {
    const base = getPhotosDir();
    const dirs = promoSubdirs(type).map((sub) => path.join(base, sub));
    if (type === 'hanork') {
        dirs.push(path.join(getHanorkRoot(), 'zero-divu', 'src', 'media', 'hanork'));
    }
    if (type === 'smm') {
        dirs.push(path.join(getHanorkRoot(), 'zero-divu', 'src', 'media', 'ssm'));
    }
    if (type === 'virtuo') {
        dirs.push(path.join(getHanorkRoot(), 'zero-divu', 'src', 'media', 'virtuo'));
    }
    return [...new Set(dirs)];
}

function fileExists(fp) {
    try {
        return fs.existsSync(fp) && fs.statSync(fp).isFile();
    } catch {
        return false;
    }
}

function locatePhoto(type, fileName) {
    const base = getPhotosDir();
    for (const sub of ['', ...promoSubdirs(type)]) {
        const fp = sub ? path.join(base, sub, fileName) : path.join(base, fileName);
        if (fileExists(fp)) return fp;
    }
    for (const dir of allStorageDirs(type)) {
        const fp = path.join(dir, fileName);
        if (fileExists(fp)) return fp;
    }
    return null;
}

function listSlots(type) {
    const themes = loadThemes(type);
    const meta = PROMO_TYPES[type];
    const rows = [];

    for (let i = 0; i < themes.length; i++) {
        const t = themes[i];
        const fileName = t.image_file || slotFileName(type, i + 1);
        const found = locatePhoto(type, fileName);
        rows.push({
            slot: i + 1,
            id: t.id,
            fileName,
            exists: Boolean(found),
            path: found,
        });
    }

    const extra = [];
    for (const dir of allStorageDirs(type)) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (!isPromoImageFile(name)) continue;
            if (!new RegExp(`^${meta.prefix}_`, 'i').test(name)) continue;
            if (rows.some((r) => r.fileName === name)) continue;
            extra.push({
                slot: null,
                id: 'extra',
                fileName: name,
                exists: true,
                path: path.join(dir, name),
            });
        }
    }

    return { type, label: meta.label, slots: rows, extra };
}

function findNextEmptySlot(type) {
    const meta = PROMO_TYPES[type];
    if (meta?.heroSlot) return meta.heroSlot;
    const { slots } = listSlots(type);
    const missing = slots.find((s) => !s.exists);
    if (missing) return missing.slot;
    return slots.length || 1;
}

function themeFileNameForSlot(type, slot) {
    const themes = loadThemes(type);
    const idx = Math.max(1, Math.min(themes.length || 99, Number(slot) || 1)) - 1;
    if (themes[idx]?.image_file) return themes[idx].image_file;
    return slotFileName(type, slot, '.jpg');
}

function normalizeSlot(slot, type) {
    const n = Number(slot);
    if (!Number.isFinite(n) || n < 1 || n > 99) return null;
    const themes = loadThemes(type);
    if (themes.length && n > themes.length) {
        return { slot: n, warn: `slot ${n} acima dos ${themes.length} temas — salvo, mas rotação usa só 1–${themes.length}` };
    }
    return { slot: Math.floor(n) };
}

function parseSlotFromCaption(caption) {
    const raw = String(caption || '').trim();
    if (!raw) return null;
    const m1 = raw.match(/(?:^|\s)#?(\d{1,2})(?:\s|$)/);
    if (m1) return Number(m1[1]);
    const m2 = raw.match(/(?:slot|pos|foto|n)[:\s#-]*(\d{1,2})/i);
    if (m2) return Number(m2[1]);
    return null;
}

function extFromMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return '.png';
    if (m.includes('webp')) return '.webp';
    return '.jpg';
}

/**
 * Salva imagem de divulgação no slot correto (Hanork ou SMM — nunca mistura).
 * @returns {{ ok: boolean, type, fileName, slot, paths, replaced, error? }}
 */
function savePromoPhoto(type, buffer, opts = {}) {
    const meta = PROMO_TYPES[type];
    if (!meta) return { ok: false, error: 'invalid_type' };
    if (!buffer?.length) return { ok: false, error: 'empty_buffer' };
    if (buffer.length > 12 * 1024 * 1024) {
        return { ok: false, error: 'file_too_large', message: 'Máximo 12 MB' };
    }

    const norm =
        opts.slot != null
            ? normalizeSlot(opts.slot, type)
            : normalizeSlot(findNextEmptySlot(type), type);
    if (!norm) {
        return { ok: false, error: 'invalid_slot', message: 'Slot inválido (use 1–25; foto principal = slot 1)' };
    }
    const slot = norm.slot;

    // Nome fixo do tema (hanork_03.jpg / ssm_03.jpg) — pareamento texto↔foto exige .jpg
    const fileName = opts.fileName || themeFileNameForSlot(type, slot);
    if (!isPromoImageFile(fileName)) {
        return { ok: false, error: 'invalid_filename' };
    }

    const prefix = meta.prefix;
    if (!fileName.toLowerCase().startsWith(`${prefix}_`)) {
        return { ok: false, error: 'wrong_prefix', message: `Nome deve começar com ${prefix}_` };
    }

    const dirs = allStorageDirs(type);
    const written = [];
    let replaced = false;

    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, fileName);
        if (fileExists(dest)) replaced = true;
        fs.writeFileSync(dest, buffer);
        written.push(dest);
    }

    return {
        ok: true,
        type,
        label: meta.label,
        fileName,
        slot,
        paths: written,
        replaced,
        bytes: buffer.length,
        waSession: meta.waSession,
        warn: norm.warn || null,
    };
}

function formatStatusText(type = null) {
    const types = type ? [type] : ['hanork', 'smm', 'virtuo'];
    const lines = [
        '🖼 <b>Fotos de divulgação</b>',
        '',
        '<i>25 textos por tipo · 1 foto principal (slot 1) usada em todos os posts.</i>',
    ];
    for (const t of types) {
        const { label, slots, extra } = listSlots(t);
        const hero = slots[0];
        const heroOk = hero?.exists;
        lines.push(`\n<b>${label}</b> (${t})`);
        lines.push(`${heroOk ? '✅' : '⬜'} Foto principal: <code>${hero?.fileName || '?'}</code>`);
        lines.push(`📝 Textos JSON: <b>${slots.length}</b> variantes`);
        if (extra.length) lines.push(`📎 Extras: ${extra.map((e) => e.fileName).join(', ')}`);
        lines.push(`📁 <code>fotos/${promoDirName(t)}/</code>`);
    }
    lines.push('\n<i>Comandos: /foto_hanork · /foto_smm · /foto_numeros · /fotos_divulgacao</i>');
    return lines.join('\n');
}

async function reloadWaAfterUpload(type) {
    const results = [];
    try {
        const { getZeroDivuClient } = require('../plugins/zero-divu/ZeroDivuClient');
        const { listSpawnableSessions } = require('../plugins/zero-divu/waSessionsManifest');
        const meta = PROMO_TYPES[type];
        const targets = listSpawnableSessions().filter((sid) => !meta?.waSession || sid === meta.waSession);
        for (const sessionId of targets) {
            const client = getZeroDivuClient(sessionId);
            const ack = await client.sendCommand('wa.reload_config', {}, null);
            results.push({ sessionId, ok: ack?.ok });
        }
    } catch (e) {
        results.push({ error: e.message });
    }
    return results;
}

module.exports = {
    PROMO_TYPES,
    getPhotosDir,
    loadThemes,
    slotFileName,
    allStorageDirs,
    listSlots,
    findNextEmptySlot,
    normalizeSlot,
    themeFileNameForSlot,
    parseSlotFromCaption,
    savePromoPhoto,
    formatStatusText,
    reloadWaAfterUpload,
    locatePhoto,
};
