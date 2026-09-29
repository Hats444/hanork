'use strict';

const path = require('path');
const fs = require('fs');
const { resolvePairedPromoPhoto, resolveBroadcastPromoPhoto } = require('../utils/promoMediaPaths');
const WaDivulgacaoConfig = require('../modules/wa-divulgacao/waDivulgacaoConfig');
const { hanorkDivDeepLink } = require('../utils/broadcastDeepLinks');

const themesPath = path.join(__dirname, 'wadvPromoThemes.json');
const VARIANTS = JSON.parse(fs.readFileSync(themesPath, 'utf8'));

const WADV_QUEUE_MARKER = '__wadv__';
const DEFAULT_PHOTO = 'wadv_01.jpg';
const KV_VARIANT_QUEUE = 'wadv_broadcast_variant_queue';

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function isWadvBroadcastEnabled() {
    if (!WaDivulgacaoConfig.enabled) return false;
    const v = String(process.env.AUTO_BROADCAST_WADV ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function wadvEveryN() {
    return Math.max(2, parseInt(process.env.AUTO_BROADCAST_WADV_EVERY_N || '5', 10));
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

function pickWadvVariant(kv = {}) {
    const ids = VARIANTS.map((v) => v.id);
    const picked = pickFromQueue(ids, kv, KV_VARIANT_QUEUE);
    return VARIANTS.find((v) => v.id === picked) || VARIANTS[0];
}

function pickWadvBroadcast(kv = {}, photosDir = null) {
    try {
        const { isMarketingMdEnabled, pickWadvFromMarkdown } = require('./marketingMarkdownVariants');
        if (isMarketingMdEnabled()) {
            const md = pickWadvFromMarkdown(kv, photosDir);
            if (md?.variant) return md;
        }
    } catch {
        /* fallback JSON */
    }
    const variant = pickWadvVariant(kv);
    const idx = variantIndex(variant);
    const paired = resolveBroadcastPromoPhoto('wadv', variant, idx, photosDir, `wadv-bcast:${variant.id}`);
    return { variant, ...paired };
}

function wadvBotLink(username) {
    return hanorkDivDeepLink(username);
}

function formatWadvTelegramHtml(variant, opts = {}) {
    if (variant?.fromMarkdown && variant.fullBody) {
        const { appendWadvCta } = require('../utils/broadcastDeepLinks');
        return appendWadvCta(variant.fullBody, {
            botLink: opts.botLink || wadvBotLink(opts.username),
            username: opts.username,
            ctaLabel: opts.ctaLabel || '📣 Ver planos Hanork Div',
        });
    }
    const botLink = opts.botLink || wadvBotLink(opts.username);
    const headline = variant.headline || 'Hanork Div VIP';
    const body = String(variant.tgBody || '').trim();
    return (
        `<b>${headline}</b>\n\n` +
        `${body}\n\n` +
        `<a href="${botLink}">Assinar Hanork Div</a>\n` +
        `<i>PIX ou cartão. Suporte: /suporte</i>`
    );
}

function buildWadvWaText(variant, opts = {}) {
    const link = wadvBotLink(opts.username);
    const body = String(variant.waBody || variant.tgBody || '').trim();
    return `${body}\n\n${link}\nSuporte no PV: /suporte`;
}

function mixWadvIntoProductQueue(productIds, existing = []) {
    if (!isWadvBroadcastEnabled() || !productIds.length) {
        return existing.length ? existing : shuffle(productIds);
    }
    const base = existing.length ? [...existing] : shuffle(productIds);
    const every = wadvEveryN();
    const mixed = [];
    for (let i = 0; i < base.length; i++) {
        mixed.push(base[i]);
        if ((i + 1) % every === 0) mixed.push(WADV_QUEUE_MARKER);
    }
    return shuffle(mixed);
}

module.exports = {
    WADV_QUEUE_MARKER,
    DEFAULT_PHOTO,
    VARIANTS,
    isWadvBroadcastEnabled,
    wadvEveryN,
    pickWadvVariant,
    pickWadvBroadcast,
    wadvBotLink,
    formatWadvTelegramHtml,
    buildWadvWaText,
    mixWadvIntoProductQueue,
    KV_VARIANT_QUEUE,
};
