'use strict';

const path = require('path');
const fs = require('fs');
const { resolvePairedPromoPhoto } = require('../utils/promoMediaPaths');
const {
    filterEntriesByWeekdayCalendar,
    isUrgencyStyle,
    recordUrgencyUse,
} = require('./marketingWeekdayCalendar');

const KV_HANORK = 'marketing_hanork_md_queue';
const KV_SMM = 'marketing_smm_md_queue';

function envFlag(name, defaultOn = false) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultOn;
    const v = String(raw).trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function isMarketingMdEnabled() {
    return envFlag('BROADCAST_MARKETING_MD', false);
}

function marketingRoot() {
    const custom = process.env.BROADCAST_MARKETING_DIR;
    if (custom && String(custom).trim()) {
        return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
    }
    return path.join(__dirname, '..', '..', 'marketing');
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function pickFromQueue(ids, kv, queueKey) {
    let queue = [];
    try {
        const raw = kv.get?.(queueKey);
        queue = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(queue)) queue = [];
    } catch {
        queue = [];
    }
    queue = queue.filter((id) => ids.includes(id));
    if (!queue.length) queue = shuffle(ids);
    const picked = queue.shift();
    kv.set?.(queueKey, JSON.stringify(queue));
    return picked;
}

function listMdFiles(subdir) {
    const dir = path.join(marketingRoot(), subdir);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => /^\d{3}\.md$/i.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * @param {string} content
 * @param {string} id — ex. md-042
 */
function parseMarketingMd(content, id) {
    const lines = String(content || '').split('\n');
    let i = 0;

    while (i < lines.length && !lines[i].trim()) i++;
    if (lines[i]?.trim().startsWith('#')) {
        i++;
        while (i < lines.length && !lines[i].trim()) i++;
    }

    let style = '';
    if (lines[i]?.includes('**Estilo:**')) {
        style = lines[i].replace(/\*\*Estilo:\*\*\s*/i, '').trim();
        i++;
    }

    const bodyLines = [];
    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '---') break;
        bodyLines.push(line);
        i++;
    }

    const fullBody = bodyLines.join('\n').trim();
    const headlineMatch = fullBody.match(/<b>([^<]+)<\/b>/i);
    const headline = headlineMatch ? headlineMatch[1].trim() : 'Hanork';
    const tgBody = fullBody.replace(/^<b>[^<]+<\/b>\s*\n?/i, '').trim();
    const waBody = stripHtml(fullBody);

    const numMatch = id.match(/(\d+)$/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 1;
    const imageIndex = (num - 1) % 20;
    const imagePrefix = id.startsWith('md-smm') ? 'ssm' : 'hanork';
    const image_file = `${imagePrefix}_${String((imageIndex % 20) + 1).padStart(2, '0')}.jpg`;

    return {
        id,
        style,
        headline,
        tgBody,
        fullBody,
        waBody,
        fromMarkdown: true,
        image_file,
        imageIndex,
    };
}

function loadVariant(subdir, fileName, idPrefix) {
    const num = fileName.replace(/\.md$/i, '');
    const id = `${idPrefix}-${num}`;
    const content = fs.readFileSync(path.join(marketingRoot(), subdir, fileName), 'utf8');
    return parseMarketingMd(content, id);
}

function buildEligibleEntries(subdir, idPrefix, promoType, kv) {
    const files = listMdFiles(subdir);
    if (!files.length) return [];

    const entries = files.map((fileName) => {
        const num = fileName.replace(/\.md$/i, '');
        const id = `${idPrefix}-${num}`;
        const variant = loadVariant(subdir, fileName, idPrefix);
        return { id, fileName, variant };
    });

    const filtered = filterEntriesByWeekdayCalendar(entries, promoType, kv);
    return filtered.length ? filtered : entries;
}

function pickFromMarkdown(subdir, idPrefix, kv, queueKey, photosDir, promoType) {
    const files = listMdFiles(subdir);
    if (!files.length) return null;

    const eligible = buildEligibleEntries(subdir, idPrefix, promoType, kv);
    const ids = eligible.map((e) => e.id);
    const pickedId = pickFromQueue(ids, kv, queueKey);
    const entry = eligible.find((e) => e.id === pickedId) || eligible[0];
    if (!entry) return null;

    if (isUrgencyStyle(entry.variant?.style)) {
        recordUrgencyUse(kv);
    }

    const paired = resolvePairedPromoPhoto(promoType, entry.variant, entry.variant.imageIndex, photosDir);
    return { variant: entry.variant, ...paired };
}

function pickHanorkFromMarkdown(kv = {}, photosDir = null) {
    const hit = pickFromMarkdown('hanork', 'md', kv, KV_HANORK, photosDir, 'hanork');
    if (hit) return hit;
    return null;
}

function pickSmmFromMarkdown(kv = {}, photosDir = null) {
    const hit = pickFromMarkdown('smm', 'md-smm', kv, KV_SMM, photosDir, 'smm');
    if (hit) return hit;
    return null;
}

module.exports = {
    isMarketingMdEnabled,
    marketingRoot,
    listMdFiles,
    parseMarketingMd,
    pickHanorkFromMarkdown,
    pickSmmFromMarkdown,
    buildEligibleEntries,
    KV_HANORK,
    KV_SMM,
};
