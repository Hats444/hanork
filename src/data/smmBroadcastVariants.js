'use strict';

const path = require('path');
const fs = require('fs');
const { resolvePairedPromoPhoto } = require('../utils/promoMediaPaths');
const { isSmmEnabled } = require('../modules/smm/smmEnabled');
const { isSmmPublicAccess } = require('../modules/smm/smmAccess');

const { appendSmmCta, smmDeepLink } = require('../utils/broadcastDeepLinks');

const themesPath = path.join(__dirname, 'smmPromoThemes.json');
const VARIANTS = JSON.parse(fs.readFileSync(themesPath, 'utf8'));

const SMM_QUEUE_MARKER = '__smm__';
const DEFAULT_PHOTO = 'ssm_01.jpg';
const KV_VARIANT_QUEUE = 'smm_broadcast_variant_queue';

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function isSmmBroadcastEnabled() {
    if (!isSmmEnabled()) return false;
    if (!isSmmPublicAccess()) return false;
    const v = String(process.env.AUTO_BROADCAST_SMM ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function smmEveryN() {
    return Math.max(2, parseInt(process.env.AUTO_BROADCAST_SMM_EVERY_N || '3', 10));
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

function variantIndex(variant) {
    const idx = VARIANTS.findIndex((v) => v.id === variant?.id);
    return idx >= 0 ? idx : 0;
}

function pickSmmVariant(kv = {}) {
    const ids = VARIANTS.map((v) => v.id);
    const picked = pickFromQueue(ids, kv, KV_VARIANT_QUEUE);
    return VARIANTS.find((v) => v.id === picked) || VARIANTS[0];
}

/** @deprecated Use pickSmmBroadcast ou resolveSmmPhotoForVariant */
function resolveSmmPhoto(photosDir, variant = null) {
    const v = variant || VARIANTS[0];
    const idx = variantIndex(v);
    return resolvePairedPromoPhoto('smm', v, idx, photosDir).photo;
}

function resolveSmmPhotoForVariant(variant, photosDir) {
    const idx = variantIndex(variant);
    return resolvePairedPromoPhoto('smm', variant, idx, photosDir);
}

/** Texto + foto pareados por variante (somente mídia SSM). */
function pickSmmBroadcast(kv = {}, photosDir = null) {
    try {
        const { isMarketingMdEnabled, pickSmmFromMarkdown } = require('./marketingMarkdownVariants');
        if (isMarketingMdEnabled()) {
            const md = pickSmmFromMarkdown(kv, photosDir);
            if (md?.variant) return md;
        }
    } catch {
        /* fallback JSON themes */
    }
    const variant = pickSmmVariant(kv);
    const idx = variantIndex(variant);
    const paired = resolvePairedPromoPhoto('smm', variant, idx, photosDir);
    return { variant, ...paired };
}

function smmBotLink(username) {
    return smmDeepLink(username);
}

function formatSmmTelegramHtml(variant, opts = {}) {
    if (variant?.fromMarkdown && variant.fullBody) {
        return appendSmmCta(variant.fullBody, {
            botLink: opts.botLink || smmBotLink(opts.username),
            username: opts.username,
            ctaLabel: opts.ctaLabel || '📈 Ver serviços SMM',
        });
    }
    const botLink = opts.botLink || smmBotLink(opts.username);
    const headline = variant.headline || 'Serviços SMM';
    const body = String(variant.tgBody || '').trim();
    return (
        `<b>${headline}</b>\n\n` +
        `${body}\n\n` +
        `<a href="${botLink}">Abrir serviços SMM</a>\n` +
        `<i>PIX ou cartão. Suporte: /suporte</i>`
    );
}

function buildSmmWaText(variant, opts = {}) {
    const link = smmBotLink(opts.username);
    const body = String(variant.waBody || variant.tgBody || '').trim();
    return `${body}\n\n${link}\nSuporte no PV: /suporte`;
}

function mixSmmIntoProductQueue(productIds) {
    if (!isSmmBroadcastEnabled() || !productIds.length) {
        return shuffle(productIds);
    }
    const shuffled = shuffle(productIds);
    const every = smmEveryN();
    const mixed = [];
    for (let i = 0; i < shuffled.length; i++) {
        mixed.push(shuffled[i]);
        if ((i + 1) % every === 0) mixed.push(SMM_QUEUE_MARKER);
    }
    return shuffle(mixed);
}

function filterQueueMarkers(queue, activeProductIds) {
    const active = new Set(activeProductIds);
    const allowSmm = isSmmBroadcastEnabled();
    return queue.filter((id) => (id === SMM_QUEUE_MARKER && allowSmm) || active.has(id));
}

module.exports = {
    SMM_QUEUE_MARKER,
    DEFAULT_PHOTO,
    VARIANTS,
    isSmmBroadcastEnabled,
    smmEveryN,
    pickSmmVariant,
    pickSmmBroadcast,
    resolveSmmPhoto,
    resolveSmmPhotoForVariant,
    smmBotLink,
    formatSmmTelegramHtml,
    buildSmmWaText,
    mixSmmIntoProductQueue,
    filterQueueMarkers,
    KV_VARIANT_QUEUE,
};
